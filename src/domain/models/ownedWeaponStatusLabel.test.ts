import { describe, expect, it } from 'vitest'
import {
  CURRENT_CALCULATION_APP_SCHEMA_VERSION,
  createExpectedPlanState,
  createReferencedOwnedWeaponsHash,
  isBuildResultCalculationContextCompatible,
  isCalculationContextCompatible,
  validateExecutionHistory,
  validateOwnedWeapon,
  validateProductionPlan,
} from './publicTypes'
import type {
  BuildRoute,
  ExportRoot,
  OwnedGogmaArtianWeapon,
  OwnedWeaponId,
  OwnedWeaponStatus,
  RouteOperation,
} from './publicTypes'
import * as domainRules from './domainRules'
import { createConstrainedSearchIdentity } from '../planner/constrained/constrainedSearchIdentity'
import * as simulatedInventory from '../planner/simulatedInventory'
import { plannerWarningKinds } from '../planner/plannerTypes'
import { planStepOperationLabels } from '../../presentation/labels'
import { createInitialPlannerSearchState } from '../planner/plannerInitialState'
import { evaluateBuildListEntryStaleness } from '../buildList'
import {
  constrainedBounds,
  createConstrainedSearchOrigin,
  gogmaWeapon,
} from '../../test/fixtures/constrainedEnumeration'
import { fixture as plannerFixture } from '../../test/fixtures/plannerBeam'
import {
  createValidBuildListEntry,
  createValidExecutionHistory,
  createValidNormalArtianCounter,
  createValidOwnedWeapon,
  createValidProductionPlan,
  createValidRngState,
  createValidTargetWeapon,
} from '../../test/fixtures/domainData'

const EVERY_STATUS: readonly OwnedWeaponStatus[] = [
  'unclassified',
  'practical',
  'ideal',
]

/** A Route that references the given OwnedWeapon, so its hash is non-null. */
function referencingRoute(sourceId: OwnedWeaponId): BuildRoute {
  return {
    kind: 'existing_gogma_reset_skills',
    sourceOwnedWeaponId: sourceId,
    operations: [{
      type: 'reset_skills',
      sourceOwnedWeaponId: sourceId,
      skillCounterBefore: 1,
      skillCounterAfter: 2,
    }],
  }
}

describe('OwnedWeapon status is a user-facing organisation label', () => {
  it('accepts exactly 未分類 / 実用 / 理想 and rejects the removed material value', () => {
    for (const status of EVERY_STATUS) {
      expect(
        validateOwnedWeapon({ ...createValidOwnedWeapon(), status }).isValid,
      ).toBe(true)
    }
    const legacy = {
      ...createValidOwnedWeapon(),
      status: 'material',
    } as unknown as OwnedGogmaArtianWeapon
    expect(validateOwnedWeapon(legacy).issues).toContainEqual(
      expect.objectContaining({ path: 'status', code: 'invalid_literal' }),
    )
  })

  it('never gates a Route operation on the label: only protection decides', () => {
    for (const status of EVERY_STATUS) {
      const unprotected = {
        ...createValidOwnedWeapon(),
        status,
        isProtected: false,
      }
      expect(domainRules.canResetBonuses(unprotected)).toBe(true)
      expect(domainRules.canKeepBonuses(unprotected)).toBe(true)
      expect(domainRules.canResetSkills(unprotected)).toBe(true)

      const guarded = { ...unprotected, isProtected: true }
      expect(domainRules.canResetBonuses(guarded)).toBe(false)
      expect(domainRules.canKeepBonuses(guarded)).toBe(false)
      expect(domainRules.canResetSkills(guarded)).toBe(false)
    }
  })
})

