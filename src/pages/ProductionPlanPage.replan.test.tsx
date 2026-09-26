import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import {
  ExecutionRuntimeError,
  createProductionPlanReplanPreview,
  type ProductionPlanReplanAdoptionOptions,
  type ProductionPlanReplanPreviewRequest,
} from '../domain/execution'
import type {
  BuildListEntry,
  ProductionPlan,
  TargetWeapon,
} from '../domain/models/publicTypes'
import {
  defaultPlannerOptions,
  defaultPlannerOrchestrationBounds,
  type PlannerInput,
  type PlannerOrchestrationResult,
} from '../domain/planner'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../domain/rng/production/productionRngEngine'
import type { AdoptProductionPlanReplanPreviewResult } from '../services/execution/productionPlanExecutionService'
import type { ProductionPlanReplanDependencies } from '../services/execution/productionPlanReplanDependencies'
import {
  PlannerCancelledError,
  type PlannerWorkerClient,
} from '../services/planner/plannerWorkerClient'
import {
  buildListEntryId,
  createValidBuildListEntry,
  createValidNormalArtianCounter,
  createValidProductionPlan,
  createValidRngState,
  createValidTargetWeapon,
  planStepId,
  productionPlanId,
  targetWeaponId,
} from '../test/fixtures/domainData'
import { createValidMasterDataFixture } from '../test/fixtures/masterData'
import {
  completedPlannerTermination,
  exhaustedPlannerTermination,
  incompletePlannerTermination,
} from '../test/fixtures/plannerTermination'
import type { PlannerInteractionPreparationResult } from '../workers/plannerWorkerContracts'
import { ProductionPlanPage, type ProductionPlanPageDependencies } from './ProductionPlanPage'

/**
 * 「現在地点から再計画を試算」 / 「この再計画を採用」 on the Production Plan
 * page (`docs/UI_FLOW.md` 16.4, `docs/PLANNER_SPEC.md` 16.8) over a mocked
 * runtime: which Plans offer it, the Preview lifecycle (progress, cancel, a
 * late result of an earlier Preview, no Plan, an incomplete search), and the
 * adoption dialog with its 16.10 save point choice. The real-runtime
 * behaviour is covered by the integration test beside this file.
 */

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const RUNNING_PLAN_ID = productionPlanId('plan.replan.running')
const PREVIEW_PLAN_ID = productionPlanId('plan.replan.preview')
const SAVE_POINT_RECORDED_AT = '2026-09-18T01:00:00.000Z'

function currentContractPlan(id: ProductionPlan['id'], patch: Partial<ProductionPlan> = {}): ProductionPlan {
  const base = createValidProductionPlan()
  return {
    ...base,
    id,
    steps: base.steps.map((step) => ({
      ...step,
      progressedTargetWeaponIds: step.targetWeaponId === null ? [] : [step.targetWeaponId],
    })),
    conflicts: [],
    ...patch,
  }
}

function runningPlan(patch: Partial<ProductionPlan> = {}): ProductionPlan {
  const plan = currentContractPlan(RUNNING_PLAN_ID, { status: 'active' })
  return { ...plan, currentStepId: plan.steps[0]?.id ?? null, ...patch }
}

function fixtureInput(target: TargetWeapon, entry: BuildListEntry): PlannerInput {
  return {
    rngState: createValidRngState(),
    normalCounters: [createValidNormalArtianCounter()],
    ownedWeapons: [],
    targetWeapons: [target],
    buildListEntries: [entry],
    calculationContext: { ...entry.calculationContext },
    options: { ...defaultPlannerOptions },
    master: {
      weaponBonusDefinitions: [],
      weaponTypes: [],
      elements: [],
      bonusTypes: [],
      bonusRanks: [],
      artianBonusTypeMappings: [],
      materialCosts: [],
    },
    conflictResolutions: [],
  }
}

