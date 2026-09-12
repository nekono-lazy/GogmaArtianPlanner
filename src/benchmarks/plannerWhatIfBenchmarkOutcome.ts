import type {
  PlannerWhatIfCalculationResult,
  PlannerWhatIfOutcome,
} from '../domain/planner'

function normalizeSlot(slot: PlannerWhatIfOutcome): PlannerWhatIfOutcome {
  if (slot.status !== 'found') return { status: slot.status }
  return {
    status: slot.status,
    distance: {
      estimatedOperationCount: slot.distance.estimatedOperationCount,
      estimatedGogmaAdvance: slot.distance.estimatedGogmaAdvance,
      estimatedSkillAdvance: slot.distance.estimatedSkillAdvance,
      estimatedNormalAdvance: slot.distance.estimatedNormalAdvance,
    },
  }
}

/** Explicit allowlist: message text, warnings, timing and progress are not semantic authority. */
function semanticResult(result: PlannerWhatIfCalculationResult) {
  switch (result.status) {
    case 'completed':
      return {
        status: result.status,
        fixedTargetWeaponId: result.comparison.fixedTargetWeaponId,
        fixedBuildListEntryId: result.comparison.fixedBuildListEntryId,
        // Domain stable order is meaningful. Never sort alternatives here.
        alternatives: result.comparison.alternatives.map((alternative) => ({
          targetWeaponId: alternative.targetWeaponId,
          outcome: normalizeSlot(alternative.outcome),
        })),
      }
    case 'invalid_fixed_resolution':
      return { status: result.status, reason: result.reason,
        conflictKey: result.conflictKey, selectedBuildListEntryId: result.selectedBuildListEntryId }
    case 'planner_input_not_ready':
      return { status: result.status }
  }
}

/** Benchmark-only parity key, never used by Production to make a decision. */
export function createPlannerWhatIfBenchmarkOutcome(result: PlannerWhatIfCalculationResult) {
  const semantic = semanticResult(result)
  const slots = result.status === 'completed'
    ? result.comparison.alternatives.map(({ outcome }) => outcome) : []
  const count = (status: PlannerWhatIfOutcome['status']) => slots.filter((slot) => slot.status === status).length
  const counts = {
    found: count('found'),
    candidateTrialBound: count('stopped_by_candidate_trial_bound'),
    plannerRerunBound: count('stopped_by_planner_rerun_bound'),
    enumerationBound: count('stopped_by_enumeration_bound'),
    notFound: count('not_found_within_search_extent'),
  }
  return {
    semantic,
    // Canonical explicit field order; collision-free serialized semantic value.
    outcomeKey: JSON.stringify(semantic),
    counts,
    candidateTrialBoundReached: counts.candidateTrialBound > 0,
    plannerRerunBoundReached: counts.plannerRerunBound > 0,
    enumerationBoundReached: counts.enumerationBound > 0,
  }
}

export type PlannerWhatIfBenchmarkOutcome = ReturnType<typeof createPlannerWhatIfBenchmarkOutcome>
