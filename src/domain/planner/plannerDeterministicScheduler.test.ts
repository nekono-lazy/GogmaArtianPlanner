import { describe, expect, it } from 'vitest'
import type { BuildListEntryId } from '../models/publicTypes'
import type { BuildListEntryReplacement } from '../buildList/buildListEntryReplacement'
import {
  G0,
  IDEAL_SKILL,
  N0,
  NORMAL_COUNTER_ID,
  S0,
  SchedulerScenarioBuilder,
  schedulerIdeal,
} from '../../test/fixtures/plannerScheduler'
import {
  synchronizeOrchestrationEntry,
  type OrchestrationScenario,
} from '../../test/fixtures/plannerConstrainedOrchestration'
import { createPlannerSearchInstrumentationInput } from '../../benchmarks/plannerSearchInstrumentationFixtures'
import { createDeterministicPlannerDependencies } from '../../benchmarks/plannerSearchInstrumentationBenchmark'
import {
  createPlannerDeterministicScheduleRun,
  runPlannerDeterministicSchedule,
  type PlannerDeterministicScheduleRun,
} from './plannerDeterministicScheduler'
import { createPlannerRouteCommitment } from './plannerRouteCommitment'
import { mergedPlannerProgressedEntries } from './plannerStateTransitions'
import { replayPlannerSearchTrace } from './plannerTraceReplay'
import { projectProductionPlanExecution } from './productionPlanExecutionProjection'
import {
  createProductionPlanWithObserver,
  createRejectedBuildListEntries,
} from './productionPlanGeneration'
import type {
  PlannerBeamSearchResult,
  PlannerSearchAction,
  PlannerSearchRouteAction,
} from './plannerTypes'

/**
 * Issue #103 Phase A: the deterministic scheduler's acceptance scenarios
 * (`docs/ISSUE_103_DETERMINISTIC_PLANNER_DESIGN.md` 16.1 A - M and 16.3).
 * Every scheduled trace is verified by the unchanged Trace Replay.
 */

async function schedule(scenario: OrchestrationScenario): Promise<PlannerBeamSearchResult> {
  return runPlannerDeterministicSchedule(scenario.input, scenario.dependencies)
}

function expectReplayValid(scenario: OrchestrationScenario, result: PlannerBeamSearchResult) {
  expect(result.bestState).not.toBeNull()
  const replay = replayPlannerSearchTrace(scenario.input, result.bestState!, scenario.engine)
  expect(replay.issues).toEqual([])
  expect(replay.unsupportedInput).toBeNull()
  expect(replay.isValid).toBe(true)
  return replay
}

function routeActions(result: PlannerBeamSearchResult): PlannerSearchRouteAction[] {
  return (result.bestState?.trace ?? []).filter(
    (action): action is PlannerSearchRouteAction => action.kind === 'route_operation',
  )
}

function gogmaCounterBefore(action: PlannerSearchAction): number | null {
  const operation = action.routeOperation
  return operation?.type === 'reset_bonuses' || operation?.type === 'keep_bonuses'
    ? operation.gogmaCounterBefore
    : null
}

function progressedIn(result: PlannerBeamSearchResult, entryId: BuildListEntryId): boolean {
  return routeActions(result).some((action) => action.progressedBuildListEntryIds.includes(entryId))
}

function reserveIndexOf(result: PlannerBeamSearchResult, entryId: BuildListEntryId): number {
  return (result.bestState?.trace ?? []).findIndex(
    (action) => action.kind === 'reserve_candidate' && action.primaryBuildListEntryId === entryId,
  )
}

function lastRouteIndexOf(result: PlannerBeamSearchResult, entryId: BuildListEntryId): number {
  const trace = result.bestState?.trace ?? []
  for (let index = trace.length - 1; index >= 0; index -= 1) {
    const action = trace[index]
    if (action.kind === 'route_operation' && action.progressedBuildListEntryIds.includes(entryId)) {
      return index
    }
  }
  return -1
}

function readyRun(scenario: OrchestrationScenario): PlannerDeterministicScheduleRun {
  const created = createPlannerDeterministicScheduleRun(scenario.input, scenario.dependencies)
  if (created.status !== 'ready') {
    throw new Error(`Scenario did not reach the scheduler: ${JSON.stringify(created.result.warnings)}`)
  }
  return created.run
}

function runToEnd(run: PlannerDeterministicScheduleRun): PlannerBeamSearchResult {
  for (let guard = 0; guard < 10_000; guard += 1) {
    const outcome = run.step()
    if (outcome === 'finished' || outcome === 'bounded') return run.finish(false)
  }
  throw new Error('The schedule did not finish.')
}

/** Scenario A: a Gogma-lane Target and a Skill-lane Target, no conflict. */
function scenarioA() {
  const builder = new SchedulerScenarioBuilder()
  builder.resetAt.set(G0 + 50, schedulerIdeal(0))
  builder.skillAt.set(S0 + 100, IDEAL_SKILL)
  const targetA = builder.target('target.a', 0)
  const targetB = builder.target('target.b', 1)
  const weaponA = builder.gogma('owned.a')
  const weaponB = builder.gogma('owned.b', {
    restorationBonuses: schedulerIdeal(1),
    seriesSkillId: 'series_skill.fixture.z',
  })
  const entryA = builder.existingEntry('entry.a', targetA, weaponA, {
    bonus: { from: G0, resets: 51 },
  })
  const entryB = builder.existingEntry('entry.b', targetB, weaponB, {
    skill: { from: S0, resets: 101 },
  })
  return { builder, entryA, entryB }
}

describe('Scenario A: independent Gogma and Skill lanes', () => {
  it('completes both Targets with one state, in canonical run order', async () => {
    const { builder, entryA, entryB } = scenarioA()
    const scenario = builder.build()
    const result = await schedule(scenario)
    expect(result.termination.status).toBe('completed')
    expect(result.completed).toBe(true)
    expect(result.conflicts).toEqual([])
    expect(result.rejections).toEqual([])
    const trace = result.bestState!.trace
    // One constructed state per applied action: 51 + 101 physical, 2 reserves.
    expect(trace).toHaveLength(154)
    expect(result.expandedStates).toBe(trace.length)
    // Key 4 (the executor whose next holding position is nearer) starts the
    // Gogma run; key 3 (no weapon switch) then keeps each run together.
    expect(trace.slice(0, 51).every(({ primaryBuildListEntryId }) => primaryBuildListEntryId === entryA.id))
      .toBe(true)
    expect(trace[51]).toMatchObject({ kind: 'reserve_candidate', primaryBuildListEntryId: entryA.id })
    expect(trace.slice(52, 153).every(({ primaryBuildListEntryId }) => primaryBuildListEntryId === entryB.id))
      .toBe(true)
    expect(trace[153]).toMatchObject({ kind: 'reserve_candidate', primaryBuildListEntryId: entryB.id })
    expect(result.bestState!.weaponSwitchCount).toBe(1)
    expectReplayValid(scenario, result)
  })

  it('evaluates several safe actions but applies exactly one state change per step', () => {
    const { builder, entryA, entryB } = scenarioA()
    const run = readyRun(builder.build())
    const actions = run.safeActions()
    expect(actions.map(({ primary }) => primary.entryId).sort()).toEqual([entryA.id, entryB.id])
    // Evaluating the candidates built no state.
    expect(run.state.trace).toHaveLength(0)
    expect(run.expandedStates).toBe(0)
    const stateBefore = run.state
    expect(run.step()).toBe('applied')
    expect(run.state).toBe(stateBefore)
    expect(run.state.trace).toHaveLength(1)
    expect(run.expandedStates).toBe(1)
    expect(run.state.trace[0].primaryBuildListEntryId).toBe(actions[0].primary.entryId)
  })
})

