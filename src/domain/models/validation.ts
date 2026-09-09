import type {
  AppSettings,
  CalculationContext,
  KnownValue,
  NormalArtianCounter,
  OwnedWeaponId,
  PlanStepOperationType,
  RestorationBonus,
  RestorationBonusScope,
  RngState,
} from './common'
import { V1_NORMAL_ARTIAN_RARITY } from './common'
import type {
  AlternativeBonusConditionGroup,
  BonusCondition,
  BuildCandidate,
  BuildListEntry,
  BuildRoute,
  MaterialRequirement,
  OwnedWeapon,
  RouteOperation,
  SkillCondition,
  TargetWeapon,
} from './entities'
import type {
  ActualResult,
  ExecutionHistory,
  ExpectedPlanState,
  PlanStep,
  ProductionPlan,
} from './planning'
import {
  areRestorationBonusSetsEqual,
  areRestorationBonusSlotsEqual,
  canKeepBonusesFromScope,
  canResetBonuses,
  canUseAsMaterial,
  isCalculationContextCompatible,
} from './domainRules'

export type DomainValidationIssueCode =
  | 'invalid_id'
  | 'invalid_literal'
  | 'invalid_integer'
  | 'invalid_range'
  | 'invalid_structure'
  | 'invalid_reference'
  | 'invalid_route_operation'
  | 'protected_destructive_use'
  | 'inconsistent_snapshot'
  | 'invalid_state'

export interface DomainValidationIssue {
  path: string
  code: DomainValidationIssueCode
  message: string
}

export interface DomainValidationResult {
  isValid: boolean
  issues: DomainValidationIssue[]
}

function result(issues: DomainValidationIssue[]): DomainValidationResult {
  return { isValid: issues.length === 0, issues }
}

function addIssue(
  issues: DomainValidationIssue[],
  path: string,
  code: DomainValidationIssueCode,
  message: string,
) {
  issues.push({ path, code, message })
}

function appendIssues(
  issues: DomainValidationIssue[],
  prefix: string,
  nested: DomainValidationResult,
) {
  nested.issues.forEach((issue) =>
    issues.push({
      ...issue,
      path: issue.path
        ? `${prefix}${issue.path.startsWith('[') ? '' : '.'}${issue.path}`
        : prefix,
    }),
  )
}

function validateId(
  value: string,
  path: string,
  issues: DomainValidationIssue[],
) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    addIssue(issues, path, 'invalid_id', 'ID must be a non-empty string.')
  }
}

function validateNonNegativeInteger(
  value: number,
  path: string,
  issues: DomainValidationIssue[],
) {
  if (!Number.isInteger(value) || value < 0) {
    addIssue(
      issues,
      path,
      'invalid_integer',
      'Value must be a non-negative integer.',
    )
  }
}

function validatePositiveInteger(
  value: number,
  path: string,
  issues: DomainValidationIssue[],
) {
  if (!Number.isInteger(value) || value < 1) {
    addIssue(
      issues,
      path,
      'invalid_integer',
      'Value must be a positive integer.',
    )
  }
}

export function validateCalculationContext(
  context: CalculationContext,
  path: string,
  issues: DomainValidationIssue[],
) {
  if (!context.gameVersion.trim()) {
    addIssue(issues, `${path}.gameVersion`, 'invalid_structure', 'gameVersion is required.')
  }
  if (!context.rngEngineVersion.trim()) {
    addIssue(
      issues,
      `${path}.rngEngineVersion`,
      'invalid_structure',
      'rngEngineVersion is required.',
    )
  }
  validatePositiveInteger(
    context.masterDataVersion,
    `${path}.masterDataVersion`,
    issues,
  )
  validatePositiveInteger(
    context.appSchemaVersion,
    `${path}.appSchemaVersion`,
    issues,
  )
}

export function validateKnownValue<T>(
  known: KnownValue<T>,
): DomainValidationResult {
  const issues: DomainValidationIssue[] = []
  if (
    known.source !== null &&
    !['gogma_seed_finder_import', 'manual', 'observation'].includes(known.source)
  ) {
    addIssue(issues, 'source', 'invalid_literal', 'KnownValue source is invalid.')
  }
  if (known.isConfirmed && known.value === null) {
    addIssue(
      issues,
      'value',
      'invalid_state',
      'A confirmed KnownValue must have a value.',
    )
  }
  if (known.value === null && known.isConfirmed) {
    addIssue(
      issues,
      'isConfirmed',
      'invalid_state',
      'A null KnownValue cannot be confirmed.',
    )
  }
  return result(issues)
}

function validateCounterKnownValue(
  known: KnownValue<number>,
  path: string,
  issues: DomainValidationIssue[],
) {
  appendIssues(issues, path, validateKnownValue(known))
  if (known.value !== null) {
    validateNonNegativeInteger(known.value, `${path}.value`, issues)
  }
}

export function validateRngState(state: RngState): DomainValidationResult {
  const issues: DomainValidationIssue[] = []
  if (state.id !== 'current') {
    addIssue(issues, 'id', 'invalid_literal', "RngState id must be 'current'.")
  }
  if (state.schemaVersion !== 1) {
    addIssue(
      issues,
      'schemaVersion',
      'invalid_literal',
      'RngState schemaVersion must be 1.',
    )
  }
  appendIssues(issues, 'baseSeed', validateKnownValue(state.baseSeed))
  validateCounterKnownValue(state.gogmaCounter, 'gogmaCounter', issues)
  validateCounterKnownValue(state.skillCounter, 'skillCounter', issues)
  validateCounterKnownValue(state.counterGate, 'counterGate', issues)
  return result(issues)
}

