import { describe, expect, it } from 'vitest'
import type { BuildRoute, RouteOperation, TargetWeapon } from '../models/publicTypes'
import { FakeRngEngine, type FakeRngFixtures } from '../rng/fakeRngEngine'
import {
  fixture,
  plannerEngine,
  routeEntry,
  target,
} from '../../test/fixtures/plannerBeam'
import { normalWeapon } from '../../test/fixtures/constrainedEnumeration'
import {
  G0,
  IDEAL_SKILL,
  N0,
  NORMAL_COUNTER_ID,
  S0,
  SchedulerScenarioBuilder,
  schedulerIdeal,
} from '../../test/fixtures/plannerScheduler'
import type { OrchestrationScenario } from '../../test/fixtures/plannerConstrainedOrchestration'
import { runPlannerBeamSearchOracle } from '../../test/fixtures/plannerBeamOracle'
import { createPlannerConstrainedConflictContexts } from './constrained/plannerConflictContext'
import { createPlannerWhatIfComparison } from './constrained/plannerWhatIfCalculation'
import { orchestrationEnumerationBounds } from '../../test/fixtures/plannerConstrainedOrchestration'
import { createPlanConflictId } from './conflictKey'
import { detectPlannerConflicts } from './plannerConflictDetection'
import { runPlannerDeterministicSchedule } from './plannerDeterministicScheduler'
import { preparePlannerInitialContext } from './plannerInitialContext'
import {
  createPlannerRouteUnitPlans,
  fastForwardPlannerRouteProgress,
} from './plannerRouteProgress'
import { replayPlannerSearchTrace } from './plannerTraceReplay'
import { projectProductionPlanExecution } from './productionPlanExecutionProjection'
import type {
  PlannerRunResult,
  PlannerSearchRouteAction,
} from './plannerTypes'

/**
 * Issue #129: the Counter-advance forges of a predicted Normal creation are
 * passed by another Entry's real forge at the same Normal Counter position
 * (silent fast-forward, `docs/PLANNER_SPEC.md` 7.0.2) instead of becoming
 * `same_normal_counter` conflicts. The production-target forge and a blind
 * creation stay required, and a Normal creation is still never a shared
 * physical action.
 */

function predictedForge(
  count: number,
  normalCounterBefore: number,
  weaponTypeId = 'weapon.fixture.a',
): RouteOperation {
  return {
    type: 'create_normal_artian',
    weaponTypeId,
    rarity: 8,
    count,
    normalCounterBefore,
    normalCounterAfter: normalCounterBefore + count,
  }
}

function newNormalRoute(
  count: number,
  normalCounterBefore: number,
  skillCounterBefore: number,
  weaponTypeId = 'weapon.fixture.a',
): BuildRoute {
  return {
    kind: 'normal_artian_to_gogma',
    sourceOwnedWeaponId: null,
    operations: [
      predictedForge(count, normalCounterBefore, weaponTypeId),
      {
        type: 'convert_normal_to_gogma',
        weaponTypeId,
        skillCounterBefore,
        skillCounterAfter: skillCounterBefore + 1,
      },
    ],
  }
}

function blindRoute(skillCounterBefore: number): BuildRoute {
  return {
    kind: 'normal_artian_to_gogma',
    sourceOwnedWeaponId: null,
    operations: [
      {
        type: 'create_normal_artian',
        weaponTypeId: 'weapon.fixture.a',
        rarity: 8,
        count: 1,
        normalCounterBefore: null,
        normalCounterAfter: null,
      },
      {
        type: 'convert_normal_to_gogma',
        weaponTypeId: 'weapon.fixture.a',
        skillCounterBefore,
        skillCounterAfter: skillCounterBefore + 1,
      },
      {
        type: 'reset_bonuses',
        sourceOwnedWeaponId: null,
        gogmaCounterBefore: 10,
        gogmaCounterAfter: 11,
      },
    ],
  }
}

function createFlags(route: BuildRoute): boolean[] {
  const entry = routeEntry('entry.normal-skip-flags', target('target.normal-skip-flags'), route)
  const plans = createPlannerRouteUnitPlans([entry], plannerEngine())
  return (plans.unitPlans.get(entry.id) ?? [])
    .filter(({ operation }) => operation.type === 'create_normal_artian')
    .map(({ canSkipWhenCounterPassed }) => canSkipWhenCounterPassed)
}

