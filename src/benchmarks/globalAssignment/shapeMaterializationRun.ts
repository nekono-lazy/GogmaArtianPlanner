/**
 * Issue #154 Global Assignment Phase D-0A-2b (Research only; never imported by the app).
 *
 * The execution and the classification of one shape-constrained request (`docs/PLANNER_GLOBAL_ASSIGNMENT_D0A2_DESIGN.md`
 * 5.4 / 5.5 / 9.3 / 10). In order:
 *
 *   premise check (5.5 position premises)  -> fail closed `shape_base_unavailable`
 *   gate (10.3)                            -> `not_executed(search_scale_gate)`, no Search API call
 *   the D-0A-2a seam `visitShapeConstrainedRouteCandidates()` through a counting Engine, with the Research budget (10.4)
 *     read at every Search checkpoint through `shouldCancel` - a budget stop and a user / runner cancel are told apart by
 *     what decided the stop when it happened, never by the counters afterwards
 *   the first delivered Candidate -> deterministic materialization -> `matchExpectedShape()` -> the independent Route checks
 *     (9.3); any failure fails closed instead of trying another Candidate
 *   the classification of 10.1 (support questions sorted into the five 区分 against the Phase A judgements of 3.10)
 *
 * The lemma (5.5) is never used as a proof of this code: a premise that does not hold is reported, never assumed. Nothing
 * here reads or edits the reservation beyond passing the formal one to the seam, and nothing is persisted.
 */
import type { BuildListEntry, ISODateTimeString } from '../../domain/models/publicTypes'
import { createDeterministicMaterializer } from '../../domain/planner/replacement/plannerDeterministicMaterializer'
import { ConstrainedMaterializationError } from '../../domain/planner/replacement/plannerMaterializationErrors'
import { createPlannerStartSearchOrigin, resolvePlannerSearchOriginTarget } from '../../domain/planner/replacement/plannerSearchOrigin'
import { keepFamilyLayoutKey } from '../../domain/rng/gogmaBonusFamily'
import type { RngEngine } from '../../domain/rng/rngEngine'
import type { PlannerAlternativeCandidate, PlannerAlternativeSearchInstrumentation } from '../../domain/search/alternative'
import type { UnsupportedAmendmentPrediction } from '../../domain/search/bonusStream'
import {
  ShapeConstrainedSearchError, visitShapeConstrainedRouteCandidates, type ShapeBaseUnavailableReason, type ShapeConstrainedSearchExecution,
} from '../../domain/search/research'
import { CandidateSearchError } from '../../domain/search/searchTypes'
import { createPredictionCountingEngine, snapshotCounts } from './countingRngEngine'
import { matchExpectedShape } from './materializationShape'
import { GlobalAssignmentMaterializationError, type CandidateInspection, type ObservedPlannerAlternativeSearch } from './materializationTypes'
import { exceededShapeSearchBudget, exceededShapeSearchScaleGate } from './shapeMaterializationScale'
import {
  SHAPE_CONSTRAINED_CANDIDATE_ID_PREFIX,
  type RouteCheckReport, type ShapeConstrainedAttempt, type ShapeConstrainedMaterializationRequest, type ShapeConstrainedOutcome, type ShapeMaterializationSettings,
  type ShapeSearchObserved, type ShapeSearchStop, type ShapeUnsupportedDetail, type SupportQuestion, type SupportQuestionRecord, type PhaseASupportJudgement,
} from './shapeMaterializationTypes'
import { verifyShapeConstrainedRoute } from './shapeRouteVerification'
import type { GlobalAssignmentContext, ReachTable, TargetReach } from './types'

/** The D-0A-2a seam entry point, injectable so a test can observe or stand in for it. */
export type ShapeConstrainedSearchVisit = typeof visitShapeConstrainedRouteCandidates

export interface ShapeRunDependencies {
  context: GlobalAssignmentContext
  table: ReachTable
  engine: RngEngine
  settings: ShapeMaterializationSettings
  /** The Entries materialized before this Target, in order (the formal reservation's only source; the Route checks derive it again). */
  materializedEntries: readonly BuildListEntry[]
  /** The PlannerInput's own Entries, read by the deterministic materializer's ID-collision / reuse rule only. */
  collisionCheckEntries: readonly BuildListEntry[]
  /** The fixed display-only `createdAt` of a materialized Entry (never a run-dependent value). */
  researchTime: ISODateTimeString
  visit?: ShapeConstrainedSearchVisit
  shouldCancel?: () => boolean
  yieldControl?: () => Promise<void>
  onInspected?: (inspection: CandidateInspection) => void
}

