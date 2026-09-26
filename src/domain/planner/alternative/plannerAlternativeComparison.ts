import type {
  BuildListEntryId,
  BuildRoute,
  CandidateBonusAmendmentStep,
  CandidateConversionSkillStep,
  CandidateSkillAmendmentStep,
  ConflictKind,
  GroupSkillId,
  RestorationBonusScope,
  RestorationBonusSet,
  SeriesSkillId,
  TargetWeaponId,
} from '../../models/publicTypes'
import {
  normalizePlannerAlternativeExcludedRouteKeys,
  type PlannerAlternativeCandidate,
} from '../../search'
import type {
  PlannerAlternativeKernelTargetResult,
  PlannerAlternativeRouteExclusion,
} from './plannerAlternativeKernel'

/**
 * The typed comparison of `docs/PLANNER_SPEC.md` 9.2.19.13, shared by the
 * what-if (「比較する」) and the actual repair (「この候補を優先」): both are
 * projections of the one scenario calculation (`plannerAlternativeScenario.ts`),
 * so for the same request they carry the same meaning.
 */

/** The distance of one found alternative, from the Planner-start origin (9.2.4.1 / 9.2.19.13). */
export interface PlannerAlternativeDistance {
  /** The alternative Route's own operation units (held positions are not counted). */
  estimatedOperationCount: number
  estimatedGogmaAdvance: number
  estimatedSkillAdvance: number
  /** `null`: the Route represents no Normal Counter advance (blind). */
  estimatedNormalAdvance: number | null
}

/**
 * A presentation-neutral description of a found alternative Route
 * (9.2.19.13): a pure projection of the `PlannerAlternativeCandidate` the
 * search delivered. No RNG prediction, no generated BuildCandidate, no
 * `candidateStableKey` is read to build it.
 */
export interface PlannerAlternativeRouteSummary {
  /** The concrete RouteOperation sequence in execution order, source OwnedWeapon IDs included. */
  route: BuildRoute
  finalBonuses: RestorationBonusSet
  restorationBonusScope: RestorationBonusScope
  seriesSkillId: SeriesSkillId | null
  groupSkillId: GroupSkillId | null
  bonusAmendmentTrace: CandidateBonusAmendmentStep[]
  skillAmendmentTrace: CandidateSkillAmendmentStep[]
  conversionSkillTrace: CandidateConversionSkillStep | null
}

/**
 * One non-fixed Target's outcome. `found` means only that the Target's own
 * individual trial succeeded (9.2.19.6); `adoptedInScenario` is its fate in the
 * scenario composition: `true` accepted, `false` evaluated and rejected, `null`
 * not evaluated because the request-global rerun budget stopped the
 * composition first. `cancelled` is never an outcome.
 */
export type PlannerAlternativeOutcome =
  | {
      status: 'found'
      alternative: PlannerAlternativeRouteSummary
      distance: PlannerAlternativeDistance
      adoptedInScenario: boolean | null
    }
  | { status: 'not_found_within_search_extent' }
  | { status: 'stopped_by_search_extent_bound' }
  | { status: 'stopped_by_candidate_trial_bound' }
  | { status: 'stopped_by_planner_rerun_bound' }
  | { status: 'blocked_by_selected_checkpoint' }

export interface PlannerAlternativeTargetOutcome {
  fixedBuildListEntryId: BuildListEntryId
  fixedTargetWeaponId: TargetWeaponId
  alternativeTargetWeaponId: TargetWeaponId
  outcome: PlannerAlternativeOutcome
  /**
   * Candidates this Target's search actually reached and skipped because a
   * still valid prior repair lineage key excludes them. A Candidate excluded
   * only as this decision's invalidated current Route is not counted, a
   * lineage key the search never reached is not counted, and a trial rejection
   * is not counted. It is not the Search summary's total `excludedCandidates`.
   */
  excludedByRepairLineageCount: number
}

