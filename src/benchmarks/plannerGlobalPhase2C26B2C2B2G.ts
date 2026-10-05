/**
 * Issue #154 Phase 2-C2.6-B2-C2B2G: re-localization of the `bonus_depth_read` internal runtime of the one Target B2-C2B2F profiled
 * as BONUS dominant (the B2-C2B2E time-bound Target), searched again in EXACTLY B2-C2B2F's Search input. Research only and
 * profiling only: it asks which of the six held-aware `readReservedDepth()` sections dominates that read on the current main,
 * never whether the Search delivers the oracle Route. Never import from Production.
 *
 * Compared with B2-C2B2F exactly one thing changes, and it does not reach the Search semantics:
 *
 * ```text
 * instrumentation  onSearchRuntime  ->  onSearchRuntime + onGogmaReservedRuntime   (Phase 2-C2.6-A7's pair of boundary observers)
 * ```
 *
 * The budget (30 minutes), the heap (12,288 MB), concurrency 1, fresh child, setImmediate yield, 250 ms memory sampling, 5 s
 * heartbeat, the 0-10 / 10-20 / 20-30 minute windows, no retry and no fallback are B2-C2B2F's. The task is B2-C2B2F's: B2-C2B2F's
 * `buildPhase2C26B2C2B2FTasks()` over the one probe and its expected Search input identity, and the child calculation
 * `runPhase2C26B2C2B2GTask()` / `runPhase2C26B2C2B2GSearch()` is B2-C2B2D's line for line (a test fixes it) except that it hands
 * `visitPlannerAlternativeCandidates()` the two existing boundary observers as its only instrumentation.
 *
 * The observers are the existing Research trackers, reused unchanged: B2-C2B2F's profiler (the A4 stack tracker of the outer Search
 * sections, with its yield attribution and depth facts) and A3's held-aware section tracker (`createPhase2C26A3RuntimeTracker()`)
 * of the six inner sections. Both stamp the boundaries with one Research clock; a snapshot freezes that clock so the outer
 * `bonus_depth_read` and the inner sections are observed at the same instant (A7's method). Nothing either returns is read by the
 * Search, and the Search reads no clock. Research-side only, this module adds: an outer-stack mirror that checks every inner
 * boundary happens inside an open `bonus_depth_read`, the inner phase each Research yield wait falls in, and the depth records and
 * aggregate counts read from the counts the Search already reports at `depth_completed` (nothing is scanned).
 *
 * The Search side never receives an oracle Route, a stable key, an expected Candidate index / operation cost, an expected bottleneck
 * or section, an A7 / A8 result, or any B2-C2B2E / B2-C2B2F measurement.
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
import type { ReservedGogmaRuntimeEvent, ReservedGogmaRuntimeObserver, ReservedGogmaRuntimePhase } from '../domain/search/bonusStream'
import type { SearchRuntimeEvent, SearchRuntimeObserver, SearchRuntimeSection } from '../domain/search/searchRuntime'
import { preferredSourceRank } from '../domain/search/semanticKeys'
import { GLOBAL_RESEARCH_TIME } from './plannerGlobalOptimizationResearch'
import { phase2c2SearchStatus, respectsPhase2C2Reservation, summarizePhase2C2Entry } from './plannerGlobalPhase2C2'
import {
  createPhase2C26A3RuntimeTracker,
  PHASE2C26A3_PHASES,
  type Phase2C26A3DepthRecord,
  type Phase2C26A3RuntimeSnapshot,
} from './plannerGlobalPhase2C26A3'
import { PHASE2C26A7_SEARCH_INSTRUMENTATION } from './plannerGlobalPhase2C26A7'
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
import type { Phase2C26B2C2B2EProbe } from './plannerGlobalPhase2C26B2C2B2E'
import {
  buildPhase2C26B2C2B2FTasks,
  createPhase2C26B2C2B2FProfiler,
  parsePhase2C26B2C2B2FProbeManifest,
  phase2c26b2c2b2fChildSearchIdentity,
  phase2c26b2c2b2fTaskIdentity,
  phase2c26b2c2b2fTaskOutcome,
  PHASE2C26B2C2B2F_CANDIDATE_SAFETY_CAP,
  PHASE2C26B2C2B2F_CAPTURE_PREFIXES,
  PHASE2C26B2C2B2F_CHILD_HEAP_MB,
  PHASE2C26B2C2B2F_CONTEXT_SELECTION,
  PHASE2C26B2C2B2F_CPU_PROFILER,
  PHASE2C26B2C2B2F_EXTENT_RULE,
  PHASE2C26B2C2B2F_HEARTBEAT_INTERVAL_MS,
  PHASE2C26B2C2B2F_MAX_COST_COHORTS,
  PHASE2C26B2C2B2F_MEMORY_SAMPLE_INTERVAL_MS,
  PHASE2C26B2C2B2F_NODE_YIELD,
  PHASE2C26B2C2B2F_POPULATION,
  PHASE2C26B2C2B2F_PROVENANCE_FLAGS,
  PHASE2C26B2C2B2F_REGISTERED_P1,
  PHASE2C26B2C2B2F_SEARCH_INSTRUMENTATION,
  PHASE2C26B2C2B2F_STAGE1,
  PHASE2C26B2C2B2F_TASKS_BUDGET_MS,
  PHASE2C26B2C2B2F_WINDOWS_MS,
  type Phase2C26B2C2B2FProfileSnapshot,
  type Phase2C26B2C2B2FProbeManifest,
  type Phase2C26B2C2B2FTaskIdentity,
  type Phase2C26B2C2B2FTaskInput,
} from './plannerGlobalPhase2C26B2C2B2F'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}

// ---------------------------------------------------------------- Research execution conditions (registered, not Production defaults)

/** The population size: the Target(s) B2-C2B2F profiled with decision BONUS dominant (counted; the ID comes from the manifest). */
export const PHASE2C26B2C2B2G_TARGETS = 1
export const PHASE2C26B2C2B2G_CONTEXTS_PER_TARGET = 1
export const PHASE2C26B2C2B2G_EXPECTED_TASKS = PHASE2C26B2C2B2G_TARGETS * PHASE2C26B2C2B2G_CONTEXTS_PER_TARGET
/** B2-C2B2F's Stage 1 (30 minutes, 12,288 MB, concurrency 1, no retry, no fallback), unchanged. */
export const PHASE2C26B2C2B2G_B2C2B2F_STAGE1 = PHASE2C26B2C2B2F_STAGE1
export const PHASE2C26B2C2B2G_STAGE1 = Object.freeze({ ...PHASE2C26B2C2B2F_STAGE1 }) as
  { readonly executionClass: 'stage1'; readonly childHeapMb: number; readonly concurrency: number; readonly budgetMs: number; readonly retry: 'none'; readonly fallback: 'none' }
