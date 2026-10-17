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
  createPlanningBuildListEntriesHash,
  createPlanningTargetWeaponsHash,
  defaultPlannerOptions,
  type PlannerInput,
  type PlannerResult,
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
} from '../test/fixtures/plannerTermination'
import { useSettingsStore } from '../stores/settingsStore'
import { createActualExecutionState, ExecutionRuntimeError } from '../domain/execution'
import type { ProductionPlanStartInspection } from '../services/execution/productionPlanExecutionService'
import type { ProductionPlanReplanDependencies } from '../services/execution/productionPlanReplanDependencies'
import { conflictResolutionPlannerOptions } from '../services/planner/plannerRuntimeOptions'
import { RepositoryError } from '../db/repositoryError'

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

/**
 * The Production Plan screen's 「この候補を優先」 runs the ordinary `createPlan()`
 * since Issue #278 PR-2. The Planner Alternative Client methods stay on the
 * Client until a later cleanup and must never be reached from this page.
 */
function plannerClient(
  prepareInteraction: PlannerWorkerClient['prepareInteraction'],
): PlannerWorkerClient {
  return {
    engineVersion: PRODUCTION_RNG_ENGINE_VERSION,
    createPlan: vi.fn(),
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

function dependencies(
  fixture = pageFixture(),
  client = plannerClient(async () => fixture.preparation),
): ProductionPlanPageDependencies {
  return {
    master: createValidMasterDataFixture(),
    currentCalculationContext: { ...fixture.plan.calculationContext },
    getPlan: vi.fn(async () => fixture.plan),
    getTargetWeapons: vi.fn(async () => fixture.input.targetWeapons),
    getBuildListEntries: vi.fn(async () => fixture.input.buildListEntries),
    createInput: vi.fn(async () => fixture.input),
    createWorkerClient: vi.fn(() => client),
    savePlannerConflictPreferenceResult: vi.fn(async (result) => ({ kind: 'saved' as const, plan: result.plan as ProductionPlan })),
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
    expect(deps.savePlannerConflictPreferenceResult).not.toHaveBeenCalled()
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
    // Text badges: the recommendation is a reference only, the selection is
    // the persisted explicit decision, and the Conflict says it is decided.
    expect(screen.getByText('Planner推奨（参考）')).toBeInTheDocument()
    expect(screen.getByText('優先（選択済み）')).toBeInTheDocument()
    expect(screen.getByText('選択済み')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'この候補を優先' })).toBeEnabled()
    expect(client.createPlan).not.toHaveBeenCalled()
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

    // The typed warning kind is named in Japanese; the internal English issue
    // and warning messages stay out of the normal UI (UI_FLOW 11.6.4).
    expect(await screen.findByText('現在の作成リストと状態では、競合を確認できません')).toBeInTheDocument()
    expect(screen.getByText('再検索が必要なビルドリスト項目があります')).toBeInTheDocument()
    expect(screen.queryByText(/Typed fixture issue/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Typed fixture warning/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'この候補を優先' })).not.toBeInTheDocument()
  })

  it('shows the raw invalid preparation messages only in Debug Mode', async () => {
    const fixture = pageFixture()
    const invalid: PlannerInteractionPreparationResult = {
      status: 'invalid',
      issues: [{ path: 'fixture', code: 'invalid_integer', message: 'Typed fixture issue' }],
      warnings: [{ kind: 'build_list_entry_stale', message: 'Typed fixture warning' }],
      excludedBuildListEntries: [],
    }
    useSettingsStore.setState({ debugMode: true })
    try {
      renderPage(dependencies(fixture, plannerClient(async () => invalid)), fixture.plan.id)
      expect(await screen.findByText('fixture: Typed fixture issue')).toBeInTheDocument()
      expect(screen.getByText('build_list_entry_stale: Typed fixture warning')).toBeInTheDocument()
    } finally {
      useSettingsStore.setState({ debugMode: false })
    }
  })

  it('shows the Planner exclusion reason before a missing current Conflict reason', async () => {
    const fixture = pageFixture()
    const excludedReason = 'uses an RNG Engine incompatible with CalculationContext.'
    const excluded: PlannerInteractionPreparationResult = {
      status: 'ready',
      validBuildListEntryIds: [],
      excludedBuildListEntries: [{
        buildListEntryId: fixture.entry.id,
        kind: 'calculation_context_incompatible',
        reason: excludedReason,
      }],
      currentConflicts: [],
    }
    const deps = dependencies(
      fixture,
      plannerClient(async () => excluded),
    )

    renderPage(deps, fixture.plan.id)

    // The participant's own reason comes from the typed exclusion kind; the
    // English validation reason is never shown.
    expect(await screen.findByText(
      'この候補は以前の計算方式で作成されたため、今回の計画には使えません。候補を検索し直してください。',
    )).toBeInTheDocument()
    expect(screen.queryByText(excludedReason)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'この候補を優先' })).not.toBeInTheDocument()
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

    // The internal error text stays out of the normal UI; a fixed Japanese
    // sentence says what happened (UI_FLOW 11.6.4).
    expect(await screen.findByText('生産計画の現在状態を確認できませんでした。画面を再読み込みしてください。'))
      .toBeInTheDocument()
    expect(screen.queryByText('Unexpected preparation failure')).not.toBeInTheDocument()
    expect(screen.queryByText(/競合を確認できません/))
      .not.toBeInTheDocument()
  })

  it('shows an unexpected Worker error text only in Debug Mode', async () => {
    const fixture = pageFixture()
    useSettingsStore.setState({ debugMode: true })
    try {
      renderPage(dependencies(fixture, plannerClient(async () => {
        throw new Error('Unexpected preparation failure')
      })), fixture.plan.id)
      expect(await screen.findByText('Unexpected preparation failure')).toBeInTheDocument()
    } finally {
      useSettingsStore.setState({ debugMode: false })
    }
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

  it('offers no 比較する and says what preferring a participant means before it is pressed', async () => {
    const fixture = multiParticipantFixture()
    const client = plannerClient(async () => fixture.preparation)
    const deps = dependencies(fixture, client)
    renderPage(deps, fixture.plan.id)

    const buttons = await screen.findAllByRole('button', { name: 'この候補を優先' })
    expect(buttons).toHaveLength(2)
    expect(screen.queryByRole('button', { name: '比較する' })).not.toBeInTheDocument()
    // The selected participant: pressing it recalculates the same decision.
    expect(screen.getByText(
      'この候補を優先しています。押すと、同じ選択のまま、現在の作成リストと状態から生産計画を計算し直します。',
    )).toBeInTheDocument()
    // The other participant: preferring it leaves the selected one unmade.
    expect(screen.getByText(
      `この候補を優先すると、「${fixture.target.name}」は今回の生産計画では作成しません。作成リストの候補は残ります。`,
    )).toBeInTheDocument()
    expect(client.createPlan).not.toHaveBeenCalled()
  })
})

/**
 * A conflict-resolution result of `plan`: an ordinary `createPlan()` result
 * whose preferred Entries all completed unless `outcome` says otherwise.
 */
function preferenceResult(
  plan: ProductionPlan | null,
  overrides: Partial<PlannerResult> = {},
): PlannerResult {
  return {
    plan,
    conflicts: plan?.conflicts ?? [],
    warnings: [],
    termination: completedPlannerTermination(),
    conflictResolutionOutcome: { preferredEntries: [], allPreferredEntriesCompleted: true },
    ...overrides,
  }
}

async function clickSelection(user: ReturnType<typeof userEvent.setup>, index = 0) {
  const buttons = await screen.findAllByRole('button', { name: 'この候補を優先' })
  expect(buttons[index]).toBeEnabled()
  await user.click(buttons[index])
}

/**
 * Three participants and two persisted decisions of the displayed Draft:
 * conflict X = {first, second} preferring first, conflict Y = {first, third}
 * preferring first. Preferring second on X supersedes Y (its preferred Entry is
 * one X no longer selects).
 */
function supersedingFixture() {
  const fixture = multiParticipantFixture()
  const thirdEntry = structuredClone(fixture.entry)
  const thirdTarget = structuredClone(fixture.target)
  thirdEntry.id = buildListEntryId('build-list.page.multi.third')
  thirdEntry.targetWeaponId = targetWeaponId('target.page.multi.third')
  thirdEntry.candidateSnapshot.targetWeaponId = thirdEntry.targetWeaponId
  thirdTarget.id = thirdEntry.targetWeaponId
  thirdTarget.name = 'Page fixture target multi third'
  fixture.input.buildListEntries.push(thirdEntry)
  fixture.input.targetWeapons.push(thirdTarget)
  const conflictY: PlanConflict = {
    id: 'conflict.page.y',
    kind: 'same_skill_counter',
    buildListEntryIds: [fixture.entry.id, thirdEntry.id],
    reason: 'Persisted fixture conflict Y',
    recommendedBuildListEntryId: fixture.entry.id,
    selectedBuildListEntryId: fixture.entry.id,
    resolutionNote: null,
    checkpointParticipants: [],
  }
  fixture.plan.conflicts.push(conflictY)
  fixture.preparation = {
    status: 'ready',
    validBuildListEntryIds: [fixture.entry.id, fixture.secondEntry.id, thirdEntry.id],
    excludedBuildListEntries: [],
    currentConflicts: [
      { id: fixture.plan.conflicts[0].id, buildListEntryIds: [fixture.entry.id, fixture.secondEntry.id], checkpointParticipants: [] },
      { id: conflictY.id, buildListEntryIds: [fixture.entry.id, thirdEntry.id], checkpointParticipants: [] },
    ],
  }
  return { ...fixture, thirdEntry, thirdTarget, conflictY }
}