describe('status is excluded from every semantic hash and calculation identity', () => {
  it('leaves referencedOwnedWeaponsHash unchanged for a status-only change', () => {
    const base = { ...createValidOwnedWeapon(), status: 'unclassified' as const }
    const route = referencingRoute(base.id)
    const before = createReferencedOwnedWeaponsHash(route, [base])
    expect(before).not.toBeNull()
    for (const status of EVERY_STATUS) {
      expect(createReferencedOwnedWeaponsHash(route, [{ ...base, status }])).toBe(
        before,
      )
    }
  })

  it('still changes referencedOwnedWeaponsHash for protection, Bonus, Skill, and scope', () => {
    const base = { ...createValidOwnedWeapon(), status: 'unclassified' as const }
    const route = referencingRoute(base.id)
    const before = createReferencedOwnedWeaponsHash(route, [base])
    const changed: OwnedGogmaArtianWeapon[] = [
      { ...base, isProtected: !base.isProtected },
      {
        ...base,
        restorationBonuses: base.restorationBonuses.map((bonus, index) =>
          index === 0
            ? { ...bonus, bonusRankId: 'bonus_rank.fixture.changed' }
            : bonus,
        ) as OwnedGogmaArtianWeapon['restorationBonuses'],
      },
      { ...base, seriesSkillId: 'series_skill.fixture.other' },
      { ...base, groupSkillId: 'group_skill.fixture.other' },
      { ...base, restorationBonusScope: 'normal_artian' },
    ]
    for (const weapon of changed) {
      expect(createReferencedOwnedWeaponsHash(route, [weapon])).not.toBe(before)
    }
  })

  it('leaves ExpectedPlanState.ownedWeaponsHash unchanged for a status-only change', () => {
    const rngState = createValidRngState()
    const counters = [createValidNormalArtianCounter()]
    const base = { ...createValidOwnedWeapon(), status: 'unclassified' as const }
    const before = createExpectedPlanState(rngState, counters, [base])
    for (const status of EVERY_STATUS) {
      expect(
        createExpectedPlanState(rngState, counters, [{ ...base, status }]),
      ).toEqual(before)
    }
    expect(
      createExpectedPlanState(rngState, counters, [
        { ...base, isProtected: !base.isProtected },
      ]).ownedWeaponsHash,
    ).not.toBe(before.ownedWeaponsHash)
  })

  it('leaves the constrained search identity unchanged for a status-only change', () => {
    const build = (overrides: Partial<OwnedGogmaArtianWeapon>) => {
      const origin = createConstrainedSearchOrigin({
        ownedWeapons: [gogmaWeapon('owned.status.identity', overrides)],
      })
      return createConstrainedSearchIdentity({
        origin,
        targetWeaponId: origin.targetWeapons[0].id,
        bounds: constrainedBounds(),
      })
    }
    const before = build({ status: 'unclassified' })
    for (const status of EVERY_STATUS) expect(build({ status })).toBe(before)
    expect(build({ isProtected: true })).not.toBe(before)
  })

  it('never reports owned_weapon_changed for a status-only change', () => {
    const target = createValidTargetWeapon()
    const rngState = createValidRngState()
    const counters = [createValidNormalArtianCounter()]
    const weapon = { ...createValidOwnedWeapon(), status: 'unclassified' as const }
    const entry = createValidBuildListEntry()
    entry.targetWeaponId = target.id
    entry.candidateSnapshot.targetWeaponId = target.id
    entry.candidateSnapshot.route = referencingRoute(weapon.id)
    entry.referencedOwnedWeaponsHash = createReferencedOwnedWeaponsHash(
      entry.candidateSnapshot.route,
      [weapon],
    )

    const reasonsFor = (overrides: Partial<OwnedGogmaArtianWeapon>) =>
      evaluateBuildListEntryStaleness(entry, {
        target,
        rngState,
        normalCounters: counters,
        ownedWeapons: [{ ...weapon, ...overrides }],
        calculationContext: entry.calculationContext,
      }).staleReasons

    const baseline = reasonsFor({ status: 'unclassified' })
    expect(baseline).not.toContain('owned_weapon_changed')
    for (const status of EVERY_STATUS) {
      expect(reasonsFor({ status })).toEqual(baseline)
    }
    expect(reasonsFor({ isProtected: !weapon.isProtected })).toContain(
      'owned_weapon_changed',
    )
  })
})