/** Scenario B: three Bonus Routes on one Gogma stream, finals C+50 / C+80 / C+120. */
function scenarioB() {
  const builder = new SchedulerScenarioBuilder()
  const finals = [50, 80, 120]
  finals.forEach((offset, index) => builder.resetAt.set(G0 + offset, schedulerIdeal(index)))
  const entries = finals.map((offset, index) => {
    const key = String.fromCharCode(97 + index)
    return builder.existingEntry(
      `entry.${key}`,
      builder.target(`target.${key}`, index),
      builder.gogma(`owned.${key}`),
      { bonus: { from: G0, resets: offset + 1 } },
    )
  })
  return { builder, entries }
}

describe('Scenario B: one Gogma stream with three required positions', () => {
  it('consumes every Gogma position once and reserves each Entry right after its final unit', async () => {
    const { builder, entries } = scenarioB()
    const scenario = builder.build()
    const result = await schedule(scenario)
    expect(result.termination.status).toBe('completed')
    const physical = routeActions(result)
    expect(physical).toHaveLength(121)
    expect(physical.map(gogmaCounterBefore)).toEqual(
      Array.from({ length: 121 }, (_unused, index) => G0 + index),
    )
    entries.forEach((entry) => {
      expect(reserveIndexOf(result, entry.id)).toBe(lastRouteIndexOf(result, entry.id) + 1)
    })
    const executorAt = (counter: number) =>
      physical.find((action) => gogmaCounterBefore(action) === counter)!.primaryBuildListEntryId
    expect(executorAt(G0 + 50)).toBe(entries[0].id)
    expect(executorAt(G0 + 80)).toBe(entries[1].id)
    expect(executorAt(G0 + 120)).toBe(entries[2].id)
    expect(result.rejections).toEqual([])
    expectReplayValid(scenario, result)
  })
})

describe('Scenario C: a required and a skippable unit at one position', () => {
  function scenarioC() {
    const builder = new SchedulerScenarioBuilder()
    builder.resetAt.set(G0 + 50, schedulerIdeal(0))
    builder.resetAt.set(G0 + 51, schedulerIdeal(1))
    const entryA = builder.existingEntry('entry.a', builder.target('target.a', 0), builder.gogma('owned.a'), {
      bonus: { from: G0, resets: 51 },
    })
    const entryB = builder.existingEntry('entry.b', builder.target('target.b', 1), builder.gogma('owned.b'), {
      bonus: { from: G0, resets: 52 },
    })
    return { scenario: builder.build(), entryA, entryB }
  }

  it('offers only the required unit, fast-forwards the skippable one and records nothing', async () => {
    const { scenario, entryA, entryB } = scenarioC()
    const run = readyRun(scenario)
    while (run.state.currentRngState.gogmaCounter.value! < G0 + 50) {
      expect(run.step()).toBe('applied')
    }
    const actions = run.safeActions()
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({ kind: 'holding', primary: { entryId: entryA.id } })
    expect(actions[0].progressedUnits.map(({ entryId }) => entryId)).toEqual([entryA.id])
    const result = runToEnd(run)
    expect(result.termination.status).toBe('completed')
    expect(result.rejections).toEqual([])
    // B ran only its own final unit; every earlier unit was passed silently.
    expect(routeActions(result).filter((action) => action.progressedBuildListEntryIds.includes(entryB.id)))
      .toHaveLength(1)
    expectReplayValid(scenario, result)
  })
})

/** Scenario D: A Keeps at C+50, B Resets at C+50, on different weapons. */
function scenarioD(
  priorities: { a: 1 | 2 | 3 | 4 | 5; b: 1 | 2 | 3 | 4 | 5 },
  finalOffset = 50,
) {
  const builder = new SchedulerScenarioBuilder()
  builder.keepAt.set(G0 + finalOffset, schedulerIdeal(0))
  builder.resetAt.set(G0 + finalOffset, schedulerIdeal(1))
  const entryA = builder.existingEntry(
    'entry.a',
    builder.target('target.a', 0, { priority: priorities.a }),
    builder.gogma('owned.a'),
    { bonus: { from: G0, resets: finalOffset, keeps: 1 } },
  )
  const entryB = builder.existingEntry(
    'entry.b',
    builder.target('target.b', 1, { priority: priorities.b }),
    builder.gogma('owned.b'),
    { bonus: { from: G0, resets: finalOffset + 1 } },
  )
  return { builder, entryA, entryB }
}

describe('Scenario D: an unresolved Counter conflict', () => {
  it('commits only the provisional winner by R and returns the conflict unresolved', async () => {
    const { builder, entryA, entryB } = scenarioD({ a: 2, b: 4 })
    const scenario = builder.build()
    const result = await schedule(scenario)
    expect(result.conflicts).toHaveLength(1)
    const [conflict] = result.conflicts
    expect(conflict.kind).toBe('same_gogma_counter')
    expect(conflict.buildListEntryIds).toEqual([entryA.id, entryB.id])
    expect(conflict.selectedBuildListEntryId).toBeNull()
    // The provisional winner and the recommendation share one comparator.
    expect(conflict.recommendedBuildListEntryId).toBe(entryB.id)
    expect(result.bestState!.selectedBuildListEntryIds).toEqual([entryB.id])
    expect(result.completed).toBe(false)
    expect(result.termination.status).toBe('exhausted')
    expect(result.termination.completedTargetCount).toBe(1)
    expect(result.rejections).toEqual([
      expect.objectContaining({ buildListEntryId: entryA.id, reason: 'conflict_not_committed' }),
    ])
    expect(progressedIn(result, entryA.id)).toBe(false)
    expectReplayValid(scenario, result)
  })

  it('reports the provisional loser as resource_conflict in the rejected Build List record', async () => {
    const { builder, entryA } = scenarioD({ a: 2, b: 4 })
    const scenario = builder.build()
    const result = await schedule(scenario)
    const rejected = createRejectedBuildListEntries(
      scenario.input,
      result,
      result.bestState!.selectedBuildListEntryIds,
    )
    expect(rejected).toEqual([
      expect.objectContaining({ buildListEntryId: entryA.id, reason: 'resource_conflict' }),
    ])
  })
})

describe('Scenario E: one shareable physical action', () => {
  it('progresses both Entries with one action and Trace Replay accepts the sharing', async () => {
    const builder = new SchedulerScenarioBuilder()
    builder.resetAt.set(G0, schedulerIdeal(5))
    const shared = builder.gogma('owned.shared')
    const entryA = builder.existingEntry('entry.a', builder.target('target.a', 5), shared, {
      bonus: { from: G0, resets: 1 },
    })
    const entryB = builder.existingEntry('entry.b', builder.target('target.b', 5), shared, {
      bonus: { from: G0, resets: 1 },
    })
    const scenario = builder.build()
    const result = await schedule(scenario)
    expect(result.conflicts).toEqual([])
    const physical = routeActions(result)
    expect(physical).toHaveLength(1)
    expect(physical[0].progressedBuildListEntryIds).toEqual([entryA.id, entryB.id])
    expect(result.termination.status).toBe('completed')
    expectReplayValid(scenario, result)
  })
})

