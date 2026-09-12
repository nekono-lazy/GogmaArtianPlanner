import type {
  BuildListEntry,
  BuildListEntryId,
  DomainValidationIssue,
  OwnedGogmaArtianWeapon,
  OwnedWeaponId,
  PlanConflict,
  TargetWeapon,
  TargetWeaponId,
} from '../models/publicTypes'
import { stableStringify } from '../models/publicTypes'
import type { RngEngine } from '../rng/rngEngine'
import {
  addRegisteredWeapon,
  canUseAsDestructiveGogmaSource,
  canUseAsResetSkillsSource,
  consumeOwnedNormalForConversion,
  findOwnedWeapon,
  reserveWeaponId,
  updateOwnedWeapon,
} from './simulatedInventory'
import {
  conflictResolutionRefusalReason,
  detectPlannerConflicts,
  isUnitBlockedByConflictResolution,
} from './plannerConflictDetection'
import {
  advanceBlindNormalCreationCounters,
  advancePlannerWeaponSwitchMetric,
  arePlannerRouteUnitsShareable,
  currentPlannerCounterValue,
  fastForwardPlannerRouteProgress,
  plannerWeaponOperationSubjectKey,
  routeUnitOwnedWeaponId,
  type PlannerRouteUnit,
} from './plannerRouteProgress'
import {
  comparePlannerSearchStates,
  createPlannerSearchStateSemanticKey,
  evaluatePlannerSearchState,
} from './plannerScoring'
import { entryIsRelevantForState } from './plannerEntryRelevance'
import {
  hasReachedEverySelectedCheckpoint,
  selectedCheckpointAtOperationIndex,
} from './plannerCheckpoints'
import {
  advancePlannerPreferredSourceMetric,
  collectPreferredSourceEntryIds,
} from './plannerPreferredSource'
import { preparePlannerInitialContext } from './plannerInitialContext'
import {
  createPlannerSearchTermination,
  createUnsearchedPlannerTermination,
} from './plannerTermination'
import type {
  ExcludedBuildListEntry,
  PlannerBeamSearchResult,
  PlannerDependencies,
  PlannerExecutionOptions,
  PlannerInput,
  PlannerSearchAction,
  PlannerSearchInventoryEffect,
  PlannerSearchRejection,
  PlannerSearchRngSnapshot,
  PlannerSearchState,
  PlannerWarning,
  PlannerConflictResolution,
} from './plannerTypes'
import { deriveTargetSatisfaction } from './targetSatisfaction'

function compareStableStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function emptyInventoryEffect(): PlannerSearchInventoryEffect {
  return {
    addedOwnedWeaponIds: [],
    removedOwnedWeaponIds: [],
    updatedOwnedWeaponIds: [],
    reservedOwnedWeaponIds: [],
    routeOutputChangedForEntryIds: [],
  }
}

function rngSnapshot(state: PlannerSearchState): PlannerSearchRngSnapshot {
  return {
    gogmaCounter: state.currentRngState.gogmaCounter.value,
    skillCounter: state.currentRngState.skillCounter.value,
    normalCounters: state.currentNormalCounters
      .map(({ id, counter }) => ({ id, counter }))
      .sort((left, right) => compareStableStrings(left.id, right.id)),
  }
}

function cloneState(state: PlannerSearchState): PlannerSearchState {
  return structuredClone(state)
}

function isExistingGogmaRoute(entry: BuildListEntry): boolean {
  return entry.candidateSnapshot.route.kind.startsWith('existing_gogma')
}

function existingRouteSourceId(entry: BuildListEntry): OwnedWeaponId | null {
  return isExistingGogmaRoute(entry)
    ? entry.candidateSnapshot.route.sourceOwnedWeaponId
    : null
}

function entryUsesCurrentSourceVersion(
  state: PlannerSearchState,
  entry: BuildListEntry,
): boolean {
  const sourceId = existingRouteSourceId(entry)
  if (sourceId === null) return true
  return (
    (state.routeSourceVersionByEntryId[entry.id] ?? 0) ===
    (state.sourceMutationVersionByOwnedWeaponId[sourceId] ?? 0)
  )
}

function sourceVersionRejection(
  entry: BuildListEntry,
  unit: PlannerRouteUnit,
): PlannerSearchRejection {
  return rejection(
    entry.id,
    unit.operation.type,
    'inventory_precondition_failed',
    'The existing Gogma Route was superseded by a later source mutation.',
  )
}

function sourceMutatedByOperation(
  operation: PlannerRouteUnit['operation'],
): OwnedWeaponId | null {
  if (
    operation.type === 'reset_bonuses' ||
    operation.type === 'keep_bonuses'
  ) return operation.sourceOwnedWeaponId
  if (
    operation.type === 'reset_skills' &&
    operation.sourceOwnedWeaponId !== null
  ) return operation.sourceOwnedWeaponId
  return null
}

function refreshTargetSatisfaction(
  state: PlannerSearchState,
  targets: readonly TargetWeapon[],
  master: PlannerInput['master'],
): PlannerSearchAction['satisfactionChanges'] {
  const before = structuredClone(state.targetSatisfaction)
  const derived = deriveTargetSatisfaction(
    targets,
    state.simulatedInventory.ownedWeapons.filter(
      ({ id }) => state.inFlightExistingSourceByOwnedWeaponId[id] === undefined,
    ),
    master,
  )
  const next = Object.fromEntries(
    derived.map(({ targetWeaponId, hasPractical, hasIdeal }) => [
      targetWeaponId,
      { hasPractical, hasIdeal },
    ]),
  ) as PlannerSearchState['targetSatisfaction']
  state.targetSatisfaction = next
  return [...new Set([...Object.keys(before), ...Object.keys(next)])]
    .sort(compareStableStrings)
    .flatMap((targetWeaponId) => {
      const previous = before[targetWeaponId as TargetWeaponId] ?? {
        hasPractical: false,
        hasIdeal: false,
      }
      const current = next[targetWeaponId as TargetWeaponId] ?? {
        hasPractical: false,
        hasIdeal: false,
      }
      return previous.hasPractical === current.hasPractical &&
        previous.hasIdeal === current.hasIdeal
        ? []
        : [{ targetWeaponId: targetWeaponId as TargetWeaponId, before: previous, after: current }]
    })
}

