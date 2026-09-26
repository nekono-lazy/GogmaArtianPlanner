import { describe, expect, it } from 'vitest'
import type {
  BuildListEntryId,
  PlanConflict,
  ProductionPlan,
} from '../../models/publicTypes'
import type {
  PlannerResult,
  PlannerRouteCommitmentEntryEvidence,
  PlannerRouteCommitmentEvidence,
} from '../plannerTypes'
import {
  assertPlannerAlternativeTrialBounds,
  createPlannerAlternativeFullRunBudget,
  judgePlannerAlternativeTrial,
  PlannerAlternativeRerunLimitError,
  PlannerAlternativeTrialBoundsError,
  type PlannerAlternativeTrialJudgeContext,
} from './plannerAlternativeTrial'

/*
 * PLANNER_SPEC 9.2.19.6 found judgement over synthetic trial results and
 * synthetic route commitment evidence: only the fields the judgement reads are
 * filled in. The real scheduler evidence is exercised by the kernel tests.
 */

const G = 'build-list.trial.g' as BuildListEntryId
const FIXED = 'build-list.trial.fixed' as BuildListEntryId
const PRIOR = 'build-list.trial.prior' as BuildListEntryId
const C = 'build-list.trial.c' as BuildListEntryId

function context(routeCommitment: PlannerRouteCommitmentEvidence | null = null): PlannerAlternativeTrialJudgeContext {
  return {
    generatedBuildListEntryId: G,
    explicitDecisionBuildListEntryIds: [FIXED],
    fixedRouteBuildListEntryIds: [FIXED, PRIOR],
    routeCommitment,
  }
}

function conflict(
  id: string,
  buildListEntryIds: BuildListEntryId[],
  selectedBuildListEntryId: BuildListEntryId | null = null,
): PlanConflict {
  return {
    id,
    kind: 'same_gogma_counter',
    buildListEntryIds,
    targetWeaponIds: [],
    reason: 'fixture',
    recommendedBuildListEntryId: null,
    selectedBuildListEntryId,
  } as unknown as PlanConflict
}

function result(options: {
  plan?: boolean
  selected?: BuildListEntryId[]
  conflicts?: PlanConflict[]
}): PlannerResult {
  return {
    plan: options.plan === false ? null : {
      selectedBuildListEntryIds: options.selected ?? [],
      rejectedBuildListEntries: [],
    } as unknown as ProductionPlan,
    conflicts: options.conflicts ?? [],
    warnings: [],
    termination: { status: 'completed' } as PlannerResult['termination'],
  }
}

function entry(
  buildListEntryId: BuildListEntryId,
  status: PlannerRouteCommitmentEntryEvidence['status'],
  provisionalWinner: BuildListEntryId | null = null,
  rejectionReasons: PlannerRouteCommitmentEntryEvidence['rejectionReasons'] = status === 'dropped' ? ['conflict_not_committed'] : [],
): PlannerRouteCommitmentEntryEvidence {
  return {
    buildListEntryId,
    status,
    provisionalOutcome: provisionalWinner === null
      ? null
      : { conflictId: 'conflict.collision', selectedBuildListEntryId: provisionalWinner },
    rejectionReasons,
  }
}

function evidence(...entries: PlannerRouteCommitmentEntryEvidence[]): PlannerRouteCommitmentEvidence {
  const losers = entries.filter(({ provisionalOutcome }) => provisionalOutcome !== null)
  return {
    provisionalOutcomes: losers.map(({ buildListEntryId, provisionalOutcome }) => ({
      conflictId: provisionalOutcome!.conflictId,
      selectedBuildListEntryId: provisionalOutcome!.selectedBuildListEntryId,
      rejectedBuildListEntryIds: [buildListEntryId],
    })),
    entries,
  }
}

