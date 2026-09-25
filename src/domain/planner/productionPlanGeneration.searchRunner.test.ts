import { describe, expect, it, vi } from 'vitest'
import { plannerSchedulerCatalogue } from '../../test/fixtures/plannerSchedulerScenarios'
import { runtimeUnsupportedFixture } from '../../test/fixtures/plannerRuntimeUnsupported'
import { runPlannerBeamSearch } from './plannerBeamSearch'
import {
  createPlannerBeamSearchInput,
  type PlannerBeamSearchTermination,
} from './plannerBeamSearchTypes'
import { runPlannerDeterministicSchedule } from './plannerDeterministicScheduler'
import {
  createProductionPlan,
  createProductionPlanWithObserver,
  createProductionPlanWithSearchRunner,
  generatePlanFromFullRun,
  type PlannerAnyRunTermination,
  type PlannerFullRunOf,
  type PlannerFullSearchRunner,
  type PlannerPlanGenerationOf,
} from './productionPlanGeneration'
import type { PlannerOptions } from './plannerTypes'

/**
 * Issue #103 Phase C: the full-search seam of Production Plan generation.
 *
 * Production runs the deterministic scheduler: `createProductionPlanWithObserver()`
 * always passes `runPlannerDeterministicSchedule`, so the ordinary Planner, the
 * Planner Worker, B8 / B9 and the replan Preview all reach it. The seam
 * accepts only a runner returning a genuine Production `PlannerRunResult`
 * (Issue #103 Phase D-2a). The Beam Search oracle reaches the shared tail only
 * through the generic `generatePlanFromFullRun()` with its own termination
 * type, never as a `PlannerFullSearchRunner`, and nothing outside tests, the
 * Issue #103 benchmark and the defining modules names it.
 */

/** The Beam Search oracle as a full run of the shared tail, with its own termination type. */
const beamOracleFullRun: PlannerFullRunOf<PlannerBeamSearchTermination> = (
  input,
  dependencies,
  options,
  buildListContext,
) => runPlannerBeamSearch(createPlannerBeamSearchInput(input), dependencies, options, buildListContext)

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

/** The semantic outcome of one Plan generation, whichever run produced it. */
function digest(result: PlannerPlanGenerationOf<PlannerAnyRunTermination>) {
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
    const beamResult = await generatePlanFromFullRun(
      beamOracleFullRun,
      oracle.input,
      oracle.dependencies,
      undefined,
    )
    expect(digest(beamResult)).not.toEqual(digest(result))
  })

  it('keeps a truncated Beam Search oracle termination as it is through the shared tail (Phase D-2a)', async () => {
    // The oracle stops on its own `maxExpandedStates`: a truncation no
    // Production termination can express.
    const truncated = scenario('B-one-gogma-stream')
    const oracleRun: PlannerFullRunOf<PlannerBeamSearchTermination> = (input, dependencies, options, context) =>
      runPlannerBeamSearch(
        createPlannerBeamSearchInput(input, { maxExpandedStates: 1 }),
        dependencies,
        options,
        context,
      )
    const planned = await generatePlanFromFullRun(oracleRun, truncated.input, truncated.dependencies, undefined)
    // The shared tail reads the status only and returns the oracle termination
    // unconverted: no `max_plan_steps` stands in for it, no `exhausted`
    // replaces `incomplete`, and no `incomplete` with empty limits is made.
    expect(planned.termination).toEqual({
      status: 'incomplete',
      reachedLimits: ['max_expanded_states'],
      limits: { maxPlanSteps: truncated.input.options.maxPlanSteps, beamWidth: 50, maxExpandedStates: 1 },
      expandedStates: 1,
      completedTargetCount: 0,
      totalTargetCount: expect.any(Number),
    })
    // The partial trace still went through Trace Replay and the projection.
    expect(planned.plan?.steps).toHaveLength(1)
    expect(planned.plan?.steps[0].executionEffects).toBeDefined()

    // The Beam Search oracle is no Production runner, and its result no
    // PlannerResult: the seam and the Production result type stay narrow.
    // @ts-expect-error a Beam Search oracle run is not a PlannerFullSearchRunner.
    const asProductionRunner: PlannerFullSearchRunner = oracleRun
    expect(asProductionRunner).toBe(oracleRun)
  })

  it('reruns the Beam Search oracle, never the scheduler, on a runtime-unsupported retry', async () => {
    beam.runs = 0
    const { input, dependencies, entries } = runtimeUnsupportedFixture()
    const planned = await generatePlanFromFullRun(beamOracleFullRun, input, dependencies, undefined)
    // The first oracle run picked the Entry Trace Replay found unsupported, so
    // the shared tail reran the same oracle without it.
    expect(beam.runs).toBe(2)
    expect(planned.plan?.selectedBuildListEntryIds).not.toContain(entries[1].id)
    expect(planned.warnings).toContainEqual({
      kind: 'rng_prediction_unsupported',
      message: expect.stringContaining(String(entries[1].id)),
    })
    // The retried run's termination is still the oracle's own shape.
    expect(planned.termination.limits).toEqual({
      maxPlanSteps: input.options.maxPlanSteps,
      beamWidth: 50,
      maxExpandedStates: 10_000,
    })
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
        /\b(?:runPlannerBeamSearch|createProductionPlanWithSearchRunner|generatePlanFromFullRun|searchInstrumentation|schedulerInstrumentation)\b/.test(
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