describe('Normal creation unit skip derivation', () => {
  it('keeps a single predicted forge required: it is the production-target Normal', () => {
    expect(createFlags(newNormalRoute(1, 4, 7))).toEqual([false])
  })

  it('skips every Counter-advance forge and never the production-target forge', () => {
    expect(createFlags(newNormalRoute(2, 4, 7))).toEqual([true, false])
    expect(createFlags(newNormalRoute(3, 4, 7))).toEqual([true, true, false])
  })

  it('never skips a blind creation', () => {
    expect(createFlags(blindRoute(7))).toEqual([false])
  })

  it('never makes a Normal creation a shareable physical action', () => {
    const entry = routeEntry('entry.normal-share', target('target.normal-share'), newNormalRoute(3, 4, 7))
    const units = createPlannerRouteUnitPlans([entry], plannerEngine()).unitPlans.get(entry.id) ?? []
    expect(units.filter(({ operation }) => operation.type === 'create_normal_artian').map(({ shareable }) => shareable))
      .toEqual([false, false, false])
  })
})

function normalConflictsFor(routes: BuildRoute[], targets?: TargetWeapon[]) {
  const ownTargets = targets ?? routes.map((_route, index) => target(`target.normal-conflict.${index}`, index === 0 ? 5 : 1))
  const entries = routes.map((route, index) => routeEntry(`entry.normal-conflict.${index}`, ownTargets[index], route))
  const { input, dependencies } = fixture(ownTargets, entries)
  const plans = createPlannerRouteUnitPlans(input.buildListEntries, dependencies.rngEngine)
  return detectPlannerConflicts(input.buildListEntries, plans.unitPlans, ownTargets, []).conflicts
}

describe('Normal Counter conflicts', () => {
  it('reports no conflict between two Counter-advance forges at one position', () => {
    // Counter 4 is a Counter-advance forge of both Routes; their production
    // targets sit at 5 and 6 on the Skill positions 7 and 8.
    expect(normalConflictsFor([newNormalRoute(2, 4, 7), newNormalRoute(3, 4, 8)])).toEqual([])
  })

  it('reports no conflict between a production-target forge and a Counter-advance forge', () => {
    // Counter 5 is the first Route's production target and the second Route's
    // Counter-advance forge.
    const conflicts = normalConflictsFor([newNormalRoute(2, 4, 7), newNormalRoute(3, 4, 8)])
    expect(conflicts.filter(({ kind }) => kind === 'same_normal_counter')).toEqual([])
  })

  it('still reports two production-target forges at one position, once', () => {
    const conflicts = normalConflictsFor([newNormalRoute(3, 4, 7), newNormalRoute(3, 4, 8)])
    const normal = conflicts.filter(({ kind }) => kind === 'same_normal_counter')
    expect(normal).toHaveLength(1)
    expect(normal[0].id).toBe(createPlanConflictId({
      kind: 'same_normal_counter',
      normalCounterId: 'weapon.fixture.a:8',
      normalCounter: 6,
      buildListEntryIds: normal[0].buildListEntryIds,
    }))
  })

  it('never joins forges of different Normal Counters', () => {
    const second = { ...target('target.normal-conflict.b', 1), weaponTypeId: 'weapon.fixture.b' }
    const conflicts = normalConflictsFor(
      [newNormalRoute(1, 12, 7), newNormalRoute(1, 12, 8, 'weapon.fixture.b')],
      [target('target.normal-conflict.a', 5), second],
    )
    expect(conflicts.filter(({ kind }) => kind === 'same_normal_counter')).toEqual([])
  })

  it('keeps exclusive owned Normal consumption a conflict', () => {
    const source = normalWeapon('owned.normal-conflict.shared')
    const targets = [target('target.normal-consume.a', 5), target('target.normal-consume.b', 1)]
    const ownedRoute = (skillCounterBefore: number): BuildRoute => ({
      kind: 'owned_normal_artian_to_gogma',
      sourceOwnedWeaponId: source.id,
      operations: [{
        type: 'convert_normal_to_gogma',
        weaponTypeId: 'weapon.fixture.a',
        skillCounterBefore,
        skillCounterAfter: skillCounterBefore + 1,
      }],
    })
    const entries = [
      routeEntry('entry.normal-consume.a', targets[0], ownedRoute(7)),
      routeEntry('entry.normal-consume.b', targets[1], ownedRoute(8)),
    ]
    const { input, dependencies } = fixture(targets, entries, [source])
    const plans = createPlannerRouteUnitPlans(input.buildListEntries, dependencies.rngEngine)
    const conflicts = detectPlannerConflicts(input.buildListEntries, plans.unitPlans, targets, []).conflicts
    expect(conflicts).toContainEqual(expect.objectContaining({ kind: 'same_owned_weapon_consumed' }))
  })
})

