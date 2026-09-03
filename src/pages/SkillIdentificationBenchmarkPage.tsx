import { useEffect, useRef, useState } from 'react'
import {
  Alert, Box, Button, Chip, FormControl, InputLabel, LinearProgress, MenuItem,
  Paper, Select, Stack, Table, TableBody, TableCell, TableHead, TableRow,
  Typography,
} from '@mui/material'
import {
  createBrowserBenchmarkSkillIdentificationClient,
  type BrowserBenchmarkWorkerCount,
} from '../benchmarks/skillIdentificationBrowserBenchmark'
import { PageShell } from '../components/PageShell'
import type {
  SkillIdentificationInput,
  SkillIdentificationProgress,
  SkillIdentificationResult,
} from '../domain/rng/identification'
import { referenceSkillCombinationFromIndex } from '../domain/rng/production/referenceSkillPools'
import { SkillIdentificationCancelledError } from '../services/rngIdentification/skillIdentificationWorkerClient'

const observations = [275, 255, 245, 243]
  .map(referenceSkillCombinationFromIndex)
  .map(({ seriesSkillId, groupSkillId }) => ({ seriesSkillId, groupSkillId }))

const rangePresets = {
  small: { label: 'Small bounded', startInclusive: 8_520_000, endInclusive: 8_525_000 },
  golden: { label: 'Golden bounded', startInclusive: 8_500_000, endInclusive: 8_550_000 },
  representative: { label: 'Representative bounded', startInclusive: 8_300_000, endInclusive: 8_800_000 },
} as const

type RangePreset = keyof typeof rangePresets
type RunPhase = 'warm-up' | 'measurement' | 'cancel'
type RunStatus = 'completed' | 'cancelled' | 'error'

interface RunRecord {
  readonly id: string
  readonly workers: BrowserBenchmarkWorkerCount
  readonly range: RangePreset
  readonly phase: RunPhase
  readonly status: RunStatus
  readonly elapsedMs: number
  readonly cancelToTerminalMs: number | null
  readonly seedsPerSecond: number | null
  readonly result: SkillIdentificationResult | null
  readonly progressEvents: number
  readonly animationFrames: number
  readonly longestAnimationFrameMs: number
  readonly memoryBeforeBytes: number | null
  readonly memoryPeakBytes: number | null
  readonly memoryAfterBytes: number | null
  readonly error: string | null
}

interface PerformanceWithMemory extends Performance {
  readonly memory?: { readonly usedJSHeapSize: number }
}

function readMemory(): number | null {
  return (performance as PerformanceWithMemory).memory?.usedJSHeapSize ?? null
}

function inputFor(range: RangePreset): SkillIdentificationInput {
  const selected = rangePresets[range]
  return {
    weaponTypeId: 'weapon.insect_glaive', elementId: 'element.thunder', observations,
    seedRange: selected, skillCounterRange: { startInclusive: 180, endInclusive: 190 },
  }
}

function resultKey(result: SkillIdentificationResult): string { return JSON.stringify(result) }
function classification(result: SkillIdentificationResult | null): string {
  if (result === null) return '—'
  if (result.isTruncated) return 'incomplete'
  if (result.matches.length === 1) return 'unique'
  return result.matches.length === 0 ? 'none' : 'multiple'
}
function milliseconds(value: number | null): string { return value === null ? '—' : `${value.toFixed(1)} ms` }
function memory(value: number | null): string { return value === null ? 'unavailable' : `${(value / 1_048_576).toFixed(1)} MiB` }

