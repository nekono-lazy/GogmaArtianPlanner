import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material'
import { PageShell } from '../components/PageShell'
import { PHASE2A_RESEARCH_MAX_PLAN_STEPS } from '../benchmarks/plannerGlobalBrowserBenchmarkRunner'
import { globalResearchInputFromExport } from '../benchmarks/plannerGlobalOptimizationResearch'
import type { Phase2C25BFileInfo, Phase2C25BPreparation, Phase2C25BRunRecord, Phase2C25BRunRequest } from '../benchmarks/plannerGlobalPhase2C25BHarness'
import { phase2c25bRepeatDecision } from '../benchmarks/plannerGlobalPhase2C25BHarness'
import type { Phase2C25BMode } from '../benchmarks/plannerGlobalPhase2C25BProtocol'
import type { Phase2C25D2EWorkloadContext } from '../benchmarks/plannerGlobalPhase2C25D2E'
import { createPhase2C25D2ERunner, type Phase2C25D2EReferenceInfo } from '../benchmarks/plannerGlobalPhase2C25D2EHarness'
import {
  PHASE2C25D2E_CANDIDATE_STOP_BOUND,
  PHASE2C25D2E_CDP_SAMPLE_INTERVAL_MS,
  PHASE2C25D2E_DRIVER_RUN_BUDGET_MS,
  PHASE2C25D2E_PROTOCOL_VERSION,
  PHASE2C25D2E_RUN_BUDGET_MS,
  PHASE2C25D2E_SNAPSHOT_POLICY,
} from '../benchmarks/plannerGlobalPhase2C25D2EProtocol'
import { CURRENT_CALCULATION_APP_SCHEMA_VERSION } from '../domain/models/publicTypes'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../domain/rng/production/productionRngEngine'
import { defaultPlannerAlternativeSearchExtent } from '../domain/search'

declare const __PLANNER_GLOBAL_BENCHMARK_BUILD__: unknown

/** Provenance injected by `vite.benchmark.config.ts` at build time; null in dev / tests. */
function benchmarkBuild(): unknown {
  return typeof __PLANNER_GLOBAL_BENCHMARK_BUILD__ === 'undefined' ? null : __PLANNER_GLOBAL_BENCHMARK_BUILD__
}

const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('')
const sha256Bytes = async (bytes: ArrayBuffer) => hex(await crypto.subtle.digest('SHA-256', bytes))
const sha256 = async (text: string) => sha256Bytes(new TextEncoder().encode(text).buffer as ArrayBuffer)
const seconds = (ms: number | null | undefined) => ms === null || ms === undefined ? '—' : (ms / 1000).toFixed(1)

export interface PlannerGlobalPhase2C25D2EBenchmarkGlobal {
  readonly protocolVersion: string
  environment(): Record<string, unknown>
  d2dReferenceInfo(): Phase2C25D2EReferenceInfo | null
  exportInfo(): Phase2C25BFileInfo | null
  evidenceInfo(): Phase2C25BFileInfo | null
  prepare(): Promise<Phase2C25BPreparation>
  parity(): Phase2C25BPreparation | null
  selectedContexts(): Phase2C25D2EWorkloadContext[]
  runContext(request: Phase2C25BRunRequest): Promise<Phase2C25BRunRecord>
  startRun(request: Phase2C25BRunRequest): string
  runFormalSeries(): Promise<Phase2C25BRunRecord[]>
  repeatDecision: typeof phase2c25bRepeatDecision
  activeRun(): { runKey: string; startedAtEpochMs: number; phase: string } | null
  busy(): string | null
  abortActive(reason: string): boolean
  record(runKey: string): Phase2C25BRunRecord | null
  records(): Phase2C25BRunRecord[]
  clear(): void
  exportJson(): string
}

declare global {
  var plannerGlobalPhase2C25D2EBenchmark: PlannerGlobalPhase2C25D2EBenchmarkGlobal | undefined
}

type HighEntropy = Record<string, unknown> | null

/**
 * Issue #154 Global Planner Research Phase 2-C2.5-D2-e Browser Worker benchmark (Research only).
 *
 * Unlinked from the normal application (`benchmark.html` only). The inputs are the committed D2-d RESULT (loaded first:
 * formal reference checks, workload confirmation), the original Export and the committed Phase 2-C2.5-A evidence; the
 * Export is validated with the pure Research path, never imported into IndexedDB, and never persisted. The evidence and the
 * D2-d RESULT select / confirm the 5-context workload and are the parity reference only. Every Search run starts a fresh
 * Worker. The console API `globalThis.plannerGlobalPhase2C25D2EBenchmark` exists only while the page is mounted.
 */
