/**
 * Issue #154 Phase 2-C2.6-B2-C2B2E post-hoc analysis only. It reads the finished (or interrupted and reconstructed) B2-C2B2E raw
 * run with every child record, the per-child memory logs and the runner start attestation and, as explicit analyzer arguments
 * AFTER the run ended, every authority B2-C2B2D read plus the committed B2-C2B2D RESULT (the population source and the paired
 * baseline of the same Search input). It runs no Search, no kernel and no Planner and feeds nothing back into any calculation.
 *
 * The per-context comparison and the per-Target row are B2-C2B2D's, unchanged (`phase2c26b2c2b2aCompareContext()`,
 * `phase2c26b2c2b2dTargetRow()`), and so is the raw consistency check (`validatePhase2C26B2C2B2DRaw()`) and the re-derivation of
 * the excluded current Route (`phase2c26b2c2b2dRederiveBaselineContext()`). B2-C2B2E adds the paired comparison with B2-C2B2D's
 * task of the same Target - whose Search input, digest included, must be IDENTICAL (only the budget and the heap differ) - the
 * heap / yield trajectory of the extended run, the registered decision for 2 Targets, the next-Phase branch A / B / C / D, and
 * the E1 aggregate under oracle-guided diagnostic conditions kept apart from the common-ladder evidence (still 9 / 11).
 */
import { stableStringify } from '../domain/models/hashing'
import type { PlannerAlternativeSearchExtent } from '../domain/search'
import { phase2c26b2c2b2aCandidates, phase2c26b2c2b2aCompareContext } from './plannerGlobalPhase2C26B2C2B2AAnalysis'
import { phase2c26b2b2a2OracleOperationCost } from './plannerGlobalPhase2C26B2B2A2Analysis'
import type { Phase2C26B2C2AReach } from './plannerGlobalPhase2C26B2C2AAnalysis'
import type { Phase2C26B2C2B2CB2C2B2BAuthority } from './plannerGlobalPhase2C26B2C2B2CTargets'
import {
  phase2c26b2c2b2dEvidenceGrade,
  phase2c26b2c2b2dExecution,
  phase2c26b2c2b2dTargetRow,
  validatePhase2C26B2C2B2DRaw,
  PHASE2C26B2C2B2D_CAPTURE_POLICIES,
  type Phase2C26B2C2B2DBaselineRederivation,
  type Phase2C26B2C2B2DCapturePolicy,
  type Phase2C26B2C2B2DContextComparison,
  type Phase2C26B2C2B2DInterruption,
  type Phase2C26B2C2B2DRun,
  type Phase2C26B2C2B2DTargetRow,
} from './plannerGlobalPhase2C26B2C2B2DAnalysis'
import {
  verifyPhase2C26B2C2B2EStartAttestation,
  PHASE2C26B2C2B2E_BUDGET_MS,
  PHASE2C26B2C2B2E_B2C2B2D_STAGE1,
  PHASE2C26B2C2B2E_CHILD_HEAP_MB,
  PHASE2C26B2C2B2E_EXPECTED_TASKS,
  PHASE2C26B2C2B2E_TARGETS,
  type Phase2C26B2C2B2EAttestationExpectation,
  type Phase2C26B2C2B2ESearchRecord,
  type Phase2C26B2C2B2ETaskInput,
} from './plannerGlobalPhase2C26B2C2B2E'
import type { Phase2C26B2C2B2EB2C2B2DAuthority, Phase2C26B2C2B2EB2C2B2DTaskRow, Phase2C26B2C2B2EProbeDerivation } from './plannerGlobalPhase2C26B2C2B2ETargets'

const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}
type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)

export type Phase2C26B2C2B2ECapturePolicy = Phase2C26B2C2B2DCapturePolicy
export const PHASE2C26B2C2B2E_CAPTURE_POLICIES = PHASE2C26B2C2B2D_CAPTURE_POLICIES
/** One run as the raw record holds it (B2-C2B2D's shape). */
export type Phase2C26B2C2B2ERun = Phase2C26B2C2B2DRun
export type Phase2C26B2C2B2EInterruption = Phase2C26B2C2B2DInterruption
export type Phase2C26B2C2B2ETargetRow = Phase2C26B2C2B2DTargetRow

const searchOf = (run: Phase2C26B2C2B2ERun | undefined): Phase2C26B2C2B2ESearchRecord | null => run?.record?.status === 'searched' ? run.record.search : null
const peakOf = (r: Phase2C26B2C2B2ERun) => ({ heap: Math.max(r.memory?.sampledMaxHeapUsedBytes ?? 0, r.lastIpcMemory?.maxHeapUsedBytes ?? 0),
  rss: Math.max(r.memory?.sampledMaxRssBytes ?? 0, (r.memory?.maxRssKiB ?? 0) * 1024, r.lastIpcMemory?.maxRssBytes ?? 0) })
const processOf = (run: Phase2C26B2C2B2ERun | undefined) => run?.outcome.record === 'context_mismatch' ? 'context_mismatch' : run?.process.outcome ?? 'not_run'

// ---------------------------------------------------------------- launch provenance (evidence grade, separate from the Search decision)

export interface Phase2C26B2C2B2ELaunchProvenance {
  verified: boolean
  source: 'runner_start_attestation' | 'none'
  workingTreeCleanVerified: boolean
  issues: string[]
  integrityIssues: string[]
  reason: string | null
}

/**
 * The launch provenance of a raw run (B2-C2B2D's rule with this phase's attestation): verified only by the runner start
 * attestation file of the run dir, whose SHA-256 must be the one the raw recorded and whose body must verify against the
 * independently obtained HEAD / code / Export / probe manifest / B2-C2B2D RESULT values. No attestation never verifies.
 */
