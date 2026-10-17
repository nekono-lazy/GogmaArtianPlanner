import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { AppDatabase } from '../../db/AppDatabase'
import type { ProductionPlan, RejectedBuildListEntry } from '../../domain/models/publicTypes'
import {
  createProductionPlanWithObserver,
  runPlannerDeterministicSchedule,
  type PlannerConflictResolution,
  type PlannerResult,
} from '../../domain/planner'
import { createValidProductionPlan, productionPlanId } from '../../test/fixtures/domainData'
import {
  G0,
  IDEAL_SKILL,
  S0,
  SchedulerScenarioBuilder,
  schedulerIdeal,
} from '../../test/fixtures/plannerScheduler'
import type { OrchestrationScenario } from '../../test/fixtures/plannerConstrainedOrchestration'
import { incompletePlannerTermination } from '../../test/fixtures/plannerTermination'
import { PlannerResultPersistenceService } from './plannerResultPersistenceService'

/**
 * The conflict preference save (Issue #278, `docs/PLANNER_SPEC.md` 9.6.6): the
 * ordinary Planner result of 「この候補を優先」 replaces the Draft it was
 * calculated from, atomically, only when every explicit decision was honoured
 * and recorded, every preferred Entry is completed, and the current Draft is
 * still the source Draft. The Build List is never written and no running Plan
 * is touched.
 */

/** A / B collide on one Gogma position; B / C on a Skill position. */
function scenario() {
  const builder = new SchedulerScenarioBuilder()
  builder.keepAt.set(G0 + 5, schedulerIdeal(0))
  builder.resetAt.set(G0 + 5, schedulerIdeal(1))
  builder.skillAt.set(S0 + 2, IDEAL_SKILL)
  const entryA = builder.existingEntry('entry.a', builder.target('target.a', 0, { priority: 2 }),
    builder.gogma('owned.a'), { bonus: { from: G0, resets: 5, keeps: 1 } })
  const entryB = builder.existingEntry('entry.b', builder.target('target.b', 1, { priority: 4 }),
    builder.gogma('owned.b', { seriesSkillId: 'series_skill.fixture.z' }),
    { bonus: { from: G0, resets: 6 }, skill: { from: S0, resets: 3 } })
  const entryC = builder.existingEntry('entry.c', builder.target('target.c', 20, { priority: 5 }),
    builder.gogma('owned.c', { restorationBonuses: schedulerIdeal(20), seriesSkillId: 'series_skill.fixture.z' }),
    { skill: { from: S0, resets: 3 } })
  return { builder, entryA, entryB, entryC }
}

interface Harness {
  database: AppDatabase
  service: PlannerResultPersistenceService
  built: OrchestrationScenario
  resolutions: PlannerConflictResolution[]
  result: PlannerResult
  sourceDraft: ProductionPlan
}

let sequence = 0

/** Prefers A on the A / B conflict, calculates, and seeds the persisted state the run read, with a source Draft. */
async function withHarness(run: (harness: Harness) => Promise<void>) {
  const probe = scenario()
  const probeScenario = probe.builder.build()
  const conflicts = (await runPlannerDeterministicSchedule(probeScenario.input, probeScenario.dependencies)).conflicts
  const ab = conflicts.find(({ buildListEntryIds }) =>
    buildListEntryIds.includes(probe.entryA.id) && buildListEntryIds.includes(probe.entryB.id))!
  const { builder, entryA } = scenario()
  const resolutions = [{ conflictKey: ab.id, selectedBuildListEntryId: entryA.id }]
  builder.conflictResolutions = resolutions
  const built = builder.build()
  const result = await createProductionPlanWithObserver(built.input, built.dependencies, undefined)
  expect(result.conflictResolutionOutcome?.allPreferredEntriesCompleted).toBe(true)

  sequence += 1
  const name = `planner-conflict-preference-${sequence}`
  const database = new AppDatabase(name)
  await database.open()
  try {
    await database.rngState.put(structuredClone(built.input.rngState))
    await database.normalArtianCounters.bulkPut(structuredClone(built.input.normalCounters))
    await database.ownedWeapons.bulkPut(structuredClone(built.input.ownedWeapons))
    await database.targetWeapons.bulkPut(structuredClone(built.input.targetWeapons))
    await database.buildListEntries.bulkPut(structuredClone(built.input.buildListEntries))
    const sourceDraft = { ...createValidProductionPlan(), id: productionPlanId('plan.source.draft') }
    await database.productionPlans.put(sourceDraft)
    await run({ database, service: new PlannerResultPersistenceService(database), built, resolutions, result, sourceDraft })
  } finally {
    database.close()
    await Dexie.delete(name)
  }
}

