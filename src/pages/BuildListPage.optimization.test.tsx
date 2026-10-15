import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider, useParams } from 'react-router-dom'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { RepositoryError } from '../db/repositoryError'
import type { MasterDataRoot } from '../domain/master/masterTypes'
import type { CalculationContext, ProductionPlan } from '../domain/models/publicTypes'
import type { PlannerInput, PlannerResult } from '../domain/planner'
import type { BuildListOptimizationResult, PlanCreationMethodSelection } from '../domain/planner/buildListOptimization'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../domain/rng/production/productionRngEngine'
import { BUILD_LIST_OPTIMIZATION_LONG_RUN_NOTICE } from '../components/planner/buildListOptimizationPresentation'
import type { ProductionPlanReplanDependencies } from '../services/execution/productionPlanReplanDependencies'
import type { BuildListOptimizationAdoptionSource } from '../services/planner/buildListOptimizationService'
import type { BuildListOptimizationAdoptionInspection } from '../services/planner/plannerResultPersistenceService'
import type { PlannerWorkerClient } from '../services/planner/plannerWorkerClient'
import { BONUS_ONLY_TARGET_ID, type BuildListOptimizationAdoptionFixture } from '../test/fixtures/buildListOptimizationAdoptionFixtures'
import {
  BUILD_LIST_OPTIMIZATION_TEST_DIAGNOSTICS,
  optimizedPresentationFixture,
  ordinaryDraftFromSameInput,
  presentationTestMaster,
} from '../test/fixtures/buildListOptimizationPresentationFixtures'
import {
  createTestPlanCreationSession,
  fakeBuildListOptimizationClient,
  optimizationSelection,
  ordinarySelection,
  unsupportedSelection,
} from '../test/fixtures/buildListPagePlanCreation'
import { createValidProductionPlan, productionPlanId } from '../test/fixtures/domainData'
import { completedPlannerTermination, incompletePlannerTermination } from '../test/fixtures/plannerTermination'
import { BuildListPage, type BuildListPageDependencies } from './BuildListPage'

/*
 * Issue #260 PR-6C: 「生産計画を作成」 of the Build List over the plan creation session (`docs/PLANNER_SPEC.md` 17.2 / 17.9 / 17.11 /
 * 17.16, `docs/UI_FLOW.md` 10.0 / 10.4). The session is the real Application one; its reads, its judgement and both Worker Clients
 * are test doubles, and the `optimized` result is the real artifact of `runBuildListOptimization()`.
 */

let master: MasterDataRoot
let fixture: BuildListOptimizationAdoptionFixture
let draft: ProductionPlan

beforeAll(async () => {
  master = presentationTestMaster()
  fixture = await optimizedPresentationFixture('scoped')
  draft = await ordinaryDraftFromSameInput(fixture)
})

afterEach(() => {
  vi.useRealTimers()
})

const CREATE = '生産計画を作成'
const AUXILIARY = '登録済みの候補で生産計画を作成'
const PREVIEW_TITLE = '全体最適化の試算（未採用）'
const ADOPT = 'この計画を採用'
const SETTINGS = '詳細設定（通常Planner用）'
const RUNNING_TITLE = '生産計画を計算中'

const NOT_FOUND: BuildListOptimizationResult = { status: 'not_found', reason: 'candidates_rejected', diagnostics: BUILD_LIST_OPTIMIZATION_TEST_DIAGNOSTICS }
const SEARCH_BOUND: BuildListOptimizationResult = {
  status: 'search_bound_reached',
  bounds: [{ kind: 'planner_verification_budget', maxPlannerVerifications: 3 }],
  diagnostics: BUILD_LIST_OPTIMIZATION_TEST_DIAGNOSTICS,
}

function unusedReplan(): ProductionPlanReplanDependencies {
  const notExpected = () => Promise.reject(new Error('replan is not expected'))
  return {
    prepareProductionPlanReplanPreview: vi.fn(notExpected),
    createProductionPlanReplanPreview: vi.fn(() => { throw new Error('replan is not expected') }),
    inspectProductionPlanReplanAdoption: vi.fn(notExpected),
    adoptProductionPlanReplanPreview: vi.fn(notExpected),
  }
}

function plannerClient(result?: () => Promise<PlannerResult>): PlannerWorkerClient {
  return {
    engineVersion: PRODUCTION_RNG_ENGINE_VERSION,
    createPlan: vi.fn(result ?? (async () => ({ plan: createValidProductionPlan(), conflicts: [], warnings: [], termination: completedPlannerTermination() }))),
    createPlannerAlternativeComparison: vi.fn(),
    createPlannerAlternativeRepair: vi.fn(),
    prepareInteraction: vi.fn(),
    cancelPlan: vi.fn(),
    dispose: vi.fn(),
  }
}

function inspectionOf(source: BuildListOptimizationAdoptionSource): BuildListOptimizationAdoptionInspection {
  const replaced = new Map(fixture.input.buildListEntries.map((entry) => [entry.id, entry] as const))
  return {
    replacedDraftPlanId: source.startSnapshot.observedDraftPlanId,
    replacements: source.artifact.replacements.map((replacement) => ({
      ...replacement,
      replacedImprovementPreference: replaced.get(replacement.replacedBuildListEntryId)?.intermediateStateSelection?.improvementPreference ?? 'planner',
    })),
    unchangedTargetWeaponIds: [...source.artifact.unchangedTargetWeaponIds],
  }
}

