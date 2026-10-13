/**
 * Issue #154 Global Assignment Phase D-0B (Research only; never imported by the app).
 *
 * The materialization runner (`docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D0B.md`, `docs/PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md`
 * 9.8 / 9.9 / 12 / 14 / 19.7): Phase 0 context -> Phase A ReachTable -> Phase C-2 coverage-gated structural candidate search
 * (stopped after the requested number of candidates) -> the design 19 G1 / G3 / G4 diagnostics -> the Phase D-0A
 * materialization of each collected candidate, driven as one calculation over a PlannerInput and its `PlannerDependencies`.
 * It returns a plain-data record split into the **semantic** part (deterministic for the same input, Engine and conditions:
 * outcomes, diagnostics, Search instrumentation counts, Entry identities) and the **observed** part (stage and Target
 * timings, yields). The process-level parts - Export reading, hashing, memory, wall-clock and heap envelopes, the progress
 * journal file - belong to the runner script; this module reads no file, clock or random value (`now` is injected).
 *
 * It never runs the Production Planner or Trace Replay, passes no upper bound to the structural search, reads no oracle
 * and writes nothing: the materialized Entries are speculative Research data (G1), summarized by ID and semantic hash. No
 * result here is `verified`, `best_found` or `proven_minimum`, and `all_materialized` is not a Plan.
 *
 * Phase D-0A-2b (`docs/PLANNER_GLOBAL_ASSIGNMENT_D0A2_DESIGN.md` 11 / 12 / 19): conditions with `rule: 'd0a2-v2'` run the
 * shape-constrained method and add their own fields (the shape attempts with their identity, reservation counts, predicted
 * scale, premises, Search usage and Route checks; the shape gate refusals; the G3 lower variant apart from the upper one; the
 * summary's `shapeConstrained` row) under their own protocol version. Conditions without a rule are `d0a-v1`: the run and
 * its record are exactly the D-0B ones (frozen by the `d0a-v1` golden).
 *
 * Phase D-0B-2: a `d0a2-v2` run's observed record adds each Target's `shapeTimeline` (execution-only inspection times that split
 * a shape-constrained materialization into its Search and its independent Route checks); the semantic record is unchanged.
 */
import { hashStableValue } from '../../domain/models/publicTypes'
import type { BuildListEntry, OwnedWeaponId, TargetWeaponId } from '../../domain/models/publicTypes'
import type { PlannerDependencies, PlannerInput } from '../../domain/planner/plannerTypes'
import type { PlannerAlternativeReservation } from '../../domain/search/alternative'
import { findNonPlainJsonPaths } from './assignmentProtocol'
import { createGlobalAssignmentContext } from './context'
import { noCandidateReason } from './coverageSearch'
import type { StructuralSearchDiagnostics } from './coverageSearchTypes'
import type { StructuralCandidate } from './coverageTypes'
import { materializeStructuralCandidate, type MaterializationSearchPort, type ShapeMaterializationSearchPort } from './materialize'
import {
  bonusFrontierLowerRequestRisk, bonusFrontierRequestRisk, countContinuationOptions, diagnoseBonusFrontierLowerRisk, diagnoseBonusFrontierRisk, diagnosePlannerStartIdeal,
  diagnoseSearchPolicyShapes, measureBonusFrontierCollapse, measureBonusFrontierLowerCollapse, summarizeInspections,
  type BonusFrontierLowerRequestRisk, type BonusFrontierLowerRisk, type BonusFrontierLowerRiskDiagnostics, type BonusFrontierMeasured, type BonusFrontierRequestRisk,
  type BonusFrontierRisk, type BonusFrontierRiskDiagnostics, type ContinuationOptionCounts, type InspectionSummary, type PlannerStartIdealDiagnostics,
  type SearchPolicyShapeDiagnostics,
} from './materializationDiagnostics'
import {
  classifyMaterializationStage, conditionReachOptionSet, isShapeMaterializationConditions, materializationFollowUp, materializationProtocolVersion, validateMaterializationRunConditions,
  type CandidateMaterializationClass, type MaterializationFollowUp, type MaterializationProgressEvent, type MaterializationRunConditions, type TargetOutcomeBrief,
} from './materializationProtocol'
import {
  GlobalAssignmentMaterializationError,
  type CandidateInspection, type MaterializationAttempt, type MaterializationMethod, type MaterializationObserver, type MaterializationOutcome, type MaterializationStageOutcome, type MethodSelection,
  type ObservedPlannerAlternativeSearch, type PredictedSearchScale, type ProjectedAttemptResult, type SearchScaleDetail, type TargetMaterializationRecord,
} from './materializationTypes'
import type {
  MinimalRoutePremiseViolation, RouteCheckReport, ShapeConstrainedAttempt, ShapeMethodSelection, ShapeSearchObserved, ShapeSearchScale, ShapeSearchScaleComponent,
} from './shapeMaterializationTypes'
import type { RouteShapeConstraint } from '../../domain/search/research'
import { buildReachTable } from './reachTable'
import { createStructuralCandidateSearch } from './structuralSearch'
import { decideStructuralWindowTransition, type StructuralStageOutcome, type StructuralWindowDecision } from './structuralWindowPolicy'
import { GlobalAssignmentInvariantError, type ReachOption, type ReachTable, type ReachWindow, type StreamEnd } from './types'

/** `gogma_required`-only mismatch samples kept per Target. */
export const INSPECTION_SAMPLE_LIMIT = 3

export interface MaterializationRunRequest {
  /** `d0a-v1` conditions (no `rule` field, the D-0B default) or `d0a2-v2` conditions (`rule: 'd0a2-v2'`). */
  conditions: MaterializationRunConditions
}

export interface MaterializationRunExecution {
  /** Monotonic milliseconds from the script's clock; the module reads no clock of its own. */
  now: () => number
  /** The existing Research cancel / yield seam (ReachTable, structural search, every materialization Search). */
  shouldCancel?: () => boolean
  yieldControl?: () => Promise<void>
  /** Progress events in order (the script writes them to its journal); execution-only. */
  onProgress?: (event: MaterializationProgressEvent) => void
  /** The Production Search entry points by default; a test may observe them. */
  search?: MaterializationSearchPort
  /** D-0A-2b: the rule `d0a2-v2`'s Search entry points (the shape-constrained seam and the projected Search); a test may observe them. */
  shapeSearch?: ShapeMaterializationSearchPort
}

export interface MaterializationInputSummary {
  plannerInputValid: boolean
  validationIssueCount: number
  /** Phase 0 (design 4.1): the denominator of every later statement. Never a fixed number. */
  planningTargetCount: number
  targetWeaponCount: number
  buildListEntryCount: number
  validEntryCount: number
  excludedEntryCount: number
  ownedWeaponCount: number
  normalCounterCount: number
  confirmedNormalCounterCount: number
  rngEngineVersion: string
  calculationContext: PlannerInput['calculationContext']
}

