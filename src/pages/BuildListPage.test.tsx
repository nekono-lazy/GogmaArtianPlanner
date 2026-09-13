import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider, useParams } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { createBuildListEntry, createTargetDefinitionHash } from '../domain/buildList'
import { createSearchStateHash } from '../domain/models/hashing'
import type { BuildListEntryStaleReason } from '../domain/models/publicTypes'
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
  checkpointAlternativeBonuses,
  checkpointCandidate,
  checkpointIdealBonuses,
  checkpointPracticalBonuses,
  checkpointSource,
  checkpointStrongerPracticalBonuses,
  checkpointTarget,
} from '../test/fixtures/checkpointRoute'
import { BuildListPage, type BuildListPageDependencies } from './BuildListPage'

function createOrchestrationResult(
  overrides: Partial<PlannerOrchestrationResult> = {},
): PlannerOrchestrationResult {
  return {
    plan: createValidProductionPlan(),
    conflicts: [],
    warnings: [],
    termination: completedPlannerTermination(),
    generatedBuildListEntries: [],
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
        lotteries: [],
        materialCosts: [],
      },
      conflictResolutions: [],
    })),
    savePlannerResult: vi.fn(async () => createValidProductionPlan()),
    updateCheckpointSelection: vi.fn(async () => { throw new Error('not used in this fixture') }),
  deleteEntry: vi.fn(async () => undefined),
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

  it('keeps both groups selected when two toggles overlap in flight', async () => {
    const user = userEvent.setup()
    // Two independent checkpoint groups on one Route: one opportunity each.
    const candidate = checkpointCandidate([
      checkpointPracticalBonuses(),
      checkpointAlternativeBonuses(),
      checkpointIdealBonuses(),
    ])
    const target = checkpointTarget()
    let entry = createBuildListEntry(candidate, target, {
      id: buildListEntryId('build-list.checkpoint.race'),
      createdAt: '2026-09-12T00:00:00.000Z',
    })
    const releases: Array<() => void> = []
    const deps: BuildListPageDependencies = {
      ...dependencies(),
      refresh: vi.fn(async () => ({ entries: [entry], targets: [target], ownedWeapons: [checkpointSource()] })),
      // Every save waits until the test releases it, in call order.
      updateCheckpointSelection: vi.fn(async (_id, selected) => {
        await new Promise<void>((resolve) => releases.push(resolve))
        entry = { ...entry, selectedCheckpointOpportunityIds: [...selected] }
        return entry
      }),
    }
    renderPage(deps)
    const first = await screen.findByRole('checkbox', { name: '1手目（理想まで残り2操作）' })
    const second = screen.getByRole('checkbox', { name: '2手目（理想まで残り1操作）' })

    // The second toggle starts while the first save is still pending.
    await user.click(first)
    await user.click(second)
    expect(releases).toHaveLength(1)
    releases[0]()
    await waitFor(() => expect(releases).toHaveLength(2))
    releases[1]()

    await waitFor(() => expect(deps.updateCheckpointSelection).toHaveBeenCalledTimes(2))
    const [firstGroup, secondGroup] = (candidate.checkpointGroups ?? []).map(
      ({ opportunities }) => opportunities[0].id,
    )
    const calls = vi.mocked(deps.updateCheckpointSelection).mock.calls
    expect(calls[0][1]).toEqual([firstGroup])
    // The second save starts from the first save's result, so the first
    // selection survives: different groups may be selected together.
    expect(calls[1][1]).toEqual([firstGroup, secondGroup])
    await waitFor(() => expect(first).toBeChecked())
    expect(second).toBeChecked()
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
      'チェックポイント選択中',
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

  it('explains checkpoints in Build List terms and reflects the persisted selection', async () => {
    const user = userEvent.setup()
    const candidate = checkpointCandidate([
      checkpointPracticalBonuses(),
      checkpointIdealBonuses(),
    ])
    const target = checkpointTarget()
    const selected = (candidate.checkpointGroups ?? [])[0].opportunities[0].id
    let entry = createBuildListEntry(candidate, target, {
      id: buildListEntryId('build-list.checkpoint.persisted'),
      createdAt: '2026-09-12T00:00:00.000Z',
      selectedCheckpointOpportunityIds: [selected],
    })
    const deps: BuildListPageDependencies = {
      ...dependencies(),
      refresh: vi.fn(async () => ({ entries: [entry], targets: [target], ownedWeapons: [checkpointSource()] })),
      updateCheckpointSelection: vi.fn(async (_id, next) => {
        entry = { ...entry, selectedCheckpointOpportunityIds: [...next] }
        return entry
      }),
    }
    renderPage(deps)

    const checkbox = await screen.findByRole('checkbox', { name: '1手目（理想まで残り1操作）' })
    expect(checkbox).toBeChecked()
    expect(screen.getByText('チェックポイント選択中 1')).toBeInTheDocument()
    expect(screen.getByText(
      '選択中のチェックポイントは、この候補を作成する途中で必ず経由する条件としてPlannerに渡されます。変更すると既存の生産計画は再計算が必要です。性能ごとに選べる到達点は1つまでです。',
    )).toBeInTheDocument()
    expect(screen.queryByText(/作成リストへ登録します/)).not.toBeInTheDocument()

    await user.click(checkbox)
    expect(deps.updateCheckpointSelection).toHaveBeenCalledWith(entry.id, [])
    expect(await screen.findByText('利用チェックポイントを更新しました。生産計画を再作成してください。')).toBeInTheDocument()
    expect(screen.getByText('チェックポイント未選択')).toBeInTheDocument()
  })

  it('keeps a failed checkpoint save next to the Entries as an error', async () => {
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
      updateCheckpointSelection: vi.fn(async () => {
        throw new Error('checkpoint: 選択内容が不正です。')
      }),
    }
    renderPage(deps)
    await user.click(await screen.findByRole('checkbox', { name: '1手目（理想まで残り1操作）' }))
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

describe('BuildListPage checkpoint save chain recovery', () => {
  interface SaveAttempt {
    selected: readonly string[]
    resolve(): void
    reject(): void
  }

  /**
   * Three primary checkpoint groups on one Route: the Practical product
   * (1手目), the Alternative product (2手目) and the stronger Practical product
   * (3手目; arriving later, it dominates nothing). Every save waits for the test.
   */
  function chainFixture(persisted: readonly string[] = []) {
    const candidate = checkpointCandidate([
      checkpointPracticalBonuses(),
      checkpointAlternativeBonuses(),
      checkpointStrongerPracticalBonuses(),
      checkpointIdealBonuses(),
    ])
    const target = checkpointTarget()
    const groups = candidate.checkpointGroups ?? []
    const byOperationCount = (count: number) =>
      groups.flatMap(({ opportunities }) => opportunities).find(
        ({ operationCount }) => operationCount === count,
      )!.id
    const ids = { practical: byOperationCount(1), alternative: byOperationCount(2), stronger: byOperationCount(3) }
    let entry = createBuildListEntry(candidate, target, {
      id: buildListEntryId('build-list.checkpoint.chain'),
      createdAt: '2026-09-12T00:00:00.000Z',
      selectedCheckpointOpportunityIds: [...persisted] as never[],
    })
    const attempts: SaveAttempt[] = []
    const deps: BuildListPageDependencies = {
      ...dependencies(),
      refresh: vi.fn(async () => ({ entries: [entry], targets: [target], ownedWeapons: [checkpointSource()] })),
      updateCheckpointSelection: vi.fn((_id, selected) =>
        new Promise<typeof entry>((resolve, reject) => {
          attempts.push({
            selected,
            resolve: () => {
              entry = { ...entry, selectedCheckpointOpportunityIds: [...selected] }
              resolve(entry)
            },
            reject: () => reject(new Error('チェックポイントの保存に失敗しました（テスト）')),
          })
        })),
    }
    return { deps, ids, attempts, latestEntry: () => entry }
  }

  const names = {
    practical: '1手目（理想まで残り3操作）',
    alternative: '2手目（理想まで残り2操作）',
    stronger: '3手目（理想まで残り1操作）',
  }

  it('continues from the last persisted selection after a failed save (success -> failure -> success)', async () => {
    const user = userEvent.setup()
    const { deps, ids, attempts, latestEntry } = chainFixture()
    renderPage(deps)
    const alternative = await screen.findByRole('checkbox', { name: names.alternative })
    const stronger = screen.getByRole('checkbox', { name: names.stronger })
    const practical = screen.getByRole('checkbox', { name: names.practical })

    // A, B, C are toggled before any save settles.
    await user.click(alternative)
    await user.click(stronger)
    await user.click(practical)
    expect(attempts).toHaveLength(1)
    expect(attempts[0].selected).toEqual([ids.alternative])

    attempts[0].resolve()
    await waitFor(() => expect(attempts).toHaveLength(2))
    // B starts from A's persisted result.
    expect(attempts[1].selected).toEqual([ids.alternative, ids.stronger])

    attempts[1].reject()
    expect(await screen.findByText('チェックポイントの保存に失敗しました（テスト）')).toBeInTheDocument()
    await waitFor(() => expect(attempts).toHaveLength(3))
    // C starts from the last *persisted* selection [A], never from the
    // render-time [] and never from the failed [A, B].
    expect(attempts[2].selected).toEqual([ids.alternative, ids.practical])

    attempts[2].resolve()
    await waitFor(() => expect(practical).toBeChecked())
    expect(alternative).toBeChecked()
    expect(stronger).not.toBeChecked()
    expect(latestEntry().selectedCheckpointOpportunityIds).toEqual([ids.alternative, ids.practical])
    expect(deps.updateCheckpointSelection).toHaveBeenCalledTimes(3)
    // The chain is still usable after the failure: a fourth toggle builds on [A, C].
    await user.click(stronger)
    await waitFor(() => expect(attempts).toHaveLength(4))
    expect(attempts[3].selected).toEqual([ids.alternative, ids.practical, ids.stronger])
    attempts[3].resolve()
    await waitFor(() => expect(stronger).toBeChecked())
  })

  it('starts the save after a first failure from the persisted selection, not from the failed one', async () => {
    const user = userEvent.setup()
    // Persisted before the page opened: the Practical checkpoint (X). The ids
    // are deterministic, so a throwaway fixture can name it.
    const ids = chainFixture().ids
    const persistedId = ids.practical
    const fixture = chainFixture([persistedId])
    renderPage(fixture.deps)
    const alternative = await screen.findByRole('checkbox', { name: names.alternative })
    const stronger = screen.getByRole('checkbox', { name: names.stronger })

    await user.click(alternative)
    await user.click(stronger)
    expect(fixture.attempts[0].selected).toEqual([persistedId, ids.alternative])
    fixture.attempts[0].reject()
    expect(await screen.findByText('チェックポイントの保存に失敗しました（テスト）')).toBeInTheDocument()
    await waitFor(() => expect(fixture.attempts).toHaveLength(2))
    // B builds on the last persisted [X], not on the failed [X, A].
    expect(fixture.attempts[1].selected).toEqual([persistedId, ids.stronger])
    fixture.attempts[1].resolve()
    await waitFor(() => expect(stronger).toBeChecked())
    expect(alternative).not.toBeChecked()
    expect(fixture.latestEntry().selectedCheckpointOpportunityIds).toEqual([persistedId, ids.stronger])
  })

  it('keeps the heading outline sequential down to the deepest checkpoint structure', async () => {
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
    expect(screen.getByRole('heading', { level: 5, name: '途中で利用可能な妥協チェックポイント' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 6, name: 'チェックポイント 1' })).toBeInTheDocument()
    // Below h6 nothing becomes a new heading: the disclosures keep their
    // toggles, and the secondary group title is labelled text.
    const secondaryToggle = screen.getByRole('button', { name: 'その他の候補（1）' })
    expect(screen.getByRole('heading', { level: 6, name: 'その他の候補（1）' })).toContainElement(secondaryToggle)
    await userEvent.click(secondaryToggle)
    expect(await screen.findByText('チェックポイント 3')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'チェックポイント 3' })).not.toBeInTheDocument()
    const laterToggle = screen.getByRole('button', { name: 'その他の到達点（1）' })
    expect(laterToggle.closest('h6')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'その他の到達点（1）' })).not.toBeInTheDocument()
    await userEvent.click(laterToggle)
    expect(await screen.findByRole('checkbox', { name: '4手目（理想まで残り1操作）' })).toBeInTheDocument()
    // No heading level is skipped anywhere on the page.
    const levels = screen.getAllByRole('heading').map((heading) => Number(heading.tagName.slice(1)))
    for (let index = 1; index < levels.length; index += 1) {
      expect(levels[index] - levels[index - 1]).toBeLessThanOrEqual(1)
    }
  })
})
