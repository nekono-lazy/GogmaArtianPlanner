/**
 * Issue #154 Phase 2-C2.6-B2-C2B2A: the E1 Targets (K1-minimal and extent-insufficient, characterized by B2-C2B1)
 * searched in their P1 top-32 reservation contexts with ONE common Research extent, L2. Research only. Never import from
 * Production.
 *
 * B2-C2A / R1 / R2 closed the default-extent layer: the P1 scheduler-selected contexts plus the unchanged Planner
 * Alternative Search delivered the oracle Route of 20 / 20 default-extent Targets (C4C). B2-C2B1 characterized the 20
 * extent-insufficient Targets and registered the ladder L0 / L1 / L2, of which L2 covers all 11 E1 Targets. B2-C2B2A asks
 * only whether, with the extent shortage removed by that one common extent, the same mechanism delivers the E1 Routes:
 *
 * ```text
 * Export
 *   -> derivePhase2C26B2C1Schedule()              (unchanged B2-C1 calculation and P1 ranks; its extent stays the Production
 *                                                  default: reservation universe, ordering, digests, fixed sets unchanged)
 *   -> per E1 Target: P1 rank 1..32               (mechanically, every rank, no early stop)
 *   -> reconstructPhase2C26B2B2AContext()         (unchanged: origin, reservation, excluded current Route, default extent)
 *   -> phase2c26b2c2b2aL2Context()                (the extent alone replaced by L2; every other field checked unchanged,
 *                                                  the Search input digest recomputed by the unchanged B1 digest)
 *   -> visitPlannerAlternativeCandidates()        (unchanged Production Search at L2)
 *   -> capture: the unchanged B2-C2A C4C rule (4 distinct operation-cost cohorts drained, 5th cost = sentinel, safety cap 1024)
 * ```
 *
 * The Search side receives the E1 Target IDs (a population chosen post hoc, declared), the P1 rank, the expected digests
 * (to fail closed on a drift), the common L2 extent, the capture rule and the safety cap. It never receives an oracle Route,
 * a stable key, an expected rank / index / cost, a first-compatible context or any Target-specific required extent, and an
 * oracle match never stops it: every E1 Target is searched at every rank 1..32.
 */
import { hashStableValue, stableStringify } from '../domain/models/hashing'
import type { BuildListEntry } from '../domain/models/publicTypes'
import { createPlannerAlternativeMaterializer } from '../domain/planner/alternative'
import type { PlannerInput } from '../domain/planner/plannerTypes'
import { createPlannerStartSearchOrigin } from '../domain/planner/replacement/plannerSearchOrigin'
import type { RngEngine } from '../domain/rng/rngEngine'
import {
  candidateStableKey,
  compareConstrainedCandidates,
  defaultPlannerAlternativeSearchExtent,
  visitPlannerAlternativeCandidates,
  type PlannerAlternativeCandidate,
  type PlannerAlternativeSearchExtent,
} from '../domain/search'
import { preferredSourceRank } from '../domain/search/semanticKeys'
import { GLOBAL_RESEARCH_TIME } from './plannerGlobalOptimizationResearch'
import { phase2c2SearchStatus, respectsPhase2C2Reservation, summarizePhase2C2Entry, type Phase2C2ChildOutcome, type Phase2C2SearchStatus } from './plannerGlobalPhase2C2'
import type { Phase2C25APreSearchContext } from './plannerGlobalPhase2C25A'
import { phase2c26b1SearchInputDigest } from './plannerGlobalPhase2C26B1'
import { reconstructPhase2C26B2B2AContext, type Phase2C26B2B2AContext } from './plannerGlobalPhase2C26B2B2A'
import type { Phase2C26B2B2A2DeliveredCandidate } from './plannerGlobalPhase2C26B2B2A2'
import type { Phase2C26B2C1ContextRow, Phase2C26B2C1Schedule } from './plannerGlobalPhase2C26B2C1'
import {
  createPhase2C26B2C2ACapture,
  phase2c26b2c2aPolicyDrift,
  PHASE2C26B2C2A_CANDIDATE_SAFETY_CAP,
  PHASE2C26B2C2A_CAPTURE_PREFIXES,
  PHASE2C26B2C2A_MAX_COST_COHORTS,
  PHASE2C26B2C2A_REGISTERED_P1,
  type Phase2C26B2C2ATermination,
} from './plannerGlobalPhase2C26B2C2A'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0

