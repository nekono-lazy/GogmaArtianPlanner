import type {
  BuildCandidate,
  BuildListEntry,
  BuildListEntryId,
  BuildRoute,
  CompromiseCheckpointOpportunityId,
  GroupSkillId,
  RestorationBonus,
  RestorationBonusScope,
  RestorationBonusSet,
  SeriesSkillId,
  TargetWeapon,
  TargetWeaponId,
} from '../models/publicTypes'
import { hashStableValue, stableStringify } from '../models/hashing'
import { isBuildResultCalculationContextCompatible } from '../models/domainRules'

function compareStable(left: unknown, right: unknown): number {
  const leftValue = stableStringify(left)
  const rightValue = stableStringify(right)
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0
}

function normalizeBonuses(bonuses: readonly RestorationBonus[]) {
  return bonuses
    .map(({ bonusTypeId, bonusRankId }) => ({ bonusTypeId, bonusRankId }))
    .sort(compareStable)
}

export function createTargetDefinitionHash(target: TargetWeapon): string {
  return hashStableValue({
    weaponTypeId: target.weaponTypeId,
    elementId: target.elementId,
    priority: target.priority,
    isEnabled: target.isEnabled,
    // The preferred owned weapon changes which Route the Planner prefers for
    // this Target, so changing it must stale existing entries with
    // `target_definition_changed` (`docs/DATA_MODEL.md` 9.4).
    preferredOwnedWeaponId: target.preferredOwnedWeaponId,
    idealBonuses: normalizeBonuses(target.idealBonuses),
    practicalBonusConditions: target.practicalBonusConditions
      .map((condition) => ({ ...condition }))
      .sort(compareStable),
    alternativeBonusRules: target.alternativeBonusRules
      .map((group) => ({
        id: group.id,
        sourceBonusTypeId: group.sourceBonusTypeId,
        maxReplacementCount: group.maxReplacementCount,
        options: group.options.map((option) => ({ ...option })).sort(compareStable),
      }))
      .sort(compareStable),
    idealSkillCondition: { ...target.idealSkillCondition },
    practicalSkillCondition: { ...target.practicalSkillCondition },
  })
}

/**
 * The run-independent semantic meaning of one Candidate.
 *
 * `restorationBonusScope` is part of that meaning (PLANNER_SPEC 9.2.12): five
 * slots carrying identical Bonus Type / Rank labels mean a different result in
 * `normal_artian` scope than in `gogma_artian` scope, and B5-F1 already made
 * scope explicit everywhere else that compares completed results. Bonus slots
 * stay an unordered multiset with duplicate counts preserved, while
 * `route.operations` keeps its semantic order.
 *
 * Nothing derived, presentational, or run-scoped participates: no Candidate ID,
 * `searchRunId`, `createdAt`, category, similarity metadata, ideal-difference
 * summary, estimate field, or material requirement.
 */
export interface BuildCandidateMeaning {
  targetWeaponId: TargetWeaponId
  route: BuildRoute
  finalBonuses: RestorationBonusSet
  restorationBonusScope: RestorationBonusScope
  seriesSkillId: SeriesSkillId | null
  groupSkillId: GroupSkillId | null
}

export function createBuildCandidateMeaningFingerprint(
  candidate: BuildCandidateMeaning,
): string {
  return hashStableValue({
    targetWeaponId: candidate.targetWeaponId,
    route: candidate.route,
    finalBonuses: normalizeBonuses(candidate.finalBonuses),
    restorationBonusScope: candidate.restorationBonusScope,
    seriesSkillId: candidate.seriesSkillId,
    groupSkillId: candidate.groupSkillId,
  })
}

export function isSameBuildListCandidate(
  entry: BuildListEntry,
  candidate: BuildCandidate,
): boolean {
  return (
    entry.targetWeaponId === candidate.targetWeaponId &&
    isBuildResultCalculationContextCompatible(entry.calculationContext, candidate.calculationContext) &&
    isBuildResultCalculationContextCompatible(entry.candidateSnapshot.calculationContext, candidate.calculationContext) &&
    createBuildCandidateMeaningFingerprint(entry.candidateSnapshot) ===
      createBuildCandidateMeaningFingerprint(candidate)
  )
}

export interface CreateBuildListEntryOptions {
  id?: BuildListEntryId
  createdAt?: string
  /**
   * The compromise checkpoints the user chose on the Search screen.
   *
   * They are the Entry's own Planner input, so they never take part in
   * `createEntryId()` or `createBuildCandidateMeaningFingerprint()`: two Entries
   * differing only in their checkpoint selection would otherwise be two
   * different Candidates, which they are not (`docs/DATA_MODEL.md` 9.4).
   */
  selectedCheckpointOpportunityIds?: readonly CompromiseCheckpointOpportunityId[]
}

/**
 * Replaces one Entry's checkpoint selection.
 *
 * It is an ordinary Build List edit, not a recalculation: the Candidate
 * Snapshot, both hashes and the `CalculationContext` are untouched, so the
 * Entry does not become stale. What it does change is the Plan's build-list
 * semantic hash, which is what makes an existing Plan a recalculation target
 * (`docs/PLANNER_SPEC.md` 7.5.5).
 */
export function withSelectedCheckpointOpportunities(
  entry: BuildListEntry,
  selectedCheckpointOpportunityIds: readonly CompromiseCheckpointOpportunityId[],
): BuildListEntry {
  return {
    ...entry,
    selectedCheckpointOpportunityIds: [...selectedCheckpointOpportunityIds],
  }
}

function createEntryId(candidate: BuildCandidate, createdAt: string): BuildListEntryId {
  const suffix = hashStableValue({
    candidate: createBuildCandidateMeaningFingerprint(candidate),
    createdAt,
  }).replace(':', '-')
  return `build-list.${suffix}` as BuildListEntryId
}

export function createBuildListEntry(
  candidate: BuildCandidate,
  target: TargetWeapon,
  options: CreateBuildListEntryOptions = {},
): BuildListEntry {
  if (candidate.targetWeaponId !== target.id) {
    throw new Error('Candidate and TargetWeapon IDs must match.')
  }
  const createdAt = options.createdAt ?? new Date().toISOString()
  return {
    id: options.id ?? createEntryId(candidate, createdAt),
    candidateId: candidate.id,
    targetWeaponId: target.id,
    candidateSnapshot: structuredClone(candidate),
    selectedCheckpointOpportunityIds: [
      ...(options.selectedCheckpointOpportunityIds ?? []),
    ],
    targetDefinitionHash: createTargetDefinitionHash(target),
    searchStateHash: candidate.searchStateHash,
    referencedOwnedWeaponsHash: candidate.referencedOwnedWeaponsHash,
    calculationContext: { ...candidate.calculationContext },
    isStale: false,
    staleReasons: [],
    createdAt,
  }
}