function previewRequest(plan: ProductionPlan): ProductionPlanReplanPreviewRequest {
  const entry = createValidBuildListEntry()
  const target = createValidTargetWeapon()
  entry.id = buildListEntryId('build-list.replan')
  entry.targetWeaponId = targetWeaponId('target.replan')
  entry.candidateSnapshot.targetWeaponId = entry.targetWeaponId
  target.id = entry.targetWeaponId
  target.name = 'Replan fixture target'
  if (plan.status !== 'active' && plan.status !== 'stale') throw new Error('running Plan expected')
  return {
    runningPlanToken: { planId: plan.id, status: plan.status, currentStepId: plan.currentStepId },
    plannerInput: fixtureInput(target, entry),
    calculationContext: { ...plan.calculationContext },
  }
}

function orchestrationResult(overrides: Partial<PlannerOrchestrationResult> = {}): PlannerOrchestrationResult {
  return {
    plan: currentContractPlan(PREVIEW_PLAN_ID, { status: 'draft' }),
    conflicts: [],
    warnings: [],
    termination: completedPlannerTermination(),
    generatedBuildListEntries: [],
    generatedBuildListEntryReplacements: [],
    ...overrides,
  }
}

const readyPreparation: PlannerInteractionPreparationResult = {
  status: 'ready',
  validBuildListEntryIds: [],
  excludedBuildListEntries: [],
  currentConflicts: [],
}

function workerClient(
  createConstrainedPlan: PlannerWorkerClient['createConstrainedPlan'] = async () => orchestrationResult(),
): PlannerWorkerClient {
  return {
    engineVersion: PRODUCTION_RNG_ENGINE_VERSION,
    createPlan: vi.fn(),
    createConstrainedPlan: vi.fn(createConstrainedPlan),
    createWhatIfComparison: vi.fn(),
    createPlannerAlternativeComparison: vi.fn(),
    prepareInteraction: vi.fn(async () => readyPreparation),
    cancelPlan: vi.fn(),
    dispose: vi.fn(),
  }
}

function noChoice(plan: ProductionPlan): ProductionPlanReplanAdoptionOptions {
  return {
    runningPlanId: plan.id,
    runningPlanStatus: 'active',
    runningPlanCurrentStepId: plan.currentStepId,
    newPlanId: PREVIEW_PLAN_ID,
    savePointChoiceRequired: false,
  }
}

function withChoice(plan: ProductionPlan): ProductionPlanReplanAdoptionOptions {
  return {
    runningPlanId: plan.id,
    runningPlanStatus: 'active',
    runningPlanCurrentStepId: plan.currentStepId,
    newPlanId: PREVIEW_PLAN_ID,
    savePointChoiceRequired: true,
    savePointRecordedAt: SAVE_POINT_RECORDED_AT,
    savePointLastExecutionHistoryId: null,
    savePointCurrentStepId: plan.steps[0]?.id ?? null,
  }
}

function adopted(
  plan: ProductionPlan,
  newPlan: ProductionPlan,
  savePointHandling: 'no_choice' | 'keep_current' = 'no_choice',
): AdoptProductionPlanReplanPreviewResult {
  return {
    kind: 'adopted',
    savePointHandling,
    oldPlan: { ...plan, status: 'abandoned', abandonmentReason: 'replan_adopted' },
    newPlan: { ...newPlan, status: 'active' },
    generatedBuildListEntries: [],
  }
}

function replanDependencies(plan: ProductionPlan): ProductionPlanReplanDependencies {
  return {
    prepareProductionPlanReplanPreview: vi.fn(async () => previewRequest(plan)),
    createProductionPlanReplanPreview: vi.fn(createProductionPlanReplanPreview),
    inspectProductionPlanReplanAdoption: vi.fn(async () => noChoice(plan)),
    adoptProductionPlanReplanPreview: vi.fn(async () => {
      throw new Error('adoptProductionPlanReplanPreview is not expected in this test')
    }),
  }
}

function dependencies(
  plan: ProductionPlan,
  client = workerClient(),
  replan = replanDependencies(plan),
): ProductionPlanPageDependencies & { replan: ProductionPlanReplanDependencies } {
  const target = createValidTargetWeapon()
  const entry = createValidBuildListEntry()
  return {
    master: createValidMasterDataFixture(),
    currentCalculationContext: { ...plan.calculationContext },
    getPlan: vi.fn(async () => plan),
    getTargetWeapons: vi.fn(async () => [target]),
    createInput: vi.fn(async () => fixtureInput(target, entry)),
    createWorkerClient: vi.fn(() => client),
    inspectPlannerResultSave: vi.fn(async () => ({ approvalRequired: false as const })),
    savePlannerResult: vi.fn(async () => ({ kind: 'no_plan' as const })),
    inspectProductionPlanStart: vi.fn(async (planId) => ({ planId, changes: [], ownedWeapons: [], targetWeapons: [] })),
    startProductionPlan: vi.fn(async () => {
      throw new Error('startProductionPlan is not expected in this test')
    }),
    replan,
  }
}