export interface PlannerAlternativeConflictSummary {
  kind: ConflictKind
  participantTargetWeaponIds: TargetWeaponId[]
  /** `selectedBuildListEntryId !== null`. The two scenario lists hold unresolved Conflicts only. */
  resolved: boolean
}

/**
 * The whole scenario (this decision, 1-step repaired), from the final scenario
 * result only (9.2.19.8.1 / 9.2.19.13). For an actual repair it describes the
 * Plan that would be saved.
 */
export type PlannerAlternativeScenarioOutcome =
  | {
      status: 'evaluated'
      /** `ProductionPlan.steps.length` of the final scenario Plan; never a sum of Route estimates. */
      scenarioOperationCount: number
      /** Planning Targets the scenario Plan does not complete (no Step completes them). */
      unplannedTargetWeaponIds: TargetWeaponId[]
      /** Unresolved Conflicts with an accepted replacement's generated Entry as a participant. */
      introducedConflicts: PlannerAlternativeConflictSummary[]
      /** Unresolved Conflicts without one. */
      remainingConflicts: PlannerAlternativeConflictSummary[]
    }
  | { status: 'no_plan' }
  | { status: 'stopped_by_plan_step_bound'; maxPlanSteps: number }
  | { status: 'stopped_by_planner_rerun_bound' }

export interface PlannerAlternativeComparison {
  conflictKey: string
  fixedBuildListEntryId: BuildListEntryId
  fixedTargetWeaponId: TargetWeaponId
  /** In the Domain's stable Target order (`createPlannerConflictWorks()`). */
  alternatives: PlannerAlternativeTargetOutcome[]
  scenario: PlannerAlternativeScenarioOutcome
}

/** Pure projection of a delivered Candidate (9.2.19.13); nothing is predicted or reconstructed. */
export function createPlannerAlternativeRouteSummary(
  candidate: PlannerAlternativeCandidate,
): PlannerAlternativeRouteSummary {
  return {
    route: structuredClone(candidate.route),
    finalBonuses: structuredClone(candidate.finalBonuses),
    restorationBonusScope: candidate.restorationBonusScope,
    seriesSkillId: candidate.seriesSkillId,
    groupSkillId: candidate.groupSkillId,
    bonusAmendmentTrace: structuredClone(candidate.bonusAmendmentTrace),
    skillAmendmentTrace: structuredClone(candidate.skillAmendmentTrace),
    conversionSkillTrace: candidate.conversionSkillTrace === undefined
      ? null
      : structuredClone(candidate.conversionSkillTrace),
  }
}

export function createPlannerAlternativeDistance(candidate: PlannerAlternativeCandidate): PlannerAlternativeDistance {
  return {
    estimatedOperationCount: candidate.estimatedOperationCount,
    estimatedGogmaAdvance: candidate.estimatedGogmaAdvance,
    estimatedSkillAdvance: candidate.estimatedSkillAdvance,
    estimatedNormalAdvance: candidate.estimatedNormalAdvance,
  }
}

/**
 * Candidates the search skipped for a still valid prior lineage key of this
 * Target (9.2.19.13). The skipped keys are the Search Domain's neutral record;
 * only here are they told apart from the current invalidated Route.
 */
export function countPlannerAlternativeLineageExclusions(
  target: Pick<PlannerAlternativeKernelTargetResult, 'targetWeaponId' | 'skippedExcludedRouteKeys'>,
  priorExcludedRoutes: readonly PlannerAlternativeRouteExclusion[],
): number {
  const lineageKeys = new Set(normalizePlannerAlternativeExcludedRouteKeys(
    priorExcludedRoutes
      .filter(({ targetWeaponId }) => targetWeaponId === target.targetWeaponId)
      .flatMap(({ routeKeys }) => routeKeys),
  ))
  return new Set(target.skippedExcludedRouteKeys.filter((key) => lineageKeys.has(key))).size
}