function emptyInstrumentation(): ObservedPlannerAlternativeSearch['instrumentation'] {
  return {
    workSettled: 0, skillStreams: 0, skillDepths: 0, skillStates: 0, maxSkillStatesPerDepth: 0, skillTransitions: 0,
    gogmaStreams: 0, gogmaDepths: 0, gogmaGeneratedStates: 0, maxGogmaFrontierStates: 0,
  }
}

function rowOf(table: ReachTable, request: ShapeConstrainedMaterializationRequest): TargetReach {
  const row = table.targets.find(value => value.targetWeaponId === request.targetWeaponId)
  if (row === undefined) throw new GlobalAssignmentMaterializationError('invalid_shape', request.targetWeaponId, `Target ${request.targetWeaponId} has no ReachTable row.`)
  return row
}

/**
 * Design 3.10 / 10.1: whether Phase A answered the same support question. Normal / Skill / Reset are per weapon type x element
 * (`TargetReach.support`); Keep is per family layout - the source's (`source.keepSupported`) or a layout of interest
 * (`keepIdealPositionsByLayout` / `keepUnsupportedLayouts`). Phase A never reads an Engine capability flag.
 */
export function phaseASupportJudgement(row: TargetReach, request: ShapeConstrainedMaterializationRequest, question: SupportQuestion): PhaseASupportJudgement {
  switch (question.prediction) {
    case 'normal_artian': return row.support.normal ? 'supported' : 'unsupported'
    case 'skill': return row.support.skill ? 'supported' : 'unsupported'
    case 'gogma_reset': return row.support.gogmaReset ? 'supported' : 'unsupported'
    case 'gogma_keep': {
      const source = request.shape.option.source
      if (question.layout === source.layout) return source.keepSupported ? 'supported' : 'unsupported'
      if (row.bonus.keepIdealPositionsByLayout.has(question.layout)) return 'supported'
      return row.bonus.keepUnsupportedLayouts.includes(question.layout) ? 'unsupported' : 'not_judged'
    }
  }
}

/**
 * The family layout every Keep of the shape's Bonus lane reads (the seam's policy fixes it): a `keep` lane keeps the source's
 * slots, a `reset_then_keep` lane the Reset result at `g1` (Phase A recorded its layout). Keep preserves the families, so one
 * layout stands for every Keep input of the lane (the family-only Keep contract, design 5.5 P5).
 */
function keepQuestionLayout(row: TargetReach, request: ShapeConstrainedMaterializationRequest): string | null {
  const bonus = request.routeShape.bonus
  if (bonus.kind === 'keep') return request.shape.option.source.layout
  if (bonus.kind === 'reset_then_keep') return row.bonus.resetLayoutByPosition.get(bonus.resetPosition) ?? null
  return null
}

function questionOf(row: TargetReach, request: ShapeConstrainedMaterializationRequest, prediction: SupportQuestion['prediction'], context: GlobalAssignmentContext): SupportQuestion | null {
  const common = { weaponTypeId: row.weaponTypeId, elementId: row.elementId }
  if (prediction !== 'gogma_keep') return { prediction, ...common }
  const base = request.routeShape.base
  // The base diagnosis asks Keep of an owned source's own slots (a `keep` lane only).
  const owned = base.kind === 'new_normal' ? undefined : context.plannerInput.ownedWeapons.find(weapon => weapon.id === base.ownedWeaponId)
  const layout = request.routeShape.bonus.kind === 'keep' && owned !== undefined ? keepFamilyLayoutKey(owned.restorationBonuses, context.plannerInput.master) : keepQuestionLayout(row, request)
  return layout === null ? null : { prediction, ...common, layout }
}

const STREAM_PREDICTION: Record<UnsupportedAmendmentPrediction['type'], SupportQuestion['prediction']> = { reset_bonuses: 'gogma_reset', keep_bonuses: 'gogma_keep' }