/** No Stage 1 field differs from B2-C2B2F's. */
export const PHASE2C26B2C2B2G_CHANGED_STAGE1_FIELDS = [] as const
export const PHASE2C26B2C2B2G_BUDGET_MS = PHASE2C26B2C2B2G_STAGE1.budgetMs
export const PHASE2C26B2C2B2G_CHILD_HEAP_MB = PHASE2C26B2C2B2F_CHILD_HEAP_MB
/** B2-C2B2F's tasks child budget, capture, safety cap, prefixes, yield, sampling, heartbeat, windows, context selection, extent rule and P1, unchanged. */
export const PHASE2C26B2C2B2G_TASKS_BUDGET_MS = PHASE2C26B2C2B2F_TASKS_BUDGET_MS
export const PHASE2C26B2C2B2G_MAX_COST_COHORTS = PHASE2C26B2C2B2F_MAX_COST_COHORTS
export const PHASE2C26B2C2B2G_CANDIDATE_SAFETY_CAP = PHASE2C26B2C2B2F_CANDIDATE_SAFETY_CAP
export const PHASE2C26B2C2B2G_CAPTURE_PREFIXES = PHASE2C26B2C2B2F_CAPTURE_PREFIXES
export const PHASE2C26B2C2B2G_NODE_YIELD = PHASE2C26B2C2B2F_NODE_YIELD
export const PHASE2C26B2C2B2G_MEMORY_SAMPLE_INTERVAL_MS = PHASE2C26B2C2B2F_MEMORY_SAMPLE_INTERVAL_MS
export const PHASE2C26B2C2B2G_HEARTBEAT_INTERVAL_MS = PHASE2C26B2C2B2F_HEARTBEAT_INTERVAL_MS
export const PHASE2C26B2C2B2G_WINDOWS_MS = PHASE2C26B2C2B2F_WINDOWS_MS
export const PHASE2C26B2C2B2G_CONTEXT_SELECTION = PHASE2C26B2C2B2F_CONTEXT_SELECTION
export const PHASE2C26B2C2B2G_EXTENT_RULE = PHASE2C26B2C2B2F_EXTENT_RULE
export const PHASE2C26B2C2B2G_REGISTERED_P1 = PHASE2C26B2C2B2F_REGISTERED_P1
/** B2-C2B2F's Search instrumentation (onSearchRuntime alone), the authority this phase adds one observer to. */
export const PHASE2C26B2C2B2G_B2C2B2F_SEARCH_INSTRUMENTATION = PHASE2C26B2C2B2F_SEARCH_INSTRUMENTATION
/** The two existing boundary observers, A7's pair: onSearchRuntime + onGogmaReservedRuntime (no depth / work observer, no CPU profiler). */
export const PHASE2C26B2C2B2G_SEARCH_INSTRUMENTATION = PHASE2C26A7_SEARCH_INSTRUMENTATION
/** The only intended difference from B2-C2B2F's launch (the analyzer checks every other registered condition is equal). */
export const PHASE2C26B2C2B2G_CHANGED_FROM_B2C2B2F = ['searchInstrumentation.onGogmaReservedRuntime'] as const
export const PHASE2C26B2C2B2G_CPU_PROFILER = PHASE2C26B2C2B2F_CPU_PROFILER
/** The six inner sections of one held-aware Bonus stream depth read (`RESERVED_GOGMA_RUNTIME_PHASES`, never a section of this phase's own). */
export const PHASE2C26B2C2B2G_INNER_SECTIONS = PHASE2C26A3_PHASES
export type Phase2C26B2C2B2GInnerSection = ReservedGogmaRuntimePhase
/** Provenance: B2-C2B2F's (the same oracle-guided Search input), plus what this phase adds. */
export const PHASE2C26B2C2B2G_PROVENANCE_FLAGS = {
  ...PHASE2C26B2C2B2F_PROVENANCE_FLAGS,
  innerRuntimeProfiling: true,
  absoluteRuntimeComparedWithB2C2B2F: false,
} as const
/** What B2-C2B2G deliberately does not run. */
export const PHASE2C26B2C2B2G_NOT_RUN = ['production_change', 'production_optimization', 'search_semantics_change', 'search_ordering_change', 'search_comparator_change',
  'candidate_materializer_change', 'capture_change', 'extent_change', 'context_change', 'p1_change', 'new_production_instrumentation_seam', 'new_inner_section',
  'heap_16gb', 'budget_60min_or_more', 'automatic_longer_retry', 'retry', 'timeout_fallback', 'oom_fallback', 'v8_cpu_profiler', 'reserved_depth_observer', 'work_settled_observer',
  'exact_route_judgement', 'e2_search', 'k2_feature_grouping', 'residual_unreached_support', 'global_assignment', 'full_planner_rerun', 'ui_change', 'a3_a9_result_regeneration',
  'b2c2b2e_result_regeneration', 'b2c2b2f_result_regeneration'] as const

