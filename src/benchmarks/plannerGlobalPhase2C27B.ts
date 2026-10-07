/**
 * Issue #154 Phase 2-C2.7-B: the E1 oracle-free execution of the Phase 2-C2.7-A pre-registered policy. Research only. Never
 * import from Production.
 *
 * Authority: `docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C27A.md` §2 - §7 / §9 (registered below by its SHA-256). For every
 * Target of the population manifest (Target IDs only) the SAME policy runs, independently and from the same baseline:
 *
 * ```text
 * Export -> derivePhase2C26B2C1Schedule()           (unchanged B2-B1 snapshot + B2-C1 P1 ranks, Production default windows)
 *   -> checkpoint hard-constraint Target            -> blocked_by_selected_checkpoint, no unit at all (kernel: Target level)
 *   -> activeContexts = every K <= 1 context in P1 order (rank 1 .. 1 + K1 contexts; a structural prefix of P1)
 *   -> for rung in L0 / L1 / L2 (rung-major):
 *        for context in activeContexts (P1 order): unit(Target, context, rung)
 *          found_R                                   -> the Target stops
 *          stopped_by_search_extent_bound            -> the only context that runs again at the next rung
 *          not_found / trial bound / rerun bound / unmeasured -> never runs again
 *        no extent-bound context                     -> stop (no_extent_escalation_context); after L2 -> ladder_exhausted
 * ```
 *
 * One unit (a fresh child process) is the Production Planner Alternative trial loop rebuilt from Production parts only, with a
 * speculative support context as the reservation source (`docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C27A.md` §6.4):
 *
 * ```text
 * support Entries (the context's representative fixed set) -> derivePlannerAlternativeReservation()
 *   -> visitPlannerAlternativeCandidates()            (unchanged Production Search, extent = the rung, excluded = current Route)
 *   -> per delivered Candidate (kernel order, bounds read from the (Target, context) ladder state):
 *        previously rejected key  -> skip, no budget          | 2 trials used     -> stopped_by_candidate_trial_bound
 *        8 full runs used         -> stopped_by_planner_rerun_bound | otherwise    -> trial
 *   -> trial: createPlannerAlternativeMaterializer() -> resolveBuildListEntryReplacement() (O -> G)
 *        -> preparePlannerReplacementConflictPreflight(O + G, -O + G; NO fixed constraint)
 *        -> createPlannerAlternativeFullRunner() (createProductionPlanWithObserver + Trace Replay, the ladder rerun budget)
 *        -> judgePlannerAlternativeTrial(explicit decision = fixed Route = the support Entries)  -> found_R or rejected
 * ```
 *
 * The baseline PlannerInput keeps `conflictResolutions = []`: no `PlannerConflictResolution`, scenario resolution, explicit
 * resolution, repair lineage or `selectedBuildListEntryId` is ever written for a support Entry (G1). `found_R` is a
 * Research literal, never the Production `found`. The Candidate trial / Planner rerun allowances (2 / 8, the Production values)
 * are shared by the whole L0 -> L1 -> L2 ladder of one (Target, context) and never refilled by a rung (G11).
 *
 * Oracle isolation: this module, the units it runs and the runner that schedules them read no oracle Route, stable key,
 * Counter position, required extent, first-compatible rank, exact index, known context or known rung, and import no oracle,
 * analysis or population-authority module (a test walks the import closure). The population manifest carries Target IDs only
 * and every Target gets the same policy. Only the post-hoc analyzer reads the oracle.
 */
import { resolveBuildListEntryReplacement } from '../domain/buildList'
import { hashStableValue, stableStringify } from '../domain/models/hashing'
import type { BuildListEntry, BuildListEntryId } from '../domain/models/publicTypes'
import {
  createPlannerAlternativeFullRunner,
  createPlannerAlternativeMaterializer,
  defaultPlannerAlternativeTrialBounds,
  derivePlannerAlternativeReservation,
  judgePlannerAlternativeTrial,
  PlannerAlternativeRerunLimitError,
  type PlannerAlternativeFullRunBudget,
  type PlannerAlternativeTrialRejectionReason,
} from '../domain/planner/alternative'
import { preparePlannerInitialContext } from '../domain/planner/plannerInitialContext'
import type { PlannerDependencies, PlannerInput, PlannerResult, PlannerRouteCommitmentEvidence, PlannerRunBuildListContext } from '../domain/planner/plannerTypes'
import { preparePlannerReplacementConflictPreflight } from '../domain/planner/replacement/plannerAugmentedPreflight'
import { createPlannerConflictContexts } from '../domain/planner/replacement/plannerConflictContext'
import { createPlannerStartSearchOrigin } from '../domain/planner/replacement/plannerSearchOrigin'
import type { RngEngine } from '../domain/rng/rngEngine'
import {
  candidateStableKey,
  defaultPlannerAlternativeSearchExtent,
  visitPlannerAlternativeCandidates,
  type PlannerAlternativeCandidate,
  type PlannerAlternativeReservation,
  type PlannerAlternativeSearchExtent,
} from '../domain/search'
import { respectsPhase2C2Reservation, summarizePhase2C2Entry, type Phase2C2CandidateSummary, type Phase2C2ChildOutcome } from './plannerGlobalPhase2C2'
import { PHASE2C26B2C1_POLICIES, type Phase2C26B2C1Schedule } from './plannerGlobalPhase2C26B2C1'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const pad = (value: number) => String(value).padStart(2, '0')

// ---------------------------------------------------------------- registered before the formal run (Phase 2-C2.7-A §9.1)

export const PHASE2C27B_PHASE = 'Issue #154 Phase 2-C2.7-B'
/** The Phase 2-C2.7-A document (PR #212, main e696ef4): the pre-registration this phase implements. */
export const PHASE2C27B_POLICY_AUTHORITY = {
  file: 'docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C27A.md',
  sha256: 'b45daa271258a2501a94547449cabc019e01477a770957dd831a27a127054147',
  baseMain: 'e696ef46e1a01f18aa0bf3039463d036e412ef26',
} as const
/** The population authorities the manifest must name (the runner checks the SHA-256s only; it never reads those RESULTs). */
export const PHASE2C27B_POPULATION_AUTHORITY = {
  b2c2b1ResultSha256: '418166d2a7ff40145d8650f418c025783f9b5039673ee19e722bab4836b22eae',
  b2c1ResultSha256: '04904fafb93664ecfed5f3bd654b29d9c39029dde34aa88a59d1d11de8fc2bac',
  population: 'E1',
} as const
export const PHASE2C27B_TARGETS = 11

/** P1 `default_simple_first` (B2-C1), unchanged. A Research candidate policy, never a Production ordering (G3). */
export const PHASE2C27B_REGISTERED_P1 = {
  id: 'P1', name: 'default_simple_first',
  keys: [['targetEligibleMinCardinality', 'asc'], ['exclusiveOwnedWeaponCount', 'asc'], ['blockedCountDefaultTotal', 'asc'], ['shareableHeldCountDefaultTotal', 'desc'], ['reservationDigest', 'asc']],
} as const

/** Every K <= 1 context (a structural boundary, the same for every Target); this Export holds K0 1 + K1 42 per Target (§4.4). */
export const PHASE2C27B_CONTEXT_SCOPE = { maxCardinality: 1, expectedK0: 1, expectedK1: 42, expectedPerTarget: 43 } as const

export type Phase2C27BRungId = 'L0' | 'L1' | 'L2'
/** The registered Research ladder (B2-C2B1), common to every Target and context. L0 is the Production default; L1 / L2 are no default (G4). */
export const PHASE2C27B_LADDER: readonly { id: Phase2C27BRungId; extent: PlannerAlternativeSearchExtent }[] = Object.freeze([
  Object.freeze({ id: 'L0' as const, extent: Object.freeze({ maxNormalAdvance: 4, maxGogmaAdvance: 235, maxSkillAdvance: 4 }) }),
  Object.freeze({ id: 'L1' as const, extent: Object.freeze({ maxNormalAdvance: 8, maxGogmaAdvance: 235, maxSkillAdvance: 256 }) }),
  Object.freeze({ id: 'L2' as const, extent: Object.freeze({ maxNormalAdvance: 128, maxGogmaAdvance: 235, maxSkillAdvance: 1500 }) }),
])
export const PHASE2C27B_RUNG_IDS: readonly Phase2C27BRungId[] = ['L0', 'L1', 'L2']
export const phase2c27bRungExtent = (rung: Phase2C27BRungId): PlannerAlternativeSearchExtent => ({ ...PHASE2C27B_LADDER.find(r => r.id === rung)!.extent })

