import Dexie from 'dexie'
import { beforeAll, describe, expect, it } from 'vitest'
import { AppDatabase } from '../../db/AppDatabase'
import { ProductionPlanRepository } from '../../db/repositories'
import type { PlanBreakingChangeApproval } from '../../domain/execution'
import { loadMasterData } from '../../domain/master/loadMasterData'
import { createDefaultAppSettings } from '../../domain/models/factories'
import type {
  BuildListEntry,
  BuildListEntryId,
  CalculationContext,
  ExecutionHistoryId,
  ProductionPlan,
  ProductionPlanId,
} from '../../domain/models/publicTypes'
import {
  checkProductionPlanBuildListEntryReferences,
  createPlanningBuildListEntriesHash,
  type PlannerResult,
} from '../../domain/planner'
import {
  BONUS_ONLY_TARGET_ID,
  COMPLETED_ENTRY_ID,
  COMPLETED_TARGET_ID,
  MIXED_KEEP_TARGET_ID,
  NO_ENTRY_TARGET_ID,
  SKILL_ONLY_TARGET_ID,
  STALE_ENTRY_ID,
  STALE_ONLY_TARGET_ID,
  STALE_SECOND_ENTRY_ID,
  createBuildListOptimizationAdoptionFixture,
  replacedBuildList,
  type BuildListOptimizationAdoptionFixture,
  type BuildListOptimizationAdoptionVariant,
} from '../../test/fixtures/buildListOptimizationAdoptionFixtures'
import { DOMAIN_FIXTURE_TIME, createValidProductionPlan, productionPlanId } from '../../test/fixtures/domainData'
import { dump } from '../../test/fixtures/executionRuntime'
import { ImportExportService } from '../dataTransfer/importExportService'
import { ProductionPlanExecutionService } from '../execution/productionPlanExecutionService'
import type { BuildListOptimizationAdoptionSource } from './buildListOptimizationService'
import {
  PlannerResultPersistenceService,
  createPlannerResultPersistenceRepositories,
  type PlannerResultPersistenceRepositories,
} from './plannerResultPersistenceService'

/**
 * The Build List global optimization adoption save (`docs/PLANNER_SPEC.md` 17.11, `docs/DATA_MODEL.md` 14.5, Issue #260 PR-6A):
 * `inspectBuildListOptimizationAdoptionSave()` / `saveBuildListOptimizationAdoption()` over real `optimized` artifacts and a real
 * Dexie database. Every refusal is checked to leave every table exactly as it was.
 */

const PREVIOUS_DRAFT_ID = productionPlanId('plan.draft.previous')
const OTHER_DRAFT_ID = productionPlanId('plan.draft.other')

const fixtures = new Map<BuildListOptimizationAdoptionVariant, BuildListOptimizationAdoptionFixture>()

beforeAll(async () => {
  fixtures.set('scoped', await createBuildListOptimizationAdoptionFixture('scoped'))
  fixtures.set('unchanged', await createBuildListOptimizationAdoptionFixture('unchanged'))
  fixtures.set('plain', await createBuildListOptimizationAdoptionFixture('plain'))
})

interface Scenario {
  database: AppDatabase
  service: PlannerResultPersistenceService
  fixture: BuildListOptimizationAdoptionFixture
  context: CalculationContext
  plan: ProductionPlan
  /** The adoption source as the Application holds it; the observed Draft defaults to the seeded previous Draft (or none). */
  source(observedDraftPlanId?: ProductionPlanId | null): BuildListOptimizationAdoptionSource
}

interface ScenarioOptions {
  variant?: BuildListOptimizationAdoptionVariant
  /** Seeds a previous Draft the adoption replaces (default true). */
  previousDraft?: boolean
  createRepositories?: (database: AppDatabase) => PlannerResultPersistenceRepositories
}

function draftPlan(id: ProductionPlanId): ProductionPlan {
  return { ...createValidProductionPlan(), id }
}

function runningPlan(id: string, status: 'active' | 'stale'): ProductionPlan {
  return {
    ...createValidProductionPlan(),
    id: productionPlanId(id),
    status,
    recalculationReasons: status === 'stale' ? ['rng_state_changed'] : [],
  }
}

let databaseSequence = 0

async function withScenario(run: (scenario: Scenario) => Promise<void>, options: ScenarioOptions = {}): Promise<void> {
  databaseSequence += 1
  const name = `build-list-optimization-adoption-${databaseSequence}-${crypto.randomUUID()}`
  const database = new AppDatabase(name)
  await database.open()
  try {
    const shared = fixtures.get(options.variant ?? 'scoped')!
    const fixture: BuildListOptimizationAdoptionFixture = {
      input: structuredClone(shared.input),
      artifact: structuredClone(shared.artifact),
      engine: shared.engine,
    }
    const { input } = fixture
    await database.rngState.put(structuredClone(input.rngState))
    await database.normalArtianCounters.bulkPut(structuredClone(input.normalCounters))
    await database.ownedWeapons.bulkPut(structuredClone(input.ownedWeapons))
    await database.targetWeapons.bulkPut(structuredClone(input.targetWeapons))
    await database.buildListEntries.bulkPut(structuredClone(input.buildListEntries))
    const previousDraft = options.previousDraft ?? true
    if (previousDraft) await database.productionPlans.put(draftPlan(PREVIOUS_DRAFT_ID))
    const repositories = options.createRepositories?.(database) ?? createPlannerResultPersistenceRepositories(database)
    await run({
      database,
      service: new PlannerResultPersistenceService(database, repositories),
      fixture,
      context: structuredClone(input.calculationContext),
      plan: fixture.artifact.plannerResult.plan as ProductionPlan,
      source: (observedDraftPlanId = previousDraft ? PREVIOUS_DRAFT_ID : null) => ({
        artifact: structuredClone(fixture.artifact),
        startSnapshot: { observedDraftPlanId, runningPlanAbsent: true },
      }),
    })
  } finally {
    database.close()
    await Dexie.delete(name)
  }
}

