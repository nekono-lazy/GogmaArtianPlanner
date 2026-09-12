import {
  createBuildCandidateMeaningFingerprint,
  createBuildListEntry,
  createTargetDefinitionHash,
  evaluateBuildListEntryStaleness,
  type BuildListStalenessContext,
} from '../../buildList'
import {
  hashStableValue,
  isCalculationContextCompatible,
  validateBuildCandidate,
} from '../../models/publicTypes'
import type {
  BuildCandidate,
  BuildCandidateId,
  BuildListEntry,
  BuildListEntryId,
  ISODateTimeString,
  TargetWeapon,
  TargetWeaponId,
} from '../../models/publicTypes'
import { extractCandidateCheckpointGroups } from '../../search'
import type {
  ConstrainedCandidate,
  ConstrainedEnumerationBounds,
  ConstrainedSearchOrigin,
} from '../../search'
import type { PlannerClock } from '../plannerTypes'
import { ConstrainedMaterializationError } from './constrainedMaterializationErrors'
import {
  createConstrainedSearchIdentity,
  resolveConstrainedTarget,
} from './constrainedSearchIdentity'

export interface ConstrainedMaterializationContext {
  origin: ConstrainedSearchOrigin
  targetWeaponId: TargetWeaponId
  bounds: ConstrainedEnumerationBounds
  clock: PlannerClock
}

/** One materialized generated Entry and the Candidate snapshot it carries. */
export interface GeneratedBuildListEntryResult {
  entry: BuildListEntry
  candidate: BuildCandidate
  /**
   * True when a current, non-stale BuildListEntry already carried this exact
   * semantic content. A reused Entry keeps its own ID, its own `createdAt`, and
   * its own Candidate snapshot, so the caller must not persist it again.
   */
  reusedExisting: boolean
}

export interface ConstrainedMaterializer {
  readonly target: TargetWeapon
  /** The deterministic constrained search identity, also the `searchRunId`. */
  readonly searchIdentity: string
  materializeCandidate(candidate: ConstrainedCandidate): BuildCandidate
  materializeBuildListEntry(
    candidate: ConstrainedCandidate,
    existingEntries: readonly BuildListEntry[],
  ): GeneratedBuildListEntryResult
}

function deterministicCandidateId(
  searchIdentity: string,
  meaningFingerprint: string,
): BuildCandidateId {
  const suffix = hashStableValue({
    searchIdentity,
    meaning: meaningFingerprint,
  }).replace(':', '-')
  return `candidate.constrained.${suffix}` as BuildCandidateId
}

/**
 * The generated BuildListEntry ID (PLANNER_SPEC 9.2.13).
 *
 * It is derived from the Candidate semantic meaning, the Target definition
 * hash, both Search hashes, and the `CalculationContext`. `createdAt`, the
 * Clock, a random UUID, a request UUID, and an enumeration ordinal are all
 * absent, which is exactly why the ordinary `createBuildListEntry()` default ID
 * - meaning plus `createdAt` - cannot be reused here.
 */
