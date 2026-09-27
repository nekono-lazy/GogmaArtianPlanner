import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { AppDatabase } from '../../db/AppDatabase'
import {
  BuildListEntryRepository,
  NormalArtianCounterRepository,
  OwnedWeaponRepository,
  ProductionPlanRepository,
  TargetWeaponRepository,
} from '../../db/repositories'
import type {
  BuildListEntry,
  BuildRoute,
  CalculationContext,
  PlanningInputSnapshot,
  ProductionPlan,
} from '../../domain/models/publicTypes'
import type { PlannerInput, PlannerResult } from '../../domain/planner'
import {
  createPlanningBuildListEntriesHash,
  createPlanningInputSnapshot,
} from '../../domain/planner'
import { createExpectedPlanState } from '../../domain/models/publicTypes'
import {
  DOMAIN_FIXTURE_TIME,
  buildListEntryId,
  createValidBuildCandidate,
  createValidProductionPlan,
  planStepId,
  productionPlanId,
} from '../../test/fixtures/domainData'
import { fixture, routeEntry, sourceWeapon, target } from '../../test/fixtures/plannerBeam'
import {
  PlannerResultPersistenceService,
  createPlannerResultPersistenceRepositories,
  type PlannerResultPersistenceRepositories,
  type PlannerResultSaveOutcome,
} from './plannerResultPersistenceService'
import {
  completedPlannerTermination,
  exhaustedPlannerTermination,
  incompletePlannerTermination,
} from '../../test/fixtures/plannerTermination'

/**
 * The ordinary Planner result save (`savePlannerResult()`, `docs/PLANNER_SPEC.md`
 * 9.2.15, Phase 6-A): the Plan is re-validated against the current state inside
 * the write transaction and replaces the previous Draft; the Build List is read,
 * never written. The replacement-bearing Planner Alternative repair save is
 * covered by `plannerResultPersistenceService.alternative.test.ts` and
 * `plannerResultPersistenceService.savePoint.test.ts`. The legacy B8
 * orchestration save these cases once ran through was removed in Phase 6-B2b.
 */

function normalRoute(): BuildRoute {
  return structuredClone(createValidBuildCandidate().route)
}

function buildPlan(
  snapshot: PlanningInputSnapshot,
  calculationContext: CalculationContext,
  selected: readonly BuildListEntry[],
): ProductionPlan {
  const base = createValidProductionPlan()
  const steps = selected.map((entry, index) => ({
    ...base.steps[0],
    id: planStepId(`step.ordinary.${index}`),
    order: index + 1,
    targetWeaponId: entry.targetWeaponId,
    buildListEntryId: entry.id,
    candidateId: entry.candidateSnapshot.id,
    expectedStateBefore: { ...snapshot.initialExecutionState },
    expectedStateAfter: { ...snapshot.initialExecutionState },
  }))
  return {
    ...base,
    id: productionPlanId('plan.ordinary.a'),
    status: 'draft',
    baseSnapshot: snapshot,
    selectedBuildListEntryIds: selected.map(({ id }) => id),
    calculationContext: { ...calculationContext },
    steps,
    conflicts: [],
    rejectedBuildListEntries: [],
    currentStepId: steps[0].id,
  }
}

interface Scenario {
  database: AppDatabase
  service: PlannerResultPersistenceService
  repositories: PlannerResultPersistenceRepositories
  input: PlannerInput
  snapshot: PlanningInputSnapshot
  context: CalculationContext
  persisted: BuildListEntry[]
  plan: ProductionPlan
  /** The ordinary Planner result over the persisted Build List as it is. */
  result: PlannerResult
  storedEntryIds(): Promise<string[]>
  storedPlanIds(): Promise<string[]>
}

interface ScenarioOptions {
  /** Replaces the repositories the service reads and writes through. */
  createRepositories?: (
    database: AppDatabase,
  ) => PlannerResultPersistenceRepositories
}

/** The stored Plan of a `saved` outcome, `null` for every other outcome. */
function savedPlanOf(outcome: PlannerResultSaveOutcome): ProductionPlan | null {
  return outcome.kind === 'saved' ? outcome.plan : null
}

const PERSISTED_ENTRY_IDS = ['build-list.persisted.a', 'build-list.persisted.b']

let databaseSequence = 0

