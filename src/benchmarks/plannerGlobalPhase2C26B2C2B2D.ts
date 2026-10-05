/**
 * Issue #154 Phase 2-C2.6-B2-C2B2D: the 4 E1 ∩ L2 Targets, each searched in ONE context - its B2-C1 P1 first reservation-
 * compatible context - at a Target-relative tight extent. Research only, and an explicitly ORACLE-GUIDED DIAGNOSTIC: never
 * evidence for a Production scheduler or a Production extent selection. Never import from Production.
 *
 * B2-C2B2C searched these 4 Targets at the common L2 extent in their P1 ranks 1..32 (128 tasks) and recovered 2 / 4 (C4C):
 * the other two could not finish a compatible context (one OOM, twelve timeouts), so whether the existing Search delivers their
 * oracle Routes stayed unknown. B2-C2B2D asks only whether, with the compatible context known and the Search space cut down to
 * the Route's own requirement, the same Search delivers them. Compared with B2-C2B2C exactly two measurement factors change:
 *
 * ```text
 * context selection   P1 ranks 1..32           -> the one P1 rank B2-C1 recorded as first compatible   (oracle-guided)
 * Search extent       common L2 {128,235,1500} -> per Target max(Production default, B2-C2B1 required) (oracle-informed)
 * ```
 *
 * Everything else is B2-C2B2C's (B2-C2B2A's Search, B2-C2A's C4C capture, safety cap 1024, fresh child, heap 8192 MB,
 * concurrency 1, 10 minutes, setImmediate yield, 250 ms memory sampling, no retry, no fallback, the runner start attestation):
 *
 * ```text
 * Export
 *   -> derivePhase2C26B2C1Schedule()              (unchanged B2-C1 calculation and P1 ranks at the Production default extent)
 *   -> per probe: the schedule row of that Target at the probe's P1 rank
 *   -> reconstructPhase2C26B2B2AContext()         (unchanged: origin, reservation, excluded current Route, default extent)
 *   -> phase2c26b2c2b2dTightContext()             (the extent alone replaced by the probe's tight extent; every other field
 *                                                  checked unchanged, the Search input digest recomputed by the unchanged B1 digest)
 *   -> visitPlannerAlternativeCandidates()        (unchanged Production Search at the tight extent)
 *   -> capture: the unchanged B2-C2A C4C rule (4 distinct operation-cost cohorts drained, 5th cost = sentinel, safety cap 1024)
 * ```
 *
 * The Search side receives a probe manifest (Target ID, P1 rank, tight extent: an oracle-guided input, declared), the expected
 * digests (to fail closed on a drift), the capture rule and the safety cap. It never receives an oracle Route, a stable key, an
 * expected Candidate index / operation cost / Search result, or which outcome would count as success, and an oracle match
 * never stops it. The tight extent is derived (by the Targets module, never here) from B2-C2B1's recorded required extent;
 * the Search side only checks that it lies between the Production default and the common L2 extent.
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
import { createPhase2C26B2C2ACapture, type Phase2C26B2C2ATermination } from './plannerGlobalPhase2C26B2C2A'
import type {
  Phase2C26B2C2B2AChildRecord,
  Phase2C26B2C2B2AContext,
  Phase2C26B2C2B2ASearchRecord,
  Phase2C26B2C2B2ATaskInput,
  Phase2C26B2C2B2ATaskOutcome,
} from './plannerGlobalPhase2C26B2C2B2A'
import {
  phase2c26b2c2b2cPolicyDrift,
  PHASE2C26B2C2B2C_CANDIDATE_SAFETY_CAP,
  PHASE2C26B2C2B2C_CAPTURE_PREFIXES,
  PHASE2C26B2C2B2C_CONTEXT_BUDGET,
  PHASE2C26B2C2B2C_EXTENT,
  PHASE2C26B2C2B2C_MAX_COST_COHORTS,
  PHASE2C26B2C2B2C_MEMORY_SAMPLE_INTERVAL_MS,
  PHASE2C26B2C2B2C_NODE_YIELD,
  PHASE2C26B2C2B2C_REGISTERED_P1,
  PHASE2C26B2C2B2C_STAGE1,
  PHASE2C26B2C2B2C_TASKS_BUDGET_MS,
} from './plannerGlobalPhase2C26B2C2B2C'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0

// ---------------------------------------------------------------- Research execution conditions (registered, not Production defaults)

/** The population size: B2-C2B1 cohort E1 ∩ first ladder rung L2, exactly B2-C2B2C's 4 Targets (counted here; the IDs come from the probe manifest). */
export const PHASE2C26B2C2B2D_TARGETS = 4
/** One context per Target: its B2-C1 P1 first compatible rank. */
export const PHASE2C26B2C2B2D_CONTEXTS_PER_TARGET = 1
export const PHASE2C26B2C2B2D_EXPECTED_TASKS = PHASE2C26B2C2B2D_TARGETS * PHASE2C26B2C2B2D_CONTEXTS_PER_TARGET
/** A probe's P1 rank lies inside B2-C2B2C's searched budget (1..32), so every task has a B2-C2B2C counterpart to pair with. */
export const PHASE2C26B2C2B2D_MAX_CONTEXT_RANK = PHASE2C26B2C2B2C_CONTEXT_BUDGET
/** The common L2 extent of B2-C2B2C: the ceiling of every tight extent and the comparison baseline. Never searched here. */
export const PHASE2C26B2C2B2D_COMMON_L2_EXTENT: Readonly<PlannerAlternativeSearchExtent> = PHASE2C26B2C2B2C_EXTENT
/** The Production default extent: the floor of every tight extent (a tight extent is never narrower than Production). */
export const PHASE2C26B2C2B2D_FLOOR_EXTENT: Readonly<PlannerAlternativeSearchExtent> = Object.freeze({ ...defaultPlannerAlternativeSearchExtent })
/** The registered extent rule. Applied by the Targets module from B2-C2B1's recorded required extent; the Search side checks the bounds only. */
export const PHASE2C26B2C2B2D_EXTENT_RULE = {
  id: 'b2c2b2d_tight_max_production_default_b2c2b1_required_v1',
  rule: 'per stream: max(Production default extent, B2-C2B1 recorded required extent); a stream the Route does not operate on (required = null) keeps the Production default',
  coverage: 'required <= extent per stream (the unchanged B2-A / B2-C2B1 coverage judgement, applied by the Targets module)',
  bounds: 'Production default <= tight <= common L2 on every stream, and strictly below common L2 on at least one stream',
} as const
/** The registered context selection: B2-C1's recorded P1 first reservation-compatible rank (post-hoc oracle compatibility). */
export const PHASE2C26B2C2B2D_CONTEXT_SELECTION = {
  id: 'b2c1_recorded_p1_first_compatible_rank',
  rule: 'per Target the one P1 rank B2-C1 recorded as its first reservation-compatible context; B2-C2B1 recorded the same rank and the B2-C2B2C analyzer recomputed it',
} as const
/** The unchanged B2-C2A capture rule (C4C) and its post-hoc prefixes (B2-C2B2C's). */
export const PHASE2C26B2C2B2D_MAX_COST_COHORTS = PHASE2C26B2C2B2C_MAX_COST_COHORTS
export const PHASE2C26B2C2B2D_CANDIDATE_SAFETY_CAP = PHASE2C26B2C2B2C_CANDIDATE_SAFETY_CAP
export const PHASE2C26B2C2B2D_CAPTURE_PREFIXES = PHASE2C26B2C2B2C_CAPTURE_PREFIXES
export const PHASE2C26B2C2B2D_NODE_YIELD = PHASE2C26B2C2B2C_NODE_YIELD
export const PHASE2C26B2C2B2D_MEMORY_SAMPLE_INTERVAL_MS = PHASE2C26B2C2B2C_MEMORY_SAMPLE_INTERVAL_MS
/** The tasks child (schedule re-derivation + task construction, no Search). */
export const PHASE2C26B2C2B2D_TASKS_BUDGET_MS = PHASE2C26B2C2B2C_TASKS_BUDGET_MS
/** Stage 1, B2-C2B2C's unchanged: fresh child, heap 8 GB, concurrency 1, 10 minutes, no retry, no fallback (budget and heap deliberately not raised). */
export const PHASE2C26B2C2B2D_STAGE1 = PHASE2C26B2C2B2C_STAGE1
/** The provenance declarations of this phase (the attestation and the RESULT record them; none may be reported otherwise). */
export const PHASE2C26B2C2B2D_PROVENANCE_FLAGS = {
  oracleGuidedPolicySelection: true,
  oracleGuidedTargetPopulation: true,
  oracleGuidedContextSelection: true,
  oracleInformedPerTargetExtent: true,
  targetIndividualOracleExtentAsSearchInput: true,
  perTargetExtent: true,
  commonExtentForEveryTask: false,
  contextOrderingUsesOracle: true,
  oracleReadBySearchChild: false,
  oracleMatchUsedForEarlyStop: false,
  expectedOutcomeKnownBySearchChild: false,
  productionSchedulerEvidence: false,
  productionExtentSelectionEvidence: false,
} as const
/** What B2-C2B2D deliberately does not run. */
export const PHASE2C26B2C2B2D_NOT_RUN = ['production_change', 'production_default_extent_change', 'production_extent_selector', 'production_rung_selector', 'production_scheduler_adoption',
  'common_l2_search', 'l1_search', 'p1_top32_search', 'budget_increase_60min', 'heap_increase', 'b2c2b2c_timeout_retry', 'b2c2b2b_timeout_retry', 'retry', 'timeout_fallback',
  'search_algorithm_change', 'search_ordering_change', 'search_comparator_change', 'search_optimization', 'p1_change', 'e2_search', 'k2_feature_grouping', 'residual_unreached_support',
  'context_level_early_stop', 'candidate_trial', 'planner_alternative_kernel', 'full_planner_rerun', 'global_assignment', 'ui_change', 'b2c2b2c_result_regeneration',
  'b2c2b2b_result_regeneration'] as const

