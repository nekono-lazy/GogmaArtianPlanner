import { describe, expect, it, vi } from 'vitest'
import { plannerSchedulerCatalogue } from '../../test/fixtures/plannerSchedulerScenarios'
import { projectBeamSearchResultForProduction } from '../../benchmarks/plannerSchedulerParity'
import { runPlannerBeamSearch } from './plannerBeamSearch'
import { createPlannerBeamSearchInput } from './plannerBeamSearchTypes'
import { runPlannerDeterministicSchedule } from './plannerDeterministicScheduler'
import {
  createProductionPlan,
  createProductionPlanWithObserver,
  createProductionPlanWithSearchRunner,
  type PlannerFullSearchRunner,
} from './productionPlanGeneration'
import type { PlannerOptions, PlannerResult } from './plannerTypes'

/**
 * Issue #103 Phase C: the full-search seam of Production Plan generation.
 *
 * Production runs the deterministic scheduler: `createProductionPlanWithObserver()`
 * always passes `runPlannerDeterministicSchedule`, so the ordinary Planner, the
 * Planner Worker, B8 / B9 and the replan Preview all reach it. The seam
 * accepts only a runner returning the Production `PlannerRunResult` (Issue
 * #103 Phase D-2a), so the Beam Search oracle reaches it only through the
 * parity harness's own adapter, and nothing outside tests, the Issue #103
 * benchmark and the defining modules names it.
 */

/** The Beam Search oracle adapted to the Production result shape, test-side only. */
const beamOracleRunner: PlannerFullSearchRunner = async (input, dependencies, options, buildListContext) =>
  projectBeamSearchResultForProduction(
    await runPlannerBeamSearch(createPlannerBeamSearchInput(input), dependencies, options, buildListContext),
  )

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

/** A fresh build of one catalogue scenario, so every run gets its own ID factory / Clock. */
function scenario(id: string) {
  const found = plannerSchedulerCatalogue().find((item) => item.id === id)
  if (!found) throw new Error(`Unknown catalogue scenario '${id}'.`)
  return found.scenario
}

/** The semantic outcome of one Production Plan generation. */
function digest(result: PlannerResult) {
  return {
    termination: result.termination,
    conflicts: result.conflicts,
    warnings: result.warnings,
    selectedBuildListEntryIds: result.plan?.selectedBuildListEntryIds ?? null,
    rejectedBuildListEntries: result.plan?.rejectedBuildListEntries ?? null,
    steps: result.plan?.steps.map((step) => ({
      operationType: step.operationType,
      buildListEntryId: step.buildListEntryId,
      expectedStateBefore: step.expectedStateBefore,
      expectedStateAfter: step.expectedStateAfter,
      checkpointMilestones: step.checkpointMilestones,
    })) ?? null,
  }
}

