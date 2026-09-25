import { describe, expect, it } from 'vitest'
import { mandatoryParityProblems } from '../test/fixtures/plannerSchedulerParity'
import { createDeterministicPlannerDependencies } from './plannerSearchInstrumentationBenchmark'
import { createPlannerSearchInstrumentationInput } from './plannerSearchInstrumentationFixtures'
import { runPlannerSchedulerParity } from './plannerSchedulerParity'

/**
 * Issue #103 Phase B parity on `representative-12` with its PR #107 bounds
 * (`1000 / 20000 / 50`). The Beam Search part takes tens of seconds in Node,
 * so it has a file of its own. `representative-35` is measured in a real
 * Browser Worker only (`docs/ISSUE_103_SCHEDULER_PARITY_BENCHMARK.md`).
 */
describe('representative-12 Beam / scheduler parity', { timeout: 300_000 }, () => {
  it('keeps every mandatory contract and completes at least as many Targets', async () => {
    const { input, beamSearchInput, engine } = createPlannerSearchInstrumentationInput('representative-12')
    const run = await runPlannerSchedulerParity(input, {
      engine,
      createDependencies: () => createDeterministicPlannerDependencies(engine),
      // The workload's own Beam Search oracle bounds; the scheduler gets none.
      beamSearchOptions: beamSearchInput.options,
    })
    expect(mandatoryParityProblems(run)).toEqual([])
    expect(run.report.completion.regression).toBe(false)
    expect(run.report.verdict).toBe('parity')

    // The Beam Search is truncated by its bound; the scheduler finishes on its own.
    expect(run.beam.termination).toMatchObject({ status: 'incomplete', reachedLimits: ['max_expanded_states'] })
    expect(run.scheduler.termination.status).toBe('exhausted')
    expect(run.scheduler.termination.reachedLimits).toEqual([])
    expect(run.report.completion).toMatchObject({
      beamCompletedCount: 2,
      schedulerCompletedCount: 10,
      totalTargetCount: 12,
      beamOnlyCompletedTargetIds: [],
    })
    // Every Target the scheduler leaves incomplete lost a provisional outcome.
    const schedulerCompleted = new Set(run.scheduler.completedTargetIds)
    const incomplete = run.scheduler.planningTargetIds.filter((id) => !schedulerCompleted.has(id))
    expect(incomplete).toHaveLength(2)
    const provisionalLosers = new Set(
      (run.scheduler.schedulerDrops ?? [])
        .filter(({ cause }) => cause === 'provisional_outcome')
        .map(({ targetWeaponId }) => targetWeaponId),
    )
    incomplete.forEach((id) => expect(provisionalLosers.has(id)).toBe(true))
    expect(run.scheduler.rejectedReasonCounts).toEqual({ resource_conflict: 2 })

    // Allowed differences are recorded, not failed.
    expect(run.scheduler.expandedStates).toBe(run.scheduler.traceLength)
    expect(run.scheduler.projection).toMatchObject({ status: 'valid', expectedStateChainClosed: true })
    expect(run.beam.projection.status).toBe('valid')
    expect(run.beam.replay?.isValid).toBe(true)
  })
})