/** A base unavailability, sorted into the 区分 of design 10.1: a fail-closed premise, an inconsistency or an `unsupported` fact. */
function classifyUnavailable(unavailable: ShapeBaseUnavailableReason, request: ShapeConstrainedMaterializationRequest, deps: ShapeRunDependencies): ShapeConstrainedOutcome {
  const targetWeaponId = request.targetWeaponId
  switch (unavailable.kind) {
    case 'source_not_found': case 'source_incompatible': case 'source_exclusive': case 'source_protected': case 'source_not_convertible':
    case 'normal_counter_unavailable': case 'production_target_blocked': case 'production_target_outside_extent': case 'conversion_position_not_legal':
      throw new GlobalAssignmentMaterializationError('shape_base_unavailable', targetWeaponId, `Target ${targetWeaponId}: the shape's Route base is unavailable (${unavailable.kind}).`, { origin: 'base_diagnosis', unavailable })
    case 'capability_unavailable': {
      // 区分 3: Phase 0 / A required every confirmed RNG input, so an unconfirmed one here contradicts the run's premises.
      if (unavailable.cause === 'rng_input_unconfirmed') {
        throw new GlobalAssignmentMaterializationError('shape_base_unavailable', targetWeaponId, `Target ${targetWeaponId}: an RNG input of ${unavailable.capability} is unconfirmed, which Phase 0 / A required.`, { origin: 'base_diagnosis', unavailable })
      }
      return { kind: 'unsupported', reason: 'capability_unavailable', detail: { origin: 'base_diagnosis', unavailable, predictions: [], questions: [] } }
    }
    case 'prediction_unsupported': {
      const row = rowOf(deps.table, request)
      const question = questionOf(row, request, unavailable.prediction, deps.context)
      const record: SupportQuestionRecord[] = question === null ? [] : [{ question, phaseA: phaseASupportJudgement(row, request, question) }]
      if (record.some(value => value.phaseA === 'supported')) {
        throw new GlobalAssignmentMaterializationError('prediction_support_inconsistent', targetWeaponId,
          `Target ${targetWeaponId}: Phase A judged ${unavailable.prediction} supported, the Search answers unsupported (${unavailable.reason}).`, { origin: 'base_diagnosis', unavailable, questions: record })
      }
      return { kind: 'unsupported', reason: 'required_prediction_unsupported', detail: { origin: 'base_diagnosis', unavailable, predictions: [], questions: record } }
    }
  }
}

function classifyStreamUnsupported(predictions: UnsupportedAmendmentPrediction[], request: ShapeConstrainedMaterializationRequest, deps: ShapeRunDependencies): ShapeConstrainedOutcome {
  const row = rowOf(deps.table, request)
  const questions: SupportQuestionRecord[] = []
  for (const prediction of predictions) {
    const question = questionOf(row, request, STREAM_PREDICTION[prediction.type], deps.context)
    if (question !== null && !questions.some(value => JSON.stringify(value.question) === JSON.stringify(question))) questions.push({ question, phaseA: phaseASupportJudgement(row, request, question) })
  }
  const detail: ShapeUnsupportedDetail = { origin: 'bonus_stream', unavailable: null, predictions: structuredClone(predictions), questions }
  if (questions.some(value => value.phaseA === 'supported')) {
    throw new GlobalAssignmentMaterializationError('prediction_support_inconsistent', request.targetWeaponId,
      `Target ${request.targetWeaponId}: Phase A judged a needed Bonus prediction supported, the Bonus stream reported it unsupported.`, detail)
  }
  return { kind: 'unsupported', reason: 'required_prediction_unsupported', detail }
}

function wrapMaterializerError(request: ShapeConstrainedMaterializationRequest, error: unknown): never {
  if (error instanceof ConstrainedMaterializationError) {
    throw new GlobalAssignmentMaterializationError('entry_materialization_refused', request.targetWeaponId, `${error.code}: ${error.message}`)
  }
  throw error
}

/**
 * Design 5.4 steps 4 - 7 for a request already re-derived by the caller. Returns the attempt (materialized, budget stop,
 * gate, unsupported, cancel) or throws `GlobalAssignmentMaterializationError` for every fail-closed end.
 */