export interface ReachTableSummary {
  origins: { skill: number; gogma: number; normal: Record<string, number> }
  scanned: ReachTable['scanned']
  predictions: ReachTable['summary']['predictions']
  memoHits: ReachTable['summary']['memoHits']
  supportQueries: number
  groupCount: number
  unsupportedPredictionCount: number
}

export interface StructuralSearchRecord {
  outcome: StructuralStageOutcome
  /** Design 10.3 over the structural stage alone (C-2 rule); Phase D outcomes do not enter it. */
  windowDecision: StructuralWindowDecision
  candidatesCollected: number
  /** The node budget, a cancel or the candidate limit left part of the tree unexplored (never "no candidate"). */
  unexploredBranchesRemain: boolean
  /** The literal false: no `VerifiedUpperBound` is read, so nothing is pruned (design 6.3). */
  upperBoundSupplied: false
  diagnostics: StructuralSearchDiagnostics
}

export interface StructuralCandidateSummary {
  candidateIndex: number
  /** Generation ordinal of the structural search (diagnostics, never an identity). */
  ordinal: number
  /** The structural objective (Σ stream end − origin): a necessary-condition value, never a Plan's step count or an upper bound. */
  objective: number
  streamEnd: StreamEnd
  materializationOrder: TargetWeaponId[]
  skillDependencyCount: number
  predictedChainSegmentCount: number
  sourceKinds: { owned_gogma: number; owned_normal: number; new_normal: number }
  skillRequirements: { none: number; reset_skills: number; conversion: number }
  bonusRequirements: { none: number; reset: number; keep_from_source: number; reset_then_keep: number }
  /**
   * One row per planning Target in materialization order: the chosen option and the positions Phase C attributes to it per stream
   * (its required positions plus its predicted chain; design 8.3 `ownPositionCount`, a prediction, never a match condition).
   */
  targets: { orderIndex: number; sourceKind: string; skill: string; bonus: string; normal: string | null; ownPositionCount: { skill: number; gogma: number; normal: number }; predictedChainSegments: number }[]
  /** Design 8.2 Skill dependencies by materialization order index: each conversion Target and the Targets placed before it for its Skill coverage. */
  skillDependencies: { orderIndex: number; conversionPosition: number; prerequisiteOrderIndexes: number[] }[]
}

export interface ReservationSummary {
  sourceEntryCount: number
  skill: { held: number; blocked: number }
  gogma: { held: number; blocked: number }
  normal: { counterId: string; held: number; blocked: number }[]
  exclusiveOwnedWeapons: number
}

/**
 * Phase D-0A-2b: one shape-constrained attempt (design D0A2 12 records): the shape, the identity, the formal reservation's
 * counts, the extent, the predicted scale, the premises, the outcome, what the Search used and the independent Route checks.
 */
export interface ShapeAttemptSummary {
  method: 'shape_constrained'
  materializationRule: 'd0a2-v2'
  routeShape: RouteShapeConstraint
  searchIdentity: string
  origins: ShapeConstrainedAttempt['request']['origins']
  reservation: ReservationSummary
  extent: { maxNormalAdvance: number; maxGogmaAdvance: number; maxSkillAdvance: number }
  predictedSearchScale: ShapeSearchScale
  premiseViolations: MinimalRoutePremiseViolation[]
  result: OutcomeRecord
  observed: ShapeSearchObserved | null
  routeChecks: RouteCheckReport | null
}

export interface AttemptSummary {
  method: Exclude<MaterializationMethod, 'shape_constrained'>
  predictedSearchScale: PredictedSearchScale
  scale: Omit<SearchScaleDetail, 'conversionSkillPositions'> & { conversionSkillPositionCount: number }
  /** Counts of the formal reservation the request carried (null for the projected Search, which has none). */
  reservation: ReservationSummary | null
  extent: { maxNormalAdvance: number; maxGogmaAdvance: number; maxSkillAdvance: number }
  /**
   * Design 9.1 attempts: the attempt's outcome. Design 9.2 attempts: the projected result, never the Target outcome on its
   * own (a match is shown as its `materialized` record).
   */
  result: OutcomeRecord | Exclude<ProjectedAttemptResult, { kind: 'matched' }>
  observed: ObservedPlannerAlternativeSearch | { searchedRoutes: string[]; skippedRoutes: { route: string; reason: string }[]; candidateFound: boolean } | null
}

/** A `MaterializationOutcome` with the Entry replaced by its identity (the Entry itself stays Research data in the process). */
export type OutcomeRecord =
  | Exclude<MaterializationOutcome, { kind: 'materialized' }>
  | { kind: 'materialized'; method: MaterializationMethod; entryId: BuildListEntry['id']; entrySemanticHash: string; plannerRequired: Extract<MaterializationOutcome, { kind: 'materialized' }>['plannerRequired']; deliveredBeforeMatch: number }

export interface TargetMaterializationSummary {
  orderIndex: number
  targetWeaponId: TargetWeaponId
  option: { sourceKind: ReachOption['source']['kind']; sourceOwnedWeaponId: OwnedWeaponId | null; skillRequired: ReachOption['skillRequired']; bonusRequired: ReachOption['bonusRequired']; normalRequired: ReachOption['normalRequired'] }
  selection: MethodSelection | ShapeMethodSelection | null
  attempts: (AttemptSummary | ShapeAttemptSummary)[]
  outcome: OutcomeRecord
  /** Every Candidate the Searches of this Target returned, by match verdict (design 9.1 deliveries and the design 9.2 canonical Ideal). */
  inspections: InspectionSummary
  /**
   * Design 19.3 G3 for this Target: the static risk row (null when the option has no Keep chain), its reading against each executed
   * or gated request, and the delivered Candidates that carry the collapse signature (null without a risk row).
   */
  bonusFrontier: { static: BonusFrontierRisk | null; requests: BonusFrontierRequestRisk[]; measured: BonusFrontierMeasured | null }
  /**
   * D-0A-2b, `d0a2-v2` records only (a `d0a-v1` record keeps the D-0B shape): the G3 lower variant for this Target, apart from
   * `bonusFrontier` (null rows without a `reset_then_keep` option).
   */
  bonusFrontierLower?: { static: BonusFrontierLowerRisk | null; requests: BonusFrontierLowerRequestRisk[]; measured: BonusFrontierMeasured | null }
}

export interface CandidateDiagnosticsRecord {
  searchPolicyShapes: SearchPolicyShapeDiagnostics
  continuationOptions: ContinuationOptionCounts
  bonusFrontier: BonusFrontierRiskDiagnostics
  plannerStartIdeal: PlannerStartIdealDiagnostics
  /** D-0A-2b, `d0a2-v2` records only: the G3 lower variant (design D0A2 3.7), apart from the upper `bonusFrontier`. */
  bonusFrontierLower?: BonusFrontierLowerRiskDiagnostics
}