// ---------------------------------------------------------------- Research execution conditions (registered, not Production defaults)

/** The P1 context budget per Target: ranks 1..32, every one searched (B2-C2B1: the E1 P1 first compatible ranks are 2..32). */
export const PHASE2C26B2C2B2A_CONTEXT_BUDGET = 32
/** The E1 population size (B2-C2B1 cohort E1 = extentInsufficient AND k1Minimal). */
export const PHASE2C26B2C2B2A_TARGETS = 11
export const PHASE2C26B2C2B2A_EXPECTED_TASKS = PHASE2C26B2C2B2A_TARGETS * PHASE2C26B2C2B2A_CONTEXT_BUDGET
/**
 * The one common Search extent: B2-C2B1 ladder rung L2 (`larger`), the same for every E1 Target and every context. It is a
 * Research extent registered from the E1 cohort post hoc, never a Production default and never one Target's oracle value.
 */
export const PHASE2C26B2C2B2A_EXTENT: Readonly<PlannerAlternativeSearchExtent> = Object.freeze({ maxNormalAdvance: 128, maxGogmaAdvance: 235, maxSkillAdvance: 1500 })
export const PHASE2C26B2C2B2A_EXTENT_LABEL = 'L2' as const
/** The unchanged B2-C2A capture rule (C4C) and its post-hoc prefixes. */
export const PHASE2C26B2C2B2A_MAX_COST_COHORTS = PHASE2C26B2C2A_MAX_COST_COHORTS
export const PHASE2C26B2C2B2A_CANDIDATE_SAFETY_CAP = PHASE2C26B2C2A_CANDIDATE_SAFETY_CAP
export const PHASE2C26B2C2B2A_CAPTURE_PREFIXES = PHASE2C26B2C2A_CAPTURE_PREFIXES
export const PHASE2C26B2C2B2A_NODE_YIELD = 'setImmediate' as const
export const PHASE2C26B2C2B2A_MEMORY_SAMPLE_INTERVAL_MS = 250
/** The tasks child (schedule re-derivation + task construction, no Search). */
export const PHASE2C26B2C2B2A_TASKS_BUDGET_MS = 10 * 60 * 1000
/** Stage 1: every task once, fresh child, heap 8 GB, concurrency 1 (L2 is far wider than the default), 10 minutes, no retry, no fallback. */
export const PHASE2C26B2C2B2A_STAGE1 = { executionClass: 'stage1', childHeapMb: 8192, concurrency: 1, budgetMs: 10 * 60 * 1000, retry: 'none', fallback: 'none' } as const
/** What B2-C2B2A deliberately does not run. */
export const PHASE2C26B2C2B2A_NOT_RUN = ['production_change', 'production_default_extent_change', 'l0_search', 'l1_search', 'ladder_escalation', 'per_target_extent',
  'search_algorithm_change', 'search_ordering_change', 'search_comparator_change', 'p1_change', 'k2_feature_grouping', 'e2_search', 'residual_unreached_support',
  'oracle_guided_context_selection', 'context_level_early_stop', 'target_level_early_stop', 'timeout_fallback', 'retry', 'candidate_trial', 'planner_alternative_kernel',
  'full_planner_rerun', 'global_assignment', 'production_scheduler_adoption', 'runtime_optimization', 'ui_change'] as const

/** The B2-C2B1 RESULT the E1 Target manifest must come from (the manifest records it; the Search never reads it). */
export const PHASE2C26B2C2B2A_TARGET_SOURCE = { resultSha256: '418166d2a7ff40145d8650f418c025783f9b5039673ee19e722bab4836b22eae', population: 'E1', policy: 'P1' } as const

/** The policy definition check, unchanged from B2-C2A (the schedule's P1, the module's P1 and the registered copy are one definition). */
export const phase2c26b2c2b2aPolicyDrift = phase2c26b2c2aPolicyDrift
export const PHASE2C26B2C2B2A_REGISTERED_P1 = PHASE2C26B2C2A_REGISTERED_P1

// ---------------------------------------------------------------- the E1 Target manifest (a Search input)

