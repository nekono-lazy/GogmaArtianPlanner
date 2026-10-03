/**
 * Issue #154 Phase 2-C2.6-B2-C2B2B: the E1 Targets whose first covering ladder rung B2-C2B1 characterized as L1, searched in
 * their P1 top-32 reservation contexts with ONE common Research extent, L1. Research only. Never import from Production.
 *
 * B2-C2B2A searched all 11 E1 Targets at the common L2 extent and was stopped as B2C2B2A_INCOMPLETE: even t00, a Target L1
 * already covers, ran into timeouts / OOM at L2. B2-C2B2B asks, for the 7 E1 Targets B2-C2B1 recorded as L1-covered, whether
 * the same mechanism with the smaller common extent L1 delivers their oracle Routes, and what L1 changes in runtime / memory.
 * Everything except the extent is B2-C2B2A's:
 *
 * ```text
 * Export
 *   -> derivePhase2C26B2C1Schedule()              (unchanged B2-C1 calculation and P1 ranks; its extent stays the Production
 *                                                  default: reservation universe, ordering, digests, fixed sets unchanged)
 *   -> per E1 ∩ L1 Target: P1 rank 1..32          (mechanically, every rank, no early stop)
 *   -> reconstructPhase2C26B2B2AContext()         (unchanged: origin, reservation, excluded current Route, default extent)
 *   -> phase2c26b2c2b2bL1Context()                (the extent alone replaced by L1; every other field checked unchanged,
 *                                                  the Search input digest recomputed by the unchanged B1 digest)
 *   -> visitPlannerAlternativeCandidates()        (unchanged Production Search at L1)
 *   -> capture: the unchanged B2-C2A C4C rule (4 distinct operation-cost cohorts drained, 5th cost = sentinel, safety cap 1024)
 * ```
 *
 * The Search side receives the Target IDs (a population chosen post hoc, declared), the P1 rank, the expected digests (to
 * fail closed on a drift), the common L1 extent, the capture rule and the safety cap. It never receives an oracle Route, a
 * stable key, an expected rank / index / cost, a first-compatible context, a ladder rung of its own or any Target-specific
 * required extent, and an oracle match never stops it: every Target is searched at every rank 1..32.
 *
 * New in this phase: the runner start attestation (see `phase2c26b2c2b2bStartAttestationBody()`), written by the parent runner
 * itself into the run dir, immutably, before the first child starts, so an interrupted run keeps its launch provenance.
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
import { phase2c2SearchStatus, respectsPhase2C2Reservation, summarizePhase2C2Entry, type Phase2C2ChildOutcome } from './plannerGlobalPhase2C2'
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
import {
  PHASE2C26B2C2B2A_CONTEXT_BUDGET,
  PHASE2C26B2C2B2A_MEMORY_SAMPLE_INTERVAL_MS,
  PHASE2C26B2C2B2A_NODE_YIELD,
  PHASE2C26B2C2B2A_STAGE1,
  PHASE2C26B2C2B2A_TASKS_BUDGET_MS,
  type Phase2C26B2C2B2AChildRecord,
  type Phase2C26B2C2B2AContext,
  type Phase2C26B2C2B2ASearchRecord,
  type Phase2C26B2C2B2ATaskInput,
  type Phase2C26B2C2B2ATaskOutcome,
} from './plannerGlobalPhase2C26B2C2B2A'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0

// ---------------------------------------------------------------- Research execution conditions (registered, not Production defaults)

/** The P1 context budget per Target: ranks 1..32, every one searched (B2-C2A / B2-C2B2A unchanged). */
export const PHASE2C26B2C2B2B_CONTEXT_BUDGET = PHASE2C26B2C2B2A_CONTEXT_BUDGET
/** The population size: B2-C2B1 cohort E1 restricted to its L1-covered Routes (counted here only; the IDs come from the manifest). */
export const PHASE2C26B2C2B2B_TARGETS = 7
export const PHASE2C26B2C2B2B_EXPECTED_TASKS = PHASE2C26B2C2B2B_TARGETS * PHASE2C26B2C2B2B_CONTEXT_BUDGET
/**
 * The one common Search extent: B2-C2B1 ladder rung L1 (`intermediate`), the same for every Target and every context. It is a
 * Research extent registered from the E1 cohort post hoc, never a Production default and never one Target's oracle value.
 */
