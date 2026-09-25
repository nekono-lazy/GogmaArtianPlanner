import { describe, expect, it } from 'vitest'
import { plannerSchedulerCatalogue } from '../../test/fixtures/plannerSchedulerScenarios'
import { createDeterministicPlannerDependencies, createPlannerSchedulerWorkloadInput } from '../../test/fixtures/plannerSchedulerWorkloads'
import {
  runPlannerDeterministicSchedule,
  type PlannerScheduleExecutionOptions,
} from './plannerDeterministicScheduler'
import type {
  PlannerSchedulerInstrumentation,
  PlannerSchedulerRunMetrics,
} from './plannerSchedulerInstrumentation'
import type {
  PlannerRunResult,
  PlannerInput,
  PlannerRunBuildListContext,
} from './plannerTypes'
import type { RngEngine } from '../rng/rngEngine'

/**
 * The deterministic scheduler's parity observer
 * (`plannerSchedulerInstrumentation.ts`, Issue #103). It must be
 * semantics-neutral, and its drops and provisional outcomes must describe what
 * the schedule actually decided, because the Beam / scheduler parity harness
 * explains completion differences with them.
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
  const { input, engine } = createPlannerSchedulerWorkloadInput(workloadId)
  return { id: workloadId, input, engine }
}

async function schedule(
  target: Case,
  options: PlannerScheduleExecutionOptions = {},
): Promise<PlannerRunResult> {
  return runPlannerDeterministicSchedule(
    structuredClone(target.input),
    createDeterministicPlannerDependencies(target.engine),
    options,
    target.buildListContext,
  )
}

function observer(metrics: PlannerSchedulerRunMetrics[]): PlannerSchedulerInstrumentation {
  return { onScheduleEnd: (value) => metrics.push(value) }
}

async function measured(target: Case) {
  const metrics: PlannerSchedulerRunMetrics[] = []
  const result = await schedule(target, { schedulerInstrumentation: observer(metrics) })
  expect(metrics).toHaveLength(1)
  return { result, metrics: metrics[0] }
}

function byId(id: string): Case {
  const found = catalogueCases().find((item) => item.id === id)
  if (!found) throw new Error(`Unknown catalogue scenario '${id}'.`)
  return found
}

describe('scheduler observer is semantics-neutral', { timeout: 60_000 }, () => {
  it.each(catalogueCases().map((item) => [item.id, item] as const))(
    '%s: the result is identical with and without the observer',
    async (_id, target) => {
      const plain = await schedule(target)
      const { result } = await measured(target)
      expect(result).toEqual(plain)
    },
  )

  it.each(['sanity-3', 'representative-12'])(
    '%s: the result is identical with and without the observer',
    async (workloadId) => {
      const target = workloadCase(workloadId)
      const plain = await schedule(target)
      const { result, metrics } = await measured(target)
      expect(result).toEqual(plain)
      expect(metrics.reachedScheduler).toBe(true)
    },
  )

  it('keeps a cancellation identical with and without the observer', async () => {
    const target = workloadCase('representative-12')
    const cancelAfter = (calls: number) => {
      let count = 0
      return () => ++count > calls
    }
    const plain = await schedule(target, { shouldCancel: cancelAfter(40) })
    const metrics: PlannerSchedulerRunMetrics[] = []
    const instrumented = await schedule(target, {
      shouldCancel: cancelAfter(40),
      schedulerInstrumentation: observer(metrics),
    })
    expect(plain.termination.status).toBe('cancelled')
    expect(instrumented).toEqual(plain)
    expect(metrics[0].terminationStatus).toBe('cancelled')
  })

  it('reports an identical record for two runs of the same input', async () => {
    for (const target of [workloadCase('representative-12'), byId('deadlock'), byId('L-explicit-resolution')]) {
      const first = await measured(target)
      const second = await measured(target)
      expect(second.metrics).toEqual(first.metrics)
      expect(second.result).toEqual(first.result)
    }
  })
})

describe('scheduler observer record', { timeout: 60_000 }, () => {
  it.each(catalogueCases().map((item) => [item.id, item] as const))(
    '%s: the record agrees with the result',
    async (_id, target) => {
      const { result, metrics } = await measured(target)
      expect(metrics.expandedStates).toBe(result.expandedStates)
      expect(metrics.traceLength).toBe(result.bestState?.trace.length ?? 0)
      expect(metrics.terminationStatus).toBe(result.termination.status)
      expect(metrics.completedTargetCount).toBe(result.termination.completedTargetCount)
      expect(metrics.totalTargetCount).toBe(result.termination.totalTargetCount)
      if (!metrics.reachedScheduler) {
        expect(metrics.drops).toEqual([])
        expect(metrics.provisionalOutcomes).toEqual([])
        return
      }
      // Every provisional loser is exactly one `provisional_outcome` drop.
      expect(
        metrics.provisionalOutcomes.flatMap(({ loserBuildListEntryIds }) => loserBuildListEntryIds).sort(),
      ).toEqual(
        metrics.drops
          .filter(({ cause }) => cause === 'provisional_outcome')
          .map(({ buildListEntryId }) => buildListEntryId)
          .sort(),
      )
      // Every dropped Entry has the rejection its drop record says.
      metrics.drops.forEach(({ buildListEntryId, reason }) =>
        expect(
          result.rejections.some(
            (rejection) => rejection.buildListEntryId === buildListEntryId && rejection.reason === reason,
          ),
        ).toBe(true),
      )
      // A secured Entry was never dropped.
      const dropped = new Set(metrics.drops.map(({ buildListEntryId }) => buildListEntryId))
      result.bestState!.selectedBuildListEntryIds.forEach((entryId) =>
        expect(dropped.has(entryId)).toBe(false),
      )
    },
  )

  it('records the provisional outcome of an unresolved conflict', async () => {
    const { metrics } = await measured(byId('D-unresolved-conflict'))
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
    expect(metrics.drops).toEqual([
      expect.objectContaining({ buildListEntryId: 'entry.y', cause: 'deadlock', reason: 'conflict_not_committed' }),
    ])
    expect(metrics.drops[0].iteration).toBeGreaterThan(0)
  })

  it('records no drop where a pin-blocked skippable position is consumed (former 7.8 example)', async () => {
    const { result, metrics } = await measured(byId('deadlock'))
    expect(metrics.drops).toEqual([])
    expect(result.termination.status).toBe('completed')
  })

  it('records no drop for a release through cross satisfaction', async () => {
    const { result, metrics } = await measured(byId('cross-satisfaction'))
    expect(metrics.drops).toEqual([])
    expect(
      result.rejections.some(({ reason }) => reason === 'candidate_already_satisfied'),
    ).toBe(true)
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
      expect(metrics.drops).toEqual([])
    }
  })

  it('carries plain structured-clone data only, and no Phase B performance field', async () => {
    const { metrics } = await measured(workloadCase('representative-12'))
    expect(structuredClone(metrics)).toEqual(metrics)
    expect(JSON.parse(JSON.stringify(metrics))).toEqual(metrics)
    expect(Object.keys(metrics).sort()).toEqual([
      'completedTargetCount',
      'drops',
      'expandedStates',
      'provisionalOutcomes',
      'reachedScheduler',
      'terminationStatus',
      'totalTargetCount',
      'traceLength',
    ])
  })
})