export function SkillIdentificationBenchmarkPage() {
  const [range, setRange] = useState<RangePreset>('golden')
  const [workers, setWorkers] = useState<BrowserBenchmarkWorkerCount>(1)
  const [records, setRecords] = useState<readonly RunRecord[]>([])
  const [progress, setProgress] = useState<SkillIdentificationProgress | null>(null)
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const active = useRef<{ readonly client: ReturnType<typeof createBrowserBenchmarkSkillIdentificationClient>; readonly requestId: string; cancelRequestedAt: number | null } | null>(null)

  useEffect(() => () => active.current?.client.dispose(), [])
  const append = (record: RunRecord) => setRecords((current) => [...current, record])

  const run = async (count: BrowserBenchmarkWorkerCount, selectedRange: RangePreset, phase: RunPhase) => {
    const client = createBrowserBenchmarkSkillIdentificationClient(count)
    const requestId = `c8-browser-${phase}-${count}-${crypto.randomUUID()}`
    const input = inputFor(selectedRange)
    const totalSeeds = input.seedRange!.endInclusive - input.seedRange!.startInclusive + 1
    const before = readMemory()
    let peak = before
    let progressEvents = 0
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
    const memoryTimer = window.setInterval(() => {
      const next = readMemory()
      if (next !== null) peak = peak === null ? next : Math.max(peak, next)
    }, 100)
    const startedAt = performance.now()
    active.current = { client, requestId, cancelRequestedAt: null }
    setRunning(true)
    setProgress({ searchedSeeds: 0, totalSeeds, matchesFound: 0 })
    try {
      const result = await client.identify(requestId, input, { onProgress: (next) => { progressEvents += 1; setProgress(next) } })
      const elapsedMs = performance.now() - startedAt
      append({ id: requestId, workers: count, range: selectedRange, phase, status: 'completed', elapsedMs, cancelToTerminalMs: null, seedsPerSecond: totalSeeds / (elapsedMs / 1_000), result, progressEvents, animationFrames, longestAnimationFrameMs, memoryBeforeBytes: before, memoryPeakBytes: peak, memoryAfterBytes: readMemory(), error: null })
    } catch (error) {
      const elapsedMs = performance.now() - startedAt
      const cancelAt = active.current?.requestId === requestId ? active.current.cancelRequestedAt : null
      append({ id: requestId, workers: count, range: selectedRange, phase, status: error instanceof SkillIdentificationCancelledError ? 'cancelled' : 'error', elapsedMs, cancelToTerminalMs: cancelAt === null ? null : performance.now() - cancelAt, seedsPerSecond: null, result: null, progressEvents, animationFrames, longestAnimationFrameMs, memoryBeforeBytes: before, memoryPeakBytes: peak, memoryAfterBytes: readMemory(), error: error instanceof Error ? error.message : 'Unknown error' })
    } finally {
      stopFrameMonitor = true
      window.clearInterval(memoryTimer); client.dispose()
      if (active.current?.requestId === requestId) active.current = null
      setRunning(false); setProgress(null)
    }
  }

  const runMeasurements = async () => {
    setMessage(`${workers} Worker: warm-up 1回とmeasurement 3回を実行しています。`)
    await run(workers, range, 'warm-up')
    for (let iteration = 0; iteration < 3; iteration += 1) await run(workers, range, 'measurement')
    setMessage(`${workers} Worker measurements completed.`)
  }
  const runCancel = () => { setMessage('Representative bounded searchを開始しました。検索中にCancelを押してください。'); void run(workers, 'representative', 'cancel') }
  const cancel = () => {
    if (active.current === null) return
    active.current.cancelRequestedAt = performance.now()
    active.current.client.cancel(active.current.requestId)
  }
  const baseline = records.find((record) => record.phase === 'measurement' && record.status === 'completed' && record.workers === 1 && record.range === range)?.result ?? null
  const percent = progress === null || progress.totalSeeds === 0 ? 0 : (progress.searchedSeeds / progress.totalSeeds) * 100

  return (
    <PageShell title="C5-E2C8 Browser Worker Benchmark" description="未リンクの設計レビュー用benchmark harnessです。通常WizardのWorker policyや設定画面には影響しません。">
      <Stack spacing={2}>
        <Alert severity="warning">Production buildで実行してください。固定入力: Insect Glaive / Thunder、4 ordered observations (275, 255, 245, 243)、Skill Counter 180–190。</Alert>
        <Paper variant="outlined" sx={{ p: 2 }}><Stack spacing={2}>
          <Typography variant="body2">navigator.hardwareConcurrency: {navigator.hardwareConcurrency ?? 'unavailable'} · Production Engine: production-rng:c5-e2 · Expected Browser Workers: {workers}</Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <FormControl fullWidth><InputLabel id="c8-range-label">Seed range</InputLabel><Select labelId="c8-range-label" label="Seed range" value={range} disabled={running} onChange={(event) => setRange(event.target.value as RangePreset)}>{Object.entries(rangePresets).map(([key, value]) => <MenuItem key={key} value={key}>{value.label}: {value.startInclusive.toLocaleString()}–{value.endInclusive.toLocaleString()} ({(value.endInclusive - value.startInclusive + 1).toLocaleString()})</MenuItem>)}</Select></FormControl>
            <FormControl fullWidth><InputLabel id="c8-workers-label">Workers</InputLabel><Select labelId="c8-workers-label" label="Workers" value={workers} disabled={running} onChange={(event) => setWorkers(Number(event.target.value) as BrowserBenchmarkWorkerCount)}>{[1, 2, 4].map((count) => <MenuItem key={count} value={count}>{count}</MenuItem>)}</Select></FormControl>
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}><Button variant="contained" disabled={running} onClick={() => void runMeasurements()}>Warm-up + 3 measurements</Button><Button variant="outlined" disabled={running} onClick={runCancel}>Cancel testを開始</Button><Button color="warning" variant="outlined" disabled={!running} onClick={cancel}>Cancel</Button></Stack>
          {progress && <Box aria-label="benchmark progress"><LinearProgress variant="determinate" value={percent} /><Typography variant="body2" sx={{ mt: 0.5 }}>{progress.searchedSeeds.toLocaleString()} / {progress.totalSeeds.toLocaleString()} seeds · matches {progress.matchesFound.toLocaleString()}</Typography></Box>}
          {message && <Alert severity="info">{message}</Alert>}
        </Stack></Paper>
        <Paper variant="outlined" sx={{ overflowX: 'auto' }}><Table size="small" aria-label="C8 benchmark results"><TableHead><TableRow><TableCell>Phase / status</TableCell><TableCell>Workers</TableCell><TableCell>Range</TableCell><TableCell>Elapsed</TableCell><TableCell>Seeds/sec</TableCell><TableCell>Result</TableCell><TableCell>Parity</TableCell><TableCell>Progress / RAF</TableCell><TableCell>Cancel terminal</TableCell><TableCell>Memory B/P/A</TableCell></TableRow></TableHead><TableBody>{records.map((record) => {
          const first = record.result?.matches[0]
          const parity = record.status !== 'completed' ? '—' : baseline === null ? (record.workers === 1 ? 'baseline' : 'run 1 Worker first') : resultKey(record.result!) === resultKey(baseline) ? 'pass' : 'FAIL'
          return <TableRow key={record.id}><TableCell>{record.phase}<br /><Chip size="small" label={record.status} color={record.status === 'completed' ? 'success' : record.status === 'cancelled' ? 'warning' : 'error'} /></TableCell><TableCell>{record.workers}</TableCell><TableCell>{record.range}</TableCell><TableCell>{milliseconds(record.elapsedMs)}</TableCell><TableCell>{record.seedsPerSecond?.toFixed(0) ?? '—'}</TableCell><TableCell>{classification(record.result)} / {record.result?.matches.length ?? '—'}{first ? ` (${first.baseSeed}, ${first.startSkillCounter})` : ''}</TableCell><TableCell>{parity}</TableCell><TableCell>{record.progressEvents} / {record.animationFrames}; max {milliseconds(record.longestAnimationFrameMs)}</TableCell><TableCell>{milliseconds(record.cancelToTerminalMs)}</TableCell><TableCell>{memory(record.memoryBeforeBytes)} / {memory(record.memoryPeakBytes)} / {memory(record.memoryAfterBytes)}</TableCell></TableRow>
        })}{records.length === 0 && <TableRow><TableCell colSpan={10}>No measurements yet.</TableCell></TableRow>}</TableBody></Table></Paper>
        <Typography variant="body2">Cancel testはWorkerメッセージを全childへ送信し、logical requestがterminalになるまでを記録します。cancelled record後に表のprogressまたはresultが増えないことを確認してください。Memoryは Chromium の非標準 performance.memory が利用できない場合 unavailable です。</Typography>
      </Stack>
    </PageShell>
  )
}