/** The E1 population as Target IDs only: no rank, digest, first-compatible context, required extent or oracle field. */
export interface Phase2C26B2C2B2ATargetManifest {
  phase: string
  sourceResultSha256: string
  population: 'E1'
  policy: 'P1'
  contextBudget: number
  /** The Export B2-C2B1 was measured on (from that RESULT's provenance). */
  exportSha256: string
  targetWeaponIds: string[]
}

const MANIFEST_KEYS = ['contextBudget', 'exportSha256', 'phase', 'policy', 'population', 'sourceResultSha256', 'targetWeaponIds']

/**
 * Reads an E1 Target manifest as untrusted JSON: exactly the manifest keys (nothing else may ride along), the registered
 * source RESULT, population and policy, budget 32, and 11 distinct Target IDs in ascending order.
 */
export function parsePhase2C26B2C2B2ATargetManifest(json: unknown): { valid: boolean; issues: string[]; manifest: Phase2C26B2C2B2ATargetManifest | null } {
  const issues: string[] = []
  if (!isObject(json)) return { valid: false, issues: ['the Target manifest is not an object'], manifest: null }
  if (!same(Object.keys(json).sort(), MANIFEST_KEYS)) issues.push(`the Target manifest keys are not exactly ${MANIFEST_KEYS.join(', ')}`)
  if (json.sourceResultSha256 !== PHASE2C26B2C2B2A_TARGET_SOURCE.resultSha256) issues.push('sourceResultSha256 is not the registered B2-C2B1 RESULT')
  if (json.population !== PHASE2C26B2C2B2A_TARGET_SOURCE.population) issues.push('population is not E1')
  if (json.policy !== PHASE2C26B2C2B2A_TARGET_SOURCE.policy) issues.push('policy is not P1')
  if (json.contextBudget !== PHASE2C26B2C2B2A_CONTEXT_BUDGET) issues.push(`contextBudget is not ${PHASE2C26B2C2B2A_CONTEXT_BUDGET}`)
  if (typeof json.exportSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(json.exportSha256)) issues.push('exportSha256 is not a SHA-256')
  if (typeof json.phase !== 'string') issues.push('phase is not a string')
  const ids = Array.isArray(json.targetWeaponIds) ? json.targetWeaponIds : null
  if (!ids || !ids.every(id => typeof id === 'string' && id.length > 0)) issues.push('targetWeaponIds is not a list of IDs')
  else {
    if (ids.length !== PHASE2C26B2C2B2A_TARGETS) issues.push(`targetWeaponIds holds ${ids.length} Targets, not ${PHASE2C26B2C2B2A_TARGETS}`)
    if (new Set(ids).size !== ids.length) issues.push('targetWeaponIds repeats a Target')
    if (!same(ids, [...ids].sort(compare))) issues.push('targetWeaponIds is not in ascending order')
  }
  if (issues.length > 0) return { valid: false, issues, manifest: null }
  return { valid: true, issues: [], manifest: { phase: String(json.phase), sourceResultSha256: String(json.sourceResultSha256), population: 'E1', policy: 'P1',
    contextBudget: json.contextBudget as number, exportSha256: String(json.exportSha256), targetWeaponIds: (ids as string[]).map(String) } }
}

// ---------------------------------------------------------------- the L2 Search context (extent replaced, nothing else)

/** The L2 Search context: the default reconstruction with the extent replaced and the Search input digest recomputed. */
export interface Phase2C26B2C2B2AContext extends Phase2C26B2B2AContext {
  /** The unchanged reconstruction's Search input digest (default extent). */
  defaultSearchInputDigest: string
}

/** The B1 pre-Search body of a reconstructed context, exactly as `reconstructPhase2C26B2B2AContext()` builds it, at `extent`. */
function searchBodyOf(context: Phase2C26B2B2AContext, extent: PlannerAlternativeSearchExtent): Phase2C25APreSearchContext {
  return { orientationId: '', workIndex: 0, targetWeaponId: context.targetWeaponId, status: 'searchable', invalidatedBuildListEntryId: context.currentBuildListEntryId,
    invalidatedRouteKey: context.currentRouteKey, fixedRouteBuildListEntryIds: [...context.fixedBuildListEntryIds], reservation: context.reservation, searchReservation: context.reservation,
    excludedRouteKeys: [...context.excludedRouteKeys], extent: { ...extent }, originDigest: context.originDigest, contextDigest: '' }
}

