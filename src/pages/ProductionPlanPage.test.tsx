import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  createMemoryRouter,
  RouterProvider,
} from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type {
  BuildListEntry,
  PlanConflict,
  PlanStep,
  ProductionPlan,
  RestorationBonusSet,
  TargetWeapon,
} from '../domain/models/publicTypes'
import { CURRENT_CALCULATION_APP_SCHEMA_VERSION } from '../domain/models/publicTypes'
import {
  defaultPlannerOptions,
  defaultPlannerWhatIfBounds,
  type PlannerInput,
  type PlannerOrchestrationResult,
  type PlannerWhatIfCalculationResult,
} from '../domain/planner'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../domain/rng/production/productionRngEngine'
import {
  buildListEntryId,
  createValidBuildListEntry,
  createValidNormalArtianCounter,
  createValidOwnedWeapon,
  createValidProductionPlan,
  createValidRngState,
  createValidTargetWeapon,
  ownedWeaponId,
  planStepId,
  productionPlanId,
  targetWeaponId,
} from '../test/fixtures/domainData'
import { createValidMasterDataFixture } from '../test/fixtures/masterData'
import type { PlannerInteractionPreparationResult } from '../workers/plannerWorkerContracts'
import {
  PlannerCancelledError,
  type PlannerWorkerClient,
} from '../services/planner/plannerWorkerClient'
import {
  ProductionPlanPage,
  type ProductionPlanPageDependencies,
} from './ProductionPlanPage'
import {
  completedPlannerTermination,
  incompletePlannerTermination,
} from '../test/fixtures/plannerTermination'
import { useSettingsStore } from '../stores/settingsStore'
import { ExecutionRuntimeError } from '../domain/execution'
import type { ProductionPlanStartInspection } from '../services/execution/productionPlanExecutionService'
import type { ProductionPlanReplanDependencies } from '../services/execution/productionPlanReplanDependencies'
import type { PlannerOrchestrationResultSaveOutcome } from '../services/planner/plannerResultPersistenceService'

/** These cases never start a replan Preview, so the replan runtime is never reached. */
function unusedReplanDependencies(): ProductionPlanReplanDependencies {
  const notExpected = () => Promise.reject(new Error('replan is not expected in this test'))
  return {
    prepareProductionPlanReplanPreview: vi.fn(notExpected),
    createProductionPlanReplanPreview: vi.fn(() => { throw new Error('replan is not expected in this test') }),
    inspectProductionPlanReplanAdoption: vi.fn(notExpected),
    adoptProductionPlanReplanPreview: vi.fn(notExpected),
  }
}

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

function conflict(entry: BuildListEntry): PlanConflict {
  return {
    id: `conflict.${entry.id}`,
    kind: 'same_gogma_counter',
    buildListEntryIds: [entry.id],
    reason: 'Persisted fixture conflict',
    recommendedBuildListEntryId: entry.id,
    selectedBuildListEntryId: entry.id,
    resolutionNote: null,
  }
}

