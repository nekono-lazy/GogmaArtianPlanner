import { beforeAll, describe, expect, it, vi } from 'vitest'
import {
  createProductionPlannerDependencies,
  runPlannerAlternativeKernel,
  type PlannerAlternativeKernelResult,
  type PlannerDependencies,
} from '../domain/planner'
import { ProductionRngEngine } from '../domain/rng/production/productionRngEngine'
import {
  candidateStableKey,
  visitPlannerAlternativeCandidates,
  type PlannerAlternativeSearchInput,
} from '../domain/search'
import { summarizeIssue101Route } from './issue101RouteSummary'
import {
  createCountingRngEngine,
  createPlannerAlternativeSearchObserver,
  observePlannerAlternativeKernelDependencies,
  summarizePlannerAlternativeKernelResult,
} from './plannerAlternativeBenchmarkInstrumentation'
import {
  BENCHMARK_ONLY_ISSUE_101_SANITY_EXTENT,
  BENCHMARK_ONLY_ISSUE_101_SANITY_TRIAL_BOUNDS,
  createIssue101DragonFixedSearchInput,
  createIssue101KernelRequest,
  createIssue101NoIdealSearchInput,
  createIssue101RealFixture,
  createLongHeldFixture,
  longHeldReachingExtent,
  type Issue101RealFixture,
} from './plannerAlternativeBenchmarkFixtures'

/*
 * The Planner Alternative Search instrumentation seam and the benchmark
 * observers are semantics-neutral: with and without them the delivered
 * `candidateStableKey` sequence, the Search summary, the prediction calls and
 * the Kernel result are identical. Only counts are asserted, never durations.
 */

const SLOW = 180_000

async function runSearch(input: PlannerAlternativeSearchInput, stopAfter: number | null, instrumented: boolean) {
  const counting = createCountingRngEngine(new ProductionRngEngine())
  const observer = createPlannerAlternativeSearchObserver()
  const keys: string[] = []
  let settledAtFirst: number | null = null
  const execution = await visitPlannerAlternativeCandidates(
    structuredClone(input),
    counting.engine,
    (candidate) => {
      keys.push(candidateStableKey(candidate))
      if (keys.length === 1) settledAtFirst = observer.settledWorkItems()
      return stopAfter !== null && keys.length >= stopAfter ? 'stop' : 'continue'
    },
    instrumented ? { instrumentation: observer.instrumentation } : {},
  )
  return { keys, execution, counts: counting.counts(), observer, settledAtFirst }
}

describe('counting RNG Engine', () => {
  it('forwards every call once with the same input and returns the wrapped result', () => {
    const engine = new ProductionRngEngine()
    const spy = vi.spyOn(engine, 'predictSkills')
    const counting = createCountingRngEngine(engine)
    const input = createLongHeldFixture('long_skill_held', { heldLength: 1, heldMode: 'held' }, longHeldReachingExtent('long_skill_held', 1)).input
    const request = {
      baseSeed: input.origin.rngState.baseSeed.value as string,
      skillCounter: 341,
      weaponTypeId: input.origin.targetWeapons[0].weaponTypeId,
      elementId: input.origin.targetWeapons[0].elementId,
      master: input.origin.master,
    }
    expect(counting.engine.predictSkills(request)).toEqual(new ProductionRngEngine().predictSkills(request))
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith(request)
    expect(counting.engine.version).toBe(engine.version)
    expect(counting.engine.capabilities).toBe(engine.capabilities)
    expect(counting.counts()).toEqual({ predictNormalArtian: 0, predictSkills: 1, resetBonuses: 0, keepBonuses: 0 })
  })
})

