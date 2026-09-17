import type {
  ActualResult,
  BuildListEntry,
  CalculationContext,
  ExecutionHistory,
  ExecutionHistoryId,
  ISODateTimeString,
  NormalArtianCounter,
  ObservedRestorationBonusBinding,
  OwnedGogmaArtianWeapon,
  OwnedNormalArtianWeapon,
  OwnedWeapon,
  OwnedWeaponId,
  PlanStepId,
  ProductionPlan,
  RestorationBonusSet,
  RngState,
  TargetWeapon,
  TargetWeaponId,
} from '../models/publicTypes'
import {
  areRestorationBonusSlotsEqual,
  stableStringify,
  V1_NORMAL_ARTIAN_RARITY,
  validateExecutionHistory,
  validateOwnedWeapon,
  validateProductionPlan,
  validateTargetWeapon,
} from '../models/publicTypes'
import type { RngEngine } from '../rng/rngEngine'
import { validateTargetPreferredOwnedWeapons } from '../target/preferredOwnedWeapon'
import { executionFailure } from './executionRuntimeError'
import {
  assertExecutableProductionPlan,
  assertPlanDependenciesUnchanged,
  collectPlanObservationBindings,
  createActualExecutionState,
  executionStateMatches,
  requireCurrentPlanStep,
  type ExecutableProductionPlanStep,
  type ExecutionPersistedState,
} from './planExecutionState'

/**
 * The Domain Counter advance authority (`docs/RNG_SPEC.md`): the same RngEngine
 * methods the Planner advanced its simulated Counters with. Execution applies a
 * Step's recorded `rngAdvance` through it and never writes `counter + 1`.
 */
export type ExecutionCounterAuthority = Pick<
  RngEngine,
  'advanceGogmaCounter' | 'advanceSkillCounter' | 'advanceNormalCounter'
>

/** The five slots the user observed on a blind production-target Normal (16.4). */
export interface ExecutionNormalRestorationBonusObservation {
  kind: 'normal_restoration_bonuses'
  restorationBonuses: RestorationBonusSet
}

export interface ExpectedStepConfirmationInput {
  plan: ProductionPlan
  planStepId: PlanStepId
  /** Required exactly for a Step with an observation binding. */
  observation: ExecutionNormalRestorationBonusObservation | null
  state: ExecutionPersistedState
  currentCalculationContext: CalculationContext
  counterAuthority: ExecutionCounterAuthority
  /**
   * Entity validation of the OwnedWeapon registered from an observation beyond
   * its structure: the Master / Production availability authority an Owned
   * Weapon save uses. Returns human-readable issues; empty means valid.
   */
  validateObservedWeapon: (weapon: OwnedWeapon) => readonly string[]
  executionHistoryId: ExecutionHistoryId
  now: ISODateTimeString
}

/**
 * Everything one `confirmed_expected` Step confirmation writes, decided and
 * validated before a single write happens (`docs/DATA_MODEL.md` 14.4).
 */
export interface ExpectedStepConfirmation {
  rngState: RngState | null
  normalCounters: NormalArtianCounter[]
  ownedWeapons: OwnedWeapon[]
  targetWeapons: TargetWeapon[]
  plan: ProductionPlan
  history: ExecutionHistory
  /** Whether the Plan's game save point is deleted (the Plan completed). */
  deletesExecutionSavePoint: boolean
}

function changed(before: unknown, after: unknown): boolean {
  if (before === undefined || after === undefined) return before !== after
  return stableStringify(before) !== stableStringify(after)
}

function inconsistent(message: string): never {
  executionFailure('execution_effect_inconsistent', message)
}

function assertNoCounterAdvance(step: ExecutableProductionPlanStep, streams: readonly ('gogma' | 'skill' | 'normal')[]) {
  const advance = step.rngAdvance
  if (streams.includes('gogma') && advance.gogmaCounterDelta !== 0) {
    inconsistent(`PlanStep '${step.id}' (${step.operationType}) cannot advance the Gogma Counter.`)
  }
  if (streams.includes('skill') && advance.skillCounterDelta !== 0) {
    inconsistent(`PlanStep '${step.id}' (${step.operationType}) cannot advance the Skill Counter.`)
  }
  if (streams.includes('normal') && (advance.normalCounterDelta !== null || advance.affectedNormalCounterId !== null)) {
    inconsistent(`PlanStep '${step.id}' (${step.operationType}) cannot advance a Normal Artian Counter.`)
  }
}

