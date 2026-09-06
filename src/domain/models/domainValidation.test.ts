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
  canUseAsMaterial,
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
import { createExpectedPlanState } from './hashing'
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
  ownedWeaponId,
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
  it.each(['material', 'practical', 'ideal'] as const)(
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
    expect(createOwnedWeapon({ ...input, status: 'material' }, DOMAIN_FIXTURE_TIME).isProtected).toBe(false)
    expect(createOwnedWeapon({ ...input, status: 'practical' }, DOMAIN_FIXTURE_TIME).isProtected).toBe(true)
    expect(createOwnedWeapon({ ...input, status: 'ideal' }, DOMAIN_FIXTURE_TIME).isProtected).toBe(true)
    expect(
      createOwnedWeapon(
        { ...input, status: 'material', isProtected: true },
        DOMAIN_FIXTURE_TIME,
      ).isProtected,
    ).toBe(true)
  })

  it('blocks protected destructive use but allows Reset Skills', () => {
    const weapon = createValidOwnedWeapon()
    expect(canUseAsMaterial(weapon)).toBe(false)
    expect(canResetBonuses(weapon)).toBe(false)
    expect(canKeepBonuses(weapon)).toBe(false)
    expect(canResetSkills(weapon)).toBe(true)
  })

  it('allows only unprotected Material weapons as material', () => {
    const weapon = {
      ...createValidOwnedWeapon(),
      status: 'material' as const,
      isProtected: false,
    }
    expect(canUseAsMaterial(weapon)).toBe(true)
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
    target.practicalBonusConditions[0].requiredCount = 0
    target.practicalBonusConditions[0].requiredExCount = 2
    expect(validateTargetWeapon(target).isValid).toBe(false)
  })

  it('rejects invalid AlternativeGroup ranges and empty options', () => {
    const target = createValidTargetWeapon()
    target.practicalAlternativeGroups[0].requiredCount = 6
    target.practicalAlternativeGroups[0].options = []
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

  it('validates create_material_gogma as a zero-RNG Material registration step', () => {
    const plan = createValidProductionPlan()
    const material = {
      ...createValidOwnedWeapon(),
      status: 'material' as const,
      isProtected: false,
    }
    const rngState = createValidRngState()
    const counters = [createValidNormalArtianCounter()]
    plan.steps[0] = {
      ...plan.steps[0],
      operationType: 'create_material_gogma',
      targetWeaponId: null,
      buildListEntryId: null,
      candidateId: null,
      ownedWeaponId: material.id,
      expectedResult: {
        restorationBonuses: material.restorationBonuses,
        restorationBonusScope: material.restorationBonusScope, seriesSkillId: material.seriesSkillId,
        groupSkillId: material.groupSkillId,
        candidateCategory: null,
        isSimilarToIdeal: false,
        shouldSecure: true,
      },
      expectedStateBefore: createExpectedPlanState(rngState, counters, []),
      expectedStateAfter: createExpectedPlanState(
        rngState,
        counters,
        [material],
      ),
      inventoryChange: {
        addOwnedWeapon: material,
        removeOwnedWeaponIds: [],
        updateOwnedWeapons: [],
        materialRequirements: [],
      },
      rngAdvance: {
        gogmaCounterDelta: 0,
        skillCounterDelta: 0,
        normalCounterDelta: null,
        affectedNormalCounterId: null,
      },
      requiresUserConfirmation: true,
    }
    expect(validateProductionPlan(plan).isValid).toBe(true)

    plan.steps[0].rngAdvance.gogmaCounterDelta = 1
    expect(validateProductionPlan(plan).issues).toContainEqual(
      expect.objectContaining({
        path: 'steps[0].rngAdvance',
        code: 'invalid_state',
      }),
    )
    plan.steps[0].rngAdvance.gogmaCounterDelta = 0
    plan.steps[0].targetWeaponId = targetWeaponId('target.fixture.unexpected')
    expect(validateProductionPlan(plan).issues).toContainEqual(
      expect.objectContaining({
        path: 'steps[0]',
        code: 'invalid_state',
      }),
    )
    plan.steps[0].targetWeaponId = null
    plan.steps[0].ownedWeaponId = ownedWeaponId('owned.fixture.other')
    expect(validateProductionPlan(plan).issues).toContainEqual(
      expect.objectContaining({
        path: 'steps[0].ownedWeaponId',
        code: 'invalid_reference',
      }),
    )
    plan.steps[0].ownedWeaponId = material.id
    const inventoryChange = plan.steps[0].inventoryChange
    if (inventoryChange === null) throw new Error('fixture inventoryChange is required')
    plan.steps[0].inventoryChange = {
      ...inventoryChange,
      addOwnedWeapon: {
        ...material,
        status: 'practical',
      },
    }
    expect(validateProductionPlan(plan).issues).toContainEqual(
      expect.objectContaining({
        path: 'steps[0].inventoryChange.addOwnedWeapon',
        code: 'invalid_state',
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
  it('accepts historical record shapes but rejects schema 1 calculation reuse under schema 2', () => {
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
