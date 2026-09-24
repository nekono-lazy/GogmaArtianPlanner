import { describe, expect, it } from 'vitest'
import { loadMasterData } from '../domain/master/loadMasterData'
import {
  EXPORT_APP_NAME,
  EXPORT_SCHEMA_VERSION,
  createDefaultAppSettings,
  type ExportRoot,
} from '../domain/models/publicTypes'
import { ProductionRngEngine } from '../domain/rng/production/productionRngEngine'
import { createPlannerSearchInstrumentationInput } from './plannerSearchInstrumentationFixtures'
import { createPlannerInputFromExportJson } from './plannerSearchInstrumentationBrowserBenchmark'
import {
  createPlannerSearchInstrumentationBenchmarkController,
  type PlannerSearchInstrumentationBenchmarkResponse,
} from '../workers/plannerSearchInstrumentation.worker.benchmark'

/**
 * A benchmark Worker message must be plain structured-clone data: no Map, Set,
 * function, class instance or Error anywhere inside it.
 */
function expectPlainStructuredCloneData(value: unknown, path = 'response'): void {
  if (value === null || ['string', 'number', 'boolean', 'undefined'].includes(typeof value)) return
  if (typeof value !== 'object') throw new Error(`${path} is a ${typeof value}`)
  if (Array.isArray(value)) {
    value.forEach((item, index) => expectPlainStructuredCloneData(item, `${path}[${index}]`))
    return
  }
  expect(Object.getPrototypeOf(value), `${path} is not a plain object`).toBe(Object.prototype)
  Object.entries(value).forEach(([key, item]) => expectPlainStructuredCloneData(item, `${path}.${key}`))
}

function master() {
  const loaded = loadMasterData()
  if (!loaded.ok) throw new Error('Master Data is invalid.')
  return loaded.data
}

