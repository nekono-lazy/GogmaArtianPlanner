/**
 * Issue #154 Phase 2-C2.6-B2-C2B2B post-hoc analysis only. It reads the finished (or interrupted and reconstructed) B2-C2B2B
 * raw run with every child record and the runner start attestation and, as explicit analyzer arguments AFTER the run ended,
 * the B2-C2B1 RESULT (population and L1 authority), the B2-C1 RESULT (P1 first-compatible authority), the B2-B1 RESULT (schedule
 * parity / hash chain), the B2-C2B2A RESULT (diagnostic L2 resource comparison only), the 1,657 oracle RESULT and its manifest.
 * It runs no Search, no kernel and no Planner and feeds nothing back into any calculation.
 *
 * The per-context comparison, the per-Target first exact rule and the aggregates are B2-C2B2A's, unchanged
 * (`phase2c26b2c2b2aCompareContext()` -> `phase2c26b2c2aCompareContext()` -> `phase2c26b2b2aCompare()` ->
 * `phase2c2OracleCoverage()`, compatibility through `phase2c26b2c2aReach()`). B2-C2B2B adds the L1 extent checks, the 7 x 32
 * decision, the runner start attestation as the launch provenance authority, and the B2-C2B2A L2 resource comparison.
 */
import { stableStringify } from '../domain/models/hashing'
import { phase2c26b2b2a2FirstDecidingKey, phase2c26b2b2a2OracleOperationCost } from './plannerGlobalPhase2C26B2B2A2Analysis'
import type { Phase2C26B2B2A2DeliveredCandidate } from './plannerGlobalPhase2C26B2B2A2'
import { phase2c26b2c1Percentile } from './plannerGlobalPhase2C26B2C1Analysis'
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
import {
  PHASE2C26B2C2B2B_CANDIDATE_SAFETY_CAP,
  PHASE2C26B2C2B2B_EXPECTED_TASKS,
  PHASE2C26B2C2B2B_EXTENT,
  PHASE2C26B2C2B2B_MAX_COST_COHORTS,
  PHASE2C26B2C2B2B_TARGETS,
  verifyPhase2C26B2C2B2BStartAttestation,
  type Phase2C26B2C2B2BAttestationExpectation,
  type Phase2C26B2C2B2BSearchRecord,
  type Phase2C26B2C2B2BTaskInput,
} from './plannerGlobalPhase2C26B2C2B2B'

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}
type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)

// ---------------------------------------------------------------- registered before the Stage 1 measurement

export type Phase2C26B2C2B2BCapturePolicy = Phase2C26B2C2B2ACapturePolicy
export const PHASE2C26B2C2B2B_CAPTURE_POLICIES = PHASE2C26B2C2B2A_CAPTURE_POLICIES
/** The context budgets the RESULT reports (diagnostic, never Production defaults). */
export const PHASE2C26B2C2B2B_BUDGETS = PHASE2C26B2C2B2A_BUDGETS
export const phase2c26b2c2b2bPolicyLength = phase2c26b2c2b2aPolicyLength

/** One run as the raw record holds it (B2-C2B2A's shape). */
export type Phase2C26B2C2B2BRun = Phase2C26B2C2B2ARun
export type Phase2C26B2C2B2BContextComparison = Phase2C26B2C2B2AContextComparison
export type Phase2C26B2C2B2BTargetRow = Phase2C26B2C2B2ATargetRow

const deliveries = (s: Phase2C26B2C2B2BSearchRecord): Phase2C26B2B2A2DeliveredCandidate[] => [...s.candidates, ...(s.nextCostSentinel ? [s.nextCostSentinel] : [])]
const searchOf = (run: Phase2C26B2C2B2BRun | undefined): Phase2C26B2C2B2BSearchRecord | null =>
  run && run.outcome.process === 'completed' && run.outcome.record === 'searched' && run.record?.status === 'searched' ? run.record.search : null

// ---------------------------------------------------------------- interrupted runs

/**
 * A run whose parent runner did not end by itself (a stop by the project owner, a crash, a host restart). The ran tasks are
 * analyzed exactly as recorded; the rest are `notRun`: never Candidate 0, never a Search failure, and they keep the decision
 * at B2C2B2B_INCOMPLETE through the unmeasured-task rule. Whether the run is formal evidence is a separate axis, decided by
 * the runner start attestation alone (`phase2c26b2c2b2bLaunchProvenance()`), never by being interrupted.
 */
export interface Phase2C26B2C2B2BInterruption {
  stoppedAt: string
  reason: string
  notRunTaskIds: string[]
}

// ---------------------------------------------------------------- launch provenance (evidence grade, separate from the Search decision)