interface Harness {
  deps: BuildListPageDependencies
  optimization: ReturnType<typeof fakeBuildListOptimizationClient>
  ordinary: PlannerWorkerClient
  /** Every fresh read the session made (the pre-start judgement and each press), in order. */
  reads: PlannerInput[]
  savePlannerResult: ReturnType<typeof vi.fn<(result: PlannerResult, context: CalculationContext) => Promise<ProductionPlan | null>>>
  inspect: ReturnType<typeof vi.fn<(source: BuildListOptimizationAdoptionSource, context: CalculationContext) => Promise<BuildListOptimizationAdoptionInspection>>>
  save: ReturnType<typeof vi.fn<(source: BuildListOptimizationAdoptionSource, context: CalculationContext) => Promise<ProductionPlan>>>
  createSession: ReturnType<typeof vi.fn>
}

function harness(options: {
  /** The judgement of each read, by its index (0 is the first read). Defaults to the optimization with three valid Entries. */
  select?: (input: PlannerInput, readIndex: number) => PlanCreationMethodSelection
  /** Rewrites each read (for example, to tell the pre-start read from the press read). */
  read?: (input: PlannerInput, readIndex: number) => PlannerInput
  ordinary?: PlannerWorkerClient
  currentDraft?: ProductionPlan
} = {}): Harness {
  const optimization = fakeBuildListOptimizationClient()
  const ordinary = options.ordinary ?? plannerClient()
  const reads: PlannerInput[] = []
  const savePlannerResult = vi.fn(async (): Promise<ProductionPlan | null> => ({ ...createValidProductionPlan(), id: productionPlanId('plan.ordinary.saved') }))
  const inspect = vi.fn(async (source: BuildListOptimizationAdoptionSource) => inspectionOf(source))
  const save = vi.fn(async (): Promise<ProductionPlan> => ({ ...createValidProductionPlan(), id: productionPlanId('plan.adopted.saved') }))
  const createSession = vi.fn(() => createTestPlanCreationSession({
    createInput: async () => {
      const index = reads.length
      const read = (options.read ?? ((input) => input))(structuredClone(fixture.input), index)
      reads.push(read)
      return read
    },
    select: (input) => (options.select ?? optimizationSelection(3))(input, reads.length - 1),
    createPlannerClient: () => ordinary,
    createOptimizationClient: () => optimization.client,
    startSnapshot: { observedDraftPlanId: options.currentDraft?.id ?? null, runningPlanAbsent: true },
  }))
  const deps: BuildListPageDependencies = {
    master,
    createWorkerClient: () => plannerClient(),
    refresh: vi.fn(async () => ({
      entries: structuredClone(fixture.input.buildListEntries),
      targets: structuredClone(fixture.input.targetWeapons),
      ownedWeapons: structuredClone(fixture.input.ownedWeapons),
    })),
    createPlanCreationSession: createSession,
    inspectBuildListOptimizationAdoption: inspect,
    saveBuildListOptimizationAdoption: save,
    savePlannerResult,
    updateIntermediateStateSelection: vi.fn(async () => { throw new Error('not used') }),
    inspectIntermediateStateSelectionUpdate: vi.fn(async () => ({ approvalRequired: false as const })),
    deleteEntry: vi.fn(async () => undefined),
    inspectEntryDelete: vi.fn(async () => ({ approvalRequired: false as const })),
    getRunningProductionPlan: vi.fn(async () => undefined),
    getDraftProductionPlan: vi.fn(async () => options.currentDraft),
    replan: unusedReplan(),
  }
  return { deps, optimization, ordinary, reads, savePlannerResult, inspect, save, createSession }
}

function PlanDestination() {
  const { planId } = useParams()
  return <div>Plan destination: {planId}</div>
}

function renderPage(deps: BuildListPageDependencies) {
  const router = createMemoryRouter([
    { path: '/build-list', element: <BuildListPage dependencies={deps} /> },
    { path: '/plans/:planId', element: <PlanDestination /> },
  ], { initialEntries: ['/build-list'] })
  return { router, ...render(<RouterProvider router={router} />) }
}

async function primaryButton() {
  const button = await screen.findByRole('button', { name: CREATE })
  return button
}

/** Waits for the pre-start judgement and presses 「生産計画を作成」. */
async function pressCreate(user: ReturnType<typeof userEvent.setup>) {
  const button = await primaryButton()
  await waitFor(() => expect(button).toBeEnabled())
  await user.click(button)
}

/** Presses 「生産計画を作成」 and completes the optimization run with `result`. */
async function calculate(h: Harness, user: ReturnType<typeof userEvent.setup>, result: BuildListOptimizationResult) {
  await pressCreate(user)
  await waitFor(() => expect(h.optimization.runs).toHaveLength(1))
  await act(async () => {
    h.optimization.runs[0]!.complete(result)
  })
}

const optimized = (): BuildListOptimizationResult => ({ status: 'optimized', artifact: structuredClone(fixture.artifact) })

