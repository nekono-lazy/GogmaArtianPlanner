import { describe, expect, it } from 'vitest'
import type {
  BuildListEntry,
  BuildRoute,
  OwnedWeaponId,
  TargetWeapon,
} from '../models/publicTypes'
import { stableStringify } from '../models/publicTypes'
import { ownedWeaponId } from '../../test/fixtures/domainData'
import {
  fixture,
  resetRoute,
  routeEntry,
  sourceWeapon,
  target,
} from '../../test/fixtures/plannerBeam'
import {
  IDEAL_SERIES_SKILL_ID,
  idealBonuses,
  normalWeapon,
} from '../../test/fixtures/constrainedEnumeration'
import {
  checkpointBonusEntry,
  checkpointBonusResultAt,
  orchestrationEntry,
  orchestrationScenario,
  orchestrationSource,
  orchestrationTarget,
} from '../../test/fixtures/plannerConstrainedOrchestration'
import { createDeterministicPlannerDependencies, createPlannerSchedulerWorkloadInput } from '../../test/fixtures/plannerSchedulerWorkloads'
import { runPlannerBeamSearchOracle } from '../../test/fixtures/plannerBeamOracle'
import type { PlannerBeamSearchInput } from './plannerBeamSearchTypes'
import { detectPlannerConflicts } from './plannerConflictDetection'
import { entryIsRelevantForState } from './plannerEntryRelevance'
import { preparePlannerInitialContext, type PlannerInitialContext } from './plannerInitialContext'
import { collectPreferredSourceEntryIds } from './plannerPreferredSource'
import type { PlannerRouteUnit } from './plannerRouteProgress'
import {
  initialPlannerLaneProgress,
  nextPlannerLaneUnits,
  remainingPlannerLaneUnits,
} from './plannerRouteLanes'
import {
  applyPlannerReserveAction,
  applyPlannerRouteAction,
  executablePlannerRequiredUnitsByCounterPosition,
  isSkippablePlannerUnitDominatedByRequiredUnit,
  mergedPlannerProgressedEntries,
  type PlannerAppliedActionResult,
  type PlannerReserveActionContext,
  type PlannerRouteActionContext,
  type PlannerStateMutationMode,
} from './plannerStateTransitions'
import type {
  PlannerDependencies,
  PlannerInput,
  PlannerSearchAction,
  PlannerSearchState,
} from './plannerTypes'

/**
 * Issue #103 Phase A0: the action application authority shared by the Beam
 * Search (clone) and the future scheduler (in place). These tests pin that
 * both modes produce the same state, that a clone never writes its source,
 * that an in-place rejection writes nothing, and that replaying the Beam
 * Search's own best trace through the shared helpers reproduces its state.
 */

interface Harness {
  input: PlannerInput
  context: PlannerInitialContext
  reserveContext: PlannerReserveActionContext
  /** The ID the next reserve draws; replay sets it from the recorded trace. */
  setNextOwnedWeaponId: (id: OwnedWeaponId | null) => void
  routeContextFor: (state: PlannerSearchState) => PlannerRouteActionContext
}

