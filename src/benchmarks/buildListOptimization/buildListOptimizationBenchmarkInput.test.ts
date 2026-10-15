import { describe, expect, it } from 'vitest'
import { loadMasterData } from '../../domain/master/loadMasterData'
import { CURRENT_CALCULATION_APP_SCHEMA_VERSION } from '../../domain/models/publicTypes'
import { defaultPlannerOptions, type PlannerDependencies, type PlannerInput } from '../../domain/planner'
import { createProductionPlan } from '../../domain/planner/productionPlanGeneration'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../../domain/rng/production/productionRngEngine'
import { createDeterministicPlannerDependencies, createPlannerSchedulerWorkloadInput } from '../../test/fixtures/plannerSchedulerWorkloads'
import { prepareBloBenchmarkInput } from './buildListOptimizationBenchmarkInput'
import { BLO_SYNTHETIC_BOUNDS, BLO_SYNTHETIC_CASES, bloSyntheticExportRoot, bloSyntheticExportText } from './buildListOptimizationBenchmarkSynthetic'

/*
 * Issue #260 PR-5A: the measured input has the Production meaning. A synthetic Export goes through the Import authorities and the
 * ordinary `createPlannerInput()` and comes out as the PlannerInput the Production Application would read from the same state
 * (`options` = the Production default, `conflictResolutions = []`); the refusals stop where the Production path stops.
 */

const master = (() => {
  const loaded = loadMasterData()
  if (!loaded.ok) throw new Error('The Master Data does not load.')
  return loaded.data
})()
const now = () => performance.now()

async function ready(text: string): Promise<PlannerInput> {
  const prepared = await prepareBloBenchmarkInput(text, master, now)
  if (prepared.status !== 'ready') throw new Error(`refused: ${prepared.preparation.refusal?.code} ${prepared.issues.join(' / ')}`)
  return prepared.plannerInput
}

describe('Build List optimization measurement input (Issue #260 PR-5A)', () => {
  it('turns a synthetic Export into the PlannerInput of the same persisted state, with the Production CalculationContext and options', async () => {
    const fixture = createPlannerSchedulerWorkloadInput('sanity-3').input
    const input = await ready(bloSyntheticExportText('synthetic.sanity-3'))
    expect(input.calculationContext).toEqual({ gameVersion: master.manifest.gameVersion, masterDataVersion: master.manifest.dataVersion, rngEngineVersion: PRODUCTION_RNG_ENGINE_VERSION, appSchemaVersion: CURRENT_CALCULATION_APP_SCHEMA_VERSION })
    // The Application's options are the Production default (the workload's own maxPlanSteps is a test option the Export cannot carry).
    expect(input.options).toEqual(defaultPlannerOptions)
    expect(input.conflictResolutions).toEqual([])
    const { options: _inputOptions, ...rest } = input
    const { options: _fixtureOptions, ...expected } = fixture
    expect(rest).toEqual(expected)
    void _inputOptions
    void _fixtureOptions
  })

  it('builds every synthetic case and bounds set deterministically, and changes no Entry selection, Counter or RNG value', async () => {
    for (const { caseId } of BLO_SYNTHETIC_CASES) {
      expect(bloSyntheticExportText(caseId)).toBe(bloSyntheticExportText(caseId))
      const root = bloSyntheticExportRoot(caseId)
      const input = await ready(bloSyntheticExportText(caseId))
      expect(input.rngState).toEqual(root.rngState)
      expect(input.normalCounters).toEqual(root.normalArtianCounters)
      expect(input.buildListEntries.map(entry => entry.intermediateStateSelection)).toEqual(root.buildListEntries.map(entry => entry.intermediateStateSelection))
    }
    expect(BLO_SYNTHETIC_BOUNDS.map(set => set.boundsId)).toEqual(['synthetic.open', 'synthetic.node-budget-1', 'synthetic.wide-window'])
  })

  it('refuses where the Production path stops: no JSON, an unsupported or invalid Export, no RngState, a running Plan', async () => {
    const refusal = async (text: string) => (await prepareBloBenchmarkInput(text, master, now)).preparation.refusal?.code ?? null
    expect(await refusal('{')).toBe('invalid_json')
    expect(await refusal(JSON.stringify({ ...bloSyntheticExportRoot('synthetic.sanity-3'), appName: 'another-app' }))).toBe('export_unsupported')
    const invalid = bloSyntheticExportRoot('synthetic.sanity-3')
    invalid.buildListEntries = [{ ...invalid.buildListEntries[0]!, targetWeaponId: 'target.missing' as never }]
    expect(await refusal(JSON.stringify(invalid))).toBe('export_invalid')
    expect(await refusal(JSON.stringify({ ...bloSyntheticExportRoot('synthetic.sanity-3'), rngState: null }))).toBe('rng_state_missing')

    // A running Plan: the Production Application answers running_plan_exists before reading any input.
    const fixture = createPlannerSchedulerWorkloadInput('sanity-3')
    const dependencies: PlannerDependencies = createDeterministicPlannerDependencies(fixture.engine)
    const result = await createProductionPlan({ ...fixture.input, options: { ...defaultPlannerOptions } }, dependencies)
    expect(result.plan).not.toBeNull()
    const draft = bloSyntheticExportRoot('synthetic.sanity-3')
    draft.productionPlans = [result.plan!]
    const draftInput = await prepareBloBenchmarkInput(JSON.stringify(draft), master, now)
    expect(draftInput.status).toBe('ready')
    expect(draftInput.preparation.draftPresent).toBe(true)
    const stale = { ...result.plan!, status: 'stale' as const, currentStepId: result.plan!.steps[0]!.id, recalculationReasons: ['rng_state_changed' as const] }
    const running = bloSyntheticExportRoot('synthetic.sanity-3')
    running.productionPlans = [stale]
    expect(await refusal(JSON.stringify(running))).toBe('running_plan_exists')
  })
})
