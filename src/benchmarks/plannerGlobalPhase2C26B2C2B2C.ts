/**
 * Issue #154 Phase 2-C2.6-B2-C2B2C: the E1 Targets whose first covering ladder rung B2-C2B1 characterized as L2 (the
 * "L2-needed" 4), searched in their P1 top-32 reservation contexts with ONE common Research extent, L2. Research only. Never
 * import from Production.
 *
 * B2-C2B2B searched the 7 E1 ∩ L1 Targets at the common L1 extent and recovered 7 / 7 (C4C) with 33 timeouts left
 * (B2C2B2B_INCOMPLETE). The other 4 E1 Routes need more than L1 (B2-C2B1). B2-C2B2C asks whether the same mechanism at the
 * common L2 extent delivers their oracle Routes, so that E1 can be read as "L1-covered 7 + L2-needed 4" under the registered
 * Research ladder. The Search itself is B2-C2B2A's L2 Search, unchanged (the same extent, context replacement, capture and
 * child calculation); only the population differs:
 *
 * ```text
 * Export
 *   -> derivePhase2C26B2C1Schedule()              (unchanged B2-C1 calculation and P1 ranks; its extent stays the Production
 *                                                  default: reservation universe, ordering, digests, fixed sets unchanged)
 *   -> per E1 ∩ L2 Target: P1 rank 1..32          (mechanically, every rank, no early stop)
 *   -> reconstructPhase2C26B2B2AContext()         (unchanged: origin, reservation, excluded current Route, default extent)
 *   -> phase2c26b2c2b2aL2Context()                (B2-C2B2A's: the extent alone replaced by L2; every other field checked
 *                                                  unchanged, the Search input digest recomputed by the unchanged B1 digest)
 *   -> visitPlannerAlternativeCandidates()        (unchanged Production Search at L2, through runPhase2C26B2C2B2ASearch())
 *   -> capture: the unchanged B2-C2A C4C rule (4 distinct operation-cost cohorts drained, 5th cost = sentinel, safety cap 1024)
 * ```
 *
 * The Search side receives the Target IDs (a population chosen post hoc, declared), the P1 rank, the expected digests (to
 * fail closed on a drift), the common L2 extent, the capture rule and the safety cap. It never receives an oracle Route, a
 * stable key, an expected rank / index / cost, a first-compatible context, a ladder rung of its own or any Target-specific
 * required extent, and an oracle match never stops it: every Target is searched at every rank 1..32.
 *
 * The runner start attestation is B2-C2B2B's contract, re-registered for this phase (its own phase marker and conditions).
 */