function rejection(
  entryId: BuildListEntryId,
  actionType: PlannerSearchRejection['actionType'],
  reason: PlannerSearchRejection['reason'],
  detail: string,
): PlannerSearchRejection {
  return { buildListEntryId: entryId, actionType, reason, detail }
}

function rejectionKey(value: PlannerSearchRejection): string {
  return stableStringify(value)
}

function appendUniqueRejection(
  rejections: PlannerSearchRejection[],
  rejectionKeys: Set<string>,
  value: PlannerSearchRejection,
) {
  const key = rejectionKey(value)
  if (rejectionKeys.has(key)) return
  rejectionKeys.add(key)
  rejections.push(value)
}

function setCurrentCounter(
  state: PlannerSearchState,
  unit: PlannerRouteUnit,
) {
  if (unit.counterStream === 'gogma') {
    state.currentRngState.gogmaCounter.value = unit.counterAfter
    return
  }
  if (unit.counterStream === 'skill') {
    state.currentRngState.skillCounter.value = unit.counterAfter
    return
  }
  if (unit.counterStream === 'normal') {
    state.currentNormalCounters = state.currentNormalCounters.map((counter) =>
      counter.id === unit.counterId
        ? { ...counter, counter: unit.counterAfter }
        : counter,
    )
  }
}

function counterPreconditionRejection(
  state: PlannerSearchState,
  unit: PlannerRouteUnit,
): PlannerSearchRejection | null {
  if (unit.counterStream === null) return null
  const current = currentPlannerCounterValue(state, unit)
  if (current === null || unit.counterBefore === null || unit.counterAfter === null) {
    return rejection(
      unit.entryId,
      unit.operation.type,
      'counter_unavailable',
      'The required confirmed counter is unavailable.',
    )
  }
  if (unit.counterAfter < unit.counterBefore) {
    return rejection(
      unit.entryId,
      unit.operation.type,
      'counter_after_mismatch',
      'A saved RouteOperation that rewinds its counter is not executable.',
    )
  }
  if (current > unit.counterBefore) {
    return rejection(
      unit.entryId,
      unit.operation.type,
      'counter_before_current',
      `The current counter ${current} has already passed required position ${unit.counterBefore}, and this operation cannot be skipped.`,
    )
  }
  if (current < unit.counterBefore) {
    return rejection(
      unit.entryId,
      unit.operation.type,
      'counter_unavailable',
      `The required counter position ${unit.counterBefore} has not been reached.`,
    )
  }
  return null
}

function protectedRejection(
  unit: PlannerRouteUnit,
  detail: string,
): PlannerSearchRejection {
  return rejection(
    unit.entryId,
    unit.operation.type,
    'protected_destructive_use',
    detail,
  )
}

function inventoryPreconditionRejection(
  state: PlannerSearchState,
  entry: BuildListEntry,
  unit: PlannerRouteUnit,
): PlannerSearchRejection | null {
  const operation = unit.operation
  if (operation.type === 'reset_bonuses' || operation.type === 'keep_bonuses') {
    if (operation.sourceOwnedWeaponId === null) {
      return state.routeRuntimeByEntryId[entry.id]?.hasUnregisteredGogmaOutput && (operation.type !== 'keep_bonuses' || state.routeRuntimeByEntryId[entry.id]?.transientRestorationBonusScope === 'gogma_artian')
        ? null
        : rejection(
            entry.id,
            operation.type,
            'inventory_precondition_failed',
            'The unregistered converted Gogma route output does not exist.',
          )
    }
    const source = findOwnedWeapon(state.simulatedInventory, operation.sourceOwnedWeaponId)
    if (!source) {
      return rejection(entry.id, operation.type, 'inventory_precondition_failed', `OwnedWeapon '${operation.sourceOwnedWeaponId}' is unavailable.`)
    }
    return canUseAsDestructiveGogmaSource(source)
      ? null
      : protectedRejection(unit, `OwnedWeapon '${operation.sourceOwnedWeaponId}' is protected or is not a Gogma source.`)
  }
  if (operation.type === 'reset_skills') {
    if (operation.sourceOwnedWeaponId === null) {
      return state.routeRuntimeByEntryId[entry.id]
        ?.hasUnregisteredGogmaOutput
        ? null
        : rejection(
            entry.id,
            operation.type,
            'inventory_precondition_failed',
            'The unregistered converted Gogma route output does not exist.',
          )
    }
    const source = findOwnedWeapon(
      state.simulatedInventory,
      operation.sourceOwnedWeaponId,
    )
    if (canUseAsResetSkillsSource(source)) return null
    return source?.kind === 'gogma' && source.isProtected
      ? protectedRejection(
          unit,
          `OwnedWeapon '${operation.sourceOwnedWeaponId}' is protected and cannot be used for Reset Skills.`,
        )
      : rejection(
          entry.id,
          operation.type,
          'inventory_precondition_failed',
          `OwnedWeapon '${operation.sourceOwnedWeaponId}' is not an available Gogma source.`,
        )
  }
  if (
    operation.type === 'convert_normal_to_gogma' &&
    entry.candidateSnapshot.route.kind === 'owned_normal_artian_to_gogma'
  ) {
    const sourceId = entry.candidateSnapshot.route.sourceOwnedWeaponId
    const source =
      sourceId === null
        ? null
        : findOwnedWeapon(state.simulatedInventory, sourceId)
    if (!source) {
      return rejection(
        entry.id,
        operation.type,
        'inventory_precondition_failed',
        'The owned Normal conversion source is unavailable.',
      )
    }
    return source.isProtected
      ? protectedRejection(
          unit,
          `Protected Normal Artian '${source.id}' cannot be converted.`,
        )
      : null
  }
  return null
}

