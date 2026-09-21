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
import type {
  PlannerInput,
  PlannerOrchestrationResult,
} from '../../domain/planner'
import { createPlanningInputSnapshot } from '../../domain/planner'
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
} from './plannerResultPersistenceService'
import {
  completedPlannerTermination,
  exhaustedPlannerTermination,
  incompletePlannerTermination,
} from '../../test/fixtures/plannerTermination'

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
    id: planStepId(`step.b8d2a.${index}`),
    order: index + 1,
    targetWeaponId: entry.targetWeaponId,
    buildListEntryId: entry.id,
    candidateId: entry.candidateSnapshot.id,
    expectedStateBefore: { ...snapshot.initialExecutionState },
    expectedStateAfter: { ...snapshot.initialExecutionState },
  }))
  return {
    ...base,
    id: productionPlanId('plan.b8d2a.a'),
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
  generated: BuildListEntry[]
  plan: ProductionPlan
  result: PlannerOrchestrationResult
  storedEntryIds(): Promise<string[]>
  storedPlanIds(): Promise<string[]>
}

interface ScenarioOptions {
  generatedCount?: number
  /** Applied before the Plan snapshot is built, so the snapshot stays consistent. */
  adjustGenerated?: (entries: BuildListEntry[]) => void
  /** Replaces the repositories the service reads and writes through. */
  createRepositories?: (
    database: AppDatabase,
  ) => PlannerResultPersistenceRepositories
}

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
    const generated = Array.from(
      { length: options.generatedCount ?? 1 },
      (_unused, index) =>
        routeEntry(`build-list.generated.${index}`, targetA, normalRoute()),
    )
    const owned = [sourceWeapon('owned.fixture.a'), sourceWeapon('owned.fixture.b')]
    const { input } = fixture([targetA, targetB], [...persisted, ...generated], owned)
    options.adjustGenerated?.(generated)
    const selected = [...persisted, ...generated]
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
        selectedBuildListEntryIds: selected.map(({ id }) => id),
      },
      DOMAIN_FIXTURE_TIME,
    )
    const plan = buildPlan(snapshot, input.calculationContext, [
      ...persisted,
      ...generated,
    ])

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
      generated,
      plan,
      result: {
        plan,
        conflicts: [],
        warnings: [],
        termination: completedPlannerTermination(),
        generatedBuildListEntries: generated,
      },
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

