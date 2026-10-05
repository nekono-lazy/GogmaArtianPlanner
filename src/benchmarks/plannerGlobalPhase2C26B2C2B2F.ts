/**
 * Issue #154 Phase 2-C2.6-B2-C2B2F: outer runtime profiling of the one B2-C2B2E time-bound Target (the Target whose B2-C2B2E
 * 60-minute / 12 GB task timed out with its heap on a plateau), searched again in EXACTLY B2-C2B2E's Search input. Research
 * only and profiling only: it asks which Search runtime section dominates that Search's wall time on the current main, never
 * whether the Search delivers the oracle Route. Never import from Production.
 *
 * Compared with B2-C2B2E exactly two things change, and neither reaches the Search semantics:
 *
 * ```text
 * budget         60 minutes (3,600,000 ms) -> 30 minutes (1,800,000 ms)   (a profiling budget, not a completion attempt)
 * instrumentation none                      -> PlannerAlternativeSearchInstrumentation.onSearchRuntime only
 * ```
 *
 * The heap (12,288 MB), concurrency 1, fresh child, setImmediate yield, 250 ms memory sampling, no retry and no fallback are
 * B2-C2B2E's. The task is B2-C2B2E's: B2-C2B2E's `buildPhase2C26B2C2B2ETasks()` over the one probe (Target, B2-C2B2E task ID,
 * P1 rank, tight extent), and its Search input identity (group, reservation, representative, default / tight Search input digest)
 * must equal the B2-C2B2E task row before any Search runs. The child calculation `runPhase2C26B2C2B2FTask()` /
 * `runPhase2C26B2C2B2FSearch()` is B2-C2B2D's `runPhase2C26B2C2B2DTask()` / `runPhase2C26B2C2B2DSearch()` line for line (a test fixes
 * it) except that it hands `visitPlannerAlternativeCandidates()` the section boundary observer as its only instrumentation; the
 * Search input, the C4C capture, the safety cap 1024 and every stop rule are unchanged.
 *
 * The observer is the Phase 2-C2.6-A4 stack tracker (`createPhase2C26A4RuntimeTracker()`), reused unchanged: the Search reports
 * section boundaries with no clock, the Research child stamps them with its own `now()`, keeps inclusive and exclusive time per
 * section (exclusive = inclusive minus the children) and checks the registered hierarchy. Nothing the observer returns is read by
 * the Search. On top of it this module adds, Research-side only, an open-section mirror used to attribute each Research yield
 * wait to the innermost open section, and per-stream depth facts read from the counts the Search already reports.
 *
 * The Search side never receives an oracle Route, a stable key, an expected Candidate index / operation cost, an expected
 * bottleneck or section, or any B2-C2B2E measurement.
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
} from '../domain/search'
import type { SearchRuntimeDepthCounts, SearchRuntimeEvent, SearchRuntimeObserver, SearchRuntimeSection } from '../domain/search/searchRuntime'
import { preferredSourceRank } from '../domain/search/semanticKeys'
import { GLOBAL_RESEARCH_TIME } from './plannerGlobalOptimizationResearch'
import { phase2c2SearchStatus, respectsPhase2C2Reservation, summarizePhase2C2Entry } from './plannerGlobalPhase2C2'
import {
  createPhase2C26A4RuntimeTracker,
  PHASE2C26A4_SEARCH_INSTRUMENTATION,
  type Phase2C26A4RuntimeSnapshot,
} from './plannerGlobalPhase2C26A4'
import { reconstructPhase2C26B2B2AContext } from './plannerGlobalPhase2C26B2B2A'
import type { Phase2C26B2B2A2DeliveredCandidate } from './plannerGlobalPhase2C26B2B2A2'
import type { Phase2C26B2C1ContextRow, Phase2C26B2C1Schedule } from './plannerGlobalPhase2C26B2C1'
import { createPhase2C26B2C2ACapture, type Phase2C26B2C2ATermination } from './plannerGlobalPhase2C26B2C2A'
import {
  phase2c26b2c2b2dExtentBoundIssues,
  phase2c26b2c2b2dPolicyDrift,
  phase2c26b2c2b2dTightContext,
  PHASE2C26B2C2B2D_CANDIDATE_SAFETY_CAP,
  PHASE2C26B2C2B2D_MAX_COST_COHORTS,
  type Phase2C26B2C2B2DChildRecord,
  type Phase2C26B2C2B2DContext,
  type Phase2C26B2C2B2DSearchRecord,
  type Phase2C26B2C2B2DTaskInput,
} from './plannerGlobalPhase2C26B2C2B2D'
import {
  buildPhase2C26B2C2B2ETasks,
  phase2c26b2c2b2eExtentBoundIssues,
  phase2c26b2c2b2eTaskOutcome,
  PHASE2C26B2C2B2E_CANDIDATE_SAFETY_CAP,
  PHASE2C26B2C2B2E_CAPTURE_PREFIXES,
  PHASE2C26B2C2B2E_CONTEXT_SELECTION,
  PHASE2C26B2C2B2E_EXTENT_RULE,
  PHASE2C26B2C2B2E_MAX_COST_COHORTS,
  PHASE2C26B2C2B2E_MEMORY_SAMPLE_INTERVAL_MS,
  PHASE2C26B2C2B2E_NODE_YIELD,
  PHASE2C26B2C2B2E_PROVENANCE_FLAGS,
  PHASE2C26B2C2B2E_REGISTERED_P1,
  PHASE2C26B2C2B2E_STAGE1,
  PHASE2C26B2C2B2E_TASKS_BUDGET_MS,
  type Phase2C26B2C2B2EProbe,
  type Phase2C26B2C2B2ETaskInput,
} from './plannerGlobalPhase2C26B2C2B2E'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}

// ---------------------------------------------------------------- Research execution conditions (registered, not Production defaults)

/** The population size: the B2-C2B2E branch-C Targets of type time_bound whose B2-C2B2E task timed out (counted; the ID comes from the manifest). */
export const PHASE2C26B2C2B2F_TARGETS = 1
export const PHASE2C26B2C2B2F_CONTEXTS_PER_TARGET = 1
export const PHASE2C26B2C2B2F_EXPECTED_TASKS = PHASE2C26B2C2B2F_TARGETS * PHASE2C26B2C2B2F_CONTEXTS_PER_TARGET
/** The B2-C2B2E Stage 1 this phase profiles under (60 minutes, 12,288 MB). */
export const PHASE2C26B2C2B2F_B2C2B2E_STAGE1 = PHASE2C26B2C2B2E_STAGE1
/** The profiling budget: 30 minutes. Never 60 minutes or more in this phase, and never an automatic retry at a longer budget. */
export const PHASE2C26B2C2B2F_BUDGET_MS = 1_800_000
/** B2-C2B2E's child heap, unchanged. */
export const PHASE2C26B2C2B2F_CHILD_HEAP_MB = PHASE2C26B2C2B2E_STAGE1.childHeapMb
/** Stage 1: B2-C2B2E's with the budget alone shortened to the profiling budget (fresh child, concurrency 1, no retry, no fallback). */
export const PHASE2C26B2C2B2F_STAGE1 = Object.freeze({ ...PHASE2C26B2C2B2E_STAGE1, budgetMs: PHASE2C26B2C2B2F_BUDGET_MS }) as
  { readonly executionClass: 'stage1'; readonly childHeapMb: number; readonly concurrency: number; readonly budgetMs: number; readonly retry: 'none'; readonly fallback: 'none' }
