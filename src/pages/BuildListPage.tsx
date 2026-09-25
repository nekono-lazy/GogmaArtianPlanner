import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  LinearProgress,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { DisclosureAccordion } from '../components/DisclosureAccordion'
import { PageShell } from '../components/PageShell'
import { StatusChip } from '../components/StatusChip'
import { PlanBreakingChangeDialog } from '../components/execution/PlanBreakingChangeDialog'
import { savePointPositionLabel } from '../components/execution/executionStepPresentation'
import { ProductionPlanReplanPreviewPanel } from '../components/execution/ProductionPlanReplanPreviewPanel'
import { usePlanBreakingChangeApproval } from '../components/execution/usePlanBreakingChangeApproval'
import type { PlanBreakingChangeApproval, PlanBreakingChangeInspection } from '../domain/execution'
import { useProductionPlanReplanPreview } from '../components/execution/useProductionPlanReplanPreview'
import { CandidateCard } from '../components/search/CandidateCard'
import {
  createPlannerCompletedTargetsText,
  createPlannerReachedLimitMessages,
  plannerIncompleteSearchTitle,
} from '../components/planner/plannerSearchLimitPresentation'
import {
  plannerOptionInvalidMessage,
  productionPlannerDetailSettingsDescription,
  productionPlannerMaxPlanStepsField,
  productionPlannerRunningNote,
  productionPlannerRunningTitles,
} from '../components/planner/productionPlannerSettingsPresentation'
import { loadMasterData } from '../domain/master/loadMasterData'
import type { MasterDataRoot } from '../domain/master/masterTypes'
import type {
  BuildListEntry,
  BuildListEntryId,
  CalculationContext,
  IntermediateStateSelection,
  OwnedWeapon,
  ProductionPlan,
  TargetWeapon,
  TargetWeaponId,
} from '../domain/models/publicTypes'
import type {
  PlannerInput,
  PlannerOptions,
  PlannerOrchestrationResult,
  PlannerRunTermination,
  PlannerWarning,
} from '../domain/planner'
import { defaultPlannerOrchestrationBounds } from '../domain/planner'
import { defaultIntermediateStateSelection, findBuildListTargetDuplicates } from '../domain/buildList'
import { plannerWarningLabels, productionPlanStatusLabels, staleReasonLabels } from '../presentation/labels'
import { productionPlanRepository } from '../db/repositories/productionPlanRepository'
import { useSettingsStore } from '../stores/settingsStore'
import { buildListService } from '../services/buildList/buildListService'
import { createBuildListCalculationContext } from '../services/buildList/createBuildListCalculationContext'
import {
  createPlannerCalculationContext,
  createPlannerInput,
} from '../services/planner/createPlannerInput'
import { plannerResultPersistenceService } from '../services/planner/plannerResultPersistenceService'
import { recommendedBuildListMaxPlanSteps } from '../services/planner/plannerRuntimeOptions'
import {
  createProductionPlanReplanDependencies,
  type ProductionPlanReplanDependencies,
} from '../services/execution/productionPlanReplanDependencies'
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
  /** `approval` is the breaking-change approval when the inspection required one (`docs/UI_FLOW.md` 16.3). */
  deleteEntry(id: BuildListEntryId, approval?: PlanBreakingChangeApproval | null): Promise<void>
  /** The read-only breaking-change inspection of that very delete. */
  inspectEntryDelete(id: BuildListEntryId): Promise<PlanBreakingChangeInspection>
  /**
   * Replaces one Entry's intermediate state selection and improvement
   * preference.
   *
   * Editing it here is what makes a Counter conflict recoverable without
   * re-searching: the user moves a selected state to another arrival, turns
   * it off, or changes the improvement order, and runs the Planner again
   * (`docs/UI_FLOW.md` 10). `approval` is the breaking-change approval when
   * the inspection required one.
   */
  updateIntermediateStateSelection(
    id: BuildListEntryId,
    selection: IntermediateStateSelection,
    approval?: PlanBreakingChangeApproval | null,
  ): Promise<BuildListEntry>
  /** The read-only breaking-change inspection of that very selection change. */
  inspectIntermediateStateSelectionUpdate(
    id: BuildListEntryId,
    selection: IntermediateStateSelection,
  ): Promise<PlanBreakingChangeInspection>
  /**
   * The one running (`active` / `stale`) Plan, or `undefined`
   * (`docs/PLANNER_SPEC.md` 16.2). It decides which Planner entry the page
   * offers: the ordinary Draft creation, or the 16.8 replan Preview. More than
   * one running Plan is a persistence invariant violation the repository
   * reports, never something the page resolves.
   */
  getRunningProductionPlan(): Promise<ProductionPlan | undefined>
  /**
   * The one not-yet-started Draft, or `undefined` (`docs/DATA_MODEL.md` 11.1).
   * Display only (`docs/UI_FLOW.md` 10.3): the page links to it and says that
   * the next Planner save replaces it. It never decides which Planner entry is
   * offered - that stays with the running Plan - and a Draft beside a running
   * Plan is legal, so it is never read away because a Plan runs. More than one
   * Draft is a persistence invariant violation the repository reports, never
   * something the page resolves or reads as "no Draft".
   */
  getDraftProductionPlan(): Promise<ProductionPlan | undefined>
  /** 「現在地点から再計画を試算」 / 「この再計画を採用」 (16.8, `docs/UI_FLOW.md` 16.4). */
  replan: ProductionPlanReplanDependencies
}

