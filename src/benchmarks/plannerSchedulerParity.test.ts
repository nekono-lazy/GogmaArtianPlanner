import { describe, expect, it } from 'vitest'
import type { BuildListEntryId, TargetWeaponId } from '../domain/models/publicTypes'
import { plannerSchedulerCatalogue } from '../test/fixtures/plannerSchedulerScenarios'
import { mandatoryParityProblems, runCatalogueParity } from '../test/fixtures/plannerSchedulerParity'
import { createDeterministicPlannerDependencies } from './plannerSearchInstrumentationBenchmark'
import { createPlannerSearchInstrumentationInput } from './plannerSearchInstrumentationFixtures'
import {
  comparePlannerStrategyRuns,
  formatPlannerSchedulerParityReport,
  runPlannerSchedulerParity,
  type PlannerStrategyRunSummary,
} from './plannerSchedulerParity'

/**
 * Issue #103 Phase B parity harness: the classification itself, the fast
 * acceptance scenarios and `sanity-3`. The long acceptance scenarios and
 * `representative-12` run in their own files so the suites spread over Vitest
 * workers; `representative-35` is measured in a real Browser Worker only.
 */

const entry = (value: string) => value as BuildListEntryId
const target = (value: string) => value as TargetWeaponId

/** A minimal consistent summary; every override replaces its field. */
function summary(overrides: Partial<PlannerStrategyRunSummary>): PlannerStrategyRunSummary {
  const base: PlannerStrategyRunSummary = {
    strategy: 'beam',
    buildListCardinalityValid: true,
    planningTargetIds: [target('t1'), target('t2'), target('t3')],
    requiredCheckpointEntryIds: [],
    targetPriorityById: { t1: 3, t2: 5, t3: 1 },
    targetIdByEntryId: { e1: target('t1'), e2: target('t2'), e3: target('t3') },
    termination: {
      status: 'exhausted',
      reachedLimits: [],
      expandedStates: 10,
      completedTargetCount: 0,
      totalTargetCount: 3,
    },
    cancelled: false,
    hasBestState: true,
    completedTargetIds: [],
    selectedBuildListEntryIds: [],
    expandedStates: 10,
    traceLength: 10,
    routeActionCount: 9,
    reserveActionCount: 1,
    stepOrderHash: 'order',
    conflicts: [],
    rejections: [],
    rejectionReasonCounts: {},
    rejectedBuildListEntries: [],
    rejectedReasonCounts: {},
    warningKinds: [],
    validationIssues: [],
    weaponSwitchCount: 0,
    improvementPreferenceViolationCount: 0,
    preferredSourceProgressCount: 0,
    evaluationScore: 0,
    replay: { isValid: true, issueCodes: [], issues: [], unsupportedInput: null, draftCount: 9 },
    projection: {
      status: 'valid',
      failure: null,
      planStepCount: 9,
      stepsWithoutExecutionEffects: 0,
      expectedStateChainClosed: true,
      milestones: [],
      finalExpectedState: null,
      selectedBuildListEntryIds: [],
      rejectedBuildListEntries: [],
      terminationStatus: 'exhausted',
      terminationReachedLimits: [],
    },
    schedulerDrops: null,
    schedulerProvisionalOutcomes: null,
  }
  const merged = { ...base, ...overrides }
  const completed = merged.completedTargetIds.length
  return {
    ...merged,
    termination: { ...merged.termination, completedTargetCount: completed, ...overrides.termination },
  }
}

function completedSummary(
  strategy: 'beam' | 'scheduler',
  completedTargetIds: string[],
  extra: Partial<PlannerStrategyRunSummary> = {},
) {
  return summary({
    strategy,
    completedTargetIds: completedTargetIds.map(target),
    selectedBuildListEntryIds: completedTargetIds.map((id) => entry(`e${id.slice(1)}`)),
    schedulerDrops: strategy === 'scheduler' ? [] : null,
    ...extra,
  })
}

function provisionalDrop(loser: string, winner: string) {
  return {
    buildListEntryId: entry(loser),
    targetWeaponId: target(`t${loser.slice(1)}`),
    cause: 'provisional_outcome' as const,
    reason: 'conflict_not_committed' as const,
    actionType: 'reset_bonuses' as const,
    iteration: 0,
    winnerBuildListEntryId: entry(winner),
    conflictKind: 'same_gogma_counter' as const,
    conflictId: 'conflict.x',
  }
}

