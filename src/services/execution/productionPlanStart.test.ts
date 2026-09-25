import { describe, expect, it } from 'vitest'
import type { AppDatabase } from '../../db/AppDatabase'
import { RepositoryError } from '../../db/repositoryError'
import { ExecutionRuntimeError } from '../../domain/execution'
import type { OwnedWeaponId, PlanStep, TargetWeapon } from '../../domain/models/publicTypes'
import { CONSTRAINED_START_GOGMA_COUNTER, IDEAL_SERIES_SKILL_ID, belowPracticalBonuses } from '../../test/fixtures/constrainedEnumeration'
import {
  blindFixture,
  checkpointFixture,
  compromiseLabelStepIndex,
  confirmCurrent,
  currentPlan,
  dump,
  executionService,
  existingGogmaFixture,
  existingResetFixture,
  expectRefusal,
  finishAsCompromise,
  newNormalFixture,
  planFor,
  seed,
  stepOf,
  withDatabase,
  type ExecutionFixture,
} from '../../test/fixtures/executionRuntime'
import {
  orchestrationEntry,
  orchestrationScenario,
  orchestrationSource,
  orchestrationTarget,
} from '../../test/fixtures/plannerConstrainedOrchestration'

/**
 * The Plan start effect over the real Dexie database and Plans from the real
 * Planner (`docs/PLANNER_SPEC.md` 16.2 / 16.11): Draft generation and display
 * change nothing, the start applies `draft -> active` and the existing-weapon
 * Target links in one transaction, and the first Step then runs as planned.
 */

async function seeded(database: AppDatabase, fixture: ExecutionFixture) {
  await seed(database, fixture)
  return executionService(database, fixture.built)
}

function target(values: readonly TargetWeapon[], id: string): TargetWeapon {
  return values.find((value) => value.id === id) as TargetWeapon
}

