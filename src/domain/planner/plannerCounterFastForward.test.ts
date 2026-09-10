import { describe, expect, it } from 'vitest'
import type {
  BuildListEntry,
  BuildRoute,
  OwnedGogmaArtianWeapon,
  RestorationBonusSet,
  RouteOperation,
  TargetWeapon,
} from '../models/publicTypes'
import {
  createValidOwnedWeapon,
  createValidTargetWeapon,
  ownedWeaponId,
  targetWeaponId,
} from '../../test/fixtures/domainData'
import {
  fixture,
  plannerEngine,
  routeEntry,
  sourceWeapon,
  synchronizeEntry,
  target,
} from '../../test/fixtures/plannerBeam'
import { FakeRngEngine, type FakeRngFixtures } from '../rng/fakeRngEngine'
import type { PlannerDependencies, PlannerInput } from './plannerTypes'
import {
  createPlannerRouteUnitPlans,
  fastForwardPlannerRouteProgress,
} from './plannerRouteProgress'
import { detectPlannerConflicts } from './plannerConflictDetection'
import { createInitialPlannerSearchState } from './plannerInitialState'
import { runPlannerBeamSearch } from './plannerBeamSearch'
import { createProductionPlan } from './productionPlanGeneration'

/**
 * The project owner's reproduction case: two Targets whose Candidate Routes
 * both start from the same shared Gogma Counter position.
 *
 * Target A (water) keeps 23 times from Counter 0. Target B (fire) resets 140
 * times from Counter 0 and then keeps 8 times. Every Gogma Counter position
 * from 0 to 147 is therefore claimed by exactly one physical operation, and the
 * fire Route's early Resets are only Counter progression: a later Reset
 * overwrites their whole five-slot result before any Keep reads it.
 */
const WATER_FAMILY = 'bonus_type.fixture.utility'
const FIRE_FAMILY = 'bonus_type.fixture.attack'
const LOW = 'bonus_rank.fixture.low'
const MIDDLE = 'bonus_rank.fixture.middle'
const HIGH = 'bonus_rank.fixture.high'

const WATER_KEEP_COUNT = 23
const FIRE_RESET_COUNT = 140
const FIRE_KEEP_COUNT = 8
const FIRE_KEEP_START = FIRE_RESET_COUNT
const LAST_GOGMA_COUNTER = FIRE_RESET_COUNT + FIRE_KEEP_COUNT - 1

function bonuses(bonusTypeId: string, bonusRankId: string): RestorationBonusSet {
  return [
    { bonusTypeId, bonusRankId },
    { bonusTypeId, bonusRankId },
    { bonusTypeId, bonusRankId },
    { bonusTypeId, bonusRankId },
    { bonusTypeId, bonusRankId },
  ]
}

function scenarioTarget(
  id: string,
  elementId: string,
  family: string,
): TargetWeapon {
  return {
    ...createValidTargetWeapon(),
    id: targetWeaponId(id),
    elementId,
    idealBonuses: bonuses(family, HIGH),
    practicalBonusConditions: [
      {
        id: `condition.${id}`,
        bonusTypeId: family,
        minimumRankId: HIGH,
        requiredCount: 5,
        requiredExCount: 0,
      },
    ],
    practicalAlternativeGroups: [],
    idealSkillCondition: {
      seriesSkillId: 'series_skill.fixture.a',
      groupSkillId: null,
      matchMode: 'all',
    },
    practicalSkillCondition: {
      seriesSkillId: null,
      groupSkillId: null,
      matchMode: 'any',
    },
  }
}

function scenarioSource(
  id: string,
  elementId: string,
  family: string,
): OwnedGogmaArtianWeapon {
  return {
    ...createValidOwnedWeapon(ownedWeaponId(id)),
    elementId,
    restorationBonuses: bonuses(family, LOW),
    restorationBonusScope: 'gogma_artian',
    seriesSkillId: 'series_skill.fixture.a',
    groupSkillId: null,
    status: 'material',
    isProtected: false,
    relatedTargetWeaponIds: [],
  }
}

