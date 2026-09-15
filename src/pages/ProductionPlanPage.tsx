import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from '@mui/material'
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom'
import { PageShell } from '../components/PageShell'
import { StatusChip } from '../components/StatusChip'
import {
  ProductionPlanCalculationContextDetails,
  ProductionPlanContent,
} from '../components/planner/ProductionPlanContent'
import { ProductionPlanWhatIfComparison } from '../components/planner/ProductionPlanWhatIfComparison'
import { loadMasterData } from '../domain/master/loadMasterData'
import type { MasterDataRoot } from '../domain/master/masterTypes'
import type {
  BuildListEntryId,
  CalculationContext,
  ConflictKind,
  ProductionPlan,
  ProductionPlanId,
  TargetWeapon,
} from '../domain/models/publicTypes'
import {
  defaultPlannerOrchestrationBounds,
  defaultPlannerWhatIfBounds,
  type PlannerOrchestrationResult,
  type PlannerInput,
  type PlannerProgress,
  type PlannerWhatIfCalculationResult,
} from '../domain/planner'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../domain/rng/production/productionRngEngine'
import { productionPlanRepository } from '../db/repositories/productionPlanRepository'
import { targetWeaponRepository } from '../db/repositories/targetWeaponRepository'
import { conflictKindLabels } from '../presentation/labels'
import {
  createPlannerCalculationContext,
  createPlannerInput,
} from '../services/planner/createPlannerInput'
import {
  CHECKPOINT_CONFLICT_MESSAGE,
  createProductionPlanInteractionViewModel,
  evaluateProductionPlanCalculationCompatibility,
  mergeExplicitConflictResolution,
  restorePersistedExplicitResolutions,
  type ProductionPlanInteractionViewModel,
} from '../services/planner/prepareProductionPlanInteraction'
import {
  createProductionPlannerWorkerClient,
  PlannerCancelledError,
  type PlannerWorkerClient,
} from '../services/planner/plannerWorkerClient'
import { plannerResultPersistenceService } from '../services/planner/plannerResultPersistenceService'
import { useSettingsStore } from '../stores/settingsStore'
import type { PlannerInteractionPreparationResult } from '../workers/plannerWorkerContracts'

const loadedMaster = loadMasterData()
const defaultMaster = loadedMaster.ok ? loadedMaster.data : null

export interface ProductionPlanPageDependencies {
  master: MasterDataRoot
  /** Current runtime authority used before any Worker is created. */
  currentCalculationContext: CalculationContext
  getPlan(planId: ProductionPlanId): Promise<ProductionPlan | undefined>
  /**
   * Current persisted Target definitions, used only to resolve display names
   * for the read-only Plan contents. It is deliberately independent of the
   * Worker preparation lifecycle, and a failure here degrades to ID fallback
   * instead of hiding the persisted Plan.
   */
  getTargetWeapons(): Promise<TargetWeapon[]>
  createInput(calculationContext: CalculationContext): Promise<PlannerInput>
  createWorkerClient(): PlannerWorkerClient
  savePlannerResult(
    result: PlannerOrchestrationResult,
    currentCalculationContext: CalculationContext,
  ): Promise<ProductionPlan | null>
}

function createDefaultDependencies(
  master: MasterDataRoot,
): ProductionPlanPageDependencies {
  return {
    master,
    currentCalculationContext: createPlannerCalculationContext(
      master,
      PRODUCTION_RNG_ENGINE_VERSION,
    ),
    getPlan: (planId) => productionPlanRepository.getProductionPlan(planId),
    getTargetWeapons: () => targetWeaponRepository.getAllTargetWeapons(),
    createInput: (calculationContext) =>
      createPlannerInput(master, calculationContext),
    createWorkerClient: createProductionPlannerWorkerClient,
    savePlannerResult: (result, currentCalculationContext) =>
      plannerResultPersistenceService.savePlannerOrchestrationResult(
        result,
        currentCalculationContext,
      ),
  }
}

const defaultDependencies: ProductionPlanPageDependencies | null = defaultMaster
  ? createDefaultDependencies(defaultMaster)
  : null

interface ProductionPlanPageProps {
  dependencies?: ProductionPlanPageDependencies
}

type ProductionPlanPageState =
  | { status: 'loading_plan' }
  | { status: 'not_found' }
  | {
      status: 'stale'
      plan: ProductionPlan
      reason: 'persisted_status' | 'calculation_context_changed'
    }
  | { status: 'preparing'; plan: ProductionPlan }
  | {
      status: 'ready'
      plan: ProductionPlan
      /** Presentation pairing only; every action rebuilds its own fresh input. */
      input: PlannerInput
      preparation: PlannerInteractionPreparationResult
      viewModel: ProductionPlanInteractionViewModel
    }
  | { status: 'error'; message: string; plan: ProductionPlan | null }

interface WhatIfTargetIdentity {
  conflictId: string
  buildListEntryId: BuildListEntryId
}

type WhatIfUiState =
  | { status: 'idle' }
  | (WhatIfTargetIdentity & {
      status: 'loading'
      progress: PlannerProgress | null
    })
  | (WhatIfTargetIdentity & {
      status: 'completed'
      result: Extract<PlannerWhatIfCalculationResult, { status: 'completed' }>
      targetWeapons: PlannerInput['targetWeapons']
    })
  | (WhatIfTargetIdentity & {
      status: 'failure'
      failure:
        | {
            kind: 'typed'
            result: Exclude<PlannerWhatIfCalculationResult, { status: 'completed' }>
          }
        | { kind: 'unexpected'; message: string }
    })

