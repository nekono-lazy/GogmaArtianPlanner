import { CURRENT_CALCULATION_APP_SCHEMA_VERSION } from '../domain/models/publicTypes'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Button,
  FormControl,
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
import type {
  BuildCandidate,
  CalculationContext,
  CompromiseCheckpointGroup,
  CompromiseCheckpointOpportunity,
  CompromiseCheckpointOpportunityId,
  OwnedWeapon,
  TargetWeapon,
} from '../domain/models/publicTypes'
import type {
  CandidateRouteFilter,
  CandidateSearchInput,
  CandidateSearchNoticeSeverity,
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
import {
  candidateSearchNoticeSeverityLabels,
  candidateSearchProgressPhaseLabels,
  routeKindLabels,
  skippedRouteReasonLabels,
} from '../presentation/labels'

const loadedMaster = loadMasterData()
const defaultMaster = loadedMaster.ok ? loadedMaster.data : null

/** Notices are rendered info-first, so the successful-search case reads first. */
const noticeSeverities: readonly CandidateSearchNoticeSeverity[] = ['info', 'warning']

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
    targetWeaponId: TargetWeapon['id']
    routeFilter: CandidateRouteFilter
    settings: CandidateSearchSettings
    master: MasterDataRoot
    calculationContext: CalculationContext
  }): Promise<CandidateSearchInput>
  saveCandidates(targetId: TargetWeapon['id'], candidates: BuildCandidate[]): Promise<unknown>
  addCandidate(
    candidate: BuildCandidate,
    target: TargetWeapon,
    selectedCheckpointOpportunityIds: readonly CompromiseCheckpointOpportunityId[],
  ): Promise<{ added: boolean }>
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
      addCandidate: async (candidate, target, selectedCheckpointOpportunityIds) => {
        const result = await buildListService.addCandidate(
          candidate,
          target,
          selectedCheckpointOpportunityIds,
        )
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
  const [targetWeaponId, setTargetWeaponId] = useState<TargetWeapon['id'] | ''>('')
  const [routeFilter, setRouteFilter] = useState<CandidateRouteFilter>('all')
  // Checkpoints always start unselected: choosing none means "go straight to
  // the Ideal result" (`docs/UI_FLOW.md` 9).
  const [selectedCheckpointIds, setSelectedCheckpointIds] = useState<
    CompromiseCheckpointOpportunityId[]
  >([])
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
        setTargetWeaponId(loadedTargets.find(({ isEnabled }) => isEnabled)?.id ?? '')
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
    if (!dependencies || !clientRef.current || targetWeaponId === '') return
    const requestId = createSearchRunId()
    const client = clientRef.current
    activeRequestRef.current = requestId
    setSearching(true)
    setError(null)
    setNotice(null)
    setResult(null)
    setSelectedCheckpointIds([])
    setProgress({
      targetWeaponId,
      phase: 'preparing',
      processedWorkItems: 0,
    })
    try {
      const calculationContext: CalculationContext = {
        gameVersion: dependencies.master.manifest.gameVersion,
        masterDataVersion: dependencies.master.manifest.dataVersion,
        rngEngineVersion: client.engineVersion,
        appSchemaVersion: CURRENT_CALCULATION_APP_SCHEMA_VERSION,
      }
      const input = await dependencies.createInput({
        searchRunId: requestId,
        targetWeaponId,
        routeFilter,
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
      await dependencies.saveCandidates(
        completed.targetResult.targetWeaponId,
        completed.targetResult.candidate === null ? [] : [completed.targetResult.candidate],
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

  /**
   * At most one opportunity may be selected per checkpoint group, so choosing a
   * different arrival at the same compromise product replaces the previous one
   * rather than adding a second (`docs/DATA_MODEL.md` 9.4).
   */
  const toggleCheckpoint = (
    group: CompromiseCheckpointGroup,
    opportunity: CompromiseCheckpointOpportunity,
    selected: boolean,
  ) => {
    const groupIds = new Set(group.opportunities.map(({ id }) => id))
    setSelectedCheckpointIds((current) => {
      const kept = current.filter((id) => !groupIds.has(id))
      return selected ? [...kept, opportunity.id] : kept
    })
  }

  const addToBuildList = async (candidate: BuildCandidate) => {
    const target = targetById.get(candidate.targetWeaponId)
    if (!dependencies || !target) {
      setError('候補に対応する目標武器が見つかりません。')
      return
    }
    try {
      const added = await dependencies.addCandidate(candidate, target, selectedCheckpointIds)
      // An equivalent Candidate already in the Build List keeps its own
      // checkpoint selection: the Search screen never silently overwrites it
      // (`docs/UI_FLOW.md` 6.5).
      setNotice(
        added.added
          ? 'ビルドリストへ追加しました。'
          : 'この候補は作成リストに追加済みです。チェックポイントは作成リストで変更してください。',
      )
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
              {/* One Target per search: reconciling several Targets is the
                  Production Planner's job (`docs/UI_FLOW.md` 6.1). */}
              <FormControl fullWidth>
                <InputLabel id="target-weapon-label">検索対象の目標武器</InputLabel>
                <Select
                  labelId="target-weapon-label"
                  label="検索対象の目標武器"
                  value={targetWeaponId}
                  onChange={(event) => setTargetWeaponId(event.target.value as TargetWeapon['id'])}
                >
                  {enabledTargets.map((target) => (
                    <MenuItem value={target.id} key={target.id}>{target.name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl fullWidth><InputLabel id="route-filter-label">作成ルート</InputLabel><Select labelId="route-filter-label" label="作成ルート" value={routeFilter} onChange={(event) => setRouteFilter(event.target.value as CandidateRouteFilter)}><MenuItem value="all">すべて</MenuItem><MenuItem value="normal_artian">通常アーティア経由</MenuItem><MenuItem value="existing_gogma">所持巨戟アーティア経由</MenuItem></Select></FormControl>
              <Accordion><AccordionSummary><Typography>詳細設定</Typography></AccordionSummary><AccordionDetails><Stack spacing={2}>
                <TextField label="通常アーティア最大進行量" type="number" value={settings.maxNormalAdvance} onChange={(event) => updateSetting('maxNormalAdvance', event.target.value)} slotProps={{ htmlInput: { min: 1 } }} />
                <TextField label="巨戟最大進行量" type="number" value={settings.maxGogmaAdvance} onChange={(event) => updateSetting('maxGogmaAdvance', event.target.value)} slotProps={{ htmlInput: { min: 1 } }} />
                <TextField label="スキル最大進行量" type="number" value={settings.maxSkillAdvance} onChange={(event) => updateSetting('maxSkillAdvance', event.target.value)} slotProps={{ htmlInput: { min: 1 } }} />
              </Stack></AccordionDetails></Accordion>
              <Button variant="contained" onClick={() => void startSearch()} disabled={searching || targetWeaponId === ''}>検索開始</Button>
            </Stack>
          </Paper>
        )}
        {searching && progress && (
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack spacing={1}>
              {/* Work inside one Target is discovered while searching, so it is
                  never converted into a percent. */}
              <LinearProgress aria-label="候補検索の進捗" />
              <Typography variant="body2">対象: {targetById.get(progress.targetWeaponId)?.name ?? '不明'}</Typography>
              <Typography variant="body2">{candidateSearchProgressPhaseLabels[progress.phase]}</Typography>
              <Typography variant="body2">探索ステップ: {progress.processedWorkItems}</Typography>
              <Button onClick={cancelSearch}>キャンセル</Button>
            </Stack>
          </Paper>
        )}
        {result && noticeSeverities.map((severity) => {
          // Grouped by severity so a search that merely used a narrower method
          // is never read as a failed search.
          const notices = result.warnings.filter((warning) => warning.severity === severity)
          if (notices.length === 0) return null
          return (
            <Alert severity={severity} key={severity}>
              <Typography variant="subtitle2">{candidateSearchNoticeSeverityLabels[severity]}</Typography>
              {notices.map((notice, index) => (
                <Typography
                  variant="body2"
                  sx={{ whiteSpace: 'pre-line' }}
                  key={`${notice.targetWeaponId}:${index}`}
                >
                  {notice.message}
                </Typography>
              ))}
            </Alert>
          )
        })}
        {result && masterForDisplay && (() => {
          const targetResult = result.targetResult
          const target = targetById.get(targetResult.targetWeaponId) ?? null
          return <Stack spacing={2}><Typography variant="h2">{target?.name ?? '不明な目標武器'}</Typography>
            {/* No Ideal inside the configured extent is never a statement that
                no Ideal exists, and a compromise state found on the way is
                deliberately not offered: only a strict prefix of a real Ideal
                Route can be a checkpoint (`docs/SEARCH_SPEC.md` 5.7). */}
            {targetResult.candidate === null && <Alert severity="info">
              現在の探索範囲では理想品が見つかりませんでした。詳細設定の「通常アーティア最大進行量」「巨戟最大進行量」「スキル最大進行量」を見直してください。
            </Alert>}
            {targetResult.candidate && <CandidateCard
              candidate={targetResult.candidate}
              target={target}
              master={masterForDisplay}
              ownedWeapons={ownedWeapons}
              debugMode={debugMode}
              selectedCheckpointOpportunityIds={selectedCheckpointIds}
              onToggleCheckpoint={toggleCheckpoint}
              onAdd={(selected) => void addToBuildList(selected)}
            />}
            {targetResult.skippedRoutes.length > 0 && <Accordion><AccordionSummary><Typography>実行できなかった作成ルート</Typography></AccordionSummary><AccordionDetails><Stack spacing={1}>{targetResult.skippedRoutes.map((skipped, index) => <Alert severity={skipped.reason === 'master_data_unavailable' ? 'warning' : 'info'} key={`${skipped.route}:${skipped.reason}:${index}`}>{routeKindLabels[skipped.route]}: {skippedRouteReasonLabels[skipped.reason]}</Alert>)}</Stack></AccordionDetails></Accordion>}</Stack>
        })()}
      </Stack>
    </PageShell>
  )
}