describe('ProductionPlanPage explicit selection (Issue #278 ordinary Planner)', () => {
  it('prefers from a fresh input with the Domain decision set, runs only createPlan with the derived options, and saves against the displayed Draft', async () => {
    const user = userEvent.setup()
    const fixture = multiParticipantFixture()
    const fresh = structuredClone(fixture.input)
    fresh.rngState.notes = 'selection-time state'
    const beforePlan = structuredClone(fixture.plan)
    const client = plannerClient(async () => fixture.preparation)
    const saved = { ...pageFixture('saved').plan }
    const result = preferenceResult({ ...structuredClone(fixture.plan), id: productionPlanId('plan.worker-only') })
    vi.mocked(client.createPlan).mockResolvedValue(result)
    const deps = dependencies(fixture, client)
    vi.mocked(deps.createInput).mockResolvedValueOnce(fixture.input).mockResolvedValueOnce(fresh)
    vi.mocked(deps.getPlan).mockImplementation(async (id) => id === saved.id ? saved : fixture.plan)
    vi.mocked(deps.savePlannerConflictPreferenceResult).mockResolvedValue({ kind: 'saved', plan: saved })
    const view = renderPage(deps, fixture.plan.id)

    await clickSelection(user, 1)
    await waitFor(() => expect(view.router.state.location.pathname).toBe('/plans/' + saved.id))
    // The page load, the press (and the saved Draft's own load afterwards).
    expect(vi.mocked(deps.createInput).mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(client.createPlan).toHaveBeenCalledOnce()
    const [, runInput] = vi.mocked(client.createPlan).mock.calls[0]
    expect(runInput.rngState).toBe(fresh.rngState)
    // The earlier decision of the same conflict is replaced by this one.
    expect(runInput.conflictResolutions).toEqual([
      { conflictKey: fixture.plan.conflicts[0].id, selectedBuildListEntryId: fixture.secondEntry.id },
    ])
    expect(runInput.options).toEqual(conflictResolutionPlannerOptions(fixture.plan))
    // No Planner Alternative search, scenario or repair can start: the one
    // calculation is the `createPlan` above, and since Issue #278 PR-4 the
    // Client has no Planner Alternative entry point at all.
    expect(deps.savePlannerConflictPreferenceResult).toHaveBeenCalledOnce()
    const [savedResult, context, saveContext] = vi.mocked(deps.savePlannerConflictPreferenceResult).mock.calls[0]
    expect(savedResult).toBe(result)
    // The source Draft is the Draft the user acted on, never the calculated
    // Plan's ID nor the Draft opened after the save.
    expect(context).toEqual({
      conflictResolutions: runInput.conflictResolutions,
      expectedSourceDraftId: fixture.plan.id,
    })
    expect(saveContext.rngEngineVersion).toBe(client.engineVersion)
    expect(fixture.plan).toEqual(beforePlan)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('asks before dropping an earlier decision: キャンセル runs nothing, the confirmation runs the reduced set', async () => {
    const user = userEvent.setup()
    const fixture = supersedingFixture()
    const client = plannerClient(async () => fixture.preparation)
    vi.mocked(client.createPlan).mockResolvedValue(preferenceResult(null))
    const deps = dependencies(fixture, client)
    renderPage(deps, fixture.plan.id)

    // The second participant of conflict X.
    await clickSelection(user, 1)
    let dialog = await screen.findByRole('dialog', { name: '以前の選択を変更して再計算しますか？' })
    expect(within(dialog).getByText(
      `以前の選択「${fixture.target.name}を優先」を取り消します（今回の選択で、その候補は作成しない候補になります）。`,
    )).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'キャンセル' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(client.createPlan).not.toHaveBeenCalled()
    expect(deps.savePlannerConflictPreferenceResult).not.toHaveBeenCalled()

    await clickSelection(user, 1)
    dialog = await screen.findByRole('dialog', { name: '以前の選択を変更して再計算しますか？' })
    await user.click(within(dialog).getByRole('button', { name: 'この候補を優先して再計算' }))
    await waitFor(() => expect(client.createPlan).toHaveBeenCalledOnce())
    expect(vi.mocked(client.createPlan).mock.calls[0][1].conflictResolutions).toEqual([
      { conflictKey: fixture.plan.conflicts[0].id, selectedBuildListEntryId: fixture.secondEntry.id },
    ])
    expect(await screen.findByText('この選択では生産計画を作成できませんでした。表示中の生産計画は変更していません。')).toBeInTheDocument()
    expect(deps.savePlannerConflictPreferenceResult).not.toHaveBeenCalled()
  })

  it('lists an earlier decision the current input cannot reproduce before running', async () => {
    const user = userEvent.setup()
    const fixture = multiParticipantFixture()
    fixture.plan.conflicts.push({ ...fixture.plan.conflicts[0], id: 'conflict.page.gone' })
    const client = plannerClient(async () => fixture.preparation)
    const deps = dependencies(fixture, client)
    renderPage(deps, fixture.plan.id)

    await clickSelection(user, 1)
    const dialog = await screen.findByRole('dialog', { name: '以前の選択を変更して再計算しますか？' })
    expect(within(dialog).getByText('以前の選択のうち次のものは、現在の作成リストでは再現できないため引き継ぎません。')).toBeInTheDocument()
    expect(within(dialog).getByText(
      `以前の選択「${fixture.target.name}を優先」は引き継ぎません（現在の入力にその競合がありません）。`,
    )).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'キャンセル' }))
    expect(client.createPlan).not.toHaveBeenCalled()
  })

  it('refuses before calculating when two preferred Entries meet in an undecided conflict', async () => {
    const user = userEvent.setup()
    const fixture = supersedingFixture()
    // Y now prefers third; W = {second, third} is undecided.
    fixture.plan.conflicts[1].selectedBuildListEntryId = fixture.thirdEntry.id
    if (fixture.preparation.status !== 'ready') throw new Error('fixture')
    fixture.preparation.currentConflicts.push({
      id: 'conflict.page.w',
      buildListEntryIds: [fixture.secondEntry.id, fixture.thirdEntry.id],
      checkpointParticipants: [],
    })
    const client = plannerClient(async () => fixture.preparation)
    const deps = dependencies(fixture, client)
    renderPage(deps, fixture.plan.id)

    await clickSelection(user, 1)
    expect(await screen.findByText('優先した候補どうしが両立しないため、計算を開始しませんでした')).toBeInTheDocument()
    expect(screen.getByText(
      `優先した「${fixture.secondTarget.name}」、「${fixture.thirdTarget.name}」は、まだ選んでいない競合で両立しません。先にその競合でどちらを優先するか選んでください。`,
    )).toBeInTheDocument()
    expect(client.createPlan).not.toHaveBeenCalled()
    expect(deps.savePlannerConflictPreferenceResult).not.toHaveBeenCalled()
  })

  it('CRITICAL: an invalid_conflict_resolution result saves nothing and tries no other participant', async () => {
    const user = userEvent.setup()
    const fixture = pageFixture()
    const before = structuredClone(fixture.plan)
    const client = plannerClient(async () => fixture.preparation)
    vi.mocked(client.createPlan).mockResolvedValue(preferenceResult(structuredClone(fixture.plan), {
      warnings: [{ kind: 'invalid_conflict_resolution', message: 'refused' }],
    }))
    const deps = dependencies(fixture, client)
    const view = renderPage(deps, fixture.plan.id)
    const navigate = vi.spyOn(view.router, 'navigate')
    await clickSelection(user)
    expect(await screen.findByText(/選択した競合候補を現在の状態では優先できませんでした/)).toBeInTheDocument()
    expect(deps.savePlannerConflictPreferenceResult).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
    expect(summaryValue('計画ID')).toBe(fixture.plan.id)
    expect(fixture.plan).toEqual(before)
    expect(client.createPlan).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'この候補を優先' })).toBeEnabled()
  })

  it('a message resembling an invalid warning is not the typed kind: the result is saved', async () => {
    const user = userEvent.setup()
    const fixture = pageFixture()
    const client = plannerClient(async () => fixture.preparation)
    vi.mocked(client.createPlan).mockResolvedValue(preferenceResult(structuredClone(fixture.plan), {
      warnings: [{ kind: 'max_steps_reached', message: 'invalid_conflict_resolution' }],
    }))
    const deps = dependencies(fixture, client)
    renderPage(deps, fixture.plan.id)
    await clickSelection(user)
    await waitFor(() => expect(deps.savePlannerConflictPreferenceResult).toHaveBeenCalledOnce())
  })

  it('never saves a result whose preferred Entry is not completed, and names the typed cause', async () => {
    const user = userEvent.setup()
    const fixture = multiParticipantFixture()
    const client = plannerClient(async () => fixture.preparation)
    vi.mocked(client.createPlan).mockResolvedValue(preferenceResult(structuredClone(fixture.plan), {
      conflictResolutionOutcome: {
        allPreferredEntriesCompleted: false,
        preferredEntries: [{
          buildListEntryId: fixture.secondEntry.id,
          targetWeaponId: fixture.secondTarget.id,
          status: 'incomplete',
          cause: { kind: 'deadlock_or_stall' },
        }],
      },
    }))
    const deps = dependencies(fixture, client)
    const view = renderPage(deps, fixture.plan.id)
    await clickSelection(user, 1)

    expect(await screen.findByText(
      `優先した「${fixture.secondTarget.name}」は、この選択では完成できないため、生産計画を保存していません`,
    )).toBeInTheDocument()
    expect(screen.getByText(`${fixture.secondTarget.name}: 計画の途中で手順が行き詰まり、作成を続けられませんでした。`)).toBeInTheDocument()
    expect(deps.savePlannerConflictPreferenceResult).not.toHaveBeenCalled()
    expect(view.router.state.location.pathname).toBe('/plans/' + fixture.plan.id)
  })

  it('fails closed when the result carries no completion judgement', async () => {
    const user = userEvent.setup()
    const fixture = pageFixture()
    const client = plannerClient(async () => fixture.preparation)
    const result = preferenceResult(structuredClone(fixture.plan))
    delete result.conflictResolutionOutcome
    vi.mocked(client.createPlan).mockResolvedValue(result)
    const deps = dependencies(fixture, client)
    renderPage(deps, fixture.plan.id)
    await clickSelection(user)
    expect(await screen.findByText('優先した候補が完成するか確認できないため、生産計画を保存していません')).toBeInTheDocument()
    expect(deps.savePlannerConflictPreferenceResult).not.toHaveBeenCalled()
  })

  it('reports a typed save refusal and keeps the displayed Draft', async () => {
    const user = userEvent.setup()
    const fixture = pageFixture()
    const client = plannerClient(async () => fixture.preparation)
    vi.mocked(client.createPlan).mockResolvedValue(preferenceResult(structuredClone(fixture.plan)))
    const deps = dependencies(fixture, client)
    vi.mocked(deps.savePlannerConflictPreferenceResult).mockRejectedValue(
      new RepositoryError('planner_state_changed', 'The current Draft was replaced.'),
    )
    const view = renderPage(deps, fixture.plan.id)
    await clickSelection(user)
    expect(await screen.findByText(/計算した後に、表示していた生産計画（下書き）・作成リスト・目標武器・所持武器・RNG状態のいずれかが変わったため、保存しませんでした/)).toBeInTheDocument()
    expect(view.router.state.location.pathname).toBe('/plans/' + fixture.plan.id)
    expect(screen.queryByText('The current Draft was replaced.')).not.toBeInTheDocument()
  })

  it.each(['planner', 'save'] as const)('keeps the old Plan on %s failure and allows explicit retry', async (failure) => {
    const user = userEvent.setup()
    const fixture = pageFixture()
    const before = structuredClone(fixture.plan)
    const client = plannerClient(async () => fixture.preparation)
    vi.mocked(client.createPlan).mockResolvedValue(preferenceResult(createValidProductionPlan()))
    const deps = dependencies(fixture, client)
    if (failure === 'planner') vi.mocked(client.createPlan).mockRejectedValueOnce(new Error('Planner failed'))
    else vi.mocked(deps.savePlannerConflictPreferenceResult).mockRejectedValueOnce(new Error('Atomic save rejected'))
    const view = renderPage(deps, fixture.plan.id)
    await clickSelection(user)
    expect(await screen.findByText(failure === 'planner'
      ? '生産計画の再計算に失敗しました。表示中の生産計画は変更していません。もう一度確認してください。'
      : '生産計画の保存に失敗しました。生産計画一覧で現在の状態を確認してください。')).toBeInTheDocument()
    // The internal error text never reaches the normal display (UI_FLOW 11.6.4).
    expect(screen.queryByText(/Planner failed|Atomic save rejected/)).not.toBeInTheDocument()
    expect(view.router.state.location.pathname).toBe('/plans/' + fixture.plan.id)
    expect(summaryValue('計画ID')).toBe(fixture.plan.id)
    expect(fixture.plan).toEqual(before)
    await clickSelection(user)
    await waitFor(() => expect(client.createPlan).toHaveBeenCalledTimes(2))
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
    expect(await screen.findByText('現在の状態が変化したため、この候補を優先できませんでした。')).toBeInTheDocument()
    expect(screen.getByText(status === 'invalid'
      ? '現在の作成リストと状態では、競合を確認できません'
      : '作成リスト・目標武器・状態が計算時から変わったため、この選択は現在の入力では再現できず、次に優先を選び直すときは引き継がれません。')).toBeInTheDocument()
    expect(screen.queryByText('Typed action invalid')).not.toBeInTheDocument()
    // A participant the refreshed preparation no longer allows has no action at all.
    expect(screen.queryByRole('button', { name: 'この候補を優先' })).not.toBeInTheDocument()
    expect(client.createPlan).not.toHaveBeenCalled()
    expect(deps.savePlannerConflictPreferenceResult).not.toHaveBeenCalled()
  })

  it('shows an indeterminate running state, blocks selections during the run, and ignores results after cancel', async () => {
    const user = userEvent.setup()
    const fixture = pageFixture()
    const pending = deferred<PlannerResult>()
    const client = plannerClient(async () => fixture.preparation)
    vi.mocked(client.createPlan).mockImplementation(async () => pending.promise)
    const deps = dependencies(fixture, client)
    const view = renderPage(deps, fixture.plan.id)
    await clickSelection(user)
    expect(await screen.findByText('再計算しています…')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Planner再計算中' })).not.toHaveAttribute('aria-valuenow')
    expect(screen.getByRole('button', { name: 'この候補を優先' })).toBeDisabled()
    const [requestId] = vi.mocked(client.createPlan).mock.calls[0]
    expect(vi.mocked(client.createPlan).mock.calls[0]).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: '再計算をキャンセル' }))
    expect(client.cancelPlan).toHaveBeenCalledWith(requestId)
    await act(async () => {
      pending.resolve(preferenceResult(createValidProductionPlan()))
    })
    expect(deps.savePlannerConflictPreferenceResult).not.toHaveBeenCalled()
    expect(view.router.state.location.pathname).toBe('/plans/' + fixture.plan.id)
    expect(screen.queryByText('再計算しています…')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'この候補を優先' })).toBeEnabled()
  })

  it('does not display PlannerCancelledError as a failure', async () => {
    const user = userEvent.setup()
    const fixture = pageFixture()
    const client = plannerClient(async () => fixture.preparation)
    vi.mocked(client.createPlan).mockRejectedValue(new PlannerCancelledError())
    const deps = dependencies(fixture, client)
    renderPage(deps, fixture.plan.id)
    await clickSelection(user)
    await waitFor(() => expect(screen.getByRole('button', { name: 'この候補を優先' })).toBeEnabled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(deps.savePlannerConflictPreferenceResult).not.toHaveBeenCalled()
  })

  it.each(['input', 'preparation', 'planner'] as const)('cancel during %s prevents all later UI effects and unstarted work', async (phase) => {
    const user = userEvent.setup()
    const fixture = pageFixture()
    const inputPending = deferred<PlannerInput>()
    const preparationPending = deferred<PlannerInteractionPreparationResult>()
    const plannerPending = deferred<PlannerResult>()
    const client = plannerClient(async () => fixture.preparation)
    vi.mocked(client.createPlan).mockReturnValue(phase === 'planner' ? plannerPending.promise : Promise.resolve(preferenceResult(createValidProductionPlan())))
    const deps = dependencies(fixture, client)
    if (phase === 'input') vi.mocked(deps.createInput).mockResolvedValueOnce(fixture.input).mockReturnValueOnce(inputPending.promise)
    if (phase === 'preparation') vi.mocked(client.prepareInteraction).mockResolvedValueOnce(fixture.preparation).mockReturnValueOnce(preparationPending.promise)
    const view = renderPage(deps, fixture.plan.id)
    await clickSelection(user)
    await user.click(screen.getByRole('button', { name: '再計算をキャンセル' }))
    await act(async () => {
      inputPending.resolve(fixture.input)
      preparationPending.resolve(fixture.preparation)
      plannerPending.resolve(preferenceResult(createValidProductionPlan()))
    })
    if (phase === 'input') expect(client.prepareInteraction).toHaveBeenCalledOnce()
    if (phase === 'input' || phase === 'preparation') expect(client.createPlan).not.toHaveBeenCalled()
    expect(deps.savePlannerConflictPreferenceResult).not.toHaveBeenCalled()
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
    expect(await screen.findByText({
      stale: 'この生産計画は再計算が必要なため、優先する候補を選べません。',
      active: '実行中の生産計画では、優先する候補を変更できません。',
      completed: '完了した生産計画では、優先する候補を変更できません。',
      abandoned: '終了した生産計画では、優先する候補を変更できません。',
    }[status])).toBeInTheDocument()
    // Only a participant the current preparation allows gets the action.
    expect(screen.queryByRole('button', { name: 'この候補を優先' })).not.toBeInTheDocument()
    if (status === 'stale') {
      expect(deps.createInput).not.toHaveBeenCalled()
      expect(client.prepareInteraction).not.toHaveBeenCalled()
    }
    expect(client.createPlan).not.toHaveBeenCalled()
    expect(deps.savePlannerConflictPreferenceResult).not.toHaveBeenCalled()
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
    const plannerPending = deferred<PlannerResult>()
    const savePending = deferred<Awaited<ReturnType<ProductionPlanPageDependencies['savePlannerConflictPreferenceResult']>>>()
    const client = plannerClient(async () => fixture.preparation)
    vi.mocked(client.createPlan).mockReturnValue(phase === 'planner' ? plannerPending.promise : Promise.resolve(preferenceResult(createValidProductionPlan())))
    const deps = dependencies(fixture, client)
    if (phase === 'input') vi.mocked(deps.createInput).mockResolvedValueOnce(fixture.input).mockReturnValueOnce(inputPending.promise)
    if (phase === 'preparation') vi.mocked(client.prepareInteraction).mockResolvedValueOnce(fixture.preparation).mockReturnValueOnce(preparationPending.promise)
    if (phase === 'save') vi.mocked(deps.savePlannerConflictPreferenceResult).mockReturnValue(savePending.promise)
    const nextClient = plannerClient(async () => next.preparation)
    const nextDeps = dependencies(next, nextClient)
    const router = createMemoryRouter([
      { path: '/plans/:planId', element: <ProductionPlanPage dependencies={deps} /> },
    ], { initialEntries: ['/plans/' + fixture.plan.id] })
    const view = render(<RouterProvider router={router} />)
    const navigate = vi.spyOn(router, 'navigate')
    await clickSelection(user)
    if (phase === 'save') await waitFor(() => expect(deps.savePlannerConflictPreferenceResult).toHaveBeenCalledOnce())
    if (phase === 'planner') await waitFor(() => expect(client.createPlan).toHaveBeenCalledOnce())
    if (phase === 'preparation') await waitFor(() => expect(client.prepareInteraction).toHaveBeenCalledTimes(2))
    const requestId = phase === 'preparation'
      ? vi.mocked(client.prepareInteraction).mock.calls[1][0]
      : phase === 'planner' ? vi.mocked(client.createPlan).mock.calls[0][0] : null
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
    const plannerCount = vi.mocked(client.createPlan).mock.calls.length
    await act(async () => {
      inputPending.resolve(fixture.input)
      preparationPending.resolve(fixture.preparation)
      plannerPending.resolve(preferenceResult(createValidProductionPlan()))
      savePending.resolve({ kind: 'saved', plan: { ...fixture.plan, id: productionPlanId('plan.late-save') } })
    })
    expect(client.dispose).toHaveBeenCalledOnce()
    if (requestId !== null) expect(client.cancelPlan).toHaveBeenCalledWith(requestId)
    expect(client.prepareInteraction).toHaveBeenCalledTimes(preparationCount)
    expect(client.createPlan).toHaveBeenCalledTimes(plannerCount)
    expect(deps.savePlannerConflictPreferenceResult).toHaveBeenCalledTimes(phase === 'save' ? 1 : 0)
    expect(navigate).toHaveBeenCalledTimes(navigationCount)
    if (change !== 'unmount') {
      expect(summaryValue('計画ID')).toBe(next.plan.id)
      expect(summaryValue('計画ID')).not.toBe(fixture.plan.id)
      expect(screen.queryByText('再計算しています…')).not.toBeInTheDocument()
    }
  })

  it('runs nothing when the page leaves while the confirmation is open', async () => {
    const user = userEvent.setup()
    const fixture = supersedingFixture()
    const client = plannerClient(async () => fixture.preparation)
    const deps = dependencies(fixture, client)
    const view = renderPage(deps, fixture.plan.id)
    await clickSelection(user, 1)
    await screen.findByRole('dialog', { name: '以前の選択を変更して再計算しますか？' })
    view.unmount()
    await act(async () => undefined)
    expect(client.createPlan).not.toHaveBeenCalled()
    expect(deps.savePlannerConflictPreferenceResult).not.toHaveBeenCalled()
  })
})


