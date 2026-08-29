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
import {
  addRegisteredWeapon,
  canUseAsDestructiveGogmaSource,
  canUseAsResetSkillsSource,
  consumeMaterialWeapon,
  consumeOwnedNormalForConversion,
  findOwnedWeapon,
  reserveWeaponId,
  updateOwnedWeapon,
} from './simulatedInventory'
import {
  detectPlannerConflicts,
  isUnitBlockedByConflictResolution,
} from './plannerConflictDetection'
import {
  arePlannerRouteUnitsShareable,
  createPlannerRouteUnitPlans,
  routeUnitOwnedWeaponId,
  type PlannerRouteUnit,
} from './plannerRouteProgress'
import {
  comparePlannerSearchStates,
  createPlannerSearchStateSemanticKey,
  evaluatePlannerSearchState,
} from './plannerScoring'
import { createInitialPlannerSearchState } from './plannerInitialState'
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
} from './plannerTypes'
import { validatePlannerInput } from './plannerValidation'

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

function currentCounter(
  state: PlannerSearchState,
  unit: PlannerRouteUnit,
): number | null {
  if (unit.counterStream === 'gogma') {
    return state.currentRngState.gogmaCounter.value
  }
  if (unit.counterStream === 'skill') {
    return state.currentRngState.skillCounter.value
  }
  if (unit.counterStream === 'normal') {
    return (
      state.currentNormalCounters.find(({ id }) => id === unit.counterId)
        ?.counter ?? null
    )
  }
  return null
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
  const current = currentCounter(state, unit)
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
      `The current counter ${current} has already passed required position ${unit.counterBefore}.`,
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
  if (
    operation.type === 'reset_bonuses' ||
    operation.type === 'keep_bonuses'
  ) {
    const source = findOwnedWeapon(
      state.simulatedInventory,
      operation.sourceOwnedWeaponId,
    )
    if (!source) {
      return rejection(
        entry.id,
        operation.type,
        'inventory_precondition_failed',
        `OwnedWeapon '${operation.sourceOwnedWeaponId}' is unavailable.`,
      )
    }
    return canUseAsDestructiveGogmaSource(source)
      ? null
      : protectedRejection(
          unit,
          `OwnedWeapon '${operation.sourceOwnedWeaponId}' is protected or is not a Gogma source.`,
        )
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
    return canUseAsResetSkillsSource(source)
      ? null
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
  if (operation.type === 'use_weapon_as_material') {
    const source = findOwnedWeapon(
      state.simulatedInventory,
      operation.ownedWeaponId,
    )
    if (!source) {
      return rejection(
        entry.id,
        operation.type,
        'inventory_precondition_failed',
        `Concrete material OwnedWeapon '${operation.ownedWeaponId}' is unavailable.`,
      )
    }
    if (source.isProtected) {
      return protectedRejection(
        unit,
        `Concrete material OwnedWeapon '${operation.ownedWeaponId}' is protected.`,
      )
    }
    if (source.kind !== 'gogma' || source.status !== 'material') {
      return rejection(
        entry.id,
        operation.type,
        'inventory_precondition_failed',
        `Concrete OwnedWeapon '${operation.ownedWeaponId}' is not an unprotected Material Gogma weapon.`,
      )
    }
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
  if (operation.type === 'use_weapon_as_material') {
    const consumed = consumeMaterialWeapon(
      state.simulatedInventory,
      operation.ownedWeaponId,
    )
    if (!consumed.isValid || consumed.inventory === null) {
      return {
        rejection: rejection(
          entry.id,
          operation.type,
          'inventory_precondition_failed',
          consumed.issues[0]?.message ?? 'Material consumption failed.',
        ),
        effect,
      }
    }
    state.simulatedInventory = consumed.inventory
    state.consumedMaterialWeaponCount += 1
    effect.removedOwnedWeaponIds.push(operation.ownedWeaponId)
    return { rejection: null, effect }
  }
  if (
    operation.type === 'reset_bonuses' ||
    operation.type === 'keep_bonuses' ||
    (operation.type === 'reset_skills' &&
      operation.sourceOwnedWeaponId !== null)
  ) {
    const sourceId = operation.sourceOwnedWeaponId
    if (sourceId !== null) effect.updatedOwnedWeaponIds.push(sourceId)
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
    unit.operation.type === 'reset_skills' &&
    unit.operation.sourceOwnedWeaponId === null
  )
}

function mergedProgressedEntries(
  state: PlannerSearchState,
  primary: PlannerRouteUnit,
  entriesById: ReadonlyMap<BuildListEntryId, BuildListEntry>,
  unitPlans: ReadonlyMap<BuildListEntryId, readonly PlannerRouteUnit[]>,
  conflictsById: ReadonlyMap<string, PlanConflict>,
  conflictIdsByUnitKey: ReadonlyMap<string, readonly string[]>,
): PlannerRouteUnit[] {
  const shared = [primary]
  if (!primary.shareable) return shared
  unitPlans.forEach((units, entryId) => {
    if (entryId === primary.entryId) return
    if (state.selectedBuildListEntryIds.includes(entryId)) return
    const entry = entriesById.get(entryId)
    if (!entry) return
    const satisfaction = state.targetSatisfaction[entry.targetWeaponId]
    if (
      satisfaction?.hasIdeal ||
      (satisfaction?.hasPractical &&
        entry.candidateSnapshot.category !== 'ideal')
    ) {
      return
    }
    const progress = state.routeProgressByEntryId[entryId] ?? 0
    const next = units[progress]
    if (
      next &&
      arePlannerRouteUnitsShareable(primary, next) &&
      !isUnitBlockedByConflictResolution(
        next,
        conflictsById,
        conflictIdsByUnitKey,
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
  const counterIssue = counterPreconditionRejection(sourceState, primary)
  if (counterIssue) return { state: null, rejection: counterIssue }
  const inventoryIssue = inventoryPreconditionRejection(
    sourceState,
    primaryEntry,
    primary,
  )
  if (inventoryIssue) return { state: null, rejection: inventoryIssue }
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
  const progressedUnits = mergedProgressedEntries(
    sourceState,
    primary,
    entriesById,
    unitPlans,
    conflictsById,
    conflictIdsByUnitKey,
  )
  const progressedRoutePositions: PlannerSearchAction['progressedRoutePositions'] =
    {}
  progressedUnits.forEach((unit) => {
    state.routeProgressByEntryId[unit.entryId] =
      (state.routeProgressByEntryId[unit.entryId] ?? 0) + 1
    progressedRoutePositions[unit.entryId] = unit.position
    const entry = entriesById.get(unit.entryId)
    if (entry && routeOutputChanges(entry, unit)) {
      state.routeRuntimeByEntryId[entry.id] = {
        hasUnregisteredGogmaOutput: true,
      }
      appliedInventory.effect.routeOutputChangedForEntryIds.push(entry.id)
    }
  })
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
    satisfactionChanges: [],
  }
  state.trace.push(action)
  state.totalCost = state.trace.length + state.consumedMaterialWeaponCount * 10
  return { state, rejection: null }
}

function targetCanUseEntry(
  state: PlannerSearchState,
  entry: BuildListEntry,
): boolean {
  const satisfaction = state.targetSatisfaction[entry.targetWeaponId]
  if (!satisfaction || satisfaction.hasIdeal) return false
  return (
    !satisfaction.hasPractical ||
    entry.candidateSnapshot.category === 'ideal'
  )
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
    seriesSkillId: candidate.seriesSkillId,
    groupSkillId: candidate.groupSkillId,
    status: candidate.category,
    isProtected: true,
    relatedTargetWeaponIds: [entry.targetWeaponId],
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
): AppliedActionResult {
  if (!targetCanUseEntry(sourceState, entry)) {
    return {
      state: null,
      rejection: rejection(
        entry.id,
        'reserve_weapon',
        'candidate_already_satisfied',
        'The Target no longer needs this Candidate category.',
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
    ownedWeaponId = sourceId
    const updated: OwnedGogmaArtianWeapon = {
      ...source,
      restorationBonuses: structuredClone(entry.candidateSnapshot.finalBonuses),
      seriesSkillId: entry.candidateSnapshot.seriesSkillId,
      groupSkillId: entry.candidateSnapshot.groupSkillId,
      status: entry.candidateSnapshot.category,
      isProtected: true,
      relatedTargetWeaponIds: [
        ...new Set([...source.relatedTargetWeaponIds, entry.targetWeaponId]),
      ],
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
    state.securedOwnedWeaponIdByEntryId[entry.id] = ownedWeaponId
  }
  const previous = state.targetSatisfaction[entry.targetWeaponId] ?? {
    hasPractical: false,
    hasIdeal: false,
  }
  const next = {
    hasPractical: true,
    hasIdeal:
      previous.hasIdeal || entry.candidateSnapshot.category === 'ideal',
  }
  state.targetSatisfaction[entry.targetWeaponId] = next
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
    candidateCategory: entry.candidateSnapshot.category,
    rngBefore: before,
    rngAfter: rngSnapshot(state),
    inventoryEffect: effect,
    satisfactionChanges: [{
      targetWeaponId: entry.targetWeaponId,
      before: previous,
      after: next,
    }],
  }
  state.trace.push(action)
  state.totalCost = state.trace.length + state.consumedMaterialWeaponCount * 10
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

function initialFailureResult(
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
  }
}

export async function runPlannerBeamSearch(
  input: PlannerInput,
  dependencies: PlannerDependencies,
  executionOptions: PlannerExecutionOptions = {},
): Promise<PlannerBeamSearchResult> {
  const validation = validatePlannerInput(input, dependencies)
  const warnings = [...validation.warnings]
  if (!validation.isValid) {
    return initialFailureResult(
      warnings,
      validation.issues,
      validation.excludedBuildListEntries,
    )
  }
  const initial = createInitialPlannerSearchState(
    input,
    validation.validBuildListEntries,
  )
  warnings.push(...initial.warnings)
  if (!initial.isValid || initial.state === null) {
    return initialFailureResult(
      warnings,
      initial.issues,
      validation.excludedBuildListEntries,
    )
  }
  const routePlans = createPlannerRouteUnitPlans(
    validation.validBuildListEntries.map(({ entry }) => entry),
    dependencies.rngEngine,
  )
  const rejections = [...routePlans.rejections]
  const rejectionKeys = new Set(rejections.map(rejectionKey))
  const entries = validation.validBuildListEntries
    .map(({ entry }) => entry)
    .filter((entry) => routePlans.unitPlans.has(entry.id))
    .sort((left, right) => compareStableStrings(left.id, right.id))
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]))
  const targets = input.targetWeapons
    .filter(({ isEnabled }) => isEnabled)
    .sort((left, right) => compareStableStrings(left.id, right.id))
  const targetsById = new Map(targets.map((target) => [target.id, target]))
  const conflictDetection = detectPlannerConflicts(
    entries,
    routePlans.unitPlans,
    targets,
    initial.state,
    validation.validConflictResolutions,
  )
  warnings.push(...conflictDetection.warnings)
  const conflictsById = new Map(
    conflictDetection.conflicts.map((conflict) => [conflict.id, conflict]),
  )
  const conflictCountByEntryId = new Map<BuildListEntryId, number>()
  conflictDetection.conflicts.forEach((conflict) => {
    conflict.buildListEntryIds.forEach((entryId) => {
      conflictCountByEntryId.set(
        entryId,
        (conflictCountByEntryId.get(entryId) ?? 0) + 1,
      )
    })
  })
  const routeUnitCountByEntryId = new Map(
    [...routePlans.unitPlans].map(([entryId, units]) => [
      entryId,
      units.length,
    ]),
  )
  const scoreContext = {
    entries,
    targetsById,
    routeUnitCountByEntryId,
    conflictCountByEntryId,
  }
  const initialState = cloneState(initial.state)
  Object.keys(initialState.routeProgressByEntryId).forEach((entryId) => {
    if (!entriesById.has(entryId as BuildListEntryId)) {
      delete initialState.routeProgressByEntryId[entryId]
      delete initialState.routeRuntimeByEntryId[entryId]
    }
  })
  initialState.evaluationScore = evaluatePlannerSearchState(
    initialState,
    scoreContext,
  )
  const enabledTargetIds = targets.map(({ id }) => id)
  if (isComplete(initialState, enabledTargetIds)) {
    return {
      bestState: initialState,
      conflicts: conflictDetection.conflicts,
      warnings,
      validationIssues: [],
      excludedBuildListEntries: validation.excludedBuildListEntries,
      rejections,
      expandedStates: 0,
      completed: true,
      cancelled: false,
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
      for (const entry of entries) {
        if (state.selectedBuildListEntryIds.includes(entry.id)) continue
        if (!targetCanUseEntry(state, entry)) continue
        const units = routePlans.unitPlans.get(entry.id) ?? []
        const progress = state.routeProgressByEntryId[entry.id] ?? 0
        let applied: AppliedActionResult
        if (progress < units.length) {
          const unit = units[progress]
          if (
            isUnitBlockedByConflictResolution(
              unit,
              conflictsById,
              conflictDetection.conflictIdsByUnitKey,
            )
          ) {
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
          applied = applyRouteAction(
            state,
            unit,
            entriesById,
            routePlans.unitPlans,
            conflictsById,
            conflictDetection.conflictIdsByUnitKey,
          )
        } else {
          const target = targetsById.get(entry.targetWeaponId)
          if (!target) continue
          applied = applyReserveAction(state, entry, target, dependencies)
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
        applied.state.evaluationScore = evaluatePlannerSearchState(
          applied.state,
          scoreContext,
        )
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
    rejections.some(
      ({ actionType, reason }) =>
        actionType === 'use_weapon_as_material' &&
        reason === 'inventory_precondition_failed',
    )
  ) {
    addWarning(
      warnings,
      'material_weapon_shortage',
      'A concrete Candidate material weapon was unavailable. No replenishment branch was generated because v1 has no verified general material weapon type/element selection rule.',
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
  return {
    bestState,
    conflicts: conflictDetection.conflicts,
    warnings,
    validationIssues: [],
    excludedBuildListEntries: validation.excludedBuildListEntries,
    rejections: rejections.sort((left, right) =>
      compareStableStrings(rejectionKey(left), rejectionKey(right)),
    ),
    expandedStates,
    completed:
      bestState !== null && isComplete(bestState, enabledTargetIds),
    cancelled,
  }
}