function advanceKnownCounter(
  step: ExecutableProductionPlanStep,
  label: string,
  current: number | null,
  delta: number,
  advance: (value: number) => number,
): number {
  if (current === null) {
    inconsistent(`PlanStep '${step.id}' advances the ${label}, but its current value is unknown.`)
  }
  const next = advance(current)
  if (next - current !== delta) {
    inconsistent(`PlanStep '${step.id}' records a ${label} advance of ${delta}, but the Counter authority advances it by ${next - current}.`)
  }
  return next
}

/**
 * Applies the Step's `rngAdvance` immediately (`docs/PLANNER_SPEC.md` 16.1),
 * through the Counter authority and only for the stream its operation moves.
 * `normalCounterDelta = null` means the Step represents no Normal Counter
 * advance; it is never read as 0 and never creates a Counter record.
 */
function applyRngAdvance(
  step: ExecutableProductionPlanStep,
  rngState: RngState,
  normalCounters: readonly NormalArtianCounter[],
  authority: ExecutionCounterAuthority,
  now: ISODateTimeString,
): { rngState: RngState; normalCounters: NormalArtianCounter[] } {
  const advance = step.rngAdvance
  let nextRng = rngState
  let nextCounters = [...normalCounters]
  switch (step.operationType) {
    case 'create_normal_artian': {
      assertNoCounterAdvance(step, ['gogma', 'skill'])
      if (advance.normalCounterDelta === null) {
        if (advance.affectedNormalCounterId !== null) {
          inconsistent(`PlanStep '${step.id}' names a Normal Counter without an advance.`)
        }
        break
      }
      const counterId = advance.affectedNormalCounterId
      const record = counterId === null ? undefined : normalCounters.find(({ id }) => id === counterId)
      if (record === undefined || !record.isConfirmed) {
        inconsistent(`PlanStep '${step.id}' advances Normal Counter '${counterId}', which is not a confirmed Counter.`)
      }
      const counter = advanceKnownCounter(step, 'Normal Artian Counter', record.counter, advance.normalCounterDelta, (value) =>
        authority.advanceNormalCounter(value, { type: 'create_normal_artian', count: 1 }))
      nextCounters = normalCounters.map((existing) =>
        existing.id === record.id ? { ...existing, counter, updatedAt: now } : existing)
      break
    }
    case 'convert_normal_to_gogma':
    case 'reset_skills': {
      assertNoCounterAdvance(step, ['gogma', 'normal'])
      const operation = { type: step.operationType }
      const value = advanceKnownCounter(step, 'Skill Counter', rngState.skillCounter.value, advance.skillCounterDelta, (current) =>
        authority.advanceSkillCounter(current, operation))
      nextRng = { ...rngState, skillCounter: { ...rngState.skillCounter, value }, updatedAt: now }
      break
    }
    case 'reset_bonuses':
    case 'keep_bonuses': {
      assertNoCounterAdvance(step, ['skill', 'normal'])
      const operation = { type: step.operationType }
      const value = advanceKnownCounter(step, 'Gogma Counter', rngState.gogmaCounter.value, advance.gogmaCounterDelta, (current) =>
        authority.advanceGogmaCounter(current, operation))
      nextRng = { ...rngState, gogmaCounter: { ...rngState.gogmaCounter, value }, updatedAt: now }
      break
    }
    case 'confirm_owned_ideal':
      assertNoCounterAdvance(step, ['gogma', 'skill', 'normal'])
      break
    case 'reserve_weapon':
    case 'confirm_result':
      executionFailure('plan_not_executable', `PlanStep '${step.id}' is a legacy '${step.operationType}' Step.`)
  }
  return { rngState: nextRng, normalCounters: nextCounters }
}

interface MutableExecutionState {
  weapons: Map<OwnedWeaponId, OwnedWeapon>
  targets: Map<TargetWeaponId, TargetWeapon>
}

