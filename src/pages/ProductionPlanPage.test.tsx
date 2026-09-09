import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  createMemoryRouter,
  RouterProvider,
} from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type {
  BuildListEntry,
  CalculationContext,
  PlanConflict,
  ProductionPlan,
  TargetWeapon,
} from '../domain/models/publicTypes'
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
  const plan = {
    ...createValidProductionPlan(),
    id: productionPlanId(`plan.page.${suffix}`),
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
        practical: {
          status: 'found',
          distance: {
            estimatedOperationCount: operationCount,
            estimatedGogmaAdvance: 2,
            estimatedSkillAdvance: 1,
            estimatedNormalAdvance: null,
          },
        },
        ideal: { status: 'not_found_within_search_extent' },
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
    getPlan: vi.fn(async () => fixture.plan),
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
    const firstClient = plannerClient(async () => first.preparation)
    const secondClient = plannerClient(async () => second.preparation)
    const deps = dependencies(first, firstClient)
    vi.mocked(deps.getPlan).mockImplementation((id) =>
      id === first.plan.id ? firstLoad.promise : Promise.resolve(second.plan))
    vi.mocked(deps.createInput).mockResolvedValue(second.input)
    vi.mocked(deps.createWorkerClient)
      .mockReturnValueOnce(firstClient)
      .mockReturnValueOnce(secondClient)
    const view = renderPage(deps, first.plan.id)

    await view.router.navigate(`/plans/${second.plan.id}`)
    expect(await screen.findByText(second.target.name)).toBeInTheDocument()
    firstLoad.resolve(first.plan)
    await waitFor(() => {
      expect(screen.queryByText(first.target.name)).not.toBeInTheDocument()
    })
    expect(deps.createInput).toHaveBeenCalledOnce()
    expect(firstClient.prepareInteraction).not.toHaveBeenCalled()
    expect(firstClient.dispose).toHaveBeenCalledOnce()
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

  it('uses the route input calculation context rather than a saved Plan snapshot', async () => {
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
    await screen.findByText(fixture.target.name)

    const context = vi.mocked(deps.createInput).mock.calls[0][0] as CalculationContext
    expect(context).toMatchObject({
      gameVersion: deps.master.manifest.gameVersion,
      masterDataVersion: deps.master.manifest.dataVersion,
      rngEngineVersion: client.engineVersion,
    })
    expect(context).not.toEqual(fixture.plan.baseSnapshot.calculationContext)
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
      maxCandidateTrialsPerCategoryPerTarget: 2,
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
  return { plan, conflicts: [], warnings: [], generatedBuildListEntries: [] }
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
      if (mode === 'no-result') result.comparison.alternatives[0].practical = { status: 'not_found_within_search_extent' }
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
