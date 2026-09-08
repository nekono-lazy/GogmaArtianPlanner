import { describe, expect, it } from 'vitest'
import type { BuildListEntryId, TargetWeaponId } from '../domain/models/publicTypes'
import type { PlannerWhatIfCalculationResult, PlannerWhatIfDistance, PlannerWhatIfOutcome } from '../domain/planner'
import { createPlannerWhatIfBenchmarkOutcome } from './plannerWhatIfBenchmarkOutcome'

const distance: PlannerWhatIfDistance = { estimatedOperationCount: 4, estimatedGogmaAdvance: 1, estimatedSkillAdvance: 2, estimatedNormalAdvance: null }
function completed(slots: PlannerWhatIfOutcome[]): Extract<PlannerWhatIfCalculationResult, { status: 'completed' }> {
  return { status: 'completed', comparison: {
    conflictKey: 'fixture-conflict', fixedTargetWeaponId: 'fixed' as TargetWeaponId,
    fixedBuildListEntryId: 'fixed-entry' as BuildListEntryId,
    alternatives: slots.map((slot, index) => ({ targetWeaponId: `target-${index}` as TargetWeaponId,
      practical: slot, ideal: { status: 'not_found_within_search_extent' } })),
  } }
}

describe('B9 benchmark semantic normalization', () => {
  it('records every typed status and derives diagnostics from slots', () => {
    const result = createPlannerWhatIfBenchmarkOutcome(completed([
      { status: 'found', distance },
      { status: 'stopped_by_candidate_trial_bound' },
      { status: 'stopped_by_planner_rerun_bound' },
      { status: 'stopped_by_enumeration_bound' },
      { status: 'not_found_within_search_extent' },
    ]))
    expect(result.counts).toEqual({ found: 1, candidateTrialBound: 1, plannerRerunBound: 1, enumerationBound: 1, notFound: 6 })
    expect(result.candidateTrialBoundReached).toBe(true)
    expect(result.plannerRerunBoundReached).toBe(true)
    expect(result.enumerationBoundReached).toBe(true)
    expect(JSON.parse(result.outcomeKey)).toEqual(result.semantic)
  })

  it('ignores warning/message/timing metadata and object insertion order', () => {
    const result = completed([{ status: 'found', distance }])
    const reordered = completed([{ status: 'found', distance: {
      estimatedNormalAdvance: null, estimatedSkillAdvance: 2,
      estimatedGogmaAdvance: 1, estimatedOperationCount: 4,
    } }])
    const withDiagnostics = { ...result, warnings: [{ kind: 'max_planner_reruns_reached' }], message: 'different', roundTripMs: 999 }
    expect(createPlannerWhatIfBenchmarkOutcome(withDiagnostics).outcomeKey).toBe(createPlannerWhatIfBenchmarkOutcome(reordered).outcomeKey)
    expect(createPlannerWhatIfBenchmarkOutcome(withDiagnostics).plannerRerunBoundReached).toBe(false)
  })

  it.each(['estimatedOperationCount', 'estimatedGogmaAdvance', 'estimatedSkillAdvance', 'estimatedNormalAdvance'] as const)('preserves distance field %s including null versus zero', (field) => {
    const first = createPlannerWhatIfBenchmarkOutcome(completed([{ status: 'found', distance }]))
    const second = createPlannerWhatIfBenchmarkOutcome(completed([{ status: 'found', distance: { ...distance, [field]: 0 } }]))
    expect(second.outcomeKey).not.toBe(first.outcomeKey)
  })

  it('preserves alternative order and keeps Practical and Ideal distinct', () => {
    const result = completed([{ status: 'found', distance }, { status: 'stopped_by_planner_rerun_bound' }])
    if (result.status !== 'completed') throw new Error('test invariant')
    const before = structuredClone(result)
    const reversed = structuredClone(result)
    reversed.comparison.alternatives.reverse()
    expect(createPlannerWhatIfBenchmarkOutcome(reversed).outcomeKey).not.toBe(createPlannerWhatIfBenchmarkOutcome(result).outcomeKey)
    const swapped = structuredClone(result)
    const target = swapped.comparison.alternatives[0]
    ;[target.practical, target.ideal] = [target.ideal, target.practical]
    expect(createPlannerWhatIfBenchmarkOutcome(swapped).outcomeKey).not.toBe(createPlannerWhatIfBenchmarkOutcome(result).outcomeKey)
    expect(result).toEqual(before)
  })

  it('records typed failure reason without using detail/message or Planner warnings', () => {
    const failure: PlannerWhatIfCalculationResult = { status: 'invalid_fixed_resolution',
      reason: 'scenario_constraint_missing', conflictKey: 'fixture',
      selectedBuildListEntryId: 'fixed-entry' as BuildListEntryId, detail: 'text 1' }
    const one = createPlannerWhatIfBenchmarkOutcome(failure)
    expect(one.outcomeKey).toBe(createPlannerWhatIfBenchmarkOutcome({ ...failure, detail: 'text 2' }).outcomeKey)
    expect(one.outcomeKey).not.toBe(createPlannerWhatIfBenchmarkOutcome({ ...failure, reason: 'fixed_constraints_unresolved' }).outcomeKey)
    expect(one.semantic).toMatchObject({ status: 'invalid_fixed_resolution', reason: 'scenario_constraint_missing' })
    const notReady = createPlannerWhatIfBenchmarkOutcome({ status: 'planner_input_not_ready', issues: [], warnings: [], excludedBuildListEntries: [] })
    expect(notReady.semantic).toEqual({ status: 'planner_input_not_ready' })
    expect(notReady.counts.found).toBe(0)
    expect(notReady.plannerRerunBoundReached).toBe(false)
  })
})
