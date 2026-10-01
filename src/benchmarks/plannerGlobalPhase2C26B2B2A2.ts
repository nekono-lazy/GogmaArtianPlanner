/**
 * Issue #154 Phase 2-C2.6-B2-B2A2: boundary operation-cost cohort drain of the two B2-B2A contexts whose capture of 32
 * stopped inside one operation-cost cohort. Research only. Never import from Production.
 *
 * B2-B2A measured 20 known-compatible representative contexts at the Production default extent with capture bound 32.
 * Two of them (`capture_or_ordering_unresolved`) stopped by the consumer at 32 deliveries while the 32nd Candidate still
 * had the operation cost of the cohort it was delivered in. `visitPlannerAlternativeCandidates()` delivers a whole
 * operation-cost cohort at once, sorted by the six-key `compareConstrainedCandidates()` order (operation cost, Gogma
 * advance, Skill advance, Normal advance, preferred source, stable key), and never delivers a cheaper Candidate after a
 * dearer one. So B2-B2A2 asks one question only:
 *
 * ```text
 * the same context (re-derived from the Export through the unchanged B2-B1 calculation)
 *   -> visitPlannerAlternativeCandidates() unchanged, Production default extent
 *   -> continue while a delivered Candidate costs <= boundaryCost (the cost of B2-B2A's 32nd delivery)
 *   -> stop at the FIRST Candidate costing more (the next-cost sentinel: the boundary cohort is complete)
 *      or at the natural end of the Search (exhausted / stopped by extent: the cohort is complete too)
 *      or at the registered Research safety cap (8192 Candidates <= boundaryCost: the cohort is NOT shown complete)
 * ```
 *
 * The task SELECTION is oracle-guided (B2-B2A's post-hoc `deliveryClass`) and is declared as such. The Search child is
 * not: it receives the Target, the fixed-set selector, the expected Production digests, the boundary cost and the safety
 * cap, re-derives the Planner-start origin, the reservation, the excluded current Route key and the extent from the Export,
 * and never reads the oracle, its manifest, an oracle Candidate key, an oracle Route kind, an oracle Counter position, an
 * oracle operation count or an expected delivery index. An oracle match never stops it: only the analyzer, after the run,
 * compares the delivered cohort with the oracle Route.
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
import {
  phase2c2SearchStatus,
  respectsPhase2C2Reservation,
  summarizePhase2C2Entry,
  type Phase2C2CandidateSummary,
  type Phase2C2ChildOutcome,
  type Phase2C2SearchStatus,
} from './plannerGlobalPhase2C2'
import {
  PHASE2C26B2B2A_CAPTURE_BOUND,
  PHASE2C26B2B2A_REGISTERED_B2B1,
  reconstructPhase2C26B2B2AContext,
  type Phase2C26B2B2AContext,
} from './plannerGlobalPhase2C26B2B2A'
import type { Phase2C26B2B1Snapshot } from './plannerGlobalPhase2C26B2B1'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0

// ---------------------------------------------------------------- Research execution conditions (registered, not Production defaults)

/**
 * Candidates costing at most the boundary cost a context may deliver before the consumer stops without a sentinel or a
 * natural end. A Research accident guard only: it is not a Production capture bound, and reaching it leaves the cohort
 * undrained (unresolved), whatever the cohort held up to it.
 */
export const PHASE2C26B2B2A2_COHORT_SAFETY_CAP = 8192
/** The prefix B2-B2A delivered (its capture bound): the re-run must reproduce it exactly. */
export const PHASE2C26B2B2A2_PRIOR_PREFIX_LENGTH = PHASE2C26B2B2A_CAPTURE_BOUND
export const PHASE2C26B2B2A2_EXTENT_LABEL = 'default' as const
export const PHASE2C26B2B2A2_NODE_YIELD = 'setImmediate' as const
export const PHASE2C26B2B2A2_MEMORY_SAMPLE_INTERVAL_MS = 250
/** The tasks child (snapshot re-derivation + representative reconstruction, no Search). */
export const PHASE2C26B2B2A2_TASKS_BUDGET_MS = 10 * 60 * 1000
export type Phase2C26B2B2A2ExecutionClass = 'stage1' | 'timeout_fallback'
/** Stage 1: every task once, alone, fresh child, no retry. */
export const PHASE2C26B2B2A2_STAGE1 = { executionClass: 'stage1', childHeapMb: 8192, concurrency: 1, budgetMs: 30 * 60 * 1000, retry: 'none' } as const
/**
 * Fallback: only a task whose Stage 1 child TIMED OUT, run once more with the identical task, alone, fresh child, longer
 * budget. An out-of-memory or other process failure is never retried; a Stage 1 completion never runs a fallback.
 */
