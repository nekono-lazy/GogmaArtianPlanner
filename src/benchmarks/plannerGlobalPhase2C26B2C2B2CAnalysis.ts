/**
 * Issue #154 Phase 2-C2.6-B2-C2B2C post-hoc analysis only. It reads the finished (or interrupted and reconstructed) B2-C2B2C
 * raw run with every child record and the runner start attestation and, as explicit analyzer arguments AFTER the run ended,
 * the B2-C2B1 RESULT (population and L2 authority), the B2-C1 RESULT (P1 first-compatible authority), the B2-B1 RESULT (schedule
 * parity / hash chain), the B2-C2B2B RESULT (the E1 ∩ L1 half of the E1 ladder aggregate), the 1,657 oracle RESULT and its
 * manifest. It runs no Search, no kernel and no Planner and feeds nothing back into any calculation.
 *
 * The per-context comparison, the per-Target first exact rule and the aggregates are B2-C2B2A's, unchanged
 * (`phase2c26b2c2b2aCompareContext()` -> `phase2c26b2c2aCompareContext()` -> `phase2c26b2b2aCompare()` ->
 * `phase2c2OracleCoverage()`, compatibility through `phase2c26b2c2aReach()`). B2-C2B2C adds the L2 extent checks for the 4 x 32
 * population, the registered decision for 4 Targets / 128 tasks, a route recovery summary kept apart from that decision
 * (measurement completeness and C8 / C32 / C4C recovery as separate axes), and the E1 ladder aggregate (B2-C2B2B L1 7 + this
 * phase's L2 4). The launch provenance authority is the runner start attestation, as in B2-C2B2B.
 */
import { stableStringify } from '../domain/models/hashing'
import { phase2c26b2b2a2FirstDecidingKey, phase2c26b2b2a2OracleOperationCost } from './plannerGlobalPhase2C26B2B2A2Analysis'
import type { Phase2C26B2B2A2DeliveredCandidate } from './plannerGlobalPhase2C26B2B2A2'
import type { Phase2C26B2C2AReach } from './plannerGlobalPhase2C26B2C2AAnalysis'
import {
  phase2c26b2c2b2aBudgetCoverage,
  phase2c26b2c2b2aCandidates,
  phase2c26b2c2b2aCascade,
  phase2c26b2c2b2aCompareContext,
  phase2c26b2c2b2aCompatibility,
  phase2c26b2c2b2aExecution,
  phase2c26b2c2b2aPolicyLength,
  phase2c26b2c2b2aTargetRow,
  PHASE2C26B2C2B2A_BUDGETS,
  PHASE2C26B2C2B2A_CAPTURE_POLICIES,
  type Phase2C26B2C2B2ACapturePolicy,
  type Phase2C26B2C2B2AContextComparison,
  type Phase2C26B2C2B2ARun,
  type Phase2C26B2C2B2ATargetRow,
} from './plannerGlobalPhase2C26B2C2B2AAnalysis'
import { phase2c26b2c2b2bTargetResources } from './plannerGlobalPhase2C26B2C2B2BAnalysis'
import {
  PHASE2C26B2C2B2C_CANDIDATE_SAFETY_CAP,
  PHASE2C26B2C2B2C_EXPECTED_TASKS,
  PHASE2C26B2C2B2C_EXTENT,
  PHASE2C26B2C2B2C_MAX_COST_COHORTS,
  PHASE2C26B2C2B2C_TARGETS,
  verifyPhase2C26B2C2B2CStartAttestation,
  type Phase2C26B2C2B2CAttestationExpectation,
  type Phase2C26B2C2B2CSearchRecord,
  type Phase2C26B2C2B2CTaskInput,
} from './plannerGlobalPhase2C26B2C2B2C'
import type { Phase2C26B2C2B2CB2C2B2BAuthority } from './plannerGlobalPhase2C26B2C2B2CTargets'

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}
type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)

// ---------------------------------------------------------------- registered before the Stage 1 measurement

export type Phase2C26B2C2B2CCapturePolicy = Phase2C26B2C2B2ACapturePolicy
export const PHASE2C26B2C2B2C_CAPTURE_POLICIES = PHASE2C26B2C2B2A_CAPTURE_POLICIES
/** The context budgets the RESULT reports (diagnostic, never Production defaults). */
export const PHASE2C26B2C2B2C_BUDGETS = PHASE2C26B2C2B2A_BUDGETS
export const phase2c26b2c2b2cPolicyLength = phase2c26b2c2b2aPolicyLength

/** One run as the raw record holds it (B2-C2B2A's shape). */
export type Phase2C26B2C2B2CRun = Phase2C26B2C2B2ARun
export type Phase2C26B2C2B2CContextComparison = Phase2C26B2C2B2AContextComparison
export type Phase2C26B2C2B2CTargetRow = Phase2C26B2C2B2ATargetRow