export type Phase2C26B2C2B2BLaunchProvenanceSource = 'runner_start_attestation' | 'none'
export type Phase2C26B2C2B2BEvidenceGrade = 'formal' | 'diagnostic_partial' | 'non_formal'

export interface Phase2C26B2C2B2BLaunchProvenance {
  verified: boolean
  source: Phase2C26B2C2B2BLaunchProvenanceSource
  /** The launch working tree is attested clean by the runner (never inferred after the fact). */
  workingTreeCleanVerified: boolean
  issues: string[]
  /** The issues that break the attestation's integrity (see `verifyPhase2C26B2C2B2BStartAttestation()`); a present attestation with one is an invalid run. */
  integrityIssues: string[]
  reason: string | null
}

/**
 * The launch provenance of a raw run, completed or interrupted alike: verified only by the runner start attestation file of
 * the run dir, whose SHA-256 must be the one the raw recorded and whose body must verify against the independently obtained
 * HEAD / code / Export / manifest values (`verifyPhase2C26B2C2B2BStartAttestation()`). No attestation never verifies,
 * whatever HEAD a reconstruction was given; the raw environment is a cross-check, never the authority.
 */
export function phase2c26b2c2b2bLaunchProvenance(input: {
  /** The attestation file as found in the run dir (null when absent). */
  attestationFile: { sha256: string; body: unknown } | null
  /** The attestation SHA-256 the raw (runner or reconstruction) recorded (null when it recorded none). */
  recordedAttestationSha256: string | null
  /** The raw environment (the runner's own launch values, or the reconstruction's copy of the attestation). */
  environment: Record<string, unknown>
  expected: Phase2C26B2C2B2BAttestationExpectation
}): Phase2C26B2C2B2BLaunchProvenance {
  if (input.attestationFile === null) {
    return { verified: false, source: 'none', workingTreeCleanVerified: false, issues: ['no start attestation in the run dir'], integrityIssues: [],
      reason: 'The runner start attestation is missing: the launch HEAD, working-tree cleanliness and benchmark code hash are not attested by the runner.' }
  }
  const integrityIssues: string[] = []
  if (input.recordedAttestationSha256 !== input.attestationFile.sha256) integrityIssues.push('the attestation file is not the one the raw recorded')
  const verification = verifyPhase2C26B2C2B2BStartAttestation(input.attestationFile.body, input.expected)
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
export function phase2c26b2c2b2bEvidenceGrade(input: { formalConditions: boolean; launchProvenanceVerified: boolean; partialRun: boolean }): Phase2C26B2C2B2BEvidenceGrade {
  if (input.formalConditions && input.launchProvenanceVerified) return 'formal'
  return input.partialRun ? 'diagnostic_partial' : 'non_formal'
}

// ---------------------------------------------------------------- raw consistency (fails the run closed)

/**
 * Internal drift of the raw run (the B2-C2B2A rules with the L1 extent): every task carries the common L1 extent; every
 * searched record names its task's Target, rank, group, digests (default and L1), representative and capture rule at L1,
 * excludes exactly one Route key and never delivers it; deliveries are indexed 0..n-1 with unique keys; the comparator
 * verdict is "earlier first" and agrees with the six keys; the captured costs are the first <= 4 distinct costs and the
 * sentinel a fifth; the termination agrees with the flags. A cheaper Candidate after a dearer one is a semantic failure.
 */
export function validatePhase2C26B2C2B2BRaw(input: { tasks: readonly Phase2C26B2C2B2BTaskInput[]; runs: readonly Phase2C26B2C2B2BRun[]; smoke: boolean; interruption?: Phase2C26B2C2B2BInterruption | null }): string[] {
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
  for (const task of tasks) if (!same(task.extent, { ...PHASE2C26B2C2B2B_EXTENT })) issues.push(`${task.taskId}: the task extent is not the common L1 extent`)
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
    if (s.maxCostCohorts !== PHASE2C26B2C2B2B_MAX_COST_COHORTS || s.candidateSafetyCap !== PHASE2C26B2C2B2B_CANDIDATE_SAFETY_CAP) issues.push(`${at}: capture rule drift`)
    if (!same(s.extent, { ...PHASE2C26B2C2B2B_EXTENT })) issues.push(`${at}: the extent is not the common L1 extent`)
    if (s.searchInputDigest === s.defaultSearchInputDigest) issues.push(`${at}: the L1 digest equals the default digest`)
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
    if (!same(distinct, s.capturedCosts) || s.distinctCostCohorts !== s.capturedCosts.length || s.capturedCosts.length > PHASE2C26B2C2B2B_MAX_COST_COHORTS) issues.push(`${at}: captured cost cohorts drift`)
    const sentinelCost = s.nextCostSentinel?.orderingKeys.estimatedOperationCount
    if (s.nextCostSentinel && (s.capturedCosts.length !== PHASE2C26B2C2B2B_MAX_COST_COHORTS || s.capturedCosts.includes(sentinelCost!))) issues.push(`${at}: the sentinel is not the first Candidate of a fifth cost`)
    const f = s.summary
    const below = s.candidates.length < PHASE2C26B2C2B2B_CANDIDATE_SAFETY_CAP
    const ok = s.termination === 'four_cost_cohorts_drained' ? s.status === 'consumer_stop' && f.stoppedByConsumer && s.nextCostSentinel !== null && !s.safetyCapHit && s.captureComplete && below
      : s.termination === 'candidate_safety_cap' ? s.status === 'consumer_stop' && f.stoppedByConsumer && s.nextCostSentinel === null && s.safetyCapHit && !s.captureComplete
        && s.candidates.length === PHASE2C26B2C2B2B_CANDIDATE_SAFETY_CAP
        : s.termination === 'stopped_by_extent' ? s.status === 'stopped_by_extent' && !f.stoppedByConsumer && f.stoppedByExtent && s.nextCostSentinel === null && !s.safetyCapHit && s.captureComplete && below
          : s.termination === 'exhausted' && s.status === 'exhausted' && !f.stoppedByConsumer && !f.stoppedByExtent && f.exhausted && s.nextCostSentinel === null && !s.safetyCapHit && s.captureComplete && below
    if (!ok) issues.push(`${at}: the termination disagrees with the flags / counts`)
    if (run.outcome.searchStatus !== s.status || run.outcome.termination !== s.termination || run.outcome.candidateCount !== s.candidates.length) issues.push(`${at}: the outcome disagrees with the record`)
  }
  return issues
}

