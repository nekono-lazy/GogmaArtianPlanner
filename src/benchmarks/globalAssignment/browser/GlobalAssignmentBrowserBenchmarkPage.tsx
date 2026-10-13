import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Alert, Box, Button, Checkbox, FormControl, FormControlLabel, InputLabel, LinearProgress, MenuItem, Paper, Select, Stack, TextField, Typography,
} from '@mui/material'
import { CURRENT_CALCULATION_APP_SCHEMA_VERSION } from '../../../domain/models/publicTypes'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../../../domain/rng/production/productionRngEngine'
import { registeredD1cConditions } from '../verificationRegistration'
import { buildCommitOf, GLOBAL_ASSIGNMENT_BROWSER_PROTOCOL_VERSION, gabProgressKey, gabResolvedLocale, type GabExecutionOptions, type GabWorkerEnvironment } from './globalAssignmentBrowserProtocol'
import {
  createGlobalAssignmentBrowserRunner, GAB_RUN_PURPOSES, mainBuildProvenance, observeExportIdentity,
  type GabExportSource, type GabLogicalRunOptions, type GabLogicalRunRecord, type GabRunnerState, type GabRunPurpose, type GlobalAssignmentBrowserRunner, type GlobalAssignmentBrowserRunnerDependencies,
} from './globalAssignmentBrowserRunner'
import { GLOBAL_ASSIGNMENT_BROWSER_VALIDATION_MAX_PLAN_STEPS } from './globalAssignmentBrowserStages'

/**
 * P-1 page defaults: execution-only values, provisional for this page (not measured and not Production values; P-2 fixes the measured
 * ones in its committed measurement plan). The calculation conditions are not here: the Worker reads them itself.
 */
const GAB_PAGE_DEFAULTS: Readonly<{
  firstWallMs: number; freshWallMs: number; cancelGraceMs: number; readyTimeoutMs: number; heartbeatIntervalMs: number; yieldMode: GabExecutionOptions['yieldMode']; lateResponseWaitMs: number
}> = Object.freeze({
  firstWallMs: 1_800_000, freshWallMs: 1_800_000, cancelGraceMs: 10_000, readyTimeoutMs: 120_000, heartbeatIntervalMs: 1_000, yieldMode: 'message-channel', lateResponseWaitMs: 1_000,
})

/** Benchmark-only cancel trigger points (a progress key of design 9.3; armed once per logical run). */
const CANCEL_TRIGGER_KEYS: { key: string; label: string }[] = [
  { key: 'materialization:context', label: 'Phase A中（Phase 0終了後）' },
  { key: 'materialization:reach_table', label: 'Phase B / C中（Phase A終了後）' },
  { key: 'materialization:candidate_started', label: 'Phase D中' },
  { key: 'verification:planner:started', label: "Phase D' Planner中" },
  { key: 'verification:trace_replay:started', label: "Phase D' Trace Replay中" },
]

export interface GlobalAssignmentExportInfo {
  fileName: string
  bytes: number
  sha256: string
  /** Main-thread read + SHA-256 (no decoding, no parsing); outside every measurement. */
  observeMs: number
}

export interface GlobalAssignmentBrowserBenchmarkGlobal {
  protocolVersion: string
  defaults: typeof GAB_PAGE_DEFAULTS
  exportInfo(): GlobalAssignmentExportInfo | null
  conditions(): ReturnType<typeof registeredD1cConditions>
  environment(): Record<string, unknown>
  probe(): ReturnType<GlobalAssignmentBrowserRunner['probe']>
  /** One logical run with the page's options, overridden field by field (the slot and the execution options included). */
  runLogicalRun(overrides?: Partial<GabLogicalRunOptions>): Promise<GabLogicalRunRecord>
  cancel(): boolean
  ping(): Promise<number | null>
  running(): boolean
  current(): GabRunnerState['current']
  records(): GabLogicalRunRecord[]
  exportJson(): string
  clear(): void
}

declare global {
  var globalAssignmentBrowserBenchmark: GlobalAssignmentBrowserBenchmarkGlobal | undefined
}

