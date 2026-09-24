import { describe, expect, it, vi } from 'vitest'
import { runtimeUnsupportedFixture } from '../../test/fixtures/plannerRuntimeUnsupported'
import { createProductionPlan } from './productionPlanGeneration'
import type { PlannerBeamSearchResult } from './plannerTypes'

// Production Plan generation runs the deterministic scheduler (Issue #103
// Phase C), so every full Planner run - the first one and the
// runtime-unsupported retry - is captured there.
const runCapture = vi.hoisted(() => ({
  calls: [] as Array<{
    buildListEntryIds: string[]
    result: unknown
  }>,
}))

vi.mock('./plannerDeterministicScheduler', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./plannerDeterministicScheduler')>()
  return {
    ...actual,
    runPlannerDeterministicSchedule: async (
      ...args: Parameters<typeof actual.runPlannerDeterministicSchedule>
    ) => {
      const result = await actual.runPlannerDeterministicSchedule(...args)
      runCapture.calls.push({
        buildListEntryIds: args[0].buildListEntries.map(({ id }) => id),
        result,
      })
      return result
    },
  }
})

describe('Production plan replay-time unsupported fallback', () => {
  it('excludes only the runtime-unsupported Entry and reruns the full Planner run once', async () => {
    runCapture.calls.length = 0
    const { input, dependencies, entries } = runtimeUnsupportedFixture()

    const result = await createProductionPlan(input, dependencies)

    expect(result.plan).not.toBeNull()
    expect(runCapture.calls).toHaveLength(2)
    expect(runCapture.calls[0].buildListEntryIds).toEqual(
      entries.map(({ id }) => id),
    )
    expect(runCapture.calls[0].result).toMatchObject({
      bestState: {
        selectedBuildListEntryIds: expect.arrayContaining([entries[1].id]),
      },
    })
    expect(runCapture.calls[1].buildListEntryIds).toEqual([
      entries[0].id,
      entries[2].id,
    ])
    expect(result.plan?.selectedBuildListEntryIds).not.toContain(entries[1].id)
    expect(result.plan?.selectedBuildListEntryIds.some((id) =>
      id === entries[0].id || id === entries[2].id,
    )).toBe(true)
    expect(result.warnings).toContainEqual({
      kind: 'rng_prediction_unsupported',
      message: expect.stringContaining(String(entries[1].id)),
    })
    const finalRunResult =
      runCapture.calls[1].result as PlannerBeamSearchResult
    expect(finalRunResult.excludedBuildListEntries).toContainEqual({
      entry: entries[1],
      reason: expect.stringContaining('reference_adapter_unsupported'),
    })
  })
})