function createDefaultDependencies(master: MasterDataRoot): BuildListPageDependencies {
  return {
    master,
    createWorkerClient: createProductionPlannerWorkerClient,
    refresh: (calculationContext) =>
      buildListService.refreshStaleness(calculationContext),
    createInput: (calculationContext) =>
      createPlannerInput(master, calculationContext),
    // The ordinary Draft creation passes no approval, so a save point restore
    // (which only an approval can choose) never happens here.
    savePlannerResult: async (result, currentCalculationContext) => {
      const outcome = await plannerResultPersistenceService.savePlannerOrchestrationResult(
        result,
        currentCalculationContext,
      )
      if (outcome.kind === 'save_point_restored_recalculation_required') {
        throw new Error('An unapproved Planner result save never restores a save point.')
      }
      return outcome.kind === 'saved' ? outcome.plan : null
    },
    deleteEntry: (id, approval) => buildListService.deleteEntry(id, approval ?? null),
    inspectEntryDelete: (id) => buildListService.inspectEntryDelete(id),
    updateIntermediateStateSelection: (id, selection, approval) =>
      buildListService.updateIntermediateStateSelection(id, selection, approval ?? null),
    inspectIntermediateStateSelectionUpdate: (id, selection) =>
      buildListService.inspectIntermediateStateSelectionUpdate(id, selection),
    getRunningProductionPlan: () => productionPlanRepository.getRunningProductionPlan(),
    getDraftProductionPlan: () => productionPlanRepository.getDraftProductionPlan(),
    replan: createProductionPlanReplanDependencies(master),
  }
}

const defaultDependencies: BuildListPageDependencies | null = defaultMaster
  ? createDefaultDependencies(defaultMaster)
  : null

/**
 * The replan runtime of a page without Master Data: it never runs, because the
 * page renders no replan control then, and it rejects rather than guesses.
 */
const unavailableReplanDependencies: ProductionPlanReplanDependencies = {
  prepareProductionPlanReplanPreview: () => Promise.reject(new Error('マスターデータを読み込めません。')),
  createProductionPlanReplanPreview: () => {
    throw new Error('マスターデータを読み込めません。')
  },
  inspectProductionPlanReplanAdoption: () => Promise.reject(new Error('マスターデータを読み込めません。')),
  adoptProductionPlanReplanPreview: () => Promise.reject(new Error('マスターデータを読み込めません。')),
}

/**
 * The Build List detail settings hold the raw `maxPlanSteps` string, so an
 * in-progress or invalid entry stays visible instead of being silently coerced.
 *
 * `maxPlanSteps` is the only Production Planner bound the user edits (Issue
 * #103 Phase D-1). A `PlannerOptions` value is only produced when it is a
 * positive integer, so `NaN`, `0`, a negative number, a fraction and an empty
 * field can never reach `PlannerInput.options` (UI_FLOW 10.0). It is the whole
 * Production `PlannerOptions` (Phase D-2a), so nothing else is filled in.
 */
interface PlannerOptionInputs {
  maxPlanSteps: string
}

function createPlannerOptionInputs(options: PlannerOptions): PlannerOptionInputs {
  return { maxPlanSteps: String(options.maxPlanSteps) }
}

function parsePlannerOptionValue(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const value = Number(trimmed)
  return Number.isInteger(value) && value >= 1 ? value : null
}

function parsePlannerOptions(inputs: PlannerOptionInputs): PlannerOptions | null {
  const maxPlanSteps = parsePlannerOptionValue(inputs.maxPlanSteps)
  return maxPlanSteps === null ? null : { maxPlanSteps }
}

/**
 * Feedback about the last intermediate state selection save, kept apart from
 * the Planner run and from load / remove failures so each message stays next
 * to the action that caused it.
 */
interface CheckpointFeedback {
  severity: 'info' | 'error'
  message: string
}

/** A Planner run that ended without a saved Plan, typed rather than as text. */
type PlannerNotice = 'cancelled' | 'no_plan'

const plannerNoticeMessages: Record<PlannerNotice, string> = {
  cancelled: '生産計画の作成をキャンセルしました。',
  no_plan: '現在の入力から作成できる生産計画はありませんでした。',
}

/** The operation-specific line under the breaking-change warning (`docs/UI_FLOW.md` 16.3). */
const BUILD_LIST_SELECTION_PLAN_BREAKING_NOTE =
  'この作成リスト項目の条件を変更すると、現在の生産計画の前提と一致しなくなります。'
const BUILD_LIST_DELETE_PLAN_BREAKING_NOTE =
  'この作成リスト項目を削除すると、現在の生産計画の前提と一致しなくなります。'
const SELECTION_UPDATED_MESSAGE = '途中採用する状態と改善優先を更新しました。生産計画を再作成してください。'
const SELECTION_UPDATED_PLAN_ABANDONED_MESSAGE =
  '途中採用する状態と改善優先を更新し、実行中の生産計画を破棄しました。生産計画を再作成してください。'
const SELECTION_CANCELLED_MESSAGE = '途中採用する状態の変更を保存しませんでした。生産計画は変更されていません。'
const ENTRY_DELETED_PLAN_ABANDONED_MESSAGE = 'ビルドリストから削除し、実行中の生産計画を破棄しました。'
/**
 * A Target holding two or more Entries - a legacy duplicate of the Build List
 * cardinality (`docs/DATA_MODEL.md` 9.4.1, `docs/UI_FLOW.md` 10). The guidance
 * names no Entry to keep: the user decides and deletes the others with the
 * ordinary guarded delete.
 */
const LEGACY_DUPLICATE_CHIP_LABEL = '要整理'
const LEGACY_DUPLICATE_TITLE = '候補が複数登録されています'
const LEGACY_DUPLICATE_LINES: readonly string[] = [
  'この目標武器には作成リストの候補が複数登録されています。生産計画の作成と再計画の試算には、使用する候補を1件にする必要があります。',
  '残す候補を確認し、不要な候補を「ビルドリストから削除」で削除してください。どの候補を残すかは自動では決めません。',
]

/**
 * Whether a Plan is running now. `error` means the read failed or the running
 * Plan invariant is broken: neither Planner entry is offered then, because the
 * page cannot tell which one applies.
 */
type RunningPlanState =
  | { status: 'loading' }
  | { status: 'none' }
  | { status: 'running'; plan: ProductionPlan }
  | { status: 'error' }

