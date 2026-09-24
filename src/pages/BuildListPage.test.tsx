import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider, useParams } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import {
  createBuildListEntry,
  createTargetDefinitionHash,
  defaultIntermediateStateSelection,
} from '../domain/buildList'
import { createSearchStateHash } from '../domain/models/hashing'
import type { BuildListEntryStaleReason, IntermediateStateSelection } from '../domain/models/publicTypes'
import {
  buildListEntryId,
  candidateId,
  createValidBuildCandidate,
  createValidBuildListEntry,
  createValidNormalArtianCounter,
  createValidProductionPlan,
  createValidRngState,
  createValidTargetWeapon,
  productionPlanId,
} from '../test/fixtures/domainData'
import { createValidMasterDataFixture } from '../test/fixtures/masterData'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../domain/rng/production/productionRngEngine'
import {
  defaultPlannerOptions,
  defaultPlannerOrchestrationBounds,
  type PlannerInput,
  type PlannerOrchestrationResult,
} from '../domain/planner'
import {
  completedPlannerTermination,
  exhaustedPlannerTermination,
  incompletePlannerTermination,
} from '../test/fixtures/plannerTermination'
import { createBuildListCalculationContext } from '../services/buildList/createBuildListCalculationContext'
import type { PlannerWorkerClient } from '../services/planner/plannerWorkerClient'
import {
  CHECKPOINT_IDEAL_SKILL,
  CHECKPOINT_PRACTICAL_SKILL,
  checkpointAlternativeBonuses,
  checkpointCandidate,
  checkpointIdealBonuses,
  checkpointMixedCandidate,
  checkpointPracticalBonuses,
  checkpointSource,
  checkpointStrongerPracticalBonuses,
  checkpointTarget,
  intermediateOpportunityAt,
} from '../test/fixtures/checkpointRoute'

const BONUS_ONE = 'この途中状態を採用する: 復元ボーナス操作1回目（再抽選）の直後'
const SKILL_ONE = 'この途中状態を採用する: スキルリセット1回目の直後'
import { BuildListPage, type BuildListPageDependencies } from './BuildListPage'
import type { ProductionPlanReplanDependencies } from '../services/execution/productionPlanReplanDependencies'

/** No Plan runs in these fixtures, so the replan runtime is never reached. */
function unusedReplanDependencies(): ProductionPlanReplanDependencies {
  const notExpected = () => Promise.reject(new Error('replan is not expected in this test'))
  return {
    prepareProductionPlanReplanPreview: vi.fn(notExpected),
    createProductionPlanReplanPreview: vi.fn(() => { throw new Error('replan is not expected in this test') }),
    inspectProductionPlanReplanAdoption: vi.fn(notExpected),
    adoptProductionPlanReplanPreview: vi.fn(notExpected),
  }
}

function createOrchestrationResult(
  overrides: Partial<PlannerOrchestrationResult> = {},
): PlannerOrchestrationResult {
  return {
    plan: createValidProductionPlan(),
    conflicts: [],
    warnings: [],
    termination: completedPlannerTermination(),
    generatedBuildListEntries: [],
    generatedBuildListEntryReplacements: [],
    ...overrides,
  }
}

function createPlannerClient(
  result: PlannerOrchestrationResult = createOrchestrationResult(),
): PlannerWorkerClient {
  return {
    engineVersion: PRODUCTION_RNG_ENGINE_VERSION,
    createPlan: vi.fn(async () => ({
      plan: createValidProductionPlan(),
      conflicts: [],
      warnings: [],
      termination: completedPlannerTermination(),
    })),
    // B8-D2b: the page uses the constrained API only.
    createConstrainedPlan: vi.fn(async () => result),
    createWhatIfComparison: vi.fn(),
    prepareInteraction: vi.fn(),
    cancelPlan: vi.fn(),
    dispose: vi.fn(),
  }
}

function dependencies(
  staleReasons: BuildListEntryStaleReason[] = [],
  client: PlannerWorkerClient = createPlannerClient(),
): BuildListPageDependencies {
  const target = createValidTargetWeapon()
  const candidate = createValidBuildCandidate()
  candidate.searchStateHash = createSearchStateHash(candidate.route, createValidRngState(), [createValidNormalArtianCounter()])
  const entry = createBuildListEntry(candidate, target, { id: buildListEntryId('build-list.ui'), createdAt: '2026-08-29T03:00:00.000Z' })
  entry.targetDefinitionHash = createTargetDefinitionHash(target)
  entry.isStale = staleReasons.length > 0
  entry.staleReasons = staleReasons
  return {
    master: createValidMasterDataFixture(),
    createWorkerClient: () => client,
    refresh: vi.fn(async () => ({ entries: [entry], targets: [target], ownedWeapons: [] })),
    createInput: vi.fn(async (calculationContext): Promise<PlannerInput> => ({
      rngState: createValidRngState(),
      normalCounters: [createValidNormalArtianCounter()],
      ownedWeapons: [],
      targetWeapons: [target],
      buildListEntries: [createValidBuildListEntry()],
      calculationContext,
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
    })),
    savePlannerResult: vi.fn(async () => createValidProductionPlan()),
    updateIntermediateStateSelection: vi.fn(async () => { throw new Error('not used in this fixture') }),
    inspectIntermediateStateSelectionUpdate: vi.fn(async () => ({ approvalRequired: false as const })),
    deleteEntry: vi.fn(async () => undefined),
    inspectEntryDelete: vi.fn(async () => ({ approvalRequired: false as const })),
    getRunningProductionPlan: vi.fn(async () => undefined),
    getDraftProductionPlan: vi.fn(async () => undefined),
    replan: unusedReplanDependencies(),
  }
}

/**
 * The page navigates on a successful save, so every render needs a router and
 * a destination that proves which Plan id was used.
 */
function renderPage(deps: BuildListPageDependencies) {
  const router = createMemoryRouter([
    { path: '/build-list', element: <BuildListPage dependencies={deps} /> },
    {
      path: '/plans/:planId',
      element: <PlanDestination />,
    },
  ], { initialEntries: ['/build-list'] })
  return { router, ...render(<RouterProvider router={router} />) }
}

