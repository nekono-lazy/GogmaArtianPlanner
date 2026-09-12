import { useEffect, useRef, useState } from 'react'
import {
  Alert, Button, Chip, FormControl, InputLabel, MenuItem, Paper, Select,
  Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography,
} from '@mui/material'
import { PageShell } from '../components/PageShell'
import {
  constrainedEnumerationBenchmarkWorkloads,
  createConstrainedEnumerationBenchmarkInput,
} from '../benchmarks/constrainedEnumerationBenchmarkFixtures'
import {
  createConstrainedEnumerationBenchmarkHarness,
  type ConstrainedEnumerationRunResult,
} from '../benchmarks/constrainedEnumerationBrowserBenchmark'
import type { ConstrainedEnumerationBenchmarkMode } from '../benchmarks/constrainedEnumerationBenchmarkProtocol'
import type { ConstrainedEnumerationBounds } from '../domain/search'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../domain/rng/production/productionRngEngine'

type RunPhase = 'warm-up' | 'measurement' | 'early-stop' | 'cancel'
type RunStatus = 'completed' | 'cancelled' | 'error'

export interface ConstrainedEnumerationBenchmarkRecord {
  readonly id: string
  readonly workloadId: string
  readonly mode: ConstrainedEnumerationBenchmarkMode
  readonly phase: RunPhase
  readonly status: RunStatus
  readonly boundsText: string
  readonly roundTripMs: number
  readonly acceptedAtMs: number | null
  readonly workerElapsedMs: number | null
  readonly recorderOverheadMs: number | null
  readonly enumerationElapsedMs: number | null
  readonly deliveredCandidates: number | null
  readonly timeToFirstCandidateMs: number | null
  readonly timeToTenthCandidateMs: number | null
  readonly timeToFiftiethCandidateMs: number | null
  readonly examinedCandidates: number | null
  readonly evaluatedOffAxisPairs: number | null
  readonly exhausted: boolean | null
  readonly stoppedByBound: boolean | null
  readonly stoppedByConsumer: boolean | null
  readonly orderedParityKey: string | null
  readonly setParityKey: string | null
  readonly routeKinds: readonly string[] | null
  readonly cancelRequestedOffsetMs: number | null
  readonly cancelToWorkerAckMs: number | null
  readonly cancelToSettleMs: number | null
  readonly workerPings: number
  readonly longestWorkerPingMs: number | null
  readonly visibilityState: string
  readonly error: string | null
}

function boundsText(bounds: ConstrainedEnumerationBounds): string {
  return `${bounds.maxNormalForgeCount}/${bounds.maxGogmaAdvance}/${bounds.maxSkillResetCount}/${bounds.maxOffAxisPairEvaluations}`
}