// ---------------------------------------------------------------- per Target resources

const stats = (values: readonly number[]) => ({ count: values.length, min: values.length === 0 ? null : Math.min(...values), median: phase2c26b2c1Percentile(values, 50),
  p90: phase2c26b2c1Percentile(values, 90), p95: phase2c26b2c1Percentile(values, 95), max: values.length === 0 ? null : Math.max(...values) })
const peakOf = (r: Phase2C26B2C2B2BRun) => ({ heap: Math.max(r.memory?.sampledMaxHeapUsedBytes ?? 0, r.lastIpcMemory?.maxHeapUsedBytes ?? 0),
  rss: Math.max(r.memory?.sampledMaxRssBytes ?? 0, (r.memory?.maxRssKiB ?? 0) * 1024, r.lastIpcMemory?.maxRssBytes ?? 0) })

/** Runtime / memory per Target (started runs; Search elapsed of completed Searches only). */
export function phase2c26b2c2b2bTargetResources(tasks: readonly Phase2C26B2C2B2BTaskInput[], runs: readonly Phase2C26B2C2B2BRun[]) {
  const targets = [...new Set(tasks.map(t => t.targetWeaponId))]
  return targets.map(id => {
    const own = runs.filter(r => r.task.targetWeaponId === id)
    const measured = own.filter(r => searchOf(r) !== null)
    return { targetWeaponId: id, started: own.length, completed: measured.length, searchElapsedMs: stats(measured.map(r => searchOf(r)!.elapsedMs)),
      processWallMs: stats(own.map(r => r.process.wallMs)), processWallMsTotal: own.reduce((sum, r) => sum + r.process.wallMs, 0),
      peakHeapBytesMax: own.length === 0 ? null : Math.max(...own.map(r => peakOf(r).heap)), peakRssBytesMax: own.length === 0 ? null : Math.max(...own.map(r => peakOf(r).rss)),
      yields: stats(measured.map(r => r.yields ?? 0)), safetyCap: measured.filter(r => searchOf(r)!.safetyCapHit).length }
  })
}

// ---------------------------------------------------------------- decision (registered before the Stage 1 measurement)

export type Phase2C26B2C2B2BDecisionCase = 'B2C2B2B_ALL_C8' | 'B2C2B2B_ALL_C32' | 'B2C2B2B_ALL_C4C' | 'B2C2B2B_PARTIAL' | 'B2C2B2B_INCOMPLETE' | 'B2C2B2B_INVALID'

