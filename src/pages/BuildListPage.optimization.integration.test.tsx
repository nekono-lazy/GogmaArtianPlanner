import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Dexie from 'dexie'
import { createMemoryRouter, RouterProvider, useParams } from 'react-router-dom'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { AppDatabase } from '../db/AppDatabase'
import { ProductionPlanRepository } from '../db/repositories/productionPlanRepository'
import type { MasterDataRoot } from '../domain/master/masterTypes'
import type { ProductionPlan, ProductionPlanId } from '../domain/models/publicTypes'
import { createProductionPlannerDependencies } from '../domain/planner'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../domain/rng/production/productionRngEngine'
import { createBuildListCalculationContext } from '../services/buildList/createBuildListCalculationContext'
import type { ProductionPlanReplanDependencies } from '../services/execution/productionPlanReplanDependencies'
import { createBuildListOptimizationSession, createBuildListOptimizationStartReader } from '../services/planner/buildListOptimizationService'
import { createPlanCreationPreparer, createPlanCreationSession } from '../services/planner/planCreationService'
import { PlannerResultPersistenceService } from '../services/planner/plannerResultPersistenceService'
import type { PlannerWorkerClient } from '../services/planner/plannerWorkerClient'
import {
  createBuildListOptimizationAdoptionFixture,
  replacedBuildList,
  type BuildListOptimizationAdoptionFixture,
  type BuildListOptimizationAdoptionVariant,
} from '../test/fixtures/buildListOptimizationAdoptionFixtures'
import { presentationTestMaster } from '../test/fixtures/buildListOptimizationPresentationFixtures'
import { fakeBuildListOptimizationClient } from '../test/fixtures/buildListPagePlanCreation'
import { createValidProductionPlan, productionPlanId } from '../test/fixtures/domainData'
import { dump } from '../test/fixtures/executionRuntime'
import { BuildListPage, type BuildListPageDependencies } from './BuildListPage'

/*
 * Issue #260 PR-6C: the Build List page's adoption of a global optimization over the real boundary - a real Dexie database, the real
 * start reader and method judgement, the real plan creation and optimization sessions, and the real `PlannerResultPersistenceService`.
 * Only the optimization Worker is a double: it answers with the real `optimized` artifact of the very state the database holds
 * (`runBuildListOptimization()`, `createBuildListOptimizationAdoptionFixture()`).
 */

const PREVIOUS_DRAFT_ID = productionPlanId('plan.draft.before.adoption')
const ADOPT = 'この計画を採用'
const DIALOG = 'この計画を採用しますか？'
const PREVIEW_TITLE = '全体最適化の試算（未採用）'

let master: MasterDataRoot
const fixtures = new Map<BuildListOptimizationAdoptionVariant, BuildListOptimizationAdoptionFixture>()

beforeAll(async () => {
  master = presentationTestMaster()
  fixtures.set('scoped', await createBuildListOptimizationAdoptionFixture('scoped'))
  fixtures.set('unchanged', await createBuildListOptimizationAdoptionFixture('unchanged'))
})

function unusedReplan(): ProductionPlanReplanDependencies {
  const notExpected = () => Promise.reject(new Error('replan is not expected'))
  return {
    prepareProductionPlanReplanPreview: vi.fn(notExpected),
    createProductionPlanReplanPreview: vi.fn(() => { throw new Error('replan is not expected') }),
    inspectProductionPlanReplanAdoption: vi.fn(notExpected),
    adoptProductionPlanReplanPreview: vi.fn(notExpected),
  }
}

function unusedPlannerClient(): PlannerWorkerClient {
  const notExpected = vi.fn(() => Promise.reject(new Error('the ordinary Planner is not expected')))
  return {
    engineVersion: PRODUCTION_RNG_ENGINE_VERSION,
    createPlan: notExpected,
    prepareInteraction: notExpected,
    cancelPlan: vi.fn(),
    dispose: vi.fn(),
  }
}

interface Scenario {
  database: AppDatabase
  fixture: BuildListOptimizationAdoptionFixture
  deps: BuildListPageDependencies
  optimization: ReturnType<typeof fakeBuildListOptimizationClient>
  ordinary: PlannerWorkerClient
}