function pageFixture(suffix = 'a'): {
  plan: ProductionPlan
  entry: BuildListEntry
  target: TargetWeapon
  input: PlannerInput
  preparation: PlannerInteractionPreparationResult
} {
  const entry = createValidBuildListEntry()
  const target = createValidTargetWeapon()
  entry.id = buildListEntryId(`build-list.page.${suffix}`)
  entry.targetWeaponId = targetWeaponId(`target.page.${suffix}`)
  entry.candidateSnapshot.targetWeaponId = entry.targetWeaponId
  target.id = entry.targetWeaponId
  target.name = `Page fixture target ${suffix}`
  const persistedConflict = conflict(entry)
  const basePlan = createValidProductionPlan()
  const plan = {
    ...basePlan,
    id: productionPlanId(`plan.page.${suffix}`),
    // A current-contract Plan: the shared-attribution field is present, so the
    // legacy warning belongs only to the tests that build a legacy Plan.
    steps: basePlan.steps.map((step) => ({
      ...step,
      progressedTargetWeaponIds:
        step.targetWeaponId === null ? [] : [step.targetWeaponId],
    })),
    conflicts: [persistedConflict],
    selectedBuildListEntryIds: [],
  }
  const input: PlannerInput = {
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
  return {
    plan,
    entry,
    target,
    input,
    preparation: {
      status: 'ready',
      validBuildListEntryIds: [entry.id],
      excludedBuildListEntries: [],
      currentConflicts: [{
        id: persistedConflict.id,
        buildListEntryIds: [entry.id],
        checkpointParticipants: [],
      }],
    },
  }
}

function plannerClient(
  prepareInteraction: PlannerWorkerClient['prepareInteraction'],
  createWhatIfComparison: PlannerWorkerClient['createWhatIfComparison'] =
    async () => ({
      status: 'completed',
      comparison: {
        conflictKey: 'conflict.fixture',
        fixedBuildListEntryId: buildListEntryId('build-list.fixture'),
        fixedTargetWeaponId: targetWeaponId('target.fixture'),
        alternatives: [],
      },
    }),
): PlannerWorkerClient {
  return {
    engineVersion: PRODUCTION_RNG_ENGINE_VERSION,
    createPlan: vi.fn(),
    createConstrainedPlan: vi.fn(),
    createWhatIfComparison: vi.fn(createWhatIfComparison),
    createPlannerAlternativeComparison: vi.fn(),
    prepareInteraction: vi.fn(prepareInteraction),
    cancelPlan: vi.fn(),
    dispose: vi.fn(),
  }
}

function multiParticipantFixture() {
  const fixture = pageFixture('multi')
  const secondEntry = structuredClone(fixture.entry)
  const secondTarget = structuredClone(fixture.target)
  secondEntry.id = buildListEntryId('build-list.page.multi.second')
  secondEntry.targetWeaponId = targetWeaponId('target.page.multi.second')
  secondEntry.candidateSnapshot.targetWeaponId = secondEntry.targetWeaponId
  secondTarget.id = secondEntry.targetWeaponId
  secondTarget.name = 'Page fixture target multi second'
  fixture.input.buildListEntries.push(secondEntry)
  fixture.input.targetWeapons.push(secondTarget)
  fixture.plan.conflicts[0].buildListEntryIds.push(secondEntry.id)
  fixture.preparation = {
    status: 'ready',
    validBuildListEntryIds: [fixture.entry.id, secondEntry.id],
    excludedBuildListEntries: [],
    currentConflicts: [{
      id: fixture.plan.conflicts[0].id,
      buildListEntryIds: [fixture.entry.id, secondEntry.id],
      checkpointParticipants: [],
    }],
  }
  return { ...fixture, secondEntry, secondTarget }
}

function completedWhatIf(
  fixedBuildListEntryId: BuildListEntry['id'],
  alternativeTarget: TargetWeapon,
  operationCount: number,
): Extract<PlannerWhatIfCalculationResult, { status: 'completed' }> {
  return {
    status: 'completed',
    comparison: {
      conflictKey: 'conflict.completed',
      fixedBuildListEntryId,
      fixedTargetWeaponId: targetWeaponId('target.fixed'),
      alternatives: [{
        targetWeaponId: alternativeTarget.id,
        outcome: {
          status: 'found',
          distance: {
            estimatedOperationCount: operationCount,
            estimatedGogmaAdvance: 2,
            estimatedSkillAdvance: 1,
            estimatedNormalAdvance: null,
          },
        },
      }],
    },
  }
}

function dependencies(
  fixture = pageFixture(),
  client = plannerClient(async () => fixture.preparation),
): ProductionPlanPageDependencies {
  return {
    master: createValidMasterDataFixture(),
    currentCalculationContext: { ...fixture.plan.calculationContext },
    getPlan: vi.fn(async () => fixture.plan),
    getTargetWeapons: vi.fn(async () => [fixture.target]),
    createInput: vi.fn(async () => fixture.input),
    createWorkerClient: vi.fn(() => client),
    inspectPlannerResultSave: vi.fn(async () => ({ approvalRequired: false as const })),
    savePlannerResult: vi.fn(async () => ({ kind: 'no_plan' as const })),
    inspectProductionPlanStart: vi.fn(async (planId) => ({
      planId,
      changes: [],
      ownedWeapons: [],
      targetWeapons: [],
    })),
    startProductionPlan: vi.fn(async () => {
      throw new Error('startProductionPlan is not expected in this test')
    }),
    replan: unusedReplanDependencies(),
  }
}

function renderPage(
  deps: ProductionPlanPageDependencies,
  planId: string,
) {
  const router = createMemoryRouter([
    {
      path: '/plans/:planId',
      element: <ProductionPlanPage dependencies={deps} />,
    },
    { path: '/build-list', element: <div>Build list destination</div> },
    { path: '/plans', element: <div>Production plan list destination</div> },
    { path: '/plans/:planId/run', element: <div>Execution navigator destination</div> },
  ], { initialEntries: [`/plans/${planId}`] })
  return { router, ...render(<RouterProvider router={router} />) }
}

/**
 * The value shown for one label of the Plan overview (`計画の概要`): the
 * overview is a `dl`, so the value is the `dd` following the label's `dt`.
 */
function summaryValue(label: string): string | null | undefined {
  return screen.getByText(label).nextElementSibling?.textContent
}

describe('ProductionPlanPage', () => {
  it('offers a way back to the Production Plan list without touching the Plan state', async () => {
    const user = userEvent.setup()
    const fixture = pageFixture()
    const client = plannerClient(async () => fixture.preparation)
    const deps = dependencies(fixture, client)
    const { router } = renderPage(deps, fixture.plan.id)

    expect(await screen.findByText(fixture.target.name)).toBeInTheDocument()
    const link = screen.getByRole('link', { name: '生産計画一覧へ' })
    expect(link).toHaveAttribute('href', '/plans')
    await user.click(link)
    expect(router.state.location.pathname).toBe('/plans')
    expect(await screen.findByText('Production plan list destination')).toBeInTheDocument()
    expect(deps.savePlannerResult).not.toHaveBeenCalled()
    expect(deps.startProductionPlan).not.toHaveBeenCalled()
  })

  it('loads only the route Plan and prepares a fresh input with explicit selections', async () => {
    const fixture = pageFixture()
    const client = plannerClient(async () => fixture.preparation)
    const deps = dependencies(fixture, client)
    const oldCachedInput = structuredClone(fixture.input)

    renderPage(deps, fixture.plan.id)

    expect(await screen.findByText(fixture.target.name)).toBeInTheDocument()
    expect(deps.getPlan).toHaveBeenCalledExactlyOnceWith(fixture.plan.id)
    expect(deps.createInput).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      rngEngineVersion: client.engineVersion,
    }))
    expect(client.prepareInteraction).toHaveBeenCalledOnce()
    const [, preparedInput] = vi.mocked(client.prepareInteraction).mock.calls[0]
    expect(preparedInput).not.toBe(oldCachedInput)
    expect(preparedInput).not.toBe(fixture.input)
    expect(preparedInput.conflictResolutions).toEqual([{
      conflictKey: fixture.plan.conflicts[0].id,
      selectedBuildListEntryId: fixture.entry.id,
    }])
    expect(fixture.input.conflictResolutions).toEqual([])
    expect(screen.getByText('Planner推奨')).toBeInTheDocument()
    expect(screen.getByText('現在選択中')).toBeInTheDocument()
    expect(screen.getByText('利用可能')).toBeInTheDocument()
    expect(client.createWhatIfComparison).not.toHaveBeenCalled()
    expect(client.createConstrainedPlan).not.toHaveBeenCalled()
  })

  it('shows not-found without preparing another or inferred Plan', async () => {
    const fixture = pageFixture()
    const client = plannerClient(async () => fixture.preparation)
    const deps = dependencies(fixture, client)
    vi.mocked(deps.getPlan).mockResolvedValue(undefined)

    renderPage(deps, 'plan.route.missing')

    expect(await screen.findByText('指定された生産計画が見つかりません。'))
      .toBeInTheDocument()
    expect(deps.getPlan).toHaveBeenCalledExactlyOnceWith('plan.route.missing')
    expect(deps.createInput).not.toHaveBeenCalled()
    expect(client.prepareInteraction).not.toHaveBeenCalled()
  })

  it('renders typed invalid issues and warnings while all participants are unavailable', async () => {
    const fixture = pageFixture()
    const invalid: PlannerInteractionPreparationResult = {
      status: 'invalid',
      issues: [{
        path: 'fixture',
        code: 'invalid_integer',
        message: 'Typed fixture issue',
      }],
      warnings: [{
        kind: 'build_list_entry_stale',
        message: 'Typed fixture warning',
      }],
      excludedBuildListEntries: [],
    }
    const deps = dependencies(
      fixture,
      plannerClient(async () => invalid),
    )

    renderPage(deps, fixture.plan.id)

    expect(await screen.findByText('Typed fixture issue')).toBeInTheDocument()
    expect(screen.getByText('Typed fixture warning')).toBeInTheDocument()
    expect(screen.getByText('利用不可')).toBeInTheDocument()
    expect(screen.getByText(/Planner入力を準備できない/)).toBeInTheDocument()
  })

  it('shows the Planner exclusion reason before a missing current Conflict reason', async () => {
    const fixture = pageFixture()
    const excludedReason = 'CalculationContextが現在の環境と互換ではありません。'
    const excluded: PlannerInteractionPreparationResult = {
      status: 'ready',
      validBuildListEntryIds: [],
      excludedBuildListEntries: [{
        buildListEntryId: fixture.entry.id,
        reason: excludedReason,
      }],
      currentConflicts: [],
    }
    const deps = dependencies(
      fixture,
      plannerClient(async () => excluded),
    )

    renderPage(deps, fixture.plan.id)

    expect(await screen.findByText(excludedReason)).toBeInTheDocument()
    expect(screen.queryByText('現在のPlanner入力ではこの競合を再現できません。'))
      .not.toBeInTheDocument()
  })

  it('cancels an active request and disposes its Worker Client on unmount', async () => {
    const fixture = pageFixture()
    const pending = deferred<PlannerInteractionPreparationResult>()
    const client = plannerClient(() => pending.promise)
    const deps = dependencies(fixture, client)
    const view = renderPage(deps, fixture.plan.id)

    await waitFor(() => expect(client.prepareInteraction).toHaveBeenCalledOnce())
    const [requestId] = vi.mocked(client.prepareInteraction).mock.calls[0]
    view.unmount()

    expect(client.cancelPlan).toHaveBeenCalledExactlyOnceWith(requestId)
    expect(client.dispose).toHaveBeenCalledOnce()
    pending.resolve(fixture.preparation)
  })

  it('ignores an old route result after planId changes', async () => {
    const first = pageFixture('first')
    const second = pageFixture('second')
    const firstPending = deferred<PlannerInteractionPreparationResult>()
    const firstClient = plannerClient(() => firstPending.promise)
    const secondClient = plannerClient(async () => second.preparation)
    const deps = dependencies(first, firstClient)
    vi.mocked(deps.getPlan).mockImplementation(async (id) =>
      id === first.plan.id ? first.plan : second.plan)
    vi.mocked(deps.createInput)
      .mockResolvedValueOnce(first.input)
      .mockResolvedValueOnce(second.input)
    vi.mocked(deps.createWorkerClient)
      .mockReturnValueOnce(firstClient)
      .mockReturnValueOnce(secondClient)
    const view = renderPage(deps, first.plan.id)
    await waitFor(() => expect(firstClient.prepareInteraction).toHaveBeenCalledOnce())

    await view.router.navigate(`/plans/${second.plan.id}`)
    expect(await screen.findByText(second.target.name)).toBeInTheDocument()
    firstPending.resolve(first.preparation)
    await waitFor(() => {
      expect(screen.queryByText(first.target.name)).not.toBeInTheDocument()
    })
    expect(firstClient.cancelPlan).toHaveBeenCalledOnce()
    expect(firstClient.dispose).toHaveBeenCalledOnce()
  })

  it('ignores an old Plan load result after planId changes', async () => {
    const first = pageFixture('load-first')
    const second = pageFixture('load-second')
    const firstLoad = deferred<ProductionPlan | undefined>()
    const secondClient = plannerClient(async () => second.preparation)
    const deps = dependencies(second, secondClient)
    vi.mocked(deps.getPlan).mockImplementation((id) =>
      id === first.plan.id ? firstLoad.promise : Promise.resolve(second.plan))
    vi.mocked(deps.createInput).mockResolvedValue(second.input)
    const view = renderPage(deps, first.plan.id)

    await view.router.navigate(`/plans/${second.plan.id}`)
    expect(await screen.findByText(second.target.name)).toBeInTheDocument()
    firstLoad.resolve(first.plan)
    await waitFor(() => {
      expect(screen.queryByText(first.target.name)).not.toBeInTheDocument()
    })
    expect(deps.createInput).toHaveBeenCalledOnce()
    expect(secondClient.prepareInteraction).toHaveBeenCalledOnce()
    // The abandoned first load never reached Worker creation, so that
    // lifecycle has no Client to cancel or dispose.
    expect(deps.createWorkerClient).toHaveBeenCalledOnce()
  })

  it('renders an unexpected Worker error separately from typed invalid', async () => {
    const fixture = pageFixture()
    const deps = dependencies(
      fixture,
      plannerClient(async () => {
        throw new Error('Unexpected preparation failure')
      }),
    )

    renderPage(deps, fixture.plan.id)

    expect(await screen.findByText('Unexpected preparation failure'))
      .toBeInTheDocument()
    expect(screen.queryByText(/現在の入力では競合を準備できません/))
      .not.toBeInTheDocument()
  })

  it('does not display Planner cancellation as an unexpected error', async () => {
    const fixture = pageFixture()
    const deps = dependencies(
      fixture,
      plannerClient(async () => {
        throw new PlannerCancelledError()
      }),
    )

    renderPage(deps, fixture.plan.id)

    expect(await screen.findByText('現在の保存状態から操作可否を確認しています。'))
      .toBeInTheDocument()
    expect(screen.queryByText('Planner calculation was cancelled.'))
      .not.toBeInTheDocument()
  })

  it('fails closed instead of using an incompatible saved Plan snapshot as current input', async () => {
    const fixture = pageFixture()
    fixture.plan.baseSnapshot.calculationContext = {
      gameVersion: 'old-game',
      masterDataVersion: -1,
      rngEngineVersion: 'old-engine',
      appSchemaVersion: -1,
    }
    const client = plannerClient(async () => fixture.preparation)
    const deps = dependencies(fixture, client)

    renderPage(deps, fixture.plan.id)
    expect(await screen.findByText(
      'この生産計画は現在の計算契約と互換性がありません。ビルドリストから再計算してください。',
    )).toBeInTheDocument()
    expect(deps.createWorkerClient).not.toHaveBeenCalled()
    expect(deps.createInput).not.toHaveBeenCalled()
  })

  it('rebuilds fresh input at click time and sends explicit resolutions, scenario and B9 defaults', async () => {
    const user = userEvent.setup()
    const fixture = pageFixture('fresh-click')
    const actionInput = structuredClone(fixture.input)
    const result = completedWhatIf(
      fixture.entry.id,
      fixture.target,
      12,
    )
    const pending = deferred<PlannerWhatIfCalculationResult>()
    const client = plannerClient(
      async () => fixture.preparation,
      // The Production Worker reports no progress (Issue #103 Phase D-2a).
      async () => pending.promise,
    )
    const deps = dependencies(fixture, client)
    vi.mocked(deps.createInput)
      .mockResolvedValueOnce(fixture.input)
      .mockResolvedValueOnce(actionInput)

    renderPage(deps, fixture.plan.id)
    const compare = await screen.findByRole('button', { name: '比較する' })
    const initialPreparedInput =
      vi.mocked(client.prepareInteraction).mock.calls[0][1]
    await user.click(compare)

    await waitFor(() => expect(client.createWhatIfComparison).toHaveBeenCalledOnce())
    // 「比較する」 stays on the legacy B9 path until Phase 5 switches the routing.
    expect(client.createPlannerAlternativeComparison).not.toHaveBeenCalled()
    expect(deps.createInput).toHaveBeenCalledTimes(2)
    expect(deps.createWorkerClient).toHaveBeenCalledOnce()
    expect(client.prepareInteraction).toHaveBeenCalledTimes(2)
    const actionPreparationRequestId =
      vi.mocked(client.prepareInteraction).mock.calls[1][0]
    const [, request] = vi.mocked(client.createWhatIfComparison).mock.calls[0]
    expect(vi.mocked(client.createWhatIfComparison).mock.calls[0][0])
      .not.toBe(actionPreparationRequestId)
    expect(request.plannerInput).not.toBe(initialPreparedInput)
    expect(request.plannerInput).not.toBe(fixture.input)
    expect(request.plannerInput.conflictResolutions).toEqual([{
      conflictKey: fixture.plan.conflicts[0].id,
      selectedBuildListEntryId: fixture.entry.id,
    }])
    expect(request.scenarioResolution).toEqual({
      conflictKey: fixture.plan.conflicts[0].id,
      selectedBuildListEntryId: fixture.entry.id,
    })
    expect(request.bounds).toEqual({
      maxCandidateTrialsPerTarget: 2,
      maxPlannerReruns: 8,
    })
    // Indeterminate (Issue #103 Phase D-1): the Worker progress never
    // becomes a ratio.
    expect(screen.getByText('比較しています…')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'what-if比較中' })).not.toHaveAttribute('aria-valuenow')
    expect(screen.queryByText(/比較中 3 \/ 8/)).not.toBeInTheDocument()

    pending.resolve(result)
    expect(await screen.findByText('必要操作数: 12')).toBeInTheDocument()
    expect(client.createConstrainedPlan).not.toHaveBeenCalled()
  })

  it('fails closed and refreshes availability when the current conflict disappears', async () => {
    const user = userEvent.setup()
    const fixture = pageFixture('availability')
    const unavailable: PlannerInteractionPreparationResult = {
      status: 'ready',
      validBuildListEntryIds: [fixture.entry.id],
      excludedBuildListEntries: [],
      currentConflicts: [],
    }
    const client = plannerClient(
      vi.fn()
        .mockResolvedValueOnce(fixture.preparation)
        .mockResolvedValueOnce(unavailable),
    )
    const deps = dependencies(fixture, client)

    renderPage(deps, fixture.plan.id)
    await user.click(await screen.findByRole('button', { name: '比較する' }))

    expect(await screen.findByText(
      '現在の状態が変化したため比較を開始できませんでした。',
    )).toBeInTheDocument()
    expect(screen.getByText('現在のPlanner入力ではこの競合を再現できません。'))
      .toBeInTheDocument()
    expect(screen.getByRole('button', { name: '比較する' })).toBeDisabled()
    expect(client.createWhatIfComparison).not.toHaveBeenCalled()
  })

  it('fails closed with the typed invalid preparation at action time', async () => {
    const user = userEvent.setup()
    const fixture = pageFixture('action-invalid')
    const invalid: PlannerInteractionPreparationResult = {
      status: 'invalid',
      issues: [{
        path: 'action.input',
        code: 'invalid_integer',
        message: 'Action-time typed issue',
      }],
      warnings: [],
      excludedBuildListEntries: [],
    }
    const client = plannerClient(
      vi.fn()
        .mockResolvedValueOnce(fixture.preparation)
        .mockResolvedValueOnce(invalid),
    )
    const deps = dependencies(fixture, client)

    renderPage(deps, fixture.plan.id)
    await user.click(await screen.findByRole('button', { name: '比較する' }))

    expect(await screen.findByText('Action-time typed issue')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '比較する' })).toBeDisabled()
    expect(client.createWhatIfComparison).not.toHaveBeenCalled()
  })

  it('cancels participant A and ignores its late result after switching to B', async () => {
    const user = userEvent.setup()
    const fixture = multiParticipantFixture()
    const firstPending = deferred<PlannerWhatIfCalculationResult>()
    const secondPending = deferred<PlannerWhatIfCalculationResult>()
    const client = plannerClient(
      async () => fixture.preparation,
      vi.fn()
        .mockImplementationOnce(() => firstPending.promise)
        .mockImplementationOnce(() => secondPending.promise),
    )
    const deps = dependencies(fixture, client)

    renderPage(deps, fixture.plan.id)
    const buttons = await screen.findAllByRole('button', { name: '比較する' })
    await user.click(buttons[0])
    await waitFor(() => expect(client.createWhatIfComparison).toHaveBeenCalledTimes(1))
    const firstRequestId =
      vi.mocked(client.createWhatIfComparison).mock.calls[0][0]
    await user.click(screen.getAllByRole('button', { name: '比較する' })[1])
    await waitFor(() => expect(client.createWhatIfComparison).toHaveBeenCalledTimes(2))
    expect(deps.createInput).toHaveBeenCalledTimes(3)
    expect(deps.createWorkerClient).toHaveBeenCalledOnce()
    expect(client.cancelPlan).toHaveBeenCalledWith(firstRequestId)

    secondPending.resolve(
      completedWhatIf(fixture.secondEntry.id, fixture.target, 22),
    )
    expect(await screen.findByText('必要操作数: 22')).toBeInTheDocument()
    const [, secondRequest] =
      vi.mocked(client.createWhatIfComparison).mock.calls[1]
    expect(secondRequest.plannerInput.conflictResolutions).toEqual([{
      conflictKey: fixture.plan.conflicts[0].id,
      selectedBuildListEntryId: fixture.entry.id,
    }])
    expect(secondRequest.scenarioResolution).toEqual({
      conflictKey: fixture.plan.conflicts[0].id,
      selectedBuildListEntryId: fixture.secondEntry.id,
    })
    firstPending.resolve(
      completedWhatIf(fixture.entry.id, fixture.secondTarget, 11),
    )
    await waitFor(() => {
      expect(screen.queryByText('必要操作数: 11')).not.toBeInTheDocument()
    })
    expect(screen.getByText('必要操作数: 22')).toBeInTheDocument()
  })

  it('cancels a loading comparison without showing a failure or late result', async () => {
    const user = userEvent.setup()
    const fixture = pageFixture('cancel')
    const pending = deferred<PlannerWhatIfCalculationResult>()
    const client = plannerClient(
      async () => fixture.preparation,
      async () => pending.promise,
    )
    const deps = dependencies(fixture, client)

    renderPage(deps, fixture.plan.id)
    await user.click(await screen.findByRole('button', { name: '比較する' }))
    const cancel = await screen.findByRole('button', {
      name: '比較をキャンセル',
    })
    const requestId = vi.mocked(client.createWhatIfComparison).mock.calls[0][0]
    await user.click(cancel)

    expect(client.cancelPlan).toHaveBeenCalledWith(requestId)
    expect(screen.queryByRole('button', { name: '比較をキャンセル' }))
      .not.toBeInTheDocument()
    expect(screen.queryByText(/比較処理に失敗しました/)).not.toBeInTheDocument()
    pending.resolve(completedWhatIf(fixture.entry.id, fixture.target, 99))
    await waitFor(() => {
      expect(screen.queryByText('必要操作数: 99')).not.toBeInTheDocument()
    })
  })

  it('does not start stale A Worker work when A createInput resolves after B starts', async () => {
    const user = userEvent.setup()
    const fixture = multiParticipantFixture()
    const firstActionInput = deferred<PlannerInput>()
    const client = plannerClient(async () => fixture.preparation)
    const deps = dependencies(fixture, client)
    vi.mocked(deps.createInput)
      .mockResolvedValueOnce(fixture.input)
      .mockImplementationOnce(() => firstActionInput.promise)
      .mockResolvedValueOnce(structuredClone(fixture.input))

    renderPage(deps, fixture.plan.id)
    const buttons = await screen.findAllByRole('button', { name: '比較する' })
    await user.click(buttons[0])
    await waitFor(() => expect(deps.createInput).toHaveBeenCalledTimes(2))
    await user.click(screen.getAllByRole('button', { name: '比較する' })[1])
    await waitFor(() => expect(client.createWhatIfComparison).toHaveBeenCalledOnce())
    firstActionInput.resolve(structuredClone(fixture.input))

    await waitFor(() => {
      expect(client.prepareInteraction).toHaveBeenCalledTimes(2)
    })
    expect(client.createWhatIfComparison).toHaveBeenCalledOnce()
    const [, request] = vi.mocked(client.createWhatIfComparison).mock.calls[0]
    expect(request.scenarioResolution.selectedBuildListEntryId)
      .toBe(fixture.secondEntry.id)
  })

  it('cancels and disposes an active what-if request on unmount', async () => {
    const user = userEvent.setup()
    const fixture = pageFixture('what-if-unmount')
    const pending = deferred<PlannerWhatIfCalculationResult>()
    const client = plannerClient(
      async () => fixture.preparation,
      async () => pending.promise,
    )
    const deps = dependencies(fixture, client)
    const view = renderPage(deps, fixture.plan.id)

    await user.click(await screen.findByRole('button', { name: '比較する' }))
    await waitFor(() => expect(client.createWhatIfComparison).toHaveBeenCalledOnce())
    const requestId = vi.mocked(client.createWhatIfComparison).mock.calls[0][0]
    view.unmount()

    expect(client.cancelPlan).toHaveBeenCalledWith(requestId)
    expect(client.dispose).toHaveBeenCalledOnce()
    pending.resolve(completedWhatIf(fixture.entry.id, fixture.target, 44))
  })

  it('cancels an active what-if and ignores its late result after planId changes', async () => {
    const user = userEvent.setup()
    const first = pageFixture('what-if-route-first')
    const second = pageFixture('what-if-route-second')
    const pending = deferred<PlannerWhatIfCalculationResult>()
    const firstClient = plannerClient(
      async () => first.preparation,
      async () => pending.promise,
    )
    const secondClient = plannerClient(async () => second.preparation)
    const deps = dependencies(first, firstClient)
    vi.mocked(deps.getPlan).mockImplementation(async (id) =>
      id === first.plan.id ? first.plan : second.plan)
    vi.mocked(deps.createInput).mockImplementation(async () =>
      structuredClone(
        vi.mocked(deps.getPlan).mock.calls.at(-1)?.[0] === first.plan.id
          ? first.input
          : second.input,
      ))
    vi.mocked(deps.createWorkerClient)
      .mockReturnValueOnce(firstClient)
      .mockReturnValueOnce(secondClient)
    const view = renderPage(deps, first.plan.id)

    await user.click(await screen.findByRole('button', { name: '比較する' }))
    await waitFor(() => expect(firstClient.createWhatIfComparison).toHaveBeenCalledOnce())
    const requestId =
      vi.mocked(firstClient.createWhatIfComparison).mock.calls[0][0]
    await view.router.navigate(`/plans/${second.plan.id}`)

    expect(await screen.findByText(second.target.name)).toBeInTheDocument()
    expect(firstClient.cancelPlan).toHaveBeenCalledWith(requestId)
    expect(firstClient.dispose).toHaveBeenCalledOnce()
    pending.resolve(completedWhatIf(first.entry.id, first.target, 55))
    await waitFor(() => {
      expect(screen.queryByText('必要操作数: 55')).not.toBeInTheDocument()
    })
  })

  it('shows an unexpected action error separately from typed what-if failures', async () => {
    const user = userEvent.setup()
    const fixture = pageFixture('action-error')
    const client = plannerClient(async () => fixture.preparation)
    const deps = dependencies(fixture, client)
    vi.mocked(deps.createInput)
      .mockResolvedValueOnce(fixture.input)
      .mockRejectedValueOnce(new Error('Fresh input failed'))

    renderPage(deps, fixture.plan.id)
    await user.click(await screen.findByRole('button', { name: '比較する' }))

    expect(await screen.findByText(
      '比較処理に失敗しました。Fresh input failed',
    )).toBeInTheDocument()
    expect(screen.queryByText('Planner入力を準備できませんでした'))
      .not.toBeInTheDocument()
    expect(client.createWhatIfComparison).not.toHaveBeenCalled()
  })
})


function replanResult(plan: ProductionPlan | null = null): PlannerOrchestrationResult {
  return {
    plan,
    conflicts: [],
    warnings: [],
    termination: completedPlannerTermination(),
    generatedBuildListEntries: [],
    generatedBuildListEntryReplacements: [],
  }
}

async function clickSelection(user: ReturnType<typeof userEvent.setup>, index = 0) {
  const buttons = await screen.findAllByRole('button', { name: 'この候補を優先' })
  expect(buttons[index]).toBeEnabled()
  await user.click(buttons[index])
}

