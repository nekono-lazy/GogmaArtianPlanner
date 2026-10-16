import { describe, expect, it } from 'vitest'
import type { BuildListEntry, PlanConflict } from '../models/publicTypes'
import {
  G0,
  IDEAL_SKILL,
  S0,
  SchedulerScenarioBuilder,
  schedulerIdeal,
} from '../../test/fixtures/plannerScheduler'
import type { OrchestrationScenario } from '../../test/fixtures/plannerConstrainedOrchestration'
import { runPlannerDeterministicSchedule } from './plannerDeterministicScheduler'
import { replayPlannerSearchTrace } from './plannerTraceReplay'
import { createProductionPlanWithObserver } from './productionPlanGeneration'
import type { PlannerConflictResolution, PlannerRunResult } from './plannerTypes'

/**
 * Issue #278 PR-2 (`docs/PLANNER_SPEC.md` 9.6.2 / 9.6.4 / 9.6.5 / 9.6.6): the
 * ordinary Planner's conflict resolution. A decision is Route-level, an
 * explicitly preferred Entry is kept before every Entry no decision prefers, a
 * decision applies to initial conflicts only, a conflict whose remaining
 * participants are one or none is no longer reported, and the result says
 * whether every preferred Entry is completed. Every scheduled trace is verified
 * by the unchanged Trace Replay.
 */

function practicalCompromise(index: number) {
  return schedulerIdeal(index).map((bonus) =>
    bonus.bonusTypeId === 'bonus_type.fixture.sharpness'
      ? { ...bonus, bonusRankId: 'bonus_rank.fixture.low' }
      : bonus,
  ) as ReturnType<typeof schedulerIdeal>
}

function expectReplayValid(scenario: OrchestrationScenario, result: PlannerRunResult) {
  expect(result.bestState).not.toBeNull()
  const replay = replayPlannerSearchTrace(scenario.input, result.bestState!, scenario.engine)
  expect(replay.issues).toEqual([])
  expect(replay.isValid).toBe(true)
}

function conflictBetween(conflicts: readonly PlanConflict[], left: BuildListEntry, right: BuildListEntry) {
  return conflicts.find(({ buildListEntryIds }) =>
    buildListEntryIds.includes(left.id) && buildListEntryIds.includes(right.id))
}

const invalidWarnings = (result: { warnings: readonly { kind: string }[] }) =>
  result.warnings.filter(({ kind }) => kind === 'invalid_conflict_resolution')

/**
 * X = {A, B} on a Gogma position, Y = {A, C} on a Skill position, Z = {B, D} on
 * a later Skill position. R ranks C (priority 5) and B (4) above A (2).
 */
function preferenceScenario(resolutions: (ids: { x: string; y: string; z: string }) => PlannerConflictResolution[] = () => []) {
  const build = () => {
    const builder = new SchedulerScenarioBuilder()
    builder.keepAt.set(G0 + 50, schedulerIdeal(0))
    builder.resetAt.set(G0 + 50, schedulerIdeal(1))
    builder.skillAt.set(S0 + 3, IDEAL_SKILL)
    builder.skillAt.set(S0 + 5, IDEAL_SKILL)
    const entryA = builder.existingEntry(
      'entry.a',
      builder.target('target.a', 0, { priority: 2 }),
      builder.gogma('owned.a', { seriesSkillId: 'series_skill.fixture.z' }),
      { bonus: { from: G0, resets: 50, keeps: 1 }, skill: { from: S0, resets: 4 } },
    )
    const entryB = builder.existingEntry(
      'entry.b',
      builder.target('target.b', 1, { priority: 4 }),
      builder.gogma('owned.b', { seriesSkillId: 'series_skill.fixture.z' }),
      { bonus: { from: G0, resets: 51 }, skill: { from: S0 + 4, resets: 2 } },
    )
    const entryC = builder.existingEntry(
      'entry.c',
      builder.target('target.c', 20, { priority: 5 }),
      builder.gogma('owned.c', { restorationBonuses: schedulerIdeal(20), seriesSkillId: 'series_skill.fixture.z' }),
      { skill: { from: S0, resets: 4 } },
    )
    const entryD = builder.existingEntry(
      'entry.d',
      builder.target('target.d', 30, { priority: 1 }),
      builder.gogma('owned.d', { restorationBonuses: schedulerIdeal(30), seriesSkillId: 'series_skill.fixture.z' }),
      { skill: { from: S0 + 4, resets: 2 } },
    )
    return { builder, entryA, entryB, entryC, entryD }
  }
  const probe = build()
  const probeScenario = probe.builder.build()
  return {
    probeScenario,
    ...(() => {
      const built = build()
      return built
    })(),
    async conflicts() {
      const result = await runPlannerDeterministicSchedule(probeScenario.input, probeScenario.dependencies)
      return result.conflicts
    },
    resolutions,
  }
}

