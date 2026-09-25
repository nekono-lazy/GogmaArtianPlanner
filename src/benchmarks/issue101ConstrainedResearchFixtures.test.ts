import { beforeAll, describe, expect, it } from 'vitest'
import {
  createConstrainedMaterializer,
  createProductionPlan,
  createProductionPlanWithConstrainedSearch,
  defaultPlannerOrchestrationBounds,
  type PlannerDependencies,
} from '../domain/planner'
import { CURRENT_CALCULATION_APP_SCHEMA_VERSION } from '../domain/models/publicTypes'
import {
  PRODUCTION_RNG_ENGINE_VERSION,
  ProductionRngEngine,
} from '../domain/rng/production/productionRngEngine'
import {
  defaultConstrainedEnumerationBounds,
  visitConstrainedCandidates,
  type ConstrainedCandidate,
  type ConstrainedEnumerationBounds,
} from '../domain/search'
import { createProductionPlannerDependencies } from '../domain/planner'
import {
  assertIssue101EnumerationBounds,
  createIssue101EnumerationInput,
  createIssue101OrchestrationInput,
  createIssue101RealFixture,
  ISSUE_101_BASELINE_BOUNDS,
  ISSUE_101_GOGMA_SWEEP,
  issue101GogmaBounds,
  type Issue101RealFixture,
} from './issue101ConstrainedResearchFixtures'
import { summarizeIssue101Route } from './issue101RouteSummary'
import {
  observeIssue101PlannerDependencies,
  summarizeIssue101Orchestration,
} from '../workers/issue101ConstrainedResearch.worker.benchmark'

/*
 * Issue #101 fixture semantics under the current Production authorities.
 *
 * Only semantic outcomes are asserted - never a duration. The expanded-bound
 * cases use `maxNormalForgeCount = 1`: the first alternative Fire Route starts
 * from Normal offset 0, so one Route base is enough to reach it and the test
 * does not pay the 40-base stream solve the Browser benchmark measures.
 */

const SLOW = 120_000

function narrowGogmaBounds(maxGogmaAdvance: number): ConstrainedEnumerationBounds {
  return { ...issue101GogmaBounds(maxGogmaAdvance), maxNormalForgeCount: 1 }
}

async function firstCandidates(
  bounds: ConstrainedEnumerationBounds,
  limit: number,
): Promise<{ candidates: ConstrainedCandidate[]; stoppedByBound: boolean; exhausted: boolean }> {
  const candidates: ConstrainedCandidate[] = []
  const execution = await visitConstrainedCandidates(
    createIssue101EnumerationInput('issue101_real_fire', bounds),
    new ProductionRngEngine(),
    (candidate) => {
      candidates.push(candidate)
      return candidates.length >= limit ? 'stop' : 'continue'
    },
  )
  return {
    candidates,
    stoppedByBound: execution.summary.stoppedByBound,
    exhausted: execution.summary.exhausted,
  }
}

const EXPECTED_ISSUE_ROUTE = {
  kind: 'normal_artian_to_gogma',
  operationCount: 3,
  normalForgeCount: 207,
  normalCounterBefore: 0,
  conversionSkillCounter: 341,
  resetBonusesCount: 0,
  keepBonusesCount: 1,
  resetSkillsCount: 0,
  firstGogmaCounter: 55,
  lastGogmaCounter: 55,
  estimatedGogmaAdvance: 1,
  estimatedSkillAdvance: 1,
  estimatedNormalAdvance: 207,
}

const EXPECTED_ALTERNATIVE_ROUTE = {
  kind: 'normal_artian_to_gogma',
  operationCount: 237,
  normalForgeCount: 1,
  normalCounterBefore: 0,
  conversionSkillCounter: 341,
  resetBonusesCount: 235,
  keepBonusesCount: 0,
  resetSkillsCount: 0,
  firstGogmaCounter: 55,
  lastGogmaCounter: 289,
  estimatedGogmaAdvance: 235,
  estimatedSkillAdvance: 1,
  estimatedNormalAdvance: 1,
}

