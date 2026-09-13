import { CURRENT_CALCULATION_APP_SCHEMA_VERSION } from '../domain/models/publicTypes'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  Alert,
  AlertTitle,
  Box,
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
import { DisclosureAccordion } from '../components/DisclosureAccordion'
import { PageShell } from '../components/PageShell'
import { StatusChip } from '../components/StatusChip'
import { CandidateCard } from '../components/search/CandidateCard'
import { MasterDataStatusAlert } from '../components/MasterDataStatusAlert'
import { loadMasterData } from '../domain/master/loadMasterData'
import type { MasterDataRoot } from '../domain/master/masterTypes'
import type {
  BuildCandidate,
  BuildListEntry,
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
import { isSameBuildListCandidate } from '../domain/buildList'
import {
  buildCandidateRepository,
  buildListEntryRepository,
  ownedWeaponRepository,
  targetWeaponRepository,
} from '../db/repositories'
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
  /**
   * Read-only Build List entries, used only to show whether an equivalent
   * Candidate is already added (`docs/UI_FLOW.md` 9 「作成リスト追加状態」).
   */
  getBuildListEntries(): Promise<BuildListEntry[]>
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
  ): Promise<{ entry: BuildListEntry; added: boolean }>
}

const defaultDependencies: SearchPageDependencies | null = defaultMaster
  ? {
      master: defaultMaster,
      getTargets: () => targetWeaponRepository.getAllTargetWeapons(),
      getOwnedWeapons: () => ownedWeaponRepository.getAllOwnedWeapons(),
      getBuildListEntries: () => buildListEntryRepository.getAllBuildListEntries(),
      createWorkerClient: createProductionSearchWorkerClient,
      createInput: (options) => createCandidateSearchInput(options),
      saveCandidates: (targetId, candidates) =>
        buildCandidateRepository.replaceBuildCandidatesForTarget(targetId, candidates),
      // The Service result (existing or new Entry, plus whether it was added)
      // is passed through unchanged; its duplicate protection stays the
      // Domain authority.
      addCandidate: (candidate, target, selectedCheckpointOpportunityIds) =>
        buildListService.addCandidate(candidate, target, selectedCheckpointOpportunityIds),
    }
  : null

interface SearchPageProps {
  dependencies?: SearchPageDependencies
}

/** Feedback about the last Build List addition, shown beside the Candidate. */
interface AddFeedback {
  severity: 'info' | 'error'
  message: string
}

/** The three user-adjustable search bounds (`docs/SEARCH_SPEC.md` 3.1). */
const settingFields: readonly {
  key: keyof CandidateSearchSettings
  label: string
  helperText: string
}[] = [
  {
    key: 'maxNormalAdvance',
    label: '通常アーティア最大進行量',
    helperText: '通常アーティアを作成する最大本数（1以上）',
  },
  {
    key: 'maxGogmaAdvance',
    label: '巨戟最大進行量',
    helperText: '復元ボーナスの再抽選を進める最大回数',
  },
  {
    key: 'maxSkillAdvance',
    label: 'スキル最大進行量',
    helperText: 'スキルリセットを進める最大回数',
  },
]