async function preferenceIds() {
  const scenario = preferenceScenario()
  const conflicts = await scenario.conflicts()
  const x = conflictBetween(conflicts, scenario.entryA, scenario.entryB)!
  const y = conflictBetween(conflicts, scenario.entryA, scenario.entryC)!
  const z = conflictBetween(conflicts, scenario.entryB, scenario.entryD)!
  return { scenario, x, y, z }
}

describe('ordinary conflict resolution: the decision and its consequences (9.6.2 / 9.6.4 / 9.6.5)', () => {
  it('finds the three conflicts the scenario is built around', async () => {
    const { x, y, z } = await preferenceIds()
    expect(x.kind).toBe('same_gogma_counter')
    expect(y.kind).toBe('same_skill_counter')
    expect(z.kind).toBe('same_skill_counter')
    expect(new Set([x.id, y.id, z.id]).size).toBe(3)
  })

  it('without a decision, R settles every conflict provisionally (the baseline)', async () => {
    const { scenario } = await preferenceIds()
    const result = await runPlannerDeterministicSchedule(scenario.probeScenario.input, scenario.probeScenario.dependencies)
    // C outranks A, so A is dropped by the provisional outcome of Y; B then
    // runs and D loses Z to B.
    expect(result.bestState!.selectedBuildListEntryIds).toEqual([scenario.entryB.id, scenario.entryC.id])
    expect(result.conflicts).toHaveLength(3)
    expect(result.conflicts.every(({ selectedBuildListEntryId }) => selectedBuildListEntryId === null)).toBe(true)
  })

  it('prefers A: A is completed, B runs no unit, B\'s other conflict is dropped, the A / C conflict stays pending, D is made', async () => {
    const { x, y, z } = await preferenceIds()
    const built = preferenceScenario()
    built.builder.conflictResolutions = [{ conflictKey: x.id, selectedBuildListEntryId: built.entryA.id }]
    const scenario = built.builder.build()
    const result = await runPlannerDeterministicSchedule(scenario.input, scenario.dependencies)

    expect(invalidWarnings(result)).toEqual([])
    // A outranks C in the provisional outcome of Y although R prefers C.
    expect(result.bestState!.selectedBuildListEntryIds).toEqual([built.entryA.id, built.entryD.id])
    expect(result.rejections).toEqual(expect.arrayContaining([
      expect.objectContaining({ buildListEntryId: built.entryB.id, reason: 'conflict_resolution_not_selected' }),
      expect.objectContaining({ buildListEntryId: built.entryC.id, reason: 'conflict_not_committed' }),
    ]))
    const routeEntries = new Set((result.bestState!.trace).flatMap((action) =>
      action.kind === 'route_operation' ? action.progressedBuildListEntryIds : []))
    expect(routeEntries.has(built.entryB.id)).toBe(false)
    // X keeps the decision, Y stays pending (A and C both remain candidates),
    // Z is no longer reported (only D remains of it).
    expect(result.conflicts.map(({ id }) => id).sort()).toEqual([x.id, y.id].sort())
    expect(result.conflicts.find(({ id }) => id === x.id)?.selectedBuildListEntryId).toBe(built.entryA.id)
    expect(result.conflicts.find(({ id }) => id === y.id)?.selectedBuildListEntryId).toBeNull()
    expect(result.conflicts.some(({ id }) => id === z.id)).toBe(false)
    // The recommendation stays R's: C on Y.
    expect(result.conflicts.find(({ id }) => id === y.id)?.recommendedBuildListEntryId).toBe(built.entryC.id)
    expectReplayValid(scenario, result)
  })

  it('reports the preferred Entry completed in the Plan and records the decision on its Conflict', async () => {
    const { x } = await preferenceIds()
    const built = preferenceScenario()
    built.builder.conflictResolutions = [{ conflictKey: x.id, selectedBuildListEntryId: built.entryA.id }]
    const scenario = built.builder.build()
    const generated = await createProductionPlanWithObserver(scenario.input, scenario.dependencies, undefined)

    expect(generated.plan).not.toBeNull()
    expect(generated.plan!.conflicts).toEqual(generated.conflicts)
    expect(generated.conflictResolutionOutcome).toEqual({
      allPreferredEntriesCompleted: true,
      preferredEntries: [{ buildListEntryId: built.entryA.id, targetWeaponId: built.entryA.targetWeaponId, status: 'completed' }],
    })
    expect(generated.plan!.conflicts.filter(({ selectedBuildListEntryId }) => selectedBuildListEntryId !== null))
      .toEqual([expect.objectContaining({ id: x.id, selectedBuildListEntryId: built.entryA.id })])
    expect(generated.plan!.conflictRepairLineage).toBeNull()
  })

  it('re-selects on the same conflict: B is completed and A runs no unit', async () => {
    const { x, z } = await preferenceIds()
    const built = preferenceScenario()
    built.builder.conflictResolutions = [{ conflictKey: x.id, selectedBuildListEntryId: built.entryB.id }]
    const scenario = built.builder.build()
    const generated = await createProductionPlanWithObserver(scenario.input, scenario.dependencies, undefined)
    expect(generated.conflictResolutionOutcome?.allPreferredEntriesCompleted).toBe(true)
    expect(generated.plan!.selectedBuildListEntryIds).toContain(built.entryB.id)
    expect(generated.plan!.selectedBuildListEntryIds).not.toContain(built.entryA.id)
    // A is excluded, so its conflict with C is no longer reported; Z (B / D) stays pending.
    expect(generated.conflicts.some(({ buildListEntryIds }) => buildListEntryIds.includes(built.entryC.id))).toBe(false)
    expect(generated.conflicts.find(({ id }) => id === z.id)?.selectedBuildListEntryId).toBeNull()
  })

  it('carries no outcome for an input without decisions', async () => {
    const { scenario } = await preferenceIds()
    const generated = await createProductionPlanWithObserver(scenario.probeScenario.input, scenario.probeScenario.dependencies, undefined)
    expect('conflictResolutionOutcome' in generated).toBe(false)
  })

  it('refuses a decision that matches no initial conflict (a dynamic or a made-up ID) and never applies it', async () => {
    const built = preferenceScenario()
    built.builder.conflictResolutions = [{ conflictKey: 'conflict.dynamic.only', selectedBuildListEntryId: built.entryA.id }]
    const scenario = built.builder.build()
    const result = await runPlannerDeterministicSchedule(scenario.input, scenario.dependencies)
    expect(invalidWarnings(result)).toHaveLength(1)
    expect(result.conflicts.every(({ selectedBuildListEntryId }) => selectedBuildListEntryId === null)).toBe(true)
  })

  it('fails an inconsistent decision set closed: A preferred on X and not selected on Y', async () => {
    const { x, y } = await preferenceIds()
    const built = preferenceScenario()
    built.builder.conflictResolutions = [
      { conflictKey: x.id, selectedBuildListEntryId: built.entryA.id },
      { conflictKey: y.id, selectedBuildListEntryId: built.entryC.id },
    ]
    const scenario = built.builder.build()
    const generated = await createProductionPlanWithObserver(scenario.input, scenario.dependencies, undefined)
    expect(generated.plan).toBeNull()
    expect(invalidWarnings(generated)).toHaveLength(1)
    expect(generated.conflictResolutionOutcome?.allPreferredEntriesCompleted).toBe(false)
  })

  it('completes and reports every preferred Entry of a multi-decision set', async () => {
    // A on X and D on Z: B is excluded by both, and A / C stays undecided -
    // only A is preferred there, so A wins it.
    const { x, z } = await preferenceIds()
    const built = preferenceScenario()
    built.builder.conflictResolutions = [
      { conflictKey: x.id, selectedBuildListEntryId: built.entryA.id },
      { conflictKey: z.id, selectedBuildListEntryId: built.entryD.id },
    ]
    const scenario = built.builder.build()
    const generated = await createProductionPlanWithObserver(scenario.input, scenario.dependencies, undefined)
    expect(invalidWarnings(generated)).toEqual([])
    expect(generated.conflictResolutionOutcome).toEqual({
      allPreferredEntriesCompleted: true,
      preferredEntries: [
        { buildListEntryId: built.entryA.id, targetWeaponId: built.entryA.targetWeaponId, status: 'completed' },
        { buildListEntryId: built.entryD.id, targetWeaponId: built.entryD.targetWeaponId, status: 'completed' },
      ],
    })
  })
})