function PlanDestination() {
  const { planId } = useParams()
  return <div>Plan destination: {planId}</div>
}

describe('BuildListPage', () => {
  it('uses the Production RNG version as the current staleness authority', () => {
    expect(createBuildListCalculationContext(createValidMasterDataFixture()).rngEngineVersion)
      .toBe(PRODUCTION_RNG_ENGINE_VERSION)
  })

  it('plans through the constrained Planner path with the Production orchestration bounds', async () => {
    const user = userEvent.setup()
    const client = createPlannerClient()
    const deps = dependencies([], client)
    renderPage(deps)
    await user.click(await screen.findByRole('button', { name: '生産計画を作成' }))
    await screen.findByText(/^Plan destination:/)

    expect(deps.refresh).toHaveBeenCalledWith(expect.objectContaining({
      rngEngineVersion: PRODUCTION_RNG_ENGINE_VERSION,
    }))
    expect(deps.createInput).toHaveBeenCalledWith(expect.objectContaining({
      rngEngineVersion: client.engineVersion,
    }))
    expect(client.createConstrainedPlan).toHaveBeenCalledOnce()
    // The ordinary Planner API is no longer part of this page's path.
    expect(client.createPlan).not.toHaveBeenCalled()

    const [requestId, input, bounds] = vi.mocked(client.createConstrainedPlan).mock.calls[0]
    expect(typeof requestId).toBe('string')
    // Everything but `options` comes straight from `createInput`; `options`
    // is the Application caller's own decision (PLANNER_SPEC 7.2.1).
    const createdInput = await vi.mocked(deps.createInput).mock.results[0].value
    expect(input).toEqual({ ...createdInput, options: { ...defaultPlannerOptions } })
    // The caller passes the Production authority itself, not a local copy of
    // its values: the Worker Client applies no default of its own.
    expect(bounds).toBe(defaultPlannerOrchestrationBounds)
  })

  it('passes the B8-E2b Production orchestration bounds 2 / 1 / 4', async () => {
    const user = userEvent.setup()
    const client = createPlannerClient()
    renderPage(dependencies([], client))
    await user.click(await screen.findByRole('button', { name: '生産計画を作成' }))
    await screen.findByText(/^Plan destination:/)

    expect(vi.mocked(client.createConstrainedPlan).mock.calls[0][2]).toEqual({
      maxCandidateTrialsPerConflict: 2,
      maxGeneratedBuildListEntries: 1,
      maxPlannerReruns: 4,
    })
  })

  it('hands the whole PlannerOrchestrationResult to the atomic Persistence boundary', async () => {
    const user = userEvent.setup()
    const generatedEntry = createValidBuildListEntry()
    const result = createOrchestrationResult({
      generatedBuildListEntries: [generatedEntry],
      generatedBuildListEntryReplacements: [],
    })
    const client = createPlannerClient(result)
    const deps = dependencies([], client)
    renderPage(deps)
    await user.click(await screen.findByRole('button', { name: '生産計画を作成' }))
    await screen.findByText(/^Plan destination:/)

    // The complete result, never only its Plan: the generated Entries and the
    // ProductionPlan must reach the same transaction (PLANNER_SPEC 9.2.15).
    expect(deps.savePlannerResult).toHaveBeenCalledOnce()
    const [savedResult] = vi.mocked(deps.savePlannerResult).mock.calls[0]
    expect(savedResult).toBe(result)
    expect(savedResult.generatedBuildListEntries).toEqual([generatedEntry])
    expect(savedResult.plan).toEqual(result.plan)
    expect(savedResult.conflicts).toEqual(result.conflicts)
    expect(savedResult.warnings).toEqual(result.warnings)
  })

  it('rebuilds the CalculationContext at save time instead of reusing the Planner-start one', async () => {
    const user = userEvent.setup()
    const client = createPlannerClient()
    const deps = dependencies([], client)
    renderPage(deps)
    await user.click(await screen.findByRole('button', { name: '生産計画を作成' }))
    await screen.findByText(/^Plan destination:/)

    const [plannerStartContext] = vi.mocked(deps.createInput).mock.calls[0]
    const [, saveContext] = vi.mocked(deps.savePlannerResult).mock.calls[0]
    expect(saveContext).toEqual(plannerStartContext)
    expect(saveContext).not.toBe(plannerStartContext)
    expect(saveContext).not.toBe(
      (await vi.mocked(deps.createInput).mock.results[0].value).calculationContext,
    )
  })

  it('passes a Plan-less result to Persistence and reports that no Plan was created', async () => {
    const user = userEvent.setup()
    const client = createPlannerClient(
      createOrchestrationResult({
        plan: null,
        termination: exhaustedPlannerTermination(),
        generatedBuildListEntries: [],
        generatedBuildListEntryReplacements: [],
      }),
    )
    const deps = dependencies([], client)
    deps.savePlannerResult = vi.fn(async () => null)
    renderPage(deps)
    await user.click(await screen.findByRole('button', { name: '生産計画を作成' }))

    expect(await screen.findByText('現在の入力から作成できる生産計画はありませんでした。')).toBeInTheDocument()
    // `plan === null` still reaches the service: only it may judge whether a
    // no-Plan result carrying generated Entries is an invariant violation.
    expect(deps.savePlannerResult).toHaveBeenCalledOnce()
    expect(vi.mocked(deps.savePlannerResult).mock.calls[0][0]).toEqual(
      expect.objectContaining({ plan: null, generatedBuildListEntries: [] }),
    )
  })

  it('treats Persistence, not the Worker result, as the success authority', async () => {
    const user = userEvent.setup()
    const client = createPlannerClient()
    const deps = dependencies([], client)
    deps.savePlannerResult = vi.fn(async () => {
      throw new Error('生産計画を保存できませんでした。')
    })
    renderPage(deps)
    await user.click(await screen.findByRole('button', { name: '生産計画を作成' }))

    expect(await screen.findByText('生産計画を保存できませんでした。')).toBeInTheDocument()
    // The Worker returned a Plan, but nothing was stored, so nothing to open.
    expect(screen.queryByText(/^Plan destination:/)).not.toBeInTheDocument()
  })

  it('reports the stored Plan id rather than the calculated one', async () => {
    const user = userEvent.setup()
    const client = createPlannerClient()
    const deps = dependencies([], client)
    const storedPlan = { ...createValidProductionPlan(), id: productionPlanId('plan.b8d2b.stored') }
    deps.savePlannerResult = vi.fn(async () => storedPlan)
    renderPage(deps)
    await user.click(await screen.findByRole('button', { name: '生産計画を作成' }))

    expect(await screen.findByText(`Plan destination: ${storedPlan.id}`)).toBeInTheDocument()
  })

  it('navigates to the exact saved Plan, not the calculated one', async () => {
    const user = userEvent.setup()
    const calculated = {
      ...createValidProductionPlan(),
      id: productionPlanId('plan.worker.calculated'),
    }
    const stored = {
      ...createValidProductionPlan(),
      id: productionPlanId('plan.persistence.stored'),
    }
    const deps = dependencies([], createPlannerClient(
      createOrchestrationResult({ plan: calculated }),
    ))
    deps.savePlannerResult = vi.fn(async () => stored)
    const view = renderPage(deps)
    await user.click(await screen.findByRole('button', { name: '生産計画を作成' }))

    expect(await screen.findByText(`Plan destination: ${stored.id}`)).toBeInTheDocument()
    // Persistence is the authority: never the Worker result's Plan id, an
    // Active Plan, a latest Plan, or a pre-generated id.
    expect(view.router.state.location.pathname).toBe(`/plans/${stored.id}`)
    expect(view.router.state.location.pathname).not.toContain(calculated.id)
  })

  it('stays on the Build List with the no-Plan notice when nothing was stored', async () => {
    const user = userEvent.setup()
    const deps = dependencies([], createPlannerClient(
      createOrchestrationResult({
        plan: null,
        termination: exhaustedPlannerTermination(),
        generatedBuildListEntries: [],
        generatedBuildListEntryReplacements: [],
      }),
    ))
    deps.savePlannerResult = vi.fn(async () => null)
    const view = renderPage(deps)
    await user.click(await screen.findByRole('button', { name: '生産計画を作成' }))

    expect(await screen.findByText('現在の入力から作成できる生産計画はありませんでした。'))
      .toBeInTheDocument()
    expect(view.router.state.location.pathname).toBe('/build-list')
  })

  it('does not navigate when the save fails', async () => {
    const user = userEvent.setup()
    const deps = dependencies()
    deps.savePlannerResult = vi.fn(async () => {
      throw new Error('生産計画を保存できませんでした。')
    })
    const view = renderPage(deps)
    await user.click(await screen.findByRole('button', { name: '生産計画を作成' }))

    expect(await screen.findByText('生産計画を保存できませんでした。')).toBeInTheDocument()
    expect(view.router.state.location.pathname).toBe('/build-list')
  })

  it('does not navigate after the planning request was cancelled', async () => {
    const user = userEvent.setup()
    let releaseSave: () => void = () => undefined
    const savePending = new Promise<void>((resolve) => {
      releaseSave = resolve
    })
    const deps = dependencies()
    deps.savePlannerResult = vi.fn(async () => {
      await savePending
      return createValidProductionPlan()
    })
    const view = renderPage(deps)
    await user.click(await screen.findByRole('button', { name: '生産計画を作成' }))
    await user.click(await screen.findByRole('button', { name: 'キャンセル' }))

    releaseSave()
    await screen.findByText('生産計画の作成をキャンセルしました。')
    expect(view.router.state.location.pathname).toBe('/build-list')
    expect(screen.queryByText(/^Plan destination:/)).not.toBeInTheDocument()
  })

  it('renders from Candidate Snapshot and shows stale reasons', async () => {
    renderPage(dependencies(['rng_state_changed']))
    expect(await screen.findByText('Domain fixture target')).toBeInTheDocument()
    expect(screen.getByText('再検索が必要')).toBeInTheDocument()
    expect(screen.getByText('RNG状態が検索時から変更されています')).toBeInTheDocument()
  })

  it('removes only the Build List entry', async () => {
    const user = userEvent.setup()
    const deps = dependencies()
    renderPage(deps)
    await user.click(await screen.findByRole('button', { name: 'ビルドリストから削除' }))
    expect(deps.deleteEntry).toHaveBeenCalledOnce()
    expect(screen.queryByText('Domain fixture target')).not.toBeInTheDocument()
  })

  it('starts the detail settings at defaultPlannerOptions and sends them unchanged', async () => {
    const user = userEvent.setup()
    const client = createPlannerClient()
    renderPage(dependencies([], client))
    await user.click(await screen.findByRole('button', { name: '詳細設定' }))

    expect(await screen.findByLabelText('最大計画ステップ数')).toHaveValue(300)
    expect(screen.getByLabelText('Beam幅')).toHaveValue(50)
    expect(screen.getByLabelText('最大探索状態数')).toHaveValue(10000)

    await user.click(screen.getByRole('button', { name: '生産計画を作成' }))
    await screen.findByText(/^Plan destination:/)
    expect(vi.mocked(client.createConstrainedPlan).mock.calls[0][1].options).toEqual({
      maxPlanSteps: 300,
      beamWidth: 50,
      maxExpandedStates: 10_000,
    })
  })

  it('sends the user-selected bounds as PlannerInput.options', async () => {
    const user = userEvent.setup()
    const client = createPlannerClient()
    renderPage(dependencies([], client))
    await user.click(await screen.findByRole('button', { name: '詳細設定' }))
    await user.clear(await screen.findByLabelText('最大計画ステップ数'))
    await user.type(screen.getByLabelText('最大計画ステップ数'), '400')
    await user.clear(screen.getByLabelText('Beam幅'))
    await user.type(screen.getByLabelText('Beam幅'), '60')
    await user.clear(screen.getByLabelText('最大探索状態数'))
    await user.type(screen.getByLabelText('最大探索状態数'), '20000')

    await user.click(screen.getByRole('button', { name: '生産計画を作成' }))
    await screen.findByText(/^Plan destination:/)

    // `PlannerInput.options` is the single Beam Search bound authority, so the
    // reviewed values reach the Worker exactly (PLANNER_SPEC 7.2.1).
    expect(vi.mocked(client.createConstrainedPlan).mock.calls[0][1].options).toEqual({
      maxPlanSteps: 400,
      beamWidth: 60,
      maxExpandedStates: 20_000,
    })
  })

  it('shows the selected maxExpandedStates as the live progress denominator', async () => {
    const user = userEvent.setup()
    let releasePlan: (result: PlannerOrchestrationResult) => void = () => undefined
    const client = createPlannerClient()
    client.createConstrainedPlan = vi.fn(
      () => new Promise<PlannerOrchestrationResult>((resolve) => {
        releasePlan = resolve
      }),
    )
    renderPage(dependencies([], client))
    await user.click(await screen.findByRole('button', { name: '詳細設定' }))
    await user.clear(await screen.findByLabelText('最大探索状態数'))
    await user.type(screen.getByLabelText('最大探索状態数'), '20000')
    await user.click(screen.getByRole('button', { name: '生産計画を作成' }))

    expect(await screen.findByText('計画中 0 / 20000')).toBeInTheDocument()
    releasePlan(createOrchestrationResult())
  })

  it('restores defaultPlannerOptions with the reset control', async () => {
    const user = userEvent.setup()
    renderPage(dependencies())
    await user.click(await screen.findByRole('button', { name: '詳細設定' }))
    await user.clear(await screen.findByLabelText('最大探索状態数'))
    await user.type(screen.getByLabelText('最大探索状態数'), '99')
    expect(screen.getByLabelText('最大探索状態数')).toHaveValue(99)

    await user.click(screen.getByRole('button', { name: '既定値に戻す' }))
    expect(screen.getByLabelText('最大計画ステップ数')).toHaveValue(defaultPlannerOptions.maxPlanSteps)
    expect(screen.getByLabelText('Beam幅')).toHaveValue(defaultPlannerOptions.beamWidth)
    expect(screen.getByLabelText('最大探索状態数')).toHaveValue(defaultPlannerOptions.maxExpandedStates)
  })

  it.each([
    ['zero', '0'],
    ['a negative number', '-5'],
    ['a fraction', '1.5'],
    ['an empty field', ''],
  ])('never sends %s to the Planner', async (_label, raw) => {
    const user = userEvent.setup()
    const client = createPlannerClient()
    renderPage(dependencies([], client))
    await user.click(await screen.findByRole('button', { name: '詳細設定' }))
    await user.clear(await screen.findByLabelText('最大探索状態数'))
    if (raw !== '') await user.type(screen.getByLabelText('最大探索状態数'), raw)

    expect(await screen.findByText('1以上の整数を入力してください。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '生産計画を作成' })).toBeDisabled()
    expect(client.createConstrainedPlan).not.toHaveBeenCalled()
  })

  it('reports an incomplete search that reached maxExpandedStates and saves nothing', async () => {
    const user = userEvent.setup()
    const deps = dependencies([], createPlannerClient(createOrchestrationResult({
      termination: incompletePlannerTermination(['max_expanded_states'], {
        expandedStates: 10_000,
        completedTargetCount: 1,
        totalTargetCount: 2,
      }),
    })))
    const view = renderPage(deps)
    await user.click(await screen.findByRole('button', { name: '生産計画を作成' }))

    expect(await screen.findByText('生産計画の探索が完了していません')).toBeInTheDocument()
    expect(screen.getByText(/最大探索状態数 10,000 に到達しました。/)).toBeInTheDocument()
    expect(screen.getByText('探索状態数: 10,000 / 10,000')).toBeInTheDocument()
    expect(screen.getByText('完成した目標武器: 1 / 2')).toBeInTheDocument()

    // A truncated search never becomes an executable Draft, and never opens.
    expect(deps.savePlannerResult).not.toHaveBeenCalled()
    expect(view.router.state.location.pathname).toBe('/build-list')
    expect(screen.queryByText(/^Plan destination:/)).not.toBeInTheDocument()
  })

  it('reports an incomplete search that reached maxPlanSteps', async () => {
    const user = userEvent.setup()
    const deps = dependencies([], createPlannerClient(createOrchestrationResult({
      termination: incompletePlannerTermination(['max_plan_steps']),
    })))
    renderPage(deps)
    await user.click(await screen.findByRole('button', { name: '生産計画を作成' }))

    expect(await screen.findByText('生産計画の探索が完了していません')).toBeInTheDocument()
    expect(screen.getByText(/最大計画ステップ数 300 に到達しました。/)).toBeInTheDocument()
    expect(deps.savePlannerResult).not.toHaveBeenCalled()
  })

  it('reports both bounds when one search reached both', async () => {
    const user = userEvent.setup()
    renderPage(dependencies([], createPlannerClient(createOrchestrationResult({
      termination: incompletePlannerTermination([
        'max_expanded_states',
        'max_plan_steps',
      ]),
    }))))
    await user.click(await screen.findByRole('button', { name: '生産計画を作成' }))

    expect(await screen.findByText(/最大探索状態数 10,000 に到達しました。/)).toBeInTheDocument()
    expect(screen.getByText(/最大計画ステップ数 300 に到達しました。/)).toBeInTheDocument()
  })

  it('still saves a completed search that happened to touch a bound', async () => {
    const user = userEvent.setup()
    // The last affordable expansion was the one that completed the search, so
    // the diagnostic warning and `reachedLimits` do not contradict `completed`.
    const deps = dependencies([], createPlannerClient(createOrchestrationResult({
      warnings: [{
        kind: 'max_expanded_states_reached',
        message: 'Planner reached maxExpandedStates (10000).',
      }],
      termination: completedPlannerTermination({
        reachedLimits: ['max_expanded_states'],
        expandedStates: 10_000,
        completedTargetCount: 2,
        totalTargetCount: 2,
      }),
    })))
    renderPage(deps)
    await user.click(await screen.findByRole('button', { name: '生産計画を作成' }))

    await screen.findByText(/^Plan destination:/)
    expect(deps.savePlannerResult).toHaveBeenCalledOnce()
    expect(screen.queryByText('生産計画の探索が完了していません')).not.toBeInTheDocument()
  })

  it('shows an empty state', async () => {
    const deps = dependencies()
    deps.refresh = vi.fn(async () => ({ entries: [], targets: [], ownedWeapons: [] }))
    renderPage(deps)
    expect(await screen.findByText('ビルドリストは空です。検索結果から候補を追加してください。')).toBeInTheDocument()
  })

  it('keeps both lanes selected when two changes overlap in flight', async () => {
    const user = userEvent.setup()
    // One Practical state on each lane of one Route.
    const { candidate, source } = checkpointMixedCandidate({
      bonusResults: [checkpointPracticalBonuses(), checkpointIdealBonuses()],
      skillResults: [CHECKPOINT_PRACTICAL_SKILL, CHECKPOINT_IDEAL_SKILL],
    })
    const target = checkpointTarget()
    let entry = createBuildListEntry(candidate, target, {
      id: buildListEntryId('build-list.checkpoint.race'),
      createdAt: '2026-09-12T00:00:00.000Z',
    })
    const releases: Array<() => void> = []
    const deps: BuildListPageDependencies = {
      ...dependencies(),
      refresh: vi.fn(async () => ({ entries: [entry], targets: [target], ownedWeapons: [source] })),
      // Every save waits until the test releases it, in call order.
      updateIntermediateStateSelection: vi.fn(async (_id, selection) => {
        await new Promise<void>((resolve) => releases.push(resolve))
        entry = { ...entry, intermediateStateSelection: { ...selection } }
        return entry
      }),
    }
    renderPage(deps)
    const bonus = await screen.findByRole('checkbox', { name: BONUS_ONE })
    const skill = screen.getByRole('checkbox', { name: SKILL_ONE })

    // The second change starts while the first save is still pending.
    await user.click(bonus)
    await user.click(skill)
    expect(releases).toHaveLength(1)
    releases[0]()
    await waitFor(() => expect(releases).toHaveLength(2))
    releases[1]()

    await waitFor(() => expect(deps.updateIntermediateStateSelection).toHaveBeenCalledTimes(2))
    const bonusId = intermediateOpportunityAt(candidate, 'bonus', 1).opportunity.id
    const skillId = intermediateOpportunityAt(candidate, 'skill', 1).opportunity.id
    const calls = vi.mocked(deps.updateIntermediateStateSelection).mock.calls
    expect(calls[0][1]).toEqual({ ...defaultIntermediateStateSelection(), bonusOpportunityId: bonusId })
    // The second save starts from the first save's result, so the first
    // selection survives: the two lanes are selected together.
    expect(calls[1][1]).toEqual({
      ...defaultIntermediateStateSelection(),
      bonusOpportunityId: bonusId,
      skillOpportunityId: skillId,
    })
    await waitFor(() => expect(bonus).toBeChecked())
    expect(skill).toBeChecked()
  })
})

describe('BuildListPage presentation', () => {
  it('lays the page out as summary, Planner panel and Target groups with a sequential outline', async () => {
    renderPage(dependencies())
    expect(await screen.findByRole('heading', { level: 1, name: 'ビルドリスト' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'ページ概要' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: '生産計画の作成' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: '候補一覧' })).toBeInTheDocument()
    // The Target group heads its Entries; the Candidate card sits one level below it.
    expect(screen.getByRole('heading', { level: 3, name: 'Domain fixture target' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 4, name: '理想候補' })).toBeInTheDocument()
    expect(screen.getByText('優先度 3')).toBeInTheDocument()
    expect(screen.getByText('候補 1件')).toBeInTheDocument()
    // The primary CTA is an ordinary button in the flow, never fixed or sticky.
    expect(screen.getByRole('button', { name: '生産計画を作成' })).toBeEnabled()
  })

  it('summarizes the loaded Entries for display only', async () => {
    renderPage(dependencies(['rng_state_changed']))
    const summary = await screen.findByRole('region', { name: 'ページ概要' })
    const tiles = within(summary).getAllByRole('listitem')
    expect(tiles.map((tile) => within(tile).getByRole('heading', { level: 3 }).textContent)).toEqual([
      '登録候補',
      '目標武器',
      '再検索が必要な候補',
      '途中採用状態を選択中',
    ])
    expect(tiles.map((tile) => tile.querySelector('p')?.textContent)).toEqual(['1', '1', '1', '0'])
  })

  it('gives the detail settings a real heading and a wired disclosure', async () => {
    renderPage(dependencies())
    const toggle = await screen.findByRole('button', { name: '詳細設定' })
    const heading = screen.getByRole('heading', { level: 3, name: '詳細設定' })
    expect(heading).toContainElement(toggle)
    expect(within(toggle).queryByRole('heading')).not.toBeInTheDocument()
    const contentId = toggle.getAttribute('aria-controls')
    expect(contentId).toBeTruthy()
    const region = document.getElementById(contentId ?? '')
    expect(region).not.toBeNull()
    expect(region).toHaveAttribute('aria-labelledby', toggle.id)
  })

  it('groups several Entries of one Target under a single Target heading', async () => {
    const target = createValidTargetWeapon()
    const first = createValidBuildCandidate()
    const second = { ...createValidBuildCandidate(), id: candidateId('candidate.fixture.second') }
    const entries = [
      createBuildListEntry(first, target, { id: buildListEntryId('build-list.group.a'), createdAt: '2026-09-01T00:00:00.000Z' }),
      createBuildListEntry(second, target, { id: buildListEntryId('build-list.group.b'), createdAt: '2026-09-02T00:00:00.000Z' }),
    ]
    const deps = dependencies()
    deps.refresh = vi.fn(async () => ({ entries, targets: [target], ownedWeapons: [] }))
    renderPage(deps)

    const group = await screen.findByRole('region', { name: 'Domain fixture target' })
    expect(screen.getAllByRole('heading', { level: 3, name: 'Domain fixture target' })).toHaveLength(1)
    expect(within(group).getByText('候補 2件')).toBeInTheDocument()
    expect(within(group).getAllByRole('heading', { level: 4, name: '理想候補' })).toHaveLength(2)
    expect(within(group).getAllByRole('button', { name: 'ビルドリストから削除' })).toHaveLength(2)
    // Persisted order inside the group is kept.
    expect(within(group).getAllByText(/^追加日時: /).map((node) => node.textContent)).toEqual([
      '追加日時: 2026-09-01T00:00:00.000Z',
      '追加日時: 2026-09-02T00:00:00.000Z',
    ])
  })

  describe('legacy duplicate guidance (docs/DATA_MODEL.md 9.4.1)', () => {
    const DUPLICATE_TITLE = '候補が複数登録されています'
    const DUPLICATE_LINE =
      'この目標武器には作成リストの候補が複数登録されています。生産計画の作成と再計画の試算には、使用する候補を1件にする必要があります。'

    function duplicateFixture(staleSecond: boolean) {
      const target = createValidTargetWeapon()
      const other = { ...createValidTargetWeapon(), id: 'target.fixture.other' as typeof target.id, name: 'Other fixture target' }
      const a1 = createBuildListEntry(createValidBuildCandidate(), target, {
        id: buildListEntryId('build-list.dup.a1'),
        createdAt: '2026-09-01T00:00:00.000Z',
      })
      const a2 = createBuildListEntry(
        { ...createValidBuildCandidate(), id: candidateId('candidate.fixture.dup.second') },
        target,
        { id: buildListEntryId('build-list.dup.a2'), createdAt: '2026-09-02T00:00:00.000Z' },
      )
      if (staleSecond) {
        a2.isStale = true
        a2.staleReasons = ['rng_state_changed']
      }
      const b1 = createBuildListEntry(
        { ...createValidBuildCandidate(), id: candidateId('candidate.fixture.other'), targetWeaponId: other.id },
        other,
        { id: buildListEntryId('build-list.other.b1'), createdAt: '2026-09-03T00:00:00.000Z' },
      )
      const deps = dependencies()
      deps.refresh = vi.fn(async () => ({ entries: [a1, a2, b1], targets: [target, other], ownedWeapons: [] }))
      return { deps, a1, a2 }
    }

    it.each([
      ['two current Entries', false],
      ['a stale and a current Entry', true],
    ])('marks the Target holding %s, recommends neither, and clears the guidance once one is left', async (_label, staleSecond) => {
      const user = userEvent.setup()
      const { deps, a1 } = duplicateFixture(staleSecond)
      renderPage(deps)

      const group = await screen.findByRole('region', { name: /Domain fixture target/ })
      expect(within(group).getByText('要整理')).toBeInTheDocument()
      expect(within(group).getByText(DUPLICATE_TITLE)).toBeInTheDocument()
      expect(within(group).getByText(DUPLICATE_LINE)).toBeInTheDocument()
      // Both Entries stay listed and deletable; nothing is picked for the user.
      expect(within(group).getAllByRole('heading', { level: 4, name: '理想候補' })).toHaveLength(2)
      expect(within(group).getAllByRole('button', { name: 'ビルドリストから削除' })).toHaveLength(2)
      expect(within(group).queryByText(/おすすめ|推奨/)).toBeNull()
      // A Target with one Entry carries no guidance.
      const otherGroup = screen.getByRole('region', { name: /Other fixture target/ })
      expect(within(otherGroup).queryByText('要整理')).toBeNull()
      expect(within(otherGroup).queryByText(DUPLICATE_TITLE)).toBeNull()

      // The ordinary guarded delete tidies it.
      await user.click(within(group).getAllByRole('button', { name: 'ビルドリストから削除' })[0]!)
      expect(deps.inspectEntryDelete).toHaveBeenCalledWith(a1.id)
      expect(deps.deleteEntry).toHaveBeenCalledWith(a1.id, null)
      await waitFor(() => expect(within(group).queryByText(DUPLICATE_TITLE)).toBeNull())
      expect(within(group).queryByText('要整理')).toBeNull()
      expect(within(group).getAllByRole('heading', { level: 4, name: '理想候補' })).toHaveLength(1)
      expect(within(group).getByText('候補 1件')).toBeInTheDocument()
    })
  })

  it('shows a load failure as an error, not as an empty Build List', async () => {
    const deps = dependencies()
    deps.refresh = vi.fn(async () => {
      throw new Error('ビルドリストを読み込めませんでした。')
    })
    renderPage(deps)
    expect(await screen.findByText('ビルドリストを読み込めませんでした。')).toBeInTheDocument()
    expect(screen.queryByText('ビルドリストは空です。検索結果から候補を追加してください。')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '生産計画を作成' })).not.toBeInTheDocument()
  })

  it('keeps the Candidate Snapshot of a stale Entry readable and marks the Target group', async () => {
    renderPage(dependencies(['owned_weapon_changed']))
    expect(await screen.findByText('参照している所持武器が変更されています')).toBeInTheDocument()
    expect(screen.getByText('再検索が必要 1件')).toBeInTheDocument()
    // The stored Candidate stays visible below the warning.
    expect(screen.getByRole('heading', { level: 4, name: '理想候補' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '候補詳細・作成ルート' })).toBeInTheDocument()
  })

  it('explains intermediate states in Build List terms and reflects the persisted selection', async () => {
    const user = userEvent.setup()
    const candidate = checkpointCandidate([
      checkpointPracticalBonuses(),
      checkpointIdealBonuses(),
    ])
    const target = checkpointTarget()
    const selected = intermediateOpportunityAt(candidate, 'bonus', 1).opportunity.id
    let entry = createBuildListEntry(candidate, target, {
      id: buildListEntryId('build-list.checkpoint.persisted'),
      createdAt: '2026-09-12T00:00:00.000Z',
      intermediateStateSelection: { ...defaultIntermediateStateSelection(), bonusOpportunityId: selected },
    })
    const deps: BuildListPageDependencies = {
      ...dependencies(),
      refresh: vi.fn(async () => ({ entries: [entry], targets: [target], ownedWeapons: [checkpointSource()] })),
      updateIntermediateStateSelection: vi.fn(async (_id, next) => {
        entry = { ...entry, intermediateStateSelection: { ...next } }
        return entry
      }),
    }
    renderPage(deps)

    const checkbox = await screen.findByRole('checkbox', { name: BONUS_ONE })
    expect(checkbox).toBeChecked()
    expect(screen.getByText('途中採用状態を選択中 1')).toBeInTheDocument()
    expect(screen.getByText(
      '選択中の途中採用状態は、この候補を作成する途中で必ず経由する条件としてPlannerに渡されます。変更すると既存の生産計画は再計算が必要です。スキル側・復元ボーナス側それぞれ1つまで選べます。',
    )).toBeInTheDocument()
    expect(screen.queryByText(/作成リストへ登録され/)).not.toBeInTheDocument()

    await user.click(checkbox)
    expect(deps.updateIntermediateStateSelection).toHaveBeenCalledWith(entry.id, defaultIntermediateStateSelection(), null)
    expect(await screen.findByText('途中採用する状態と改善優先を更新しました。生産計画を再作成してください。')).toBeInTheDocument()
    expect(screen.getByText('途中採用状態は未選択')).toBeInTheDocument()

    // The preference is edited here too, without re-searching.
    await user.click(screen.getByRole('radio', { name: '復元ボーナスを優先' }))
    expect(deps.updateIntermediateStateSelection).toHaveBeenLastCalledWith(entry.id, {
      ...defaultIntermediateStateSelection(),
      improvementPreference: 'bonus_first',
    }, null)
  })

  it('keeps a failed selection save next to the Entries as an error', async () => {
    const user = userEvent.setup()
    const candidate = checkpointCandidate([checkpointPracticalBonuses(), checkpointIdealBonuses()])
    const target = checkpointTarget()
    const entry = createBuildListEntry(candidate, target, {
      id: buildListEntryId('build-list.checkpoint.failed'),
      createdAt: '2026-09-12T00:00:00.000Z',
    })
    const deps: BuildListPageDependencies = {
      ...dependencies(),
      refresh: vi.fn(async () => ({ entries: [entry], targets: [target], ownedWeapons: [checkpointSource()] })),
      updateIntermediateStateSelection: vi.fn(async () => {
        throw new Error('checkpoint: 選択内容が不正です。')
      }),
    }
    renderPage(deps)
    await user.click(await screen.findByRole('checkbox', { name: BONUS_ONE }))
    expect(await screen.findByText('checkpoint: 選択内容が不正です。')).toBeInTheDocument()
    // Nothing else is presented as a load failure.
    expect(screen.getByRole('button', { name: '生産計画を作成' })).toBeInTheDocument()
  })

  it('names the Planner progress and offers cancel while planning', async () => {
    const user = userEvent.setup()
    let releasePlan: (result: PlannerOrchestrationResult) => void = () => undefined
    const client = createPlannerClient()
    client.createConstrainedPlan = vi.fn(
      (_id, _input, _bounds, callbacks) => new Promise<PlannerOrchestrationResult>((resolve) => {
        callbacks?.onProgress?.({ expandedStates: 2_500, maxExpandedStates: 10_000 })
        releasePlan = resolve
      }),
    )
    renderPage(dependencies([], client))
    await user.click(await screen.findByRole('button', { name: '生産計画を作成' }))

    expect(await screen.findByText('計画中 2500 / 10000')).toBeInTheDocument()
    const bar = screen.getByRole('progressbar', { name: '生産計画の作成の進捗' })
    expect(bar).toHaveAttribute('aria-valuenow', '25')
    expect(screen.getByRole('button', { name: 'キャンセル' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '生産計画を作成' })).toBeDisabled()
    releasePlan(createOrchestrationResult())
  })

  it('shows Planner warnings with their typed label and the returned message', async () => {
    const user = userEvent.setup()
    const deps = dependencies([], createPlannerClient(createOrchestrationResult({
      plan: null,
      termination: exhaustedPlannerTermination(),
      warnings: [{ kind: 'build_list_entry_stale', message: 'Typed warning message' }],
    })))
    deps.savePlannerResult = vi.fn(async () => null)
    renderPage(deps)
    await user.click(await screen.findByRole('button', { name: '生産計画を作成' }))

    expect(await screen.findByText('再検索が必要なビルドリスト項目があります')).toBeInTheDocument()
    expect(screen.getByText('Typed warning message')).toBeInTheDocument()
    expect(screen.getByText('現在の入力から作成できる生産計画はありませんでした。')).toBeInTheDocument()
    expect(screen.queryByText('生産計画の探索が完了していません')).not.toBeInTheDocument()
  })
})

