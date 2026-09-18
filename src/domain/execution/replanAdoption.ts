import type {
  BuildListEntry,
  CalculationContext,
  ISODateTimeString,
  OwnedWeapon,
  OwnedWeaponId,
  PlanStepId,
  ProductionPlan,
  ProductionPlanId,
} from '../models/publicTypes'
import { collectReferencedOwnedWeaponIds } from '../models/hashing'
import {
  isCalculationContextCompatible,
  validateOwnedWeapon,
  validateProductionPlan,
} from '../models/publicTypes'
import type { PlannerOrchestrationResult } from '../planner/constrained/plannerConstrainedOrchestration'
import type { PlannerInput } from '../planner/plannerTypes'
import {
  checkGeneratedBuildListEntriesFresh,
  checkPersistablePlannerResultShape,
  checkProductionPlanBuildListReferences,
  findPersistedGeneratedBuildListEntryCollision,
  type PlannerResultPersistenceIssue,
} from '../planner/plannerResultPersistenceValidation'
import {
  collectProductionPlanDependentTargetWeaponIds,
  createDependentBuildListEntriesHash,
  createDependentTargetDefinitionsHash,
} from '../planner/productionPlanGeneration'
import { validateTargetPreferredOwnedWeapons } from '../target/preferredOwnedWeapon'
import { executionFailure } from './executionRuntimeError'
import {
  prepareExecutionSavePointRestore,
  type ExecutionSavePointRestoreWrite,
} from './executionSavePoint'
import {
  assertRunningPlanSavePointDecision,
  deriveRunningPlanSavePointChoiceRequirement,
  type PlanAbandonSavePointDecision,
  type RunningProductionPlanStatus,
} from './planAbandonment'
import {
  createActualExecutionState,
  executionStateMatches,
  type ExecutionPersistedState,
} from './planExecutionState'
import { prepareProductionPlanStart } from './productionPlanStart'
import { inconsistent } from './stepExecution'

/**
 * The running Plan as it was when the replan Preview started
 * (`docs/PLANNER_SPEC.md` 16.8). Adoption re-checks exactly these three values:
 * the Plan, its status and its current Step. `updatedAt` is deliberately not
 * part of it, so a change the specification does not name never refuses the
 * adoption.
 */
export interface ReplanRunningPlanToken {
  planId: ProductionPlanId
  status: RunningProductionPlanStatus
  currentStepId: PlanStepId | null
}

/**
 * What the Application hands to the existing Planner Worker for a replan
 * Preview: the token of the running Plan and a PlannerInput built from the
 * current confirmed persisted state by the ordinary `createPlannerInput()`.
 * The running Plan itself is never part of the PlannerInput.
 */
export interface ProductionPlanReplanPreviewRequest {
  runningPlanToken: ReplanRunningPlanToken
  plannerInput: PlannerInput
  calculationContext: CalculationContext
}

/**
 * A transient replan Preview: the running Plan token, the Planner result and
 * the CalculationContext the Preview was calculated under. It is plain
 * structured-clone data that lives only in memory; it is never persisted,
 * exported, or stored in Dexie.
 */
export interface ProductionPlanReplanPreview {
  runningPlanToken: ReplanRunningPlanToken
  result: PlannerOrchestrationResult
  calculationContext: CalculationContext
}

/** Why a replan Preview can never be adopted, whatever the persisted state is. */
export type ProductionPlanReplanPreviewAdoptability =
  | { adoptable: true; plan: ProductionPlan }
  | { adoptable: false; reason: 'no_plan' | 'incomplete_search' | 'invalid_result'; message: string }

/**
 * The running-Plan token of a replan Preview. Only an `active` or `stale` Plan
 * can be replanned; starting a Preview changes nothing.
 */
export function createReplanRunningPlanToken(plan: ProductionPlan): ReplanRunningPlanToken {
  if (plan.status !== 'active' && plan.status !== 'stale') {
    executionFailure(
      'replan_preview_not_allowed',
      `ProductionPlan '${plan.id}' is '${plan.status}'; only an active or stale Plan can be replanned from the current state.`,
    )
  }
  return { planId: plan.id, status: plan.status, currentStepId: plan.currentStepId }
}

/** Bundles the Planner Worker result with its Preview request, as plain data. */
export function createProductionPlanReplanPreview(
  request: ProductionPlanReplanPreviewRequest,
  result: PlannerOrchestrationResult,
): ProductionPlanReplanPreview {
  return structuredClone({
    runningPlanToken: request.runningPlanToken,
    result,
    calculationContext: request.calculationContext,
  })
}

