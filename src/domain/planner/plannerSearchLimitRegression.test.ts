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
import { fixture, routeEntry, synchronizeEntry } from '../../test/fixtures/plannerBeam'
import { FakeRngEngine, type FakeRngFixtures } from '../rng/fakeRngEngine'
import type { PlannerDependencies, PlannerInput } from './plannerTypes'
import { runPlannerBeamSearch } from './plannerBeamSearch'
import { createProductionPlan } from './productionPlanGeneration'

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
const FIRE_SKILL_RESET_COUNT = 82
const SKILL_START = 7

const WATER_SERIES = 'series_skill.fixture.a'
const FIRE_SERIES = 'series_skill.fixture.b'

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
  seriesSkillId: string,
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
        requiredExCount: 0,
      },
    ],
    alternativeBonusRules: [],
    idealSkillCondition: { seriesSkillId, groupSkillId: null, matchMode: 'all' },
    practicalSkillCondition: { seriesSkillId: null, groupSkillId: null, matchMode: 'any' },
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
    seriesSkillId: WATER_SERIES,
    groupSkillId: null,
    status: 'material',
    isProtected: false,
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

function resetSkillsOperations(
  sourceId: OwnedGogmaArtianWeapon['id'],
  from: number,
  count: number,
): RouteOperation[] {
  return Array.from({ length: count }, (_unused, index) => ({
    type: 'reset_skills' as const,
    sourceOwnedWeaponId: sourceId,
    skillCounterBefore: from + index,
    skillCounterAfter: from + index + 1,
  }))
}

