import { describe, expect, it, vi } from 'vitest'
import { runtimeUnsupportedFixture } from '../../test/fixtures/plannerRuntimeUnsupported'
import { createProductionPlan } from './productionPlanGeneration'
import type { PlannerBeamSearchResult } from './plannerTypes'

const beamCapture = vi.hoisted(() => ({
  calls: [] as Array<{
    buildListEntryIds: string[]
    result: unknown
  }>,
}))

vi.mock('./plannerBeamSearch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./plannerBeamSearch')>()
  return {
    ...actual,
    runPlannerBeamSearch: async (
      ...args: Parameters<typeof actual.runPlannerBeamSearch>
    ) => {
      const result = await actual.runPlannerBeamSearch(...args)
      beamCapture.calls.push({
        buildListEntryIds: args[0].buildListEntries.map(({ id }) => id),
        result,
      })
      return result
    },
  }
})

describe('Production plan replay-time unsupported fallback', () => {
  it('excludes only the runtime-unsupported Entry and reruns Beam once', async () => {
    beamCapture.calls.length = 0
    const { input, dependencies, entries } = runtimeUnsupportedFixture()

    const result = await createProductionPlan(input, dependencies)

    expect(result.plan).not.toBeNull()
    expect(beamCapture.calls).toHaveLength(2)
    expect(beamCapture.calls[0].buildListEntryIds).toEqual(
      entries.map(({ id }) => id),
    )
    expect(beamCapture.calls[0].result).toMatchObject({
      bestState: {
        selectedBuildListEntryIds: expect.arrayContaining([entries[1].id]),
      },
    })
    expect(beamCapture.calls[1].buildListEntryIds).toEqual([
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
    const finalBeamResult =
      beamCapture.calls[1].result as PlannerBeamSearchResult
    expect(finalBeamResult.excludedBuildListEntries).toContainEqual({
      entry: entries[1],
      reason: expect.stringContaining('reference_adapter_unsupported'),
    })
  })
})