export function validateNormalArtianCounter(
  counter: NormalArtianCounter,
): DomainValidationResult {
  const issues: DomainValidationIssue[] = []
  validateId(counter.weaponTypeId, 'weaponTypeId', issues)
  if (counter.rarity !== V1_NORMAL_ARTIAN_RARITY) {
    addIssue(issues, 'rarity', 'invalid_literal', 'v1 supports only rarity 8 Normal Artian counters.')
  }
  const expectedId = `${counter.weaponTypeId}:${counter.rarity}`
  if (counter.id !== expectedId) {
    addIssue(
      issues,
      'id',
      'invalid_literal',
      `NormalArtianCounter id must be '${expectedId}'.`,
    )
  }
  if (counter.counter !== null) {
    validateNonNegativeInteger(counter.counter, 'counter', issues)
  }
  if (counter.isConfirmed && counter.counter === null) {
    addIssue(
      issues,
      'counter',
      'invalid_state',
      'A confirmed NormalArtianCounter requires a counter value.',
    )
  }
  validateNonNegativeInteger(counter.observationCount, 'observationCount', issues)
  if (counter.candidateCount !== null) {
    validateNonNegativeInteger(counter.candidateCount, 'candidateCount', issues)
  }
  return result(issues)
}

function validateRestorationBonus(
  bonus: RestorationBonus,
  path: string,
  issues: DomainValidationIssue[],
) {
  if (!bonus || typeof bonus !== 'object') {
    addIssue(issues, path, 'invalid_structure', 'Restoration bonus is required.')
    return
  }
  validateId(bonus.bonusTypeId, `${path}.bonusTypeId`, issues)
  validateId(bonus.bonusRankId, `${path}.bonusRankId`, issues)
}

export function validateRestorationBonusSet(
  bonuses: readonly RestorationBonus[],
): DomainValidationResult {
  const issues: DomainValidationIssue[] = []
  if (!Array.isArray(bonuses) || bonuses.length !== 5) {
    addIssue(
      issues,
      '',
      'invalid_structure',
      'RestorationBonusSet must contain exactly five entries.',
    )
  }
  bonuses.forEach((bonus, index) =>
    validateRestorationBonus(bonus, `[${index}]`, issues),
  )
  return result(issues)
}

function validateRestorationBonusScope(
  scope: unknown,
  path: string,
  issues: DomainValidationIssue[],
) {
  if (scope !== 'normal_artian' && scope !== 'gogma_artian') {
    addIssue(issues, path, 'invalid_literal', 'Restoration bonus scope is required and must be valid.')
  }
}
export function validateOwnedWeapon(
  weapon: OwnedWeapon,
): DomainValidationResult {
  const issues: DomainValidationIssue[] = []
  validateId(weapon.id, 'id', issues)
  validateId(weapon.weaponTypeId, 'weaponTypeId', issues)
  validateId(weapon.elementId, 'elementId', issues)
  appendIssues(
    issues,
    'restorationBonuses',
    validateRestorationBonusSet(weapon.restorationBonuses),
  )
  validateRestorationBonusScope(weapon.restorationBonusScope, 'restorationBonusScope', issues)
  if (!['normal', 'gogma'].includes(weapon.kind)) {
    addIssue(issues, 'kind', 'invalid_literal', 'OwnedWeapon kind is invalid.')
  } else if (weapon.kind === 'normal') {
    if (weapon.restorationBonusScope !== 'normal_artian') {
      addIssue(issues, 'restorationBonusScope', 'invalid_state', 'Normal Artian weapons require normal_artian scope.')
    }
    if (weapon.rarity !== V1_NORMAL_ARTIAN_RARITY) {
      addIssue(issues, 'rarity', 'invalid_literal', 'v1 supports only rarity 8 owned Normal Artian weapons.')
    }
    if (weapon.seriesSkillId !== null) {
      addIssue(issues, 'seriesSkillId', 'invalid_state', 'Normal Artian weapons cannot have a Series Skill.')
    }
    if (weapon.groupSkillId !== null) {
      addIssue(issues, 'groupSkillId', 'invalid_state', 'Normal Artian weapons cannot have a Group Skill.')
    }
    if (weapon.status !== null) {
      addIssue(issues, 'status', 'invalid_state', 'Normal Artian weapons cannot have an OwnedWeapon status.')
    }
  } else if (!['material', 'practical', 'ideal'].includes(weapon.status)) {
    addIssue(issues, 'status', 'invalid_literal', 'Gogma Artian weapons require a valid status.')
  }
  weapon.relatedTargetWeaponIds.forEach((id, index) =>
    validateId(id, `relatedTargetWeaponIds[${index}]`, issues),
  )
  return result(issues)
}

function validateBonusCondition(
  condition: BonusCondition,
  path: string,
  issues: DomainValidationIssue[],
) {
  validateId(condition.id, `${path}.id`, issues)
  validateId(condition.bonusTypeId, `${path}.bonusTypeId`, issues)
  validateId(condition.minimumRankId, `${path}.minimumRankId`, issues)
  if (!Number.isInteger(condition.requiredCount) || condition.requiredCount < 1 || condition.requiredCount > 5) {
    addIssue(
      issues,
      `${path}.requiredCount`,
      'invalid_range',
      'requiredCount must be an integer from 1 through 5.',
    )
  }
  if (
    !Number.isInteger(condition.requiredExCount) ||
    condition.requiredExCount < 0 ||
    condition.requiredExCount > condition.requiredCount
  ) {
    addIssue(
      issues,
      `${path}.requiredExCount`,
      'invalid_range',
      'requiredExCount must be between 0 and requiredCount.',
    )
  }
}

function validateAlternativeGroup(
  group: AlternativeBonusConditionGroup,
  path: string,
  issues: DomainValidationIssue[],
) {
  validateId(group.id, `${path}.id`, issues)
  if (!Number.isInteger(group.requiredCount) || group.requiredCount < 1 || group.requiredCount > 5) {
    addIssue(
      issues,
      `${path}.requiredCount`,
      'invalid_range',
      'Alternative group requiredCount must be an integer from 1 through 5.',
    )
  }
  if (!Array.isArray(group.options) || group.options.length < 1) {
    addIssue(
      issues,
      `${path}.options`,
      'invalid_structure',
      'Alternative group requires at least one option.',
    )
  }
  group.options.forEach((option, index) => {
    validateId(option.bonusTypeId, `${path}.options[${index}].bonusTypeId`, issues)
    validateId(option.minimumRankId, `${path}.options[${index}].minimumRankId`, issues)
  })
}