export const PHASE2C26B2B2A2_FALLBACK = { executionClass: 'timeout_fallback', trigger: 'timeout', childHeapMb: 8192, concurrency: 1, budgetMs: 60 * 60 * 1000, runs: 1, retry: 'none' } as const
/** What B2-B2A2 deliberately does not run. */
export const PHASE2C26B2B2A2_NOT_RUN = ['production_change', 'search_algorithm_change', 'search_ordering_change', 'search_comparator_change', 'extent_default_change', 'capture_bound_increase',
  'candidate_search', 'planner_alternative_kernel', 'candidate_trial', 'full_planner_rerun', 'global_assignment', 'final_43_target_coexistence', 'context_scheduler',
  'extent_insufficient_search', 'extent_probe', 'ui_change', 'runtime_optimization'] as const

// ---------------------------------------------------------------- the B2-B2A RESULT (task-selection authority)

/** The B2-B2A result this phase is registered against. Any other value fails closed. */
export const PHASE2C26B2B2A2_REGISTERED_B2B2A = {
  resultSha256: 'b1ae4e8112772ebc75cba14de3fdead48a55ce34c6871ec03ca6f628c73fa9cb',
  decisionCase: 'B2B2A_PARTIAL_DELIVERY',
  all: { targets: 20, measured: 20, exact: 18, partial: 0, capture_or_ordering_unresolved: 2, completed_without_oracle_match: 0, not_comparable: 0, unmeasured: 0 },
  captureBound: 32,
  /** The B2-B1 RESULT B2-B2A was registered against (its own registration). */
  b2b1ResultSha256: PHASE2C26B2B2A_REGISTERED_B2B1.resultSha256,
} as const

/** One B2-B2A delivery as the RESULT records it (compact summary; the stable key as SHA-256). */
export interface Phase2C26B2B2A2PriorCandidate {
  deliveryIndex: number
  stableKeySha256: string
  routeKind: string
  sourceKind: string
  estimatedOperationCount: number
  /** `{ first, last, operations, positions, crossesHeldPositions, startsAfterOrigin }` per stream, or null. */
  normal: unknown
  gogma: unknown
  skill: unknown
  heldRoute: boolean
  respectsReservation: boolean
}

/** One B2-B2A row, the fields B2-B2A2 reads from it. */
export interface Phase2C26B2B2A2AuthorityRow {
  taskId: string
  targetWeaponId: string
  population: string
  cardinality: number
  fixedSetId: string
  fixedTargetWeaponIds: string[]
  groupIndex: number
  reservationDigest: string
  searchInputDigest: string
  excludedRouteKeySha256: string
  extent: unknown
  /** Range form (`phase2c26b2aReservationRanges()`). */
  reservation: unknown
  searchStatus: string | null
  delivered: number | null
  candidates: Phase2C26B2B2A2PriorCandidate[]
  deliveryClass: string
  coverage: string | null
  exactDeliveryIndexes: number[]
  partialDeliveryIndexes: number[]
}

export interface Phase2C26B2B2A2Authority {
  measuredHead: string
  analysisHead: string
  /** The B2-B2A raw run file the RESULT was built from (optional supplementary prefix parity). */
  rawRunSha256: string
  exportSha256: string
  b2b1ResultSha256: string
  b2aResultSha256: string
  oracleResultSha256: string
  oracleManifestFileSha256: string
  oracleManifestRoutesSha256: string
  extent: PlannerAlternativeSearchExtent
  calculationContext: unknown
  researchMaxPlanSteps: number
  rows: Phase2C26B2B2A2AuthorityRow[]
}

const SHA256 = /^[0-9a-f]{64}$/
const COMMIT = /^[0-9a-f]{40}$/

function parsePriorCandidate(raw: unknown, index: number): Phase2C26B2B2A2PriorCandidate | null {
  if (!isObject(raw) || !isObject(raw.summary) || raw.deliveryIndex !== index || typeof raw.stableKeySha256 !== 'string' || !SHA256.test(raw.stableKeySha256)
    || typeof raw.respectsReservation !== 'boolean') return null
  const s = raw.summary
  if (typeof s.routeKind !== 'string' || typeof s.sourceKind !== 'string' || !isCount(s.estimatedOperationCount) || typeof s.heldRoute !== 'boolean') return null
  return { deliveryIndex: index, stableKeySha256: raw.stableKeySha256, routeKind: s.routeKind, sourceKind: s.sourceKind, estimatedOperationCount: s.estimatedOperationCount,
    normal: s.normal ?? null, gogma: s.gogma ?? null, skill: s.skill ?? null, heldRoute: s.heldRoute, respectsReservation: raw.respectsReservation }
}

