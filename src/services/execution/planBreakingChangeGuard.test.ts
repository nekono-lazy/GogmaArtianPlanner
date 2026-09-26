import { describe, expect, it, vi } from 'vitest'
import { DATABASE_SCHEMA_VERSION, type AppDatabase } from '../../db/AppDatabase'
import { RepositoryError } from '../../db/repositoryError'
import { BuildListEntryRepository } from '../../db/repositories/buildListEntryRepository'
import { RngStateRepository } from '../../db/repositories/rngStateRepository'
import {
  ExecutionRuntimeError,
  PlanBreakingChangeApprovalRequiredError,
  type PlanAbandonSavePointDecision,
  type PlanBreakingChangeApproval,
  type PlanBreakingChangeInspection,
} from '../../domain/execution'
import type { MasterDataRoot } from '../../domain/master/masterTypes'
import { EXPORT_SCHEMA_VERSION } from '../../domain/models/exportModel'
import type {
  BuildListEntry,
  NormalArtianCounter,
  OwnedWeapon,
  PlanStep,
  ProductionPlan,
  RngState,
  TargetWeapon,
} from '../../domain/models/publicTypes'
import { CURRENT_CALCULATION_APP_SCHEMA_VERSION } from '../../domain/models/publicTypes'
import { ProductionRngEngine } from '../../domain/rng/production/productionRngEngine'
import {
  confirmCurrent,
  currentPlan,
  dump,
  executionService,
  existingGogmaFixture,
  expectRefusal,
  newNormalFixture,
  seed,
  stepOf,
  withDatabase,
  type ExecutionFixture,
} from '../../test/fixtures/executionRuntime'
import { orchestrationSource, orchestrationTarget } from '../../test/fixtures/plannerConstrainedOrchestration'
import { searchCandidates } from '../../domain/search/candidateSearch'
import { createCandidateSearchInput } from '../search/createCandidateSearchInput'
import { createDefaultAppSettings } from '../../domain/models/publicTypes'
import { BuildListService, type BuildListCandidateReplacementRequest } from '../buildList/buildListService'
import {
  EntityFormValidationError,
  OwnedWeaponCrudService,
  ReferencedEntityDeleteError,
  TargetWeaponCrudService,
  type OwnedWeaponDraft,
  type TargetWeaponDraft,
} from '../crud/entityCrudServices'
import { IdentificationAdoptionService } from '../rngIdentification/identificationAdoptionService'
import { RngStatePersistenceService } from '../rngState/rngStatePersistenceService'
import { PlanBreakingChangeGuard } from './planBreakingChangeGuard'

// The Plans come from the real Planner over its fixture Master, whose weapon
// types are not Production weapon types. Production bonus availability is
// covered by the CRUD service tests; here it accepts the fixture entities so
// every other part of the ordinary save - Domain validation, preference
// releases, reference protection - runs for real.
vi.mock('../../domain/artian/entityMasterValidation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../domain/artian/entityMasterValidation')>()),
  validateOwnedWeaponMasterReferences: () => [],
  validateTargetWeaponMasterReferences: () => [],
}))

const GUARD_NOW = '2026-09-18T00:00:00.000Z'
const SOURCE_ID = 'owned.execution.gogma'
const GOAL_ID = 'target.execution.gogma'
const OTHER_TARGET_ID = 'target.execution.other'
const GOGMA_ENTRY_ID = 'entry.execution.gogma'
const NEW_NORMAL_TARGET_ID = 'target.execution.new-normal'
const CREATED_WEAPON_ID = 'owned.orchestration.created.1'

function servicesFor(database: AppDatabase, fixture: ExecutionFixture) {
  const guard = new PlanBreakingChangeGuard({
    database,
    currentCalculationContext: structuredClone(fixture.built.input.calculationContext),
    clock: { now: () => GUARD_NOW },
  })
  const master = fixture.built.input.master as unknown as MasterDataRoot
  const clock = { now: () => GUARD_NOW }
  return {
    guard,
    owned: new OwnedWeaponCrudService(master, {
      getAll: () => database.ownedWeapons.toArray(),
      getTargets: () => database.targetWeapons.toArray(),
      persistence: guard,
    }),
    targets: new TargetWeaponCrudService(master, {
      getAll: () => database.targetWeapons.toArray(),
      getOwnedWeapons: () => database.ownedWeapons.toArray(),
      persistence: guard,
    }),
    buildList: new BuildListService({
      getAllEntries: () => database.buildListEntries.toArray(),
      putEntry: async (entry) => {
        await database.buildListEntries.put(entry)
        return entry
      },
      decideAndAddEntry: (decide) => new BuildListEntryRepository(database).decideAndAddBuildListEntry(decide),
      ensureRngState: async () => (await database.rngState.get('current')) as RngState,
      getNormalCounters: () => database.normalArtianCounters.toArray(),
      getOwnedWeapons: () => database.ownedWeapons.toArray(),
      getTargets: () => database.targetWeapons.toArray(),
      persistence: guard,
    }),
    rng: new RngStatePersistenceService({ persistence: guard, clock }),
    adoption: new IdentificationAdoptionService({
      repository: new RngStateRepository(database),
      persistence: guard,
      seedNormalizer: new ProductionRngEngine(),
      clock,
    }),
  }
}

type Services = ReturnType<typeof servicesFor>

async function started(database: AppDatabase, fixture: ExecutionFixture) {
  await seed(database, fixture)
  const execution = executionService(database, fixture.built)
  await execution.startProductionPlan(fixture.plan.id)
  return { execution, services: servicesFor(database, fixture) }
}

function draftOf<T extends { id: unknown; createdAt: unknown; updatedAt: unknown }>(value: T) {
  const { id: _id, createdAt: _created, updatedAt: _updated, ...draft } = value
  void _id
  void _created
  void _updated
  return draft
}

async function stored<T>(table: { get(id: string): Promise<T | undefined> }, id: string): Promise<T> {
  return (await table.get(id)) as T
}

function approvalOf(
  inspection: PlanBreakingChangeInspection,
  decision: 'keep_current' | 'restore_save_point' | null = null,
): PlanBreakingChangeApproval {
  if (!inspection.approvalRequired) throw new Error('The change was expected to need approval.')
  const savePointDecision: PlanAbandonSavePointDecision = inspection.savePointChoiceRequired
    ? { kind: decision ?? 'keep_current', recordedAt: inspection.savePointRecordedAt }
    : null
  return { observedPlan: inspection.observedPlan, savePointDecision }
}