function validateSkillCondition(
  condition: SkillCondition,
  path: string,
  issues: DomainValidationIssue[],
) {
  if (!['all', 'any'].includes(condition.matchMode)) {
    addIssue(issues, `${path}.matchMode`, 'invalid_literal', 'Skill matchMode is invalid.')
  }
  if (condition.seriesSkillId !== null) {
    validateId(condition.seriesSkillId, `${path}.seriesSkillId`, issues)
  }
  if (condition.groupSkillId !== null) {
    validateId(condition.groupSkillId, `${path}.groupSkillId`, issues)
  }
}

export function validateTargetWeapon(
  target: TargetWeapon,
): DomainValidationResult {
  const issues: DomainValidationIssue[] = []
  validateId(target.id, 'id', issues)
  validateId(target.weaponTypeId, 'weaponTypeId', issues)
  validateId(target.elementId, 'elementId', issues)
  if (!Number.isInteger(target.priority) || target.priority < 1 || target.priority > 5) {
    addIssue(issues, 'priority', 'invalid_range', 'Target priority must be 1 through 5.')
  }
  appendIssues(issues, 'idealBonuses', validateRestorationBonusSet(target.idealBonuses))
  target.practicalBonusConditions.forEach((condition, index) =>
    validateBonusCondition(condition, `practicalBonusConditions[${index}]`, issues),
  )
  target.practicalAlternativeGroups.forEach((group, index) =>
    validateAlternativeGroup(group, `practicalAlternativeGroups[${index}]`, issues),
  )
  validateSkillCondition(target.idealSkillCondition, 'idealSkillCondition', issues)
  validateSkillCondition(target.practicalSkillCondition, 'practicalSkillCondition', issues)
  return result(issues)
}

function validateRouteOperation(
  operation: RouteOperation,
  path: string,
  issues: DomainValidationIssue[],
) {
  if (operation.type === 'create_normal_artian') {
    validateId(operation.weaponTypeId, `${path}.weaponTypeId`, issues)
    if (operation.rarity !== V1_NORMAL_ARTIAN_RARITY) {
      addIssue(
        issues,
        `${path}.rarity`,
        'invalid_literal',
        'v1 can create only rarity 8 Normal Artian weapons.',
      )
    }
    validatePositiveInteger(operation.count, `${path}.count`, issues)
    validateNonNegativeInteger(operation.normalCounterBefore, `${path}.normalCounterBefore`, issues)
    validateNonNegativeInteger(operation.normalCounterAfter, `${path}.normalCounterAfter`, issues)
    return
  }
  if (operation.type === 'convert_normal_to_gogma') {
    validateId(operation.weaponTypeId, `${path}.weaponTypeId`, issues)
    validateNonNegativeInteger(operation.skillCounterBefore, `${path}.skillCounterBefore`, issues)
    validateNonNegativeInteger(operation.skillCounterAfter, `${path}.skillCounterAfter`, issues)
    return
  }
  if (operation.type === 'reset_bonuses' || operation.type === 'keep_bonuses') {
    if (operation.sourceOwnedWeaponId !== null) {
      validateId(operation.sourceOwnedWeaponId, `${path}.sourceOwnedWeaponId`, issues)
    }
    validateNonNegativeInteger(operation.gogmaCounterBefore, `${path}.gogmaCounterBefore`, issues)
    validateNonNegativeInteger(operation.gogmaCounterAfter, `${path}.gogmaCounterAfter`, issues)
    return
  }
  if (operation.type === 'reset_skills') {
    if (operation.sourceOwnedWeaponId !== null) {
      validateId(operation.sourceOwnedWeaponId, `${path}.sourceOwnedWeaponId`, issues)
    }
    validateNonNegativeInteger(operation.skillCounterBefore, `${path}.skillCounterBefore`, issues)
    validateNonNegativeInteger(operation.skillCounterAfter, `${path}.skillCounterAfter`, issues)
    return
  }
  if (operation.type === 'use_weapon_as_material') {
    validateId(operation.ownedWeaponId, `${path}.ownedWeaponId`, issues)
    return
  }
  addIssue(
    issues,
    `${path}.type`,
    'invalid_literal',
    'Route operation type is invalid.',
  )
}
function validateProtectedRouteUse(
  route: BuildRoute,
  ownedWeapons: readonly OwnedWeapon[],
  issues: DomainValidationIssue[],
) {
  const byId = new Map(ownedWeapons.map((weapon) => [weapon.id, weapon]))
  if (
    route.sourceOwnedWeaponId !== null &&
    !byId.has(route.sourceOwnedWeaponId)
  ) {
    addIssue(
      issues,
      'sourceOwnedWeaponId',
      'invalid_reference',
      `Referenced OwnedWeapon '${route.sourceOwnedWeaponId}' does not exist.`,
    )
  }
  /**
   * Route-local Bonus scope per referenced OwnedWeapon.
   *
   * Reset Bonuses replaces the source's five slots with Gogma-tier ones for the
   * remainder of this Route, so a later Keep Bonuses in the same sequence reads
   * Gogma-scope current bonuses. AGENTS.md Existing Gogma Mixed is the
   * authority: a mixed Route from a `normal_artian` scope source performs Reset
   * Bonuses before any Keep Bonuses. `normal scope -> Keep` stays rejected
   * because Production Keep prediction does not support inherited Normal-tier
   * current bonuses, not because the game forbids it. Reset Skills never
   * changes the scope.
   */
  const routeLocalScope = new Map<OwnedWeaponId, RestorationBonusScope>()

  route.operations.forEach((operation, index) => {
    const path = `operations[${index}]`
    const id =
      operation.type === 'reset_bonuses' || operation.type === 'keep_bonuses'
        ? operation.sourceOwnedWeaponId
        : operation.type === 'use_weapon_as_material'
          ? operation.ownedWeaponId
          : null
    if (id === null) return
    const weapon = byId.get(id)
    if (!weapon) {
      addIssue(issues, path, 'invalid_reference', `Referenced OwnedWeapon '${id}' does not exist.`)
      return
    }
    const currentScope =
      routeLocalScope.get(weapon.id) ?? weapon.restorationBonusScope
    const allowed =
      operation.type === 'reset_bonuses'
        ? canResetBonuses(weapon)
        : operation.type === 'keep_bonuses'
          ? canKeepBonusesFromScope(weapon, currentScope)
          : canUseAsMaterial(weapon)
    if (!allowed) {
      addIssue(
        issues,
        path,
        'protected_destructive_use',
        operation.type === 'keep_bonuses' &&
          weapon.kind === 'gogma' &&
          !weapon.isProtected
          ? `Keep Bonuses on OwnedWeapon '${id}' needs Gogma-scope current bonuses at this position; Production Keep prediction does not support inherited Normal-scope slots.`
          : `OwnedWeapon '${id}' cannot be used by this destructive operation.`,
      )
      return
    }
    if (operation.type === 'reset_bonuses') {
      routeLocalScope.set(weapon.id, 'gogma_artian')
    }
  })
}