async function withScenario(
  run: (scenario: Scenario) => Promise<void>,
  options: ScenarioOptions = {},
): Promise<void> {
  databaseSequence += 1
  const name = `planner-result-persistence-${databaseSequence}`
  const database = new AppDatabase(name)
  await database.open()
  try {
    const targetA = target('target.fixture.a')
    const targetB = target('target.fixture.b', 2)
    const persisted = [
      routeEntry('build-list.persisted.a', targetA, normalRoute()),
      routeEntry('build-list.persisted.b', targetB, normalRoute(), 'practical'),
    ]
    const owned = [sourceWeapon('owned.fixture.a'), sourceWeapon('owned.fixture.b')]
    const { input } = fixture([targetA, targetB], persisted, owned)
    const snapshot = createPlanningInputSnapshot(
      input,
      {
        initialExecutionState: createExpectedPlanState(
          input.rngState,
          input.normalCounters,
          input.ownedWeapons,
          {
            targetWeapons: input.targetWeapons,
            dependentTargetWeaponIds: [targetA.id, targetB.id],
          },
        ),
        dependentTargetWeaponIds: [targetA.id, targetB.id],
        selectedBuildListEntryIds: persisted.map(({ id }) => id),
      },
      DOMAIN_FIXTURE_TIME,
    )
    const plan = buildPlan(snapshot, input.calculationContext, persisted)

    const seed = createPlannerResultPersistenceRepositories(database)
    await seed.rngState.putRngState(input.rngState)
    for (const counter of input.normalCounters) {
      await seed.normalCounters.putNormalArtianCounter(counter)
    }
    for (const weapon of input.ownedWeapons) {
      await seed.ownedWeapons.putOwnedWeapon(weapon)
    }
    for (const targetWeapon of input.targetWeapons) {
      await seed.targetWeapons.putTargetWeapon(targetWeapon)
    }
    for (const entry of persisted) {
      await seed.buildListEntries.putBuildListEntry(entry)
    }

    const repositories = options.createRepositories
      ? options.createRepositories(database)
      : createPlannerResultPersistenceRepositories(database)
    await run({
      database,
      service: new PlannerResultPersistenceService(database, repositories),
      repositories,
      input,
      snapshot,
      context: input.calculationContext,
      persisted,
      plan,
      result: { plan, conflicts: [], warnings: [], termination: completedPlannerTermination() },
      storedEntryIds: async () =>
        (await database.buildListEntries.toArray()).map(({ id }) => id).sort(),
      storedPlanIds: async () =>
        (await database.productionPlans.toArray()).map(({ id }) => id).sort(),
    })
  } finally {
    database.close()
    await Dexie.delete(name)
  }
}

function previousDraft(id = 'plan.draft.previous'): ProductionPlan {
  return { ...createValidProductionPlan(), id: productionPlanId(id) }
}

const failOnEntryWrite = () => {
  throw new Error('An ordinary Planner result save must not write the Build List.')
}