const shortHash = (value: string | null | undefined) => (value ? value.slice(0, 12) : '—')
const seconds = (ms: number | null | undefined) => (ms === null || ms === undefined ? '—' : `${(ms / 1000).toFixed(1)} s`)

/** A labelled definition list (`role="group"`: a `<dl>` has no implicit role). */
function Facts({ label, rows }: { label: string; rows: [string, ReactNode][] }) {
  return (
    <Box component="dl" role="group" aria-label={label} sx={{ m: 0, display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'max-content 1fr' }, columnGap: 2, rowGap: 0.5 }}>
      {rows.map(([term, value]) => (
        <Box key={term} sx={{ display: 'contents' }}>
          <Typography component="dt" variant="body2" sx={{ fontWeight: 600 }}>{term}</Typography>
          <Typography component="dd" variant="body2" sx={{ m: 0, mb: { xs: 0.75, sm: 0 }, overflowWrap: 'anywhere', fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
        </Box>
      ))}
    </Box>
  )
}

function verdictText(record: GabLogicalRunRecord): string {
  const verdict = record.judgement.verdict
  switch (verdict.kind) {
    case 'browser_nonformal_conditions_met': return `両Workerで全条件を満たし一致（非formal）: 物理操作 ${verdict.physicalOperations.toLocaleString()} / planning Target ${verdict.planningTargetCount}`
    case 'unmeasured': return `未計測（${verdict.run}: ${verdict.reason}、Browser分類 ${verdict.browserSettle}）`
    case 'invalid_run_integrity': return `記録の完全性に問題（${verdict.issues.length}件）`
    case 'phase_d_prime_not_reached': return `Phase D'未到達（materialization: ${verdict.materializationOutcome.kind}）`
    default: return `${verdict.kind}（${'run' in verdict ? verdict.run : ''}）`
  }
}

export interface GlobalAssignmentBrowserBenchmarkPageProps {
  /** Tests only: the runner's dependencies (a Worker double, clocks). */
  runnerDependencies?: GlobalAssignmentBrowserRunnerDependencies
}

/**
 * Issue #154 Production準備 P-1: the Research-only Global Assignment Browser Worker benchmark page (`benchmark-global-assignment.html`
 * only; never linked from the normal application). The user picks an Export; the main thread only reads its bytes for the identity
 * (no decoding, no parsing, no validation, no import) and hands the File to fresh Workers, which build the input, read the registered
 * conditions and calculate. Progress is shown as stage names and counts only (no completion ratio, no remaining time). Nothing is
 * persisted: the raw JSON is saved only when the user asks, for a git-ignored `.local/` directory. The console API
 * `globalThis.globalAssignmentBrowserBenchmark` exists while the page is mounted (for the P-2 external driver).
 */
export function GlobalAssignmentBrowserBenchmarkPage({ runnerDependencies }: GlobalAssignmentBrowserBenchmarkPageProps = {}) {
  const [state, setState] = useState<GabRunnerState>({ records: [], running: false, current: null })
  const [info, setInfo] = useState<GlobalAssignmentExportInfo | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [probe, setProbe] = useState<{ createToReadyMs: number | null; environment: GabWorkerEnvironment | null; environmentIssues: string[]; pingMs: number | null; error: string | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const [purpose, setPurpose] = useState<GabRunPurpose>('pilot')
  const [slotId, setSlotId] = useState('p1-manual')
  const [envelope, setEnvelope] = useState({ firstWallMs: GAB_PAGE_DEFAULTS.firstWallMs, freshWallMs: GAB_PAGE_DEFAULTS.freshWallMs, cancelGraceMs: GAB_PAGE_DEFAULTS.cancelGraceMs })
  const [heartbeatIntervalMs, setHeartbeatIntervalMs] = useState(GAB_PAGE_DEFAULTS.heartbeatIntervalMs)
  const [yieldMode, setYieldMode] = useState<GabExecutionOptions['yieldMode']>(GAB_PAGE_DEFAULTS.yieldMode)
  const [cancelTrigger, setCancelTrigger] = useState<{ key: string; role: 'first' | 'fresh'; delayMs: number }>({ key: '', role: 'first', delayMs: 1_000 })
  const [withPing, setWithPing] = useState(false)
  const [withMemory, setWithMemory] = useState(false)
  const file = useRef<File | null>(null)
  const infoRef = useRef<GlobalAssignmentExportInfo | null>(null)
  const highEntropy = useRef<Record<string, unknown> | null>(null)
  const conditions = useMemo(() => registeredD1cConditions(), [])

  const runner = useMemo(() => createGlobalAssignmentBrowserRunner({ ...runnerDependencies, onChange: next => setState(next) }), [runnerDependencies])

  useEffect(() => {
    const data = (navigator as Navigator & { userAgentData?: { getHighEntropyValues(hints: string[]): Promise<Record<string, unknown>> } }).userAgentData
    void data?.getHighEntropyValues(['architecture', 'platformVersion', 'fullVersionList', 'model']).then(values => { highEntropy.current = values }).catch(() => undefined)
  }, [])

  const environment = useMemo(() => () => {
    const nav = navigator as Navigator & { deviceMemory?: number }
    const locale = gabResolvedLocale()
    return {
      userAgent: navigator.userAgent, userAgentData: highEntropy.current, hardwareConcurrency: navigator.hardwareConcurrency ?? null, deviceMemory: nav.deviceMemory ?? null,
      language: navigator.language ?? null, locale, crossOriginIsolated: globalThis.crossOriginIsolated ?? null, isSecureContext: globalThis.isSecureContext ?? null,
      visibilityState: document.visibilityState, memoryApi: runner.memoryAvailability(), origin: location.origin, path: location.pathname,
      benchmarkBuild: mainBuildProvenance(), protocolVersion: GLOBAL_ASSIGNMENT_BROWSER_PROTOCOL_VERSION, rngEngineVersion: PRODUCTION_RNG_ENGINE_VERSION,
      calculationAppSchemaVersion: CURRENT_CALCULATION_APP_SCHEMA_VERSION, export: infoRef.current, formal: false,
      runtimeInput: 'the Export picked on this page only; conditions read by the Worker (registeredD1cConditions); no earlier result, expected hash, oracle or RESULT',
    }
  }, [runner])

  const options = useMemo(() => (overrides: Partial<GabLogicalRunOptions> = {}): GabLogicalRunOptions => ({
    slot: { slotId, purpose, planned: false, note: null },
    execution: { yieldMode, heartbeatIntervalMs, workerHeapSampling: withMemory },
    envelope: { ...envelope, readyTimeoutMs: GAB_PAGE_DEFAULTS.readyTimeoutMs },
    cancelTrigger: cancelTrigger.key === '' ? null : { role: cancelTrigger.role, onProgressKey: cancelTrigger.key, delayMs: cancelTrigger.delayMs },
    ping: withPing ? { timeoutMs: 60_000 } : null,
    memory: withMemory ? { gcWaitMs: 10_000 } : null,
    lateResponseWaitMs: GAB_PAGE_DEFAULTS.lateResponseWaitMs,
    exportTransport: 'auto',
    ...overrides,
  }), [slotId, purpose, yieldMode, heartbeatIntervalMs, withMemory, envelope, cancelTrigger, withPing])

  const source = (): GabExportSource => {
    if (file.current === null || infoRef.current === null) throw new Error('Exportファイルを選択してください。')
    return { file: file.current, identity: { fileName: infoRef.current.fileName, bytes: infoRef.current.bytes, sha256: infoRef.current.sha256 } }
  }

  const download = () => {
    const blob = new Blob([runner.exportJson(environment())], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `global-assignment-browser-p1_${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const runOnce = async (overrides: Partial<GabLogicalRunOptions> = {}) => runner.runLogicalRun(source(), options(overrides))

  useEffect(() => {
    const api: GlobalAssignmentBrowserBenchmarkGlobal = {
      protocolVersion: GLOBAL_ASSIGNMENT_BROWSER_PROTOCOL_VERSION, defaults: GAB_PAGE_DEFAULTS,
      exportInfo: () => infoRef.current, conditions: () => registeredD1cConditions(), environment,
      probe: () => runner.probe({ yieldMode, heartbeatIntervalMs, workerHeapSampling: false }, GAB_PAGE_DEFAULTS.readyTimeoutMs),
      runLogicalRun: overrides => runOnce(overrides), cancel: () => runner.cancel('console'), ping: () => runner.ping(),
      running: () => runner.running(), current: () => runner.current(), records: () => runner.records(), exportJson: () => runner.exportJson(environment()), clear: () => runner.clear(),
    }
    globalThis.globalAssignmentBrowserBenchmark = api
    return () => { if (globalThis.globalAssignmentBrowserBenchmark === api) delete globalThis.globalAssignmentBrowserBenchmark }
  })

  useEffect(() => () => { runner.cancel('unmount') }, [runner])

  const chooseExport = async (picked: File | undefined) => {
    if (!picked) return
    setMessage(null)
    const started = performance.now()
    try {
      const identity = await observeExportIdentity(picked)
      file.current = picked
      const next = { ...identity, observeMs: performance.now() - started }
      infoRef.current = next
      setInfo(next)
    } catch (error) {
      file.current = null
      infoRef.current = null
      setInfo(null)
      setMessage(`Exportを読み込めませんでした: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const act = (task: () => Promise<unknown>) => {
    setMessage(null)
    setNotice(null)
    setBusy(true)
    void task().catch((error: unknown) => setMessage(error instanceof Error ? error.message : String(error))).finally(() => setBusy(false))
  }

  const current = state.current
  const lastRecord = state.records.at(-1) ?? null
  const disabled = state.running || busy
  const numberField = (label: string, value: number, onChange: (value: number) => void, helper: string) => (
    <TextField label={label} type="number" size="small" value={value} disabled={disabled} helperText={helper}
      slotProps={{ htmlInput: { min: 1, step: 1, inputMode: 'numeric' } }} onChange={event => { const parsed = Number(event.target.value); if (Number.isSafeInteger(parsed) && parsed > 0) onChange(parsed) }} />
  )
  return (
    <Stack spacing={{ xs: 2, md: 3 }} sx={{ py: { xs: 2, md: 3 } }}>
      <Stack component="header" spacing={0.5}>
        <Typography component="h1" variant="h1">Global Assignment Browser Worker（P-1）</Typography>
        <Typography sx={{ color: 'text.secondary', overflowWrap: 'anywhere' }}>
          Issue #154 Production準備のResearch専用ページです。通常アプリの機能ではなく、Production動作は変わりません。計算はBrowser Worker内で行い、結果は保存しません（非formal）。
        </Typography>
      </Stack>

      <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 } }} component="section" aria-labelledby="gab-export-heading">
        <Stack spacing={1.5}>
          <Typography id="gab-export-heading" component="h2" variant="h6">Export</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            main threadはExportのbyte列を読んでSHA-256を求めるだけで、decode・JSON parse・検証・Importをしません。入力の構築は各Workerが自分で行います。
          </Typography>
          <Button variant="outlined" component="label" disabled={disabled} sx={{ alignSelf: { xs: 'stretch', sm: 'flex-start' }, minHeight: 44 }}>
            Exportファイルを選択
            <input id="gab-export-file" hidden type="file" accept="application/json,.json" onChange={event => void chooseExport(event.target.files?.[0])} />
          </Button>
          {info === null
            ? <Typography variant="body2">Exportは未選択です。</Typography>
            : <Facts label="Export identity" rows={[['ファイル名', info.fileName], ['byte数', info.bytes.toLocaleString()], ['SHA-256', <code key="sha">{info.sha256}</code>], ['読込・hash', seconds(info.observeMs)]]} />}
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 } }} component="section" aria-labelledby="gab-conditions-heading">
        <Stack spacing={1.5}>
          <Typography id="gab-conditions-heading" component="h2" variant="h6">登録条件（読取り専用）</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>Workerが <code>registeredD1cConditions()</code> から自分で読みます。requestで変更できません。</Typography>
          <Facts label="Registered conditions" rows={[
            ['window（Normal / Gogma / Skill）', `${conditions.materialization.window.normal} / ${conditions.materialization.window.gogma} / ${conditions.materialization.window.skill}`],
            ['materialization規則', conditions.materialization.rule], ['option集合', conditions.materialization.reachOptionSet ?? 'a1'],
            ['structural candidate', `${conditions.materialization.structuralCandidateLimit}件`], ['node budget / MRV', `${conditions.materialization.nodeBudget} / ${conditions.materialization.mrvLookahead}`],
            ['verification budget', String(conditions.verification.verificationBudget)], ["Phase D' Research maxPlanSteps", conditions.verification.researchMaxPlanSteps.toLocaleString()],
            ['PlannerInput maxPlanSteps（検証用）', GLOBAL_ASSIGNMENT_BROWSER_VALIDATION_MAX_PLAN_STEPS.toLocaleString()],
            ['Engine / build', `${PRODUCTION_RNG_ENGINE_VERSION} / ${shortHash(buildCommitOf(mainBuildProvenance()))}`],
          ]} />
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 } }} component="section" aria-labelledby="gab-run-heading">
        <Stack spacing={2}>
          <Typography id="gab-run-heading" component="h2" variant="h6">実行（1 logical run = first Worker → fresh Worker）</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            以下は実行だけに使う値で、計算結果に影響しません。既定値はP-1の暫定値で、計測値でもProduction値でもありません。
          </Typography>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} useFlexGap sx={{ flexWrap: 'wrap' }}>
            <TextField label="slot ID" size="small" value={slotId} disabled={disabled} onChange={event => setSlotId(event.target.value)} helperText="記録用（P-1は計画外run）" />
            <FormControl size="small" sx={{ minWidth: 180 }} disabled={disabled}>
              <InputLabel id="gab-purpose-label">run目的</InputLabel>
              <Select labelId="gab-purpose-label" label="run目的" value={purpose} onChange={event => setPurpose(event.target.value as GabRunPurpose)}>
                {GAB_RUN_PURPOSES.map(value => <MenuItem key={value} value={value}>{value}</MenuItem>)}
              </Select>
            </FormControl>
            {numberField('first Worker wall（ms）', envelope.firstWallMs, value => setEnvelope(previous => ({ ...previous, firstWallMs: value })), '超過でtimeout（terminate）')}
            {numberField('fresh Worker wall（ms）', envelope.freshWallMs, value => setEnvelope(previous => ({ ...previous, freshWallMs: value })), '超過でtimeout（terminate）')}
            {numberField('cancel grace（ms）', envelope.cancelGraceMs, value => setEnvelope(previous => ({ ...previous, cancelGraceMs: value })), '超過でterminate')}
            {numberField('heartbeat間隔（ms）', heartbeatIntervalMs, value => setHeartbeatIntervalMs(Math.max(50, value)), '50以上')}
            <FormControl size="small" sx={{ minWidth: 180 }} disabled={disabled}>
              <InputLabel id="gab-yield-label">yield</InputLabel>
              <Select labelId="gab-yield-label" label="yield" value={yieldMode} onChange={event => setYieldMode(event.target.value as GabExecutionOptions['yieldMode'])}>
                <MenuItem value="message-channel">MessageChannel</MenuItem>
                <MenuItem value="timer">setTimeout(0)</MenuItem>
              </Select>
            </FormControl>
          </Stack>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} useFlexGap sx={{ flexWrap: 'wrap', alignItems: { md: 'flex-start' } }}>
            <FormControl size="small" sx={{ minWidth: 240 }} disabled={disabled}>
              <InputLabel id="gab-trigger-label">cancel試験（任意）</InputLabel>
              <Select labelId="gab-trigger-label" label="cancel試験（任意）" value={cancelTrigger.key} onChange={event => setCancelTrigger(previous => ({ ...previous, key: event.target.value }))}>
                <MenuItem value="">なし</MenuItem>
                {CANCEL_TRIGGER_KEYS.map(trigger => <MenuItem key={trigger.key} value={trigger.key}>{trigger.label}</MenuItem>)}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 140 }} disabled={disabled || cancelTrigger.key === ''}>
              <InputLabel id="gab-trigger-role-label">対象Worker</InputLabel>
              <Select labelId="gab-trigger-role-label" label="対象Worker" value={cancelTrigger.role} onChange={event => setCancelTrigger(previous => ({ ...previous, role: event.target.value as 'first' | 'fresh' }))}>
                <MenuItem value="first">first</MenuItem>
                <MenuItem value="fresh">fresh</MenuItem>
              </Select>
            </FormControl>
            {numberField('cancelまでの遅延（ms）', cancelTrigger.delayMs, value => setCancelTrigger(previous => ({ ...previous, delayMs: value })), 'trigger受信後')}
            <FormControlLabel control={<Checkbox checked={withPing} disabled={disabled} onChange={event => setWithPing(event.target.checked)} />} label="実行中にchained ping" />
            <FormControlLabel control={<Checkbox checked={withMemory} disabled={disabled} onChange={event => setWithMemory(event.target.checked)} />} label="memory採取（固定点）" />
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
            <Button variant="contained" disabled={disabled || info === null} sx={{ minHeight: 44 }} onClick={() => act(() => runOnce())}>logical runを実行</Button>
            <Button variant="outlined" color="warning" disabled={!state.running} sx={{ minHeight: 44 }} onClick={() => { const accepted = runner.cancel('ui'); setNotice(accepted ? 'キャンセルを受け付けました（実行中のrequestはcancellingになり、その結果は採用しません）。' : 'キャンセルを受け付けました（Worker間のため、次のWorkerを起動しません）。') }}>キャンセル</Button>
            <Button variant="outlined" disabled={busy || state.running} sx={{ minHeight: 44 }} onClick={() => act(async () => setProbe(await runner.probe({ yieldMode, heartbeatIntervalMs, workerHeapSampling: false }, GAB_PAGE_DEFAULTS.readyTimeoutMs)))}>Workerを確認</Button>
            <Button variant="outlined" disabled={!state.running} sx={{ minHeight: 44 }} onClick={() => act(async () => { const ms = await runner.ping(); setNotice(ms === null ? 'pingの応答がありません（同期区間中、または終了済み）。' : `ping応答 ${ms.toFixed(1)} ms`) })}>Ping</Button>
            <Button variant="outlined" color="inherit" disabled={state.records.length === 0} sx={{ minHeight: 44 }} onClick={download}>JSON保存</Button>
            <Button variant="outlined" color="inherit" disabled={disabled || state.records.length === 0} sx={{ minHeight: 44 }} onClick={() => runner.clear()}>記録をクリア</Button>
          </Stack>
          <Alert severity="info" variant="outlined">JSON保存のファイルはEntry本体・Target ID・Planを含み得ます。git-ignoredな <code>.local/</code> にだけ置き、Repositoryへcommitしないでください。</Alert>
          {message && <Alert severity="error">エラー: {message}</Alert>}
          {notice && <Alert severity="info">{notice}</Alert>}
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 } }} component="section" aria-labelledby="gab-status-heading">
        <Stack spacing={1.5}>
          <Typography id="gab-status-heading" component="h2" variant="h6">状態</Typography>
          <Typography role="status" aria-live="polite" sx={{ fontWeight: 600 }}>
            {state.running ? `実行中: ${current === null ? 'Worker間' : `${current.role} Worker`}` : lastRecord === null ? '待機中（実行記録なし）' : `待機中（直前のrun ${lastRecord.id}: ${lastRecord.judgement.recordClassification}）`}
          </Typography>
          {state.running && <LinearProgress aria-label="実行中（完了率は推定しません）" />}
          {current !== null && (
            <Facts label="Current request" rows={[
              ['request', current.requestId], ['現在のstage', current.lastProgress === null ? '受理待ち' : gabProgressKey(current.lastProgress)],
              ['progress / heartbeat', `${current.events} / ${current.heartbeats}`], ['決着したTarget（件数）', `${current.settledTargets}件`],
              ['経過（main観測）', seconds(current.elapsedMs)], ['Workerの最大同期slice（heartbeat時点）', seconds(current.lastHeartbeat?.maxSliceMs)],
            ]} />
          )}
          {probe !== null && (
            <Facts label="Worker probe" rows={[
              ['Worker ready', probe.error ?? seconds(probe.createToReadyMs)], ['ping', probe.pingMs === null ? '—' : `${probe.pingMs.toFixed(1)} ms`],
              ['secure context / isolated', probe.environment === null ? '—' : `${String(probe.environment.isSecureContext)} / ${String(probe.environment.crossOriginIsolated)}`],
              ['Worker機能', probe.environment === null ? '—' : Object.entries(probe.environment.capabilities).map(([key, value]) => `${key}: ${value ? 'あり' : 'なし'}`).join(', ')],
              ['locale / build', probe.environment === null ? '—' : `${probe.environment.locale ?? '—'} / ${shortHash(probe.environment.buildCommit)}`],
              ['実行可否', probe.environmentIssues.length === 0 && probe.error === null ? '実行できます' : `実行できません: ${probe.environmentIssues.join(' ')}`],
            ]} />
          )}
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 } }} component="section" aria-labelledby="gab-records-heading">
        <Stack spacing={2}>
          <Typography id="gab-records-heading" component="h2" variant="h6">実行記録（{state.records.length}件）</Typography>
          {state.records.length === 0 && <Typography variant="body2">まだ実行記録はありません。</Typography>}
          {[...state.records].reverse().map(record => {
            const first = record.first.settlement?.result ?? null
            const fresh = record.fresh.settlement?.result ?? null
            return (
              <Paper key={record.id} variant="outlined" sx={{ p: 2 }} component="article" aria-label={`logical run ${record.id}`}>
                <Stack spacing={1}>
                  <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{record.id}: {record.judgement.recordClassification}</Typography>
                  <Typography variant="body2">{verdictText(record)}</Typography>
                  <Facts label={`run ${record.id}`} rows={[
                    ['slot / 目的', `${record.slot.slotId} / ${record.slot.purpose}（${record.slot.planned ? '計画' : '計画外'}）`],
                    ['first Worker', `${record.first.settle}（ready ${seconds(record.first.createToReadyMs)}、round trip ${seconds(record.first.settlement?.timing.roundTripMs)}、${record.first.exportTransport ?? '—'}）`],
                    ['fresh Worker', record.fresh.settle === 'not_run' ? `未起動（${record.fresh.notRunReason ?? '—'}）` : `${record.fresh.settle}（ready ${seconds(record.fresh.createToReadyMs)}、round trip ${seconds(record.fresh.settlement?.timing.roundTripMs)}）`],
                    ['materialization semantic', first?.materialization ? `${shortHash(first.materialization.semanticSha256)}（${first.materialization.semantic.outcome.kind}）` : '—'],
                    ['Entry fingerprint', first?.entrySet?.entryFingerprint ?? '—'],
                    ['verification semantic（first / fresh）', `${shortHash(first?.verification?.semanticSha256)} / ${shortHash(fresh?.verification?.semanticSha256)}`],
                    ['Phase時間（first: A / B・C / D\' Planner / Trace Replay）', first?.materialization
                      ? `${seconds(first.materialization.observed.elapsedMs.reachTable)} / ${seconds(first.materialization.observed.elapsedMs.structuralSearch)} / ${seconds(first.verification?.observed.elapsedMs.planner)} / ${seconds(first.verification?.observed.elapsedMs.trace_replay)}` : '—'],
                    ['最長yield間隔（first / fresh）', `${seconds(first?.observed.longestYieldGap?.ms)} / ${seconds(fresh?.observed.longestYieldGap?.ms)}`],
                    ['キャンセル', record.cancel === null ? 'なし' : `${record.cancel.source}（requestの受付: ${record.cancel.acceptedByRequest ?? 'なし'}）`],
                    ['完全性の問題', record.integrityIssues.length === 0 ? 'なし' : record.integrityIssues.join(' / ')],
                    ['非表示・中断', record.lifecycle.interrupted ? 'あり（時間・応答性の集計対象外）' : 'なし'],
                  ]} />
                </Stack>
              </Paper>
            )
          })}
        </Stack>
      </Paper>
    </Stack>
  )
}
