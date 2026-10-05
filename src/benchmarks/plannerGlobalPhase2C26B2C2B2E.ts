/**
 * Issue #154 Phase 2-C2.6-B2-C2B2E: the 2 E1 ∩ L2 Targets B2-C2B2D could not measure (both its unrecovered Targets ended in a
 * 10-minute timeout), searched again in EXACTLY B2-C2B2D's Search input - the same Target, the same B2-C1 P1 first compatible
 * context and the same target-relative tight extent - with a larger execution budget only. Research only, and an explicitly
 * ORACLE-GUIDED DIAGNOSTIC: never evidence for a Production scheduler or a Production extent selection. Never import from
 * Production.
 *
 * Compared with B2-C2B2D exactly two execution conditions change, and nothing that reaches the Search:
 *
 * ```text
 * budget       10 minutes (600,000 ms) -> 60 minutes (3,600,000 ms)
 * child heap   8,192 MB                -> 12,288 MB
 * ```
 *
 * Everything else is B2-C2B2D's, by reference rather than by copy: the task construction (`buildPhase2C26B2C2B2DTasks()`), the
 * tight context (`phase2c26b2c2b2dTightContext()`), the child calculation and Search body (`runPhase2C26B2C2B2DTask()` ->
 * `runPhase2C26B2C2B2DSearch()`, the same function objects), the C4C capture and safety cap 1024, fresh child, concurrency 1,
 * setImmediate yield, 250 ms memory sampling, no retry, no fallback and the runner start attestation contract. The only
 * construction difference is the task ID: B2-C2B2D named a task `t<probe index>-r<rank>` over its 4 probes, and this phase keeps
 * that name (given per probe as `b2c2b2dTaskId`) so every task names its B2-C2B2D counterpart.
 *
 * The Search side receives a probe manifest (Target ID, B2-C2B2D task ID, P1 rank, tight extent: an oracle-guided input, declared),
 * the expected digests (to fail closed on a drift), the capture rule and the safety cap. It never receives an oracle Route, a
 * stable key, an expected Candidate index / operation cost / Search result, which outcome would count as success, or B2-C2B2D's
 * measurements, and an oracle match never stops it.
 */
import { stableStringify } from '../domain/models/hashing'
import type { Phase2C26B2C1Schedule } from './plannerGlobalPhase2C26B2C1'
import {
  buildPhase2C26B2C2B2DTasks,
  phase2c26b2c2b2dExtentBoundIssues,
  phase2c26b2c2b2dPolicyDrift,
  phase2c26b2c2b2dTaskOutcome,
  runPhase2C26B2C2B2DTask,
  PHASE2C26B2C2B2D_CANDIDATE_SAFETY_CAP,
  PHASE2C26B2C2B2D_CAPTURE_PREFIXES,
  PHASE2C26B2C2B2D_COMMON_L2_EXTENT,
  PHASE2C26B2C2B2D_CONTEXT_SELECTION,
  PHASE2C26B2C2B2D_EXTENT_RULE,
  PHASE2C26B2C2B2D_FLOOR_EXTENT,
  PHASE2C26B2C2B2D_MAX_CONTEXT_RANK,
  PHASE2C26B2C2B2D_MAX_COST_COHORTS,
  PHASE2C26B2C2B2D_MEMORY_SAMPLE_INTERVAL_MS,
  PHASE2C26B2C2B2D_NODE_YIELD,
  PHASE2C26B2C2B2D_PROBE_SOURCE,
  PHASE2C26B2C2B2D_PROVENANCE_FLAGS,
  PHASE2C26B2C2B2D_REGISTERED_P1,
  PHASE2C26B2C2B2D_STAGE1,
  PHASE2C26B2C2B2D_TASKS_BUDGET_MS,
  type Phase2C26B2C2B2DChildRecord,
  type Phase2C26B2C2B2DProbe,
  type Phase2C26B2C2B2DSearchRecord,
  type Phase2C26B2C2B2DTaskInput,
  type Phase2C26B2C2B2DTaskOutcome,
} from './plannerGlobalPhase2C26B2C2B2D'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0

// ---------------------------------------------------------------- Research execution conditions (registered, not Production defaults)

