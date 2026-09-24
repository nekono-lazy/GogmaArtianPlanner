import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { AppDatabase } from '../db/AppDatabase'
import { BuildListEntryRepository } from '../db/repositories/buildListEntryRepository'
import { ProductionPlanRepository } from '../db/repositories/productionPlanRepository'
import type { BuildListEntry, OwnedWeapon, ProductionPlan, RngState } from '../domain/models/publicTypes'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../domain/rng/production/productionRngEngine'
import { BuildListService } from '../services/buildList/buildListService'
import { PlanBreakingChangeGuard } from '../services/execution/planBreakingChangeGuard'
import type { ProductionPlanReplanDependencies } from '../services/execution/productionPlanReplanDependencies'
import type { PlannerWorkerClient } from '../services/planner/plannerWorkerClient'
import {
  confirmCurrent,
  currentPlan,
  dump,
  executionService,
  existingGogmaFixture,
  seed,
  stepOf,
  withDatabase,
  type ExecutionFixture,
} from '../test/fixtures/executionRuntime'
import { createValidMasterDataFixture } from '../test/fixtures/masterData'
import { BuildListPage, type BuildListPageDependencies } from './BuildListPage'

/**
 * The Build List behind the real breaking-change guard: a real Dexie database,
 * the real `PlanBreakingChangeGuard`, the real `BuildListService` and the
 * page. What one approved save changes in one transaction, and what a warning
 * or a cancel leaves untouched (`docs/PLANNER_SPEC.md` 16.6 / 16.10,
 * `docs/UI_FLOW.md` 16.3 / 16.2).
 */

const GUARD_NOW = '2026-09-18T00:00:00.000Z'
const SOURCE_ID = 'owned.execution.gogma'
const ENTRY_ID = 'entry.execution.gogma'
const WARNING = { name: '実行中の生産計画があります' } as const
const BONUS_FIRST = '復元ボーナスを優先'

function unusedReplan(): ProductionPlanReplanDependencies {
  const notExpected = () => Promise.reject(new Error('replan is not expected'))
  return {
    prepareProductionPlanReplanPreview: vi.fn(notExpected),
    createProductionPlanReplanPreview: vi.fn(() => { throw new Error('replan is not expected') }),
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
    prepareInteraction: vi.fn(),
    cancelPlan: vi.fn(),
    dispose: vi.fn(),
  }
}

function realDependencies(database: AppDatabase, fixture: ExecutionFixture): BuildListPageDependencies {
  const guard = new PlanBreakingChangeGuard({
    database,
    currentCalculationContext: structuredClone(fixture.built.input.calculationContext),
    clock: { now: () => GUARD_NOW },
  })
  const buildList = new BuildListService({
    getAllEntries: () => database.buildListEntries.toArray(),
    putEntry: async (entry) => {
      await database.buildListEntries.put(entry)
      return entry
    },
    decideAndAddEntry: (decide) => new BuildListEntryRepository(database).decideAndAddBuildListEntry(decide),
    ensureRngState: async () => (await database.rngState.get('current')) as RngState,
    getNormalCounters: () => database.normalArtianCounters.toArray(),
    getOwnedWeapons: () => database.ownedWeapons.toArray(),
    getTargets: () => database.targetWeapons.toArray(),
    persistence: guard,
  })
  const plans = new ProductionPlanRepository(database)
  return {
    master: createValidMasterDataFixture(),
    createWorkerClient: () => unusedClient(),
    refresh: (calculationContext) => buildList.refreshStaleness(calculationContext),
    createInput: () => Promise.reject(new Error('planning is not expected')),
    savePlannerResult: () => Promise.reject(new Error('planning is not expected')),
    deleteEntry: (id, approval) => buildList.deleteEntry(id, approval ?? null),
    inspectEntryDelete: (id) => buildList.inspectEntryDelete(id),
    updateIntermediateStateSelection: (id, selection, approval) =>
      buildList.updateIntermediateStateSelection(id, selection, approval ?? null),
    inspectIntermediateStateSelectionUpdate: (id, selection) =>
      buildList.inspectIntermediateStateSelectionUpdate(id, selection),
    getRunningProductionPlan: () => plans.getRunningProductionPlan(),
    getDraftProductionPlan: () => plans.getDraftProductionPlan(),
    replan: unusedReplan(),
  }
}

