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
import { Link as RouterLink, useParams } from 'react-router-dom'
import { PageShell } from '../components/PageShell'
import { loadMasterData } from '../domain/master/loadMasterData'
import type { MasterDataRoot } from '../domain/master/masterTypes'
import type {
  CalculationContext,
  ProductionPlan,
  ProductionPlanId,
} from '../domain/models/publicTypes'
import type { PlannerInput } from '../domain/planner'
import { productionPlanRepository } from '../db/repositories/productionPlanRepository'
import {
  createPlannerCalculationContext,
  createPlannerInput,
} from '../services/planner/createPlannerInput'
import {
  createProductionPlanInteractionViewModel,
  restorePersistedExplicitResolutions,
  type ProductionPlanInteractionViewModel,
} from '../services/planner/prepareProductionPlanInteraction'
import {
  createProductionPlannerWorkerClient,
  PlannerCancelledError,
  type PlannerWorkerClient,
} from '../services/planner/plannerWorkerClient'
import type { PlannerInteractionPreparationResult } from '../workers/plannerWorkerContracts'

const loadedMaster = loadMasterData()
const defaultMaster = loadedMaster.ok ? loadedMaster.data : null

export interface ProductionPlanPageDependencies {
  master: MasterDataRoot
  getPlan(planId: ProductionPlanId): Promise<ProductionPlan | undefined>
  createInput(calculationContext: CalculationContext): Promise<PlannerInput>
  createWorkerClient(): PlannerWorkerClient
}

function createDefaultDependencies(
  master: MasterDataRoot,
): ProductionPlanPageDependencies {
  return {
    master,
    getPlan: (planId) => productionPlanRepository.getProductionPlan(planId),
    createInput: (calculationContext) =>
      createPlannerInput(master, calculationContext),
    createWorkerClient: createProductionPlannerWorkerClient,
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
  | { status: 'preparing'; plan: ProductionPlan }
  | {
      status: 'ready'
      plan: ProductionPlan
      /** Retained for B10-C, paired with this exact preparation result. */
      input: PlannerInput
      preparation: PlannerInteractionPreparationResult
      viewModel: ProductionPlanInteractionViewModel
    }
  | { status: 'error'; message: string; plan: ProductionPlan | null }

const statusLabels = {
  draft: '下書き',
  active: '実行中',
  completed: '完了',
  stale: '再計算が必要',
  abandoned: '破棄済み',
} as const

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
  const lifecycleIdentityRef = useRef(0)
  const [state, setState] = useState<ProductionPlanPageState>(
    dependencies
      ? { status: 'loading_plan' }
      : {
          status: 'error',
          message: 'マスターデータを読み込めません。',
          plan: null,
        },
  )

  useEffect(() => {
    const lifecycleIdentity = lifecycleIdentityRef.current + 1
    lifecycleIdentityRef.current = lifecycleIdentity
    let active = true
    let activeRequestId: string | null = null
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
    try {
      client = dependencies.createWorkerClient()
    } catch (caught: unknown) {
      setCurrentState({
        status: 'error',
        message: caughtMessage(caught),
        plan: null,
      })
      return () => {
        active = false
      }
    }

    const run = async () => {
      let loadedPlan: ProductionPlan | null = null
      try {
        const plan = await dependencies.getPlan(planId as ProductionPlanId)
        if (!isCurrent()) return
        if (!plan) {
          setState({ status: 'not_found' })
          return
        }
        loadedPlan = plan
        setState({ status: 'preparing', plan })

        const calculationContext = createPlannerCalculationContext(
          dependencies.master,
          client.engineVersion,
        )
        const freshInput = await dependencies.createInput(calculationContext)
        if (!isCurrent()) return
        const input = restorePersistedExplicitResolutions(freshInput, plan)
        const requestId = createRequestId()
        activeRequestId = requestId
        const preparation = await client.prepareInteraction(requestId, input)
        if (!isCurrent() || activeRequestId !== requestId) return
        activeRequestId = null
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
        activeRequestId = null
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
      if (activeRequestId !== null) client.cancelPlan(activeRequestId)
      client.dispose()
    }
  }, [dependencies, planId])

  const loadedPlan =
    state.status === 'preparing' || state.status === 'ready'
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
              label={statusLabels[loadedPlan.status]}
              color={loadedPlan.status === 'draft' ? 'primary' : 'default'}
              size="small"
            />
          </Stack>
        )}
        {state.status === 'preparing' && (
          <>
            <LinearProgress aria-label="現在のPlanner入力を準備中" />
            <Typography>現在の保存状態から操作可否を確認しています。</Typography>
          </>
        )}
        {state.status === 'ready' && (
          <>
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