export const PHASE2C26B2C2B2B_EXTENT: Readonly<PlannerAlternativeSearchExtent> = Object.freeze({ maxNormalAdvance: 8, maxGogmaAdvance: 235, maxSkillAdvance: 256 })
export const PHASE2C26B2C2B2B_EXTENT_LABEL = 'L1' as const
/** The unchanged B2-C2A capture rule (C4C) and its post-hoc prefixes. */
export const PHASE2C26B2C2B2B_MAX_COST_COHORTS = PHASE2C26B2C2A_MAX_COST_COHORTS
export const PHASE2C26B2C2B2B_CANDIDATE_SAFETY_CAP = PHASE2C26B2C2A_CANDIDATE_SAFETY_CAP
export const PHASE2C26B2C2B2B_CAPTURE_PREFIXES = PHASE2C26B2C2A_CAPTURE_PREFIXES
export const PHASE2C26B2C2B2B_NODE_YIELD = PHASE2C26B2C2B2A_NODE_YIELD
export const PHASE2C26B2C2B2B_MEMORY_SAMPLE_INTERVAL_MS = PHASE2C26B2C2B2A_MEMORY_SAMPLE_INTERVAL_MS
/** The tasks child (schedule re-derivation + task construction, no Search). */
export const PHASE2C26B2C2B2B_TASKS_BUDGET_MS = PHASE2C26B2C2B2A_TASKS_BUDGET_MS
/** Stage 1, B2-C2B2A's unchanged: every task once, fresh child, heap 8 GB, concurrency 1, 10 minutes, no retry, no fallback. */
export const PHASE2C26B2C2B2B_STAGE1 = PHASE2C26B2C2B2A_STAGE1
/** What B2-C2B2B deliberately does not run. */
export const PHASE2C26B2C2B2B_NOT_RUN = ['production_change', 'production_default_extent_change', 'l0_search', 'l2_search', 'e1_l2_needed_search', 'ladder_escalation',
  'per_target_extent', 'search_algorithm_change', 'search_ordering_change', 'search_comparator_change', 'p1_change', 'k2_feature_grouping', 'e2_search',
  'residual_unreached_support', 'oracle_guided_context_selection', 'context_level_early_stop', 'target_level_early_stop', 'compatibility_based_context_skip',
  'timeout_fallback', 'retry', 'candidate_trial', 'planner_alternative_kernel', 'full_planner_rerun', 'global_assignment', 'production_scheduler_adoption',
  'runtime_optimization', 'ui_change', 'b2c2b2a_result_regeneration'] as const

/** The B2-C2B1 RESULT the Target manifest must come from (the manifest records it; the Search never reads it). */
export const PHASE2C26B2C2B2B_TARGET_SOURCE = { resultSha256: '418166d2a7ff40145d8650f418c025783f9b5039673ee19e722bab4836b22eae', population: 'E1_L1', policy: 'P1' } as const

/** The policy definition check, unchanged from B2-C2A (the schedule's P1, the module's P1 and the registered copy are one definition). */
export const phase2c26b2c2b2bPolicyDrift = phase2c26b2c2aPolicyDrift
export const PHASE2C26B2C2B2B_REGISTERED_P1 = PHASE2C26B2C2A_REGISTERED_P1

// ---------------------------------------------------------------- the Target manifest (a Search input)

/** The E1 ∩ L1 population as Target IDs only: no rank, digest, first-compatible context, required extent or oracle field. */
export interface Phase2C26B2C2B2BTargetManifest {
  phase: string
  sourceResultSha256: string
  population: 'E1_L1'
  policy: 'P1'
  contextBudget: number
  /** The Export B2-C2B1 was measured on (from that RESULT's provenance). */
  exportSha256: string
  targetWeaponIds: string[]
}