describe('ProductionPlanPage explicit selection', () => {
  it('selects without comparison, prepares fresh input before immutable merge, and explicitly passes 2/1/4', async () => {
    const user = userEvent.setup()
    const fixture = multiParticipantFixture()
    const other = { ...fixture.plan.conflicts[0], id: 'conflict.other' }
    const recommendationOnly = { ...other, id: 'conflict.recommendation', selectedBuildListEntryId: null }
    fixture.plan.conflicts.push(other, recommendationOnly)
    const fresh = structuredClone(fixture.input)
    fresh.rngState.notes = 'selection-time state'
    const beforePlan = structuredClone(fixture.plan)
    const beforeInput = structuredClone(fresh)
    const client = plannerClient(async () => fixture.preparation)
    const result = replanResult()
    vi.mocked(client.createConstrainedPlan).mockResolvedValue(result)
    const deps = dependencies(fixture, client)
    vi.mocked(deps.createInput).mockResolvedValueOnce(fixture.input).mockResolvedValueOnce(fresh)
    renderPage(deps, fixture.plan.id)
    await clickSelection(user, 1)
    await waitFor(() => expect(deps.savePlannerResult).toHaveBeenCalledOnce())
    expect(deps.createInput).toHaveBeenCalledTimes(2)
    const prepared = vi.mocked(client.prepareInteraction).mock.calls[1][1]
    expect(prepared.rngState).toBe(fresh.rngState)
    expect(prepared).not.toBe(vi.mocked(client.prepareInteraction).mock.calls[0][1])
    expect(prepared.conflictResolutions).toEqual([
      { conflictKey: fixture.plan.conflicts[0].id, selectedBuildListEntryId: fixture.entry.id },
      { conflictKey: other.id, selectedBuildListEntryId: fixture.entry.id },
    ])
    const [, merged, bounds] = vi.mocked(client.createConstrainedPlan).mock.calls[0]
    expect(merged).not.toBe(prepared)
    expect(merged.conflictResolutions).toEqual([
      { conflictKey: fixture.plan.conflicts[0].id, selectedBuildListEntryId: fixture.secondEntry.id },
      { conflictKey: other.id, selectedBuildListEntryId: fixture.entry.id },
    ])
    expect(bounds).toEqual({ maxCandidateTrialsPerConflict: 2, maxGeneratedBuildListEntries: 1, maxPlannerReruns: 4 })
    expect(client.createWhatIfComparison).not.toHaveBeenCalled()
    expect(client.createPlan).not.toHaveBeenCalled()
    expect(fresh).toEqual(beforeInput)
    expect(fixture.plan).toEqual(beforePlan)
    expect(vi.mocked(deps.savePlannerResult).mock.calls[0][0]).toBe(result)
  })

  it.each([true, false])('CRITICAL: invalid warning prevents every save even with non-null plan=%s', async (hasPlan) => {
    const user = userEvent.setup()
    const fixture = pageFixture()
    const before = structuredClone(fixture.plan)
    const client = plannerClient(async () => fixture.preparation)
    const result = replanResult(hasPlan ? createValidProductionPlan() : null)
    result.generatedBuildListEntries = [createValidBuildListEntry()]
    result.warnings = [{ kind: 'invalid_conflict_resolution', message: hasPlan ? 'Arbitrary unrelated diagnostic 123' : '完全に異なる文言' }]
    vi.mocked(client.createConstrainedPlan).mockResolvedValue(result)
    const deps = dependencies(fixture, client)
    const view = renderPage(deps, fixture.plan.id)
    const navigate = vi.spyOn(view.router, 'navigate')
    await clickSelection(user)
    expect(await screen.findByText(/ユーザーが選択した競合候補を現在の状態では固定できませんでした/)).toBeInTheDocument()
    expect(deps.savePlannerResult).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
    expect(view.router.state.location.pathname).toBe('/plans/' + fixture.plan.id)
    expect(summaryValue('計画ID')).toBe(fixture.plan.id)
    expect(fixture.plan).toEqual(before)
    expect(client.createConstrainedPlan).toHaveBeenCalledOnce()
    expect(client.createPlan).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'この候補を優先' })).toBeEnabled()
  })

  it('saves the full result with a rebuilt current context and navigates only to the saved Plan, then reloads', async () => {
    const user = userEvent.setup()
    const fixture = pageFixture()
    const next = pageFixture('saved')
    const pending = deferred<PlannerOrchestrationResult>()
    const client = plannerClient(async () => fixture.preparation)
    vi.mocked(client.createConstrainedPlan).mockReturnValue(pending.promise)
    const deps = dependencies(fixture, client)
    vi.mocked(deps.getPlan).mockImplementation(async id => id === next.plan.id ? next.plan : fixture.plan)
    vi.mocked(deps.savePlannerResult).mockResolvedValue({ kind: 'saved', plan: next.plan })
    const view = renderPage(deps, fixture.plan.id)
    await clickSelection(user)
    await waitFor(() => expect(client.createConstrainedPlan).toHaveBeenCalledOnce())
    const startContext = vi.mocked(deps.createInput).mock.calls[1][0]
    deps.master.manifest.dataVersion += 1
    const result = replanResult({ ...fixture.plan, id: productionPlanId('plan.worker-only') })
    result.generatedBuildListEntries = [createValidBuildListEntry()]
    // A message resembling an invalid warning is not an invalid typed kind.
    result.warnings = [{ kind: 'max_steps_reached', message: 'invalid_conflict_resolution' }]
    await act(async () => pending.resolve(result))
    await waitFor(() => expect(view.router.state.location.pathname).toBe('/plans/' + next.plan.id))
    expect(deps.savePlannerResult).toHaveBeenCalledOnce()
    const [savedResult, saveContext] = vi.mocked(deps.savePlannerResult).mock.calls[0]
    expect(savedResult).toBe(result)
    expect(saveContext).not.toBe(startContext)
    expect(saveContext.masterDataVersion).toBe(startContext.masterDataVersion + 1)
    expect(saveContext.rngEngineVersion).toBe(client.engineVersion)
    expect(deps.getPlan).toHaveBeenCalledWith(next.plan.id)
    await waitFor(() => expect(summaryValue('計画ID')).toBe(next.plan.id))
  })

  it('sends a replacement that breaks the active Plan through the shared warning, saving only with the approval', async () => {
    // A generated Entry replacing an Entry the active Plan depends on
    // (`docs/PLANNER_SPEC.md` 9.2.18 / 16.6): the runtime's inspection alone
    // asks for the warning, and the save is re-run with the approval it built.
    const user = userEvent.setup()
    const fixture = pageFixture()
    const next = pageFixture('saved')
    const client = plannerClient(async () => fixture.preparation)
    const result = replanResult({ ...fixture.plan, id: productionPlanId('plan.worker-only') })
    vi.mocked(client.createConstrainedPlan).mockResolvedValue(result)
    const deps = dependencies(fixture, client)
    vi.mocked(deps.getPlan).mockImplementation(async id => id === next.plan.id ? next.plan : fixture.plan)
    const observedPlan = {
      planId: productionPlanId('plan.active.elsewhere'),
      status: 'active' as const,
      currentStepId: null,
      updatedAt: '2026-09-20T00:00:00.000Z',
    }
    vi.mocked(deps.inspectPlannerResultSave).mockResolvedValue({
      approvalRequired: true,
      reasons: ['build_list_changed'],
      observedPlan,
      savePointChoiceRequired: false,
    })
    vi.mocked(deps.savePlannerResult).mockResolvedValue({ kind: 'saved', plan: next.plan })
    const view = renderPage(deps, fixture.plan.id)

    // Cancel: nothing is saved.
    await clickSelection(user)
    let warning = await screen.findByRole('dialog', { name: '実行中の生産計画があります' })
    expect(within(warning).getByText('生産計画が使用する作成リスト項目が変わります')).toBeInTheDocument()
    await user.click(within(warning).getByRole('button', { name: 'キャンセル' }))
    expect(await screen.findByText('保存を取り消しました。生産計画と作成リストは変更されていません。')).toBeInTheDocument()
    expect(deps.savePlannerResult).not.toHaveBeenCalled()
    expect(view.router.state.location.pathname).toBe('/plans/' + fixture.plan.id)

    // Approve: the same result is saved with the inspection's own token.
    await clickSelection(user)
    warning = await screen.findByRole('dialog', { name: '実行中の生産計画があります' })
    await user.click(within(warning).getByRole('button', { name: '生産計画を破棄して保存' }))
    await waitFor(() => expect(view.router.state.location.pathname).toBe('/plans/' + next.plan.id))
    expect(deps.savePlannerResult).toHaveBeenCalledOnce()
    const [savedResult, , approval] = vi.mocked(deps.savePlannerResult).mock.calls[0]
    expect(savedResult).toBe(result)
    expect(approval).toEqual({ observedPlan, savePointDecision: null })
  })

  it('restores the save point instead of saving a pre-restore result, and asks for a new calculation', async () => {
    // 「最後のゲーム内セーブ地点へ戻す」 for a Planner result save: the runtime
    // restores and drops the result (`docs/PLANNER_SPEC.md` 9.2.18 / 16.10).
    // The page reports a finished restore, never an error, and opens no Draft.
    const user = userEvent.setup()
    const fixture = pageFixture()
    const client = plannerClient(async () => fixture.preparation)
    const result = replanResult({ ...fixture.plan, id: productionPlanId('plan.worker-only') })
    vi.mocked(client.createConstrainedPlan).mockResolvedValue(result)
    const deps = dependencies(fixture, client)
    const observedPlan = {
      planId: productionPlanId('plan.active.elsewhere'),
      status: 'active' as const,
      currentStepId: null,
      updatedAt: '2026-09-20T00:00:00.000Z',
    }
    const recordedAt = '2026-09-19T00:00:00.000Z'
    vi.mocked(deps.inspectPlannerResultSave).mockResolvedValue({
      approvalRequired: true,
      reasons: ['build_list_changed'],
      observedPlan,
      savePointChoiceRequired: true,
      savePointRecordedAt: recordedAt,
      savePointLastExecutionHistoryId: null,
      savePointCurrentStepId: null,
    })
    vi.mocked(deps.savePlannerResult).mockResolvedValue({
      kind: 'save_point_restored_recalculation_required',
      restoredPlan: { ...fixture.plan, id: observedPlan.planId, status: 'active' },
      savePoint: {} as never,
      deletedExecutionHistoryIds: [],
    })
    const view = renderPage(deps, fixture.plan.id)

    await clickSelection(user)
    let warning = await screen.findByRole('dialog', { name: '実行中の生産計画があります' })
    await user.click(within(warning).getByRole('button', { name: '生産計画を破棄して保存' }))
    warning = await screen.findByRole('dialog', { name: '実行中の生産計画があります' })
    // The choice tells the user a restore drops this result and ends no Plan.
    expect(within(warning).getByText(/この変更は保存しません。生産計画は破棄されず/)).toBeInTheDocument()
    await user.click(within(warning).getByRole('button', { name: '最後のゲーム内セーブ地点へ戻す' }))
    const restore = await screen.findByRole('dialog', { name: '最後のゲーム内セーブ地点へ戻す' })
    expect(within(restore).getByText(/この変更（戻す前の状態で計算した結果）は保存しません/)).toBeInTheDocument()
    await user.click(within(restore).getByRole('checkbox', { name: 'ゲーム側を最後のゲーム内セーブ地点まで戻しました' }))
    await user.click(within(restore).getByRole('button', { name: 'アプリ側もセーブ地点へ戻す' }))

    expect(await screen.findByText(
      '最後のゲーム内セーブ地点へ戻しました。復元前の計算結果は保存していません。復元後の状態から、もう一度再計算してください。',
    )).toBeInTheDocument()
    expect(deps.savePlannerResult).toHaveBeenCalledOnce()
    const [savedResult, , approval] = vi.mocked(deps.savePlannerResult).mock.calls[0]
    expect(savedResult).toBe(result)
    expect(approval).toEqual({ observedPlan, savePointDecision: { kind: 'restore_save_point', recordedAt } })
    // No Draft is opened, and nothing is reported as a failure.
    expect(view.router.state.location.pathname).toBe('/plans/' + fixture.plan.id)
    expect(screen.queryByText('生産計画の再計算・保存に失敗しました。')).not.toBeInTheDocument()
    expect(vi.mocked(deps.getPlan).mock.calls.every(([id]) => id === fixture.plan.id)).toBe(true)
  })

  it('passes no-Plan results whole to Persistence and keeps the old Plan when save returns null', async () => {
    const user = userEvent.setup()
    const fixture = pageFixture()
    const client = plannerClient(async () => fixture.preparation)
    const result = replanResult()
    vi.mocked(client.createConstrainedPlan).mockResolvedValue(result)
    const deps = dependencies(fixture, client)
    const view = renderPage(deps, fixture.plan.id)
    await clickSelection(user)
    expect(await screen.findByText('現在の入力から新しい生産計画を作成できませんでした。')).toBeInTheDocument()
    expect(vi.mocked(deps.savePlannerResult).mock.calls[0][0]).toBe(result)
    expect(view.router.state.location.pathname).toBe('/plans/' + fixture.plan.id)
    expect(summaryValue('計画ID')).toBe(fixture.plan.id)
  })

  it.each(['planner', 'save', 'no-plan-with-entries'] as const)('keeps the old Plan on %s failure and allows explicit retry', async (failure) => {
    const user = userEvent.setup()
    const fixture = pageFixture()
    const before = structuredClone(fixture.plan)
    const client = plannerClient(async () => fixture.preparation)
    const result = replanResult(failure === 'no-plan-with-entries' ? null : createValidProductionPlan())
    result.generatedBuildListEntries = [createValidBuildListEntry()]
    vi.mocked(client.createConstrainedPlan).mockResolvedValue(result)
    const deps = dependencies(fixture, client)
    if (failure === 'planner') vi.mocked(client.createConstrainedPlan).mockRejectedValueOnce(new Error('Planner failed'))
    else vi.mocked(deps.savePlannerResult).mockRejectedValueOnce(new Error('Atomic save rejected'))
    const view = renderPage(deps, fixture.plan.id)
    await clickSelection(user)
    expect(await screen.findByText(failure === 'planner' ? 'Planner failed' : 'Atomic save rejected')).toBeInTheDocument()
    expect(view.router.state.location.pathname).toBe('/plans/' + fixture.plan.id)
    expect(summaryValue('計画ID')).toBe(fixture.plan.id)
    expect(fixture.plan).toEqual(before)
    expect(client.createConstrainedPlan).toHaveBeenCalledOnce()
    if (failure !== 'planner') expect(vi.mocked(deps.savePlannerResult).mock.calls[0][0]).toBe(result)
    await clickSelection(user)
    await waitFor(() => expect(client.createConstrainedPlan).toHaveBeenCalledTimes(2))
  })

  it.each(['unavailable', 'invalid'] as const)('refreshes action-time %s availability without starting Planner or save', async (status) => {
    const user = userEvent.setup()
    const fixture = pageFixture()
    const current: PlannerInteractionPreparationResult = status === 'invalid'
      ? { status: 'invalid', issues: [{ path: 'input', code: 'invalid_integer', message: 'Typed action invalid' }], warnings: [], excludedBuildListEntries: [] }
      : { status: 'ready', validBuildListEntryIds: [fixture.entry.id], excludedBuildListEntries: [], currentConflicts: [] }
    const client = plannerClient(vi.fn().mockResolvedValueOnce(fixture.preparation).mockResolvedValueOnce(current))
    const deps = dependencies(fixture, client)
    renderPage(deps, fixture.plan.id)
    await clickSelection(user)
    expect(await screen.findByText('現在の状態が変化したため再計算を開始できませんでした。')).toBeInTheDocument()
    expect(screen.getByText(status === 'invalid' ? 'Typed action invalid' : '現在のPlanner入力ではこの競合を再現できません。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'この候補を優先' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '比較する' })).toBeDisabled()
    expect(client.createConstrainedPlan).not.toHaveBeenCalled()
    expect(deps.savePlannerResult).not.toHaveBeenCalled()
  })

  it('shows an indeterminate running state, blocks comparisons and selections during rerun, and ignores results after cancel', async () => {
    const user = userEvent.setup()
    const fixture = pageFixture()
    const pending = deferred<PlannerOrchestrationResult>()
    const client = plannerClient(async () => fixture.preparation)
    vi.mocked(client.createConstrainedPlan).mockImplementation(async () => pending.promise)
    const deps = dependencies(fixture, client)
    const view = renderPage(deps, fixture.plan.id)
    await clickSelection(user)
    expect(await screen.findByText('再計算しています…')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Planner再計算中' })).not.toHaveAttribute('aria-valuenow')
    expect(screen.getByRole('button', { name: '比較する' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'この候補を優先' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '比較する' }))
    expect(client.createWhatIfComparison).not.toHaveBeenCalled()
    const [requestId] = vi.mocked(client.createConstrainedPlan).mock.calls[0]
    // No progress callback reaches the Client (Issue #103 Phase D-2a).
    expect(vi.mocked(client.createConstrainedPlan).mock.calls[0]).toHaveLength(3)
    await user.click(screen.getByRole('button', { name: '再計算をキャンセル' }))
    expect(client.cancelPlan).toHaveBeenCalledWith(requestId)
    await act(async () => {
      pending.resolve(replanResult(createValidProductionPlan()))
    })
    expect(deps.savePlannerResult).not.toHaveBeenCalled()
    expect(view.router.state.location.pathname).toBe('/plans/' + fixture.plan.id)
    expect(screen.queryByText('再計算しています…')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'この候補を優先' })).toBeEnabled()
  })

  it('does not display PlannerCancelledError as a failure', async () => {
    const user = userEvent.setup()
    const fixture = pageFixture()
    const client = plannerClient(async () => fixture.preparation)
    vi.mocked(client.createConstrainedPlan).mockRejectedValue(new PlannerCancelledError())
    const deps = dependencies(fixture, client)
    renderPage(deps, fixture.plan.id)
    await clickSelection(user)
    await waitFor(() => expect(screen.getByRole('button', { name: 'この候補を優先' })).toBeEnabled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(deps.savePlannerResult).not.toHaveBeenCalled()
  })

  it.each(['pending', 'failure', 'no-result', 'completed', 'input-pending'] as const)('selection is independent of what-if %s and starts from fresh input', async (mode) => {
    const user = userEvent.setup()
    const fixture = pageFixture()
    const pending = deferred<PlannerWhatIfCalculationResult>()
    const inputPending = deferred<PlannerInput>()
    const client = plannerClient(async () => fixture.preparation, () => pending.promise)
    vi.mocked(client.createConstrainedPlan).mockResolvedValue(replanResult())
    const deps = dependencies(fixture, client)
    if (mode === 'input-pending') vi.mocked(deps.createInput).mockResolvedValueOnce(fixture.input).mockReturnValueOnce(inputPending.promise).mockResolvedValue(fixture.input)
    renderPage(deps, fixture.plan.id)
    await user.click(await screen.findByRole('button', { name: '比較する' }))
    if (mode !== 'input-pending') await waitFor(() => expect(client.createWhatIfComparison).toHaveBeenCalledOnce())
    if (mode === 'failure') await act(async () => pending.resolve({ status: 'planner_input_not_ready', issues: [], warnings: [], excludedBuildListEntries: [] }))
    if (mode === 'completed' || mode === 'no-result') {
      const result = completedWhatIf(fixture.entry.id, fixture.target, 99)
      if (mode === 'no-result') result.comparison.alternatives[0].outcome = { status: 'not_found_within_search_extent' }
      await act(async () => pending.resolve(result))
    }
    await clickSelection(user)
    await waitFor(() => expect(client.createConstrainedPlan).toHaveBeenCalledOnce())
    expect(deps.createInput).toHaveBeenCalledTimes(3)
    if (mode === 'pending') expect(client.cancelPlan).toHaveBeenCalledWith(vi.mocked(client.createWhatIfComparison).mock.calls[0][0])
    await act(async () => {
      inputPending.resolve(fixture.input)
      pending.resolve(completedWhatIf(fixture.entry.id, fixture.target, 99))
    })
    expect(client.prepareInteraction).toHaveBeenCalledTimes(mode === 'input-pending' ? 2 : 3)
    expect(screen.queryByText('必要操作数: 99')).not.toBeInTheDocument()
    expect(screen.queryByText('比較しています…')).not.toBeInTheDocument()
    expect(deps.savePlannerResult).toHaveBeenCalledOnce()
  })

  it.each(['input', 'preparation', 'planner'] as const)('cancel during %s prevents all later UI effects and unstarted work', async (phase) => {
    const user = userEvent.setup()
    const fixture = pageFixture()
    const inputPending = deferred<PlannerInput>()
    const preparationPending = deferred<PlannerInteractionPreparationResult>()
    const plannerPending = deferred<PlannerOrchestrationResult>()
    const client = plannerClient(async () => fixture.preparation)
    vi.mocked(client.createConstrainedPlan).mockReturnValue(phase === 'planner' ? plannerPending.promise : Promise.resolve(replanResult(createValidProductionPlan())))
    const deps = dependencies(fixture, client)
    if (phase === 'input') vi.mocked(deps.createInput).mockResolvedValueOnce(fixture.input).mockReturnValueOnce(inputPending.promise)
    if (phase === 'preparation') vi.mocked(client.prepareInteraction).mockResolvedValueOnce(fixture.preparation).mockReturnValueOnce(preparationPending.promise)
    const view = renderPage(deps, fixture.plan.id)
    await clickSelection(user)
    await user.click(screen.getByRole('button', { name: '再計算をキャンセル' }))
    await act(async () => {
      inputPending.resolve(fixture.input)
      preparationPending.resolve(fixture.preparation)
      plannerPending.resolve(replanResult(createValidProductionPlan()))
    })
    if (phase === 'input') expect(client.prepareInteraction).toHaveBeenCalledOnce()
    if (phase === 'input' || phase === 'preparation') expect(client.createConstrainedPlan).not.toHaveBeenCalled()
    expect(deps.savePlannerResult).not.toHaveBeenCalled()
    expect(view.router.state.location.pathname).toBe('/plans/' + fixture.plan.id)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'この候補を優先' })).toBeEnabled()
  })

  it.each(['stale', 'active', 'completed', 'abandoned'] as const)('does not select a %s Plan', async (status) => {
    const fixture = pageFixture()
    fixture.plan.status = status
    const client = plannerClient(async () => fixture.preparation)
    const deps = dependencies(fixture, client)
    renderPage(deps, fixture.plan.id)
    const button = await screen.findByRole('button', { name: 'この候補を優先' })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    if (status === 'stale') {
      expect(deps.createInput).not.toHaveBeenCalled()
      expect(client.prepareInteraction).not.toHaveBeenCalled()
    }
    expect(client.createConstrainedPlan).not.toHaveBeenCalled()
    expect(deps.savePlannerResult).not.toHaveBeenCalled()
    expect(screen.getByRole('link', { name: 'ビルドリストへ戻る' })).toHaveAttribute('href', '/build-list')
  })
})


