import { describe, expect, it } from 'vitest'
import type {
  BuildListEntryId,
  PlanConflict,
  ProductionPlan,
  RejectedBuildListEntry,
} from '../../models/publicTypes'
import type { PlannerResult } from '../plannerTypes'
import {
  assertPlannerAlternativeTrialBounds,
  createPlannerAlternativeFullRunBudget,
  judgePlannerAlternativeTrial,
  PlannerAlternativeRerunLimitError,
  PlannerAlternativeTrialBoundsError,
  type PlannerAlternativeTrialJudgeContext,
} from './plannerAlternativeTrial'

/*
 * PLANNER_SPEC 9.2.19.6 found judgement over synthetic trial results: only the
 * fields the judgement reads are filled in.
 */

const G = 'build-list.trial.g' as BuildListEntryId
const FIXED = 'build-list.trial.fixed' as BuildListEntryId
const PRIOR = 'build-list.trial.prior' as BuildListEntryId
const C = 'build-list.trial.c' as BuildListEntryId

const context: PlannerAlternativeTrialJudgeContext = {
  generatedBuildListEntryId: G,
  explicitDecisionBuildListEntryIds: [FIXED],
  fixedRouteBuildListEntryIds: [FIXED, PRIOR],
  initialConflictIds: ['conflict.initial.g-c', 'conflict.initial.g-fixed'],
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
  rejected?: RejectedBuildListEntry[]
  conflicts?: PlanConflict[]
}): PlannerResult {
  return {
    plan: options.plan === false ? null : {
      selectedBuildListEntryIds: options.selected ?? [],
      rejectedBuildListEntries: options.rejected ?? [],
    } as unknown as ProductionPlan,
    conflicts: options.conflicts ?? [],
    warnings: [],
    termination: { status: 'completed' } as PlannerResult['termination'],
  }
}

const resourceConflict = (buildListEntryId: BuildListEntryId): RejectedBuildListEntry => ({
  buildListEntryId,
  reason: 'resource_conflict',
  detail: 'fixture',
})

describe('judgePlannerAlternativeTrial (PLANNER_SPEC 9.2.19.6)', () => {
  it('finds G selected beside every explicit decision Entry', () => {
    expect(judgePlannerAlternativeTrial(result({ selected: [FIXED, G] }), context))
      .toEqual({ status: 'found', generatedSelected: true })
  })

  it('finds G that lost only a provisional outcome to an Entry outside the fixed Route set', () => {
    const verdict = judgePlannerAlternativeTrial(result({
      selected: [FIXED, C],
      rejected: [resourceConflict(G)],
      conflicts: [conflict('conflict.initial.g-c', [C, G])],
    }), context)
    expect(verdict).toEqual({ status: 'found', generatedSelected: false })
  })

  it('does not require a completed run', () => {
    const partial = result({ selected: [FIXED, G] })
    partial.termination = { status: 'incomplete' } as PlannerResult['termination']
    expect(judgePlannerAlternativeTrial(partial, context).status).toBe('found')
  })

  it('rejects a trial without a Plan', () => {
    expect(judgePlannerAlternativeTrial(result({ plan: false }), context))
      .toEqual({ status: 'rejected', reason: 'no_plan' })
  })

  it('rejects a trial whose Plan drops an explicit decision Entry', () => {
    expect(judgePlannerAlternativeTrial(result({ selected: [G] }), context))
      .toEqual({ status: 'rejected', reason: 'explicit_decision_not_selected' })
  })

  it('does not require a repair-lineage fixed Entry to stay selected, but G must not conflict with it', () => {
    expect(judgePlannerAlternativeTrial(result({ selected: [FIXED, G] }), context).status).toBe('found')
    expect(judgePlannerAlternativeTrial(result({
      selected: [FIXED, G],
      conflicts: [conflict('conflict.dynamic.g-prior', [G, PRIOR])],
    }), context)).toEqual({ status: 'rejected', reason: 'conflicts_with_fixed_route' })
  })

  it('rejects G in any conflict with a fixed Route Entry, resolved or not, even when G is selected', () => {
    expect(judgePlannerAlternativeTrial(result({
      selected: [FIXED, G],
      conflicts: [conflict('conflict.initial.g-fixed', [FIXED, G], FIXED)],
    }), context)).toEqual({ status: 'rejected', reason: 'conflicts_with_fixed_route' })
  })

  it('rejects G that lost a provisional outcome to a fixed Route Entry', () => {
    expect(judgePlannerAlternativeTrial(result({
      selected: [FIXED],
      rejected: [resourceConflict(G)],
      conflicts: [conflict('conflict.initial.g-fixed', [FIXED, G])],
    }), context)).toEqual({ status: 'rejected', reason: 'conflicts_with_fixed_route' })
  })

  it('rejects a stall / deadlock drop: resource_conflict with no selected partner in an unresolved initial conflict', () => {
    // The partner C was dropped too, so no provisional outcome adopted it.
    expect(judgePlannerAlternativeTrial(result({
      selected: [FIXED],
      rejected: [resourceConflict(G)],
      conflicts: [conflict('conflict.initial.g-c', [C, G])],
    }), context)).toEqual({ status: 'rejected', reason: 'not_selected' })
    // A conflict that appeared only after scheduling started is no provisional outcome.
    expect(judgePlannerAlternativeTrial(result({
      selected: [FIXED, C],
      rejected: [resourceConflict(G)],
      conflicts: [conflict('conflict.dynamic.g-c', [C, G])],
    }), context)).toEqual({ status: 'rejected', reason: 'not_selected' })
  })

  it('rejects G not selected for a non-resource reason or with no record at all', () => {
    for (const reason of ['requires_protected_weapon', 'longer_route', 'dominated_by_better_candidate', 'already_satisfied'] as const) {
      expect(judgePlannerAlternativeTrial(result({
        selected: [FIXED, C],
        rejected: [{ buildListEntryId: G, reason, detail: 'fixture' }],
        conflicts: [conflict('conflict.initial.g-c', [C, G])],
      }), context)).toEqual({ status: 'rejected', reason: 'not_selected' })
    }
    expect(judgePlannerAlternativeTrial(result({
      selected: [FIXED, C],
      conflicts: [conflict('conflict.initial.g-c', [C, G])],
    }), context)).toEqual({ status: 'rejected', reason: 'not_selected' })
  })

  it('rejects G whose unresolved conflict was settled by an explicit resolution for another Entry', () => {
    expect(judgePlannerAlternativeTrial(result({
      selected: [FIXED, C],
      rejected: [resourceConflict(G)],
      conflicts: [conflict('conflict.initial.g-c', [C, G], C)],
    }), context)).toEqual({ status: 'rejected', reason: 'not_selected' })
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