const MANIFEST_KEYS = ['contextBudget', 'exportSha256', 'phase', 'policy', 'population', 'sourceResultSha256', 'targetWeaponIds']

/**
 * Reads a Target manifest as untrusted JSON: exactly the manifest keys (nothing else may ride along), the registered source
 * RESULT, population and policy, budget 32, and 7 distinct Target IDs in ascending order.
 */
export function parsePhase2C26B2C2B2BTargetManifest(json: unknown): { valid: boolean; issues: string[]; manifest: Phase2C26B2C2B2BTargetManifest | null } {
  const issues: string[] = []
  if (!isObject(json)) return { valid: false, issues: ['the Target manifest is not an object'], manifest: null }
  if (!same(Object.keys(json).sort(), MANIFEST_KEYS)) issues.push(`the Target manifest keys are not exactly ${MANIFEST_KEYS.join(', ')}`)
  if (json.sourceResultSha256 !== PHASE2C26B2C2B2B_TARGET_SOURCE.resultSha256) issues.push('sourceResultSha256 is not the registered B2-C2B1 RESULT')
  if (json.population !== PHASE2C26B2C2B2B_TARGET_SOURCE.population) issues.push(`population is not ${PHASE2C26B2C2B2B_TARGET_SOURCE.population}`)
  if (json.policy !== PHASE2C26B2C2B2B_TARGET_SOURCE.policy) issues.push('policy is not P1')
  if (json.contextBudget !== PHASE2C26B2C2B2B_CONTEXT_BUDGET) issues.push(`contextBudget is not ${PHASE2C26B2C2B2B_CONTEXT_BUDGET}`)
  if (typeof json.exportSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(json.exportSha256)) issues.push('exportSha256 is not a SHA-256')
  if (typeof json.phase !== 'string') issues.push('phase is not a string')
  const ids = Array.isArray(json.targetWeaponIds) ? json.targetWeaponIds : null
  if (!ids || !ids.every(id => typeof id === 'string' && id.length > 0)) issues.push('targetWeaponIds is not a list of IDs')
  else {
    if (ids.length !== PHASE2C26B2C2B2B_TARGETS) issues.push(`targetWeaponIds holds ${ids.length} Targets, not ${PHASE2C26B2C2B2B_TARGETS}`)
    if (new Set(ids).size !== ids.length) issues.push('targetWeaponIds repeats a Target')
    if (!same(ids, [...ids].sort(compare))) issues.push('targetWeaponIds is not in ascending order')
  }
  if (issues.length > 0) return { valid: false, issues, manifest: null }
  return { valid: true, issues: [], manifest: { phase: String(json.phase), sourceResultSha256: String(json.sourceResultSha256), population: 'E1_L1', policy: 'P1',
    contextBudget: json.contextBudget as number, exportSha256: String(json.exportSha256), targetWeaponIds: (ids as string[]).map(String) } }
}

// ---------------------------------------------------------------- the L1 Search context (extent replaced, nothing else)

/** The L1 Search context: the default reconstruction with the extent replaced and the Search input digest recomputed (B2-C2B2A's shape). */
export type Phase2C26B2C2B2BContext = Phase2C26B2C2B2AContext

/** The B1 pre-Search body of a reconstructed context, exactly as `reconstructPhase2C26B2B2AContext()` builds it, at `extent`. */
function searchBodyOf(context: Phase2C26B2B2AContext, extent: PlannerAlternativeSearchExtent): Phase2C25APreSearchContext {
  return { orientationId: '', workIndex: 0, targetWeaponId: context.targetWeaponId, status: 'searchable', invalidatedBuildListEntryId: context.currentBuildListEntryId,
    invalidatedRouteKey: context.currentRouteKey, fixedRouteBuildListEntryIds: [...context.fixedBuildListEntryIds], reservation: context.reservation, searchReservation: context.reservation,
    excludedRouteKeys: [...context.excludedRouteKeys], extent: { ...extent }, originDigest: context.originDigest, contextDigest: '' }
}