/** The only intended difference from B2-C2B2E's Stage 1 (the analyzer checks every other field is equal). */
export const PHASE2C26B2C2B2F_CHANGED_STAGE1_FIELDS = ['budgetMs'] as const
/** B2-C2B2E's tasks child budget, capture, safety cap, prefixes, yield, sampling, context selection, extent rule and P1, unchanged. */
export const PHASE2C26B2C2B2F_TASKS_BUDGET_MS = PHASE2C26B2C2B2E_TASKS_BUDGET_MS
export const PHASE2C26B2C2B2F_MAX_COST_COHORTS = PHASE2C26B2C2B2E_MAX_COST_COHORTS
export const PHASE2C26B2C2B2F_CANDIDATE_SAFETY_CAP = PHASE2C26B2C2B2E_CANDIDATE_SAFETY_CAP
export const PHASE2C26B2C2B2F_CAPTURE_PREFIXES = PHASE2C26B2C2B2E_CAPTURE_PREFIXES
export const PHASE2C26B2C2B2F_NODE_YIELD = PHASE2C26B2C2B2E_NODE_YIELD
export const PHASE2C26B2C2B2F_MEMORY_SAMPLE_INTERVAL_MS = PHASE2C26B2C2B2E_MEMORY_SAMPLE_INTERVAL_MS
export const PHASE2C26B2C2B2F_CONTEXT_SELECTION = PHASE2C26B2C2B2E_CONTEXT_SELECTION
export const PHASE2C26B2C2B2F_EXTENT_RULE = PHASE2C26B2C2B2E_EXTENT_RULE
export const PHASE2C26B2C2B2F_REGISTERED_P1 = PHASE2C26B2C2B2E_REGISTERED_P1
/** The only Search instrumentation the profiled child attaches: A4's (onSearchRuntime alone; no A3 / A7 / A8 observer, no V8 CPU profiler). */
export const PHASE2C26B2C2B2F_SEARCH_INSTRUMENTATION = PHASE2C26A4_SEARCH_INSTRUMENTATION
export const PHASE2C26B2C2B2F_CPU_PROFILER = false
/** How often the child writes its cumulative profile durably (a budget kill loses at most this tail). */
export const PHASE2C26B2C2B2F_HEARTBEAT_INTERVAL_MS = 5_000
/** The descriptive time windows (Search elapsed), each written durably at its boundary. */
export const PHASE2C26B2C2B2F_WINDOWS_MS = [[0, 600_000], [600_000, 1_200_000], [1_200_000, 1_800_000]] as const
/** Provenance: B2-C2B2E's (the same oracle-guided Search input), plus what this phase adds. */
export const PHASE2C26B2C2B2F_PROVENANCE_FLAGS = {
  ...PHASE2C26B2C2B2E_PROVENANCE_FLAGS,
  oracleGuidedProfilingTarget: true,
  routeExactJudged: false,
  profilingOnly: true,
} as const
/** What B2-C2B2F deliberately does not run. */
export const PHASE2C26B2C2B2F_NOT_RUN = ['production_change', 'production_optimization', 'search_semantics_change', 'search_ordering_change', 'search_comparator_change',
  'candidate_materializer_change', 'capture_change', 'extent_change', 'context_change', 'p1_change', 'heap_16gb_retry', 'budget_60min_or_more', 'automatic_longer_retry', 'retry',
  'timeout_fallback', 'oom_fallback', 'v8_cpu_profiler', 'a3_section_observer', 'reserved_depth_observer', 'exact_route_judgement', 'e2_search', 'k2_feature_grouping',
  'residual_unreached_support', 'global_assignment', 'full_planner_rerun', 'ui_change', 'a3_a9_result_regeneration', 'b2c2b2e_result_regeneration', 'heap_growth_target_rerun'] as const