/** The context fields that must be identical between the default reconstruction and the L2 context. */
const NON_EXTENT_FIELDS = ['targetWeaponId', 'currentBuildListEntryId', 'currentRouteKey', 'excludedRouteKeys', 'fixedSetId', 'fixedBuildListEntryIds', 'fixedTargetWeaponIds',
  'cardinality', 'groupIndex', 'reservationDigest', 'reservation', 'originDigest', 'originSemanticDigest'] as const

/**
 * Replaces the extent of one unchanged default reconstruction by `extent` (L2) and nothing else. Fails closed unless the
 * given context is at the Production default extent, its recorded digest is exactly the B1 digest of its own body (so the
 * body below mirrors the reconstruction), the reservation still hashes to its digest, `extent` is the registered L2, and
 * every non-extent field of the result is identical to the default context. The L2 Search input digest is the unchanged
 * B1 digest of the same body at L2.
 */
export function phase2c26b2c2b2aL2Context(context: Phase2C26B2B2AContext, extent: PlannerAlternativeSearchExtent = PHASE2C26B2C2B2A_EXTENT):
  { valid: true; context: Phase2C26B2C2B2AContext } | { valid: false; issues: string[] } {
  const issues: string[] = []
  if (!same(context.extent, { ...defaultPlannerAlternativeSearchExtent })) issues.push('the reconstructed context is not at the Production default extent')
  if (!same(extent, { ...PHASE2C26B2C2B2A_EXTENT })) issues.push('the Search extent is not the registered common L2 extent')
  if (phase2c26b1SearchInputDigest(searchBodyOf(context, context.extent)) !== context.searchInputDigest) issues.push('the default Search input digest is not the digest of the reconstructed body')
  if (hashStableValue(context.reservation) !== context.reservationDigest) issues.push('the reservation does not hash to its digest')
  if (issues.length > 0) return { valid: false, issues }
  const l2: Phase2C26B2C2B2AContext = { ...structuredClone(context), extent: { ...extent }, defaultSearchInputDigest: context.searchInputDigest,
    searchInputDigest: phase2c26b1SearchInputDigest(searchBodyOf(context, extent)) }
  for (const field of NON_EXTENT_FIELDS) if (!same(l2[field], context[field])) issues.push(`${field} differs from the default reconstruction`)
  if (l2.searchInputDigest === l2.defaultSearchInputDigest) issues.push('the L2 Search input digest equals the default one')
  return issues.length > 0 ? { valid: false, issues } : { valid: true, context: l2 }
}

// ---------------------------------------------------------------- P1 top-32 task construction (oracle-free)

/** What a Search child receives. No oracle field and no Target-specific extent exists here. */
export interface Phase2C26B2C2B2ATaskInput {
  taskId: string
  executionClass: 'stage1'
  targetWeaponId: string
  /** 1-based P1 rank of this context for this Target. */
  contextRank: number
  policy: 'P1'
  groupIndex: number
  reservationDigest: string
  targetEligibleMinCardinality: number
  /** Provenance only: the first eligible alias of that cardinality by ID (B2-C1). */
  representativeFixedSetId: string
  representativeFixedTargetWeaponIds: string[]
  /** The unchanged default reconstruction's Search input digest. */
  defaultSearchInputDigest: string
  /** The L2 Search input digest (the digest the Search runs). */
  searchInputDigest: string
  /** The common L2 extent (identical in every task). */
  extent: PlannerAlternativeSearchExtent
  maxCostCohorts: number
  candidateSafetyCap: number
}

export interface Phase2C26B2C2B2ATaskConstruction {
  valid: boolean
  issues: string[]
  tasks: Phase2C26B2C2B2ATaskInput[]
}

const taskIdOf = (targetIndex: number, rank: number) => `t${String(targetIndex).padStart(2, '0')}-r${String(rank).padStart(2, '0')}`
const selectorOf = (row: Pick<Phase2C26B2C1ContextRow, 'targetWeaponId' | 'representativeFixedSetId' | 'targetEligibleMinCardinality' | 'reservationDigest'>) =>
  ({ targetWeaponId: row.targetWeaponId, fixedSetId: row.representativeFixedSetId, cardinality: row.targetEligibleMinCardinality, reservationDigest: row.reservationDigest })