export function SearchPage({ dependencies = defaultDependencies ?? undefined }: SearchPageProps) {
  const debugMode = useSettingsStore((state) => state.debugMode)
  const conditionsHeadingId = useId()
  const progressHeadingId = useId()
  const resultHeadingId = useId()
  const [targets, setTargets] = useState<TargetWeapon[]>([])
  const [ownedWeapons, setOwnedWeapons] = useState<OwnedWeapon[]>([])
  // Read-only mirror of the Build List, kept only to show the add state of
  // the displayed Candidate. It never feeds a checkpoint selection back into
  // this screen's own draft selection.
  const [buildListEntries, setBuildListEntries] = useState<BuildListEntry[]>([])
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
  // The three failure sources stay separate so a load failure is never read as
  // "no Targets", and a search or Build List failure stays next to its action.
  const [loadError, setLoadError] = useState<string | null>(
    dependencies ? null : 'マスターデータを読み込めません。',
  )
  const [searchError, setSearchError] = useState<string | null>(null)
  const [searchNotice, setSearchNotice] = useState<string | null>(null)
  const [addFeedback, setAddFeedback] = useState<AddFeedback | null>(null)
  const clientRef = useRef<SearchWorkerClient | null>(null)
  const activeRequestRef = useRef<string | null>(null)

  useEffect(() => {
    if (!dependencies) {
      return
    }
    clientRef.current = dependencies.createWorkerClient()
    let active = true
    // The Build List is part of the screen's base data: the add state is a
    // formal display item, so a failure to read it is a load failure like any
    // other rather than a silent "not added".
    void Promise.all([
      dependencies.getTargets(),
      dependencies.getOwnedWeapons(),
      dependencies.getBuildListEntries(),
    ])
      .then(([loadedTargets, loadedWeapons, loadedEntries]) => {
        if (!active) return
        setTargets(loadedTargets)
        setOwnedWeapons(loadedWeapons)
        setBuildListEntries(loadedEntries)
        setTargetWeaponId(loadedTargets.find(({ isEnabled }) => isEnabled)?.id ?? '')
      })
      .catch((caught: unknown) => {
        if (active) setLoadError(caught instanceof Error ? caught.message : '検索データの読み込みに失敗しました。')
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
    setSearchError(null)
    setSearchNotice(null)
    setAddFeedback(null)
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
      setSearchError(caught instanceof Error ? caught.message : '検索に失敗しました。')
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
    setSearchNotice('検索をキャンセルしました。')
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
      setAddFeedback({ severity: 'error', message: '候補に対応する目標武器が見つかりません。' })
      return
    }
    try {
      const added = await dependencies.addCandidate(candidate, target, selectedCheckpointIds)
      // The Entry the Service returned (new or already existing) is mirrored
      // so the add state updates at once; the Entry's own checkpoint
      // selection is never copied back into this screen's draft.
      setBuildListEntries((current) =>
        current.some((entry) => entry.id === added.entry.id) ? current : [...current, added.entry],
      )
      // An equivalent Candidate already in the Build List keeps its own
      // checkpoint selection: the Search screen never silently overwrites it
      // (`docs/UI_FLOW.md` 9).
      setAddFeedback({
        severity: 'info',
        message: added.added
          ? 'ビルドリストへ追加しました。'
          : 'この候補は作成リストに追加済みです。チェックポイントは作成リストで変更してください。',
      })
    } catch (caught: unknown) {
      setAddFeedback({
        severity: 'error',
        message: caught instanceof Error ? caught.message : 'ビルドリストへの追加に失敗しました。',
      })
    }
  }

  const progressTarget = progress ? targetById.get(progress.targetWeaponId) : undefined

  return (
    <PageShell title="候補検索" description="目標武器ごとに、理想品へ到達する作成ルートを検索して作成リストへ追加します。">
      <Stack spacing={{ xs: 2, md: 3 }}>
        {masterForDisplay && <MasterDataStatusAlert master={masterForDisplay} feature="search" />}
        {loading && <LinearProgress aria-label="検索データを読み込み中" />}
        {/* A failed load shows only the failure: no synthetic data, and no
            "register a Target" empty state that would read as empty data. */}
        {loadError && <Alert severity="error">{loadError}</Alert>}
        {!loading && !loadError && enabledTargets.length === 0 && (
          <Alert severity="info">目標武器を登録してください。</Alert>
        )}
        {!loadError && enabledTargets.length > 0 && (
          <Paper
            component="section"
            variant="outlined"
            aria-labelledby={conditionsHeadingId}
            sx={{ p: { xs: 2, md: 2.5 }, minWidth: 0 }}
          >
            <Stack spacing={2}>
              <Box>
                <Typography id={conditionsHeadingId} component="h2" variant="h2">
                  検索条件
                </Typography>
                {/* One Target per search: reconciling several Targets is the
                    Production Planner's job (`docs/UI_FLOW.md` 9). */}
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  1回の検索は目標武器1件が対象です。理想品へ到達する作成ルートを探し、途中で妥協条件を満たす状態があればそのルート上のチェックポイントとして表示します。チェックポイントを選ばなければ理想品まで進みます。
                </Typography>
              </Box>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))' },
                  gap: 2,
                }}
              >
                <FormControl fullWidth sx={{ minWidth: 0 }}>
                  <InputLabel id="target-weapon-label">検索対象の目標武器</InputLabel>
                  <Select
                    labelId="target-weapon-label"
                    label="検索対象の目標武器"
                    value={targetWeaponId}
                    onChange={(event) => setTargetWeaponId(event.target.value as TargetWeapon['id'])}
                    // A long Target name wraps inside the control instead of
                    // being clipped or widening the page.
                    sx={{ '& .MuiSelect-select': { whiteSpace: 'normal', overflowWrap: 'anywhere' } }}
                  >
                    {enabledTargets.map((target) => (
                      <MenuItem value={target.id} key={target.id} sx={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
                        {target.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControl fullWidth sx={{ minWidth: 0 }}>
                  <InputLabel id="route-filter-label">作成ルート</InputLabel>
                  <Select
                    labelId="route-filter-label"
                    label="作成ルート"
                    value={routeFilter}
                    onChange={(event) => setRouteFilter(event.target.value as CandidateRouteFilter)}
                  >
                    <MenuItem value="all">すべて</MenuItem>
                    <MenuItem value="normal_artian">通常アーティア経由</MenuItem>
                    <MenuItem value="existing_gogma">所持巨戟アーティア経由</MenuItem>
                  </Select>
                </FormControl>
              </Box>
              <DisclosureAccordion title="詳細設定（探索量の上限）" headingLevel="h3">
                <Stack spacing={1.5}>
                  <Typography variant="body2" color="text.secondary">
                    探索する進行量の上限です。上限を上げると見つかる候補が増える場合がありますが、検索に時間がかかります。
                  </Typography>
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(3, minmax(0, 1fr))' },
                      gap: 1.5,
                    }}
                  >
                    {settingFields.map((field) => (
                      <TextField
                        key={field.key}
                        fullWidth
                        label={field.label}
                        helperText={field.helperText}
                        type="number"
                        value={settings[field.key]}
                        onChange={(event) => updateSetting(field.key, event.target.value)}
                        slotProps={{ htmlInput: { min: 1, step: 1 } }}
                      />
                    ))}
                  </Box>
                </Stack>
              </DisclosureAccordion>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1.5}
                sx={{ alignItems: { xs: 'stretch', sm: 'center' } }}
              >
                <Button
                  variant="contained"
                  onClick={() => void startSearch()}
                  disabled={searching || targetWeaponId === ''}
                  sx={{ minHeight: 44, px: 3 }}
                >
                  検索開始
                </Button>
                <Typography variant="body2" color="text.secondary">
                  検索中は進捗を表示し、いつでもキャンセルできます。
                </Typography>
              </Stack>
              {searchNotice && <Alert severity="info">{searchNotice}</Alert>}
              {searchError && <Alert severity="error">{searchError}</Alert>}
            </Stack>
          </Paper>
        )}
        {searching && progress && (
          <Paper
            component="section"
            variant="outlined"
            role="status"
            aria-live="polite"
            aria-labelledby={progressHeadingId}
            sx={{ p: { xs: 2, md: 2.5 }, minWidth: 0 }}
          >
            <Stack spacing={1.5}>
              <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
                <Typography id={progressHeadingId} component="h2" variant="h2">
                  検索中
                </Typography>
                <StatusChip label={candidateSearchProgressPhaseLabels[progress.phase]} tone="info" />
              </Stack>
              {/* Work inside one Target is discovered while searching, so it is
                  never converted into a percent. */}
              <LinearProgress aria-label="候補検索の進捗" />
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={{ xs: 0.5, sm: 3 }}
                useFlexGap
                sx={{ flexWrap: 'wrap' }}
              >
                <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                  対象: {progressTarget?.name ?? '不明'}
                </Typography>
                <Typography variant="body2" className="tabular-nums">
                  探索ステップ: {progress.processedWorkItems}
                </Typography>
              </Stack>
              <Typography variant="caption" color="text.secondary">
                探索ステップの総数は検索中に増えるため、進捗率は表示しません。
              </Typography>
              <Button
                variant="outlined"
                onClick={cancelSearch}
                sx={{ minHeight: 44, alignSelf: { xs: 'stretch', sm: 'flex-start' } }}
              >
                キャンセル
              </Button>
            </Stack>
          </Paper>
        )}
        {result && masterForDisplay && (() => {
          const targetResult = result.targetResult
          const target = targetById.get(targetResult.targetWeaponId) ?? null
          const displayedCandidate = targetResult.candidate
          // The Build List Domain authority decides equivalence; a Candidate
          // ID differs on every search run and is never compared here.
          const buildListStatus =
            displayedCandidate === null
              ? undefined
              : buildListEntries.some((entry) => isSameBuildListCandidate(entry, displayedCandidate))
                ? 'added'
                : 'not_added'
          return (
            <Stack component="section" aria-labelledby={resultHeadingId} spacing={2} sx={{ minWidth: 0 }}>
              <Box>
                <Typography id={resultHeadingId} component="h2" variant="h2">
                  検索結果
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, overflowWrap: 'anywhere' }}>
                  目標武器: {target?.name ?? '不明な目標武器'}
                </Typography>
              </Box>
              {noticeSeverities.map((severity) => {
                // Grouped by severity so a search that merely used a narrower
                // method is never read as a failed search.
                const notices = result.warnings.filter((warning) => warning.severity === severity)
                if (notices.length === 0) return null
                return (
                  <Alert severity={severity} key={severity}>
                    <AlertTitle>{candidateSearchNoticeSeverityLabels[severity]}</AlertTitle>
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
              {/* No Ideal inside the configured extent is never a statement that
                  no Ideal exists, and a compromise state found on the way is
                  deliberately not offered: only a strict prefix of a real Ideal
                  Route can be a checkpoint (`docs/SEARCH_SPEC.md` 5.7). */}
              {targetResult.candidate === null && (
                <Alert severity="info">
                  現在の探索範囲では理想品が見つかりませんでした。探索量の上限を上げると見つかる場合があります。詳細設定の「通常アーティア最大進行量」「巨戟最大進行量」「スキル最大進行量」を見直してください。
                </Alert>
              )}
              {targetResult.candidate && (
                <CandidateCard
                  candidate={targetResult.candidate}
                  target={target}
                  master={masterForDisplay}
                  ownedWeapons={ownedWeapons}
                  debugMode={debugMode}
                  buildListStatus={buildListStatus}
                  selectedCheckpointOpportunityIds={selectedCheckpointIds}
                  onToggleCheckpoint={toggleCheckpoint}
                  onAdd={(selected) => void addToBuildList(selected)}
                  addFeedback={
                    addFeedback && <Alert severity={addFeedback.severity}>{addFeedback.message}</Alert>
                  }
                />
              )}
              {targetResult.skippedRoutes.length > 0 && (
                <DisclosureAccordion title="実行できなかった作成ルート" headingLevel="h3">
                  <Stack spacing={1.5}>
                    <Typography variant="body2" color="text.secondary">
                      現在のRNG状態、所持武器、予測エンジンの対応状況、または検索条件により、今回の検索では対象にならなかった作成ルートです（{targetResult.skippedRoutes.length}件）。
                    </Typography>
                    <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none', display: 'grid', gap: 1 }}>
                      {targetResult.skippedRoutes.map((skipped, index) => (
                        <Box
                          component="li"
                          key={`${skipped.route}:${skipped.reason}:${index}`}
                          sx={{ minWidth: 0, borderTop: index === 0 ? 0 : 1, borderColor: 'divider', pt: index === 0 ? 0 : 1 }}
                        >
                          <Typography variant="body2" sx={{ fontWeight: 500, overflowWrap: 'anywhere' }}>
                            {routeKindLabels[skipped.route]}
                          </Typography>
                          {skipped.reason === 'master_data_unavailable' ? (
                            <Alert severity="warning" sx={{ mt: 0.5 }}>
                              {skippedRouteReasonLabels[skipped.reason]}
                            </Alert>
                          ) : (
                            <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                              {skippedRouteReasonLabels[skipped.reason]}
                            </Typography>
                          )}
                        </Box>
                      ))}
                    </Box>
                  </Stack>
                </DisclosureAccordion>
              )}
            </Stack>
          )
        })()}
      </Stack>
    </PageShell>
  )
}
