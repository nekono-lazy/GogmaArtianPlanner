import type { BuildListEntryReplacement } from '../../domain/buildList/buildListEntryReplacement'
import { preparePlannerInitialContext } from '../../domain/planner/plannerInitialContext'
import type { PlannerRunBuildListContext } from '../../domain/planner/plannerTypes'
import type { OrchestrationScenario } from './plannerConstrainedOrchestration'
import { synchronizeOrchestrationEntry } from './plannerConstrainedOrchestration'
import {
  G0,
  IDEAL_SKILL,
  S0,
  SchedulerScenarioBuilder,
  schedulerIdeal,
} from './plannerScheduler'

/**
 * The Issue #103 acceptance scenarios (`docs/ISSUE_103_DETERMINISTIC_PLANNER_DESIGN.md`
 * 16.1 A - M and 16.3) as one named catalogue, for the Phase B parity harness
 * and the scheduler instrumentation tests.
 *
 * Each factory builds a fresh scenario with the same inputs the Phase A
 * acceptance test (`plannerDeterministicScheduler.test.ts`) schedules; the
 * Phase A test keeps its own step-by-step assertions. No Production RNG
 * behavior is implied: every prediction is a Fake Engine fixture entry.
 */

export interface PlannerSchedulerCatalogueScenario {
  readonly id: string
  readonly scenario: OrchestrationScenario
  /** `temporary_replacement` for Scenario M; the ordinary persisted input otherwise. */
  readonly buildListContext?: PlannerRunBuildListContext
}

/** Target Ideal `index` with its Sharpness rank relaxed: a Practical match. */
function practicalCompromise(index: number) {
  return schedulerIdeal(index).map((bonus) =>
    bonus.bonusTypeId === 'bonus_type.fixture.sharpness'
      ? { ...bonus, bonusRankId: 'bonus_rank.fixture.low' }
      : bonus,
  ) as ReturnType<typeof schedulerIdeal>
}

function scenarioA(options: Parameters<SchedulerScenarioBuilder['build']>[0] = {}) {
  const builder = new SchedulerScenarioBuilder()
  builder.resetAt.set(G0 + 50, schedulerIdeal(0))
  builder.skillAt.set(S0 + 100, IDEAL_SKILL)
  builder.existingEntry('entry.a', builder.target('target.a', 0), builder.gogma('owned.a'), {
    bonus: { from: G0, resets: 51 },
  })
  builder.existingEntry(
    'entry.b',
    builder.target('target.b', 1),
    builder.gogma('owned.b', { restorationBonuses: schedulerIdeal(1), seriesSkillId: 'series_skill.fixture.z' }),
    { skill: { from: S0, resets: 101 } },
  )
  return builder.build(options)
}

function scenarioB(options: Parameters<SchedulerScenarioBuilder['build']>[0] = {}) {
  const builder = new SchedulerScenarioBuilder()
  ;[50, 80, 120].forEach((offset, index) => {
    builder.resetAt.set(G0 + offset, schedulerIdeal(index))
    const key = String.fromCharCode(97 + index)
    builder.existingEntry(
      `entry.${key}`,
      builder.target(`target.${key}`, index),
      builder.gogma(`owned.${key}`),
      { bonus: { from: G0, resets: offset + 1 } },
    )
  })
  return builder.build(options)
}

function scenarioC() {
  const builder = new SchedulerScenarioBuilder()
  builder.resetAt.set(G0 + 50, schedulerIdeal(0))
  builder.resetAt.set(G0 + 51, schedulerIdeal(1))
  builder.existingEntry('entry.a', builder.target('target.a', 0), builder.gogma('owned.a'), {
    bonus: { from: G0, resets: 51 },
  })
  builder.existingEntry('entry.b', builder.target('target.b', 1), builder.gogma('owned.b'), {
    bonus: { from: G0, resets: 52 },
  })
  return builder.build()
}