describe('parity classification', () => {
  it('reports parity when only the allowed differences differ', () => {
    const report = comparePlannerStrategyRuns(
      completedSummary('beam', ['t1', 't2'], { stepOrderHash: 'a', weaponSwitchCount: 4, expandedStates: 900 }),
      completedSummary('scheduler', ['t1', 't2'], { stepOrderHash: 'b', weaponSwitchCount: 1, expandedStates: 20 }),
    )
    expect(report.verdict).toBe('parity')
    expect(report.mandatory.passed).toBe(true)
    expect(report.allowedDifferences.stepOrderIdentical).toBe(false)
    expect(report.allowedDifferences.weaponSwitchCount).toEqual({ beam: 4, scheduler: 1 })
  })

  it('never compares the whole result: Beam-only conflicts and rejection mapping differences are allowed', () => {
    const beam = completedSummary('beam', ['t1'], {
      conflicts: [{ id: 'conflict.branch', kind: 'same_gogma_counter', buildListEntryIds: [entry('e1'), entry('e2')], recommendedBuildListEntryId: null, selectedBuildListEntryId: null }],
      rejectedBuildListEntries: [{ buildListEntryId: entry('e2'), reason: 'dominated_by_better_candidate' }],
    })
    const scheduler = completedSummary('scheduler', ['t1'], {
      rejectedBuildListEntries: [{ buildListEntryId: entry('e2'), reason: 'resource_conflict' }],
    })
    const report = comparePlannerStrategyRuns(beam, scheduler)
    expect(report.verdict).toBe('parity')
    expect(report.conflicts.beamOnly).toEqual(['conflict.branch'])
    expect(report.allowedDifferences.rejectedBuildListEntriesIdentical).toBe(false)
  })

  it('does not allow a scheduler-only conflict automatically', () => {
    const report = comparePlannerStrategyRuns(
      completedSummary('beam', ['t1']),
      completedSummary('scheduler', ['t1'], {
        conflicts: [{ id: 'conflict.new', kind: 'same_skill_counter', buildListEntryIds: [entry('e1'), entry('e3')], recommendedBuildListEntryId: entry('e1'), selectedBuildListEntryId: null }],
      }),
    )
    expect(report.verdict).toBe('needs_review')
    expect(report.conflicts.schedulerOnly).toEqual(['conflict.new'])
    expect(report.reviewItems).toHaveLength(1)
  })

  it.each([
    ['trace_replay_invalid', { replay: { isValid: false, issueCodes: ['final_state_mismatch'], issues: [{ code: 'final_state_mismatch', message: 'x', actionIndex: null }], unsupportedInput: null, draftCount: 0 } }],
    ['projection_failed', { projection: { ...completedSummary('scheduler', []).projection, status: 'failed' as const, failure: 'boom' } }],
    ['projection_missing_execution_effects', { projection: { ...completedSummary('scheduler', []).projection, stepsWithoutExecutionEffects: 2 } }],
    ['expected_state_chain_broken', { projection: { ...completedSummary('scheduler', []).projection, expectedStateChainClosed: false } }],
    ['termination_inconsistent', { termination: { status: 'completed' as const, reachedLimits: [], expandedStates: 10, completedTargetCount: 0, totalTargetCount: 3 } }],
    ['planning_targets_differ', { planningTargetIds: [target('t1')] }],
  ] as const)('reports %s as a mandatory violation', (code, override) => {
    const report = comparePlannerStrategyRuns(
      completedSummary('beam', []),
      completedSummary('scheduler', [], override as Partial<PlannerStrategyRunSummary>),
    )
    expect(report.verdict).toBe('mandatory_violation')
    expect(report.mandatory.violations.map(({ code: found }) => found)).toContain(code)
  })

  it('reports a Target completed without its required checkpoint Entry', () => {
    const report = comparePlannerStrategyRuns(
      completedSummary('beam', []),
      completedSummary('scheduler', ['t1'], {
        requiredCheckpointEntryIds: [entry('e1')],
        selectedBuildListEntryIds: [entry('e9')],
      }),
    )
    expect(report.mandatory.violations.map(({ code }) => code)).toContain('required_checkpoint_not_secured')
  })

  it('reports a different milestone for a checkpoint both reached', () => {
    const milestone = (bonus: string) => ({
      ...completedSummary('beam', []).projection,
      milestones: [{ buildListEntryId: entry('e1'), skillOpportunityId: null, bonusOpportunityId: bonus }],
    })
    const report = comparePlannerStrategyRuns(
      completedSummary('beam', ['t1'], { projection: milestone('opportunity.a') }),
      completedSummary('scheduler', ['t1'], { projection: milestone('opportunity.b') }),
    )
    expect(report.mandatory.violations.map(({ code }) => code)).toContain('checkpoint_milestone_differs')
  })

  it('requires the same fail-closed input validation', () => {
    const failed = (strategy: 'beam' | 'scheduler', code: string) =>
      summary({
        strategy,
        hasBestState: false,
        validationIssues: [{ path: 'buildListEntries', code }],
        warningKinds: ['duplicate_build_list_entries_for_target'],
      })
    expect(comparePlannerStrategyRuns(failed('beam', 'invalid_state'), failed('scheduler', 'invalid_state')).verdict)
      .toBe('parity')
    expect(
      comparePlannerStrategyRuns(failed('beam', 'invalid_state'), failed('scheduler', 'invalid_reference'))
        .mandatory.violations.map(({ code }) => code),
    ).toContain('input_validation_differs')
  })

  it('classifies a priority trade-off as the expected provisional outcome (B)', () => {
    // The scheduler kept e2 (priority 5) over e1; the Beam Search completed t1
    // and t3 but not t2.
    const report = comparePlannerStrategyRuns(
      completedSummary('beam', ['t1', 't3']),
      completedSummary('scheduler', ['t2'], { schedulerDrops: [provisionalDrop('e1', 'e2')] }),
    )
    expect(report.verdict).toBe('completion_regression')
    expect(report.completion.beamOnlyCompletedTargetIds).toEqual(['t1', 't3'])
    const t1 = report.completion.losses.find(({ targetWeaponId }) => targetWeaponId === 't1')!
    expect(t1).toMatchObject({
      suspectedCategory: 'provisional_priority_outcome',
      assessment: 'expected_semantic_difference',
      priority: 3,
      provisionalWinnerBuildListEntryIds: ['e2'],
      provisionalWinnerTargetIds: ['t2'],
      provisionalWinnerTargetsCompletedByBeam: false,
    })
    // t3 was never dropped by anything recorded: not allowed by default.
    const t3 = report.completion.losses.find(({ targetWeaponId }) => targetWeaponId === 't3')!
    expect(t3).toMatchObject({ suspectedCategory: 'unexplained', assessment: 'undetermined' })
    expect(report.completion.regressionExplained).toBe(false)
    expect(report.completion.regressionAcceptable).toBe(false)
  })

  it('assesses a combination the Beam Search found (A) as an unexpected regression when the Beam completed a superset', () => {
    const report = comparePlannerStrategyRuns(
      completedSummary('beam', ['t1', 't2', 't3']),
      completedSummary('scheduler', ['t2', 't3'], { schedulerDrops: [provisionalDrop('e1', 'e2')] }),
    )
    expect(report.completion.losses).toEqual([
      expect.objectContaining({
        targetWeaponId: 't1',
        suspectedCategory: 'beam_branch_combination',
        assessment: 'unexpected_regression',
      }),
    ])
    expect(report.completion.beamCompletedSuperset).toBe(true)
  })

  it('assesses a combination the Beam Search found (A) as a known limitation when the scheduler completed another Target', () => {
    const report = comparePlannerStrategyRuns(
      completedSummary('beam', ['t1', 't2']),
      completedSummary('scheduler', ['t2', 't3'], { schedulerDrops: [provisionalDrop('e1', 'e2')] }),
    )
    // Equal counts are no regression; one more Beam-only Target is.
    expect(report.completion.regression).toBe(false)
    const regression = comparePlannerStrategyRuns(
      completedSummary('beam', ['t1', 't2', 't4']),
      completedSummary('scheduler', ['t2', 't3'], { schedulerDrops: [provisionalDrop('e1', 'e2')] }),
    )
    expect(regression.completion.beamCompletedSuperset).toBe(false)
    expect(regression.completion.losses).toEqual(expect.arrayContaining([
      expect.objectContaining({
        targetWeaponId: 't1',
        suspectedCategory: 'beam_branch_combination',
        assessment: 'known_limitation',
      }),
    ]))
  })

  it('reports a deadlock drop the Beam Search avoided as an unexpected regression (C)', () => {
    const report = comparePlannerStrategyRuns(
      completedSummary('beam', ['t1', 't2']),
      completedSummary('scheduler', ['t1'], {
        schedulerDrops: [{ ...provisionalDrop('e2', 'e1'), cause: 'deadlock', winnerBuildListEntryId: null, conflictKind: null, conflictId: null }],
      }),
    )
    expect(report.completion.losses).toEqual([
      expect.objectContaining({ suspectedCategory: 'deadlock_or_stall', assessment: 'unexpected_regression', deadlockOrStall: true }),
    ])
    expect(report.completion.regressionExplained).toBe(true)
    expect(report.completion.regressionAcceptable).toBe(false)
  })

  it('attributes a loss on a legacy-duplicate input to the fixture (E)', () => {
    const report = comparePlannerStrategyRuns(
      completedSummary('beam', ['t1', 't2']),
      completedSummary('scheduler', ['t1'], { buildListCardinalityValid: false }),
    )
    expect(report.completion.losses[0]).toMatchObject({ suspectedCategory: 'fixture_cardinality' })
  })

  it('renders a text report', () => {
    const report = comparePlannerStrategyRuns(
      completedSummary('beam', ['t1', 't2']),
      completedSummary('scheduler', ['t1'], { schedulerDrops: [provisionalDrop('e2', 'e1')] }),
    )
    const text = formatPlannerSchedulerParityReport(report)
    expect(text).toContain('parity verdict: completion_regression')
    expect(text).toContain('completed Targets: Beam 2 / scheduler 1 / total 3')
    expect(text).toContain('t2 (priority 5)')
  })
})

