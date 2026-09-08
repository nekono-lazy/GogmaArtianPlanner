import { useEffect, useRef, useState } from 'react'
import {
  Alert, Button, Chip, FormControl, InputLabel, MenuItem, Paper, Select,
  Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography,
} from '@mui/material'
import { PageShell } from '../components/PageShell'
import {
  BENCHMARK_ONLY_DEFAULT_SWEEP_BOUNDS,
  BENCHMARK_ONLY_ORCHESTRATION_BOUNDS_SWEEP,
  createPlannerOrchestrationBenchmarkInput,
  plannerOrchestrationBenchmarkWorkloads,
} from '../benchmarks/plannerOrchestrationBenchmarkFixtures'
import { runPlannerOrchestrationBenchmark } from '../benchmarks/plannerOrchestrationBrowserBenchmark'
import type { PlannerOrchestrationBounds } from '../domain/planner'
import { defaultConstrainedEnumerationBounds } from '../domain/search'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../domain/rng/production/productionRngEngine'

type RunPhase = 'warm-up' | 'measurement' | 'single'

export interface PlannerOrchestrationBenchmarkRecord {
  readonly id: string
  readonly workloadId: string
  readonly phase: RunPhase
  readonly status: 'completed' | 'error'
  readonly boundsText: string
  readonly orchestrationBounds: PlannerOrchestrationBounds
  readonly roundTripMs: number
  readonly planPresent: boolean | null
  readonly planStepCount: number | null
  readonly selectedBuildListEntryCount: number | null
  readonly generatedBuildListEntryCount: number | null
  readonly conflictCount: number | null
  readonly warningKinds: readonly string[]
  readonly trialBoundReached: boolean | null
  readonly generatedBoundReached: boolean | null
  readonly rerunBoundReached: boolean | null
  readonly enumerationBoundReached: boolean | null
  readonly outcomeKey: string | null
  readonly progressEvents: number
  readonly engineVersion: string
  readonly hardwareConcurrency: number | null
  readonly userAgent: string
  readonly visibilityState: string
  readonly error: string | null
}

function boundsText(bounds: PlannerOrchestrationBounds): string {
  return `${bounds.maxCandidateTrialsPerConflict}/${bounds.maxGeneratedBuildListEntries}/${bounds.maxPlannerReruns}`
}