export function validateBuildRoute(
  route: BuildRoute,
  ownedWeapons?: readonly OwnedWeapon[],
): DomainValidationResult {
  const issues: DomainValidationIssue[] = []
  if (
    ![
      'normal_artian_to_gogma',
      'owned_normal_artian_to_gogma',
      'existing_gogma_reset_bonuses',
      'existing_gogma_keep_bonuses',
      'existing_gogma_reset_skills',
      'existing_gogma_mixed',
    ].includes(route.kind)
  ) {
    addIssue(issues, 'kind', 'invalid_literal', 'BuildRoute kind is invalid.')
  }
  if (!Array.isArray(route.operations) || route.operations.length === 0) {
    addIssue(issues, 'operations', 'invalid_structure', 'BuildRoute operations cannot be empty.')
  }
  route.operations.forEach((operation, index) =>
    validateRouteOperation(operation, `operations[${index}]`, issues),
  )

  if (route.kind === 'normal_artian_to_gogma') {
    if (route.sourceOwnedWeaponId !== null) {
      addIssue(
        issues,
        'sourceOwnedWeaponId',
        'invalid_state',
        'normal_artian_to_gogma cannot reference an existing OwnedWeapon.',
      )
    }
    let converted = false
    let transientScope: 'normal_artian' | 'gogma_artian' | null = null
    route.operations.forEach((operation, index) => {
      if (!['create_normal_artian', 'convert_normal_to_gogma', 'reset_bonuses', 'keep_bonuses', 'reset_skills'].includes(operation.type)) {
        addIssue(
          issues,
          `operations[${index}]`,
          'invalid_route_operation',
          `Operation '${operation.type}' is not allowed in normal_artian_to_gogma.`,
        )
      }
      if (operation.type === 'convert_normal_to_gogma') {
        converted = true
        transientScope = 'normal_artian'
      }
      if (operation.type === 'reset_bonuses' || operation.type === 'keep_bonuses') {
        if (operation.sourceOwnedWeaponId !== null || !converted) {
          addIssue(issues, `operations[${index}].sourceOwnedWeaponId`, 'invalid_state', 'A normal-route bonus amendment must target the converted route output.')
        }
        if (operation.type === 'keep_bonuses' && transientScope !== 'gogma_artian') {
          addIssue(issues, `operations[${index}]`, 'invalid_route_operation', 'Keep Bonuses requires a preceding Reset Bonuses operation after conversion.')
        }
        if (operation.type === 'reset_bonuses') transientScope = 'gogma_artian'
      }
      if (operation.type === 'reset_skills' && operation.sourceOwnedWeaponId !== null) {
        addIssue(
          issues,
          `operations[${index}].sourceOwnedWeaponId`,
          'invalid_state',
          'A normal-route Reset Skills operation must target the unregistered route output.',
        )
      }
    })
  } else if (route.kind === 'owned_normal_artian_to_gogma') {
    if (route.sourceOwnedWeaponId === null) {
      addIssue(
        issues,
        'sourceOwnedWeaponId',
        'invalid_state',
        'owned_normal_artian_to_gogma requires a source OwnedWeapon.',
      )
    }
    let hasConversion = false
    let transientScope: 'normal_artian' | 'gogma_artian' | null = null
    route.operations.forEach((operation, index) => {
      if (!['convert_normal_to_gogma', 'reset_bonuses', 'keep_bonuses', 'reset_skills'].includes(operation.type)) {
        addIssue(
          issues,
          `operations[${index}]`,
          'invalid_route_operation',
          `Operation '${operation.type}' is not allowed in owned_normal_artian_to_gogma.`,
        )
      }
      if (operation.type === 'convert_normal_to_gogma') {
        hasConversion = true
        transientScope = 'normal_artian'
      }
      if (operation.type === 'reset_bonuses' || operation.type === 'keep_bonuses') {
        if (operation.sourceOwnedWeaponId !== null || !hasConversion) {
          addIssue(issues, `operations[${index}].sourceOwnedWeaponId`, 'invalid_state', 'A post-conversion bonus amendment must target the converted route output.')
        }
        if (operation.type === 'keep_bonuses' && transientScope !== 'gogma_artian') {
          addIssue(issues, `operations[${index}]`, 'invalid_route_operation', 'Keep Bonuses requires a preceding Reset Bonuses operation after conversion.')
        }
        if (operation.type === 'reset_bonuses') transientScope = 'gogma_artian'
      }
      if (operation.type === 'reset_skills' && operation.sourceOwnedWeaponId !== null) {
        addIssue(
          issues,
          `operations[${index}].sourceOwnedWeaponId`,
          'invalid_state',
          'A post-conversion Reset Skills operation must target the unregistered route output.',
        )
      }
    })
    if (!hasConversion) {
      addIssue(
        issues,
        'operations',
        'invalid_route_operation',
        'owned_normal_artian_to_gogma requires a conversion operation.',
      )
    }
    if (ownedWeapons && route.sourceOwnedWeaponId !== null) {
      const source = ownedWeapons.find(({ id }) => id === route.sourceOwnedWeaponId)
      if (source && source.kind !== 'normal') {
        addIssue(issues, 'sourceOwnedWeaponId', 'invalid_reference', 'The conversion source must be a Normal Artian weapon.')
      }
      if (source?.isProtected) {
        addIssue(issues, 'sourceOwnedWeaponId', 'protected_destructive_use', 'A protected Normal Artian weapon cannot be converted.')
      }
    }
  } else if (route.sourceOwnedWeaponId === null) {
    addIssue(
      issues,
      'sourceOwnedWeaponId',
      'invalid_state',
      'An existing-Gogma route requires sourceOwnedWeaponId.',
    )
  }

  if (route.kind === 'existing_gogma_reset_skills') {
    route.operations.forEach((operation, index) => {
      if (operation.type !== 'reset_skills') {
        addIssue(
          issues,
          `operations[${index}]`,
          'invalid_route_operation',
          'existing_gogma_reset_skills may contain only Reset Skills operations.',
        )
      } else if (operation.sourceOwnedWeaponId !== route.sourceOwnedWeaponId) {
        addIssue(
          issues,
          `operations[${index}].sourceOwnedWeaponId`,
          'invalid_reference',
          'Reset Skills source must match the BuildRoute source.',
        )
      }
    })
  }
  if (route.kind.startsWith('existing_gogma_') && route.kind !== 'existing_gogma_reset_skills') {
    const bonusOperations = route.operations.filter(
      ({ type }) => type === 'reset_bonuses' || type === 'keep_bonuses',
    )
    const hasReset = bonusOperations.some(({ type }) => type === 'reset_bonuses')
    const hasKeep = bonusOperations.some(({ type }) => type === 'keep_bonuses')
    const hasResetSkills = route.operations.some(({ type }) => type === 'reset_skills')
    const expectedKind = hasResetSkills || (hasReset && hasKeep)
      ? 'existing_gogma_mixed'
      : hasReset
        ? 'existing_gogma_reset_bonuses'
        : hasKeep
          ? 'existing_gogma_keep_bonuses'
          : null
    if (expectedKind !== null && route.kind !== expectedKind) {
      addIssue(issues, 'kind', 'invalid_state', 'Existing Gogma route kind must match its bonus amendment operations.')
    }
  }
  if (
    route.kind === 'existing_gogma_mixed' &&
    route.operations.every(({ type }) => type === 'reset_skills')
  ) {
    addIssue(
      issues,
      'kind',
      'invalid_state',
      'A Reset-Skills-only route must use existing_gogma_reset_skills.',
    )
  }
  if (ownedWeapons) validateProtectedRouteUse(route, ownedWeapons, issues)
  return result(issues)
}