/**
 * The Candidate trial / Planner rerun allowances: the Production values (`defaultPlannerAlternativeTrialBounds`), shared by the
 * whole L0 -> L1 -> L2 ladder of one (Target, context) - never reset or refilled by a rung (§6.2 / §7, G11).
 */
export const PHASE2C27B_LADDER_BUDGET = { maxCandidateTrialsPerTarget: 2, maxPlannerReruns: 8, scope: '(Target, context)', resetPerRung: false } as const
/** The Research Plan step bound of every trial run (§1 C; never `defaultPlannerOptions` / `conflictResolutionPlannerOptions`). */
export const PHASE2C27B_RESEARCH_MAX_PLAN_STEPS = 20_000

/**
 * The common execution envelope of every unit (a Research measurement envelope, never a Production timeout; G7). The 60 minutes
 * were chosen after the B2-C2B2K Search wall (about 3,375 s), so `oracleInformedExecutionEnvelope = true`.
 */
export const PHASE2C27B_EXECUTION_ENVELOPE = Object.freeze({ unitBudgetMs: 60 * 60 * 1000, childHeapMb: 12_288, concurrency: 1, retry: 'none', fallback: 'none' } as const)
/** The tasks child (schedule re-derivation and context construction, no Search). */
export const PHASE2C27B_TASKS_BUDGET_MS = 10 * 60 * 1000
export const PHASE2C27B_MEMORY_SAMPLE_INTERVAL_MS = 250
export const PHASE2C27B_NODE_YIELD = 'setImmediate' as const

export const PHASE2C27B_PROVENANCE_FLAGS = Object.freeze({
  oracleGuidedTargetPopulation: true,
  oracleInformedPolicyDesign: true,
  oracleGuidedPolicySelection: true,
  oracleInformedLadder: true,
  oracleInformedContextScope: true,
  oracleInformedExecutionEnvelope: true,
  oracleReadByScheduler: false,
  oracleReadBySearchChild: false,
  oracleUsedForEarlyStop: false,
  targetIndividualOracleExtentAsSearchInput: false,
  speculativeSupportWrittenAsResolution: false,
  productionSemanticsChanged: false,
} as const)

/** The pre-registered aggregate decision order (§9.7); nothing is added or changed after the run. */
export const PHASE2C27B_DECISION_RULE = [
  'B2C27B_INVALID: any formal validity violation (§9.2)',
  'B2C27B_INCOMPLETE: a policy-required unit was timeout / OOM / process failure / interrupted / not executed (§9.4); class counts are lower bounds',
  'B2C27B_E1_ORACLE_FREE_EXECUTION_RECOVERED: invalid 0, unmeasured 0, exact_recovered 11 / 11',
  'B2C27B_E1_PARTIAL: invalid 0, unmeasured 0, exact_recovered 1..10',
  'B2C27B_E1_NOT_RECOVERED: invalid 0, unmeasured 0, exact_recovered 0',
] as const

/** What this phase deliberately does not run. */
export const PHASE2C27B_NOT_RUN = ['production_change', 'production_default_change', 'k2_context', 'e2_search', 'residual_unreached_support', 'per_target_extent',
  'tight_extent', 'p1_top32_budget', 'oracle_guided_context_selection', 'compatibility_based_context_skip', 'oracle_early_stop', 'retry', 'fallback',
  'trial_bound_escalation', 'rerun_bound_escalation', 'budget_refill_per_rung', 'resolution_synthesis', 'repair_lineage', 'persistence', 'global_assignment',
  'search_algorithm_change', 'search_ordering_change', 'capture_policy', 'profiler'] as const

export function phase2c27bPolicyDrift(schedule: Pick<Phase2C26B2C1Schedule, 'policies' | 'extent'>): string[] {
  const issues: string[] = []
  if (!same(schedule.policies.find(p => p.id === 'P1'), PHASE2C27B_REGISTERED_P1)) issues.push('the schedule P1 is not the registered P1')
  if (!same(PHASE2C26B2C1_POLICIES.find(p => p.id === 'P1'), PHASE2C27B_REGISTERED_P1)) issues.push('the B2-C1 module P1 is not the registered P1')
  if (!same(schedule.extent, { ...defaultPlannerAlternativeSearchExtent })) issues.push('the schedule extent is not the Production default extent')
  if (!same(PHASE2C27B_LADDER[0]!.extent, { ...defaultPlannerAlternativeSearchExtent })) issues.push('L0 is not the Production default extent')
  if (defaultPlannerAlternativeTrialBounds.maxCandidateTrialsPerTarget !== PHASE2C27B_LADDER_BUDGET.maxCandidateTrialsPerTarget
    || defaultPlannerAlternativeTrialBounds.maxPlannerReruns !== PHASE2C27B_LADDER_BUDGET.maxPlannerReruns) issues.push('the ladder budget is not the Production trial bounds')
  return issues
}

// ---------------------------------------------------------------- the population manifest (Target IDs only)

export interface Phase2C27BTargetManifest {
  phase: string
  population: 'E1'
  b2c2b1ResultSha256: string
  b2c1ResultSha256: string
  exportSha256: string
  oracleGuidedTargetPopulation: true
  targetWeaponIds: string[]
}

export const PHASE2C27B_MANIFEST_KEYS = ['b2c1ResultSha256', 'b2c2b1ResultSha256', 'exportSha256', 'oracleGuidedTargetPopulation', 'phase', 'population', 'targetWeaponIds'] as const

/**
 * Reads a population manifest as untrusted JSON: exactly the manifest keys (no rank, rung, extent, context, digest, stable key or
 * any other oracle-derived field may ride along), the registered authorities, an Export SHA-256, the oracle-guided population flag,
 * and 11 distinct Target IDs in ascending order.
 */
export function parsePhase2C27BTargetManifest(json: unknown): { valid: boolean; issues: string[]; manifest: Phase2C27BTargetManifest | null } {
  const issues: string[] = []
  if (!isObject(json)) return { valid: false, issues: ['the population manifest is not an object'], manifest: null }
  if (!same(Object.keys(json).sort(), [...PHASE2C27B_MANIFEST_KEYS])) issues.push(`the population manifest keys are not exactly ${PHASE2C27B_MANIFEST_KEYS.join(', ')}`)
  if (json.population !== PHASE2C27B_POPULATION_AUTHORITY.population) issues.push('population is not E1')
  if (json.b2c2b1ResultSha256 !== PHASE2C27B_POPULATION_AUTHORITY.b2c2b1ResultSha256) issues.push('b2c2b1ResultSha256 is not the registered B2-C2B1 RESULT')
  if (json.b2c1ResultSha256 !== PHASE2C27B_POPULATION_AUTHORITY.b2c1ResultSha256) issues.push('b2c1ResultSha256 is not the registered B2-C1 RESULT')
  // The Export is the one both population authorities name (checked where they are read); never a value hard-coded here.
  if (typeof json.exportSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(json.exportSha256)) issues.push('exportSha256 is not a SHA-256')
  if (json.oracleGuidedTargetPopulation !== true) issues.push('oracleGuidedTargetPopulation is not true')
  if (typeof json.phase !== 'string') issues.push('phase is not a string')
  const ids = Array.isArray(json.targetWeaponIds) ? json.targetWeaponIds : null
  if (!ids || !ids.every(id => typeof id === 'string' && id.length > 0)) issues.push('targetWeaponIds is not a list of IDs')
  else {
    if (ids.length !== PHASE2C27B_TARGETS) issues.push(`targetWeaponIds holds ${ids.length} Targets, not ${PHASE2C27B_TARGETS}`)
    if (new Set(ids).size !== ids.length) issues.push('targetWeaponIds repeats a Target')
    if (!same(ids, [...ids].sort(compare))) issues.push('targetWeaponIds is not in ascending order')
  }
  if (issues.length > 0) return { valid: false, issues, manifest: null }
  return { valid: true, issues: [], manifest: { phase: String(json.phase), population: 'E1', b2c2b1ResultSha256: String(json.b2c2b1ResultSha256),
    b2c1ResultSha256: String(json.b2c1ResultSha256), exportSha256: String(json.exportSha256), oracleGuidedTargetPopulation: true, targetWeaponIds: (ids as string[]).map(String) } }
}

// ---------------------------------------------------------------- the K <= 1 contexts in P1 order (oracle-free)

