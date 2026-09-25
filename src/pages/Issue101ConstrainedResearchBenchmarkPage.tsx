import { useEffect, useRef, useState } from 'react'
import {
  Alert, Button, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from '@mui/material'
import { PageShell } from '../components/PageShell'
import {
  createIssue101BenchmarkHarness,
  type Issue101RunOutcome,
  type Issue101RunResult,
} from '../benchmarks/issue101ConstrainedResearchBrowserBenchmark'
import {
  createIssue101EnumerationInput,
  createIssue101OrchestrationInput,
  createIssue101RealFixture,
  ISSUE_101_BASELINE_BOUNDS,
  ISSUE_101_GOGMA_SWEEP,
  issue101GogmaBounds,
  type Issue101EnumerationWorkloadId,
  type Issue101OrchestrationVariant,
  type Issue101RealFixture,
  type Issue101ResolutionScope,
} from '../benchmarks/issue101ConstrainedResearchFixtures'
import { ISSUE_101_BENCHMARK_PROTOCOL_VERSION } from '../benchmarks/issue101ConstrainedResearchProtocol'
import { summarizeIssue101Route } from '../benchmarks/issue101RouteSummary'
import { defaultPlannerOrchestrationBounds } from '../domain/planner'
import type { PlannerOrchestrationBounds } from '../domain/planner'
import { CURRENT_CALCULATION_APP_SCHEMA_VERSION } from '../domain/models/publicTypes'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../domain/rng/production/productionRngEngine'
import type { ConstrainedEnumerationBounds } from '../domain/search'

export type Issue101RunPhase = 'warm-up' | 'measurement' | 'probe' | 'cancel'

/** One flat record, `JSON.stringify`-ready for the raw artifact. */
export interface Issue101BenchmarkRecord {
  readonly id: string
  readonly kind: 'enumeration' | 'orchestration'
  readonly workload: string
  readonly phase: Issue101RunPhase
  readonly bounds: ConstrainedEnumerationBounds
  readonly orchestrationBounds: PlannerOrchestrationBounds | null
  readonly roundTripMs: number
  readonly acceptedAtMs: number | null
  readonly outcome: Issue101RunOutcome
  readonly cancel: Issue101RunResult['cancel']
  readonly workerPings: number
  readonly longestWorkerPingMs: number | null
  readonly visibilityState: string
}

interface CommonRunOptions {
  readonly phase?: Issue101RunPhase
  readonly cancelAfterMs?: number
  /** Cancel when the Worker reports the first Candidate (trial). */
  readonly cancelOnFirstCandidate?: boolean
  /** Ping the Worker while it runs; `0` chains each ping on the previous pong. */
  readonly pingIntervalMs?: number
}

export interface Issue101EnumerationRunOptions extends CommonRunOptions {
  readonly workload: Issue101EnumerationWorkloadId
  readonly bounds: ConstrainedEnumerationBounds
  readonly stopAfterCandidates?: number
}

export interface Issue101OrchestrationRunOptions extends CommonRunOptions {
  /** `real` is the Issue #101 case; `approx_owned_dragon` the benchmark fixture. */
  readonly variant?: Issue101OrchestrationVariant
  readonly scope: Issue101ResolutionScope
  readonly bounds: ConstrainedEnumerationBounds
  readonly orchestrationBounds?: PlannerOrchestrationBounds
}

function boundsText(bounds: ConstrainedEnumerationBounds): string {
  return `${bounds.maxNormalForgeCount}/${bounds.maxGogmaAdvance}/${bounds.maxSkillResetCount}/${bounds.maxOffAxisPairEvaluations}`
}

function ms(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${value.toFixed(1)}`
}

function outcomeText(outcome: Issue101RunOutcome): string {
  switch (outcome.status) {
    case 'enumeration_completed': {
      const { measurement: m } = outcome
      return `delivered ${m.deliveredCandidates}, examined ${m.summary.examinedCandidates}, off-axis ${m.summary.evaluatedOffAxisPairs}, exhausted ${m.summary.exhausted}, bound ${m.summary.stoppedByBound}, consumer ${m.stoppedByConsumer}`
    }
    case 'orchestration_completed': {
      const { measurement: m } = outcome
      return `trials ${m.candidateTrials}, plans ${m.planGenerations}, adopted #${m.adoptedCandidateOrdinal ?? '—'}, generated ${m.generatedBuildListEntryCount}, conflicts ${m.conflicts.length}, warnings [${m.warningKinds.join(', ')}], ${m.terminationStatus}`
    }
    case 'cancelled':
      return `cancelled after ${outcome.deliveredCandidates} (asResult ${outcome.settledAsResult})`
    case 'error':
      return `error: ${outcome.message}`
  }
}

