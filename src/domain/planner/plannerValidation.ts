import type {
  BuildListEntry,
  DomainValidationIssue,
  DomainValidationResult,
  InventoryChange,
  OwnedGogmaArtianWeapon,
  OwnedWeapon,
  OwnedWeaponId,
  PlanStep,
  RestorationBonusSet,
  TargetWeapon,
} from '../models/publicTypes'
import {
  isBlindCreateNormalArtianOperation,
  stableStringify,
  validateBuildCandidate,
  validateBuildRoute,
  validateOwnedWeapon,
} from '../models/publicTypes'
import { evaluateBuildListEntryStaleness } from '../buildList'
import { validateTargetPreferredOwnedWeapons } from '../target'
import { collectReferencedOwnedWeaponIds } from '../models/hashing'
import { deriveRngCapabilities } from '../rng/capabilities'
import type { RngPredictionUnsupportedReason } from '../rng/rngEngine'
import {
  getPlannerPredictionSupport,
  type PlannerPredictionSupportCache,
} from './plannerPredictionSupport'
import type {
  ExcludedBuildListEntry,
  PlannerConflictResolution,
  PlannerDependencies,
  PlannerInput,
  PlannerMaterialAssignment,
  PlannerMaterialRequirement,
  PlannerOptions,
  PlannerWarning,
  ValidatedBuildListEntry,
} from './plannerTypes'
import { plannerWarningKinds } from './plannerTypes'

export interface PlannerInputValidationResult extends DomainValidationResult {
  validConflictResolutions: PlannerConflictResolution[]
  validBuildListEntries: ValidatedBuildListEntry[]
  excludedBuildListEntries: ExcludedBuildListEntry[]
  warnings: PlannerWarning[]
}

function issue(
  path: string,
  code: DomainValidationIssue['code'],
  message: string,
): DomainValidationIssue {
  return { path, code, message }
}

function positiveIntegerIssue(value: number, path: string) {
  return Number.isInteger(value) && value >= 1
    ? null
    : issue(path, 'invalid_integer', `${path} must be an integer greater than or equal to 1.`)
}

export function validatePlannerOptions(
  options: PlannerOptions,
): DomainValidationResult {
  const issues = [
    positiveIntegerIssue(options.maxPlanSteps, 'maxPlanSteps'),
    positiveIntegerIssue(options.beamWidth, 'beamWidth'),
    positiveIntegerIssue(options.maxExpandedStates, 'maxExpandedStates'),
  ].filter((entry): entry is DomainValidationIssue => entry !== null)
  if ('preferPracticalBeforeIdeal' in options) {
    issues.push(issue(
      'preferPracticalBeforeIdeal',
      'invalid_structure',
      'Practical-before-Ideal priority is fixed in v1 and is not a Planner option.',
    ))
  }
  return { isValid: issues.length === 0, issues }
}

export function validatePlannerWarning(
  warning: PlannerWarning,
): DomainValidationResult {
  const issues: DomainValidationIssue[] = []
  if (!plannerWarningKinds.includes(warning.kind)) {
    issues.push(issue('kind', 'invalid_literal', 'Planner warning kind is invalid.'))
  }
  if (warning.message.trim().length === 0) {
    issues.push(issue('message', 'invalid_structure', 'Planner warning message cannot be empty.'))
  }
  return { isValid: issues.length === 0, issues }
}