export const PHASE2C26B2C2B2B_DECISION_RULE = {
  order: [
    'B2C2B2B_INVALID: a B2-C2B1 / B2-C1 / B2-B1 authority mismatch, an E1 ∩ L1 population or Target manifest mismatch (a first ladder rung disagreeing with the recorded required extent included), a Target count other than 7, a task count other than 224, a P1 definition drift, a P1 schedule parity mismatch, a context rank duplicated / missing, a reservation digest / origin drift, a task or record extent other than the common L1 extent (a Target-specific extent included), a default / L1 Search input digest drift, an oracle / hash-chain / Export / CalculationContext / RNG mismatch, a recomputed P1 first compatible rank other than B2-C1\'s, a context mismatch in a Search child, a task outside the manifest or run twice, a Candidate reservation violation (sentinel included), an exact or partial Candidate (or an exact / partial sentinel) from a reservation-incompatible context, a first exact rank before the first compatible rank, a nonmonotonic Candidate cost sequence, a start attestation that is present but does not verify, or a raw / result inconsistency',
    'B2C2B2B_INCOMPLETE: no invalid reason, and a task was not measured (timeout / out of memory / process failure / notRun after an interruption: never Candidate 0, never retried in this Phase)',
    'B2C2B2B_ALL_C8: all 224 tasks measured and C8 reaches an exact Candidate for 7 / 7 Targets within P1 rank <= 32',
    'B2C2B2B_ALL_C32: all measured, C8 < 7, C32 7 / 7',
    'B2C2B2B_ALL_C4C: all measured, C32 < 7, C4C 7 / 7 (a safety-capped capture still counts its exact Candidates: they lie inside the first four cohorts)',
    'B2C2B2B_INCOMPLETE: all measured, C4C < 7, and a Target without a C4C exact has a safety-capped compatible context in its 32 (its C4C failure is undetermined)',
    'B2C2B2B_PARTIAL: all measured, no invalid reason, C4C < 7 and every missing Target fully determined (0 / 7 is registered here too and flagged); an exact miss is never read as "the Route does not exist"',
  ],
  policies: 'C8 / C32 = the first 8 / 32 Candidates of the one C4C capture; C4C = every captured Candidate (up to four complete operation-cost cohorts; the sentinel never counts). C8 ⊆ C32 ⊆ C4C',
  exact: 'phase2c26b2c2b2aCompareContext() -> phase2c26b2c2aCompareContext() -> phase2c26b2b2aCompare() -> phase2c2OracleCoverage() per Candidate; partial_comparable is recorded and never counted as exact',
  firstExact: 'per Target and policy the smallest P1 rank whose context holds an exact Candidate in that policy; every rank 1..32 was searched regardless. first exact rank > first compatible rank is a legal measurement; first exact rank == first compatible rank is an observation, never a selection condition',
  compatible: 'phase2c26b2c2aReach() (phase2c26b2c1TargetReach() -> phase2c26b2aReachability()) over the re-derived schedule; must reproduce the B2-C1 P1 first compatible ranks',
  extent: 'every task and every Search at the common L1 extent { maxNormalAdvance: 8, maxGogmaAdvance: 235, maxSkillAdvance: 256 }; the schedule / reservation universe / P1 ordering stay at the Production default extent',
  evidence: 'separate axis: formal = the ordinary formal conditions AND a verified runner start attestation; an interrupted run is partialRun = true and is graded by the attestation, never automatically non-formal and never promoted by --allow-nonformal',
} as const

export const PHASE2C26B2C2B2B_RECOMMENDATION: Record<Phase2C26B2C2B2BDecisionCase, string> = {
  B2C2B2B_ALL_C8: 'E1 ∩ L1はcommon L1 extentでP1 scheduler-selected context + 既存SearchによるRoute deliveryがこのExportでは成立。次はE1のL2-needed 4 Target、E2（K2-minimal）のTarget-relative K2 feature / grouping研究を別Phaseで検討。Production採用ではない',
  B2C2B2B_ALL_C32: 'E1 ∩ L1はcommon L1 extentで成立（C8では不足、C32で閉じる）。次はL2-needed 4 TargetとE2研究を別Phaseで検討。Production採用ではない',
  B2C2B2B_ALL_C4C: 'E1 ∩ L1はcommon L1 extentで成立（equal-cost cohort単位のcaptureが必要）。次はL2-needed 4 TargetとE2研究を別Phaseで検討。Production採用ではない',
  B2C2B2B_PARTIAL: '未回収TargetをcompatibleなのにSearch non-delivery / capture不足 / context rank 32外に分離して原因を研究する（Route不存在とは結論しない）',
  B2C2B2B_INCOMPLETE: 'timeout / OOM / safety cap / notRunを先に扱う（timeout taskの長時間再測定、resource explosion調査、Search runtime最適化のいずれかをレビュー後に決める）',
  B2C2B2B_INVALID: '次へ進まず原因修正',
}

export interface Phase2C26B2C2B2BDecisionInput {
  invalidReasons: readonly string[]
  tasks: number
  targets: number
  unmeasuredTasks: number
  exactTargets: Record<Phase2C26B2C2B2BCapturePolicy, number>
  /** Targets without a C4C exact that hold a safety-capped compatible context. */
  unresolvedSafetyCapTargets: number
}