import { stableStringify } from '../domain/models/hashing'
import { defaultPlannerAlternativeSearchExtent, type PlannerAlternativeSearchExtent } from '../domain/search'
import type { Phase2C26B2B2AContext } from './plannerGlobalPhase2C26B2B2A'
import type { Phase2C26B2C1Schedule } from './plannerGlobalPhase2C26B2C1'
import {
  buildPhase2C26B2C2B2ATasks,
  phase2c26b2c2b2aL2Context,
  phase2c26b2c2b2aPolicyDrift,
  phase2c26b2c2b2aTaskOutcome,
  runPhase2C26B2C2B2ASearch,
  runPhase2C26B2C2B2ATask,
  PHASE2C26B2C2B2A_CANDIDATE_SAFETY_CAP,
  PHASE2C26B2C2B2A_CAPTURE_PREFIXES,
  PHASE2C26B2C2B2A_CONTEXT_BUDGET,
  PHASE2C26B2C2B2A_EXTENT,
  PHASE2C26B2C2B2A_MAX_COST_COHORTS,
  PHASE2C26B2C2B2A_MEMORY_SAMPLE_INTERVAL_MS,
  PHASE2C26B2C2B2A_NODE_YIELD,
  PHASE2C26B2C2B2A_REGISTERED_P1,
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

/** The P1 context budget per Target: ranks 1..32, every one searched (B2-C2A / B2-C2B2A / B2-C2B2B unchanged). */
export const PHASE2C26B2C2B2C_CONTEXT_BUDGET = PHASE2C26B2C2B2A_CONTEXT_BUDGET
/** The population size: B2-C2B1 cohort E1 restricted to its L2-needed Routes (counted here only; the IDs come from the manifest). */
export const PHASE2C26B2C2B2C_TARGETS = 4
export const PHASE2C26B2C2B2C_EXPECTED_TASKS = PHASE2C26B2C2B2C_TARGETS * PHASE2C26B2C2B2C_CONTEXT_BUDGET
/**
 * The one common Search extent: B2-C2B1 ladder rung L2 (`larger`), the same for every Target and every context, and the very
 * extent B2-C2B2A registered. It is a Research extent registered from the E1 cohort post hoc, never a Production default and
 * never one Target's oracle value.
 */
export const PHASE2C26B2C2B2C_EXTENT: Readonly<PlannerAlternativeSearchExtent> = PHASE2C26B2C2B2A_EXTENT
export const PHASE2C26B2C2B2C_EXTENT_LABEL = 'L2' as const
/** The unchanged B2-C2A capture rule (C4C) and its post-hoc prefixes. */
export const PHASE2C26B2C2B2C_MAX_COST_COHORTS = PHASE2C26B2C2B2A_MAX_COST_COHORTS
export const PHASE2C26B2C2B2C_CANDIDATE_SAFETY_CAP = PHASE2C26B2C2B2A_CANDIDATE_SAFETY_CAP
export const PHASE2C26B2C2B2C_CAPTURE_PREFIXES = PHASE2C26B2C2B2A_CAPTURE_PREFIXES
export const PHASE2C26B2C2B2C_NODE_YIELD = PHASE2C26B2C2B2A_NODE_YIELD
export const PHASE2C26B2C2B2C_MEMORY_SAMPLE_INTERVAL_MS = PHASE2C26B2C2B2A_MEMORY_SAMPLE_INTERVAL_MS
/** The tasks child (schedule re-derivation + task construction, no Search). */
export const PHASE2C26B2C2B2C_TASKS_BUDGET_MS = PHASE2C26B2C2B2A_TASKS_BUDGET_MS
/** Stage 1, B2-C2B2A / B2-C2B2B unchanged: every task once, fresh child, heap 8 GB, concurrency 1, 10 minutes, no retry, no fallback. */
export const PHASE2C26B2C2B2C_STAGE1 = PHASE2C26B2C2B2A_STAGE1
/** What B2-C2B2C deliberately does not run. */
export const PHASE2C26B2C2B2C_NOT_RUN = ['production_change', 'production_default_extent_change', 'l0_search', 'l1_search', 'e1_l1_search', 'ladder_escalation',
  'per_target_extent', 'search_algorithm_change', 'search_ordering_change', 'search_comparator_change', 'p1_change', 'k2_feature_grouping', 'e2_search',
  'residual_unreached_support', 'oracle_guided_context_selection', 'context_level_early_stop', 'target_level_early_stop', 'compatibility_based_context_skip',
  'timeout_fallback', 'retry', 'b2c2b2b_timeout_retry', 'incompatible_context_optimization', 'candidate_trial', 'planner_alternative_kernel', 'full_planner_rerun',
  'global_assignment', 'production_rung_selector', 'production_scheduler_adoption', 'runtime_optimization', 'ui_change', 'b2c2b2a_result_regeneration',
  'b2c2b2b_result_regeneration'] as const

/** The B2-C2B1 RESULT the Target manifest must come from (the manifest records it; the Search never reads it). */
export const PHASE2C26B2C2B2C_TARGET_SOURCE = { resultSha256: '418166d2a7ff40145d8650f418c025783f9b5039673ee19e722bab4836b22eae', population: 'E1_L2', policy: 'P1' } as const

/** The policy definition check, unchanged from B2-C2A (the schedule's P1, the module's P1 and the registered copy are one definition). */
export const phase2c26b2c2b2cPolicyDrift = phase2c26b2c2b2aPolicyDrift
export const PHASE2C26B2C2B2C_REGISTERED_P1 = PHASE2C26B2C2B2A_REGISTERED_P1

// ---------------------------------------------------------------- the Target manifest (a Search input)

/** The E1 ∩ L2 population as Target IDs only: no rank, digest, first-compatible context, required extent or oracle field. */
export interface Phase2C26B2C2B2CTargetManifest {
  phase: string
  sourceResultSha256: string
  population: 'E1_L2'
  policy: 'P1'
  contextBudget: number
  /** The Export B2-C2B1 was measured on (from that RESULT's provenance). */
  exportSha256: string
  targetWeaponIds: string[]
}

const MANIFEST_KEYS = ['contextBudget', 'exportSha256', 'phase', 'policy', 'population', 'sourceResultSha256', 'targetWeaponIds']

/**
 * Reads a Target manifest as untrusted JSON: exactly the manifest keys (nothing else may ride along), the registered source
 * RESULT, population and policy, budget 32, and 4 distinct Target IDs in ascending order.
 */
export function parsePhase2C26B2C2B2CTargetManifest(json: unknown): { valid: boolean; issues: string[]; manifest: Phase2C26B2C2B2CTargetManifest | null } {
  const issues: string[] = []
  if (!isObject(json)) return { valid: false, issues: ['the Target manifest is not an object'], manifest: null }
  if (!same(Object.keys(json).sort(), MANIFEST_KEYS)) issues.push(`the Target manifest keys are not exactly ${MANIFEST_KEYS.join(', ')}`)
  if (json.sourceResultSha256 !== PHASE2C26B2C2B2C_TARGET_SOURCE.resultSha256) issues.push('sourceResultSha256 is not the registered B2-C2B1 RESULT')
  if (json.population !== PHASE2C26B2C2B2C_TARGET_SOURCE.population) issues.push(`population is not ${PHASE2C26B2C2B2C_TARGET_SOURCE.population}`)
  if (json.policy !== PHASE2C26B2C2B2C_TARGET_SOURCE.policy) issues.push('policy is not P1')
  if (json.contextBudget !== PHASE2C26B2C2B2C_CONTEXT_BUDGET) issues.push(`contextBudget is not ${PHASE2C26B2C2B2C_CONTEXT_BUDGET}`)
  if (typeof json.exportSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(json.exportSha256)) issues.push('exportSha256 is not a SHA-256')
  if (typeof json.phase !== 'string') issues.push('phase is not a string')
  const ids = Array.isArray(json.targetWeaponIds) ? json.targetWeaponIds : null
  if (!ids || !ids.every(id => typeof id === 'string' && id.length > 0)) issues.push('targetWeaponIds is not a list of IDs')
  else {
    if (ids.length !== PHASE2C26B2C2B2C_TARGETS) issues.push(`targetWeaponIds holds ${ids.length} Targets, not ${PHASE2C26B2C2B2C_TARGETS}`)
    if (new Set(ids).size !== ids.length) issues.push('targetWeaponIds repeats a Target')
    if (!same(ids, [...ids].sort(compare))) issues.push('targetWeaponIds is not in ascending order')
  }
  if (issues.length > 0) return { valid: false, issues, manifest: null }
  return { valid: true, issues: [], manifest: { phase: String(json.phase), sourceResultSha256: String(json.sourceResultSha256), population: 'E1_L2', policy: 'P1',
    contextBudget: json.contextBudget as number, exportSha256: String(json.exportSha256), targetWeaponIds: (ids as string[]).map(String) } }
}

// ---------------------------------------------------------------- the L2 Search context (B2-C2B2A's, unchanged)

/** The L2 Search context: B2-C2B2A's shape (the default reconstruction with the extent replaced and the digest recomputed). */
export type Phase2C26B2C2B2CContext = Phase2C26B2C2B2AContext

/**
 * B2-C2B2A's `phase2c26b2c2b2aL2Context()`, unchanged: replaces the extent of one default reconstruction by the common L2
 * extent and nothing else. Any other extent (L1, a Target-specific one, the default) fails closed.
 */
export function phase2c26b2c2b2cL2Context(context: Phase2C26B2B2AContext, extent: PlannerAlternativeSearchExtent = PHASE2C26B2C2B2C_EXTENT):
  { valid: true; context: Phase2C26B2C2B2CContext } | { valid: false; issues: string[] } {
  if (!same(extent, { ...PHASE2C26B2C2B2C_EXTENT })) return { valid: false, issues: ['the Search extent is not the registered common L2 extent'] }
  return phase2c26b2c2b2aL2Context(context, extent)
}

// ---------------------------------------------------------------- P1 top-32 task construction (oracle-free)

/** What a Search child receives: B2-C2B2A's task shape. No oracle field and no Target-specific extent exists here. */
export type Phase2C26B2C2B2CTaskInput = Phase2C26B2C2B2ATaskInput

export interface Phase2C26B2C2B2CTaskConstruction {
  valid: boolean
  issues: string[]
  tasks: Phase2C26B2C2B2CTaskInput[]
}

/**
 * The schedule's P1 contexts of rank 1..budget of every manifest Target, in manifest order then rank order, built by B2-C2B2A's
 * unchanged `buildPhase2C26B2C2B2ATasks()` (reconstruction + L2 replacement, every fail-closed check included), then checked
 * again: exactly targets x budget tasks, ranks 1..budget per Target, every task at the common L2 extent, the registered
 * capture rule. Reads nothing but the schedule and the IDs.
 */
export function buildPhase2C26B2C2B2CTasks(schedule: Phase2C26B2C1Schedule, targetWeaponIds: readonly string[], budget: number = PHASE2C26B2C2B2C_CONTEXT_BUDGET): Phase2C26B2C2B2CTaskConstruction {
  const built = buildPhase2C26B2C2B2ATasks(schedule, targetWeaponIds, budget)
  const issues = [...built.issues]
  if (built.valid) {
    if (built.tasks.length !== targetWeaponIds.length * budget) issues.push(`${built.tasks.length} tasks, not ${targetWeaponIds.length} x ${budget}`)
    for (const id of targetWeaponIds) {
      if (!same(built.tasks.filter(t => t.targetWeaponId === id).map(t => t.contextRank), Array.from({ length: budget }, (_, i) => i + 1))) issues.push(`${id}: the task ranks are not 1..${budget}`)
    }
    if (built.tasks.some(t => !same(t.extent, { ...PHASE2C26B2C2B2C_EXTENT }))) issues.push('a task extent is not the common L2 extent')
    if (built.tasks.some(t => t.maxCostCohorts !== PHASE2C26B2C2B2C_MAX_COST_COHORTS || t.candidateSafetyCap !== PHASE2C26B2C2B2C_CANDIDATE_SAFETY_CAP)) issues.push('a task capture rule is not the registered one')
    if (!same(schedule.extent, { ...defaultPlannerAlternativeSearchExtent })) issues.push('the schedule extent is not the Production default extent')
  }
  return { valid: issues.length === 0, issues, tasks: issues.length === 0 ? built.tasks : [] }
}

// ---------------------------------------------------------------- one Search task (child calculation, B2-C2B2A's unchanged)

/** B2-C2B2A's search record shape (the extent field carries L2). */
export type Phase2C26B2C2B2CSearchRecord = Phase2C26B2C2B2ASearchRecord
export type Phase2C26B2C2B2CChildRecord = Phase2C26B2C2B2AChildRecord
export type Phase2C26B2C2B2CTaskOutcome = Phase2C26B2C2B2ATaskOutcome

/**
 * The capture of one L2 context: B2-C2B2A's `runPhase2C26B2C2B2ASearch()`, unchanged (the Planner-start origin, the context
 * reservation, the excluded current Route key and the common L2 extent; the consumer stops at the sentinel or at the safety
 * cap and at nothing else).
 */
export const runPhase2C26B2C2B2CSearch = runPhase2C26B2C2B2ASearch
/**
 * The child calculation: B2-C2B2A's `runPhase2C26B2C2B2ATask()`, unchanged (the one schedule row of this Target at this P1 rank
 * from the child's own re-derived schedule, compared with every task field; reconstruction, L2 replacement, capture). Any drift
 * is a context mismatch and no Search runs.
 */
export const runPhase2C26B2C2B2CTask = runPhase2C26B2C2B2ATask
/** A timeout / out-of-memory / failure is that failure, never "no Candidate"; a completed child without a record is a failure. */
export const phase2c26b2c2b2cTaskOutcome = phase2c26b2c2b2aTaskOutcome

// ---------------------------------------------------------------- runner start attestation (written by the runner before any child)

/** The file the parent runner writes into the run dir, once (`wx`), read-only, before the first child process starts. */
export const PHASE2C26B2C2B2C_START_ATTESTATION_FILE = 'start-attestation.json'
export const PHASE2C26B2C2B2C_START_ATTESTATION_PHASE = 'Issue #154 Phase 2-C2.6-B2-C2B2C runner start attestation'

/** The registered execution conditions of a formal launch (the runner fills nothing of these by hand). */
export function phase2c26b2c2b2cRegisteredConditions() {
  return { stage1: { ...PHASE2C26B2C2B2C_STAGE1 } as { executionClass: 'stage1'; childHeapMb: number; concurrency: number; budgetMs: number; retry: 'none'; fallback: 'none' },
    tasksBudgetMs: PHASE2C26B2C2B2C_TASKS_BUDGET_MS, contextBudget: PHASE2C26B2C2B2C_CONTEXT_BUDGET, targets: PHASE2C26B2C2B2C_TARGETS,
    expectedTasks: PHASE2C26B2C2B2C_EXPECTED_TASKS, extentLabel: PHASE2C26B2C2B2C_EXTENT_LABEL, extent: { ...PHASE2C26B2C2B2C_EXTENT },
    captureRule: { policy: 'C4C', maxCostCohorts: PHASE2C26B2C2B2C_MAX_COST_COHORTS, sentinel: 'first delivery of the fifth distinct operation cost (never captured)', prefixes: { ...PHASE2C26B2C2B2C_CAPTURE_PREFIXES } },
    candidateSafetyCap: PHASE2C26B2C2B2C_CANDIDATE_SAFETY_CAP, registeredP1: PHASE2C26B2C2B2C_REGISTERED_P1, nodeYield: PHASE2C26B2C2B2C_NODE_YIELD,
    memorySampleIntervalMs: PHASE2C26B2C2B2C_MEMORY_SAMPLE_INTERVAL_MS }
}

/** What only the runner observes at launch (Stage 1 is the one it actually runs: a smoke budget shows here). */
export interface Phase2C26B2C2B2CLaunchObservation {
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
  stage1: ReturnType<typeof phase2c26b2c2b2cRegisteredConditions>['stage1']
  smoke: { tasks: number | null; taskIds: string[] | null; budgetMs: number | null } | null
}

export type Phase2C26B2C2B2CStartAttestation = ReturnType<typeof phase2c26b2c2b2cRegisteredConditions> & Phase2C26B2C2B2CLaunchObservation & { phase: string; attestedBy: 'runner' }

/** The attestation body the runner writes: the registered conditions, then its launch observation (its actual Stage 1 included). */
export function phase2c26b2c2b2cStartAttestationBody(observation: Phase2C26B2C2B2CLaunchObservation): Phase2C26B2C2B2CStartAttestation {
  return { phase: PHASE2C26B2C2B2C_START_ATTESTATION_PHASE, attestedBy: 'runner', ...phase2c26b2c2b2cRegisteredConditions(), ...observation }
}

const ATTESTATION_KEYS = Object.keys(phase2c26b2c2b2cStartAttestationBody({ createdAt: '', runnerScript: '', node: '', repositoryHead: '', uncommittedBenchmarkCode: false, benchmarkCodeSha256: '',
  exportFileName: '', exportSha256: '', exportBytes: 0, targetManifestFileName: '', targetManifestSha256: '', targetManifestSourceResultSha256: '', targetWeaponIds: [],
  stage1: phase2c26b2c2b2cRegisteredConditions().stage1, smoke: null })).sort()
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

/** The independently obtained values a start attestation must equal. */
export interface Phase2C26B2C2B2CAttestationExpectation {
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

export interface Phase2C26B2C2B2CAttestationVerification {
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
 * keys; `attestedBy: 'runner'` and the B2-C2B2C phase marker; a canonical UTC `createdAt` no later than the first child start;
 * the attested HEAD / benchmark code SHA-256 / Export SHA-256 / Target manifest SHA-256 / Target IDs equal to the
 * independently obtained ones; a clean launch (`uncommittedBenchmarkCode === false`, no smoke option); and every registered
 * condition (Stage 1, budget, Targets, tasks, L2, capture rule, safety cap, P1, yield, sampling) unchanged.
 */
export function verifyPhase2C26B2C2B2CStartAttestation(attestation: unknown, expected: Phase2C26B2C2B2CAttestationExpectation): Phase2C26B2C2B2CAttestationVerification {
  if (!isObject(attestation)) return { verified: false, issues: ['the start attestation is not an object'], integrityIssues: ['the start attestation is not an object'] }
  const integrityIssues: string[] = []
  const launchIssues: string[] = []
  if (!same(Object.keys(attestation).sort(), ATTESTATION_KEYS)) integrityIssues.push('the start attestation keys are not exactly the attestation keys')
  if (attestation.attestedBy !== 'runner') integrityIssues.push('not attested by the runner')
  if (attestation.phase !== PHASE2C26B2C2B2C_START_ATTESTATION_PHASE) integrityIssues.push('not a B2-C2B2C start attestation')
  if (typeof attestation.createdAt !== 'string' || !ISO_UTC.test(attestation.createdAt) || new Date(attestation.createdAt).toISOString() !== attestation.createdAt) integrityIssues.push('createdAt is not a canonical UTC time')
  else if (expected.firstChildStartedAt !== null && !(attestation.createdAt <= expected.firstChildStartedAt)) integrityIssues.push('createdAt is later than the first child start')
  if (typeof attestation.repositoryHead !== 'string' || !/^[0-9a-f]{40}$/.test(attestation.repositoryHead)) integrityIssues.push('repositoryHead is not a commit SHA')
  if (attestation.repositoryHead !== expected.repositoryHead) integrityIssues.push('repositoryHead differs')
  if (attestation.benchmarkCodeSha256 !== expected.benchmarkCodeSha256) integrityIssues.push('benchmarkCodeSha256 differs')
  if (attestation.exportSha256 !== expected.exportSha256) integrityIssues.push('exportSha256 differs')
  if (attestation.targetManifestSha256 !== expected.targetManifestSha256) integrityIssues.push('targetManifestSha256 differs')
  if (attestation.targetManifestSourceResultSha256 !== PHASE2C26B2C2B2C_TARGET_SOURCE.resultSha256) integrityIssues.push('targetManifestSourceResultSha256 is not the registered B2-C2B1 RESULT')
  if (!same(attestation.targetWeaponIds, expected.targetWeaponIds)) integrityIssues.push('targetWeaponIds differ')
  if (attestation.uncommittedBenchmarkCode !== false) launchIssues.push('uncommitted benchmark code at launch')
  if (attestation.smoke !== null) launchIssues.push('a smoke option at launch')
  for (const [field, value] of Object.entries(phase2c26b2c2b2cRegisteredConditions())) if (!same(attestation[field], value)) launchIssues.push(`${field} differs from the registered condition`)
  const issues = [...integrityIssues, ...launchIssues]
  return { verified: issues.length === 0, issues, integrityIssues }
}