function harness(input: PlannerInput, dependencies: PlannerDependencies): Harness {
  const prepared = preparePlannerInitialContext(input, dependencies)
  if (prepared.status === 'invalid') {
    throw new Error(`Fixture input is invalid: ${JSON.stringify(prepared.issues)}`)
  }
  const context = prepared.context
  let nextOwnedWeaponId: OwnedWeaponId | null = null
  const replayDependencies: PlannerDependencies = {
    ...dependencies,
    idFactory: {
      ...dependencies.idFactory,
      ownedWeaponId: () => nextOwnedWeaponId ?? dependencies.idFactory.ownedWeaponId(),
    },
  }
  const preferredSourceEntryIds = collectPreferredSourceEntryIds(
    context.allSearchEntries,
    context.planningTargetsById,
  )
  return {
    input,
    context,
    reserveContext: {
      dependencies: replayDependencies,
      targets: context.planningTargets,
      master: input.master,
      preferredSourceEntryIds,
      requirements: context.checkpointRequirements,
    },
    setNextOwnedWeaponId: (id) => {
      nextOwnedWeaponId = id
    },
    // The same per-state conflict detection the Beam Search runs.
    routeContextFor: (state) => {
      const entries = context.allSearchEntries.filter((entry) =>
        entryIsRelevantForState(state, entry, context.checkpointRequirements),
      )
      const unitPlans = new Map(
        entries.flatMap((entry) => {
          const lanes = context.allLanePlans.get(entry.id)
          if (!lanes) return []
          const progress = state.routeProgressByEntryId[entry.id] ?? initialPlannerLaneProgress()
          return [[entry.id, remainingPlannerLaneUnits(lanes, progress)] as const]
        }),
      )
      const detection = detectPlannerConflicts(
        entries,
        unitPlans,
        context.planningTargets,
        context.validConflictResolutions,
        false,
      )
      return {
        entriesById: context.entriesById,
        lanePlans: context.allLanePlans,
        conflictsById: new Map(detection.conflicts.map((conflict) => [conflict.id, conflict])),
        conflictIdsByUnitKey: detection.conflictIdsByUnitKey,
        selectedPhysicalActionKeysByConflictId:
          detection.selectedPhysicalActionKeysByConflictId,
        targets: context.planningTargets,
        master: input.master,
        engine: dependencies.rngEngine,
        preferredSourceEntryIds,
        requirements: context.checkpointRequirements,
      }
    },
  }
}

function freshInitialState(h: Harness): PlannerSearchState {
  return structuredClone(h.context.initialState)
}

function entryOf(h: Harness, id: string): BuildListEntry {
  const entry = h.context.entriesById.get(id as BuildListEntry['id'])
  if (!entry) throw new Error(`Fixture Entry '${id}' is missing.`)
  return entry
}

function targetOf(h: Harness, entry: BuildListEntry): TargetWeapon {
  const found = h.context.planningTargetsById.get(entry.targetWeaponId)
  if (!found) throw new Error(`Fixture Target '${entry.targetWeaponId}' is missing.`)
  return found
}

function nextUnits(h: Harness, state: PlannerSearchState, entryId: string): PlannerRouteUnit[] {
  const lanes = h.context.allLanePlans.get(entryId as BuildListEntry['id'])
  if (!lanes) throw new Error(`Fixture lanes of '${entryId}' are missing.`)
  return nextPlannerLaneUnits(
    lanes,
    state.routeProgressByEntryId[entryId] ?? initialPlannerLaneProgress(),
  )
}

function nextUnit(h: Harness, state: PlannerSearchState, entryId: string): PlannerRouteUnit {
  const [unit] = nextUnits(h, state, entryId)
  if (!unit) throw new Error(`Entry '${entryId}' has no next unit.`)
  return unit
}

function applyRoute(
  h: Harness,
  state: PlannerSearchState,
  unit: PlannerRouteUnit,
  mode: PlannerStateMutationMode,
): PlannerAppliedActionResult {
  return applyPlannerRouteAction(state, unit, h.routeContextFor(state), { mode })
}

function applyReserve(
  h: Harness,
  state: PlannerSearchState,
  entryId: string,
  mode: PlannerStateMutationMode,
  zeroOperationConfirm = false,
): PlannerAppliedActionResult {
  const entry = entryOf(h, entryId)
  return applyPlannerReserveAction(state, entry, targetOf(h, entry), h.reserveContext, {
    mode,
    zeroOperationConfirm,
  })
}

function succeeded(result: PlannerAppliedActionResult): PlannerSearchState {
  if (result.state === null) {
    throw new Error(`Unexpected rejection: ${JSON.stringify(result.rejection)}`)
  }
  return result.state
}

/**
 * Applies one action in both modes and checks the mode contract: a clone never
 * writes its source, an in-place application returns its source, and both
 * reach the same state (or the same rejection, with nothing written).
 */