describe('Plan start effect', () => {
  it('moves an existing weapon from Target A to Target B only when the Plan starts', () =>
    withDatabase(async (database) => {
      // Target `other` (A) prefers the weapon the Plan uses for Target `goal` (B).
      const fixture = await existingGogmaFixture()
      const source = fixture.built.input.ownedWeapons[0]
      const [goal, other] = fixture.built.input.targetWeapons
      expect(goal.preferredOwnedWeaponId).toBeNull()
      expect(other.preferredOwnedWeaponId).toBe(source.id)
      const service = await seeded(database, fixture)
      const before = await dump(database)

      // Inspecting the draft is read-only and names exactly the change.
      const inspection = await service.inspectProductionPlanStart(fixture.plan.id)
      expect(inspection.changes).toEqual([{
        buildListEntryId: fixture.built.input.buildListEntries[0].id,
        ownedWeaponId: source.id,
        targetWeaponId: goal.id,
        fromTargetWeaponId: other.id,
        replacedOwnedWeaponId: null,
      }])
      expect(inspection.ownedWeapons.map(({ id }) => id)).toEqual([source.id])
      expect(inspection.targetWeapons.map(({ id }) => id).sort()).toEqual([goal.id, other.id].sort())
      expect(await dump(database)).toEqual(before)

      const started = await service.startProductionPlan(fixture.plan.id)

      const after = await dump(database)
      expect(started.status).toBe('active')
      expect(after.productionPlans).toEqual([started])
      expect(target(after.targetWeapons, goal.id)).toEqual({ ...goal, preferredOwnedWeaponId: source.id, updatedAt: started.updatedAt })
      expect(target(after.targetWeapons, other.id)).toEqual({ ...other, preferredOwnedWeaponId: null, updatedAt: started.updatedAt })
      // Nothing else: no Counter, no weapon, no record, no save point.
      expect({ ...after, productionPlans: [], targetWeapons: [] }).toEqual({ ...before, productionPlans: [], targetWeapons: [] })
      // After the start there is nothing left to preview.
      expect((await service.inspectProductionPlanStart(fixture.plan.id)).changes).toEqual([])

      // The first Step runs from the started state without a mismatch.
      const first = await confirmCurrent(service, database, fixture.plan)
      expect(first.plan.currentStepId).toBe(stepOf(fixture.plan, 1).id)
    }))

  it('links a weapon no Target preferred from none to the Plan Target', () =>
    withDatabase(async (database) => {
      const fixture = await existingResetFixture()
      const source = fixture.built.input.ownedWeapons[0]
      const [goal] = fixture.built.input.targetWeapons
      const service = await seeded(database, fixture)

      expect((await service.inspectProductionPlanStart(fixture.plan.id)).changes).toEqual([
        expect.objectContaining({ ownedWeaponId: source.id, targetWeaponId: goal.id, fromTargetWeaponId: null }),
      ])
      await service.startProductionPlan(fixture.plan.id)
      expect(await database.targetWeapons.get(goal.id)).toMatchObject({ preferredOwnedWeaponId: source.id })
      await confirmCurrent(service, database, fixture.plan)
    }))

  it('neither previews nor rewrites a link that already holds', () =>
    withDatabase(async (database) => {
      // The existing Reset fixture, with its Target already preferring the source.
      const source = orchestrationSource('owned.start.linked', { seriesSkillId: IDEAL_SERIES_SKILL_ID })
      const goal = orchestrationTarget('target.start.linked', { preferredOwnedWeaponId: source.id })
      const entry = orchestrationEntry('entry.start.linked', goal, {
        kind: 'existing_gogma_reset_bonuses',
        sourceOwnedWeaponId: source.id,
        operations: [{ type: 'reset_bonuses', sourceOwnedWeaponId: source.id, gogmaCounterBefore: CONSTRAINED_START_GOGMA_COUNTER, gogmaCounterAfter: CONSTRAINED_START_GOGMA_COUNTER + 1 }],
      })
      const fixture = await planFor(orchestrationScenario({ targets: [goal], entries: [entry], ownedWeapons: [source] }))
      // Nothing changes at start, so the first Step starts at the premise itself.
      expect(fixture.plan.steps[0].expectedStateBefore).toEqual(fixture.plan.baseSnapshot.initialExecutionState)
      const service = await seeded(database, fixture)

      expect((await service.inspectProductionPlanStart(fixture.plan.id)).changes).toEqual([])
      await service.startProductionPlan(fixture.plan.id)
      // Not rewritten: not even its timestamp moves.
      expect(await database.targetWeapons.get(goal.id)).toEqual(goal)
      await confirmCurrent(service, database, fixture.plan)
    }))

  it('changes nothing when the start is refused', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      const [goal] = fixture.built.input.targetWeapons
      const service = await seeded(database, fixture)
      // A Plan-dependent Target definition changed after the Plan was calculated.
      await database.targetWeapons.put({ ...goal, priority: goal.priority === 1 ? 2 : 1 })

      await expectRefusal(() => service.startProductionPlan(fixture.plan.id), database, 'plan_dependency_changed')
      expect((await currentPlan(database, fixture.plan)).status).toBe('draft')
    }))

  it.each([12, 13, 14])('never starts or executes a calculation schema %i Plan under the current schema 15', (appSchemaVersion) =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      const legacy = structuredClone(fixture.plan)
      legacy.calculationContext.appSchemaVersion = appSchemaVersion
      legacy.baseSnapshot.calculationContext.appSchemaVersion = appSchemaVersion
      await seed(database, { ...fixture, plan: legacy })
      const service = executionService(database, fixture.built)
      expect(fixture.built.input.calculationContext.appSchemaVersion).toBe(15)

      await expectRefusal(() => service.startProductionPlan(legacy.id), database, 'calculation_context_changed')
      expect((await currentPlan(database, legacy)).status).toBe('draft')

      // Even persisted as active, no Step of it is executed.
      await database.productionPlans.put({ ...legacy, status: 'active' })
      await expectRefusal(
        () => service.confirmExpectedPlanStep({ planId: legacy.id, planStepId: legacy.currentStepId as PlanStep['id'] }),
        database,
        'calculation_context_changed',
      )
    }))

  it.each([13, 14])('keeps an active schema %i Plan with ExecutionHistory non-executable and exactly as persisted under schema 15', (appSchemaVersion) =>
    withDatabase(async (database) => {
      // A Plan the user started and advanced under schema 13 (Issue #103 Phase
      // C) or 14 (Issue #129): the version 15 runtime reads it as
      // calculation_context_changed and never rewrites it into schema 15 (no
      // read migration, no status change).
      const fixture = await existingGogmaFixture()
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await service.startProductionPlan(fixture.plan.id)
      await service.recordExecutionSavePoint({ planId: fixture.plan.id })
      await confirmCurrent(service, database, fixture.plan)
      const advanced = await currentPlan(database, fixture.plan)
      expect(advanced.status).toBe('active')
      expect(await database.executionHistory.count()).toBe(1)
      const schema13 = structuredClone(advanced)
      schema13.calculationContext.appSchemaVersion = appSchemaVersion
      schema13.baseSnapshot.calculationContext.appSchemaVersion = appSchemaVersion
      await database.productionPlans.put(schema13)
      expect(fixture.built.input.calculationContext.appSchemaVersion).toBe(15)
      const stepId = schema13.currentStepId as PlanStep['id']

      await expectRefusal(
        () => service.confirmExpectedPlanStep({ planId: schema13.id, planStepId: stepId }),
        database,
        'calculation_context_changed',
      )
      await expectRefusal(
        () => service.recordOperationUncertain({ planId: schema13.id, planStepId: stepId }),
        database,
        'calculation_context_changed',
      )
      await expectRefusal(
        () => service.recordExecutionSavePoint({ planId: schema13.id }),
        database,
        'calculation_context_changed',
      )
      // The exact persisted Plan and its history stay as they were.
      expect(await currentPlan(database, schema13)).toEqual(schema13)
      expect(await database.executionHistory.count()).toBe(1)
    }))

  it('rolls back the Plan status and every link when a write fails', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      const service = await seeded(database, fixture)
      const before = await dump(database)
      // The Plan is written after the Targets.
      database.productionPlans.hook('updating', () => {
        throw new Error('storage failure')
      })

      const failure = await service.startProductionPlan(fixture.plan.id).catch((error: unknown) => error)

      expect(failure).toBeInstanceOf(RepositoryError)
      expect(failure).not.toBeInstanceOf(ExecutionRuntimeError)
      expect(await dump(database)).toEqual(before)
    }))

  it.each([
    ['predicted', () => newNormalFixture(1)],
    ['blind', () => blindFixture()],
  ])('never links a %s production-target Normal before its registration Step', (_, build) =>
    withDatabase(async (database) => {
      const fixture = await build()
      const [goal] = fixture.built.input.targetWeapons
      const service = await seeded(database, fixture)

      expect((await service.inspectProductionPlanStart(fixture.plan.id)).changes).toEqual([])
      await service.startProductionPlan(fixture.plan.id)
      expect(await database.targetWeapons.get(goal.id)).toEqual(goal)

      const registration = stepOf(fixture.plan, 0)
      expect(registration.executionEffects?.normalCreationRole).toBe('production_target')
      expect(registration.executionEffects?.targetLinks).toEqual([{ buildListEntryId: registration.buildListEntryId, targetWeaponId: goal.id }])
      const tracked = registration.executionEffects?.trackedOwnedWeaponId as OwnedWeaponId
      // A blind Normal is registered with the user's observed five slots.
      const observation = registration.executionEffects?.observationBinding === null ? null : belowPracticalBonuses()
      await confirmCurrent(service, database, fixture.plan, observation)
      expect(await database.ownedWeapons.get(tracked)).toBeDefined()
      expect(await database.targetWeapons.get(goal.id)).toMatchObject({ preferredOwnedWeaponId: tracked })
    }))

  it('keeps the start link through a compromise finish', () =>
    withDatabase(async (database) => {
      const fixture = await checkpointFixture()
      const service = await seeded(database, fixture)
      await service.startProductionPlan(fixture.plan.id)
      expect(await database.targetWeapons.get(fixture.goal.id)).toMatchObject({ preferredOwnedWeaponId: fixture.source.id })
      for (let index = 0; index <= compromiseLabelStepIndex(fixture.plan); index += 1) {
        await confirmCurrent(service, database, fixture.plan)
      }

      const { plan } = await finishAsCompromise(service, database, fixture)

      expect(plan).toMatchObject({ status: 'abandoned', abandonmentReason: 'finished_as_compromise' })
      expect(await database.targetWeapons.get(fixture.goal.id)).toMatchObject({
        lifecycleStatus: 'active',
        preferredOwnedWeaponId: fixture.source.id,
      })
      expect(await database.ownedWeapons.get(fixture.source.id)).toMatchObject({ status: 'practical', executionInProgress: null })
    }))

  it('clears the start link when the Ideal completes', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      const source = fixture.built.input.ownedWeapons[0]
      const [goal, other] = fixture.built.input.targetWeapons
      const service = await seeded(database, fixture)
      await service.startProductionPlan(fixture.plan.id)

      while ((await currentPlan(database, fixture.plan)).status === 'active') {
        const stored = await currentPlan(database, fixture.plan)
        await service.confirmExpectedPlanStep({ planId: stored.id, planStepId: stored.currentStepId as PlanStep['id'] })
      }

      expect((await currentPlan(database, fixture.plan)).status).toBe('completed')
      expect(await database.targetWeapons.get(goal.id)).toMatchObject({ lifecycleStatus: 'completed', preferredOwnedWeaponId: null })
      expect(await database.targetWeapons.get(other.id)).toMatchObject({ preferredOwnedWeaponId: null })
      expect(await database.ownedWeapons.get(source.id)).toMatchObject({ status: 'ideal', isProtected: true, executionInProgress: null })
    }))
})
