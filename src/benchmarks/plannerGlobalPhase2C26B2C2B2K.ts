/**
 * Issue #154 Phase 2-C2.6-B2-C2B2K: the one B2-C2B2E Target that timed out at 60 minutes / 12 GB (the time-bound Target), searched
 * again on the current main - which holds the two adopted Production optimizations of B2-C2B2I and B2-C2B2J - in EXACTLY B2-C2B2E's
 * Search input and EXACTLY B2-C2B2E's execution conditions. Research only, and an explicitly ORACLE-GUIDED DIAGNOSTIC: never evidence
 * for a Production scheduler, a Production extent selection or an acceptable Production runtime. Never import from Production.
 *
 * Compared with B2-C2B2E's run of this Target nothing in the run changes:
 *
 * ```text
 * Search input          B2-C2B2E's task (Target, P1 rank, tight extent, group, reservation, representative, digests, excluded Route)
 * Stage 1               B2-C2B2E's: 60 minutes, 12,288 MB, concurrency 1, fresh child, no retry, no fallback
 * child calculation     B2-C2B2E's runPhase2C26B2C2B2ETask() (= B2-C2B2D's, the same function object), C4C capture, safety cap 1024
 * instrumentation       none (no section observer, no CPU profiler, no allocation profiler, no heap snapshot)
 * ```
 *
 * The one difference is the Production calculation source at the measurement HEAD: since B2-C2B2E's measured HEAD the Search holds
 * the adopted `predict_keep_nested_counter_family_cache_v1` (B2-C2B2I) and `reserved_keep_family_layout_key_reuse_v1` (B2-C2B2J).
 * This phase itself changes no Production source (its Production changed files are []).
 *
 * The Search side receives the probe manifest (Target ID, B2-C2B2E task ID, P1 rank, tight extent, and the expected Search input
 * identity - digests, never an outcome), the capture rule and the safety cap. It never receives an oracle Route, a stable key, an
 * expected Candidate index / operation cost / Route kind, B2-C2B2E's outcome, B2-C2B2I / B2-C2B2J speed-ups, or what would count as a
 * recovery, and an oracle match never stops it. The exact judgement is the analyzer's, after the run.
 */
import { stableStringify } from '../domain/models/hashing'
import type { Phase2C26B2C1Schedule } from './plannerGlobalPhase2C26B2C1'
import {
  phase2c26b2c2b2eExtentBoundIssues,
  phase2c26b2c2b2eTaskOutcome,
  runPhase2C26B2C2B2ETask,
  PHASE2C26B2C2B2E_CANDIDATE_SAFETY_CAP,
  PHASE2C26B2C2B2E_CAPTURE_PREFIXES,
  PHASE2C26B2C2B2E_COMMON_L2_EXTENT,
  PHASE2C26B2C2B2E_CONTEXT_SELECTION,
  PHASE2C26B2C2B2E_EXTENT_RULE,
  PHASE2C26B2C2B2E_FLOOR_EXTENT,
  PHASE2C26B2C2B2E_MAX_COST_COHORTS,
  PHASE2C26B2C2B2E_MEMORY_SAMPLE_INTERVAL_MS,
  PHASE2C26B2C2B2E_NODE_YIELD,
  PHASE2C26B2C2B2E_PROVENANCE_FLAGS,
  PHASE2C26B2C2B2E_REGISTERED_P1,
  PHASE2C26B2C2B2E_STAGE1,
  PHASE2C26B2C2B2E_TASKS_BUDGET_MS,
  type Phase2C26B2C2B2EChildRecord,
  type Phase2C26B2C2B2EProbe,
  type Phase2C26B2C2B2ESearchRecord,
  type Phase2C26B2C2B2ETaskInput,
  type Phase2C26B2C2B2ETaskOutcome,
} from './plannerGlobalPhase2C26B2C2B2E'
import {
  buildPhase2C26B2C2B2FTasks,
  parsePhase2C26B2C2B2FProbeManifest,
  PHASE2C26B2C2B2F_POPULATION,
  type Phase2C26B2C2B2FTaskIdentity,
} from './plannerGlobalPhase2C26B2C2B2F'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}
const SHA256 = /^[0-9a-f]{64}$/
const COMMIT = /^[0-9a-f]{40}$/

