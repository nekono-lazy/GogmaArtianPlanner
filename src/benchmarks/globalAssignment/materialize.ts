/**
 * Issue #154 Global Assignment Phase D-0A (Research only; never imported by the app).
 *
 * Materializes one Phase C `StructuralCandidate` through the existing Production Search APIs
 * (`docs/PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md` 4.5 / 9.0 - 9.7): the Targets are taken in the candidate's
 * materialization order, each Target's Search returns ordinary Production Candidates, a Candidate is
 * accepted only when its Entry matches the Target's `ExpectedRouteShape` (`matchExpectedShape()`), and
 * only accepted Entries reach the reservation of a later Target. The run stops at the first Target
 * without a matching Entry and keeps everything up to it. No Planner run, Trace Replay, conflict
 * resolution or persistence happens here (Phase D' and the runner are later Phases).
 *
 * Design 9.1 (`planner_alternative_reservation`): the Planner-start origin is
 * `createPlannerStartSearchOrigin()`; the reservation is `emptyPlannerAlternativeReservation` for the first
 * Target and `derivePlannerAlternativeReservation(materialized Entries)` afterwards, passed unchanged (no
 * held / blocked / exclusive weapon is added for a Target not materialized yet, and none is edited to
 * steer the shape); `excludedRouteKeys` is empty; the extent ends at the shape's last required positions.
 * `visitPlannerAlternativeCandidates()` delivers Candidates in its own order; each one is materialized by
 * the shared deterministic materializer and matched; the first match is accepted. The outcome is read
 * from the Search's own report: a match is `materialized`, a consumer stop at the delivery cap
 * `unconfirmed(delivery_cap_reached)`, `summary.exhausted` without a match `shape_mismatch`, and
 * `summary.stoppedByExtent` without a match `unconfirmed(stopped_by_extent)` (even when every expected
 * position is inside the extent). A cancellation is `unmeasured(cancelled)`.
 *
 * Design 9.2 (`candidate_search_projected`): for a continuous shape, one ordinary `searchCandidates()` from
 * the projected start of each stream (the first own position), with the source alone as inventory and the
 * minimal extent; a matching canonical Ideal is rebuilt at the Planner-start origin by the existing adapter
 * `materializeGlobalResearchCandidate()` (`createConstrainedCandidate(..., 'origin_reach')` plus the
 * deterministic materializer; no Search hash is rewritten). A non-match is this method's limit and never
 * decides the Target outcome.
 *
 * Design 9.3 (method choice, per Target, deterministic): a non-continuous shape uses design 9.1 only; a
 * continuous conversion Target tries design 9.2 first and design 9.1 once when it does not match; a
 * continuous owned Gogma tries design 9.1 first only when its predicted scale is smaller in the Pareto sense
 * (`isSmallerSearchScale()`; a tie or an incomparable pair goes to design 9.2), switches from 9.2 to 9.1 when
 * 9.2 does not match, and from 9.1 to 9.2 only after a 9.1 `shape_mismatch`. The Target outcome is always
 * design 9.1's unless design 9.2 matched.
 *
 * Design 9.7: every request carries the scale predicted from its reservation and extent; a request above
 * the caller's gate is `not_executed(search_scale_gate)` and no Search API is called.
 *
 * Fail closed (design 9.4): a request that differs from its re-derivation, a refused reservation
 * derivation, a Search rejecting a derived input, a deterministic-ID collision with different content or a
 * Candidate the materializer refuses all throw `GlobalAssignmentMaterializationError`; none is read as an
 * outcome. Process-level ends (timeout, out of memory, process failure) are not observable here; the D-0B
 * runner that owns the process assigns them.
 *
 * Phase D-0B (design 19.3 G1 / 10.3) added two opt-ins that leave the D-0A behaviour unchanged when absent:
 * `searchPolicyPrecheck` classifies a Target whose shape the Production Search policy never returns
 * (`searchPolicyShapeOf()`) as `not_executed(search_policy_shape)` before any request or Search, and `observer`
 * receives execution-only copies of the Target starts, the inspected Candidates and the settled Target records.
 */
