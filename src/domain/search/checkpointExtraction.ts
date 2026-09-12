import type {
  BuildCandidate,
  BuildRoute,
  CompromiseCheckpointGroup,
  CompromiseCheckpointGroupId,
  CompromiseCheckpointOpportunity,
  CompromiseCheckpointOpportunityId,
  CompromiseConditionMatch,
  GroupSkillId,
  OwnedWeapon,
  RestorationBonusScope,
  RestorationBonusSet,
  RouteOperation,
  SeriesSkillId,
  TargetWeapon,
  WeaponTypeId,
} from '../models/publicTypes'
import { areRestorationBonusSetsEqual, hashStableValue, stableStringify } from '../models/publicTypes'
import { evaluateCompromiseCheckpointCondition } from '../target'
import { candidateStableKey } from './candidateProcessing'
import { bonusSolutionRetentionKey, compareStableKeys } from './semanticKeys'
import { CandidateSearchError, type SearchMasterSubset } from './searchTypes'

/**
 * The five restoration bonus slots one Route prefix currently carries.
 *
 * `known: false` covers every state whose five slots this Candidate never
 * recorded: a freshly forged Normal Artian, and a Candidate persisted before
 * the observational traces existed. It is never fabricated, and a state that is
 * not known can never become a checkpoint, which is correct on its own terms
 * too: every checkpoint Bonus match requires `gogma_artian` scope, and the only
 * operations that produce that scope are the recorded bonus amendments.
 */
type PrefixBonusState =
  | {
      known: true
      restorationBonuses: RestorationBonusSet
      restorationBonusScope: RestorationBonusScope
    }
  | { known: false }

type PrefixSkillState =
  | { known: true; seriesSkillId: SeriesSkillId | null; groupSkillId: GroupSkillId | null }
  | { known: false }

/** The weapon state reached after executing `operations[0 .. afterOperationIndex]`. */
export interface RoutePrefixState {
  afterOperationIndex: number
  /** Operation units executed up to and including `afterOperationIndex`. */
  operationCount: number
  bonuses: PrefixBonusState
  skills: PrefixSkillState
}

function initialBonusState(
  route: BuildRoute,
  ownedWeapons: readonly OwnedWeapon[],
): PrefixBonusState {
  const source = route.sourceOwnedWeaponId === null
    ? undefined
    : ownedWeapons.find(({ id }) => id === route.sourceOwnedWeaponId)
  return source === undefined
    ? { known: false }
    : {
        known: true,
        restorationBonuses: structuredClone(source.restorationBonuses),
        restorationBonusScope: source.restorationBonusScope,
      }
}

function initialSkillState(
  route: BuildRoute,
  ownedWeapons: readonly OwnedWeapon[],
): PrefixSkillState {
  const source = route.sourceOwnedWeaponId === null
    ? undefined
    : ownedWeapons.find(({ id }) => id === route.sourceOwnedWeaponId)
  if (source === undefined) return { known: false }
  // A Normal Artian weapon has no Series or Group Skill at all, which is a
  // known state rather than an unrecorded one.
  return source.kind === 'gogma'
    ? { known: true, seriesSkillId: source.seriesSkillId, groupSkillId: source.groupSkillId }
    : { known: true, seriesSkillId: null, groupSkillId: null }
}

/**
 * Replays the Candidate's own Route prefixes from what the Search already
 * recorded (`docs/SEARCH_SPEC.md` 5.8.1).
 *
 * It is a pure reconstruction: the bonus amendment results, the Reset Skills
 * results and the conversion Skill result all come from the Candidate's
 * observational traces, and the Route base state comes from the source
 * OwnedWeapon. No RNG Engine is touched, so extracting checkpoints adds no
 * `predictGogmaBonus`, `predictSkills`, or `predictNormalArtian` call and
 * cannot widen any stream's search extent.
 */