function issueMessage(issue: PlannerResultPersistenceIssue): string {
  return issue.kind === 'entity_invalid' ? `${issue.entityName} failed Domain validation.` : issue.message
}

/**
 * Whether the Preview's Planner result could ever become the running Plan: a
 * Plan exists, the search was not truncated, and the result passes the same
 * save-time shape checks the ordinary Planner result save applies. A no-Plan
 * result is a valid Preview to show, never one to adopt.
 */
export function describeReplanPreviewAdoptability(
  preview: ProductionPlanReplanPreview,
): ProductionPlanReplanPreviewAdoptability {
  const { plan, generatedBuildListEntries, termination } = preview.result
  if (plan === null) {
    return generatedBuildListEntries.length > 0
      ? {
          adoptable: false,
          reason: 'invalid_result',
          message: `The Planner returned no Plan but ${generatedBuildListEntries.length} generated BuildListEntries. No Entry may be persisted without its Plan.`,
        }
      : { adoptable: false, reason: 'no_plan', message: 'The replan Preview has no ProductionPlan to adopt.' }
  }
  const issue = checkPersistablePlannerResultShape(plan, generatedBuildListEntries, termination)
  if (issue !== null) {
    return {
      adoptable: false,
      reason: termination.status === 'incomplete' ? 'incomplete_search' : 'invalid_result',
      message: issueMessage(issue),
    }
  }
  return { adoptable: true, plan }
}

function requireAdoptablePlan(preview: ProductionPlanReplanPreview): ProductionPlan {
  const adoptability = describeReplanPreviewAdoptability(preview)
  if (adoptability.adoptable) return adoptability.plan
  const { plan, generatedBuildListEntries, termination } = preview.result
  const issue = plan === null ? null : checkPersistablePlannerResultShape(plan, generatedBuildListEntries, termination)
  executionFailure(
    'replan_result_invalid',
    adoptability.message,
    issue?.kind === 'entity_invalid' ? issue.validation.issues : [],
  )
}

/**
 * The running Plan must still be exactly the one the Preview started from
 * (16.8): same Plan, same status, same current Step.
 */
function assertRunningPlanTokenHolds(plan: ProductionPlan, token: ReplanRunningPlanToken): void {
  if (
    plan.id !== token.planId ||
    plan.status !== token.status ||
    plan.currentStepId !== token.currentStepId
  ) {
    executionFailure(
      'replan_state_changed',
      `ProductionPlan '${plan.id}' is now '${plan.status}' at Step '${plan.currentStepId}', not '${token.status}' at Step '${token.currentStepId}' as when the replan Preview started; preview again from the current state.`,
    )
  }
}

type ReplanAdoptionReadState = Pick<
  ExecutionPersistedState,
  'ownedWeapons' | 'targetWeapons' | 'buildListEntries' | 'planExecutionHistory' | 'executionSavePoint'
>

/**
 * What the replan adoption confirmation must show (`docs/UI_FLOW.md` 16.4):
 * the running Plan the Preview replaces, the new Plan, and whether the 16.10
 * save point choice is asked. It is advisory only: the adoption re-derives
 * everything inside its own transaction.
 */
export type ProductionPlanReplanAdoptionOptions = {
  runningPlanId: ProductionPlanId
  runningPlanStatus: RunningProductionPlanStatus
  runningPlanCurrentStepId: PlanStepId | null
  newPlanId: ProductionPlanId
} & (
  | { savePointChoiceRequired: false }
  | {
      savePointChoiceRequired: true
      savePointRecordedAt: ISODateTimeString
      savePointLastExecutionHistoryId: ExecutionSavePointRestoreWrite['savePoint']['lastExecutionHistoryId']
      /** The running Plan's current Step when the save point was recorded. */
      savePointCurrentStepId: PlanStepId | null
    }
)

/**
 * Reads what adopting the Preview would ask. It refuses a Preview that can
 * never be adopted or whose running Plan already moved on, and changes nothing.
 */