// ---------------------------------------------------------------- Research execution conditions (registered, not Production defaults)

/** The population size: the B2-C2B2E Targets with process timeout, recovery none and next-branch type time_bound (counted; the ID comes from the manifest). */
export const PHASE2C26B2C2B2K_TARGETS = 1
export const PHASE2C26B2C2B2K_CONTEXTS_PER_TARGET = 1
export const PHASE2C26B2C2B2K_EXPECTED_TASKS = PHASE2C26B2C2B2K_TARGETS * PHASE2C26B2C2B2K_CONTEXTS_PER_TARGET
/** The population label: B2-C2B2E's time-bound Target that timed out unrecovered (the population rule is B2-C2B2F's, read from the B2-C2B2E RESULT). */
export const PHASE2C26B2C2B2K_POPULATION = 'B2C2B2E_TIME_BOUND_TIMEOUT_UNRECOVERED'
/** B2-C2B2E's Stage 1 itself: 60 minutes, 12,288 MB, concurrency 1, no retry, no fallback. Nothing is changed. */
export const PHASE2C26B2C2B2K_STAGE1 = Object.freeze({ ...PHASE2C26B2C2B2E_STAGE1 }) as
  { readonly executionClass: 'stage1'; readonly childHeapMb: number; readonly concurrency: number; readonly budgetMs: number; readonly retry: 'none'; readonly fallback: 'none' }
export const PHASE2C26B2C2B2K_B2C2B2E_STAGE1 = PHASE2C26B2C2B2E_STAGE1
/** The Stage 1 fields that differ from B2-C2B2E's: none (the analyzer checks every field is equal). */
export const PHASE2C26B2C2B2K_CHANGED_STAGE1_FIELDS = [] as const
export const PHASE2C26B2C2B2K_BUDGET_MS = PHASE2C26B2C2B2E_STAGE1.budgetMs
export const PHASE2C26B2C2B2K_CHILD_HEAP_MB = PHASE2C26B2C2B2E_STAGE1.childHeapMb
/** B2-C2B2E's tasks child budget, capture, safety cap, prefixes, yield, sampling, context selection, extent rule and P1, unchanged. */
export const PHASE2C26B2C2B2K_TASKS_BUDGET_MS = PHASE2C26B2C2B2E_TASKS_BUDGET_MS
export const PHASE2C26B2C2B2K_MAX_COST_COHORTS = PHASE2C26B2C2B2E_MAX_COST_COHORTS
export const PHASE2C26B2C2B2K_CANDIDATE_SAFETY_CAP = PHASE2C26B2C2B2E_CANDIDATE_SAFETY_CAP
export const PHASE2C26B2C2B2K_CAPTURE_PREFIXES = PHASE2C26B2C2B2E_CAPTURE_PREFIXES
export const PHASE2C26B2C2B2K_NODE_YIELD = PHASE2C26B2C2B2E_NODE_YIELD
export const PHASE2C26B2C2B2K_MEMORY_SAMPLE_INTERVAL_MS = PHASE2C26B2C2B2E_MEMORY_SAMPLE_INTERVAL_MS
export const PHASE2C26B2C2B2K_CONTEXT_SELECTION = PHASE2C26B2C2B2E_CONTEXT_SELECTION
export const PHASE2C26B2C2B2K_EXTENT_RULE = PHASE2C26B2C2B2E_EXTENT_RULE
export const PHASE2C26B2C2B2K_REGISTERED_P1 = PHASE2C26B2C2B2E_REGISTERED_P1
export const PHASE2C26B2C2B2K_FLOOR_EXTENT = PHASE2C26B2C2B2E_FLOOR_EXTENT
export const PHASE2C26B2C2B2K_COMMON_L2_EXTENT = PHASE2C26B2C2B2E_COMMON_L2_EXTENT
export const phase2c26b2c2b2kExtentBoundIssues = phase2c26b2c2b2eExtentBoundIssues
/** No Search instrumentation of any kind (B2-C2B2E ran none): the Route recovery measurement is taken in B2-C2B2E's conditions. */
export const PHASE2C26B2C2B2K_INSTRUMENTATION = Object.freeze({ searchInstrumentation: 'none', cpuProfiler: false, profilingObserver: false, allocationProfiler: false, heapSnapshot: false } as const)
/** The Production calculation sources this phase changes: none. */
export const PHASE2C26B2C2B2K_PRODUCTION_CHANGED_FILES: readonly string[] = []
/**
 * The main this phase starts from: PR #210 (B2-C2B2J, `reserved_keep_family_layout_key_reuse_v1`), which also holds PR #208
 * (B2-C2B2I, `predict_keep_nested_counter_family_cache_v1`) and PR #209 (test / fixture only).
 */