describe('judgePlannerAlternativeTrial (PLANNER_SPEC 9.2.19.6)', () => {
  it('finds G selected beside every explicit decision Entry', () => {
    expect(judgePlannerAlternativeTrial(result({ selected: [FIXED, G] }), context()))
      .toEqual({ status: 'found', generatedSelected: true })
  })

  it('finds G that lost a provisional outcome to an unfixed C that stays selected', () => {
    const verdict = judgePlannerAlternativeTrial(
      result({ selected: [FIXED, C], conflicts: [conflict('conflict.g-c', [C, G])] }),
      context(evidence(entry(FIXED, 'secured'), entry(C, 'secured'), entry(G, 'dropped', C))),
    )
    expect(verdict).toEqual({ status: 'found', generatedSelected: false })
  })

  it('finds G that lost a provisional outcome to an unfixed C that later stalled: the winner surviving is not required', () => {
    // C won the provisional outcome, then was dropped by a stall; G is never committed again.
    const verdict = judgePlannerAlternativeTrial(
      result({ selected: [FIXED], conflicts: [conflict('conflict.g-c', [C, G])] }),
      context(evidence(entry(FIXED, 'secured'), entry(C, 'dropped'), entry(G, 'dropped', C))),
    )
    expect(verdict).toEqual({ status: 'found', generatedSelected: false })
  })

  it('rejects G that won the provisional outcome and then stalled itself', () => {
    // Same Plan record as the case above; only the commitment evidence differs.
    const verdict = judgePlannerAlternativeTrial(
      result({ selected: [FIXED], conflicts: [conflict('conflict.g-c', [C, G])] }),
      context(evidence(entry(FIXED, 'secured'), entry(C, 'dropped', G), entry(G, 'dropped'))),
    )
    expect(verdict).toEqual({ status: 'rejected', reason: 'not_selected' })
  })

  it('rejects G with any drop reason besides the provisional outcome', () => {
    for (const reasons of [
      ['conflict_not_committed', 'counter_before_current'],
      ['protected_destructive_use'],
      ['selected_checkpoint_not_reached'],
      ['inventory_precondition_failed'],
    ] as const) {
      expect(judgePlannerAlternativeTrial(
        result({ selected: [FIXED, C] }),
        context(evidence(entry(FIXED, 'secured'), entry(C, 'secured'), entry(G, 'dropped', C, [...reasons]))),
      )).toEqual({ status: 'rejected', reason: 'not_selected' })
    }
  })

  it('rejects G not selected without a provisional outcome, or without any commitment evidence', () => {
    expect(judgePlannerAlternativeTrial(
      result({ selected: [FIXED, C] }),
      context(evidence(entry(FIXED, 'secured'), entry(C, 'secured'), entry(G, 'dropped', null, ['conflict_resolution_not_selected']))),
    )).toEqual({ status: 'rejected', reason: 'not_selected' })
    expect(judgePlannerAlternativeTrial(result({ selected: [FIXED, C] }), context(null)))
      .toEqual({ status: 'rejected', reason: 'not_selected' })
    // G was never a searchable Entry of the run (validation exclusion).
    expect(judgePlannerAlternativeTrial(result({ selected: [FIXED] }), context(evidence(entry(FIXED, 'secured')))))
      .toEqual({ status: 'rejected', reason: 'not_selected' })
  })

  it('rejects G whose provisional winner is a fixed Route Entry', () => {
    expect(judgePlannerAlternativeTrial(
      result({ selected: [FIXED] }),
      context(evidence(entry(FIXED, 'secured'), entry(G, 'dropped', PRIOR))),
    )).toEqual({ status: 'rejected', reason: 'not_selected' })
    expect(judgePlannerAlternativeTrial(
      result({ selected: [FIXED], conflicts: [conflict('conflict.g-fixed', [FIXED, G])] }),
      context(evidence(entry(FIXED, 'secured'), entry(G, 'dropped', FIXED))),
    )).toEqual({ status: 'rejected', reason: 'conflicts_with_fixed_route' })
  })

  it('does not require completed', () => {
    const partial = result({ selected: [FIXED, G] })
    partial.termination = { status: 'incomplete' } as PlannerResult['termination']
    expect(judgePlannerAlternativeTrial(partial, context()).status).toBe('found')
  })

  it('rejects a trial without a Plan', () => {
    expect(judgePlannerAlternativeTrial(result({ plan: false }), context()))
      .toEqual({ status: 'rejected', reason: 'no_plan' })
  })

  it('rejects a trial whose Plan drops an explicit decision Entry', () => {
    expect(judgePlannerAlternativeTrial(result({ selected: [G] }), context()))
      .toEqual({ status: 'rejected', reason: 'explicit_decision_not_selected' })
  })

  it('does not require a repair-lineage fixed Entry to stay selected, but G must not conflict with it', () => {
    expect(judgePlannerAlternativeTrial(result({ selected: [FIXED, G] }), context()).status).toBe('found')
    expect(judgePlannerAlternativeTrial(result({
      selected: [FIXED, G],
      conflicts: [conflict('conflict.g-prior', [G, PRIOR])],
    }), context())).toEqual({ status: 'rejected', reason: 'conflicts_with_fixed_route' })
  })

  it('rejects G in any conflict with a fixed Route Entry, resolved or not, even when G is selected', () => {
    expect(judgePlannerAlternativeTrial(result({
      selected: [FIXED, G],
      conflicts: [conflict('conflict.g-fixed', [FIXED, G], FIXED)],
    }), context())).toEqual({ status: 'rejected', reason: 'conflicts_with_fixed_route' })
  })
})

describe('trial bounds and the full-run budget (PLANNER_SPEC 9.2.19.12)', () => {
  it.each([
    { maxCandidateTrialsPerTarget: 0, maxPlannerReruns: 1 },
    { maxCandidateTrialsPerTarget: 1, maxPlannerReruns: 1.5 },
    { maxCandidateTrialsPerTarget: Number.NaN, maxPlannerReruns: 1 },
    { maxCandidateTrialsPerTarget: 1, maxPlannerReruns: -1 },
  ])('fails closed on %o without repairing it', (bounds) => {
    expect(() => assertPlannerAlternativeTrialBounds(bounds)).toThrow(PlannerAlternativeTrialBoundsError)
  })

  it('counts every full run it allows and refuses the one beyond the limit', () => {
    const budget = createPlannerAlternativeFullRunBudget({ maxCandidateTrialsPerTarget: 1, maxPlannerReruns: 2 })
    budget.beforePlannerRun()
    expect(budget.exhausted).toBe(false)
    budget.beforePlannerRun()
    expect(budget.exhausted).toBe(true)
    expect(() => budget.beforePlannerRun()).toThrow(PlannerAlternativeRerunLimitError)
    expect(budget.used).toBe(2)
  })
})