function applyRouteInventoryEffect(
  state: PlannerSearchState,
  entry: BuildListEntry,
  unit: PlannerRouteUnit,
): { rejection: PlannerSearchRejection | null; effect: PlannerSearchInventoryEffect } {
  const effect = emptyInventoryEffect()
  const operation = unit.operation
  if (
    operation.type === 'convert_normal_to_gogma' &&
    entry.candidateSnapshot.route.kind === 'owned_normal_artian_to_gogma'
  ) {
    const sourceId = entry.candidateSnapshot.route.sourceOwnedWeaponId
    if (sourceId === null) {
      return {
        rejection: rejection(
          entry.id,
          operation.type,
          'inventory_precondition_failed',
          'Owned Normal conversion route has no source OwnedWeapon ID.',
        ),
        effect,
      }
    }
    const consumed = consumeOwnedNormalForConversion(
      state.simulatedInventory,
      sourceId,
    )
    if (!consumed.isValid || consumed.inventory === null) {
      return {
        rejection: rejection(
          entry.id,
          operation.type,
          'inventory_precondition_failed',
          consumed.issues[0]?.message ?? 'Owned Normal conversion failed.',
        ),
        effect,
      }
    }
    state.simulatedInventory = consumed.inventory
    effect.removedOwnedWeaponIds.push(sourceId)
    return { rejection: null, effect }
  }
  return { rejection: null, effect }
}

function routeOutputChanges(
  entry: BuildListEntry,
  unit: PlannerRouteUnit,
): boolean {
  if (unit.operation.type === 'convert_normal_to_gogma') {
    return (
      entry.candidateSnapshot.route.kind === 'normal_artian_to_gogma' ||
      entry.candidateSnapshot.route.kind ===
        'owned_normal_artian_to_gogma'
    )
  }
  return (
    (unit.operation.type === 'reset_bonuses' ||
      unit.operation.type === 'keep_bonuses' ||
      unit.operation.type === 'reset_skills') &&
    unit.operation.sourceOwnedWeaponId === null
  )
}

function nextTransientRestorationBonusScope(
  current: PlannerSearchState['routeRuntimeByEntryId'][BuildListEntryId],
  operation: PlannerRouteUnit['operation'],
): PlannerSearchState['routeRuntimeByEntryId'][BuildListEntryId]['transientRestorationBonusScope'] {
  if (operation.type === 'convert_normal_to_gogma') return 'normal_artian'
  if (operation.type === 'reset_bonuses' && operation.sourceOwnedWeaponId === null) {
    return 'gogma_artian'
  }
  return current?.transientRestorationBonusScope ?? null
}

/**
 * Every executable precondition the Beam Search checks before it builds a
 * successor. Expansion and the required-unit eligibility scan below must use
 * exactly the same authority, so they never disagree about whether a unit can
 * run in this state.
 */
function routeUnitPreconditionRejection(
  state: PlannerSearchState,
  entry: BuildListEntry,
  unit: PlannerRouteUnit,
): PlannerSearchRejection | null {
  if (!entryUsesCurrentSourceVersion(state, entry)) {
    return sourceVersionRejection(entry, unit)
  }
  const counterIssue = counterPreconditionRejection(state, unit)
  if (counterIssue) return counterIssue
  return inventoryPreconditionRejection(state, entry, unit)
}

/** One shared Counter stream position, the resource a unit occupies. */
function counterPositionKey(unit: PlannerRouteUnit): string | null {
  if (unit.counterStream === null || unit.counterBefore === null) return null
  return `${unit.counterStream}\u0000${unit.counterId ?? ''}\u0000${unit.counterBefore}`
}

/**
 * Required next units that can run in this state, indexed by Counter position.
 *
 * A `canSkipWhenCounterPassed` unit and a required unit at the same position do
 * not conflict, but they are not interchangeable either: running the required
 * one first lets the skippable one fast-forward, while running the skippable
 * one first pushes the Counter past the required unit and kills that Route with
 * `counter_before_current`. The order is therefore decided by the Planner
 * itself, never by the user (`docs/PLANNER_SPEC.md` 7.0.2).
 */
function executableRequiredUnitsByCounterPosition(
  state: PlannerSearchState,
  entries: readonly BuildListEntry[],
  unitPlans: ReadonlyMap<BuildListEntryId, readonly PlannerRouteUnit[]>,
  isUnitBlocked: (unit: PlannerRouteUnit) => boolean,
): Map<string, PlannerRouteUnit[]> {
  const required = new Map<string, PlannerRouteUnit[]>()
  entries.forEach((entry) => {
    if (state.selectedBuildListEntryIds.includes(entry.id)) return
    if (!entryIsRelevantForState(state, entry)) return
    const units = unitPlans.get(entry.id) ?? []
    const unit = units[state.routeProgressByEntryId[entry.id] ?? 0]
    if (!unit || unit.canSkipWhenCounterPassed) return
    const key = counterPositionKey(unit)
    if (key === null) return
    if (isUnitBlocked(unit)) return
    if (routeUnitPreconditionRejection(state, entry, unit) !== null) return
    required.set(key, [...(required.get(key) ?? []), unit])
  })
  return required
}

/**
 * Whether running this skippable unit now would irreversibly lose a required
 * unit that occupies the same Counter position.
 *
 * A skippable unit that is the same physical action as one of those required
 * units is not an alternative to it: the PR #4 sharing contract already runs
 * both Entries with one operation, so that case keeps its existing semantics.
 */
function isSkippableUnitDominatedByRequiredUnit(
  unit: PlannerRouteUnit,
  requiredByCounterPosition: ReadonlyMap<string, readonly PlannerRouteUnit[]>,
): boolean {
  if (!unit.canSkipWhenCounterPassed) return false
  const key = counterPositionKey(unit)
  if (key === null) return false
  const required = requiredByCounterPosition.get(key)
  if (required === undefined || required.length === 0) return false
  return !required.some((other) => arePlannerRouteUnitsShareable(other, unit))
}