import { createBuildListEntry } from '../../domain/buildList'
import { hashStableValue, stableStringify, validateBuildListEntry } from '../../domain/models/publicTypes'
import type { BuildCandidate, BuildListEntry, TargetWeapon } from '../../domain/models/publicTypes'
import { createPlannerAlternativeSearchIdentity } from '../../domain/planner/alternative/plannerAlternativeMaterializer'
import { derivePlannerAlternativeReservation, PlannerAlternativeReservationError } from '../../domain/planner/alternative/plannerAlternativeReservation'
import { createDeterministicMaterializer, type DeterministicMaterializer } from '../../domain/planner/replacement/plannerDeterministicMaterializer'
import { ConstrainedMaterializationError } from '../../domain/planner/replacement/plannerMaterializationErrors'
import { createPlannerStartSearchOrigin, normalizePlannerSearchOrigin, resolvePlannerSearchOriginTarget } from '../../domain/planner/replacement/plannerSearchOrigin'
import type { RngEngine } from '../../domain/rng/rngEngine'
import {
  emptyPlannerAlternativeReservation, PlannerAlternativeSearchError, visitPlannerAlternativeCandidates,
  type PlannerAlternativeCandidate, type PlannerAlternativeReservation, type PlannerAlternativeSearchExecution, type PlannerAlternativeSearchInstrumentation,
} from '../../domain/search/alternative'
import { searchCandidates } from '../../domain/search/candidateSearch'
import { CandidateSearchError, type CandidateSearchInput, type CandidateSearchResult } from '../../domain/search/searchTypes'
import { GLOBAL_RESEARCH_TIME, materializeGlobalResearchCandidate } from '../plannerGlobalOptimizationResearch'
import type { ExpectedRouteShape, StructuralCandidate } from './coverageTypes'
import { exceededSearchScaleGate, isSmallerSearchScale, isValidSearchScaleGate, predictSearchScale } from './materializationScale'
import {
  matchExpectedShape, plannerStartOrigins, searchPolicyShapeOf, shapeOwnPositions, shapeSearchExtent, type ShapeOwnPositions, type StreamOrigins,
} from './materializationShape'
import {
  GlobalAssignmentMaterializationError,
  type CandidateInspection, type MaterializationAttempt, type MaterializationObserver, type MaterializationOutcome, type MaterializationSettings,
  type MaterializationStageOutcome, type MethodSelection,
  type ObservedPlannerAlternativeSearch, type PlannerAlternativeAttempt, type PlannerAlternativeMaterializationRequest, type PredictedSearchScale,
  type ProjectedAttempt, type ProjectedMaterializationRequest, type ProjectedSearchOrigin, type ShapeMismatch, type StructuralCandidateMaterialization,
  type StructuralCandidateMaterializationResult, type TargetMaterializationRecord,
} from './materializationTypes'
import { buildStructuralCandidate, checkTableBelongsToContext } from './structuralCandidate'
import type { GlobalAssignmentContext, ReachTable } from './types'

/** The Research algorithm token of every D-0A search identity and Candidate ID (design 9.4). */
export const GLOBAL_ASSIGNMENT_MATERIALIZATION_ALGORITHM = 'global-assignment-d0a-materialization-v1'
const CANDIDATE_ID_PREFIX = 'candidate.research.global-assignment.'
/** A fixed Clock: an Entry's `createdAt` is display-only and never a run-dependent value (design 12). */
const RESEARCH_CLOCK = { now: () => GLOBAL_RESEARCH_TIME }

/** The Production Search entry points, injectable so a test can observe or stand in for them. */
export interface MaterializationSearchPort {
  visitPlannerAlternativeCandidates: typeof visitPlannerAlternativeCandidates
  searchCandidates: typeof searchCandidates
}

export const productionMaterializationSearchPort: MaterializationSearchPort = { visitPlannerAlternativeCandidates, searchCandidates }

export interface MaterializationInputs {
  /** The Phase 0 context the structural candidate was built from. */
  context: GlobalAssignmentContext
  /** The Phase A ReachTable of that context. */
  table: ReachTable
  /** The Engine of the table, the Search and the Route unit plans. */
  engine: RngEngine
  settings: MaterializationSettings
  /** Defaults to the Production Search APIs. */
  search?: MaterializationSearchPort
  /** The existing Research cancel / yield seam, forwarded to every Search. */
  shouldCancel?: () => boolean
  yieldControl?: () => Promise<void>
  /**
   * Phase D-0B (design 19.3 G1): `true` classifies a Target whose shape is a Search-policy shape
   * (`searchPolicyShapeOf()`) as `not_executed(search_policy_shape)` before any request or Search. Absent or
   * `false`: the D-0A behaviour (the Target is searched like any other).
   */
  searchPolicyPrecheck?: boolean
  /** Phase D-0B execution-only observers (copies; no effect on any result). */
  observer?: MaterializationObserver
}

function inspected(inputs: MaterializationInputs, inspection: CandidateInspection): void {
  inputs.observer?.onCandidateInspected?.(structuredClone(inspection))
}

function isValidSettings(settings: MaterializationSettings): boolean {
  return settings !== null && typeof settings === 'object'
    && Number.isSafeInteger(settings.deliveryCap) && settings.deliveryCap >= 1 && isValidSearchScaleGate(settings.searchScaleGate)
}

function assertSettings(settings: MaterializationSettings): void {
  if (!isValidSettings(settings)) {
    throw new GlobalAssignmentMaterializationError('invalid_settings', null, `deliveryCap must be a positive safe integer and every gate value a non-negative safe integer (got ${JSON.stringify(settings)}).`)
  }
}