/** The B2-C2B1 RESULT the probe manifest must come from (the manifest records it; the Search never reads it). */
export const PHASE2C26B2C2B2D_PROBE_SOURCE = { resultSha256: '418166d2a7ff40145d8650f418c025783f9b5039673ee19e722bab4836b22eae', population: 'E1_L2', policy: 'P1' } as const

/** The policy definition check, unchanged from B2-C2A (the schedule's P1, the module's P1 and the registered copy are one definition). */
export const phase2c26b2c2b2dPolicyDrift = phase2c26b2c2b2cPolicyDrift
export const PHASE2C26B2C2B2D_REGISTERED_P1 = PHASE2C26B2C2B2C_REGISTERED_P1

// ---------------------------------------------------------------- the tight extent bounds (the Search side's only extent rule)

const STREAM_KEYS = ['maxNormalAdvance', 'maxGogmaAdvance', 'maxSkillAdvance'] as const

/**
 * Whether `extent` may be searched here: exactly the three extent keys, each a safe integer between the Production default
 * and the common L2 extent, and strictly below common L2 on at least one stream (so the probe is not the B2-C2B2C condition).
 * This is a bound check only; which value a Target gets is the Targets module's rule.
 */
export function phase2c26b2c2b2dExtentBoundIssues(extent: unknown): string[] {
  if (!isObject(extent)) return ['the extent is not an object']
  const issues: string[] = []
  if (!same(Object.keys(extent).sort(), [...STREAM_KEYS].sort())) issues.push('the extent keys are not exactly maxNormalAdvance / maxGogmaAdvance / maxSkillAdvance')
  for (const key of STREAM_KEYS) {
    const value = extent[key]
    if (!Number.isSafeInteger(value)) { issues.push(`${key} is not an integer`); continue }
    if ((value as number) < PHASE2C26B2C2B2D_FLOOR_EXTENT[key]) issues.push(`${key} ${String(value)} is below the Production default ${PHASE2C26B2C2B2D_FLOOR_EXTENT[key]}`)
    if ((value as number) > PHASE2C26B2C2B2D_COMMON_L2_EXTENT[key]) issues.push(`${key} ${String(value)} is above the common L2 ${PHASE2C26B2C2B2D_COMMON_L2_EXTENT[key]}`)
  }
  if (issues.length === 0 && STREAM_KEYS.every(key => extent[key] === PHASE2C26B2C2B2D_COMMON_L2_EXTENT[key])) issues.push('the extent is the common L2 extent itself')
  return issues
}