// ---------------------------------------------------------------- the probe manifest (a Search input)

/** The Search input identity the constructed task must hold (B2-C2B2E's task row): input digests, never an outcome. */
export interface Phase2C26B2C2B2FTaskIdentity {
  taskId: string
  targetWeaponId: string
  contextRank: number
  groupIndex: number
  reservationDigest: string
  targetEligibleMinCardinality: number
  representativeFixedSetId: string
  representativeFixedTargetWeaponIds: string[]
  defaultSearchInputDigest: string
  searchInputDigest: string
  extent: { maxNormalAdvance: number; maxGogmaAdvance: number; maxSkillAdvance: number }
}
export const PHASE2C26B2C2B2F_IDENTITY_FIELDS = ['taskId', 'targetWeaponId', 'contextRank', 'groupIndex', 'reservationDigest', 'targetEligibleMinCardinality', 'representativeFixedSetId',
  'representativeFixedTargetWeaponIds', 'defaultSearchInputDigest', 'searchInputDigest', 'extent'] as const

export const PHASE2C26B2C2B2F_POPULATION = 'B2C2B2E_BRANCH_C_TIME_BOUND_TIMEOUT'

export interface Phase2C26B2C2B2FProbeManifest {
  phase: string
  /** The B2-C2B2E RESULT the population, probe and identity were derived from (the Search never reads it). */
  b2c2b2eResultSha256: string
  population: typeof PHASE2C26B2C2B2F_POPULATION
  policy: 'P1'
  contextSelection: typeof PHASE2C26B2C2B2F_CONTEXT_SELECTION.id
  extentRule: typeof PHASE2C26B2C2B2F_EXTENT_RULE.id
  exportSha256: string
  /** B2-C2B2E's probe shape (Target, B2-C2B2E task ID in its `b2c2b2dTaskId` field, P1 rank, tight extent). */
  probes: Phase2C26B2C2B2EProbe[]
  expectedTaskIdentities: Phase2C26B2C2B2FTaskIdentity[]
}

const MANIFEST_KEYS = ['b2c2b2eResultSha256', 'contextSelection', 'expectedTaskIdentities', 'exportSha256', 'extentRule', 'phase', 'policy', 'population', 'probes']
const PROBE_KEYS = ['b2c2b2dTaskId', 'contextRank', 'extent', 'targetWeaponId']
const IDENTITY_KEYS = [...PHASE2C26B2C2B2F_IDENTITY_FIELDS].sort()
const SHA256 = /^[0-9a-f]{64}$/
const TASK_ID = /^t(\d{2})-r(\d{2})$/

/**
 * Reads a probe manifest as untrusted JSON: exactly the manifest keys; exactly one probe (Target / task ID / P1 rank / tight
 * extent, nothing else) and exactly one expected task identity (the identity fields, nothing else) naming the same Target, task,
 * rank and extent; a task ID of B2-C2B2D / B2-C2B2E shape naming its own rank; an extent inside B2-C2B2D's bounds; the registered
 * population, policy, context selection and extent rule. No expected key / index / cost / outcome / measurement may ride along.
 */