const deliveries = (s: Phase2C26B2C2B2CSearchRecord): Phase2C26B2B2A2DeliveredCandidate[] => [...s.candidates, ...(s.nextCostSentinel ? [s.nextCostSentinel] : [])]

// ---------------------------------------------------------------- interrupted runs

/**
 * A run whose parent runner did not end by itself (a stop for an operational reason, a crash, a host restart). The ran tasks
 * are analyzed exactly as recorded; the rest are `notRun`: never Candidate 0, never a Search failure, and they keep the
 * decision at B2C2B2C_INCOMPLETE through the unmeasured-task rule. Whether the run is formal evidence is a separate axis,
 * decided by the runner start attestation alone (`phase2c26b2c2b2cLaunchProvenance()`), never by being interrupted.
 */
export interface Phase2C26B2C2B2CInterruption {
  stoppedAt: string
  reason: string
  notRunTaskIds: string[]
}

// ---------------------------------------------------------------- launch provenance (evidence grade, separate from the Search decision)

export type Phase2C26B2C2B2CLaunchProvenanceSource = 'runner_start_attestation' | 'none'
export type Phase2C26B2C2B2CEvidenceGrade = 'formal' | 'diagnostic_partial' | 'non_formal'

export interface Phase2C26B2C2B2CLaunchProvenance {
  verified: boolean
  source: Phase2C26B2C2B2CLaunchProvenanceSource
  /** The launch working tree is attested clean by the runner (never inferred after the fact). */
  workingTreeCleanVerified: boolean
  issues: string[]
  /** The issues that break the attestation's integrity (see `verifyPhase2C26B2C2B2CStartAttestation()`); a present attestation with one is an invalid run. */
  integrityIssues: string[]
  reason: string | null
}

/**
 * The launch provenance of a raw run, completed or interrupted alike: verified only by the runner start attestation file of
 * the run dir, whose SHA-256 must be the one the raw recorded and whose body must verify against the independently obtained
 * HEAD / code / Export / manifest values (`verifyPhase2C26B2C2B2CStartAttestation()`). No attestation never verifies,
 * whatever HEAD a reconstruction was given; the raw environment is a cross-check, never the authority.
 */
export function phase2c26b2c2b2cLaunchProvenance(input: {
  /** The attestation file as found in the run dir (null when absent). */
  attestationFile: { sha256: string; body: unknown } | null
  /** The attestation SHA-256 the raw (runner or reconstruction) recorded (null when it recorded none). */
  recordedAttestationSha256: string | null
  /** The raw environment (the runner's own launch values, or the reconstruction's copy of the attestation). */
  environment: Record<string, unknown>
  expected: Phase2C26B2C2B2CAttestationExpectation
}): Phase2C26B2C2B2CLaunchProvenance {
  if (input.attestationFile === null) {
    return { verified: false, source: 'none', workingTreeCleanVerified: false, issues: ['no start attestation in the run dir'], integrityIssues: [],
      reason: 'The runner start attestation is missing: the launch HEAD, working-tree cleanliness and benchmark code hash are not attested by the runner.' }
  }
  const integrityIssues: string[] = []
  if (input.recordedAttestationSha256 !== input.attestationFile.sha256) integrityIssues.push('the attestation file is not the one the raw recorded')
  const verification = verifyPhase2C26B2C2B2CStartAttestation(input.attestationFile.body, input.expected)
  integrityIssues.push(...verification.integrityIssues)
  const body = isObject(input.attestationFile.body) ? input.attestationFile.body : {}
  for (const field of ['repositoryHead', 'uncommittedBenchmarkCode', 'benchmarkCodeSha256', 'exportSha256', 'targetManifestSha256', 'stage1'] as const) {
    if (!same(body[field], input.environment[field])) integrityIssues.push(`${field} differs from the raw environment`)
  }
  const issues = [...integrityIssues, ...verification.issues.filter(i => !verification.integrityIssues.includes(i))]
  const verified = issues.length === 0
  return { verified, source: 'runner_start_attestation', workingTreeCleanVerified: verified, issues, integrityIssues,
    reason: verified ? null : `The start attestation does not verify: ${issues.join('; ')}.` }
}

/** The evidence grade: formal only with every formal condition AND verified launch provenance; partial or not is recorded separately. */
export function phase2c26b2c2b2cEvidenceGrade(input: { formalConditions: boolean; launchProvenanceVerified: boolean; partialRun: boolean }): Phase2C26B2C2B2CEvidenceGrade {
  if (input.formalConditions && input.launchProvenanceVerified) return 'formal'
  return input.partialRun ? 'diagnostic_partial' : 'non_formal'
}

// ---------------------------------------------------------------- raw consistency (fails the run closed)