async function started(database: AppDatabase, options: { savePoint?: boolean; confirmedSteps?: number } = {}) {
  const fixture = await existingGogmaFixture()
  await seed(database, fixture)
  const execution = executionService(database, fixture.built)
  await execution.startProductionPlan(fixture.plan.id)
  const savePoint = options.savePoint ? await execution.recordExecutionSavePoint({ planId: fixture.plan.id }) : null
  for (let index = 0; index < (options.confirmedSteps ?? 0); index += 1) {
    await confirmCurrent(execution, database, fixture.plan)
  }
  return { fixture, execution, savePoint, deps: realDependencies(database, fixture) }
}

function renderPage(deps: BuildListPageDependencies) {
  const router = createMemoryRouter([{ path: '/build-list', element: <BuildListPage dependencies={deps} /> }], { initialEntries: ['/build-list'] })
  return render(<RouterProvider router={router} />)
}

async function stored<T>(table: { get(id: string): Promise<T | undefined> }, id: string): Promise<T> {
  return (await table.get(id)) as T
}

function abandonedBreaking(plan: ProductionPlan): ProductionPlan {
  return { ...plan, status: 'abandoned', abandonmentReason: 'breaking_change_approved', abandonedAt: GUARD_NOW, completedAt: null, updatedAt: GUARD_NOW }
}

const bonusFirst = () => screen.findByRole('radio', { name: BONUS_FIRST })

