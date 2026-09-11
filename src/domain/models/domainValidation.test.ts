import { CURRENT_CALCULATION_APP_SCHEMA_VERSION } from './publicTypes'
import { describe, expect, it } from 'vitest'
import type { NormalArtianCounter, TargetWeapon } from './publicTypes'
import {
  createOwnedWeapon,
  createTargetWeapon,
  type CreateTargetWeaponInput,
} from './factories'
import {
  areRestorationBonusSetsEqual,
  canKeepBonuses,
  canResetBonuses,
  canResetSkills,
  isCalculationContextCompatible,
  isSkillConditionUnconstrained,
} from './domainRules'
import {
  validateAppSettings,
  validateBuildCandidate,
  validateBuildListEntry,
  validateExecutionHistory,
  validateKnownValue,
  validateNormalArtianCounter,
  validateOwnedWeapon,
  validateProductionPlan,
  validateRestorationBonusSet,
  validateRngState,
  validateTargetWeapon,
} from './validation'
import {
  DOMAIN_FIXTURE_TIME,
  createRestorationBonusSet,
  createValidBuildCandidate,
  createValidBuildListEntry,
  createValidExecutionHistory,
  createValidNormalArtianCounter,
  createValidOwnedWeapon,
  createValidProductionPlan,
  createValidRngState,
  createValidTargetWeapon,
  domainFixtureContext,
  targetWeaponId,
} from '../../test/fixtures/domainData'
import { createDefaultAppSettings } from './factories'

describe('KnownValue and RNG validation', () => {
  it('rejects confirmed plus null', () => {
    expect(
      validateKnownValue({ value: null, isConfirmed: true, source: 'manual' })
        .isValid,
    ).toBe(false)
  })

  it('rejects a null value marked as confirmed', () => {
    const result = validateKnownValue<number>({
      value: null,
      isConfirmed: true,
      source: null,
    })
    expect(result.issues).toContainEqual(
      expect.objectContaining({ path: 'isConfirmed', code: 'invalid_state' }),
    )
  })

  it('accepts a valid partial RNG state', () => {
    expect(validateRngState(createValidRngState()).isValid).toBe(true)
  })

  it('rejects a negative confirmed counter', () => {
    const state = createValidRngState()
    state.gogmaCounter.value = -1
    expect(validateRngState(state).isValid).toBe(false)
  })

  it('validates the NormalArtianCounter ID and ranges', () => {
    const counter = createValidNormalArtianCounter()
    expect(validateNormalArtianCounter(counter).isValid).toBe(true)
    counter.id = 'wrong'
    counter.observationCount = -1
    expect(validateNormalArtianCounter(counter).isValid).toBe(false)
  })

  it.each([6, 7])('rejects rarity %i NormalArtianCounter in v1', (rarity) => {
    const counter = {
      ...createValidNormalArtianCounter(),
      id: `weapon.fixture.a:${rarity}`,
      rarity,
    }
    expect(
      validateNormalArtianCounter(
        counter as unknown as NormalArtianCounter,
      ).isValid,
    ).toBe(false)
  })
})

describe('RestorationBonusSet rules', () => {
  it('accepts exactly five slots and rejects other lengths', () => {
    const bonuses = createRestorationBonusSet()
    expect(validateRestorationBonusSet(bonuses).isValid).toBe(true)
    expect(validateRestorationBonusSet(bonuses.slice(0, 4)).isValid).toBe(false)
  })

  it('compares slot-independent multisets', () => {
    const left = createRestorationBonusSet()
    const right = [left[4], left[2], left[0], left[3], left[1]] as typeof left
    expect(areRestorationBonusSetsEqual(left, right)).toBe(true)
  })

  it('preserves duplicate-count semantics', () => {
    const left = createRestorationBonusSet()
    const right = createRestorationBonusSet()
    right[1] = { ...right[2] }
    expect(areRestorationBonusSetsEqual(left, right)).toBe(false)
  })
})