describe('BuildListPage intermediate state save chain recovery', () => {
  interface SaveAttempt {
    selection: IntermediateStateSelection
    resolve(): void
    reject(): void
  }

  /**
   * One Practical state on each lane plus the improvement preference: three
   * independent edits of one Entry. Every save waits for the test.
   */
  function chainFixture(persisted: Partial<IntermediateStateSelection> = {}) {
    const { candidate, source } = checkpointMixedCandidate({
      bonusResults: [checkpointPracticalBonuses(), checkpointIdealBonuses()],
      skillResults: [CHECKPOINT_PRACTICAL_SKILL, CHECKPOINT_IDEAL_SKILL],
    })
    const target = checkpointTarget()
    const ids = {
      bonus: intermediateOpportunityAt(candidate, 'bonus', 1).opportunity.id,
      skill: intermediateOpportunityAt(candidate, 'skill', 1).opportunity.id,
    }
    let entry = createBuildListEntry(candidate, target, {
      id: buildListEntryId('build-list.checkpoint.chain'),
      createdAt: '2026-09-12T00:00:00.000Z',
      intermediateStateSelection: { ...defaultIntermediateStateSelection(), ...persisted },
    })
    const attempts: SaveAttempt[] = []
    const deps: BuildListPageDependencies = {
      ...dependencies(),
      refresh: vi.fn(async () => ({ entries: [entry], targets: [target], ownedWeapons: [source] })),
      updateIntermediateStateSelection: vi.fn((_id, selection) =>
        new Promise<typeof entry>((resolve, reject) => {
          attempts.push({
            selection,
            resolve: () => {
              entry = { ...entry, intermediateStateSelection: { ...selection } }
              resolve(entry)
            },
            reject: () => reject(new Error('途中採用状態の保存に失敗しました（テスト）')),
          })
        })),
    }
    return { deps, ids, attempts, latestEntry: () => entry }
  }

  const base = () => defaultIntermediateStateSelection()

  it('continues from the last persisted selection after a failed save (success -> failure -> success)', async () => {
    const user = userEvent.setup()
    const { deps, ids, attempts, latestEntry } = chainFixture()
    renderPage(deps)
    const bonus = await screen.findByRole('checkbox', { name: BONUS_ONE })
    const skill = screen.getByRole('checkbox', { name: SKILL_ONE })
    const skillFirst = screen.getByRole('radio', { name: 'スキルを優先' })

    // A (Bonus lane), B (Skill lane), C (preference) are changed before any
    // save settles.
    await user.click(bonus)
    await user.click(skill)
    await user.click(skillFirst)
    expect(attempts).toHaveLength(1)
    expect(attempts[0].selection).toEqual({ ...base(), bonusOpportunityId: ids.bonus })

    attempts[0].resolve()
    await waitFor(() => expect(attempts).toHaveLength(2))
    // B starts from A's persisted result.
    expect(attempts[1].selection).toEqual({ ...base(), bonusOpportunityId: ids.bonus, skillOpportunityId: ids.skill })

    attempts[1].reject()
    expect(await screen.findByText('途中採用状態の保存に失敗しました（テスト）')).toBeInTheDocument()
    await waitFor(() => expect(attempts).toHaveLength(3))
    // C starts from the last *persisted* selection {A}, never from the
    // render-time default and never from the failed {A, B}.
    expect(attempts[2].selection).toEqual({ ...base(), bonusOpportunityId: ids.bonus, improvementPreference: 'skill_first' })

    attempts[2].resolve()
    await waitFor(() => expect(skillFirst).toBeChecked())
    expect(bonus).toBeChecked()
    expect(skill).not.toBeChecked()
    expect(latestEntry().intermediateStateSelection).toEqual({
      ...base(),
      bonusOpportunityId: ids.bonus,
      improvementPreference: 'skill_first',
    })
    expect(deps.updateIntermediateStateSelection).toHaveBeenCalledTimes(3)
    // The chain is still usable after the failure: a fourth change builds on {A, C}.
    await user.click(skill)
    await waitFor(() => expect(attempts).toHaveLength(4))
    expect(attempts[3].selection).toEqual({
      ...base(),
      bonusOpportunityId: ids.bonus,
      skillOpportunityId: ids.skill,
      improvementPreference: 'skill_first',
    })
    attempts[3].resolve()
    await waitFor(() => expect(skill).toBeChecked())
  })

  it('starts the save after a first failure from the persisted selection, not from the failed one', async () => {
    const user = userEvent.setup()
    // Persisted before the page opened: the Bonus state (X). The ids are
    // deterministic, so a throwaway fixture can name it.
    const ids = chainFixture().ids
    const fixture = chainFixture({ bonusOpportunityId: ids.bonus })
    renderPage(fixture.deps)
    const skill = await screen.findByRole('checkbox', { name: SKILL_ONE })
    const bonusFirst = screen.getByRole('radio', { name: '復元ボーナスを優先' })

    await user.click(skill)
    await user.click(bonusFirst)
    expect(fixture.attempts[0].selection).toEqual({ ...base(), bonusOpportunityId: ids.bonus, skillOpportunityId: ids.skill })
    fixture.attempts[0].reject()
    expect(await screen.findByText('途中採用状態の保存に失敗しました（テスト）')).toBeInTheDocument()
    await waitFor(() => expect(fixture.attempts).toHaveLength(2))
    // B builds on the last persisted {X}, not on the failed {X, A}.
    expect(fixture.attempts[1].selection).toEqual({ ...base(), bonusOpportunityId: ids.bonus, improvementPreference: 'bonus_first' })
    fixture.attempts[1].resolve()
    await waitFor(() => expect(bonusFirst).toBeChecked())
    expect(skill).not.toBeChecked()
    expect(fixture.latestEntry().intermediateStateSelection).toEqual({
      ...base(),
      bonusOpportunityId: ids.bonus,
      improvementPreference: 'bonus_first',
    })
  })

  it('keeps the heading outline sequential down to the deepest selector structure', async () => {
    // The stronger Practical product arrives first, so the plain Practical
    // group (reached twice) is display-secondary and carries a later arrival.
    const candidate = checkpointCandidate([
      checkpointStrongerPracticalBonuses(),
      checkpointPracticalBonuses(),
      checkpointAlternativeBonuses(),
      checkpointPracticalBonuses(),
      checkpointIdealBonuses(),
    ])
    const target = checkpointTarget()
    const entry = createBuildListEntry(candidate, target, {
      id: buildListEntryId('build-list.checkpoint.outline'),
      createdAt: '2026-09-12T00:00:00.000Z',
    })
    const deps: BuildListPageDependencies = {
      ...dependencies(),
      refresh: vi.fn(async () => ({ entries: [entry], targets: [target], ownedWeapons: [checkpointSource()] })),
    }
    renderPage(deps)

    expect(await screen.findByRole('heading', { level: 4, name: '理想候補' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 5, name: '途中採用できる状態と改善優先' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 6, name: '復元ボーナス候補' })).toBeInTheDocument()
    // Below h6 nothing becomes a new heading: the group titles are labelled
    // text and the disclosures keep their toggles.
    expect(screen.getByText('復元ボーナス候補 1')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '復元ボーナス候補 1' })).not.toBeInTheDocument()
    const secondaryToggle = screen.getByRole('button', { name: 'その他の候補（1）' })
    expect(secondaryToggle.closest('h6')).toBeNull()
    await userEvent.click(secondaryToggle)
    expect(await screen.findByText('復元ボーナス候補 3')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '復元ボーナス候補 3' })).not.toBeInTheDocument()
    const laterToggle = screen.getByRole('button', { name: 'その他の到達点（1）' })
    expect(laterToggle.closest('h6')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'その他の到達点（1）' })).not.toBeInTheDocument()
    await userEvent.click(laterToggle)
    expect(await screen.findByRole('checkbox', { name: 'この途中状態を採用する: 復元ボーナス操作4回目（再抽選）の直後' })).toBeInTheDocument()
    // No heading level is skipped anywhere on the page.
    const levels = screen.getAllByRole('heading').map((heading) => Number(heading.tagName.slice(1)))
    for (let index = 1; index < levels.length; index += 1) {
      expect(levels[index] - levels[index - 1]).toBeLessThanOrEqual(1)
    }
  })
})
