import { render, screen, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import type { AppDatabase } from '../db/AppDatabase'
import { ProductionPlanRepository } from '../db/repositories/productionPlanRepository'
import { RngStateRepository } from '../db/repositories/rngStateRepository'
import type { ProductionPlan } from '../domain/models/publicTypes'
import { ProductionRngEngine } from '../domain/rng/production/productionRngEngine'
import { loadPersistentReidentificationReminder } from '../services/execution/persistentReidentificationReminderService'
import { PlanBreakingChangeGuard } from '../services/execution/planBreakingChangeGuard'
import { IdentificationAdoptionService } from '../services/rngIdentification/identificationAdoptionService'
import { RngStatePersistenceService } from '../services/rngState/rngStatePersistenceService'
import { useSettingsStore } from '../stores/settingsStore'
import {
  bonusResult,
  currentPlan,
  differentBonuses,
  executionService,
  existingGogmaFixture,
  newNormalFixture,
  recordDifferent,
  seed,
  stepOf,
  withDatabase,
  type ExecutionFixture,
} from '../test/fixtures/executionRuntime'
import { createValidMasterDataFixture } from '../test/fixtures/masterData'
import { DashboardPage, type DashboardPageDependencies } from './DashboardPage'

/**
 * The persistent re-identification reminder end to end (`docs/PLANNER_SPEC.md`
 * 16.15): a real Plan from the real Planner, a real `actual_result_different`
 * record written by the real Execution runtime, the real Plan abandonment, the
 * real Identification adoption paths writing the provenance, and the Dashboard
 * reading it all back through the persistent reminder loader.
 */

const TITLE = '予測と異なる結果の再同定が必要です'
const RNG_TEXT = '予測と異なる結果が記録された後、RNG状態の再同定がまだ完了していません。'
const NORMAL_TEXT = '予測と異なる結果が記録された後、通常アーティアCounterの再同定がまだ完了していません。'
const IDENTIFICATION_CLOCK = '2026-09-18T00:00:00.000Z'
const NORMAL_COUNTER_ID = 'weapon.fixture.a:8'
const master = createValidMasterDataFixture()
const weaponTypeName = master.weaponTypes.find(({ id }) => id === 'weapon.fixture.a')?.displayNameJa
if (!weaponTypeName) throw new Error('The fixture Master must define weapon.fixture.a.')

function dependencies(database: AppDatabase): DashboardPageDependencies {
  return {
    master,
    getRngState: () => new RngStateRepository(database).getCurrentRngState(),
    getNormalCounters: () => database.normalArtianCounters.toArray(),
    getOwnedWeapons: () => database.ownedWeapons.toArray(),
    getTargetWeapons: () => database.targetWeapons.toArray(),
    getBuildListEntries: () => database.buildListEntries.toArray(),
    getActivePlan: () => new ProductionPlanRepository(database).getActiveProductionPlan(),
    getReidentificationReminder: () => loadPersistentReidentificationReminder(database),
  }
}

function renderDashboard(database: AppDatabase) {
  const router = createMemoryRouter(
    [{ path: '/', element: <DashboardPage dependencies={dependencies(database)} /> }],
    { initialEntries: ['/'] },
  )
  return render(<RouterProvider router={router} />)
}

function identificationServices(database: AppDatabase, fixture: ExecutionFixture) {
  const guard = new PlanBreakingChangeGuard({
    database,
    currentCalculationContext: structuredClone(fixture.built.input.calculationContext),
    clock: { now: () => IDENTIFICATION_CLOCK },
  })
  return {
    rng: new RngStatePersistenceService({ persistence: guard, clock: { now: () => IDENTIFICATION_CLOCK } }),
    adoption: new IdentificationAdoptionService({
      repository: new RngStateRepository(database),
      persistence: guard,
      seedNormalizer: new ProductionRngEngine(),
      clock: { now: () => IDENTIFICATION_CLOCK },
    }),
  }
}

/** Starts the Plan, records a divergence on its first Step, and abandons it - an ended Plan whose record stays. */
async function divergedAndAbandoned(database: AppDatabase, fixture: ExecutionFixture, scope: 'gogma_artian' | 'normal_artian') {
  await seed(database, fixture)
  const service = executionService(database, fixture.built)
  await service.startProductionPlan(fixture.plan.id)
  const { history } = await recordDifferent(service, database, fixture.plan, bonusResult(differentBonuses(stepOf(fixture.plan, 0).expectedResult?.restorationBonuses), scope))
  expect(history.createdAt < IDENTIFICATION_CLOCK).toBe(true)
  const stale = await currentPlan(database, fixture.plan)
  expect(stale.status).toBe('stale')
  await service.abandonProductionPlan({
    planId: fixture.plan.id,
    observedPlan: { status: stale.status, currentStepId: stale.currentStepId, updatedAt: stale.updatedAt },
    savePointDecision: null,
  })
  const ended = await currentPlan(database, fixture.plan)
  expect(ended).toMatchObject({ status: 'abandoned', abandonmentReason: 'user_abandoned' } satisfies Partial<ProductionPlan>)
  return { service, services: identificationServices(database, fixture) }
}

describe('DashboardPage persistent re-identification reminder (real persistence)', () => {
  beforeEach(() => useSettingsStore.getState().reset())

  it('keeps asking for the RNG Identification after the Plan ended, until the formal adoption is persisted', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      expect(stepOf(fixture.plan, 0).operationType).toBe('reset_bonuses')
      const { services } = await divergedAndAbandoned(database, fixture, 'gogma_artian')

      const first = renderDashboard(database)
      const alert = (await screen.findByText(TITLE)).closest('[role="alert"]') as HTMLElement
      expect(within(alert).getByText(RNG_TEXT)).toBeInTheDocument()
      expect(within(alert).getByRole('link', { name: 'RNG状態設定へ' })).toHaveAttribute('href', '/rng')
      expect(within(alert).queryByText(NORMAL_TEXT)).not.toBeInTheDocument()
      // The reminder sits above the ordinary next action, which it does not change.
      const nextAction = await screen.findByRole('region', { name: '次の操作' })
      expect(alert.compareDocumentPosition(nextAction) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      first.unmount()

      // R1 / R2: a notes-only save and a manual Counter edit move `updatedAt` past the record and resolve nothing.
      const shown = (await database.rngState.get('current'))!
      await services.rng.saveRngState({ ...shown, notes: 'after the divergence' }, shown)
      const withNotes = (await database.rngState.get('current'))!
      await services.rng.saveRngState({ ...withNotes, gogmaCounter: { value: 999, isConfirmed: true, source: 'manual' } }, withNotes)
      expect((await database.rngState.get('current'))?.updatedAt).toBe(IDENTIFICATION_CLOCK)
      const second = renderDashboard(database)
      expect(await screen.findByText(TITLE)).toBeInTheDocument()
      expect(screen.getByText(RNG_TEXT)).toBeInTheDocument()
      second.unmount()

      // R3: the formal adoption after the record resolves it; the record itself stays.
      const adopted = await services.adoption.adopt({ baseSeed: '086315169', startingSkillCounter: 186, startingGogmaCounter: 480 })
      expect(adopted.lastIdentifiedAt).toBe(IDENTIFICATION_CLOCK)
      const third = renderDashboard(database)
      await screen.findByRole('region', { name: '次の操作' })
      expect(screen.queryByText(TITLE)).not.toBeInTheDocument()
      expect((await database.executionHistory.where('planId').equals(fixture.plan.id).toArray()).map(({ action }) => action)).toEqual(['actual_result_different'])
      third.unmount()

      // R5: a manual edit of an adopted value re-opens it.
      await services.rng.saveRngState({ ...adopted, skillCounter: { value: 187, isConfirmed: true, source: 'manual' } }, adopted)
      renderDashboard(database)
      expect(await screen.findByText(TITLE)).toBeInTheDocument()
      expect(screen.getByText(RNG_TEXT)).toBeInTheDocument()
    }), 30_000)

  it('keeps asking for the named Normal Counter after the Plan ended, resolved only by that Counter unique Identification', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture()
      expect(stepOf(fixture.plan, 0).operationType).toBe('create_normal_artian')
      expect(stepOf(fixture.plan, 0).rngAdvance.affectedNormalCounterId).toBe(NORMAL_COUNTER_ID)
      const { services } = await divergedAndAbandoned(database, fixture, 'normal_artian')

      const first = renderDashboard(database)
      const alert = (await screen.findByText(TITLE)).closest('[role="alert"]') as HTMLElement
      expect(within(alert).getByText(NORMAL_TEXT)).toBeInTheDocument()
      expect(within(alert).getByText(`${weaponTypeName}の通常アーティアCounterを再同定してください。`)).toBeInTheDocument()
      expect(within(alert).getByRole('link', { name: '通常アーティアCounterへ' })).toHaveAttribute('href', '/normal-counters')
      expect(within(alert).queryByText(RNG_TEXT)).not.toBeInTheDocument()
      expect(alert.textContent).not.toContain(NORMAL_COUNTER_ID)
      first.unmount()

      // N3 / R3: another weapon type's Counter and the RNG adoption resolve nothing.
      await services.rng.adoptNormalArtianCounterIdentification({ weaponTypeId: 'weapon.fixture.b', startNormalCounter: 10, observationCount: 2 })
      await services.adoption.adopt({ baseSeed: '086315169', startingSkillCounter: 186, startingGogmaCounter: 480 })
      const second = renderDashboard(database)
      expect(await screen.findByText(NORMAL_TEXT)).toBeInTheDocument()
      second.unmount()

      // N2: the named Counter's unique Identification after the record resolves it.
      const adopted = await services.rng.adoptNormalArtianCounterIdentification({ weaponTypeId: 'weapon.fixture.a', startNormalCounter: 10, observationCount: 2 })
      expect(adopted).toMatchObject({ id: NORMAL_COUNTER_ID, isConfirmed: true, lastIdentifiedAt: IDENTIFICATION_CLOCK })
      const third = renderDashboard(database)
      await screen.findByRole('region', { name: '次の操作' })
      expect(screen.queryByText(TITLE)).not.toBeInTheDocument()
      third.unmount()

      // N5: unconfirming the identified Counter re-opens it until it is confirmed again.
      await services.rng.saveNormalArtianCounter({ ...adopted, isConfirmed: false }, adopted)
      renderDashboard(database)
      expect(await screen.findByText(NORMAL_TEXT)).toBeInTheDocument()
    }), 30_000)
})
