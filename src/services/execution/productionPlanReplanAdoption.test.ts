import { describe, expect, it, vi } from 'vitest'
import {
  applyProductionPlanStartTargetLinks,
  deriveProductionPlanStartTargetLinks,
} from '../../domain/planner/productionPlanStartEffects'
import { DATABASE_SCHEMA_VERSION, type AppDatabase } from '../../db/AppDatabase'
import { RepositoryError } from '../../db/repositoryError'
import {
  ExecutionRuntimeError,
  describeReplanPreviewAdoptability,
  type PlanAbandonSavePointDecision,
  type ProductionPlanReplanPreview,
} from '../../domain/execution'
import type { MasterDataRoot } from '../../domain/master/masterTypes'
import { EXPORT_SCHEMA_VERSION } from '../../domain/models/exportModel'
import type {
  BuildListEntry,
  CalculationContext,
  ExecutionSavePoint,
  OwnedGogmaArtianWeapon,
  OwnedWeapon,
  PlanStep,
  ProductionPlan,
  ProductionPlanId,
  TargetWeapon,
} from '../../domain/models/publicTypes'
import {
  CURRENT_CALCULATION_APP_SCHEMA_VERSION,
  createDefaultAppSettings,
} from '../../domain/models/publicTypes'
import { createProductionPlanWithConstrainedSearch } from '../../domain/planner'
import { IDEAL_SERIES_SKILL_ID } from '../../test/fixtures/constrainedEnumeration'
import {
  confirmCurrent,
  currentPlan,
  dump,
  executionService,
  existingResetFixture,
  expectRefusal,
  newNormalFixture,
  seed,
  withDatabase,
  type ExecutionFixture,
  type PersistedDump,
} from '../../test/fixtures/executionRuntime'
import {
  orchestrationBounds,
  orchestrationEntry,
  orchestrationEnumerationBounds,
  orchestrationSource,
  orchestrationTarget,
  resetRoute,
  synchronizeOrchestrationEntry,
} from '../../test/fixtures/plannerConstrainedOrchestration'
import type { ProductionPlanExecutionService } from './productionPlanExecutionService'
import { ProductionPlanReplanPreviewService } from './productionPlanReplanPreviewService'

/** Counts the full Planner runs, so the replan Preview is seen reaching the scheduler. */
const fullRuns = vi.hoisted(() => ({ scheduler: 0, beam: 0 }))

vi.mock('../../domain/planner/plannerDeterministicScheduler', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../domain/planner/plannerDeterministicScheduler')>()
  return {
    ...actual,
    runPlannerDeterministicSchedule: (...args: Parameters<typeof actual.runPlannerDeterministicSchedule>) => {
      fullRuns.scheduler += 1
      return actual.runPlannerDeterministicSchedule(...args)
    },
  }
})

vi.mock('../../domain/planner/plannerBeamSearch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../domain/planner/plannerBeamSearch')>()
  return {
    ...actual,
    runPlannerBeamSearch: (...args: Parameters<typeof actual.runPlannerBeamSearch>) => {
      fullRuns.beam += 1
      return actual.runPlannerBeamSearch(...args)
    },
  }
})

const EXTRA_SOURCE_ID = 'owned.replan.extra'
const EXTRA_TARGET_ID = 'target.replan.extra'
const EXTRA_ENTRY_ID = 'entry.replan.extra'
/** The persisted Entry of the added Target a generated Entry replaces (PLANNER_SPEC 9.2.18). */
const ORIGINAL_ENTRY_ID = 'entry.replan.extra.original'
const EARLIER_START = '2026-09-10T00:00:00.000Z'

function previewServiceFor(
  database: AppDatabase,
  fixture: ExecutionFixture,
  calculationContext: CalculationContext = fixture.built.input.calculationContext,
) {
  return new ProductionPlanReplanPreviewService({
    database,
    // `createPlannerInput()` reads only the Planner Master subset.
    master: { ...structuredClone(fixture.built.input.master) } as unknown as MasterDataRoot,
    currentCalculationContext: structuredClone(calculationContext),
  })
}

interface ReplanHarness {
  database: AppDatabase
  fixture: ExecutionFixture
  service: ProductionPlanExecutionService
  previewService: ProductionPlanReplanPreviewService
  /** A Plan-independent weapon, Target and Entry added while the Plan runs. */
  source: OwnedGogmaArtianWeapon
  goal: TargetWeapon
  entry: BuildListEntry
  /** The persisted Entry `entry` replaces as a generated Entry; `null` when `entry` is persisted. */
  original: BuildListEntry | null
  savePoint: ExecutionSavePoint | null
}

interface HarnessOptions {
  /** Records a game save point right after the Plan starts. */
  savePoint?: boolean
  /** Confirms this many Steps of the running Plan before the Preview. */
  confirmedSteps?: number
  /** Records the current Step as `operation_uncertain`, making the Plan stale. */
  stale?: boolean
  /**
   * Persists the added Entry; otherwise it is only available for a generated
   * Entry, and the added Target holds the original persisted Entry it replaces.
   */
  persistEntry?: boolean
  sourceOverrides?: Partial<OwnedGogmaArtianWeapon>
}

/**
 * A running new-Normal Plan, plus a Target, a weapon and a reset Entry the user
 * added while it runs: the ordinary reason to replan from the current state.
 */
