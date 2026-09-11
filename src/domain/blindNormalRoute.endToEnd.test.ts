import { describe, expect, it } from 'vitest'
import { createBuildListEntry } from './buildList'
import { createProductionPlan } from './planner'
import type { PlannerDependencies, PlannerInput } from './planner'
import { searchCandidates } from './search'
import {
  createCandidateSearchEngine,
  createCandidateSearchInput,
  SEARCH_FIXTURE_TIME,
} from '../test/fixtures/candidateSearch'
import {
  createRestorationBonusSet,
  createValidNormalArtianCounter,
  ownedWeaponId,
} from '../test/fixtures/domainData'
import type { NormalArtianCounter } from './models/publicTypes'
import { createExpectedPlanState } from './models/publicTypes'
import type { RngEngine } from './rng/rngEngine'

const deterministicExecution = {
  now: () => SEARCH_FIXTURE_TIME,
  nowMs: () => 100,
}

/** Narrow Engine decorator; the delegate keeps every unmentioned behaviour. */
function withoutNormalPrediction(engine: RngEngine): RngEngine {
  return {
    version: engine.version,
    capabilities: { ...engine.capabilities, supportsNormalArtianPrediction: false },
    getPredictionSupport: engine.getPredictionSupport.bind(engine),
    normalizeSeed: engine.normalizeSeed.bind(engine),
    predictGogmaBonus: engine.predictGogmaBonus.bind(engine),
    predictSkills: engine.predictSkills.bind(engine),
    predictNormalArtian: () => {
      throw new Error('Blind creation must not predict a Normal Artian result.')
    },
    advanceGogmaCounter: engine.advanceGogmaCounter.bind(engine),
    advanceSkillCounter: engine.advanceSkillCounter.bind(engine),
    advanceNormalCounter: engine.advanceNormalCounter.bind(engine),
  }
}

/**
 * End-to-end coverage of `docs/SEARCH_SPEC.md` 6.1.1: a player who owns no
 * Artian weapon at all and has never identified a Normal Artian Counter can
 * still search a Candidate and execute it as a ProductionPlan, because the
 * Route forges one Normal Artian blind and immediately Resets all five slots.
 */