function validateMaterialRequirement(
  requirement: MaterialRequirement,
  path: string,
  issues: DomainValidationIssue[],
) {
  validateId(requirement.materialId, `${path}.materialId`, issues)
  validatePositiveInteger(requirement.quantity, `${path}.quantity`, issues)
}

/**
 * The observational amendment trace, when present, must describe exactly the
 * Route it belongs to: one entry per `reset_bonuses` / `keep_bonuses`
 * operation, in execution order, pointing at that operation's own index, and
 * ending on the five slots the Candidate itself holds.
 *
 * The field is optional so Candidates persisted before it existed remain
 * valid. An absent trace is never an issue; a wrong one always is, because the
 * whole point is the operation-to-result correspondence.
 */
function validateCandidateBonusAmendmentTrace(
  candidate: BuildCandidate,
  issues: DomainValidationIssue[],
): void {
  const trace = candidate.bonusAmendmentTrace
  if (trace === undefined) return
  const amendmentIndexes = candidate.route.operations.flatMap(
    (operation, index) =>
      operation.type === 'reset_bonuses' || operation.type === 'keep_bonuses'
        ? [index]
        : [],
  )
  if (trace.length !== amendmentIndexes.length) {
    addIssue(
      issues,
      'bonusAmendmentTrace',
      'invalid_state',
      'bonusAmendmentTrace must have one entry per bonus amendment operation.',
    )
    return
  }
  trace.forEach((step, index) => {
    const path = `bonusAmendmentTrace[${index}]`
    if (step.operationIndex !== amendmentIndexes[index]) {
      addIssue(
        issues,
        `${path}.operationIndex`,
        'invalid_state',
        'bonusAmendmentTrace entries must follow the route amendment order.',
      )
      return
    }
    const operation = candidate.route.operations[step.operationIndex]
    if (operation.type !== step.operationType) {
      addIssue(
        issues,
        `${path}.operationType`,
        'invalid_state',
        'bonusAmendmentTrace operationType must match the referenced operation.',
      )
    }
    appendIssues(
      issues,
      `${path}.restorationBonuses`,
      validateRestorationBonusSet(step.restorationBonuses),
    )
    validateRestorationBonusScope(
      step.restorationBonusScope,
      `${path}.restorationBonusScope`,
      issues,
    )
  })

  // The last bonus amendment is what the Candidate actually ends up holding.
  // The Route may continue with Reset Skills, so this is the last amendment,
  // not the last operation.
  const last = trace.at(-1)
  if (!last) return
  const lastPath = `bonusAmendmentTrace[${trace.length - 1}]`
  // Slot order is semantic here, so the multiset comparison of
  // `areRestorationBonusSetsEqual()` would wrongly accept a permutation.
  if (!areRestorationBonusSlotsEqual(last.restorationBonuses, candidate.finalBonuses)) {
    addIssue(
      issues,
      `${lastPath}.restorationBonuses`,
      'invalid_state',
      'The last bonus amendment must match finalBonuses slot by slot.',
    )
  }
  if (last.restorationBonusScope !== candidate.restorationBonusScope) {
    addIssue(
      issues,
      `${lastPath}.restorationBonusScope`,
      'invalid_state',
      'The last bonus amendment must match the Candidate restoration bonus scope.',
    )
  }
}