function requireTarget(state: MutableExecutionState, id: TargetWeaponId | null, stepId: PlanStepId): TargetWeapon {
  const target = id === null ? undefined : state.targets.get(id)
  if (!target) inconsistent(`PlanStep '${stepId}' references TargetWeapon '${id}', which does not exist.`)
  return target
}

function requireWeapon(state: MutableExecutionState, id: OwnedWeaponId | null, stepId: PlanStepId): OwnedWeapon {
  const weapon = id === null ? undefined : state.weapons.get(id)
  if (!weapon) inconsistent(`PlanStep '${stepId}' operates on OwnedWeapon '${id}', which does not exist.`)
  return weapon
}

function inProgressFor(plan: ProductionPlan, now: ISODateTimeString) {
  return { productionPlanId: plan.id, startedAt: now }
}

/**
 * Registers the production-target Normal under its Planner-reserved ID
 * (`docs/PLANNER_SPEC.md` 16.3): the predicted five slots of a predicted Normal,
 * or the user's observed five slots of a blind one - never fabricated slots.
 */
function registerProductionTargetNormal(
  input: ExpectedStepConfirmationInput,
  step: ExecutableProductionPlanStep,
  state: MutableExecutionState,
): void {
  const { plan, now } = input
  const effects = step.executionEffects
  const weaponId = effects.trackedOwnedWeaponId
  if (weaponId === null || !effects.registersTrackedWeapon) {
    inconsistent(`PlanStep '${step.id}' is a production-target Normal without a registered tracked weapon.`)
  }
  if (state.weapons.has(weaponId)) {
    inconsistent(`The production-target OwnedWeapon ID '${weaponId}' already exists.`)
  }
  const target = requireTarget(state, step.targetWeaponId, step.id)
  let restorationBonuses: RestorationBonusSet
  let weaponTypeId = target.weaponTypeId
  let elementId = target.elementId
  if (effects.observationBinding !== null) {
    if (input.observation === null) {
      executionFailure('observation_required', `PlanStep '${step.id}' needs the five restoration bonus slots observed in the game.`)
    }
    restorationBonuses = structuredClone(input.observation.restorationBonuses)
  } else {
    const predicted = step.inventoryChange?.addOwnedWeapon ?? null
    if (predicted === null || predicted.id !== weaponId || predicted.kind !== 'normal') {
      inconsistent(`PlanStep '${step.id}' has no predicted production-target Normal to register.`)
    }
    restorationBonuses = structuredClone(predicted.restorationBonuses)
    weaponTypeId = predicted.weaponTypeId
    elementId = predicted.elementId
  }
  const registered: OwnedNormalArtianWeapon = {
    id: weaponId,
    kind: 'normal',
    name: target.name,
    weaponTypeId,
    elementId,
    rarity: V1_NORMAL_ARTIAN_RARITY,
    restorationBonuses,
    restorationBonusScope: 'normal_artian',
    seriesSkillId: null,
    groupSkillId: null,
    status: null,
    isProtected: false,
    executionInProgress: inProgressFor(plan, now),
    memo: null,
    createdAt: now,
    updatedAt: now,
  }
  if (effects.observationBinding !== null) {
    const structural = validateOwnedWeapon(registered)
    const entity = structural.isValid ? input.validateObservedWeapon(registered) : []
    if (!structural.isValid || entity.length > 0) {
      executionFailure(
        'observation_invalid',
        `The observed five slots are not a valid Normal Artian for PlanStep '${step.id}': ${[
          ...structural.issues.map(({ path, message }) => `${path}: ${message}`),
          ...entity,
        ].join(' / ')}`,
        structural.issues,
      )
    }
  }
  state.weapons.set(weaponId, registered)
}