/**
 * Internal drift of the raw run (the B2-C2B2B rules with the L2 extent): every task carries the common L2 extent; every
 * searched record names its task's Target, rank, group, digests (default and L2), representative and capture rule at L2,
 * excludes exactly one Route key and never delivers it; deliveries are indexed 0..n-1 with unique keys; the comparator
 * verdict is "earlier first" and agrees with the six keys; the captured costs are the first <= 4 distinct costs and the
 * sentinel a fifth; the termination agrees with the flags. A cheaper Candidate after a dearer one is a semantic failure.
 */
export function validatePhase2C26B2C2B2CRaw(input: { tasks: readonly Phase2C26B2C2B2CTaskInput[]; runs: readonly Phase2C26B2C2B2CRun[]; smoke: boolean; interruption?: Phase2C26B2C2B2CInterruption | null }): string[] {
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
  for (const task of tasks) if (!same(task.extent, { ...PHASE2C26B2C2B2C_EXTENT })) issues.push(`${task.taskId}: the task extent is not the common L2 extent`)
  const taskById = new Map(tasks.map(t => [t.taskId, t]))
  for (const run of runs) {
    const task = taskById.get(run.taskId)
    if (!task) { issues.push(`${run.taskId}: not a planned task`); continue }
    if (!same(run.task, task)) issues.push(`${run.taskId}: the child received another task`)
    if (run.outcome.process === 'completed' && run.record === null) issues.push(`${run.taskId}: a completed child without a record`)
    if (run.record !== null && run.record.taskId !== run.taskId) issues.push(`${run.taskId}: the record names another task`)
    const s = run.record?.status === 'searched' ? run.record.search : null
    if (s === null) continue
    const at = run.taskId
    if (s.targetWeaponId !== task.targetWeaponId || s.contextRank !== task.contextRank || s.groupIndex !== task.groupIndex || s.reservationDigest !== task.reservationDigest
      || s.targetEligibleMinCardinality !== task.targetEligibleMinCardinality || s.representativeFixedSetId !== task.representativeFixedSetId
      || !same(s.representativeFixedTargetWeaponIds, task.representativeFixedTargetWeaponIds) || s.searchInputDigest !== task.searchInputDigest
      || s.defaultSearchInputDigest !== task.defaultSearchInputDigest) issues.push(`${at}: the record is not the task's context`)
    if (s.maxCostCohorts !== PHASE2C26B2C2B2C_MAX_COST_COHORTS || s.candidateSafetyCap !== PHASE2C26B2C2B2C_CANDIDATE_SAFETY_CAP) issues.push(`${at}: capture rule drift`)
    if (!same(s.extent, { ...PHASE2C26B2C2B2C_EXTENT })) issues.push(`${at}: the extent is not the common L2 extent`)
    if (s.searchInputDigest === s.defaultSearchInputDigest) issues.push(`${at}: the L2 digest equals the default digest`)
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
    if (!same(distinct, s.capturedCosts) || s.distinctCostCohorts !== s.capturedCosts.length || s.capturedCosts.length > PHASE2C26B2C2B2C_MAX_COST_COHORTS) issues.push(`${at}: captured cost cohorts drift`)
    const sentinelCost = s.nextCostSentinel?.orderingKeys.estimatedOperationCount
    if (s.nextCostSentinel && (s.capturedCosts.length !== PHASE2C26B2C2B2C_MAX_COST_COHORTS || s.capturedCosts.includes(sentinelCost!))) issues.push(`${at}: the sentinel is not the first Candidate of a fifth cost`)
    const f = s.summary
    const below = s.candidates.length < PHASE2C26B2C2B2C_CANDIDATE_SAFETY_CAP
    const ok = s.termination === 'four_cost_cohorts_drained' ? s.status === 'consumer_stop' && f.stoppedByConsumer && s.nextCostSentinel !== null && !s.safetyCapHit && s.captureComplete && below
      : s.termination === 'candidate_safety_cap' ? s.status === 'consumer_stop' && f.stoppedByConsumer && s.nextCostSentinel === null && s.safetyCapHit && !s.captureComplete
        && s.candidates.length === PHASE2C26B2C2B2C_CANDIDATE_SAFETY_CAP
        : s.termination === 'stopped_by_extent' ? s.status === 'stopped_by_extent' && !f.stoppedByConsumer && f.stoppedByExtent && s.nextCostSentinel === null && !s.safetyCapHit && s.captureComplete && below
          : s.termination === 'exhausted' && s.status === 'exhausted' && !f.stoppedByConsumer && !f.stoppedByExtent && f.exhausted && s.nextCostSentinel === null && !s.safetyCapHit && s.captureComplete && below
    if (!ok) issues.push(`${at}: the termination disagrees with the flags / counts`)
    if (run.outcome.searchStatus !== s.status || run.outcome.termination !== s.termination || run.outcome.candidateCount !== s.candidates.length) issues.push(`${at}: the outcome disagrees with the record`)
  }
  return issues
}