function applyInBothModes(
  apply: (state: PlannerSearchState, mode: PlannerStateMutationMode) => PlannerAppliedActionResult,
  cloneSource: PlannerSearchState,
  inPlaceSource: PlannerSearchState,
): { clone: PlannerAppliedActionResult; inPlace: PlannerAppliedActionResult } {
  expect(inPlaceSource).toEqual(cloneSource)
  const before = structuredClone(cloneSource)
  const clone = apply(cloneSource, 'clone')
  expect(cloneSource).toEqual(before)
  const inPlace = apply(inPlaceSource, 'in_place')
  if (clone.state === null) {
    expect(inPlace).toEqual(clone)
    expect(inPlaceSource).toEqual(before)
  } else {
    expect(clone.state).not.toBe(cloneSource)
    expect(inPlace.state).toBe(inPlaceSource)
    expect(inPlace.state).toEqual(clone.state)
  }
  return { clone, inPlace }
}

/**
 * Replays a Beam Search trace through the shared helpers in both modes, in
 * lockstep: one clone chain and one single state updated in place.
 */
function replayTrace(
  h: Harness,
  trace: readonly PlannerSearchAction[],
): { clone: PlannerSearchState; inPlace: PlannerSearchState } {
  let cloneState = freshInitialState(h)
  const inPlaceState = freshInitialState(h)
  for (const action of trace) {
    const primaryId = action.primaryBuildListEntryId
    let applied: ReturnType<typeof applyInBothModes>
    if (action.kind === 'reserve_candidate') {
      const entry = entryOf(h, primaryId)
      const lanes = h.context.allLanePlans.get(entry.id)
      const target = targetOf(h, entry)
      // The Beam Search's initial zero-operation confirmation.
      const zeroOperationConfirm =
        entry.candidateSnapshot.route.kind === 'existing_gogma_current' &&
        lanes?.unitCount === 0 &&
        cloneState.targetSatisfaction[target.id]?.hasIdeal === true
      applied = applyInBothModes(
        (state, mode) => {
          h.setNextOwnedWeaponId(action.ownedWeaponId)
          return applyReserve(h, state, primaryId, mode, zeroOperationConfirm)
        },
        cloneState,
        inPlaceState,
      )
    } else {
      const position = stableStringify(action.progressedRoutePositions[primaryId])
      const unit = nextUnits(h, cloneState, primaryId).find(
        (candidate) => stableStringify(candidate.position) === position,
      )
      if (!unit) throw new Error(`Trace unit of '${primaryId}' is not a next unit.`)
      applied = applyInBothModes(
        (state, mode) => applyRoute(h, state, unit, mode),
        cloneState,
        inPlaceState,
      )
    }
    expect(applied.clone.rejection).toBeNull()
    expect(applied.clone.state?.trace.at(-1)).toEqual(action)
    cloneState = succeeded(applied.clone)
  }
  h.setNextOwnedWeaponId(null)
  return { clone: cloneState, inPlace: inPlaceState }
}

/** Beam successors carry a score the transitions never compute. */
function withoutScore(state: PlannerSearchState | null): PlannerSearchState | null {
  return state === null ? null : { ...state, evaluationScore: 0 }
}

async function expectBeamTraceReplays(
  input: PlannerInput | PlannerBeamSearchInput,
  dependencies: PlannerDependencies,
) {
  const result = await runPlannerBeamSearchOracle(structuredClone(input), dependencies)
  const best = result.bestState
  if (best === null) throw new Error('The Beam Search returned no state.')
  expect(best.trace.length).toBeGreaterThan(0)
  const replayed = replayTrace(harness(structuredClone(input), dependencies), best.trace)
  expect(withoutScore(replayed.clone)).toEqual(withoutScore(best))
  expect(replayed.inPlace).toEqual(replayed.clone)
  return result
}

function sharedGogmaScenario() {
  const firstTarget = target('target.transition.shared.first')
  const secondTarget = target('target.transition.shared.second')
  const source = sourceWeapon('owned.transition.shared')
  const first = routeEntry('entry.transition.shared.first', firstTarget, resetRoute(source.id))
  const second = routeEntry('entry.transition.shared.second', secondTarget, resetRoute(source.id))
  const { input, dependencies } = fixture([firstTarget, secondTarget], [first, second], [source])
  return { input, dependencies, first, second, source }
}

