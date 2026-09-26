import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { AppDatabase } from '../db/AppDatabase'
import type { MasterDataRoot } from '../domain/master/masterTypes'
import type {
  BuildListEntry,
  OwnedGogmaArtianWeapon,
  OwnedWeapon,
  PlanStep,
  ProductionPlan,
  ProductionPlanId,
  TargetWeapon,
} from '../domain/models/publicTypes'
import { createProductionPlanWithConstrainedSearch } from '../domain/planner'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../domain/rng/production/productionRngEngine'
import { createProductionPlanReplanDependencies } from '../services/execution/productionPlanReplanDependencies'
import { ProductionPlanReplanPreviewService } from '../services/execution/productionPlanReplanPreviewService'
import type { PlannerWorkerClient } from '../services/planner/plannerWorkerClient'
import { IDEAL_SERIES_SKILL_ID } from '../test/fixtures/constrainedEnumeration'
import {
  confirmCurrent,
  currentPlan,
  dump,
  executionService,
  newNormalFixture,
  seed,
  withDatabase,
  type ExecutionFixture,
} from '../test/fixtures/executionRuntime'
import { createValidMasterDataFixture } from '../test/fixtures/masterData'
import {
  orchestrationBounds,
  orchestrationEntry,
  orchestrationEnumerationBounds,
  orchestrationSource,
  orchestrationTarget,
  resetRoute,
  synchronizeOrchestrationEntry,
} from '../test/fixtures/plannerConstrainedOrchestration'
import { ProductionPlanPage, type ProductionPlanPageDependencies } from './ProductionPlanPage'

/**
 * The Production Plan page's 「現在地点から再計画を試算」 / 「この再計画を採用」
 * over the real Execution runtime, a real Dexie database and the real Planner
 * (run inside a fake Worker Client): what the Preview leaves untouched, and
 * what one adoption transaction changes (`docs/PLANNER_SPEC.md` 16.8 / 16.10 /
 * 16.11, `docs/UI_FLOW.md` 16.4).
 */

const EXTRA_SOURCE_ID = 'owned.replan-ui.extra'
const EXTRA_TARGET_ID = 'target.replan-ui.extra'
const EXTRA_ENTRY_ID = 'entry.replan-ui.extra'
/** The added Target's persisted Entry a generated Entry replaces (PLANNER_SPEC 9.2.18). */
const ORIGINAL_ENTRY_ID = 'entry.replan-ui.extra.original'
const EARLIER_START = '2026-09-10T00:00:00.000Z'

const START = '現在地点から再計画を試算'
const PREVIEW_TITLE = '再計画の試算（未採用）'
const ADOPT = 'この再計画を採用'

interface Harness {
  database: AppDatabase
  fixture: ExecutionFixture
  service: ReturnType<typeof executionService>
  previewService: ProductionPlanReplanPreviewService
  source: OwnedGogmaArtianWeapon
  goal: TargetWeapon
  entry: BuildListEntry
  deps: ProductionPlanPageDependencies
  client: PlannerWorkerClient
}

interface HarnessOptions {
  savePoint?: boolean
  confirmedSteps?: number
  /** Feeds the added Entry to the Planner unpersisted, as a generated Entry. */
  generatedEntry?: boolean
  /**
   * Adds nothing while the Plan runs: the Preview replans the running Plan's
   * own (still fresh) Entry, and the running Plan itself stays executable.
   */
  plain?: boolean
}

function plannerMaster(fixture: ExecutionFixture): MasterDataRoot {
  // `createPlannerInput()` reads only the Planner Master subset.
  return { ...structuredClone(fixture.built.input.master) } as unknown as MasterDataRoot
}

/**
 * The real Planner behind the Worker Client interface: the constrained
 * orchestration over exactly the input the page hands over. A generated Entry
 * replaces the added Target's persisted Entry the way constrained re-search
 * adopts one - the Planner runs over the replacement set - and is reported as
 * generated together with that replacement.
 */