/** An RNG Setup edit of the Gogma Counter, with the RngState the screen edited as its basis. */
async function rngEdit(database: AppDatabase, gogmaCounter = 50) {
  const basis = await stored<RngState>(database.rngState, 'current')
  return { next: { ...basis, gogmaCounter: { ...basis.gogmaCounter, value: gogmaCounter } }, basis }
}

async function saveRng(services: Services, database: AppDatabase, decision: 'keep_current' | 'restore_save_point' | null = null) {
  const { next, basis } = await rngEdit(database)
  const approval = approvalOf(await services.rng.inspectRngStateSave(next, basis), decision)
  return services.rng.saveRngState(next, basis, approval)
}

async function targetPriorityEdit(services: Services, database: AppDatabase, id = GOAL_ID) {
  const basis = await stored<TargetWeapon>(database.targetWeapons, id)
  const draft = { ...draftOf(basis), priority: basis.priority === 1 ? 2 : 1 } as TargetWeaponDraft
  return { basis, draft, inspection: () => services.targets.inspectSave(draft, basis, GUARD_NOW) }
}

function abandonedBreaking(plan: ProductionPlan): ProductionPlan {
  return {
    ...plan,
    status: 'abandoned',
    abandonmentReason: 'breaking_change_approved',
    abandonedAt: GUARD_NOW,
    completedAt: null,
    updatedAt: GUARD_NOW,
  }
}

describe('Plan-breaking saves without approval', () => {
  it('refuses every breaking save on an active Plan and writes nothing', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      const { execution, services } = await started(database, fixture)
      await confirmCurrent(execution, database, fixture.plan)

      const { next, basis } = await rngEdit(database)
      await expectRefusal(() => services.rng.saveRngState(next, basis), database, 'plan_breaking_change_approval_required')

      await expectRefusal(
        () => services.adoption.adopt({ baseSeed: '086315169', startingSkillCounter: 186, startingGogmaCounter: 480 }),
        database,
        'plan_breaking_change_approval_required',
      )

      const source = await stored<OwnedWeapon>(database.ownedWeapons, SOURCE_ID)
      await expectRefusal(
        () => services.owned.save({ ...draftOf(source), isProtected: true } as OwnedWeaponDraft, source, GUARD_NOW),
        database,
        'plan_breaking_change_approval_required',
      )

      const edit = await targetPriorityEdit(services, database)
      await expectRefusal(() => services.targets.save(edit.draft, edit.basis, GUARD_NOW), database, 'plan_breaking_change_approval_required')

      await expectRefusal(
        () => services.buildList.updateIntermediateStateSelection(GOGMA_ENTRY_ID as BuildListEntry['id'], {
          skillOpportunityId: null,
          bonusOpportunityId: null,
          improvementPreference: 'skill_first',
        }),
        database,
        'plan_breaking_change_approval_required',
      )
      await expectRefusal(
        () => services.buildList.deleteEntry(GOGMA_ENTRY_ID as BuildListEntry['id']),
        database,
        'plan_breaking_change_approval_required',
      )
      expect(await currentPlan(database, fixture.plan)).toMatchObject({ status: 'active', abandonmentReason: null })
    }))

  it('carries the warning content on the refusal, matching the inspection', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      const { execution, services } = await started(database, fixture)
      await confirmCurrent(execution, database, fixture.plan)
      const plan = await currentPlan(database, fixture.plan)
      const source = await stored<OwnedWeapon>(database.ownedWeapons, SOURCE_ID)
      const draft = { ...draftOf(source), isProtected: true } as OwnedWeaponDraft
      const before = await dump(database)

      const inspection = await services.owned.inspectSave(draft, source, GUARD_NOW)
      expect(await dump(database)).toEqual(before)
      // Protecting the tracked weapon also releases the Plan-dependent Target
      // that Execution linked to it.
      expect(inspection).toEqual({
        approvalRequired: true,
        reasons: ['owned_weapon_changed', 'target_changed'],
        observedPlan: { planId: plan.id, status: 'active', currentStepId: plan.currentStepId, updatedAt: plan.updatedAt },
        savePointChoiceRequired: false,
      })
      const error = await services.owned.save(draft, source, GUARD_NOW).catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(PlanBreakingChangeApprovalRequiredError)
      expect((error as PlanBreakingChangeApprovalRequiredError).inspection).toEqual(inspection)
    }))

  it('refuses a Normal Counter confirmation change on an active Plan', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(3)
      const { services } = await started(database, fixture)
      const [counter] = await database.normalArtianCounters.toArray()

      await expectRefusal(
        () => services.rng.saveNormalArtianCounter({ ...counter, isConfirmed: false }, counter),
        database,
        'plan_breaking_change_approval_required',
      )
      await expectRefusal(
        () => services.rng.saveNormalArtianCounter({ ...counter, counter: 40 }, counter),
        database,
        'plan_breaking_change_approval_required',
      )
      expect(await services.rng.inspectNormalArtianCounterSave({ ...counter, counter: 40 }, counter))
        .toMatchObject({ approvalRequired: true, reasons: ['normal_counter_changed'] })
    }))
})

