/**
 * Issue #154 Phase 2-C2.6-B2-C2B2H: CPU attribution inside the held-aware Bonus stream `state_generation` section of the one
 * Target B2-C2B2G profiled as STATE_GENERATION dominant, searched again in EXACTLY B2-C2B2G's Search input. Research only and
 * profiling only: it asks where the CPU of `state_generation` goes on the current main, never whether the Search delivers the
 * oracle Route, and it optimizes nothing. Never import from Production.
 *
 * Compared with B2-C2B2G exactly one thing changes, and it does not reach the Search semantics:
 *
 * ```text
 * cpuProfiler  false  ->  the V8 sampling CPU profiler (node:inspector Profiler, A5 / A8's registered window:
 *                         10 ms requested sampling, Search start + 120 s .. + 720 s, JIT default, no inlining flag)
 * ```
 *
 * The Search input, the task (B2-C2B2G's `buildPhase2C26B2C2B2GTasks()`), the child calculation (B2-C2B2G's
 * `runPhase2C26B2C2B2GTask()` itself, not a copy), the two boundary observers (onSearchRuntime + onGogmaReservedRuntime, A7's
 * pair), B2-C2B2G's profiler (B2-C2B2F's outer tracker + A3's inner tracker on one clock, yield attribution, 5 s durable snapshots),
 * the budget (30 minutes), the heap (12,288 MB), concurrency 1, setImmediate yield, 250 ms memory sampling, no retry and no
 * fallback are B2-C2B2G's.
 *
 * Research-side only, this module adds to B2-C2B2G's profiler, behind the same two observers:
 *
 * - a durable section stream: one small record per held-aware boundary (depth / phase start / phase completion; about 14 per
 *   depth, a few thousand per run), stamped with the Research clock, from which the `state_generation` intervals are rebuilt
 *   after the run. Nothing is written per generated state;
 * - the profile window anchor: the Research time of the Search start (`search_runtime` section start), handed to A5's profile
 *   controller (the controller and the profiler session live in the runner, outside the Search).
 *
 * The observers never throw into the Search (a write failure is counted, never raised), return nothing the Search reads and
 * read no Search state; the CPU profile never reaches the Search. The Search side never receives an oracle Route, a stable key,
 * an expected Candidate index / operation cost, an expected hotspot, section or sample category, an A5 / A8 / A9 result, or any
 * B2-C2B2E / B2-C2B2F / B2-C2B2G measurement.
 */
import { stableStringify } from '../domain/models/hashing'
import type { ReservedGogmaRuntimeEvent, ReservedGogmaRuntimeObserver, ReservedGogmaRuntimePhase } from '../domain/search/bonusStream'
import type { SearchRuntimeEvent, SearchRuntimeObserver } from '../domain/search/searchRuntime'
import { PHASE2C26A5_PROFILER } from './plannerGlobalPhase2C26A5'
import type { Phase2C26B2C2B2EProbe } from './plannerGlobalPhase2C26B2C2B2E'
import type { Phase2C26B2C2B2FTaskIdentity } from './plannerGlobalPhase2C26B2C2B2F'
import {
  buildPhase2C26B2C2B2GTasks,
  createPhase2C26B2C2B2GProfiler,
  parsePhase2C26B2C2B2GProbeManifest,
  phase2c26b2c2b2gChildSearchIdentity,
  phase2c26b2c2b2gTaskIdentity,
  phase2c26b2c2b2gTaskOutcome,
  runPhase2C26B2C2B2GTask,
  PHASE2C26B2C2B2G_CANDIDATE_SAFETY_CAP,
  PHASE2C26B2C2B2G_CAPTURE_PREFIXES,
  PHASE2C26B2C2B2G_CHILD_HEAP_MB,
  PHASE2C26B2C2B2G_CONTEXT_SELECTION,
  PHASE2C26B2C2B2G_CPU_PROFILER,
  PHASE2C26B2C2B2G_EXTENT_RULE,
  PHASE2C26B2C2B2G_HEARTBEAT_INTERVAL_MS,
  PHASE2C26B2C2B2G_INNER_SECTIONS,
  PHASE2C26B2C2B2G_MAX_COST_COHORTS,
  PHASE2C26B2C2B2G_MEMORY_SAMPLE_INTERVAL_MS,
  PHASE2C26B2C2B2G_NODE_YIELD,
  PHASE2C26B2C2B2G_POPULATION,
  PHASE2C26B2C2B2G_PROVENANCE_FLAGS,
  PHASE2C26B2C2B2G_REGISTERED_P1,
  PHASE2C26B2C2B2G_SEARCH_INSTRUMENTATION,
  PHASE2C26B2C2B2G_STAGE1,
  PHASE2C26B2C2B2G_TASKS_BUDGET_MS,
  PHASE2C26B2C2B2G_WINDOWS_MS,
  type Phase2C26B2C2B2GInstrumentation,
  type Phase2C26B2C2B2GProbeManifest,
  type Phase2C26B2C2B2GProfileSnapshot,
  type Phase2C26B2C2B2GTaskInput,
} from './plannerGlobalPhase2C26B2C2B2G'
import type { Phase2C26B2C1Schedule } from './plannerGlobalPhase2C26B2C1'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}