describe('Production Plan generation runs the deterministic scheduler', () => {
  it('runs the scheduler, never the Beam Search, for every full run of createProductionPlanWithObserver()', async () => {
    beam.runs = 0
    const built = scenario('J-same-owned-weapon')
    let observed = 0
    const result = await createProductionPlanWithObserver(built.input, built.dependencies, undefined, {
      beforePlannerRun: () => {
        observed += 1
      },
    })
    expect(beam.runs).toBe(0)
    // The observer wraps every full Planner run: B8 / B9 rerun budgets count it.
    expect(observed).toBe(1)
    expect(result.plan).not.toBeNull()
  })

  it('produces exactly the injected scheduler result through the shared Plan-generation tail', async () => {
    beam.runs = 0
    const production = scenario('J-same-owned-weapon')
    const injected = scenario('J-same-owned-weapon')
    const viaProduction = await createProductionPlanWithObserver(
      production.input,
      production.dependencies,
      undefined,
    )
    const viaSeam = await createProductionPlanWithSearchRunner(
      runPlannerDeterministicSchedule,
      injected.input,
      injected.dependencies,
      undefined,
    )
    expect(beam.runs).toBe(0)
    expect(viaProduction).toEqual(viaSeam)
    expect(viaProduction.plan?.steps.every(({ executionEffects }) => executionEffects !== undefined)).toBe(true)
  })

  it('reaches the scheduler-only provisional outcome on the ordinary createProductionPlan() path', async () => {
    // An unresolved same-weapon conflict: the scheduler commits the better
    // Entry and records the other as a provisional loser (`resource_conflict`),
    // which the Beam Search oracle never produces for this input.
    const built = scenario('J-same-owned-weapon')
    const result = await createProductionPlan(built.input, built.dependencies)
    expect(result.plan).not.toBeNull()
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0].selectedBuildListEntryId).toBeNull()
    expect(result.plan?.rejectedBuildListEntries).toEqual([
      expect.objectContaining({
        buildListEntryId: 'entry.b',
        reason: 'resource_conflict',
        detail: 'Plannerが資源競合を解決するため、このBuildListEntryを今回の計画では実行しませんでした。',
      }),
    ])

    const oracle = scenario('J-same-owned-weapon')
    const beamResult = await createProductionPlanWithSearchRunner(
      beamOracleRunner,
      oracle.input,
      oracle.dependencies,
      undefined,
    )
    expect(digest(beamResult)).not.toEqual(digest(result))
  })

  it('never reads or echoes a stray Beam Search oracle field (Phase D-2a)', async () => {
    const digests = await Promise.all([1, 50, 999].map(async (value) => {
      const built = scenario('D-unresolved-conflict')
      // A runtime value the Production type cannot express: no caller can
      // send it, and even if one did, it would change nothing.
      const stray = { ...built.input.options, beamWidth: value, maxExpandedStates: value }
      const options: PlannerOptions = stray
      const result = await createProductionPlan({ ...built.input, options }, built.dependencies)
      // The Production termination records the Production bound only.
      expect(result.termination.limits).toEqual({ maxPlanSteps: built.input.options.maxPlanSteps })
      return digest(result)
    }))
    expect(digests[0].selectedBuildListEntryIds).not.toBeNull()
    expect(digests[1]).toEqual(digests[0])
    expect(digests[2]).toEqual(digests[0])
  })

  it('names the Beam Search and the seam only in tests, benchmarks and their own modules', () => {
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
      /^\.\/plannerBeamSearch\.ts$/,
      /^\.\/plannerSearchInstrumentation\.ts$/,
      /^\.\/plannerDeterministicScheduler\.ts$/,
      /^\.\/plannerSchedulerInstrumentation\.ts$/,
      /^\.\/productionPlanGeneration\.ts$/,
      /^\.\/plannerBeamSearchTypes\.ts$/,
      /^\.\/index\.ts$/,
    ]
    const offenders = paths.filter(
      (path) =>
        !allowed.some((pattern) => pattern.test(path)) &&
        /\b(?:runPlannerBeamSearch|createProductionPlanWithSearchRunner|searchInstrumentation|schedulerInstrumentation)\b/.test(
          sources[path],
        ),
    )
    expect(paths).toContain('./productionPlanGeneration.ts')
    expect(offenders).toEqual([])
  })

  it('keeps the Beam Search oracle options, progress and defaults out of Production modules', () => {
    const sources: Record<string, string> = {
      ...import.meta.glob('../**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }),
      ...import.meta.glob('../../{app,components,db,pages,services,stores,workers}/**/*.{ts,tsx}', {
        query: '?raw',
        import: 'default',
        eager: true,
      }),
    } as Record<string, string>
    const allowed = [
      /\.test\.tsx?$/,
      /\.benchmark(\.entry)?\.ts$/,
      /BenchmarkPage\.tsx$/,
      // The oracle's own modules.
      /^\.\/plannerBeamSearch\.ts$/,
      /^\.\/plannerBeamSearchTypes\.ts$/,
      /^\.\/plannerSearchInstrumentation\.ts$/,
      /^\.\/index\.ts$/,
    ]
    // Code only: a doc comment may name the oracle types to explain the split.
    const code = (source: string) =>
      source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    const offenders = Object.keys(sources).filter(
      (path) =>
        !allowed.some((pattern) => pattern.test(path)) &&
        /\b(?:PlannerBeamSearch(?:Options|Input|Result|Termination|Progress|ExecutionOptions)|defaultPlannerBeamSearchOptions|plannerBeamSearchTypes|PlannerProgress|beamWidth|maxExpandedStates)\b/.test(
          code(sources[path]),
        ),
    )
    expect(Object.keys(sources)).toContain('./plannerDeterministicScheduler.ts')
    expect(offenders).toEqual([])
  })

  it('carries no Production strategy: the Planner Worker contracts name no strategy field', () => {
    const sources = import.meta.glob('../../workers/{plannerWorkerContracts,planner.worker,planner.worker.entry,planner.worker.production,plannerWorkerClient}.ts', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>
    expect(Object.keys(sources).length).toBeGreaterThan(0)
    Object.values(sources).forEach((source) => {
      expect(source).not.toMatch(/\bstrategy\b/)
    })
  })
})