export function parsePhase2C26B2C2B2FProbeManifest(json: unknown): { valid: boolean; issues: string[]; manifest: Phase2C26B2C2B2FProbeManifest | null } {
  const issues: string[] = []
  if (!isObject(json)) return { valid: false, issues: ['the probe manifest is not an object'], manifest: null }
  if (!same(Object.keys(json).sort(), MANIFEST_KEYS)) issues.push(`the probe manifest keys are not exactly ${MANIFEST_KEYS.join(', ')}`)
  if (json.population !== PHASE2C26B2C2B2F_POPULATION) issues.push(`population is not ${PHASE2C26B2C2B2F_POPULATION}`)
  if (json.policy !== 'P1') issues.push('policy is not P1')
  if (json.contextSelection !== PHASE2C26B2C2B2F_CONTEXT_SELECTION.id) issues.push('contextSelection is not the registered context selection')
  if (json.extentRule !== PHASE2C26B2C2B2F_EXTENT_RULE.id) issues.push('extentRule is not the registered extent rule')
  if (typeof json.exportSha256 !== 'string' || !SHA256.test(json.exportSha256)) issues.push('exportSha256 is not a SHA-256')
  if (typeof json.b2c2b2eResultSha256 !== 'string' || !SHA256.test(json.b2c2b2eResultSha256)) issues.push('b2c2b2eResultSha256 is not a SHA-256')
  if (typeof json.phase !== 'string') issues.push('phase is not a string')
  const probes: Phase2C26B2C2B2EProbe[] = []
  const identities: Phase2C26B2C2B2FTaskIdentity[] = []
  if (!Array.isArray(json.probes) || json.probes.length !== PHASE2C26B2C2B2F_EXPECTED_TASKS) issues.push(`probes is not a list of ${PHASE2C26B2C2B2F_EXPECTED_TASKS}`)
  else {
    for (const raw of json.probes as unknown[]) {
      if (!isObject(raw) || !same(Object.keys(raw).sort(), PROBE_KEYS)) { issues.push(`a probe's keys are not exactly ${PROBE_KEYS.join(', ')}`); continue }
      if (typeof raw.targetWeaponId !== 'string' || raw.targetWeaponId.length === 0) { issues.push('a probe has no Target ID'); continue }
      if (!Number.isSafeInteger(raw.contextRank) || (raw.contextRank as number) < 1) { issues.push('a probe rank is not a positive integer'); continue }
      const id = typeof raw.b2c2b2dTaskId === 'string' ? TASK_ID.exec(raw.b2c2b2dTaskId) : null
      if (id === null || Number(id[2]) !== raw.contextRank) { issues.push('a probe task ID is not t<index>-r<its own rank>'); continue }
      const bound = phase2c26b2c2b2eExtentBoundIssues(raw.extent)
      if (bound.length > 0) { issues.push(...bound); continue }
      const extent = raw.extent as Json
      probes.push({ targetWeaponId: raw.targetWeaponId, b2c2b2dTaskId: raw.b2c2b2dTaskId as string, contextRank: raw.contextRank as number,
        extent: { maxNormalAdvance: extent.maxNormalAdvance as number, maxGogmaAdvance: extent.maxGogmaAdvance as number, maxSkillAdvance: extent.maxSkillAdvance as number } })
    }
  }
  if (!Array.isArray(json.expectedTaskIdentities) || json.expectedTaskIdentities.length !== PHASE2C26B2C2B2F_EXPECTED_TASKS) issues.push(`expectedTaskIdentities is not a list of ${PHASE2C26B2C2B2F_EXPECTED_TASKS}`)
  else {
    for (const raw of json.expectedTaskIdentities as unknown[]) {
      if (!isObject(raw) || !same(Object.keys(raw).sort(), IDENTITY_KEYS)) { issues.push(`an expected task identity's keys are not exactly ${IDENTITY_KEYS.join(', ')}`); continue }
      const strings = ['taskId', 'targetWeaponId', 'reservationDigest', 'representativeFixedSetId', 'defaultSearchInputDigest', 'searchInputDigest'] as const
      if (strings.some(k => typeof raw[k] !== 'string' || (raw[k] as string).length === 0)) { issues.push('an expected task identity string field is not a string'); continue }
      if (!['contextRank', 'groupIndex', 'targetEligibleMinCardinality'].every(k => Number.isSafeInteger(raw[k]))) { issues.push('an expected task identity integer field is not an integer'); continue }
      if (!Array.isArray(raw.representativeFixedTargetWeaponIds) || !raw.representativeFixedTargetWeaponIds.every(v => typeof v === 'string')) { issues.push('representativeFixedTargetWeaponIds is not a string list'); continue }
      if (phase2c26b2c2b2eExtentBoundIssues(raw.extent).length > 0) { issues.push('an expected task identity extent is out of bounds'); continue }
      identities.push(structuredClone(raw) as unknown as Phase2C26B2C2B2FTaskIdentity)
    }
  }
  probes.forEach((probe, index) => {
    const identity = identities[index]
    if (!identity || identity.taskId !== probe.b2c2b2dTaskId || identity.targetWeaponId !== probe.targetWeaponId || identity.contextRank !== probe.contextRank || !same(identity.extent, probe.extent)) {
      issues.push('the expected task identity does not name the probe')
    }
  })
  if (issues.length > 0) return { valid: false, issues, manifest: null }
  return { valid: true, issues: [], manifest: { phase: String(json.phase), b2c2b2eResultSha256: String(json.b2c2b2eResultSha256), population: PHASE2C26B2C2B2F_POPULATION, policy: 'P1',
    contextSelection: PHASE2C26B2C2B2F_CONTEXT_SELECTION.id, extentRule: PHASE2C26B2C2B2F_EXTENT_RULE.id, exportSha256: String(json.exportSha256), probes, expectedTaskIdentities: identities } }
}

// ---------------------------------------------------------------- task construction (B2-C2B2E's, gated by the expected identity)

export type Phase2C26B2C2B2FTaskInput = Phase2C26B2C2B2ETaskInput

/** The identity fields of a constructed task. */
export const phase2c26b2c2b2fTaskIdentity = (task: Phase2C26B2C2B2FTaskInput): Phase2C26B2C2B2FTaskIdentity =>
  Object.fromEntries(PHASE2C26B2C2B2F_IDENTITY_FIELDS.map(field => [field, structuredClone(task[field])])) as unknown as Phase2C26B2C2B2FTaskIdentity

/**
 * B2-C2B2E's `buildPhase2C26B2C2B2ETasks()` over the manifest probe (so B2-C2B2D's unchanged construction), then every identity
 * field of the task compared with the expected B2-C2B2E task identity. Any construction issue or identity drift fails closed with
 * no task.
 */