describe('Planner Alternative Search instrumentation', () => {
  let fixture: Issue101RealFixture

  beforeAll(async () => {
    fixture = await createIssue101RealFixture()
  }, SLOW)

  const workloads = (): Array<[string, PlannerAlternativeSearchInput, number | null]> => [
    ['Issue #101 Dragon fixed', createIssue101DragonFixedSearchInput(fixture, BENCHMARK_ONLY_ISSUE_101_SANITY_EXTENT), 2],
    ['no-Ideal', createIssue101NoIdealSearchInput({ maxNormalAdvance: 2, maxGogmaAdvance: 20, maxSkillAdvance: 2 }), null],
    ['long Skill held', createLongHeldFixture('long_skill_held', { heldLength: 8, heldMode: 'held' }, { maxNormalAdvance: 1, maxGogmaAdvance: 1, maxSkillAdvance: 11 }).input, null],
    ['long Gogma held', createLongHeldFixture('long_gogma_held', { heldLength: 6, heldMode: 'held' }, { maxNormalAdvance: 1, maxGogmaAdvance: 8, maxSkillAdvance: 1 }).input, 12],
  ]

  it('changes no delivered key sequence, summary or prediction call count', async () => {
    for (const [label, input, stopAfter] of workloads()) {
      const plain = await runSearch(input, stopAfter, false)
      const observed = await runSearch(input, stopAfter, true)
      expect(observed.keys, label).toEqual(plain.keys)
      expect(observed.execution, label).toEqual(plain.execution)
      expect(observed.counts, label).toEqual(plain.counts)
      // Nothing is observed without the option.
      expect(plain.observer.settledWorkItems(), label).toBe(0)
      expect(observed.observer.settledWorkItems(), label).toBeGreaterThan(0)
    }
  }, SLOW)

  it('counts settled work up to the first delivery and for the whole run', async () => {
    const input = createIssue101DragonFixedSearchInput(fixture, BENCHMARK_ONLY_ISSUE_101_SANITY_EXTENT)
    const run = await runSearch(input, 3, true)
    expect(run.settledAtFirst).not.toBeNull()
    expect(run.settledAtFirst!).toBeGreaterThan(0)
    expect(run.observer.settledWorkItems()).toBeGreaterThanOrEqual(run.settledAtFirst!)
  }, SLOW)

  it('aggregates held-aware Skill states per depth: every held position is a state, a blocked run leaves one', async () => {
    const held = await runSearch(createLongHeldFixture('long_skill_held', { heldLength: 8, heldMode: 'held' }, longHeldReachingExtent('long_skill_held', 8)).input, 1, true)
    const skill = held.observer.skill()
    expect(skill.streams).toBe(1)
    expect(skill.depths[0]).toEqual({ depth: 1, streams: 1, transitions: 9, states: 9, absolutePositions: 9, maxStatesPerStream: 9 })
    expect(held.observer.gogma().streams).toBe(0)
    const blocked = await runSearch(createLongHeldFixture('long_skill_held', { heldLength: 8, heldMode: 'held_blocked' }, longHeldReachingExtent('long_skill_held', 8)).input, 1, true)
    expect(blocked.observer.skill().depths[0]).toMatchObject({ depth: 1, states: 1, absolutePositions: 1 })
  })

  it('aggregates held-aware Gogma states, positions and family layouts per depth', async () => {
    const run = await runSearch(createLongHeldFixture('long_gogma_held', { heldLength: 8, heldMode: 'held' }, longHeldReachingExtent('long_gogma_held', 8)).input, 1, true)
    const gogma = run.observer.gogma()
    expect(gogma.streams).toBe(1)
    const [depth1] = gogma.depths
    // One Reset and one Keep (from the base) at each of the 9 legal positions.
    expect(depth1).toMatchObject({ depth: 1, streams: 1, generatedStates: 18, absolutePositions: 9 })
    expect(depth1.familyLayouts).toBeGreaterThan(0)
    expect(depth1.familyLayouts).toBeLessThanOrEqual(depth1.generatedStates)
    expect(depth1.frontierStates).toBeLessThanOrEqual(depth1.generatedStates)
    expect(run.counts).toMatchObject({ resetBonuses: 9, keepBonuses: 9 })
  })

  it('leaves the Kernel result unchanged behind the counting Engine and the clock observer', async () => {
    const request = createIssue101KernelRequest(fixture, BENCHMARK_ONLY_ISSUE_101_SANITY_EXTENT, BENCHMARK_ONLY_ISSUE_101_SANITY_TRIAL_BOUNDS)
    const project = (result: PlannerAlternativeKernelResult) => {
      if (result.status !== 'completed') return result
      return {
        conflictKey: result.conflictKey,
        plannerRerunsUsed: result.plannerRerunsUsed,
        targets: result.targets.map((target) => ({
          targetWeaponId: target.targetWeaponId,
          outcome: target.outcome.status,
          reservation: target.reservation,
          search: target.search,
          trials: target.trials,
          route: target.outcome.status === 'found' ? summarizeIssue101Route(target.outcome.candidate.route, target.outcome.candidate) : null,
          steps: target.outcome.status === 'found' ? target.outcome.trialResult.plan?.steps.length : null,
        })),
      }
    }
    const plain = await runPlannerAlternativeKernel(structuredClone(request), createProductionPlannerDependencies(new ProductionRngEngine()))
    const counting = createCountingRngEngine(new ProductionRngEngine())
    let clock = 0
    const notices: number[] = []
    const base: PlannerDependencies = createProductionPlannerDependencies(counting.engine)
    const observed = observePlannerAlternativeKernelDependencies(base, () => ++clock, () => notices.push(clock))
    const instrumented = await runPlannerAlternativeKernel(structuredClone(request), observed.dependencies)
    expect(project(instrumented)).toEqual(project(plain))
    expect(notices).toHaveLength(1)
    expect(observed.firstClockReadMs()).toBe(1)
    expect(observed.materializations()).toBe(1)
    expect(counting.counts().predictSkills).toBeGreaterThan(0)

    const summary = summarizePlannerAlternativeKernelResult(instrumented)
    if (summary.status !== 'completed') throw new Error(JSON.stringify(summary))
    expect(summary.plannerRerunsUsed).toBe(1)
    expect(summary.candidateTrials).toBe(1)
    expect(summary.targets).toHaveLength(1)
    expect(summary.targets[0]).toMatchObject({ outcome: 'found', trials: 1, trialResults: ['found:true'] })
    expect(summary.targets[0].found).toMatchObject({
      generatedSelected: true,
      trialTerminationStatus: 'completed',
      trialConflictCount: 0,
      planStepCount: 444,
      route: { operationCount: 236, conversionSkillCounter: 342, firstGogmaCounter: 56, estimatedGogmaAdvance: 235 },
    })
    // A plain structured-clone-safe summary: no Plan, no Candidate.
    expect(JSON.stringify(summary)).not.toContain('"steps"')
  }, SLOW)

  it('summarizes a typed Kernel failure without guessing', () => {
    expect(summarizePlannerAlternativeKernelResult({
      status: 'invalid_prior_fixed_entry',
      buildListEntryId: 'entry.x' as never,
      detail: 'missing',
    })).toEqual({ status: 'failed', kernelStatus: 'invalid_prior_fixed_entry', detail: 'missing' })
  })
})
