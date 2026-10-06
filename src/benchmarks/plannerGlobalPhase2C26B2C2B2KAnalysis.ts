/**
 * Issue #154 Phase 2-C2.6-B2-C2B2K post-hoc analysis only. It reads the finished B2-C2B2K raw run with its child record, its memory
 * log and its runner start attestation and, as explicit analyzer arguments AFTER the run ended, every authority B2-C2B2E read, the
 * committed B2-C2B2E RESULT (the population source and the paired before authority of the same Search input) and the B2-C2B2I /
 * B2-C2B2J RESULTs (the authority of the optimized Production state). It runs no Search, no kernel and no Planner and feeds nothing
 * back into any calculation.
 *
 * The per-context comparison against the oracle Route, the per-Target row, the raw consistency, the excluded current Route
 * re-derivation and the trajectory are B2-C2B2E's / B2-C2B2D's, unchanged (`runPhase2C26B2C2B2EAnalysis()`). B2-C2B2K adds the paired
 * comparison with B2-C2B2E's own run of the same Target - whose Search input, digest and excluded Route included, must be IDENTICAL,
 * and whose execution conditions must be IDENTICAL too - the registered decision for this one Target (RECOVERED / MEASURED_NO_EXACT /
 * INCOMPLETE / INVALID), and the E1 aggregate under oracle-guided diagnostic conditions kept apart from the common-ladder evidence.
 */
import { stableStringify } from '../domain/models/hashing'
import { phase2c26b2c2b2dEvidenceGrade, type Phase2C26B2C2B2DBaselineRederivation, type Phase2C26B2C2B2DContextComparison } from './plannerGlobalPhase2C26B2C2B2DAnalysis'
import {
  phase2c26b2c2b2ePeak,
  phase2c26b2c2b2eTrajectory,
  runPhase2C26B2C2B2EAnalysis,
  PHASE2C26B2C2B2E_CAPTURE_POLICIES,
  type Phase2C26B2C2B2EAnalysisInput,
  type Phase2C26B2C2B2ECapturePolicy,
  type Phase2C26B2C2B2EMemorySample,
  type Phase2C26B2C2B2ERun,
  type Phase2C26B2C2B2ETargetRow,
  type Phase2C26B2C2B2ETrajectory,
} from './plannerGlobalPhase2C26B2C2B2EAnalysis'
import { PHASE2C26B2C2B2F_IDENTITY_FIELDS } from './plannerGlobalPhase2C26B2C2B2F'
import {
  verifyPhase2C26B2C2B2KStartAttestation,
  PHASE2C26B2C2B2K_BUDGET_MS,
  PHASE2C26B2C2B2K_CHILD_HEAP_MB,
  PHASE2C26B2C2B2K_EXPECTED_TASKS,
  PHASE2C26B2C2B2K_TARGETS,
  type Phase2C26B2C2B2KAttestationExpectation,
  type Phase2C26B2C2B2KSearchRecord,
  type Phase2C26B2C2B2KTaskInput,
} from './plannerGlobalPhase2C26B2C2B2K'
import type { Phase2C26B2C2B2KB2C2B2EFacts, Phase2C26B2C2B2KPairedSide } from './plannerGlobalPhase2C26B2C2B2KTargets'

const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}
type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)

export type Phase2C26B2C2B2KCapturePolicy = Phase2C26B2C2B2ECapturePolicy
export const PHASE2C26B2C2B2K_CAPTURE_POLICIES = PHASE2C26B2C2B2E_CAPTURE_POLICIES
export type Phase2C26B2C2B2KRun = Phase2C26B2C2B2ERun
export type Phase2C26B2C2B2KTargetRow = Phase2C26B2C2B2ETargetRow

const searchOf = (run: Phase2C26B2C2B2KRun | undefined): Phase2C26B2C2B2KSearchRecord | null => run?.record?.status === 'searched' ? run.record.search : null
const processOf = (run: Phase2C26B2C2B2KRun | undefined) => run?.outcome.record === 'context_mismatch' ? 'context_mismatch' : run?.process.outcome ?? 'not_run'