export const PHASE2C26B2C2B2K_BASE_MAIN = { pullRequest: 210, sha: 'd42a5cc83f33ffaa805746f84a07af29136ef694' } as const
/** Provenance: B2-C2B2E's (the same oracle-guided Search input), plus what this phase declares. */
export const PHASE2C26B2C2B2K_PROVENANCE_FLAGS = {
  ...PHASE2C26B2C2B2E_PROVENANCE_FLAGS,
  b2c2b2eSearchInputRerun: true,
  b2c2b2eExecutionConditionsRerun: true,
  routeExactJudgedPostHoc: true,
  optimizedCurrentProductionSearch: true,
  profilingInstrumentation: false,
} as const
/** What B2-C2B2K deliberately does not run. */
export const PHASE2C26B2C2B2K_NOT_RUN = ['production_change', 'production_optimization', 'search_algorithm_change', 'search_ordering_change', 'search_comparator_change',
  'candidate_materializer_change', 'extent_change', 'context_change', 'p1_change', 'capture_change', 'safety_cap_change', 'heap_16gb', 'budget_over_60min', 'retry', 'timeout_fallback',
  'oom_fallback', 'automatic_fallback', 'cpu_profiler', 'profiling_observer', 'allocation_profiler', 'heap_snapshot', 'exact_early_stop', 'oracle_early_stop', 'context_level_early_stop',
  'b2c2b2e_recovered_target_rerun', 'e2_search', 'global_assignment', 'full_planner_rerun', 'planner_alternative_kernel', 'scheduler_redesign', 'ui_change', 'fixture_change',
  'frozen_json_change', 'b2c2b2e_result_regeneration'] as const

// ---------------------------------------------------------------- the probe manifest (a Search input)

export interface Phase2C26B2C2B2KProbeManifest {
  phase: string
  /** The B2-C2B2E RESULT the population, probe and identity were derived from (the Search never reads it). */
  b2c2b2eResultSha256: string
  /** The B2-C2B2I / B2-C2B2J RESULTs registered as the authority of the optimized Production state (the Search never reads them). */
  b2c2b2iResultSha256: string
  b2c2b2jResultSha256: string
  population: typeof PHASE2C26B2C2B2K_POPULATION
  policy: 'P1'
  contextSelection: typeof PHASE2C26B2C2B2K_CONTEXT_SELECTION.id
  extentRule: typeof PHASE2C26B2C2B2K_EXTENT_RULE.id
  exportSha256: string
  /** B2-C2B2E's probe shape (Target, B2-C2B2E task ID in its `b2c2b2dTaskId` field, P1 rank, tight extent). */
  probes: Phase2C26B2C2B2EProbe[]
  /** The expected Search input identity of the task (B2-C2B2E's task row): input digests, never an outcome. */
  expectedTaskIdentities: Phase2C26B2C2B2FTaskIdentity[]
}

const MANIFEST_KEYS = ['b2c2b2eResultSha256', 'b2c2b2iResultSha256', 'b2c2b2jResultSha256', 'contextSelection', 'expectedTaskIdentities', 'exportSha256', 'extentRule', 'phase', 'policy',
  'population', 'probes']

