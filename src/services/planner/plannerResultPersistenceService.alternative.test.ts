import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { AppDatabase } from '../../db/AppDatabase'
import type { BuildListEntryReplacement } from '../../domain/buildList'
import type {
  PlanBreakingChangeApproval,
  PlanBreakingChangeInspection,
} from '../../domain/execution'
import type {
  BuildListEntry,
  BuildRoute,
  CalculationContext,
  PlannerConflictRepairLineage,
  PlanningInputSnapshot,
  ProductionPlan,
  RngState,
  TargetWeapon,
} from '../../domain/models/publicTypes'
import { createExpectedPlanState } from '../../domain/models/publicTypes'
import {
  collectProductionPlanDependentTargetWeaponIds,
  createPlanningInputSnapshot,
  createProductionPlan,
  type PlannerAlternativeRepairArtifact,
  type PlannerInput,
} from '../../domain/planner'
import {
  DOMAIN_FIXTURE_TIME,
  createValidBuildCandidate,
  createValidProductionPlan,
  planStepId,
  productionPlanId,
} from '../../test/fixtures/domainData'
import { IDEAL_SERIES_SKILL_ID } from '../../test/fixtures/constrainedEnumeration'
import { fixture, resetRoute, routeEntry, sourceWeapon, target } from '../../test/fixtures/plannerBeam'
import {
  confirmCurrent,
  currentPlan,
  dump,
  executionService,
  newNormalFixture,
  seed,
  withDatabase,
  type ExecutionFixture,
} from '../../test/fixtures/executionRuntime'
import {
  orchestrationEntry,
  orchestrationSource,
  synchronizeOrchestrationEntry,
} from '../../test/fixtures/plannerConstrainedOrchestration'
import { completedPlannerTermination, incompletePlannerTermination } from '../../test/fixtures/plannerTermination'
import {
  PlannerResultPersistenceService,
  createPlannerResultPersistenceRepositories,
} from './plannerResultPersistenceService'

/**
 * The Planner Alternative actual repair save (`docs/PLANNER_SPEC.md` 9.2.19.8 /
 * 9.2.19.11 / 9.2.18, Phase 5-B): the artifact's accepted replacement set is
 * the authority, the new Draft carries the artifact's lineage exactly, and the
 * whole save is one guarded transaction.
 */

const OLD_DRAFT_ID = 'plan.alternative.old-draft'

function normalRoute(): BuildRoute {
  return structuredClone(createValidBuildCandidate().route)
}

interface Scenario {
  database: AppDatabase
  service: PlannerResultPersistenceService
  context: CalculationContext
  persisted: BuildListEntry[]
  generated: BuildListEntry[]
  replacements: BuildListEntryReplacement[]
  artifact: PlannerAlternativeRepairArtifact
  entryIds(): Promise<string[]>
  planIds(): Promise<string[]>
}

interface ScenarioOptions {
  /** How many of the two persisted Entries an accepted replacement replaces (0..2). */
  replacementCount?: number
  /**
   * The final Plan leaves the first generated Entry unselected: it lost only a
   * provisional outcome to an Entry outside the fixed Route set (9.2.19.6).
   */
  unselectFirstGenerated?: boolean
}

function lineageFor(
  persisted: readonly BuildListEntry[],
  replacements: readonly BuildListEntryReplacement[],
): PlannerConflictRepairLineage {
  const earlier = {
    conflictKind: 'same_gogma_counter' as const,
    fixedBuildListEntryId: persisted[1].id,
    fixedTargetWeaponId: persisted[1].targetWeaponId,
    invalidatedRoutes: [],
  }
  const invalidatedRoutes = replacements.length === 0
    ? [{
        targetWeaponId: persisted[0].targetWeaponId,
        invalidatedBuildListEntryId: persisted[0].id,
        invalidatedRouteKey: 'route.key.persisted.a',
        replacementBuildListEntryId: null,
        outcome: 'not_found_within_search_extent' as const,
      }]
    : replacements.map((replacement) => ({
        targetWeaponId: replacement.targetWeaponId,
        invalidatedBuildListEntryId: replacement.replacedBuildListEntryId,
        invalidatedRouteKey: `route.key.${replacement.replacedBuildListEntryId}`,
        replacementBuildListEntryId: replacement.generatedBuildListEntryId,
        outcome: 'replaced' as const,
      }))
  return {
    decisions: [earlier, {
      conflictKind: 'same_skill_counter',
      fixedBuildListEntryId: 'build-list.fixed.elsewhere' as BuildListEntry['id'],
      fixedTargetWeaponId: 'target.fixed.elsewhere' as TargetWeapon['id'],
      invalidatedRoutes,
    }],
  }
}