export function phase2c26b2c2b2bDecision(input: Phase2C26B2C2B2BDecisionInput) {
  const { tasks, targets, unmeasuredTasks, exactTargets, unresolvedSafetyCapTargets } = input
  const values = [tasks, targets, unmeasuredTasks, unresolvedSafetyCapTargets, exactTargets.C8, exactTargets.C32, exactTargets.C4C]
  if (!values.every(v => Number.isInteger(v) && v >= 0) || unmeasuredTasks > tasks || exactTargets.C8 > exactTargets.C32 || exactTargets.C32 > exactTargets.C4C || exactTargets.C4C > targets
    || unresolvedSafetyCapTargets > targets - exactTargets.C4C) throw new Error(`Inconsistent Phase 2-C2.6-B2-C2B2B decision input: ${JSON.stringify(input)}`)
  const reasons = [...input.invalidReasons, ...(tasks !== PHASE2C26B2C2B2B_EXPECTED_TASKS ? [`task_count_${tasks}`] : []), ...(targets !== PHASE2C26B2C2B2B_TARGETS ? [`target_count_${targets}`] : [])]
  const all = PHASE2C26B2C2B2B_TARGETS
  const caseId: Phase2C26B2C2B2BDecisionCase = reasons.length > 0 ? 'B2C2B2B_INVALID'
    : unmeasuredTasks > 0 ? 'B2C2B2B_INCOMPLETE'
      : exactTargets.C8 === all ? 'B2C2B2B_ALL_C8'
        : exactTargets.C32 === all ? 'B2C2B2B_ALL_C32'
          : exactTargets.C4C === all ? 'B2C2B2B_ALL_C4C'
            : unresolvedSafetyCapTargets > 0 ? 'B2C2B2B_INCOMPLETE'
              : 'B2C2B2B_PARTIAL'
  return { case: caseId, reasons, noExactTarget: caseId === 'B2C2B2B_PARTIAL' && exactTargets.C4C === 0, recommendation: PHASE2C26B2C2B2B_RECOMMENDATION[caseId] }
}

// ---------------------------------------------------------------- the whole analysis

type Oracle = { routes: readonly unknown[]; gogmaUsage: readonly unknown[] }

export interface Phase2C26B2C2B2BAnalysisInput {
  targetWeaponIds: readonly string[]
  tasks: readonly Phase2C26B2C2B2BTaskInput[]
  runs: readonly Phase2C26B2C2B2BRun[]
  reach: readonly Phase2C26B2C2AReach[]
  /** B2-C1's recorded P1 first compatible rank per Target. */
  b2c1FirstCompatible: ReadonlyMap<string, number | null>
  oracle: Oracle
  smoke: boolean
  interruption?: Phase2C26B2C2B2BInterruption | null
}

/** Raw consistency, the per-context comparison, the per-Target first exact, every aggregate and every invalid reason found here. */
export function runPhase2C26B2C2B2BAnalysis({ targetWeaponIds, tasks, runs, reach, b2c1FirstCompatible, oracle, smoke, interruption = null }: Phase2C26B2C2B2BAnalysisInput) {
  const invalidReasons: string[] = validatePhase2C26B2C2B2BRaw({ tasks, runs, smoke, interruption }).map(issue => issue.startsWith('semantic_failure') ? issue : `raw: ${issue}`)
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
  const rows: Phase2C26B2C2B2BTargetRow[] = []
  for (const targetWeaponId of targetWeaponIds) {
    const { row, inconsistencies } = phase2c26b2c2b2aTargetRow(targetWeaponId, contexts.filter(c => c.targetWeaponId === targetWeaponId), b2c1FirstCompatible.get(targetWeaponId) ?? null,
      reachOf.get(targetWeaponId), phase2c26b2b2a2OracleOperationCost(oracle, targetWeaponId))
    invalidReasons.push(...inconsistencies)
    if (!smoke && row.b2c1FirstCompatibleRank !== null && !row.compatibleRanksInBudget.includes(row.b2c1FirstCompatibleRank)) invalidReasons.push(`authority: ${targetWeaponId}: the B2-C1 first compatible rank is not a compatible searched context`)
    rows.push(row)
  }
  const execution = phase2c26b2c2b2aExecution(tasks, runs)
  const exactTargets = Object.fromEntries(PHASE2C26B2C2B2B_CAPTURE_POLICIES.map(p => [p, rows.filter(r => r.policies[p].firstExactContextRank !== null).length])) as Record<Phase2C26B2C2B2BCapturePolicy, number>
  const unresolvedSafetyCapTargets = rows.filter(r => r.recovery === 'none' && contexts.some(c => c.targetWeaponId === r.targetWeaponId && c.compatible && c.safetyCapHit === true)).length
  const unmeasuredTasks = tasks.length - execution.completed - execution.contextMismatch
  const recovered = rows.filter(r => r.policies.C4C.firstExactContextRank !== null)
  return {
    contexts, rows, invalidReasons,
    aggregates: {
      exactTargets, budgetCoverage: phase2c26b2c2b2aBudgetCoverage(rows), cascade: phase2c26b2c2b2aCascade(rows), compatibility: phase2c26b2c2b2aCompatibility(contexts),
      missClasses: Object.fromEntries(Object.entries(rows.filter(r => r.missClass !== null).reduce<Record<string, number>>((out, r) => ({ ...out, [r.missClass!]: (out[r.missClass!] ?? 0) + 1 }), {})).sort(([a], [b]) => compare(a, b))),
      partialWithoutExact: rows.filter(r => r.partialWithoutExact).length,
      firstExactDelta: Object.fromEntries(PHASE2C26B2C2B2B_CAPTURE_POLICIES.map(p => {
        const deltas = rows.flatMap(r => r.policies[p].deltaFromFirstCompatible === null ? [] : [r.policies[p].deltaFromFirstCompatible!])
        return [p, [...new Set(deltas)].sort((a, b) => a - b).map(value => ({ value, count: deltas.filter(d => d === value).length }))]
      })),
      /** The B2-C2A / B2-C2B2A observation, re-asked at L1 (a comparison, never a decision or selection condition). */
      firstExactEqualsFirstCompatible: { recoveredC4C: recovered.length, equal: recovered.filter(r => r.policies.C4C.deltaFromFirstCompatible === 0).length,
        later: recovered.filter(r => (r.policies.C4C.deltaFromFirstCompatible ?? 0) > 0).length },
      execution, targetResources: phase2c26b2c2b2bTargetResources(tasks, runs), candidates: phase2c26b2c2b2aCandidates(tasks, runs),
    },
    decisionInput: { tasks: tasks.length, targets: targetWeaponIds.length, unmeasuredTasks: Math.max(0, unmeasuredTasks), exactTargets, unresolvedSafetyCapTargets },
  }
}