export function validatePlannerMaterialAssignments(
  requirements: readonly PlannerMaterialRequirement[],
  assignments: readonly PlannerMaterialAssignment[],
): DomainValidationResult {
  const issues: DomainValidationIssue[] = []
  const requirementIds = new Set<string>()
  requirements.forEach((requirement, index) => {
    if (requirement.id.trim().length === 0 || requirementIds.has(requirement.id)) {
      issues.push(issue(`requirements[${index}].id`, 'invalid_id', 'Planner material requirement IDs must be non-empty and unique.'))
    }
    requirementIds.add(requirement.id)
    if (requirement.purpose !== 'gogma_rng_progression') {
      issues.push(issue(`requirements[${index}].purpose`, 'invalid_literal', 'Planner material purpose is invalid.'))
    }
  })
  const assignedRequirementIds = new Set<string>()
  const assignedWeaponIds = new Set<OwnedWeaponId>()
  assignments.forEach((assignment, index) => {
    if (!requirementIds.has(assignment.requirementId)) {
      issues.push(issue(`assignments[${index}].requirementId`, 'invalid_reference', 'Material assignment must reference an existing Planner requirement.'))
    }
    if (assignedRequirementIds.has(assignment.requirementId)) {
      issues.push(issue(`assignments[${index}].requirementId`, 'invalid_state', 'A Planner material requirement can be assigned only once.'))
    }
    if (assignedWeaponIds.has(assignment.ownedWeaponId)) {
      issues.push(issue(`assignments[${index}].ownedWeaponId`, 'invalid_state', 'One material weapon cannot satisfy multiple consumption requirements.'))
    }
    assignedRequirementIds.add(assignment.requirementId)
    assignedWeaponIds.add(assignment.ownedWeaponId)
  })
  return { isValid: issues.length === 0, issues }
}

function invalidResolutionWarning(
  resolution: PlannerConflictResolution,
  reason: string,
): PlannerWarning {
  return {
    kind: 'invalid_conflict_resolution',
    message: `Conflict resolution '${resolution.conflictKey}' cannot use BuildListEntry '${resolution.selectedBuildListEntryId}': ${reason}`,
  }
}

function compareStableStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function entryWarning(
  kind: PlannerWarning['kind'],
  entry: BuildListEntry,
  message: string,
): PlannerWarning {
  return { kind, message: `BuildListEntry '${entry.id}' ${message}` }
}

function appendUniqueEntryWarning(
  warnings: PlannerWarning[], warningKeys: Set<string>, entry: BuildListEntry,
  kind: PlannerWarning['kind'], message: string,
) {
  const key = `${kind}:${entry.id}`
  if (warningKeys.has(key)) return
  warningKeys.add(key)
  warnings.push(entryWarning(kind, entry, message))
}

interface EntryPredictionSupportFailure {
  operationType: 'normal_artian' | 'skill' | 'gogma_reset' | 'gogma_keep'
  reason: RngPredictionUnsupportedReason
}

function nextBonusOperation(
  operations: BuildListEntry['candidateSnapshot']['route']['operations'],
  operationIndex: number,
): 'reset_bonuses' | 'keep_bonuses' | null {
  for (let index = operationIndex + 1; index < operations.length; index += 1) {
    const type = operations[index].type
    if (type === 'reset_bonuses' || type === 'keep_bonuses') return type
  }
  return null
}

function initialRouteBonuses(
  input: PlannerInput,
  entry: BuildListEntry,
): RestorationBonusSet | null {
  const sourceId = entry.candidateSnapshot.route.sourceOwnedWeaponId
  if (sourceId === null) return null
  const source = input.ownedWeapons.find(({ id }) => id === sourceId)
  return source ? structuredClone(source.restorationBonuses) : null
}

/**
 * Checks every static semantic input and deterministically advances bonus state
 * only when a later Keep needs the preceding Reset/Keep result as its input.
 * It never reconstructs or rewrites the saved RouteOperation sequence.
 */
