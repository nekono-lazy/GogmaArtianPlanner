import { useEffect, useRef, useState } from 'react'
import {
  Alert, Button, Checkbox, FormControl, FormControlLabel, InputLabel, MenuItem,
  Paper, Select, Stack, TextField, Typography,
} from '@mui/material'
import { PageShell } from '../components/PageShell'
import { loadMasterData } from '../domain/master/loadMasterData'
import type { PlannerOptions } from '../domain/planner'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../domain/rng/production/productionRngEngine'
import { PLANNER_SEARCH_INSTRUMENTATION_WORKLOADS } from '../benchmarks/plannerSearchInstrumentationFixtures'
import {
  createPlannerInputFromExportJson,
  startPlannerSearchInstrumentationBrowserRun,
  type PlannerBenchmarkLiveProgress,
  type PlannerSearchInstrumentationBrowserRun,
  type PlannerSearchInstrumentationBrowserRunHandle,
} from '../benchmarks/plannerSearchInstrumentationBrowserBenchmark'
import {
  derivePlannerSearchMetrics,
  formatDepthTable,
  formatProjectionTable,
  formatRunSummary,
  formatTopEntryTable,
  selectRepresentativeDepths,
  topEntriesBySuccessors,
} from '../benchmarks/plannerSearchInstrumentationSummary'
import { formatPlannerSchedulerMetrics } from '../benchmarks/plannerSchedulerInstrumentationBenchmark'
import {
  comparePlannerStrategyRuns,
  formatPlannerSchedulerParityReport,
  type PlannerBenchmarkStrategy,
  type PlannerSchedulerParityReport,
  type PlannerStrategyRunSummary,
} from '../benchmarks/plannerSchedulerParity'
import type { PlannerSearchInstrumentationBenchmarkSource } from '../workers/plannerSearchInstrumentation.worker.benchmark'

const EXPORT_SOURCE = 'export-json'

type StrategyChoice = PlannerBenchmarkStrategy | 'compare'

function parsePositiveInteger(text: string): number | null {
  const value = Number(text)
  return Number.isInteger(value) && value > 0 ? value : null
}

/** The machine-readable environment of one Browser measurement. */
function benchmarkEnvironment() {
  return {
    measuredAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency ?? null,
    visibilityState: document.visibilityState,
    buildMode: import.meta.env.MODE,
    rngEngineVersion: PRODUCTION_RNG_ENGINE_VERSION,
  }
}

function environmentLines(): string[] {
  const environment = benchmarkEnvironment()
  return [
    `engine: ${environment.rngEngineVersion}, build: ${environment.buildMode}`,
    `userAgent: ${environment.userAgent}`,
    `hardwareConcurrency: ${environment.hardwareConcurrency ?? '-'}`,
    `visibilityState: ${environment.visibilityState}`,
  ]
}

function summaryLines(summary: PlannerStrategyRunSummary | null): string[] {
  if (summary === null) return ['parity summary: not requested']
  return [
    `completed Targets (isPlannerTargetComplete): ${summary.completedTargetIds.length} / ${summary.termination.totalTargetCount}`,
    `selected Entries: ${summary.selectedBuildListEntryIds.length}; conflicts: ${summary.conflicts.length}; rejected entries: ${summary.rejectedBuildListEntries.length} ${JSON.stringify(summary.rejectedReasonCounts)}`,
    `runtime rejections: ${JSON.stringify(summary.rejectionReasonCounts)}`,
    `weapon switches: ${summary.weaponSwitchCount ?? '-'}; preference violations: ${summary.improvementPreferenceViolationCount ?? '-'}`,
    `Trace Replay: ${summary.replay === null ? 'no trace' : summary.replay.isValid ? 'valid' : `INVALID ${summary.replay.issueCodes.join(', ')}`}`,
    `Production projection: ${summary.projection.status}${summary.projection.failure === null ? '' : ` (${summary.projection.failure})`}; steps ${summary.projection.planStepCount}; chain closed ${summary.projection.expectedStateChainClosed}`,
  ]
}