function keepOperations(
  sourceId: OwnedGogmaArtianWeapon['id'],
  from: number,
  count: number,
): RouteOperation[] {
  return Array.from({ length: count }, (_unused, index) => ({
    type: 'keep_bonuses' as const,
    sourceOwnedWeaponId: sourceId,
    gogmaCounterBefore: from + index,
    gogmaCounterAfter: from + index + 1,
  }))
}

function resetOperations(
  sourceId: OwnedGogmaArtianWeapon['id'],
  from: number,
  count: number,
): RouteOperation[] {
  return Array.from({ length: count }, (_unused, index) => ({
    type: 'reset_bonuses' as const,
    sourceOwnedWeaponId: sourceId,
    gogmaCounterBefore: from + index,
    gogmaCounterAfter: from + index + 1,
  }))
}

/**
 * Fixture Engine for the whole shared Gogma range.
 *
 * Keep results are provided for every legal current five-slot input of the
 * route's own family, because Keep reads only the slot families: skipping an
 * intermediate Keep must reach the same later result.
 */
function scenarioEngine(baseSeed: string, master: PlannerInput['master']) {
  const gogmaCounterAdvances: FakeRngFixtures['gogmaCounterAdvances'] = []
  for (let counter = 0; counter <= LAST_GOGMA_COUNTER + 1; counter += 1) {
    gogmaCounterAdvances.push(
      { current: counter, operation: { type: 'reset_bonuses' }, result: counter + 1 },
      { current: counter, operation: { type: 'keep_bonuses' }, result: counter + 1 },
    )
  }
  const resetBonusPredictions: FakeRngFixtures['resetBonusPredictions'] = []
  for (let counter = 0; counter < FIRE_RESET_COUNT; counter += 1) {
    resetBonusPredictions.push({
      input: {
        baseSeed,
        gogmaCounter: counter,
        weaponTypeId: 'weapon.fixture.a',
        elementId: 'element.fixture.b',
        operation: { type: 'reset_bonuses' },
        master,
      },
      result: bonuses(FIRE_FAMILY, LOW),
    })
  }
  const keepBonusPredictions: FakeRngFixtures['keepBonusPredictions'] = []
  const pushKeeps = (
    elementId: string,
    family: string,
    from: number,
    count: number,
  ) => {
    for (let index = 0; index < count; index += 1) {
      const counter = from + index
      const result =
        index === count - 1 ? bonuses(family, HIGH) : bonuses(family, MIDDLE)
      ;[LOW, MIDDLE].forEach((currentRankId) => {
        keepBonusPredictions.push({
          input: {
            baseSeed,
            gogmaCounter: counter,
            weaponTypeId: 'weapon.fixture.a',
            elementId,
            operation: {
              type: 'keep_bonuses',
              currentBonuses: bonuses(family, currentRankId),
            },
            master,
          },
          result,
        })
      })
    }
  }
  pushKeeps('element.fixture.a', WATER_FAMILY, 0, WATER_KEEP_COUNT)
  pushKeeps('element.fixture.b', FIRE_FAMILY, FIRE_KEEP_START, FIRE_KEEP_COUNT)
  return new FakeRngEngine({
    version: 'planner-beam-v1',
    capabilities: {
      supportsSeedSearch: false,
      supportsNormalArtianPrediction: true,
      supportsGogmaPrediction: true,
      supportsSkillPrediction: true,
      supportsKeepBonusesPrediction: true,
    },
    normalizedSeeds: [],
    resetBonusPredictions,
    keepBonusPredictions,
    skillPredictions: [],
    normalArtianPredictions: [],
    gogmaCounterAdvances,
    skillCounterAdvances: [],
    normalCounterAdvances: [],
  })
}