async function running(database: AppDatabase, options: HarnessOptions = {}): Promise<ReplanHarness> {
  const fixture = await newNormalFixture(3)
  await seed(database, fixture)
  const service = executionService(database, fixture.built)
  await service.startProductionPlan(fixture.plan.id)
  const savePoint = options.savePoint ? await service.recordExecutionSavePoint({ planId: fixture.plan.id }) : null
  for (let index = 0; index < (options.confirmedSteps ?? 0); index += 1) {
    await confirmCurrent(service, database, fixture.plan)
  }
  if (options.stale) {
    const stored = await currentPlan(database, fixture.plan)
    await service.recordOperationUncertain({ planId: fixture.plan.id, planStepId: stored.currentStepId as PlanStep['id'] })
  }
  const previewService = previewServiceFor(database, fixture)
  const source = orchestrationSource(EXTRA_SOURCE_ID, { seriesSkillId: IDEAL_SERIES_SKILL_ID, ...options.sourceOverrides })
  const goal = orchestrationTarget(EXTRA_TARGET_ID)
  await database.ownedWeapons.put(source)
  await database.targetWeapons.put(goal)
  const request = await previewService.prepareProductionPlanReplanPreview({ runningPlanId: fixture.plan.id })
  const entry = orchestrationEntry(EXTRA_ENTRY_ID, goal, resetRoute(source.id))
  synchronizeOrchestrationEntry(request.plannerInput, entry)
  let original: BuildListEntry | null = null
  if (options.persistEntry ?? true) {
    await database.buildListEntries.put(entry)
  } else {
    original = orchestrationEntry(ORIGINAL_ENTRY_ID, goal, resetRoute(source.id))
    synchronizeOrchestrationEntry(request.plannerInput, original)
    await database.buildListEntries.put(original)
  }
  return { database, fixture, service, previewService, source, goal, entry, original, savePoint }
}

/**
 * Runs the replan Preview the way the Application does: the Preview request
 * from the current persisted state, the existing constrained Planner calculation
 * (the Worker's own entry point), then the transient bundle. `generated` feeds
 * the not-persisted added Entry to the Planner the way constrained re-search
 * adopts one, and reports it as generated.
 */
async function previewOf(harness: ReplanHarness, options: { generated?: boolean } = {}): Promise<ProductionPlanReplanPreview> {
  const request = await harness.previewService.prepareProductionPlanReplanPreview({ runningPlanId: harness.fixture.plan.id })
  // A generated Entry replaces the added Target's persisted Entry: the Planner
  // runs over the replacement set, exactly as a constrained trial does.
  const input = options.generated
    ? {
        ...request.plannerInput,
        buildListEntries: [
          ...request.plannerInput.buildListEntries.filter(({ id }) => id !== ORIGINAL_ENTRY_ID),
          structuredClone(harness.entry),
        ],
      }
    : request.plannerInput
  const result = await createProductionPlanWithConstrainedSearch(input, harness.fixture.built.dependencies, {
    orchestrationBounds: orchestrationBounds(),
    enumerationBounds: orchestrationEnumerationBounds(),
  })
  return harness.previewService.createProductionPlanReplanPreview(
    request,
    options.generated
      ? {
          ...result,
          generatedBuildListEntries: [structuredClone(harness.entry)],
          generatedBuildListEntryReplacements: [{
            targetWeaponId: harness.goal.id,
            replacedBuildListEntryId: ORIGINAL_ENTRY_ID as BuildListEntry['id'],
            generatedBuildListEntryId: harness.entry.id,
          }],
        }
      : result,
  )
}

function adopt(harness: ReplanHarness, preview: ProductionPlanReplanPreview, savePointDecision: PlanAbandonSavePointDecision = null) {
  return harness.service.adoptProductionPlanReplanPreview({ preview, savePointDecision })
}

function previewPlan(preview: ProductionPlanReplanPreview): ProductionPlan {
  expect(preview.result.plan).not.toBeNull()
  return preview.result.plan as ProductionPlan
}

function keepCurrent(savePoint: ExecutionSavePoint | null): PlanAbandonSavePointDecision {
  return { kind: 'keep_current', recordedAt: (savePoint as ExecutionSavePoint).recordedAt }
}

function restoreSavePoint(savePoint: ExecutionSavePoint | null): PlanAbandonSavePointDecision {
  return { kind: 'restore_save_point', recordedAt: (savePoint as ExecutionSavePoint).recordedAt }
}

function inProgressFor(weapon: OwnedWeapon, planId: ProductionPlanId, startedAt = EARLIER_START): OwnedWeapon {
  return { ...weapon, executionInProgress: { productionPlanId: planId, startedAt } }
}

/** The dump after a successful adoption, derived from the dump before it. */
function adoptedDump(
  before: PersistedDump,
  oldPlan: ProductionPlan,
  newPlan: ProductionPlan,
  now: string,
  changes: { ownedWeapons?: OwnedWeapon[]; generatedEntries?: BuildListEntry[]; replacedEntryIds?: string[] } = {},
): PersistedDump {
  const byId = <T extends { id: string }>(values: T[]) => values.sort((a, b) => a.id.localeCompare(b.id))
  const changedWeapons = new Map((changes.ownedWeapons ?? []).map((weapon) => [weapon.id, weapon]))
  const replaced = new Set(changes.replacedEntryIds ?? [])
  const entries = byId([
    ...before.buildListEntries.filter(({ id }) => !replaced.has(id)),
    ...(changes.generatedEntries ?? []),
  ])
  // The new Plan's start effect (PLANNER_SPEC 16.11): the Target of each Entry
  // starting from an existing weapon comes to prefer it.
  const startedTargets = applyProductionPlanStartTargetLinks(
    before.targetWeapons,
    deriveProductionPlanStartTargetLinks(newPlan.selectedBuildListEntryIds, entries),
  ).map((target, index) =>
    target.preferredOwnedWeaponId === before.targetWeapons[index].preferredOwnedWeaponId
      ? target
      : { ...target, updatedAt: now })
  return {
    ...before,
    ownedWeapons: before.ownedWeapons.map((weapon) => changedWeapons.get(weapon.id) ?? weapon),
    targetWeapons: startedTargets,
    buildListEntries: entries,
    productionPlans: byId([
      ...before.productionPlans.map((plan) =>
        plan.id === oldPlan.id
          ? { ...plan, status: 'abandoned' as const, abandonmentReason: 'replan_adopted' as const, abandonedAt: now, completedAt: null, updatedAt: now }
          : plan),
      { ...newPlan, status: 'active' as const, updatedAt: now },
    ]),
    executionSavePoints: before.executionSavePoints.filter(({ productionPlanId }) => productionPlanId !== oldPlan.id),
  }
}