function gogmaOperation(sourceId: OwnedWeaponId, counter: number): BuildRoute['operations'][number] {
  return {
    type: 'reset_bonuses',
    sourceOwnedWeaponId: sourceId,
    gogmaCounterBefore: counter,
    gogmaCounterAfter: counter + 1,
  }
}

/** Entry A's required unit and Entry B's skippable unit share Gogma Counter 10. */
function sharedPositionScenario(otherCounters: number[]) {
  const requiredTarget = target('target.transition.required')
  const otherTarget = { ...target('target.transition.other'), weaponTypeId: 'weapon.fixture.b' }
  const requiredSource = sourceWeapon('owned.transition.required')
  const otherSource = { ...sourceWeapon('owned.transition.other'), weaponTypeId: 'weapon.fixture.b' }
  const required = routeEntry('entry.transition.required', requiredTarget, {
    kind: 'existing_gogma_reset_bonuses',
    sourceOwnedWeaponId: requiredSource.id,
    operations: [gogmaOperation(requiredSource.id, 10)],
  })
  const other = routeEntry('entry.transition.other', otherTarget, {
    kind: 'existing_gogma_reset_bonuses',
    sourceOwnedWeaponId: otherSource.id,
    operations: otherCounters.map((counter) => gogmaOperation(otherSource.id, counter)),
  })
  const { input, dependencies } = fixture(
    [requiredTarget, otherTarget],
    [required, other],
    [requiredSource, otherSource],
  )
  return { input, dependencies, required, other }
}

function mixedRoute(sourceId: OwnedWeaponId): BuildRoute {
  return {
    kind: 'existing_gogma_mixed',
    sourceOwnedWeaponId: sourceId,
    operations: [
      gogmaOperation(sourceId, 10),
      {
        type: 'reset_skills',
        sourceOwnedWeaponId: sourceId,
        skillCounterBefore: 7,
        skillCounterAfter: 8,
      },
    ],
  }
}

function transientNormalScenario(extraOwnedId: string) {
  const goal = target('target.transition.transient')
  const entry = routeEntry('entry.transition.transient', goal, {
    kind: 'normal_artian_to_gogma',
    sourceOwnedWeaponId: null,
    operations: [
      {
        type: 'create_normal_artian',
        weaponTypeId: 'weapon.fixture.a',
        rarity: 8,
        count: 1,
        normalCounterBefore: 4,
        normalCounterAfter: 5,
      },
      {
        type: 'convert_normal_to_gogma',
        weaponTypeId: 'weapon.fixture.a',
        skillCounterBefore: 7,
        skillCounterAfter: 8,
      },
    ],
  })
  // An unrelated weapon of another type, so its ID is taken in the inventory.
  const unrelated = { ...sourceWeapon(extraOwnedId), weaponTypeId: 'weapon.fixture.b' }
  const { input, dependencies } = fixture([goal], [entry], [unrelated])
  return { input, dependencies, entry, unrelated }
}

function ownedNormalScenario() {
  const goal = target('target.transition.owned-normal')
  const normal = normalWeapon('owned.transition.owned-normal')
  const entry = routeEntry('entry.transition.owned-normal', goal, {
    kind: 'owned_normal_artian_to_gogma',
    sourceOwnedWeaponId: normal.id,
    operations: [{
      type: 'convert_normal_to_gogma',
      weaponTypeId: 'weapon.fixture.a',
      skillCounterBefore: 7,
      skillCounterAfter: 8,
    }],
  })
  const { input, dependencies } = fixture([goal], [entry], [normal])
  return { input, dependencies, entry, normal }
}

function checkpointScenario() {
  const goal = orchestrationTarget('target.transition.checkpoint')
  const source = orchestrationSource('owned.transition.checkpoint', {
    seriesSkillId: IDEAL_SERIES_SKILL_ID,
  })
  const entry = checkpointBonusEntry('build-list.transition.checkpoint', goal, source.id, source)
  const built = orchestrationScenario({
    targets: [goal],
    entries: [entry],
    ownedWeapons: [source],
    engine: { resetResultAt: checkpointBonusResultAt },
  })
  return { ...built, entry }
}

