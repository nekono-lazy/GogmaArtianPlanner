import type {
  BuildListEntry,
  BuildListEntryId,
  PlanConflict,
  PlanConflictCheckpointParticipant,
  TargetWeapon,
  TargetWeaponId,
} from '../models/publicTypes'
import { createPlanConflictId } from './conflictKey'
import { selectedCheckpointAtOperationIndex } from './plannerCheckpoints'
import type { PlannerRouteUnit } from './plannerRouteProgress'
import type {
  PlannerConflictResolution,
  PlannerSearchState,
  PlannerWarning,
} from './plannerTypes'

export interface PlannerConflictDetectionResult {
  conflicts: PlanConflict[]
  conflictIdsByUnitKey: ReadonlyMap<string, readonly string[]>
  selectedPhysicalActionKeysByConflictId: ReadonlyMap<string, readonly string[]>
  warnings: PlannerWarning[]
}

/**
 * Whether this conflict involves a selected compromise checkpoint.
 *
 * Such a conflict is out of scope for a winner-picking
 * `PlannerConflictResolution` (`docs/PLANNER_SPEC.md` 9.5): applying one would
 * make the losing Entry give up the very Counter position its selected
 * checkpoint needs, which silently drops a hard constraint. The only
 * resolution is a Build List checkpoint change followed by a new Planner run.
 */
export function conflictInvolvesSelectedCheckpoint(
  conflict: Pick<PlanConflict, 'checkpointParticipants'>,
): boolean {
  return (conflict.checkpointParticipants?.length ?? 0) > 0
}

/**
 * Why one explicit `PlannerConflictResolution` cannot be applied to the
 * conflict it names, or `null` when it can.
 *
 * This is the single Domain authority every consumer shares - initial
 * detection, the Beam Search's final warnings, and the constrained re-search
 * fixed-constraint preparation - so a refused resolution is refused the same
 * way everywhere and can never reach a Beam Search through another door.
 */
export function conflictResolutionRefusalReason(
  resolution: PlannerConflictResolution,
  conflict: PlanConflict | undefined,
): string | null {
  if (!conflict) {
    return `Conflict resolution '${resolution.conflictKey}' does not match a currently detected conflict.`
  }
  if (!conflict.buildListEntryIds.includes(resolution.selectedBuildListEntryId)) {
    return `BuildListEntry '${resolution.selectedBuildListEntryId}' is not a participant in conflict '${resolution.conflictKey}'.`
  }
  if (conflictInvolvesSelectedCheckpoint(conflict)) {
    return `Conflict '${resolution.conflictKey}' involves a selected compromise checkpoint, so it cannot be resolved by preferring BuildListEntry '${resolution.selectedBuildListEntryId}'; change or clear the checkpoint in the Build List instead.`
  }
  return null
}

function compareStableStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

export function plannerRouteUnitKey(unit: PlannerRouteUnit): string {
  return `${unit.entryId}\u0000${unit.position.operationIndex}\u0000${unit.position.unitIndex}`
}

function sortedEntryIds(units: readonly PlannerRouteUnit[]): BuildListEntryId[] {
  return [...new Set(units.map(({ entryId }) => entryId))].sort(
    compareStableStrings,
  )
}

function allOneShareablePhysicalAction(
  units: readonly PlannerRouteUnit[],
): boolean {
  return (
    units.every(({ shareable }) => shareable) &&
    new Set(units.map(({ physicalActionKey }) => physicalActionKey)).size === 1
  )
}

function nextCandidateDistance(
  entry: BuildListEntry,
  entries: readonly BuildListEntry[],
): number {
  const laterDistances = entries
    .filter(
      (candidate) =>
        candidate.id !== entry.id &&
        candidate.targetWeaponId === entry.targetWeaponId &&
        candidate.candidateSnapshot.estimatedOperationCount >=
          entry.candidateSnapshot.estimatedOperationCount,
    )
    .map(
      (candidate) =>
        candidate.candidateSnapshot.estimatedOperationCount -
        entry.candidateSnapshot.estimatedOperationCount,
    )
  return laterDistances.length === 0 ? 0 : Math.min(...laterDistances)
}