describe('BuildListPage plan creation method (PLANNER_SPEC 17.2 U1)', () => {
  it('runs the global optimization for two or more valid Entries on the input the press read, never the ordinary Planner', async () => {
    const user = userEvent.setup()
    const h = harness()
    renderPage(h.deps)
    expect(await screen.findByText(/有効な候補が3件あります。/)).toBeInTheDocument()
    await pressCreate(user)
    await waitFor(() => expect(h.optimization.runs).toHaveLength(1))
    // The press read afresh (after the pre-start read) and the optimization calculates exactly that read.
    expect(h.reads.length).toBeGreaterThanOrEqual(2)
    expect(h.optimization.runs[0]!.input).toBe(h.reads.at(-1))
    expect(h.ordinary.createPlan).not.toHaveBeenCalled()
    expect(await screen.findByRole('status', { name: RUNNING_TITLE })).toBeInTheDocument()
  })

  it('runs the ordinary Planner for one valid Entry and saves through the ordinary Persistence', async () => {
    const user = userEvent.setup()
    const h = harness({ select: (input) => ordinarySelection(input) })
    const view = renderPage(h.deps)
    expect(await screen.findByText(/有効な候補は1件です。/)).toBeInTheDocument()
    await pressCreate(user)
    expect(await screen.findByText('Plan destination: plan.ordinary.saved')).toBeInTheDocument()
    expect(h.ordinary.createPlan).toHaveBeenCalledOnce()
    expect(h.optimization.client.run).not.toHaveBeenCalled()
    expect(h.savePlannerResult).toHaveBeenCalledOnce()
    expect(view.router.state.location.pathname).toBe('/plans/plan.ordinary.saved')
  })

  it('follows the judgement read at the press, not the one shown before it', async () => {
    const user = userEvent.setup()
    // Shown: the optimization. At the press: one valid Entry left (another screen changed the Build List).
    const h = harness({ select: (input, index) => (index === 0 ? optimizationSelection(2)(input) : ordinarySelection(input)) })
    renderPage(h.deps)
    expect(await screen.findByText(/有効な候補が2件あります。/)).toBeInTheDocument()
    await pressCreate(user)
    await screen.findByText(/^Plan destination:/)
    expect(h.ordinary.createPlan).toHaveBeenCalledOnce()
    expect(h.optimization.client.run).not.toHaveBeenCalled()
  })

  it.each([
    ['no valid Entry', (input: PlannerInput): PlanCreationMethodSelection => ({ kind: 'no_valid_build_list_entry', validation: optimizationSelection(0)(input).validation }), /有効な候補が無いため、生産計画を作成できません。/],
    ['a whole-input fail closed', (input: PlannerInput): PlanCreationMethodSelection => ({ kind: 'invalid_planner_input', validation: { ...optimizationSelection(2)(input).validation, isValid: false } }), /作成リストに整理が必要な項目があるため/],
  ])('starts nothing and offers no auxiliary operation for %s', async (_label, select, message) => {
    const h = harness({ select })
    renderPage(h.deps)
    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(await primaryButton()).toBeDisabled()
    expect(screen.queryByRole('button', { name: AUXILIARY })).not.toBeInTheDocument()
    expect(h.ordinary.createPlan).not.toHaveBeenCalled()
    expect(h.optimization.client.run).not.toHaveBeenCalled()
  })

  it('never reads a failed read as "no candidate" and lets the user check again', async () => {
    const user = userEvent.setup()
    const h = harness()
    let fail = true
    h.deps.createPlanCreationSession = () => createTestPlanCreationSession({
      createInput: async () => {
        if (fail) throw new RepositoryError('transaction_failed', 'read failed')
        return structuredClone(fixture.input)
      },
      select: optimizationSelection(3),
      createPlannerClient: () => h.ordinary,
      createOptimizationClient: () => h.optimization.client,
    })
    renderPage(h.deps)
    expect(await screen.findByText('作成リストと生産計画の状態を確認できないため、生産計画の作成はできません。')).toBeInTheDocument()
    expect(screen.queryByText(/有効な候補が無い/)).not.toBeInTheDocument()
    expect(await primaryButton()).toBeDisabled()
    fail = false
    await user.click(screen.getByRole('button', { name: 'もう一度確認する' }))
    expect(await screen.findByText(/有効な候補が3件あります。/)).toBeInTheDocument()
    expect(await primaryButton()).toBeEnabled()
  })

  it('re-reads the page when the judgement finds a running Plan, offering no creation', async () => {
    const h = harness()
    let inspections = 0
    h.deps.createPlanCreationSession = () => createTestPlanCreationSession({
      createInput: async () => structuredClone(fixture.input),
      prepare: async () => {
        inspections += 1
        return { kind: 'running_plan_exists', runningPlanId: productionPlanId('plan.running.elsewhere') }
      },
      createPlannerClient: () => h.ordinary,
    })
    renderPage(h.deps)
    expect(await screen.findByText(/実行中の生産計画があるため、新しい生産計画は作成できません。/)).toBeInTheDocument()
    expect(await primaryButton()).toBeDisabled()
    // The page's running Plan and Build List are read again (and the judgement with them) - once: even while the page's own read
    // still finds no running Plan, the disagreement never turns into a re-read loop.
    await waitFor(() => expect(vi.mocked(h.deps.refresh)).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(inspections).toBe(2))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(h.deps.refresh).toHaveBeenCalledTimes(2)
    expect(inspections).toBe(2)
  })

  it('keeps the primary operation single: no standing second Planner button beside it', async () => {
    const h = harness()
    renderPage(h.deps)
    await screen.findByText(/有効な候補が3件あります。/)
    const section = screen.getByRole('region', { name: '生産計画の作成' })
    expect(within(section).getAllByRole('button', { name: CREATE })).toHaveLength(1)
    expect(within(section).queryByRole('button', { name: AUXILIARY })).not.toBeInTheDocument()
    expect(within(section).queryByRole('button', { name: /全体最適化を試す/ })).not.toBeInTheDocument()
  })
})