export async function runShapeConstrainedRequest(request: ShapeConstrainedMaterializationRequest, deps: ShapeRunDependencies): Promise<ShapeConstrainedAttempt> {
  const { context, settings } = deps
  const targetWeaponId = request.targetWeaponId
  if (request.premiseViolations.length > 0) {
    throw new GlobalAssignmentMaterializationError('shape_base_unavailable', targetWeaponId,
      `Target ${targetWeaponId}: a position premise of the minimal Route lemma does not hold (${request.premiseViolations.map(value => value.kind).join(', ')}).`,
      { origin: 'premise_check', violations: structuredClone(request.premiseViolations) })
  }
  const exceeded = exceededShapeSearchScaleGate(request.predictedScale, settings.shapeSearchScaleGate)
  if (exceeded.length > 0) {
    return { method: 'shape_constrained', request, outcome: { kind: 'not_executed', reason: 'search_scale_gate', method: 'shape_constrained', predicted: structuredClone(request.predictedScale), exceeded }, observed: null, routeChecks: null }
  }

  const origin = createPlannerStartSearchOrigin(context.plannerInput)
  const materializer = createDeterministicMaterializer<PlannerAlternativeCandidate>({
    origin,
    target: resolvePlannerSearchOriginTarget(origin, targetWeaponId),
    searchIdentity: request.searchIdentity,
    candidateIdPrefix: SHAPE_CONSTRAINED_CANDIDATE_ID_PREFIX,
    clock: { now: () => deps.researchTime },
  })
  const counting = createPredictionCountingEngine(deps.engine)
  const counters = emptyInstrumentation()
  // Execution-only observers: the Search's results are identical with and without them.
  const instrumentation: PlannerAlternativeSearchInstrumentation = {
    onWorkSettled: () => { counters.workSettled += 1 },
    onSkillReservedDepth: observation => {
      counters.skillStreams = Math.max(counters.skillStreams, observation.streamIndex + 1)
      counters.skillDepths += 1
      counters.skillStates += observation.states
      counters.maxSkillStatesPerDepth = Math.max(counters.maxSkillStatesPerDepth, observation.states)
      counters.skillTransitions += observation.transitions
    },
    onGogmaReservedDepth: observation => {
      counters.gogmaStreams = Math.max(counters.gogmaStreams, observation.streamIndex + 1)
      counters.gogmaDepths += 1
      counters.gogmaGeneratedStates += observation.generatedStates
      counters.maxGogmaFrontierStates = Math.max(counters.maxGogmaFrontierStates, observation.frontierStates)
    },
  }
  const budgetExceeded = () => exceededShapeSearchBudget({
    gogmaGeneratedStates: counters.gogmaGeneratedStates, skillStates: counters.skillStates, settledWork: counters.workSettled, predictions: counting.counts,
  }, settings.shapeSearchBudget)
  // The first reason that made `shouldCancel` true, recorded when it happened.
  let decided: ShapeSearchStop | null = null
  const shouldCancel = () => {
    if (decided !== null) return true
    if (deps.shouldCancel?.()) {
      decided = { by: 'cancel', budgetExceeded: budgetExceeded() }
      return true
    }
    const over = budgetExceeded()
    if (over.length > 0) {
      decided = { by: 'budget', budgetExceeded: over }
      return true
    }
    return false
  }
  const state: { delivered: number; accepted: Extract<ShapeConstrainedOutcome, { kind: 'materialized' }> | null; routeChecks: RouteCheckReport | null } = { delivered: 0, accepted: null, routeChecks: null }
  const observe = (execution: ShapeConstrainedSearchExecution | null, stop: ShapeSearchStop): ShapeSearchObserved => ({
    deliveredCandidates: state.delivered,
    execution: execution === null ? null : {
      summary: { ...execution.summary }, stoppedByConsumer: execution.stoppedByConsumer, base: structuredClone(execution.base),
      requiredUnsupportedPredictions: structuredClone(execution.requiredUnsupportedPredictions), forbiddenOperationNotices: execution.forbiddenOperationNotices,
    },
    instrumentation: { ...counters },
    searchPredictions: snapshotCounts(counting.counts),
    stop,
  })

  let execution: ShapeConstrainedSearchExecution
  try {
    execution = await (deps.visit ?? visitShapeConstrainedRouteCandidates)(
      { origin, targetWeaponId, extent: { ...request.extent }, reservation: request.reservation, shape: structuredClone(request.routeShape) },
      counting.engine,
      candidate => {
        state.delivered += 1
        if (state.delivered > 1) {
          throw new GlobalAssignmentMaterializationError('shape_search_contract_violation', targetWeaponId, `Target ${targetWeaponId}: the Search delivered past the consumer stop.`)
        }
        let entry: BuildListEntry
        try {
          entry = materializer.materializeBuildListEntry(candidate, deps.collisionCheckEntries).entry
        } catch (error) {
          wrapMaterializerError(request, error)
        }
        const match = matchExpectedShape(entry, request.shape, deps.engine)
        deps.onInspected?.({ targetWeaponId, method: 'shape_constrained', deliveredIndex: 1, match: structuredClone(match) })
        if (!match.matches) {
          throw new GlobalAssignmentMaterializationError('match_inconsistent', targetWeaponId,
            `Target ${targetWeaponId}: the first shape-constrained delivery does not match its shape (${match.reasons.join(', ')}).`, { reasons: [...match.reasons], plannerRequired: match.plannerRequired })
        }
        // The checks include `validateBuildCandidate()` / `validateBuildListEntry()` (design 9.3 item 5).
        const routeChecks = verifyShapeConstrainedRoute({ entry, request, context, table: deps.table, materializedEntries: deps.materializedEntries, engine: deps.engine })
        state.routeChecks = routeChecks
        if (!routeChecks.passed) {
          throw new GlobalAssignmentMaterializationError('route_verification_failed', targetWeaponId,
            `Target ${targetWeaponId}: the independent Route checks failed (${routeChecks.issues.map(value => value.code).join(', ')}).`, { routeChecks })
        }
        state.accepted = { kind: 'materialized', method: 'shape_constrained', entry, plannerRequired: match.plannerRequired, deliveredBeforeMatch: 0 }
        return 'stop'
      },
      { shouldCancel, yieldControl: deps.yieldControl, instrumentation },
    )
  } catch (error) {
    if (error instanceof GlobalAssignmentMaterializationError) throw error
    if (error instanceof CandidateSearchError && error.code === 'cancelled') {
      const stop = decided as ShapeSearchStop | null
      if (stop === null) {
        throw new GlobalAssignmentMaterializationError('shape_search_contract_violation', targetWeaponId, `Target ${targetWeaponId}: the Search reported a cancellation nobody asked for.`)
      }
      const outcome: ShapeConstrainedOutcome = stop.by === 'budget'
        ? { kind: 'unconfirmed', reason: 'shape_search_budget_reached', budgetExceeded: [...stop.budgetExceeded], delivered: 0, closestMismatch: null }
        : { kind: 'unmeasured', reason: 'cancelled' }
      return { method: 'shape_constrained', request, outcome, observed: observe(null, stop), routeChecks: state.routeChecks }
    }
    if (error instanceof ShapeConstrainedSearchError) {
      const code = error.code === 'shape_search_contract_violation' ? 'shape_search_contract_violation' : 'search_refused'
      throw new GlobalAssignmentMaterializationError(code, targetWeaponId, `${error.code}: ${error.message}`)
    }
    if (error instanceof CandidateSearchError) throw new GlobalAssignmentMaterializationError('search_refused', targetWeaponId, `${error.code}: ${error.message}`)
    throw error
  }

  const stop: ShapeSearchStop = { by: execution.stoppedByConsumer ? 'consumer' : 'search_end', budgetExceeded: budgetExceeded() }
  const observed = observe(execution, stop)
  const attempt = (outcome: ShapeConstrainedOutcome): ShapeConstrainedAttempt => ({ method: 'shape_constrained', request, outcome, observed, routeChecks: state.routeChecks })
  if (state.accepted !== null) return attempt(state.accepted)
  // Design 10.1 order: base reach, then delivery, then the needed predictions, then the lemma.
  if (execution.base.unavailable !== null) return attempt(classifyUnavailable(execution.base.unavailable, request, deps))
  if (!execution.base.admitted) {
    throw new GlobalAssignmentMaterializationError('shape_search_contract_violation', targetWeaponId, `Target ${targetWeaponId}: the Search admitted no base and reported no reason.`)
  }
  if (execution.stoppedByConsumer || state.delivered > 0) {
    throw new GlobalAssignmentMaterializationError('shape_search_contract_violation', targetWeaponId, `Target ${targetWeaponId}: a consumer stop without an accepted Candidate.`)
  }
  if (execution.requiredUnsupportedPredictions.length > 0) return attempt(classifyStreamUnsupported(execution.requiredUnsupportedPredictions, request, deps))
  const { exhausted, stoppedByExtent } = execution.summary
  if (exhausted || stoppedByExtent) {
    throw new GlobalAssignmentMaterializationError('shape_constrained_unreachable', targetWeaponId,
      `Target ${targetWeaponId}: the base was admitted, no needed prediction was unsupported, and the Search ended (exhausted ${exhausted}, stoppedByExtent ${stoppedByExtent}) without the shape: a premise of the minimal Route lemma does not hold (never "no Route").`,
      { observed })
  }
  throw new GlobalAssignmentMaterializationError('shape_search_contract_violation', targetWeaponId,
    `Target ${targetWeaponId}: the Search ended with neither exhausted, stoppedByExtent nor a consumer stop.`)
}