// ---------------------------------------------------------------- decision (registered before the Stage 1 measurement)

export type Phase2C26B2C2B2CDecisionCase = 'B2C2B2C_ALL_C8' | 'B2C2B2C_ALL_C32' | 'B2C2B2C_ALL_C4C' | 'B2C2B2C_PARTIAL' | 'B2C2B2C_INCOMPLETE' | 'B2C2B2C_INVALID'

/** B2-C2B2B's decision contract, unchanged except for the population (4 Targets x 32 = 128 tasks) and the common L2 extent. */
export const PHASE2C26B2C2B2C_DECISION_RULE = {
  order: [
    'B2C2B2C_INVALID: a B2-C2B1 / B2-C1 / B2-B1 / B2-C2B2B authority mismatch, an E1 ∩ L2 population or Target manifest mismatch (a first ladder rung disagreeing with the recorded required extent, an E1 split other than L1 7 + L2 4 with overlap 0, or E1 ∩ L1 other than the B2-C2B2B Targets included), a Target count other than 4, a task count other than 128, a P1 definition drift, a P1 schedule parity mismatch, a context rank duplicated / missing, a reservation digest / origin drift, a task or record extent other than the common L2 extent (a Target-specific extent included), a default / L2 Search input digest drift, an oracle / hash-chain / Export / CalculationContext / RNG mismatch, a recomputed P1 first compatible rank other than B2-C1\'s, a context mismatch in a Search child, a task outside the manifest or run twice, a Candidate reservation violation (sentinel included), an exact or partial Candidate (or an exact / partial sentinel) from a reservation-incompatible context, a first exact rank before the first compatible rank, a nonmonotonic Candidate cost sequence, a start attestation that is present but does not verify, or a raw / result inconsistency',
    'B2C2B2C_INCOMPLETE: no invalid reason, and a task was not measured (timeout / out of memory / process failure / notRun after an interruption: never Candidate 0, never retried in this Phase)',
    'B2C2B2C_ALL_C8: all 128 tasks measured and C8 reaches an exact Candidate for 4 / 4 Targets within P1 rank <= 32',
    'B2C2B2C_ALL_C32: all measured, C8 < 4, C32 4 / 4',
    'B2C2B2C_ALL_C4C: all measured, C32 < 4, C4C 4 / 4 (a safety-capped capture still counts its exact Candidates: they lie inside the first four cohorts)',
    'B2C2B2C_INCOMPLETE: all measured, C4C < 4, and a Target without a C4C exact has a safety-capped compatible context in its 32 (its C4C failure is undetermined)',
    'B2C2B2C_PARTIAL: all measured, no invalid reason, C4C < 4 and every missing Target fully determined (0 / 4 is registered here too and flagged); an exact miss is never read as "the Route does not exist"',
  ],
  policies: 'C8 / C32 = the first 8 / 32 Candidates of the one C4C capture; C4C = every captured Candidate (up to four complete operation-cost cohorts; the sentinel never counts). C8 ⊆ C32 ⊆ C4C',
  exact: 'phase2c26b2c2b2aCompareContext() -> phase2c26b2c2aCompareContext() -> phase2c26b2b2aCompare() -> phase2c2OracleCoverage() per Candidate; partial_comparable is recorded and never counted as exact',
  firstExact: 'per Target and policy the smallest P1 rank whose context holds an exact Candidate in that policy; every rank 1..32 was searched regardless. first exact rank > first compatible rank is a legal measurement; first exact rank == first compatible rank is an observation, never a selection condition',
  compatible: 'phase2c26b2c2aReach() (phase2c26b2c1TargetReach() -> phase2c26b2aReachability()) over the re-derived schedule; must reproduce the B2-C1 P1 first compatible ranks',
  extent: 'every task and every Search at the common L2 extent { maxNormalAdvance: 128, maxGogmaAdvance: 235, maxSkillAdvance: 1500 }; the schedule / reservation universe / P1 ordering stay at the Production default extent',
  evidence: 'separate axis: formal = the ordinary formal conditions AND a verified runner start attestation; an interrupted run is partialRun = true and is graded by the attestation, never automatically non-formal and never promoted by --allow-nonformal',
  routeRecovery: 'separate axis, never a decision input: measurement completeness (complete only with every task measured) and the C8 / C32 / C4C route recovery counts of 4, reported whatever the decision is (an INCOMPLETE decision may still recover 4 / 4)',
} as const