function recommendEntry(
  entryIds: readonly BuildListEntryId[],
  entriesById: ReadonlyMap<BuildListEntryId, BuildListEntry>,
  targetsById: ReadonlyMap<TargetWeaponId, TargetWeapon>,
  state: PlannerSearchState,
  allEntries: readonly BuildListEntry[],
): BuildListEntryId | null {
  const entries = entryIds.flatMap((id) => {
    const entry = entriesById.get(id)
    return entry ? [entry] : []
  })
  entries.sort((left, right) => {
    const leftTarget = targetsById.get(left.targetWeaponId)
    const rightTarget = targetsById.get(right.targetWeaponId)
    const leftSatisfaction = state.targetSatisfaction[left.targetWeaponId]
    const rightSatisfaction = state.targetSatisfaction[right.targetWeaponId]
    return (
      (rightTarget?.priority ?? 0) - (leftTarget?.priority ?? 0) ||
      Number(!rightSatisfaction?.hasPractical) -
        Number(!leftSatisfaction?.hasPractical) ||
      nextCandidateDistance(right, allEntries) -
        nextCandidateDistance(left, allEntries) ||
      left.candidateSnapshot.estimatedOperationCount -
        right.candidateSnapshot.estimatedOperationCount ||
      compareStableStrings(left.id, right.id)
    )
  })
  return entries[0]?.id ?? null
}

function appendUnitConflict(
  conflictIdsByUnitKey: Map<string, string[]>,
  conflict: PlanConflict,
  units: readonly PlannerRouteUnit[],
) {
  units.forEach((unit) => {
    const key = plannerRouteUnitKey(unit)
    conflictIdsByUnitKey.set(key, [
      ...(conflictIdsByUnitKey.get(key) ?? []),
      conflict.id,
    ])
  })
}

interface ConflictGroup {
  key: string
  kind: PlanConflict['kind']
  units: PlannerRouteUnit[]
}

/**
 * Counter positions are a shared stream, not an exclusive resource.
 *
 * A unit that another Entry's real operation can pass without breaking its own
 * Route (`canSkipWhenCounterPassed`) never competes for its Counter position
 * (`docs/PLANNER_SPEC.md` 7.0.2 / 9). Only units that must physically run at
 * that exact position can conflict, so a skippable unit is neither a conflict
 * participant nor blocked by a conflict resolution. Exclusive OwnedWeapon
 * consumption keeps its existing semantics and is detected separately.
 *
 * Not being a conflict does not make the order free: a required unit at the
 * same position must run first, and the Beam Search enforces that as execution
 * eligibility (`isSkippableUnitDominatedByRequiredUnit`), never as a conflict
 * the user has to resolve.
 */
function counterGroups(
  unitPlans: ReadonlyMap<BuildListEntryId, readonly PlannerRouteUnit[]>,
): ConflictGroup[] {
  const groups = new Map<string, ConflictGroup>()
  unitPlans.forEach((units) => {
    units.forEach((unit) => {
      if (unit.canSkipWhenCounterPassed) return
      if (unit.counterStream === null || unit.counterBefore === null) return
      const kind =
        unit.counterStream === 'gogma'
          ? 'same_gogma_counter'
          : unit.counterStream === 'skill'
            ? 'same_skill_counter'
            : 'same_normal_counter'
      const key =
        unit.counterStream === 'normal'
          ? `${kind}\u0000${unit.counterId}\u0000${unit.counterBefore}`
          : `${kind}\u0000${unit.counterBefore}`
      const group = groups.get(key) ?? { key, kind, units: [] }
      group.units.push(unit)
      groups.set(key, group)
    })
  })
  return [...groups.values()].filter(
    ({ units }) =>
      sortedEntryIds(units).length > 1 &&
      !allOneShareablePhysicalAction(units),
  )
}