type Attempt = 'inspect' | 'save'
const ATTEMPTS: Attempt[] = ['inspect', 'save']

function attempt(scenario: Scenario, kind: Attempt, source: BuildListOptimizationAdoptionSource = scenario.source()): Promise<unknown> {
  return kind === 'inspect'
    ? scenario.service.inspectBuildListOptimizationAdoptionSave(source, scenario.context)
    : scenario.service.saveBuildListOptimizationAdoption(source, scenario.context)
}

/** The refusal leaves every table exactly as it was (the dump is read before the attempt runs). */
async function expectRefused(
  scenario: Scenario,
  run: () => Promise<unknown>,
  code: string,
  message?: string | RegExp,
): Promise<void> {
  const before = await dump(scenario.database)
  await expect(run()).rejects.toMatchObject({
    code,
    ...(message === undefined ? {} : { message: typeof message === 'string' ? expect.stringContaining(message) : expect.stringMatching(message) }),
  })
  expect(await dump(scenario.database)).toEqual(before)
}

const byId = <T extends { id: string }>(values: readonly T[]) => [...values].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))

function entryOf(entries: readonly BuildListEntry[], targetWeaponId: string): BuildListEntry {
  const found = entries.filter((entry) => entry.targetWeaponId === targetWeaponId)
  expect(found).toHaveLength(1)
  return found[0]!
}