describe('PlannerResultPersistenceService ordinary Planner result (Phase 6-A, PLANNER_SPEC 9.2.15)', () => {
  it('saves the ordinary result as the new Draft, replacing the previous one, and never writes the Build List', () =>
    withScenario(async ({ service, result, context, database, plan, storedPlanIds }) => {
      await database.productionPlans.put(previousDraft())
      const entriesBefore = await database.buildListEntries.toArray()
      database.buildListEntries.hook('creating', failOnEntryWrite)
      database.buildListEntries.hook('updating', failOnEntryWrite)
      database.buildListEntries.hook('deleting', failOnEntryWrite)

      const saved = await service.savePlannerResult(result, context)

      expect(saved).toEqual({ kind: 'saved', plan })
      expect(await database.productionPlans.get(plan.id)).toEqual(plan)
      expect(plan.conflictRepairLineage).toBeNull()
      expect(await storedPlanIds()).toEqual([plan.id])
      expect(await database.buildListEntries.toArray()).toEqual(entriesBefore)
    }))

  it('returns no_plan for a finished run without a Plan and keeps the previous Draft', () =>
    withScenario(async ({ service, context, database, storedEntryIds, storedPlanIds }) => {
      await database.productionPlans.put(previousDraft())

      const saved = await service.savePlannerResult(
        { plan: null, conflicts: [], warnings: [], termination: exhaustedPlannerTermination() },
        context,
      )

      expect(saved).toEqual({ kind: 'no_plan' })
      expect(await storedPlanIds()).toEqual(['plan.draft.previous'])
      expect(await storedEntryIds()).toEqual(PERSISTED_ENTRY_IDS)
    }))

  it.each([
    ['with its partial Plan', true],
    ['without a Plan', false],
  ])('refuses an incomplete run %s and writes nothing', (_label, withPlan) =>
    withScenario(async ({ service, result, context, database, storedEntryIds, storedPlanIds }) => {
      await database.productionPlans.put(previousDraft())

      await expect(service.savePlannerResult(
        {
          ...result,
          plan: withPlan ? result.plan : null,
          termination: incompletePlannerTermination(['max_plan_steps'], {
            expandedStates: 1_000,
            completedTargetCount: 1,
            totalTargetCount: 2,
          }),
        },
        context,
      )).rejects.toMatchObject({
        code: 'planner_result_invalid',
        message: expect.stringContaining('The Planner run did not complete: it reached max_plan_steps'),
      })
      expect(await storedPlanIds()).toEqual(['plan.draft.previous'])
      expect(await storedEntryIds()).toEqual(PERSISTED_ENTRY_IDS)
    }))

  it('saves a completed search that happened to touch a bound', () =>
    withScenario(async ({ service, context, plan, result, storedPlanIds }) => {
      // The reached bound is a diagnostic here, not a truncation: the last
      // affordable action was the one that completed the run.
      const saved = await service.savePlannerResult(
        {
          ...result,
          warnings: [{
            kind: 'max_steps_reached',
            message: 'Planner reached maxPlanSteps (1000).',
          }],
          termination: completedPlannerTermination({
            reachedLimits: ['max_plan_steps'],
            expandedStates: 1_000,
            completedTargetCount: 2,
            totalTargetCount: 2,
          }),
        },
        context,
      )
      expect(savedPlanOf(saved)?.id).toBe(plan.id)
      expect(await storedPlanIds()).toEqual([plan.id])
    }))

  it('saves a search that ended on its own without completing every Target', () =>
    withScenario(async ({ service, context, plan, result, storedPlanIds }) => {
      // Normal exhaustion keeps its existing meaning: this is the best Plan
      // the input allows, not a truncated search.
      const saved = await service.savePlannerResult(
        {
          ...result,
          termination: exhaustedPlannerTermination({
            completedTargetCount: 1,
            totalTargetCount: 2,
          }),
        },
        context,
      )
      expect(savedPlanOf(saved)?.id).toBe(plan.id)
      expect(await storedPlanIds()).toEqual([plan.id])
    }))

  it.each([
    ['a non-draft Plan', (plan: ProductionPlan): ProductionPlan => ({ ...plan, status: 'active' }), 'planner_result_invalid'],
    [
      'a Plan carrying a repair lineage',
      (plan: ProductionPlan): ProductionPlan => ({ ...plan, conflictRepairLineage: { decisions: [] } }),
      'planner_result_invalid',
    ],
    ['a Domain-invalid Plan', (plan: ProductionPlan): ProductionPlan => ({ ...plan, id: productionPlanId('') }), 'validation_failed'],
    [
      'a Plan naming an Entry outside the current Build List',
      (plan: ProductionPlan): ProductionPlan => ({
        ...plan,
        selectedBuildListEntryIds: [...plan.selectedBuildListEntryIds, buildListEntryId('build-list.missing')],
      }),
      'planner_result_invalid',
    ],
    [
      'a PlanStep whose candidateId differs from the Entry Snapshot',
      (plan: ProductionPlan): ProductionPlan => ({
        ...plan,
        steps: plan.steps.map((step, index) =>
          index === 0 ? { ...step, candidateId: createValidBuildCandidate().id } : step,
        ),
      }),
      'planner_result_invalid',
    ],
  ] as const)('refuses %s and writes nothing', (_label, patch, code) =>
    withScenario(async ({ service, result, context, database, storedEntryIds, storedPlanIds }) => {
      await database.productionPlans.put(previousDraft())

      await expect(service.savePlannerResult({ ...result, plan: patch(result.plan as ProductionPlan) }, context))
        .rejects.toMatchObject({ code })
      expect(await storedPlanIds()).toEqual(['plan.draft.previous'])
      expect(await storedEntryIds()).toEqual(PERSISTED_ENTRY_IDS)
    }))

  it('refuses a new Plan ID that is already stored before any Draft is deleted', () =>
    withScenario(async ({ service, result, context, database, plan }) => {
      const previous = previousDraft()
      await database.productionPlans.put(previous)
      const taken: ProductionPlan = {
        ...previous,
        id: plan.id,
        status: 'completed',
        completedAt: DOMAIN_FIXTURE_TIME,
        currentStepId: null,
        steps: previous.steps.map((step) => ({ ...step, isCompleted: true, completedAt: DOMAIN_FIXTURE_TIME })),
      }
      await database.productionPlans.put(taken)

      await expect(service.savePlannerResult(result, context)).rejects.toMatchObject({ code: 'production_plan_id_conflict' })
      expect(await database.productionPlans.get(previous.id)).toEqual(previous)
      expect(await database.productionPlans.get(plan.id)).toEqual(taken)
    }))

  it('saves beside an active Plan without an approval and leaves that Plan untouched', () =>
    withScenario(async ({ service, result, context, database, plan, persisted }) => {
      const active: ProductionPlan = {
        ...buildPlan(plan.baseSnapshot, plan.calculationContext, persisted),
        id: productionPlanId('plan.running.p1'),
        status: 'active',
      }
      await database.productionPlans.put(active)

      const saved = await service.savePlannerResult(result, context)

      expect(saved).toEqual({ kind: 'saved', plan })
      expect(await database.productionPlans.get(active.id)).toEqual(active)
      // An ordinary result replaces no Entry, so an approval never applies.
      await database.productionPlans.delete(plan.id)
      await expect(service.savePlannerResult(result, context, {
        observedPlan: { planId: active.id, status: 'active', currentStepId: active.currentStepId, updatedAt: active.updatedAt },
        savePointDecision: null,
      })).rejects.toMatchObject({ code: 'plan_breaking_change_approval_not_required' })
      expect(await database.productionPlans.get(active.id)).toEqual(active)
    }))
})

