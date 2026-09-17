import Dexie from 'dexie'
import { expect } from 'vitest'
import { AppDatabase } from '../../db/AppDatabase'
import type {
  BuildListEntry,
  BuildRoute,
  ExecutionHistory,
  ExecutionHistoryId,
  ExecutionSavePoint,
  OwnedWeapon,
  PlanStep,
  ProductionPlan,
  RestorationBonusSet,
  TargetWeapon,
} from '../../domain/models/publicTypes'
import { validateProductionPlan } from '../../domain/models/publicTypes'
import { createProductionPlan } from '../../domain/planner/productionPlanGeneration'
import {
  ProductionPlanExecutionService,
  type ProductionPlanExecutionServiceDependencies,
} from '../../services/execution/productionPlanExecutionService'
import {
  CONSTRAINED_START_GOGMA_COUNTER,
  CONSTRAINED_START_NORMAL_COUNTER,
  CONSTRAINED_START_SKILL_COUNTER,
  IDEAL_SERIES_SKILL_ID,
  alternativePracticalBonuses,
  belowPracticalBonuses,
  normalWeapon,
  sameLayoutLowerRanks,
} from './constrainedEnumeration'
import {
  orchestrationEntry,
  orchestrationNormalCounters,
  orchestrationScenario,
  orchestrationSource,
  orchestrationTarget,
  type OrchestrationScenario,
} from './plannerConstrainedOrchestration'

/**
 * Shared real-Dexie harness of the Execution runtime service tests: fixtures
 * whose Plans come from the real Planner, the seeded persisted state, and a
 * deterministic service.
 */

export const WEAPON_TYPE = 'weapon.fixture.a'

let databaseSequence = 0

export async function withDatabase(test: (database: AppDatabase) => Promise<void>): Promise<void> {
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

export interface ExecutionFixture {
  built: OrchestrationScenario
  plan: ProductionPlan
}

export async function planFor(built: OrchestrationScenario): Promise<ExecutionFixture> {
  const result = await createProductionPlan(built.input, built.dependencies)
  expect(result.termination.status).toBe('completed')
  expect(result.plan).not.toBeNull()
  const plan = result.plan as ProductionPlan
  expect(validateProductionPlan(plan).issues).toEqual([])
  return { built, plan }
}

/** Persists exactly the state the Plan was calculated from, plus the draft Plan. */
export async function seed(database: AppDatabase, { built, plan }: ExecutionFixture): Promise<void> {
  await database.rngState.put(structuredClone(built.input.rngState))
  await database.normalArtianCounters.bulkPut(structuredClone(built.input.normalCounters))
  await database.ownedWeapons.bulkPut(structuredClone(built.input.ownedWeapons))
  await database.targetWeapons.bulkPut(structuredClone(built.input.targetWeapons))
  await database.buildListEntries.bulkPut(structuredClone(built.input.buildListEntries))
  await database.productionPlans.put(structuredClone(plan))
}

export function executionService(
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

export interface PersistedDump {
  rngState: unknown
  normalCounters: unknown
  ownedWeapons: OwnedWeapon[]
  targetWeapons: TargetWeapon[]
  buildListEntries: BuildListEntry[]
  productionPlans: ProductionPlan[]
  executionHistory: ExecutionHistory[]
  executionSavePoints: ExecutionSavePoint[]
}

export async function dump(database: AppDatabase): Promise<PersistedDump> {
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
export async function expectRefusal(
  run: () => Promise<unknown>,
  database: AppDatabase,
  code: string,
): Promise<void> {
  const before = await dump(database)
  await expect(run()).rejects.toMatchObject({ code })
  expect(await dump(database)).toEqual(before)
}

export async function currentPlan(database: AppDatabase, plan: ProductionPlan): Promise<ProductionPlan> {
  return (await database.productionPlans.get(plan.id)) as ProductionPlan
}

export async function confirmCurrent(
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

export function newNormalRoute(count: number): BuildRoute {
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

export function newNormalFixture(count = 3, extraTargets: TargetWeapon[] = []) {
  const goal = orchestrationTarget('target.execution.new-normal')
  const entry = orchestrationEntry('entry.execution.new-normal', goal, newNormalRoute(count))
  return planFor(orchestrationScenario({
    targets: [goal, ...extraTargets],
    entries: [entry],
    normalCounters: orchestrationNormalCounters(),
  }))
}

export function blindFixture() {
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

export function existingGogmaFixture(extraOwnedWeapons: OwnedWeapon[] = []) {
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

export function stepOf(plan: ProductionPlan, index: number): PlanStep {
  return plan.steps[index]
}
export function differentBonuses(expected: RestorationBonusSet | null | undefined): RestorationBonusSet {
  const candidates = [sameLayoutLowerRanks(), alternativePracticalBonuses(), belowPracticalBonuses()]
  const different = candidates.find((candidate) =>
    expected == null || JSON.stringify(candidate) !== JSON.stringify(expected))
  return different as RestorationBonusSet
}

export function bonusResult(restorationBonuses: RestorationBonusSet, restorationBonusScope: 'normal_artian' | 'gogma_artian') {
  return { kind: 'restoration_bonuses' as const, restorationBonuses, restorationBonusScope }
}

export function existingResetFixture() {
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

export function ownedNormalFixture() {
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

export type ActualResultInput = Parameters<ProductionPlanExecutionService['recordActualResultDifferent']>[0]['actualResult']

export async function recordDifferent(
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