/**
 * Whether the current Draft exists. `error` means the read failed or the Draft
 * invariant is broken (two Drafts): the state is reported, never guessed as
 * "no Draft", and the ordinary Draft creation is withheld exactly as it is
 * when the running Plan cannot be read, because the page cannot say what the
 * save would replace. The replan Preview of a running Plan is untouched.
 */
type DraftPlanState =
  | { status: 'loading' }
  | { status: 'none' }
  | { status: 'draft'; plan: ProductionPlan }
  | { status: 'error' }

/**
 * Entries grouped by the Target they belong to, in first-appearance order.
 *
 * Presentation only: the persisted Entry order is kept inside each group, and
 * the group order is derived from that same order rather than from priority
 * or any other new meaning. The Target is the current persisted one; a Target
 * that no longer exists still keeps its Entries together under its ID.
 */
interface BuildListTargetGroup {
  targetWeaponId: TargetWeaponId
  target: TargetWeapon | null
  entries: BuildListEntry[]
}

function groupEntriesByTarget(
  entries: readonly BuildListEntry[],
  targets: readonly TargetWeapon[],
): BuildListTargetGroup[] {
  const targetById = new Map(targets.map((target) => [target.id, target]))
  const groups = new Map<TargetWeaponId, BuildListTargetGroup>()
  for (const entry of entries) {
    const group = groups.get(entry.targetWeaponId)
    if (group) group.entries.push(entry)
    else {
      groups.set(entry.targetWeaponId, {
        targetWeaponId: entry.targetWeaponId,
        target: targetById.get(entry.targetWeaponId) ?? null,
        entries: [entry],
      })
    }
  }
  return [...groups.values()]
}

function entrySelection(entry: BuildListEntry): IntermediateStateSelection {
  return entry.intermediateStateSelection ?? defaultIntermediateStateSelection()
}

/** How many lanes of this Entry hold a selected intermediate state. */
function selectedIntermediateStateCount(entry: BuildListEntry): number {
  const selection = entrySelection(entry)
  return Number(selection.skillOpportunityId !== null) + Number(selection.bonusOpportunityId !== null)
}

/** One figure of the page summary. Display only, never a Planner authority. */
function SummaryTile({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <Box
      component="li"
      sx={{
        listStyle: 'none',
        border: 1,
        borderColor: 'divider',
        borderRadius: 1,
        p: 1.5,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.25,
      }}
    >
      <Typography component="h3" variant="subtitle2" color="text.secondary">
        {label}
      </Typography>
      <Typography component="p" className="tabular-nums" sx={{ fontSize: '1.375rem', fontWeight: 600, lineHeight: 1.3 }}>
        {value}
      </Typography>
      {note && (
        <Typography variant="caption" color="text.secondary">
          {note}
        </Typography>
      )}
    </Box>
  )
}

/** A titled, border-based page section. */
function PageSection({
  title,
  children,
  accent = false,
}: {
  title: string
  children: ReactNode
  accent?: boolean
}) {
  const headingId = useId()
  return (
    <Paper
      component="section"
      variant="outlined"
      aria-labelledby={headingId}
      sx={{
        p: { xs: 2, md: 2.5 },
        minWidth: 0,
        ...(accent ? { borderLeftWidth: 4, borderLeftColor: 'primary.main' } : {}),
      }}
    >
      <Stack spacing={2}>
        <Typography id={headingId} component="h2" variant="h2">
          {title}
        </Typography>
        {children}
      </Stack>
    </Paper>
  )
}

/**
 * One Target's Entries.
 *
 * The Target name, its priority and the Entry count come from the current
 * persisted Target and from the Entries themselves. The priority is shown for
 * orientation only: changing it belongs to the Target Weapons screen's full
 * edit path, and no Target write happens here.
 */
function TargetGroupSection({
  group,
  legacyDuplicate,
  children,
}: {
  group: BuildListTargetGroup
  /** The Target holds two or more Entries, as `findBuildListTargetDuplicates()` decided. */
  legacyDuplicate: boolean
  children: ReactNode
}) {
  const headingId = useId()
  const staleCount = group.entries.filter(({ isStale }) => isStale).length
  return (
    <Paper
      component="section"
      variant="outlined"
      aria-labelledby={headingId}
      sx={{ p: { xs: 2, md: 2.5 }, minWidth: 0 }}
    >
      <Stack spacing={2}>
        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          sx={{ flexWrap: 'wrap', alignItems: 'center', minWidth: 0 }}
        >
          <Typography
            id={headingId}
            component="h3"
            variant="h3"
            sx={{ overflowWrap: 'anywhere', minWidth: 0 }}
          >
            {group.target?.name ?? '削除済みの目標武器'}
          </Typography>
          {group.target && (
            <StatusChip label={`優先度 ${group.target.priority}`} tone="info" />
          )}
          <Typography variant="body2" color="text.secondary" className="tabular-nums">
            候補 {group.entries.length}件
          </Typography>
          {legacyDuplicate && <StatusChip label={LEGACY_DUPLICATE_CHIP_LABEL} tone="caution" />}
          {staleCount > 0 && (
            <StatusChip label={`再検索が必要 ${staleCount}件`} tone="caution" />
          )}
        </Stack>
        {legacyDuplicate && (
          <Alert severity="warning">
            <AlertTitle>{LEGACY_DUPLICATE_TITLE}</AlertTitle>
            <Stack spacing={0.5}>
              {LEGACY_DUPLICATE_LINES.map((line) => (
                <Typography variant="body2" key={line}>
                  {line}
                </Typography>
              ))}
            </Stack>
          </Alert>
        )}
        <Stack component="ul" spacing={2} sx={{ m: 0, p: 0, listStyle: 'none' }}>
          {children}
        </Stack>
      </Stack>
    </Paper>
  )
}

interface BuildListPageProps { dependencies?: BuildListPageDependencies }

