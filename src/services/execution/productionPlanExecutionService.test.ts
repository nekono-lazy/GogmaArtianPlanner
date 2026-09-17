import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { AppDatabase } from '../../db/AppDatabase'
import { RepositoryError } from '../../db/repositoryError'
import { ExecutionRuntimeError, prepareExecutionUndo, withRecalculationReason } from '../../domain/execution'
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
  compareExecutionHistoryOrder,
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
  alternativePracticalBonuses,
  belowPracticalBonuses,
  idealBonuses,
  normalWeapon,
  practicalBonuses,
  sameLayoutLowerRanks,
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
    validateResultingWeapon: () => [],
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
      const rejecting = executionService(database, fixture.built, { validateResultingWeapon: () => ['not available'] })
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

function differentBonuses(expected: RestorationBonusSet | null | undefined): RestorationBonusSet {
  const candidates = [sameLayoutLowerRanks(), alternativePracticalBonuses(), belowPracticalBonuses()]
  const different = candidates.find((candidate) =>
    expected == null || JSON.stringify(candidate) !== JSON.stringify(expected))
  return different as RestorationBonusSet
}

function bonusResult(restorationBonuses: RestorationBonusSet, restorationBonusScope: 'normal_artian' | 'gogma_artian') {
  return { kind: 'restoration_bonuses' as const, restorationBonuses, restorationBonusScope }
}

const DIFFERENT_SERIES = 'series_skill.fixture.different'
const DIFFERENT_GROUP = 'group_skill.fixture.different'

function existingResetFixture() {
  const source = orchestrationSource('owned.execution.reset', { seriesSkillId: IDEAL_SERIES_SKILL_ID })
  const goal = orchestrationTarget('target.execution.reset')
  const entry = orchestrationEntry('entry.execution.reset', goal, {
    kind: 'existing_gogma_reset_bonuses',
    sourceOwnedWeaponId: source.id,
    operations: [
      { type: 'reset_bonuses', sourceOwnedWeaponId: source.id, gogmaCounterBefore: CONSTRAINED_START_GOGMA_COUNTER, gogmaCounterAfter: CONSTRAINED_START_GOGMA_COUNTER + 1 },
    ],
  })
  return planFor(orchestrationScenario({ targets: [goal], entries: [entry], ownedWeapons: [source] }))
}

function ownedNormalFixture() {
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
  return planFor(orchestrationScenario({ targets: [goal], entries: [entry], ownedWeapons: [source] }))
}

type ActualResultInput = Parameters<ProductionPlanExecutionService['recordActualResultDifferent']>[0]['actualResult']

async function recordDifferent(
  service: ProductionPlanExecutionService,
  database: AppDatabase,
  plan: ProductionPlan,
  actualResult: ActualResultInput,
) {
  const stored = await currentPlan(database, plan)
  return service.recordActualResultDifferent({
    planId: plan.id,
    planStepId: stored.currentStepId as PlanStep['id'],
    actualResult,
  })
}

async function putSavePoint(
  database: AppDatabase,
  plan: ProductionPlan,
  lastExecutionHistoryId: ExecutionHistoryId | null,
  recordedAt: string,
): Promise<ExecutionSavePoint> {
  const savePoint: ExecutionSavePoint = {
    id: executionSavePointIdForPlan(plan.id),
    productionPlanId: plan.id,
    lastExecutionHistoryId,
    rngState: (await database.rngState.get('current')) as ExecutionSavePoint['rngState'],
    normalCounters: await database.normalArtianCounters.toArray(),
    ownedWeapons: [],
    targetWeapons: [],
    productionPlan: await currentPlan(database, plan),
    recordedAt,
  }
  await database.executionSavePoints.put(savePoint)
  return savePoint
}