/** One speculative support context of one Target: a reservation group of the schedule and its representative support set. */
export interface Phase2C27BContext {
  targetWeaponId: string
  /** The P1 rank (1-based). */
  contextRank: number
  groupIndex: number
  reservationDigest: string
  /** The Target-specific eligible minimum cardinality (0 = K0, 1 = K1). */
  cardinality: 0 | 1
  /** The representative alias (B2-C1: first eligible alias of the minimum cardinality by ID): the support Entries. */
  representativeFixedSetId: string
  supportBuildListEntryIds: string[]
  supportTargetWeaponIds: string[]
}

export interface Phase2C27BTargetPlan {
  targetWeaponId: string
  /** 0-based position in the manifest. */
  targetIndex: number
  currentBuildListEntryId: string
  /** A required checkpoint Entry (the kernel's Target-level `blockedBySelectedCheckpoint`): no unit runs. */
  checkpointBlocked: boolean
  /** Every K <= 1 context, P1 order (empty for a checkpoint-blocked Target). */
  contexts: Phase2C27BContext[]
}

/**
 * The K <= 1 contexts of every manifest Target, in P1 order: every context whose eligible minimum cardinality is <= 1, which
 * P1 (cardinality first) puts at ranks 1 .. 1 + K1. Fails closed on a P1 / extent drift, a Target outside the schedule, a K <= 1
 * set that is not exactly that rank prefix, a K0 / K1 count other than the registered one, a repeated digest, or a
 * representative fixed set the snapshot does not hold as a valid support set of that group without the Target's own Entry.
 * Reads nothing but the schedule and the IDs.
 */
export function buildPhase2C27BTargetPlans(schedule: Phase2C26B2C1Schedule, targetWeaponIds: readonly string[]): { valid: boolean; issues: string[]; plans: Phase2C27BTargetPlan[] } {
  const issues: string[] = [...phase2c27bPolicyDrift(schedule)]
  if (new Set(targetWeaponIds).size !== targetWeaponIds.length) issues.push('a Target repeats')
  const fixedSetById = new Map(schedule.snapshot.fixedSets.map(row => [row.fixedSetId, row]))
  const plans: Phase2C27BTargetPlan[] = []
  targetWeaponIds.forEach((targetWeaponId, targetIndex) => {
    const target = schedule.targets.find(t => t.targetWeaponId === targetWeaponId)
    if (!target) { issues.push(`${targetWeaponId}: not a schedule Target`); return }
    if (target.checkpointHardConstraint) {
      plans.push({ targetWeaponId, targetIndex, currentBuildListEntryId: target.currentBuildListEntryId, checkpointBlocked: true, contexts: [] })
      return
    }
    const rows = schedule.contexts.filter(c => c.targetWeaponId === targetWeaponId).sort((a, b) => a.ranks.P1 - b.ranks.P1)
    const inScope = rows.filter(r => r.targetEligibleMinCardinality <= PHASE2C27B_CONTEXT_SCOPE.maxCardinality)
    const k0 = inScope.filter(r => r.targetEligibleMinCardinality === 0).length, k1 = inScope.length - k0
    if (k0 !== PHASE2C27B_CONTEXT_SCOPE.expectedK0 || k1 !== PHASE2C27B_CONTEXT_SCOPE.expectedK1) issues.push(`${targetWeaponId}: K0 ${k0} / K1 ${k1}, not the registered ${PHASE2C27B_CONTEXT_SCOPE.expectedK0} / ${PHASE2C27B_CONTEXT_SCOPE.expectedK1}`)
    if (!same(inScope.map(r => r.ranks.P1), Array.from({ length: inScope.length }, (_, i) => i + 1))) issues.push(`${targetWeaponId}: the K <= 1 contexts are not the P1 rank prefix 1..${inScope.length}`)
    if (new Set(inScope.map(r => r.reservationDigest)).size !== inScope.length) issues.push(`${targetWeaponId}: a reservation digest repeats`)
    const contexts: Phase2C27BContext[] = []
    for (const row of inScope) {
      const at = `${targetWeaponId} @ P1 rank ${row.ranks.P1}`
      const fixed = fixedSetById.get(row.representativeFixedSetId)
      const group = schedule.snapshot.reservationGroups[row.groupIndex]
      if (!fixed || !group) { issues.push(`${at}: the representative fixed set or the group is missing`); continue }
      if (!fixed.valid || fixed.reservationGroupIndex !== row.groupIndex || fixed.cardinality !== row.targetEligibleMinCardinality) issues.push(`${at}: the representative fixed set is not a valid alias of the group at its cardinality`)
      if (fixed.fixedBuildListEntryIds.includes(target.currentBuildListEntryId)) issues.push(`${at}: the support set holds the Target's own Entry`)
      if (group.reservationDigest !== row.reservationDigest || hashStableValue(group.reservation) !== row.reservationDigest) issues.push(`${at}: the reservation digest differs`)
      if (!group.aliasFixedSetIds.includes(fixed.fixedSetId)) issues.push(`${at}: the representative is not a group alias`)
      contexts.push({ targetWeaponId, contextRank: row.ranks.P1, groupIndex: row.groupIndex, reservationDigest: row.reservationDigest, cardinality: row.targetEligibleMinCardinality as 0 | 1,
        representativeFixedSetId: fixed.fixedSetId, supportBuildListEntryIds: [...fixed.fixedBuildListEntryIds], supportTargetWeaponIds: [...fixed.fixedTargetWeaponIds] })
    }
    if (contexts.length !== PHASE2C27B_CONTEXT_SCOPE.expectedPerTarget) issues.push(`${targetWeaponId}: ${contexts.length} contexts, not ${PHASE2C27B_CONTEXT_SCOPE.expectedPerTarget}`)
    plans.push({ targetWeaponId, targetIndex, currentBuildListEntryId: target.currentBuildListEntryId, checkpointBlocked: false, contexts })
  })
  return { valid: issues.length === 0, issues, plans: issues.length === 0 ? plans : [] }
}

// ---------------------------------------------------------------- the (Target, context) ladder state (§6.2)

export interface Phase2C27BLadderState {
  /** Candidate trials started over the whole ladder of this (Target, context). */
  candidateTrialsUsed: number
  /** Full Planner runs started over the whole ladder (runtime-unsupported retries included). */
  plannerRerunsUsed: number
  /** `candidateStableKey()` of every Candidate a trial rejected, in rejection order. */
  previouslyRejectedCandidateStableKeys: string[]
}

export const PHASE2C27B_INITIAL_LADDER_STATE: Readonly<Phase2C27BLadderState> = Object.freeze({ candidateTrialsUsed: 0, plannerRerunsUsed: 0, previouslyRejectedCandidateStableKeys: [] })

export function phase2c27bRemaining(state: Phase2C27BLadderState) {
  return { remainingCandidateTrials: PHASE2C27B_LADDER_BUDGET.maxCandidateTrialsPerTarget - state.candidateTrialsUsed,
    remainingPlannerReruns: PHASE2C27B_LADDER_BUDGET.maxPlannerReruns - state.plannerRerunsUsed }
}

export function phase2c27bLadderStateIssues(state: unknown): string[] {
  if (!isObject(state)) return ['the ladder state is not an object']
  const issues: string[] = []
  if (!same(Object.keys(state).sort(), ['candidateTrialsUsed', 'plannerRerunsUsed', 'previouslyRejectedCandidateStableKeys'])) issues.push('the ladder state keys are not exactly the ladder state keys')
  const t = state.candidateTrialsUsed, r = state.plannerRerunsUsed, keys = state.previouslyRejectedCandidateStableKeys
  if (!Number.isSafeInteger(t) || (t as number) < 0 || (t as number) > PHASE2C27B_LADDER_BUDGET.maxCandidateTrialsPerTarget) issues.push(`candidateTrialsUsed ${String(t)} is outside 0..${PHASE2C27B_LADDER_BUDGET.maxCandidateTrialsPerTarget}`)
  if (!Number.isSafeInteger(r) || (r as number) < 0 || (r as number) > PHASE2C27B_LADDER_BUDGET.maxPlannerReruns) issues.push(`plannerRerunsUsed ${String(r)} is outside 0..${PHASE2C27B_LADDER_BUDGET.maxPlannerReruns}`)
  if (!Array.isArray(keys) || !keys.every(k => typeof k === 'string' && k.length > 0)) issues.push('previouslyRejectedCandidateStableKeys is not a list of keys')
  else {
    if (new Set(keys).size !== keys.length) issues.push('previouslyRejectedCandidateStableKeys repeats a key')
    if (Number.isSafeInteger(t) && keys.length > (t as number)) issues.push('more rejected keys than trials')
  }
  return issues
}