function failOnEntryWrite() {
  throw new Error('A conflict preference save must not write the Build List.')
}

async function dump(database: AppDatabase) {
  return {
    plans: await database.productionPlans.toArray(),
    entries: await database.buildListEntries.toArray(),
  }
}

describe('PlannerResultPersistenceService.savePlannerConflictPreferenceResult (9.6.6)', () => {
  it('replaces the source Draft with the new Draft atomically and never writes the Build List', () =>
    withHarness(async ({ database, service, built, resolutions, result, sourceDraft }) => {
      const entriesBefore = await database.buildListEntries.toArray()
      database.buildListEntries.hook('creating', failOnEntryWrite)
      database.buildListEntries.hook('updating', failOnEntryWrite)
      database.buildListEntries.hook('deleting', failOnEntryWrite)

      const saved = await service.savePlannerConflictPreferenceResult(
        result,
        { conflictResolutions: resolutions, expectedSourceDraftId: sourceDraft.id },
        built.input.calculationContext,
      )

      expect(saved).toEqual({ kind: 'saved', plan: result.plan })
      expect((await database.productionPlans.toArray()).map(({ id }) => id)).toEqual([result.plan!.id])
      expect((await database.productionPlans.get(result.plan!.id))?.conflictRepairLineage).toBeNull()
      expect(await database.buildListEntries.toArray()).toEqual(entriesBefore)
    }))

  it('saves beside a running Plan without asking for an approval and leaves it untouched', () =>
    withHarness(async ({ database, service, built, resolutions, result, sourceDraft }) => {
      const running = { ...createValidProductionPlan(), id: productionPlanId('plan.running'), status: 'active' as const }
      await database.productionPlans.put(running)

      await service.savePlannerConflictPreferenceResult(
        result,
        { conflictResolutions: resolutions, expectedSourceDraftId: sourceDraft.id },
        built.input.calculationContext,
      )

      expect(await database.productionPlans.get(running.id)).toEqual(running)
    }))

  it.each([
    ['another Draft replaced the source Draft', async (database: AppDatabase, source: ProductionPlan) => {
      await database.productionPlans.delete(source.id)
      await database.productionPlans.put({ ...source, id: productionPlanId('plan.other.draft') })
    }, 'planner_state_changed'],
    ['the source Draft was started', async (database: AppDatabase, source: ProductionPlan) => {
      await database.productionPlans.put({ ...source, status: 'active' })
    }, 'planner_state_changed'],
    ['the source Draft was deleted', async (database: AppDatabase, source: ProductionPlan) => {
      await database.productionPlans.delete(source.id)
    }, 'planner_state_changed'],
    ['two Drafts are stored', async (database: AppDatabase, source: ProductionPlan) => {
      await database.productionPlans.put({ ...source, id: productionPlanId('plan.second.draft') })
    }, 'draft_plan_conflict'],
  ] as const)('writes nothing when %s (the source Draft CAS)', (_, change, code) =>
    withHarness(async ({ database, service, built, resolutions, result, sourceDraft }) => {
      await change(database, sourceDraft)
      const before = await dump(database)
      await expect(service.savePlannerConflictPreferenceResult(
        result,
        { conflictResolutions: resolutions, expectedSourceDraftId: sourceDraft.id },
        built.input.calculationContext,
      )).rejects.toMatchObject({ code })
      expect(await dump(database)).toEqual(before)
    }))

  it('writes nothing when the current state moved under the calculation', () =>
    withHarness(async ({ database, service, built, resolutions, result, sourceDraft }) => {
      const [target] = built.input.targetWeapons
      await database.targetWeapons.put({ ...target, priority: target.priority === 1 ? 2 : 1 })
      const before = await dump(database)
      await expect(service.savePlannerConflictPreferenceResult(
        result,
        { conflictResolutions: resolutions, expectedSourceDraftId: sourceDraft.id },
        built.input.calculationContext,
      )).rejects.toMatchObject({ code: 'planner_state_changed' })
      expect(await dump(database)).toEqual(before)
    }))

  it.each([
    ['an invalid_conflict_resolution warning', (result: PlannerResult) => ({
      ...result, warnings: [...result.warnings, { kind: 'invalid_conflict_resolution' as const, message: 'refused' }],
    })],
    ['Conflicts that differ between the result and its Plan', (result: PlannerResult) => ({
      ...result, conflicts: result.conflicts.map((conflict) => ({ ...conflict, reason: 'changed' })),
    })],
  ] as const)('refuses a result with %s and writes nothing', (_, edit) =>
    withHarness(async ({ database, service, built, resolutions, result, sourceDraft }) => {
      const before = await dump(database)
      await expect(service.savePlannerConflictPreferenceResult(
        edit(result),
        { conflictResolutions: resolutions, expectedSourceDraftId: sourceDraft.id },
        built.input.calculationContext,
      )).rejects.toMatchObject({ code: 'planner_result_invalid' })
      expect(await dump(database)).toEqual(before)
    }))

  it('refuses decisions the Plan does not record exactly, and an empty decision set', () =>
    withHarness(async ({ database, service, built, resolutions, result, sourceDraft }) => {
      const before = await dump(database)
      for (const conflictResolutions of [
        [...resolutions, { conflictKey: 'conflict.extra', selectedBuildListEntryId: resolutions[0].selectedBuildListEntryId }],
        [],
      ]) {
        await expect(service.savePlannerConflictPreferenceResult(
          result,
          { conflictResolutions, expectedSourceDraftId: sourceDraft.id },
          built.input.calculationContext,
        )).rejects.toMatchObject({ code: 'planner_result_invalid' })
      }
      expect(await dump(database)).toEqual(before)
    }))

  it('stores the rejected record with its Target and cause exactly as calculated (Issue #121)', () =>
    withHarness(async ({ database, service, built, resolutions, result, sourceDraft }) => {
      const records = result.plan!.rejectedBuildListEntries
      const entryB = built.input.buildListEntries.find(({ id }) => id === 'entry.b')!
      // B lost the explicit decision for A.
      expect(records).toContainEqual(expect.objectContaining({
        buildListEntryId: entryB.id,
        targetWeaponId: entryB.targetWeaponId,
        reason: 'resource_conflict',
        resourceConflictCause: 'explicit_resolution_not_selected',
      }))
      await service.savePlannerConflictPreferenceResult(
        result,
        { conflictResolutions: resolutions, expectedSourceDraftId: sourceDraft.id },
        built.input.calculationContext,
      )
      expect((await database.productionPlans.get(result.plan!.id))?.rejectedBuildListEntries).toEqual(records)
    }))

  it.each([
    ['a record without its Target', (record: RejectedBuildListEntry) => {
      const { targetWeaponId: _targetWeaponId, ...rest } = record
      void _targetWeaponId
      return rest
    }, /does not record its targetWeaponId/],
    ['a resource_conflict record without its cause', (record: RejectedBuildListEntry) => {
      const { resourceConflictCause: _cause, ...rest } = record
      void _cause
      return rest
    }, /without a resourceConflictCause/],
    ['a record naming another Target than its Entry', (record: RejectedBuildListEntry) => ({
      ...record, targetWeaponId: 'target.a' as RejectedBuildListEntry['targetWeaponId'],
    }), /records TargetWeapon 'target.a' for BuildListEntry 'entry.b', whose TargetWeapon is 'target.b'/],
  ] as const)('refuses a Plan with %s and writes nothing (Issue #121)', (_, edit, message) =>
    withHarness(async ({ database, service, built, resolutions, result, sourceDraft }) => {
      const plan = result.plan!
      const edited: PlannerResult = {
        ...result,
        plan: {
          ...plan,
          rejectedBuildListEntries: plan.rejectedBuildListEntries.map((record) =>
            record.buildListEntryId === 'entry.b' ? edit(record) : record),
        },
      }
      const before = await dump(database)
      await expect(service.savePlannerConflictPreferenceResult(
        edited,
        { conflictResolutions: resolutions, expectedSourceDraftId: sourceDraft.id },
        built.input.calculationContext,
      )).rejects.toMatchObject({ code: 'planner_result_invalid', message: expect.stringMatching(message) })
      expect(await dump(database)).toEqual(before)
    }))

  it('refuses an incomplete run and keeps the source Draft for a run without a Plan', () =>
    withHarness(async ({ database, service, built, resolutions, result, sourceDraft }) => {
      const context = { conflictResolutions: resolutions, expectedSourceDraftId: sourceDraft.id }
      const before = await dump(database)
      await expect(service.savePlannerConflictPreferenceResult(
        { ...result, termination: incompletePlannerTermination() },
        context,
        built.input.calculationContext,
      )).rejects.toMatchObject({ code: 'planner_result_invalid' })
      expect(await service.savePlannerConflictPreferenceResult({ ...result, plan: null }, context, built.input.calculationContext))
        .toEqual({ kind: 'no_plan' })
      expect(await dump(database)).toEqual(before)
    }))
})