/**
 * Current state re-validation (`docs/PLANNER_SPEC.md` 9.2.15): the save reads
 * the current state inside its write transaction and compares it with the
 * Plan's own `PlanningInputSnapshot` through the existing snapshot authorities.
 */
describe('PlannerResultPersistenceService current state re-validation', () => {
  it('rejects the save when the current RngState changed', () =>
    withScenario(async ({ service, result, context, input, repositories, storedEntryIds, storedPlanIds }) => {
      await repositories.rngState.putRngState({
        ...input.rngState,
        gogmaCounter: { value: 99, isConfirmed: true, source: 'manual' },
      })
      await expect(service.savePlannerResult(result, context)).rejects.toMatchObject({ code: 'planner_state_changed' })
      expect(await storedEntryIds()).toEqual(PERSISTED_ENTRY_IDS)
      expect(await storedPlanIds()).toEqual([])
    }))

  it('rejects the save when a Normal Artian counter changed', () =>
    withScenario(async ({ service, result, context, input, repositories, storedPlanIds }) => {
      await repositories.normalCounters.putNormalArtianCounter({
        ...input.normalCounters[0],
        counter: (input.normalCounters[0].counter ?? 0) + 1,
      })
      await expect(service.savePlannerResult(result, context)).rejects.toMatchObject({ code: 'planner_state_changed' })
      expect(await storedPlanIds()).toEqual([])
    }))

  it('rejects the save when an OwnedWeapon changed semantically', () =>
    withScenario(async ({ service, result, context, input, repositories, storedPlanIds }) => {
      await repositories.ownedWeapons.putOwnedWeapon({
        ...input.ownedWeapons[0],
        isProtected: !input.ownedWeapons[0].isProtected,
      })
      await expect(service.savePlannerResult(result, context)).rejects.toMatchObject({ code: 'planner_state_changed' })
      expect(await storedPlanIds()).toEqual([])
    }))

  it('rejects the save when only the Plan-dependent Target execution state differs', () =>
    withScenario(async ({ service, result, context, plan, storedEntryIds, storedPlanIds }) => {
      // Current RngState, Normal Counters, OwnedWeapons and TargetWeapons are
      // untouched, so the RNG / Normal / OwnedWeapon hashes and the whole
      // TargetWeapons hash all still match: only the fourth ExpectedPlanState
      // component differs (DATA_MODEL 11.2).
      const initial = plan.baseSnapshot.initialExecutionState
      const altered = structuredClone(result)
      if (!altered.plan) throw new Error('Expected a Plan')
      altered.plan.baseSnapshot.initialExecutionState = {
        ...initial,
        targetExecutionStateHash: 'fnv1a32:ffffffff',
      }
      altered.plan.steps.forEach((step) => {
        step.expectedStateBefore = { ...altered.plan!.baseSnapshot.initialExecutionState }
        step.expectedStateAfter = { ...altered.plan!.baseSnapshot.initialExecutionState }
      })
      expect(initial.targetExecutionStateHash).not.toBe('fnv1a32:ffffffff')
      await expect(service.savePlannerResult(altered, context)).rejects.toMatchObject({ code: 'planner_state_changed' })
      expect(await storedPlanIds()).toEqual([])
      expect(await storedEntryIds()).toEqual(PERSISTED_ENTRY_IDS)
    }))

  it('rejects the save when a TargetWeapon changed semantically', () =>
    withScenario(async ({ service, result, context, input, repositories, storedPlanIds }) => {
      await repositories.targetWeapons.putTargetWeapon({
        ...input.targetWeapons[1],
        priority: 5,
      })
      await expect(service.savePlannerResult(result, context)).rejects.toMatchObject({ code: 'planner_state_changed' })
      expect(await storedPlanIds()).toEqual([])
    }))

  it('rejects the save when the persisted BuildListEntry set changed', () =>
    withScenario(async ({ service, result, context, persisted, repositories, storedPlanIds }) => {
      await repositories.buildListEntries.deleteBuildListEntry(persisted[1].id)
      await expect(service.savePlannerResult(result, context)).rejects.toMatchObject({ code: 'planner_state_changed' })
      expect(await storedPlanIds()).toEqual([])
    }))

  it('rejects the save when the current CalculationContext changed', () =>
    withScenario(async ({ service, result, context, storedEntryIds, storedPlanIds }) => {
      await expect(
        service.savePlannerResult(result, {
          ...context,
          masterDataVersion: context.masterDataVersion + 1,
        }),
      ).rejects.toMatchObject({ code: 'planner_state_changed' })
      expect(await storedEntryIds()).toEqual(PERSISTED_ENTRY_IDS)
      expect(await storedPlanIds()).toEqual([])
    }))

  it('fails closed instead of creating an initial RngState at save time', () =>
    withScenario(async ({ service, result, context, database, storedEntryIds, storedPlanIds }) => {
      await database.rngState.clear()
      await expect(service.savePlannerResult(result, context)).rejects.toMatchObject({ code: 'planner_state_changed' })
      expect(await database.rngState.count()).toBe(0)
      expect(await storedEntryIds()).toEqual(PERSISTED_ENTRY_IDS)
      expect(await storedPlanIds()).toEqual([])
    }))

  it('does not treat a different current array order as a state change', () =>
    withScenario(
      async ({ service, result, context, persisted, plan, storedEntryIds, storedPlanIds }) => {
        // The Build List hash the save compares is order independent.
        expect(createPlanningBuildListEntriesHash([...persisted].reverse()))
          .toBe(createPlanningBuildListEntriesHash(persisted))
        expect(createPlanningBuildListEntriesHash(persisted))
          .toBe(plan.baseSnapshot.buildListEntriesHash)
        const saved = await service.savePlannerResult(result, context)
        expect(saved.kind).toBe('saved')
        expect(await storedEntryIds()).toEqual(PERSISTED_ENTRY_IDS)
        expect(await storedPlanIds()).toEqual([plan.id])
      },
      {
        createRepositories: (database) => {
          class ReversedNormalCounters extends NormalArtianCounterRepository {
            async getAllNormalArtianCounters() {
              return (await super.getAllNormalArtianCounters()).reverse()
            }
          }
          class ReversedOwnedWeapons extends OwnedWeaponRepository {
            async getAllOwnedWeapons() {
              return (await super.getAllOwnedWeapons()).reverse()
            }
          }
          class ReversedTargetWeapons extends TargetWeaponRepository {
            async getAllTargetWeapons() {
              return (await super.getAllTargetWeapons()).reverse()
            }
          }
          class ReversedBuildListEntries extends BuildListEntryRepository {
            async getAllBuildListEntries() {
              return (await super.getAllBuildListEntries()).reverse()
            }
          }
          return {
            ...createPlannerResultPersistenceRepositories(database),
            normalCounters: new ReversedNormalCounters(database),
            ownedWeapons: new ReversedOwnedWeapons(database),
            targetWeapons: new ReversedTargetWeapons(database),
            buildListEntries: new ReversedBuildListEntries(database),
          }
        },
      },
    ))
})