export function phase2c26b2c2b2eLaunchProvenance(input: {
  attestationFile: { sha256: string; body: unknown } | null
  recordedAttestationSha256: string | null
  environment: Record<string, unknown>
  expected: Phase2C26B2C2B2EAttestationExpectation
}): Phase2C26B2C2B2ELaunchProvenance {
  if (input.attestationFile === null) {
    return { verified: false, source: 'none', workingTreeCleanVerified: false, issues: ['no start attestation in the run dir'], integrityIssues: [],
      reason: 'The runner start attestation is missing: the launch HEAD, working-tree cleanliness and benchmark code hash are not attested by the runner.' }
  }
  const integrityIssues: string[] = []
  if (input.recordedAttestationSha256 !== input.attestationFile.sha256) integrityIssues.push('the attestation file is not the one the raw recorded')
  const verification = verifyPhase2C26B2C2B2EStartAttestation(input.attestationFile.body, input.expected)
  integrityIssues.push(...verification.integrityIssues)
  const body = isObject(input.attestationFile.body) ? input.attestationFile.body : {}
  for (const field of ['repositoryHead', 'uncommittedBenchmarkCode', 'benchmarkCodeSha256', 'exportSha256', 'probeManifestSha256', 'stage1', 'probes'] as const) {
    if (!same(body[field], input.environment[field])) integrityIssues.push(`${field} differs from the raw environment`)
  }
  const issues = [...integrityIssues, ...verification.issues.filter(i => !verification.integrityIssues.includes(i))]
  const verified = issues.length === 0
  return { verified, source: 'runner_start_attestation', workingTreeCleanVerified: verified, issues, integrityIssues,
    reason: verified ? null : `The start attestation does not verify: ${issues.join('; ')}.` }
}

/** The evidence grade: B2-C2B2D's rule (formal only with every formal condition AND verified launch provenance). */
export const phase2c26b2c2b2eEvidenceGrade = phase2c26b2c2b2dEvidenceGrade

// ---------------------------------------------------------------- raw consistency (fails the run closed)

/**
 * B2-C2B2D's raw consistency (`validatePhase2C26B2C2B2DRaw()`: task extents, record identity, capture, sentinel, termination,
 * monotonic cost) plus the execution conditions of this phase: every ran child had the extended budget (60 minutes) unless the run
 * is a smoke, and no task ran twice (no retry).
 */
export function validatePhase2C26B2C2B2ERaw(input: { tasks: readonly Phase2C26B2C2B2ETaskInput[]; runs: readonly Phase2C26B2C2B2ERun[]; smoke: boolean;
  expectedExtents: ReadonlyMap<string, PlannerAlternativeSearchExtent>; interruption?: Phase2C26B2C2B2EInterruption | null }): string[] {
  const issues = validatePhase2C26B2C2B2DRaw(input)
  if (!input.smoke) for (const run of input.runs) if (run.process.budgetMs !== PHASE2C26B2C2B2E_BUDGET_MS) issues.push(`${run.taskId}: the child budget is ${run.process.budgetMs} ms, not ${PHASE2C26B2C2B2E_BUDGET_MS}`)
  if (input.tasks.length > PHASE2C26B2C2B2E_EXPECTED_TASKS) issues.push(`${input.tasks.length} planned tasks, more than ${PHASE2C26B2C2B2E_EXPECTED_TASKS}`)
  return issues
}

// ---------------------------------------------------------------- paired comparison with B2-C2B2D (same Target, same Search input)

/** The task fields that must be identical to B2-C2B2D's task of the same Target: the whole Search input identity, digest and extent included. */
export const PHASE2C26B2C2B2E_PAIRED_IDENTITY_FIELDS = ['taskId', 'targetWeaponId', 'contextRank', 'groupIndex', 'reservationDigest', 'targetEligibleMinCardinality', 'representativeFixedSetId',
  'representativeFixedTargetWeaponIds', 'defaultSearchInputDigest', 'extent', 'searchInputDigest'] as const

export interface Phase2C26B2C2B2EExcludedRouteComparison {
  verified: boolean
  rederivedExcludedRouteKeySha256: string | null
  /** The excluded current Route key SHA-256 B2-C2B2D re-derived for the same pair (its committed paired identity). */
  b2c2b2dRederivedExcludedRouteKeySha256: string | null
  b2c2b2dRecordMatchesRederived: boolean | null
  b2c2b2eSource: 'b2c2b2e_record' | 'rederived_default_context' | null
  b2c2b2eRecordMatchesRederived: boolean | null
}

export interface Phase2C26B2C2B2EPairedSide {
  process: string
  budgetMs: number | null
  childHeapMb: number | null
  wallMs: number | null
  searchElapsedMs: number | null
  peakHeapBytes: number | null
  peakRssBytes: number | null
  yields: number | null
  termination: string | null
  deliveredCandidates: number | null
  candidateCount: number | null
  safetyCapHit: boolean | null
  hit: Record<Phase2C26B2C2B2ECapturePolicy, boolean>
  firstExactIndex: number | null
  firstExactCost: number | null
}

export interface Phase2C26B2C2B2EPairedRow {
  taskId: string
  targetWeaponId: string
  contextRank: number
  b2c2b2dTaskId: string | null
  identity: { matches: boolean; issues: string[]; excludedRouteKeyComparison: Phase2C26B2C2B2EExcludedRouteComparison }
  /** B2-C2B2C's process of the same Target and context at the common L2 extent (display only: L2 -> tight 10 min -> tight 60 min). */
  b2c2b2cSameContextProcess: string | null
  b2c2b2d: Phase2C26B2C2B2EPairedSide | null
  b2c2b2e: Phase2C26B2C2B2EPairedSide
  /** `<B2-C2B2D process> -> <B2-C2B2E process>`. */
  outcomeTransition: string | null
  /** B2-C2B2E - B2-C2B2D. A B2-C2B2D timeout wall is a lower bound of what that Search needed. */
  delta: { wallMs: number | null; peakHeapBytes: number | null; peakRssBytes: number | null; yields: number | null }
}

const diff = (a: number | null, b: number | null) => a === null || b === null ? null : a - b

/**
 * One B2-C2B2E task against B2-C2B2D's task of the same Target: every Search input identity field (task ID, rank, group,
 * reservation, representative, default and tight Search input digests, the tight extent) must be equal, the excluded current Route
 * must be proved equal through the re-derived default context (`phase2c26b2c2b2dRederiveBaselineContext()` over the B2-C2B2D task
 * row), which must reproduce the key B2-C2B2D re-derived, B2-C2B2D's record key (if any) and this phase's record key (if any).
 * The intended difference is the execution condition only (budget, heap). An unmeasured side keeps null Search fields: never
 * Candidate 0.
 */