// ---------------------------------------------------------------- launch provenance (evidence grade, separate from the Search decision)

export interface Phase2C26B2C2B2KLaunchProvenance {
  verified: boolean
  source: 'runner_start_attestation' | 'none'
  workingTreeCleanVerified: boolean
  issues: string[]
  integrityIssues: string[]
  reason: string | null
}

/**
 * The launch provenance of a raw run: verified only by the runner start attestation file of the run dir, whose SHA-256 must be the
 * one the raw recorded and whose body must verify against the independently obtained HEAD / code / Export / probe manifest / authority
 * RESULTs / B2-C2B2E evidence / adopted optimizations (`verifyPhase2C26B2C2B2KStartAttestation()`), and equal the raw environment on
 * every launch field. No attestation never verifies.
 */
export function phase2c26b2c2b2kLaunchProvenance(input: {
  attestationFile: { sha256: string; body: unknown } | null
  recordedAttestationSha256: string | null
  environment: Record<string, unknown>
  expected: Phase2C26B2C2B2KAttestationExpectation
}): Phase2C26B2C2B2KLaunchProvenance {
  if (input.attestationFile === null) {
    return { verified: false, source: 'none', workingTreeCleanVerified: false, issues: ['no start attestation in the run dir'], integrityIssues: [],
      reason: 'The runner start attestation is missing: the launch HEAD, working-tree cleanliness and benchmark code hash are not attested by the runner.' }
  }
  const integrityIssues: string[] = []
  if (input.recordedAttestationSha256 !== input.attestationFile.sha256) integrityIssues.push('the attestation file is not the one the raw recorded')
  const verification = verifyPhase2C26B2C2B2KStartAttestation(input.attestationFile.body, input.expected)
  integrityIssues.push(...verification.integrityIssues)
  const body = isObject(input.attestationFile.body) ? input.attestationFile.body : {}
  for (const field of ['repositoryHead', 'uncommittedBenchmarkCode', 'benchmarkCodeSha256', 'exportSha256', 'probeManifestSha256', 'stage1', 'probes', 'expectedTaskIdentities',
    'productionAudit', 'adoptedOptimizations', 'b2c2b2eEvidence'] as const) {
    if (!same(body[field], input.environment[field])) integrityIssues.push(`${field} differs from the raw environment`)
  }
  const issues = [...integrityIssues, ...verification.issues.filter(i => !verification.integrityIssues.includes(i))]
  const verified = issues.length === 0
  return { verified, source: 'runner_start_attestation', workingTreeCleanVerified: verified, issues, integrityIssues,
    reason: verified ? null : `The start attestation does not verify: ${issues.join('; ')}.` }
}

/** The evidence grade: B2-C2B2D's rule (formal only with every formal condition AND verified launch provenance). */
export const phase2c26b2c2b2kEvidenceGrade = phase2c26b2c2b2dEvidenceGrade

// ---------------------------------------------------------------- paired comparison with B2-C2B2E (same Target, same Search input, same conditions)

export interface Phase2C26B2C2B2KExcludedRouteComparison {
  verified: boolean
  rederivedExcludedRouteKeySha256: string | null
  /** The excluded current Route key SHA-256 B2-C2B2E re-derived for the same pair (B2-C2B2E kept no record: it timed out). */
  b2c2b2eRederivedExcludedRouteKeySha256: string
  b2c2b2kSource: 'b2c2b2k_record' | 'rederived_default_context' | null
  b2c2b2kRecordMatchesRederived: boolean | null
}

export interface Phase2C26B2C2B2KPairedRow {
  taskId: string
  targetWeaponId: string
  contextRank: number
  identity: { matches: boolean; issues: string[]; excludedRouteKeyComparison: Phase2C26B2C2B2KExcludedRouteComparison }
  b2c2b2e: Phase2C26B2C2B2KPairedSide
  b2c2b2k: Phase2C26B2C2B2KPairedSide
  /** `<B2-C2B2E process> -> <B2-C2B2K process>`. */
  outcomeTransition: string
  /** B2-C2B2K - B2-C2B2E. A B2-C2B2E timeout wall is a lower bound of what that Search needed; B2-C2B2E's yields are the last IPC value. */
  delta: { wallMs: number | null; peakHeapBytes: number | null; peakRssBytes: number | null; yields: number | null }
  /** B2-C2B2K / B2-C2B2E (descriptive only; never a decision input and never a decomposition of the B2-C2B2I / B2-C2B2J effects). */
  ratio: { wallMs: number | null; peakHeapBytes: number | null; peakRssBytes: number | null }
}

