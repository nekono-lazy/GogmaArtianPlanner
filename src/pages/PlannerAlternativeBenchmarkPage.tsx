import { useEffect, useMemo, useState } from 'react'
import {
  Alert, Button, Checkbox, FormControlLabel, MenuItem, Paper, Stack, Table, TableBody, TableCell,
  TableHead, TableRow, TextField, Typography,
} from '@mui/material'
import { PageShell } from '../components/PageShell'
import {
  BENCHMARK_ONLY_CANDIDATE_TRIAL_GRID,
  BENCHMARK_ONLY_EXTENT_GRID,
  BENCHMARK_ONLY_HELD_LENGTH_GRID,
  BENCHMARK_ONLY_ISSUE_101_SANITY_EXTENT,
  BENCHMARK_ONLY_ISSUE_101_SANITY_TRIAL_BOUNDS,
  BENCHMARK_ONLY_PLANNER_RERUN_GRID,
  createIssue101RealFixture,
  longHeldReachingExtent,
  PLANNER_ALTERNATIVE_KERNEL_WORKLOADS,
  PLANNER_ALTERNATIVE_SEARCH_WORKLOADS,
  type LongHeldMode,
  type LongHeldOptions,
  type PlannerAlternativeKernelWorkloadId,
  type PlannerAlternativeSearchWorkloadId,
} from '../benchmarks/plannerAlternativeBenchmarkFixtures'
import { PLANNER_ALTERNATIVE_BENCHMARK_PROTOCOL_VERSION } from '../benchmarks/plannerAlternativeBenchmarkProtocol'
import {
  createPlannerAlternativeBenchmarkRunner,
  describeIssue101Fixture,
  describeLongHeldFixture,
  plannerAlternativeWorkerElapsedMs,
  summarizePlannerAlternativeMeasurements,
  type PlannerAlternativeBenchmarkRecord,
  type PlannerAlternativeBenchmarkRunner,
  type PlannerAlternativeRunOptions,
} from '../benchmarks/plannerAlternativeBenchmarkRunner'
import type { PlannerAlternativeRunOutcome } from '../benchmarks/plannerAlternativeBrowserBenchmark'
import { CURRENT_CALCULATION_APP_SCHEMA_VERSION } from '../domain/models/publicTypes'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../domain/rng/production/productionRngEngine'
import type { PlannerAlternativeSearchExtent } from '../domain/search'

type Mode = 'search' | 'kernel'
type Workload = PlannerAlternativeSearchWorkloadId | PlannerAlternativeKernelWorkloadId

export interface PlannerAlternativeBenchmarkGlobal {
  readonly protocolVersion: string
  readonly grids: {
    readonly extent: typeof BENCHMARK_ONLY_EXTENT_GRID
    readonly candidateTrials: typeof BENCHMARK_ONLY_CANDIDATE_TRIAL_GRID
    readonly plannerReruns: typeof BENCHMARK_ONLY_PLANNER_RERUN_GRID
    readonly heldLength: typeof BENCHMARK_ONLY_HELD_LENGTH_GRID
  }
  readonly sanity: {
    readonly issue101Extent: PlannerAlternativeSearchExtent
    readonly issue101TrialBounds: typeof BENCHMARK_ONLY_ISSUE_101_SANITY_TRIAL_BOUNDS
  }
  readonly workloads: { readonly search: readonly string[]; readonly kernel: readonly string[] }
  run: PlannerAlternativeBenchmarkRunner['run']
  runMeasurements: PlannerAlternativeBenchmarkRunner['runMeasurements']
  cancel: PlannerAlternativeBenchmarkRunner['cancel']
  records: PlannerAlternativeBenchmarkRunner['records']
  clear: PlannerAlternativeBenchmarkRunner['clear']
  summarize: () => ReturnType<typeof summarizePlannerAlternativeMeasurements>
  exportJson: () => string
  fixture: () => Promise<ReturnType<typeof describeIssue101Fixture>>
  longHeldFixture: typeof describeLongHeldFixture
  longHeldReachingExtent: typeof longHeldReachingExtent
  environment: () => Record<string, unknown>
}

declare global {
  var plannerAlternativeBenchmark: PlannerAlternativeBenchmarkGlobal | undefined
}

