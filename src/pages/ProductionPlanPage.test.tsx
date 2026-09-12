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
  type PlannerInput,
  type PlannerOrchestrationResult,
  type PlannerWhatIfCalculationResult,
} from '../domain/planner'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../domain/rng/production/productionRngEngine'
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
} from '../test/fixtures/plannerTermination'

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
      lotteries: [],
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
    savePlannerResult: vi.fn(async () => null),
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
  ], { initialEntries: [`/plans/${planId}`] })
  return { router, ...render(<RouterProvider router={router} />) }
}

describe('ProductionPlanPage', () => {
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
      async (_requestId, _request, callbacks) => {
        callbacks?.onProgress?.({ expandedStates: 3, maxExpandedStates: 8 })
        return pending.promise
      },
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
    expect(screen.getByText('比較中 3 / 8')).toBeInTheDocument()

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
    expect(screen.getByText('Plan ID: ' + fixture.plan.id)).toBeInTheDocument()
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
    vi.mocked(deps.savePlannerResult).mockResolvedValue(next.plan)
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
    expect(await screen.findByText('Plan ID: ' + next.plan.id)).toBeInTheDocument()
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
    expect(screen.getByText('Plan ID: ' + fixture.plan.id)).toBeInTheDocument()
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
    expect(screen.getByText('Plan ID: ' + fixture.plan.id)).toBeInTheDocument()
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

  it('shows progress, blocks comparisons and selections during rerun, and ignores results/progress after cancel', async () => {
    const user = userEvent.setup()
    const fixture = pageFixture()
    const pending = deferred<PlannerOrchestrationResult>()
    const client = plannerClient(async () => fixture.preparation)
    vi.mocked(client.createConstrainedPlan).mockImplementation(async (_id, _input, _bounds, callbacks) => {
      callbacks?.onProgress?.({ expandedStates: 3, maxExpandedStates: 10 })
      return pending.promise
    })
    const deps = dependencies(fixture, client)
    const view = renderPage(deps, fixture.plan.id)
    await clickSelection(user)
    expect(await screen.findByText('再計算中 3 / 10')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Planner再計算の進捗' })).toHaveAttribute('aria-valuenow', '30')
    expect(screen.getByRole('button', { name: '比較する' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'この候補を優先' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '比較する' }))
    expect(client.createWhatIfComparison).not.toHaveBeenCalled()
    const [requestId, , , callbacks] = vi.mocked(client.createConstrainedPlan).mock.calls[0]
    await user.click(screen.getByRole('button', { name: '再計算をキャンセル' }))
    expect(client.cancelPlan).toHaveBeenCalledWith(requestId)
    await act(async () => {
      callbacks?.onProgress?.({ expandedStates: 9, maxExpandedStates: 10 })
      pending.resolve(replanResult(createValidProductionPlan()))
    })
    expect(deps.savePlannerResult).not.toHaveBeenCalled()
    expect(view.router.state.location.pathname).toBe('/plans/' + fixture.plan.id)
    expect(screen.queryByText(/再計算中/)).not.toBeInTheDocument()
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
    expect(screen.queryByText('比較中')).not.toBeInTheDocument()
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
    const savePending = deferred<ProductionPlan | null>()
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
      savePending.resolve({ ...fixture.plan, id: productionPlanId('plan.late-save') })
    })
    expect(client.dispose).toHaveBeenCalledOnce()
    if (requestId !== null) expect(client.cancelPlan).toHaveBeenCalledWith(requestId)
    expect(client.prepareInteraction).toHaveBeenCalledTimes(preparationCount)
    expect(client.createConstrainedPlan).toHaveBeenCalledTimes(plannerCount)
    expect(deps.savePlannerResult).toHaveBeenCalledTimes(phase === 'save' ? 1 : 0)
    expect(navigate).toHaveBeenCalledTimes(navigationCount)
    if (change !== 'unmount') {
      expect(screen.getByText('Plan ID: ' + next.plan.id)).toBeInTheDocument()
      expect(screen.queryByText('Plan ID: ' + fixture.plan.id)).not.toBeInTheDocument()
      expect(screen.queryByText(/再計算中/)).not.toBeInTheDocument()
    }
  })
})


describe('ProductionPlanPage atomic save phase', () => {
  it('does not allow cancellation or another action once atomic save has started', async () => {
    const user = userEvent.setup()
    const fixture = pageFixture()
    const savePending = deferred<ProductionPlan | null>()
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
    await act(async () => savePending.resolve(null))
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
      const participant = label.parentElement?.parentElement
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
    expect(screen.getByText(`計画ID: ${fixture.plan.id}`)).toBeInTheDocument()
    expect(screen.getByText(`作成日時: ${fixture.plan.createdAt}`)).toBeInTheDocument()
    expect(screen.getByText('全ステップ数: 4')).toBeInTheDocument()
    expect(screen.getByText('目標武器数: 2')).toBeInTheDocument()
    // Only `expectedResult.shouldSecure === true`, never the Target count or
    // `selectedBuildListEntryIds.length`.
    expect(screen.getByText('確保予定数: 1')).toBeInTheDocument()
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

  it('marks only a shouldSecure step as 確保予定', async () => {
    const fixture = contentFixture()
    renderPage(contentDependencies(fixture), fixture.plan.id)

    await openPanel('全4ステップを表示')
    const secured = screen.getAllByText('確保予定')
    expect(secured).toHaveLength(1)
    expect(within(stepCard(4)).getByText('確保予定')).toBe(secured[0])
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
    expect(screen.getAllByText('実行中')).toHaveLength(2)
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
    expect(screen.getAllByText('実行中')).toHaveLength(2)
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
    expect(screen.getByText(`計画ID: ${fixture.plan.id}`)).toBeInTheDocument()
    expect(screen.getByText('全ステップ数: 4')).toBeInTheDocument()
    expect(screen.getByText('確保予定数: 1')).toBeInTheDocument()
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
      checkpointGroupId: 'checkpoint-group:page' as never,
      checkpointOpportunityId: 'checkpoint-opportunity:page' as never,
    }]
    const client = plannerClient(async () => fixture.preparation)
    const deps = dependencies(fixture, client)

    renderPage(deps, fixture.plan.id)

    // Once for the conflict, then once per unavailable participant.
    expect(await screen.findAllByText(
      'この競合には選択済みチェックポイントが関係しています。作成リストでチェックポイントを変更または解除してください。',
    )).toHaveLength(3)
    for (const name of ['比較する', 'この候補を優先']) {
      for (const button of screen.getAllByRole('button', { name })) {
        expect(button).toBeDisabled()
      }
    }
    const link = screen.getByRole('link', { name: 'ビルドリストでチェックポイントを変更' })
    expect(link).toHaveAttribute('href', '/build-list')
    expect(screen.getByRole('link', { name: 'ビルドリストへ戻る' })).toBeInTheDocument()
    expect(client.createWhatIfComparison).not.toHaveBeenCalled()
    expect(client.createConstrainedPlan).not.toHaveBeenCalled()
  })
})