const diff = (a: number | null, b: number | null) => a === null || b === null ? null : a - b
const ratioOf = (a: number | null, b: number | null) => a === null || b === null || b === 0 ? null : a / b

/**
 * The B2-C2B2K task against B2-C2B2E's own task of the same Target: every Search input identity field (task ID, Target, rank, group,
 * reservation, cardinality, representative, default and tight Search input digests, the tight extent) must be equal to the B2-C2B2E
 * task row; the excluded current Route must be proved equal through the re-derived default context over that row
 * (`phase2c26b2c2b2dRederiveBaselineContext()`), which must reproduce the key B2-C2B2E re-derived and this phase's record key (if
 * any); the budget and the heap must be B2-C2B2E's. An unmeasured side keeps null Search fields: never Candidate 0.
 */
export function phase2c26b2c2b2kPairedRow(task: Phase2C26B2C2B2KTaskInput, run: Phase2C26B2C2B2KRun | undefined, comparison: Phase2C26B2C2B2DContextComparison,
  excludedRouteKeySha256: string | null, facts: Phase2C26B2C2B2KB2C2B2EFacts, rederivation: Phase2C26B2C2B2DBaselineRederivation | null,
  conditions: { budgetMs: number; childHeapMb: number }): Phase2C26B2C2B2KPairedRow {
  const issues: string[] = []
  const row = facts.taskRow
  for (const field of PHASE2C26B2C2B2F_IDENTITY_FIELDS) if (!same(task[field], row[field])) issues.push(`${task.taskId}: ${field} differs from B2-C2B2E`)
  const route: Phase2C26B2C2B2KExcludedRouteComparison = { verified: false, rederivedExcludedRouteKeySha256: null, b2c2b2eRederivedExcludedRouteKeySha256: facts.rederivedExcludedRouteKeySha256,
    b2c2b2kSource: null, b2c2b2kRecordMatchesRederived: null }
  const routeIssues: string[] = []
  if (rederivation === null || rederivation.taskId !== row.taskId) routeIssues.push(`${task.taskId}: no re-derived default context`)
  else {
    routeIssues.push(...rederivation.issues.map(i => `${task.taskId}: ${i}`))
    if (!rederivation.valid && rederivation.issues.length === 0) routeIssues.push(`${task.taskId}: the re-derived default context is not valid`)
    if (rederivation.defaultSearchInputDigest !== task.defaultSearchInputDigest) routeIssues.push(`${task.taskId}: the re-derived default digest is not this task's default digest`)
    const rederived = rederivation.excludedRouteKeySha256
    route.rederivedExcludedRouteKeySha256 = rederived
    if (rederived === null) routeIssues.push(`${task.taskId}: no re-derived excluded current Route key`)
    if (facts.rederivedExcludedRouteKeySha256 !== rederived) routeIssues.push(`${task.taskId}: the excluded current Route B2-C2B2E re-derived differs from the re-derived one`)
    if (excludedRouteKeySha256 !== null) {
      route.b2c2b2kSource = 'b2c2b2k_record'
      route.b2c2b2kRecordMatchesRederived = excludedRouteKeySha256 === rederived
      if (!route.b2c2b2kRecordMatchesRederived) routeIssues.push(`${task.taskId}: the B2-C2B2K record's excluded current Route differs from the re-derived one`)
    } else if (searchOf(run) !== null) routeIssues.push(`${task.taskId}: a searched B2-C2B2K task without a recorded excluded current Route`)
    else route.b2c2b2kSource = 'rederived_default_context'
  }
  route.verified = routeIssues.length === 0
  issues.push(...routeIssues)
  if (conditions.budgetMs !== facts.b2c2b2e.budgetMs || conditions.childHeapMb !== facts.b2c2b2e.childHeapMb) issues.push(`${task.taskId}: the execution budget / heap is not B2-C2B2E's`)
  if (run !== undefined && run.process.budgetMs !== conditions.budgetMs) issues.push(`${task.taskId}: the child budget is not this phase's`)
  const s = searchOf(run)
  const peak = run ? phase2c26b2c2b2ePeak(run) : null
  const ours: Phase2C26B2C2B2KPairedSide = { process: processOf(run), budgetMs: run?.process.budgetMs ?? null, childHeapMb: run ? conditions.childHeapMb : null, wallMs: run?.process.wallMs ?? null,
    searchElapsedMs: s?.elapsedMs ?? null, peakHeapBytes: peak?.heap ?? null, peakRssBytes: peak?.rss ?? null, yields: run?.yields ?? null, termination: s?.termination ?? null,
    deliveredCandidates: s?.summary.deliveredCandidates ?? null, candidateCount: s?.candidates.length ?? null, safetyCapHit: s?.safetyCapHit ?? null, hit: { ...comparison.hit },
    firstExactIndex: comparison.firstExactIndex, firstExactCost: comparison.firstExactCost }
  const theirs = facts.b2c2b2e
  return { taskId: task.taskId, targetWeaponId: task.targetWeaponId, contextRank: task.contextRank, identity: { matches: issues.length === 0 && route.verified, issues, excludedRouteKeyComparison: route },
    b2c2b2e: structuredClone(theirs), b2c2b2k: ours, outcomeTransition: `${theirs.process} -> ${ours.process}`,
    delta: { wallMs: diff(ours.wallMs, theirs.wallMs), peakHeapBytes: diff(ours.peakHeapBytes, theirs.peakHeapBytes), peakRssBytes: diff(ours.peakRssBytes, theirs.peakRssBytes),
      yields: diff(ours.yields, theirs.yields) },
    ratio: { wallMs: ratioOf(ours.wallMs, theirs.wallMs), peakHeapBytes: ratioOf(ours.peakHeapBytes, theirs.peakHeapBytes), peakRssBytes: ratioOf(ours.peakRssBytes, theirs.peakRssBytes) } }
}

