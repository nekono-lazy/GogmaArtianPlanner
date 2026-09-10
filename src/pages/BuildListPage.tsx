import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  AlertTitle,
  Button,
  LinearProgress,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useNavigate } from 'react-router-dom'
import { PageShell } from '../components/PageShell'
import { CandidateCard } from '../components/search/CandidateCard'
import { staleReasonLabels } from '../components/search/searchPresentation'
import {
  createPlannerCompletedTargetsText,
  createPlannerExpandedStatesText,
  createPlannerReachedLimitMessages,
  plannerIncompleteSearchTitle,
  plannerOptionFields,
  plannerOptionInvalidMessage,
} from '../components/planner/plannerSearchLimitPresentation'
import { loadMasterData } from '../domain/master/loadMasterData'
import type { MasterDataRoot } from '../domain/master/masterTypes'
import type {
  BuildListEntry,
  BuildListEntryId,
  CalculationContext,
  OwnedWeapon,
  ProductionPlan,
  TargetWeapon,
} from '../domain/models/publicTypes'
import type {
  PlannerInput,
  PlannerOptions,
  PlannerOrchestrationResult,
  PlannerProgress,
  PlannerSearchTermination,
  PlannerWarning,
} from '../domain/planner'
import {
  defaultPlannerOptions,
  defaultPlannerOrchestrationBounds,
} from '../domain/planner'
import { useSettingsStore } from '../stores/settingsStore'
import { buildListService } from '../services/buildList/buildListService'
import { createBuildListCalculationContext } from '../services/buildList/createBuildListCalculationContext'
import {
  createPlannerCalculationContext,
  createPlannerInput,
} from '../services/planner/createPlannerInput'
import { plannerResultPersistenceService } from '../services/planner/plannerResultPersistenceService'
import {
  createProductionPlannerWorkerClient,
  PlannerCancelledError,
  type PlannerWorkerClient,
} from '../services/planner/plannerWorkerClient'

const loadedMaster = loadMasterData()
const defaultMaster = loadedMaster.ok ? loadedMaster.data : null

export interface BuildListPageDependencies {
  master: MasterDataRoot
  createWorkerClient(): PlannerWorkerClient
  refresh(calculationContext: CalculationContext): Promise<{ entries: BuildListEntry[]; targets: TargetWeapon[]; ownedWeapons: OwnedWeapon[] }>
  createInput(calculationContext: CalculationContext): Promise<PlannerInput>
  /**
   * Persists the whole `PlannerOrchestrationResult` through the B8-D2a
   * atomic boundary (PLANNER_SPEC 9.2.15).
   *
   * The complete result is passed, never only its Plan: the generated
   * BuildListEntries and the ProductionPlan must be written in one
   * transaction, and a `plan === null` result carrying generated Entries is an
   * invariant violation only that service may judge. It returns the stored
   * Plan, or `null` when the calculation produced no Plan.
   */
  savePlannerResult(
    result: PlannerOrchestrationResult,
    currentCalculationContext: CalculationContext,
  ): Promise<ProductionPlan | null>
  deleteEntry(id: BuildListEntryId): Promise<void>
}

function createDefaultDependencies(master: MasterDataRoot): BuildListPageDependencies {
  return {
    master,
    createWorkerClient: createProductionPlannerWorkerClient,
    refresh: (calculationContext) =>
      buildListService.refreshStaleness(calculationContext),
    createInput: (calculationContext) =>
      createPlannerInput(master, calculationContext),
    savePlannerResult: (result, currentCalculationContext) =>
      plannerResultPersistenceService.savePlannerOrchestrationResult(
        result,
        currentCalculationContext,
      ),
    deleteEntry: (id) => buildListService.deleteEntry(id),
  }
}

const defaultDependencies: BuildListPageDependencies | null = defaultMaster
  ? createDefaultDependencies(defaultMaster)
  : null

/**
 * The Build List detail settings hold raw strings, so an in-progress or invalid
 * entry stays visible instead of being silently coerced.
 *
 * A `PlannerOptions` value is only produced when every field is a positive
 * integer, so `NaN`, `0`, a negative number, a fraction and an empty field can
 * never reach `PlannerInput.options` (UI_FLOW 10.0).
 */
type PlannerOptionInputs = Record<keyof PlannerOptions, string>

function createPlannerOptionInputs(options: PlannerOptions): PlannerOptionInputs {
  return {
    maxPlanSteps: String(options.maxPlanSteps),
    beamWidth: String(options.beamWidth),
    maxExpandedStates: String(options.maxExpandedStates),
  }
}

function parsePlannerOptionValue(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const value = Number(trimmed)
  return Number.isInteger(value) && value >= 1 ? value : null
}

function parsePlannerOptions(inputs: PlannerOptionInputs): PlannerOptions | null {
  const maxPlanSteps = parsePlannerOptionValue(inputs.maxPlanSteps)
  const beamWidth = parsePlannerOptionValue(inputs.beamWidth)
  const maxExpandedStates = parsePlannerOptionValue(inputs.maxExpandedStates)
  return maxPlanSteps === null || beamWidth === null || maxExpandedStates === null
    ? null
    : { maxPlanSteps, beamWidth, maxExpandedStates }
}

