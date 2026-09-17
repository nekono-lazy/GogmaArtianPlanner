import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { AppDatabase } from '../../db/AppDatabase'
import { RepositoryError } from '../../db/repositoryError'
import { ExecutionRuntimeError } from '../../domain/execution'
import type {
  BuildListEntry,
  BuildRoute,
  ExecutionHistory,
  ExecutionHistoryId,
  ExecutionSavePoint,
  OwnedWeapon,
  OwnedWeaponId,
  PlanStep,
  ProductionPlan,
  RestorationBonusSet,
  TargetWeapon,
} from '../../domain/models/publicTypes'
import {
  executionSavePointIdForPlan,
  validateExecutionHistory,
  validateProductionPlan,
} from '../../domain/models/publicTypes'
import { createProductionPlan } from '../../domain/planner/productionPlanGeneration'
import {
  CONSTRAINED_START_GOGMA_COUNTER,
  CONSTRAINED_START_NORMAL_COUNTER,
  CONSTRAINED_START_SKILL_COUNTER,
  IDEAL_SERIES_SKILL_ID,
  belowPracticalBonuses,
  idealBonuses,
  normalWeapon,
  practicalBonuses,
} from '../../test/fixtures/constrainedEnumeration'
import {
  checkpointBonusEntry,
  checkpointBonusResultAt,
  orchestrationEntry,
  orchestrationNormalCounters,
  orchestrationScenario,
  orchestrationSource,
  orchestrationTarget,
  type OrchestrationScenario,
} from '../../test/fixtures/plannerConstrainedOrchestration'
import { ownedWeaponId } from '../../test/fixtures/domainData'
import {
  ProductionPlanExecutionService,
  type ProductionPlanExecutionServiceDependencies,
} from './productionPlanExecutionService'

const WEAPON_TYPE = 'weapon.fixture.a'

let databaseSequence = 0

async function withDatabase(test: (database: AppDatabase) => Promise<void>): Promise<void> {
  databaseSequence += 1
  const name = `execution-runtime-${databaseSequence}-${crypto.randomUUID()}`
  const database = new AppDatabase(name)
  await database.open()
  try {
    await test(database)
  } finally {
    database.close()
    await Dexie.delete(name)
  }
}

interface ExecutionFixture {
  built: OrchestrationScenario
  plan: ProductionPlan
}

async function planFor(built: OrchestrationScenario): Promise<ExecutionFixture> {
  const result = await createProductionPlan(built.input, built.dependencies)
  expect(result.termination.status).toBe('completed')
  expect(result.plan).not.toBeNull()
  const plan = result.plan as ProductionPlan
  expect(validateProductionPlan(plan).issues).toEqual([])
  return { built, plan }
}

/** Persists exactly the state the Plan was calculated from, plus the draft Plan. */
async function seed(database: AppDatabase, { built, plan }: ExecutionFixture): Promise<void> {
  await database.rngState.put(structuredClone(built.input.rngState))
  await database.normalArtianCounters.bulkPut(structuredClone(built.input.normalCounters))
  await database.ownedWeapons.bulkPut(structuredClone(built.input.ownedWeapons))
  await database.targetWeapons.bulkPut(structuredClone(built.input.targetWeapons))
  await database.buildListEntries.bulkPut(structuredClone(built.input.buildListEntries))
  await database.productionPlans.put(structuredClone(plan))
}

function executionService(
  database: AppDatabase,
  built: OrchestrationScenario,
  overrides: Partial<ProductionPlanExecutionServiceDependencies> = {},
): ProductionPlanExecutionService {
  let historyCount = 0
  let clockCount = 0
  return new ProductionPlanExecutionService({
    database,
    currentCalculationContext: structuredClone(built.input.calculationContext),
    counterAuthority: built.engine,
    validateObservedWeapon: () => [],
    idFactory: { executionHistoryId: () => `history.execution.${++historyCount}` as ExecutionHistoryId },
    clock: { now: () => `2026-09-17T00:00:${String(++clockCount).padStart(2, '0')}.000Z` },
    ...overrides,
  })
}

