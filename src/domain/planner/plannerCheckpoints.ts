import type {
  BuildListEntry,
  CompromiseCheckpointGroupId,
  CompromiseCheckpointOpportunity,
  CompromiseCheckpointOpportunityId,
} from '../models/publicTypes'

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

export type { CompromiseCheckpointOpportunityId }