describe('BuildListPage over the real breaking-change guard', () => {
  it('saves a Plan-independent Entry change without a warning and touches no Plan state', () =>
    withDatabase(async (database) => {
      const user = userEvent.setup()
      const { fixture, deps } = await started(database, { savePoint: true, confirmedSteps: 1 })
      const entry = await stored<BuildListEntry>(database.buildListEntries, ENTRY_ID)
      const other = { ...structuredClone(entry), id: 'entry.guard.independent' as BuildListEntry['id'], createdAt: '2026-09-13T00:00:00.000Z' }
      await database.buildListEntries.put(other)
      renderPage(deps)
      const radios = await screen.findAllByRole('radio', { name: BONUS_FIRST })
      expect(radios).toHaveLength(2)
      const before = await dump(database)

      // The second Entry in persisted order is the Plan-independent copy.
      await user.click(radios[1])

      expect(await screen.findByText('途中採用する状態と改善優先を更新しました。生産計画を再作成してください。')).toBeInTheDocument()
      expect(screen.queryByRole('dialog')).toBeNull()
      expect((await stored<BuildListEntry>(database.buildListEntries, other.id)).intermediateStateSelection?.improvementPreference).toBe('bonus_first')
      const after = await dump(database)
      expect(after.productionPlans).toEqual(before.productionPlans)
      expect(after.executionSavePoints).toEqual(before.executionSavePoints)
      expect(after.executionHistory).toEqual(before.executionHistory)
      expect(after.ownedWeapons).toEqual(before.ownedWeapons)
      expect(await currentPlan(database, fixture.plan)).toMatchObject({ status: 'active' })
    }))

  it('warns before a selected Entry change and writes nothing on cancel', () =>
    withDatabase(async (database) => {
      const user = userEvent.setup()
      const { deps } = await started(database, { confirmedSteps: 1 })
      renderPage(deps)
      await bonusFirst()
      const before = await dump(database)

      await user.click(await bonusFirst())
      const warning = within(await screen.findByRole('dialog', WARNING))
      expect(warning.getByText('生産計画が使用する作成リスト項目が変わります')).toBeInTheDocument()
      expect(await dump(database)).toEqual(before)
      await user.click(warning.getByRole('button', { name: 'キャンセル' }))

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      expect(await dump(database)).toEqual(before)
      expect(await bonusFirst()).not.toBeChecked()
      expect(screen.getByRole('radio', { name: '生産計画に任せる' })).toBeChecked()
    }))

  it('approves without a save point choice: the change, the abandonment and the in-progress release are one save', () =>
    withDatabase(async (database) => {
      const user = userEvent.setup()
      const { fixture, deps } = await started(database, { confirmedSteps: 1 })
      const plan = await currentPlan(database, fixture.plan)
      expect(await stored<OwnedWeapon>(database.ownedWeapons, SOURCE_ID)).toMatchObject({ executionInProgress: { productionPlanId: plan.id } })
      renderPage(deps)
      expect(await screen.findByRole('heading', { name: '現在地点からの再計画' })).toBeInTheDocument()
      const before = await dump(database)

      await user.click(await bonusFirst())
      const warning = within(await screen.findByRole('dialog', WARNING))
      expect(warning.queryByText(/最後のゲーム内セーブ地点/)).toBeNull()
      await user.click(warning.getByRole('button', { name: '生産計画を破棄して保存' }))

      expect(await screen.findByText('途中採用する状態と改善優先を更新し、実行中の生産計画を破棄しました。生産計画を再作成してください。')).toBeInTheDocument()
      expect((await stored<BuildListEntry>(database.buildListEntries, ENTRY_ID)).intermediateStateSelection?.improvementPreference).toBe('bonus_first')
      expect(await currentPlan(database, fixture.plan)).toEqual(abandonedBreaking(plan))
      expect(await stored<OwnedWeapon>(database.ownedWeapons, SOURCE_ID)).toMatchObject({ executionInProgress: null })
      expect(await database.executionHistory.toArray()).toEqual(before.executionHistory)
      expect(await database.executionSavePoints.count()).toBe(0)
      // The page re-reads: no Plan runs any more, so the ordinary Planner entry returns.
      expect(await screen.findByRole('button', { name: '生産計画を作成' })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: '現在地点からの再計画' })).toBeNull()
      await waitFor(() => expect(screen.getByRole('radio', { name: BONUS_FIRST })).toBeChecked())
    }))

  it('asks the save point choice and keeps the current state with the recorded token', () =>
    withDatabase(async (database) => {
      const user = userEvent.setup()
      const { fixture, deps, savePoint } = await started(database, { savePoint: true, confirmedSteps: 1 })
      const plan = await currentPlan(database, fixture.plan)
      renderPage(deps)
      await user.click(await bonusFirst())
      await user.click(within(await screen.findByRole('dialog', WARNING)).getByRole('button', { name: '生産計画を破棄して保存' }))

      const choice = within(await screen.findByRole('dialog', WARNING))
      expect(choice.getByText('この生産計画は、最後のゲーム内セーブ地点より先まで進んでいます。ゲーム側の状態に合わせて選んでください。')).toBeInTheDocument()
      expect(choice.getByText(/最後のゲーム内セーブ地点: 作成開始時点（最初の操作の前）/)).toBeInTheDocument()
      await user.click(choice.getByRole('button', { name: '現在地点を維持' }))

      expect(await screen.findByText(/実行中の生産計画を破棄しました/)).toBeInTheDocument()
      expect(await currentPlan(database, fixture.plan)).toEqual(abandonedBreaking(plan))
      expect((await currentPlan(database, fixture.plan)).currentStepId).toBe(stepOf(fixture.plan, 1).id)
      expect((await stored<BuildListEntry>(database.buildListEntries, ENTRY_ID)).intermediateStateSelection?.improvementPreference).toBe('bonus_first')
      expect(await database.executionSavePoints.count()).toBe(0)
      expect(await database.executionHistory.count()).toBe(1)
      expect(savePoint).not.toBeNull()
    }))

  it('returns to the save point, applies the change to the restored state and abandons the restored Plan in one save', () =>
    withDatabase(async (database) => {
      const user = userEvent.setup()
      const { fixture, deps, savePoint } = await started(database, { savePoint: true, confirmedSteps: 1 })
      const confirmedSource = await stored<OwnedWeapon>(database.ownedWeapons, SOURCE_ID)
      const snapshotSource = savePoint!.ownedWeapons.find(({ id }) => id === SOURCE_ID) as OwnedWeapon
      expect(confirmedSource.restorationBonuses).not.toEqual(snapshotSource.restorationBonuses)
      renderPage(deps)
      await user.click(await bonusFirst())
      await user.click(within(await screen.findByRole('dialog', WARNING)).getByRole('button', { name: '生産計画を破棄して保存' }))
      await user.click(within(await screen.findByRole('dialog', WARNING)).getByRole('button', { name: '最後のゲーム内セーブ地点へ戻す' }))

      const restore = within(await screen.findByRole('dialog', { name: '最後のゲーム内セーブ地点へ戻す' }))
      const confirm = restore.getByRole('button', { name: 'アプリ側もセーブ地点へ戻す' })
      expect(confirm).toBeDisabled()
      await user.click(restore.getByRole('checkbox', { name: 'ゲーム側を最後のゲーム内セーブ地点まで戻しました' }))
      await user.click(confirm)

      expect(await screen.findByText(/実行中の生産計画を破棄しました/)).toBeInTheDocument()
      // The restored weapon keeps its save point slots; the Entry carries the user's change.
      // Nothing of the weapon was in progress at the save point, so the restored body is the snapshot's.
      expect(await stored<OwnedWeapon>(database.ownedWeapons, SOURCE_ID)).toEqual(snapshotSource)
      expect(await stored<RngState>(database.rngState, 'current')).toEqual(savePoint!.rngState)
      expect((await stored<BuildListEntry>(database.buildListEntries, ENTRY_ID)).intermediateStateSelection?.improvementPreference).toBe('bonus_first')
      expect(await currentPlan(database, fixture.plan)).toEqual(abandonedBreaking(savePoint!.productionPlan))
      expect(await database.executionHistory.count()).toBe(0)
      expect(await database.executionSavePoints.count()).toBe(0)
    }))

  it('saves a change to a stale Plan Entry without a warning and leaves the stale Plan alone', () =>
    withDatabase(async (database) => {
      const user = userEvent.setup()
      const { fixture, execution, deps } = await started(database, { savePoint: true, confirmedSteps: 1 })
      const stale = await currentPlan(database, fixture.plan)
      await execution.recordOperationUncertain({ planId: fixture.plan.id, planStepId: stale.currentStepId as NonNullable<ProductionPlan['currentStepId']> })
      const plan = await currentPlan(database, fixture.plan)
      expect(plan.status).toBe('stale')
      renderPage(deps)
      const before = await dump(database)

      await user.click(await bonusFirst())

      expect(await screen.findByText('途中採用する状態と改善優先を更新しました。生産計画を再作成してください。')).toBeInTheDocument()
      expect(screen.queryByRole('dialog')).toBeNull()
      expect((await stored<BuildListEntry>(database.buildListEntries, ENTRY_ID)).intermediateStateSelection?.improvementPreference).toBe('bonus_first')
      expect(await currentPlan(database, fixture.plan)).toEqual(plan)
      const after = await dump(database)
      expect(after.executionSavePoints).toEqual(before.executionSavePoints)
      expect(after.executionHistory).toEqual(before.executionHistory)
      expect(after.ownedWeapons).toEqual(before.ownedWeapons)
    }))

  it('refuses an approval once the Plan moved on in another tab, saving nothing', () =>
    withDatabase(async (database) => {
      const user = userEvent.setup()
      const { fixture, execution, deps } = await started(database)
      renderPage(deps)
      await user.click(await bonusFirst())
      await screen.findByRole('dialog', WARNING)
      // Another tab confirms a Step while the warning is open.
      await confirmCurrent(execution, database, fixture.plan)
      const before = await dump(database)

      await user.click(within(screen.getByRole('dialog', WARNING)).getByRole('button', { name: '生産計画を破棄して保存' }))

      expect(await screen.findByText('確認後に生産計画の状態が変わったため、変更を保存していません。もう一度保存してください。')).toBeInTheDocument()
      expect(await dump(database)).toEqual(before)
      expect(await currentPlan(database, fixture.plan)).toMatchObject({ status: 'active' })
    }))
})