function entryPredictionSupportFailure(
  input: PlannerInput,
  dependencies: PlannerDependencies,
  entry: BuildListEntry,
  target: TargetWeapon,
  cache: PlannerPredictionSupportCache,
): EntryPredictionSupportFailure | null {
  const engine = dependencies.rngEngine
  const operations = entry.candidateSnapshot.route.operations
  let currentBonuses = initialRouteBonuses(input, entry)

  const query = (
    supportInput: Parameters<typeof getPlannerPredictionSupport>[1],
  ): EntryPredictionSupportFailure | null => {
    const support = getPlannerPredictionSupport(engine, supportInput, cache)
    return support.supported
      ? null
      : { operationType: supportInput.type, reason: support.reason }
  }

  for (let operationIndex = 0; operationIndex < operations.length; operationIndex += 1) {
    const operation = operations[operationIndex]
    if (operation.type === 'create_normal_artian') {
      // A blind creation predicts nothing, so it queries no Normal Artian
      // prediction support (`docs/SEARCH_SPEC.md` 6.1.1).
      if (isBlindCreateNormalArtianOperation(operation)) continue
      const failure = query({
        type: 'normal_artian',
        weaponTypeId: operation.weaponTypeId,
        elementId: target.elementId,
        rarity: operation.rarity,
      })
      if (failure) return failure
      continue
    }
    if (
      operation.type === 'convert_normal_to_gogma' ||
      operation.type === 'reset_skills'
    ) {
      const failure = query({
        type: 'skill',
        weaponTypeId: operation.type === 'convert_normal_to_gogma'
          ? operation.weaponTypeId
          : target.weaponTypeId,
        elementId: target.elementId,
      })
      if (failure) return failure
      continue
    }
    if (operation.type === 'reset_bonuses') {
      const failure = query({
        type: 'gogma_reset',
        weaponTypeId: target.weaponTypeId,
        elementId: target.elementId,
        master: input.master,
      })
      if (failure) return failure
      if (nextBonusOperation(operations, operationIndex) === 'keep_bonuses') {
        currentBonuses = engine.predictGogmaBonus({
          baseSeed: input.rngState.baseSeed.value!,
          gogmaCounter: operation.gogmaCounterBefore,
          weaponTypeId: target.weaponTypeId,
          elementId: target.elementId,
          operation: { type: 'reset_bonuses' },
          master: input.master,
        })
      }
      continue
    }
    if (operation.type === 'keep_bonuses') {
      if (currentBonuses === null) {
        return {
          operationType: 'gogma_keep',
          reason: 'unsupported_current_bonus',
        }
      }
      const failure = query({
        type: 'gogma_keep',
        weaponTypeId: target.weaponTypeId,
        elementId: target.elementId,
        currentBonuses,
      })
      if (failure) return failure
      if (nextBonusOperation(operations, operationIndex) === 'keep_bonuses') {
        currentBonuses = engine.predictGogmaBonus({
          baseSeed: input.rngState.baseSeed.value!,
          gogmaCounter: operation.gogmaCounterBefore,
          weaponTypeId: target.weaponTypeId,
          elementId: target.elementId,
          operation: {
            type: 'keep_bonuses',
            currentBonuses: structuredClone(currentBonuses),
          },
          master: input.master,
        })
      }
    }
  }
  return null
}

function currentEntryEligibility(
  input: PlannerInput,
  dependencies: PlannerDependencies,
  entry: BuildListEntry,
  supportCache: PlannerPredictionSupportCache,
): { valid: ValidatedBuildListEntry | null; reason: string; warningKind: PlannerWarning['kind'] } {
  const target = input.targetWeapons.find(({ id }) => id === entry.targetWeaponId) ?? null
  const staleness = evaluateBuildListEntryStaleness(entry, {
    target, rngState: input.rngState, normalCounters: input.normalCounters,
    ownedWeapons: input.ownedWeapons, calculationContext: input.calculationContext,
  })
  if (target === null || !target.isEnabled) {
    return { valid: null, reason: target === null ? 'references a missing TargetWeapon.' : 'references a disabled TargetWeapon.', warningKind: 'build_list_entry_stale' }
  }
  if (dependencies.rngEngine.version !== input.calculationContext.rngEngineVersion) {
    return { valid: null, reason: 'uses an RNG Engine incompatible with CalculationContext.', warningKind: 'calculation_context_incompatible' }
  }

  if (!validateBuildCandidate(entry.candidateSnapshot).isValid) {
    return { valid: null, reason: 'has an invalid Candidate snapshot.', warningKind: 'build_list_entry_stale' }
  }
  for (const ownedWeaponId of collectReferencedOwnedWeaponIds(entry.candidateSnapshot.route)) {
    const weapon = input.ownedWeapons.find(({ id }) => id === ownedWeaponId)
    if (!weapon || !validateOwnedWeapon(weapon).isValid) {
      return { valid: null, reason: `references an invalid or missing OwnedWeapon '${ownedWeaponId}'.`, warningKind: 'build_list_entry_stale' }
    }
  }
  const routeValidation = validateBuildRoute(
    entry.candidateSnapshot.route,
    input.ownedWeapons,
  )
  if (!routeValidation.isValid) {
    return { valid: null, reason: 'requires an invalid or no-longer-executable BuildRoute.', warningKind: routeValidation.issues.some(({ code }) => code === 'protected_destructive_use') ? 'protected_weapon_required' : 'build_list_entry_stale' }
  }
  if (staleness.isStale) {
    const contextChanged = staleness.staleReasons.includes(
      'calculation_context_changed',
    )
    return {
      valid: null,
      reason: `is stale (${staleness.staleReasons.join(', ')}).`,
      warningKind: contextChanged
        ? 'calculation_context_incompatible'
        : 'build_list_entry_stale',
    }
  }
  const capabilities = deriveRngCapabilities(
    input.rngState,
    input.normalCounters,
    entry.candidateSnapshot.route.operations,
    dependencies.rngEngine.capabilities,
  )
  if (!capabilities.canRunPlanner) {
    return { valid: null, reason: `requires unavailable RNG capability (${capabilities.missingRequirements.join(', ')}).`, warningKind: 'rng_state_missing' }
  }
  const unsupported = entryPredictionSupportFailure(
    input,
    dependencies,
    entry,
    target,
    supportCache,
  )
  if (unsupported) {
    return {
      valid: null,
      reason: `requires unsupported RNG input (${unsupported.operationType}: ${unsupported.reason}).`,
      warningKind: 'rng_prediction_unsupported',
    }
  }
  return { valid: { entry, missingRngRequirements: [...capabilities.missingRequirements] }, reason: '', warningKind: 'build_list_entry_stale' }
}