// ---------------------------------------------------------------- the probe manifest (a Search input)

/** One probe: a Target, its selected P1 rank and its tight extent. Nothing else (no expected key, index, cost or outcome). */
export interface Phase2C26B2C2B2DProbe {
  targetWeaponId: string
  contextRank: number
  extent: PlannerAlternativeSearchExtent
}

export interface Phase2C26B2C2B2DProbeManifest {
  phase: string
  sourceResultSha256: string
  population: 'E1_L2'
  policy: 'P1'
  contextSelection: typeof PHASE2C26B2C2B2D_CONTEXT_SELECTION.id
  extentRule: typeof PHASE2C26B2C2B2D_EXTENT_RULE.id
  /** The Export B2-C2B1 was measured on (from that RESULT's provenance). */
  exportSha256: string
  probes: Phase2C26B2C2B2DProbe[]
}

const MANIFEST_KEYS = ['contextSelection', 'exportSha256', 'extentRule', 'phase', 'policy', 'population', 'probes', 'sourceResultSha256']
const PROBE_KEYS = ['contextRank', 'extent', 'targetWeaponId']

/**
 * Reads a probe manifest as untrusted JSON: exactly the manifest keys and, per probe, exactly Target ID / P1 rank / extent
 * (nothing else may ride along); the registered source RESULT, population, policy, context selection and extent rule; 4 probes
 * with distinct Target IDs in ascending order, P1 ranks in 1..32 and extents inside the bounds.
 */