/**
 * Reads the committed B2-B2A RESULT as untrusted JSON and fails closed unless it is the registered formal result: its own
 * SHA-256, formal with no calculation change after its measured HEAD, case B2B2A_PARTIAL_DELIVERY, no invalid reason, the
 * registered delivery counts (20 / 20 measured, 18 exact, 0 partial, 2 unresolved, 0 completed without match, 0
 * unmeasured), no reservation violation, capture bound 32 at the Production default extent, the oracle-guided selection
 * declaration, every hash-chain flag true, the recorded predecessor SHA-256s equal to what B2-B1 recorded (and the B2-B1
 * SHA-256 the registered one), and every reconstruction matching.
 */
export function parsePhase2C26B2B2A2B2B2AAuthority(json: unknown, resultSha256: string): { valid: boolean; issues: string[]; authority: Phase2C26B2B2A2Authority | null } {
  const reg = PHASE2C26B2B2A2_REGISTERED_B2B2A
  const issues: string[] = []
  if (!isObject(json) || !isObject(json.provenance) || !isObject(json.decision) || !isObject(json.aggregates) || !isObject(json.parity) || !isObject(json.conditions) || !isObject(json.sources)) {
    return { valid: false, issues: ['B2-B2A RESULT lacks provenance / decision / aggregates / parity / conditions / sources'], authority: null }
  }
  const { provenance, decision, aggregates, parity, conditions, sources } = json
  if (resultSha256 !== reg.resultSha256) issues.push(`B2-B2A RESULT SHA-256 ${resultSha256} is not the registered ${reg.resultSha256}`)
  if (provenance.formal !== true) issues.push('provenance.formal is not true')
  if (!Array.isArray(provenance.calculationCodeChangedSinceMeasuredHead) || provenance.calculationCodeChangedSinceMeasuredHead.length !== 0) issues.push('provenance.calculationCodeChangedSinceMeasuredHead is not empty')
  if (provenance.uncommittedBenchmarkCode !== false || provenance.smoke !== null) issues.push('provenance: uncommitted benchmark code or a smoke run')
  for (const field of ['measuredHead', 'analysisHead'] as const) if (typeof provenance[field] !== 'string' || !COMMIT.test(provenance[field] as string)) issues.push(`provenance.${field} is not a commit SHA`)
  for (const field of ['exportSha256', 'b2b1ResultSha256', 'b2aResultSha256', 'oracleResultSha256', 'oracleManifestFileSha256', 'oracleManifestRoutesSha256'] as const) {
    if (typeof provenance[field] !== 'string' || !SHA256.test(provenance[field] as string)) issues.push(`provenance.${field} is not a SHA-256`)
  }
  // The B2-B2A analyzer recorded each predecessor hash twice (as read, and as B2-B1 recorded it): both must agree.
  for (const field of ['b2aResultSha256', 'oracleResultSha256', 'oracleManifestFileSha256', 'oracleManifestRoutesSha256'] as const) {
    if (provenance[field] !== provenance[`${field}RecordedByB2B1`]) issues.push(`provenance: ${field} differs from the one B2-B1 recorded`)
  }
  if (provenance.b2b1ResultSha256 !== reg.b2b1ResultSha256) issues.push('provenance.b2b1ResultSha256 is not the B2-B1 RESULT B2-B2A was registered against')
  if (provenance.oracleGuidedTaskSelection !== true || provenance.oracleReadBySearchRunner !== false) issues.push('provenance: the oracle-guided selection / Search-runner isolation declaration is missing')
  const run = isObject(sources.run) ? sources.run : {}
  if (typeof run.sha256 !== 'string' || !SHA256.test(run.sha256)) issues.push('sources.run.sha256 is not a SHA-256')
  if (decision.case !== reg.decisionCase) issues.push(`decision.case ${String(decision.case)} is not ${reg.decisionCase}`)
  if (!Array.isArray(json.invalidReasons) || json.invalidReasons.length !== 0) issues.push('invalidReasons is not empty')
  const all = isObject(aggregates.all) ? aggregates.all : {}
  for (const [field, expected] of Object.entries(reg.all)) if (all[field] !== expected) issues.push(`aggregates.all.${field} ${String(all[field])} is not ${expected}`)
  const diversity = isObject(aggregates.diversity) ? aggregates.diversity : {}
  if (diversity.reservationViolations !== 0) issues.push('aggregates.diversity.reservationViolations is not 0')
  if (conditions.captureBound !== reg.captureBound) issues.push(`conditions.captureBound ${String(conditions.captureBound)} is not ${reg.captureBound}`)
  if (!same(conditions.extent, { ...defaultPlannerAlternativeSearchExtent })) issues.push('conditions.extent is not the Production default extent')
  if (conditions.extentLabel !== 'default') issues.push('conditions.extentLabel is not default')
  if (!isObject(conditions.calculationContext) || typeof conditions.researchMaxPlanSteps !== 'number') issues.push('conditions.calculationContext / researchMaxPlanSteps missing')
  const hashChain = isObject(parity.hashChain) ? parity.hashChain : null
  if (!hashChain || Object.keys(hashChain).length === 0 || !Object.values(hashChain).every(ok => ok === true)) issues.push('parity.hashChain: not every recorded hash-chain check is true')
  const reconstruction = asArray(parity.reconstruction)
  if (reconstruction.length !== reg.all.targets || !reconstruction.every(row => isObject(row) && row.matches === true)) issues.push('parity.reconstruction: not every context matched its B2-B1 representative')

  const rows: Phase2C26B2B2A2AuthorityRow[] = []
  for (const raw of asArray(json.rows)) {
    const search = isObject(raw) && (raw.search === null || isObject(raw.search)) ? raw.search as Json | null : undefined
    const comparison = isObject(raw) && isObject(raw.comparison) ? raw.comparison : null
    if (!isObject(raw) || search === undefined || !comparison || typeof raw.taskId !== 'string' || typeof raw.targetWeaponId !== 'string' || typeof raw.fixedSetId !== 'string'
      || !Array.isArray(raw.fixedTargetWeaponIds) || !isCount(raw.groupIndex) || !isCount(raw.cardinality) || typeof raw.reservationDigest !== 'string' || typeof raw.searchInputDigest !== 'string'
      || typeof raw.excludedRouteKeySha256 !== 'string' || typeof comparison.deliveryClass !== 'string') { issues.push('a B2-B2A row is malformed'); continue }
    const candidates: Phase2C26B2B2A2PriorCandidate[] = []
    let malformed = false
    asArray(search?.candidates).forEach((c, i) => { const parsed = parsePriorCandidate(c, i); if (parsed) candidates.push(parsed); else malformed = true })
    if (malformed) { issues.push(`${raw.targetWeaponId}: a delivered Candidate is malformed`); continue }
    const summary = search && isObject(search.summary) ? search.summary : {}
    rows.push({ taskId: raw.taskId, targetWeaponId: raw.targetWeaponId, population: String(raw.population), cardinality: raw.cardinality, fixedSetId: raw.fixedSetId,
      fixedTargetWeaponIds: raw.fixedTargetWeaponIds.map(String), groupIndex: raw.groupIndex, reservationDigest: raw.reservationDigest, searchInputDigest: raw.searchInputDigest,
      excludedRouteKeySha256: raw.excludedRouteKeySha256, extent: raw.extent ?? null, reservation: raw.reservation ?? null,
      searchStatus: typeof search?.status === 'string' ? search.status : null, delivered: isCount(summary.deliveredCandidates) ? summary.deliveredCandidates : null, candidates,
      deliveryClass: comparison.deliveryClass, coverage: typeof comparison.coverage === 'string' ? comparison.coverage : null,
      exactDeliveryIndexes: asArray(comparison.exactDeliveryIndexes).filter(isCount), partialDeliveryIndexes: asArray(comparison.partialDeliveryIndexes).filter(isCount) })
  }
  if (rows.length !== reg.all.targets || new Set(rows.map(row => row.targetWeaponId)).size !== rows.length) issues.push(`rows are not ${reg.all.targets} distinct Targets`)
  if (issues.length > 0) return { valid: false, issues, authority: null }
  return { valid: true, issues: [], authority: {
    measuredHead: String(provenance.measuredHead), analysisHead: String(provenance.analysisHead), rawRunSha256: String(run.sha256), exportSha256: String(provenance.exportSha256),
    b2b1ResultSha256: String(provenance.b2b1ResultSha256), b2aResultSha256: String(provenance.b2aResultSha256), oracleResultSha256: String(provenance.oracleResultSha256),
    oracleManifestFileSha256: String(provenance.oracleManifestFileSha256), oracleManifestRoutesSha256: String(provenance.oracleManifestRoutesSha256),
    extent: { ...defaultPlannerAlternativeSearchExtent }, calculationContext: conditions.calculationContext, researchMaxPlanSteps: conditions.researchMaxPlanSteps as number, rows,
  } }
}

