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
import {
  CURRENT_CALCULATION_APP_SCHEMA_VERSION,
  V1_NORMAL_ARTIAN_RARITY,
} from './common'
import type {
  AlternativeBonusRule,
  PracticalBonusCondition,
  BuildCandidate,
  BuildListEntry,
  BuildRoute,
  MaterialRequirement,
  OwnedWeapon,
  RouteOperation,
  SkillCondition,
  TargetWeapon,
} from './entities'
import { isBlindCreateNormalArtianOperation } from './entities'
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
  canResetSkills,
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
  } else if (!['unclassified', 'practical', 'ideal'].includes(weapon.status)) {
    addIssue(issues, 'status', 'invalid_literal', 'Gogma Artian weapons require a valid status.')
  }
  return result(issues)
}

function validateBonusCondition(
  condition: PracticalBonusCondition, count: number, path: string, issues: DomainValidationIssue[],
) {
  validateId(condition.id, path + '.id', issues)
  validateId(condition.bonusTypeId, path + '.bonusTypeId', issues)
  validateId(condition.minimumRankId, path + '.minimumRankId', issues)
  if (!Number.isInteger(condition.requiredExCount) || condition.requiredExCount < 0 || condition.requiredExCount > count) {
    addIssue(issues, path + '.requiredExCount', 'invalid_range', 'EX最低数は0以上、理想内の同種類の個数以下の整数にしてください。')
  }
  if ('requiredCount' in condition) addIssue(issues, path, 'invalid_structure', '旧実用条件は再設定が必要です。')
}