function zeroOperationScenario() {
  const goal = orchestrationTarget('target.transition.zero')
  const source = orchestrationSource('owned.transition.zero', {
    restorationBonuses: idealBonuses(),
    seriesSkillId: IDEAL_SERIES_SKILL_ID,
    isProtected: true,
  })
  const entry = orchestrationEntry('entry.transition.zero', goal, {
    kind: 'existing_gogma_current',
    sourceOwnedWeaponId: source.id,
    operations: [],
  })
  const built = orchestrationScenario({ targets: [goal], entries: [entry], ownedWeapons: [source] })
  return { ...built, entry, source }
}

describe('Planner state transitions: Beam Search parity', { timeout: 60_000 }, () => {
  it('replays the Production sanity-3 Beam trace in both modes', async () => {
    const fixtureInput = createPlannerSchedulerWorkloadInput('sanity-3')
    const result = await expectBeamTraceReplays(
      fixtureInput.input,
      createDeterministicPlannerDependencies(fixtureInput.engine),
    )
    expect(result.completed).toBe(true)
  })

  it('replays a truncated representative-12 Beam trace with detected conflicts', async () => {
    const fixtureInput = createPlannerSchedulerWorkloadInput('representative-12')
    const input: PlannerBeamSearchInput = {
      ...fixtureInput.input,
      options: { maxPlanSteps: 1_000, maxExpandedStates: 300, beamWidth: 6 },
    }
    const result = await expectBeamTraceReplays(
      input,
      createDeterministicPlannerDependencies(fixtureInput.engine),
    )
    expect(result.conflicts.length).toBeGreaterThan(0)
  })

  it('replays shared physical actions, fast-forward, transient output and source versions', async () => {
    for (const scenario of [
      sharedGogmaScenario(),
      sharedPositionScenario([10, 11]),
      transientNormalScenario('owned.transition.unrelated'),
      ownedNormalScenario(),
    ]) {
      const result = await expectBeamTraceReplays(scenario.input, scenario.dependencies)
      expect(result.bestState?.trace.some(({ kind }) => kind === 'route_operation')).toBe(true)
    }
    const source = sourceWeapon('owned.transition.mixed')
    const firstTarget = target('target.transition.mixed.first')
    const secondTarget = target('target.transition.mixed.second')
    const mixed = fixture(
      [firstTarget, secondTarget],
      [
        routeEntry('entry.transition.mixed.first', firstTarget, mixedRoute(source.id)),
        routeEntry('entry.transition.mixed.second', secondTarget, mixedRoute(source.id)),
      ],
      [source],
    )
    await expectBeamTraceReplays(mixed.input, mixed.dependencies)
  })

  it('replays a selected checkpoint and a zero-operation confirmation', async () => {
    const checkpoint = checkpointScenario()
    const checkpointResult = await expectBeamTraceReplays(checkpoint.input, checkpoint.dependencies)
    expect(checkpointResult.completed).toBe(true)
    const zero = zeroOperationScenario()
    // A completed initial state never reaches the Beam loop, but its trace is
    // the one zero-operation confirmation.
    const zeroResult = await expectBeamTraceReplays(zero.input, zero.dependencies)
    expect(zeroResult.bestState?.trace.map(({ actionType }) => actionType)).toEqual(['reserve_weapon'])
  })
})