interface PersistedDump {
  rngState: unknown
  normalCounters: unknown
  ownedWeapons: OwnedWeapon[]
  targetWeapons: TargetWeapon[]
  buildListEntries: BuildListEntry[]
  productionPlans: ProductionPlan[]
  executionHistory: ExecutionHistory[]
  executionSavePoints: ExecutionSavePoint[]
}

async function dump(database: AppDatabase): Promise<PersistedDump> {
  const byId = <T extends { id: string }>(values: T[]) => values.sort((a, b) => a.id.localeCompare(b.id))
  return {
    rngState: await database.rngState.toArray(),
    normalCounters: byId(await database.normalArtianCounters.toArray()),
    ownedWeapons: byId(await database.ownedWeapons.toArray()),
    targetWeapons: byId(await database.targetWeapons.toArray()),
    buildListEntries: byId(await database.buildListEntries.toArray()),
    productionPlans: byId(await database.productionPlans.toArray()),
    executionHistory: byId(await database.executionHistory.toArray()),
    executionSavePoints: byId(await database.executionSavePoints.toArray()),
  }
}

/** Runs the operation only after the before-state was read, so nothing races it. */
async function expectRefusal(
  run: () => Promise<unknown>,
  database: AppDatabase,
  code: string,
): Promise<void> {
  const before = await dump(database)
  await expect(run()).rejects.toMatchObject({ code })
  expect(await dump(database)).toEqual(before)
}

async function currentPlan(database: AppDatabase, plan: ProductionPlan): Promise<ProductionPlan> {
  return (await database.productionPlans.get(plan.id)) as ProductionPlan
}

async function confirmCurrent(
  service: ProductionPlanExecutionService,
  database: AppDatabase,
  plan: ProductionPlan,
  observation: RestorationBonusSet | null = null,
) {
  const stored = await currentPlan(database, plan)
  return service.confirmExpectedPlanStep({
    planId: plan.id,
    planStepId: stored.currentStepId as PlanStep['id'],
    observation: observation === null ? null : { kind: 'normal_restoration_bonuses', restorationBonuses: observation },
  })
}

function newNormalRoute(count: number): BuildRoute {
  return {
    kind: 'normal_artian_to_gogma',
    sourceOwnedWeaponId: null,
    operations: [
      { type: 'create_normal_artian', weaponTypeId: WEAPON_TYPE, rarity: 8, count, normalCounterBefore: CONSTRAINED_START_NORMAL_COUNTER, normalCounterAfter: CONSTRAINED_START_NORMAL_COUNTER + count },
      { type: 'convert_normal_to_gogma', weaponTypeId: WEAPON_TYPE, skillCounterBefore: CONSTRAINED_START_SKILL_COUNTER, skillCounterAfter: CONSTRAINED_START_SKILL_COUNTER + 1 },
      { type: 'reset_bonuses', sourceOwnedWeaponId: null, gogmaCounterBefore: CONSTRAINED_START_GOGMA_COUNTER, gogmaCounterAfter: CONSTRAINED_START_GOGMA_COUNTER + 1 },
    ],
  }
}

function newNormalFixture(count = 3, extraTargets: TargetWeapon[] = []) {
  const goal = orchestrationTarget('target.execution.new-normal')
  const entry = orchestrationEntry('entry.execution.new-normal', goal, newNormalRoute(count))
  return planFor(orchestrationScenario({
    targets: [goal, ...extraTargets],
    entries: [entry],
    normalCounters: orchestrationNormalCounters(),
  }))
}

function blindFixture() {
  const goal = orchestrationTarget('target.execution.blind')
  const entry = orchestrationEntry('entry.execution.blind', goal, {
    kind: 'normal_artian_to_gogma',
    sourceOwnedWeaponId: null,
    operations: [
      { type: 'create_normal_artian', weaponTypeId: WEAPON_TYPE, rarity: 8, count: 1, normalCounterBefore: null, normalCounterAfter: null },
      { type: 'convert_normal_to_gogma', weaponTypeId: WEAPON_TYPE, skillCounterBefore: CONSTRAINED_START_SKILL_COUNTER, skillCounterAfter: CONSTRAINED_START_SKILL_COUNTER + 1 },
      { type: 'reset_bonuses', sourceOwnedWeaponId: null, gogmaCounterBefore: CONSTRAINED_START_GOGMA_COUNTER, gogmaCounterAfter: CONSTRAINED_START_GOGMA_COUNTER + 1 },
    ],
  })
  return planFor(orchestrationScenario({ targets: [goal], entries: [entry] }))
}