/** The context fields that must be identical between the default reconstruction and the L1 context. */
const NON_EXTENT_FIELDS = ['targetWeaponId', 'currentBuildListEntryId', 'currentRouteKey', 'excludedRouteKeys', 'fixedSetId', 'fixedBuildListEntryIds', 'fixedTargetWeaponIds',
  'cardinality', 'groupIndex', 'reservationDigest', 'reservation', 'originDigest', 'originSemanticDigest'] as const

/**
 * Replaces the extent of one unchanged default reconstruction by `extent` (L1) and nothing else. Fails closed unless the
 * given context is at the Production default extent, its recorded digest is exactly the B1 digest of its own body, the
 * reservation still hashes to its digest, `extent` is the registered L1, and every non-extent field of the result is
 * identical to the default context. The L1 Search input digest is the unchanged B1 digest of the same body at L1.
 */
export function phase2c26b2c2b2bL1Context(context: Phase2C26B2B2AContext, extent: PlannerAlternativeSearchExtent = PHASE2C26B2C2B2B_EXTENT):
  { valid: true; context: Phase2C26B2C2B2BContext } | { valid: false; issues: string[] } {
  const issues: string[] = []
  if (!same(context.extent, { ...defaultPlannerAlternativeSearchExtent })) issues.push('the reconstructed context is not at the Production default extent')
  if (!same(extent, { ...PHASE2C26B2C2B2B_EXTENT })) issues.push('the Search extent is not the registered common L1 extent')
  if (phase2c26b1SearchInputDigest(searchBodyOf(context, context.extent)) !== context.searchInputDigest) issues.push('the default Search input digest is not the digest of the reconstructed body')
  if (hashStableValue(context.reservation) !== context.reservationDigest) issues.push('the reservation does not hash to its digest')
  if (issues.length > 0) return { valid: false, issues }
  const l1: Phase2C26B2C2B2BContext = { ...structuredClone(context), extent: { ...extent }, defaultSearchInputDigest: context.searchInputDigest,
    searchInputDigest: phase2c26b1SearchInputDigest(searchBodyOf(context, extent)) }
  for (const field of NON_EXTENT_FIELDS) if (!same(l1[field], context[field])) issues.push(`${field} differs from the default reconstruction`)
  if (l1.searchInputDigest === l1.defaultSearchInputDigest) issues.push('the L1 Search input digest equals the default one')
  return issues.length > 0 ? { valid: false, issues } : { valid: true, context: l1 }
}

// ---------------------------------------------------------------- P1 top-32 task construction (oracle-free)

/** What a Search child receives: B2-C2B2A's task shape. No oracle field and no Target-specific extent exists here. */
export type Phase2C26B2C2B2BTaskInput = Phase2C26B2C2B2ATaskInput

export interface Phase2C26B2C2B2BTaskConstruction {
  valid: boolean
  issues: string[]
  tasks: Phase2C26B2C2B2BTaskInput[]
}

const taskIdOf = (targetIndex: number, rank: number) => `t${String(targetIndex).padStart(2, '0')}-r${String(rank).padStart(2, '0')}`
const selectorOf = (row: Pick<Phase2C26B2C1ContextRow, 'targetWeaponId' | 'representativeFixedSetId' | 'targetEligibleMinCardinality' | 'reservationDigest'>) =>
  ({ targetWeaponId: row.targetWeaponId, fixedSetId: row.representativeFixedSetId, cardinality: row.targetEligibleMinCardinality, reservationDigest: row.reservationDigest })

/**
 * The schedule's P1 contexts of rank 1..budget of every Target, in manifest order then rank order, each rebuilt by the unchanged
 * `reconstructPhase2C26B2B2AContext()` and moved to L1 by `phase2c26b2c2b2bL1Context()`. Fails closed on a P1 drift, a schedule
 * extent other than the Production default, a missing / repeated / checkpoint Target, fewer than `budget` contexts, ranks that
 * are not exactly 1..budget, a repeated digest, a context the snapshot cannot rebuild or move to L1, a non-common extent, or a
 * task count other than targets x budget. Reads nothing but the schedule and the IDs.
 */