/** A Fake Engine that only advances the three Counters, for large Route unit plans. */
function counterOnlyEngine(positions: number): FakeRngEngine {
  const normalCounterAdvances: FakeRngFixtures['normalCounterAdvances'] = []
  const skillCounterAdvances: FakeRngFixtures['skillCounterAdvances'] = []
  for (let counter = 0; counter < positions; counter += 1) {
    normalCounterAdvances.push({ current: counter, operation: { type: 'create_normal_artian', count: 1 }, result: counter + 1 })
    skillCounterAdvances.push({ current: counter, operation: { type: 'convert_normal_to_gogma' }, result: counter + 1 })
  }
  return new FakeRngEngine({
    version: 'issue-129-counter-only',
    capabilities: {
      supportsNormalArtianPrediction: true,
      supportsGogmaPrediction: true,
      supportsSkillPrediction: true,
      supportsKeepBonusesPrediction: true,
    },
    normalizedSeeds: [],
    resetBonusPredictions: [],
    skillPredictions: [],
    normalArtianPredictions: [],
    keepBonusPredictions: [],
    gogmaCounterAdvances: [],
    skillCounterAdvances,
    normalCounterAdvances,
  })
}

describe('Issue #129 reproduction: two 207-forge Routes on one Normal Counter', () => {
  function conflictsOf(countA: number, countB: number) {
    const targets = [target('target.issue-129.a', 5), target('target.issue-129.b', 1)]
    const entries = [
      routeEntry('entry.issue-129.a', targets[0], newNormalRoute(countA, 0, 7)),
      routeEntry('entry.issue-129.b', targets[1], newNormalRoute(countB, 0, 8)),
    ]
    const plans = createPlannerRouteUnitPlans(entries, counterOnlyEngine(400))
    expect(plans.rejections).toEqual([])
    return detectPlannerConflicts(entries, plans.unitPlans, targets, []).conflicts
  }

  it('reports only the production-target position as a Normal Counter conflict', () => {
    const normal = conflictsOf(207, 207).filter(({ kind }) => kind === 'same_normal_counter')
    expect(normal).toHaveLength(1)
    expect(normal[0].id).toBe(createPlanConflictId({
      kind: 'same_normal_counter',
      normalCounterId: 'weapon.fixture.a:8',
      normalCounter: 206,
      buildListEntryIds: normal[0].buildListEntryIds,
    }))
  })

  it('reports no Normal Counter conflict when the production targets differ', () => {
    expect(conflictsOf(207, 300).filter(({ kind }) => kind === 'same_normal_counter')).toEqual([])
  })
})

function routeActions(result: Pick<PlannerRunResult, 'bestState'>): PlannerSearchRouteAction[] {
  return (result.bestState?.trace ?? []).filter(
    (action): action is PlannerSearchRouteAction => action.kind === 'route_operation',
  )
}

function forgeActions(result: Pick<PlannerRunResult, 'bestState'>): PlannerSearchRouteAction[] {
  return routeActions(result).filter(({ actionType }) => actionType === 'create_normal_artian')
}

function expectReplayValid(scenario: OrchestrationScenario, result: Pick<PlannerRunResult, 'bestState'>) {
  const replay = replayPlannerSearchTrace(scenario.input, result.bestState!, scenario.engine)
  expect(replay.issues).toEqual([])
  expect(replay.isValid).toBe(true)
  return replay
}

/**
 * Two new-Normal Routes of one weapon type from the same Normal Counter `N0`.
 * `countA` / `countB` forges; A converts at S0 and resets at G0, B at S0 + 1 and
 * G0 + 1 (swapped with `bFirst`), so each Route finishes on its own positions.
 */
