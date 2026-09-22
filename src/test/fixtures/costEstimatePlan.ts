import type {
  PlanStep,
  PlanStepExecutionEffects,
  ProductionPlan,
  TargetWeapon,
} from '../../domain/models/publicTypes'
import {
  buildListEntryId,
  createValidOwnedWeapon,
  createValidProductionPlan,
  createValidTargetWeapon,
  ownedWeaponId,
  planStepId,
  targetWeaponId,
} from './domainData'

export function costPlanEffects(
  overrides: Partial<PlanStepExecutionEffects> = {},
): PlanStepExecutionEffects {
  return {
    trackedOwnedWeaponId: null,
    normalCreationRole: null,
    registersTrackedWeapon: false,
    observationBinding: null,
    targetLinks: [],
    compromiseLabels: [],
    targetCompletions: [],
    ...overrides,
  }
}

/** A current-contract physical Step; every field a cost estimate reads is explicit. */
export function costPlanStep(
  id: string,
  order: number,
  overrides: Partial<PlanStep> = {},
): PlanStep {
  const base = createValidProductionPlan().steps[0]
  return {
    ...base,
    id: planStepId(id),
    order,
    title: `Step ${order}`,
    instruction: `Instruction ${order}`,
    candidateId: null,
    ownedWeaponId: null,
    expectedResult: null,
    inventoryChange: null,
    executionEffects: costPlanEffects(),
    progressedTargetWeaponIds: [],
    ...overrides,
  }
}

export const COST_PLAN_TARGET_A = targetWeaponId('target.cost.a')
export const COST_PLAN_TARGET_B = targetWeaponId('target.cost.b')
export const COST_PLAN_TARGET_C = targetWeaponId('target.cost.c')
export const COST_PLAN_ENTRY_A = buildListEntryId('build-list.cost.a')
export const COST_PLAN_ENTRY_B = buildListEntryId('build-list.cost.b')
export const COST_PLAN_ENTRY_C = buildListEntryId('build-list.cost.c')

/**
 * A three-Target Plan as the Planner persists it:
 *
 * - Target A: a new Great Sword Normal (two Counter-advance forges, the
 *   production-target forge that registers the weapon, conversion, Reset
 *   Bonuses, Reset Skills)
 * - Target B: an existing Gogma (Keep Bonuses, two Reset Skills), whose Route
 *   also progressed through Target A's Reset Bonuses Step (one shared
 *   physical Step, `progressedTargetWeaponIds = [A, B]`)
 * - Target C: an owned Ideal confirmed by `confirm_owned_ideal`
 *
 * Expected whole-Plan estimate: 3 forges (砕かれた古刃 ×6, 潰された古筒 ×3,
 * 30,000z), 1 full restoration (ナナイロカネ ×50, 10,000z), 1 conversion
 * (油濁した遺装置 ×3, 30,000z), 2 Gogma restorations (ナナイロカネ ×40 or
 * 歴戦錬磨の証 ×4, 10,000z), 3 Skill reassignments (油濁した遺装置 ×18 / ×9,
 * 27,000z): 107,000z. Summing the three Targets' own Routes would count the
 * shared Reset Bonuses Step twice.
 */
export function createMultiTargetCostPlanFixture(): {
  plan: ProductionPlan
  targets: TargetWeapon[]
} {
  const registeredNormal = {
    ...createValidOwnedWeapon(ownedWeaponId('owned.cost.a')),
    weaponTypeId: 'weapon.great_sword',
  }
  const forA = { targetWeaponId: COST_PLAN_TARGET_A, buildListEntryId: COST_PLAN_ENTRY_A, progressedTargetWeaponIds: [COST_PLAN_TARGET_A] }
  const forB = { targetWeaponId: COST_PLAN_TARGET_B, buildListEntryId: COST_PLAN_ENTRY_B, progressedTargetWeaponIds: [COST_PLAN_TARGET_B] }
  const forC = { targetWeaponId: COST_PLAN_TARGET_C, buildListEntryId: COST_PLAN_ENTRY_C, progressedTargetWeaponIds: [COST_PLAN_TARGET_C] }
  const steps: PlanStep[] = [
    costPlanStep('step.cost.1', 1, {
      ...forA,
      operationType: 'create_normal_artian',
      executionEffects: costPlanEffects({ normalCreationRole: 'counter_advance' }),
    }),
    costPlanStep('step.cost.2', 2, {
      ...forA,
      operationType: 'create_normal_artian',
      executionEffects: costPlanEffects({ normalCreationRole: 'counter_advance' }),
    }),
    costPlanStep('step.cost.3', 3, {
      ...forA,
      operationType: 'create_normal_artian',
      ownedWeaponId: registeredNormal.id,
      executionEffects: costPlanEffects({
        trackedOwnedWeaponId: registeredNormal.id,
        normalCreationRole: 'production_target',
        registersTrackedWeapon: true,
      }),
      inventoryChange: {
        addOwnedWeapon: registeredNormal,
        removeOwnedWeaponIds: [],
        updateOwnedWeapons: [],
        materialRequirements: [],
      },
    }),
    costPlanStep('step.cost.4', 4, { ...forA, operationType: 'convert_normal_to_gogma' }),
    costPlanStep('step.cost.5', 5, {
      ...forA,
      operationType: 'reset_bonuses',
      progressedTargetWeaponIds: [COST_PLAN_TARGET_A, COST_PLAN_TARGET_B],
    }),
    costPlanStep('step.cost.6', 6, { ...forA, operationType: 'reset_skills' }),
    costPlanStep('step.cost.7', 7, { ...forB, operationType: 'keep_bonuses' }),
    costPlanStep('step.cost.8', 8, { ...forB, operationType: 'reset_skills' }),
    costPlanStep('step.cost.9', 9, { ...forB, operationType: 'reset_skills' }),
    costPlanStep('step.cost.10', 10, { ...forC, operationType: 'confirm_owned_ideal' }),
  ]
  const plan: ProductionPlan = {
    ...createValidProductionPlan(),
    selectedBuildListEntryIds: [COST_PLAN_ENTRY_A, COST_PLAN_ENTRY_B, COST_PLAN_ENTRY_C],
    steps,
    currentStepId: steps[0].id,
  }
  const targets: TargetWeapon[] = [
    { ...createValidTargetWeapon(), id: COST_PLAN_TARGET_A, name: '大剣・火', weaponTypeId: 'weapon.great_sword' },
    { ...createValidTargetWeapon(), id: COST_PLAN_TARGET_B, name: '大剣・水', weaponTypeId: 'weapon.great_sword' },
    { ...createValidTargetWeapon(), id: COST_PLAN_TARGET_C, name: '大剣・雷', weaponTypeId: 'weapon.great_sword' },
  ]
  return { plan, targets }
}