function mergedProgressedEntries(
  state: PlannerSearchState,
  primary: PlannerRouteUnit,
  entriesById: ReadonlyMap<BuildListEntryId, BuildListEntry>,
  unitPlans: ReadonlyMap<BuildListEntryId, readonly PlannerRouteUnit[]>,
  conflictsById: ReadonlyMap<string, PlanConflict>,
  conflictIdsByUnitKey: ReadonlyMap<string, readonly string[]>,
  selectedPhysicalActionKeysByConflictId: ReadonlyMap<string, readonly string[]>,
): PlannerRouteUnit[] {
  const shared = [primary]
  if (!primary.shareable) return shared
  unitPlans.forEach((units, entryId) => {
    if (entryId === primary.entryId) return
    if (state.selectedBuildListEntryIds.includes(entryId)) return
    const entry = entriesById.get(entryId)
    if (!entry) return
    if (!entryUsesCurrentSourceVersion(state, entry)) return
    if (!entryIsRelevantForState(state, entry)) return
    const progress = state.routeProgressByEntryId[entryId] ?? 0
    const next = units[progress]
    if (
      next &&
      arePlannerRouteUnitsShareable(primary, next) &&
      !isUnitBlockedByConflictResolution(
        next,
        conflictsById,
        conflictIdsByUnitKey,
        selectedPhysicalActionKeysByConflictId,
        (entryId) => {
          const selected = entriesById.get(entryId)
          return selected !== undefined && entryIsRelevantForState(state, selected)
        },
      )
    ) {
      shared.push(next)
    }
  })
  return shared.sort((left, right) =>
    compareStableStrings(left.entryId, right.entryId),
  )
}

interface AppliedActionResult {
  state: PlannerSearchState | null
  rejection: PlannerSearchRejection | null
}

function applyRouteAction(
  sourceState: PlannerSearchState,
  primary: PlannerRouteUnit,
  entriesById: ReadonlyMap<BuildListEntryId, BuildListEntry>,
  unitPlans: ReadonlyMap<BuildListEntryId, readonly PlannerRouteUnit[]>,
  conflictsById: ReadonlyMap<string, PlanConflict>,
  conflictIdsByUnitKey: ReadonlyMap<string, readonly string[]>,
  selectedPhysicalActionKeysByConflictId: ReadonlyMap<string, readonly string[]>,
  targets: readonly TargetWeapon[],
  master: PlannerInput['master'],
  engine: RngEngine,
  preferredSourceEntryIds: ReadonlySet<BuildListEntryId>,
): AppliedActionResult {
  const primaryEntry = entriesById.get(primary.entryId)
  if (!primaryEntry) {
    return {
      state: null,
      rejection: rejection(
        primary.entryId,
        primary.operation.type,
        'inventory_precondition_failed',
        'BuildListEntry disappeared from the validated search set.',
      ),
    }
  }
  const preconditionIssue = routeUnitPreconditionRejection(
    sourceState,
    primaryEntry,
    primary,
  )
  if (preconditionIssue) return { state: null, rejection: preconditionIssue }
  const state = cloneState(sourceState)
  const before = rngSnapshot(state)
  const appliedInventory = applyRouteInventoryEffect(
    state,
    primaryEntry,
    primary,
  )
  if (appliedInventory.rejection) {
    return { state: null, rejection: appliedInventory.rejection }
  }
  if (primary.counterStream !== null) setCurrentCounter(state, primary)
  // Having no Counter stream position is a Route property, not a runtime one: a
  // blind creation still forges a real weapon, so a confirmed Normal Counter
  // advances here (`docs/PLANNER_SPEC.md` 7.0.3).
  const blindAdvanced = advanceBlindNormalCreationCounters(
    state.currentNormalCounters,
    primary.operation,
    engine,
  )
  if (blindAdvanced !== null) state.currentNormalCounters = blindAdvanced
  const mutatedSourceId = sourceMutatedByOperation(primary.operation)
  if (mutatedSourceId !== null) {
    state.sourceMutationVersionByOwnedWeaponId[mutatedSourceId] =
      (state.sourceMutationVersionByOwnedWeaponId[mutatedSourceId] ?? 0) + 1
    state.inFlightExistingSourceByOwnedWeaponId[mutatedSourceId] = true
  }
  const progressedUnits = mergedProgressedEntries(
    sourceState,
    primary,
    entriesById,
    unitPlans,
    conflictsById,
    conflictIdsByUnitKey,
    selectedPhysicalActionKeysByConflictId,
  )
  const progressedRoutePositions: PlannerSearchAction['progressedRoutePositions'] =
    {}
  progressedUnits.forEach((unit) => {
    state.routeProgressByEntryId[unit.entryId] =
      (state.routeProgressByEntryId[unit.entryId] ?? 0) + 1
    progressedRoutePositions[unit.entryId] = unit.position
    const entry = entriesById.get(unit.entryId)
    if (entry && routeOutputChanges(entry, unit)) {
      const currentRuntime = state.routeRuntimeByEntryId[entry.id]
      state.routeRuntimeByEntryId[entry.id] = {
        hasUnregisteredGogmaOutput: true,
        transientRestorationBonusScope: nextTransientRestorationBonusScope(
          currentRuntime,
          unit.operation,
        ),
      }
      appliedInventory.effect.routeOutputChangedForEntryIds.push(entry.id)
    }
    const entryUnits = entry ? unitPlans.get(entry.id) : undefined
    const sourceId = entry ? existingRouteSourceId(entry) : null
    if (entry && sourceId !== null) {
      state.routeSourceVersionByEntryId[entry.id] =
        state.sourceMutationVersionByOwnedWeaponId[sourceId] ?? 0
    }
    if (
      entry &&
      entryUnits !== undefined &&
      isExistingGogmaRoute(entry) &&
      state.routeProgressByEntryId[entry.id] === entryUnits.length &&
      sourceId !== null
    ) {
      state.candidateReadySourceVersionByEntryId[entry.id] =
        state.routeSourceVersionByEntryId[entry.id]
    }
    // A unit that ends one of this Entry's selected checkpoints really put the
    // compromise weapon in the player's hands, so the hard constraint is
    // recorded as satisfied here. It is never recorded for a unit that was only
    // fast-forwarded: a checkpoint endpoint is never skippable, so it can only
    // arrive through a real executed action (`docs/PLANNER_SPEC.md` 7.5.3).
    if (entry && unit.position.unitIndex === unit.position.unitCount - 1) {
      const checkpoint = selectedCheckpointAtOperationIndex(
        entry,
        unit.position.operationIndex,
      )
      if (checkpoint) {
        const reached = state.reachedCheckpointOpportunityIdsByEntryId[entry.id] ?? []
        if (!reached.includes(checkpoint.opportunity.id)) {
          state.reachedCheckpointOpportunityIdsByEntryId[entry.id] = [
            ...reached,
            checkpoint.opportunity.id,
          ]
        }
      }
    }
  })
  // Counter stream progression only: a Route prefix another Entry's real
  // operation already passed advances silently here. It creates no Search
  // Action, no trace entry, no progressed Entry / Target record, no inventory
  // effect, and no route runtime output (docs/PLANNER_SPEC.md 7.0.2).
  fastForwardPlannerRouteProgress(state, unitPlans)
  const progressedBuildListEntryIds = progressedUnits.map(
    ({ entryId }) => entryId,
  )
  appliedInventory.effect.routeOutputChangedForEntryIds.sort(
    compareStableStrings,
  )
  const action: PlannerSearchAction = {
    kind: 'route_operation',
    actionType: primary.operation.type,
    primaryBuildListEntryId: primary.entryId,
    progressedBuildListEntryIds,
    progressedRoutePositions,
    routeOperation: structuredClone(primary.operation),
    ownedWeaponId: routeUnitOwnedWeaponId(primaryEntry, primary),
    plannerOnly: false,
    rngBefore: before,
    rngAfter: rngSnapshot(state),
    inventoryEffect: appliedInventory.effect,
    satisfactionChanges:
      mutatedSourceId !== null
        ? refreshTargetSatisfaction(state, targets, master)
        : [],
  }
  state.trace.push(action)
  // One physical action, so the switch is judged once. Sharing this action with
  // other Entries and fast-forwarding other Entries' passed Route prefixes both
  // stay invisible here: neither is an operation the player performs
  // (docs/PLANNER_SPEC.md 7.3).
  advancePlannerWeaponSwitchMetric(
    state,
    plannerWeaponOperationSubjectKey(primary.entryId, primary.operation),
  )
  // A silently fast-forwarded prefix is not counted: it progresses no Entry
  // here, so it never appears in `progressedBuildListEntryIds`
  // (docs/PLANNER_SPEC.md 7.0.2 / 7.4).
  advancePlannerPreferredSourceMetric(
    state,
    progressedBuildListEntryIds,
    preferredSourceEntryIds,
  )
  state.totalCost = state.trace.length
  return { state, rejection: null }
}