/**
 * The PlannerInput's own Entries, read by the deterministic materializer's ID-collision and same-semantic
 * reuse rule only (design 9.4). Their Route contents never choose a source, a position or a method.
 */
function collisionCheckEntries(context: GlobalAssignmentContext): readonly BuildListEntry[] {
  return context.plannerInput.buildListEntries
}

function planningTarget(context: GlobalAssignmentContext, shape: ExpectedRouteShape): TargetWeapon {
  const target = context.planningTargets.find(value => value.id === shape.targetWeaponId)
  if (!target) throw new GlobalAssignmentMaterializationError('invalid_shape', shape.targetWeaponId, `Target ${shape.targetWeaponId} is not a planning Target of the context.`)
  return target
}

function routeBaseOf(shape: ExpectedRouteShape): 'conversion' | 'owned_gogma' {
  return shape.option.skillRequired.kind === 'conversion' ? 'conversion' : 'owned_gogma'
}

function normalScaleInput(shape: ExpectedRouteShape, origins: StreamOrigins) {
  const forge = shape.option.normalRequired
  return forge === null ? null : { counterId: forge.counterId, origin: origins.normal!, productionTarget: forge.position }
}

/** Design 9.4: the Production Planner Alternative search identity (origin, context, extent, reservation, route policy) plus the algorithm token. */
function researchAlternativeIdentity(request: Pick<PlannerAlternativeMaterializationRequest, 'targetWeaponId' | 'extent' | 'reservation'>, context: GlobalAssignmentContext): string {
  const productionSearchIdentity = createPlannerAlternativeSearchIdentity({
    origin: createPlannerStartSearchOrigin(context.plannerInput),
    targetWeaponId: request.targetWeaponId,
    extent: request.extent,
    reservation: request.reservation,
    excludedRouteKeys: [],
  })
  return `research.global-assignment.alternative.${hashStableValue({ algorithm: GLOBAL_ASSIGNMENT_MATERIALIZATION_ALGORITHM, productionSearchIdentity }).replace(':', '-')}`
}

/**
 * The design 9.1 request of one Target after `materializedEntries` (in materialization order). The
 * reservation is the formal one and nothing else: empty with no Entry, otherwise exactly
 * `derivePlannerAlternativeReservation(materializedEntries)`.
 */
export async function buildPlannerAlternativeRequest(shape: ExpectedRouteShape, materializedEntries: readonly BuildListEntry[], inputs: MaterializationInputs): Promise<PlannerAlternativeMaterializationRequest> {
  let reservation: PlannerAlternativeReservation
  if (materializedEntries.length === 0) {
    reservation = structuredClone(emptyPlannerAlternativeReservation)
  } else {
    try {
      reservation = derivePlannerAlternativeReservation(materializedEntries, inputs.engine)
    } catch (error) {
      if (error instanceof PlannerAlternativeReservationError) {
        throw new GlobalAssignmentMaterializationError('reservation_derivation_failed', shape.targetWeaponId, `${error.code} (${error.buildListEntryId}): ${error.message}`)
      }
      throw error
    }
  }
  const origins = plannerStartOrigins(shape, inputs.table)
  const extent = shapeSearchExtent(shape, origins)
  const { scale, detail } = await predictSearchScale({
    routeBase: routeBaseOf(shape), reservation, origins: { skill: origins.skill, gogma: origins.gogma }, normal: normalScaleInput(shape, origins), extent,
  })
  return {
    method: 'planner_alternative_reservation',
    targetWeaponId: shape.targetWeaponId,
    shape,
    reservation,
    reservationSourceEntryIds: materializedEntries.map(entry => entry.id),
    extent: { ...extent },
    excludedRouteKeys: [],
    searchIdentity: researchAlternativeIdentity({ targetWeaponId: shape.targetWeaponId, extent, reservation }, inputs.context),
    predictedSearchScale: scale,
    scaleDetail: detail,
  }
}

function projectedSearchInput(request: Pick<ProjectedMaterializationRequest, 'targetWeaponId' | 'projection' | 'extent'>, context: GlobalAssignmentContext, searchRunId: string): CandidateSearchInput {
  const input = context.plannerInput
  const { projection } = request
  const target = input.targetWeapons.find(value => value.id === request.targetWeaponId)
  if (!target) throw new GlobalAssignmentMaterializationError('invalid_shape', request.targetWeaponId, `Target ${request.targetWeaponId} is not in the PlannerInput.`)
  const rngState = structuredClone(input.rngState)
  rngState.skillCounter = { ...rngState.skillCounter, value: projection.skillCounter }
  rngState.gogmaCounter = { ...rngState.gogmaCounter, value: projection.gogmaCounter }
  return {
    searchRunId,
    targetWeaponId: target.id,
    routeFilter: projection.routeFilter,
    rngState,
    normalCounters: input.normalCounters.map(counter => (projection.normal !== null && counter.id === projection.normal.counterId
      ? { ...structuredClone(counter), counter: projection.normal.counter }
      : structuredClone(counter))),
    ownedWeapons: input.ownedWeapons.filter(weapon => projection.ownedWeaponIds.includes(weapon.id)).map(weapon => structuredClone(weapon)),
    // Only this Target: another Target's preference would name a weapon outside the restricted inventory.
    targetWeapons: [{ ...structuredClone(target), preferredOwnedWeaponId: projection.preferredOwnedWeaponId }],
    settings: { ...request.extent },
    master: input.master,
    calculationContext: input.calculationContext,
  }
}