describe('BuildListPage ordinary Planner settings (U7)', () => {
  async function invalidateSettings(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: SETTINGS }))
    const field = screen.getByLabelText('最大計画ステップ数')
    await user.clear(field)
  }

  it('starts the global optimization with an invalid setting and never hands the setting to it', async () => {
    const user = userEvent.setup()
    const h = harness()
    renderPage(h.deps)
    await screen.findByText(/有効な候補が3件あります。/)
    await invalidateSettings(user)
    expect(screen.queryByText(/最大計画ステップ数」が無効なため、開始できません/)).not.toBeInTheDocument()
    await pressCreate(user)
    await waitFor(() => expect(h.optimization.runs).toHaveLength(1))
    // The optimization receives the fresh input as it was read: its options are the input's own, not the screen's.
    expect(h.optimization.runs[0]!.input.options).toEqual(h.reads.at(-1)!.options)
  })

  it('withholds the ordinary Planner with an invalid setting and says why next to it, filling in no default', async () => {
    const user = userEvent.setup()
    const h = harness({ select: (input) => ordinarySelection(input) })
    renderPage(h.deps)
    await screen.findByText(/有効な候補は1件です。/)
    await invalidateSettings(user)
    const button = await primaryButton()
    expect(button).toBeDisabled()
    expect(screen.getByText('通常Plannerの詳細設定の「最大計画ステップ数」が無効なため、開始できません。1以上の整数を入力してください。')).toBeInTheDocument()
    expect(button).toHaveAccessibleDescription(/最大計画ステップ数」が無効なため/)
    expect(h.ordinary.createPlan).not.toHaveBeenCalled()
  })

  it('refuses an ordinary Planner chosen at the press when the setting is invalid, never switching to the optimization', async () => {
    const user = userEvent.setup()
    const h = harness({ select: (input, index) => (index === 0 ? optimizationSelection(2)(input) : ordinarySelection(input)) })
    renderPage(h.deps)
    await screen.findByText(/有効な候補が2件あります。/)
    await invalidateSettings(user)
    await pressCreate(user)
    expect(await screen.findByText(/最大計画ステップ数」が無効なため、開始しませんでした。/)).toBeInTheDocument()
    expect(h.ordinary.createPlan).not.toHaveBeenCalled()
    expect(h.optimization.client.run).not.toHaveBeenCalled()
  })

  it('keeps the Preview while the setting is edited', async () => {
    const user = userEvent.setup()
    const h = harness()
    renderPage(h.deps)
    await calculate(h, user, optimized())
    expect(await screen.findByRole('heading', { name: PREVIEW_TITLE })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: SETTINGS }))
    await user.clear(screen.getByLabelText('最大計画ステップ数'))
    await user.type(screen.getByLabelText('最大計画ステップ数'), '2000')
    expect(screen.getByRole('heading', { name: PREVIEW_TITLE })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '既定値に戻す' }))
    expect(screen.getByRole('heading', { name: PREVIEW_TITLE })).toBeInTheDocument()
  })
})