describe('forced Reset Normal Artian route, Search to ProductionPlan', () => {
  function scenario(normalCounters: NormalArtianCounter[] = []) {
    const input = createCandidateSearchInput()
    input.routeFilter = 'normal_artian'
    // No owned weapon, and by default no Normal Artian Counter record at all.
    input.ownedWeapons = []
    input.normalCounters = normalCounters
    const engine = createCandidateSearchEngine(input, {
      resetResult: createRestorationBonusSet(),
    })
    return { input, engine }
  }

  function plannerScenario(
    input: ReturnType<typeof scenario>['input'],
    engine: RngEngine,
    candidate: NonNullable<
      Awaited<ReturnType<typeof searchCandidates>>['targetResults'][number]['candidates'][number]
    >,
  ) {
    const target = input.targetWeapons[0]
    const entry = createBuildListEntry(candidate, target, {
      createdAt: SEARCH_FIXTURE_TIME,
    })
    const plannerInput: PlannerInput = {
      rngState: structuredClone(input.rngState),
      normalCounters: structuredClone(input.normalCounters),
      ownedWeapons: [],
      targetWeapons: [target],
      buildListEntries: [entry],
      calculationContext: { ...input.calculationContext },
      options: { beamWidth: 50, maxExpandedStates: 10_000, maxPlanSteps: 300 },
      master: input.master,
      conflictResolutions: [],
    }
    let sequence = 0
    const dependencies: PlannerDependencies = {
      rngEngine: engine,
      idFactory: {
        productionPlanId: () => 'plan.blind-normal' as never,
        planStepId: () => `step.blind-normal.${++sequence}` as never,
        ownedWeaponId: () => ownedWeaponId('owned.blind-normal.reserved'),
      },
      clock: { now: () => SEARCH_FIXTURE_TIME },
    }
    return { plannerInput, dependencies }
  }

  it('searches a Candidate with no owned weapon and no Normal Counter', async () => {
    const { input, engine } = scenario()
    const result = await searchCandidates(input, engine, deterministicExecution)
    const targetResult = result.targetResults[0]

    expect(targetResult.searchedRoutes).toContain('normal_artian_to_gogma')
    const candidate = targetResult.candidates.find(
      ({ route }) => route.kind === 'normal_artian_to_gogma',
    )
    expect(candidate).toBeDefined()
    expect(candidate?.route.operations).toEqual([
      expect.objectContaining({
        type: 'create_normal_artian',
        count: 1,
        normalCounterBefore: null,
        normalCounterAfter: null,
      }),
      expect.objectContaining({ type: 'convert_normal_to_gogma' }),
      expect.objectContaining({ type: 'reset_bonuses' }),
    ])
    expect(candidate?.restorationBonusScope).toBe('gogma_artian')
    expect(candidate?.finalBonuses).toEqual(createRestorationBonusSet())
  })

  it('plans and executes that Candidate as a ProductionPlan', async () => {
    const { input, engine } = scenario()
    const result = await searchCandidates(input, engine, deterministicExecution)
    const candidate = result.targetResults[0].candidates.find(
      ({ route }) => route.kind === 'normal_artian_to_gogma',
    )
    if (!candidate) throw new Error('Search produced no forced Reset Candidate.')
    const { plannerInput, dependencies } = plannerScenario(input, engine, candidate)

    const planned = await createProductionPlan(plannerInput, dependencies)
    expect(planned.warnings).toEqual([])
    expect(planned.conflicts).toEqual([])
    expect(planned.plan?.steps.map(({ operationType }) => operationType)).toEqual([
      'create_normal_artian',
      'convert_normal_to_gogma',
      'reset_bonuses',
      'reserve_weapon',
    ])
    const reserved = planned.plan?.steps[3].inventoryChange?.addOwnedWeapon
    expect(reserved).toEqual(expect.objectContaining({
      kind: 'gogma',
      restorationBonuses: createRestorationBonusSet(),
      restorationBonusScope: 'gogma_artian',
      isProtected: true,
    }))
    // Nothing claims to know a Normal Counter that was never identified.
    expect(planned.plan?.steps[0].debug?.startNormalCounter ?? null).toBeNull()
    expect(planned.plan?.steps[0].debug?.endNormalCounter ?? null).toBeNull()
  })

  it('advances a confirmed Normal Counter when only Normal prediction is missing', async () => {
    // The Counter is confirmed and only Normal Artian prediction is missing, so
    // Search falls back to the forced Reset variant. The forge is still real,
    // so the confirmed Counter advances 4 -> 5 (`docs/PLANNER_SPEC.md` 7.0.3).
    const counter = createValidNormalArtianCounter()
    expect(counter).toEqual(expect.objectContaining({ counter: 4, isConfirmed: true }))
    const { input, engine: delegate } = scenario([counter])
    const engine = withoutNormalPrediction(delegate)

    const result = await searchCandidates(input, engine, deterministicExecution)
    const candidate = result.targetResults[0].candidates.find(
      ({ route }) => route.kind === 'normal_artian_to_gogma',
    )
    if (!candidate) throw new Error('Search produced no forced Reset Candidate.')
    // The Candidate itself stays independent of the Counter position.
    expect(candidate.route.operations[0]).toEqual(expect.objectContaining({
      type: 'create_normal_artian',
      normalCounterBefore: null,
      normalCounterAfter: null,
    }))
    expect(candidate.estimatedNormalAdvance).toBeNull()

    const { plannerInput, dependencies } = plannerScenario(input, engine, candidate)
    const planned = await createProductionPlan(plannerInput, dependencies)
    const create = planned.plan?.steps[0]
    expect(create?.operationType).toBe('create_normal_artian')
    expect(create?.rngAdvance).toEqual({
      gogmaCounterDelta: 0,
      skillCounterDelta: 0,
      normalCounterDelta: 1,
      affectedNormalCounterId: 'weapon.fixture.a:8',
    })
    expect(create?.debug?.startNormalCounter).toBe(4)
    expect(create?.debug?.endNormalCounter).toBe(5)
    const hashAt = (value: number) => createExpectedPlanState(
      plannerInput.rngState,
      [{ ...counter, counter: value }],
      [],
    ).normalCountersHash
    expect(create?.expectedStateBefore.normalCountersHash).toBe(hashAt(4))
    expect(create?.expectedStateAfter.normalCountersHash).toBe(hashAt(5))
    expect(planned.plan?.steps.at(-1)?.expectedStateAfter.normalCountersHash)
      .toBe(hashAt(5))
  })
})