/** The design 9.2 request of one continuous shape (a non-continuous shape fails closed: design 9.1 only). */
export async function buildProjectedRequest(shape: ExpectedRouteShape, inputs: MaterializationInputs, own: ShapeOwnPositions = shapeOwnPositions(shape)): Promise<ProjectedMaterializationRequest> {
  const { context, table } = inputs
  if (!own.continuous) {
    throw new GlobalAssignmentMaterializationError('invalid_shape', shape.targetWeaponId, `Target ${shape.targetWeaponId}: a projected Candidate Search needs a continuous shape (design 9.2).`)
  }
  const option = shape.option
  const forge = option.normalRequired
  const origins: StreamOrigins = {
    skill: own.skill.first ?? table.originSkill,
    gogma: own.gogma.first ?? table.originGogma,
    normal: forge === null ? null : own.normal.first,
  }
  const extent = shapeSearchExtent(shape, origins)
  const source = option.source
  const ownedWeaponIds = source.kind === 'new_normal' ? [] : [source.ownedWeaponId]
  const preferred = planningTarget(context, shape).preferredOwnedWeaponId
  const projection: ProjectedSearchOrigin = {
    skillCounter: origins.skill,
    gogmaCounter: origins.gogma,
    normal: forge === null ? null : { counterId: forge.counterId, counter: origins.normal! },
    routeFilter: source.kind === 'owned_gogma' ? 'existing_gogma' : 'normal_artian',
    ownedWeaponIds,
    preferredOwnedWeaponId: preferred !== null && ownedWeaponIds.includes(preferred) ? preferred : null,
  }
  const projectedState = projectedSearchInput({ targetWeaponId: shape.targetWeaponId, projection, extent }, context, 'pending')
  const searchRunId = `research.global-assignment.projected.${hashStableValue({
    algorithm: GLOBAL_ASSIGNMENT_MATERIALIZATION_ALGORITHM,
    targetWeaponId: shape.targetWeaponId,
    origin: normalizePlannerSearchOrigin(projectedState, projectedState.targetWeapons[0]!),
    extent,
    routeFilter: projection.routeFilter,
  }).replace(':', '-')}`
  const { scale, detail } = await predictSearchScale({
    routeBase: routeBaseOf(shape), reservation: emptyPlannerAlternativeReservation, origins: { skill: origins.skill, gogma: origins.gogma }, normal: normalScaleInput(shape, origins), extent,
  })
  return {
    method: 'candidate_search_projected',
    targetWeaponId: shape.targetWeaponId,
    shape,
    reservation: null,
    projection,
    extent: { ...extent },
    searchRunId,
    predictedSearchScale: scale,
    scaleDetail: detail,
  }
}

/** The mismatch with fewer reasons, the earlier delivery on a tie (diagnostics only). */
function closerMismatch(current: ShapeMismatch | null, next: ShapeMismatch): ShapeMismatch {
  if (current === null) return next
  return next.reasons.length < current.reasons.length ? next : current
}

function wrapMaterializerError(shape: ExpectedRouteShape, error: unknown): never {
  if (error instanceof ConstrainedMaterializationError) {
    throw new GlobalAssignmentMaterializationError('entry_materialization_refused', shape.targetWeaponId, `${error.code}: ${error.message}`)
  }
  throw error
}

/** A transient Entry over the materialized Candidate, read only by the match (never kept, never an identity). */
function probeEntry(materializer: DeterministicMaterializer<PlannerAlternativeCandidate>, candidate: PlannerAlternativeCandidate, shape: ExpectedRouteShape): BuildListEntry {
  let built: BuildCandidate
  try {
    built = materializer.materializeCandidate(candidate)
  } catch (error) {
    wrapMaterializerError(shape, error)
  }
  return createBuildListEntry(built, materializer.target, { createdAt: GLOBAL_RESEARCH_TIME })
}

function searchError(shape: ExpectedRouteShape, error: unknown): never {
  if (error instanceof PlannerAlternativeSearchError || error instanceof CandidateSearchError) {
    throw new GlobalAssignmentMaterializationError('search_refused', shape.targetWeaponId, `${error.code}: ${error.message}`)
  }
  throw error
}

