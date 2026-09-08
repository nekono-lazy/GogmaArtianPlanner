import { hashStableValue } from '../domain/models/hashing'
import type {
  OwnedWeaponId,
  PlanStep,
} from '../domain/models/publicTypes'
import type { PlannerOrchestrationResult } from '../domain/planner'

/**
 * B8-E1 benchmark-only result normalization.
 *
 * This module exists so two measurements of the same workload and the same
 * `PlannerOrchestrationBounds` can be compared. It is **not** a Domain semantic
 * authority: nothing in `src/domain` imports it, no Planner or Search code
 * branches on it, and it must never be reused as a determinism contract.
 * PLANNER_SPEC 15.9.1 already defines what run-to-run determinism does and does
 * not require; this is one benchmark's reading of that, nothing more.
 *
 * What is deliberately excluded, because a Production `PlannerIdFactory` and
 * `PlannerClock` change it on every run while the semantic outcome is
 * unchanged:
 *
 * - `ProductionPlan.id` and `PlanStep.id`
 * - reserved / runtime-created `OwnedWeapon` IDs
 * - `createdAt` / `updatedAt` and `PlanningInputSnapshot.createdAt`
 * - every `ExpectedPlanState` hash, which folds the reserved OwnedWeapon IDs in
 *
 * A `PlanStep.ownedWeaponId` is kept when it names a weapon the Planner input
 * already owned - that is semantic - and replaced by `RUNTIME_OWNED_WEAPON`
 * when it names a weapon this run reserved or created.
 *
 * The digest is built **after** the measured window closes, so none of this
 * instrumentation is inside `roundTripMs`.
 */

/** Placeholder for an OwnedWeapon ID this run minted rather than owned. */
export const RUNTIME_OWNED_WEAPON = '<runtime-owned-weapon>'

export interface PlannerOrchestrationOutcomeStep {
  readonly order: number
  readonly operationType: PlanStep['operationType']
  readonly buildListEntryId: string | null
  readonly candidateId: string | null
  readonly ownedWeaponId: string | null
  readonly rngAdvance: PlanStep['rngAdvance']
  readonly expectedResult: PlanStep['expectedResult']
  readonly requiresUserConfirmation: boolean
}

export interface PlannerOrchestrationOutcomeConflict {
  readonly kind: string
  readonly buildListEntryIds: readonly string[]
  readonly selectedBuildListEntryId: string | null
}

export interface PlannerOrchestrationOutcome {
  readonly planPresent: boolean
  readonly planStepCount: number
  readonly selectedBuildListEntryIds: readonly string[]
  readonly generatedBuildListEntryIds: readonly string[]
  readonly warningKinds: readonly string[]
  readonly steps: readonly PlannerOrchestrationOutcomeStep[]
  readonly conflicts: readonly PlannerOrchestrationOutcomeConflict[]
  readonly rejectedBuildListEntries: readonly {
    readonly buildListEntryId: string
    readonly reason: string
  }[]
  readonly requiredMaterials: readonly {
    readonly materialId: string
    readonly quantity: number
  }[]
  /** Stable digest of every field above. */
  readonly outcomeKey: string
}

function compareStableStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function normalizeOwnedWeaponId(
  ownedWeaponId: OwnedWeaponId | null,
  inputOwnedWeaponIds: ReadonlySet<string>,
): string | null {
  if (ownedWeaponId === null) return null
  return inputOwnedWeaponIds.has(ownedWeaponId)
    ? ownedWeaponId
    : RUNTIME_OWNED_WEAPON
}

/**
 * Builds the benchmark parity digest of one orchestration result.
 *
 * `inputOwnedWeaponIds` is the `PlannerInput.ownedWeapons` ID set of the very
 * fixture the run used; any other OwnedWeapon ID in the Plan was minted by this
 * run's `PlannerIdFactory`.
 *
 * Step order is preserved because PLANNER_SPEC 15.9.1 requires the PlanStep
 * semantic operation sequence *and its order* to match. Sets that carry no
 * order - selected Entries, generated Entries, warnings, conflicts, rejections,
 * materials - are sorted so an incidental ordering difference is not read as a
 * semantic difference.
 */
export function createPlannerOrchestrationOutcome(
  result: PlannerOrchestrationResult,
  inputOwnedWeaponIds: Iterable<string>,
): PlannerOrchestrationOutcome {
  const ownedIds = new Set(inputOwnedWeaponIds)
  const steps: PlannerOrchestrationOutcomeStep[] = (result.plan?.steps ?? []).map(
    (step) => ({
      order: step.order,
      operationType: step.operationType,
      buildListEntryId: step.buildListEntryId,
      candidateId: step.candidateId,
      ownedWeaponId: normalizeOwnedWeaponId(step.ownedWeaponId, ownedIds),
      rngAdvance: step.rngAdvance,
      expectedResult: step.expectedResult,
      requiresUserConfirmation: step.requiresUserConfirmation,
    }),
  )
  const conflicts: PlannerOrchestrationOutcomeConflict[] = result.conflicts
    .map((conflict) => ({
      kind: conflict.kind,
      buildListEntryIds: [...conflict.buildListEntryIds].sort(compareStableStrings),
      selectedBuildListEntryId: conflict.selectedBuildListEntryId,
    }))
    .sort((left, right) =>
      compareStableStrings(
        `${left.kind}\u0000${left.buildListEntryIds.join(',')}`,
        `${right.kind}\u0000${right.buildListEntryIds.join(',')}`,
      ),
    )
  const outcome = {
    planPresent: result.plan !== null,
    planStepCount: steps.length,
    selectedBuildListEntryIds: [
      ...(result.plan?.selectedBuildListEntryIds ?? []),
    ].sort(compareStableStrings),
    generatedBuildListEntryIds: result.generatedBuildListEntries
      .map(({ id }) => id as string)
      .sort(compareStableStrings),
    warningKinds: result.warnings
      .map(({ kind }) => kind as string)
      .sort(compareStableStrings),
    steps,
    conflicts,
    rejectedBuildListEntries: (result.plan?.rejectedBuildListEntries ?? [])
      .map(({ buildListEntryId, reason }) => ({
        buildListEntryId: buildListEntryId as string,
        reason,
      }))
      .sort((left, right) =>
        compareStableStrings(
          `${left.buildListEntryId}\u0000${left.reason}`,
          `${right.buildListEntryId}\u0000${right.reason}`,
        ),
      ),
    requiredMaterials: (result.plan?.requiredMaterials ?? [])
      .map(({ materialId, quantity }) => ({ materialId, quantity }))
      .sort((left, right) => compareStableStrings(left.materialId, right.materialId)),
  }
  return { ...outcome, outcomeKey: hashStableValue(outcome) }
}

/** Which orchestration bound, if any, each B8 warning kind reports. */
export interface PlannerOrchestrationBoundFlags {
  readonly trialBoundReached: boolean
  readonly generatedBoundReached: boolean
  readonly rerunBoundReached: boolean
  readonly enumerationBoundReached: boolean
}

export function readPlannerOrchestrationBoundFlags(
  warningKinds: readonly string[],
): PlannerOrchestrationBoundFlags {
  return {
    trialBoundReached: warningKinds.includes(
      'max_candidate_trials_per_conflict_reached',
    ),
    generatedBoundReached: warningKinds.includes(
      'max_generated_build_list_entries_reached',
    ),
    rerunBoundReached: warningKinds.includes('max_planner_reruns_reached'),
    enumerationBoundReached: warningKinds.includes(
      'constrained_enumeration_bound_reached',
    ),
  }
}
