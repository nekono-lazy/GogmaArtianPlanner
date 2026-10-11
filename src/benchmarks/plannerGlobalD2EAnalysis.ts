/**
 * Issue #154 D2-E-B post-hoc analysis. Research only. Never import from Production.
 *
 * Re-derives every judgement of a D2-E run from the run dir records (never from the runner's own judgement): RV1 .. RV6 (§7.1)
 * against the registered values and the CTX record bodies, the `k1_context` parity; CTX-K2 C1 / C3 / C4 / C6 recomputed from the
 * Export and the K1 CTX records, C5 / C7 re-checked, the `k2_context_registered` parity (§4.1); the DSC rung progression, every
 * delivery action (D-1 / D-2 / D-4 / D-5), R0-K2 / R0-split, the pool and the G store files (§4.2 - §4.6); each evaluation's
 * status, `inputDigest` / `resultDigest`, R1 (ADM), S1 .. S6 against the S5 authority / CTX-K2 records, R5 (the D1 analyzer's
 * independent implementation, cross-checked), the EXT diagnostics, the gate, improved, `improvementKind`, the selection order and
 * R6 (§5 - §7); every parity check with its four states (§9); the evidence integrity (§10.5) and the decision (§11). It reads no
 * oracle, Phase B analysis or population-authority module, no Phase 2-C2.5-D2-D / D2-E module (a test walks the import closure); the
 * D2-D / D2-C / D2 RESULTs are read through the D2-E allowlists only (by `validateD2EInputs()`).
 */
import { resolveBuildListEntryReplacement } from '../domain/buildList'
import { collectReferencedOwnedWeaponIds, hashStableValue, stableStringify } from '../domain/models/hashing'
import type { BuildListEntry } from '../domain/models/publicTypes'
import { candidateStableKey } from '../domain/search'
import { d1B0Parity, d1InputDigest, d1ResultDigest, isD1BoundLimited, judgeD1R5, D1_CALCULATION_CONTEXT, D1_RESEARCH_MAX_PLAN_STEPS, D1_RNG_ENGINE_VERSION, type D1EvaluationStatus } from './plannerGlobalD1'
import { judgeD1R5Independently } from './plannerGlobalD1Analysis'
import { d2DiscoveryUnitOutcome, d2R1R4, judgeD2R6, type D2EvaluationStatus, type D2R6Judgement } from './plannerGlobalD2'
import { d2cSupportExpiryCause } from './plannerGlobalD2C'
import {
  compareD2ESelection,
  d2eBetter,
  d2eContextId,
  d2eDiscoveryNext,
  d2eDiscoveryOutcome,
  d2eDiscoveryUnitId,
  d2eEvaluatedAgainst,
  d2eImprovementKind,
  d2ePoolFileName,
  d2eReservationContains,
  d2eReservationUnion,
  d2eRungExtent,
  readD2EK2ContextRecord,
  D2E_B0_EXPECTED,
  D2E_BUDGETS,
  D2E_CALCULATION_CONTEXT,
  D2E_COMPARISON_BASELINES,
  D2E_CONTEXT_UNIT_ID,
  D2E_DELIVERIES_PER_UNIT_MAX,
  D2E_DISCOVERY_MEASURED,
  D2E_EVALUATION_FULL_RUN_CAP,
  D2E_GENERATED_ENTRY_PREFIX,
  D2E_I0_EXPECTED,
  D2E_K0_RESERVATION_DIGEST,
  D2E_K2_POOL_CAP,
  D2E_K2_RESERVATION_DIGEST,
  D2E_LADDER,
  D2E_ORIGIN_DIGEST,
  D2E_RV_UNIT_ID,
  type D2ECandidateRef,
  type D2ED2CContextRow,
  type D2EDiscoveryStop,
  type D2EDiscoveryUnitStatus,
  type D2EEvaluationFacts,
  type D2EStage,
  type D2EValidatedInputs,
} from './plannerGlobalD2E'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const sortedIds = (ids: readonly string[]) => [...ids].sort(compare)
const UNMEASURED_PROCESS = ['timeout', 'out_of_memory', 'process_failure', 'interrupted'] as const
const MEASURED_EVALUATION: readonly string[] = ['evaluated', 'preflight_refused', 'planner_rerun_bound_reached', 'not_run_reused_existing']
const COMPARABLE_EVALUATION: readonly string[] = ['evaluated', 'preflight_refused', 'planner_rerun_bound_reached', 'calculation_error']

export type D2EInvalidCategory = 'input_evidence' | 'provenance' | 'baseline_parity_mismatch' | 'd2d_parity' | 'k1_context_parity' | 'k2_context_parity' | 'guardrail' | 'determinism'
  | 'evidence_integrity' | 'raw_result_mismatch'
export interface D2EInvalidReason { category: D2EInvalidCategory; detail: string }
export type D2EDecisionCase = 'D2E_INVALID' | 'D2E_INCOMPLETE' | 'D2E_GLOBAL_COMPLETE_R' | 'D2E_EXCEEDS_D2D_BEST' | 'D2E_SET_COEXISTENT_NOT_BETTER' | 'D2E_NO_SET_COEXISTENCE'
  | 'D2E_NO_ADMITTED_K2_CANDIDATE' | 'D2E_NO_K2_CANDIDATE'
export type D2EParityState = 'matched' | 'mismatched' | 'not_checked' | 'not_applicable'

// ---------------------------------------------------------------- the decision (§11)

export interface D2EMetrics { completed: number; conflicts: number; steps: number | null }
type Delta = { subjectEvaluationId: string; completedDelta: number; conflictDelta: number; stepsDelta: number | null; better: boolean; equalMetrics: boolean }

export interface D2EDecisionInput {
  invalidReasons: readonly D2EInvalidReason[]
  /** Registered RV / B0 / I0 / CTX / DSC / ADM / EXT items that are unmeasured or not executed. */
  unmeasured: readonly string[]
  discoveryOutcome: 'cap_reached' | 'ladder_exhausted' | 'discovery_exhausted' | 'unmeasured'
  pooledCandidates: number
  admittedCandidates: number
  /** The measured ADM evaluations (all R1 false is NO_ADMITTED). */
  measuredAdmissions: number
  r5SatisfiedExtensions: readonly string[]
  eligibleExtensions: readonly string[]
  improvedExtensions: readonly string[]
  r5OnlyEligibleExtensions: readonly string[]
  equalMetricsExtensions: readonly string[]
  conflictIncreasedExtensions: readonly string[]
  t03SelectedExtensions: readonly string[]
  t03CompletedWithoutNetGainExtensions: readonly string[]
  incumbentRegressedExtensions: readonly string[]
  r6SatisfiedExtensions: readonly string[]
  /** The measured EXT evaluations (evaluated / preflight_refused / planner_rerun_bound_reached). */
  measuredExtensions: readonly string[]
  bestEligibleExtension: string | null
  bestImprovedExtension: string | null
  improvementKind: 'completed_increase' | 'conflict_decrease_only' | null
  boundLimitedEvaluations: readonly string[]
  /** The comparison subject: the best eligible EXT, else I0 (null when neither is measured). */
  subject: { evaluationId: string; metrics: D2EMetrics } | null
  /** The fresh I0 metrics (the D2-D best inside D2-E), or null when unmeasured. */
  i0Metrics: D2EMetrics | null
}

const delta = (subject: { evaluationId: string; metrics: D2EMetrics } | null, b: { completed: number; conflicts: number; steps: number | null } | null): Delta | null => subject === null || b === null ? null
  : { subjectEvaluationId: subject.evaluationId, completedDelta: subject.metrics.completed - b.completed, conflictDelta: subject.metrics.conflicts - b.conflicts,
    stepsDelta: subject.metrics.steps === null || b.steps === null ? null : subject.metrics.steps - b.steps, better: d2eBetter(subject.metrics, b),
    equalMetrics: subject.metrics.completed === b.completed && subject.metrics.conflicts === b.conflicts }

/** §11.2, top to bottom (INVALID -> INCOMPLETE -> improvement -> no improvement). */
export function classifyD2EDecision(input: D2EDecisionInput) {
  const base = { bestEligibleExtension: input.bestEligibleExtension, bestImprovedExtension: input.bestImprovedExtension, improvementKind: input.improvementKind, discoveryOutcome: input.discoveryOutcome,
    pooledCandidates: input.pooledCandidates, admittedCandidates: input.admittedCandidates, r5SatisfiedExtensions: [...input.r5SatisfiedExtensions], eligibleExtensions: [...input.eligibleExtensions],
    improvedExtensions: [...input.improvedExtensions], r5OnlyEligibleExtensions: [...input.r5OnlyEligibleExtensions], equalMetricsExtensions: [...input.equalMetricsExtensions],
    conflictIncreasedExtensions: [...input.conflictIncreasedExtensions], t03SelectedExtensions: [...input.t03SelectedExtensions], t03CompletedWithoutNetGainExtensions: [...input.t03CompletedWithoutNetGainExtensions],
    incumbentRegressedExtensions: [...input.incumbentRegressedExtensions], boundLimitedEvaluations: [...input.boundLimitedEvaluations], unmeasuredEvaluations: [...input.unmeasured],
    vsBaseline: delta(input.subject, D2E_COMPARISON_BASELINES.baseline), vsD2cFinal: delta(input.subject, D2E_COMPARISON_BASELINES.d2cFinal), vsD2dBest: delta(input.subject, input.i0Metrics) }
  const none = { globalCompleteObservedUnderIncomplete: false, exceedsD2dObservedUnderIncomplete: false, setCoexistenceObservedUnderIncomplete: false, k2CandidateObservedUnderIncomplete: false }
  if (input.invalidReasons.length > 0) return { case: 'D2E_INVALID' as D2EDecisionCase, reasons: input.invalidReasons.map(r => `${r.category}: ${r.detail}`), lowerBound: false, ...base, ...none }
  if (input.unmeasured.length > 0) {
    return { case: 'D2E_INCOMPLETE' as D2EDecisionCase, reasons: [`${input.unmeasured.length} registered item(s) unmeasured or not executed: ${input.unmeasured.join(', ')}; the measured evidence is a lower bound`,
      `measured: pool ${input.pooledCandidates}, admitted ${input.admittedCandidates}, R5 ${input.r5SatisfiedExtensions.length} EXT, improved ${input.improvedExtensions.length}, R6 ${input.r6SatisfiedExtensions.length}`],
    lowerBound: true, ...base, globalCompleteObservedUnderIncomplete: input.r6SatisfiedExtensions.length > 0, exceedsD2dObservedUnderIncomplete: input.improvedExtensions.length > 0,
    setCoexistenceObservedUnderIncomplete: input.r5SatisfiedExtensions.length > 0, k2CandidateObservedUnderIncomplete: input.pooledCandidates > 0 }
  }
  const tail = { lowerBound: false, ...base, ...none }
  if (input.r6SatisfiedExtensions.length > 0) return { case: 'D2E_GLOBAL_COMPLETE_R' as D2EDecisionCase, reasons: [`R6 satisfied by ${input.r6SatisfiedExtensions.join(', ')} (43 / 43, Conflict 0, no resource_conflict, Trace Replay, R5)`], ...tail }
  if (input.improvedExtensions.length > 0) {
    return { case: 'D2E_EXCEEDS_D2D_BEST' as D2EDecisionCase, reasons: [`improved EXT ${input.improvedExtensions.join(', ')}; best ${input.bestImprovedExtension} (${input.improvementKind}) is better than I0 (the fresh D2-D best)`], ...tail }
  }
  if (input.r5SatisfiedExtensions.length > 0) {
    return { case: 'D2E_SET_COEXISTENT_NOT_BETTER' as D2EDecisionCase, reasons: [`R5 satisfied by ${input.r5SatisfiedExtensions.join(', ')}, none better than I0 (the gate failed, or completed equal with Conflict >= I0)`], ...tail }
  }
  if (input.measuredExtensions.length > 0) {
    return { case: 'D2E_NO_SET_COEXISTENCE' as D2EDecisionCase, reasons: [`all ${input.measuredExtensions.length} EXT measured with R5 not satisfied (not a proof that no other Candidate, support, extent or composition resolves it)`,
      ...(input.t03SelectedExtensions.length > 0 ? [`t03 selected without R5 in ${input.t03SelectedExtensions.join(', ')}`] : []),
      ...(input.boundLimitedEvaluations.length > 0 ? [`bound-limited evaluations: ${input.boundLimitedEvaluations.join(', ')}`] : [])], ...tail }
  }
  if (input.pooledCandidates > 0 && input.admittedCandidates === 0 && input.measuredAdmissions === input.pooledCandidates) {
    return { case: 'D2E_NO_ADMITTED_K2_CANDIDATE' as D2EDecisionCase, reasons: [`${input.pooledCandidates} K2 Candidate(s) pooled, none satisfied R1 on the baseline`], ...tail }
  }
  if (input.pooledCandidates === 0 && (input.discoveryOutcome === 'ladder_exhausted' || input.discoveryOutcome === 'discovery_exhausted')) {
    return { case: 'D2E_NO_K2_CANDIDATE' as D2EDecisionCase, reasons: [`the K2 context Search delivered no new Candidate up to L2 (${input.discoveryOutcome}; not a proof that no Candidate exists)`], ...tail }
  }
  return { case: 'D2E_INVALID' as D2EDecisionCase, reasons: ['raw_result_mismatch: no registered decision case applies to the measured evidence'], ...tail }
}

