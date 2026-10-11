/**
 * Issue #154 D2-D-B post-hoc analysis. Research only. Never import from Production.
 *
 * Re-derives every judgement of a D2-D run from the run dir records (never from the runner's own judgement): RV1 / RV2 / RV3 (K1) /
 * RV5 recomputed from the G store bodies, the baseline Entries and the Export, RV3 (K0) / RV4 / RV6 checked against the registered
 * digest and the CTX record body objects (§6.1); each evaluation's status, `inputDigest` / `resultDigest`, R5 (the D1 analyzer's
 * independent implementation, cross-checked against `judgeD1R5()`), S1 .. S5 and the support expiry cause against the CTX record
 * (§6.2), R6, `pairCoexistence`, the gate, improved and the selection order (§5), every parity check with its four states (§8), the
 * §8.3 known-result diagnostic, the evidence integrity (§9.5) and the decision (§10). It reads no oracle, Phase B analysis or
 * population-authority module (a test walks the import closure); the D2-C / D2 RESULTs are read through the D2-D allowlists only (by
 * `validateD2DInputs()`).
 */
import { hashStableValue, stableStringify } from '../domain/models/hashing'
import { candidateStableKey } from '../domain/search'
import type { BuildListEntry } from '../domain/models/publicTypes'
import { resolveBuildListEntryReplacement } from '../domain/buildList'
import { d1InputDigest, d1ResultDigest, d1B0Parity, isD1BoundLimited, judgeD1R5, D1_CALCULATION_CONTEXT, D1_RESEARCH_MAX_PLAN_STEPS, D1_RNG_ENGINE_VERSION, type D1EvaluationStatus } from './plannerGlobalD1'
import { judgeD1R5Independently } from './plannerGlobalD1Analysis'
import { judgeD2R6, type D2EvaluationFacts, type D2R6Judgement } from './plannerGlobalD2'
import { d2cI0Parity, d2cSupportExpiryCause } from './plannerGlobalD2C'
import {
  compareD2DSelection,
  d2dBetter,
  d2dEvaluatedAgainst,
  d2dReverificationCandidates,
  judgeD2DPairCoexistence,
  D2D_B0_EXPECTED,
  D2D_BUDGETS,
  D2D_CALCULATION_CONTEXT,
  D2D_COMPARISON_BASELINES,
  D2D_E1_LABELS,
  D2D_EVALUATION_FULL_RUN_CAP,
  D2D_I0_EXPECTED,
  D2D_K0_RESERVATION_DIGEST,
  D2D_PAIR_COUNT,
  D2D_RV_UNIT_ID,
  type D2DCandidateRef,
  type D2DDerivedSet,
  type D2DStage,
  type D2DValidatedInputs,
} from './plannerGlobalD2D'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const UNMEASURED_PROCESS = ['timeout', 'out_of_memory', 'process_failure', 'interrupted'] as const
const MEASURED_EVALUATION: readonly string[] = ['evaluated', 'preflight_refused', 'planner_rerun_bound_reached']
const COMPARABLE_EVALUATION: readonly string[] = ['evaluated', 'preflight_refused', 'planner_rerun_bound_reached', 'calculation_error']

export type D2DInvalidCategory = 'input_evidence' | 'provenance' | 'baseline_parity_mismatch' | 'd2c_parity' | 'guardrail' | 'determinism' | 'evidence_integrity' | 'raw_result_mismatch'
export interface D2DInvalidReason { category: D2DInvalidCategory; detail: string }
export type D2DDecisionCase = 'D2D_INVALID' | 'D2D_INCOMPLETE' | 'D2D_GLOBAL_COMPLETE_R' | 'D2D_EXCEEDS_D2C_FINAL' | 'D2D_SET_COEXISTENT_NOT_BETTER' | 'D2D_NO_SET_COEXISTENCE'
export type D2DParityState = 'matched' | 'mismatched' | 'not_checked' | 'not_applicable'

// ---------------------------------------------------------------- the decision (§10)

export interface D2DMetrics { completed: number; conflicts: number; steps: number | null }
type Delta = { subjectEvaluationId: string; completedDelta: number; conflictDelta: number; stepsDelta: number | null; better: boolean; equalMetrics: boolean }

export interface D2DDecisionInput {
  invalidReasons: readonly D2DInvalidReason[]
  /** Registered RV / B0 / I0 / PAIR items that are unmeasured or not executed. */
  unmeasured: readonly string[]
  r5SatisfiedPairs: readonly string[]
  eligiblePairs: readonly string[]
  improvedPairs: readonly string[]
  r5OnlyEligiblePairs: readonly string[]
  equalMetricsPairs: readonly string[]
  conflictIncreasedPairs: readonly string[]
  pairCoexistencePairs: readonly string[]
  pairCoexistentButSetNotCoexistentPairs: readonly string[]
  r6SatisfiedPairs: readonly string[]
  /** The measured PAIRs (evaluated / preflight_refused / planner_rerun_bound_reached). */
  measuredPairs: readonly string[]
  bestEligiblePair: string | null
  bestImprovedPair: string | null
  boundLimitedEvaluations: readonly string[]
  /** The comparison subject: the best eligible PAIR, else I0 (null when neither is measured). */
  subject: { evaluationId: string; metrics: D2DMetrics } | null
  /** The fresh I0 metrics (the D2-C final inside D2-D), or null when unmeasured. */
  i0Metrics: D2DMetrics | null
}

const delta = (subject: { evaluationId: string; metrics: D2DMetrics } | null, b: { completed: number; conflicts: number; steps: number | null } | null): Delta | null => subject === null || b === null ? null
  : { subjectEvaluationId: subject.evaluationId, completedDelta: subject.metrics.completed - b.completed, conflictDelta: subject.metrics.conflicts - b.conflicts,
    stepsDelta: subject.metrics.steps === null || b.steps === null ? null : subject.metrics.steps - b.steps, better: d2dBetter(subject.metrics, b),
    equalMetrics: subject.metrics.completed === b.completed && subject.metrics.conflicts === b.conflicts }

export function classifyD2DDecision(input: D2DDecisionInput) {
  const base = { bestEligiblePair: input.bestEligiblePair, bestImprovedPair: input.bestImprovedPair, r5SatisfiedPairs: [...input.r5SatisfiedPairs], eligiblePairs: [...input.eligiblePairs],
    improvedPairs: [...input.improvedPairs], r5OnlyEligiblePairs: [...input.r5OnlyEligiblePairs], equalMetricsPairs: [...input.equalMetricsPairs], conflictIncreasedPairs: [...input.conflictIncreasedPairs],
    pairCoexistencePairs: [...input.pairCoexistencePairs], pairCoexistentButSetNotCoexistentPairs: [...input.pairCoexistentButSetNotCoexistentPairs],
    boundLimitedEvaluations: [...input.boundLimitedEvaluations], unmeasuredEvaluations: [...input.unmeasured],
    vsBaseline: delta(input.subject, D2D_COMPARISON_BASELINES.baseline), vsD2bMain: delta(input.subject, D2D_COMPARISON_BASELINES.d2bMain), vsD2cFinal: delta(input.subject, input.i0Metrics) }
  const none = { globalCompleteObservedUnderIncomplete: false, exceedsD2cObservedUnderIncomplete: false, setCoexistenceObservedUnderIncomplete: false }
  if (input.invalidReasons.length > 0) {
    return { case: 'D2D_INVALID' as D2DDecisionCase, reasons: input.invalidReasons.map(r => `${r.category}: ${r.detail}`), lowerBound: false, ...base, ...none }
  }
  if (input.unmeasured.length > 0) {
    return { case: 'D2D_INCOMPLETE' as D2DDecisionCase, reasons: [`${input.unmeasured.length} registered item(s) unmeasured or not executed: ${input.unmeasured.join(', ')}; the measured evidence is a lower bound`,
      `measured: R5 ${input.r5SatisfiedPairs.length} PAIR(s), improved ${input.improvedPairs.length}, R6 ${input.r6SatisfiedPairs.length}`], lowerBound: true, ...base,
    globalCompleteObservedUnderIncomplete: input.r6SatisfiedPairs.length > 0, exceedsD2cObservedUnderIncomplete: input.improvedPairs.length > 0, setCoexistenceObservedUnderIncomplete: input.r5SatisfiedPairs.length > 0 }
  }
  const tail = { lowerBound: false, ...base, ...none }
  if (input.r6SatisfiedPairs.length > 0) return { case: 'D2D_GLOBAL_COMPLETE_R' as D2DDecisionCase, reasons: [`R6 satisfied by ${input.r6SatisfiedPairs.join(', ')} (43 / 43, Conflict 0, no resource_conflict, Trace Replay, R5)`], ...tail }
  if (input.improvedPairs.length > 0) {
    return { case: 'D2D_EXCEEDS_D2C_FINAL' as D2DDecisionCase, reasons: [`improved PAIR(s) ${input.improvedPairs.join(', ')}; best ${input.bestImprovedPair} is better than I0 (the fresh D2-C final)`], ...tail }
  }
  if (input.r5SatisfiedPairs.length > 0) {
    return { case: 'D2D_SET_COEXISTENT_NOT_BETTER' as D2DDecisionCase, reasons: [`R5 satisfied by ${input.r5SatisfiedPairs.join(', ')}, none better than I0 (the gate failed, or completed equal with Conflict >= I0)`], ...tail }
  }
  return { case: 'D2D_NO_SET_COEXISTENCE' as D2DDecisionCase, reasons: [`all ${input.measuredPairs.length} PAIRs measured with R5 not satisfied (not a proof that the t05 / t07 collision cannot be resolved otherwise)`,
    ...(input.pairCoexistencePairs.length > 0 ? [`pairCoexistence held without R5 in ${input.pairCoexistencePairs.join(', ')}`] : []),
    ...(input.boundLimitedEvaluations.length > 0 ? [`bound-limited evaluations: ${input.boundLimitedEvaluations.join(', ')}`] : [])], ...tail }
}