function scenarioDBuilder(priorities: { a: 1 | 2 | 3 | 4 | 5; b: 1 | 2 | 3 | 4 | 5 }) {
  const builder = new SchedulerScenarioBuilder()
  builder.keepAt.set(G0 + 50, schedulerIdeal(0))
  builder.resetAt.set(G0 + 50, schedulerIdeal(1))
  builder.existingEntry(
    'entry.a',
    builder.target('target.a', 0, { priority: priorities.a }),
    builder.gogma('owned.a'),
    { bonus: { from: G0, resets: 50, keeps: 1 } },
  )
  builder.existingEntry(
    'entry.b',
    builder.target('target.b', 1, { priority: priorities.b }),
    builder.gogma('owned.b'),
    { bonus: { from: G0, resets: 51 } },
  )
  return builder
}

function scenarioE() {
  const builder = new SchedulerScenarioBuilder()
  builder.resetAt.set(G0, schedulerIdeal(5))
  const shared = builder.gogma('owned.shared')
  builder.existingEntry('entry.a', builder.target('target.a', 5), shared, { bonus: { from: G0, resets: 1 } })
  builder.existingEntry('entry.b', builder.target('target.b', 5), shared, { bonus: { from: G0, resets: 1 } })
  return builder.build()
}

function scenarioF(finalB: number) {
  const builder = new SchedulerScenarioBuilder()
  builder.skillAt.set(S0, IDEAL_SKILL)
  builder.skillAt.set(S0 + 1, { seriesSkillId: 'series_skill.fixture.b', groupSkillId: null })
  builder.resetAt.set(G0 + 10, schedulerIdeal(6))
  if (finalB !== G0 + 10) builder.resetAt.set(finalB, schedulerIdeal(7))
  builder.conversionEntry(
    'entry.a',
    builder.target('target.a', 6),
    { kind: 'owned', source: builder.normal('owned.normal.a'), convertAt: S0 },
    { bonus: { from: G0, resets: 11 } },
  )
  builder.conversionEntry(
    'entry.b',
    builder.target('target.b', finalB === G0 + 10 ? 6 : 7, { idealSeriesSkillId: 'series_skill.fixture.b' }),
    { kind: 'owned', source: builder.normal('owned.normal.b'), convertAt: S0 + 1 },
    { bonus: { from: G0, resets: finalB - G0 + 1 } },
  )
  return builder.build()
}

function scenarioG(preference: 'planner' | 'skill_first' | 'bonus_first') {
  const builder = new SchedulerScenarioBuilder()
  builder.resetAt.set(G0 + 4, schedulerIdeal(8))
  builder.skillAt.set(S0 + 4, IDEAL_SKILL)
  builder.existingEntry(
    'entry.g',
    builder.target('target.g', 8),
    builder.gogma('owned.g', { seriesSkillId: 'series_skill.fixture.z' }),
    { bonus: { from: G0, resets: 5 }, skill: { from: S0, resets: 5 }, improvementPreference: preference },
  )
  return builder.build()
}

function scenarioGWaiting() {
  const builder = new SchedulerScenarioBuilder()
  builder.skillAt.set(S0, { seriesSkillId: 'series_skill.fixture.y', groupSkillId: null })
  builder.skillAt.set(S0 + 3, IDEAL_SKILL)
  builder.resetAt.set(G0, schedulerIdeal(10))
  builder.resetAt.set(G0 + 2, schedulerIdeal(9))
  builder.conversionEntry(
    'entry.y',
    builder.target('target.y', 10, { priority: 1, idealSeriesSkillId: 'series_skill.fixture.y' }),
    { kind: 'owned', source: builder.normal('owned.normal.y'), convertAt: S0 },
    { bonus: { from: G0, resets: 1 } },
  )
  builder.existingEntry(
    'entry.g',
    builder.target('target.g', 9, { priority: 5 }),
    builder.gogma('owned.g', { seriesSkillId: 'series_skill.fixture.z' }),
    { bonus: { from: G0, resets: 3 }, skill: { from: S0 + 1, resets: 3 }, improvementPreference: 'bonus_first' },
  )
  return builder.build()
}

function scenarioHPin() {
  const builder = new SchedulerScenarioBuilder()
  builder.resetAt.set(G0, practicalCompromise(11))
  builder.resetAt.set(G0 + 2, schedulerIdeal(11))
  builder.resetAt.set(G0 + 4, schedulerIdeal(11))
  builder.existingEntry('entry.p', builder.target('target.p', 11), builder.gogma('owned.p'), {
    bonus: { from: G0, resets: 5 },
    select: { axis: 'bonus', lanePosition: 1 },
  })
  builder.existingEntry('entry.q', builder.target('target.q', 11), builder.gogma('owned.q'), {
    bonus: { from: G0, resets: 3 },
  })
  return builder.build()
}