function sharedGogmaScenario(): {
  input: PlannerInput
  dependencies: PlannerDependencies
  water: BuildListEntry
  fire: BuildListEntry
  waterTarget: TargetWeapon
  fireTarget: TargetWeapon
} {
  const waterTarget = scenarioTarget(
    'target.shared-gogma.water',
    'element.fixture.a',
    WATER_FAMILY,
  )
  const fireTarget = scenarioTarget(
    'target.shared-gogma.fire',
    'element.fixture.b',
    FIRE_FAMILY,
  )
  const waterSource = scenarioSource(
    'owned.shared-gogma.water',
    'element.fixture.a',
    WATER_FAMILY,
  )
  const fireSource = scenarioSource(
    'owned.shared-gogma.fire',
    'element.fixture.b',
    FIRE_FAMILY,
  )
  const waterRoute: BuildRoute = {
    kind: 'existing_gogma_keep_bonuses',
    sourceOwnedWeaponId: waterSource.id,
    operations: keepOperations(waterSource.id, 0, WATER_KEEP_COUNT),
  }
  const fireRoute: BuildRoute = {
    kind: 'existing_gogma_mixed',
    sourceOwnedWeaponId: fireSource.id,
    operations: [
      ...resetOperations(fireSource.id, 0, FIRE_RESET_COUNT),
      ...keepOperations(fireSource.id, FIRE_KEEP_START, FIRE_KEEP_COUNT),
    ],
  }
  const water = routeEntry('entry.shared-gogma.water', waterTarget, waterRoute)
  water.candidateSnapshot.finalBonuses = bonuses(WATER_FAMILY, HIGH)
  water.candidateSnapshot.restorationBonusScope = 'gogma_artian'
  water.candidateSnapshot.groupSkillId = null
  const fire = routeEntry('entry.shared-gogma.fire', fireTarget, fireRoute)
  fire.candidateSnapshot.finalBonuses = bonuses(FIRE_FAMILY, HIGH)
  fire.candidateSnapshot.restorationBonusScope = 'gogma_artian'
  fire.candidateSnapshot.groupSkillId = null
  const { input, dependencies } = fixture(
    [waterTarget, fireTarget],
    [water, fire],
    [waterSource, fireSource],
  )
  input.rngState.gogmaCounter = { value: 0, isConfirmed: true, source: 'observation' }
  input.buildListEntries.forEach((entry) => synchronizeEntry(input, entry))
  dependencies.rngEngine = scenarioEngine(
    input.rngState.baseSeed.value as string,
    input.master,
  )
  return { input, dependencies, water, fire, waterTarget, fireTarget }
}

function gogmaCounterOf(step: { debug: { startGogmaCounter: number | null } | null }) {
  return step.debug?.startGogmaCounter ?? null
}