describe('Build List optimization adoption: saving (PLANNER_SPEC 17.11)', () => {
  it('replaces every changed Entry and the previous Draft in one save, keeping the unchanged Entry, the excluded Entries and every out-of-scope Target', () =>
    withScenario(async ({ database, service, fixture, context, plan, source }) => {
      const { input, artifact } = fixture
      expect(artifact.replacements.map(({ targetWeaponId }) => targetWeaponId).sort()).toEqual([BONUS_ONLY_TARGET_ID, MIXED_KEEP_TARGET_ID])
      const before = await dump(database)

      const saved = await service.saveBuildListOptimizationAdoption(source(), context)

      expect(saved).toEqual({ kind: 'saved', plan })
      const after = await dump(database)
      // The Draft is replaced by the final Plan as calculated: a new chain, no provenance, nothing else added to it.
      expect(after.productionPlans).toEqual([plan])
      expect(plan.status).toBe('draft')
      expect(plan.conflictRepairLineage).toBeNull()
      // The Build List is the replaced one: each `O` gone, each `G` added, every other Entry untouched.
      expect(after.buildListEntries).toEqual(byId(replacedBuildList(input, artifact)))
      for (const { replacedBuildListEntryId, generatedBuildListEntryId } of artifact.replacements) {
        expect(await database.buildListEntries.get(replacedBuildListEntryId)).toBeUndefined()
        const generated = await database.buildListEntries.get(generatedBuildListEntryId)
        expect(generated).toEqual(artifact.generatedBuildListEntries.find(({ id }) => id === generatedBuildListEntryId))
        // A replacing Entry starts with nothing selected and the default preference (17.5): bonus-only's `bonus_first` is not carried over.
        expect(generated?.intermediateStateSelection).toEqual({ skillOpportunityId: null, bonusOpportunityId: null, improvementPreference: 'planner' })
      }
      expect(entryOf(input.buildListEntries, BONUS_ONLY_TARGET_ID).intermediateStateSelection?.improvementPreference).toBe('bonus_first')
      // The unchanged Target keeps its Entry with its settings (`skill_first`).
      const unchanged = entryOf(after.buildListEntries, SKILL_ONLY_TARGET_ID)
      expect(unchanged).toEqual(entryOf(input.buildListEntries, SKILL_ONLY_TARGET_ID))
      expect(unchanged.intermediateStateSelection?.improvementPreference).toBe('skill_first')
      // Stage 0's excluded Entries and the out-of-scope Targets are untouched.
      for (const id of [STALE_ENTRY_ID, STALE_SECOND_ENTRY_ID, COMPLETED_ENTRY_ID]) {
        expect(await database.buildListEntries.get(id)).toEqual(input.buildListEntries.find((entry) => entry.id === id))
      }
      expect(after.targetWeapons).toEqual(before.targetWeapons)
      expect(after.targetWeapons.map(({ id }) => id)).toEqual(expect.arrayContaining([STALE_ONLY_TARGET_ID, COMPLETED_TARGET_ID, NO_ENTRY_TARGET_ID]))
      // Nothing else is written: RNG state, Counters, weapons, history and save points stay.
      expect(after.rngState).toEqual(before.rngState)
      expect(after.normalCounters).toEqual(before.normalCounters)
      expect(after.ownedWeapons).toEqual(before.ownedWeapons)
      expect(after.executionHistory).toEqual([])
      expect(after.executionSavePoints).toEqual([])
      // The stored Plan references only the stored Build List.
      expect(checkProductionPlanBuildListEntryReferences(plan, after.buildListEntries)).toBeNull()
      expect(plan.selectedBuildListEntryIds.every((id) => after.buildListEntries.some((entry) => entry.id === id))).toBe(true)
    }))

  it('saves an artifact over a Build List without any excluded Entry or warning', () =>
    withScenario(async ({ database, service, fixture, context, plan, source }) => {
      expect(fixture.artifact.inputExclusions).toEqual([])
      expect(fixture.artifact.plannerResult.warnings).toEqual([])
      expect(await service.saveBuildListOptimizationAdoption(source(), context)).toEqual({ kind: 'saved', plan })
      expect(await database.buildListEntries.toArray()).toEqual(byId(replacedBuildList(fixture.input, fixture.artifact)))
    }, { variant: 'plain' }))

  it('saves the new Draft when no Draft existed when the calculation started', () =>
    withScenario(async ({ database, service, context, plan, source }) => {
      const saved = await service.saveBuildListOptimizationAdoption(source(null), context)
      expect(saved).toEqual({ kind: 'saved', plan })
      expect(await database.productionPlans.toArray()).toEqual([plan])
    }, { previousDraft: false }))

  it.each([true, false])('replaces no Entry when every planning Target keeps its Entry: only the Draft is saved (previous Draft %s)', (previousDraft) =>
    withScenario(async ({ database, service, fixture, context, plan, source }) => {
      expect(fixture.artifact.replacements).toEqual([])
      expect(fixture.artifact.generatedBuildListEntries).toEqual([])
      expect([...fixture.artifact.unchangedTargetWeaponIds].sort()).toEqual([BONUS_ONLY_TARGET_ID, MIXED_KEEP_TARGET_ID, SKILL_ONLY_TARGET_ID])
      const entriesBefore = await database.buildListEntries.toArray()
      const failOnEntryWrite = () => {
        throw new Error('A replacement-free adoption must not write the Build List.')
      }
      database.buildListEntries.hook('creating', failOnEntryWrite)
      database.buildListEntries.hook('updating', failOnEntryWrite)
      database.buildListEntries.hook('deleting', failOnEntryWrite)

      expect(await service.inspectBuildListOptimizationAdoptionSave(source(), context)).toEqual({
        replacedDraftPlanId: previousDraft ? PREVIOUS_DRAFT_ID : null,
        replacements: [],
        unchangedTargetWeaponIds: fixture.artifact.unchangedTargetWeaponIds,
      })
      const saved = await service.saveBuildListOptimizationAdoption(source(), context)

      expect(saved).toEqual({ kind: 'saved', plan })
      expect(await database.productionPlans.toArray()).toEqual([plan])
      expect(await database.buildListEntries.toArray()).toEqual(entriesBefore)
    }, { variant: 'unchanged', previousDraft }))

  it('stores an ordinary Draft: the repository reads it as the current Draft and it starts as it is', () =>
    withScenario(async ({ database, service, fixture, context, plan, source }) => {
      await service.saveBuildListOptimizationAdoption(source(), context)

      expect(await new ProductionPlanRepository(database).getDraftProductionPlan()).toEqual(plan)
      let history = 0
      const execution = new ProductionPlanExecutionService({
        database,
        currentCalculationContext: context,
        counterAuthority: fixture.engine,
        validateResultingWeapon: () => [],
        idFactory: { executionHistoryId: () => `history.adoption.${++history}` as ExecutionHistoryId },
        clock: { now: () => DOMAIN_FIXTURE_TIME },
      })
      const started = await execution.startProductionPlan(plan.id)
      expect(started.status).toBe('active')
      expect(started.currentStepId).toBe(plan.steps[0]!.id)
    }))

  it('persists nothing runtime-only: no artifact, input token, start snapshot or diagnostics value reaches a table', () =>
    withScenario(async ({ database, service, fixture, context, source }) => {
      await service.saveBuildListOptimizationAdoption(source(), context)

      const stored = JSON.stringify({ ...(await dump(database)), settings: await database.settings.toArray(), candidates: await database.buildCandidates.toArray() })
      for (const key of ['inputToken', 'inputBuildListEntriesHash', 'startSnapshot', 'observedDraftPlanId', 'runningPlanAbsent', 'diagnostics', 'plannerVerifications', 'structuralObjective', 'inputExclusions', 'unchangedTargetWeaponIds', 'planningTargetWeaponIds']) {
        expect(stored, key).not.toContain(`"${key}"`)
      }
      // The stored records are exactly the artifact's Plan and generated Entries, with no field added.
      expect(await database.productionPlans.get(fixture.artifact.plannerResult.plan!.id)).toEqual(fixture.artifact.plannerResult.plan)
      for (const entry of fixture.artifact.generatedBuildListEntries) expect(await database.buildListEntries.get(entry.id)).toEqual(entry)
      expect(await database.buildCandidates.count()).toBe(0)
    }))

  it('round-trips the adopted Build List and Draft through Export / Import as ordinary data', () =>
    withScenario(async ({ database, service, context, source }) => {
      await service.saveBuildListOptimizationAdoption(source(), context)
      await database.settings.put(createDefaultAppSettings(DOMAIN_FIXTURE_TIME))
      const master = loadMasterData()
      if (!master.ok) throw new Error('The Master Data fixture is invalid.')
      const transfer = (target: AppDatabase) => new ImportExportService({ database: target, master: master.data, clock: { now: () => DOMAIN_FIXTURE_TIME } })

      const prepared = transfer(database).prepareImportJson(await transfer(database).serializeExport())
      expect(prepared.ok ? [] : prepared.issues).toEqual([])

      const name = `build-list-optimization-adoption-import-${crypto.randomUUID()}`
      const imported = new AppDatabase(name)
      await imported.open()
      try {
        if (!prepared.ok) throw new Error('unreachable')
        await transfer(imported).applyImport(prepared.root)
        const [exported, restored] = [await dump(database), await dump(imported)]
        expect(restored.buildListEntries).toEqual(exported.buildListEntries)
        expect(restored.productionPlans).toEqual(exported.productionPlans)
        expect(restored.targetWeapons).toEqual(exported.targetWeapons)
      } finally {
        imported.close()
        await Dexie.delete(name)
      }
    }))

  it('is not refused by OwnedWeapon or Target changes outside every hash: status, name and memo', () =>
    withScenario(async ({ database, service, context, plan, source }) => {
      const weapons = await database.ownedWeapons.toArray()
      await database.ownedWeapons.bulkPut(weapons.map((weapon) => (weapon.kind === 'gogma'
        ? { ...weapon, status: 'practical' as const, name: `${weapon.name} renamed`, memo: 'memo changed', updatedAt: '2026-10-01T00:00:00.000Z' }
        : weapon)))
      const targets = await database.targetWeapons.toArray()
      await database.targetWeapons.bulkPut(targets.map((target) => ({ ...target, name: `${target.name} renamed`, memo: 'memo changed' })))

      expect(await service.saveBuildListOptimizationAdoption(source(), context)).toEqual({ kind: 'saved', plan })
    }))

  it.each(['completed', 'abandoned'] as const)(
    'replaces an Entry a %s Plan still references without any approval, keeping that Plan exactly as persisted',
    (status) =>
      withScenario(async ({ database, service, fixture, context, plan, source }) => {
        // Moved from the removed Planner Alternative repair save tests (Issue #278 PR-5): an ended Plan is never a
        // running Plan, so the guard judges nothing for it and its reference to a replaced `O` never blocks the save.
        const [{ replacedBuildListEntryId }] = fixture.artifact.replacements
        const base = createValidProductionPlan()
        const ended: ProductionPlan = {
          ...base,
          id: productionPlanId(`plan.ended.${status}`),
          status,
          selectedBuildListEntryIds: [replacedBuildListEntryId],
          steps: base.steps.map((step) => ({
            ...step,
            buildListEntryId: replacedBuildListEntryId,
            isCompleted: status === 'completed',
            completedAt: status === 'completed' ? DOMAIN_FIXTURE_TIME : null,
          })),
          currentStepId: status === 'completed' ? null : base.currentStepId,
          completedAt: status === 'completed' ? DOMAIN_FIXTURE_TIME : null,
          abandonmentReason: status === 'abandoned' ? 'user_abandoned' : null,
          abandonedAt: status === 'abandoned' ? DOMAIN_FIXTURE_TIME : null,
        }
        await database.productionPlans.put(ended)

        // The inspection succeeds only when no approval applies.
        await service.inspectBuildListOptimizationAdoptionSave(source(), context)
        expect(await service.saveBuildListOptimizationAdoption(source(), context)).toEqual({ kind: 'saved', plan })
        expect(await database.buildListEntries.get(replacedBuildListEntryId)).toBeUndefined()
        // The ended Plan keeps its now-deleted reference as persisted; only the Draft was replaced.
        expect(await database.productionPlans.get(ended.id)).toEqual(ended)
        expect(byId(await database.productionPlans.toArray())).toEqual(byId([ended, plan]))
      }),
  )
})