/** The population size: the B2-C2B2D Targets with no exact Route and an unmeasured (timeout / out-of-memory) task (counted here; the IDs come from the probe manifest). */
export const PHASE2C26B2C2B2E_TARGETS = 2
/** One context per Target: B2-C2B2D's (its B2-C1 P1 first compatible rank). */
export const PHASE2C26B2C2B2E_CONTEXTS_PER_TARGET = 1
export const PHASE2C26B2C2B2E_EXPECTED_TASKS = PHASE2C26B2C2B2E_TARGETS * PHASE2C26B2C2B2E_CONTEXTS_PER_TARGET
/** The B2-C2B2D Stage 1 this phase extends (10 minutes, heap 8192 MB). */
export const PHASE2C26B2C2B2E_B2C2B2D_STAGE1 = PHASE2C26B2C2B2D_STAGE1
/** The extended budget: 60 minutes. Never more in this phase (no 60-minute-plus run). */
export const PHASE2C26B2C2B2E_BUDGET_MS = 3_600_000
/** The extended child heap: 12 GB. Never 16 GB in this phase (no automatic fallback). */
export const PHASE2C26B2C2B2E_CHILD_HEAP_MB = 12_288
/**
 * Stage 1: B2-C2B2D's with the budget and the heap raised and nothing else: fresh child, concurrency 1, no retry, no fallback
 * (a 60-minute timeout stays unmeasured; a 12 GB out-of-memory stays out-of-memory).
 */
export const PHASE2C26B2C2B2E_STAGE1 = Object.freeze({ ...PHASE2C26B2C2B2D_STAGE1, childHeapMb: PHASE2C26B2C2B2E_CHILD_HEAP_MB, budgetMs: PHASE2C26B2C2B2E_BUDGET_MS }) as
  { readonly executionClass: 'stage1'; readonly childHeapMb: number; readonly concurrency: number; readonly budgetMs: number; readonly retry: 'none'; readonly fallback: 'none' }
/** The only intended differences from B2-C2B2D's Stage 1 (the analyzer checks every other field is equal). */
export const PHASE2C26B2C2B2E_CHANGED_STAGE1_FIELDS = ['budgetMs', 'childHeapMb'] as const
/** The tasks child (schedule re-derivation + task construction, no Search): B2-C2B2D's budget, and the Stage 1 heap. */
export const PHASE2C26B2C2B2E_TASKS_BUDGET_MS = PHASE2C26B2C2B2D_TASKS_BUDGET_MS
/** B2-C2B2D's capture rule (C4C), safety cap, prefixes, yield and sampling, unchanged. */
export const PHASE2C26B2C2B2E_MAX_COST_COHORTS = PHASE2C26B2C2B2D_MAX_COST_COHORTS
export const PHASE2C26B2C2B2E_CANDIDATE_SAFETY_CAP = PHASE2C26B2C2B2D_CANDIDATE_SAFETY_CAP
export const PHASE2C26B2C2B2E_CAPTURE_PREFIXES = PHASE2C26B2C2B2D_CAPTURE_PREFIXES
export const PHASE2C26B2C2B2E_NODE_YIELD = PHASE2C26B2C2B2D_NODE_YIELD
export const PHASE2C26B2C2B2E_MEMORY_SAMPLE_INTERVAL_MS = PHASE2C26B2C2B2D_MEMORY_SAMPLE_INTERVAL_MS
/** B2-C2B2D's context selection and extent rule (the probes carry B2-C2B2D's values, re-derived and checked by the Targets module). */
export const PHASE2C26B2C2B2E_CONTEXT_SELECTION = PHASE2C26B2C2B2D_CONTEXT_SELECTION
export const PHASE2C26B2C2B2E_EXTENT_RULE = PHASE2C26B2C2B2D_EXTENT_RULE
export const PHASE2C26B2C2B2E_REGISTERED_P1 = PHASE2C26B2C2B2D_REGISTERED_P1
export const phase2c26b2c2b2ePolicyDrift = phase2c26b2c2b2dPolicyDrift
/** The provenance declarations of this phase: B2-C2B2D's, unchanged (the same oracle-guided Search input). */
export const PHASE2C26B2C2B2E_PROVENANCE_FLAGS = PHASE2C26B2C2B2D_PROVENANCE_FLAGS
/** What B2-C2B2E deliberately does not run. */
export const PHASE2C26B2C2B2E_NOT_RUN = ['production_change', 'production_default_extent_change', 'production_extent_selector', 'production_rung_selector', 'production_scheduler_adoption',
  'heap_16gb_retry', 'budget_over_60min', 'retry', 'timeout_fallback', 'oom_fallback', 'automatic_fallback', 'b2c2b2d_recovered_target_rerun', 'b2c2b2c_timeout_retry', 'b2c2b2b_timeout_retry',
  'context_change', 'extent_change', 'common_l2_search', 'search_algorithm_change', 'search_ordering_change', 'search_comparator_change', 'search_optimization', 'p1_change', 'capture_change',
  'e2_search', 'k2_feature_grouping', 'residual_unreached_support', 'context_level_early_stop', 'exact_early_stop', 'candidate_trial', 'planner_alternative_kernel', 'full_planner_rerun',
  'global_assignment', 'ui_change', 'b2c2b2d_result_regeneration', 'b2c2b2c_result_regeneration'] as const