/**
 * The schedule's P1 contexts of rank 1..budget of every E1 Target, in manifest order then rank order, each rebuilt by the
 * unchanged `reconstructPhase2C26B2B2AContext()` and moved to L2 by `phase2c26b2c2b2aL2Context()`. Fails closed on a P1
 * drift, a schedule extent other than the Production default, a missing / repeated / checkpoint Target, fewer than
 * `budget` contexts, ranks that are not exactly 1..budget, a repeated digest, a context the snapshot cannot rebuild or move
 * to L2, a non-common extent, or a task count other than targets x budget. Reads nothing but the schedule and the IDs.
 */
export function buildPhase2C26B2C2B2ATasks(schedule: Phase2C26B2C1Schedule, targetWeaponIds: readonly string[], budget: number = PHASE2C26B2C2B2A_CONTEXT_BUDGET): Phase2C26B2C2B2ATaskConstruction {
  const issues: string[] = [...phase2c26b2c2b2aPolicyDrift(schedule)]
  if (!Number.isSafeInteger(budget) || budget < 1) issues.push(`invalid context budget ${budget}`)
  if (!same(schedule.extent, { ...defaultPlannerAlternativeSearchExtent })) issues.push('the schedule extent is not the Production default extent')
  if (new Set(targetWeaponIds).size !== targetWeaponIds.length) issues.push('an E1 Target repeats')
  const tasks: Phase2C26B2C2B2ATaskInput[] = []
  targetWeaponIds.forEach((targetWeaponId, targetIndex) => {
    const target = schedule.targets.find(t => t.targetWeaponId === targetWeaponId)
    if (!target) { issues.push(`${targetWeaponId}: not a schedule Target`); return }
    if (target.checkpointHardConstraint) { issues.push(`${targetWeaponId}: a checkpoint hard-constraint Target has no context`); return }
    const rows = schedule.contexts.filter(c => c.targetWeaponId === targetWeaponId).sort((a, b) => a.ranks.P1 - b.ranks.P1)
    if (rows.length < budget) { issues.push(`${targetWeaponId}: ${rows.length} contexts, fewer than the budget ${budget}`); return }
    const top = rows.slice(0, budget)
    if (!same(top.map(r => r.ranks.P1), Array.from({ length: budget }, (_, i) => i + 1))) { issues.push(`${targetWeaponId}: the P1 ranks 1..${budget} are missing or repeated`); return }
    if (new Set(top.map(r => r.reservationDigest)).size !== top.length) { issues.push(`${targetWeaponId}: a reservation digest repeats in the top ${budget}`); return }
    for (const row of top) {
      const at = `${targetWeaponId} @ P1 rank ${row.ranks.P1}`
      const rebuilt = reconstructPhase2C26B2B2AContext(schedule.snapshot, selectorOf(row))
      if (!rebuilt.valid) { issues.push(`${at}: ${rebuilt.issues.join('/')}`); continue }
      if (rebuilt.context.groupIndex !== row.groupIndex) { issues.push(`${at}: group drift`); continue }
      const l2 = phase2c26b2c2b2aL2Context(rebuilt.context)
      if (!l2.valid) { issues.push(`${at}: ${l2.issues.join('/')}`); continue }
      tasks.push({ taskId: taskIdOf(targetIndex, row.ranks.P1), executionClass: 'stage1', targetWeaponId, contextRank: row.ranks.P1, policy: 'P1', groupIndex: row.groupIndex,
        reservationDigest: row.reservationDigest, targetEligibleMinCardinality: row.targetEligibleMinCardinality, representativeFixedSetId: row.representativeFixedSetId,
        representativeFixedTargetWeaponIds: [...row.representativeFixedTargetWeaponIds], defaultSearchInputDigest: l2.context.defaultSearchInputDigest,
        searchInputDigest: l2.context.searchInputDigest, extent: { ...l2.context.extent }, maxCostCohorts: PHASE2C26B2C2B2A_MAX_COST_COHORTS, candidateSafetyCap: PHASE2C26B2C2B2A_CANDIDATE_SAFETY_CAP })
    }
  })
  if (issues.length === 0 && tasks.length !== targetWeaponIds.length * budget) issues.push(`${tasks.length} tasks, not ${targetWeaponIds.length} x ${budget}`)
  if (new Set(tasks.map(t => t.taskId)).size !== tasks.length) issues.push('a task ID repeats')
  if (tasks.some(t => !same(t.extent, { ...PHASE2C26B2C2B2A_EXTENT }))) issues.push('a task extent is not the common L2 extent')
  return { valid: issues.length === 0, issues, tasks: issues.length === 0 ? tasks : [] }
}

