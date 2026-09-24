import { describe, expect, it } from 'vitest'
import { mandatoryParityProblems, runCatalogueParity } from '../test/fixtures/plannerSchedulerParity'

/**
 * Issue #103 Phase B parity harness over the acceptance scenarios whose Beam
 * Search runs long (tens of Route units, the default 10,000 expanded states):
 * the independent-lane and bound cases. The conflict cases are in
 * `plannerSchedulerParity.conflicts.test.ts`; both are kept apart from
 * `plannerSchedulerParity.test.ts` so the suites spread over Vitest workers.
 */
describe('acceptance scenarios: long lanes and exact bounds', { timeout: 180_000 }, () => {
  it.each([
    ['A-independent-lanes', 2, 2],
    ['C-required-and-skippable', 2, 2],
    ['exact-bounds-steps', 2, 2],
  ] as const)(
    '%s keeps every mandatory contract without a completion regression',
    async (id, beamCompleted, schedulerCompleted) => {
      const run = await runCatalogueParity(id)
      expect(mandatoryParityProblems(run)).toEqual([])
      expect(run.report.verdict).toBe('parity')
      expect(run.report.completion.beamCompletedCount).toBe(beamCompleted)
      expect(run.report.completion.schedulerCompletedCount).toBe(schedulerCompleted)
    },
  )
})