function milliseconds(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)} ms`
}

export interface PlannerOrchestrationBenchmarkRunOptions {
  readonly workloadId: string
  readonly phase: RunPhase
  readonly orchestrationBounds: PlannerOrchestrationBounds
}

/**
 * B8-E1 Planner orchestration Browser benchmark harness page.
 *
 * Unlinked from the normal application, exactly like the C5-E2C8, B5, and
 * B8-B2 harnesses. It drives the real Production Planner Worker Client, so the
 * measured path is `planner.worker.entry.ts` running the real Production
 * adapter, the B8-B2 enumeration bounds, the real B8-C4b orchestration, and an
 * unmodified `ProductionRngEngine`.
 *
 * The three orchestration bounds below are a **measurement grid**, not
 * Production defaults, and this page must never be reachable from the normal
 * application. B8-D2b wires `createConstrainedPlan()` into `BuildListPage`; it
 * does not add bounds inputs there.
 */
export function PlannerOrchestrationBenchmarkPage() {
  const [workloadId, setWorkloadId] = useState(
    plannerOrchestrationBenchmarkWorkloads[0].id,
  )
  const [trials, setTrials] = useState(
    BENCHMARK_ONLY_DEFAULT_SWEEP_BOUNDS.maxCandidateTrialsPerConflict,
  )
  const [generated, setGenerated] = useState(
    BENCHMARK_ONLY_DEFAULT_SWEEP_BOUNDS.maxGeneratedBuildListEntries,
  )
  const [reruns, setReruns] = useState(
    BENCHMARK_ONLY_DEFAULT_SWEEP_BOUNDS.maxPlannerReruns,
  )
  const [measurements, setMeasurements] = useState(3)
  const [records, setRecords] = useState<
    readonly PlannerOrchestrationBenchmarkRecord[]
  >([])
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const recordsRef = useRef<readonly PlannerOrchestrationBenchmarkRecord[]>([])

  const append = (record: PlannerOrchestrationBenchmarkRecord) => {
    recordsRef.current = [...recordsRef.current, record]
    setRecords(recordsRef.current)
    return record
  }

  const currentBounds = (): PlannerOrchestrationBounds => ({
    maxCandidateTrialsPerConflict: trials,
    maxGeneratedBuildListEntries: generated,
    maxPlannerReruns: reruns,
  })

  const run = async (
    options: PlannerOrchestrationBenchmarkRunOptions,
  ): Promise<PlannerOrchestrationBenchmarkRecord> => {
    setRunning(true)
    const requestId = `b8e1-${options.phase}-${options.workloadId}-${crypto.randomUUID()}`
    try {
      // One fresh Production Planner Worker Client per run, created and
      // disposed inside this call.
      const result = await runPlannerOrchestrationBenchmark({
        requestId,
        workloadId: options.workloadId,
        orchestrationBounds: options.orchestrationBounds,
      })
      return append({
        id: requestId,
        workloadId: options.workloadId,
        phase: options.phase,
        status: result.status,
        boundsText: boundsText(result.orchestrationBounds),
        orchestrationBounds: result.orchestrationBounds,
        roundTripMs: result.roundTripMs,
        planPresent: result.outcome?.planPresent ?? null,
        planStepCount: result.outcome?.planStepCount ?? null,
        selectedBuildListEntryCount:
          result.outcome?.selectedBuildListEntryIds.length ?? null,
        generatedBuildListEntryCount: result.generatedBuildListEntryCount,
        conflictCount: result.conflictCount,
        warningKinds: result.outcome?.warningKinds ?? [],
        trialBoundReached: result.boundFlags?.trialBoundReached ?? null,
        generatedBoundReached: result.boundFlags?.generatedBoundReached ?? null,
        rerunBoundReached: result.boundFlags?.rerunBoundReached ?? null,
        enumerationBoundReached: result.boundFlags?.enumerationBoundReached ?? null,
        outcomeKey: result.outcome?.outcomeKey ?? null,
        progressEvents: result.progressEvents,
        engineVersion: result.engineVersion,
        hardwareConcurrency: navigator.hardwareConcurrency ?? null,
        userAgent: navigator.userAgent,
        visibilityState: document.visibilityState,
        error: result.error,
      })
    } finally {
      setRunning(false)
    }
  }

  const runMeasurements = async (
    workload = workloadId,
    bounds = currentBounds(),
    count = measurements,
  ) => {
    setMessage(
      `${workload} (${boundsText(bounds)}): warm-up 1回と measurement ${count}回を実行しています。`,
    )
    await run({ workloadId: workload, phase: 'warm-up', orchestrationBounds: bounds })
    for (let index = 0; index < count; index += 1) {
      await run({
        workloadId: workload,
        phase: 'measurement',
        orchestrationBounds: bounds,
      })
    }
    setMessage(`${workload} (${boundsText(bounds)}) measurements completed.`)
  }

  useEffect(() => {
    const api = {
      workloads: plannerOrchestrationBenchmarkWorkloads.map(
        ({ id, label, group, note, targets, conflictResolution }) => ({
          id,
          label,
          group,
          note,
          conflictResolution,
          targetCount: targets.length,
        }),
      ),
      fixture: (id: string) => {
        const fixture = createPlannerOrchestrationBenchmarkInput(id)
        return {
          workloadId: id,
          targetCount: fixture.input.targetWeapons.length,
          buildListEntryCount: fixture.input.buildListEntries.length,
          conflicts: fixture.initialConflicts.map((conflict) => ({
            kind: conflict.kind,
            buildListEntryIds: conflict.buildListEntryIds,
          })),
          fixedBuildListEntryIds: fixture.fixedBuildListEntryIds,
        }
      },
      run: (options: PlannerOrchestrationBenchmarkRunOptions) => run(options),
      runMeasurements: (
        workload: string,
        bounds: PlannerOrchestrationBounds,
        count: number,
      ) => runMeasurements(workload, bounds, count),
      records: () => recordsRef.current,
      clear: () => {
        recordsRef.current = []
        setRecords([])
      },
      /** Benchmark-only measurement grid; never a Production default. */
      sweep: BENCHMARK_ONLY_ORCHESTRATION_BOUNDS_SWEEP,
      environment: {
        engineVersion: PRODUCTION_RNG_ENGINE_VERSION,
        enumerationBounds: defaultConstrainedEnumerationBounds,
        hardwareConcurrency: navigator.hardwareConcurrency ?? null,
        userAgent: navigator.userAgent,
        visibilityState: document.visibilityState,
      },
    }
    ;(globalThis as unknown as { b8PlannerBenchmark?: unknown }).b8PlannerBenchmark =
      api
  })

  return (
    <PageShell
      title="B8 Planner Orchestration Browser Worker Benchmark"
      description="未リンクの設計レビュー用benchmark harnessです。通常のBuild ListやPlanner画面には影響しません。"
    >
      <Stack spacing={2}>
        <Alert severity="warning">
          Production buildで実行してください。実Production Planner Worker
          （planner.worker.entry.ts）と実ProductionRngEngineを使用します。
          ConstrainedEnumerationBoundsはWorker内のProduction adapterが供給するため、
          このページからは渡しません（現在の値: {defaultConstrainedEnumerationBounds.maxNormalForgeCount}/
          {defaultConstrainedEnumerationBounds.maxGogmaAdvance}/
          {defaultConstrainedEnumerationBounds.maxSkillResetCount}/
          {defaultConstrainedEnumerationBounds.maxOffAxisPairEvaluations}）。
        </Alert>
        <Alert severity="info">
          下の3つのboundsはB8-E2の測定用グリッドであり、Production defaultではありません。
          PlannerOrchestrationBoundsのProduction defaultはB8-E2の実測後に決定します。
        </Alert>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={2}>
            <Typography variant="body2">
              navigator.hardwareConcurrency: {navigator.hardwareConcurrency ?? 'unavailable'} ·
              Production Engine: {PRODUCTION_RNG_ENGINE_VERSION} · visibilityState:{' '}
              {document.visibilityState}
            </Typography>
            <FormControl fullWidth>
              <InputLabel id="b8e1-workload-label">Workload</InputLabel>
              <Select
                labelId="b8e1-workload-label" label="Workload" value={workloadId}
                disabled={running}
                onChange={(event) => setWorkloadId(event.target.value)}
              >
                {plannerOrchestrationBenchmarkWorkloads.map((workload) => (
                  <MenuItem key={workload.id} value={workload.id}>
                    {workload.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                fullWidth type="number" label="maxCandidateTrialsPerConflict"
                value={trials} disabled={running}
                onChange={(event) => setTrials(Math.max(1, Number(event.target.value) || 1))}
              />
              <TextField
                fullWidth type="number" label="maxGeneratedBuildListEntries"
                value={generated} disabled={running}
                onChange={(event) => setGenerated(Math.max(1, Number(event.target.value) || 1))}
              />
              <TextField
                fullWidth type="number" label="maxPlannerReruns"
                value={reruns} disabled={running}
                onChange={(event) => setReruns(Math.max(1, Number(event.target.value) || 1))}
              />
              <TextField
                fullWidth type="number" label="Measurements" value={measurements}
                disabled={running}
                onChange={(event) => setMeasurements(Math.max(1, Number(event.target.value) || 1))}
              />
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <Button variant="contained" disabled={running} onClick={() => void runMeasurements()}>
                Warm-up + measurements
              </Button>
              <Button
                variant="outlined" disabled={running}
                onClick={() =>
                  void run({
                    workloadId,
                    phase: 'single',
                    orchestrationBounds: currentBounds(),
                  })
                }
              >
                Run once
              </Button>
              <Button
                variant="outlined" disabled={running}
                onClick={() => {
                  recordsRef.current = []
                  setRecords([])
                  setMessage(null)
                }}
              >
                Clear
              </Button>
            </Stack>
            {message && <Alert severity="info">{message}</Alert>}
          </Stack>
        </Paper>
        <Paper variant="outlined" sx={{ overflowX: 'auto' }}>
          <Table size="small" aria-label="B8-E1 Planner orchestration results">
            <TableHead>
              <TableRow>
                <TableCell>Phase / status</TableCell>
                <TableCell>Workload</TableCell>
                <TableCell>Bounds T/G/R</TableCell>
                <TableCell>Round trip</TableCell>
                <TableCell>Plan / steps</TableCell>
                <TableCell>Selected / generated</TableCell>
                <TableCell>Conflicts</TableCell>
                <TableCell>Bound reached T/G/R/E</TableCell>
                <TableCell>Warnings</TableCell>
                <TableCell>Outcome key</TableCell>
                <TableCell>Progress</TableCell>
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
                      color={record.status === 'completed' ? 'success' : 'error'}
                    />
                  </TableCell>
                  <TableCell>{record.workloadId}</TableCell>
                  <TableCell>{record.boundsText}</TableCell>
                  <TableCell>{milliseconds(record.roundTripMs)}</TableCell>
                  <TableCell>
                    {record.planPresent === null ? '—' : String(record.planPresent)}
                    <br />
                    {record.planStepCount ?? '—'}
                  </TableCell>
                  <TableCell>
                    {record.selectedBuildListEntryCount ?? '—'} /{' '}
                    {record.generatedBuildListEntryCount ?? '—'}
                  </TableCell>
                  <TableCell>{record.conflictCount ?? '—'}</TableCell>
                  <TableCell>
                    {String(record.trialBoundReached)} / {String(record.generatedBoundReached)} /{' '}
                    {String(record.rerunBoundReached)} / {String(record.enumerationBoundReached)}
                  </TableCell>
                  <TableCell>
                    {record.warningKinds.length === 0 ? '—' : record.warningKinds.join(', ')}
                    {record.error !== null && <><br />{record.error}</>}
                  </TableCell>
                  <TableCell>{record.outcomeKey ?? '—'}</TableCell>
                  <TableCell>{record.progressEvents}</TableCell>
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
          Round tripはmain threadでcreateConstrainedPlan()を呼んでからPromiseがsettleするまでです。
          計測外: fixture生成 / bounds validation / Worker Client生成（new Worker(...) constructorを含む）/
          dispose / outcome digest生成。
          計測内: createConstrainedPlan() call / request postMessageとPlannerInputのstructured clone /
          最初のrequestを処理できるようになるまで残っているWorker async initialization待ち /
          Production計算 / response structured cloneと配送。
          new Worker(...) constructorは計測外なので「Worker startup全体を含む」ではありません。
          実測値をそのまま記録し、baselineやWorker起動時間の推定値を差し引きません。
          1 run = 1 fresh Production Planner Worker Clientであり、warm-upもmeasurementも
          毎回新しいWorkerで実行します。warm-upはBrowser / JIT / module cacheの安定化が目的で、
          同一Workerの状態をmeasurementへ持ち越すためではありません。
          Outcome keyはbenchmark専用のparity digestで、ProductionPlan ID・PlanStep ID・
          runtime生成OwnedWeapon ID・timestamp・ExpectedPlanState hashを除外しています。
          同一workloadかつ同一boundsのmeasurement間で一致するかを確認するためだけに使い、
          Domain semantic authorityではありません。
        </Typography>
      </Stack>
    </PageShell>
  )
}