function realPlannerClient(fixture: ExecutionFixture, generated: BuildListEntry | null): PlannerWorkerClient {
  return {
    engineVersion: PRODUCTION_RNG_ENGINE_VERSION,
    createPlan: vi.fn(),
    createConstrainedPlan: vi.fn(async (_, input) => {
      const replacementSet = generated === null
        ? input
        : {
            ...input,
            buildListEntries: [
              ...(input.buildListEntries as BuildListEntry[]).filter((entry) => entry.id !== ORIGINAL_ENTRY_ID),
              structuredClone(generated),
            ],
          }
      const result = await createProductionPlanWithConstrainedSearch(replacementSet, fixture.built.dependencies, {
        orchestrationBounds: orchestrationBounds(),
        enumerationBounds: orchestrationEnumerationBounds(),
      })
      return generated === null
        ? result
        : {
            ...result,
            generatedBuildListEntries: [structuredClone(generated)],
            generatedBuildListEntryReplacements: [{
              targetWeaponId: generated.targetWeaponId,
              replacedBuildListEntryId: ORIGINAL_ENTRY_ID as BuildListEntry['id'],
              generatedBuildListEntryId: generated.id,
            }],
          }
    }),
    createWhatIfComparison: vi.fn(),
    createPlannerAlternativeComparison: vi.fn(),
    prepareInteraction: vi.fn(async () => ({
      status: 'ready' as const,
      validBuildListEntryIds: [],
      excludedBuildListEntries: [],
      currentConflicts: [],
    })),
    cancelPlan: vi.fn(),
    dispose: vi.fn(),
  }
}

/**
 * A running new-Normal Plan plus a Target, a weapon and a Reset Entry the user
 * added while it runs: the ordinary reason to replan from the current state.
 */
async function running(database: AppDatabase, options: HarnessOptions = {}): Promise<Harness> {
  const fixture = await newNormalFixture(3)
  await seed(database, fixture)
  const service = executionService(database, fixture.built)
  await service.startProductionPlan(fixture.plan.id)
  if (options.savePoint) await service.recordExecutionSavePoint({ planId: fixture.plan.id })
  for (let index = 0; index < (options.confirmedSteps ?? 0); index += 1) {
    await confirmCurrent(service, database, fixture.plan)
  }
  const previewService = new ProductionPlanReplanPreviewService({
    database,
    master: plannerMaster(fixture),
    currentCalculationContext: structuredClone(fixture.built.input.calculationContext),
  })
  const source = orchestrationSource(EXTRA_SOURCE_ID, { seriesSkillId: IDEAL_SERIES_SKILL_ID })
  const goal = orchestrationTarget(EXTRA_TARGET_ID)
  const entry = orchestrationEntry(EXTRA_ENTRY_ID, goal, resetRoute(source.id))
  if (!options.plain) {
    await database.ownedWeapons.put(source)
    await database.targetWeapons.put(goal)
    const request = await previewService.prepareProductionPlanReplanPreview({ runningPlanId: fixture.plan.id })
    synchronizeOrchestrationEntry(request.plannerInput, entry)
    if (options.generatedEntry) {
      const original = orchestrationEntry(ORIGINAL_ENTRY_ID, goal, resetRoute(source.id))
      synchronizeOrchestrationEntry(request.plannerInput, original)
      await database.buildListEntries.put(original)
    } else {
      await database.buildListEntries.put(entry)
    }
  }
  const client = realPlannerClient(fixture, options.generatedEntry ? entry : null)
  const deps: ProductionPlanPageDependencies = {
    master: createValidMasterDataFixture(),
    currentCalculationContext: structuredClone(fixture.built.input.calculationContext),
    getPlan: vi.fn((planId) => database.productionPlans.get(planId)),
    getTargetWeapons: vi.fn(() => database.targetWeapons.toArray()),
    createInput: vi.fn(async () => structuredClone(fixture.built.input)),
    createWorkerClient: vi.fn(() => client),
    inspectPlannerResultSave: vi.fn(async () => ({ approvalRequired: false as const })),
    savePlannerResult: vi.fn(async () => {
      throw new Error('savePlannerResult is not expected: a running Plan is replanned, never saved as a Draft')
    }),
    inspectProductionPlanStart: vi.fn(async (planId) => ({ planId, changes: [], ownedWeapons: [], targetWeapons: [] })),
    startProductionPlan: vi.fn(async () => {
      throw new Error('startProductionPlan is not expected in this test')
    }),
    replan: createProductionPlanReplanDependencies(createValidMasterDataFixture(), database, service, previewService),
  }
  return { database, fixture, service, previewService, source, goal, entry, deps, client }
}