export function inspectProductionPlanReplanAdoption(
  preview: ProductionPlanReplanPreview,
  runningPlan: ProductionPlan,
  state: Pick<ReplanAdoptionReadState, 'planExecutionHistory' | 'executionSavePoint'>,
): ProductionPlanReplanAdoptionOptions {
  assertRunningPlanTokenHolds(runningPlan, preview.runningPlanToken)
  const newPlan = requireAdoptablePlan(preview)
  const base = {
    runningPlanId: runningPlan.id,
    runningPlanStatus: preview.runningPlanToken.status,
    runningPlanCurrentStepId: runningPlan.currentStepId,
    newPlanId: newPlan.id,
  }
  const choice = deriveRunningPlanSavePointChoiceRequirement(
    runningPlan,
    state.executionSavePoint,
    state.planExecutionHistory,
  )
  if (!choice.required) return { ...base, savePointChoiceRequired: false }
  return {
    ...base,
    savePointChoiceRequired: true,
    savePointRecordedAt: choice.savePoint.recordedAt,
    savePointLastExecutionHistoryId: choice.savePoint.lastExecutionHistoryId,
    savePointCurrentStepId: choice.savePoint.productionPlan.currentStepId,
  }
}

export interface ProductionPlanReplanAdoptionInput {
  preview: ProductionPlanReplanPreview
  /** The current persisted Plan named by the Preview token. */
  runningPlan: ProductionPlan
  savePointDecision: PlanAbandonSavePointDecision
  state: ReplanAdoptionReadState &
    Pick<ExecutionPersistedState, 'rngState' | 'normalCounters'> & {
      /** Every persisted Plan whose status is `active` or `stale`. */
      runningPlans: readonly ProductionPlan[]
      /** Whether a ProductionPlan with the Preview's new Plan ID is already persisted. */
      newPlanIdPersisted: boolean
    }
  currentCalculationContext: CalculationContext
  now: ISODateTimeString
}

/**
 * Everything one replan adoption writes (`docs/DATA_MODEL.md` 14.4), decided
 * and validated before a single write happens.
 *
 * - `save_point_restored`: the user chose 「最後のゲーム内セーブ地点へ戻す」.
 *   Only the save point restore is written; the Preview is not adopted, the
 *   running Plan is not abandoned, nothing of the Preview is persisted, and a
 *   new Preview from the restored state is required (16.8 / 16.10).
 * - `adopted`: the running Plan becomes `abandoned` (`replan_adopted`), the new
 *   Plan becomes `active`, the generated Entries are added, in-progress marks
 *   are moved or cleared, and the running Plan's save point is deleted.
 */
export type ProductionPlanReplanAdoptionWrite =
  | { kind: 'save_point_restored'; restore: ExecutionSavePointRestoreWrite }
  | {
      kind: 'adopted'
      savePointHandling: 'no_choice' | 'keep_current'
      /** The abandoned running Plan. */
      oldPlan: ProductionPlan
      /** The new Plan, started. It is added, never put over an existing Plan. */
      newPlan: ProductionPlan
      /** Added, never put over an existing Entry. */
      generatedBuildListEntries: BuildListEntry[]
      /** Weapons whose in-progress mark moved to the new Plan or was cleared. */
      ownedWeapons: OwnedWeapon[]
      deletesExecutionSavePoint: boolean
    }

function replanStateChanged(message: string): never {
  executionFailure('replan_state_changed', `${message} Preview again from the current state.`)
}

function throwAdoptionIssue(issue: PlannerResultPersistenceIssue | null): void {
  if (issue === null) return
  if (issue.kind === 'state_changed') replanStateChanged(issue.message)
  executionFailure(
    'replan_result_invalid',
    issueMessage(issue),
    issue.kind === 'entity_invalid' ? issue.validation.issues : [],
  )
}

/**
 * Decides one 「この再計画を採用」 (`docs/PLANNER_SPEC.md` 16.8 / 16.10).
 *
 * Refused unless the running Plan's status and current Step are still what the
 * Preview started from, the Preview holds an adoptable Plan, and the save point
 * decision answers the 16.10 choice re-derived here. Restoring the save point
 * ends the adoption there. Otherwise the adoption re-verifies, against the
 * current persisted state, what the new Plan was calculated from: the
 * RNG / Normal Counter / OwnedWeapon / Plan-dependent Target execution state
 * (`initialExecutionState`), the new Plan's dependent Target definitions and
 * dependent Entries (with the generated Entries added), the CalculationContext,
 * and the generated Entries themselves. Targets and Entries the new Plan does
 * not depend on never refuse it, because the whole-input audit hashes are not
 * adoption authority. The new Plan is then started through the ordinary Plan
 * start authority, with the running Plan already treated as abandoned.
 */