function workerMs(outcome: Issue101RunOutcome): number | null {
  switch (outcome.status) {
    case 'enumeration_completed':
    case 'orchestration_completed':
      return outcome.measurement.workerElapsedMs
    case 'cancelled':
      return outcome.workerElapsedMs
    case 'error':
      return null
  }
}

/**
 * Issue #101 constrained re-search Browser Worker benchmark.
 *
 * Unlinked from the normal application. It is driven from the console through
 * `globalThis.i101Benchmark`; the buttons only cover the baseline smoke runs.
 * The real fixture runs two real Candidate Searches on the main thread once
 * and is cached, outside every measurement.
 */
export function Issue101ConstrainedResearchBenchmarkPage() {
  const [records, setRecords] = useState<readonly Issue101BenchmarkRecord[]>([])
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const recordsRef = useRef<readonly Issue101BenchmarkRecord[]>([])
  const fixtureRef = useRef(new Map<Issue101OrchestrationVariant, Promise<Issue101RealFixture>>())

  const fixture = (variant: Issue101OrchestrationVariant = 'real') => {
    let cached = fixtureRef.current.get(variant)
    if (cached === undefined) {
      cached = createIssue101RealFixture(variant)
      fixtureRef.current.set(variant, cached)
    }
    return cached
  }

  const append = (record: Issue101BenchmarkRecord) => {
    recordsRef.current = [...recordsRef.current, record]
    setRecords(recordsRef.current)
    return record
  }

  const execute = async (
    kind: Issue101BenchmarkRecord['kind'],
    workload: string,
    options: CommonRunOptions,
    bounds: ConstrainedEnumerationBounds,
    orchestrationBounds: PlannerOrchestrationBounds | null,
    start: (harness: ReturnType<typeof createIssue101BenchmarkHarness>, requestId: string) => Promise<Issue101RunResult>,
  ) => {
    setRunning(true)
    const requestId = `i101-${kind}-${crypto.randomUUID()}`
    const harness = createIssue101BenchmarkHarness()
    const pings: number[] = []
    let stopPings = false
    const pingLoop = async () => {
      while (!stopPings) {
        const latency = await harness.ping(120_000)
        if (latency !== null) pings.push(latency)
        const interval = options.pingIntervalMs ?? 0
        if (interval > 0) await new Promise((resolve) => globalThis.setTimeout(resolve, interval))
      }
    }
    if (options.pingIntervalMs !== undefined) void pingLoop()
    let result: Issue101RunResult
    try {
      result = await start(harness, requestId)
    } finally {
      stopPings = true
      harness.dispose()
      setRunning(false)
    }
    return append({
      id: requestId,
      kind,
      workload,
      phase: options.phase ?? 'measurement',
      bounds,
      orchestrationBounds,
      roundTripMs: result.roundTripMs,
      acceptedAtMs: result.acceptedAtMs,
      outcome: result.outcome,
      cancel: result.cancel,
      workerPings: pings.length,
      longestWorkerPingMs: pings.length === 0 ? null : Math.max(...pings),
      visibilityState: document.visibilityState,
    })
  }

  const runEnumeration = (options: Issue101EnumerationRunOptions) => {
    // Built before the harness exists, so invalid bounds never start a Worker.
    const input = createIssue101EnumerationInput(options.workload, options.bounds)
    return execute('enumeration', options.workload, options, options.bounds, null, (harness, requestId) =>
      harness.run({
        kind: 'enumeration',
        requestId,
        input,
        stopAfterCandidates: options.stopAfterCandidates,
        cancelAfterMs: options.cancelAfterMs,
        cancelOnFirstCandidate: options.cancelOnFirstCandidate,
      }),
    )
  }

  const runOrchestration = async (options: Issue101OrchestrationRunOptions) => {
    const variant = options.variant ?? 'real'
    const input = createIssue101OrchestrationInput(await fixture(variant), options.scope)
    const orchestrationBounds = options.orchestrationBounds ?? defaultPlannerOrchestrationBounds
    return execute(
      'orchestration',
      `issue101_${variant}_${options.scope}`,
      options,
      options.bounds,
      orchestrationBounds,
      (harness, requestId) =>
        harness.run({
          kind: 'orchestration',
          requestId,
          input,
          enumerationBounds: options.bounds,
          orchestrationBounds,
          cancelAfterMs: options.cancelAfterMs,
          cancelOnFirstCandidate: options.cancelOnFirstCandidate,
        }),
    )
  }

  const smoke = async () => {
    setMessage('Baseline 40/30/100/500: enumeration と orchestration を1回ずつ実行しています。')
    await runEnumeration({ workload: 'issue101_real_fire', bounds: ISSUE_101_BASELINE_BOUNDS, phase: 'probe' })
    await runOrchestration({ scope: 'primary', bounds: ISSUE_101_BASELINE_BOUNDS, phase: 'probe' })
    setMessage('Baseline smoke completed.')
  }

  useEffect(() => {
    const api = {
      protocolVersion: ISSUE_101_BENCHMARK_PROTOCOL_VERSION,
      baselineBounds: ISSUE_101_BASELINE_BOUNDS,
      gogmaSweep: ISSUE_101_GOGMA_SWEEP,
      gogmaBounds: issue101GogmaBounds,
      defaultOrchestrationBounds: defaultPlannerOrchestrationBounds,
      fixture: async (variant: Issue101OrchestrationVariant = 'real') => {
        const value = await fixture(variant)
        return {
          variant,
          fireEntryId: value.fireEntry.id,
          dragonEntryId: value.dragonEntry.id,
          fireRoute: summarizeIssue101Route(value.fireCandidate.route, value.fireCandidate),
          dragonRoute: summarizeIssue101Route(value.dragonCandidate.route, value.dragonCandidate),
          initialConflicts: value.initialConflicts.map(({ id, kind, reason }) => ({ id, kind, reason })),
        }
      },
      runEnumeration,
      runOrchestration,
      records: () => recordsRef.current,
      clear: () => {
        recordsRef.current = []
        setRecords([])
      },
      environment: () => ({
        userAgent: navigator.userAgent,
        hardwareConcurrency: navigator.hardwareConcurrency ?? null,
        visibilityState: document.visibilityState,
        engineVersion: PRODUCTION_RNG_ENGINE_VERSION,
        calculationAppSchemaVersion: CURRENT_CALCULATION_APP_SCHEMA_VERSION,
      }),
    }
    ;(globalThis as unknown as { i101Benchmark?: unknown }).i101Benchmark = api
  })

  return (
    <PageShell
      title="Issue #101 Constrained Re-search Browser Worker Benchmark"
      description="未リンクの計測用harnessです。通常のSearch画面・Planner・Production Workerには影響しません。"
    >
      <Stack spacing={2}>
        <Alert severity="warning">
          Production buildで実行してください。Issue #101: Charge Blade 火 / 龍、Base Seed 51231782、
          Skill Counter 341、Gogma Counter 55、Normal Counter 0。計測は console の
          globalThis.i101Benchmark から行います。
        </Alert>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={2}>
            <Typography variant="body2">
              hardwareConcurrency: {navigator.hardwareConcurrency ?? 'unavailable'} · Engine:{' '}
              {PRODUCTION_RNG_ENGINE_VERSION} · Calculation schema: {CURRENT_CALCULATION_APP_SCHEMA_VERSION}
            </Typography>
            <Button variant="contained" disabled={running} onClick={() => void smoke()}>
              Baseline smoke (40/30/100/500)
            </Button>
            {message && <Alert severity="info">{message}</Alert>}
          </Stack>
        </Paper>
        <Paper variant="outlined" sx={{ overflowX: 'auto' }}>
          <Table size="small" aria-label="Issue 101 benchmark results">
            <TableHead>
              <TableRow>
                <TableCell>Kind / phase</TableCell>
                <TableCell>Workload</TableCell>
                <TableCell>N/G/S/O</TableCell>
                <TableCell>Worker ms</TableCell>
                <TableCell>Round trip ms</TableCell>
                <TableCell>Outcome</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {records.map((record) => (
                <TableRow key={record.id}>
                  <TableCell>{record.kind} / {record.phase}</TableCell>
                  <TableCell>{record.workload}</TableCell>
                  <TableCell>{boundsText(record.bounds)}</TableCell>
                  <TableCell>{ms(workerMs(record.outcome))}</TableCell>
                  <TableCell>{ms(record.roundTripMs)}</TableCell>
                  <TableCell>{outcomeText(record.outcome)}</TableCell>
                </TableRow>
              ))}
              {records.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6}>No measurements yet.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Paper>
      </Stack>
    </PageShell>
  )
}
