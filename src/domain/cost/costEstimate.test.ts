import { describe, expect, it } from 'vitest'
import type { BuildRoute, OwnedWeaponId, RouteOperation } from '../models/publicTypes'
import {
  ARTIAN_PART_IDS,
  RARE8_ARTIAN_PARTS_PER_FORGE,
  RARE8_ARTIAN_PART_RECIPE_WEAPON_TYPE_IDS,
  collectCostEstimateOperationsFromPlan,
  collectCostEstimateOperationsFromRoute,
  estimateCandidateCost,
  estimateProductionPlanCost,
  getRare8ArtianPartRecipe,
  summarizeCostEstimate,
  type CostEstimateOperation,
  type CostEstimateSummary,
} from './index'
import { createValidBuildCandidate, createValidProductionPlan, ownedWeaponId, targetWeaponId } from '../../test/fixtures/domainData'
import {
  COST_PLAN_TARGET_A,
  COST_PLAN_TARGET_B,
  COST_PLAN_TARGET_C,
  costPlanEffects,
  costPlanStep,
  createMultiTargetCostPlanFixture,
} from '../../test/fixtures/costEstimatePlan'

const OWNED_A = ownedWeaponId('owned.a')
const OWNED_NORMAL = ownedWeaponId('owned.normal')

const create = (count: number, weaponTypeId = 'weapon.great_sword'): RouteOperation => ({
  type: 'create_normal_artian',
  weaponTypeId,
  rarity: 8,
  count,
  normalCounterBefore: 4,
  normalCounterAfter: 4 + count,
})
const blindCreate = (weaponTypeId = 'weapon.great_sword'): RouteOperation => ({
  type: 'create_normal_artian',
  weaponTypeId,
  rarity: 8,
  count: 1,
  normalCounterBefore: null,
  normalCounterAfter: null,
})
const convert: RouteOperation = {
  type: 'convert_normal_to_gogma',
  weaponTypeId: 'weapon.great_sword',
  skillCounterBefore: 7,
  skillCounterAfter: 8,
}
const reset = (source: OwnedWeaponId | null = null): RouteOperation => ({
  type: 'reset_bonuses',
  sourceOwnedWeaponId: source,
  gogmaCounterBefore: 10,
  gogmaCounterAfter: 11,
})
const keep = (source: OwnedWeaponId | null = null): RouteOperation => ({
  type: 'keep_bonuses',
  sourceOwnedWeaponId: source,
  gogmaCounterBefore: 11,
  gogmaCounterAfter: 12,
})
const resetSkills = (source: OwnedWeaponId | null = null): RouteOperation => ({
  type: 'reset_skills',
  sourceOwnedWeaponId: source,
  skillCounterBefore: 8,
  skillCounterAfter: 9,
})

function route(kind: BuildRoute['kind'], operations: RouteOperation[], source: OwnedWeaponId | null = null): BuildRoute {
  return { kind, operations, sourceOwnedWeaponId: source }
}

const nothing: CostEstimateSummary = {
  normalForgeCount: 0,
  artianParts: [],
  unpricedForgeCount: 0,
  normalFullRestorationCount: 0,
  normalFullRestorationNanairoKane: 0,
  conversionCount: 0,
  conversionDeviceCount: 0,
  gogmaRestorationCount: 0,
  gogmaRestorationNanairoKane: 0,
  gogmaRestorationTicketCount: 0,
  skillReassignmentCount: 0,
  skillReassignmentDeviceCountDifferentType: 0,
  skillReassignmentDeviceCountSameType: 0,
  zenny: 0,
  isEmpty: true,
}