describe('Non-breaking saves on an active Plan', () => {
  it('38.5-F: adds a Target during execution and searches it from the persisted current position', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(3)
      const { execution, services } = await started(database, fixture)
      await confirmCurrent(execution, database, fixture.plan)
      const before = await dump(database)
      const draft = draftOf(orchestrationTarget('target.acceptance.added'))
      expect(await services.targets.inspectSave(draft, null, GUARD_NOW)).toMatchObject({ approvalRequired: false })
      const added = await services.targets.save(draft, null, GUARD_NOW)
      const input = await createCandidateSearchInput({
        searchRunId: 'acceptance-active-plan', targetWeaponId: added.id, routeFilter: 'normal_artian',
        settings: { maxNormalAdvance: 1, maxGogmaAdvance: 1, maxSkillAdvance: 1 },
        master: fixture.built.input.master as unknown as MasterDataRoot,
        calculationContext: fixture.built.input.calculationContext,
      }, {
        ensureInitialRngState: async () => (await database.rngState.get('current')) as RngState,
        getAllNormalArtianCounters: () => database.normalArtianCounters.toArray(),
        getAllOwnedWeapons: () => database.ownedWeapons.toArray(),
        getAllTargetWeapons: () => database.targetWeapons.toArray(),
        ensureSettings: async () => createDefaultAppSettings(GUARD_NOW),
      })
      expect(input.normalCounters[0].counter).toBe(fixture.built.input.normalCounters[0].counter! + 1)
      const result = await searchCandidates(input, fixture.built.engine)
      expect(result.targetResult.targetWeaponId).toBe(added.id)
      expect(result.targetResult.candidate).not.toBeNull()
      const after = await dump(database)
      expect(after.productionPlans).toEqual(before.productionPlans)
      expect(after.productionPlans[0].status).toBe('active')
      expect({ ...after, targetWeapons: [] }).toEqual({ ...before, targetWeapons: [] })
      expect(after.targetWeapons).toEqual(expect.arrayContaining([...before.targetWeapons, added]))
      // The same active Plan can still confirm its next Step.
      expect((await confirmCurrent(execution, database, fixture.plan)).plan.status).toBe('active')
    }))

  it('saves status, name and memo of a tracked weapon and non-semantic Target edits without approval', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      const { execution, services } = await started(database, fixture)
      await confirmCurrent(execution, database, fixture.plan)
      const plan = await currentPlan(database, fixture.plan)

      const source = await stored<OwnedWeapon>(database.ownedWeapons, SOURCE_ID)
      const edited = { ...draftOf(source), status: 'practical', name: 'renamed', memo: 'memo' } as OwnedWeaponDraft
      expect(await services.owned.inspectSave(edited, source, GUARD_NOW)).toEqual({ approvalRequired: false })
      const saved = await services.owned.save(edited, source, GUARD_NOW)
      expect(saved).toMatchObject({ status: 'practical', name: 'renamed', memo: 'memo', executionInProgress: source.executionInProgress })

      const goal = await stored<TargetWeapon>(database.targetWeapons, GOAL_ID)
      await services.targets.save({ ...draftOf(goal), name: 'renamed goal', memo: 'memo' } as TargetWeaponDraft, goal, GUARD_NOW)

      // A Plan-independent Target, a new Target and a new weapon.
      const other = await stored<TargetWeapon>(database.targetWeapons, OTHER_TARGET_ID)
      await services.targets.save({ ...draftOf(other), priority: 1, isEnabled: false } as TargetWeaponDraft, other, GUARD_NOW)
      await services.targets.save(draftOf(orchestrationTarget('target.guard.new')) as TargetWeaponDraft, null, GUARD_NOW)
      await services.owned.save(draftOf(orchestrationSource('owned.guard.new')) as OwnedWeaponDraft, null, GUARD_NOW)

      // RNG notes are no Plan premise.
      const rng = await stored<RngState>(database.rngState, 'current')
      await services.rng.saveRngState({ ...rng, notes: 'edited note' }, rng)

      expect(await currentPlan(database, fixture.plan)).toEqual(plan)
      expect(await database.targetWeapons.count()).toBe(3)
      expect(await database.ownedWeapons.count()).toBe(2)
      expect((await stored<RngState>(database.rngState, 'current')).notes).toBe('edited note')
    }))

  it('saves a Plan-independent Build List Entry change or delete without approval', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      const { services } = await started(database, fixture)
      const plan = await currentPlan(database, fixture.plan)
      const entry = await stored<BuildListEntry>(database.buildListEntries, GOGMA_ENTRY_ID)
      const other = { ...structuredClone(entry), id: 'entry.guard.independent' as BuildListEntry['id'] }
      await database.buildListEntries.put(other)

      await services.buildList.updateIntermediateStateSelection(other.id, {
        skillOpportunityId: null,
        bonusOpportunityId: null,
        improvementPreference: 'bonus_first',
      })
      expect((await stored<BuildListEntry>(database.buildListEntries, other.id)).intermediateStateSelection?.improvementPreference)
        .toBe('bonus_first')
      await services.buildList.deleteEntry(other.id)
      expect(await database.buildListEntries.get(other.id)).toBeUndefined()
      await services.buildList.refreshStaleness(fixture.built.input.calculationContext)

      expect(await currentPlan(database, fixture.plan)).toEqual(plan)
    }))

  it('saves Normal Counter observation metadata without approval', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(3)
      const { services } = await started(database, fixture)
      const plan = await currentPlan(database, fixture.plan)
      const [counter] = await database.normalArtianCounters.toArray()

      await services.rng.saveNormalArtianCounter({ ...counter, observationCount: 9, candidateCount: 1 }, counter)

      expect(await database.normalArtianCounters.get(counter.id)).toMatchObject({ observationCount: 9, counter: counter.counter })
      expect(await currentPlan(database, fixture.plan)).toEqual(plan)
    }))
})

describe('Breaking changes caused by a side effect', () => {
  it('needs approval when a Plan-independent Target takes the weapon over from a Plan-dependent one', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      const { execution, services } = await started(database, fixture)
      await confirmCurrent(execution, database, fixture.plan)
      expect(await stored<TargetWeapon>(database.targetWeapons, GOAL_ID)).toMatchObject({ preferredOwnedWeaponId: SOURCE_ID })

      const other = await stored<TargetWeapon>(database.targetWeapons, OTHER_TARGET_ID)
      const takeover = { ...draftOf(other), preferredOwnedWeaponId: SOURCE_ID } as TargetWeaponDraft
      expect(await services.targets.inspectSave(takeover, other, GUARD_NOW))
        .toMatchObject({ approvalRequired: true, reasons: ['target_changed'] })
      await expectRefusal(() => services.targets.save(takeover, other, GUARD_NOW), database, 'plan_breaking_change_approval_required')

      // A new Target doing the same is no longer a plain addition.
      const created = { ...draftOf(orchestrationTarget('target.guard.new')), preferredOwnedWeaponId: SOURCE_ID } as TargetWeaponDraft
      expect(await services.targets.inspectSave(created, null, GUARD_NOW))
        .toMatchObject({ approvalRequired: true, reasons: ['target_changed'] })
    }))
})

