/**
 * Issue #154 Global Assignment Phase B-2A (Research only; never imported by the app).
 *
 * The root lower bound stage of `docs/PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md` 10.2, connecting the existing
 * Phase 2-A.5 relaxation (`src/benchmarks/plannerGlobalLowerBound.ts`: `auditCrossSatisfaction()`,
 * `collectLowerBoundProblem()`, `solveLowerBoundRelaxation()`, `provenLowerBoundTotal()`) to a
 * `GlobalAssignmentContext` without changing that module. The bound is diagnostics for the assignment-only
 * run: it is compared with the structural objective of the resource assignments the solver found and is
 * **never** a branch-and-bound upper bound. The report type therefore carries no `physicalOperations` and
 * no `provenance` field, so it cannot be passed where the solver expects a `VerifiedUpperBound`.
 *
 * Applicability (design 10.2): the relaxation's Target set is every planning-eligible Target of the
 * PlannerInput, the solver's planning Target set is the eligible Targets with a valid BuildListEntry
 * (design 4.1). The bound is claimed only when both sets coincide and the cross satisfaction audit finds
 * no possible pair; otherwise the stage reports `not_applicable` with the reason and claims nothing (the
 * design's option (a): no planning-Target projection is passed into the module).
 *
 * `none_below_budget` means "no threshold vector with total below the budget is feasible for the
 * relaxation", so every Plan needs at least `budget` physical operations; it never means "no feasible Plan".
 */
import { isTargetWeaponPlanningEligible } from '../../domain/models/domainRules'
import type { TargetWeaponId } from '../../domain/models/publicTypes'
import type { RngEngine } from '../../domain/rng/rngEngine'
import {
  auditCrossSatisfaction, collectLowerBoundProblem, LowerBoundUnsupportedInputError, provenLowerBoundTotal, solveLowerBoundRelaxation,
  type CrossSatisfactionAudit, type LowerBoundRelaxationResult, type SkillStateCandidates,
} from '../plannerGlobalLowerBound'
import type { GlobalAssignmentContext } from './types'

/** At most this many cross satisfaction pairs are listed in a report; the count is always complete. */
const POSSIBLE_PAIR_SAMPLE_LIMIT = 20