export function buildPhase2C26B2C2B2BTasks(schedule: Phase2C26B2C1Schedule, targetWeaponIds: readonly string[], budget: number = PHASE2C26B2C2B2B_CONTEXT_BUDGET): Phase2C26B2C2B2BTaskConstruction {
  const issues: string[] = [...phase2c26b2c2b2bPolicyDrift(schedule)]
  if (!Number.isSafeInteger(budget) || budget < 1) issues.push(`invalid context budget ${budget}`)
  if (!same(schedule.extent, { ...defaultPlannerAlternativeSearchExtent })) issues.push('the schedule extent is not the Production default extent')
  if (new Set(targetWeaponIds).size !== targetWeaponIds.length) issues.push('a Target repeats')
  const tasks: Phase2C26B2C2B2BTaskInput[] = []
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
      const l1 = phase2c26b2c2b2bL1Context(rebuilt.context)
      if (!l1.valid) { issues.push(`${at}: ${l1.issues.join('/')}`); continue }
      tasks.push({ taskId: taskIdOf(targetIndex, row.ranks.P1), executionClass: 'stage1', targetWeaponId, contextRank: row.ranks.P1, policy: 'P1', groupIndex: row.groupIndex,
        reservationDigest: row.reservationDigest, targetEligibleMinCardinality: row.targetEligibleMinCardinality, representativeFixedSetId: row.representativeFixedSetId,
        representativeFixedTargetWeaponIds: [...row.representativeFixedTargetWeaponIds], defaultSearchInputDigest: l1.context.defaultSearchInputDigest,
        searchInputDigest: l1.context.searchInputDigest, extent: { ...l1.context.extent }, maxCostCohorts: PHASE2C26B2C2B2B_MAX_COST_COHORTS, candidateSafetyCap: PHASE2C26B2C2B2B_CANDIDATE_SAFETY_CAP })
    }
  })
  if (issues.length === 0 && tasks.length !== targetWeaponIds.length * budget) issues.push(`${tasks.length} tasks, not ${targetWeaponIds.length} x ${budget}`)
  if (new Set(tasks.map(t => t.taskId)).size !== tasks.length) issues.push('a task ID repeats')
  if (tasks.some(t => !same(t.extent, { ...PHASE2C26B2C2B2B_EXTENT }))) issues.push('a task extent is not the common L1 extent')
  return { valid: issues.length === 0, issues, tasks: issues.length === 0 ? tasks : [] }
}

// ---------------------------------------------------------------- one Search task (child calculation)

/** B2-C2B2A's search record shape (the extent field carries L1 here). */
export type Phase2C26B2C2B2BSearchRecord = Phase2C26B2C2B2ASearchRecord

/**
 * The capture of one L1 context: `visitPlannerAlternativeCandidates()` with exactly the Planner-start origin, the context
 * reservation, the excluded current Route key and the common L1 extent. The consumer stops at the sentinel or at the safety
 * cap; nothing else stops it (no oracle is known here). Identical to the B2-C2B2A capture except for the extent it accepts.
 */
