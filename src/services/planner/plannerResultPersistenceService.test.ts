import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { AppDatabase } from '../../db/AppDatabase'
import {
  BuildListEntryRepository,
  NormalArtianCounterRepository,
  OwnedWeaponRepository,
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
    const snapshot = createPlanningInputSnapshot(input, DOMAIN_FIXTURE_TIME)
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
        { plan: null, conflicts: [], warnings: [], generatedBuildListEntries: [] },
        context,
      )
      expect(saved).toBeNull()
      expect(await storedEntryIds()).toEqual([
        'build-list.persisted.a',
        'build-list.persisted.b',
      ])
      expect(await storedPlanIds()).toEqual([])
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
        const existing = { ...createValidProductionPlan(), id: plan.id }
        await database.productionPlans.put(existing)
        await expect(
          service.savePlannerOrchestrationResult(result, context),
        ).rejects.toBeInstanceOf(Error)
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