function milliseconds(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)} ms`
}

export interface ConstrainedEnumerationBenchmarkRunOptions {
  readonly workloadId: string
  readonly mode?: ConstrainedEnumerationBenchmarkMode
  readonly phase: RunPhase
  readonly boundsOverride?: ConstrainedEnumerationBounds
  readonly stopAfterCandidates?: number
  readonly cancelAfterMs?: number
  /** `0` chains the next ping on the previous pong, needing no main-thread timer. */
  readonly pingIntervalMs?: number
}

/**
 * B8-B2 constrained enumeration Browser Worker benchmark harness.
 *
 * Unlinked from the normal application, like the C5-E2C8 and B5 harnesses. It
 * measures `visitConstrainedCandidates()` through a real Worker running an
 * unmodified `ProductionRngEngine`, and changes no Production behavior.
 */
export function ConstrainedEnumerationBenchmarkPage() {
  const [workloadId, setWorkloadId] = useState(
    constrainedEnumerationBenchmarkWorkloads[0].id,
  )
  const [measurements, setMeasurements] = useState(3)
  const [cancelAfterMs, setCancelAfterMs] = useState(500)
  const [records, setRecords] = useState<
    readonly ConstrainedEnumerationBenchmarkRecord[]
  >([])
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const recordsRef = useRef<readonly ConstrainedEnumerationBenchmarkRecord[]>([])

  const append = (record: ConstrainedEnumerationBenchmarkRecord) => {
    recordsRef.current = [...recordsRef.current, record]
    setRecords(recordsRef.current)
    return record
  }

  const run = async (
    options: ConstrainedEnumerationBenchmarkRunOptions,
  ): Promise<ConstrainedEnumerationBenchmarkRecord> => {
    setRunning(true)
    const requestId = `b8-${options.phase}-${options.workloadId}-${crypto.randomUUID()}`
    const harness = createConstrainedEnumerationBenchmarkHarness()
    const pings: number[] = []
    let stopPings = false
    const pingLoop = async () => {
      while (!stopPings) {
        const latency = await harness.ping(30_000)
        if (latency !== null) pings.push(latency)
        const interval = options.pingIntervalMs ?? 100
        if (interval > 0) {
          await new Promise((resolve) => globalThis.setTimeout(resolve, interval))
        }
      }
    }
    if (options.pingIntervalMs !== undefined) void pingLoop()

    let result: ConstrainedEnumerationRunResult
    try {
      result = await harness.run({
        requestId,
        workloadId: options.workloadId,
        mode: options.mode ?? 'timing',
        boundsOverride: options.boundsOverride,
        stopAfterCandidates: options.stopAfterCandidates,
        cancelAfterMs: options.cancelAfterMs,
      })
    } finally {
      stopPings = true
    }
    const cancel = harness.lastCancelObservation
    harness.dispose()
    setRunning(false)

    const shared = {
      id: requestId,
      workloadId: options.workloadId,
      mode: options.mode ?? ('timing' as ConstrainedEnumerationBenchmarkMode),
      phase: options.phase,
      roundTripMs: result.roundTripMs,
      acceptedAtMs: result.acceptedAtMs,
      cancelRequestedOffsetMs: cancel?.requestedAtMs ?? null,
      cancelToWorkerAckMs: cancel?.ackMs ?? null,
      cancelToSettleMs: cancel?.settledMs ?? null,
      workerPings: pings.length,
      longestWorkerPingMs: pings.length === 0 ? null : Math.max(...pings),
      visibilityState: document.visibilityState,
    }

    if (result.outcome.status === 'completed') {
      const { measurement, bounds } = result.outcome
      return append({
        ...shared,
        status: 'completed',
        boundsText: boundsText(bounds),
        workerElapsedMs: measurement.workerElapsedMs,
        recorderOverheadMs: measurement.recorderOverheadMs,
        enumerationElapsedMs: measurement.enumerationElapsedMs,
        deliveredCandidates: measurement.deliveredCandidates,
        timeToFirstCandidateMs: measurement.timeToFirstCandidateMs,
        timeToTenthCandidateMs: measurement.timeToTenthCandidateMs,
        timeToFiftiethCandidateMs: measurement.timeToFiftiethCandidateMs,
        examinedCandidates: measurement.summary.examinedCandidates,
        evaluatedOffAxisPairs: measurement.summary.evaluatedOffAxisPairs,
        exhausted: measurement.summary.exhausted,
        stoppedByBound: measurement.summary.stoppedByBound,
        stoppedByConsumer: measurement.stoppedByConsumer,
        orderedParityKey: measurement.orderedParityKey,
        setParityKey: measurement.setParityKey,
        routeKinds: measurement.routeKinds,
        error: null,
      })
    }

    const empty = {
      workerElapsedMs:
        result.outcome.status === 'cancelled' ? result.outcome.workerElapsedMs : null,
      recorderOverheadMs: null,
      enumerationElapsedMs: null,
      deliveredCandidates:
        result.outcome.status === 'cancelled'
          ? result.outcome.deliveredCandidates
          : null,
      timeToFirstCandidateMs: null,
      timeToTenthCandidateMs: null,
      timeToFiftiethCandidateMs: null,
      examinedCandidates: null,
      evaluatedOffAxisPairs: null,
      exhausted: null,
      stoppedByBound: null,
      stoppedByConsumer: null,
      orderedParityKey: null,
      setParityKey: null,
      routeKinds: null,
    }
    return append({
      ...shared,
      ...empty,
      status: result.outcome.status,
      boundsText: '—',
      error: result.outcome.status === 'error' ? result.outcome.message : null,
    })
  }

  const runMeasurements = async (
    workload = workloadId,
    count = measurements,
    runMode: ConstrainedEnumerationBenchmarkMode = 'timing',
  ) => {
    setMessage(`${workload} (${runMode}): warm-up 1回と measurement ${count}回を実行しています。`)
    await run({ workloadId: workload, mode: runMode, phase: 'warm-up' })
    for (let index = 0; index < count; index += 1) {
      await run({ workloadId: workload, mode: runMode, phase: 'measurement' })
    }
    setMessage(`${workload} (${runMode}) measurements completed.`)
  }

  const runEarlyStop = async (workload = workloadId, stopAfter = 1) => {
    setMessage(`${workload}: Candidate ${stopAfter}件で consumer stop します。`)
    const record = await run({
      workloadId: workload,
      phase: 'early-stop',
      stopAfterCandidates: stopAfter,
    })
    setMessage(`${workload} early stop completed.`)
    return record
  }

  const runCancel = async (workload = workloadId, delayMs = cancelAfterMs) => {
    setMessage(`${workload}: ${delayMs} ms 後に cancel します。`)
    const record = await run({
      workloadId: workload,
      phase: 'cancel',
      cancelAfterMs: delayMs,
      pingIntervalMs: 0,
    })
    setMessage(`${workload} cancel observation completed.`)
    return record
  }

  useEffect(() => {
    const api = {
      workloads: constrainedEnumerationBenchmarkWorkloads.map(
        ({ id, label, group, bounds }) => ({ id, label, group, bounds }),
      ),
      bounds: (id: string) => createConstrainedEnumerationBenchmarkInput(id).input.bounds,
      run: (options: ConstrainedEnumerationBenchmarkRunOptions) => run(options),
      runMeasurements: (
        workload: string,
        count: number,
        runMode: ConstrainedEnumerationBenchmarkMode = 'timing',
      ) => runMeasurements(workload, count, runMode),
      runEarlyStop: (workload: string, stopAfter: number) =>
        runEarlyStop(workload, stopAfter),
      runCancel: (workload: string, delayMs: number) => runCancel(workload, delayMs),
      records: () => recordsRef.current,
      clear: () => {
        recordsRef.current = []
        setRecords([])
      },
      engineVersion: PRODUCTION_RNG_ENGINE_VERSION,
      hardwareConcurrency: navigator.hardwareConcurrency ?? null,
      userAgent: navigator.userAgent,
      visibilityState: document.visibilityState,
    }
    ;(globalThis as unknown as { b8Benchmark?: unknown }).b8Benchmark = api
  })

  return (
    <PageShell
      title="B8 Constrained Enumeration Browser Worker Benchmark"
      description="未リンクの設計レビュー用benchmark harnessです。通常のSearch画面やPlannerには影響しません。"
    >
      <Stack spacing={2}>
        <Alert severity="warning">
          Production buildで実行してください。固定入力: Bow / Fire、Base Seed 51231782、
          Normal Counter 0、Skill Counter 341、Gogma Counter 200（B5と同一）。
        </Alert>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={2}>
            <Typography variant="body2">
              navigator.hardwareConcurrency: {navigator.hardwareConcurrency ?? 'unavailable'} ·
              Production Engine: {PRODUCTION_RNG_ENGINE_VERSION} · visibilityState:{' '}
              {document.visibilityState}
            </Typography>
            <FormControl fullWidth>
              <InputLabel id="b8-workload-label">Workload</InputLabel>
              <Select
                labelId="b8-workload-label" label="Workload" value={workloadId} disabled={running}
                onChange={(event) => setWorkloadId(event.target.value)}
              >
                {constrainedEnumerationBenchmarkWorkloads.map((workload) => (
                  <MenuItem key={workload.id} value={workload.id}>
                    {workload.label} · {boundsText(workload.bounds)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                fullWidth type="number" label="Measurements" value={measurements} disabled={running}
                onChange={(event) => setMeasurements(Math.max(1, Number(event.target.value) || 1))}
              />
              <TextField
                fullWidth type="number" label="Cancel after (ms)" value={cancelAfterMs} disabled={running}
                onChange={(event) => setCancelAfterMs(Math.max(0, Number(event.target.value) || 0))}
              />
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <Button variant="contained" disabled={running} onClick={() => void runMeasurements()}>
                Timing: warm-up + measurements
              </Button>
              <Button
                variant="outlined"
                disabled={running}
                onClick={() => void runMeasurements(workloadId, measurements, 'parity')}
              >
                Parity check
              </Button>
              <Button variant="outlined" disabled={running} onClick={() => void runEarlyStop()}>
                Early stop (1)
              </Button>
              <Button variant="outlined" disabled={running} onClick={() => void runCancel()}>
                Cancel observation
              </Button>
            </Stack>
            {message && <Alert severity="info">{message}</Alert>}
          </Stack>
        </Paper>
        <Paper variant="outlined" sx={{ overflowX: 'auto' }}>
          <Table size="small" aria-label="B8 benchmark results">
            <TableHead>
              <TableRow>
                <TableCell>Phase / status</TableCell>
                <TableCell>Workload / mode</TableCell>
                <TableCell>Bounds N/G/S/O</TableCell>
                <TableCell>Worker wall / recorder</TableCell>
                <TableCell>Round trip</TableCell>
                <TableCell>Delivered (I/P)</TableCell>
                <TableCell>TTF / 10th / 50th</TableCell>
                <TableCell>Examined / off-axis</TableCell>
                <TableCell>exh / bound / consumer</TableCell>
                <TableCell>Parity ordered / set</TableCell>
                <TableCell>Cancel ack / settle</TableCell>
                <TableCell>Ping</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {records.map((record) => (
                <TableRow key={record.id}>
                  <TableCell>
                    {record.phase}
                    <br />
                    <Chip
                      size="small" label={record.status}
                      color={record.status === 'completed' ? 'success' : record.status === 'cancelled' ? 'warning' : 'error'}
                    />
                  </TableCell>
                  <TableCell>
                    {record.workloadId}
                    <br />
                    {record.mode}
                  </TableCell>
                  <TableCell>{record.boundsText}</TableCell>
                  <TableCell>
                    {milliseconds(record.workerElapsedMs)}
                    <br />
                    obs {milliseconds(record.recorderOverheadMs)}
                  </TableCell>
                  <TableCell>{milliseconds(record.roundTripMs)}</TableCell>
                  <TableCell>
                    {record.deliveredCandidates ?? '—'}
                  </TableCell>
                  <TableCell>
                    {milliseconds(record.timeToFirstCandidateMs)} /{' '}
                    {milliseconds(record.timeToTenthCandidateMs)} /{' '}
                    {milliseconds(record.timeToFiftiethCandidateMs)}
                  </TableCell>
                  <TableCell>
                    {record.examinedCandidates ?? '—'} / {record.evaluatedOffAxisPairs ?? '—'}
                  </TableCell>
                  <TableCell>
                    {String(record.exhausted)} / {String(record.stoppedByBound)} /{' '}
                    {String(record.stoppedByConsumer)}
                  </TableCell>
                  <TableCell>
                    {record.orderedParityKey ?? '—'}
                    <br />
                    set {record.setParityKey ?? '—'}
                  </TableCell>
                  <TableCell>
                    {milliseconds(record.cancelToWorkerAckMs)} /{' '}
                    {milliseconds(record.cancelToSettleMs)}
                  </TableCell>
                  <TableCell>
                    {record.workerPings === 0
                      ? '—'
                      : `${record.workerPings}; max ${milliseconds(record.longestWorkerPingMs)}`}
                  </TableCell>
                </TableRow>
              ))}
              {records.length === 0 && (
                <TableRow>
                  <TableCell colSpan={12}>No measurements yet.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Paper>
        <Typography variant="body2">
          timing modeは最小recorderで動き、parity instrumentation（stable key再生成・
          digest・Candidate列保持）を行いません。そのためWorker wall timeを補正なしで
          enumerationのコストとして扱います。default判断にはこの値だけを使います。
          parity modeはordered / set parity確認専用で、そのinstrumentationのコスト
          （obs列）を含むためWorker wall timeを性能値として読まないでください。
          Round tripは主スレッドのpostMessageからsettleまでで、Worker生成コストを含みます。TTF / 10th / 50thはWorker内でCandidateが
          逐次delivered されるまでの時間で、Candidate traversal前のraw stream solveコストを
          含みます。Cancel列はWorkerのcancel ack到達までと、enumerationがcancelとして
          settleするまでです。
        </Typography>
      </Stack>
    </PageShell>
  )
}