// ---------------------------------------------------------------- Research execution conditions (registered, not Production defaults)

/** The population size: the Target(s) B2-C2B2G profiled with decision STATE_GENERATION dominant (counted; the ID comes from the manifest). */
export const PHASE2C26B2C2B2H_TARGETS = 1
export const PHASE2C26B2C2B2H_EXPECTED_TASKS = PHASE2C26B2C2B2H_TARGETS
/** The one inner section this phase attributes CPU inside (B2-C2B2G's decision; read from the B2-C2B2G RESULT, checked here). */
export const PHASE2C26B2C2B2H_SECTION: ReservedGogmaRuntimePhase = 'state_generation'
/** B2-C2B2G's Stage 1 (30 minutes, 12,288 MB, concurrency 1, no retry, no fallback), unchanged. */
export const PHASE2C26B2C2B2H_B2C2B2G_STAGE1 = PHASE2C26B2C2B2G_STAGE1
export const PHASE2C26B2C2B2H_STAGE1 = Object.freeze({ ...PHASE2C26B2C2B2G_STAGE1 }) as
  { readonly executionClass: 'stage1'; readonly childHeapMb: number; readonly concurrency: number; readonly budgetMs: number; readonly retry: 'none'; readonly fallback: 'none' }
export const PHASE2C26B2C2B2H_CHANGED_STAGE1_FIELDS = [] as const
export const PHASE2C26B2C2B2H_BUDGET_MS = PHASE2C26B2C2B2H_STAGE1.budgetMs
export const PHASE2C26B2C2B2H_CHILD_HEAP_MB = PHASE2C26B2C2B2G_CHILD_HEAP_MB
/** B2-C2B2G's tasks child budget, capture, safety cap, prefixes, yield, sampling, heartbeat, windows, context selection, extent rule and P1, unchanged. */
export const PHASE2C26B2C2B2H_TASKS_BUDGET_MS = PHASE2C26B2C2B2G_TASKS_BUDGET_MS
export const PHASE2C26B2C2B2H_MAX_COST_COHORTS = PHASE2C26B2C2B2G_MAX_COST_COHORTS
export const PHASE2C26B2C2B2H_CANDIDATE_SAFETY_CAP = PHASE2C26B2C2B2G_CANDIDATE_SAFETY_CAP
export const PHASE2C26B2C2B2H_CAPTURE_PREFIXES = PHASE2C26B2C2B2G_CAPTURE_PREFIXES
export const PHASE2C26B2C2B2H_NODE_YIELD = PHASE2C26B2C2B2G_NODE_YIELD
export const PHASE2C26B2C2B2H_MEMORY_SAMPLE_INTERVAL_MS = PHASE2C26B2C2B2G_MEMORY_SAMPLE_INTERVAL_MS
export const PHASE2C26B2C2B2H_HEARTBEAT_INTERVAL_MS = PHASE2C26B2C2B2G_HEARTBEAT_INTERVAL_MS
export const PHASE2C26B2C2B2H_WINDOWS_MS = PHASE2C26B2C2B2G_WINDOWS_MS
export const PHASE2C26B2C2B2H_CONTEXT_SELECTION = PHASE2C26B2C2B2G_CONTEXT_SELECTION
export const PHASE2C26B2C2B2H_EXTENT_RULE = PHASE2C26B2C2B2G_EXTENT_RULE
export const PHASE2C26B2C2B2H_REGISTERED_P1 = PHASE2C26B2C2B2G_REGISTERED_P1
export const PHASE2C26B2C2B2H_INNER_SECTIONS = PHASE2C26B2C2B2G_INNER_SECTIONS
/** B2-C2B2G's Search instrumentation (the two existing boundary observers, A7's pair), unchanged: no observer is added. */
export const PHASE2C26B2C2B2H_SEARCH_INSTRUMENTATION = PHASE2C26B2C2B2G_SEARCH_INSTRUMENTATION
export const PHASE2C26B2C2B2H_B2C2B2G_CPU_PROFILER = PHASE2C26B2C2B2G_CPU_PROFILER
/**
 * The V8 sampling CPU profiler conditions: A5's (= A8's) registered window, unchanged and fixed before the formal run. Requested
 * sampling 10 ms; relative to the Search start (`search_runtime` section start) the profiler starts after 120 s and stops at 720 s
 * (600 s requested). Started / stopped from timers, so only at an event loop yield; the actual times are recorded.
 */