export function parsePhase2C26B2C2B2DProbeManifest(json: unknown): { valid: boolean; issues: string[]; manifest: Phase2C26B2C2B2DProbeManifest | null } {
  const issues: string[] = []
  if (!isObject(json)) return { valid: false, issues: ['the probe manifest is not an object'], manifest: null }
  if (!same(Object.keys(json).sort(), MANIFEST_KEYS)) issues.push(`the probe manifest keys are not exactly ${MANIFEST_KEYS.join(', ')}`)
  if (json.sourceResultSha256 !== PHASE2C26B2C2B2D_PROBE_SOURCE.resultSha256) issues.push('sourceResultSha256 is not the registered B2-C2B1 RESULT')
  if (json.population !== PHASE2C26B2C2B2D_PROBE_SOURCE.population) issues.push(`population is not ${PHASE2C26B2C2B2D_PROBE_SOURCE.population}`)
  if (json.policy !== PHASE2C26B2C2B2D_PROBE_SOURCE.policy) issues.push('policy is not P1')
  if (json.contextSelection !== PHASE2C26B2C2B2D_CONTEXT_SELECTION.id) issues.push('contextSelection is not the registered context selection')
  if (json.extentRule !== PHASE2C26B2C2B2D_EXTENT_RULE.id) issues.push('extentRule is not the registered extent rule')
  if (typeof json.exportSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(json.exportSha256)) issues.push('exportSha256 is not a SHA-256')
  if (typeof json.phase !== 'string') issues.push('phase is not a string')
  const probes: Phase2C26B2C2B2DProbe[] = []
  if (!Array.isArray(json.probes)) issues.push('probes is not a list')
  else {
    for (const raw of json.probes as unknown[]) {
      if (!isObject(raw) || !same(Object.keys(raw).sort(), PROBE_KEYS)) { issues.push(`a probe's keys are not exactly ${PROBE_KEYS.join(', ')}`); continue }
      if (typeof raw.targetWeaponId !== 'string' || raw.targetWeaponId.length === 0) { issues.push('a probe has no Target ID'); continue }
      if (!Number.isSafeInteger(raw.contextRank) || (raw.contextRank as number) < 1 || (raw.contextRank as number) > PHASE2C26B2C2B2D_MAX_CONTEXT_RANK) {
        issues.push(`${raw.targetWeaponId}: the P1 rank is not in 1..${PHASE2C26B2C2B2D_MAX_CONTEXT_RANK}`); continue
      }
      const bound = phase2c26b2c2b2dExtentBoundIssues(raw.extent)
      if (bound.length > 0) { issues.push(...bound.map(i => `${raw.targetWeaponId}: ${i}`)); continue }
      const extent = raw.extent as Json
      probes.push({ targetWeaponId: raw.targetWeaponId, contextRank: raw.contextRank as number,
        extent: { maxNormalAdvance: extent.maxNormalAdvance as number, maxGogmaAdvance: extent.maxGogmaAdvance as number, maxSkillAdvance: extent.maxSkillAdvance as number } })
    }
    if ((json.probes as unknown[]).length !== PHASE2C26B2C2B2D_TARGETS) issues.push(`probes holds ${(json.probes as unknown[]).length} probes, not ${PHASE2C26B2C2B2D_TARGETS}`)
    const ids = probes.map(p => p.targetWeaponId)
    if (new Set(ids).size !== ids.length) issues.push('a probe Target repeats')
    if (!same(ids, [...ids].sort(compare))) issues.push('the probes are not in ascending Target order')
  }
  if (issues.length > 0) return { valid: false, issues, manifest: null }
  return { valid: true, issues: [], manifest: { phase: String(json.phase), sourceResultSha256: String(json.sourceResultSha256), population: 'E1_L2', policy: 'P1',
    contextSelection: PHASE2C26B2C2B2D_CONTEXT_SELECTION.id, extentRule: PHASE2C26B2C2B2D_EXTENT_RULE.id, exportSha256: String(json.exportSha256), probes } }
}

// ---------------------------------------------------------------- the tight Search context (extent replaced, nothing else)

/** The tight Search context: B2-C2B2A's shape (the default reconstruction with the extent replaced and the digest recomputed). */
export type Phase2C26B2C2B2DContext = Phase2C26B2C2B2AContext

/** The B1 pre-Search body of a reconstructed context, exactly as `reconstructPhase2C26B2B2AContext()` builds it, at `extent`. */
function searchBodyOf(context: Phase2C26B2B2AContext, extent: PlannerAlternativeSearchExtent): Phase2C25APreSearchContext {
  return { orientationId: '', workIndex: 0, targetWeaponId: context.targetWeaponId, status: 'searchable', invalidatedBuildListEntryId: context.currentBuildListEntryId,
    invalidatedRouteKey: context.currentRouteKey, fixedRouteBuildListEntryIds: [...context.fixedBuildListEntryIds], reservation: context.reservation, searchReservation: context.reservation,
    excludedRouteKeys: [...context.excludedRouteKeys], extent: { ...extent }, originDigest: context.originDigest, contextDigest: '' }
}

/** The context fields that must be identical between the default reconstruction and the tight context (B2-C2B2A's list). */
const NON_EXTENT_FIELDS = ['targetWeaponId', 'currentBuildListEntryId', 'currentRouteKey', 'excludedRouteKeys', 'fixedSetId', 'fixedBuildListEntryIds', 'fixedTargetWeaponIds',
  'cardinality', 'groupIndex', 'reservationDigest', 'reservation', 'originDigest', 'originSemanticDigest'] as const

/**
 * B2-C2B2A's extent replacement with the probe's tight extent: replaces the extent of one unchanged default reconstruction and
 * nothing else. Fails closed unless the given context is at the Production default extent, its recorded digest is exactly the
 * B1 digest of its own body, the reservation still hashes to its digest, `extent` lies inside the registered bounds, and every
 * non-extent field of the result is identical to the default context. The tight Search input digest is the unchanged B1
 * digest of the same body at the tight extent.
 */