describe('A stale Plan is never warned about', () => {
  it('saves every change as usual and leaves the stale Plan, save point, history and in-progress marks alone', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      const { execution, services } = await started(database, fixture)
      const savePoint = await execution.recordExecutionSavePoint({ planId: fixture.plan.id })
      await confirmCurrent(execution, database, fixture.plan)
      const stale = await currentPlan(database, fixture.plan)
      await execution.recordOperationUncertain({ planId: fixture.plan.id, planStepId: stale.currentStepId as PlanStep['id'] })
      const before = await dump(database)
      const plan = await currentPlan(database, fixture.plan)
      expect(plan.status).toBe('stale')

      const { next, basis } = await rngEdit(database)
      expect(await services.rng.inspectRngStateSave(next, basis)).toEqual({ approvalRequired: false })
      await services.rng.saveRngState(next, basis)
      const edit = await targetPriorityEdit(services, database)
      await services.targets.save(edit.draft, edit.basis, GUARD_NOW)
      const source = await stored<OwnedWeapon>(database.ownedWeapons, SOURCE_ID)
      const savedSource = await services.owned.save({ ...draftOf(source), seriesSkillId: 'series_skill.fixture.y' } as OwnedWeaponDraft, source, GUARD_NOW)
      await services.buildList.updateIntermediateStateSelection(GOGMA_ENTRY_ID as BuildListEntry['id'], {
        skillOpportunityId: null,
        bonusOpportunityId: null,
        improvementPreference: 'skill_first',
      })

      expect(await currentPlan(database, fixture.plan)).toEqual(plan)
      expect(plan.abandonmentReason).toBeNull()
      expect(await database.executionSavePoints.toArray()).toEqual([savePoint])
      expect(await database.executionHistory.toArray()).toEqual(before.executionHistory)
      expect(savedSource.executionInProgress).toEqual({ productionPlanId: fixture.plan.id, startedAt: expect.any(String) })
      expect((await stored<RngState>(database.rngState, 'current')).gogmaCounter.value).toBe(50)
      expect((await stored<TargetWeapon>(database.targetWeapons, GOAL_ID)).priority).toBe(edit.draft.priority)
    }))
})