// ---------------------------------------------------------------- task selection (oracle-guided, declared)

/** One selected Target: the B2-B2A context selector, its boundary cost and its recorded prior prefix (analysis only). */
export interface Phase2C26B2B2A2Selection {
  targetWeaponId: string
  b2b2aTaskId: string
  fixedSetId: string
  cardinality: number
  reservationDigest: string
  searchInputDigest: string
  /** `estimatedOperationCount` of the 32nd B2-B2A delivery (index 31). */
  boundaryCost: number
  /** The B2-B2A deliveries 0..31 (the prefix the re-run must reproduce). */
  priorPrefix: Phase2C26B2B2A2PriorCandidate[]
}

/**
 * The registered selection rule over the B2-B2A rows: `comparison.deliveryClass === 'capture_or_ordering_unresolved'`,
 * nothing else. Each selected row must be a consumer stop at exactly 32 deliveries, uncovered, with no exact / partial
 * index; its delivered costs must be nondecreasing integers (no Candidate before index 31 above the boundary). The
 * boundary cost is the cost of index 31, derived per row (never a constant). The count must be the registered
 * `capture_or_ordering_unresolved` count. Selections are in Target ID order.
 */
export function selectPhase2C26B2B2A2Tasks(authority: Pick<Phase2C26B2B2A2Authority, 'rows'>): { valid: boolean; issues: string[]; selections: Phase2C26B2B2A2Selection[] } {
  const issues: string[] = []
  const prefix = PHASE2C26B2B2A2_PRIOR_PREFIX_LENGTH
  const selected = authority.rows.filter(row => row.deliveryClass === 'capture_or_ordering_unresolved').sort((a, b) => compare(a.targetWeaponId, b.targetWeaponId))
  const selections: Phase2C26B2B2A2Selection[] = []
  for (const row of selected) {
    const at = row.targetWeaponId
    const rowIssues: string[] = []
    if (row.searchStatus !== 'consumer_stop') rowIssues.push(`${at}: search.status ${String(row.searchStatus)} is not consumer_stop`)
    if (row.delivered !== prefix || row.candidates.length !== prefix) rowIssues.push(`${at}: delivered ${String(row.delivered)} / recorded ${row.candidates.length} is not ${prefix}`)
    if (row.coverage !== 'uncovered') rowIssues.push(`${at}: coverage ${String(row.coverage)} is not uncovered`)
    if (row.exactDeliveryIndexes.length > 0 || row.partialDeliveryIndexes.length > 0) rowIssues.push(`${at}: an exact / partial delivery index is recorded`)
    if (row.candidates.some((c, i) => i > 0 && c.estimatedOperationCount < row.candidates[i - 1]!.estimatedOperationCount)) rowIssues.push(`${at}: the delivered operation costs are not nondecreasing`)
    if (row.candidates.some(c => !c.respectsReservation)) rowIssues.push(`${at}: a prior delivery violates the reservation`)
    const boundary = row.candidates[prefix - 1]
    if (!boundary) rowIssues.push(`${at}: no delivery at index ${prefix - 1}`)
    issues.push(...rowIssues)
    if (rowIssues.length > 0 || !boundary) continue
    selections.push({ targetWeaponId: row.targetWeaponId, b2b2aTaskId: row.taskId, fixedSetId: row.fixedSetId, cardinality: row.cardinality, reservationDigest: row.reservationDigest,
      searchInputDigest: row.searchInputDigest, boundaryCost: boundary.estimatedOperationCount, priorPrefix: row.candidates.map(c => ({ ...c })) })
  }
  const expected = PHASE2C26B2B2A2_REGISTERED_B2B2A.all.capture_or_ordering_unresolved
  if (selected.length !== expected) issues.push(`the selection holds ${selected.length} Targets, not ${expected}`)
  return { valid: issues.length === 0, issues, selections }
}