export function phase2c26b2c2b2dTightContext(context: Phase2C26B2B2AContext, extent: PlannerAlternativeSearchExtent):
  { valid: true; context: Phase2C26B2C2B2DContext } | { valid: false; issues: string[] } {
  const issues: string[] = [...phase2c26b2c2b2dExtentBoundIssues(extent)]
  if (!same(context.extent, { ...defaultPlannerAlternativeSearchExtent })) issues.push('the reconstructed context is not at the Production default extent')
  if (phase2c26b1SearchInputDigest(searchBodyOf(context, context.extent)) !== context.searchInputDigest) issues.push('the default Search input digest is not the digest of the reconstructed body')
  if (hashStableValue(context.reservation) !== context.reservationDigest) issues.push('the reservation does not hash to its digest')
  if (issues.length > 0) return { valid: false, issues }
  const tight: Phase2C26B2C2B2DContext = { ...structuredClone(context), extent: { ...extent }, defaultSearchInputDigest: context.searchInputDigest,
    searchInputDigest: phase2c26b1SearchInputDigest(searchBodyOf(context, extent)) }
  for (const field of NON_EXTENT_FIELDS) if (!same(tight[field], context[field])) issues.push(`${field} differs from the default reconstruction`)
  if (tight.searchInputDigest === tight.defaultSearchInputDigest) issues.push('the tight Search input digest equals the default one')
  return issues.length > 0 ? { valid: false, issues } : { valid: true, context: tight }
}

// ---------------------------------------------------------------- task construction (one task per probe)

/** What a Search child receives: B2-C2B2A's task shape. Its extent is the probe's tight extent; no oracle field exists here. */
export type Phase2C26B2C2B2DTaskInput = Phase2C26B2C2B2ATaskInput

export interface Phase2C26B2C2B2DTaskConstruction {
  valid: boolean
  issues: string[]
  tasks: Phase2C26B2C2B2DTaskInput[]
}

const taskIdOf = (targetIndex: number, rank: number) => `t${String(targetIndex).padStart(2, '0')}-r${String(rank).padStart(2, '0')}`
const selectorOf = (row: Pick<Phase2C26B2C1ContextRow, 'targetWeaponId' | 'representativeFixedSetId' | 'targetEligibleMinCardinality' | 'reservationDigest'>) =>
  ({ targetWeaponId: row.targetWeaponId, fixedSetId: row.representativeFixedSetId, cardinality: row.targetEligibleMinCardinality, reservationDigest: row.reservationDigest })

/**
 * One task per probe, in probe order: the schedule row of the probe's Target at the probe's P1 rank, rebuilt by the unchanged
 * `reconstructPhase2C26B2B2AContext()` and moved to the probe's tight extent by `phase2c26b2c2b2dTightContext()`. The task ID is
 * B2-C2B2C's (`t<probe index>-r<rank>`), so a task names its B2-C2B2C counterpart. Fails closed on a P1 drift, a schedule
 * extent other than the Production default, a missing / repeated / checkpoint Target, a rank outside 1..32 or held by other
 * than exactly one row, a context the snapshot cannot rebuild or move to the tight extent, an extent outside the bounds, or a
 * task count other than the probe count. Reads nothing but the schedule and the probes.
 */
export function buildPhase2C26B2C2B2DTasks(schedule: Phase2C26B2C1Schedule, probes: readonly Phase2C26B2C2B2DProbe[]): Phase2C26B2C2B2DTaskConstruction {
  const issues: string[] = [...phase2c26b2c2b2dPolicyDrift(schedule)]
  if (!same(schedule.extent, { ...defaultPlannerAlternativeSearchExtent })) issues.push('the schedule extent is not the Production default extent')
  if (new Set(probes.map(p => p.targetWeaponId)).size !== probes.length) issues.push('a probe Target repeats')
  const tasks: Phase2C26B2C2B2DTaskInput[] = []
  probes.forEach((probe, targetIndex) => {
    const at = `${probe.targetWeaponId} @ P1 rank ${probe.contextRank}`
    const target = schedule.targets.find(t => t.targetWeaponId === probe.targetWeaponId)
    if (!target) { issues.push(`${probe.targetWeaponId}: not a schedule Target`); return }
    if (target.checkpointHardConstraint) { issues.push(`${probe.targetWeaponId}: a checkpoint hard-constraint Target has no context`); return }
    if (!Number.isSafeInteger(probe.contextRank) || probe.contextRank < 1 || probe.contextRank > PHASE2C26B2C2B2D_MAX_CONTEXT_RANK) { issues.push(`${at}: the rank is not in 1..${PHASE2C26B2C2B2D_MAX_CONTEXT_RANK}`); return }
    const rows = schedule.contexts.filter(c => c.targetWeaponId === probe.targetWeaponId && c.ranks.P1 === probe.contextRank)
    if (rows.length !== 1) { issues.push(`${at}: ${rows.length} schedule rows hold the rank`); return }
    const row = rows[0]!
    const rebuilt = reconstructPhase2C26B2B2AContext(schedule.snapshot, selectorOf(row))
    if (!rebuilt.valid) { issues.push(`${at}: ${rebuilt.issues.join('/')}`); return }
    if (rebuilt.context.groupIndex !== row.groupIndex) { issues.push(`${at}: group drift`); return }
    const tight = phase2c26b2c2b2dTightContext(rebuilt.context, probe.extent)
    if (!tight.valid) { issues.push(`${at}: ${tight.issues.join('/')}`); return }
    tasks.push({ taskId: taskIdOf(targetIndex, row.ranks.P1), executionClass: 'stage1', targetWeaponId: probe.targetWeaponId, contextRank: row.ranks.P1, policy: 'P1', groupIndex: row.groupIndex,
      reservationDigest: row.reservationDigest, targetEligibleMinCardinality: row.targetEligibleMinCardinality, representativeFixedSetId: row.representativeFixedSetId,
      representativeFixedTargetWeaponIds: [...row.representativeFixedTargetWeaponIds], defaultSearchInputDigest: tight.context.defaultSearchInputDigest,
      searchInputDigest: tight.context.searchInputDigest, extent: { ...tight.context.extent }, maxCostCohorts: PHASE2C26B2C2B2D_MAX_COST_COHORTS, candidateSafetyCap: PHASE2C26B2C2B2D_CANDIDATE_SAFETY_CAP })
  })
  if (issues.length === 0 && tasks.length !== probes.length) issues.push(`${tasks.length} tasks, not ${probes.length}`)
  if (new Set(tasks.map(t => t.taskId)).size !== tasks.length) issues.push('a task ID repeats')
  if (tasks.some((t, i) => !same(t.extent, probes[i]?.extent ?? null))) issues.push('a task extent is not its probe extent')
  return { valid: issues.length === 0, issues, tasks: issues.length === 0 ? tasks : [] }
}