export interface CandidateMaterializationRecord {
  candidate: StructuralCandidateSummary
  /** Static diagnostics from the structural candidate (before any Search). None of them classifies the candidate. */
  diagnostics: CandidateDiagnosticsRecord
  classification: CandidateMaterializationClass
  followUp: MaterializationFollowUp
  /** The D-0A stage outcome (the Entry replaced by its identity); null when the run failed closed. */
  stage: (Exclude<MaterializationStageOutcome, { kind: 'materialization_failed' | 'materialization_unconfirmed' | 'materialization_unsupported' }> | { kind: 'materialization_failed' | 'materialization_unconfirmed' | 'materialization_unsupported'; targetWeaponId: TargetWeaponId; outcome: OutcomeRecord }) | null
  /** The Target the run stopped at (materialization order), null when every Target materialized. */
  firstUnresolved: { orderIndex: number; targetWeaponId: TargetWeaponId } | null
  attemptedTargetCount: number
  materializedTargetCount: number
  notAttemptedTargetWeaponIds: TargetWeaponId[]
  /** One row per attempted Target in materialization order (settled Targets only). */
  targets: TargetMaterializationSummary[]
  /** Search scale gate refusals over every attempt, per component (design 9.7). */
  gateExceeded: Record<keyof PredictedSearchScale, number>
  /** D-0A-2b, `d0a2-v2` records only: the shape-constrained gate refusals per component (design D0A2 10.3). */
  shapeGateExceeded?: Record<ShapeSearchScaleComponent, number>
  /** `detail`: the plain data a D-0A-2b stop carries (absent for a D-0A stop). */
  failClosed: { code: string; targetWeaponId: string | null; message: string; detail?: unknown } | null
}

export type MaterializationRunOutcome =
  | { kind: 'unsupported_input'; stage: 'context' | 'reach_table'; reason: string }
  | { kind: 'scan_cancelled' }
  /** The structural search could not start (its input was refused). */
  | { kind: 'structural_search_invalid'; reason: string }
  /** The exhausted tree delivered no structural candidate (this window and these constraints only). */
  | { kind: 'no_structural_candidate'; reason: string }
  /** The node budget or a cancel stopped the structural search before its first candidate: nothing is concluded. */
  | { kind: 'structural_search_incomplete'; completeness: 'node_budget_reached' | 'cancelled' }
  /** At least one structural candidate was obtained and materialized; one class per candidate. */
  | { kind: 'structural_candidates_materialized'; classifications: CandidateMaterializationClass[] }

export interface MaterializationSemanticRecord {
  protocolVersion: string
  nature: 'materialization_only: not a Production Plan, not Planner-verified'
  conditions: MaterializationRunConditions
  window: ReachWindow
  input: MaterializationInputSummary
  context: { status: 'context' } | { status: 'unsupported_input'; reason: string; detail: string }
  reachTable: { status: 'reach_table'; summary: ReachTableSummary } | { status: 'unsupported_input'; reason: string; detail: string } | { status: 'cancelled' } | { status: 'not_reached' }
  structuralSearch: StructuralSearchRecord | null
  candidates: CandidateMaterializationRecord[]
  outcome: MaterializationRunOutcome
  /** Research-internal inconsistencies found while recording (a non-plain value, a fail-closed stop); `[]` is the normal case. */
  integrityIssues: string[]
  oracleFreeExecution: true
}

/**
 * D-0B-2, `d0a2-v2` runs only (execution-only, never semantic): when, after the Target started, the projected Candidate Search's
 * canonical Ideal and the shape-constrained first delivery were inspected (each after its Entry materialization and match). For a
 * shape-constrained materialization, `ms − shapeInspectedMs` is the independent Route checks plus the attempt's tail, and
 * `shapeInspectedMs − (projectedInspectedMs ?? 0)` covers its request derivation, premise check, gate and Search. Null when the
 * method did not inspect a Candidate.
 */
export interface ShapeTargetTimeline {
  projectedInspectedMs: number | null
  shapeInspectedMs: number | null
}

export interface MaterializationObservedRecord {
  elapsedMs: {
    context: number
    reachTable: number | null
    structuralSearch: number | null
    toFirstStructuralCandidate: number | null
    candidates: { candidateIndex: number; diagnostics: number; materialization: number; targets: { orderIndex: number; targetWeaponId: string; ms: number; shapeTimeline?: ShapeTargetTimeline }[] }[]
    total: number
  }
  yields: number
}

export interface MaterializationRunResult {
  semantic: MaterializationSemanticRecord
  observed: MaterializationObservedRecord
}

function countBy<T extends string>(keys: readonly T[], values: Iterable<T>): Record<T, number> {
  const counts = Object.fromEntries(keys.map(key => [key, 0])) as Record<T, number>
  for (const value of values) counts[value] += 1
  return counts
}

function summarizeInput(input: PlannerInput, context: ReturnType<typeof createGlobalAssignmentContext>, dependencies: PlannerDependencies): MaterializationInputSummary {
  const validation = context.kind === 'context' ? context.context.validation : context.validation
  return {
    plannerInputValid: validation.isValid, validationIssueCount: validation.issues.length,
    planningTargetCount: context.kind === 'context' ? context.context.planningTargets.length : 0,
    targetWeaponCount: input.targetWeapons.length, buildListEntryCount: input.buildListEntries.length,
    validEntryCount: validation.validBuildListEntries.length, excludedEntryCount: validation.excludedBuildListEntries.length,
    ownedWeaponCount: input.ownedWeapons.length, normalCounterCount: input.normalCounters.length,
    confirmedNormalCounterCount: input.normalCounters.filter(counter => counter.isConfirmed && counter.counter !== null).length,
    rngEngineVersion: dependencies.rngEngine.version, calculationContext: { ...input.calculationContext },
  }
}

function summarizeTable(table: ReachTable): ReachTableSummary {
  return {
    origins: { skill: table.originSkill, gogma: table.originGogma, normal: { ...table.originNormal } },
    scanned: structuredClone(table.scanned),
    predictions: { ...table.summary.predictions }, memoHits: { ...table.summary.memoHits }, supportQueries: table.summary.supportQueries,
    groupCount: table.summary.groups.length, unsupportedPredictionCount: table.summary.unsupported.length,
  }
}