// ---------------------------------------------------------------- reconstruction against the B2-B2A row

/**
 * The rebuilt context against the B2-B2A row itself (the B2-B1 representative comparison is the unchanged
 * `comparePhase2C26B2B2AReconstruction()`): fixed set, fixed Targets, cardinality, group, reservation digest and range form,
 * search-input digest, the excluded current Route key SHA-256 and the extent.
 */
export function comparePhase2C26B2B2A2RowReconstruction(context: Phase2C26B2B2AContext, row: Phase2C26B2B2A2AuthorityRow, sha: (value: string) => string,
  reservationRanges: (context: Phase2C26B2B2AContext) => unknown): { targetWeaponId: string; matches: boolean; mismatches: string[] } {
  const mismatches: string[] = []
  if (context.targetWeaponId !== row.targetWeaponId) mismatches.push('targetWeaponId')
  if (context.fixedSetId !== row.fixedSetId) mismatches.push('fixedSetId')
  if (!same(context.fixedTargetWeaponIds, row.fixedTargetWeaponIds)) mismatches.push('fixedTargetWeaponIds')
  if (context.cardinality !== row.cardinality) mismatches.push('cardinality')
  if (context.groupIndex !== row.groupIndex) mismatches.push('groupIndex')
  if (context.reservationDigest !== row.reservationDigest) mismatches.push('reservationDigest')
  if (!same(reservationRanges(context), row.reservation)) mismatches.push('reservation')
  if (context.searchInputDigest !== row.searchInputDigest) mismatches.push('searchInputDigest')
  if (context.excludedRouteKeys.length !== 1 || sha(context.excludedRouteKeys[0]!) !== row.excludedRouteKeySha256) mismatches.push('excludedRouteKey')
  if (!same(context.extent, row.extent) || !same(context.extent, { ...defaultPlannerAlternativeSearchExtent })) mismatches.push('extent')
  return { targetWeaponId: row.targetWeaponId, matches: mismatches.length === 0, mismatches }
}

