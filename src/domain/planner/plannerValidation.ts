import type {
  BuildListEntry,
  DomainValidationIssue,
  DomainValidationResult,
  InventoryChange,
  OwnedGogmaArtianWeapon,
  OwnedWeapon,
  OwnedWeaponId,
  PlanStep,
} from '../models/publicTypes'
import {
  isCalculationContextCompatible,
  stableStringify,
  validateBuildRoute,
} from '../models/publicTypes'
import { deriveRngCapabilities } from '../rng/capabilities'
import type {
  PlannerConflictResolution,
  PlannerDependencies,
  PlannerInput,
  PlannerMaterialAssignment,
  PlannerMaterialRequirement,
  PlannerOptions,
  PlannerWarning,
} from './plannerTypes'
import { plannerWarningKinds } from './plannerTypes'

export interface PlannerInputValidationResult extends DomainValidationResult {
  validConflictResolutions: PlannerConflictResolution[]
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

function resolutionIsExecutable(
  input: PlannerInput,
  dependencies: PlannerDependencies,
  entry: BuildListEntry,
): string | null {
  if (entry.isStale || entry.staleReasons.length > 0) return 'the entry is stale.'
  const target = input.targetWeapons.find(({ id }) => id === entry.targetWeaponId)
  if (!target) return 'the TargetWeapon no longer exists.'
  if (!target.isEnabled) return 'the TargetWeapon is disabled.'
  if (!isCalculationContextCompatible(entry.calculationContext, input.calculationContext)) {
    return 'the CalculationContext is incompatible.'
  }
  if (dependencies.rngEngine.version !== input.calculationContext.rngEngineVersion) {
    return 'the injected RNG Engine version is incompatible.'
  }
  const routeValidation = validateBuildRoute(
    entry.candidateSnapshot.route,
    input.ownedWeapons,
  )
  if (!routeValidation.isValid) return 'the candidate route is no longer executable.'
  const capabilities = deriveRngCapabilities(
    input.rngState,
    input.normalCounters,
    entry.candidateSnapshot.route.operations,
    dependencies.rngEngine.capabilities,
  )
  if (!capabilities.canRunPlanner) {
    return `required RNG capability is unavailable (${capabilities.missingRequirements.join(', ')}).`
  }
  return null
}

export function validatePlannerInput(
  input: PlannerInput,
  dependencies: PlannerDependencies,
): PlannerInputValidationResult {
  const options = validatePlannerOptions(input.options)
  const issues = [...options.issues]
  const warnings: PlannerWarning[] = []
  const validConflictResolutions: PlannerConflictResolution[] = []
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
    const entry = input.buildListEntries.find(
      ({ id }) => id === resolution.selectedBuildListEntryId,
    )
    if (!entry) {
      warnings.push(invalidResolutionWarning(resolution, 'the entry no longer exists.'))
      return
    }
    const unavailableReason = resolutionIsExecutable(
      input,
      dependencies,
      entry,
    )
    if (unavailableReason !== null) {
      warnings.push(invalidResolutionWarning(resolution, unavailableReason))
      return
    }
    validConflictResolutions.push(resolution)
  })

  return {
    isValid: issues.length === 0,
    issues,
    validConflictResolutions,
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
) {
  const candidate = entry.candidateSnapshot
  if (weapon.kind !== 'gogma') {
    issues.push(issue(path, 'invalid_state', 'reserve_weapon must secure a Gogma Artian weapon.'))
    return
  }
  if (
    weapon.status !== candidate.category ||
    !weapon.isProtected ||
    !sameBonusSlots(weapon.restorationBonuses, candidate.finalBonuses) ||
    weapon.seriesSkillId !== candidate.seriesSkillId ||
    weapon.groupSkillId !== candidate.groupSkillId
  ) {
    issues.push(issue(path, 'inconsistent_snapshot', 'The reserved weapon must preserve the Candidate result, category, and protected state.'))
  }
  const targetReferences = weapon.relatedTargetWeaponIds.filter(
    (id) => id === entry.targetWeaponId,
  )
  if (targetReferences.length !== 1) {
    issues.push(issue(`${path}.relatedTargetWeaponIds`, 'invalid_reference', 'The reserved weapon must reference its Target exactly once.'))
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
      validateReservedGogma(entry, added, 'addOwnedWeapon', issues)
    }
    if (change.removeOwnedWeaponIds.length > 0 || change.updateOwnedWeapons.length > 0) {
      issues.push(issue('', 'invalid_state', 'A new-Normal route must not remove or update an existing weapon.'))
    }
  } else if (route.kind === 'owned_normal_artian_to_gogma') {
    const sourceId = route.sourceOwnedWeaponId
    if (!added) {
      issues.push(issue('addOwnedWeapon', 'invalid_structure', 'An owned-Normal route must add a new Gogma weapon.'))
    } else {
      validateReservedGogma(entry, added, 'addOwnedWeapon', issues)
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
      validateReservedGogma(entry, updated, 'updateOwnedWeapons[0]', issues)
      if (source?.kind === 'gogma') {
        const preservedTargets = source.relatedTargetWeaponIds.every((id) =>
          updated.relatedTargetWeaponIds.includes(id),
        )
        if (!preservedTargets || updated.createdAt !== source.createdAt) {
          issues.push(issue('updateOwnedWeapons[0]', 'invalid_state', 'Existing Target references and createdAt must be preserved.'))
        }
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
