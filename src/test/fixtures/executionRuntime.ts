import Dexie from 'dexie'
import { expect } from 'vitest'
import { AppDatabase } from '../../db/AppDatabase'
import type {
  BuildListEntry,
  BuildRoute,
  ExecutionHistory,
  ExecutionHistoryId,
  ExecutionSavePoint,
  OwnedGogmaArtianWeapon,
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
  practicalBonuses,
  sameLayoutLowerRanks,
} from './constrainedEnumeration'
import {
  checkpointBonusEntry,
  checkpointBonusResultAt,
  orchestrationEntry,
  orchestrationNormalCounters,
  orchestrationScenario,
  orchestrationSource,
  orchestrationTarget,
  resetRoute,
  startReachedCheckpointEntry,
  startReachedCheckpointResultAt,
  startReachedSkillCheckpointEntry,
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

export const CHECKPOINT_SOURCE_ID = 'owned.execution.checkpoint'
export const CHECKPOINT_TARGET_ID = 'target.execution.checkpoint'
export const CHECKPOINT_ENTRY_ID = 'entry.execution.checkpoint'

export interface CheckpointFixture extends ExecutionFixture {
  source: OwnedGogmaArtianWeapon
  goal: TargetWeapon
  entry: BuildListEntry
}

async function checkpointScenario(
  source: OwnedGogmaArtianWeapon,
  goal: TargetWeapon,
  entry: BuildListEntry,
  resetResultAt: (gogmaCounter: number) => RestorationBonusSet,
  extraOwnedWeapons: OwnedWeapon[],
): Promise<CheckpointFixture> {
  const fixture = await planFor(orchestrationScenario({
    targets: [goal],
    entries: [entry],
    ownedWeapons: [source, ...extraOwnedWeapons],
    engine: { resetResultAt },
  }))
  return { ...fixture, source, goal, entry }
}

/**
 * A selected compromise checkpoint the Route actually produces: the Bonus lane
 * position 1 state, reached by confirming the Step that carries its compromise
 * label.
 */
export function checkpointFixture(
  extraOwnedWeapons: OwnedWeapon[] = [],
  options: { select?: boolean } = {},
) {
  const source = orchestrationSource(CHECKPOINT_SOURCE_ID, { seriesSkillId: IDEAL_SERIES_SKILL_ID })
  const goal = orchestrationTarget(CHECKPOINT_TARGET_ID)
  return checkpointScenario(
    source,
    goal,
    checkpointBonusEntry(CHECKPOINT_ENTRY_ID, goal, source.id, source, options),
    checkpointBonusResultAt,
    extraOwnedWeapons,
  )
}

/**
 * A selected compromise checkpoint held from Plan start (7.5.2): the source's
 * own Practical five slots are its Bonus lane start and its Skills are already
 * Ideal, so the finish is available before the Entry's first physical Step.
 */
export function startReachedCheckpointFixture(extraOwnedWeapons: OwnedWeapon[] = []) {
  const source = orchestrationSource(CHECKPOINT_SOURCE_ID, {
    restorationBonuses: practicalBonuses(),
    seriesSkillId: IDEAL_SERIES_SKILL_ID,
  })
  const goal = orchestrationTarget(CHECKPOINT_TARGET_ID)
  return checkpointScenario(
    source,
    goal,
    startReachedCheckpointEntry(CHECKPOINT_ENTRY_ID, goal, source),
    startReachedCheckpointResultAt,
    extraOwnedWeapons,
  )
}

export const OTHER_WEAPON_ID = 'owned.execution.other'

/**
 * A two-weapon Plan: this Entry's start-held Skill checkpoint on one weapon,
 * and another Entry's Reset Bonuses on another weapon. The Beam Search puts the
 * other weapon's Step first, so a test can confirm it and then finish at this
 * checkpoint, which no Step has touched.
 */
export function otherWeaponCheckpointFixture(): Promise<CheckpointFixture> {
  const source = orchestrationSource(CHECKPOINT_SOURCE_ID, {
    restorationBonuses: practicalBonuses(),
    seriesSkillId: 'series_skill.fixture.z',
    groupSkillId: 'group_skill.fixture.a',
  })
  const other = orchestrationSource(OTHER_WEAPON_ID, {
    restorationBonuses: belowPracticalBonuses(),
    seriesSkillId: IDEAL_SERIES_SKILL_ID,
  })
  // The two Targets must not be satisfiable by each other's weapon, or the
  // Beam Search drops the second Entry: this one's Ideal is the five slots the
  // source already holds, the other one's is the default Ideal set.
  // Its Ideal five slots are the Practical set, so the default Bonus compromise
  // conditions (which relax that set's own types) would not be contained in it:
  // the Target carries none and compromises on its Skills only.
  const goal = orchestrationTarget(CHECKPOINT_TARGET_ID, {
    idealBonuses: practicalBonuses(),
    practicalBonusConditions: [],
    alternativeBonusRules: [],
  })
  const otherGoal = orchestrationTarget('target.execution.otherweapon')
  const entry = startReachedSkillCheckpointEntry(CHECKPOINT_ENTRY_ID, goal, source)
  return planFor(orchestrationScenario({
    targets: [goal, otherGoal],
    entries: [entry, orchestrationEntry('entry.execution.other', otherGoal, resetRoute(other.id))],
    ownedWeapons: [source, other],
    engine: {
      skillResultAt: (skillCounter: number) =>
        skillCounter === CONSTRAINED_START_SKILL_COUNTER
          ? { seriesSkillId: IDEAL_SERIES_SKILL_ID, groupSkillId: null }
          : { seriesSkillId: `series_skill.fixture.s${skillCounter}`, groupSkillId: null },
    },
  })).then((fixture) => ({ ...fixture, source, goal, entry }))
}

/** The index of the Step whose Execution effects label the checkpoint weapon. */
export function compromiseLabelStepIndex(plan: ProductionPlan): number {
  return plan.steps.findIndex((step) => (step.executionEffects?.compromiseLabels.length ?? 0) > 0)
}

/** Finishes at the fixture's selected checkpoint, from the Plan's current Step. */
export async function finishAsCompromise(
  service: ProductionPlanExecutionService,
  database: AppDatabase,
  fixture: CheckpointFixture,
  overrides: Partial<Parameters<ProductionPlanExecutionService['finishProductionPlanAsCompromise']>[0]> = {},
) {
  const stored = await currentPlan(database, fixture.plan)
  return service.finishProductionPlanAsCompromise({
    planId: fixture.plan.id,
    planStepId: stored.currentStepId as PlanStep['id'],
    buildListEntryId: fixture.entry.id,
    targetWeaponId: fixture.goal.id,
    ownedWeaponId: fixture.source.id,
    ...overrides,
  })
}

export const WINDOW_SOURCE_ID = 'owned.execution.window'

export type WindowOperation = 'reset_bonuses' | 'keep_bonuses' | 'reset_skills'

/**
 * One existing Gogma whose Route runs the given operations in order, for the
 * Current Position Recovery Window (`docs/PLANNER_SPEC.md` 16.15). Each Reset /
 * Keep Bonuses advances the Gogma Counter by one from the fixture start and
 * yields the next entry of `bonusResults`; the last one must be the Ideal.
 * The Reset Skills reaches the Ideal Series Skill. The source starts with
 * `sourceBonuses` (below Practical by default) and a non-Ideal Skill.
 */
export function sameWeaponWindowFixture(
  operations: readonly WindowOperation[],
  bonusResults: readonly RestorationBonusSet[],
  options: {
    improvementPreference?: 'planner' | 'skill_first' | 'bonus_first'
    sourceBonuses?: RestorationBonusSet
  } = {},
) {
  const source = orchestrationSource(WINDOW_SOURCE_ID, {
    restorationBonuses: options.sourceBonuses ?? belowPracticalBonuses(),
  })
  const goal = orchestrationTarget('target.execution.window')
  let gogma = CONSTRAINED_START_GOGMA_COUNTER
  let skill = CONSTRAINED_START_SKILL_COUNTER
  const routeOperations = operations.map((type) => {
    if (type === 'reset_skills') {
      skill += 1
      return { type, sourceOwnedWeaponId: source.id, skillCounterBefore: skill - 1, skillCounterAfter: skill }
    }
    gogma += 1
    return { type, sourceOwnedWeaponId: source.id, gogmaCounterBefore: gogma - 1, gogmaCounterAfter: gogma }
  })
  const entry = orchestrationEntry('entry.execution.window', goal, {
    kind: 'existing_gogma_mixed',
    sourceOwnedWeaponId: source.id,
    operations: routeOperations,
  })
  entry.intermediateStateSelection = {
    skillOpportunityId: null,
    bonusOpportunityId: null,
    improvementPreference: options.improvementPreference ?? 'bonus_first',
  }
  const resultAt = (gogmaCounter: number) =>
    bonusResults[gogmaCounter - CONSTRAINED_START_GOGMA_COUNTER] ?? belowPracticalBonuses()
  return planFor(orchestrationScenario({
    targets: [goal],
    entries: [entry],
    ownedWeapons: [source],
    engine: {
      resetResultAt: resultAt,
      keepResultAt: resultAt,
      keepSupported: true,
      keepInputs: [source.restorationBonuses, ...bonusResults],
    },
  })).then((fixture) => ({ ...fixture, source, goal, entry }))
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

