import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider, useParams } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { createBuildListEntry, createTargetDefinitionHash } from '../domain/buildList'
import { createSearchStateHash } from '../domain/models/hashing'
import type { BuildListEntryStaleReason } from '../domain/models/publicTypes'
import {
  buildListEntryId,
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
import { createBuildListCalculationContext } from '../services/buildList/createBuildListCalculationContext'
import type { PlannerWorkerClient } from '../services/planner/plannerWorkerClient'
import { BuildListPage, type BuildListPageDependencies } from './BuildListPage'

function createOrchestrationResult(
  overrides: Partial<PlannerOrchestrationResult> = {},
): PlannerOrchestrationResult {
  return {
    plan: createValidProductionPlan(),
    conflicts: [],
    warnings: [],
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
    expect(input).toBe(await vi.mocked(deps.createInput).mock.results[0].value)
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
      createOrchestrationResult({ plan: null, generatedBuildListEntries: [] }),
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
      createOrchestrationResult({ plan: null, generatedBuildListEntries: [] }),
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
    expect(screen.getByText('実用')).toBeInTheDocument()
  })

  it('removes only the Build List entry', async () => {
    const user = userEvent.setup()
    const deps = dependencies()
    renderPage(deps)
    await user.click(await screen.findByRole('button', { name: 'ビルドリストから削除' }))
    expect(deps.deleteEntry).toHaveBeenCalledOnce()
    expect(screen.queryByText('Domain fixture target')).not.toBeInTheDocument()
  })

  it('shows an empty state', async () => {
    const deps = dependencies()
    deps.refresh = vi.fn(async () => ({ entries: [], targets: [], ownedWeapons: [] }))
    renderPage(deps)
    expect(await screen.findByText('ビルドリストは空です。検索結果から候補を追加してください。')).toBeInTheDocument()
  })
})