// ---------------------------------------------------------------- the probe manifest (a Search input)

export const PHASE2C26B2C2B2G_POPULATION = 'B2C2B2F_BONUS_DOMINANT_PROFILED_TARGET'

export interface Phase2C26B2C2B2GProbeManifest {
  phase: string
  /** The B2-C2B2F RESULT the population was derived from and the B2-C2B2E RESULT its identity chains to (the Search never reads either). */
  b2c2b2fResultSha256: string
  b2c2b2eResultSha256: string
  population: typeof PHASE2C26B2C2B2G_POPULATION
  policy: 'P1'
  contextSelection: typeof PHASE2C26B2C2B2G_CONTEXT_SELECTION.id
  extentRule: typeof PHASE2C26B2C2B2G_EXTENT_RULE.id
  exportSha256: string
  /** B2-C2B2F's probe shape (Target, B2-C2B2E task ID in its `b2c2b2dTaskId` field, P1 rank, tight extent). */
  probes: Phase2C26B2C2B2EProbe[]
  expectedTaskIdentities: Phase2C26B2C2B2FTaskIdentity[]
}

const MANIFEST_KEYS = ['b2c2b2eResultSha256', 'b2c2b2fResultSha256', 'contextSelection', 'expectedTaskIdentities', 'exportSha256', 'extentRule', 'phase', 'policy', 'population', 'probes']
const SHA256 = /^[0-9a-f]{64}$/

/**
 * Reads a probe manifest as untrusted JSON: exactly the manifest keys, the registered population, a B2-C2B2F RESULT SHA-256; the probe
 * and the expected identity are then checked by B2-C2B2F's own manifest parser unchanged (exactly one probe and one identity naming
 * the same Target / task / rank / extent, inside B2-C2B2D's bounds, no extra field). No expected key / index / cost / outcome /
 * section / measurement may ride along.
 */
