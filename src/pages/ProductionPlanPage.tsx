import { useEffect, useRef, useState } from 'react'
import {
  Alert,
  Button,
  Chip,
  Divider,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from '@mui/material'
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom'
import { PageShell } from '../components/PageShell'
import { ProductionPlanContent } from '../components/planner/ProductionPlanContent'
import { ProductionPlanWhatIfComparison } from '../components/planner/ProductionPlanWhatIfComparison'
import { loadMasterData } from '../domain/master/loadMasterData'
import type { MasterDataRoot } from '../domain/master/masterTypes'
import type {
  BuildListEntryId,
  CalculationContext,
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
import { productionPlanRepository } from '../db/repositories/productionPlanRepository'
import { targetWeaponRepository } from '../db/repositories/targetWeaponRepository'
import { productionPlanStatusLabels } from '../presentation/labels'
import {
  createPlannerCalculationContext,
  createPlannerInput,
} from '../services/planner/createPlannerInput'
import {
  createProductionPlanInteractionViewModel,
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
import type { PlannerInteractionPreparationResult } from '../workers/plannerWorkerContracts'

const loadedMaster = loadMasterData()
const defaultMaster = loadedMaster.ok ? loadedMaster.data : null

export interface ProductionPlanPageDependencies {
  master: MasterDataRoot
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
  | { status: 'stale'; plan: ProductionPlan }
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

export function ProductionPlanPage({
  dependencies = defaultDependencies ?? undefined,
}: ProductionPlanPageProps) {
  const { planId } = useParams()
  const navigate = useNavigate()
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
          setState({ status: 'stale', plan })
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

  return (
    <PageShell
      title="生産計画"
      description={`作成計画（${loadedPlan?.id ?? planId ?? '未指定'}）の全体を確認します。`}
    >
      <Stack spacing={3}>
        {state.status === 'loading_plan' && (
          <>
            <LinearProgress aria-label="生産計画を読み込み中" />
            <Typography>生産計画を読み込んでいます。</Typography>
          </>
        )}
        {state.status === 'not_found' && (
          <Alert severity="warning">指定された生産計画が見つかりません。</Alert>
        )}
        {state.status === 'error' && (
          <Alert severity="error">{state.message}</Alert>
        )}
        {loadedPlan && (
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1}
            sx={{ alignItems: { sm: 'center' } }}
          >
            <Typography variant="body2">Plan ID: {loadedPlan.id}</Typography>
            <Chip
              label={productionPlanStatusLabels[loadedPlan.status]}
              color={loadedPlan.status === 'draft' ? 'primary' : 'default'}
              size="small"
            />
          </Stack>
        )}
        {state.status === 'stale' && (
          <Alert severity="warning">
            この生産計画は現在の状態と一致しません。ビルドリストから再計算してください。
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
          />
        )}
        {state.status === 'stale' && (
          <>
            {state.plan.conflicts.map((conflict, index) => (
              <Paper key={conflict.id} variant="outlined" sx={{ p: 2 }}>
                <Stack spacing={1}>
                  <Typography component="h2" variant="h2">競合 {index + 1}</Typography>
                  <Typography>{conflict.reason}</Typography>
                  {conflict.buildListEntryIds.map((id) => (
                    <Stack key={id} spacing={1}>
                      <Stack
                        direction="row"
                        spacing={1}
                        useFlexGap
                        sx={{ flexWrap: 'wrap', alignItems: 'center' }}
                      >
                        <Typography variant="caption">BuildListEntry ID: {id}</Typography>
                        {conflict.recommendedBuildListEntryId === id && (
                          <Chip label="Planner推奨" size="small" color="info" />
                        )}
                        {conflict.selectedBuildListEntryId === id && (
                          <Chip label="現在選択中" size="small" color="secondary" />
                        )}
                      </Stack>
                      <Button disabled>比較する</Button>
                      <Button disabled>この候補を優先</Button>
                    </Stack>
                  ))}
                </Stack>
              </Paper>
            ))}
            <Button component={RouterLink} to="/build-list" variant="outlined">
              ビルドリストへ戻る
            </Button>
          </>
        )}
        {state.status === 'preparing' && (
          <>
            <LinearProgress aria-label="現在のPlanner入力を準備中" />
            <Typography>現在の保存状態から操作可否を確認しています。</Typography>
          </>
        )}
        {state.status === 'ready' && (
          <>
            {replanState.status === 'loading' && (
              <Stack spacing={1}>
                <Typography>
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
                <Button onClick={cancelReplanning}>再計算をキャンセル</Button>
              </Stack>
            )}
            {replanState.status === 'saving' && (
              <Stack spacing={1}>
                <Typography>生産計画を保存しています。</Typography>
                <LinearProgress aria-label="生産計画を保存中" />
              </Stack>
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
                <Typography variant="subtitle2">
                  現在の入力では競合を準備できません。再計算が必要です。
                </Typography>
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
            {state.viewModel.conflicts.length === 0 ? (
              <Alert severity="info">この生産計画に表示する競合はありません。</Alert>
            ) : (
              state.viewModel.conflicts.map((conflict, conflictIndex) => (
                <Paper key={conflict.id} variant="outlined" sx={{ p: 2 }}>
                  <Stack spacing={2}>
                    <Typography component="h2" variant="h2">
                      競合 {conflictIndex + 1}
                    </Typography>
                    <Typography variant="body2">{conflict.reason}</Typography>
                    <Divider />
                    {conflict.participants.map((participant) => (
                      <Paper
                        key={participant.buildListEntryId}
                        variant="outlined"
                        sx={{ p: 2 }}
                      >
                        <Stack spacing={1}>
                          <Stack
                            direction="row"
                            spacing={1}
                            useFlexGap
                            sx={{ flexWrap: 'wrap', alignItems: 'center' }}
                          >
                            <Typography component="h3" variant="subtitle1">
                              {participant.targetName}
                            </Typography>
                            {participant.isRecommended && (
                              <Chip label="Planner推奨" size="small" color="info" />
                            )}
                            {participant.isSelected && (
                              <Chip label="現在選択中" size="small" color="secondary" />
                            )}
                            <Chip
                              label={participant.isAvailable ? '利用可能' : '利用不可'}
                              size="small"
                              color={participant.isAvailable ? 'success' : 'default'}
                            />
                          </Stack>
                          <Typography variant="body2">
                            候補区分:{' '}
                            {participant.candidateCategory === 'ideal'
                              ? '理想候補'
                              : participant.candidateCategory === 'practical'
                                ? '実用候補'
                                : '現在確認できません'}
                          </Typography>
                          <Typography variant="caption">
                            BuildListEntry ID: {participant.buildListEntryId}
                          </Typography>
                          {participant.unavailableMessage && (
                            <Alert severity="warning">
                              {participant.unavailableMessage}
                            </Alert>
                          )}
                          <Button
                            variant="outlined"
                            disabled={
                              !participant.isAvailable ||
                              replanBusy ||
                              (whatIfState.status === 'loading' &&
                                whatIfState.conflictId === conflict.id &&
                                whatIfState.buildListEntryId ===
                                  participant.buildListEntryId)
                            }
                            onClick={() => void startWhatIfComparison(
                              conflict.id,
                              participant.buildListEntryId,
                            )}
                          >
                            比較する
                          </Button>
                          <Button
                            variant="contained"
                            disabled={!participant.isAvailable || replanBusy}
                            onClick={() => void startReplanning(conflict.id, participant.buildListEntryId)}
                          >
                            この候補を優先
                          </Button>
                          {whatIfState.status !== 'idle' &&
                            whatIfState.conflictId === conflict.id &&
                            whatIfState.buildListEntryId ===
                              participant.buildListEntryId && (
                              <>
                                {whatIfState.status === 'loading' && (
                                  <Stack spacing={1}>
                                    <Typography variant="body2">
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
                                    <Button onClick={cancelWhatIfComparison}>
                                      比較をキャンセル
                                    </Button>
                                  </Stack>
                                )}
                                {whatIfState.status === 'completed' && (
                                  <ProductionPlanWhatIfComparison
                                    result={whatIfState.result}
                                    targetWeapons={whatIfState.targetWeapons}
                                  />
                                )}
                                {whatIfState.status === 'failure' &&
                                  (whatIfState.failure.kind === 'typed' ? (
                                    <ProductionPlanWhatIfComparison
                                      result={whatIfState.failure.result}
                                      targetWeapons={[]}
                                    />
                                  ) : (
                                    <Alert severity="error">
                                      {whatIfState.failure.message}
                                    </Alert>
                                  ))}
                              </>
                            )}
                        </Stack>
                      </Paper>
                    ))}
                  </Stack>
                </Paper>
              ))
            )}
            {(
              state.preparation.status === 'invalid' ||
              !state.viewModel.isDraft ||
              state.viewModel.conflicts.some((conflict) =>
                conflict.participants.some(({ isAvailable }) => !isAvailable),
              )
            ) && (
              <Button component={RouterLink} to="/build-list" variant="outlined">
                ビルドリストへ戻る
              </Button>
            )}
          </>
        )}
      </Stack>
    </PageShell>
  )
}
