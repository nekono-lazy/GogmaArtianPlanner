/**
 * Issue #154 D2-B post-hoc analysis. Research only. Never import from Production.
 *
 * Re-derives every judgement of a D2 run from the run dir records (never from the runner's own judgement): the discovery rung
 * escalation and pools (§2.3), the G store bodies, each evaluation's status, `inputDigest` / `resultDigest`, R1 (§3), R5 (the
 * D1 analyzer's independent implementation, cross-checked against `judgeD1R5()`), R6 (§6.4), the gate and the selection order
 * (§4.2 / §4.3), the CMP / Z composition replay (§4 / §5), every parity check with its four states (§7.3), the evidence integrity
 * (§8.5) and both decisions (§9). It reads no oracle, Phase B analysis or population-authority module (a test walks the import
 * closure); the Phase B / D1 RESULTs are read through the D2 allowlists only (by `validateD2Inputs()`).
 */
import { stableStringify } from '../domain/models/hashing'
import type { BuildListEntry } from '../domain/models/publicTypes'
import { candidateStableKey } from '../domain/search'
import { d1B0Parity, d1InputDigest, d1ResultDigest, isD1BoundLimited, judgeD1R5, D1_CALCULATION_CONTEXT, D1_RESEARCH_MAX_PLAN_STEPS, D1_RNG_ENGINE_VERSION, type D1EvaluationStatus } from './plannerGlobalD1'
import { judgeD1R5Independently } from './plannerGlobalD1Analysis'
import {
  d2AdmissionId,
  d2Axis,
  d2Better,
  d2CompositionId,
  d2CompositionStep,
  d2D1GeneratedParity,
  d2DiscoveryNext,
  d2DiscoveryUnitId,
  d2DiscoveryUnitOutcome,
  d2DroppedTargetIndexes,
  d2EvaluatedAgainst,
  d2PhaseBPrefixParity,
  d2R1R4,
  d2SeededId,
  d2TargetLabel,
  judgeD2R6,
  D2_BUDGETS,
  D2_COMPARABLE_EVALUATION,
  D2_COMPARISON_BASELINES,
  D2_DISCOVERY_MEASURED,
  D2_EVALUATION_FULL_RUN_CAP,
  D2_MEASURED_EVALUATION,
  D2_POOL_CAP,
  type D2Axis,
  type D2DiscoveryStop,
  type D2DiscoveryUnitStatus,
  type D2EvaluatedAgainst,
  type D2EvaluationFacts,
  type D2EvaluationStatus,
  type D2ParityState,
  type D2R6Judgement,
  type D2Stage,
  type D2StepOutcome,
  type D2ValidatedInputs,
} from './plannerGlobalD2'
import { PHASE2C27B_RUNG_IDS, type Phase2C27BRungId } from './plannerGlobalPhase2C27B'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const UNMEASURED_PROCESS = ['timeout', 'out_of_memory', 'process_failure', 'interrupted'] as const

export type D2InvalidCategory = 'input_evidence' | 'provenance' | 'phase_b_k0_parity' | 'd1_parity' | 'baseline_parity_mismatch' | 'guardrail' | 'determinism' | 'evidence_integrity' | 'raw_result_mismatch'
export interface D2InvalidReason { category: D2InvalidCategory; detail: string }
export type D2DecisionCase = 'D2A_INVALID' | 'D2A_INCOMPLETE' | 'D2A_GLOBAL_COMPLETE_R' | 'D2A_EXCEEDS_D1_INCUMBENT' | 'D2A_IMPROVED_OVER_BASELINE' | 'D2A_NO_IMPROVEMENT'
export type D2SeededCase = 'D2A_Z_INCOMPLETE' | 'D2A_Z_GLOBAL_COMPLETE_R' | 'D2A_Z_EXTENDS_D1_INCUMBENT' | 'D2A_Z_NO_EXTENSION' | null

// ---------------------------------------------------------------- the decisions (§9.2 / §9.3)

export interface D2Metrics { completed: number; conflicts: number; steps: number | null }

export interface D2DecisionInput {
  invalidReasons: readonly D2InvalidReason[]
  /** Main-axis (DSC / B0 / ADM / CMP) units and evaluations that are unmeasured or not executed. */
  mainUnmeasured: readonly string[]
  finalAcceptedCount: number
  finalMetrics: D2Metrics | null
  finalR6: boolean
  boundLimitedEvaluations: readonly string[]
  newCandidateAccepted: number
}

export function classifyD2Decision(input: D2DecisionInput) {
  const base = { boundLimitedEvaluations: [...input.boundLimitedEvaluations], newCandidateAccepted: input.newCandidateAccepted }
  const metrics = input.finalMetrics
  const equalsD1 = metrics !== null && metrics.completed === D2_COMPARISON_BASELINES.d1Incumbent.completed && metrics.conflicts === D2_COMPARISON_BASELINES.d1Incumbent.conflicts
  const exceedsD1 = metrics !== null && input.finalAcceptedCount >= 1 && d2Better(metrics, D2_COMPARISON_BASELINES.d1Incumbent)
  if (input.invalidReasons.length > 0) {
    return { case: 'D2A_INVALID' as D2DecisionCase, reasons: input.invalidReasons.map(r => `${r.category}: ${r.detail}`), lowerBound: false, ...base, equalsD1IncumbentMetrics: false,
      globalCompleteObservedUnderIncomplete: false, exceedsD1ObservedUnderIncomplete: false }
  }
  if (input.mainUnmeasured.length > 0) {
    return { case: 'D2A_INCOMPLETE' as D2DecisionCase, reasons: [`${input.mainUnmeasured.length} main-axis unit(s) / evaluation(s) unmeasured or not executed: ${input.mainUnmeasured.join(', ')}; the measured evidence is a lower bound`,
      `measured final: ${metrics === null ? 'none' : `${metrics.completed} completed / ${metrics.conflicts} Conflicts / ${metrics.steps} steps`} with ${input.finalAcceptedCount} accepted`],
    lowerBound: true, ...base, equalsD1IncumbentMetrics: equalsD1, globalCompleteObservedUnderIncomplete: input.finalR6, exceedsD1ObservedUnderIncomplete: exceedsD1 }
  }
  const tail = { lowerBound: false, ...base, equalsD1IncumbentMetrics: equalsD1, globalCompleteObservedUnderIncomplete: false, exceedsD1ObservedUnderIncomplete: false }
  if (input.finalR6) return { case: 'D2A_GLOBAL_COMPLETE_R' as D2DecisionCase, reasons: ['finalResult satisfies R6 (43 / 43, Conflict 0, no resource_conflict, Trace Replay, R5)'], ...tail }
  if (exceedsD1) return { case: 'D2A_EXCEEDS_D1_INCUMBENT' as D2DecisionCase, reasons: [`finalResult ${metrics!.completed} / ${metrics!.conflicts} is better than the D1 incumbent 22 / 21`], ...tail }
  if (metrics !== null && d2Better(metrics, D2_COMPARISON_BASELINES.baseline)) {
    return { case: 'D2A_IMPROVED_OVER_BASELINE' as D2DecisionCase, reasons: [`finalResult ${metrics.completed} / ${metrics.conflicts} is better than the baseline 20 / 21${equalsD1 ? ' and equals the D1 incumbent' : ''}`], ...tail }
  }
  return { case: 'D2A_NO_IMPROVEMENT' as D2DecisionCase, reasons: ['the registered procedure accepted no set better than the baseline (not a proof that K0 Candidates cannot improve it)',
    ...(input.boundLimitedEvaluations.length > 0 ? [`bound-limited evaluations: ${input.boundLimitedEvaluations.join(', ')}`] : [])], ...tail }
}

export interface D2SeededDecisionInput {
  invalid: boolean
  /** Z0, the Z evaluations, or the DSC / ADM of the dropped 7 that are unmeasured or not executed. */
  seededUnmeasured: readonly string[]
  z0ParityState: D2ParityState
  addedTargets: readonly string[]
  finalMetrics: D2Metrics | null
  finalR6: boolean
}

export function classifyD2SeededDecision(input: D2SeededDecisionInput) {
  const base = { z0ParityState: input.z0ParityState, addedTargets: [...input.addedTargets], finalMetrics: input.finalMetrics }
  if (input.invalid) return { case: null as D2SeededCase, reasons: ['the run is D2A_INVALID: Z is not interpreted'], lowerBound: false, ...base }
  if (input.seededUnmeasured.length > 0) return { case: 'D2A_Z_INCOMPLETE' as D2SeededCase, reasons: [`unmeasured / not executed: ${input.seededUnmeasured.join(', ')}`], lowerBound: true, ...base }
  if (input.finalR6) return { case: 'D2A_Z_GLOBAL_COMPLETE_R' as D2SeededCase, reasons: ['the Z final result satisfies R6'], lowerBound: false, ...base }
  if (input.addedTargets.length > 0) return { case: 'D2A_Z_EXTENDS_D1_INCUMBENT' as D2SeededCase, reasons: [`accepted beyond the seed: ${input.addedTargets.join(', ')}`], lowerBound: false, ...base }
  return { case: 'D2A_Z_NO_EXTENSION' as D2SeededCase, reasons: ['no Target accepted beyond the seed'], lowerBound: false, ...base }
}

// ---------------------------------------------------------------- the run analysis

export interface D2FileRef { file: string; bytes: number; sha256: string }

export interface D2DiscoveryRow {
  unitId: string
  targetIndex: number
  rung: Phase2C27BRungId
  status: string | null
  notExecutedReason: string | null
  process: Json | null
  recordFile: D2FileRef | null
}