export function parsePhase2C26B2C2B2GProbeManifest(json: unknown): { valid: boolean; issues: string[]; manifest: Phase2C26B2C2B2GProbeManifest | null } {
  const issues: string[] = []
  if (!isObject(json)) return { valid: false, issues: ['the probe manifest is not an object'], manifest: null }
  if (!same(Object.keys(json).sort(), MANIFEST_KEYS)) issues.push(`the probe manifest keys are not exactly ${MANIFEST_KEYS.join(', ')}`)
  if (json.population !== PHASE2C26B2C2B2G_POPULATION) issues.push(`population is not ${PHASE2C26B2C2B2G_POPULATION}`)
  if (typeof json.b2c2b2fResultSha256 !== 'string' || !SHA256.test(json.b2c2b2fResultSha256)) issues.push('b2c2b2fResultSha256 is not a SHA-256')
  const f = parsePhase2C26B2C2B2FProbeManifest({ phase: json.phase, b2c2b2eResultSha256: json.b2c2b2eResultSha256, population: PHASE2C26B2C2B2F_POPULATION, policy: json.policy,
    contextSelection: json.contextSelection, extentRule: json.extentRule, exportSha256: json.exportSha256, probes: json.probes, expectedTaskIdentities: json.expectedTaskIdentities })
  issues.push(...f.issues)
  if (issues.length > 0 || f.manifest === null) return { valid: false, issues, manifest: null }
  const m: Phase2C26B2C2B2FProbeManifest = f.manifest
  return { valid: true, issues: [], manifest: { phase: m.phase, b2c2b2fResultSha256: String(json.b2c2b2fResultSha256), b2c2b2eResultSha256: m.b2c2b2eResultSha256,
    population: PHASE2C26B2C2B2G_POPULATION, policy: 'P1', contextSelection: m.contextSelection, extentRule: m.extentRule, exportSha256: m.exportSha256, probes: m.probes,
    expectedTaskIdentities: m.expectedTaskIdentities } }
}

// ---------------------------------------------------------------- task construction (B2-C2B2F's, gated by the expected identity)

export type Phase2C26B2C2B2GTaskInput = Phase2C26B2C2B2FTaskInput
export const phase2c26b2c2b2gTaskIdentity = phase2c26b2c2b2fTaskIdentity

/** B2-C2B2F's `buildPhase2C26B2C2B2FTasks()` unchanged (B2-C2B2E's construction plus the identity gate), with this phase's task count. */
export function buildPhase2C26B2C2B2GTasks(schedule: Phase2C26B2C1Schedule, manifest: Pick<Phase2C26B2C2B2GProbeManifest, 'probes' | 'expectedTaskIdentities'>):
  { valid: boolean; issues: string[]; tasks: Phase2C26B2C2B2GTaskInput[] } {
  const built = buildPhase2C26B2C2B2FTasks(schedule, manifest)
  const issues = [...built.issues]
  if (built.valid && built.tasks.length !== PHASE2C26B2C2B2G_EXPECTED_TASKS) issues.push(`${built.tasks.length} tasks, not ${PHASE2C26B2C2B2G_EXPECTED_TASKS}`)
  return { valid: issues.length === 0, issues, tasks: issues.length === 0 ? built.tasks : [] }
}

/** The Search identity the child rebuilds and attests before it searches: B2-C2B2F's, unchanged. */
export const phase2c26b2c2b2gChildSearchIdentity = phase2c26b2c2b2fChildSearchIdentity
/** A timeout / out-of-memory / failure is that failure, never "no Candidate": B2-C2B2F's (B2-C2B2D's) rule itself. */
export const phase2c26b2c2b2gTaskOutcome = phase2c26b2c2b2fTaskOutcome

// ---------------------------------------------------------------- the profiled child calculation (B2-C2B2D's, line for line)

/** The two boundary observers the profiled Search is handed (A7's pair). */
export interface Phase2C26B2C2B2GInstrumentation {
  onSearchRuntime: SearchRuntimeObserver
  onGogmaReservedRuntime: ReservedGogmaRuntimeObserver
}

/** The execution options of the profiled child: B2-C2B2D's plus the two boundary observers as the only Search instrumentation. */
export interface Phase2C26B2C2B2GSearchOptions {
  yieldControl?: () => Promise<void>
  now?: () => number
  instrumentation?: Phase2C26B2C2B2GInstrumentation
}

const selectorOf = (row: Pick<Phase2C26B2C1ContextRow, 'targetWeaponId' | 'representativeFixedSetId' | 'targetEligibleMinCardinality' | 'reservationDigest'>) =>
  ({ targetWeaponId: row.targetWeaponId, fixedSetId: row.representativeFixedSetId, cardinality: row.targetEligibleMinCardinality, reservationDigest: row.reservationDigest })

/**
 * B2-C2B2D's `runPhase2C26B2C2B2DSearch()` line for line; the one difference is that the two boundary observers (when given) are
 * handed to `visitPlannerAlternativeCandidates()` as its only instrumentation. The Search input, the capture and every stop rule
 * are B2-C2B2D's.
 */
