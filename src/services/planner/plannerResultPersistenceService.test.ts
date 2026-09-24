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
import type { BuildListEntryReplacement } from '../../domain/buildList'
import {
  createPlanningBuildListEntriesHash,
  createPlanningInputSnapshot,
  prepareFinalReplacementBuildList,
} from '../../domain/planner'
import { RepositoryError } from '../../db/repositoryError'
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
  replacements: BuildListEntryReplacement[]
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
  /** Makes the Dexie write of this BuildListEntry ID fail inside the save. */
  failEntryWriteId?: string
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
    // Generated Entry i replaces persisted Entry i of the same Target
    // (`docs/PLANNER_SPEC.md` 9.2.18): generated.0 replaces persisted.a, and
    // generated.1 replaces persisted.b.
    const generated = Array.from(
      { length: options.generatedCount ?? 1 },
      (_unused, index) =>
        routeEntry(`build-list.generated.${index}`, index === 0 ? targetA : targetB, normalRoute()),
    )
    const replacements: BuildListEntryReplacement[] = generated.map((entry, index) => ({
      targetWeaponId: entry.targetWeaponId,
      replacedBuildListEntryId: persisted[index].id,
      generatedBuildListEntryId: entry.id,
    }))
    const owned = [sourceWeapon('owned.fixture.a'), sourceWeapon('owned.fixture.b')]
    const { input } = fixture([targetA, targetB], [...persisted, ...generated], owned)
    options.adjustGenerated?.(generated)
    // The Plan is calculated and recorded over the replacement set.
    const selected = [
      ...persisted.filter((_entry, index) => index >= generated.length),
      ...generated,
    ]
    input.buildListEntries = selected
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
    const plan = buildPlan(snapshot, input.calculationContext, selected)

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

    if (options.failEntryWriteId !== undefined) {
      const failing = options.failEntryWriteId
      database.buildListEntries.hook('creating', (_key, record) => {
        if (record.id === failing) throw new Error('fixture Entry write failure')
      })
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
      replacements,
      plan,
      result: {
        plan,
        conflicts: [],
        warnings: [],
        termination: completedPlannerTermination(),
        generatedBuildListEntries: generated,
        generatedBuildListEntryReplacements: replacements,
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
          generatedBuildListEntryReplacements: [],
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
              generatedBuildListEntryReplacements: [],
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

  it('replaces the persisted Entry with the generated Entry and saves the Plan together', () =>
    withScenario(
      async ({ service, result, context, plan, storedEntryIds, storedPlanIds }) => {
        const saved = await service.savePlannerOrchestrationResult(result, context)
        expect(saved?.id).toBe(plan.id)
        // generated.0 replaced persisted.a (`docs/PLANNER_SPEC.md` 9.2.18):
        // the Build List holds one Entry per Target, and the Plan references
        // no deleted Entry.
        expect(await storedEntryIds()).toEqual([
          'build-list.generated.0',
          'build-list.persisted.b',
        ])
        expect(saved?.selectedBuildListEntryIds).not.toContain('build-list.persisted.a')
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
      // The Domain check itself is `checkProductionPlanBuildListReferences()`;
      // here a Plan that dropped its generated Entry no longer matches its own
      // snapshot either, and nothing is written either way.
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
        ).rejects.toBeInstanceOf(RepositoryError)
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
        failEntryWriteId: 'build-list.generated.1',
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
      async ({ service, result, context, persisted, generated, replacements, plan, storedEntryIds, storedPlanIds }) => {
        // The final replacement set the save compares is order independent.
        const forward = prepareFinalReplacementBuildList(persisted, generated, replacements)
        const reversed = prepareFinalReplacementBuildList([...persisted].reverse(), generated, replacements)
        expect(createPlanningBuildListEntriesHash(reversed.finalEntries ?? []))
          .toBe(createPlanningBuildListEntriesHash(forward.finalEntries ?? []))
        expect(createPlanningBuildListEntriesHash(forward.finalEntries ?? []))
          .toBe(plan.baseSnapshot.buildListEntriesHash)
        const saved = await service.savePlannerOrchestrationResult(result, context)
        expect(saved).not.toBeNull()
        expect(await storedEntryIds()).toEqual([
          'build-list.generated.0',
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
      expect(await storedEntryIds()).toEqual(['build-list.generated.0', 'build-list.persisted.b'])
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
        failEntryWriteId: 'build-list.generated.1',
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
        { plan: null, conflicts: [], warnings: [], termination: exhaustedPlannerTermination(), generatedBuildListEntries: [], generatedBuildListEntryReplacements: [] },
        context,
      )
      expect(saved).toBeNull()
      expect(await storedPlanIds()).toEqual(['plan.draft.previous'])
    }))

  it('never cascades the Entries the previous Draft referenced', () =>
    withScenario(async ({ service, result, context, database, storedEntryIds, persisted }) => {
      // The previous Draft names a persisted Entry of the scenario; the
      // replacement deletes the Draft record only.
      // persisted.b is not replaced by this save, so only the Draft deletion
      // could remove it.
      const previous = {
        ...oldDraft('plan.draft.previous'),
        selectedBuildListEntryIds: [persisted[1].id],
        steps: createValidProductionPlan().steps.map((step) => ({ ...step, buildListEntryId: persisted[1].id, targetWeaponId: persisted[1].targetWeaponId })),
      }
      await database.productionPlans.put(previous)

      await service.savePlannerOrchestrationResult(result, context)

      expect(await storedEntryIds()).toEqual(['build-list.generated.0', 'build-list.persisted.b'])
      expect(await database.buildListEntries.get(persisted[1].id)).toEqual(persisted[1])
    }))
})

/**
 * Issue #103 Phase 0-3 (`docs/PLANNER_SPEC.md` 9.2.18): a generated Entry `G`
 * replaces the persisted Entry `O` it was calculated to replace, in the same
 * transaction as the Draft replacement, and only while `O` is still its
 * Target's one persisted Entry. Deleting `O` is a Build List change the
 * existing Plan-breaking guard judges.
 */
describe('PlannerResultPersistenceService generated Entry replacement (Phase 0-3)', () => {
  function runningPlanOver(
    plan: ProductionPlan,
    entries: readonly BuildListEntry[],
    status: 'active' | 'stale' | 'completed' | 'abandoned',
  ): ProductionPlan {
    const base = buildPlan(plan.baseSnapshot, plan.calculationContext, entries)
    return {
      ...base,
      id: productionPlanId('plan.running.p1'),
      status,
      recalculationReasons: status === 'stale' ? ['build_list_changed'] : [],
      abandonmentReason: status === 'abandoned' ? 'user_abandoned' : null,
      abandonedAt: status === 'abandoned' ? DOMAIN_FIXTURE_TIME : null,
      completedAt: status === 'completed' ? DOMAIN_FIXTURE_TIME : null,
      currentStepId: status === 'completed' ? null : base.currentStepId,
      steps: status === 'completed'
        ? base.steps.map((step) => ({ ...step, isCompleted: true, completedAt: DOMAIN_FIXTURE_TIME }))
        : base.steps,
    }
  }

  it('refuses when the Target meanwhile holds another Entry, deleting nothing on a guess', () =>
    withScenario(async ({ service, result, context, database, persisted, repositories, storedEntryIds, storedPlanIds }) => {
      const previous = { ...createValidProductionPlan(), id: productionPlanId('plan.draft.previous') }
      await database.productionPlans.put(previous)
      // After the Planner ran, persisted.a (B1) was replaced by B3 elsewhere.
      await repositories.buildListEntries.deleteBuildListEntry(persisted[0].id)
      const b3 = { ...structuredClone(persisted[0]), id: buildListEntryId('build-list.persisted.a3') }
      await repositories.buildListEntries.putBuildListEntry(b3)

      await expect(service.savePlannerOrchestrationResult(result, context)).rejects.toMatchObject({
        code: 'planner_state_changed',
        message: expect.stringContaining("instead of the BuildListEntry 'build-list.persisted.a'"),
      })
      expect(await storedEntryIds()).toEqual(['build-list.persisted.a3', 'build-list.persisted.b'])
      expect(await storedPlanIds()).toEqual(['plan.draft.previous'])
    }))

  it('refuses a result whose replacement metadata is malformed, writing nothing', () =>
    withScenario(async ({ service, result, context, storedEntryIds, storedPlanIds }) => {
      for (const generatedBuildListEntryReplacements of [
        [],
        [{ ...result.generatedBuildListEntryReplacements[0], targetWeaponId: 'target.fixture.b' as never }],
        undefined as never,
      ]) {
        await expect(
          service.savePlannerOrchestrationResult({ ...result, generatedBuildListEntryReplacements }, context),
        ).rejects.toMatchObject({ code: 'planner_result_invalid' })
      }
      expect(await storedEntryIds()).toEqual(['build-list.persisted.a', 'build-list.persisted.b'])
      expect(await storedPlanIds()).toEqual([])
    }))

  it('refuses a Plan that still references the replaced Entry', () =>
    withScenario(async ({ service, result, context, plan, persisted, storedPlanIds }) => {
      await expect(
        service.savePlannerOrchestrationResult(
          {
            ...result,
            plan: {
              ...plan,
              rejectedBuildListEntries: [{
                buildListEntryId: persisted[0].id,
                reason: 'resource_conflict',
                detail: 'fixture',
              }],
            },
          },
          context,
        ),
      ).rejects.toMatchObject({ code: 'planner_result_invalid' })
      expect(await storedPlanIds()).toEqual([])
    }))

  it('requires the breaking-change approval when the replaced Entry is an active Plan dependency, and ends that Plan with it', () =>
    withScenario(async ({ service, result, context, database, plan, persisted, storedEntryIds, storedPlanIds }) => {
      const active = runningPlanOver(plan, persisted, 'active')
      await database.productionPlans.put(active)
      const previous = { ...createValidProductionPlan(), id: productionPlanId('plan.draft.previous') }
      await database.productionPlans.put(previous)

      const inspection = await service.inspectPlannerOrchestrationResultSave(result, context)
      expect(inspection).toMatchObject({
        approvalRequired: true,
        reasons: ['build_list_changed'],
        observedPlan: { planId: active.id, status: 'active' },
        savePointChoiceRequired: false,
      })

      // Unapproved: refused, nothing changes.
      await expect(service.savePlannerOrchestrationResult(result, context)).rejects.toMatchObject({
        code: 'plan_breaking_change_approval_required',
      })
      expect(await storedEntryIds()).toEqual(['build-list.persisted.a', 'build-list.persisted.b'])
      expect(await storedPlanIds()).toEqual(['plan.draft.previous', 'plan.running.p1'])
      expect(await database.productionPlans.get(active.id)).toEqual(active)

      // Approved: the Entry replacement, the Draft replacement and the
      // abandonment happen together.
      if (!inspection.approvalRequired) throw new Error('Expected an approval.')
      const saved = await service.savePlannerOrchestrationResult(result, context, {
        observedPlan: inspection.observedPlan,
        savePointDecision: null,
      })
      expect(saved?.id).toBe(plan.id)
      expect(await storedEntryIds()).toEqual(['build-list.generated.0', 'build-list.persisted.b'])
      expect(await storedPlanIds()).toEqual(['plan.b8d2a.a', 'plan.running.p1'])
      expect(await database.productionPlans.get(active.id)).toMatchObject({
        status: 'abandoned',
        abandonmentReason: 'breaking_change_approved',
      })
    }))

  it('rolls the abandonment and the replacement back together when a later write fails', () =>
    withScenario(async ({ service, result, context, database, plan, persisted, storedEntryIds }) => {
      const active = runningPlanOver(plan, persisted, 'active')
      await database.productionPlans.put(active)
      const inspection = await service.inspectPlannerOrchestrationResultSave(result, context)
      if (!inspection.approvalRequired) throw new Error('Expected an approval.')
      // The new Plan's ID is taken after the inspection, which fails the last
      // write of the approved save.
      const taken = {
        ...runningPlanOver(plan, persisted, 'completed'),
        id: plan.id,
      }
      await database.productionPlans.put(taken)

      await expect(service.savePlannerOrchestrationResult(result, context, {
        observedPlan: inspection.observedPlan,
        savePointDecision: null,
      })).rejects.toMatchObject({ code: 'production_plan_id_conflict' })
      expect(await storedEntryIds()).toEqual(['build-list.persisted.a', 'build-list.persisted.b'])
      expect(await database.productionPlans.get(active.id)).toEqual(active)
      expect(await database.productionPlans.get(plan.id)).toEqual(taken)
    }))

  it.each(['stale', 'completed', 'abandoned'] as const)(
    'needs no approval when only a %s Plan references the replaced Entry',
    (status) =>
      withScenario(async ({ service, result, context, database, plan, persisted, storedEntryIds }) => {
        const historical = runningPlanOver(plan, persisted, status)
        await database.productionPlans.put(historical)

        expect(await service.inspectPlannerOrchestrationResultSave(result, context))
          .toEqual({ approvalRequired: false })
        const saved = await service.savePlannerOrchestrationResult(result, context)
        expect(saved?.id).toBe(plan.id)
        expect(await storedEntryIds()).toEqual(['build-list.generated.0', 'build-list.persisted.b'])
        // The historical Plan keeps its now-deleted reference as persisted.
        expect(await database.productionPlans.get(historical.id)).toEqual(historical)
      }),
  )

  it('needs no approval for a result without a Plan', () =>
    withScenario(async ({ service, context, database, plan, persisted }) => {
      const active = runningPlanOver(plan, persisted, 'active')
      await database.productionPlans.put(active)
      expect(await service.inspectPlannerOrchestrationResultSave(
        {
          plan: null,
          conflicts: [],
          warnings: [],
          termination: exhaustedPlannerTermination(),
          generatedBuildListEntries: [],
          generatedBuildListEntryReplacements: [],
        },
        context,
      )).toEqual({ approvalRequired: false })
    }))
})