function summarizeCandidate(candidate: StructuralCandidate, candidateIndex: number): StructuralCandidateSummary {
  const options = [...candidate.assignment.chosen.values()]
  return {
    candidateIndex, ordinal: candidate.ordinal, objective: candidate.assignment.objective,
    streamEnd: { skill: candidate.assignment.streamEnd.skill, gogma: candidate.assignment.streamEnd.gogma, normal: { ...candidate.assignment.streamEnd.normal } },
    materializationOrder: [...candidate.materializationOrder],
    skillDependencyCount: candidate.materializationDependencies.length,
    predictedChainSegmentCount: candidate.expectedShapes.reduce((sum, shape) => sum + shape.predicted.chainSegments.length, 0),
    sourceKinds: countBy(['owned_gogma', 'owned_normal', 'new_normal'] as const, options.map(option => option.source.kind)),
    skillRequirements: countBy(['none', 'reset_skills', 'conversion'] as const, options.map(option => option.skillRequired.kind)),
    bonusRequirements: countBy(['none', 'reset', 'keep_from_source', 'reset_then_keep'] as const, options.map(option => option.bonusRequired.kind)),
    targets: candidate.materializationOrder.map((targetWeaponId, orderIndex) => {
      const option = candidate.assignment.chosen.get(targetWeaponId)!
      const shape = candidate.expectedShapes.find(value => value.targetWeaponId === targetWeaponId)!
      return {
        orderIndex, sourceKind: option.source.kind, skill: requirementLabel(option.skillRequired), bonus: requirementLabel(option.bonusRequired),
        normal: option.normalRequired === null ? null : `${option.normalRequired.counterId}@${option.normalRequired.position}`,
        ownPositionCount: { ...shape.predicted.ownPositionCount }, predictedChainSegments: shape.predicted.chainSegments.length,
      }
    }),
    skillDependencies: candidate.materializationDependencies.map(dependency => ({
      orderIndex: candidate.materializationOrder.indexOf(dependency.targetWeaponId), conversionPosition: dependency.conversionPosition,
      prerequisiteOrderIndexes: dependency.prerequisiteTargetWeaponIds.map(id => candidate.materializationOrder.indexOf(id)),
    })),
  }
}

function outcomeRecord(outcome: MaterializationOutcome): OutcomeRecord {
  if (outcome.kind !== 'materialized') return structuredClone(outcome)
  return {
    kind: 'materialized', method: outcome.method, entryId: outcome.entry.id, entrySemanticHash: hashStableValue(outcome.entry),
    plannerRequired: structuredClone(outcome.plannerRequired), deliveredBeforeMatch: outcome.deliveredBeforeMatch,
  }
}

/** The short outcome of a settled Target (journal and RESULT). */
export function targetOutcomeBrief(outcome: MaterializationOutcome | OutcomeRecord): TargetOutcomeBrief {
  switch (outcome.kind) {
    case 'materialized':
      return { kind: outcome.kind, reason: null, method: outcome.method, delivered: null, deliveredBeforeMatch: outcome.deliveredBeforeMatch }
    case 'shape_mismatch':
      return { kind: outcome.kind, reason: null, method: 'planner_alternative_reservation', delivered: outcome.delivered, deliveredBeforeMatch: null }
    case 'unconfirmed':
      return { kind: outcome.kind, reason: outcome.reason, method: outcome.reason === 'shape_search_budget_reached' ? 'shape_constrained' : 'planner_alternative_reservation', delivered: outcome.delivered, deliveredBeforeMatch: null }
    case 'not_executed':
      return { kind: outcome.kind, reason: outcome.reason, method: 'method' in outcome ? outcome.method : null, delivered: null, deliveredBeforeMatch: null }
    case 'unmeasured':
      return { kind: outcome.kind, reason: outcome.reason, method: null, delivered: null, deliveredBeforeMatch: null }
    case 'unsupported':
      return { kind: outcome.kind, reason: outcome.reason, method: 'shape_constrained', delivered: null, deliveredBeforeMatch: null }
  }
}

function summarizeReservation(reservation: PlannerAlternativeReservation, sourceEntryCount: number): ReservationSummary {
  return {
    sourceEntryCount,
    skill: { held: reservation.skill.held.length, blocked: reservation.skill.blocked.length },
    gogma: { held: reservation.gogma.held.length, blocked: reservation.gogma.blocked.length },
    normal: reservation.normal.map(entry => ({ counterId: entry.counterId, held: entry.held.length, blocked: entry.blocked.length })),
    exclusiveOwnedWeapons: reservation.exclusiveOwnedWeaponIds.length,
  }
}

function summarizeShapeAttempt(attempt: ShapeConstrainedAttempt): ShapeAttemptSummary {
  const { request } = attempt
  return {
    method: 'shape_constrained',
    materializationRule: request.rule,
    routeShape: structuredClone(request.routeShape),
    searchIdentity: request.searchIdentity,
    origins: structuredClone(request.origins),
    reservation: summarizeReservation(request.reservation, request.reservationSourceEntryIds.length),
    extent: { maxNormalAdvance: request.extent.maxNormalAdvance, maxGogmaAdvance: request.extent.maxGogmaAdvance, maxSkillAdvance: request.extent.maxSkillAdvance },
    predictedSearchScale: structuredClone(request.predictedScale),
    premiseViolations: structuredClone(request.premiseViolations),
    result: outcomeRecord(attempt.outcome),
    observed: attempt.observed === null ? null : structuredClone(attempt.observed),
    routeChecks: attempt.routeChecks === null ? null : structuredClone(attempt.routeChecks),
  }
}

function summarizeAttempt(attempt: MaterializationAttempt): AttemptSummary | ShapeAttemptSummary {
  if (attempt.method === 'shape_constrained') return summarizeShapeAttempt(attempt)
  const { request } = attempt
  const { conversionSkillPositions, ...scale } = request.scaleDetail
  return {
    method: attempt.method,
    predictedSearchScale: { ...request.predictedSearchScale },
    scale: { ...structuredClone(scale), conversionSkillPositionCount: conversionSkillPositions.length },
    reservation: attempt.method === 'planner_alternative_reservation' ? summarizeReservation(attempt.request.reservation, attempt.request.reservationSourceEntryIds.length) : null,
    extent: { maxNormalAdvance: request.extent.maxNormalAdvance, maxGogmaAdvance: request.extent.maxGogmaAdvance, maxSkillAdvance: request.extent.maxSkillAdvance },
    result: attempt.method === 'planner_alternative_reservation'
      ? outcomeRecord(attempt.outcome)
      : attempt.result.kind === 'matched' ? outcomeRecord(attempt.result.outcome) : structuredClone(attempt.result),
    observed: attempt.observed === null ? null : structuredClone(attempt.observed),
  }
}

