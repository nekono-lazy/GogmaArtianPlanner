import type {
  BuildListEntry,
  BuildListEntryId,
  PlanConflict,
  TargetWeapon,
  TargetWeaponId,
} from '../models/publicTypes'
import { createPlanConflictId } from './conflictKey'
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

function routeMaterialConsumption(entry: BuildListEntry): number {
  return entry.candidateSnapshot.route.operations.filter(
    ({ type }) => type === 'use_weapon_as_material',
  ).length
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
      Number(right.candidateSnapshot.category === 'ideal') -
        Number(left.candidateSnapshot.category === 'ideal') ||
      nextCandidateDistance(right, allEntries) -
        nextCandidateDistance(left, allEntries) ||
      routeMaterialConsumption(left) - routeMaterialConsumption(right) ||
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

function counterGroups(
  unitPlans: ReadonlyMap<BuildListEntryId, readonly PlannerRouteUnit[]>,
): ConflictGroup[] {
  const groups = new Map<string, ConflictGroup>()
  unitPlans.forEach((units) => {
    units.forEach((unit) => {
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
      const selectedBuildListEntryId =
        resolution &&
        buildListEntryIds.includes(resolution.selectedBuildListEntryId)
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
  const warnings = resolutions.flatMap((resolution): PlannerWarning[] => {
    const conflict = conflictById.get(resolution.conflictKey)
    if (!conflict) {
      return [{
        kind: 'invalid_conflict_resolution',
        message: `Conflict resolution '${resolution.conflictKey}' does not match a currently detected conflict.`,
      }]
    }
    if (!conflict.buildListEntryIds.includes(resolution.selectedBuildListEntryId)) {
      return [{
        kind: 'invalid_conflict_resolution',
        message: `BuildListEntry '${resolution.selectedBuildListEntryId}' is not a participant in conflict '${resolution.conflictKey}'.`,
      }]
    }
    return []
  })
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