// ---------------------------------------------------------------- one Search task (child calculation)

export interface Phase2C26B2C2B2ASearchRecord {
  targetWeaponId: string
  contextRank: number
  groupIndex: number
  reservationDigest: string
  targetEligibleMinCardinality: number
  representativeFixedSetId: string
  representativeFixedTargetWeaponIds: string[]
  defaultSearchInputDigest: string
  searchInputDigest: string
  extent: PlannerAlternativeSearchExtent
  excludedRouteKeys: string[]
  preferredOwnedWeaponId: string | null
  maxCostCohorts: number
  candidateSafetyCap: number
  status: Phase2C2SearchStatus
  summary: { deliveredCandidates: number; excludedCandidates: number; exhausted: boolean; stoppedByExtent: boolean; stoppedByConsumer: boolean }
  /** Every captured delivery, in delivery order (the sentinel is never one). */
  candidates: Phase2C26B2B2A2DeliveredCandidate[]
  /** The first delivery of the fifth distinct cost, or null. */
  nextCostSentinel: Phase2C26B2B2A2DeliveredCandidate | null
  termination: Phase2C26B2C2ATermination
  /** True for a sentinel or a natural Search end; a safety-cap stop never completes the capture. */
  captureComplete: boolean
  safetyCapHit: boolean
  capturedCosts: number[]
  distinctCostCohorts: number
  nonmonotonicIndexes: number[]
  costReadIssues: number[]
  elapsedMs: number
}

/**
 * The capture of one L2 context: `visitPlannerAlternativeCandidates()` with exactly the Planner-start origin, the context
 * reservation, the excluded current Route key and the common L2 extent. The consumer stops at the sentinel or at the
 * safety cap; nothing else stops it (no oracle is known here). Identical to the B2-C2A capture except for the extent.
 */
