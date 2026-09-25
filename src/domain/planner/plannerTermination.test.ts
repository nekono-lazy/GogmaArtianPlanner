import { describe, expect, it } from 'vitest'
import type {
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
import { runPlannerBeamSearchOracle } from '../../test/fixtures/plannerBeamOracle'
import { createProductionPlan } from './productionPlanGeneration'

/**
 * Typed Beam Search termination (PLANNER_SPEC 7.2.1).
 *
 * The scenario is deliberately tiny - two Targets, one shared Gogma Counter
 * stream, a handful of Keep operations each - because what is under test is the
 * status derivation and how it relates to the diagnostic warnings, not the
 * cost of a long Route. The real long-Route regression lives in
 * `plannerSearchLimitRegression.test.ts` and is run once.
 */
const FAMILY_A = 'bonus_type.fixture.utility'
const FAMILY_B = 'bonus_type.fixture.attack'
const LOW = 'bonus_rank.fixture.low'
const MIDDLE = 'bonus_rank.fixture.middle'
const HIGH = 'bonus_rank.fixture.high'

const A_KEEP_COUNT = 3
const B_KEEP_COUNT = 5
const LAST_GOGMA_COUNTER = A_KEEP_COUNT + B_KEEP_COUNT - 1

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
        requiredExCount: 0,
      },
    ],
    alternativeBonusRules: [],
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
    status: 'unclassified',
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