export function prepareProductionPlanReplanAdoption(
  input: ProductionPlanReplanAdoptionInput,
): ProductionPlanReplanAdoptionWrite {
  const { preview, runningPlan, savePointDecision, state, now } = input
  assertRunningPlanTokenHolds(runningPlan, preview.runningPlanToken)
  const newPlan = requireAdoptablePlan(preview)

  const choice = deriveRunningPlanSavePointChoiceRequirement(
    runningPlan,
    state.executionSavePoint,
    state.planExecutionHistory,
  )
  assertRunningPlanSavePointDecision(runningPlan, choice, savePointDecision)
  if (savePointDecision?.kind === 'restore_save_point') {
    // 16.8: returning to the save point ends the adoption. The restore
    // contract applies as it is, with every refusal before any write, and
    // nothing of the Preview is used afterwards.
    return {
      kind: 'save_point_restored',
      restore: prepareExecutionSavePointRestore({
        plan: runningPlan,
        recordedAt: savePointDecision.recordedAt,
        state,
        currentCalculationContext: input.currentCalculationContext,
      }),
    }
  }

  const generatedEntries = preview.result.generatedBuildListEntries
  assertPreviewStateHolds(input, newPlan, generatedEntries)
  const augmentedEntries = [...state.buildListEntries, ...generatedEntries]

  // The ordinary Plan start authority, over the post-state in which the
  // running Plan is already abandoned: any other running Plan still refuses.
  const startedPlan = prepareProductionPlanStart({
    plan: newPlan,
    runningPlans: state.runningPlans.filter(({ id }) => id !== runningPlan.id),
    state: {
      rngState: state.rngState,
      normalCounters: state.normalCounters,
      ownedWeapons: state.ownedWeapons,
      targetWeapons: state.targetWeapons,
      buildListEntries: augmentedEntries,
      // The new Plan has not executed anything, so no observation binding applies.
      planExecutionHistory: [],
      executionSavePoint: null,
    },
    currentCalculationContext: input.currentCalculationContext,
    now,
  })

  const oldPlan: ProductionPlan = {
    // `currentStepId`, every Step completion and `recalculationReasons` stay:
    // the Plan records where it stopped, and a stale reason survives (16.2).
    ...structuredClone(runningPlan),
    status: 'abandoned',
    abandonmentReason: 'replan_adopted',
    abandonedAt: now,
    completedAt: null,
    updatedAt: now,
  }

  const trackedByNewPlan = collectNewPlanTrackedOwnedWeaponIds(startedPlan, augmentedEntries, state.ownedWeapons)
  const ownedWeapons = state.ownedWeapons.flatMap((weapon): OwnedWeapon[] => {
    const inProgress = weapon.executionInProgress
    if (inProgress?.productionPlanId !== runningPlan.id) return []
    return [{
      ...structuredClone(weapon),
      // The physical production that started under the running Plan goes on
      // under the new Plan, so its start time is kept (16.10.1).
      executionInProgress: trackedByNewPlan.has(weapon.id)
        ? { productionPlanId: startedPlan.id, startedAt: inProgress.startedAt }
        : null,
      updatedAt: now,
    }]
  })

  assertAdoptedStateValid(oldPlan, startedPlan, ownedWeapons, input)
  return {
    kind: 'adopted',
    savePointHandling: savePointDecision === null ? 'no_choice' : 'keep_current',
    oldPlan,
    newPlan: startedPlan,
    generatedBuildListEntries: structuredClone(generatedEntries),
    ownedWeapons,
    deletesExecutionSavePoint: state.executionSavePoint !== null,
  }
}

/**
 * 16.8 adoption re-verification of what the Preview calculated from. Every
 * difference refuses with `replan_state_changed`, except an ID collision of the
 * new Plan and broken references of the result itself.
 */