describe('Build List optimization adoption: inspection', () => {
  it('writes nothing and reports the Draft it replaces, each replaced Entry with the preference it loses, and the unchanged Targets', () =>
    withScenario(async ({ database, service, fixture, context, source }) => {
      const before = await dump(database)

      const inspection = await service.inspectBuildListOptimizationAdoptionSave(source(), context)

      expect(await dump(database)).toEqual(before)
      const preferenceOf = (targetWeaponId: string) => entryOf(fixture.input.buildListEntries, targetWeaponId).intermediateStateSelection?.improvementPreference
      expect(inspection).toEqual({
        replacedDraftPlanId: PREVIOUS_DRAFT_ID,
        replacements: fixture.artifact.replacements.map((replacement) => ({
          ...replacement,
          replacedImprovementPreference: preferenceOf(replacement.targetWeaponId),
        })),
        unchangedTargetWeaponIds: [SKILL_ONLY_TARGET_ID],
      })
      expect(inspection.replacements.find(({ targetWeaponId }) => targetWeaponId === BONUS_ONLY_TARGET_ID)?.replacedImprovementPreference).toBe('bonus_first')
      expect(inspection.replacements.find(({ targetWeaponId }) => targetWeaponId === MIXED_KEEP_TARGET_ID)?.replacedImprovementPreference).toBe('planner')
    }))

  it('is no write authority: a state change after a successful inspection refuses the save', () =>
    withScenario(async (scenario) => {
      const { database, service, context, source } = scenario
      await service.inspectBuildListOptimizationAdoptionSave(source(), context)
      const rngState = (await database.rngState.get('current'))!
      await database.rngState.put({ ...rngState, gogmaCounter: { ...rngState.gogmaCounter, value: (rngState.gogmaCounter.value ?? 0) + 1 } })

      await expectRefused(scenario, () => service.saveBuildListOptimizationAdoption(source(), context), 'planner_state_changed', 'input token (initialExecutionState)')
    }))
})

describe('Build List optimization adoption: the start state of the calculation (T2)', () => {
  it.each(ATTEMPTS)('%s: refuses while an active or a stale Plan runs, and two running Plans by the guard invariant', (kind) =>
    withScenario(async (scenario) => {
      const { database } = scenario
      for (const status of ['active', 'stale'] as const) {
        await database.productionPlans.put(runningPlan('plan.running', status))
        await expectRefused(scenario, () => attempt(scenario, kind), 'planner_state_changed', `is running (${status})`)
      }
      await database.productionPlans.put(runningPlan('plan.running.second', 'active'))
      await expectRefused(scenario, () => attempt(scenario, kind), 'running_plan_invariant_violated')
    }))

  it.each(ATTEMPTS)('%s: refuses a Draft that changed after the calculation started (replaced, created or deleted)', (kind) =>
    withScenario(async (scenario) => {
      const { database, source } = scenario
      // Replaced by another Draft.
      await database.productionPlans.delete(PREVIOUS_DRAFT_ID)
      await database.productionPlans.put(draftPlan(OTHER_DRAFT_ID))
      await expectRefused(scenario, () => attempt(scenario, kind), 'planner_state_changed', `started with Draft '${PREVIOUS_DRAFT_ID}', but Draft '${OTHER_DRAFT_ID}' is current`)
      // Created after a calculation that started without a Draft.
      await expectRefused(scenario, () => attempt(scenario, kind, source(null)), 'planner_state_changed', `started with no Draft, but Draft '${OTHER_DRAFT_ID}' is current`)
      // Deleted (or started) after the calculation observed it.
      await database.productionPlans.delete(OTHER_DRAFT_ID)
      await expectRefused(scenario, () => attempt(scenario, kind, source(OTHER_DRAFT_ID)), 'planner_state_changed', 'but no Draft is current')
    }))

  it.each(ATTEMPTS)('%s: refuses two stored Drafts as a Draft invariant violation', (kind) =>
    withScenario(async (scenario) => {
      await scenario.database.productionPlans.put(draftPlan(OTHER_DRAFT_ID))
      await expectRefused(scenario, () => attempt(scenario, kind), 'draft_plan_conflict')
    }))

  it('refuses a Plan-breaking approval as not required, whether or not a Plan runs', () =>
    withScenario(async (scenario) => {
      const { database, service, context, source } = scenario
      const approval = (plan: ProductionPlan): PlanBreakingChangeApproval => ({
        observedPlan: { planId: plan.id, status: 'active', currentStepId: plan.currentStepId, updatedAt: plan.updatedAt },
        savePointDecision: null,
      })
      const active = runningPlan('plan.running', 'active')
      await expectRefused(scenario, () => service.saveBuildListOptimizationAdoption(source(), context, approval(active)), 'plan_breaking_change_approval_not_required')
      await database.productionPlans.put(active)
      await expectRefused(scenario, () => service.saveBuildListOptimizationAdoption(source(), context, approval(active)), 'plan_breaking_change_approval_not_required')
      await expectRefused(scenario, () => service.saveBuildListOptimizationAdoption(source(), context, {
        ...approval(active), savePointDecision: { kind: 'restore_save_point', recordedAt: DOMAIN_FIXTURE_TIME },
      }), 'plan_breaking_change_approval_not_required')
    }))
})