export const PHASE2C26B2C2B2C_RECOMMENDATION: Record<Phase2C26B2C2B2CDecisionCase, string> = {
  B2C2B2C_ALL_C8: 'E1 ∩ L2はcommon L2 extentでP1 scheduler-selected context + 既存SearchによるRoute deliveryがこのExportでは成立。E1 ladder集計を確認し、次はE2（K2-minimal）のTarget-relative K2 feature / grouping研究、またはrungをoracleなしに決める手段の研究を別Phaseで検討。Production採用ではない',
  B2C2B2C_ALL_C32: 'E1 ∩ L2はcommon L2 extentで成立（C8では不足、C32で閉じる）。E1 ladder集計を確認し、次はE2研究を別Phaseで検討。Production採用ではない',
  B2C2B2C_ALL_C4C: 'E1 ∩ L2はcommon L2 extentで成立（equal-cost cohort単位のcaptureが必要）。E1 ladder集計を確認し、次はE2研究を別Phaseで検討。Production採用ではない',
  B2C2B2C_PARTIAL: '未回収TargetをcompatibleなのにSearch non-delivery / capture不足 / context rank 32外に分離して原因を研究する（Route不存在とは結論しない）',
  B2C2B2C_INCOMPLETE: 'timeout / OOM / safety cap / notRunを先に扱う（route recovery summaryを確認した上で、timeout taskの長時間再測定、resource explosion調査、Search runtime最適化のいずれかをレビュー後に決める）',
  B2C2B2C_INVALID: '次へ進まず原因修正',
}

export interface Phase2C26B2C2B2CDecisionInput {
  invalidReasons: readonly string[]
  tasks: number
  targets: number
  unmeasuredTasks: number
  exactTargets: Record<Phase2C26B2C2B2CCapturePolicy, number>
  /** Targets without a C4C exact that hold a safety-capped compatible context. */
  unresolvedSafetyCapTargets: number
}

export function phase2c26b2c2b2cDecision(input: Phase2C26B2C2B2CDecisionInput) {
  const { tasks, targets, unmeasuredTasks, exactTargets, unresolvedSafetyCapTargets } = input
  const values = [tasks, targets, unmeasuredTasks, unresolvedSafetyCapTargets, exactTargets.C8, exactTargets.C32, exactTargets.C4C]
  if (!values.every(v => Number.isInteger(v) && v >= 0) || unmeasuredTasks > tasks || exactTargets.C8 > exactTargets.C32 || exactTargets.C32 > exactTargets.C4C || exactTargets.C4C > targets
    || unresolvedSafetyCapTargets > targets - exactTargets.C4C) throw new Error(`Inconsistent Phase 2-C2.6-B2-C2B2C decision input: ${JSON.stringify(input)}`)
  const reasons = [...input.invalidReasons, ...(tasks !== PHASE2C26B2C2B2C_EXPECTED_TASKS ? [`task_count_${tasks}`] : []), ...(targets !== PHASE2C26B2C2B2C_TARGETS ? [`target_count_${targets}`] : [])]
  const all = PHASE2C26B2C2B2C_TARGETS
  const caseId: Phase2C26B2C2B2CDecisionCase = reasons.length > 0 ? 'B2C2B2C_INVALID'
    : unmeasuredTasks > 0 ? 'B2C2B2C_INCOMPLETE'
      : exactTargets.C8 === all ? 'B2C2B2C_ALL_C8'
        : exactTargets.C32 === all ? 'B2C2B2C_ALL_C32'
          : exactTargets.C4C === all ? 'B2C2B2C_ALL_C4C'
            : unresolvedSafetyCapTargets > 0 ? 'B2C2B2C_INCOMPLETE'
              : 'B2C2B2C_PARTIAL'
  return { case: caseId, reasons, noExactTarget: caseId === 'B2C2B2C_PARTIAL' && exactTargets.C4C === 0, recommendation: PHASE2C26B2C2B2C_RECOMMENDATION[caseId] }
}

// ---------------------------------------------------------------- route recovery summary (separate from the decision)

export interface Phase2C26B2C2B2CRouteRecoveryInput {
  tasks: number
  targets: number
  completed: number
  contextMismatch: number
  timeout: number
  outOfMemory: number
  processFailure: number
  notRun: number
  exactTargets: Record<Phase2C26B2C2B2CCapturePolicy, number>
}

/**
 * Measurement completeness and route recovery as two separate axes, both reported whatever the decision is: completeness is
 * `complete` only when every planned task was measured (completed with a record; a context mismatch is not measured); route
 * recovery counts the Targets whose exact oracle Route some measured context delivered within C8 / C32 / C4C. An unmeasured
 * task is never read as Candidate 0, so recovery can be read only as "at least": an INCOMPLETE run may still show 4 / 4.
 * Never a decision input.
 */