function deterministicEntryId(
  candidate: BuildCandidate,
  meaningFingerprint: string,
  targetDefinitionHash: string,
): BuildListEntryId {
  const suffix = hashStableValue({
    meaning: meaningFingerprint,
    targetDefinitionHash,
    searchStateHash: candidate.searchStateHash,
    referencedOwnedWeaponsHash: candidate.referencedOwnedWeaponsHash,
    calculationContext: {
      gameVersion: candidate.calculationContext.gameVersion,
      masterDataVersion: candidate.calculationContext.masterDataVersion,
      rngEngineVersion: candidate.calculationContext.rngEngineVersion,
      appSchemaVersion: candidate.calculationContext.appSchemaVersion,
    },
  }).replace(':', '-')
  return `build-list.constrained.${suffix}` as BuildListEntryId
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * The B8-C2 deterministic materializer (PLANNER_SPEC 9.2.13, SEARCH_SPEC 5.6.7).
 *
 * It converts one transient `ConstrainedCandidate` into `BuildCandidate` shape
 * and, when the Planner needs it as trial input, into a generated
 * `BuildListEntry` of the ordinary persisted shape - no new provenance field
 * and no new entity.
 *
 * It recomputes no Search semantics. The completed five slots and their
 * scope, Skills, the concrete Route, every estimate, the material
 * requirements, `idealDifference`, both hashes, and the `CalculationContext`
 * are carried over from the enumerator unchanged. It adds only what the Search
 * Domain deliberately could not produce: the deterministic identity, the
 * deterministic IDs, the Clock-derived `createdAt`, and the checkpoint groups
 * of the materialized Candidate's own Route.
 *
 * It is pure apart from the injected `PlannerClock`: no `crypto.randomUUID()`,
 * no `new Date()`, no persistence, and no ordinary-Search candidate factory.
 * The ordinary `createCandidateFromPrediction()` ID rule, the ordinary
 * `searchRunId` contract, and the ordinary `createBuildListEntry()` default
 * behavior are all untouched.
 */
export function createConstrainedMaterializer(
  context: ConstrainedMaterializationContext,
): ConstrainedMaterializer {
  const target = resolveConstrainedTarget(context.origin, context.targetWeaponId)
  const searchIdentity = createConstrainedSearchIdentity({
    origin: context.origin,
    targetWeaponId: context.targetWeaponId,
    bounds: context.bounds,
  })
  const targetDefinitionHash = createTargetDefinitionHash(target)
  const stalenessContext: BuildListStalenessContext = {
    target,
    rngState: context.origin.rngState,
    normalCounters: context.origin.normalCounters,
    ownedWeapons: context.origin.ownedWeapons,
    calculationContext: context.origin.calculationContext,
  }

  function buildCandidate(
    source: ConstrainedCandidate,
    createdAt: ISODateTimeString,
  ): BuildCandidate {
    if (source.targetWeaponId !== target.id) {
      throw new ConstrainedMaterializationError(
        'target_mismatch',
        `ConstrainedCandidate targets "${source.targetWeaponId}", not "${target.id}".`,
      )
    }
    const semantic = structuredClone(source)
    const withoutId = {
      targetWeaponId: semantic.targetWeaponId,
      finalBonuses: semantic.finalBonuses,
      restorationBonusScope: semantic.restorationBonusScope,
      seriesSkillId: semantic.seriesSkillId,
      groupSkillId: semantic.groupSkillId,
      route: semantic.route,
      estimatedOperationCount: semantic.estimatedOperationCount,
      estimatedGogmaAdvance: semantic.estimatedGogmaAdvance,
      estimatedSkillAdvance: semantic.estimatedSkillAdvance,
      estimatedNormalAdvance: semantic.estimatedNormalAdvance,
      requiredMaterials: semantic.requiredMaterials,
      idealDifference: semantic.idealDifference,
      searchStateHash: semantic.searchStateHash,
      referencedOwnedWeaponsHash: semantic.referencedOwnedWeaponsHash,
      calculationContext: semantic.calculationContext,
      searchRunId: searchIdentity,
      createdAt,
    }
    const candidate: BuildCandidate = {
      ...withoutId,
      id: deterministicCandidateId(
        searchIdentity,
        createBuildCandidateMeaningFingerprint(withoutId),
      ),
    }
    // A `ConstrainedCandidate` deliberately carries no observational trace at
    // all, so nothing here can reconstruct the intermediate weapon states of
    // its Route. The result is an empty checkpoint set rather than an invented
    // one: the enumerator's job is finding another way to the Target's Ideal
    // under the Planner's fixed Candidates, and the user selects checkpoints on
    // the Candidate an ordinary Search produced (`docs/PLANNER_SPEC.md`
    // 9.2.13).
    candidate.checkpointGroups = extractCandidateCheckpointGroups(candidate, {
      target,
      master: context.origin.master,
      ownedWeapons: context.origin.ownedWeapons,
    })
    const valid = validateBuildCandidate(candidate, context.origin.ownedWeapons)
    if (!valid.isValid) {
      throw new ConstrainedMaterializationError(
        'invalid_candidate',
        valid.issues.map(({ path, message }) => `${path}: ${message}`).join('\n'),
      )
    }
    return candidate
  }

  /**
   * Whether one existing Entry holds exactly the current semantic content.
   *
   * PLANNER_SPEC 9.2.12 requires all of it: the Candidate semantic meaning, the
   * Target definition hash, both Search hashes, the `CalculationContext`, and a
   * currently empty staleness recomputed from live state rather than read off
   * the persisted `isStale` flag. `createdAt` is deliberately absent - a past
   * run's timestamp differs from this run's Clock and says nothing about
   * semantic content.
   */
  function isCurrentSemanticMatch(
    entry: BuildListEntry,
    candidate: BuildCandidate,
    meaningFingerprint: string,
  ): boolean {
    return (
      entry.targetWeaponId === candidate.targetWeaponId &&
      createBuildCandidateMeaningFingerprint(entry.candidateSnapshot) ===
        meaningFingerprint &&
      entry.targetDefinitionHash === targetDefinitionHash &&
      entry.searchStateHash === candidate.searchStateHash &&
      entry.referencedOwnedWeaponsHash === candidate.referencedOwnedWeaponsHash &&
      isCalculationContextCompatible(
        entry.calculationContext,
        candidate.calculationContext,
      ) &&
      !evaluateBuildListEntryStaleness(entry, stalenessContext).isStale
    )
  }

  return {
    target,
    searchIdentity,
    materializeCandidate: (candidate) =>
      buildCandidate(candidate, context.clock.now()),
    materializeBuildListEntry: (source, existingEntries) => {
      const createdAt = context.clock.now()
      const candidate = buildCandidate(source, createdAt)
      const meaningFingerprint = createBuildCandidateMeaningFingerprint(candidate)
      const entryId = deterministicEntryId(
        candidate,
        meaningFingerprint,
        targetDefinitionHash,
      )

      // Every Entry holding the deterministic ID is checked, not just the first
      // one found: a single divergent holder fails the whole materialization,
      // so the outcome cannot depend on `existingEntries` array order.
      const sameId = existingEntries.filter(({ id }) => id === entryId)
      if (
        sameId.some(
          (entry) => !isCurrentSemanticMatch(entry, candidate, meaningFingerprint),
        )
      ) {
        throw new ConstrainedMaterializationError(
          'generated_entry_id_collision',
          `BuildListEntry "${entryId}" already exists with different current semantic content.`,
        )
      }

      // A stale or otherwise divergent same-meaning Entry stays history: it is
      // never updated into a current Entry, and a new deterministic Entry is
      // created beside it (PLANNER_SPEC 9.2.12). Reuse picks the lowest matching
      // ID so the input array order cannot decide the outcome.
      const reusable = existingEntries
        .filter((entry) =>
          isCurrentSemanticMatch(entry, candidate, meaningFingerprint),
        )
        .sort((left, right) => compareIds(left.id, right.id))[0]
      if (reusable) {
        const entry = structuredClone(reusable)
        return { entry, candidate: entry.candidateSnapshot, reusedExisting: true }
      }

      return {
        entry: createBuildListEntry(candidate, target, {
          id: entryId,
          createdAt,
        }),
        candidate,
        reusedExisting: false,
      }
    },
  }
}