function twoForgeRoutes(countA: number, countB: number, options: { bFirst?: boolean } = {}) {
  const [slotA, slotB] = options.bFirst === true ? [1, 0] : [0, 1]
  const builder = new SchedulerScenarioBuilder().withNormalCounter()
  builder.skillAt.set(S0, IDEAL_SKILL)
  builder.skillAt.set(S0 + 1, IDEAL_SKILL)
  builder.resetAt.set(G0 + slotA, schedulerIdeal(20))
  builder.resetAt.set(G0 + slotB, schedulerIdeal(21))
  const targetA = builder.target('target.forge.a', 20, { priority: 5 })
  const targetB = builder.target('target.forge.b', 21, { priority: 1 })
  const entryA = builder.conversionEntry(
    'entry.forge.a',
    targetA,
    { kind: 'predicted', count: countA, convertAt: S0 + slotA },
    { bonus: { from: G0 + slotA, resets: 1 } },
  )
  const entryB = builder.conversionEntry(
    'entry.forge.b',
    targetB,
    { kind: 'predicted', count: countB, convertAt: S0 + slotB },
    { bonus: { from: G0 + slotB, resets: 1 } },
  )
  return { builder, scenario: builder.build(), entryA, entryB, targetA, targetB }
}

describe('Deterministic scheduler over shared Normal Counter prefixes', () => {
  it('runs both Routes when their production targets differ, fast-forwarding the passed forges', async () => {
    const { scenario, entryA, entryB } = twoForgeRoutes(2, 3)
    const result = await runPlannerDeterministicSchedule(scenario.input, scenario.dependencies)

    expect(result.termination.status).toBe('completed')
    expect(result.conflicts).toEqual([])
    expect(result.rejections).toEqual([])
    expect([...result.bestState!.selectedBuildListEntryIds].sort()).toEqual([entryA.id, entryB.id].sort())
    // Three forges for three Normal Counter positions: N0 once for both
    // Routes, A's production target at N0 + 1, B's at N0 + 2.
    const forges = forgeActions(result)
    expect(forges.map(({ rngBefore }) => rngBefore.normalCounters[0].counter)).toEqual([N0, N0 + 1, N0 + 2])
    forges.forEach((action) => expect(action.progressedBuildListEntryIds).toHaveLength(1))
    // The required production-target forge of A runs before B passes N0 + 1.
    expect(forges[1].primaryBuildListEntryId).toBe(entryA.id)
    expect(forges[1].progressedRoutePositions[entryA.id]).toEqual({ operationIndex: 0, unitIndex: 1, unitCount: 2 })
    expect(forges[2].primaryBuildListEntryId).toBe(entryB.id)
    expect(forges[2].progressedRoutePositions[entryB.id]).toEqual({ operationIndex: 0, unitIndex: 2, unitCount: 3 })
    expect(result.bestState!.currentNormalCounters.find(({ id }) => id === NORMAL_COUNTER_ID)?.counter).toBe(N0 + 3)
    expectReplayValid(scenario, result)
  })

  it('keeps one Normal Counter conflict at the shared production-target position', async () => {
    const { scenario, entryA, entryB } = twoForgeRoutes(3, 3)
    const result = await runPlannerDeterministicSchedule(scenario.input, scenario.dependencies)

    const normal = result.conflicts.filter(({ kind }) => kind === 'same_normal_counter')
    expect(normal).toHaveLength(1)
    expect(normal[0].id).toBe(createPlanConflictId({
      kind: 'same_normal_counter',
      normalCounterId: NORMAL_COUNTER_ID,
      normalCounter: N0 + 2,
      buildListEntryIds: normal[0].buildListEntryIds,
    }))
    expect([...normal[0].buildListEntryIds].sort()).toEqual([entryA.id, entryB.id].sort())
    // The unresolved conflict keeps its provisional outcome: one Route runs.
    expect(normal[0].selectedBuildListEntryId).toBeNull()
    expect(result.bestState!.selectedBuildListEntryIds).toEqual([entryA.id])
    expect(result.termination.status).toBe('exhausted')
    expect(forgeActions(result).every(({ primaryBuildListEntryId }) => primaryBuildListEntryId === entryA.id)).toBe(true)
    expectReplayValid(scenario, result)
  })

  it('lets an explicit resolution of the production-target conflict select the other Route', async () => {
    // B holds the first Skill and Gogma positions here, so it can run on its own.
    const { builder, entryB } = twoForgeRoutes(3, 3, { bFirst: true })
    const first = builder.build()
    const baseline = await runPlannerDeterministicSchedule(first.input, first.dependencies)
    const conflict = baseline.conflicts.find(({ kind }) => kind === 'same_normal_counter')!
    builder.conflictResolutions = [{ conflictKey: conflict.id, selectedBuildListEntryId: entryB.id }]
    const scenario = builder.build()
    const result = await runPlannerDeterministicSchedule(scenario.input, scenario.dependencies)

    expect(result.bestState!.selectedBuildListEntryIds).toEqual([entryB.id])
    expect(result.conflicts.find(({ id }) => id === conflict.id)?.selectedBuildListEntryId).toBe(entryB.id)
    expectReplayValid(scenario, result)
  })
})