type ReplanUiState =
  | { status: 'idle' }
  | { status: 'loading'; progress: PlannerProgress | null }
  | { status: 'saving' }
  | { status: 'failure'; message: string }
  | { status: 'notice'; message: string }
  | { status: 'invalid_resolution' }

let fallbackRequestSequence = 0

function createRequestId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  fallbackRequestSequence += 1
  return `planner-interaction-${Date.now()}-${fallbackRequestSequence}`
}

function caughtMessage(caught: unknown): string {
  return caught instanceof Error
    ? caught.message
    : '生産計画の現在状態を準備できませんでした。'
}

/**
 * One Conflict participant as the page shows it, for both the interactive and
 * the read-only case.
 *
 * `isRecommended` mirrors the persisted `recommendedBuildListEntryId` and is a
 * badge only; `isSelected` mirrors the persisted `selectedBuildListEntryId`;
 * `isAvailable` comes from the current Worker preparation (`ready`) or is
 * always `false` (`stale`). None of the three is inferred from another.
 */
interface ParticipantDisplay {
  buildListEntryId: BuildListEntryId
  /** Current persisted Target name, or `null` when the page has no current input. */
  targetName: string | null
  isRecommended: boolean
  isSelected: boolean
  isAvailable: boolean
  unavailableMessage: string | null
  /** This participant needs the position for its own selected checkpoint. */
  competesForCheckpoint: boolean
}

interface ConflictDisplay {
  id: string
  kind: ConflictKind | null
  reason: string
  involvesSelectedCheckpoint: boolean
  participants: ParticipantDisplay[]
}

/**
 * The persisted Conflicts of a Plan as a read-only projection.
 *
 * `ProductionPlan.conflicts` is the display authority whenever the page has
 * the exact persisted Plan but no *current* Worker preparation to judge
 * participants with: while the preparation is still running, after it failed,
 * and for a stale Plan (UI_FLOW 11.0 / 11.1). Every participant is therefore
 * unavailable with the caller's reason, and nothing that only the current
 * preparation can know - Target names, checkpoint involvement, current
 * conflict membership - is inferred from persisted data. The persisted
 * recommendation and selection badges keep their display contract.
 */
function createReadOnlyConflictDisplays(
  plan: ProductionPlan,
  unavailableMessage: string,
): ConflictDisplay[] {
  return plan.conflicts.map((conflict) => ({
    id: conflict.id,
    kind: conflict.kind,
    reason: conflict.reason,
    involvesSelectedCheckpoint: false,
    participants: conflict.buildListEntryIds.map((buildListEntryId) => ({
      buildListEntryId,
      targetName: null,
      isRecommended: conflict.recommendedBuildListEntryId === buildListEntryId,
      isSelected: conflict.selectedBuildListEntryId === buildListEntryId,
      isAvailable: false,
      unavailableMessage,
      competesForCheckpoint: false,
    })),
  }))
}

/** Why a participant cannot be acted on in each read-only page state. */
const readOnlyConflictMessages = {
  preparing: '現在の操作可否を確認しています。',
  preparationFailed: '現在の操作可否を確認できないため、この候補は操作できません。',
  stale: 'この生産計画は再計算が必要なため、この候補は操作できません。',
} as const

/** A titled, border-based page section. */
function PlanPageSection({ title, children }: { title: string; children: ReactNode }) {
  const headingId = useId()
  return (
    <Paper
      component="section"
      variant="outlined"
      aria-labelledby={headingId}
      sx={{ p: { xs: 2, md: 2.5 }, minWidth: 0 }}
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
 * One persisted Conflict. The participants are rendered by the page so the
 * what-if / replan state stays where it is managed; this item only frames
 * them with the Conflict's own heading, kind and reason.
 */
function ConflictItem({
  conflict,
  index,
  children,
}: {
  conflict: ConflictDisplay
  /** 1-based display number; presentation only, never an identity. */
  index: number
  children: ReactNode
}) {
  const headingId = useId()
  return (
    <Box
      component="li"
      aria-labelledby={headingId}
      sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: { xs: 1.5, md: 2 }, minWidth: 0 }}
    >
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <Typography id={headingId} component="h3" variant="h3">
            競合 {index + 1}
          </Typography>
          {conflict.kind && <StatusChip label={conflictKindLabels[conflict.kind]} tone="info" />}
          {conflict.involvesSelectedCheckpoint && (
            <StatusChip label="チェックポイント関与" tone="caution" />
          )}
        </Stack>
        <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{conflict.reason}</Typography>
        {conflict.involvesSelectedCheckpoint && (
          // A conflict a selected checkpoint takes part in has no winner: the
          // Domain refuses such a resolution, so the only way forward is the
          // Build List selection (`docs/UI_FLOW.md` 11.1).
          <Alert severity="warning">
            <Stack spacing={1.5} sx={{ alignItems: 'flex-start' }}>
              <Typography variant="body2">{CHECKPOINT_CONFLICT_MESSAGE}</Typography>
              <Button
                component={RouterLink}
                to="/build-list"
                variant="outlined"
                color="inherit"
                sx={{ minHeight: 44 }}
              >
                ビルドリストで途中採用する状態を変更
              </Button>
            </Stack>
          </Alert>
        )}
        <Box
          component="ul"
          aria-label={`競合 ${index + 1} の参加候補`}
          sx={{
            m: 0,
            p: 0,
            display: 'grid',
            gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))' },
            gap: 1.5,
            alignItems: 'start',
          }}
        >
          {children}
        </Box>
      </Stack>
    </Box>
  )
}