describe('Planner state transitions: modes', () => {
  it('shares one physical action from the state before the action in both modes', () => {
    const { input, dependencies, first, second, source } = sharedGogmaScenario()
    const h = harness(input, dependencies)
    const unit = nextUnit(h, h.context.initialState, first.id)
    expect(
      mergedPlannerProgressedEntries(h.context.initialState, unit, h.routeContextFor(h.context.initialState))
        .map(({ entryId }) => entryId),
    ).toEqual([first.id, second.id])

    const { clone, inPlace } = applyInBothModes(
      (state, mode) => applyRoute(h, state, unit, mode),
      freshInitialState(h),
      freshInitialState(h),
    )
    // Read after the source mutation, the second Entry's source version would
    // already disagree and the action would progress only the first Entry.
    for (const state of [succeeded(clone), succeeded(inPlace)]) {
      const [action] = state.trace
      expect(action.progressedBuildListEntryIds).toEqual([first.id, second.id])
      expect(Object.keys(action.progressedRoutePositions).sort()).toEqual([first.id, second.id])
      expect(state.routeProgressByEntryId[first.id]).toEqual({ base: 0, bonus: 1, skill: 0 })
      expect(state.routeProgressByEntryId[second.id]).toEqual({ base: 0, bonus: 1, skill: 0 })
      expect(action.inventoryEffect).toEqual({
        addedOwnedWeaponIds: [],
        removedOwnedWeaponIds: [],
        updatedOwnedWeaponIds: [],
        reservedOwnedWeaponIds: [],
        routeOutputChangedForEntryIds: [],
      })
      expect(state.sourceMutationVersionByOwnedWeaponId[source.id]).toBe(1)
      expect(state.routeSourceVersionByEntryId[first.id]).toBe(1)
      expect(state.routeSourceVersionByEntryId[second.id]).toBe(1)
      expect(state.candidateReadySourceVersionByEntryId[first.id]).toBe(1)
      expect(state.candidateReadySourceVersionByEntryId[second.id]).toBe(1)
      expect(state.inFlightExistingSourceByOwnedWeaponId[source.id]).toBe(true)
      expect(state.totalCost).toBe(1)
    }
  })

  it('keeps a required unit ahead of a skippable unit at one Counter position', () => {
    const { input, dependencies, required, other } = sharedPositionScenario([10, 11])
    const h = harness(input, dependencies)
    const initial = h.context.initialState
    const requiredByPosition = executablePlannerRequiredUnitsByCounterPosition(
      initial,
      h.context.allSearchEntries,
      h.context.allLanePlans,
      () => false,
      h.context.checkpointRequirements,
    )
    const requiredUnit = nextUnit(h, initial, required.id)
    const skippableUnit = nextUnit(h, initial, other.id)
    expect(requiredUnit.canSkipWhenCounterPassed).toBe(false)
    expect(skippableUnit.canSkipWhenCounterPassed).toBe(true)
    expect([...requiredByPosition.values()].flat()).toEqual([requiredUnit])
    expect(isSkippablePlannerUnitDominatedByRequiredUnit(skippableUnit, requiredByPosition)).toBe(true)
    expect(isSkippablePlannerUnitDominatedByRequiredUnit(requiredUnit, requiredByPosition)).toBe(false)
    // A blocked required unit no longer holds its position.
    expect(executablePlannerRequiredUnitsByCounterPosition(
      initial,
      h.context.allSearchEntries,
      h.context.allLanePlans,
      () => true,
      h.context.checkpointRequirements,
    ).size).toBe(0)

    // Running the required unit silently fast-forwards the skippable one: it
    // is progressed, but by no action, trace entry, effect or metric.
    const { clone, inPlace } = applyInBothModes(
      (state, mode) => applyRoute(h, state, requiredUnit, mode),
      freshInitialState(h),
      freshInitialState(h),
    )
    for (const state of [succeeded(clone), succeeded(inPlace)]) {
      expect(state.trace).toHaveLength(1)
      expect(state.trace[0].progressedBuildListEntryIds).toEqual([required.id])
      expect(Object.keys(state.trace[0].progressedRoutePositions)).toEqual([required.id])
      expect(state.routeProgressByEntryId[other.id]).toEqual({ base: 0, bonus: 1, skill: 0 })
      expect(state.routeRuntimeByEntryId[other.id]).toEqual(initial.routeRuntimeByEntryId[other.id])
      expect(state.routeSourceVersionByEntryId[other.id]).toBe(0)
      expect(state.preferredSourceProgressCount).toBe(initial.preferredSourceProgressCount)
      expect(state.currentRngState.gogmaCounter.value).toBe(11)
    }
  })

  it('updates and checks source versions identically in both modes', () => {
    const source = sourceWeapon('owned.transition.version')
    const firstTarget = target('target.transition.version.first')
    const secondTarget = target('target.transition.version.second')
    const first = routeEntry('entry.transition.version.first', firstTarget, mixedRoute(source.id))
    const second = routeEntry('entry.transition.version.second', secondTarget, resetRoute(source.id))
    const { input, dependencies } = fixture([firstTarget, secondTarget], [first, second], [source])
    const h = harness(input, dependencies)
    let cloneState = freshInitialState(h)
    const inPlaceState = freshInitialState(h)
    for (const entryId of [first.id, first.id]) {
      const unit = nextUnit(h, cloneState, entryId)
      cloneState = succeeded(applyInBothModes(
        (state, mode) => applyRoute(h, state, unit, mode),
        cloneState,
        inPlaceState,
      ).clone)
    }
    // The shared Reset completed the second Route at version 1; the first
    // Route's Reset Skills then moved the source on to version 2.
    expect(cloneState.trace[0].progressedBuildListEntryIds).toEqual([first.id, second.id])
    expect(cloneState.sourceMutationVersionByOwnedWeaponId[source.id]).toBe(2)
    expect(cloneState.routeSourceVersionByEntryId[first.id]).toBe(2)
    expect(cloneState.routeSourceVersionByEntryId[second.id]).toBe(1)
    expect(cloneState.candidateReadySourceVersionByEntryId[first.id]).toBe(2)
    expect(cloneState.candidateReadySourceVersionByEntryId[second.id]).toBe(1)
    expect(cloneState.inFlightExistingSourceByOwnedWeaponId[source.id]).toBe(true)

    const superseded = applyInBothModes(
      (state, mode) => applyReserve(h, state, second.id, mode),
      cloneState,
      inPlaceState,
    )
    expect(superseded.inPlace.rejection).toMatchObject({
      reason: 'inventory_precondition_failed',
      detail: 'The existing Gogma Candidate was superseded by a later source mutation.',
    })
    const secured = succeeded(applyInBothModes(
      (state, mode) => applyReserve(h, state, first.id, mode),
      cloneState,
      inPlaceState,
    ).clone)
    expect(secured.inFlightExistingSourceByOwnedWeaponId[source.id]).toBeUndefined()
    expect(secured.securedOwnedWeaponIdByEntryId[first.id]).toBe(source.id)
    expect(secured.selectedBuildListEntryIds).toEqual([first.id])
    expect(inPlaceState).toEqual(secured)
  })

  it('refuses a reserve before the selected checkpoint and allows it once reached', () => {
    const { input, dependencies, entry } = checkpointScenario()
    const h = harness(input, dependencies)
    const inPlaceState = freshInitialState(h)
    const early = applyInBothModes(
      (state, mode) => applyReserve(h, state, entry.id, mode),
      freshInitialState(h),
      inPlaceState,
    )
    expect(early.inPlace.rejection?.reason).toBe('selected_checkpoint_not_reached')

    let cloneState = freshInitialState(h)
    while (nextUnits(h, cloneState, entry.id).length > 0) {
      const unit = nextUnit(h, cloneState, entry.id)
      cloneState = succeeded(applyInBothModes(
        (state, mode) => applyRoute(h, state, unit, mode),
        cloneState,
        inPlaceState,
      ).clone)
    }
    expect(cloneState.reachedCheckpointByEntryId[entry.id]).toBe(true)
    const reserved = applyInBothModes(
      (state, mode) => applyReserve(h, state, entry.id, mode),
      cloneState,
      inPlaceState,
    )
    expect(reserved.inPlace.rejection).toBeNull()
    expect(inPlaceState.selectedBuildListEntryIds).toEqual([entry.id])
  })

  it('confirms a zero-operation Candidate only as a zero-operation confirmation', () => {
    const { input, dependencies, entry, source } = zeroOperationScenario()
    const h = harness(input, dependencies)
    const ordinary = applyInBothModes(
      (state, mode) => applyReserve(h, state, entry.id, mode),
      freshInitialState(h),
      freshInitialState(h),
    )
    expect(ordinary.inPlace.rejection?.reason).toBe('candidate_already_satisfied')
    const confirmed = applyInBothModes(
      (state, mode) => applyReserve(h, state, entry.id, mode, true),
      freshInitialState(h),
      freshInitialState(h),
    )
    const state = succeeded(confirmed.inPlace)
    expect(state.trace.map(({ kind, ownedWeaponId }) => ({ kind, ownedWeaponId }))).toEqual([
      { kind: 'reserve_candidate', ownedWeaponId: source.id },
    ])
    expect(state.trace[0].rngAfter).toEqual(state.trace[0].rngBefore)
    expect(state.securedOwnedWeaponIdByEntryId[entry.id]).toBe(source.id)
  })
})

