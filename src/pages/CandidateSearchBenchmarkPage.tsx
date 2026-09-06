import { useEffect, useRef, useState } from 'react'
import {
  Alert, Box, Button, Chip, FormControl, InputLabel, LinearProgress, MenuItem,
  Paper, Select, Stack, Table, TableBody, TableCell, TableHead, TableRow,
  TextField, Typography,
} from '@mui/material'
import { PageShell } from '../components/PageShell'
import {
  candidateSearchBenchmarkWorkloads,
  createCandidateSearchBenchmarkInput,
} from '../benchmarks/candidateSearchBenchmarkFixtures'
import {
  createCandidateSearchBenchmarkHarness,
  probeSearchWorkerErrorHandling,
  type CandidateSearchBenchmarkMode,
} from '../benchmarks/candidateSearchBrowserBenchmark'
import type { BuildCandidate } from '../domain/models/publicTypes'
import { stableStringify } from '../domain/models/publicTypes'
import type { CandidateSearchProgress, CandidateSearchResult } from '../domain/search'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../domain/rng/production/productionRngEngine'
import { SearchCancelledError } from '../services/search/searchWorkerClient'

type RunPhase = 'warm-up' | 'measurement' | 'cancel'
type RunStatus = 'completed' | 'cancelled' | 'error'

export interface CandidateSearchBenchmarkRecord {
  readonly id: string
  readonly workloadId: string
  readonly mode: CandidateSearchBenchmarkMode
  readonly phase: RunPhase
  readonly status: RunStatus
  readonly elapsedMs: number
  readonly searchElapsedMs: number | null
  readonly workerSettledMs: number | null
  readonly candidateCount: number | null
  readonly idealCount: number | null
  readonly idealOperationCount: number | null
  readonly isTruncated: boolean | null
  readonly parityKey: string | null
  readonly setParityKey: string | null
  readonly progressEvents: number
  readonly animationFrames: number
  readonly longestAnimationFrameMs: number
  readonly workerPings: number
  readonly longestWorkerPingMs: number | null
  readonly cancelRequestedOffsetMs: number | null
  readonly cancelToPromiseMs: number | null
  readonly cancelToWorkerAckMs: number | null
  readonly cancelToWorkerStopMs: number | null
  readonly progressAfterCancel: number | null
  readonly memoryBeforeBytes: number | null
  readonly memoryPeakBytes: number | null
  readonly memoryAfterBytes: number | null
  readonly visibilityState: string
  readonly error: string | null
}

interface PerformanceWithMemory extends Performance {
  readonly memory?: { readonly usedJSHeapSize: number }
}

function readMemory(): number | null {
  return (performance as PerformanceWithMemory).memory?.usedJSHeapSize ?? null
}

/** Excludes the run-dependent identity fields so reruns compare by content. */
function comparableCandidate(candidate: BuildCandidate) {
  const { id, searchRunId, createdAt, ...rest } = candidate
  void id
  void searchRunId
  void createdAt
  return rest
}

/**
 * Ordered parity. The retained set and the ordered output are recorded
 * separately because `compareCandidates()` breaks its final tie on
 * `BuildCandidate.id`, which folds in `searchRunId`.
 */
function parityKey(result: CandidateSearchResult): string {
  return stableStringify({
    isTruncated: result.isTruncated,
    warnings: result.warnings,
    targetResults: result.targetResults.map((target: CandidateSearchResult['targetResults'][number]) => ({
      targetWeaponId: target.targetWeaponId,
      searchedRoutes: target.searchedRoutes,
      skippedRoutes: target.skippedRoutes,
      candidates: target.candidates.map(comparableCandidate),
    })),
  })
}

/** Order-insensitive parity: the retained candidate set alone. */
function setParityKey(result: CandidateSearchResult): string {
  return stableStringify(
    result.targetResults.flatMap((target: CandidateSearchResult['targetResults'][number]) =>
      target.candidates.map((candidate) => stableStringify(comparableCandidate(candidate))),
    ).sort(),
  )
}