describe('BuildListPage optimization running state and results (PLANNER_SPEC 17.8 / 17.16)', () => {
  it('shows the stage and cancels the run; a result arriving afterwards is never shown', async () => {
    const user = userEvent.setup()
    const h = harness()
    renderPage(h.deps)
    await pressCreate(user)
    await waitFor(() => expect(h.optimization.runs).toHaveLength(1))
    const run = h.optimization.runs[0]!
    act(() => run.observer?.onStage?.('assignment_search'))
    const status = await screen.findByRole('status', { name: RUNNING_TITLE })
    expect(within(status).getByText('現在の段階：割当の探索')).toBeInTheDocument()
    expect(within(status).queryByText(/%|残り/)).not.toBeInTheDocument()
    await user.click(within(status).getByRole('button', { name: 'キャンセル' }))
    expect(run.cancel).toHaveBeenCalled()
    expect(await screen.findByText('全体最適化の計算をキャンセルしました。')).toBeInTheDocument()
    act(() => run.complete(optimized()))
    expect(screen.queryByRole('heading', { name: PREVIEW_TITLE })).not.toBeInTheDocument()
    // A cancellation is no reason to run the ordinary Planner.
    expect(screen.queryByRole('button', { name: AUXILIARY })).not.toBeInTheDocument()
    expect(h.ordinary.createPlan).not.toHaveBeenCalled()
  })

  it('adds the 30 s notice to a run still going, and a new run counts from zero', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const h = harness()
    renderPage(h.deps)
    await pressCreate(user)
    await waitFor(() => expect(h.optimization.runs).toHaveLength(1))
    await act(async () => {
      vi.advanceTimersByTime(29_000)
    })
    expect(screen.queryByText(BUILD_LIST_OPTIMIZATION_LONG_RUN_NOTICE)).not.toBeInTheDocument()
    await act(async () => {
      vi.advanceTimersByTime(1_500)
    })
    expect(screen.getByText(BUILD_LIST_OPTIMIZATION_LONG_RUN_NOTICE)).toBeInTheDocument()
    // Still running: nothing stopped it.
    expect(h.optimization.runs[0]!.cancel).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(screen.queryByText(BUILD_LIST_OPTIMIZATION_LONG_RUN_NOTICE)).not.toBeInTheDocument()
    await pressCreate(user)
    await waitFor(() => expect(h.optimization.runs).toHaveLength(2))
    await act(async () => {
      vi.advanceTimersByTime(10_000)
    })
    expect(screen.queryByText(BUILD_LIST_OPTIMIZATION_LONG_RUN_NOTICE)).not.toBeInTheDocument()
  })

  it.each([
    ['not_found', NOT_FOUND, '組み合わせを見つけられませんでした'],
    ['search_bound_reached', SEARCH_BOUND, '結果を確定できませんでした'],
  ] as const)('offers the ordinary Planner auxiliary operation inside a %s result, running it only on a press', async (_label, result, title) => {
    const user = userEvent.setup()
    const h = harness()
    const view = renderPage(h.deps)
    await calculate(h, user, result)
    expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument()
    const auxiliary = screen.getByRole('button', { name: AUXILIARY })
    // Offered, never started on its own.
    expect(h.ordinary.createPlan).not.toHaveBeenCalled()
    await user.click(auxiliary)
    expect(await screen.findByText('Plan destination: plan.ordinary.saved')).toBeInTheDocument()
    expect(h.ordinary.createPlan).toHaveBeenCalledOnce()
    // The ordinary Planner runs the press's fresh read with the user's setting; no Entry is written.
    const [, input] = vi.mocked(h.ordinary.createPlan).mock.calls[0]!
    expect(input.options).toEqual({ maxPlanSteps: expect.any(Number) })
    expect(input.buildListEntries).toEqual(h.reads.at(-1)!.buildListEntries)
    expect(h.deps.updateIntermediateStateSelection).not.toHaveBeenCalled()
    expect(h.deps.deleteEntry).not.toHaveBeenCalled()
    expect(view.router.state.location.pathname).toBe('/plans/plan.ordinary.saved')
  })

  it('keeps the result and its auxiliary operation after an incomplete auxiliary run, which is not saved and can be run again', async () => {
    const user = userEvent.setup()
    const incomplete: PlannerResult = { plan: createValidProductionPlan(), conflicts: [], warnings: [], termination: incompletePlannerTermination() }
    let calls = 0
    const ordinary = plannerClient(async () => {
      calls += 1
      return calls === 1 ? incomplete : { plan: createValidProductionPlan(), conflicts: [], warnings: [], termination: completedPlannerTermination() }
    })
    const h = harness({ ordinary })
    renderPage(h.deps)
    await calculate(h, user, NOT_FOUND)
    await user.click(await screen.findByRole('button', { name: AUXILIARY }))
    expect(await screen.findByText('生産計画の探索が完了していません')).toBeInTheDocument()
    expect(screen.getByText(/「詳細設定（通常Planner用）」の「最大計画ステップ数」を増やして、もう一度「登録済みの候補で生産計画を作成」を実行してください。/)).toBeInTheDocument()
    expect(h.savePlannerResult).not.toHaveBeenCalled()
    // The not_found result and its offer stay.
    expect(screen.getByRole('heading', { name: '組み合わせを見つけられませんでした' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: AUXILIARY }))
    expect(await screen.findByText(/^Plan destination:/)).toBeInTheDocument()
    expect(ordinary.createPlan).toHaveBeenCalledTimes(2)
    expect(h.savePlannerResult).toHaveBeenCalledOnce()
  })

  it('withholds the auxiliary operation with an invalid setting and says why beside it, keeping the result', async () => {
    const user = userEvent.setup()
    const h = harness()
    renderPage(h.deps)
    await calculate(h, user, SEARCH_BOUND)
    await user.click(await screen.findByRole('button', { name: SETTINGS }))
    await user.clear(screen.getByLabelText('最大計画ステップ数'))
    const auxiliary = screen.getByRole('button', { name: AUXILIARY })
    expect(auxiliary).toBeDisabled()
    expect(auxiliary).toHaveAccessibleDescription(/最大計画ステップ数」が無効なため/)
    expect(screen.getByRole('heading', { name: '結果を確定できませんでした' })).toBeInTheDocument()
  })

  it('offers the auxiliary operation for a pre-start unsupported input, keeping the selection as it is', async () => {
    const user = userEvent.setup()
    const reasons = [{ kind: 'checkpoint_selection' as const, entries: [{ buildListEntryId: fixture.input.buildListEntries[0]!.id, targetWeaponId: fixture.input.buildListEntries[0]!.targetWeaponId }] }]
    const h = harness({ select: unsupportedSelection(reasons, true) })
    renderPage(h.deps)
    expect(await screen.findByText(/次の理由により全体最適化を使えないため/)).toBeInTheDocument()
    expect(await primaryButton()).toBeDisabled()
    expect(screen.getByText('途中採用する状態を選択している候補があります')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: AUXILIARY }))
    expect(await screen.findByText(/^Plan destination:/)).toBeInTheDocument()
    expect(h.ordinary.createPlan).toHaveBeenCalledOnce()
    expect(h.optimization.client.run).not.toHaveBeenCalled()
    expect(h.deps.updateIntermediateStateSelection).not.toHaveBeenCalled()
  })

  it('offers no auxiliary operation for an unsupported input the ordinary Planner cannot run either', async () => {
    const h = harness({ select: unsupportedSelection([{ kind: 'no_planning_target' }], false) })
    renderPage(h.deps)
    expect(await screen.findByText('有効な候補がありません')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: AUXILIARY })).not.toBeInTheDocument()
  })

  it('shows a Worker failure and a contract violation as errors with no auxiliary operation, and retries only on a press', async () => {
    const user = userEvent.setup()
    const h = harness()
    renderPage(h.deps)
    await pressCreate(user)
    await waitFor(() => expect(h.optimization.runs).toHaveLength(1))
    act(() => h.optimization.runs[0]!.settle({ status: 'failed', requestId: h.optimization.runs[0]!.requestId, failure: { kind: 'worker_error', message: 'boom' } }))
    expect(await screen.findByRole('heading', { name: '計算を完了できませんでした' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: AUXILIARY })).not.toBeInTheDocument()
    expect(h.optimization.runs).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'もう一度計算する' }))
    await waitFor(() => expect(h.optimization.runs).toHaveLength(2))
    act(() => h.optimization.runs[1]!.settle({
      status: 'failed',
      requestId: h.optimization.runs[1]!.requestId,
      failure: { kind: 'invalid_result', issues: ['broken'] },
    }))
    expect(await screen.findByText(/「全体最適化を使えない」や「組み合わせが見つからなかった」という意味ではありません。/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: AUXILIARY })).not.toBeInTheDocument()
    expect(h.ordinary.createPlan).not.toHaveBeenCalled()
  })
})