function report(run: PlannerSearchInstrumentationBrowserRun, label: string): string {
  if (run.strategy === 'scheduler') {
    const scheduler = run.scheduler
    const header = [
      `source: ${label}`,
      `strategy: scheduler`,
      `entries: ${run.entryCount}`,
      `options: maxPlanSteps ${scheduler.options.maxPlanSteps} / maxExpandedStates ${scheduler.options.maxExpandedStates} / beamWidth ${scheduler.options.beamWidth} (unused)`,
      `instrumented: ${scheduler.instrumented}`,
      `Worker elapsed: ${scheduler.elapsedMs.toFixed(1)} ms, round trip: ${run.roundTripMs.toFixed(1)} ms`,
      ...environmentLines(),
      `digest: ${JSON.stringify(scheduler.digest)}`,
      ...summaryLines(run.summary),
    ].join('\n')
    return scheduler.metrics === null
      ? header
      : [header, formatPlannerSchedulerMetrics(scheduler.metrics)].join('\n\n')
  }
  const { result } = run
  const header = [
    `source: ${label}`,
    `strategy: beam`,
    `entries: ${run.entryCount}`,
    `options: maxPlanSteps ${result.options.maxPlanSteps} / maxExpandedStates ${result.options.maxExpandedStates} / beamWidth ${result.options.beamWidth}`,
    `instrumented: ${result.instrumented}, projections: ${result.collectDiagnosticProjections}`,
    `Worker elapsed: ${result.elapsedMs.toFixed(0)} ms, round trip: ${run.roundTripMs.toFixed(0)} ms`,
    ...environmentLines(),
    `digest: ${JSON.stringify(result.digest)}`,
    ...summaryLines(run.summary),
  ].join('\n')
  if (result.run === null) return header
  const derived = derivePlannerSearchMetrics(result.depths, result.run)
  const depths = selectRepresentativeDepths(result.depths)
  return [
    header,
    formatRunSummary(result.run, derived),
    formatDepthTable(depths),
    formatProjectionTable(depths),
    formatTopEntryTable(topEntriesBySuccessors(result.run.entries)),
  ].join('\n\n')
}

function compareParity(
  beam: PlannerSearchInstrumentationBrowserRun,
  scheduler: PlannerSearchInstrumentationBrowserRun,
): PlannerSchedulerParityReport | null {
  return beam.summary === null || scheduler.summary === null
    ? null
    : comparePlannerStrategyRuns(beam.summary, scheduler.summary)
}

function compareReport(
  beam: PlannerSearchInstrumentationBrowserRun,
  scheduler: PlannerSearchInstrumentationBrowserRun,
  parity: PlannerSchedulerParityReport | null,
  label: string,
): string {
  return [
    parity === null ? 'parity: summary not requested' : formatPlannerSchedulerParityReport(parity),
    '=== Beam Search ===',
    report(beam, label),
    '=== deterministic scheduler ===',
    report(scheduler, label),
  ].join('\n\n')
}

interface ConsoleRunRequest {
  workloadId: string
  options: PlannerOptions
  instrumented?: boolean
  projections?: boolean
  /** Omitted means the PR #107 Beam Search run. */
  strategy?: PlannerBenchmarkStrategy
  /** Omitted means `true`: add the parity summary after the measured run. */
  summarize?: boolean
}

async function startConsoleRun(request: ConsoleRunRequest, strategy: PlannerBenchmarkStrategy) {
  const instrumented = request.instrumented ?? true
  return startPlannerSearchInstrumentationBrowserRun(
    {
      source: { kind: 'workload', workloadId: request.workloadId },
      options: request.options,
      instrumented,
      collectDiagnosticProjections: instrumented && request.projections === true,
      strategy,
      summarize: request.summarize ?? true,
    },
    () => undefined,
  ).promise
}

/**
 * Console / CDP entry for a scripted run, mirroring `globalThis.b5Benchmark`:
 * `await issue103Benchmark.run({ workloadId, options, instrumented, projections, strategy })`
 * resolves with the text report, the raw run and the environment. `strategy`
 * is optional and defaults to the Beam Search, so a PR #107 caller is
 * unchanged.
 */
async function runFromConsole(request: ConsoleRunRequest) {
  const completed = await startConsoleRun(request, request.strategy ?? 'beam')
  return {
    visibilityState: document.visibilityState,
    environment: benchmarkEnvironment(),
    report: report(completed, request.workloadId),
    run: completed,
  }
}

/**
 * `await issue103Benchmark.compare({ workloadId, options, instrumented })`:
 * the Beam Search and then the scheduler, one after the other in two fresh
 * Workers (never concurrently, so neither run's time is skewed by the other),
 * plus the Phase B parity report.
 */
async function compareFromConsole(request: Omit<ConsoleRunRequest, 'strategy'>) {
  const beam = await startConsoleRun(request, 'beam')
  const scheduler = await startConsoleRun(request, 'scheduler')
  const parity = compareParity(beam, scheduler)
  return {
    visibilityState: document.visibilityState,
    environment: benchmarkEnvironment(),
    report: compareReport(beam, scheduler, parity, request.workloadId),
    beam,
    scheduler,
    parity,
  }
}