export function phase2c26b2c2b2cRouteRecoverySummary(input: Phase2C26B2C2B2CRouteRecoveryInput) {
  const { tasks, targets, completed, contextMismatch, timeout, outOfMemory, processFailure, notRun, exactTargets } = input
  const values = [tasks, targets, completed, contextMismatch, timeout, outOfMemory, processFailure, notRun, exactTargets.C8, exactTargets.C32, exactTargets.C4C]
  if (!values.every(v => Number.isInteger(v) && v >= 0) || completed + contextMismatch + timeout + outOfMemory + processFailure + notRun !== tasks
    || exactTargets.C8 > exactTargets.C32 || exactTargets.C32 > exactTargets.C4C || exactTargets.C4C > targets) throw new Error(`Inconsistent Phase 2-C2.6-B2-C2B2C route recovery input: ${JSON.stringify(input)}`)
  const unmeasured = tasks - completed
  return {
    measurementCompleteness: {
      status: unmeasured === 0 ? 'complete' as const : 'incomplete' as const,
      tasks, measured: completed, unmeasured, breakdown: { contextMismatch, timeout, outOfMemory, processFailure, notRun },
    },
    routeRecovery: Object.fromEntries(PHASE2C26B2C2B2C_CAPTURE_POLICIES.map(p => [p, { recovered: exactTargets[p], of: targets, all: exactTargets[p] === targets }])) as
      Record<Phase2C26B2C2B2CCapturePolicy, { recovered: number; of: number; all: boolean }>,
    recoveryIsLowerBound: unmeasured > 0,
    note: 'Separate axes, never a decision input. Recovery counts Targets whose exact oracle Route a measured context delivered; an unmeasured task (timeout / OOM / failure / notRun) is never Candidate 0, so with unmeasured tasks the counts are lower bounds and the decision stays INCOMPLETE.',
  }
}

// ---------------------------------------------------------------- the E1 ladder aggregate (B2-C2B2B L1 7 + this phase's L2 4)

export interface Phase2C26B2C2B2CE1LadderInput {
  /** The E1 population (11) and its split, from the B2-C2B1 RESULT (post hoc). */
  e1: readonly string[]
  l1: readonly string[]
  l2: readonly string[]
  /** The registered, parsed B2-C2B2B RESULT (the L1 rung: its own formal measurement, never re-run here). */
  b2c2b2b: Phase2C26B2C2B2CB2C2B2BAuthority
  /** This phase's Target rows (the L2 rung). */
  l2Rows: readonly Phase2C26B2C2B2CTargetRow[]
  l2Measurement: ReturnType<typeof phase2c26b2c2b2cRouteRecoverySummary>
  l2Decision: string | null
  l2EvidenceGrade: string
}

/** The Research limitations the E1 ladder statement always carries. */
export const PHASE2C26B2C2B2C_E1_LADDER_LIMITATIONS = [
  'The rung assignment (which E1 Route is L1-covered and which needs L2) is B2-C2B1\'s post-hoc characterization from oracle required extents: this aggregate does not show that Production could decide a Target\'s rung without the oracle.',
  'The ladder (L1 / L2), P1, the context budget 32 and the C4C capture are Research conditions chosen with post-hoc oracle evidence; this aggregate does not show that a ladder may be adopted in Production or that it generalizes to another Export.',
  'Recovery means the exact oracle Route was delivered by the existing Search in some measured context of P1 rank <= 32; no Planner trial, kernel, full Planner rerun or global assignment ran.',
  'Unmeasured tasks (timeout / OOM / notRun) of either rung are unknown, never Candidate 0; both rungs keep their own decisions (B2-C2B2B: B2C2B2B_INCOMPLETE).',
] as const

/**
 * The E1 ladder aggregate, post hoc: E1 = (E1 ∩ L1, measured at L1 by B2-C2B2B) ⊔ (E1 ∩ L2, measured at L2 here). Each rung
 * keeps its own decision, evidence grade and measurement completeness; the total counts Targets whose exact Route its own
 * rung recovered. The Research-level statement "E1 11 / 11 routes rediscovered under the registered Research ladder" is made
 * only when both rungs recovered every Target (C4C), and it always carries the limitations.
 */