export function phase2c26b2c2b2ePairedRow(task: Phase2C26B2C2B2ETaskInput, run: Phase2C26B2C2B2ERun | undefined, comparison: Phase2C26B2C2B2DContextComparison,
  excludedRouteKeySha256: string | null, b2c2b2d: Phase2C26B2C2B2EB2C2B2DAuthority, rederivation: Phase2C26B2C2B2DBaselineRederivation | null,
  conditions: { budgetMs: number; childHeapMb: number }): Phase2C26B2C2B2EPairedRow {
  const issues: string[] = []
  const counterparts = b2c2b2d.taskRows.filter(r => r.targetWeaponId === task.targetWeaponId)
  if (counterparts.length !== 1) issues.push(`${task.taskId}: ${counterparts.length} B2-C2B2D tasks hold this Target`)
  const c: Phase2C26B2C2B2EB2C2B2DTaskRow | null = counterparts.length === 1 ? counterparts[0]! : null
  const target = b2c2b2d.targets.find(t => t.targetWeaponId === task.targetWeaponId) ?? null
  const route: Phase2C26B2C2B2EExcludedRouteComparison = { verified: false, rederivedExcludedRouteKeySha256: null, b2c2b2dRederivedExcludedRouteKeySha256: target?.rederivedExcludedRouteKeySha256 ?? null,
    b2c2b2dRecordMatchesRederived: null, b2c2b2eSource: null, b2c2b2eRecordMatchesRederived: null }
  if (c !== null) {
    for (const field of PHASE2C26B2C2B2E_PAIRED_IDENTITY_FIELDS) if (!same(task[field], c[field])) issues.push(`${task.taskId}: ${field} differs from B2-C2B2D`)
    const routeIssues: string[] = []
    if (target === null) routeIssues.push(`${task.taskId}: no B2-C2B2D Target row`)
    if (rederivation === null || rederivation.taskId !== c.taskId) routeIssues.push(`${task.taskId}: no re-derived default context`)
    else {
      routeIssues.push(...rederivation.issues.map(i => `${task.taskId}: ${i}`))
      if (!rederivation.valid && rederivation.issues.length === 0) routeIssues.push(`${task.taskId}: the re-derived default context is not valid`)
      if (rederivation.defaultSearchInputDigest !== task.defaultSearchInputDigest) routeIssues.push(`${task.taskId}: the re-derived default digest is not this task's default digest`)
      const rederived = rederivation.excludedRouteKeySha256
      route.rederivedExcludedRouteKeySha256 = rederived
      if (rederived === null) routeIssues.push(`${task.taskId}: no re-derived excluded current Route key`)
      if (route.b2c2b2dRederivedExcludedRouteKeySha256 !== rederived) routeIssues.push(`${task.taskId}: the excluded current Route B2-C2B2D re-derived differs from the re-derived one`)
      if (c.excludedRouteKeySha256 !== null) {
        route.b2c2b2dRecordMatchesRederived = c.excludedRouteKeySha256 === rederived
        if (!route.b2c2b2dRecordMatchesRederived) routeIssues.push(`${task.taskId}: the B2-C2B2D record's excluded current Route differs from the re-derived one`)
      } else if (c.record === 'searched') routeIssues.push(`${task.taskId}: a searched B2-C2B2D task without a recorded excluded current Route`)
      if (excludedRouteKeySha256 !== null) {
        route.b2c2b2eSource = 'b2c2b2e_record'
        route.b2c2b2eRecordMatchesRederived = excludedRouteKeySha256 === rederived
        if (!route.b2c2b2eRecordMatchesRederived) routeIssues.push(`${task.taskId}: the B2-C2B2E record's excluded current Route differs from the re-derived one`)
      } else if (searchOf(run) !== null) routeIssues.push(`${task.taskId}: a searched B2-C2B2E task without a recorded excluded current Route`)
      else route.b2c2b2eSource = 'rederived_default_context'
    }
    route.verified = routeIssues.length === 0
    issues.push(...routeIssues)
  } else issues.push(`${task.taskId}: the excluded current Route cannot be proved without the B2-C2B2D counterpart`)
  const s = searchOf(run)
  const peak = run ? peakOf(run) : null
  const ours: Phase2C26B2C2B2EPairedSide = { process: processOf(run), budgetMs: run?.process.budgetMs ?? null, childHeapMb: run ? conditions.childHeapMb : null, wallMs: run?.process.wallMs ?? null,
    searchElapsedMs: s?.elapsedMs ?? null, peakHeapBytes: peak?.heap ?? null, peakRssBytes: peak?.rss ?? null, yields: run?.yields ?? null, termination: s?.termination ?? null,
    deliveredCandidates: s?.summary.deliveredCandidates ?? null, candidateCount: s?.candidates.length ?? null, safetyCapHit: s?.safetyCapHit ?? null, hit: { ...comparison.hit },
    firstExactIndex: comparison.firstExactIndex, firstExactCost: comparison.firstExactCost }
  const stage1 = PHASE2C26B2C2B2E_B2C2B2D_STAGE1
  const theirs: Phase2C26B2C2B2EPairedSide | null = c === null ? null : { process: c.process, budgetMs: stage1.budgetMs, childHeapMb: stage1.childHeapMb, wallMs: c.wallMs,
    searchElapsedMs: c.searchElapsedMs, peakHeapBytes: c.peakHeapBytes, peakRssBytes: c.peakRssBytes, yields: c.yields, termination: c.termination, deliveredCandidates: c.deliveredCandidates,
    candidateCount: c.candidateCount, safetyCapHit: c.safetyCapHit, hit: { ...c.hit }, firstExactIndex: c.firstExactIndex, firstExactCost: c.firstExactCost }
  if (run !== undefined && (run.process.budgetMs !== conditions.budgetMs)) issues.push(`${task.taskId}: the child budget is not this phase's`)
  return { taskId: task.taskId, targetWeaponId: task.targetWeaponId, contextRank: task.contextRank, b2c2b2dTaskId: c?.taskId ?? null,
    identity: { matches: issues.length === 0 && route.verified, issues, excludedRouteKeyComparison: route }, b2c2b2cSameContextProcess: target?.b2c2b2cSameContextProcess ?? null,
    b2c2b2d: theirs, b2c2b2e: ours, outcomeTransition: theirs === null ? null : `${theirs.process} -> ${ours.process}`,
    delta: { wallMs: diff(ours.wallMs, theirs?.wallMs ?? null), peakHeapBytes: diff(ours.peakHeapBytes, theirs?.peakHeapBytes ?? null), peakRssBytes: diff(ours.peakRssBytes, theirs?.peakRssBytes ?? null),
      yields: diff(ours.yields, theirs?.yields ?? null) } }
}