export interface D2EvaluationRow {
  evaluationId: string
  stage: D2Stage
  axis: D2Axis
  evaluatedAgainst: D2EvaluatedAgainst
  targetIndex: number | null
  poolOrdinal: number | null
  replacementTargetIndexes: number[]
  replacementTargets: string[]
  generatedEntryIds: string[]
  generatedEntrySha256s: (string | null)[]
  requiresSupport: string[]
  inputDigest: string | null
  status: string | null
  notExecutedReason: string | null
  process: Json | null
  recordFile: D2FileRef | null
  runner: Json | null
}

export interface D2CompositionRow {
  axis: 'main' | 'seeded'
  label: string
  targetIndex: number
  acceptedBefore: string[]
  evaluatedCandidates: { evaluationId: string; ordinal: number }[]
  eligible: string[]
  chosen: string | null
  stepOutcome: D2StepOutcome
  stepNotEvaluatedReason: string | null
  acceptedAfter: string[]
  afterUnmeasuredStep: boolean
}

export interface D2AnalysisInput {
  validated: D2ValidatedInputs
  exportSha256: string
  discoveryRows: readonly D2DiscoveryRow[]
  /** By unit ID: the child record (null = none). */
  discoveryRecords: ReadonlyMap<string, Json | null>
  /** By G store file name: the file read back (null = missing). */
  poolFiles: ReadonlyMap<string, { bytes: number; sha256: string; body: unknown } | null>
  evaluationRows: readonly D2EvaluationRow[]
  evaluationRecords: ReadonlyMap<string, Json | null>
  compositionRows: readonly D2CompositionRow[] | null
  /** The run ended without a raw output (interrupted). */
  interrupted: boolean
  runEnvelopeReached: boolean
  abortReason: string | null
  provenanceIssues: readonly string[]
  /** Missing / changed record or G store files and missing required fields found by the caller (§8.5). */
  evidenceIssues: readonly string[]
  rawConsistencyIssues: readonly string[]
  childProcessCount: number | null
  sha256OfText: (text: string) => string
}

type RowStatus = D2DiscoveryUnitStatus | D2EvaluationStatus
/** One row's status from the files: not executed, then the process outcome, then the child record's own status. */
function statusFromFiles(process: Json | null, record: Json | null, notExecutedReason: string | null, interrupted: boolean, missingRecord: (detail: string) => void): RowStatus | null {
  if (notExecutedReason !== null) return 'not_executed'
  if (process === null) return interrupted ? 'interrupted' : null
  const outcome = process.outcome
  if (outcome !== 'completed') return (UNMEASURED_PROCESS as readonly unknown[]).includes(outcome) ? outcome as RowStatus : 'process_failure'
  if (record === null || !isObject(record.result) || typeof record.result.status !== 'string') { missingRecord('completed with no readable record'); return null }
  return record.result.status as RowStatus
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
  'resultDigest', 'rejectedBuildListEntries', 'resourceConflictRejections', 'selectedTargetWeaponIds'] as const

export interface D2PoolCandidate {
  ordinal: number
  unitId: string
  rung: Phase2C27BRungId
  indexInUnit: number
  candidateStableKey: string
  keySha256: string
  cost: number
  routeKind: string
  routeOperationCount: number
  reservationCheck: { respects: boolean }
  searchIdentity: string
  generatedBuildListEntryId: string
  reusedExisting: boolean
  generatedEntry: { file: string; sha256: string } | null
  replacement: { status: string; replacedBuildListEntryId: string | null }
  isD1Candidate: boolean
  d1Parity: { state: D2ParityState; mismatches: string[]; notChecked: unknown }
}

interface ReplacementRef { targetIndex: number; generatedBuildListEntryId: string; sha256: string | null; requiresSupport: string[]; poolOrdinal: number | null; isSeed: boolean }