describe('ProductionPlanPage selection lifecycle races', () => {
  it.each([
    ['unmount', 'input'], ['unmount', 'preparation'], ['unmount', 'planner'], ['unmount', 'save'],
    ['route', 'input'], ['route', 'preparation'], ['route', 'planner'], ['route', 'save'],
    ['client', 'input'], ['client', 'preparation'], ['client', 'planner'], ['client', 'save'],
  ] as const)('ignores late %s / %s completion', async (change, phase) => {
    const user = userEvent.setup()
    const fixture = pageFixture('old')
    const next = pageFixture('next')
    const inputPending = deferred<PlannerInput>()
    const preparationPending = deferred<PlannerInteractionPreparationResult>()
    const plannerPending = deferred<PlannerOrchestrationResult>()
    const savePending = deferred<PlannerOrchestrationResultSaveOutcome>()
    const client = plannerClient(async () => fixture.preparation)
    vi.mocked(client.createConstrainedPlan).mockReturnValue(phase === 'planner' ? plannerPending.promise : Promise.resolve(replanResult(createValidProductionPlan())))
    const deps = dependencies(fixture, client)
    if (phase === 'input') vi.mocked(deps.createInput).mockResolvedValueOnce(fixture.input).mockReturnValueOnce(inputPending.promise)
    if (phase === 'preparation') vi.mocked(client.prepareInteraction).mockResolvedValueOnce(fixture.preparation).mockReturnValueOnce(preparationPending.promise)
    if (phase === 'save') vi.mocked(deps.savePlannerResult).mockReturnValue(savePending.promise)
    const nextClient = plannerClient(async () => next.preparation)
    const nextDeps = dependencies(next, nextClient)
    const router = createMemoryRouter([
      { path: '/plans/:planId', element: <ProductionPlanPage dependencies={deps} /> },
    ], { initialEntries: ['/plans/' + fixture.plan.id] })
    const view = render(<RouterProvider router={router} />)
    const navigate = vi.spyOn(router, 'navigate')
    await clickSelection(user)
    if (phase === 'save') await waitFor(() => expect(deps.savePlannerResult).toHaveBeenCalledOnce())
    if (phase === 'planner') await waitFor(() => expect(client.createConstrainedPlan).toHaveBeenCalledOnce())
    if (phase === 'preparation') await waitFor(() => expect(client.prepareInteraction).toHaveBeenCalledTimes(2))
    const requestId = phase === 'preparation'
      ? vi.mocked(client.prepareInteraction).mock.calls[1][0]
      : phase === 'planner' ? vi.mocked(client.createConstrainedPlan).mock.calls[0][0] : null
    if (change === 'unmount') view.unmount()
    else if (change === 'route') {
      vi.mocked(deps.getPlan).mockResolvedValue(next.plan)
      vi.mocked(deps.createInput).mockResolvedValue(next.input)
      vi.mocked(deps.createWorkerClient).mockReturnValue(nextClient)
      await act(async () => { await router.navigate('/plans/' + next.plan.id) })
      await screen.findByText(next.target.name)
    } else {
      // Replace dependencies on the same route; this must dispose the old client.
      router.routes[0].element = <ProductionPlanPage dependencies={nextDeps} />
      await act(async () => { router.revalidate() })
      await screen.findByText(next.target.name)
    }
    const navigationCount = navigate.mock.calls.length
    const preparationCount = vi.mocked(client.prepareInteraction).mock.calls.length
    const plannerCount = vi.mocked(client.createConstrainedPlan).mock.calls.length
    await act(async () => {
      inputPending.resolve(fixture.input)
      preparationPending.resolve(fixture.preparation)
      plannerPending.resolve(replanResult(createValidProductionPlan()))
      savePending.resolve({ kind: 'saved', plan: { ...fixture.plan, id: productionPlanId('plan.late-save') } })
    })
    expect(client.dispose).toHaveBeenCalledOnce()
    if (requestId !== null) expect(client.cancelPlan).toHaveBeenCalledWith(requestId)
    expect(client.prepareInteraction).toHaveBeenCalledTimes(preparationCount)
    expect(client.createConstrainedPlan).toHaveBeenCalledTimes(plannerCount)
    expect(deps.savePlannerResult).toHaveBeenCalledTimes(phase === 'save' ? 1 : 0)
    expect(navigate).toHaveBeenCalledTimes(navigationCount)
    if (change !== 'unmount') {
      expect(summaryValue('計画ID')).toBe(next.plan.id)
      expect(summaryValue('計画ID')).not.toBe(fixture.plan.id)
      expect(screen.queryByText('再計算しています…')).not.toBeInTheDocument()
    }
  })
})


describe('ProductionPlanPage atomic save phase', () => {
  it('does not allow cancellation or another action once atomic save has started', async () => {
    const user = userEvent.setup()
    const fixture = pageFixture()
    const savePending = deferred<PlannerOrchestrationResultSaveOutcome>()
    const client = plannerClient(async () => fixture.preparation)
    vi.mocked(client.createConstrainedPlan).mockResolvedValue(replanResult(createValidProductionPlan()))
    const deps = dependencies(fixture, client)
    vi.mocked(deps.savePlannerResult).mockReturnValue(savePending.promise)
    renderPage(deps, fixture.plan.id)
    await clickSelection(user)
    await waitFor(() => expect(deps.savePlannerResult).toHaveBeenCalledOnce())
    expect(screen.getByText('生産計画を保存しています。')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: '生産計画を保存中' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '再計算をキャンセル' })).not.toBeInTheDocument()
    const compare = screen.getByRole('button', { name: '比較する' })
    const select = screen.getByRole('button', { name: 'この候補を優先' })
    expect(compare).toBeDisabled()
    expect(select).toBeDisabled()
    fireEvent.click(compare)
    fireEvent.click(select)
    expect(client.createConstrainedPlan).toHaveBeenCalledOnce()
    expect(client.createWhatIfComparison).not.toHaveBeenCalled()
    expect(deps.createInput).toHaveBeenCalledTimes(2)
    expect(client.cancelPlan).not.toHaveBeenCalled()
    await act(async () => savePending.resolve({ kind: 'no_plan' }))
    expect(await screen.findByText('現在の入力から新しい生産計画を作成できませんでした。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'この候補を優先' })).toBeEnabled()
    expect(screen.queryByText('生産計画を保存しています。')).not.toBeInTheDocument()
  })
})


describe('ProductionPlanPage stale persisted badges', () => {
  it('keeps recommendation and selection on their persisted participants without starting any action', async () => {
    const fixture = multiParticipantFixture()
    fixture.plan.status = 'stale'
    fixture.plan.conflicts[0].recommendedBuildListEntryId = fixture.entry.id
    fixture.plan.conflicts[0].selectedBuildListEntryId = fixture.secondEntry.id
    const client = plannerClient(async () => fixture.preparation)
    const deps = dependencies(fixture, client)
    const view = renderPage(deps, fixture.plan.id)
    const navigate = vi.spyOn(view.router, 'navigate')

    const labels = await screen.findAllByText(/^BuildListEntry ID:/)
    expect(labels.map((label) => label.textContent)).toEqual([
      'BuildListEntry ID: ' + fixture.entry.id,
      'BuildListEntry ID: ' + fixture.secondEntry.id,
    ])
    for (const [index, label] of labels.entries()) {
      const participant = label.closest('li')
      if (!participant) throw new Error('Missing stale participant card')
      const card = within(participant)
      expect(card.queryByText('Planner推奨') !== null).toBe(index === 0)
      expect(card.queryByText('現在選択中') !== null).toBe(index === 1)
      for (const name of ['比較する', 'この候補を優先']) {
        const button = card.getByRole('button', { name })
        expect(button).toBeDisabled()
        fireEvent.click(button)
      }
    }
    expect(deps.getPlan).toHaveBeenCalledExactlyOnceWith(fixture.plan.id)
    expect(deps.createInput).not.toHaveBeenCalled()
    expect(client.prepareInteraction).not.toHaveBeenCalled()
    expect(client.createWhatIfComparison).not.toHaveBeenCalled()
    expect(client.createConstrainedPlan).not.toHaveBeenCalled()
    expect(deps.savePlannerResult).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
    expect(view.router.state.location.pathname).toBe('/plans/' + fixture.plan.id)
  })
})

const contentBonuses: RestorationBonusSet = [
  { bonusTypeId: 'bonus_type.fixture.attack', bonusRankId: 'bonus_rank.fixture.high' },
  { bonusTypeId: 'bonus_type.fixture.attack', bonusRankId: 'bonus_rank.fixture.high' },
  { bonusTypeId: 'bonus_type.fixture.attack', bonusRankId: 'bonus_rank.fixture.special' },
  { bonusTypeId: 'bonus_type.fixture.attack', bonusRankId: 'bonus_rank.fixture.high' },
  { bonusTypeId: 'bonus_type.fixture.attack', bonusRankId: 'bonus_rank.fixture.special' },
]

const contentTargetA = targetWeaponId('target.content.a')
const contentTargetB = targetWeaponId('target.content.b')

function contentStep(
  id: string,
  order: number,
  operationType: PlanStep['operationType'],
  title: string,
  primary: TargetWeapon['id'] | null,
  progressed: TargetWeapon['id'][] | undefined,
  result: PlanStep['expectedResult'],
): PlanStep {
  const base = createValidProductionPlan().steps[0]
  const step: PlanStep = {
    ...base,
    id: planStepId(id),
    order,
    operationType,
    title,
    instruction: `${title}の手順`,
    targetWeaponId: primary,
    expectedResult: result,
  }
  if (progressed === undefined) delete step.progressedTargetWeaponIds
  else step.progressedTargetWeaponIds = progressed
  return step
}

function contentExpectedResult(
  overrides: Partial<NonNullable<PlanStep['expectedResult']>> = {},
): NonNullable<PlanStep['expectedResult']> {
  return {
    restorationBonuses: contentBonuses,
    restorationBonusScope: 'gogma_artian',
    seriesSkillId: null,
    groupSkillId: null,
    shouldSecure: false,
    ...overrides,
  }
}

/**
 * A current-contract Plan whose steps are stored out of `order`, so the
 * displayed sequence can only come from `step.order`.
 */
function contentFixture() {
  const base = pageFixture('content')
  const targetA = { ...createValidTargetWeapon(), id: contentTargetA, name: '双剣・水' }
  const targetB = { ...createValidTargetWeapon(), id: contentTargetB, name: '双剣・火' }
  const shared = contentStep(
    'step.content.shared', 1, 'reset_bonuses', '復元ボーナスを再抽選',
    contentTargetA, [contentTargetA, contentTargetB], contentExpectedResult(),
  )
  const primaryOnly = contentStep(
    'step.content.primary', 2, 'keep_bonuses', '復元ボーナスを保持して再抽選',
    contentTargetB, [], contentExpectedResult(),
  )
  const independent = contentStep(
    'step.content.independent', 3, 'reset_skills', 'スキルを再付与',
    null, [], null,
  )
  const reserve = contentStep(
    'step.content.reserve', 4, 'reserve_weapon', '候補武器を確保',
    contentTargetA, [], contentExpectedResult({ shouldSecure: true }),
  )
  base.plan.steps = [reserve, independent, primaryOnly, shared]
  return { ...base, targetA, targetB, shared, primaryOnly, independent, reserve }
}

