import { describe, expect, it } from 'vitest'
import type { AppDatabase } from '../../db/AppDatabase'
import { RepositoryError } from '../../db/repositoryError'
import { ExecutionRuntimeError, type PlanBreakingChangeApproval, type PlanBreakingChangeInspection } from '../../domain/execution'
import type { MasterDataRoot } from '../../domain/master/masterTypes'
import type { OwnedGogmaArtianWeapon, OwnedWeapon, ProductionPlan, TargetWeapon } from '../../domain/models/publicTypes'
import { IDEAL_SERIES_SKILL_ID, idealBonuses } from '../../test/fixtures/constrainedEnumeration'
import {
  confirmCurrent,
  currentPlan,
  dump,
  executionService,
  existingGogmaFixture,
  expectRefusal,
  seed,
  withDatabase,
  type ExecutionFixture,
} from '../../test/fixtures/executionRuntime'
import { orchestrationSource } from '../../test/fixtures/plannerConstrainedOrchestration'
import { PlanBreakingChangeGuard } from '../execution/planBreakingChangeGuard'
import { TargetWeaponLifecycleService } from './targetWeaponLifecycleService'

/**
 * 「この武器で目標を完了にする」 / 「未完了に戻す」 behind the real Dexie
 * Plan-breaking guard (`docs/PLANNER_SPEC.md` 16.6, `docs/UI_FLOW.md` 8.2 / 16.3):
 * the existing authorities alone decide whether an `active` Plan is broken - a
 * Plan-dependent Target through `target_changed`, an execution scope weapon
 * through `owned_weapon_changed` - and the completion, its releases and the
 * approved abandonment are one transaction.
 */

const GUARD_NOW = '2026-09-22T00:00:00.000Z'
const SOURCE_ID = 'owned.execution.gogma' as OwnedWeapon['id']
const GOAL_ID = 'target.execution.gogma' as TargetWeapon['id']
const OTHER_TARGET_ID = 'target.execution.other' as TargetWeapon['id']
const EXTRA_ID = 'owned.acceptance.extra-ideal'

function serviceFor(database: AppDatabase, fixture: ExecutionFixture) {
  const guard = new PlanBreakingChangeGuard({
    database,
    currentCalculationContext: structuredClone(fixture.built.input.calculationContext),
    clock: { now: () => GUARD_NOW },
  })
  return new TargetWeaponLifecycleService(fixture.built.input.master as unknown as MasterDataRoot, { persistence: guard })
}

/** A Plan-independent Gogma that already performs as the fixture Targets' Ideal. */
function extraIdealWeapon(): OwnedGogmaArtianWeapon {
  return orchestrationSource(EXTRA_ID, { restorationBonuses: idealBonuses(), seriesSkillId: IDEAL_SERIES_SKILL_ID })
}

async function started(database: AppDatabase, fixture: ExecutionFixture) {
  await seed(database, fixture)
  const execution = executionService(database, fixture.built)
  await execution.startProductionPlan(fixture.plan.id)
  await confirmCurrent(execution, database, fixture.plan)
  // Added after the Plan was calculated and started, so it is neither a Route
  // reference nor a registered weapon: outside the execution scope.
  await database.ownedWeapons.put(extraIdealWeapon())
  return { execution, service: serviceFor(database, fixture) }
}

function approvalOf(inspection: PlanBreakingChangeInspection): PlanBreakingChangeApproval {
  if (!inspection.approvalRequired) throw new Error('The change was expected to need approval.')
  return { observedPlan: inspection.observedPlan, savePointDecision: null }
}

async function stored<T>(table: { get(id: string): Promise<T | undefined> }, id: string): Promise<T> {
  return (await table.get(id)) as T
}