export async function runPhase2C26B2C2B2ASearch(input: PlannerInput, context: Phase2C26B2C2B2AContext, engine: RngEngine, capture: { maxCostCohorts: number; candidateSafetyCap: number },
  provenance: { contextRank: number; targetEligibleMinCardinality: number; representativeFixedSetId: string; representativeFixedTargetWeaponIds: string[] },
  options: { yieldControl?: () => Promise<void>; now?: () => number } = {}): Promise<Phase2C26B2C2B2ASearchRecord> {
  if (capture.maxCostCohorts !== PHASE2C26B2C2B2A_MAX_COST_COHORTS) throw new Error(`The B2-C2B2A capture drains ${PHASE2C26B2C2B2A_MAX_COST_COHORTS} cost cohorts, not ${capture.maxCostCohorts}.`)
  if (capture.candidateSafetyCap !== PHASE2C26B2C2B2A_CANDIDATE_SAFETY_CAP) throw new Error(`The B2-C2B2A safety cap is ${PHASE2C26B2C2B2A_CANDIDATE_SAFETY_CAP}, not ${capture.candidateSafetyCap}.`)
  if (!same(context.extent, { ...PHASE2C26B2C2B2A_EXTENT })) throw new Error('B2-C2B2A searches the common L2 extent only.')
  const now = options.now ?? (() => performance.now())
  const started = now()
  const origin = createPlannerStartSearchOrigin(input)
  if (hashStableValue(origin) !== context.originDigest) throw new Error('The Planner-start origin does not hash to the context origin digest.')
  const target = origin.targetWeapons.find(t => t.id === context.targetWeaponId)
  if (!target) throw new Error('The Planner-start origin does not hold the Target.')
  const preferredOwnedWeaponId = target.preferredOwnedWeaponId ?? null
  const searchInput = { origin, targetWeaponId: context.targetWeaponId as never, extent: { ...context.extent }, reservation: context.reservation, excludedRouteKeys: context.excludedRouteKeys }
  const materializer = createPlannerAlternativeMaterializer({ ...searchInput, clock: { now: () => GLOBAL_RESEARCH_TIME } })
  const machine = createPhase2C26B2C2ACapture(capture.maxCostCohorts, capture.candidateSafetyCap)
  const candidates: Phase2C26B2B2A2DeliveredCandidate[] = []
  const costReadIssues: number[] = []
  let nextCostSentinel: Phase2C26B2B2A2DeliveredCandidate | null = null
  let previous: PlannerAlternativeCandidate | null = null
  let safetyCapHit = false
  const execution = await visitPlannerAlternativeCandidates(searchInput, engine, (candidate: PlannerAlternativeCandidate) => {
    const deliveryIndex = candidates.length
    const entry: BuildListEntry = materializer.materializeBuildListEntry(candidate, []).entry
    const summary = summarizePhase2C2Entry(entry, input, engine)
    if (summary.estimatedOperationCount !== candidate.estimatedOperationCount) costReadIssues.push(deliveryIndex)
    const delivered: Phase2C26B2B2A2DeliveredCandidate = {
      deliveryIndex, stableKey: candidateStableKey(candidate),
      orderingKeys: { estimatedOperationCount: candidate.estimatedOperationCount, estimatedGogmaAdvance: candidate.estimatedGogmaAdvance, estimatedSkillAdvance: candidate.estimatedSkillAdvance,
        estimatedNormalAdvance: candidate.estimatedNormalAdvance, preferredSourceRank: preferredSourceRank(candidate.route.sourceOwnedWeaponId, preferredOwnedWeaponId) },
      comparatorWithPrevious: previous === null ? null : Math.sign(compareConstrainedCandidates(previous, candidate, preferredOwnedWeaponId)),
      summary, reservationCheck: respectsPhase2C2Reservation(summary, candidate.route, context.reservation),
    }
    previous = candidate
    if (machine.offer(candidate.estimatedOperationCount, deliveryIndex) === 'sentinel') {
      nextCostSentinel = delivered
      return 'stop'
    }
    candidates.push(delivered)
    if (machine.full) safetyCapHit = true
    return safetyCapHit ? 'stop' : 'continue'
  }, { yieldControl: options.yieldControl })
  const status = phase2c2SearchStatus(execution.summary, execution.stoppedByConsumer)
  const sentinel = nextCostSentinel as Phase2C26B2B2A2DeliveredCandidate | null
  const termination: Phase2C26B2C2ATermination = sentinel !== null ? 'four_cost_cohorts_drained' : safetyCapHit ? 'candidate_safety_cap' : status === 'stopped_by_extent' ? 'stopped_by_extent' : 'exhausted'
  if (status === 'consumer_stop' && termination !== 'four_cost_cohorts_drained' && termination !== 'candidate_safety_cap') throw new Error('A consumer stop without a sentinel or the safety cap.')
  return {
    targetWeaponId: context.targetWeaponId, contextRank: provenance.contextRank, groupIndex: context.groupIndex, reservationDigest: context.reservationDigest,
    targetEligibleMinCardinality: provenance.targetEligibleMinCardinality, representativeFixedSetId: provenance.representativeFixedSetId,
    representativeFixedTargetWeaponIds: [...provenance.representativeFixedTargetWeaponIds], defaultSearchInputDigest: context.defaultSearchInputDigest,
    searchInputDigest: context.searchInputDigest, extent: { ...context.extent }, excludedRouteKeys: [...context.excludedRouteKeys], preferredOwnedWeaponId,
    maxCostCohorts: capture.maxCostCohorts, candidateSafetyCap: capture.candidateSafetyCap, status,
    summary: { deliveredCandidates: execution.summary.deliveredCandidates, excludedCandidates: execution.summary.excludedCandidates, exhausted: execution.summary.exhausted,
      stoppedByExtent: execution.summary.stoppedByExtent, stoppedByConsumer: execution.stoppedByConsumer },
    candidates, nextCostSentinel: sentinel, termination, captureComplete: termination !== 'candidate_safety_cap', safetyCapHit, capturedCosts: machine.capturedCosts,
    distinctCostCohorts: machine.capturedCosts.length, nonmonotonicIndexes: machine.nonmonotonicIndexes, costReadIssues, elapsedMs: now() - started,
  }
}

export type Phase2C26B2C2B2AChildRecord =
  | { status: 'searched'; taskId: string; search: Phase2C26B2C2B2ASearchRecord }
  /** The re-derived context is not the planned one: a semantic failure, never a Candidate count. */
  | { status: 'context_mismatch'; taskId: string; issues: string[] }