describe('OwnedWeapon rules', () => {
  it.each(['unclassified', 'practical', 'ideal'] as const)(
    'accepts the %s status without coupling status and protection',
    (status) => {
      const weapon = { ...createValidOwnedWeapon(), status }
      expect(validateOwnedWeapon(weapon).isValid).toBe(true)
    },
  )

  it('uses status-specific protection defaults only at creation', () => {
    const base = createValidOwnedWeapon()
    const { isProtected, createdAt, updatedAt, ...input } = base
    void isProtected
    void createdAt
    void updatedAt
    expect(createOwnedWeapon({ ...input, status: 'unclassified' }, DOMAIN_FIXTURE_TIME).isProtected).toBe(false)
    expect(createOwnedWeapon({ ...input, status: 'practical' }, DOMAIN_FIXTURE_TIME).isProtected).toBe(false)
    expect(createOwnedWeapon({ ...input, status: 'ideal' }, DOMAIN_FIXTURE_TIME).isProtected).toBe(true)
    expect(
      createOwnedWeapon(
        { ...input, status: 'unclassified', isProtected: true },
        DOMAIN_FIXTURE_TIME,
      ).isProtected,
    ).toBe(true)
  })

  it('blocks every protected performance mutation including Reset Skills', () => {
    const weapon = createValidOwnedWeapon()
    expect(canResetBonuses(weapon)).toBe(false)
    expect(canKeepBonuses(weapon)).toBe(false)
    expect(canResetSkills(weapon)).toBe(false)
  })

  it('allows every Gogma amendment when the source is unprotected', () => {
    const weapon = { ...createValidOwnedWeapon(), isProtected: false }
    expect(canResetBonuses(weapon)).toBe(true)
    expect(canKeepBonuses(weapon)).toBe(true)
    expect(canResetSkills(weapon)).toBe(true)
  })

  it('never gates an amendment on status: every label behaves identically', () => {
    for (const status of ['unclassified', 'practical', 'ideal'] as const) {
      const weapon = { ...createValidOwnedWeapon(), status, isProtected: false }
      expect(canResetBonuses(weapon)).toBe(true)
      expect(canKeepBonuses(weapon)).toBe(true)
      expect(canResetSkills(weapon)).toBe(true)
    }
  })
})

describe('TargetWeapon rules', () => {
  it('accepts priorities 1 through 5 and rejects values outside the range', () => {
    const target = createValidTargetWeapon()
    for (const priority of [1, 2, 3, 4, 5] as const) {
      expect(validateTargetWeapon({ ...target, priority }).isValid).toBe(true)
    }
    expect(
      validateTargetWeapon({ ...target, priority: 0 as TargetWeapon['priority'] })
        .isValid,
    ).toBe(false)
  })

  it('defaults target priority to 3', () => {
    const target = createValidTargetWeapon()
    const { priority, createdAt, updatedAt, ...input } = target
    void priority
    void createdAt
    void updatedAt
    expect(
      createTargetWeapon(
        input as CreateTargetWeaponInput,
        DOMAIN_FIXTURE_TIME,
      ).priority,
    ).toBe(3)
  })

  it('rejects invalid BonusCondition ranges', () => {
    const target = createValidTargetWeapon()
    target.practicalBonusConditions[0].requiredExCount = -1
    target.practicalBonusConditions[0].requiredExCount = 3
    expect(validateTargetWeapon(target).isValid).toBe(false)
  })

  it('rejects invalid AlternativeGroup ranges and empty options', () => {
    const target = createValidTargetWeapon()
    target.alternativeBonusRules[0].maxReplacementCount = 6
    target.alternativeBonusRules[0].options = []
    expect(validateTargetWeapon(target).isValid).toBe(false)
  })

  it('treats a skill condition with both IDs null as unconstrained', () => {
    expect(
      isSkillConditionUnconstrained({
        seriesSkillId: null,
        groupSkillId: null,
        matchMode: 'any',
      }),
    ).toBe(true)
  })
})