/**
 * One participant card. Every state is readable as text: the badges say
 * Planner推奨 / 現在選択中 / 利用可能 / 利用不可, and an unavailable
 * participant keeps its reason beside its disabled controls instead of
 * disappearing (`docs/UI_FLOW.md` 11.1).
 */
function ConflictParticipantCard({
  participant,
  index,
  compareDisabled,
  selectDisabled,
  onCompare,
  onSelect,
  children,
}: {
  participant: ParticipantDisplay
  /** 1-based display number used only when no Target name resolves. */
  index: number
  compareDisabled: boolean
  selectDisabled: boolean
  onCompare(): void
  onSelect(): void
  children?: ReactNode
}) {
  const headingId = useId()
  return (
    <Paper
      component="li"
      variant="outlined"
      aria-labelledby={headingId}
      sx={{
        listStyle: 'none',
        p: { xs: 1.5, md: 2 },
        minWidth: 0,
        borderColor: participant.isSelected ? 'primary.main' : 'divider',
      }}
    >
      <Stack spacing={1.25}>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <Typography
            id={headingId}
            component="h4"
            variant="subtitle1"
            sx={{ overflowWrap: 'anywhere', minWidth: 0 }}
          >
            {participant.targetName ?? `候補 ${index + 1}`}
          </Typography>
          {participant.isRecommended && <StatusChip label="Planner推奨" tone="info" />}
          {participant.isSelected && <StatusChip label="現在選択中" tone="positive" />}
          <StatusChip
            label={participant.isAvailable ? '利用可能' : '利用不可'}
            tone={participant.isAvailable ? 'positive' : 'caution'}
          />
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
          BuildListEntry ID: {participant.buildListEntryId}
        </Typography>
        {participant.competesForCheckpoint && (
          <Alert severity="info">
            この候補は選択済みチェックポイントのためにこの位置を必要としています。
          </Alert>
        )}
        {participant.unavailableMessage && (
          <Alert severity="warning">
            {participant.unavailableMessage}
          </Alert>
        )}
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          <Button
            variant="outlined"
            disabled={compareDisabled}
            onClick={onCompare}
            aria-describedby={headingId}
            sx={{ minHeight: 44 }}
          >
            比較する
          </Button>
          <Button
            variant="contained"
            disabled={selectDisabled}
            onClick={onSelect}
            aria-describedby={headingId}
            sx={{ minHeight: 44 }}
          >
            この候補を優先
          </Button>
        </Stack>
        {children}
      </Stack>
    </Paper>
  )
}