// ---------------------------------------------------------------- the B2-C2B2A RESULT (diagnostic L2 resource comparison only)

/** The B2-C2B2A RESULT (common L2, intentionally stopped, non-formal diagnostic partial evidence) this phase compares with. */
export const PHASE2C26B2C2B2B_REGISTERED_B2C2B2A = {
  resultSha256: '735933961df65fcc73677c1aaf7279f2671ac583bb9c5d06de8ec05523947d70',
  decisionCase: 'B2C2B2A_INCOMPLETE',
  evidenceGrade: 'diagnostic_partial',
  extent: { maxNormalAdvance: 128, maxGogmaAdvance: 235, maxSkillAdvance: 1500 },
} as const

/** One B2-C2B2A task row as the comparison needs it. */
export interface Phase2C26B2C2B2BL2TaskRow {
  taskId: string
  targetWeaponId: string
  contextRank: number
  reservationDigest: string
  defaultSearchInputDigest: string
  process: string
  wallMs: number | null
  searchElapsedMs: number | null
  peakHeapBytes: number | null
  peakRssBytes: number | null
  yields: number | null
  termination: string | null
  candidateCount: number | null
  safetyCapHit: boolean | null
  compatible: boolean
  hitC4C: boolean
}

/**
 * Reads the committed B2-C2B2A RESULT for its task rows only: the registered SHA-256, the registered case and evidence grade
 * (non-formal diagnostic partial: it is never authority here), no invalid reason, the common L2 extent, the same B2-C2B1
 * RESULT and Export.
 */