export function buildPhase2C26B2C2B2FTasks(schedule: Phase2C26B2C1Schedule, manifest: Pick<Phase2C26B2C2B2FProbeManifest, 'probes' | 'expectedTaskIdentities'>):
  { valid: boolean; issues: string[]; tasks: Phase2C26B2C2B2FTaskInput[] } {
  const built = buildPhase2C26B2C2B2ETasks(schedule, manifest.probes)
  const issues = [...built.issues]
  if (built.valid && built.tasks.length !== PHASE2C26B2C2B2F_EXPECTED_TASKS) issues.push(`${built.tasks.length} tasks, not ${PHASE2C26B2C2B2F_EXPECTED_TASKS}`)
  built.tasks.forEach((task, index) => {
    const expected = manifest.expectedTaskIdentities[index]
    if (!expected) { issues.push(`${task.taskId}: no expected task identity`); return }
    const actual = phase2c26b2c2b2fTaskIdentity(task)
    for (const field of PHASE2C26B2C2B2F_IDENTITY_FIELDS) if (!same(actual[field], expected[field])) issues.push(`${task.taskId}: ${field} is not the B2-C2B2E task's`)
  })
  return { valid: issues.length === 0, issues, tasks: issues.length === 0 ? built.tasks : [] }
}

// ---------------------------------------------------------------- the profiled child calculation (B2-C2B2D's, line for line)

/** The execution options of the profiled child: B2-C2B2D's plus the section boundary observer as the only Search instrumentation. */
export interface Phase2C26B2C2B2FSearchOptions {
  yieldControl?: () => Promise<void>
  now?: () => number
  instrumentation?: { onSearchRuntime: SearchRuntimeObserver }
}

const selectorOf = (row: Pick<Phase2C26B2C1ContextRow, 'targetWeaponId' | 'representativeFixedSetId' | 'targetEligibleMinCardinality' | 'reservationDigest'>) =>
  ({ targetWeaponId: row.targetWeaponId, fixedSetId: row.representativeFixedSetId, cardinality: row.targetEligibleMinCardinality, reservationDigest: row.reservationDigest })

/**
 * B2-C2B2D's `runPhase2C26B2C2B2DSearch()` line for line; the one difference is that the section boundary observer (when given)
 * is handed to `visitPlannerAlternativeCandidates()` as its only instrumentation. The Search input, the capture and every stop
 * rule are B2-C2B2D's.
 */
export async function runPhase2C26B2C2B2FSearch(input: PlannerInput, context: Phase2C26B2C2B2DContext, engine: RngEngine, capture: { maxCostCohorts: number; candidateSafetyCap: number },
  provenance: { contextRank: number; targetEligibleMinCardinality: number; representativeFixedSetId: string; representativeFixedTargetWeaponIds: string[] },
  options: Phase2C26B2C2B2FSearchOptions = {}): Promise<Phase2C26B2C2B2DSearchRecord> {
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
  }, options.instrumentation === undefined ? { yieldControl: options.yieldControl } : { yieldControl: options.yieldControl, instrumentation: { onSearchRuntime: options.instrumentation.onSearchRuntime } })
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

/**
 * B2-C2B2D's `runPhase2C26B2C2B2DTask()` line for line (policy check, task extent bounds, the one schedule row of this Target at
 * this P1 rank compared with every task field, the unchanged reconstruction, the tight replacement and both digests), calling
 * the profiled Search above. Any drift is a context mismatch and no Search runs.
 */
export async function runPhase2C26B2C2B2FTask(input: PlannerInput, schedule: Phase2C26B2C1Schedule, task: Phase2C26B2C2B2DTaskInput, engine: RngEngine,
  options: Phase2C26B2C2B2FSearchOptions = {}): Promise<Phase2C26B2C2B2DChildRecord> {
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
  const search = await runPhase2C26B2C2B2FSearch(input, tight.context, engine, { maxCostCohorts: task.maxCostCohorts, candidateSafetyCap: task.candidateSafetyCap },
    { contextRank: task.contextRank, targetEligibleMinCardinality: task.targetEligibleMinCardinality, representativeFixedSetId: task.representativeFixedSetId,
      representativeFixedTargetWeaponIds: task.representativeFixedTargetWeaponIds }, options)
  return { status: 'searched', taskId: task.taskId, search }
}

/** A timeout / out-of-memory / failure is that failure, never "no Candidate": B2-C2B2E's (B2-C2B2D's) rule itself. */
export const phase2c26b2c2b2fTaskOutcome = phase2c26b2c2b2eTaskOutcome

// ---------------------------------------------------------------- the Search identity a child attests before it searches

/**
 * The Search input identity of a task as the child itself rebuilds it before searching (no Search runs): the reconstruction and
 * the tight replacement of the task's schedule row, their digests, and the excluded Route keys hashed by `hashKey`. Used so that a
 * run killed at the budget still proves which Search input it searched.
 */