/** Updates the tracked weapon in place with the Step's recorded expected result. */
function updateTrackedWeapon(
  input: ExpectedStepConfirmationInput,
  step: ExecutableProductionPlanStep,
  state: MutableExecutionState,
): void {
  const { now } = input
  const weapon = requireWeapon(state, step.executionEffects.trackedOwnedWeaponId, step.id)
  const result = step.expectedResult
  if (result === null) inconsistent(`PlanStep '${step.id}' has no expected result.`)
  switch (step.operationType) {
    case 'convert_normal_to_gogma': {
      if (weapon.kind !== 'normal') inconsistent(`Conversion source '${weapon.id}' is not a Normal Artian.`)
      if (
        result.restorationBonuses !== null &&
        !areRestorationBonusSlotsEqual(weapon.restorationBonuses, result.restorationBonuses)
      ) {
        inconsistent(`Conversion of '${weapon.id}' does not preserve its five slots.`)
      }
      const { rarity: _rarity, ...rest } = weapon
      void _rarity
      const converted: OwnedGogmaArtianWeapon = {
        ...rest,
        kind: 'gogma',
        seriesSkillId: result.seriesSkillId,
        groupSkillId: result.groupSkillId,
        status: 'unclassified',
        updatedAt: now,
      }
      state.weapons.set(weapon.id, converted)
      return
    }
    case 'reset_bonuses':
    case 'keep_bonuses':
      if (weapon.kind !== 'gogma' || result.restorationBonuses === null) {
        inconsistent(`The bonus amendment of '${weapon.id}' has no Gogma weapon or no expected result.`)
      }
      state.weapons.set(weapon.id, {
        ...weapon,
        restorationBonuses: structuredClone(result.restorationBonuses),
        restorationBonusScope: 'gogma_artian',
        updatedAt: now,
      })
      return
    case 'reset_skills':
      if (weapon.kind !== 'gogma') inconsistent(`Reset Skills of '${weapon.id}' has no Gogma weapon.`)
      state.weapons.set(weapon.id, {
        ...weapon,
        seriesSkillId: result.seriesSkillId,
        groupSkillId: result.groupSkillId,
        updatedAt: now,
      })
      return
    default:
      inconsistent(`PlanStep '${step.id}' (${step.operationType}) does not update a tracked weapon.`)
  }
}

/**
 * Marks the tracked weapon of a real game operation as being produced by this
 * Plan (`docs/PLANNER_SPEC.md` 16.10.1). A weapon already in progress for this
 * Plan keeps its original start time; one in progress for another Plan fails
 * closed.
 */
function markTrackedWeaponInProgress(
  input: ExpectedStepConfirmationInput,
  step: ExecutableProductionPlanStep,
  state: MutableExecutionState,
): void {
  const weapon = requireWeapon(state, step.executionEffects.trackedOwnedWeaponId, step.id)
  const current = weapon.executionInProgress
  if (current === null) {
    state.weapons.set(weapon.id, { ...weapon, executionInProgress: inProgressFor(input.plan, input.now), updatedAt: input.now })
  } else if (current.productionPlanId !== input.plan.id) {
    inconsistent(`OwnedWeapon '${weapon.id}' is in progress for another ProductionPlan '${current.productionPlanId}'.`)
  }
}

function withPreference(target: TargetWeapon, preferredOwnedWeaponId: OwnedWeaponId | null, now: ISODateTimeString): TargetWeapon {
  return target.preferredOwnedWeaponId === preferredOwnedWeaponId
    ? target
    : { ...target, preferredOwnedWeaponId, updatedAt: now }
}

/** Target links (16.11): the linked Target takes the weapon from any other Target. */
function applyTargetLinks(
  input: ExpectedStepConfirmationInput,
  step: ExecutableProductionPlanStep,
  state: MutableExecutionState,
): void {
  const weaponId = step.executionEffects.trackedOwnedWeaponId
  step.executionEffects.targetLinks.forEach((link) => {
    if (weaponId === null) inconsistent(`PlanStep '${step.id}' links a Target without a tracked weapon.`)
    requireWeapon(state, weaponId, step.id)
    const linked = requireTarget(state, link.targetWeaponId, step.id)
    state.targets.forEach((target) => {
      if (target.id !== linked.id && target.preferredOwnedWeaponId === weaponId) {
        state.targets.set(target.id, withPreference(target, null, input.now))
      }
    })
    state.targets.set(linked.id, withPreference(linked, weaponId, input.now))
    const holders = [...state.targets.values()].filter(({ preferredOwnedWeaponId }) => preferredOwnedWeaponId === weaponId)
    if (holders.length !== 1 || holders[0].id !== linked.id) {
      executionFailure('collection_validation_failed', `After linking, OwnedWeapon '${weaponId}' must be preferred by Target '${linked.id}' only.`)
    }
  })
}