describe('Issue #101 benchmark bounds', () => {
  it('keeps the baseline equal to the current Production enumeration default', () => {
    expect(ISSUE_101_BASELINE_BOUNDS).toEqual(defaultConstrainedEnumerationBounds)
    expect(defaultConstrainedEnumerationBounds).toEqual({
      maxNormalForgeCount: 40,
      maxGogmaAdvance: 30,
      maxSkillResetCount: 100,
      maxOffAxisPairEvaluations: 500,
    })
    expect(ISSUE_101_GOGMA_SWEEP).toEqual([30, 50, 100, 150, 200, 250, 350])
  })

  it('overrides only the Gogma axis', () => {
    expect(issue101GogmaBounds(235)).toEqual({ ...ISSUE_101_BASELINE_BOUNDS, maxGogmaAdvance: 235 })
    expect(createIssue101EnumerationInput('issue101_real_fire', issue101GogmaBounds(250)).bounds)
      .toEqual({ maxNormalForgeCount: 40, maxGogmaAdvance: 250, maxSkillResetCount: 100, maxOffAxisPairEvaluations: 500 })
  })

  it.each([
    { maxGogmaAdvance: 0 },
    { maxGogmaAdvance: -1 },
    { maxGogmaAdvance: 1.5 },
    { maxNormalForgeCount: 0 },
    { maxSkillResetCount: Number.NaN },
    { maxOffAxisPairEvaluations: -1 },
  ])('fails closed on invalid bounds %o without repairing them', (override) => {
    const bounds = { ...ISSUE_101_BASELINE_BOUNDS, ...override }
    expect(() => assertIssue101EnumerationBounds(bounds)).toThrow(RangeError)
    expect(() => createIssue101EnumerationInput('issue101_real_fire', bounds)).toThrow(RangeError)
    expect(() => createIssue101EnumerationInput('issue101_no_ideal', bounds)).toThrow(RangeError)
  })

  it('does not move any version authority', () => {
    expect(CURRENT_CALCULATION_APP_SCHEMA_VERSION).toBe(15)
    expect(PRODUCTION_RNG_ENGINE_VERSION).toBe('production-rng:c5-e7')
  })
})