describe('Scenario F: Entry-local transient Gogma weapons', () => {
  function transientScenario(finalB: number) {
    const builder = new SchedulerScenarioBuilder()
    builder.skillAt.set(S0, IDEAL_SKILL)
    builder.skillAt.set(S0 + 1, { seriesSkillId: 'series_skill.fixture.b', groupSkillId: null })
    builder.resetAt.set(G0 + 10, schedulerIdeal(6))
    if (finalB !== G0 + 10) builder.resetAt.set(finalB, schedulerIdeal(7))
    const targetA = builder.target('target.a', 6)
    const targetB = builder.target('target.b', finalB === G0 + 10 ? 6 : 7, {
      idealSeriesSkillId: 'series_skill.fixture.b',
    })
    const entryA = builder.conversionEntry(
      'entry.a',
      targetA,
      { kind: 'owned', source: builder.normal('owned.normal.a'), convertAt: S0 },
      { bonus: { from: G0, resets: 11 } },
    )
    const entryB = builder.conversionEntry(
      'entry.b',
      targetB,
      { kind: 'owned', source: builder.normal('owned.normal.b'), convertAt: S0 + 1 },
      { bonus: { from: G0, resets: finalB - G0 + 1 } },
    )
    return { scenario: builder.build(), entryA, entryB }
  }

  it('never shares a transient action: required units at one position collide', async () => {
    const { scenario, entryA, entryB } = transientScenario(G0 + 10)
    const result = await schedule(scenario)
    const gogmaConflict = result.conflicts.find(({ kind }) => kind === 'same_gogma_counter')
    expect(gogmaConflict?.buildListEntryIds).toEqual([entryA.id, entryB.id])
    expect(result.bestState!.selectedBuildListEntryIds).toHaveLength(1)
    routeActions(result).forEach((action) => expect(action.progressedBuildListEntryIds).toHaveLength(1))
    expectReplayValid(scenario, result)
  })

  it('lets one executor consume skippable positions and fast-forwards the other', async () => {
    const { scenario, entryA, entryB } = transientScenario(G0 + 15)
    const result = await schedule(scenario)
    expect(result.termination.status).toBe('completed')
    expect(result.conflicts).toEqual([])
    routeActions(result).forEach((action) => expect(action.progressedBuildListEntryIds).toHaveLength(1))
    const executorAt = (counter: number) =>
      routeActions(result).find((action) => gogmaCounterBefore(action) === counter)!.primaryBuildListEntryId
    expect(executorAt(G0)).toBe(entryA.id)
    expect(executorAt(G0 + 15)).toBe(entryB.id)
    expectReplayValid(scenario, result)
  })
})

describe('Scenario G: the improvement preference inside one Entry', () => {
  function oneEntry(preference: 'planner' | 'skill_first' | 'bonus_first') {
    const builder = new SchedulerScenarioBuilder()
    builder.resetAt.set(G0 + 4, schedulerIdeal(8))
    builder.skillAt.set(S0 + 4, IDEAL_SKILL)
    builder.existingEntry(
      'entry.g',
      builder.target('target.g', 8),
      builder.gogma('owned.g', { seriesSkillId: 'series_skill.fixture.z' }),
      {
        bonus: { from: G0, resets: 5 },
        skill: { from: S0, resets: 5 },
        improvementPreference: preference,
      },
    )
    return builder.build()
  }

  const firstLane = (result: PlannerBeamSearchResult) =>
    result.bestState!.trace[0].routeOperation?.type === 'reset_skills' ? 'skill' : 'bonus'

  it('bonus_first runs the Bonus lane first and skill_first the Skill lane', async () => {
    for (const [preference, lane] of [['bonus_first', 'bonus'], ['skill_first', 'skill']] as const) {
      const scenario = oneEntry(preference)
      const result = await schedule(scenario)
      expect(result.termination.status).toBe('completed')
      expect(firstLane(result)).toBe(lane)
      expect(result.bestState!.improvementPreferenceViolationCount).toBe(0)
      expectReplayValid(scenario, result)
    }
  })

  it('leaves planner to the later keys: the stable stream order puts Skill first', async () => {
    const scenario = oneEntry('planner')
    const result = await schedule(scenario)
    expect(result.termination.status).toBe('completed')
    expect(firstLane(result)).toBe('skill')
    expectReplayValid(scenario, result)
  })

  it('runs the other lane, counting a violation, while the preferred lane waits', async () => {
    const builder = new SchedulerScenarioBuilder()
    builder.skillAt.set(S0, { seriesSkillId: 'series_skill.fixture.y', groupSkillId: null })
    builder.skillAt.set(S0 + 3, IDEAL_SKILL)
    builder.resetAt.set(G0, schedulerIdeal(10))
    builder.resetAt.set(G0 + 2, schedulerIdeal(9))
    // Y holds Gogma C with a required Reset that waits for Y's conversion, so
    // G's preferred Bonus lane cannot move; G's priority is the higher one.
    const entryY = builder.conversionEntry(
      'entry.y',
      builder.target('target.y', 10, { priority: 1, idealSeriesSkillId: 'series_skill.fixture.y' }),
      { kind: 'owned', source: builder.normal('owned.normal.y'), convertAt: S0 },
      { bonus: { from: G0, resets: 1 } },
    )
    const entryG = builder.existingEntry(
      'entry.g',
      builder.target('target.g', 9, { priority: 5 }),
      builder.gogma('owned.g', { seriesSkillId: 'series_skill.fixture.z' }),
      {
        bonus: { from: G0, resets: 3 },
        skill: { from: S0 + 1, resets: 3 },
        improvementPreference: 'bonus_first',
      },
    )
    const scenario = builder.build()
    const result = await schedule(scenario)
    expect(result.termination.status).toBe('completed')
    const trace = result.bestState!.trace
    expect(trace[0]).toMatchObject({ primaryBuildListEntryId: entryY.id, actionType: 'convert_normal_to_gogma' })
    expect(trace[1]).toMatchObject({ primaryBuildListEntryId: entryG.id, actionType: 'reset_skills' })
    expect(result.bestState!.improvementPreferenceViolationCount).toBeGreaterThan(0)
    expectReplayValid(scenario, result)
  })
})

describe('Scenario H: a selected compromise checkpoint', () => {
  it('holds the pin endpoint, places the milestone on it, and never completes by hasIdeal alone', async () => {
    const builder = new SchedulerScenarioBuilder()
    // P's first Reset reaches a compromise the user selected; Q's weapon is an
    // Ideal of P's Target too, but P is that Target's required Entry.
    builder.resetAt.set(G0, practicalCompromise(11))
    builder.resetAt.set(G0 + 2, schedulerIdeal(11))
    builder.resetAt.set(G0 + 4, schedulerIdeal(11))
    const targetP = builder.target('target.p', 11)
    const entryP = builder.existingEntry('entry.p', targetP, builder.gogma('owned.p'), {
      bonus: { from: G0, resets: 5 },
      select: { axis: 'bonus', lanePosition: 1 },
    })
    const entryQ = builder.existingEntry('entry.q', builder.target('target.q', 11), builder.gogma('owned.q'), {
      bonus: { from: G0, resets: 3 },
    })
    const scenario = builder.build()
    const result = await schedule(scenario)
    expect(result.termination.status).toBe('completed')
    const trace = result.bestState!.trace
    expect(trace[0]).toMatchObject({ primaryBuildListEntryId: entryP.id, progressedBuildListEntryIds: [entryP.id] })
    // Q completed first and made P's Target Ideal, yet P was still reserved.
    expect(reserveIndexOf(result, entryQ.id)).toBeLessThan(reserveIndexOf(result, entryP.id))
    expect(result.bestState!.selectedBuildListEntryIds).toEqual([entryP.id, entryQ.id])
    const replay = expectReplayValid(scenario, result)
    const milestoneDrafts = replay.drafts.filter(({ checkpointMilestones }) => checkpointMilestones.length > 0)
    expect(milestoneDrafts).toHaveLength(1)
    expect(milestoneDrafts[0].routeOperation).toMatchObject({ gogmaCounterBefore: G0 })
    expect(milestoneDrafts[0].checkpointMilestones[0].buildListEntryId).toBe(entryP.id)
  })

  it('does not let a lane pass its pin before the other lane reaches its own', async () => {
    const builder = new SchedulerScenarioBuilder()
    builder.resetAt.set(G0 + 1, schedulerIdeal(12))
    builder.skillAt.set(S0 + 1, IDEAL_SKILL)
    // The Skill lane start (the weapon's own Practical Skills) is selected, so
    // the Skill lane waits until the Bonus lane reached its Ideal end.
    const entry = builder.existingEntry(
      'entry.m',
      builder.target('target.m', 12),
      builder.gogma('owned.m', { seriesSkillId: 'series_skill.fixture.z', groupSkillId: 'group_skill.fixture.a' }),
      {
        bonus: { from: G0, resets: 2 },
        skill: { from: S0, resets: 2 },
        select: { axis: 'skill', lanePosition: 0 },
      },
    )
    const scenario = builder.build()
    const result = await schedule(scenario)
    expect(result.termination.status).toBe('completed')
    expect(routeActions(result).map(({ actionType }) => actionType)).toEqual([
      'reset_bonuses',
      'reset_bonuses',
      'reset_skills',
      'reset_skills',
    ])
    const replay = expectReplayValid(scenario, result)
    const milestone = replay.drafts.findIndex(({ checkpointMilestones }) => checkpointMilestones.length > 0)
    expect(milestone).toBe(1)
    expect(replay.drafts[milestone].checkpointMilestones[0].buildListEntryId).toBe(entry.id)
  })
})