// ---------------------------------------------------------------- one Search task (child calculation)

/**
 * What a Search child receives. No oracle field exists here: the Target, the fixed-set selector, the expected Production
 * digests (to fail closed on a drift), the boundary cost and the safety cap.
 */
export interface Phase2C26B2B2A2TaskInput {
  taskId: string
  executionClass: Phase2C26B2B2A2ExecutionClass
  targetWeaponId: string
  fixedSetId: string
  cardinality: number
  reservationDigest: string
  searchInputDigest: string
  boundaryCost: number
  cohortSafetyCap: number
}

export function phase2c26b2b2a2TaskInput(taskId: string, executionClass: Phase2C26B2B2A2ExecutionClass, context: Phase2C26B2B2AContext, boundaryCost: number): Phase2C26B2B2A2TaskInput {
  return { taskId, executionClass, targetWeaponId: context.targetWeaponId, fixedSetId: context.fixedSetId, cardinality: context.cardinality,
    reservationDigest: context.reservationDigest, searchInputDigest: context.searchInputDigest, boundaryCost, cohortSafetyCap: PHASE2C26B2B2A2_COHORT_SAFETY_CAP }
}

/** The six `compareConstrainedCandidates()` keys of one Candidate, as that comparator reads them. */
export interface Phase2C26B2B2A2OrderingKeys {
  estimatedOperationCount: number
  estimatedGogmaAdvance: number
  estimatedSkillAdvance: number
  estimatedNormalAdvance: number | null
  /** `preferredSourceRank(route.sourceOwnedWeaponId, Target preferredOwnedWeaponId)`. */
  preferredSourceRank: number
}

export interface Phase2C26B2B2A2DeliveredCandidate {
  /** 0-based delivery index in this context. */
  deliveryIndex: number
  stableKey: string
  orderingKeys: Phase2C26B2B2A2OrderingKeys
  /**
   * `Math.sign(compareConstrainedCandidates(previous, this, preferredOwnedWeaponId))` against the previous delivery (the
   * Search's own comparator); null at index 0.
   */
  comparatorWithPrevious: number | null
  summary: Phase2C2CandidateSummary
  reservationCheck: ReturnType<typeof respectsPhase2C2Reservation>
}

/** How the cohort drain ended. */
export type Phase2C26B2B2A2Termination = 'next_cost_sentinel' | 'cohort_safety_cap' | 'exhausted' | 'stopped_by_extent'