export const PHASE2C26B2C2B2H_CPU_PROFILER = PHASE2C26A5_PROFILER
/** Production-like JIT: the heap flag alone (no --no-turbo-inlining / --no-maglev-inlining diagnostic in this phase). */
export const PHASE2C26B2C2B2H_NODE_FLAGS: readonly string[] = [`--max-old-space-size=${PHASE2C26B2C2B2H_CHILD_HEAP_MB}`]
/** The only intended difference from B2-C2B2G's launch (the analyzer checks every other registered condition is equal). */
export const PHASE2C26B2C2B2H_CHANGED_FROM_B2C2B2G = ['cpuProfiler'] as const
/** The Research-side durable section stream added behind the same observers (no new Search seam). */
export const PHASE2C26B2C2B2H_SECTION_STREAM = { kind: 'gogma_boundary', perBoundary: true, perGeneratedState: false } as const
/** Provenance: B2-C2B2G's (the same oracle-guided Search input), plus what this phase adds. */
export const PHASE2C26B2C2B2H_PROVENANCE_FLAGS = {
  ...PHASE2C26B2C2B2G_PROVENANCE_FLAGS,
  cpuProfiling: true,
  absoluteRuntimeComparedWithB2C2B2G: false,
  optimization: false,
} as const
/** What B2-C2B2H deliberately does not run. */
export const PHASE2C26B2C2B2H_NOT_RUN = ['production_change', 'production_optimization', 'search_semantics_change', 'search_ordering_change', 'search_comparator_change',
  'candidate_materializer_change', 'capture_change', 'extent_change', 'context_change', 'p1_change', 'new_production_instrumentation_seam', 'new_inner_section',
  'per_state_timer_or_callback', 'no_inlining_diagnostic', 'heap_allocation_profiler', 'heap_snapshot', 'heap_16gb', 'budget_60min_or_more', 'automatic_longer_retry', 'retry',
  'timeout_fallback', 'oom_fallback', 'reserved_depth_observer', 'work_settled_observer', 'exact_route_judgement', 'e2_search', 'k2_feature_grouping', 'residual_unreached_support',
  'global_assignment', 'full_planner_rerun', 'ui_change', 'solution_materialization_optimization', 'a3_a9_result_regeneration', 'b2c2b2e_result_regeneration',
  'b2c2b2f_result_regeneration', 'b2c2b2g_result_regeneration'] as const

// ---------------------------------------------------------------- the probe manifest (a Search input)

export const PHASE2C26B2C2B2H_POPULATION = 'B2C2B2G_STATE_GENERATION_DOMINANT_PROFILED_TARGET'