function renderPage(deps: ProductionPlanPageDependencies, planId: string) {
  const router = createMemoryRouter(
    [
      { path: '/plans/:planId', element: <ProductionPlanPage dependencies={deps} /> },
      { path: '/plans/:planId/run', element: <div>Execution navigator destination</div> },
      { path: '/build-list', element: <div>Build list destination</div> },
    ],
    { initialEntries: [`/plans/${planId}`] },
  )
  return { router, ...render(<RouterProvider router={router} />) }
}

const START = '現在地点から再計画を試算'
const PREVIEW_TITLE = '再計画の試算（未採用）'
const ADOPT = 'この再計画を採用'

async function startPreview(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: START }))
}

/** The Preview section, once shown. Queries inside it never hit the running Plan's own view. */
async function previewShown(): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { name: PREVIEW_TITLE })
  return heading.closest('section') as HTMLElement
}

async function dialogClosed() {
  // Including the exit transition: the page stays aria-hidden until the modal unmounts.
  await waitFor(() => expect(screen.queryByRole('dialog', { hidden: true })).not.toBeInTheDocument())
}

describe('ProductionPlanPage replan Preview', () => {
  it.each([
    ['active', runningPlan()],
    ['stale', runningPlan({ status: 'stale', recalculationReasons: ['unexpected_result'] })],
  ])('offers the Preview for a %s Plan and shows it as not adopted, changing nothing', async (_, plan) => {
    const client = workerClient()
    const deps = dependencies(plan, client)
    const user = userEvent.setup()
    renderPage(deps, plan.id)

    await startPreview(user)

    expect(await previewShown()).toBeInTheDocument()
    expect(screen.getByText('まだ現在の生産計画は変更されていません。この試算は保存されておらず、画面を離れると消えます。')).toBeInTheDocument()
    expect(deps.replan.prepareProductionPlanReplanPreview).toHaveBeenCalledExactlyOnceWith({ runningPlanId: plan.id })
    // The Preview input is exactly the runtime's request: token and current-state input.
    const request = await vi.mocked(deps.replan.prepareProductionPlanReplanPreview).mock.results[0].value
    expect(client.createConstrainedPlan).toHaveBeenCalledOnce()
    const [, input, bounds] = vi.mocked(client.createConstrainedPlan).mock.calls[0]
    expect(input).toBe(request.plannerInput)
    expect(bounds).toEqual(defaultPlannerOrchestrationBounds)
    expect(deps.replan.createProductionPlanReplanPreview).toHaveBeenCalledExactlyOnceWith(request, expect.objectContaining({ plan: expect.objectContaining({ id: PREVIEW_PLAN_ID }) }))
    // Displayed as a draft-equivalent, never as the running Plan, with the comparison.
    expect(screen.getByRole('table', { name: '現在の生産計画と再計画の試算の比較' })).toBeInTheDocument()
    // The Preview's Conflicts are read-only, and adoption offers no later resolution either.
    expect(screen.getByText('試算の競合はここでは変更できません。Plannerが選択したこの試算内容を確認したうえで採用してください。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: ADOPT })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'この試算を破棄' })).toBeEnabled()
    // Nothing was adopted, saved, or started.
    expect(deps.replan.inspectProductionPlanReplanAdoption).not.toHaveBeenCalled()
    expect(deps.replan.adoptProductionPlanReplanPreview).not.toHaveBeenCalled()
    expect(deps.savePlannerResult).not.toHaveBeenCalled()
    expect(deps.startProductionPlan).not.toHaveBeenCalled()
  })

  it.each([
    ['draft', runningPlan({ status: 'draft', currentStepId: null })],
    ['completed', runningPlan({ status: 'completed', completedAt: '2026-09-17T00:00:00.000Z' })],
    ['abandoned', runningPlan({ status: 'abandoned', abandonmentReason: 'user_abandoned', abandonedAt: '2026-09-17T00:00:00.000Z' })],
  ])('offers no Preview for a %s Plan', async (_, plan) => {
    const deps = dependencies(plan)
    renderPage(deps, plan.id)
    await screen.findByRole('heading', { name: '計画の概要' })
    await waitFor(() => expect(deps.getPlan).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: START })).not.toBeInTheDocument()
    expect(deps.replan.prepareProductionPlanReplanPreview).not.toHaveBeenCalled()
  })

  it('shows the runtime refusal when the Preview input cannot be prepared', async () => {
    const plan = runningPlan()
    const replan = replanDependencies(plan)
    vi.mocked(replan.prepareProductionPlanReplanPreview).mockRejectedValue(
      new ExecutionRuntimeError('replan_preview_not_allowed', 'refused'),
    )
    const client = workerClient()
    const user = userEvent.setup()
    renderPage(dependencies(plan, client, replan), plan.id)

    await startPreview(user)

    expect(await screen.findByText('現在の生産計画からは再計画を試算できません。')).toBeInTheDocument()
    expect(client.createConstrainedPlan).not.toHaveBeenCalled()
    expect(screen.queryByRole('heading', { name: PREVIEW_TITLE })).not.toBeInTheDocument()
  })

  it('shows an indeterminate running state and cancels through the Worker without reporting a failure', async () => {
    const plan = runningPlan()
    const pending = deferred<PlannerOrchestrationResult>()
    // The Production Worker reports no progress (Issue #103 Phase D-2a).
    const client = workerClient(() => pending.promise)
    vi.mocked(client.cancelPlan).mockImplementation(() => pending.reject(new PlannerCancelledError()))
    const deps = dependencies(plan, client)
    const user = userEvent.setup()
    renderPage(deps, plan.id)

    await startPreview(user)

    const status = await screen.findByRole('status', { name: /再計画を試算しています/ })
    // Indeterminate like the ordinary Planner (Issue #103 Phase D-1): the
    // Worker progress never becomes a ratio.
    expect(within(status).getByRole('heading', { name: '再計画を試算しています…' })).toBeInTheDocument()
    expect(within(status).getByRole('progressbar', { name: '再計画の試算中' })).not.toHaveAttribute('aria-valuenow')
    expect(within(status).queryByText(/12|100|探索状態数/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: START })).toBeDisabled()

    await user.click(within(status).getByRole('button', { name: 'キャンセル' }))

    expect(client.cancelPlan).toHaveBeenCalledOnce()
    expect(await screen.findByText('再計画の試算をキャンセルしました。現在の生産計画は変更されていません。')).toBeInTheDocument()
    // A notice, never an error.
    expect(screen.getAllByRole('alert').some((alert) => alert.className.includes('MuiAlert-colorError'))).toBe(false)
    expect(screen.queryByRole('heading', { name: PREVIEW_TITLE })).not.toBeInTheDocument()
    expect(deps.replan.adoptProductionPlanReplanPreview).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: START })).toBeEnabled()
  })

  it('never shows the late result of an earlier Preview', async () => {
    const plan = runningPlan()
    const first = deferred<PlannerOrchestrationResult>()
    const second = deferred<PlannerOrchestrationResult>()
    let calls = 0
    const client = workerClient(() => (++calls === 1 ? first.promise : second.promise))
    const deps = dependencies(plan, client)
    const user = userEvent.setup()
    renderPage(deps, plan.id)

    await startPreview(user)
    await user.click(await screen.findByRole('button', { name: 'キャンセル' }))
    await screen.findByText('再計画の試算をキャンセルしました。現在の生産計画は変更されていません。')
    await user.click(screen.getByRole('button', { name: START }))
    await screen.findByRole('status', { name: /再計画を試算しています/ })
    expect(calls).toBe(2)

    // The first Preview's result arrives after it was cancelled and replaced.
    first.resolve(orchestrationResult({ plan: currentContractPlan(productionPlanId('plan.replan.late'), { status: 'draft' }) }))
    await waitFor(() => expect(screen.getByRole('status', { name: /再計画を試算しています/ })).toBeInTheDocument())
    expect(screen.queryByText('plan.replan.late')).not.toBeInTheDocument()

    second.resolve(orchestrationResult())
    await previewShown()
    expect(screen.getByText(PREVIEW_PLAN_ID)).toBeInTheDocument()
    expect(screen.queryByText('plan.replan.late')).not.toBeInTheDocument()
  })

  it('shows a no-Plan result as a normal Preview that cannot be adopted', async () => {
    const plan = runningPlan()
    const client = workerClient(async () => orchestrationResult({
      plan: null,
      termination: exhaustedPlannerTermination(),
      warnings: [{ kind: 'no_build_list_entries', message: 'nothing to plan' }],
    }))
    const deps = dependencies(plan, client)
    const user = userEvent.setup()
    renderPage(deps, plan.id)

    await startPreview(user)

    const section = await previewShown()
    expect(screen.getByText('現在の状態から作成できる生産計画はありませんでした。現在の生産計画は変更されていません。')).toBeInTheDocument()
    expect(screen.getByText('利用できるビルドリスト項目がありません')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: ADOPT })).not.toBeInTheDocument()
    expect(within(section).queryByRole('heading', { name: '計画の概要' })).not.toBeInTheDocument()
    // The ordinary no-Plan result alone: neither the incomplete nor the invalid display.
    expect(screen.queryByText('生産計画の探索が完了していません')).not.toBeInTheDocument()
    expect(screen.queryByText('この試算結果は採用できません。もう一度、現在地点から再計画を試算してください。')).not.toBeInTheDocument()
  })

  it('shows a no-Plan incomplete search as an incomplete search, never as a normal no-Plan result', async () => {
    // PLANNER_SPEC 7.2.1: the typed termination is the authority. A search a
    // bound truncated before any Plan formed is not a finished no-Plan result.
    const plan = runningPlan()
    const termination = incompletePlannerTermination()
    const client = workerClient(async () => orchestrationResult({ plan: null, termination }))
    const user = userEvent.setup()
    renderPage(dependencies(plan, client), plan.id)

    await startPreview(user)

    const section = await previewShown()
    expect(screen.getByText('生産計画の探索が完了していません')).toBeInTheDocument()
    expect(screen.getByText(/最大計画ステップ数 1,000 に到達しました/)).toBeInTheDocument()
    expect(screen.queryByText(/探索状態数/)).not.toBeInTheDocument()
    expect(screen.getByText(/^完成した目標武器: /)).toBeInTheDocument()
    expect(screen.getByText('探索が完了していないため、この試算は採用できません。')).toBeInTheDocument()
    expect(screen.queryByText('現在の状態から作成できる生産計画はありませんでした。現在の生産計画は変更されていません。')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: ADOPT })).not.toBeInTheDocument()
    expect(within(section).queryByRole('heading', { name: '計画の概要' })).not.toBeInTheDocument()
  })

  it('shows an incomplete search with its reached bound and never offers adoption', async () => {
    const plan = runningPlan()
    const termination = incompletePlannerTermination()
    const client = workerClient(async () => orchestrationResult({ termination }))
    const deps = dependencies(plan, client)
    const user = userEvent.setup()
    renderPage(deps, plan.id)

    await startPreview(user)

    const section = await previewShown()
    expect(screen.getByText('生産計画の探索が完了していません')).toBeInTheDocument()
    expect(screen.getByText(/最大計画ステップ数 1,000 に到達しました/)).toBeInTheDocument()
    expect(screen.queryByText(/探索状態数/)).not.toBeInTheDocument()
    expect(screen.getByText(/^完成した目標武器: /)).toBeInTheDocument()
    expect(screen.getByText('探索が完了していないため、この試算は採用できません。')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: ADOPT })).not.toBeInTheDocument()
    // The partial Plan is not shown as a Plan.
    expect(within(section).queryByRole('heading', { name: '計画の概要' })).not.toBeInTheDocument()
  })

  it('never offers adoption for a result that cannot be persisted', async () => {
    const plan = runningPlan()
    // A no-Plan result carrying generated Entries is invalid, never adoptable.
    const client = workerClient(async () => orchestrationResult({ plan: null, generatedBuildListEntries: [createValidBuildListEntry()] }))
    const user = userEvent.setup()
    renderPage(dependencies(plan, client), plan.id)

    await startPreview(user)

    await previewShown()
    expect(screen.getByText('この試算結果は採用できません。もう一度、現在地点から再計画を試算してください。')).toBeInTheDocument()
    // Not an ordinary no-Plan result, and not an incomplete search.
    expect(screen.queryByText('現在の状態から作成できる生産計画はありませんでした。現在の生産計画は変更されていません。')).not.toBeInTheDocument()
    expect(screen.queryByText('生産計画の探索が完了していません')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: ADOPT })).not.toBeInTheDocument()
  })

  it('discards the Preview without any runtime call', async () => {
    const plan = runningPlan()
    const deps = dependencies(plan)
    const user = userEvent.setup()
    renderPage(deps, plan.id)
    await startPreview(user)
    await previewShown()

    await user.click(screen.getByRole('button', { name: 'この試算を破棄' }))

    expect(screen.queryByRole('heading', { name: PREVIEW_TITLE })).not.toBeInTheDocument()
    expect(deps.replan.inspectProductionPlanReplanAdoption).not.toHaveBeenCalled()
    expect(deps.replan.adoptProductionPlanReplanPreview).not.toHaveBeenCalled()
  })
})