describe('estimateCandidateCost', () => {
  it('needs nothing for an owned Ideal confirmed as it is (zero operations)', () => {
    const summary = estimateCandidateCost({
      route: route('existing_gogma_current', [], OWNED_A),
    })
    expect(summary).toEqual(nothing)
  })

  it('counts only Reset / Keep / Reset Skills for an existing Gogma, never the weapon already paid for', () => {
    const summary = estimateCandidateCost({
      route: route(
        'existing_gogma_mixed',
        [reset(OWNED_A), keep(OWNED_A), resetSkills(OWNED_A)],
        OWNED_A,
      ),
    })
    expect(summary.normalForgeCount).toBe(0)
    expect(summary.artianParts).toEqual([])
    expect(summary.normalFullRestorationCount).toBe(0)
    expect(summary.conversionCount).toBe(0)
    expect(summary.gogmaRestorationCount).toBe(2)
    expect(summary.gogmaRestorationNanairoKane).toBe(40)
    expect(summary.gogmaRestorationTicketCount).toBe(4)
    expect(summary.skillReassignmentCount).toBe(1)
    expect(summary.skillReassignmentDeviceCountDifferentType).toBe(6)
    expect(summary.skillReassignmentDeviceCountSameType).toBe(3)
    expect(summary.zenny).toBe(2 * 5_000 + 9_000)
    expect(summary.isEmpty).toBe(false)
  })

  it('starts an owned Normal Route at the conversion: no forge and no full restoration is re-counted', () => {
    const summary = estimateCandidateCost({
      route: route('owned_normal_artian_to_gogma', [convert, reset()], OWNED_NORMAL),
    })
    expect(summary.normalForgeCount).toBe(0)
    expect(summary.artianParts).toEqual([])
    expect(summary.normalFullRestorationCount).toBe(0)
    expect(summary.normalFullRestorationNanairoKane).toBe(0)
    expect(summary.conversionCount).toBe(1)
    expect(summary.conversionDeviceCount).toBe(3)
    expect(summary.gogmaRestorationCount).toBe(1)
    expect(summary.zenny).toBe(30_000 + 5_000)
  })

  it('prices a new Normal with forgeCount = 1: three parts, the forge, one full restoration, the conversion', () => {
    const summary = estimateCandidateCost({
      route: route('normal_artian_to_gogma', [create(1), convert, reset()]),
    })
    expect(summary.normalForgeCount).toBe(1)
    expect(summary.artianParts).toEqual([
      { partId: 'artian_part.broken_blade', quantity: 2 },
      { partId: 'artian_part.crushed_tube', quantity: 1 },
    ])
    expect(summary.unpricedForgeCount).toBe(0)
    expect(summary.normalFullRestorationCount).toBe(1)
    expect(summary.normalFullRestorationNanairoKane).toBe(50)
    expect(summary.conversionCount).toBe(1)
    expect(summary.conversionDeviceCount).toBe(3)
    expect(summary.gogmaRestorationCount).toBe(1)
    expect(summary.zenny).toBe(10_000 + 10_000 + 30_000 + 5_000)
  })

  it('multiplies the parts and the forge zenny by forgeCount while restoring only the last production-target Normal', () => {
    const summary = estimateCandidateCost({
      route: route('normal_artian_to_gogma', [create(3), convert, reset()]),
    })
    expect(summary.normalForgeCount).toBe(3)
    expect(summary.artianParts).toEqual([
      { partId: 'artian_part.broken_blade', quantity: 6 },
      { partId: 'artian_part.crushed_tube', quantity: 3 },
    ])
    expect(summary.normalFullRestorationCount).toBe(1)
    expect(summary.normalFullRestorationNanairoKane).toBe(50)
    expect(summary.zenny).toBe(3 * 10_000 + 10_000 + 30_000 + 5_000)
    // The operations themselves name the roles: N - 1 Counter-advance forges, then the production target.
    expect(collectCostEstimateOperationsFromRoute(route('normal_artian_to_gogma', [create(3)]))).toEqual([
      { type: 'create_normal_artian', weaponTypeId: 'weapon.great_sword', role: 'counter_advance' },
      { type: 'create_normal_artian', weaponTypeId: 'weapon.great_sword', role: 'counter_advance' },
      { type: 'create_normal_artian', weaponTypeId: 'weapon.great_sword', role: 'production_target' },
    ])
  })

  it('prices the blind forced Reset variant exactly like one predicted forge', () => {
    const blind = estimateCandidateCost({
      route: route('normal_artian_to_gogma', [blindCreate(), convert, reset()]),
    })
    const predicted = estimateCandidateCost({
      route: route('normal_artian_to_gogma', [create(1), convert, reset()]),
    })
    expect(blind).toEqual(predicted)
  })

  it('expresses several Reset and Keep Bonuses as one alternative pair, never a sum of both items', () => {
    const summary = estimateCandidateCost({
      route: route('existing_gogma_mixed', [reset(OWNED_A), keep(OWNED_A), reset(OWNED_A), keep(OWNED_A), keep(OWNED_A)], OWNED_A),
    })
    expect(summary.gogmaRestorationCount).toBe(5)
    expect(summary.gogmaRestorationNanairoKane).toBe(20 * 5)
    expect(summary.gogmaRestorationTicketCount).toBe(2 * 5)
    expect(summary.zenny).toBe(5_000 * 5)
    // No field ever holds ナナイロカネ plus 歴戦錬磨の証 together.
    expect(Object.values(summary)).not.toContain(20 * 5 + 2 * 5)
  })

  it('shows Skill reassignments as the different-type device count with the same-type half', () => {
    const summary = estimateCandidateCost({
      route: route('existing_gogma_reset_skills', Array.from({ length: 8 }, () => resetSkills(OWNED_A)), OWNED_A),
    })
    expect(summary.skillReassignmentCount).toBe(8)
    expect(summary.skillReassignmentDeviceCountDifferentType).toBe(48)
    expect(summary.skillReassignmentDeviceCountSameType).toBe(24)
    expect(summary.zenny).toBe(9_000 * 8)
    expect(summary.gogmaRestorationCount).toBe(0)
    expect(summary.conversionCount).toBe(0)
  })

  it('reports a forge of a weapon type without a part recipe as unpriced instead of guessing parts', () => {
    const summary = estimateCandidateCost({
      route: route('normal_artian_to_gogma', [create(2, 'weapon.fixture.a'), convert, reset()]),
    })
    expect(summary.normalForgeCount).toBe(2)
    expect(summary.unpricedForgeCount).toBe(2)
    expect(summary.artianParts).toEqual([])
    // The forge zenny and the production-target restoration still count.
    expect(summary.zenny).toBe(2 * 10_000 + 10_000 + 30_000 + 5_000)
  })

  it('never mutates the Candidate it reads', () => {
    const candidate = createValidBuildCandidate()
    const before = structuredClone(candidate)
    estimateCandidateCost(candidate)
    expect(candidate).toEqual(before)
  })
})