describe('actual_result_different', () => {
  it('stores a different Reset Bonuses result, consumes the Gogma Counter and stales the Plan without completing anything', () =>
    withDatabase(async (database) => {
      const fixture = await existingResetFixture()
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await service.startProductionPlan(fixture.plan.id)
      const source = fixture.built.input.ownedWeapons[0]
      const goal = fixture.built.input.targetWeapons[0]
      const step = stepOf(fixture.plan, 0)
      expect(step.executionEffects?.targetCompletions).toHaveLength(1)
      const before = await dump(database)
      const activePlan = await currentPlan(database, fixture.plan)
      const actual = differentBonuses(step.expectedResult?.restorationBonuses)

      const { plan, history } = await recordDifferent(service, database, fixture.plan, bonusResult(actual, 'gogma_artian'))

      const after = await dump(database)
      const rng = await database.rngState.get('current')
      expect(rng?.gogmaCounter.value).toBe(CONSTRAINED_START_GOGMA_COUNTER + 1)
      expect(rng?.skillCounter.value).toBe(CONSTRAINED_START_SKILL_COUNTER)
      expect(after.normalCounters).toEqual(before.normalCounters)
      expect(after.ownedWeapons).toEqual([{
        ...source,
        restorationBonuses: actual,
        restorationBonusScope: 'gogma_artian',
        executionInProgress: { productionPlanId: fixture.plan.id, startedAt: history.createdAt },
        updatedAt: history.createdAt,
      }])
      // Neither `ideal` nor protection, and the Target stays active but linked.
      expect(await database.targetWeapons.get(goal.id)).toEqual({ ...goal, preferredOwnedWeaponId: source.id, updatedAt: history.createdAt })
      expect(plan).toEqual({
        ...activePlan,
        steps: [{ ...activePlan.steps[0], isCompleted: true, completedAt: history.createdAt }],
        status: 'stale',
        currentStepId: null,
        completedAt: null,
        abandonmentReason: null,
        abandonedAt: null,
        recalculationReasons: ['unexpected_result'],
        updatedAt: history.createdAt,
      })
      expect(after.productionPlans).toEqual([plan])
      expect(after.executionHistory).toEqual([history])
      expect(history).toMatchObject({
        planId: fixture.plan.id,
        planStepId: step.id,
        action: 'actual_result_different',
        actualResult: {
          restorationBonuses: actual,
          restorationBonusScope: 'gogma_artian',
          seriesSkillId: null,
          groupSkillId: null,
          securedOwnedWeaponId: null,
          note: null,
        },
        wasExpected: false,
        recalculationReason: 'unexpected_result',
      })
      expect(history.undoSnapshot).toEqual({
        rngStateBefore: (before.rngState as unknown[])[0],
        normalCountersBefore: before.normalCounters,
        affectedOwnedWeaponsBefore: [source],
        addedOwnedWeaponIds: [],
        removedOwnedWeaponsBefore: [],
        affectedTargetWeaponsBefore: [goal],
        productionPlanBefore: activePlan,
        executionSavePointBefore: null,
      })
      expect(validateExecutionHistory(history).issues).toEqual([])
      expect(validateProductionPlan(plan).issues).toEqual([])

      // A stale Plan accepts no further Execution record.
      await expectRefusal(
        () => service.confirmExpectedPlanStep({ planId: fixture.plan.id, planStepId: step.id }),
        database,
        'plan_not_active',
      )
    }))

  it('stores the note without reading it', () =>
    withDatabase(async (database) => {
      const fixture = await existingResetFixture()
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await service.startProductionPlan(fixture.plan.id)
      const { history } = await service.recordActualResultDifferent({
        planId: fixture.plan.id,
        planStepId: stepOf(fixture.plan, 0).id,
        actualResult: bonusResult(differentBonuses(stepOf(fixture.plan, 0).expectedResult?.restorationBonuses), 'gogma_artian'),
        note: '2回押したかもしれない',
      })
      expect(history.actualResult?.note).toBe('2回押したかもしれない')
    }))

  it('stores different Reset Skills, keeps the five slots and the ID, and keeps the save point and in-progress state', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await service.startProductionPlan(fixture.plan.id)
      const source = fixture.built.input.ownedWeapons[0]
      const first = await confirmCurrent(service, database, fixture.plan)
      const savePoint = await putSavePoint(database, fixture.plan, first.history.id, first.history.createdAt)
      const beforeRecord = await dump(database)
      const weaponBefore = (await database.ownedWeapons.get(source.id)) as OwnedWeapon
      expect(weaponBefore.executionInProgress).toEqual({ productionPlanId: fixture.plan.id, startedAt: first.history.createdAt })
      const step = stepOf(fixture.plan, 1)
      expect(step.operationType).toBe('reset_skills')
      expect(step.executionEffects?.targetCompletions).toHaveLength(1)

      const { plan, history } = await recordDifferent(service, database, fixture.plan, {
        kind: 'skills', seriesSkillId: DIFFERENT_SERIES, groupSkillId: DIFFERENT_GROUP,
      })

      const rng = await database.rngState.get('current')
      expect(rng?.skillCounter.value).toBe(CONSTRAINED_START_SKILL_COUNTER + 1)
      expect(rng?.gogmaCounter.value).toBe(CONSTRAINED_START_GOGMA_COUNTER + 1)
      // Same ID, same five slots and scope, the start time kept, no completion.
      expect(await database.ownedWeapons.get(source.id)).toEqual({
        ...weaponBefore,
        seriesSkillId: DIFFERENT_SERIES,
        groupSkillId: DIFFERENT_GROUP,
        updatedAt: history.createdAt,
      })
      expect(await database.targetWeapons.toArray()).toEqual(beforeRecord.targetWeapons)
      expect(await database.executionSavePoints.toArray()).toEqual([savePoint])
      expect(plan).toMatchObject({ status: 'stale', currentStepId: null, completedAt: null, recalculationReasons: ['unexpected_result'] })
      expect(history.actualResult).toMatchObject({ restorationBonuses: null, restorationBonusScope: null, seriesSkillId: DIFFERENT_SERIES, groupSkillId: DIFFERENT_GROUP })
      expect(history.undoSnapshot).toMatchObject({
        affectedOwnedWeaponsBefore: [weaponBefore],
        addedOwnedWeaponIds: [],
        affectedTargetWeaponsBefore: [],
        executionSavePointBefore: savePoint,
      })
      expect(validateExecutionHistory(history).issues).toEqual([])
    }))

  it('converts an owned Normal under its own ID with the actual Skills and moves to the next Step', () =>
    withDatabase(async (database) => {
      const fixture = await ownedNormalFixture()
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await service.startProductionPlan(fixture.plan.id)
      const source = fixture.built.input.ownedWeapons[0]
      const goal = fixture.built.input.targetWeapons[0]
      const expectedSkills = stepOf(fixture.plan, 0).expectedResult
      expect(expectedSkills?.seriesSkillId).not.toBe(DIFFERENT_SERIES)

      const { plan, history } = await recordDifferent(service, database, fixture.plan, {
        kind: 'skills', seriesSkillId: DIFFERENT_SERIES, groupSkillId: null,
      })

      const [converted] = await database.ownedWeapons.toArray()
      expect(await database.ownedWeapons.count()).toBe(1)
      expect(converted).toMatchObject({
        id: source.id,
        kind: 'gogma',
        seriesSkillId: DIFFERENT_SERIES,
        groupSkillId: null,
        status: 'unclassified',
        restorationBonuses: source.restorationBonuses,
        restorationBonusScope: 'normal_artian',
        createdAt: source.createdAt,
        executionInProgress: { productionPlanId: fixture.plan.id, startedAt: history.createdAt },
      })
      expect(converted).not.toHaveProperty('rarity')
      const rng = await database.rngState.get('current')
      expect(rng?.skillCounter.value).toBe(CONSTRAINED_START_SKILL_COUNTER + 1)
      expect(rng?.gogmaCounter.value).toBe(CONSTRAINED_START_GOGMA_COUNTER)
      expect((await database.targetWeapons.get(goal.id))?.preferredOwnedWeaponId).toBe(source.id)
      expect(plan).toMatchObject({ status: 'stale', currentStepId: stepOf(fixture.plan, 1).id, completedAt: null })
      expect(plan.steps.map(({ isCompleted }) => isCompleted)).toEqual([true, false])
      expect(history.undoSnapshot).toMatchObject({ affectedOwnedWeaponsBefore: [source], addedOwnedWeaponIds: [], affectedTargetWeaponsBefore: [goal] })
      expect(validateProductionPlan(plan).issues).toEqual([])
    }))

  it('registers a predicted production-target Normal under its reserved ID with the actual slots', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(1)
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await service.startProductionPlan(fixture.plan.id)
      const goal = fixture.built.input.targetWeapons[0]
      const step = stepOf(fixture.plan, 0)
      expect(step.executionEffects?.normalCreationRole).toBe('production_target')
      const tracked = step.executionEffects?.trackedOwnedWeaponId as OwnedWeaponId
      const actual = differentBonuses(step.expectedResult?.restorationBonuses)

      const { plan, history } = await recordDifferent(service, database, fixture.plan, bonusResult(actual, 'normal_artian'))

      expect(await database.ownedWeapons.toArray()).toEqual([expect.objectContaining({
        id: tracked,
        kind: 'normal',
        name: goal.name,
        rarity: 8,
        restorationBonuses: actual,
        restorationBonusScope: 'normal_artian',
        status: null,
        isProtected: false,
        executionInProgress: { productionPlanId: fixture.plan.id, startedAt: history.createdAt },
      })])
      expect((await database.normalArtianCounters.toArray())[0].counter).toBe(CONSTRAINED_START_NORMAL_COUNTER + 1)
      expect((await database.targetWeapons.get(goal.id))?.preferredOwnedWeaponId).toBe(tracked)
      expect(plan).toMatchObject({ status: 'stale', currentStepId: stepOf(fixture.plan, 1).id })
      expect(history.undoSnapshot).toMatchObject({ addedOwnedWeaponIds: [tracked], affectedOwnedWeaponsBefore: [], affectedTargetWeaponsBefore: [goal] })
    }))

  it('advances only the Normal Counter for a Counter-advance Normal and registers nothing', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(3)
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await service.startProductionPlan(fixture.plan.id)
      const step = stepOf(fixture.plan, 0)
      expect(step.executionEffects?.normalCreationRole).toBe('counter_advance')
      const before = await dump(database)
      const actual = differentBonuses(step.expectedResult?.restorationBonuses)

      const { plan, history } = await recordDifferent(service, database, fixture.plan, bonusResult(actual, 'normal_artian'))

      const after = await dump(database)
      expect((after.normalCounters as { counter: number }[])[0].counter).toBe(CONSTRAINED_START_NORMAL_COUNTER + 1)
      expect(after.rngState).toEqual(before.rngState)
      expect(after.ownedWeapons).toEqual([])
      expect(after.targetWeapons).toEqual(before.targetWeapons)
      expect(plan).toMatchObject({ status: 'stale', currentStepId: stepOf(fixture.plan, 1).id })
      expect(history.actualResult).toMatchObject({ restorationBonuses: actual, restorationBonusScope: 'normal_artian' })
      expect(history.undoSnapshot).toMatchObject({
        affectedOwnedWeaponsBefore: [],
        addedOwnedWeaponIds: [],
        affectedTargetWeaponsBefore: [],
        normalCountersBefore: before.normalCounters,
      })
    }))

  it('never labels a reached compromise checkpoint when the result differs', () =>
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
      const step = stepOf(fixture.plan, labelled)

      await recordDifferent(service, database, fixture.plan, bonusResult(differentBonuses(step.expectedResult?.restorationBonuses), 'gogma_artian'))
      expect(await database.ownedWeapons.get(source.id)).toMatchObject({ status: 'unclassified', isProtected: false })
      expect((await currentPlan(database, fixture.plan)).status).toBe('stale')
    }))

  it('refuses a blind production-target Normal, whose observation is confirmed_expected', () =>
    withDatabase(async (database) => {
      const fixture = await blindFixture()
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await service.startProductionPlan(fixture.plan.id)
      await expectRefusal(
        () => recordDifferent(service, database, fixture.plan, bonusResult(belowPracticalBonuses(), 'normal_artian')),
        database,
        'actual_result_not_applicable',
      )
      expect((await confirmCurrent(service, database, fixture.plan, belowPracticalBonuses())).history.action).toBe('confirmed_expected')
    }))

  it('refuses a result equal to the expected result', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await service.startProductionPlan(fixture.plan.id)
      const bonusStep = stepOf(fixture.plan, 0)
      await expectRefusal(
        () => recordDifferent(service, database, fixture.plan, bonusResult(bonusStep.expectedResult?.restorationBonuses as RestorationBonusSet, 'gogma_artian')),
        database,
        'actual_result_matches_expected',
      )
      await confirmCurrent(service, database, fixture.plan)
      const skillStep = stepOf(fixture.plan, 1)
      await expectRefusal(
        () => recordDifferent(service, database, fixture.plan, {
          kind: 'skills',
          seriesSkillId: skillStep.expectedResult?.seriesSkillId ?? null,
          groupSkillId: skillStep.expectedResult?.groupSkillId ?? null,
        }),
        database,
        'actual_result_matches_expected',
      )
    }))

  it('refuses an owned Ideal confirmation, which has no game result', () =>
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
      await expectRefusal(
        () => recordDifferent(service, database, fixture.plan, bonusResult(belowPracticalBonuses(), 'gogma_artian')),
        database,
        'actual_result_not_applicable',
      )
    }))

  it('refuses a result of the wrong kind or scope, and an invalid or Master-unavailable result', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await service.startProductionPlan(fixture.plan.id)
      const expected = stepOf(fixture.plan, 0).expectedResult?.restorationBonuses
      await expectRefusal(
        () => recordDifferent(service, database, fixture.plan, { kind: 'skills', seriesSkillId: DIFFERENT_SERIES, groupSkillId: null }),
        database,
        'actual_result_invalid',
      )
      await expectRefusal(
        () => recordDifferent(service, database, fixture.plan, bonusResult(differentBonuses(expected), 'normal_artian')),
        database,
        'actual_result_invalid',
      )
      await expectRefusal(
        () => recordDifferent(service, database, fixture.plan, bonusResult(differentBonuses(expected).slice(0, 4) as unknown as RestorationBonusSet, 'gogma_artian')),
        database,
        'actual_result_invalid',
      )
      const unavailable = executionService(database, fixture.built, {
        validateResultingWeapon: (weapon) => weapon.restorationBonuses.some(({ bonusTypeId }) => bonusTypeId === 'bonus_type.fixture.sharpness')
          ? ['restorationBonuses: not available']
          : [],
      })
      await expectRefusal(
        () => recordDifferent(unavailable, database, fixture.plan, bonusResult(alternativePracticalBonuses(), 'gogma_artian')),
        database,
        'actual_result_invalid',
      )

      await confirmCurrent(service, database, fixture.plan)
      await expectRefusal(
        () => recordDifferent(service, database, fixture.plan, { kind: 'skills', seriesSkillId: '', groupSkillId: null }),
        database,
        'actual_result_invalid',
      )
      const unknownSkill = executionService(database, fixture.built, {
        validateResultingWeapon: (weapon) => weapon.seriesSkillId === 'series_skill.fixture.unknown' ? ['seriesSkillId: not available'] : [],
      })
      await expectRefusal(
        () => recordDifferent(unknownSkill, database, fixture.plan, { kind: 'skills', seriesSkillId: 'series_skill.fixture.unknown', groupSkillId: null }),
        database,
        'actual_result_invalid',
      )
    }))

  it('validates the recorded slots of a Counter-advance Normal against Master availability too', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(3)
      await seed(database, fixture)
      await executionService(database, fixture.built).startProductionPlan(fixture.plan.id)
      const rejecting = executionService(database, fixture.built, { validateResultingWeapon: () => ['not available'] })
      await expectRefusal(
        () => recordDifferent(rejecting, database, fixture.plan, bonusResult(differentBonuses(stepOf(fixture.plan, 0).expectedResult?.restorationBonuses), 'normal_artian')),
        database,
        'actual_result_invalid',
      )
    }))

  it('re-checks the Plan status, the current Step and the expectedStateBefore inside the transaction', () =>
    withDatabase(async (database) => {
      const fixture = await existingResetFixture()
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      const actual = bonusResult(differentBonuses(stepOf(fixture.plan, 0).expectedResult?.restorationBonuses), 'gogma_artian')
      await expectRefusal(
        () => service.recordActualResultDifferent({ planId: fixture.plan.id, planStepId: stepOf(fixture.plan, 0).id, actualResult: actual }),
        database,
        'plan_not_active',
      )
      await service.startProductionPlan(fixture.plan.id)
      await expectRefusal(
        () => service.recordActualResultDifferent({ planId: fixture.plan.id, planStepId: 'step.unknown' as PlanStep['id'], actualResult: actual }),
        database,
        'step_not_current',
      )
      const rng = structuredClone(fixture.built.input.rngState)
      rng.gogmaCounter.value = CONSTRAINED_START_GOGMA_COUNTER + 3
      await database.rngState.put(rng)
      await expectRefusal(() => recordDifferent(service, database, fixture.plan, actual), database, 'execution_state_mismatch')
    }))

  it('rolls back every earlier write when the last write of the transaction fails', () =>
    withDatabase(async (database) => {
      const fixture = await existingResetFixture()
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await service.startProductionPlan(fixture.plan.id)
      await putSavePoint(database, fixture.plan, null, '2026-09-17T00:00:00.000Z')
      // The ExecutionHistory add runs after the RngState, OwnedWeapon, Target
      // and Plan writes of the record.
      database.executionHistory.hook('creating', () => {
        throw new Error('storage failure')
      })
      const before = await dump(database)
      const failure = await recordDifferent(
        service,
        database,
        fixture.plan,
        bonusResult(differentBonuses(stepOf(fixture.plan, 0).expectedResult?.restorationBonuses), 'gogma_artian'),
      ).catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(RepositoryError)
      expect(failure).toMatchObject({ code: 'transaction_failed' })
      expect(await dump(database)).toEqual(before)
    }))
})