describe('replan Preview', () => {
  it('builds the Preview from the current persisted state and writes nothing', () =>
    withDatabase(async (database) => {
      const harness = await running(database, { confirmedSteps: 1 })
      const before = await dump(database)

      const request = await harness.previewService.prepareProductionPlanReplanPreview({ runningPlanId: harness.fixture.plan.id })
      const preview = await previewOf(harness)

      expect(await dump(database)).toEqual(before)
      expect(request.runningPlanToken).toEqual({
        planId: harness.fixture.plan.id,
        status: 'active',
        currentStepId: (await currentPlan(database, harness.fixture.plan)).currentStepId,
      })
      // The ordinary current-state PlannerInput: never the running Plan's
      // snapshot, and never its conflict resolutions.
      expect(request.plannerInput.rngState).toEqual(await database.rngState.get('current'))
      expect(request.plannerInput.normalCounters).toEqual(await database.normalArtianCounters.toArray())
      expect(request.plannerInput.ownedWeapons.map(({ id }) => id).sort()).toEqual(before.ownedWeapons.map(({ id }) => id))
      expect(request.plannerInput.targetWeapons.map(({ id }) => id).sort()).toEqual(before.targetWeapons.map(({ id }) => id))
      expect(request.plannerInput.buildListEntries.map(({ id }) => id).sort()).toEqual(before.buildListEntries.map(({ id }) => id))
      expect(request.plannerInput.conflictResolutions).toEqual([])
      expect(request.calculationContext).toEqual(harness.fixture.built.input.calculationContext)

      const plan = previewPlan(preview)
      expect(plan.status).toBe('draft')
      expect(plan.selectedBuildListEntryIds).toEqual([EXTRA_ENTRY_ID])
      expect(await database.productionPlans.get(plan.id)).toBeUndefined()
      expect(structuredClone(preview)).toEqual(preview)
      expect(describeReplanPreviewAdoptability(preview)).toMatchObject({ adoptable: true })
    }))

  it('keeps a generated Entry and the draft Plan in memory only', () =>
    withDatabase(async (database) => {
      const harness = await running(database, { persistEntry: false })
      const before = await dump(database)

      const preview = await previewOf(harness, { generated: true })

      expect(preview.result.generatedBuildListEntries.map(({ id }) => id)).toEqual([EXTRA_ENTRY_ID])
      expect(await dump(database)).toEqual(before)
      expect(await database.buildListEntries.get(EXTRA_ENTRY_ID)).toBeUndefined()
    }))

  it('previews a stale Plan from the current state without changing it', () =>
    withDatabase(async (database) => {
      const harness = await running(database, { confirmedSteps: 1, stale: true })
      const before = await dump(database)

      const preview = await previewOf(harness)

      expect(preview.runningPlanToken.status).toBe('stale')
      expect(previewPlan(preview).status).toBe('draft')
      expect(await dump(database)).toEqual(before)
    }))

  it('refuses a draft, completed or abandoned Plan', () =>
    withDatabase(async (database) => {
      const draft = await newNormalFixture(3)
      await seed(database, draft)
      const previewService = previewServiceFor(database, draft)
      await expectRefusal(
        () => previewService.prepareProductionPlanReplanPreview({ runningPlanId: draft.plan.id }),
        database,
        'replan_preview_not_allowed',
      )

      const service = executionService(database, draft.built)
      await service.startProductionPlan(draft.plan.id)
      const stored = await currentPlan(database, draft.plan)
      await service.abandonProductionPlan({
        planId: draft.plan.id,
        observedPlan: { status: stored.status, currentStepId: stored.currentStepId, updatedAt: stored.updatedAt },
        savePointDecision: null,
      })
      await expectRefusal(
        () => previewService.prepareProductionPlanReplanPreview({ runningPlanId: draft.plan.id }),
        database,
        'replan_preview_not_allowed',
      )
    }))

  it('refuses a completed Plan', () =>
    withDatabase(async (database) => {
      const fixture = await existingResetFixture()
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await service.startProductionPlan(fixture.plan.id)
      await confirmCurrent(service, database, fixture.plan)
      expect((await currentPlan(database, fixture.plan)).status).toBe('completed')

      await expectRefusal(
        () => previewServiceFor(database, fixture).prepareProductionPlanReplanPreview({ runningPlanId: fixture.plan.id }),
        database,
        'replan_preview_not_allowed',
      )
    }))

  it('returns a no-Plan Preview that can be shown but never adopted', () =>
    withDatabase(async (database) => {
      // After a confirmed Step the running Plan's own Entry is stale, and
      // without another Entry the Planner has nothing to plan.
      const fixture = await newNormalFixture(3)
      await seed(database, fixture)
      const service = executionService(database, fixture.built)
      await service.startProductionPlan(fixture.plan.id)
      await confirmCurrent(service, database, fixture.plan)
      const previewService = previewServiceFor(database, fixture)
      const request = await previewService.prepareProductionPlanReplanPreview({ runningPlanId: fixture.plan.id })
      const result = await createProductionPlanWithConstrainedSearch(request.plannerInput, fixture.built.dependencies, {
        orchestrationBounds: orchestrationBounds(),
        enumerationBounds: orchestrationEnumerationBounds(),
      })
      const preview = previewService.createProductionPlanReplanPreview(request, result)

      expect(preview.result.plan).toBeNull()
      expect(describeReplanPreviewAdoptability(preview)).toMatchObject({ adoptable: false, reason: 'no_plan' })
      await expectRefusal(() => service.inspectProductionPlanReplanAdoption({ preview }), database, 'replan_result_invalid')
      await expectRefusal(() => service.adoptProductionPlanReplanPreview({ preview, savePointDecision: null }), database, 'replan_result_invalid')
    }))

  it('never adopts an incomplete search, a no-Plan result with generated Entries, or a non-draft Plan', () =>
    withDatabase(async (database) => {
      const harness = await running(database, { persistEntry: false })
      const preview = await previewOf(harness, { generated: true })

      const incomplete: ProductionPlanReplanPreview = {
        ...structuredClone(preview),
        result: {
          ...structuredClone(preview.result),
          termination: { ...preview.result.termination, status: 'incomplete', reachedLimits: ['max_plan_steps'] },
        },
      }
      expect(describeReplanPreviewAdoptability(incomplete)).toMatchObject({ adoptable: false, reason: 'incomplete_search' })
      await expectRefusal(() => adopt(harness, incomplete), database, 'replan_result_invalid')

      const orphaned: ProductionPlanReplanPreview = {
        ...structuredClone(preview),
        result: { ...structuredClone(preview.result), plan: null },
      }
      expect(describeReplanPreviewAdoptability(orphaned)).toMatchObject({ adoptable: false, reason: 'invalid_result' })
      await expectRefusal(() => adopt(harness, orphaned), database, 'replan_result_invalid')

      const active: ProductionPlanReplanPreview = {
        ...structuredClone(preview),
        result: { ...structuredClone(preview.result), plan: { ...previewPlan(preview), status: 'active' } },
      }
      await expectRefusal(() => adopt(harness, active), database, 'replan_result_invalid')

      const unselected: ProductionPlanReplanPreview = {
        ...structuredClone(preview),
        result: {
          ...structuredClone(preview.result),
          generatedBuildListEntries: [
            ...structuredClone(preview.result.generatedBuildListEntries),
            { ...structuredClone(harness.entry), id: 'entry.replan.unselected' as BuildListEntry['id'] },
          ],
        },
      }
      await expectRefusal(() => adopt(harness, unselected), database, 'replan_result_invalid')
    }))
})