describe('Approved breaking changes', () => {
  it('keeps the current state: saves the change and abandons the Plan with every record kept', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(3)
      const { execution, services } = await started(database, fixture)
      await confirmCurrent(execution, database, fixture.plan)
      await execution.recordExecutionSavePoint({ planId: fixture.plan.id })
      await confirmCurrent(execution, database, fixture.plan)
      await confirmCurrent(execution, database, fixture.plan)
      const plan = await currentPlan(database, fixture.plan)
      const before = await dump(database)
      expect(await stored<OwnedWeapon>(database.ownedWeapons, CREATED_WEAPON_ID)).toMatchObject({
        executionInProgress: { productionPlanId: plan.id },
      })

      const { next, basis } = await rngEdit(database)
      const inspection = await services.rng.inspectRngStateSave(next, basis)
      expect(inspection).toMatchObject({ approvalRequired: true, reasons: ['rng_state_changed'], savePointChoiceRequired: true })
      const saved = await services.rng.saveRngState(next, basis, approvalOf(inspection, 'keep_current'))

      expect(saved.gogmaCounter.value).toBe(50)
      expect(await stored<RngState>(database.rngState, 'current')).toEqual(saved)
      expect(await currentPlan(database, fixture.plan)).toEqual(abandonedBreaking(plan))
      expect((await currentPlan(database, fixture.plan)).currentStepId).toBe(stepOf(fixture.plan, 3).id)
      const weapon = before.ownedWeapons.find(({ id }) => id === CREATED_WEAPON_ID) as OwnedWeapon
      expect(await database.ownedWeapons.toArray()).toEqual([{ ...weapon, executionInProgress: null, updatedAt: GUARD_NOW }])
      // The preference Execution linked stays: ending a Plan never releases it.
      expect(await database.targetWeapons.toArray()).toEqual(before.targetWeapons)
      expect((await stored<TargetWeapon>(database.targetWeapons, NEW_NORMAL_TARGET_ID)).preferredOwnedWeaponId).toBe(CREATED_WEAPON_ID)
      expect(await database.normalArtianCounters.toArray()).toEqual(before.normalCounters)
      expect(await database.executionHistory.toArray()).toEqual(before.executionHistory)
      expect(await database.executionSavePoints.count()).toBe(0)
    }))

  it('asks no save point choice without a save point, and refuses a decision given anyway', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      const { execution, services } = await started(database, fixture)
      await confirmCurrent(execution, database, fixture.plan)
      const plan = await currentPlan(database, fixture.plan)
      const before = await dump(database)
      const edit = await targetPriorityEdit(services, database)
      const inspection = await edit.inspection()
      expect(inspection).toMatchObject({ approvalRequired: true, reasons: ['target_changed'], savePointChoiceRequired: false })
      const approval = approvalOf(inspection)
      expect(approval.savePointDecision).toBeNull()

      await expectRefusal(
        () => services.targets.save(edit.draft, edit.basis, GUARD_NOW, { ...approval, savePointDecision: { kind: 'keep_current', recordedAt: GUARD_NOW } }),
        database,
        'save_point_choice_not_required',
      )
      const saved = await services.targets.save(edit.draft, edit.basis, GUARD_NOW, approval)

      expect(saved.priority).toBe(edit.draft.priority)
      // The link Execution made is kept: only the user's own edit changes the Target.
      expect(saved.preferredOwnedWeaponId).toBe(SOURCE_ID)
      expect(await currentPlan(database, fixture.plan)).toEqual(abandonedBreaking(plan))
      expect(await stored<OwnedWeapon>(database.ownedWeapons, SOURCE_ID)).toMatchObject({ executionInProgress: null })
      expect(await database.executionHistory.toArray()).toEqual(before.executionHistory)
    }))

  it('also asks nothing when the save point is at the current position', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      const { execution, services } = await started(database, fixture)
      await confirmCurrent(execution, database, fixture.plan)
      await execution.recordExecutionSavePoint({ planId: fixture.plan.id })
      const edit = await targetPriorityEdit(services, database)
      const inspection = await edit.inspection()
      expect(inspection).toMatchObject({ approvalRequired: true, savePointChoiceRequired: false })

      await services.targets.save(edit.draft, edit.basis, GUARD_NOW, approvalOf(inspection))
      expect(await database.executionSavePoints.count()).toBe(0)
      expect(await currentPlan(database, fixture.plan)).toMatchObject({ status: 'abandoned', abandonmentReason: 'breaking_change_approved' })
    }))

  it('restores the save point first, then saves the RNG edit over it and abandons the restored Plan', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(3)
      const { execution, services } = await started(database, fixture)
      const first = await confirmCurrent(execution, database, fixture.plan)
      const savePoint = await execution.recordExecutionSavePoint({ planId: fixture.plan.id })
      await confirmCurrent(execution, database, fixture.plan)
      await confirmCurrent(execution, database, fixture.plan)
      await confirmCurrent(execution, database, fixture.plan)
      const beforeRestore = await stored<RngState>(database.rngState, 'current')
      // The conversion after the save point moved the Skill Counter.
      expect(beforeRestore.skillCounter.value).not.toBe(savePoint.rngState.skillCounter.value)

      const { next, basis } = await rngEdit(database)
      const inspection = await services.rng.inspectRngStateSave(next, basis)
      expect(inspection).toMatchObject({
        savePointChoiceRequired: true,
        savePointRecordedAt: savePoint.recordedAt,
        savePointLastExecutionHistoryId: first.history.id,
        savePointCurrentStepId: stepOf(fixture.plan, 1).id,
      })
      const saved = await services.rng.saveRngState(next, basis, approvalOf(inspection, 'restore_save_point'))

      // The user's edit over the restored RngState: the Counter they did not
      // touch keeps its save point value.
      expect(saved).toEqual({
        ...savePoint.rngState,
        gogmaCounter: { ...savePoint.rngState.gogmaCounter, value: 50 },
        updatedAt: GUARD_NOW,
      })
      expect(await stored<RngState>(database.rngState, 'current')).toEqual(saved)
      expect(await database.normalArtianCounters.toArray()).toEqual(savePoint.normalCounters)
      expect(await currentPlan(database, fixture.plan)).toEqual(abandonedBreaking(savePoint.productionPlan))
      expect((await database.executionHistory.toArray()).map(({ id }) => id)).toEqual([first.history.id])
      // The weapon registered after the save point is gone, and its link with it.
      expect(await database.ownedWeapons.get(CREATED_WEAPON_ID)).toBeUndefined()
      expect((await stored<TargetWeapon>(database.targetWeapons, NEW_NORMAL_TARGET_ID)).preferredOwnedWeaponId).toBeNull()
      expect(await database.executionSavePoints.count()).toBe(0)
    }))

  it('restores the save point before a Target edit without writing back the pre-restore preference', () =>
    withDatabase(async (database) => {
      // A production-target Normal is linked by its registration Step, so a
      // save point recorded before that Step does not hold the link.
      const fixture = await newNormalFixture(1)
      const { execution, services } = await started(database, fixture)
      const savePoint = await execution.recordExecutionSavePoint({ planId: fixture.plan.id })
      await confirmCurrent(execution, database, fixture.plan)
      const edit = await targetPriorityEdit(services, database, NEW_NORMAL_TARGET_ID)
      // What the screen showed: the link Execution made after the save point.
      expect(edit.basis.preferredOwnedWeaponId).toBe(CREATED_WEAPON_ID)
      const snapshotGoal = savePoint.targetWeapons.find(({ id }) => id === NEW_NORMAL_TARGET_ID) as TargetWeapon
      expect(snapshotGoal.preferredOwnedWeaponId).toBeNull()

      const saved = await services.targets.save(edit.draft, edit.basis, GUARD_NOW, approvalOf(await edit.inspection(), 'restore_save_point'))

      expect(saved).toEqual({ ...snapshotGoal, priority: edit.draft.priority, compromiseNeedsReview: false, updatedAt: GUARD_NOW })
      expect(await stored<TargetWeapon>(database.targetWeapons, NEW_NORMAL_TARGET_ID)).toEqual(saved)
      expect(await database.ownedWeapons.get(CREATED_WEAPON_ID)).toBeUndefined()
      expect(await database.ownedWeapons.toArray()).toEqual(savePoint.ownedWeapons)
      expect(await currentPlan(database, fixture.plan)).toEqual(abandonedBreaking(savePoint.productionPlan))
      expect(await database.executionHistory.count()).toBe(0)
      expect(await database.executionSavePoints.count()).toBe(0)
    }))

  it('restores the save point before an OwnedWeapon edit, applying only the field the user changed', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      const { execution, services } = await started(database, fixture)
      const savePoint = await execution.recordExecutionSavePoint({ planId: fixture.plan.id })
      await confirmCurrent(execution, database, fixture.plan)
      const source = await stored<OwnedWeapon>(database.ownedWeapons, SOURCE_ID)
      const snapshotSource = savePoint.ownedWeapons.find(({ id }) => id === SOURCE_ID) as OwnedWeapon
      expect(source.restorationBonuses).not.toEqual(snapshotSource.restorationBonuses)
      expect(source.executionInProgress).not.toBeNull()
      const draft = { ...draftOf(source), isProtected: true } as OwnedWeaponDraft
      const inspection = await services.owned.inspectSave(draft, source, GUARD_NOW)

      const saved = await services.owned.save(draft, source, GUARD_NOW, approvalOf(inspection, 'restore_save_point'))

      // The restored five slots and in-progress state stay; only protection is the user's.
      expect(saved).toEqual({ ...snapshotSource, isProtected: true, updatedAt: GUARD_NOW })
      expect(saved.executionInProgress).toBeNull()
      expect(await stored<OwnedWeapon>(database.ownedWeapons, SOURCE_ID)).toEqual(saved)
      // The Plan start linked the weapon to the Plan's Target before the save
      // point; protecting it releases that restored link, and the Target the
      // start released stays released.
      expect(await stored<TargetWeapon>(database.targetWeapons, GOAL_ID)).toMatchObject({ preferredOwnedWeaponId: null, updatedAt: GUARD_NOW })
      expect(await stored<TargetWeapon>(database.targetWeapons, OTHER_TARGET_ID)).toMatchObject({ preferredOwnedWeaponId: null })
      expect(await stored<RngState>(database.rngState, 'current')).toEqual(savePoint.rngState)
      expect(await currentPlan(database, fixture.plan)).toEqual(abandonedBreaking(savePoint.productionPlan))
      expect(await database.executionHistory.count()).toBe(0)
      expect(await database.executionSavePoints.count()).toBe(0)
    }))

  it('keeps the restored Normal when the weapon shown as Gogma returns to Normal by the restore', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(3)
      const { execution, services } = await started(database, fixture)
      await confirmCurrent(execution, database, fixture.plan)
      await confirmCurrent(execution, database, fixture.plan)
      await confirmCurrent(execution, database, fixture.plan)
      const savePoint = await execution.recordExecutionSavePoint({ planId: fixture.plan.id })
      const lastBeforeSavePoint = savePoint.lastExecutionHistoryId
      await confirmCurrent(execution, database, fixture.plan)
      const snapshotWeapon = savePoint.ownedWeapons.find(({ id }) => id === CREATED_WEAPON_ID) as OwnedWeapon
      expect(snapshotWeapon.kind).toBe('normal')
      expect(snapshotWeapon.executionInProgress).not.toBeNull()
      // The screen shows the weapon after the conversion: the same ID, now Gogma.
      const shown = await stored<OwnedWeapon>(database.ownedWeapons, CREATED_WEAPON_ID)
      expect(shown.kind).toBe('gogma')
      const draft = { ...draftOf(shown), isProtected: true } as OwnedWeaponDraft
      const inspection = await services.owned.inspectSave(draft, shown, GUARD_NOW)
      expect(inspection).toMatchObject({ approvalRequired: true, savePointChoiceRequired: true })

      const saved = await services.owned.save(draft, shown, GUARD_NOW, approvalOf(inspection, 'restore_save_point'))

      expect(saved.kind).toBe('normal')
      expect(saved).toEqual({ ...snapshotWeapon, isProtected: true, executionInProgress: null, updatedAt: GUARD_NOW })
      expect(saved).toMatchObject({ seriesSkillId: null, groupSkillId: null, status: null })
      expect(saved.createdAt).toBe(snapshotWeapon.createdAt)
      expect(await stored<OwnedWeapon>(database.ownedWeapons, CREATED_WEAPON_ID)).toEqual(saved)
      expect(await currentPlan(database, fixture.plan)).toEqual(abandonedBreaking(savePoint.productionPlan))
      expect(await database.executionSavePoints.count()).toBe(0)
      const remaining = await database.executionHistory.toArray()
      expect(remaining).toHaveLength(3)
      expect(remaining.map(({ id }) => id)).toContain(lastBeforeSavePoint)
    }))

  it('returns the tracked weapon exactly as persisted after the Plan ends at the current state', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      const { execution, services } = await started(database, fixture)
      await confirmCurrent(execution, database, fixture.plan)
      const shown = await stored<OwnedWeapon>(database.ownedWeapons, SOURCE_ID)
      expect(shown.executionInProgress).toMatchObject({ productionPlanId: fixture.plan.id })
      const draft = { ...draftOf(shown), isProtected: true } as OwnedWeaponDraft
      const approval = approvalOf(await services.owned.inspectSave(draft, shown, GUARD_NOW))
      expect(approval.savePointDecision).toBeNull()

      const saved = await services.owned.save(draft, shown, GUARD_NOW, approval)

      expect(saved.executionInProgress).toBeNull()
      expect(await stored<OwnedWeapon>(database.ownedWeapons, SOURCE_ID)).toEqual(saved)
      expect(saved).toMatchObject({ isProtected: true, restorationBonuses: shown.restorationBonuses })
      expect(await currentPlan(database, fixture.plan)).toMatchObject({ status: 'abandoned', abandonmentReason: 'breaking_change_approved' })
    }))

  it('returns the tracked weapon exactly as persisted when kept with a save point choice', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      const { execution, services } = await started(database, fixture)
      await execution.recordExecutionSavePoint({ planId: fixture.plan.id })
      await confirmCurrent(execution, database, fixture.plan)
      const shown = await stored<OwnedWeapon>(database.ownedWeapons, SOURCE_ID)
      const draft = { ...draftOf(shown), isProtected: true } as OwnedWeaponDraft

      const saved = await services.owned.save(draft, shown, GUARD_NOW, approvalOf(await services.owned.inspectSave(draft, shown, GUARD_NOW), 'keep_current'))

      expect(saved.executionInProgress).toBeNull()
      expect(await stored<OwnedWeapon>(database.ownedWeapons, SOURCE_ID)).toEqual(saved)
      expect(await database.executionHistory.count()).toBe(1)
    }))

  it('deletes a selected Build List Entry and abandons the Plan together', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      const { execution, services } = await started(database, fixture)
      await confirmCurrent(execution, database, fixture.plan)
      const plan = await currentPlan(database, fixture.plan)
      const entryId = GOGMA_ENTRY_ID as BuildListEntry['id']
      const inspection = await services.buildList.inspectEntryDelete(entryId)
      expect(inspection).toMatchObject({ approvalRequired: true, reasons: ['build_list_changed'] })

      await services.buildList.deleteEntry(entryId, approvalOf(inspection))

      expect(await database.buildListEntries.get(entryId)).toBeUndefined()
      expect(await currentPlan(database, fixture.plan)).toEqual(abandonedBreaking(plan))
    }))

  it('adopts an Identification result and a Normal Counter change with approval', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(3)
      const { services } = await started(database, fixture)
      const plan = await currentPlan(database, fixture.plan)
      const input = { baseSeed: '086315169', startingSkillCounter: 186, startingGogmaCounter: 480 }
      const inspection = await services.adoption.inspectAdoption(input)
      expect(inspection).toMatchObject({ approvalRequired: true, reasons: ['rng_state_changed'] })

      const adopted = await services.adoption.adopt(input, approvalOf(inspection))

      expect(adopted).toMatchObject({ skillCounter: { value: 186 }, gogmaCounter: { value: 480 } })
      expect(await currentPlan(database, fixture.plan)).toEqual(abandonedBreaking(plan))
      // No Plan is active any more, so the Counter change saves without a warning.
      const [counter] = await database.normalArtianCounters.toArray()
      expect(await services.rng.inspectNormalArtianCounterSave({ ...counter, counter: 40 }, counter)).toEqual({ approvalRequired: false })
    }))

  it('adds no ExecutionHistory, is never undoable and moves no version authority', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(3)
      const { execution, services } = await started(database, fixture)
      await confirmCurrent(execution, database, fixture.plan)
      const latest = await confirmCurrent(execution, database, fixture.plan)
      const history = await database.executionHistory.toArray()

      await saveRng(services, database)

      expect(await database.executionHistory.toArray()).toEqual(history)
      await expectRefusal(
        () => execution.undoLatestExecution({ planId: fixture.plan.id, executionHistoryId: latest.history.id }),
        database,
        'undo_not_allowed',
      )
      expect(CURRENT_CALCULATION_APP_SCHEMA_VERSION).toBe(16)
      expect(DATABASE_SCHEMA_VERSION).toBe(10)
      expect(EXPORT_SCHEMA_VERSION).toBe(13)
    }))
})