function gateOutcome(predictedSearchScale: PredictedSearchScale, settings: MaterializationSettings) {
  const exceeded = exceededSearchScaleGate(predictedSearchScale, settings.searchScaleGate)
  return exceeded.length === 0 ? null : { kind: 'not_executed' as const, reason: 'search_scale_gate' as const, predictedSearchScale: { ...predictedSearchScale }, exceeded }
}

async function runPlannerAlternative(request: PlannerAlternativeMaterializationRequest, inputs: MaterializationInputs): Promise<PlannerAlternativeAttempt> {
  const { context, engine, settings } = inputs
  const { shape } = request
  const gated = gateOutcome(request.predictedSearchScale, settings)
  if (gated !== null) return { method: 'planner_alternative_reservation', request, outcome: gated, observed: null }

  const origin = createPlannerStartSearchOrigin(context.plannerInput)
  const materializer = createDeterministicMaterializer<PlannerAlternativeCandidate>({
    origin,
    target: resolvePlannerSearchOriginTarget(origin, request.targetWeaponId),
    searchIdentity: request.searchIdentity,
    candidateIdPrefix: CANDIDATE_ID_PREFIX,
    clock: RESEARCH_CLOCK,
  })
  const counters: ObservedPlannerAlternativeSearch['instrumentation'] = {
    workSettled: 0, skillStreams: 0, skillDepths: 0, skillStates: 0, maxSkillStatesPerDepth: 0, skillTransitions: 0,
    gogmaStreams: 0, gogmaDepths: 0, gogmaGeneratedStates: 0, maxGogmaFrontierStates: 0,
  }
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
  // Written by the visitor (a closure), read after the Search.
  const state: { delivered: number; accepted: Extract<MaterializationOutcome, { kind: 'materialized' }> | null; closest: ShapeMismatch | null } = { delivered: 0, accepted: null, closest: null }
  const conversions = new Set<number>()
  let execution: PlannerAlternativeSearchExecution
  try {
    execution = await (inputs.search ?? productionMaterializationSearchPort).visitPlannerAlternativeCandidates(
      { origin, targetWeaponId: request.targetWeaponId, extent: { ...request.extent }, reservation: request.reservation, excludedRouteKeys: [] },
      engine,
      candidate => {
        state.delivered += 1
        const delivered = state.delivered
        for (const operation of candidate.route.operations) if (operation.type === 'convert_normal_to_gogma') conversions.add(operation.skillCounterBefore)
        const match = matchExpectedShape(probeEntry(materializer, candidate, shape), shape, engine)
        inspected(inputs, { targetWeaponId: request.targetWeaponId, method: 'planner_alternative_reservation', deliveredIndex: delivered, match })
        if (match.matches) {
          let entry: BuildListEntry
          try {
            entry = materializer.materializeBuildListEntry(candidate, collisionCheckEntries(context)).entry
          } catch (error) {
            wrapMaterializerError(shape, error)
          }
          const valid = validateBuildListEntry(entry)
          if (!valid.isValid) {
            throw new GlobalAssignmentMaterializationError('entry_materialization_refused', shape.targetWeaponId, valid.issues.map(({ path, message }) => `${path}: ${message}`).join('\n'))
          }
          const confirmed = matchExpectedShape(entry, shape, engine)
          if (!confirmed.matches) {
            throw new GlobalAssignmentMaterializationError('match_inconsistent', shape.targetWeaponId, `The generated Entry ${entry.id} no longer matches (${confirmed.reasons.join(', ')}).`)
          }
          // A match takes priority over the delivery cap, even on the cap-th Candidate.
          state.accepted = { kind: 'materialized', method: 'planner_alternative_reservation', entry, plannerRequired: confirmed.plannerRequired, deliveredBeforeMatch: delivered - 1 }
          return 'stop'
        }
        state.closest = closerMismatch(state.closest, { deliveredIndex: delivered, reasons: match.reasons, plannerRequired: match.plannerRequired, sourceOwnedWeaponId: candidate.route.sourceOwnedWeaponId })
        return delivered >= settings.deliveryCap ? 'stop' : 'continue'
      },
      { shouldCancel: inputs.shouldCancel, yieldControl: inputs.yieldControl, instrumentation },
    )
  } catch (error) {
    if (error instanceof GlobalAssignmentMaterializationError) throw error
    if (error instanceof CandidateSearchError && error.code === 'cancelled') {
      return { method: 'planner_alternative_reservation', request, outcome: { kind: 'unmeasured', reason: 'cancelled' }, observed: null }
    }
    searchError(shape, error)
  }
  const observed: ObservedPlannerAlternativeSearch = {
    deliveredCandidates: execution.summary.deliveredCandidates,
    exhausted: execution.summary.exhausted,
    stoppedByExtent: execution.summary.stoppedByExtent,
    stoppedByConsumer: execution.stoppedByConsumer,
    deliveredConversionSkillPositions: [...conversions].sort((left, right) => left - right),
    instrumentation: counters,
  }
  const { delivered, accepted, closest } = state
  let outcome: MaterializationOutcome
  if (accepted !== null) outcome = accepted
  else if (execution.stoppedByConsumer) outcome = { kind: 'unconfirmed', reason: 'delivery_cap_reached', delivered, closestMismatch: closest }
  // Only the Search's explicit "no reachable work left" is evidence that the shape was not there (design 9.6).
  else if (execution.summary.exhausted && !execution.summary.stoppedByExtent) outcome = { kind: 'shape_mismatch', delivered, closestMismatch: closest }
  else if (execution.summary.stoppedByExtent && !execution.summary.exhausted) outcome = { kind: 'unconfirmed', reason: 'stopped_by_extent', delivered, closestMismatch: closest }
  else {
    throw new GlobalAssignmentMaterializationError('search_contract_violation', shape.targetWeaponId,
      `The Search ended with exhausted ${execution.summary.exhausted}, stoppedByExtent ${execution.summary.stoppedByExtent} and no consumer stop.`)
  }
  return { method: 'planner_alternative_reservation', request, outcome, observed }
}