/** Compromise labels (16.12): `practical`, with protection and progress untouched. */
function applyCompromiseLabels(
  input: ExpectedStepConfirmationInput,
  step: ExecutableProductionPlanStep,
  state: MutableExecutionState,
): void {
  step.executionEffects.compromiseLabels.forEach((label) => {
    const weapon = requireWeapon(state, label.ownedWeaponId, step.id)
    if (weapon.kind !== 'gogma') inconsistent(`The compromise label of '${weapon.id}' needs a Gogma weapon.`)
    if (weapon.status !== 'practical') {
      state.weapons.set(weapon.id, { ...weapon, status: 'practical', updatedAt: input.now })
    }
  })
}

/**
 * Ideal completion and Target completion (16.13): the weapon holds the Candidate
 * result as a protected Ideal, and the completed Target plus every Target that
 * preferred the weapon lose that preference - nothing else about those Targets
 * changes.
 */
function applyTargetCompletions(
  input: ExpectedStepConfirmationInput,
  step: ExecutableProductionPlanStep,
  state: MutableExecutionState,
  entryById: ReadonlyMap<string, BuildListEntry>,
): void {
  const { plan, now } = input
  step.executionEffects.targetCompletions.forEach((completion) => {
    const weapon = requireWeapon(state, completion.ownedWeaponId, step.id)
    const entry = entryById.get(completion.buildListEntryId)
    if (!entry || entry.targetWeaponId !== completion.targetWeaponId) {
      inconsistent(`The completion of PlanStep '${step.id}' has no matching BuildListEntry.`)
    }
    if (weapon.kind !== 'gogma') inconsistent(`The completed weapon '${weapon.id}' is not a Gogma weapon.`)
    const candidate = entry.candidateSnapshot
    state.weapons.set(weapon.id, {
      ...weapon,
      restorationBonuses: structuredClone(candidate.finalBonuses),
      restorationBonusScope: candidate.restorationBonusScope,
      seriesSkillId: candidate.seriesSkillId,
      groupSkillId: candidate.groupSkillId,
      status: 'ideal',
      isProtected: true,
      executionInProgress: null,
      updatedAt: now,
    })
    const target = requireTarget(state, completion.targetWeaponId, step.id)
    state.targets.set(target.id, {
      ...target,
      lifecycleStatus: 'completed',
      completedAt: now,
      completedByProductionPlanId: plan.id,
      preferredOwnedWeaponId: null,
      updatedAt: now,
    })
    state.targets.forEach((other) => {
      if (other.preferredOwnedWeaponId === weapon.id) {
        state.targets.set(other.id, withPreference(other, null, now))
      }
    })
    if ([...state.targets.values()].some(({ preferredOwnedWeaponId }) => preferredOwnedWeaponId === weapon.id)) {
      executionFailure('collection_validation_failed', `A Target still prefers the completed weapon '${weapon.id}'.`)
    }
  })
}

function nextPlanAfterStep(
  plan: ProductionPlan,
  step: ExecutableProductionPlanStep,
  now: ISODateTimeString,
): ProductionPlan {
  const steps = plan.steps.map((candidate) =>
    candidate.id === step.id
      ? { ...structuredClone(candidate), isCompleted: true, completedAt: now }
      : structuredClone(candidate))
  const next = steps.find(({ isCompleted }) => !isCompleted) ?? null
  return {
    ...structuredClone(plan),
    steps,
    status: next === null ? 'completed' : 'active',
    currentStepId: next?.id ?? null,
    completedAt: next === null ? now : null,
    abandonmentReason: null,
    abandonedAt: null,
    updatedAt: now,
  }
}

function assertEntitiesValid(weapons: readonly OwnedWeapon[], targets: readonly TargetWeapon[], plan: ProductionPlan) {
  for (const weapon of weapons) {
    const validation = validateOwnedWeapon(weapon)
    if (!validation.isValid) {
      executionFailure('entity_validation_failed', `OwnedWeapon '${weapon.id}' fails Domain validation after the Step.`, validation.issues)
    }
  }
  for (const target of targets) {
    const validation = validateTargetWeapon(target)
    if (!validation.isValid) {
      executionFailure('entity_validation_failed', `TargetWeapon '${target.id}' fails Domain validation after the Step.`, validation.issues)
    }
  }
  const planValidation = validateProductionPlan(plan)
  if (!planValidation.isValid) {
    executionFailure('entity_validation_failed', `ProductionPlan '${plan.id}' fails Domain validation after the Step.`, planValidation.issues)
  }
}

