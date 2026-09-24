import { describe, expect, it } from 'vitest'
import { mandatoryParityProblems, runCatalogueParity } from '../test/fixtures/plannerSchedulerParity'

/**
 * Issue #103 Phase B parity harness over the long-running acceptance scenarios
 * with Counter conflicts or one shared Gogma stream. Kept apart from
 * `plannerSchedulerParity.acceptance.test.ts` so the suites spread over Vitest
 * workers.
 */
describe('acceptance scenarios: conflicts and one shared stream', { timeout: 180_000 }, () => {
  it('B-one-gogma-stream keeps every mandatory contract without a completion regression', async () => {
    const run = await runCatalogueParity('B-one-gogma-stream')
    expect(mandatoryParityProblems(run)).toEqual([])
    expect(run.report.verdict).toBe('parity')
    expect(run.report.completion).toMatchObject({ beamCompletedCount: 1, schedulerCompletedCount: 3 })
  })

  it.each(['D-unresolved-conflict', 'D-equal-priority'])(
    '%s: both complete one participant and report the same conflict',
    async (id) => {
      const run = await runCatalogueParity(id)
      expect(mandatoryParityProblems(run)).toEqual([])
      expect(run.report.verdict).toBe('parity')
      expect(run.report.completion).toMatchObject({ beamCompletedCount: 1, schedulerCompletedCount: 1 })
      expect(run.report.conflicts.intersection).toHaveLength(1)
      // The scheduler's provisional winner is the Planner recommendation.
      const [conflict] = run.scheduler.conflicts
      expect(run.scheduler.selectedBuildListEntryIds).toEqual([conflict.recommendedBuildListEntryId])
      expect(conflict.selectedBuildListEntryId).toBeNull()
    },
  )

  it('L-explicit-resolution: both keep the explicit resolution', async () => {
    const run = await runCatalogueParity('L-explicit-resolution')
    expect(mandatoryParityProblems(run)).toEqual([])
    expect(run.report.verdict).toBe('parity')
    expect(run.scheduler.selectedBuildListEntryIds).toContain('entry.a')
    expect(run.beam.selectedBuildListEntryIds).toContain('entry.a')
    expect(run.scheduler.selectedBuildListEntryIds).not.toContain('entry.b')
    expect(run.beam.selectedBuildListEntryIds).not.toContain('entry.b')
    expect(run.scheduler.rejectionReasonCounts).toMatchObject({ conflict_resolution_not_selected: 1 })
  })
})