function renderPage(deps: ProductionPlanPageDependencies, planId: string) {
  const router = createMemoryRouter(
    [
      { path: '/plans/:planId', element: <ProductionPlanPage dependencies={deps} /> },
      { path: '/plans/:planId/run', element: <div>Execution navigator destination</div> },
      { path: '/build-list', element: <div>Build list destination</div> },
    ],
    { initialEntries: [`/plans/${planId}`] },
  )
  return { router, ...render(<RouterProvider router={router} />) }
}

async function previewThroughPage(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await user.click(await screen.findByRole('button', { name: START }))
  const heading = await screen.findByRole('heading', { name: PREVIEW_TITLE }, { timeout: 15_000 })
  return heading.closest('section') as HTMLElement
}

async function openAdoptionDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: ADOPT }))
  return screen.findByRole('dialog', { name: 'この再計画を採用します' })
}

async function shownPreviewPlanId(harness: Harness): Promise<ProductionPlanId> {
  const [call] = vi.mocked(harness.client.createConstrainedPlan).mock.results
  const result = await (call.value as Promise<{ plan: ProductionPlan | null }>)
  expect(result.plan).not.toBeNull()
  return (result.plan as ProductionPlan).id
}

function inProgressFor(weapon: OwnedWeapon, planId: ProductionPlanId, startedAt = EARLIER_START): OwnedWeapon {
  return { ...weapon, executionInProgress: { productionPlanId: planId, startedAt } }
}