export interface Phase2C26B2C2B2HProbeManifest {
  phase: string
  /** The B2-C2B2G RESULT the population was derived from and the B2-C2B2F / B2-C2B2E RESULTs its identity chains to (the Search never reads any). */
  b2c2b2gResultSha256: string
  b2c2b2fResultSha256: string
  b2c2b2eResultSha256: string
  population: typeof PHASE2C26B2C2B2H_POPULATION
  policy: 'P1'
  contextSelection: typeof PHASE2C26B2C2B2H_CONTEXT_SELECTION.id
  extentRule: typeof PHASE2C26B2C2B2H_EXTENT_RULE.id
  exportSha256: string
  probes: Phase2C26B2C2B2EProbe[]
  expectedTaskIdentities: Phase2C26B2C2B2FTaskIdentity[]
}

const MANIFEST_KEYS = ['b2c2b2eResultSha256', 'b2c2b2fResultSha256', 'b2c2b2gResultSha256', 'contextSelection', 'expectedTaskIdentities', 'exportSha256', 'extentRule', 'phase', 'policy',
  'population', 'probes']
const SHA256 = /^[0-9a-f]{64}$/

/**
 * Reads a probe manifest as untrusted JSON: exactly the manifest keys, the registered population, a B2-C2B2G RESULT SHA-256; the
 * rest (one probe and one expected identity naming the same Target / task / rank / extent, inside B2-C2B2D's bounds, B2-C2B2F /
 * B2-C2B2E RESULT SHA-256s, no extra field) is checked by B2-C2B2G's own manifest parser unchanged. No expected key / index / cost /
 * outcome / section / hotspot / measurement may ride along.
 */
export function parsePhase2C26B2C2B2HProbeManifest(json: unknown): { valid: boolean; issues: string[]; manifest: Phase2C26B2C2B2HProbeManifest | null } {
  const issues: string[] = []
  if (!isObject(json)) return { valid: false, issues: ['the probe manifest is not an object'], manifest: null }
  if (!same(Object.keys(json).sort(), MANIFEST_KEYS)) issues.push(`the probe manifest keys are not exactly ${MANIFEST_KEYS.join(', ')}`)
  if (json.population !== PHASE2C26B2C2B2H_POPULATION) issues.push(`population is not ${PHASE2C26B2C2B2H_POPULATION}`)
  if (typeof json.b2c2b2gResultSha256 !== 'string' || !SHA256.test(json.b2c2b2gResultSha256)) issues.push('b2c2b2gResultSha256 is not a SHA-256')
  const g = parsePhase2C26B2C2B2GProbeManifest({ phase: json.phase, b2c2b2fResultSha256: json.b2c2b2fResultSha256, b2c2b2eResultSha256: json.b2c2b2eResultSha256,
    population: PHASE2C26B2C2B2G_POPULATION, policy: json.policy, contextSelection: json.contextSelection, extentRule: json.extentRule, exportSha256: json.exportSha256,
    probes: json.probes, expectedTaskIdentities: json.expectedTaskIdentities })
  issues.push(...g.issues)
  if (issues.length > 0 || g.manifest === null) return { valid: false, issues, manifest: null }
  const m: Phase2C26B2C2B2GProbeManifest = g.manifest
  return { valid: true, issues: [], manifest: { phase: m.phase, b2c2b2gResultSha256: String(json.b2c2b2gResultSha256), b2c2b2fResultSha256: m.b2c2b2fResultSha256,
    b2c2b2eResultSha256: m.b2c2b2eResultSha256, population: PHASE2C26B2C2B2H_POPULATION, policy: 'P1', contextSelection: m.contextSelection, extentRule: m.extentRule,
    exportSha256: m.exportSha256, probes: m.probes, expectedTaskIdentities: m.expectedTaskIdentities } }
}

// ---------------------------------------------------------------- task construction and child calculation (B2-C2B2G's, unchanged)