/**
 * The cumulative `maxPlannerReruns` budget of one (Target, context) ladder, shaped exactly as the Production
 * `createPlannerAlternativeFullRunBudget()` (same limit, same `PlannerAlternativeRerunLimitError` refusal, called by
 * `createProductionPlanWithObserver()` before every full run it starts) but starting from the runs the lower rungs already used.
 */
export function createPhase2C27BLadderRerunBudget(limit: number, usedAtStart: number): PlannerAlternativeFullRunBudget {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError(`Invalid rerun limit ${limit}.`)
  if (!Number.isSafeInteger(usedAtStart) || usedAtStart < 0 || usedAtStart > limit) throw new RangeError(`Invalid used reruns ${usedAtStart} of ${limit}.`)
  let used = usedAtStart
  return {
    get limit() { return limit },
    get used() { return used },
    get exhausted() { return used >= limit },
    beforePlannerRun() {
      if (used >= limit) throw new PlannerAlternativeRerunLimitError(limit, used)
      used += 1
    },
  }
}

// ---------------------------------------------------------------- the rung-major scheduler (§6.2), shared by runner and analyzer

export type Phase2C27BUnitOutcome = 'found_R' | 'not_found_within_search_extent' | 'stopped_by_search_extent_bound' | 'stopped_by_candidate_trial_bound' | 'stopped_by_planner_rerun_bound'
export const PHASE2C27B_UNIT_OUTCOMES: readonly Phase2C27BUnitOutcome[] = ['found_R', 'not_found_within_search_extent', 'stopped_by_search_extent_bound',
  'stopped_by_candidate_trial_bound', 'stopped_by_planner_rerun_bound']
/** Why a unit is unmeasured: never Candidate 0, never not-found, never extent shortage (G6). */
export type Phase2C27BUnmeasuredReason = 'timeout' | 'out_of_memory' | 'process_failure' | 'context_mismatch' | 'interrupted'
export type Phase2C27BUnitResult =
  | { measured: true; outcome: Phase2C27BUnitOutcome; ladderStateAtEnd: Phase2C27BLadderState }
  | { measured: false; reason: Phase2C27BUnmeasuredReason }
export type Phase2C27BTargetStopReason = 'found_R' | 'blocked_by_selected_checkpoint' | 'no_extent_escalation_context' | 'ladder_exhausted'
/** The last state of a context (Phase 2-C2.7-A §6.2 table). */
export type Phase2C27BContextState = 'not_executed' | 'found_R' | 'closed' | 'extent_escalation' | 'candidate_trial_bound_reached' | 'planner_rerun_bound_reached' | 'unmeasured'

export interface Phase2C27BScheduledUnit {
  unitId: string
  targetWeaponId: string
  targetIndex: number
  contextRank: number
  rung: Phase2C27BRungId
  ladderStateAtStart: Phase2C27BLadderState
}

export interface Phase2C27BTargetStop {
  stopReason: Phase2C27BTargetStopReason
  /** The rung the Target stopped at (null for a checkpoint block). */
  rung: Phase2C27BRungId | null
  /** The context of the `found_R` unit (null otherwise). */
  contextRank: number | null
}

export const phase2c27bUnitId = (targetIndex: number, contextRank: number, rung: Phase2C27BRungId) => `t${pad(targetIndex)}-r${pad(contextRank)}-${rung}`

/**
 * The pre-registered scheduler of one Target, as a pure state machine: `next()` returns the next policy-required unit or the
 * Target's stop, `record()` feeds back the typed result of that unit. It reads typed outcomes and ladder states only - never an
 * oracle field, an exact index, a compatibility, a required extent or a Target-specific value - so every Target follows one rule.
 */
export function createPhase2C27BTargetScheduler(plan: Phase2C27BTargetPlan) {
  let stop: Phase2C27BTargetStop | null = plan.checkpointBlocked ? { stopReason: 'blocked_by_selected_checkpoint', rung: null, contextRank: null } : null
  let rungIndex = 0
  let active = plan.contexts.map(c => c.contextRank)
  let position = 0
  let escalation: number[] = []
  let pending: Phase2C27BScheduledUnit | null = null
  const ladder = new Map<number, Phase2C27BLadderState>()
  const states = new Map<number, Phase2C27BContextState>(plan.contexts.map(c => [c.contextRank, 'not_executed']))
  const lastRung = new Map<number, Phase2C27BRungId>()
  const stateOf = (rank: number): Phase2C27BLadderState => structuredClone(ladder.get(rank) ?? PHASE2C27B_INITIAL_LADDER_STATE) as Phase2C27BLadderState
  return {
    next(): Phase2C27BScheduledUnit | Phase2C27BTargetStop {
      if (pending !== null) throw new Error(`Unit ${pending.unitId} has no recorded result.`)
      for (;;) {
        if (stop !== null) return { ...stop }
        if (position < active.length) {
          const rank = active[position]!
          const rung = PHASE2C27B_RUNG_IDS[rungIndex]!
          pending = { unitId: phase2c27bUnitId(plan.targetIndex, rank, rung), targetWeaponId: plan.targetWeaponId, targetIndex: plan.targetIndex, contextRank: rank, rung,
            ladderStateAtStart: stateOf(rank) }
          return structuredClone(pending)
        }
        const rung = PHASE2C27B_RUNG_IDS[rungIndex]!
        if (escalation.length === 0) { stop = { stopReason: 'no_extent_escalation_context', rung, contextRank: null }; continue }
        if (rungIndex === PHASE2C27B_RUNG_IDS.length - 1) { stop = { stopReason: 'ladder_exhausted', rung, contextRank: null }; continue }
        rungIndex += 1
        active = escalation
        escalation = []
        position = 0
      }
    },
    record(result: Phase2C27BUnitResult): void {
      if (pending === null) throw new Error('No unit is pending.')
      const { contextRank: rank, rung } = pending
      lastRung.set(rank, rung)
      if (!result.measured) states.set(rank, 'unmeasured')
      else {
        ladder.set(rank, structuredClone(result.ladderStateAtEnd))
        switch (result.outcome) {
          case 'found_R': states.set(rank, 'found_R'); stop = { stopReason: 'found_R', rung, contextRank: rank }; break
          case 'not_found_within_search_extent': states.set(rank, 'closed'); break
          case 'stopped_by_search_extent_bound': states.set(rank, 'extent_escalation'); escalation.push(rank); break
          case 'stopped_by_candidate_trial_bound': states.set(rank, 'candidate_trial_bound_reached'); break
          case 'stopped_by_planner_rerun_bound': states.set(rank, 'planner_rerun_bound_reached'); break
        }
      }
      position += 1
      pending = null
    },
    /** Every context's last state and the rung of its last unit (null if it never ran). */
    contextStates(): { contextRank: number; state: Phase2C27BContextState; lastRung: Phase2C27BRungId | null; ladderState: Phase2C27BLadderState }[] {
      return plan.contexts.map(c => ({ contextRank: c.contextRank, state: states.get(c.contextRank)!, lastRung: lastRung.get(c.contextRank) ?? null, ladderState: stateOf(c.contextRank) }))
    },
  }
}

/** A unit result as the scheduler reads it, from a child process outcome and its record (a semantic mismatch is unmeasured here and invalid in the analysis). */
export function phase2c27bUnitResult(process: Phase2C2ChildOutcome | 'interrupted', record: Phase2C27BUnitChildRecord | null): Phase2C27BUnitResult {
  if (process === 'interrupted') return { measured: false, reason: 'interrupted' }
  if (process !== 'completed') return { measured: false, reason: process }
  if (record === null) return { measured: false, reason: 'process_failure' }
  if (record.status === 'context_mismatch') return { measured: false, reason: 'context_mismatch' }
  return { measured: true, outcome: record.outcome, ladderStateAtEnd: structuredClone(record.ladderStateAtEnd) }
}

// ---------------------------------------------------------------- one unit (child calculation)

/** What a unit child receives: no oracle field, no Target-specific extent; the context selector, the rung and the ladder state. */
export interface Phase2C27BUnitTask {
  unitId: string
  targetWeaponId: string
  targetIndex: number
  contextRank: number
  rung: Phase2C27BRungId
  extent: PlannerAlternativeSearchExtent
  groupIndex: number
  reservationDigest: string
  cardinality: 0 | 1
  representativeFixedSetId: string
  supportBuildListEntryIds: string[]
  currentBuildListEntryId: string
  ladderStateAtStart: Phase2C27BLadderState
  budget: { maxCandidateTrialsPerTarget: number; maxPlannerReruns: number }
  researchMaxPlanSteps: number
}

