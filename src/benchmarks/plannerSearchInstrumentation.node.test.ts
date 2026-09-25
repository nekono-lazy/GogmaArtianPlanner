import { describe, it } from 'vitest'
import { createPlannerSearchInstrumentationInput } from './plannerSearchInstrumentationFixtures'
import { runPlannerSearchInstrumentation } from './plannerSearchInstrumentationBenchmark'
import {
  derivePlannerSearchMetrics,
  formatDepthTable,
  formatProjectionTable,
  formatRunSummary,
  formatTopEntryTable,
  selectRepresentativeDepths,
  topEntriesBySuccessors,
} from './plannerSearchInstrumentationSummary'

/**
 * Issue #103 Node measurement runner. Skipped unless explicitly requested:
 *
 *   PLANNER_SEARCH_INSTRUMENTATION_WORKLOAD=representative-35 npx vitest run src/benchmarks/plannerSearchInstrumentation.node.test.ts
 *
 * Optional: PLANNER_SEARCH_INSTRUMENTATION_MAX_EXPANDED overrides
 * maxExpandedStates, PLANNER_SEARCH_INSTRUMENTATION_PROJECTIONS=1 collects the
 * diagnostic projections, PLANNER_SEARCH_INSTRUMENTATION_OVERHEAD=1 also runs
 * the same input without the observer first, and
 * PLANNER_SEARCH_INSTRUMENTATION_OUT=<file> writes the report there instead of
 * the console. Node results are not Browser measurements.
 */
// Read through globalThis: the app tsconfig carries no Node types, and this
// runner is the only Node-specific file in src.
const env: Record<string, string | undefined> =
  (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {}
const workloadId = env.PLANNER_SEARCH_INSTRUMENTATION_WORKLOAD

describe.skipIf(workloadId === undefined)('Issue #103 Node measurement runner', () => {
  it('measures one workload', { timeout: 3_600_000 }, async () => {
    const fixture = createPlannerSearchInstrumentationInput(workloadId as string)
    const maxExpanded = env.PLANNER_SEARCH_INSTRUMENTATION_MAX_EXPANDED
    const input = maxExpanded === undefined
      ? fixture.beamSearchInput
      : {
          ...fixture.beamSearchInput,
          options: { ...fixture.beamSearchInput.options, maxExpandedStates: Number(maxExpanded) },
        }
    const lines: string[] = []
    if (env.PLANNER_SEARCH_INSTRUMENTATION_OVERHEAD === '1') {
      const plain = await runPlannerSearchInstrumentation(input, fixture.engine, {
        instrumented: false,
      })
      lines.push(`OFF elapsed ${plain.elapsedMs.toFixed(0)} ms ${JSON.stringify(plain.digest)}`)
    }
    const measured = await runPlannerSearchInstrumentation(input, fixture.engine, {
      instrumented: true,
      collectDiagnosticProjections:
        env.PLANNER_SEARCH_INSTRUMENTATION_PROJECTIONS === '1',
    })
    const run = measured.run
    if (run === null) throw new Error('No run metrics were reported.')
    const derived = derivePlannerSearchMetrics(measured.depths, run)
    lines.push(
        `ON elapsed ${measured.elapsedMs.toFixed(0)} ms ${JSON.stringify(measured.digest)}`,
        formatRunSummary(run, derived),
        formatDepthTable(selectRepresentativeDepths(measured.depths)),
        formatProjectionTable(selectRepresentativeDepths(measured.depths)),
        formatTopEntryTable(topEntriesBySuccessors(run.entries)),
        `depth elapsed ms (first 5 / last 5): ${measured.depthElapsedMs.slice(0, 5).map((v) => v.toFixed(0)).join(',')} / ${measured.depthElapsedMs.slice(-5).map((v) => v.toFixed(0)).join(',')}`,
    )
    const report = lines.join('\n\n')
    const out = env.PLANNER_SEARCH_INSTRUMENTATION_OUT
    if (out === undefined) console.log(report)
    else {
      const nodeFs = 'node:fs'
      const { writeFileSync } = (await import(/* @vite-ignore */ nodeFs)) as {
        writeFileSync: (path: string, data: string) => void
      }
      writeFileSync(out, report)
    }
  })
})
