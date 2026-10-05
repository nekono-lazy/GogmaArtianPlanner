/**
 * Issue #154 Phase 2-C2.6-B2-C2B2D post-hoc analysis only. It reads the finished (or interrupted and reconstructed) B2-C2B2D
 * raw run with every child record and the runner start attestation and, as explicit analyzer arguments AFTER the run ended,
 * the B2-C2B1 RESULT (population, required extents), the B2-C1 RESULT (P1 first-compatible authority), the B2-B1 RESULT
 * (schedule parity / hash chain), the B2-C2B2B RESULT (the E1 ∩ L1 half of the E1 aggregate), the B2-C2B2C RESULT (the paired
 * common-L2 baseline of the same Targets and contexts), the 1,657 oracle RESULT and its manifest. It runs no Search, no kernel
 * and no Planner and feeds nothing back into any calculation.
 *
 * The per-context comparison is B2-C2B2A's, unchanged (`phase2c26b2c2b2aCompareContext()` -> `phase2c26b2c2aCompareContext()`
 * -> `phase2c26b2b2aCompare()` -> `phase2c2OracleCoverage()`, compatibility through `phase2c26b2c2aReach()`). B2-C2B2D adds the
 * tight extent checks of the 4 probes, a one-context-per-Target row, the paired comparison with B2-C2B2C's task of the same
 * Target and P1 rank (identity must hold; the extent and the Search input digest are the intended differences), the registered
 * diagnostic decision (never a scheduler decision), the A / B / C interpretation of the two Targets B2-C2B2C left unrecovered,
 * and the E1 aggregate under oracle-guided diagnostic conditions kept apart from the common-ladder evidence (still 9 / 11).
 */
import { stableStringify } from '../domain/models/hashing'
import { defaultPlannerAlternativeSearchExtent, type PlannerAlternativeSearchExtent } from '../domain/search'
import type { Phase2C25APreSearchContext } from './plannerGlobalPhase2C25A'
import { phase2c26b1SearchInputDigest } from './plannerGlobalPhase2C26B1'
import { reconstructPhase2C26B2B2AContext, type Phase2C26B2B2AContext } from './plannerGlobalPhase2C26B2B2A'
import { phase2c26b2b2a2FirstDecidingKey, phase2c26b2b2a2OracleOperationCost } from './plannerGlobalPhase2C26B2B2A2Analysis'
import type { Phase2C26B2B2A2DeliveredCandidate } from './plannerGlobalPhase2C26B2B2A2'
import type { Phase2C26B2C1Schedule } from './plannerGlobalPhase2C26B2C1'
import type { Phase2C26B2C2AReach } from './plannerGlobalPhase2C26B2C2AAnalysis'
import {
  phase2c26b2c2b2aCandidates,
  phase2c26b2c2b2aCompareContext,
  PHASE2C26B2C2B2A_CAPTURE_POLICIES,
  type Phase2C26B2C2B2ACapturePolicy,
  type Phase2C26B2C2B2AContextComparison,
  type Phase2C26B2C2B2ARun,
} from './plannerGlobalPhase2C26B2C2B2AAnalysis'
import type { Phase2C26B2C2B2CB2C2B2BAuthority } from './plannerGlobalPhase2C26B2C2B2CTargets'
import {
  phase2c26b2c2b2dExtentBoundIssues,
  PHASE2C26B2C2B2D_CANDIDATE_SAFETY_CAP,
  PHASE2C26B2C2B2D_COMMON_L2_EXTENT,
  PHASE2C26B2C2B2D_EXPECTED_TASKS,
  PHASE2C26B2C2B2D_MAX_COST_COHORTS,
  PHASE2C26B2C2B2D_TARGETS,
  verifyPhase2C26B2C2B2DStartAttestation,
  type Phase2C26B2C2B2DAttestationExpectation,
  type Phase2C26B2C2B2DSearchRecord,
  type Phase2C26B2C2B2DTaskInput,
} from './plannerGlobalPhase2C26B2C2B2D'
import type { Phase2C26B2C2B2DB2C2B2CAuthority, Phase2C26B2C2B2DB2C2B2CTaskRow, Phase2C26B2C2B2DProbeDerivation } from './plannerGlobalPhase2C26B2C2B2DTargets'

const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}
type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)

// ---------------------------------------------------------------- registered before the Stage 1 measurement

export type Phase2C26B2C2B2DCapturePolicy = Phase2C26B2C2B2ACapturePolicy
export const PHASE2C26B2C2B2D_CAPTURE_POLICIES = PHASE2C26B2C2B2A_CAPTURE_POLICIES

/** One run as the raw record holds it (B2-C2B2A's shape). */
export type Phase2C26B2C2B2DRun = Phase2C26B2C2B2ARun
export type Phase2C26B2C2B2DContextComparison = Phase2C26B2C2B2AContextComparison

const searchOf = (run: Phase2C26B2C2B2DRun | undefined): Phase2C26B2C2B2DSearchRecord | null => run?.record?.status === 'searched' ? run.record.search : null
const deliveries = (s: Phase2C26B2C2B2DSearchRecord): Phase2C26B2B2A2DeliveredCandidate[] => [...s.candidates, ...(s.nextCostSentinel ? [s.nextCostSentinel] : [])]
const peakOf = (r: Phase2C26B2C2B2DRun) => ({ heap: Math.max(r.memory?.sampledMaxHeapUsedBytes ?? 0, r.lastIpcMemory?.maxHeapUsedBytes ?? 0),
  rss: Math.max(r.memory?.sampledMaxRssBytes ?? 0, (r.memory?.maxRssKiB ?? 0) * 1024, r.lastIpcMemory?.maxRssBytes ?? 0) })

// ---------------------------------------------------------------- interrupted runs

/**
 * A run whose parent runner did not end by itself. The ran tasks are analyzed exactly as recorded; the rest are `notRun`: never
 * Candidate 0, never a Search failure, and they keep the decision at B2C2B2D_INCOMPLETE. Whether the run is formal evidence is
 * decided by the runner start attestation alone, never by being interrupted.
 */
export interface Phase2C26B2C2B2DInterruption {
  stoppedAt: string
  reason: string
  notRunTaskIds: string[]
}

// ---------------------------------------------------------------- launch provenance (evidence grade, separate from the Search decision)

export type Phase2C26B2C2B2DLaunchProvenanceSource = 'runner_start_attestation' | 'none'
export type Phase2C26B2C2B2DEvidenceGrade = 'formal' | 'diagnostic_partial' | 'non_formal'

export interface Phase2C26B2C2B2DLaunchProvenance {
  verified: boolean
  source: Phase2C26B2C2B2DLaunchProvenanceSource
  /** The launch working tree is attested clean by the runner (never inferred after the fact). */
  workingTreeCleanVerified: boolean
  issues: string[]
  /** The issues that break the attestation's integrity; a present attestation with one is an invalid run. */
  integrityIssues: string[]
  reason: string | null
}

/**
 * The launch provenance of a raw run (B2-C2B2C's rule with the probe manifest): verified only by the runner start attestation
 * file of the run dir, whose SHA-256 must be the one the raw recorded and whose body must verify against the independently
 * obtained HEAD / code / Export / probe manifest values. No attestation never verifies.
 */