// ---------------------------------------------------------------- decision (registered before the Stage 1 measurement; a diagnostic decision, never a scheduler decision)

export type Phase2C26B2C2B2KDecisionCase = 'B2C2B2K_RECOVERED' | 'B2C2B2K_MEASURED_NO_EXACT' | 'B2C2B2K_INCOMPLETE' | 'B2C2B2K_INVALID'

export const PHASE2C26B2C2B2K_DECISION_RULE = {
  primaryQuestion: 'Does the current main\'s optimized existing Search deliver the exact oracle Route for the B2-C2B2E time-bound Target in B2-C2B2E\'s Search input within B2-C2B2E\'s 60 minutes / 12,288 MB?',
  scope: 'An oracle-guided diagnostic decision (the B2-C2B2E time-bound Target, B2-C2B2D\'s first compatible context x target-relative tight extent, B2-C2B2E\'s execution conditions). It is never a scheduler decision and never evidence for a Production scheduler, a Production default extent, a Production extent / context selector or an acceptable Production runtime. A speed ratio is never a decision input.',
  order: [
    'B2C2B2K_INVALID: an authority mismatch (B2-C2B2E / B2-C2B2I / B2-C2B2J RESULT SHA-256, decision or chain; B2-C2B2E raw evidence SHA-256; B2-C1 / B2-C2B1 / B2-B1 / B2-C2B2B / B2-C2B2C / B2-C2B2D / oracle / hash chain), an Export / CalculationContext / researchMaxPlanSteps / RNG Engine mismatch, a population other than exactly the B2-C2B2E Target with process timeout, recovery none and type time_bound, a probe manifest other than the re-derived one, a Search input identity (task ID / Target / rank / group / reservation / cardinality / representative / default and tight Search input digests / tight extent / excluded current Route) other than B2-C2B2E\'s task, an execution condition other than B2-C2B2E\'s Stage 1 (60 minutes / 12,288 MB / concurrency 1 / fresh child / no retry / no fallback), any instrumentation, a Production calculation source changed by this phase, a Production change since B2-C2B2E\'s measured HEAD other than the adopted B2-C2B2I / B2-C2B2J optimizations, a start attestation that is present but does not verify, a Search child holding an oracle-derived expectation, a context mismatch in the Search child, a Candidate reservation violation, a nonmonotonic Candidate cost sequence, a provenance flag reported other than registered, or a raw / result inconsistency',
    'B2C2B2K_INCOMPLETE: no invalid reason, and the task produced no Search record (timeout / out of memory / process failure / notRun): never Candidate 0, never retried, never followed by a longer budget, a 16 GB heap or a fallback',
    'B2C2B2K_RECOVERED: the task was measured and its captured Candidates (C4C, up to four complete cost cohorts or the safety cap 1024; C8 / C32 are its prefixes) hold the exact oracle Route',
    'B2C2B2K_MEASURED_NO_EXACT: the task was measured and no captured Candidate is the exact oracle Route (only "not recovered within the registered capture / safety cap", never "the Route does not exist")',
  ],
  policies: 'C8 / C32 = the first 8 / 32 Candidates of the one C4C capture; C4C = every captured Candidate (up to four complete operation-cost cohorts; the sentinel never counts). C8 ⊆ C32 ⊆ C4C',
  exact: 'phase2c26b2c2b2aCompareContext() -> phase2c26b2c2aCompareContext() -> phase2c26b2b2aCompare() -> phase2c2OracleCoverage() per Candidate, after the run only; partial_comparable is recorded and never counted as exact',
  evidence: 'separate axis: formal = the ordinary formal conditions AND a verified runner start attestation',
} as const