describe('Trace Replay and the execution projection of a fast-forwarded Normal prefix', () => {
  it('never adds a fast-forwarded Entry to a forge and still refuses a shared Normal creation', async () => {
    const { scenario, entryA, entryB } = twoForgeRoutes(2, 3)
    const result = await runPlannerDeterministicSchedule(scenario.input, scenario.dependencies)
    const first = forgeActions(result)[0]
    const passed = first.primaryBuildListEntryId === entryA.id ? entryB.id : entryA.id
    expect(first.progressedBuildListEntryIds).toEqual([first.primaryBuildListEntryId])
    expect(first.progressedBuildListEntryIds).not.toContain(passed)

    // Claiming the forge for both Entries is still an invalid sharing.
    const forged = structuredClone(result.bestState!)
    const index = forged.trace.findIndex((action) => action.actionType === 'create_normal_artian')
    const action = forged.trace[index] as PlannerSearchRouteAction
    action.progressedBuildListEntryIds = [entryA.id, entryB.id].sort()
    action.progressedRoutePositions[passed] = { operationIndex: 0, unitIndex: 0, unitCount: passed === entryA.id ? 2 : 3 }
    const replay = replayPlannerSearchTrace(scenario.input, forged, scenario.engine)
    expect(replay.isValid).toBe(false)
    expect(replay.issues).toContainEqual(expect.objectContaining({ code: 'invalid_physical_action_sharing' }))
  })

  it('projects one Entry per Normal creation with its Route role, registering only production targets', async () => {
    const { scenario, entryA, entryB, targetA, targetB } = twoForgeRoutes(2, 3)
    const result = await runPlannerDeterministicSchedule(scenario.input, scenario.dependencies)
    const replay = expectReplayValid(scenario, result)
    const projection = projectProductionPlanExecution({
      input: scenario.input,
      drafts: replay.drafts,
      selectedBuildListEntryIds: result.bestState!.selectedBuildListEntryIds,
      searchFinalOwnedWeapons: result.bestState!.simulatedInventory.ownedWeapons,
      dependencies: scenario.dependencies,
      productionPlanId: 'plan.issue-129' as never,
      now: '2026-09-25T00:00:00.000Z',
    })
    const creations = projection.steps.filter(({ operationType }) => operationType === 'create_normal_artian')
    expect(creations).toHaveLength(3)
    creations.forEach((step) => expect(step.progressedTargetWeaponIds).toHaveLength(1))
    expect(creations.map(({ executionEffects }) => executionEffects?.normalCreationRole)).toEqual([
      'counter_advance',
      'production_target',
      'production_target',
    ])
    expect(creations[1].progressedTargetWeaponIds).toEqual([targetA.id])
    expect(creations[2].progressedTargetWeaponIds).toEqual([targetB.id])
    // Only the two production-target Normals are registered and linked.
    expect(creations[0].executionEffects?.registersTrackedWeapon).toBe(false)
    expect(creations[0].executionEffects?.trackedOwnedWeaponId).toBeNull()
    const registered = creations.slice(1).map(({ executionEffects }) => executionEffects!)
    registered.forEach((effects) => {
      expect(effects.registersTrackedWeapon).toBe(true)
      expect(effects.trackedOwnedWeaponId).not.toBeNull()
    })
    expect(registered.map(({ targetLinks }) => targetLinks.map(({ targetWeaponId }) => targetWeaponId)))
      .toEqual([[targetA.id], [targetB.id]])
    // Both Targets complete on their own Reset.
    const completions = projection.steps.flatMap(({ executionEffects }) =>
      (executionEffects?.targetCompletions ?? []).map(({ targetWeaponId }) => targetWeaponId),
    )
    expect(completions.sort()).toEqual([targetA.id, targetB.id].sort())
    expect(entryA.id).not.toBe(entryB.id)
  })
})