// ---------------------------------------------------------------- heap / yield trajectory (from the runner's memory log; observation only)

/** One memory log line the runner appends (every 20th IPC message): the child's running maxima and its yield count. */
export interface Phase2C26B2C2B2EMemorySample {
  receivedAtMs: number
  maxima: { samples: number; maxHeapUsedBytes: number; maxRssBytes: number; lastElapsedMs: number }
  yields: number
}

/** Elapsed times (ms since the child start) at which the trajectory is read. 600,000 is B2-C2B2D's whole budget. */
export const PHASE2C26B2C2B2E_TRAJECTORY_CHECKPOINTS_MS = [60_000, 300_000, 600_000, 1_200_000, 1_800_000, 2_400_000, 3_000_000, 3_600_000] as const
/** Yield-rate windows (ms since the child start). */
export const PHASE2C26B2C2B2E_TRAJECTORY_WINDOWS_MS = [[0, 600_000], [600_000, 1_800_000], [1_800_000, 3_600_000]] as const

export interface Phase2C26B2C2B2ETrajectory {
  samples: number
  lastReceivedAtMs: number | null
  /** The latest logged sample at or before each checkpoint (null when the child had ended or not reached it). */
  checkpoints: { atMs: number; receivedAtMs: number | null; maxHeapUsedBytes: number | null; maxRssBytes: number | null; yields: number | null }[]
  /** Yields per second inside each window, from the samples bracketing it (null when the window is not covered). */
  yieldsPerSecond: { fromMs: number; toMs: number; value: number | null }[]
  peakHeapBytes: number | null
  /** When the running maximum heap first reached 90 % / 99 % of its final value (a late value means the heap kept growing). */
  heapReached90PctAtMs: number | null
  heapReached99PctAtMs: number | null
  /** The running maximum heap grew by less than 1 % over the last third of the run (a plateau), true / false, or null with too few samples. */
  heapPlateauInLastThird: boolean | null
}

/**
 * Summarizes the memory log of one child (observation only; never a decision input). The log holds running maxima, so a flat
 * maximum means no new heap high, not a lower current heap.
 */
export function phase2c26b2c2b2eTrajectory(samples: readonly Phase2C26B2C2B2EMemorySample[]): Phase2C26B2C2B2ETrajectory {
  const sorted = [...samples].sort((a, b) => a.receivedAtMs - b.receivedAtMs)
  const last = sorted.at(-1) ?? null
  const at = (ms: number) => [...sorted].reverse().find(s => s.receivedAtMs <= ms) ?? null
  const checkpoints = PHASE2C26B2C2B2E_TRAJECTORY_CHECKPOINTS_MS.map(atMs => {
    const s = last !== null && last.receivedAtMs >= atMs * 0.98 ? at(atMs) : null
    return { atMs, receivedAtMs: s?.receivedAtMs ?? null, maxHeapUsedBytes: s?.maxima.maxHeapUsedBytes ?? null, maxRssBytes: s?.maxima.maxRssBytes ?? null, yields: s?.yields ?? null }
  })
  const yieldsPerSecond = PHASE2C26B2C2B2E_TRAJECTORY_WINDOWS_MS.map(([fromMs, toMs]) => {
    const a = fromMs === 0 ? sorted[0] ?? null : at(fromMs)
    const b = last !== null && last.receivedAtMs >= toMs * 0.98 ? at(toMs) : null
    return { fromMs, toMs, value: a === null || b === null || b.receivedAtMs <= a.receivedAtMs ? null : (b.yields - a.yields) / ((b.receivedAtMs - a.receivedAtMs) / 1000) }
  })
  const peak = last?.maxima.maxHeapUsedBytes ?? null
  const reached = (fraction: number) => peak === null ? null : sorted.find(s => s.maxima.maxHeapUsedBytes >= peak * fraction)?.receivedAtMs ?? null
  let plateau: boolean | null = null
  if (last !== null && sorted.length >= 6) {
    const start = at(last.receivedAtMs * 2 / 3)
    plateau = start === null || start.maxima.maxHeapUsedBytes === 0 ? null : (last.maxima.maxHeapUsedBytes - start.maxima.maxHeapUsedBytes) / start.maxima.maxHeapUsedBytes < 0.01
  }
  return { samples: sorted.length, lastReceivedAtMs: last?.receivedAtMs ?? null, checkpoints, yieldsPerSecond, peakHeapBytes: peak,
    heapReached90PctAtMs: reached(0.9), heapReached99PctAtMs: reached(0.99), heapPlateauInLastThird: plateau }
}

// ---------------------------------------------------------------- decision (registered before the Stage 1 measurement; a diagnostic decision, never a scheduler decision)

export type Phase2C26B2C2B2EDecisionCase = 'B2C2B2E_ALL_C8' | 'B2C2B2E_ALL_C32' | 'B2C2B2E_ALL_C4C' | 'B2C2B2E_PARTIAL' | 'B2C2B2E_INCOMPLETE' | 'B2C2B2E_INVALID'