export const PHASE2C26B2C2B2K_NEXT_PHASE: Record<Phase2C26B2C2B2KDecisionCase, string> = {
  B2C2B2K_RECOVERED: '追加micro-optimizationやt02 profilingへ戻らない。Issue #154の次段階として、oracleなしでcontext / extent / budgetをどう選ぶか、およびGlobal Plannerへどう戻すかを整理する（本PRでは実装しない）',
  B2C2B2K_MEASURED_NO_EXACT: '60分 / 12 GBで完走したがregistered capture / safety cap内にexactがない。budgetではなくCandidate ordering / capture / context semanticsを調査する（Route不存在とは結論しない）',
  B2C2B2K_INCOMPLETE: '60分 / 12 GBでも未計測。自動retry・budget延長・16 GB・fallbackはしない。次Phaseで追加runtime profilingを再検討する',
  B2C2B2K_INVALID: '次へ進まず原因修正',
}

export interface Phase2C26B2C2B2KDecisionInput {
  invalidReasons: readonly string[]
  tasks: number
  targets: number
  measuredTasks: number
  exactTargets: Record<Phase2C26B2C2B2KCapturePolicy, number>
}

export function phase2c26b2c2b2kDecision(input: Phase2C26B2C2B2KDecisionInput) {
  const { tasks, targets, measuredTasks, exactTargets } = input
  const values = [tasks, targets, measuredTasks, exactTargets.C8, exactTargets.C32, exactTargets.C4C]
  if (!values.every(v => Number.isInteger(v) && v >= 0) || measuredTasks > tasks || exactTargets.C8 > exactTargets.C32 || exactTargets.C32 > exactTargets.C4C || exactTargets.C4C > targets
    || exactTargets.C4C > measuredTasks) {
    throw new Error(`Inconsistent Phase 2-C2.6-B2-C2B2K decision input: ${JSON.stringify(input)}`)
  }
  const reasons = [...input.invalidReasons, ...(tasks !== PHASE2C26B2C2B2K_EXPECTED_TASKS ? [`task_count_${tasks}`] : []), ...(targets !== PHASE2C26B2C2B2K_TARGETS ? [`target_count_${targets}`] : [])]
  const caseId: Phase2C26B2C2B2KDecisionCase = reasons.length > 0 ? 'B2C2B2K_INVALID'
    : measuredTasks < tasks ? 'B2C2B2K_INCOMPLETE'
      : exactTargets.C4C === PHASE2C26B2C2B2K_TARGETS ? 'B2C2B2K_RECOVERED'
        : 'B2C2B2K_MEASURED_NO_EXACT'
  return { case: caseId, reasons, scope: PHASE2C26B2C2B2K_DECISION_RULE.scope, nextPhase: PHASE2C26B2C2B2K_NEXT_PHASE[caseId] }
}