/**
 * Reads a probe manifest as untrusted JSON: exactly the manifest keys; the registered population; the three authority SHA-256s; and
 * for the probe and the expected identity B2-C2B2F's rules unchanged (`parsePhase2C26B2C2B2FProbeManifest()`: exactly one probe -
 * Target / task ID / P1 rank / tight extent, nothing else - and one expected identity naming it, a task ID of B2-C2B2E's shape naming
 * its own rank, an extent inside B2-C2B2D's bounds). No expected key / index / cost / Route kind / outcome / measurement may ride along.
 */
export function parsePhase2C26B2C2B2KProbeManifest(json: unknown): { valid: boolean; issues: string[]; manifest: Phase2C26B2C2B2KProbeManifest | null } {
  if (!isObject(json)) return { valid: false, issues: ['the probe manifest is not an object'], manifest: null }
  const issues: string[] = []
  if (!same(Object.keys(json).sort(), MANIFEST_KEYS)) issues.push(`the probe manifest keys are not exactly ${MANIFEST_KEYS.join(', ')}`)
  if (json.population !== PHASE2C26B2C2B2K_POPULATION) issues.push(`population is not ${PHASE2C26B2C2B2K_POPULATION}`)
  for (const key of ['b2c2b2iResultSha256', 'b2c2b2jResultSha256'] as const) if (typeof json[key] !== 'string' || !SHA256.test(json[key] as string)) issues.push(`${key} is not a SHA-256`)
  // The probe / identity part is B2-C2B2F's manifest shape (the same population rule over the same B2-C2B2E RESULT).
  const probePart = parsePhase2C26B2C2B2FProbeManifest(Object.fromEntries(Object.entries(json)
    .filter(([key]) => key !== 'b2c2b2iResultSha256' && key !== 'b2c2b2jResultSha256')
    .map(([key, value]) => [key, key === 'population' ? PHASE2C26B2C2B2F_POPULATION : value])))
  issues.push(...probePart.issues.filter(i => !i.startsWith('the probe manifest keys')))
  if (issues.length > 0 || probePart.manifest === null) return { valid: false, issues, manifest: null }
  const m = probePart.manifest
  return { valid: true, issues: [], manifest: { phase: m.phase, b2c2b2eResultSha256: m.b2c2b2eResultSha256, b2c2b2iResultSha256: String(json.b2c2b2iResultSha256),
    b2c2b2jResultSha256: String(json.b2c2b2jResultSha256), population: PHASE2C26B2C2B2K_POPULATION, policy: 'P1', contextSelection: m.contextSelection, extentRule: m.extentRule,
    exportSha256: m.exportSha256, probes: m.probes, expectedTaskIdentities: m.expectedTaskIdentities } }
}

// ---------------------------------------------------------------- task construction (B2-C2B2E's, gated by the expected identity)

export type Phase2C26B2C2B2KTaskInput = Phase2C26B2C2B2ETaskInput

/**
 * B2-C2B2F's identity-gated construction itself: B2-C2B2E's `buildPhase2C26B2C2B2ETasks()` (so B2-C2B2D's unchanged construction)
 * over the manifest probe, then every Search input identity field compared with the expected B2-C2B2E task identity. Any drift fails
 * closed with no task, so no Search runs on another input.
 */
export function buildPhase2C26B2C2B2KTasks(schedule: Phase2C26B2C1Schedule, manifest: Pick<Phase2C26B2C2B2KProbeManifest, 'probes' | 'expectedTaskIdentities'>):
  { valid: boolean; issues: string[]; tasks: Phase2C26B2C2B2KTaskInput[] } {
  const built = buildPhase2C26B2C2B2FTasks(schedule, manifest)
  const issues = [...built.issues]
  if (built.valid && built.tasks.length !== PHASE2C26B2C2B2K_EXPECTED_TASKS) issues.push(`${built.tasks.length} tasks, not ${PHASE2C26B2C2B2K_EXPECTED_TASKS}`)
  return { valid: issues.length === 0, issues, tasks: issues.length === 0 ? built.tasks : [] }
}

// ---------------------------------------------------------------- the child calculation (B2-C2B2E's = B2-C2B2D's, the same function objects)