function buildPlan(
  snapshot: PlanningInputSnapshot,
  calculationContext: CalculationContext,
  selected: readonly BuildListEntry[],
): ProductionPlan {
  const base = createValidProductionPlan()
  const steps = selected.map((entry, index) => ({
    ...base.steps[0],
    id: planStepId(`step.alternative.${index}`),
    order: index + 1,
    targetWeaponId: entry.targetWeaponId,
    buildListEntryId: entry.id,
    candidateId: entry.candidateSnapshot.id,
    expectedStateBefore: { ...snapshot.initialExecutionState },
    expectedStateAfter: { ...snapshot.initialExecutionState },
  }))
  return {
    ...base,
    id: productionPlanId('plan.alternative.repaired'),
    status: 'draft',
    baseSnapshot: snapshot,
    selectedBuildListEntryIds: selected.map(({ id }) => id),
    calculationContext: { ...calculationContext },
    steps,
    conflicts: [],
    rejectedBuildListEntries: [],
    currentStepId: steps[0]?.id ?? null,
    // Plan generation never sets a lineage; the save sets the artifact's.
    conflictRepairLineage: null,
  }
}

let databaseSequence = 0

async function withScenario(
  run: (scenario: Scenario) => Promise<void>,
  options: ScenarioOptions = {},
): Promise<void> {
  databaseSequence += 1
  const name = `planner-alternative-repair-persistence-${databaseSequence}`
  const database = new AppDatabase(name)
  await database.open()
  try {
    const targetA = target('target.fixture.a')
    const targetB = target('target.fixture.b', 2)
    const persisted = [
      routeEntry('build-list.persisted.a', targetA, normalRoute()),
      routeEntry('build-list.persisted.b', targetB, normalRoute(), 'practical'),
    ]
    const count = options.replacementCount ?? 1
    const generated = Array.from({ length: count }, (_unused, index) =>
      routeEntry(`build-list.generated.${index}`, index === 0 ? targetA : targetB, normalRoute()))
    const replacements: BuildListEntryReplacement[] = generated.map((entry, index) => ({
      targetWeaponId: entry.targetWeaponId,
      replacedBuildListEntryId: persisted[index].id,
      generatedBuildListEntryId: entry.id,
    }))
    const owned = [sourceWeapon('owned.fixture.a'), sourceWeapon('owned.fixture.b')]
    const { input } = fixture([targetA, targetB], [...persisted, ...generated], owned)
    // The final scenario run is calculated over the replacement set.
    const finalSet = [...persisted.slice(count), ...generated]
    input.buildListEntries = finalSet
    const selected = options.unselectFirstGenerated
      ? finalSet.filter(({ id }) => id !== generated[0]?.id)
      : finalSet
    const dependentTargetWeaponIds = collectProductionPlanDependentTargetWeaponIds(
      { selectedBuildListEntryIds: selected.map(({ id }) => id), steps: selected.map((entry) => ({ ...createValidProductionPlan().steps[0], targetWeaponId: entry.targetWeaponId })) },
      finalSet,
    )
    const snapshot = createPlanningInputSnapshot(
      input,
      {
        initialExecutionState: createExpectedPlanState(input.rngState, input.normalCounters, input.ownedWeapons, {
          targetWeapons: input.targetWeapons,
          dependentTargetWeaponIds,
        }),
        dependentTargetWeaponIds,
        selectedBuildListEntryIds: selected.map(({ id }) => id),
      },
      DOMAIN_FIXTURE_TIME,
    )
    const plan = buildPlan(snapshot, input.calculationContext, selected)

    const seedRepositories = createPlannerResultPersistenceRepositories(database)
    await seedRepositories.rngState.putRngState(input.rngState)
    for (const counter of input.normalCounters) await seedRepositories.normalCounters.putNormalArtianCounter(counter)
    for (const weapon of input.ownedWeapons) await seedRepositories.ownedWeapons.putOwnedWeapon(weapon)
    for (const goal of input.targetWeapons) await seedRepositories.targetWeapons.putTargetWeapon(goal)
    for (const entry of persisted) await seedRepositories.buildListEntries.putBuildListEntry(entry)
    await database.productionPlans.put({ ...createValidProductionPlan(), id: productionPlanId(OLD_DRAFT_ID) })

    await run({
      database,
      service: new PlannerResultPersistenceService(database),
      context: input.calculationContext,
      persisted,
      generated,
      replacements,
      artifact: {
        plannerResult: { plan, conflicts: [], warnings: [], termination: completedPlannerTermination() },
        generatedBuildListEntries: generated,
        generatedBuildListEntryReplacements: replacements,
        conflictRepairLineage: lineageFor(persisted, replacements),
      },
      entryIds: async () => (await database.buildListEntries.toArray()).map(({ id }) => id).sort(),
      planIds: async () => (await database.productionPlans.toArray()).map(({ id }) => id).sort(),
    })
  } finally {
    database.close()
    await Dexie.delete(name)
  }
}