// ---------------------------------------------------------------- the recovery (post hoc, from the per-Target row and the record)

export interface Phase2C26B2C2B2KRecovery {
  recovered: boolean
  /** The smallest capture prefix holding the exact Candidate (C8 / C32 / C4C), or none. */
  policy: Phase2C26B2C2B2KCapturePolicy | 'none'
  hit: Record<Phase2C26B2C2B2KCapturePolicy, boolean>
  exactIndex: number | null
  operationCost: number | null
  oracleOperationCost: number | null
  routeKind: string | null
  sourceKind: string | null
  capturedCount: number | null
  capturedCosts: number[]
  termination: string | null
  searchElapsedMs: number | null
  childWallMs: number | null
  processWallMs: number | null
  peakHeapBytes: number | null
  peakRssBytes: number | null
  yields: number | null
  missClass: string | null
}

export function phase2c26b2c2b2kRecovery(row: Phase2C26B2C2B2KTargetRow | undefined, run: Phase2C26B2C2B2KRun | undefined, childWallMs: number | null): Phase2C26B2C2B2KRecovery {
  const s = searchOf(run)
  const exact = row?.firstExactIndex === null || row?.firstExactIndex === undefined || s === null ? null : s.candidates[row.firstExactIndex] ?? null
  const peak = run ? phase2c26b2c2b2ePeak(run) : null
  return { recovered: row?.recovery !== undefined && row.recovery !== 'none', policy: row?.recovery ?? 'none', hit: row ? { ...row.hit } : { C8: false, C32: false, C4C: false },
    exactIndex: row?.firstExactIndex ?? null, operationCost: row?.firstExactCost ?? null, oracleOperationCost: row?.oracleOperationCost ?? null,
    routeKind: exact?.summary.routeKind ?? null, sourceKind: exact?.summary.sourceKind ?? null, capturedCount: s?.candidates.length ?? null, capturedCosts: s ? [...s.capturedCosts] : [],
    termination: s?.termination ?? null, searchElapsedMs: s?.elapsedMs ?? null, childWallMs, processWallMs: run?.process.wallMs ?? null, peakHeapBytes: peak?.heap ?? null,
    peakRssBytes: peak?.rss ?? null, yields: run?.yields ?? null, missClass: row?.missClass ?? null }
}

// ---------------------------------------------------------------- the E1 aggregate under oracle-guided diagnostic conditions

export const PHASE2C26B2C2B2K_E1_STATEMENT_JA = 'E1 11 Targetすべてについて、oracle-guided target/context/extentおよび各登録execution条件のもとで、existing Searchがexact oracle Routeをdeliverしたevidenceが得られた'

export const PHASE2C26B2C2B2K_E1_DIAGNOSTIC_LIMITATIONS = [
  'The L2 half is oracle-guided: the population, the context (B2-C1 first compatible) and the extent (max(Production default, B2-C2B1 required)) all come from post-hoc oracle evidence, and the L2 Routes recovered by B2-C2B2E and this phase needed 60 minutes / 12 GB. It does not show that Production could choose the context, know the extent or afford the budget in advance.',
  'This phase\'s Target ran on the current main, which holds the adopted B2-C2B2I / B2-C2B2J Production optimizations; the other E1 Targets were recovered in their own phases\' Production states (each registered there). The aggregate is a collection of per-Target evidence under each registered execution condition, not one run.',
  'The registered common ladder evidence (B2-C2B2B common L1 + B2-C2B2C common L2) stays C4C 9 / 11; this aggregate does not turn it into 11 / 11.',
  'It does not show that a Production scheduler finds these Routes (no Planner trial, kernel, full Planner rerun or global assignment ran), nor that the Production default extent does, nor that the Production runtime would be acceptable, nor anything without the oracle.',
  'Unmeasured tasks (timeout / OOM / notRun) are unknown, never Candidate 0.',
] as const