export function parsePhase2C26B2C2B2BB2C2B2ADiagnostic(json: unknown, resultSha256: string, expected: { b2c2b1ResultSha256: string; exportSha256: string }):
  { valid: boolean; issues: string[]; rows: Phase2C26B2C2B2BL2TaskRow[] } {
  const reg = PHASE2C26B2C2B2B_REGISTERED_B2C2B2A
  const issues: string[] = []
  if (!isObject(json) || !isObject(json.provenance) || !isObject(json.decision) || !isObject(json.conditions) || !Array.isArray(json.taskRows)) {
    return { valid: false, issues: ['B2-C2B2A RESULT lacks provenance / decision / conditions / taskRows'], rows: [] }
  }
  const { provenance, decision, conditions } = json
  if (resultSha256 !== reg.resultSha256) issues.push(`B2-C2B2A RESULT SHA-256 ${resultSha256} is not the registered ${reg.resultSha256}`)
  if (decision.case !== reg.decisionCase) issues.push(`decision.case ${String(decision.case)} is not ${reg.decisionCase}`)
  if (provenance.evidenceGrade !== reg.evidenceGrade || provenance.formal !== false) issues.push('the B2-C2B2A evidence grade is not the registered non-formal diagnostic partial')
  if (!Array.isArray(json.invalidReasons) || json.invalidReasons.length !== 0) issues.push('invalidReasons is not empty')
  if (!same(conditions.searchExtent, reg.extent)) issues.push('conditions.searchExtent is not the common L2 extent')
  if (provenance.b2c2b1ResultSha256 !== expected.b2c2b1ResultSha256) issues.push('provenance.b2c2b1ResultSha256 is not the B2-C2B1 RESULT of this phase')
  if (provenance.exportSha256 !== expected.exportSha256) issues.push('provenance.exportSha256 is not the Export of this phase')
  const num = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null
  const rows: Phase2C26B2C2B2BL2TaskRow[] = []
  for (const raw of json.taskRows as unknown[]) {
    if (!isObject(raw) || typeof raw.taskId !== 'string' || typeof raw.targetWeaponId !== 'string' || !Number.isSafeInteger(raw.contextRank) || typeof raw.reservationDigest !== 'string'
      || typeof raw.defaultSearchInputDigest !== 'string' || typeof raw.process !== 'string' || typeof raw.compatible !== 'boolean') { issues.push('a B2-C2B2A task row is malformed'); continue }
    rows.push({ taskId: raw.taskId, targetWeaponId: raw.targetWeaponId, contextRank: raw.contextRank as number, reservationDigest: raw.reservationDigest,
      defaultSearchInputDigest: raw.defaultSearchInputDigest, process: raw.process, wallMs: num(raw.wallMs), searchElapsedMs: num(raw.searchElapsedMs), peakHeapBytes: num(raw.peakHeapBytes),
      peakRssBytes: num(raw.peakRssBytes), yields: num(raw.yields), termination: typeof raw.termination === 'string' ? raw.termination : null, candidateCount: num(raw.candidateCount),
      safetyCapHit: typeof raw.safetyCapHit === 'boolean' ? raw.safetyCapHit : null, compatible: raw.compatible, hitC4C: isObject(raw.hit) && raw.hit.C4C === true })
  }
  return { valid: issues.length === 0, issues, rows }
}

/** One context as measured at L1 here (the analyzer builds it from its task rows). */
export type Phase2C26B2C2B2BL1TaskRow = Phase2C26B2C2B2BL2TaskRow

const MEASURED = 'completed'
const ratio = (a: number | null, b: number | null) => a !== null && b !== null && b > 0 ? a / b : null

/**
 * The post-hoc L2 vs L1 resource comparison over the contexts both phases started: matched by Target and P1 rank, with the
 * reservation digest and the default Search input digest required equal (the same context at another extent). Diagnostic
 * only: never a decision input, never a Production judgement; B2-C2B2A is non-formal diagnostic partial evidence.
 */