describe('Build List optimization adoption: the input token (T2)', () => {
  it.each(ATTEMPTS)('%s: refuses any change of the input Build List, another Target\'s Entry and an excluded Entry included', (kind) =>
    withScenario(async (scenario) => {
      const { database, fixture } = scenario
      const changes: [string, () => Promise<void>, () => Promise<void>][] = []
      const unchanged = entryOf(fixture.input.buildListEntries, SKILL_ONLY_TARGET_ID)
      changes.push(['the unchanged Target\'s Entry setting', async () => {
        await database.buildListEntries.put({ ...unchanged, intermediateStateSelection: { skillOpportunityId: null, bonusOpportunityId: null, improvementPreference: 'planner' } })
      }, async () => { await database.buildListEntries.put(unchanged) }])
      const stale = fixture.input.buildListEntries.find(({ id }) => id === STALE_ENTRY_ID)!
      changes.push(['an excluded Entry deleted', async () => { await database.buildListEntries.delete(STALE_ENTRY_ID) }, async () => { await database.buildListEntries.put(stale) }])
      const replaced = fixture.input.buildListEntries.find(({ id }) => id === fixture.artifact.replacements[0]!.replacedBuildListEntryId)!
      changes.push(['a replaced Entry deleted', async () => { await database.buildListEntries.delete(replaced.id) }, async () => { await database.buildListEntries.put(replaced) }])
      const added: BuildListEntry = { ...structuredClone(stale), id: 'build-list.scope.added' as BuildListEntryId }
      changes.push(['an Entry added for an out-of-scope Target', async () => { await database.buildListEntries.put(added) }, async () => { await database.buildListEntries.delete(added.id) }])
      // A generated Entry ID taken meanwhile is a Build List change too: the token refuses it before the replacement set is built.
      const generated = fixture.artifact.generatedBuildListEntries[0]!
      changes.push(['a generated Entry ID taken', async () => { await database.buildListEntries.put({ ...structuredClone(stale), id: generated.id }) }, async () => { await database.buildListEntries.delete(generated.id) }])
      for (const [label, change, restore] of changes) {
        await change()
        await expectRefused(scenario, () => attempt(scenario, kind), 'planner_state_changed', 'input token inputBuildListEntriesHash').catch((error: unknown) => {
          throw new Error(`${label}: ${String(error)}`)
        })
        await restore()
      }
      // Restored, the same artifact is adoptable again.
      await expect(attempt(scenario, kind)).resolves.toBeDefined()
    }))

  it.each(ATTEMPTS)('%s: refuses a Target change the token covers: a planning Target\'s performance definition, an out-of-scope Target\'s priority', (kind) =>
    withScenario(async (scenario) => {
      const { database } = scenario
      // A performance definition change makes the generated Entry of that Target stale too; the token refuses it first (T2).
      const planning = (await database.targetWeapons.get(BONUS_ONLY_TARGET_ID))!
      expect(planning.practicalBonusConditions.length).toBeGreaterThan(0)
      await database.targetWeapons.put({ ...planning, practicalBonusConditions: [] })
      await expectRefused(scenario, () => attempt(scenario, kind), 'planner_state_changed', 'input token (targetWeaponsHash)')
      await database.targetWeapons.put(planning)

      const outOfScope = (await database.targetWeapons.get(NO_ENTRY_TARGET_ID))!
      await database.targetWeapons.put({ ...outOfScope, priority: outOfScope.priority === 5 ? 4 : 5 })
      await expectRefused(scenario, () => attempt(scenario, kind), 'planner_state_changed', 'input token (targetWeaponsHash)')
    }))

  it.each(ATTEMPTS)('%s: refuses an RNG state, Normal Counter or OwnedWeapon change the token covers', (kind) =>
    withScenario(async (scenario) => {
      const { database } = scenario
      const rngState = (await database.rngState.get('current'))!
      await database.rngState.put({ ...rngState, skillCounter: { ...rngState.skillCounter, value: (rngState.skillCounter.value ?? 0) + 1 } })
      await expectRefused(scenario, () => attempt(scenario, kind), 'planner_state_changed', 'input token (initialExecutionState)')
      await database.rngState.put(rngState)

      const [counter] = await database.normalArtianCounters.toArray()
      await database.normalArtianCounters.put({ ...counter!, counter: (counter!.counter ?? 0) + 1 })
      await expectRefused(scenario, () => attempt(scenario, kind), 'planner_state_changed', 'input token (initialExecutionState)')
      await database.normalArtianCounters.put(counter!)

      const [weapon] = await database.ownedWeapons.toArray()
      await database.ownedWeapons.put({ ...weapon!, isProtected: !weapon!.isProtected })
      await expectRefused(scenario, () => attempt(scenario, kind), 'planner_state_changed', 'input token (initialExecutionState)')
    }))

  it.each(ATTEMPTS)('%s: refuses a CalculationContext the token was not calculated under', (kind) =>
    withScenario(async (scenario) => {
      const changed: Scenario = { ...scenario, context: { ...scenario.context, masterDataVersion: scenario.context.masterDataVersion + 1 } }
      await expectRefused(scenario, () => attempt(changed, kind), 'planner_state_changed', 'CalculationContext differs from the Build List optimization input token')
    }))
})