/** The child calculation: B2-C2B2E's `runPhase2C26B2C2B2ETask()` itself (policy, rank row, rebuild, tight replacement, digests, the B2-C2B2A Search body, C4C capture). No instrumentation. */
export const runPhase2C26B2C2B2KTask = runPhase2C26B2C2B2ETask
/** A timeout / out-of-memory / failure is that failure, never "no Candidate": B2-C2B2E's rule itself. */
export const phase2c26b2c2b2kTaskOutcome = phase2c26b2c2b2eTaskOutcome
export type Phase2C26B2C2B2KSearchRecord = Phase2C26B2C2B2ESearchRecord
export type Phase2C26B2C2B2KChildRecord = Phase2C26B2C2B2EChildRecord
export type Phase2C26B2C2B2KTaskOutcome = Phase2C26B2C2B2ETaskOutcome

// ---------------------------------------------------------------- runner start attestation (written by the runner before any child)

export const PHASE2C26B2C2B2K_START_ATTESTATION_FILE = 'start-attestation.json'
export const PHASE2C26B2C2B2K_START_ATTESTATION_PHASE = 'Issue #154 Phase 2-C2.6-B2-C2B2K runner start attestation'

/** The registered execution conditions of a formal launch (the runner fills nothing of these by hand). */
export function phase2c26b2c2b2kRegisteredConditions() {
  return { stage1: { ...PHASE2C26B2C2B2K_STAGE1 } as { executionClass: 'stage1'; childHeapMb: number; concurrency: number; budgetMs: number; retry: 'none'; fallback: 'none' },
    b2c2b2eStage1: { ...PHASE2C26B2C2B2K_B2C2B2E_STAGE1 }, changedStage1Fields: [...PHASE2C26B2C2B2K_CHANGED_STAGE1_FIELDS] as string[],
    tasksBudgetMs: PHASE2C26B2C2B2K_TASKS_BUDGET_MS, targets: PHASE2C26B2C2B2K_TARGETS, contextsPerTarget: PHASE2C26B2C2B2K_CONTEXTS_PER_TARGET, expectedTasks: PHASE2C26B2C2B2K_EXPECTED_TASKS,
    population: PHASE2C26B2C2B2K_POPULATION, contextSelection: PHASE2C26B2C2B2K_CONTEXT_SELECTION.id, extentRule: PHASE2C26B2C2B2K_EXTENT_RULE.id,
    extentFloor: { ...PHASE2C26B2C2B2K_FLOOR_EXTENT }, extentCeiling: { ...PHASE2C26B2C2B2K_COMMON_L2_EXTENT },
    captureRule: { policy: 'C4C', maxCostCohorts: PHASE2C26B2C2B2K_MAX_COST_COHORTS, sentinel: 'first delivery of the fifth distinct operation cost (never captured)', prefixes: { ...PHASE2C26B2C2B2K_CAPTURE_PREFIXES } },
    candidateSafetyCap: PHASE2C26B2C2B2K_CANDIDATE_SAFETY_CAP, registeredP1: PHASE2C26B2C2B2K_REGISTERED_P1, nodeYield: PHASE2C26B2C2B2K_NODE_YIELD,
    memorySampleIntervalMs: PHASE2C26B2C2B2K_MEMORY_SAMPLE_INTERVAL_MS, instrumentation: { ...PHASE2C26B2C2B2K_INSTRUMENTATION },
    registeredProductionChangedFiles: [...PHASE2C26B2C2B2K_PRODUCTION_CHANGED_FILES], baseMain: { ...PHASE2C26B2C2B2K_BASE_MAIN },
    provenanceFlags: { ...PHASE2C26B2C2B2K_PROVENANCE_FLAGS } }
}

/** One adopted Production optimization the current main holds (read by the parent from its formal RESULT). */
export interface Phase2C26B2C2B2KAdoptedOptimization {
  phase: 'B2-C2B2I' | 'B2-C2B2J'
  id: string
  files: string[]
  resultSha256: string
  decisionCase: string
  /** The formal measured HEAD of that optimization (its files there are the optimized files). */
  measuredHead: string
}