export function validatePlannerInput(
  input: PlannerInput,
  dependencies: PlannerDependencies,
): PlannerInputValidationResult {
  const options = validatePlannerOptions(input.options)
  const issues = [...options.issues]
  const warnings: PlannerWarning[] = []
  const validConflictResolutions: PlannerConflictResolution[] = []
  const warningKeys = new Set<string>()
  const supportCache: PlannerPredictionSupportCache = new Map()
  const eligibilityByEntryId = new Map<string, ReturnType<typeof currentEntryEligibility>>()
  const validBuildListEntries: ValidatedBuildListEntry[] = []
  const excludedBuildListEntries: ExcludedBuildListEntry[] = []

  const entriesByStableId = [...input.buildListEntries]
    .sort((left, right) => compareStableStrings(left.id, right.id))
  entriesByStableId.forEach((entry) => {
      const eligibility = currentEntryEligibility(
        input,
        dependencies,
        entry,
        supportCache,
      )
      eligibilityByEntryId.set(entry.id, eligibility)
      if (eligibility.valid) {
        validBuildListEntries.push(eligibility.valid)
        return
      }
      excludedBuildListEntries.push({ entry, reason: eligibility.reason })
      appendUniqueEntryWarning(warnings, warningKeys, entry, eligibility.warningKind, eligibility.reason)
    })

  // The same collection-level authority the save Service and Candidate Search
  // use, so a preference pointing at a missing, incompatible, protected, or
  // double-claimed weapon fails the Planner input closed rather than silently
  // preferring nothing (`docs/DATA_MODEL.md` 8.5).
  issues.push(
    ...validateTargetPreferredOwnedWeapons(
      input.targetWeapons,
      input.ownedWeapons,
    ).issues,
  )
  if (input.buildListEntries.length === 0) {
    warnings.push({ kind: 'no_build_list_entries', message: 'No BuildListEntry is available for Planner input.' })
  }
  const conflictKeys = new Set<string>()

  input.conflictResolutions.forEach((resolution, index) => {
    const path = `conflictResolutions[${index}]`
    if (resolution.conflictKey.trim().length === 0) {
      issues.push(issue(`${path}.conflictKey`, 'invalid_id', 'conflictKey cannot be empty.'))
      return
    }
    if (conflictKeys.has(resolution.conflictKey)) {
      issues.push(issue(`${path}.conflictKey`, 'invalid_id', 'conflictKey must be unique.'))
      return
    }
    conflictKeys.add(resolution.conflictKey)
    const eligibility = eligibilityByEntryId.get(resolution.selectedBuildListEntryId)
    if (!eligibility) {
      warnings.push(invalidResolutionWarning(resolution, 'the entry no longer exists.'))
      return
    }
    if (eligibility.valid === null) {
      warnings.push(invalidResolutionWarning(resolution, eligibility.reason))
      return
    }
    validConflictResolutions.push(resolution)
  })

  return {
    isValid: issues.length === 0,
    issues,
    validConflictResolutions,
    validBuildListEntries,
    excludedBuildListEntries,
    warnings,
  }
}