/** The probe source: the B2-C2B1 RESULT B2-C2B2D's probes came from, and this phase's population label. */
export const PHASE2C26B2C2B2E_PROBE_SOURCE = { resultSha256: PHASE2C26B2C2B2D_PROBE_SOURCE.resultSha256, population: 'E1_L2_B2C2B2D_UNMEASURED_UNRECOVERED', policy: 'P1' } as const

/** The bounds of a tight extent: B2-C2B2D's rule (Production default <= tight <= common L2, strictly below L2 somewhere), unchanged. */
export const phase2c26b2c2b2eExtentBoundIssues = phase2c26b2c2b2dExtentBoundIssues
export const PHASE2C26B2C2B2E_FLOOR_EXTENT = PHASE2C26B2C2B2D_FLOOR_EXTENT
export const PHASE2C26B2C2B2E_COMMON_L2_EXTENT = PHASE2C26B2C2B2D_COMMON_L2_EXTENT

// ---------------------------------------------------------------- the probe manifest (a Search input)

/** One probe: B2-C2B2D's probe of a Target (Target, selected P1 rank, tight extent) plus B2-C2B2D's task ID of it. Nothing else. */
export interface Phase2C26B2C2B2EProbe extends Phase2C26B2C2B2DProbe {
  b2c2b2dTaskId: string
}

export interface Phase2C26B2C2B2EProbeManifest {
  phase: string
  sourceResultSha256: string
  /** The B2-C2B2D RESULT the population and the probes were re-derived against (the Search never reads it). */
  b2c2b2dResultSha256: string
  population: typeof PHASE2C26B2C2B2E_PROBE_SOURCE.population
  policy: 'P1'
  contextSelection: typeof PHASE2C26B2C2B2E_CONTEXT_SELECTION.id
  extentRule: typeof PHASE2C26B2C2B2E_EXTENT_RULE.id
  exportSha256: string
  probes: Phase2C26B2C2B2EProbe[]
}

const MANIFEST_KEYS = ['b2c2b2dResultSha256', 'contextSelection', 'exportSha256', 'extentRule', 'phase', 'policy', 'population', 'probes', 'sourceResultSha256']
const PROBE_KEYS = ['b2c2b2dTaskId', 'contextRank', 'extent', 'targetWeaponId']
const SHA256 = /^[0-9a-f]{64}$/
/** B2-C2B2D's task ID shape: `t<B2-C2B2D probe index>-r<rank>`. */
const TASK_ID = /^t(\d{2})-r(\d{2})$/

/**
 * Reads a probe manifest as untrusted JSON: exactly the manifest keys and, per probe, exactly Target ID / B2-C2B2D task ID / P1
 * rank / extent (nothing else may ride along); the registered source RESULT, population, policy, context selection and extent
 * rule; 2 probes with distinct Target IDs in ascending order, P1 ranks in 1..32, extents inside B2-C2B2D's bounds, and task IDs of
 * B2-C2B2D's shape naming the probe's own rank, distinct and in ascending order.
 */