/** The Production calculation source audit the runner takes before launch (git, working tree included). */
export interface Phase2C26B2C2B2KProductionAudit {
  /** B2-C2B2E's measured HEAD (the B2-C2B2E RESULT's). */
  b2c2b2eMeasuredHead: string
  /** Production calculation sources changed from B2-C2B2E's measured HEAD to the launch working tree. */
  productionChangedSinceB2C2B2E: string[]
  /** The union of the adopted optimizations' files (must equal the previous list). */
  adoptedOptimizationFiles: string[]
  /** Production calculation sources changed from the base main to the launch working tree (this phase's own change: must be []). */
  productionChangedSinceBaseMain: string[]
  baseMainIsAncestor: boolean
  /** Per first-parent main commit after B2-C2B2E's merge up to the base main: the Production calculation sources it changed. */
  mainCommits: { sha: string; subject: string; productionChangedFiles: string[] }[]
  /** Each adopted file at the launch is byte-identical to the file at the formal measured HEAD of the last adopted optimization that changed it. */
  optimizedFilesEqualMeasured: { file: string; measuredHead: string; equal: boolean }[]
}

/** What only the runner observes at launch (Stage 1 is the one it actually runs: a smoke budget shows here). */
export interface Phase2C26B2C2B2KLaunchObservation {
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
  /** The authority RESULT SHA-256s the manifest names and the parent hashed. */
  b2c2b2eResultSha256: string
  b2c2b2iResultSha256: string
  b2c2b2jResultSha256: string
  /** The B2-C2B2E local raw evidence files, hashed by the parent (each must equal the SHA-256 the B2-C2B2E RESULT recorded). */
  b2c2b2eEvidence: Record<string, { file: string; sha256: string | null }>
  adoptedOptimizations: Phase2C26B2C2B2KAdoptedOptimization[]
  productionAudit: Phase2C26B2C2B2KProductionAudit
  targetWeaponIds: string[]
  /** The probe and its expected identity as the manifest holds them: the oracle-guided inputs, attested. */
  probes: Phase2C26B2C2B2EProbe[]
  expectedTaskIdentities: Phase2C26B2C2B2FTaskIdentity[]
  /** The machine at launch (observation only, never a gate in code): free / total memory, other Node processes, CPU busy share over one second. */
  machine: { freeMemoryBytes: number; totalMemoryBytes: number; otherNodeProcesses: number | null; cpuBusyShare: number | null }
  stage1: ReturnType<typeof phase2c26b2c2b2kRegisteredConditions>['stage1']
  smoke: { budgetMs: number | null } | null
}

export type Phase2C26B2C2B2KStartAttestation = ReturnType<typeof phase2c26b2c2b2kRegisteredConditions> & Phase2C26B2C2B2KLaunchObservation & { phase: string; attestedBy: 'runner' }

/** The attestation body the runner writes: the registered conditions, then its launch observation (its actual Stage 1 included). */
export function phase2c26b2c2b2kStartAttestationBody(observation: Phase2C26B2C2B2KLaunchObservation): Phase2C26B2C2B2KStartAttestation {
  return { phase: PHASE2C26B2C2B2K_START_ATTESTATION_PHASE, attestedBy: 'runner', ...phase2c26b2c2b2kRegisteredConditions(), ...observation }
}

const EMPTY_AUDIT: Phase2C26B2C2B2KProductionAudit = { b2c2b2eMeasuredHead: '', productionChangedSinceB2C2B2E: [], adoptedOptimizationFiles: [], productionChangedSinceBaseMain: [],
  baseMainIsAncestor: false, mainCommits: [], optimizedFilesEqualMeasured: [] }
const ATTESTATION_KEYS = Object.keys(phase2c26b2c2b2kStartAttestationBody({ createdAt: '', runnerScript: '', node: '', repositoryHead: '', uncommittedBenchmarkCode: false, benchmarkCodeSha256: '',
  exportFileName: '', exportSha256: '', exportBytes: 0, probeManifestFileName: '', probeManifestSha256: '', b2c2b2eResultSha256: '', b2c2b2iResultSha256: '', b2c2b2jResultSha256: '',
  b2c2b2eEvidence: {}, adoptedOptimizations: [], productionAudit: EMPTY_AUDIT, targetWeaponIds: [], probes: [], expectedTaskIdentities: [],
  machine: { freeMemoryBytes: 0, totalMemoryBytes: 0, otherNodeProcesses: null, cpuBusyShare: null }, stage1: phase2c26b2c2b2kRegisteredConditions().stage1, smoke: null })).sort()