describe('BuildListPage unsaved Preview (PLANNER_SPEC 17.9)', () => {
  it('shows the Preview of an optimized result only, writes nothing, and names what the calculation ran on', async () => {
    const user = userEvent.setup()
    // The pre-start read and the press read differ (a Target was renamed in between): the Preview names the press read's Target.
    const h = harness({
      read: (input, index) => ({
        ...input,
        targetWeapons: input.targetWeapons.map((target) => (target.id === BONUS_ONLY_TARGET_ID
          ? { ...target, name: index === 0 ? '表示時の名前' : '押した時点の名前' }
          : target)),
      }),
    })
    renderPage(h.deps)
    await calculate(h, user, optimized())
    const heading = await screen.findByRole('heading', { name: PREVIEW_TITLE })
    expect(heading).toHaveFocus()
    expect(screen.getByText(/まだ作成リストと生産計画は変更されていません。/)).toBeInTheDocument()
    const resets = screen.getByRole('list', { name: '改善優先が戻る目標武器' })
    expect(within(resets).getByText(/押した時点の名前/)).toBeInTheDocument()
    expect(screen.queryByText(/表示時の名前/)).not.toBeInTheDocument()
    // Nothing is stored by showing it.
    expect(h.inspect).not.toHaveBeenCalled()
    expect(h.save).not.toHaveBeenCalled()
    expect(h.savePlannerResult).not.toHaveBeenCalled()
    // No auxiliary operation beside an optimized result.
    expect(screen.queryByRole('button', { name: AUXILIARY })).not.toBeInTheDocument()
  })

  it('compares the current Draft only when it comes from the same input', async () => {
    const user = userEvent.setup()
    const h = harness({ currentDraft: draft })
    renderPage(h.deps)
    await calculate(h, user, optimized())
    expect(await screen.findByRole('heading', { name: PREVIEW_TITLE })).toBeInTheDocument()
    expect(screen.getAllByText(/現在の下書きは、この試算と同じ作成リスト・目標武器・状態から作られています。/)).toHaveLength(1)
  })

  it('drops the Preview on 「戻る」, on a new run and on a Build List change, never keeping an adoption for it', async () => {
    const user = userEvent.setup()
    const h = harness()
    renderPage(h.deps)
    await calculate(h, user, optimized())
    await user.click(await screen.findByRole('button', { name: '戻る' }))
    expect(screen.queryByRole('heading', { name: PREVIEW_TITLE })).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: CREATE })).toHaveFocus())

    // A new run replaces it.
    await pressCreate(user)
    await waitFor(() => expect(h.optimization.runs).toHaveLength(2))
    expect(screen.queryByRole('heading', { name: PREVIEW_TITLE })).not.toBeInTheDocument()
    act(() => h.optimization.runs[1]!.complete(optimized()))
    expect(await screen.findByRole('heading', { name: PREVIEW_TITLE })).toBeInTheDocument()

    // A Build List change on this screen drops it.
    fireEvent.click(screen.getByRole('button', { name: 'すべて展開' }))
    await user.click(screen.getAllByRole('button', { name: 'ビルドリストから削除' })[0]!)
    await waitFor(() => expect(h.deps.deleteEntry).toHaveBeenCalledOnce())
    await waitFor(() => expect(screen.queryByRole('heading', { name: PREVIEW_TITLE })).not.toBeInTheDocument())
    expect(h.inspect).not.toHaveBeenCalled()
  })

  it('locks the Build List edits while a calculation runs', async () => {
    const user = userEvent.setup()
    const h = harness()
    renderPage(h.deps)
    fireEvent.click(await screen.findByRole('button', { name: 'すべて展開' }))
    await pressCreate(user)
    await waitFor(() => expect(h.optimization.runs).toHaveLength(1))
    for (const button of screen.getAllByRole('button', { name: 'ビルドリストから削除' })) expect(button).toBeDisabled()
    expect(screen.getByText(/作成リストの変更（途中採用する状態・改善優先の変更、削除）はできません。/)).toBeInTheDocument()
  })

  it('cancels the calculation when the screen is left', async () => {
    const user = userEvent.setup()
    const h = harness()
    const view = renderPage(h.deps)
    await pressCreate(user)
    await waitFor(() => expect(h.optimization.runs).toHaveLength(1))
    view.unmount()
    expect(h.optimization.runs[0]!.cancel).toHaveBeenCalled()
  })

})