export function phase2c26b2c2b2fChildSearchIdentity(schedule: Phase2C26B2C1Schedule, task: Phase2C26B2C2B2DTaskInput, hashKey: (key: string) => string) {
  const rows = schedule.contexts.filter(c => c.targetWeaponId === task.targetWeaponId && c.ranks.P1 === task.contextRank)
  if (rows.length !== 1) return { valid: false as const, issues: [`P1 rank ${task.contextRank} holds ${rows.length} contexts`] }
  const rebuilt = reconstructPhase2C26B2B2AContext(schedule.snapshot, selectorOf(rows[0]!))
  if (!rebuilt.valid) return { valid: false as const, issues: rebuilt.issues }
  const tight = phase2c26b2c2b2dTightContext(rebuilt.context, task.extent)
  if (!tight.valid) return { valid: false as const, issues: tight.issues }
  const c = tight.context
  return { valid: true as const, issues: [] as string[], taskId: task.taskId, targetWeaponId: c.targetWeaponId, groupIndex: c.groupIndex, reservationDigest: c.reservationDigest,
    defaultSearchInputDigest: c.defaultSearchInputDigest, searchInputDigest: c.searchInputDigest, extent: { ...c.extent }, excludedRouteKeyCount: c.excludedRouteKeys.length,
    excludedRouteIsCurrentRoute: c.excludedRouteKeys.length === 1 && c.excludedRouteKeys[0] === c.currentRouteKey,
    excludedRouteKeySha256s: c.excludedRouteKeys.map(hashKey) }
}

// ---------------------------------------------------------------- the profiler (Research-side observer, A4's tracker reused)

/** Per-stream depth facts, read only from the counts the Search reports on a depth work completion (nothing is scanned). */
export interface Phase2C26B2C2B2FStreamDepthFacts {
  startedWorks: number
  completedWorks: number
  withCounts: number
  channels: number
  maxDepth: number
  subscriberCountSum: number
  retainedCountAfterSum: number
  lastRetainedCountAfter: number | null
  exhaustedWorks: number
}

/** Research yield waits (from the yield call to its resume), attributed to the innermost open Search section at the call. */
export interface Phase2C26B2C2B2FYieldFacts {
  count: number
  totalMs: number
  bySection: Partial<Record<SearchRuntimeSection | 'outside_search', { count: number; totalMs: number }>>
}

export interface Phase2C26B2C2B2FProfileSnapshot {
  kind: 'profile_snapshot'
  reason: 'heartbeat' | 'window_boundary' | 'final'
  seq: number
  /** Research elapsed since the profiler origin (the observation instant). */
  atMs: number
  /** Elapsed since the Search root started (null before it started). */
  searchElapsedMs: number | null
  windowBoundaryMs: number | null
  runtime: Phase2C26A4RuntimeSnapshot
  depth: { bonus: Phase2C26B2C2B2FStreamDepthFacts; skill: Phase2C26B2C2B2FStreamDepthFacts }
  yields: Phase2C26B2C2B2FYieldFacts
  events: number
  searchStartedAtMs: number | null
  searchCompletedAtMs: number | null
}

const zeroStream = (): Phase2C26B2C2B2FStreamDepthFacts => ({ startedWorks: 0, completedWorks: 0, withCounts: 0, channels: 0, maxDepth: 0, subscriberCountSum: 0,
  retainedCountAfterSum: 0, lastRetainedCountAfter: null, exhaustedWorks: 0 })

/**
 * The child-side profiler of one Search. Its `observer` forwards every boundary to an unchanged A4 runtime tracker (target ordinal
 * 0; A4 durable records are not emitted, the cumulative tracker snapshot is) and mirrors the open-section stack to attribute the
 * Research yield waits it measures in `wrapYield()`. It never throws into the Search, returns nothing the Search reads, and reads no
 * Search state. `snapshot()` is cumulative: completed sections plus the open ones up to the observation instant.
 */
export function createPhase2C26B2C2B2FProfiler(options: { now: () => number }) {
  let origin: number | null = null
  let seq = 0
  let events = 0
  let searchStartedAt: number | null = null
  let searchCompletedAt: number | null = null
  const open: SearchRuntimeSection[] = []
  const channelSets = { bonus: new Set<number>(), skill: new Set<number>() }
  const depth = { bonus: zeroStream(), skill: zeroStream() }
  const yields: Phase2C26B2C2B2FYieldFacts = { count: 0, totalMs: 0, bySection: {} }
  const tracker = createPhase2C26A4RuntimeTracker({ now: options.now, origin: () => origin ?? options.now(), emitSectionStarted: () => undefined, emitWorkSummary: () => undefined,
    emitSearchSummary: () => undefined })
  const trackerObserver = tracker.observerForTarget(0)
  const elapsed = () => options.now() - (origin ?? options.now())
  const streamOf = (section: SearchRuntimeSection) => section === 'bonus_depth_work' ? 'bonus' : section === 'skill_depth_work' ? 'skill' : null
  const onCounts = (stream: 'bonus' | 'skill', counts: SearchRuntimeDepthCounts | undefined) => {
    const facts = depth[stream]
    facts.completedWorks += 1
    if (counts === undefined) return
    facts.withCounts += 1
    facts.subscriberCountSum += counts.subscriberCount
    facts.retainedCountAfterSum += counts.retainedCountAfter
    facts.lastRetainedCountAfter = counts.retainedCountAfter
    if (counts.exhausted) facts.exhaustedWorks += 1
  }
  const observer: SearchRuntimeObserver = (event: SearchRuntimeEvent) => {
    events += 1
    if (event.type === 'section_started') {
      if (event.section === 'search_runtime' && searchStartedAt === null) searchStartedAt = elapsed()
      open.push(event.section)
      const stream = streamOf(event.section)
      if (stream !== null && event.work !== undefined) {
        depth[stream].startedWorks += 1
        channelSets[stream].add(event.work.channel)
        depth[stream].channels = channelSets[stream].size
        depth[stream].maxDepth = Math.max(depth[stream].maxDepth, event.work.depth)
      }
    } else {
      const index = open.lastIndexOf(event.section)
      if (index >= 0) open.length = index
      const stream = streamOf(event.section)
      if (stream !== null) onCounts(stream, event.counts)
      if (event.section === 'search_runtime') searchCompletedAt = elapsed()
    }
    trackerObserver(event)
  }
  const snapshot = (reason: Phase2C26B2C2B2FProfileSnapshot['reason'], windowBoundaryMs: number | null = null): Phase2C26B2C2B2FProfileSnapshot => {
    seq += 1
    const runtime = tracker.snapshot()
    return { kind: 'profile_snapshot', reason, seq, atMs: runtime.atMs, searchElapsedMs: searchStartedAt === null ? null : (searchCompletedAt ?? runtime.atMs) - searchStartedAt,
      windowBoundaryMs, runtime, depth: { bonus: { ...depth.bonus }, skill: { ...depth.skill } },
      yields: { count: yields.count, totalMs: yields.totalMs, bySection: structuredClone(yields.bySection) }, events, searchStartedAtMs: searchStartedAt, searchCompletedAtMs: searchCompletedAt }
  }
  return {
    /** Starts the Research clock; call immediately before the task. */
    start(): number { origin = options.now(); return origin },
    observer,
    instrumentation: { onSearchRuntime: observer } as { onSearchRuntime: SearchRuntimeObserver },
    /** Wraps the Research yield so its wait is measured and attributed; the wrapped yield itself is unchanged. */
    wrapYield(yieldControl: () => Promise<void>): () => Promise<void> {
      return async () => {
        const section: SearchRuntimeSection | 'outside_search' = open.at(-1) ?? 'outside_search'
        const began = options.now()
        await yieldControl()
        const waited = options.now() - began
        yields.count += 1
        yields.totalMs += waited
        const slot = yields.bySection[section] ?? { count: 0, totalMs: 0 }
        slot.count += 1
        slot.totalMs += waited
        yields.bySection[section] = slot
      }
    },
    snapshot,
    searchStartedAtMs: () => searchStartedAt,
  }
}