describe('Shared Gogma Counter Route prefix fast-forward', () => {
  it('derives canSkipWhenCounterPassed only for fully overwritten Route units', () => {
    const { input, dependencies } = sharedGogmaScenario()
    const plans = createPlannerRouteUnitPlans(
      input.buildListEntries,
      dependencies.rngEngine,
    )
    const water = plans.unitPlans.get(input.buildListEntries[0].id) ?? []
    const fire = plans.unitPlans.get(input.buildListEntries[1].id) ?? []
    expect(water).toHaveLength(WATER_KEEP_COUNT)
    expect(fire).toHaveLength(FIRE_RESET_COUNT + FIRE_KEEP_COUNT)

    // Keep followed by Keep keeps the same slot families, so the next Keep's
    // result does not change; the final Keep forms the Candidate result.
    expect(
      water.slice(0, -1).every(({ canSkipWhenCounterPassed }) => canSkipWhenCounterPassed),
    ).toBe(true)
    expect(water.at(-1)?.canSkipWhenCounterPassed).toBe(false)

    // Reset followed by Reset is fully overwritten; the last Reset feeds the
    // following Keep's families and is required.
    expect(
      fire
        .slice(0, FIRE_RESET_COUNT - 1)
        .every(({ canSkipWhenCounterPassed }) => canSkipWhenCounterPassed),
    ).toBe(true)
    expect(fire[FIRE_RESET_COUNT - 1].canSkipWhenCounterPassed).toBe(false)
    expect(
      fire
        .slice(FIRE_RESET_COUNT, -1)
        .every(({ canSkipWhenCounterPassed }) => canSkipWhenCounterPassed),
    ).toBe(true)
    expect(fire.at(-1)?.canSkipWhenCounterPassed).toBe(false)
  })

  it('plans both Targets without turning shared Counter positions into conflicts', async () => {
    const { input, dependencies, water, fire, waterTarget, fireTarget } =
      sharedGogmaScenario()
    const result = await runPlannerBeamSearch(input, dependencies)

    expect(result.conflicts).toEqual([])
    expect(result.completed).toBe(true)
    expect(result.bestState?.selectedBuildListEntryIds).toEqual(
      [water.id, fire.id].sort(),
    )
    expect(result.bestState?.targetSatisfaction[waterTarget.id]).toEqual({
      hasPractical: true,
      hasIdeal: true,
    })
    expect(result.bestState?.targetSatisfaction[fireTarget.id]).toEqual({
      hasPractical: true,
      hasIdeal: true,
    })
    expect(
      result.bestState?.trace.filter(({ kind }) => kind === 'reserve_candidate'),
    ).toHaveLength(2)
    expect(result.bestState?.trace).toHaveLength(
      LAST_GOGMA_COUNTER + 1 + 2,
    )
    // A fast-forwarded unit is Counter progression, never a shared physical
    // action: no action progresses the other Entry.
    expect(
      result.bestState?.trace.every(
        ({ progressedBuildListEntryIds }) =>
          progressedBuildListEntryIds.length === 1,
      ),
    ).toBe(true)

    // Among the equally rated splits of the shared Counter positions, the
    // Planner picks the one the player can execute as one water block followed
    // by one fire block (PLANNER_SPEC 7.3). The 23 fire Route units the water
    // Keeps fast-forward past are not operations, so they add no switch.
    expect(result.bestState?.weaponSwitchCount).toBe(1)
    const operatedEntryIds = (result.bestState?.trace ?? [])
      .filter(({ kind }) => kind === 'route_operation')
      .map(({ primaryBuildListEntryId }) => primaryBuildListEntryId)
    expect(operatedEntryIds).toEqual([
      ...Array.from({ length: WATER_KEEP_COUNT }, () => water.id),
      ...Array.from(
        { length: LAST_GOGMA_COUNTER + 1 - WATER_KEEP_COUNT },
        () => fire.id,
      ),
    ])
  }, 180_000)

  it('replays the Beam Search trace into one 150 step ProductionPlan', async () => {
    const { input, dependencies, water, fire, waterTarget, fireTarget } =
      sharedGogmaScenario()
    const before = structuredClone(input)
    const { plan, conflicts, warnings } = await createProductionPlan(
      input,
      dependencies,
    )

    expect(conflicts).toEqual([])
    expect(warnings).toEqual([])
    expect(plan).not.toBeNull()
    expect(plan?.conflicts).toEqual([])
    expect(plan?.rejectedBuildListEntries).toEqual([])
    expect(plan?.steps).toHaveLength(150)

    const steps = plan?.steps ?? []
    const waterKeeps = steps
      .filter(
        ({ buildListEntryId, operationType }) =>
          buildListEntryId === water.id && operationType === 'keep_bonuses',
      )
      .map(gogmaCounterOf)
    const fireResets = steps
      .filter(
        ({ buildListEntryId, operationType }) =>
          buildListEntryId === fire.id && operationType === 'reset_bonuses',
      )
      .map(gogmaCounterOf)
    const fireKeeps = steps
      .filter(
        ({ buildListEntryId, operationType }) =>
          buildListEntryId === fire.id && operationType === 'keep_bonuses',
      )
      .map(gogmaCounterOf)
    expect(fireKeeps).toEqual(
      Array.from(
        { length: FIRE_KEEP_COUNT },
        (_unused, index) => FIRE_KEEP_START + index,
      ),
    )
    expect(
      steps.filter(({ operationType }) => operationType === 'reserve_weapon'),
    ).toHaveLength(2)

    // Both Routes claim shared Counter positions 0-22, and every position is
    // executed exactly once: the Entry that does not run there fast-forwards.
    // Which Entry occupies those shared skippable positions is decided by the
    // weapon switch preference (PLANNER_SPEC 7.3): running the water Keeps
    // there leaves one water block followed by one fire block, so the player
    // swaps the weapon in hand once instead of three times. Both splits execute
    // the same 148 physical operations, so the existing evaluation rates them
    // equally and only the switch count separates them.
    expect(waterKeeps).toEqual(
      Array.from({ length: WATER_KEEP_COUNT }, (_unused, index) => index),
    )
    expect(fireResets).toEqual(
      Array.from(
        { length: FIRE_RESET_COUNT - WATER_KEEP_COUNT },
        (_unused, index) => WATER_KEEP_COUNT + index,
      ),
    )

    // Exactly one physical operation per shared Gogma Counter position.
    const counterSteps = steps
      .filter(({ operationType }) => operationType !== 'reserve_weapon')
      .map(gogmaCounterOf)
    expect([...counterSteps].sort((left, right) => (left ?? 0) - (right ?? 0))).toEqual(
      Array.from({ length: LAST_GOGMA_COUNTER + 1 }, (_unused, index) => index),
    )
    expect(
      steps.every(
        ({ progressedTargetWeaponIds }) =>
          (progressedTargetWeaponIds ?? []).length <= 1,
      ),
    ).toBe(true)
    expect(
      new Set(
        steps.flatMap(
          ({ progressedTargetWeaponIds }) => progressedTargetWeaponIds ?? [],
        ),
      ),
    ).toEqual(new Set([waterTarget.id, fireTarget.id]))

    expect(plan?.steps[0].expectedStateBefore).toEqual(
      plan?.baseSnapshot.initialExecutionState,
    )
    plan?.steps.slice(0, -1).forEach((step, index) => {
      expect(step.expectedStateAfter).toEqual(
        plan.steps[index + 1].expectedStateBefore,
      )
    })
    expect(input).toEqual(before)
  }, 180_000)
})