describe('BuildListPage adoption (PLANNER_SPEC 17.11, UI_FLOW 10.4 「採用」)', () => {
  it('inspects on 「この計画を採用」, confirms in the dialog, saves once and opens the Draft Persistence returned', async () => {
    const user = userEvent.setup()
    const h = harness({ currentDraft: draft })
    const view = renderPage(h.deps)
    await calculate(h, user, optimized())
    await user.click(await screen.findByRole('button', { name: ADOPT }))
    await waitFor(() => expect(h.inspect).toHaveBeenCalledOnce())
    // The adoption source is the shown run's artifact and the start snapshot of the same run.
    const [source] = h.inspect.mock.calls[0]!
    expect(source.artifact.replacements).toEqual(fixture.artifact.replacements)
    expect(source.startSnapshot).toEqual({ observedDraftPlanId: draft.id, runningPlanAbsent: true })
    const dialog = await screen.findByRole('dialog', { name: 'この計画を採用しますか？' })
    expect(within(dialog).getByText(`${fixture.artifact.replacements.length}件`)).toBeInTheDocument()
    expect(within(dialog).getByText(/目標武器ごとに一部だけ採用することはできません。/)).toBeInTheDocument()
    expect(within(dialog).getByText(/置き換えた候補は自動では元に戻せません。/)).toBeInTheDocument()
    expect(within(dialog).getByText('この計画に置き換えます')).toBeInTheDocument()
    expect(within(dialog).getByText(/改善優先は「生産計画に任せる」になります。/)).toBeInTheDocument()
    expect(h.save).not.toHaveBeenCalled()

    const confirm = within(dialog).getByRole('button', { name: ADOPT })
    await user.dblClick(confirm)
    expect(await screen.findByText('Plan destination: plan.adopted.saved')).toBeInTheDocument()
    expect(h.save).toHaveBeenCalledOnce()
    expect(h.save.mock.calls[0]![0]).toBe(source)
    expect(view.router.state.location.pathname).toBe('/plans/plan.adopted.saved')
    expect(h.savePlannerResult).not.toHaveBeenCalled()
  })

  it('writes nothing on the dialog cancel and returns the focus to the adoption operation', async () => {
    const user = userEvent.setup()
    const h = harness()
    renderPage(h.deps)
    await calculate(h, user, optimized())
    const adopt = await screen.findByRole('button', { name: ADOPT })
    await user.click(adopt)
    const dialog = await screen.findByRole('dialog', { name: 'この計画を採用しますか？' })
    await user.click(within(dialog).getByRole('button', { name: 'キャンセル' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'この計画を採用しますか？' })).not.toBeInTheDocument())
    expect(h.save).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: PREVIEW_TITLE })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: ADOPT })).toHaveFocus())
  })

  it('says a replacement-free adoption saves the Draft alone', async () => {
    const user = userEvent.setup()
    const h = harness()
    h.inspect.mockImplementation(async (source) => ({ ...inspectionOf(source), replacements: [] }))
    renderPage(h.deps)
    await calculate(h, user, optimized())
    await user.click(await screen.findByRole('button', { name: ADOPT }))
    const dialog = await screen.findByRole('dialog', { name: 'この計画を採用しますか？' })
    expect(within(dialog).getByText('置き換える候補はありません。作成リストは変更せず、生産計画（下書き）だけを保存します。')).toBeInTheDocument()
    expect(within(dialog).getByText('ありません（新しく保存します）')).toBeInTheDocument()
  })

  it.each([
    ['at the inspection', 'inspect'],
    ['at the save', 'save'],
  ] as const)('drops the Preview on a refusal %s, says why, re-reads the page and calculates nothing by itself', async (_label, where) => {
    const user = userEvent.setup()
    const h = harness()
    const refusal = new RepositoryError('planner_state_changed', 'changed after the calculation')
    if (where === 'inspect') h.inspect.mockRejectedValue(refusal)
    else h.save.mockRejectedValue(refusal)
    renderPage(h.deps)
    await calculate(h, user, optimized())
    const readsBefore = h.reads.length
    await user.click(await screen.findByRole('button', { name: ADOPT }))
    if (where === 'save') {
      const dialog = await screen.findByRole('dialog', { name: 'この計画を採用しますか？' })
      await user.click(within(dialog).getByRole('button', { name: ADOPT }))
    }
    const notice = await screen.findByText('試算の後に状態が変わったため、採用できませんでした')
    expect(screen.getByText(/作成リスト・目標武器・所持武器・RNG状態・生産計画のいずれかが変わったため/)).toBeInTheDocument()
    expect(screen.getByText('作成リストと生産計画は変更されていません。')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('heading', { name: PREVIEW_TITLE })).not.toBeInTheDocument())
    expect(screen.queryByRole('dialog', { name: 'この計画を採用しますか？' })).not.toBeInTheDocument()
    await waitFor(() => expect(notice.closest('[role="alert"]')).toHaveFocus())
    // The page re-reads its state; no calculation and no ordinary Planner start by themselves.
    await waitFor(() => expect(vi.mocked(h.deps.refresh).mock.calls.length).toBeGreaterThanOrEqual(2))
    expect(h.optimization.runs).toHaveLength(1)
    expect(h.ordinary.createPlan).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: AUXILIARY })).not.toBeInTheDocument()
    expect(h.reads.length).toBeGreaterThanOrEqual(readsBefore)
    // The recalculation is the user's press.
    await waitFor(() => expect(screen.getByRole('button', { name: 'もう一度計算する' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'もう一度計算する' }))
    await waitFor(() => expect(h.optimization.runs).toHaveLength(2))
    // The page re-read its data without recreating or disposing the plan creation session.
    expect(h.createSession).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['planner_result_invalid', 'この試算は保存できる内容ではなかったため、採用できませんでした'],
    ['transaction_failed', '保存に失敗したため、採用できませんでした'],
    ['draft_plan_conflict', '未開始の生産計画の状態が変わったため、採用できませんでした'],
    ['production_plan_id_conflict', '保存できなかったため、採用できませんでした'],
  ] as const)('tells a %s refusal apart by its typed code', async (code, title) => {
    const user = userEvent.setup()
    const h = harness()
    h.save.mockRejectedValue(new RepositoryError(code, 'refused'))
    renderPage(h.deps)
    await calculate(h, user, optimized())
    await user.click(await screen.findByRole('button', { name: ADOPT }))
    await user.click(within(await screen.findByRole('dialog', { name: 'この計画を採用しますか？' })).getByRole('button', { name: ADOPT }))
    expect(await screen.findByText(title)).toBeInTheDocument()
  })

  it('never opens the dialog for a Preview dropped while it was being inspected', async () => {
    const user = userEvent.setup()
    const h = harness()
    let resolveInspection: (inspection: BuildListOptimizationAdoptionInspection) => void = () => undefined
    h.inspect.mockImplementation((source) => new Promise((resolve) => {
      resolveInspection = () => resolve(inspectionOf(source))
    }))
    renderPage(h.deps)
    await calculate(h, user, optimized())
    await user.click(await screen.findByRole('button', { name: ADOPT }))
    expect(await screen.findByText('この試算を採用できるか確認しています…')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '戻る' }))
    await act(async () => {
      resolveInspection(inspectionOf({ artifact: fixture.artifact, startSnapshot: { observedDraftPlanId: null, runningPlanAbsent: true } }))
    })
    expect(screen.queryByRole('dialog', { name: 'この計画を採用しますか？' })).not.toBeInTheDocument()
    expect(h.save).not.toHaveBeenCalled()
  })

  it('never opens the dialog of an earlier run after a new run started', async () => {
    const user = userEvent.setup()
    const h = harness()
    let resolveInspection: () => void = () => undefined
    h.inspect.mockImplementationOnce((source) => new Promise((resolve) => {
      resolveInspection = () => resolve(inspectionOf(source))
    }))
    renderPage(h.deps)
    await calculate(h, user, optimized())
    await user.click(await screen.findByRole('button', { name: ADOPT }))
    await screen.findByText('この試算を採用できるか確認しています…')
    // The adoption check holds the screen: no new press starts until it ends.
    expect(screen.getByRole('button', { name: CREATE })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '戻る' }))
    await pressCreate(user)
    await waitFor(() => expect(h.optimization.runs).toHaveLength(2))
    await act(async () => {
      resolveInspection()
    })
    expect(screen.queryByRole('dialog', { name: 'この計画を採用しますか？' })).not.toBeInTheDocument()
  })
})