describe('Issue #103 Planner search instrumentation Browser benchmark', () => {
  it('runs one workload in the benchmark Worker controller and streams its depths', async () => {
    const responses: PlannerSearchInstrumentationBenchmarkResponse[] = []
    const controller = createPlannerSearchInstrumentationBenchmarkController(
      () => new ProductionRngEngine(),
      (response) => responses.push(response),
    )
    await controller.handleMessage({
      type: 'issue103_run',
      requestId: 'run-1',
      source: { kind: 'workload', workloadId: 'sanity-3' },
      options: { maxPlanSteps: 300, maxExpandedStates: 10_000, beamWidth: 50 },
      instrumented: true,
      collectDiagnosticProjections: false,
    })

    const depths = responses.filter(({ type }) => type === 'issue103_depth')
    const result = responses.at(-1)
    expect(depths.length).toBeGreaterThan(0)
    expect(result?.type).toBe('issue103_result')
    if (result?.type !== 'issue103_result') return
    expect(result.entryCount).toBe(3)
    // No strategy in the request keeps the PR #107 Beam Search run and its `result` field.
    expect(result.run.strategy).toBe('beam')
    if (result.run.strategy !== 'beam') return
    expect(result.run.result.depths).toHaveLength(depths.length)
    expect(result.run.result.digest.terminationStatus).toBe('completed')
    expect(result.run.result.run?.reachedBeamSearch).toBe(true)
    expect(result.run.summary?.strategy).toBe('beam')
    expect(result.run.summary?.replay?.isValid).toBe(true)
    expect(result.run.summary?.projection.status).toBe('valid')
    expectPlainStructuredCloneData(result)
  })

  it('routes a scheduler request to the scheduler harness with its own metrics shape', async () => {
    const responses: PlannerSearchInstrumentationBenchmarkResponse[] = []
    const controller = createPlannerSearchInstrumentationBenchmarkController(
      () => new ProductionRngEngine(),
      (response) => responses.push(response),
    )
    await controller.handleMessage({
      type: 'issue103_run',
      requestId: 'run-scheduler',
      source: { kind: 'workload', workloadId: 'sanity-3' },
      options: { maxPlanSteps: 300, maxExpandedStates: 10_000, beamWidth: 50 },
      instrumented: true,
      collectDiagnosticProjections: true,
      strategy: 'scheduler',
    })

    // No Beam depth is ever posted for the scheduler.
    expect(responses.some(({ type }) => type === 'issue103_depth')).toBe(false)
    const result = responses.at(-1)
    expect(result?.type).toBe('issue103_result')
    if (result?.type !== 'issue103_result') return
    expect(result.run.strategy).toBe('scheduler')
    if (result.run.strategy !== 'scheduler') return
    expect(result.run).not.toHaveProperty('result')
    const { scheduler, summary } = result.run
    expect(scheduler.digest.terminationStatus).toBe('completed')
    expect(scheduler.digest.expandedStates).toBe(scheduler.digest.bestStateTraceLength)
    expect(scheduler.metrics?.reachedScheduler).toBe(true)
    expect(scheduler.metrics).not.toHaveProperty('depths')
    expect(scheduler.metrics?.counts.appliedRouteActionCount).toBeGreaterThan(0)
    expect(summary?.strategy).toBe('scheduler')
    expect(summary?.replay?.isValid).toBe(true)
    expect(summary?.projection.status).toBe('valid')
    expect(summary?.schedulerDrops).toEqual([])
    expectPlainStructuredCloneData(result)
  })

  it('runs the scheduler without instrumentation and without a summary when asked', async () => {
    const responses: PlannerSearchInstrumentationBenchmarkResponse[] = []
    const controller = createPlannerSearchInstrumentationBenchmarkController(
      () => new ProductionRngEngine(),
      (response) => responses.push(response),
    )
    await controller.handleMessage({
      type: 'issue103_run',
      requestId: 'run-plain',
      source: { kind: 'workload', workloadId: 'sanity-3' },
      options: { maxPlanSteps: 300, maxExpandedStates: 10_000, beamWidth: 50 },
      instrumented: false,
      collectDiagnosticProjections: false,
      strategy: 'scheduler',
      summarize: false,
    })
    const result = responses.at(-1)
    if (result?.type !== 'issue103_result' || result.run.strategy !== 'scheduler') {
      throw new Error('expected a scheduler result')
    }
    expect(result.run.scheduler.metrics).toBeNull()
    expect(result.run.summary).toBeNull()
    expect(result.run.scheduler.digest.terminationStatus).toBe('completed')
  })

  it.each(['scheduler', 'beam'] as const)(
    'cancels a running %s request through issue103_cancel',
    async (strategy) => {
      const responses: PlannerSearchInstrumentationBenchmarkResponse[] = []
      const controller = createPlannerSearchInstrumentationBenchmarkController(
        () => new ProductionRngEngine(),
        (response) => responses.push(response),
      )
      const running = controller.handleMessage({
        type: 'issue103_run',
        requestId: `run-cancel-${strategy}`,
        source: { kind: 'workload', workloadId: 'representative-12' },
        options: { maxPlanSteps: 1_000, maxExpandedStates: 20_000, beamWidth: 50 },
        instrumented: true,
        collectDiagnosticProjections: false,
        strategy,
      })
      // The run is suspended at its first Worker yield; the cancel lands there.
      await controller.handleMessage({ type: 'issue103_cancel', requestId: `run-cancel-${strategy}` })
      await running
      const result = responses.at(-1)
      expect(result?.type).toBe('issue103_result')
      if (result?.type !== 'issue103_result') return
      const digest = result.run.strategy === 'beam' ? result.run.result.digest : result.run.scheduler.digest
      expect(digest.cancelled).toBe(true)
      expect(digest.terminationStatus).toBe('cancelled')
      expect(result.run.summary?.projection.status).toBe('no_plan')
    },
    60_000,
  )

  it('reports an unknown workload as an error response', async () => {
    const responses: PlannerSearchInstrumentationBenchmarkResponse[] = []
    const controller = createPlannerSearchInstrumentationBenchmarkController(
      () => new ProductionRngEngine(),
      (response) => responses.push(response),
    )
    await controller.handleMessage({
      type: 'issue103_run',
      requestId: 'run-2',
      source: { kind: 'workload', workloadId: 'missing' },
      options: { maxPlanSteps: 300, maxExpandedStates: 10_000, beamWidth: 50 },
      instrumented: false,
      collectDiagnosticProjections: false,
    })
    expect(responses).toEqual([
      expect.objectContaining({ type: 'issue103_error', requestId: 'run-2' }),
    ])
  })

  it('builds the PlannerInput of a pasted Export in memory', async () => {
    const fixture = createPlannerSearchInstrumentationInput('sanity-3')
    const root: ExportRoot = {
      schemaVersion: EXPORT_SCHEMA_VERSION,
      appName: EXPORT_APP_NAME,
      exportedAt: '2026-09-24T00:00:00.000Z',
      rngState: fixture.input.rngState,
      normalArtianCounters: fixture.input.normalCounters,
      ownedWeapons: fixture.input.ownedWeapons,
      targetWeapons: fixture.input.targetWeapons,
      buildCandidates: [],
      buildListEntries: fixture.input.buildListEntries,
      productionPlans: [],
      executionHistory: [],
      executionSavePoints: [],
      settings: createDefaultAppSettings('2026-09-24T00:00:00.000Z'),
    }
    const prepared = await createPlannerInputFromExportJson(
      JSON.stringify(root),
      master(),
      fixture.engine.version,
    )

    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    expect(prepared.input.buildListEntries).toEqual(fixture.input.buildListEntries)
    expect(prepared.input.targetWeapons).toEqual(fixture.input.targetWeapons)
    expect(prepared.input.calculationContext).toEqual(fixture.input.calculationContext)
    expect(prepared.input.conflictResolutions).toEqual([])
  })

  it('refuses a body that is not an importable Export', async () => {
    const notJson = await createPlannerInputFromExportJson('{', master(), 'engine')
    const notExport = await createPlannerInputFromExportJson('{}', master(), 'engine')
    expect(notJson.ok).toBe(false)
    expect(notExport.ok).toBe(false)
  })
})