// ---------------------------------------------------------------- one Search task (child calculation)

/** B2-C2B2A's search record shape (the extent field carries the tight extent). */
export type Phase2C26B2C2B2DSearchRecord = Phase2C26B2C2B2ASearchRecord

/**
 * The capture of one tight context: `visitPlannerAlternativeCandidates()` with exactly the Planner-start origin, the context
 * reservation, the excluded current Route key and the probe's tight extent. The consumer stops at the sentinel or at the
 * safety cap; nothing else stops it (no oracle is known here). The body is B2-C2B2A's `runPhase2C26B2C2B2ASearch()` line for
 * line; only the extent it accepts differs (inside the bounds instead of exactly L2), as B2-C2B2B's L1 copy did.
 */
export async function runPhase2C26B2C2B2DSearch(input: PlannerInput, context: Phase2C26B2C2B2DContext, engine: RngEngine, capture: { maxCostCohorts: number; candidateSafetyCap: number },
  provenance: { contextRank: number; targetEligibleMinCardinality: number; representativeFixedSetId: string; representativeFixedTargetWeaponIds: string[] },
  options: { yieldControl?: () => Promise<void>; now?: () => number } = {}): Promise<Phase2C26B2C2B2DSearchRecord> {
  if (capture.maxCostCohorts !== PHASE2C26B2C2B2D_MAX_COST_COHORTS) throw new Error(`The B2-C2B2D capture drains ${PHASE2C26B2C2B2D_MAX_COST_COHORTS} cost cohorts, not ${capture.maxCostCohorts}.`)
  if (capture.candidateSafetyCap !== PHASE2C26B2C2B2D_CANDIDATE_SAFETY_CAP) throw new Error(`The B2-C2B2D safety cap is ${PHASE2C26B2C2B2D_CANDIDATE_SAFETY_CAP}, not ${capture.candidateSafetyCap}.`)
  const bound = phase2c26b2c2b2dExtentBoundIssues(context.extent)
  if (bound.length > 0) throw new Error(`B2-C2B2D searches a tight extent between the Production default and the common L2 extent only: ${bound.join('; ')}`)
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

export type Phase2C26B2C2B2DChildRecord = Phase2C26B2C2B2AChildRecord

/**
 * The child calculation (B2-C2B2A's with the tight extent): the policy check, the task extent bounds, then the one schedule row
 * of this Target at this P1 rank (from the child's own re-derived schedule), compared with every task field; then the
 * unchanged reconstruction, the tight replacement (both digests and the extent compared with the task) and the capture. Any
 * drift is a context mismatch and no Search runs.
 */
export async function runPhase2C26B2C2B2DTask(input: PlannerInput, schedule: Phase2C26B2C1Schedule, task: Phase2C26B2C2B2DTaskInput, engine: RngEngine,
  options: { yieldControl?: () => Promise<void>; now?: () => number } = {}): Promise<Phase2C26B2C2B2DChildRecord> {
  const issues: string[] = [...phase2c26b2c2b2dPolicyDrift(schedule)]
  if (task.policy !== 'P1') issues.push('policy')
  if (phase2c26b2c2b2dExtentBoundIssues(task.extent).length > 0) issues.push('extent')
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
  const tight = phase2c26b2c2b2dTightContext(rebuilt.context, task.extent)
  if (!tight.valid) return { status: 'context_mismatch', taskId: task.taskId, issues: tight.issues }
  if (tight.context.searchInputDigest !== task.searchInputDigest) return { status: 'context_mismatch', taskId: task.taskId, issues: ['searchInputDigest'] }
  const search = await runPhase2C26B2C2B2DSearch(input, tight.context, engine, { maxCostCohorts: task.maxCostCohorts, candidateSafetyCap: task.candidateSafetyCap },
    { contextRank: task.contextRank, targetEligibleMinCardinality: task.targetEligibleMinCardinality, representativeFixedSetId: task.representativeFixedSetId,
      representativeFixedTargetWeaponIds: task.representativeFixedTargetWeaponIds }, options)
  return { status: 'searched', taskId: task.taskId, search }
}

// ---------------------------------------------------------------- task outcomes

export type Phase2C26B2C2B2DTaskOutcome = Phase2C26B2C2B2ATaskOutcome

/** A timeout / out-of-memory / failure is that failure, never "no Candidate"; a completed child without a record is a failure. */
export function phase2c26b2c2b2dTaskOutcome(taskId: string, process: Phase2C2ChildOutcome, record: Phase2C26B2C2B2DChildRecord | null): Phase2C26B2C2B2DTaskOutcome {
  const none = { searchStatus: null, termination: null, candidateCount: null }
  if (process !== 'completed' || record === null) return { taskId, process: process === 'completed' ? 'process_failure' : process, record: null, ...none }
  if (record.status === 'context_mismatch') return { taskId, process, record: 'context_mismatch', ...none }
  return { taskId, process, record: 'searched', searchStatus: record.search.status, termination: record.search.termination, candidateCount: record.search.candidates.length }
}

// ---------------------------------------------------------------- runner start attestation (written by the runner before any child)

/** The file the parent runner writes into the run dir, once (`wx`), read-only, before the first child process starts. */
export const PHASE2C26B2C2B2D_START_ATTESTATION_FILE = 'start-attestation.json'
export const PHASE2C26B2C2B2D_START_ATTESTATION_PHASE = 'Issue #154 Phase 2-C2.6-B2-C2B2D runner start attestation'

/** The registered execution conditions of a formal launch (the runner fills nothing of these by hand). */
export function phase2c26b2c2b2dRegisteredConditions() {
  return { stage1: { ...PHASE2C26B2C2B2D_STAGE1 } as { executionClass: 'stage1'; childHeapMb: number; concurrency: number; budgetMs: number; retry: 'none'; fallback: 'none' },
    tasksBudgetMs: PHASE2C26B2C2B2D_TASKS_BUDGET_MS, targets: PHASE2C26B2C2B2D_TARGETS, contextsPerTarget: PHASE2C26B2C2B2D_CONTEXTS_PER_TARGET,
    expectedTasks: PHASE2C26B2C2B2D_EXPECTED_TASKS, contextSelection: PHASE2C26B2C2B2D_CONTEXT_SELECTION.id, extentRule: PHASE2C26B2C2B2D_EXTENT_RULE.id,
    extentFloor: { ...PHASE2C26B2C2B2D_FLOOR_EXTENT }, extentCeiling: { ...PHASE2C26B2C2B2D_COMMON_L2_EXTENT },
    captureRule: { policy: 'C4C', maxCostCohorts: PHASE2C26B2C2B2D_MAX_COST_COHORTS, sentinel: 'first delivery of the fifth distinct operation cost (never captured)', prefixes: { ...PHASE2C26B2C2B2D_CAPTURE_PREFIXES } },
    candidateSafetyCap: PHASE2C26B2C2B2D_CANDIDATE_SAFETY_CAP, registeredP1: PHASE2C26B2C2B2D_REGISTERED_P1, nodeYield: PHASE2C26B2C2B2D_NODE_YIELD,
    memorySampleIntervalMs: PHASE2C26B2C2B2D_MEMORY_SAMPLE_INTERVAL_MS, provenanceFlags: { ...PHASE2C26B2C2B2D_PROVENANCE_FLAGS } }
}

/** What only the runner observes at launch (Stage 1 is the one it actually runs: a smoke budget shows here). */
export interface Phase2C26B2C2B2DLaunchObservation {
  createdAt: string
  runnerScript: string
  node: string
  repositoryHead: string
  uncommittedBenchmarkCode: boolean
  benchmarkCodeSha256: string
  exportFileName: string
  exportSha256: string
  exportBytes: number
  probeManifestFileName: string
  probeManifestSha256: string
  probeManifestSourceResultSha256: string
  targetWeaponIds: string[]
  /** The probes as the manifest holds them (Target, selected P1 rank, tight extent): the oracle-guided inputs, attested. */
  probes: Phase2C26B2C2B2DProbe[]
  stage1: ReturnType<typeof phase2c26b2c2b2dRegisteredConditions>['stage1']
  smoke: { taskIds: string[] | null; budgetMs: number | null } | null
}

export type Phase2C26B2C2B2DStartAttestation = ReturnType<typeof phase2c26b2c2b2dRegisteredConditions> & Phase2C26B2C2B2DLaunchObservation & { phase: string; attestedBy: 'runner' }

/** The attestation body the runner writes: the registered conditions, then its launch observation (its actual Stage 1 included). */
export function phase2c26b2c2b2dStartAttestationBody(observation: Phase2C26B2C2B2DLaunchObservation): Phase2C26B2C2B2DStartAttestation {
  return { phase: PHASE2C26B2C2B2D_START_ATTESTATION_PHASE, attestedBy: 'runner', ...phase2c26b2c2b2dRegisteredConditions(), ...observation }
}

const ATTESTATION_KEYS = Object.keys(phase2c26b2c2b2dStartAttestationBody({ createdAt: '', runnerScript: '', node: '', repositoryHead: '', uncommittedBenchmarkCode: false, benchmarkCodeSha256: '',
  exportFileName: '', exportSha256: '', exportBytes: 0, probeManifestFileName: '', probeManifestSha256: '', probeManifestSourceResultSha256: '', targetWeaponIds: [], probes: [],
  stage1: phase2c26b2c2b2dRegisteredConditions().stage1, smoke: null })).sort()
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

/** The independently obtained values a start attestation must equal. */
export interface Phase2C26B2C2B2DAttestationExpectation {
  /** The measurement HEAD named for this run (it must also recompute to the attested benchmark code SHA-256). */
  repositoryHead: string
  /** The benchmark code SHA-256 recomputed from that HEAD's git objects by the runner rule. */
  benchmarkCodeSha256: string
  /** The SHA-256 of the Export file the verifier reads. */
  exportSha256: string
  /** The SHA-256 of the probe manifest file the verifier reads. */
  probeManifestSha256: string
  /** The manifest probes (Target IDs, ranks and extents). */
  probes: readonly Phase2C26B2C2B2DProbe[]
  /** When the first child process (the tasks child) started, if known: the attestation must not be later. */
  firstChildStartedAt: string | null
}

export interface Phase2C26B2C2B2DAttestationVerification {
  verified: boolean
  /** Every reason the attestation does not prove a formal launch. */
  issues: string[]
  /**
   * The subset that breaks the attestation's integrity (not the runner's, not this run's, not these inputs): a malformed or
   * foreign attestation, a later createdAt, a HEAD / code / Export / manifest / probe mismatch. The rest (an uncommitted or
   * smoke launch, a condition other than the registered one) is a truthfully attested non-formal launch.
   */
  integrityIssues: string[]
}

/**
 * Whether a start attestation proves the launch of a formal run, failing closed on anything else: exactly the attestation
 * keys; `attestedBy: 'runner'` and the B2-C2B2D phase marker; a canonical UTC `createdAt` no later than the first child start;
 * the attested HEAD / benchmark code SHA-256 / Export SHA-256 / probe manifest SHA-256 / Target IDs / probes equal to the
 * independently obtained ones; a clean launch (`uncommittedBenchmarkCode === false`, no smoke option); and every registered
 * condition (Stage 1, Targets, tasks, context selection, extent rule and bounds, capture rule, safety cap, P1, yield,
 * sampling, provenance flags) unchanged.
 */
export function verifyPhase2C26B2C2B2DStartAttestation(attestation: unknown, expected: Phase2C26B2C2B2DAttestationExpectation): Phase2C26B2C2B2DAttestationVerification {
  if (!isObject(attestation)) return { verified: false, issues: ['the start attestation is not an object'], integrityIssues: ['the start attestation is not an object'] }
  const integrityIssues: string[] = []
  const launchIssues: string[] = []
  if (!same(Object.keys(attestation).sort(), ATTESTATION_KEYS)) integrityIssues.push('the start attestation keys are not exactly the attestation keys')
  if (attestation.attestedBy !== 'runner') integrityIssues.push('not attested by the runner')
  if (attestation.phase !== PHASE2C26B2C2B2D_START_ATTESTATION_PHASE) integrityIssues.push('not a B2-C2B2D start attestation')
  if (typeof attestation.createdAt !== 'string' || !ISO_UTC.test(attestation.createdAt) || new Date(attestation.createdAt).toISOString() !== attestation.createdAt) integrityIssues.push('createdAt is not a canonical UTC time')
  else if (expected.firstChildStartedAt !== null && !(attestation.createdAt <= expected.firstChildStartedAt)) integrityIssues.push('createdAt is later than the first child start')
  if (typeof attestation.repositoryHead !== 'string' || !/^[0-9a-f]{40}$/.test(attestation.repositoryHead)) integrityIssues.push('repositoryHead is not a commit SHA')
  if (attestation.repositoryHead !== expected.repositoryHead) integrityIssues.push('repositoryHead differs')
  if (attestation.benchmarkCodeSha256 !== expected.benchmarkCodeSha256) integrityIssues.push('benchmarkCodeSha256 differs')
  if (attestation.exportSha256 !== expected.exportSha256) integrityIssues.push('exportSha256 differs')
  if (attestation.probeManifestSha256 !== expected.probeManifestSha256) integrityIssues.push('probeManifestSha256 differs')
  if (attestation.probeManifestSourceResultSha256 !== PHASE2C26B2C2B2D_PROBE_SOURCE.resultSha256) integrityIssues.push('probeManifestSourceResultSha256 is not the registered B2-C2B1 RESULT')
  if (!same(attestation.targetWeaponIds, expected.probes.map(p => p.targetWeaponId))) integrityIssues.push('targetWeaponIds differ')
  if (!same(attestation.probes, expected.probes)) integrityIssues.push('probes differ')
  if (attestation.uncommittedBenchmarkCode !== false) launchIssues.push('uncommitted benchmark code at launch')
  if (attestation.smoke !== null) launchIssues.push('a smoke option at launch')
  for (const [field, value] of Object.entries(phase2c26b2c2b2dRegisteredConditions())) if (!same(attestation[field], value)) launchIssues.push(`${field} differs from the registered condition`)
  const issues = [...integrityIssues, ...launchIssues]
  return { verified: issues.length === 0, issues, integrityIssues }
}