export function replayCandidateRoutePrefixStates(
  candidate: BuildCandidate,
  ownedWeapons: readonly OwnedWeapon[],
): RoutePrefixState[] {
  const operations = candidate.route.operations
  const bonusByIndex = new Map(
    (candidate.bonusAmendmentTrace ?? []).map((step) => [step.operationIndex, step]),
  )
  const skillByIndex = new Map(
    (candidate.skillAmendmentTrace ?? []).map((step) => [step.operationIndex, step]),
  )
  const conversion = candidate.conversionSkillTrace ?? null
  let bonuses = initialBonusState(candidate.route, ownedWeapons)
  let skills = initialSkillState(candidate.route, ownedWeapons)
  let operationCount = 0
  const states: RoutePrefixState[] = []
  operations.forEach((operation: RouteOperation, afterOperationIndex) => {
    operationCount += operation.type === 'create_normal_artian' ? operation.count : 1
    switch (operation.type) {
      case 'create_normal_artian':
        // The forged weapon becomes the Route's current weapon. Its five slots
        // are not recorded on the Candidate in either variant of the Normal
        // Artian route, and they are Normal-tier either way, so they can never
        // form a checkpoint.
        bonuses = { known: false }
        skills = { known: true, seriesSkillId: null, groupSkillId: null }
        break
      case 'convert_normal_to_gogma':
        // Conversion preserves the five inherited slots and their Normal scope
        // exactly, and assigns the initial Skills.
        skills = conversion !== null && conversion.operationIndex === afterOperationIndex
          ? { known: true, seriesSkillId: conversion.seriesSkillId, groupSkillId: conversion.groupSkillId }
          : { known: false }
        break
      case 'reset_bonuses':
      case 'keep_bonuses': {
        const step = bonusByIndex.get(afterOperationIndex)
        bonuses = step === undefined
          ? { known: false }
          : {
              known: true,
              restorationBonuses: structuredClone(step.restorationBonuses),
              restorationBonusScope: step.restorationBonusScope,
            }
        break
      }
      case 'reset_skills': {
        const step = skillByIndex.get(afterOperationIndex)
        skills = step === undefined
          ? { known: false }
          : { known: true, seriesSkillId: step.seriesSkillId, groupSkillId: step.groupSkillId }
        break
      }
    }
    states.push({
      afterOperationIndex,
      operationCount,
      bonuses: bonuses.known ? { ...bonuses, restorationBonuses: structuredClone(bonuses.restorationBonuses) } : bonuses,
      skills: { ...skills },
    })
  })
  return states
}

/**
 * The replayed final state must be the Candidate's own recorded result.
 *
 * A disagreement means the traces and the Route no longer describe the same
 * thing, which is an internal inconsistency: it fails loudly rather than
 * silently producing checkpoints from a state nobody will actually reach. A
 * state that was never recorded is not a disagreement and is simply skipped.
 */
function assertReplayMatchesCandidate(
  candidate: BuildCandidate,
  states: readonly RoutePrefixState[],
): void {
  const final = states.at(-1)
  if (final === undefined) return
  if (
    final.bonuses.known &&
    (final.bonuses.restorationBonusScope !== candidate.restorationBonusScope ||
      !areRestorationBonusSetsEqual(final.bonuses.restorationBonuses, candidate.finalBonuses))
  ) {
    throw new CandidateSearchError(
      'invalid_candidate',
      'Route prefix replay ends at restoration bonuses the Candidate does not record.',
    )
  }
  if (
    final.skills.known &&
    (final.skills.seriesSkillId !== candidate.seriesSkillId ||
      final.skills.groupSkillId !== candidate.groupSkillId)
  ) {
    throw new CandidateSearchError(
      'invalid_candidate',
      'Route prefix replay ends at Skills the Candidate does not record.',
    )
  }
}

function groupIdentityKey(
  restorationBonuses: RestorationBonusSet,
  restorationBonusScope: RestorationBonusScope,
  seriesSkillId: SeriesSkillId | null,
  groupSkillId: GroupSkillId | null,
): string {
  return stableStringify({
    // Scope plus the unordered multiset with duplicate counts preserved: two
    // Route positions reaching the same five labels in a different slot order
    // are the same user-visible compromise product (SEARCH_SPEC 5.8.2).
    bonuses: bonusSolutionRetentionKey(restorationBonuses, restorationBonusScope),
    seriesSkillId,
    groupSkillId,
  })
}

interface CheckpointDraft {
  identityKey: string
  restorationBonuses: RestorationBonusSet
  restorationBonusScope: RestorationBonusScope
  seriesSkillId: SeriesSkillId | null
  groupSkillId: GroupSkillId | null
  conditionMatch: CompromiseConditionMatch
  states: RoutePrefixState[]
}

/**
 * The per-`bonusTypeId` descending rank-order vectors of one checkpoint state,
 * or `null` when any reference cannot be compared safely.
 *
 * Deliberately the same conservative shape the Search retention audit uses: an
 * unknown, disabled, or weapon-unavailable Master reference makes the whole
 * state incomparable rather than optimistically comparable.
 */