export type Phase2C26B2C2B2HTaskInput = Phase2C26B2C2B2GTaskInput
export const phase2c26b2c2b2hTaskIdentity = phase2c26b2c2b2gTaskIdentity
export const phase2c26b2c2b2hChildSearchIdentity = phase2c26b2c2b2gChildSearchIdentity
export const phase2c26b2c2b2hTaskOutcome = phase2c26b2c2b2gTaskOutcome
/** The child calculation is B2-C2B2G's `runPhase2C26B2C2B2GTask()` itself (the same function object, not a copy). */
export const runPhase2C26B2C2B2HTask = runPhase2C26B2C2B2GTask

/** B2-C2B2G's `buildPhase2C26B2C2B2GTasks()` unchanged (B2-C2B2F's identity-gated construction), with this phase's task count. */
export function buildPhase2C26B2C2B2HTasks(schedule: Phase2C26B2C1Schedule, manifest: Pick<Phase2C26B2C2B2HProbeManifest, 'probes' | 'expectedTaskIdentities'>):
  { valid: boolean; issues: string[]; tasks: Phase2C26B2C2B2HTaskInput[] } {
  const built = buildPhase2C26B2C2B2GTasks(schedule, manifest)
  const issues = [...built.issues]
  if (built.valid && built.tasks.length !== PHASE2C26B2C2B2H_EXPECTED_TASKS) issues.push(`${built.tasks.length} tasks, not ${PHASE2C26B2C2B2H_EXPECTED_TASKS}`)
  return { valid: issues.length === 0, issues, tasks: issues.length === 0 ? built.tasks : [] }
}

// ---------------------------------------------------------------- the child profiler (B2-C2B2G's + durable section stream + window anchor)

/** One held-aware boundary, written durably by the child (one record per boundary; never per generated state). */
export interface Phase2C26B2C2B2HBoundaryRecord {
  kind: 'gogma_boundary'
  /** 1-based, contiguous over the run. */
  seq: number
  /** Research clock (the child's monotonic high-resolution clock the runner passes as `now`), ms, read at the boundary. */
  atMs: number
  type: ReservedGogmaRuntimeEvent['type']
  phase: ReservedGogmaRuntimePhase | null
  streamIndex: number
  depth: number
  exhausted: boolean | null
  /** The count the Search already reports (no scan): generated states at a `state_generation` completion / a depth completion, else null. */
  generatedStates: number | null
}

export interface Phase2C26B2C2B2HProfileSnapshot extends Phase2C26B2C2B2GProfileSnapshot {
  /** Durable section stream records emitted so far, and write failures (swallowed, never raised into the Search). */
  boundary: { emitted: number; writeFailures: number }
  /** Research clock of the Search start (`search_runtime` section start), the CPU profile window anchor; null before it. */
  searchStartedResearchMs: number | null
}

/** The boundary record of one held-aware event (pure). */
export function phase2c26b2c2b2hBoundaryRecord(seq: number, atMs: number, event: ReservedGogmaRuntimeEvent): Phase2C26B2C2B2HBoundaryRecord {
  const phase = event.type === 'phase_started' || event.type === 'phase_completed' ? event.phase : null
  const generated = (event.type === 'phase_completed' && event.phase === PHASE2C26B2C2B2H_SECTION) || event.type === 'depth_completed' ? event.counts.generatedStates : null
  return { kind: 'gogma_boundary', seq, atMs, type: event.type, phase, streamIndex: event.streamIndex, depth: event.depth,
    exhausted: event.type === 'depth_completed' ? event.exhausted : null, generatedStates: generated ?? null }
}

/**
 * The child-side profiler of one Search: B2-C2B2G's profiler unchanged (B2-C2B2F's outer tracker + A3's inner tracker on one frozen
 * clock, yield attribution, depth records), with the same two observers handed to the Search. Behind them, Research side only:
 * every inner boundary is also handed to `emitBoundary` (the durable section stream) after B2-C2B2G's observer, and the first
 * `search_runtime` start is reported once to `onSearchStarted` (the CPU profile window anchor). Neither callback can throw into
 * the Search: a failure is counted.
 */