describe('complete Domain fixture validation', () => {
  it('accepts valid candidate, entry, plan, execution, and settings fixtures', () => {
    expect(validateBuildCandidate(createValidBuildCandidate()).isValid).toBe(true)
    expect(validateBuildListEntry(createValidBuildListEntry()).isValid).toBe(true)
    expect(validateProductionPlan(createValidProductionPlan()).isValid).toBe(true)
    expect(validateExecutionHistory(createValidExecutionHistory()).isValid).toBe(true)
    expect(validateAppSettings(createDefaultAppSettings(DOMAIN_FIXTURE_TIME)).isValid).toBe(true)
  })

  it('compares all CalculationContext fields', () => {
    expect(
      isCalculationContextCompatible(domainFixtureContext, {
        ...domainFixtureContext,
      }),
    ).toBe(true)
    const incompatibleContexts = [
      { ...domainFixtureContext, gameVersion: 'changed' },
      { ...domainFixtureContext, masterDataVersion: 2 },
      { ...domainFixtureContext, rngEngineVersion: 'changed' },
      { ...domainFixtureContext, appSchemaVersion: 2 },
    ]
    incompatibleContexts.forEach((context) =>
      expect(
        isCalculationContextCompatible(domainFixtureContext, context),
      ).toBe(false),
    )
  })

  it('rejects inconsistent BuildList, Plan, and Execution snapshots', () => {
    const entry = createValidBuildListEntry()
    entry.searchStateHash = 'hash.fixture.changed'
    expect(validateBuildListEntry(entry).isValid).toBe(false)

    const plan = createValidProductionPlan()
    plan.currentStepId = 'step.fixture.missing' as typeof plan.currentStepId
    expect(validateProductionPlan(plan).isValid).toBe(false)

    const history = createValidExecutionHistory()
    history.wasExpected = false
    expect(validateExecutionHistory(history).isValid).toBe(false)
  })

  it('accepts a legacy Plan without progressedTargetWeaponIds and validates it when present', () => {
    const legacy = createValidProductionPlan()
    expect(legacy.steps[0].progressedTargetWeaponIds).toBeUndefined()
    expect(validateProductionPlan(legacy).isValid).toBe(true)

    const shared = createValidProductionPlan()
    shared.steps[0].progressedTargetWeaponIds = [
      targetWeaponId('target.fixture.a'),
      targetWeaponId('target.fixture.b'),
    ]
    expect(validateProductionPlan(shared).isValid).toBe(true)

    const empty = createValidProductionPlan()
    empty.steps[0].progressedTargetWeaponIds = []
    expect(validateProductionPlan(empty).isValid).toBe(true)

    const invalid = createValidProductionPlan()
    invalid.steps[0].progressedTargetWeaponIds = [targetWeaponId(' ')]
    expect(validateProductionPlan(invalid).issues).toContainEqual(
      expect.objectContaining({
        path: 'steps[0].progressedTargetWeaponIds[0]',
        code: 'invalid_id',
      }),
    )

    const duplicated = createValidProductionPlan()
    duplicated.steps[0].progressedTargetWeaponIds = [
      targetWeaponId('target.fixture.a'),
      targetWeaponId('target.fixture.a'),
    ]
    expect(validateProductionPlan(duplicated).issues).toContainEqual(
      expect.objectContaining({
        path: 'steps[0].progressedTargetWeaponIds',
        code: 'invalid_state',
      }),
    )
  })

  it.each([
    'create_material_gogma',
    'use_weapon_as_material',
    'change_owned_weapon_status',
  ])('rejects the removed weapon-as-material PlanStep operation %s', (operationType) => {
    // The owned-weapon-as-material model is gone, so a persisted legacy Plan
    // carrying one of these can never be revalidated into a current Plan
    // (`docs/PLANNER_SPEC.md` 8). Its contents stay readable; the
    // CalculationContext boundary is what fails it closed.
    const plan = createValidProductionPlan()
    plan.steps[0].operationType =
      operationType as typeof plan.steps[0]['operationType']
    expect(validateProductionPlan(plan).issues).toContainEqual(
      expect.objectContaining({
        path: 'steps[0].operationType',
        code: 'invalid_literal',
      }),
    )
  })

  it('rejects recalculate_plan as a PlanStep operation', () => {
    const plan = createValidProductionPlan()
    plan.steps[0].operationType =
      'recalculate_plan' as typeof plan.steps[0]['operationType']
    expect(validateProductionPlan(plan).issues).toContainEqual(
      expect.objectContaining({
        path: 'steps[0].operationType',
        code: 'invalid_literal',
      }),
    )
  })
})

describe('B5-F1 persisted calculation compatibility', () => {
  it('accepts historical record shapes but rejects schema 1 calculation reuse under schema 3', () => {
    const candidate = createValidBuildCandidate()
    const entry = createValidBuildListEntry()
    const plan = createValidProductionPlan()
    expect(validateBuildCandidate(candidate).isValid).toBe(true)
    expect(validateBuildListEntry(entry).isValid).toBe(true)
    expect(validateProductionPlan(plan).isValid).toBe(true)
    for (const stored of [candidate, entry, plan]) {
      const context = stored.calculationContext
      expect(context.appSchemaVersion).toBe(1)
      const current = { ...context, appSchemaVersion: CURRENT_CALCULATION_APP_SCHEMA_VERSION }
      expect(isCalculationContextCompatible(context, current)).toBe(false)
      expect(isCalculationContextCompatible(current, context)).toBe(false)
      expect(context.appSchemaVersion).toBe(1)
    }
  })
})
