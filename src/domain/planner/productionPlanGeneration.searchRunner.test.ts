import { describe, expect, it, vi } from 'vitest'
import { plannerSchedulerCatalogue } from '../../test/fixtures/plannerSchedulerScenarios'
import { runPlannerDeterministicSchedule } from './plannerDeterministicScheduler'
import {
  createProductionPlanWithObserver,
  createProductionPlanWithSearchRunner,
} from './productionPlanGeneration'

/**
 * Issue #103 Phase B: the full-search seam of Production Plan generation.
 *
 * `createProductionPlanWithSearchRunner()` exists so tests and benchmarks can
 * run the deterministic scheduler through the one shared Plan-generation tail.
 * Production stays on the Beam Search: `createProductionPlanWithObserver()`
 * always passes `runPlannerBeamSearch`, and nothing outside tests, the Issue
 * #103 benchmark and the defining modules names the scheduler or the seam.
 */

const beam = vi.hoisted(() => ({ runs: 0 }))

vi.mock('./plannerBeamSearch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./plannerBeamSearch')>()
  return {
    ...actual,
    runPlannerBeamSearch: (...args: Parameters<typeof actual.runPlannerBeamSearch>) => {
      beam.runs += 1
      return actual.runPlannerBeamSearch(...args)
    },
  }
})

function scenario(id: string) {
  const found = plannerSchedulerCatalogue().find((item) => item.id === id)
  if (!found) throw new Error(`Unknown catalogue scenario '${id}'.`)
  return found.scenario
}

describe('Production Plan generation stays on the Beam Search', () => {
  it('runs the Beam Search for every full search of createProductionPlanWithObserver()', async () => {
    beam.runs = 0
    const built = scenario('J-same-owned-weapon')
    let observed = 0
    const result = await createProductionPlanWithObserver(built.input, built.dependencies, undefined, {
      beforeBeamSearch: () => {
        observed += 1
      },
    })
    expect(beam.runs).toBe(1)
    expect(observed).toBe(1)
    // The scheduler-only rejection mapping never appears on the Production path.
    expect(result.plan?.rejectedBuildListEntries.every(({ detail }) => detail.includes('Beam Search'))).toBe(true)
  })

  it('shares the whole Plan-generation tail with an injected scheduler run', async () => {
    beam.runs = 0
    const built = scenario('J-same-owned-weapon')
    let observed = 0
    const result = await createProductionPlanWithSearchRunner(
      runPlannerDeterministicSchedule,
      built.input,
      built.dependencies,
      undefined,
      { beforeBeamSearch: () => { observed += 1 } },
    )
    expect(beam.runs).toBe(0)
    // The observer still wraps the full search: B8 / B9 rerun budgets count it.
    expect(observed).toBe(1)
    expect(result.plan).not.toBeNull()
    expect(result.plan?.steps.every(({ executionEffects }) => executionEffects !== undefined)).toBe(true)
    expect(result.plan?.rejectedBuildListEntries).toEqual([
      expect.objectContaining({ buildListEntryId: 'entry.b', reason: 'resource_conflict' }),
    ])
  })

  it('names the scheduler and the seam only in tests, benchmarks and their own modules', () => {
    const sources: Record<string, string> = {
      ...import.meta.glob('../**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }),
      ...import.meta.glob('../../{app,components,db,pages,services,stores,workers}/**/*.{ts,tsx}', {
        query: '?raw',
        import: 'default',
        eager: true,
      }),
      ...import.meta.glob('../../*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }),
    } as Record<string, string>
    const paths = Object.keys(sources)
    expect(paths.length).toBeGreaterThan(100)
    const allowed = [
      /\.test\.tsx?$/,
      /\.benchmark(\.entry)?\.ts$/,
      /BenchmarkPage\.tsx$/,
      // The defining modules; a glob key of this directory reads `./name.ts`.
      /^\.\/plannerDeterministicScheduler\.ts$/,
      /^\.\/plannerSchedulerInstrumentation\.ts$/,
      /^\.\/productionPlanGeneration\.ts$/,
      /^\.\/plannerTypes\.ts$/,
      /^\.\/index\.ts$/,
    ]
    const offenders = paths.filter(
      (path) =>
        !allowed.some((pattern) => pattern.test(path)) &&
        /\b(?:runPlannerDeterministicSchedule|createPlannerDeterministicScheduleRun|createProductionPlanWithSearchRunner|schedulerInstrumentation)\b/.test(
          sources[path],
        ),
    )
    expect(paths).toContain('./productionPlanGeneration.ts')
    expect(offenders).toEqual([])
  })
})