export function createPhase2C26B2C2B2HProfiler(options: { now: () => number; emitBoundary: (record: Phase2C26B2C2B2HBoundaryRecord) => void;
  onSearchStarted?: (researchMs: number) => void }) {
  const g = createPhase2C26B2C2B2GProfiler({ now: options.now })
  let seq = 0
  let writeFailures = 0
  let searchStartedResearchMs: number | null = null
  const outerObserver: SearchRuntimeObserver = (event: SearchRuntimeEvent) => {
    g.outerObserver(event)
    if (searchStartedResearchMs === null && event.type === 'section_started' && event.section === 'search_runtime') {
      searchStartedResearchMs = options.now()
      try { options.onSearchStarted?.(searchStartedResearchMs) } catch { writeFailures += 1 }
    }
  }
  const innerObserver: ReservedGogmaRuntimeObserver = (event: ReservedGogmaRuntimeEvent) => {
    g.innerObserver(event)
    seq += 1
    try { options.emitBoundary(phase2c26b2c2b2hBoundaryRecord(seq, options.now(), event)) } catch { writeFailures += 1 }
  }
  return {
    /** Starts the shared Research clock (B2-C2B2G's); call immediately before the task. Returns the origin. */
    start: (): number => g.start(),
    outerObserver,
    innerObserver,
    /** Exactly the two boundary observers B2-C2B2G hands the Search. */
    instrumentation: { onSearchRuntime: outerObserver, onGogmaReservedRuntime: innerObserver } as Phase2C26B2C2B2GInstrumentation,
    /** B2-C2B2G's yield wrapper unchanged (outer and inner attribution of each Research yield wait). */
    wrapYield: (yieldControl: () => Promise<void>) => g.wrapYield(yieldControl),
    snapshot: (reason: Phase2C26B2C2B2GProfileSnapshot['reason'], windowBoundaryMs: number | null = null): Phase2C26B2C2B2HProfileSnapshot =>
      ({ ...g.snapshot(reason, windowBoundaryMs), boundary: { emitted: seq, writeFailures }, searchStartedResearchMs }),
    searchStartedAtMs: () => g.searchStartedAtMs(),
    searchStartedResearchMs: () => searchStartedResearchMs,
  }
}

// ---------------------------------------------------------------- runner start attestation (written by the runner before any child)

export const PHASE2C26B2C2B2H_START_ATTESTATION_FILE = 'start-attestation.json'
export const PHASE2C26B2C2B2H_START_ATTESTATION_PHASE = 'Issue #154 Phase 2-C2.6-B2-C2B2H runner start attestation'

/** The registered execution conditions of a formal launch. */
export function phase2c26b2c2b2hRegisteredConditions() {
  return { stage1: { ...PHASE2C26B2C2B2H_STAGE1 } as { executionClass: 'stage1'; childHeapMb: number; concurrency: number; budgetMs: number; retry: 'none'; fallback: 'none' },
    b2c2b2gStage1: { ...PHASE2C26B2C2B2H_B2C2B2G_STAGE1 }, changedStage1Fields: [...PHASE2C26B2C2B2H_CHANGED_STAGE1_FIELDS], changedFromB2C2B2G: [...PHASE2C26B2C2B2H_CHANGED_FROM_B2C2B2G],
    tasksBudgetMs: PHASE2C26B2C2B2H_TASKS_BUDGET_MS, targets: PHASE2C26B2C2B2H_TARGETS, expectedTasks: PHASE2C26B2C2B2H_EXPECTED_TASKS, population: PHASE2C26B2C2B2H_POPULATION,
    section: PHASE2C26B2C2B2H_SECTION, contextSelection: PHASE2C26B2C2B2H_CONTEXT_SELECTION.id, extentRule: PHASE2C26B2C2B2H_EXTENT_RULE.id,
    captureRule: { policy: 'C4C', maxCostCohorts: PHASE2C26B2C2B2H_MAX_COST_COHORTS, sentinel: 'first delivery of the fifth distinct operation cost (never captured)', prefixes: { ...PHASE2C26B2C2B2H_CAPTURE_PREFIXES } },
    candidateSafetyCap: PHASE2C26B2C2B2H_CANDIDATE_SAFETY_CAP, registeredP1: PHASE2C26B2C2B2H_REGISTERED_P1, nodeYield: PHASE2C26B2C2B2H_NODE_YIELD,
    memorySampleIntervalMs: PHASE2C26B2C2B2H_MEMORY_SAMPLE_INTERVAL_MS, searchInstrumentation: { ...PHASE2C26B2C2B2H_SEARCH_INSTRUMENTATION }, innerSections: [...PHASE2C26B2C2B2H_INNER_SECTIONS],
    b2c2b2gCpuProfiler: PHASE2C26B2C2B2H_B2C2B2G_CPU_PROFILER, cpuProfiler: true, cpuProfilerConfig: { ...PHASE2C26B2C2B2H_CPU_PROFILER }, nodeFlags: [...PHASE2C26B2C2B2H_NODE_FLAGS],
    sectionStream: { ...PHASE2C26B2C2B2H_SECTION_STREAM }, heartbeatIntervalMs: PHASE2C26B2C2B2H_HEARTBEAT_INTERVAL_MS, windowsMs: PHASE2C26B2C2B2H_WINDOWS_MS.map(w => [...w]),
    provenanceFlags: { ...PHASE2C26B2C2B2H_PROVENANCE_FLAGS } }
}