describe('PlannerResultPersistenceService Draft replacement (DATA_MODEL 11.1 / PLANNER_SPEC 9.2.15)', () => {
  function terminalPlan(id: string, status: 'completed' | 'abandoned'): ProductionPlan {
    const base = createValidProductionPlan()
    return {
      ...base,
      id: productionPlanId(id),
      status,
      abandonmentReason: status === 'abandoned' ? 'user_abandoned' : null,
      abandonedAt: status === 'abandoned' ? DOMAIN_FIXTURE_TIME : null,
      completedAt: status === 'completed' ? DOMAIN_FIXTURE_TIME : null,
      currentStepId: status === 'completed' ? null : base.currentStepId,
      steps: status === 'completed'
        ? base.steps.map((step) => ({ ...step, isCompleted: true, completedAt: DOMAIN_FIXTURE_TIME }))
        : base.steps,
    }
  }

  it('A: replaces the previous Draft with the new one', () =>
    withScenario(async ({ service, result, context, database, plan, storedEntryIds, storedPlanIds }) => {
      const previous = previousDraft()
      await database.productionPlans.put(previous)

      const saved = await service.savePlannerResult(result, context)

      expect(savedPlanOf(saved)?.id).toBe(plan.id)
      expect(savedPlanOf(saved)?.status).toBe('draft')
      expect(await storedPlanIds()).toEqual([plan.id])
      expect(await database.productionPlans.get(previous.id)).toBeUndefined()
      expect(await storedEntryIds()).toEqual(PERSISTED_ENTRY_IDS)
    }))

  it('B: replaces every accumulated legacy Draft inside the one transaction', () =>
    withScenario(async ({ service, result, context, database, plan, storedPlanIds }) => {
      // A state the v8 upgrade removes and the repository refuses to create;
      // seeded around the repository to prove the replacement clears it whole.
      await database.productionPlans.bulkPut([previousDraft('plan.draft.a'), previousDraft('plan.draft.b'), previousDraft('plan.draft.c')])

      await service.savePlannerResult(result, context)

      expect(await storedPlanIds()).toEqual([plan.id])
      expect(await database.productionPlans.where('status').equals('draft').count()).toBe(1)
    }))

  it('C: keeps the previous Draft when the save-time validation refuses the result', () =>
    withScenario(async ({ service, result, database, storedEntryIds, storedPlanIds }) => {
      const previous = previousDraft()
      await database.productionPlans.put(previous)

      await expect(
        service.savePlannerResult(result, { ...result.plan!.calculationContext, rngEngineVersion: 'other-engine' }),
      ).rejects.toMatchObject({ code: 'planner_state_changed' })

      expect(await storedPlanIds()).toEqual(['plan.draft.previous'])
      expect(await database.productionPlans.get(previous.id)).toEqual(previous)
      expect(await storedEntryIds()).toEqual(PERSISTED_ENTRY_IDS)
    }))

  describe('E / G: a stored Plan already holding the new Plan ID is refused before any Draft is deleted', () => {
    type Status = ProductionPlan['status']

    function storedPlan(id: ProductionPlan['id'], status: Status): ProductionPlan {
      const base = createValidProductionPlan()
      return {
        ...base,
        id,
        status,
        abandonmentReason: status === 'abandoned' ? 'user_abandoned' : null,
        abandonedAt: status === 'abandoned' ? DOMAIN_FIXTURE_TIME : null,
        completedAt: status === 'completed' ? DOMAIN_FIXTURE_TIME : null,
        recalculationReasons: status === 'stale' ? ['rng_state_changed'] : [],
        currentStepId: status === 'completed' ? null : base.currentStepId,
        steps: status === 'completed'
          ? base.steps.map((step) => ({ ...step, isCompleted: true, completedAt: DOMAIN_FIXTURE_TIME }))
          : base.steps,
      }
    }

    /** Counts the Draft deletions the save attempts, so "refused before deleting" is observable, not inferred from a rollback. */
    function countingRepositories(deletions: { count: number }) {
      return (database: AppDatabase): PlannerResultPersistenceRepositories => {
        class CountingProductionPlanRepository extends ProductionPlanRepository {
          override async deleteDraftProductionPlans() {
            deletions.count += 1
            return super.deleteDraftProductionPlans()
          }
        }
        return {
          ...createPlannerResultPersistenceRepositories(database),
          productionPlans: new CountingProductionPlanRepository(database),
        }
      }
    }

    // G is the `draft` row: the previous Draft itself holds the new Plan's ID.
    // The Draft replacement replaces the Draft *record*; a result carrying the
    // same ID is not the same Plan and is never accepted by deleting and
    // re-adding under that key. The other rows keep the existing non-Draft
    // collision refusals.
    it.each<Status>(['draft', 'active', 'stale', 'completed', 'abandoned'])(
      'refuses a new Plan whose ID a %s Plan already holds, keeping every Plan and Entry and deleting no Draft',
      async (status) => {
        const deletions = { count: 0 }
        await withScenario(
          async ({ service, result, context, database, plan, storedEntryIds }) => {
            const colliding = storedPlan(plan.id, status)
            const previous = status === 'draft' ? colliding : previousDraft()
            await database.productionPlans.bulkPut(status === 'draft' ? [colliding] : [previous, colliding])
            const plansBefore = await database.productionPlans.orderBy('id').toArray()

            await expect(
              service.savePlannerResult(result, context),
            ).rejects.toMatchObject({ name: 'RepositoryError', code: 'production_plan_id_conflict' })

            // Refused before the replacement: no Draft deletion was even attempted.
            expect(deletions.count).toBe(0)
            expect(await database.productionPlans.orderBy('id').toArray()).toEqual(plansBefore)
            expect(await database.productionPlans.get(previous.id)).toEqual(previous)
            expect(await database.productionPlans.get(plan.id)).toEqual(colliding)
            expect(await storedEntryIds()).toEqual(PERSISTED_ENTRY_IDS)
          },
          { createRepositories: countingRepositories(deletions) },
        )
      },
    )

    it('still replaces a previous Draft under a different ID through the same counted path', async () => {
      const deletions = { count: 0 }
      await withScenario(
        async ({ service, result, context, database, plan, storedPlanIds }) => {
          await database.productionPlans.put(previousDraft())
          await service.savePlannerResult(result, context)
          expect(deletions.count).toBe(1)
          expect(await storedPlanIds()).toEqual([plan.id])
        },
        { createRepositories: countingRepositories(deletions) },
      )
    })
  })

  it('F: deletes only Drafts - completed and abandoned Plans survive the replacement', () =>
    withScenario(async ({ service, result, context, database, plan, storedPlanIds }) => {
      const completed = terminalPlan('plan.done.completed', 'completed')
      const abandoned = terminalPlan('plan.done.abandoned', 'abandoned')
      await database.productionPlans.bulkPut([previousDraft(), completed, abandoned])

      await service.savePlannerResult(result, context)

      expect(await storedPlanIds()).toEqual(['plan.done.abandoned', 'plan.done.completed', plan.id].sort())
      expect(await database.productionPlans.get(completed.id)).toEqual(completed)
      expect(await database.productionPlans.get(abandoned.id)).toEqual(abandoned)
    }))

  it('never cascades the Entries the previous Draft referenced', () =>
    withScenario(async ({ service, result, context, database, storedEntryIds, persisted }) => {
      // The previous Draft names a persisted Entry of the scenario; the
      // replacement deletes the Draft record only.
      const previous = {
        ...previousDraft(),
        selectedBuildListEntryIds: [persisted[1].id],
        steps: createValidProductionPlan().steps.map((step) => ({ ...step, buildListEntryId: persisted[1].id, targetWeaponId: persisted[1].targetWeaponId })),
      }
      await database.productionPlans.put(previous)

      await service.savePlannerResult(result, context)

      expect(await storedEntryIds()).toEqual(PERSISTED_ENTRY_IDS)
      expect(await database.buildListEntries.get(persisted[1].id)).toEqual(persisted[1])
    }))
})