function sameBonusSlots(
  left: OwnedGogmaArtianWeapon['restorationBonuses'],
  right: OwnedGogmaArtianWeapon['restorationBonuses'],
): boolean {
  return stableStringify(left) === stableStringify(right)
}

function validateReservedGogma(
  entry: BuildListEntry,
  weapon: OwnedWeapon,
  path: string,
  issues: DomainValidationIssue[],
  expectedProtection: boolean,
) {
  const candidate = entry.candidateSnapshot
  if (weapon.kind !== 'gogma') {
    issues.push(issue(path, 'invalid_state', 'reserve_weapon must secure a Gogma Artian weapon.'))
    return
  }
  if (
    weapon.status !== candidate.category ||
    weapon.isProtected !== expectedProtection ||
    !sameBonusSlots(weapon.restorationBonuses, candidate.finalBonuses) ||
    weapon.seriesSkillId !== candidate.seriesSkillId ||
    weapon.groupSkillId !== candidate.groupSkillId
  ) {
    issues.push(issue(path, 'inconsistent_snapshot', 'The reserved weapon must preserve the Candidate result, category, and required protection state.'))
  }
}

/** Validates reserve_weapon inventory semantics without constructing Planner steps. */
export function validateReserveWeaponInventoryChange(
  entry: BuildListEntry,
  beforeInventory: readonly OwnedWeapon[],
  change: InventoryChange,
): DomainValidationResult {
  const issues: DomainValidationIssue[] = []
  const route = entry.candidateSnapshot.route
  const added = change.addOwnedWeapon

  if (route.kind === 'normal_artian_to_gogma') {
    if (!added) {
      issues.push(issue('addOwnedWeapon', 'invalid_structure', 'A new-Normal route must add a new Gogma weapon.'))
    } else {
      validateReservedGogma(
        entry,
        added,
        'addOwnedWeapon',
        issues,
        entry.candidateSnapshot.category === 'ideal',
      )
    }
    if (change.removeOwnedWeaponIds.length > 0 || change.updateOwnedWeapons.length > 0) {
      issues.push(issue('', 'invalid_state', 'A new-Normal route must not remove or update an existing weapon.'))
    }
  } else if (route.kind === 'owned_normal_artian_to_gogma') {
    const sourceId = route.sourceOwnedWeaponId
    if (!added) {
      issues.push(issue('addOwnedWeapon', 'invalid_structure', 'An owned-Normal route must add a new Gogma weapon.'))
    } else {
      validateReservedGogma(
        entry,
        added,
        'addOwnedWeapon',
        issues,
        entry.candidateSnapshot.category === 'ideal',
      )
      if (added.id === sourceId) {
        issues.push(issue('addOwnedWeapon.id', 'invalid_reference', 'The converted Gogma weapon must use a new OwnedWeapon ID.'))
      }
    }
    if (
      change.removeOwnedWeaponIds.length > 0 ||
      change.updateOwnedWeapons.length > 0
    ) {
      issues.push(issue('', 'invalid_state', 'The source Normal weapon was already consumed by convert_normal_to_gogma; reserve_weapon only adds the new Gogma weapon.'))
    }
  } else {
    const sourceId = route.sourceOwnedWeaponId
    const source = beforeInventory.find(({ id }) => id === sourceId)
    if (!source || source.kind !== 'gogma') {
      issues.push(issue('sourceOwnedWeaponId', 'invalid_reference', 'An existing-Gogma route must update its source Gogma weapon.'))
    }
    if (added !== null || change.removeOwnedWeaponIds.length > 0) {
      issues.push(issue('', 'invalid_state', 'An existing-Gogma route must not add or remove an OwnedWeapon.'))
    }
    if (
      sourceId === null ||
      change.updateOwnedWeapons.length !== 1 ||
      change.updateOwnedWeapons[0].id !== sourceId
    ) {
      issues.push(issue('updateOwnedWeapons', 'invalid_reference', 'An existing-Gogma route must update the same source OwnedWeapon ID.'))
    } else {
      const updated = change.updateOwnedWeapons[0]
      validateReservedGogma(
        entry,
        updated,
        'updateOwnedWeapons[0]',
        issues,
        source?.isProtected ?? false,
      )
      if (source?.kind === 'gogma' && updated.createdAt !== source.createdAt) {
        issues.push(issue('updateOwnedWeapons[0]', 'invalid_state', 'createdAt must be preserved.'))
      }
    }
  }
  return { isValid: issues.length === 0, issues }
}