describe('Direct Target completion beside an active Plan', () => {
  it('needs no approval and leaves the Plan untouched when the Target and the weapon are Plan-independent', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      const { service } = await started(database, fixture)
      const before = await dump(database)
      const extra = await stored<OwnedWeapon>(database.ownedWeapons, EXTRA_ID)

      expect(await service.inspectCompleteWithOwnedIdeal(OTHER_TARGET_ID, extra.id, GUARD_NOW)).toEqual({ approvalRequired: false })
      const result = await service.completeWithOwnedIdeal(OTHER_TARGET_ID, extra.id, GUARD_NOW)

      expect(result.target).toMatchObject({ id: OTHER_TARGET_ID, lifecycleStatus: 'completed', completedAt: GUARD_NOW, completedByProductionPlanId: null, preferredOwnedWeaponId: null })
      expect(result.ownedWeapon).toEqual({ ...extra, status: 'ideal', isProtected: true, updatedAt: GUARD_NOW })
      const after = await dump(database)
      expect(after.productionPlans).toEqual(before.productionPlans)
      expect(after.productionPlans[0].status).toBe('active')
      expect({ ...after, targetWeapons: [], ownedWeapons: [] }).toEqual({ ...before, targetWeapons: [], ownedWeapons: [] })
      expect(after.ownedWeapons.find(({ id }) => id === SOURCE_ID)).toEqual(before.ownedWeapons.find(({ id }) => id === SOURCE_ID))
      expect(after.targetWeapons.find(({ id }) => id === GOAL_ID)).toEqual(before.targetWeapons.find(({ id }) => id === GOAL_ID))
      expect(after.ownedWeapons.find(({ id }) => id === SOURCE_ID)).toMatchObject({ executionInProgress: { productionPlanId: fixture.plan.id } })
    }))

  it('refuses without approval, and with it completes the Plan-dependent Target and abandons the Plan atomically', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      const { service } = await started(database, fixture)
      const plan = await currentPlan(database, fixture.plan)
      const extra = await stored<OwnedWeapon>(database.ownedWeapons, EXTRA_ID)

      const inspection = await service.inspectCompleteWithOwnedIdeal(GOAL_ID, extra.id, GUARD_NOW)
      expect(inspection).toEqual({
        approvalRequired: true,
        reasons: ['target_changed'],
        observedPlan: { planId: plan.id, status: 'active', currentStepId: plan.currentStepId, updatedAt: plan.updatedAt },
        savePointChoiceRequired: false,
      })
      await expectRefusal(() => service.completeWithOwnedIdeal(GOAL_ID, extra.id, GUARD_NOW), database, 'plan_breaking_change_approval_required')
      expect(await stored<TargetWeapon>(database.targetWeapons, GOAL_ID)).toMatchObject({ lifecycleStatus: 'active', preferredOwnedWeaponId: SOURCE_ID })

      const result = await service.completeWithOwnedIdeal(GOAL_ID, extra.id, GUARD_NOW, approvalOf(inspection))

      expect(result.target).toMatchObject({ id: GOAL_ID, lifecycleStatus: 'completed', completedByProductionPlanId: null, preferredOwnedWeaponId: null })
      expect(result.ownedWeapon).toMatchObject({ id: EXTRA_ID, status: 'ideal', isProtected: true })
      expect(await currentPlan(database, fixture.plan)).toMatchObject({ status: 'abandoned', abandonmentReason: 'breaking_change_approved', abandonedAt: GUARD_NOW, currentStepId: plan.currentStepId })
      expect(await stored<OwnedWeapon>(database.ownedWeapons, SOURCE_ID)).toMatchObject({ executionInProgress: null, isProtected: false })
      expect(await stored<TargetWeapon>(database.targetWeapons, GOAL_ID)).toEqual(result.target)
      expect(await stored<OwnedWeapon>(database.ownedWeapons, EXTRA_ID)).toEqual(result.ownedWeapon)
      expect(await database.executionSavePoints.count()).toBe(0)
    }))

  it('detects the execution scope weapon and releases the Plan-dependent Target preferring it', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      const { service } = await started(database, fixture)
      // The Plan's own source weapon, edited to the Ideal performance of the
      // Plan-independent Target: a completion with it protects a weapon the
      // Plan tracks and unlinks the Plan-dependent Target that prefers it.
      const source = await stored<OwnedWeapon>(database.ownedWeapons, SOURCE_ID)
      if (source.kind !== 'gogma') throw new Error('The fixture source is a Gogma weapon.')
      await database.ownedWeapons.put({ ...source, restorationBonuses: idealBonuses(), seriesSkillId: IDEAL_SERIES_SKILL_ID })

      const inspection = await service.inspectCompleteWithOwnedIdeal(OTHER_TARGET_ID, SOURCE_ID, GUARD_NOW)
      expect(inspection).toMatchObject({ approvalRequired: true, reasons: ['owned_weapon_changed', 'target_changed'] })
      await expectRefusal(() => service.completeWithOwnedIdeal(OTHER_TARGET_ID, SOURCE_ID, GUARD_NOW), database, 'plan_breaking_change_approval_required')

      const result = await service.completeWithOwnedIdeal(OTHER_TARGET_ID, SOURCE_ID, GUARD_NOW, approvalOf(inspection))

      expect(result.releasedTargetIds).toEqual([GOAL_ID])
      expect(result.ownedWeapon).toMatchObject({ id: SOURCE_ID, status: 'ideal', isProtected: true, executionInProgress: null })
      const goal = await stored<TargetWeapon>(database.targetWeapons, GOAL_ID)
      const goalBefore = fixture.built.input.targetWeapons.find(({ id }) => id === GOAL_ID) as TargetWeapon
      expect(goal).toEqual({ ...goalBefore, preferredOwnedWeaponId: null, updatedAt: GUARD_NOW })
      expect(await currentPlan(database, fixture.plan)).toMatchObject({ status: 'abandoned', abandonmentReason: 'breaking_change_approved' })
    }))

  it('refuses an approval for a Plan that moved on', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      const { service } = await started(database, fixture)
      const extra = await stored<OwnedWeapon>(database.ownedWeapons, EXTRA_ID)
      const inspection = await service.inspectCompleteWithOwnedIdeal(GOAL_ID, extra.id, GUARD_NOW)
      // The Plan the user saw moved on (another writer updated it).
      const plan = await currentPlan(database, fixture.plan)
      await database.productionPlans.put({ ...plan, updatedAt: '2026-09-22T00:00:01.000Z' })
      const before = await dump(database)
      const caught = await service.completeWithOwnedIdeal(GOAL_ID, extra.id, GUARD_NOW, approvalOf(inspection)).catch((error: unknown) => error)
      expect(caught).toBeInstanceOf(ExecutionRuntimeError)
      expect(await dump(database)).toEqual(before)
    }))

  it.each([
    ['the Target write', (database: AppDatabase) => database.targetWeapons.hook('updating', () => { throw new Error('storage failure') })],
    ['the weapon write', (database: AppDatabase) => database.ownedWeapons.hook('updating', () => { throw new Error('storage failure') })],
  ])('rolls the whole completion back when %s fails', (_label, fail) =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      const { service } = await started(database, fixture)
      const extra = await stored<OwnedWeapon>(database.ownedWeapons, EXTRA_ID)
      // The Plan-independent Target prefers the weapon too, so the completion
      // writes the completed Target, the protected weapon and a release.
      const other = await stored<TargetWeapon>(database.targetWeapons, OTHER_TARGET_ID)
      await database.targetWeapons.put({ ...other, preferredOwnedWeaponId: extra.id })
      const added: TargetWeapon = { ...other, id: 'target.acceptance.added' as TargetWeapon['id'], name: 'added', preferredOwnedWeaponId: null }
      await database.targetWeapons.put(added)
      const before = await dump(database)
      fail(database)

      const failure = await service.completeWithOwnedIdeal(added.id, extra.id, GUARD_NOW).catch((error: unknown) => error)

      expect(failure).toBeInstanceOf(RepositoryError)
      expect(failure).toMatchObject({ code: 'transaction_failed' })
      expect(await dump(database)).toEqual(before)
      expect(await stored<OwnedWeapon>(database.ownedWeapons, EXTRA_ID)).toMatchObject({ status: 'unclassified', isProtected: false })
      expect(await stored<TargetWeapon>(database.targetWeapons, added.id)).toMatchObject({ lifecycleStatus: 'active' })
      expect(await stored<TargetWeapon>(database.targetWeapons, OTHER_TARGET_ID)).toMatchObject({ preferredOwnedWeaponId: extra.id })
    }))
})

describe('Reopening a Target beside an active Plan', () => {
  it('needs no approval for a Plan-independent Target and leaves the Plan and every weapon untouched', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      const { service } = await started(database, fixture)
      const extra = await stored<OwnedWeapon>(database.ownedWeapons, EXTRA_ID)
      await service.completeWithOwnedIdeal(OTHER_TARGET_ID, extra.id, GUARD_NOW)
      const before = await dump(database)

      expect(await service.inspectReopen(OTHER_TARGET_ID, GUARD_NOW)).toEqual({ approvalRequired: false })
      const reopened = await service.reopen(OTHER_TARGET_ID, GUARD_NOW)

      expect(reopened).toMatchObject({ lifecycleStatus: 'active', completedAt: null, completedByProductionPlanId: null, preferredOwnedWeaponId: null })
      const after = await dump(database)
      expect({ ...after, targetWeapons: [] }).toEqual({ ...before, targetWeapons: [] })
      expect((after.productionPlans[0] as ProductionPlan).status).toBe('active')
      expect(after.ownedWeapons.find(({ id }) => id === EXTRA_ID)).toMatchObject({ status: 'ideal', isProtected: true })
    }))
})