export async function runPhase2C26B2C2B2GSearch(input: PlannerInput, context: Phase2C26B2C2B2DContext, engine: RngEngine, capture: { maxCostCohorts: number; candidateSafetyCap: number },
  provenance: { contextRank: number; targetEligibleMinCardinality: number; representativeFixedSetId: string; representativeFixedTargetWeaponIds: string[] },
  options: Phase2C26B2C2B2GSearchOptions = {}): Promise<Phase2C26B2C2B2DSearchRecord> {
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
  }, options.instrumentation === undefined ? { yieldControl: options.yieldControl } : { yieldControl: options.yieldControl,
    instrumentation: { onSearchRuntime: options.instrumentation.onSearchRuntime, onGogmaReservedRuntime: options.instrumentation.onGogmaReservedRuntime } })
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
export async function runPhase2C26B2C2B2GTask(input: PlannerInput, schedule: Phase2C26B2C1Schedule, task: Phase2C26B2C2B2DTaskInput, engine: RngEngine,
  options: Phase2C26B2C2B2GSearchOptions = {}): Promise<Phase2C26B2C2B2DChildRecord> {
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
  const search = await runPhase2C26B2C2B2GSearch(input, tight.context, engine, { maxCostCohorts: task.maxCostCohorts, candidateSafetyCap: task.candidateSafetyCap },
    { contextRank: task.contextRank, targetEligibleMinCardinality: task.targetEligibleMinCardinality, representativeFixedSetId: task.representativeFixedSetId,
      representativeFixedTargetWeaponIds: task.representativeFixedTargetWeaponIds }, options)
  return { status: 'searched', taskId: task.taskId, search }
}

// ---------------------------------------------------------------- the profiler (B2-C2B2F's outer profiler + A3's inner tracker, one clock)

/** Aggregates of the counts the Search reports at each completed inner depth (`ReservedGogmaRuntimeEvent.counts`); nothing is scanned. */
export interface Phase2C26B2C2B2GInnerCounts {
  completedDepths: number
  exhaustedDepths: number
  frontierStatesBeforeSum: number
  frontierStatesBeforeMax: number
  legalPositionCountSum: number
  legalPositionCountMax: number
  generatedStatesSum: number
  generatedStatesMax: number
  frontierStatesAfterSum: number
  frontierStatesAfterMax: number
  windowMemoEntriesMax: number
}

/** The inner side of one cumulative snapshot, taken on the same frozen instant as the outer runtime. */
export interface Phase2C26B2C2B2GInnerSnapshot {
  /** Research elapsed since the profiler origin (equal to the outer `runtime.atMs` by construction). */
  atMs: number
  /** A3's tracker snapshot unchanged (completed sections only; the open section / depth in `activePhase` / `activeDepth`). */
  runtime: Phase2C26A3RuntimeSnapshot
  counts: Phase2C26B2C2B2GInnerCounts
  events: number
  /** Inner boundaries reported while the innermost open outer section was not `bonus_depth_read` (a reconciliation contract violation). */
  outsideReadViolations: number
  outsideReadViolationSamples: string[]
  /** Research yield waits by the inner section open at the yield call (`outside_inner_section` inside the read but between sections). */
  yieldsByInnerSection: Partial<Record<Phase2C26B2C2B2GInnerSection | 'outside_inner_section', { count: number; totalMs: number }>>
}

export interface Phase2C26B2C2B2GProfileSnapshot extends Phase2C26B2C2B2FProfileSnapshot {
  inner: Phase2C26B2C2B2GInnerSnapshot
  /** The inner depth records completed since the previous snapshot (each one appears in exactly one snapshot). */
  newDepthRecords: Phase2C26A3DepthRecord[]
  depthRecordsEmitted: number
}

const zeroCounts = (): Phase2C26B2C2B2GInnerCounts => ({ completedDepths: 0, exhaustedDepths: 0, frontierStatesBeforeSum: 0, frontierStatesBeforeMax: 0, legalPositionCountSum: 0,
  legalPositionCountMax: 0, generatedStatesSum: 0, generatedStatesMax: 0, frontierStatesAfterSum: 0, frontierStatesAfterMax: 0, windowMemoEntriesMax: 0 })

/**
 * The child-side profiler of one Search: B2-C2B2F's profiler (A4's outer tracker, yield attribution, depth facts) and A3's inner
 * tracker, unchanged, sharing one clock and one origin. `snapshot()` freezes the clock for its synchronous duration, so both trackers
 * observe the same instant (no Search event runs during it). The observers never throw into the Search, return nothing the Search
 * reads and read no Search state; the inner depth records are kept in memory and handed out by the next snapshot, so nothing is
 * written per boundary.
 */