export function phase2c27bUnitTask(plan: Phase2C27BTargetPlan, unit: Phase2C27BScheduledUnit): Phase2C27BUnitTask {
  const context = plan.contexts.find(c => c.contextRank === unit.contextRank)
  if (!context || unit.targetWeaponId !== plan.targetWeaponId) throw new Error(`Unit ${unit.unitId} is not a context of its Target plan.`)
  return { unitId: unit.unitId, targetWeaponId: plan.targetWeaponId, targetIndex: plan.targetIndex, contextRank: context.contextRank, rung: unit.rung, extent: phase2c27bRungExtent(unit.rung),
    groupIndex: context.groupIndex, reservationDigest: context.reservationDigest, cardinality: context.cardinality, representativeFixedSetId: context.representativeFixedSetId,
    supportBuildListEntryIds: [...context.supportBuildListEntryIds], currentBuildListEntryId: plan.currentBuildListEntryId, ladderStateAtStart: structuredClone(unit.ladderStateAtStart),
    budget: { maxCandidateTrialsPerTarget: PHASE2C27B_LADDER_BUDGET.maxCandidateTrialsPerTarget, maxPlannerReruns: PHASE2C27B_LADDER_BUDGET.maxPlannerReruns },
    researchMaxPlanSteps: PHASE2C27B_RESEARCH_MAX_PLAN_STEPS }
}

export type Phase2C27BDeliveryAction = 'skipped_previously_rejected' | 'trialled' | 'stopped_by_candidate_trial_bound' | 'stopped_by_planner_rerun_bound'

export interface Phase2C27BDelivery {
  deliveryIndex: number
  stableKey: string
  estimatedOperationCount: number
  estimatedAdvances: { normal: number | null; gogma: number | null; skill: number | null }
  action: Phase2C27BDeliveryAction
  /** The ladder-cumulative 0-based trial ordinal of a trialled Candidate (null otherwise). */
  trialOrdinal: number | null
  reservationCheck: ReturnType<typeof respectsPhase2C2Reservation>
}

export type Phase2C27BTrialVerdict =
  | { status: 'found_R'; generatedSelected: boolean }
  | { status: 'rejected'; reason: PlannerAlternativeTrialRejectionReason | 'reused_existing_entry' | 'preflight_refused' }
  | { status: 'rerun_bound' }

export interface Phase2C27BTrialRunSummary {
  planPresent: boolean
  termination: { status: string; completedTargetCount: number; totalTargetCount: number; reachedLimits: string[] }
  stepCount: number | null
  selectedCount: number | null
  conflictCount: number
  warningKinds: string[]
  generatedSelected: boolean
  supportSelected: string[]
  supportNotSelected: string[]
  generatedConflictsWithSupport: boolean
  generatedCommitment: { status: string; provisionalOutcomeSelectedBuildListEntryId: string | null; rejectionReasons: string[] } | null
}

export interface Phase2C27BTrialRecord {
  trialOrdinal: number
  deliveryIndex: number
  candidateStableKey: string
  generatedBuildListEntryId: string
  reusedExisting: boolean
  preflight: 'not_run' | 'ready' | 'refused'
  preflightRefusal: { status: string; detail: string } | null
  /** The resolutions the trial run received (G1: always 0 here). */
  trialConflictResolutions: number
  fullRunsStarted: number
  run: Phase2C27BTrialRunSummary | null
  verdict: Phase2C27BTrialVerdict
  elapsedMs: number
}

export interface Phase2C27BFoundRoute {
  candidateStableKey: string
  deliveryIndex: number
  trialOrdinal: number
  generatedBuildListEntryId: string
  generatedSelected: boolean
  route: PlannerAlternativeCandidate['route']
  finalBonuses: PlannerAlternativeCandidate['finalBonuses']
  restorationBonusScope: PlannerAlternativeCandidate['restorationBonusScope']
  seriesSkillId: PlannerAlternativeCandidate['seriesSkillId']
  groupSkillId: PlannerAlternativeCandidate['groupSkillId']
  estimatedOperationCount: number
  summary: Phase2C2CandidateSummary
  reservationCheck: ReturnType<typeof respectsPhase2C2Reservation>
}

export type Phase2C27BUnitChildRecord =
  | {
      status: 'executed'
      unitId: string
      task: Phase2C27BUnitTask
      outcome: Phase2C27BUnitOutcome
      ladderStateAtStart: Phase2C27BLadderState
      ladderStateAtEnd: Phase2C27BLadderState
      reservation: PlannerAlternativeReservation
      excludedRouteKeys: string[]
      deliveries: Phase2C27BDelivery[]
      skippedPreviouslyRejected: string[]
      trials: Phase2C27BTrialRecord[]
      found: Phase2C27BFoundRoute | null
      search: { deliveredCandidates: number; excludedCandidates: number; exhausted: boolean; stoppedByExtent: boolean; stoppedByConsumer: boolean; skippedExcludedRouteKeys: number }
      timing: { unitMs: number; searchVisitMs: number; trialMs: number; searchOnlyMs: number }
    }
  /** The re-derived context is not the task's: a semantic failure (invalid), never a Candidate count; no Search ran. */
  | { status: 'context_mismatch'; unitId: string; issues: string[] }

function trialRunSummary(result: PlannerResult, commitment: PlannerRouteCommitmentEvidence | null, generated: string, support: readonly string[]): Phase2C27BTrialRunSummary {
  const plan = result.plan
  const selected = new Set<string>(plan?.selectedBuildListEntryIds ?? [])
  const entry = commitment?.entries.find(e => e.buildListEntryId === generated)
  return {
    planPresent: plan !== null,
    termination: { status: result.termination.status, completedTargetCount: result.termination.completedTargetCount, totalTargetCount: result.termination.totalTargetCount,
      reachedLimits: [...result.termination.reachedLimits] },
    stepCount: plan === null ? null : plan.steps.length, selectedCount: plan === null ? null : plan.selectedBuildListEntryIds.length,
    conflictCount: result.conflicts.length, warningKinds: [...new Set(result.warnings.map(w => w.kind))].sort(compare),
    generatedSelected: selected.has(generated), supportSelected: support.filter(id => selected.has(id)), supportNotSelected: support.filter(id => !selected.has(id)),
    generatedConflictsWithSupport: result.conflicts.some(c => c.buildListEntryIds.includes(generated as BuildListEntryId) && c.buildListEntryIds.some(id => support.includes(id))),
    generatedCommitment: entry === undefined ? null : { status: entry.status, provisionalOutcomeSelectedBuildListEntryId: entry.provisionalOutcome?.selectedBuildListEntryId ?? null,
      rejectionReasons: [...entry.rejectionReasons] },
  }
}

/** One support context resolved against the baseline: everything the trial loop needs, from Production authorities only. */
export interface Phase2C27BPreparedContext {
  targetWeaponId: string
  /** The Target's current Entry `O`, whose Route is excluded and which `G` replaces. */
  invalidated: BuildListEntry
  /** The speculative support Entries (the reservation source; never an explicit resolution). */
  supportBuildListEntryIds: string[]
  reservation: PlannerAlternativeReservation
  /** `[candidateStableKey(O's Route)]`. */
  excludedRouteKeys: string[]
  origin: ReturnType<typeof createPlannerStartSearchOrigin>
  /** The conflicts of the baseline (the preflight's original conflict contexts; no fixed constraint is ever built from them). */
  conflictContexts: ReturnType<typeof createPlannerConflictContexts>
}

/**
 * Resolves one (Target, support set) against the baseline PlannerInput: the ready initial context, the Target's one current
 * searchable Entry, every support Entry a valid Entry of the baseline, the reservation `derivePlannerAlternativeReservation()`
 * derives from them, the excluded current Route key and the Planner-start origin. Fails closed (issues) otherwise; never repairs.
 */