/** Target Ideal `index` with its Sharpness rank relaxed: a Practical match. */
function practicalCompromise(index: number) {
  return schedulerIdeal(index).map((bonus) =>
    bonus.bonusTypeId === 'bonus_type.fixture.sharpness'
      ? { ...bonus, bonusRankId: 'bonus_rank.fixture.low' }
      : bonus,
  ) as ReturnType<typeof schedulerIdeal>
}

describe('Scenario I: a Build List Entry that does not start from the preferred weapon', () => {
  it('schedules the Entry as it is and never reads the preference', async () => {
    const builder = new SchedulerScenarioBuilder()
    builder.resetAt.set(G0 + 2, schedulerIdeal(13))
    const routeSource = builder.gogma('owned.route')
    const preferred = builder.gogma('owned.preferred')
    const target = builder.target('target.i', 13, { preferredOwnedWeaponId: preferred.id })
    const entry = builder.existingEntry('entry.i', target, routeSource, { bonus: { from: G0, resets: 3 } })
    const scenario = builder.build()
    const result = await schedule(scenario)
    expect(result.termination.status).toBe('completed')
    expect(routeActions(result).every(({ ownedWeaponId }) => ownedWeaponId === routeSource.id)).toBe(true)
    expect(result.bestState!.securedOwnedWeaponIdByEntryId[entry.id]).toBe(routeSource.id)
    expect(result.bestState!.preferredSourceProgressCount).toBe(0)
    expectReplayValid(scenario, result)
  })
})

describe('Scenario J: two Routes consuming the same owned weapon', () => {
  it('commits one of them and keeps the protection semantics of the reserved weapon', async () => {
    const builder = new SchedulerScenarioBuilder()
    builder.resetAt.set(G0 + 2, schedulerIdeal(13))
    builder.resetAt.set(G0 + 5, schedulerIdeal(14))
    const shared = builder.gogma('owned.shared')
    const entryA = builder.existingEntry('entry.a', builder.target('target.a', 13), shared, {
      bonus: { from: G0, resets: 3 },
    })
    const entryB = builder.existingEntry('entry.b', builder.target('target.b', 14), shared, {
      bonus: { from: G0, resets: 6 },
    })
    const scenario = builder.build()
    const result = await schedule(scenario)
    expect(result.conflicts.map(({ kind }) => kind)).toEqual(['same_owned_weapon_consumed'])
    expect(result.bestState!.selectedBuildListEntryIds).toEqual([entryA.id])
    expect(progressedIn(result, entryB.id)).toBe(false)
    expect(result.rejections).toEqual([
      expect.objectContaining({ buildListEntryId: entryB.id, reason: 'conflict_not_committed' }),
    ])
    const weapon = result.bestState!.simulatedInventory.ownedWeapons.find(({ id }) => id === shared.id)
    expect(weapon).toMatchObject({ status: 'ideal', isProtected: true })
    expect(result.bestState!.inFlightExistingSourceByOwnedWeaponId[shared.id]).toBeUndefined()
    expectReplayValid(scenario, result)
  })
})

describe('Scenario K: a new Normal Artian Route', () => {
  it('forges, converts (Skill +1, Gogma +0) and then runs the transient lanes', async () => {
    const builder = new SchedulerScenarioBuilder().withNormalCounter()
    builder.resetAt.set(G0 + 2, schedulerIdeal(15))
    builder.skillAt.set(S0 + 2, IDEAL_SKILL)
    const entry = builder.conversionEntry(
      'entry.k',
      builder.target('target.k', 15),
      { kind: 'predicted', count: 2, convertAt: S0 },
      { bonus: { from: G0, resets: 3 }, skill: { from: S0 + 1, resets: 2 } },
    )
    const scenario = builder.build()
    const result = await schedule(scenario)
    expect(result.termination.status).toBe('completed')
    const trace = result.bestState!.trace
    expect(trace.slice(0, 3).map(({ actionType }) => actionType)).toEqual([
      'create_normal_artian',
      'create_normal_artian',
      'convert_normal_to_gogma',
    ])
    expect(trace[0].rngBefore.normalCounters).toEqual([{ id: NORMAL_COUNTER_ID, counter: N0 }])
    expect(trace[1].rngAfter.normalCounters).toEqual([{ id: NORMAL_COUNTER_ID, counter: N0 + 2 }])
    expect(trace[2].rngBefore).toMatchObject({ skillCounter: S0, gogmaCounter: G0 })
    expect(trace[2].rngAfter).toMatchObject({ skillCounter: S0 + 1, gogmaCounter: G0 })
    // Base completion gates both stream lanes.
    expect(trace.slice(3, 8).every(({ primaryBuildListEntryId }) => primaryBuildListEntryId === entry.id)).toBe(true)
    expect(result.bestState!.lastWeaponOperationSubjectKey).toContain('entry_transient_gogma')
    const replay = expectReplayValid(scenario, result)
    const projection = projectProductionPlanExecution({
      input: scenario.input,
      drafts: replay.drafts,
      selectedBuildListEntryIds: result.bestState!.selectedBuildListEntryIds,
      searchFinalOwnedWeapons: result.bestState!.simulatedInventory.ownedWeapons,
      dependencies: scenario.dependencies,
      productionPlanId: 'plan.scheduler.k' as never,
      now: '2026-09-24T00:00:00.000Z',
    })
    expect(projection.steps).toHaveLength(routeActions(result).length)
  })

  it('makes a blind forge wait for a committed predicted forge of a confirmed Counter', async () => {
    const builder = new SchedulerScenarioBuilder().withNormalCounter()
    builder.skillAt.set(S0, IDEAL_SKILL)
    builder.skillAt.set(S0 + 1, { seriesSkillId: 'series_skill.fixture.b', groupSkillId: null })
    builder.resetAt.set(G0, schedulerIdeal(16))
    builder.resetAt.set(G0 + 1, schedulerIdeal(17))
    const blind = builder.conversionEntry(
      'entry.blind',
      builder.target('target.blind', 16),
      { kind: 'blind', convertAt: S0 },
      { bonus: { from: G0, resets: 1 } },
    )
    const predicted = builder.conversionEntry(
      'entry.predicted',
      builder.target('target.predicted', 17, { idealSeriesSkillId: 'series_skill.fixture.b' }),
      { kind: 'predicted', count: 1, convertAt: S0 + 1 },
      { bonus: { from: G0, resets: 2 } },
    )
    const scenario = builder.build()
    const result = await schedule(scenario)
    expect(result.termination.status).toBe('completed')
    const trace = result.bestState!.trace
    expect(trace[0]).toMatchObject({ primaryBuildListEntryId: predicted.id, actionType: 'create_normal_artian' })
    expect(trace[1]).toMatchObject({ primaryBuildListEntryId: blind.id, actionType: 'create_normal_artian' })
    // The blind forge advanced the confirmed Counter only after the predicted one.
    expect(trace[1].rngBefore.normalCounters).toEqual([{ id: NORMAL_COUNTER_ID, counter: N0 + 1 }])
    expect(result.bestState!.currentNormalCounters[0].counter).toBe(N0 + 2)
    expectReplayValid(scenario, result)
  })

  it('runs a blind forge at once when the Normal Counter is unconfirmed', async () => {
    const builder = new SchedulerScenarioBuilder().withNormalCounter({ isConfirmed: false })
    builder.skillAt.set(S0, IDEAL_SKILL)
    builder.resetAt.set(G0, schedulerIdeal(16))
    const blind = builder.conversionEntry(
      'entry.blind',
      builder.target('target.blind', 16),
      { kind: 'blind', convertAt: S0 },
      { bonus: { from: G0, resets: 1 } },
    )
    const scenario = builder.build()
    const result = await schedule(scenario)
    expect(result.termination.status).toBe('completed')
    expect(result.bestState!.trace[0]).toMatchObject({ primaryBuildListEntryId: blind.id, actionType: 'create_normal_artian' })
    expect(result.bestState!.currentNormalCounters[0]).toMatchObject({ counter: N0, isConfirmed: false })
    expectReplayValid(scenario, result)
  })
})