export function parsePhase2C26B2C2B2EProbeManifest(json: unknown): { valid: boolean; issues: string[]; manifest: Phase2C26B2C2B2EProbeManifest | null } {
  const issues: string[] = []
  if (!isObject(json)) return { valid: false, issues: ['the probe manifest is not an object'], manifest: null }
  if (!same(Object.keys(json).sort(), MANIFEST_KEYS)) issues.push(`the probe manifest keys are not exactly ${MANIFEST_KEYS.join(', ')}`)
  if (json.sourceResultSha256 !== PHASE2C26B2C2B2E_PROBE_SOURCE.resultSha256) issues.push('sourceResultSha256 is not the registered B2-C2B1 RESULT')
  if (json.population !== PHASE2C26B2C2B2E_PROBE_SOURCE.population) issues.push(`population is not ${PHASE2C26B2C2B2E_PROBE_SOURCE.population}`)
  if (json.policy !== PHASE2C26B2C2B2E_PROBE_SOURCE.policy) issues.push('policy is not P1')
  if (json.contextSelection !== PHASE2C26B2C2B2E_CONTEXT_SELECTION.id) issues.push('contextSelection is not the registered context selection')
  if (json.extentRule !== PHASE2C26B2C2B2E_EXTENT_RULE.id) issues.push('extentRule is not the registered extent rule')
  if (typeof json.exportSha256 !== 'string' || !SHA256.test(json.exportSha256)) issues.push('exportSha256 is not a SHA-256')
  if (typeof json.b2c2b2dResultSha256 !== 'string' || !SHA256.test(json.b2c2b2dResultSha256)) issues.push('b2c2b2dResultSha256 is not a SHA-256')
  if (typeof json.phase !== 'string') issues.push('phase is not a string')
  const probes: Phase2C26B2C2B2EProbe[] = []
  if (!Array.isArray(json.probes)) issues.push('probes is not a list')
  else {
    for (const raw of json.probes as unknown[]) {
      if (!isObject(raw) || !same(Object.keys(raw).sort(), PROBE_KEYS)) { issues.push(`a probe's keys are not exactly ${PROBE_KEYS.join(', ')}`); continue }
      if (typeof raw.targetWeaponId !== 'string' || raw.targetWeaponId.length === 0) { issues.push('a probe has no Target ID'); continue }
      if (!Number.isSafeInteger(raw.contextRank) || (raw.contextRank as number) < 1 || (raw.contextRank as number) > PHASE2C26B2C2B2D_MAX_CONTEXT_RANK) {
        issues.push(`${raw.targetWeaponId}: the P1 rank is not in 1..${PHASE2C26B2C2B2D_MAX_CONTEXT_RANK}`); continue
      }
      const id = typeof raw.b2c2b2dTaskId === 'string' ? TASK_ID.exec(raw.b2c2b2dTaskId) : null
      if (id === null || Number(id[2]) !== raw.contextRank) { issues.push(`${raw.targetWeaponId}: the B2-C2B2D task ID is not t<index>-r<its own rank>`); continue }
      const bound = phase2c26b2c2b2eExtentBoundIssues(raw.extent)
      if (bound.length > 0) { issues.push(...bound.map(i => `${raw.targetWeaponId}: ${i}`)); continue }
      const extent = raw.extent as Json
      probes.push({ targetWeaponId: raw.targetWeaponId, b2c2b2dTaskId: raw.b2c2b2dTaskId as string, contextRank: raw.contextRank as number,
        extent: { maxNormalAdvance: extent.maxNormalAdvance as number, maxGogmaAdvance: extent.maxGogmaAdvance as number, maxSkillAdvance: extent.maxSkillAdvance as number } })
    }
    if ((json.probes as unknown[]).length !== PHASE2C26B2C2B2E_TARGETS) issues.push(`probes holds ${(json.probes as unknown[]).length} probes, not ${PHASE2C26B2C2B2E_TARGETS}`)
    const ids = probes.map(p => p.targetWeaponId)
    if (new Set(ids).size !== ids.length) issues.push('a probe Target repeats')
    if (!same(ids, [...ids].sort(compare))) issues.push('the probes are not in ascending Target order')
    const taskIds = probes.map(p => p.b2c2b2dTaskId)
    if (new Set(taskIds).size !== taskIds.length) issues.push('a B2-C2B2D task ID repeats')
    if (!same(taskIds, [...taskIds].sort(compare))) issues.push('the B2-C2B2D task IDs are not in ascending order')
  }
  if (issues.length > 0) return { valid: false, issues, manifest: null }
  return { valid: true, issues: [], manifest: { phase: String(json.phase), sourceResultSha256: String(json.sourceResultSha256), b2c2b2dResultSha256: String(json.b2c2b2dResultSha256),
    population: PHASE2C26B2C2B2E_PROBE_SOURCE.population, policy: 'P1', contextSelection: PHASE2C26B2C2B2E_CONTEXT_SELECTION.id, extentRule: PHASE2C26B2C2B2E_EXTENT_RULE.id,
    exportSha256: String(json.exportSha256), probes } }
}