describe('PlannerResultPersistenceService Planner Alternative repair save', () => {
  it.each([0, 1, 2])('saves a repair with %i accepted replacements atomically, with the artifact lineage on the Draft', (replacementCount) =>
    withScenario(async ({ database, service, context, artifact, persisted, generated, entryIds, planIds }) => {
      const outcome = await service.savePlannerAlternativeRepair(artifact, context)

      expect(outcome).toMatchObject({ kind: 'saved', plan: { id: 'plan.alternative.repaired', status: 'draft' } })
      // Every replaced O is gone and every G is stored; untouched Entries stay.
      expect(await entryIds()).toEqual([
        ...persisted.slice(replacementCount).map(({ id }) => id),
        ...generated.map(({ id }) => id),
      ].sort())
      // The previous Draft is replaced by the new one in the same transaction.
      expect(await planIds()).toEqual(['plan.alternative.repaired'])
      const stored = await database.productionPlans.get('plan.alternative.repaired')
      // Exactly the artifact lineage - never one rebuilt from persisted state.
      expect(stored?.conflictRepairLineage).toEqual(artifact.conflictRepairLineage)
      expect(outcome.kind === 'saved' && outcome.plan).toEqual(stored)
      // The artifact itself is not mutated.
      expect(artifact.plannerResult.plan.conflictRepairLineage).toBeNull()
    }, { replacementCount }))

  it('saves an accepted replacement the final Plan does not select, replacing O with G', () =>
    withScenario(async ({ database, service, context, artifact, persisted, generated, entryIds }) => {
      expect(artifact.plannerResult.plan.selectedBuildListEntryIds).not.toContain(generated[0].id)

      await service.savePlannerAlternativeRepair(artifact, context)

      expect(await entryIds()).toEqual([persisted[1].id, generated[0].id].sort())
      const stored = await database.productionPlans.get('plan.alternative.repaired')
      expect(stored?.selectedBuildListEntryIds).toEqual([persisted[1].id])
      expect(stored?.conflictRepairLineage?.decisions.at(-1)?.invalidatedRoutes).toEqual([{
        targetWeaponId: persisted[0].targetWeaponId,
        invalidatedBuildListEntryId: persisted[0].id,
        invalidatedRouteKey: `route.key.${persisted[0].id}`,
        replacementBuildListEntryId: generated[0].id,
        outcome: 'replaced',
      }])
    }, { unselectFirstGenerated: true }))

  it('keeps the B8 contract separate: the same unselected Entry as an orchestration result is refused', () =>
    withScenario(async ({ database, service, context, artifact, entryIds }) => {
      const before = await dump(database)
      await expect(service.savePlannerOrchestrationResult({
        ...artifact.plannerResult,
        generatedBuildListEntries: artifact.generatedBuildListEntries,
        generatedBuildListEntryReplacements: artifact.generatedBuildListEntryReplacements,
      }, context)).rejects.toMatchObject({ code: 'planner_result_invalid' })
      expect(await dump(database)).toEqual(before)
      expect(await entryIds()).not.toContain('build-list.generated.0')
    }, { unselectFirstGenerated: true }))

  it('refuses a replaced O that changed after the calculation and writes nothing', () =>
    withScenario(async ({ database, service, context, artifact, persisted }) => {
      // The user replaced the Target's Entry while the Worker calculated.
      await database.buildListEntries.delete(persisted[0].id)
      await database.buildListEntries.put({ ...persisted[0], id: 'build-list.persisted.a2' as BuildListEntry['id'] })
      const before = await dump(database)

      await expect(service.savePlannerAlternativeRepair(artifact, context))
        .rejects.toMatchObject({ code: 'planner_state_changed' })
      await expect(service.inspectPlannerAlternativeRepairSave(artifact, context))
        .rejects.toMatchObject({ code: 'planner_state_changed' })
      expect(await dump(database)).toEqual(before)
    }))

  it('refuses a generated ID that is already persisted and writes nothing', () =>
    withScenario(async ({ database, service, context, artifact, generated }) => {
      await database.buildListEntries.put(generated[0])
      const before = await dump(database)
      await expect(service.savePlannerAlternativeRepair(artifact, context))
        .rejects.toMatchObject({ code: 'planner_state_changed' })
      expect(await dump(database)).toEqual(before)
    }))

  it.each([
    ['a missing replacement', (a: PlannerAlternativeRepairArtifact) => { a.generatedBuildListEntryReplacements = [] }],
    ['a replacement for another Target', (a: PlannerAlternativeRepairArtifact) => {
      a.generatedBuildListEntryReplacements[0].targetWeaponId = 'target.fixture.b' as TargetWeapon['id']
    }],
    ['an incomplete final run', (a: PlannerAlternativeRepairArtifact) => {
      a.plannerResult.termination = incompletePlannerTermination(['max_plan_steps'])
    }],
    ['an invalid_conflict_resolution warning', (a: PlannerAlternativeRepairArtifact) => {
      a.plannerResult.warnings = [{ kind: 'invalid_conflict_resolution', message: 'fixture' }]
    }],
    ['no final Plan', (a: PlannerAlternativeRepairArtifact) => {
      (a.plannerResult as { plan: ProductionPlan | null }).plan = null
    }],
    ['a lineage whose last decision records other replacements', (a: PlannerAlternativeRepairArtifact) => {
      a.conflictRepairLineage.decisions.at(-1)!.invalidatedRoutes[0].invalidatedRouteKey = 'route.other'
      a.conflictRepairLineage.decisions.at(-1)!.invalidatedRoutes[0].replacementBuildListEntryId = 'build-list.other' as BuildListEntry['id']
    }],
    ['a Plan that still names the replaced O', (a: PlannerAlternativeRepairArtifact) => {
      a.plannerResult.plan.selectedBuildListEntryIds = [...a.plannerResult.plan.selectedBuildListEntryIds, 'build-list.persisted.a' as BuildListEntry['id']]
    }],
  ] as const)('refuses an artifact with %s as planner_result_invalid and writes nothing', (_label, corrupt) =>
    withScenario(async ({ database, service, context, artifact }) => {
      const broken = structuredClone(artifact)
      corrupt(broken)
      const before = await dump(database)
      await expect(service.savePlannerAlternativeRepair(broken, context))
        .rejects.toMatchObject({ code: 'planner_result_invalid' })
      expect(await dump(database)).toEqual(before)
    }))

  it.each([
    ['a replaced record without its replacement', (lineage: PlannerConflictRepairLineage) => {
      lineage.decisions[0].invalidatedRoutes = [{
        targetWeaponId: 'target.fixture.a' as TargetWeapon['id'],
        invalidatedBuildListEntryId: 'build-list.persisted.a' as BuildListEntry['id'],
        invalidatedRouteKey: 'route.key',
        replacementBuildListEntryId: null,
        outcome: 'replaced',
      }]
    }],
    ['an unknown conflictKind literal', (lineage: PlannerConflictRepairLineage) => {
      (lineage.decisions[0] as { conflictKind: string }).conflictKind = 'same_everything'
    }],
  ] as const)('refuses a malformed lineage (%s) through Domain validation and writes nothing', (_label, corrupt) =>
    withScenario(async ({ database, service, context, artifact }) => {
      const broken = structuredClone(artifact)
      corrupt(broken.conflictRepairLineage)
      const before = await dump(database)
      await expect(service.savePlannerAlternativeRepair(broken, context))
        .rejects.toMatchObject({ code: 'validation_failed' })
      expect(await dump(database)).toEqual(before)
    }))

  it('keeps current foreign keys out of the lineage: IDs no current Entry has are saved as audit data', () =>
    withScenario(async ({ database, service, context, artifact }) => {
      // The earlier decision names Entries that are no longer in the Build List.
      artifact.conflictRepairLineage.decisions[0] = {
        conflictKind: 'same_normal_counter',
        fixedBuildListEntryId: 'build-list.long.gone' as BuildListEntry['id'],
        fixedTargetWeaponId: 'target.long.gone' as TargetWeapon['id'],
        invalidatedRoutes: [],
      }
      await service.savePlannerAlternativeRepair(artifact, context)
      const stored = await database.productionPlans.get('plan.alternative.repaired')
      expect(stored?.conflictRepairLineage).toEqual(artifact.conflictRepairLineage)
    }))
})

