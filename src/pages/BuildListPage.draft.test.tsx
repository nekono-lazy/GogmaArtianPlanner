import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider, useParams } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { createBuildListEntry, createTargetDefinitionHash } from '../domain/buildList'
import { createSearchStateHash } from '../domain/models/hashing'
import type { ProductionPlan } from '../domain/models/publicTypes'
import { defaultPlannerOptions, type PlannerInput } from '../domain/planner'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../domain/rng/production/productionRngEngine'
import { RepositoryError } from '../db/repositoryError'
import type { ProductionPlanReplanDependencies } from '../services/execution/productionPlanReplanDependencies'
import type { PlannerWorkerClient } from '../services/planner/plannerWorkerClient'
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
import { BuildListPage, type BuildListPageDependencies } from './BuildListPage'

/** No Preview is started here, so the replan runtime is never reached. */
function unusedReplanDependencies(): ProductionPlanReplanDependencies {
  const notExpected = () => Promise.reject(new Error('replan is not expected in this test'))
  return {
    prepareProductionPlanReplanPreview: vi.fn(notExpected),
    createProductionPlanReplanPreview: vi.fn(() => { throw new Error('replan is not expected in this test') }),
    inspectProductionPlanReplanAdoption: vi.fn(notExpected),
    adoptProductionPlanReplanPreview: vi.fn(notExpected),
  }
}

function unusedClient(): PlannerWorkerClient {
  return {
    engineVersion: PRODUCTION_RNG_ENGINE_VERSION,
    createPlan: vi.fn(),
    createConstrainedPlan: vi.fn(),
    createWhatIfComparison: vi.fn(),
    createPlannerAlternativeComparison: vi.fn(),
    createPlannerAlternativeRepair: vi.fn(),
    prepareInteraction: vi.fn(),
    cancelPlan: vi.fn(),
    dispose: vi.fn(),
  }
}

function draftPlan(): ProductionPlan {
  return { ...createValidProductionPlan(), id: productionPlanId('plan.build-list.draft') }
}

function runningPlan(): ProductionPlan {
  return { ...createValidProductionPlan(), id: productionPlanId('plan.build-list.running'), status: 'active' }
}

function dependencies(options: {
  draft?: ProductionPlan | Error
  running?: ProductionPlan
  entries?: 'none'
} = {}): BuildListPageDependencies {
  const target = createValidTargetWeapon()
  const candidate = createValidBuildCandidate()
  candidate.searchStateHash = createSearchStateHash(candidate.route, createValidRngState(), [createValidNormalArtianCounter()])
  const entry = createBuildListEntry(candidate, target, { id: buildListEntryId('build-list.draft.ui'), createdAt: '2026-08-29T03:00:00.000Z' })
  entry.targetDefinitionHash = createTargetDefinitionHash(target)
  return {
    master: createValidMasterDataFixture(),
    createWorkerClient: () => unusedClient(),
    refresh: vi.fn(async () => ({ entries: options.entries === 'none' ? [] : [entry], targets: [target], ownedWeapons: [] })),
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
    getRunningProductionPlan: vi.fn(async () => options.running),
    getDraftProductionPlan: vi.fn(async () => {
      if (options.draft instanceof Error) throw options.draft
      return options.draft
    }),
    replan: unusedReplanDependencies(),
  }
}

function PlanDestination() {
  const { planId } = useParams()
  return <div>Plan destination: {planId}</div>
}

function renderPage(deps: BuildListPageDependencies) {
  const router = createMemoryRouter(
    [
      { path: '/build-list', element: <BuildListPage dependencies={deps} /> },
      { path: '/plans', element: <div>Production plan list destination</div> },
      { path: '/plans/:planId', element: <PlanDestination /> },
    ],
    { initialEntries: ['/build-list'] },
  )
  return { router, ...render(<RouterProvider router={router} />) }
}

const CREATE = '生産計画を作成'
const START = '現在地点から再計画を試算'
const REPLACEMENT = '新しい生産計画を保存すると、現在の未開始の生産計画は置き換えられます。'

describe('BuildListPage current Draft guidance', () => {
  it('shows nothing about a Draft, and no replacement note, when none is stored', async () => {
    const deps = dependencies()
    renderPage(deps)

    expect(await screen.findByRole('button', { name: CREATE })).toBeEnabled()
    expect(deps.getDraftProductionPlan).toHaveBeenCalledOnce()
    expect(screen.queryByText('未開始の生産計画があります。')).not.toBeInTheDocument()
    expect(screen.queryByText('未開始の下書きも保存されています。')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '下書きを開く' })).not.toBeInTheDocument()
    expect(screen.queryByText(REPLACEMENT, { exact: false })).not.toBeInTheDocument()
  })

  it('leads to the current Draft and to the Production Plan list', async () => {
    const user = userEvent.setup()
    const draft = draftPlan()
    const { router } = renderPage(dependencies({ draft }))

    expect(await screen.findByText('未開始の生産計画があります。')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '下書きを開く' })).toHaveAttribute('href', `/plans/${draft.id}`)
    expect(screen.getByRole('link', { name: '生産計画一覧を見る' })).toHaveAttribute('href', '/plans')

    await user.click(screen.getByRole('link', { name: '下書きを開く' }))
    expect(router.state.location.pathname).toBe(`/plans/${draft.id}`)
    expect(await screen.findByText(`Plan destination: ${draft.id}`)).toBeInTheDocument()
  })

  it('says the next saved Plan replaces the current Draft where the ordinary creation is offered', async () => {
    renderPage(dependencies({ draft: draftPlan() }))

    expect(await screen.findByRole('button', { name: CREATE })).toBeEnabled()
    const section = screen.getByRole('heading', { name: '生産計画の作成' }).closest('section') as HTMLElement
    expect(within(section).getByText(REPLACEMENT, { exact: false })).toBeInTheDocument()
  })

  it('keeps the replan entry of a running Plan and shows the Draft as read-only guidance beside it', async () => {
    const draft = draftPlan()
    const running = runningPlan()
    const deps = dependencies({ draft, running })
    renderPage(deps)

    expect(await screen.findByRole('button', { name: START })).toBeEnabled()
    expect(screen.getByRole('heading', { name: '現在地点からの再計画' })).toBeInTheDocument()
    expect(screen.getByText('未開始の下書きも保存されています。')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '下書きを開く' })).toHaveAttribute('href', `/plans/${draft.id}`)
    expect(screen.getAllByRole('link', { name: '生産計画一覧を見る' }).length).toBeGreaterThan(0)
    // No ordinary Draft creation beside a running Plan, and no replacement note.
    expect(screen.queryByRole('button', { name: CREATE })).not.toBeInTheDocument()
    expect(screen.queryByText(REPLACEMENT, { exact: false })).not.toBeInTheDocument()
    expect(deps.savePlannerResult).not.toHaveBeenCalled()
  })

  it('reports a failed Draft read instead of assuming no Draft, and withholds the ordinary creation', async () => {
    const deps = dependencies({ draft: new RepositoryError('draft_plan_conflict', 'two Drafts') })
    renderPage(deps)

    expect(await screen.findByText(/未開始の生産計画（下書き）を確認できないため、生産計画の作成はできません。/)).toBeInTheDocument()
    await waitFor(() => expect(deps.refresh).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: CREATE })).not.toBeInTheDocument()
    expect(screen.queryByText('未開始の生産計画があります。')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '下書きを開く' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '生産計画一覧を見る' })).toHaveAttribute('href', '/plans')
  })
})