// ---------------------------------------------------------------- task construction (B2-C2B2D's, renamed to B2-C2B2D's task IDs)

/** What a Search child receives: B2-C2B2D's task shape, unchanged. */
export type Phase2C26B2C2B2ETaskInput = Phase2C26B2C2B2DTaskInput

export interface Phase2C26B2C2B2ETaskConstruction {
  valid: boolean
  issues: string[]
  tasks: Phase2C26B2C2B2ETaskInput[]
}

/**
 * One task per probe, in probe order, by B2-C2B2D's unchanged `buildPhase2C26B2C2B2DTasks()` over the probes' Target / rank /
 * tight extent; the only change is the task ID, which becomes the probe's B2-C2B2D task ID (B2-C2B2D numbered its 4 probes, this
 * phase holds 2 of them). Fails closed on every B2-C2B2D construction issue, a task count other than the probe count, or a task
 * whose Target / rank / extent is not its probe's.
 */
export function buildPhase2C26B2C2B2ETasks(schedule: Phase2C26B2C1Schedule, probes: readonly Phase2C26B2C2B2EProbe[]): Phase2C26B2C2B2ETaskConstruction {
  const built = buildPhase2C26B2C2B2DTasks(schedule, probes.map(p => ({ targetWeaponId: p.targetWeaponId, contextRank: p.contextRank, extent: { ...p.extent } })))
  const issues = [...built.issues]
  if (built.valid && built.tasks.length !== probes.length) issues.push(`${built.tasks.length} tasks, not ${probes.length}`)
  const tasks = built.tasks.map((task, index) => ({ ...task, taskId: probes[index]!.b2c2b2dTaskId }))
  tasks.forEach((task, index) => {
    const probe = probes[index]!
    if (task.targetWeaponId !== probe.targetWeaponId || task.contextRank !== probe.contextRank || !same(task.extent, probe.extent)) issues.push(`${probe.targetWeaponId}: the task is not the probe`)
  })
  if (new Set(tasks.map(t => t.taskId)).size !== tasks.length) issues.push('a task ID repeats')
  return { valid: issues.length === 0, issues, tasks: issues.length === 0 ? tasks : [] }
}

// ---------------------------------------------------------------- the child calculation (B2-C2B2D's, the same function objects)

/** The child calculation: B2-C2B2D's `runPhase2C26B2C2B2DTask()` itself (policy, rank row, rebuild, tight replacement, digests, the B2-C2B2A Search body, C4C capture). */
export const runPhase2C26B2C2B2ETask = runPhase2C26B2C2B2DTask
/** A timeout / out-of-memory / failure is that failure, never "no Candidate": B2-C2B2D's rule itself. */
export const phase2c26b2c2b2eTaskOutcome = phase2c26b2c2b2dTaskOutcome
export type Phase2C26B2C2B2ESearchRecord = Phase2C26B2C2B2DSearchRecord
export type Phase2C26B2C2B2EChildRecord = Phase2C26B2C2B2DChildRecord
export type Phase2C26B2C2B2ETaskOutcome = Phase2C26B2C2B2DTaskOutcome

// ---------------------------------------------------------------- runner start attestation (written by the runner before any child)

export const PHASE2C26B2C2B2E_START_ATTESTATION_FILE = 'start-attestation.json'
export const PHASE2C26B2C2B2E_START_ATTESTATION_PHASE = 'Issue #154 Phase 2-C2.6-B2-C2B2E runner start attestation'