function targetCanUseEntry(
  state: PlannerSearchState,
  entry: BuildListEntry,
): boolean {
  return entryIsRelevantForState(state, entry)
}

function createReservedWeapon(
  entry: BuildListEntry,
  target: TargetWeapon,
  id: OwnedWeaponId,
): OwnedGogmaArtianWeapon {
  const candidate = entry.candidateSnapshot
  return {
    id,
    kind: 'gogma',
    name: '',
    weaponTypeId: target.weaponTypeId,
    elementId: target.elementId,
    restorationBonuses: structuredClone(candidate.finalBonuses),
    restorationBonusScope: candidate.restorationBonusScope,
    seriesSkillId: candidate.seriesSkillId,
    groupSkillId: candidate.groupSkillId,
    // Every Candidate is a canonical Ideal Candidate, so a newly generated
    // weapon is labelled Ideal and protected by default, exactly as the
    // existing Ideal contract requires (`docs/DATA_MODEL.md` 3.2).
    status: 'ideal',
    isProtected: true,
    memo: null,
    createdAt: candidate.createdAt,
    updatedAt: candidate.createdAt,
  }
}

function applyReserveAction(
  sourceState: PlannerSearchState,
  entry: BuildListEntry,
  target: TargetWeapon,
  dependencies: PlannerDependencies,
  targets: readonly TargetWeapon[],
  master: PlannerInput['master'],
  preferredSourceEntryIds: ReadonlySet<BuildListEntryId>,
): AppliedActionResult {
  if (!targetCanUseEntry(sourceState, entry)) {
    return {
      state: null,
      rejection: rejection(
        entry.id,
        'reserve_weapon',
        'candidate_already_satisfied',
        'The Target already holds an Ideal weapon.',
      ),
    }
  }
  // The user's selected compromise checkpoints are a hard constraint: a branch
  // that did not actually reach one of them may not finish this Entry, and the
  // Planner never resolves that by dropping or moving the selection
  // (`docs/PLANNER_SPEC.md` 7.5.3).
  if (
    !hasReachedEverySelectedCheckpoint(
      entry,
      sourceState.reachedCheckpointOpportunityIdsByEntryId[entry.id] ?? [],
    )
  ) {
    return {
      state: null,
      rejection: rejection(
        entry.id,
        'reserve_weapon',
        'selected_checkpoint_not_reached',
        'A compromise checkpoint selected for this BuildListEntry was not reached.',
      ),
    }
  }
  const route = entry.candidateSnapshot.route
  const state = cloneState(sourceState)
  const before = rngSnapshot(state)
  const effect = emptyInventoryEffect()
  let ownedWeaponId: OwnedWeaponId

  if (
    route.kind === 'normal_artian_to_gogma' ||
    route.kind === 'owned_normal_artian_to_gogma'
  ) {
    if (!state.routeRuntimeByEntryId[entry.id]?.hasUnregisteredGogmaOutput) {
      return {
        state: null,
        rejection: rejection(
          entry.id,
          'reserve_weapon',
          'inventory_precondition_failed',
          'The route has no unregistered Gogma output to secure.',
        ),
      }
    }
    ownedWeaponId = dependencies.idFactory.ownedWeaponId()
    const reserved = reserveWeaponId(state.simulatedInventory, ownedWeaponId)
    if (!reserved.isValid || reserved.inventory === null) {
      return {
        state: null,
        rejection: rejection(
          entry.id,
          'reserve_weapon',
          'inventory_precondition_failed',
          reserved.issues[0]?.message ?? 'OwnedWeapon ID reservation failed.',
        ),
      }
    }
    state.simulatedInventory = reserved.inventory
    effect.reservedOwnedWeaponIds.push(ownedWeaponId)
    const weapon = createReservedWeapon(entry, target, ownedWeaponId)
    const registered = addRegisteredWeapon(state.simulatedInventory, weapon)
    if (!registered.isValid || registered.inventory === null) {
      return {
        state: null,
        rejection: rejection(
          entry.id,
          'reserve_weapon',
          'inventory_precondition_failed',
          registered.issues[0]?.message ?? 'Candidate registration failed.',
        ),
      }
    }
    state.simulatedInventory = registered.inventory
    effect.addedOwnedWeaponIds.push(ownedWeaponId)
    state.securedOwnedWeaponIdByEntryId[entry.id] = ownedWeaponId
  } else {
    const sourceId = route.sourceOwnedWeaponId
    const source =
      sourceId === null
        ? null
        : findOwnedWeapon(state.simulatedInventory, sourceId)
    if (!source || source.kind !== 'gogma' || sourceId === null) {
      return {
        state: null,
        rejection: rejection(
          entry.id,
          'reserve_weapon',
          'inventory_precondition_failed',
          'The existing Gogma source is unavailable for Candidate reserve.',
        ),
      }
    }
    const readyVersion = state.candidateReadySourceVersionByEntryId[entry.id]
    const currentVersion = state.sourceMutationVersionByOwnedWeaponId[sourceId] ?? 0
    if (readyVersion === undefined || readyVersion !== currentVersion) {
      return {
        state: null,
        rejection: rejection(
          entry.id,
          'reserve_weapon',
          'inventory_precondition_failed',
          'The existing Gogma Candidate was superseded by a later source mutation.',
        ),
      }
    }
    ownedWeaponId = sourceId
    const updated: OwnedGogmaArtianWeapon = {
      ...source,
      restorationBonuses: structuredClone(entry.candidateSnapshot.finalBonuses),
      seriesSkillId: entry.candidateSnapshot.seriesSkillId,
      groupSkillId: entry.candidateSnapshot.groupSkillId,
      // The Candidate category becomes the label, and the stored protection
      // value is preserved exactly as PR #12 fixed.
      status: 'ideal',
    }
    const result = updateOwnedWeapon(state.simulatedInventory, updated)
    if (!result.isValid || result.inventory === null) {
      return {
        state: null,
        rejection: rejection(
          entry.id,
          'reserve_weapon',
          'inventory_precondition_failed',
          result.issues[0]?.message ?? 'Existing Gogma update failed.',
        ),
      }
    }
    state.simulatedInventory = result.inventory
    effect.updatedOwnedWeaponIds.push(ownedWeaponId)
    delete state.inFlightExistingSourceByOwnedWeaponId[ownedWeaponId]
    state.securedOwnedWeaponIdByEntryId[entry.id] = ownedWeaponId
  }
  const satisfactionChanges = refreshTargetSatisfaction(state, targets, master)
  state.selectedBuildListEntryIds = [
    ...state.selectedBuildListEntryIds,
    entry.id,
  ].sort(compareStableStrings)
  const action: PlannerSearchAction = {
    kind: 'reserve_candidate',
    actionType: 'reserve_weapon',
    primaryBuildListEntryId: entry.id,
    progressedBuildListEntryIds: [entry.id],
    progressedRoutePositions: {},
    routeOperation: null,
    ownedWeaponId,
    plannerOnly: true,
    rngBefore: before,
    rngAfter: rngSnapshot(state),
    inventoryEffect: effect,
    satisfactionChanges,
  }
  state.trace.push(action)
  advancePlannerPreferredSourceMetric(
    state,
    [entry.id],
    preferredSourceEntryIds,
  )
  state.totalCost = state.trace.length
  return { state, rejection: null }
}