function contentDependencies(
  fixture: ReturnType<typeof contentFixture>,
  targetWeapons: TargetWeapon[] = [fixture.targetA, fixture.targetB],
  client = plannerClient(async () => fixture.preparation),
): ProductionPlanPageDependencies {
  const deps = dependencies(fixture, client)
  deps.getTargetWeapons = vi.fn(async () => targetWeapons)
  return deps
}

async function openPanel(name: string | RegExp) {
  await userEvent.click(await screen.findByText(name))
}

function stepCard(order: number): HTMLElement {
  const card = screen.getByText(`ステップ ${order}`).closest('.MuiPaper-root')
  if (!card) throw new Error(`Missing step card ${order}`)
  return card as HTMLElement
}

describe('ProductionPlanPage read-only Plan content', () => {
  it('summarizes the exact persisted Plan', async () => {
    const fixture = contentFixture()
    renderPage(contentDependencies(fixture), fixture.plan.id)

    expect(await screen.findByText('計画の概要')).toBeInTheDocument()
    expect(summaryValue('計画ID')).toBe(fixture.plan.id)
    expect(summaryValue('作成日時')).toBe(fixture.plan.createdAt)
    expect(summaryValue('全ステップ数')).toBe('4')
    expect(summaryValue('目標武器数')).toBe('2')
    // The fixture Steps carry no executionEffects: a legacy-form Plan, whose
    // planned completions are never inferred from `shouldSecure`.
    expect(summaryValue('完成予定の目標武器数')).toBe('不明（旧形式の計画）')
    // The adopted Entry count is its own figure, never presented as weapons.
    expect(summaryValue('採用候補（BuildListEntry）')).toBe('0')
  })

  it('lists the persisted steps in step.order for the whole Plan', async () => {
    const fixture = contentFixture()
    renderPage(contentDependencies(fixture), fixture.plan.id)

    await openPanel('全4ステップを表示')
    expect(screen.getAllByText(/^ステップ \d+$/).map((node) => node.textContent))
      .toEqual(['ステップ 1', 'ステップ 2', 'ステップ 3', 'ステップ 4'])
    expect(screen.getByText('復元ボーナスを再抽選の手順')).toBeInTheDocument()
    expect(screen.getByText('スキルをリセット')).toBeInTheDocument()
  })

  it('shows every Reset/Keep expected bonus slot in stored order, duplicates included', async () => {
    const fixture = contentFixture()
    renderPage(contentDependencies(fixture), fixture.plan.id)

    await openPanel('双剣・水（2ステップ）')
    const slots = within(stepCard(1)).getAllByText(/^攻撃(High|Special) fixture$/)
    expect(slots.map((slot) => slot.textContent)).toEqual([
      '攻撃High fixture',
      '攻撃High fixture',
      '攻撃Special fixture',
      '攻撃High fixture',
      '攻撃Special fixture',
    ])
  })

  it('renders a Step whose expectedResult is null without breaking the page', async () => {
    const fixture = contentFixture()
    renderPage(contentDependencies(fixture), fixture.plan.id)

    await openPanel('全4ステップを表示')
    const card = within(stepCard(3))
    expect(card.getByText('想定結果: 予測結果なし')).toBeInTheDocument()
    expect(card.getByText('対象: 目標武器に紐づかない操作')).toBeInTheDocument()
    expect(screen.queryByText('指定された生産計画が見つかりません。')).not.toBeInTheDocument()
  })

  it('never marks a legacy shouldSecure step as a completion', async () => {
    const fixture = contentFixture()
    renderPage(contentDependencies(fixture), fixture.plan.id)

    await openPanel('全4ステップを表示')
    expect(screen.queryByText('確保予定')).not.toBeInTheDocument()
    expect(screen.queryByText('このステップで完成する目標武器')).not.toBeInTheDocument()
  })

  it('counts and names the Targets a current Plan completes', async () => {
    const fixture = contentFixture()
    const effects = (targets: TargetWeapon['id'][]): PlanStep['executionEffects'] => ({
      trackedOwnedWeaponId: null,
      normalCreationRole: null,
      registersTrackedWeapon: false,
      observationBinding: null,
      targetLinks: [],
      compromiseLabels: [],
      targetCompletions: targets.map((targetWeaponId) => ({
        buildListEntryId: buildListEntryId(`build-list.content.${targetWeaponId}`),
        targetWeaponId,
        ownedWeaponId: 'owned.content' as never,
      })),
    })
    fixture.plan.steps.forEach((planStep) => {
      planStep.executionEffects = effects(
        planStep.id === fixture.shared.id ? [contentTargetA, contentTargetB] : [],
      )
    })
    renderPage(contentDependencies(fixture), fixture.plan.id)

    expect(await screen.findByText('計画の概要')).toBeInTheDocument()
    // One shared Step completes both Targets: two planned completions.
    expect(summaryValue('完成予定の目標武器数')).toBe('2')
    await openPanel('全4ステップを表示')
    const list = within(stepCard(1)).getByRole('list', { name: 'ステップ 1 で完成する目標武器' })
    expect(within(list).getAllByRole('listitem').map(({ textContent }) => textContent))
      .toEqual(['双剣・水', '双剣・火'])
    // The legacy `shouldSecure` flag on step 4 is not a completion.
    expect(within(stepCard(4)).queryByText('このステップで完成する目標武器')).not.toBeInTheDocument()
  })

  it('attributes one shared physical Step to both Target routes and lists it once globally', async () => {
    const fixture = contentFixture()
    renderPage(contentDependencies(fixture), fixture.plan.id)

    await openPanel('双剣・水（2ステップ）')
    expect(screen.getByText('ステップ 1')).toBeInTheDocument()
    expect(screen.getByText('共有操作')).toBeInTheDocument()
    expect(screen.getByText(
      'この操作は他の目標武器と共有され、計画全体では1回だけ実行します。',
    )).toBeInTheDocument()

    await openPanel('双剣・火（2ステップ）')
    expect(screen.getAllByText('ステップ 1')).toHaveLength(2)
    // The Target route attribution is presentation only: the Step is still one
    // physical operation, and the global timeline lists it exactly once.
    await openPanel('全4ステップを表示')
    expect(screen.getAllByText('ステップ 1')).toHaveLength(3)
    expect(screen.getAllByText('ステップ 4')).toHaveLength(2)
  })

  it('keeps a Step with no Route progression in its primary Target route', async () => {
    const fixture = contentFixture()
    renderPage(contentDependencies(fixture), fixture.plan.id)

    await openPanel('双剣・火（2ステップ）')
    const card = within(stepCard(2))
    expect(card.getByText('対象: 双剣・火')).toBeInTheDocument()
    expect(card.queryByText('共有操作')).not.toBeInTheDocument()
  })

  it('keeps a Target-independent Step out of the Target routes but in the timeline', async () => {
    const fixture = contentFixture()
    renderPage(contentDependencies(fixture), fixture.plan.id)

    await openPanel('双剣・水（2ステップ）')
    await openPanel('双剣・火（2ステップ）')
    expect(screen.queryByText('ステップ 3')).not.toBeInTheDocument()

    await openPanel('全4ステップを表示')
    expect(screen.getAllByText('ステップ 3')).toHaveLength(1)
  })

  it('warns about a legacy Plan and infers no shared attribution for it', async () => {
    const fixture = contentFixture()
    const legacyShared = { ...fixture.shared }
    delete legacyShared.progressedTargetWeaponIds
    fixture.plan.steps = [legacyShared, fixture.primaryOnly]
    renderPage(contentDependencies(fixture), fixture.plan.id)

    expect(await screen.findByText(/共有Target進行情報の保存機能追加前に作成された/))
      .toBeInTheDocument()
    // The legacy Step keeps only its primary attribution.
    await openPanel('双剣・水（1ステップ）')
    expect(screen.getByText('ステップ 1')).toBeInTheDocument()
    expect(screen.queryByText('共有操作')).not.toBeInTheDocument()
    await openPanel('双剣・火（1ステップ）')
    expect(screen.getAllByText('ステップ 1')).toHaveLength(1)
    expect(screen.getByText('ステップ 2')).toBeInTheDocument()
  })

  it('does not warn about a current-contract Plan', async () => {
    const fixture = contentFixture()
    renderPage(contentDependencies(fixture), fixture.plan.id)

    expect(await screen.findByText('計画の概要')).toBeInTheDocument()
    expect(screen.queryByText(/共有Target進行情報の保存機能追加前に作成された/))
      .not.toBeInTheDocument()
  })

  it('shows the persisted content of a stale Plan while its Conflict controls stay disabled', async () => {
    const fixture = contentFixture()
    fixture.plan.status = 'stale'
    const client = plannerClient(async () => fixture.preparation)
    const deps = contentDependencies(fixture, [fixture.targetA, fixture.targetB], client)
    renderPage(deps, fixture.plan.id)

    expect(await screen.findByText(
      'この生産計画は現在の状態と一致しません。ビルドリストから再計算してください。',
    )).toBeInTheDocument()
    expect(screen.getByText('計画の概要')).toBeInTheDocument()
    await openPanel('全4ステップを表示')
    expect(screen.getAllByText(/^ステップ \d+$/)).toHaveLength(4)
    for (const name of ['比較する', 'この候補を優先']) {
      expect(screen.getByRole('button', { name })).toBeDisabled()
    }
    expect(deps.createInput).not.toHaveBeenCalled()
    expect(client.prepareInteraction).not.toHaveBeenCalled()
  })

  it('treats a schema 2 Plan as non-executable under schema 3 without rewriting its persisted display', async () => {
    const fixture = contentFixture()
    fixture.plan.status = 'active'
    fixture.plan.calculationContext.appSchemaVersion = 2
    fixture.plan.baseSnapshot.calculationContext.appSchemaVersion = 2
    const client = plannerClient(async () => fixture.preparation)
    const deps = contentDependencies(
      fixture,
      [fixture.targetA, fixture.targetB],
      client,
    )
    deps.currentCalculationContext = {
      ...fixture.plan.calculationContext,
      appSchemaVersion: 3,
    }

    renderPage(deps, fixture.plan.id)

    expect(await screen.findByText(
      'この生産計画は現在の計算契約と互換性がありません。ビルドリストから再計算してください。',
    )).toBeInTheDocument()
    // Read-only authority remains the exact persisted Plan, including status
    // and steps; only the current interaction/execution path is invalidated.
    // Status is shown once, in the overview, exactly as persisted.
    expect(screen.getAllByText('実行中')).toHaveLength(1)
    expect(screen.getByText('計画の概要')).toBeInTheDocument()
    await openPanel('全4ステップを表示')
    expect(screen.getAllByText(/^ステップ \d+$/)).toHaveLength(4)
    for (const name of ['比較する', 'この候補を優先']) {
      expect(screen.getByRole('button', { name })).toBeDisabled()
    }
    expect(deps.createWorkerClient).not.toHaveBeenCalled()
    expect(deps.createInput).not.toHaveBeenCalled()
    expect(client.prepareInteraction).not.toHaveBeenCalled()
  })


  it('treats a schema 4 Plan as non-executable under the current schema', async () => {
    // Schema 4 accepted a partial result of a bound-truncated Planner search as
    // an ordinary Draft, and a persisted Plan records no
    // PlannerSearchTermination, so every schema 4 Plan is failed closed rather
    // than guessed at (DATA_MODEL 3.5).
    const fixture = contentFixture()
    fixture.plan.status = 'active'
    fixture.plan.calculationContext.appSchemaVersion = 4
    fixture.plan.baseSnapshot.calculationContext.appSchemaVersion = 4
    const client = plannerClient(async () => fixture.preparation)
    const deps = contentDependencies(
      fixture,
      [fixture.targetA, fixture.targetB],
      client,
    )
    deps.currentCalculationContext = {
      ...fixture.plan.calculationContext,
      appSchemaVersion: CURRENT_CALCULATION_APP_SCHEMA_VERSION,
    }

    renderPage(deps, fixture.plan.id)

    expect(await screen.findByText(
      'この生産計画は現在の計算契約と互換性がありません。ビルドリストから再計算してください。',
    )).toBeInTheDocument()
    // The exact persisted content stays readable; only the current
    // interaction and execution path is closed.
    expect(screen.getAllByText('実行中')).toHaveLength(1)
    await openPanel('全4ステップを表示')
    expect(screen.getAllByText(/^ステップ \d+$/)).toHaveLength(4)
    expect(deps.createWorkerClient).not.toHaveBeenCalled()
    expect(client.prepareInteraction).not.toHaveBeenCalled()
  })

  it('shows the persisted content while the Worker preparation is still running', async () => {
    const fixture = contentFixture()
    const pending = deferred<PlannerInteractionPreparationResult>()
    const client = plannerClient(() => pending.promise)
    renderPage(
      contentDependencies(fixture, [fixture.targetA, fixture.targetB], client),
      fixture.plan.id,
    )

    expect(await screen.findByText('計画の概要')).toBeInTheDocument()
    expect(screen.getByText('現在の保存状態から操作可否を確認しています。'))
      .toBeInTheDocument()
    await openPanel('全4ステップを表示')
    expect(screen.getAllByText(/^ステップ \d+$/)).toHaveLength(4)

    await act(async () => {
      pending.resolve(fixture.preparation)
      await pending.promise
    })
    expect(await screen.findByText('計画の概要')).toBeInTheDocument()
  })

  it('keeps the loaded Plan content after a preparation failure', async () => {
    const fixture = contentFixture()
    const client = plannerClient(async () => {
      throw new Error('準備に失敗しました。')
    })
    renderPage(
      contentDependencies(fixture, [fixture.targetA, fixture.targetB], client),
      fixture.plan.id,
    )

    expect(await screen.findByText('準備に失敗しました。')).toBeInTheDocument()
    expect(screen.getByText('計画の概要')).toBeInTheDocument()
    await openPanel('全4ステップを表示')
    expect(screen.getAllByText(/^ステップ \d+$/)).toHaveLength(4)
  })

  it('resolves Target names and falls back to the ID for a missing Target', async () => {
    const fixture = contentFixture()
    renderPage(contentDependencies(fixture, [fixture.targetA]), fixture.plan.id)

    expect(await screen.findByText('双剣・水（2ステップ）')).toBeInTheDocument()
    expect(screen.getByText(
      `削除済みまたは参照できない目標武器（${contentTargetB}）（2ステップ）`,
    )).toBeInTheDocument()
  })

  it('keeps the Plan content when the Target read itself fails', async () => {
    const fixture = contentFixture()
    const deps = contentDependencies(fixture)
    deps.getTargetWeapons = vi.fn(async () => {
      throw new Error('目標武器を読み込めません。')
    })
    renderPage(deps, fixture.plan.id)

    expect(await screen.findByText('計画の概要')).toBeInTheDocument()
    expect(await screen.findByText(
      `削除済みまたは参照できない目標武器（${contentTargetA}）（2ステップ）`,
    )).toBeInTheDocument()
  })

  it('shows the persisted content when the Worker Client cannot even be created', async () => {
    const fixture = contentFixture()
    const deps = contentDependencies(fixture)
    vi.mocked(deps.createWorkerClient).mockImplementation(() => {
      throw new Error('Workerを生成できませんでした。')
    })
    renderPage(deps, fixture.plan.id)

    expect(await screen.findByText('Workerを生成できませんでした。')).toBeInTheDocument()
    // The exact persisted Plan is loaded before any Worker concern, so its
    // read-only contents survive a Worker Client construction failure.
    expect(deps.getPlan).toHaveBeenCalledExactlyOnceWith(fixture.plan.id)
    expect(screen.getByText('計画の概要')).toBeInTheDocument()
    expect(summaryValue('計画ID')).toBe(fixture.plan.id)
    expect(summaryValue('全ステップ数')).toBe('4')
    expect(summaryValue('完成予定の目標武器数')).toBe('不明（旧形式の計画）')
    await openPanel('全4ステップを表示')
    expect(screen.getAllByText(/^ステップ \d+$/)).toHaveLength(4)
    // Nothing downstream of the Worker Client ran.
    expect(deps.createInput).not.toHaveBeenCalled()
  })

  it('creates no Worker Client for a stale Plan', async () => {
    const fixture = contentFixture()
    fixture.plan.status = 'stale'
    const client = plannerClient(async () => fixture.preparation)
    const deps = contentDependencies(fixture, [fixture.targetA, fixture.targetB], client)
    renderPage(deps, fixture.plan.id)

    expect(await screen.findByText('計画の概要')).toBeInTheDocument()
    expect(deps.createWorkerClient).not.toHaveBeenCalled()
    expect(deps.createInput).not.toHaveBeenCalled()
    expect(client.prepareInteraction).not.toHaveBeenCalled()
    expect(client.dispose).not.toHaveBeenCalled()
  })

  it('creates no Worker Client when the route Plan does not exist', async () => {
    const fixture = contentFixture()
    const deps = contentDependencies(fixture)
    vi.mocked(deps.getPlan).mockResolvedValue(undefined)
    renderPage(deps, 'plan.content.absent')

    expect(await screen.findByText('指定された生産計画が見つかりません。'))
      .toBeInTheDocument()
    expect(deps.createWorkerClient).not.toHaveBeenCalled()
  })

  it('loads the Plan before creating the Worker Client', async () => {
    const fixture = contentFixture()
    const order: string[] = []
    const client = plannerClient(async () => fixture.preparation)
    const deps = contentDependencies(fixture, [fixture.targetA, fixture.targetB], client)
    vi.mocked(deps.getPlan).mockImplementation(async () => {
      order.push('getPlan')
      return fixture.plan
    })
    vi.mocked(deps.createWorkerClient).mockImplementation(() => {
      order.push('createWorkerClient')
      return client
    })
    renderPage(deps, fixture.plan.id)

    await waitFor(() => expect(client.prepareInteraction).toHaveBeenCalledOnce())
    expect(order).toEqual(['getPlan', 'createWorkerClient'])
  })

  it('shows no Plan content and no other Plan when the route Plan is missing', async () => {
    const fixture = contentFixture()
    const deps = contentDependencies(fixture)
    vi.mocked(deps.getPlan).mockResolvedValue(undefined)
    renderPage(deps, 'plan.content.missing')

    expect(await screen.findByText('指定された生産計画が見つかりません。'))
      .toBeInTheDocument()
    expect(deps.getPlan).toHaveBeenCalledExactlyOnceWith('plan.content.missing')
    expect(screen.queryByText('計画の概要')).not.toBeInTheDocument()
    expect(screen.queryByText('計画全体の実行順')).not.toBeInTheDocument()
  })

  it('disables winner selection on a checkpoint conflict and routes to the Build List', async () => {
    const fixture = multiParticipantFixture()
    if (fixture.preparation.status !== 'ready') throw new Error('fixture')
    fixture.preparation.currentConflicts[0].checkpointParticipants = [{
      buildListEntryId: fixture.secondEntry.id,
      axis: 'bonus',
      opportunityId: 'intermediate-opportunity:page' as never,
    }]
    const client = plannerClient(async () => fixture.preparation)
    const deps = dependencies(fixture, client)

    renderPage(deps, fixture.plan.id)

    // Once for the conflict, then once per unavailable participant.
    expect(await screen.findAllByText(
      'この競合には途中採用する状態の選択が関係しています。作成リストで途中採用する状態を変更または解除してください。',
    )).toHaveLength(3)
    for (const name of ['比較する', 'この候補を優先']) {
      for (const button of screen.getAllByRole('button', { name })) {
        expect(button).toBeDisabled()
      }
    }
    const link = screen.getByRole('link', { name: 'ビルドリストで途中採用する状態を変更' })
    expect(link).toHaveAttribute('href', '/build-list')
    expect(screen.getByRole('link', { name: 'ビルドリストへ戻る' })).toBeInTheDocument()
    expect(client.createWhatIfComparison).not.toHaveBeenCalled()
    expect(client.createConstrainedPlan).not.toHaveBeenCalled()
  })
})

