import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Checkbox,
  FormControl,
  FormControlLabel,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { PageShell } from '../components/PageShell'
import { CandidateCard } from '../components/search/CandidateCard'
import { MasterDataStatusAlert } from '../components/MasterDataStatusAlert'
import { loadMasterData } from '../domain/master/loadMasterData'
import type { MasterDataRoot } from '../domain/master/masterTypes'
import type { BuildCandidate, CalculationContext, OwnedWeapon, TargetWeapon } from '../domain/models/publicTypes'
import type {
  CandidateResultFilter,
  CandidateRouteFilter,
  CandidateSearchInput,
  CandidateSearchProgress,
  CandidateSearchResult,
  CandidateSearchSettings,
} from '../domain/search'
import { defaultCandidateSearchSettings } from '../domain/search'
import { buildCandidateRepository, ownedWeaponRepository, targetWeaponRepository } from '../db/repositories'
import { useSettingsStore } from '../stores/settingsStore'
import { buildListService } from '../services/buildList/buildListService'
import { createCandidateSearchInput } from '../services/search/createCandidateSearchInput'
import {
  createProductionSearchWorkerClient,
  SearchCancelledError,
  type SearchWorkerClient,
} from '../services/search/searchWorkerClient'
import { candidateRouteFilterLabels, skippedRouteReasonLabels } from '../presentation/labels'

const loadedMaster = loadMasterData()
const defaultMaster = loadedMaster.ok ? loadedMaster.data : null

function createSearchRunId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `search-${Date.now()}`
}

export interface SearchPageDependencies {
  master: MasterDataRoot
  getTargets(): Promise<TargetWeapon[]>
  getOwnedWeapons(): Promise<OwnedWeapon[]>
  createWorkerClient(): SearchWorkerClient
  createInput(options: {
    searchRunId: string
    targetWeaponIds: TargetWeapon['id'][]
    routeFilter: CandidateRouteFilter
    resultFilter: CandidateResultFilter
    settings: CandidateSearchSettings
    master: MasterDataRoot
    calculationContext: CalculationContext
  }): Promise<CandidateSearchInput>
  saveCandidates(targetId: TargetWeapon['id'], candidates: BuildCandidate[]): Promise<unknown>
  addCandidate(candidate: BuildCandidate, target: TargetWeapon): Promise<{ added: boolean }>
}

const defaultDependencies: SearchPageDependencies | null = defaultMaster
  ? {
      master: defaultMaster,
      getTargets: () => targetWeaponRepository.getAllTargetWeapons(),
      getOwnedWeapons: () => ownedWeaponRepository.getAllOwnedWeapons(),
      createWorkerClient: createProductionSearchWorkerClient,
      createInput: (options) => createCandidateSearchInput(options),
      saveCandidates: (targetId, candidates) =>
        buildCandidateRepository.replaceBuildCandidatesForTarget(targetId, candidates),
      addCandidate: async (candidate, target) => {
        const result = await buildListService.addCandidate(candidate, target)
        return { added: result.added }
      },
    }
  : null

interface SearchPageProps {
  dependencies?: SearchPageDependencies
}