export function createPhase2C26B2C2B2GProfiler(options: { now: () => number }) {
  let frozen: number | null = null
  let origin: number | null = null
  const clock = () => frozen ?? options.now()
  const outer = createPhase2C26B2C2B2FProfiler({ now: clock })
  const outerOpen: SearchRuntimeSection[] = []
  const counts = zeroCounts()
  const pending: Phase2C26A3DepthRecord[] = []
  let emitted = 0
  let innerEvents = 0
  let outsideRead = 0
  const outsideReadSamples: string[] = []
  let innerActive: Phase2C26B2C2B2GInnerSection | null = null
  const yieldsByInner: Phase2C26B2C2B2GInnerSnapshot['yieldsByInnerSection'] = {}
  const inner = createPhase2C26A3RuntimeTracker({ now: clock, origin: () => origin ?? clock(), emitPhaseStarted: () => undefined,
    emitDepth: record => {
      const c = record.counts
      counts.completedDepths += 1
      if (record.exhausted) counts.exhaustedDepths += 1
      counts.frontierStatesBeforeSum += c.frontierStatesBefore
      counts.frontierStatesBeforeMax = Math.max(counts.frontierStatesBeforeMax, c.frontierStatesBefore)
      counts.legalPositionCountSum += c.legalPositionCount ?? 0
      counts.legalPositionCountMax = Math.max(counts.legalPositionCountMax, c.legalPositionCount ?? 0)
      counts.generatedStatesSum += c.generatedStates ?? 0
      counts.generatedStatesMax = Math.max(counts.generatedStatesMax, c.generatedStates ?? 0)
      counts.frontierStatesAfterSum += c.frontierStatesAfter ?? 0
      counts.frontierStatesAfterMax = Math.max(counts.frontierStatesAfterMax, c.frontierStatesAfter ?? 0)
      counts.windowMemoEntriesMax = Math.max(counts.windowMemoEntriesMax, c.windowMemoEntries)
      pending.push(record)
      emitted += 1
    } })
  const innerTracker = inner.observerForTarget(0)
  const outerObserver: SearchRuntimeObserver = (event: SearchRuntimeEvent) => {
    if (event.type === 'section_started') outerOpen.push(event.section)
    else {
      const index = outerOpen.lastIndexOf(event.section)
      if (index >= 0) outerOpen.length = index
    }
    outer.observer(event)
  }
  const innerObserver: ReservedGogmaRuntimeObserver = (event: ReservedGogmaRuntimeEvent) => {
    innerEvents += 1
    if (outerOpen.at(-1) !== 'bonus_depth_read') {
      outsideRead += 1
      if (outsideReadSamples.length < 20) outsideReadSamples.push(`s${event.streamIndex}/d${event.depth}: ${event.type}${'phase' in event ? ` ${event.phase}` : ''} inside ${outerOpen.at(-1) ?? 'no section'}`)
    }
    if (event.type === 'phase_started') innerActive = event.phase
    else if (event.type === 'phase_completed' || event.type === 'depth_completed') innerActive = null
    innerTracker(event)
  }
  const snapshot = (reason: Phase2C26B2C2B2FProfileSnapshot['reason'], windowBoundaryMs: number | null = null): Phase2C26B2C2B2GProfileSnapshot => {
    frozen = options.now()
    try {
      const outerSnapshot = outer.snapshot(reason, windowBoundaryMs)
      const runtime = inner.snapshot()
      return { ...outerSnapshot,
        inner: { atMs: frozen - (origin ?? frozen), runtime, counts: { ...counts }, events: innerEvents, outsideReadViolations: outsideRead,
          outsideReadViolationSamples: [...outsideReadSamples], yieldsByInnerSection: structuredClone(yieldsByInner) },
        newDepthRecords: pending.splice(0), depthRecordsEmitted: emitted }
    } finally {
      frozen = null
    }
  }
  return {
    /** Starts the shared Research clock; call immediately before the task. Returns the origin. */
    start(): number { origin = outer.start(); return origin },
    outerObserver,
    innerObserver,
    instrumentation: { onSearchRuntime: outerObserver, onGogmaReservedRuntime: innerObserver } as Phase2C26B2C2B2GInstrumentation,
    /** B2-C2B2F's yield wrapper (outer attribution) around one that attributes the same wait to the open inner section. */
    wrapYield(yieldControl: () => Promise<void>): () => Promise<void> {
      return outer.wrapYield(async () => {
        const section: Phase2C26B2C2B2GInnerSection | 'outside_inner_section' | null = outerOpen.at(-1) === 'bonus_depth_read' ? innerActive ?? 'outside_inner_section' : null
        const began = options.now()
        await yieldControl()
        if (section === null) return
        const slot = yieldsByInner[section] ?? { count: 0, totalMs: 0 }
        slot.count += 1
        slot.totalMs += options.now() - began
        yieldsByInner[section] = slot
      })
    },
    snapshot,
    searchStartedAtMs: () => outer.searchStartedAtMs(),
  }
}