function consumedWeaponGroups(
  unitPlans: ReadonlyMap<BuildListEntryId, readonly PlannerRouteUnit[]>,
): ConflictGroup[] {
  const groups = new Map<string, ConflictGroup>()
  unitPlans.forEach((units) => {
    units.forEach((unit) => {
      const id = unit.exclusiveConsumedOwnedWeaponId
      if (id === null) return
      const key = `same_owned_weapon_consumed\u0000${id}`
      const group = groups.get(key) ?? {
        key,
        kind: 'same_owned_weapon_consumed' as const,
        units: [],
      }
      group.units.push(unit)
      groups.set(key, group)
    })
  })
  return [...groups.values()].filter(
    ({ units }) =>
      sortedEntryIds(units).length > 1 &&
      !allOneShareablePhysicalAction(units),
  )
}

function conflictId(group: ConflictGroup, entryIds: BuildListEntryId[]): string {
  const first = group.units[0]
  switch (group.kind) {
    case 'same_gogma_counter':
      return createPlanConflictId({
        kind: group.kind,
        gogmaCounter: first.counterBefore as number,
        buildListEntryIds: entryIds,
      })
    case 'same_skill_counter':
      return createPlanConflictId({
        kind: group.kind,
        skillCounter: first.counterBefore as number,
        buildListEntryIds: entryIds,
      })
    case 'same_normal_counter':
      return createPlanConflictId({
        kind: group.kind,
        normalCounterId: first.counterId as string,
        normalCounter: first.counterBefore as number,
        buildListEntryIds: entryIds,
      })
    case 'same_owned_weapon_consumed':
      return createPlanConflictId({
        kind: group.kind,
        ownedWeaponId: first.exclusiveConsumedOwnedWeaponId as never,
        buildListEntryIds: entryIds,
      })
  }
}

/**
 * Which participants of this conflict are competing for a unit that ends one of
 * their own selected compromise checkpoints (`docs/PLANNER_SPEC.md` 9.5).
 *
 * Typed metadata so the UI can tell the user that this conflict can only be
 * resolved by changing a checkpoint selection in the Build List, rather than by
 * picking a winning Entry. It deliberately does not enter `PlanConflict.id`,
 * whose generation rule is unchanged.
 */
function checkpointParticipants(
  group: ConflictGroup,
  entriesById: ReadonlyMap<BuildListEntryId, BuildListEntry>,
): PlanConflictCheckpointParticipant[] {
  const participants = new Map<string, PlanConflictCheckpointParticipant>()
  group.units.forEach((unit) => {
    if (unit.position.unitIndex !== unit.position.unitCount - 1) return
    const entry = entriesById.get(unit.entryId)
    if (!entry) return
    const checkpoint = selectedCheckpointAtOperationIndex(
      entry,
      unit.position.operationIndex,
    )
    if (!checkpoint) return
    participants.set(checkpoint.opportunity.id, {
      buildListEntryId: entry.id,
      checkpointGroupId: checkpoint.groupId,
      checkpointOpportunityId: checkpoint.opportunity.id,
    })
  })
  return [...participants.values()].sort((left, right) =>
    compareStableStrings(
      left.checkpointOpportunityId,
      right.checkpointOpportunityId,
    ),
  )
}

function conflictReason(group: ConflictGroup): string {
  const first = group.units[0]
  switch (group.kind) {
    case 'same_gogma_counter':
      return `BuildListEntries require incompatible physical operations at Gogma Counter ${first.counterBefore}.`
    case 'same_skill_counter':
      return `BuildListEntries require incompatible physical operations at Skill Counter ${first.counterBefore}.`
    case 'same_normal_counter':
      return `BuildListEntries require the same Normal Counter '${first.counterId}' position ${first.counterBefore}.`
    case 'same_owned_weapon_consumed':
      return `BuildListEntries exclusively consume OwnedWeapon '${first.exclusiveConsumedOwnedWeaponId}'.`
  }
}