describe('replan adoption', () => {
  it('abandons the running Plan, starts the new Plan and changes nothing else', () =>
    withDatabase(async (database) => {
      const harness = await running(database, { confirmedSteps: 1 })
      const preview = await previewOf(harness)
      const before = await dump(database)
      const draft = previewPlan(preview)

      const result = await adopt(harness, preview)

      expect(result.kind).toBe('adopted')
      if (result.kind !== 'adopted') return
      const now = result.newPlan.updatedAt
      expect(result.savePointHandling).toBe('no_choice')
      expect(result.oldPlan).toMatchObject({
        id: harness.fixture.plan.id,
        status: 'abandoned',
        abandonmentReason: 'replan_adopted',
        abandonedAt: now,
        completedAt: null,
        updatedAt: now,
      })
      // Where the Plan stopped stays recorded.
      const oldBefore = before.productionPlans.find(({ id }) => id === harness.fixture.plan.id) as ProductionPlan
      expect(result.oldPlan.currentStepId).toBe(oldBefore.currentStepId)
      expect(result.oldPlan.steps).toEqual(oldBefore.steps)
      expect(result.newPlan).toEqual({ ...draft, status: 'active', updatedAt: now })
      expect(result.generatedBuildListEntries).toEqual([])
      // RNG, Counters, Entries and every ExecutionHistory record stay as they
      // are; the only Target change is the new Plan's start link.
      expect(await dump(database)).toEqual(adoptedDump(before, oldBefore, draft, now))
      expect(await database.targetWeapons.get(EXTRA_TARGET_ID)).toMatchObject({ preferredOwnedWeaponId: EXTRA_SOURCE_ID, updatedAt: now })
      expect((await database.productionPlans.get(draft.id))?.status).toBe('active')
    }))

  it('adopts from an active Plan with no confirmed Step, replacing it with a new Plan ID', () =>
    withDatabase(async (database) => {
      const harness = await running(database)
      const preview = await previewOf(harness)
      const draft = previewPlan(preview)
      expect(draft.id).not.toBe(harness.fixture.plan.id)

      const result = await adopt(harness, preview)

      expect(result.kind).toBe('adopted')
      const plans = await database.productionPlans.toArray()
      expect(plans.map(({ id, status }) => ({ id, status })).sort((a, b) => a.id.localeCompare(b.id))).toEqual([
        { id: harness.fixture.plan.id, status: 'abandoned' },
        { id: draft.id, status: 'active' },
      ].sort((a, b) => a.id.localeCompare(b.id)))
    }))

  it('replans a running schema 13 Plan from the current state through the schema 14 scheduler', () =>
    withDatabase(async (database) => {
      // Issue #103 Phase C: the running Plan was calculated under schema 13 and
      // is never executed under 14; the way on is a new calculation from the
      // current persisted state, never its baseSnapshot.
      const harness = await running(database, { confirmedSteps: 1 })
      const persisted = await currentPlan(database, harness.fixture.plan)
      const schema13 = structuredClone(persisted)
      schema13.calculationContext.appSchemaVersion = 13
      schema13.baseSnapshot.calculationContext.appSchemaVersion = 13
      await database.productionPlans.put(schema13)
      await expectRefusal(
        () => harness.service.confirmExpectedPlanStep({ planId: schema13.id, planStepId: schema13.currentStepId as PlanStep['id'] }),
        database,
        'calculation_context_changed',
      )

      const request = await harness.previewService.prepareProductionPlanReplanPreview({ runningPlanId: schema13.id })
      expect(request.plannerInput.calculationContext.appSchemaVersion).toBe(CURRENT_CALCULATION_APP_SCHEMA_VERSION)
      expect(request.plannerInput.calculationContext).not.toEqual(schema13.baseSnapshot.calculationContext)
      fullRuns.scheduler = 0
      fullRuns.beam = 0
      const preview = await previewOf(harness)
      expect(fullRuns.scheduler).toBeGreaterThan(0)
      expect(fullRuns.beam).toBe(0)
      const draft = previewPlan(preview)
      expect(draft.calculationContext.appSchemaVersion).toBe(14)

      const result = await adopt(harness, preview)

      expect(result.kind).toBe('adopted')
      expect(await database.productionPlans.get(schema13.id)).toMatchObject({
        status: 'abandoned',
        abandonmentReason: 'replan_adopted',
        calculationContext: { appSchemaVersion: 13 },
      })
      expect(await database.productionPlans.get(draft.id)).toMatchObject({
        status: 'active',
        calculationContext: { appSchemaVersion: 14 },
      })
    }))

  it('keeps a stale running Plan\'s recalculation reasons when it is abandoned', () =>
    withDatabase(async (database) => {
      const harness = await running(database, { confirmedSteps: 1, stale: true })
      const preview = await previewOf(harness)

      const result = await adopt(harness, preview)

      expect(result.kind === 'adopted' && result.oldPlan).toMatchObject({
        status: 'abandoned',
        abandonmentReason: 'replan_adopted',
        recalculationReasons: ['execution_operation_uncertain'],
      })
      expect((await currentPlan(database, harness.fixture.plan)).recalculationReasons).toEqual(['execution_operation_uncertain'])
    }))

  it('replaces the persisted Entry with the generated Entry in the same transaction', () =>
    withDatabase(async (database) => {
      const harness = await running(database, { persistEntry: false })
      const preview = await previewOf(harness, { generated: true })
      const before = await dump(database)
      expect(before.buildListEntries.map(({ id }) => id)).toContain(ORIGINAL_ENTRY_ID)
      // The new Plan never records the Entry the adoption deletes.
      expect(previewPlan(preview).selectedBuildListEntryIds).toEqual([EXTRA_ENTRY_ID])

      const result = await adopt(harness, preview)

      expect(result.kind).toBe('adopted')
      if (result.kind !== 'adopted') return
      expect(result.generatedBuildListEntries).toEqual(preview.result.generatedBuildListEntries)
      expect(await database.buildListEntries.get(EXTRA_ENTRY_ID)).toEqual(preview.result.generatedBuildListEntries[0])
      expect(await database.buildListEntries.get(ORIGINAL_ENTRY_ID)).toBeUndefined()
      expect((await database.buildListEntries.toArray()).filter(({ targetWeaponId }) => targetWeaponId === harness.goal.id))
        .toHaveLength(1)
      const oldBefore = before.productionPlans.find(({ id }) => id === harness.fixture.plan.id) as ProductionPlan
      expect(await dump(database)).toEqual(adoptedDump(before, oldBefore, previewPlan(preview), result.newPlan.updatedAt, {
        generatedEntries: preview.result.generatedBuildListEntries,
        replacedEntryIds: [ORIGINAL_ENTRY_ID],
      }))
    }))

  it('refuses when the replaced Entry was itself replaced after the Preview, deleting nothing on a guess', () =>
    withDatabase(async (database) => {
      const harness = await running(database, { persistEntry: false })
      const preview = await previewOf(harness, { generated: true })
      // B1 -> B3 after the Preview: the Target's one Entry is no longer B1.
      await database.buildListEntries.delete(ORIGINAL_ENTRY_ID)
      const b3 = { ...structuredClone(harness.original as BuildListEntry), id: 'entry.replan.extra.b3' as BuildListEntry['id'] }
      await database.buildListEntries.put(b3)
      const runningBefore = await currentPlan(database, harness.fixture.plan)

      await expectRefusal(() => adopt(harness, preview), database, 'replan_state_changed')
      expect(await database.buildListEntries.get(b3.id)).toEqual(b3)
      expect(await database.buildListEntries.get(EXTRA_ENTRY_ID)).toBeUndefined()
      expect(await currentPlan(database, harness.fixture.plan)).toEqual(runningBefore)
      expect(await database.productionPlans.get(previewPlan(preview).id)).toBeUndefined()
    }))

  it('adds no ExecutionHistory, keeps the old records and makes them not undoable', () =>
    withDatabase(async (database) => {
      const harness = await running(database, { confirmedSteps: 1 })
      const historyBefore = await database.executionHistory.toArray()
      expect(historyBefore).toHaveLength(1)

      await adopt(harness, await previewOf(harness))

      expect(await database.executionHistory.toArray()).toEqual(historyBefore)
      await expectRefusal(
        () => harness.service.undoLatestExecution({ planId: harness.fixture.plan.id, executionHistoryId: historyBefore[0].id }),
        database,
        'undo_not_allowed',
      )
    }))

  it('moves no version authority', () => {
    expect(CURRENT_CALCULATION_APP_SCHEMA_VERSION).toBe(14)
    expect(DATABASE_SCHEMA_VERSION).toBe(8)
    expect(EXPORT_SCHEMA_VERSION).toBe(11)
  })
})