function scenarioEngine(baseSeed: string, master: PlannerInput['master']) {
  const gogmaCounterAdvances: FakeRngFixtures['gogmaCounterAdvances'] = []
  for (let counter = 0; counter <= LAST_GOGMA_COUNTER + 1; counter += 1) {
    gogmaCounterAdvances.push(
      { current: counter, operation: { type: 'reset_bonuses' }, result: counter + 1 },
      { current: counter, operation: { type: 'keep_bonuses' }, result: counter + 1 },
    )
  }
  const skillCounterAdvances: FakeRngFixtures['skillCounterAdvances'] = []
  for (let counter = 0; counter <= SKILL_START + FIRE_SKILL_RESET_COUNT + 1; counter += 1) {
    skillCounterAdvances.push(
      { current: counter, operation: { type: 'reset_skills' }, result: counter + 1 },
      { current: counter, operation: { type: 'convert_normal_to_gogma' }, result: counter + 1 },
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
      const result = index === count - 1 ? bonuses(family, HIGH) : bonuses(family, MIDDLE)
      const currentRankIds = [LOW, MIDDLE]
      currentRankIds.forEach((currentRankId) => {
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

  const skillPredictions: FakeRngFixtures['skillPredictions'] = []
  for (let index = 0; index < FIRE_SKILL_RESET_COUNT + 2; index += 1) {
    const counter = SKILL_START + index
    const elementIds = ['element.fixture.a', 'element.fixture.b']
    elementIds.forEach((elementId) => {
      skillPredictions.push({
        input: {
          baseSeed,
          skillCounter: counter,
          weaponTypeId: 'weapon.fixture.a',
          elementId,
          master,
        },
        result: {
          seriesSkillId:
            index === FIRE_SKILL_RESET_COUNT - 1 ? FIRE_SERIES : WATER_SERIES,
          groupSkillId: null,
        },
      })
    })
  }
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
    skillPredictions,
    normalArtianPredictions: [],
    gogmaCounterAdvances,
    skillCounterAdvances,
    normalCounterAdvances: [],
  })
}

function scenario(): {
  input: PlannerInput
  dependencies: PlannerDependencies
  water: BuildListEntry
  fire: BuildListEntry
  waterTarget: TargetWeapon
  fireTarget: TargetWeapon
} {
  const waterTarget = scenarioTarget(
    'target.long.water',
    'element.fixture.a',
    WATER_FAMILY,
    WATER_SERIES,
  )
  const fireTarget = scenarioTarget(
    'target.long.fire',
    'element.fixture.b',
    FIRE_FAMILY,
    FIRE_SERIES,
  )
  const waterSource = scenarioSource(
    'owned.long.water',
    'element.fixture.a',
    WATER_FAMILY,
  )
  const fireSource = scenarioSource(
    'owned.long.fire',
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
      ...resetSkillsOperations(fireSource.id, SKILL_START, FIRE_SKILL_RESET_COUNT),
    ],
  }
  const water = routeEntry('entry.long.water', waterTarget, waterRoute)
  water.candidateSnapshot.finalBonuses = bonuses(WATER_FAMILY, HIGH)
  water.candidateSnapshot.restorationBonusScope = 'gogma_artian'
  water.candidateSnapshot.seriesSkillId = WATER_SERIES
  water.candidateSnapshot.groupSkillId = null
  const fire = routeEntry('entry.long.fire', fireTarget, fireRoute)
  fire.candidateSnapshot.finalBonuses = bonuses(FIRE_FAMILY, HIGH)
  fire.candidateSnapshot.restorationBonusScope = 'gogma_artian'
  fire.candidateSnapshot.seriesSkillId = FIRE_SERIES
  fire.candidateSnapshot.groupSkillId = null
  const { input, dependencies } = fixture(
    [waterTarget, fireTarget],
    [water, fire],
    [waterSource, fireSource],
  )
  input.rngState.gogmaCounter = { value: 0, isConfirmed: true, source: 'observation' }
  input.rngState.skillCounter = {
    value: SKILL_START,
    isConfirmed: true,
    source: 'observation',
  }
  input.buildListEntries.forEach((entry) => synchronizeEntry(input, entry))
  dependencies.rngEngine = scenarioEngine(
    input.rngState.baseSeed.value as string,
    input.master,
  )
  return { input, dependencies, water, fire, waterTarget, fireTarget }
}

/**
 * The project owner's reproduction case: one long Bonus Route and one long
 * Bonus + Skill Route sharing the same Gogma Counter stream
 * (PLANNER_SPEC 7.2.1).
 *
 * Water keeps 23 times from Gogma Counter 0. Fire resets 140 times from the
 * same position, keeps 8 times, and then resets Skills 82 times, so the
 * complete Plan is 148 Bonus operations, 82 Skill operations and 2 reserves -
 * 232 PlanSteps. It fits `maxPlanSteps = 300` comfortably, but the Beam Search
 * needs about 12,276 expanded states to reach it, so the default
 * `maxExpandedStates = 10_000` truncates it first and leaves only the water
 * Route secured.
 *
 * The scenario is expensive, so it is built once per test and only two runs
 * exist: one at the defaults proving the truncation is reported as typed
 * `incomplete`, and one with a raised bound proving the complete Plan.
 */
describe('Planner search limits on a long Bonus + Skill Route', () => {
  it('reports a typed incomplete search at the default bounds', async () => {
    const { input, dependencies, water, waterTarget, fireTarget } = scenario()
    const result = await runPlannerBeamSearch(input, dependencies)

    // The root cause is the expanded-state bound, not the step bound, not a
    // conflict, and not an inventory or source-version rejection.
    expect(result.termination.status).toBe('incomplete')
    expect(result.termination.reachedLimits).toEqual(['max_expanded_states'])
    expect(result.termination.expandedStates).toBe(10_000)
    expect(result.termination.limits).toEqual({
      maxPlanSteps: 300,
      beamWidth: 50,
      maxExpandedStates: 10_000,
    })
    expect(result.termination.completedTargetCount).toBe(1)
    expect(result.termination.totalTargetCount).toBe(2)
    expect(result.conflicts).toEqual([])
    expect(result.rejections).toEqual([])

    // The best partial state is exactly the misleading 24 step result the
    // project owner saw: water's 23 Keeps plus its reserve.
    expect(result.completed).toBe(false)
    expect(result.bestState?.selectedBuildListEntryIds).toEqual([water.id])
    expect(result.bestState?.trace).toHaveLength(WATER_KEEP_COUNT + 1)
    expect(result.bestState?.targetSatisfaction[waterTarget.id]?.hasIdeal).toBe(true)
    expect(result.bestState?.targetSatisfaction[fireTarget.id]?.hasIdeal).toBe(false)
  }, 300_000)

  it('completes both Targets once maxExpandedStates is raised', async () => {
    const { input, dependencies, water, fire, waterTarget, fireTarget } = scenario()
    // The measured complete search costs 12,276 expanded states; 15,000 is the
    // round value a user would enter in the detail settings.
    input.options = { maxPlanSteps: 300, beamWidth: 50, maxExpandedStates: 15_000 }
    const { plan, conflicts, warnings, termination } = await createProductionPlan(
      input,
      dependencies,
    )

    expect(termination.status).toBe('completed')
    expect(termination.reachedLimits).toEqual([])
    expect(termination.expandedStates).toBeLessThan(15_000)
    expect(termination.completedTargetCount).toBe(2)
    expect(termination.totalTargetCount).toBe(2)
    expect(conflicts).toEqual([])
    expect(warnings).toEqual([])

    expect(plan).not.toBeNull()
    const steps = plan?.steps ?? []
    // 23 water Keeps + 125 fire Bonus operations + 82 Reset Skills + 2 reserves.
    // Fire's first 23 Route units are fast-forwarded by water's Keeps, so they
    // never become PlanSteps (PLANNER_SPEC 7.0.2).
    expect(steps).toHaveLength(232)
    const countFor = (entryId: string, operationType: string) =>
      steps.filter(
        (step) =>
          step.buildListEntryId === entryId && step.operationType === operationType,
      ).length
    expect(countFor(water.id, 'keep_bonuses')).toBe(WATER_KEEP_COUNT)
    expect(countFor(water.id, 'reserve_weapon')).toBe(1)
    expect(
      countFor(fire.id, 'reset_bonuses') + countFor(fire.id, 'keep_bonuses'),
    ).toBe(LAST_GOGMA_COUNTER + 1 - WATER_KEEP_COUNT)
    expect(countFor(fire.id, 'keep_bonuses')).toBe(FIRE_KEEP_COUNT)
    expect(countFor(fire.id, 'reset_skills')).toBe(FIRE_SKILL_RESET_COUNT)
    expect(countFor(fire.id, 'reserve_weapon')).toBe(1)

    // The global order the Beam Search actually selected: one water Bonus
    // block, then the fire Bonus block, then the fire Skill block, so the
    // player picks up a second weapon once (PLANNER_SPEC 7.3).
    const blocks = steps
      .filter(({ operationType }) => operationType !== 'reserve_weapon')
      .map(({ buildListEntryId }) => buildListEntryId)
      .filter((entryId, index, all) => index === 0 || all[index - 1] !== entryId)
    expect(blocks).toEqual([water.id, fire.id])

    expect(plan?.selectedBuildListEntryIds).toEqual([water.id, fire.id].sort())
    expect(plan?.rejectedBuildListEntries).toEqual([])
    void waterTarget
    void fireTarget
  }, 300_000)
})
