import { useEffect, useRef, useState } from 'react'
import {
  Alert, Button, Checkbox, FormControl, FormControlLabel, InputLabel, MenuItem,
  Paper, Select, Stack, TextField, Typography,
} from '@mui/material'
import { PageShell } from '../components/PageShell'
import { loadMasterData } from '../domain/master/loadMasterData'
import type { PlannerOptions, PlannerSearchDepthMetrics } from '../domain/planner'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../domain/rng/production/productionRngEngine'
import { PLANNER_SEARCH_INSTRUMENTATION_WORKLOADS } from '../benchmarks/plannerSearchInstrumentationFixtures'
import {
  createPlannerInputFromExportJson,
  startPlannerSearchInstrumentationBrowserRun,
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

const EXPORT_SOURCE = 'export-json'

function parsePositiveInteger(text: string): number | null {
  const value = Number(text)
  return Number.isInteger(value) && value > 0 ? value : null
}

function report(run: PlannerSearchInstrumentationBrowserRun, label: string): string {
  const { result } = run
  const header = [
    `source: ${label}`,
    `entries: ${run.entryCount}`,
    `options: maxPlanSteps ${result.options.maxPlanSteps} / maxExpandedStates ${result.options.maxExpandedStates} / beamWidth ${result.options.beamWidth}`,
    `instrumented: ${result.instrumented}, projections: ${result.collectDiagnosticProjections}`,
    `Worker elapsed: ${result.elapsedMs.toFixed(0)} ms, round trip: ${run.roundTripMs.toFixed(0)} ms`,
    `engine: ${PRODUCTION_RNG_ENGINE_VERSION}, build: ${import.meta.env.MODE}`,
    `userAgent: ${navigator.userAgent}`,
    `hardwareConcurrency: ${navigator.hardwareConcurrency ?? '-'}`,
    `digest: ${JSON.stringify(result.digest)}`,
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

/**
 * Console / CDP entry for a scripted run, mirroring `globalThis.b5Benchmark`:
 * `await issue103Benchmark.run({ workloadId, options, instrumented, projections })`
 * resolves with the text report and the raw result.
 */
async function runFromConsole(request: {
  workloadId: string
  options: PlannerOptions
  instrumented?: boolean
  projections?: boolean
}) {
  const instrumented = request.instrumented ?? true
  const completed = await startPlannerSearchInstrumentationBrowserRun(
    {
      source: { kind: 'workload', workloadId: request.workloadId },
      options: request.options,
      instrumented,
      collectDiagnosticProjections: instrumented && request.projections === true,
    },
    () => undefined,
  ).promise
  return {
    visibilityState: document.visibilityState,
    report: report(completed, request.workloadId),
    run: completed,
  }
}

/**
 * Issue #103 Planner search instrumentation Browser benchmark (dev-only
 * `benchmark.html`). An Export JSON pasted here is parsed and validated in
 * memory only; nothing is written to IndexedDB.
 */
export function PlannerSearchInstrumentationBenchmarkPage() {
  const [source, setSource] = useState<string>('representative-35')
  const [exportJson, setExportJson] = useState('')
  const [maxPlanSteps, setMaxPlanSteps] = useState('1000')
  const [maxExpandedStates, setMaxExpandedStates] = useState('200000')
  const [beamWidth, setBeamWidth] = useState('50')
  const [instrumented, setInstrumented] = useState(true)
  const [projections, setProjections] = useState(false)
  const [running, setRunning] = useState(false)
  const [live, setLive] = useState<{ depth: PlannerSearchDepthMetrics; elapsedMs: number } | null>(null)
  const [output, setOutput] = useState<string | null>(null)
  const [rawJson, setRawJson] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const handle = useRef<PlannerSearchInstrumentationBrowserRunHandle | null>(null)

  useEffect(() => {
    ;(globalThis as unknown as { issue103Benchmark?: unknown }).issue103Benchmark = {
      run: runFromConsole,
      workloads: PLANNER_SEARCH_INSTRUMENTATION_WORKLOADS.map(({ id, options }) => ({ id, options })),
    }
  }, [])

  const run = async () => {
    setError(null)
    setOutput(null)
    setRawJson(null)
    setLive(null)
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
    let requestSource
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
      requestSource = { kind: 'input' as const, input: prepared.input }
    } else {
      requestSource = { kind: 'workload' as const, workloadId: source }
    }
    setRunning(true)
    const started = startPlannerSearchInstrumentationBrowserRun(
      {
        source: requestSource,
        options,
        instrumented,
        collectDiagnosticProjections: instrumented && projections,
      },
      (depth, elapsedMs) => setLive({ depth, elapsedMs }),
    )
    handle.current = started
    try {
      const completed = await started.promise
      setOutput(report(completed, source))
      setRawJson(JSON.stringify(completed, null, 2))
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
      description="通常PlannerのBeam Search構造を計測する開発用ベンチマークです。"
    >
      <Stack spacing={2}>
        <Alert severity="info">
          通常PlannerのBeam Searchを実Browser Workerで1回実行し、探索構造の計測値を表示します。
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
                control={<Checkbox checked={projections} disabled={!instrumented} onChange={(event) => setProjections(event.target.checked)} />}
                label="diagnostic projections"
              />
            </Stack>
            <Stack direction="row" spacing={2}>
              <Button variant="contained" disabled={running} onClick={() => void run()}>Run</Button>
              <Button variant="outlined" disabled={!running} onClick={() => handle.current?.cancel()}>Cancel</Button>
            </Stack>
          </Stack>
        </Paper>
        {error !== null && <Alert severity="error" sx={{ whiteSpace: 'pre-wrap' }}>{error}</Alert>}
        {live !== null && (
          <Typography variant="body2">
            depth {live.depth.depth} / expanded {live.depth.cumulativeExpandedStates} / best completed {live.depth.bestCompletedTargetCount} / {(live.elapsedMs / 1000).toFixed(1)} s
          </Typography>
        )}
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