describe('replan adoption in-progress weapons', () => {
  it('moves the mark of a weapon the new Plan keeps tracking, keeping its start time', () =>
    withDatabase(async (database) => {
      const harness = await running(database)
      await database.ownedWeapons.put(inProgressFor(harness.source, harness.fixture.plan.id))
      const preview = await previewOf(harness)

      const result = await adopt(harness, preview)

      expect(result.kind).toBe('adopted')
      if (result.kind !== 'adopted') return
      expect(await database.ownedWeapons.get(EXTRA_SOURCE_ID)).toEqual({
        ...inProgressFor(harness.source, result.newPlan.id),
        updatedAt: result.newPlan.updatedAt,
      })
    }))

  it('clears the mark of a weapon the new Plan no longer tracks', () =>
    withDatabase(async (database) => {
      // Confirming until the production-target Normal is registered puts it in
      // progress for the running Plan; the new Plan does not reference it.
      const fixture = await newNormalFixture(3)
      const registration = fixture.plan.steps.findIndex((step) => step.executionEffects?.registersTrackedWeapon)
      expect(registration).toBeGreaterThanOrEqual(0)
      const harness = await running(database, { confirmedSteps: registration + 1 })
      const registered = (await database.ownedWeapons.toArray())
        .filter(({ executionInProgress }) => executionInProgress?.productionPlanId === harness.fixture.plan.id)
      expect(registered.length).toBeGreaterThan(0)
      const preview = await previewOf(harness)
      expect(previewPlan(preview).selectedBuildListEntryIds).toEqual([EXTRA_ENTRY_ID])

      const result = await adopt(harness, preview)

      expect(result.kind).toBe('adopted')
      for (const weapon of registered) {
        expect(await database.ownedWeapons.get(weapon.id)).toEqual({
          ...weapon,
          executionInProgress: null,
          updatedAt: result.kind === 'adopted' ? result.newPlan.updatedAt : '',
        })
      }
    }))

  it('never marks a weapon in progress just because the new Plan starts from it', () =>
    withDatabase(async (database) => {
      const harness = await running(database)
      const preview = await previewOf(harness)
      expect((await database.ownedWeapons.get(EXTRA_SOURCE_ID))?.executionInProgress).toBeNull()

      await adopt(harness, preview)

      expect(await database.ownedWeapons.get(EXTRA_SOURCE_ID)).toEqual(harness.source)
    }))

  it('leaves another Plan\'s in-progress mark alone and moves only the new Plan start link', () =>
    withDatabase(async (database) => {
      const harness = await running(database)
      const otherPlanId = 'plan.replan.other' as ProductionPlanId
      await database.ownedWeapons.put(inProgressFor(harness.source, otherPlanId))
      const preferring = orchestrationTarget('target.replan.preferring', { preferredOwnedWeaponId: harness.source.id })
      await database.targetWeapons.put(preferring)
      const preview = await previewOf(harness)

      await adopt(harness, preview)

      expect((await database.ownedWeapons.get(EXTRA_SOURCE_ID))?.executionInProgress).toEqual({
        productionPlanId: otherPlanId,
        startedAt: EARLIER_START,
      })
      // The new Plan starts from the weapon for its own Target, so its start
      // effect moves the link there and releases the preferring Target.
      expect(await database.targetWeapons.get(preferring.id)).toMatchObject({ preferredOwnedWeaponId: null })
      expect(await database.targetWeapons.get(EXTRA_TARGET_ID)).toMatchObject({ preferredOwnedWeaponId: EXTRA_SOURCE_ID })
    }))
})

