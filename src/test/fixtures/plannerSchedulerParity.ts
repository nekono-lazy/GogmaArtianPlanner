import { createDeterministicPlannerDependencies } from '../../benchmarks/plannerSearchInstrumentationBenchmark'
import {
  runPlannerSchedulerParity,
  type PlannerSchedulerParityRun,
} from '../../benchmarks/plannerSchedulerParity'
import { plannerSchedulerCatalogue } from './plannerSchedulerScenarios'

/** Runs the Phase B parity harness over one acceptance catalogue scenario. */
export async function runCatalogueParity(id: string): Promise<PlannerSchedulerParityRun> {
  const item = plannerSchedulerCatalogue().find((candidate) => candidate.id === id)
  if (!item) throw new Error(`Unknown catalogue scenario '${id}'.`)
  return runPlannerSchedulerParity(item.scenario.input, {
    engine: item.scenario.engine,
    createDependencies: () => createDeterministicPlannerDependencies(item.scenario.engine),
    buildListContext: item.buildListContext,
    beamSearchOptions: item.beamSearchOptions,
  })
}

/**
 * The mandatory contracts every compared input must keep, whatever its
 * verdict: no mandatory violation, no unexplained scheduler-only conflict, a
 * valid scheduler Trace Replay and a Production projection that did not fail.
 * An empty array means all of them hold.
 */
export function mandatoryParityProblems(run: PlannerSchedulerParityRun): string[] {
  return [
    ...run.report.mandatory.violations.map(({ code, strategy, detail }) => `${code} (${strategy ?? 'both'}): ${detail}`),
    ...run.report.conflicts.schedulerOnly.map((id) => `scheduler-only conflict ${id}`),
    ...(run.scheduler.replay !== null && !run.scheduler.replay.isValid ? ['scheduler Trace Replay invalid'] : []),
    ...(run.scheduler.projection.status === 'failed' ? [`scheduler projection failed: ${run.scheduler.projection.failure}`] : []),
  ]
}
