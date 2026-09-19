import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { createBuildListEntry, createTargetDefinitionHash } from '../domain/buildList'
import {
  createProductionPlanReplanPreview,
  type ProductionPlanReplanAdoptionOptions,
  type ProductionPlanReplanPreviewRequest,
} from '../domain/execution'
import { createSearchStateHash } from '../domain/models/hashing'
import type { BuildListEntry, ProductionPlan, TargetWeapon } from '../domain/models/publicTypes'
import {
  defaultPlannerOptions,
  defaultPlannerOrchestrationBounds,
  type PlannerInput,
  type PlannerOrchestrationResult,
} from '../domain/planner'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../domain/rng/production/productionRngEngine'
import { RepositoryError } from '../db/repositoryError'
import type { ProductionPlanReplanDependencies } from '../services/execution/productionPlanReplanDependencies'
import type { PlannerWorkerClient } from '../services/planner/plannerWorkerClient'
import {
  buildListEntryId,
  createValidBuildCandidate,
  createValidNormalArtianCounter,
  createValidProductionPlan,
  createValidRngState,
  createValidTargetWeapon,
  productionPlanId,
} from '../test/fixtures/domainData'
import { createValidMasterDataFixture } from '../test/fixtures/masterData'
import { completedPlannerTermination } from '../test/fixtures/plannerTermination'
import { BuildListPage, type BuildListPageDependencies } from './BuildListPage'

/**
 * The Build List's Planner entry while a Plan runs (`docs/UI_FLOW.md` 10 /
 * 16.4, `docs/PLANNER_SPEC.md` 16.8): the ordinary 「生産計画を作成」 only when
 * no Plan runs, 「現在地点から再計画を試算」 for an active or stale one, with
 * the same Preview / adoption flow as the Production Plan page.
 */

const RUNNING_PLAN_ID = productionPlanId('plan.build-list.running')
const PREVIEW_PLAN_ID = productionPlanId('plan.build-list.preview')

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

function fixtureEntry(target: TargetWeapon): BuildListEntry {
  const candidate = createValidBuildCandidate()
  candidate.searchStateHash = createSearchStateHash(candidate.route, createValidRngState(), [createValidNormalArtianCounter()])
  const entry = createBuildListEntry(candidate, target, { id: buildListEntryId('build-list.replan'), createdAt: '2026-08-29T03:00:00.000Z' })
  entry.targetDefinitionHash = createTargetDefinitionHash(target)
  return entry
}