describe('ProductionPlanPage supplementary persisted content', () => {
  it('shows the Plan status once, in the overview, with the adopted Entry count as its own figure', async () => {
    const fixture = contentFixture()
    fixture.plan.selectedBuildListEntryIds = [
      buildListEntryId('build-list.content.a'),
      buildListEntryId('build-list.content.b'),
    ]
    renderPage(contentDependencies(fixture), fixture.plan.id)

    const overview = await screen.findByRole('region', { name: '計画の概要' })
    expect(within(overview).getByText('下書き')).toBeInTheDocument()
    expect(screen.getAllByText('下書き')).toHaveLength(1)
    expect(summaryValue('採用候補（BuildListEntry）')).toBe('2')
    // The planned completion count never comes from the Entry count.
    expect(summaryValue('完成予定の目標武器数')).toBe('不明（旧形式の計画）')
  })

  it('lists the persisted item material totals with Master labels', async () => {
    const fixture = contentFixture()
    fixture.plan.requiredMaterials = [
      { materialId: 'material.fixture.active', quantity: 12 },
      { materialId: 'material.fixture.unknown', quantity: 3 },
    ]
    renderPage(contentDependencies(fixture), fixture.plan.id)

    expect(await screen.findByRole('heading', { level: 2, name: '必要素材（アイテム）合計' })).toBeInTheDocument()
    const list = screen.getByRole('list', { name: '必要素材（アイテム）合計' })
    // Stored totals are shown as they are, never re-summed or reordered.
    expect(within(list).getAllByRole('listitem').map(({ textContent }) => textContent)).toEqual([
      '素材fixture× 12',
      '不明なアイテム素材× 3',
    ])
  })

  it('omits the persisted material section when none was recorded and still shows the whole-Plan cost estimate', async () => {
    const fixture = contentFixture()
    fixture.plan.requiredMaterials = []
    renderPage(contentDependencies(fixture), fixture.plan.id)
    expect(await screen.findByRole('heading', { level: 2, name: '必要素材・費用の目安' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 2, name: '必要素材（アイテム）合計' })).not.toBeInTheDocument()
    expect(screen.queryByText('記録されている必要素材（アイテム）はありません。')).not.toBeInTheDocument()
  })

  it('discloses the persisted rejected Entries with a reason label, detail and ID', async () => {
    const fixture = contentFixture()
    fixture.plan.rejectedBuildListEntries = [
      {
        buildListEntryId: buildListEntryId('build-list.rejected.a'),
        reason: 'resource_conflict',
        detail: 'Persisted rejection detail',
      },
      {
        buildListEntryId: buildListEntryId('build-list.rejected.b'),
        reason: 'longer_route',
        detail: 'Second detail',
      },
    ]
    renderPage(contentDependencies(fixture), fixture.plan.id)

    const toggle = await screen.findByRole('button', { name: '採用されなかった候補（2件）' })
    expect(screen.getByRole('heading', { level: 2, name: '採用されなかった候補（2件）' })).toContainElement(toggle)
    // Collapsed content is unmounted.
    expect(screen.queryByText('Persisted rejection detail')).not.toBeInTheDocument()
    await userEvent.click(toggle)
    const list = await screen.findByRole('list', { name: '採用されなかった候補' })
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(within(items[0]).getByText('他の候補と資源（RNG位置または所持武器）が競合しました')).toBeInTheDocument()
    expect(within(items[0]).getByText('Persisted rejection detail')).toBeInTheDocument()
    expect(within(items[0]).getByText('BuildListEntry ID: build-list.rejected.a')).toBeInTheDocument()
    expect(within(items[1]).getByText('より短い作成ルートの候補を優先しました')).toBeInTheDocument()
  })

  it('states when no Entry was rejected', async () => {
    const fixture = contentFixture()
    renderPage(contentDependencies(fixture), fixture.plan.id)
    expect(await screen.findByText('採用されなかった候補はありません。')).toBeInTheDocument()
  })

  it('labels expected bonus slots by the persisted scope and falls back safely on null', async () => {
    const fixture = contentFixture()
    const normalStep = contentStep(
      'step.content.normal', 5, 'convert_normal_to_gogma', '巨戟化',
      contentTargetA, [contentTargetA],
      contentExpectedResult({ restorationBonusScope: 'normal_artian' }),
    )
    const nullScopeStep = contentStep(
      'step.content.null-scope', 6, 'reset_bonuses', '区分なし',
      contentTargetA, [contentTargetA],
      contentExpectedResult({ restorationBonusScope: null }),
    )
    fixture.plan.steps = [...fixture.plan.steps, normalStep, nullScopeStep]
    renderPage(contentDependencies(fixture), fixture.plan.id)

    await openPanel('全6ステップを表示')
    const gogma = within(stepCard(1)).getByRole('list', { name: 'ステップ 1 の予測復元ボーナス5枠' })
    expect(within(gogma).getAllByRole('listitem').map(({ textContent }) => textContent)).toEqual([
      '攻撃High fixture', '攻撃High fixture', '攻撃Special fixture', '攻撃High fixture', '攻撃Special fixture',
    ])
    expect(within(stepCard(1)).getByText('復元ボーナスの種類: 巨戟アーティア系')).toBeInTheDocument()
    const normal = within(stepCard(5)).getByRole('list', { name: 'ステップ 5 の予測復元ボーナス5枠' })
    // The Normal-scope definition names slot 1 (attack High); Special has no
    // Normal definition and falls back to the generic label.
    expect(within(normal).getAllByRole('listitem').map(({ textContent }) => textContent)).toEqual([
      '通常攻撃fixture', '通常攻撃fixture', '攻撃fixture Special fixture', '通常攻撃fixture', '攻撃fixture Special fixture',
    ])
    expect(within(stepCard(5)).getByText('復元ボーナスの種類: 通常アーティア系')).toBeInTheDocument()
    const nullScope = within(stepCard(6)).getByRole('list', { name: 'ステップ 6 の予測復元ボーナス5枠' })
    expect(within(nullScope).getAllByRole('listitem').map(({ textContent }) => textContent)).toEqual([
      '攻撃fixture High fixture', '攻撃fixture High fixture', '攻撃fixture Special fixture', '攻撃fixture High fixture', '攻撃fixture Special fixture',
    ])
    expect(within(stepCard(6)).getByText('復元ボーナスの種類: 記録なし')).toBeInTheDocument()
  })

  it('wires every disclosure with unique ids, a heading slot and unmounted collapsed content', async () => {
    const fixture = contentFixture()
    renderPage(contentDependencies(fixture), fixture.plan.id)

    const timeline = await screen.findByRole('button', { name: '全4ステップを表示' })
    const routeA = screen.getByRole('button', { name: '双剣・水（2ステップ）' })
    const routeB = screen.getByRole('button', { name: '双剣・火（2ステップ）' })
    const toggles = [timeline, routeA, routeB]
    const ids = toggles.flatMap((toggle) => [toggle.id, toggle.getAttribute('aria-controls') ?? ''])
    expect(ids.every((id) => id !== '')).toBe(true)
    expect(new Set(ids).size).toBe(ids.length)
    for (const toggle of toggles) {
      expect(screen.getByRole('heading', { level: 3, name: toggle.textContent ?? '' })).toContainElement(toggle)
      expect(within(toggle).queryByRole('heading')).not.toBeInTheDocument()
      // Collapsed content is unmounted, so the controlled region does not
      // exist yet; it appears, labelled by the summary, once opened.
      expect(document.getElementById(toggle.getAttribute('aria-controls') ?? '')).toBeNull()
    }
    // Closed panels keep the step lists out of the DOM.
    expect(screen.queryByText(/^ステップ \d+$/)).not.toBeInTheDocument()
    await userEvent.click(timeline)
    const region = document.getElementById(timeline.getAttribute('aria-controls') ?? '')
    expect(region).toHaveAttribute('aria-labelledby', timeline.id)
    expect(screen.getByRole('list', { name: '計画全体の実行順' }).tagName).toBe('OL')
    expect(screen.getAllByRole('heading', { level: 4, name: /^ステップ \d+$/ })).toHaveLength(4)
  })

  it('shows the generation-time CalculationContext only in Debug Mode', async () => {
    const fixture = contentFixture()
    fixture.plan.baseSnapshot.calculationContext = {
      ...fixture.plan.baseSnapshot.calculationContext,
      rngEngineVersion: 'snapshot-engine',
    }
    const deps = contentDependencies(fixture)
    const offView = renderPage(deps, fixture.plan.id)
    expect(await screen.findByText('計画の概要')).toBeInTheDocument()
    expect(screen.queryByText('生成時CalculationContext（Debug）')).not.toBeInTheDocument()
    offView.unmount()

    useSettingsStore.setState({ debugMode: true })
    try {
      renderPage(deps, fixture.plan.id)
      const toggle = await screen.findByRole('button', { name: '生成時CalculationContext（Debug）' })
      expect(screen.getByRole('heading', { level: 2, name: '生成時CalculationContext（Debug）' })).toContainElement(toggle)
      await userEvent.click(toggle)
      const table = await screen.findByRole('table', { name: '生成時CalculationContext' })
      expect(within(table).getByText('snapshot-engine')).toBeInTheDocument()
      expect(within(table).getAllByText(fixture.plan.calculationContext.rngEngineVersion).length).toBeGreaterThanOrEqual(1)
      expect(within(table).getByRole('rowheader', { name: 'appSchemaVersion' })).toBeInTheDocument()
    } finally {
      useSettingsStore.setState({ debugMode: false })
    }
  })

  it('groups conflict participants under the conflict heading with text badges', async () => {
    const fixture = multiParticipantFixture()
    fixture.plan.conflicts[0].recommendedBuildListEntryId = fixture.entry.id
    fixture.plan.conflicts[0].selectedBuildListEntryId = fixture.secondEntry.id
    const client = plannerClient(async () => fixture.preparation)
    renderPage(dependencies(fixture, client), fixture.plan.id)

    expect(await screen.findByRole('heading', { level: 2, name: '競合と解決' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: '競合 1' })).toBeInTheDocument()
    expect(screen.getByText('同じ巨戟カウンター位置')).toBeInTheDocument()
    const participants = within(screen.getByRole('list', { name: '競合 1 の参加候補' })).getAllByRole('listitem')
    expect(participants).toHaveLength(2)
    expect(within(participants[0]).getByRole('heading', { level: 4, name: fixture.target.name })).toBeInTheDocument()
    expect(within(participants[0]).getByText('Planner推奨')).toBeInTheDocument()
    expect(within(participants[0]).queryByText('現在選択中')).not.toBeInTheDocument()
    expect(within(participants[1]).getByText('現在選択中')).toBeInTheDocument()
    expect(within(participants[1]).queryByText('Planner推奨')).not.toBeInTheDocument()
    expect(screen.getAllByText('利用可能')).toHaveLength(2)
    for (const participant of participants) {
      expect(within(participant).getByRole('button', { name: '比較する' })).toBeEnabled()
      expect(within(participant).getByRole('button', { name: 'この候補を優先' })).toBeEnabled()
    }
    // No Alert is shown while nothing is wrong.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('ProductionPlanPage read-only persisted Conflicts', () => {
  function participantCards() {
    return within(screen.getByRole('list', { name: '競合 1 の参加候補' })).getAllByRole('listitem')
  }

  function expectReadOnlyParticipants(reason: string) {
    const cards = participantCards()
    expect(cards).toHaveLength(2)
    // Persisted recommendation / selection badges keep their display contract.
    expect(within(cards[0]).getByText('Planner推奨')).toBeInTheDocument()
    expect(within(cards[0]).queryByText('現在選択中')).not.toBeInTheDocument()
    expect(within(cards[1]).getByText('現在選択中')).toBeInTheDocument()
    expect(within(cards[1]).queryByText('Planner推奨')).not.toBeInTheDocument()
    for (const card of cards) {
      expect(within(card).getByText('利用不可')).toBeInTheDocument()
      expect(within(card).getByText(reason)).toBeInTheDocument()
      expect(within(card).queryByText('利用可能')).not.toBeInTheDocument()
      for (const name of ['比較する', 'この候補を優先']) {
        const button = within(card).getByRole('button', { name })
        expect(button).toBeDisabled()
        fireEvent.click(button)
      }
    }
    // Nothing that only the current preparation knows is inferred from the
    // persisted Plan: no Target name, no checkpoint involvement.
    expect(screen.queryByText(fixtureTargetName)).not.toBeInTheDocument()
    expect(screen.queryByText('チェックポイント関与')).not.toBeInTheDocument()
    expect(screen.queryByText(
      'この競合には途中採用する状態の選択が関係しています。作成リストで途中採用する状態を変更または解除してください。',
    )).not.toBeInTheDocument()
  }

  let fixtureTargetName = ''

  function readOnlyFixture() {
    const fixture = multiParticipantFixture()
    fixture.plan.conflicts[0].recommendedBuildListEntryId = fixture.entry.id
    fixture.plan.conflicts[0].selectedBuildListEntryId = fixture.secondEntry.id
    // Persisted metadata that must never become a current authority.
    fixture.plan.conflicts[0].checkpointParticipants = [{
      buildListEntryId: fixture.secondEntry.id,
      axis: 'bonus',
      opportunityId: 'intermediate-opportunity:persisted' as never,
    }]
    fixtureTargetName = fixture.target.name
    return fixture
  }

  it('shows the persisted Conflicts read-only while the Worker preparation is still running, then switches to current availability', async () => {
    const fixture = readOnlyFixture()
    const pending = deferred<PlannerInteractionPreparationResult>()
    const client = plannerClient(() => pending.promise)
    const deps = dependencies(fixture, client)
    renderPage(deps, fixture.plan.id)

    expect(await screen.findByText('計画の概要')).toBeInTheDocument()
    expect(screen.getByText('現在の保存状態から操作可否を確認しています。')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: '競合と解決' })).toBeInTheDocument()
    expect(screen.getByText('Persisted fixture conflict')).toBeInTheDocument()
    expect(screen.getByText('同じ巨戟カウンター位置')).toBeInTheDocument()
    expectReadOnlyParticipants('現在の操作可否を確認しています。')
    expect(client.createWhatIfComparison).not.toHaveBeenCalled()
    expect(client.createConstrainedPlan).not.toHaveBeenCalled()

    await act(async () => {
      pending.resolve(fixture.preparation)
      await pending.promise
    })
    // The fresh preparation is the availability authority once it arrives.
    expect(await screen.findAllByText('利用可能')).toHaveLength(2)
    expect(screen.queryByText('現在の操作可否を確認しています。')).not.toBeInTheDocument()
    expect(screen.queryByText('現在の保存状態から操作可否を確認しています。')).not.toBeInTheDocument()
    for (const card of participantCards()) {
      expect(within(card).getByRole('button', { name: '比較する' })).toBeEnabled()
      expect(within(card).getByRole('button', { name: 'この候補を優先' })).toBeEnabled()
    }
    expect(screen.getByText(fixture.target.name)).toBeInTheDocument()
  })

  it('keeps the persisted Conflicts visible read-only after the Worker preparation failed', async () => {
    const fixture = readOnlyFixture()
    const client = plannerClient(async () => {
      throw new Error('Unexpected preparation failure')
    })
    const deps = dependencies(fixture, client)
    renderPage(deps, fixture.plan.id)

    expect(await screen.findByText('Unexpected preparation failure')).toBeInTheDocument()
    // The Worker failure is an error, never a stale Plan.
    expect(screen.queryByText(/再計算が必要な生産計画です/)).not.toBeInTheDocument()
    expect(screen.getByText('計画の概要')).toBeInTheDocument()
    expect(summaryValue('計画ID')).toBe(fixture.plan.id)
    expect(screen.getByRole('heading', { level: 2, name: '競合と解決' })).toBeInTheDocument()
    expect(screen.getByText('Persisted fixture conflict')).toBeInTheDocument()
    expectReadOnlyParticipants('現在の操作可否を確認できないため、この候補は操作できません。')
    expect(client.createWhatIfComparison).not.toHaveBeenCalled()
    expect(client.createConstrainedPlan).not.toHaveBeenCalled()
    expect(deps.savePlannerResult).not.toHaveBeenCalled()
  })

  it('gives every stale participant its unavailable reason beside the persisted badges', async () => {
    const fixture = readOnlyFixture()
    fixture.plan.status = 'stale'
    const client = plannerClient(async () => fixture.preparation)
    const deps = dependencies(fixture, client)
    renderPage(deps, fixture.plan.id)

    expect(await screen.findByText(
      'この生産計画は現在の状態と一致しません。ビルドリストから再計算してください。',
    )).toBeInTheDocument()
    expect(screen.getByText('Persisted fixture conflict')).toBeInTheDocument()
    expectReadOnlyParticipants('この生産計画は再計算が必要なため、この候補は操作できません。')
    expect(deps.createInput).not.toHaveBeenCalled()
    expect(client.prepareInteraction).not.toHaveBeenCalled()
  })

  it('uses the same read-only reason for a calculation-context-incompatible Plan', async () => {
    const fixture = readOnlyFixture()
    fixture.plan.calculationContext.appSchemaVersion = 9
    fixture.plan.baseSnapshot.calculationContext.appSchemaVersion = 9
    const deps = dependencies(fixture, plannerClient(async () => fixture.preparation))
    deps.currentCalculationContext = {
      ...fixture.plan.calculationContext,
      appSchemaVersion: CURRENT_CALCULATION_APP_SCHEMA_VERSION,
    }
    renderPage(deps, fixture.plan.id)

    expect(await screen.findByText(
      'この生産計画は現在の計算契約と互換性がありません。ビルドリストから再計算してください。',
    )).toBeInTheDocument()
    expectReadOnlyParticipants('この生産計画は再計算が必要なため、この候補は操作できません。')
  })

  it('keeps the empty Conflict presentation in a read-only state', async () => {
    const fixture = readOnlyFixture()
    fixture.plan.conflicts = []
    const pending = deferred<PlannerInteractionPreparationResult>()
    const client = plannerClient(() => pending.promise)
    renderPage(dependencies(fixture, client), fixture.plan.id)

    expect(await screen.findByText('計画の概要')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: '競合と解決' })).toBeInTheDocument()
    expect(screen.getByText('この生産計画に表示する競合はありません。')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '比較する' })).not.toBeInTheDocument()
    pending.resolve({ status: 'ready', validBuildListEntryIds: [], excludedBuildListEntries: [], currentConflicts: [] })
  })

  it('shows no Conflict section when the Plan itself could not be loaded', async () => {
    const fixture = readOnlyFixture()
    const deps = dependencies(fixture, plannerClient(async () => fixture.preparation))
    vi.mocked(deps.getPlan).mockRejectedValue(new Error('計画を読み込めませんでした。'))
    renderPage(deps, fixture.plan.id)

    expect(await screen.findByText('計画を読み込めませんでした。')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 2, name: '競合と解決' })).not.toBeInTheDocument()
    expect(screen.queryByText('計画の概要')).not.toBeInTheDocument()
  })
})