function assertPreviewStateHolds(
  input: ProductionPlanReplanAdoptionInput,
  newPlan: ProductionPlan,
  generatedEntries: readonly BuildListEntry[],
): void {
  const { preview, runningPlan, state, currentCalculationContext } = input
  if (
    !isCalculationContextCompatible(currentCalculationContext, preview.calculationContext) ||
    !isCalculationContextCompatible(currentCalculationContext, newPlan.calculationContext) ||
    !isCalculationContextCompatible(currentCalculationContext, newPlan.baseSnapshot.calculationContext)
  ) {
    replanStateChanged('The current CalculationContext is no longer compatible with the replan Preview.')
  }
  if (newPlan.id === runningPlan.id || state.newPlanIdPersisted) {
    executionFailure(
      'replan_plan_id_collision',
      `ProductionPlan '${newPlan.id}' already exists; a replan Preview never overwrites a persisted Plan.`,
    )
  }
  throwAdoptionIssue(findPersistedGeneratedBuildListEntryCollision(generatedEntries, state.buildListEntries))

  const augmentedEntries = [...state.buildListEntries, ...generatedEntries]
  const missingEntry = newPlan.selectedBuildListEntryIds.find(
    (id) => !augmentedEntries.some((entry) => entry.id === id),
  )
  if (missingEntry !== undefined) {
    replanStateChanged(`BuildListEntry '${missingEntry}' the new Plan depends on no longer exists.`)
  }
  if (
    createDependentBuildListEntriesHash(augmentedEntries, newPlan.selectedBuildListEntryIds) !==
    newPlan.baseSnapshot.dependentBuildListEntriesHash
  ) {
    replanStateChanged('A BuildListEntry the new Plan depends on changed after the replan Preview.')
  }
  const dependentTargetIds = collectProductionPlanDependentTargetWeaponIds(newPlan, augmentedEntries)
  if (
    createDependentTargetDefinitionsHash([...state.targetWeapons], dependentTargetIds) !==
    newPlan.baseSnapshot.dependentTargetDefinitionsHash
  ) {
    replanStateChanged('A Target definition, priority or enablement the new Plan depends on changed after the replan Preview.')
  }
  const actual = createActualExecutionState(
    newPlan,
    { ...state, buildListEntries: augmentedEntries },
    [],
  )
  if (!executionStateMatches(actual, newPlan.baseSnapshot.initialExecutionState)) {
    replanStateChanged(
      'The current RNG, Normal Counter, OwnedWeapon or Plan-dependent Target state differs from the state the replan Preview was calculated from.',
    )
  }
  throwAdoptionIssue(checkGeneratedBuildListEntriesFresh(generatedEntries, state, currentCalculationContext))
  throwAdoptionIssue(checkProductionPlanBuildListReferences(newPlan, generatedEntries, augmentedEntries))
}

/**
 * The currently existing OwnedWeapons the new Plan keeps tracking: the weapons
 * the Routes of its selected BuildListEntries reference (16.8 / 16.10.1). A
 * weapon the new Plan would only register later is not an existing weapon and
 * is never tracked here.
 */
function collectNewPlanTrackedOwnedWeaponIds(
  newPlan: ProductionPlan,
  augmentedEntries: readonly BuildListEntry[],
  ownedWeapons: readonly OwnedWeapon[],
): Set<OwnedWeaponId> {
  const existing = new Set(ownedWeapons.map(({ id }) => id))
  const selected = new Set(newPlan.selectedBuildListEntryIds)
  return new Set(
    augmentedEntries
      .filter(({ id }) => selected.has(id))
      .flatMap((entry) => collectReferencedOwnedWeaponIds(entry.candidateSnapshot.route))
      .filter((id) => existing.has(id)),
  )
}

/**
 * The adopted state validated before any write: both Plans, every changed
 * weapon, the unchanged Target preference collection over the next weapons,
 * and no weapon left in progress for the abandoned Plan.
 */
function assertAdoptedStateValid(
  oldPlan: ProductionPlan,
  newPlan: ProductionPlan,
  changedWeapons: readonly OwnedWeapon[],
  input: ProductionPlanReplanAdoptionInput,
): void {
  for (const plan of [oldPlan, newPlan]) {
    const validation = validateProductionPlan(plan)
    if (!validation.isValid) {
      executionFailure('entity_validation_failed', `ProductionPlan '${plan.id}' fails Domain validation after the replan adoption.`, validation.issues)
    }
  }
  for (const weapon of changedWeapons) {
    const validation = validateOwnedWeapon(weapon)
    if (!validation.isValid) {
      executionFailure('entity_validation_failed', `OwnedWeapon '${weapon.id}' fails Domain validation after the replan adoption.`, validation.issues)
    }
  }
  const changedById = new Map(changedWeapons.map((weapon) => [weapon.id, weapon]))
  const nextWeapons = input.state.ownedWeapons.map((weapon) => changedById.get(weapon.id) ?? weapon)
  const preferences = validateTargetPreferredOwnedWeapons([...input.state.targetWeapons], nextWeapons)
  if (!preferences.isValid) {
    executionFailure('collection_validation_failed', 'The Target preferred owned weapon collection is invalid after the replan adoption.', preferences.issues)
  }
  const stillInProgress = nextWeapons.find(({ executionInProgress }) => executionInProgress?.productionPlanId === oldPlan.id)
  if (stillInProgress !== undefined) {
    inconsistent(`OwnedWeapon '${stillInProgress.id}' is still in progress for the abandoned ProductionPlan '${oldPlan.id}'.`)
  }
}