describe('ProductionPlanPage atomic save phase', () => {
  it('does not allow cancellation or another action once atomic save has started', async () => {
    const user = userEvent.setup()
    const fixture = pageFixture()
    const savePending = deferred<Awaited<ReturnType<ProductionPlanPageDependencies['savePlannerConflictPreferenceResult']>>>()
    const client = plannerClient(async () => fixture.preparation)
    vi.mocked(client.createPlan).mockResolvedValue(preferenceResult(createValidProductionPlan()))
    const deps = dependencies(fixture, client)
    vi.mocked(deps.savePlannerConflictPreferenceResult).mockReturnValue(savePending.promise)
    renderPage(deps, fixture.plan.id)
    await clickSelection(user)
    await waitFor(() => expect(deps.savePlannerConflictPreferenceResult).toHaveBeenCalledOnce())
    expect(screen.getByText('生産計画を保存しています。')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: '生産計画を保存中' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '再計算をキャンセル' })).not.toBeInTheDocument()
    const select = screen.getByRole('button', { name: 'この候補を優先' })
    expect(select).toBeDisabled()
    fireEvent.click(select)
    expect(client.createPlan).toHaveBeenCalledOnce()
    expect(deps.createInput).toHaveBeenCalledTimes(2)
    expect(client.cancelPlan).not.toHaveBeenCalled()
    await act(async () => savePending.reject(new Error('Atomic save rejected')))
    expect(await screen.findByText('生産計画の保存に失敗しました。生産計画一覧で現在の状態を確認してください。')).toBeInTheDocument()
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

    // Participants are named by their current Target, read independently of
    // the (absent) preparation; no internal ID is shown (UI_FLOW 11.6.3 / 11.6.4).
    const list = await screen.findByRole('list', { name: '競合 1 の参加候補' })
    await waitFor(() => expect(within(list).getAllByRole('heading', { level: 4 })
      .map((heading) => heading.textContent)).toEqual([fixture.target.name, fixture.secondTarget.name]))
    const headings = within(list).getAllByRole('heading', { level: 4 })
    for (const [index, heading] of headings.entries()) {
      const participant = heading.closest('li')
      if (!participant) throw new Error('Missing stale participant card')
      const card = within(participant)
      expect(card.queryByText('Planner推奨（参考）') !== null).toBe(index === 0)
      expect(card.queryByText('優先（選択済み）') !== null).toBe(index === 1)
      expect(card.queryByText('今回は作成しない') !== null).toBe(index === 0)
      expect(card.queryByRole('button', { name: 'この候補を優先' })).not.toBeInTheDocument()
    }
    expect(screen.queryByText(/BuildListEntry ID/)).not.toBeInTheDocument()
    expect(screen.queryByText(fixture.entry.id, { exact: false })).not.toBeInTheDocument()
    expect(deps.getPlan).toHaveBeenCalledExactlyOnceWith(fixture.plan.id)
    expect(deps.createInput).not.toHaveBeenCalled()
    expect(client.prepareInteraction).not.toHaveBeenCalled()
    expect(client.createPlan).not.toHaveBeenCalled()
    expect(deps.savePlannerConflictPreferenceResult).not.toHaveBeenCalled()
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
    expect(screen.getByText('この生産計画は再計算が必要なため、優先する候補を選べません。')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'この候補を優先' })).not.toBeInTheDocument()
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
    expect(screen.queryByRole('button', { name: 'この候補を優先' })).not.toBeInTheDocument()
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

    expect(await screen.findByText('生産計画の現在状態を確認できませんでした。画面を再読み込みしてください。')).toBeInTheDocument()
    expect(screen.queryByText('準備に失敗しました。')).not.toBeInTheDocument()
    expect(screen.getByText('現在の保存状態を確認できなかったため、優先する候補を選べません。画面を再読み込みしてください。'))
      .toBeInTheDocument()
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

    expect(await screen.findByText('生産計画の現在状態を確認できませんでした。画面を再読み込みしてください。')).toBeInTheDocument()
    expect(screen.queryByText('Workerを生成できませんでした。')).not.toBeInTheDocument()
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

    // Said once, for the whole conflict; the participant whose checkpoint is on
    // the line says so, and no participant can be preferred.
    expect(await screen.findAllByText(
      'この競合には途中採用する状態の選択が関係しています。作成リストで途中採用する状態を変更または解除してください。',
    )).toHaveLength(1)
    expect(screen.getByText('途中採用状態の変更が必要')).toBeInTheDocument()
    expect(screen.getAllByText('この候補の途中採用する状態の選択が、この競合に関係しています。')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'この候補を優先' })).not.toBeInTheDocument()
    // The conflict's own link is the way on; no second generic link repeats it.
    const link = screen.getByRole('link', { name: 'ビルドリストで途中採用する状態を変更' })
    expect(link).toHaveAttribute('href', '/build-list')
    expect(screen.queryByRole('link', { name: 'ビルドリストへ戻る' })).not.toBeInTheDocument()
    expect(client.createPlan).not.toHaveBeenCalled()
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

  it('discloses the persisted rejected Entries by their typed reason label only', async () => {
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
    // The internal detail and Entry ID are Debug Mode only (UI_FLOW 11.6.4).
    expect(within(list).queryByText(/Persisted rejection detail|Second detail/)).not.toBeInTheDocument()
    expect(within(list).queryByText(/BuildListEntry ID/)).not.toBeInTheDocument()
    expect(within(items[1]).getByText('より短い作成ルートの候補を優先しました')).toBeInTheDocument()
  })

  it('shows the rejected Entry detail and ID only in Debug Mode', async () => {
    const fixture = contentFixture()
    fixture.plan.rejectedBuildListEntries = [{
      buildListEntryId: buildListEntryId('build-list.rejected.debug'),
      reason: 'resource_conflict',
      detail: 'Persisted rejection detail',
    }]
    useSettingsStore.setState({ debugMode: true })
    try {
      renderPage(contentDependencies(fixture), fixture.plan.id)
      await userEvent.click(await screen.findByRole('button', { name: '採用されなかった候補（1件）' }))
      expect(await screen.findByText('BuildListEntry ID: build-list.rejected.debug')).toBeInTheDocument()
      expect(screen.getByText('detail: Persisted rejection detail')).toBeInTheDocument()
    } finally {
      useSettingsStore.setState({ debugMode: false })
    }
  })

  it('says an unknown rejected reason is unknown instead of guessing, with no internal detail', async () => {
    const fixture = contentFixture()
    fixture.plan.rejectedBuildListEntries = [{
      buildListEntryId: buildListEntryId('build-list.rejected.unknown'),
      reason: 'future_reason' as never,
      detail: 'Plannerの最終結果でこのBuildListEntryは採用されませんでした。',
    }]
    renderPage(contentDependencies(fixture), fixture.plan.id)
    await userEvent.click(await screen.findByRole('button', { name: '採用されなかった候補（1件）' }))
    const list = await screen.findByRole('list', { name: '採用されなかった候補' })
    expect(within(list).getByText('採用されなかった理由を確認できません')).toBeInTheDocument()
    expect(list.textContent).not.toMatch(/BuildListEntry|future_reason/)
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
    // The heading and explanation come from the typed kind; the English
    // persisted reason is never shown (UI_FLOW 11.6.2).
    expect(screen.getByRole('heading', { level: 3, name: '競合 1：復元ボーナスの抽選位置の競合' })).toBeInTheDocument()
    expect(screen.getByText(/復元ボーナスの抽選はすべての武器で共通の順番で進みます。/)).toBeInTheDocument()
    expect(screen.queryByText('Persisted fixture conflict')).not.toBeInTheDocument()
    expect(screen.getByText('選択済み')).toBeInTheDocument()
    expect(screen.getByText(`「${fixture.secondTarget.name}」を優先しています。`)).toBeInTheDocument()
    const participants = within(screen.getByRole('list', { name: '競合 1 の参加候補' })).getAllByRole('listitem')
    expect(participants).toHaveLength(2)
    expect(within(participants[0]).getByRole('heading', { level: 4, name: fixture.target.name })).toBeInTheDocument()
    expect(within(participants[0]).getByText('Planner推奨（参考）')).toBeInTheDocument()
    expect(within(participants[0]).getByText('今回は作成しない')).toBeInTheDocument()
    expect(within(participants[0]).queryByText('優先（選択済み）')).not.toBeInTheDocument()
    expect(within(participants[1]).getByText('優先（選択済み）')).toBeInTheDocument()
    expect(within(participants[1]).queryByText('Planner推奨（参考）')).not.toBeInTheDocument()
    for (const participant of participants) {
      expect(within(participant).getByRole('button', { name: 'この候補を優先' })).toBeEnabled()
    }
    // No internal ID is shown, and no Alert while nothing is wrong.
    expect(screen.queryByText(/BuildListEntry ID/)).not.toBeInTheDocument()
    expect(screen.queryByText(fixture.plan.conflicts[0].id)).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('ProductionPlanPage read-only persisted Conflicts', () => {
  function participantCards() {
    return within(screen.getByRole('list', { name: '競合 1 の参加候補' })).getAllByRole('listitem')
  }

  async function expectReadOnlyParticipants(sectionNotice: string) {
    // Names come from the page's own read of the current Build List and
    // Targets, never from the (absent) preparation, and never as IDs.
    await waitFor(() => expect(participantCards().map((card) =>
      within(card).getByRole('heading', { level: 4 }).textContent)).toEqual(fixtureTargetNames))
    const cards = participantCards()
    expect(cards).toHaveLength(2)
    // Persisted recommendation / selection badges keep their display contract.
    expect(within(cards[0]).getByText('Planner推奨（参考）')).toBeInTheDocument()
    expect(within(cards[0]).getByText('今回は作成しない')).toBeInTheDocument()
    expect(within(cards[1]).getByText('優先（選択済み）')).toBeInTheDocument()
    expect(within(cards[1]).queryByText('Planner推奨（参考）')).not.toBeInTheDocument()
    for (const card of cards) {
      expect(within(card).queryByRole('button', { name: 'この候補を優先' })).not.toBeInTheDocument()
    }
    // Why nothing can be preferred is said once, for the whole section.
    expect(screen.getAllByText(sectionNotice)).toHaveLength(1)
    // Nothing that only the current preparation knows is inferred from the
    // persisted Plan: no checkpoint involvement.
    expect(screen.queryByText('途中採用状態の変更が必要')).not.toBeInTheDocument()
    expect(screen.queryByText(
      'この競合には途中採用する状態の選択が関係しています。作成リストで途中採用する状態を変更または解除してください。',
    )).not.toBeInTheDocument()
    expect(screen.queryByText('Persisted fixture conflict')).not.toBeInTheDocument()
  }

  let fixtureTargetNames: string[] = []

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
    fixtureTargetNames = [fixture.target.name, fixture.secondTarget.name]
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
    expect(screen.getByRole('heading', { level: 3, name: '競合 1：復元ボーナスの抽選位置の競合' })).toBeInTheDocument()
    await expectReadOnlyParticipants('優先する候補を選べるかどうか、現在の保存状態から確認しています。')
    expect(client.createPlan).not.toHaveBeenCalled()

    await act(async () => {
      pending.resolve(fixture.preparation)
      await pending.promise
    })
    // The fresh preparation is the availability authority once it arrives.
    expect(await screen.findAllByRole('button', { name: 'この候補を優先' })).toHaveLength(2)
    expect(screen.queryByText('優先する候補を選べるかどうか、現在の保存状態から確認しています。')).not.toBeInTheDocument()
    expect(screen.queryByText('現在の保存状態から操作可否を確認しています。')).not.toBeInTheDocument()
    for (const card of participantCards()) {
      expect(within(card).getByRole('button', { name: 'この候補を優先' })).toBeEnabled()
    }
    expect(screen.getByRole('heading', { level: 4, name: fixture.target.name })).toBeInTheDocument()
  })

  it('keeps the persisted Conflicts visible read-only after the Worker preparation failed', async () => {
    const fixture = readOnlyFixture()
    const client = plannerClient(async () => {
      throw new Error('Unexpected preparation failure')
    })
    const deps = dependencies(fixture, client)
    renderPage(deps, fixture.plan.id)

    expect(await screen.findByText('生産計画の現在状態を確認できませんでした。画面を再読み込みしてください。')).toBeInTheDocument()
    expect(screen.queryByText('Unexpected preparation failure')).not.toBeInTheDocument()
    // The Worker failure is an error, never a stale Plan.
    expect(screen.queryByText(/再計算が必要な生産計画です/)).not.toBeInTheDocument()
    expect(screen.getByText('計画の概要')).toBeInTheDocument()
    expect(summaryValue('計画ID')).toBe(fixture.plan.id)
    expect(screen.getByRole('heading', { level: 2, name: '競合と解決' })).toBeInTheDocument()
    await expectReadOnlyParticipants('現在の保存状態を確認できなかったため、優先する候補を選べません。画面を再読み込みしてください。')
    expect(client.createPlan).not.toHaveBeenCalled()
    expect(deps.savePlannerConflictPreferenceResult).not.toHaveBeenCalled()
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
    await expectReadOnlyParticipants('この生産計画は再計算が必要なため、優先する候補を選べません。')
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
    await expectReadOnlyParticipants('この生産計画は再計算が必要なため、優先する候補を選べません。')
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

    expect(await screen.findByText('生産計画を読み込めませんでした。画面を再読み込みしてください。')).toBeInTheDocument()
    expect(screen.queryByText('計画を読み込めませんでした。')).not.toBeInTheDocument()
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

  it('nests each participant and its explanation below the conflict heading', async () => {
    const fixture = multiParticipantFixture()
    const client = plannerClient(async () => fixture.preparation)
    renderPage(dependencies(fixture, client), fixture.plan.id)
    await screen.findAllByRole('button', { name: 'この候補を優先' })

    const participant = screen.getByRole('heading', { level: 4, name: fixture.secondTarget.name })
    const explanation = screen.getByText(
      `この候補を優先すると、「${fixture.target.name}」は今回の生産計画では作成しません。作成リストの候補は残ります。`,
    )
    expect(participant.closest('li')).toContainElement(explanation)
    expect(screen.getByRole('heading', { level: 3, name: '競合 1：復元ボーナスの抽選位置の競合' })).toBeInTheDocument()
    // The button is described by its participant heading and the explanation.
    const button = within(participant.closest('li') as HTMLElement).getByRole('button', { name: 'この候補を優先' })
    expect(button).toHaveAccessibleDescription(new RegExp(fixture.secondTarget.name))
    expect(button).toHaveAccessibleDescription(new RegExp(`「${fixture.target.name}」は今回の生産計画では作成しません`))
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
    ['draft', 15],
    ['active', 15],
    ['draft', 16],
    ['active', 16],
  ] as const)(
    'fails a %s schema %i Plan closed under the current schema 18, keeping its persisted content readable',
    async (status, appSchemaVersion) => {
      // Issue #103 Phase C: a version 13 Plan was calculated by the Beam Search,
      // and Issue #129: a version 14 Plan turned every Counter-advance Normal
      // forge into a conflict; a version 15 Plan predates the Planner Alternative
      // repair (Phase 5-B), and a version 16 Plan's Build List / replan runs were
      // still bounded by the legacy B8 retry budget (Phase 6-A). A persisted Plan
      // records none of these, so it is never prepared, started, compared or
      // executed under the current runtime.
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
      expect(CURRENT_CALCULATION_APP_SCHEMA_VERSION).toBe(18)
      renderPage(deps, fixture.plan.id)

      expect(await screen.findByText(
        'この生産計画は現在の計算契約と互換性がありません。ビルドリストから再計算してください。',
      )).toBeInTheDocument()
      // The exact persisted content stays readable.
      expect(screen.getByText('計画の概要')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: '作成開始' })).not.toBeInTheDocument()
      expect(screen.queryByRole('link', { name: '実行ナビを再開する' })).not.toBeInTheDocument()
      // Conflict / what-if controls stay disabled: no preparation ever runs.
      screen.queryAllByRole('button', { name: 'この候補を優先' }).forEach((button) => {
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

  /** The fixture Plan at calculation schema 17 under a schema 18 runtime. */
  function schema17(status: 'draft' | 'active', resolutionFree: boolean) {
    const fixture = withStatus({ status })
    fixture.plan.calculationContext = { ...fixture.plan.calculationContext, appSchemaVersion: 17 }
    fixture.plan.baseSnapshot = {
      ...fixture.plan.baseSnapshot,
      calculationContext: { ...fixture.plan.baseSnapshot.calculationContext, appSchemaVersion: 17 },
    }
    if (resolutionFree) {
      fixture.plan.conflicts = fixture.plan.conflicts.map((conflict) => ({ ...conflict, selectedBuildListEntryId: null }))
    }
    const deps = dependencies(fixture)
    deps.currentCalculationContext = { ...fixture.plan.calculationContext, appSchemaVersion: CURRENT_CALCULATION_APP_SCHEMA_VERSION }
    return { fixture, deps }
  }

  it('keeps a resolution-free schema 17 draft startable and its conflicts preparable under schema 18 (Issue #278, 18 -> 17)', async () => {
    const { fixture, deps } = schema17('draft', true)
    renderPage(deps, fixture.plan.id)
    expect(await readyStartButton()).toBeEnabled()
    expect(screen.queryByText('この生産計画は現在の計算契約と互換性がありません。ビルドリストから再計算してください。')).not.toBeInTheDocument()
    await waitFor(() => expect(deps.createWorkerClient).toHaveBeenCalledOnce())
  })

  it('keeps a resolution-free schema 17 active Plan resumable under schema 18', async () => {
    const { fixture, deps } = schema17('active', true)
    renderPage(deps, fixture.plan.id)
    expect(await screen.findByRole('link', { name: '実行ナビを再開する' }))
      .toHaveAttribute('href', `/plans/${fixture.plan.id}/run`)
  })

  it.each(['draft', 'active'] as const)(
    'fails a schema 17 %s Plan with a selected Conflict closed under schema 18',
    async (status) => {
      const { fixture, deps } = schema17(status, false)
      renderPage(deps, fixture.plan.id)
      expect(await screen.findByText(
        'この生産計画は現在の計算契約と互換性がありません。ビルドリストから再計算してください。',
      )).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: '作成開始' })).not.toBeInTheDocument()
      expect(deps.createWorkerClient).not.toHaveBeenCalled()
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
 * temporary input. Since Issue #278 PR-2 the bound is given to the ordinary
 * `createPlan()` together with the explicit decision set.
 */
describe('ProductionPlanPage conflict resolution maxPlanSteps', () => {
  function withStepCount<T extends ReturnType<typeof multiParticipantFixture>>(fixture: T, stepCount: number): T {
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
  ])('recalculates a %i-Step Plan with maxPlanSteps %i and carries every compatible earlier decision', async (stepCount, expected) => {
    const user = userEvent.setup()
    const fixture = withStepCount(supersedingFixture(), stepCount)
    // Y prefers third: compatible with preferring second on X, so it is carried.
    fixture.plan.conflicts[1].selectedBuildListEntryId = fixture.thirdEntry.id
    const client = plannerClient(async () => fixture.preparation)
    vi.mocked(client.createPlan).mockResolvedValue(preferenceResult(createValidProductionPlan()))
    const deps = dependencies(fixture, client)
    renderPage(deps, fixture.plan.id)
    await clickSelection(user, 1)
    await waitFor(() => expect(deps.savePlannerConflictPreferenceResult).toHaveBeenCalledOnce())

    // The fresh input still carries the fallback default...
    const prepared = vi.mocked(client.prepareInteraction).mock.calls[1][1]
    expect(prepared.options).toEqual(defaultPlannerOptions)
    expect(fixture.input.options).toEqual({ maxPlanSteps: 1000 })
    // ...and only the run is given the derived bound, with the carried decision
    // and this one (conflict ID order).
    const [, runInput] = vi.mocked(client.createPlan).mock.calls[0]
    expect(runInput.options).toEqual({ maxPlanSteps: expected })
    expect(runInput.conflictResolutions).toEqual([
      { conflictKey: fixture.plan.conflicts[0].id, selectedBuildListEntryId: fixture.secondEntry.id },
      { conflictKey: fixture.conflictY.id, selectedBuildListEntryId: fixture.thirdEntry.id },
    ].sort((left, right) => (left.conflictKey < right.conflictKey ? -1 : 1)))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('saves nothing when the derived bound truncates the recalculation, and never points at the Build List input', async () => {
    const user = userEvent.setup()
    const fixture = withStepCount(multiParticipantFixture(), 1470)
    const client = plannerClient(async () => fixture.preparation)
    vi.mocked(client.createPlan).mockResolvedValue(preferenceResult(createValidProductionPlan(), {
      termination: {
        ...completedPlannerTermination(),
        status: 'incomplete',
        reachedLimits: ['max_plan_steps'],
        limits: { maxPlanSteps: 2000 },
      },
    }))
    const deps = dependencies(fixture, client)
    const view = renderPage(deps, fixture.plan.id)
    await clickSelection(user, 1)

    expect(await screen.findByText(
      '競合解決の再計算が最大計画ステップ数 2,000 に到達したため、完成した生産計画を作成できませんでした。この上限は表示中の生産計画のステップ数から自動で決まります。ビルドリスト画面から生産計画を作り直してください。',
    )).toBeInTheDocument()
    expect(screen.queryByText(/「詳細設定」で探索上限を引き上げてから/)).not.toBeInTheDocument()
    expect(vi.mocked(client.createPlan).mock.calls[0][1].options).toEqual({ maxPlanSteps: 2000 })
    expect(deps.savePlannerConflictPreferenceResult).not.toHaveBeenCalled()
    expect(view.router.state.location.pathname).toBe('/plans/' + fixture.plan.id)
  })
})

describe('ProductionPlanPage section order and overview Conflicts (Issue #121)', () => {
  /** Each element follows the previous one in document order. */
  function expectDocumentOrder(elements: readonly HTMLElement[]) {
    for (let index = 1; index < elements.length; index += 1) {
      expect(
        elements[index - 1].compareDocumentPosition(elements[index]) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
    }
  }

  function sectionHeadings(): HTMLElement[] {
    return [
      screen.getByRole('heading', { level: 2, name: '計画の概要' }),
      screen.getByRole('heading', { level: 2, name: '計画全体の実行順' }),
      screen.getByRole('heading', { level: 2, name: '必要素材・費用の目安' }),
      screen.getByRole('heading', { level: 2, name: '必要素材（アイテム）合計' }),
      screen.getByRole('heading', { level: 2, name: '競合と解決' }),
      screen.getByRole('heading', { level: 2, name: '目標武器ごとの作成ルート' }),
      screen.getByRole('heading', { level: 2, name: /^採用されなかった候補/ }),
    ]
  }

  function orderFixture() {
    const fixture = contentFixture()
    fixture.plan.requiredMaterials = [{ materialId: 'material.fixture.active', quantity: 12 }]
    fixture.plan.rejectedBuildListEntries = [{
      buildListEntryId: buildListEntryId('build-list.rejected.order'),
      reason: 'resource_conflict',
      detail: 'Persisted rejection detail',
    }]
    return fixture
  }

  /** The overview's `dd` for a label, its detail line included. */
  function overviewValue(label: string): HTMLElement {
    const overview = screen.getByRole('region', { name: '計画の概要' })
    const value = within(overview).getByText(label).nextElementSibling
    if (!(value instanceof HTMLElement)) throw new Error(`Missing overview value ${label}`)
    return value
  }

  it('orders overview, global order, materials, Conflicts, Target routes and rejected Entries', async () => {
    const fixture = orderFixture()
    renderPage(contentDependencies(fixture), fixture.plan.id)

    await screen.findByRole('heading', { level: 2, name: '計画の概要' })
    // The current availability arrives once the Worker preparation is ready.
    await screen.findByRole('button', { name: 'この候補を優先' })
    expectDocumentOrder(sectionHeadings())

    // The global order still lists one shared physical Step exactly once.
    await openPanel('全4ステップを表示')
    const global = screen.getByRole('list', { name: '計画全体の実行順' })
    expect(within(global).getAllByText(/^ステップ \d+$/)).toHaveLength(4)
    expect(within(global).getAllByText('ステップ 1')).toHaveLength(1)

    // The moved Target routes keep their Target grouping and still expand.
    await openPanel('双剣・火（2ステップ）')
    const route = screen.getByRole('list', { name: '双剣・火の作成ルート' })
    expect(within(route).getByText('ステップ 1')).toBeInTheDocument()
    expect(within(route).getByText('ステップ 2')).toBeInTheDocument()
  })

  it('keeps the preparation indicator and the read-only Conflicts before the Target routes while preparing', async () => {
    const fixture = orderFixture()
    const pending = deferred<PlannerInteractionPreparationResult>()
    renderPage(
      contentDependencies(fixture, [fixture.targetA, fixture.targetB], plannerClient(() => pending.promise)),
      fixture.plan.id,
    )

    await screen.findByRole('heading', { level: 2, name: '計画の概要' })
    const preparing = screen.getByText('現在の保存状態から操作可否を確認しています。')
    const headings = sectionHeadings()
    expectDocumentOrder(headings)
    expectDocumentOrder([headings[3], preparing, headings[4], headings[5]])
  })

  it('keeps the same order after a preparation failure', async () => {
    const fixture = orderFixture()
    renderPage(
      contentDependencies(fixture, [fixture.targetA, fixture.targetB], plannerClient(async () => {
        throw new Error('準備に失敗しました。')
      })),
      fixture.plan.id,
    )
    expect(await screen.findByText('生産計画の現在状態を確認できませんでした。画面を再読み込みしてください。')).toBeInTheDocument()
    expectDocumentOrder(sectionHeadings())
  })

  it('keeps the same order for a stale Plan whose Conflict controls stay disabled', async () => {
    const fixture = orderFixture()
    fixture.plan.status = 'stale'
    renderPage(contentDependencies(fixture), fixture.plan.id)
    expect(await screen.findByText('再計算が必要な生産計画です')).toBeInTheDocument()
    expectDocumentOrder(sectionHeadings())
    expect(screen.queryByRole('button', { name: 'この候補を優先' })).not.toBeInTheDocument()
  })

  it('counts persisted Conflict records apart from Targets, adopted Entries and rejected Entries', async () => {
    const fixture = orderFixture()
    const [persisted] = fixture.plan.conflicts
    // Three records: one with a stored selection, two without.
    fixture.plan.conflicts = [
      persisted,
      { ...persisted, id: 'conflict.order.second', selectedBuildListEntryId: null },
      { ...persisted, id: 'conflict.order.third', selectedBuildListEntryId: null },
    ]
    fixture.plan.selectedBuildListEntryIds = [
      buildListEntryId('build-list.content.a'),
      buildListEntryId('build-list.content.b'),
    ]
    fixture.plan.rejectedBuildListEntries.push({
      buildListEntryId: buildListEntryId('build-list.rejected.order.second'),
      reason: 'lower_priority',
      detail: 'Persisted rejection detail',
    })
    renderPage(contentDependencies(fixture), fixture.plan.id)

    const overview = await screen.findByRole('region', { name: '計画の概要' })
    expect(within(overview).getByText('競合あり（3件）')).toBeInTheDocument()
    // The record count - never the Targets (2), the adopted Entries (2) or the
    // Conflicts plus the rejected Entries (5).
    expect(overviewValue('競合（記録件数）').textContent).toBe('3件うち候補を選択済み 1件')
    // The stored selection is shown as stored; nothing is called unresolved.
    expect(within(overview).queryByText(/未解決/)).not.toBeInTheDocument()
    expect(overviewValue('目標武器数').textContent).toBe('2')
    expect(overviewValue('採用候補（BuildListEntry）').textContent).toBe('2')
    // A legacy-form Plan keeps its unknown planned completion count.
    expect(overviewValue('完成予定の目標武器数').textContent).toBe('不明（旧形式の計画）')

    const note = within(overview).getByRole('note')
    expect(note).toHaveTextContent('この計画には競合が3件記録されています。')
    expect(note).toHaveTextContent('件数は競合の記録数で、作成できない目標武器の数ではありません。')
    // It names no guessed number of Targets that will not be completed.
    expect(note.textContent).not.toMatch(/\d+(本|個|つ)/)
    // A static note, never an alert.
    expect(within(overview).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('states that a Plan without persisted Conflicts has none', async () => {
    const fixture = orderFixture()
    fixture.plan.conflicts = []
    renderPage(contentDependencies(fixture), fixture.plan.id)

    const overview = await screen.findByRole('region', { name: '計画の概要' })
    expect(within(overview).getByText('競合なし')).toBeInTheDocument()
    expect(overviewValue('競合（記録件数）').textContent).toBe('なし')
    expect(within(overview).queryByRole('note')).not.toBeInTheDocument()
    expect(await screen.findByText('この生産計画に表示する競合はありません。')).toBeInTheDocument()
  })

  it('keeps selecting, cancelling and selecting again a Conflict participant in the new place', async () => {
    const user = userEvent.setup()
    const fixture = pageFixture('order')
    const pending = deferred<PlannerResult>()
    const client = plannerClient(async () => fixture.preparation)
    vi.mocked(client.createPlan).mockReturnValueOnce(pending.promise).mockResolvedValue(preferenceResult(null))
    renderPage(dependencies(fixture, client), fixture.plan.id)

    await user.click(await screen.findByRole('button', { name: 'この候補を優先' }))
    const cancel = await screen.findByRole('button', { name: '再計算をキャンセル' })
    await waitFor(() => expect(client.createPlan).toHaveBeenCalledOnce())
    const requestId = vi.mocked(client.createPlan).mock.calls[0][0]
    await user.click(cancel)
    expect(client.cancelPlan).toHaveBeenCalledWith(requestId)
    expect(screen.queryByRole('button', { name: '再計算をキャンセル' })).not.toBeInTheDocument()

    expectDocumentOrder([
      screen.getByRole('heading', { level: 2, name: '必要素材・費用の目安' }),
      screen.getByRole('heading', { level: 2, name: '競合と解決' }),
      screen.getByRole('heading', { level: 2, name: '目標武器ごとの作成ルート' }),
    ])

    await user.click(screen.getByRole('button', { name: 'この候補を優先' }))
    await waitFor(() => expect(client.createPlan).toHaveBeenCalledTimes(2))
  })
})

/**
 * Issue #278 PR-3 (`docs/UI_FLOW.md` 11.6.5, `docs/PLANNER_SPEC.md` 9.6.7): a
 * persisted Conflict the current preparation does not detect is "found while
 * planning" only over the same calculation input, judged through the start /
 * save snapshot authorities; otherwise it cannot be reproduced over the
 * changed input. Neither offers 「この候補を優先」.
 */
describe('ProductionPlanPage conflict presentation (Issue #278 PR-3)', () => {
  function sameInputFixture() {
    const fixture = multiParticipantFixture()
    fixture.plan.conflicts[0].selectedBuildListEntryId = null
    fixture.plan.conflicts.push({
      ...fixture.plan.conflicts[0],
      id: 'conflict.page.dynamic',
      kind: 'same_skill_counter',
      reason: 'BuildListEntries require incompatible physical operations at Skill Counter 123.',
    })
    fixture.plan.selectedBuildListEntryIds = [fixture.entry.id]
    fixture.plan.baseSnapshot = {
      ...fixture.plan.baseSnapshot,
      initialExecutionState: createActualExecutionState(fixture.plan, fixture.input, []),
      targetWeaponsHash: createPlanningTargetWeaponsHash(fixture.input.targetWeapons),
      buildListEntriesHash: createPlanningBuildListEntriesHash(fixture.input.buildListEntries),
    }
    return fixture
  }

  it('explains a dynamic Conflict, offers no recalculation of the same input, and keeps the initial one choosable', async () => {
    const fixture = sameInputFixture()
    const client = plannerClient(async () => fixture.preparation)
    renderPage(dependencies(fixture, client), fixture.plan.id)

    const dynamic = (await screen.findByRole('heading', { level: 3, name: '競合 2：スキルの抽選位置の競合' })).closest('li') as HTMLElement
    expect(within(dynamic).getByText('計画の途中で生じた競合')).toBeInTheDocument()
    expect(within(dynamic).getByText('この競合は、計画を立てる途中（候補を外した後など）で生じたもので、ここでは優先する候補を選べません。')).toBeInTheDocument()
    expect(within(dynamic).getByText('同じ作成リストと状態のまま計算し直しても、同じ結果になります。')).toBeInTheDocument()
    expect(within(dynamic).queryByRole('button', { name: 'この候補を優先' })).not.toBeInTheDocument()
    expect(within(dynamic).getByRole('link', { name: 'ビルドリストを開く' })).toHaveAttribute('href', '/build-list')
    // The Counter position stays out of the normal UI.
    expect(screen.queryByText(/Skill Counter 123/)).not.toBeInTheDocument()

    const initial = screen.getByRole('heading', { level: 3, name: '競合 1：復元ボーナスの抽選位置の競合' }).closest('li') as HTMLElement
    expect(within(initial).getByText('判断待ち')).toBeInTheDocument()
    expect(within(initial).getAllByRole('button', { name: 'この候補を優先' })).toHaveLength(2)
    // Only the Conflict that can be decided here counts as 判断待ち.
    expect(screen.getByText('まだ判断が必要な競合があります（1件）。各競合の案内を確認してください。')).toBeInTheDocument()
  })

  it('says a missing Conflict cannot be reproduced once the input changed', async () => {
    const fixture = sameInputFixture()
    // The Build List changed after the Draft was calculated.
    const changedInput = structuredClone(fixture.input)
    changedInput.targetWeapons[1].priority = 5
    const client = plannerClient(async () => fixture.preparation)
    const deps = dependencies(fixture, client)
    vi.mocked(deps.createInput).mockResolvedValue(changedInput)
    renderPage(deps, fixture.plan.id)

    const second = (await screen.findByRole('heading', { level: 3, name: '競合 2：スキルの抽選位置の競合' })).closest('li') as HTMLElement
    expect(within(second).getByText('現在の入力では再現できない')).toBeInTheDocument()
    expect(within(second).getByText('作成リスト・目標武器・状態が計算時から変わったため、この競合は現在の入力では再現できません。ここでは優先する候補を選べません。')).toBeInTheDocument()
    expect(within(second).queryByText('計画の途中で生じた競合')).not.toBeInTheDocument()
    expect(within(second).queryByRole('button', { name: 'この候補を優先' })).not.toBeInTheDocument()
  })

  it('shows each Conflict\'s raw diagnostics only in Debug Mode, collapsed', async () => {
    const fixture = sameInputFixture()
    const off = renderPage(dependencies(fixture, plannerClient(async () => fixture.preparation)), fixture.plan.id)
    await screen.findByRole('heading', { level: 3, name: '競合 1：復元ボーナスの抽選位置の競合' })
    expect(screen.queryByRole('button', { name: /の診断情報（Debug）/ })).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain(fixture.plan.conflicts[0].id)
    expect(document.body.textContent).not.toContain(fixture.entry.id)
    off.unmount()

    useSettingsStore.setState({ debugMode: true })
    try {
      renderPage(dependencies(fixture, plannerClient(async () => fixture.preparation)), fixture.plan.id)
      const toggle = await screen.findByRole('button', { name: '競合 2 の診断情報（Debug）' })
      await userEvent.click(toggle)
      expect(await screen.findByText('BuildListEntries require incompatible physical operations at Skill Counter 123.')).toBeInTheDocument()
      expect(screen.getByText('conflict.page.dynamic')).toBeInTheDocument()
    } finally {
      useSettingsStore.setState({ debugMode: false })
    }
  })

  it('lists the Targets this Draft makes and leaves out, and keeps them apart from the Conflict count', async () => {
    const fixture = sameInputFixture()
    fixture.plan.steps = fixture.plan.steps.map((step) => ({
      ...step,
      executionEffects: {
        trackedOwnedWeaponId: null,
        normalCreationRole: null,
        registersTrackedWeapon: false,
        observationBinding: null,
        targetLinks: [],
        compromiseLabels: [],
        targetCompletions: [{ buildListEntryId: fixture.entry.id, targetWeaponId: fixture.target.id, ownedWeaponId: ownedWeaponId('owned.page.made') }],
      },
    }))
    renderPage(dependencies(fixture, plannerClient(async () => fixture.preparation)), fixture.plan.id)

    const outcome = await screen.findByRole('region', { name: '今回作成する / 作成しない目標武器' })
    expect(within(outcome).getByRole('heading', { level: 4, name: '今回作成する目標武器（1本）' })).toBeInTheDocument()
    expect(within(outcome).getByRole('heading', { level: 4, name: '今回作成しない目標武器（1本）' })).toBeInTheDocument()
    expect(within(outcome).getByText(fixture.secondTarget.name)).toBeInTheDocument()
    expect(within(outcome).getByText('競合の選択待ちのため、今回は作成しません。')).toBeInTheDocument()
    const counts = screen.getByLabelText('競合と作成予定の件数')
    expect(within(counts).getByText('競合（記録件数）').nextElementSibling)
      .toHaveTextContent('2件判断待ち 1件・選択済み 0件・ここでは選べない 1件')
  })
})

/**
 * PR #281 review (`docs/PLANNER_SPEC.md` 9.6.3 rule 9, `docs/UI_FLOW.md`
 * 11.6.6): conflict 1 = {A, B} preferring A, conflict 2 = {C, B} undecided.
 * B is not offered in conflict 2, C is, and the press re-checks the same rule
 * over its fresh preparation.
 */
describe('ProductionPlanPage participants another Conflict excludes', () => {
  function crossConflictFixture() {
    const fixture = multiParticipantFixture()
    const thirdEntry = structuredClone(fixture.entry)
    const thirdTarget = structuredClone(fixture.target)
    thirdEntry.id = buildListEntryId('build-list.page.multi.third')
    thirdEntry.targetWeaponId = targetWeaponId('target.page.multi.third')
    thirdEntry.candidateSnapshot.targetWeaponId = thirdEntry.targetWeaponId
    thirdTarget.id = thirdEntry.targetWeaponId
    thirdTarget.name = 'Page fixture target multi third'
    fixture.input.buildListEntries.push(thirdEntry)
    fixture.input.targetWeapons.push(thirdTarget)
    fixture.plan.conflicts[0].selectedBuildListEntryId = fixture.entry.id
    const second: PlanConflict = {
      id: 'conflict.page.second',
      kind: 'same_skill_counter',
      buildListEntryIds: [thirdEntry.id, fixture.secondEntry.id],
      reason: 'Persisted fixture conflict second',
      recommendedBuildListEntryId: thirdEntry.id,
      selectedBuildListEntryId: null,
      resolutionNote: null,
      checkpointParticipants: [],
    }
    fixture.plan.conflicts.push(second)
    const currentConflicts = fixture.plan.conflicts.map(({ id, buildListEntryIds }) => ({
      id, buildListEntryIds: [...buildListEntryIds], checkpointParticipants: [],
    }))
    fixture.preparation = {
      status: 'ready',
      validBuildListEntryIds: [fixture.entry.id, fixture.secondEntry.id, thirdEntry.id],
      excludedBuildListEntries: [],
      currentConflicts,
    }
    return { ...fixture, thirdEntry, thirdTarget, second }
  }

  function participantCards(conflictNumber: number) {
    return within(screen.getByRole('list', { name: `競合 ${conflictNumber} の参加候補` })).getAllByRole('listitem')
  }

  it('disables B in conflict 2 with its reason, keeps C there and the re-choice in conflict 1', async () => {
    const fixture = crossConflictFixture()
    renderPage(dependencies(fixture, plannerClient(async () => fixture.preparation)), fixture.plan.id)

    await screen.findByRole('heading', { level: 3, name: '競合 2：スキルの抽選位置の競合' })
    const [cCard, bCard] = participantCards(2)
    expect(within(cCard).getByRole('button', { name: 'この候補を優先' })).toBeEnabled()
    const disabled = within(bCard).getByRole('button', { name: 'この候補を優先' })
    expect(disabled).toBeDisabled()
    expect(within(bCard).getByText(
      '「Page fixture target multi second」は、競合1で「Page fixture target multi」を優先したため、今回は作成しません。'
      + 'この競合では優先できません。「Page fixture target multi second」を優先したい場合は、先に競合1の選択を変更してください。',
    )).toBeInTheDocument()
    expect(within(bCard).getByText('今回は作成しない')).toBeInTheDocument()
    // Conflict 1 re-chooses B itself.
    const conflictOneButtons = participantCards(1).map((card) => within(card).getByRole('button', { name: 'この候補を優先' }))
    expect(conflictOneButtons.map((button) => (button as HTMLButtonElement).disabled)).toEqual([false, false])
    expect(document.body.textContent).not.toContain(fixture.secondEntry.id)
    expect(document.body.textContent).not.toContain(fixture.second.id)
  })

  it('refuses B when the fresh preparation at press time finds conflict 1 decided, and starts nothing', async () => {
    const user = userEvent.setup()
    const fixture = crossConflictFixture()
    // At display time conflict 1 is no current initial Conflict, so its
    // decision is not carried and excludes nothing: B is offered.
    const displayTime: PlannerInteractionPreparationResult = {
      status: 'ready',
      validBuildListEntryIds: [fixture.entry.id, fixture.secondEntry.id, fixture.thirdEntry.id],
      excludedBuildListEntries: [],
      currentConflicts: [{ id: fixture.second.id, buildListEntryIds: [fixture.thirdEntry.id, fixture.secondEntry.id], checkpointParticipants: [] }],
    }
    const client = plannerClient(vi.fn()
      .mockResolvedValueOnce(displayTime)
      .mockResolvedValueOnce(fixture.preparation))
    const deps = dependencies(fixture, client)
    renderPage(deps, fixture.plan.id)

    await screen.findByRole('heading', { level: 3, name: '競合 2：スキルの抽選位置の競合' })
    const bButton = within(participantCards(2)[1]).getByRole('button', { name: 'この候補を優先' })
    expect(bButton).toBeEnabled()
    await user.click(bButton)

    expect(await screen.findByText('現在の状態が変化したため、この候補を優先できませんでした。')).toBeInTheDocument()
    expect(client.createPlan).not.toHaveBeenCalled()
    expect(deps.savePlannerConflictPreferenceResult).not.toHaveBeenCalled()
    // The refreshed display now disables B with its reason.
    expect(within(participantCards(2)[1]).getByRole('button', { name: 'この候補を優先' })).toBeDisabled()
  })

  it('still lets the user re-choose B in conflict 1 and runs the ordinary Planner', async () => {
    const user = userEvent.setup()
    const fixture = crossConflictFixture()
    const client = plannerClient(async () => fixture.preparation)
    vi.mocked(client.createPlan).mockResolvedValue(preferenceResult(null))
    renderPage(dependencies(fixture, client), fixture.plan.id)

    await screen.findByRole('heading', { level: 3, name: '競合 1：復元ボーナスの抽選位置の競合' })
    await user.click(within(participantCards(1)[1]).getByRole('button', { name: 'この候補を優先' }))
    await waitFor(() => expect(client.createPlan).toHaveBeenCalledTimes(1))
    expect(vi.mocked(client.createPlan).mock.calls[0][1].conflictResolutions).toEqual([
      { conflictKey: fixture.plan.conflicts[0].id, selectedBuildListEntryId: fixture.secondEntry.id },
    ])
  })

  it('shows the internal error text of an unexpected recalculation failure only in Debug Mode', async () => {
    const user = userEvent.setup()
    const fixture = crossConflictFixture()
    const client = plannerClient(async () => fixture.preparation)
    vi.mocked(client.createPlan).mockRejectedValue(new Error('Worker exploded at Gogma Counter 107'))
    useSettingsStore.setState({ debugMode: true })
    try {
      renderPage(dependencies(fixture, client), fixture.plan.id)
      await screen.findByRole('heading', { level: 3, name: '競合 1：復元ボーナスの抽選位置の競合' })
      await user.click(within(participantCards(2)[0]).getByRole('button', { name: 'この候補を優先' }))
      expect(await screen.findByText('生産計画の再計算に失敗しました。表示中の生産計画は変更していません。もう一度確認してください。')).toBeInTheDocument()
      expect(screen.getByText('Worker exploded at Gogma Counter 107')).toBeInTheDocument()
    } finally {
      useSettingsStore.setState({ debugMode: false })
    }
  })
})