// ---------------------------------------------------------------- runner start attestation (written by the runner before any child)

export const PHASE2C26B2C2B2G_START_ATTESTATION_FILE = 'start-attestation.json'
export const PHASE2C26B2C2B2G_START_ATTESTATION_PHASE = 'Issue #154 Phase 2-C2.6-B2-C2B2G runner start attestation'

/** The registered execution conditions of a formal launch. */
export function phase2c26b2c2b2gRegisteredConditions() {
  return { stage1: { ...PHASE2C26B2C2B2G_STAGE1 } as { executionClass: 'stage1'; childHeapMb: number; concurrency: number; budgetMs: number; retry: 'none'; fallback: 'none' },
    b2c2b2fStage1: { ...PHASE2C26B2C2B2G_B2C2B2F_STAGE1 }, changedStage1Fields: [...PHASE2C26B2C2B2G_CHANGED_STAGE1_FIELDS], changedFromB2C2B2F: [...PHASE2C26B2C2B2G_CHANGED_FROM_B2C2B2F],
    tasksBudgetMs: PHASE2C26B2C2B2G_TASKS_BUDGET_MS, targets: PHASE2C26B2C2B2G_TARGETS, contextsPerTarget: PHASE2C26B2C2B2G_CONTEXTS_PER_TARGET, expectedTasks: PHASE2C26B2C2B2G_EXPECTED_TASKS,
    population: PHASE2C26B2C2B2G_POPULATION, contextSelection: PHASE2C26B2C2B2G_CONTEXT_SELECTION.id, extentRule: PHASE2C26B2C2B2G_EXTENT_RULE.id,
    captureRule: { policy: 'C4C', maxCostCohorts: PHASE2C26B2C2B2G_MAX_COST_COHORTS, sentinel: 'first delivery of the fifth distinct operation cost (never captured)', prefixes: { ...PHASE2C26B2C2B2G_CAPTURE_PREFIXES } },
    candidateSafetyCap: PHASE2C26B2C2B2G_CANDIDATE_SAFETY_CAP, registeredP1: PHASE2C26B2C2B2G_REGISTERED_P1, nodeYield: PHASE2C26B2C2B2G_NODE_YIELD,
    memorySampleIntervalMs: PHASE2C26B2C2B2G_MEMORY_SAMPLE_INTERVAL_MS, searchInstrumentation: { ...PHASE2C26B2C2B2G_SEARCH_INSTRUMENTATION },
    b2c2b2fSearchInstrumentation: { ...PHASE2C26B2C2B2G_B2C2B2F_SEARCH_INSTRUMENTATION }, innerSections: [...PHASE2C26B2C2B2G_INNER_SECTIONS], cpuProfiler: PHASE2C26B2C2B2G_CPU_PROFILER,
    heartbeatIntervalMs: PHASE2C26B2C2B2G_HEARTBEAT_INTERVAL_MS, windowsMs: PHASE2C26B2C2B2G_WINDOWS_MS.map(w => [...w]), provenanceFlags: { ...PHASE2C26B2C2B2G_PROVENANCE_FLAGS } }
}

export interface Phase2C26B2C2B2GLaunchObservation {
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
  probeManifestB2C2B2FResultSha256: string
  probeManifestB2C2B2EResultSha256: string
  targetWeaponIds: string[]
  probes: Phase2C26B2C2B2EProbe[]
  expectedTaskIdentities: Phase2C26B2C2B2FTaskIdentity[]
  stage1: ReturnType<typeof phase2c26b2c2b2gRegisteredConditions>['stage1']
  smoke: { budgetMs: number | null } | null
}

export type Phase2C26B2C2B2GStartAttestation = ReturnType<typeof phase2c26b2c2b2gRegisteredConditions> & Phase2C26B2C2B2GLaunchObservation & { phase: string; attestedBy: 'runner' }

export function phase2c26b2c2b2gStartAttestationBody(observation: Phase2C26B2C2B2GLaunchObservation): Phase2C26B2C2B2GStartAttestation {
  return { phase: PHASE2C26B2C2B2G_START_ATTESTATION_PHASE, attestedBy: 'runner', ...phase2c26b2c2b2gRegisteredConditions(), ...observation }
}

const ATTESTATION_KEYS = Object.keys(phase2c26b2c2b2gStartAttestationBody({ createdAt: '', runnerScript: '', node: '', repositoryHead: '', uncommittedBenchmarkCode: false, benchmarkCodeSha256: '',
  exportFileName: '', exportSha256: '', exportBytes: 0, probeManifestFileName: '', probeManifestSha256: '', probeManifestB2C2B2FResultSha256: '', probeManifestB2C2B2EResultSha256: '',
  targetWeaponIds: [], probes: [], expectedTaskIdentities: [], stage1: phase2c26b2c2b2gRegisteredConditions().stage1, smoke: null })).sort()
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