function gogmaOperation(
  type: 'reset_bonuses' | 'keep_bonuses',
  sourceOwnedWeaponId: OwnedGogmaArtianWeapon['id'],
  counter: number,
): RouteOperation {
  return {
    type,
    sourceOwnedWeaponId,
    gogmaCounterBefore: counter,
    gogmaCounterAfter: counter + 1,
  }
}

function skillOperation(
  sourceOwnedWeaponId: OwnedGogmaArtianWeapon['id'],
  counter: number,
): RouteOperation {
  return {
    type: 'reset_skills',
    sourceOwnedWeaponId,
    skillCounterBefore: counter,
    skillCounterAfter: counter + 1,
  }
}

function skipFlags(route: BuildRoute): boolean[] {
  const entry = routeEntry('entry.skip-flags', target('target.skip-flags'), route)
  const plans = createPlannerRouteUnitPlans([entry], plannerEngine())
  return (plans.unitPlans.get(entry.id) ?? []).map(
    ({ canSkipWhenCounterPassed }) => canSkipWhenCounterPassed,
  )
}

describe('Route unit skip derivation', () => {
  const source = ownedWeaponId('owned.skip.source')

  it('skips a Reset the next Reset overwrites, but never the Reset a Keep reads', () => {
    expect(
      skipFlags({
        kind: 'existing_gogma_mixed',
        sourceOwnedWeaponId: source,
        operations: [
          gogmaOperation('reset_bonuses', source, 10),
          gogmaOperation('reset_bonuses', source, 11),
          gogmaOperation('reset_bonuses', source, 12),
          gogmaOperation('keep_bonuses', source, 13),
        ],
      }),
    ).toEqual([true, true, false, false])
  })

  it('skips a Keep the next Keep reproduces, but never the final Keep', () => {
    expect(
      skipFlags({
        kind: 'existing_gogma_keep_bonuses',
        sourceOwnedWeaponId: source,
        operations: [
          gogmaOperation('keep_bonuses', source, 10),
          gogmaOperation('keep_bonuses', source, 11),
          gogmaOperation('keep_bonuses', source, 12),
        ],
      }),
    ).toEqual([true, true, false])
  })

  it('skips a Keep a following Reset discards', () => {
    expect(
      skipFlags({
        kind: 'existing_gogma_mixed',
        sourceOwnedWeaponId: source,
        operations: [
          gogmaOperation('keep_bonuses', source, 10),
          gogmaOperation('reset_bonuses', source, 11),
        ],
      }),
    ).toEqual([true, false])
  })

  it('skips a Reset Skills only when the next unit is another Reset Skills', () => {
    expect(
      skipFlags({
        kind: 'existing_gogma_reset_skills',
        sourceOwnedWeaponId: source,
        operations: [
          skillOperation(source, 7),
          skillOperation(source, 8),
          skillOperation(source, 9),
        ],
      }),
    ).toEqual([true, true, false])
    expect(
      skipFlags({
        kind: 'existing_gogma_mixed',
        sourceOwnedWeaponId: source,
        operations: [
          skillOperation(source, 7),
          gogmaOperation('reset_bonuses', source, 10),
        ],
      }),
    ).toEqual([false, false])
  })

  it('never skips physical or inventory operations', () => {
    expect(
      skipFlags({
        kind: 'normal_artian_to_gogma',
        sourceOwnedWeaponId: null,
        operations: [
          {
            type: 'create_normal_artian',
            weaponTypeId: 'weapon.fixture.a',
            rarity: 8,
            count: 2,
            normalCounterBefore: 4,
            normalCounterAfter: 6,
          },
          {
            type: 'convert_normal_to_gogma',
            weaponTypeId: 'weapon.fixture.a',
            skillCounterBefore: 7,
            skillCounterAfter: 8,
          },
          {
            type: 'reset_bonuses',
            sourceOwnedWeaponId: null,
            gogmaCounterBefore: 10,
            gogmaCounterAfter: 11,
          },
          {
            type: 'reset_bonuses',
            sourceOwnedWeaponId: null,
            gogmaCounterBefore: 11,
            gogmaCounterAfter: 12,
          },
        ],
      }),
    ).toEqual([false, false, false, true, false])
  })
})