export interface LowerBoundTargetSetComparison {
  /** The relaxation's eligible Target set equals the context's planning Target set. */
  matches: boolean
  planningTargetCount: number
  eligibleTargetCount: number
  /** Planning-eligible Targets without a valid BuildListEntry (in the relaxation, not in the solver). */
  eligibleWithoutValidEntry: TargetWeaponId[]
  /** Planning Targets that are not planning-eligible (never expected: planning Targets are a subset of the eligible ones). */
  planningNotEligible: TargetWeaponId[]
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

export function compareLowerBoundTargetSet(context: GlobalAssignmentContext): LowerBoundTargetSetComparison {
  const eligible = new Set(context.plannerInput.targetWeapons.filter(isTargetWeaponPlanningEligible).map(target => target.id))
  const planning = context.planningTargetIds
  const eligibleWithoutValidEntry = [...eligible].filter(id => !planning.has(id)).sort(compareIds)
  const planningNotEligible = [...planning].filter(id => !eligible.has(id)).sort(compareIds)
  return {
    matches: eligibleWithoutValidEntry.length === 0 && planningNotEligible.length === 0,
    planningTargetCount: planning.size, eligibleTargetCount: eligible.size, eligibleWithoutValidEntry, planningNotEligible,
  }
}

export interface RootLowerBoundCrossSatisfactionSummary {
  planningTargetCount: number
  sameWeaponTypeAndElementPairCount: number
  skillStateCandidates: CrossSatisfactionAudit['skillStateCandidates']
  possiblePairCount: number
  /** The first `POSSIBLE_PAIR_SAMPLE_LIMIT` pairs (Target ID order of the audit). */
  possiblePairs: CrossSatisfactionAudit['possiblePairs']
  distinctSourcePreconditionHolds: boolean
}

export interface RootLowerBoundRelaxationSummary {
  status: LowerBoundRelaxationResult['status']
  provenAtLeast: number | null
  minimum: LowerBoundRelaxationResult['minimum']
  targetsWithoutOption: string[]
  nearMinimum: LowerBoundRelaxationResult['nearMinimum']
  origins: { skill: number; gogma: number; normal: Record<string, number> }
  targets: { targetWeaponId: string; weaponTypeId: string; elementId: string; optionCount: number; ownedOptionCount: number; firstIdealSkillPosition: number | null; firstIdealResetPosition: number | null }[]
}

export type RootLowerBoundReport =
  | {
      status: 'found'
      /** The relaxation minimum: a proven lower bound on the physical operation count of every Plan completing the planning Targets (under `LOWER_BOUND_ASSUMPTIONS`). Never an upper bound. */
      provenLowerBound: number
      budget: number
      targetSet: LowerBoundTargetSetComparison
      crossSatisfaction: RootLowerBoundCrossSatisfactionSummary
      relaxation: RootLowerBoundRelaxationSummary
      elapsedMs: number
    }
  | {
      status: 'none_below_budget'
      /** Every Plan needs at least this many physical operations (`= budget`); not "no feasible Plan". */
      provenAtLeast: number
      budget: number
      targetSet: LowerBoundTargetSetComparison
      crossSatisfaction: RootLowerBoundCrossSatisfactionSummary
      relaxation: RootLowerBoundRelaxationSummary
      elapsedMs: number
    }
  | {
      status: 'not_applicable'
      /**
       * `planning_target_set_mismatch`: the relaxation would bound a different Target set (design 10.2).
       * `cross_satisfaction_possible`: one weapon state could meet two planning Targets' Ideals, so
       * pairwise distinct sources are not proven. `unsupported_input`: the relaxation refused the input
       * (unconfirmed RNG state or Normal Counter).
       */
      reason: 'planning_target_set_mismatch' | 'cross_satisfaction_possible' | 'unsupported_input'
      detail: string
      budget: number
      targetSet: LowerBoundTargetSetComparison
      crossSatisfaction: RootLowerBoundCrossSatisfactionSummary | null
      elapsedMs: number
    }

/** The stage result as the parent process records it: the report, an envelope stop, or a run that did not ask for it. */
export type RootLowerBoundStageResult =
  | RootLowerBoundReport
  | { status: 'unmeasured'; reason: 'timeout' | 'out_of_memory' | 'process_failure'; detail: string }
  | { status: 'not_requested' }

export interface RootLowerBoundExecution {
  /** Monotonic milliseconds, injected (this module reads no clock). */
  now: () => number
  /** `solveLowerBoundRelaxation({ recordAbove })`: rows above the budget kept for the trade-off view (default 0). */
  recordAbove?: number
}

function summarizeAudit(audit: CrossSatisfactionAudit): RootLowerBoundCrossSatisfactionSummary {
  return {
    planningTargetCount: audit.planningTargetCount, sameWeaponTypeAndElementPairCount: audit.sameWeaponTypeAndElementPairCount,
    skillStateCandidates: { ...audit.skillStateCandidates }, possiblePairCount: audit.possiblePairCount,
    possiblePairs: audit.possiblePairs.slice(0, POSSIBLE_PAIR_SAMPLE_LIMIT).map(pair => ({ targetWeaponIds: [...pair.targetWeaponIds] as [string, string], witness: { ...pair.witness } })),
    distinctSourcePreconditionHolds: audit.possiblePairCount === 0,
  }
}

/**
 * Measures the root lower bound of the context's PlannerInput with `budget` (design 10.2). Runs the cheap
 * cross satisfaction audit first, so an input with a possible pair or a Target set mismatch never pays for
 * the threshold scan. Reaching an execution envelope (wall-clock / heap) is the caller's `unmeasured`.
 */
export function measureRootLowerBound(context: GlobalAssignmentContext, engine: RngEngine, budget: number, skills: SkillStateCandidates,
  execution: RootLowerBoundExecution): RootLowerBoundReport {
  if (!Number.isSafeInteger(budget) || budget < 1) throw new RangeError(`Root lower bound budget must be a positive integer (got ${String(budget)}).`)
  const started = execution.now()
  const input = context.plannerInput
  const targetSet = compareLowerBoundTargetSet(context)
  const audit = summarizeAudit(auditCrossSatisfaction(input, skills))
  if (!targetSet.matches) {
    return {
      status: 'not_applicable', reason: 'planning_target_set_mismatch', budget, targetSet, crossSatisfaction: audit, elapsedMs: execution.now() - started,
      detail: `The relaxation bounds ${targetSet.eligibleTargetCount} planning-eligible Targets but the solver plans ${targetSet.planningTargetCount}`
        + ` (${targetSet.eligibleWithoutValidEntry.length} eligible without a valid Entry); the bound is not claimed for the planning Targets (design 10.2).`,
    }
  }
  if (audit.possiblePairCount > 0) {
    return {
      status: 'not_applicable', reason: 'cross_satisfaction_possible', budget, targetSet, crossSatisfaction: audit, elapsedMs: execution.now() - started,
      detail: `${audit.possiblePairCount} planning Target pair(s) can be met by one weapon state, so pairwise distinct sources are not proven and no minimality is claimed (design 10.2).`,
    }
  }
  let relaxation: LowerBoundRelaxationResult
  let summary: RootLowerBoundRelaxationSummary
  try {
    const problem = collectLowerBoundProblem(input, engine, budget, skills)
    relaxation = solveLowerBoundRelaxation(problem, { recordAbove: execution.recordAbove ?? 0 })
    summary = {
      status: relaxation.status, provenAtLeast: relaxation.provenAtLeast, minimum: relaxation.minimum === null ? null : structuredClone(relaxation.minimum),
      targetsWithoutOption: [...relaxation.targetsWithoutOption], nearMinimum: relaxation.nearMinimum.map(row => ({ ...row, normal: { ...row.normal } })),
      origins: { skill: problem.skillOrigin, gogma: problem.gogmaOrigin, normal: { ...problem.normalOrigins } },
      targets: problem.targets.map(target => ({
        targetWeaponId: target.targetWeaponId, weaponTypeId: target.weaponTypeId, elementId: target.elementId, optionCount: target.options.length,
        ownedOptionCount: target.options.filter(option => option.resource.startsWith('owned:')).length,
        firstIdealSkillPosition: target.firstIdealSkillPosition, firstIdealResetPosition: target.firstIdealResetPosition,
      })),
    }
  } catch (error) {
    if (error instanceof LowerBoundUnsupportedInputError) {
      return { status: 'not_applicable', reason: 'unsupported_input', detail: error.message, budget, targetSet, crossSatisfaction: audit, elapsedMs: execution.now() - started }
    }
    throw error
  }
  const elapsedMs = execution.now() - started
  if (relaxation.status === 'not_applicable') {
    // The module re-audits inside collectLowerBoundProblem(); the audit above already excluded this, so it is an inconsistency, not a bound.
    throw new Error('solveLowerBoundRelaxation() returned not_applicable after the cross satisfaction audit found no possible pair.')
  }
  const proven = provenLowerBoundTotal(relaxation)
  if (relaxation.status === 'found' && proven !== null) {
    return { status: 'found', provenLowerBound: proven, budget, targetSet, crossSatisfaction: audit, relaxation: summary, elapsedMs }
  }
  return { status: 'none_below_budget', provenAtLeast: relaxation.provenAtLeast ?? budget, budget, targetSet, crossSatisfaction: audit, relaxation: summary, elapsedMs }
}

/**
 * The structural objective of a resource assignment compared with a root lower bound (diagnostics only).
 * `gap` is objective minus bound where both exist; a negative gap would mean the relaxation is not a
 * bound of the assignment's problem and is reported as `inconsistent` (never silently clamped).
 */
export interface RootLowerBoundComparison {
  bestObjective: number | null
  lowerBound: number | null
  lowerBoundKind: 'proven_minimum_of_relaxation' | 'at_least_budget' | null
  gap: number | null
  consistency: 'consistent' | 'inconsistent' | 'not_comparable'
}

export function compareObjectiveWithRootLowerBound(bestObjective: number | null, stage: RootLowerBoundStageResult): RootLowerBoundComparison {
  const bound = stage.status === 'found' ? { value: stage.provenLowerBound, kind: 'proven_minimum_of_relaxation' as const }
    : stage.status === 'none_below_budget' ? { value: stage.provenAtLeast, kind: 'at_least_budget' as const } : null
  if (bound === null || bestObjective === null) return { bestObjective, lowerBound: bound?.value ?? null, lowerBoundKind: bound?.kind ?? null, gap: null, consistency: 'not_comparable' }
  const gap = bestObjective - bound.value
  return { bestObjective, lowerBound: bound.value, lowerBoundKind: bound.kind, gap, consistency: gap >= 0 ? 'consistent' : 'inconsistent' }
}