function scenarioHLanes() {
  const builder = new SchedulerScenarioBuilder()
  builder.resetAt.set(G0 + 1, schedulerIdeal(12))
  builder.skillAt.set(S0 + 1, IDEAL_SKILL)
  builder.existingEntry(
    'entry.m',
    builder.target('target.m', 12),
    builder.gogma('owned.m', { seriesSkillId: 'series_skill.fixture.z', groupSkillId: 'group_skill.fixture.a' }),
    { bonus: { from: G0, resets: 2 }, skill: { from: S0, resets: 2 }, select: { axis: 'skill', lanePosition: 0 } },
  )
  return builder.build()
}

function scenarioI() {
  const builder = new SchedulerScenarioBuilder()
  builder.resetAt.set(G0 + 2, schedulerIdeal(13))
  const routeSource = builder.gogma('owned.route')
  const preferred = builder.gogma('owned.preferred')
  builder.existingEntry(
    'entry.i',
    builder.target('target.i', 13, { preferredOwnedWeaponId: preferred.id }),
    routeSource,
    { bonus: { from: G0, resets: 3 } },
  )
  return builder.build()
}

function scenarioJ() {
  const builder = new SchedulerScenarioBuilder()
  builder.resetAt.set(G0 + 2, schedulerIdeal(13))
  builder.resetAt.set(G0 + 5, schedulerIdeal(14))
  const shared = builder.gogma('owned.shared')
  builder.existingEntry('entry.a', builder.target('target.a', 13), shared, { bonus: { from: G0, resets: 3 } })
  builder.existingEntry('entry.b', builder.target('target.b', 14), shared, { bonus: { from: G0, resets: 6 } })
  return builder.build()
}

function scenarioKPredicted() {
  const builder = new SchedulerScenarioBuilder().withNormalCounter()
  builder.resetAt.set(G0 + 2, schedulerIdeal(15))
  builder.skillAt.set(S0 + 2, IDEAL_SKILL)
  builder.conversionEntry(
    'entry.k',
    builder.target('target.k', 15),
    { kind: 'predicted', count: 2, convertAt: S0 },
    { bonus: { from: G0, resets: 3 }, skill: { from: S0 + 1, resets: 2 } },
  )
  return builder.build()
}

function scenarioKBlind(confirmed: boolean) {
  const builder = new SchedulerScenarioBuilder().withNormalCounter(confirmed ? {} : { isConfirmed: false })
  builder.skillAt.set(S0, IDEAL_SKILL)
  builder.resetAt.set(G0, schedulerIdeal(16))
  builder.conversionEntry(
    'entry.blind',
    builder.target('target.blind', 16),
    { kind: 'blind', convertAt: S0 },
    { bonus: { from: G0, resets: 1 } },
  )
  if (confirmed) {
    builder.skillAt.set(S0 + 1, { seriesSkillId: 'series_skill.fixture.b', groupSkillId: null })
    builder.resetAt.set(G0 + 1, schedulerIdeal(17))
    builder.conversionEntry(
      'entry.predicted',
      builder.target('target.predicted', 17, { idealSeriesSkillId: 'series_skill.fixture.b' }),
      { kind: 'predicted', count: 1, convertAt: S0 + 1 },
      { bonus: { from: G0, resets: 2 } },
    )
  }
  return builder.build()
}

function scenarioLBuilder() {
  const builder = scenarioDBuilder({ a: 2, b: 4 })
  builder.skillAt.set(S0 + 3, IDEAL_SKILL)
  builder.existingEntry(
    'entry.c',
    builder.target('target.c', 20),
    builder.gogma('owned.c', { restorationBonuses: schedulerIdeal(20), seriesSkillId: 'series_skill.fixture.z' }),
    { skill: { from: S0, resets: 4 } },
  )
  builder.existingEntry(
    'entry.d',
    builder.target('target.d', 21),
    builder.gogma('owned.d', { restorationBonuses: schedulerIdeal(21), seriesSkillId: 'series_skill.fixture.z' }),
    { skill: { from: S0, resets: 4 } },
  )
  return builder
}

