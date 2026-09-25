import { describe, expect, it } from 'vitest'
import { mandatoryParityProblems } from '../test/fixtures/plannerSchedulerParity'
import { createDeterministicPlannerDependencies, createPlannerSchedulerWorkloadInput } from '../test/fixtures/plannerSchedulerWorkloads'
import { runPlannerSchedulerParity } from './plannerSchedulerParity'

/**
 * Issue #103 parity on `representative-12` with its PR #107 bounds
 * (`1000 / 20000 / 50`), retained as a CI oracle regression since Phase D-2b.
 * The Beam Search part takes tens of seconds in Node, so it has a file of its
 * own. `representative-35` is a scheduler-only regression; its Beam run was
 * measured once in a real Browser Worker
 * (`docs/ISSUE_103_SCHEDULER_PARITY_BENCHMARK.md`) and is not repeated.
 */
describe('representative-12 Beam / scheduler parity', { timeout: 300_000 }, () => {
  it('keeps every mandatory contract and completes at least as many Targets', async () => {
    const { input, beamSearchInput, engine } = createPlannerSchedulerWorkloadInput('representative-12')
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
    // The projection keeps the oracle's own truncation (Issue #103 Phase D-2a):
    // it is never rewritten into a Production termination.
    expect(run.beam.projection).toMatchObject({
      terminationStatus: 'incomplete',
      terminationReachedLimits: ['max_expanded_states'],
    })
    expect(run.scheduler.projection.terminationReachedLimits).toEqual([])
    expect(run.beam.replay?.isValid).toBe(true)
  })
})