describe('Approval re-verification inside the transaction', () => {
  it('refuses an approval once the Plan moved on in another tab', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      const { execution, services } = await started(database, fixture)
      const edit = await targetPriorityEdit(services, database)
      const approval = approvalOf(await edit.inspection())
      await confirmCurrent(execution, database, fixture.plan)

      await expectRefusal(() => services.targets.save(edit.draft, edit.basis, GUARD_NOW, approval), database, 'plan_breaking_change_state_changed')
      expect(await currentPlan(database, fixture.plan)).toMatchObject({ status: 'active' })
    }))

  it('refuses an approval once the Plan became stale or ended', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      const { execution, services } = await started(database, fixture)
      const { next, basis } = await rngEdit(database)
      const approval = approvalOf(await services.rng.inspectRngStateSave(next, basis))
      const plan = await currentPlan(database, fixture.plan)
      await execution.recordOperationUncertain({ planId: plan.id, planStepId: plan.currentStepId as PlanStep['id'] })

      await expectRefusal(() => services.rng.saveRngState(next, basis, approval), database, 'plan_breaking_change_state_changed')
    }))

  it('refuses an approval for a change that no longer breaks the Plan', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      const { services } = await started(database, fixture)
      const edit = await targetPriorityEdit(services, database)
      const approval = approvalOf(await edit.inspection())

      await expectRefusal(
        () => services.targets.save({ ...edit.draft, priority: edit.basis.priority }, edit.basis, GUARD_NOW, approval),
        database,
        'plan_breaking_change_approval_not_required',
      )
    }))

  it('refuses a save point decision naming a save point the user did not see', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(3)
      const { execution, services } = await started(database, fixture)
      await confirmCurrent(execution, database, fixture.plan)
      const savePoint = await execution.recordExecutionSavePoint({ planId: fixture.plan.id })
      await confirmCurrent(execution, database, fixture.plan)
      const { next, basis } = await rngEdit(database)
      const approval = approvalOf(await services.rng.inspectRngStateSave(next, basis), 'restore_save_point')

      // Another tab records the save point again: the old choice no longer applies.
      await database.executionSavePoints.put({ ...savePoint, recordedAt: '2026-09-17T09:00:00.000Z' })
      await expectRefusal(() => services.rng.saveRngState(next, basis, approval), database, 'save_point_changed')

      await database.executionSavePoints.put(savePoint)
      await execution.recordExecutionSavePoint({ planId: fixture.plan.id })
      await expectRefusal(() => services.rng.saveRngState(next, basis, approval), database, 'save_point_choice_not_required')
    }))

  it('refuses both inspection and save when more than one Plan is running', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      const { services } = await started(database, fixture)
      await database.productionPlans.put({ ...structuredClone(await currentPlan(database, fixture.plan)), id: 'plan.guard.second' as ProductionPlan['id'], status: 'stale' })
      const { next, basis } = await rngEdit(database)

      await expect(services.rng.inspectRngStateSave(next, basis)).rejects.toMatchObject({ code: 'running_plan_invariant_violated' })
      await expectRefusal(() => services.rng.saveRngState(next, basis), database, 'running_plan_invariant_violated')
      const rng = await stored<RngState>(database.rngState, 'current')
      await expectRefusal(() => services.rng.saveRngState({ ...rng, notes: 'note only' }, rng), database, 'running_plan_invariant_violated')
    }))
})