describe('replan adoption re-verification', () => {
  /**
   * The running Plan's own Entry is still fresh before any Step, so the Preview
   * replans it; nothing is added, so the running Plan itself stays executable.
   */
  async function plainRunning(database: AppDatabase) {
    const fixture = await newNormalFixture(3)
    await seed(database, fixture)
    const service = executionService(database, fixture.built)
    await service.startProductionPlan(fixture.plan.id)
    const previewService = previewServiceFor(database, fixture)
    const request = await previewService.prepareProductionPlanReplanPreview({ runningPlanId: fixture.plan.id })
    const result = await createProductionPlanWithConstrainedSearch(request.plannerInput, fixture.built.dependencies, {
      orchestrationBounds: orchestrationBounds(),
      enumerationBounds: orchestrationEnumerationBounds(),
    })
    const preview = previewService.createProductionPlanReplanPreview(request, result)
    expect(describeReplanPreviewAdoptability(preview)).toMatchObject({ adoptable: true })
    return { fixture, service, preview }
  }

  it('refuses when the running Plan advanced after the Preview', () =>
    withDatabase(async (database) => {
      const { fixture, service, preview } = await plainRunning(database)
      await confirmCurrent(service, database, fixture.plan)

      await expectRefusal(() => service.adoptProductionPlanReplanPreview({ preview, savePointDecision: null }), database, 'replan_state_changed')
      await expectRefusal(() => service.inspectProductionPlanReplanAdoption({ preview }), database, 'replan_state_changed')
    }))

  it('refuses when the running Plan became stale after the Preview', () =>
    withDatabase(async (database) => {
      const { fixture, service, preview } = await plainRunning(database)
      await service.recordOperationUncertain({ planId: fixture.plan.id, planStepId: fixture.plan.currentStepId as PlanStep['id'] })

      await expectRefusal(() => service.adoptProductionPlanReplanPreview({ preview, savePointDecision: null }), database, 'replan_state_changed')
    }))

  it('adopts the replanned running Plan Entry when nothing changed', () =>
    withDatabase(async (database) => {
      const { fixture, service, preview } = await plainRunning(database)

      const result = await service.adoptProductionPlanReplanPreview({ preview, savePointDecision: null })

      expect(result.kind).toBe('adopted')
      expect(previewPlan(preview).selectedBuildListEntryIds).toEqual(fixture.plan.selectedBuildListEntryIds)
    }))

  it('refuses when the RngState changed', () =>
    withDatabase(async (database) => {
      const harness = await running(database)
      const preview = await previewOf(harness)
      const rngState = await database.rngState.get('current')
      if (!rngState) throw new Error('RngState is missing.')
      await database.rngState.put({ ...rngState, skillCounter: { ...rngState.skillCounter, value: (rngState.skillCounter.value ?? 0) + 1 } })

      await expectRefusal(() => adopt(harness, preview), database, 'replan_state_changed')
    }))

  it('refuses when a Normal Artian Counter changed', () =>
    withDatabase(async (database) => {
      const harness = await running(database)
      const preview = await previewOf(harness)
      const [counter] = await database.normalArtianCounters.toArray()
      await database.normalArtianCounters.put({ ...counter, counter: (counter.counter ?? 0) + 1 })

      await expectRefusal(() => adopt(harness, preview), database, 'replan_state_changed')
    }))

  it('refuses when an OwnedWeapon changed semantically', () =>
    withDatabase(async (database) => {
      const harness = await running(database)
      const preview = await previewOf(harness)
      await database.ownedWeapons.put({ ...harness.source, isProtected: true })

      await expectRefusal(() => adopt(harness, preview), database, 'replan_state_changed')
    }))

  it('refuses when a Target the new Plan depends on changed', () =>
    withDatabase(async (database) => {
      const harness = await running(database)
      const preview = await previewOf(harness)
      await database.targetWeapons.put({ ...harness.goal, priority: 5 })

      await expectRefusal(() => adopt(harness, preview), database, 'replan_state_changed')
    }))

  it('refuses when an Entry the new Plan depends on changed or disappeared', () =>
    withDatabase(async (database) => {
      const harness = await running(database)
      const preview = await previewOf(harness)
      await database.buildListEntries.put({
        ...harness.entry,
        intermediateStateSelection: { skillOpportunityId: null, bonusOpportunityId: null, improvementPreference: 'skill_first' },
      })
      await expectRefusal(() => adopt(harness, preview), database, 'replan_state_changed')

      await database.buildListEntries.delete(EXTRA_ENTRY_ID)
      await expectRefusal(() => adopt(harness, preview), database, 'replan_state_changed')
    }))

  it('refuses when the CalculationContext changed', () =>
    withDatabase(async (database) => {
      const harness = await running(database)
      const preview = await previewOf(harness)
      const service = executionService(database, harness.fixture.built, {
        currentCalculationContext: { ...harness.fixture.built.input.calculationContext, rngEngineVersion: 'fixture-rng:changed' },
      })

      await expectRefusal(() => service.adoptProductionPlanReplanPreview({ preview, savePointDecision: null }), database, 'replan_state_changed')
    }))

  it('refuses a generated Entry persisted after the Preview, without overwriting it', () =>
    withDatabase(async (database) => {
      const harness = await running(database, { persistEntry: false })
      const preview = await previewOf(harness, { generated: true })
      const persisted = { ...structuredClone(harness.entry), createdAt: '2026-09-11T00:00:00.000Z' }
      await database.buildListEntries.put(persisted)

      await expectRefusal(() => adopt(harness, preview), database, 'replan_state_changed')
      expect(await database.buildListEntries.get(EXTRA_ENTRY_ID)).toEqual(persisted)
    }))

  it('refuses a new Plan ID that already exists, without overwriting that Plan', () =>
    withDatabase(async (database) => {
      const harness = await running(database)
      const preview = await previewOf(harness)
      const existing = { ...structuredClone(previewPlan(preview)), name: 'An existing Plan' }
      await database.productionPlans.put(existing)

      await expectRefusal(() => adopt(harness, preview), database, 'replan_plan_id_collision')
      expect(await database.productionPlans.get(existing.id)).toEqual(existing)

      const sameAsRunning: ProductionPlanReplanPreview = {
        ...structuredClone(preview),
        result: { ...structuredClone(preview.result), plan: { ...previewPlan(preview), id: harness.fixture.plan.id } },
      }
      await database.productionPlans.delete(existing.id)
      await expectRefusal(() => adopt(harness, sameAsRunning), database, 'replan_plan_id_collision')
    }))

  it('refuses when another Plan is also running', () =>
    withDatabase(async (database) => {
      const harness = await running(database)
      const preview = await previewOf(harness)
      await database.productionPlans.put({
        ...structuredClone(harness.fixture.plan),
        id: 'plan.replan.also-running' as ProductionPlanId,
        status: 'active',
      })

      await expectRefusal(() => adopt(harness, preview), database, 'running_plan_conflict')
    }))

  it('adopts after Plan-independent additions and changes', () =>
    withDatabase(async (database) => {
      const harness = await running(database, { confirmedSteps: 1 })
      const preview = await previewOf(harness)
      // A new Target with its Entry, a change to the running Plan's own Target
      // (the new Plan does not depend on it), a non-semantic weapon edit and a
      // settings change.
      const added = orchestrationTarget('target.replan.added-later')
      await database.targetWeapons.put(added)
      await database.buildListEntries.put(orchestrationEntry('entry.replan.added-later', added, resetRoute(harness.source.id)))
      const [runningTarget] = harness.fixture.built.input.targetWeapons
      await database.targetWeapons.put({ ...runningTarget, priority: 5, name: 'Renamed' })
      await database.ownedWeapons.put({ ...harness.source, name: 'Renamed', memo: 'memo', status: 'practical' })
      await database.settings.put({ ...createDefaultAppSettings('2026-09-17T07:00:00.000Z'), debugMode: true })

      const result = await adopt(harness, preview)

      expect(result.kind).toBe('adopted')
      expect((await database.productionPlans.get(previewPlan(preview).id))?.status).toBe('active')
    }))
})

