import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'
import { PageShell } from '../components/PageShell'
import { PLANNER_GLOBAL_BROWSER_BENCHMARK_PROTOCOL_VERSION } from '../benchmarks/plannerGlobalBrowserBenchmarkProtocol'
import {
  createPlannerGlobalBrowserRunner,
  PHASE2A_RESEARCH_MAX_PLAN_STEPS,
  PHASE2A_WORKLOADS,
  PHASE2B_WORKLOADS,
  type PlannerGlobalAttemptConfig,
  type PlannerGlobalBrowserRecord,
  type PlannerGlobalBrowserRunner,
  type PlannerGlobalControllerRecord,
} from '../benchmarks/plannerGlobalBrowserBenchmarkRunner'
import { globalResearchInputFromExport } from '../benchmarks/plannerGlobalOptimizationResearch'
import { CURRENT_CALCULATION_APP_SCHEMA_VERSION } from '../domain/models/publicTypes'
import type { PlannerInput } from '../domain/planner/plannerTypes'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../domain/rng/production/productionRngEngine'

declare const __PLANNER_GLOBAL_BENCHMARK_BUILD__: unknown

/** Provenance injected by `vite.benchmark.config.ts` at build time; null in dev / tests. */
function benchmarkBuild(): unknown {
  return typeof __PLANNER_GLOBAL_BENCHMARK_BUILD__ === 'undefined' ? null : __PLANNER_GLOBAL_BENCHMARK_BUILD__
}

export interface PlannerGlobalExportInfo {
  readonly fileName: string
  readonly byteSize: number
  readonly sha256: string
  readonly schemaVersion: unknown
  readonly targetCount: number | null
  readonly buildListEntryCount: number | null
  /** Main-thread input preparation (read, SHA-256, parse, pure Export validation, PlannerInput); outside every measurement. */
  readonly inputBuildMs: number
  readonly maxPlanSteps: number
}

export interface PlannerGlobalBrowserBenchmarkGlobal {
  readonly protocolVersion: string
  readonly workloads: typeof PHASE2A_WORKLOADS
  /** Issue #154 Phase 2-B: the same normal-2x run with the Worker Planner call timeline and Plan evidence. */
  readonly phase2bWorkloads: typeof PHASE2B_WORKLOADS
  exportInfo(): PlannerGlobalExportInfo | null
  runAttempt(config: PlannerGlobalAttemptConfig): Promise<PlannerGlobalBrowserRecord>
  runSeries(config: Omit<PlannerGlobalAttemptConfig, 'kind'>, warmups: number, measurements: number): Promise<PlannerGlobalBrowserRecord[]>
  runController(options?: Parameters<PlannerGlobalBrowserRunner['runController']>[1]): Promise<PlannerGlobalControllerRecord>
  cancel(): boolean
  running(): boolean
  records(): PlannerGlobalBrowserRecord[]
  controllers(): PlannerGlobalControllerRecord[]
  lastProgress: PlannerGlobalBrowserRunner['lastProgress']
  clear(): void
  environment(): Record<string, unknown>
  exportJson(): string
}

declare global {
  var plannerGlobalBrowserBenchmark: PlannerGlobalBrowserBenchmarkGlobal | undefined
}

const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('')
const short = (value: string | null | undefined) => value ? value.slice(0, 12) : '—'
const seconds = (ms: number | null | undefined) => ms === null || ms === undefined ? '—' : (ms / 1000).toFixed(1)

type HighEntropy = Record<string, unknown> | null

/**
 * Issue #154 Global Planner Research Phase 2-A Browser Worker benchmark (Research only).
 *
 * Unlinked from the normal application (`benchmark.html` only). The only data input is the original Export
 * the user picks here; it is validated with the pure Research path (`globalResearchInputFromExport()`), never
 * imported into IndexedDB, and never persisted. Every run starts a fresh Worker. The console API
 * `globalThis.plannerGlobalBrowserBenchmark` exists only while the page is mounted.
 */
