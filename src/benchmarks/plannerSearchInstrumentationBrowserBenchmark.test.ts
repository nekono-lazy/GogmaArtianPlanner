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
    expect(result.result.depths).toHaveLength(depths.length)
    expect(result.result.digest.terminationStatus).toBe('completed')
    expect(result.result.run?.reachedBeamSearch).toBe(true)
  })

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