export const PHASE2C26B2C2B2E_DECISION_RULE = {
  scope: 'An oracle-guided diagnostic decision (B2-C2B2D\'s first compatible context x target-relative tight extent, with an extended execution budget). It is never a scheduler decision and never evidence for a Production scheduler, a Production extent selector, a Production rung selector or an acceptable Production runtime.',
  order: [
    'B2C2B2E_INVALID: an authority mismatch (B2-C2B1 / B2-C1 / B2-B1 / B2-C2B2B / B2-C2B2C / B2-C2B2D / oracle / hash chain / Export / CalculationContext / RNG), a population other than exactly the B2-C2B2D Targets with recovery none and a timeout / out-of-memory task (previously unrecovered 2, previously recovered 2), a probe manifest other than the re-derived one, a selected rank or tight extent other than B2-C2B2D\'s, a task count other than 2, a P1 definition drift or schedule parity mismatch, a Search input identity (task ID / group / reservation / representative / default and tight Search input digests / extent / excluded current Route) other than B2-C2B2D\'s task of the same Target, an execution condition other than 60 minutes / 12,288 MB / concurrency 1 / no retry / no fallback with every other Stage 1 field B2-C2B2D\'s, a context mismatch in a Search child, a Candidate reservation violation, an exact or partial Candidate from an incompatible context, a nonmonotonic Candidate cost sequence, a provenance flag reported other than registered, a start attestation that is present but does not verify, or a raw / result inconsistency',
    'B2C2B2E_INCOMPLETE: no invalid reason, and a task was not measured (timeout / out of memory / process failure / notRun after an interruption: never Candidate 0, never retried in this Phase, never followed by an automatic 16 GB or longer fallback)',
    'B2C2B2E_ALL_C8: both tasks measured and the first 8 captured Candidates hold the exact oracle Route for 2 / 2 Targets',
    'B2C2B2E_ALL_C32: both measured, C8 < 2, C32 2 / 2',
    'B2C2B2E_ALL_C4C: both measured, C32 < 2, C4C 2 / 2 (a safety-capped capture still counts its exact Candidates)',
    'B2C2B2E_PARTIAL: both measured, no invalid reason, C4C < 2 (a miss is classified - safety cap unresolved / capture insufficient / compatible non-delivery - and never read as "the Route does not exist")',
  ],
  policies: 'C8 / C32 = the first 8 / 32 Candidates of the one C4C capture; C4C = every captured Candidate (up to four complete operation-cost cohorts; the sentinel never counts). C8 ⊆ C32 ⊆ C4C',
  exact: 'phase2c26b2c2b2aCompareContext() -> phase2c26b2c2aCompareContext() -> phase2c26b2b2aCompare() -> phase2c2OracleCoverage() per Candidate; partial_comparable is recorded and never counted as exact',
  evidence: 'separate axis: formal = the ordinary formal conditions AND a verified runner start attestation; an interrupted run is partialRun = true and is graded by the attestation, never promoted by --allow-nonformal',
  nextBranch: 'separate axis, never a decision input: A / B / C / D from which of the two Targets recovered (see PHASE2C26B2C2B2E_NEXT_BRANCH_RULE)',
} as const

export const PHASE2C26B2C2B2E_RECOMMENDATION: Record<Phase2C26B2C2B2EDecisionCase, string> = {
  B2C2B2E_ALL_C8: '2 / 2がC8で回収できた（oracle-guided diagnostic、60分 / 12 GB）。既存SearchはRouteをdeliver可能。次はoracleなしでcontext / extent / budgetをどう選ぶかの研究へ（branch A）。Production採用ではない',
  B2C2B2E_ALL_C32: '2 / 2がC32で回収できた（oracle-guided diagnostic、60分 / 12 GB）。既存SearchはRouteをdeliver可能。次はoracleなしでcontext / extent / budgetをどう選ぶかの研究へ（branch A）。Production採用ではない',
  B2C2B2E_ALL_C4C: '2 / 2がC4Cで回収できた（oracle-guided diagnostic、60分 / 12 GB）。既存SearchはRouteをdeliver可能。次はoracleなしでcontext / extent / budgetをどう選ぶかの研究へ（branch A）。Production採用ではない',
  B2C2B2E_PARTIAL: '60分 / 12 GBで完走したがexact non-deliveryのTargetがある。extentでもbudgetでもなくCandidate ordering / capture / context semanticsを調査する（Route不存在とは結論しない）',
  B2C2B2E_INCOMPLETE: '未計測taskがある（timeout / OOM / process failure / notRun）。branch B / C / Dに従いtarget別のprofilingへ。16 GB heap retryや60分超を自動的な次手にしない',
  B2C2B2E_INVALID: '次へ進まず原因修正',
}

export interface Phase2C26B2C2B2EDecisionInput {
  invalidReasons: readonly string[]
  tasks: number
  targets: number
  unmeasuredTasks: number
  exactTargets: Record<Phase2C26B2C2B2ECapturePolicy, number>
}

export function phase2c26b2c2b2eDecision(input: Phase2C26B2C2B2EDecisionInput) {
  const { tasks, targets, unmeasuredTasks, exactTargets } = input
  const values = [tasks, targets, unmeasuredTasks, exactTargets.C8, exactTargets.C32, exactTargets.C4C]
  if (!values.every(v => Number.isInteger(v) && v >= 0) || unmeasuredTasks > tasks || exactTargets.C8 > exactTargets.C32 || exactTargets.C32 > exactTargets.C4C || exactTargets.C4C > targets) {
    throw new Error(`Inconsistent Phase 2-C2.6-B2-C2B2E decision input: ${JSON.stringify(input)}`)
  }
  const reasons = [...input.invalidReasons, ...(tasks !== PHASE2C26B2C2B2E_EXPECTED_TASKS ? [`task_count_${tasks}`] : []), ...(targets !== PHASE2C26B2C2B2E_TARGETS ? [`target_count_${targets}`] : [])]
  const all = PHASE2C26B2C2B2E_TARGETS
  const caseId: Phase2C26B2C2B2EDecisionCase = reasons.length > 0 ? 'B2C2B2E_INVALID'
    : unmeasuredTasks > 0 ? 'B2C2B2E_INCOMPLETE'
      : exactTargets.C8 === all ? 'B2C2B2E_ALL_C8'
        : exactTargets.C32 === all ? 'B2C2B2E_ALL_C32'
          : exactTargets.C4C === all ? 'B2C2B2E_ALL_C4C'
            : 'B2C2B2E_PARTIAL'
  return { case: caseId, reasons, scope: PHASE2C26B2C2B2E_DECISION_RULE.scope, recommendation: PHASE2C26B2C2B2E_RECOMMENDATION[caseId] }
}