function existingGogmaFixture(extraOwnedWeapons: OwnedWeapon[] = []) {
  const source = orchestrationSource('owned.execution.gogma')
  const goal = orchestrationTarget('target.execution.gogma')
  // A Plan-independent Target prefers the weapon the Route starts from.
  const other = orchestrationTarget('target.execution.other', { preferredOwnedWeaponId: source.id })
  const entry = orchestrationEntry('entry.execution.gogma', goal, {
    kind: 'existing_gogma_mixed',
    sourceOwnedWeaponId: source.id,
    operations: [
      { type: 'reset_bonuses', sourceOwnedWeaponId: source.id, gogmaCounterBefore: CONSTRAINED_START_GOGMA_COUNTER, gogmaCounterAfter: CONSTRAINED_START_GOGMA_COUNTER + 1 },
      { type: 'reset_skills', sourceOwnedWeaponId: source.id, skillCounterBefore: CONSTRAINED_START_SKILL_COUNTER, skillCounterAfter: CONSTRAINED_START_SKILL_COUNTER + 1 },
    ],
  })
  return planFor(orchestrationScenario({ targets: [goal, other], entries: [entry], ownedWeapons: [source, ...extraOwnedWeapons] }))
}

function stepOf(plan: ProductionPlan, index: number): PlanStep {
  return plan.steps[index]
}

describe('Plan start', () => {
  it('moves a draft Plan to active and changes nothing else', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture()
      await seed(database, fixture)
      const before = await dump(database)
      const service = executionService(database, fixture.built)

      const started = await service.startProductionPlan(fixture.plan.id)

      expect(started).toEqual({ ...fixture.plan, status: 'active', updatedAt: '2026-09-17T00:00:01.000Z' })
      const after = await dump(database)
      expect(after.productionPlans).toEqual([started])
      expect({ ...after, productionPlans: [] }).toEqual({ ...before, productionPlans: [] })
      expect(after.executionHistory).toEqual([])
    }))

  it.each(['active', 'stale'] as const)('refuses to start while another Plan is %s', (status) =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture()
      await seed(database, fixture)
      await database.productionPlans.put({
        ...structuredClone(fixture.plan),
        id: 'plan.execution.running' as ProductionPlan['id'],
        status,
      })
      await expectRefusal(
        () => executionService(database, fixture.built).startProductionPlan(fixture.plan.id),
        database,
        'running_plan_conflict',
      )
    }))

  it('refuses a state that differs from the first Step expectedStateBefore', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture()
      await seed(database, fixture)
      const rng = structuredClone(fixture.built.input.rngState)
      rng.gogmaCounter.value = CONSTRAINED_START_GOGMA_COUNTER + 5
      await database.rngState.put(rng)
      await expectRefusal(
        () => executionService(database, fixture.built).startProductionPlan(fixture.plan.id),
        database,
        'execution_state_mismatch',
      )
    }))

  it('refuses a changed Plan-dependent Target or BuildListEntry but ignores an added Target', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture()
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      const goal = fixture.built.input.targetWeapons[0]
      await database.targetWeapons.put({ ...goal, priority: goal.priority === 5 ? 1 : 5 })
      await expectRefusal(() => service.startProductionPlan(fixture.plan.id), database, 'plan_dependency_changed')
      await database.targetWeapons.put(goal)

      const entry = fixture.built.input.buildListEntries[0]
      await database.buildListEntries.put({
        ...entry,
        intermediateStateSelection: { skillOpportunityId: null, bonusOpportunityId: null, improvementPreference: 'skill_first' },
      })
      await expectRefusal(() => service.startProductionPlan(fixture.plan.id), database, 'plan_dependency_changed')
      await database.buildListEntries.put(entry)

      await database.targetWeapons.put(orchestrationTarget('target.execution.added'))
      expect((await service.startProductionPlan(fixture.plan.id)).status).toBe('active')
    }))

  it('refuses a Plan that is not a draft', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture()
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await service.startProductionPlan(fixture.plan.id)
      await expectRefusal(() => service.startProductionPlan(fixture.plan.id), database, 'plan_not_startable')
    }))
})