/**
 * The Plan-breaking guard of a repair save: the replaced O is an Entry the
 * `active` Plan depends on, and a save point with a confirmed Step after it
 * makes the 16.10 choice required.
 */
describe('PlannerResultPersistenceService Planner Alternative repair save and the Plan-breaking guard', () => {
  const SAVE_NOW = '2026-09-26T12:00:00.000Z'
  const GENERATED_ENTRY_ID = 'build-list.alternative.replacement'
  const GENERATED_SOURCE_ID = 'owned.alternative.source'

  interface GuardScenario {
    fixture: ExecutionFixture
    service: PlannerResultPersistenceService
    artifact: PlannerAlternativeRepairArtifact
    replaced: BuildListEntry
    newDraftId: string
    context: CalculationContext
  }

  async function currentInput(database: AppDatabase, fixture: ExecutionFixture): Promise<PlannerInput> {
    return {
      ...structuredClone(fixture.built.input),
      rngState: (await database.rngState.get('current')) as RngState,
      normalCounters: await database.normalArtianCounters.toArray(),
      ownedWeapons: await database.ownedWeapons.toArray(),
      targetWeapons: await database.targetWeapons.toArray(),
      buildListEntries: await database.buildListEntries.toArray(),
      conflictResolutions: [],
    }
  }

  async function guardScenario(database: AppDatabase): Promise<GuardScenario> {
    const fixture = await newNormalFixture(3)
    await seed(database, fixture)
    const execution = executionService(database, fixture.built)
    await execution.startProductionPlan(fixture.plan.id)
    await confirmCurrent(execution, database, fixture.plan)
    await execution.recordExecutionSavePoint({ planId: fixture.plan.id })
    await confirmCurrent(execution, database, fixture.plan)
    await database.ownedWeapons.put(orchestrationSource(GENERATED_SOURCE_ID, { seriesSkillId: IDEAL_SERIES_SKILL_ID }))
    const input = await currentInput(database, fixture)
    const replaced = input.buildListEntries.find(({ id }) => id === fixture.plan.selectedBuildListEntryIds[0]) as BuildListEntry
    const goal = input.targetWeapons.find(({ id }) => id === replaced.targetWeaponId) as TargetWeapon
    const generated = orchestrationEntry(GENERATED_ENTRY_ID, goal, resetRoute(GENERATED_SOURCE_ID))
    synchronizeOrchestrationEntry(input, generated)
    const planned = await createProductionPlan(
      { ...input, buildListEntries: [...input.buildListEntries.filter(({ id }) => id !== replaced.id), generated] },
      fixture.built.dependencies,
    )
    const plan = planned.plan as ProductionPlan
    const replacement: BuildListEntryReplacement = {
      targetWeaponId: replaced.targetWeaponId,
      replacedBuildListEntryId: replaced.id,
      generatedBuildListEntryId: generated.id,
    }
    return {
      fixture,
      service: new PlannerResultPersistenceService(database, undefined, { clock: { now: () => SAVE_NOW } }),
      artifact: {
        plannerResult: { ...planned, plan },
        generatedBuildListEntries: [generated],
        generatedBuildListEntryReplacements: [replacement],
        conflictRepairLineage: {
          decisions: [{
            conflictKind: 'same_skill_counter',
            fixedBuildListEntryId: 'build-list.fixed.other' as BuildListEntry['id'],
            fixedTargetWeaponId: 'target.fixed.other' as TargetWeapon['id'],
            invalidatedRoutes: [{
              targetWeaponId: replaced.targetWeaponId,
              invalidatedBuildListEntryId: replaced.id,
              invalidatedRouteKey: 'route.key.replaced',
              replacementBuildListEntryId: generated.id,
              outcome: 'replaced',
            }],
          }],
        },
      },
      replaced,
      newDraftId: plan.id,
      context: structuredClone(fixture.built.input.calculationContext),
    }
  }

  function approvalOf(
    inspection: PlanBreakingChangeInspection,
    decision: 'keep_current' | 'restore_save_point',
  ): PlanBreakingChangeApproval {
    if (!inspection.approvalRequired || !inspection.savePointChoiceRequired) {
      throw new Error('The save was expected to need the approval with the save point choice.')
    }
    return { observedPlan: inspection.observedPlan, savePointDecision: { kind: decision, recordedAt: inspection.savePointRecordedAt } }
  }

  it('needs the approval for an O the active Plan depends on, and saves nothing without it', () =>
    withDatabase(async (database) => {
      const s = await guardScenario(database)
      const before = await dump(database)
      const inspection = await s.service.inspectPlannerAlternativeRepairSave(s.artifact, s.context)
      expect(inspection).toMatchObject({
        approvalRequired: true,
        reasons: ['build_list_changed'],
        observedPlan: { planId: s.fixture.plan.id, status: 'active' },
        savePointChoiceRequired: true,
      })
      await expect(s.service.savePlannerAlternativeRepair(s.artifact, s.context))
        .rejects.toMatchObject({ code: 'plan_breaking_change_approval_required' })
      expect(await dump(database)).toEqual(before)
    }))

  it('「現在地点を維持」: the replacement, the Draft with its lineage and the Plan abandonment in one transaction', () =>
    withDatabase(async (database) => {
      const s = await guardScenario(database)
      const inspection = await s.service.inspectPlannerAlternativeRepairSave(s.artifact, s.context)
      const outcome = await s.service.savePlannerAlternativeRepair(s.artifact, s.context, approvalOf(inspection, 'keep_current'))

      expect(outcome).toMatchObject({ kind: 'saved', plan: { id: s.newDraftId, status: 'draft' } })
      const ids = (await database.buildListEntries.toArray()).map(({ id }) => id)
      expect(ids).toContain(GENERATED_ENTRY_ID)
      expect(ids).not.toContain(s.replaced.id)
      expect((await database.productionPlans.get(s.newDraftId))?.conflictRepairLineage).toEqual(s.artifact.conflictRepairLineage)
      expect(await currentPlan(database, s.fixture.plan)).toMatchObject({
        status: 'abandoned',
        abandonmentReason: 'breaking_change_approved',
        // The running Plan keeps its own lineage (none) exactly.
        conflictRepairLineage: null,
      })
    }))

  it('「最後のゲーム内セーブ地点へ戻す」: only the restore is written; no Entry, Draft or lineage of the artifact', () =>
    withDatabase(async (database) => {
      const s = await guardScenario(database)
      const inspection = await s.service.inspectPlannerAlternativeRepairSave(s.artifact, s.context)
      const outcome = await s.service.savePlannerAlternativeRepair(s.artifact, s.context, approvalOf(inspection, 'restore_save_point'))

      expect(outcome.kind).toBe('save_point_restored_recalculation_required')
      const ids = (await database.buildListEntries.toArray()).map(({ id }) => id)
      expect(ids).toContain(s.replaced.id)
      expect(ids).not.toContain(GENERATED_ENTRY_ID)
      expect(await database.productionPlans.get(s.newDraftId)).toBeUndefined()
      expect((await currentPlan(database, s.fixture.plan)).status).toBe('active')
    }))
})