// ---------------------------------------------------------------- next-Phase branch A / B / C / D (separate from the decision)

/**
 * The two Target types, assigned mechanically from B2-C2B2C's process of the same Target and context at the common L2 extent
 * (the B2-C2B2D RESULT carries it): `heap_growth` = B2-C2B2C out of memory (the Target whose heap kept growing in B2-C2B2D),
 * `time_bound` = B2-C2B2C timeout (the Target whose heap was flat in B2-C2B2D). Never a hard-coded Target ID.
 */
export type Phase2C26B2C2B2ETargetType = 'heap_growth' | 'time_bound'
export type Phase2C26B2C2B2ETargetResult = 'recovered' | 'timeout' | 'out_of_memory' | 'process_failure' | 'context_mismatch' | 'measured_without_exact' | 'not_run'
export type Phase2C26B2C2B2ENextBranch = 'A' | 'B' | 'C' | 'D'

export const PHASE2C26B2C2B2E_NEXT_BRANCH_RULE = {
  types: 'heap_growth = the Target whose B2-C2B2C same-context task ran out of memory; time_bound = the Target whose B2-C2B2C same-context task timed out (both from the B2-C2B2D RESULT). Exactly one of each is required for B / C.',
  A: 'both recovered (C4C exact): the existing Search delivers the Routes. Next: research choosing an appropriate context / extent / budget without the oracle',
  B: 'only the time_bound Target recovered: it was a plain time-budget problem; the heap_growth Target is a memory / search-explosion problem. Next: heap_growth-Target profiling',
  C: 'only the heap_growth Target recovered: heap / budget fixed it; the time_bound Target is a time-complexity problem. Next: time_bound-Target profiling',
  D: 'neither recovered: before raising any budget further, profile the Search runtime. A 16 GB heap retry is never the automatic next step',
  note: 'Never a decision input. With an invalid reason, a not_run Target, or an ambiguous type assignment (for B / C) the branch is null. "Recovered" is a C4C exact; a measured miss is unrecovered too and is reported as measured_without_exact.',
} as const

export function phase2c26b2c2b2eNextBranch(input: { invalid: boolean; rows: readonly Phase2C26B2C2B2ETargetRow[]; b2c2b2d: Phase2C26B2C2B2EB2C2B2DAuthority }) {
  const resultOf = (row: Phase2C26B2C2B2ETargetRow): Phase2C26B2C2B2ETargetResult =>
    row.recovery !== 'none' ? 'recovered' : row.measured ? 'measured_without_exact' : row.process === 'not_run' ? 'not_run'
      : (['timeout', 'out_of_memory', 'process_failure', 'context_mismatch'] as const).find(p => p === row.process) ?? 'process_failure'
  const perTarget = input.rows.map(row => {
    const c = input.b2c2b2d.targets.find(t => t.targetWeaponId === row.targetWeaponId)?.b2c2b2cSameContextProcess ?? null
    const type: Phase2C26B2C2B2ETargetType | null = c === 'out_of_memory' ? 'heap_growth' : c === 'timeout' ? 'time_bound' : null
    return { targetWeaponId: row.targetWeaponId, taskId: row.taskId, type, b2c2b2cSameContextProcess: c, result: resultOf(row) }
  })
  const recovered = perTarget.filter(t => t.result === 'recovered')
  const typesUnambiguous = perTarget.length === PHASE2C26B2C2B2E_TARGETS && perTarget.filter(t => t.type === 'heap_growth').length === 1 && perTarget.filter(t => t.type === 'time_bound').length === 1
  let branch: Phase2C26B2C2B2ENextBranch | null = null
  if (!input.invalid && perTarget.length === PHASE2C26B2C2B2E_TARGETS && !perTarget.some(t => t.result === 'not_run')) {
    if (recovered.length === perTarget.length) branch = 'A'
    else if (recovered.length === 0) branch = 'D'
    else if (typesUnambiguous) branch = recovered[0]!.type === 'time_bound' ? 'B' : 'C'
  }
  return { branch, perTarget, typesUnambiguous, recoveredOf: { recovered: recovered.length, of: perTarget.length }, rule: PHASE2C26B2C2B2E_NEXT_BRANCH_RULE,
    meaning: branch === null ? null : PHASE2C26B2C2B2E_NEXT_BRANCH_RULE[branch] }
}

// ---------------------------------------------------------------- the E1 aggregate under oracle-guided diagnostic conditions

export const PHASE2C26B2C2B2E_E1_DIAGNOSTIC_LIMITATIONS = [
  'The L2 half is oracle-guided: the population, the context (B2-C1 first compatible) and the extent (max(Production default, B2-C2B1 required)) all come from post-hoc oracle evidence, and two of its Routes needed an execution budget beyond B2-C2B2D\'s (60 minutes / 12 GB). It does not show that Production could choose the context, know the extent or afford the budget in advance.',
  'The registered common ladder evidence (B2-C2B2B common L1 + B2-C2B2C common L2) stays C4C 9 / 11; this aggregate does not turn it into 11 / 11.',
  'It does not show that a Production scheduler finds these Routes (no Planner trial, kernel, full Planner rerun or global assignment ran), nor that the Production runtime would be acceptable.',
  'Unmeasured tasks (timeout / OOM / notRun) are unknown, never Candidate 0.',
] as const

/**
 * The E1 aggregate, post hoc, as two separate statements: the registered common ladder keeps B2-C2B2D's count (9 / 11, unchanged);
 * the diagnostic aggregate takes the L1 half from B2-C2B2B, the L2 Targets B2-C2B2D recovered from B2-C2B2D, and the population of
 * this phase from this phase. "E1 11 / 11 at least under oracle-guided diagnostic conditions" is stated only when every E1 Route
 * recovered (C4C), with the limitations.
 */