function validateAlternativeRule(
  rule: AlternativeBonusRule, count: number, path: string, issues: DomainValidationIssue[],
) {
  validateId(rule.id, path + '.id', issues)
  validateId(rule.sourceBonusTypeId, path + '.sourceBonusTypeId', issues)
  if (!Number.isInteger(rule.maxReplacementCount) || rule.maxReplacementCount < 1 || rule.maxReplacementCount > count) {
    addIssue(issues, path + '.maxReplacementCount', 'invalid_range', '最大置換数は1以上、理想内の元種類の個数以下の整数にしてください。')
  }
  if (!Array.isArray(rule.options) || rule.options.length === 0) {
    addIssue(issues, path + '.options', 'invalid_structure', '代替候補を1件以上設定してください。')
    return
  }
  const seen = new Set<string>()
  rule.options.forEach((option, index) => {
    const optionPath = path + '.options[' + index + ']'
    validateId(option.alternativeBonusTypeId, optionPath + '.alternativeBonusTypeId', issues)
    validateId(option.minimumRankId, optionPath + '.minimumRankId', issues)
    if (option.alternativeBonusTypeId === rule.sourceBonusTypeId || seen.has(option.alternativeBonusTypeId)) {
      addIssue(issues, optionPath, 'invalid_structure', '代替先は元と異なる種類を重複なく設定してください。')
    }
    seen.add(option.alternativeBonusTypeId)
    if (!Number.isInteger(option.requiredExCount) || option.requiredExCount < 0 || option.requiredExCount > rule.maxReplacementCount) {
      addIssue(issues, optionPath + '.requiredExCount', 'invalid_range', 'EX最低数は0以上、最大置換数以下の整数にしてください。')
    }
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
  // Structural only. Whether the referenced weapon exists, is compatible, is
  // unprotected, and is claimed by no other Target needs the whole collection,
  // so it belongs to validateTargetPreferredOwnedWeapons() instead.
  if (target.preferredOwnedWeaponId !== null) {
    validateId(target.preferredOwnedWeaponId, 'preferredOwnedWeaponId', issues)
  }
  appendIssues(issues, 'idealBonuses', validateRestorationBonusSet(target.idealBonuses))
  if (!Array.isArray(target.practicalBonusConditions) || !Array.isArray(target.alternativeBonusRules) || 'practicalAlternativeGroups' in target) {
    addIssue(issues, 'alternativeBonusRules', 'invalid_structure', '旧条件または不正な妥協条件です。移行・再設定が必要です。')
    return result(issues)
  }
  const idealCount = (type: string) => target.idealBonuses.filter((bonus) => bonus.bonusTypeId === type).length
  const practicalTypes = new Set<string>()
  target.practicalBonusConditions.forEach((condition, index) => {
    const path = 'practicalBonusConditions[' + index + ']'
    const count = idealCount(condition.bonusTypeId)
    if (count === 0 || practicalTypes.has(condition.bonusTypeId)) addIssue(issues, path, 'invalid_structure', '理想に含まれる種類を重複なく設定してください。')
    practicalTypes.add(condition.bonusTypeId)
    validateBonusCondition(condition, count, path, issues)
  })
  const sources = new Set<string>()
  target.alternativeBonusRules.forEach((rule, index) => {
    const path = 'alternativeBonusRules[' + index + ']'
    const count = idealCount(rule.sourceBonusTypeId)
    if (count === 0 || sources.has(rule.sourceBonusTypeId)) addIssue(issues, path, 'invalid_structure', '元ボーナスは理想に含まれる種類を重複なく設定してください。')
    sources.add(rule.sourceBonusTypeId)
    validateAlternativeRule(rule, count, path, issues)
  })
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
    // Blind creation stores no absolute Counter position at all. A half-filled
    // pair is neither variant, so it is rejected instead of being coerced.
    if (
      operation.normalCounterBefore === null ||
      operation.normalCounterAfter === null
    ) {
      if (
        operation.normalCounterBefore !== null ||
        operation.normalCounterAfter !== null
      ) {
        addIssue(
          issues,
          `${path}.normalCounterBefore`,
          'invalid_state',
          'A blind Normal creation must leave both Normal Counter positions null.',
        )
      }
      if (operation.count !== 1) {
        addIssue(
          issues,
          `${path}.count`,
          'invalid_state',
          'A blind Normal creation forges exactly one Normal Artian weapon.',
        )
      }
      return
    }
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
      operation.type === 'reset_bonuses' ||
      operation.type === 'keep_bonuses' ||
      operation.type === 'reset_skills'
        ? operation.sourceOwnedWeaponId
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
          : canResetSkills(weapon)
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
      'existing_gogma_current',
      'existing_gogma_reset_bonuses',
      'existing_gogma_keep_bonuses',
      'existing_gogma_reset_skills',
      'existing_gogma_mixed',
    ].includes(route.kind)
  ) {
    addIssue(issues, 'kind', 'invalid_literal', 'BuildRoute kind is invalid.')
  }
  if (!Array.isArray(route.operations)) {
    addIssue(issues, 'operations', 'invalid_structure', 'BuildRoute operations must be an array.')
  } else if (
    route.operations.length === 0 &&
    route.kind !== 'existing_gogma_current'
  ) {
    addIssue(issues, 'operations', 'invalid_structure', 'Only an existing_gogma_current route may have no operations.')
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
    let blindCreateCount = 0
    let createCount = 0
    let resetBonusesCount = 0
    route.operations.forEach((operation, index) => {
      if (!['create_normal_artian', 'convert_normal_to_gogma', 'reset_bonuses', 'keep_bonuses', 'reset_skills'].includes(operation.type)) {
        addIssue(
          issues,
          `operations[${index}]`,
          'invalid_route_operation',
          `Operation '${operation.type}' is not allowed in normal_artian_to_gogma.`,
        )
      }
      if (operation.type === 'create_normal_artian') {
        createCount += 1
        if (isBlindCreateNormalArtianOperation(operation)) blindCreateCount += 1
      }
      if (operation.type === 'reset_bonuses') resetBonusesCount += 1
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
    if (blindCreateCount > 0) {
      // The forged weapon's five slots are unknown, so the Route is executable
      // only when a Reset Bonuses rewrites all five of them
      // (`docs/SEARCH_SPEC.md` 6.1.1).
      if (createCount !== 1 || blindCreateCount !== createCount) {
        addIssue(
          issues,
          'operations',
          'invalid_route_operation',
          'A blind Normal Artian route creates exactly one Normal Artian weapon.',
        )
      }
      if (!converted) {
        addIssue(
          issues,
          'operations',
          'invalid_route_operation',
          'A blind Normal Artian route requires a conversion operation.',
        )
      }
      if (resetBonusesCount === 0) {
        addIssue(
          issues,
          'operations',
          'invalid_route_operation',
          'A blind Normal Artian route requires Reset Bonuses, because the created weapon has unknown restoration bonuses.',
        )
      }
    }
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
  if (
    route.kind === 'existing_gogma_current' &&
    route.operations.length !== 0
  ) {
    addIssue(
      issues,
      'operations',
      'invalid_route_operation',
      'existing_gogma_current must not contain any operations.',
    )
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

/**
 * The Skill counterpart of `validateCandidateBonusAmendmentTrace()`.
 *
 * Entries correspond one-to-one and in execution order with the Route's
 * `reset_skills` operations, and the last entry is what the Candidate actually
 * ends up holding. The Route may continue with bonus amendments after its last
 * Reset Skills, so the comparison is against the last Skill amendment, not the
 * last operation.
 *
 * The field is optional so Candidates persisted before it existed remain valid.
 * An absent trace is never an issue; a wrong one always is.
 */
function validateCandidateSkillAmendmentTrace(
  candidate: BuildCandidate,
  issues: DomainValidationIssue[],
): void {
  const trace = candidate.skillAmendmentTrace
  if (trace === undefined) return
  const amendmentIndexes = candidate.route.operations.flatMap(
    (operation, index) => (operation.type === 'reset_skills' ? [index] : []),
  )
  if (trace.length !== amendmentIndexes.length) {
    addIssue(
      issues,
      'skillAmendmentTrace',
      'invalid_state',
      'skillAmendmentTrace must have one entry per Reset Skills operation.',
    )
    return
  }
  trace.forEach((step, index) => {
    const path = `skillAmendmentTrace[${index}]`
    if (step.operationIndex !== amendmentIndexes[index]) {
      addIssue(
        issues,
        `${path}.operationIndex`,
        'invalid_state',
        'skillAmendmentTrace entries must follow the route Reset Skills order.',
      )
      return
    }
    if (step.operationType !== 'reset_skills') {
      addIssue(
        issues,
        `${path}.operationType`,
        'invalid_literal',
        'skillAmendmentTrace operationType must be reset_skills.',
      )
    }
    if (step.seriesSkillId !== null) validateId(step.seriesSkillId, `${path}.seriesSkillId`, issues)
    if (step.groupSkillId !== null) validateId(step.groupSkillId, `${path}.groupSkillId`, issues)
  })

  const last = trace.at(-1)
  if (!last) return
  const lastPath = `skillAmendmentTrace[${trace.length - 1}]`
  if (last.seriesSkillId !== candidate.seriesSkillId) {
    addIssue(
      issues,
      `${lastPath}.seriesSkillId`,
      'invalid_state',
      'The last Skill amendment must match the Candidate series skill.',
    )
  }
  if (last.groupSkillId !== candidate.groupSkillId) {
    addIssue(
      issues,
      `${lastPath}.groupSkillId`,
      'invalid_state',
      'The last Skill amendment must match the Candidate group skill.',
    )
  }
}

/**
 * The observational conversion Skill record, when present, must describe the
 * one `convert_normal_to_gogma` operation of the Route it belongs to.
 *
 * It is singular because SEARCH_SPEC 6.1 / 6.1.1 / 6.2 give a conversion Route
 * exactly one conversion operation, so a Route carrying the field with any
 * other conversion count is an internal inconsistency rather than something to
 * bind by best effort.
 *
 * The record is NOT compared against the Candidate's own Skills: a later
 * `reset_skills` legitimately overwrites the conversion result, and the
 * Candidate's `seriesSkillId` / `groupSkillId` stay the authority for the final
 * Skills. The field is optional so Candidates persisted before it existed
 * remain valid; an absent record is never an issue, a wrong one always is.
 */
function validateCandidateConversionSkillTrace(
  candidate: BuildCandidate,
  issues: DomainValidationIssue[],
): void {
  const step = candidate.conversionSkillTrace
  if (step === undefined) return
  const conversionIndexes = candidate.route.operations.flatMap(
    (operation, index) =>
      operation.type === 'convert_normal_to_gogma' ? [index] : [],
  )
  if (conversionIndexes.length !== 1) {
    addIssue(
      issues,
      'conversionSkillTrace',
      'invalid_state',
      'conversionSkillTrace requires exactly one conversion operation in the route.',
    )
    return
  }
  if (step.operationIndex !== conversionIndexes[0]) {
    addIssue(
      issues,
      'conversionSkillTrace.operationIndex',
      'invalid_state',
      'conversionSkillTrace must point at the route conversion operation.',
    )
    return
  }
  if (step.operationType !== 'convert_normal_to_gogma') {
    addIssue(
      issues,
      'conversionSkillTrace.operationType',
      'invalid_literal',
      'conversionSkillTrace operationType must be convert_normal_to_gogma.',
    )
  }
  if (step.seriesSkillId !== null) {
    validateId(step.seriesSkillId, 'conversionSkillTrace.seriesSkillId', issues)
  }
  if (step.groupSkillId !== null) {
    validateId(step.groupSkillId, 'conversionSkillTrace.groupSkillId', issues)
  }
}

/**
 * Strict checkpoint shape validation (`docs/SEARCH_SPEC.md` 5.8).
 *
 * Every Candidate generated under the current `CalculationContext` carries
 * `checkpointGroups`. A Candidate persisted before the field existed is left
 * alone rather than rewritten, so an absent field is an issue only at the
 * current calculation schema version.
 */
function validateCandidateCheckpointGroups(
  candidate: BuildCandidate,
  issues: DomainValidationIssue[],
): void {
  const groups = candidate.checkpointGroups
  if (groups === undefined) {
    if (
      candidate.calculationContext.appSchemaVersion ===
      CURRENT_CALCULATION_APP_SCHEMA_VERSION
    ) {
      addIssue(
        issues,
        'checkpointGroups',
        'invalid_state',
        'A current-schema Candidate must carry its checkpoint groups.',
      )
    }
    return
  }
  const operationCount = candidate.route.operations.length
  // Operation units in Route order: `create_normal_artian` counts its forges,
  // every other operation is one unit. `operationCount` / `remainingOperationCount`
  // of an opportunity are derived from these, never stored independently.
  const cumulativeUnits: number[] = []
  let totalUnits = 0
  candidate.route.operations.forEach((operation) => {
    totalUnits += operation.type === 'create_normal_artian' ? operation.count : 1
    cumulativeUnits.push(totalUnits)
  })
  const groupIds = new Set(groups.map(({ id }) => id))
  const seenGroupIds = new Set<string>()
  const opportunityIds = new Set<string>()
  groups.forEach((group, groupIndex) => {
    const path = `checkpointGroups[${groupIndex}]`
    validateId(group.id, `${path}.id`, issues)
    if (!group.id.startsWith('checkpoint-group:')) {
      addIssue(issues, `${path}.id`, 'invalid_id', 'Checkpoint group ids use the checkpoint-group prefix.')
    }
    if (seenGroupIds.has(group.id)) {
      addIssue(issues, `${path}.id`, 'invalid_structure', 'Checkpoint group ids must be unique.')
    }
    seenGroupIds.add(group.id)
    if (
      group.dominatingGroupId !== null &&
      (group.dominatingGroupId === group.id || !groupIds.has(group.dominatingGroupId))
    ) {
      addIssue(
        issues,
        `${path}.dominatingGroupId`,
        'invalid_reference',
        'dominatingGroupId must reference another checkpoint group of the same Candidate.',
      )
    }
    validateRestorationBonusScope(group.restorationBonusScope, `${path}.restorationBonusScope`, issues)
    appendIssues(issues, `${path}.restorationBonuses`, validateRestorationBonusSet(group.restorationBonuses))
    if (
      !['ideal', 'practical', 'alternative'].includes(group.conditionMatch.bonus) ||
      !['ideal', 'practical'].includes(group.conditionMatch.skill) ||
      (group.conditionMatch.bonus === 'ideal' && group.conditionMatch.skill === 'ideal')
    ) {
      addIssue(
        issues,
        `${path}.conditionMatch`,
        'invalid_structure',
        'A checkpoint must satisfy a compromise condition, never the full Ideal condition.',
      )
    }
    if (group.restorationBonusScope !== 'gogma_artian') {
      addIssue(
        issues,
        `${path}.restorationBonusScope`,
        'invalid_state',
        'A checkpoint state must have Gogma Artian scope.',
      )
    }
    if (group.opportunities.length === 0) {
      addIssue(issues, `${path}.opportunities`, 'invalid_state', 'A checkpoint group must keep at least one opportunity.')
    }
    if (group.isDisplaySecondary !== (group.dominatingGroupId !== null)) {
      addIssue(
        issues,
        `${path}.isDisplaySecondary`,
        'invalid_state',
        'isDisplaySecondary must match the presence of dominatingGroupId.',
      )
    }
    group.opportunities.forEach((opportunity, index) => {
      const opportunityPath = `${path}.opportunities[${index}]`
      validateId(opportunity.id, `${opportunityPath}.id`, issues)
      if (!opportunity.id.startsWith('checkpoint-opportunity:')) {
        addIssue(issues, `${opportunityPath}.id`, 'invalid_id', 'Checkpoint opportunity ids use the checkpoint-opportunity prefix.')
      }
      if (opportunityIds.has(opportunity.id)) {
        addIssue(issues, `${opportunityPath}.id`, 'invalid_structure', 'Checkpoint opportunity ids must be unique.')
      }
      opportunityIds.add(opportunity.id)
      validateNonNegativeInteger(opportunity.afterOperationIndex, `${opportunityPath}.afterOperationIndex`, issues)
      // The two counts are Route facts, so a current artifact whose stored
      // counts disagree with its own Route is rejected rather than trusted.
      const expectedOperationCount = cumulativeUnits[opportunity.afterOperationIndex]
      if (
        expectedOperationCount !== undefined &&
        opportunity.operationCount !== expectedOperationCount
      ) {
        addIssue(
          issues,
          `${opportunityPath}.operationCount`,
          'invalid_state',
          'operationCount must equal the Route operation units through afterOperationIndex.',
        )
      }
      if (
        expectedOperationCount !== undefined &&
        opportunity.remainingOperationCount !== totalUnits - expectedOperationCount
      ) {
        addIssue(
          issues,
          `${opportunityPath}.remainingOperationCount`,
          'invalid_state',
          'remainingOperationCount must equal the Route operation units after afterOperationIndex.',
        )
      }
      if (
        opportunity.conditionMatch.bonus !== group.conditionMatch.bonus ||
        opportunity.conditionMatch.skill !== group.conditionMatch.skill
      ) {
        addIssue(
          issues,
          `${opportunityPath}.conditionMatch`,
          'invalid_state',
          'An opportunity carries the same compromise judgement as its group.',
        )
      }
      // Strict prefix only: the Ideal-completing final operation is never a
      // checkpoint (`docs/SEARCH_SPEC.md` 5.8.1).
      if (opportunity.afterOperationIndex >= operationCount - 1) {
        addIssue(
          issues,
          `${opportunityPath}.afterOperationIndex`,
          'invalid_range',
          'A checkpoint must end on a strict prefix of the Route.',
        )
      }
      if (index > 0 && opportunity.afterOperationIndex <= group.opportunities[index - 1].afterOperationIndex) {
        addIssue(
          issues,
          `${opportunityPath}.afterOperationIndex`,
          'invalid_structure',
          'Checkpoint opportunities must ascend by Route position.',
        )
      }
      validatePositiveInteger(opportunity.operationCount, `${opportunityPath}.operationCount`, issues)
      validatePositiveInteger(opportunity.remainingOperationCount, `${opportunityPath}.remainingOperationCount`, issues)
      appendIssues(issues, `${opportunityPath}.restorationBonuses`, validateRestorationBonusSet(opportunity.restorationBonuses))
      validateRestorationBonusScope(opportunity.restorationBonusScope, `${opportunityPath}.restorationBonusScope`, issues)
      if (
        opportunity.restorationBonusScope !== group.restorationBonusScope ||
        opportunity.seriesSkillId !== group.seriesSkillId ||
        opportunity.groupSkillId !== group.groupSkillId ||
        !areRestorationBonusSetsEqual(opportunity.restorationBonuses, group.restorationBonuses)
      ) {
        addIssue(
          issues,
          opportunityPath,
          'invalid_state',
          'Every opportunity must reach its own group performance state.',
        )
      }
    })
  })
}

export function validateBuildCandidate(
  candidate: BuildCandidate,
  ownedWeapons?: readonly OwnedWeapon[],
): DomainValidationResult {
  const issues: DomainValidationIssue[] = []
  validateId(candidate.id, 'id', issues)
  validateId(candidate.targetWeaponId, 'targetWeaponId', issues)
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
  validateCandidateCheckpointGroups(candidate, issues)
  validateId(candidate.searchStateHash, 'searchStateHash', issues)
  if (candidate.referencedOwnedWeaponsHash !== null) {
    validateId(candidate.referencedOwnedWeaponsHash, 'referencedOwnedWeaponsHash', issues)
  }
  validateCalculationContext(candidate.calculationContext, 'calculationContext', issues)
  validateId(candidate.searchRunId, 'searchRunId', issues)
  validateCandidateBonusAmendmentTrace(candidate, issues)
  validateCandidateSkillAmendmentTrace(candidate, issues)
  validateCandidateConversionSkillTrace(candidate, issues)

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

/**
 * The selected checkpoints are a hard Planner constraint, so an unknown id or a
 * second selection inside one group fails closed rather than being ignored
 * (`docs/DATA_MODEL.md` 9.4).
 *
 * Shared with the Planner's current-input validation: a malformed selection
 * must never reach `selectedCheckpointsForEntry()`, which would read it as an
 * empty selection (`docs/PLANNER_SPEC.md` 7.5.9).
 */
export function validateBuildListEntryCheckpointSelection(
  entry: BuildListEntry,
): DomainValidationResult {
  const issues: DomainValidationIssue[] = []
  appendCheckpointSelectionIssues(entry, issues)
  return result(issues)
}

function appendCheckpointSelectionIssues(
  entry: BuildListEntry,
  issues: DomainValidationIssue[],
): void {
  const selected = entry.selectedCheckpointOpportunityIds
  if (selected === undefined || selected.length === 0) return
  const groupIdByOpportunityId = new Map<string, string>()
  for (const group of entry.candidateSnapshot.checkpointGroups ?? []) {
    for (const opportunity of group.opportunities) {
      groupIdByOpportunityId.set(opportunity.id, group.id)
    }
  }
  const selectedGroupIds = new Set<string>()
  const seen = new Set<string>()
  selected.forEach((opportunityId, index) => {
    const path = `selectedCheckpointOpportunityIds[${index}]`
    const groupId = groupIdByOpportunityId.get(opportunityId)
    if (groupId === undefined) {
      addIssue(
        issues,
        path,
        'invalid_reference',
        'A selected checkpoint opportunity must exist in the candidate snapshot.',
      )
      return
    }
    if (seen.has(opportunityId)) {
      addIssue(issues, path, 'invalid_structure', 'A checkpoint opportunity must not be selected twice.')
      return
    }
    seen.add(opportunityId)
    if (selectedGroupIds.has(groupId)) {
      addIssue(
        issues,
        path,
        'invalid_state',
        'At most one opportunity may be selected per checkpoint group.',
      )
      return
    }
    selectedGroupIds.add(groupId)
  })
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
  appendCheckpointSelectionIssues(entry, issues)
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
    'reset_bonuses',
    'keep_bonuses',
    'reset_skills',
    'reserve_weapon',
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
  if (step.progressedTargetWeaponIds !== undefined) {
    if (!Array.isArray(step.progressedTargetWeaponIds)) {
      addIssue(
        issues,
        `${path}.progressedTargetWeaponIds`,
        'invalid_structure',
        'progressedTargetWeaponIds must be an array when present.',
      )
    } else {
      step.progressedTargetWeaponIds.forEach((id, index) =>
        validateId(id, `${path}.progressedTargetWeaponIds[${index}]`, issues),
      )
      if (
        new Set(step.progressedTargetWeaponIds).size !==
        step.progressedTargetWeaponIds.length
      ) {
        addIssue(
          issues,
          `${path}.progressedTargetWeaponIds`,
          'invalid_state',
          'progressedTargetWeaponIds must not contain duplicates.',
        )
      }
    }
  }
  if (step.isCompleted && step.completedAt === null) {
    addIssue(issues, `${path}.completedAt`, 'invalid_state', 'A completed PlanStep requires completedAt.')
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