export function phase2c26b2c2b2dLaunchProvenance(input: {
  attestationFile: { sha256: string; body: unknown } | null
  recordedAttestationSha256: string | null
  environment: Record<string, unknown>
  expected: Phase2C26B2C2B2DAttestationExpectation
}): Phase2C26B2C2B2DLaunchProvenance {
  if (input.attestationFile === null) {
    return { verified: false, source: 'none', workingTreeCleanVerified: false, issues: ['no start attestation in the run dir'], integrityIssues: [],
      reason: 'The runner start attestation is missing: the launch HEAD, working-tree cleanliness and benchmark code hash are not attested by the runner.' }
  }
  const integrityIssues: string[] = []
  if (input.recordedAttestationSha256 !== input.attestationFile.sha256) integrityIssues.push('the attestation file is not the one the raw recorded')
  const verification = verifyPhase2C26B2C2B2DStartAttestation(input.attestationFile.body, input.expected)
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

/** The evidence grade: formal only with every formal condition AND verified launch provenance; partial or not is recorded separately. */
export function phase2c26b2c2b2dEvidenceGrade(input: { formalConditions: boolean; launchProvenanceVerified: boolean; partialRun: boolean }): Phase2C26B2C2B2DEvidenceGrade {
  if (input.formalConditions && input.launchProvenanceVerified) return 'formal'
  return input.partialRun ? 'diagnostic_partial' : 'non_formal'
}

// ---------------------------------------------------------------- raw consistency (fails the run closed)

/**
 * Internal drift of the raw run (B2-C2B2C's rules with the tight extent): every task carries exactly its Target's expected
 * tight extent (re-derived by the analyzer from the authorities) inside the bounds; every searched record names its task's
 * Target, rank, group, digests (default and tight), representative, extent and capture rule, excludes exactly one Route key and
 * never delivers it; deliveries are indexed 0..n-1 with unique keys; the comparator verdict is "earlier first" and agrees with
 * the six keys; the captured costs are the first <= 4 distinct costs and the sentinel a fifth; the termination agrees with the
 * flags. A cheaper Candidate after a dearer one is a semantic failure.
 */
export function validatePhase2C26B2C2B2DRaw(input: { tasks: readonly Phase2C26B2C2B2DTaskInput[]; runs: readonly Phase2C26B2C2B2DRun[]; smoke: boolean;
  expectedExtents: ReadonlyMap<string, PlannerAlternativeSearchExtent>; interruption?: Phase2C26B2C2B2DInterruption | null }): string[] {
  const issues: string[] = []
  const { tasks, runs } = input
  const stop = input.interruption ?? null
  if (stop !== null) {
    const ranIds = runs.map(r => r.taskId)
    if (!same(ranIds, tasks.slice(0, runs.length).map(t => t.taskId))) issues.push('the ran tasks of the interrupted run are not a prefix of the task order')
    if (!same(stop.notRunTaskIds, tasks.slice(runs.length).map(t => t.taskId))) issues.push('the notRun tasks are not exactly the tasks after the interruption')
  } else if (!input.smoke && runs.length !== tasks.length) issues.push(`Stage 1 ran ${runs.length} of ${tasks.length} tasks`)
  if (new Set(runs.map(r => r.taskId)).size !== runs.length) issues.push('a task ran twice')
  if (new Set(tasks.map(t => t.taskId)).size !== tasks.length) issues.push('a planned task repeats')
  if (new Set(tasks.map(t => t.targetWeaponId)).size !== tasks.length) issues.push('a Target holds more than one task')
  for (const task of tasks) {
    const bound = phase2c26b2c2b2dExtentBoundIssues(task.extent)
    if (bound.length > 0) issues.push(`${task.taskId}: the task extent is outside the bounds (${bound.join('; ')})`)
    const expected = input.expectedExtents.get(task.targetWeaponId)
    if (expected === undefined) issues.push(`${task.taskId}: no expected tight extent for the Target`)
    else if (!same(task.extent, expected)) issues.push(`${task.taskId}: the task extent is not the Target's tight extent`)
  }
  const taskById = new Map(tasks.map(t => [t.taskId, t]))
  for (const run of runs) {
    const task = taskById.get(run.taskId)
    if (!task) { issues.push(`${run.taskId}: not a planned task`); continue }
    if (!same(run.task, task)) issues.push(`${run.taskId}: the child received another task`)
    if (run.outcome.process === 'completed' && run.record === null) issues.push(`${run.taskId}: a completed child without a record`)
    if (run.record !== null && run.record.taskId !== run.taskId) issues.push(`${run.taskId}: the record names another task`)
    const s = searchOf(run)
    if (s === null) continue
    const at = run.taskId
    if (s.targetWeaponId !== task.targetWeaponId || s.contextRank !== task.contextRank || s.groupIndex !== task.groupIndex || s.reservationDigest !== task.reservationDigest
      || s.targetEligibleMinCardinality !== task.targetEligibleMinCardinality || s.representativeFixedSetId !== task.representativeFixedSetId
      || !same(s.representativeFixedTargetWeaponIds, task.representativeFixedTargetWeaponIds) || s.searchInputDigest !== task.searchInputDigest
      || s.defaultSearchInputDigest !== task.defaultSearchInputDigest) issues.push(`${at}: the record is not the task's context`)
    if (s.maxCostCohorts !== PHASE2C26B2C2B2D_MAX_COST_COHORTS || s.candidateSafetyCap !== PHASE2C26B2C2B2D_CANDIDATE_SAFETY_CAP) issues.push(`${at}: capture rule drift`)
    if (!same(s.extent, task.extent)) issues.push(`${at}: the record extent is not the task's tight extent`)
    if (s.searchInputDigest === s.defaultSearchInputDigest) issues.push(`${at}: the tight digest equals the default digest`)
    if (s.excludedRouteKeys.length !== 1) issues.push(`${at}: not exactly one excluded Route key`)
    const all = deliveries(s)
    if (all.some(c => s.excludedRouteKeys.includes(c.stableKey))) issues.push(`${at}: an excluded Route was delivered`)
    if (all.length !== s.summary.deliveredCandidates) issues.push(`${at}: delivered count drift`)
    if (all.some((c, i) => c.deliveryIndex !== i)) issues.push(`${at}: delivery index drift`)
    if (new Set(all.map(c => c.stableKey)).size !== all.length) issues.push(`${at}: a Candidate was delivered twice`)
    if (all.some(c => c.summary.estimatedOperationCount !== c.orderingKeys.estimatedOperationCount) || s.costReadIssues.length > 0) issues.push(`${at}: the summary cost is not the Candidate cost`)
    if (s.nonmonotonicIndexes.length > 0 || all.some((c, i) => i > 0 && c.orderingKeys.estimatedOperationCount < all[i - 1]!.orderingKeys.estimatedOperationCount)) {
      issues.push(`semantic_failure: ${at}: Candidate cost nonmonotonic (a cheaper Candidate after a dearer one)`)
    }
    if (all.some((c, i) => (i === 0) !== (c.comparatorWithPrevious === null))) issues.push(`${at}: comparator record drift`)
    if (all.some((c, i) => i > 0 && c.comparatorWithPrevious !== -1)) issues.push(`${at}: the Search comparator does not put a delivery after its predecessor`)
    if (all.some((c, i) => i > 0 && phase2c26b2b2a2FirstDecidingKey(all[i - 1]!, c).sign !== c.comparatorWithPrevious)) issues.push(`${at}: the six recorded keys disagree with the Search comparator`)
    const distinct = [...new Set(s.candidates.map(c => c.orderingKeys.estimatedOperationCount))]
    if (!same(distinct, s.capturedCosts) || s.distinctCostCohorts !== s.capturedCosts.length || s.capturedCosts.length > PHASE2C26B2C2B2D_MAX_COST_COHORTS) issues.push(`${at}: captured cost cohorts drift`)
    const sentinelCost = s.nextCostSentinel?.orderingKeys.estimatedOperationCount
    if (s.nextCostSentinel && (s.capturedCosts.length !== PHASE2C26B2C2B2D_MAX_COST_COHORTS || s.capturedCosts.includes(sentinelCost!))) issues.push(`${at}: the sentinel is not the first Candidate of a fifth cost`)
    const f = s.summary
    const below = s.candidates.length < PHASE2C26B2C2B2D_CANDIDATE_SAFETY_CAP
    const ok = s.termination === 'four_cost_cohorts_drained' ? s.status === 'consumer_stop' && f.stoppedByConsumer && s.nextCostSentinel !== null && !s.safetyCapHit && s.captureComplete && below
      : s.termination === 'candidate_safety_cap' ? s.status === 'consumer_stop' && f.stoppedByConsumer && s.nextCostSentinel === null && s.safetyCapHit && !s.captureComplete
        && s.candidates.length === PHASE2C26B2C2B2D_CANDIDATE_SAFETY_CAP
        : s.termination === 'stopped_by_extent' ? s.status === 'stopped_by_extent' && !f.stoppedByConsumer && f.stoppedByExtent && s.nextCostSentinel === null && !s.safetyCapHit && s.captureComplete && below
          : s.termination === 'exhausted' && s.status === 'exhausted' && !f.stoppedByConsumer && !f.stoppedByExtent && f.exhausted && s.nextCostSentinel === null && !s.safetyCapHit && s.captureComplete && below
    if (!ok) issues.push(`${at}: the termination disagrees with the flags / counts`)
    if (run.outcome.searchStatus !== s.status || run.outcome.termination !== s.termination || run.outcome.candidateCount !== s.candidates.length) issues.push(`${at}: the outcome disagrees with the record`)
  }
  return issues
}

// ---------------------------------------------------------------- one context per Target

export type Phase2C26B2C2B2DMissClass = 'unmeasured' | 'safety_cap_unresolved' | 'capture_insufficient' | 'compatible_non_delivery'

export interface Phase2C26B2C2B2DTargetRow {
  targetWeaponId: string
  taskId: string
  selectedRank: number
  b2c1FirstCompatibleRank: number | null
  recomputedFirstCompatibleRank: number | null
  /** The selected context is reservation-compatible under the analyzer's recomputation (it must be: it is the first compatible one). */
  compatible: boolean
  measured: boolean
  process: string
  termination: string | null
  candidateCount: number | null
  captureComplete: boolean | null
  safetyCapHit: boolean | null
  capturedCosts: number[]
  coverage: string | null
  firstExactIndex: number | null
  firstExactCost: number | null
  oracleOperationCost: number | null
  hit: Record<Phase2C26B2C2B2DCapturePolicy, boolean>
  /** The smallest policy whose prefix holds the exact Candidate. */
  recovery: Phase2C26B2C2B2DCapturePolicy | 'none'
  missClass: Phase2C26B2C2B2DMissClass | null
  partialWithoutExact: boolean
}

/** The per-Target row of a one-context probe: B2-C2B2A's comparison of that one context, its recovery and, without an exact, why. */
export function phase2c26b2c2b2dTargetRow(task: Phase2C26B2C2B2DTaskInput, comparison: Phase2C26B2C2B2DContextComparison, run: Phase2C26B2C2B2DRun | undefined,
  b2c1FirstCompatibleRank: number | null, recomputedFirstCompatibleRank: number | null, oracleOperationCost: number | null): Phase2C26B2C2B2DTargetRow {
  const recovery = PHASE2C26B2C2B2D_CAPTURE_POLICIES.find(p => comparison.hit[p]) ?? 'none'
  let missClass: Phase2C26B2C2B2DMissClass | null = null
  if (recovery === 'none') {
    if (!comparison.measured) missClass = 'unmeasured'
    else if (comparison.safetyCapHit) missClass = 'safety_cap_unresolved'
    else if (oracleOperationCost !== null && comparison.capturedCosts.length === PHASE2C26B2C2B2D_MAX_COST_COHORTS && oracleOperationCost > Math.max(...comparison.capturedCosts)) missClass = 'capture_insufficient'
    else missClass = 'compatible_non_delivery'
  }
  const s = searchOf(run)
  return { targetWeaponId: task.targetWeaponId, taskId: task.taskId, selectedRank: task.contextRank, b2c1FirstCompatibleRank, recomputedFirstCompatibleRank, compatible: comparison.compatible,
    measured: comparison.measured, process: run?.outcome.record === 'context_mismatch' ? 'context_mismatch' : run?.process.outcome ?? 'not_run', termination: s?.termination ?? null,
    candidateCount: comparison.candidateCount, captureComplete: comparison.captureComplete, safetyCapHit: comparison.safetyCapHit, capturedCosts: [...comparison.capturedCosts],
    coverage: comparison.coverage, firstExactIndex: comparison.firstExactIndex, firstExactCost: comparison.firstExactCost, oracleOperationCost, hit: { ...comparison.hit }, recovery, missClass,
    partialWithoutExact: recovery === 'none' && comparison.partialIndexes.length > 0 }
}

// ---------------------------------------------------------------- paired comparison with B2-C2B2C (same Target, same P1 rank)

// ---------------------------------------------------------------- the baseline default context, re-derived post hoc (excluded current Route identity)

/**
 * B2-C2B2C's default context of one task, rebuilt post hoc from the analyzer's own re-derived schedule (never from a Search
 * record): the one schedule row of the baseline task's Target at its P1 rank, the unchanged `reconstructPhase2C26B2B2AContext()`
 * from that row's representative / cardinality / reservation digest, and its excluded current Route key. It exists so that a
 * baseline task without a record (timeout / OOM) still has an excluded current Route identity: the key is fixed by the
 * snapshot before any Search starts, and the baseline task's committed default Search input digest - the B1 digest of a body
 * that holds the excluded Route keys - must be reproduced by the rebuilt body.
 */
export interface Phase2C26B2C2B2DBaselineRederivation {
  taskId: string
  valid: boolean
  issues: string[]
  /** Schedule rows holding the baseline Target at the baseline P1 rank (exactly 1 is required). */
  scheduleRows: number
  groupIndex: number | null
  reservationDigest: string | null
  targetEligibleMinCardinality: number | null
  representativeFixedSetId: string | null
  representativeFixedTargetWeaponIds: string[] | null
  /** The rebuilt default context's Search input digest (must be the baseline task's default digest). */
  defaultSearchInputDigest: string | null
  /** The B1 digest recomputed from the rebuilt body (excluded Route keys included) equals the baseline default digest. */
  bodyDigestMatches: boolean
  excludedRouteKeyCount: number | null
  /** The one excluded key is the Target's current Route key (the "excluded current Route"). */
  excludedRouteIsCurrentRoute: boolean
  /** SHA-256 (the analyzer's own digest, injected) of the one excluded current Route key. */
  excludedRouteKeySha256: string | null
}

/** The B1 pre-Search body of a reconstructed default context, exactly as `reconstructPhase2C26B2B2AContext()` builds it. */
function defaultBodyOf(context: Phase2C26B2B2AContext): Phase2C25APreSearchContext {
  return { orientationId: '', workIndex: 0, targetWeaponId: context.targetWeaponId, status: 'searchable', invalidatedBuildListEntryId: context.currentBuildListEntryId,
    invalidatedRouteKey: context.currentRouteKey, fixedRouteBuildListEntryIds: [...context.fixedBuildListEntryIds], reservation: context.reservation, searchReservation: context.reservation,
    excludedRouteKeys: [...context.excludedRouteKeys], extent: { ...context.extent }, originDigest: context.originDigest, contextDigest: '' }
}

/**
 * Re-derives the excluded current Route of one B2-C2B2C task from the schedule (see `Phase2C26B2C2B2DBaselineRederivation`).
 * Fails closed (valid = false, with issues) when the Target / rank holds other than exactly one schedule row, that row's group /
 * reservation / representative / cardinality differ from the baseline task, the context cannot be rebuilt, the rebuilt context
 * is not at the Production default extent, its digest or the recomputed body digest is not the baseline default digest, or the
 * excluded Route is not exactly the one current Route key. `hashKey` is the analyzer's SHA-256 over the raw key.
 */
export function phase2c26b2c2b2dRederiveBaselineContext(schedule: Phase2C26B2C1Schedule, baseline: Phase2C26B2C2B2DB2C2B2CTaskRow, hashKey: (key: string) => string): Phase2C26B2C2B2DBaselineRederivation {
  const issues: string[] = []
  const at = `${baseline.taskId} (B2-C2B2C)`
  const empty = { taskId: baseline.taskId, groupIndex: null, reservationDigest: null, targetEligibleMinCardinality: null, representativeFixedSetId: null, representativeFixedTargetWeaponIds: null,
    defaultSearchInputDigest: null, bodyDigestMatches: false, excludedRouteKeyCount: null, excludedRouteIsCurrentRoute: false, excludedRouteKeySha256: null }
  const rows = schedule.contexts.filter(c => c.targetWeaponId === baseline.targetWeaponId && c.ranks.P1 === baseline.contextRank)
  if (rows.length !== 1) return { ...empty, valid: false, scheduleRows: rows.length, issues: [`${at}: ${rows.length} schedule rows hold the Target at P1 rank ${baseline.contextRank}`] }
  const row = rows[0]!
  if (row.groupIndex !== baseline.groupIndex) issues.push(`${at}: the schedule row group differs from the baseline task`)
  if (row.reservationDigest !== baseline.reservationDigest) issues.push(`${at}: the schedule row reservation digest differs from the baseline task`)
  if (row.targetEligibleMinCardinality !== baseline.targetEligibleMinCardinality) issues.push(`${at}: the schedule row cardinality differs from the baseline task`)
  if (row.representativeFixedSetId !== baseline.representativeFixedSetId || !same(row.representativeFixedTargetWeaponIds, baseline.representativeFixedTargetWeaponIds)) {
    issues.push(`${at}: the schedule row representative differs from the baseline task`)
  }
  const fields = { groupIndex: row.groupIndex, reservationDigest: row.reservationDigest, targetEligibleMinCardinality: row.targetEligibleMinCardinality,
    representativeFixedSetId: row.representativeFixedSetId, representativeFixedTargetWeaponIds: [...row.representativeFixedTargetWeaponIds] }
  const rebuilt = reconstructPhase2C26B2B2AContext(schedule.snapshot, { targetWeaponId: row.targetWeaponId, fixedSetId: row.representativeFixedSetId, cardinality: row.targetEligibleMinCardinality,
    reservationDigest: row.reservationDigest })
  if (!rebuilt.valid) return { ...empty, ...fields, valid: false, scheduleRows: 1, issues: [...issues, `${at}: the default context cannot be rebuilt (${rebuilt.issues.join('/')})`] }
  const context = rebuilt.context
  if (context.groupIndex !== baseline.groupIndex || context.reservationDigest !== baseline.reservationDigest) issues.push(`${at}: the rebuilt context group / reservation differs from the baseline task`)
  if (!same(context.extent, { ...defaultPlannerAlternativeSearchExtent })) issues.push(`${at}: the rebuilt context is not at the Production default extent`)
  if (context.searchInputDigest !== baseline.defaultSearchInputDigest) issues.push(`${at}: the rebuilt default Search input digest is not the baseline default digest`)
  const bodyDigestMatches = phase2c26b1SearchInputDigest(defaultBodyOf(context)) === baseline.defaultSearchInputDigest
  if (!bodyDigestMatches) issues.push(`${at}: the B1 digest of the rebuilt body (excluded Route keys included) is not the baseline default digest`)
  const excludedRouteKeyCount = context.excludedRouteKeys.length
  if (excludedRouteKeyCount !== 1) issues.push(`${at}: ${excludedRouteKeyCount} excluded Route keys, not exactly one`)
  const excludedRouteIsCurrentRoute = excludedRouteKeyCount === 1 && context.excludedRouteKeys[0] === context.currentRouteKey
  if (!excludedRouteIsCurrentRoute) issues.push(`${at}: the excluded Route is not the current Route`)
  return { taskId: baseline.taskId, valid: issues.length === 0, issues, scheduleRows: 1, ...fields, defaultSearchInputDigest: context.searchInputDigest, bodyDigestMatches,
    excludedRouteKeyCount, excludedRouteIsCurrentRoute, excludedRouteKeySha256: excludedRouteKeyCount === 1 ? hashKey(context.excludedRouteKeys[0]!) : null }
}

/**
 * How the excluded current Route identity of one pair was proved. The re-derived default-context key is compared with the
 * baseline record when B2-C2B2C kept one (`b2c2b2c_record`), or used as the baseline identity when its task ended without a
 * record (`rederived_default_context`: the key is fixed before the Search and bound by the baseline default digest); it is
 * compared with this phase's Search record when that exists (`b2c2b2d_record`), or else bound by this task's identical default
 * digest, which the Search child itself checked against the same rebuild before searching (`rederived_default_context`).
 */
export interface Phase2C26B2C2B2DExcludedRouteComparison {
  verified: boolean
  rederivedExcludedRouteKeySha256: string | null
  baselineSource: 'b2c2b2c_record' | 'rederived_default_context' | null
  baselineRecordMatchesRederived: boolean | null
  b2c2b2dSource: 'b2c2b2d_record' | 'rederived_default_context' | null
  b2c2b2dRecordMatchesRederived: boolean | null
}

/** The task fields that must be identical to B2-C2B2C's task of the same Target and rank (the context identity). */
export const PHASE2C26B2C2B2D_PAIRED_IDENTITY_FIELDS = ['targetWeaponId', 'contextRank', 'groupIndex', 'reservationDigest', 'targetEligibleMinCardinality', 'representativeFixedSetId',
  'representativeFixedTargetWeaponIds', 'defaultSearchInputDigest'] as const

export interface Phase2C26B2C2B2DPairedSide {
  process: string
  wallMs: number | null
  searchElapsedMs: number | null
  peakHeapBytes: number | null
  peakRssBytes: number | null
  yields: number | null
  termination: string | null
  deliveredCandidates: number | null
  candidateCount: number | null
  safetyCapHit: boolean | null
  hit: Record<Phase2C26B2C2B2DCapturePolicy, boolean>
  firstExactIndex: number | null
  firstExactCost: number | null
  extent: PlannerAlternativeSearchExtent
  searchInputDigest: string
}

export interface Phase2C26B2C2B2DPairedRow {
  taskId: string
  targetWeaponId: string
  contextRank: number
  b2c2b2cTaskId: string | null
  identity: { matches: boolean; issues: string[]; excludedRouteKeyComparison: Phase2C26B2C2B2DExcludedRouteComparison }
  b2c2b2c: Phase2C26B2C2B2DPairedSide | null
  b2c2b2d: Phase2C26B2C2B2DPairedSide
  /** `<B2-C2B2C process> -> <B2-C2B2D process>`. */
  outcomeTransition: string | null
  delta: {
    /** B2-C2B2D - B2-C2B2C. A B2-C2B2C timeout / OOM wall is a lower bound of what that Search needed, so a negative delta then is a lower bound of the saving. */
    wallMs: number | null
    peakHeapBytes: number | null
    peakRssBytes: number | null
    searchElapsedMs: number | null
    yields: number | null
    extent: { maxNormalAdvance: number; maxGogmaAdvance: number; maxSkillAdvance: number }
    extentRatio: { maxNormalAdvance: number; maxGogmaAdvance: number; maxSkillAdvance: number }
  }
}

const diff = (a: number | null, b: number | null) => a === null || b === null ? null : a - b

/**
 * One B2-C2B2D task against B2-C2B2C's task of the same Target and P1 rank: the context identity (every identity field and the
 * excluded current Route key) must hold, the extent and the Search input digest must differ (the intended change), and the
 * resource / outcome deltas are reported. The excluded current Route is proved through the re-derived baseline default context
 * (`phase2c26b2c2b2dRederiveBaselineContext()`), compared with every recorded key (see `Phase2C26B2C2B2DExcludedRouteComparison`).
 * A missing or non-identical counterpart, a missing / invalid re-derivation or any key mismatch is an issue; `matches` is true
 * only with the excluded current Route proved too. An unmeasured side (timeout / OOM) keeps null Search fields: never Candidate 0.
 */
export function phase2c26b2c2b2dPairedRow(task: Phase2C26B2C2B2DTaskInput, run: Phase2C26B2C2B2DRun | undefined, comparison: Phase2C26B2C2B2DContextComparison,
  excludedRouteKeySha256: string | null, baseline: readonly Phase2C26B2C2B2DB2C2B2CTaskRow[], rederivation: Phase2C26B2C2B2DBaselineRederivation | null): Phase2C26B2C2B2DPairedRow {
  const issues: string[] = []
  const counterparts = baseline.filter(r => r.targetWeaponId === task.targetWeaponId && r.contextRank === task.contextRank)
  if (counterparts.length !== 1) issues.push(`${task.taskId}: ${counterparts.length} B2-C2B2C tasks hold this Target and rank`)
  const c = counterparts.length === 1 ? counterparts[0]! : null
  const route: Phase2C26B2C2B2DExcludedRouteComparison = { verified: false, rederivedExcludedRouteKeySha256: null, baselineSource: null, baselineRecordMatchesRederived: null,
    b2c2b2dSource: null, b2c2b2dRecordMatchesRederived: null }
  if (c !== null) {
    if (c.taskId !== task.taskId) issues.push(`${task.taskId}: the B2-C2B2C task ID is ${c.taskId}`)
    for (const field of PHASE2C26B2C2B2D_PAIRED_IDENTITY_FIELDS) if (!same(task[field], c[field])) issues.push(`${task.taskId}: ${field} differs from B2-C2B2C`)
    if (c.searchInputDigest === task.searchInputDigest) issues.push(`${task.taskId}: the Search input digest equals B2-C2B2C's (the extent did not change)`)
    if (same(task.extent, PHASE2C26B2C2B2D_COMMON_L2_EXTENT)) issues.push(`${task.taskId}: the extent is the common L2 extent`)
    // The excluded current Route identity, through the re-derived baseline default context.
    const routeIssues: string[] = []
    if (rederivation === null || rederivation.taskId !== c.taskId) routeIssues.push(`${task.taskId}: no re-derived baseline default context`)
    else {
      routeIssues.push(...rederivation.issues.map(i => `${task.taskId}: ${i}`))
      if (!rederivation.valid && rederivation.issues.length === 0) routeIssues.push(`${task.taskId}: the re-derived baseline default context is not valid`)
      if (rederivation.defaultSearchInputDigest !== task.defaultSearchInputDigest) routeIssues.push(`${task.taskId}: the re-derived default digest is not this task's default digest`)
      const rederived = rederivation.excludedRouteKeySha256
      route.rederivedExcludedRouteKeySha256 = rederived
      if (rederived === null) routeIssues.push(`${task.taskId}: no re-derived excluded current Route key`)
      if (c.excludedRouteKeySha256 !== null) {
        route.baselineSource = 'b2c2b2c_record'
        route.baselineRecordMatchesRederived = c.excludedRouteKeySha256 === rederived
        if (!route.baselineRecordMatchesRederived) routeIssues.push(`${task.taskId}: the B2-C2B2C record's excluded current Route differs from the re-derived one`)
      } else if (c.record === 'searched') routeIssues.push(`${task.taskId}: a searched B2-C2B2C task without a recorded excluded current Route`)
      else route.baselineSource = 'rederived_default_context'
      if (excludedRouteKeySha256 !== null) {
        route.b2c2b2dSource = 'b2c2b2d_record'
        route.b2c2b2dRecordMatchesRederived = excludedRouteKeySha256 === rederived
        if (!route.b2c2b2dRecordMatchesRederived) routeIssues.push(`${task.taskId}: the B2-C2B2D record's excluded current Route differs from the re-derived one`)
      } else if (searchOf(run) !== null) routeIssues.push(`${task.taskId}: a searched B2-C2B2D task without a recorded excluded current Route`)
      else route.b2c2b2dSource = 'rederived_default_context'
    }
    route.verified = routeIssues.length === 0
    issues.push(...routeIssues)
  } else issues.push(`${task.taskId}: the excluded current Route cannot be proved without the B2-C2B2C counterpart`)
  const s = searchOf(run)
  const peak = run ? peakOf(run) : null
  const ours: Phase2C26B2C2B2DPairedSide = { process: run?.outcome.record === 'context_mismatch' ? 'context_mismatch' : run?.process.outcome ?? 'not_run', wallMs: run?.process.wallMs ?? null,
    searchElapsedMs: s?.elapsedMs ?? null, peakHeapBytes: peak?.heap ?? null, peakRssBytes: peak?.rss ?? null, yields: run?.yields ?? null, termination: s?.termination ?? null,
    deliveredCandidates: s?.summary.deliveredCandidates ?? null, candidateCount: s?.candidates.length ?? null, safetyCapHit: s?.safetyCapHit ?? null, hit: { ...comparison.hit },
    firstExactIndex: comparison.firstExactIndex, firstExactCost: comparison.firstExactCost, extent: { ...task.extent }, searchInputDigest: task.searchInputDigest }
  const theirs: Phase2C26B2C2B2DPairedSide | null = c === null ? null : { process: c.process, wallMs: c.wallMs, searchElapsedMs: c.searchElapsedMs, peakHeapBytes: c.peakHeapBytes,
    peakRssBytes: c.peakRssBytes, yields: c.yields, termination: c.termination, deliveredCandidates: c.deliveredCandidates, candidateCount: c.candidateCount, safetyCapHit: c.safetyCapHit,
    hit: { ...c.hit }, firstExactIndex: c.firstExactIndex, firstExactCost: c.firstExactCost, extent: { ...PHASE2C26B2C2B2D_COMMON_L2_EXTENT }, searchInputDigest: c.searchInputDigest }
  const keys = ['maxNormalAdvance', 'maxGogmaAdvance', 'maxSkillAdvance'] as const
  return { taskId: task.taskId, targetWeaponId: task.targetWeaponId, contextRank: task.contextRank, b2c2b2cTaskId: c?.taskId ?? null,
    identity: { matches: issues.length === 0 && route.verified, issues, excludedRouteKeyComparison: route }, b2c2b2c: theirs, b2c2b2d: ours,
    outcomeTransition: theirs === null ? null : `${theirs.process} -> ${ours.process}`,
    delta: { wallMs: diff(ours.wallMs, theirs?.wallMs ?? null), peakHeapBytes: diff(ours.peakHeapBytes, theirs?.peakHeapBytes ?? null), peakRssBytes: diff(ours.peakRssBytes, theirs?.peakRssBytes ?? null),
      searchElapsedMs: diff(ours.searchElapsedMs, theirs?.searchElapsedMs ?? null), yields: diff(ours.yields, theirs?.yields ?? null),
      extent: Object.fromEntries(keys.map(k => [k, task.extent[k] - PHASE2C26B2C2B2D_COMMON_L2_EXTENT[k]])) as Phase2C26B2C2B2DPairedRow['delta']['extent'],
      extentRatio: Object.fromEntries(keys.map(k => [k, task.extent[k] / PHASE2C26B2C2B2D_COMMON_L2_EXTENT[k]])) as Phase2C26B2C2B2DPairedRow['delta']['extentRatio'] } }
}

// ---------------------------------------------------------------- decision (registered before the Stage 1 measurement; a diagnostic decision, never a scheduler decision)

export type Phase2C26B2C2B2DDecisionCase = 'B2C2B2D_ALL_C8' | 'B2C2B2D_ALL_C32' | 'B2C2B2D_ALL_C4C' | 'B2C2B2D_PARTIAL' | 'B2C2B2D_INCOMPLETE' | 'B2C2B2D_INVALID'

export const PHASE2C26B2C2B2D_DECISION_RULE = {
  scope: 'An oracle-guided diagnostic decision (first compatible context x target-relative tight extent). It is never a scheduler decision and never evidence for a Production scheduler, a Production extent selector or a Production rung selector.',
  order: [
    'B2C2B2D_INVALID: an authority mismatch (B2-C2B1 / B2-C1 / B2-B1 / B2-C2B2B / B2-C2B2C / oracle / hash chain / Export / CalculationContext / RNG), a population other than exactly the B2-C2B2C 4 Targets (E1 11 = L1 7 + L2 4, overlap 0, union 11), a probe manifest other than the re-derived one, a selected rank other than the B2-C1 / B2-C2B1 / B2-C2B2C first compatible rank, a selected context that is not reservation-compatible, a tight extent other than max(Production default, B2-C2B1 required) or outside the bounds or not covering the required extent, a task count other than 4, a P1 definition drift or schedule parity mismatch, a context identity (group / reservation / representative / default Search input digest / excluded current Route) other than B2-C2B2C\'s task of the same Target and rank, an excluded current Route identity not proved for every pair (a baseline default context that cannot be re-derived from the schedule, a Target / rank holding other than one schedule row, a re-derived group / reservation / representative / default digest other than the baseline task\'s, other than exactly one excluded key or a key that is not the current Route, a re-derived key other than the baseline record\'s or this phase\'s Search record\'s),a context mismatch in a Search child, a Candidate reservation violation, an exact or partial Candidate from an incompatible context, a nonmonotonic Candidate cost sequence, a provenance flag reported other than registered, a start attestation that is present but does not verify, or a raw / result inconsistency',
    'B2C2B2D_INCOMPLETE: no invalid reason, and a task was not measured (timeout / out of memory / process failure / notRun after an interruption: never Candidate 0, never retried in this Phase)',
    'B2C2B2D_ALL_C8: all 4 tasks measured and the first 8 captured Candidates hold the exact oracle Route for 4 / 4 Targets',
    'B2C2B2D_ALL_C32: all measured, C8 < 4, C32 4 / 4',
    'B2C2B2D_ALL_C4C: all measured, C32 < 4, C4C 4 / 4 (a safety-capped capture still counts its exact Candidates: they lie inside the first four cohorts)',
    'B2C2B2D_PARTIAL: all 4 measured, no invalid reason, C4C < 4 (a miss is classified - safety cap unresolved / capture insufficient / compatible non-delivery - and never read as "the Route does not exist")',
  ],
  policies: 'C8 / C32 = the first 8 / 32 Candidates of the one C4C capture; C4C = every captured Candidate (up to four complete operation-cost cohorts; the sentinel never counts). C8 ⊆ C32 ⊆ C4C',
  exact: 'phase2c26b2c2b2aCompareContext() -> phase2c26b2c2aCompareContext() -> phase2c26b2b2aCompare() -> phase2c2OracleCoverage() per Candidate; partial_comparable is recorded and never counted as exact',
  extent: 'per Target the tight extent max(Production default, B2-C2B1 recorded required extent) (null stream: Production default), Production default <= tight <= common L2 with at least one stream strictly below common L2; the schedule / reservation universe / P1 ordering stay at the Production default extent',
  evidence: 'separate axis: formal = the ordinary formal conditions AND a verified runner start attestation; an interrupted run is partialRun = true and is graded by the attestation, never promoted by --allow-nonformal',
  interpretation: 'separate axis, never a decision input: over the Targets B2-C2B2C left unrecovered, A (all recovered: common-L2 oversizing was a large resource factor), B (one or more still timeout / OOM: Route depth / Search resource problem), C (completed without an exact: Candidate ordering / capture / context semantics)',
} as const

export const PHASE2C26B2C2B2D_RECOMMENDATION: Record<Phase2C26B2C2B2DDecisionCase, string> = {
  B2C2B2D_ALL_C8: '既知のcompatible context × tight extentでは4 / 4がC8で回収できた（oracle-guided diagnostic）。interpretationを確認し、Aなら次はoracleなしでtight extent / finer ladderを予測する研究へ。Production採用ではない',
  B2C2B2D_ALL_C32: '既知のcompatible context × tight extentでは4 / 4がC32で回収できた（oracle-guided diagnostic）。interpretationを確認し、Aなら次はoracleなしでtight extent / finer ladderを予測する研究へ。Production採用ではない',
  B2C2B2D_ALL_C4C: '既知のcompatible context × tight extentでは4 / 4がC4Cで回収できた（oracle-guided diagnostic）。interpretationを確認し、Aなら次はoracleなしでtight extent / finer ladderを予測する研究へ。Production採用ではない',
  B2C2B2D_PARTIAL: 'tight extentで完走したがexact non-deliveryのTargetがある（interpretation C）。extentではなくCandidate ordering / capture / context semanticsを調査する（Route不存在とは結論しない）',
  B2C2B2D_INCOMPLETE: '未計測taskがある（timeout / OOM / process failure / notRun）。tight extentでもtimeout / OOMのTargetがあればinterpretation B。Route自体の深さ / Search algorithm側のresource problemとして、60分budget / 12〜16 GB heapのtargeted retry、またはSearch runtime profilingを別Phaseで検討する',
  B2C2B2D_INVALID: '次へ進まず原因修正',
}

export interface Phase2C26B2C2B2DDecisionInput {
  invalidReasons: readonly string[]
  tasks: number
  targets: number
  unmeasuredTasks: number
  exactTargets: Record<Phase2C26B2C2B2DCapturePolicy, number>
}

export function phase2c26b2c2b2dDecision(input: Phase2C26B2C2B2DDecisionInput) {
  const { tasks, targets, unmeasuredTasks, exactTargets } = input
  const values = [tasks, targets, unmeasuredTasks, exactTargets.C8, exactTargets.C32, exactTargets.C4C]
  if (!values.every(v => Number.isInteger(v) && v >= 0) || unmeasuredTasks > tasks || exactTargets.C8 > exactTargets.C32 || exactTargets.C32 > exactTargets.C4C || exactTargets.C4C > targets) {
    throw new Error(`Inconsistent Phase 2-C2.6-B2-C2B2D decision input: ${JSON.stringify(input)}`)
  }
  const reasons = [...input.invalidReasons, ...(tasks !== PHASE2C26B2C2B2D_EXPECTED_TASKS ? [`task_count_${tasks}`] : []), ...(targets !== PHASE2C26B2C2B2D_TARGETS ? [`target_count_${targets}`] : [])]
  const all = PHASE2C26B2C2B2D_TARGETS
  const caseId: Phase2C26B2C2B2DDecisionCase = reasons.length > 0 ? 'B2C2B2D_INVALID'
    : unmeasuredTasks > 0 ? 'B2C2B2D_INCOMPLETE'
      : exactTargets.C8 === all ? 'B2C2B2D_ALL_C8'
        : exactTargets.C32 === all ? 'B2C2B2D_ALL_C32'
          : exactTargets.C4C === all ? 'B2C2B2D_ALL_C4C'
            : 'B2C2B2D_PARTIAL'
  return { case: caseId, reasons, scope: PHASE2C26B2C2B2D_DECISION_RULE.scope, recommendation: PHASE2C26B2C2B2D_RECOMMENDATION[caseId] }
}

// ---------------------------------------------------------------- interpretation A / B / C (separate from the decision)

export type Phase2C26B2C2B2DInterpretationCase = 'A' | 'B' | 'C' | 'B_AND_C'
export type Phase2C26B2C2B2DTargetInterpretation = 'recovered' | 'still_unmeasured' | 'measured_without_exact' | 'not_run'

export const PHASE2C26B2C2B2D_INTERPRETATION_RULE = {
  population: 'the Targets whose B2-C2B2C row recovered no exact Route (C4C none) - the two whose compatible contexts B2-C2B2C could not finish',
  A: 'every such Target recovered here (C4C exact): the common-L2 oversizing was a large resource factor. Next: research predicting a tight extent / finer ladder without the oracle',
  B: 'some such Target is still unmeasured here (timeout / OOM / process failure) and none completed without an exact: the Route depth / Search algorithm resource problem remains. Next: a targeted 60-minute / 12-16 GB retry, or Search runtime profiling',
  C: 'every such Target completed here and some has no exact: extent is not the cause; investigate Candidate ordering / capture / context semantics',
  B_AND_C: 'both B and C hold for different Targets; both follow-ups apply',
  note: 'A partly recovered set (one recovered, one still unmeasured) is B: A needs every previously unrecovered Target. A Target whose task never ran (an interrupted run or a smoke) is not_run and leaves the interpretation undetermined (null). Never a decision input; with an invalid reason no interpretation is made.',
} as const

export function phase2c26b2c2b2dInterpretation(input: { invalid: boolean; previouslyUnrecovered: readonly string[]; previouslyRecovered: readonly string[]; rows: readonly Phase2C26B2C2B2DTargetRow[] }) {
  const classify = (row: Phase2C26B2C2B2DTargetRow | undefined): Phase2C26B2C2B2DTargetInterpretation =>
    row === undefined || row.process === 'not_run' ? 'not_run' : !row.measured ? 'still_unmeasured' : row.recovery !== 'none' ? 'recovered' : 'measured_without_exact'
  const perTarget = input.previouslyUnrecovered.map(id => ({ targetWeaponId: id, result: classify(input.rows.find(r => r.targetWeaponId === id)) }))
  const previouslyRecovered = input.previouslyRecovered.map(id => ({ targetWeaponId: id, result: classify(input.rows.find(r => r.targetWeaponId === id)) }))
  const unmeasured = perTarget.some(t => t.result === 'still_unmeasured')
  const noExact = perTarget.some(t => t.result === 'measured_without_exact')
  const caseId: Phase2C26B2C2B2DInterpretationCase | null = input.invalid || perTarget.length === 0 || perTarget.some(t => t.result === 'not_run') ? null
    : !unmeasured && !noExact ? 'A' : unmeasured && noExact ? 'B_AND_C' : unmeasured ? 'B' : 'C'
  return { case: caseId, previouslyUnrecovered: perTarget, recoveredOf: { recovered: perTarget.filter(t => t.result === 'recovered').length, of: perTarget.length },
    previouslyRecovered, previouslyRecoveredStillRecovered: previouslyRecovered.every(t => t.result === 'recovered'), rule: PHASE2C26B2C2B2D_INTERPRETATION_RULE,
    meaning: caseId === null ? null : PHASE2C26B2C2B2D_INTERPRETATION_RULE[caseId] }
}

// ---------------------------------------------------------------- the E1 aggregate under oracle-guided diagnostic conditions

export const PHASE2C26B2C2B2D_E1_DIAGNOSTIC_LIMITATIONS = [
  'The L2 half is oracle-guided: the population (E1 ∩ L2), the context (B2-C1 first compatible) and the extent (max(Production default, B2-C2B1 required)) all come from post-hoc oracle evidence. It does not show that Production could choose the first compatible context or know the required extent in advance, nor that a Target-specific extent may be adopted in Production.',
  'The registered common ladder evidence (B2-C2B2B common L1 + B2-C2B2C common L2) stays C4C 9 / 11; this aggregate does not turn it into 11 / 11.',
  'It does not show that a Production scheduler finds these Routes: no Planner trial, kernel, full Planner rerun or global assignment ran.',
  'Unmeasured tasks (timeout / OOM / notRun) are unknown, never Candidate 0.',
] as const

/**
 * The E1 aggregate, post hoc, as two separate statements: the registered common ladder (B2-C2B2B L1 + B2-C2B2C L2) keeps its own
 * count; the diagnostic aggregate takes the L1 half from B2-C2B2B and the L2 half from this phase. "E1 11 / 11 under at least
 * oracle-guided diagnostic conditions" is stated only when both halves recovered every Route (C4C), with the limitations.
 */
export function phase2c26b2c2b2dE1Aggregate(input: { e1: readonly string[]; l1: readonly string[]; l2: readonly string[]; b2c2b2b: Phase2C26B2C2B2CB2C2B2BAuthority;
  b2c2b2c: Phase2C26B2C2B2DB2C2B2CAuthority; rows: readonly Phase2C26B2C2B2DTargetRow[]; decision: string | null; evidenceGrade: string }) {
  const issues: string[] = []
  const sorted = (ids: readonly string[]) => [...ids].sort()
  if (input.l1.some(id => input.l2.includes(id))) issues.push('the L1 and L2 populations overlap')
  if (!same(sorted([...input.l1, ...input.l2]), sorted(input.e1))) issues.push('the L1 and L2 populations do not partition E1')
  if (!same(sorted(input.b2c2b2b.targetWeaponIds), sorted(input.l1))) issues.push('the B2-C2B2B Targets are not the L1 population')
  if (!same(sorted(input.b2c2b2c.targetWeaponIds), sorted(input.l2))) issues.push('the B2-C2B2C Targets are not the L2 population')
  if (!same(sorted(input.rows.map(r => r.targetWeaponId)), sorted(input.l2))) issues.push('this phase\'s Target rows are not the L2 population')
  const policies = PHASE2C26B2C2B2D_CAPTURE_POLICIES
  const l1 = input.b2c2b2b.exactTargets
  const l2Common = input.b2c2b2c.exactTargets
  const l2Tight = Object.fromEntries(policies.map(p => [p, input.rows.filter(r => r.hit[p]).length])) as Record<Phase2C26B2C2B2DCapturePolicy, number>
  const total = (l2: Record<Phase2C26B2C2B2DCapturePolicy, number>) => Object.fromEntries(policies.map(p => [p, { recovered: l1[p] + l2[p], of: input.e1.length }])) as
    Record<Phase2C26B2C2B2DCapturePolicy, { recovered: number; of: number }>
  const diagnosticTotal = total(l2Tight)
  const allRecovered = issues.length === 0 && input.e1.length > 0 && diagnosticTotal.C4C.recovered === input.e1.length && l1.C4C === input.l1.length && l2Tight.C4C === input.l2.length
  return {
    issues,
    e1Total: input.e1.length,
    commonLadder: { source: 'B2-C2B2B RESULT (common L1) + B2-C2B2C RESULT (common L2), both registered formal; not re-run here', l1: { population: input.l1.length, exactTargets: { ...l1 } },
      l2: { population: input.l2.length, exactTargets: { ...l2Common }, resultSha256: input.b2c2b2c.resultSha256, decision: input.b2c2b2c.decisionCase }, total: total(l2Common), statement: null,
      note: 'unchanged by this phase: the registered common ladder evidence stays as B2-C2B2C reported it' },
    diagnostic: { source: 'B2-C2B2B RESULT (L1 7 at common L1) + this phase (L2 4 at first compatible context x tight extent)', l1: { population: input.l1.length, exactTargets: { ...l1 }, conditions: 'common L1 extent, P1 ranks 1..32 (no oracle-guided context selection)' },
      l2: { population: input.l2.length, exactTargets: l2Tight, decision: input.decision, evidenceGrade: input.evidenceGrade, conditions: 'oracle-guided: B2-C1 first compatible context x max(Production default, B2-C2B1 required) extent' },
      total: diagnosticTotal, allRecovered,
      statement: allRecovered ? `E1 ${input.e1.length} / ${input.e1.length}: the existing Search delivered every exact oracle Route at least under oracle-guided diagnostic conditions (L1 ${input.l1.length} / ${input.l1.length} by B2-C2B2B at common L1; L2 ${input.l2.length} / ${input.l2.length} by B2-C2B2D at the first compatible context x tight extent)` : null,
      statementScope: 'oracle-guided diagnostic only: not "11 / 11 under the registered common L1 / L2 ladder", not a Production scheduler result, not a Production extent selector' },
    limitations: [...PHASE2C26B2C2B2D_E1_DIAGNOSTIC_LIMITATIONS],
  }
}

// ---------------------------------------------------------------- execution / resources

const stats = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  return { count: sorted.length, min: sorted[0] ?? null, max: sorted.at(-1) ?? null, total: sorted.reduce((a, b) => a + b, 0) }
}