export function phase2c26b2c2b2eE1Aggregate(input: { e1: readonly string[]; l1: readonly string[]; l2: readonly string[]; b2c2b2b: Phase2C26B2C2B2CB2C2B2BAuthority;
  b2c2b2d: Phase2C26B2C2B2EB2C2B2DAuthority; rows: readonly Phase2C26B2C2B2ETargetRow[]; decision: string | null; evidenceGrade: string }) {
  const issues: string[] = []
  const sorted = (ids: readonly string[]) => [...ids].sort()
  if (input.l1.some(id => input.l2.includes(id))) issues.push('the L1 and L2 populations overlap')
  if (!same(sorted([...input.l1, ...input.l2]), sorted(input.e1))) issues.push('the L1 and L2 populations do not partition E1')
  if (!same(sorted(input.b2c2b2b.targetWeaponIds), sorted(input.l1))) issues.push('the B2-C2B2B Targets are not the L1 population')
  if (!same(sorted(input.b2c2b2d.targetWeaponIds), sorted(input.l2))) issues.push('the B2-C2B2D Targets are not the L2 population')
  const ours = new Set(input.rows.map(r => r.targetWeaponId))
  const recoveredByB2D = input.b2c2b2d.targets.filter(t => t.recovery !== 'none').map(t => t.targetWeaponId)
  if (recoveredByB2D.some(id => ours.has(id))) issues.push('this phase re-ran a Target B2-C2B2D recovered')
  if (!same(sorted([...recoveredByB2D, ...ours]), sorted(input.l2))) issues.push('B2-C2B2D\'s recovered Targets and this phase\'s Targets do not partition L2')
  const policies = PHASE2C26B2C2B2E_CAPTURE_POLICIES
  const l1 = input.b2c2b2b.exactTargets
  const fromB2D = Object.fromEntries(policies.map(p => [p, input.b2c2b2d.taskRows.filter(r => recoveredByB2D.includes(r.targetWeaponId) && r.hit[p]).length])) as Record<Phase2C26B2C2B2ECapturePolicy, number>
  const fromB2E = Object.fromEntries(policies.map(p => [p, input.rows.filter(r => r.hit[p]).length])) as Record<Phase2C26B2C2B2ECapturePolicy, number>
  const l2 = Object.fromEntries(policies.map(p => [p, fromB2D[p] + fromB2E[p]])) as Record<Phase2C26B2C2B2ECapturePolicy, number>
  const total = Object.fromEntries(policies.map(p => [p, { recovered: l1[p] + l2[p], of: input.e1.length }])) as Record<Phase2C26B2C2B2ECapturePolicy, { recovered: number; of: number }>
  const allRecovered = issues.length === 0 && input.e1.length > 0 && total.C4C.recovered === input.e1.length && l1.C4C === input.l1.length && l2.C4C === input.l2.length
  return {
    issues,
    e1Total: input.e1.length,
    commonLadder: { source: 'B2-C2B2B RESULT (common L1) + B2-C2B2C RESULT (common L2), as the B2-C2B2D RESULT carried them; not re-run here', total: structuredClone(input.b2c2b2d.e1.commonLadder),
      statement: null, note: 'unchanged by this phase: the registered common ladder evidence stays C4C 9 / 11' },
    diagnostic: {
      source: 'B2-C2B2B RESULT (L1 at common L1) + B2-C2B2D RESULT (the L2 Targets it recovered at first compatible context x tight extent, 10 minutes / 8 GB) + this phase (the remaining L2 Targets, same Search input, 60 minutes / 12 GB)',
      previous: structuredClone(input.b2c2b2d.e1.diagnostic),
      l1: { population: input.l1.length, exactTargets: { ...l1 }, conditions: 'common L1 extent, P1 ranks 1..32 (no oracle-guided context selection)' },
      l2: { population: input.l2.length, exactTargets: l2, fromB2C2B2D: { targets: recoveredByB2D.length, exactTargets: fromB2D }, fromB2C2B2E: { targets: ours.size, exactTargets: fromB2E, decision: input.decision,
        evidenceGrade: input.evidenceGrade }, conditions: 'oracle-guided: B2-C1 first compatible context x max(Production default, B2-C2B1 required) extent; B2-C2B2E extends only the execution budget' },
      total, allRecovered,
      statement: allRecovered ? `E1 ${input.e1.length} / ${input.e1.length} exact oracle Routes have now been delivered at least under oracle-guided diagnostic conditions (L1 ${input.l1.length} / ${input.l1.length} by B2-C2B2B at common L1; L2 ${recoveredByB2D.length} by B2-C2B2D at the first compatible context x tight extent and the remaining ${ours.size} by B2-C2B2E at the same context x tight extent with an extended execution budget of 60 minutes / 12 GB)` : null,
      statementScope: 'oracle-guided diagnostic only: not "11 / 11 under the registered common L1 / L2 ladder", not a Production scheduler result, not a Production extent selector, not an acceptable Production runtime' },
    limitations: [...PHASE2C26B2C2B2E_E1_DIAGNOSTIC_LIMITATIONS],
  }
}

// ---------------------------------------------------------------- the whole analysis

type Oracle = { routes: readonly unknown[]; gogmaUsage: readonly unknown[] }

export interface Phase2C26B2C2B2EAnalysisInput {
  derivations: readonly Phase2C26B2C2B2EProbeDerivation[]
  tasks: readonly Phase2C26B2C2B2ETaskInput[]
  runs: readonly Phase2C26B2C2B2ERun[]
  reach: readonly Phase2C26B2C2AReach[]
  excludedRouteKeySha256: ReadonlyMap<string, string | null>
  /** Per task ID the re-derived default context of the B2-C2B2D counterpart (`phase2c26b2c2b2dRederiveBaselineContext()` over the B2-C2B2D task row). */
  rederivations: ReadonlyMap<string, Phase2C26B2C2B2DBaselineRederivation>
  /** Per task ID the runner's memory log of its Search child. */
  memorySamples: ReadonlyMap<string, readonly Phase2C26B2C2B2EMemorySample[]>
  b2c2b2d: Phase2C26B2C2B2EB2C2B2DAuthority
  oracle: Oracle
  smoke: boolean
  conditions: { budgetMs: number; childHeapMb: number }
  interruption?: Phase2C26B2C2B2EInterruption | null
}