describe('Atomicity of an approved breaking change', () => {
  it('refuses a failing save point restore and keeps the Plan, the change unsaved and the save point', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      const { execution, services } = await started(database, fixture)
      await execution.recordExecutionSavePoint({ planId: fixture.plan.id })
      await confirmCurrent(execution, database, fixture.plan)
      const [goal] = await database.targetWeapons.bulkGet([GOAL_ID])
      await database.targetWeapons.put({ ...(goal as TargetWeapon), preferredOwnedWeaponId: null })
      await database.ownedWeapons.delete(SOURCE_ID)
      const { next, basis } = await rngEdit(database)
      const approval = approvalOf(await services.rng.inspectRngStateSave(next, basis), 'restore_save_point')

      await expectRefusal(() => services.rng.saveRngState(next, basis, approval), database, 'save_point_required_entity_missing')
      expect(await currentPlan(database, fixture.plan)).toMatchObject({ status: 'active' })
    }))

  it('never abandons the Plan when the approved change itself fails validation', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      const { execution, services } = await started(database, fixture)
      await execution.recordExecutionSavePoint({ planId: fixture.plan.id })
      await confirmCurrent(execution, database, fixture.plan)
      const edit = await targetPriorityEdit(services, database)
      const approval = approvalOf(await edit.inspection(), 'restore_save_point')
      const before = await dump(database)

      const error = await services.targets.save({ ...edit.draft, name: '   ' }, edit.basis, GUARD_NOW, approval).catch((caught: unknown) => caught)

      expect(error).toBeInstanceOf(EntityFormValidationError)
      expect(await dump(database)).toEqual(before)
    }))

  it('keeps the existing reference protection: an approved delete of a referenced weapon changes nothing', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      const { execution, services } = await started(database, fixture)
      await confirmCurrent(execution, database, fixture.plan)
      const approval = approvalOf(await (await targetPriorityEdit(services, database)).inspection())
      const before = await dump(database)

      const error = await services.owned.delete(SOURCE_ID as OwnedWeapon['id'], approval).catch((caught: unknown) => caught)

      expect(error).toBeInstanceOf(ReferencedEntityDeleteError)
      expect(await dump(database)).toEqual(before)
      expect(await stored<OwnedWeapon>(database.ownedWeapons, SOURCE_ID)).toMatchObject({ executionInProgress: { productionPlanId: fixture.plan.id } })
    }))

  it.each([
    ['the user change write', (database: AppDatabase) => database.rngState.hook('updating', () => { throw new Error('storage failure') }), 'keep_current'],
    ['the Plan put', (database: AppDatabase) => database.productionPlans.hook('updating', () => { throw new Error('storage failure') }), 'keep_current'],
    ['the in-progress clear', (database: AppDatabase) => database.ownedWeapons.hook('updating', () => { throw new Error('storage failure') }), 'keep_current'],
    ['the ExecutionHistory delete of the restore', (database: AppDatabase) => database.executionHistory.hook('deleting', () => { throw new Error('storage failure') }), 'restore_save_point'],
    ['the save point delete', (database: AppDatabase) => database.executionSavePoints.hook('deleting', () => { throw new Error('storage failure') }), 'keep_current'],
  ] as const)('rolls everything back when %s fails', (_label, fail, decision) =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(3)
      const { execution, services } = await started(database, fixture)
      await confirmCurrent(execution, database, fixture.plan)
      await execution.recordExecutionSavePoint({ planId: fixture.plan.id })
      await confirmCurrent(execution, database, fixture.plan)
      await confirmCurrent(execution, database, fixture.plan)
      const { next, basis } = await rngEdit(database)
      const approval = approvalOf(await services.rng.inspectRngStateSave(next, basis), decision)
      const before = await dump(database)
      fail(database)

      const failure = await services.rng.saveRngState(next, basis, approval).catch((error: unknown) => error)

      expect(failure).toBeInstanceOf(RepositoryError)
      expect(failure).not.toBeInstanceOf(ExecutionRuntimeError)
      expect(failure).toMatchObject({ code: 'transaction_failed' })
      expect(await dump(database)).toEqual(before)
    }))
})