async function runProjected(request: ProjectedMaterializationRequest, inputs: MaterializationInputs): Promise<ProjectedAttempt> {
  const { context, engine, settings } = inputs
  const { shape } = request
  const gated = gateOutcome(request.predictedSearchScale, settings)
  if (gated !== null) return { method: 'candidate_search_projected', request, result: gated, observed: null }

  const searchInput = projectedSearchInput(request, context, request.searchRunId)
  let result: CandidateSearchResult
  try {
    result = await (inputs.search ?? productionMaterializationSearchPort).searchCandidates(searchInput, engine, {
      now: () => GLOBAL_RESEARCH_TIME, shouldCancel: inputs.shouldCancel, yieldControl: inputs.yieldControl,
    })
  } catch (error) {
    if (error instanceof CandidateSearchError && error.code === 'cancelled') {
      return { method: 'candidate_search_projected', request, result: { kind: 'unmeasured', reason: 'cancelled' }, observed: null }
    }
    searchError(shape, error)
  }
  const candidate = result.targetResult.candidate
  const observed = {
    searchedRoutes: [...result.targetResult.searchedRoutes],
    skippedRoutes: result.targetResult.skippedRoutes.map(({ route, reason }) => ({ route, reason })),
    candidateFound: candidate !== null,
  }
  if (candidate === null) return { method: 'candidate_search_projected', request, result: { kind: 'no_candidate' }, observed }
  // The projected Candidate's Route already holds absolute positions: match it before rebuilding it at the origin.
  const match = matchExpectedShape(createBuildListEntry(candidate, searchInput.targetWeapons[0]!, { createdAt: GLOBAL_RESEARCH_TIME }), shape, engine)
  inspected(inputs, { targetWeaponId: request.targetWeaponId, method: 'candidate_search_projected', deliveredIndex: 1, match })
  if (!match.matches) {
    return {
      method: 'candidate_search_projected', request, observed,
      result: { kind: 'canonical_mismatch', mismatch: { deliveredIndex: 1, reasons: match.reasons, plannerRequired: match.plannerRequired, sourceOwnedWeaponId: candidate.route.sourceOwnedWeaponId } },
    }
  }
  let entry: BuildListEntry
  try {
    entry = materializeGlobalResearchCandidate(context.plannerInput, searchInput, candidate, GLOBAL_ASSIGNMENT_MATERIALIZATION_ALGORITHM)
  } catch (error) {
    throw new GlobalAssignmentMaterializationError('entry_materialization_refused', shape.targetWeaponId, error instanceof Error ? error.message : String(error))
  }
  const confirmed = matchExpectedShape(entry, shape, engine)
  if (!confirmed.matches) {
    throw new GlobalAssignmentMaterializationError('match_inconsistent', shape.targetWeaponId, `The origin Entry ${entry.id} no longer matches (${confirmed.reasons.join(', ')}).`)
  }
  return {
    method: 'candidate_search_projected', request, observed,
    result: { kind: 'matched', outcome: { kind: 'materialized', method: 'candidate_search_projected', entry, plannerRequired: confirmed.plannerRequired, deliveredBeforeMatch: 0 } },
  }
}

/** Plain-data equality; a value the stable serialization refuses (undefined, a Map, a class) is never equal. */
function sameStableValue(left: unknown, right: unknown): boolean {
  try {
    return stableStringify(left) === stableStringify(right)
  } catch {
    return false
  }
}