describe('Planner state transitions: an in-place rejection writes nothing', () => {
  it('leaves the state untouched on counter_before_current', () => {
    const { input, dependencies, required, other } = sharedPositionScenario([10])
    const h = harness(input, dependencies)
    const state = freshInitialState(h)
    const passed = nextUnit(h, state, other.id)
    succeeded(applyRoute(h, state, nextUnit(h, state, required.id), 'in_place'))
    const before = structuredClone(state)
    const result = applyRoute(h, state, passed, 'in_place')
    expect(result.rejection?.reason).toBe('counter_before_current')
    expect(result.state).toBeNull()
    expect(state).toEqual(before)
  })

  it('leaves the state untouched on a protected destructive use', () => {
    const { input, dependencies, first, source } = sharedGogmaScenario()
    const h = harness(input, dependencies)
    const state = freshInitialState(h)
    const unit = nextUnit(h, state, first.id)
    const weapon = state.simulatedInventory.ownedWeapons.find(({ id }) => id === source.id)
    if (!weapon) throw new Error('Fixture source is missing.')
    weapon.isProtected = true
    const before = structuredClone(state)
    const result = applyRoute(h, state, unit, 'in_place')
    expect(result.rejection?.reason).toBe('protected_destructive_use')
    expect(state).toEqual(before)
  })

  it('leaves the state untouched when the inventory change fails after the preconditions', () => {
    const { input, dependencies, entry, normal } = ownedNormalScenario()
    const h = harness(input, dependencies)
    const state = freshInitialState(h)
    // The precondition finds an unprotected source; only the conversion itself
    // discovers that it is no Normal Artian.
    state.simulatedInventory.ownedWeapons = state.simulatedInventory.ownedWeapons.map(
      (weapon) => weapon.id === normal.id
        ? { ...sourceWeapon(normal.id), id: ownedWeaponId(normal.id) }
        : weapon,
    )
    const before = structuredClone(state)
    const result = applyRoute(h, state, nextUnit(h, state, entry.id), 'in_place')
    expect(result.rejection).toMatchObject({
      actionType: 'convert_normal_to_gogma',
      reason: 'inventory_precondition_failed',
    })
    expect(state).toEqual(before)
  })

  it('leaves the state untouched when a reserved ID cannot be registered', () => {
    const { input, dependencies, entry, unrelated } = transientNormalScenario('owned.transition.taken')
    const h = harness(input, dependencies)
    const state = freshInitialState(h)
    while (nextUnits(h, state, entry.id).length > 0) {
      succeeded(applyRoute(h, state, nextUnit(h, state, entry.id), 'in_place'))
    }
    expect(state.routeRuntimeByEntryId[entry.id]?.hasUnregisteredGogmaOutput).toBe(true)
    const before = structuredClone(state)
    // The drawn ID is already taken, so the reservation fails after the draw.
    h.setNextOwnedWeaponId(unrelated.id)
    const result = applyReserve(h, state, entry.id, 'in_place')
    h.setNextOwnedWeaponId(null)
    expect(result.rejection).toMatchObject({
      actionType: 'reserve_weapon',
      reason: 'inventory_precondition_failed',
    })
    expect(state).toEqual(before)
    // The same state then secures the Candidate under a free ID.
    const secured = succeeded(applyReserve(h, state, entry.id, 'in_place'))
    expect(secured).toBe(state)
    expect(state.selectedBuildListEntryIds).toEqual([entry.id])
  })
})