function rankVectors(
  bonuses: RestorationBonusSet,
  scope: RestorationBonusScope,
  master: SearchMasterSubset,
  weaponTypeId: WeaponTypeId,
): Map<string, number[]> | null {
  const grouped = new Map<string, number[]>()
  for (const bonus of bonuses) {
    const ranks = master.bonusRanks.filter(({ id }) => id === bonus.bonusRankId)
    const rank = ranks[0]
    if (
      ranks.length !== 1 ||
      !rank.isEnabled ||
      !Number.isFinite(rank.order) ||
      !master.bonusTypes.some(({ id, isEnabled }) => id === bonus.bonusTypeId && isEnabled) ||
      !master.weaponBonusDefinitions.some((definition) =>
        definition.isEnabled &&
        definition.weaponTypeId === weaponTypeId &&
        definition.scope === scope &&
        definition.bonusTypeId === bonus.bonusTypeId &&
        definition.bonusRankId === bonus.bonusRankId,
      )
    ) {
      return null
    }
    const vector = grouped.get(bonus.bonusTypeId) ?? []
    vector.push(rank.order)
    grouped.set(bonus.bonusTypeId, vector)
  }
  for (const vector of grouped.values()) vector.sort((left, right) => right - left)
  return grouped
}

/**
 * Conservative, display-only dominance (`docs/SEARCH_SPEC.md` 5.8.4).
 *
 * True only when `better` is obviously the same compromise product with every
 * rank at least as high, at least one strictly higher, and reachable no later.
 * Differing Bonus Type compositions and differing Skills are never ranked
 * against each other. This organises the Candidate Search display and nothing
 * else: no group and no opportunity is ever removed from the Domain, because a
 * "worse" checkpoint can be the only one that avoids a Counter conflict.
 */
export function checkpointGroupDisplayDominates(
  better: CompromiseCheckpointGroup,
  worse: CompromiseCheckpointGroup,
  master: SearchMasterSubset,
  weaponTypeId: WeaponTypeId,
): boolean {
  if (
    better.id === worse.id ||
    better.restorationBonusScope !== worse.restorationBonusScope ||
    better.seriesSkillId !== worse.seriesSkillId ||
    better.groupSkillId !== worse.groupSkillId
  ) {
    return false
  }
  const betterEarliest = better.opportunities[0]?.operationCount
  const worseEarliest = worse.opportunities[0]?.operationCount
  if (betterEarliest === undefined || worseEarliest === undefined) return false
  if (betterEarliest > worseEarliest) return false

  const betterRanks = rankVectors(better.restorationBonuses, better.restorationBonusScope, master, weaponTypeId)
  const worseRanks = rankVectors(worse.restorationBonuses, worse.restorationBonusScope, master, weaponTypeId)
  if (!betterRanks || !worseRanks || betterRanks.size !== worseRanks.size) return false
  let strict = false
  for (const [bonusTypeId, worseVector] of worseRanks) {
    const betterVector = betterRanks.get(bonusTypeId)
    if (!betterVector || betterVector.length !== worseVector.length) return false
    for (let index = 0; index < worseVector.length; index += 1) {
      if (betterVector[index] < worseVector[index]) return false
      strict ||= betterVector[index] > worseVector[index]
    }
  }
  return strict
}

/**
 * Deterministic display order: earliest reachable first, then the compromise
 * that is closest to Ideal on both axes, then a stable semantic key. Nothing
 * run-dependent takes part.
 */
function compareCheckpointGroups(
  left: CompromiseCheckpointGroup,
  right: CompromiseCheckpointGroup,
): number {
  const axisRank = (match: CompromiseConditionMatch): number =>
    (match.bonus === 'ideal' ? 0 : 1) + (match.skill === 'ideal' ? 0 : 1)
  return (
    left.opportunities[0].operationCount - right.opportunities[0].operationCount ||
    axisRank(left.conditionMatch) - axisRank(right.conditionMatch) ||
    compareStableKeys(left.id, right.id)
  )
}

export interface CheckpointExtractionInput {
  target: TargetWeapon
  master: SearchMasterSubset
  ownedWeapons: readonly OwnedWeapon[]
}