describe('Scenario L: an explicit ConflictResolution', () => {
  it('commits the selected participant, drops the other, and settles other conflicts provisionally', async () => {
    const build = () => {
      const { builder, entryA, entryB } = scenarioD({ a: 2, b: 4 })
      builder.skillAt.set(S0 + 3, IDEAL_SKILL)
      const entryC = builder.existingEntry(
        'entry.c',
        builder.target('target.c', 20),
        builder.gogma('owned.c', { restorationBonuses: schedulerIdeal(20), seriesSkillId: 'series_skill.fixture.z' }),
        { skill: { from: S0, resets: 4 } },
      )
      const entryD = builder.existingEntry(
        'entry.d',
        builder.target('target.d', 21),
        builder.gogma('owned.d', { restorationBonuses: schedulerIdeal(21), seriesSkillId: 'series_skill.fixture.z' }),
        { skill: { from: S0, resets: 4 } },
      )
      return { builder, entryA, entryB, entryC, entryD }
    }
    const probe = build()
    const unresolved = await schedule(probe.builder.build())
    const gogmaConflict = unresolved.conflicts.find(({ kind }) => kind === 'same_gogma_counter')!
    const { builder, entryA, entryB, entryC, entryD } = build()
    // The lower-priority participant is chosen explicitly: R does not matter.
    builder.conflictResolutions = [{ conflictKey: gogmaConflict.id, selectedBuildListEntryId: entryA.id }]
    const scenario = builder.build()
    const result = await schedule(scenario)
    expect(result.warnings.some(({ kind }) => kind === 'invalid_conflict_resolution')).toBe(false)
    const resolved = result.conflicts.find(({ id }) => id === gogmaConflict.id)!
    expect(resolved.selectedBuildListEntryId).toBe(entryA.id)
    const skillConflict = result.conflicts.find(({ kind }) => kind === 'same_skill_counter')!
    expect(skillConflict.selectedBuildListEntryId).toBeNull()
    expect(result.bestState!.selectedBuildListEntryIds).toEqual([entryA.id, entryC.id])
    expect(result.rejections).toEqual(expect.arrayContaining([
      expect.objectContaining({ buildListEntryId: entryB.id, reason: 'conflict_resolution_not_selected' }),
      expect.objectContaining({ buildListEntryId: entryD.id, reason: 'conflict_not_committed' }),
    ]))
    expect(progressedIn(result, entryB.id)).toBe(false)
    expectReplayValid(scenario, result)
    const rejected = createRejectedBuildListEntries(scenario.input, result, result.bestState!.selectedBuildListEntryIds)
    expect(rejected.map(({ buildListEntryId, reason }) => [buildListEntryId, reason])).toEqual([
      [entryB.id, 'resource_conflict'],
      [entryD.id, 'resource_conflict'],
    ])
  })
})

describe('Scenario M: a temporary replacement set', () => {
  function replacementScenario(includeReplaced: boolean) {
    const builder = new SchedulerScenarioBuilder()
    builder.resetAt.set(G0 + 1, schedulerIdeal(30))
    builder.resetAt.set(G0 + 3, schedulerIdeal(31))
    builder.resetAt.set(G0 + 5, schedulerIdeal(31))
    const entryA = builder.existingEntry('entry.a', builder.target('target.a', 30), builder.gogma('owned.a'), {
      bonus: { from: G0, resets: 2 },
    })
    const targetB = builder.target('target.b', 31)
    const persisted = builder.existingEntry('entry.b1', targetB, builder.gogma('owned.b1'), {
      bonus: { from: G0, resets: 4 },
    })
    const generated = builder.existingEntry('entry.b2', targetB, builder.gogma('owned.b2'), {
      bonus: { from: G0, resets: 6 },
    })
    const scenario = builder.build()
    if (!includeReplaced) {
      scenario.input.buildListEntries = scenario.input.buildListEntries.filter(({ id }) => id !== persisted.id)
    }
    const replacements: BuildListEntryReplacement[] = [{
      targetWeaponId: targetB.id,
      replacedBuildListEntryId: persisted.id,
      generatedBuildListEntryId: generated.id,
    }]
    return { scenario, entryA, persisted, generated, replacements }
  }

  it('schedules the replacement set only and never records the replaced Entry', async () => {
    const { scenario, entryA, persisted, generated, replacements } = replacementScenario(false)
    const result = await runPlannerDeterministicSchedule(
      scenario.input,
      scenario.dependencies,
      {},
      { kind: 'temporary_replacement', replacements },
    )
    expect(result.termination.status).toBe('completed')
    expect(result.bestState!.selectedBuildListEntryIds).toEqual([entryA.id, generated.id])
    const mentioned = JSON.stringify({
      trace: result.bestState!.trace,
      conflicts: result.conflicts,
      rejections: result.rejections,
      selected: result.bestState!.selectedBuildListEntryIds,
    })
    expect(mentioned).not.toContain(persisted.id)
    expectReplayValid(scenario, result)
  })

  it('fails closed when the replaced Entry is still in the full-run input', async () => {
    const { scenario, replacements } = replacementScenario(true)
    const result = await runPlannerDeterministicSchedule(
      scenario.input,
      scenario.dependencies,
      {},
      { kind: 'temporary_replacement', replacements },
    )
    expect(result.bestState).toBeNull()
    expect(result.validationIssues.length).toBeGreaterThan(0)
  })

  it('accepts no temporary augmented input as a full run', () => {
    const { scenario, replacements } = replacementScenario(true)
    void runPlannerDeterministicSchedule(
      scenario.input,
      scenario.dependencies,
      {},
      // @ts-expect-error A trial's augmented preflight input is never a full Planner run.
      { kind: 'temporary_augmented', replacements },
    ).catch(() => undefined)
  })
})