async function withScenario(variant: BuildListOptimizationAdoptionVariant, run: (scenario: Scenario) => Promise<void>) {
  const name = `build-list-page-optimization-${crypto.randomUUID()}`
  const database = new AppDatabase(name)
  await database.open()
  try {
    const shared = fixtures.get(variant)!
    const fixture: BuildListOptimizationAdoptionFixture = { input: structuredClone(shared.input), artifact: structuredClone(shared.artifact), engine: shared.engine }
    await database.rngState.put(structuredClone(fixture.input.rngState))
    await database.normalArtianCounters.bulkPut(structuredClone(fixture.input.normalCounters))
    await database.ownedWeapons.bulkPut(structuredClone(fixture.input.ownedWeapons))
    await database.targetWeapons.bulkPut(structuredClone(fixture.input.targetWeapons))
    await database.buildListEntries.bulkPut(structuredClone(fixture.input.buildListEntries))
    await database.productionPlans.put({ ...createValidProductionPlan(), id: PREVIOUS_DRAFT_ID })

    const calculationContext = createBuildListCalculationContext(master)
    const startReader = createBuildListOptimizationStartReader(database, master, calculationContext)
    const optimization = fakeBuildListOptimizationClient()
    const ordinary = unusedPlannerClient()
    const persistence = new PlannerResultPersistenceService(database)
    const plans = new ProductionPlanRepository(database)
    let requestSequence = 0
    const deps: BuildListPageDependencies = {
      master,
      createWorkerClient: () => unusedPlannerClient(),
      refresh: async () => ({
        entries: await database.buildListEntries.toArray(),
        targets: await database.targetWeapons.toArray(),
        ownedWeapons: await database.ownedWeapons.toArray(),
      }),
      createPlanCreationSession: () => createPlanCreationSession({
        preparer: createPlanCreationPreparer({ startReader, plannerDependencies: createProductionPlannerDependencies(fixture.engine) }),
        optimization: createBuildListOptimizationSession({ startReader, createClient: () => optimization.client }),
        createPlannerClient: () => ordinary,
        createRequestId: () => `integration-request-${++requestSequence}`,
      }),
      inspectBuildListOptimizationAdoption: (source, context) => persistence.inspectBuildListOptimizationAdoptionSave(source, context),
      saveBuildListOptimizationAdoption: async (source, context) => (await persistence.saveBuildListOptimizationAdoption(source, context)).plan,
      savePlannerResult: () => Promise.reject(new Error('the ordinary save is not expected')),
      updateIntermediateStateSelection: () => Promise.reject(new Error('not expected')),
      inspectIntermediateStateSelectionUpdate: () => Promise.reject(new Error('not expected')),
      deleteEntry: () => Promise.reject(new Error('not expected')),
      inspectEntryDelete: () => Promise.reject(new Error('not expected')),
      getRunningProductionPlan: () => plans.getRunningProductionPlan(),
      getDraftProductionPlan: () => plans.getDraftProductionPlan(),
      replan: unusedReplan(),
    }
    await run({ database, fixture, deps, optimization, ordinary })
  } finally {
    database.close()
    await Dexie.delete(name)
  }
}

function PlanDestination() {
  const { planId } = useParams()
  return <div>Plan destination: {planId}</div>
}

function renderPage(deps: BuildListPageDependencies) {
  const router = createMemoryRouter([
    { path: '/build-list', element: <BuildListPage dependencies={deps} /> },
    { path: '/plans/:planId', element: <PlanDestination /> },
  ], { initialEntries: ['/build-list'] })
  return { router, ...render(<RouterProvider router={router} />) }
}

/** Presses 「生産計画を作成」 once the real judgement chose the optimization, and answers with the fixture's artifact. */
async function calculateToPreview(scenario: Scenario, user: ReturnType<typeof userEvent.setup>) {
  expect(await screen.findByText(/有効な候補が3件あります。/)).toBeInTheDocument()
  const create = screen.getByRole('button', { name: '生産計画を作成' })
  await waitFor(() => expect(create).toBeEnabled())
  await user.click(create)
  await waitFor(() => expect(scenario.optimization.runs).toHaveLength(1))
  // The Worker received the state the database holds, read at the press.
  expect(scenario.optimization.runs[0]!.input.buildListEntries.map(({ id }) => id).sort())
    .toEqual(scenario.fixture.input.buildListEntries.map(({ id }) => id).sort())
  await act(async () => {
    scenario.optimization.runs[0]!.complete({ status: 'optimized', artifact: structuredClone(scenario.fixture.artifact) })
  })
  expect(await screen.findByRole('heading', { name: PREVIEW_TITLE })).toBeInTheDocument()
}

const sortedIds = (values: readonly { id: string }[]) => values.map(({ id }) => id).sort()