/**
 * Executes one request after re-deriving it from its shape (and, for design 9.1, the Entries materialized
 * before it): a request whose reservation, extent, projection, identity or predicted scale differs from
 * the derivation fails closed with `request_mismatch` before any Search. The shape itself is the caller's;
 * `materializeStructuralCandidate()` checks every shape against its Phase C derivation first.
 */
export async function executeMaterializationRequest(
  request: PlannerAlternativeMaterializationRequest | ProjectedMaterializationRequest,
  materializedEntries: readonly BuildListEntry[],
  inputs: MaterializationInputs,
): Promise<MaterializationAttempt> {
  assertSettings(inputs.settings)
  const expected = request.method === 'planner_alternative_reservation'
    ? await buildPlannerAlternativeRequest(request.shape, materializedEntries, inputs)
    : await buildProjectedRequest(request.shape, inputs)
  if (!sameStableValue(expected, request)) {
    throw new GlobalAssignmentMaterializationError('request_mismatch', request.targetWeaponId, `The ${request.method} request of Target ${request.targetWeaponId} differs from its derivation.`)
  }
  return expected.method === 'planner_alternative_reservation' ? runPlannerAlternative(expected, inputs) : runProjected(expected, inputs)
}

/** Design 9.3: the deterministic method order of one Target. */
export function selectMaterializationMethods(
  shape: ExpectedRouteShape,
  own: ShapeOwnPositions,
  plannerAlternative: PredictedSearchScale,
  projected: PredictedSearchScale | null,
): MethodSelection {
  const predictedSearchScale = { plannerAlternative: { ...plannerAlternative }, projected: projected === null ? null : { ...projected } }
  if (!own.continuous || projected === null) {
    return { continuous: own.continuous, rule: 'non_continuous_planner_alternative_only', order: ['planner_alternative_reservation'], predictedSearchScale }
  }
  if (shape.option.skillRequired.kind === 'conversion') {
    return { continuous: true, rule: 'continuous_conversion_projected_first', order: ['candidate_search_projected', 'planner_alternative_reservation'], predictedSearchScale }
  }
  // The smaller predicted scale first; a tie or an incomparable pair keeps the projected Search first.
  return isSmallerSearchScale(plannerAlternative, projected)
    ? { continuous: true, rule: 'continuous_owned_gogma_planner_alternative_first', order: ['planner_alternative_reservation', 'candidate_search_projected'], predictedSearchScale }
    : { continuous: true, rule: 'continuous_owned_gogma_projected_first', order: ['candidate_search_projected', 'planner_alternative_reservation'], predictedSearchScale }
}

/**
 * Materializes one Target after `materializedEntries` (design 9.1 - 9.3). The Target outcome is design
 * 9.1's, unless design 9.2 matched; a cancellation ends the Target as `unmeasured(cancelled)`. With
 * `searchPolicyPrecheck`, a Search-policy shape (design 19.3 G1) ends as `not_executed(search_policy_shape)`
 * before any request or Search.
 */
export async function materializeTarget(
  shape: ExpectedRouteShape,
  materializedEntries: readonly BuildListEntry[],
  inputs: MaterializationInputs,
  orderIndex = 0,
): Promise<TargetMaterializationRecord> {
  assertSettings(inputs.settings)
  inputs.observer?.onTargetStarted?.({ targetWeaponId: shape.targetWeaponId, orderIndex })
  const record = await materializeTargetRecord(shape, materializedEntries, inputs, orderIndex)
  inputs.observer?.onTargetSettled?.(structuredClone(record))
  return record
}

async function materializeTargetRecord(
  shape: ExpectedRouteShape,
  materializedEntries: readonly BuildListEntry[],
  inputs: MaterializationInputs,
  orderIndex: number,
): Promise<TargetMaterializationRecord> {
  const attempts: MaterializationAttempt[] = []
  if (inputs.shouldCancel?.()) {
    return { targetWeaponId: shape.targetWeaponId, orderIndex, selection: null, attempts, outcome: { kind: 'unmeasured', reason: 'cancelled' } }
  }
  if (inputs.searchPolicyPrecheck === true) {
    const policyShape = searchPolicyShapeOf(shape.option, inputs.table)
    if (policyShape !== null) {
      return { targetWeaponId: shape.targetWeaponId, orderIndex, selection: null, attempts, outcome: { kind: 'not_executed', reason: 'search_policy_shape', policyShape } }
    }
  }
  const own = shapeOwnPositions(shape)
  const alternative = await buildPlannerAlternativeRequest(shape, materializedEntries, inputs)
  const projected = own.continuous ? await buildProjectedRequest(shape, inputs, own) : null
  const selection = selectMaterializationMethods(shape, own, alternative.predictedSearchScale, projected?.predictedSearchScale ?? null)
  const record = (outcome: MaterializationOutcome): TargetMaterializationRecord => ({ targetWeaponId: shape.targetWeaponId, orderIndex, selection, attempts, outcome })

  if (selection.order[0] === 'candidate_search_projected') {
    const first = await runProjected(projected!, inputs)
    attempts.push(first)
    if (first.result.kind === 'matched') return record(first.result.outcome)
    if (first.result.kind === 'unmeasured') return record({ kind: 'unmeasured', reason: first.result.reason })
    // Not matched (another canonical Ideal, none in the projected extent, or gated): design 9.1 once.
    const second = await runPlannerAlternative(alternative, inputs)
    attempts.push(second)
    return record(second.outcome)
  }
  const first = await runPlannerAlternative(alternative, inputs)
  attempts.push(first)
  if (first.outcome.kind !== 'shape_mismatch' || projected === null || selection.order.length < 2) return record(first.outcome)
  // Owned Gogma with design 9.1 first: design 9.2 once after a shape_mismatch only.
  const second = await runProjected(projected, inputs)
  attempts.push(second)
  if (second.result.kind === 'matched') return record(second.result.outcome)
  if (second.result.kind === 'unmeasured') return record({ kind: 'unmeasured', reason: second.result.reason })
  return record(first.outcome)
}