describe('Build List optimization adoption: freshness, the Plan and the write (T5 - T7)', () => {
  it.each(ATTEMPTS)('%s: refuses a generated Entry the current state makes stale even though the token matches and its persisted flag says fresh', (kind) =>
    withScenario(async (scenario) => {
      const { fixture } = scenario
      // An inconsistent artifact: its generated Entry's Search hash is not the current state's, the Plan's snapshot is over that very
      // Entry, and its persisted staleness says fresh. Only the recomputed freshness finds it (T5); the token checks all pass.
      const source = scenario.source()
      const tampered = source.artifact.generatedBuildListEntries[0]!
      tampered.searchStateHash = 'fnv1a32:12345678'
      tampered.candidateSnapshot.searchStateHash = tampered.searchStateHash
      tampered.isStale = false
      tampered.staleReasons = []
      const plan = source.artifact.plannerResult.plan!
      plan.baseSnapshot.buildListEntriesHash = createPlanningBuildListEntriesHash(replacedBuildList(fixture.input, source.artifact))
      await expectRefused(scenario, () => attempt(scenario, kind, source), 'planner_state_changed', `Generated BuildListEntry '${tampered.id}' is stale against current state (rng_state_changed)`)
    }))

  it.each(ATTEMPTS)("%s: refuses a Plan whose snapshot is not the replaced Build List's, or not the token's", (kind) =>
    withScenario(async (scenario) => {
      const entries = scenario.source()
      entries.artifact.plannerResult.plan!.baseSnapshot.buildListEntriesHash = 'fnv1a32:ffffffff'
      await expectRefused(scenario, () => attempt(scenario, kind, entries), 'planner_state_changed', 'PlanningInputSnapshot.buildListEntriesHash')
      const targets = scenario.source()
      targets.artifact.plannerResult.plan!.baseSnapshot.targetWeaponsHash = 'fnv1a32:ffffffff'
      await expectRefused(scenario, () => attempt(scenario, kind, targets), 'planner_result_invalid', 'targetWeaponsHash is not the final Plan')
    }))

  it.each(ATTEMPTS)("%s: refuses a replacement whose `O` is not its Target's current Entry even though the token matches (T3)", (kind) =>
    withScenario(async (scenario) => {
      const source = scenario.source()
      const [replacement] = source.artifact.replacements
      source.artifact.replacements[0] = { ...replacement!, replacedBuildListEntryId: 'build-list.scope.ghost' as BuildListEntryId }
      await expectRefused(scenario, () => attempt(scenario, kind, source), 'planner_state_changed', `instead of the BuildListEntry 'build-list.scope.ghost'`)
    }))

  it.each(ATTEMPTS)('%s: refuses a Plan Step whose Candidate is not its Entry Snapshot (T6 references)', (kind) =>
    withScenario(async (scenario) => {
      const source = scenario.source()
      const unchangedCandidateId = entryOf(scenario.fixture.input.buildListEntries, SKILL_ONLY_TARGET_ID).candidateSnapshot.id
      const plan = source.artifact.plannerResult.plan!
      const index = plan.steps.findIndex((step) => step.candidateId !== unchangedCandidateId)
      plan.steps[index] = { ...plan.steps[index]!, candidateId: unchangedCandidateId }
      await expectRefused(scenario, () => attempt(scenario, kind, source), 'planner_result_invalid', 'does not match the candidate Snapshot')
    }))

  it('refuses a new Plan ID another stored Plan already holds before any Draft is deleted', () =>
    withScenario(async (scenario) => {
      const { database, plan } = scenario
      const base = createValidProductionPlan()
      await database.productionPlans.put({
        ...base,
        id: plan.id,
        status: 'completed',
        completedAt: DOMAIN_FIXTURE_TIME,
        currentStepId: null,
        steps: base.steps.map((step) => ({ ...step, isCompleted: true, completedAt: DOMAIN_FIXTURE_TIME })),
      })
      await expectRefused(scenario, () => scenario.service.saveBuildListOptimizationAdoption(scenario.source(), scenario.context), 'production_plan_id_conflict')
    }))

  describe('rolls back every write when one fails', () => {
    function failingPlans(method: 'addProductionPlan' | 'deleteDraftProductionPlans') {
      return (database: AppDatabase): PlannerResultPersistenceRepositories => {
        class FailingProductionPlanRepository extends ProductionPlanRepository {
          override async addProductionPlan(plan: ProductionPlan): Promise<ProductionPlan> {
            if (method === 'addProductionPlan') throw new Error('Simulated Draft write failure.')
            return super.addProductionPlan(plan)
          }
          override async deleteDraftProductionPlans(): Promise<ProductionPlanId[]> {
            if (method === 'deleteDraftProductionPlans') throw new Error('Simulated Draft deletion failure.')
            return super.deleteDraftProductionPlans()
          }
        }
        return { ...createPlannerResultPersistenceRepositories(database), productionPlans: new FailingProductionPlanRepository(database) }
      }
    }

    it.each(['addProductionPlan', 'deleteDraftProductionPlans'] as const)('the Draft write (%s) after the Entry replacements', (method) =>
      withScenario(async (scenario) => {
        await expectRefused(scenario, () => scenario.service.saveBuildListOptimizationAdoption(scenario.source(), scenario.context), 'transaction_failed')
        // The previous Draft and every replaced Entry survive.
        expect(await scenario.database.productionPlans.get(PREVIOUS_DRAFT_ID)).toBeDefined()
        for (const { replacedBuildListEntryId } of scenario.fixture.artifact.replacements) {
          expect(await scenario.database.buildListEntries.get(replacedBuildListEntryId)).toBeDefined()
        }
      }, { createRepositories: failingPlans(method) }))

    it('the generated Entry write', () =>
      withScenario(async (scenario) => {
        scenario.database.buildListEntries.hook('creating', () => {
          throw new Error('Simulated Entry write failure.')
        })
        await expectRefused(scenario, () => scenario.service.saveBuildListOptimizationAdoption(scenario.source(), scenario.context), 'transaction_failed')
      }))
  })
})