describe('ordinary conflict resolution: two preferred Entries in one undecided conflict', () => {
  /** P / Q on one Gogma position (decided), Q / R on one Skill position (undecided), R / S on another (decided). */
  function clashScenario() {
    const builder = new SchedulerScenarioBuilder()
    builder.keepAt.set(G0 + 5, schedulerIdeal(40))
    builder.resetAt.set(G0 + 5, schedulerIdeal(41))
    builder.skillAt.set(S0 + 2, IDEAL_SKILL)
    builder.keepAt.set(G0 + 8, schedulerIdeal(43))
    builder.resetAt.set(G0 + 8, schedulerIdeal(42))
    const entryP = builder.existingEntry('entry.p', builder.target('target.p', 40, { priority: 3 }),
      builder.gogma('owned.p'), { bonus: { from: G0, resets: 5, keeps: 1 } })
    const entryQ = builder.existingEntry('entry.q', builder.target('target.q', 41, { priority: 2 }),
      builder.gogma('owned.q', { seriesSkillId: 'series_skill.fixture.z' }),
      { bonus: { from: G0, resets: 6 }, skill: { from: S0, resets: 3 } })
    // R's own Bonus lane consumes the Gogma stream from G0, so it never waits on P or Q.
    const entryR = builder.existingEntry('entry.r', builder.target('target.r', 42, { priority: 5 }),
      builder.gogma('owned.r', { seriesSkillId: 'series_skill.fixture.z' }),
      { bonus: { from: G0, resets: 9 }, skill: { from: S0, resets: 3 } })
    const entryS = builder.existingEntry('entry.s', builder.target('target.s', 43, { priority: 4 }),
      builder.gogma('owned.s'), { bonus: { from: G0 + 6, resets: 2, keeps: 1 } })
    return { builder, entryP, entryQ, entryR, entryS }
  }

  it('drops one of them by R among the preferred and names the other as the cause', async () => {
    const probe = clashScenario()
    const probeScenario = probe.builder.build()
    const conflicts = (await runPlannerDeterministicSchedule(probeScenario.input, probeScenario.dependencies)).conflicts
    const pq = conflictBetween(conflicts, probe.entryP, probe.entryQ)
    const qr = conflictBetween(conflicts, probe.entryQ, probe.entryR)
    const rs = conflictBetween(conflicts, probe.entryR, probe.entryS)
    expect(pq && qr && rs).toBeTruthy()

    const built = clashScenario()
    built.builder.conflictResolutions = [
      { conflictKey: pq!.id, selectedBuildListEntryId: built.entryQ.id },
      { conflictKey: rs!.id, selectedBuildListEntryId: built.entryR.id },
    ]
    const scenario = built.builder.build()
    const generated = await createProductionPlanWithObserver(scenario.input, scenario.dependencies, undefined)
    expect(invalidWarnings(generated)).toEqual([])
    const outcome = generated.conflictResolutionOutcome!
    expect(outcome.allPreferredEntriesCompleted).toBe(false)
    // R outranks Q by priority; Q is the one dropped, R named as the cause.
    expect(outcome.preferredEntries).toEqual([
      {
        buildListEntryId: built.entryQ.id,
        targetWeaponId: built.entryQ.targetWeaponId,
        status: 'incomplete',
        cause: { kind: 'preferred_entries_conflict', conflictId: qr!.id, otherBuildListEntryId: built.entryR.id },
      },
      { buildListEntryId: built.entryR.id, targetWeaponId: built.entryR.targetWeaponId, status: 'completed' },
    ])
  })
})