describe('replan adoption save point choice', () => {
  it('asks nothing and deletes the running Plan\'s save point at the current position', () =>
    withDatabase(async (database) => {
      const harness = await running(database, { savePoint: true })
      const preview = await previewOf(harness)

      expect(await harness.service.inspectProductionPlanReplanAdoption({ preview })).toEqual({
        runningPlanId: harness.fixture.plan.id,
        runningPlanStatus: 'active',
        runningPlanCurrentStepId: harness.fixture.plan.currentStepId,
        newPlanId: previewPlan(preview).id,
        savePointChoiceRequired: false,
      })
      await expectRefusal(() => adopt(harness, preview, keepCurrent(harness.savePoint)), database, 'save_point_choice_not_required')

      const result = await adopt(harness, preview)

      expect(result).toMatchObject({ kind: 'adopted', savePointHandling: 'no_choice' })
      expect(await database.executionSavePoints.toArray()).toEqual([])
    }))

  it('asks when the running Plan ran past its save point, and adopts at the current state on keep', () =>
    withDatabase(async (database) => {
      const harness = await running(database, { savePoint: true, confirmedSteps: 1 })
      const preview = await previewOf(harness)
      const historyBefore = await database.executionHistory.toArray()

      expect(await harness.service.inspectProductionPlanReplanAdoption({ preview })).toMatchObject({
        savePointChoiceRequired: true,
        savePointRecordedAt: harness.savePoint?.recordedAt,
        savePointLastExecutionHistoryId: null,
        savePointCurrentStepId: harness.fixture.plan.currentStepId,
      })
      await expectRefusal(() => adopt(harness, preview), database, 'save_point_choice_required')
      await expectRefusal(
        () => adopt(harness, preview, { kind: 'keep_current', recordedAt: '2026-09-01T00:00:00.000Z' }),
        database,
        'save_point_changed',
      )

      const result = await adopt(harness, preview, keepCurrent(harness.savePoint))

      expect(result).toMatchObject({ kind: 'adopted', savePointHandling: 'keep_current' })
      expect(await database.executionSavePoints.toArray()).toEqual([])
      expect(await database.executionHistory.toArray()).toEqual(historyBefore)
      expect((await currentPlan(database, harness.fixture.plan)).status).toBe('abandoned')
    }))

  it('only restores the save point on return, adopting nothing, and requires a new Preview', () =>
    withDatabase(async (database) => {
      const harness = await running(database, { savePoint: true, confirmedSteps: 1, persistEntry: false })
      const preview = await previewOf(harness, { generated: true })
      const savePoint = harness.savePoint as ExecutionSavePoint

      const result = await adopt(harness, preview, restoreSavePoint(savePoint))

      expect(result.kind).toBe('save_point_restored_repreview_required')
      if (result.kind !== 'save_point_restored_repreview_required') return
      expect(result.restoredPlan).toEqual(savePoint.productionPlan)
      expect(result.savePoint).toEqual(savePoint)
      expect(result.deletedExecutionHistoryIds).toHaveLength(1)
      // The running Plan is the save point's Plan again, still running.
      expect(await currentPlan(database, harness.fixture.plan)).toEqual(savePoint.productionPlan)
      expect(await database.rngState.get('current')).toEqual(savePoint.rngState)
      expect(await database.normalArtianCounters.toArray()).toEqual(savePoint.normalCounters)
      expect(await database.executionHistory.toArray()).toEqual([])
      expect(await database.executionSavePoints.toArray()).toEqual([savePoint])
      // Nothing of the Preview was persisted, and nothing was replaced.
      expect(await database.productionPlans.get(previewPlan(preview).id)).toBeUndefined()
      expect(await database.buildListEntries.get(EXTRA_ENTRY_ID)).toBeUndefined()
      expect(await database.buildListEntries.get(ORIGINAL_ENTRY_ID)).toEqual(harness.original)

      // The old Preview no longer matches the restored running Plan.
      await expectRefusal(() => adopt(harness, preview, restoreSavePoint(savePoint)), database, 'replan_state_changed')
      await expectRefusal(() => adopt(harness, preview), database, 'replan_state_changed')
    }))

  it('adopts nothing when the save point restore is refused', () =>
    withDatabase(async (database) => {
      const harness = await running(database, { savePoint: true, confirmedSteps: 1 })
      const preview = await previewOf(harness)
      // A Plan-dependent Target of the running Plan disappeared: never revived.
      await database.targetWeapons.delete(harness.fixture.built.input.targetWeapons[0].id)

      await expectRefusal(() => adopt(harness, preview, restoreSavePoint(harness.savePoint)), database, 'save_point_required_entity_missing')
    }))
})