describe('ProductionPlanPage replan Preview over the real runtime', () => {
  it('shows the Preview from the current persisted state and writes nothing', () =>
    withDatabase(async (database) => {
      const harness = await running(database, { confirmedSteps: 1 })
      const before = await dump(database)
      const user = userEvent.setup()
      renderPage(harness.deps, harness.fixture.plan.id)

      const section = await previewThroughPage(user)

      expect(within(section).getByText('まだ現在の生産計画は変更されていません。この試算は保存されておらず、画面を離れると消えます。')).toBeInTheDocument()
      expect(within(section).getByRole('heading', { name: '計画の概要' })).toBeInTheDocument()
      expect(within(section).getByRole('table', { name: '現在の生産計画と再計画の試算の比較' })).toBeInTheDocument()
      expect(within(section).getByRole('button', { name: ADOPT })).toBeEnabled()
      const newPlanId = await shownPreviewPlanId(harness)
      expect(newPlanId).not.toBe(harness.fixture.plan.id)
      // Nothing persisted: not the Preview Plan, not the running Plan, no Entry, no link.
      expect(await dump(database)).toEqual(before)
      expect(await database.productionPlans.get(newPlanId)).toBeUndefined()
      expect((await database.targetWeapons.get(EXTRA_TARGET_ID))?.preferredOwnedWeaponId).toBeNull()
      expect(harness.deps.savePlannerResult).not.toHaveBeenCalled()
      // The page still shows the same running Plan.
      expect(screen.getByRole('link', { name: '実行ナビを再開する' })).toHaveAttribute('href', `/plans/${harness.fixture.plan.id}/run`)
    }))

  it('adopts in one transaction: old Plan abandoned, new Plan active with its start links, history kept, and the new Navigator opened', () =>
    withDatabase(async (database) => {
      const harness = await running(database, { confirmedSteps: 1 })
      const historyBefore = await database.executionHistory.toArray()
      expect(historyBefore).toHaveLength(1)
      const user = userEvent.setup()
      const { router } = renderPage(harness.deps, harness.fixture.plan.id)
      await previewThroughPage(user)
      const newPlanId = await shownPreviewPlanId(harness)
      const runningBefore = await currentPlan(database, harness.fixture.plan)
      const dialog = await openAdoptionDialog(user)
      // No save point: the plain confirmation.
      expect(within(dialog).queryByRole('button', { name: '現在地点を維持' })).not.toBeInTheDocument()

      await user.click(within(dialog).getByRole('button', { name: ADOPT }))

      expect(await screen.findByText('Execution navigator destination', undefined, { timeout: 10_000 })).toBeInTheDocument()
      expect(router.state.location.pathname).toBe(`/plans/${newPlanId}/run`)
      const oldPlan = await currentPlan(database, harness.fixture.plan)
      expect(oldPlan).toMatchObject({ status: 'abandoned', abandonmentReason: 'replan_adopted', currentStepId: runningBefore.currentStepId })
      expect(oldPlan.steps).toEqual(runningBefore.steps)
      const newPlan = await database.productionPlans.get(newPlanId)
      expect(newPlan?.status).toBe('active')
      // The old records stay; the adoption adds none.
      expect(await database.executionHistory.toArray()).toEqual(historyBefore)
      expect(await database.executionSavePoints.toArray()).toEqual([])
      // The new Plan's start effect links its existing weapon (16.11), in the same transaction.
      expect(await database.targetWeapons.get(EXTRA_TARGET_ID)).toMatchObject({ preferredOwnedWeaponId: EXTRA_SOURCE_ID })
      expect(harness.deps.startProductionPlan).not.toHaveBeenCalled()
    }))

  it('asks the save point choice after the Plan ran past its save point and keeps the current position on request', () =>
    withDatabase(async (database) => {
      const harness = await running(database, { savePoint: true, confirmedSteps: 1 })
      expect(await database.executionSavePoints.toArray()).toHaveLength(1)
      const user = userEvent.setup()
      const { router } = renderPage(harness.deps, harness.fixture.plan.id)
      await previewThroughPage(user)
      const newPlanId = await shownPreviewPlanId(harness)
      const dialog = await openAdoptionDialog(user)
      expect(within(dialog).getByText(/最後のゲーム内セーブ地点: 作成開始時点（最初の操作の前）/)).toBeInTheDocument()

      await user.click(within(dialog).getByRole('button', { name: '現在地点を維持' }))

      expect(await screen.findByText('Execution navigator destination', undefined, { timeout: 10_000 })).toBeInTheDocument()
      expect(router.state.location.pathname).toBe(`/plans/${newPlanId}/run`)
      expect((await currentPlan(database, harness.fixture.plan)).status).toBe('abandoned')
      expect((await database.productionPlans.get(newPlanId))?.status).toBe('active')
      // The current state is kept and the old save point is not carried over.
      expect(await database.executionHistory.toArray()).toHaveLength(1)
      expect(await database.executionSavePoints.toArray()).toEqual([])
    }))

  it('only restores the save point on return: adopts nothing, keeps the old Plan running and asks for a new Preview', () =>
    withDatabase(async (database) => {
      const harness = await running(database, { savePoint: true, confirmedSteps: 1 })
      const savePointBefore = (await database.executionSavePoints.toArray())[0]
      const user = userEvent.setup()
      const { router } = renderPage(harness.deps, harness.fixture.plan.id)
      await previewThroughPage(user)
      const newPlanId = await shownPreviewPlanId(harness)
      const dialog = await openAdoptionDialog(user)
      await user.click(within(dialog).getByRole('button', { name: '最後のゲーム内セーブ地点へ戻す' }))
      const restore = await screen.findByRole('dialog', { name: '最後のゲーム内セーブ地点へ戻す' })
      const confirm = within(restore).getByRole('button', { name: 'アプリ側もセーブ地点へ戻す' })
      expect(confirm).toBeDisabled()
      const beforeRestore = await dump(database)

      await user.click(within(restore).getByRole('checkbox', { name: 'ゲーム側を最後のゲーム内セーブ地点まで戻しました' }))
      await user.click(confirm)

      expect(await screen.findByText('最後のゲーム内セーブ地点へ戻しました。ゲーム状態が変わったため、再計画をもう一度試算してください。この試算は採用されていません。', undefined, { timeout: 10_000 })).toBeInTheDocument()
      // Restored only: the old Plan is back at the save point and still running,
      // the new Plan was never saved, and the save point stays.
      const oldPlan = await currentPlan(database, harness.fixture.plan)
      expect(oldPlan.status).toBe('active')
      expect(oldPlan.currentStepId).toBe(savePointBefore.productionPlan.currentStepId)
      expect(await database.productionPlans.get(newPlanId)).toBeUndefined()
      expect(await database.executionHistory.toArray()).toEqual([])
      expect(await database.executionSavePoints.toArray()).toEqual([savePointBefore])
      expect(beforeRestore.executionHistory).toHaveLength(1)
      expect(router.state.location.pathname).toBe(`/plans/${harness.fixture.plan.id}`)
      expect(screen.queryByRole('heading', { name: PREVIEW_TITLE })).not.toBeInTheDocument()
      expect(await screen.findByRole('button', { name: START })).toBeEnabled()
    }))

  it('refuses the adoption after the running Plan advanced, keeps it running and asks for a new Preview', () =>
    withDatabase(async (database) => {
      const harness = await running(database, { plain: true })
      const user = userEvent.setup()
      const { router } = renderPage(harness.deps, harness.fixture.plan.id)
      await previewThroughPage(user)
      const newPlanId = await shownPreviewPlanId(harness)
      // The game moved on in another tab: one more Step confirmed after the Preview.
      await confirmCurrent(harness.service, database, harness.fixture.plan)
      const before = await dump(database)

      // The read-only inspection already refuses the old Preview, so no
      // confirmation opens on it (UI_FLOW 16.4).
      await user.click(screen.getByRole('button', { name: ADOPT }))

      expect(screen.queryByRole('dialog', { hidden: true })).not.toBeInTheDocument()

      expect(await screen.findByText('試算後に状態が変わりました。もう一度、現在地点から再計画を試算してください。', undefined, { timeout: 10_000 })).toBeInTheDocument()
      expect(await dump(database)).toEqual(before)
      expect(await database.productionPlans.get(newPlanId)).toBeUndefined()
      expect((await currentPlan(database, harness.fixture.plan)).status).toBe('active')
      expect(router.state.location.pathname).toBe(`/plans/${harness.fixture.plan.id}`)
      expect(screen.queryByRole('heading', { name: PREVIEW_TITLE })).not.toBeInTheDocument()
      // No automatic re-Preview.
      expect(harness.client.createConstrainedPlan).toHaveBeenCalledOnce()
    }))

  it('adopts after a Plan-independent Target was added, because the runtime judges dependencies only', () =>
    withDatabase(async (database) => {
      const harness = await running(database)
      const user = userEvent.setup()
      const { router } = renderPage(harness.deps, harness.fixture.plan.id)
      await previewThroughPage(user)
      const newPlanId = await shownPreviewPlanId(harness)
      await database.targetWeapons.put(orchestrationTarget('target.replan-ui.unrelated'))
      const dialog = await openAdoptionDialog(user)

      await user.click(within(dialog).getByRole('button', { name: ADOPT }))

      expect(await screen.findByText('Execution navigator destination', undefined, { timeout: 10_000 })).toBeInTheDocument()
      expect(router.state.location.pathname).toBe(`/plans/${newPlanId}/run`)
      expect((await database.productionPlans.get(newPlanId))?.status).toBe('active')
    }))

  it('saves a generated Entry only with the adoption, and nothing when the transaction fails', () =>
    withDatabase(async (database) => {
      const harness = await running(database, { generatedEntry: true })
      const user = userEvent.setup()
      const { router } = renderPage(harness.deps, harness.fixture.plan.id)
      const section = await previewThroughPage(user)
      expect(within(section).getByText('この試算は新しい作成リスト項目を1件生成しました。採用したときに、新しい生産計画と同時に保存されます。')).toBeInTheDocument()
      const newPlanId = await shownPreviewPlanId(harness)
      expect(await database.buildListEntries.get(EXTRA_ENTRY_ID)).toBeUndefined()
      const before = await dump(database)

      // The new Plan write fails: the whole adoption rolls back.
      const failingAdd = vi.spyOn(database.productionPlans, 'add').mockRejectedValueOnce(new Error('storage failed'))
      let dialog = await openAdoptionDialog(user)
      await user.click(within(dialog).getByRole('button', { name: ADOPT }))
      expect(await screen.findByText('保存に失敗しました。状態は変更されていません。再試行してください。', undefined, { timeout: 10_000 })).toBeInTheDocument()
      expect(await dump(database)).toEqual(before)
      expect(await database.buildListEntries.get(EXTRA_ENTRY_ID)).toBeUndefined()
      expect((await currentPlan(database, harness.fixture.plan)).status).toBe('active')
      expect(router.state.location.pathname).toBe(`/plans/${harness.fixture.plan.id}`)
      failingAdd.mockRestore()
      // The Preview is kept, so the adoption can be retried.
      await waitFor(() => expect(screen.queryByRole('dialog', { hidden: true })).not.toBeInTheDocument())
      expect(screen.getByRole('heading', { name: PREVIEW_TITLE })).toBeInTheDocument()

      dialog = await openAdoptionDialog(user)
      await user.click(within(dialog).getByRole('button', { name: ADOPT }))

      expect(await screen.findByText('Execution navigator destination', undefined, { timeout: 10_000 })).toBeInTheDocument()
      expect(router.state.location.pathname).toBe(`/plans/${newPlanId}/run`)
      // The generated Entry replaced the added Target's original Entry.
      expect(await database.buildListEntries.get(EXTRA_ENTRY_ID)).toEqual(harness.entry)
      expect(await database.buildListEntries.get(ORIGINAL_ENTRY_ID)).toBeUndefined()
      expect((await database.productionPlans.get(newPlanId))?.status).toBe('active')
    }))

  it('moves the in-progress mark of a weapon the new Plan keeps tracking and clears the one it drops', () =>
    withDatabase(async (database) => {
      // Confirming until the production-target Normal is registered puts it in
      // progress for the running Plan; the new Plan does not reference it.
      const probe = await newNormalFixture(3)
      const registration = probe.plan.steps.findIndex((step: PlanStep) => step.executionEffects?.registersTrackedWeapon)
      expect(registration).toBeGreaterThanOrEqual(0)
      const harness = await running(database, { confirmedSteps: registration + 1 })
      const registered = (await database.ownedWeapons.toArray())
        .filter(({ executionInProgress }) => executionInProgress?.productionPlanId === harness.fixture.plan.id)
      expect(registered.length).toBeGreaterThan(0)
      // The extra source is already in progress for the running Plan; the new Plan starts from it.
      await database.ownedWeapons.put(inProgressFor(harness.source, harness.fixture.plan.id))
      const user = userEvent.setup()
      renderPage(harness.deps, harness.fixture.plan.id)
      await previewThroughPage(user)
      const newPlanId = await shownPreviewPlanId(harness)
      expect((await database.ownedWeapons.get(EXTRA_SOURCE_ID))?.executionInProgress).toEqual({
        productionPlanId: harness.fixture.plan.id,
        startedAt: EARLIER_START,
      })
      const dialog = await openAdoptionDialog(user)

      await user.click(within(dialog).getByRole('button', { name: ADOPT }))

      expect(await screen.findByText('Execution navigator destination', undefined, { timeout: 10_000 })).toBeInTheDocument()
      const newPlan = (await database.productionPlans.get(newPlanId)) as ProductionPlan
      expect(newPlan.status).toBe('active')
      // Kept tracking: moved to the new Plan with its start time kept.
      expect((await database.ownedWeapons.get(EXTRA_SOURCE_ID))?.executionInProgress).toEqual({
        productionPlanId: newPlanId,
        startedAt: EARLIER_START,
      })
      // Dropped: no longer in progress for anyone.
      for (const weapon of registered) {
        expect((await database.ownedWeapons.get(weapon.id))?.executionInProgress).toBeNull()
      }
      expect((await currentPlan(database, harness.fixture.plan)).status).toBe('abandoned')
    }))
})