export function phase2c27bResolveSupportContext(input: PlannerInput, dependencies: PlannerDependencies, targetWeaponId: string, supportBuildListEntryIds: readonly string[]):
  { status: 'ready'; prepared: Phase2C27BPreparedContext } | { status: 'invalid'; issues: string[] } {
  if (input.conflictResolutions.length !== 0) return { status: 'invalid', issues: ['the baseline PlannerInput carries a conflict resolution'] }
  const prepared = preparePlannerInitialContext(input, dependencies)
  if (prepared.status !== 'ready') return { status: 'invalid', issues: [`the baseline initial context is not ready: ${JSON.stringify(prepared.issues ?? [])}`] }
  const initial = prepared.context
  const ownEntries = initial.allSearchEntries.filter(e => e.targetWeaponId === targetWeaponId)
  const invalidated = ownEntries[0]
  if (ownEntries.length !== 1 || !invalidated) return { status: 'invalid', issues: ['the Target does not hold exactly one current searchable Entry'] }
  if (supportBuildListEntryIds.includes(invalidated.id)) return { status: 'invalid', issues: ['the support set holds the Target\'s own Entry'] }
  const supportEntries = supportBuildListEntryIds.map(id => initial.entriesById.get(id as BuildListEntryId))
  if (supportEntries.some(e => e === undefined)) return { status: 'invalid', issues: ['a support Entry is not a valid Entry of the baseline'] }
  return { status: 'ready', prepared: { targetWeaponId, invalidated, supportBuildListEntryIds: [...supportBuildListEntryIds],
    reservation: derivePlannerAlternativeReservation(supportEntries as BuildListEntry[], dependencies.rngEngine), excludedRouteKeys: [candidateStableKey(invalidated.candidateSnapshot)],
    origin: createPlannerStartSearchOrigin(input), conflictContexts: createPlannerConflictContexts(initial) } }
}

export type Phase2C27BTrialLoopResult = Omit<Extract<Phase2C27BUnitChildRecord, { status: 'executed' }>, 'status' | 'unitId' | 'task'>

/**
 * The trial loop of one unit, in the Production kernel's order (`runPreparedPlannerAlternativeKernel()`), its bounds read from the
 * (Target, context) ladder state instead of a fresh request budget: the Production Search at `extent`, then per delivered Candidate
 * skip (previously rejected key, no budget) / trial bound / rerun bound / trial; each trial a `found_R` judgement (see the module
 * comment). The baseline PlannerInput is never changed. Failures of Plan generation, Trace Replay, prediction or a Planner / Search
 * invariant propagate unchanged.
 */
export async function runPhase2C27BTrialLoop(input: PlannerInput, context: Phase2C27BPreparedContext, extent: PlannerAlternativeSearchExtent, ladderStateAtStart: Phase2C27BLadderState,
  dependencies: PlannerDependencies, options: { yieldControl?: () => Promise<void>; now?: () => number } = {}): Promise<Phase2C27BTrialLoopResult> {
  const now = options.now ?? (() => performance.now())
  const unitStarted = now()
  const engine: RngEngine = dependencies.rngEngine
  const stateIssues = phase2c27bLadderStateIssues(ladderStateAtStart)
  if (stateIssues.length > 0) throw new Error(`Invalid ladder state: ${stateIssues.join('; ')}`)
  if (input.conflictResolutions.length !== 0) throw new Error('Phase 2-C2.7-B invariant violated: the baseline PlannerInput carries a conflict resolution.')
  const { invalidated, reservation, excludedRouteKeys, origin, conflictContexts } = context
  const support = [...context.supportBuildListEntryIds]
  const start = structuredClone(ladderStateAtStart)
  const budget = createPhase2C27BLadderRerunBudget(PHASE2C27B_LADDER_BUDGET.maxPlannerReruns, start.plannerRerunsUsed)
  const runner = createPlannerAlternativeFullRunner(budget, dependencies, { yieldControl: options.yieldControl })
  const searchInput = { origin, targetWeaponId: context.targetWeaponId as never, extent: { ...extent }, reservation, excludedRouteKeys: [...excludedRouteKeys] }
  const materializer = createPlannerAlternativeMaterializer({ ...searchInput, clock: dependencies.clock })
  const rejected = [...start.previouslyRejectedCandidateStableKeys]
  const rejectedSet = new Set(rejected)
  const skippedPreviouslyRejected: string[] = []
  const deliveries: Phase2C27BDelivery[] = []
  const trials: Phase2C27BTrialRecord[] = []
  let trialsUsed = start.candidateTrialsUsed
  let outcome: Phase2C27BUnitOutcome | null = null
  let found: Phase2C27BFoundRoute | null = null
  let trialMs = 0

  const summaryOf = (candidate: PlannerAlternativeCandidate) => {
    const entry = materializer.materializeBuildListEntry(candidate, []).entry
    const summary = summarizePhase2C2Entry(entry, input, engine)
    return { summary, reservationCheck: respectsPhase2C2Reservation(summary, candidate.route, reservation) }
  }

  const tryCandidate = async (candidate: PlannerAlternativeCandidate, deliveryIndex: number, trialOrdinal: number): Promise<Phase2C27BTrialRecord> => {
    const started = now()
    const key = candidateStableKey(candidate)
    const usedBefore = budget.used
    const base = { trialOrdinal, deliveryIndex, candidateStableKey: key }
    const generated = materializer.materializeBuildListEntry(candidate, input.buildListEntries)
    const finish = (rest: Omit<Phase2C27BTrialRecord, 'trialOrdinal' | 'deliveryIndex' | 'candidateStableKey' | 'generatedBuildListEntryId' | 'reusedExisting' | 'fullRunsStarted' | 'elapsedMs'>): Phase2C27BTrialRecord =>
      ({ ...base, generatedBuildListEntryId: generated.entry.id, reusedExisting: generated.reusedExisting, ...rest, fullRunsStarted: budget.used - usedBefore, elapsedMs: now() - started })
    // The kernel's order (`tryCandidate()`): an Entry this exact content already holds is the Target's own O, no alternative.
    if (generated.reusedExisting) return finish({ preflight: 'not_run', preflightRefusal: null, trialConflictResolutions: 0, run: null, verdict: { status: 'rejected', reason: 'reused_existing_entry' } })
    const resolved = resolveBuildListEntryReplacement(input.buildListEntries, generated.entry)
    if (resolved.status !== 'ready' || resolved.replacement.replacedBuildListEntryId !== invalidated.id) {
      throw new Error(`Phase 2-C2.7-B invariant violated: the temporary Entry of TargetWeapon '${context.targetWeaponId}' does not replace its current Entry '${invalidated.id}'.`)
    }
    const replacements = [resolved.replacement]
    // No fixed constraint at all: a speculative support Entry is never an explicit resolution (G1).
    const preflight = preparePlannerReplacementConflictPreflight({ ...input, buildListEntries: [...input.buildListEntries, generated.entry] }, replacements, [], conflictContexts, dependencies)
    if (preflight.status !== 'ready') {
      return finish({ preflight: 'refused', preflightRefusal: { status: preflight.status, detail: JSON.stringify(preflight).slice(0, 2000) }, trialConflictResolutions: 0, run: null,
        verdict: { status: 'rejected', reason: 'preflight_refused' } })
    }
    if (preflight.resolvedInput.conflictResolutions.length !== 0) throw new Error('Phase 2-C2.7-B invariant violated: a trial run received a conflict resolution.')
    const runContext: PlannerRunBuildListContext = { kind: 'temporary_replacement', replacements }
    const run = await runner.run(preflight.resolvedInput, runContext)
    if (run === 'rerun_budget_reached') return finish({ preflight: 'ready', preflightRefusal: null, trialConflictResolutions: 0, run: null, verdict: { status: 'rerun_bound' } })
    const verdict = judgePlannerAlternativeTrial(run.result, { generatedBuildListEntryId: generated.entry.id, explicitDecisionBuildListEntryIds: support as BuildListEntryId[],
      fixedRouteBuildListEntryIds: support as BuildListEntryId[], routeCommitment: run.routeCommitment })
    return finish({ preflight: 'ready', preflightRefusal: null, trialConflictResolutions: preflight.resolvedInput.conflictResolutions.length,
      run: trialRunSummary(run.result, run.routeCommitment, generated.entry.id, support),
      verdict: verdict.status === 'found' ? { status: 'found_R', generatedSelected: verdict.generatedSelected } : { status: 'rejected', reason: verdict.reason } })
  }

  const visitStarted = now()
  const execution = await visitPlannerAlternativeCandidates(searchInput, engine, async (candidate: PlannerAlternativeCandidate) => {
    const deliveryIndex = deliveries.length
    const key = candidateStableKey(candidate)
    const { summary, reservationCheck } = summaryOf(candidate)
    const delivery: Phase2C27BDelivery = { deliveryIndex, stableKey: key, estimatedOperationCount: candidate.estimatedOperationCount,
      estimatedAdvances: { normal: candidate.estimatedNormalAdvance, gogma: candidate.estimatedGogmaAdvance, skill: candidate.estimatedSkillAdvance },
      action: 'trialled', trialOrdinal: null, reservationCheck }
    deliveries.push(delivery)
    if (rejectedSet.has(key)) {
      delivery.action = 'skipped_previously_rejected'
      skippedPreviouslyRejected.push(key)
      return 'continue'
    }
    // Only a further, non-skipped Candidate proves the cumulative trial cap truncated something.
    if (trialsUsed >= PHASE2C27B_LADDER_BUDGET.maxCandidateTrialsPerTarget) { delivery.action = 'stopped_by_candidate_trial_bound'; outcome = 'stopped_by_candidate_trial_bound'; return 'stop' }
    if (budget.exhausted) { delivery.action = 'stopped_by_planner_rerun_bound'; outcome = 'stopped_by_planner_rerun_bound'; return 'stop' }
    const trialOrdinal = trialsUsed
    trialsUsed += 1
    delivery.trialOrdinal = trialOrdinal
    const trial = await tryCandidate(candidate, deliveryIndex, trialOrdinal)
    trialMs += trial.elapsedMs
    trials.push(trial)
    if (trial.verdict.status === 'rerun_bound') { outcome = 'stopped_by_planner_rerun_bound'; return 'stop' }
    if (trial.verdict.status === 'found_R') {
      outcome = 'found_R'
      found = { candidateStableKey: key, deliveryIndex, trialOrdinal, generatedBuildListEntryId: trial.generatedBuildListEntryId, generatedSelected: trial.verdict.generatedSelected,
        route: structuredClone(candidate.route), finalBonuses: structuredClone(candidate.finalBonuses), restorationBonusScope: candidate.restorationBonusScope,
        seriesSkillId: candidate.seriesSkillId, groupSkillId: candidate.groupSkillId, estimatedOperationCount: candidate.estimatedOperationCount, summary, reservationCheck }
      return 'stop'
    }
    rejected.push(key)
    rejectedSet.add(key)
    return 'continue'
  }, { yieldControl: options.yieldControl })
  const searchVisitMs = now() - visitStarted
  const settled: Phase2C27BUnitOutcome = outcome ?? (execution.summary.stoppedByExtent ? 'stopped_by_search_extent_bound' : 'not_found_within_search_extent')
  return {
    outcome: settled, ladderStateAtStart: start,
    ladderStateAtEnd: { candidateTrialsUsed: trialsUsed, plannerRerunsUsed: budget.used, previouslyRejectedCandidateStableKeys: rejected },
    reservation, excludedRouteKeys: [...excludedRouteKeys], deliveries, skippedPreviouslyRejected, trials, found,
    search: { deliveredCandidates: execution.summary.deliveredCandidates, excludedCandidates: execution.summary.excludedCandidates, exhausted: execution.summary.exhausted,
      stoppedByExtent: execution.summary.stoppedByExtent, stoppedByConsumer: execution.stoppedByConsumer, skippedExcludedRouteKeys: execution.skippedExcludedRouteKeys.length },
    timing: { unitMs: now() - unitStarted, searchVisitMs, trialMs, searchOnlyMs: searchVisitMs - trialMs },
  }
}