describe('Issue #101 real case (current Production authorities)', () => {
  let fixture: Issue101RealFixture
  let dependencies: PlannerDependencies

  beforeAll(async () => {
    fixture = await createIssue101RealFixture()
    dependencies = createProductionPlannerDependencies(new ProductionRngEngine())
  }, SLOW)

  it('reproduces the Issue Route for both Targets from Candidate Search', () => {
    expect(summarizeIssue101Route(fixture.fireCandidate.route, fixture.fireCandidate)).toEqual(EXPECTED_ISSUE_ROUTE)
    expect(summarizeIssue101Route(fixture.dragonCandidate.route, fixture.dragonCandidate)).toEqual(EXPECTED_ISSUE_ROUTE)
    expect(fixture.fireCandidate.calculationContext.rngEngineVersion).toBe(PRODUCTION_RNG_ENGINE_VERSION)
  })

  it('is deterministic across fixture builds', async () => {
    const again = await createIssue101RealFixture()
    expect(again.fireEntry.id).toBe(fixture.fireEntry.id)
    expect(again.dragonEntry.id).toBe(fixture.dragonEntry.id)
    expect(again.fireCandidate.route).toEqual(fixture.fireCandidate.route)
    expect(again.initialConflicts.map(({ id }) => id)).toEqual(fixture.initialConflicts.map(({ id }) => id))
  }, SLOW)

  it('keeps one Normal conflict after Issue #129, beside the Skill and Gogma conflicts', () => {
    const kinds = fixture.initialConflicts.map(({ kind }) => kind).sort()
    expect(kinds).toEqual(['same_gogma_counter', 'same_normal_counter', 'same_skill_counter'])
    const normal = fixture.initialConflicts.find(({ kind }) => kind === 'same_normal_counter')
    expect(normal?.reason).toContain('position 206')
    expect(fixture.initialConflicts.find(({ kind }) => kind === 'same_skill_counter')?.reason)
      .toContain('Skill Counter 341')
    for (const conflict of fixture.initialConflicts) {
      expect([...conflict.buildListEntryIds].sort()).toEqual(
        [fixture.fireEntry.id, fixture.dragonEntry.id].sort(),
      )
    }
  })

  it('finds no alternative Fire Candidate inside the baseline bounds', async () => {
    const result = await firstCandidates(ISSUE_101_BASELINE_BOUNDS, 1)
    expect(result.candidates).toHaveLength(0)
    expect(result.stoppedByBound).toBe(true)
    expect(result.exhausted).toBe(false)
  }, SLOW)

  it('reaches the first alternative Fire Candidate exactly at Gogma 235', async () => {
    const below = await firstCandidates(narrowGogmaBounds(234), 1)
    expect(below.candidates).toHaveLength(0)
    expect(below.stoppedByBound).toBe(true)
    const at = await firstCandidates(narrowGogmaBounds(235), 1)
    expect(at.candidates).toHaveLength(1)
    expect(summarizeIssue101Route(at.candidates[0].route, at.candidates[0])).toEqual(EXPECTED_ALTERNATIVE_ROUTE)
  }, SLOW)

  it('cannot adopt that alternative: it still converts at Skill Counter 341 beside Dragon', async () => {
    const bounds = narrowGogmaBounds(235)
    const [alternative] = (await firstCandidates(bounds, 1)).candidates
    const materializer = createConstrainedMaterializer({
      origin: createIssue101EnumerationInput('issue101_real_fire', bounds).origin,
      targetWeaponId: fixture.fireEntry.targetWeaponId,
      bounds,
      clock: dependencies.clock,
    })
    const { entry } = materializer.materializeBuildListEntry(alternative, [])
    const result = await createProductionPlan(
      { ...fixture.plannerInput, buildListEntries: [fixture.dragonEntry, entry] },
      dependencies,
      undefined,
    )
    expect(result.plan?.selectedBuildListEntryIds).toEqual([fixture.dragonEntry.id])
    expect(result.conflicts.map(({ kind, selectedBuildListEntryId }) => ({ kind, selectedBuildListEntryId })))
      .toEqual([{ kind: 'same_skill_counter', selectedBuildListEntryId: null }])
  }, SLOW)

  it.each(['primary', 'all'] as const)(
    'orchestration with the %s resolution scope adopts nothing even with the Candidate in range',
    async (scope) => {
      const startedAt = performance.now()
      const observed = observeIssue101PlannerDependencies(dependencies, () => performance.now() - startedAt)
      const result = await createProductionPlanWithConstrainedSearch(
        createIssue101OrchestrationInput(fixture, scope),
        observed.dependencies,
        { enumerationBounds: narrowGogmaBounds(235), orchestrationBounds: defaultPlannerOrchestrationBounds },
      )
      const measurement = summarizeIssue101Orchestration(observed.events(), result, 0)
      expect(measurement.generatedBuildListEntryCount).toBe(0)
      expect(measurement.adoptedCandidateOrdinal).toBeNull()
      expect(measurement.candidateTrials).toBeGreaterThanOrEqual(1)
      expect(measurement.selectedBuildListEntryIds).toEqual([fixture.dragonEntry.id])
      expect(measurement.conflicts.map(({ kind }) => kind))
        .toEqual(['same_gogma_counter', 'same_normal_counter', 'same_skill_counter'])
      expect(measurement.warningKinds).toContain('constrained_enumeration_bound_reached')
    },
    SLOW,
  )

  it('orchestration at the baseline bounds reports the enumeration bound, with no trial', async () => {
    const observed = observeIssue101PlannerDependencies(dependencies, () => 0)
    const result = await createProductionPlanWithConstrainedSearch(
      createIssue101OrchestrationInput(fixture, 'primary'),
      observed.dependencies,
      { enumerationBounds: ISSUE_101_BASELINE_BOUNDS, orchestrationBounds: defaultPlannerOrchestrationBounds },
    )
    const measurement = summarizeIssue101Orchestration(observed.events(), result, 0)
    expect(measurement.candidateTrials).toBe(0)
    expect(measurement.planGenerations).toBe(1)
    expect(measurement.warningKinds).toEqual(['constrained_enumeration_bound_reached'])
    expect(measurement.conflicts).toHaveLength(3)
  }, SLOW)
})