function environment(): Record<string, unknown> {
  return {
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency ?? null,
    visibilityState: document.visibilityState,
    engineVersion: PRODUCTION_RNG_ENGINE_VERSION,
    calculationAppSchemaVersion: CURRENT_CALCULATION_APP_SCHEMA_VERSION,
    protocolVersion: PLANNER_ALTERNATIVE_BENCHMARK_PROTOCOL_VERSION,
  }
}

function ms(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : value.toFixed(1)
}

function outcomeText(outcome: PlannerAlternativeRunOutcome): string {
  switch (outcome.status) {
    case 'search_completed': {
      const m = outcome.measurement
      const end = m.stoppedByConsumer ? 'consumer' : m.summary.stoppedByExtent ? 'extent' : 'exhausted'
      return `delivered ${m.deliveredCandidates}, first ${ms(m.timeToFirstCandidateMs)} ms, work ${m.settledWorkItemsAtFirstCandidate ?? '—'}/${m.settledWorkItemsTotal ?? '—'}, end ${end}`
    }
    case 'kernel_completed': {
      const result = outcome.measurement.result
      if (result.status === 'failed') return `kernel ${result.kernelStatus}`
      return `trials ${result.candidateTrials}, reruns ${result.plannerRerunsUsed}, first trial ${ms(outcome.measurement.timeToFirstTrialMs)} ms, [${result.targets.map(({ outcome: status }) => status).join(', ')}]`
    }
    case 'cancelled':
      return `cancelled after ${outcome.deliveredCandidates}`
    case 'error':
      return `error: ${outcome.message}`
  }
}

function positiveInteger(text: string): number | null {
  const value = Number(text)
  return text.trim() !== '' && Number.isInteger(value) && value >= 1 ? value : null
}

function nonNegativeInteger(text: string): number | null {
  const value = Number(text)
  return text.trim() !== '' && Number.isInteger(value) && value >= 0 ? value : null
}

/**
 * Planner Alternative Search Phase 3-A Browser Worker benchmark.
 *
 * Unlinked from the normal application (`benchmark.html` only). Every value on
 * this page is a benchmark-only measurement setting, never a Production
 * default: Phase 3-C decides the defaults from the Phase 3-B real Browser
 * Worker records. The console API `globalThis.plannerAlternativeBenchmark`
 * exists only while the page is mounted.
 */