function shortHash(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `${hash.toString(16).padStart(8, '0')}:${value.length}`
}

function milliseconds(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)} ms`
}

function memoryText(value: number | null): string {
  return value === null ? 'unavailable' : `${(value / 1_048_576).toFixed(1)} MiB`
}

export interface CandidateSearchBenchmarkRunOptions {
  readonly workloadId: string
  readonly mode: CandidateSearchBenchmarkMode
  readonly phase: RunPhase
  /** Cancel the request this many milliseconds after it starts. */
  readonly cancelAfterMs?: number
  /**
   * Poll the Worker event loop in the benchmark seam mode. `0` sends the next
   * ping as soon as the previous pong arrives, which needs no main-thread
   * timer and therefore survives hidden-page timer throttling.
   */
  readonly pingIntervalMs?: number
}

export function CandidateSearchBenchmarkPage() {
  const [workloadId, setWorkloadId] = useState(candidateSearchBenchmarkWorkloads[0].id)
  const [mode, setMode] = useState<CandidateSearchBenchmarkMode>('production')
  const [measurements, setMeasurements] = useState(3)
  const [cancelAfterMs, setCancelAfterMs] = useState(500)
  const [records, setRecords] = useState<readonly CandidateSearchBenchmarkRecord[]>([])
  const [progress, setProgress] = useState<CandidateSearchProgress | null>(null)
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const runningRef = useRef(false)

  const append = (record: CandidateSearchBenchmarkRecord) => {
    setRecords((current) => [...current, record])
    return record
  }

  const run = async (
    options: CandidateSearchBenchmarkRunOptions,
  ): Promise<CandidateSearchBenchmarkRecord> => {
    runningRef.current = true
    setRunning(true)
    const requestId = `b5-${options.phase}-${options.workloadId}-${crypto.randomUUID()}`
    const { input } = createCandidateSearchBenchmarkInput(options.workloadId, requestId)
    const harness = createCandidateSearchBenchmarkHarness(options.mode)

    const before = readMemory()
    let peak = before
    let progressEvents = 0
    let progressAfterCancel = 0
    let cancelRequestedAt: number | null = null
    let animationFrames = 0
    let longestAnimationFrameMs = 0
    let lastFrame = performance.now()
    let stopFrameMonitor = false
    const observeFrame = (now: number) => {
      animationFrames += 1
      longestAnimationFrameMs = Math.max(longestAnimationFrameMs, now - lastFrame)
      lastFrame = now
      if (!stopFrameMonitor) requestAnimationFrame(observeFrame)
    }
    requestAnimationFrame(observeFrame)
    const memoryTimer = globalThis.setInterval(() => {
      const next = readMemory()
      if (next !== null) peak = peak === null ? next : Math.max(peak, next)
    }, 100)

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
    if (options.mode === 'benchmark_seam' && options.pingIntervalMs !== undefined) {
      void pingLoop()
    }

    let cancelTimer: number | null = null
    if (options.cancelAfterMs !== undefined) {
      cancelTimer = globalThis.setTimeout(() => {
        cancelRequestedAt = performance.now()
        harness.client.cancelSearch(requestId)
      }, options.cancelAfterMs)
    }

    setProgress({
      completedTargets: 0, totalTargets: input.targetWeaponIds.length,
      currentTargetWeaponId: null, phase: 'preparing', processedWorkItems: 0,
    })
    const startedAt = performance.now()
    let record: CandidateSearchBenchmarkRecord
    try {
      const result = await harness.client.startSearch(input, {
        onProgress: (next) => {
          progressEvents += 1
          if (cancelRequestedAt !== null) progressAfterCancel += 1
          setProgress(next)
        },
      })
      const elapsedMs = performance.now() - startedAt
      const target = result.targetResults[0]
      const ideal = target?.candidates.filter(({ category }) => category === 'ideal') ?? []
      record = {
        id: requestId, workloadId: options.workloadId, mode: options.mode,
        phase: options.phase, status: 'completed', elapsedMs,
        searchElapsedMs: result.elapsedMs, workerSettledMs: null,
        candidateCount: target?.candidates.length ?? 0, idealCount: ideal.length,
        idealOperationCount: ideal[0]?.estimatedOperationCount ?? null,
        isTruncated: result.isTruncated, parityKey: shortHash(parityKey(result)),
        setParityKey: shortHash(setParityKey(result)),
        progressEvents, animationFrames, longestAnimationFrameMs,
        workerPings: pings.length,
        longestWorkerPingMs: pings.length === 0 ? null : Math.max(...pings),
        cancelRequestedOffsetMs: null,
        cancelToPromiseMs: null, cancelToWorkerAckMs: null, cancelToWorkerStopMs: null,
        progressAfterCancel: cancelRequestedAt === null ? null : progressAfterCancel,
        memoryBeforeBytes: before, memoryPeakBytes: peak, memoryAfterBytes: readMemory(),
        visibilityState: document.visibilityState, error: null,
      }
    } catch (error) {
      const elapsedMs = performance.now() - startedAt
      const cancelled = error instanceof SearchCancelledError
      // Wait one more interval so a late Worker stop or late progress is seen.
      await new Promise((resolve) => globalThis.setTimeout(resolve, 1_000))
      const ack = harness.observations.find(
        ({ event, targetRequestId }) => event === 'cancel_received' && targetRequestId === requestId,
      )
      const stop = harness.observations.find(
        ({ event, targetRequestId }) => event === 'search_settled' && targetRequestId === requestId,
      )
      record = {
        id: requestId, workloadId: options.workloadId, mode: options.mode,
        phase: options.phase, status: cancelled ? 'cancelled' : 'error', elapsedMs,
        searchElapsedMs: null, workerSettledMs: stop?.workerElapsedMs ?? null,
        candidateCount: null, idealCount: null, idealOperationCount: null,
        isTruncated: null, parityKey: null, setParityKey: null,
        progressEvents, animationFrames, longestAnimationFrameMs,
        workerPings: pings.length,
        longestWorkerPingMs: pings.length === 0 ? null : Math.max(...pings),
        cancelRequestedOffsetMs: cancelRequestedAt === null ? null : cancelRequestedAt - startedAt,
        cancelToPromiseMs: cancelRequestedAt === null ? null : elapsedMs - (cancelRequestedAt - startedAt),
        cancelToWorkerAckMs:
          cancelRequestedAt === null || !ack ? null : ack.receivedAtMs - cancelRequestedAt,
        cancelToWorkerStopMs:
          cancelRequestedAt === null || !stop ? null : stop.receivedAtMs - cancelRequestedAt,
        progressAfterCancel: cancelRequestedAt === null ? null : progressAfterCancel,
        memoryBeforeBytes: before, memoryPeakBytes: peak, memoryAfterBytes: readMemory(),
        visibilityState: document.visibilityState,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    } finally {
      stopFrameMonitor = true
      stopPings = true
      if (cancelTimer !== null) globalThis.clearTimeout(cancelTimer)
      globalThis.clearInterval(memoryTimer)
      harness.dispose()
      setProgress(null)
      runningRef.current = false
      setRunning(false)
    }
    return append(record)
  }

  const runMeasurements = async (
    workload = workloadId,
    selectedMode = mode,
    count = measurements,
  ) => {
    setMessage(`${workload} / ${selectedMode}: warm-up 1回と measurement ${count}回を実行しています。`)
    await run({ workloadId: workload, mode: selectedMode, phase: 'warm-up' })
    for (let index = 0; index < count; index += 1) {
      await run({ workloadId: workload, mode: selectedMode, phase: 'measurement' })
    }
    setMessage(`${workload} / ${selectedMode} measurements completed.`)
  }

  const runCancel = async (workload = workloadId, delayMs = cancelAfterMs) => {
    setMessage(`${workload}: ${delayMs} ms 後に cancel します。`)
    await run({
      workloadId: workload, mode: 'benchmark_seam', phase: 'cancel',
      cancelAfterMs: delayMs, pingIntervalMs: 100,
    })
    setMessage(`${workload} cancel observation completed.`)
  }

  const runWorkerErrorProbe = async () => {
    const { input } = createCandidateSearchBenchmarkInput(
      'near_ideal_default_bounds',
      `b5-worker-error-${crypto.randomUUID()}`,
    )
    setMessage('Worker error probeを実行しています。')
    const result = await probeSearchWorkerErrorHandling(input)
    setMessage(
      `Worker error probe: outcome=${result.outcome}, error events=${result.errorEvents}, ` +
        `messageerror events=${result.messageErrorEvents}, elapsed=${result.elapsedMs.toFixed(1)} ms, ${result.detail}`,
    )
    return result
  }

  useEffect(() => {
    const api = {
      workloads: candidateSearchBenchmarkWorkloads.map(({ id, label, settings, expectedIdealOperationCount }) => ({
        id, label, settings, expectedIdealOperationCount,
      })),
      run: (options: CandidateSearchBenchmarkRunOptions) => run(options),
      runMeasurements: (workload: string, selectedMode: CandidateSearchBenchmarkMode, count: number) =>
        runMeasurements(workload, selectedMode, count),
      runCancel: (workload: string, delayMs: number) => runCancel(workload, delayMs),
      probeWorkerError: () => runWorkerErrorProbe(),
      records: () => records,
      engineVersion: PRODUCTION_RNG_ENGINE_VERSION,
      hardwareConcurrency: navigator.hardwareConcurrency ?? null,
      userAgent: navigator.userAgent,
      memoryAvailable: readMemory() !== null,
      visibilityState: document.visibilityState,
    }
    ;(globalThis as unknown as { b5Benchmark?: unknown }).b5Benchmark = api
  })

  const percent = progress === null || progress.totalTargets === 0
    ? 0
    : (progress.completedTargets / progress.totalTargets) * 100

  return (
    <PageShell
      title="B5 Candidate Search Browser Worker Benchmark"
      description="未リンクの設計レビュー用benchmark harnessです。通常のSearch画面や既定設定には影響しません。"
    >
      <Stack spacing={2}>
        <Alert severity="warning">
          Production buildで実行してください。固定入力: Bow / Fire、Base Seed 51231782、
          Normal Counter 0、Skill Counter 341、Gogma Counter 200。
        </Alert>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={2}>
            <Typography variant="body2">
              navigator.hardwareConcurrency: {navigator.hardwareConcurrency ?? 'unavailable'} · Production Engine:{' '}
              {PRODUCTION_RNG_ENGINE_VERSION} · performance.memory: {readMemory() === null ? 'unavailable' : 'available'}
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <FormControl fullWidth>
                <InputLabel id="b5-workload-label">Workload</InputLabel>
                <Select
                  labelId="b5-workload-label" label="Workload" value={workloadId} disabled={running}
                  onChange={(event) => setWorkloadId(event.target.value)}
                >
                  {candidateSearchBenchmarkWorkloads.map((workload) => (
                    <MenuItem key={workload.id} value={workload.id}>
                      {workload.label} · {workload.settings.maxNormalAdvance}/{workload.settings.maxGogmaAdvance}/
                      {workload.settings.maxSkillAdvance}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl fullWidth>
                <InputLabel id="b5-mode-label">Worker path</InputLabel>
                <Select
                  labelId="b5-mode-label" label="Worker path" value={mode} disabled={running}
                  onChange={(event) => setMode(event.target.value as CandidateSearchBenchmarkMode)}
                >
                  <MenuItem value="production">production (unmodified client)</MenuItem>
                  <MenuItem value="benchmark_seam">benchmark_seam (observable Worker)</MenuItem>
                </Select>
              </FormControl>
            </Stack>
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
                Warm-up + measurements
              </Button>
              <Button variant="outlined" disabled={running} onClick={() => void runCancel()}>
                Cancel observation
              </Button>
              <Button variant="outlined" disabled={running} onClick={() => void runWorkerErrorProbe()}>
                Worker error probe
              </Button>
            </Stack>
            {progress && (
              <Box aria-label="benchmark progress">
                <LinearProgress variant="determinate" value={percent} />
                <Typography variant="body2" sx={{ mt: 0.5 }}>
                  {progress.completedTargets} / {progress.totalTargets} targets
                </Typography>
              </Box>
            )}
            {message && <Alert severity="info">{message}</Alert>}
          </Stack>
        </Paper>
        <Paper variant="outlined" sx={{ overflowX: 'auto' }}>
          <Table size="small" aria-label="B5 benchmark results">
            <TableHead>
              <TableRow>
                <TableCell>Phase / status</TableCell>
                <TableCell>Workload</TableCell>
                <TableCell>Mode</TableCell>
                <TableCell>Elapsed</TableCell>
                <TableCell>Search elapsed</TableCell>
                <TableCell>Candidates / Ideal (D)</TableCell>
                <TableCell>Parity ordered / set</TableCell>
                <TableCell>Progress / RAF</TableCell>
                <TableCell>Worker ping</TableCell>
                <TableCell>Cancel promise / ack / stop</TableCell>
                <TableCell>Memory B/P/A</TableCell>
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
                  <TableCell>{record.workloadId}</TableCell>
                  <TableCell>{record.mode}</TableCell>
                  <TableCell>{milliseconds(record.elapsedMs)}</TableCell>
                  <TableCell>{milliseconds(record.searchElapsedMs)}</TableCell>
                  <TableCell>
                    {record.candidateCount ?? '—'} / {record.idealCount ?? '—'} ({record.idealOperationCount ?? '—'})
                    {record.isTruncated ? ' · truncated' : ''}
                  </TableCell>
                  <TableCell>
                    {record.parityKey ?? '—'}
                    <br />
                    set {record.setParityKey ?? '—'}
                  </TableCell>
                  <TableCell>
                    {record.progressEvents} / {record.animationFrames}; max {milliseconds(record.longestAnimationFrameMs)}
                    {record.progressAfterCancel === null ? '' : ` · post-cancel ${record.progressAfterCancel}`}
                  </TableCell>
                  <TableCell>
                    {record.workerPings === 0 ? '—' : `${record.workerPings}; max ${milliseconds(record.longestWorkerPingMs)}`}
                  </TableCell>
                  <TableCell>
                    {milliseconds(record.cancelToPromiseMs)} / {milliseconds(record.cancelToWorkerAckMs)} /{' '}
                    {milliseconds(record.cancelToWorkerStopMs)}
                  </TableCell>
                  <TableCell>
                    {memoryText(record.memoryBeforeBytes)} / {memoryText(record.memoryPeakBytes)} /{' '}
                    {memoryText(record.memoryAfterBytes)}
                  </TableCell>
                </TableRow>
              ))}
              {records.length === 0 && (
                <TableRow>
                  <TableCell colSpan={11}>No measurements yet.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Paper>
        <Typography variant="body2">
          Cancel列は「client Promiseがrejectされるまで」「Workerがcancel messageを処理したack」
          「Workerの検索処理が停止するまで」を分けて記録します。前者はローカルのreject、
          後の2つは benchmark_seam Workerからの観測です。Memoryは Chromium の非標準
          performance.memory が使えない場合 unavailable です。
        </Typography>
      </Stack>
    </PageShell>
  )
}