function isComplete(
  state: PlannerSearchState,
  enabledTargetIds: readonly TargetWeaponId[],
): boolean {
  return (
    enabledTargetIds.length > 0 &&
    enabledTargetIds.every(
      (targetId) => state.targetSatisfaction[targetId]?.hasIdeal,
    )
  )
}

function betterState(
  current: PlannerSearchState | null,
  candidate: PlannerSearchState,
): PlannerSearchState {
  if (current === null) return candidate
  return comparePlannerSearchStates(candidate, current) < 0
    ? candidate
    : current
}

function addWarning(
  warnings: PlannerWarning[],
  kind: PlannerWarning['kind'],
  message: string,
) {
  if (warnings.some((warning) => warning.kind === kind && warning.message === message)) {
    return
  }
  warnings.push({ kind, message })
}

function detectCurrentPlannerConflicts(
  state: PlannerSearchState,
  allSearchEntries: readonly BuildListEntry[],
  allUnitPlans: ReadonlyMap<BuildListEntryId, readonly PlannerRouteUnit[]>,
  targets: readonly TargetWeapon[],
  resolutions: readonly PlannerConflictResolution[],
) {
  const entries = allSearchEntries.filter((entry) =>
    entryIsRelevantForState(state, entry),
  )
  const unitPlans = new Map(
    entries.flatMap((entry) => {
      const units = allUnitPlans.get(entry.id) ?? []
      const progress = state.routeProgressByEntryId[entry.id] ?? 0
      return [[entry.id, units.slice(progress)] as const]
    }),
  )
  return detectPlannerConflicts(entries, unitPlans, targets, state, resolutions, false)
}