function liveText(live: PlannerBenchmarkLiveProgress): string {
  return live.kind === 'depth'
    ? `depth ${live.depth.depth} / expanded ${live.depth.cumulativeExpandedStates} / best completed ${live.depth.bestCompletedTargetCount} / ${(live.elapsedMs / 1000).toFixed(1)} s`
    : `scheduler applied actions ${live.expandedStates} / ${(live.elapsedMs / 1000).toFixed(1)} s`
}

/**
 * Issue #103 Planner search instrumentation Browser benchmark (dev-only
 * `benchmark.html`). An Export JSON pasted here is parsed and validated in
 * memory only; nothing is written to IndexedDB. Phase B adds the
 * deterministic scheduler and a Beam / scheduler comparison; the Production
 * Planner is not affected by the choice made here.
 */
export function PlannerSearchInstrumentationBenchmarkPage() {
  const [source, setSource] = useState<string>('representative-35')
  const [strategy, setStrategy] = useState<StrategyChoice>('beam')
  const [exportJson, setExportJson] = useState('')
  const [maxPlanSteps, setMaxPlanSteps] = useState('1000')
  const [maxExpandedStates, setMaxExpandedStates] = useState('200000')
  const [beamWidth, setBeamWidth] = useState('50')
  const [instrumented, setInstrumented] = useState(true)
  const [projections, setProjections] = useState(false)
  const [running, setRunning] = useState(false)
  const [live, setLive] = useState<PlannerBenchmarkLiveProgress | null>(null)
  const [output, setOutput] = useState<string | null>(null)
  const [rawJson, setRawJson] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const handle = useRef<PlannerSearchInstrumentationBrowserRunHandle | null>(null)
  const cancelRequested = useRef(false)

  useEffect(() => {
    ;(globalThis as unknown as { issue103Benchmark?: unknown }).issue103Benchmark = {
      run: runFromConsole,
      compare: compareFromConsole,
      workloads: PLANNER_SEARCH_INSTRUMENTATION_WORKLOADS.map(({ id, options }) => ({ id, options })),
    }
  }, [])

  const startRun = (
    requestSource: PlannerSearchInstrumentationBenchmarkSource,
    options: PlannerOptions,
    runStrategy: PlannerBenchmarkStrategy,
  ) => {
    const started = startPlannerSearchInstrumentationBrowserRun(
      {
        source: requestSource,
        options,
        instrumented,
        collectDiagnosticProjections: instrumented && projections && runStrategy === 'beam',
        strategy: runStrategy,
      },
      setLive,
    )
    handle.current = started
    return started.promise
  }

  const run = async () => {
    setError(null)
    setOutput(null)
    setRawJson(null)
    setLive(null)
    cancelRequested.current = false
    const options: PlannerOptions | null = (() => {
      const steps = parsePositiveInteger(maxPlanSteps)
      const expanded = parsePositiveInteger(maxExpandedStates)
      const width = parsePositiveInteger(beamWidth)
      return steps === null || expanded === null || width === null
        ? null
        : { maxPlanSteps: steps, maxExpandedStates: expanded, beamWidth: width }
    })()
    if (options === null) {
      setError('Planner設定は正の整数で入力してください。')
      return
    }
    let requestSource: PlannerSearchInstrumentationBenchmarkSource
    if (source === EXPORT_SOURCE) {
      const loaded = loadMasterData()
      if (!loaded.ok) {
        setError('Master Data を読み込めません。')
        return
      }
      const prepared = await createPlannerInputFromExportJson(
        exportJson,
        loaded.data,
        PRODUCTION_RNG_ENGINE_VERSION,
      )
      if (!prepared.ok) {
        setError(prepared.message)
        return
      }
      requestSource = { kind: 'input', input: prepared.input }
    } else {
      requestSource = { kind: 'workload', workloadId: source }
    }
    setRunning(true)
    try {
      if (strategy === 'compare') {
        // Sequential, never concurrent: the two elapsed times stay comparable.
        const beam = await startRun(requestSource, options, 'beam')
        if (cancelRequested.current) {
          setOutput(report(beam, source))
          setRawJson(JSON.stringify({ environment: benchmarkEnvironment(), beam }, null, 2))
          return
        }
        const scheduler = await startRun(requestSource, options, 'scheduler')
        const parity = compareParity(beam, scheduler)
        setOutput(compareReport(beam, scheduler, parity, source))
        setRawJson(JSON.stringify({ environment: benchmarkEnvironment(), beam, scheduler, parity }, null, 2))
      } else {
        const completed = await startRun(requestSource, options, strategy)
        setOutput(report(completed, source))
        setRawJson(JSON.stringify({ environment: benchmarkEnvironment(), run: completed }, null, 2))
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      handle.current = null
      setRunning(false)
    }
  }

  return (
    <PageShell
      title="Issue #103 Planner Search Instrumentation"
      description="通常PlannerのBeam Searchと決定的schedulerを計測・比較する開発用ベンチマークです。"
    >
      <Stack spacing={2}>
        <Alert severity="info">
          Beam Search、決定的scheduler、またはその両方を実Browser Workerで実行し、計測値を表示します。
          ここでの選択は計測用であり、通常のPlannerは決定的schedulerを使います（Beam Searchはoracleとしてだけ残っています）。
          Export JSON は貼り付けたこのページのメモリ上でだけ検証・変換され、IndexedDBへは保存されません。
        </Alert>
        <Paper sx={{ p: 2 }}>
          <Stack spacing={2}>
            <FormControl size="small">
              <InputLabel id="issue103-source">Source</InputLabel>
              <Select
                labelId="issue103-source"
                label="Source"
                value={source}
                onChange={(event) => setSource(event.target.value)}
              >
                {PLANNER_SEARCH_INSTRUMENTATION_WORKLOADS.map((workload) => (
                  <MenuItem key={workload.id} value={workload.id}>{workload.label}</MenuItem>
                ))}
                <MenuItem value={EXPORT_SOURCE}>Export JSON（貼り付け）</MenuItem>
              </Select>
            </FormControl>
            <FormControl size="small">
              <InputLabel id="issue103-strategy">Strategy</InputLabel>
              <Select
                labelId="issue103-strategy"
                label="Strategy"
                value={strategy}
                onChange={(event) => setStrategy(event.target.value as StrategyChoice)}
              >
                <MenuItem value="beam">Beam Search</MenuItem>
                <MenuItem value="scheduler">Deterministic scheduler</MenuItem>
                <MenuItem value="compare">Compare both（Beam → scheduler、順番に実行）</MenuItem>
              </Select>
            </FormControl>
            {source === EXPORT_SOURCE && (
              <TextField
                label="Export JSON"
                multiline
                minRows={4}
                maxRows={12}
                value={exportJson}
                onChange={(event) => setExportJson(event.target.value)}
              />
            )}
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField size="small" label="maxPlanSteps" value={maxPlanSteps} onChange={(event) => setMaxPlanSteps(event.target.value)} />
              <TextField size="small" label="maxExpandedStates" value={maxExpandedStates} onChange={(event) => setMaxExpandedStates(event.target.value)} />
              <TextField size="small" label="beamWidth" value={beamWidth} onChange={(event) => setBeamWidth(event.target.value)} />
            </Stack>
            <Stack direction="row" spacing={2}>
              <FormControlLabel
                control={<Checkbox checked={instrumented} onChange={(event) => setInstrumented(event.target.checked)} />}
                label="instrumentation"
              />
              <FormControlLabel
                control={<Checkbox checked={projections} disabled={!instrumented || strategy === 'scheduler'} onChange={(event) => setProjections(event.target.checked)} />}
                label="diagnostic projections (Beam)"
              />
            </Stack>
            <Stack direction="row" spacing={2}>
              <Button variant="contained" disabled={running} onClick={() => void run()}>Run</Button>
              <Button
                variant="outlined"
                disabled={!running}
                onClick={() => {
                  cancelRequested.current = true
                  handle.current?.cancel()
                }}
              >
                Cancel
              </Button>
            </Stack>
          </Stack>
        </Paper>
        {error !== null && <Alert severity="error" sx={{ whiteSpace: 'pre-wrap' }}>{error}</Alert>}
        {live !== null && <Typography variant="body2">{liveText(live)}</Typography>}
        {output !== null && (
          <Paper sx={{ p: 2, overflowX: 'auto' }}>
            <Typography component="pre" variant="body2" sx={{ fontFamily: 'monospace', whiteSpace: 'pre' }} data-testid="issue103-report">
              {output}
            </Typography>
          </Paper>
        )}
        {rawJson !== null && (
          <TextField label="Raw result JSON" multiline minRows={4} maxRows={12} value={rawJson} slotProps={{ htmlInput: { readOnly: true } }} />
        )}
      </Stack>
    </PageShell>
  )
}