/** The registered execution conditions of a formal launch (the runner fills nothing of these by hand). */
export function phase2c26b2c2b2eRegisteredConditions() {
  return { stage1: { ...PHASE2C26B2C2B2E_STAGE1 } as { executionClass: 'stage1'; childHeapMb: number; concurrency: number; budgetMs: number; retry: 'none'; fallback: 'none' },
    b2c2b2dStage1: { ...PHASE2C26B2C2B2E_B2C2B2D_STAGE1 }, changedStage1Fields: [...PHASE2C26B2C2B2E_CHANGED_STAGE1_FIELDS],
    tasksBudgetMs: PHASE2C26B2C2B2E_TASKS_BUDGET_MS, targets: PHASE2C26B2C2B2E_TARGETS, contextsPerTarget: PHASE2C26B2C2B2E_CONTEXTS_PER_TARGET, expectedTasks: PHASE2C26B2C2B2E_EXPECTED_TASKS,
    population: PHASE2C26B2C2B2E_PROBE_SOURCE.population, contextSelection: PHASE2C26B2C2B2E_CONTEXT_SELECTION.id, extentRule: PHASE2C26B2C2B2E_EXTENT_RULE.id,
    extentFloor: { ...PHASE2C26B2C2B2E_FLOOR_EXTENT }, extentCeiling: { ...PHASE2C26B2C2B2E_COMMON_L2_EXTENT },
    captureRule: { policy: 'C4C', maxCostCohorts: PHASE2C26B2C2B2E_MAX_COST_COHORTS, sentinel: 'first delivery of the fifth distinct operation cost (never captured)', prefixes: { ...PHASE2C26B2C2B2E_CAPTURE_PREFIXES } },
    candidateSafetyCap: PHASE2C26B2C2B2E_CANDIDATE_SAFETY_CAP, registeredP1: PHASE2C26B2C2B2E_REGISTERED_P1, nodeYield: PHASE2C26B2C2B2E_NODE_YIELD,
    memorySampleIntervalMs: PHASE2C26B2C2B2E_MEMORY_SAMPLE_INTERVAL_MS, provenanceFlags: { ...PHASE2C26B2C2B2E_PROVENANCE_FLAGS } }
}

/** What only the runner observes at launch (Stage 1 is the one it actually runs: a smoke budget shows here). */
export interface Phase2C26B2C2B2ELaunchObservation {
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
  probeManifestB2C2B2DResultSha256: string
  targetWeaponIds: string[]
  /** The probes as the manifest holds them (Target, B2-C2B2D task ID, selected P1 rank, tight extent): the oracle-guided inputs, attested. */
  probes: Phase2C26B2C2B2EProbe[]
  stage1: ReturnType<typeof phase2c26b2c2b2eRegisteredConditions>['stage1']
  smoke: { taskIds: string[] | null; budgetMs: number | null } | null
}

export type Phase2C26B2C2B2EStartAttestation = ReturnType<typeof phase2c26b2c2b2eRegisteredConditions> & Phase2C26B2C2B2ELaunchObservation & { phase: string; attestedBy: 'runner' }

/** The attestation body the runner writes: the registered conditions, then its launch observation (its actual Stage 1 included). */
export function phase2c26b2c2b2eStartAttestationBody(observation: Phase2C26B2C2B2ELaunchObservation): Phase2C26B2C2B2EStartAttestation {
  return { phase: PHASE2C26B2C2B2E_START_ATTESTATION_PHASE, attestedBy: 'runner', ...phase2c26b2c2b2eRegisteredConditions(), ...observation }
}

const ATTESTATION_KEYS = Object.keys(phase2c26b2c2b2eStartAttestationBody({ createdAt: '', runnerScript: '', node: '', repositoryHead: '', uncommittedBenchmarkCode: false, benchmarkCodeSha256: '',
  exportFileName: '', exportSha256: '', exportBytes: 0, probeManifestFileName: '', probeManifestSha256: '', probeManifestSourceResultSha256: '', probeManifestB2C2B2DResultSha256: '',
  targetWeaponIds: [], probes: [], stage1: phase2c26b2c2b2eRegisteredConditions().stage1, smoke: null })).sort()
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

/** The independently obtained values a start attestation must equal. */
export interface Phase2C26B2C2B2EAttestationExpectation {
  repositoryHead: string
  benchmarkCodeSha256: string
  exportSha256: string
  probeManifestSha256: string
  /** The B2-C2B2D RESULT SHA-256 the probe manifest must name (the registered one). */
  b2c2b2dResultSha256: string
  probes: readonly Phase2C26B2C2B2EProbe[]
  firstChildStartedAt: string | null
}