/** Raw consistency, the per-context comparison, the per-Target rows, the paired comparison, the trajectories, the execution summary and every invalid reason found here. */
export function runPhase2C26B2C2B2EAnalysis({ derivations, tasks, runs, reach, excludedRouteKeySha256, rederivations, memorySamples, b2c2b2d, oracle, smoke, conditions, interruption = null }: Phase2C26B2C2B2EAnalysisInput) {
  const expectedExtents = new Map(derivations.map(d => [d.targetWeaponId, d.tightExtent]))
  const invalidReasons: string[] = validatePhase2C26B2C2B2ERaw({ tasks, runs, smoke, expectedExtents, interruption }).map(issue => issue.startsWith('semantic_failure') ? issue : `raw: ${issue}`)
  if (!smoke && (conditions.budgetMs !== PHASE2C26B2C2B2E_BUDGET_MS || conditions.childHeapMb !== PHASE2C26B2C2B2E_CHILD_HEAP_MB)) invalidReasons.push('conditions: the execution budget / heap is not 60 minutes / 12,288 MB')
  const runOf = new Map(runs.map(r => [r.taskId, r]))
  const reachOf = new Map(reach.map(r => [r.targetWeaponId, r]))
  if (!same(tasks.map(t => t.targetWeaponId), derivations.map(d => d.targetWeaponId))) invalidReasons.push('raw: the tasks are not one per probe in probe order')
  if (!same(tasks.map(t => t.taskId), derivations.map(d => d.b2c2b2dTaskId))) invalidReasons.push('raw: the task IDs are not the B2-C2B2D task IDs')
  for (const r of reach) invalidReasons.push(...r.inconsistencies.map(i => `reach: ${i}`))
  for (const run of runs) if (run.outcome.record === 'context_mismatch') invalidReasons.push(`semantic: ${run.taskId}: context mismatch in the Search child`)
  const contexts = tasks.map(task => phase2c26b2c2b2aCompareContext(runOf.get(task.taskId), task, reachOf.get(task.targetWeaponId)?.compatibleGroupIndexes.includes(task.groupIndex) ?? false, oracle))
  for (const c of contexts) invalidReasons.push(...c.inconsistencies.map(i => i.startsWith('semantic_failure') ? i : `comparison: ${i}`))
  const rows: Phase2C26B2C2B2ETargetRow[] = []
  const paired: Phase2C26B2C2B2EPairedRow[] = []
  const trajectories: { taskId: string; targetWeaponId: string; trajectory: Phase2C26B2C2B2ETrajectory }[] = []
  tasks.forEach((task, index) => {
    const derivation = derivations.find(d => d.targetWeaponId === task.targetWeaponId)
    const recomputed = reachOf.get(task.targetWeaponId)?.p1FirstCompatibleRank ?? null
    if (!derivation) { invalidReasons.push(`authority: ${task.taskId}: no probe derivation`); return }
    if (task.contextRank !== derivation.b2c1FirstCompatibleRank) invalidReasons.push(`authority: ${task.taskId}: the task rank is not the B2-C1 first compatible rank`)
    if (recomputed !== derivation.b2c1FirstCompatibleRank) invalidReasons.push(`authority: ${task.targetWeaponId}: recomputed P1 first compatible rank ${String(recomputed)} is not B2-C1's ${String(derivation.b2c1FirstCompatibleRank)}`)
    const row = phase2c26b2c2b2dTargetRow(task, contexts[index]!, runOf.get(task.taskId), derivation.b2c1FirstCompatibleRank, recomputed, phase2c26b2b2a2OracleOperationCost(oracle, task.targetWeaponId))
    if (!row.compatible) invalidReasons.push(`authority: ${task.taskId}: the selected first compatible context is not reservation-compatible under the recomputation`)
    rows.push(row)
    const pair = phase2c26b2c2b2ePairedRow(task, runOf.get(task.taskId), contexts[index]!, excludedRouteKeySha256.get(task.taskId) ?? null, b2c2b2d, rederivations.get(task.taskId) ?? null, conditions)
    invalidReasons.push(...pair.identity.issues.map(i => `paired: ${i}`))
    paired.push(pair)
    trajectories.push({ taskId: task.taskId, targetWeaponId: task.targetWeaponId, trajectory: phase2c26b2c2b2eTrajectory(memorySamples.get(task.taskId) ?? []) })
  })
  const execution = phase2c26b2c2b2dExecution(tasks, runs)
  const exactTargets = Object.fromEntries(PHASE2C26B2C2B2E_CAPTURE_POLICIES.map(p => [p, rows.filter(r => r.hit[p]).length])) as Record<Phase2C26B2C2B2ECapturePolicy, number>
  const unmeasuredTasks = tasks.length - execution.completed
  return {
    contexts, rows, paired, trajectories, invalidReasons,
    aggregates: { exactTargets, cascade: { c8: rows.filter(r => r.recovery === 'C8').length, c8MissC32: rows.filter(r => r.recovery === 'C32').length,
      c32MissC4C: rows.filter(r => r.recovery === 'C4C').length, c4cMiss: rows.filter(r => r.recovery === 'none').length },
    missClasses: Object.fromEntries([...new Set(rows.flatMap(r => r.missClass === null ? [] : [r.missClass]))].sort().map(m => [m, rows.filter(r => r.missClass === m).length])),
    execution, candidates: phase2c26b2c2b2aCandidates(tasks, runs),
    measurementCompleteness: { status: unmeasuredTasks === 0 ? 'complete' as const : 'incomplete' as const, tasks: tasks.length, measured: execution.completed, unmeasured: unmeasuredTasks,
      breakdown: { contextMismatch: execution.contextMismatch, timeout: execution.timeout, outOfMemory: execution.outOfMemory, processFailure: execution.processFailure, notRun: execution.notRun } } },
    decisionInput: { tasks: tasks.length, targets: derivations.length, unmeasuredTasks: Math.max(0, unmeasuredTasks), exactTargets },
  }
}

/** `peakOf` for the analyzer's task rows (the same rule the paired side uses). */
export const phase2c26b2c2b2ePeak = peakOf