export interface Phase2C26B2C2B2GAttestationExpectation {
  repositoryHead: string
  benchmarkCodeSha256: string
  exportSha256: string
  probeManifestSha256: string
  b2c2b2fResultSha256: string
  b2c2b2eResultSha256: string
  probes: readonly Phase2C26B2C2B2EProbe[]
  expectedTaskIdentities: readonly Phase2C26B2C2B2FTaskIdentity[]
  firstChildStartedAt: string | null
}

/**
 * Whether a start attestation proves a formal launch (B2-C2B2F's rule with this phase's marker, B2-C2B2F / B2-C2B2E RESULTs and
 * conditions): exactly the attestation keys; runner + B2-C2B2G marker; a canonical UTC `createdAt` no later than the first child
 * start; HEAD / benchmark code / Export / manifest / B2-C2B2F and B2-C2B2E RESULTs / Targets / probe / expected identity equal to the
 * independently obtained ones; a clean launch with no smoke option; every registered condition (30 minutes, 12,288 MB, concurrency 1,
 * no retry / fallback, onSearchRuntime + onGogmaReservedRuntime only, no CPU profiler, heartbeat, windows, provenance flags) unchanged.
 */
export function verifyPhase2C26B2C2B2GStartAttestation(attestation: unknown, expected: Phase2C26B2C2B2GAttestationExpectation):
  { verified: boolean; issues: string[]; integrityIssues: string[] } {
  if (!isObject(attestation)) return { verified: false, issues: ['the start attestation is not an object'], integrityIssues: ['the start attestation is not an object'] }
  const integrityIssues: string[] = []
  const launchIssues: string[] = []
  if (!same(Object.keys(attestation).sort(), ATTESTATION_KEYS)) integrityIssues.push('the start attestation keys are not exactly the attestation keys')
  if (attestation.attestedBy !== 'runner') integrityIssues.push('not attested by the runner')
  if (attestation.phase !== PHASE2C26B2C2B2G_START_ATTESTATION_PHASE) integrityIssues.push('not a B2-C2B2G start attestation')
  if (typeof attestation.createdAt !== 'string' || !ISO_UTC.test(attestation.createdAt) || new Date(attestation.createdAt).toISOString() !== attestation.createdAt) integrityIssues.push('createdAt is not a canonical UTC time')
  else if (expected.firstChildStartedAt !== null && !(attestation.createdAt <= expected.firstChildStartedAt)) integrityIssues.push('createdAt is later than the first child start')
  if (typeof attestation.repositoryHead !== 'string' || !/^[0-9a-f]{40}$/.test(attestation.repositoryHead)) integrityIssues.push('repositoryHead is not a commit SHA')
  if (attestation.repositoryHead !== expected.repositoryHead) integrityIssues.push('repositoryHead differs')
  if (attestation.benchmarkCodeSha256 !== expected.benchmarkCodeSha256) integrityIssues.push('benchmarkCodeSha256 differs')
  if (attestation.exportSha256 !== expected.exportSha256) integrityIssues.push('exportSha256 differs')
  if (attestation.probeManifestSha256 !== expected.probeManifestSha256) integrityIssues.push('probeManifestSha256 differs')
  if (attestation.probeManifestB2C2B2FResultSha256 !== expected.b2c2b2fResultSha256) integrityIssues.push('probeManifestB2C2B2FResultSha256 is not the registered B2-C2B2F RESULT')
  if (attestation.probeManifestB2C2B2EResultSha256 !== expected.b2c2b2eResultSha256) integrityIssues.push('probeManifestB2C2B2EResultSha256 is not the registered B2-C2B2E RESULT')
  if (!same(attestation.targetWeaponIds, expected.probes.map(p => p.targetWeaponId))) integrityIssues.push('targetWeaponIds differ')
  if (!same(attestation.probes, expected.probes)) integrityIssues.push('probes differ')
  if (!same(attestation.expectedTaskIdentities, expected.expectedTaskIdentities)) integrityIssues.push('expectedTaskIdentities differ')
  if (attestation.uncommittedBenchmarkCode !== false) launchIssues.push('uncommitted benchmark code at launch')
  if (attestation.smoke !== null) launchIssues.push('a smoke option at launch')
  for (const [field, value] of Object.entries(phase2c26b2c2b2gRegisteredConditions())) if (!same(attestation[field], value)) launchIssues.push(`${field} differs from the registered condition`)
  const issues = [...integrityIssues, ...launchIssues]
  return { verified: issues.length === 0, issues, integrityIssues }
}
