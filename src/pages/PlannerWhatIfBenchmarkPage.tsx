import { useEffect, useRef, useState } from 'react'
import { Alert, Button, FormControl, InputLabel, MenuItem, Paper, Select, Stack, TextField, Typography } from '@mui/material'
import { PageShell } from '../components/PageShell'
import { BENCHMARK_ONLY_WHAT_IF_BOUNDS_SWEEP, createPlannerWhatIfBenchmarkFixture, plannerWhatIfBenchmarkWorkloads } from '../benchmarks/plannerWhatIfBenchmarkFixtures'
import { runPlannerWhatIfBenchmark, type PlannerWhatIfBenchmarkRunResult } from '../benchmarks/plannerWhatIfBrowserBenchmark'
import type { PlannerWhatIfBounds } from '../domain/planner'
import { defaultConstrainedEnumerationBounds } from '../domain/search'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../domain/rng/production/productionRngEngine'

type Phase = 'warm-up' | 'measurement' | 'single'
interface RunOptions { workloadId: string; phase: Phase; bounds: PlannerWhatIfBounds }

function environment() {
  return {
    engineVersion: PRODUCTION_RNG_ENGINE_VERSION,
    // Metadata only, never part of the benchmark request.
    enumerationBounds: { ...defaultConstrainedEnumerationBounds },
    hardwareConcurrency: navigator.hardwareConcurrency ?? null,
    userAgent: navigator.userAgent,
    visibilityState: document.visibilityState,
  }
}

export interface PlannerWhatIfBenchmarkRecord extends PlannerWhatIfBenchmarkRunResult {
  readonly phase: Phase
  readonly environment: ReturnType<typeof environment>
  readonly visibilityStateAtEnd: string
}

export interface PlannerWhatIfBenchmarkApi {
  workloads: () => typeof plannerWhatIfBenchmarkWorkloads
  fixture: typeof createPlannerWhatIfBenchmarkFixture
  run: (options: RunOptions) => Promise<PlannerWhatIfBenchmarkRecord>
  runMeasurements: (workloadId: string, bounds: PlannerWhatIfBounds, count: number) => Promise<readonly PlannerWhatIfBenchmarkRecord[]>
  records: () => readonly PlannerWhatIfBenchmarkRecord[]
  clear: () => void
  sweep: typeof BENCHMARK_ONLY_WHAT_IF_BOUNDS_SWEEP
  environment: ReturnType<typeof environment>
}

declare global {
  var b9WhatIfBenchmark: PlannerWhatIfBenchmarkApi | undefined
}