export function validateBuildCandidate(
  candidate: BuildCandidate,
  ownedWeapons?: readonly OwnedWeapon[],
): DomainValidationResult {
  const issues: DomainValidationIssue[] = []
  validateId(candidate.id, 'id', issues)
  validateId(candidate.targetWeaponId, 'targetWeaponId', issues)
  if (!['ideal', 'practical'].includes(candidate.category)) {
    addIssue(issues, 'category', 'invalid_literal', 'Candidate category is invalid.')
  }
  appendIssues(issues, 'finalBonuses', validateRestorationBonusSet(candidate.finalBonuses))
  validateRestorationBonusScope(candidate.restorationBonusScope, 'restorationBonusScope', issues)
  appendIssues(issues, 'route', validateBuildRoute(candidate.route, ownedWeapons))
  validateNonNegativeInteger(candidate.estimatedOperationCount, 'estimatedOperationCount', issues)
  validateNonNegativeInteger(candidate.estimatedGogmaAdvance, 'estimatedGogmaAdvance', issues)
  validateNonNegativeInteger(candidate.estimatedSkillAdvance, 'estimatedSkillAdvance', issues)
  if (candidate.estimatedNormalAdvance !== null) {
    validateNonNegativeInteger(candidate.estimatedNormalAdvance, 'estimatedNormalAdvance', issues)
  }
  candidate.requiredMaterials.forEach((requirement, index) =>
    validateMaterialRequirement(requirement, `requiredMaterials[${index}]`, issues),
  )
  if (candidate.idealDifference.matchedBonusCount < 0 || candidate.idealDifference.matchedBonusCount > 5) {
    addIssue(issues, 'idealDifference.matchedBonusCount', 'invalid_range', 'matchedBonusCount must be 0 through 5.')
  }
  if (candidate.category === 'ideal' && candidate.isSimilarToIdeal) {
    addIssue(
      issues,
      'isSimilarToIdeal',
      'invalid_state',
      'Only practical candidates may be similar to ideal.',
    )
  }
  if (
    candidate.similarityScore !== null &&
    (!Number.isFinite(candidate.similarityScore) || candidate.similarityScore < 0 || candidate.similarityScore > 1)
  ) {
    addIssue(issues, 'similarityScore', 'invalid_range', 'similarityScore must be null or 0 through 1.')
  }
  validateId(candidate.searchStateHash, 'searchStateHash', issues)
  if (candidate.referencedOwnedWeaponsHash !== null) {
    validateId(candidate.referencedOwnedWeaponsHash, 'referencedOwnedWeaponsHash', issues)
  }
  validateCalculationContext(candidate.calculationContext, 'calculationContext', issues)
  validateId(candidate.searchRunId, 'searchRunId', issues)
  validateCandidateBonusAmendmentTrace(candidate, issues)

  if (candidate.route.kind === 'existing_gogma_reset_skills' && ownedWeapons) {
    const source = ownedWeapons.find(({ id }) => id === candidate.route.sourceOwnedWeaponId)
    if (source && !areRestorationBonusSetsEqual(candidate.finalBonuses, source.restorationBonuses)) {
      addIssue(
        issues,
        'finalBonuses',
        'invalid_state',
        'Reset-Skills-only candidates must preserve source restoration bonuses.',
      )
    }
  }
  if (
    candidate.route.kind === 'owned_normal_artian_to_gogma' &&
    candidate.referencedOwnedWeaponsHash === null
  ) {
    addIssue(
      issues,
      'referencedOwnedWeaponsHash',
      'invalid_state',
      'Owned-Normal conversion candidates must reference their source weapon.',
    )
  }
  return result(issues)
}

export function validateBuildListEntry(
  entry: BuildListEntry,
): DomainValidationResult {
  const issues: DomainValidationIssue[] = []
  validateId(entry.id, 'id', issues)
  validateId(entry.candidateId, 'candidateId', issues)
  validateId(entry.targetWeaponId, 'targetWeaponId', issues)
  appendIssues(issues, 'candidateSnapshot', validateBuildCandidate(entry.candidateSnapshot))
  if (entry.candidateSnapshot.id !== entry.candidateId) {
    addIssue(issues, 'candidateId', 'inconsistent_snapshot', 'candidateId must match candidateSnapshot.id.')
  }
  if (entry.candidateSnapshot.targetWeaponId !== entry.targetWeaponId) {
    addIssue(issues, 'targetWeaponId', 'inconsistent_snapshot', 'targetWeaponId must match the candidate snapshot.')
  }
  if (entry.searchStateHash !== entry.candidateSnapshot.searchStateHash) {
    addIssue(issues, 'searchStateHash', 'inconsistent_snapshot', 'searchStateHash must be copied from the candidate snapshot.')
  }
  if (entry.referencedOwnedWeaponsHash !== entry.candidateSnapshot.referencedOwnedWeaponsHash) {
    addIssue(issues, 'referencedOwnedWeaponsHash', 'inconsistent_snapshot', 'OwnedWeapon hash must be copied from the candidate snapshot.')
  }
  if (!isCalculationContextCompatible(entry.calculationContext, entry.candidateSnapshot.calculationContext)) {
    addIssue(issues, 'calculationContext', 'inconsistent_snapshot', 'CalculationContext must match the candidate snapshot.')
  }
  if (entry.isStale !== (entry.staleReasons.length > 0)) {
    addIssue(issues, 'isStale', 'invalid_state', 'isStale must match the presence of staleReasons.')
  }
  const allowedStaleReasons = [
    'target_definition_changed',
    'rng_state_changed',
    'owned_weapon_changed',
    'calculation_context_changed',
  ]
  entry.staleReasons.forEach((reason, index) => {
    if (!allowedStaleReasons.includes(reason)) {
      addIssue(
        issues,
        `staleReasons[${index}]`,
        'invalid_literal',
        'BuildListEntry stale reason is invalid.',
      )
    }
  })
  validateId(entry.targetDefinitionHash, 'targetDefinitionHash', issues)
  return result(issues)
}

function validateExpectedPlanState(
  state: ExpectedPlanState,
  path: string,
  issues: DomainValidationIssue[],
) {
  validateId(state.rngStateHash, `${path}.rngStateHash`, issues)
  validateId(state.normalCountersHash, `${path}.normalCountersHash`, issues)
  validateId(state.ownedWeaponsHash, `${path}.ownedWeaponsHash`, issues)
}