// ---------------------------------------------------------------- the run analysis

export interface D2EFileRef { file: string; bytes: number; sha256: string }
export interface D2ERvRow { unitId: string; status: string | null; notExecutedReason: string | null; process: Json | null; recordFile: D2EFileRef | null }
export interface D2EContextRow { unitId: string; contextId: string; status: string | null; notExecutedReason: string | null; process: Json | null; recordFile: D2EFileRef | null }
export interface D2EDiscoveryRow { unitId: string; contextId: string; rung: string; status: string | null; notExecutedReason: string | null; process: Json | null; recordFile: D2EFileRef | null }
export interface D2EEvaluationRow {
  evaluationId: string
  stage: D2EStage
  evaluatedAgainst: string
  ordinal: number | null
  replacementTargets: string[]
  generatedEntryIds: string[]
  generatedEntrySha256s: string[]
  requiresSupport: string[]
  inputDigest: string | null
  registeredInputDigest: string | null
  status: string | null
  notExecutedReason: string | null
  process: Json | null
  recordFile: D2EFileRef | null
  runner: Json | null
}

export interface D2EAnalysisInput {
  validated: D2EValidatedInputs
  exportSha256: string
  /** The Export `buildListEntries` (RV5 / C1 / C3 / C4 / S4, recomputed independently of the children). */
  exportBuildListEntries: readonly unknown[]
  /** The baseline PlannerInput Entries the analyzer built from the Export (RV2), or null when not built. */
  baselineBuildListEntries: readonly BuildListEntry[] | null
  /** The Planner-start origin digest the analyzer recomputed from the Export (C4), or null when not recomputed. */
  recomputedOriginDigest: string | null
  /** The D2-C RESULT context rows (RV3: the K1 Search-time context digest / record SHA-256). */
  d2cContexts: readonly D2ED2CContextRow[]
  /** By incumbent G store file name: the body read back (null = missing). */
  incumbentBodies: ReadonlyMap<string, { bytes: number; sha256: string; body: unknown } | null>
  rvRow: D2ERvRow | null
  rvRecord: Json | null
  contextRow: D2EContextRow | null
  contextRecord: Json | null
  discoveryRows: readonly D2EDiscoveryRow[]
  discoveryRecords: ReadonlyMap<string, Json | null>
  /** By K2 G store file name: the file read back (null = missing). */
  poolFiles: ReadonlyMap<string, { bytes: number; sha256: string; body: unknown } | null>
  evaluationRows: readonly D2EEvaluationRow[]
  evaluationRecords: ReadonlyMap<string, Json | null>
  /** The run ended without a raw output (interrupted). */
  interrupted: boolean
  discoveryEnvelopeReached: boolean
  runEnvelopeReached: boolean
  abortReason: string | null
  provenanceIssues: readonly string[]
  evidenceIssues: readonly string[]
  rawConsistencyIssues: readonly string[]
  childProcessCount: number | null
  sha256OfText: (text: string) => string
}

function statusFromFiles(process: Json | null, record: Json | null, notExecutedReason: string | null, interrupted: boolean, missingRecord: (detail: string) => void): string | null {
  if (notExecutedReason !== null) return 'not_executed'
  if (process === null) return interrupted ? 'interrupted' : null
  const outcome = process.outcome
  if (outcome !== 'completed') return (UNMEASURED_PROCESS as readonly unknown[]).includes(outcome) ? outcome as string : 'process_failure'
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
  'resultDigest', 'rejectedBuildListEntries', 'resourceConflictRejections', 'selectedTargetWeaponIds', 'supportStaticChecks', 'supportBodySha256Observed', 'childRecheck', 'replacementReservationChecks'] as const

type DependsOn = { id: string; status: string | null; unmeasuredReason: string | null; notExecutedReason: string | null }
type Facts = D2EEvaluationFacts

/** A pooled K2 Candidate as the analyzer replays it (§4.7). */
export interface D2EPoolCandidate {
  ordinal: number
  unitId: string
  rung: string
  indexInContext: number
  indexInUnit: number
  candidateStableKey: string
  keySha256: string
  cost: number
  routeKind: string
  routeOperationCount: number
  r0K2: boolean
  r0Split: Record<string, boolean>
  searchIdentity: string
  reservationDigest: string
  contextRecordSha256: string | null
  requiresSupport: string[]
  generatedBuildListEntryId: string
  reusedExisting: boolean
  generatedEntry: { file: string; bytes: number; sha256: string } | null
  replacement: { status: string; replacedBuildListEntryId: string | null }
}

interface EvalRef { label: string; targetWeaponId: string; currentBuildListEntryId: string; generatedBuildListEntryId: string; sha256: string; requiresSupport: string[]; contextId: string | null; kind: 'k0' | 'k1' | 'k2'; ordinal: number }