function scenarioEngine(baseSeed: string, master: PlannerInput['master']) {
  const gogmaCounterAdvances: FakeRngFixtures['gogmaCounterAdvances'] = []
  for (let counter = 0; counter <= LAST_GOGMA_COUNTER + 1; counter += 1) {
    gogmaCounterAdvances.push({
      current: counter,
      operation: { type: 'keep_bonuses' },
      result: counter + 1,
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
      const result =
        index === count - 1 ? bonuses(family, HIGH) : bonuses(family, MIDDLE)
      const currentRankIds = [LOW, MIDDLE]
      currentRankIds.forEach((currentRankId) => {
        keepBonusPredictions.push({
          input: {
            baseSeed,
            gogmaCounter: from + index,
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
  pushKeeps('element.fixture.a', FAMILY_A, 0, A_KEEP_COUNT)
  pushKeeps('element.fixture.b', FAMILY_B, 0, A_KEEP_COUNT + B_KEEP_COUNT)
  return new FakeRngEngine({
    version: 'planner-beam-v1',
    capabilities: {
      supportsNormalArtianPrediction: true,
      supportsGogmaPrediction: true,
      supportsSkillPrediction: true,
      supportsKeepBonusesPrediction: true,
    },
    normalizedSeeds: [],
    resetBonusPredictions: [],
    keepBonusPredictions,
    skillPredictions: [],
    normalArtianPredictions: [],
    gogmaCounterAdvances,
    skillCounterAdvances: [],
    normalCounterAdvances: [],
  })
}

function scenario(): { input: PlannerInput; dependencies: PlannerDependencies } {
  const targetA = scenarioTarget('target.termination.a', 'element.fixture.a', FAMILY_A)
  const targetB = scenarioTarget('target.termination.b', 'element.fixture.b', FAMILY_B)
  const sourceA = scenarioSource('owned.termination.a', 'element.fixture.a', FAMILY_A)
  const sourceB = scenarioSource('owned.termination.b', 'element.fixture.b', FAMILY_B)
  const routeA: BuildRoute = {
    kind: 'existing_gogma_keep_bonuses',
    sourceOwnedWeaponId: sourceA.id,
    operations: keepOperations(sourceA.id, 0, A_KEEP_COUNT),
  }
  const routeB: BuildRoute = {
    kind: 'existing_gogma_keep_bonuses',
    sourceOwnedWeaponId: sourceB.id,
    operations: keepOperations(sourceB.id, 0, A_KEEP_COUNT + B_KEEP_COUNT),
  }
  const entryA = routeEntry('entry.termination.a', targetA, routeA)
  entryA.candidateSnapshot.finalBonuses = bonuses(FAMILY_A, HIGH)
  entryA.candidateSnapshot.restorationBonusScope = 'gogma_artian'
  entryA.candidateSnapshot.groupSkillId = null
  const entryB = routeEntry('entry.termination.b', targetB, routeB)
  entryB.candidateSnapshot.finalBonuses = bonuses(FAMILY_B, HIGH)
  entryB.candidateSnapshot.restorationBonusScope = 'gogma_artian'
  entryB.candidateSnapshot.groupSkillId = null
  const { input, dependencies } = fixture(
    [targetA, targetB],
    [entryA, entryB],
    [sourceA, sourceB],
  )
  input.rngState.gogmaCounter = { value: 0, isConfirmed: true, source: 'observation' }
  input.buildListEntries.forEach((entry) => synchronizeEntry(input, entry))
  dependencies.rngEngine = scenarioEngine(
    input.rngState.baseSeed.value as string,
    input.master,
  )
  return { input, dependencies }
}

describe('Planner search termination', () => {
  it('reports completed with the bounds the search actually ran with', async () => {
    const built = scenario()
    const input = { ...built.input, options: { maxPlanSteps: 300, beamWidth: 50, maxExpandedStates: 10_000 } }
    const result = await runPlannerBeamSearchOracle(input, built.dependencies)

    expect(result.completed).toBe(true)
    expect(result.termination).toEqual({
      status: 'completed',
      reachedLimits: [],
      limits: { maxPlanSteps: 300, beamWidth: 50, maxExpandedStates: 10_000 },
      expandedStates: result.expandedStates,
      completedTargetCount: 2,
      totalTargetCount: 2,
    })
    // The bounds carried are the ones the caller chose, never a module default.
    expect(result.termination.limits).not.toBe(input.options)
  })

  it('reports incomplete with max_expanded_states and never contradicts its warning', async () => {
    const { input, dependencies } = scenario()
    const result = await runPlannerBeamSearchOracle(
      { ...input, options: { maxPlanSteps: 300, beamWidth: 50, maxExpandedStates: 2 } },
      dependencies,
    )

    expect(result.completed).toBe(false)
    expect(result.termination.status).toBe('incomplete')
    expect(result.termination.reachedLimits).toEqual(['max_expanded_states'])
    expect(result.termination.expandedStates).toBe(2)
    expect(result.termination.limits.maxExpandedStates).toBe(2)
    expect(result.termination.totalTargetCount).toBe(2)
    expect(result.termination.completedTargetCount).toBeLessThan(2)
    // The warning stays a diagnostic saying the same thing, never the authority.
    expect(result.warnings.map(({ kind }) => kind)).toContain(
      'max_expanded_states_reached',
    )
  })

  it('reports incomplete with max_plan_steps when the step bound truncates the search', async () => {
    const { input, dependencies } = scenario()
    const result = await runPlannerBeamSearchOracle(
      { ...input, options: { maxPlanSteps: 2, beamWidth: 50, maxExpandedStates: 10_000 } },
      dependencies,
    )

    expect(result.termination.status).toBe('incomplete')
    expect(result.termination.reachedLimits).toContain('max_plan_steps')
    expect(result.termination.limits.maxPlanSteps).toBe(2)
    expect(result.warnings.map(({ kind }) => kind)).toContain('max_steps_reached')
  })

  it('reports cancelled rather than incomplete when the user stopped the search', async () => {
    const { input, dependencies } = scenario()
    const result = await runPlannerBeamSearchOracle(input, dependencies, {
      shouldCancel: () => true,
    })

    expect(result.cancelled).toBe(true)
    expect(result.termination.status).toBe('cancelled')
    expect(result.termination.reachedLimits).toEqual([])
  })

  it('reports exhausted, not incomplete, when an invalid input never reached the search', async () => {
    const { input, dependencies } = scenario()
    input.buildListEntries = []
    const result = await runPlannerBeamSearchOracle(input, dependencies)

    // No `PlannerOptions` bound was touched, so this keeps its existing "no
    // Plan from this input" meaning and stays saveable/reportable as before.
    expect(result.termination.status).toBe('exhausted')
    expect(result.termination.reachedLimits).toEqual([])
    expect(result.termination.expandedStates).toBe(0)
    expect(result.termination.completedTargetCount).toBe(0)
    // No valid BuildListEntry means no planning Target: the two active Targets
    // are never counted when the Build List gives them no Route (#102).
    expect(result.termination.totalTargetCount).toBe(0)
  })

  it('counts only the Build List Targets and stays consistent with its status (#102)', async () => {
    // Two active Targets the Build List gives no Route. Their element matches
    // no Route of the run, so under the old "every active Target" contract
    // this search could never complete.
    const unlisted = ['c', 'd'].map((suffix) => ({
      ...scenarioTarget(`target.termination.unlisted.${suffix}`, 'element.fixture.c', FAMILY_A),
    }))
    const full = scenario()
    full.input.targetWeapons.push(...unlisted)
    const completed = await runPlannerBeamSearchOracle(full.input, full.dependencies)
    expect(completed.termination).toMatchObject({
      status: 'completed',
      completedTargetCount: 2,
      totalTargetCount: 2,
    })
    expect(completed.completed).toBe(true)

    const truncated = scenario()
    truncated.input.targetWeapons.push(...structuredClone(unlisted))
    const partial = await runPlannerBeamSearchOracle(
      { ...truncated.input, options: { maxPlanSteps: 300, beamWidth: 50, maxExpandedStates: 2 } },
      truncated.dependencies,
    )
    expect(partial.termination.status).toBe('incomplete')
    expect(partial.termination.reachedLimits).toEqual(['max_expanded_states'])
    expect(partial.termination.totalTargetCount).toBe(2)
    expect(partial.termination.completedTargetCount).toBeLessThan(2)
  })

  it('carries the scheduler termination out through Production Plan generation', async () => {
    const { input, dependencies } = scenario()
    input.options = { maxPlanSteps: 1 }
    const truncated = await createProductionPlan(input, dependencies)

    expect(truncated.termination.status).toBe('incomplete')
    expect(truncated.termination.reachedLimits).toEqual(['max_plan_steps'])
    expect(truncated.termination.limits).toEqual({ maxPlanSteps: 1 })

    const { input: fullInput, dependencies: fullDependencies } = scenario()
    const completed = await createProductionPlan(fullInput, fullDependencies)
    expect(completed.plan).not.toBeNull()
    expect(completed.termination.status).toBe('completed')
    expect(completed.termination.completedTargetCount).toBe(2)
  })

  /**
   * Phase D-1 / D-2a: Production Plan generation runs the deterministic
   * scheduler over the Production `PlannerOptions` (`maxPlanSteps` only), so
   * it can never report `max_expanded_states`, while the Beam Search oracle
   * still stops on its own bound over the same Planner input.
   */
  it('never reports max_expanded_states from Production Plan generation', async () => {
    const { input, dependencies } = scenario()
    input.options = { maxPlanSteps: 1000 }
    const production = await createProductionPlan(input, dependencies)
    expect(production.plan).not.toBeNull()
    expect(production.termination).toMatchObject({
      status: 'completed',
      reachedLimits: [],
      limits: { maxPlanSteps: 1000 },
    })
    expect(production.warnings.map(({ kind }) => kind)).not.toContain(
      'max_expanded_states_reached',
    )

    const oracle = scenario()
    const beam = await runPlannerBeamSearchOracle(
      { ...oracle.input, options: { maxPlanSteps: 1000, beamWidth: 50, maxExpandedStates: 1 } },
      oracle.dependencies,
    )
    expect(beam.termination).toMatchObject({
      status: 'incomplete',
      reachedLimits: ['max_expanded_states'],
    })
  })
})