describe('NormalArtianCounter basis', () => {
  it('applies only the changed Counter fields over the stored record', () =>
    withDatabase(async (database) => {
      const fixture = await newNormalFixture(3)
      await seed(database, fixture)
      const services = servicesFor(database, fixture)
      const [counter] = await database.normalArtianCounters.toArray()
      const shown: NormalArtianCounter = { ...counter, observationCount: 0 }
      // Another writer recorded an observation after the screen read the row.
      await database.normalArtianCounters.put({ ...counter, observationCount: 7 })

      const saved = await services.rng.saveNormalArtianCounter({ ...shown, isConfirmed: false }, shown)

      expect(saved).toMatchObject({ isConfirmed: false, observationCount: 7, counter: counter.counter, updatedAt: GUARD_NOW })
    }))
})

describe('Build List Entry replacement (docs/DATA_MODEL.md 9.4.1)', () => {
  /** Another Candidate of the Plan-dependent Target, replacing its one Entry. */
  async function replacementOf(database: AppDatabase): Promise<{
    entry: BuildListEntry
    request: BuildListCandidateReplacementRequest
  }> {
    const entry = await stored<BuildListEntry>(database.buildListEntries, GOGMA_ENTRY_ID)
    const target = await stored<TargetWeapon>(database.targetWeapons, GOAL_ID)
    const candidate = structuredClone(entry.candidateSnapshot)
    candidate.id = 'candidate.guard.replacement' as typeof candidate.id
    candidate.searchRunId = 'search-run.guard.replacement'
    candidate.groupSkillId = candidate.groupSkillId === null
      ? 'group_skill.guard.replacement' as NonNullable<BuildListEntry['candidateSnapshot']['groupSkillId']>
      : null
    return {
      entry,
      request: {
        candidate,
        target,
        intermediateStateSelection: { skillOpportunityId: null, bonusOpportunityId: null, improvementPreference: 'planner' },
        expectedExistingEntryId: entry.id,
      },
    }
  }

  it('needs approval when the replaced Entry is the active Plan\'s, and refuses without it', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      const { execution, services } = await started(database, fixture)
      await confirmCurrent(execution, database, fixture.plan)
      const plan = await currentPlan(database, fixture.plan)
      const { request } = await replacementOf(database)
      const before = await dump(database)

      const inspection = await services.buildList.inspectCandidateReplacement(request)
      expect(inspection).toMatchObject({ approvalRequired: true, reasons: ['build_list_changed'] })
      expect(await dump(database)).toEqual(before)
      await expectRefusal(
        () => services.buildList.replaceCandidate(request),
        database,
        'plan_breaking_change_approval_required',
      )
      expect(await currentPlan(database, fixture.plan)).toEqual(plan)
    }))

  it('replaces the Entry and abandons the Plan together once approved', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      const { execution, services } = await started(database, fixture)
      await confirmCurrent(execution, database, fixture.plan)
      const plan = await currentPlan(database, fixture.plan)
      const { entry, request } = await replacementOf(database)
      const inspection = await services.buildList.inspectCandidateReplacement(request)

      const replaced = await services.buildList.replaceCandidate(request, approvalOf(inspection))

      expect(await database.buildListEntries.get(entry.id)).toBeUndefined()
      expect(await stored<BuildListEntry>(database.buildListEntries, replaced.id)).toEqual(replaced)
      expect((await database.buildListEntries.toArray()).filter(({ targetWeaponId }) => targetWeaponId === GOAL_ID))
        .toEqual([replaced])
      expect(await currentPlan(database, fixture.plan)).toEqual(abandonedBreaking(plan))
      expect(await database.executionHistory.count()).toBe(1)
    }))

  it('replaces an Entry only a Draft Plan references without approval, leaving the Draft as it is', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      await seed(database, fixture)
      const draft = await currentPlan(database, fixture.plan)
      expect(draft.status).toBe('draft')
      const services = servicesFor(database, fixture)
      const { entry, request } = await replacementOf(database)

      expect(await services.buildList.inspectCandidateReplacement(request)).toEqual({ approvalRequired: false })
      const replaced = await services.buildList.replaceCandidate(request)

      expect(await database.buildListEntries.get(entry.id)).toBeUndefined()
      expect(await stored<BuildListEntry>(database.buildListEntries, replaced.id)).toEqual(replaced)
      expect(await currentPlan(database, fixture.plan)).toEqual(draft)
    }))

  it('leaves no intermediate state when the new Entry write fails', () =>
    withDatabase(async (database) => {
      const fixture = await existingGogmaFixture()
      await seed(database, fixture)
      const services = servicesFor(database, fixture)
      const { request } = await replacementOf(database)
      const before = await dump(database)
      database.buildListEntries.hook('creating', () => { throw new Error('storage failure') })

      const failure = await services.buildList.replaceCandidate(request).catch((error: unknown) => error)

      expect(failure).toBeInstanceOf(RepositoryError)
      expect(failure).toMatchObject({ code: 'transaction_failed' })
      // The old Entry's delete ran first inside the transaction and was rolled back.
      expect(await dump(database)).toEqual(before)
    }))
})