describe('ProductionPlanPage replan adoption', () => {
  it('inspects first, confirms without a save point choice, adopts once and opens the new Navigator', async () => {
    const plan = runningPlan()
    const replan = replanDependencies(plan)
    const newPlan = currentContractPlan(PREVIEW_PLAN_ID, { status: 'draft' })
    vi.mocked(replan.adoptProductionPlanReplanPreview).mockResolvedValue(adopted(plan, newPlan))
    const deps = dependencies(plan, workerClient(), replan)
    const user = userEvent.setup()
    const { router } = renderPage(deps, plan.id)
    await startPreview(user)
    await previewShown()

    await user.click(screen.getByRole('button', { name: ADOPT }))

    const dialog = await screen.findByRole('dialog', { name: 'この再計画を採用します' })
    expect(replan.inspectProductionPlanReplanAdoption).toHaveBeenCalledOnce()
    expect(replan.adoptProductionPlanReplanPreview).not.toHaveBeenCalled()
    expect(within(dialog).getByText('現在の計画の実行履歴は残ります。採用は元に戻せません。')).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: '現在地点を維持' })).not.toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: ADOPT }))

    expect(await screen.findByText('Execution navigator destination')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(`/plans/${PREVIEW_PLAN_ID}/run`)
    expect(replan.adoptProductionPlanReplanPreview).toHaveBeenCalledOnce()
    const [request] = vi.mocked(replan.adoptProductionPlanReplanPreview).mock.calls[0]
    expect(request.savePointDecision).toBeNull()
    expect(request.preview).toBe((await vi.mocked(replan.inspectProductionPlanReplanAdoption).mock.calls[0][0]).preview)
    expect(deps.startProductionPlan).not.toHaveBeenCalled()
  })

  it('cancels the confirmation without adopting', async () => {
    const plan = runningPlan()
    const replan = replanDependencies(plan)
    const user = userEvent.setup()
    renderPage(dependencies(plan, workerClient(), replan), plan.id)
    await startPreview(user)
    await previewShown()
    await user.click(screen.getByRole('button', { name: ADOPT }))
    const dialog = await screen.findByRole('dialog', { name: 'この再計画を採用します' })

    await user.click(within(dialog).getByRole('button', { name: 'キャンセル' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(replan.adoptProductionPlanReplanPreview).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: PREVIEW_TITLE })).toBeInTheDocument()
  })

  it('asks the 16.10 choice only when the inspection says so, and keeps the current position on request', async () => {
    const plan = runningPlan()
    const replan = replanDependencies(plan)
    vi.mocked(replan.inspectProductionPlanReplanAdoption).mockResolvedValue(withChoice(plan))
    vi.mocked(replan.adoptProductionPlanReplanPreview).mockResolvedValue(
      adopted(plan, currentContractPlan(PREVIEW_PLAN_ID, { status: 'draft' }), 'keep_current'),
    )
    const user = userEvent.setup()
    const { router } = renderPage(dependencies(plan, workerClient(), replan), plan.id)
    await startPreview(user)
    await previewShown()

    await user.click(screen.getByRole('button', { name: ADOPT }))

    const dialog = await screen.findByRole('dialog', { name: 'この再計画を採用します' })
    expect(within(dialog).getByText(/最後のゲーム内セーブ地点: 作成開始時点（最初の操作の前）/)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: '最後のゲーム内セーブ地点へ戻す' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'キャンセル' })).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: '現在地点を維持' }))

    expect(await screen.findByText('Execution navigator destination')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(`/plans/${PREVIEW_PLAN_ID}/run`)
    expect(replan.adoptProductionPlanReplanPreview).toHaveBeenCalledOnce()
    expect(vi.mocked(replan.adoptProductionPlanReplanPreview).mock.calls[0][0].savePointDecision).toEqual({
      kind: 'keep_current',
      recordedAt: SAVE_POINT_RECORDED_AT,
    })
  })

  it('returns to the save point only after the game-side confirmation, adopts nothing and asks for a new Preview', async () => {
    const plan = runningPlan()
    const replan = replanDependencies(plan)
    vi.mocked(replan.inspectProductionPlanReplanAdoption).mockResolvedValue(withChoice(plan))
    vi.mocked(replan.adoptProductionPlanReplanPreview).mockResolvedValue({
      kind: 'save_point_restored_repreview_required',
      restoredPlan: plan,
      savePoint: { recordedAt: SAVE_POINT_RECORDED_AT, lastExecutionHistoryId: null, productionPlan: plan } as never,
      deletedExecutionHistoryIds: [],
    })
    const deps = dependencies(plan, workerClient(), replan)
    const user = userEvent.setup()
    const { router } = renderPage(deps, plan.id)
    await startPreview(user)
    await previewShown()
    const loadsBefore = vi.mocked(deps.getPlan).mock.calls.length
    await user.click(screen.getByRole('button', { name: ADOPT }))
    const dialog = await screen.findByRole('dialog', { name: 'この再計画を採用します' })

    await user.click(within(dialog).getByRole('button', { name: '最後のゲーム内セーブ地点へ戻す' }))

    const restore = await screen.findByRole('dialog', { name: '最後のゲーム内セーブ地点へ戻す' })
    expect(within(restore).getByText('セーブ地点へ戻した後、この試算は採用されません。復元後の状態から、もう一度再計画を試算してください。')).toBeInTheDocument()
    const confirm = within(restore).getByRole('button', { name: 'アプリ側もセーブ地点へ戻す' })
    expect(confirm).toBeDisabled()
    expect(replan.adoptProductionPlanReplanPreview).not.toHaveBeenCalled()

    await user.click(within(restore).getByRole('checkbox', { name: 'ゲーム側を最後のゲーム内セーブ地点まで戻しました' }))
    expect(confirm).toBeEnabled()
    await user.click(confirm)

    expect(await screen.findByText('最後のゲーム内セーブ地点へ戻しました。ゲーム状態が変わったため、再計画をもう一度試算してください。この試算は採用されていません。')).toBeInTheDocument()
    expect(replan.adoptProductionPlanReplanPreview).toHaveBeenCalledOnce()
    expect(vi.mocked(replan.adoptProductionPlanReplanPreview).mock.calls[0][0].savePointDecision).toEqual({
      kind: 'restore_save_point',
      recordedAt: SAVE_POINT_RECORDED_AT,
    })
    // The Preview is gone, the Plan is re-read, and nothing navigates or adopts.
    expect(screen.queryByRole('heading', { name: PREVIEW_TITLE })).not.toBeInTheDocument()
    await waitFor(() => expect(vi.mocked(deps.getPlan).mock.calls.length).toBeGreaterThan(loadsBefore))
    await dialogClosed()
    expect(router.state.location.pathname).toBe(`/plans/${plan.id}`)
    expect(await screen.findByRole('button', { name: START })).toBeEnabled()
  })

  it('drops the Preview and asks for a new one when the state changed before the adoption', async () => {
    const plan = runningPlan()
    const replan = replanDependencies(plan)
    vi.mocked(replan.adoptProductionPlanReplanPreview).mockRejectedValue(
      new ExecutionRuntimeError('replan_state_changed', 'moved on'),
    )
    const deps = dependencies(plan, workerClient(), replan)
    const user = userEvent.setup()
    const { router } = renderPage(deps, plan.id)
    await startPreview(user)
    await previewShown()
    const loadsBefore = vi.mocked(deps.getPlan).mock.calls.length
    await user.click(screen.getByRole('button', { name: ADOPT }))
    const dialog = await screen.findByRole('dialog', { name: 'この再計画を採用します' })

    await user.click(within(dialog).getByRole('button', { name: ADOPT }))

    expect(await screen.findByText('試算後に状態が変わりました。もう一度、現在地点から再計画を試算してください。')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: PREVIEW_TITLE })).not.toBeInTheDocument()
    expect(replan.adoptProductionPlanReplanPreview).toHaveBeenCalledOnce()
    await waitFor(() => expect(vi.mocked(deps.getPlan).mock.calls.length).toBeGreaterThan(loadsBefore))
    expect(router.state.location.pathname).toBe(`/plans/${plan.id}`)
    // No automatic re-Preview and no second adoption.
    expect(replan.prepareProductionPlanReplanPreview).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: START })).toBeEnabled()
  })

  it.each([
    ['replan_state_changed', '試算後に状態が変わりました。もう一度、現在地点から再計画を試算してください。'],
    ['replan_result_invalid', 'この試算結果は採用できません。もう一度、現在地点から再計画を試算してください。'],
  ] as const)('never opens the confirmation on an old Preview when the inspection refuses with %s', async (code, message) => {
    const plan = runningPlan()
    const replan = replanDependencies(plan)
    vi.mocked(replan.inspectProductionPlanReplanAdoption).mockRejectedValue(new ExecutionRuntimeError(code, 'refused'))
    const user = userEvent.setup()
    renderPage(dependencies(plan, workerClient(), replan), plan.id)
    await startPreview(user)
    await previewShown()

    await user.click(screen.getByRole('button', { name: ADOPT }))

    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: PREVIEW_TITLE })).not.toBeInTheDocument()
    expect(replan.adoptProductionPlanReplanPreview).not.toHaveBeenCalled()
  })

  it('keeps the Preview and reports a storage failure without navigating', async () => {
    const plan = runningPlan()
    const replan = replanDependencies(plan)
    const { RepositoryError } = await import('../db/repositoryError')
    vi.mocked(replan.adoptProductionPlanReplanPreview).mockRejectedValue(new RepositoryError('transaction_failed', 'failed'))
    const user = userEvent.setup()
    const { router } = renderPage(dependencies(plan, workerClient(), replan), plan.id)
    await startPreview(user)
    await previewShown()
    await user.click(screen.getByRole('button', { name: ADOPT }))
    const dialog = await screen.findByRole('dialog', { name: 'この再計画を採用します' })

    await user.click(within(dialog).getByRole('button', { name: ADOPT }))

    expect(await screen.findByText('保存に失敗しました。状態は変更されていません。再試行してください。')).toBeInTheDocument()
    await dialogClosed()
    expect(screen.getByRole('heading', { name: PREVIEW_TITLE })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(`/plans/${plan.id}`)
  })

  it('shows the page without a 16.8 control for a running Plan whose page has no Master Data', async () => {
    // Regression guard of the ordinary page: no replan dependency is reached
    // when the Plan is a draft, whatever the page state.
    const plan = runningPlan({ status: 'draft', currentStepId: null })
    const deps = dependencies(plan)
    renderPage(deps, plan.id)
    expect(await screen.findByRole('button', { name: '作成開始' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: START })).not.toBeInTheDocument()
  })

  it.each([
    ['this step', planStepId('step.replan.other')],
  ])('keeps the page state controls apart from the Preview (%s)', async (_, stepId) => {
    // The Preview never changes the displayed Plan: the same running Plan
    // (same current Step) stays on the page after a completed Preview.
    const plan = runningPlan()
    const deps = dependencies(plan)
    const user = userEvent.setup()
    renderPage(deps, plan.id)
    await startPreview(user)
    await previewShown()
    expect(plan.currentStepId).not.toBe(stepId)
    expect(screen.getByRole('link', { name: '実行ナビを再開する' })).toHaveAttribute('href', `/plans/${plan.id}/run`)
  })
})