describe('confirmed_expected Step confirmation', () => {
  it('refuses a draft Plan and a Step that is not current', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture()
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await expectRefusal(
        () => service.confirmExpectedPlanStep({ planId: fixture.plan.id, planStepId: stepOf(fixture.plan, 0).id }),
        database,
        'plan_not_active',
      )
      await service.startProductionPlan(fixture.plan.id)
      await expectRefusal(
        () => service.confirmExpectedPlanStep({ planId: fixture.plan.id, planStepId: stepOf(fixture.plan, 1).id }),
        database,
        'step_not_current',
      )
    }))

  it('advances only the Normal Counter for a Counter-advance Normal and persists nothing of later Steps', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(3)
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await service.startProductionPlan(fixture.plan.id)
      const before = await dump(database)
      const activePlan = await currentPlan(database, fixture.plan)

      const { plan, history } = await confirmCurrent(service, database, fixture.plan)

      const after = await dump(database)
      const [counter] = after.normalCounters as { counter: number }[]
      expect(counter.counter).toBe(CONSTRAINED_START_NORMAL_COUNTER + 1)
      expect(after.rngState).toEqual(before.rngState)
      expect(after.ownedWeapons).toEqual(before.ownedWeapons)
      expect(after.targetWeapons).toEqual(before.targetWeapons)
      expect(after.executionHistory).toEqual([history])
      expect(plan.status).toBe('active')
      expect(plan.currentStepId).toBe(stepOf(fixture.plan, 1).id)
      expect(plan.steps[0]).toMatchObject({ isCompleted: true, completedAt: history.createdAt })
      expect(plan.steps.slice(1).every(({ isCompleted }) => !isCompleted)).toBe(true)
      expect(history).toMatchObject({
        planId: fixture.plan.id,
        planStepId: stepOf(fixture.plan, 0).id,
        action: 'confirmed_expected',
        actualResult: null,
        wasExpected: true,
        recalculationReason: null,
      })
      expect(history.undoSnapshot).toEqual({
        rngStateBefore: (before.rngState as unknown[])[0],
        normalCountersBefore: before.normalCounters,
        affectedOwnedWeaponsBefore: [],
        addedOwnedWeaponIds: [],
        removedOwnedWeaponsBefore: [],
        affectedTargetWeaponsBefore: [],
        productionPlanBefore: activePlan,
        executionSavePointBefore: null,
      })
      expect(validateExecutionHistory(history).issues).toEqual([])
    }))

  it('runs a new Normal Route to completion Step by Step across service instances', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(3)
      await seed(database, fixture)
      await executionService(database, fixture.built).startProductionPlan(fixture.plan.id)
      const goal = fixture.built.input.targetWeapons[0]
      const tracked = stepOf(fixture.plan, 2).executionEffects?.trackedOwnedWeaponId as OwnedWeaponId

      // Each confirmation uses a fresh service, as after a browser reload: the
      // persisted currentStepId alone is where execution resumes.
      const confirm = async () => confirmCurrent(executionService(database, fixture.built, {
        idFactory: { executionHistoryId: () => `history.${crypto.randomUUID()}` as ExecutionHistoryId },
        clock: { now: () => '2026-09-17T01:00:00.000Z' },
      }), database, fixture.plan)
      await confirm()
      await confirm()
      expect(await database.ownedWeapons.count()).toBe(0)

      // Production target: registered under the reserved ID with the predicted slots.
      const registration = await confirm()
      const normal = await database.ownedWeapons.get(tracked)
      expect(normal).toMatchObject({
        id: tracked,
        kind: 'normal',
        name: goal.name,
        rarity: 8,
        restorationBonuses: practicalBonuses(),
        restorationBonusScope: 'normal_artian',
        status: null,
        isProtected: false,
        executionInProgress: { productionPlanId: fixture.plan.id, startedAt: '2026-09-17T01:00:00.000Z' },
      })
      expect((await database.normalArtianCounters.toArray())[0].counter).toBe(CONSTRAINED_START_NORMAL_COUNTER + 3)
      expect((await database.targetWeapons.get(goal.id))?.preferredOwnedWeaponId).toBe(tracked)
      expect(registration.history.undoSnapshot.addedOwnedWeaponIds).toEqual([tracked])
      expect(registration.history.undoSnapshot.affectedOwnedWeaponsBefore).toEqual([])
      expect(registration.history.undoSnapshot.affectedTargetWeaponsBefore).toEqual([goal])

      // Conversion keeps the ID, the five slots and the start time.
      const conversion = await confirm()
      const converted = await database.ownedWeapons.get(tracked)
      expect(converted).toMatchObject({
        id: tracked,
        kind: 'gogma',
        status: 'unclassified',
        restorationBonuses: practicalBonuses(),
        restorationBonusScope: 'normal_artian',
        seriesSkillId: stepOf(fixture.plan, 3).expectedResult?.seriesSkillId,
        executionInProgress: { productionPlanId: fixture.plan.id, startedAt: '2026-09-17T01:00:00.000Z' },
        createdAt: normal?.createdAt,
      })
      expect(converted).not.toHaveProperty('rarity')
      expect(await database.ownedWeapons.count()).toBe(1)
      expect(conversion.history.undoSnapshot.affectedOwnedWeaponsBefore).toEqual([normal])
      expect((await database.rngState.get('current'))?.skillCounter.value).toBe(CONSTRAINED_START_SKILL_COUNTER + 1)

      // The last physical Step completes the Target and the Plan.
      const completion = await confirm()
      expect(await database.ownedWeapons.get(tracked)).toMatchObject({
        status: 'ideal',
        isProtected: true,
        executionInProgress: null,
        restorationBonuses: idealBonuses(),
        restorationBonusScope: 'gogma_artian',
      })
      expect(await database.targetWeapons.get(goal.id)).toMatchObject({
        lifecycleStatus: 'completed',
        completedAt: '2026-09-17T01:00:00.000Z',
        completedByProductionPlanId: fixture.plan.id,
        preferredOwnedWeaponId: null,
        priority: goal.priority,
        isEnabled: goal.isEnabled,
      })
      expect(completion.plan).toMatchObject({
        status: 'completed',
        currentStepId: null,
        completedAt: '2026-09-17T01:00:00.000Z',
        abandonmentReason: null,
        abandonedAt: null,
      })
      expect(completion.plan.steps.every(({ isCompleted }) => isCompleted)).toBe(true)
      expect((await database.rngState.get('current'))?.gogmaCounter.value).toBe(CONSTRAINED_START_GOGMA_COUNTER + 1)
      expect(await database.executionHistory.count()).toBe(5)
      await expectRefusal(() => confirm(), database, 'plan_not_active')
    }))

  it('requires and records the observed five slots of a blind production-target Normal', () =>
    withDatabase(async (database) => {
      const fixture = await blindFixture()
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await service.startProductionPlan(fixture.plan.id)
      const tracked = stepOf(fixture.plan, 0).executionEffects?.trackedOwnedWeaponId as OwnedWeaponId
      const observed = belowPracticalBonuses()

      await expectRefusal(() => confirmCurrent(service, database, fixture.plan), database, 'observation_required')
      await expectRefusal(
        () => confirmCurrent(service, database, fixture.plan, observed.slice(0, 4) as unknown as RestorationBonusSet),
        database,
        'observation_invalid',
      )
      const rejecting = executionService(database, fixture.built, { validateObservedWeapon: () => ['not available'] })
      await expectRefusal(() => confirmCurrent(rejecting, database, fixture.plan, observed), database, 'observation_invalid')

      const registration = await confirmCurrent(service, database, fixture.plan, observed)
      // Observed, never fabricated or predicted.
      expect(await database.ownedWeapons.get(tracked)).toMatchObject({ restorationBonuses: observed, restorationBonusScope: 'normal_artian' })
      expect(registration.history.actualResult).toEqual({
        restorationBonuses: observed,
        restorationBonusScope: 'normal_artian',
        seriesSkillId: null,
        groupSkillId: null,
        securedOwnedWeaponId: null,
        note: null,
      })
      expect(registration.history.wasExpected).toBe(true)
      // The blind forge advances no Normal Counter record it does not have.
      expect(await database.normalArtianCounters.count()).toBe(0)

      await expectRefusal(() => confirmCurrent(service, database, fixture.plan, observed), database, 'observation_not_expected')
      // The binding token resolves the recorded observation on the next Steps.
      await confirmCurrent(service, database, fixture.plan)
      expect(await database.ownedWeapons.get(tracked)).toMatchObject({ kind: 'gogma', restorationBonuses: observed })
      const completion = await confirmCurrent(service, database, fixture.plan)
      expect(completion.plan.status).toBe('completed')
      expect(await database.ownedWeapons.get(tracked)).toMatchObject({ restorationBonuses: idealBonuses(), status: 'ideal', isProtected: true })
    }))

  it('detects an unplanned edit of an observed blind Normal as a state mismatch', () =>
    withDatabase(async (database) => {
      const fixture = await blindFixture()
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await service.startProductionPlan(fixture.plan.id)
      const tracked = stepOf(fixture.plan, 0).executionEffects?.trackedOwnedWeaponId as OwnedWeaponId
      await confirmCurrent(service, database, fixture.plan, belowPracticalBonuses())
      const weapon = (await database.ownedWeapons.get(tracked)) as OwnedWeapon
      await database.ownedWeapons.put({ ...weapon, restorationBonuses: practicalBonuses() })
      await expectRefusal(() => confirmCurrent(service, database, fixture.plan), database, 'execution_state_mismatch')
    }))

  it('converts an owned Normal under its own OwnedWeapon ID', () =>
    withDatabase(async (database) => {
      const source = normalWeapon('owned.execution.normal')
      const goal = orchestrationTarget('target.execution.owned-normal')
      const entry = orchestrationEntry('entry.execution.owned-normal', goal, {
        kind: 'owned_normal_artian_to_gogma',
        sourceOwnedWeaponId: source.id,
        operations: [
          { type: 'convert_normal_to_gogma', weaponTypeId: WEAPON_TYPE, skillCounterBefore: CONSTRAINED_START_SKILL_COUNTER, skillCounterAfter: CONSTRAINED_START_SKILL_COUNTER + 1 },
          { type: 'reset_bonuses', sourceOwnedWeaponId: null, gogmaCounterBefore: CONSTRAINED_START_GOGMA_COUNTER, gogmaCounterAfter: CONSTRAINED_START_GOGMA_COUNTER + 1 },
        ],
      })
      const fixture = await planFor(orchestrationScenario({ targets: [goal], entries: [entry], ownedWeapons: [source] }))
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await service.startProductionPlan(fixture.plan.id)

      const conversion = await confirmCurrent(service, database, fixture.plan)
      expect(await database.ownedWeapons.toArray()).toEqual([
        expect.objectContaining({
          id: source.id,
          kind: 'gogma',
          status: 'unclassified',
          createdAt: source.createdAt,
          executionInProgress: { productionPlanId: fixture.plan.id, startedAt: conversion.history.createdAt },
        }),
      ])
      expect(conversion.history.undoSnapshot).toMatchObject({
        affectedOwnedWeaponsBefore: [source],
        addedOwnedWeaponIds: [],
        removedOwnedWeaponsBefore: [],
        affectedTargetWeaponsBefore: [goal],
      })
      expect((await database.targetWeapons.get(goal.id))?.preferredOwnedWeaponId).toBe(source.id)
    }))

  it('links an existing Gogma to its Target, releases another Target, and protects it at completion', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      await seed(database, fixture)
      const source = fixture.built.input.ownedWeapons[0]
      const [goal, other] = fixture.built.input.targetWeapons
      const service = executionService(database, fixture.built)
      await service.startProductionPlan(fixture.plan.id)

      const first = await confirmCurrent(service, database, fixture.plan)
      expect(await database.targetWeapons.get(goal.id)).toMatchObject({ preferredOwnedWeaponId: source.id, lifecycleStatus: 'active' })
      expect(await database.targetWeapons.get(other.id)).toMatchObject({ preferredOwnedWeaponId: null, priority: other.priority, lifecycleStatus: 'active' })
      expect(await database.ownedWeapons.get(source.id)).toMatchObject({
        executionInProgress: { productionPlanId: fixture.plan.id, startedAt: first.history.createdAt },
        isProtected: false,
      })
      expect(first.history.undoSnapshot.affectedTargetWeaponsBefore).toEqual([goal, other])
      expect(first.history.undoSnapshot.affectedOwnedWeaponsBefore).toEqual([source])

      const second = await confirmCurrent(service, database, fixture.plan)
      // The start time is not moved by a later Step of the same Plan.
      expect(second.history.undoSnapshot.affectedOwnedWeaponsBefore[0].executionInProgress?.startedAt).toBe(first.history.createdAt)
      expect(await database.ownedWeapons.get(source.id)).toMatchObject({ status: 'ideal', isProtected: true, executionInProgress: null })
      expect(await database.targetWeapons.get(goal.id)).toMatchObject({ lifecycleStatus: 'completed', preferredOwnedWeaponId: null })
      expect(second.plan.status).toBe('completed')
    }))

  it('labels a reached selected checkpoint practical and keeps the Plan running', () =>
    withDatabase(async (database) => {
      const source = orchestrationSource('owned.execution.checkpoint', { seriesSkillId: IDEAL_SERIES_SKILL_ID })
      const goal = orchestrationTarget('target.execution.checkpoint')
      const entry = checkpointBonusEntry('entry.execution.checkpoint', goal, source.id, source)
      const fixture = await planFor(orchestrationScenario({
        targets: [goal],
        entries: [entry],
        ownedWeapons: [source],
        engine: { resetResultAt: checkpointBonusResultAt },
      }))
      const labelled = fixture.plan.steps.findIndex((step) => (step.executionEffects?.compromiseLabels.length ?? 0) > 0)
      expect(labelled).toBeGreaterThanOrEqual(0)
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await service.startProductionPlan(fixture.plan.id)

      for (let index = 0; index < labelled; index += 1) await confirmCurrent(service, database, fixture.plan)
      const reached = await confirmCurrent(service, database, fixture.plan)
      expect(await database.ownedWeapons.get(source.id)).toMatchObject({
        status: 'practical',
        isProtected: false,
        executionInProgress: { productionPlanId: fixture.plan.id },
      })
      expect(reached.plan.status).toBe('active')
      expect(await database.targetWeapons.get(goal.id)).toMatchObject({ lifecycleStatus: 'active', preferredOwnedWeaponId: source.id })

      while ((await currentPlan(database, fixture.plan)).status === 'active') {
        await confirmCurrent(service, database, fixture.plan)
      }
      expect(await database.ownedWeapons.get(source.id)).toMatchObject({ status: 'ideal', isProtected: true, executionInProgress: null })
    }))

  it('confirms an owned Ideal without advancing any Counter', () =>
    withDatabase(async (database) => {
      const source = orchestrationSource('owned.execution.zero', {
        restorationBonuses: idealBonuses(), seriesSkillId: IDEAL_SERIES_SKILL_ID, isProtected: true,
      })
      const goal = orchestrationTarget('target.execution.zero')
      const entry = orchestrationEntry('entry.execution.zero', goal, {
        kind: 'existing_gogma_current', sourceOwnedWeaponId: source.id, operations: [],
      })
      const fixture = await planFor(orchestrationScenario({ targets: [goal], entries: [entry], ownedWeapons: [source] }))
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await service.startProductionPlan(fixture.plan.id)
      const before = await dump(database)

      const { plan, history } = await confirmCurrent(service, database, fixture.plan)

      const after = await dump(database)
      expect(after.rngState).toEqual(before.rngState)
      expect(after.normalCounters).toEqual(before.normalCounters)
      expect(after.ownedWeapons).toEqual([{ ...source, status: 'ideal', isProtected: true, executionInProgress: null, updatedAt: history.createdAt }])
      expect(await database.targetWeapons.get(goal.id)).toMatchObject({ lifecycleStatus: 'completed', completedByProductionPlanId: fixture.plan.id })
      expect(plan.status).toBe('completed')
      expect(after.executionHistory).toEqual([history])
      expect(history.action).toBe('confirmed_expected')
    }))

  it('deletes the save point and clears every in-progress weapon of the Plan on completion', () =>
    withDatabase(async (database) => {
      const unrelated = normalWeapon('owned.execution.unrelated')
      const fixture = await existingGogmaFixture([unrelated])
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await service.startProductionPlan(fixture.plan.id)
      const first = await confirmCurrent(service, database, fixture.plan)

      // Neither the save point nor `executionInProgress` is part of any hash.
      const savePoint: ExecutionSavePoint = {
        id: executionSavePointIdForPlan(fixture.plan.id),
        productionPlanId: fixture.plan.id,
        lastExecutionHistoryId: first.history.id,
        rngState: (await database.rngState.get('current')) as ExecutionSavePoint['rngState'],
        normalCounters: await database.normalArtianCounters.toArray(),
        ownedWeapons: [],
        targetWeapons: [],
        productionPlan: first.plan,
        recordedAt: first.history.createdAt,
      }
      await database.executionSavePoints.put(savePoint)
      const inProgressElsewhere = { ...unrelated, executionInProgress: { productionPlanId: fixture.plan.id, startedAt: first.history.createdAt } }
      await database.ownedWeapons.put(inProgressElsewhere)

      const last = await confirmCurrent(service, database, fixture.plan)
      expect(last.plan.status).toBe('completed')
      expect(await database.executionSavePoints.count()).toBe(0)
      expect(last.history.undoSnapshot.executionSavePointBefore).toEqual(savePoint)
      expect((await database.ownedWeapons.toArray()).filter(({ executionInProgress }) => executionInProgress !== null)).toEqual([])
      expect(last.history.undoSnapshot.affectedOwnedWeaponsBefore).toContainEqual(inProgressElsewhere)
      expect(validateExecutionHistory(last.history).issues).toEqual([])
    }))
})

