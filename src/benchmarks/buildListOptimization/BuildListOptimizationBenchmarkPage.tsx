import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { Alert, Box, Button, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { loadMasterData } from '../../domain/master/loadMasterData'
import type { MasterDataRoot } from '../../domain/master/masterTypes'
import { bloBenchmarkBuild, bloBrowserEnvironment, bloBrowserRunnerPorts, bloBrowserSha256 } from './buildListOptimizationBenchmarkBrowserPorts'
import type { BloInputIdentity, BloRunRecord, BloSlotSpec } from './buildListOptimizationBenchmarkProtocol'
import { createBloBenchmarkRunner, type BloBenchmarkRunner, type BloCurrentRun } from './buildListOptimizationBenchmarkRunner'
import { BLO_SYNTHETIC_BOUNDS, BLO_SYNTHETIC_CASES, bloSyntheticBounds, bloSyntheticExportText } from './buildListOptimizationBenchmarkSynthetic'

/**
 * Issue #260 PR-5A: the benchmark-only page of the Production Build List global optimization measurement
 * (`benchmark-build-list-optimization.html`, built by `vite.benchmark.config.ts` only; never part of the application or GitHub Pages).
 *
 * The page selects the run's input (an Export file read locally - never uploaded, stored or shown - or a synthetic case), runs one
 * slot at a time through the runner, and offers its records as JSON. An external driver uses the same operations through
 * `globalThis.buildListOptimizationBenchmark`; the committed measurement plan is read by the driver and the analyzer, never by this page.
 */

export interface BloSelectedInput {
  inputLabel: string
  text: string
  identity: BloInputIdentity
}

export interface BuildListOptimizationBenchmarkApi {
  version: string
  environment(): BloRunRecord['environment'] & { build: unknown }
  /** The selected input's identity, or null. */
  inputInfo(): BloInputIdentity | null
  /** Selects a synthetic case as the input. */
  useSynthetic(caseId: string): Promise<BloInputIdentity>
  syntheticCases(): { caseId: string; note: string }[]
  syntheticBounds(): { boundsId: string; note: string }[]
  /** Runs one slot on the selected input; refuses when the input is not the expected one. */
  runSlot(spec: BloSlotSpec, expected: { inputSha256: string }): Promise<{ recordId: string; outcome: BloRunRecord['outcome']; resultStatus: string | null }>
  cancel(): boolean
  current(): BloCurrentRun | null
  records(): BloRunRecord[]
  exportJson(): string
  clear(): void
}

declare global {
  var buildListOptimizationBenchmark: BuildListOptimizationBenchmarkApi | undefined
}

async function syntheticInput(caseId: string): Promise<BloSelectedInput> {
  const text = bloSyntheticExportText(caseId)
  const bytes = new TextEncoder().encode(text)
  return { inputLabel: caseId, text, identity: { kind: 'synthetic', caseId, bytes: bytes.length, sha256: await bloBrowserSha256(bytes) } }
}

function describeOutcome(record: BloRunRecord): string {
  const outcome = record.outcome
  if (outcome.status === 'completed') return `completed / ${record.result?.status ?? '-'}`
  if (outcome.status === 'failed') return `failed / ${outcome.failure?.kind ?? '-'}`
  if (outcome.status === 'cancelled') return `cancelled / ${outcome.cancelReason ?? '-'}`
  return `not_run / ${record.input.preparation.refusal?.code ?? '-'}`
}

function requestToTerminal(record: BloRunRecord): string {
  const { runPostedAtMs, terminalReceivedAtMs } = record.timeline
  return runPostedAtMs === null || terminalReceivedAtMs === null ? '—' : `${Math.round(terminalReceivedAtMs - runPostedAtMs)} ms`
}

export function BuildListOptimizationBenchmarkPage({ master: providedMaster }: { master?: MasterDataRoot } = {}) {
  const master = useMemo(() => {
    if (providedMaster !== undefined) return providedMaster
    const loaded = loadMasterData()
    return loaded.ok ? loaded.data : null
  }, [providedMaster])
  const [runner] = useState<BloBenchmarkRunner | null>(() => (master === null ? null : createBloBenchmarkRunner(bloBrowserRunnerPorts(master))))
  const inputRef = useRef<BloSelectedInput | null>(null)
  const [input, setInput] = useState<BloSelectedInput | null>(null)
  const [caseId, setCaseId] = useState(BLO_SYNTHETIC_CASES[0]!.caseId)
  const [boundsId, setBoundsId] = useState(BLO_SYNTHETIC_BOUNDS[0]!.boundsId)
  const [records, setRecords] = useState<BloRunRecord[]>([])
  const [running, setRunning] = useState<BloCurrentRun | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (runner === null) return
    const select = (value: BloSelectedInput) => {
      inputRef.current = value
      setInput(value)
    }
    const api: BuildListOptimizationBenchmarkApi = {
      version: 'build-list-optimization-browser-record:1',
      environment: () => ({ ...bloBrowserEnvironment(), build: bloBenchmarkBuild() }),
      inputInfo: () => (inputRef.current === null ? null : { ...inputRef.current.identity }),
      useSynthetic: async (value) => {
        const selected = await syntheticInput(value)
        select(selected)
        return { ...selected.identity }
      },
      syntheticCases: () => BLO_SYNTHETIC_CASES.map(({ caseId: id, note }) => ({ caseId: id, note })),
      syntheticBounds: () => BLO_SYNTHETIC_BOUNDS.map(({ boundsId: id, note }) => ({ boundsId: id, note })),
      runSlot: async (spec, expected) => {
        const selected = inputRef.current
        if (selected === null || selected.identity.sha256 !== expected.inputSha256) throw new Error('The selected input is not the expected one.')
        const poll = setInterval(() => setRunning(runner.current()), 250)
        try {
          const record = await runner.run(spec, { text: selected.text, identity: selected.identity })
          return { recordId: record.recordId, outcome: record.outcome, resultStatus: record.result?.status ?? null }
        } finally {
          clearInterval(poll)
          setRunning(null)
          setRecords(runner.records())
        }
      },
      cancel: () => runner.cancelCurrent(),
      current: () => runner.current(),
      records: () => runner.records(),
      exportJson: () => runner.exportJson(),
      clear: () => {
        runner.clear()
        setRecords([])
      },
    }
    globalThis.buildListOptimizationBenchmark = api
    return () => {
      if (globalThis.buildListOptimizationBenchmark === api) globalThis.buildListOptimizationBenchmark = undefined
    }
  }, [runner])

  if (master === null) return <Alert severity="error">Master Dataを読み込めませんでした。</Alert>

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file === undefined) return
    const bytes = new Uint8Array(await file.arrayBuffer())
    const selected: BloSelectedInput = {
      inputLabel: file.name,
      text: new TextDecoder().decode(bytes),
      identity: { kind: 'export', fileName: file.name, bytes: bytes.length, sha256: await bloBrowserSha256(bytes) },
    }
    inputRef.current = selected
    setInput(selected)
  }

  const runManual = async () => {
    const api = globalThis.buildListOptimizationBenchmark
    if (api === undefined || inputRef.current === null) return
    setMessage(null)
    const bounds = bloSyntheticBounds(boundsId)
    const spec: BloSlotSpec = {
      slotId: `manual.${Date.now().toString(36)}`, purpose: 'mechanics', planned: false, inputId: inputRef.current.inputLabel.replace(/[^A-Za-z0-9._:-]/g, '_').slice(0, 64) || 'manual',
      boundsId: bounds.boundsId, bounds: bounds.bounds, cancelTrigger: null, faultInjection: null, memory: null,
    }
    try {
      await api.runSlot(spec, { inputSha256: inputRef.current.identity.sha256 })
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const download = () => {
    if (runner === null) return
    const url = URL.createObjectURL(new Blob([runner.exportJson()], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `build-list-optimization-browser-records-${Date.now()}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  const build = bloBenchmarkBuild() as { commit?: string; uncommittedBenchmarkCode?: boolean } | null
  return (
    <Stack spacing={2} sx={{ py: 3, overflowWrap: 'anywhere' }}>
      <Typography variant="h5" component="h1">作成リスト全体最適化 Browser計測（benchmark専用）</Typography>
      <Alert severity="info">
        Production計算（Production Worker Client、Production adapter、ProductionRngEngine）を計測Workerで実行します。探索上限は計測runごとに
        benchmark専用の設定messageで渡し、Productionの値ではありません。Exportはこのpageの中だけで読み、送信・保存しません。
      </Alert>
      <Typography variant="body2">
        build: {build === null ? '開発サーバー（provenanceなし）' : `${build.commit ?? '不明'}${build.uncommittedBenchmarkCode ? '（未commitの変更あり）' : ''}`}
      </Typography>
      <Box component="section" aria-labelledby="blo-input-heading">
        <Typography id="blo-input-heading" variant="h6" component="h2">入力</Typography>
        <Stack spacing={1}>
          <Button variant="outlined" component="label">
            Exportファイルを選択
            <input id="blo-export-file" type="file" accept="application/json,.json" hidden onChange={event => void onFile(event)} />
          </Button>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <TextField select size="small" label="synthetic入力" value={caseId} onChange={event => setCaseId(event.target.value)} sx={{ minWidth: 240 }}>
              {BLO_SYNTHETIC_CASES.map(entry => <MenuItem key={entry.caseId} value={entry.caseId}>{entry.caseId}</MenuItem>)}
            </TextField>
            <Button variant="outlined" onClick={() => void syntheticInput(caseId).then(selected => { inputRef.current = selected; setInput(selected) })}>synthetic入力を使う</Button>
          </Stack>
          <Typography variant="body2">
            選択中: {input === null ? 'なし' : `${input.identity.kind === 'export' ? 'Export' : 'synthetic'} ${input.inputLabel}（${input.identity.bytes} bytes、SHA-256 ${input.identity.sha256.slice(0, 12)}…）`}
          </Typography>
        </Stack>
      </Box>
      <Box component="section" aria-labelledby="blo-run-heading">
        <Typography id="blo-run-heading" variant="h6" component="h2">手動run（計画外）</Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          <TextField select size="small" label="探索上限（synthetic）" value={boundsId} onChange={event => setBoundsId(event.target.value)} sx={{ minWidth: 240 }}>
            {BLO_SYNTHETIC_BOUNDS.map(entry => <MenuItem key={entry.boundsId} value={entry.boundsId}>{entry.boundsId}</MenuItem>)}
          </TextField>
          <Button variant="contained" disabled={input === null || running !== null} onClick={() => void runManual()}>実行</Button>
          <Button variant="outlined" disabled={running === null} onClick={() => runner?.cancelCurrent()}>キャンセル</Button>
        </Stack>
        {running !== null && <Typography variant="body2" role="status">実行中: {running.slotId}（{running.lastStage ?? '開始'}）</Typography>}
        {message !== null && <Alert severity="error">{message}</Alert>}
      </Box>
      <Box component="section" aria-labelledby="blo-records-heading">
        <Typography id="blo-records-heading" variant="h6" component="h2">記録（{records.length}件）</Typography>
        <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
          <Button variant="outlined" disabled={records.length === 0} onClick={download}>記録をダウンロード</Button>
          <Button variant="text" disabled={records.length === 0 || running !== null} onClick={() => { runner?.clear(); setRecords([]) }}>記録を消去</Button>
        </Stack>
        <Box component="ol" sx={{ pl: 3, m: 0 }}>
          {records.map(record => (
            <li key={record.recordId}>
              <Typography variant="body2">{record.slot.slotId}: {describeOutcome(record)}、request→terminal {requestToTerminal(record)}</Typography>
            </li>
          ))}
        </Box>
      </Box>
    </Stack>
  )
}