export function detectPlannerConflicts(
  entries: readonly BuildListEntry[],
  unitPlans: ReadonlyMap<BuildListEntryId, readonly PlannerRouteUnit[]>,
  targets: readonly TargetWeapon[],
  state: PlannerSearchState,
  resolutions: readonly PlannerConflictResolution[],
  reportInvalidResolutions = true,
): PlannerConflictDetectionResult {
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]))
  const targetsById = new Map(targets.map((target) => [target.id, target]))
  const resolutionByKey = new Map(
    resolutions.map((resolution) => [resolution.conflictKey, resolution]),
  )
  const conflictIdsByUnitKey = new Map<string, string[]>()
  const selectedPhysicalActionKeysByConflictId = new Map<string, string[]>()
  const conflicts = [...counterGroups(unitPlans), ...consumedWeaponGroups(unitPlans)]
    .map((group) => {
      const buildListEntryIds = sortedEntryIds(group.units)
      const id = conflictId(group, buildListEntryIds)
      const resolution = resolutionByKey.get(id)
      const participants = checkpointParticipants(group, entriesById)
      // A resolution is applied only when the shared refusal authority accepts
      // it: a non-participant selection and a checkpoint conflict both leave
      // the conflict unresolved, never half-applied.
      const selectedBuildListEntryId =
        resolution &&
        conflictResolutionRefusalReason(resolution, {
          id,
          kind: group.kind,
          buildListEntryIds,
          reason: '',
          recommendedBuildListEntryId: null,
          selectedBuildListEntryId: null,
          resolutionNote: null,
          checkpointParticipants: participants,
        }) === null
          ? resolution.selectedBuildListEntryId
          : null
      const conflict: PlanConflict = {
        id,
        kind: group.kind,
        buildListEntryIds,
        reason: conflictReason(group),
        recommendedBuildListEntryId: recommendEntry(
          buildListEntryIds,
          entriesById,
          targetsById,
          state,
          entries,
        ),
        selectedBuildListEntryId,
        resolutionNote:
          selectedBuildListEntryId === null
            ? null
            : `Applied local resolution for BuildListEntry '${selectedBuildListEntryId}'.`,
        checkpointParticipants: participants,
      }
      appendUnitConflict(conflictIdsByUnitKey, conflict, group.units)
      if (selectedBuildListEntryId !== null) {
        selectedPhysicalActionKeysByConflictId.set(
          conflict.id,
          [...new Set(
            group.units
              .filter(({ entryId }) => entryId === selectedBuildListEntryId)
              .map(({ physicalActionKey }) => physicalActionKey),
          )].sort(compareStableStrings),
        )
      }
      return conflict
    })
    .sort((left, right) => compareStableStrings(left.id, right.id))

  const conflictById = new Map(conflicts.map((conflict) => [conflict.id, conflict]))
  const warnings = reportInvalidResolutions ? resolutions.flatMap((resolution): PlannerWarning[] => {
    const reason = conflictResolutionRefusalReason(
      resolution,
      conflictById.get(resolution.conflictKey),
    )
    return reason === null
      ? []
      : [{ kind: 'invalid_conflict_resolution', message: reason }]
  }) : []
  return {
    conflicts,
    conflictIdsByUnitKey,
    selectedPhysicalActionKeysByConflictId,
    warnings,
  }
}

export function isUnitBlockedByConflictResolution(
  unit: PlannerRouteUnit,
  conflictsById: ReadonlyMap<string, PlanConflict>,
  conflictIdsByUnitKey: ReadonlyMap<string, readonly string[]>,
  selectedPhysicalActionKeysByConflictId: ReadonlyMap<string, readonly string[]>,
  isSelectedEntryStillRelevant: (entryId: BuildListEntryId) => boolean,
): boolean {
  return (conflictIdsByUnitKey.get(plannerRouteUnitKey(unit)) ?? []).some(
    (conflictId) => {
      const conflict = conflictsById.get(conflictId)
      if (
        !conflict ||
        conflict.selectedBuildListEntryId === null ||
        !isSelectedEntryStillRelevant(conflict.selectedBuildListEntryId)
      ) return false
      return !(
        selectedPhysicalActionKeysByConflictId
          .get(conflictId)
          ?.includes(unit.physicalActionKey) ?? false
      )
    },
  )
}