describe('BuildListPage global optimization adoption over the real Persistence (PLANNER_SPEC 17.11)', () => {
  it('replaces the Entries and the Draft in one adoption and opens the stored Draft', async () => {
    await withScenario('scoped', async (scenario) => {
      const user = userEvent.setup()
      const view = renderPage(scenario.deps)
      await calculateToPreview(scenario, user)
      // Showing the Preview wrote nothing.
      const before = await dump(scenario.database)
      expect(sortedIds(before.buildListEntries)).toEqual(sortedIds(scenario.fixture.input.buildListEntries))

      await user.click(screen.getByRole('button', { name: ADOPT }))
      const dialog = await screen.findByRole('dialog', { name: DIALOG })
      expect(within(dialog).getByText(`${scenario.fixture.artifact.replacements.length}件`)).toBeInTheDocument()
      expect(within(dialog).getByText('この計画に置き換えます')).toBeInTheDocument()
      // The inspection wrote nothing either.
      expect(await dump(scenario.database)).toEqual(before)

      await user.click(within(dialog).getByRole('button', { name: ADOPT }))
      const destination = await screen.findByText(/^Plan destination: /)
      const savedId = destination.textContent!.replace('Plan destination: ', '') as ProductionPlanId
      expect(view.router.state.location.pathname).toBe(`/plans/${savedId}`)

      const after = await dump(scenario.database)
      // Exactly one Draft: the adopted one, under the ID Persistence returned; the previous Draft is gone.
      const drafts = after.productionPlans.filter(({ status }) => status === 'draft')
      expect(drafts.map(({ id }) => id)).toEqual([savedId])
      expect(savedId).not.toBe(PREVIOUS_DRAFT_ID)
      expect((drafts[0] as ProductionPlan).conflictRepairLineage).toBeNull()
      // The Build List is the replaced one: each replaced Entry removed, each generated Entry added, every other Entry kept.
      expect(sortedIds(after.buildListEntries)).toEqual(sortedIds(replacedBuildList(scenario.fixture.input, scenario.fixture.artifact)))
      expect(scenario.ordinary.createPlan).not.toHaveBeenCalled()
    })
  })

  it('adopts a replacement-free result as the Draft alone', async () => {
    await withScenario('unchanged', async (scenario) => {
      expect(scenario.fixture.artifact.replacements).toHaveLength(0)
      const user = userEvent.setup()
      renderPage(scenario.deps)
      await calculateToPreview(scenario, user)
      await user.click(screen.getByRole('button', { name: ADOPT }))
      const dialog = await screen.findByRole('dialog', { name: DIALOG })
      expect(within(dialog).getByText('置き換える候補はありません。作成リストは変更せず、生産計画（下書き）だけを保存します。')).toBeInTheDocument()
      const entriesBefore = (await dump(scenario.database)).buildListEntries
      await user.click(within(dialog).getByRole('button', { name: ADOPT }))
      await screen.findByText(/^Plan destination: /)
      const after = await dump(scenario.database)
      expect(after.buildListEntries).toEqual(entriesBefore)
      expect(after.productionPlans.filter(({ status }) => status === 'draft')).toHaveLength(1)
      expect(after.productionPlans.some(({ id }) => id === PREVIOUS_DRAFT_ID)).toBe(false)
    })
  })

  it('refuses at the inspection when the state changed after the calculation, keeping the Entries and the Draft', async () => {
    await withScenario('scoped', async (scenario) => {
      const user = userEvent.setup()
      renderPage(scenario.deps)
      await calculateToPreview(scenario, user)
      // Another screen changed a Target's priority after the calculation (the input token covers every Target).
      const target = (await scenario.database.targetWeapons.toArray())[0]!
      await scenario.database.targetWeapons.put({ ...target, priority: target.priority === 5 ? 4 : 5 })
      const changed = await dump(scenario.database)

      await user.click(screen.getByRole('button', { name: ADOPT }))
      expect(await screen.findByText('試算の後に状態が変わったため、採用できませんでした')).toBeInTheDocument()
      expect(screen.queryByRole('dialog', { name: DIALOG })).not.toBeInTheDocument()
      await waitFor(() => expect(screen.queryByRole('heading', { name: PREVIEW_TITLE })).not.toBeInTheDocument())
      expect(await dump(scenario.database)).toEqual(changed)
      expect(scenario.optimization.runs).toHaveLength(1)
    })
  })

  it('refuses at the save when a Draft appeared after the inspection, writing nothing', async () => {
    await withScenario('scoped', async (scenario) => {
      const user = userEvent.setup()
      renderPage(scenario.deps)
      await calculateToPreview(scenario, user)
      await user.click(screen.getByRole('button', { name: ADOPT }))
      const dialog = await screen.findByRole('dialog', { name: DIALOG })
      // Between the confirmation and the save, another screen replaced the Draft the calculation observed.
      await scenario.database.productionPlans.delete(PREVIOUS_DRAFT_ID)
      await scenario.database.productionPlans.put({ ...createValidProductionPlan(), id: productionPlanId('plan.draft.elsewhere') })
      const changed = await dump(scenario.database)

      await user.click(within(dialog).getByRole('button', { name: ADOPT }))
      expect(await screen.findByText('試算の後に状態が変わったため、採用できませんでした')).toBeInTheDocument()
      await waitFor(() => expect(screen.queryByRole('dialog', { name: DIALOG })).not.toBeInTheDocument())
      // The previous Entries and the other Draft stay exactly as they were: the adoption is all or nothing.
      expect(await dump(scenario.database)).toEqual(changed)
      expect(screen.queryByText(/^Plan destination: /)).not.toBeInTheDocument()
    })
  })
})