export interface Phase2C26B2C2B2HLaunchObservation {
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
  probeManifestB2C2B2GResultSha256: string
  probeManifestB2C2B2FResultSha256: string
  probeManifestB2C2B2EResultSha256: string
  targetWeaponIds: string[]
  probes: Phase2C26B2C2B2EProbe[]
  expectedTaskIdentities: Phase2C26B2C2B2FTaskIdentity[]
  stage1: ReturnType<typeof phase2c26b2c2b2hRegisteredConditions>['stage1']
  cpuProfilerConfig: ReturnType<typeof phase2c26b2c2b2hRegisteredConditions>['cpuProfilerConfig']
  smoke: { budgetMs: number | null; warmupMs: number | null; profileStopMs: number | null } | null
}

export type Phase2C26B2C2B2HStartAttestation = ReturnType<typeof phase2c26b2c2b2hRegisteredConditions> & Phase2C26B2C2B2HLaunchObservation & { phase: string; attestedBy: 'runner' }

export function phase2c26b2c2b2hStartAttestationBody(observation: Phase2C26B2C2B2HLaunchObservation): Phase2C26B2C2B2HStartAttestation {
  return { phase: PHASE2C26B2C2B2H_START_ATTESTATION_PHASE, attestedBy: 'runner', ...phase2c26b2c2b2hRegisteredConditions(), ...observation }
}

const ATTESTATION_KEYS = Object.keys(phase2c26b2c2b2hStartAttestationBody({ createdAt: '', runnerScript: '', node: '', repositoryHead: '', uncommittedBenchmarkCode: false, benchmarkCodeSha256: '',
  exportFileName: '', exportSha256: '', exportBytes: 0, probeManifestFileName: '', probeManifestSha256: '', probeManifestB2C2B2GResultSha256: '', probeManifestB2C2B2FResultSha256: '',
  probeManifestB2C2B2EResultSha256: '', targetWeaponIds: [], probes: [], expectedTaskIdentities: [], stage1: phase2c26b2c2b2hRegisteredConditions().stage1,
  cpuProfilerConfig: phase2c26b2c2b2hRegisteredConditions().cpuProfilerConfig, smoke: null })).sort()
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

export interface Phase2C26B2C2B2HAttestationExpectation {
  repositoryHead: string
  benchmarkCodeSha256: string
  exportSha256: string
  probeManifestSha256: string
  b2c2b2gResultSha256: string
  b2c2b2fResultSha256: string
  b2c2b2eResultSha256: string
  probes: readonly Phase2C26B2C2B2EProbe[]
  expectedTaskIdentities: readonly Phase2C26B2C2B2FTaskIdentity[]
  firstChildStartedAt: string | null
}