describe('rarity-8 Artian part recipes', () => {
  const expected: Record<string, Record<string, number>> = {
    'weapon.great_sword': { 'artian_part.broken_blade': 2, 'artian_part.crushed_tube': 1 },
    'weapon.long_sword': { 'artian_part.broken_blade': 1, 'artian_part.crushed_tube': 2 },
    'weapon.sword_and_shield': { 'artian_part.broken_blade': 1, 'artian_part.crushed_tube': 1, 'artian_part.cracked_disc': 1 },
    'weapon.dual_blades': { 'artian_part.broken_blade': 2, 'artian_part.cracked_disc': 1 },
    'weapon.hammer': { 'artian_part.cracked_disc': 2, 'artian_part.crushed_tube': 1 },
    'weapon.hunting_horn': { 'artian_part.cracked_disc': 1, 'artian_part.rusted_device': 2 },
    'weapon.lance': { 'artian_part.broken_blade': 1, 'artian_part.cracked_disc': 2 },
    'weapon.gunlance': { 'artian_part.cracked_disc': 2, 'artian_part.rusted_device': 1 },
    'weapon.switch_axe': { 'artian_part.broken_blade': 2, 'artian_part.rusted_device': 1 },
    'weapon.charge_blade': { 'artian_part.broken_blade': 1, 'artian_part.cracked_disc': 1, 'artian_part.rusted_device': 1 },
    'weapon.insect_glaive': { 'artian_part.broken_blade': 1, 'artian_part.crushed_tube': 1, 'artian_part.rusted_device': 1 },
    'weapon.light_bowgun': { 'artian_part.crushed_tube': 1, 'artian_part.rusted_device': 2 },
    'weapon.heavy_bowgun': { 'artian_part.cracked_disc': 1, 'artian_part.crushed_tube': 1, 'artian_part.rusted_device': 1 },
    'weapon.bow': { 'artian_part.crushed_tube': 2, 'artian_part.rusted_device': 1 },
  }

  it('defines exactly the 14 weapon types', () => {
    expect([...RARE8_ARTIAN_PART_RECIPE_WEAPON_TYPE_IDS].sort()).toEqual(Object.keys(expected).sort())
  })

  it.each(Object.keys(expected))('%s uses its fixed composition of exactly three parts', (weaponTypeId) => {
    const recipe = getRare8ArtianPartRecipe(weaponTypeId)
    expect(recipe).not.toBeNull()
    const byPart = Object.fromEntries((recipe ?? []).map(({ partId, quantity }) => [partId, quantity]))
    expect(byPart).toEqual(expected[weaponTypeId])
    expect((recipe ?? []).reduce((total, { quantity }) => total + quantity, 0)).toBe(RARE8_ARTIAN_PARTS_PER_FORGE)
    ;(recipe ?? []).forEach(({ partId }) => expect(ARTIAN_PART_IDS).toContain(partId))
  })

  it('returns null for an unknown weapon type', () => {
    expect(getRare8ArtianPartRecipe('weapon.fixture.a')).toBeNull()
  })
})