export function PlannerGlobalPhase2C25D2EBenchmarkPage() {
  const [records, setRecords] = useState<readonly Phase2C25BRunRecord[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [referenceInfo, setReferenceInfo] = useState<Phase2C25D2EReferenceInfo | null>(null)
  const [exportInfo, setExportInfo] = useState<Phase2C25BFileInfo | null>(null)
  const [evidenceInfo, setEvidenceInfo] = useState<Phase2C25BFileInfo | null>(null)
  const [preparation, setPreparation] = useState<Phase2C25BPreparation | null>(null)
  const [workload, setWorkload] = useState<readonly Phase2C25D2EWorkloadContext[]>([])
  const [selected, setSelected] = useState('')
  const [mode, setMode] = useState<Phase2C25BMode>('minimal')
  const [message, setMessage] = useState<string | null>(null)
  const highEntropy = useRef<HighEntropy>(null)

  const runner = useMemo(() => {
    const created = createPhase2C25D2ERunner({
      sha256, sha256Bytes,
      buildInput: json => ({ input: globalResearchInputFromExport(json, PHASE2A_RESEARCH_MAX_PLAN_STEPS), maxPlanSteps: PHASE2A_RESEARCH_MAX_PLAN_STEPS }),
      onChange: () => {
        setRecords(created.records())
        setBusy(created.busy())
        setReferenceInfo(created.d2dReferenceInfo())
        setExportInfo(created.exportInfo())
        setEvidenceInfo(created.evidenceInfo())
        setPreparation(created.preparation())
      },
    })
    return created
  }, [])

  useEffect(() => {
    const data = (navigator as Navigator & { userAgentData?: { getHighEntropyValues(hints: string[]): Promise<Record<string, unknown>> } }).userAgentData
    void data?.getHighEntropyValues(['architecture', 'bitness', 'platformVersion', 'fullVersionList', 'model']).then(values => { highEntropy.current = values }).catch(() => undefined)
  }, [])

  const environment = useMemo(() => () => {
    const nav = navigator as Navigator & { deviceMemory?: number }
    const memory = (performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } }).memory
    return {
      userAgent: navigator.userAgent, userAgentData: highEntropy.current, hardwareConcurrency: navigator.hardwareConcurrency ?? null, deviceMemory: nav.deviceMemory ?? null,
      crossOriginIsolated: globalThis.crossOriginIsolated ?? null, isSecureContext: globalThis.isSecureContext ?? null, visibilityState: document.visibilityState,
      mainRealmPerformanceMemory: memory ? { usedJSHeapSize: memory.usedJSHeapSize, totalJSHeapSize: memory.totalJSHeapSize, jsHeapSizeLimit: memory.jsHeapSizeLimit } : null,
      location: location.href, benchmarkBuild: benchmarkBuild(), rngEngineVersion: PRODUCTION_RNG_ENGINE_VERSION,
      calculationAppSchemaVersion: CURRENT_CALCULATION_APP_SCHEMA_VERSION, protocolVersion: PHASE2C25D2E_PROTOCOL_VERSION,
      searchExtent: { ...defaultPlannerAlternativeSearchExtent }, candidateStopBound: PHASE2C25D2E_CANDIDATE_STOP_BOUND, snapshotPolicy: { ...PHASE2C25D2E_SNAPSHOT_POLICY },
      cdpSampleIntervalMs: PHASE2C25D2E_CDP_SAMPLE_INTERVAL_MS, runBudgetMs: PHASE2C25D2E_RUN_BUDGET_MS, driverRunBudgetMs: PHASE2C25D2E_DRIVER_RUN_BUDGET_MS,
      researchMaxPlanSteps: PHASE2A_RESEARCH_MAX_PLAN_STEPS,
      yield: 'MessageChannel macrotask (benchmarkWorkerYield)', workerPolicy: 'one fresh Dedicated Worker per run',
      runtimeInput: 'original Export (Search input) + Phase 2-C2.5-A evidence (workload selection and parity only) + D2-d RESULT (workload confirmation only)',
    }
  }, [])

  const refreshWorkload = () => { try { setWorkload(runner.selectedContexts()) } catch { setWorkload([]) } }

  useEffect(() => {
    const api: PlannerGlobalPhase2C25D2EBenchmarkGlobal = {
      protocolVersion: PHASE2C25D2E_PROTOCOL_VERSION,
      environment,
      d2dReferenceInfo: () => runner.d2dReferenceInfo(),
      exportInfo: () => runner.exportInfo(),
      evidenceInfo: () => runner.evidenceInfo(),
      prepare: () => runner.prepare(),
      parity: () => runner.preparation(),
      selectedContexts: () => runner.selectedContexts(),
      runContext: request => runner.runContext(request),
      startRun: request => runner.startRun(request),
      runFormalSeries: () => runner.runFormalSeries(),
      repeatDecision: phase2c25bRepeatDecision,
      activeRun: () => runner.activeRun(),
      busy: () => runner.busy(),
      abortActive: reason => runner.abortActive(reason),
      record: runKey => runner.record(runKey),
      records: () => runner.records(),
      clear: () => runner.clear(),
      exportJson: () => runner.exportJson(environment()),
    }
    globalThis.plannerGlobalPhase2C25D2EBenchmark = api
    return () => {
      runner.abortActive('page unmounted')
      if (globalThis.plannerGlobalPhase2C25D2EBenchmark === api) delete globalThis.plannerGlobalPhase2C25D2EBenchmark
    }
  }, [runner, environment])

  const start = (task: () => Promise<unknown>) => {
    setMessage(null)
    void task().catch((error: unknown) => setMessage(error instanceof Error ? error.message : String(error)))
  }

  const choose = (kind: 'd2d' | 'export' | 'evidence', file: File | undefined) => {
    if (!file) return
    start(async () => {
      const bytes = await file.arrayBuffer()
      if (kind === 'd2d') await runner.loadD2DReference(bytes, file.name)
      else if (kind === 'export') await runner.loadExport(bytes, file.name)
      else { await runner.loadEvidence(bytes, file.name); refreshWorkload() }
      if (runner.exportInfo() && runner.evidenceInfo()) await runner.prepare()
    })
  }

  const download = () => {
    const blob = new Blob([runner.exportJson(environment())], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `planner-global-phase2c25d2e-browser_${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const ready = busy === null && preparation?.status === 'ok'
  const single = workload.find(c => `${c.orientationId}#${c.workIndex}` === selected) ?? null
  return (
    <PageShell title="Global Planner Research Phase 2-C2.5-D2-e" description="Issue #154 Research-only Browser Worker re-measurement after the D2-d single-pass held-aware Bonus stream (H1). Production behavior is unchanged; nothing is persisted.">
      <Stack spacing={2}>
        <Alert severity="info">
          先にPhase 2-C2.5-D2-d RESULTを選び（formal reference確認）、次にoriginal ExportとPhase 2-C2.5-A evidenceを選ぶと、D2-bと同じ規則で5 contextを選んで
          D2-d RESULTのworkloadと照合し、このpageで元ExportからSearch contextを再導出してevidenceとのparityを確認します。D2-d RESULTとevidenceはworkload選択・照合と
          parityだけに使い、Workerへは渡しません。各runは新しいDedicated Workerで実行され、1 SearchのbudgetはD2-bと同じ20分です。
        </Alert>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={1}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <Button variant="outlined" component="label" disabled={busy !== null || exportInfo !== null || evidenceInfo !== null}>
                D2-d RESULTを選択
                <input id="pg2c25d2e-d2d-file" hidden type="file" accept="application/json,.json" onChange={event => choose('d2d', event.target.files?.[0])} />
              </Button>
              <Button variant="outlined" component="label" disabled={busy !== null || referenceInfo === null}>
                original Exportを選択
                <input id="pg2c25d2e-export-file" hidden type="file" accept="application/json,.json" onChange={event => choose('export', event.target.files?.[0])} />
              </Button>
              <Button variant="outlined" component="label" disabled={busy !== null || referenceInfo === null}>
                Phase 2-C2.5-A evidenceを選択
                <input id="pg2c25d2e-evidence-file" hidden type="file" accept="application/json,.json" onChange={event => choose('evidence', event.target.files?.[0])} />
              </Button>
            </Stack>
            {referenceInfo && (
              <Typography variant="body2">
                D2-d RESULT: {referenceInfo.fileName} / {referenceInfo.byteSize.toLocaleString()} bytes / SHA-256 {referenceInfo.sha256} / measured HEAD {referenceInfo.measuredHead}
                {' '}/ formal {String(referenceInfo.validation.formal)}、formalRunValidation {String(referenceInfo.validation.formalRunValidationValid)}、contexts {referenceInfo.validation.contexts}、
                primary OOM脱出 {referenceInfo.validation.primaryLeftOom}、primary正常終了 {referenceInfo.validation.primaryEndedNormally}
              </Typography>
            )}
            {exportInfo && <Typography variant="body2">Export: {exportInfo.fileName} / {exportInfo.byteSize.toLocaleString()} bytes / SHA-256 {exportInfo.sha256}</Typography>}
            {evidenceInfo && <Typography variant="body2">Evidence: {evidenceInfo.fileName} / {evidenceInfo.byteSize.toLocaleString()} bytes / SHA-256 {evidenceInfo.sha256}</Typography>}
            {workload.length > 0 && <Typography variant="body2">workload: {workload.map(c => `${c.orientationId}#${c.workIndex}（${c.selectionRole} / D2-d ${c.d2dRole}）`).join(' / ')}</Typography>}
            {preparation && (
              <Alert severity={preparation.status === 'ok' ? 'success' : 'error'}>
                preparation {preparation.status}: Export SHA一致 {String(preparation.exportShaMatchesEvidence)}、context parity{' '}
                {preparation.parity ? `${preparation.parity.rows.filter(r => r.matches).length} / ${preparation.parity.rows.length}` : '—'}、
                baseline {seconds(preparation.contextsWorker?.baselineElapsedMs)} s{preparation.message ? `（${preparation.message}）` : ''}
              </Alert>
            )}
          </Stack>
        </Paper>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <TextField select size="small" label="context" value={selected} onChange={event => setSelected(event.target.value)} sx={{ minWidth: 220 }}>
            {workload.map(c => <MenuItem key={`${c.orientationId}#${c.workIndex}`} value={`${c.orientationId}#${c.workIndex}`}>{c.orientationId}#{c.workIndex}（{c.d2dRole}）</MenuItem>)}
          </TextField>
          <TextField select size="small" label="mode" value={mode} onChange={event => setMode(event.target.value as Phase2C25BMode)} sx={{ minWidth: 160 }}>
            <MenuItem value="minimal">minimal</MenuItem>
            <MenuItem value="instrumented">instrumented</MenuItem>
          </TextField>
          <Button variant="contained" disabled={!ready || single === null}
            onClick={() => single && start(() => runner.runContext({ orientationId: single.orientationId, workIndex: single.workIndex, mode }))}>single run</Button>
          <Button variant="contained" disabled={!ready} onClick={() => start(() => runner.runFormalSeries())}>full formal series</Button>
          <Button variant="outlined" disabled={busy === null && preparation === null} onClick={() => start(() => runner.prepare())}>parity再確認</Button>
          <Button variant="outlined" color="warning" disabled={busy === null} onClick={() => runner.abortActive('cancelled on the page')}>Cancel</Button>
          <Button variant="outlined" color="inherit" disabled={busy !== null} onClick={() => runner.clear()}>Clear</Button>
          <Button variant="outlined" color="inherit" disabled={records.length === 0} onClick={download}>JSON保存</Button>
        </Stack>
        {message && <Alert severity="error">{message}</Alert>}
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>#</TableCell><TableCell>run</TableCell><TableCell>status</TableCell><TableCell>first Candidate</TableCell>
              <TableCell>snapshots</TableCell><TableCell>Gogma depth / generated</TableCell><TableCell>Worker s</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {records.map(r => {
              const last = r.progress.snapshots.at(-1)
              return (
                <TableRow key={r.id}>
                  <TableCell>{r.sequence}</TableCell><TableCell>{r.runKey}</TableCell><TableCell>{r.status}</TableCell>
                  <TableCell>{r.firstCandidateNotice ? `${seconds(r.firstCandidateNotice.timeToFirstMs)} s` : 'なし'}</TableCell>
                  <TableCell>{r.progress.count}</TableCell>
                  <TableCell>{last ? `${last.gogma.maxDepth} / ${last.gogma.totalGeneratedStates.toLocaleString()}` : '—'}</TableCell>
                  <TableCell>{seconds(r.workerLifetimeMs)}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Stack>
    </PageShell>
  )
}