describe('ordinary conflict resolution: a Route-level decision over a shareable action', () => {
  it('excludes a non-selected participant even where its unit is the selected Entry\'s shareable action', async () => {
    const build = () => {
      const builder = new SchedulerScenarioBuilder()
      builder.resetAt.set(G0, schedulerIdeal(5))
      const shared = builder.gogma('owned.shared')
      const entryA = builder.existingEntry('entry.a', builder.target('target.a', 5, { priority: 3 }), shared, {
        bonus: { from: G0, resets: 1 },
      })
      const entryB = builder.existingEntry('entry.b', builder.target('target.b', 5, { priority: 3 }), shared, {
        bonus: { from: G0, resets: 1 },
      })
      const entryC = builder.existingEntry('entry.c', builder.target('target.c', 5, { priority: 3 }), builder.gogma('owned.c'), {
        bonus: { from: G0, resets: 1 },
      })
      return { builder, entryA, entryB, entryC }
    }
    const probe = build()
    const probeScenario = probe.builder.build()
    const [conflict] = (await runPlannerDeterministicSchedule(probeScenario.input, probeScenario.dependencies)).conflicts
    expect(conflict.buildListEntryIds).toEqual([probe.entryA.id, probe.entryB.id, probe.entryC.id])

    const built = build()
    built.builder.conflictResolutions = [{ conflictKey: conflict.id, selectedBuildListEntryId: built.entryA.id }]
    const scenario = built.builder.build()
    const result = await runPlannerDeterministicSchedule(scenario.input, scenario.dependencies)
    expect(result.rejections).toEqual(expect.arrayContaining([
      expect.objectContaining({ buildListEntryId: built.entryB.id, reason: 'conflict_resolution_not_selected' }),
      expect.objectContaining({ buildListEntryId: built.entryC.id, reason: 'conflict_resolution_not_selected' }),
    ]))
    const progressed = result.bestState!.trace.flatMap((action) =>
      action.kind === 'route_operation' ? action.progressedBuildListEntryIds : [])
    expect(progressed).not.toContain(built.entryB.id)
    expect(result.bestState!.selectedBuildListEntryIds).toEqual([built.entryA.id])
    expectReplayValid(scenario, result)
  })
})