describe('ProductionPlanPage checkpoint milestones and heading depth', () => {
  it('shows every persisted milestone on the physical Step that reaches it, in both views', async () => {
    const fixture = contentFixture()
    fixture.shared.checkpointMilestones = [
      {
        buildListEntryId: buildListEntryId('build-list.milestone.a'),
        targetWeaponId: contentTargetA,
        skillOpportunityId: null,
        bonusOpportunityId: 'intermediate-opportunity:a' as never,
        conditionMatch: { bonus: 'practical', skill: 'ideal' },
        remainingOperationCount: 2,
      },
      {
        buildListEntryId: buildListEntryId('build-list.milestone.b'),
        targetWeaponId: contentTargetB,
        skillOpportunityId: 'intermediate-opportunity:b' as never,
        bonusOpportunityId: null,
        conditionMatch: { bonus: 'ideal', skill: 'practical' },
        remainingOperationCount: 1,
      },
    ]
    fixture.plan.steps = [fixture.reserve, fixture.independent, fixture.primaryOnly, fixture.shared]
    renderPage(contentDependencies(fixture), fixture.plan.id)

    await openPanel('全4ステップを表示')
    const list = within(stepCard(1)).getByRole('list', { name: 'ステップ 1 のチェックポイント到達' })
    expect(within(list).getAllByRole('listitem').map(({ textContent }) => textContent)).toEqual([
      '双剣・水（ボーナス判定: 実用 ／ スキル判定: 理想、理想まで残り2操作）',
      '双剣・火（ボーナス判定: 理想 ／ スキル判定: 実用、理想まで残り1操作）',
    ])
    // Only the Step carrying the metadata shows it; the Plan has no extra Step.
    expect(screen.getAllByText('チェックポイント到達')).toHaveLength(1)
    expect(screen.getAllByText(/^ステップ \d+$/)).toHaveLength(4)
    expect(summaryValue('全ステップ数')).toBe('4')
    expect(summaryValue('完成予定の目標武器数')).toBe('不明（旧形式の計画）')
    // The Target route shows the same persisted milestones on the shared Step.
    await openPanel('双剣・火（2ステップ）')
    expect(screen.getAllByText('チェックポイント到達')).toHaveLength(2)
    // Labels inside a Step card are text, not headings: with every panel open
    // the page outline never skips a level.
    const levels = screen.getAllByRole('heading').map((heading) => Number(heading.tagName.slice(1)))
    for (let index = 1; index < levels.length; index += 1) {
      expect(levels[index] - levels[index - 1]).toBeLessThanOrEqual(1)
    }
    expect(screen.queryByRole('heading', { name: 'チェックポイント到達' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '想定結果' })).not.toBeInTheDocument()
  })

  it('shows no milestone section for a legacy Plan without the field or an empty list', async () => {
    const fixture = contentFixture()
    const legacy = { ...fixture.shared }
    delete legacy.checkpointMilestones
    fixture.plan.steps = [legacy, { ...fixture.primaryOnly, checkpointMilestones: [] }]
    renderPage(contentDependencies(fixture), fixture.plan.id)

    await openPanel('全2ステップを表示')
    expect(screen.getAllByText(/^ステップ \d+$/)).toHaveLength(2)
    expect(screen.queryByText('チェックポイント到達')).not.toBeInTheDocument()
  })

  it('nests the what-if comparison below its participant heading', async () => {
    const user = userEvent.setup()
    const fixture = multiParticipantFixture()
    const client = plannerClient(
      async () => fixture.preparation,
      async () => completedWhatIf(fixture.entry.id, fixture.secondTarget, 7),
    )
    renderPage(dependencies(fixture, client), fixture.plan.id)
    const buttons = await screen.findAllByRole('button', { name: '比較する' })
    await user.click(buttons[0])

    expect(await screen.findByText('必要操作数: 7')).toBeInTheDocument()
    const participant = screen.getByRole('heading', { level: 4, name: fixture.target.name })
    const comparison = screen.getByRole('heading', { level: 5, name: '比較結果' })
    const targetResult = screen.getByRole('heading', { level: 6, name: fixture.secondTarget.name })
    expect(participant.closest('li')).toContainElement(comparison)
    expect(participant.closest('li')).toContainElement(targetResult)
    // The participant heading, the comparison and the Target result descend
    // one level each; no two nested levels coincide.
    expect(screen.getByRole('heading', { level: 3, name: '競合 1' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 4, name: '比較結果' })).not.toBeInTheDocument()
  })
})

