import type {
  BuildListEntry,
  BuildListEntryId,
  CompromiseCheckpointGroupId,
  CompromiseCheckpointOpportunity,
  CompromiseCheckpointOpportunityId,
  TargetWeaponId,
} from '../models/publicTypes'

function compareStableStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * One checkpoint the user selected for this Entry, together with the group it
 * belongs to.
 *
 * A checkpoint is a hard Planner constraint (`docs/PLANNER_SPEC.md` 7.5.3): the
 * Planner may never ignore it, treat it as unselected, or silently move the
 * selection to another opportunity of the same group. All it may do is fail to
 * produce a Plan that satisfies it.
 */
export interface SelectedCheckpoint {
  groupId: CompromiseCheckpointGroupId
  opportunity: CompromiseCheckpointOpportunity
}

/**
 * The checkpoints one BuildListEntry has selected, in Route order.
 *
 * A selected id that no longer exists in the snapshot is deliberately not
 * silently dropped here: `validateBuildListEntry()` fails closed on it, and the
 * Planner validation excludes such an Entry before the Beam Search sees it.
 */
export function selectedCheckpointsForEntry(
  entry: BuildListEntry,
): SelectedCheckpoint[] {
  const selected = new Set<string>(entry.selectedCheckpointOpportunityIds ?? [])
  if (selected.size === 0) return []
  return (entry.candidateSnapshot.checkpointGroups ?? [])
    .flatMap((group) =>
      group.opportunities
        .filter((opportunity) => selected.has(opportunity.id))
        .map((opportunity) => ({ groupId: group.id, opportunity })),
    )
    .sort(
      (left, right) =>
        left.opportunity.afterOperationIndex - right.opportunity.afterOperationIndex,
    )
}

/**
 * The Route operation indexes at which this Entry's selected checkpoints are
 * reached.
 *
 * A unit at one of these indexes is an *observed* intermediate state, so it can
 * never be silently fast-forwarded past: the player really has to perform it to
 * hold the compromise weapon (`docs/PLANNER_SPEC.md` 7.5.1).
 */
export function selectedCheckpointEndpointOperationIndexes(
  entry: BuildListEntry,
): Set<number> {
  return new Set(
    selectedCheckpointsForEntry(entry).map(
      ({ opportunity }) => opportunity.afterOperationIndex,
    ),
  )
}

/** The selected checkpoint ending at this operation index, if any. */
export function selectedCheckpointAtOperationIndex(
  entry: BuildListEntry,
  operationIndex: number,
): SelectedCheckpoint | null {
  return (
    selectedCheckpointsForEntry(entry).find(
      ({ opportunity }) => opportunity.afterOperationIndex === operationIndex,
    ) ?? null
  )
}

/**
 * Whether every checkpoint this Entry selected has actually been reached.
 *
 * The Candidate may only be secured once this holds, which is what makes the
 * selection a constraint rather than a preference: a branch that skipped a
 * selected checkpoint simply cannot finish that Entry.
 */
export function hasReachedEverySelectedCheckpoint(
  entry: BuildListEntry,
  reachedOpportunityIds: readonly string[],
): boolean {
  const reached = new Set(reachedOpportunityIds)
  return selectedCheckpointsForEntry(entry).every(({ opportunity }) =>
    reached.has(opportunity.id),
  )
}

/**
 * The Target-wide checkpoint requirement of one Planner run
 * (`docs/PLANNER_SPEC.md` 7.5.6).
 *
 * A BuildListEntry that carries a selected checkpoint is that Target's
 * *required* Entry: the Target is not finished until this very Entry reached
 * every selected checkpoint and secured its Ideal Candidate, and no other
 * Entry of the Target is adopted as an alternative finishing Route. The map is
 * derived from the whole set of valid BuildListEntries of the run - never from
 * a conflict's participants alone - so constrained re-search and what-if read
 * the same authority the Beam Search does.
 */
export interface PlannerCheckpointRequirements {
  requiredEntryIdByTargetId: ReadonlyMap<TargetWeaponId, BuildListEntryId>
}

/** A Target with two or more checkpoint-selected Entries: fail closed. */
export interface PlannerCheckpointRequirementViolation {
  targetWeaponId: TargetWeaponId
  buildListEntryIds: BuildListEntryId[]
}

export interface PlannerCheckpointRequirementDerivation {
  requirements: PlannerCheckpointRequirements
  /** Stable order by Target ID; never resolved by picking one Entry. */
  violations: PlannerCheckpointRequirementViolation[]
}

export const EMPTY_PLANNER_CHECKPOINT_REQUIREMENTS: PlannerCheckpointRequirements = {
  requiredEntryIdByTargetId: new Map(),
}

/**
 * Derives the required Entry of every Target from the given Entries.
 *
 * At most one checkpoint-selected Entry per Target is a collection-level
 * invariant of the Planner input (`docs/DATA_MODEL.md` 9.4). Two such Entries
 * mean the user's intent - two mandatory Routes, or alternatives - is unknown,
 * so the Target is reported as a violation and gets no requirement: the caller
 * fails the input closed instead of guessing, scoring, or taking the first one.
 */
export function derivePlannerCheckpointRequirements(
  entries: readonly BuildListEntry[],
): PlannerCheckpointRequirementDerivation {
  const selectedByTarget = new Map<TargetWeaponId, BuildListEntryId[]>()
  entries.forEach((entry) => {
    if (selectedCheckpointsForEntry(entry).length === 0) return
    selectedByTarget.set(entry.targetWeaponId, [
      ...(selectedByTarget.get(entry.targetWeaponId) ?? []),
      entry.id,
    ])
  })
  const requiredEntryIdByTargetId = new Map<TargetWeaponId, BuildListEntryId>()
  const violations: PlannerCheckpointRequirementViolation[] = []
  ;[...selectedByTarget]
    .sort(([left], [right]) => compareStableStrings(left, right))
    .forEach(([targetWeaponId, entryIds]) => {
      const buildListEntryIds = [...new Set(entryIds)].sort(compareStableStrings)
      if (buildListEntryIds.length === 1) {
        requiredEntryIdByTargetId.set(targetWeaponId, buildListEntryIds[0])
      } else {
        violations.push({ targetWeaponId, buildListEntryIds })
      }
    })
  return { requirements: { requiredEntryIdByTargetId }, violations }
}

export type { CompromiseCheckpointOpportunityId }