export function phase2c26b2c2b2dExecution(tasks: readonly Phase2C26B2C2B2DTaskInput[], runs: readonly Phase2C26B2C2B2DRun[]) {
  const runOf = new Map(runs.map(r => [r.taskId, r]))
  const measured = runs.filter(r => searchOf(r) !== null)
  return {
    tasks: tasks.length, started: runs.length, completed: measured.length,
    contextMismatch: runs.filter(r => r.outcome.record === 'context_mismatch').length,
    timeout: runs.filter(r => r.outcome.process === 'timeout').length,
    outOfMemory: runs.filter(r => r.outcome.process === 'out_of_memory').length,
    processFailure: runs.filter(r => r.outcome.process === 'process_failure').length,
    notRun: tasks.filter(t => !runOf.has(t.taskId)).length,
    safetyCap: measured.filter(r => searchOf(r)!.safetyCapHit).length,
    processWallMs: stats(runs.map(r => r.process.wallMs)),
    searchElapsedMs: stats(measured.map(r => searchOf(r)!.elapsedMs)),
    peakHeapBytesMax: runs.length === 0 ? null : Math.max(...runs.map(r => peakOf(r).heap)),
    peakRssBytesMax: runs.length === 0 ? null : Math.max(...runs.map(r => peakOf(r).rss)),
  }
}