describe('ordinary conflict resolution: checkpoint participants (9.6.2 / 9.5.1)', () => {
  /**
   * conflict 1 = A / B on a Skill position; conflict 2 = B's selected
   * checkpoint endpoint (its first Reset at G0) / C's Keep at G0 (and, with
   * `withD`, D's Keep at G0 too).
   */
  function checkpointScenario(withD = false) {
    const builder = new SchedulerScenarioBuilder()
    builder.skillAt.set(S0 + 1, IDEAL_SKILL)
    builder.resetAt.set(G0, practicalCompromise(11))
    builder.resetAt.set(G0 + 2, schedulerIdeal(11))
    builder.keepAt.set(G0, schedulerIdeal(21))
    const entryA = builder.existingEntry('entry.a', builder.target('target.a', 10, { priority: 3 }),
      builder.gogma('owned.a', { restorationBonuses: schedulerIdeal(10), seriesSkillId: 'series_skill.fixture.z' }),
      { skill: { from: S0, resets: 2 } })
    const entryB = builder.existingEntry('entry.b', builder.target('target.b', 11, { priority: 3 }),
      builder.gogma('owned.b', { seriesSkillId: 'series_skill.fixture.z' }),
      { bonus: { from: G0, resets: 3 }, skill: { from: S0, resets: 2 }, select: { axis: 'bonus', lanePosition: 1 } })
    const entryC = builder.existingEntry('entry.c', builder.target('target.c', 21, { priority: 3 }),
      builder.gogma('owned.c'), { bonus: { from: G0, resets: 0, keeps: 1 } })
    entryC.candidateSnapshot.route.kind = 'existing_gogma_keep_bonuses'
    const entryD = withD
      ? builder.existingEntry('entry.d', builder.target('target.d', 21, { priority: 3 }),
          builder.gogma('owned.d'), { bonus: { from: G0, resets: 0, keeps: 1 } })
      : null
    if (entryD) entryD.candidateSnapshot.route.kind = 'existing_gogma_keep_bonuses'
    return { builder, entryA, entryB, entryC, entryD }
  }

  async function checkpointConflicts(withD = false) {
    const probe = checkpointScenario(withD)
    const scenario = probe.builder.build()
    const conflicts = (await runPlannerDeterministicSchedule(scenario.input, scenario.dependencies)).conflicts
    const conflict1 = conflictBetween(conflicts, probe.entryA, probe.entryB)!
    const conflict2 = conflictBetween(conflicts, probe.entryB, probe.entryC)!
    return { conflict1, conflict2 }
  }

  it('builds a checkpoint conflict beside an ordinary one', async () => {
    const { conflict1, conflict2 } = await checkpointConflicts()
    expect(conflict1.checkpointParticipants).toEqual([])
    expect(conflict2.checkpointParticipants?.map(({ buildListEntryId }) => buildListEntryId)).toEqual(['entry.b'])
  })

  it('prefers A on conflict 1: B runs no unit, conflict 2 is no longer reported, C is made, and B\'s selection is untouched', async () => {
    const { conflict1, conflict2 } = await checkpointConflicts()
    const built = checkpointScenario()
    const selectionBefore = structuredClone(built.entryB.intermediateStateSelection)
    built.builder.conflictResolutions = [{ conflictKey: conflict1.id, selectedBuildListEntryId: built.entryA.id }]
    const scenario = built.builder.build()
    const generated = await createProductionPlanWithObserver(scenario.input, scenario.dependencies, undefined)

    expect(invalidWarnings(generated)).toEqual([])
    expect(generated.plan!.selectedBuildListEntryIds).toEqual([built.entryA.id, built.entryC.id])
    expect(generated.conflicts.map(({ id }) => id)).toEqual([conflict1.id])
    expect(generated.conflicts.some(({ id }) => id === conflict2.id)).toBe(false)
    expect(generated.conflictResolutionOutcome?.allPreferredEntriesCompleted).toBe(true)
    expect(scenario.input.buildListEntries.find(({ id }) => id === built.entryB.id)?.intermediateStateSelection)
      .toEqual(selectionBefore)
  })

  it('refuses a decision on the checkpoint conflict while its checkpoint participant runs', async () => {
    const { conflict2 } = await checkpointConflicts()
    const built = checkpointScenario()
    built.builder.conflictResolutions = [{ conflictKey: conflict2.id, selectedBuildListEntryId: built.entryC.id }]
    const scenario = built.builder.build()
    const result = await runPlannerDeterministicSchedule(scenario.input, scenario.dependencies)
    expect(invalidWarnings(result)).toHaveLength(1)
    expect(result.conflicts.find(({ id }) => id === conflict2.id)?.selectedBuildListEntryId).toBeNull()
  })

  it('accepts a decision on {B (checkpoint), C, D} once B is excluded by the decision on conflict 1', async () => {
    const probe = await checkpointConflicts(true)
    expect(probe.conflict2.buildListEntryIds).toEqual(['entry.b', 'entry.c', 'entry.d'])
    const built = checkpointScenario(true)
    built.builder.conflictResolutions = [
      { conflictKey: probe.conflict1.id, selectedBuildListEntryId: built.entryA.id },
      { conflictKey: probe.conflict2.id, selectedBuildListEntryId: built.entryC.id },
    ]
    const scenario = built.builder.build()
    const generated = await createProductionPlanWithObserver(scenario.input, scenario.dependencies, undefined)
    expect(invalidWarnings(generated)).toEqual([])
    expect(generated.conflicts.find(({ id }) => id === probe.conflict2.id)?.selectedBuildListEntryId).toBe(built.entryC.id)
    expect(generated.plan!.selectedBuildListEntryIds).toEqual([built.entryA.id, built.entryC.id])
    expect(generated.conflictResolutionOutcome?.allPreferredEntriesCompleted).toBe(true)
  })

  it('keeps {B (checkpoint), C, D} pending - and choosable - when only conflict 1 is decided', async () => {
    const probe = await checkpointConflicts(true)
    const built = checkpointScenario(true)
    built.builder.conflictResolutions = [{ conflictKey: probe.conflict1.id, selectedBuildListEntryId: built.entryA.id }]
    const scenario = built.builder.build()
    const generated = await createProductionPlanWithObserver(scenario.input, scenario.dependencies, undefined)
    const remaining = generated.conflicts.find(({ id }) => id === probe.conflict2.id)
    expect(remaining?.selectedBuildListEntryId).toBeNull()
    expect(remaining?.buildListEntryIds).toEqual(['entry.b', 'entry.c', 'entry.d'])
  })
})