function conflictCountByEntryId(
  conflicts: readonly PlanConflict[],
): Map<BuildListEntryId, number> {
  const counts = new Map<BuildListEntryId, number>()
  conflicts.forEach((conflict) => {
    conflict.buildListEntryIds.forEach((entryId) => {
      counts.set(entryId, (counts.get(entryId) ?? 0) + 1)
    })
  })
  return counts
}

function conflictResolutionWarnings(
  resolutions: readonly PlannerConflictResolution[],
  conflictsById: ReadonlyMap<string, PlanConflict>,
): PlannerWarning[] {
  return resolutions.flatMap((resolution) => {
    // The same refusal authority the detection applied, so a resolution that
    // targets a selected-checkpoint conflict is reported here too.
    const reason = conflictResolutionRefusalReason(
      resolution,
      conflictsById.get(resolution.conflictKey),
    )
    return reason === null
      ? []
      : [{ kind: 'invalid_conflict_resolution' as const, message: reason }]
  })
}

function initialFailureResult(
  input: PlannerInput,
  warnings: PlannerWarning[],
  issues: DomainValidationIssue[],
  excludedBuildListEntries: ExcludedBuildListEntry[],
): PlannerBeamSearchResult {
  return {
    bestState: null,
    conflicts: [],
    warnings,
    validationIssues: issues,
    excludedBuildListEntries,
    rejections: [],
    expandedStates: 0,
    completed: false,
    cancelled: false,
    // No expansion ran, so no `PlannerOptions` bound was touched. The reason
    // the input was rejected is reported by its own validation warnings.
    termination: createUnsearchedPlannerTermination(
      input.options,
      input.targetWeapons,
    ),
  }
}