// ---------------------------------------------------------------- runner start attestation (written by the runner before any child)

export const PHASE2C26B2C2B2F_START_ATTESTATION_FILE = 'start-attestation.json'
export const PHASE2C26B2C2B2F_START_ATTESTATION_PHASE = 'Issue #154 Phase 2-C2.6-B2-C2B2F runner start attestation'

/** The registered execution conditions of a formal launch. */
export function phase2c26b2c2b2fRegisteredConditions() {
  return { stage1: { ...PHASE2C26B2C2B2F_STAGE1 } as { executionClass: 'stage1'; childHeapMb: number; concurrency: number; budgetMs: number; retry: 'none'; fallback: 'none' },
    b2c2b2eStage1: { ...PHASE2C26B2C2B2F_B2C2B2E_STAGE1 }, changedStage1Fields: [...PHASE2C26B2C2B2F_CHANGED_STAGE1_FIELDS], tasksBudgetMs: PHASE2C26B2C2B2F_TASKS_BUDGET_MS,
    targets: PHASE2C26B2C2B2F_TARGETS, contextsPerTarget: PHASE2C26B2C2B2F_CONTEXTS_PER_TARGET, expectedTasks: PHASE2C26B2C2B2F_EXPECTED_TASKS, population: PHASE2C26B2C2B2F_POPULATION,
    contextSelection: PHASE2C26B2C2B2F_CONTEXT_SELECTION.id, extentRule: PHASE2C26B2C2B2F_EXTENT_RULE.id,
    captureRule: { policy: 'C4C', maxCostCohorts: PHASE2C26B2C2B2F_MAX_COST_COHORTS, sentinel: 'first delivery of the fifth distinct operation cost (never captured)', prefixes: { ...PHASE2C26B2C2B2F_CAPTURE_PREFIXES } },
    candidateSafetyCap: PHASE2C26B2C2B2F_CANDIDATE_SAFETY_CAP, registeredP1: PHASE2C26B2C2B2F_REGISTERED_P1, nodeYield: PHASE2C26B2C2B2F_NODE_YIELD,
    memorySampleIntervalMs: PHASE2C26B2C2B2F_MEMORY_SAMPLE_INTERVAL_MS, searchInstrumentation: { ...PHASE2C26B2C2B2F_SEARCH_INSTRUMENTATION }, cpuProfiler: PHASE2C26B2C2B2F_CPU_PROFILER,
    heartbeatIntervalMs: PHASE2C26B2C2B2F_HEARTBEAT_INTERVAL_MS, windowsMs: PHASE2C26B2C2B2F_WINDOWS_MS.map(w => [...w]), provenanceFlags: { ...PHASE2C26B2C2B2F_PROVENANCE_FLAGS } }
}

export interface Phase2C26B2C2B2FLaunchObservation {
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
  probeManifestB2C2B2EResultSha256: string
  targetWeaponIds: string[]
  probes: Phase2C26B2C2B2EProbe[]
  expectedTaskIdentities: Phase2C26B2C2B2FTaskIdentity[]
  stage1: ReturnType<typeof phase2c26b2c2b2fRegisteredConditions>['stage1']
  smoke: { budgetMs: number | null } | null
}