export function phase2c26b2c2b2bL2Comparison(l2Rows: readonly Phase2C26B2C2B2BL2TaskRow[], l1Rows: readonly Phase2C26B2C2B2BL1TaskRow[]) {
  const issues: string[] = []
  const l2Of = new Map(l2Rows.map(r => [`${r.targetWeaponId}@${r.contextRank}`, r]))
  const pairs = l1Rows.flatMap(l1 => {
    const l2 = l2Of.get(`${l1.targetWeaponId}@${l1.contextRank}`)
    if (!l2 || l2.process === 'not_run' || l1.process === 'not_run') return []
    if (l2.reservationDigest !== l1.reservationDigest || l2.defaultSearchInputDigest !== l1.defaultSearchInputDigest) { issues.push(`${l1.taskId}: the B2-C2B2A context is not this context`); return [] }
    if (l2.compatible !== l1.compatible) issues.push(`${l1.taskId}: the post-hoc compatibility differs between the two phases`)
    return [{ l2, l1 }]
  })
  const bothCompleted = pairs.filter(p => p.l2.process === MEASURED && p.l1.process === MEASURED)
  const sum = (values: (number | null)[]) => values.reduce<number>((s, v) => s + (v ?? 0), 0)
  const outcomeCounts = (rows: readonly { process: string; safetyCapHit: boolean | null }[]) => ({ started: rows.length, completed: rows.filter(r => r.process === MEASURED).length,
    timeout: rows.filter(r => r.process === 'timeout').length, outOfMemory: rows.filter(r => r.process === 'out_of_memory').length,
    processFailure: rows.filter(r => r.process === 'process_failure').length, safetyCap: rows.filter(r => r.process === MEASURED && r.safetyCapHit === true).length })
  const side = (rows: readonly Phase2C26B2C2B2BL2TaskRow[]) => ({ ...outcomeCounts(rows),
    searchElapsedMs: stats(rows.flatMap(r => r.process === MEASURED && r.searchElapsedMs !== null ? [r.searchElapsedMs] : [])),
    processWallMs: stats(rows.flatMap(r => r.wallMs === null ? [] : [r.wallMs])), processWallMsTotal: sum(rows.map(r => r.wallMs)),
    peakHeapBytes: stats(rows.flatMap(r => r.peakHeapBytes === null ? [] : [r.peakHeapBytes])), peakRssBytes: stats(rows.flatMap(r => r.peakRssBytes === null ? [] : [r.peakRssBytes])),
    yields: stats(rows.flatMap(r => r.process === MEASURED && r.yields !== null ? [r.yields] : [])),
    candidateCount: stats(rows.flatMap(r => r.process === MEASURED && r.candidateCount !== null ? [r.candidateCount] : [])),
    termination: Object.fromEntries([...new Set(rows.flatMap(r => r.process === MEASURED && r.termination !== null ? [r.termination] : []))].sort(compare)
      .map(t => [t, rows.filter(r => r.process === MEASURED && r.termination === t).length])),
    exactC4C: rows.filter(r => r.hitC4C).length })
  const targets = [...new Set(pairs.map(p => p.l1.targetWeaponId))]
  const perContext = pairs.map(({ l2, l1 }) => ({ targetWeaponId: l1.targetWeaponId, contextRank: l1.contextRank, l2TaskId: l2.taskId, l1TaskId: l1.taskId, compatible: l1.compatible,
    process: { l2: l2.process, l1: l1.process }, termination: { l2: l2.termination, l1: l1.termination }, candidateCount: { l2: l2.candidateCount, l1: l1.candidateCount },
    safetyCap: { l2: l2.safetyCapHit, l1: l1.safetyCapHit }, exactC4C: { l2: l2.hitC4C, l1: l1.hitC4C },
    searchElapsedMs: { l2: l2.searchElapsedMs, l1: l1.searchElapsedMs, ratioL1OverL2: l2.process === MEASURED && l1.process === MEASURED ? ratio(l1.searchElapsedMs, l2.searchElapsedMs) : null },
    processWallMs: { l2: l2.wallMs, l1: l1.wallMs, ratioL1OverL2: ratio(l1.wallMs, l2.wallMs) },
    peakHeapBytes: { l2: l2.peakHeapBytes, l1: l1.peakHeapBytes, ratioL1OverL2: ratio(l1.peakHeapBytes, l2.peakHeapBytes) },
    peakRssBytes: { l2: l2.peakRssBytes, l1: l1.peakRssBytes, ratioL1OverL2: ratio(l1.peakRssBytes, l2.peakRssBytes) },
    yields: { l2: l2.yields, l1: l1.yields } }))
  const transitions = Object.fromEntries([...new Set(pairs.map(p => `${p.l2.process}->${p.l1.process}`))].sort(compare).map(k => [k, pairs.filter(p => `${p.l2.process}->${p.l1.process}` === k).length]))
  return {
    note: 'Diagnostic only, never a decision input or a Production judgement. B2-C2B2A (common L2) is non-formal diagnostic partial evidence; only the contexts both phases started are compared, matched by Target and P1 rank with equal reservation / default Search input digests.',
    issues, pairs: pairs.length, bothCompleted: bothCompleted.length, processTransitions: transitions,
    l2: side(pairs.map(p => p.l2)), l1: side(pairs.map(p => p.l1)),
    bothCompletedRatios: {
      searchElapsedMedianOfRatios: phase2c26b2c1Percentile(bothCompleted.flatMap(p => { const v = ratio(p.l1.searchElapsedMs, p.l2.searchElapsedMs); return v === null ? [] : [v] }), 50),
      searchElapsedSumL1OverL2: ratio(sum(bothCompleted.map(p => p.l1.searchElapsedMs)), sum(bothCompleted.map(p => p.l2.searchElapsedMs))),
      peakHeapMedianOfRatios: phase2c26b2c1Percentile(bothCompleted.flatMap(p => { const v = ratio(p.l1.peakHeapBytes, p.l2.peakHeapBytes); return v === null ? [] : [v] }), 50),
      peakRssMedianOfRatios: phase2c26b2c1Percentile(bothCompleted.flatMap(p => { const v = ratio(p.l1.peakRssBytes, p.l2.peakRssBytes); return v === null ? [] : [v] }), 50),
      candidateCountSame: bothCompleted.filter(p => p.l1.candidateCount === p.l2.candidateCount).length,
      terminationSame: bothCompleted.filter(p => p.l1.termination === p.l2.termination).length,
    },
    perTarget: targets.map(id => ({ targetWeaponId: id, l2: outcomeCounts(pairs.filter(p => p.l1.targetWeaponId === id).map(p => p.l2)),
      l1: outcomeCounts(pairs.filter(p => p.l1.targetWeaponId === id).map(p => p.l1)) })),
    perContext,
  }
}