export interface Phase2C26B2B2A2SearchRecord {
  targetWeaponId: string
  fixedSetId: string
  fixedTargetWeaponIds: string[]
  cardinality: number
  reservationDigest: string
  searchInputDigest: string
  extent: PlannerAlternativeSearchExtent
  excludedRouteKeys: string[]
  preferredOwnedWeaponId: string | null
  boundaryCost: number
  cohortSafetyCap: number
  status: Phase2C2SearchStatus
  summary: { deliveredCandidates: number; excludedCandidates: number; exhausted: boolean; stoppedByExtent: boolean; stoppedByConsumer: boolean }
  /** Every delivery costing at most the boundary cost, in delivery order (the sentinel is never one). */
  cohort: Phase2C26B2B2A2DeliveredCandidate[]
  /** The first delivery costing more than the boundary cost, or null. */
  nextCostSentinel: Phase2C26B2B2A2DeliveredCandidate | null
  termination: Phase2C26B2B2A2Termination
  /** True only for a sentinel or a natural Search end; a safety-cap stop never drains the cohort. */
  cohortDrained: boolean
  safetyCapHit: boolean
  /** `candidate.estimatedOperationCount` differs from the summary's (should never happen). */
  costReadIssues: number[]
  elapsedMs: number
}

export type Phase2C26B2B2A2ChildRecord =
  | { status: 'searched'; taskId: string; executionClass: Phase2C26B2B2A2ExecutionClass; search: Phase2C26B2B2A2SearchRecord }
  /** The re-derived context is not the planned one: a semantic failure, never a Candidate count. */
  | { status: 'context_mismatch'; taskId: string; executionClass: Phase2C26B2B2A2ExecutionClass; issues: string[] }

/**
 * The cohort drain of one context: `visitPlannerAlternativeCandidates()` with exactly the Planner-start origin, the
 * snapshot reservation, the excluded current Route key and the Production default extent. The consumer continues while a
 * delivery costs at most `boundaryCost`, stops at the first delivery costing more (recorded as the next-cost sentinel,
 * outside the cohort), and stops at the safety cap. Nothing else stops it. Each delivery is materialized by the Planner
 * Alternative materializer of this very context only to read its Route units (the Phase 2-C2 summary and reservation
 * check); its six ordering keys and the Search comparator against the previous delivery are recorded as read.
 */
export async function runPhase2C26B2B2A2Search(input: PlannerInput, context: Phase2C26B2B2AContext, engine: RngEngine, bounds: { boundaryCost: number; cohortSafetyCap: number },
  options: { yieldControl?: () => Promise<void>; now?: () => number } = {}): Promise<Phase2C26B2B2A2SearchRecord> {
  const { boundaryCost, cohortSafetyCap } = bounds
  if (cohortSafetyCap !== PHASE2C26B2B2A2_COHORT_SAFETY_CAP) throw new Error(`The B2-B2A2 cohort safety cap is ${PHASE2C26B2B2A2_COHORT_SAFETY_CAP}, not ${cohortSafetyCap}.`)
  if (!Number.isInteger(boundaryCost) || boundaryCost < 0) throw new Error(`The boundary cost ${boundaryCost} is not a non-negative integer.`)
  if (!same(context.extent, { ...defaultPlannerAlternativeSearchExtent })) throw new Error('B2-B2A2 searches the Production default extent only.')
  const now = options.now ?? (() => performance.now())
  const started = now()
  const origin = createPlannerStartSearchOrigin(input)
  if (hashStableValue(origin) !== context.originDigest) throw new Error('The Planner-start origin does not hash to the context origin digest.')
  const target = origin.targetWeapons.find(t => t.id === context.targetWeaponId)
  if (!target) throw new Error('The Planner-start origin does not hold the Target.')
  const preferredOwnedWeaponId = target.preferredOwnedWeaponId ?? null
  const searchInput = { origin, targetWeaponId: context.targetWeaponId as never, extent: { ...context.extent }, reservation: context.reservation, excludedRouteKeys: context.excludedRouteKeys }
  const materializer = createPlannerAlternativeMaterializer({ ...searchInput, clock: { now: () => GLOBAL_RESEARCH_TIME } })
  const cohort: Phase2C26B2B2A2DeliveredCandidate[] = []
  const costReadIssues: number[] = []
  let nextCostSentinel: Phase2C26B2B2A2DeliveredCandidate | null = null
  let previous: PlannerAlternativeCandidate | null = null
  let safetyCapHit = false
  const execution = await visitPlannerAlternativeCandidates(searchInput, engine, (candidate: PlannerAlternativeCandidate) => {
    const deliveryIndex = cohort.length
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
    if (candidate.estimatedOperationCount > boundaryCost) {
      nextCostSentinel = delivered
      return 'stop'
    }
    cohort.push(delivered)
    if (cohort.length >= cohortSafetyCap) safetyCapHit = true
    return safetyCapHit ? 'stop' : 'continue'
  }, { yieldControl: options.yieldControl })
  const status = phase2c2SearchStatus(execution.summary, execution.stoppedByConsumer)
  const sentinel = nextCostSentinel as Phase2C26B2B2A2DeliveredCandidate | null
  const termination: Phase2C26B2B2A2Termination = sentinel !== null ? 'next_cost_sentinel' : safetyCapHit ? 'cohort_safety_cap' : status === 'stopped_by_extent' ? 'stopped_by_extent' : 'exhausted'
  if (status === 'consumer_stop' && termination !== 'next_cost_sentinel' && termination !== 'cohort_safety_cap') throw new Error('A consumer stop without a sentinel or the safety cap.')
  return {
    targetWeaponId: context.targetWeaponId, fixedSetId: context.fixedSetId, fixedTargetWeaponIds: [...context.fixedTargetWeaponIds], cardinality: context.cardinality,
    reservationDigest: context.reservationDigest, searchInputDigest: context.searchInputDigest, extent: { ...context.extent }, excludedRouteKeys: [...context.excludedRouteKeys],
    preferredOwnedWeaponId, boundaryCost, cohortSafetyCap, status,
    summary: { deliveredCandidates: execution.summary.deliveredCandidates, excludedCandidates: execution.summary.excludedCandidates, exhausted: execution.summary.exhausted,
      stoppedByExtent: execution.summary.stoppedByExtent, stoppedByConsumer: execution.stoppedByConsumer },
    cohort, nextCostSentinel: sentinel, termination, cohortDrained: termination !== 'cohort_safety_cap', safetyCapHit, costReadIssues, elapsedMs: now() - started,
  }
}