/**
 * One policy-required unit: the task checked against the child's own re-derived schedule (any drift is a context mismatch and no
 * Search runs), the context resolved against the baseline and checked against the snapshot (origin digest, current Route key,
 * group reservation), then `runPhase2C27BTrialLoop()` at the rung's extent with the task's ladder state.
 */
export async function runPhase2C27BUnit(input: PlannerInput, schedule: Phase2C26B2C1Schedule, task: Phase2C27BUnitTask, dependencies: PlannerDependencies,
  options: { yieldControl?: () => Promise<void>; now?: () => number } = {}): Promise<Phase2C27BUnitChildRecord> {
  const mismatch = (issues: string[]): Phase2C27BUnitChildRecord => ({ status: 'context_mismatch', unitId: task.unitId, issues })
  const issues: string[] = [...phase2c27bPolicyDrift(schedule)]
  if (!PHASE2C27B_RUNG_IDS.includes(task.rung) || !same(task.extent, phase2c27bRungExtent(task.rung))) issues.push('extent is not the registered rung extent')
  if (!same(task.budget, { maxCandidateTrialsPerTarget: PHASE2C27B_LADDER_BUDGET.maxCandidateTrialsPerTarget, maxPlannerReruns: PHASE2C27B_LADDER_BUDGET.maxPlannerReruns })) issues.push('budget is not the registered ladder budget')
  if (task.researchMaxPlanSteps !== PHASE2C27B_RESEARCH_MAX_PLAN_STEPS || input.options.maxPlanSteps !== PHASE2C27B_RESEARCH_MAX_PLAN_STEPS) issues.push('the Research maxPlanSteps is not 20000')
  if (input.conflictResolutions.length !== 0) issues.push('the baseline PlannerInput carries a conflict resolution')
  issues.push(...phase2c27bLadderStateIssues(task.ladderStateAtStart).map(i => `ladderStateAtStart: ${i}`))
  const built = buildPhase2C27BTargetPlans(schedule, [task.targetWeaponId])
  issues.push(...built.issues)
  const plan = built.plans[0]
  const context = plan?.contexts.find(c => c.contextRank === task.contextRank)
  if (plan && plan.checkpointBlocked) issues.push('a checkpoint-blocked Target has no unit')
  if (plan && plan.currentBuildListEntryId !== task.currentBuildListEntryId) issues.push('currentBuildListEntryId')
  if (!context) issues.push(`P1 rank ${task.contextRank} is not a K <= 1 context`)
  else {
    if (phase2c27bUnitId(task.targetIndex, task.contextRank, task.rung) !== task.unitId) issues.push('unitId')
    for (const field of ['groupIndex', 'reservationDigest', 'cardinality', 'representativeFixedSetId', 'supportBuildListEntryIds'] as const) {
      if (!same(context[field], task[field])) issues.push(field)
    }
  }
  if (issues.length > 0 || !plan || !context) return mismatch(issues)
  const snapshotTarget = schedule.snapshot.targets.find(t => t.targetWeaponId === task.targetWeaponId)
  const group = schedule.snapshot.reservationGroups[context.groupIndex]
  if (!snapshotTarget || !group) return mismatch(['the snapshot Target or group is missing'])
  const resolved = phase2c27bResolveSupportContext(input, dependencies, task.targetWeaponId, context.supportBuildListEntryIds)
  if (resolved.status !== 'ready') return mismatch(resolved.issues)
  const prepared = resolved.prepared
  if (hashStableValue(prepared.origin) !== schedule.snapshot.originDigest) return mismatch(['the Planner-start origin does not hash to the snapshot origin digest'])
  if (prepared.invalidated.id !== task.currentBuildListEntryId) return mismatch(['the current Entry differs'])
  if (prepared.excludedRouteKeys[0] !== snapshotTarget.currentRouteKey || !same(snapshotTarget.excludedRouteKeys, prepared.excludedRouteKeys)) return mismatch(['the excluded current Route key differs'])
  if (stableStringify(prepared.reservation) !== stableStringify(group.reservation) || hashStableValue(prepared.reservation) !== task.reservationDigest) return mismatch(['the re-derived reservation is not the group reservation'])
  const loop = await runPhase2C27BTrialLoop(input, prepared, task.extent, task.ladderStateAtStart, dependencies, options)
  return { status: 'executed', unitId: task.unitId, task: structuredClone(task), ...loop }
}

// ---------------------------------------------------------------- Production source audit (registered rule)

/** Research / test paths that are not Production calculation sources (the B2-C2B2I rule). */
export function isPhase2C27BResearchOrTestPath(path: string): boolean {
  return path.startsWith('src/benchmarks/') || path.startsWith('src/test/') || path.startsWith('scripts/') || path.startsWith('docs/')
    || /\.test\.tsx?$/.test(path) || path.startsWith('.github/')
}
export const phase2c27bProductionChangedFiles = (changed: readonly string[]): string[] =>
  [...new Set(changed.filter(path => path.length > 0 && !isPhase2C27BResearchOrTestPath(path)))].sort(compare)

// ---------------------------------------------------------------- runner start attestation (written before the first child)

export const PHASE2C27B_START_ATTESTATION_FILE = 'start-attestation.json'
export const PHASE2C27B_START_ATTESTATION_PHASE = 'Issue #154 Phase 2-C2.7-B runner start attestation'