/** Scenario L: the Gogma conflict resolved explicitly for the lower-priority participant. */
function scenarioL() {
  const probe = scenarioLBuilder().build()
  const prepared = preparePlannerInitialContext(probe.input, probe.dependencies)
  if (prepared.status !== 'ready') throw new Error('Scenario L probe did not prepare.')
  const gogmaConflict = prepared.context.initialConflictDetection.conflicts.find(
    ({ kind }) => kind === 'same_gogma_counter',
  )
  if (!gogmaConflict) throw new Error('Scenario L has no Gogma conflict.')
  const builder = scenarioLBuilder()
  builder.conflictResolutions = [
    { conflictKey: gogmaConflict.id, selectedBuildListEntryId: 'entry.a' as never },
  ]
  return builder.build()
}

/** Scenario M: the replacement set of a constrained trial (`entry.b1` -> `entry.b2`). */
function scenarioM(): PlannerSchedulerCatalogueScenario {
  const builder = new SchedulerScenarioBuilder()
  builder.resetAt.set(G0 + 1, schedulerIdeal(30))
  builder.resetAt.set(G0 + 3, schedulerIdeal(31))
  builder.resetAt.set(G0 + 5, schedulerIdeal(31))
  builder.existingEntry('entry.a', builder.target('target.a', 30), builder.gogma('owned.a'), {
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
  scenario.input.buildListEntries = scenario.input.buildListEntries.filter(({ id }) => id !== persisted.id)
  const replacements: BuildListEntryReplacement[] = [{
    targetWeaponId: targetB.id,
    replacedBuildListEntryId: persisted.id,
    generatedBuildListEntryId: generated.id,
  }]
  return {
    id: 'M-temporary-replacement',
    scenario,
    buildListContext: { kind: 'temporary_replacement', replacements },
  }
}

function zeroOperation() {
  const builder = new SchedulerScenarioBuilder()
  builder.resetAt.set(G0 + 1, schedulerIdeal(23))
  const owned = builder.gogma('owned.ideal', { restorationBonuses: schedulerIdeal(22) })
  builder.existingEntry('entry.z', builder.target('target.z', 22), owned, {})
  builder.existingEntry('entry.y', builder.target('target.y', 23), owned, { bonus: { from: G0, resets: 2 } })
  return builder.build()
}

/**
 * The former design 7.8 deadlock example. Y's Reset Skills at S0 is skippable
 * and pin-blocked (its Skill lane start is selected), and X converts at S0.
 * Phase B showed it is no deadlock: X's conversion may consume S0, Y's Skill
 * progress waits at the pin, and Y's S0 unit is fast-forwarded once Y's Bonus
 * lane reaches its pin (`docs/PLANNER_SPEC.md` 7.5.2).
 */
function deadlock() {
  const builder = new SchedulerScenarioBuilder()
  builder.skillAt.set(S0, IDEAL_SKILL)
  builder.skillAt.set(S0 + 2, IDEAL_SKILL)
  builder.resetAt.set(G0 + 5, schedulerIdeal(24))
  builder.resetAt.set(G0 + 7, schedulerIdeal(25))
  builder.conversionEntry(
    'entry.x',
    builder.target('target.x', 24),
    { kind: 'owned', source: builder.normal('owned.normal.x'), convertAt: S0 },
    { bonus: { from: G0, resets: 6 } },
  )
  builder.existingEntry(
    'entry.y',
    builder.target('target.y', 25, { priority: 2 }),
    builder.gogma('owned.y', { seriesSkillId: 'series_skill.fixture.z', groupSkillId: 'group_skill.fixture.a' }),
    { bonus: { from: G0, resets: 8 }, skill: { from: S0, resets: 3 }, select: { axis: 'skill', lanePosition: 0 } },
  )
  return builder.build()
}

/**
 * A true deadlock (design 7.8): the committed Routes wait on each other through
 * holding units only. Y's only Reset Skills at S0 is its Route's last unit
 * (holding) and waits at its pin for Y's Bonus Reset at G0 + 1; the Gogma
 * Counter first needs X's holding Reset at G0, which waits for X's conversion
 * at S0 + 1, behind Y's S0. Z's skippable Reset Skills at S0 may not consume
 * Y's holding position. Dropping Y (priority 1, ranked last by R) frees S0 for
 * Z, and X and Z complete - as they do in the Beam Search.
 */
function trueDeadlock() {
  const builder = new SchedulerScenarioBuilder()
  builder.skillAt.set(S0, IDEAL_SKILL)
  builder.skillAt.set(S0 + 1, IDEAL_SKILL)
  builder.skillAt.set(S0 + 2, IDEAL_SKILL)
  builder.resetAt.set(G0, schedulerIdeal(42))
  builder.resetAt.set(G0 + 1, schedulerIdeal(43))
  builder.conversionEntry(
    'entry.x',
    builder.target('target.x', 42),
    { kind: 'owned', source: builder.normal('owned.normal.x'), convertAt: S0 + 1 },
    { bonus: { from: G0, resets: 1 } },
  )
  builder.existingEntry(
    'entry.y',
    builder.target('target.y', 43, { priority: 1 }),
    builder.gogma('owned.y', { seriesSkillId: 'series_skill.fixture.z', groupSkillId: 'group_skill.fixture.a' }),
    { bonus: { from: G0 + 1, resets: 1 }, skill: { from: S0, resets: 1 }, select: { axis: 'skill', lanePosition: 0 } },
  )
  builder.existingEntry(
    'entry.z',
    builder.target('target.z', 44),
    builder.gogma('owned.z', {
      restorationBonuses: schedulerIdeal(44),
      seriesSkillId: 'series_skill.fixture.z',
      groupSkillId: 'group_skill.fixture.a',
    }),
    { skill: { from: S0, resets: 3 } },
  )
  return builder.build()
}

function crossSatisfaction() {
  const builder = new SchedulerScenarioBuilder()
  builder.resetAt.set(G0 + 2, schedulerIdeal(26))
  builder.resetAt.set(G0 + 10, schedulerIdeal(26))
  builder.existingEntry('entry.a', builder.target('target.a', 26), builder.gogma('owned.a'), {
    bonus: { from: G0, resets: 3 },
  })
  builder.existingEntry('entry.b', builder.target('target.b', 26), builder.gogma('owned.b'), {
    bonus: { from: G0, resets: 11 },
  })
  return builder.build()
}

function dynamicCommitment() {
  const builder = new SchedulerScenarioBuilder()
  builder.resetAt.set(G0 + 2, schedulerIdeal(28))
  builder.resetAt.set(G0 + 20, schedulerIdeal(27))
  const holder = builder.gogma('owned.holder', { restorationBonuses: schedulerIdeal(27) })
  builder.existingEntry('entry.e1', builder.target('target.t1', 27), builder.gogma('owned.v1'), {
    bonus: { from: G0, resets: 21 },
  })
  builder.existingEntry('entry.e2', builder.target('target.t2', 28), holder, { bonus: { from: G0, resets: 3 } })
  return builder.build()
}

function committedOnlySharing() {
  const builder = new SchedulerScenarioBuilder()
  builder.resetAt.set(G0, schedulerIdeal(32))
  builder.resetAt.set(G0 + 1, schedulerIdeal(33))
  const shared = builder.gogma('owned.shared')
  builder.existingEntry('entry.a', builder.target('target.a', 32), shared, { bonus: { from: G0, resets: 1 } })
  builder.existingEntry('entry.b', builder.target('target.b', 33), shared, { bonus: { from: G0, resets: 2 } })
  return builder.build()
}

/**
 * P's Skill lane start is selected, so its skippable Reset Skills at S0 is
 * pin-blocked until P's Bonus lane ends, while the Skill Counter already
 * stands at `skillCounter`. At S0 + 1 only that skippable unit was passed: P
 * stays executable and fast-forwards it once its pin is released. At S0 + 2
 * P's holding (last) Reset Skills at S0 + 1 is lost too, so P fails closed.
 */
function pinnedPast(skillCounter: number = S0 + 1) {
  const builder = new SchedulerScenarioBuilder()
  builder.keepAt.set(G0 + 1, schedulerIdeal(40))
  builder.resetAt.set(G0 + 1, schedulerIdeal(41))
  builder.skillAt.set(S0 + 1, IDEAL_SKILL)
  builder.existingEntry(
    'entry.p',
    builder.target('target.p', 40, { priority: 5 }),
    builder.gogma('owned.p', { seriesSkillId: 'series_skill.fixture.z', groupSkillId: 'group_skill.fixture.a' }),
    { bonus: { from: G0, resets: 1, keeps: 1 }, skill: { from: S0, resets: 2 }, select: { axis: 'skill', lanePosition: 0 } },
  )
  builder.existingEntry('entry.q', builder.target('target.q', 41, { priority: 1 }), builder.gogma('owned.q'), {
    bonus: { from: G0, resets: 2 },
  })
  const scenario = builder.build()
  scenario.input.rngState.skillCounter.value = skillCounter
  scenario.input.buildListEntries.forEach((entry) => synchronizeOrchestrationEntry(scenario.input, entry))
  return scenario
}

/** An ordinary input with two Entries of one Target: both strategies must fail closed. */
function legacyDuplicate() {
  const builder = new SchedulerScenarioBuilder()
  builder.resetAt.set(G0 + 1, schedulerIdeal(34))
  builder.resetAt.set(G0 + 2, schedulerIdeal(34))
  const target = builder.target('target.dup', 34)
  builder.existingEntry('entry.dup1', target, builder.gogma('owned.dup1'), { bonus: { from: G0, resets: 2 } })
  builder.existingEntry('entry.dup2', target, builder.gogma('owned.dup2'), { bonus: { from: G0, resets: 3 } })
  return builder.build()
}

/** An input with no Build List Entry: no planning Target on either side. */
function emptyBuildList() {
  const builder = new SchedulerScenarioBuilder()
  builder.target('target.none', 35)
  return builder.build()
}

/** Every catalogue scenario, freshly built. */
export function plannerSchedulerCatalogue(): PlannerSchedulerCatalogueScenario[] {
  const plain = (id: string, scenario: OrchestrationScenario): PlannerSchedulerCatalogueScenario => ({
    id,
    scenario,
  })
  return [
    plain('A-independent-lanes', scenarioA()),
    plain('B-one-gogma-stream', scenarioB()),
    plain('C-required-and-skippable', scenarioC()),
    plain('D-unresolved-conflict', scenarioDBuilder({ a: 2, b: 4 }).build()),
    plain('D-equal-priority', scenarioDBuilder({ a: 3, b: 3 }).build()),
    plain('E-shared-physical-action', scenarioE()),
    plain('F-transient-collision', scenarioF(G0 + 10)),
    plain('F-transient-executor', scenarioF(G0 + 15)),
    plain('G-bonus-first', scenarioG('bonus_first')),
    plain('G-skill-first', scenarioG('skill_first')),
    plain('G-planner', scenarioG('planner')),
    plain('G-preferred-lane-waits', scenarioGWaiting()),
    plain('H-checkpoint-pin', scenarioHPin()),
    plain('H-checkpoint-lanes', scenarioHLanes()),
    plain('I-not-preferred-source', scenarioI()),
    plain('J-same-owned-weapon', scenarioJ()),
    plain('K-predicted-forge', scenarioKPredicted()),
    plain('K-blind-waits', scenarioKBlind(true)),
    plain('K-blind-unconfirmed', scenarioKBlind(false)),
    plain('L-explicit-resolution', scenarioL()),
    scenarioM(),
    plain('zero-operation', zeroOperation()),
    plain('deadlock', deadlock()),
    plain('true-deadlock', trueDeadlock()),
    plain('cross-satisfaction', crossSatisfaction()),
    plain('dynamic-commitment', dynamicCommitment()),
    plain('committed-only-sharing', committedOnlySharing()),
    plain('pinned-past', pinnedPast()),
    plain('pinned-past-lost-holding', pinnedPast(S0 + 2)),
    plain('exact-bounds-expanded', scenarioA({ maxExpandedStates: 154 })),
    plain('exact-bounds-steps', scenarioA({ maxPlanSteps: 154 })),
    plain('bounded-max-plan-steps', scenarioB({ maxPlanSteps: 20 })),
    plain('bounded-max-expanded-states', scenarioB({ maxExpandedStates: 20 })),
    plain('malformed-legacy-duplicate', legacyDuplicate()),
    plain('empty-build-list', emptyBuildList()),
  ]
}