export async function runPlannerBeamSearch(
  input: PlannerInput,
  dependencies: PlannerDependencies,
  executionOptions: PlannerExecutionOptions = {},
): Promise<PlannerBeamSearchResult> {
  const prepared = preparePlannerInitialContext(input, dependencies)
  if (prepared.status === 'invalid') {
    return initialFailureResult(
      input,
      prepared.warnings,
      prepared.issues,
      prepared.excludedBuildListEntries,
    )
  }
  const {
    allSearchEntries,
    allUnitPlans,
    entriesById,
    excludedBuildListEntries,
    initialConflictDetection,
    initialState,
    routeUnitCountByEntryId,
    targets,
    targetsById,
    validConflictResolutions,
    warnings,
  } = prepared.context
  const rejections = [...prepared.context.routePlanRejections]
  const rejectionKeys = new Set(rejections.map(rejectionKey))
  // Static Planner input, so it is derived once instead of per expansion.
  const preferredSourceEntryIds = collectPreferredSourceEntryIds(
    allSearchEntries,
    targetsById,
  )
  const scoreContext = {
    entries: allSearchEntries,
    targetsById,
    routeUnitCountByEntryId,
    conflictCountByEntryId: new Map<BuildListEntryId, number>(),
  }
  const discoveredConflictsById = new Map<string, PlanConflict>()
  const recordDetectedConflicts = (
    detection: ReturnType<typeof detectPlannerConflicts>,
  ) => {
    detection.conflicts.forEach((conflict) => {
      if (!discoveredConflictsById.has(conflict.id)) {
        discoveredConflictsById.set(conflict.id, conflict)
      }
    })
  }
  recordDetectedConflicts(initialConflictDetection)
  initialState.evaluationScore = evaluatePlannerSearchState(
    initialState,
    {
      ...scoreContext,
      conflictCountByEntryId: conflictCountByEntryId(
        initialConflictDetection.conflicts,
      ),
    },
  )
  const enabledTargetIds = targets.map(({ id }) => id)
  if (isComplete(initialState, enabledTargetIds)) {
    conflictResolutionWarnings(
      validConflictResolutions,
      discoveredConflictsById,
    ).forEach(({ kind, message }) => addWarning(warnings, kind, message))
    return {
      bestState: initialState,
      conflicts: [...discoveredConflictsById.values()].sort((left, right) =>
        compareStableStrings(left.id, right.id),
      ),
      warnings,
      validationIssues: [],
      excludedBuildListEntries,
      rejections,
      expandedStates: 0,
      completed: true,
      cancelled: false,
      termination: createPlannerSearchTermination({
        options: input.options,
        enabledTargetIds,
        bestState: initialState,
        expandedStates: 0,
        cancelled: false,
        reachedStepLimit: false,
        reachedExpandedLimit: false,
      }),
    }
  }

  let beam: PlannerSearchState[] = [initialState]
  let bestPartial: PlannerSearchState | null = initialState
  let bestComplete: PlannerSearchState | null = null
  let expandedStates = 0
  let reachedExpandedLimit = false
  let reachedStepLimit = false
  let cancelled = false
  let stop = false

  while (beam.length > 0 && !stop) {
    const successors: PlannerSearchState[] = []
    for (const state of beam.sort(comparePlannerSearchStates)) {
      if (executionOptions.shouldCancel?.()) {
        cancelled = true
        stop = true
        break
      }
      if (isComplete(state, enabledTargetIds)) {
        bestComplete = betterState(bestComplete, state)
        continue
      }
      if (state.trace.length >= input.options.maxPlanSteps) {
        reachedStepLimit = true
        continue
      }
      const stateConflictDetection = detectCurrentPlannerConflicts(
        state,
        allSearchEntries,
        allUnitPlans,
        targets,
        validConflictResolutions,
      )
      recordDetectedConflicts(stateConflictDetection)
      const conflictsById = new Map(
        stateConflictDetection.conflicts.map((conflict) => [conflict.id, conflict]),
      )
      const isBlockedByConflictResolution = (unit: PlannerRouteUnit) =>
        isUnitBlockedByConflictResolution(
          unit,
          conflictsById,
          stateConflictDetection.conflictIdsByUnitKey,
          stateConflictDetection.selectedPhysicalActionKeysByConflictId,
          (entryId) => {
            const selected = entriesById.get(entryId)
            return selected !== undefined && entryIsRelevantForState(state, selected)
          },
        )
      const requiredUnitsByCounterPosition =
        executableRequiredUnitsByCounterPosition(
          state,
          allSearchEntries,
          allUnitPlans,
          isBlockedByConflictResolution,
        )
      for (const entry of allSearchEntries) {
        if (state.selectedBuildListEntryIds.includes(entry.id)) continue
        if (!targetCanUseEntry(state, entry)) continue
        const units = allUnitPlans.get(entry.id) ?? []
        const progress = state.routeProgressByEntryId[entry.id] ?? 0
        let applied: AppliedActionResult
        if (progress < units.length) {
          const unit = units[progress]
          if (isBlockedByConflictResolution(unit)) {
            appendUniqueRejection(
              rejections,
              rejectionKeys,
              rejection(
                entry.id,
                unit.operation.type,
                'conflict_resolution_not_selected',
                'A valid local conflict resolution selected another BuildListEntry.',
              ),
            )
            continue
          }
          // Execution eligibility, not a conflict and not a score: another
          // Entry must physically run at this Counter position, and this unit
          // can fast-forward once it has (docs/PLANNER_SPEC.md 7.0.2). Running
          // this one first would only push the Counter past a required unit, so
          // the branch is never generated and no rejection is recorded.
          if (
            isSkippableUnitDominatedByRequiredUnit(
              unit,
              requiredUnitsByCounterPosition,
            )
          ) {
            continue
          }
          applied = applyRouteAction(
            state,
            unit,
            entriesById,
            allUnitPlans,
            conflictsById,
            stateConflictDetection.conflictIdsByUnitKey,
            stateConflictDetection.selectedPhysicalActionKeysByConflictId,
            targets,
            input.master,
            dependencies.rngEngine,
            preferredSourceEntryIds,
          )
        } else {
          const target = targetsById.get(entry.targetWeaponId)
          if (!target) continue
          applied = applyReserveAction(
            state,
            entry,
            target,
            dependencies,
            targets,
            input.master,
            preferredSourceEntryIds,
          )
        }
        if (applied.rejection) {
          appendUniqueRejection(
            rejections,
            rejectionKeys,
            applied.rejection,
          )
          continue
        }
        if (applied.state === null) continue
        if (expandedStates >= input.options.maxExpandedStates) {
          reachedExpandedLimit = true
          stop = true
          break
        }
        const successorConflictDetection = detectCurrentPlannerConflicts(
          applied.state,
          allSearchEntries,
          allUnitPlans,
          targets,
          validConflictResolutions,
        )
        recordDetectedConflicts(successorConflictDetection)
        applied.state.evaluationScore = evaluatePlannerSearchState(applied.state, {
          ...scoreContext,
          conflictCountByEntryId: conflictCountByEntryId(
            successorConflictDetection.conflicts,
          ),
        })
        if (applied.state.trace.length >= input.options.maxPlanSteps) {
          reachedStepLimit = true
        }
        successors.push(applied.state)
        expandedStates += 1
        executionOptions.onProgress?.({
          expandedStates,
          maxExpandedStates: input.options.maxExpandedStates,
        })
        bestPartial = betterState(bestPartial, applied.state)
        if (isComplete(applied.state, enabledTargetIds)) {
          bestComplete = betterState(bestComplete, applied.state)
        }
        if (expandedStates >= input.options.maxExpandedStates) {
          reachedExpandedLimit = true
          stop = true
          break
        }
        if (executionOptions.shouldCancel?.()) {
          cancelled = true
          stop = true
          break
        }
      }
      if (stop) break
    }
    const deduplicated = new Map<string, PlannerSearchState>()
    successors.forEach((state) => {
      const key = createPlannerSearchStateSemanticKey(state)
      const current = deduplicated.get(key)
      if (!current || comparePlannerSearchStates(state, current) < 0) {
        deduplicated.set(key, state)
      }
    })
    beam = [...deduplicated.values()]
      .sort(comparePlannerSearchStates)
      .slice(0, input.options.beamWidth)
    if (beam.length === 0) break
    await executionOptions.yieldControl?.()
    if (executionOptions.shouldCancel?.()) {
      cancelled = true
      break
    }
  }

  if (reachedStepLimit) {
    addWarning(
      warnings,
      'max_steps_reached',
      `Planner reached maxPlanSteps (${input.options.maxPlanSteps}).`,
    )
  }
  if (reachedExpandedLimit) {
    addWarning(
      warnings,
      'max_expanded_states_reached',
      `Planner reached maxExpandedStates (${input.options.maxExpandedStates}).`,
    )
  }
  if (
    rejections.some(({ reason }) => reason === 'protected_destructive_use')
  ) {
    addWarning(
      warnings,
      'protected_weapon_required',
      'One or more destructive branches require a protected weapon and were not generated.',
    )
  }
  const bestState = bestComplete ?? bestPartial
  conflictResolutionWarnings(
    validConflictResolutions,
    discoveredConflictsById,
  ).forEach(({ kind, message }) => addWarning(warnings, kind, message))
  return {
    bestState,
    conflicts: [...discoveredConflictsById.values()].sort((left, right) =>
      compareStableStrings(left.id, right.id),
    ),
    warnings,
    validationIssues: [],
    excludedBuildListEntries,
    rejections: rejections.sort((left, right) =>
      compareStableStrings(rejectionKey(left), rejectionKey(right)),
    ),
    expandedStates,
    completed:
      bestState !== null && isComplete(bestState, enabledTargetIds),
    cancelled,
    termination: createPlannerSearchTermination({
      options: input.options,
      enabledTargetIds,
      bestState,
      expandedStates,
      cancelled,
      reachedStepLimit,
      reachedExpandedLimit,
    }),
  }
}