/** Two Entries whose Routes claim the same Gogma Counter position 10. */
function sharedPositionScenario(otherOperationCounters: number[]) {
  const requiredTarget = target('target.fast-forward.required')
  // A different weapon type, so one reserved weapon never satisfies both
  // Targets while both Routes still share the one Gogma Counter stream.
  const otherTarget = {
    ...target('target.fast-forward.other'),
    weaponTypeId: 'weapon.fixture.b',
  }
  const requiredSource = sourceWeapon('owned.fast-forward.required')
  const otherSource = {
    ...sourceWeapon('owned.fast-forward.other'),
    weaponTypeId: 'weapon.fixture.b',
  }
  const required = routeEntry('entry.fast-forward.required', requiredTarget, {
    kind: 'existing_gogma_reset_bonuses',
    sourceOwnedWeaponId: requiredSource.id,
    operations: [gogmaOperation('reset_bonuses', requiredSource.id, 10)],
  })
  const other = routeEntry('entry.fast-forward.other', otherTarget, {
    kind: 'existing_gogma_reset_bonuses',
    sourceOwnedWeaponId: otherSource.id,
    operations: otherOperationCounters.map((counter) =>
      gogmaOperation('reset_bonuses', otherSource.id, counter),
    ),
  })
  const { input, dependencies } = fixture(
    [requiredTarget, otherTarget],
    [required, other],
    [requiredSource, otherSource],
  )
  return { input, dependencies, required, other, requiredTarget, otherTarget }
}

function initialStateFor(input: PlannerInput) {
  const initial = createInitialPlannerSearchState(
    input,
    input.buildListEntries.map((entry) => ({
      entry,
      missingRngRequirements: [],
    })),
  )
  if (initial.state === null) throw new Error('Fixture initial state is missing.')
  return initial.state
}

