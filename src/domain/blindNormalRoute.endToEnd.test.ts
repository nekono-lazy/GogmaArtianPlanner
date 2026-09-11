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
  ownedWeaponId,
} from '../test/fixtures/domainData'

const deterministicExecution = {
  now: () => SEARCH_FIXTURE_TIME,
  nowMs: () => 100,
}

/**
 * End-to-end coverage of `docs/SEARCH_SPEC.md` 6.1.1: a player who owns no
 * Artian weapon at all and has never identified a Normal Artian Counter can
 * still search a Candidate and execute it as a ProductionPlan, because the
 * Route forges one Normal Artian blind and immediately Resets all five slots.
 */
describe('forced Reset Normal Artian route, Search to ProductionPlan', () => {
  function scenario() {
    const input = createCandidateSearchInput()
    input.routeFilter = 'normal_artian'
    // No owned weapon, and no Normal Artian Counter record whatsoever.
    input.ownedWeapons = []
    input.normalCounters = []
    const engine = createCandidateSearchEngine(input, {
      resetResult: createRestorationBonusSet(),
    })
    return { input, engine }
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
    const target = input.targetWeapons[0]
    const candidate = result.targetResults[0].candidates.find(
      ({ route }) => route.kind === 'normal_artian_to_gogma',
    )
    if (!candidate) throw new Error('Search produced no forced Reset Candidate.')
    const entry = createBuildListEntry(candidate, target, {
      createdAt: SEARCH_FIXTURE_TIME,
    })

    const plannerInput: PlannerInput = {
      rngState: structuredClone(input.rngState),
      normalCounters: [],
      ownedWeapons: [],
      targetWeapons: [target],
      buildListEntries: [entry],
      calculationContext: { ...input.calculationContext },
      options: { beamWidth: 50, maxExpandedStates: 10_000, maxPlanSteps: 300 },
      master: input.master,
      conflictResolutions: [],
    }
    let weaponSequence = 0
    const dependencies: PlannerDependencies = {
      rngEngine: engine,
      idFactory: {
        productionPlanId: () => 'plan.blind-normal' as never,
        planStepId: () => `step.blind-normal.${++weaponSequence}` as never,
        ownedWeaponId: () => ownedWeaponId('owned.blind-normal.reserved'),
      },
      clock: { now: () => SEARCH_FIXTURE_TIME },
    }

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
})