describe('16.3: zero-operation confirmation before commitment', () => {
  it('protects the confirmed weapon, so a Route that would reset it is not committed', async () => {
    const builder = new SchedulerScenarioBuilder()
    builder.resetAt.set(G0 + 1, schedulerIdeal(23))
    const owned = builder.gogma('owned.ideal', { restorationBonuses: schedulerIdeal(22) })
    const confirm = builder.existingEntry('entry.z', builder.target('target.z', 22), owned, {})
    const destructive = builder.existingEntry('entry.y', builder.target('target.y', 23), owned, {
      bonus: { from: G0, resets: 2 },
    })
    const scenario = builder.build()
    const result = await schedule(scenario)
    expect(result.bestState!.trace).toHaveLength(1)
    expect(result.bestState!.trace[0]).toMatchObject({
      kind: 'reserve_candidate',
      primaryBuildListEntryId: confirm.id,
    })
    // The start confirmation constructs no counted state.
    expect(result.expandedStates).toBe(0)
    expect(result.rejections).toEqual([
      expect.objectContaining({ buildListEntryId: destructive.id, reason: 'protected_destructive_use' }),
    ])
    expect(result.warnings.map(({ kind }) => kind)).toContain('protected_weapon_required')
    expect(result.termination.status).toBe('exhausted')
    expect(createRejectedBuildListEntries(scenario.input, result, result.bestState!.selectedBuildListEntryIds))
      .toEqual([expect.objectContaining({ buildListEntryId: destructive.id, reason: 'requires_protected_weapon' })])
    expectReplayValid(scenario, result)
  })
})

/** 7.8: X's Gogma holding waits for X's conversion, whose Skill position waits on Y's pin. */
function deadlockScenario() {
  const builder = new SchedulerScenarioBuilder()
  builder.skillAt.set(S0, IDEAL_SKILL)
  builder.skillAt.set(S0 + 2, IDEAL_SKILL)
  builder.resetAt.set(G0 + 5, schedulerIdeal(24))
  builder.resetAt.set(G0 + 7, schedulerIdeal(25))
  const entryX = builder.conversionEntry(
    'entry.x',
    builder.target('target.x', 24),
    { kind: 'owned', source: builder.normal('owned.normal.x'), convertAt: S0 },
    { bonus: { from: G0, resets: 6 } },
  )
  const entryY = builder.existingEntry(
    'entry.y',
    builder.target('target.y', 25, { priority: 2 }),
    builder.gogma('owned.y', { seriesSkillId: 'series_skill.fixture.z', groupSkillId: 'group_skill.fixture.a' }),
    {
      bonus: { from: G0, resets: 8 },
      skill: { from: S0, resets: 3 },
      select: { axis: 'skill', lanePosition: 0 },
    },
  )
  return { builder, entryX, entryY }
}

describe('16.3: deadlock', () => {
  it('drops the Entry ranked last by R and keeps scheduling the rest', async () => {
    const { builder, entryX, entryY } = deadlockScenario()
    const scenario = builder.build()
    const result = await schedule(scenario)
    expect(result.conflicts).toEqual([])
    expect(result.bestState!.selectedBuildListEntryIds).toEqual([entryX.id])
    expect(result.rejections).toEqual([
      expect.objectContaining({ buildListEntryId: entryY.id, reason: 'conflict_not_committed' }),
    ])
    expect(result.rejections[0].detail).toContain('deadlock')
    expect(result.termination.status).toBe('exhausted')
    expectReplayValid(scenario, result)
    // Y had already progressed before the drop; it is still reported.
    expect(progressedIn(result, entryY.id)).toBe(true)
    expect(createRejectedBuildListEntries(scenario.input, result, result.bestState!.selectedBuildListEntryIds))
      .toEqual([expect.objectContaining({ buildListEntryId: entryY.id, reason: 'resource_conflict' })])
  })

  it('is deterministic', async () => {
    const first = await schedule(deadlockScenario().builder.build())
    const second = await schedule(deadlockScenario().builder.build())
    expect(second).toEqual(first)
  })
})

describe('16.3: cross satisfaction', () => {
  function crossSatisfactionScenario() {
    const builder = new SchedulerScenarioBuilder()
    builder.resetAt.set(G0 + 2, schedulerIdeal(26))
    builder.resetAt.set(G0 + 10, schedulerIdeal(26))
    const targetA = builder.target('target.a', 26)
    const targetB = builder.target('target.b', 26)
    const entryA = builder.existingEntry('entry.a', targetA, builder.gogma('owned.a'), {
      bonus: { from: G0, resets: 3 },
    })
    const entryB = builder.existingEntry('entry.b', targetB, builder.gogma('owned.b'), {
      bonus: { from: G0, resets: 11 },
    })
    return { scenario: builder.build(), targetA, targetB, entryA, entryB }
  }

  it('releases a committed Entry whose Target another reserve satisfied, as already_satisfied', () => {
    const { scenario, entryA, entryB } = crossSatisfactionScenario()
    const run = readyRun(scenario)
    const result = runToEnd(run)
    expect(result.termination.status).toBe('completed')
    expect(result.bestState!.selectedBuildListEntryIds).toEqual([entryA.id])
    expect(run.statusOf(entryB.id)).toBe('released')
    expect(progressedIn(result, entryB.id)).toBe(false)
    expect(result.bestState!.currentRngState.gogmaCounter.value).toBe(G0 + 3)
    // The final released state is projected as the existing rejection reason.
    expect(result.rejections).toEqual([
      expect.objectContaining({
        buildListEntryId: entryB.id,
        actionType: 'reserve_weapon',
        reason: 'candidate_already_satisfied',
      }),
    ])
    expect(createRejectedBuildListEntries(scenario.input, result, result.bestState!.selectedBuildListEntryIds))
      .toEqual([expect.objectContaining({ buildListEntryId: entryB.id, reason: 'already_satisfied' })])
    expectReplayValid(scenario, result)
  })

  it('keeps no stale already-satisfied rejection for an Entry committed again after its release', () => {
    const { scenario, targetA, targetB, entryB } = crossSatisfactionScenario()
    const run = readyRun(scenario)
    for (let guard = 0; run.statusOf(entryB.id) !== 'released'; guard += 1) {
      if (guard > 100) throw new Error('B was never released.')
      run.step()
    }
    // Simulate the Target losing its Ideal again: the weapon that satisfied it
    // is in flight, so satisfaction no longer counts it (6.8).
    run.state.inFlightExistingSourceByOwnedWeaponId['owned.a'] = true
    run.state.targetSatisfaction[targetA.id] = { hasPractical: false, hasIdeal: false }
    run.state.targetSatisfaction[targetB.id] = { hasPractical: false, hasIdeal: false }
    run.refreshCommitment()
    expect(run.statusOf(entryB.id)).toBe('committed')
    const result = runToEnd(run)
    expect(run.statusOf(entryB.id)).toBe('secured')
    expect(result.bestState!.selectedBuildListEntryIds).toContain(entryB.id)
    expect(result.rejections.filter(({ buildListEntryId }) => buildListEntryId === entryB.id)).toEqual([])
  })
})

describe('6.8: dynamic commitment', () => {
  it('commits an Entry whose Target lost its Ideal in flight, without pushing anyone out', async () => {
    const builder = new SchedulerScenarioBuilder()
    builder.resetAt.set(G0 + 2, schedulerIdeal(28))
    builder.resetAt.set(G0 + 20, schedulerIdeal(27))
    const holder = builder.gogma('owned.holder', { restorationBonuses: schedulerIdeal(27) })
    const later = builder.existingEntry('entry.e1', builder.target('target.t1', 27), builder.gogma('owned.v1'), {
      bonus: { from: G0, resets: 21 },
    })
    const mutating = builder.existingEntry('entry.e2', builder.target('target.t2', 28), holder, {
      bonus: { from: G0, resets: 3 },
    })
    const scenario = builder.build()
    const run = readyRun(scenario)
    expect(run.statusOf(later.id)).toBe('not_needed')
    expect(run.statusOf(mutating.id)).toBe('committed')
    const result = runToEnd(run)
    expect(result.termination.status).toBe('completed')
    expect(result.bestState!.selectedBuildListEntryIds).toEqual([later.id, mutating.id])
    expect(result.rejections).toEqual([])
    expectReplayValid(scenario, result)
  })

  it('drops an Entry whose precondition broke without writing state, and continues', () => {
    const { builder, entryA, entryB } = scenarioA()
    const scenario = builder.build()
    const run = readyRun(scenario)
    // Simulate a precondition that broke mid-run: B's source became protected.
    run.state.simulatedInventory.ownedWeapons = run.state.simulatedInventory.ownedWeapons.map((weapon) =>
      weapon.id === 'owned.b' && weapon.kind === 'gogma' ? { ...weapon, isProtected: true } : weapon,
    )
    const before = structuredClone(run.state)
    run.refreshCommitment()
    expect(run.state).toEqual(before)
    expect(run.statusOf(entryB.id)).toBe('dropped')
    const result = runToEnd(run)
    expect(result.bestState!.selectedBuildListEntryIds).toEqual([entryA.id])
    expect(result.rejections).toEqual([
      expect.objectContaining({ buildListEntryId: entryB.id, reason: 'protected_destructive_use' }),
    ])
    expect(result.termination.status).toBe('exhausted')
  })
})