/** The registered conditions of a formal launch (the runner fills nothing of these by hand). */
export function phase2c27bRegisteredConditions() {
  return {
    policyAuthority: { ...PHASE2C27B_POLICY_AUTHORITY },
    populationAuthority: { ...PHASE2C27B_POPULATION_AUTHORITY },
    targets: PHASE2C27B_TARGETS,
    registeredP1: structuredClone(PHASE2C27B_REGISTERED_P1) as unknown,
    contextScope: { ...PHASE2C27B_CONTEXT_SCOPE },
    ladder: PHASE2C27B_LADDER.map(r => ({ id: r.id, extent: { ...r.extent } })),
    ladderBudget: { ...PHASE2C27B_LADDER_BUDGET },
    researchMaxPlanSteps: PHASE2C27B_RESEARCH_MAX_PLAN_STEPS,
    executionEnvelope: { ...PHASE2C27B_EXECUTION_ENVELOPE },
    tasksBudgetMs: PHASE2C27B_TASKS_BUDGET_MS,
    memorySampleIntervalMs: PHASE2C27B_MEMORY_SAMPLE_INTERVAL_MS,
    nodeYield: PHASE2C27B_NODE_YIELD,
    scheduler: { order: 'manifest Target order; per Target rung-major L0 -> L1 -> L2; P1 order inside a rung', escalation: 'stopped_by_search_extent_bound only',
      targetStop: ['found_R', 'blocked_by_selected_checkpoint', 'no_extent_escalation_context', 'ladder_exhausted'] },
    decisionRule: [...PHASE2C27B_DECISION_RULE],
    provenanceFlags: { ...PHASE2C27B_PROVENANCE_FLAGS },
    notRun: [...PHASE2C27B_NOT_RUN],
  }
}

export interface Phase2C27BProductionAudit {
  baseMain: string
  baseMainIsAncestor: boolean
  /** Production calculation sources changed since the base main (working tree and untracked files included). */
  productionChangedSinceBaseMain: string[]
}

export interface Phase2C27BLaunchObservation {
  createdAt: string
  runnerScript: string
  node: string
  repositoryHead: string
  uncommittedBenchmarkCode: boolean
  benchmarkCodeSha256: string
  policyDocumentSha256: string
  exportFileName: string
  exportSha256: string
  exportBytes: number
  targetManifestFileName: string
  targetManifestSha256: string
  targetWeaponIds: string[]
  productionAudit: Phase2C27BProductionAudit
  machine: { freeMemoryBytes: number; totalMemoryBytes: number; otherNodeProcesses: number | null; cpuBusyShare: number | null }
  /** The envelope the runner actually applies (a non-formal smoke may shorten the unit budget). */
  appliedExecutionEnvelope: { unitBudgetMs: number; childHeapMb: number; concurrency: number; retry: string; fallback: string }
  smoke: { targetIndexes: number[] | null; maxUnits: number | null; unitBudgetMs: number | null } | null
}

export type Phase2C27BStartAttestation = ReturnType<typeof phase2c27bRegisteredConditions> & Phase2C27BLaunchObservation & { phase: string; attestedBy: 'runner' }

export function phase2c27bStartAttestationBody(observation: Phase2C27BLaunchObservation): Phase2C27BStartAttestation {
  return { phase: PHASE2C27B_START_ATTESTATION_PHASE, attestedBy: 'runner', ...phase2c27bRegisteredConditions(), ...observation }
}

const EMPTY_OBSERVATION: Phase2C27BLaunchObservation = { createdAt: '', runnerScript: '', node: '', repositoryHead: '', uncommittedBenchmarkCode: false, benchmarkCodeSha256: '',
  policyDocumentSha256: '', exportFileName: '', exportSha256: '', exportBytes: 0, targetManifestFileName: '', targetManifestSha256: '', targetWeaponIds: [],
  productionAudit: { baseMain: '', baseMainIsAncestor: false, productionChangedSinceBaseMain: [] }, machine: { freeMemoryBytes: 0, totalMemoryBytes: 0, otherNodeProcesses: null, cpuBusyShare: null },
  appliedExecutionEnvelope: { ...PHASE2C27B_EXECUTION_ENVELOPE }, smoke: null }
const ATTESTATION_KEYS = Object.keys(phase2c27bStartAttestationBody(EMPTY_OBSERVATION)).sort()
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

export interface Phase2C27BAttestationExpectation {
  repositoryHead: string
  benchmarkCodeSha256: string
  exportSha256: string
  targetManifestSha256: string
  targetWeaponIds: readonly string[]
  /** When the first child (the tasks child) started, if known: the attestation must not be later. */
  firstChildStartedAt: string | null
}

export interface Phase2C27BAttestationVerification {
  verified: boolean
  issues: string[]
  /** The subset that breaks the attestation's integrity (malformed, foreign, later, or a HEAD / code / input mismatch). */
  integrityIssues: string[]
}

/**
 * Whether a start attestation proves a formal launch, failing closed on anything else: exactly the attestation keys, the runner
 * and phase markers, a canonical UTC `createdAt` no later than the first child, the attested HEAD / benchmark code / Export /
 * manifest / Target IDs equal to the independently obtained ones, the registered policy document and population authorities, Production changed files = [] with the base main an ancestor, a clean non-smoke launch, and every registered
 * condition (ordering, scope, ladder, budget, Plan step bound, envelope, scheduler, decision rule, provenance) unchanged.
 */
export function verifyPhase2C27BStartAttestation(attestation: unknown, expected: Phase2C27BAttestationExpectation): Phase2C27BAttestationVerification {
  if (!isObject(attestation)) return { verified: false, issues: ['the start attestation is not an object'], integrityIssues: ['the start attestation is not an object'] }
  const integrityIssues: string[] = []
  const launchIssues: string[] = []
  if (!same(Object.keys(attestation).sort(), ATTESTATION_KEYS)) integrityIssues.push('the start attestation keys are not exactly the attestation keys')
  if (attestation.attestedBy !== 'runner') integrityIssues.push('not attested by the runner')
  if (attestation.phase !== PHASE2C27B_START_ATTESTATION_PHASE) integrityIssues.push('not a Phase 2-C2.7-B start attestation')
  if (typeof attestation.createdAt !== 'string' || !ISO_UTC.test(attestation.createdAt) || new Date(attestation.createdAt).toISOString() !== attestation.createdAt) integrityIssues.push('createdAt is not a canonical UTC time')
  else if (expected.firstChildStartedAt !== null && !(attestation.createdAt <= expected.firstChildStartedAt)) integrityIssues.push('createdAt is later than the first child start')
  if (typeof attestation.repositoryHead !== 'string' || !/^[0-9a-f]{40}$/.test(attestation.repositoryHead)) integrityIssues.push('repositoryHead is not a commit SHA')
  if (attestation.repositoryHead !== expected.repositoryHead) integrityIssues.push('repositoryHead differs')
  if (attestation.benchmarkCodeSha256 !== expected.benchmarkCodeSha256) integrityIssues.push('benchmarkCodeSha256 differs')
  if (attestation.exportSha256 !== expected.exportSha256) integrityIssues.push('exportSha256 differs')
  if (attestation.targetManifestSha256 !== expected.targetManifestSha256) integrityIssues.push('targetManifestSha256 differs')
  if (!same(attestation.targetWeaponIds, expected.targetWeaponIds)) integrityIssues.push('targetWeaponIds differ')
  if (attestation.policyDocumentSha256 !== PHASE2C27B_POLICY_AUTHORITY.sha256) integrityIssues.push('policyDocumentSha256 is not the registered Phase 2-C2.7-A document')
  const audit = isObject(attestation.productionAudit) ? attestation.productionAudit : null
  if (audit === null || !same(Object.keys(audit).sort(), ['baseMain', 'baseMainIsAncestor', 'productionChangedSinceBaseMain'])) integrityIssues.push('productionAudit is not an audit')
  else {
    if (audit.baseMain !== PHASE2C27B_POLICY_AUTHORITY.baseMain) integrityIssues.push('productionAudit.baseMain is not the registered base main')
    if (audit.baseMainIsAncestor !== true) launchIssues.push('the base main is not an ancestor of the launch HEAD')
    if (!Array.isArray(audit.productionChangedSinceBaseMain) || audit.productionChangedSinceBaseMain.length !== 0) launchIssues.push('Production source changed files are not []')
  }
  if (attestation.uncommittedBenchmarkCode !== false) launchIssues.push('uncommitted benchmark code at launch')
  if (attestation.smoke !== null) launchIssues.push('a smoke option at launch')
  if (!same(attestation.appliedExecutionEnvelope, PHASE2C27B_EXECUTION_ENVELOPE)) launchIssues.push('the applied execution envelope differs from the registered envelope')
  for (const [field, value] of Object.entries(phase2c27bRegisteredConditions())) if (!same(attestation[field], value)) launchIssues.push(`${field} differs from the registered condition`)
  const issues = [...integrityIssues, ...launchIssues]
  return { verified: issues.length === 0, issues, integrityIssues }
}