describe('ProductionPlanPage Execution entry', () => {
  /** 「作成開始」 once the start preview is ready; it is disabled before that. */
  async function readyStartButton(): Promise<HTMLElement> {
    const button = await screen.findByRole('button', { name: '作成開始' })
    await waitFor(() => expect(button).toBeEnabled())
    return button
  }

  function withStatus(patch: Partial<ProductionPlan>) {
    const fixture = pageFixture()
    fixture.plan = { ...fixture.plan, ...patch }
    return fixture
  }

  it('offers 作成開始 for a draft Plan only', async () => {
    const fixture = withStatus({ status: 'draft' })
    renderPage(dependencies(fixture), fixture.plan.id)
    expect(await readyStartButton()).toBeEnabled()
    expect(screen.queryByRole('link', { name: '実行ナビを再開する' })).not.toBeInTheDocument()
  })

  it('offers 実行ナビを再開する for an active Plan', async () => {
    const fixture = withStatus({ status: 'active' })
    renderPage(dependencies(fixture), fixture.plan.id)
    expect(await screen.findByRole('link', { name: '実行ナビを再開する' }))
      .toHaveAttribute('href', `/plans/${fixture.plan.id}/run`)
    expect(screen.queryByRole('button', { name: '作成開始' })).not.toBeInTheDocument()
  })

  it.each([
    ['stale', { status: 'stale' as const, recalculationReasons: ['unexpected_result' as const] }, '再計算が必要な生産計画です'],
    ['completed', { status: 'completed' as const, completedAt: '2026-09-17T00:00:00.000Z' }, 'この生産計画は完了しています。'],
    [
      'abandoned',
      { status: 'abandoned' as const, abandonmentReason: 'finished_as_compromise' as const, abandonedAt: '2026-09-17T00:00:00.000Z' },
      'この生産計画は終了しています（妥協品で終了）。',
    ],
  ])('never offers to start or resume a %s Plan', async (_, patch, text) => {
    const fixture = withStatus(patch)
    const deps = dependencies(fixture)
    renderPage(deps, fixture.plan.id)
    expect(await screen.findByText(text)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '作成開始' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '実行ナビを再開する' })).not.toBeInTheDocument()
    expect(deps.startProductionPlan).not.toHaveBeenCalled()
  })

  it.each([
    ['draft', 13],
    ['active', 13],
    ['draft', 14],
    ['active', 14],
  ] as const)(
    'fails a %s schema %i Plan closed under the current schema 15, keeping its persisted content readable',
    async (status, appSchemaVersion) => {
      // Issue #103 Phase C: a version 13 Plan was calculated by the Beam Search,
      // and Issue #129: a version 14 Plan turned every Counter-advance Normal
      // forge into a conflict. A persisted Plan records neither, so it is never
      // prepared, started, compared or executed under the current runtime.
      const fixture = withStatus({ status })
      fixture.plan.calculationContext = { ...fixture.plan.calculationContext, appSchemaVersion }
      fixture.plan.baseSnapshot = {
        ...fixture.plan.baseSnapshot,
        calculationContext: { ...fixture.plan.baseSnapshot.calculationContext, appSchemaVersion },
      }
      const deps = dependencies(fixture)
      deps.currentCalculationContext = {
        ...fixture.plan.calculationContext,
        appSchemaVersion: CURRENT_CALCULATION_APP_SCHEMA_VERSION,
      }
      expect(CURRENT_CALCULATION_APP_SCHEMA_VERSION).toBe(15)
      renderPage(deps, fixture.plan.id)

      expect(await screen.findByText(
        'この生産計画は現在の計算契約と互換性がありません。ビルドリストから再計算してください。',
      )).toBeInTheDocument()
      // The exact persisted content stays readable.
      expect(screen.getByText('計画の概要')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: '作成開始' })).not.toBeInTheDocument()
      expect(screen.queryByRole('link', { name: '実行ナビを再開する' })).not.toBeInTheDocument()
      // Conflict / what-if controls stay disabled: no preparation ever runs.
      screen.queryAllByRole('button', { name: '比較する' }).forEach((button) => {
        expect(button).toBeDisabled()
      })
      expect(deps.createWorkerClient).not.toHaveBeenCalled()
      expect(deps.startProductionPlan).not.toHaveBeenCalled()
      // A running older-schema Plan is replanned from the current state; a
      // Draft is simply recalculated from the Build List.
      if (status === 'active') {
        expect(screen.getByRole('heading', { name: '現在地点からの再計画' })).toBeInTheDocument()
      } else {
        expect(screen.queryByRole('heading', { name: '現在地点からの再計画' })).not.toBeInTheDocument()
      }
    },
  )

  it('starts through the runtime and then opens the Execution Navigator', async () => {
    const fixture = withStatus({ status: 'draft' })
    const deps = dependencies(fixture)
    vi.mocked(deps.startProductionPlan).mockResolvedValue({ ...fixture.plan, status: 'active' })
    const user = userEvent.setup()
    const { router } = renderPage(deps, fixture.plan.id)
    await user.click(await readyStartButton())
    expect(await screen.findByText('Execution navigator destination')).toBeInTheDocument()
    expect(deps.startProductionPlan).toHaveBeenCalledExactlyOnceWith(fixture.plan.id)
    expect(router.state.location.pathname).toBe(`/plans/${fixture.plan.id}/run`)
  })

  function inspectionWith(
    fixture: ReturnType<typeof withStatus>,
    changes: ProductionPlanStartInspection['changes'],
  ): ProductionPlanStartInspection {
    const targetA = createValidTargetWeapon()
    targetA.id = targetWeaponId('target.start.a')
    targetA.name = '目標A'
    const weaponX = { ...createValidOwnedWeapon(ownedWeaponId('owned.start.x')), name: '武器X' }
    const weaponY = { ...createValidOwnedWeapon(ownedWeaponId('owned.start.y')), name: '武器Y' }
    return {
      planId: fixture.plan.id,
      changes,
      ownedWeapons: [weaponX, weaponY],
      targetWeapons: [targetA, { ...fixture.target, name: '目標B' }],
    }
  }

  it('previews the Target links the start will make, by name, before 作成開始', async () => {
    const fixture = withStatus({ status: 'draft' })
    const deps = dependencies(fixture)
    vi.mocked(deps.inspectProductionPlanStart).mockResolvedValue(inspectionWith(fixture, [
      {
        buildListEntryId: fixture.entry.id,
        ownedWeaponId: ownedWeaponId('owned.start.x'),
        targetWeaponId: fixture.target.id,
        fromTargetWeaponId: targetWeaponId('target.start.a'),
        replacedOwnedWeaponId: ownedWeaponId('owned.start.y'),
      },
    ]))
    renderPage(deps, fixture.plan.id)

    const region = await screen.findByRole('region', { name: '開始時の優先起点の変更' })
    expect(region).toHaveTextContent('この生産計画を開始すると、目標武器の優先起点が変更されます。')
    expect(region).toHaveTextContent('所持武器「武器X」')
    expect(region).toHaveTextContent('目標A → 目標B')
    expect(region).toHaveTextContent('「目標B」の優先起点だった「武器Y」は解除されます。')
    expect(region).toHaveTextContent('変更は「作成開始」を押した時点で反映されます。')
    expect(region).not.toHaveTextContent('owned.start.x')
    expect(deps.inspectProductionPlanStart).toHaveBeenCalledWith(fixture.plan.id)
    expect(screen.getByRole('button', { name: '作成開始' })).toBeEnabled()
  })

  it('previews a weapon no Target prefers yet as 未設定', async () => {
    const fixture = withStatus({ status: 'draft' })
    const deps = dependencies(fixture)
    vi.mocked(deps.inspectProductionPlanStart).mockResolvedValue(inspectionWith(fixture, [
      {
        buildListEntryId: fixture.entry.id,
        ownedWeaponId: ownedWeaponId('owned.start.x'),
        targetWeaponId: fixture.target.id,
        fromTargetWeaponId: null,
        replacedOwnedWeaponId: null,
      },
    ]))
    renderPage(deps, fixture.plan.id)

    const region = await screen.findByRole('region', { name: '開始時の優先起点の変更' })
    expect(region).toHaveTextContent('未設定 → 目標B')
    expect(region).not.toHaveTextContent('解除されます')
  })

  it('shows no preview when the start changes no link', async () => {
    const fixture = withStatus({ status: 'draft' })
    const deps = dependencies(fixture)
    renderPage(deps, fixture.plan.id)
    expect(await readyStartButton()).toBeEnabled()
    expect(deps.inspectProductionPlanStart).toHaveBeenCalledWith(fixture.plan.id)
    expect(screen.queryByRole('region', { name: '開始時の優先起点の変更' })).not.toBeInTheDocument()
    expect(screen.queryByText(/優先起点が変更されます/)).not.toBeInTheDocument()
  })

  it('never previews a start for an active Plan', async () => {
    const fixture = withStatus({ status: 'active' })
    const deps = dependencies(fixture)
    renderPage(deps, fixture.plan.id)
    expect(await screen.findByRole('link', { name: '実行ナビを再開する' })).toBeInTheDocument()
    expect(deps.inspectProductionPlanStart).not.toHaveBeenCalled()
    expect(screen.queryByText(/開始すると/)).not.toBeInTheDocument()
  })

  it('keeps the preview and the draft when the start with link changes is refused', async () => {
    const fixture = withStatus({ status: 'draft' })
    const deps = dependencies(fixture)
    vi.mocked(deps.inspectProductionPlanStart).mockResolvedValue(inspectionWith(fixture, [
      {
        buildListEntryId: fixture.entry.id,
        ownedWeaponId: ownedWeaponId('owned.start.x'),
        targetWeaponId: fixture.target.id,
        fromTargetWeaponId: targetWeaponId('target.start.a'),
        replacedOwnedWeaponId: null,
      },
    ]))
    vi.mocked(deps.startProductionPlan).mockRejectedValue(
      new ExecutionRuntimeError('execution_state_mismatch', 'changed'),
    )
    const user = userEvent.setup()
    const { router } = renderPage(deps, fixture.plan.id)
    await screen.findByRole('region', { name: '開始時の優先起点の変更' })
    await user.click(await readyStartButton())

    expect(await screen.findByText(/生産計画は開始していません。ビルドリストから再計算してください。/)).toBeInTheDocument()
    expect(deps.startProductionPlan).toHaveBeenCalledExactlyOnceWith(fixture.plan.id)
    expect(router.state.location.pathname).toBe(`/plans/${fixture.plan.id}`)
    expect(screen.getByRole('region', { name: '開始時の優先起点の変更' })).toBeInTheDocument()
  })

  it('keeps 作成開始 disabled while the start preview is loading', async () => {
    const fixture = withStatus({ status: 'draft' })
    const deps = dependencies(fixture)
    vi.mocked(deps.inspectProductionPlanStart).mockReturnValue(new Promise(() => undefined))
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    renderPage(deps, fixture.plan.id)

    const button = await screen.findByRole('button', { name: '作成開始' })
    expect(button).toBeDisabled()
    expect(screen.getByText('開始時に変わる目標武器の優先起点を確認しています。')).toBeInTheDocument()
    await user.click(button)
    expect(deps.startProductionPlan).not.toHaveBeenCalled()
  })

  it('refuses to start after a failed preview until 再確認 succeeds with changes', async () => {
    const fixture = withStatus({ status: 'draft' })
    const deps = dependencies(fixture)
    vi.mocked(deps.inspectProductionPlanStart)
      .mockRejectedValueOnce(new Error('read failed'))
      .mockResolvedValueOnce(inspectionWith(fixture, [
        {
          buildListEntryId: fixture.entry.id,
          ownedWeaponId: ownedWeaponId('owned.start.x'),
          targetWeaponId: fixture.target.id,
          fromTargetWeaponId: targetWeaponId('target.start.a'),
          replacedOwnedWeaponId: null,
        },
      ]))
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    renderPage(deps, fixture.plan.id)

    expect(await screen.findByText(/開始時に変わる目標武器の優先起点を確認できませんでした。/)).toBeInTheDocument()
    const button = screen.getByRole('button', { name: '作成開始' })
    expect(button).toBeDisabled()
    await user.click(button)
    expect(deps.startProductionPlan).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '再確認' }))
    const region = await screen.findByRole('region', { name: '開始時の優先起点の変更' })
    expect(region).toHaveTextContent('所持武器「武器X」')
    expect(region).toHaveTextContent('目標A → 目標B')
    expect(screen.queryByRole('button', { name: '再確認' })).not.toBeInTheDocument()
    expect(await readyStartButton()).toBeEnabled()
    expect(deps.inspectProductionPlanStart).toHaveBeenCalledTimes(2)
  })

  it('shows loading again while 再確認 runs, and no preview when it finds no change', async () => {
    const fixture = withStatus({ status: 'draft' })
    const deps = dependencies(fixture)
    let resolveRetry!: (value: ProductionPlanStartInspection) => void
    vi.mocked(deps.inspectProductionPlanStart)
      .mockRejectedValueOnce(new Error('read failed'))
      .mockReturnValueOnce(new Promise((resolve) => { resolveRetry = resolve }))
    const user = userEvent.setup()
    renderPage(deps, fixture.plan.id)

    await user.click(await screen.findByRole('button', { name: '再確認' }))
    expect(await screen.findByText('開始時に変わる目標武器の優先起点を確認しています。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '作成開始' })).toBeDisabled()

    resolveRetry(inspectionWith(fixture, []))
    expect(await readyStartButton()).toBeEnabled()
    expect(screen.queryByRole('region', { name: '開始時の優先起点の変更' })).not.toBeInTheDocument()
    expect(screen.queryByText(/確認できませんでした/)).not.toBeInTheDocument()
    expect(deps.startProductionPlan).not.toHaveBeenCalled()
  })

  it('stays on the Plan and shows the typed refusal when starting fails', async () => {
    const fixture = withStatus({ status: 'draft' })
    const deps = dependencies(fixture)
    vi.mocked(deps.startProductionPlan).mockRejectedValue(
      new ExecutionRuntimeError('running_plan_conflict', 'another plan'),
    )
    const user = userEvent.setup()
    const { router } = renderPage(deps, fixture.plan.id)
    await user.click(await readyStartButton())
    expect(await screen.findByText('別の生産計画が実行中です。実行中の生産計画を終えてから開始してください。'))
      .toBeInTheDocument()
    expect(router.state.location.pathname).toBe(`/plans/${fixture.plan.id}`)
    expect(screen.getByRole('button', { name: '作成開始' })).toBeEnabled()
  })
})

describe('ProductionPlanPage PlanStep Debug', () => {
  function debugFixture() {
    const fixture = contentFixture()
    fixture.plan.steps = fixture.plan.steps.map((step) =>
      step.id === fixture.shared.id
        ? {
            ...step,
            rngAdvance: {
              gogmaCounterDelta: 1,
              skillCounterDelta: 0,
              normalCounterDelta: null,
              affectedNormalCounterId: null,
            },
            debug: {
              startBaseSeed: '51231782',
              startGogmaCounter: 120,
              endGogmaCounter: 121,
              startSkillCounter: 341,
              endSkillCounter: 341,
              startNormalCounter: null,
              endNormalCounter: null,
              plannerReason: 'reset_bonuses',
            },
          }
        : step,
    )
    return fixture
  }

  it('shows no PlanStep Debug block in the normal UI', async () => {
    const fixture = debugFixture()
    renderPage(contentDependencies(fixture), fixture.plan.id)
    await userEvent.click(await screen.findByRole('button', { name: '全4ステップを表示' }))

    expect(screen.getAllByRole('heading', { level: 4, name: /^ステップ \d+$/ })).toHaveLength(4)
    expect(screen.queryByRole('button', { name: 'PlanStep Debug' })).not.toBeInTheDocument()
    expect(screen.queryByText('51231782')).not.toBeInTheDocument()
    expect(screen.queryByText(/plannerReason/)).not.toBeInTheDocument()
  })

  it('adds one collapsed PlanStep Debug block per Step in Debug Mode', async () => {
    useSettingsStore.setState({ debugMode: true })
    try {
      const fixture = debugFixture()
      renderPage(contentDependencies(fixture), fixture.plan.id)
      await userEvent.click(await screen.findByRole('button', { name: '全4ステップを表示' }))

      const toggles = screen.getAllByRole('button', { name: 'PlanStep Debug' })
      expect(toggles).toHaveLength(4)
      // Nested one level below the Step heading, and collapsed, so a long Plan
      // does not expand every Debug block into the DOM.
      expect(screen.getAllByRole('heading', { level: 5, name: 'PlanStep Debug' })).toHaveLength(4)
      for (const toggle of toggles) {
        expect(toggle).toHaveAttribute('aria-expanded', 'false')
      }
      expect(screen.queryByText('51231782')).not.toBeInTheDocument()

      await userEvent.click(toggles[0])
      const info = screen.getByRole('group', { name: 'ステップ 1 のPlanStepDebugInfo' })
      expect(
        within(info).getByText('startBaseSeed', { selector: 'dt' }).nextElementSibling,
      ).toHaveTextContent('51231782')
      expect(
        within(info).getByText('plannerReason', { selector: 'dt' }).nextElementSibling,
      ).toHaveTextContent('reset_bonuses')
      const counters = screen.getByRole('group', { name: 'ステップ 1 のCounter開始終了' })
      expect(
        within(counters).getByText('Gogma Counter', { selector: 'dt' }).nextElementSibling,
      ).toHaveTextContent('開始 120 → 終了 121（delta 1）')
      expect(
        within(counters).getByText('Normal Counter', { selector: 'dt' }).nextElementSibling,
      ).toHaveTextContent('開始 記録なし → 終了 記録なし（delta 記録なし）')
    } finally {
      useSettingsStore.setState({ debugMode: false })
    }
  })

  it('says a legacy Step recorded no PlanStepDebugInfo instead of reconstructing one', async () => {
    useSettingsStore.setState({ debugMode: true })
    try {
      const fixture = debugFixture()
      renderPage(contentDependencies(fixture), fixture.plan.id)
      await userEvent.click(await screen.findByRole('button', { name: '全4ステップを表示' }))
      // Step 2 keeps the fixture default of no persisted debug record.
      await userEvent.click(screen.getAllByRole('button', { name: 'PlanStep Debug' })[1])

      expect(screen.getByText('PlanStepDebugInfo: 記録なし')).toBeInTheDocument()
      expect(
        within(screen.getByRole('group', { name: 'ステップ 2 のPlanStepDebugInfo' }))
          .getByText('startBaseSeed', { selector: 'dt' }).nextElementSibling,
      ).toHaveTextContent('記録なし')
    } finally {
      useSettingsStore.setState({ debugMode: false })
    }
  })
})

/**
 * The conflict resolution recalculation's `maxPlanSteps` (Issue #130): the
 * page derives it from the Plan it shows -
 * `max(1000, ceilTo500(plan.steps.length) + 500)` - and writes it over the
 * fresh input's `defaultPlannerOptions`. It never reads the Build List page's
 * temporary input, and the what-if comparison keeps its own bounds.
 */
describe('ProductionPlanPage conflict resolution maxPlanSteps', () => {
  function withStepCount(fixture: ReturnType<typeof multiParticipantFixture>, stepCount: number) {
    const [step] = fixture.plan.steps
    fixture.plan.steps = Array.from({ length: stepCount }, (_, index) => ({
      ...step,
      id: planStepId(`plan-step.long.${index}`),
      order: index + 1,
    }))
    fixture.plan.currentStepId = null
    return fixture
  }

  it.each([
    [1, 1000],
    [800, 1500],
    [1000, 1500],
    [1470, 2000],
    [1500, 2000],
    [1600, 2500],
  ])('recalculates a %i-Step Plan with maxPlanSteps %i and keeps every explicit resolution', async (stepCount, expected) => {
    const user = userEvent.setup()
    const fixture = withStepCount(multiParticipantFixture(), stepCount)
    const other = { ...fixture.plan.conflicts[0], id: 'conflict.other' }
    fixture.plan.conflicts.push(other)
    const client = plannerClient(async () => fixture.preparation)
    vi.mocked(client.createConstrainedPlan).mockResolvedValue(replanResult())
    const deps = dependencies(fixture, client)
    renderPage(deps, fixture.plan.id)
    await clickSelection(user, 1)
    await waitFor(() => expect(deps.savePlannerResult).toHaveBeenCalledOnce())

    // The fresh input still carries the fallback default...
    const prepared = vi.mocked(client.prepareInteraction).mock.calls[1][1]
    expect(prepared.options).toEqual(defaultPlannerOptions)
    expect(fixture.input.options).toEqual({ maxPlanSteps: 1000 })
    // ...and only the recalculation request is given the derived bound.
    const [, merged, bounds] = vi.mocked(client.createConstrainedPlan).mock.calls[0]
    expect(merged.options).toEqual({ maxPlanSteps: expected })
    expect(merged.conflictResolutions).toEqual([
      { conflictKey: fixture.plan.conflicts[0].id, selectedBuildListEntryId: fixture.secondEntry.id },
      { conflictKey: other.id, selectedBuildListEntryId: fixture.entry.id },
    ])
    expect(bounds).toEqual({ maxCandidateTrialsPerConflict: 2, maxGeneratedBuildListEntries: 1, maxPlannerReruns: 4 })
  })

  it('saves nothing when the derived bound truncates the recalculation, and never points at the Build List input', async () => {
    const user = userEvent.setup()
    const fixture = withStepCount(multiParticipantFixture(), 1470)
    const client = plannerClient(async () => fixture.preparation)
    vi.mocked(client.createConstrainedPlan).mockResolvedValue({
      ...replanResult(createValidProductionPlan()),
      termination: incompletePlannerTermination(['max_plan_steps'], {
        limits: { maxPlanSteps: 2000 },
      }),
    })
    const deps = dependencies(fixture, client)
    const view = renderPage(deps, fixture.plan.id)
    await clickSelection(user, 1)

    expect(await screen.findByText(
      '競合解決の再計算が最大計画ステップ数 2,000 に到達したため、完成した生産計画を作成できませんでした。この上限は表示中の生産計画のステップ数から自動で決まります。ビルドリスト画面から生産計画を作り直してください。',
    )).toBeInTheDocument()
    expect(screen.queryByText(/「詳細設定」で探索上限を引き上げてから/)).not.toBeInTheDocument()
    expect(vi.mocked(client.createConstrainedPlan).mock.calls[0][1].options).toEqual({ maxPlanSteps: 2000 })
    expect(deps.inspectPlannerResultSave).not.toHaveBeenCalled()
    expect(deps.savePlannerResult).not.toHaveBeenCalled()
    expect(view.router.state.location.pathname).toBe('/plans/' + fixture.plan.id)
  })

  it('leaves the what-if comparison bounds and its input options unchanged', async () => {
    const user = userEvent.setup()
    const fixture = withStepCount(multiParticipantFixture(), 1470)
    const client = plannerClient(async () => fixture.preparation)
    const deps = dependencies(fixture, client)
    renderPage(deps, fixture.plan.id)
    const [compare] = await screen.findAllByRole('button', { name: '比較する' })
    await user.click(compare)

    await waitFor(() => expect(client.createWhatIfComparison).toHaveBeenCalledOnce())
    const [, request] = vi.mocked(client.createWhatIfComparison).mock.calls[0]
    expect(request.bounds).toEqual(defaultPlannerWhatIfBounds)
    expect(request.plannerInput.options).toEqual(defaultPlannerOptions)
    expect(client.createConstrainedPlan).not.toHaveBeenCalled()
  })
})