export function SearchPage({ dependencies = defaultDependencies ?? undefined }: SearchPageProps) {
  const debugMode = useSettingsStore((state) => state.debugMode)
  const [targets, setTargets] = useState<TargetWeapon[]>([])
  const [ownedWeapons, setOwnedWeapons] = useState<OwnedWeapon[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<TargetWeapon['id']>>(new Set())
  const [routeFilter, setRouteFilter] = useState<CandidateRouteFilter>('all')
  const [resultFilter, setResultFilter] = useState<CandidateResultFilter>('all')
  const [settings, setSettings] = useState<CandidateSearchSettings>({ ...defaultCandidateSearchSettings })
  const [result, setResult] = useState<CandidateSearchResult | null>(null)
  const [progress, setProgress] = useState<CandidateSearchProgress | null>(null)
  const [loading, setLoading] = useState(dependencies !== undefined)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(
    dependencies ? null : 'マスターデータを読み込めません。',
  )
  const [notice, setNotice] = useState<string | null>(null)
  const clientRef = useRef<SearchWorkerClient | null>(null)
  const activeRequestRef = useRef<string | null>(null)

  useEffect(() => {
    if (!dependencies) {
      return
    }
    clientRef.current = dependencies.createWorkerClient()
    let active = true
    void Promise.all([dependencies.getTargets(), dependencies.getOwnedWeapons()])
      .then(([loadedTargets, loadedWeapons]) => {
        if (!active) return
        setTargets(loadedTargets)
        setOwnedWeapons(loadedWeapons)
        setSelectedIds(new Set(loadedTargets.filter(({ isEnabled }) => isEnabled).map(({ id }) => id)))
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : '検索データの読み込みに失敗しました。')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
      activeRequestRef.current = null
      clientRef.current?.dispose()
      clientRef.current = null
    }
  }, [dependencies])

  const enabledTargets = useMemo(() => targets.filter(({ isEnabled }) => isEnabled), [targets])
  const targetById = useMemo(() => new Map(targets.map((target) => [target.id, target])), [targets])
  const masterForDisplay = dependencies?.master ?? defaultMaster

  const updateSetting = (key: keyof CandidateSearchSettings, raw: string) => {
    const value = Number(raw)
    setSettings((current) => ({ ...current, [key]: value }))
  }

  const startSearch = async () => {
    if (!dependencies || !clientRef.current || selectedIds.size === 0) return
    const requestId = createSearchRunId()
    const client = clientRef.current
    activeRequestRef.current = requestId
    setSearching(true)
    setError(null)
    setNotice(null)
    setResult(null)
    setProgress({ completedTargets: 0, totalTargets: selectedIds.size, currentTargetWeaponId: null })
    try {
      const calculationContext: CalculationContext = {
        gameVersion: dependencies.master.manifest.gameVersion,
        masterDataVersion: dependencies.master.manifest.dataVersion,
        rngEngineVersion: client.engineVersion,
        appSchemaVersion: 1,
      }
      const input = await dependencies.createInput({
        searchRunId: requestId,
        targetWeaponIds: [...selectedIds],
        routeFilter,
        resultFilter,
        settings,
        master: dependencies.master,
        calculationContext,
      })
      if (activeRequestRef.current !== requestId) return
      const completed = await client.startSearch(input, {
        onProgress: (nextProgress) => {
          if (activeRequestRef.current === requestId) setProgress(nextProgress)
        },
      })
      if (activeRequestRef.current !== requestId) return
      await Promise.all(
        completed.targetResults.map((targetResult) =>
          dependencies.saveCandidates(targetResult.targetWeaponId, targetResult.candidates),
        ),
      )
      if (activeRequestRef.current !== requestId) return
      setResult(completed)
    } catch (caught: unknown) {
      if (activeRequestRef.current !== requestId || caught instanceof SearchCancelledError) return
      setError(caught instanceof Error ? caught.message : '検索に失敗しました。')
    } finally {
      if (activeRequestRef.current === requestId) {
        activeRequestRef.current = null
        setSearching(false)
      }
    }
  }

  const cancelSearch = () => {
    const requestId = activeRequestRef.current
    if (!requestId) return
    activeRequestRef.current = null
    clientRef.current?.cancelSearch(requestId)
    setSearching(false)
    setNotice('検索をキャンセルしました。')
  }

  const addToBuildList = async (candidate: BuildCandidate) => {
    const target = targetById.get(candidate.targetWeaponId)
    if (!dependencies || !target) {
      setError('候補に対応する目標武器が見つかりません。')
      return
    }
    try {
      const added = await dependencies.addCandidate(candidate, target)
      setNotice(added.added ? 'ビルドリストへ追加しました。' : '同等の候補はすでにビルドリストにあります。')
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'ビルドリストへの追加に失敗しました。')
    }
  }

  return (
    <PageShell title="候補検索" description="目標武器ごとに利用可能な作成候補を検索します。">
      <Stack spacing={3}>
        {masterForDisplay && <MasterDataStatusAlert master={masterForDisplay} feature="search" />}
        {loading && <LinearProgress aria-label="検索データを読み込み中" />}
        {error && <Alert severity="error">{error}</Alert>}
        {notice && <Alert severity="info">{notice}</Alert>}
        {!loading && enabledTargets.length === 0 && <Alert severity="info">目標武器を登録してください。</Alert>}
        {enabledTargets.length > 0 && (
          <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
            <Stack spacing={3}>
              <Typography variant="h2">検索条件</Typography>
              <Box>
                <Typography variant="subtitle2">検索対象の目標武器（複数選択可）</Typography>
                {enabledTargets.map((target) => (
                  <FormControlLabel
                    key={target.id}
                    control={<Checkbox checked={selectedIds.has(target.id)} onChange={(event) => setSelectedIds((current) => {
                      const next = new Set(current)
                      if (event.target.checked) next.add(target.id)
                      else next.delete(target.id)
                      return next
                    })} />}
                    label={target.name}
                  />
                ))}
              </Box>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <FormControl fullWidth><InputLabel id="route-filter-label">作成ルート</InputLabel><Select labelId="route-filter-label" label="作成ルート" value={routeFilter} onChange={(event) => setRouteFilter(event.target.value as CandidateRouteFilter)}><MenuItem value="all">すべて</MenuItem><MenuItem value="normal_artian">通常アーティア経由</MenuItem><MenuItem value="existing_gogma">所持巨戟アーティア経由</MenuItem></Select></FormControl>
                <FormControl fullWidth><InputLabel id="result-filter-label">結果</InputLabel><Select labelId="result-filter-label" label="結果" value={resultFilter} onChange={(event) => setResultFilter(event.target.value as CandidateResultFilter)}><MenuItem value="all">すべて</MenuItem><MenuItem value="ideal">理想</MenuItem><MenuItem value="practical">実用</MenuItem><MenuItem value="similar">理想に近い実用</MenuItem></Select></FormControl>
              </Stack>
              <Accordion><AccordionSummary><Typography>詳細設定</Typography></AccordionSummary><AccordionDetails><Stack spacing={2}>
                <TextField label="通常アーティア最大進行量" type="number" value={settings.maxNormalAdvance} onChange={(event) => updateSetting('maxNormalAdvance', event.target.value)} slotProps={{ htmlInput: { min: 1 } }} />
                <TextField label="巨戟最大進行量" type="number" value={settings.maxGogmaAdvance} onChange={(event) => updateSetting('maxGogmaAdvance', event.target.value)} slotProps={{ htmlInput: { min: 1 } }} />
                <TextField label="スキル最大進行量" type="number" value={settings.maxSkillAdvance} onChange={(event) => updateSetting('maxSkillAdvance', event.target.value)} slotProps={{ htmlInput: { min: 1 } }} />
                <TextField label="目標武器ごとの最大候補数" type="number" value={settings.maxCandidatesPerTarget} onChange={(event) => updateSetting('maxCandidatesPerTarget', event.target.value)} slotProps={{ htmlInput: { min: 1 } }} />
                <TextField label="理想に近いと判定する類似度" type="number" value={settings.similarityThreshold} onChange={(event) => updateSetting('similarityThreshold', event.target.value)} slotProps={{ htmlInput: { min: 0, max: 1, step: 0.1 } }} />
              </Stack></AccordionDetails></Accordion>
              <Button variant="contained" onClick={() => void startSearch()} disabled={searching || selectedIds.size === 0}>検索開始</Button>
            </Stack>
          </Paper>
        )}
        {searching && progress && <Paper variant="outlined" sx={{ p: 2 }}><Stack spacing={1}><Typography>検索中 {progress.completedTargets} / {progress.totalTargets}</Typography><LinearProgress variant={progress.totalTargets > 0 ? 'determinate' : 'indeterminate'} value={progress.totalTargets > 0 ? progress.completedTargets / progress.totalTargets * 100 : 0} /><Typography variant="body2">現在の目標武器: {progress.currentTargetWeaponId ? targetById.get(progress.currentTargetWeaponId)?.name ?? '不明' : '準備中'}</Typography><Button onClick={cancelSearch}>キャンセル</Button></Stack></Paper>}
        {result && result.warnings.length > 0 && <Alert severity="warning"><Typography variant="subtitle2">警告</Typography>{result.warnings.map((warning, index) => <Typography variant="body2" key={`${warning.targetWeaponId}:${index}`}>{warning.message}</Typography>)}</Alert>}
        {result && masterForDisplay && result.targetResults.map((targetResult) => {
          const target = targetById.get(targetResult.targetWeaponId) ?? null
          const idealCount = targetResult.candidates.filter(({ category }) => category === 'ideal').length
          const practicalCount = targetResult.candidates.length - idealCount
          return <Stack spacing={2} key={targetResult.targetWeaponId}><Typography variant="h2">{target?.name ?? '不明な目標武器'}</Typography><Typography>理想候補 {idealCount}件 ／ 実用候補 {practicalCount}件</Typography>{targetResult.candidates.length === 0 && <Alert severity="info">条件を満たす候補は見つかりませんでした。</Alert>}{targetResult.candidates.map((candidate) => <CandidateCard key={candidate.id} candidate={candidate} target={target} master={masterForDisplay} ownedWeapons={ownedWeapons} debugMode={debugMode} onAdd={(selected) => void addToBuildList(selected)} />)}{targetResult.skippedRoutes.length > 0 && <Accordion><AccordionSummary><Typography>実行できなかった作成ルート</Typography></AccordionSummary><AccordionDetails><Stack spacing={1}>{targetResult.skippedRoutes.map((skipped, index) => <Alert severity={skipped.reason === 'master_data_unavailable' ? 'warning' : 'info'} key={`${skipped.route}:${skipped.reason}:${index}`}>{candidateRouteFilterLabels[skipped.route]}: {skippedRouteReasonLabels[skipped.reason]}</Alert>)}</Stack></AccordionDetails></Accordion>}</Stack>
        })}
      </Stack>
    </PageShell>
  )
}
