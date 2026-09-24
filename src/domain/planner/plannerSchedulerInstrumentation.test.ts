import { describe, expect, it } from 'vitest'
import { plannerSchedulerCatalogue } from '../../test/fixtures/plannerSchedulerScenarios'
import { createPlannerSearchInstrumentationInput } from '../../benchmarks/plannerSearchInstrumentationFixtures'
import { createDeterministicPlannerDependencies } from '../../benchmarks/plannerSearchInstrumentationBenchmark'
import { runPlannerDeterministicSchedule } from './plannerDeterministicScheduler'
import type {
  PlannerSchedulerInstrumentation,
  PlannerSchedulerRunMetrics,
} from './plannerSchedulerInstrumentation'
import type {
  PlannerBeamSearchResult,
  PlannerExecutionOptions,
  PlannerInput,
  PlannerRunBuildListContext,
} from './plannerTypes'
import type { RngEngine } from '../rng/rngEngine'

/**
 * Issue #103 Phase B: the deterministic scheduler instrumentation
 * (`plannerSchedulerInstrumentation.ts`). It must be semantics-neutral and its
 * counts must describe what the schedule actually did.
 */

interface Case {
  id: string
  input: PlannerInput
  engine: RngEngine
  buildListContext?: PlannerRunBuildListContext
}

function catalogueCases(): Case[] {
  return plannerSchedulerCatalogue().map(({ id, scenario, buildListContext }) => ({
    id,
    input: scenario.input,
    engine: scenario.engine,
    buildListContext,
  }))
}

function workloadCase(workloadId: string): Case {
  const { input, engine } = createPlannerSearchInstrumentationInput(workloadId)
  return { id: workloadId, input, engine }
}

async function schedule(
  target: Case,
  options: PlannerExecutionOptions = {},
): Promise<PlannerBeamSearchResult> {
  return runPlannerDeterministicSchedule(
    structuredClone(target.input),
    createDeterministicPlannerDependencies(target.engine),
    options,
    target.buildListContext,
  )
}

function observer(
  metrics: PlannerSchedulerRunMetrics[],
  clock = false,
): PlannerSchedulerInstrumentation {
  let tick = 0
  return {
    now: clock ? () => (tick += 1) : undefined,
    onScheduleEnd: (value) => metrics.push(value),
  }
}

async function measured(target: Case, clock = false) {
  const metrics: PlannerSchedulerRunMetrics[] = []
  const result = await schedule(target, { schedulerInstrumentation: observer(metrics, clock) })
  expect(metrics).toHaveLength(1)
  return { result, metrics: metrics[0] }
}

function byId(id: string): Case {
  const found = catalogueCases().find((item) => item.id === id)
  if (!found) throw new Error(`Unknown catalogue scenario '${id}'.`)
  return found
}

describe('scheduler instrumentation is semantics-neutral', { timeout: 60_000 }, () => {
  it.each(catalogueCases().map((item) => [item.id, item] as const))(
    '%s: the result is identical with and without instrumentation',
    async (_id, target) => {
      const plain = await schedule(target)
      const { result } = await measured(target, true)
      expect(result).toEqual(plain)
    },
  )

  it.each(['sanity-3', 'representative-12'])(
    '%s: the result is identical with and without instrumentation',
    async (workloadId) => {
      const target = workloadCase(workloadId)
      const plain = await schedule(target)
      const { result, metrics } = await measured(target, true)
      expect(result).toEqual(plain)
      expect(metrics.reachedScheduler).toBe(true)
    },
  )

  it('keeps a cancellation identical with and without instrumentation', async () => {
    const target = workloadCase('representative-12')
    const cancelAfter = (calls: number) => {
      let count = 0
      return () => ++count > calls
    }
    const plain = await schedule(target, { shouldCancel: cancelAfter(40) })
    const metrics: PlannerSchedulerRunMetrics[] = []
    const instrumented = await schedule(target, {
      shouldCancel: cancelAfter(40),
      schedulerInstrumentation: observer(metrics, true),
    })
    expect(plain.termination.status).toBe('cancelled')
    expect(instrumented).toEqual(plain)
    expect(metrics[0].terminationStatus).toBe('cancelled')
  })

  it('reports identical counts for two runs of the same input', async () => {
    for (const target of [workloadCase('representative-12'), byId('deadlock'), byId('L-explicit-resolution')]) {
      const first = await measured(target)
      const second = await measured(target)
      // No clock: every field, `phaseMs: null` included, is deterministic.
      expect(second.metrics).toEqual(first.metrics)
      expect(second.result).toEqual(first.result)
    }
  })
})