export function ProductionPlanPage({
  dependencies = defaultDependencies ?? undefined,
}: ProductionPlanPageProps) {
  const { planId } = useParams()
  const navigate = useNavigate()
  const debugMode = useSettingsStore((state) => state.debugMode)
  const replanHeadingId = useId()
  const savingHeadingId = useId()
  const selectionActionIdentityRef = useRef(0)
  const selectionActiveRef = useRef(false)
  const selectionSavingRef = useRef(false)
  const lifecycleIdentityRef = useRef(0)
  const whatIfActionIdentityRef = useRef(0)
  const clientRef = useRef<PlannerWorkerClient | null>(null)
  const activeWorkerRequestRef = useRef<string | null>(null)
  const [state, setState] = useState<ProductionPlanPageState>(
    dependencies
      ? { status: 'loading_plan' }
      : {
          status: 'error',
          message: 'マスターデータを読み込めません。',
          plan: null,
        },
  )
  const [targetWeapons, setTargetWeapons] = useState<readonly TargetWeapon[]>([])
  const [whatIfState, setWhatIfState] = useState<WhatIfUiState>({
    status: 'idle',
  })
  const [whatIfNotice, setWhatIfNotice] = useState<string | null>(null)

  const [replanState, setReplanState] = useState<ReplanUiState>({ status: 'idle' })
  const replanBusy = replanState.status === 'loading' || replanState.status === 'saving'

  // Target display names load on their own, so neither a slow nor a failed
  // Target read can delay or hide the persisted Plan contents; an unresolved
  // Target simply falls back to its ID.
  useEffect(() => {
    if (!dependencies) return
    let active = true
    void dependencies
      .getTargetWeapons()
      .then((weapons) => {
        if (active) setTargetWeapons(weapons)
      })
      .catch(() => {
        if (active) setTargetWeapons([])
      })
    return () => {
      active = false
    }
  }, [dependencies])

  useEffect(() => {
    const lifecycleIdentity = lifecycleIdentityRef.current + 1
    lifecycleIdentityRef.current = lifecycleIdentity
    let active = true
    let client: PlannerWorkerClient | null = null
    const isCurrent = () =>
      active && lifecycleIdentityRef.current === lifecycleIdentity
    const setCurrentState = (nextState: ProductionPlanPageState) => {
      queueMicrotask(() => {
        if (isCurrent()) setState(nextState)
      })
    }

    if (!dependencies) {
      setCurrentState({
        status: 'error',
        message: 'マスターデータを読み込めません。',
        plan: null,
      })
      return () => {
        active = false
      }
    }
    if (!planId) {
      setCurrentState({ status: 'not_found' })
      return () => {
        active = false
      }
    }

    setCurrentState({ status: 'loading_plan' })
    queueMicrotask(() => {
      if (!isCurrent()) return
      setWhatIfState({ status: 'idle' })
      setWhatIfNotice(null)
      setReplanState({ status: 'idle' })
    })

    const run = async () => {
      let loadedPlan: ProductionPlan | null = null
      try {
        // The exact persisted Plan is loaded first and unconditionally, so no
        // Worker concern can keep its read-only contents off the page.
        const plan = await dependencies.getPlan(planId as ProductionPlanId)
        if (!isCurrent()) return
        if (!plan) {
          setState({ status: 'not_found' })
          return
        }
        loadedPlan = plan
        // A stale Plan runs no what-if or Conflict action, so it needs no
        // Worker Client at all.
        if (plan.status === 'stale') {
          setState({ status: 'stale', plan, reason: 'persisted_status' })
          return
        }
        const compatibility = evaluateProductionPlanCalculationCompatibility(
          plan,
          dependencies.currentCalculationContext,
        )
        if (!compatibility.isCompatible) {
          setState({
            status: 'stale',
            plan,
            reason: compatibility.recalculationReasons[0],
          })
          return
        }
        setState({ status: 'preparing', plan })

        // Created only here: a failure now falls into the catch below, which
        // keeps `loadedPlan` on the error state instead of discarding it.
        const preparationClient = dependencies.createWorkerClient()
        client = preparationClient
        clientRef.current = preparationClient

        const calculationContext = createPlannerCalculationContext(
          dependencies.master,
          preparationClient.engineVersion,
        )
        const freshInput = await dependencies.createInput(calculationContext)
        if (!isCurrent()) return
        const input = restorePersistedExplicitResolutions(freshInput, plan)
        const requestId = createRequestId()
        activeWorkerRequestRef.current = requestId
        const preparation = await preparationClient.prepareInteraction(requestId, input)
        if (!isCurrent() || activeWorkerRequestRef.current !== requestId) return
        activeWorkerRequestRef.current = null
        setState({
          status: 'ready',
          plan,
          input,
          preparation,
          viewModel: createProductionPlanInteractionViewModel(
            plan,
            input,
            preparation,
          ),
        })
      } catch (caught: unknown) {
        if (!isCurrent() || caught instanceof PlannerCancelledError) return
        activeWorkerRequestRef.current = null
        setState({
          status: 'error',
          message: caughtMessage(caught),
          plan: loadedPlan,
        })
      }
    }
    void run()

    return () => {
      active = false
      whatIfActionIdentityRef.current += 1
      selectionActionIdentityRef.current += 1
      selectionActiveRef.current = false
      selectionSavingRef.current = false
      const activeRequestId = activeWorkerRequestRef.current
      activeWorkerRequestRef.current = null
      // `client` stays null when this lifecycle never reached Worker creation:
      // a stale Plan, a missing Plan, or a Plan load abandoned before it
      // resolved. There is then nothing to cancel or dispose.
      if (client !== null) {
        if (activeRequestId !== null) client.cancelPlan(activeRequestId)
        client.dispose()
        if (clientRef.current === client) clientRef.current = null
      }
    }
  }, [dependencies, planId])

  const startWhatIfComparison = async (
    conflictId: string,
    buildListEntryId: BuildListEntryId,
  ) => {
    if (!dependencies || state.status !== 'ready' || selectionActiveRef.current) return
    const displayedPlan = state.plan
    const displayedParticipant = state.viewModel.conflicts
      .find(({ id }) => id === conflictId)
      ?.participants.find(
        (participant) => participant.buildListEntryId === buildListEntryId,
      )
    const client = clientRef.current
    if (!client || !displayedParticipant?.isAvailable) return

    const previousRequestId = activeWorkerRequestRef.current
    activeWorkerRequestRef.current = null
    if (previousRequestId !== null) client.cancelPlan(previousRequestId)
    const actionIdentity = whatIfActionIdentityRef.current + 1
    whatIfActionIdentityRef.current = actionIdentity
    const lifecycleIdentity = lifecycleIdentityRef.current
    const isCurrentAction = () =>
      whatIfActionIdentityRef.current === actionIdentity &&
      lifecycleIdentityRef.current === lifecycleIdentity &&
      clientRef.current === client

    setWhatIfNotice(null)
    setWhatIfState({
      status: 'loading',
      conflictId,
      buildListEntryId,
      progress: null,
    })

    try {
      const calculationContext = createPlannerCalculationContext(
        dependencies.master,
        client.engineVersion,
      )
      const freshInput = await dependencies.createInput(calculationContext)
      if (!isCurrentAction()) return
      const plannerInput = restorePersistedExplicitResolutions(
        freshInput,
        displayedPlan,
      )

      const preparationRequestId = createRequestId()
      activeWorkerRequestRef.current = preparationRequestId
      const preparation = await client.prepareInteraction(
        preparationRequestId,
        plannerInput,
      )
      if (
        !isCurrentAction() ||
        activeWorkerRequestRef.current !== preparationRequestId
      ) return
      activeWorkerRequestRef.current = null

      const viewModel = createProductionPlanInteractionViewModel(
        displayedPlan,
        plannerInput,
        preparation,
      )
      setState({
        status: 'ready',
        plan: displayedPlan,
        input: plannerInput,
        preparation,
        viewModel,
      })
      const currentParticipant = viewModel.conflicts
        .find(({ id }) => id === conflictId)
        ?.participants.find(
          (participant) => participant.buildListEntryId === buildListEntryId,
        )
      if (!currentParticipant?.isAvailable) {
        setWhatIfState({ status: 'idle' })
        setWhatIfNotice(
          '現在の状態が変化したため比較を開始できませんでした。',
        )
        return
      }

      const whatIfRequestId = createRequestId()
      activeWorkerRequestRef.current = whatIfRequestId
      const result = await client.createWhatIfComparison(
        whatIfRequestId,
        {
          plannerInput,
          scenarioResolution: {
            conflictKey: conflictId,
            selectedBuildListEntryId: currentParticipant.buildListEntryId,
          },
          bounds: { ...defaultPlannerWhatIfBounds },
        },
        {
          onProgress: (progress) => {
            if (
              isCurrentAction() &&
              activeWorkerRequestRef.current === whatIfRequestId
            ) {
              setWhatIfState({
                status: 'loading',
                conflictId,
                buildListEntryId,
                progress,
              })
            }
          },
        },
      )
      if (
        !isCurrentAction() ||
        activeWorkerRequestRef.current !== whatIfRequestId
      ) return
      activeWorkerRequestRef.current = null
      if (result.status === 'completed') {
        setWhatIfState({
          status: 'completed',
          conflictId,
          buildListEntryId,
          result,
          targetWeapons: plannerInput.targetWeapons,
        })
      } else {
        setWhatIfState({
          status: 'failure',
          conflictId,
          buildListEntryId,
          failure: { kind: 'typed', result },
        })
      }
    } catch (caught: unknown) {
      if (!isCurrentAction() || caught instanceof PlannerCancelledError) return
      activeWorkerRequestRef.current = null
      setWhatIfState({
        status: 'failure',
        conflictId,
        buildListEntryId,
        failure: {
          kind: 'unexpected',
          message: caught instanceof Error
            ? `比較処理に失敗しました。${caught.message}`
            : '比較処理に失敗しました。',
        },
      })
    }
  }

  const cancelWhatIfComparison = () => {
    whatIfActionIdentityRef.current += 1
    const requestId = activeWorkerRequestRef.current
    activeWorkerRequestRef.current = null
    if (requestId !== null) clientRef.current?.cancelPlan(requestId)
    setWhatIfState({ status: 'idle' })
    setWhatIfNotice(null)
  }

  const startReplanning = async (
    conflictId: string,
    buildListEntryId: BuildListEntryId,
  ) => {
    if (!dependencies || state.status !== 'ready' || selectionActiveRef.current) return
    const displayedPlan = state.plan
    const participant = state.viewModel.conflicts
      .find(({ id }) => id === conflictId)
      ?.participants.find((entry) => entry.buildListEntryId === buildListEntryId)
    const client = clientRef.current
    if (!client || !participant?.isAvailable) return

    // Invalidate even a what-if still awaiting createInput, before cancelling its Worker.
    whatIfActionIdentityRef.current += 1
    const previousRequestId = activeWorkerRequestRef.current
    activeWorkerRequestRef.current = null
    if (previousRequestId !== null) client.cancelPlan(previousRequestId)
    setWhatIfState({ status: 'idle' })
    setWhatIfNotice(null)

    const actionIdentity = ++selectionActionIdentityRef.current
    const lifecycleIdentity = lifecycleIdentityRef.current
    selectionActiveRef.current = true
    const isCurrentAction = () =>
      selectionActionIdentityRef.current === actionIdentity &&
      lifecycleIdentityRef.current === lifecycleIdentity &&
      clientRef.current === client
    setReplanState({ status: 'loading', progress: null })

    try {
      const calculationContext = createPlannerCalculationContext(
        dependencies.master,
        client.engineVersion,
      )
      const freshInput = await dependencies.createInput(calculationContext)
      if (!isCurrentAction()) return
      const plannerInput = restorePersistedExplicitResolutions(freshInput, displayedPlan)
      // Check availability before merging this click: a resolution can change conflicts.
      const preparationRequestId = createRequestId()
      activeWorkerRequestRef.current = preparationRequestId
      const preparation = await client.prepareInteraction(preparationRequestId, plannerInput)
      if (!isCurrentAction() || activeWorkerRequestRef.current !== preparationRequestId) return
      activeWorkerRequestRef.current = null
      const viewModel = createProductionPlanInteractionViewModel(
        displayedPlan,
        plannerInput,
        preparation,
      )
      setState({ status: 'ready', plan: displayedPlan, input: plannerInput, preparation, viewModel })
      const currentParticipant = viewModel.conflicts
        .find(({ id }) => id === conflictId)
        ?.participants.find((entry) => entry.buildListEntryId === buildListEntryId)
      if (preparation.status === 'invalid' || !currentParticipant?.isAvailable) {
        setReplanState({
          status: 'notice',
          message: '現在の状態が変化したため再計算を開始できませんでした。',
        })
        return
      }

      const mergedInput = mergeExplicitConflictResolution(plannerInput, {
        conflictKey: conflictId,
        selectedBuildListEntryId: buildListEntryId,
      })
      const requestId = createRequestId()
      activeWorkerRequestRef.current = requestId
      const result = await client.createConstrainedPlan(
        requestId,
        mergedInput,
        defaultPlannerOrchestrationBounds,
        {
          onProgress: (progress) => {
            if (isCurrentAction() && activeWorkerRequestRef.current === requestId) {
              setReplanState({ status: 'loading', progress })
            }
          },
        },
      )
      if (!isCurrentAction() || activeWorkerRequestRef.current !== requestId) return
      activeWorkerRequestRef.current = null

      // Application fail-closed boundary: even a non-null ordinary Plan must not
      // be saved if the Planner could not honour an explicit resolution.
      const hasInvalidConflictResolution = result.warnings.some(
        (warning) => warning.kind === 'invalid_conflict_resolution',
      )
      if (hasInvalidConflictResolution) {
        setReplanState({ status: 'invalid_resolution' })
        return
      }
      // The same fail-closed boundary as the Build List (PLANNER_SPEC 7.2.1):
      // a Plan calculated from a Beam Search that a `PlannerOptions` bound
      // truncated is never saved and never opened. The typed termination
      // decides that, never a warning message.
      if (result.termination.status === 'incomplete') {
        setReplanState({
          status: 'notice',
          message:
            '探索上限に到達したため、完成した生産計画を作成できませんでした。ビルドリスト画面の「詳細設定」で探索上限を引き上げてから、もう一度生産計画を作成してください。',
        })
        return
      }
      if (!isCurrentAction()) return
      selectionSavingRef.current = true
      setReplanState({ status: 'saving' })
      const saveCalculationContext = createPlannerCalculationContext(
        dependencies.master,
        client.engineVersion,
      )
      if (!isCurrentAction()) return
      // Pass the whole result, including no-Plan results: Persistence owns the
      // generated-Entry invariants and the single atomic transaction.
      const savedPlan = await dependencies.savePlannerResult(result, saveCalculationContext)
      if (!isCurrentAction()) return
      if (savedPlan === null) {
        setReplanState({
          status: 'notice',
          message: '現在の入力から新しい生産計画を作成できませんでした。',
        })
      } else {
        setReplanState({ status: 'idle' })
        void navigate(`/plans/${savedPlan.id}`)
      }
    } catch (caught: unknown) {
      if (!isCurrentAction()) return
      setReplanState(caught instanceof PlannerCancelledError
        ? { status: 'idle' }
        : {
            status: 'failure',
            message: caught instanceof Error ? caught.message : '生産計画の再計算・保存に失敗しました。',
          })
    } finally {
      if (isCurrentAction()) {
        activeWorkerRequestRef.current = null
        selectionActiveRef.current = false
        selectionSavingRef.current = false
      }
    }
  }

  const cancelReplanning = () => {
    // Atomic persistence cannot be cancelled, including before the next render.
    if (selectionSavingRef.current) return
    selectionActionIdentityRef.current += 1
    selectionActiveRef.current = false
    const requestId = activeWorkerRequestRef.current
    activeWorkerRequestRef.current = null
    if (requestId !== null) clientRef.current?.cancelPlan(requestId)
    setReplanState({ status: 'idle' })
  }

  const loadedPlan =
    state.status === 'preparing' || state.status === 'ready' || state.status === 'stale'
      ? state.plan
      : state.status === 'error'
        ? state.plan
        : null

  // Persisted `ProductionPlan.conflicts` is the Conflict display authority in
  // every state that holds the exact persisted Plan (UI_FLOW 11.0): the list
  // never disappears because the Worker preparation is still running or has
  // failed. Only `ready` carries the current preparation, which is the sole
  // authority for whether a participant can be acted on; every other state is
  // a read-only projection whose participants are all unavailable.
  const conflictDisplays: ConflictDisplay[] | null =
    state.status === 'ready'
      ? state.viewModel.conflicts.map((conflict) => ({
          id: conflict.id,
          kind: state.plan.conflicts.find(({ id }) => id === conflict.id)?.kind ?? null,
          reason: conflict.reason,
          involvesSelectedCheckpoint: conflict.involvesSelectedCheckpoint,
          participants: conflict.participants.map((participant) => ({
            buildListEntryId: participant.buildListEntryId,
            targetName: participant.targetName,
            isRecommended: participant.isRecommended,
            isSelected: participant.isSelected,
            isAvailable: participant.isAvailable,
            unavailableMessage: participant.unavailableMessage,
            competesForCheckpoint: participant.checkpointOpportunityId !== null,
          })),
        }))
      : state.status === 'preparing'
        ? createReadOnlyConflictDisplays(state.plan, readOnlyConflictMessages.preparing)
        : state.status === 'error' && state.plan !== null
          ? createReadOnlyConflictDisplays(state.plan, readOnlyConflictMessages.preparationFailed)
          : state.status === 'stale'
            ? createReadOnlyConflictDisplays(state.plan, readOnlyConflictMessages.stale)
            : null

  const showBuildListLink =
    state.status === 'stale' ||
    (state.status === 'ready' &&
      (state.preparation.status === 'invalid' ||
        !state.viewModel.isDraft ||
        state.viewModel.conflicts.some((conflict) =>
          conflict.participants.some(({ isAvailable }) => !isAvailable),
        )))

  return (
    <PageShell
      title="生産計画"
      description={`生産計画（${loadedPlan?.id ?? planId ?? '未指定'}）の全体を確認します。`}
    >
      <Stack spacing={{ xs: 2, md: 3 }}>
        {state.status === 'loading_plan' && (
          <Stack spacing={1} role="status" aria-live="polite">
            <LinearProgress aria-label="生産計画を読み込み中" />
            <Typography variant="body2">生産計画を読み込んでいます。</Typography>
          </Stack>
        )}
        {state.status === 'not_found' && (
          <Alert severity="warning">指定された生産計画が見つかりません。</Alert>
        )}
        {state.status === 'error' && (
          <Alert severity="error">{state.message}</Alert>
        )}
        {state.status === 'stale' && (
          // The link sits inside the message instead of in the Alert action
          // slot, so at 375px it wraps under the text with a full-height
          // touch target rather than squeezing the message beside it.
          <Alert severity="warning">
            <AlertTitle>再計算が必要な生産計画です</AlertTitle>
            <Stack spacing={1.5} sx={{ alignItems: 'flex-start' }}>
              <Typography variant="body2">
                {state.reason === 'calculation_context_changed'
                  ? 'この生産計画は現在の計算契約と互換性がありません。ビルドリストから再計算してください。'
                  : 'この生産計画は現在の状態と一致しません。ビルドリストから再計算してください。'}
              </Typography>
              <Button
                component={RouterLink}
                to="/build-list"
                variant="outlined"
                color="inherit"
                sx={{ minHeight: 44 }}
              >
                ビルドリストへ戻る
              </Button>
            </Stack>
          </Alert>
        )}
        {/* Read-only Plan contents come straight from the exact persisted Plan,
            so they render as soon as it is loaded - while the Worker
            preparation is still running, after it failed, and for a stale Plan
            whose Conflict controls stay disabled. */}
        {dependencies && loadedPlan && (
          <ProductionPlanContent
            plan={loadedPlan}
            targetWeapons={targetWeapons}
            master={dependencies.master}
            debugMode={debugMode}
          />
        )}

        {state.status === 'preparing' && (
          <Stack spacing={1} role="status" aria-live="polite">
            <LinearProgress aria-label="現在のPlanner入力を準備中" />
            <Typography variant="body2">現在の保存状態から操作可否を確認しています。</Typography>
          </Stack>
        )}

        {conflictDisplays !== null && (
          <PlanPageSection title="競合と解決">
            <Typography variant="body2" color="text.secondary">
              保存された生産計画の競合と、その解決状態です。操作できるかどうかは現在の保存状態から判定します。
            </Typography>
            {state.status === 'ready' && (
              <>
                {replanState.status === 'loading' && (
                  <Paper
                    component="section"
                    variant="outlined"
                    role="status"
                    aria-live="polite"
                    aria-labelledby={replanHeadingId}
                    sx={{ p: { xs: 1.5, md: 2 } }}
                  >
                    <Stack spacing={1.5}>
                      <Typography id={replanHeadingId} component="h3" variant="h3" className="tabular-nums">
                        {replanState.progress
                          ? `再計算中 ${replanState.progress.expandedStates} / ${replanState.progress.maxExpandedStates}`
                          : '再計算中'}
                      </Typography>
                      <LinearProgress
                        aria-label="Planner再計算の進捗"
                        variant={replanState.progress ? 'determinate' : 'indeterminate'}
                        value={replanState.progress
                          ? replanState.progress.maxExpandedStates > 0
                            ? replanState.progress.expandedStates / replanState.progress.maxExpandedStates * 100
                            : 0
                          : undefined}
                      />
                      <Button
                        variant="outlined"
                        onClick={cancelReplanning}
                        sx={{ minHeight: 44, alignSelf: { xs: 'stretch', sm: 'flex-start' } }}
                      >
                        再計算をキャンセル
                      </Button>
                    </Stack>
                  </Paper>
                )}
                {replanState.status === 'saving' && (
                  // Atomic persistence has started: no cancel is offered.
                  <Paper
                    component="section"
                    variant="outlined"
                    role="status"
                    aria-live="polite"
                    aria-labelledby={savingHeadingId}
                    sx={{ p: { xs: 1.5, md: 2 } }}
                  >
                    <Stack spacing={1.5}>
                      <Typography id={savingHeadingId} component="h3" variant="h3">
                        生産計画を保存しています。
                      </Typography>
                      <LinearProgress aria-label="生産計画を保存中" />
                      <Typography variant="caption" color="text.secondary">
                        保存中はキャンセルできません。
                      </Typography>
                    </Stack>
                  </Paper>
                )}
                {replanState.status === 'failure' && <Alert severity="error">{replanState.message}</Alert>}
                {replanState.status === 'notice' && <Alert severity="info">{replanState.message}</Alert>}
                {replanState.status === 'invalid_resolution' && (
                  <Alert severity="warning">
                    ユーザーが選択した競合候補を現在の状態では固定できませんでした。
                    再選択またはビルドリストから再計算してください。
                  </Alert>
                )}
                {whatIfNotice && <Alert severity="info">{whatIfNotice}</Alert>}
                {state.viewModel.planStatusMessage && (
                  <Alert
                    severity={state.viewModel.planStatus === 'stale' ? 'warning' : 'info'}
                  >
                    {state.viewModel.planStatusMessage}
                  </Alert>
                )}
                {state.preparation.status === 'invalid' && (
                  <Alert severity="warning">
                    <AlertTitle>現在の入力では競合を準備できません。再計算が必要です。</AlertTitle>
                    {state.preparation.issues.map((issue, index) => (
                      <Typography
                        variant="body2"
                        key={`issue:${issue.path}:${issue.code}:${index}`}
                      >
                        {issue.message}
                      </Typography>
                    ))}
                    {state.preparation.warnings.map((warning, index) => (
                      <Typography
                        variant="body2"
                        key={`warning:${warning.kind}:${index}`}
                      >
                        {warning.message}
                      </Typography>
                    ))}
                  </Alert>
                )}
              </>
            )}
            {conflictDisplays.length === 0 ? (
              <Alert severity="info">この生産計画に表示する競合はありません。</Alert>
            ) : (
              <Stack component="ul" spacing={2} sx={{ m: 0, p: 0, listStyle: 'none' }}>
                {conflictDisplays.map((conflict, conflictIndex) => (
                  <ConflictItem key={conflict.id} conflict={conflict} index={conflictIndex}>
                    {conflict.participants.map((participant, participantIndex) => {
                      // A what-if belongs to the interactive state only; a
                      // read-only projection never shows one.
                      const showsWhatIf =
                        state.status === 'ready' &&
                        whatIfState.status !== 'idle' &&
                        whatIfState.conflictId === conflict.id &&
                        whatIfState.buildListEntryId === participant.buildListEntryId
                      return (
                        <ConflictParticipantCard
                          key={participant.buildListEntryId}
                          participant={participant}
                          index={participantIndex}
                          compareDisabled={
                            !participant.isAvailable ||
                            replanBusy ||
                            (whatIfState.status === 'loading' &&
                              whatIfState.conflictId === conflict.id &&
                              whatIfState.buildListEntryId ===
                                participant.buildListEntryId)
                          }
                          selectDisabled={!participant.isAvailable || replanBusy}
                          onCompare={() => void startWhatIfComparison(
                            conflict.id,
                            participant.buildListEntryId,
                          )}
                          onSelect={() => void startReplanning(
                            conflict.id,
                            participant.buildListEntryId,
                          )}
                        >
                          {showsWhatIf && whatIfState.status === 'loading' && (
                            <Stack
                              spacing={1}
                              role="status"
                              aria-live="polite"
                              sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5 }}
                            >
                              <Typography variant="body2" className="tabular-nums" sx={{ fontWeight: 600 }}>
                                {whatIfState.progress
                                  ? `比較中 ${whatIfState.progress.expandedStates} / ${whatIfState.progress.maxExpandedStates}`
                                  : '比較中'}
                              </Typography>
                              <LinearProgress
                                aria-label="what-if比較の進捗"
                                variant={
                                  whatIfState.progress
                                    ? 'determinate'
                                    : 'indeterminate'
                                }
                                value={whatIfState.progress
                                  ? whatIfState.progress.maxExpandedStates > 0
                                    ? whatIfState.progress.expandedStates /
                                      whatIfState.progress.maxExpandedStates * 100
                                    : 0
                                  : undefined}
                              />
                              <Button
                                variant="outlined"
                                onClick={cancelWhatIfComparison}
                                sx={{ minHeight: 44, alignSelf: { xs: 'stretch', sm: 'flex-start' } }}
                              >
                                比較をキャンセル
                              </Button>
                            </Stack>
                          )}
                          {showsWhatIf && whatIfState.status === 'completed' && (
                            <ProductionPlanWhatIfComparison
                              result={whatIfState.result}
                              targetWeapons={whatIfState.targetWeapons}
                              headingLevel="h5"
                            />
                          )}
                          {showsWhatIf && whatIfState.status === 'failure' &&
                            (whatIfState.failure.kind === 'typed' ? (
                              <ProductionPlanWhatIfComparison
                                result={whatIfState.failure.result}
                                targetWeapons={[]}
                                headingLevel="h5"
                              />
                            ) : (
                              <Alert severity="error">
                                {whatIfState.failure.message}
                              </Alert>
                            ))}
                        </ConflictParticipantCard>
                      )
                    })}
                  </ConflictItem>
                ))}
              </Stack>
            )}
            {showBuildListLink && state.status === 'ready' && (
              <Button
                component={RouterLink}
                to="/build-list"
                variant="outlined"
                sx={{ minHeight: 44, alignSelf: { xs: 'stretch', sm: 'flex-start' } }}
              >
                ビルドリストへ戻る
              </Button>
            )}
          </PlanPageSection>
        )}

        {debugMode && dependencies && loadedPlan && (
          <ProductionPlanCalculationContextDetails
            plan={loadedPlan}
            current={dependencies.currentCalculationContext}
          />
        )}
      </Stack>
    </PageShell>
  )
}