describe('Silent fast-forward in Beam Search', () => {
  it('advances Route progress only, without a Search Action or shared progress', async () => {
    const { input, dependencies, required, other } = sharedPositionScenario([10, 11])
    const result = await runPlannerBeamSearch(input, dependencies)

    expect(result.completed).toBe(true)
    expect(result.conflicts).toEqual([])
    const routeActions = (result.bestState?.trace ?? []).filter(
      ({ kind }) => kind === 'route_operation',
    )
    expect(routeActions).toHaveLength(2)
    expect(
      routeActions.every(
        ({ progressedBuildListEntryIds }) =>
          progressedBuildListEntryIds.length === 1,
      ),
    ).toBe(true)
    const otherActions = routeActions.filter(
      ({ primaryBuildListEntryId }) => primaryBuildListEntryId === other.id,
    )
    // The skippable Counter 10 unit never becomes an action; the Entry resumes
    // at its own required Counter 11 unit.
    expect(otherActions).toHaveLength(1)
    expect(otherActions[0].progressedRoutePositions[other.id].operationIndex).toBe(1)
    expect(otherActions[0].rngBefore.gogmaCounter).toBe(11)
    expect(
      routeActions.some(
        ({ primaryBuildListEntryId }) => primaryBuildListEntryId === required.id,
      ),
    ).toBe(true)
    expect(result.bestState?.currentRngState.gogmaCounter.value).toBe(12)
  })

  it('fails a past unit closed when it cannot be skipped', async () => {
    const { input, dependencies } = sharedPositionScenario([10])
    const result = await runPlannerBeamSearch(input, dependencies)

    expect(result.completed).toBe(false)
    expect(result.rejections).toContainEqual(
      expect.objectContaining({ reason: 'counter_before_current' }),
    )
  })

  it('advances only skippable past units and stops at the first required one', () => {
    const { input, dependencies, other } = sharedPositionScenario([10, 11])
    const plans = createPlannerRouteUnitPlans(
      input.buildListEntries,
      dependencies.rngEngine,
    )
    const state = initialStateFor(input)
    state.currentRngState.gogmaCounter.value = 11
    fastForwardPlannerRouteProgress(state, plans.unitPlans)
    expect(state.routeProgressByEntryId[other.id]).toBe(1)

    state.currentRngState.gogmaCounter.value = 20
    fastForwardPlannerRouteProgress(state, plans.unitPlans)
    // Counter 11 holds the Route's required final Reset, so progress stops.
    expect(state.routeProgressByEntryId[other.id]).toBe(1)
  })
})

describe('Shared Counter position conflicts', () => {
  function conflictsFor(otherOperationCounters: number[]) {
    const { input, dependencies, required, other, requiredTarget, otherTarget } =
      sharedPositionScenario(otherOperationCounters)
    const plans = createPlannerRouteUnitPlans(
      input.buildListEntries,
      dependencies.rngEngine,
    )
    return detectPlannerConflicts(
      [required, other],
      plans.unitPlans,
      [requiredTarget, otherTarget],
      initialStateFor(input),
      [],
    ).conflicts
  }

  it('does not report a required unit against a skippable unit', () => {
    expect(conflictsFor([10, 11])).toEqual([])
  })

  it('still reports two required units at the same Counter position', () => {
    expect(conflictsFor([10])).toContainEqual(
      expect.objectContaining({ kind: 'same_gogma_counter' }),
    )
  })
})

describe('Silent fast-forward on an unregistered route output', () => {
  it('keeps the transient Gogma without generating the skipped Reset result', async () => {
    const transientTarget = target('target.fast-forward.transient')
    const existingTarget = {
      ...target('target.fast-forward.existing'),
      weaponTypeId: 'weapon.fixture.b',
    }
    const existingSource = {
      ...sourceWeapon('owned.fast-forward.existing'),
      weaponTypeId: 'weapon.fixture.b',
    }
    const transient = routeEntry('entry.fast-forward.transient', transientTarget, {
      kind: 'normal_artian_to_gogma',
      sourceOwnedWeaponId: null,
      operations: [
        {
          type: 'create_normal_artian',
          weaponTypeId: 'weapon.fixture.a',
          rarity: 8,
          count: 1,
          normalCounterBefore: 4,
          normalCounterAfter: 5,
        },
        {
          type: 'convert_normal_to_gogma',
          weaponTypeId: 'weapon.fixture.a',
          skillCounterBefore: 7,
          skillCounterAfter: 8,
        },
        {
          type: 'reset_bonuses',
          sourceOwnedWeaponId: null,
          gogmaCounterBefore: 10,
          gogmaCounterAfter: 11,
        },
        {
          type: 'reset_bonuses',
          sourceOwnedWeaponId: null,
          gogmaCounterBefore: 11,
          gogmaCounterAfter: 12,
        },
      ],
    })
    const existing = routeEntry('entry.fast-forward.existing', existingTarget, {
      kind: 'existing_gogma_reset_bonuses',
      sourceOwnedWeaponId: existingSource.id,
      operations: [gogmaOperation('reset_bonuses', existingSource.id, 10)],
    })
    transient.candidateSnapshot.restorationBonusScope = 'gogma_artian'
    existing.candidateSnapshot.restorationBonusScope = 'gogma_artian'
    const { input, dependencies } = fixture(
      [transientTarget, existingTarget],
      [transient, existing],
      [existingSource],
    )
    const result = await runPlannerBeamSearch(input, dependencies)

    expect(result.completed).toBe(true)
    expect(result.conflicts).toEqual([])
    const transientActions = (result.bestState?.trace ?? []).filter(
      ({ primaryBuildListEntryId, kind }) =>
        primaryBuildListEntryId === transient.id && kind === 'route_operation',
    )
    expect(transientActions.map(({ actionType }) => actionType)).toEqual([
      'create_normal_artian',
      'convert_normal_to_gogma',
      'reset_bonuses',
    ])
    // Only the executed Counter 11 Reset turns the transient output into
    // Gogma scope; the fast-forwarded Counter 10 Reset produces nothing.
    expect(transientActions.at(-1)?.rngBefore.gogmaCounter).toBe(11)
    expect(
      result.bestState?.routeRuntimeByEntryId[transient.id],
    ).toEqual({
      hasUnregisteredGogmaOutput: true,
      transientRestorationBonusScope: 'gogma_artian',
    })
    expect(
      (result.bestState?.trace ?? []).every(
        ({ progressedBuildListEntryIds }) =>
          progressedBuildListEntryIds.length === 1,
      ),
    ).toBe(true)
  })
})