function summarizeTarget(
  record: TargetMaterializationRecord, option: ReachOption, inspections: readonly CandidateInspection[], risk: BonusFrontierRisk | null, table: ReachTable,
  lower: { risk: BonusFrontierLowerRisk | null } | null,
): TargetMaterializationSummary {
  const attempts = record.attempts.map(summarizeAttempt)
  const summary: TargetMaterializationSummary = {
    orderIndex: record.orderIndex,
    targetWeaponId: record.targetWeaponId,
    option: {
      sourceKind: option.source.kind, sourceOwnedWeaponId: option.source.kind === 'new_normal' ? null : option.source.ownedWeaponId,
      skillRequired: structuredClone(option.skillRequired), bonusRequired: structuredClone(option.bonusRequired), normalRequired: option.normalRequired === null ? null : { ...option.normalRequired },
    },
    selection: record.selection === null ? null : structuredClone(record.selection),
    attempts,
    outcome: outcomeRecord(record.outcome),
    inspections: summarizeInspections(inspections, INSPECTION_SAMPLE_LIMIT),
    bonusFrontier: {
      static: risk === null ? null : structuredClone(risk),
      requests: risk === null ? [] : record.attempts.map(attempt => bonusFrontierRequestRisk(risk, attempt, table)),
      measured: risk === null ? null : measureBonusFrontierCollapse(risk, inspections, INSPECTION_SAMPLE_LIMIT),
    },
  }
  // `d0a2-v2` records only: a `d0a-v1` record keeps exactly the D-0B fields.
  if (lower !== null) {
    const lowerRisk = lower.risk
    summary.bonusFrontierLower = {
      static: lowerRisk === null ? null : structuredClone(lowerRisk),
      requests: lowerRisk === null ? [] : record.attempts.map(attempt => bonusFrontierLowerRequestRisk(lowerRisk, attempt)),
      measured: lowerRisk === null ? null : measureBonusFrontierLowerCollapse(lowerRisk, inspections, INSPECTION_SAMPLE_LIMIT),
    }
  }
  return summary
}

function stageRecord(stage: MaterializationStageOutcome): NonNullable<CandidateMaterializationRecord['stage']> {
  if (stage.kind === 'all_materialized') return { kind: 'all_materialized' }
  return { kind: stage.kind, targetWeaponId: stage.targetWeaponId, outcome: outcomeRecord(stage.outcome) }
}

/** One Target in a run summary (materialization order). */
export interface TargetRunSummaryRow {
  orderIndex: number
  sourceKind: string
  skill: string
  bonus: string
  outcome: TargetOutcomeBrief
  /**
   * The design 9.1 / 9.2 attempts (D-0A-2b: and the shape-constrained ones): method, predicted scale and (when the Search ran) the
   * observed delivery / work counts.
   */
  attempts: { method: MaterializationMethod; predicted: PredictedSearchScale | ShapeSearchScale; executed: boolean; delivered: number | null; workSettled: number | null; skillStates: number | null; gogmaGeneratedStates: number | null }[]
  inspected: number
  gogmaRequiredOnlyMismatches: number
  bonusFrontierStaticRisk: boolean
  bonusFrontierCollapseConditionInRequest: boolean
  /** Deliveries with the G3 collapse signature (same final Gogma position, the other required position a same-layout Reset position). */
  bonusFrontierCollapseSignatures: number
}

/** The compact summary of one run the parent script puts in its aggregated RESULT (the full semantic record stays in the run directory). */
export interface MaterializationRunSummary {
  outcome: MaterializationRunOutcome
  planningTargetCount: number
  reachPredictions: ReachTable['summary']['predictions'] | null
  structural: { outcome: StructuralStageOutcome; expandedNodes: number; coverageRejections: number; structuralCandidates: number; unexploredBranchesRemain: boolean } | null
  candidates: {
    candidateIndex: number
    ordinal: number
    objective: number
    targetCount: number
    classification: CandidateMaterializationClass
    followUp: MaterializationFollowUp['followUp']
    materializedTargetCount: number
    attemptedTargetCount: number
    notAttemptedTargetCount: number
    firstUnresolved: { orderIndex: number; outcome: OutcomeRecord } | null
    searchPolicyShapes: number
    firstSearchPolicyShapeOrderIndex: number | null
    bonusFrontier: { applicableOptions: number; withStaticRisk: number; attemptedWithCollapseCondition: number; gogmaRequiredOnlyMismatches: number; sameFinalPositionMismatches: number; collapseSignatures: number }
    plannerStartIdeal: PlannerStartIdealDiagnostics['counts'] & { targets: number }
    gateExceeded: Record<keyof PredictedSearchScale, number>
    targets: TargetRunSummaryRow[]
    /**
     * D-0A-2b, `d0a2-v2` runs only: the shape-constrained gate refusals, the G3 lower variant counts (apart from `bonusFrontier`),
     * how many Targets each method materialized, and the Search-policy shapes the shape-constrained method took on (design D0A2 6.1).
     */
    shapeConstrained?: {
      shapeGateExceeded: Record<ShapeSearchScaleComponent, number>
      bonusFrontierLower: { applicableOptions: number; withStaticRisk: number; attemptedWithCollapseCondition: number; collapseSignatures: number }
      materializedBy: Record<'candidate_search_projected' | 'shape_constrained', number>
      policyShapesTakenOn: number
    }
  }[]
  integrityIssues: string[]
}

function requirementLabel(value: ReachOption['skillRequired'] | ReachOption['bonusRequired']): string {
  switch (value.kind) {
    case 'none': return 'none'
    case 'reset_skills': return `reset_skills(${value.finalPosition})`
    case 'conversion': return `conversion(${value.conversionPosition},${value.finalPosition})`
    case 'reset': return `reset(${value.finalPosition})`
    case 'keep_from_source': return `keep_from_source(${value.finalPosition})`
    case 'reset_then_keep': return `reset_then_keep(${value.resetPosition},${value.finalPosition})`
  }
}