// ---------------------------------------------------------------- the whole analysis

type Oracle = { routes: readonly unknown[]; gogmaUsage: readonly unknown[] }

export interface Phase2C26B2C2B2DAnalysisInput {
  /** The probe derivations re-derived from the authorities (Target, ranks, required and tight extents). */
  derivations: readonly Phase2C26B2C2B2DProbeDerivation[]
  tasks: readonly Phase2C26B2C2B2DTaskInput[]
  runs: readonly Phase2C26B2C2B2DRun[]
  reach: readonly Phase2C26B2C2AReach[]
  /** Per task ID the SHA-256 of the record's excluded current Route key (computed by the analyzer), or null when unmeasured. */
  excludedRouteKeySha256: ReadonlyMap<string, string | null>
  /** Per B2-C2B2D task ID the re-derived baseline default context of its B2-C2B2C counterpart (`phase2c26b2c2b2dRederiveBaselineContext()`). */
  baselineRederivations: ReadonlyMap<string, Phase2C26B2C2B2DBaselineRederivation>
  b2c2b2c: Phase2C26B2C2B2DB2C2B2CAuthority
  oracle: Oracle
  smoke: boolean
  interruption?: Phase2C26B2C2B2DInterruption | null
}

/** Raw consistency, the per-context comparison, the per-Target rows, the paired comparison, the execution summary and every invalid reason found here. */
export function runPhase2C26B2C2B2DAnalysis({ derivations, tasks, runs, reach, excludedRouteKeySha256, baselineRederivations, b2c2b2c, oracle, smoke, interruption = null }: Phase2C26B2C2B2DAnalysisInput) {
  const expectedExtents = new Map(derivations.map(d => [d.targetWeaponId, d.tightExtent]))
  const invalidReasons: string[] = validatePhase2C26B2C2B2DRaw({ tasks, runs, smoke, expectedExtents, interruption }).map(issue => issue.startsWith('semantic_failure') ? issue : `raw: ${issue}`)
  const runOf = new Map(runs.map(r => [r.taskId, r]))
  const reachOf = new Map(reach.map(r => [r.targetWeaponId, r]))
  if (!same(tasks.map(t => t.targetWeaponId), derivations.map(d => d.targetWeaponId))) invalidReasons.push('raw: the tasks are not one per probe in probe order')
  for (const r of reach) invalidReasons.push(...r.inconsistencies.map(i => `reach: ${i}`))
  for (const run of runs) if (run.outcome.record === 'context_mismatch') invalidReasons.push(`semantic: ${run.taskId}: context mismatch in the Search child`)
  const contexts = tasks.map(task => phase2c26b2c2b2aCompareContext(runOf.get(task.taskId), task, reachOf.get(task.targetWeaponId)?.compatibleGroupIndexes.includes(task.groupIndex) ?? false, oracle))
  for (const c of contexts) invalidReasons.push(...c.inconsistencies.map(i => i.startsWith('semantic_failure') ? i : `comparison: ${i}`))
  const rows: Phase2C26B2C2B2DTargetRow[] = []
  const paired: Phase2C26B2C2B2DPairedRow[] = []
  tasks.forEach((task, index) => {
    const derivation = derivations.find(d => d.targetWeaponId === task.targetWeaponId)
    const recomputed = reachOf.get(task.targetWeaponId)?.p1FirstCompatibleRank ?? null
    if (!derivation) { invalidReasons.push(`authority: ${task.taskId}: no probe derivation`); return }
    if (task.contextRank !== derivation.b2c1FirstCompatibleRank) invalidReasons.push(`authority: ${task.taskId}: the task rank is not the B2-C1 first compatible rank`)
    if (recomputed !== derivation.b2c1FirstCompatibleRank) invalidReasons.push(`authority: ${task.targetWeaponId}: recomputed P1 first compatible rank ${String(recomputed)} is not B2-C1's ${String(derivation.b2c1FirstCompatibleRank)}`)
    const row = phase2c26b2c2b2dTargetRow(task, contexts[index]!, runOf.get(task.taskId), derivation.b2c1FirstCompatibleRank, recomputed, phase2c26b2b2a2OracleOperationCost(oracle, task.targetWeaponId))
    if (!row.compatible) invalidReasons.push(`authority: ${task.taskId}: the selected first compatible context is not reservation-compatible under the recomputation`)
    rows.push(row)
    const pair = phase2c26b2c2b2dPairedRow(task, runOf.get(task.taskId), contexts[index]!, excludedRouteKeySha256.get(task.taskId) ?? null, b2c2b2c.taskRows,
      baselineRederivations.get(task.taskId) ?? null)
    invalidReasons.push(...pair.identity.issues.map(i => `paired: ${i}`))
    paired.push(pair)
  })
  const execution = phase2c26b2c2b2dExecution(tasks, runs)
  const exactTargets = Object.fromEntries(PHASE2C26B2C2B2D_CAPTURE_POLICIES.map(p => [p, rows.filter(r => r.hit[p]).length])) as Record<Phase2C26B2C2B2DCapturePolicy, number>
  const unmeasuredTasks = tasks.length - execution.completed
  return {
    contexts, rows, paired, invalidReasons,
    aggregates: { exactTargets, cascade: { c8: rows.filter(r => r.recovery === 'C8').length, c8MissC32: rows.filter(r => r.recovery === 'C32').length,
      c32MissC4C: rows.filter(r => r.recovery === 'C4C').length, c4cMiss: rows.filter(r => r.recovery === 'none').length },
    missClasses: Object.fromEntries([...new Set(rows.flatMap(r => r.missClass === null ? [] : [r.missClass]))].sort().map(m => [m, rows.filter(r => r.missClass === m).length])),
    execution, candidates: phase2c26b2c2b2aCandidates(tasks, runs),
    measurementCompleteness: { status: unmeasuredTasks === 0 ? 'complete' as const : 'incomplete' as const, tasks: tasks.length, measured: execution.completed, unmeasured: unmeasuredTasks,
      breakdown: { contextMismatch: execution.contextMismatch, timeout: execution.timeout, outOfMemory: execution.outOfMemory, processFailure: execution.processFailure, notRun: execution.notRun } } },
    decisionInput: { tasks: tasks.length, targets: derivations.length, unmeasuredTasks: Math.max(0, unmeasuredTasks), exactTargets },
  }
}