/**
 * The E1 aggregate, post hoc, as two separate statements: the registered common ladder keeps B2-C2B2E's count (unchanged); the
 * oracle-guided diagnostic aggregate is B2-C2B2E's, with this phase's Target - which B2-C2B2E counted as unrecovered (no hit) - replaced
 * by this phase's result. The statement is given only when every E1 Target recovered (C4C), with the limitations.
 */
export function phase2c26b2c2b2kE1Aggregate(input: { facts: Phase2C26B2C2B2KB2C2B2EFacts; row: Phase2C26B2C2B2KTargetRow | undefined; decision: string | null; evidenceGrade: string }) {
  const issues: string[] = []
  const { e1 } = input.facts
  if (PHASE2C26B2C2B2K_CAPTURE_POLICIES.some(p => input.facts.b2c2b2e.hit[p])) issues.push('B2-C2B2E counted this phase\'s Target as recovered')
  if (input.row === undefined) issues.push('no B2-C2B2K Target row')
  const hit = input.row?.hit ?? { C8: false, C32: false, C4C: false }
  const total = Object.fromEntries(PHASE2C26B2C2B2K_CAPTURE_POLICIES.map(p => [p, { recovered: e1.diagnostic[p].recovered + (hit[p] ? 1 : 0), of: e1.e1Total }])) as
    Record<Phase2C26B2C2B2KCapturePolicy, { recovered: number; of: number }>
  const l2 = Object.fromEntries(PHASE2C26B2C2B2K_CAPTURE_POLICIES.map(p => [p, e1.l2[p] + (hit[p] ? 1 : 0)])) as Record<Phase2C26B2C2B2KCapturePolicy, number>
  if (PHASE2C26B2C2B2K_CAPTURE_POLICIES.some(p => total[p].recovered > e1.e1Total || l2[p] > e1.l2Population)) issues.push('the aggregate exceeds its population')
  const allRecovered = issues.length === 0 && input.decision === 'B2C2B2K_RECOVERED' && input.evidenceGrade === 'formal' && total.C4C.recovered === e1.e1Total
    && e1.l1.C4C === e1.l1Population && l2.C4C === e1.l2Population
  return {
    issues,
    e1Total: e1.e1Total,
    commonLadder: { source: 'B2-C2B2B RESULT (common L1) + B2-C2B2C RESULT (common L2), as the B2-C2B2E RESULT carried them; not re-run here', total: structuredClone(e1.commonLadder), statement: null,
      note: 'unchanged by this phase: the registered common ladder evidence stays as B2-C2B2E recorded it' },
    diagnostic: {
      source: 'the B2-C2B2E RESULT\'s oracle-guided diagnostic aggregate (L1 by B2-C2B2B at common L1; L2 by B2-C2B2D and B2-C2B2E at the first compatible context x tight extent), with the B2-C2B2E time-bound Target replaced by this phase (same Search input and execution conditions, current optimized main)',
      previous: structuredClone(e1.diagnostic),
      l1: { population: e1.l1Population, exactTargets: { ...e1.l1 } },
      l2: { population: e1.l2Population, exactTargets: l2, previous: { ...e1.l2 }, fromB2C2B2K: { targets: 1, hit: { ...hit }, decision: input.decision, evidenceGrade: input.evidenceGrade } },
      total, allRecovered,
      statement: allRecovered ? PHASE2C26B2C2B2K_E1_STATEMENT_JA : null,
      statementScope: 'oracle-guided diagnostic only: not "11 / 11 by a Production scheduler", not "11 / 11 at the Production default extent", not an acceptable Production runtime, not "11 / 11 without the oracle", not a finished global Planner',
    },
    limitations: [...PHASE2C26B2C2B2K_E1_DIAGNOSTIC_LIMITATIONS],
  }
}