function validatePlanStep(
  step: PlanStep,
  expectedOrder: number,
  issues: DomainValidationIssue[],
) {
  const path = `steps[${expectedOrder - 1}]`
  validateId(step.id, `${path}.id`, issues)
  const allowedOperationTypes: readonly PlanStepOperationType[] = [
    'create_normal_artian',
    'convert_normal_to_gogma',
    'create_material_gogma',
    'reset_bonuses',
    'keep_bonuses',
    'reset_skills',
    'reserve_weapon',
    'use_weapon_as_material',
    'change_owned_weapon_status',
    'confirm_result',
  ]
  if (!allowedOperationTypes.includes(step.operationType)) {
    addIssue(
      issues,
      `${path}.operationType`,
      'invalid_literal',
      'PlanStep operation type is invalid.',
    )
  }
  if (step.order !== expectedOrder) {
    addIssue(issues, `${path}.order`, 'invalid_state', 'PlanStep order must be a one-based contiguous sequence.')
  }
  if (step.isCompleted && step.completedAt === null) {
    addIssue(issues, `${path}.completedAt`, 'invalid_state', 'A completed PlanStep requires completedAt.')
  }
  if (step.operationType === 'change_owned_weapon_status' && !step.requiresUserConfirmation) {
    addIssue(issues, `${path}.requiresUserConfirmation`, 'invalid_state', 'Weapon status changes require explicit confirmation.')
  }
  if (step.operationType === 'create_material_gogma') {
    if (
      step.targetWeaponId !== null ||
      step.buildListEntryId !== null ||
      step.candidateId !== null
    ) {
      addIssue(
        issues,
        path,
        'invalid_state',
        'A material Gogma registration step must not reference a Target, BuildListEntry, or Candidate.',
      )
    }
    if (step.ownedWeaponId === null) {
      addIssue(
        issues,
        `${path}.ownedWeaponId`,
        'invalid_reference',
        'A material Gogma registration step requires its reserved OwnedWeapon ID.',
      )
    }
    if (!step.requiresUserConfirmation) {
      addIssue(
        issues,
        `${path}.requiresUserConfirmation`,
        'invalid_state',
        'A material Gogma registration step requires explicit confirmation.',
      )
    }
    const addedWeapon = step.inventoryChange?.addOwnedWeapon
    if (!addedWeapon) {
      addIssue(
        issues,
        `${path}.inventoryChange.addOwnedWeapon`,
        'invalid_structure',
        'A material Gogma registration step must add the predicted weapon.',
      )
    } else {
      appendIssues(
        issues,
        `${path}.inventoryChange.addOwnedWeapon`,
        validateOwnedWeapon(addedWeapon),
      )
      if (
        addedWeapon.kind !== 'gogma' ||
        addedWeapon.status !== 'material' ||
        addedWeapon.isProtected
      ) {
        addIssue(
          issues,
          `${path}.inventoryChange.addOwnedWeapon`,
          'invalid_state',
          'The added weapon must be an unprotected Material Gogma Artian weapon.',
        )
      }
      if (step.ownedWeaponId !== addedWeapon.id) {
        addIssue(
          issues,
          `${path}.ownedWeaponId`,
          'invalid_reference',
          'ownedWeaponId must match inventoryChange.addOwnedWeapon.id.',
        )
      }
      const expected = step.expectedResult
      if (
        expected === null ||
        expected.restorationBonuses === null ||
        !areRestorationBonusSetsEqual(
          expected.restorationBonuses,
          addedWeapon.restorationBonuses,
        ) ||
        expected.seriesSkillId !== addedWeapon.seriesSkillId ||
        expected.groupSkillId !== addedWeapon.groupSkillId ||
        expected.candidateCategory !== null ||
        expected.isSimilarToIdeal ||
        !expected.shouldSecure
      ) {
        addIssue(
          issues,
          `${path}.expectedResult`,
          'inconsistent_snapshot',
          'ExpectedResult must describe the material Gogma weapon being registered without a Target category.',
        )
      }
    }
    if (
      step.rngAdvance.gogmaCounterDelta !== 0 ||
      step.rngAdvance.skillCounterDelta !== 0 ||
      step.rngAdvance.normalCounterDelta !== null ||
      step.rngAdvance.affectedNormalCounterId !== null
    ) {
      addIssue(
        issues,
        `${path}.rngAdvance`,
        'invalid_state',
        'Registering a material Gogma weapon must not advance RNG counters.',
      )
    }
    if (
      step.expectedStateBefore.ownedWeaponsHash ===
      step.expectedStateAfter.ownedWeaponsHash
    ) {
      addIssue(
        issues,
        `${path}.expectedStateAfter.ownedWeaponsHash`,
        'inconsistent_snapshot',
        'The expected OwnedWeapon state must include the registered material weapon.',
      )
    }
  }
  validateExpectedPlanState(step.expectedStateBefore, `${path}.expectedStateBefore`, issues)
  validateExpectedPlanState(step.expectedStateAfter, `${path}.expectedStateAfter`, issues)
  if (step.expectedResult?.restorationBonuses !== null && step.expectedResult) {
    appendIssues(
      issues,
      `${path}.expectedResult.restorationBonuses`,
      validateRestorationBonusSet(step.expectedResult.restorationBonuses),
    )
  }
  step.inventoryChange?.materialRequirements.forEach((requirement, index) =>
    validateMaterialRequirement(requirement, `${path}.inventoryChange.materialRequirements[${index}]`, issues),
  )
}