describe('7.5: committed-only physical action sharing', () => {
  it('never progresses a non-committed Entry through a shared action', async () => {
    const builder = new SchedulerScenarioBuilder()
    builder.resetAt.set(G0, schedulerIdeal(32))
    builder.resetAt.set(G0 + 1, schedulerIdeal(33))
    const shared = builder.gogma('owned.shared')
    const entryA = builder.existingEntry('entry.a', builder.target('target.a', 32), shared, {
      bonus: { from: G0, resets: 1 },
    })
    const entryB = builder.existingEntry('entry.b', builder.target('target.b', 33), shared, {
      bonus: { from: G0, resets: 2 },
    })
    const scenario = builder.build()
    const run = readyRun(scenario)
    expect(run.statusOf(entryB.id)).toBe('dropped')
    const [action] = run.safeActions()
    expect(action.progressedUnits.map(({ entryId }) => entryId)).toEqual([entryA.id])
    // Under the Beam Search contract (every relevant Entry may share) the same
    // action would progress B too.
    const lanesA = run.context.allLanePlans.get(entryA.id)!
    const beamShared = mergedPlannerProgressedEntries(run.state, lanesA.bonus[0], {
      entriesById: run.context.entriesById,
      lanePlans: run.context.allLanePlans,
      conflictsById: new Map(),
      conflictIdsByUnitKey: new Map(),
      selectedPhysicalActionKeysByConflictId: new Map(),
      targets: run.context.planningTargets,
      master: scenario.input.master,
      engine: scenario.dependencies.rngEngine,
      preferredSourceEntryIds: new Set(),
      requirements: run.context.checkpointRequirements,
    })
    expect(beamShared.map(({ entryId }) => entryId)).toEqual([entryA.id, entryB.id])
    const result = runToEnd(run)
    expect(routeActions(result)[0].progressedBuildListEntryIds).toEqual([entryA.id])
    expect(progressedIn(result, entryB.id)).toBe(false)
    expect(reserveIndexOf(result, entryB.id)).toBe(-1)
    expectReplayValid(scenario, result)
  })
})

describe('14: bounds, cancellation and determinism', () => {
  it('stops at maxPlanSteps as incomplete', async () => {
    const scenario = scenarioB().builder.build({ maxPlanSteps: 20 })
    const result = await schedule(scenario)
    expect(result.completed).toBe(false)
    expect(result.termination).toMatchObject({ status: 'incomplete', reachedLimits: ['max_plan_steps'] })
    expect(result.bestState!.trace).toHaveLength(20)
    expect(result.warnings.map(({ kind }) => kind)).toContain('max_steps_reached')
    expectReplayValid(scenario, result)
  })

  it('stops at maxExpandedStates as incomplete', async () => {
    const scenario = scenarioB().builder.build({ maxExpandedStates: 20 })
    const result = await schedule(scenario)
    expect(result.termination).toMatchObject({
      status: 'incomplete',
      reachedLimits: ['max_expanded_states'],
      expandedStates: 20,
    })
    expect(result.warnings.map(({ kind }) => kind)).toContain('max_expanded_states_reached')
  })

  it('completes on exactly maxExpandedStates and still reports the bound', async () => {
    const scenario = scenarioA().builder.build({ maxExpandedStates: 154 })
    const result = await schedule(scenario)
    expect(result.completed).toBe(true)
    expect(result.expandedStates).toBe(154)
    expect(result.termination.status).toBe('completed')
    expect(result.termination.reachedLimits).toEqual(['max_expanded_states'])
    expect(result.warnings.map(({ kind }) => kind)).toContain('max_expanded_states_reached')
  })

  it('completes on exactly maxPlanSteps and still reports the bound', async () => {
    const scenario = scenarioA().builder.build({ maxPlanSteps: 154 })
    const result = await schedule(scenario)
    expect(result.completed).toBe(true)
    expect(result.bestState!.trace).toHaveLength(154)
    expect(result.termination.status).toBe('completed')
    expect(result.termination.reachedLimits).toEqual(['max_plan_steps'])
    expect(result.warnings.map(({ kind }) => kind)).toContain('max_steps_reached')
  })

  it('reports both bounds when a completion reaches both exactly', async () => {
    const scenario = scenarioA().builder.build({ maxPlanSteps: 154, maxExpandedStates: 154 })
    const result = await schedule(scenario)
    expect(result.termination.status).toBe('completed')
    expect([...result.termination.reachedLimits].sort()).toEqual(['max_expanded_states', 'max_plan_steps'])
  })

  it('reports no bound when the completion stays below both', async () => {
    const scenario = scenarioA().builder.build({ maxPlanSteps: 155, maxExpandedStates: 155 })
    const result = await schedule(scenario)
    expect(result.termination).toMatchObject({ status: 'completed', reachedLimits: [] })
  })

  it('reports a cancellation as cancelled', async () => {
    const scenario = scenarioB().builder.build()
    let calls = 0
    const result = await runPlannerDeterministicSchedule(scenario.input, scenario.dependencies, {
      shouldCancel: () => ++calls > 5,
    })
    expect(result.cancelled).toBe(true)
    expect(result.termination.status).toBe('cancelled')
    expect(result.bestState!.trace).toHaveLength(5)
  })

  it('reports progress per applied action and yields while it runs', async () => {
    const scenario = scenarioB().builder.build()
    const progress: number[] = []
    let yields = 0
    const result = await runPlannerDeterministicSchedule(scenario.input, scenario.dependencies, {
      onProgress: ({ expandedStates }) => progress.push(expandedStates),
      yieldControl: async () => {
        yields += 1
      },
    })
    expect(progress).toEqual(Array.from({ length: result.expandedStates }, (_unused, index) => index + 1))
    expect(yields).toBeGreaterThan(0)
  })

  it('returns an identical result for the same input, fixture and dependencies', async () => {
    const first = await schedule(scenarioD({ a: 3, b: 3 }).builder.build())
    const second = await schedule(scenarioD({ a: 3, b: 3 }).builder.build())
    expect(second).toEqual(first)
  })
})