describe('operation_uncertain', () => {
  it('changes only the Plan to stale and records the history with an entity-free Undo snapshot', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      fixture.plan.recalculationReasons = ['manual_recalculate']
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await service.startProductionPlan(fixture.plan.id)
      const first = await confirmCurrent(service, database, fixture.plan)
      const savePoint = await putSavePoint(database, fixture.plan, first.history.id, first.history.createdAt)
      const before = await dump(database)
      const activePlan = await currentPlan(database, fixture.plan)
      const current = activePlan.currentStepId as PlanStep['id']

      const { plan, history } = await service.recordOperationUncertain({ planId: fixture.plan.id, planStepId: current })

      const after = await dump(database)
      // RngState, Normal Counters, OwnedWeapons (in-progress included),
      // TargetWeapons, BuildListEntries and the save point are untouched.
      expect({ ...after, productionPlans: [], executionHistory: [] }).toEqual({ ...before, productionPlans: [], executionHistory: [] })
      expect(after.ownedWeapons.find(({ id }) => id === fixture.built.input.ownedWeapons[0].id)?.executionInProgress)
        .toEqual({ productionPlanId: fixture.plan.id, startedAt: first.history.createdAt })
      expect(after.executionSavePoints).toEqual([savePoint])
      expect(plan).toEqual({
        ...activePlan,
        status: 'stale',
        recalculationReasons: ['manual_recalculate', 'execution_operation_uncertain'],
        updatedAt: history.createdAt,
      })
      expect(plan.currentStepId).toBe(current)
      expect(plan.steps.find(({ id }) => id === current)).toMatchObject({ isCompleted: false, completedAt: null })
      expect(after.productionPlans).toEqual([plan])
      expect(after.executionHistory).toHaveLength(2)
      expect(after.executionHistory).toContainEqual(history)
      expect(history).toMatchObject({
        planStepId: current,
        action: 'operation_uncertain',
        actualResult: null,
        wasExpected: false,
        recalculationReason: 'execution_operation_uncertain',
      })
      expect(history.undoSnapshot).toEqual({
        rngStateBefore: (before.rngState as unknown[])[0],
        normalCountersBefore: before.normalCounters,
        affectedOwnedWeaponsBefore: [],
        addedOwnedWeaponIds: [],
        removedOwnedWeaponsBefore: [],
        affectedTargetWeaponsBefore: [],
        productionPlanBefore: activePlan,
        executionSavePointBefore: savePoint,
      })
      expect(validateExecutionHistory(history).issues).toEqual([])
      expect(validateProductionPlan(plan).issues).toEqual([])

      await expectRefusal(
        () => service.recordOperationUncertain({ planId: fixture.plan.id, planStepId: current }),
        database,
        'plan_not_active',
      )
    }))

  it('refuses a Step that is not current and a state that differs from expectedStateBefore', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await service.startProductionPlan(fixture.plan.id)
      await expectRefusal(
        () => service.recordOperationUncertain({ planId: fixture.plan.id, planStepId: stepOf(fixture.plan, 1).id }),
        database,
        'step_not_current',
      )
      const rng = structuredClone(fixture.built.input.rngState)
      rng.skillCounter.value = CONSTRAINED_START_SKILL_COUNTER + 2
      await database.rngState.put(rng)
      await expectRefusal(
        () => service.recordOperationUncertain({ planId: fixture.plan.id, planStepId: stepOf(fixture.plan, 0).id }),
        database,
        'execution_state_mismatch',
      )
    }))

  it('rolls back the Plan write when the history write fails', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(3)
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await service.startProductionPlan(fixture.plan.id)
      database.executionHistory.hook('creating', () => {
        throw new Error('storage failure')
      })
      const before = await dump(database)
      const failure = await service.recordOperationUncertain({ planId: fixture.plan.id, planStepId: stepOf(fixture.plan, 0).id })
        .catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(RepositoryError)
      expect(failure).toMatchObject({ code: 'transaction_failed' })
      expect(await dump(database)).toEqual(before)
    }))
})