export type Phase2C26B2C2B2FStartAttestation = ReturnType<typeof phase2c26b2c2b2fRegisteredConditions> & Phase2C26B2C2B2FLaunchObservation & { phase: string; attestedBy: 'runner' }

export function phase2c26b2c2b2fStartAttestationBody(observation: Phase2C26B2C2B2FLaunchObservation): Phase2C26B2C2B2FStartAttestation {
  return { phase: PHASE2C26B2C2B2F_START_ATTESTATION_PHASE, attestedBy: 'runner', ...phase2c26b2c2b2fRegisteredConditions(), ...observation }
}

const ATTESTATION_KEYS = Object.keys(phase2c26b2c2b2fStartAttestationBody({ createdAt: '', runnerScript: '', node: '', repositoryHead: '', uncommittedBenchmarkCode: false, benchmarkCodeSha256: '',
  exportFileName: '', exportSha256: '', exportBytes: 0, probeManifestFileName: '', probeManifestSha256: '', probeManifestB2C2B2EResultSha256: '', targetWeaponIds: [], probes: [],
  expectedTaskIdentities: [], stage1: phase2c26b2c2b2fRegisteredConditions().stage1, smoke: null })).sort()
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

export interface Phase2C26B2C2B2FAttestationExpectation {
  repositoryHead: string
  benchmarkCodeSha256: string
  exportSha256: string
  probeManifestSha256: string
  b2c2b2eResultSha256: string
  probes: readonly Phase2C26B2C2B2EProbe[]
  expectedTaskIdentities: readonly Phase2C26B2C2B2FTaskIdentity[]
  firstChildStartedAt: string | null
}

/**
 * Whether a start attestation proves a formal launch (B2-C2B2E's rule with this phase's marker, probe, expected identity, B2-C2B2E
 * RESULT and conditions): exactly the attestation keys; runner + B2-C2B2F marker; a canonical UTC `createdAt` no later than the
 * first child start; HEAD / benchmark code / Export / manifest / B2-C2B2E RESULT / Targets / probe / expected identity equal to
 * the independently obtained ones; a clean launch with no smoke option; every registered condition (30 minutes, 12,288 MB,
 * concurrency 1, no retry / fallback, onSearchRuntime only, no CPU profiler, heartbeat, windows, provenance flags) unchanged.
 */
export function verifyPhase2C26B2C2B2FStartAttestation(attestation: unknown, expected: Phase2C26B2C2B2FAttestationExpectation):
  { verified: boolean; issues: string[]; integrityIssues: string[] } {
  if (!isObject(attestation)) return { verified: false, issues: ['the start attestation is not an object'], integrityIssues: ['the start attestation is not an object'] }
  const integrityIssues: string[] = []
  const launchIssues: string[] = []
  if (!same(Object.keys(attestation).sort(), ATTESTATION_KEYS)) integrityIssues.push('the start attestation keys are not exactly the attestation keys')
  if (attestation.attestedBy !== 'runner') integrityIssues.push('not attested by the runner')
  if (attestation.phase !== PHASE2C26B2C2B2F_START_ATTESTATION_PHASE) integrityIssues.push('not a B2-C2B2F start attestation')
  if (typeof attestation.createdAt !== 'string' || !ISO_UTC.test(attestation.createdAt) || new Date(attestation.createdAt).toISOString() !== attestation.createdAt) integrityIssues.push('createdAt is not a canonical UTC time')
  else if (expected.firstChildStartedAt !== null && !(attestation.createdAt <= expected.firstChildStartedAt)) integrityIssues.push('createdAt is later than the first child start')
  if (typeof attestation.repositoryHead !== 'string' || !/^[0-9a-f]{40}$/.test(attestation.repositoryHead)) integrityIssues.push('repositoryHead is not a commit SHA')
  if (attestation.repositoryHead !== expected.repositoryHead) integrityIssues.push('repositoryHead differs')
  if (attestation.benchmarkCodeSha256 !== expected.benchmarkCodeSha256) integrityIssues.push('benchmarkCodeSha256 differs')
  if (attestation.exportSha256 !== expected.exportSha256) integrityIssues.push('exportSha256 differs')
  if (attestation.probeManifestSha256 !== expected.probeManifestSha256) integrityIssues.push('probeManifestSha256 differs')
  if (attestation.probeManifestB2C2B2EResultSha256 !== expected.b2c2b2eResultSha256) integrityIssues.push('probeManifestB2C2B2EResultSha256 is not the registered B2-C2B2E RESULT')
  if (!same(attestation.targetWeaponIds, expected.probes.map(p => p.targetWeaponId))) integrityIssues.push('targetWeaponIds differ')
  if (!same(attestation.probes, expected.probes)) integrityIssues.push('probes differ')
  if (!same(attestation.expectedTaskIdentities, expected.expectedTaskIdentities)) integrityIssues.push('expectedTaskIdentities differ')
  if (attestation.uncommittedBenchmarkCode !== false) launchIssues.push('uncommitted benchmark code at launch')
  if (attestation.smoke !== null) launchIssues.push('a smoke option at launch')
  for (const [field, value] of Object.entries(phase2c26b2c2b2fRegisteredConditions())) if (!same(attestation[field], value)) launchIssues.push(`${field} differs from the registered condition`)
  const issues = [...integrityIssues, ...launchIssues]
  return { verified: issues.length === 0, issues, integrityIssues }
}