describe('Build List optimization adoption: the artifact itself ([P1])', () => {
  it.each(ATTEMPTS)('%s: refuses an ordinary Planner result or a repair-shaped artifact in place of an optimization artifact', (kind) =>
    withScenario(async (scenario) => {
      const { fixture } = scenario
      const ordinary: PlannerResult = structuredClone(fixture.artifact.plannerResult)
      // The fields of the removed Planner Alternative repair artifact (Issue #278
      // PR-7), built structurally: a Plan, generated Entries, replacement pairs
      // and a repair lineage, without the optimization artifact's input token,
      // planning Targets, exclusions or summary.
      const repair = {
        plannerResult: structuredClone(fixture.artifact.plannerResult),
        generatedBuildListEntries: structuredClone(fixture.artifact.generatedBuildListEntries),
        generatedBuildListEntryReplacements: structuredClone(fixture.artifact.replacements),
        conflictRepairLineage: { decisions: [] },
      }
      const startSnapshot = { observedDraftPlanId: PREVIOUS_DRAFT_ID, runningPlanAbsent: true as const }
      for (const source of [
        ordinary,
        repair,
        { artifact: ordinary, startSnapshot },
        { artifact: repair, startSnapshot },
        null,
      ]) {
        await expectRefused(scenario, () => attempt(scenario, kind, source as unknown as BuildListOptimizationAdoptionSource), 'planner_result_invalid')
      }
    }))

  it.each(ATTEMPTS)('%s: refuses a start snapshot that names no observed Draft state or a running Plan', (kind) =>
    withScenario(async (scenario) => {
      for (const startSnapshot of [
        { observedDraftPlanId: PREVIOUS_DRAFT_ID, runningPlanAbsent: false },
        { observedDraftPlanId: '', runningPlanAbsent: true },
        { runningPlanAbsent: true },
        null,
      ]) {
        const source = { ...scenario.source(), startSnapshot } as unknown as BuildListOptimizationAdoptionSource
        await expectRefused(scenario, () => attempt(scenario, kind, source), 'planner_result_invalid', 'start snapshot')
      }
    }))

  it.each(ATTEMPTS)('%s: refuses an incomplete or otherwise unfinished Planner result, a Conflict, a rejected Entry and an unexplained warning', (kind) =>
    withScenario(async (scenario) => {
      const variants: [string, (artifact: BuildListOptimizationAdoptionSource['artifact']) => void][] = [
        ['incomplete', (artifact) => { artifact.plannerResult.termination = { ...artifact.plannerResult.termination, status: 'incomplete', reachedLimits: ['max_plan_steps'] } }],
        ['exhausted', (artifact) => { artifact.plannerResult.termination = { ...artifact.plannerResult.termination, status: 'exhausted' } }],
        ['no Plan', (artifact) => { artifact.plannerResult.plan = null }],
        ['a Domain-invalid Plan', (artifact) => { artifact.plannerResult.plan!.id = '' as ProductionPlanId }],
        ['a Conflict', (artifact) => {
          const [first, second] = artifact.plannerResult.plan!.selectedBuildListEntryIds
          const conflict = { id: 'conflict.fixture', kind: 'same_gogma_counter' as const, buildListEntryIds: [first!, second!], reason: 'fixture', recommendedBuildListEntryId: null, selectedBuildListEntryId: null, resolutionNote: null, checkpointParticipants: [] }
          artifact.plannerResult.conflicts = [conflict]
          artifact.plannerResult.plan!.conflicts = [conflict]
        }],
        ['a rejected Entry', (artifact) => {
          artifact.plannerResult.plan!.rejectedBuildListEntries = [{ buildListEntryId: artifact.plannerResult.plan!.selectedBuildListEntryIds[0]!, reason: 'lower_priority' } as ProductionPlan['rejectedBuildListEntries'][number]]
        }],
        ['an unexplained warning', (artifact) => { artifact.plannerResult.warnings.push({ kind: 'max_steps_reached', message: 'Planner reached maxPlanSteps.' }) }],
      ]
      for (const [label, patch] of variants) {
        const source = scenario.source()
        patch(source.artifact)
        await expectRefused(scenario, () => attempt(scenario, kind, source), 'planner_result_invalid').catch((error: unknown) => {
          throw new Error(`${label}: ${String(error)}`)
        })
      }
    }))

  it.each(ATTEMPTS)('%s: refuses a broken physical identity, malformed replacements and an inconsistent Target set', (kind) =>
    withScenario(async (scenario) => {
      const variants: [string, (artifact: BuildListOptimizationAdoptionSource['artifact']) => void][] = [
        ['a Step advancing an extra Counter', (artifact) => {
          const step = artifact.plannerResult.plan!.steps[0]!
          step.rngAdvance = { ...step.rngAdvance, gogmaCounterDelta: step.rngAdvance.gogmaCounterDelta + 1 }
        }],
        ['a structural objective off by one', (artifact) => {
          artifact.summary = { ...artifact.summary, structuralObjective: artifact.summary.structuralObjective + 1, physicalOperationCount: artifact.summary.physicalOperationCount + 1 }
        }],
        ['a replacement naming another Target', (artifact) => {
          artifact.replacements[0] = { ...artifact.replacements[0]!, targetWeaponId: SKILL_ONLY_TARGET_ID }
        }],
        ['a replacement without its generated Entry', (artifact) => { artifact.generatedBuildListEntries = artifact.generatedBuildListEntries.slice(1) }],
        ['duplicated generated Entries', (artifact) => {
          artifact.generatedBuildListEntries = [artifact.generatedBuildListEntries[0]!, artifact.generatedBuildListEntries[0]!]
          artifact.replacements = [artifact.replacements[0]!, artifact.replacements[0]!]
        }],
        ['an excluded Entry replaced', (artifact) => {
          artifact.inputExclusions[0] = { ...artifact.inputExclusions[0]!, buildListEntryId: artifact.replacements[0]!.replacedBuildListEntryId }
        }],
        ['an unchanged out-of-scope Target', (artifact) => { artifact.unchangedTargetWeaponIds = [...artifact.unchangedTargetWeaponIds, STALE_ONLY_TARGET_ID] }],
        ['a missing planning Target', (artifact) => {
          artifact.planningTargetWeaponIds = artifact.planningTargetWeaponIds.filter((id) => id !== SKILL_ONLY_TARGET_ID)
          artifact.unchangedTargetWeaponIds = []
        }],
      ]
      for (const [label, patch] of variants) {
        const source = scenario.source()
        patch(source.artifact)
        await expectRefused(scenario, () => attempt(scenario, kind, source), 'planner_result_invalid').catch((error: unknown) => {
          throw new Error(`${label}: ${String(error)}`)
        })
      }
    }))
})