/** Scenarios the Node suite compares in this file (both searches finish quickly). */
const FAST_SCENARIOS = new Set([
  'E-shared-physical-action',
  'F-transient-collision',
  'F-transient-executor',
  'G-bonus-first',
  'G-skill-first',
  'G-planner',
  'G-preferred-lane-waits',
  'H-checkpoint-pin',
  'H-checkpoint-lanes',
  'I-not-preferred-source',
  'J-same-owned-weapon',
  'K-predicted-forge',
  'K-blind-waits',
  'K-blind-unconfirmed',
  'M-temporary-replacement',
  'zero-operation',
  'deadlock',
  'true-deadlock',
  'cross-satisfaction',
  'dynamic-commitment',
  'committed-only-sharing',
  'pinned-past',
  'pinned-past-lost-holding',
  'exact-bounds-expanded',
  'bounded-max-plan-steps',
  'bounded-max-expanded-states',
  'malformed-legacy-duplicate',
  'empty-build-list',
])

describe('acceptance scenarios: fast Beam / scheduler parity', { timeout: 60_000 }, () => {
  it('covers the whole catalogue between this file and the long one', () => {
    const ids = plannerSchedulerCatalogue().map(({ id }) => id)
    const long = ids.filter((id) => !FAST_SCENARIOS.has(id))
    expect(long.sort()).toEqual([
      'A-independent-lanes',
      'B-one-gogma-stream',
      'C-required-and-skippable',
      'D-equal-priority',
      'D-unresolved-conflict',
      'L-explicit-resolution',
      'exact-bounds-steps',
    ])
  })

  it.each([...FAST_SCENARIOS])(
    '%s keeps every mandatory contract without a completion regression',
    async (id) => {
      const run = await runCatalogueParity(id)
      expect(mandatoryParityProblems(run)).toEqual([])
      expect(run.report.completion.regression).toBe(false)
      expect(run.report.verdict).toBe('parity')
    },
  )

  it('scheduler-completed Targets are a superset of the Beam Search where the Beam is truncated', async () => {
    const run = await runCatalogueParity('exact-bounds-expanded')
    expect(run.beam.termination.status).toBe('incomplete')
    expect(run.scheduler.termination.status).toBe('completed')
    expect(run.report.completion.schedulerOnlyCompletedTargetIds).toEqual(['target.a', 'target.b'])
  })

  /**
   * Phase D-2a: a Beam Search truncated by its own `maxExpandedStates` goes
   * through the shared Plan-generation tail with its own termination. Nothing
   * turns it into a Production termination - no `max_plan_steps` stands in for
   * it, and no `incomplete` with empty `reachedLimits` is produced.
   */
  it.each(['bounded-max-expanded-states', 'exact-bounds-expanded'])(
    '%s keeps the Beam Search max_expanded_states truncation through the projection',
    async (id) => {
      const run = await runCatalogueParity(id)
      expect(run.beam.termination).toMatchObject({
        status: 'incomplete',
        reachedLimits: ['max_expanded_states'],
      })
      expect(run.beam.projection.status).toBe('valid')
      expect(run.beam.projection.terminationStatus).toBe('incomplete')
      expect(run.beam.projection.terminationReachedLimits).toEqual(['max_expanded_states'])
      // The scheduler never sees the oracle bound.
      expect(run.scheduler.termination.reachedLimits).not.toContain('max_expanded_states')
      expect(mandatoryParityProblems(run)).toEqual([])
    },
  )

  it('keeps the shared max_plan_steps truncation as max_plan_steps for both strategies', async () => {
    const run = await runCatalogueParity('bounded-max-plan-steps')
    expect(run.beam.termination).toMatchObject({ status: 'incomplete', reachedLimits: ['max_plan_steps'] })
    expect(run.scheduler.termination).toMatchObject({ status: 'incomplete', reachedLimits: ['max_plan_steps'] })
    expect(run.beam.projection.terminationReachedLimits).toEqual(['max_plan_steps'])
    expect(run.scheduler.projection.terminationReachedLimits).toEqual(['max_plan_steps'])
  })

  it('fails both searches closed on the same malformed input', async () => {
    const run = await runCatalogueParity('malformed-legacy-duplicate')
    expect(run.beam.hasBestState).toBe(false)
    expect(run.scheduler.hasBestState).toBe(false)
    expect(run.scheduler.warningKinds).toContain('duplicate_build_list_entries_for_target')
    expect(run.scheduler.buildListCardinalityValid).toBe(false)
  })

  it('records the scheduler rejection mapping next to the Beam Search one', async () => {
    const run = await runCatalogueParity('cross-satisfaction')
    expect(run.scheduler.rejectionReasonCounts).toEqual({ candidate_already_satisfied: 1 })
    expect(run.scheduler.rejectedBuildListEntries).toEqual([
      { buildListEntryId: 'entry.b', reason: 'already_satisfied' },
    ])
    const conflict = await runCatalogueParity('J-same-owned-weapon')
    expect(conflict.scheduler.rejectedBuildListEntries).toEqual([
      { buildListEntryId: 'entry.b', reason: 'resource_conflict' },
    ])
  })

  /**
   * Phase B finding (`docs/ISSUE_103_SCHEDULER_PARITY_BENCHMARK.md`): the
   * former design 7.8 deadlock example is not a deadlock. X converts at the
   * Skill position of Y's pin-blocked, skippable Reset Skills, Y's Skill
   * progress waits at its pin, and that unit is fast-forwarded once the pin is
   * released. Since the semantic fix (holding = `canSkipWhenCounterPassed`
   * false only) the scheduler does exactly what the Beam Search does.
   */
  it('deadlock (former 7.8 example): the scheduler completes both Targets like the Beam Search', async () => {
    const run = await runCatalogueParity('deadlock')
    expect(mandatoryParityProblems(run)).toEqual([])
    expect(run.report.verdict).toBe('parity')
    expect(run.report.completion).toMatchObject({
      beamCompletedTargetIds: ['target.x', 'target.y'],
      schedulerCompletedTargetIds: ['target.x', 'target.y'],
      regression: false,
    })
    expect(run.scheduler.schedulerDrops).toEqual([])
    expect(run.beam.replay?.isValid).toBe(true)
    expect(run.scheduler.replay?.isValid).toBe(true)
    expect(run.beam.projection.status).toBe('valid')
    expect(run.scheduler.projection.status).toBe('valid')
  })

  it('true-deadlock: both searches lose the same Target and the scheduler drops it as a deadlock', async () => {
    const run = await runCatalogueParity('true-deadlock')
    expect(mandatoryParityProblems(run)).toEqual([])
    expect(run.report.completion).toMatchObject({
      beamCompletedTargetIds: ['target.x', 'target.z'],
      schedulerCompletedTargetIds: ['target.x', 'target.z'],
      regression: false,
    })
    expect(run.scheduler.schedulerDrops).toEqual([
      expect.objectContaining({ buildListEntryId: 'entry.y', cause: 'deadlock' }),
    ])
  })
})

describe('sanity-3 Beam / scheduler parity', { timeout: 60_000 }, () => {
  it('completes every Target with both searches and keeps every mandatory contract', async () => {
    const { input, beamSearchInput, engine } = createPlannerSearchInstrumentationInput('sanity-3')
    const run = await runPlannerSchedulerParity(input, {
      engine,
      createDependencies: () => createDeterministicPlannerDependencies(engine),
      // The workload's own Beam Search oracle bounds; the scheduler gets none.
      beamSearchOptions: beamSearchInput.options,
    })
    expect(mandatoryParityProblems(run)).toEqual([])
    expect(run.report.verdict).toBe('parity')
    expect(run.report.completion).toMatchObject({ beamCompletedCount: 3, schedulerCompletedCount: 3, totalTargetCount: 3 })
    expect(run.beam.termination.status).toBe('completed')
    expect(run.scheduler.termination.status).toBe('completed')
    expect(run.scheduler.expandedStates).toBe(run.scheduler.traceLength)
    expect(run.scheduler.projection).toMatchObject({ status: 'valid', expectedStateChainClosed: true })
    expect(structuredClone(run.report)).toEqual(run.report)
  })
})