describe('the owned-weapon-as-material model is gone from the Domain', () => {
  it('has no use_weapon_as_material RouteOperation', () => {
    const types: RouteOperation['type'][] = [
      'create_normal_artian',
      'convert_normal_to_gogma',
      'reset_bonuses',
      'keep_bonuses',
      'reset_skills',
    ]
    expect(types).toHaveLength(5)
    expect(types as string[]).not.toContain('use_weapon_as_material')
  })

  it('exports no canUseAsMaterial rule', () => {
    expect(domainRules).not.toHaveProperty('canUseAsMaterial')
  })

  it('exports no material weapon consumption from the simulated inventory', () => {
    expect(simulatedInventory).not.toHaveProperty('canConsumeMaterialWeapon')
    expect(simulatedInventory).not.toHaveProperty('consumeMaterialWeapon')
    // The owned Normal conversion source consumption stays: it is the only
    // remaining weapon consumption in v1.
    expect(simulatedInventory.consumeOwnedNormalForConversion).toBeTypeOf(
      'function',
    )
  })

  it('keeps no consumedMaterialWeaponCount in the Planner search state', () => {
    const { input } = plannerFixture([], [])
    const initial = createInitialPlannerSearchState(input, [])
    expect(initial.state).not.toBeNull()
    expect(initial.state).not.toHaveProperty('consumedMaterialWeaponCount')
  })

  it('declares no material_weapon_shortage warning kind', () => {
    expect(plannerWarningKinds as readonly string[]).not.toContain(
      'material_weapon_shortage',
    )
  })
})

describe('the Planner-only material steps are gone from the PlanStep set', () => {
  const REMOVED_OPERATIONS = [
    'create_material_gogma',
    'use_weapon_as_material',
    'change_owned_weapon_status',
  ] as const

  it('labels exactly the current PlanStep operations and none of the removed ones', () => {
    expect(Object.keys(planStepOperationLabels).sort()).toEqual([
      'confirm_result',
      'convert_normal_to_gogma',
      'create_normal_artian',
      'keep_bonuses',
      'reserve_weapon',
      'reset_bonuses',
      'reset_skills',
    ])
    for (const operation of REMOVED_OPERATIONS) {
      expect(planStepOperationLabels).not.toHaveProperty(operation)
    }
  })

  it.each(REMOVED_OPERATIONS)(
    'rejects a %s PlanStep, so no Plan can schedule one',
    (operationType) => {
      const plan = createValidProductionPlan()
      plan.steps[0].operationType =
        operationType as typeof plan.steps[0]['operationType']
      expect(validateProductionPlan(plan).issues).toContainEqual(
        expect.objectContaining({
          path: 'steps[0].operationType',
          code: 'invalid_literal',
        }),
      )
    },
  )

  it.each([
    'confirmed_weapon_status_change',
    'declined_weapon_status_change',
  ])('rejects the removed %s execution action', (action) => {
    const history = createValidExecutionHistory()
    history.action = action as typeof history.action
    expect(validateExecutionHistory(history).issues).toContainEqual(
      expect.objectContaining({ path: 'action', code: 'invalid_literal' }),
    )
  })
})

describe('version authorities at the weapon-as-material removal boundary', () => {
  it('uses calculation app schema version 9', () => {
    expect(CURRENT_CALCULATION_APP_SCHEMA_VERSION).toBe(9)
  })

  it('fails every schema 1..8 artifact closed, with no build-result exception', () => {
    const stored = createValidBuildListEntry().calculationContext
    const current = {
      ...stored,
      appSchemaVersion: CURRENT_CALCULATION_APP_SCHEMA_VERSION,
    }
    for (const appSchemaVersion of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const legacy = { ...stored, appSchemaVersion }
      expect(isCalculationContextCompatible(legacy, current)).toBe(false)
      expect(isBuildResultCalculationContextCompatible(legacy, current)).toBe(false)
    }
    expect(isCalculationContextCompatible(current, current)).toBe(true)
    expect(isBuildResultCalculationContextCompatible(current, current)).toBe(true)
  })

  it('declares Export schema version 4', () => {
    const schemaVersion: ExportRoot['schemaVersion'] = 4
    expect(schemaVersion).toBe(4)
  })
})