/**
 * Whether a start attestation proves a formal launch (B2-C2B2G's rule with this phase's marker and conditions): exactly the
 * attestation keys; runner + B2-C2B2H marker; a canonical UTC `createdAt` no later than the first child start; HEAD / benchmark
 * code / Export / manifest / B2-C2B2G, B2-C2B2F and B2-C2B2E RESULTs / Targets / probe / expected identity equal to the
 * independently obtained ones; a clean launch with no smoke option; every registered condition (30 minutes, 12,288 MB,
 * concurrency 1, no retry / fallback, the two boundary observers, the registered CPU profiler window, heap-only Node flags)
 * unchanged.
 */
export function verifyPhase2C26B2C2B2HStartAttestation(attestation: unknown, expected: Phase2C26B2C2B2HAttestationExpectation):
  { verified: boolean; issues: string[]; integrityIssues: string[] } {
  if (!isObject(attestation)) return { verified: false, issues: ['the start attestation is not an object'], integrityIssues: ['the start attestation is not an object'] }
  const integrityIssues: string[] = []
  const launchIssues: string[] = []
  if (!same(Object.keys(attestation).sort(), ATTESTATION_KEYS)) integrityIssues.push('the start attestation keys are not exactly the attestation keys')
  if (attestation.attestedBy !== 'runner') integrityIssues.push('not attested by the runner')
  if (attestation.phase !== PHASE2C26B2C2B2H_START_ATTESTATION_PHASE) integrityIssues.push('not a B2-C2B2H start attestation')
  if (typeof attestation.createdAt !== 'string' || !ISO_UTC.test(attestation.createdAt) || new Date(attestation.createdAt).toISOString() !== attestation.createdAt) integrityIssues.push('createdAt is not a canonical UTC time')
  else if (expected.firstChildStartedAt !== null && !(attestation.createdAt <= expected.firstChildStartedAt)) integrityIssues.push('createdAt is later than the first child start')
  if (typeof attestation.repositoryHead !== 'string' || !/^[0-9a-f]{40}$/.test(attestation.repositoryHead)) integrityIssues.push('repositoryHead is not a commit SHA')
  if (attestation.repositoryHead !== expected.repositoryHead) integrityIssues.push('repositoryHead differs')
  if (attestation.benchmarkCodeSha256 !== expected.benchmarkCodeSha256) integrityIssues.push('benchmarkCodeSha256 differs')
  if (attestation.exportSha256 !== expected.exportSha256) integrityIssues.push('exportSha256 differs')
  if (attestation.probeManifestSha256 !== expected.probeManifestSha256) integrityIssues.push('probeManifestSha256 differs')
  if (attestation.probeManifestB2C2B2GResultSha256 !== expected.b2c2b2gResultSha256) integrityIssues.push('probeManifestB2C2B2GResultSha256 is not the registered B2-C2B2G RESULT')
  if (attestation.probeManifestB2C2B2FResultSha256 !== expected.b2c2b2fResultSha256) integrityIssues.push('probeManifestB2C2B2FResultSha256 is not the registered B2-C2B2F RESULT')
  if (attestation.probeManifestB2C2B2EResultSha256 !== expected.b2c2b2eResultSha256) integrityIssues.push('probeManifestB2C2B2EResultSha256 is not the registered B2-C2B2E RESULT')
  if (!same(attestation.targetWeaponIds, expected.probes.map(p => p.targetWeaponId))) integrityIssues.push('targetWeaponIds differ')
  if (!same(attestation.probes, expected.probes)) integrityIssues.push('probes differ')
  if (!same(attestation.expectedTaskIdentities, expected.expectedTaskIdentities)) integrityIssues.push('expectedTaskIdentities differ')
  if (attestation.uncommittedBenchmarkCode !== false) launchIssues.push('uncommitted benchmark code at launch')
  if (attestation.smoke !== null) launchIssues.push('a smoke option at launch')
  for (const [field, value] of Object.entries(phase2c26b2c2b2hRegisteredConditions())) if (!same(attestation[field], value)) launchIssues.push(`${field} differs from the registered condition`)
  const issues = [...integrityIssues, ...launchIssues]
  return { verified: issues.length === 0, issues, integrityIssues }
}