describe('recalculation reasons', () => {
  it('adds a reason once and keeps the existing reasons', () => {
    expect(withRecalculationReason(['target_changed'], 'unexpected_result')).toEqual(['target_changed', 'unexpected_result'])
    expect(withRecalculationReason(['unexpected_result', 'target_changed'], 'unexpected_result')).toEqual(['unexpected_result', 'target_changed'])
  })
})

async function latestHistoryOf(database: AppDatabase, plan: ProductionPlan): Promise<ExecutionHistory> {
  const history = await database.executionHistory.where('planId').equals(plan.id).toArray()
  return history.sort(compareExecutionHistoryOrder).at(-1) as ExecutionHistory
}

async function undoLatest(service: ProductionPlanExecutionService, database: AppDatabase, plan: ProductionPlan) {
  const latest = await latestHistoryOf(database, plan)
  return service.undoLatestExecution({ planId: plan.id, executionHistoryId: latest.id })
}

describe('Execution Undo', () => {
  it('restores an intermediate confirmed_expected Step exactly, Targets relinked away included', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await service.startProductionPlan(fixture.plan.id)
      const before = await dump(database)

      const { history } = await confirmCurrent(service, database, fixture.plan)
      expect((await dump(database)).rngState).not.toEqual(before.rngState)
      expect(history.undoSnapshot.affectedTargetWeaponsBefore).toHaveLength(2)
      const { plan, undoneExecutionHistoryId } = await service.undoLatestExecution({ planId: fixture.plan.id, executionHistoryId: history.id })

      expect(undoneExecutionHistoryId).toBe(history.id)
      expect(plan).toEqual(history.undoSnapshot.productionPlanBefore)
      expect(plan).toMatchObject({ status: 'active', currentStepId: stepOf(fixture.plan, 0).id })
      expect(plan.steps[0]).toMatchObject({ isCompleted: false, completedAt: null })
      // Every entity, timestamps included, is the state before the Step; no Undo record is added.
      expect(await dump(database)).toEqual(before)
    }))

  it('deletes a registered production-target Normal and restores the Normal Counter and Target link', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(1)
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await service.startProductionPlan(fixture.plan.id)
      const before = await dump(database)
      const { history } = await confirmCurrent(service, database, fixture.plan)
      const tracked = history.undoSnapshot.addedOwnedWeaponIds[0]
      expect(await database.ownedWeapons.get(tracked)).toMatchObject({ executionInProgress: { productionPlanId: fixture.plan.id } })

      await undoLatest(service, database, fixture.plan)

      expect(await database.ownedWeapons.get(tracked)).toBeUndefined()
      expect(await dump(database)).toEqual(before)
    }))

  it('restores a converted owned Normal under the same ID as the Normal it was', () =>
    withDatabase(async (database) => {
      const fixture = await ownedNormalFixture()
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await service.startProductionPlan(fixture.plan.id)
      const before = await dump(database)
      const source = fixture.built.input.ownedWeapons[0]
      await confirmCurrent(service, database, fixture.plan)
      expect(await database.ownedWeapons.get(source.id)).toMatchObject({ kind: 'gogma' })

      await undoLatest(service, database, fixture.plan)

      expect(await database.ownedWeapons.get(source.id)).toEqual(source)
      expect(await dump(database)).toEqual(before)
    }))

  it('restores the status label a reached compromise checkpoint wrote', () =>
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
      const before = await dump(database)
      await confirmCurrent(service, database, fixture.plan)
      expect(await database.ownedWeapons.get(source.id)).toMatchObject({ status: 'practical' })

      await undoLatest(service, database, fixture.plan)

      expect(await database.ownedWeapons.get(source.id)).toMatchObject({ status: 'unclassified' })
      expect(await dump(database)).toEqual(before)
    }))

  it('reopens a completed Plan: final Step, Ideal weapon, completed Target, in-progress weapons and the deleted save point', () =>
    withDatabase(async (database) => {
      const unrelated = normalWeapon('owned.execution.unrelated')
      const fixture = await existingGogmaFixture([unrelated])
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await service.startProductionPlan(fixture.plan.id)
      const first = await confirmCurrent(service, database, fixture.plan)
      const savePoint = await putSavePoint(database, fixture.plan, first.history.id, first.history.createdAt)
      await database.ownedWeapons.put({ ...unrelated, executionInProgress: { productionPlanId: fixture.plan.id, startedAt: first.history.createdAt } })
      const before = await dump(database)
      const source = fixture.built.input.ownedWeapons[0]
      const goal = fixture.built.input.targetWeapons[0]

      const last = await confirmCurrent(service, database, fixture.plan)
      expect(last.plan.status).toBe('completed')
      expect(await database.executionSavePoints.count()).toBe(0)
      expect(await database.targetWeapons.get(goal.id)).toMatchObject({ lifecycleStatus: 'completed' })

      const { plan } = await undoLatest(service, database, fixture.plan)

      expect(plan).toMatchObject({ status: 'active', currentStepId: stepOf(fixture.plan, 1).id, completedAt: null })
      expect(plan.steps[1]).toMatchObject({ isCompleted: false, completedAt: null })
      expect(await database.ownedWeapons.get(source.id)).toMatchObject({ status: 'unclassified', isProtected: false, executionInProgress: { productionPlanId: fixture.plan.id } })
      expect(await database.ownedWeapons.get(unrelated.id)).toMatchObject({ executionInProgress: { productionPlanId: fixture.plan.id } })
      expect(await database.targetWeapons.get(goal.id)).toMatchObject({ lifecycleStatus: 'active', preferredOwnedWeaponId: source.id, completedAt: null })
      expect(await database.executionSavePoints.toArray()).toEqual([savePoint])
      expect(await dump(database)).toEqual(before)

      // The reopened final Step can be confirmed again.
      expect((await confirmCurrent(service, database, fixture.plan)).plan.status).toBe('completed')
    }))

  it('removes a blind observation with its record so the Step is observed again from scratch', () =>
    withDatabase(async (database) => {
      const fixture = await blindFixture()
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await service.startProductionPlan(fixture.plan.id)
      const tracked = stepOf(fixture.plan, 0).executionEffects?.trackedOwnedWeaponId as OwnedWeaponId
      const before = await dump(database)

      await confirmCurrent(service, database, fixture.plan, belowPracticalBonuses())
      await undoLatest(service, database, fixture.plan)
      expect(await dump(database)).toEqual(before)

      // A second, different observation is the only binding authority now.
      const second = await confirmCurrent(service, database, fixture.plan, practicalBonuses())
      expect(second.history.actualResult?.restorationBonuses).toEqual(practicalBonuses())
      expect(await database.executionHistory.count()).toBe(1)
      expect(await database.ownedWeapons.get(tracked)).toMatchObject({ restorationBonuses: practicalBonuses() })
      await confirmCurrent(service, database, fixture.plan)
      expect(await database.ownedWeapons.get(tracked)).toMatchObject({ kind: 'gogma', restorationBonuses: practicalBonuses() })
      expect((await confirmCurrent(service, database, fixture.plan)).plan.status).toBe('completed')
    }))

  it('undoes actual_result_different: stale -> active, Counter, actual weapon, Target link and Step all restored', () =>
    withDatabase(async (database) => {
      const fixture = await existingResetFixture()
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await service.startProductionPlan(fixture.plan.id)
      const before = await dump(database)
      const step = stepOf(fixture.plan, 0)
      await recordDifferent(service, database, fixture.plan, bonusResult(differentBonuses(step.expectedResult?.restorationBonuses), 'gogma_artian'))
      expect((await currentPlan(database, fixture.plan)).status).toBe('stale')

      const { plan } = await undoLatest(service, database, fixture.plan)

      expect(plan).toMatchObject({ status: 'active', currentStepId: step.id, recalculationReasons: [] })
      expect(plan.steps[0]).toMatchObject({ isCompleted: false, completedAt: null })
      expect((await database.rngState.get('current'))?.gogmaCounter.value).toBe(CONSTRAINED_START_GOGMA_COUNTER)
      expect(await dump(database)).toEqual(before)

      // The same Step is executable again.
      expect((await confirmCurrent(service, database, fixture.plan)).plan.status).toBe('completed')
    }))

  it('undoes operation_uncertain back to active and keeps a save point that is not its boundary', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await service.startProductionPlan(fixture.plan.id)
      const first = await confirmCurrent(service, database, fixture.plan)
      const savePoint = await putSavePoint(database, fixture.plan, first.history.id, first.history.createdAt)
      const before = await dump(database)
      const current = (await currentPlan(database, fixture.plan)).currentStepId as PlanStep['id']
      await service.recordOperationUncertain({ planId: fixture.plan.id, planStepId: current })

      const { plan } = await undoLatest(service, database, fixture.plan)

      expect(plan).toMatchObject({ status: 'active', currentStepId: current, recalculationReasons: [] })
      expect(await database.executionSavePoints.toArray()).toEqual([savePoint])
      expect(await database.executionHistory.toArray()).toEqual([first.history])
      expect(await dump(database)).toEqual(before)
    }))

  it('undoes only the latest ExecutionHistory the request names', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(3)
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await service.startProductionPlan(fixture.plan.id)
      const start = await dump(database)
      const first = await confirmCurrent(service, database, fixture.plan)
      const afterFirst = await dump(database)
      const second = await confirmCurrent(service, database, fixture.plan)
      const otherPlanId = 'plan.execution.other' as ProductionPlan['id']

      await expectRefusal(() => service.undoLatestExecution({ planId: fixture.plan.id, executionHistoryId: first.history.id }), database, 'undo_history_not_latest')
      await expectRefusal(() => service.undoLatestExecution({ planId: fixture.plan.id, executionHistoryId: 'history.unknown' as ExecutionHistoryId }), database, 'undo_history_not_found')
      await expectRefusal(() => service.undoLatestExecution({ planId: 'plan.unknown' as ProductionPlan['id'], executionHistoryId: second.history.id }), database, 'plan_not_found')
      await database.productionPlans.put({ ...structuredClone(fixture.plan), id: otherPlanId })
      await expectRefusal(() => service.undoLatestExecution({ planId: otherPlanId, executionHistoryId: second.history.id }), database, 'undo_history_not_found')
      await database.productionPlans.delete(otherPlanId)

      await service.undoLatestExecution({ planId: fixture.plan.id, executionHistoryId: second.history.id })
      expect(await dump(database)).toEqual(afterFirst)
      expect(await database.executionHistory.toArray()).toEqual([first.history])
      await service.undoLatestExecution({ planId: fixture.plan.id, executionHistoryId: first.history.id })
      expect(await dump(database)).toEqual(start)
    }))

  it('orders ExecutionHistory recorded at the same time by ID', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(3)
      await seed(database, fixture)
      const ids = ['history.same-time.a', 'history.same-time.b']
      const service = executionService(database, fixture.built, {
        idFactory: { executionHistoryId: () => ids.shift() as ExecutionHistoryId },
        clock: { now: () => '2026-09-17T02:00:00.000Z' },
      })
      await service.startProductionPlan(fixture.plan.id)
      await confirmCurrent(service, database, fixture.plan)
      const second = await confirmCurrent(service, database, fixture.plan)
      expect(second.history.id).toBe('history.same-time.b')

      await expectRefusal(
        () => service.undoLatestExecution({ planId: fixture.plan.id, executionHistoryId: 'history.same-time.a' as ExecutionHistoryId }),
        database,
        'undo_history_not_latest',
      )
      // The order the histories are handed over in is never the authority.
      const decided = prepareExecutionUndo({
        plan: await currentPlan(database, fixture.plan),
        executionHistoryId: second.history.id,
        state: {
          normalCounters: await database.normalArtianCounters.toArray(),
          ownedWeapons: await database.ownedWeapons.toArray(),
          targetWeapons: await database.targetWeapons.toArray(),
          planExecutionHistory: (await database.executionHistory.toArray()).reverse(),
          executionSavePoint: null,
        },
      })
      expect(decided.deletedExecutionHistoryId).toBe(second.history.id)
      await service.undoLatestExecution({ planId: fixture.plan.id, executionHistoryId: second.history.id })
      expect((await database.executionHistory.toArray()).map(({ id }) => id)).toEqual(['history.same-time.a'])
    }))

  it.each(['user_abandoned', 'replan_adopted', 'breaking_change_approved', 'finished_as_compromise'] as const)(
    'refuses an abandoned (%s) Plan whose abandonment the latest ExecutionHistory did not cause',
    (reason) =>
      withDatabase(async (database) => {
        const fixture = await existingGogmaFixture()
        await seed(database, fixture)
        const service = executionService(database, fixture.built)
        await service.startProductionPlan(fixture.plan.id)
        const first = await confirmCurrent(service, database, fixture.plan)
        await database.productionPlans.put({
          ...first.plan,
          status: 'abandoned',
          abandonmentReason: reason,
          abandonedAt: '2026-09-17T03:00:00.000Z',
        })
        expect(validateProductionPlan(await currentPlan(database, fixture.plan)).issues).toEqual([])
        await expectRefusal(() => undoLatest(service, database, fixture.plan), database, 'undo_not_allowed')
      }))

  it('refuses a completed Plan whose completion the latest ExecutionHistory did not cause', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await service.startProductionPlan(fixture.plan.id)
      await confirmCurrent(service, database, fixture.plan)
      const last = await confirmCurrent(service, database, fixture.plan)
      await database.productionPlans.put({ ...last.plan, completedAt: '2026-09-17T09:00:00.000Z' })
      await expectRefusal(() => undoLatest(service, database, fixture.plan), database, 'undo_not_allowed')

      // The latest record is an ordinary record, not the confirmation that completed the Plan.
      await database.productionPlans.put(last.plan)
      await database.executionHistory.put({ ...last.history, action: 'operation_uncertain', wasExpected: false, recalculationReason: 'execution_operation_uncertain', undoSnapshot: { ...last.history.undoSnapshot, affectedOwnedWeaponsBefore: [], affectedTargetWeaponsBefore: [] } })
      await expectRefusal(() => undoLatest(service, database, fixture.plan), database, 'undo_not_allowed')
    }))

  it('refuses a draft Plan', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await service.startProductionPlan(fixture.plan.id)
      const first = await confirmCurrent(service, database, fixture.plan)
      await database.productionPlans.put(fixture.plan)
      await expectRefusal(
        () => service.undoLatestExecution({ planId: fixture.plan.id, executionHistoryId: first.history.id }),
        database,
        'undo_not_allowed',
      )
    }))

  it('deletes the save point whose boundary is the undone record and never revives an older one', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await service.startProductionPlan(fixture.plan.id)
      const older = await putSavePoint(database, fixture.plan, null, '2026-09-17T00:00:00.000Z')
      const before = await dump(database)
      const first = await confirmCurrent(service, database, fixture.plan)
      expect(first.history.undoSnapshot.executionSavePointBefore).toEqual(older)
      await putSavePoint(database, fixture.plan, first.history.id, first.history.createdAt)

      await undoLatest(service, database, fixture.plan)

      expect(await database.executionSavePoints.count()).toBe(0)
      expect({ ...(await dump(database)), executionSavePoints: before.executionSavePoints }).toEqual(before)
    }))

  it('restores the whole Normal Counter collection, dropping a record added after the Step', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(3)
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await service.startProductionPlan(fixture.plan.id)
      const { history } = await confirmCurrent(service, database, fixture.plan)
      const [counter] = await database.normalArtianCounters.toArray()
      await database.normalArtianCounters.put({ ...counter, id: 'weapon.fixture.b:8', weaponTypeId: 'weapon.fixture.b', counter: 7 })
      expect(await database.normalArtianCounters.count()).toBe(2)

      await undoLatest(service, database, fixture.plan)

      const byId = (values: { id: string }[]) => [...values].sort((a, b) => a.id.localeCompare(b.id))
      expect(byId(await database.normalArtianCounters.toArray())).toEqual(byId(history.undoSnapshot.normalCountersBefore))
      expect(history.undoSnapshot.normalCountersBefore).toHaveLength(1)
    }))

  it('applies each OwnedWeapon role of the snapshot: affected restored, added deleted, removed restored', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await service.startProductionPlan(fixture.plan.id)
      const { history } = await confirmCurrent(service, database, fixture.plan)
      const source = fixture.built.input.ownedWeapons[0]
      const added = normalWeapon('owned.execution.added')
      const removed = normalWeapon('owned.execution.removed', { memo: 'removed by the Step' })
      await database.ownedWeapons.put(added)
      const crafted: ExecutionHistory = {
        ...history,
        undoSnapshot: {
          ...history.undoSnapshot,
          addedOwnedWeaponIds: [added.id],
          removedOwnedWeaponsBefore: [removed],
        },
      }
      expect(validateExecutionHistory(crafted).issues).toEqual([])
      await database.executionHistory.put(crafted)

      await undoLatest(service, database, fixture.plan)

      expect((await database.ownedWeapons.toArray()).map(({ id }) => id).sort()).toEqual([removed.id, source.id].sort())
      expect(await database.ownedWeapons.get(source.id)).toEqual(source)
      expect(await database.ownedWeapons.get(removed.id)).toEqual(removed)
    }))

  it('refuses a history whose snapshot fails validation or is not the start of its Step, without guessing', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await service.startProductionPlan(fixture.plan.id)
      const { history } = await confirmCurrent(service, database, fixture.plan)

      const incomplete = structuredClone(history) as unknown as { undoSnapshot: Record<string, unknown> }
      delete incomplete.undoSnapshot.affectedTargetWeaponsBefore
      await database.executionHistory.put(incomplete as unknown as ExecutionHistory)
      await expectRefusal(() => undoLatest(service, database, fixture.plan), database, 'undo_snapshot_invalid')

      await database.executionHistory.put({
        ...history,
        undoSnapshot: {
          ...history.undoSnapshot,
          productionPlanBefore: { ...history.undoSnapshot.productionPlanBefore, currentStepId: stepOf(fixture.plan, 1).id },
        },
      })
      await expectRefusal(() => undoLatest(service, database, fixture.plan), database, 'undo_snapshot_invalid')

      await database.executionHistory.put({ ...history, action: 'secured_weapon' })
      await expectRefusal(() => undoLatest(service, database, fixture.plan), database, 'undo_not_allowed')
    }))

  it('writes nothing when the restored Target preference collection would be invalid', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(1)
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await service.startProductionPlan(fixture.plan.id)
      const { history } = await confirmCurrent(service, database, fixture.plan)
      const tracked = history.undoSnapshot.addedOwnedWeaponIds[0]
      const goal = (await database.targetWeapons.get(fixture.built.input.targetWeapons[0].id)) as TargetWeapon
      // The weapon moved to a Target the Step never touched, so deleting it would dangle that preference.
      await database.targetWeapons.bulkPut([
        { ...goal, preferredOwnedWeaponId: null },
        orchestrationTarget('target.execution.taker', { preferredOwnedWeaponId: tracked }),
      ])
      await expectRefusal(() => undoLatest(service, database, fixture.plan), database, 'undo_result_invalid')
    }))

  it('rolls back every restore write when the ExecutionHistory delete fails', () =>
    withDatabase(async (database) => {
      const unrelated = normalWeapon('owned.execution.unrelated')
      const fixture = await existingGogmaFixture([unrelated])
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await service.startProductionPlan(fixture.plan.id)
      const first = await confirmCurrent(service, database, fixture.plan)
      await putSavePoint(database, fixture.plan, first.history.id, first.history.createdAt)
      await confirmCurrent(service, database, fixture.plan)
      const [counter] = await database.normalArtianCounters.toArray()
      await database.normalArtianCounters.put({ ...counter, id: 'weapon.fixture.b:8', weaponTypeId: 'weapon.fixture.b' })
      // The history delete runs after the RngState, Counter, OwnedWeapon,
      // Target, Plan and save point restore writes.
      database.executionHistory.hook('deleting', () => {
        throw new Error('storage failure')
      })
      const before = await dump(database)
      const failure = await undoLatest(service, database, fixture.plan).catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(RepositoryError)
      expect(failure).toMatchObject({ code: 'transaction_failed' })
      expect(await dump(database)).toEqual(before)
    }))
})