describe('PlannerResultPersistenceService', () => {
  it('writes nothing and returns null when the Planner produced no Plan', () =>
    withScenario(async ({ service, context, storedEntryIds, storedPlanIds }) => {
      const saved = await service.savePlannerOrchestrationResult(
        {
          plan: null,
          conflicts: [],
          warnings: [],
          termination: exhaustedPlannerTermination(),
          generatedBuildListEntries: [],
        },
        context,
      )
      expect(saved).toBeNull()
      expect(await storedEntryIds()).toEqual([
        'build-list.persisted.a',
        'build-list.persisted.b',
      ])
      expect(await storedPlanIds()).toEqual([])
    }))

  it('refuses a Plan whose Beam Search a PlannerOptions bound truncated', () =>
    withScenario(
      async ({ service, context, result, storedEntryIds, storedPlanIds }) => {
        // PLANNER_SPEC 7.2.1: an incomplete search's best state is a partial
        // Beam Search artifact, so it never becomes an executable Draft. The
        // typed termination is the authority, never a warning message.
        await expect(
          service.savePlannerOrchestrationResult(
            {
              ...result,
              termination: incompletePlannerTermination(['max_expanded_states'], {
                expandedStates: 10_000,
                completedTargetCount: 1,
                totalTargetCount: 2,
              }),
            },
            context,
          ),
        ).rejects.toMatchObject({ code: 'planner_result_invalid' })
        // Nothing is salvaged: not the Plan, and not its generated Entries.
        expect(await storedEntryIds()).toEqual([
          'build-list.persisted.a',
          'build-list.persisted.b',
        ])
        expect(await storedPlanIds()).toEqual([])
      },
    ))

  it('refuses a truncated search that reached the maxPlanSteps bound too', () =>
    withScenario(async ({ service, context, result, storedPlanIds }) => {
      await expect(
        service.savePlannerOrchestrationResult(
          {
            ...result,
            termination: incompletePlannerTermination(['max_plan_steps']),
          },
          context,
        ),
      ).rejects.toMatchObject({ code: 'planner_result_invalid' })
      expect(await storedPlanIds()).toEqual([])
    }))

  it('saves a completed search that happened to touch a bound', () =>
    withScenario(async ({ service, context, plan, result, storedPlanIds }) => {
      // The reached bound is a diagnostic here, not a truncation: the last
      // affordable expansion was the one that completed the search.
      const saved = await service.savePlannerOrchestrationResult(
        {
          ...result,
          warnings: [{
            kind: 'max_expanded_states_reached',
            message: 'Planner reached maxExpandedStates (10000).',
          }],
          termination: completedPlannerTermination({
            reachedLimits: ['max_expanded_states'],
            expandedStates: 10_000,
            completedTargetCount: 2,
            totalTargetCount: 2,
          }),
        },
        context,
      )
      expect(saved?.id).toBe(plan.id)
      expect(await storedPlanIds()).toEqual([plan.id])
    }))

  it('saves a search that ended on its own without completing every Target', () =>
    withScenario(async ({ service, context, plan, result, storedPlanIds }) => {
      // Normal exhaustion keeps its existing meaning: this is the best Plan
      // the input allows, not a truncated search.
      const saved = await service.savePlannerOrchestrationResult(
        {
          ...result,
          termination: exhaustedPlannerTermination({
            completedTargetCount: 1,
            totalTargetCount: 2,
          }),
        },
        context,
      )
      expect(saved?.id).toBe(plan.id)
      expect(await storedPlanIds()).toEqual([plan.id])
    }))

  it('fails closed when a null Plan still carries generated Entries', () =>
    withScenario(
      async ({ service, context, generated, storedEntryIds, storedPlanIds }) => {
        await expect(
          service.savePlannerOrchestrationResult(
            {
              plan: null,
              conflicts: [],
              warnings: [],
              termination: completedPlannerTermination(),
              generatedBuildListEntries: generated,
            },
            context,
          ),
        ).rejects.toMatchObject({ code: 'planner_result_invalid' })
        expect(await storedEntryIds()).toEqual([
          'build-list.persisted.a',
          'build-list.persisted.b',
        ])
        expect(await storedPlanIds()).toEqual([])
      },
    ))

  it('saves the generated Entries and the Plan together', () =>
    withScenario(
      async ({ service, result, context, plan, storedEntryIds, storedPlanIds }) => {
        const saved = await service.savePlannerOrchestrationResult(result, context)
        expect(saved?.id).toBe(plan.id)
        expect(await storedEntryIds()).toEqual([
          'build-list.generated.0',
          'build-list.persisted.a',
          'build-list.persisted.b',
        ])
        expect(await storedPlanIds()).toEqual(['plan.b8d2a.a'])
      },
    ))

  it('never writes a generated Candidate into the BuildCandidate table', () =>
    withScenario(async ({ service, result, context, database }) => {
      await service.savePlannerOrchestrationResult(result, context)
      expect(await database.buildCandidates.count()).toBe(0)
    }))

  it('saves a bound-limited partial Plan whose snapshot still matches', () =>
    withScenario(async ({ service, result, context, storedPlanIds }) => {
      const saved = await service.savePlannerOrchestrationResult(
        {
          ...result,
          warnings: [
            {
              kind: 'max_planner_reruns_reached',
              message: 'Fixture partial Plan.',
            },
          ],
        },
        context,
      )
      expect(saved).not.toBeNull()
      expect(await storedPlanIds()).toEqual(['plan.b8d2a.a'])
    }))

  it('rejects the save when the current RngState changed', () =>
    withScenario(
      async ({ service, result, context, input, repositories, storedEntryIds, storedPlanIds }) => {
        await repositories.rngState.putRngState({
          ...input.rngState,
          gogmaCounter: { value: 99, isConfirmed: true, source: 'manual' },
        })
        await expect(
          service.savePlannerOrchestrationResult(result, context),
        ).rejects.toMatchObject({ code: 'planner_state_changed' })
        expect(await storedEntryIds()).toEqual([
          'build-list.persisted.a',
          'build-list.persisted.b',
        ])
        expect(await storedPlanIds()).toEqual([])
      },
    ))

  it('rejects the save when a Normal Artian counter changed', () =>
    withScenario(
      async ({ service, result, context, input, repositories, storedEntryIds, storedPlanIds }) => {
        await repositories.normalCounters.putNormalArtianCounter({
          ...input.normalCounters[0],
          counter: (input.normalCounters[0].counter ?? 0) + 1,
        })
        await expect(
          service.savePlannerOrchestrationResult(result, context),
        ).rejects.toMatchObject({ code: 'planner_state_changed' })
        expect(await storedEntryIds()).toEqual([
          'build-list.persisted.a',
          'build-list.persisted.b',
        ])
        expect(await storedPlanIds()).toEqual([])
      },
    ))

  it('rejects the save when an OwnedWeapon changed semantically', () =>
    withScenario(
      async ({ service, result, context, input, repositories, storedPlanIds }) => {
        await repositories.ownedWeapons.putOwnedWeapon({
          ...input.ownedWeapons[0],
          isProtected: !input.ownedWeapons[0].isProtected,
        })
        await expect(
          service.savePlannerOrchestrationResult(result, context),
        ).rejects.toMatchObject({ code: 'planner_state_changed' })
        expect(await storedPlanIds()).toEqual([])
      },
    ))

  it('rejects the save when only the Plan-dependent Target execution state differs', () =>
    withScenario(
      async ({ service, result, context, plan, storedEntryIds, storedPlanIds }) => {
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
        await expect(
          service.savePlannerOrchestrationResult(altered, context),
        ).rejects.toMatchObject({ code: 'planner_state_changed' })
        // Nothing of the transaction survives: no Plan and no generated Entry.
        expect(await storedPlanIds()).toEqual([])
        expect(await storedEntryIds()).toEqual([
          'build-list.persisted.a',
          'build-list.persisted.b',
        ])
      },
    ))

  it('rejects the save when a TargetWeapon changed semantically', () =>
    withScenario(
      async ({ service, result, context, input, repositories, storedPlanIds }) => {
        await repositories.targetWeapons.putTargetWeapon({
          ...input.targetWeapons[1],
          priority: 5,
        })
        await expect(
          service.savePlannerOrchestrationResult(result, context),
        ).rejects.toMatchObject({ code: 'planner_state_changed' })
        expect(await storedPlanIds()).toEqual([])
      },
    ))

  it('rejects the save when the persisted BuildListEntry set changed', () =>
    withScenario(
      async ({ service, result, context, persisted, repositories, storedPlanIds }) => {
        await repositories.buildListEntries.deleteBuildListEntry(persisted[1].id)
        await expect(
          service.savePlannerOrchestrationResult(result, context),
        ).rejects.toMatchObject({ code: 'planner_state_changed' })
        expect(await storedPlanIds()).toEqual([])
      },
    ))

  it('rejects the save when the current CalculationContext changed', () =>
    withScenario(async ({ service, result, context, storedEntryIds, storedPlanIds }) => {
      await expect(
        service.savePlannerOrchestrationResult(result, {
          ...context,
          masterDataVersion: context.masterDataVersion + 1,
        }),
      ).rejects.toMatchObject({ code: 'planner_state_changed' })
      expect(await storedEntryIds()).toEqual([
        'build-list.persisted.a',
        'build-list.persisted.b',
      ])
      expect(await storedPlanIds()).toEqual([])
    }))

  it('recomputes generated Entry staleness instead of trusting its stored flags', () =>
    withScenario(
      async ({ service, result, context, storedEntryIds, storedPlanIds }) => {
        await expect(
          service.savePlannerOrchestrationResult(result, context),
        ).rejects.toMatchObject({
          code: 'planner_state_changed',
          message: expect.stringContaining('rng_state_changed'),
        })
        expect(await storedEntryIds()).toEqual([
          'build-list.persisted.a',
          'build-list.persisted.b',
        ])
        expect(await storedPlanIds()).toEqual([])
      },
      {
        adjustGenerated: (entries) => {
          // The Entry still claims `isStale: false`, but its own Search hash no
          // longer matches its route against current RNG state.
          entries[0].searchStateHash = 'hash.fixture.divergent-search-state'
          entries[0].candidateSnapshot.searchStateHash =
            entries[0].searchStateHash
        },
      },
    ))

  it('never reuses or overwrites an existing Entry that holds a generated ID', () =>
    withScenario(
      async ({ service, result, context, generated, repositories, storedEntryIds, storedPlanIds }) => {
        await repositories.buildListEntries.putBuildListEntry(generated[0])
        await expect(
          service.savePlannerOrchestrationResult(result, context),
        ).rejects.toMatchObject({
          code: 'planner_state_changed',
          message: expect.stringContaining('already exists in persistence'),
        })
        expect(await storedEntryIds()).toEqual([
          'build-list.generated.0',
          'build-list.persisted.a',
          'build-list.persisted.b',
        ])
        expect(await storedPlanIds()).toEqual([])
      },
    ))

  it('rejects a generated Entry the final Plan does not select', () =>
    withScenario(
      async ({ service, result, context, plan, generated, storedEntryIds, storedPlanIds }) => {
        const generatedIds = new Set(generated.map(({ id }) => id))
        await expect(
          service.savePlannerOrchestrationResult(
            {
              ...result,
              plan: {
                ...plan,
                selectedBuildListEntryIds: plan.selectedBuildListEntryIds.filter(
                  (id) => !generatedIds.has(id),
                ),
                steps: plan.steps
                  .filter(({ buildListEntryId: id }) =>
                    id === null ? true : !generatedIds.has(id),
                  )
                  .map((step, index) => ({ ...step, order: index + 1 })),
              },
            },
            context,
          ),
        ).rejects.toMatchObject({ code: 'planner_result_invalid' })
        expect(await storedEntryIds()).toEqual([
          'build-list.persisted.a',
          'build-list.persisted.b',
        ])
        expect(await storedPlanIds()).toEqual([])
      },
    ))

  it('rejects a Plan that references a BuildListEntry outside the final set', () =>
    withScenario(async ({ service, result, context, plan, storedPlanIds }) => {
      await expect(
        service.savePlannerOrchestrationResult(
          {
            ...result,
            plan: {
              ...plan,
              selectedBuildListEntryIds: [
                ...plan.selectedBuildListEntryIds,
                buildListEntryId('build-list.missing.a'),
              ],
            },
          },
          context,
        ),
      ).rejects.toMatchObject({ code: 'planner_result_invalid' })
      expect(await storedPlanIds()).toEqual([])
    }))

  it('rejects a PlanStep whose candidateId differs from the Entry Snapshot', () =>
    withScenario(async ({ service, result, context, plan, storedPlanIds }) => {
      await expect(
        service.savePlannerOrchestrationResult(
          {
            ...result,
            plan: {
              ...plan,
              steps: plan.steps.map((step, index) =>
                index === 0
                  ? { ...step, candidateId: createValidBuildCandidate().id }
                  : step,
              ),
            },
          },
          context,
        ),
      ).rejects.toMatchObject({ code: 'planner_result_invalid' })
      expect(await storedPlanIds()).toEqual([])
    }))

  it('rolls the generated Entry back when the Plan write fails', () =>
    withScenario(
      async ({ service, result, context, database, plan, storedEntryIds }) => {
        const existing = { ...createValidProductionPlan(), id: plan.id, status: 'active' as const }
        await database.productionPlans.put(existing)
        await expect(
          service.savePlannerOrchestrationResult(result, context),
        ).rejects.toMatchObject({ code: 'production_plan_id_conflict' })
        expect(await storedEntryIds()).toEqual([
          'build-list.persisted.a',
          'build-list.persisted.b',
        ])
        expect(await database.productionPlans.get(plan.id)).toEqual(existing)
      },
    ))

  it('rolls every generated Entry back when a later Entry write fails', () =>
    withScenario(
      async ({ service, result, context, storedEntryIds, storedPlanIds }) => {
        await expect(
          service.savePlannerOrchestrationResult(result, context),
        ).rejects.toBeInstanceOf(Error)
        expect(await storedEntryIds()).toEqual([
          'build-list.persisted.a',
          'build-list.persisted.b',
        ])
        expect(await storedPlanIds()).toEqual([])
      },
      {
        generatedCount: 2,
        createRepositories: (database) => {
          const repositories = createPlannerResultPersistenceRepositories(database)
          class FailingSecondWriteRepository extends BuildListEntryRepository {
            async addBuildListEntry(entry: BuildListEntry) {
              if (entry.id === buildListEntryId('build-list.generated.1')) {
                throw new Error('fixture Entry write failure')
              }
              return super.addBuildListEntry(entry)
            }
          }
          return {
            ...repositories,
            buildListEntries: new FailingSecondWriteRepository(database),
          }
        },
      },
    ))

  it('saves a Draft beside an existing Active Plan without changing it', () =>
    withScenario(
      async ({ service, result, context, database, repositories, storedPlanIds }) => {
        const active: ProductionPlan = {
          ...createValidProductionPlan(),
          id: productionPlanId('plan.active.a'),
          status: 'active',
        }
        await repositories.productionPlans.putProductionPlan(active)
        const saved = await service.savePlannerOrchestrationResult(result, context)
        expect(saved?.status).toBe('draft')
        expect(await storedPlanIds()).toEqual(['plan.active.a', 'plan.b8d2a.a'])
        expect(await database.productionPlans.get(active.id)).toEqual(active)
      },
    ))

  it('fails closed instead of creating an initial RngState at save time', () =>
    withScenario(
      async ({ service, result, context, database, storedEntryIds, storedPlanIds }) => {
        await database.rngState.clear()
        await expect(
          service.savePlannerOrchestrationResult(result, context),
        ).rejects.toMatchObject({ code: 'planner_state_changed' })
        expect(await database.rngState.count()).toBe(0)
        expect(await storedEntryIds()).toEqual([
          'build-list.persisted.a',
          'build-list.persisted.b',
        ])
        expect(await storedPlanIds()).toEqual([])
      },
    ))

  it('does not treat a different current array order as a state change', () =>
    withScenario(
      async ({ service, result, context, storedEntryIds, storedPlanIds }) => {
        const saved = await service.savePlannerOrchestrationResult(result, context)
        expect(saved).not.toBeNull()
        expect(await storedEntryIds()).toEqual([
          'build-list.generated.0',
          'build-list.persisted.a',
          'build-list.persisted.b',
        ])
        expect(await storedPlanIds()).toEqual(['plan.b8d2a.a'])
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
  /** A previous Draft as the old contract left it: it may name Entries the scenario database does not hold. */
  function oldDraft(id: string): ProductionPlan {
    return { ...createValidProductionPlan(), id: productionPlanId(id) }
  }

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

  const PERSISTED_ENTRY_IDS = ['build-list.persisted.a', 'build-list.persisted.b']

  it('A: replaces the previous Draft with the new one and saves the generated Entries', () =>
    withScenario(async ({ service, result, context, database, plan, storedEntryIds, storedPlanIds }) => {
      const previous = oldDraft('plan.draft.previous')
      await database.productionPlans.put(previous)

      const saved = await service.savePlannerOrchestrationResult(result, context)

      expect(saved?.id).toBe(plan.id)
      expect(saved?.status).toBe('draft')
      expect(await storedPlanIds()).toEqual(['plan.b8d2a.a'])
      expect(await database.productionPlans.get(previous.id)).toBeUndefined()
      expect(await storedEntryIds()).toEqual(['build-list.generated.0', ...PERSISTED_ENTRY_IDS])
    }))

  it('B: replaces every accumulated legacy Draft inside the one transaction', () =>
    withScenario(async ({ service, result, context, database, storedPlanIds }) => {
      // A state the v8 upgrade removes and the repository refuses to create;
      // seeded around the repository to prove the replacement clears it whole.
      await database.productionPlans.bulkPut([oldDraft('plan.draft.a'), oldDraft('plan.draft.b'), oldDraft('plan.draft.c')])

      await service.savePlannerOrchestrationResult(result, context)

      expect(await storedPlanIds()).toEqual(['plan.b8d2a.a'])
      expect(await database.productionPlans.where('status').equals('draft').count()).toBe(1)
    }))

  it('C: keeps the previous Draft when the save-time validation refuses the result', () =>
    withScenario(async ({ service, result, database, storedEntryIds, storedPlanIds }) => {
      const previous = oldDraft('plan.draft.previous')
      await database.productionPlans.put(previous)

      await expect(
        service.savePlannerOrchestrationResult(result, { ...result.plan!.calculationContext, rngEngineVersion: 'other-engine' }),
      ).rejects.toMatchObject({ code: 'planner_state_changed' })

      expect(await storedPlanIds()).toEqual(['plan.draft.previous'])
      expect(await database.productionPlans.get(previous.id)).toEqual(previous)
      expect(await storedEntryIds()).toEqual(PERSISTED_ENTRY_IDS)
    }))

  it('D: rolls the Draft deletion back when a generated Entry write fails', () =>
    withScenario(
      async ({ service, result, context, database, storedEntryIds, storedPlanIds }) => {
        const previous = oldDraft('plan.draft.previous')
        await database.productionPlans.put(previous)

        await expect(service.savePlannerOrchestrationResult(result, context)).rejects.toBeInstanceOf(Error)

        expect(await storedPlanIds()).toEqual(['plan.draft.previous'])
        expect(await database.productionPlans.get(previous.id)).toEqual(previous)
        expect(await storedEntryIds()).toEqual(PERSISTED_ENTRY_IDS)
      },
      {
        generatedCount: 2,
        createRepositories: (database) => {
          const repositories = createPlannerResultPersistenceRepositories(database)
          class FailingSecondWriteRepository extends BuildListEntryRepository {
            async addBuildListEntry(entry: BuildListEntry) {
              if (entry.id === buildListEntryId('build-list.generated.1')) {
                throw new Error('fixture Entry write failure')
              }
              return super.addBuildListEntry(entry)
            }
          }
          return { ...repositories, buildListEntries: new FailingSecondWriteRepository(database) }
        },
      },
    ))

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
            const previous = status === 'draft' ? colliding : oldDraft('plan.draft.previous')
            await database.productionPlans.bulkPut(status === 'draft' ? [colliding] : [previous, colliding])
            const plansBefore = await database.productionPlans.orderBy('id').toArray()

            await expect(
              service.savePlannerOrchestrationResult(result, context),
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
        async ({ service, result, context, database, storedPlanIds }) => {
          await database.productionPlans.put(oldDraft('plan.draft.previous'))
          await service.savePlannerOrchestrationResult(result, context)
          expect(deletions.count).toBe(1)
          expect(await storedPlanIds()).toEqual(['plan.b8d2a.a'])
        },
        { createRepositories: countingRepositories(deletions) },
      )
    })
  })

  it('F: deletes only Drafts - completed and abandoned Plans survive the replacement', () =>
    withScenario(async ({ service, result, context, database, storedPlanIds }) => {
      const completed = terminalPlan('plan.done.completed', 'completed')
      const abandoned = terminalPlan('plan.done.abandoned', 'abandoned')
      await database.productionPlans.bulkPut([oldDraft('plan.draft.previous'), completed, abandoned])

      await service.savePlannerOrchestrationResult(result, context)

      expect(await storedPlanIds()).toEqual(['plan.b8d2a.a', 'plan.done.abandoned', 'plan.done.completed'])
      expect(await database.productionPlans.get(completed.id)).toEqual(completed)
      expect(await database.productionPlans.get(abandoned.id)).toEqual(abandoned)
    }))

  it('keeps the previous Draft when the Planner produced no Plan', () =>
    withScenario(async ({ service, context, database, storedPlanIds }) => {
      const previous = oldDraft('plan.draft.previous')
      await database.productionPlans.put(previous)
      const saved = await service.savePlannerOrchestrationResult(
        { plan: null, conflicts: [], warnings: [], termination: exhaustedPlannerTermination(), generatedBuildListEntries: [] },
        context,
      )
      expect(saved).toBeNull()
      expect(await storedPlanIds()).toEqual(['plan.draft.previous'])
    }))

  it('never cascades the Entries the previous Draft referenced', () =>
    withScenario(async ({ service, result, context, database, storedEntryIds, persisted }) => {
      // The previous Draft names a persisted Entry of the scenario; the
      // replacement deletes the Draft record only.
      const previous = {
        ...oldDraft('plan.draft.previous'),
        selectedBuildListEntryIds: [persisted[0].id],
        steps: createValidProductionPlan().steps.map((step) => ({ ...step, buildListEntryId: persisted[0].id, targetWeaponId: persisted[0].targetWeaponId })),
      }
      await database.productionPlans.put(previous)

      await service.savePlannerOrchestrationResult(result, context)

      expect(await storedEntryIds()).toEqual(['build-list.generated.0', ...PERSISTED_ENTRY_IDS])
      expect(await database.buildListEntries.get(persisted[0].id)).toEqual(persisted[0])
    }))
})