// ---------------------------------------------------------------- the run analysis

export interface D2DFileRef { file: string; bytes: number; sha256: string }
export interface D2DRvRow { unitId: string; status: string | null; notExecutedReason: string | null; process: Json | null; recordFile: D2DFileRef | null }
export interface D2DEvaluationRow {
  evaluationId: string
  stage: D2DStage
  evaluatedAgainst: string
  pairOrdinal: number | null
  t05Ordinal: number | null
  t07Ordinal: number | null
  replacementLabels: string[]
  replacementTargets: string[]
  generatedEntryIds: string[]
  generatedEntrySha256s: string[]
  requiresSupport: string[]
  inputDigest: string | null
  registeredInputDigest: string | null
  status: string | null
  notExecutedReason: string | null
  process: Json | null
  recordFile: D2DFileRef | null
  runner: Json | null
}

export interface D2DAnalysisInput {
  validated: D2DValidatedInputs
  exportSha256: string
  /** The Export `buildListEntries` (RV5 / S4 / S1, recomputed independently of the child). */
  exportBuildListEntries: readonly unknown[]
  /** The baseline PlannerInput Entries the analyzer built from the Export (RV2), or null when not built. */
  baselineBuildListEntries: readonly BuildListEntry[] | null
  /** By G store file name: the body read back (null = missing). */
  gStoreBodies: ReadonlyMap<string, { bytes: number; sha256: string; body: unknown } | null>
  rvRow: D2DRvRow | null
  rvRecord: Json | null
  evaluationRows: readonly D2DEvaluationRow[]
  evaluationRecords: ReadonlyMap<string, Json | null>
  /** The run ended without a raw output (interrupted). */
  interrupted: boolean
  runEnvelopeReached: boolean
  abortReason: string | null
  provenanceIssues: readonly string[]
  evidenceIssues: readonly string[]
  rawConsistencyIssues: readonly string[]
  childProcessCount: number | null
  sha256OfText: (text: string) => string
}

type RowStatus = string
function statusFromFiles(process: Json | null, record: Json | null, notExecutedReason: string | null, interrupted: boolean, missingRecord: (detail: string) => void): RowStatus | null {
  if (notExecutedReason !== null) return 'not_executed'
  if (process === null) return interrupted ? 'interrupted' : null
  const outcome = process.outcome
  if (outcome !== 'completed') return (UNMEASURED_PROCESS as readonly unknown[]).includes(outcome) ? outcome as RowStatus : 'process_failure'
  if (record === null || !isObject(record.result) || typeof record.result.status !== 'string') { missingRecord('completed with no readable record'); return null }
  return record.result.status
}
const memoryOf = (record: Json | null, process: Json | null) => {
  const memory = record !== null && isObject(record.memory) ? record.memory : null
  const ipc = process !== null && isObject(process.lastIpcMemory) ? process.lastIpcMemory : null
  const heap = [memory?.sampledMaxHeapUsedBytes, ipc?.maxHeapUsedBytes].filter((v): v is number => typeof v === 'number')
  const rss = [memory?.sampledMaxRssBytes, ipc?.maxRssBytes, typeof memory?.maxRssKiB === 'number' ? memory.maxRssKiB * 1024 : undefined].filter((v): v is number => typeof v === 'number')
  return { peakHeapBytes: heap.length ? Math.max(...heap) : null, peakRssBytes: rss.length ? Math.max(...rss) : null }
}
const recordCalculationIssues = (record: Json): string[] => {
  const issues: string[] = []
  if (!same(record.calculationContext, D1_CALCULATION_CONTEXT)) issues.push('CalculationContext is not the registered one')
  if (record.rngEngineVersion !== D1_RNG_ENGINE_VERSION) issues.push('the RNG Engine version is not production-rng:c5-e7')
  if (record.researchMaxPlanSteps !== D1_RESEARCH_MAX_PLAN_STEPS) issues.push('researchMaxPlanSteps is not 20000')
  return issues
}
const MEASURED_FACT_FIELDS = ['preflight', 'runConflictResolutions', 'fullRunsStarted', 'runtimeUnsupportedRemoved', 'plan', 'conflicts', 'routeCommitment', 'supportChecks', 'steps',
  'resultDigest', 'rejectedBuildListEntries', 'resourceConflictRejections', 'selectedTargetWeaponIds', 'supportStaticChecks', 'supportBodySha256Observed', 'childRecheck'] as const

type DependsOn = { id: string; status: string | null; unmeasuredReason: string | null; notExecutedReason: string | null }
type Facts = D2EvaluationFacts & { supportBodySha256Observed: Record<string, string>; childRecheck: { checked: number; issues: string[] } }