/**
 * The child calculation: the policy check, then the one schedule row of this Target at this P1 rank (from the child's own
 * re-derived schedule), compared with every task field; then the unchanged reconstruction, the L2 replacement (both
 * digests and the extent compared with the task) and the capture. Any drift is a context mismatch and no Search runs.
 */
export async function runPhase2C26B2C2B2ATask(input: PlannerInput, schedule: Phase2C26B2C1Schedule, task: Phase2C26B2C2B2ATaskInput, engine: RngEngine,
  options: { yieldControl?: () => Promise<void>; now?: () => number } = {}): Promise<Phase2C26B2C2B2AChildRecord> {
  const issues: string[] = [...phase2c26b2c2b2aPolicyDrift(schedule)]
  if (task.policy !== 'P1') issues.push('policy')
  if (!same(task.extent, { ...PHASE2C26B2C2B2A_EXTENT })) issues.push('extent')
  if (!same(schedule.extent, { ...defaultPlannerAlternativeSearchExtent })) issues.push('schedule extent')
  const rows = schedule.contexts.filter(c => c.targetWeaponId === task.targetWeaponId && c.ranks.P1 === task.contextRank)
  if (rows.length !== 1) issues.push(`P1 rank ${task.contextRank} holds ${rows.length} contexts`)
  const row = rows[0]
  if (row) {
    if (row.groupIndex !== task.groupIndex) issues.push('groupIndex')
    if (row.reservationDigest !== task.reservationDigest) issues.push('reservationDigest')
    if (row.targetEligibleMinCardinality !== task.targetEligibleMinCardinality) issues.push('targetEligibleMinCardinality')
    if (row.representativeFixedSetId !== task.representativeFixedSetId) issues.push('representativeFixedSetId')
    if (!same(row.representativeFixedTargetWeaponIds, task.representativeFixedTargetWeaponIds)) issues.push('representativeFixedTargetWeaponIds')
  }
  if (issues.length > 0 || !row) return { status: 'context_mismatch', taskId: task.taskId, issues }
  const rebuilt = reconstructPhase2C26B2B2AContext(schedule.snapshot, selectorOf(row))
  if (!rebuilt.valid) return { status: 'context_mismatch', taskId: task.taskId, issues: rebuilt.issues }
  if (rebuilt.context.searchInputDigest !== task.defaultSearchInputDigest) return { status: 'context_mismatch', taskId: task.taskId, issues: ['defaultSearchInputDigest'] }
  const l2 = phase2c26b2c2b2aL2Context(rebuilt.context, task.extent)
  if (!l2.valid) return { status: 'context_mismatch', taskId: task.taskId, issues: l2.issues }
  if (l2.context.searchInputDigest !== task.searchInputDigest) return { status: 'context_mismatch', taskId: task.taskId, issues: ['searchInputDigest'] }
  const search = await runPhase2C26B2C2B2ASearch(input, l2.context, engine, { maxCostCohorts: task.maxCostCohorts, candidateSafetyCap: task.candidateSafetyCap },
    { contextRank: task.contextRank, targetEligibleMinCardinality: task.targetEligibleMinCardinality, representativeFixedSetId: task.representativeFixedSetId,
      representativeFixedTargetWeaponIds: task.representativeFixedTargetWeaponIds }, options)
  return { status: 'searched', taskId: task.taskId, search }
}

// ---------------------------------------------------------------- task outcomes

export interface Phase2C26B2C2B2ATaskOutcome {
  taskId: string
  process: Phase2C2ChildOutcome
  record: 'searched' | 'context_mismatch' | null
  searchStatus: Phase2C2SearchStatus | null
  termination: Phase2C26B2C2ATermination | null
  candidateCount: number | null
}

/** A timeout / out-of-memory / failure is that failure, never "no Candidate"; a completed child without a record is a failure. */
export function phase2c26b2c2b2aTaskOutcome(taskId: string, process: Phase2C2ChildOutcome, record: Phase2C26B2C2B2AChildRecord | null): Phase2C26B2C2B2ATaskOutcome {
  const none = { searchStatus: null, termination: null, candidateCount: null }
  if (process !== 'completed' || record === null) return { taskId, process: process === 'completed' ? 'process_failure' : process, record: null, ...none }
  if (record.status === 'context_mismatch') return { taskId, process, record: 'context_mismatch', ...none }
  return { taskId, process, record: 'searched', searchStatus: record.search.status, termination: record.search.termination, candidateCount: record.search.candidates.length }
}