function plannerInput(target: TargetWeapon, entry: BuildListEntry): PlannerInput {
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

function orchestrationResult(overrides: Partial<PlannerOrchestrationResult> = {}): PlannerOrchestrationResult {
  return {
    plan: currentContractPlan(PREVIEW_PLAN_ID, { status: 'draft' }),
    conflicts: [],
    warnings: [],
    termination: completedPlannerTermination(),
    generatedBuildListEntries: [],
    ...overrides,
  }
}

function workerClient(result: PlannerOrchestrationResult = orchestrationResult()): PlannerWorkerClient {
  return {
    engineVersion: PRODUCTION_RNG_ENGINE_VERSION,
    createPlan: vi.fn(),
    createConstrainedPlan: vi.fn(async () => result),
    createWhatIfComparison: vi.fn(),
    prepareInteraction: vi.fn(),
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

function replanDependencies(plan: ProductionPlan, request: ProductionPlanReplanPreviewRequest): ProductionPlanReplanDependencies {
  return {
    prepareProductionPlanReplanPreview: vi.fn(async () => request),
    createProductionPlanReplanPreview: vi.fn(createProductionPlanReplanPreview),
    inspectProductionPlanReplanAdoption: vi.fn(async () => noChoice(plan)),
    adoptProductionPlanReplanPreview: vi.fn(async () => ({
      kind: 'adopted' as const,
      savePointHandling: 'no_choice' as const,
      oldPlan: { ...plan, status: 'abandoned' as const, abandonmentReason: 'replan_adopted' as const },
      newPlan: currentContractPlan(PREVIEW_PLAN_ID, { status: 'active' }),
      generatedBuildListEntries: [],
    })),
  }
}

function dependencies(options: {
  /** The running Plan read; 'none' means no Plan runs, and an Error makes the read fail. */
  running?: ProductionPlan | Error | 'none'
  client?: PlannerWorkerClient
  entries?: 'one' | 'none'
} = {}) {
  const target = createValidTargetWeapon()
  const entry = fixtureEntry(target)
  const entries = options.entries === 'none' ? [] : [entry]
  const plan =
    options.running === undefined || options.running === 'none' || options.running instanceof Error
      ? runningPlan()
      : options.running
  const request: ProductionPlanReplanPreviewRequest = {
    runningPlanToken: { planId: plan.id, status: plan.status === 'stale' ? 'stale' : 'active', currentStepId: plan.currentStepId },
    plannerInput: plannerInput(target, entry),
    calculationContext: { ...entry.calculationContext },
  }
  const client = options.client ?? workerClient()
  const replan = replanDependencies(plan, request)
  const deps: BuildListPageDependencies = {
    master: createValidMasterDataFixture(),
    createWorkerClient: vi.fn(() => client),
    refresh: vi.fn(async () => ({ entries, targets: [target], ownedWeapons: [] })),
    createInput: vi.fn(async (calculationContext): Promise<PlannerInput> => ({ ...plannerInput(target, entry), calculationContext })),
    savePlannerResult: vi.fn(async () => createValidProductionPlan()),
    deleteEntry: vi.fn(async () => undefined),
    inspectEntryDelete: vi.fn(async () => ({ approvalRequired: false as const })),
    updateIntermediateStateSelection: vi.fn(async () => {
      throw new Error('not used in this fixture')
    }),
    inspectIntermediateStateSelectionUpdate: vi.fn(async () => ({ approvalRequired: false as const })),
    getRunningProductionPlan: vi.fn(async () => {
      if (options.running instanceof Error) throw options.running
      return options.running === 'none' ? undefined : plan
    }),
    replan,
  }
  return { deps, plan, request, client, replan }
}

function renderPage(deps: BuildListPageDependencies) {
  const router = createMemoryRouter(
    [
      { path: '/build-list', element: <BuildListPage dependencies={deps} /> },
      { path: '/plans/:planId', element: <div>Plan destination</div> },
      { path: '/plans/:planId/run', element: <div>Execution navigator destination</div> },
    ],
    { initialEntries: ['/build-list'] },
  )
  return { router, ...render(<RouterProvider router={router} />) }
}

const START = '現在地点から再計画を試算'
const CREATE = '生産計画を作成'
const PREVIEW_TITLE = '再計画の試算（未採用）'
const ADOPT = 'この再計画を採用'

describe('BuildListPage replan entry', () => {
  it('offers the ordinary Draft creation when no Plan runs', async () => {
    const { deps } = dependencies({ running: 'none' })
    renderPage(deps)
    expect(await screen.findByRole('button', { name: CREATE })).toBeEnabled()
    expect(screen.queryByRole('button', { name: START })).not.toBeInTheDocument()
    expect(deps.getRunningProductionPlan).toHaveBeenCalledOnce()
  })

  it.each([
    ['active', runningPlan()],
    ['stale', runningPlan({ status: 'stale', recalculationReasons: ['unexpected_result'] })],
  ])('offers the replan Preview instead of a new Draft while a %s Plan runs', async (_, plan) => {
    const { deps } = dependencies({ running: plan })
    renderPage(deps)
    expect(await screen.findByRole('button', { name: START })).toBeEnabled()
    expect(screen.queryByRole('button', { name: CREATE })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '現在地点からの再計画' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '実行中の生産計画を見る' })).toHaveAttribute('href', `/plans/${plan.id}`)
    if (plan.status === 'active') {
      expect(screen.getByRole('link', { name: '実行ナビを再開する' })).toHaveAttribute('href', `/plans/${plan.id}/run`)
    } else {
      expect(screen.queryByRole('link', { name: '実行ナビを再開する' })).not.toBeInTheDocument()
    }
    // The ordinary Planner run never starts beside a running Plan.
    expect(deps.savePlannerResult).not.toHaveBeenCalled()
  })

  it('offers neither entry when the running Plan cannot be determined', async () => {
    const { deps } = dependencies({ running: new RepositoryError('active_plan_conflict', 'two running Plans') })
    renderPage(deps)
    expect(await screen.findByText('実行中の生産計画を確認できないため、生産計画の作成と再計画の試算はできません。')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: CREATE })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: START })).not.toBeInTheDocument()
  })

  it('still offers the Preview while a Plan runs and the Build List is empty', async () => {
    const { deps } = dependencies({ entries: 'none' })
    renderPage(deps)
    expect(await screen.findByRole('button', { name: START })).toBeEnabled()
    expect(screen.queryByRole('button', { name: CREATE })).not.toBeInTheDocument()
  })

  it('previews from the runtime request with the reviewed detail settings, then adopts through the runtime and opens the new Navigator', async () => {
    const { deps, plan, request, client, replan } = dependencies()
    const user = userEvent.setup()
    const { router } = renderPage(deps)

    // The reviewed detail settings are the Beam Search bounds of the Preview.
    const maxStates = await screen.findByLabelText('最大探索状態数')
    await user.clear(maxStates)
    await user.type(maxStates, '123')
    await user.click(screen.getByRole('button', { name: START }))

    expect(await screen.findByRole('heading', { name: PREVIEW_TITLE })).toBeInTheDocument()
    expect(replan.prepareProductionPlanReplanPreview).toHaveBeenCalledExactlyOnceWith({ runningPlanId: plan.id })
    expect(client.createConstrainedPlan).toHaveBeenCalledOnce()
    const [, input, bounds] = vi.mocked(client.createConstrainedPlan).mock.calls[0]
    expect(bounds).toEqual(defaultPlannerOrchestrationBounds)
    expect(input).toEqual({ ...request.plannerInput, options: { ...defaultPlannerOptions, maxExpandedStates: 123 } })
    // Only the bounds differ from the runtime's own request.
    expect(input.rngState).toBe(request.plannerInput.rngState)
    expect(input.buildListEntries).toBe(request.plannerInput.buildListEntries)
    // Nothing was saved as a Draft.
    expect(deps.savePlannerResult).not.toHaveBeenCalled()
    expect(screen.getByText('まだ現在の生産計画は変更されていません。この試算は保存されておらず、画面を離れると消えます。')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: ADOPT }))
    const dialog = await screen.findByRole('dialog', { name: 'この再計画を採用します' })
    await user.click(within(dialog).getByRole('button', { name: ADOPT }))

    expect(await screen.findByText('Execution navigator destination')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(`/plans/${PREVIEW_PLAN_ID}/run`)
    expect(replan.inspectProductionPlanReplanAdoption).toHaveBeenCalledOnce()
    expect(replan.adoptProductionPlanReplanPreview).toHaveBeenCalledOnce()
    expect(vi.mocked(replan.adoptProductionPlanReplanPreview).mock.calls[0][0].savePointDecision).toBeNull()
    expect(deps.savePlannerResult).not.toHaveBeenCalled()
  })

  it('refuses to start a Preview with invalid detail settings', async () => {
    const { deps, replan } = dependencies()
    const user = userEvent.setup()
    renderPage(deps)
    const maxStates = await screen.findByLabelText('最大探索状態数')
    await user.clear(maxStates)
    await user.type(maxStates, '0')
    expect(await screen.findByText('詳細設定に無効な値があるため、再計画を試算できません。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: START })).toBeDisabled()
    expect(replan.prepareProductionPlanReplanPreview).not.toHaveBeenCalled()
  })

  it('re-reads the running Plan after the runtime refused the adoption', async () => {
    const { deps, replan } = dependencies()
    const { ExecutionRuntimeError } = await import('../domain/execution')
    vi.mocked(replan.adoptProductionPlanReplanPreview).mockRejectedValue(new ExecutionRuntimeError('replan_state_changed', 'moved on'))
    const user = userEvent.setup()
    const { router } = renderPage(deps)
    await user.click(await screen.findByRole('button', { name: START }))
    await screen.findByRole('heading', { name: PREVIEW_TITLE })
    const readsBefore = vi.mocked(deps.getRunningProductionPlan).mock.calls.length

    await user.click(screen.getByRole('button', { name: ADOPT }))
    const dialog = await screen.findByRole('dialog', { name: 'この再計画を採用します' })
    await user.click(within(dialog).getByRole('button', { name: ADOPT }))

    expect(await screen.findByText('試算後に状態が変わりました。もう一度、現在地点から再計画を試算してください。')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: PREVIEW_TITLE })).not.toBeInTheDocument()
    await waitFor(() => expect(vi.mocked(deps.getRunningProductionPlan).mock.calls.length).toBeGreaterThan(readsBefore))
    expect(router.state.location.pathname).toBe('/build-list')
    expect(replan.prepareProductionPlanReplanPreview).toHaveBeenCalledOnce()
  })
})