describe('6.2 / 6.3: malformed inputs fail closed', () => {
  it('refuses an ordinary input with two Entries of one Target and resolutions for both', async () => {
    const builder = new SchedulerScenarioBuilder()
    builder.resetAt.set(G0 + 1, schedulerIdeal(34))
    builder.resetAt.set(G0 + 2, schedulerIdeal(34))
    const target = builder.target('target.dup', 34)
    const first = builder.existingEntry('entry.dup1', target, builder.gogma('owned.dup1'), {
      bonus: { from: G0, resets: 2 },
    })
    const second = builder.existingEntry('entry.dup2', target, builder.gogma('owned.dup2'), {
      bonus: { from: G0, resets: 3 },
    })
    builder.conflictResolutions = [
      { conflictKey: 'conflict.x', selectedBuildListEntryId: first.id },
      { conflictKey: 'conflict.y', selectedBuildListEntryId: second.id },
    ]
    const result = await schedule(builder.build())
    expect(result.bestState).toBeNull()
    expect(result.warnings.map(({ kind }) => kind)).toContain('duplicate_build_list_entries_for_target')
    expect(result.termination).toMatchObject({ status: 'exhausted', expandedStates: 0 })
  })

  it('refuses a resolution set that selects two Entries of one Target', () => {
    const { builder, entryA, entryB } = scenarioD({ a: 3, b: 3 })
    const run = readyRun(builder.build())
    const twin = { ...entryB, id: 'entry.twin' as BuildListEntryId, targetWeaponId: entryA.targetWeaponId }
    const [conflict] = run.context.initialConflictDetection.conflicts
    const refused = createPlannerRouteCommitment(run.state, {
      allSearchEntries: run.context.allSearchEntries,
      allLanePlans: run.context.allLanePlans,
      entriesById: new Map([...run.context.entriesById, [twin.id, twin]]),
      planningTargets: run.context.planningTargets,
      planningTargetsById: run.context.planningTargetsById,
      checkpointRequirements: run.context.checkpointRequirements,
      initialRelevantEntries: run.context.initialRelevantEntries,
      initialConflictDetection: {
        ...run.context.initialConflictDetection,
        conflicts: [
          { ...conflict, id: 'conflict.x', selectedBuildListEntryId: entryA.id },
          { ...conflict, id: 'conflict.y', selectedBuildListEntryId: twin.id },
        ],
      },
    })
    expect(refused.status).toBe('invalid')
  })
})

describe('Phase A: Production stays on the Beam Search', () => {
  it('Production Plan generation never produces the scheduler-only rejection', async () => {
    const { builder } = scenarioD({ a: 2, b: 4 }, 2)
    const scenario = builder.build()
    let beamRuns = 0
    const beamResults: PlannerBeamSearchResult[] = []
    const result = await createProductionPlanWithObserver(scenario.input, scenario.dependencies, undefined, {
      beforeBeamSearch: () => {
        beamRuns += 1
      },
      afterBeamSearch: (beam) => beamResults.push(beam),
    })
    expect(beamRuns).toBe(1)
    expect(beamResults[0].rejections.some(({ reason }) => reason === 'conflict_not_committed')).toBe(false)
    expect(result.plan?.rejectedBuildListEntries.every(({ detail }) => detail.includes('Beam Search'))).toBe(true)
  })
})

describe('Issue #103 instrumentation workloads', () => {
  it.each(['sanity-3', 'representative-12'])(
    'schedules %s with one state and a Trace-Replay-valid trace',
    async (workloadId) => {
      const { input, engine } = createPlannerSearchInstrumentationInput(workloadId)
      const result = await runPlannerDeterministicSchedule(
        input,
        createDeterministicPlannerDependencies(engine),
      )
      expect(result.termination.status).not.toBe('incomplete')
      expect(result.expandedStates).toBe(result.bestState!.trace.length)
      const replay = replayPlannerSearchTrace(input, result.bestState!, engine)
      expect(replay.issues).toEqual([])
      expect(replay.isValid).toBe(true)
      // Every Entry not completed was left out by a provisional conflict outcome.
      const selected = new Set(result.bestState!.selectedBuildListEntryIds)
      input.buildListEntries
        .filter(({ id }) => !selected.has(id))
        .forEach(({ id }) => {
          expect(result.rejections).toContainEqual(
            expect.objectContaining({ buildListEntryId: id, reason: 'conflict_not_committed' }),
          )
        })
    },
    60_000,
  )
})

describe('Route commitment: pin-blocked skippable units hold their position', () => {
  /**
   * P's Skill lane start is its selected checkpoint, so its skippable Skill
   * unit at S is pin-blocked until P's Bonus lane ends - and the Skill Counter
   * already stands at S + 1. P also conflicts with Q at Gogma C + 1 (P Keeps,
   * Q Resets there), and P has the higher priority.
   */
  function pinnedPastScenario() {
    const builder = new SchedulerScenarioBuilder()
    builder.keepAt.set(G0 + 1, schedulerIdeal(40))
    builder.resetAt.set(G0 + 1, schedulerIdeal(41))
    builder.skillAt.set(S0 + 1, IDEAL_SKILL)
    const entryP = builder.existingEntry(
      'entry.p',
      builder.target('target.p', 40, { priority: 5 }),
      builder.gogma('owned.p', { seriesSkillId: 'series_skill.fixture.z', groupSkillId: 'group_skill.fixture.a' }),
      {
        bonus: { from: G0, resets: 1, keeps: 1 },
        skill: { from: S0, resets: 2 },
        select: { axis: 'skill', lanePosition: 0 },
      },
    )
    const entryQ = builder.existingEntry(
      'entry.q',
      builder.target('target.q', 41, { priority: 1 }),
      builder.gogma('owned.q'),
      { bonus: { from: G0, resets: 2 } },
    )
    const scenario = builder.build()
    scenario.input.rngState.skillCounter.value = S0 + 1
    scenario.input.buildListEntries.forEach((entry) => synchronizeOrchestrationEntry(scenario.input, entry))
    return { scenario, entryP, entryQ }
  }

  it('never commits an Entry whose pin-blocked skippable unit was already passed', () => {
    const { scenario, entryP, entryQ } = pinnedPastScenario()
    const run = readyRun(scenario)
    // The conflict is real: both are initial conflict participants.
    expect(run.context.initialConflictDetection.conflicts.map(({ buildListEntryIds }) => buildListEntryIds))
      .toEqual([[entryP.id, entryQ.id]])
    const lanes = run.context.allLanePlans.get(entryP.id)!
    expect(lanes.skill[0].canSkipWhenCounterPassed).toBe(true)
    // The prepared start state could not fast-forward past the pin.
    expect(run.state.routeProgressByEntryId[entryP.id].skill).toBe(0)
    const commitment = createPlannerRouteCommitment(run.state, {
      allSearchEntries: run.context.allSearchEntries,
      allLanePlans: run.context.allLanePlans,
      entriesById: run.context.entriesById,
      planningTargets: run.context.planningTargets,
      planningTargetsById: run.context.planningTargetsById,
      checkpointRequirements: run.context.checkpointRequirements,
      initialConflictDetection: run.context.initialConflictDetection,
      initialRelevantEntries: run.context.initialRelevantEntries,
    })
    if (commitment.status !== 'ready') throw new Error('Commitment refused the input.')
    expect(commitment.records.get(entryP.id)).toMatchObject({
      status: 'dropped',
      rejection: { reason: 'counter_before_current', actionType: 'reset_skills' },
    })
    expect(commitment.records.get(entryQ.id)?.status).toBe('committed')
    expect(commitment.rejections.map(({ buildListEntryId, reason }) => [buildListEntryId, reason]))
      .toEqual([[entryP.id, 'counter_before_current']])
  })

  it('does not let the unexecutable Entry push an executable one out of a conflict', async () => {
    const { scenario, entryP, entryQ } = pinnedPastScenario()
    const result = await schedule(scenario)
    expect(result.bestState!.selectedBuildListEntryIds).toEqual([entryQ.id])
    expect(result.rejections).toEqual([
      expect.objectContaining({ buildListEntryId: entryP.id, reason: 'counter_before_current' }),
    ])
    expect(result.rejections.some(({ reason }) => reason === 'conflict_not_committed')).toBe(false)
    expect(progressedIn(result, entryP.id)).toBe(false)
    expect(result.termination.status).toBe('exhausted')
    expectReplayValid(scenario, result)
  })
})