describe('Issue #101 approximate Production benchmark fixture', () => {
  let fixture: Issue101RealFixture
  let dependencies: PlannerDependencies

  beforeAll(async () => {
    fixture = await createIssue101RealFixture('approx_owned_dragon')
    dependencies = createProductionPlannerDependencies(new ProductionRngEngine())
  }, SLOW)

  it('keeps Fire on the Issue Route and gives Dragon a conversion-free Keep', () => {
    expect(summarizeIssue101Route(fixture.fireCandidate.route, fixture.fireCandidate)).toEqual(EXPECTED_ISSUE_ROUTE)
    const dragon = summarizeIssue101Route(fixture.dragonCandidate.route, fixture.dragonCandidate)
    expect(dragon.kind).toBe('existing_gogma_keep_bonuses')
    expect(dragon.conversionSkillCounter).toBeNull()
    expect(dragon.firstGogmaCounter).toBe(55)
    expect(fixture.initialConflicts.map(({ kind }) => kind)).toEqual(['same_gogma_counter'])
  })

  it('adopts the Gogma 235 alternative on the first trial and not below it', async () => {
    const run = async (maxGogmaAdvance: number) => {
      const observed = observeIssue101PlannerDependencies(dependencies, () => 0)
      const result = await createProductionPlanWithConstrainedSearch(
        createIssue101OrchestrationInput(fixture, 'primary'),
        observed.dependencies,
        { enumerationBounds: narrowGogmaBounds(maxGogmaAdvance), orchestrationBounds: defaultPlannerOrchestrationBounds },
      )
      return summarizeIssue101Orchestration(observed.events(), result, 0)
    }
    const below = await run(234)
    expect(below.generatedBuildListEntryCount).toBe(0)
    expect(below.warningKinds).toEqual(['constrained_enumeration_bound_reached'])

    const at = await run(235)
    expect(at.adoptedCandidateOrdinal).toBe(1)
    expect(at.candidateTrials).toBe(1)
    expect(at.planGenerations).toBe(2)
    expect(at.generatedRoutes).toEqual([EXPECTED_ALTERNATIVE_ROUTE])
    expect(at.conflicts).toEqual([])
    expect(at.warningKinds).toEqual([])
    expect(at.terminationStatus).toBe('completed')
    // Dragon's Keep at Gogma 55 runs first; Fire's Reset there fast-forwards.
    expect(at.planStepCount).toBe(1 + 237 - 1)
  }, SLOW)
})

describe('Issue #101 no-Ideal Production benchmark fixture', () => {
  it('examines nothing and stops on the bound, never reporting exhaustion', async () => {
    const execution = await visitConstrainedCandidates(
      createIssue101EnumerationInput('issue101_no_ideal', narrowGogmaBounds(50)),
      new ProductionRngEngine(),
      () => 'continue',
    )
    expect(execution.summary).toEqual({
      examinedCandidates: 0,
      evaluatedOffAxisPairs: 0,
      exhausted: false,
      stoppedByBound: true,
    })
  }, SLOW)
})