describe('summarizeCostEstimate', () => {
  it('lists the parts in the fixed display order regardless of operation order', () => {
    const operations: CostEstimateOperation[] = [
      { type: 'create_normal_artian', weaponTypeId: 'weapon.bow', role: 'counter_advance' },
      { type: 'create_normal_artian', weaponTypeId: 'weapon.hammer', role: 'production_target' },
    ]
    expect(summarizeCostEstimate(operations).artianParts).toEqual([
      { partId: 'artian_part.crushed_tube', quantity: 3 },
      { partId: 'artian_part.cracked_disc', quantity: 2 },
      { partId: 'artian_part.rusted_device', quantity: 1 },
    ])
  })
})

describe('estimateProductionPlanCost', () => {
  it('totals the items and zenny of a multi-Target Plan from its physical Steps', () => {
    const { plan, targets } = createMultiTargetCostPlanFixture()
    const estimate = estimateProductionPlanCost(plan)
    expect(estimate.available).toBe(true)
    if (!estimate.available) return
    expect(estimate.summary).toEqual<CostEstimateSummary>({
      normalForgeCount: 3,
      artianParts: [
        { partId: 'artian_part.broken_blade', quantity: 6 },
        { partId: 'artian_part.crushed_tube', quantity: 3 },
      ],
      unpricedForgeCount: 0,
      normalFullRestorationCount: 1,
      normalFullRestorationNanairoKane: 50,
      conversionCount: 1,
      conversionDeviceCount: 3,
      gogmaRestorationCount: 2,
      gogmaRestorationNanairoKane: 40,
      gogmaRestorationTicketCount: 4,
      skillReassignmentCount: 3,
      skillReassignmentDeviceCountDifferentType: 18,
      skillReassignmentDeviceCountSameType: 9,
      zenny: 3 * 10_000 + 10_000 + 30_000 + 2 * 5_000 + 3 * 9_000,
      isEmpty: false,
    })
    // The Target list is a display-only fallback and changes nothing here.
    expect(
      estimateProductionPlanCost(plan, {
        weaponTypeIdByTargetWeaponId: new Map(targets.map((target) => [target.id, target.weaponTypeId])),
      }),
    ).toEqual(estimate)
  })

  it('counts a physical Step shared by several Targets once, unlike a per-Target sum', () => {
    const { plan } = createMultiTargetCostPlanFixture()
    const shared = plan.steps.filter((step) => (step.progressedTargetWeaponIds ?? []).length > 1)
    expect(shared.map((step) => step.operationType)).toEqual(['reset_bonuses'])

    const perTargetSum = [COST_PLAN_TARGET_A, COST_PLAN_TARGET_B, COST_PLAN_TARGET_C]
      .map((targetId) =>
        collectCostEstimateOperationsFromPlan({
          steps: plan.steps.filter((step) => (step.progressedTargetWeaponIds ?? []).includes(targetId)),
        }),
      )
      .reduce((total, collected) => {
        if (!collected.available) throw new Error('unexpected legacy Plan')
        return total + summarizeCostEstimate(collected.operations).gogmaRestorationCount
      }, 0)
    const estimate = estimateProductionPlanCost(plan)
    if (!estimate.available) throw new Error('unexpected legacy Plan')
    expect(perTargetSum).toBe(3)
    expect(estimate.summary.gogmaRestorationCount).toBe(2)
  })

  it('costs nothing for confirm_owned_ideal and for the legacy reserve / confirm Steps', () => {
    const plan = {
      steps: [
        costPlanStep('step.zero.1', 1, { operationType: 'confirm_owned_ideal', targetWeaponId: targetWeaponId('target.zero') }),
        costPlanStep('step.zero.2', 2, { operationType: 'reserve_weapon' }),
        costPlanStep('step.zero.3', 3, { operationType: 'confirm_result' }),
      ],
    }
    const estimate = estimateProductionPlanCost(plan)
    expect(estimate).toEqual({ available: true, summary: nothing })
  })

  it('never re-counts what an existing Gogma already cost: Reset / Keep / Reset Skills only', () => {
    const plan = {
      steps: [
        costPlanStep('step.gogma.1', 1, { operationType: 'reset_bonuses' }),
        costPlanStep('step.gogma.2', 2, { operationType: 'keep_bonuses' }),
        costPlanStep('step.gogma.3', 3, { operationType: 'reset_skills' }),
      ],
    }
    const estimate = estimateProductionPlanCost(plan)
    if (!estimate.available) throw new Error('unexpected legacy Plan')
    expect(estimate.summary.normalForgeCount).toBe(0)
    expect(estimate.summary.normalFullRestorationCount).toBe(0)
    expect(estimate.summary.conversionCount).toBe(0)
    expect(estimate.summary.gogmaRestorationCount).toBe(2)
    expect(estimate.summary.gogmaRestorationNanairoKane).toBe(40)
    expect(estimate.summary.gogmaRestorationTicketCount).toBe(4)
    expect(estimate.summary.skillReassignmentDeviceCountDifferentType).toBe(6)
    expect(estimate.summary.skillReassignmentDeviceCountSameType).toBe(3)
    expect(estimate.summary.zenny).toBe(5_000 * 2 + 9_000)
  })

  it('never re-counts the forge and full restoration of an owned Normal converted in place', () => {
    const plan = {
      steps: [
        costPlanStep('step.owned.1', 1, { operationType: 'convert_normal_to_gogma' }),
        costPlanStep('step.owned.2', 2, { operationType: 'reset_bonuses' }),
      ],
    }
    const estimate = estimateProductionPlanCost(plan)
    if (!estimate.available) throw new Error('unexpected legacy Plan')
    expect(estimate.summary.normalForgeCount).toBe(0)
    expect(estimate.summary.artianParts).toEqual([])
    expect(estimate.summary.normalFullRestorationCount).toBe(0)
    expect(estimate.summary.conversionCount).toBe(1)
    expect(estimate.summary.conversionDeviceCount).toBe(3)
    expect(estimate.summary.zenny).toBe(30_000 + 5_000)
  })

  it('restores only the production-target Normal, never a Counter-advance Normal', () => {
    const plan = {
      steps: [
        costPlanStep('step.role.1', 1, {
          operationType: 'create_normal_artian',
          executionEffects: costPlanEffects({ normalCreationRole: 'counter_advance' }),
        }),
        costPlanStep('step.role.2', 2, {
          operationType: 'create_normal_artian',
          executionEffects: costPlanEffects({ normalCreationRole: 'counter_advance' }),
        }),
      ],
    }
    const estimate = estimateProductionPlanCost(plan)
    if (!estimate.available) throw new Error('unexpected legacy Plan')
    expect(estimate.summary.normalForgeCount).toBe(2)
    expect(estimate.summary.normalFullRestorationCount).toBe(0)
    expect(estimate.summary.zenny).toBe(2 * 10_000)
  })

  it('resolves a Counter-advance forge weapon type from the Target list only when no Step registers the weapon', () => {
    const targetId = targetWeaponId('target.fallback')
    const plan = {
      steps: [
        costPlanStep('step.fallback.1', 1, {
          operationType: 'create_normal_artian',
          targetWeaponId: targetId,
          executionEffects: costPlanEffects({ normalCreationRole: 'counter_advance' }),
        }),
      ],
    }
    const unresolved = estimateProductionPlanCost(plan)
    if (!unresolved.available) throw new Error('unexpected legacy Plan')
    expect(unresolved.summary.unpricedForgeCount).toBe(1)
    expect(unresolved.summary.artianParts).toEqual([])

    const resolved = estimateProductionPlanCost(plan, {
      weaponTypeIdByTargetWeaponId: new Map([[targetId, 'weapon.bow']]),
    })
    if (!resolved.available) throw new Error('unexpected legacy Plan')
    expect(resolved.summary.unpricedForgeCount).toBe(0)
    expect(resolved.summary.artianParts).toEqual([
      { partId: 'artian_part.crushed_tube', quantity: 2 },
      { partId: 'artian_part.rusted_device', quantity: 1 },
    ])
  })

  it('fails closed on a legacy Plan whose Normal creation carries no execution effects', () => {
    const legacyStep = costPlanStep('step.legacy.1', 1, { operationType: 'create_normal_artian' })
    delete legacyStep.executionEffects
    expect(estimateProductionPlanCost({ steps: [legacyStep] })).toEqual({
      available: false,
      reason: 'legacy_plan',
    })
    // A legacy Plan without any Normal creation is still derivable from its physical Steps.
    const legacyReset = costPlanStep('step.legacy.2', 2, { operationType: 'reset_bonuses' })
    delete legacyReset.executionEffects
    const estimate = estimateProductionPlanCost({ steps: [legacyReset] })
    expect(estimate.available).toBe(true)
  })

  it('includes completed Steps: the summary describes the whole Plan', () => {
    const { plan } = createMultiTargetCostPlanFixture()
    const partlyDone = {
      steps: plan.steps.map((step, index) => ({ ...step, isCompleted: index < 4 })),
    }
    expect(estimateProductionPlanCost(partlyDone)).toEqual(estimateProductionPlanCost(plan))
  })

  it('reads the domain fixture Plan (one legacy confirm_result Step) as costing nothing', () => {
    expect(estimateProductionPlanCost(createValidProductionPlan())).toEqual({
      available: true,
      summary: nothing,
    })
  })
})