interface BuildListPageProps { dependencies?: BuildListPageDependencies }

export function BuildListPage({ dependencies = defaultDependencies ?? undefined }: BuildListPageProps) {
  const debugMode = useSettingsStore((state) => state.debugMode)
  const navigate = useNavigate()
  const [entries, setEntries] = useState<BuildListEntry[]>([])
  const [targets, setTargets] = useState<TargetWeapon[]>([])
  const [ownedWeapons, setOwnedWeapons] = useState<OwnedWeapon[]>([])
  const [loading, setLoading] = useState(dependencies !== undefined)
  const [planning, setPlanning] = useState(false)
  const [progress, setProgress] = useState<PlannerProgress | null>(null)
  const [warnings, setWarnings] = useState<PlannerWarning[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [optionInputs, setOptionInputs] = useState<PlannerOptionInputs>(() =>
    createPlannerOptionInputs(defaultPlannerOptions),
  )
  // A search a `PlannerOptions` bound truncated. It is held separately from
  // `warnings` because it is the typed result, not a diagnostic message.
  const [incompleteSearch, setIncompleteSearch] =
    useState<PlannerSearchTermination | null>(null)
  const [error, setError] = useState<string | null>(
    dependencies ? null : 'マスターデータを読み込めません。',
  )
  const clientRef = useRef<PlannerWorkerClient | null>(null)
  const activeRequestRef = useRef<string | null>(null)
  const masterForDisplay = dependencies?.master ?? defaultMaster
  const plannerOptions = useMemo(
    () => parsePlannerOptions(optionInputs),
    [optionInputs],
  )

  useEffect(() => {
    let active = true
    if (!dependencies) {
      return
    }
    const client = dependencies.createWorkerClient()
    clientRef.current = client
    const calculationContext = createBuildListCalculationContext(dependencies.master)
    void dependencies.refresh(calculationContext).then((loaded) => {
      if (!active) return
      setEntries(loaded.entries)
      setTargets(loaded.targets)
      setOwnedWeapons(loaded.ownedWeapons)
    }).catch((caught: unknown) => {
      if (active) setError(caught instanceof Error ? caught.message : 'ビルドリストの読み込みに失敗しました。')
    }).finally(() => { if (active) setLoading(false) })
    return () => {
      active = false
      activeRequestRef.current = null
      client.dispose()
      clientRef.current = null
    }
  }, [dependencies])

  const startPlanning = async () => {
    if (!dependencies || !clientRef.current || plannerOptions === null) return
    const client = clientRef.current
    const requestId = globalThis.crypto?.randomUUID?.() ?? `planner-${Date.now()}`
    activeRequestRef.current = requestId
    setPlanning(true)
    setProgress({
      expandedStates: 0,
      maxExpandedStates: plannerOptions.maxExpandedStates,
    })
    setWarnings([])
    setNotice(null)
    setError(null)
    setIncompleteSearch(null)
    try {
      const calculationContext = createPlannerCalculationContext(
        dependencies.master,
        client.engineVersion,
      )
      const createdInput = await dependencies.createInput(calculationContext)
      if (activeRequestRef.current !== requestId) return
      // The Application caller is the Beam Search bound authority: the values
      // the user reviewed in the detail settings are written into
      // `PlannerInput.options` here, and neither the Worker Client nor the
      // Worker substitutes a default of its own (PLANNER_SPEC 7.2.1).
      const input: PlannerInput = {
        ...createdInput,
        options: { ...plannerOptions },
      }
      // B8-D2b: the Application caller is what decides to pass the Production
      // orchestration bounds. The Worker Client applies no default of its own.
      const result = await client.createConstrainedPlan(
        requestId,
        input,
        defaultPlannerOrchestrationBounds,
        {
          onProgress: (nextProgress) => {
            if (activeRequestRef.current === requestId) setProgress(nextProgress)
          },
        },
      )
      if (activeRequestRef.current !== requestId) return
      setWarnings(result.warnings)
      // A `PlannerOptions` bound truncated the search, so its best state is a
      // partial Beam Search artifact rather than a finished production plan.
      // It is never saved and never opened: the user is told which bound was
      // reached and asked to raise it (PLANNER_SPEC 7.2.1). The typed status
      // decides this, never a warning message.
      if (result.termination.status === 'incomplete') {
        setIncompleteSearch(result.termination)
        return
      }
      // Rebuilt at save time rather than reusing the Planner-start context, so
      // the compatibility check is against current state, not the state the
      // calculation started from (PLANNER_SPEC 9.2.15).
      const saveCalculationContext = createPlannerCalculationContext(
        dependencies.master,
        client.engineVersion,
      )
      // The complete result is always handed over, `plan === null` included:
      // a no-Plan result carrying generated Entries is an invariant violation
      // the Persistence service fails closed on, and only it may judge that.
      const savedPlan = await dependencies.savePlannerResult(
        result,
        saveCalculationContext,
      )
      if (activeRequestRef.current !== requestId) return
      // Persistence, not the Worker result, is the success authority: the
      // stored Plan's own id is the only navigation target, never the Worker
      // result's Plan id, the Active Plan, or the latest Plan.
      if (savedPlan) {
        void navigate(`/plans/${savedPlan.id}`)
      } else {
        setNotice('現在の入力から作成できる生産計画はありませんでした。')
      }
    } catch (caught: unknown) {
      if (activeRequestRef.current !== requestId || caught instanceof PlannerCancelledError) return
      setError(caught instanceof Error ? caught.message : '生産計画の作成に失敗しました。')
    } finally {
      if (activeRequestRef.current === requestId) {
        activeRequestRef.current = null
        setPlanning(false)
      }
    }
  }

  const cancelPlanning = () => {
    const requestId = activeRequestRef.current
    if (!requestId) return
    activeRequestRef.current = null
    clientRef.current?.cancelPlan(requestId)
    setPlanning(false)
    setNotice('生産計画の作成をキャンセルしました。')
  }

  const remove = async (id: BuildListEntryId) => {
    if (!dependencies) return
    try {
      await dependencies.deleteEntry(id)
      setEntries((current) => current.filter((entry) => entry.id !== id))
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'ビルドリストから削除できませんでした。')
    }
  }

  return (
    <PageShell title="ビルドリスト" description="生産計画で検討する候補を確認します。">
      <Stack spacing={3}>
        {loading && <LinearProgress aria-label="ビルドリストを読み込み中" />}
        {error && <Alert severity="error">{error}</Alert>}
        {notice && <Alert severity="info">{notice}</Alert>}
        {incompleteSearch && (
          <Alert severity="warning">
            <AlertTitle>{plannerIncompleteSearchTitle}</AlertTitle>
            {createPlannerReachedLimitMessages(incompleteSearch).map((message) => (
              <Typography variant="body2" key={message}>{message}</Typography>
            ))}
            <Typography variant="body2">{createPlannerExpandedStatesText(incompleteSearch)}</Typography>
            <Typography variant="body2">{createPlannerCompletedTargetsText(incompleteSearch)}</Typography>
          </Alert>
        )}
        {warnings.length > 0 && <Alert severity="warning"><Typography variant="subtitle2">Planner警告</Typography>{warnings.map((warning, index) => <Typography variant="body2" key={`${warning.kind}:${index}`}>{warning.message}</Typography>)}</Alert>}
        {!loading && !error && entries.length === 0 && <Alert severity="info">ビルドリストは空です。検索結果から候補を追加してください。</Alert>}
        {!loading && entries.length > 0 && (
          <Accordion>
            <AccordionSummary><Typography>詳細設定</Typography></AccordionSummary>
            <AccordionDetails>
              <Stack spacing={2}>
                {plannerOptionFields.map(({ key, label, helperText }) => {
                  const invalid = parsePlannerOptionValue(optionInputs[key]) === null
                  return (
                    <TextField
                      key={key}
                      label={label}
                      type="number"
                      value={optionInputs[key]}
                      error={invalid}
                      helperText={invalid ? plannerOptionInvalidMessage : helperText}
                      onChange={(event) =>
                        setOptionInputs((current) => ({
                          ...current,
                          [key]: event.target.value,
                        }))
                      }
                      slotProps={{ htmlInput: { min: 1, step: 1 } }}
                    />
                  )
                })}
                <Button
                  onClick={() =>
                    setOptionInputs(createPlannerOptionInputs(defaultPlannerOptions))
                  }
                >既定値に戻す</Button>
              </Stack>
            </AccordionDetails>
          </Accordion>
        )}
        {!loading && entries.length > 0 && <Button variant="contained" disabled={planning || plannerOptions === null} onClick={() => void startPlanning()}>生産計画を作成</Button>}
        {planning && progress && <Stack spacing={1}><Typography>計画中 {progress.expandedStates} / {progress.maxExpandedStates}</Typography><LinearProgress variant="determinate" value={progress.maxExpandedStates > 0 ? progress.expandedStates / progress.maxExpandedStates * 100 : 0} /><Button onClick={cancelPlanning}>キャンセル</Button></Stack>}
        {entries.map((entry) => {
          const target = targets.find(({ id }) => id === entry.targetWeaponId) ?? null
          return <Stack spacing={1} key={entry.id}>
            <Typography variant="h2">{target?.name ?? '削除済みの目標武器'}</Typography>
            {entry.isStale && <Alert severity="warning"><Typography variant="subtitle2">再検索が必要</Typography>{entry.staleReasons.map((reason) => <Typography variant="body2" key={reason}>{staleReasonLabels[reason]}</Typography>)}</Alert>}
            {masterForDisplay && <CandidateCard candidate={entry.candidateSnapshot} target={target} master={masterForDisplay} ownedWeapons={ownedWeapons} debugMode={debugMode} />}
            {debugMode && <Alert severity="info">targetDefinitionHash: {entry.targetDefinitionHash}</Alert>}
            <Typography variant="caption">追加日時: {entry.createdAt}</Typography>
            <Button color="error" variant="outlined" onClick={() => void remove(entry.id)}>ビルドリストから削除</Button>
          </Stack>
        })}
      </Stack>
    </PageShell>
  )
}