export function validateProductionPlan(
  plan: ProductionPlan,
): DomainValidationResult {
  const issues: DomainValidationIssue[] = []
  validateId(plan.id, 'id', issues)
  if (!['draft', 'active', 'completed', 'stale', 'abandoned'].includes(plan.status)) {
    addIssue(issues, 'status', 'invalid_literal', 'ProductionPlan status is invalid.')
  }
  validateCalculationContext(plan.calculationContext, 'calculationContext', issues)
  validateCalculationContext(plan.baseSnapshot.calculationContext, 'baseSnapshot.calculationContext', issues)
  if (!isCalculationContextCompatible(plan.calculationContext, plan.baseSnapshot.calculationContext)) {
    addIssue(issues, 'baseSnapshot.calculationContext', 'inconsistent_snapshot', 'Plan and base snapshot CalculationContext must match.')
  }
  validateExpectedPlanState(plan.baseSnapshot.initialExecutionState, 'baseSnapshot.initialExecutionState', issues)
  validateId(plan.baseSnapshot.targetWeaponsHash, 'baseSnapshot.targetWeaponsHash', issues)
  validateId(plan.baseSnapshot.buildListEntriesHash, 'baseSnapshot.buildListEntriesHash', issues)
  plan.steps.forEach((step, index) => validatePlanStep(step, index + 1, issues))
  if (new Set(plan.steps.map(({ id }) => id)).size !== plan.steps.length) {
    addIssue(issues, 'steps', 'invalid_id', 'PlanStep IDs must be unique within a plan.')
  }
  if (plan.currentStepId !== null) {
    const current = plan.steps.find(({ id }) => id === plan.currentStepId)
    if (!current || current.isCompleted) {
      addIssue(issues, 'currentStepId', 'invalid_reference', 'currentStepId must reference an incomplete PlanStep.')
    }
  }
  plan.requiredMaterials.forEach((requirement, index) =>
    validateMaterialRequirement(requirement, `requiredMaterials[${index}]`, issues),
  )
  plan.conflicts.forEach((conflict, index) => {
    validateId(conflict.id, `conflicts[${index}].id`, issues)
    conflict.buildListEntryIds.forEach((id, idIndex) =>
      validateId(id, `conflicts[${index}].buildListEntryIds[${idIndex}]`, issues),
    )
  })
  plan.rejectedBuildListEntries.forEach((entry, index) =>
    validateId(entry.buildListEntryId, `rejectedBuildListEntries[${index}].buildListEntryId`, issues),
  )
  return result(issues)
}

function validateActualResult(
  actual: ActualResult,
  path: string,
  issues: DomainValidationIssue[],
) {
  if (actual.restorationBonuses !== null) {
    appendIssues(issues, `${path}.restorationBonuses`, validateRestorationBonusSet(actual.restorationBonuses))
  }
  if (actual.securedOwnedWeaponId !== null) {
    validateId(actual.securedOwnedWeaponId, `${path}.securedOwnedWeaponId`, issues)
  }
}

export function validateExecutionHistory(
  history: ExecutionHistory,
): DomainValidationResult {
  const issues: DomainValidationIssue[] = []
  validateId(history.id, 'id', issues)
  validateId(history.planId, 'planId', issues)
  validateId(history.planStepId, 'planStepId', issues)
  if (
    ![
      'confirmed_expected',
      'secured_weapon',
      'confirmed_weapon_status_change',
      'declined_weapon_status_change',
      'actual_result_different',
      'skipped_candidate',
    ].includes(history.action)
  ) {
    addIssue(issues, 'action', 'invalid_literal', 'Execution action is invalid.')
  }
  if (history.actualResult !== null) validateActualResult(history.actualResult, 'actualResult', issues)
  appendIssues(issues, 'undoSnapshot.rngStateBefore', validateRngState(history.undoSnapshot.rngStateBefore))
  history.undoSnapshot.normalCountersBefore.forEach((counter, index) =>
    appendIssues(issues, `undoSnapshot.normalCountersBefore[${index}]`, validateNormalArtianCounter(counter)),
  )
  history.undoSnapshot.affectedOwnedWeaponsBefore.forEach((weapon, index) =>
    appendIssues(issues, `undoSnapshot.affectedOwnedWeaponsBefore[${index}]`, validateOwnedWeapon(weapon)),
  )
  history.undoSnapshot.removedOwnedWeaponsBefore.forEach((weapon, index) =>
    appendIssues(issues, `undoSnapshot.removedOwnedWeaponsBefore[${index}]`, validateOwnedWeapon(weapon)),
  )
  appendIssues(issues, 'undoSnapshot.productionPlanBefore', validateProductionPlan(history.undoSnapshot.productionPlanBefore))
  if (history.planId !== history.undoSnapshot.productionPlanBefore.id) {
    addIssue(issues, 'planId', 'inconsistent_snapshot', 'History planId must match productionPlanBefore.id.')
  }
  if (!history.wasExpected && history.recalculationReason === null) {
    addIssue(issues, 'recalculationReason', 'invalid_state', 'Unexpected execution requires a recalculation reason.')
  }
  const affected = new Set(history.undoSnapshot.affectedOwnedWeaponsBefore.map(({ id }) => id))
  const added = new Set(history.undoSnapshot.addedOwnedWeaponIds)
  const removed = new Set(history.undoSnapshot.removedOwnedWeaponsBefore.map(({ id }) => id))
  const overlaps = [...affected].some((id) => added.has(id) || removed.has(id)) || [...added].some((id) => removed.has(id))
  if (overlaps) {
    addIssue(issues, 'undoSnapshot', 'invalid_state', 'Undo OwnedWeapon roles must not overlap.')
  }
  history.undoSnapshot.addedOwnedWeaponIds.forEach((id, index) =>
    validateId(id, `undoSnapshot.addedOwnedWeaponIds[${index}]`, issues),
  )
  return result(issues)
}

export function validateAppSettings(
  settings: AppSettings,
): DomainValidationResult {
  const issues: DomainValidationIssue[] = []
  if (settings.id !== 'settings') {
    addIssue(issues, 'id', 'invalid_literal', "AppSettings id must be 'settings'.")
  }
  if (settings.schemaVersion !== 1) {
    addIssue(issues, 'schemaVersion', 'invalid_literal', 'AppSettings schemaVersion must be 1.')
  }
  validatePositiveInteger(settings.resultPageSize, 'resultPageSize', issues)
  validatePositiveInteger(settings.defaultSearchLimit, 'defaultSearchLimit', issues)
  return result(issues)
}