export function analyzeD2Run(input: D2AnalysisInput) {
  const invalid: D2InvalidReason[] = []
  const add = (category: D2InvalidCategory, detail: string) => invalid.push({ category, detail })
  const v = input.validated
  if (!v.passed) for (const issue of v.issues) add('input_evidence', issue)
  for (const issue of input.provenanceIssues) add('provenance', issue)
  for (const issue of input.evidenceIssues) add('evidence_integrity', issue)
  for (const issue of input.rawConsistencyIssues) add('raw_result_mismatch', issue)
  const sha = input.sha256OfText
  const targets = v.targets
  const parityChecks: Json[] = []
  const parity = (check: { checkId: string; kind: string; axis: 'main' | 'seeded'; state: D2ParityState; subjects: string[]; expected: unknown; observed: unknown; mismatches: string[];
    notChecked: { dependsOn: { id: string; status: string | null; unmeasuredReason: string | null; notExecutedReason: string | null }[] } | null; observedPrefixDiagnostic?: unknown; category: D2InvalidCategory }) => {
    parityChecks.push({ ...check, observedPrefixDiagnostic: check.observedPrefixDiagnostic ?? null, category: check.state === 'mismatched' ? check.category : null })
    if (check.state === 'mismatched') add(check.category, `${check.checkId}: ${check.mismatches.join('; ')}`)
  }

  // ---- DSC: replay the rung escalation and the pools (§2.3)
  const unitRows = new Map<number, D2DiscoveryRow[]>()
  for (const row of input.discoveryRows) unitRows.set(row.targetIndex, [...(unitRows.get(row.targetIndex) ?? []), row])
  if (input.discoveryRows.length > D2_BUDGETS.discoveryUnitsMax) add('guardrail', `${input.discoveryRows.length} discovery units, above ${D2_BUDGETS.discoveryUnitsMax}`)
  const units: Json[] = []
  const pools = new Map<number, D2PoolCandidate[]>()
  const discoveryStops = new Map<number, { stop: D2DiscoveryStop; incompleteAfterUnmeasured: boolean; dependsOn: { id: string; status: string | null; unmeasuredReason: string | null; notExecutedReason: string | null } | null }>()
  const discoveryTargets: Json[] = []
  for (const t of targets) {
    const rows = [...(unitRows.get(t.targetIndex) ?? [])]
    const pool: D2PoolCandidate[] = []
    let rung: Phase2C27BRungId | null = 'L0'
    let stop: D2DiscoveryStop | null = null
    let dependsOn: { id: string; status: string | null; unmeasuredReason: string | null; notExecutedReason: string | null } | null = null
    const executedRungs = new Map<Phase2C27BRungId, { status: RowStatus | null; comparable: boolean; unitId: string; notExecutedReason: string | null }>()
    while (rung !== null) {
      const unitId = d2DiscoveryUnitId(t.targetIndex, rung)
      const row = rows.shift() ?? null
      if (row === null) {
        if (input.interrupted) {
          units.push({ unitId, targetWeaponId: t.targetWeaponId, label: t.label, rung, status: 'not_executed', notExecutedReason: 'interrupted', unmeasuredReason: null, process: null,
            poolSizeAtStart: pool.length, poolSizeAtEnd: pool.length, deliveries: [], search: null, phaseBParity: null, searchOnlyMs: null, materializeMs: null, wallMs: null, peakHeapBytes: null, peakRssBytes: null })
          executedRungs.set(rung, { status: 'not_executed', comparable: false, unitId, notExecutedReason: 'interrupted' })
          stop = 'not_executed'; dependsOn = { id: unitId, status: 'not_executed', unmeasuredReason: null, notExecutedReason: 'interrupted' }
        } else { add('evidence_integrity', `${unitId}: the registered unit has no row`); stop = 'not_executed' }
        break
      }
      if (row.unitId !== unitId || row.rung !== rung) { add('guardrail', `discovery row ${row.unitId} is not the registered next unit ${unitId}`); stop = 'unmeasured'; break }
      const record = input.discoveryRecords.get(unitId) ?? null
      let status = statusFromFiles(row.process, record, row.notExecutedReason, input.interrupted, d => add('evidence_integrity', `${unitId}: ${d}`))
      if (row.status !== status) add('raw_result_mismatch', `${unitId}: the row status ${row.status} is not the record status ${status}`)
      const result = record !== null && isObject(record.result) ? record.result : null
      const measured = status !== null && D2_DISCOVERY_MEASURED.includes(status as D2DiscoveryUnitStatus)
      const deliveries: Json[] = []
      let search: Json | null = null
      const poolSizeAtStart = pool.length
      if (status === 'guardrail_violation') add('guardrail', `${unitId}: ${JSON.stringify(result?.issues ?? [])}`)
      if (record !== null && status !== 'not_executed') for (const issue of recordCalculationIssues(record)) add('guardrail', `${unitId}: ${issue}`)
      if (measured && result !== null) {
        const ok = Array.isArray(result.deliveries) && Array.isArray(result.pooled) && isObject(result.search) && result.poolSizeAtStart === poolSizeAtStart && result.unitId === unitId
          && typeof result.originDigest === 'string' && typeof result.reservationDigest === 'string'
        if (!ok) { add('evidence_integrity', `${unitId}: the measured record lacks deliveries / pooled / search / poolSizeAtStart / digests or they differ from the replay`); status = null }
        else {
          search = result.search as Json
          const priorKeys = new Set(pool.map(p => p.candidateStableKey))
          const recordDeliveries = result.deliveries as Json[]
          const recordPooled = result.pooled as Json[]
          if (result.reservationDigest !== v.k0ReservationDigest) add('guardrail', `${unitId}: the unit reservation is not the registered K0 reservation`)
          let pooledIndex = 0
          recordDeliveries.forEach((d, i) => {
            const key = typeof d.candidateStableKey === 'string' ? d.candidateStableKey : ''
            const keySha256 = sha(key)
            if (d.indexInUnit !== i) add('raw_result_mismatch', `${unitId}: delivery ${i} index`)
            if (typeof d.keySha256 === 'string' && d.keySha256 !== keySha256) add('raw_result_mismatch', `${unitId}: delivery ${i} key SHA-256 is not sha256(key)`)
            const expectedAction = priorKeys.has(key) ? 'duplicate_of_lower_rung' : 'pooled'
            if (d.action !== expectedAction) add('raw_result_mismatch', `${unitId}: delivery ${i} action ${d.action} is not the replayed ${expectedAction}`)
            if (!isObject(d.reservationCheck) || d.reservationCheck.respects !== true) add('guardrail', `${unitId}: delivery ${i} does not respect the K0 reservation (R0)`)
            deliveries.push({ indexInUnit: i, keySha256, cost: d.cost, action: d.action })
            if (expectedAction !== 'pooled') return
            const p = recordPooled[pooledIndex] ?? null
            pooledIndex += 1
            const ordinal = pool.length + 1
            if (p === null || p.candidateStableKey !== key || p.indexInUnit !== i || p.ordinal !== ordinal) { add('raw_result_mismatch', `${unitId}: the pooled Candidate of delivery ${i} differs from the replay`); return }
            const file = isObject(p.generatedEntryFile) ? p.generatedEntryFile as unknown as D2FileRef : null
            const stored = file ? input.poolFiles.get(file.file) ?? null : null
            const issues: string[] = []
            if (file === null || stored === null || stored.sha256 !== file.sha256 || stored.bytes !== file.bytes) issues.push('the G store body is missing or not the one the child wrote')
            const body = stored !== null && isObject(stored.body) ? stored.body as unknown as BuildListEntry : null
            if (body === null || body.id !== p.generatedBuildListEntryId || body.targetWeaponId !== t.targetWeaponId || !isObject(body.candidateSnapshot) || candidateStableKey(body.candidateSnapshot) !== key) issues.push('the G store body is not the pooled G (ID / Target / stable key)')
            if (issues.length > 0) add('evidence_integrity', `${unitId} c${ordinal}: ${issues.join('; ')}`)
            const replacement = isObject(p.replacement) ? { status: String(p.replacement.status), replacedBuildListEntryId: typeof p.replacement.replacedBuildListEntryId === 'string' ? p.replacement.replacedBuildListEntryId : null } : { status: 'missing', replacedBuildListEntryId: null }
            // D1-A §4.1: a replacement that is not ready / not O_t is an invariant violation (never an R1 false).
            if (p.reusedExisting !== true && (replacement.status !== 'ready' || replacement.replacedBuildListEntryId !== t.currentBuildListEntryId)) add('guardrail', `${unitId} c${ordinal}: the G does not replace O_t`)
            if (!isObject(p.reservationCheck) || p.reservationCheck.respects !== true) add('guardrail', `${unitId} c${ordinal}: R0 reservation check fails under K0`)
            pool.push({ ordinal, unitId, rung: rung!, indexInUnit: i, candidateStableKey: key, keySha256, cost: Number(p.cost), routeKind: String(p.routeKind), routeOperationCount: Number(p.routeOperationCount),
              reservationCheck: { respects: isObject(p.reservationCheck) && p.reservationCheck.respects === true }, searchIdentity: String(p.searchIdentity), generatedBuildListEntryId: String(p.generatedBuildListEntryId),
              reusedExisting: p.reusedExisting === true, generatedEntry: issues.length === 0 && file ? { file: file.file, sha256: file.sha256 } : null, replacement,
              isD1Candidate: t.d1Generated !== null && String(p.generatedBuildListEntryId) === t.d1Generated.buildListEntryId, d1Parity: { state: 'not_applicable', mismatches: [], notChecked: null } })
          })
          if (pooledIndex !== recordPooled.length) add('raw_result_mismatch', `${unitId}: the record pools ${recordPooled.length} Candidate(s), the replay ${pooledIndex}`)
          if (recordDeliveries.length > D2_BUDGETS.deliveriesPerUnitMax) add('guardrail', `${unitId}: ${recordDeliveries.length} deliveries, above ${D2_BUDGETS.deliveriesPerUnitMax}`)
          if (search.deliveredCandidates !== recordDeliveries.length) add('raw_result_mismatch', `${unitId}: deliveredCandidates is not the delivery count`)
          let replayed: string | null
          try { replayed = d2DiscoveryUnitOutcome({ exhausted: search.exhausted === true, stoppedByExtent: search.stoppedByExtent === true }, search.stoppedByConsumer === true, rung) } catch { replayed = null }
          if (replayed !== status) add('raw_result_mismatch', `${unitId}: the status ${status} is not the replayed ${replayed}`)
          if ((status === 'discovery_cap_reached') !== (pool.length === D2_POOL_CAP)) add('raw_result_mismatch', `${unitId}: the consumer stop and the full pool do not go together`)
        }
      }
      const comparable = status !== null && (measured || status === 'discovery_calculation_error' || status === 'guardrail_violation')
      executedRungs.set(rung, { status, comparable, unitId, notExecutedReason: row.notExecutedReason })
      // Phase B K0 prefix parity (§7.3.3)
      const expected = t.phaseBK0Units[rung]
      let phaseBParity: Json
      if (expected) {
        const firstKey = deliveries[0]?.keySha256 as string | undefined
        const p = d2PhaseBPrefixParity(expected, { comparable, status: (status ?? 'process_failure') as D2DiscoveryUnitStatus, deliveredCandidates: search ? Number(search.deliveredCandidates) : null, firstKeySha256: firstKey ?? null })
        const notChecked = p.state === 'not_checked' ? { dependsOn: [{ id: unitId, status, unmeasuredReason: status === 'not_executed' ? null : status, notExecutedReason: row.notExecutedReason }] } : null
        phaseBParity = { state: p.state, phaseBUnitId: expected.phaseBUnitId, mismatches: p.mismatches, notChecked, observedPrefixDiagnostic: null }
        parity({ checkId: `phase_b_k0_prefix:${expected.phaseBUnitId}`, kind: 'phase_b_k0_prefix', axis: 'main', state: p.state, subjects: [unitId],
          expected: { result: expected.result, firstKeySha256: expected.firstKeySha256, cost: expected.firstCost }, observed: { status, firstKeySha256: firstKey ?? null, deliveredCandidates: search?.deliveredCandidates ?? null },
          mismatches: p.mismatches, notChecked, category: 'phase_b_k0_parity' })
      } else phaseBParity = { state: 'not_applicable', phaseBUnitId: null, mismatches: [], notChecked: null, observedPrefixDiagnostic: null }
      const timing = result && isObject(result.timing) ? result.timing : null
      const unmeasuredReason = status === null || measured || status === 'not_executed' ? null : status
      units.push({ unitId, targetWeaponId: t.targetWeaponId, label: t.label, rung, status, unmeasuredReason, notExecutedReason: row.notExecutedReason, process: row.process,
        poolSizeAtStart, poolSizeAtEnd: pool.length, deliveries, search, phaseBParity, searchOnlyMs: typeof timing?.searchOnlyMs === 'number' ? timing.searchOnlyMs : null,
        materializeMs: typeof timing?.materializeMs === 'number' ? timing.materializeMs : null, wallMs: typeof row.process?.wallMs === 'number' ? row.process.wallMs : null, ...memoryOf(record, row.process) })
      if (!measured || status === null) {
        stop = status === 'not_executed' ? 'not_executed' : 'unmeasured'
        dependsOn = { id: unitId, status, unmeasuredReason, notExecutedReason: row.notExecutedReason }
        break
      }
      const next = d2DiscoveryNext(status as D2DiscoveryUnitStatus, rung, pool.length)
      rung = next.next
      stop = next.stop
    }
    for (const extra of rows) add('guardrail', `discovery row ${extra.unitId} is beyond the registered escalation of ${t.label}`)
    // Phase B units D2 never reached: not_checked when an unmeasured unit stopped the ladder before them, else not applicable.
    for (const r of PHASE2C27B_RUNG_IDS) {
      const expected = t.phaseBK0Units[r]
      if (!expected || executedRungs.has(r)) continue
      const state: D2ParityState = stop === 'unmeasured' || stop === 'not_executed' ? 'not_checked' : 'not_applicable'
      if (state === 'not_applicable') add('guardrail', `${expected.phaseBUnitId}: a Phase B K0 unit D2 never reached although its ladder ended measured`)
      parity({ checkId: `phase_b_k0_prefix:${expected.phaseBUnitId}`, kind: 'phase_b_k0_prefix', axis: 'main', state, subjects: [d2DiscoveryUnitId(t.targetIndex, r)], expected: { result: expected.result, firstKeySha256: expected.firstKeySha256 },
        observed: null, mismatches: [], notChecked: state === 'not_checked' && dependsOn ? { dependsOn: [dependsOn] } : null, category: 'phase_b_k0_parity' })
    }
    // D1 G parity (§7.3.3): pool 1 of a Target whose Phase B first K0 delivery exists, when that unit and every earlier one are comparable.
    if (t.d1Generated !== null && t.firstK0DeliveryRung !== null) {
      const needed = PHASE2C27B_RUNG_IDS.slice(0, PHASE2C27B_RUNG_IDS.indexOf(t.firstK0DeliveryRung) + 1)
      const unmeasured = needed.map(r => executedRungs.get(r)).filter(u => u === undefined || !u.comparable)
      const expectedKey = t.phaseBK0Units[t.firstK0DeliveryRung]?.firstKeySha256 ?? ''
      let state: D2ParityState, mismatches: string[] = []
      if (unmeasured.length > 0) state = 'not_checked'
      else {
        const p1 = pool[0] ?? null
        const p = d2D1GeneratedParity({ keySha256: expectedKey, buildListEntryId: t.d1Generated.buildListEntryId, sha256: t.d1Generated.sha256 },
          p1 === null ? null : { keySha256: p1.keySha256, generatedBuildListEntryId: p1.generatedBuildListEntryId, generatedEntrySha256: p1.generatedEntry?.sha256 ?? null })
        state = p.state; mismatches = p.mismatches
      }
      const notChecked = state === 'not_checked' ? { dependsOn: needed.filter(r => !executedRungs.get(r)?.comparable).map(r => {
        const u = executedRungs.get(r)
        return { id: d2DiscoveryUnitId(t.targetIndex, r), status: u?.status ?? 'not_executed', unmeasuredReason: u && u.status !== 'not_executed' ? u.status : null, notExecutedReason: u ? u.notExecutedReason : 'not_reached' }
      }) } : null
      if (pool[0]) pool[0].d1Parity = { state, mismatches, notChecked }
      parity({ checkId: `d1_generated_entry:${t.label}`, kind: 'd1_generated_entry', axis: 'main', state, subjects: pool[0] ? [`${pool[0].unitId}#c1`] : needed.map(r => d2DiscoveryUnitId(t.targetIndex, r)),
        expected: { keySha256: expectedKey, generatedBuildListEntryId: t.d1Generated.buildListEntryId, sha256: t.d1Generated.sha256 },
        observed: pool[0] ? { keySha256: pool[0].keySha256, generatedBuildListEntryId: pool[0].generatedBuildListEntryId, sha256: pool[0].generatedEntry?.sha256 ?? null } : null,
        mismatches, notChecked, category: 'd1_parity' })
    }
    pools.set(t.targetIndex, pool)
    const finalStop: D2DiscoveryStop = stop ?? 'unmeasured'
    discoveryStops.set(t.targetIndex, { stop: finalStop, incompleteAfterUnmeasured: (finalStop === 'unmeasured' || finalStop === 'not_executed') && pool.length > 0, dependsOn })
    discoveryTargets.push({ targetWeaponId: t.targetWeaponId, label: t.label, currentBuildListEntryId: t.currentBuildListEntryId, oTSelectedInB0: null, discoveryStop: finalStop,
      discoveryIncompleteAfterUnmeasured: (finalStop === 'unmeasured' || finalStop === 'not_executed') && pool.length > 0,
      pool: pool.map(p => ({ ordinal: p.ordinal, unitId: p.unitId, rung: p.rung, indexInUnit: p.indexInUnit, candidateStableKey: p.candidateStableKey, keySha256: p.keySha256, cost: p.cost,
        routeKind: p.routeKind, routeOperationCount: p.routeOperationCount, reservationCheck: p.reservationCheck, searchIdentity: p.searchIdentity, generatedBuildListEntryId: p.generatedBuildListEntryId,
        reusedExisting: p.reusedExisting, generatedEntry: p.generatedEntry, replacement: p.replacement, isD1Candidate: p.isD1Candidate, d1Parity: p.d1Parity })) })
  }
  for (const row of input.discoveryRows) if (!targets.some(t => t.targetIndex === row.targetIndex)) add('guardrail', `discovery row ${row.unitId} names no E1 Target`)

  // ---- evaluations: replay the registered order (B0, ADM, CMP, Z0, Z)
  const rows = [...input.evaluationRows]
  const evaluations: Json[] = []
  const evalById = new Map<string, Json>()
  const executedEvalIds = new Set<string>()
  const allRowIds = new Set(rows.map(r => r.evaluationId))
  if (allRowIds.size !== rows.length) add('guardrail', 'an evaluation repeats')
  let b0Facts: D2EvaluationFacts | null = null
  let b0Selected: Set<string> | null = null

  const evaluateRow = (spec: { evaluationId: string; stage: D2Stage; targetIndex: number | null; poolOrdinal: number | null; replacements: ReplacementRef[]; reference: { evaluationId: string; facts: D2EvaluationFacts } | null }) => {
    const row = rows.shift() ?? null
    if (row !== null && row.evaluationId !== spec.evaluationId) {
      add('guardrail', `evaluation row ${row.evaluationId} is not the registered next evaluation ${spec.evaluationId}`)
      rows.unshift(row)
    }
    const own = row !== null && row.evaluationId === spec.evaluationId ? row : null
    if (own === null && !input.interrupted) add('evidence_integrity', `${spec.evaluationId}: the registered evaluation has no row`)
    const record = own ? input.evaluationRecords.get(spec.evaluationId) ?? null : null
    let status: RowStatus | null = own === null ? 'not_executed' : statusFromFiles(own.process, record, own.notExecutedReason, input.interrupted, d => add('evidence_integrity', `${spec.evaluationId}: ${d}`))
    if (own !== null && own.status === 'not_run_reused_existing') {
      if (own.process !== null || own.recordFile !== null || spec.stage !== 'ADM') add('raw_result_mismatch', `${spec.evaluationId}: not_run_reused_existing with a child`)
      status = 'not_run_reused_existing'
    }
    const notExecutedReason = own === null ? (input.interrupted ? 'interrupted' : 'missing_row') : own.notExecutedReason
    if (own !== null && own.status !== status) add('raw_result_mismatch', `${spec.evaluationId}: the row status ${own.status} is not the record status ${status}`)
    if (own !== null && own.process !== null) executedEvalIds.add(spec.evaluationId)
    const reps = [...spec.replacements].sort((a, b) => a.targetIndex - b.targetIndex)
    const ts = reps.map(r => targets.find(t => t.targetIndex === r.targetIndex)!)
    const replacementTargets = ts.map(t => t.targetWeaponId)
    const generatedIds = reps.map(r => r.generatedBuildListEntryId)
    const shas = reps.map(r => r.sha256)
    const support = [...new Set(reps.flatMap(r => r.requiresSupport))].sort(compare)
    const evaluatedAgainst = d2EvaluatedAgainst(spec.stage)
    const inputDigestAll = shas.some(s => s === null) ? null : d1InputDigest(replacementTargets, generatedIds, shas as string[], input.exportSha256)
    if (own !== null && (own.stage !== spec.stage || own.evaluatedAgainst !== evaluatedAgainst || !same(own.replacementTargets, replacementTargets) || !same(own.generatedEntryIds, generatedIds)
      || !same(own.generatedEntrySha256s, shas) || !same(own.requiresSupport, support) || own.poolOrdinal !== spec.poolOrdinal)) add('raw_result_mismatch', `${spec.evaluationId}: the row inputs are not the replayed inputs`)
    const executed = own !== null && own.process !== null
    if (executed && own.inputDigest !== inputDigestAll) add('raw_result_mismatch', `${spec.evaluationId}: inputDigest differs from the recomputed one`)
    const result = record !== null && isObject(record.result) ? record.result : null
    if (record !== null && status !== 'not_executed') for (const issue of recordCalculationIssues(record)) add('guardrail', `${spec.evaluationId}: ${issue}`)
    if (status === 'guardrail_violation') add('guardrail', `${spec.evaluationId}: ${JSON.stringify(result?.issues ?? [])}`)
    const measuredRun = status === 'evaluated' || status === 'preflight_refused' || status === 'planner_rerun_bound_reached'
    let facts: D2EvaluationFacts | null = null
    if (measuredRun && result !== null) {
      const missing = MEASURED_FACT_FIELDS.filter(f => !(f in result))
      if (missing.length > 0) add('evidence_integrity', `${spec.evaluationId}: the measured record lacks ${missing.join(', ')}`)
      else facts = result as unknown as D2EvaluationFacts
    }
    if (status === 'calculation_error' && (result === null || !isObject(result.error))) add('evidence_integrity', `${spec.evaluationId}: a calculation error record without the error`)
    if (facts !== null && facts.runConflictResolutions !== 0) add('guardrail', `${spec.evaluationId}: G1 - the run received a conflict resolution`)
    if (facts !== null && facts.fullRunsStarted > D2_EVALUATION_FULL_RUN_CAP) add('guardrail', `${spec.evaluationId}: ${facts.fullRunsStarted} full runs, above 8`)
    const resultDigest = facts !== null ? d1ResultDigest(facts) : null
    if (facts !== null && facts.resultDigest !== resultDigest) add('raw_result_mismatch', `${spec.evaluationId}: resultDigest differs from the recomputed one`)
    if (facts !== null) {
      const rejected = Array.isArray(facts.rejectedBuildListEntries) ? facts.rejectedBuildListEntries : []
      if (facts.resourceConflictRejections !== rejected.filter(r => r.reason === 'resource_conflict').length) add('raw_result_mismatch', `${spec.evaluationId}: resourceConflictRejections is not the recount`)
    }
    // R5 (independent, cross-checked) and R6
    const r5Status = (status ?? 'process_failure') as D1EvaluationStatus
    const r5 = judgeD1R5Independently({ status: r5Status as never, evaluatedAgainst: evaluatedAgainst as never, generatedBuildListEntryIds: generatedIds, requiresSupport: support, facts })
    if (facts !== null && !same(judgeD1R5({ status: r5Status, evaluatedAgainst: evaluatedAgainst as never, generatedBuildListEntryIds: generatedIds, requiresSupport: support, facts }), r5)) add('raw_result_mismatch', `${spec.evaluationId}: the two R5 implementations disagree`)
    const r6: D2R6Judgement = judgeD2R6({ status: status ?? 'process_failure', evaluatedAgainst, facts, r5Satisfied: r5.satisfied })
    if (own?.runner && isObject(own.runner) && own.runner.r5 !== undefined && !same(own.runner.r5, r5)) add('raw_result_mismatch', `${spec.evaluationId}: the runner R5 differs from the analyzer R5`)
    // Candidates
    const selected = new Set(facts?.plan.selectedBuildListEntryIds ?? [])
    const candidates = reps.map((r, i) => {
      const t = ts[i]!
      const commitment = (facts?.routeCommitment ?? []).find(c => c.buildListEntryId === r.generatedBuildListEntryId) ?? null
      const coParticipants = [...new Set((facts?.conflicts ?? []).filter(c => c.participants.includes(r.generatedBuildListEntryId)).flatMap(c => c.participants.filter(id => id !== r.generatedBuildListEntryId)))].sort(compare)
      const checks = Object.fromEntries(r.requiresSupport.map(id => [id, facts?.supportChecks[id] ?? null]))
      const valid = r.requiresSupport.every(id => { const c = facts?.supportChecks[id]; return c && c.S1 && c.S2 && c.S3 && c.S4 && c.S5 })
      return { targetWeaponId: t.targetWeaponId, label: t.label, generatedBuildListEntryId: r.generatedBuildListEntryId, poolOrdinal: r.poolOrdinal, isSeed: r.isSeed, isK1Candidate: r.requiresSupport.length > 0,
        selected: facts?.plan.present ? selected.has(r.generatedBuildListEntryId) : null, commitmentStatus: commitment?.status ?? null, winnerBuildListEntryId: commitment?.provisionalOutcomeSelectedBuildListEntryId ?? null,
        conflictCoParticipants: coParticipants,
        targetRegressedR: b0Selected === null || facts === null || !facts.plan.present ? null : b0Selected.has(t.currentBuildListEntryId) && !selected.has(r.generatedBuildListEntryId),
        requiresSupport: [...r.requiresSupport], supportSelected: r.requiresSupport.filter(id => selected.has(id)),
        supportChecks: r.requiresSupport.length === 1 ? checks[r.requiresSupport[0]!] ?? null : null, supportChecksByEntry: checks,
        supportValidity: r.requiresSupport.length === 0 ? 'vacuous' : facts === null ? null : valid ? 'valid' : 'expired' }
    })
    const M = new Set([...generatedIds, ...support])
    const conflicts = (facts?.conflicts ?? []).map(c => ({ ...c, membersOfM: c.participants.filter(id => M.has(id)).length }))
    // baseline diff (B0) and reference diff (the step reference)
    const diff = (other: D2EvaluationFacts | null) => {
      if (facts === null || other === null) return null
      const otherSelected = new Set(other.plan.selectedBuildListEntryIds)
      const sig = (c: { kind: string; participants: string[] }) => `${c.kind}:${[...c.participants].sort(compare).join(',')}`
      const a = new Set(other.conflicts.map(sig)), b = new Set(facts.conflicts.map(sig))
      return { completedDelta: (facts.plan.termination?.completedTargetCount ?? 0) - (other.plan.termination?.completedTargetCount ?? 0), conflictDelta: facts.conflicts.length - other.conflicts.length,
        stepsDelta: facts.plan.steps === null || other.plan.steps === null ? null : facts.plan.steps - other.plan.steps,
        selectedAdded: facts.plan.selectedBuildListEntryIds.filter(id => !otherSelected.has(id)).sort(compare), selectedRemoved: [...otherSelected].filter(id => !selected.has(id)).sort(compare),
        targetsGained: facts.selectedTargetWeaponIds.filter(id => !other.selectedTargetWeaponIds.includes(id)).sort(compare),
        targetsLost: other.selectedTargetWeaponIds.filter(id => !facts.selectedTargetWeaponIds.includes(id)).sort(compare),
        conflictsAdded: [...b].filter(s => !a.has(s)).sort(compare), conflictsRemoved: [...a].filter(s => !b.has(s)).sort(compare) }
    }
    const baselineDiff = spec.stage === 'B0' ? null : diff(b0Facts)
    const refDiff = spec.reference === null ? null : diff(spec.reference.facts)
    const referenceDiff = refDiff === null || spec.reference === null ? null : { referenceEvaluationId: spec.reference.evaluationId, completedDelta: refDiff.completedDelta, conflictDelta: refDiff.conflictDelta,
      stepsDelta: refDiff.stepsDelta, targetsGained: refDiff.targetsGained, targetsLost: refDiff.targetsLost }
    // gate (CMP / Z only)
    const proposedCompleted = facts?.plan.termination?.completedTargetCount ?? null
    const referenceCompleted = spec.reference?.facts.plan.termination?.completedTargetCount ?? null
    const gateJudged = spec.stage === 'CMP' || spec.stage === 'Z'
    const gate = gateJudged && facts !== null ? { judged: true, referenceCompleted, proposedCompleted, satisfied: proposedCompleted !== null && referenceCompleted !== null && proposedCompleted >= referenceCompleted }
      : { judged: false, referenceCompleted: gateJudged ? referenceCompleted : null, proposedCompleted: null, satisfied: null }
    const eligible = gateJudged && status === 'evaluated' && r5.satisfied === true && gate.satisfied === true
    const r5OnlyEligible = gateJudged && status === 'evaluated' && r5.satisfied === true && gate.satisfied !== true
    // R1..R4 (ADM)
    let r1r4: Json | null = null
    if (spec.stage === 'ADM') {
      const r = reps[0]!
      const pc = pools.get(r.targetIndex)?.find(p => p.ordinal === r.poolOrdinal) ?? null
      const discovery = { reusedExisting: pc?.reusedExisting === true, replacementReady: pc !== null && (pc.reusedExisting || (pc.replacement.status === 'ready' && pc.replacement.replacedBuildListEntryId === ts[0]!.currentBuildListEntryId)) }
      const rr = d2R1R4((status ?? 'process_failure') as D2EvaluationStatus, facts, r.generatedBuildListEntryId, r.requiresSupport, discovery)
      const verdict = facts?.trialVerdict ?? null
      r1r4 = { R1: rr.R1, R1FailureReason: rr.R1FailureReason, R1Conditions: rr.conditions, R2: rr.R2, R3: rr.R3, R4: rr.R4, supportVacuous: rr.supportVacuous, targetRegressedR: candidates[0]!.targetRegressedR,
        foundRDiagnostic: verdict === null ? null : verdict.status === 'found_R', foundRVerdict: verdict, winnerBuildListEntryId: candidates[0]!.winnerBuildListEntryId, conflictCoParticipants: candidates[0]!.conflictCoParticipants }
    }
    const recordTiming = record !== null && typeof record.wallMs === 'number' ? record.wallMs : null
    const unmeasuredReason = status === null || (D2_MEASURED_EVALUATION as readonly string[]).includes(status) || status === 'not_executed' ? null : status
    const e: Json = {
      evaluationId: spec.evaluationId, stage: spec.stage, axis: d2Axis(spec.stage), ordinal: evaluations.length, evaluatedAgainst, targetLabel: spec.targetIndex === null ? null : d2TargetLabel(spec.targetIndex),
      poolOrdinal: spec.poolOrdinal, replacementTargets, replacementTargetLabels: ts.map(t => t.label), generatedEntryIds: generatedIds, generatedEntrySha256s: shas, requiresSupport: support,
      status, unmeasuredReason, notExecutedReason: status === 'not_executed' ? notExecutedReason : null, process: own?.process ?? null,
      inputDigest: executed ? inputDigestAll : null, replayedInputDigest: inputDigestAll, resultDigest,
      fullRunsStarted: facts?.fullRunsStarted ?? null, runtimeUnsupportedRemoved: facts?.runtimeUnsupportedRemoved ?? [],
      preflight: facts ? { status: facts.preflight.status, refusal: facts.preflight.refusal } : null,
      plan: facts ? { present: facts.plan.present, termination: facts.plan.termination, steps: facts.plan.steps, selectedBuildListEntryIds: facts.plan.selectedBuildListEntryIds, warningKinds: facts.plan.warningKinds } : null,
      conflicts, routeCommitment: facts?.routeCommitment ?? [], candidates, r5, r6, r1r4,
      rejectedBuildListEntries: facts?.rejectedBuildListEntries ?? [], resourceConflictRejections: facts?.resourceConflictRejections ?? null, selectedTargetWeaponIds: facts?.selectedTargetWeaponIds ?? [],
      parity: null, baselineDiff, referenceDiff, gate, eligible, r5OnlyEligible, d1Parity: null, composition: null,
      boundLimited: isD1BoundLimited(r5Status, facts), errorDetail: status === 'calculation_error' && result && isObject(result.error) ? result.error : null,
      wallMs: typeof own?.process?.wallMs === 'number' ? own.process.wallMs : null, childWallMs: recordTiming, ...memoryOf(record, own?.process ?? null),
    }
    evaluations.push(e)
    evalById.set(spec.evaluationId, e)
    return { e, status: status as D2EvaluationStatus | null, facts, r5Satisfied: r5.satisfied, ordinal: spec.poolOrdinal ?? 0 }
  }
  const isMeasuredEval = (s: string | null) => s !== null && (D2_MEASURED_EVALUATION as readonly string[]).includes(s)

  // B0
  const b0 = evaluateRow({ evaluationId: 'B0', stage: 'B0', targetIndex: null, poolOrdinal: null, replacements: [], reference: null })
  if (b0.status === 'evaluated' && b0.facts !== null) { b0Facts = b0.facts; b0Selected = new Set(b0.facts.plan.selectedBuildListEntryIds) }
  for (const t of discoveryTargets) t.oTSelectedInB0 = b0Selected === null ? null : b0Selected.has(String(t.currentBuildListEntryId))
  {
    const comparable = b0.status !== null && (D2_COMPARABLE_EVALUATION as readonly string[]).includes(b0.status)
    let state: D2ParityState = 'not_checked', mismatches: string[] = []
    if (comparable) {
      const p = d1B0Parity(b0.facts?.baselineSummary ?? null, v.phase2c2BaselineSummary)
      mismatches = [...p.mismatches.map(m => `Phase 2-C2 ${m}`), ...(b0.status !== 'evaluated' ? [`status ${b0.status}`] : []),
        ...(v.d1 !== null && b0.e.resultDigest !== v.d1.b0.resultDigest ? ['resultDigest is not the D1 B0 one'] : [])]
      state = mismatches.length === 0 ? 'matched' : 'mismatched'
    }
    b0.e.parity = { compared: ['phase2c2BaselineSummary', 'd1B0ResultDigest'], matched: state === 'matched', state, mismatches }
    parity({ checkId: 'baseline:B0', kind: 'baseline', axis: 'main', state, subjects: ['B0'], expected: { d1ResultDigest: v.d1?.b0.resultDigest ?? null }, observed: { status: b0.status, resultDigest: b0.e.resultDigest },
      mismatches, notChecked: state === 'not_checked' ? { dependsOn: [{ id: 'B0', status: b0.status, unmeasuredReason: b0.e.unmeasuredReason as string | null, notExecutedReason: b0.e.notExecutedReason as string | null }] } : null,
      category: 'baseline_parity_mismatch' })
  }

  // ADM
  const admitted = new Map<number, number[]>()
  const admissionUnmeasured = new Map<number, string[]>()
  for (const t of targets) {
    const ok: number[] = [], bad: string[] = []
    for (const p of pools.get(t.targetIndex) ?? []) {
      const r = evaluateRow({ evaluationId: d2AdmissionId(t.targetIndex, p.ordinal), stage: 'ADM', targetIndex: t.targetIndex, poolOrdinal: p.ordinal,
        replacements: [{ targetIndex: t.targetIndex, generatedBuildListEntryId: p.generatedBuildListEntryId, sha256: p.generatedEntry?.sha256 ?? null, requiresSupport: [], poolOrdinal: p.ordinal, isSeed: false }], reference: null })
      if (p.reusedExisting && r.status !== 'not_run_reused_existing') add('raw_result_mismatch', `${r.e.evaluationId}: a reused Entry was evaluated`)
      if (!p.reusedExisting && r.status === 'not_run_reused_existing') add('raw_result_mismatch', `${r.e.evaluationId}: not_run_reused_existing for a new Entry`)
      if (!isMeasuredEval(r.status)) bad.push(String(r.e.evaluationId))
      if ((r.e.r1r4 as Json | null)?.R1 === true) ok.push(p.ordinal)
    }
    admitted.set(t.targetIndex, ok)
    admissionUnmeasured.set(t.targetIndex, bad)
  }

  // CMP / Z composition
  type Accepted = { targetIndex: number; poolOrdinal: number | null; generatedBuildListEntryId: string; sha256: string | null; requiresSupport: string[]; isSeed: boolean }
  const compositionSteps: { main: Json[]; seeded: Json[] } = { main: [], seeded: [] }
  const compose = (axis: 'main' | 'seeded', order: readonly number[], start: Accepted[], startReference: { evaluationId: string; facts: D2EvaluationFacts } | null, blockedReason: string | null) => {
    let accepted = [...start]
    let reference = startReference
    let afterUnmeasured = false
    let lastAccepted: Json | null = null
    for (const index of order) {
      const t = targets.find(x => x.targetIndex === index)!
      const before = accepted.map(a => d2TargetLabel(a.targetIndex))
      const ds = discoveryStops.get(index)
      const depUnmeasured = ds === undefined || ds.stop === 'unmeasured' || ds.stop === 'not_executed' || (admissionUnmeasured.get(index) ?? []).length > 0
      const step: Json = { label: t.label, acceptedBefore: before, evaluatedCandidates: [], eligible: [], chosen: null, stepOutcome: null, stepNotEvaluatedReason: null, acceptedAfter: before, afterUnmeasuredStep: afterUnmeasured }
      if (depUnmeasured) {
        step.stepOutcome = 'step_unmeasured'; step.stepNotEvaluatedReason = 'dependency_unmeasured'
        afterUnmeasured = true
        compositionSteps[axis].push(step)
        continue
      }
      const cands = (admitted.get(index) ?? []).map(o => (pools.get(index) ?? []).find(p => p.ordinal === o)!)
      const results: { evaluationId: string; ordinal: number; status: D2EvaluationStatus; r5Satisfied: boolean | null; completed: number | null; conflicts: number | null; steps: number | null; facts: D2EvaluationFacts | null }[] = []
      for (const c of cands) {
        const proposed = [...accepted, { targetIndex: index, poolOrdinal: c.ordinal, generatedBuildListEntryId: c.generatedBuildListEntryId, sha256: c.generatedEntry?.sha256 ?? null, requiresSupport: [], isSeed: false }]
          .sort((a, b) => a.targetIndex - b.targetIndex)
        const id = axis === 'main' ? d2CompositionId(index, c.ordinal) : d2SeededId(index, c.ordinal)
        const r = evaluateRow({ evaluationId: id, stage: axis === 'main' ? 'CMP' : 'Z', targetIndex: index, poolOrdinal: c.ordinal,
          replacements: proposed.map(p => ({ targetIndex: p.targetIndex, generatedBuildListEntryId: p.generatedBuildListEntryId, sha256: p.sha256, requiresSupport: p.requiresSupport, poolOrdinal: p.poolOrdinal, isSeed: p.isSeed })),
          reference })
        if (blockedReason !== null && (r.status !== 'not_executed' || r.e.notExecutedReason !== blockedReason)) add('raw_result_mismatch', `${id}: Z after an unmeasured Z0 must be not_executed (${blockedReason})`)
        r.e.composition = { acceptedBefore: before, candidate: { label: t.label, ordinal: c.ordinal }, proposed: proposed.map(p => d2TargetLabel(p.targetIndex)), afterUnmeasuredStep: afterUnmeasured }
        results.push({ evaluationId: id, ordinal: c.ordinal, status: (r.status ?? 'process_failure') as D2EvaluationStatus, r5Satisfied: r.r5Satisfied, completed: r.facts?.plan.termination?.completedTargetCount ?? null,
          conflicts: r.facts ? r.facts.conflicts.length : null, steps: r.facts?.plan.steps ?? null, facts: r.facts })
      }
      const outcome = d2CompositionStep(results, reference?.facts.plan.termination?.completedTargetCount ?? null)
      step.evaluatedCandidates = results.map(r => ({ evaluationId: r.evaluationId, ordinal: r.ordinal }))
      step.eligible = outcome.eligible
      step.r5OnlyEligible = outcome.r5OnlyEligible
      step.chosen = outcome.chosen
      step.stepOutcome = outcome.stepOutcome
      if (outcome.stepOutcome === 'step_unmeasured') afterUnmeasured = true
      if (outcome.stepOutcome === 'accepted') {
        const chosen = results.find(r => r.evaluationId === outcome.chosen)!
        const c = cands.find(x => x.ordinal === chosen.ordinal)!
        accepted = [...accepted, { targetIndex: index, poolOrdinal: c.ordinal, generatedBuildListEntryId: c.generatedBuildListEntryId, sha256: c.generatedEntry?.sha256 ?? null, requiresSupport: [], isSeed: false }]
          .sort((a, b) => a.targetIndex - b.targetIndex)
        reference = { evaluationId: chosen.evaluationId, facts: chosen.facts! }
        lastAccepted = evalById.get(chosen.evaluationId)!
      }
      step.acceptedAfter = accepted.map(a => d2TargetLabel(a.targetIndex))
      compositionSteps[axis].push(step)
    }
    return { accepted, reference, lastAccepted }
  }

  const main = compose('main', targets.map(t => t.targetIndex), [], b0Facts === null ? null : { evaluationId: 'B0', facts: b0Facts }, null)

  // Z0 and Z
  const seedAccepted: Accepted[] = v.seed.map(s => ({ targetIndex: s.targetIndex, poolOrdinal: null, generatedBuildListEntryId: s.generatedBuildListEntryId, sha256: s.sha256, requiresSupport: [...s.requiresSupport], isSeed: true }))
  const z0 = evaluateRow({ evaluationId: 'Z0', stage: 'Z0', targetIndex: null, poolOrdinal: null,
    replacements: seedAccepted.map(a => ({ targetIndex: a.targetIndex, generatedBuildListEntryId: a.generatedBuildListEntryId, sha256: a.sha256, requiresSupport: a.requiresSupport, poolOrdinal: null, isSeed: true })), reference: null })
  let z0State: D2ParityState = 'not_checked'
  {
    const comparable = z0.status !== null && (D2_COMPARABLE_EVALUATION as readonly string[]).includes(z0.status)
    const mismatches: string[] = []
    if (comparable) {
      if (v.d1 === null) mismatches.push('no D1 A-b reference')
      else {
        if (z0.e.replayedInputDigest !== v.d1.aB.inputDigest) mismatches.push('inputDigest is not the D1 A-b one')
        if (z0.status !== 'evaluated') mismatches.push(`status ${z0.status}`)
        if (z0.e.resultDigest !== v.d1.aB.resultDigest) mismatches.push('resultDigest is not the D1 A-b one')
        if (z0.r5Satisfied !== true) mismatches.push('R5 is not satisfied')
      }
      z0State = mismatches.length === 0 ? 'matched' : 'mismatched'
    }
    z0.e.d1Parity = { state: z0State, matchedD1EvaluationIds: z0State === 'matched' && v.d1 ? [v.d1.aB.evaluationId] : [], resultDigestsEqual: comparable ? z0.e.resultDigest === v.d1?.aB.resultDigest : null,
      notChecked: z0State === 'not_checked' ? { dependsOn: [{ id: 'Z0', status: z0.status, unmeasuredReason: z0.e.unmeasuredReason, notExecutedReason: z0.e.notExecutedReason }] } : null }
    parity({ checkId: 'z0:Z0', kind: 'z0', axis: 'seeded', state: z0State, subjects: ['Z0'], expected: { inputDigest: v.d1?.aB.inputDigest ?? null, resultDigest: v.d1?.aB.resultDigest ?? null, r5: true },
      observed: { status: z0.status, inputDigest: z0.e.replayedInputDigest, resultDigest: z0.e.resultDigest, r5: z0.r5Satisfied }, mismatches,
      notChecked: z0State === 'not_checked' ? { dependsOn: [{ id: 'Z0', status: z0.status, unmeasuredReason: z0.e.unmeasuredReason as string | null, notExecutedReason: z0.e.notExecutedReason as string | null }] } : null,
      category: 'd1_parity' })
  }
  const z0Measured = z0.status === 'evaluated' && z0.facts !== null
  const dropped = d2DroppedTargetIndexes(v.seed, targets.length)
  const seeded = compose('seeded', dropped, seedAccepted, z0Measured ? { evaluationId: 'Z0', facts: z0.facts! } : null, z0.status !== null && isMeasuredEval(z0.status) ? null : 'z0_unmeasured')
  for (const extra of rows) add('guardrail', `evaluation row ${extra.evaluationId} is beyond the registered evaluations`)
  if (input.compositionRows !== null) {
    const recorded = { main: input.compositionRows.filter(r => r.axis === 'main'), seeded: input.compositionRows.filter(r => r.axis === 'seeded') }
    for (const axis of ['main', 'seeded'] as const) {
      const replayed = compositionSteps[axis]
      if (recorded[axis].length !== replayed.length) add('raw_result_mismatch', `${axis}: ${recorded[axis].length} recorded composition steps, the replay ${replayed.length}`)
      recorded[axis].forEach((r, i) => {
        const s = replayed[i]
        if (!s || r.label !== s.label || !same(r.acceptedBefore, s.acceptedBefore) || !same(r.evaluatedCandidates, s.evaluatedCandidates) || !same(r.eligible, s.eligible) || r.chosen !== s.chosen
          || r.stepOutcome !== s.stepOutcome || !same(r.acceptedAfter, s.acceptedAfter) || r.afterUnmeasuredStep !== s.afterUnmeasuredStep || (r.stepNotEvaluatedReason ?? null) !== (s.stepNotEvaluatedReason ?? null)) {
          add('raw_result_mismatch', `${axis} step ${r.label}: the recorded step is not the replayed one`)
        }
      })
    }
  }

  // ---- budgets and the process count
  const count = (stage: D2Stage) => evaluations.filter(e => e.stage === stage).length
  if (count('ADM') > D2_BUDGETS.admissionEvaluationsMax || count('CMP') > D2_BUDGETS.compositionMainEvaluationsMax || count('Z0') + count('Z') > D2_BUDGETS.compositionSeededEvaluationsMax
    || evaluations.length > D2_BUDGETS.evaluationRequestsMax) add('guardrail', 'an evaluation count is above its registered budget')
  const startedUnits = units.filter(u => u.process !== null).length
  const startedEvals = evaluations.filter(e => e.process !== null).length
  if (input.childProcessCount !== null && input.childProcessCount !== startedUnits + startedEvals) add('guardrail', `${input.childProcessCount} child processes, not the ${startedUnits + startedEvals} started units / evaluations`)
  const envelopeRows = [...units, ...evaluations].filter(x => x.notExecutedReason === 'run_envelope_reached')
  if (envelopeRows.length > 0 && !input.runEnvelopeReached) add('raw_result_mismatch', 'run_envelope_reached rows without a reached run envelope')
  const abortedRows = [...units, ...evaluations].filter(x => x.notExecutedReason === 'aborted_after_invalid')

  // ---- determinism (§7.3.3: within D2, and against D1)
  const groups = new Map<string, Json[]>()
  for (const e of evaluations) if (typeof e.replayedInputDigest === 'string') groups.set(e.replayedInputDigest, [...(groups.get(e.replayedInputDigest) ?? []), e])
  const determinismCrossChecks: Json[] = []
  const dependsOf = (list: Json[]) => list.map(e => ({ id: String(e.evaluationId), status: e.status as string | null, unmeasuredReason: e.unmeasuredReason as string | null, notExecutedReason: e.notExecutedReason as string | null }))
  for (const [digest, list] of groups) {
    const comparable = list.filter(e => (D2_COMPARABLE_EVALUATION as readonly unknown[]).includes(e.status))
    const others = list.filter(e => !comparable.includes(e) && e.status !== 'not_run_reused_existing')
    const axis: 'main' | 'seeded' = list.some(e => e.axis === 'seeded') ? 'seeded' : 'main'
    if (list.length >= 2) {
      let state: D2ParityState
      if (comparable.length >= 2) state = new Set(comparable.map(e => `${e.status}|${e.resultDigest}`)).size === 1 ? 'matched' : 'mismatched'
      else state = others.length > 0 ? 'not_checked' : 'not_applicable'
      const ids = list.map(e => String(e.evaluationId))
      determinismCrossChecks.push({ inputDigest: digest, evaluationIds: ids, d1EvaluationIds: [], comparableEvaluationIds: comparable.map(e => String(e.evaluationId)), state,
        resultDigestsEqual: comparable.length >= 2 ? new Set(comparable.map(e => e.resultDigest)).size === 1 : null })
      parity({ checkId: `determinism_d2:${digest}`, kind: 'determinism_d2', axis: others.length > 0 && others.every(e => e.axis === 'seeded') ? 'seeded' : axis, state, subjects: ids,
        expected: null, observed: comparable.map(e => ({ id: e.evaluationId, status: e.status, resultDigest: e.resultDigest })),
        mismatches: state === 'mismatched' ? ['the comparable evaluations differ in status / resultDigest'] : [], notChecked: state === 'not_checked' ? { dependsOn: dependsOf(others) } : null, category: 'determinism' })
    }
    const d1 = v.d1?.byInputDigest[digest] ?? []
    if (d1.length > 0) {
      for (const e of list) {
        if (e.status === 'not_run_reused_existing') continue
        const isComparable = comparable.includes(e)
        const mismatches = isComparable ? d1.filter(x => x.status !== e.status || x.resultDigest !== e.resultDigest).map(x => `${x.evaluationId}: ${x.status} / ${x.resultDigest} vs ${e.status} / ${e.resultDigest}`) : []
        const state: D2ParityState = !isComparable ? 'not_checked' : mismatches.length === 0 ? 'matched' : 'mismatched'
        if (e.d1Parity === null) e.d1Parity = { state, matchedD1EvaluationIds: state === 'matched' ? d1.map(x => x.evaluationId) : [], resultDigestsEqual: isComparable ? mismatches.length === 0 : null,
          notChecked: state === 'not_checked' ? { dependsOn: dependsOf([e]) } : null }
        determinismCrossChecks.push({ inputDigest: digest, evaluationIds: [String(e.evaluationId)], d1EvaluationIds: d1.map(x => x.evaluationId), comparableEvaluationIds: isComparable ? [String(e.evaluationId)] : [],
          state, resultDigestsEqual: isComparable ? mismatches.length === 0 : null })
        parity({ checkId: `determinism_d1:${e.evaluationId}`, kind: 'determinism_d1', axis: e.axis === 'seeded' ? 'seeded' : 'main', state, subjects: [String(e.evaluationId), ...d1.map(x => `D1:${x.evaluationId}`)],
          expected: d1, observed: { status: e.status, resultDigest: e.resultDigest }, mismatches, notChecked: state === 'not_checked' ? { dependsOn: dependsOf([e]) } : null, category: 'd1_parity' })
      }
    }
  }
  for (const e of evaluations) if (e.d1Parity === null) e.d1Parity = { state: 'not_applicable', matchedD1EvaluationIds: [], resultDigestsEqual: null, notChecked: null }
  if (abortedRows.length > 0 && invalid.length === 0) add('raw_result_mismatch', `${abortedRows.length} row(s) aborted_after_invalid without an INVALID reason`)
  if (input.abortReason !== null && invalid.length === 0) add('raw_result_mismatch', `the runner aborted (${input.abortReason}) without an INVALID reason`)

  // ---- not_checked must name unmeasured dependencies that are recorded as unmeasured (§8.3)
  for (const check of parityChecks.filter(c => c.state === 'not_checked')) {
    const deps = isObject(check.notChecked) && Array.isArray(check.notChecked.dependsOn) ? check.notChecked.dependsOn as Json[] : []
    if (deps.length === 0 || deps.some(d => d.status === 'evaluated' || D2_DISCOVERY_MEASURED.includes(d.status as D2DiscoveryUnitStatus))) add('evidence_integrity', `${check.checkId}: not_checked without an unmeasured dependency`)
  }

  // ---- aggregates, comparison and the decisions
  const finalOf = (accepted: Json | null, fallback: D2EvaluationFacts | null, fallbackId: string) => {
    const facts = accepted !== null ? accepted : null
    if (facts !== null) {
      const plan = facts.plan as Json | null
      const t = plan && isObject(plan.termination) ? plan.termination : null
      return { evaluationId: String(facts.evaluationId), metrics: t ? { completed: Number(t.completedTargetCount), conflicts: (facts.conflicts as unknown[]).length, steps: plan!.steps as number | null } : null,
        r6: (facts.r6 as D2R6Judgement).satisfied === true }
    }
    if (fallback === null) return { evaluationId: null, metrics: null, r6: false }
    return { evaluationId: fallbackId, metrics: { completed: fallback.plan.termination?.completedTargetCount ?? 0, conflicts: fallback.conflicts.length, steps: fallback.plan.steps }, r6: false }
  }
  const mainFinal = finalOf(main.lastAccepted, b0Facts, 'B0')
  const seededFinal = finalOf(seeded.lastAccepted, z0Measured ? z0.facts : null, 'Z0')
  const isNew = (a: Accepted) => {
    const t = targets.find(x => x.targetIndex === a.targetIndex)!
    return t.d1Generated === null || t.d1Generated.buildListEntryId !== a.generatedBuildListEntryId
  }
  const mainAccepted = main.accepted
  const seededAdded = seeded.accepted.filter(a => !a.isSeed)
  const mainUnmeasured = [...units.filter(u => u.status === null || !D2_DISCOVERY_MEASURED.includes(u.status as D2DiscoveryUnitStatus)).map(u => String(u.unitId)),
    ...evaluations.filter(e => (e.stage === 'B0' || e.stage === 'ADM' || e.stage === 'CMP') && !isMeasuredEval(e.status as string | null)).map(e => String(e.evaluationId))]
  const droppedSet = new Set(dropped)
  const seededUnmeasured = [...(isMeasuredEval(z0.status) ? [] : ['Z0']),
    ...evaluations.filter(e => e.stage === 'Z' && !isMeasuredEval(e.status as string | null)).map(e => String(e.evaluationId)),
    ...units.filter(u => droppedSet.has(Number(String(u.label).slice(1))) && (u.status === null || !D2_DISCOVERY_MEASURED.includes(u.status as D2DiscoveryUnitStatus))).map(u => String(u.unitId)),
    ...evaluations.filter(e => e.stage === 'ADM' && droppedSet.has(Number(String(e.targetLabel).slice(1))) && !isMeasuredEval(e.status as string | null)).map(e => String(e.evaluationId))]
  const boundLimitedEvaluations = evaluations.filter(e => e.boundLimited === true).map(e => String(e.evaluationId))
  const decision = classifyD2Decision({ invalidReasons: invalid, mainUnmeasured, finalAcceptedCount: mainAccepted.length, finalMetrics: mainFinal.metrics, finalR6: mainFinal.r6,
    boundLimitedEvaluations, newCandidateAccepted: mainAccepted.filter(isNew).length })
  const seededDecision = classifyD2SeededDecision({ invalid: invalid.length > 0, seededUnmeasured, z0ParityState: z0State, addedTargets: seededAdded.map(a => d2TargetLabel(a.targetIndex)),
    finalMetrics: seededFinal.metrics, finalR6: seededFinal.r6 })

  const stepOf = (axis: 'main' | 'seeded', label: string) => compositionSteps[axis].find(s => s.label === label) ?? null
  const acceptedEval = (axis: 'main' | 'seeded', label: string) => { const s = stepOf(axis, label); return s && typeof s.chosen === 'string' ? evalById.get(s.chosen) ?? null : null }
  const d1DroppedTargets = dropped.map(index => {
    const t = targets.find(x => x.targetIndex === index)!
    const pool = pools.get(index) ?? []
    const adm = admitted.get(index) ?? []
    const newOrdinals = pool.filter(p => !p.isD1Candidate).map(p => p.ordinal)
    const mainEval = acceptedEval('main', t.label), seededEval = acceptedEval('seeded', t.label)
    const winners = new Set<string>()
    for (const e of evaluations.filter(x => (x.stage === 'ADM' || x.stage === 'CMP' || x.stage === 'Z') && x.targetLabel === t.label)) {
      for (const c of e.candidates as Json[]) if (c.label === t.label && c.selected === false && typeof c.winnerBuildListEntryId === 'string') winners.add(c.winnerBuildListEntryId)
    }
    const diffOf = (e: Json | null) => e && isObject(e.referenceDiff) ? e.referenceDiff : null
    return { label: t.label, poolSize: pool.length, newCandidatesFound: newOrdinals.length, admittedCount: adm.length, newAdmittedCount: adm.filter(o => newOrdinals.includes(o)).length,
      mainOutcome: stepOf('main', t.label)?.stepOutcome ?? null, mainAcceptedOrdinal: mainEval ? mainEval.poolOrdinal : null, mainAcceptedIsNew: mainEval ? newOrdinals.includes(Number(mainEval.poolOrdinal)) : null,
      seededOutcome: stepOf('seeded', t.label)?.stepOutcome ?? null, seededAcceptedOrdinal: seededEval ? seededEval.poolOrdinal : null, seededAcceptedIsNew: seededEval ? newOrdinals.includes(Number(seededEval.poolOrdinal)) : null,
      targetsGainedWhenAccepted: [...new Set([...((diffOf(mainEval)?.targetsGained as string[]) ?? []), ...((diffOf(seededEval)?.targetsGained as string[]) ?? [])])].sort(compare),
      targetsLostWhenAccepted: [...new Set([...((diffOf(mainEval)?.targetsLost as string[]) ?? []), ...((diffOf(seededEval)?.targetsLost as string[]) ?? [])])].sort(compare),
      winnersObserved: [...winners].sort(compare) }
  })
  const metricsDelta = (a: D2Metrics | null, b: { completed: number; conflicts: number; steps: number }) => a === null ? null : { completedDelta: a.completed - b.completed, conflictDelta: a.conflicts - b.conflicts, stepsDelta: a.steps === null ? null : a.steps - b.steps }
  const vsD1 = metricsDelta(mainFinal.metrics, D2_COMPARISON_BASELINES.d1Incumbent)
  const countBy = <T,>(list: readonly T[], key: (x: T) => string | null) => list.reduce<Record<string, number>>((acc, x) => { const k = key(x); if (k !== null) acc[k] = (acc[k] ?? 0) + 1; return acc }, {})
  const judgedR5 = evaluations.filter(e => (e.r5 as Json).judged === true)
  const r5Satisfied = judgedR5.filter(e => (e.r5 as Json).satisfied === true)
  const r6Judged = evaluations.filter(e => (e.r6 as Json).judged === true)
  const r6Satisfied = r6Judged.filter(e => (e.r6 as Json).satisfied === true)
  const regressedByTarget: Record<string, number> = {}
  for (const e of evaluations.filter(x => x.stage === 'ADM')) for (const c of e.candidates as Json[]) if (c.targetRegressedR === true) regressedByTarget[String(c.label)] = (regressedByTarget[String(c.label)] ?? 0) + 1
  const pooledAll = [...pools.values()].flat()
  const aggregates = {
    discovery: { registeredUnitsMax: D2_BUDGETS.discoveryUnitsMax, executed: startedUnits, byStatus: countBy(units, u => String(u.status)), pooledCandidates: pooledAll.length,
      newCandidatesVsD1: pooledAll.filter(p => !p.isD1Candidate).length, searchOnlyMs: units.reduce((s, u) => s + (typeof u.searchOnlyMs === 'number' ? u.searchOnlyMs : 0), 0),
      wallMs: units.reduce((s, u) => s + (typeof u.wallMs === 'number' ? u.wallMs : 0), 0) },
    evaluations: { executed: startedEvals, registered: evaluations.length, measured: evaluations.filter(e => isMeasuredEval(e.status as string | null)).length,
      unmeasuredByReason: countBy(evaluations.filter(e => !isMeasuredEval(e.status as string | null) && e.status !== 'not_executed'), e => String(e.status)),
      notExecutedByReason: countBy(evaluations.filter(e => e.status === 'not_executed'), e => String(e.notExecutedReason)), byStage: countBy(evaluations, e => String(e.stage)), byStatus: countBy(evaluations, e => String(e.status)) },
    fullPlannerRunsStarted: evaluations.reduce((s, e) => s + (typeof e.fullRunsStarted === 'number' ? e.fullRunsStarted : 0), 0),
    runtimeUnsupportedRetries: evaluations.reduce((s, e) => s + (e.runtimeUnsupportedRemoved as unknown[]).length, 0),
    r5: { judged: judgedR5.length, satisfied: r5Satisfied.length, satisfiedByAxis: countBy(r5Satisfied, e => String(e.axis)) },
    r6: { judged: r6Judged.length, satisfied: r6Satisfied.length, satisfiedEvaluationIds: r6Satisfied.map(e => String(e.evaluationId)) },
    boundLimitedEvaluations,
    targetRegressedR: { byEvaluation: Object.fromEntries(evaluations.filter(e => e.stage === 'ADM').map(e => [e.evaluationId, (e.candidates as Json[]).filter(c => c.targetRegressedR === true).length])), byTarget: regressedByTarget },
    determinismCrossChecks,
    parity: { byKindAndState: countBy(parityChecks, c => `${c.kind}:${c.state}`), mismatched: parityChecks.filter(c => c.state === 'mismatched').map(c => c.checkId),
      notChecked: parityChecks.filter(c => c.state === 'not_checked').map(c => ({ checkId: c.checkId, dependsOn: isObject(c.notChecked) ? c.notChecked.dependsOn : [] })) },
  }
  const composition = {
    main: { steps: compositionSteps.main, finalAccepted: mainAccepted.map(a => ({ label: d2TargetLabel(a.targetIndex), ordinal: a.poolOrdinal, generatedBuildListEntryId: a.generatedBuildListEntryId, isD1Candidate: !isNew(a) })),
      finalResultEvaluationId: mainFinal.evaluationId, finalMetrics: mainFinal.metrics },
    seeded: { z0EvaluationId: 'Z0', seed: v.seed.map(s => ({ label: s.label, generatedBuildListEntryId: s.generatedBuildListEntryId, isK1Candidate: s.isK1Candidate, requiresSupport: s.requiresSupport })),
      steps: compositionSteps.seeded, finalAccepted: seeded.accepted.map(a => ({ label: d2TargetLabel(a.targetIndex), ordinal: a.poolOrdinal, generatedBuildListEntryId: a.generatedBuildListEntryId, isSeed: a.isSeed, isD1Candidate: a.isSeed || !isNew(a) })),
      finalResultEvaluationId: seededFinal.evaluationId, finalMetrics: seededFinal.metrics },
  }
  const comparison = {
    vsBaseline: metricsDelta(mainFinal.metrics, D2_COMPARISON_BASELINES.baseline),
    vsD1Incumbent: vsD1 === null ? null : { ...vsD1, better: mainFinal.metrics !== null && d2Better(mainFinal.metrics, D2_COMPARISON_BASELINES.d1Incumbent), equalMetrics: decision.equalsD1IncumbentMetrics },
    seededVsD1Incumbent: metricsDelta(seededFinal.metrics, D2_COMPARISON_BASELINES.d1Incumbent),
    d1DroppedTargets,
  }
  return { discovery: { units, targets: discoveryTargets }, evaluations, parityChecks, composition, comparison, aggregates, invalidReasons: invalid, decision,
    seededAxis: { case: seededDecision.case, reasons: seededDecision.reasons, lowerBound: seededDecision.lowerBound, z0ParityState: seededDecision.z0ParityState, addedTargets: seededDecision.addedTargets, finalMetrics: seededDecision.finalMetrics },
    mainUnmeasured, seededUnmeasured }
}