export function phase2c26b2c2b2cE1LadderAggregate(input: Phase2C26B2C2B2CE1LadderInput) {
  const issues: string[] = []
  const e1 = [...input.e1].sort(compare), l1 = [...input.l1].sort(compare), l2 = [...input.l2].sort(compare)
  if (l1.some(id => l2.includes(id))) issues.push('the L1 and L2 populations overlap')
  if (!same([...l1, ...l2].sort(compare), e1)) issues.push('the L1 and L2 populations do not partition E1')
  if (!same(input.b2c2b2b.targetWeaponIds, l1)) issues.push('the B2-C2B2B Targets are not the L1 population')
  if (!same([...input.l2Rows.map(r => r.targetWeaponId)].sort(compare), l2)) issues.push('this phase\'s Target rows are not the L2 population')
  const l2Exact = Object.fromEntries(PHASE2C26B2C2B2C_CAPTURE_POLICIES.map(p => [p, input.l2Rows.filter(r => r.policies[p].firstExactContextRank !== null).length])) as Record<Phase2C26B2C2B2CCapturePolicy, number>
  const l1Exact = input.b2c2b2b.exactTargets
  const total = Object.fromEntries(PHASE2C26B2C2B2C_CAPTURE_POLICIES.map(p => [p, { recovered: l1Exact[p] + l2Exact[p], of: e1.length }])) as Record<Phase2C26B2C2B2CCapturePolicy, { recovered: number; of: number }>
  const allRecovered = issues.length === 0 && total.C4C.recovered === e1.length && e1.length > 0
  const l2Equal = input.l2Rows.filter(r => r.policies.C4C.firstExactContextRank !== null && r.policies.C4C.deltaFromFirstCompatible === 0).length
  const l2Later = input.l2Rows.filter(r => (r.policies.C4C.deltaFromFirstCompatible ?? 0) > 0).length
  const ex = input.b2c2b2b.execution
  return {
    issues,
    e1Total: e1.length,
    rungs: [
      { rung: 'L1', source: 'B2-C2B2B RESULT (registered, formal; not re-run here)', resultSha256: input.b2c2b2b.resultSha256, population: l1.length, targetWeaponIds: l1,
        decision: input.b2c2b2b.decisionCase, evidenceGrade: input.b2c2b2b.evidenceGrade, extent: input.b2c2b2b.extent,
        measurementCompleteness: { status: ex.completed === ex.tasks ? 'complete' : 'incomplete', tasks: ex.tasks, measured: ex.completed, unmeasured: ex.tasks - ex.completed,
          breakdown: { contextMismatch: ex.contextMismatch, timeout: ex.timeout, outOfMemory: ex.outOfMemory, processFailure: ex.processFailure, notRun: ex.notRun } },
        routeRecovery: Object.fromEntries(PHASE2C26B2C2B2C_CAPTURE_POLICIES.map(p => [p, { recovered: l1Exact[p], of: l1.length }])),
        firstExactEqualsFirstCompatible: input.b2c2b2b.firstExactEqualsFirstCompatible },
      { rung: 'L2', source: 'this phase (B2-C2B2C)', resultSha256: null, population: l2.length, targetWeaponIds: l2, decision: input.l2Decision, evidenceGrade: input.l2EvidenceGrade,
        extent: { ...PHASE2C26B2C2B2C_EXTENT }, measurementCompleteness: input.l2Measurement.measurementCompleteness,
        routeRecovery: Object.fromEntries(PHASE2C26B2C2B2C_CAPTURE_POLICIES.map(p => [p, { recovered: l2Exact[p], of: l2.length }])),
        firstExactEqualsFirstCompatible: { recoveredC4C: l2Exact.C4C, equal: l2Equal, later: l2Later } },
    ],
    total,
    allRecovered,
    statement: allRecovered ? `E1 ${e1.length} / ${e1.length} routes rediscovered under the registered Research ladder` : null,
    statementScope: 'Research-level only: each Route was searched at its post-hoc characterized rung (L1 for E1 ∩ L1, L2 for E1 ∩ L2); not a Production rung selector and not a Production ladder adoption',
    limitations: [...PHASE2C26B2C2B2C_E1_LADDER_LIMITATIONS],
  }
}

// ---------------------------------------------------------------- the whole analysis

type Oracle = { routes: readonly unknown[]; gogmaUsage: readonly unknown[] }

export interface Phase2C26B2C2B2CAnalysisInput {
  targetWeaponIds: readonly string[]
  tasks: readonly Phase2C26B2C2B2CTaskInput[]
  runs: readonly Phase2C26B2C2B2CRun[]
  reach: readonly Phase2C26B2C2AReach[]
  /** B2-C1's recorded P1 first compatible rank per Target. */
  b2c1FirstCompatible: ReadonlyMap<string, number | null>
  oracle: Oracle
  smoke: boolean
  interruption?: Phase2C26B2C2B2CInterruption | null
}