/** Validates the inventory transition of an owned-Normal conversion PlanStep. */
export function validateOwnedNormalConversionInventoryChange(
  entry: BuildListEntry,
  beforeInventory: readonly OwnedWeapon[],
  change: InventoryChange,
): DomainValidationResult {
  const issues: DomainValidationIssue[] = []
  const route = entry.candidateSnapshot.route
  if (route.kind !== 'owned_normal_artian_to_gogma') {
    issues.push(issue('route.kind', 'invalid_literal', 'This conversion contract applies only to owned_normal_artian_to_gogma.'))
    return { isValid: false, issues }
  }
  const sourceId = route.sourceOwnedWeaponId
  const source = beforeInventory.find(({ id }) => id === sourceId)
  if (!source || source.kind !== 'normal') {
    issues.push(issue('sourceOwnedWeaponId', 'invalid_reference', 'convert_normal_to_gogma requires its source Normal Artian in the current inventory.'))
  } else if (source.isProtected) {
    issues.push(issue('sourceOwnedWeaponId', 'protected_destructive_use', 'A protected Normal Artian cannot be converted.'))
  }
  if (
    sourceId === null ||
    change.removeOwnedWeaponIds.length !== 1 ||
    change.removeOwnedWeaponIds[0] !== sourceId
  ) {
    issues.push(issue('removeOwnedWeaponIds', 'invalid_state', 'convert_normal_to_gogma must remove the source Normal Artian exactly once.'))
  }
  if (change.addOwnedWeapon !== null || change.updateOwnedWeapons.length > 0) {
    issues.push(issue('', 'invalid_state', 'Conversion removes the Normal source but does not register or update a Gogma OwnedWeapon.'))
  }
  return { isValid: issues.length === 0, issues }
}

/**
 * Validates only Planner-created material consumption (`buildListEntryId = null`).
 * Candidate Route material operations remain bound to their original concrete ID.
 */
export function validatePlannerMaterialLifecycle(
  steps: readonly PlanStep[],
  initialOwnedWeaponIds: readonly OwnedWeaponId[],
): DomainValidationResult {
  const issues: DomainValidationIssue[] = []
  const available = new Set<OwnedWeaponId>(initialOwnedWeaponIds)
  const consumed = new Set<OwnedWeaponId>()

  steps.forEach((step, index) => {
    const path = `steps[${index}]`
    if (step.operationType === 'create_material_gogma') {
      const id = step.inventoryChange?.addOwnedWeapon?.id
      if (id && available.has(id)) {
        issues.push(issue(`${path}.ownedWeaponId`, 'invalid_reference', 'A reserved material ID must not already exist before registration.'))
      }
      if (id) available.add(id)
      return
    }
    if (step.operationType !== 'use_weapon_as_material' || step.buildListEntryId !== null) return
    const id = step.ownedWeaponId
    if (id === null || !available.has(id)) {
      issues.push(issue(`${path}.ownedWeaponId`, 'invalid_reference', 'Planner-only material consumption requires an already registered or initial OwnedWeapon.'))
      return
    }
    if (consumed.has(id)) {
      issues.push(issue(`${path}.ownedWeaponId`, 'invalid_state', 'The same material weapon cannot be consumed twice.'))
      return
    }
    if (!step.inventoryChange?.removeOwnedWeaponIds.includes(id)) {
      issues.push(issue(`${path}.inventoryChange.removeOwnedWeaponIds`, 'invalid_state', 'Material consumption must remove the assigned OwnedWeapon ID.'))
      return
    }
    consumed.add(id)
    available.delete(id)
  })

  return { isValid: issues.length === 0, issues }
}