/**
 * Extracts the compromise checkpoints of one canonical Ideal Candidate
 * (`docs/SEARCH_SPEC.md` 5.8).
 *
 * Only strict prefixes of the Candidate's own Route are evaluated, so a
 * compromise state that branches off the Ideal Route is never offered: the
 * whole point of the model is that one physical weapon follows one Route, and
 * a user who stops at a checkpoint can still continue to the Ideal result.
 *
 * The Route base's own starting state is deliberately not a prefix, so an owned
 * weapon that already satisfies a compromise condition before any operation
 * runs never becomes a checkpoint (SEARCH_SPEC 5.8.5).
 */
export function extractCandidateCheckpointGroups(
  candidate: BuildCandidate,
  input: CheckpointExtractionInput,
): CompromiseCheckpointGroup[] {
  const states = replayCandidateRoutePrefixStates(candidate, input.ownedWeapons)
  assertReplayMatchesCandidate(candidate, states)
  const drafts = new Map<string, CheckpointDraft>()
  // `states.length - 1` is the Ideal-completing operation, which is never a
  // checkpoint, so only strict prefixes are considered.
  for (let index = 0; index < states.length - 1; index += 1) {
    const state = states[index]
    if (!state.bonuses.known || !state.skills.known) continue
    const conditionMatch = evaluateCompromiseCheckpointCondition(
      input.target,
      state.bonuses.restorationBonuses,
      state.bonuses.restorationBonusScope,
      state.skills.seriesSkillId,
      state.skills.groupSkillId,
      input.master,
    )
    if (conditionMatch === null) continue
    const identityKey = groupIdentityKey(
      state.bonuses.restorationBonuses,
      state.bonuses.restorationBonusScope,
      state.skills.seriesSkillId,
      state.skills.groupSkillId,
    )
    const existing = drafts.get(identityKey)
    if (existing) {
      // A repeated arrival at the same compromise product is never dropped: a
      // later Route position may be the only one the Planner can actually use
      // (SEARCH_SPEC 5.8.3).
      existing.states.push(state)
      continue
    }
    drafts.set(identityKey, {
      identityKey,
      restorationBonuses: structuredClone(state.bonuses.restorationBonuses),
      restorationBonusScope: state.bonuses.restorationBonusScope,
      seriesSkillId: state.skills.seriesSkillId,
      groupSkillId: state.skills.groupSkillId,
      conditionMatch,
      states: [state],
    })
  }

  const stableKey = candidateStableKey(candidate)
  const groups: CompromiseCheckpointGroup[] = [...drafts.values()].map((draft) => {
    const id = `checkpoint-group:${hashStableValue({
      candidate: stableKey,
      group: draft.identityKey,
    })}` as CompromiseCheckpointGroupId
    const opportunities: CompromiseCheckpointOpportunity[] = draft.states.map((state) => ({
      id: `checkpoint-opportunity:${hashStableValue({
        group: id,
        afterOperationIndex: state.afterOperationIndex,
      })}` as CompromiseCheckpointOpportunityId,
      afterOperationIndex: state.afterOperationIndex,
      operationCount: state.operationCount,
      // `estimatedOperationCount` is the same operation-unit count, already
      // computed for this Route, so nothing recounts it here.
      remainingOperationCount: candidate.estimatedOperationCount - state.operationCount,
      // The exact ordered five slots of this Route position, not the group's
      // unordered identity: Planner and Trace Replay need the real state.
      restorationBonuses: state.bonuses.known
        ? structuredClone(state.bonuses.restorationBonuses)
        : structuredClone(draft.restorationBonuses),
      restorationBonusScope: draft.restorationBonusScope,
      seriesSkillId: draft.seriesSkillId,
      groupSkillId: draft.groupSkillId,
      conditionMatch: { ...draft.conditionMatch },
    }))
    return {
      id,
      restorationBonusScope: draft.restorationBonusScope,
      // Representative ordered slots come from the earliest opportunity.
      restorationBonuses: structuredClone(opportunities[0].restorationBonuses),
      seriesSkillId: draft.seriesSkillId,
      groupSkillId: draft.groupSkillId,
      conditionMatch: { ...draft.conditionMatch },
      opportunities,
      isDisplaySecondary: false,
      dominatingGroupId: null,
    }
  })
  groups.sort(compareCheckpointGroups)

  groups.forEach((group) => {
    const dominating = groups.find((other) =>
      checkpointGroupDisplayDominates(other, group, input.master, input.target.weaponTypeId),
    )
    if (dominating) {
      group.isDisplaySecondary = true
      group.dominatingGroupId = dominating.id
    }
  })
  return groups
}