/** Raw consistency, the per-context comparison, the per-Target first exact, every aggregate, the route recovery summary and every invalid reason found here. */
export function runPhase2C26B2C2B2CAnalysis({ targetWeaponIds, tasks, runs, reach, b2c1FirstCompatible, oracle, smoke, interruption = null }: Phase2C26B2C2B2CAnalysisInput) {
  const invalidReasons: string[] = validatePhase2C26B2C2B2CRaw({ tasks, runs, smoke, interruption }).map(issue => issue.startsWith('semantic_failure') ? issue : `raw: ${issue}`)
  const manifestTargets = new Set(targetWeaponIds)
  for (const task of tasks) if (!manifestTargets.has(task.targetWeaponId)) invalidReasons.push(`raw: ${task.taskId}: a task outside the manifest`)
  const runOf = new Map(runs.map(r => [r.taskId, r]))
  const reachOf = new Map(reach.map(r => [r.targetWeaponId, r]))
  for (const r of reach) {
    invalidReasons.push(...r.inconsistencies.map(i => `reach: ${i}`))
    if (r.p1FirstCompatibleRank !== (b2c1FirstCompatible.get(r.targetWeaponId) ?? null)) invalidReasons.push(`authority: ${r.targetWeaponId}: recomputed P1 first compatible rank ${String(r.p1FirstCompatibleRank)} is not B2-C1's ${String(b2c1FirstCompatible.get(r.targetWeaponId))}`)
  }
  for (const run of runs) if (run.outcome.record === 'context_mismatch') invalidReasons.push(`semantic: ${run.taskId}: context mismatch in the Search child`)
  const contexts = tasks.map(task => phase2c26b2c2b2aCompareContext(runOf.get(task.taskId), task, reachOf.get(task.targetWeaponId)?.compatibleGroupIndexes.includes(task.groupIndex) ?? false, oracle))
  for (const c of contexts) invalidReasons.push(...c.inconsistencies.map(i => i.startsWith('semantic_failure') ? i : `comparison: ${i}`))
  const rows: Phase2C26B2C2B2CTargetRow[] = []
  for (const targetWeaponId of targetWeaponIds) {
    const { row, inconsistencies } = phase2c26b2c2b2aTargetRow(targetWeaponId, contexts.filter(c => c.targetWeaponId === targetWeaponId), b2c1FirstCompatible.get(targetWeaponId) ?? null,
      reachOf.get(targetWeaponId), phase2c26b2b2a2OracleOperationCost(oracle, targetWeaponId))
    invalidReasons.push(...inconsistencies)
    if (!smoke && row.b2c1FirstCompatibleRank !== null && !row.compatibleRanksInBudget.includes(row.b2c1FirstCompatibleRank)) invalidReasons.push(`authority: ${targetWeaponId}: the B2-C1 first compatible rank is not a compatible searched context`)
    rows.push(row)
  }
  const execution = phase2c26b2c2b2aExecution(tasks, runs)
  const exactTargets = Object.fromEntries(PHASE2C26B2C2B2C_CAPTURE_POLICIES.map(p => [p, rows.filter(r => r.policies[p].firstExactContextRank !== null).length])) as Record<Phase2C26B2C2B2CCapturePolicy, number>
  const unresolvedSafetyCapTargets = rows.filter(r => r.recovery === 'none' && contexts.some(c => c.targetWeaponId === r.targetWeaponId && c.compatible && c.safetyCapHit === true)).length
  const unmeasuredTasks = tasks.length - execution.completed - execution.contextMismatch
  const recovered = rows.filter(r => r.policies.C4C.firstExactContextRank !== null)
  const routeRecoverySummary = phase2c26b2c2b2cRouteRecoverySummary({ tasks: tasks.length, targets: targetWeaponIds.length, completed: execution.completed, contextMismatch: execution.contextMismatch,
    timeout: execution.timeout, outOfMemory: execution.outOfMemory, processFailure: execution.processFailure, notRun: execution.notRun, exactTargets })
  return {
    contexts, rows, invalidReasons, routeRecoverySummary,
    aggregates: {
      exactTargets, budgetCoverage: phase2c26b2c2b2aBudgetCoverage(rows), cascade: phase2c26b2c2b2aCascade(rows), compatibility: phase2c26b2c2b2aCompatibility(contexts),
      missClasses: Object.fromEntries(Object.entries(rows.filter(r => r.missClass !== null).reduce<Record<string, number>>((out, r) => ({ ...out, [r.missClass!]: (out[r.missClass!] ?? 0) + 1 }), {})).sort(([a], [b]) => compare(a, b))),
      partialWithoutExact: rows.filter(r => r.partialWithoutExact).length,
      firstExactDelta: Object.fromEntries(PHASE2C26B2C2B2C_CAPTURE_POLICIES.map(p => {
        const deltas = rows.flatMap(r => r.policies[p].deltaFromFirstCompatible === null ? [] : [r.policies[p].deltaFromFirstCompatible!])
        return [p, [...new Set(deltas)].sort((a, b) => a - b).map(value => ({ value, count: deltas.filter(d => d === value).length }))]
      })),
      /** The B2-C2A / B2-C2B2A / B2-C2B2B observation, re-asked at L2 for E1 ∩ L2 (a comparison, never a decision or selection condition). */
      firstExactEqualsFirstCompatible: { recoveredC4C: recovered.length, equal: recovered.filter(r => r.policies.C4C.deltaFromFirstCompatible === 0).length,
        later: recovered.filter(r => (r.policies.C4C.deltaFromFirstCompatible ?? 0) > 0).length },
      execution, targetResources: phase2c26b2c2b2bTargetResources(tasks, runs), candidates: phase2c26b2c2b2aCandidates(tasks, runs),
    },
    decisionInput: { tasks: tasks.length, targets: targetWeaponIds.length, unmeasuredTasks: Math.max(0, unmeasuredTasks), exactTargets, unresolvedSafetyCapTargets },
  }
}