/**
 * Decides one `confirmed_expected` Step confirmation (`docs/PLANNER_SPEC.md`
 * 16.1 / 16.3 / 16.4), purely from the persisted state and the Plan's recorded
 * Step data. It re-runs no RNG prediction.
 *
 * Order: validate the Plan, its current Step, its premises and the
 * `expectedStateBefore`; take the Undo snapshot from the untouched state; apply
 * `rngAdvance`; register or update the tracked weapon; target links; compromise
 * labels; target completions; complete the Step (and the Plan on its last Step,
 * clearing every in-progress weapon of the Plan); verify entities, the Target
 * preference collection and `expectedStateAfter`; build the ExecutionHistory.
 * Any failure throws before the caller writes anything.
 */
export function prepareExpectedStepConfirmation(
  input: ExpectedStepConfirmationInput,
): ExpectedStepConfirmation {
  const { plan, state, now } = input
  if (plan.status !== 'active') {
    executionFailure('plan_not_active', `ProductionPlan '${plan.id}' is '${plan.status}'; only an active Plan accepts Step confirmation.`)
  }
  assertExecutableProductionPlan(plan, input.currentCalculationContext)
  const step = requireCurrentPlanStep(plan, input.planStepId)
  assertPlanDependenciesUnchanged(plan, state.targetWeapons, state.buildListEntries)
  const bindings = collectPlanObservationBindings(plan, state.planExecutionHistory)
  if (!executionStateMatches(createActualExecutionState(plan, state, bindings), step.expectedStateBefore)) {
    executionFailure(
      'execution_state_mismatch',
      `The current RNG, Normal Counter, OwnedWeapon or Plan-dependent Target state differs from the expected state before PlanStep '${step.id}'.`,
    )
  }
  const effects = step.executionEffects
  if (effects.observationBinding === null && input.observation !== null) {
    executionFailure('observation_not_expected', `PlanStep '${step.id}' has no observation binding.`)
  }
  if (effects.observationBinding !== null && input.observation === null) {
    executionFailure('observation_required', `PlanStep '${step.id}' needs the five restoration bonus slots observed in the game.`)
  }

  const weaponsBefore = new Map(state.ownedWeapons.map((weapon) => [weapon.id, weapon]))
  const targetsBefore = new Map(state.targetWeapons.map((target) => [target.id, target]))
  const undoSnapshot = structuredClone({
    rngStateBefore: state.rngState,
    normalCountersBefore: [...state.normalCounters],
    productionPlanBefore: plan,
    executionSavePointBefore: state.executionSavePoint,
  })

  const counters = applyRngAdvance(step, state.rngState, state.normalCounters, input.counterAuthority, now)
  const mutable: MutableExecutionState = {
    weapons: new Map(state.ownedWeapons.map((weapon) => [weapon.id, structuredClone(weapon)])),
    targets: new Map(state.targetWeapons.map((target) => [target.id, structuredClone(target)])),
  }
  const entryById = new Map(state.buildListEntries.map((entry) => [entry.id, entry]))

  if (step.operationType === 'create_normal_artian') {
    if (effects.normalCreationRole === 'production_target') {
      registerProductionTargetNormal(input, step, mutable)
    } else if (effects.normalCreationRole !== 'counter_advance') {
      inconsistent(`PlanStep '${step.id}' has no Normal creation role.`)
    }
  } else if (step.operationType !== 'confirm_owned_ideal') {
    updateTrackedWeapon(input, step, mutable)
    markTrackedWeaponInProgress(input, step, mutable)
  }
  applyTargetLinks(input, step, mutable)
  applyCompromiseLabels(input, step, mutable)
  applyTargetCompletions(input, step, mutable, entryById)

  const nextPlan = nextPlanAfterStep(plan, step, now)
  if (nextPlan.status === 'completed') {
    // 16.2 / 16.10.1: a completed Plan leaves no weapon in progress for it.
    mutable.weapons.forEach((weapon) => {
      if (weapon.executionInProgress?.productionPlanId === plan.id) {
        mutable.weapons.set(weapon.id, { ...weapon, executionInProgress: null, updatedAt: now })
      }
    })
  }

  const nextWeapons = [...mutable.weapons.values()]
  const nextTargets = [...mutable.targets.values()]
  const changedWeapons = nextWeapons.filter((weapon) => changed(weaponsBefore.get(weapon.id), weapon))
  const changedTargets = nextTargets.filter((target) => changed(targetsBefore.get(target.id), target))
  assertEntitiesValid(changedWeapons, changedTargets, nextPlan)
  const preferences = validateTargetPreferredOwnedWeapons(nextTargets, nextWeapons)
  if (!preferences.isValid) {
    executionFailure('collection_validation_failed', 'The Target preferred owned weapon collection is invalid after the Step.', preferences.issues)
  }

  const pendingBindings: ObservedRestorationBonusBinding[] = input.observation === null || effects.trackedOwnedWeaponId === null
    ? bindings
    : [
        ...bindings,
        {
          ownedWeaponId: effects.trackedOwnedWeaponId,
          planStepId: step.id,
          observedRestorationBonuses: input.observation.restorationBonuses,
          observedRestorationBonusScope: 'normal_artian',
        },
      ]
  const actualAfter = createActualExecutionState(
    plan,
    {
      rngState: counters.rngState,
      normalCounters: counters.normalCounters,
      ownedWeapons: nextWeapons,
      targetWeapons: nextTargets,
      buildListEntries: state.buildListEntries,
    },
    pendingBindings,
  )
  if (!executionStateMatches(actualAfter, step.expectedStateAfter)) {
    executionFailure(
      'expected_state_after_mismatch',
      `The state after confirming PlanStep '${step.id}' differs from its expectedStateAfter.`,
    )
  }

  const actualResult: ActualResult | null = input.observation === null
    ? null
    : {
        restorationBonuses: structuredClone(input.observation.restorationBonuses),
        restorationBonusScope: 'normal_artian',
        seriesSkillId: null,
        groupSkillId: null,
        securedOwnedWeaponId: null,
        note: null,
      }
  const history: ExecutionHistory = {
    id: input.executionHistoryId,
    planId: plan.id,
    planStepId: step.id,
    action: 'confirmed_expected',
    actualResult,
    wasExpected: true,
    recalculationReason: null,
    undoSnapshot: {
      rngStateBefore: undoSnapshot.rngStateBefore,
      normalCountersBefore: undoSnapshot.normalCountersBefore,
      affectedOwnedWeaponsBefore: changedWeapons
        .filter(({ id }) => weaponsBefore.has(id))
        .map(({ id }) => structuredClone(weaponsBefore.get(id) as OwnedWeapon)),
      addedOwnedWeaponIds: changedWeapons.filter(({ id }) => !weaponsBefore.has(id)).map(({ id }) => id),
      removedOwnedWeaponsBefore: [],
      affectedTargetWeaponsBefore: changedTargets.map(({ id }) => structuredClone(targetsBefore.get(id) as TargetWeapon)),
      productionPlanBefore: undoSnapshot.productionPlanBefore,
      executionSavePointBefore: undoSnapshot.executionSavePointBefore,
    },
    createdAt: now,
  }
  const historyValidation = validateExecutionHistory(history)
  if (!historyValidation.isValid) {
    executionFailure('entity_validation_failed', 'The ExecutionHistory of the Step fails Domain validation.', historyValidation.issues)
  }

  return {
    rngState: changed(state.rngState, counters.rngState) ? counters.rngState : null,
    normalCounters: counters.normalCounters.filter((counter) =>
      changed(state.normalCounters.find(({ id }) => id === counter.id), counter)),
    ownedWeapons: changedWeapons,
    targetWeapons: changedTargets,
    plan: nextPlan,
    history,
    deletesExecutionSavePoint: nextPlan.status === 'completed' && state.executionSavePoint !== null,
  }
}