describe('replan adoption atomicity', () => {
  async function expectRolledBack(harness: ReplanHarness, preview: ProductionPlanReplanPreview, decision: PlanAbandonSavePointDecision = null) {
    const before = await dump(harness.database)
    const failure = await adopt(harness, preview, decision).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(RepositoryError)
    expect(failure).not.toBeInstanceOf(ExecutionRuntimeError)
    expect(failure).toMatchObject({ code: 'transaction_failed' })
    expect(await dump(harness.database)).toEqual(before)
  }

  async function prepared(database: AppDatabase, options: { inProgress?: boolean } = {}) {
    const harness = await running(database, { savePoint: true, confirmedSteps: 1, persistEntry: false })
    // A weapon in progress outside the save point scope makes the restore
    // refuse, so the restore branch runs without one.
    if (options.inProgress ?? true) await database.ownedWeapons.put(inProgressFor(harness.source, harness.fixture.plan.id))
    return { harness, preview: await previewOf(harness, { generated: true }) }
  }

  const storageFailure = () => {
    throw new Error('storage failure')
  }

  it('rolls back when the generated Entry write fails', () =>
    withDatabase(async (database) => {
      const { harness, preview } = await prepared(database)
      database.buildListEntries.hook('creating', storageFailure)
      await expectRolledBack(harness, preview, keepCurrent(harness.savePoint))
    }))

  it('rolls back when the running Plan write fails', () =>
    withDatabase(async (database) => {
      const { harness, preview } = await prepared(database)
      database.productionPlans.hook('updating', storageFailure)
      await expectRolledBack(harness, preview, keepCurrent(harness.savePoint))
    }))

  it('rolls back when the new Plan add fails', () =>
    withDatabase(async (database) => {
      const { harness, preview } = await prepared(database)
      database.productionPlans.hook('creating', storageFailure)
      await expectRolledBack(harness, preview, keepCurrent(harness.savePoint))
    }))

  it('rolls back when the in-progress transfer write fails', () =>
    withDatabase(async (database) => {
      const { harness, preview } = await prepared(database)
      database.ownedWeapons.hook('updating', storageFailure)
      await expectRolledBack(harness, preview, keepCurrent(harness.savePoint))
    }))

  it('rolls back when the save point delete fails', () =>
    withDatabase(async (database) => {
      const { harness, preview } = await prepared(database)
      database.executionSavePoints.hook('deleting', storageFailure)
      await expectRolledBack(harness, preview, keepCurrent(harness.savePoint))
    }))

  it('rolls back the save point restore branch when a restore write fails', () =>
    withDatabase(async (database) => {
      const { harness, preview } = await prepared(database, { inProgress: false })
      database.executionHistory.hook('deleting', storageFailure)
      await expectRolledBack(harness, preview, restoreSavePoint(harness.savePoint))
    }))
})