export function analyzeD2DRun(input: D2DAnalysisInput) {
  const invalid: D2DInvalidReason[] = []
  const add = (category: D2DInvalidCategory, detail: string) => invalid.push({ category, detail })
  const v = input.validated
  if (!v.passed) for (const issue of v.issues) add('input_evidence', issue)
  for (const issue of input.provenanceIssues) add('provenance', issue)
  for (const issue of input.evidenceIssues) add('evidence_integrity', issue)
  for (const issue of input.rawConsistencyIssues) add('raw_result_mismatch', issue)
  const sha = input.sha256OfText
  const parityChecks: Json[] = []
  const parity = (check: { checkId: string; kind: string; state: D2DParityState; subjects: string[]; expected: unknown; observed: unknown; mismatches: string[]; notChecked: { dependsOn: DependsOn[] } | null;
    category: D2DInvalidCategory }) => {
    parityChecks.push({ ...check, category: check.state === 'mismatched' ? check.category : null })
    if (check.state === 'mismatched') add(check.category, `${check.checkId}: ${check.mismatches.join('; ')}`)
  }
  const B0X = v.expected?.b0 ?? D2D_B0_EXPECTED
  const I0X = v.expected?.i0 ?? D2D_I0_EXPECTED
  const exportById = new Map<string, Json[]>()
  for (const e of input.exportBuildListEntries) if (isObject(e) && typeof e.id === 'string') exportById.set(e.id, [...(exportById.get(e.id) ?? []), e])
  const derivation = v.derivation
  const ctxByK = new Map(v.contexts.map(c => [c.k, c]))
  const supportCtx = new Map(v.supports.map(s => [s.supportBuildListEntryId, s.contexts[0] ?? null]))

  // ---- RV (§6.1)
  const rvRow = input.rvRow
  const rvRecord = rvRow ? input.rvRecord : null
  if (rvRow === null && !input.interrupted && v.passed) add('evidence_integrity', 'RV: the registered RV has no row')
  if (rvRow !== null && rvRow.unitId !== D2D_RV_UNIT_ID) add('guardrail', `RV row ${rvRow.unitId} is not the registered RV`)
  let rvStatus: string | null = rvRow === null ? 'not_executed' : statusFromFiles(rvRow.process, rvRecord, rvRow.notExecutedReason, input.interrupted, d => add('evidence_integrity', `RV: ${d}`))
  if (rvRow !== null && rvRow.status !== rvStatus) add('raw_result_mismatch', `RV: the row status ${rvRow.status} is not the record status ${rvStatus}`)
  if (rvRecord !== null && rvStatus !== 'not_executed') for (const issue of recordCalculationIssues(rvRecord)) add('guardrail', `RV: ${issue}`)
  const rvResult = rvRecord !== null && isObject(rvRecord.result) ? rvRecord.result : null
  const rvCandidates: Json[] = []
  const rvSupports: Json[] = []
  const rvRefs = derivation === null ? [] : d2dReverificationCandidates(derivation)
  const rvMeasured = rvStatus === 'verified' || rvStatus === 'guardrail_violation'
  if (rvMeasured && rvResult !== null) {
    if (rvStatus === 'guardrail_violation') add('guardrail', `RV: ${JSON.stringify(rvResult.issues ?? [])}`)
    const recCands = Array.isArray(rvResult.candidates) ? rvResult.candidates as Json[] : null
    const recSups = Array.isArray(rvResult.supports) ? rvResult.supports as Json[] : null
    if (recCands === null || recSups === null || recCands.length !== rvRefs.length || recSups.length !== v.supports.length) { add('evidence_integrity', 'RV: the record lacks the 12 candidates / 3 supports'); rvStatus = null }
    else {
      if (!isObject(rvResult.baseline) || rvResult.baseline.conflictResolutions !== 0) add('guardrail', 'RV: G1 - the baseline PlannerInput carried a conflict resolution')
      rvRefs.forEach((ref, i) => {
        const rec = recCands[i]!
        const at = `RV ${ref.label} c${ref.ordinal}`
        if (rec.label !== ref.label || rec.ordinal !== ref.ordinal || rec.origin !== ref.origin || rec.generatedBuildListEntryId !== ref.generatedBuildListEntryId) { add('raw_result_mismatch', `${at}: the record candidate is not the registered one`); return }
        const stored = input.gStoreBodies.get(ref.file) ?? null
        const body = stored !== null && isObject(stored.body) ? stored.body as unknown as BuildListEntry : null
        let keySha: string | null
        try { keySha = body === null ? null : sha(candidateStableKey(body.candidateSnapshot)) } catch { keySha = null }
        const RV1 = { bodySha256Matched: stored !== null && stored.sha256 === ref.sha256 && stored.bytes === ref.bytes && isObject(rec.generatedEntry) && rec.generatedEntry.sha256Observed === ref.sha256,
          idMatched: body?.id === ref.generatedBuildListEntryId, targetMatched: body?.targetWeaponId === ref.targetWeaponId, calculationContextMatched: body !== null && same(body.calculationContext, D2D_CALCULATION_CONTEXT),
          notStale: body?.isStale === false, searchRunIdMatched: body !== null && isObject(body.candidateSnapshot) && body.candidateSnapshot.searchRunId === ref.searchIdentity, keySha256Matched: keySha === ref.keySha256 }
        if (!same(RV1, rec.RV1)) add('raw_result_mismatch', `${at}: the recorded RV1 is not the recomputed one`)
        let RV2: Json = { status: 'not_recomputed', replacedBuildListEntryId: null, satisfied: null }
        if (input.baselineBuildListEntries !== null && body !== null) {
          const r = resolveBuildListEntryReplacement(input.baselineBuildListEntries, body)
          RV2 = r.status === 'ready' ? { status: 'ready', replacedBuildListEntryId: r.replacement.replacedBuildListEntryId, satisfied: r.replacement.replacedBuildListEntryId === ref.currentBuildListEntryId }
            : { status: r.status, replacedBuildListEntryId: null, satisfied: false }
          if (!same(RV2, rec.RV2)) add('raw_result_mismatch', `${at}: the recorded RV2 is not the recomputed one`)
        }
        const rv3Issues: string[] = []
        const rec3 = isObject(rec.RV3) ? rec.RV3 : {}
        if (ref.origin === 'd2b_k0') {
          if (rec3.reservationSource !== 'k0_empty' || rec3.reservationDigest !== D2D_K0_RESERVATION_DIGEST) rv3Issues.push('the K0 Search reservation is not the registered empty reservation')
        } else {
          const ctx = ctxByK.get(ref.contextK ?? -1) ?? null
          if (ctx === null || rec3.reservationSource !== 'ctx_record' || rec3.reservationDigest !== ctx.reservationDigest || hashStableValue(ctx.reservationBody) !== ctx.reservationDigest
            || ref.poolReservationDigest !== ctx.reservationDigest || ref.poolContextRecordSha256 !== ctx.recordSha256) rv3Issues.push('the K1 Search reservation is not the CTX record one')
        }
        if ((rec3.matched === true) !== (rv3Issues.length === 0)) add('raw_result_mismatch', `${at}: the recorded RV3 is not the recomputed one`)
        const rec4 = isObject(rec.RV4) ? rec.RV4 : {}
        const rv4 = rec4.respects === true && isObject(rec4.blockedHits) && Object.values(rec4.blockedHits).every(h => Array.isArray(h) && h.length === 0) && Array.isArray(rec4.exclusiveHit) && rec4.exclusiveHit.length === 0
        const satisfied = Object.values(RV1).every(Boolean) && RV2.satisfied !== false && rv3Issues.length === 0 && rv4
        if (!satisfied) add('guardrail', `${at}: RV1 .. RV4 do not hold (${[...Object.entries(RV1).filter(([, x]) => !x).map(([k]) => k), ...(RV2.satisfied === false ? ['RV2'] : []), ...rv3Issues, ...(rv4 ? [] : ['RV4'])].join(', ')})`)
        if (rec.satisfied !== satisfied) add('raw_result_mismatch', `${at}: the recorded satisfied is not the recomputed one`)
        rvCandidates.push({ label: ref.label, ordinal: ref.ordinal, origin: ref.origin, contextId: ref.contextId, generatedBuildListEntryId: ref.generatedBuildListEntryId,
          generatedEntry: { file: `${ref.runDir}/${ref.file}`, bytes: ref.bytes, sha256: ref.sha256 }, RV1, RV2,
          RV3: { reservationSource: ref.origin === 'd2b_k0' ? 'k0_empty' : 'ctx_record', reservationDigest: rec3.reservationDigest ?? null, matched: rv3Issues.length === 0 },
          RV4: { respects: rec4.respects === true, blockedHits: rec4.blockedHits ?? null, exclusiveHit: rec4.exclusiveHit ?? null }, satisfied })
      })
      v.supports.forEach((s, i) => {
        const rec = recSups[i]!
        const at = `RV ${s.supportBuildListEntryId}`
        if (rec.supportBuildListEntryId !== s.supportBuildListEntryId) { add('raw_result_mismatch', `${at}: the record support is not the registered one`); return }
        const bodies = exportById.get(s.supportBuildListEntryId) ?? []
        const observed = bodies.length === 1 ? sha(stableStringify(bodies[0])) : null
        const RV5 = { expected: s.contexts.map(c => c.supportBodySha256), observed, matched: observed !== null && s.contexts.length > 0 && s.contexts.every(c => c.supportBodySha256 === observed) }
        const rec5 = isObject(rec.RV5) ? rec.RV5 : {}
        if (rec5.observed !== RV5.observed || (rec5.matched === true) !== RV5.matched) add('raw_result_mismatch', `${at}: the recorded RV5 is not the recomputed one`)
        const rec6 = isObject(rec.RV6) ? rec.RV6 : {}
        const bodyObserved = isObject(rec6.bodyObserved) ? rec6.bodyObserved : null
        const digestMatched = typeof rec6.digestObserved === 'string' && s.contexts.length > 0 && s.contexts.every(c => c.reservationDigest === rec6.digestObserved)
          && bodyObserved !== null && hashStableValue(bodyObserved) === rec6.digestObserved
        const bodyMatched = bodyObserved !== null && s.contexts.length > 0 && s.contexts.every(c => stableStringify(c.reservationBody) === stableStringify(bodyObserved))
        if ((rec6.digestMatched === true) !== digestMatched || (rec6.bodyMatched === true) !== bodyMatched) add('raw_result_mismatch', `${at}: the recorded RV6 is not the recomputed comparison`)
        if (!RV5.matched || !digestMatched || !bodyMatched) add('guardrail', `${at}: RV5 / RV6 do not hold`)
        rvSupports.push({ supportBuildListEntryId: s.supportBuildListEntryId, contextRecords: s.contexts.map(c => `CTX-${c.k}`), RV5,
          RV6: { digestExpected: s.contexts.map(c => c.reservationDigest), digestObserved: rec6.digestObserved ?? null, digestMatched, bodyMatched, satisfied: digestMatched && bodyMatched } })
      })
    }
  }
  const rvSatisfied = rvMeasured && rvCandidates.length === rvRefs.length && rvCandidates.every(c => c.satisfied === true) && rvSupports.length === v.supports.length
    && rvSupports.every(s => (s.RV5 as Json).matched === true && (s.RV6 as Json).satisfied === true)
  const rvUnmeasuredReason = rvStatus === null || rvMeasured || rvStatus === 'not_executed' ? null : rvStatus
  // d2c_context parity: the 4 CTX records against the RV6 derived values (§8.1).
  for (const c of v.contexts) {
    const sup = rvSupports.find(s => s.supportBuildListEntryId === c.supportBuildListEntryId) ?? null
    const rec = isObject(rvResult) && Array.isArray(rvResult.supports) ? (rvResult.supports as Json[]).find(s => s.supportBuildListEntryId === c.supportBuildListEntryId) ?? null : null
    const rec6 = rec !== null && isObject(rec.RV6) ? rec.RV6 : null
    let state: D2DParityState
    const mismatches: string[] = []
    if (!rvMeasured || sup === null || rec6 === null) state = 'not_checked'
    else {
      if (rec6.digestObserved !== c.reservationDigest) mismatches.push('reservationDigest')
      if (!isObject(rec6.bodyObserved) || stableStringify(rec6.bodyObserved) !== stableStringify(c.reservationBody)) mismatches.push('reservationBody')
      state = mismatches.length === 0 ? 'matched' : 'mismatched'
    }
    parity({ checkId: `d2c_context:CTX-${c.k}`, kind: 'd2c_context', state, subjects: ['RV', `CTX-${c.k}`], expected: { reservationDigest: c.reservationDigest }, observed: rec6 === null ? null : { reservationDigest: rec6.digestObserved },
      mismatches, notChecked: state === 'not_checked' ? { dependsOn: [{ id: 'RV', status: rvStatus, unmeasuredReason: rvUnmeasuredReason, notExecutedReason: rvRow?.notExecutedReason ?? (rvRow === null ? 'interrupted' : null) }] } : null,
      category: 'd2c_parity' })
  }

  // ---- evaluations: replay the registered order (B0, I0, PAIR 1 .. 6)
  const rows = [...input.evaluationRows]
  const evaluations: Json[] = []
  if (new Set(rows.map(r => r.evaluationId)).size !== rows.length) add('guardrail', 'an evaluation repeats')
  let b0Facts: Facts | null = null
  let i0Facts: Facts | null = null

  const evaluateRow = (spec: { evaluationId: string; stage: D2DStage; pairOrdinal: number | null; t05Ordinal: number | null; t07Ordinal: number | null; set: D2DDerivedSet | null }) => {
    const row = rows.shift() ?? null
    if (row !== null && row.evaluationId !== spec.evaluationId) { add('guardrail', `evaluation row ${row.evaluationId} is not the registered next evaluation ${spec.evaluationId}`); rows.unshift(row) }
    const own = row !== null && row.evaluationId === spec.evaluationId ? row : null
    if (own === null && !input.interrupted && v.passed) add('evidence_integrity', `${spec.evaluationId}: the registered evaluation has no row`)
    const record = own ? input.evaluationRecords.get(spec.evaluationId) ?? null : null
    const status: string | null = own === null ? 'not_executed' : statusFromFiles(own.process, record, own.notExecutedReason, input.interrupted, d => add('evidence_integrity', `${spec.evaluationId}: ${d}`))
    const notExecutedReason = own === null ? (input.interrupted ? 'interrupted' : 'missing_row') : own.notExecutedReason
    if (own !== null && own.status !== status) add('raw_result_mismatch', `${spec.evaluationId}: the row status ${own.status} is not the record status ${status}`)
    const reps: D2DCandidateRef[] = spec.set?.replacements ?? []
    const replacementTargets = reps.map(r => r.targetWeaponId)
    const generatedIds = reps.map(r => r.generatedBuildListEntryId)
    const shas = reps.map(r => r.sha256)
    const support = [...new Set(reps.flatMap(r => r.requiresSupport))].sort(compare)
    const evaluatedAgainst = d2dEvaluatedAgainst(spec.stage)
    const replayedInputDigest = d1InputDigest(replacementTargets, generatedIds, shas, input.exportSha256)
    if (spec.set !== null && replayedInputDigest !== spec.set.inputDigest) add('guardrail', `${spec.evaluationId}: the replayed inputDigest is not the derived one`)
    if (own !== null && (own.stage !== spec.stage || own.evaluatedAgainst !== evaluatedAgainst || own.pairOrdinal !== spec.pairOrdinal || own.t05Ordinal !== spec.t05Ordinal || own.t07Ordinal !== spec.t07Ordinal
      || !same(own.replacementTargets, replacementTargets) || !same(own.generatedEntryIds, generatedIds) || !same(own.generatedEntrySha256s, shas) || !same(own.requiresSupport, support))) {
      add('raw_result_mismatch', `${spec.evaluationId}: the row inputs are not the replayed inputs`)
    }
    const executedRow = own !== null && own.process !== null
    if (executedRow && own.inputDigest !== replayedInputDigest) add('raw_result_mismatch', `${spec.evaluationId}: the runner inputDigest differs from the recomputed one`)
    const result = record !== null && isObject(record.result) ? record.result : null
    if (record !== null && status !== 'not_executed') for (const issue of recordCalculationIssues(record)) add('guardrail', `${spec.evaluationId}: ${issue}`)
    const childInputDigest = record !== null && typeof record.inputDigest === 'string' ? record.inputDigest : null
    if (record !== null && status !== 'not_executed' && childInputDigest !== replayedInputDigest) add('raw_result_mismatch', `${spec.evaluationId}: the child inputDigest differs from the recomputed one`)
    if (status === 'guardrail_violation') add('guardrail', `${spec.evaluationId}: ${JSON.stringify(result?.issues ?? [])}`)
    const measuredRun = status !== null && MEASURED_EVALUATION.includes(status)
    let facts: Facts | null = null
    if (measuredRun && result !== null) {
      const missing = MEASURED_FACT_FIELDS.filter(f => !(f in result))
      if (missing.length > 0) add('evidence_integrity', `${spec.evaluationId}: the measured record lacks ${missing.join(', ')}`)
      else facts = result as unknown as Facts
    }
    if (status === 'calculation_error' && (result === null || !isObject(result.error))) add('evidence_integrity', `${spec.evaluationId}: a calculation error record without the error`)
    if (facts !== null && facts.runConflictResolutions !== 0) add('guardrail', `${spec.evaluationId}: G1 - the run received a conflict resolution`)
    if (facts !== null && facts.fullRunsStarted > D2D_EVALUATION_FULL_RUN_CAP) add('guardrail', `${spec.evaluationId}: ${facts.fullRunsStarted} full runs, above 8`)
    if (facts !== null && (facts.childRecheck.checked !== reps.length || facts.childRecheck.issues.length !== 0)) add('guardrail', `${spec.evaluationId}: the child RV1 / RV2 recheck did not cover every G`)
    const resultDigest = facts !== null ? d1ResultDigest(facts) : null
    if (facts !== null && facts.resultDigest !== resultDigest) add('raw_result_mismatch', `${spec.evaluationId}: resultDigest differs from the recomputed one`)
    // S1 .. S5 (§6.2), against the CTX record independently of the child.
    const selected = new Set(facts?.plan.selectedBuildListEntryIds ?? [])
    const removed = new Set(facts?.runtimeUnsupportedRemoved ?? [])
    const supportChecksByEntry: Json = {}
    for (const id of support) {
      const ctx = supportCtx.get(id) ?? null
      if (facts === null) { supportChecksByEntry[id] = { contextId: ctx === null ? null : ctx.contextId, S1: null, S2: null, S3: null, S4: null, S5: null, selected: null, supportExpiryCause: null }; continue }
      const c = isObject(facts.supportStaticChecks) ? facts.supportStaticChecks[id] : undefined
      const dynamic = facts.supportChecks[id]
      if (c === undefined || !isObject(c.S5) || dynamic === undefined || ctx === null) { add('evidence_integrity', `${spec.evaluationId}: no static S4 / S5 or dynamic record of the support Entry ${id}, or no CTX record`); continue }
      const exportBody = (exportById.get(id) ?? [])[0]
      const exportSha = exportBody === undefined ? null : sha(stableStringify(exportBody))
      const s4 = c.S4 === true && facts.supportBodySha256Observed?.[id] === ctx.supportBodySha256 && exportSha === ctx.supportBodySha256
      if (!s4) add('guardrail', `${spec.evaluationId}: S4 of the support Entry ${id} does not hold against the CTX record`)
      if (c.S5.digestExpected !== ctx.reservationDigest || !same(c.S5.bodyExpected, ctx.reservationBody) || !isObject(c.S5.bodyExpected)) add('guardrail', `${spec.evaluationId}: S5 compared against a reservation that is not the CTX record digest / body`)
      const s5 = c.S5.digestMatched === true && c.S5.bodyMatched === true && c.S5.satisfied === true && c.S5.digestObserved === c.S5.digestExpected && same(c.S5.bodyObserved, c.S5.bodyExpected)
      if (!s5) add('guardrail', `${spec.evaluationId}: S5 of the support Entry ${id} does not hold`)
      if (dynamic.S4 !== c.S4 || dynamic.S5 !== c.S5.satisfied) add('raw_result_mismatch', `${spec.evaluationId}: supportChecks S4 / S5 are not the static checks`)
      const supportTarget = exportBody !== undefined && typeof exportBody.targetWeaponId === 'string' ? exportBody.targetWeaponId : null
      if (dynamic.S1 !== (supportTarget !== null && !replacementTargets.includes(supportTarget))) add('raw_result_mismatch', `${spec.evaluationId}: S1 of ${id} is not the recomputed one`)
      const isSelected = facts.plan.present ? selected.has(id) : null
      supportChecksByEntry[id] = { contextId: ctx.contextId, S1: dynamic.S1, S2: dynamic.S2, S3: dynamic.S3, S4: s4,
        S5: { digestExpected: c.S5.digestExpected, digestObserved: c.S5.digestObserved, digestMatched: c.S5.digestMatched, bodyExpected: structuredClone(c.S5.bodyExpected), bodyObserved: structuredClone(c.S5.bodyObserved),
          bodyMatched: c.S5.bodyMatched, satisfied: s5 },
        selected: isSelected, supportExpiryCause: d2cSupportExpiryCause({ S1: dynamic.S1, S2: dynamic.S2, S3: dynamic.S3, S4: s4, S5: s5 }, isSelected, removed.has(id)) }
    }
    if (facts !== null) {
      const rejected = Array.isArray(facts.rejectedBuildListEntries) ? facts.rejectedBuildListEntries : []
      if (facts.resourceConflictRejections !== rejected.filter(r => r.reason === 'resource_conflict').length) add('raw_result_mismatch', `${spec.evaluationId}: resourceConflictRejections is not the recount`)
    }
    // R5 (independent, cross-checked), R6
    const r5Status = (status ?? 'process_failure') as D1EvaluationStatus
    const r5 = judgeD1R5Independently({ status: r5Status as never, evaluatedAgainst: evaluatedAgainst as never, generatedBuildListEntryIds: generatedIds, requiresSupport: support, facts })
    if (facts !== null && !same(judgeD1R5({ status: r5Status, evaluatedAgainst: evaluatedAgainst as never, generatedBuildListEntryIds: generatedIds, requiresSupport: support, facts }), r5)) add('raw_result_mismatch', `${spec.evaluationId}: the two R5 implementations disagree`)
    const r6: D2R6Judgement = judgeD2R6({ status: status ?? 'process_failure', evaluatedAgainst, facts, r5Satisfied: r5.satisfied })
    if (own?.runner && isObject(own.runner) && own.runner.r5 !== undefined && !same(own.runner.r5, r5)) add('raw_result_mismatch', `${spec.evaluationId}: the runner R5 differs from the analyzer R5`)
    const M = new Set([...generatedIds, ...support])
    const conflicts = (facts?.conflicts ?? []).map(x => ({ id: x.id, kind: x.kind, participants: [...x.participants], resourceIdentity: x.resourceIdentity, selectedBuildListEntryId: x.selectedBuildListEntryId,
      withinSet: x.participants.filter(id => M.has(id)).length >= 2 }))
    const candidates = reps.map(r => {
      const commitment = (facts?.routeCommitment ?? []).find(x => x.buildListEntryId === r.generatedBuildListEntryId) ?? null
      const isSel = facts?.plan.present ? selected.has(r.generatedBuildListEntryId) : null
      return { label: r.label, ordinal: r.ordinal, origin: r.origin, contextId: r.contextId, targetWeaponId: r.targetWeaponId, generatedBuildListEntryId: r.generatedBuildListEntryId, selected: isSel,
        winnerBuildListEntryId: isSel === false ? commitment?.provisionalOutcomeSelectedBuildListEntryId ?? null : null, commitmentStatus: commitment?.status ?? null,
        targetSelected: facts === null ? null : facts.selectedTargetWeaponIds.includes(r.targetWeaponId), requiresSupport: [...r.requiresSupport] }
    })
    const diff = (other: Facts | null) => {
      if (facts === null || other === null) return null
      return { completedDelta: (facts.plan.termination?.completedTargetCount ?? 0) - (other.plan.termination?.completedTargetCount ?? 0), conflictDelta: facts.conflicts.length - other.conflicts.length,
        stepsDelta: facts.plan.steps === null || other.plan.steps === null ? null : facts.plan.steps - other.plan.steps,
        targetsGained: facts.selectedTargetWeaponIds.filter(id => !other.selectedTargetWeaponIds.includes(id)).sort(compare),
        targetsLost: other.selectedTargetWeaponIds.filter(id => !facts.selectedTargetWeaponIds.includes(id)).sort(compare) }
    }
    const baselineDiff = spec.stage === 'B0' ? null : diff(b0Facts)
    const refDiff = spec.stage === 'PAIR' ? diff(i0Facts) : null
    const referenceDiff = refDiff === null ? null : { referenceEvaluationId: 'I0', ...refDiff }
    let pair: Json | null = null
    if (spec.stage === 'PAIR') {
      const t05 = reps.find(r => r.label === D2D_E1_LABELS.t05), t07 = reps.find(r => r.label === D2D_E1_LABELS.t07)
      if (!t05 || !t07) add('guardrail', `${spec.evaluationId}: the PAIR does not hold t05 and t07`)
      else {
        pair = judgeD2DPairCoexistence({ t05: t05.generatedBuildListEntryId, t07: t07.generatedBuildListEntryId, t05Target: t05.targetWeaponId, t07Target: t07.targetWeaponId, members: [...M],
          selected: facts?.plan.present ? facts.plan.selectedBuildListEntryIds : null, selectedTargets: facts === null ? null : facts.selectedTargetWeaponIds, routeCommitment: facts?.routeCommitment ?? [],
          conflicts, d2cT05ResourceIdentities: v.d2cT05ResourceIdentities }) as unknown as Json
      }
    }
    const completed = facts?.plan.termination?.completedTargetCount ?? null
    const i0Completed = i0Facts?.plan.termination?.completedTargetCount ?? null
    const gateJudged = spec.stage === 'PAIR' && facts !== null && i0Facts !== null
    const gate = gateJudged ? { judged: true, referenceCompleted: i0Completed, proposedCompleted: completed, satisfied: completed !== null && i0Completed !== null && completed >= i0Completed }
      : { judged: false, referenceCompleted: spec.stage === 'PAIR' ? i0Completed : null, proposedCompleted: null, satisfied: null }
    const eligible = spec.stage === 'PAIR' && status === 'evaluated' && r5.satisfied === true && gate.satisfied === true
    const r5OnlyEligible = spec.stage === 'PAIR' && status === 'evaluated' && r5.satisfied === true && gate.satisfied !== true
    const metrics = facts !== null && facts.plan.termination !== null ? { completed: facts.plan.termination.completedTargetCount, conflicts: facts.conflicts.length } : null
    const i0m = i0Facts !== null && i0Facts.plan.termination !== null ? { completed: i0Facts.plan.termination.completedTargetCount, conflicts: i0Facts.conflicts.length } : null
    const improved = eligible && metrics !== null && i0m !== null && d2dBetter(metrics, i0m)
    const equalMetrics = eligible && metrics !== null && i0m !== null && metrics.completed === i0m.completed && metrics.conflicts === i0m.conflicts
    const conflictIncreased = eligible && metrics !== null && i0m !== null && metrics.completed === i0m.completed && metrics.conflicts > i0m.conflicts
    // determinism_prior (§8.2): the allowlisted D2 / D2-C evaluations holding the same inputDigest.
    const prior = v.priorByInputDigest[replayedInputDigest] ?? []
    const comparable = status !== null && COMPARABLE_EVALUATION.includes(status)
    let priorParity: Json
    if (prior.length === 0) priorParity = { state: 'not_applicable', matchedPriorEvaluationIds: [], resultDigestsEqual: null, notChecked: null }
    else {
      const mismatches = comparable ? prior.filter(x => x.status !== status || x.resultDigest !== resultDigest).map(x => `${x.source} ${x.evaluationId}: ${x.status} / ${x.resultDigest} vs ${status} / ${resultDigest}`) : []
      const state: D2DParityState = !comparable ? 'not_checked' : mismatches.length === 0 ? 'matched' : 'mismatched'
      const dependsOn = [{ id: spec.evaluationId, status, unmeasuredReason: status === null || MEASURED_EVALUATION.includes(status) || status === 'not_executed' ? null : status, notExecutedReason: status === 'not_executed' ? notExecutedReason : null }]
      priorParity = { state, matchedPriorEvaluationIds: state === 'matched' ? prior.map(x => `${x.source}:${x.evaluationId}`) : [], resultDigestsEqual: comparable ? mismatches.length === 0 : null,
        notChecked: state === 'not_checked' ? { dependsOn } : null }
      parity({ checkId: `determinism_prior:${spec.evaluationId}`, kind: 'determinism_prior', state, subjects: [spec.evaluationId, ...prior.map(x => `${x.source}:${x.evaluationId}`)], expected: prior,
        observed: { status, resultDigest }, mismatches, notChecked: state === 'not_checked' ? { dependsOn } : null, category: 'determinism' })
    }
    const unmeasuredReason = status === null || MEASURED_EVALUATION.includes(status) || status === 'not_executed' || status === 'guardrail_violation' ? null : status
    const e: Json = {
      evaluationId: spec.evaluationId, stage: spec.stage, ordinal: evaluations.length, evaluatedAgainst, pairOrdinal: spec.pairOrdinal, t05Ordinal: spec.t05Ordinal, t07Ordinal: spec.t07Ordinal,
      replacementTargets, replacementTargetLabels: reps.map(r => r.label), generatedEntryIds: generatedIds, generatedEntrySha256s: shas, requiresSupport: support,
      status, unmeasuredReason, notExecutedReason: status === 'not_executed' ? notExecutedReason : null, process: own?.process ?? null,
      inputDigest: executedRow ? replayedInputDigest : null, replayedInputDigest, childInputDigest, registeredInputDigest: spec.set?.registeredInputDigest ?? (spec.stage === 'B0' ? B0X.inputDigest : null),
      inputDigestMatched: spec.set === null ? replayedInputDigest === B0X.inputDigest : replayedInputDigest === spec.set.registeredInputDigest, resultDigest,
      fullRunsStarted: facts?.fullRunsStarted ?? null, runtimeUnsupportedRemoved: facts?.runtimeUnsupportedRemoved ?? [],
      preflight: facts ? { status: facts.preflight.status, refusal: facts.preflight.refusal } : null,
      plan: facts ? { present: facts.plan.present, termination: facts.plan.termination, steps: facts.plan.steps, selectedBuildListEntryIds: facts.plan.selectedBuildListEntryIds, warningKinds: facts.plan.warningKinds } : null,
      conflicts, routeCommitment: facts?.routeCommitment ?? [], candidates, r5, r6,
      rejectedBuildListEntries: facts?.rejectedBuildListEntries ?? [], resourceConflictRejections: facts?.resourceConflictRejections ?? null, selectedTargetWeaponIds: facts?.selectedTargetWeaponIds ?? [],
      supportChecksByEntry, childRecheck: facts?.childRecheck ?? null, parity: null, baselineDiff, referenceDiff, pair, gate, r5OnlyEligible, eligible, improved, equalMetrics, conflictIncreased, priorParity,
      boundLimited: isD1BoundLimited(r5Status, facts), errorDetail: status === 'calculation_error' && result && isObject(result.error) ? result.error : null,
      wallMs: typeof own?.process?.wallMs === 'number' ? own.process.wallMs : null, childWallMs: record !== null && typeof record.wallMs === 'number' ? record.wallMs : null, ...memoryOf(record, own?.process ?? null),
    }
    evaluations.push(e)
    return { e, status, facts, r5Satisfied: r5.satisfied }
  }
  const isMeasured = (s: unknown) => typeof s === 'string' && MEASURED_EVALUATION.includes(s)

  // B0
  const b0 = evaluateRow({ evaluationId: 'B0', stage: 'B0', pairOrdinal: null, t05Ordinal: null, t07Ordinal: null, set: null })
  if (b0.status === 'evaluated' && b0.facts !== null) b0Facts = b0.facts
  {
    const comparable = b0.status !== null && COMPARABLE_EVALUATION.includes(b0.status)
    let state: D2DParityState = 'not_checked', mismatches: string[] = []
    if (comparable) {
      const p = d1B0Parity(b0.facts?.baselineSummary ?? null, v.phase2c2BaselineSummary)
      const t = b0.facts?.plan.termination ?? null
      mismatches = [...p.mismatches.map(m => `Phase 2-C2 ${m}`), ...(b0.status !== 'evaluated' ? [`status ${b0.status}`] : []),
        ...(b0.e.resultDigest !== B0X.resultDigest ? ['resultDigest'] : []), ...(b0.e.replayedInputDigest !== B0X.inputDigest ? ['inputDigest'] : []),
        ...(t?.status !== B0X.termination ? ['termination'] : []), ...(t?.completedTargetCount !== B0X.completed || t?.totalTargetCount !== B0X.totalTargetCount ? ['completed / total'] : []),
        ...(b0.facts?.conflicts.length !== B0X.conflicts ? ['Conflicts'] : []), ...(b0.facts?.plan.steps !== B0X.steps ? ['steps'] : [])]
      state = mismatches.length === 0 ? 'matched' : 'mismatched'
    }
    b0.e.parity = { kind: 'baseline', state, mismatches }
    parity({ checkId: 'baseline:B0', kind: 'baseline', state, subjects: ['B0', 'D2-C:B0', 'D2:B0', 'Phase2C2:baseline.summary'], expected: { ...B0X },
      observed: { status: b0.status, inputDigest: b0.e.replayedInputDigest, resultDigest: b0.e.resultDigest }, mismatches,
      notChecked: state === 'not_checked' ? { dependsOn: [{ id: 'B0', status: b0.status, unmeasuredReason: b0.e.unmeasuredReason as string | null, notExecutedReason: b0.e.notExecutedReason as string | null }] } : null,
      category: 'baseline_parity_mismatch' })
  }
  // I0
  const i0 = evaluateRow({ evaluationId: 'I0', stage: 'I0', pairOrdinal: null, t05Ordinal: null, t07Ordinal: null, set: derivation?.i0 ?? null })
  {
    const comparable = i0.status !== null && COMPARABLE_EVALUATION.includes(i0.status)
    let state: D2DParityState = 'not_checked', mismatches: string[] = []
    if (comparable) {
      const t = i0.facts?.plan.termination ?? null
      mismatches = d2cI0Parity({ evaluationId: I0X.evaluationId, inputDigest: I0X.inputDigest, resultDigest: I0X.resultDigest, completed: I0X.completed,
        totalTargetCount: I0X.totalTargetCount, conflicts: I0X.conflicts, steps: I0X.steps, termination: I0X.termination },
      { status: i0.status, inputDigest: i0.e.replayedInputDigest as string | null, resultDigest: i0.e.resultDigest as string | null, termination: t?.status ?? null, completed: t?.completedTargetCount ?? null,
        totalTargetCount: t?.totalTargetCount ?? null, conflicts: i0.facts ? i0.facts.conflicts.length : null, steps: i0.facts?.plan.steps ?? null, r5Satisfied: i0.r5Satisfied })
      state = mismatches.length === 0 ? 'matched' : 'mismatched'
    }
    i0.e.parity = { kind: 'd2c_final', state, mismatches }
    parity({ checkId: 'd2c_final:I0', kind: 'd2c_final', state, subjects: ['I0', `D2-C:${I0X.evaluationId}`], expected: { ...I0X },
      observed: { status: i0.status, inputDigest: i0.e.replayedInputDigest, resultDigest: i0.e.resultDigest }, mismatches,
      notChecked: state === 'not_checked' ? { dependsOn: [{ id: 'I0', status: i0.status, unmeasuredReason: i0.e.unmeasuredReason as string | null, notExecutedReason: i0.e.notExecutedReason as string | null }] } : null,
      category: 'd2c_parity' })
  }
  const i0Measured = i0.status === 'evaluated' && i0.facts !== null
  if (i0Measured) i0Facts = i0.facts
  // PAIR 1 .. 6
  const pairs = derivation?.pairs ?? []
  const pairEvals: Json[] = []
  for (let k = 0; k < D2D_PAIR_COUNT; k += 1) {
    const set = pairs[k] ?? null
    const id = set?.evaluationId ?? `PAIR-${k + 1}`
    const r = evaluateRow({ evaluationId: id, stage: 'PAIR', pairOrdinal: k + 1, t05Ordinal: set?.t05Ordinal ?? null, t07Ordinal: set?.t07Ordinal ?? null, set })
    if (!i0Measured && rvSatisfied && r.status !== 'not_executed') add('raw_result_mismatch', `${id}: a PAIR after an unmeasured I0 must be not_executed (i0_unmeasured)`)
    // registered_input (§8.1): the child-recorded inputDigest against the §3.2 registered one.
    const executed = r.e.process !== null && r.e.childInputDigest !== null
    const mismatches = executed && set !== null && r.e.childInputDigest !== set.registeredInputDigest ? [`${String(r.e.childInputDigest)} is not ${set.registeredInputDigest}`] : []
    const state: D2DParityState = !executed || set === null ? 'not_checked' : mismatches.length === 0 ? 'matched' : 'mismatched'
    parity({ checkId: `registered_input:${id}`, kind: 'registered_input', state, subjects: [id], expected: set?.registeredInputDigest ?? null, observed: r.e.childInputDigest, mismatches,
      notChecked: state === 'not_checked' ? { dependsOn: [{ id, status: r.status, unmeasuredReason: r.e.unmeasuredReason as string | null, notExecutedReason: r.e.notExecutedReason as string | null }] } : null,
      category: 'guardrail' })
    pairEvals.push(r.e)
  }
  for (const extra of rows) add('guardrail', `evaluation row ${extra.evaluationId} is beyond the registered evaluations`)

  // ---- budgets and the process count
  const startedEvals = evaluations.filter(e => e.process !== null).length
  const startedRv = rvRow !== null && rvRow.process !== null ? 1 : 0
  if (evaluations.length > D2D_BUDGETS.evaluationRequestsMax || startedEvals > D2D_BUDGETS.evaluationRequestsMax) add('guardrail', 'more evaluations than the registered 8')
  if (startedRv + startedEvals > D2D_BUDGETS.childProcessesMax) add('guardrail', 'more child processes than the registered 9')
  if (input.childProcessCount !== null && input.childProcessCount !== startedRv + startedEvals) add('guardrail', `${input.childProcessCount} child processes, not the ${startedRv + startedEvals} started items`)
  const allRows = [{ notExecutedReason: rvStatus === 'not_executed' ? rvRow?.notExecutedReason ?? null : null }, ...evaluations]
  if (allRows.some(x => x.notExecutedReason === 'run_envelope_reached') && !input.runEnvelopeReached) add('raw_result_mismatch', 'run_envelope_reached rows without a reached run envelope')
  const abortedRows = allRows.filter(x => x.notExecutedReason === 'aborted_after_invalid')
  if (!rvMeasured && rvRow !== null && rvRow.notExecutedReason === null && rvStatus !== null && v.passed) {
    for (const e of evaluations) if (e.status !== 'not_executed' || e.notExecutedReason !== 'rv_unmeasured') add('raw_result_mismatch', `${String(e.evaluationId)}: an evaluation after an unmeasured RV must be not_executed (rv_unmeasured)`)
  }

  // ---- determinism within D2-D (§8.2)
  const groups = new Map<string, Json[]>()
  for (const e of evaluations) if (typeof e.replayedInputDigest === 'string') groups.set(e.replayedInputDigest, [...(groups.get(e.replayedInputDigest) ?? []), e])
  const determinismCrossChecks: Json[] = []
  for (const [digest, list] of groups) {
    const comparable = list.filter(e => COMPARABLE_EVALUATION.includes(String(e.status)))
    const prior = v.priorByInputDigest[digest] ?? []
    if (list.length >= 2) {
      add('guardrail', `inputDigest ${digest} is held by ${list.length} D2-D evaluations (the registration holds none)`)
      const others = list.filter(e => !comparable.includes(e))
      let state: D2DParityState
      if (comparable.length >= 2) state = new Set(comparable.map(e => `${e.status}|${e.resultDigest}`)).size === 1 ? 'matched' : 'mismatched'
      else state = others.length > 0 ? 'not_checked' : 'not_applicable'
      parity({ checkId: `determinism_d2d:${digest}`, kind: 'determinism_d2d', state, subjects: list.map(e => String(e.evaluationId)), expected: null,
        observed: comparable.map(e => ({ id: e.evaluationId, status: e.status, resultDigest: e.resultDigest })), mismatches: state === 'mismatched' ? ['the comparable evaluations differ in status / resultDigest'] : [],
        notChecked: state === 'not_checked' ? { dependsOn: others.map(e => ({ id: String(e.evaluationId), status: e.status as string | null, unmeasuredReason: e.unmeasuredReason as string | null, notExecutedReason: e.notExecutedReason as string | null })) } : null,
        category: 'determinism' })
    }
    determinismCrossChecks.push({ inputDigest: digest, evaluationIds: list.map(e => String(e.evaluationId)), priorEvaluationIds: prior.map(x => `${x.source}:${x.evaluationId}`),
      comparableEvaluationIds: comparable.map(e => String(e.evaluationId)), state: list.length >= 2 ? 'checked_within_d2d' : prior.length > 0 ? (list[0]!.priorParity as Json).state : 'not_applicable',
      resultDigestsEqual: prior.length > 0 ? (list[0]!.priorParity as Json).resultDigestsEqual : null })
  }
  if (abortedRows.length > 0 && invalid.length === 0) add('raw_result_mismatch', `${abortedRows.length} row(s) aborted_after_invalid without an INVALID reason`)
  if (input.abortReason !== null && invalid.length === 0) add('raw_result_mismatch', `the runner aborted (${input.abortReason}) without an INVALID reason`)
  for (const check of parityChecks.filter(c => c.state === 'not_checked')) {
    const deps = isObject(check.notChecked) && Array.isArray(check.notChecked.dependsOn) ? check.notChecked.dependsOn as Json[] : []
    if (deps.length === 0 || deps.some(d => d.status === 'evaluated' || d.status === 'verified')) add('evidence_integrity', `${check.checkId}: not_checked without an unmeasured dependency`)
  }

  // ---- §8.3 known D2-C results (diagnostic)
  const skill = new Set(v.d2cT05ResourceIdentities)
  const failureKinds = (reasons: readonly string[]) => reasons.map(r => r.split(':')[0]!).sort(compare)
  const d2cKnownComparison = ([[1, 'CMP-t05-c1'], [4, 'CMP-t05-c2']] as const).map(([pairOrdinal, d2cId]) => {
    const e = pairEvals[pairOrdinal - 1] ?? null
    const known = v.knownD2C.find(x => x.evaluationId === d2cId) ?? null
    const plan = e && isObject(e.plan) ? e.plan : null
    const t = plan && isObject(plan.termination) ? plan.termination : null
    const r5 = e && isObject(e.r5) ? e.r5 : null
    const t07 = e && Array.isArray(e.candidates) ? (e.candidates as Json[]).find(c => c.label === D2D_E1_LABELS.t07) ?? null : null
    const d2d = e === null || t === null ? null : { completed: t.completedTargetCount as number, conflicts: (e.conflicts as unknown[]).length, steps: plan!.steps as number | null, r5Satisfied: r5?.satisfied ?? null,
      failureReasons: [...((r5?.failureReasons as string[] | undefined) ?? [])], t07Selected: (t07?.selected ?? null) as boolean | null,
      skill485Conflict: (e.conflicts as Json[]).some(c => typeof c.resourceIdentity === 'string' && skill.has(c.resourceIdentity)) }
    const d2c = known === null ? null : { completed: known.completed, conflicts: known.conflicts, steps: known.steps, r5Satisfied: known.r5Satisfied, failureReasons: [...known.failureReasons],
      t07Selected: known.t07Selected, skill485Conflict: known.withinSetResourceIdentities.some(r => skill.has(r)) }
    const sameStructuralOutcome = d2d === null || d2c === null ? null : d2d.r5Satisfied === d2c.r5Satisfied && same(failureKinds(d2d.failureReasons), failureKinds(d2c.failureReasons))
      && d2d.t07Selected === d2c.t07Selected && d2d.skill485Conflict === d2c.skill485Conflict
    return { pairEvaluationId: pairs[pairOrdinal - 1]?.evaluationId ?? null, d2cEvaluationId: d2cId, setDifference: known?.setDifference ?? null, d2d, d2c, sameStructuralOutcome }
  })

  // ---- PAIR ranking, comparison, aggregates and the decision
  const metricsOf = (e: Json | null): D2DMetrics | null => {
    if (e === null) return null
    const plan = e.plan as Json | null
    const t = plan && isObject(plan.termination) ? plan.termination : null
    return t ? { completed: Number(t.completedTargetCount), conflicts: (e.conflicts as unknown[]).length, steps: plan!.steps as number | null } : null
  }
  const ids = (pred: (e: Json) => boolean) => pairEvals.filter(pred).map(e => String(e.evaluationId))
  const eligibleMetrics = pairEvals.filter(e => e.eligible === true).map(e => ({ evaluationId: String(e.evaluationId), pairOrdinal: Number(e.pairOrdinal), ...metricsOf(e)!, steps: Number((e.plan as Json).steps) }))
  const order = [...eligibleMetrics].sort(compareD2DSelection)
  const improvedSet = new Set(ids(e => e.improved === true))
  const bestEligiblePair = order[0]?.evaluationId ?? null
  const bestImprovedPair = order.find(x => improvedSet.has(x.evaluationId))?.evaluationId ?? null
  const ranking = pairEvals.map(e => {
    const m = metricsOf(e)
    const rank = order.findIndex(x => x.evaluationId === e.evaluationId)
    return { pairOrdinal: e.pairOrdinal, evaluationId: e.evaluationId, eligible: e.eligible, improved: e.improved, completed: m?.completed ?? null, conflicts: m?.conflicts ?? null, steps: m?.steps ?? null,
      rank: rank < 0 ? null : rank + 1 }
  })
  const i0Json = i0Measured ? i0.e : null
  const subjectEval = bestEligiblePair === null ? i0Json : pairEvals.find(e => e.evaluationId === bestEligiblePair) ?? null
  const subjectMetrics = metricsOf(subjectEval)
  const unmeasured = [
    ...(rvMeasured ? [] : [D2D_RV_UNIT_ID]),
    ...evaluations.filter(e => !isMeasured(e.status) && e.status !== 'guardrail_violation').map(e => String(e.evaluationId)),
  ]
  const boundLimitedEvaluations = evaluations.filter(e => e.boundLimited === true).map(e => String(e.evaluationId))
  const pc = (e: Json) => isObject(e.pair) && e.pair.pairCoexistence === true
  const decision = classifyD2DDecision({ invalidReasons: invalid, unmeasured,
    r5SatisfiedPairs: ids(e => (e.r5 as Json).satisfied === true), eligiblePairs: ids(e => e.eligible === true), improvedPairs: ids(e => e.improved === true),
    r5OnlyEligiblePairs: ids(e => e.r5OnlyEligible === true), equalMetricsPairs: ids(e => e.equalMetrics === true), conflictIncreasedPairs: ids(e => e.conflictIncreased === true),
    pairCoexistencePairs: ids(pc), pairCoexistentButSetNotCoexistentPairs: ids(e => pc(e) && (e.r5 as Json).satisfied !== true), r6SatisfiedPairs: ids(e => (e.r6 as Json).satisfied === true),
    measuredPairs: ids(e => isMeasured(e.status)), bestEligiblePair, bestImprovedPair, boundLimitedEvaluations,
    subject: subjectEval === null || subjectMetrics === null ? null : { evaluationId: String(subjectEval.evaluationId), metrics: subjectMetrics }, i0Metrics: metricsOf(i0Json) })
  const comparison = {
    vsBaseline: decision.vsBaseline, vsD2bMain: decision.vsD2bMain, vsD2cFinal: decision.vsD2cFinal,
    byPair: pairEvals.map(e => ({ evaluationId: e.evaluationId, vsI0: e.referenceDiff === null ? null : { completedDelta: (e.referenceDiff as Json).completedDelta, conflictDelta: (e.referenceDiff as Json).conflictDelta,
      stepsDelta: (e.referenceDiff as Json).stepsDelta, targetsGained: (e.referenceDiff as Json).targetsGained, targetsLost: (e.referenceDiff as Json).targetsLost },
      pairCoexistence: isObject(e.pair) ? e.pair.pairCoexistence : null, r5Satisfied: (e.r5 as Json).satisfied, improved: e.improved })),
  }
  const countBy = <T,>(list: readonly T[], key: (x: T) => string | null) => list.reduce<Record<string, number>>((acc, x) => { const k = key(x); if (k !== null) acc[k] = (acc[k] ?? 0) + 1; return acc }, {})
  const judgedR5 = evaluations.filter(e => (e.r5 as Json).judged === true)
  const r6Judged = evaluations.filter(e => (e.r6 as Json).judged === true)
  const r6Satisfied = r6Judged.filter(e => (e.r6 as Json).satisfied === true)
  const pcJudged = pairEvals.filter(e => isObject(e.pair) && e.pair.pairCoexistence !== null)
  const supportCauses = evaluations.flatMap(e => Object.values(e.supportChecksByEntry as Json)).filter(isObject).map(s => s.supportExpiryCause).filter((x): x is string => typeof x === 'string')
  const aggregates = {
    evaluations: { registeredMax: D2D_BUDGETS.evaluationRequestsMax, executed: startedEvals, registered: evaluations.length, measured: evaluations.filter(e => isMeasured(e.status)).length,
      unmeasuredByReason: countBy(evaluations.filter(e => !isMeasured(e.status) && e.status !== 'not_executed' && e.status !== 'guardrail_violation'), e => String(e.status)),
      notExecutedByReason: countBy(evaluations.filter(e => e.status === 'not_executed'), e => String(e.notExecutedReason)), byStage: countBy(evaluations, e => String(e.stage)), byStatus: countBy(evaluations, e => String(e.status)) },
    childProcesses: { registeredMax: D2D_BUDGETS.childProcessesMax, started: startedRv + startedEvals },
    fullPlannerRunsStarted: evaluations.reduce((s, e) => s + (typeof e.fullRunsStarted === 'number' ? e.fullRunsStarted : 0), 0),
    runtimeUnsupportedRetries: evaluations.reduce((s, e) => s + (e.runtimeUnsupportedRemoved as unknown[]).length, 0),
    r5: { judged: judgedR5.length, satisfied: judgedR5.filter(e => (e.r5 as Json).satisfied === true).length },
    pairCoexistence: { judged: pcJudged.length, satisfied: pcJudged.filter(pc).length },
    r6: { judged: r6Judged.length, satisfied: r6Satisfied.length, satisfiedEvaluationIds: r6Satisfied.map(e => String(e.evaluationId)) },
    boundLimitedEvaluations,
    supportOutcomes: { notSelected: supportCauses.filter(c => c === 'support_not_selected').length, expiredByCause: countBy(supportCauses.filter(c => c !== 'support_not_selected'), c => c) },
    determinismCrossChecks,
    parity: { byKindAndState: countBy(parityChecks, c => `${c.kind}:${c.state}`), mismatched: parityChecks.filter(c => c.state === 'mismatched').map(c => c.checkId),
      notChecked: parityChecks.filter(c => c.state === 'not_checked').map(c => ({ checkId: c.checkId, dependsOn: isObject(c.notChecked) ? c.notChecked.dependsOn : [] })) },
  }
  const rv = { status: rvStatus, unmeasuredReason: rvUnmeasuredReason, notExecutedReason: rvStatus === 'not_executed' ? (rvRow?.notExecutedReason ?? 'interrupted') : null, process: rvRow?.process ?? null,
    record: rvRow?.recordFile ?? null, candidates: rvCandidates, supports: rvSupports, satisfied: rvSatisfied, wallMs: typeof rvRow?.process?.wallMs === 'number' ? rvRow.process.wallMs : null,
    ...memoryOf(rvRecord, rvRow?.process ?? null) }
  return { rv, evaluations, parityChecks, d2cKnownComparison, pairs: { ranking, bestEligiblePair, bestImprovedPair }, comparison, aggregates, invalidReasons: invalid, decision, unmeasured }
}