describe('scheduler instrumentation counts', { timeout: 60_000 }, () => {
  it.each(catalogueCases().map((item) => [item.id, item] as const))(
    '%s: the counts agree with the result',
    async (_id, target) => {
      const { result, metrics } = await measured(target, true)
      const { counts } = metrics
      expect(metrics.expandedStates).toBe(result.expandedStates)
      expect(metrics.traceLength).toBe(result.bestState?.trace.length ?? 0)
      expect(metrics.terminationStatus).toBe(result.termination.status)
      expect(metrics.completedTargetCount).toBe(result.termination.completedTargetCount)
      expect(metrics.totalTargetCount).toBe(result.termination.totalTargetCount)
      if (!metrics.reachedScheduler) {
        expect(counts.schedulerIterationCount).toBe(0)
        expect(metrics.drops).toEqual([])
        return
      }
      // One constructed state per applied route action or reserve (14.2).
      expect(counts.appliedRouteActionCount + counts.appliedReserveActionCount).toBe(result.expandedStates)
      expect(counts.appliedRouteActionCount).toBe(
        result.bestState!.trace.filter(({ kind }) => kind === 'route_operation').length,
      )
      expect(
        counts.finalCommitted + counts.finalSecured + counts.finalReleased + counts.finalDropped + counts.finalNotNeeded,
      ).toBe(metrics.searchEntryCount)
      expect(counts.finalSecured).toBe(result.bestState!.selectedBuildListEntryIds.length)
      expect(counts.initialCommitted + counts.initialDropped + counts.initialSecured + counts.initialNotNeeded)
        .toBe(metrics.searchEntryCount)
      expect(counts.provisionalLoserCount).toBe(
        metrics.drops.filter(({ cause }) => cause === 'provisional_outcome').length,
      )
      expect(counts.deadlockDropCount).toBe(metrics.drops.filter(({ cause }) => cause === 'deadlock').length)
      expect(counts.stallDropCount).toBe(metrics.drops.filter(({ cause }) => cause === 'stall').length)
      expect(counts.safeActionCandidateCountMax).toBeLessThanOrEqual(counts.safeActionCandidateCountTotal)
      expect(counts.fastForwardedUnitCount).toBe(
        counts.fastForwardedBonusUnitCount + counts.fastForwardedSkillUnitCount,
      )
      expect(counts.recommitCount).toBeLessThanOrEqual(counts.dynamicCommitCount)
      // Every dropped Entry has exactly the drop records its rejections say.
      const dropped = new Set(metrics.drops.map(({ buildListEntryId }) => buildListEntryId))
      dropped.forEach((entryId) =>
        expect(result.rejections.some(({ buildListEntryId }) => buildListEntryId === entryId)).toBe(true),
      )
      expect(metrics.phaseMs).not.toBeNull()
      Object.values(metrics.phaseMs!).forEach((value) => expect(value).toBeGreaterThanOrEqual(0))
    },
  )

  it('records the provisional outcome of an unresolved conflict', async () => {
    const { metrics } = await measured(byId('D-unresolved-conflict'))
    expect(metrics.counts).toMatchObject({
      commitmentRuns: 1,
      initialCandidates: 2,
      initialCommitted: 1,
      initialDropped: 1,
      provisionalWinnerCount: 1,
      provisionalLoserCount: 1,
      collisionDetectionCount: 2,
    })
    expect(metrics.counts.detectedCollisionCount).toBeGreaterThan(0)
    expect(metrics.provisionalOutcomes).toEqual([
      { winnerBuildListEntryId: 'entry.b', winnerTargetWeaponId: 'target.b', loserBuildListEntryIds: ['entry.a'] },
    ])
    expect(metrics.drops).toEqual([
      expect.objectContaining({
        buildListEntryId: 'entry.a',
        targetWeaponId: 'target.a',
        cause: 'provisional_outcome',
        reason: 'conflict_not_committed',
        iteration: 0,
        winnerBuildListEntryId: 'entry.b',
        conflictKind: 'same_gogma_counter',
      }),
    ])
  })

  it('records an explicit resolution and a provisional outcome separately', async () => {
    const { metrics } = await measured(byId('L-explicit-resolution'))
    const causes = metrics.drops.map(({ buildListEntryId, cause }) => [buildListEntryId, cause])
    expect(causes).toEqual(expect.arrayContaining([
      ['entry.b', 'initial_resolution'],
      ['entry.d', 'provisional_outcome'],
    ]))
  })

  it('records a deadlock drop', async () => {
    const { metrics } = await measured(byId('true-deadlock'))
    expect(metrics.counts.deadlockDropCount).toBe(1)
    expect(metrics.counts.stallDropCount).toBe(0)
    expect(metrics.counts.waitingIterationCount).toBeGreaterThan(0)
    expect(metrics.drops).toEqual([
      expect.objectContaining({ buildListEntryId: 'entry.y', cause: 'deadlock', reason: 'conflict_not_committed' }),
    ])
  })

  it('records no drop where a pin-blocked skippable position is consumed (former 7.8 example)', async () => {
    const { result, metrics } = await measured(byId('deadlock'))
    expect(metrics.counts.deadlockDropCount).toBe(0)
    expect(metrics.counts.stallDropCount).toBe(0)
    expect(metrics.drops).toEqual([])
    // Y's Reset Skills at S0 was passed silently once its pin was released.
    expect(metrics.counts.fastForwardedSkillUnitCount).toBe(1)
    expect(result.termination.status).toBe('completed')
  })

  it('records a release through cross satisfaction', async () => {
    const { metrics } = await measured(byId('cross-satisfaction'))
    expect(metrics.counts.releaseCount).toBe(1)
    expect(metrics.counts.finalReleased).toBe(1)
    expect(metrics.drops).toEqual([])
  })

  it('records a dynamic commitment', async () => {
    const { metrics } = await measured(byId('dynamic-commitment'))
    expect(metrics.counts.initialNotNeeded).toBe(1)
    expect(metrics.counts.dynamicCommitCount).toBe(1)
    expect(metrics.counts.recommitCount).toBe(0)
    expect(metrics.counts.commitmentRuns).toBeGreaterThan(1)
    expect(metrics.counts.finalSecured).toBe(2)
  })

  it('records one shared physical action', async () => {
    const { metrics } = await measured(byId('E-shared-physical-action'))
    expect(metrics.counts.physicalSharedActionCount).toBe(1)
    expect(metrics.counts.sharedProgressedEntryCount).toBe(1)
  })

  it('records fast-forwarded units and executor choices', async () => {
    const { result, metrics } = await measured(byId('C-required-and-skippable'))
    // B's first 51 units were passed while A consumed the stream.
    expect(metrics.counts.fastForwardedBonusUnitCount).toBe(51)
    expect(metrics.counts.fastForwardedSkillUnitCount).toBe(0)
    expect(metrics.counts.appliedRouteActionCount).toBe(52)
    expect(result.termination.status).toBe('completed')
    expect(metrics.counts.safeActionCandidateCountMax).toBeGreaterThanOrEqual(2)
  })

  it('records a blind forge waiting for a predicted forge', async () => {
    const { metrics } = await measured(byId('K-blind-waits'))
    expect(metrics.counts.waitingIterationCount).toBeGreaterThan(0)
    expect(metrics.counts.waitingStreamCountTotal).toBeGreaterThanOrEqual(metrics.counts.waitingIterationCount)
  })

  it('records initial precondition drops', async () => {
    const zero = await measured(byId('zero-operation'))
    expect(zero.metrics.drops).toEqual([
      expect.objectContaining({ buildListEntryId: 'entry.y', cause: 'initial_precondition', reason: 'protected_destructive_use' }),
    ])
    const lost = await measured(byId('pinned-past-lost-holding'))
    expect(lost.metrics.drops).toEqual([
      expect.objectContaining({ buildListEntryId: 'entry.p', cause: 'initial_precondition', reason: 'counter_before_current' }),
    ])
    // A passed pin-blocked skippable unit alone drops nobody: P wins the
    // conflict by R instead.
    const pinned = await measured(byId('pinned-past'))
    expect(pinned.metrics.drops).toEqual([
      expect.objectContaining({ buildListEntryId: 'entry.q', cause: 'provisional_outcome', winnerBuildListEntryId: 'entry.p' }),
    ])
  })

  it('reports an input finished before scheduling as not reached', async () => {
    for (const id of ['malformed-legacy-duplicate', 'empty-build-list']) {
      const { metrics } = await measured(byId(id))
      expect(metrics.reachedScheduler).toBe(false)
      expect(metrics.terminationStatus).toBe('exhausted')
      expect(metrics.counts.commitmentRuns).toBe(0)
    }
  })

  it('carries plain structured-clone data only', async () => {
    const { metrics } = await measured(workloadCase('representative-12'), true)
    expect(structuredClone(metrics)).toEqual(metrics)
    expect(JSON.parse(JSON.stringify(metrics))).toEqual(metrics)
    expect(metrics).not.toHaveProperty('depths')
  })
})