/** Isolated measurement UI; never wired to the normal application or persistence. */
export function PlannerWhatIfBenchmarkPage() {
  const [workloadId, setWorkloadId] = useState<string>(plannerWhatIfBenchmarkWorkloads[0].id)
  // First grid point only: no proposed Production default or hidden fallback.
  const [trials, setTrials] = useState<string>('1')
  const [reruns, setReruns] = useState<string>('1')
  const [count, setCount] = useState('3')
  const [records, setRecords] = useState<readonly PlannerWhatIfBenchmarkRecord[]>([])
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const recordsRef = useRef<readonly PlannerWhatIfBenchmarkRecord[]>([])
  const busy = useRef(false)
  const mounted = useRef(false)

  useEffect(() => {
    mounted.current = true
    const single = async (options: RunOptions): Promise<PlannerWhatIfBenchmarkRecord> => {
      const startEnvironment = environment()
      const result = await runPlannerWhatIfBenchmark({
        requestId: `b9b2-${options.phase}-${crypto.randomUUID()}`,
        workloadId: options.workloadId, bounds: options.bounds,
      })
      const record = { ...result, phase: options.phase, environment: startEnvironment,
        visibilityStateAtEnd: document.visibilityState }
      recordsRef.current = [...recordsRef.current, record]
      if (mounted.current) setRecords(recordsRef.current)
      return record
    }
    const exclusive = async <T,>(operation: () => Promise<T>): Promise<T> => {
      if (!mounted.current) throw new Error('Benchmark page is no longer mounted.')
      if (busy.current) throw new Error('A benchmark run is already in progress.')
      busy.current = true
      setRunning(true)
      setError(null)
      try { return await operation() }
      catch (failure) {
        if (mounted.current) setError(failure instanceof Error ? failure.message : String(failure))
        throw failure
      } finally {
        busy.current = false
        if (mounted.current) setRunning(false)
      }
    }
    const api: PlannerWhatIfBenchmarkApi = {
      workloads: () => structuredClone(plannerWhatIfBenchmarkWorkloads),
      fixture: createPlannerWhatIfBenchmarkFixture,
      run: (options) => exclusive(() => single(options)),
      runMeasurements: (id, bounds, measurements) => exclusive(async () => {
        if (!Number.isSafeInteger(measurements) || measurements < 1) {
          throw new RangeError('Measurement count must be a positive safe integer.')
        }
        const batchBounds = { ...bounds }
        const results = []
        // The batch keeps its lock across every fresh Worker, including warm-up.
        for (let index = 0; index <= measurements; index += 1) {
          if (!mounted.current) throw new Error('Benchmark page was unmounted; batch stopped.')
          const result = await single({ workloadId: id, bounds: batchBounds,
            phase: index === 0 ? 'warm-up' : 'measurement' })
          results.push(result)
          if (result.status === 'error') throw new Error(result.error ?? 'Worker request failed.')
        }
        return results
      }),
      records: () => structuredClone(recordsRef.current),
      clear: () => {
        if (busy.current) throw new Error('Cannot clear during a benchmark run.')
        recordsRef.current = []
        if (mounted.current) setRecords([])
      },
      sweep: BENCHMARK_ONLY_WHAT_IF_BOUNDS_SWEEP,
      environment: environment(),
    }
    globalThis.b9WhatIfBenchmark = api
    return () => {
      mounted.current = false
      if (globalThis.b9WhatIfBenchmark === api) delete globalThis.b9WhatIfBenchmark
    }
  }, [])

  const bounds = (): PlannerWhatIfBounds => ({
    maxCandidateTrialsPerCategoryPerTarget: Number(trials), maxPlannerReruns: Number(reruns),
  })
  // API errors are surfaced by exclusive(); UI handlers consume the rejection.
  const runFromUi = (batch: boolean) => {
    const api = globalThis.b9WhatIfBenchmark
    if (!api) return
    void (batch ? api.runMeasurements(workloadId, bounds(), Number(count))
      : api.run({ workloadId, phase: 'single', bounds: bounds() })).catch(() => undefined)
  }

  return (
    <PageShell title="B9 What-if Browser Worker Benchmark" description="B9-B2a: 未リンクの計測専用harness。実Browser測定はB9-B2bで実施します。">
      <Stack spacing={2}>
        <Alert severity="warning">Production buildと実Production Planner Workerを使用します。下の値はmeasurement grid onlyであり、Production defaultではありません。Production defaultはUNDECIDEDです。</Alert>
        <Alert severity="info">1 run = 1 fresh Worker。warm-up 1回 + measurement N回を順次実行します。Practical / Idealの結果は排他categoryごとに記録します。</Alert>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={2}>
            <Typography>{PRODUCTION_RNG_ENGINE_VERSION} · concurrency: {navigator.hardwareConcurrency}</Typography>
            <FormControl fullWidth>
              <InputLabel id="b9-workload-label">Workload</InputLabel>
              <Select labelId="b9-workload-label" label="Workload" value={workloadId} disabled={running} onChange={(event) => setWorkloadId(event.target.value)}>
                {plannerWhatIfBenchmarkWorkloads.map((workload) => <MenuItem key={workload.id} value={workload.id}>{workload.label}</MenuItem>)}
              </Select>
            </FormControl>
            <TextField label="maxCandidateTrialsPerCategoryPerTarget" type="number" value={trials} disabled={running} onChange={(event) => setTrials(event.target.value)} />
            <TextField label="maxPlannerReruns" type="number" value={reruns} disabled={running} onChange={(event) => setReruns(event.target.value)} />
            <TextField label="Measurements" type="number" value={count} disabled={running} onChange={(event) => setCount(event.target.value)} />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <Button disabled={running} variant="contained" onClick={() => runFromUi(true)}>Warm-up + measurements</Button>
              <Button disabled={running} onClick={() => runFromUi(false)}>Run once</Button>
              <Button disabled={running} onClick={() => globalThis.b9WhatIfBenchmark?.clear()}>Clear</Button>
            </Stack>
            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        </Paper>
        <Typography variant="body2">roundTripMs: createWhatIfComparison() callからPromise settleまで。postMessage、structured clone、request時点で残るWorker async initialization、Production enumeration / materialization / preflight / Beam Search / Trace Replayと配送を含みます。fixture生成、bounds validation、new Worker constructor、dispose、outcome normalization、表示は計測外です。enumeration boundsはWorker内のProduction adapterが供給します。</Typography>
        {records.length === 0 && <Typography>No measurements yet.</Typography>}
        {records.map((record) => (
          <Paper key={record.requestId} variant="outlined" sx={{ p: 2, overflowX: 'auto' }}>
            <Typography>{record.phase} · {record.workloadId} · T/R {record.bounds.maxCandidateTrialsPerCategoryPerTarget}/{record.bounds.maxPlannerReruns} · {record.status} · {record.roundTripMs.toFixed(1)} ms</Typography>
            <Typography variant="body2">Progress events: {record.progressEvents}</Typography>
            {record.error && <Alert severity="error">{record.error}</Alert>}
            <pre>{JSON.stringify(record.outcome, null, 2)}</pre>
          </Paper>
        ))}
        <Typography variant="body2">保存: JSON.stringify(b9WhatIfBenchmark.records(), null, 2)。outcomeKeyは同一workload / boundsのsemantic parity確認専用です。B9_B2_BROWSER_RAW_RESULTS.jsonへの保存はB9-B2bで行います。</Typography>
      </Stack>
    </PageShell>
  )
}