export function PlannerAlternativeBenchmarkPage() {
  const [records, setRecords] = useState<readonly PlannerAlternativeBenchmarkRecord[]>([])
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('search')
  const [workload, setWorkload] = useState<Workload>('issue101_fire_dragon_fixed')
  const [extent, setExtent] = useState({
    maxNormalAdvance: String(BENCHMARK_ONLY_ISSUE_101_SANITY_EXTENT.maxNormalAdvance),
    maxGogmaAdvance: String(BENCHMARK_ONLY_ISSUE_101_SANITY_EXTENT.maxGogmaAdvance),
    maxSkillAdvance: String(BENCHMARK_ONLY_ISSUE_101_SANITY_EXTENT.maxSkillAdvance),
  })
  const [bounds, setBounds] = useState({
    maxCandidateTrialsPerTarget: String(BENCHMARK_ONLY_ISSUE_101_SANITY_TRIAL_BOUNDS.maxCandidateTrialsPerTarget),
    maxPlannerReruns: String(BENCHMARK_ONLY_ISSUE_101_SANITY_TRIAL_BOUNDS.maxPlannerReruns),
  })
  const [heldLength, setHeldLength] = useState('32')
  const [heldMode, setHeldMode] = useState<LongHeldMode>('held')
  const [stopAfter, setStopAfter] = useState('1')
  const [warmUp, setWarmUp] = useState('1')
  const [measurements, setMeasurements] = useState('3')
  const [cancelOnFirst, setCancelOnFirst] = useState(false)
  const [cancelAfterMs, setCancelAfterMs] = useState('')
  const [pingIntervalMs, setPingIntervalMs] = useState('')

  const runner = useMemo(() => createPlannerAlternativeBenchmarkRunner({
    loadIssue101Fixture: () => createIssue101RealFixture(),
    onChange: (state) => {
      setRecords(state.records)
      setRunning(state.running)
    },
  }), [])

  useEffect(() => {
    const api: PlannerAlternativeBenchmarkGlobal = {
      protocolVersion: PLANNER_ALTERNATIVE_BENCHMARK_PROTOCOL_VERSION,
      grids: {
        extent: BENCHMARK_ONLY_EXTENT_GRID,
        candidateTrials: BENCHMARK_ONLY_CANDIDATE_TRIAL_GRID,
        plannerReruns: BENCHMARK_ONLY_PLANNER_RERUN_GRID,
        heldLength: BENCHMARK_ONLY_HELD_LENGTH_GRID,
      },
      sanity: {
        issue101Extent: BENCHMARK_ONLY_ISSUE_101_SANITY_EXTENT,
        issue101TrialBounds: BENCHMARK_ONLY_ISSUE_101_SANITY_TRIAL_BOUNDS,
      },
      workloads: { search: PLANNER_ALTERNATIVE_SEARCH_WORKLOADS, kernel: PLANNER_ALTERNATIVE_KERNEL_WORKLOADS },
      run: (options) => runner.run(options),
      runMeasurements: (options) => runner.runMeasurements(options),
      cancel: () => runner.cancel(),
      records: () => runner.records(),
      clear: () => runner.clear(),
      summarize: () => summarizePlannerAlternativeMeasurements(runner.records()),
      exportJson: () => runner.exportJson(environment()),
      fixture: async () => describeIssue101Fixture(await createIssue101RealFixture()),
      longHeldFixture: describeLongHeldFixture,
      longHeldReachingExtent,
      environment,
    }
    globalThis.plannerAlternativeBenchmark = api
    return () => {
      runner.cancel()
      if (globalThis.plannerAlternativeBenchmark === api) delete globalThis.plannerAlternativeBenchmark
    }
  }, [runner])

  const longHeld = workload === 'long_skill_held' || workload === 'long_gogma_held'
  const workloads = mode === 'search' ? PLANNER_ALTERNATIVE_SEARCH_WORKLOADS : PLANNER_ALTERNATIVE_KERNEL_WORKLOADS

  const changeMode = (next: Mode) => {
    setMode(next)
    setWorkload(next === 'search' ? PLANNER_ALTERNATIVE_SEARCH_WORKLOADS[0] : PLANNER_ALTERNATIVE_KERNEL_WORKLOADS[0])
  }

  const fillReachingExtent = () => {
    const length = positiveInteger(heldLength)
    if (!longHeld || length === null) return
    const reaching = longHeldReachingExtent(workload, length)
    setExtent({
      maxNormalAdvance: String(reaching.maxNormalAdvance),
      maxGogmaAdvance: String(reaching.maxGogmaAdvance),
      maxSkillAdvance: String(reaching.maxSkillAdvance),
    })
  }

  const buildOptions = (): PlannerAlternativeRunOptions | string => {
    const parsed = {
      maxNormalAdvance: positiveInteger(extent.maxNormalAdvance),
      maxGogmaAdvance: positiveInteger(extent.maxGogmaAdvance),
      maxSkillAdvance: positiveInteger(extent.maxSkillAdvance),
    }
    if (parsed.maxNormalAdvance === null || parsed.maxGogmaAdvance === null || parsed.maxSkillAdvance === null) {
      return 'extent の3値はすべて1以上の整数で指定してください。'
    }
    const common = {
      extent: parsed as PlannerAlternativeSearchExtent,
      cancelOnFirstCandidate: cancelOnFirst,
      cancelAfterMs: cancelAfterMs.trim() === '' ? undefined : nonNegativeInteger(cancelAfterMs) ?? -1,
      pingIntervalMs: pingIntervalMs.trim() === '' ? undefined : nonNegativeInteger(pingIntervalMs) ?? -1,
    }
    if (common.cancelAfterMs === -1 || common.pingIntervalMs === -1) {
      return 'cancel after / ping interval は0以上の整数で指定してください（空欄で無効）。'
    }
    if (mode === 'kernel') {
      const trials = positiveInteger(bounds.maxCandidateTrialsPerTarget)
      const reruns = positiveInteger(bounds.maxPlannerReruns)
      if (trials === null || reruns === null) return 'trial bounds は1以上の整数で指定してください。'
      return {
        ...common,
        mode: 'kernel',
        workload: workload as PlannerAlternativeKernelWorkloadId,
        bounds: { maxCandidateTrialsPerTarget: trials, maxPlannerReruns: reruns },
      }
    }
    const stop = stopAfter.trim() === '' ? null : positiveInteger(stopAfter)
    if (stopAfter.trim() !== '' && stop === null) return 'stop after は1以上の整数（空欄で最後まで）で指定してください。'
    let held: LongHeldOptions | undefined
    if (longHeld) {
      const length = positiveInteger(heldLength)
      if (length === null) return 'held length は1以上の整数で指定してください。'
      held = { heldLength: length, heldMode }
    }
    return {
      ...common,
      mode: 'search',
      workload: workload as PlannerAlternativeSearchWorkloadId,
      stopAfterCandidates: stop,
      longHeld: held,
    }
  }

  const start = async () => {
    const options = buildOptions()
    const warm = nonNegativeInteger(warmUp)
    const count = positiveInteger(measurements)
    if (typeof options === 'string') {
      setMessage(options)
      return
    }
    if (warm === null || count === null) {
      setMessage('warm-up は0以上、measurement は1以上の整数で指定してください。')
      return
    }
    setMessage(`実行中: ${options.mode} / ${options.workload}（warm-up ${warm}、measurement ${count}、毎回fresh Worker）`)
    try {
      const produced = await runner.runMeasurements({ ...options, warmUp: warm, measurements: count })
      setMessage(`完了: ${produced.length} records`)
    } catch (error) {
      setMessage(`失敗: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const download = () => {
    const blob = new Blob([runner.exportJson(environment())], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `planner-alternative-benchmark_${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const field = { size: 'small' as const, disabled: running, sx: { minWidth: 0, flex: '1 1 140px' } }

  return (
    <PageShell
      title="Planner Alternative Phase 3 Browser Worker Benchmark"
      description="未リンクの計測用harnessです。通常画面・Production Worker・永続データには影響しません。"
    >
      <Stack spacing={2}>
        <Alert severity="warning">
          Production benchmark build（benchmark.html）で実行してください。ここの値はすべて benchmark-only の
          計測設定であり、Production default ではありません（default は Phase 3-C で実測から決定）。
          console: globalThis.plannerAlternativeBenchmark
        </Alert>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={2}>
            <Typography variant="body2">
              hardwareConcurrency: {navigator.hardwareConcurrency ?? 'unavailable'} · Engine: {PRODUCTION_RNG_ENGINE_VERSION} ·
              Calculation schema: {CURRENT_CALCULATION_APP_SCHEMA_VERSION} · Protocol: {PLANNER_ALTERNATIVE_BENCHMARK_PROTOCOL_VERSION}
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} useFlexGap sx={{ flexWrap: 'wrap' }}>
              <TextField select label="Mode" value={mode} onChange={(event) => changeMode(event.target.value as Mode)} {...field}>
                <MenuItem value="search">Search measurement</MenuItem>
                <MenuItem value="kernel">Kernel measurement</MenuItem>
              </TextField>
              <TextField select label="Workload" value={workload} onChange={(event) => setWorkload(event.target.value as Workload)} {...field}>
                {workloads.map((id) => <MenuItem key={id} value={id}>{id}</MenuItem>)}
              </TextField>
            </Stack>
            <Typography variant="subtitle2" component="h2">Extent（必須・補完なし）</Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} useFlexGap sx={{ flexWrap: 'wrap' }}>
              {(['maxNormalAdvance', 'maxGogmaAdvance', 'maxSkillAdvance'] as const).map((key) => (
                <TextField
                  key={key}
                  label={key}
                  type="number"
                  value={extent[key]}
                  onChange={(event) => setExtent({ ...extent, [key]: event.target.value })}
                  slotProps={{ htmlInput: { min: 1, step: 1 } }}
                  {...field}
                />
              ))}
            </Stack>
            {mode === 'kernel' && (
              <>
                <Typography variant="subtitle2" component="h2">Trial bounds（必須・補完なし）</Typography>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} useFlexGap sx={{ flexWrap: 'wrap' }}>
                  {(['maxCandidateTrialsPerTarget', 'maxPlannerReruns'] as const).map((key) => (
                    <TextField
                      key={key}
                      label={key}
                      type="number"
                      value={bounds[key]}
                      onChange={(event) => setBounds({ ...bounds, [key]: event.target.value })}
                      slotProps={{ htmlInput: { min: 1, step: 1 } }}
                      {...field}
                    />
                  ))}
                </Stack>
              </>
            )}
            {mode === 'search' && (
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} useFlexGap sx={{ flexWrap: 'wrap' }}>
                <TextField
                  label="stop after Candidates（空欄=最後まで）"
                  type="number"
                  value={stopAfter}
                  onChange={(event) => setStopAfter(event.target.value)}
                  {...field}
                />
                {longHeld && (
                  <>
                    <TextField label="held length" type="number" value={heldLength} onChange={(event) => setHeldLength(event.target.value)} {...field} />
                    <TextField select label="held mode" value={heldMode} onChange={(event) => setHeldMode(event.target.value as LongHeldMode)} {...field}>
                      <MenuItem value="held">held</MenuItem>
                      <MenuItem value="held_blocked">held_blocked</MenuItem>
                    </TextField>
                    <Button variant="outlined" disabled={running} onClick={fillReachingExtent} sx={{ flex: '1 1 140px' }}>
                      到達extentを入力
                    </Button>
                  </>
                )}
              </Stack>
            )}
            <Typography variant="subtitle2" component="h2">Series / cancel / ping</Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} useFlexGap sx={{ flexWrap: 'wrap' }}>
              <TextField label="warm-up" type="number" value={warmUp} onChange={(event) => setWarmUp(event.target.value)} {...field} />
              <TextField label="measurement" type="number" value={measurements} onChange={(event) => setMeasurements(event.target.value)} {...field} />
              <TextField label="cancel after ms（空欄=無効）" type="number" value={cancelAfterMs} onChange={(event) => setCancelAfterMs(event.target.value)} {...field} />
              <TextField label="ping interval ms（空欄=無効）" type="number" value={pingIntervalMs} onChange={(event) => setPingIntervalMs(event.target.value)} {...field} />
            </Stack>
            <FormControlLabel
              control={<Checkbox checked={cancelOnFirst} disabled={running} onChange={(event) => setCancelOnFirst(event.target.checked)} />}
              label="cancel on first Candidate / trial"
            />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <Button variant="contained" disabled={running} onClick={() => void start()}>Run</Button>
              <Button variant="outlined" disabled={!running} onClick={() => runner.cancel()}>Cancel</Button>
              <Button variant="outlined" color="inherit" disabled={running || records.length === 0} onClick={() => runner.clear()}>Clear</Button>
              <Button variant="outlined" color="inherit" disabled={records.length === 0} onClick={download}>JSON保存</Button>
            </Stack>
            {message && <Alert severity="info" role="status" aria-live="polite">{message}</Alert>}
          </Stack>
        </Paper>
        <Paper variant="outlined" sx={{ overflowX: 'auto' }}>
          <Table size="small" aria-label="Planner Alternative benchmark records">
            <TableHead>
              <TableRow>
                <TableCell>#</TableCell>
                <TableCell>Mode / phase</TableCell>
                <TableCell>Workload</TableCell>
                <TableCell>N/G/S</TableCell>
                <TableCell>Worker ms</TableCell>
                <TableCell>Round trip ms</TableCell>
                <TableCell>Outcome</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {records.map((record) => (
                <TableRow key={record.id}>
                  <TableCell>{record.sequence}</TableCell>
                  <TableCell>{record.mode} / {record.phase}</TableCell>
                  <TableCell sx={{ overflowWrap: 'anywhere' }}>
                    {record.workload}{record.longHeld ? ` (${record.longHeld.heldMode} ${record.longHeld.heldLength})` : ''}
                  </TableCell>
                  <TableCell>{record.extent.maxNormalAdvance}/{record.extent.maxGogmaAdvance}/{record.extent.maxSkillAdvance}</TableCell>
                  <TableCell>{ms(plannerAlternativeWorkerElapsedMs(record.outcome))}</TableCell>
                  <TableCell>{ms(record.roundTripMs)}</TableCell>
                  <TableCell sx={{ overflowWrap: 'anywhere' }}>{outcomeText(record.outcome)}</TableCell>
                </TableRow>
              ))}
              {records.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7}>No measurements yet.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Paper>
      </Stack>
    </PageShell>
  )
}