const AUDIT_KEYS = Object.keys(EMPTY_AUDIT).sort()
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

/** The independently obtained values a start attestation must equal. */
export interface Phase2C26B2C2B2KAttestationExpectation {
  repositoryHead: string
  benchmarkCodeSha256: string
  exportSha256: string
  probeManifestSha256: string
  /** The registered authority RESULT SHA-256s. */
  b2c2b2eResultSha256: string
  b2c2b2iResultSha256: string
  b2c2b2jResultSha256: string
  /** The B2-C2B2E raw evidence SHA-256s the B2-C2B2E RESULT recorded. */
  b2c2b2eEvidence: Record<string, { file: string; sha256: string }>
  adoptedOptimizations: readonly Phase2C26B2C2B2KAdoptedOptimization[]
  b2c2b2eMeasuredHead: string
  probes: readonly Phase2C26B2C2B2EProbe[]
  expectedTaskIdentities: readonly Phase2C26B2C2B2FTaskIdentity[]
  firstChildStartedAt: string | null
}

export interface Phase2C26B2C2B2KAttestationVerification {
  verified: boolean
  issues: string[]
  /** The subset that breaks the attestation's integrity (malformed / foreign / later / HEAD / code / Export / manifest / authority / evidence / probe mismatch). */
  integrityIssues: string[]
}

/**
 * Whether a start attestation proves the launch of a formal run, failing closed on anything else: exactly the attestation keys;
 * `attestedBy: 'runner'` and the B2-C2B2K phase marker; a canonical UTC `createdAt` no later than the first child start; the attested
 * HEAD / benchmark code / Export / probe manifest / B2-C2B2E, B2-C2B2I, B2-C2B2J RESULT SHA-256s, the B2-C2B2E raw evidence SHA-256s,
 * the adopted optimizations, Target IDs, probes and expected identities equal to the independently obtained ones; the Production
 * audit: the base main an ancestor, no Production calculation source changed since the base main (this phase changes none), the
 * Production change since B2-C2B2E's measured HEAD exactly the adopted optimizations' files, each byte-identical to its formal
 * measured file; a clean launch (no uncommitted code, no smoke option); and every registered condition (B2-C2B2E's Stage 1 unchanged,
 * no instrumentation, capture, safety cap, P1, yield, sampling, provenance flags) unchanged.
 */