export function analyzeD2ERun(input: D2EAnalysisInput) {
  const invalid: D2EInvalidReason[] = []
  const add = (category: D2EInvalidCategory, detail: string) => invalid.push({ category, detail })
  const v = input.validated
  if (!v.passed) for (const issue of v.issues) add('input_evidence', issue)
  for (const issue of input.provenanceIssues) add('provenance', issue)
  for (const issue of input.evidenceIssues) add('evidence_integrity', issue)
  for (const issue of input.rawConsistencyIssues) add('raw_result_mismatch', issue)
  const sha = input.sha256OfText
  const parityChecks: Json[] = []
  const parity = (check: { checkId: string; kind: string; state: D2EParityState; subjects: string[]; expected: unknown; observed: unknown; mismatches: string[]; notChecked: { dependsOn: DependsOn[] } | null;
    category: D2EInvalidCategory }) => {
    parityChecks.push({ ...check, category: check.state === 'mismatched' ? check.category : null })
    if (check.state === 'mismatched') add(check.category, `${check.checkId}: ${check.mismatches.join('; ')}`)
  }
  const exportById = new Map<string, Json[]>()
  for (const e of input.exportBuildListEntries) if (isObject(e) && typeof e.id === 'string') exportById.set(e.id, [...(exportById.get(e.id) ?? []), e])
  const k2 = v.k2
  const i0Refs = v.i0?.replacements ?? []
  const authority = new Map(v.supports.map(s => [s.supportBuildListEntryId, s.contexts[0] ?? null]))
  const notExecutedOf = (row: { notExecutedReason: string | null } | null) => row?.notExecutedReason ?? (row === null ? 'interrupted' : null)

  // ---- RV (§7.1)
  const rvRow = input.rvRow
  const rvRecord = rvRow ? input.rvRecord : null
  if (rvRow === null && !input.interrupted && v.passed) add('evidence_integrity', 'RV: the registered RV has no row')
  if (rvRow !== null && rvRow.unitId !== D2E_RV_UNIT_ID) add('guardrail', `RV row ${rvRow.unitId} is not the registered RV`)
  let rvStatus: string | null = rvRow === null ? 'not_executed' : statusFromFiles(rvRow.process, rvRecord, rvRow.notExecutedReason, input.interrupted, d => add('evidence_integrity', `RV: ${d}`))
  if (rvRow !== null && rvRow.status !== rvStatus) add('raw_result_mismatch', `RV: the row status ${rvRow.status} is not the record status ${rvStatus}`)
  if (rvRecord !== null && rvStatus !== 'not_executed') for (const issue of recordCalculationIssues(rvRecord)) add('guardrail', `RV: ${issue}`)
  const rvResult = rvRecord !== null && isObject(rvRecord.result) ? rvRecord.result : null
  const rvCandidates: Json[] = []
  const rvSupports: Json[] = []
  const rvRefs = [...i0Refs].sort((a, b) => compare(a.targetWeaponId, b.targetWeaponId) || a.ordinal - b.ordinal)
  const rvMeasured = rvStatus === 'verified' || rvStatus === 'guardrail_violation'
  if (rvMeasured && rvResult !== null) {
    if (rvStatus === 'guardrail_violation') add('guardrail', `RV: ${JSON.stringify(rvResult.issues ?? [])}`)
    const recCands = Array.isArray(rvResult.candidates) ? rvResult.candidates as Json[] : null
    const recSups = Array.isArray(rvResult.supports) ? rvResult.supports as Json[] : null
    if (recCands === null || recSups === null || recCands.length !== rvRefs.length || recSups.length !== v.supports.length) { add('evidence_integrity', 'RV: the record lacks the 9 candidates / 3 supports'); rvStatus = null }
    else {
      if (!isObject(rvResult.baseline) || rvResult.baseline.conflictResolutions !== 0) add('guardrail', 'RV: G1 - the baseline PlannerInput carried a conflict resolution')
      rvRefs.forEach((ref, i) => {
        const rec = recCands[i]!
        const at = `RV ${ref.label} c${ref.ordinal}`
        if (rec.label !== ref.label || rec.ordinal !== ref.ordinal || rec.origin !== ref.origin || rec.generatedBuildListEntryId !== ref.generatedBuildListEntryId) { add('raw_result_mismatch', `${at}: the record candidate is not the registered one`); return }
        const stored = input.incumbentBodies.get(ref.file) ?? null
        const body = stored !== null && isObject(stored.body) ? stored.body as unknown as BuildListEntry : null
        let keySha: string | null
        try { keySha = body === null ? null : sha(candidateStableKey(body.candidateSnapshot)) } catch { keySha = null }
        const RV1 = { bodySha256Matched: stored !== null && stored.sha256 === ref.sha256 && stored.bytes === ref.bytes && isObject(rec.generatedEntry) && rec.generatedEntry.sha256Observed === ref.sha256,
          idMatched: body?.id === ref.generatedBuildListEntryId, targetMatched: body?.targetWeaponId === ref.targetWeaponId, calculationContextMatched: body !== null && same(body.calculationContext, D2E_CALCULATION_CONTEXT),
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
          if (rec3.reservationSource !== 'k0_empty' || rec3.reservationDigest !== D2E_K0_RESERVATION_DIGEST) rv3Issues.push('the K0 Search reservation is not the registered empty reservation')
        } else {
          const ctx = v.contexts.find(c => c.k === ref.contextK) ?? null
          const row = input.d2cContexts.find(c => c.contextId === ref.contextId) ?? null
          if (ctx === null || row === null || rec3.reservationSource !== 'ctx_record' || rec3.reservationDigest !== ctx.reservationDigest || hashStableValue(ctx.reservationBody) !== ctx.reservationDigest
            || row.reservationDigest !== ctx.reservationDigest || row.record?.sha256 !== ctx.recordSha256) rv3Issues.push('the K1 Search reservation is not the own CTX record one')
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
  // k1_context parity: the 6 K1 CTX records against the RV6 derived values (§9).
  for (const c of v.contexts) {
    const rec = isObject(rvResult) && Array.isArray(rvResult.supports) ? (rvResult.supports as Json[]).find(s => s.supportBuildListEntryId === c.supportBuildListEntryId) ?? null : null
    const rec6 = rec !== null && isObject(rec.RV6) ? rec.RV6 : null
    let state: D2EParityState
    const mismatches: string[] = []
    if (!rvMeasured || rec6 === null) state = 'not_checked'
    else {
      if (rec6.digestObserved !== c.reservationDigest) mismatches.push('reservationDigest')
      if (!isObject(rec6.bodyObserved) || stableStringify(rec6.bodyObserved) !== stableStringify(c.reservationBody)) mismatches.push('reservationBody')
      state = mismatches.length === 0 ? 'matched' : 'mismatched'
    }
    parity({ checkId: `k1_context:CTX-${c.k}`, kind: 'k1_context', state, subjects: ['RV', `CTX-${c.k}`], expected: { reservationDigest: c.reservationDigest }, observed: rec6 === null ? null : { reservationDigest: rec6.digestObserved },
      mismatches, notChecked: state === 'not_checked' ? { dependsOn: [{ id: 'RV', status: rvStatus, unmeasuredReason: rvUnmeasuredReason, notExecutedReason: rvStatus === 'not_executed' ? notExecutedOf(rvRow) : null }] } : null,
      category: 'k1_context_parity' })
  }

  // ---- evaluations (one replay function for B0, I0, ADM and EXT)
  const rows = [...input.evaluationRows]
  const evaluations: Json[] = []
  if (new Set(rows.map(r => r.evaluationId)).size !== rows.length) add('guardrail', 'an evaluation repeats')
  let b0Facts: Facts | null = null
  let i0Facts: Facts | null = null
  let ctxRecordDigest: string | null = null
  let ctxRecordBody: Json | null = null
  let ctxContextId: string | null = null
  const poolByGenerated = new Map<string, D2EPoolCandidate>()

  const evaluateRow = (spec: { evaluationId: string; stage: D2EStage; ordinal: number | null; reps: EvalRef[]; registeredInputDigest: string | null; reusedExisting?: boolean }) => {
    const row = rows.shift() ?? null
    if (row !== null && row.evaluationId !== spec.evaluationId) { add('guardrail', `evaluation row ${row.evaluationId} is not the registered next evaluation ${spec.evaluationId}`); rows.unshift(row) }
    const own = row !== null && row.evaluationId === spec.evaluationId ? row : null
    if (own === null && !input.interrupted && v.passed) add('evidence_integrity', `${spec.evaluationId}: the registered evaluation has no row`)
    const record = own ? input.evaluationRecords.get(spec.evaluationId) ?? null : null
    let status: string | null = own === null ? 'not_executed' : statusFromFiles(own.process, record, own.notExecutedReason, input.interrupted, d => add('evidence_integrity', `${spec.evaluationId}: ${d}`))
    if (own !== null && own.status === 'not_run_reused_existing' && own.process === null && own.notExecutedReason === null) status = 'not_run_reused_existing'
    if (own !== null && spec.reusedExisting === true && status !== 'not_run_reused_existing') add('raw_result_mismatch', `${spec.evaluationId}: a reusedExisting Candidate must be not_run_reused_existing`)
    const notExecutedReason = own === null ? (input.interrupted ? 'interrupted' : 'missing_row') : own.notExecutedReason
    if (own !== null && own.status !== status) add('raw_result_mismatch', `${spec.evaluationId}: the row status ${own.status} is not the record status ${status}`)
    const reps = [...spec.reps].sort((a, b) => compare(a.targetWeaponId, b.targetWeaponId))
    const replacementTargets = reps.map(r => r.targetWeaponId)
    const generatedIds = reps.map(r => r.generatedBuildListEntryId)
    const shas = reps.map(r => r.sha256)
    const support = sortedIds([...new Set(reps.flatMap(r => r.requiresSupport))])
    const evaluatedAgainst = d2eEvaluatedAgainst(spec.stage)
    const replayedInputDigest = d1InputDigest(replacementTargets, generatedIds, shas, input.exportSha256)
    if (own !== null && (own.stage !== spec.stage || own.evaluatedAgainst !== evaluatedAgainst || own.ordinal !== spec.ordinal || !same(own.replacementTargets, replacementTargets) || !same(own.generatedEntryIds, generatedIds)
      || !same(own.generatedEntrySha256s, shas) || !same(own.requiresSupport, support))) add('raw_result_mismatch', `${spec.evaluationId}: the row inputs are not the replayed inputs`)
    const executedRow = own !== null && own.process !== null
    if (executedRow && own.inputDigest !== replayedInputDigest) add('raw_result_mismatch', `${spec.evaluationId}: the runner inputDigest differs from the recomputed one`)
    const result = record !== null && isObject(record.result) ? record.result : null
    if (record !== null && status !== 'not_executed') for (const issue of recordCalculationIssues(record)) add('guardrail', `${spec.evaluationId}: ${issue}`)
    const childInputDigest = record !== null && typeof record.inputDigest === 'string' ? record.inputDigest : null
    if (record !== null && status !== 'not_executed' && childInputDigest !== replayedInputDigest) add('raw_result_mismatch', `${spec.evaluationId}: the child inputDigest differs from the recomputed one`)
    if (status === 'guardrail_violation') add('guardrail', `${spec.evaluationId}: ${JSON.stringify(result?.issues ?? [])}`)
    const measuredRun = status !== null && ['evaluated', 'preflight_refused', 'planner_rerun_bound_reached'].includes(status)
    let facts: Facts | null = null
    if (measuredRun && result !== null) {
      const missing = MEASURED_FACT_FIELDS.filter(f => !(f in result))
      if (missing.length > 0) add('evidence_integrity', `${spec.evaluationId}: the measured record lacks ${missing.join(', ')}`)
      else facts = result as unknown as Facts
    }
    if (status === 'calculation_error' && (result === null || !isObject(result.error))) add('evidence_integrity', `${spec.evaluationId}: a calculation error record without the error`)
    if (facts !== null && facts.runConflictResolutions !== 0) add('guardrail', `${spec.evaluationId}: G1 - the run received a conflict resolution`)
    if (facts !== null && facts.fullRunsStarted > D2E_EVALUATION_FULL_RUN_CAP) add('guardrail', `${spec.evaluationId}: ${facts.fullRunsStarted} full runs, above 8`)
    if (facts !== null && (facts.childRecheck.checked !== reps.length || facts.childRecheck.issues.length !== 0)) add('guardrail', `${spec.evaluationId}: the child RV1′ / RV2′ recheck did not cover every G`)
    const resultDigest = facts !== null ? d1ResultDigest(facts) : null
    if (facts !== null && facts.resultDigest !== resultDigest) add('raw_result_mismatch', `${spec.evaluationId}: resultDigest differs from the recomputed one`)
    // S1 .. S5 (§7.2) against the S5 authority record, independently of the child.
    const selected = new Set(facts?.plan.selectedBuildListEntryIds ?? [])
    const removed = new Set(facts?.runtimeUnsupportedRemoved ?? [])
    const supportChecksByEntry: Json = {}
    for (const id of support) {
      const ctx = authority.get(id) ?? null
      if (facts === null) { supportChecksByEntry[id] = { contextId: ctx === null ? null : ctx.contextId, S1: null, S2: null, S3: null, S4: null, S5: null, selected: null, supportExpiryCause: null }; continue }
      const c = isObject(facts.supportStaticChecks) ? facts.supportStaticChecks[id] : undefined
      const dynamic = facts.supportChecks[id]
      if (c === undefined || !isObject(c.S5) || dynamic === undefined || ctx === null) { add('evidence_integrity', `${spec.evaluationId}: no static S4 / S5 or dynamic record of the support Entry ${id}, or no S5 authority record`); continue }
      const exportBody = (exportById.get(id) ?? [])[0]
      const exportSha = exportBody === undefined ? null : sha(stableStringify(exportBody))
      const s4 = c.S4 === true && facts.supportBodySha256Observed?.[id] === ctx.supportBodySha256 && exportSha === ctx.supportBodySha256
      if (!s4) add('guardrail', `${spec.evaluationId}: S4 of the support Entry ${id} does not hold against the S5 authority record`)
      if (c.S5.digestExpected !== ctx.reservationDigest || !same(c.S5.bodyExpected, ctx.reservationBody) || !isObject(c.S5.bodyExpected)) add('guardrail', `${spec.evaluationId}: S5 compared against a reservation that is not the S5 authority digest / body`)
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
    // The K1 own CTX record checks and S6 (the K2 pair), independently of the child.
    let pairReservationCheck: Json | null = null
    for (const r of reps.filter(x => x.kind !== 'k0')) {
      if (facts === null) continue
      const rc = isObject(facts.replacementReservationChecks) ? facts.replacementReservationChecks[r.generatedBuildListEntryId] : undefined
      if (rc === undefined) { add('evidence_integrity', `${spec.evaluationId}: no reservation check of ${r.generatedBuildListEntryId}`); continue }
      if (r.kind === 'k1') {
        const own = v.contexts.find(c => c.contextId === r.contextId) ?? null
        if (own === null || rc.kind !== 'k1_own_context' || rc.digestExpected !== own.reservationDigest || rc.digestObserved !== own.reservationDigest || rc.bodyMatched !== true || rc.satisfied !== true) add('guardrail', `${spec.evaluationId}: the K1 replacement ${r.label} does not derive its own CTX record reservation`)
      } else {
        const pool = poolByGenerated.get(r.generatedBuildListEntryId) ?? null
        const searchInputDigestMatched = pool !== null && pool.reservationDigest === ctxRecordDigest && rc.searchInputDigestMatched === true
        const digestMatched = rc.digestExpected === ctxRecordDigest && rc.digestObserved === ctxRecordDigest && ctxRecordDigest !== null
        const bodyMatched = rc.bodyMatched === true && ctxRecordBody !== null && hashStableValue(ctxRecordBody) === ctxRecordDigest
        const satisfied = rc.kind === 'k2_pair' && digestMatched && bodyMatched && searchInputDigestMatched && rc.satisfied === true
        if (!satisfied) add('guardrail', `${spec.evaluationId}: S6 does not hold (support_pair_reservation_mismatch)`)
        pairReservationCheck = { S6: { digestExpected: rc.digestExpected, digestObserved: rc.digestObserved, digestMatched, bodyMatched, searchInputDigestMatched, satisfied } }
      }
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
    const diff = (other: Facts | null) => {
      if (facts === null || other === null) return null
      return { completedDelta: (facts.plan.termination?.completedTargetCount ?? 0) - (other.plan.termination?.completedTargetCount ?? 0), conflictDelta: facts.conflicts.length - other.conflicts.length,
        stepsDelta: facts.plan.steps === null || other.plan.steps === null ? null : facts.plan.steps - other.plan.steps,
        targetsGained: facts.selectedTargetWeaponIds.filter(id => !other.selectedTargetWeaponIds.includes(id)).sort(compare),
        targetsLost: other.selectedTargetWeaponIds.filter(id => !facts.selectedTargetWeaponIds.includes(id)).sort(compare) }
    }
    const baselineDiff = spec.stage === 'B0' ? null : diff(b0Facts)
    const refDiff = spec.stage === 'EXT' ? diff(i0Facts) : null
    const referenceDiff = refDiff === null ? null : { referenceEvaluationId: 'I0', ...refDiff }
    // ADM: R1 (R2 .. R4, found_R, winners, crossSupportLoss as diagnostics).
    let r1r4: Json | null = null
    const k2Ref = reps.find(r => r.kind === 'k2') ?? null
    const k2Pool = k2Ref === null ? null : poolByGenerated.get(k2Ref.generatedBuildListEntryId) ?? null
    const winnerOf = (id: string) => {
      const commitment = (facts?.routeCommitment ?? []).find(x => x.buildListEntryId === id) ?? null
      return facts?.plan.present && !selected.has(id) ? commitment?.provisionalOutcomeSelectedBuildListEntryId ?? null : null
    }
    if (spec.stage === 'ADM' && k2Ref !== null) {
      const discovery = { reusedExisting: k2Pool?.reusedExisting === true, replacementReady: k2Pool !== null && (k2Pool.reusedExisting || (k2Pool.replacement.status === 'ready' && k2Pool.replacement.replacedBuildListEntryId === k2Ref.currentBuildListEntryId)) }
      const rr = d2R1R4((status ?? 'process_failure') as D2EvaluationStatus, facts, k2Ref.generatedBuildListEntryId, k2Ref.requiresSupport, discovery)
      const verdict = facts?.trialVerdict ?? null
      const b0Selected = b0Facts === null ? null : new Set(b0Facts.plan.selectedBuildListEntryIds)
      const winner = winnerOf(k2Ref.generatedBuildListEntryId)
      const coParticipants = sortedIds([...new Set((facts?.conflicts ?? []).filter(x => x.participants.includes(k2Ref.generatedBuildListEntryId)).flatMap(x => x.participants.filter(id => id !== k2Ref.generatedBuildListEntryId)))])
      r1r4 = { R1: rr.R1, R1FailureReason: rr.R1FailureReason, R1Conditions: rr.conditions, R2: rr.R2, R3: rr.R3, R4: rr.R4, supportVacuous: rr.supportVacuous,
        targetRegressedR: b0Selected === null || facts === null || !facts.plan.present ? null : b0Selected.has(k2Ref.currentBuildListEntryId) && !selected.has(k2Ref.generatedBuildListEntryId),
        foundRDiagnostic: verdict === null ? null : verdict.status === 'found_R', foundRVerdict: verdict, winnerBuildListEntryId: winner,
        crossSupportLoss: winner === null ? (facts === null ? null : false) : k2Ref.requiresSupport.includes(winner), conflictCoParticipants: coParticipants,
        supportDynamicChecks: Object.fromEntries(k2Ref.requiresSupport.map(id => [id, facts?.supportChecks[id] ?? null])) }
      if (own?.runner && isObject(own.runner) && own.runner.r1 !== undefined && own.runner.r1 !== rr.R1) add('raw_result_mismatch', `${spec.evaluationId}: the runner R1 differs from the analyzer R1`)
    }
    // EXT: the §6.4 diagnostics, the gate, improved (§6.5).
    let extension: Json | null = null
    const completed = facts?.plan.termination?.completedTargetCount ?? null
    const i0Completed = i0Facts?.plan.termination?.completedTargetCount ?? null
    const gateJudged = spec.stage === 'EXT' && facts !== null && i0Facts !== null
    const gate = gateJudged ? { judged: true, referenceCompleted: i0Completed, proposedCompleted: completed, satisfied: completed !== null && i0Completed !== null && completed >= i0Completed }
      : { judged: false, referenceCompleted: spec.stage === 'EXT' ? i0Completed : null, proposedCompleted: null, satisfied: null }
    const eligible = spec.stage === 'EXT' && status === 'evaluated' && r5.satisfied === true && gate.satisfied === true
    const r5OnlyEligible = spec.stage === 'EXT' && status === 'evaluated' && r5.satisfied === true && gate.satisfied !== true
    const metrics = facts !== null && facts.plan.termination !== null ? { completed: facts.plan.termination.completedTargetCount, conflicts: facts.conflicts.length } : null
    const i0m = i0Facts !== null && i0Facts.plan.termination !== null ? { completed: i0Facts.plan.termination.completedTargetCount, conflicts: i0Facts.conflicts.length } : null
    const improved = eligible && metrics !== null && i0m !== null && d2eBetter(metrics, i0m)
    const equalMetrics = eligible && metrics !== null && i0m !== null && metrics.completed === i0m.completed && metrics.conflicts === i0m.conflicts
    const conflictIncreased = eligible && metrics !== null && i0m !== null && metrics.completed === i0m.completed && metrics.conflicts > i0m.conflicts
    const improvementKind = d2eImprovementKind(improved, metrics, i0m)
    if (spec.stage === 'EXT' && k2Ref !== null) {
      const g = k2Ref.generatedBuildListEntryId
      const t03Selected = facts?.plan.present ? selected.has(g) : null
      const t03TargetCompleted = facts === null ? null : facts.selectedTargetWeaponIds.includes(k2Ref.targetWeaponId)
      const incumbentIds = reps.filter(r => r.kind !== 'k2')
      const incumbentNotSelected = facts?.plan.present ? incumbentIds.filter(r => !selected.has(r.generatedBuildListEntryId)).map(r => ({ label: r.label, generatedBuildListEntryId: r.generatedBuildListEntryId, winnerBuildListEntryId: winnerOf(r.generatedBuildListEntryId) })) : null
      const supportIds = new Set(support)
      const incumbentSet = new Set(incumbentIds.map(r => r.generatedBuildListEntryId))
      const classify = (id: string) => supportIds.has(id) ? 'support' : incumbentSet.has(id) ? 'incumbent_generated' : 'outside_set'
      const withG = conflicts.filter(c => c.participants.includes(g))
      const netCompletedDelta = refDiff?.completedDelta ?? null
      extension = {
        t03: { generatedBuildListEntryId: g, selected: t03Selected, winnerBuildListEntryId: winnerOf(g), targetSelected: t03TargetCompleted },
        t03Supports: k2Ref.requiresSupport.map(id => ({ supportBuildListEntryId: id, ...(isObject(supportChecksByEntry[id]) ? supportChecksByEntry[id] as Json : {}) })),
        incumbentRetention: { allIncumbentGeneratedSelected: incumbentNotSelected === null ? null : incumbentNotSelected.length === 0, incumbentGeneratedNotSelected: incumbentNotSelected ?? [] },
        supportExpired: facts === null ? null : support.some(id => { const s = supportChecksByEntry[id]; return isObject(s) && (s.S1 === false || s.S2 === false || s.S3 === false) }),
        conflictsWithinSet: conflicts.filter(c => c.withinSet),
        conflictsWithT03G: withG.map(c => ({ ...c, others: c.participants.filter(id => id !== g).map(id => ({ buildListEntryId: id, role: classify(id) })) })),
        d2cT03ResourcesObserved: v.d2cT03ResourceIdentities.map(resourceIdentity => ({ resourceIdentity, observed: facts === null ? null : withG.some(c => c.resourceIdentity === resourceIdentity),
          participants: withG.filter(c => c.resourceIdentity === resourceIdentity).map(c => [...c.participants]) })),
        t03Completion: { t03TargetCompleted, netCompletedDelta, t03CompletedWithoutNetGain: t03TargetCompleted === null || netCompletedDelta === null ? null : t03TargetCompleted && netCompletedDelta <= 0 },
        resourceConflictRejections: facts?.resourceConflictRejections ?? null,
      }
    }
    // determinism_prior (§9): the D2-D / D2-C / D2 evaluations holding the same inputDigest.
    const prior = v.priorByInputDigest[replayedInputDigest] ?? []
    const comparable = status !== null && COMPARABLE_EVALUATION.includes(status)
    let priorParity: Json
    if (prior.length === 0) priorParity = { state: 'not_applicable', matchedPriorEvaluationIds: [], resultDigestsEqual: null, notChecked: null }
    else {
      const mismatches = comparable ? prior.filter(x => x.status !== status || x.resultDigest !== resultDigest).map(x => `${x.source} ${x.evaluationId}: ${x.status} / ${x.resultDigest} vs ${status} / ${resultDigest}`) : []
      const state: D2EParityState = !comparable ? 'not_checked' : mismatches.length === 0 ? 'matched' : 'mismatched'
      const dependsOn = [{ id: spec.evaluationId, status, unmeasuredReason: status === null || MEASURED_EVALUATION.includes(status) || status === 'not_executed' ? null : status, notExecutedReason: status === 'not_executed' ? notExecutedReason : null }]
      priorParity = { state, matchedPriorEvaluationIds: state === 'matched' ? prior.map(x => `${x.source}:${x.evaluationId}`) : [], resultDigestsEqual: comparable ? mismatches.length === 0 : null,
        notChecked: state === 'not_checked' ? { dependsOn } : null }
      parity({ checkId: `determinism_prior:${spec.evaluationId}`, kind: 'determinism_prior', state, subjects: [spec.evaluationId, ...prior.map(x => `${x.source}:${x.evaluationId}`)], expected: prior,
        observed: { status, resultDigest }, mismatches, notChecked: state === 'not_checked' ? { dependsOn } : null, category: 'determinism' })
    }
    const unmeasuredReason = status === null || MEASURED_EVALUATION.includes(status) || status === 'not_executed' || status === 'guardrail_violation' ? null : status
    const e: Json = {
      evaluationId: spec.evaluationId, stage: spec.stage, ordinal: spec.ordinal, evaluatedAgainst, replacementTargets, replacementTargetLabels: reps.map(r => r.label), generatedEntryIds: generatedIds,
      generatedEntrySha256s: shas, requiresSupport: support, status, unmeasuredReason, notExecutedReason: status === 'not_executed' ? notExecutedReason : null, process: own?.process ?? null,
      inputDigest: executedRow ? replayedInputDigest : null, replayedInputDigest, childInputDigest, registeredInputDigest: spec.registeredInputDigest,
      inputDigestMatched: spec.registeredInputDigest === null ? null : replayedInputDigest === spec.registeredInputDigest, resultDigest,
      fullRunsStarted: facts?.fullRunsStarted ?? null, runtimeUnsupportedRemoved: facts?.runtimeUnsupportedRemoved ?? [],
      preflight: facts ? { status: facts.preflight.status, refusal: facts.preflight.refusal } : null,
      plan: facts ? { present: facts.plan.present, termination: facts.plan.termination, steps: facts.plan.steps, selectedBuildListEntryIds: facts.plan.selectedBuildListEntryIds, warningKinds: facts.plan.warningKinds } : null,
      conflicts, routeCommitment: facts?.routeCommitment ?? [],
      candidates: reps.map(r => ({ label: r.label, kind: r.kind, contextId: r.contextId, targetWeaponId: r.targetWeaponId, generatedBuildListEntryId: r.generatedBuildListEntryId,
        selected: facts?.plan.present ? selected.has(r.generatedBuildListEntryId) : null, winnerBuildListEntryId: winnerOf(r.generatedBuildListEntryId),
        targetSelected: facts === null ? null : facts.selectedTargetWeaponIds.includes(r.targetWeaponId), requiresSupport: [...r.requiresSupport] })),
      r1r4, r5, r6, extension,
      rejectedBuildListEntries: facts?.rejectedBuildListEntries ?? [], resourceConflictRejections: facts?.resourceConflictRejections ?? null, selectedTargetWeaponIds: facts?.selectedTargetWeaponIds ?? [],
      supportChecksByEntry, pairReservationCheck, childRecheck: facts?.childRecheck ?? null, parity: null, baselineDiff, referenceDiff, gate, r5OnlyEligible, eligible, improved, improvementKind,
      equalMetrics, conflictIncreased, priorParity, boundLimited: isD1BoundLimited(r5Status, facts), errorDetail: status === 'calculation_error' && result && isObject(result.error) ? result.error : null,
      wallMs: typeof own?.process?.wallMs === 'number' ? own.process.wallMs : null, childWallMs: record !== null && typeof record.wallMs === 'number' ? record.wallMs : null, ...memoryOf(record, own?.process ?? null),
    }
    evaluations.push(e)
    return { e, status, facts, r5Satisfied: r5.satisfied }
  }
  const isMeasured = (s: unknown) => typeof s === 'string' && MEASURED_EVALUATION.includes(s)
  const incumbentRef = (r: D2ECandidateRef): EvalRef => ({ label: r.label, targetWeaponId: r.targetWeaponId, currentBuildListEntryId: r.currentBuildListEntryId, generatedBuildListEntryId: r.generatedBuildListEntryId,
    sha256: r.sha256, requiresSupport: [...r.requiresSupport], contextId: r.contextId, kind: r.origin === 'd2b_k0' ? 'k0' : 'k1', ordinal: r.ordinal })
  const B0X = v.expected?.b0 ?? null
  const I0X = v.expected?.i0 ?? null

  // B0
  const b0 = evaluateRow({ evaluationId: 'B0', stage: 'B0', ordinal: null, reps: [], registeredInputDigest: D2E_B0_EXPECTED.inputDigest })
  if (b0.status === 'evaluated' && b0.facts !== null) b0Facts = b0.facts
  {
    const comparable = b0.status !== null && COMPARABLE_EVALUATION.includes(b0.status)
    let state: D2EParityState = 'not_checked', mismatches: string[] = []
    if (comparable) {
      const p = d1B0Parity(b0.facts?.baselineSummary ?? null, v.phase2c2BaselineSummary)
      const t = b0.facts?.plan.termination ?? null
      const X = B0X ?? D2E_B0_EXPECTED
      mismatches = [...p.mismatches.map(m => `Phase 2-C2 ${m}`), ...(b0.status !== 'evaluated' ? [`status ${b0.status}`] : []),
        ...(b0.e.resultDigest !== X.resultDigest ? ['resultDigest'] : []), ...(b0.e.replayedInputDigest !== X.inputDigest ? ['inputDigest'] : []),
        ...(t?.status !== X.termination ? ['termination'] : []), ...(t?.completedTargetCount !== X.completed || t?.totalTargetCount !== X.totalTargetCount ? ['completed / total'] : []),
        ...(b0.facts?.conflicts.length !== X.conflicts ? ['Conflicts'] : []), ...(b0.facts?.plan.steps !== X.steps ? ['steps'] : [])]
      state = mismatches.length === 0 ? 'matched' : 'mismatched'
    }
    b0.e.parity = { kind: 'baseline', state, mismatches }
    parity({ checkId: 'baseline:B0', kind: 'baseline', state, subjects: ['B0', 'D2-D:B0', 'Phase2C2:baseline.summary'], expected: { ...(B0X ?? D2E_B0_EXPECTED) },
      observed: { status: b0.status, inputDigest: b0.e.replayedInputDigest, resultDigest: b0.e.resultDigest }, mismatches,
      notChecked: state === 'not_checked' ? { dependsOn: [{ id: 'B0', status: b0.status, unmeasuredReason: b0.e.unmeasuredReason as string | null, notExecutedReason: b0.e.notExecutedReason as string | null }] } : null,
      category: 'baseline_parity_mismatch' })
  }
  // I0
  const i0 = evaluateRow({ evaluationId: 'I0', stage: 'I0', ordinal: null, reps: i0Refs.map(incumbentRef), registeredInputDigest: D2E_I0_EXPECTED.inputDigest })
  {
    const comparable = i0.status !== null && COMPARABLE_EVALUATION.includes(i0.status)
    let state: D2EParityState = 'not_checked'
    const mismatches: string[] = []
    if (comparable) {
      const t = i0.facts?.plan.termination ?? null
      const X = I0X ?? { ...D2E_I0_EXPECTED, supportsSelected: [] as string[] }
      if (i0.status !== 'evaluated') mismatches.push(`status ${i0.status}`)
      if (i0.e.replayedInputDigest !== X.inputDigest) mismatches.push('inputDigest')
      if (i0.e.resultDigest !== X.resultDigest) mismatches.push('resultDigest')
      if (t?.status !== X.termination || (t?.reachedLimits ?? []).length !== 0) mismatches.push('termination')
      if (t?.completedTargetCount !== X.completed || t?.totalTargetCount !== X.totalTargetCount) mismatches.push('completed / total')
      if (i0.facts?.conflicts.length !== X.conflicts) mismatches.push('Conflicts')
      if (i0.facts?.plan.steps !== X.steps) mismatches.push('steps')
      if (i0.r5Satisfied !== true) mismatches.push('R5 is not satisfied')
      if (i0.facts?.resourceConflictRejections !== X.resourceConflictRejections) mismatches.push('resource_conflict rejections')
      if (I0X === null || I0X.supportsSelected.length !== 3 || !I0X.supportsSelected.every(s => i0.facts?.plan.selectedBuildListEntryIds.includes(s))) mismatches.push('the three supports are not selected')
      state = mismatches.length === 0 ? 'matched' : 'mismatched'
    }
    i0.e.parity = { kind: 'd2d_best', state, mismatches }
    const dependsOn = [{ id: 'I0', status: i0.status, unmeasuredReason: i0.e.unmeasuredReason as string | null, notExecutedReason: i0.e.notExecutedReason as string | null }]
    parity({ checkId: 'd2d_best:I0', kind: 'd2d_best', state, subjects: ['I0', `D2-D:${D2E_I0_EXPECTED.evaluationId}`], expected: { ...(I0X ?? D2E_I0_EXPECTED) },
      observed: { status: i0.status, inputDigest: i0.e.replayedInputDigest, resultDigest: i0.e.resultDigest }, mismatches, notChecked: state === 'not_checked' ? { dependsOn } : null, category: 'd2d_parity' })
    // registered_input: the child-recorded inputDigest and the V-recomputed one against the registered one.
    const executed = i0.e.process !== null && i0.e.childInputDigest !== null
    const inMismatch = executed ? [...(i0.e.childInputDigest !== D2E_I0_EXPECTED.inputDigest ? [`child ${String(i0.e.childInputDigest)}`] : []), ...(v.i0?.inputDigest !== D2E_I0_EXPECTED.inputDigest ? [`V ${String(v.i0?.inputDigest)}`] : [])] : []
    const inState: D2EParityState = !executed ? 'not_checked' : inMismatch.length === 0 ? 'matched' : 'mismatched'
    parity({ checkId: 'registered_input:I0', kind: 'registered_input', state: inState, subjects: ['I0'], expected: D2E_I0_EXPECTED.inputDigest, observed: { child: i0.e.childInputDigest, v: v.i0?.inputDigest ?? null },
      mismatches: inMismatch.map(m => `${m} is not ${D2E_I0_EXPECTED.inputDigest}`), notChecked: inState === 'not_checked' ? { dependsOn } : null, category: 'guardrail' })
  }
  const i0Measured = i0.status === 'evaluated' && i0.facts !== null
  if (i0Measured) i0Facts = i0.facts

  // ---- CTX-K2 (§4.1)
  const ctxRow = input.contextRow
  const ctxJson = ctxRow ? input.contextRecord : null
  if (ctxRow === null && !input.interrupted && v.passed) add('evidence_integrity', 'CTX-K2: the registered context has no row')
  if (ctxRow !== null && (ctxRow.unitId !== D2E_CONTEXT_UNIT_ID || (k2 !== null && ctxRow.contextId !== k2.contextId))) add('guardrail', `context row ${ctxRow.unitId} / ${ctxRow.contextId} is not the registered CTX-K2`)
  let ctxStatus: string | null = ctxRow === null ? 'not_executed' : statusFromFiles(ctxRow.process, ctxJson, ctxRow.notExecutedReason, input.interrupted, d => add('evidence_integrity', `CTX-K2: ${d}`))
  if (ctxRow !== null && ctxRow.status !== ctxStatus) add('raw_result_mismatch', `CTX-K2: the row status ${ctxRow.status} is not the record status ${ctxStatus}`)
  if (ctxJson !== null && ctxStatus !== 'not_executed') for (const issue of recordCalculationIssues(ctxJson)) add('guardrail', `CTX-K2: ${issue}`)
  let ctxChecks: Json | null = null
  let ctxDiagnostics: Json | null = null
  let ctxRecord: ReturnType<typeof readD2EK2ContextRecord>['record'] = null
  if (ctxStatus === 'context_ready' || ctxStatus === 'guardrail_violation') {
    const read = readD2EK2ContextRecord(ctxJson)
    if (read.issue !== null) { add('evidence_integrity', `CTX-K2: ${read.issue}`); ctxStatus = null }
    else ctxRecord = read.record
  }
  if (ctxStatus === 'guardrail_violation') add('guardrail', `CTX-K2: ${JSON.stringify(ctxRecord?.issues ?? [])} ${JSON.stringify(ctxRecord?.checks ?? null)}`)
  let c5State: D2EParityState = 'not_checked'
  if (ctxRecord !== null && ctxStatus === 'context_ready' && k2 !== null) {
    const r = ctxRecord
    if (r.contextId !== k2.contextId || r.contextId !== d2eContextId(k2.label, k2.supportBuildListEntryIds) || r.targetWeaponId !== k2.targetWeaponId || r.currentBuildListEntryId !== k2.currentBuildListEntryId
      || !same(r.supportBuildListEntryIds, k2.supportBuildListEntryIds)) add('raw_result_mismatch', 'CTX-K2: the record identity is not the derived K2 context')
    const at = (d: string) => `CTX-K2: ${d}`
    const reservation = isObject(r.reservationBody) ? r.reservationBody : null
    if (reservation === null || hashStableValue(reservation) !== r.reservationDigest) add('evidence_integrity', at('reservationBody does not hash to its reservationDigest'))
    // C1 (Export, E1)
    const c1 = k2.supportBuildListEntryIds.length === 2 && k2.supportBuildListEntryIds.every(sId => {
      const bodies = exportById.get(sId) ?? []
      const t = bodies.length === 1 && typeof bodies[0]!.targetWeaponId === 'string' ? bodies[0]!.targetWeaponId as string : null
      return t !== null && !v.e1.targetWeaponIds.includes(t) && !sId.startsWith(D2E_GENERATED_ENTRY_PREFIX) && !v.e1.currentBuildListEntryIds.includes(sId)
    })
    for (const sId of k2.supportBuildListEntryIds) {
      const bodies = exportById.get(sId) ?? []
      if (bodies.length !== 1 || r.supportBodySha256s[sId] !== sha(stableStringify(bodies[0]))) add('guardrail', at(`supportBodySha256 of ${sId} is not SHA-256(stableStringify(Export body))`))
    }
    // C3 (the two support Routes; the unit plan side from the record)
    const exclusive = reservation !== null && Array.isArray(reservation.exclusiveOwnedWeaponIds) ? (reservation.exclusiveOwnedWeaponIds as unknown[]).map(String) : []
    const referenced = sortedIds([...new Set(k2.supportBuildListEntryIds.flatMap(sId => { const b = (exportById.get(sId) ?? [])[0]; return b !== undefined && isObject(b.candidateSnapshot) && isObject(b.candidateSnapshot.route)
      ? collectReferencedOwnedWeaponIds((b as unknown as BuildListEntry).candidateSnapshot.route).map(String) : [] }))])
    const c3 = same(referenced, r.checks.C3.referencedOwnedWeaponIds) && [...referenced, ...r.checks.C3.exclusiveConsumedOwnedWeaponIds].every(id => exclusive.includes(id)) && same(sortedIds(exclusive), r.checks.C3.exclusiveOwnedWeaponIds)
    // C4 (origin, excluded current Route key, K1 CTX records)
    const oT = (exportById.get(k2.currentBuildListEntryId) ?? [])[0]
    const oTKey = oT !== undefined && isObject(oT.candidateSnapshot) ? candidateStableKey(oT.candidateSnapshot as unknown as BuildListEntry['candidateSnapshot']) : null
    const k1 = k2.k1Contexts.map(c => v.contexts.find(x => x.k === c.k) ?? null)
    const c4 = r.originDigest !== null && r.originDigest === r.scheduleOriginDigest && r.originDigest === D2E_ORIGIN_DIGEST && (input.recomputedOriginDigest === null || r.originDigest === input.recomputedOriginDigest)
      && k1.every(c => c !== null && c.originDigest === r.originDigest && oTKey !== null && same(c.excludedRouteKeySha256s, [sha(oTKey)]))
      && oTKey !== null && same(r.excludedRouteKeys, [oTKey]) && same(r.scheduleExcludedRouteKeys, [oTKey]) && same(r.excludedRouteKeySha256s, [sha(oTKey)])
    // C5 (parity) / C6 / C7
    const c5Digest = r.reservationDigest === D2E_K2_RESERVATION_DIGEST
    const c5Body = reservation !== null && v.registeredReservationBody !== null && stableStringify(reservation) === stableStringify(v.registeredReservationBody)
    c5State = c5Digest && c5Body ? 'matched' : 'mismatched'
    if (r.checks.C5.state !== c5State || r.checks.C5.digestMatched !== c5Digest || r.checks.C5.bodyMatched !== c5Body) add('raw_result_mismatch', at('the recorded C5 is not the recomputed one'))
    const perSupport = k2.k1Contexts.map((c, i) => ({ supportBuildListEntryId: c.supportBuildListEntryId, k: c.k, contained: reservation !== null && k1[i] !== null && d2eReservationContains(reservation, k1[i]!.reservationBody) }))
    const c6 = perSupport.length === 2 && perSupport.every(x => x.contained)
    const c7 = r.checks.C7.satisfied === true && r.checks.C7.reverseDigest === r.reservationDigest
    const c2 = r.checks.C2.satisfied === true && reservation !== null && typeof r.reservationDigest === 'string'
    const union = k1.every(c => c !== null) ? d2eReservationUnion(k1.map(c => c!.reservationBody)) : null
    const equalsUnion = union === null || reservation === null ? null : stableStringify(union) === stableStringify(reservation)
    if (r.diagnostics.equalsK1ComponentwiseUnion !== equalsUnion) add('raw_result_mismatch', at('the recorded equalsK1ComponentwiseUnion is not the recomputed one'))
    for (const [name, ok] of [['C1', c1], ['C2', c2], ['C3', c3], ['C4', c4], ['C6', c6], ['C7', c7]] as const) if (!ok) add('guardrail', at(`${name} does not hold (recomputed)`))
    if (r.checks.C1.satisfied !== c1 || r.checks.C3.satisfied !== c3 || r.checks.C4.satisfied !== c4 || r.checks.C6.satisfied !== c6) add('raw_result_mismatch', at('the recorded C1 / C3 / C4 / C6 are not the recomputed ones'))
    ctxChecks = { C1: c1, C2: c2, C3: { satisfied: c3, referencedOwnedWeaponIds: referenced, exclusiveConsumedOwnedWeaponIds: [...r.checks.C3.exclusiveConsumedOwnedWeaponIds], exclusiveOwnedWeaponIds: sortedIds(exclusive) },
      C4: c4, C5: { state: c5State, expectedDigest: D2E_K2_RESERVATION_DIGEST, observedDigest: r.reservationDigest, bodyMatched: c5Body }, C6: { satisfied: c6, perSupport }, C7: c7 }
    ctxDiagnostics = { equalsK1ComponentwiseUnion: equalsUnion, k1Reservations: structuredClone(r.diagnostics.k1Reservations) }
    if (c5State === 'matched' && c1 && c2 && c3 && c4 && c6 && c7) { ctxRecordDigest = r.reservationDigest; ctxRecordBody = reservation; ctxContextId = r.contextId }
  }
  const ctxUnmeasuredReason = ctxStatus === null || ctxStatus === 'context_ready' || ctxStatus === 'not_executed' || ctxStatus === 'guardrail_violation' ? null : ctxStatus
  if (ctxStatus !== 'context_ready' && ctxStatus !== null && ctxStatus !== 'not_executed' && ctxStatus !== 'guardrail_violation' && !(UNMEASURED_PROCESS as readonly string[]).includes(ctxStatus)) c5State = 'not_applicable'
  parity({ checkId: 'k2_context_registered:CTX-K2', kind: 'k2_context_registered', state: c5State, subjects: ['CTX-K2'], expected: { reservationDigest: D2E_K2_RESERVATION_DIGEST, body: '§1.7 / §3.3' },
    observed: ctxRecord === null ? null : { reservationDigest: ctxRecord.reservationDigest }, mismatches: c5State === 'mismatched' ? [`digest ${String(ctxRecord?.reservationDigest)} or body differs from the registered one`] : [],
    notChecked: c5State === 'not_checked' ? { dependsOn: [{ id: D2E_CONTEXT_UNIT_ID, status: ctxStatus, unmeasuredReason: ctxUnmeasuredReason, notExecutedReason: ctxStatus === 'not_executed' ? notExecutedOf(ctxRow) : null }] } : null,
    category: 'k2_context_parity' })
  const ctxReady = ctxRecordDigest !== null && ctxStatus === 'context_ready'
  const context = { contextId: k2?.contextId ?? null, status: ctxStatus, unmeasuredReason: ctxUnmeasuredReason, notExecutedReason: ctxStatus === 'not_executed' ? notExecutedOf(ctxRow) : null,
    process: ctxRow?.process ?? null, record: ctxRow?.recordFile ?? null, targetWeaponId: k2?.targetWeaponId ?? null, currentBuildListEntryId: k2?.currentBuildListEntryId ?? null,
    supportBuildListEntryIds: k2?.supportBuildListEntryIds ?? [], supportBodySha256s: ctxRecord?.supportBodySha256s ?? null, reservationBody: ctxRecord?.reservationBody ?? null,
    reservationDigest: ctxRecord?.reservationDigest ?? null, originDigest: ctxRecord?.originDigest ?? null, excludedRouteKeySha256s: ctxRecord?.excludedRouteKeySha256s ?? [],
    conflictContextCount: ctxRecord?.conflictContextCount ?? null, checks: ctxChecks, diagnostics: ctxDiagnostics, wallMs: typeof ctxRow?.process?.wallMs === 'number' ? ctxRow.process.wallMs : null,
    ...memoryOf(ctxJson, ctxRow?.process ?? null) }

  // ---- DSC: rung replay (§4.2 - §4.6)
  const dscRows = [...input.discoveryRows]
  if (dscRows.length > D2E_BUDGETS.discoveryUnitsMax) add('guardrail', `${dscRows.length} discovery units, above ${D2E_BUDGETS.discoveryUnitsMax}`)
  const units: Json[] = []
  const pool: D2EPoolCandidate[] = []
  let discoveryStop: D2EDiscoveryStop | null = null
  let discoveryDepends: DependsOn | null = null
  const dependency = !ctxReady
  let rung: string | null = 'L0'
  const d2bByKey = new Map(v.d2bK0Pool.map(p => [p.keySha256, p.ordinal]))
  const d2cByKey = new Map(v.d2cK1Pool.map(p => [p.keySha256, { ordinal: p.ordinal, contextId: p.contextId }]))
  const k1Split = (k2?.k1Contexts ?? []).map(c => c.supportBuildListEntryId)
  while (rung !== null) {
    const unitId = d2eDiscoveryUnitId(rung as never)
    const next = dscRows.shift() ?? null
    let row = next
    if (next !== null && next.unitId !== unitId) { add('guardrail', `discovery row ${next.unitId} is not the registered next unit ${unitId}`); dscRows.unshift(next); row = null }
    const base = { unitId, rung, extent: d2eRungExtent(rung as never), poolSizeAtStart: pool.length }
    if (row === null) {
      if (!input.interrupted && v.passed) add('evidence_integrity', `${unitId}: the registered unit has no row`)
      const reason = dependency ? 'dependency_unmeasured' : 'interrupted'
      units.push({ ...base, status: 'not_executed', unmeasuredReason: null, notExecutedReason: reason, process: null, searchIdentity: null, reservationDigest: null, summary: null, deliveries: [],
        poolSizeAtEnd: pool.length, searchOnlyMs: null, materializeMs: null, wallMs: null, peakHeapBytes: null, peakRssBytes: null })
      discoveryStop = 'not_executed'
      discoveryDepends = discoveryDepends ?? { id: unitId, status: 'not_executed', unmeasuredReason: null, notExecutedReason: reason }
      if (!dependency) break
      rung = D2E_LADDER[D2E_LADDER.findIndex(r => r.id === rung) + 1]?.id ?? null
      continue
    }
    if (row.rung !== rung || (k2 !== null && row.contextId !== k2.contextId)) add('raw_result_mismatch', `${unitId}: the row context / rung is not the registered one`)
    if (dependency) {
      if (row.status !== 'not_executed' || row.process !== null || (row.notExecutedReason !== 'dependency_unmeasured' && row.notExecutedReason !== 'rv_unmeasured')) add('raw_result_mismatch', `${unitId}: a unit after a CTX-K2 that is not ready must be not_executed (dependency_unmeasured / rv_unmeasured)`)
      units.push({ ...base, status: 'not_executed', unmeasuredReason: null, notExecutedReason: row.notExecutedReason, process: null, searchIdentity: null, reservationDigest: null, summary: null, deliveries: [],
        poolSizeAtEnd: pool.length, searchOnlyMs: null, materializeMs: null, wallMs: null, peakHeapBytes: null, peakRssBytes: null })
      discoveryStop = 'not_executed'
      discoveryDepends = discoveryDepends ?? { id: unitId, status: 'not_executed', unmeasuredReason: null, notExecutedReason: row.notExecutedReason }
      rung = D2E_LADDER[D2E_LADDER.findIndex(r => r.id === rung) + 1]?.id ?? null
      continue
    }
    const record = input.discoveryRecords.get(unitId) ?? null
    let status = statusFromFiles(row.process, record, row.notExecutedReason, input.interrupted, d => add('evidence_integrity', `${unitId}: ${d}`)) as D2EDiscoveryUnitStatus | null
    if (row.status !== status) add('raw_result_mismatch', `${unitId}: the row status ${row.status} is not the record status ${status}`)
    const result = record !== null && isObject(record.result) ? record.result : null
    let measured = status !== null && D2E_DISCOVERY_MEASURED.includes(status)
    const deliveries: Json[] = []
    let summary: Json | null = null
    let searchIdentity: string | null = null
    if (status === 'guardrail_violation') add('guardrail', `${unitId}: ${JSON.stringify(result?.issues ?? [])}`)
    if (record !== null && status !== 'not_executed') for (const issue of recordCalculationIssues(record)) add('guardrail', `${unitId}: ${issue}`)
    if (measured && result !== null) {
      const observedContext = isObject(result.observedContext) ? result.observedContext : null
      const ok = Array.isArray(result.deliveries) && Array.isArray(result.pooled) && isObject(result.search) && result.poolSizeAtStart === pool.length && result.unitId === unitId && observedContext !== null
        && typeof result.searchIdentity === 'string'
      if (!ok || ctxRecord === null || k2 === null) { add('evidence_integrity', `${unitId}: the measured record lacks deliveries / pooled / search / poolSizeAtStart / observedContext or they differ from the replay`); status = null; measured = false }
      else {
        searchIdentity = result.searchIdentity as string
        summary = result.search as Json
        if (observedContext!.reservationDigest !== ctxRecord.reservationDigest || observedContext!.originDigest !== ctxRecord.originDigest || !same(observedContext!.excludedRouteKeys, ctxRecord.excludedRouteKeys)
          || observedContext!.currentBuildListEntryId !== k2.currentBuildListEntryId || !same(observedContext!.supportBuildListEntryIds, k2.supportBuildListEntryIds)) add('guardrail', `${unitId}: context_drift - the unit context is not the CTX-K2 record`)
        const priorKeys = new Set(pool.map(p => p.candidateStableKey))
        const seenInUnit = new Set<string>()
        const recordDeliveries = result.deliveries as Json[]
        const recordPooled = result.pooled as Json[]
        let pooledIndex = 0
        recordDeliveries.forEach((d, i) => {
          const key = typeof d.candidateStableKey === 'string' ? d.candidateStableKey : ''
          const keySha256 = sha(key)
          if (d.indexInUnit !== i) add('raw_result_mismatch', `${unitId}: delivery ${i} index`)
          if (d.keySha256 !== keySha256) add('raw_result_mismatch', `${unitId}: delivery ${i} key SHA-256 is not sha256(key)`)
          if (seenInUnit.has(key)) add('guardrail', `${unitId}: D-1 - delivery ${i} repeats a key of this unit`)
          seenInUnit.add(key)
          const r0Split = isObject(d.r0Split) ? d.r0Split : {}
          if (d.r0K2 !== true) add('guardrail', `${unitId}: delivery ${i} does not respect the K2 reservation (R0-K2)`)
          if (!same(Object.keys(r0Split).sort(compare), sortedIds(k1Split)) || !Object.values(r0Split).every(x => x === true)) add('guardrail', `${unitId}: delivery ${i} R0-split does not hold for both supports`)
          const d2bOrdinal = d2bByKey.get(keySha256) ?? null
          const d2cMatch = d2cByKey.get(keySha256) ?? null
          const expectedAction = priorKeys.has(key) ? 'duplicate_of_lower_rung' : d2bOrdinal !== null ? 'same_key_as_d2b_k0_pool' : d2cMatch !== null ? 'same_key_as_d2c_k1_pool' : 'pooled'
          if (d.action !== expectedAction) add('raw_result_mismatch', `${unitId}: delivery ${i} action ${d.action} is not the replayed ${expectedAction}`)
          const matchedD2bOrdinal = expectedAction === 'same_key_as_d2b_k0_pool' ? d2bOrdinal : null
          const matchedD2cK1 = expectedAction === 'same_key_as_d2c_k1_pool' ? d2cMatch : null
          if ((d.matchedD2bOrdinal ?? null) !== matchedD2bOrdinal || !same(d.matchedD2cK1 ?? null, matchedD2cK1)) add('raw_result_mismatch', `${unitId}: delivery ${i} matched D2-B / D2-C ordinal`)
          deliveries.push({ indexInUnit: i, keySha256, cost: d.cost, action: expectedAction, r0K2: d.r0K2 === true, r0Split: structuredClone(r0Split), matchedD2bOrdinal, matchedD2cK1 })
          if (expectedAction !== 'pooled') return
          const p = recordPooled[pooledIndex] ?? null
          pooledIndex += 1
          const indexInContext = pool.length + 1
          if (p === null || p.candidateStableKey !== key || p.indexInUnit !== i || p.indexInContext !== indexInContext) { add('raw_result_mismatch', `${unitId}: the pooled Candidate of delivery ${i} differs from the replay`); return }
          const file = isObject(p.generatedEntryFile) ? p.generatedEntryFile as unknown as D2EFileRef : null
          const stored = file ? input.poolFiles.get(file.file) ?? null : null
          const issues: string[] = []
          if (file === null || stored === null || stored.sha256 !== file.sha256 || stored.bytes !== file.bytes) issues.push('the G store body is missing or not the one the child wrote')
          if (file !== null && file.file !== d2ePoolFileName(k2.contextId, indexInContext)) issues.push('the G store file name is not the context one')
          const body = stored !== null && isObject(stored.body) ? stored.body as unknown as BuildListEntry : null
          if (body === null || body.id !== p.generatedBuildListEntryId || body.targetWeaponId !== k2.targetWeaponId || !isObject(body.candidateSnapshot) || candidateStableKey(body.candidateSnapshot) !== key
            || body.candidateSnapshot.searchRunId !== p.searchIdentity) issues.push('the G store body is not the pooled G (ID / Target / stable key / Search identity)')
          if (issues.length > 0) add('evidence_integrity', `${unitId} ${k2.contextId} c${indexInContext}: ${issues.join('; ')}`)
          const replacement = isObject(p.replacement) ? { status: String(p.replacement.status), replacedBuildListEntryId: typeof p.replacement.replacedBuildListEntryId === 'string' ? p.replacement.replacedBuildListEntryId : null } : { status: 'missing', replacedBuildListEntryId: null }
          if (p.reusedExisting !== true && (replacement.status !== 'ready' || replacement.replacedBuildListEntryId !== k2.currentBuildListEntryId)) add('guardrail', `${unitId} c${indexInContext}: the G does not replace O_t03`)
          if (p.reservationDigest !== ctxRecord!.reservationDigest) add('guardrail', `${unitId} c${indexInContext}: the Search reservation digest is not the CTX-K2 digest`)
          if (p.searchIdentity !== searchIdentity) add('raw_result_mismatch', `${unitId} c${indexInContext}: the pooled Search identity is not the unit one`)
          if (!same(p.requiresSupport, k2.supportBuildListEntryIds)) add('raw_result_mismatch', `${unitId} c${indexInContext}: requiresSupport is not S`)
          const r0k2 = isObject(p.r0K2) && p.r0K2.respects === true
          if (!r0k2) add('guardrail', `${unitId} c${indexInContext}: R0-K2 fails`)
          const pc: D2EPoolCandidate = { ordinal: pool.length + 1, unitId, rung: rung!, indexInContext, indexInUnit: i, candidateStableKey: key, keySha256, cost: Number(p.cost), routeKind: String(p.routeKind),
            routeOperationCount: Number(p.routeOperationCount), r0K2: r0k2, r0Split: isObject(p.r0Split) ? structuredClone(p.r0Split) as Record<string, boolean> : {}, searchIdentity: String(p.searchIdentity),
            reservationDigest: String(p.reservationDigest), contextRecordSha256: ctxRow?.recordFile?.sha256 ?? null, requiresSupport: [...k2.supportBuildListEntryIds], generatedBuildListEntryId: String(p.generatedBuildListEntryId),
            reusedExisting: p.reusedExisting === true, generatedEntry: issues.length === 0 && file ? { file: file.file, bytes: file.bytes, sha256: file.sha256 } : null, replacement }
          pool.push(pc)
          poolByGenerated.set(pc.generatedBuildListEntryId, pc)
        })
        if (pooledIndex !== recordPooled.length) add('raw_result_mismatch', `${unitId}: the record pools ${recordPooled.length} Candidate(s), the replay ${pooledIndex}`)
        if (recordDeliveries.length > D2E_DELIVERIES_PER_UNIT_MAX) add('guardrail', `${unitId}: ${recordDeliveries.length} deliveries, above ${D2E_DELIVERIES_PER_UNIT_MAX}`)
        if (summary.deliveredCandidates !== recordDeliveries.length) add('raw_result_mismatch', `${unitId}: deliveredCandidates is not the delivery count`)
        let replayed: string | null
        try { replayed = d2DiscoveryUnitOutcome({ exhausted: summary.exhausted === true, stoppedByExtent: summary.stoppedByExtent === true }, summary.stoppedByConsumer === true, rung as never) } catch { replayed = null }
        if (replayed !== status) add('raw_result_mismatch', `${unitId}: the status ${status} is not the replayed ${replayed}`)
        if ((status === 'discovery_cap_reached') !== (pool.length === D2E_K2_POOL_CAP)) add('raw_result_mismatch', `${unitId}: the consumer stop and the full pool do not go together`)
      }
    }
    const timing = result && isObject(result.timing) ? result.timing : null
    const unmeasuredReason = status === null || measured || status === 'not_executed' ? null : status
    units.push({ ...base, status, unmeasuredReason, notExecutedReason: row.notExecutedReason, process: row.process, searchIdentity, reservationDigest: ctxRecord?.reservationDigest ?? null,
      summary, deliveries, poolSizeAtEnd: pool.length,
      searchOnlyMs: typeof timing?.searchOnlyMs === 'number' ? timing.searchOnlyMs : null, materializeMs: typeof timing?.materializeMs === 'number' ? timing.materializeMs : null,
      wallMs: typeof row.process?.wallMs === 'number' ? row.process.wallMs : null, ...memoryOf(record, row.process) })
    if (!measured) {
      discoveryStop = status === 'not_executed' ? 'not_executed' : 'unmeasured'
      discoveryDepends = { id: unitId, status, unmeasuredReason, notExecutedReason: row.notExecutedReason }
      break
    }
    let n: ReturnType<typeof d2eDiscoveryNext>
    try { n = d2eDiscoveryNext(status!, rung as never, pool.length) } catch (error) { add('guardrail', `${unitId}: ${(error as Error).message}`); break }
    discoveryStop = n.stop
    rung = n.next
  }
  for (const extra of dscRows) add('guardrail', `discovery row ${extra.unitId} is beyond the registered escalation`)
  if (pool.length > D2E_BUDGETS.uniqueCandidatesMax) add('guardrail', `${pool.length} pooled Candidates, above ${D2E_BUDGETS.uniqueCandidatesMax}`)
  const discoveryOutcome = d2eDiscoveryOutcome(discoveryStop)

  // ---- ADM (§5), then EXT (§6.2)
  const k2EvalRef = (p: D2EPoolCandidate): EvalRef => ({ label: k2!.label, targetWeaponId: k2!.targetWeaponId, currentBuildListEntryId: k2!.currentBuildListEntryId, generatedBuildListEntryId: p.generatedBuildListEntryId,
    sha256: p.generatedEntry?.sha256 ?? '', requiresSupport: [...k2!.supportBuildListEntryIds], contextId: ctxContextId, kind: 'k2', ordinal: p.ordinal })
  const admissions: Json[] = []
  const admitted: D2EPoolCandidate[] = []
  const admissionUnmeasured: number[] = []
  for (const p of pool) {
    const r = evaluateRow({ evaluationId: `ADM-K2-${k2!.label}-c${p.ordinal}`, stage: 'ADM', ordinal: p.ordinal, reps: [k2EvalRef(p)], registeredInputDigest: null, reusedExisting: p.reusedExisting })
    admissions.push(r.e)
    if (!isMeasured(r.status)) admissionUnmeasured.push(p.ordinal)
    if (isObject(r.e.r1r4) && r.e.r1r4.R1 === true) admitted.push(p)
  }
  const extensions: Json[] = []
  for (const p of pool.filter(x => admitted.includes(x) || admissionUnmeasured.includes(x.ordinal))) {
    const r = evaluateRow({ evaluationId: `EXT-K2-${k2!.label}-c${p.ordinal}`, stage: 'EXT', ordinal: p.ordinal, reps: [...i0Refs.map(incumbentRef), k2EvalRef(p)], registeredInputDigest: null })
    if (admissionUnmeasured.includes(p.ordinal) && (r.status !== 'not_executed' || r.e.notExecutedReason !== 'dependency_unmeasured')) {
      if (!(r.status === 'not_executed' && (r.e.notExecutedReason === 'rv_unmeasured' || r.e.notExecutedReason === 'aborted_after_invalid' || r.e.notExecutedReason === 'run_envelope_reached'))) add('raw_result_mismatch', `${String(r.e.evaluationId)}: an EXT after an unmeasured ADM must be not_executed (dependency_unmeasured)`)
    }
    if (!i0Measured && rvSatisfied && !admissionUnmeasured.includes(p.ordinal) && r.status !== 'not_executed') add('raw_result_mismatch', `${String(r.e.evaluationId)}: an EXT after an unmeasured I0 must be not_executed (i0_unmeasured)`)
    extensions.push(r.e)
  }
  for (const extra of rows) add('guardrail', `evaluation row ${extra.evaluationId} is beyond the registered evaluations`)

  // ---- budgets and the process count
  const startedEvals = evaluations.filter(e => e.process !== null).length
  const startedRv = rvRow !== null && rvRow.process !== null ? 1 : 0
  const startedCtx = ctxRow !== null && ctxRow.process !== null ? 1 : 0
  const startedDsc = units.filter(u => u.process !== null).length
  if (evaluations.length > D2E_BUDGETS.evaluationRequestsMax || startedEvals > D2E_BUDGETS.evaluationRequestsMax) add('guardrail', `more evaluations than the registered ${D2E_BUDGETS.evaluationRequestsMax}`)
  if (admissions.length > D2E_BUDGETS.admissionEvaluationsMax || extensions.length > D2E_BUDGETS.extensionEvaluationsMax) add('guardrail', 'more ADM / EXT than the registered 2 / 2')
  const startedChildren = startedRv + startedCtx + startedDsc + startedEvals
  if (startedChildren > D2E_BUDGETS.childProcessesMax) add('guardrail', `more child processes than the registered ${D2E_BUDGETS.childProcessesMax}`)
  if (input.childProcessCount !== null && input.childProcessCount !== startedChildren) add('guardrail', `${input.childProcessCount} child processes, not the ${startedChildren} started items`)
  const notExecutedRows = [{ notExecutedReason: rvStatus === 'not_executed' ? rvRow?.notExecutedReason ?? null : null }, { notExecutedReason: context.notExecutedReason }, ...units, ...evaluations]
  if (notExecutedRows.some(x => x.notExecutedReason === 'run_envelope_reached') && !input.runEnvelopeReached) add('raw_result_mismatch', 'run_envelope_reached rows without a reached run envelope')
  if (notExecutedRows.some(x => x.notExecutedReason === 'discovery_envelope_reached') && !input.discoveryEnvelopeReached) add('raw_result_mismatch', 'discovery_envelope_reached rows without a reached discovery envelope')
  const abortedRows = notExecutedRows.filter(x => x.notExecutedReason === 'aborted_after_invalid')
  if (!rvMeasured && rvRow !== null && rvRow.notExecutedReason === null && rvStatus !== null && v.passed) {
    for (const e of evaluations) if (e.status !== 'not_executed' || e.notExecutedReason !== 'rv_unmeasured') add('raw_result_mismatch', `${String(e.evaluationId)}: an evaluation after an unmeasured RV must be not_executed (rv_unmeasured)`)
  }

  // ---- determinism within D2-E (§9)
  const groups = new Map<string, Json[]>()
  for (const e of evaluations) if (typeof e.replayedInputDigest === 'string') groups.set(e.replayedInputDigest, [...(groups.get(e.replayedInputDigest) ?? []), e])
  const determinismCrossChecks: Json[] = []
  for (const [digest, list] of groups) {
    const comparable = list.filter(e => COMPARABLE_EVALUATION.includes(String(e.status)))
    const prior = v.priorByInputDigest[digest] ?? []
    if (list.length >= 2) {
      add('guardrail', `inputDigest ${digest} is held by ${list.length} D2-E evaluations (the registration holds none)`)
      const others = list.filter(e => !comparable.includes(e))
      let state: D2EParityState
      if (comparable.length >= 2) state = new Set(comparable.map(e => `${e.status}|${e.resultDigest}`)).size === 1 ? 'matched' : 'mismatched'
      else state = others.length > 0 ? 'not_checked' : 'not_applicable'
      parity({ checkId: `determinism_d2e:${digest}`, kind: 'determinism_d2e', state, subjects: list.map(e => String(e.evaluationId)), expected: null,
        observed: comparable.map(e => ({ id: e.evaluationId, status: e.status, resultDigest: e.resultDigest })), mismatches: state === 'mismatched' ? ['the comparable evaluations differ in status / resultDigest'] : [],
        notChecked: state === 'not_checked' ? { dependsOn: others.map(e => ({ id: String(e.evaluationId), status: e.status as string | null, unmeasuredReason: e.unmeasuredReason as string | null, notExecutedReason: e.notExecutedReason as string | null })) } : null,
        category: 'determinism' })
    }
    determinismCrossChecks.push({ inputDigest: digest, evaluationIds: list.map(e => String(e.evaluationId)), priorEvaluationIds: prior.map(x => `${x.source}:${x.evaluationId}`),
      comparableEvaluationIds: comparable.map(e => String(e.evaluationId)), state: list.length >= 2 ? 'checked_within_d2e' : prior.length > 0 ? (list[0]!.priorParity as Json).state : 'not_applicable',
      resultDigestsEqual: prior.length > 0 ? (list[0]!.priorParity as Json).resultDigestsEqual : null })
  }
  if (abortedRows.length > 0 && invalid.length === 0) add('raw_result_mismatch', `${abortedRows.length} row(s) aborted_after_invalid without an INVALID reason`)
  if (input.abortReason !== null && invalid.length === 0) add('raw_result_mismatch', `the runner aborted (${input.abortReason}) without an INVALID reason`)
  for (const check of parityChecks.filter(c => c.state === 'not_checked')) {
    const deps = isObject(check.notChecked) && Array.isArray(check.notChecked.dependsOn) ? check.notChecked.dependsOn as Json[] : []
    if (deps.length === 0 || deps.some(d => d.status === 'evaluated' || d.status === 'verified' || d.status === 'context_ready')) add('evidence_integrity', `${check.checkId}: not_checked without an unmeasured dependency`)
  }

  // ---- EXT ranking, comparison, aggregates and the decision
  const metricsOf = (e: Json | null): D2EMetrics | null => {
    if (e === null) return null
    const plan = e.plan as Json | null
    const t = plan && isObject(plan.termination) ? plan.termination : null
    return t ? { completed: Number(t.completedTargetCount), conflicts: (e.conflicts as unknown[]).length, steps: plan!.steps as number | null } : null
  }
  const ids = (pred: (e: Json) => boolean) => extensions.filter(pred).map(e => String(e.evaluationId))
  const eligibleMetrics = extensions.filter(e => e.eligible === true).map(e => ({ evaluationId: String(e.evaluationId), ordinal: Number(e.ordinal), ...metricsOf(e)!, steps: Number((e.plan as Json).steps) }))
  const order = [...eligibleMetrics].sort(compareD2ESelection)
  const improvedSet = new Set(ids(e => e.improved === true))
  const bestEligibleExtension = order[0]?.evaluationId ?? null
  const bestImprovedExtension = order.find(x => improvedSet.has(x.evaluationId))?.evaluationId ?? null
  const ranking = extensions.map(e => {
    const m = metricsOf(e)
    const rank = order.findIndex(x => x.evaluationId === e.evaluationId)
    return { ordinal: e.ordinal, evaluationId: e.evaluationId, eligible: e.eligible, improved: e.improved, improvementKind: e.improvementKind, completed: m?.completed ?? null, conflicts: m?.conflicts ?? null,
      steps: m?.steps ?? null, rank: rank < 0 ? null : rank + 1 }
  })
  const i0Json = i0Measured ? i0.e : null
  const subjectEval = bestEligibleExtension === null ? i0Json : extensions.find(e => e.evaluationId === bestEligibleExtension) ?? null
  const subjectMetrics = metricsOf(subjectEval)
  const unmeasured = [
    ...(rvMeasured ? [] : [D2E_RV_UNIT_ID]),
    ...(ctxStatus === 'context_ready' || ctxStatus === 'guardrail_violation' ? [] : [D2E_CONTEXT_UNIT_ID]),
    ...units.filter(u => !D2E_DISCOVERY_MEASURED.includes(u.status as D2EDiscoveryUnitStatus) && u.status !== 'guardrail_violation').map(u => String(u.unitId)),
    ...evaluations.filter(e => !isMeasured(e.status) && e.status !== 'guardrail_violation').map(e => String(e.evaluationId)),
  ]
  const boundLimitedEvaluations = evaluations.filter(e => e.boundLimited === true).map(e => String(e.evaluationId))
  const bestImprovedEval = bestImprovedExtension === null ? null : extensions.find(e => e.evaluationId === bestImprovedExtension) ?? null
  const decision = classifyD2EDecision({ invalidReasons: invalid, unmeasured, discoveryOutcome, pooledCandidates: pool.length, admittedCandidates: admitted.length,
    measuredAdmissions: admissions.filter(e => isMeasured(e.status)).length,
    r5SatisfiedExtensions: ids(e => (e.r5 as Json).satisfied === true), eligibleExtensions: ids(e => e.eligible === true), improvedExtensions: ids(e => e.improved === true),
    r5OnlyEligibleExtensions: ids(e => e.r5OnlyEligible === true), equalMetricsExtensions: ids(e => e.equalMetrics === true), conflictIncreasedExtensions: ids(e => e.conflictIncreased === true),
    t03SelectedExtensions: ids(e => isObject(e.extension) && isObject(e.extension.t03) && e.extension.t03.selected === true),
    t03CompletedWithoutNetGainExtensions: ids(e => isObject(e.extension) && isObject(e.extension.t03Completion) && e.extension.t03Completion.t03CompletedWithoutNetGain === true),
    incumbentRegressedExtensions: ids(e => isObject(e.extension) && isObject(e.extension.incumbentRetention) && e.extension.incumbentRetention.allIncumbentGeneratedSelected === false),
    r6SatisfiedExtensions: ids(e => (e.r6 as Json).satisfied === true), measuredExtensions: ids(e => ['evaluated', 'preflight_refused', 'planner_rerun_bound_reached'].includes(String(e.status))),
    bestEligibleExtension, bestImprovedExtension, improvementKind: (bestImprovedEval?.improvementKind ?? null) as 'completed_increase' | 'conflict_decrease_only' | null, boundLimitedEvaluations,
    subject: subjectEval === null || subjectMetrics === null ? null : { evaluationId: String(subjectEval.evaluationId), metrics: subjectMetrics }, i0Metrics: metricsOf(i0Json) })
  const comparison = {
    vsBaseline: decision.vsBaseline, vsD2cFinal: decision.vsD2cFinal, vsD2dBest: decision.vsD2dBest,
    byExtension: extensions.map(e => ({ evaluationId: e.evaluationId, vsI0: e.referenceDiff === null ? null : { completedDelta: (e.referenceDiff as Json).completedDelta, conflictDelta: (e.referenceDiff as Json).conflictDelta,
      stepsDelta: (e.referenceDiff as Json).stepsDelta, targetsGained: (e.referenceDiff as Json).targetsGained, targetsLost: (e.referenceDiff as Json).targetsLost },
      t03Selected: isObject(e.extension) && isObject(e.extension.t03) ? e.extension.t03.selected : null,
      t03TargetCompleted: isObject(e.extension) && isObject(e.extension.t03Completion) ? e.extension.t03Completion.t03TargetCompleted : null,
      r5Satisfied: (e.r5 as Json).satisfied, improved: e.improved })),
  }
  const countBy = <T,>(list: readonly T[], key: (x: T) => string | null) => list.reduce<Record<string, number>>((acc, x) => { const k = key(x); if (k !== null) acc[k] = (acc[k] ?? 0) + 1; return acc }, {})
  const judgedR5 = evaluations.filter(e => (e.r5 as Json).judged === true)
  const r6Judged = evaluations.filter(e => (e.r6 as Json).judged === true)
  const r6Satisfied = r6Judged.filter(e => (e.r6 as Json).satisfied === true)
  const r1Judged = admissions.filter(e => isObject(e.r1r4))
  const supportCauses = evaluations.flatMap(e => Object.values(e.supportChecksByEntry as Json)).filter(isObject).map(s => s.supportExpiryCause).filter((x): x is string => typeof x === 'string')
  const aggregates = {
    evaluations: { registeredMax: D2E_BUDGETS.evaluationRequestsMax, executed: startedEvals, registered: evaluations.length, measured: evaluations.filter(e => isMeasured(e.status)).length,
      unmeasuredByReason: countBy(evaluations.filter(e => !isMeasured(e.status) && e.status !== 'not_executed' && e.status !== 'guardrail_violation'), e => String(e.status)),
      notExecutedByReason: countBy(evaluations.filter(e => e.status === 'not_executed'), e => String(e.notExecutedReason)), byStage: countBy(evaluations, e => String(e.stage)), byStatus: countBy(evaluations, e => String(e.status)) },
    discovery: { registeredMaxUnits: D2E_BUDGETS.discoveryUnitsMax, executedUnits: startedDsc, pooledCandidates: pool.length, deliveriesByAction: countBy(units.flatMap(u => u.deliveries as Json[]), d => String(d.action)) },
    childProcesses: { registeredMax: D2E_BUDGETS.childProcessesMax, started: startedChildren },
    fullPlannerRunsStarted: evaluations.reduce((s, e) => s + (typeof e.fullRunsStarted === 'number' ? e.fullRunsStarted : 0), 0),
    runtimeUnsupportedRetries: evaluations.reduce((s, e) => s + (e.runtimeUnsupportedRemoved as unknown[]).length, 0),
    r1: { judged: r1Judged.length, satisfied: r1Judged.filter(e => (e.r1r4 as Json).R1 === true).length },
    r5: { judged: judgedR5.length, satisfied: judgedR5.filter(e => (e.r5 as Json).satisfied === true).length },
    r6: { judged: r6Judged.length, satisfied: r6Satisfied.length, satisfiedEvaluationIds: r6Satisfied.map(e => String(e.evaluationId)) },
    boundLimitedEvaluations,
    supportOutcomes: { notSelected: supportCauses.filter(c => c === 'support_not_selected').length, expiredByCause: countBy(supportCauses.filter(c => c !== 'support_not_selected'), c => c) },
    determinismCrossChecks,
    parity: { byKindAndState: countBy(parityChecks, c => `${c.kind}:${c.state}`), mismatched: parityChecks.filter(c => c.state === 'mismatched').map(c => c.checkId),
      notChecked: parityChecks.filter(c => c.state === 'not_checked').map(c => ({ checkId: c.checkId, dependsOn: isObject(c.notChecked) ? c.notChecked.dependsOn : [] })) },
  }
  const rv = { status: rvStatus, unmeasuredReason: rvUnmeasuredReason, notExecutedReason: rvStatus === 'not_executed' ? notExecutedOf(rvRow) : null, process: rvRow?.process ?? null,
    record: rvRow?.recordFile ?? null, candidates: rvCandidates, supports: rvSupports, satisfied: rvSatisfied, wallMs: typeof rvRow?.process?.wallMs === 'number' ? rvRow.process.wallMs : null,
    ...memoryOf(rvRecord, rvRow?.process ?? null) }
  const discovery = { units, pool, outcome: discoveryOutcome, stop: discoveryStop, dependsOn: discoveryDepends }
  return { rv, context, discovery, evaluations, parityChecks, extensions: { ranking, bestEligibleExtension, bestImprovedExtension }, comparison, aggregates, invalidReasons: invalid, decision, unmeasured }
}