// ---------------------------------------------------------------- the whole analysis

export interface Phase2C26B2C2B2KAnalysisInput extends Omit<Phase2C26B2C2B2EAnalysisInput, 'conditions' | 'interruption'> {
  facts: Phase2C26B2C2B2KB2C2B2EFacts
  /** The re-derived default context over the B2-C2B2E task row (`phase2c26b2c2b2dRederiveBaselineContext()`), per task ID. */
  b2c2b2eRederivations: ReadonlyMap<string, Phase2C26B2C2B2DBaselineRederivation>
  conditions: { budgetMs: number; childHeapMb: number }
  childWallMs: ReadonlyMap<string, number | null>
}

/**
 * B2-C2B2E's analysis itself over the one task (raw consistency, per-context comparison against the oracle Route, per-Target row, the
 * paired identity with B2-C2B2D's task of the same Target, the trajectory), then this phase's paired comparison with B2-C2B2E, the
 * recovery, the decision input and every invalid reason found here.
 */
export function runPhase2C26B2C2B2KAnalysis(input: Phase2C26B2C2B2KAnalysisInput) {
  const { tasks, runs, smoke, conditions, facts } = input
  const base = runPhase2C26B2C2B2EAnalysis({ ...input, conditions })
  const invalidReasons = base.invalidReasons.map(i => i.startsWith('paired: ') ? `paired_b2c2b2d: ${i.slice('paired: '.length)}` : i)
  if (tasks.length !== PHASE2C26B2C2B2K_EXPECTED_TASKS) invalidReasons.push(`raw: ${tasks.length} tasks, not ${PHASE2C26B2C2B2K_EXPECTED_TASKS}`)
  if (!smoke && (conditions.budgetMs !== PHASE2C26B2C2B2K_BUDGET_MS || conditions.childHeapMb !== PHASE2C26B2C2B2K_CHILD_HEAP_MB)) invalidReasons.push('conditions: the execution budget / heap is not B2-C2B2E\'s 60 minutes / 12,288 MB')
  const runOf = new Map(runs.map(r => [r.taskId, r]))
  const paired = tasks.map((task, index) => {
    const pair = phase2c26b2c2b2kPairedRow(task, runOf.get(task.taskId), base.contexts[index]!, input.excludedRouteKeySha256.get(task.taskId) ?? null, facts,
      input.b2c2b2eRederivations.get(task.taskId) ?? null, conditions)
    if (!smoke) invalidReasons.push(...pair.identity.issues.map(i => `paired_b2c2b2e: ${i}`))
    else invalidReasons.push(...pair.identity.issues.filter(i => !/budget|heap/.test(i)).map(i => `paired_b2c2b2e: ${i}`))
    return pair
  })
  const recoveries = tasks.map(task => ({ taskId: task.taskId, targetWeaponId: task.targetWeaponId,
    recovery: phase2c26b2c2b2kRecovery(base.rows.find(r => r.taskId === task.taskId), runOf.get(task.taskId), input.childWallMs.get(task.taskId) ?? null) }))
  const measuredTasks = runs.filter(run => searchOf(run) !== null).length
  const { paired: pairedB2C2B2D, ...rest } = base
  return { ...rest, invalidReasons, pairedB2C2B2D, paired, recoveries,
    decisionInput: { tasks: tasks.length, targets: new Set(tasks.map(t => t.targetWeaponId)).size, measuredTasks, exactTargets: base.aggregates.exactTargets } }
}

/** `peakOf` for the analyzer's task rows (B2-C2B2E's rule). */
export const phase2c26b2c2b2kPeak = phase2c26b2c2b2ePeak
/** B2-C2B2E's memory log summary (observation only). */
export const phase2c26b2c2b2kTrajectory = phase2c26b2c2b2eTrajectory
export type Phase2C26B2C2B2KMemorySample = Phase2C26B2C2B2EMemorySample
export type Phase2C26B2C2B2KTrajectory = Phase2C26B2C2B2ETrajectory