/** The child calculation: rebuild the context from the snapshot, fail closed on any drift from the task, then drain. */
export async function runPhase2C26B2B2A2Task(input: PlannerInput, snapshot: Phase2C26B2B1Snapshot, task: Phase2C26B2B2A2TaskInput, engine: RngEngine,
  options: { yieldControl?: () => Promise<void>; now?: () => number } = {}): Promise<Phase2C26B2B2A2ChildRecord> {
  const rebuilt = reconstructPhase2C26B2B2AContext(snapshot, task)
  if (!rebuilt.valid) return { status: 'context_mismatch', taskId: task.taskId, executionClass: task.executionClass, issues: rebuilt.issues }
  const issues: string[] = []
  if (rebuilt.context.searchInputDigest !== task.searchInputDigest) issues.push('searchInputDigest')
  if (rebuilt.context.reservationDigest !== task.reservationDigest) issues.push('reservationDigest')
  if (issues.length > 0) return { status: 'context_mismatch', taskId: task.taskId, executionClass: task.executionClass, issues }
  const search = await runPhase2C26B2B2A2Search(input, rebuilt.context, engine, { boundaryCost: task.boundaryCost, cohortSafetyCap: task.cohortSafetyCap }, options)
  return { status: 'searched', taskId: task.taskId, executionClass: task.executionClass, search }
}

// ---------------------------------------------------------------- task outcomes

export interface Phase2C26B2B2A2TaskOutcome {
  taskId: string
  executionClass: Phase2C26B2B2A2ExecutionClass
  process: Phase2C2ChildOutcome
  record: 'searched' | 'context_mismatch' | null
  searchStatus: Phase2C2SearchStatus | null
  termination: Phase2C26B2B2A2Termination | null
  cohortCandidates: number | null
}

/** A timeout / out-of-memory / failure is that failure, never "no Candidate"; a completed child without a record is a failure. */
export function phase2c26b2b2a2TaskOutcome(taskId: string, executionClass: Phase2C26B2B2A2ExecutionClass, process: Phase2C2ChildOutcome, record: Phase2C26B2B2A2ChildRecord | null): Phase2C26B2B2A2TaskOutcome {
  const none = { searchStatus: null, termination: null, cohortCandidates: null }
  if (process !== 'completed' || record === null) return { taskId, executionClass, process: process === 'completed' ? 'process_failure' : process, record: null, ...none }
  if (record.status === 'context_mismatch') return { taskId, executionClass, process, record: 'context_mismatch', ...none }
  return { taskId, executionClass, process, record: 'searched', searchStatus: record.search.status, termination: record.search.termination, cohortCandidates: record.search.cohort.length }
}

/** The registered fallback trigger: a Stage 1 timeout, and nothing else. */
export function phase2c26b2b2a2NeedsFallback(stage1: Pick<Phase2C26B2B2A2TaskOutcome, 'process'>): boolean {
  return stage1.process === 'timeout'
}