export interface Phase2C26B2C2B2EAttestationVerification {
  verified: boolean
  issues: string[]
  /** The subset that breaks the attestation's integrity (malformed / foreign / later / HEAD / code / Export / manifest / probe mismatch). */
  integrityIssues: string[]
}

/**
 * Whether a start attestation proves the launch of a formal run, failing closed on anything else (B2-C2B2D's rule with this
 * phase's marker, probes and B2-C2B2D RESULT): exactly the attestation keys; `attestedBy: 'runner'` and the B2-C2B2E phase
 * marker; a canonical UTC `createdAt` no later than the first child start; the attested HEAD / benchmark code SHA-256 / Export
 * SHA-256 / probe manifest SHA-256 / B2-C2B2D RESULT SHA-256 / Target IDs / probes equal to the independently obtained ones; a
 * clean launch (`uncommittedBenchmarkCode === false`, no smoke option); and every registered condition (Stage 1 at 60 minutes /
 * 12,288 MB, B2-C2B2D's Stage 1, Targets, tasks, context selection, extent rule and bounds, capture rule, safety cap, P1, yield,
 * sampling, provenance flags) unchanged.
 */
export function verifyPhase2C26B2C2B2EStartAttestation(attestation: unknown, expected: Phase2C26B2C2B2EAttestationExpectation): Phase2C26B2C2B2EAttestationVerification {
  if (!isObject(attestation)) return { verified: false, issues: ['the start attestation is not an object'], integrityIssues: ['the start attestation is not an object'] }
  const integrityIssues: string[] = []
  const launchIssues: string[] = []
  if (!same(Object.keys(attestation).sort(), ATTESTATION_KEYS)) integrityIssues.push('the start attestation keys are not exactly the attestation keys')
  if (attestation.attestedBy !== 'runner') integrityIssues.push('not attested by the runner')
  if (attestation.phase !== PHASE2C26B2C2B2E_START_ATTESTATION_PHASE) integrityIssues.push('not a B2-C2B2E start attestation')
  if (typeof attestation.createdAt !== 'string' || !ISO_UTC.test(attestation.createdAt) || new Date(attestation.createdAt).toISOString() !== attestation.createdAt) integrityIssues.push('createdAt is not a canonical UTC time')
  else if (expected.firstChildStartedAt !== null && !(attestation.createdAt <= expected.firstChildStartedAt)) integrityIssues.push('createdAt is later than the first child start')
  if (typeof attestation.repositoryHead !== 'string' || !/^[0-9a-f]{40}$/.test(attestation.repositoryHead)) integrityIssues.push('repositoryHead is not a commit SHA')
  if (attestation.repositoryHead !== expected.repositoryHead) integrityIssues.push('repositoryHead differs')
  if (attestation.benchmarkCodeSha256 !== expected.benchmarkCodeSha256) integrityIssues.push('benchmarkCodeSha256 differs')
  if (attestation.exportSha256 !== expected.exportSha256) integrityIssues.push('exportSha256 differs')
  if (attestation.probeManifestSha256 !== expected.probeManifestSha256) integrityIssues.push('probeManifestSha256 differs')
  if (attestation.probeManifestSourceResultSha256 !== PHASE2C26B2C2B2E_PROBE_SOURCE.resultSha256) integrityIssues.push('probeManifestSourceResultSha256 is not the registered B2-C2B1 RESULT')
  if (attestation.probeManifestB2C2B2DResultSha256 !== expected.b2c2b2dResultSha256) integrityIssues.push('probeManifestB2C2B2DResultSha256 is not the registered B2-C2B2D RESULT')
  if (!same(attestation.targetWeaponIds, expected.probes.map(p => p.targetWeaponId))) integrityIssues.push('targetWeaponIds differ')
  if (!same(attestation.probes, expected.probes)) integrityIssues.push('probes differ')
  if (attestation.uncommittedBenchmarkCode !== false) launchIssues.push('uncommitted benchmark code at launch')
  if (attestation.smoke !== null) launchIssues.push('a smoke option at launch')
  for (const [field, value] of Object.entries(phase2c26b2c2b2eRegisteredConditions())) if (!same(attestation[field], value)) launchIssues.push(`${field} differs from the registered condition`)
  const issues = [...integrityIssues, ...launchIssues]
  return { verified: issues.length === 0, issues, integrityIssues }
}