/** Target IDs and Entry identities stay in the semantic record; the summary carries order indexes and counts only. */
export function summarizeMaterializationRun(semantic: MaterializationSemanticRecord): MaterializationRunSummary {
  return {
    outcome: structuredClone(semantic.outcome),
    planningTargetCount: semantic.input.planningTargetCount,
    reachPredictions: semantic.reachTable.status === 'reach_table' ? { ...semantic.reachTable.summary.predictions } : null,
    structural: semantic.structuralSearch === null ? null : {
      outcome: structuredClone(semantic.structuralSearch.outcome), expandedNodes: semantic.structuralSearch.diagnostics.resource.expandedNodes,
      coverageRejections: semantic.structuralSearch.diagnostics.coverageRejections, structuralCandidates: semantic.structuralSearch.diagnostics.structuralCandidates,
      unexploredBranchesRemain: semantic.structuralSearch.unexploredBranchesRemain,
    },
    candidates: semantic.candidates.map(record => {
      const unresolved = record.firstUnresolved === null ? null : record.targets.find(target => target.orderIndex === record.firstUnresolved!.orderIndex) ?? null
      const row = {
        candidateIndex: record.candidate.candidateIndex, ordinal: record.candidate.ordinal, objective: record.candidate.objective, targetCount: record.candidate.materializationOrder.length,
        classification: record.classification, followUp: record.followUp.followUp, materializedTargetCount: record.materializedTargetCount, attemptedTargetCount: record.attemptedTargetCount,
        notAttemptedTargetCount: record.notAttemptedTargetWeaponIds.length,
        firstUnresolved: unresolved === null ? null : { orderIndex: unresolved.orderIndex, outcome: structuredClone(unresolved.outcome) },
        searchPolicyShapes: record.diagnostics.searchPolicyShapes.shapes.length, firstSearchPolicyShapeOrderIndex: record.diagnostics.searchPolicyShapes.firstOrderIndex,
        bonusFrontier: {
          applicableOptions: record.diagnostics.bonusFrontier.applicableOptions, withStaticRisk: record.diagnostics.bonusFrontier.withStaticRisk,
          attemptedWithCollapseCondition: record.targets.filter(target => target.bonusFrontier.requests.some(request => request.collapseConditionHolds)).length,
          gogmaRequiredOnlyMismatches: record.targets.reduce((sum, target) => sum + target.inspections.gogmaRequiredOnly, 0),
          sameFinalPositionMismatches: record.targets.reduce((sum, target) => sum + (target.bonusFrontier.measured?.sameFinalPositionMismatches ?? 0), 0),
          collapseSignatures: record.targets.reduce((sum, target) => sum + (target.bonusFrontier.measured?.collapseSignatures ?? 0), 0),
        },
        plannerStartIdeal: { ...record.diagnostics.plannerStartIdeal.counts, targets: record.diagnostics.plannerStartIdeal.plannerStartIdealTargets },
        gateExceeded: { ...record.gateExceeded },
        targets: record.targets.map(target => ({
          orderIndex: target.orderIndex, sourceKind: target.option.sourceKind, skill: requirementLabel(target.option.skillRequired), bonus: requirementLabel(target.option.bonusRequired),
          outcome: targetOutcomeBrief(target.outcome),
          attempts: target.attempts.map(attempt => {
            const observed = attempt.observed !== null && 'instrumentation' in attempt.observed ? attempt.observed : null
            return {
              method: attempt.method, predicted: structuredClone(attempt.predictedSearchScale), executed: attempt.observed !== null,
              delivered: observed?.deliveredCandidates ?? null, workSettled: observed?.instrumentation.workSettled ?? null,
              skillStates: observed?.instrumentation.skillStates ?? null, gogmaGeneratedStates: observed?.instrumentation.gogmaGeneratedStates ?? null,
            }
          }),
          inspected: target.inspections.inspected, gogmaRequiredOnlyMismatches: target.inspections.gogmaRequiredOnly,
          bonusFrontierStaticRisk: target.bonusFrontier.static !== null && target.bonusFrontier.static.sameLayoutResetPositions.length > 0,
          bonusFrontierCollapseConditionInRequest: target.bonusFrontier.requests.some(request => request.collapseConditionHolds),
          bonusFrontierCollapseSignatures: target.bonusFrontier.measured?.collapseSignatures ?? 0,
        })),
      }
      if (record.shapeGateExceeded === undefined) return row
      const lowerTargets = record.targets.filter(target => target.bonusFrontierLower !== undefined)
      const materializedBy = { candidate_search_projected: 0, shape_constrained: 0 }
      for (const target of record.targets) {
        if (target.outcome.kind === 'materialized' && (target.outcome.method === 'candidate_search_projected' || target.outcome.method === 'shape_constrained')) materializedBy[target.outcome.method] += 1
      }
      return {
        ...row,
        shapeConstrained: {
          shapeGateExceeded: { ...record.shapeGateExceeded },
          bonusFrontierLower: {
            applicableOptions: record.diagnostics.bonusFrontierLower?.applicableOptions ?? 0, withStaticRisk: record.diagnostics.bonusFrontierLower?.withStaticRisk ?? 0,
            attemptedWithCollapseCondition: lowerTargets.filter(target => target.bonusFrontierLower!.requests.some(request => request.collapseConditionHolds)).length,
            collapseSignatures: lowerTargets.reduce((sum, target) => sum + (target.bonusFrontierLower!.measured?.collapseSignatures ?? 0), 0),
          },
          materializedBy,
          policyShapesTakenOn: record.targets.filter(target => target.selection !== null && 'materializationRule' in target.selection && target.selection.policyShape !== null).length,
        },
      }
    }),
    integrityIssues: [...semantic.integrityIssues],
  }
}

function assertRequest(request: MaterializationRunRequest): void {
  const issues = validateMaterializationRunConditions(request.conditions)
  if (issues.length > 0) throw new RangeError(`Invalid materialization run request: ${issues.join(' ')}`)
}

/**
 * Runs Phase 0 -> A -> C-2 -> diagnostics -> D-0A over `plannerInput` with `dependencies.rngEngine` under the request's
 * conditions. Async for the Research yield / cancel seam and the Searches; the semantic record is deterministic for the
 * same input, Engine and conditions.
 */