export function BuildListPage({ dependencies = defaultDependencies ?? undefined }: BuildListPageProps) {
  const debugMode = useSettingsStore((state) => state.debugMode)
  const navigate = useNavigate()
  const progressHeadingId = useId()
  const entriesHeadingId = useId()
  const [entries, setEntries] = useState<BuildListEntry[]>([])
  const [targets, setTargets] = useState<TargetWeapon[]>([])
  const [ownedWeapons, setOwnedWeapons] = useState<OwnedWeapon[]>([])
  const [loading, setLoading] = useState(dependencies !== undefined)
  const [planning, setPlanning] = useState(false)
  const [warnings, setWarnings] = useState<PlannerWarning[]>([])
  // `null` while the user has not edited the detail settings: the field then
  // shows the current Build List's recommended bound. Once the user edits it,
  // that input is the authority and no refresh, re-render or save replaces it
  // (UI_FLOW 10.0, Issue #130).
  const [editedOptionInputs, setEditedOptionInputs] =
    useState<PlannerOptionInputs | null>(null)
  // A search a `PlannerOptions` bound truncated. It is held separately from
  // `warnings` because it is the typed result, not a diagnostic message.
  const [incompleteSearch, setIncompleteSearch] =
    useState<PlannerRunTermination | null>(null)
  // The failure and notice sources stay separate: a load failure is never
  // shown as an empty Build List, and a Planner, selection, or remove problem
  // stays next to the control that caused it (`docs/UI_FLOW.md` 10).
  const [loadError, setLoadError] = useState<string | null>(
    dependencies ? null : 'マスターデータを読み込めません。',
  )
  const [plannerError, setPlannerError] = useState<string | null>(null)
  const [plannerNotice, setPlannerNotice] = useState<PlannerNotice | null>(null)
  const [checkpointFeedback, setCheckpointFeedback] = useState<CheckpointFeedback | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)
  // An Entry delete that also ended the running Plan, reported at the top:
  // the Entry list may be empty afterwards.
  const [removeNotice, setRemoveNotice] = useState<string | null>(null)
  const [runningPlan, setRunningPlan] = useState<RunningPlanState>(
    dependencies ? { status: 'loading' } : { status: 'error' },
  )
  const [draftPlan, setDraftPlan] = useState<DraftPlanState>(
    dependencies ? { status: 'loading' } : { status: 'error' },
  )
  // The breaking-change warning of a selected Entry's selection change or
  // delete (`docs/UI_FLOW.md` 16.3). While it decides, no other guarded
  // change is queued: the selection controls and the delete buttons wait.
  const planGuard = usePlanBreakingChangeApproval()
  // A runtime change against the running Plan (a save point restore, a refused
  // adoption) re-reads the Build List and the running Plan.
  const [loadSequence, setLoadSequence] = useState(0)
  const clientRef = useRef<PlannerWorkerClient | null>(null)
  const activeRequestRef = useRef<string | null>(null)
  /**
   * Per-Entry serialization of intermediate state selection saves.
   *
   * The chain holds, per Entry, a continuation that resolves to the *last
   * selection known to be persisted*: the result of the latest successful
   * save, or - when that save failed - the stable value before it. Every new
   * change is built on that value, so two quick changes on different lanes or
   * on the preference both survive, and a failed save in between never sends
   * the next one back to the render-time Entry (`docs/UI_FLOW.md` 10, lost
   * update). The continuation itself never rejects; only the individual
   * attempt does, and that rejection is what the error feedback reports. The
   * service's Domain validation stays the authority for what a selection may
   * contain.
   */
  const checkpointSaveChainRef = useRef(
    new Map<BuildListEntryId, Promise<IntermediateStateSelection>>(),
  )
  const masterForDisplay = dependencies?.master ?? defaultMaster
  const recommendedMaxPlanSteps = useMemo(
    () => recommendedBuildListMaxPlanSteps(entries),
    [entries],
  )
  const optionInputs = useMemo(
    () =>
      editedOptionInputs ??
      createPlannerOptionInputs({ maxPlanSteps: recommendedMaxPlanSteps }),
    [editedOptionInputs, recommendedMaxPlanSteps],
  )
  const plannerOptions = useMemo(
    () => parsePlannerOptions(optionInputs),
    [optionInputs],
  )
  const groups = useMemo(() => groupEntriesByTarget(entries, targets), [entries, targets])
  // The Build List cardinality authority decides which Targets hold a legacy
  // duplicate; the page only turns its answer into a lookup for display.
  const legacyDuplicateTargetIds = useMemo(
    () => new Set(findBuildListTargetDuplicates(entries).map(({ targetWeaponId }) => targetWeaponId)),
    [entries],
  )
  // Display-only counts over the loaded data. None of them decides whether the
  // Planner may run: that stays with the Planner's own input validation.
  const staleCount = entries.filter(({ isStale }) => isStale).length
  const checkpointEntryCount = entries.filter(
    (entry) => selectedIntermediateStateCount(entry) > 0,
  ).length

  // The 16.8 replan Preview / adoption while a Plan is running. Its state
  // machine and its Planner Worker are its own; the ordinary Draft creation
  // below never shares them, and no Draft is saved beside a running Plan.
  const executionReplan = useProductionPlanReplanPreview({
    replan: dependencies?.replan ?? unavailableReplanDependencies,
    createWorkerClient: () => {
      if (!dependencies) throw new Error('マスターデータを読み込めません。')
      return dependencies.createWorkerClient()
    },
    // The new Plan is `active` now: its Execution Navigator (UI_FLOW 16.4).
    onAdopted: (result) => void navigate(`/plans/${result.newPlan.id}/run`),
    onRunningPlanChanged: () => setLoadSequence((sequence) => sequence + 1),
  })

  useEffect(() => {
    let active = true
    if (!dependencies) {
      return
    }
    const client = dependencies.createWorkerClient()
    clientRef.current = client
    const calculationContext = createBuildListCalculationContext(dependencies.master)
    void dependencies.getRunningProductionPlan().then((plan) => {
      if (active) setRunningPlan(plan === undefined ? { status: 'none' } : { status: 'running', plan })
    }).catch(() => {
      if (active) setRunningPlan({ status: 'error' })
    })
    void dependencies.getDraftProductionPlan().then((plan) => {
      if (active) setDraftPlan(plan === undefined ? { status: 'none' } : { status: 'draft', plan })
    }).catch(() => {
      if (active) setDraftPlan({ status: 'error' })
    })
    void dependencies.refresh(calculationContext).then((loaded) => {
      if (!active) return
      setEntries(loaded.entries)
      setTargets(loaded.targets)
      setOwnedWeapons(loaded.ownedWeapons)
    }).catch((caught: unknown) => {
      if (active) setLoadError(caught instanceof Error ? caught.message : 'ビルドリストの読み込みに失敗しました。')
    }).finally(() => { if (active) setLoading(false) })
    return () => {
      active = false
      activeRequestRef.current = null
      client.dispose()
      clientRef.current = null
    }
  }, [dependencies, loadSequence])

  const startPlanning = async () => {
    if (!dependencies || !clientRef.current || plannerOptions === null) return
    const client = clientRef.current
    const requestId = globalThis.crypto?.randomUUID?.() ?? `planner-${Date.now()}`
    activeRequestRef.current = requestId
    setPlanning(true)
    setWarnings([])
    setPlannerNotice(null)
    setPlannerError(null)
    setIncompleteSearch(null)
    try {
      const calculationContext = createPlannerCalculationContext(
        dependencies.master,
        client.engineVersion,
      )
      const createdInput = await dependencies.createInput(calculationContext)
      if (activeRequestRef.current !== requestId) return
      // The Application caller is the Planner bound authority: the values
      // the user reviewed in the detail settings are written into
      // `PlannerInput.options` here, and neither the Worker Client nor the
      // Worker substitutes a default of its own (PLANNER_SPEC 7.2.1).
      const input: PlannerInput = {
        ...createdInput,
        options: { ...plannerOptions },
      }
      // B8-D2b: the Application caller is what decides to pass the Production
      // orchestration bounds. The Worker Client applies no default of its own.
      // The running state is indeterminate (UI_FLOW 10.0): the Production
      // Planner Worker reports no progress, only a result, an error or a
      // cancellation.
      const result = await client.createConstrainedPlan(
        requestId,
        input,
        defaultPlannerOrchestrationBounds,
      )
      if (activeRequestRef.current !== requestId) return
      setWarnings(result.warnings)
      // `maxPlanSteps` truncated the Planner run, so its best state is a
      // partial Planner artifact rather than a finished production plan.
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
        setPlannerNotice('no_plan')
      }
    } catch (caught: unknown) {
      if (activeRequestRef.current !== requestId || caught instanceof PlannerCancelledError) return
      setPlannerError(caught instanceof Error ? caught.message : '生産計画の作成に失敗しました。')
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
    setPlannerNotice('cancelled')
  }

  /**
   * Applies one selector change to an Entry.
   *
   * The selector reports a whole selection built from the rendered one, so
   * only the fields that differ from that rendered selection are carried onto
   * the last persisted selection: two quick changes on different lanes, or on
   * a lane and the preference, both survive.
   */
  const changeSelection = async (
    entry: BuildListEntry,
    rendered: IntermediateStateSelection,
    next: IntermediateStateSelection,
  ) => {
    if (!dependencies || planGuard.deciding) return
    const deps = dependencies
    const chain = checkpointSaveChainRef.current
    // The last selection known to be persisted. Only the very first change of
    // an Entry in this session starts from the loaded Entry; afterwards the
    // chain's own continuation is the authority, never a render-time Entry.
    const previousStable =
      chain.get(entry.id) ?? Promise.resolve<IntermediateStateSelection>(entrySelection(entry))
    const attempt = previousStable.then(async (latest): Promise<{
      selection: IntermediateStateSelection
      saved: 'applied' | 'cancelled'
      planAbandoned: boolean
    }> => {
      const merged: IntermediateStateSelection = {
        skillOpportunityId:
          next.skillOpportunityId !== rendered.skillOpportunityId
            ? next.skillOpportunityId
            : latest.skillOpportunityId,
        bonusOpportunityId:
          next.bonusOpportunityId !== rendered.bonusOpportunityId
            ? next.bonusOpportunityId
            : latest.bonusOpportunityId,
        improvementPreference:
          next.improvementPreference !== rendered.improvementPreference
            ? next.improvementPreference
            : latest.improvementPreference,
      }
      // The inspection and the save close over the same merged selection; the
      // runtime alone decides whether the warning is shown. A cancelled
      // warning leaves the Entry, the chain and the database as they were.
      const outcome = await planGuard.run({
        inspect: () => deps.inspectIntermediateStateSelectionUpdate(entry.id, merged),
        apply: (approval) => deps.updateIntermediateStateSelection(entry.id, merged, approval),
        note: BUILD_LIST_SELECTION_PLAN_BREAKING_NOTE,
      })
      if (outcome.status === 'cancelled') return { selection: latest, saved: 'cancelled', planAbandoned: false }
      if (outcome.status === 'refused') throw new Error(outcome.message)
      const updated = outcome.result
      // Only a persisted result updates the displayed Entry; a failed
      // selection is never shown as saved.
      setEntries((current) =>
        current.map((existing) => (existing.id === updated.id ? updated : existing)),
      )
      return { selection: entrySelection(updated), saved: 'applied', planAbandoned: outcome.planAbandoned }
    })
    // The continuation handed to the next change: the new stable selection on
    // success, the previous stable one on failure. It never rejects, so a
    // failed save neither poisons the chain nor loses an earlier success.
    const continuation: Promise<IntermediateStateSelection> =
      attempt.then(({ selection }) => selection).catch(() => previousStable)
    chain.set(entry.id, continuation)
    try {
      const { saved, planAbandoned } = await attempt
      if (saved === 'cancelled') {
        setCheckpointFeedback({ severity: 'info', message: SELECTION_CANCELLED_MESSAGE })
        return
      }
      setCheckpointFeedback({
        severity: 'info',
        message: planAbandoned ? SELECTION_UPDATED_PLAN_ABANDONED_MESSAGE : SELECTION_UPDATED_MESSAGE,
      })
      // The Plan the approval ended is no longer running: the running Plan
      // state, its replan entry and the Entries are re-read.
      if (planAbandoned) setLoadSequence((sequence) => sequence + 1)
    } catch (caught: unknown) {
      setCheckpointFeedback({
        severity: 'error',
        message: caught instanceof Error ? caught.message : '途中採用する状態を更新できませんでした。',
      })
    }
  }

  const remove = async (id: BuildListEntryId) => {
    if (!dependencies || planGuard.deciding) return
    setRemoveError(null)
    setRemoveNotice(null)
    try {
      const outcome = await planGuard.run({
        inspect: () => dependencies.inspectEntryDelete(id),
        apply: (approval) => dependencies.deleteEntry(id, approval),
        note: BUILD_LIST_DELETE_PLAN_BREAKING_NOTE,
      })
      if (outcome.status === 'cancelled') return
      if (outcome.status === 'refused') {
        setRemoveError(outcome.message)
        return
      }
      checkpointSaveChainRef.current.delete(id)
      setEntries((current) => current.filter((entry) => entry.id !== id))
      if (outcome.planAbandoned) {
        setRemoveNotice(ENTRY_DELETED_PLAN_ABANDONED_MESSAGE)
        setLoadSequence((sequence) => sequence + 1)
      }
    } catch (caught: unknown) {
      setRemoveError(caught instanceof Error ? caught.message : 'ビルドリストから削除できませんでした。')
    }
  }

  const loaded = !loading && loadError === null
  // The Planner bounds the user reviews. They reach the ordinary Planner run
  // and the replan Preview alike as `PlannerInput.options`.
  const maxPlanStepsInvalid = plannerOptions === null
  const plannerDetailSettings = (
    <DisclosureAccordion title="詳細設定" headingLevel="h3">
      <Stack spacing={1.5}>
        <Typography variant="body2" color="text.secondary">
          {productionPlannerDetailSettingsDescription}
        </Typography>
        {/* One field only (Issue #103 Phase D-1): the Production scheduler's
            safety bound. Its width is capped on wide screens so the helper
            text keeps a readable line length. */}
        <TextField
          fullWidth
          label={productionPlannerMaxPlanStepsField.label}
          type="number"
          value={optionInputs.maxPlanSteps}
          error={maxPlanStepsInvalid}
          helperText={
            maxPlanStepsInvalid
              ? plannerOptionInvalidMessage
              : productionPlannerMaxPlanStepsField.helperText
          }
          onChange={(event) => setEditedOptionInputs({ maxPlanSteps: event.target.value })}
          slotProps={{ htmlInput: { min: 1, step: 1 } }}
          sx={{ maxWidth: { md: 560 } }}
        />
        {/* Back to the current Build List's recommended bound, never a fixed
            1000: the field follows the recommendation again until edited. */}
        <Button
          variant="outlined"
          onClick={() => setEditedOptionInputs(null)}
          sx={{ minHeight: 44, alignSelf: { xs: 'stretch', sm: 'flex-start' } }}
        >
          既定値に戻す
        </Button>
      </Stack>
    </DisclosureAccordion>
  )
  return (
    <PageShell
      title="ビルドリスト"
      description="生産計画（Planner）で検討する候補を確認し、チェックポイントの選択と探索上限を調整します。"
    >
      <Stack spacing={{ xs: 2, md: 3 }}>
        {loading && <LinearProgress aria-label="ビルドリストを読み込み中" />}
        {loadError && <Alert severity="error">{loadError}</Alert>}
        {removeError && <Alert severity="error">{removeError}</Alert>}
        {removeNotice && (
          <Alert severity="info" onClose={() => setRemoveNotice(null)}>
            {removeNotice}
          </Alert>
        )}

        {loaded && (
          <PageSection title="ページ概要">
            <Box
              component="ul"
              sx={{
                m: 0,
                p: 0,
                display: 'grid',
                gridTemplateColumns: {
                  xs: 'repeat(2, minmax(0, 1fr))',
                  md: 'repeat(4, minmax(0, 1fr))',
                },
                gap: 1.5,
              }}
            >
              <SummaryTile label="登録候補" value={entries.length} note="件" />
              <SummaryTile label="目標武器" value={groups.length} note="件" />
              <SummaryTile
                label="再検索が必要な候補"
                value={staleCount}
                note={staleCount > 0 ? '生産計画に含まれません' : '件'}
              />
              <SummaryTile label="途中採用状態を選択中" value={checkpointEntryCount} note="候補" />
            </Box>
          </PageSection>
        )}

        {loaded && entries.length === 0 && (
          // The link sits inside the message rather than in the Alert action
          // slot, so it wraps under the text at 375px with a full-height
          // touch target instead of squeezing the message beside it.
          <Alert severity="info">
            <Stack spacing={1.5} sx={{ alignItems: 'flex-start' }}>
              <Typography variant="body2">
                ビルドリストは空です。検索結果から候補を追加してください。
              </Typography>
              <Button
                component={RouterLink}
                to="/search"
                variant="outlined"
                color="inherit"
                sx={{ minHeight: 44 }}
              >
                候補検索へ
              </Button>
            </Stack>
          </Alert>
        )}

        {loaded && runningPlan.status === 'error' && (
          <Alert severity="error">
            実行中の生産計画を確認できないため、生産計画の作成と再計画の試算はできません。
          </Alert>
        )}

        {loaded && draftPlan.status === 'error' && (
          // A failed Draft read is never "no Draft": the save would replace
          // something the page cannot name, so the ordinary creation waits
          // (`docs/UI_FLOW.md` 10.3).
          <Alert severity="error">
            <Stack spacing={1.5} sx={{ alignItems: 'flex-start' }}>
              <Typography variant="body2">
                未開始の生産計画（下書き）を確認できないため、生産計画の作成はできません。生産計画一覧で状態を確認してください。
              </Typography>
              <Button component={RouterLink} to="/plans" variant="outlined" color="inherit" sx={{ minHeight: 44 }}>
                生産計画一覧を見る
              </Button>
            </Stack>
          </Alert>
        )}

        {loaded && draftPlan.status === 'draft' && (
          // The current Draft (`docs/DATA_MODEL.md` 11.1). Read-only guidance:
          // beside a running Plan it is still shown, and no second Draft
          // creation is offered there (`docs/UI_FLOW.md` 10.3).
          <Alert severity="info">
            <Stack spacing={1.5} sx={{ alignItems: 'flex-start' }}>
              <Typography variant="body2">
                {runningPlan.status === 'running'
                  ? '未開始の下書きも保存されています。'
                  : '未開始の生産計画があります。'}
              </Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignSelf: 'stretch' }}>
                <Button
                  component={RouterLink}
                  to={`/plans/${draftPlan.plan.id}`}
                  variant="outlined"
                  color="inherit"
                  sx={{ minHeight: 44 }}
                >
                  下書きを開く
                </Button>
                <Button component={RouterLink} to="/plans" variant="outlined" color="inherit" sx={{ minHeight: 44 }}>
                  生産計画一覧を見る
                </Button>
              </Stack>
            </Stack>
          </Alert>
        )}

        {loaded && runningPlan.status === 'running' && (
          // 16.8: while a Plan runs, the Build List offers the replan Preview
          // instead of a second, independent Draft (UI_FLOW 10 / 16.4).
          <PageSection title="現在地点からの再計画" accent>
            <Alert severity="info">
              <Stack spacing={1.5} sx={{ alignItems: 'flex-start' }}>
                <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                  実行中の生産計画（{runningPlan.plan.id}、{productionPlanStatusLabels[runningPlan.plan.status]}）があります。
                  再計画を試算して採用すると、現在の生産計画を終了し、新しい生産計画を実行中にします。再検索が必要な候補は再計画に含まれません。
                </Typography>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignSelf: 'stretch' }}>
                  <Button
                    component={RouterLink}
                    to={`/plans/${runningPlan.plan.id}`}
                    variant="outlined"
                    color="inherit"
                    sx={{ minHeight: 44 }}
                  >
                    実行中の生産計画を見る
                  </Button>
                  {runningPlan.plan.status === 'active' && (
                    <Button
                      component={RouterLink}
                      to={`/plans/${runningPlan.plan.id}/run`}
                      variant="outlined"
                      color="inherit"
                      sx={{ minHeight: 44 }}
                    >
                      実行ナビを再開する
                    </Button>
                  )}
                </Stack>
              </Stack>
            </Alert>
            {plannerOptions === null && (
              <Alert severity="warning">
                詳細設定に無効な値があるため、再計画を試算できません。
              </Alert>
            )}
            {plannerDetailSettings}
            {masterForDisplay && (
              <ProductionPlanReplanPreviewPanel
                controller={executionReplan}
                runningPlan={runningPlan.plan}
                targetWeapons={targets}
                master={masterForDisplay}
                debugMode={debugMode}
                startDisabled={plannerOptions === null}
                onStart={() => {
                  if (plannerOptions !== null) executionReplan.start(runningPlan.plan.id, plannerOptions)
                }}
              />
            )}
          </PageSection>
        )}

        {loaded && runningPlan.status === 'none' && (draftPlan.status === 'none' || draftPlan.status === 'draft') && entries.length > 0 && (
          <PageSection title="生産計画の作成" accent>
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              spacing={{ xs: 1.5, md: 3 }}
              sx={{ justifyContent: 'space-between', alignItems: { xs: 'stretch', md: 'center' } }}
            >
              <Typography variant="body2" color="text.secondary" sx={{ minWidth: 0 }}>
                再検索が必要な候補は生産計画に含まれません。作成に成功すると、保存された生産計画の画面へ移動します。
                {draftPlan.status === 'draft' && (
                  // An explanation of the existing atomic replacement
                  // (`savePlannerOrchestrationResult()`), not a UI-side rule.
                  <>
                    {' '}
                    新しい生産計画を保存すると、現在の未開始の生産計画は置き換えられます。
                  </>
                )}
              </Typography>
              <Button
                variant="contained"
                disabled={planning || plannerOptions === null}
                onClick={() => void startPlanning()}
                sx={{ minHeight: 44, px: 3, flexShrink: 0 }}
              >
                生産計画を作成
              </Button>
            </Stack>
            {plannerOptions === null && (
              <Alert severity="warning">
                詳細設定に無効な値があるため、生産計画を作成できません。
              </Alert>
            )}
            {plannerDetailSettings}

            {planning && (
              <Paper
                component="section"
                variant="outlined"
                role="status"
                aria-live="polite"
                aria-labelledby={progressHeadingId}
                sx={{ p: { xs: 1.5, md: 2 }, minWidth: 0 }}
              >
                <Stack spacing={1.5}>
                  <Typography id={progressHeadingId} component="h3" variant="h3">
                    {productionPlannerRunningTitles.plan}
                  </Typography>
                  {/* Indeterminate (UI_FLOW 10.0, Issue #103 Phase D-1): no
                      authority knows the final Step count in advance, and
                      `maxExpandedStates` is not a Production bound. */}
                  <LinearProgress aria-label="生産計画の作成中" variant="indeterminate" />
                  <Typography variant="caption" color="text.secondary">
                    {productionPlannerRunningNote}
                  </Typography>
                  <Button
                    variant="outlined"
                    onClick={cancelPlanning}
                    sx={{ minHeight: 44, alignSelf: { xs: 'stretch', sm: 'flex-start' } }}
                  >
                    キャンセル
                  </Button>
                </Stack>
              </Paper>
            )}

            {incompleteSearch && (
              <Alert severity="warning">
                <AlertTitle>{plannerIncompleteSearchTitle}</AlertTitle>
                <Stack spacing={0.5}>
                  {createPlannerReachedLimitMessages(incompleteSearch).map((message) => (
                    <Typography variant="body2" key={message}>{message}</Typography>
                  ))}
                  <Typography variant="body2" className="tabular-nums">
                    {createPlannerCompletedTargetsText(incompleteSearch)}
                  </Typography>
                </Stack>
              </Alert>
            )}
            {warnings.length > 0 && (
              <Alert severity="warning">
                <AlertTitle>Planner警告</AlertTitle>
                <Box component="ul" sx={{ m: 0, pl: 2.5, display: 'grid', gap: 0.75 }}>
                  {warnings.map((warning, index) => (
                    <li key={`${warning.kind}:${index}`}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {plannerWarningLabels[warning.kind]}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                        {warning.message}
                      </Typography>
                    </li>
                  ))}
                </Box>
              </Alert>
            )}
            {plannerNotice && <Alert severity="info">{plannerNoticeMessages[plannerNotice]}</Alert>}
            {plannerError && <Alert severity="error">{plannerError}</Alert>}
          </PageSection>
        )}

        {loaded && entries.length > 0 && masterForDisplay && (
          <Stack component="section" aria-labelledby={entriesHeadingId} spacing={2} sx={{ minWidth: 0 }}>
            <Typography id={entriesHeadingId} component="h2" variant="h2">
              候補一覧
            </Typography>
            {checkpointFeedback && (
              <Alert severity={checkpointFeedback.severity}>{checkpointFeedback.message}</Alert>
            )}
            {groups.map((group) => (
              <TargetGroupSection
                key={group.targetWeaponId}
                group={group}
                legacyDuplicate={legacyDuplicateTargetIds.has(group.targetWeaponId)}
              >
                {group.entries.map((entry) => (
                  <Box
                    component="li"
                    key={entry.id}
                    sx={{
                      border: 1,
                      borderColor: entry.isStale ? 'warning.main' : 'divider',
                      borderRadius: 1,
                      p: { xs: 1.5, md: 2 },
                      minWidth: 0,
                    }}
                  >
                    <Stack spacing={1.5}>
                      <Stack
                        direction={{ xs: 'column', sm: 'row' }}
                        spacing={1}
                        useFlexGap
                        sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' }, flexWrap: 'wrap' }}
                      >
                        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                          {selectedIntermediateStateCount(entry) > 0 ? (
                            <StatusChip
                              label={`途中採用状態を選択中 ${selectedIntermediateStateCount(entry)}`}
                              tone="info"
                            />
                          ) : (
                            <StatusChip label="途中採用状態は未選択" tone="neutral" />
                          )}
                        </Stack>
                        <Typography variant="caption" color="text.secondary" className="tabular-nums">
                          追加日時: {entry.createdAt}
                        </Typography>
                      </Stack>
                      {entry.isStale && (
                        <Alert severity="warning">
                          <AlertTitle>再検索が必要</AlertTitle>
                          <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                            {entry.staleReasons.map((reason) => (
                              <Typography component="li" variant="body2" key={reason}>
                                {staleReasonLabels[reason]}
                              </Typography>
                            ))}
                          </Box>
                          <Typography variant="body2" sx={{ mt: 0.5 }}>
                            この候補は生産計画に含まれません。候補検索をやり直して、候補を追加し直してください。内容は下で確認できます。
                          </Typography>
                        </Alert>
                      )}
                      {/* The Candidate Snapshot stored on the Entry is the
                          display authority; the current Search result is never
                          re-fetched (`docs/UI_FLOW.md` 10). */}
                      <CandidateCard
                        candidate={entry.candidateSnapshot}
                        target={group.target}
                        master={masterForDisplay}
                        ownedWeapons={ownedWeapons}
                        debugMode={debugMode}
                        headingLevel="h4"
                        intermediateStateSelectionContext="build_list"
                        intermediateStateSelection={entrySelection(entry)}
                        intermediateStateSelectionDisabled={planGuard.deciding}
                        onIntermediateStateSelectionChange={(next) =>
                          void changeSelection(entry, entrySelection(entry), next)
                        }
                      />
                      {debugMode && (
                        <Alert severity="info">
                          Entry ID: {entry.id}<br />
                          targetDefinitionHash: {entry.targetDefinitionHash}<br />
                          searchStateHash: {entry.searchStateHash}<br />
                          referencedOwnedWeaponsHash: {entry.referencedOwnedWeaponsHash ?? 'null'}
                        </Alert>
                      )}
                      <Button
                        color="error"
                        variant="text"
                        disabled={planGuard.deciding}
                        onClick={() => void remove(entry.id)}
                        sx={{ minHeight: 44, alignSelf: { xs: 'stretch', sm: 'flex-start' } }}
                      >
                        ビルドリストから削除
                      </Button>
                    </Stack>
                  </Box>
                ))}
              </TargetGroupSection>
            ))}
          </Stack>
        )}
      </Stack>
      <PlanBreakingChangeDialog
        controller={planGuard}
        // The Plan this page holds resolves the save point's Step; display only.
        savePointPositionLabel={(inspection) =>
          runningPlan.status === 'running' && runningPlan.plan.id === inspection.observedPlan.planId
            ? savePointPositionLabel(runningPlan.plan, inspection.savePointCurrentStepId)
            : null
        }
      />
    </PageShell>
  )
}