export function verifyPhase2C26B2C2B2KStartAttestation(attestation: unknown, expected: Phase2C26B2C2B2KAttestationExpectation): Phase2C26B2C2B2KAttestationVerification {
  if (!isObject(attestation)) return { verified: false, issues: ['the start attestation is not an object'], integrityIssues: ['the start attestation is not an object'] }
  const integrityIssues: string[] = []
  const launchIssues: string[] = []
  if (!same(Object.keys(attestation).sort(), ATTESTATION_KEYS)) integrityIssues.push('the start attestation keys are not exactly the attestation keys')
  if (attestation.attestedBy !== 'runner') integrityIssues.push('not attested by the runner')
  if (attestation.phase !== PHASE2C26B2C2B2K_START_ATTESTATION_PHASE) integrityIssues.push('not a B2-C2B2K start attestation')
  if (typeof attestation.createdAt !== 'string' || !ISO_UTC.test(attestation.createdAt) || new Date(attestation.createdAt).toISOString() !== attestation.createdAt) integrityIssues.push('createdAt is not a canonical UTC time')
  else if (expected.firstChildStartedAt !== null && !(attestation.createdAt <= expected.firstChildStartedAt)) integrityIssues.push('createdAt is later than the first child start')
  if (typeof attestation.repositoryHead !== 'string' || !COMMIT.test(attestation.repositoryHead)) integrityIssues.push('repositoryHead is not a commit SHA')
  if (attestation.repositoryHead !== expected.repositoryHead) integrityIssues.push('repositoryHead differs')
  if (attestation.benchmarkCodeSha256 !== expected.benchmarkCodeSha256) integrityIssues.push('benchmarkCodeSha256 differs')
  if (attestation.exportSha256 !== expected.exportSha256) integrityIssues.push('exportSha256 differs')
  if (attestation.probeManifestSha256 !== expected.probeManifestSha256) integrityIssues.push('probeManifestSha256 differs')
  for (const key of ['b2c2b2eResultSha256', 'b2c2b2iResultSha256', 'b2c2b2jResultSha256'] as const) if (attestation[key] !== expected[key]) integrityIssues.push(`${key} is not the registered RESULT`)
  const evidence = isObject(attestation.b2c2b2eEvidence) ? attestation.b2c2b2eEvidence : {}
  if (!same(Object.keys(evidence).sort(), Object.keys(expected.b2c2b2eEvidence).sort())) integrityIssues.push('b2c2b2eEvidence does not hold exactly the registered evidence files')
  for (const [name, file] of Object.entries(expected.b2c2b2eEvidence)) {
    const attested = isObject(evidence[name]) ? evidence[name] as Json : {}
    if (attested.file !== file.file || attested.sha256 !== file.sha256) integrityIssues.push(`b2c2b2eEvidence.${name} is not the file the B2-C2B2E RESULT recorded`)
  }
  if (!same(attestation.adoptedOptimizations, expected.adoptedOptimizations)) integrityIssues.push('adoptedOptimizations differ')
  if (!same(attestation.targetWeaponIds, expected.probes.map(p => p.targetWeaponId))) integrityIssues.push('targetWeaponIds differ')
  if (!same(attestation.probes, expected.probes)) integrityIssues.push('probes differ')
  if (!same(attestation.expectedTaskIdentities, expected.expectedTaskIdentities)) integrityIssues.push('expectedTaskIdentities differ')
  const audit = isObject(attestation.productionAudit) ? attestation.productionAudit : null
  if (audit === null || !same(Object.keys(audit).sort(), AUDIT_KEYS)) integrityIssues.push('productionAudit is not an audit')
  else {
    if (audit.b2c2b2eMeasuredHead !== expected.b2c2b2eMeasuredHead) integrityIssues.push('productionAudit.b2c2b2eMeasuredHead is not the B2-C2B2E measured HEAD')
    const adoptedFiles = [...new Set(expected.adoptedOptimizations.flatMap(o => o.files))].sort()
    if (!same(audit.adoptedOptimizationFiles, adoptedFiles)) integrityIssues.push('productionAudit.adoptedOptimizationFiles are not the adopted optimizations\' files')
    if (audit.baseMainIsAncestor !== true) launchIssues.push(`the base main (PR #${PHASE2C26B2C2B2K_BASE_MAIN.pullRequest}) is not an ancestor of the launch HEAD`)
    if (!same(audit.productionChangedSinceBaseMain, PHASE2C26B2C2B2K_PRODUCTION_CHANGED_FILES)) launchIssues.push('a Production calculation source changed since the base main (this phase changes none)')
    if (!same(audit.productionChangedSinceB2C2B2E, adoptedFiles)) launchIssues.push('the Production change since the B2-C2B2E measured HEAD is not exactly the adopted optimizations\' files')
    const equal = Array.isArray(audit.optimizedFilesEqualMeasured) ? audit.optimizedFilesEqualMeasured as unknown[] : []
    if (equal.length === 0 || !equal.every(e => isObject(e) && e.equal === true)) launchIssues.push('an adopted optimization file is not the file at its formal measured HEAD')
  }
  if (attestation.uncommittedBenchmarkCode !== false) launchIssues.push('uncommitted benchmark code at launch')
  if (attestation.smoke !== null) launchIssues.push('a smoke option at launch')
  for (const [field, value] of Object.entries(phase2c26b2c2b2kRegisteredConditions())) if (!same(attestation[field], value)) launchIssues.push(`${field} differs from the registered condition`)
  const issues = [...integrityIssues, ...launchIssues]
  return { verified: issues.length === 0, issues, integrityIssues }
}