export function PlannerGlobalBrowserBenchmarkPage() {
  const [records, setRecords] = useState<readonly PlannerGlobalBrowserRecord[]>([])
  const [controllers, setControllers] = useState<readonly PlannerGlobalControllerRecord[]>([])
  const [running, setRunning] = useState(false)
  const [info, setInfo] = useState<PlannerGlobalExportInfo | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const input = useRef<PlannerInput | null>(null)
  const infoRef = useRef<PlannerGlobalExportInfo | null>(null)
  const highEntropy = useRef<HighEntropy>(null)

  const runner = useMemo(() => createPlannerGlobalBrowserRunner({ onChange: state => {
    setRecords(state.records)
    setControllers(state.controllers)
    setRunning(state.running)
  } }), [])

  useEffect(() => {
    const data = (navigator as Navigator & { userAgentData?: { getHighEntropyValues(hints: string[]): Promise<Record<string, unknown>> } }).userAgentData
    void data?.getHighEntropyValues(['architecture', 'platformVersion', 'fullVersionList', 'model']).then(values => { highEntropy.current = values }).catch(() => undefined)
  }, [runner])

  const environment = useMemo(() => () => {
    const nav = navigator as Navigator & { deviceMemory?: number }
    return {
      userAgent: navigator.userAgent, userAgentData: highEntropy.current, hardwareConcurrency: navigator.hardwareConcurrency ?? null,
      deviceMemory: nav.deviceMemory ?? null, crossOriginIsolated: globalThis.crossOriginIsolated ?? null, isSecureContext: globalThis.isSecureContext ?? null,
      visibilityState: document.visibilityState, memoryApi: runner.memoryAvailability(), location: location.href,
      benchmarkBuild: benchmarkBuild(), rngEngineVersion: PRODUCTION_RNG_ENGINE_VERSION, calculationAppSchemaVersion: CURRENT_CALCULATION_APP_SCHEMA_VERSION,
      protocolVersion: PLANNER_GLOBAL_BROWSER_BENCHMARK_PROTOCOL_VERSION, export: infoRef.current,
      researchMaxPlanSteps: PHASE2A_RESEARCH_MAX_PLAN_STEPS, productionDefaultMaxPlanSteps: 1000,
      runtimeInput: 'original Export only (chosen on this page); no earlier Phase result, Target ID, order, snapshot or oracle',
    }
  }, [runner])

  const requireInput = () => {
    if (!input.current) throw new Error('Choose the original Export JSON first.')
    return input.current
  }

  useEffect(() => {
    const api: PlannerGlobalBrowserBenchmarkGlobal = {
      protocolVersion: PLANNER_GLOBAL_BROWSER_BENCHMARK_PROTOCOL_VERSION,
      workloads: PHASE2A_WORKLOADS,
      phase2bWorkloads: PHASE2B_WORKLOADS,
      exportInfo: () => infoRef.current,
      runAttempt: config => runner.runAttempt(requireInput(), config),
      runSeries: (config, warmups, measurements) => runner.runSeries(requireInput(), config, warmups, measurements),
      runController: options => runner.runController(requireInput(), options),
      cancel: () => runner.cancel(),
      running: () => runner.running(),
      records: () => runner.records(),
      controllers: () => runner.controllers(),
      lastProgress: () => runner.lastProgress(),
      clear: () => runner.clear(),
      environment,
      exportJson: () => runner.exportJson(environment()),
    }
    globalThis.plannerGlobalBrowserBenchmark = api
    return () => {
      runner.cancel()
      if (globalThis.plannerGlobalBrowserBenchmark === api) delete globalThis.plannerGlobalBrowserBenchmark
    }
  }, [runner, environment])

  const chooseExport = async (file: File | undefined) => {
    if (!file) return
    setMessage(null)
    const start = performance.now()
    try {
      const bytes = await file.arrayBuffer()
      const sha256 = hex(await crypto.subtle.digest('SHA-256', bytes))
      const json: unknown = JSON.parse(new TextDecoder().decode(bytes))
      const root = json !== null && typeof json === 'object' ? json as Record<string, unknown> : {}
      const count = (key: string) => Array.isArray(root[key]) ? (root[key] as unknown[]).length : null
      input.current = globalResearchInputFromExport(json, PHASE2A_RESEARCH_MAX_PLAN_STEPS)
      const next: PlannerGlobalExportInfo = { fileName: file.name, byteSize: bytes.byteLength, sha256, schemaVersion: root.schemaVersion ?? null,
        targetCount: count('targetWeapons'), buildListEntryCount: count('buildListEntries'), inputBuildMs: performance.now() - start, maxPlanSteps: PHASE2A_RESEARCH_MAX_PLAN_STEPS }
      infoRef.current = next
      setInfo(next)
    } catch (error) {
      input.current = null
      infoRef.current = null
      setInfo(null)
      setMessage(`Exportを読み込めませんでした: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const start = (task: () => Promise<unknown>) => {
    setMessage(null)
    void task().catch((error: unknown) => setMessage(error instanceof Error ? error.message : String(error)))
  }

  const download = () => {
    const blob = new Blob([runner.exportJson(environment())], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `planner-global-phase2a-browser_${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const disabled = running || info === null
  return (
    <PageShell title="Global Planner Research Phase 2-A" description="Issue #154 Research-only Browser Worker benchmark. Production behavior is unchanged; nothing is persisted.">
      <Stack spacing={2}>
        <Alert severity="info">
          original Exportを選ぶと、pure validationだけでPlannerInputを構築します（IndexedDBへImportしません）。各runは新しいBrowser Workerで実行され、
          Research maxPlanSteps {PHASE2A_RESEARCH_MAX_PLAN_STEPS}（Production default 1000とは別）を使います。
        </Alert>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={1}>
            <Button variant="outlined" component="label" disabled={running}>
              original Exportを選択
              <input id="pg2a-export-file" hidden type="file" accept="application/json,.json" onChange={event => void chooseExport(event.target.files?.[0])} />
            </Button>
            {info && (
              <Typography variant="body2" component="div">
                {info.fileName} / {info.byteSize.toLocaleString()} bytes / SHA-256 {info.sha256} / schemaVersion {String(info.schemaVersion)} /
                Target {info.targetCount ?? '—'} / BuildListEntry {info.buildListEntryCount ?? '—'} / input build {seconds(info.inputBuildMs)} s
              </Typography>
            )}
          </Stack>
        </Paper>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
          <Button variant="contained" disabled={disabled} onClick={() => start(() => runner.runAttempt(requireInput(), PHASE2A_WORKLOADS.control()))}>Control（fallbackなし）</Button>
          <Button variant="contained" disabled={disabled} onClick={() => start(() => runner.runSeries(requireInput(), PHASE2A_WORKLOADS.normalWinner(), 1, 3))}>normal-2x（warm-up 1 + 3）</Button>
          <Button variant="contained" disabled={disabled} onClick={() => start(() => runner.runController(requireInput(), { label: 'phase1e-controller' }))}>Phase 1-E 3axis controller</Button>
          <Button variant="outlined" disabled={disabled} onClick={() => start(() => runner.runAttempt(requireInput(), PHASE2A_WORKLOADS.normalCacheOff()))}>normal-2x raw cache off</Button>
          <Button variant="outlined" disabled={disabled} onClick={() => start(() => runner.runAttempt(requireInput(), PHASE2A_WORKLOADS.responsiveness()))}>responsiveness（chained ping）</Button>
          <Button variant="outlined" disabled={disabled} onClick={() => start(() => runner.runAttempt(requireInput(), PHASE2A_WORKLOADS.cancelBaseSearch()))}>cancel（base Search中）</Button>
          <Button variant="outlined" disabled={disabled} onClick={() => start(() => runner.runAttempt(requireInput(), PHASE2A_WORKLOADS.cancelFallback()))}>cancel（fallback中）</Button>
          <Button variant="outlined" disabled={disabled} onClick={() => start(() => runner.runAttempt(requireInput(), PHASE2A_WORKLOADS.memory()))}>memory（normal）</Button>
          <Button variant="outlined" disabled={disabled} onClick={() => start(() => runner.runSeries(requireInput(), PHASE2B_WORKLOADS.timing(), 1, 3))}>Phase 2-B timeline（warm-up 1 + 3）</Button>
          <Button variant="outlined" disabled={disabled} onClick={() => start(() => runner.runAttempt(requireInput(), PHASE2B_WORKLOADS.responsiveness()))}>Phase 2-B responsiveness</Button>
          <Button variant="outlined" disabled={disabled} onClick={() => start(() => runner.runAttempt(requireInput(), PHASE2B_WORKLOADS.memory()))}>Phase 2-B memory</Button>
          <Button variant="outlined" color="warning" disabled={!running} onClick={() => runner.cancel()}>Cancel</Button>
          <Button variant="outlined" color="inherit" disabled={running} onClick={() => runner.clear()}>Clear</Button>
          <Button variant="outlined" color="inherit" disabled={records.length === 0} onClick={download}>JSON保存</Button>
        </Stack>
        {message && <Alert severity="error">{message}</Alert>}
        {controllers.map(c => (
          <Alert key={c.id} severity={c.outcome === 'completed' ? 'success' : 'warning'}>
            {c.label}: outcome {c.outcome}, winner {c.winner ? `${c.winner.axis} (${short(c.winner.semanticSha256)})` : 'なし'}, first completed {seconds(c.firstCompleted?.elapsedMs)} s,
            全axis比較 {seconds(c.allInitialAxesComparedAtMs)} s, retry {c.retryStarted ? '開始' : '未開始'}
          </Alert>
        ))}
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>#</TableCell><TableCell>label</TableCell><TableCell>kind</TableCell><TableCell>status / stop</TableCell>
              <TableCell>completed / Conflict / rejected</TableCell><TableCell>steps</TableCell><TableCell>semantic</TableCell>
              <TableCell>ready s</TableCell><TableCell>round trip s</TableCell><TableCell>Search / Planner s</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {records.map(r => {
              const final = r.result?.report.final
              return (
                <TableRow key={r.id}>
                  <TableCell>{r.sequence}</TableCell><TableCell>{r.label}</TableCell><TableCell>{r.kind}</TableCell>
                  <TableCell>{r.status} / {r.result?.stop ?? '—'}</TableCell>
                  <TableCell>{final ? `${final.completedTargetCount}/${r.result?.report.planningTargetCount} / ${final.conflicts} / ${final.rejected}` : '—'}</TableCell>
                  <TableCell>{final?.steps ?? '—'}</TableCell><TableCell>{short(r.result?.semanticSha256)}</TableCell>
                  <TableCell>{seconds(r.createToReadyMs)}</TableCell><TableCell>{seconds(r.roundTripMs)}</TableCell>
                  <TableCell>{seconds(r.result?.timing.searchElapsedMs)} / {seconds(r.result?.timing.plannerElapsedMs)}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Stack>
    </PageShell>
  )
}