/** Why the value is not the Phase C derivation of its own assignment, or null when it is. */
function structuralCandidateMismatch(candidate: StructuralCandidate, inputs: MaterializationInputs): string | null {
  if (candidate === null || typeof candidate !== 'object' || candidate.kind !== 'structural_candidate') return 'The value is not a structural candidate.'
  // A replay inconsistency of the assignment propagates as GlobalAssignmentInvariantError (never an input issue).
  const rebuilt = buildStructuralCandidate(candidate.assignment, { table: inputs.table, context: inputs.context, engine: inputs.engine })
  if (rebuilt.kind !== 'structural_candidate') return `Phase C does not build a structural candidate from the assignment (${rebuilt.kind}${rebuilt.kind === 'invalid_input' ? `: ${rebuilt.reason}` : ''}).`
  for (const key of ['ordinal', 'coverage', 'materializationOrder', 'materializationDependencies', 'expectedShapes', 'replayPredictions'] as const) {
    if (!sameStableValue(rebuilt.candidate[key], candidate[key])) return `${key} differs from the Phase C derivation of the assignment.`
  }
  return null
}

/**
 * Materializes every planning Target of one structural candidate in its materialization order (design 9.1 -
 * 9.6), stopping at the first Target without a matching Entry. Inputs are checked before any Search: the
 * settings, the table's membership of the context, and that the candidate is exactly Phase C's derivation of
 * its assignment (so the order and the shapes are never edited). Not a Planner verification.
 */
export async function materializeStructuralCandidate(candidate: StructuralCandidate, inputs: MaterializationInputs): Promise<StructuralCandidateMaterializationResult> {
  if (!isValidSettings(inputs.settings)) {
    return { kind: 'invalid_input', reason: 'invalid_settings', detail: `deliveryCap must be a positive safe integer and every gate value a non-negative safe integer (got ${JSON.stringify(inputs.settings)}).` }
  }
  const tableIssue = checkTableBelongsToContext(inputs.table, inputs.context)
  if (tableIssue !== null) return { kind: 'invalid_input', reason: 'context_mismatch', detail: `${tableIssue.reason}: ${tableIssue.detail}` }
  const candidateIssue = structuralCandidateMismatch(candidate, inputs)
  if (candidateIssue !== null) return { kind: 'invalid_input', reason: 'structural_candidate_mismatch', detail: candidateIssue }

  const shapes = new Map(candidate.expectedShapes.map(shape => [shape.targetWeaponId, shape]))
  const order = candidate.materializationOrder
  const targets: TargetMaterializationRecord[] = []
  const materializedEntries: BuildListEntry[] = []
  const finish = (outcome: MaterializationStageOutcome, notAttempted: StructuralCandidateMaterialization['notAttemptedTargetWeaponIds']): StructuralCandidateMaterialization => ({
    kind: 'materialization',
    candidateOrdinal: candidate.ordinal,
    objective: candidate.assignment.objective,
    materializationOrder: [...order],
    targets,
    materializedEntries,
    materializedTargetCount: materializedEntries.length,
    outcome,
    notAttemptedTargetWeaponIds: notAttempted,
  })
  for (const [index, targetWeaponId] of order.entries()) {
    const record = await materializeTarget(shapes.get(targetWeaponId)!, materializedEntries, inputs, index)
    targets.push(record)
    const { outcome } = record
    if (outcome.kind === 'materialized') {
      materializedEntries.push(outcome.entry)
      continue
    }
    const stage: MaterializationStageOutcome = outcome.kind === 'shape_mismatch'
      ? { kind: 'materialization_failed', targetWeaponId, outcome }
      : { kind: 'materialization_unconfirmed', targetWeaponId, outcome }
    return finish(stage, order.slice(index + 1))
  }
  return finish({ kind: 'all_materialized' }, [])
}