export async function runMaterializationSmoke(plannerInput: PlannerInput, dependencies: PlannerDependencies, request: MaterializationRunRequest,
  execution: MaterializationRunExecution): Promise<MaterializationRunResult> {
  assertRequest(request)
  const { conditions } = request
  const engine = dependencies.rngEngine
  const now = execution.now
  const started = now()
  let yields = 0
  const yieldControl = async () => { if (execution.yieldControl) { yields += 1; await execution.yieldControl() } }
  const progress = (event: MaterializationProgressEvent) => execution.onProgress?.(structuredClone(event))
  const elapsed: MaterializationObservedRecord['elapsedMs'] = { context: 0, reachTable: null, structuralSearch: null, toFirstStructuralCandidate: null, candidates: [], total: 0 }
  const base = {
    protocolVersion: materializationProtocolVersion(conditions), nature: 'materialization_only: not a Production Plan, not Planner-verified' as const,
    conditions: structuredClone(conditions), window: { ...conditions.window }, oracleFreeExecution: true as const,
  }
  const finish = (semantic: Omit<MaterializationSemanticRecord, 'integrityIssues' | keyof typeof base>, issues: string[] = []): MaterializationRunResult => {
    const record: MaterializationSemanticRecord = { ...base, ...semantic, integrityIssues: [] }
    record.integrityIssues = [...issues, ...findNonPlainJsonPaths(record, 'semantic').map(path => `non-plain value at ${path}`)]
    elapsed.total = now() - started
    return { semantic: record, observed: { elapsedMs: elapsed, yields } }
  }

  // Phase 0: the planning Target set (design 4.1).
  const contextResult = createGlobalAssignmentContext(plannerInput, dependencies)
  elapsed.context = now() - started
  const input = summarizeInput(plannerInput, contextResult, dependencies)
  if (contextResult.kind !== 'context') {
    progress({ kind: 'context', status: 'unsupported_input', planningTargetCount: 0, reason: contextResult.reason })
    return finish({
      input, context: { status: 'unsupported_input', reason: contextResult.reason, detail: contextResult.detail }, reachTable: { status: 'not_reached' }, structuralSearch: null,
      candidates: [], outcome: { kind: 'unsupported_input', stage: 'context', reason: contextResult.reason },
    })
  }
  const context = contextResult.context
  progress({ kind: 'context', status: 'context', planningTargetCount: context.planningTargets.length, reason: null })

  // Phase A: the ReachTable inside the window.
  const scanStarted = now()
  const tableResult = await buildReachTable(context, engine, conditions.window, conditionReachOptionSet(conditions), { shouldCancel: execution.shouldCancel, yieldControl: execution.yieldControl })
  elapsed.reachTable = now() - scanStarted
  if (tableResult.kind === 'unsupported_input') {
    progress({ kind: 'reach_table', status: 'unsupported_input', predictions: null })
    return finish({
      input, context: { status: 'context' }, reachTable: { status: 'unsupported_input', reason: tableResult.reason, detail: tableResult.detail }, structuralSearch: null,
      candidates: [], outcome: { kind: 'unsupported_input', stage: 'reach_table', reason: tableResult.reason },
    })
  }
  if (tableResult.kind === 'cancelled') {
    progress({ kind: 'reach_table', status: 'cancelled', predictions: null })
    return finish({ input, context: { status: 'context' }, reachTable: { status: 'cancelled' }, structuralSearch: null, candidates: [], outcome: { kind: 'scan_cancelled' } })
  }
  const table = tableResult.table
  progress({ kind: 'reach_table', status: 'reach_table', predictions: { ...table.summary.predictions } })
  const reachTable = { status: 'reach_table' as const, summary: summarizeTable(table) }

  // Phase C-2: the coverage-gated structural candidate search (no upper bound), stopped after the candidate limit.
  const searchStarted = now()
  const created = createStructuralCandidateSearch({ table, context, engine }, {
    nodeBudget: conditions.nodeBudget, mrvLookahead: conditions.mrvLookahead, coverageDrivenOrdering: conditions.coverageDrivenOrdering,
    ...(execution.shouldCancel ? { shouldCancel: execution.shouldCancel } : {}),
  })
  if (created.kind === 'invalid_input') {
    elapsed.structuralSearch = now() - searchStarted
    progress({ kind: 'structural_search', status: 'invalid_input', completeness: null, expandedNodes: 0, structuralCandidates: 0, coverageRejections: 0 })
    return finish({ input, context: { status: 'context' }, reachTable, structuralSearch: null, candidates: [], outcome: { kind: 'structural_search_invalid', reason: `${created.reason}: ${created.detail}` } })
  }
  const { search } = created
  const candidates: StructuralCandidate[] = []
  let stageOutcome: StructuralStageOutcome | null = null
  while (stageOutcome === null) {
    const event = search.next(1)
    if (event.kind === 'candidate') {
      candidates.push(event.candidate)
      if (elapsed.toFirstStructuralCandidate === null) elapsed.toFirstStructuralCandidate = now() - searchStarted
      progress({ kind: 'structural_candidate', candidateIndex: candidates.length - 1, ordinal: event.candidate.ordinal, objective: event.candidate.assignment.objective, expandedNodes: search.diagnostics.resource.expandedNodes })
      if (candidates.length >= conditions.structuralCandidateLimit) stageOutcome = { kind: 'structural_candidates_found', completeness: 'candidate_limit_reached' }
      else await yieldControl()
      continue
    }
    if (event.kind === 'paused') { await yieldControl(); continue }
    if (event.completeness !== 'exhausted') stageOutcome = { kind: 'search_incomplete', completeness: event.completeness }
    else if (candidates.length > 0) stageOutcome = { kind: 'structural_candidates_found', completeness: 'exhausted' }
    else stageOutcome = { kind: 'no_structural_candidate', reason: noCandidateReason(search) }
  }
  elapsed.structuralSearch = now() - searchStarted
  const diagnostics = structuredClone(search.diagnostics)
  const structuralSearch: StructuralSearchRecord = {
    outcome: stageOutcome,
    windowDecision: decideStructuralWindowTransition(stageOutcome, 0, [conditions.window]),
    candidatesCollected: candidates.length,
    unexploredBranchesRemain: stageOutcome.kind === 'search_incomplete' || (stageOutcome.kind === 'structural_candidates_found' && stageOutcome.completeness === 'candidate_limit_reached'),
    upperBoundSupplied: false,
    diagnostics,
  }
  progress({
    kind: 'structural_search', status: stageOutcome.kind, completeness: 'completeness' in stageOutcome ? stageOutcome.completeness : null,
    expandedNodes: diagnostics.resource.expandedNodes, structuralCandidates: diagnostics.structuralCandidates, coverageRejections: diagnostics.coverageRejections,
  })
  if (candidates.length === 0) {
    if (stageOutcome.kind === 'no_structural_candidate') {
      return finish({ input, context: { status: 'context' }, reachTable, structuralSearch, candidates: [], outcome: { kind: 'no_structural_candidate', reason: stageOutcome.reason } })
    }
    if (stageOutcome.kind !== 'search_incomplete') throw new RangeError(`A structural search without a candidate ended as ${stageOutcome.kind}.`)
    return finish({ input, context: { status: 'context' }, reachTable, structuralSearch, candidates: [], outcome: { kind: 'structural_search_incomplete', completeness: stageOutcome.completeness } })
  }

  // Diagnostics and the D-0A materialization of each collected candidate, one after another.
  const records: CandidateMaterializationRecord[] = []
  const issues: string[] = []
  // D-0A-2b: a `d0a2-v2` run adds its own fields; a `d0a-v1` run writes exactly the D-0B record.
  const shapeRule = isShapeMaterializationConditions(conditions)
  for (const [candidateIndex, candidate] of candidates.entries()) {
    progress({ kind: 'candidate_started', candidateIndex, ordinal: candidate.ordinal, objective: candidate.assignment.objective, targetCount: candidate.materializationOrder.length })
    const diagnosticsStarted = now()
    const candidateDiagnostics: CandidateDiagnosticsRecord = {
      searchPolicyShapes: diagnoseSearchPolicyShapes(candidate, table),
      continuationOptions: countContinuationOptions(candidate, table),
      bonusFrontier: diagnoseBonusFrontierRisk(candidate, table),
      plannerStartIdeal: diagnosePlannerStartIdeal(candidate, context),
    }
    if (shapeRule) candidateDiagnostics.bonusFrontierLower = diagnoseBonusFrontierLowerRisk(candidate, table)
    const diagnosticsMs = now() - diagnosticsStarted
    const materializationStarted = now()
    const settled: TargetMaterializationRecord[] = []
    const inspections = new Map<TargetWeaponId, CandidateInspection[]>()
    const targetTimes: MaterializationObservedRecord['elapsedMs']['candidates'][number]['targets'] = []
    let targetStartedAt = 0
    // D-0B-2 (d0a2-v2 runs only): execution-only inspection times of the Target in progress.
    let timeline: ShapeTargetTimeline = { projectedInspectedMs: null, shapeInspectedMs: null }
    let failClosed: CandidateMaterializationRecord['failClosed'] = null
    let stage: MaterializationStageOutcome | null = null
    let notAttemptedFromRun: TargetWeaponId[] | null = null
    const observer: MaterializationObserver = {
      onTargetStarted: event => {
        targetStartedAt = now()
        timeline = { projectedInspectedMs: null, shapeInspectedMs: null }
        progress({ kind: 'target_started', candidateIndex, orderIndex: event.orderIndex, targetWeaponId: event.targetWeaponId })
      },
      onCandidateInspected: inspection => {
        inspections.set(inspection.targetWeaponId, [...(inspections.get(inspection.targetWeaponId) ?? []), inspection])
        if (shapeRule && inspection.method === 'candidate_search_projected') timeline.projectedInspectedMs = now() - targetStartedAt
        if (shapeRule && inspection.method === 'shape_constrained') timeline.shapeInspectedMs = now() - targetStartedAt
      },
      onTargetSettled: record => {
        settled.push(record)
        targetTimes.push({ orderIndex: record.orderIndex, targetWeaponId: record.targetWeaponId, ms: now() - targetStartedAt, ...(shapeRule ? { shapeTimeline: { ...timeline } } : {}) })
        progress({ kind: 'target_settled', candidateIndex, orderIndex: record.orderIndex, targetWeaponId: record.targetWeaponId, outcome: targetOutcomeBrief(record.outcome) })
      },
    }
    try {
      const result = isShapeMaterializationConditions(conditions)
        ? await materializeStructuralCandidate(candidate, {
          rule: 'd0a2-v2', context, table, engine,
          settings: {
            projectedSearchScaleGate: { ...conditions.projectedSearchScaleGate }, shapeSearchScaleGate: { ...conditions.shapeSearchScaleGate },
            shapeSearchBudget: structuredClone(conditions.shapeSearchBudget),
          },
          ...(execution.shapeSearch ? { search: execution.shapeSearch } : {}),
          ...(execution.shouldCancel ? { shouldCancel: execution.shouldCancel } : {}),
          ...(execution.yieldControl ? { yieldControl } : {}),
          observer,
        })
        : await materializeStructuralCandidate(candidate, {
          context, table, engine,
          settings: { deliveryCap: conditions.deliveryCap, searchScaleGate: { ...conditions.searchScaleGate } },
          searchPolicyPrecheck: conditions.searchPolicyPrecheck,
          ...(execution.search ? { search: execution.search } : {}),
          ...(execution.shouldCancel ? { shouldCancel: execution.shouldCancel } : {}),
          ...(execution.yieldControl ? { yieldControl } : {}),
          observer,
        })
      if (result.kind === 'invalid_input') failClosed = { code: `invalid_input:${result.reason}`, targetWeaponId: null, message: result.detail }
      else {
        stage = result.outcome
        notAttemptedFromRun = [...result.notAttemptedTargetWeaponIds]
      }
    } catch (error) {
      if (error instanceof GlobalAssignmentMaterializationError) {
        failClosed = { code: error.code, targetWeaponId: error.targetWeaponId, message: error.message, ...(error.detail === undefined ? {} : { detail: structuredClone(error.detail) }) }
      } else if (error instanceof GlobalAssignmentInvariantError) failClosed = { code: `invariant:${error.code}`, targetWeaponId: null, message: error.message }
      else throw error
    }
    const materializationMs = now() - materializationStarted
    const riskByTarget = new Map(candidateDiagnostics.bonusFrontier.targets.map(row => [row.targetWeaponId, row]))
    const lowerByTarget = new Map((candidateDiagnostics.bonusFrontierLower?.targets ?? []).map(row => [row.targetWeaponId, row]))
    const targets = settled.map(record => summarizeTarget(record, candidate.assignment.chosen.get(record.targetWeaponId)!, inspections.get(record.targetWeaponId) ?? [], riskByTarget.get(record.targetWeaponId) ?? null, table,
      shapeRule ? { risk: lowerByTarget.get(record.targetWeaponId) ?? null } : null))
    const materializedTargetCount = settled.filter(record => record.outcome.kind === 'materialized').length
    const unresolved = settled.find(record => record.outcome.kind !== 'materialized') ?? null
    const attemptedIds = new Set(settled.map(record => record.targetWeaponId))
    // A fail-closed stop leaves the Targets after the last settled one unattempted (the stopping Target included when it never settled).
    const notAttempted = notAttemptedFromRun ?? candidate.materializationOrder.filter(id => !attemptedIds.has(id))
    const classification: CandidateMaterializationClass = stage === null ? 'fail_closed' : classifyMaterializationStage(stage)
    const gateExceeded: Record<keyof PredictedSearchScale, number> = { conversionPositions: 0, gogmaLegalWidth: 0, skillLegalWidth: 0, normalForgeCount: 0 }
    const shapeGateExceeded: Record<ShapeSearchScaleComponent, number> = { depthUpperBound: 0, gogmaGeneratedStateUpperBound: 0, normalForgeCount: 0, conversionWalkPositions: 0 }
    for (const record of settled) for (const attempt of record.attempts) {
      if (attempt.method === 'shape_constrained') {
        if (attempt.outcome.kind === 'not_executed') for (const key of attempt.outcome.exceeded) shapeGateExceeded[key] += 1
        continue
      }
      const gated = attempt.method === 'planner_alternative_reservation' ? attempt.outcome : attempt.result
      if (gated.kind === 'not_executed' && gated.reason === 'search_scale_gate' && !('method' in gated)) for (const key of gated.exceeded) gateExceeded[key] += 1
    }
    if (failClosed !== null) issues.push(`candidate ${candidateIndex}: the materialization failed closed (${failClosed.code}${failClosed.targetWeaponId ? `, ${failClosed.targetWeaponId}` : ''})`)
    records.push({
      candidate: summarizeCandidate(candidate, candidateIndex),
      diagnostics: candidateDiagnostics,
      classification,
      followUp: materializationFollowUp(classification),
      stage: stage === null ? null : stageRecord(stage),
      firstUnresolved: unresolved === null ? null : { orderIndex: unresolved.orderIndex, targetWeaponId: unresolved.targetWeaponId },
      attemptedTargetCount: settled.length,
      materializedTargetCount,
      notAttemptedTargetWeaponIds: notAttempted,
      targets,
      gateExceeded,
      ...(shapeRule ? { shapeGateExceeded } : {}),
      failClosed,
    })
    elapsed.candidates.push({ candidateIndex, diagnostics: diagnosticsMs, materialization: materializationMs, targets: targetTimes })
    progress({ kind: 'candidate_settled', candidateIndex, classification, materializedTargetCount, notAttemptedTargetCount: notAttempted.length })
    // A fail-closed stop is an error of the run and a cancellation stops the run: no later candidate is materialized.
    if (failClosed !== null || (stage?.kind === 'materialization_unconfirmed' && stage.outcome.kind === 'unmeasured')) break
  }
  return finish({
    input, context: { status: 'context' }, reachTable, structuralSearch, candidates: records,
    outcome: { kind: 'structural_candidates_materialized', classifications: records.map(record => record.classification) },
  }, issues)
}