export async function runPhase2C26B2C2B2BSearch(input: PlannerInput, context: Phase2C26B2C2B2BContext, engine: RngEngine, capture: { maxCostCohorts: number; candidateSafetyCap: number },
  provenance: { contextRank: number; targetEligibleMinCardinality: number; representativeFixedSetId: string; representativeFixedTargetWeaponIds: string[] },
  options: { yieldControl?: () => Promise<void>; now?: () => number } = {}): Promise<Phase2C26B2C2B2BSearchRecord> {
  if (capture.maxCostCohorts !== PHASE2C26B2C2B2B_MAX_COST_COHORTS) throw new Error(`The B2-C2B2B capture drains ${PHASE2C26B2C2B2B_MAX_COST_COHORTS} cost cohorts, not ${capture.maxCostCohorts}.`)
  if (capture.candidateSafetyCap !== PHASE2C26B2C2B2B_CANDIDATE_SAFETY_CAP) throw new Error(`The B2-C2B2B safety cap is ${PHASE2C26B2C2B2B_CANDIDATE_SAFETY_CAP}, not ${capture.candidateSafetyCap}.`)
  if (!same(context.extent, { ...PHASE2C26B2C2B2B_EXTENT })) throw new Error('B2-C2B2B searches the common L1 extent only.')
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

export type Phase2C26B2C2B2BChildRecord = Phase2C26B2C2B2AChildRecord

/**
 * The child calculation: the policy check, then the one schedule row of this Target at this P1 rank (from the child's own
 * re-derived schedule), compared with every task field; then the unchanged reconstruction, the L1 replacement (both digests
 * and the extent compared with the task) and the capture. Any drift is a context mismatch and no Search runs.
 */
export async function runPhase2C26B2C2B2BTask(input: PlannerInput, schedule: Phase2C26B2C1Schedule, task: Phase2C26B2C2B2BTaskInput, engine: RngEngine,
  options: { yieldControl?: () => Promise<void>; now?: () => number } = {}): Promise<Phase2C26B2C2B2BChildRecord> {
  const issues: string[] = [...phase2c26b2c2b2bPolicyDrift(schedule)]
  if (task.policy !== 'P1') issues.push('policy')
  if (!same(task.extent, { ...PHASE2C26B2C2B2B_EXTENT })) issues.push('extent')
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
  const l1 = phase2c26b2c2b2bL1Context(rebuilt.context, task.extent)
  if (!l1.valid) return { status: 'context_mismatch', taskId: task.taskId, issues: l1.issues }
  if (l1.context.searchInputDigest !== task.searchInputDigest) return { status: 'context_mismatch', taskId: task.taskId, issues: ['searchInputDigest'] }
  const search = await runPhase2C26B2C2B2BSearch(input, l1.context, engine, { maxCostCohorts: task.maxCostCohorts, candidateSafetyCap: task.candidateSafetyCap },
    { contextRank: task.contextRank, targetEligibleMinCardinality: task.targetEligibleMinCardinality, representativeFixedSetId: task.representativeFixedSetId,
      representativeFixedTargetWeaponIds: task.representativeFixedTargetWeaponIds }, options)
  return { status: 'searched', taskId: task.taskId, search }
}

// ---------------------------------------------------------------- task outcomes

export type Phase2C26B2C2B2BTaskOutcome = Phase2C26B2C2B2ATaskOutcome

/** A timeout / out-of-memory / failure is that failure, never "no Candidate"; a completed child without a record is a failure. */
export function phase2c26b2c2b2bTaskOutcome(taskId: string, process: Phase2C2ChildOutcome, record: Phase2C26B2C2B2BChildRecord | null): Phase2C26B2C2B2BTaskOutcome {
  const none = { searchStatus: null, termination: null, candidateCount: null }
  if (process !== 'completed' || record === null) return { taskId, process: process === 'completed' ? 'process_failure' : process, record: null, ...none }
  if (record.status === 'context_mismatch') return { taskId, process, record: 'context_mismatch', ...none }
  return { taskId, process, record: 'searched', searchStatus: record.search.status, termination: record.search.termination, candidateCount: record.search.candidates.length }
}

// ---------------------------------------------------------------- runner start attestation (written by the runner before any child)

/** The file the parent runner writes into the run dir, once (`wx`), read-only, before the first child process starts. */
export const PHASE2C26B2C2B2B_START_ATTESTATION_FILE = 'start-attestation.json'
export const PHASE2C26B2C2B2B_START_ATTESTATION_PHASE = 'Issue #154 Phase 2-C2.6-B2-C2B2B runner start attestation'

/** The registered execution conditions of a formal launch (the runner fills nothing of these by hand). */
export function phase2c26b2c2b2bRegisteredConditions() {
  return { stage1: { ...PHASE2C26B2C2B2B_STAGE1 } as { executionClass: 'stage1'; childHeapMb: number; concurrency: number; budgetMs: number; retry: 'none'; fallback: 'none' },
    tasksBudgetMs: PHASE2C26B2C2B2B_TASKS_BUDGET_MS, contextBudget: PHASE2C26B2C2B2B_CONTEXT_BUDGET, targets: PHASE2C26B2C2B2B_TARGETS,
    expectedTasks: PHASE2C26B2C2B2B_EXPECTED_TASKS, extentLabel: PHASE2C26B2C2B2B_EXTENT_LABEL, extent: { ...PHASE2C26B2C2B2B_EXTENT },
    captureRule: { policy: 'C4C', maxCostCohorts: PHASE2C26B2C2B2B_MAX_COST_COHORTS, sentinel: 'first delivery of the fifth distinct operation cost (never captured)', prefixes: { ...PHASE2C26B2C2B2B_CAPTURE_PREFIXES } },
    candidateSafetyCap: PHASE2C26B2C2B2B_CANDIDATE_SAFETY_CAP, registeredP1: PHASE2C26B2C2B2B_REGISTERED_P1, nodeYield: PHASE2C26B2C2B2B_NODE_YIELD,
    memorySampleIntervalMs: PHASE2C26B2C2B2B_MEMORY_SAMPLE_INTERVAL_MS }
}

/** What only the runner observes at launch (Stage 1 is the one it actually runs: a smoke budget shows here). */
export interface Phase2C26B2C2B2BLaunchObservation {
  createdAt: string
  runnerScript: string
  node: string
  repositoryHead: string
  uncommittedBenchmarkCode: boolean
  benchmarkCodeSha256: string
  exportFileName: string
  exportSha256: string
  exportBytes: number
  targetManifestFileName: string
  targetManifestSha256: string
  targetManifestSourceResultSha256: string
  targetWeaponIds: string[]
  stage1: ReturnType<typeof phase2c26b2c2b2bRegisteredConditions>['stage1']
  smoke: { tasks: number | null; taskIds: string[] | null; budgetMs: number | null } | null
}

export type Phase2C26B2C2B2BStartAttestation = ReturnType<typeof phase2c26b2c2b2bRegisteredConditions> & Phase2C26B2C2B2BLaunchObservation & { phase: string; attestedBy: 'runner' }

/** The attestation body the runner writes: the registered conditions, then its launch observation (its actual Stage 1 included). */
export function phase2c26b2c2b2bStartAttestationBody(observation: Phase2C26B2C2B2BLaunchObservation): Phase2C26B2C2B2BStartAttestation {
  return { phase: PHASE2C26B2C2B2B_START_ATTESTATION_PHASE, attestedBy: 'runner', ...phase2c26b2c2b2bRegisteredConditions(), ...observation }
}

const ATTESTATION_KEYS = Object.keys(phase2c26b2c2b2bStartAttestationBody({ createdAt: '', runnerScript: '', node: '', repositoryHead: '', uncommittedBenchmarkCode: false, benchmarkCodeSha256: '',
  exportFileName: '', exportSha256: '', exportBytes: 0, targetManifestFileName: '', targetManifestSha256: '', targetManifestSourceResultSha256: '', targetWeaponIds: [],
  stage1: phase2c26b2c2b2bRegisteredConditions().stage1, smoke: null })).sort()
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

/** The independently obtained values a start attestation must equal. */
export interface Phase2C26B2C2B2BAttestationExpectation {
  /** The measurement HEAD named for this run (it must also recompute to the attested benchmark code SHA-256). */
  repositoryHead: string
  /** The benchmark code SHA-256 recomputed from that HEAD's git objects by the runner rule. */
  benchmarkCodeSha256: string
  /** The SHA-256 of the Export file the verifier reads. */
  exportSha256: string
  /** The SHA-256 of the Target manifest file the verifier reads. */
  targetManifestSha256: string
  /** The manifest Target IDs. */
  targetWeaponIds: readonly string[]
  /** When the first child process (the tasks child) started, if known: the attestation must not be later. */
  firstChildStartedAt: string | null
}

export interface Phase2C26B2C2B2BAttestationVerification {
  verified: boolean
  /** Every reason the attestation does not prove a formal launch. */
  issues: string[]
  /**
   * The subset that breaks the attestation's integrity (not the runner's, not this run's, not these inputs): a malformed or
   * foreign attestation, a later createdAt, a HEAD / code / Export / manifest / Target mismatch. The rest (an uncommitted or
   * smoke launch, a condition other than the registered one) is a truthfully attested non-formal launch.
   */
  integrityIssues: string[]
}

/**
 * Whether a start attestation proves the launch of a formal run, failing closed on anything else: exactly the attestation
 * keys; `attestedBy: 'runner'` and the phase marker; a canonical UTC `createdAt` no later than the first child start; the
 * attested HEAD / benchmark code SHA-256 / Export SHA-256 / Target manifest SHA-256 / Target IDs equal to the independently
 * obtained ones; a clean launch (`uncommittedBenchmarkCode === false`, no smoke option); and every registered condition
 * (Stage 1, budget, Targets, tasks, L1, capture rule, safety cap, P1, yield, sampling) unchanged.
 */
export function verifyPhase2C26B2C2B2BStartAttestation(attestation: unknown, expected: Phase2C26B2C2B2BAttestationExpectation): Phase2C26B2C2B2BAttestationVerification {
  if (!isObject(attestation)) return { verified: false, issues: ['the start attestation is not an object'], integrityIssues: ['the start attestation is not an object'] }
  const integrityIssues: string[] = []
  const launchIssues: string[] = []
  if (!same(Object.keys(attestation).sort(), ATTESTATION_KEYS)) integrityIssues.push('the start attestation keys are not exactly the attestation keys')
  if (attestation.attestedBy !== 'runner') integrityIssues.push('not attested by the runner')
  if (attestation.phase !== PHASE2C26B2C2B2B_START_ATTESTATION_PHASE) integrityIssues.push('not a B2-C2B2B start attestation')
  if (typeof attestation.createdAt !== 'string' || !ISO_UTC.test(attestation.createdAt) || new Date(attestation.createdAt).toISOString() !== attestation.createdAt) integrityIssues.push('createdAt is not a canonical UTC time')
  else if (expected.firstChildStartedAt !== null && !(attestation.createdAt <= expected.firstChildStartedAt)) integrityIssues.push('createdAt is later than the first child start')
  if (typeof attestation.repositoryHead !== 'string' || !/^[0-9a-f]{40}$/.test(attestation.repositoryHead)) integrityIssues.push('repositoryHead is not a commit SHA')
  if (attestation.repositoryHead !== expected.repositoryHead) integrityIssues.push('repositoryHead differs')
  if (attestation.benchmarkCodeSha256 !== expected.benchmarkCodeSha256) integrityIssues.push('benchmarkCodeSha256 differs')
  if (attestation.exportSha256 !== expected.exportSha256) integrityIssues.push('exportSha256 differs')
  if (attestation.targetManifestSha256 !== expected.targetManifestSha256) integrityIssues.push('targetManifestSha256 differs')
  if (attestation.targetManifestSourceResultSha256 !== PHASE2C26B2C2B2B_TARGET_SOURCE.resultSha256) integrityIssues.push('targetManifestSourceResultSha256 is not the registered B2-C2B1 RESULT')
  if (!same(attestation.targetWeaponIds, expected.targetWeaponIds)) integrityIssues.push('targetWeaponIds differ')
  if (attestation.uncommittedBenchmarkCode !== false) launchIssues.push('uncommitted benchmark code at launch')
  if (attestation.smoke !== null) launchIssues.push('a smoke option at launch')
  for (const [field, value] of Object.entries(phase2c26b2c2b2bRegisteredConditions())) if (!same(attestation[field], value)) launchIssues.push(`${field} differs from the registered condition`)
  const issues = [...integrityIssues, ...launchIssues]
  return { verified: issues.length === 0, issues, integrityIssues }
}
