import { describe, expect, it } from 'vitest'
import { createPlannerSearchInstrumentationInput } from './plannerSearchInstrumentationFixtures'
import { createDeterministicPlannerDependencies } from './plannerSearchInstrumentationBenchmark'
import { runPlannerBeamSearch } from '../domain/planner/plannerBeamSearch'
import type {
  PlannerSearchDepthMetrics,
  PlannerSearchInstrumentation,
  PlannerSearchRunMetrics,
} from '../domain/planner/plannerSearchInstrumentation'
import type {
  PlannerBeamSearchResult,
  PlannerExecutionOptions,
  PlannerInput,
} from '../domain/planner/plannerTypes'

interface Observed {
  depths: PlannerSearchDepthMetrics[]
  runs: PlannerSearchRunMetrics[]
}

function observer(
  observed: Observed,
  options: { projections?: boolean; clock?: boolean } = {},
): PlannerSearchInstrumentation {
  let tick = 0
  return {
    collectDiagnosticProjections: options.projections ?? false,
    now: options.clock ? () => (tick += 1) : undefined,
    onDepth: (metrics) => observed.depths.push(metrics),
    onSearchEnd: (metrics) => observed.runs.push(metrics),
  }
}

async function search(
  input: PlannerInput,
  engine: ReturnType<typeof createPlannerSearchInstrumentationInput>['engine'],
  options: PlannerExecutionOptions = {},
): Promise<PlannerBeamSearchResult> {
  return runPlannerBeamSearch(
    structuredClone(input),
    createDeterministicPlannerDependencies(engine),
    options,
  )
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

const sanity = createPlannerSearchInstrumentationInput('sanity-3')
const representative = createPlannerSearchInstrumentationInput('representative-12')
/** Truncated so a test run stays short while crossing several depths. */
const truncatedInput: PlannerInput = {
  ...representative.input,
  options: { maxPlanSteps: 1_000, maxExpandedStates: 300, beamWidth: 6 },
}

// Each case runs one or two real Production Beam Searches over the fixtures.
describe('Planner search instrumentation (Issue #103)', { timeout: 20_000 }, () => {
  it('leaves a completing search exactly unchanged', async () => {
    const plain = await search(sanity.input, sanity.engine)
    const observed: Observed = { depths: [], runs: [] }
    const instrumented = await search(sanity.input, sanity.engine, {
      searchInstrumentation: observer(observed, { projections: true, clock: true }),
    })

    expect(plain.termination.status).toBe('completed')
    expect(instrumented).toEqual(plain)
    expect(observed.depths.length).toBeGreaterThan(0)
    expect(observed.runs).toHaveLength(1)
  })

  it('leaves a bound-truncated search exactly unchanged', async () => {
    const plain = await search(truncatedInput, representative.engine)
    const observed: Observed = { depths: [], runs: [] }
    const instrumented = await search(truncatedInput, representative.engine, {
      searchInstrumentation: observer(observed, { projections: true, clock: true }),
    })

    expect(plain.termination.status).toBe('incomplete')
    expect(plain.termination.reachedLimits).toEqual(['max_expanded_states'])
    // bestState, completed, termination, expandedStates, conflicts, rejections
    // and warnings all at once.
    expect(instrumented).toEqual(plain)
    expect(observed.depths.at(-1)?.stoppedBy).toBe('max_expanded_states')
  })

  it('keeps the step-limit behaviour unchanged', async () => {
    const input: PlannerInput = {
      ...representative.input,
      options: { maxPlanSteps: 3, maxExpandedStates: 20_000, beamWidth: 5 },
    }
    const plain = await search(input, representative.engine)
    const observed: Observed = { depths: [], runs: [] }
    const instrumented = await search(input, representative.engine, {
      searchInstrumentation: observer(observed),
    })

    expect(plain.termination.reachedLimits).toContain('max_plan_steps')
    expect(instrumented).toEqual(plain)
    expect(sum(observed.depths.map((depth) => depth.stepLimitBeamStates))).toBeGreaterThan(0)
  })

  it('keeps cancellation semantics and responsiveness unchanged', async () => {
    const cancelAfter = (calls: number) => {
      let count = 0
      return () => {
        count += 1
        return count > calls
      }
    }
    const plain = await search(truncatedInput, representative.engine, {
      shouldCancel: cancelAfter(150),
    })
    const observed: Observed = { depths: [], runs: [] }
    const instrumented = await search(truncatedInput, representative.engine, {
      shouldCancel: cancelAfter(150),
      searchInstrumentation: observer(observed, { projections: true, clock: true }),
    })

    expect(plain.cancelled).toBe(true)
    expect(plain.termination.status).toBe('cancelled')
    expect(instrumented).toEqual(plain)
    expect(observed.runs[0].terminationStatus).toBe('cancelled')
    expect(observed.depths.at(-1)?.stoppedBy).toBe('cancelled')
    expect(observed.depths.at(-1)?.unvisitedBeamStates).toBeGreaterThanOrEqual(0)
  })

  it('reports internally consistent depth metrics', async () => {
    const observed: Observed = { depths: [], runs: [] }
    const result = await search(truncatedInput, representative.engine, {
      searchInstrumentation: observer(observed, { projections: true, clock: true }),
    })
    const planningTargets = result.termination.totalTargetCount

    observed.depths.forEach((depth, index) => {
      expect(depth.depth).toBe(index)
      expect(depth.semanticDuplicatesRemoved).toBe(
        depth.successorsBeforeSemanticDedup - depth.successorsAfterSemanticDedup,
      )
      expect(depth.successorsBeforeSemanticDedup).toBe(depth.generatedSuccessors)
      expect(depth.statesBeforeBeamTrim).toBe(depth.successorsAfterSemanticDedup)
      expect(depth.beamTrimmedStates).toBe(
        depth.statesBeforeBeamTrim - depth.statesAfterBeamTrim,
      )
      expect(depth.statesAfterBeamTrim).toBeLessThanOrEqual(truncatedInput.options.beamWidth)
      const lanes = depth.generatedSuccessorsByLane
      expect(lanes.base + lanes.bonus + lanes.skill + lanes.reserve).toBe(
        depth.generatedSuccessors,
      )
      expect(depth.expandedBeamStates + depth.completeBeamStates + depth.stepLimitBeamStates +
        depth.unvisitedBeamStates).toBe(depth.beamInputStates)
      expect(depth.generatedSuccessors + depth.rejectedAttempts).toBeLessThanOrEqual(
        depth.attemptedActions,
      )
      if (depth.stoppedBy === null) {
        expect(depth.generatedSuccessors + depth.rejectedAttempts).toBe(depth.attemptedActions)
      }
      expect(depth.bestCompletedTargetCount).toBeLessThanOrEqual(planningTargets)
      expect(depth.worstCompletedTargetCount).toBeLessThanOrEqual(depth.bestCompletedTargetCount)
      expect(sum(depth.completedTargetCountDistribution)).toBe(depth.statesAfterBeamTrim)
      expect(depth.maxCompletedTargetCountBeforeTrim).toBeGreaterThanOrEqual(
        depth.bestCompletedTargetCount,
      )
      expect(depth.sharedProgressedEntries).toBeGreaterThanOrEqual(
        depth.sharedPhysicalActionSuccessors,
      )
      expect(depth.diagnosticProjections).not.toBeNull()
      const projections = depth.diagnosticProjections!
      expect(projections.successorsAfterTraceFreeKey).toBeLessThanOrEqual(
        depth.successorsAfterSemanticDedup,
      )
      expect(projections.successorsAfterProgressKey).toBeLessThanOrEqual(
        projections.successorsAfterTraceFreeKey,
      )
      expect(projections.keptBeamDistinctProgressKeys).toBeLessThanOrEqual(
        depth.statesAfterBeamTrim,
      )
      expect(depth.phaseMs).not.toBeNull()
    })
    expect(observed.depths.at(-1)?.cumulativeExpandedStates).toBe(result.expandedStates)
    expect(sum(observed.depths.map((depth) => depth.generatedSuccessors))).toBe(
      result.expandedStates,
    )
  })

  it('reports run totals that match the depths, the Entries and the result', async () => {
    const observed: Observed = { depths: [], runs: [] }
    const result = await search(truncatedInput, representative.engine, {
      searchInstrumentation: observer(observed),
    })
    const [run] = observed.runs

    expect(run.reachedBeamSearch).toBe(true)
    expect(run.depthCount).toBe(observed.depths.length)
    expect(run.expandedStates).toBe(result.expandedStates)
    expect(run.terminationStatus).toBe(result.termination.status)
    expect(run.completedTargetCount).toBe(result.termination.completedTargetCount)
    expect(run.planningTargetCount).toBe(result.termination.totalTargetCount)
    expect(run.searchEntryCount).toBe(truncatedInput.buildListEntries.length)
    expect(run.totals.generatedSuccessors).toBe(result.expandedStates)
    expect(run.totals.successorsBeforeSemanticDedup).toBe(
      sum(observed.depths.map((depth) => depth.successorsBeforeSemanticDedup)),
    )
    expect(run.totals.statesAfterBeamTrim).toBe(
      sum(observed.depths.map((depth) => depth.statesAfterBeamTrim)),
    )
    expect(run.totals.rejectedAttempts).toBe(
      sum(Object.values(run.rejectionOccurrencesByReason).map((value) => value ?? 0)),
    )
    expect(
      sum(run.entries.map(({ generatedSuccessors: lanes }) =>
        lanes.base + lanes.bonus + lanes.skill + lanes.reserve)),
    ).toBe(run.totals.generatedSuccessors)
    expect(
      sum(run.entries.map(({ fastForwardedUnits }) =>
        fastForwardedUnits.bonus + fastForwardedUnits.skill)),
    ).toBe(run.totals.fastForwardedUnits.bonus + run.totals.fastForwardedUnits.skill)
    expect(sum(Object.values(run.uniqueConflictsByKind))).toBe(result.conflicts.length)
    expect(sum(Object.values(run.expandedStateConflictsByKind))).toBe(
      sum(observed.depths.map((depth) => depth.expandedStateConflicts)),
    )
    expect(run.maxCompletedTargetCountEverObserved).toBeLessThanOrEqual(
      run.planningTargetCount,
    )
    expect(run.firstDepthByCompletedTargetCount).toHaveLength(run.planningTargetCount + 1)
    expect(run.totals.reserveSuccesses).toBeLessThanOrEqual(run.totals.reserveAttempts)
  })

  it('counts fast-forwarded units instead of executed ones', async () => {
    const observed: Observed = { depths: [], runs: [] }
    await search(sanity.input, sanity.engine, {
      searchInstrumentation: observer(observed),
    })
    const [first] = observed.depths
    // Depth 0 runs one unit per successor, and every other Entry's skippable
    // Reset at that Counter position is passed silently: the executed unit
    // itself is never counted as fast-forwarded.
    expect(first.generatedSuccessors).toBeGreaterThan(0)
    expect(first.fastForwardedUnits.bonus + first.fastForwardedUnits.skill).toBeGreaterThan(0)
    expect(observed.runs[0].totals.sharedPhysicalActionSuccessors).toBe(0)
  })

  it('reports a run that never reaches a Beam Search depth', async () => {
    const observed: Observed = { depths: [], runs: [] }
    const result = await search(
      { ...sanity.input, buildListEntries: [] },
      sanity.engine,
      { searchInstrumentation: observer(observed) },
    )

    expect(observed.depths).toEqual([])
    expect(observed.runs).toHaveLength(1)
    expect(observed.runs[0].reachedBeamSearch).toBe(false)
    expect(observed.runs[0].terminationStatus).toBe(result.termination.status)
    expect(observed.runs[0].expandedStates).toBe(0)
  })
})
