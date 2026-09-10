import type {
  BuildListEntry,
  BuildListEntryId,
  DomainValidationIssue,
  TargetWeapon,
  TargetWeaponId,
} from '../models/publicTypes'
import {
  detectPlannerConflicts,
  type PlannerConflictDetectionResult,
} from './plannerConflictDetection'
import { entryIsRelevantForState } from './plannerEntryRelevance'
import { createInitialPlannerSearchState } from './plannerInitialState'
import {
  createPlannerRouteUnitPlans,
  fastForwardPlannerRouteProgress,
  type PlannerRouteUnit,
} from './plannerRouteProgress'
import type {
  ExcludedBuildListEntry,
  PlannerConflictResolution,
  PlannerDependencies,
  PlannerInput,
  PlannerSearchRejection,
  PlannerSearchState,
  PlannerWarning,
  ValidatedBuildListEntry,
} from './plannerTypes'
import { validatePlannerInput } from './plannerValidation'

function compareStableStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * Everything the ordinary Beam Search and a future B8 augmented preflight need
 * before the first expansion. It carries no B8-specific field and applies no
 * B8-specific conflict shortcut.
 */
export interface PlannerInitialContext {
  validBuildListEntries: readonly ValidatedBuildListEntry[]
  excludedBuildListEntries: ExcludedBuildListEntry[]
  validConflictResolutions: readonly PlannerConflictResolution[]
  /** Caller-owned; validation and initial-state warnings in discovery order. */
  warnings: PlannerWarning[]
  /** Caller-owned; the createPlannerRouteUnitPlans rejections, unchanged. */
  routePlanRejections: PlannerSearchRejection[]
  /** Caller-owned Beam Search start state, already pruned to searchable Entries. */
  initialState: PlannerSearchState
  allSearchEntries: readonly BuildListEntry[]
  entriesById: ReadonlyMap<BuildListEntryId, BuildListEntry>
  allUnitPlans: ReadonlyMap<BuildListEntryId, readonly PlannerRouteUnit[]>
  routeUnitCountByEntryId: ReadonlyMap<BuildListEntryId, number>
  targets: readonly TargetWeapon[]
  targetsById: ReadonlyMap<TargetWeaponId, TargetWeapon>
  initialRelevantEntries: readonly BuildListEntry[]
  initialRelevantUnitPlans: ReadonlyMap<BuildListEntryId, readonly PlannerRouteUnit[]>
  initialConflictDetection: PlannerConflictDetectionResult
}

export type PlannerInitialContextResult =
  | { status: 'ready'; context: PlannerInitialContext }
  | {
      status: 'invalid'
      warnings: PlannerWarning[]
      issues: DomainValidationIssue[]
      excludedBuildListEntries: ExcludedBuildListEntry[]
    }

/**
 * Runs the shared Planner input validation, initial state, Route unit plan,
 * initial relevant-entry selection, and initial PlanConflict detection path.
 *
 * It is a pure Domain calculation: no persistence, Worker, React state, Clock,
 * or ID factory access. Only PlannerDependencies.rngEngine is used, because the
 * existing validation and Route unit plan creation require it.
 */
export function preparePlannerInitialContext(
  input: PlannerInput,
  dependencies: PlannerDependencies,
): PlannerInitialContextResult {
  const validation = validatePlannerInput(input, dependencies)
  const warnings = [...validation.warnings]
  if (!validation.isValid) {
    return {
      status: 'invalid',
      warnings,
      issues: validation.issues,
      excludedBuildListEntries: validation.excludedBuildListEntries,
    }
  }
  const initial = createInitialPlannerSearchState(
    input,
    validation.validBuildListEntries,
  )
  warnings.push(...initial.warnings)
  if (!initial.isValid || initial.state === null) {
    return {
      status: 'invalid',
      warnings,
      issues: initial.issues,
      excludedBuildListEntries: validation.excludedBuildListEntries,
    }
  }
  const initialSearchState = initial.state
  const routePlans = createPlannerRouteUnitPlans(
    validation.validBuildListEntries.map(({ entry }) => entry),
    dependencies.rngEngine,
  )
  const allSearchEntries = validation.validBuildListEntries
    .map(({ entry }) => entry)
    .filter((entry) => routePlans.unitPlans.has(entry.id))
    .sort((left, right) => compareStableStrings(left.id, right.id))
  const targets = input.targetWeapons
    .filter(({ isEnabled }) => isEnabled)
    .sort((left, right) => compareStableStrings(left.id, right.id))
  const targetsById = new Map(targets.map((target) => [target.id, target]))
  const initialRelevantEntries = allSearchEntries.filter((entry) =>
    entryIsRelevantForState(initialSearchState, entry),
  )
  const entriesById = new Map(
    allSearchEntries.map((entry) => [entry.id, entry]),
  )
  const allUnitPlans = new Map(
    allSearchEntries.flatMap((entry) => {
      const units = routePlans.unitPlans.get(entry.id)
      return units === undefined ? [] : [[entry.id, units] as const]
    }),
  )
  const routeUnitCountByEntryId = new Map(
    [...allUnitPlans].map(([entryId, units]) => [entryId, units.length]),
  )
  const initialState = structuredClone(initialSearchState)
  Object.keys(initialState.routeProgressByEntryId).forEach((entryId) => {
    if (!entriesById.has(entryId as BuildListEntryId)) {
      delete initialState.routeProgressByEntryId[entryId]
      delete initialState.routeRuntimeByEntryId[entryId]
      delete initialState.routeSourceVersionByEntryId[entryId]
    }
  })
  // Normally a no-op, because a Candidate Route starts at the current Counter.
  // A Route whose skippable prefix already sits behind the current Counter
  // starts at the position the Beam Search would reach, so the initial conflict
  // detection never reports an already passed prefix.
  fastForwardPlannerRouteProgress(initialState, allUnitPlans)
  const initialRelevantUnitPlans = new Map(
    initialRelevantEntries.flatMap((entry) => {
      const units = allUnitPlans.get(entry.id)
      return units === undefined
        ? []
        : [[
            entry.id,
            units.slice(initialState.routeProgressByEntryId[entry.id] ?? 0),
          ] as const]
    }),
  )
  const initialConflictDetection = detectPlannerConflicts(
    initialRelevantEntries,
    initialRelevantUnitPlans,
    targets,
    initialState,
    validation.validConflictResolutions,
    false,
  )
  return {
    status: 'ready',
    context: {
      validBuildListEntries: validation.validBuildListEntries,
      excludedBuildListEntries: validation.excludedBuildListEntries,
      validConflictResolutions: validation.validConflictResolutions,
      warnings,
      routePlanRejections: [...routePlans.rejections],
      initialState,
      allSearchEntries,
      entriesById,
      allUnitPlans,
      routeUnitCountByEntryId,
      targets,
      targetsById,
      initialRelevantEntries,
      initialRelevantUnitPlans,
      initialConflictDetection,
    },
  }
}