describe('Required unit execution eligibility', () => {
  /**
   * Counter 10 carries Entry A's required unit and Entry B's skippable unit.
   * The two do not conflict, but they are not interchangeable: running A first
   * lets B fast-forward, while running B first would push the Counter past A's
   * required unit and kill A's Route. The Planner decides that order itself.
   */
  it('never expands a skippable unit that would lose a required unit at the same Counter', async () => {
    const { input, dependencies, required, other } = sharedPositionScenario([10, 11])
    const result = await runPlannerBeamSearch(input, dependencies)

    expect(result.completed).toBe(true)
    expect(result.conflicts).toEqual([])
    // The branch that runs the skippable Counter 10 unit first is never
    // generated, so no Entry is ever rejected for a Counter it could have kept.
    expect(result.rejections).not.toContainEqual(
      expect.objectContaining({ reason: 'counter_before_current' }),
    )
    expect(
      (result.bestState?.trace ?? []).map(
        ({ primaryBuildListEntryId, actionType, rngBefore }) =>
          `${primaryBuildListEntryId}:${actionType}:${rngBefore.gogmaCounter}`,
      ),
    ).toEqual([
      `${required.id}:reset_bonuses:10`,
      `${required.id}:reserve_weapon:11`,
      `${other.id}:reset_bonuses:11`,
      `${other.id}:reserve_weapon:12`,
    ])
  })

  it('keeps both orders available when only skippable units share the position', async () => {
    // Counter 10 carries two skippable units, so neither dominates: whichever
    // Entry runs there, the other one fast-forwards and both Routes finish.
    const { input, dependencies, required, other } = sharedPositionScenario([10, 11])
    const requiredUnits = input.buildListEntries.find(
      ({ id }) => id === required.id,
    )
    if (!requiredUnits) throw new Error('Fixture Entry is missing.')
    requiredUnits.candidateSnapshot.route.operations = [
      gogmaOperation('reset_bonuses', ownedWeaponId('owned.fast-forward.required'), 10),
      gogmaOperation('reset_bonuses', ownedWeaponId('owned.fast-forward.required'), 12),
    ]
    synchronizeEntry(input, requiredUnits)
    const plans = createPlannerRouteUnitPlans(
      input.buildListEntries,
      dependencies.rngEngine,
    )
    expect(
      (plans.unitPlans.get(required.id) ?? []).map(
        ({ canSkipWhenCounterPassed }) => canSkipWhenCounterPassed,
      ),
    ).toEqual([true, false])
    const result = await runPlannerBeamSearch(input, dependencies)

    expect(result.conflicts).toEqual([])
    expect(result.completed).toBe(true)
    expect(result.bestState?.selectedBuildListEntryIds).toEqual(
      [required.id, other.id].sort(),
    )
    // Counter 10 is consumed exactly once by exactly one of the two Entries.
    const atTen = (result.bestState?.trace ?? []).filter(
      ({ kind, rngBefore }) =>
        kind === 'route_operation' && rngBefore.gogmaCounter === 10,
    )
    expect(atTen).toHaveLength(1)
  })
})