describe('atomic Step confirmation', () => {
  it('writes nothing when the resulting state differs from expectedStateAfter', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      const last = fixture.plan.steps.at(-1) as PlanStep
      last.expectedStateAfter = { ...last.expectedStateAfter, ownedWeaponsHash: 'hash.tampered' }
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await service.startProductionPlan(fixture.plan.id)
      await confirmCurrent(service, database, fixture.plan)
      await expectRefusal(() => confirmCurrent(service, database, fixture.plan), database, 'expected_state_after_mismatch')
    }))

  it('writes nothing when the Target preference collection becomes invalid', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(1)
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await service.startProductionPlan(fixture.plan.id)
      // A Plan-independent Target is never hashed, so its broken preference only
      // surfaces in the collection validation of the Step transaction.
      await database.targetWeapons.put(orchestrationTarget('target.execution.broken', {
        preferredOwnedWeaponId: ownedWeaponId('owned.execution.missing'),
      }))
      await expectRefusal(() => confirmCurrent(service, database, fixture.plan), database, 'collection_validation_failed')
    }))

  it('writes nothing when the ExecutionHistory fails validation', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(1)
      await seed(database, fixture)
      await executionService(database, fixture.built).startProductionPlan(fixture.plan.id)
      const broken = executionService(database, fixture.built, {
        idFactory: { executionHistoryId: () => '' as ExecutionHistoryId },
      })
      await expectRefusal(() => confirmCurrent(broken, database, fixture.plan), database, 'entity_validation_failed')
    }))

  it('rolls back every earlier write when the last write of the transaction fails', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await service.startProductionPlan(fixture.plan.id)
      await confirmCurrent(service, database, fixture.plan)
      await database.executionSavePoints.put({
        id: executionSavePointIdForPlan(fixture.plan.id),
        productionPlanId: fixture.plan.id,
        lastExecutionHistoryId: null,
        rngState: (await database.rngState.get('current')) as ExecutionSavePoint['rngState'],
        normalCounters: [],
        ownedWeapons: [],
        targetWeapons: [],
        productionPlan: await currentPlan(database, fixture.plan),
        recordedAt: '2026-09-17T00:00:00.000Z',
      })
      // The ExecutionHistory add runs after the RngState, OwnedWeapon, Target,
      // Plan and save point writes of this completing Step.
      database.executionHistory.hook('creating', () => {
        throw new Error('storage failure')
      })
      const before = await dump(database)
      const failure = await confirmCurrent(service, database, fixture.plan).catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(RepositoryError)
      expect(failure).not.toBeInstanceOf(ExecutionRuntimeError)
      expect(failure).toMatchObject({ code: 'transaction_failed' })
      expect(await dump(database)).toEqual(before)
    }))
})