describe('Beam Search oracle over shared Normal Counter prefixes', () => {
  it('completes both Routes with no Normal Counter conflict', async () => {
    const { scenario, entryA, entryB } = twoForgeRoutes(2, 3)
    const result = await runPlannerBeamSearchOracle(scenario.input, scenario.dependencies)
    expect(result.completed).toBe(true)
    expect(result.conflicts).toEqual([])
    expect([...result.bestState!.selectedBuildListEntryIds].sort()).toEqual([entryA.id, entryB.id].sort())
    forgeActions(result).forEach((action) => expect(action.progressedBuildListEntryIds).toHaveLength(1))
    expect(forgeActions(result)).toHaveLength(3)
    expectReplayValid(scenario, result)
  })
})

describe('Constrained re-search and what-if over Normal Counter conflicts', () => {
  it('gives the constrained conflict context no Counter-advance Normal conflict', () => {
    const { scenario } = twoForgeRoutes(2, 3)
    const prepared = preparePlannerInitialContext(scenario.input, scenario.dependencies)
    if (prepared.status !== 'ready') throw new Error('The fixture context is not ready.')
    expect(createPlannerConstrainedConflictContexts(prepared.context)).toEqual([])
  })

  it('still builds a context for the production-target Normal conflict', () => {
    const { scenario, entryA, entryB } = twoForgeRoutes(3, 3)
    const prepared = preparePlannerInitialContext(scenario.input, scenario.dependencies)
    if (prepared.status !== 'ready') throw new Error('The fixture context is not ready.')
    const contexts = createPlannerConstrainedConflictContexts(prepared.context)
    expect(contexts).toHaveLength(1)
    expect(contexts[0].resourceIdentity).toEqual({
      kind: 'same_normal_counter',
      counterStream: 'normal',
      normalCounterId: NORMAL_COUNTER_ID,
      counterBefore: N0 + 2,
    })
    // Only the production-target forge of each Route takes part.
    expect(contexts[0].participants.map(({ buildListEntryId }) => buildListEntryId).sort())
      .toEqual([entryA.id, entryB.id].sort())
  })

  it('answers a what-if for the production-target Normal conflict', async () => {
    const { builder, entryA, targetB } = twoForgeRoutes(3, 3)
    const first = builder.build()
    const baseline = await runPlannerDeterministicSchedule(first.input, first.dependencies)
    const conflict = baseline.conflicts.find(({ kind }) => kind === 'same_normal_counter')!
    const result = await createPlannerWhatIfComparison(
      {
        plannerInput: first.input,
        scenarioResolution: { conflictKey: conflict.id, selectedBuildListEntryId: entryA.id },
        bounds: { maxCandidateTrialsPerTarget: 2, maxPlannerReruns: 8 },
      },
      first.dependencies,
      { enumerationBounds: orchestrationEnumerationBounds() },
    )
    expect(result.status).toBe('completed')
    if (result.status !== 'completed') return
    expect(result.comparison.fixedBuildListEntryId).toBe(entryA.id)
    expect(result.comparison.alternatives.map(({ targetWeaponId }) => targetWeaponId)).toEqual([targetB.id])
  })
})

describe('Silent fast-forward of the base lane', () => {
  it('passes Counter-advance forges and stops at the production-target forge', () => {
    const { scenario, entryB } = twoForgeRoutes(2, 3)
    const prepared = preparePlannerInitialContext(scenario.input, scenario.dependencies)
    if (prepared.status !== 'ready') throw new Error('The fixture context is not ready.')
    const state = structuredClone(prepared.context.initialState)
    const counter = state.currentNormalCounters.find(({ id }) => id === NORMAL_COUNTER_ID)!
    counter.counter = N0 + 2
    fastForwardPlannerRouteProgress(state, prepared.context.allLanePlans)
    expect(state.routeProgressByEntryId[entryB.id]).toEqual({ base: 2, bonus: 0, skill: 0 })
    counter.counter = N0 + 3
    fastForwardPlannerRouteProgress(state, prepared.context.allLanePlans)
    // Counter N0 + 2 holds B's production-target forge, so progress stops.
    expect(state.routeProgressByEntryId[entryB.id]).toEqual({ base: 2, bonus: 0, skill: 0 })
  })
})