describe('Build List optimization adoption: the exclusion warnings, kind and message (17.7 item 3)', () => {
  type Artifact = BuildListOptimizationAdoptionSource['artifact']
  /** The Planner warning of one excluded Entry, found by the record's typed Entry ID (never by reading a message). */
  const warningIndexOf = (artifact: Artifact, buildListEntryId: string) => {
    const recorded = artifact.inputExclusions.find((exclusion) => exclusion.buildListEntryId === buildListEntryId)!
    return artifact.plannerResult.warnings.findIndex(({ kind, message }) => kind === recorded.warningKind && message === recorded.warningMessage)
  }
  const recordIndexOf = (artifact: Artifact, buildListEntryId: string) =>
    artifact.inputExclusions.findIndex((exclusion) => exclusion.buildListEntryId === buildListEntryId)
  const variants: [string, (artifact: Artifact) => void, string | RegExp][] = [
    ['1. the same kind with another message', (artifact) => {
      const index = warningIndexOf(artifact, STALE_ENTRY_ID)
      artifact.plannerResult.warnings[index] = { ...artifact.plannerResult.warnings[index]!, message: 'rewritten' }
    }, 'no Stage 0 exclusion explains: [build_list_entry_stale]'],
    ['2. a kind no exclusion recorded', (artifact) => {
      artifact.plannerResult.warnings.push({ kind: 'rng_prediction_unsupported', message: "BuildListEntry 'x' requires unsupported RNG input." })
    }, 'no Stage 0 exclusion explains: [rng_prediction_unsupported]'],
    ["3. one stale Entry's warning swapped for the other's (same kinds)", (artifact) => {
      artifact.plannerResult.warnings[warningIndexOf(artifact, STALE_ENTRY_ID)] = structuredClone(artifact.plannerResult.warnings[warningIndexOf(artifact, STALE_SECOND_ENTRY_ID)]!)
    }, 'no Stage 0 exclusion explains: [build_list_entry_stale]'],
    ['4. a recorded warning beyond its multiplicity', (artifact) => {
      artifact.plannerResult.warnings.push(structuredClone(artifact.plannerResult.warnings[warningIndexOf(artifact, COMPLETED_ENTRY_ID)]!))
    }, 'no Stage 0 exclusion explains: [completed_target_excluded]'],
    ['5a. a record without its message', (artifact) => {
      artifact.inputExclusions[0] = { ...artifact.inputExclusions[0]!, warningMessage: '' }
    }, 'warning kind and warning message'],
    ['5b. a record whose message is not the warning the run reported', (artifact) => {
      const index = recordIndexOf(artifact, COMPLETED_ENTRY_ID)
      artifact.inputExclusions[index] = { ...artifact.inputExclusions[index]!, warningMessage: 'another message' }
    }, 'no Stage 0 exclusion explains: [completed_target_excluded]'],
    ['6a. one excluded Entry recorded twice', (artifact) => {
      const completed = artifact.inputExclusions[recordIndexOf(artifact, COMPLETED_ENTRY_ID)]!
      artifact.inputExclusions.push({ ...completed, warningKind: 'build_list_entry_stale', warningMessage: 'a second exclusion warning' })
      artifact.plannerResult.warnings.push({ kind: 'build_list_entry_stale', message: 'a second exclusion warning' })
    }, 'is recorded with more than one exclusion warning'],
    ['6b. a record naming another Target than its Entry\'s', (artifact) => {
      const index = recordIndexOf(artifact, STALE_ENTRY_ID)
      artifact.inputExclusions[index] = { ...artifact.inputExclusions[index]!, targetWeaponId: NO_ENTRY_TARGET_ID }
    }, `is not an Entry of that Target in the Build List the optimization was calculated over`],
    ['6c. a record naming an Entry outside the Build List', (artifact) => {
      const index = recordIndexOf(artifact, STALE_ENTRY_ID)
      artifact.inputExclusions[index] = { ...artifact.inputExclusions[index]!, buildListEntryId: 'build-list.scope.ghost' as BuildListEntryId }
    }, "'build-list.scope.ghost'"],
  ]

  it.each(ATTEMPTS)('%s: refuses every inconsistent exclusion warning record as planner_result_invalid and changes nothing', (kind) =>
    withScenario(async (scenario) => {
      for (const [label, patch, message] of variants) {
        const source = scenario.source()
        patch(source.artifact)
        await expectRefused(scenario, () => attempt(scenario, kind, source), 'planner_result_invalid', message).catch((error: unknown) => {
          throw new Error(`${label}: ${String(error)}`)
        })
      }
      // The untouched artifact is still adoptable: every refusal above was the warning record's.
      await expect(attempt(scenario, kind)).resolves.toBeDefined()
    }))
})

describe('Build List optimization adoption: the other saves are unchanged', () => {
  it('the ordinary Planner save cannot store a replacement-bearing optimization Plan over the current Build List', () =>
    withScenario(async (scenario) => {
      const { service, fixture, context } = scenario
      await expectRefused(scenario, () => service.savePlannerResult(structuredClone(fixture.artifact.plannerResult), context), 'planner_state_changed', 'PlanningInputSnapshot.buildListEntriesHash')
    }))
})
