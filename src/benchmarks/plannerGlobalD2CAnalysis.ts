/**
 * Issue #154 D2-C-B post-hoc analysis. Research only. Never import from Production.
 *
 * Re-derives every judgement of a D2-C run from the run dir records (never from the runner's own judgement): the CTX records and
 * C1 .. C5 (§7.1, C1 / C3 / C4 recomputed from the Export and the independently recomputed origin digest), the rung-major discovery
 * replay, D-1 .. D-4 and the pools (§4), the G store bodies, the discovery ordinals, each evaluation's status, `inputDigest` /
 * `resultDigest`, R1 (§5), R5 (the D1 analyzer's independent implementation, cross-checked against `judgeD1R5()`), S1 .. S5 and the
 * support expiry cause (§7.2 / §7.3), R6 (§6.5), the gate and the selection order (§6.4), the CMP replay (§6.2), every parity check
 * with its four states (§9), the evidence integrity (§10.5) and the decision (§11). It reads no oracle, Phase B analysis or
 * population-authority module (a test walks the import closure); the D2 / Phase B RESULTs are read through the D2-C allowlists only
 * (by `validateD2CInputs()`).
 */
import { collectReferencedOwnedWeaponIds, hashStableValue, stableStringify } from '../domain/models/hashing'
import type { BuildListEntry } from '../domain/models/publicTypes'
import { candidateStableKey } from '../domain/search'
import { d1InputDigest, d1ResultDigest, d1B0Parity, isD1BoundLimited, judgeD1R5, D1_CALCULATION_CONTEXT, D1_RESEARCH_MAX_PLAN_STEPS, D1_RNG_ENGINE_VERSION, type D1EvaluationStatus } from './plannerGlobalD1'
import { judgeD1R5Independently } from './plannerGlobalD1Analysis'
import { d2Better, d2CompositionStep, d2DiscoveryUnitOutcome, d2R1R4, judgeD2R6, type D2EvaluationFacts, type D2EvaluationStatus, type D2R6Judgement, type D2StepOutcome } from './plannerGlobalD2'
import {
  d2cAdmissionId,
  d2cCompositionId,
  d2cContextParity,
  d2cContextUnitId,
  d2cDiscoveryUnitId,
  d2cEvaluatedAgainst,
  d2cI0Parity,
  d2cPhaseBK1PrefixParity,
  d2cRungExtent,
  d2cSupportExpiryCause,
  readD2CContextRecord,
  D2CDiscoveryScheduler,
  D2C_BUDGETS,
  D2C_COMPARISON_BASELINES,
  D2C_DISCOVERY_MEASURED,
  D2C_EVALUATION_FULL_RUN_CAP,
  D2C_GENERATED_ENTRY_PREFIX,
  D2C_K1_POOL_CAP,
  type D2CContext,
  type D2CContextRecord,
  type D2CDiscoveryStop,
  type D2CDiscoveryUnitStatus,
  type D2CEvaluatedAgainst,
  type D2CParityState,
  type D2CStage,
  type D2CValidatedInputs,
} from './plannerGlobalD2C'
import type { Phase2C27BRungId } from './plannerGlobalPhase2C27B'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const UNMEASURED_PROCESS = ['timeout', 'out_of_memory', 'process_failure', 'interrupted'] as const
const MEASURED_EVALUATION: readonly string[] = ['evaluated', 'preflight_refused', 'planner_rerun_bound_reached', 'not_run_reused_existing']
const COMPARABLE_EVALUATION: readonly string[] = ['evaluated', 'preflight_refused', 'planner_rerun_bound_reached', 'calculation_error']

export type D2CInvalidCategory = 'input_evidence' | 'provenance' | 'baseline_parity_mismatch' | 'd2b_parity' | 'phase_b_k1_parity' | 'guardrail' | 'determinism' | 'evidence_integrity' | 'raw_result_mismatch'
export interface D2CInvalidReason { category: D2CInvalidCategory; detail: string }
export type D2CDecisionCase = 'D2C_INVALID' | 'D2C_INCOMPLETE' | 'D2C_GLOBAL_COMPLETE_R' | 'D2C_EXCEEDS_D2B_MAIN' | 'D2C_K1_ACCEPTED_NOT_BETTER' | 'D2C_NO_K1_ACCEPTED'

// ---------------------------------------------------------------- the decision (§11)

export interface D2CMetrics { completed: number; conflicts: number; steps: number | null }
type Delta = { completedDelta: number; conflictDelta: number; stepsDelta: number | null; better: boolean; equalMetrics: boolean }

export interface D2CDecisionInput {
  invalidReasons: readonly D2CInvalidReason[]
  /** Registered CTX / DSC / B0 / I0 / ADM / CMP items that are unmeasured or not executed. */
  unmeasured: readonly string[]
  k1Accepted: readonly { label: string; contextId: string; ordinal: number; generatedBuildListEntryId: string }[]
  finalMetrics: D2CMetrics | null
  finalR6: boolean
  /** The I0 execution result (the D2-B main axis inside D2-C), or null when unmeasured. */
  i0Metrics: D2CMetrics | null
  boundLimitedEvaluations: readonly string[]
  contextsWithoutCandidateMeasured: readonly string[]
  contextsUnmeasured: readonly string[]
}

const delta = (a: D2CMetrics | null, b: { completed: number; conflicts: number; steps: number | null } | null): Delta | null => a === null || b === null ? null
  : { completedDelta: a.completed - b.completed, conflictDelta: a.conflicts - b.conflicts, stepsDelta: a.steps === null || b.steps === null ? null : a.steps - b.steps,
    better: d2Better(a, b), equalMetrics: a.completed === b.completed && a.conflicts === b.conflicts }

export function classifyD2CDecision(input: D2CDecisionInput) {
  const m = input.finalMetrics
  const vsD2b = delta(m, input.i0Metrics ?? D2C_COMPARISON_BASELINES.d2bMain)
  const base = { k1Accepted: input.k1Accepted.map(a => ({ ...a })), boundLimitedEvaluations: [...input.boundLimitedEvaluations], contextsWithoutCandidateMeasured: [...input.contextsWithoutCandidateMeasured],
    contextsUnmeasured: [...input.contextsUnmeasured], vsBaseline: delta(m, D2C_COMPARISON_BASELINES.baseline), vsD1Incumbent: delta(m, D2C_COMPARISON_BASELINES.d1Incumbent), vsD2bMain: vsD2b }
  const exceeds = m !== null && input.k1Accepted.length >= 1 && input.i0Metrics !== null && d2Better(m, input.i0Metrics)
  if (input.invalidReasons.length > 0) {
    return { case: 'D2C_INVALID' as D2CDecisionCase, reasons: input.invalidReasons.map(r => `${r.category}: ${r.detail}`), lowerBound: false, ...base,
      globalCompleteObservedUnderIncomplete: false, exceedsD2bObservedUnderIncomplete: false }
  }
  if (input.unmeasured.length > 0) {
    return { case: 'D2C_INCOMPLETE' as D2CDecisionCase, reasons: [`${input.unmeasured.length} registered item(s) unmeasured or not executed: ${input.unmeasured.join(', ')}; the measured evidence is a lower bound`,
      `measured final: ${m === null ? 'none' : `${m.completed} completed / ${m.conflicts} Conflicts / ${m.steps} steps`} with ${input.k1Accepted.length} K1 Candidate(s) accepted`],
    lowerBound: true, ...base, globalCompleteObservedUnderIncomplete: input.finalR6, exceedsD2bObservedUnderIncomplete: exceeds }
  }
  const tail = { lowerBound: false, ...base, globalCompleteObservedUnderIncomplete: false, exceedsD2bObservedUnderIncomplete: false }
  if (input.finalR6) return { case: 'D2C_GLOBAL_COMPLETE_R' as D2CDecisionCase, reasons: ['finalResult satisfies R6 (43 / 43, Conflict 0, no resource_conflict, Trace Replay, R5)'], ...tail }
  if (exceeds) return { case: 'D2C_EXCEEDS_D2B_MAIN' as D2CDecisionCase, reasons: [`finalResult ${m!.completed} / ${m!.conflicts} is better than I0 ${input.i0Metrics!.completed} / ${input.i0Metrics!.conflicts}`], ...tail }
  if (input.k1Accepted.length >= 1) {
    return { case: 'D2C_K1_ACCEPTED_NOT_BETTER' as D2CDecisionCase, reasons: [`${input.k1Accepted.length} K1 Candidate(s) accepted; finalResult ${m?.completed} / ${m?.conflicts} is not better than I0`], ...tail }
  }
  return { case: 'D2C_NO_K1_ACCEPTED' as D2CDecisionCase, reasons: ['no K1 Candidate was accepted in the registered range (not a proof that K1 Candidates cannot improve it)',
    ...(input.boundLimitedEvaluations.length > 0 ? [`bound-limited evaluations: ${input.boundLimitedEvaluations.join(', ')}`] : [])], ...tail }
}

// ---------------------------------------------------------------- the run analysis

export interface D2CFileRef { file: string; bytes: number; sha256: string }

export interface D2CContextRow {
  unitId: string
  k: number
  contextId: string
  status: string | null
  notExecutedReason: string | null
  process: Json | null
  recordFile: D2CFileRef | null
}

export interface D2CDiscoveryRow {
  unitId: string
  k: number
  contextId: string
  rung: Phase2C27BRungId
  status: string | null
  notExecutedReason: string | null
  process: Json | null
  recordFile: D2CFileRef | null
}

export interface D2CEvaluationRow {
  evaluationId: string
  stage: D2CStage
  evaluatedAgainst: D2CEvaluatedAgainst
  label: string | null
  poolOrdinal: number | null
  contextId: string | null
  replacementLabels: string[]
  replacementTargets: string[]
  generatedEntryIds: string[]
  generatedEntrySha256s: (string | null)[]
  requiresSupport: string[]
  inputDigest: string | null
  status: string | null
  notExecutedReason: string | null
  process: Json | null
  recordFile: D2CFileRef | null
  runner: Json | null
}

export interface D2CCompositionRow {
  label: string
  acceptedBefore: string[]
  evaluatedCandidates: { evaluationId: string; ordinal: number; contextId: string }[]
  eligible: string[]
  chosen: string | null
  stepOutcome: D2StepOutcome
  stepNotEvaluatedReason: string | null
  acceptedAfter: string[]
  afterUnmeasuredStep: boolean
}

export interface D2CAnalysisInput {
  validated: D2CValidatedInputs
  exportSha256: string
  /** The Export `buildListEntries` (C1 / C3 / C4 / S4, recomputed independently of the child). */
  exportBuildListEntries: readonly unknown[]
  /** The Planner-start origin digest the analyzer recomputed from the Export (C4), or null when not recomputed. */
  recomputedOriginDigest: string | null
  contextRows: readonly D2CContextRow[]
  /** By CTX unit ID: the context record (null = none). */
  contextRecords: ReadonlyMap<string, Json | null>
  discoveryRows: readonly D2CDiscoveryRow[]
  discoveryRecords: ReadonlyMap<string, Json | null>
  /** By G store file name: the file read back (null = missing). */
  poolFiles: ReadonlyMap<string, { bytes: number; sha256: string; body: unknown } | null>
  evaluationRows: readonly D2CEvaluationRow[]
  evaluationRecords: ReadonlyMap<string, Json | null>
  compositionRows: readonly D2CCompositionRow[] | null
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

type RowStatus = D2CDiscoveryUnitStatus | D2EvaluationStatus | 'context_ready'
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
  'resultDigest', 'rejectedBuildListEntries', 'resourceConflictRejections', 'selectedTargetWeaponIds', 'supportStaticChecks', 'supportBodySha256Observed'] as const

type DependsOn = { id: string; status: string | null; unmeasuredReason: string | null; notExecutedReason: string | null }
export interface D2CPoolCandidate {
  /** Discovery ordinal of the Target (context ordinal, rung, delivery index). */
  ordinal: number
  contextId: string
  k: number
  supportBuildListEntryId: string
  unitId: string
  rung: Phase2C27BRungId
  indexInContext: number
  indexInUnit: number
  candidateStableKey: string
  keySha256: string
  cost: number
  routeKind: string
  routeOperationCount: number
  r0: boolean
  searchIdentity: string
  reservationDigest: string
  contextRecordSha256: string | null
  generatedBuildListEntryId: string
  reusedExisting: boolean
  generatedEntry: { file: string; bytes: number; sha256: string } | null
  replacement: { status: string; replacedBuildListEntryId: string | null }
  crossContextSameKey: { contextId: string; k: number; indexInContext: number }[]
}

interface ReplacementRef { label: string; targetIndex: number; targetWeaponId: string; currentBuildListEntryId: string; generatedBuildListEntryId: string; sha256: string | null; requiresSupport: string[];
  contextId: string | null; poolOrdinal: number | null; fromD2B: boolean }

export function analyzeD2CRun(input: D2CAnalysisInput) {
  const invalid: D2CInvalidReason[] = []
  const add = (category: D2CInvalidCategory, detail: string) => invalid.push({ category, detail })
  const v = input.validated
  if (!v.passed) for (const issue of v.issues) add('input_evidence', issue)
  for (const issue of input.provenanceIssues) add('provenance', issue)
  for (const issue of input.evidenceIssues) add('evidence_integrity', issue)
  for (const issue of input.rawConsistencyIssues) add('raw_result_mismatch', issue)
  const sha = input.sha256OfText
  const parityChecks: Json[] = []
  const parity = (check: { checkId: string; kind: string; state: D2CParityState; subjects: string[]; expected: unknown; observed: unknown; mismatches: string[]; notChecked: { dependsOn: DependsOn[] } | null;
    observedPrefixDiagnostic?: unknown; category: D2CInvalidCategory }) => {
    parityChecks.push({ ...check, observedPrefixDiagnostic: check.observedPrefixDiagnostic ?? null, category: check.state === 'mismatched' ? check.category : null })
    if (check.state === 'mismatched') add(check.category, `${check.checkId}: ${check.mismatches.join('; ')}`)
  }
  const exportById = new Map<string, Json[]>()
  for (const e of input.exportBuildListEntries) if (isObject(e) && typeof e.id === 'string') exportById.set(e.id, [...(exportById.get(e.id) ?? []), e])
  const targetOfLabel = (label: string) => { const i = Number(label.slice(1)); return { targetIndex: i, targetWeaponId: v.e1TargetWeaponIds[i] ?? '', currentBuildListEntryId: v.e1CurrentBuildListEntryIds[i] ?? '' } }

  // ---- CTX (§4.1 / §7.1)
  const contextRows = [...input.contextRows]
  if (contextRows.length > D2C_BUDGETS.contextChildren) add('guardrail', `${contextRows.length} context rows, above ${D2C_BUDGETS.contextChildren}`)
  const contexts: Json[] = []
  const ctxRecords = new Map<number, { record: D2CContextRecord; recordSha256: string } | null>()
  const ctxStatus = new Map<number, { status: RowStatus | null; row: D2CContextRow | null }>()
  for (const c of v.contexts) {
    const unitId = d2cContextUnitId(c.k)
    const row = contextRows.shift() ?? null
    let own = row
    if (row !== null && row.unitId !== unitId) { add('guardrail', `context row ${row.unitId} is not the registered next context ${unitId}`); contextRows.unshift(row); own = null }
    if (own === null && !input.interrupted) add('evidence_integrity', `${unitId}: the registered context has no row`)
    const json = own ? input.contextRecords.get(unitId) ?? null : null
    let status: RowStatus | null = own === null ? 'not_executed' : statusFromFiles(own.process, json, own.notExecutedReason, input.interrupted, d => add('evidence_integrity', `${unitId}: ${d}`))
    if (own !== null && own.status !== status) add('raw_result_mismatch', `${unitId}: the row status ${own.status} is not the record status ${status}`)
    if (own !== null && own.contextId !== c.contextId) add('raw_result_mismatch', `${unitId}: the row context is not ${c.contextId}`)
    if (json !== null && status !== 'not_executed') for (const issue of recordCalculationIssues(json)) add('guardrail', `${unitId}: ${issue}`)
    let record: D2CContextRecord | null = null
    if (status === 'context_ready' || status === 'guardrail_violation') {
      const read = readD2CContextRecord(json)
      if (read.issue !== null) { add('evidence_integrity', `${unitId}: ${read.issue}`); status = null }
      else record = read.record
    }
    if (status === 'guardrail_violation') add('guardrail', `${unitId}: ${JSON.stringify(record?.issues ?? [])} ${JSON.stringify(record?.checks ?? null)}`)
    let checks: Json | null = null
    let c5State: D2CParityState = 'not_checked'
    let c5: Json | null = null
    if (record !== null && status === 'context_ready') {
      if (record.contextId !== c.contextId || record.k !== c.k || record.targetWeaponId !== c.targetWeaponId || record.currentBuildListEntryId !== c.currentBuildListEntryId || record.supportBuildListEntryId !== c.supportBuildListEntryId) {
        add('raw_result_mismatch', `${unitId}: the record identity is not the registered context`)
      }
      checks = recomputeContextChecks(c, record, input, exportById, sha, (cat, d) => add(cat, `${unitId}: ${d}`))
      const recomputed = d2cContextParity(record.reservationBody, record.reservationDigest, c.registeredReservationDigest, c.phaseBUnits.map(u => ({ unitId: u.unitId, reservation: u.recordReservation })))
      if (!same(recomputed, record.checks.C5)) add('raw_result_mismatch', `${unitId}: the recorded C5 is not the recomputed one`)
      c5State = recomputed.state
      c5 = recomputed
      ctxRecords.set(c.k, { record, recordSha256: own?.recordFile?.sha256 ?? '' })
    } else ctxRecords.set(c.k, null)
    if (c.registeredReservationDigest === null) c5State = 'not_applicable'
    if (status !== 'context_ready' && c.registeredReservationDigest !== null && status !== null && status !== 'not_executed' && !(UNMEASURED_PROCESS as readonly string[]).includes(status)) c5State = 'not_applicable'
    if (c.registeredReservationDigest !== null) {
      const unmeasured = c5State === 'not_checked'
      parity({ checkId: `phase_b_k1_context:${c.contextId}`, kind: 'phase_b_k1_context', state: c5State, subjects: [unitId, ...c.phaseBUnits.map(u => `PhaseB:${u.unitId}`)],
        expected: { reservationDigest: c.registeredReservationDigest, phaseBUnitIds: c.phaseBUnits.map(u => u.unitId) }, observed: c5,
        mismatches: c5State === 'mismatched' ? [`digestMatched=${String(c5?.digestMatched)} bodyMatched=${JSON.stringify(c5?.bodyMatched)}`] : [],
        notChecked: unmeasured ? { dependsOn: [{ id: unitId, status, unmeasuredReason: status === 'not_executed' ? null : status, notExecutedReason: own?.notExecutedReason ?? (own === null ? 'interrupted' : null) }] } : null,
        category: 'phase_b_k1_parity' })
    }
    ctxStatus.set(c.k, { status, row: own })
    const ready = status === 'context_ready' && record !== null
    contexts.push({ contextId: c.contextId, k: c.k, label: c.label, targetWeaponId: c.targetWeaponId, currentBuildListEntryId: c.currentBuildListEntryId, supportBuildListEntryId: c.supportBuildListEntryId,
      supportTargetWeaponId: c.supportTargetWeaponId, observations: c.observations, observedEvaluations: c.observedEvaluations, orderInTarget: c.orderInTarget, b0SelectedInD2: c.b0Selected,
      d2bFinalSelected: c.d2bFinalSelected, b0SupportConflicts: c.b0SupportConflicts, status, unmeasuredReason: status === null || status === 'context_ready' || status === 'not_executed' || status === 'guardrail_violation' ? null : status,
      notExecutedReason: status === 'not_executed' ? (own?.notExecutedReason ?? 'interrupted') : null, process: own?.process ?? null, record: own?.recordFile ?? null,
      supportBodySha256: ready ? record!.supportBodySha256 : null, reservationDigest: ready ? record!.reservationDigest : null, reservationBody: ready ? structuredClone(record!.reservationBody) : null,
      originDigest: ready ? record!.originDigest : null, excludedRouteKeySha256s: ready ? [...record!.excludedRouteKeySha256s] : [],
      checks: ready ? { ...checks, C5: { state: c5State, expectedDigest: c.registeredReservationDigest, phaseBUnitIds: c.phaseBUnits.map(u => u.unitId), bodyMatched: (c5?.bodyMatched as boolean[] | undefined) ?? [] } } : null,
      discoveryStop: null, discoveryIncompleteAfterUnmeasured: false, wallMs: typeof own?.process?.wallMs === 'number' ? own.process.wallMs : null, ...memoryOf(json, own?.process ?? null) })
  }
  for (const extra of contextRows) add('guardrail', `context row ${extra.unitId} is beyond the registered contexts`)
  const ready = (k: number) => ctxStatus.get(k)?.status === 'context_ready' && ctxRecords.get(k) != null

  // ---- DSC: rung-major replay (§4.2 - §4.4, §8.1)
  const dscRows = [...input.discoveryRows]
  if (dscRows.length > D2C_BUDGETS.discoveryUnitsMax) add('guardrail', `${dscRows.length} discovery units, above ${D2C_BUDGETS.discoveryUnitsMax}`)
  const scheduler = new D2CDiscoveryScheduler(v.contexts.map(c => c.k), ready)
  const units: Json[] = []
  const contextPools = new Map<number, Omit<D2CPoolCandidate, 'ordinal' | 'crossContextSameKey'>[]>()
  const contextDepends = new Map<number, DependsOn | null>()
  const executed = new Map<string, { status: RowStatus | null; comparable: boolean; deliveredCandidates: number | null; row: D2CDiscoveryRow | null }>()
  for (const c of v.contexts) contextPools.set(c.k, [])
  for (const item of scheduler.items()) {
    const c = v.contexts.find(x => x.k === item.k)!
    const unitId = d2cDiscoveryUnitId(item.k, item.rung)
    const pool = contextPools.get(item.k)!
    const poolSizeAtStart = pool.length
    const next = dscRows.shift() ?? null
    let row = next
    if (next !== null && next.unitId !== unitId) { add('guardrail', `discovery row ${next.unitId} is not the registered next unit ${unitId}`); dscRows.unshift(next); row = null }
    const base = { unitId, contextId: c.contextId, label: c.label, rung: item.rung, poolSizeAtStart }
    if (row === null) {
      if (!input.interrupted) add('evidence_integrity', `${unitId}: the registered unit has no row`)
      const reason = item.dependency ? 'dependency_unmeasured' : 'interrupted'
      units.push({ ...base, extent: d2cRungExtent(item.rung), status: 'not_executed', unmeasuredReason: null, notExecutedReason: reason, process: null, searchIdentity: null, reservationDigest: null, poolSizeAtEnd: pool.length,
        deliveries: [], search: null, phaseBParity: null, searchOnlyMs: null, materializeMs: null, wallMs: null, peakHeapBytes: null, peakRssBytes: null })
      executed.set(unitId, { status: 'not_executed', comparable: false, deliveredCandidates: null, row: null })
      scheduler.report(item.k, item.rung, 'not_executed', pool.length)
      contextDepends.set(item.k, { id: unitId, status: 'not_executed', unmeasuredReason: null, notExecutedReason: reason })
      continue
    }
    if (row.contextId !== c.contextId || row.k !== item.k || row.rung !== item.rung) add('raw_result_mismatch', `${unitId}: the row context / rung is not the registered one`)
    if (item.dependency && (row.status !== 'not_executed' || row.notExecutedReason !== 'dependency_unmeasured' || row.process !== null)) add('raw_result_mismatch', `${unitId}: a unit of a context whose CTX was not ready must be not_executed (dependency_unmeasured)`)
    const record = input.discoveryRecords.get(unitId) ?? null
    let status = statusFromFiles(row.process, record, row.notExecutedReason, input.interrupted, d => add('evidence_integrity', `${unitId}: ${d}`)) as D2CDiscoveryUnitStatus | null
    if (row.status !== status) add('raw_result_mismatch', `${unitId}: the row status ${row.status} is not the record status ${status}`)
    const result = record !== null && isObject(record.result) ? record.result : null
    let measured = status !== null && D2C_DISCOVERY_MEASURED.includes(status)
    const deliveries: Json[] = []
    let search: Json | null = null
    if (status === 'guardrail_violation') add('guardrail', `${unitId}: ${JSON.stringify(result?.issues ?? [])}`)
    if (record !== null && status !== 'not_executed') for (const issue of recordCalculationIssues(record)) add('guardrail', `${unitId}: ${issue}`)
    const ctx = ctxRecords.get(item.k) ?? null
    let searchIdentity: string | null = null
    if (measured && result !== null) {
      const observedContext = isObject(result.observedContext) ? result.observedContext : null
      const ok = Array.isArray(result.deliveries) && Array.isArray(result.pooled) && isObject(result.search) && result.poolSizeAtStart === poolSizeAtStart && result.unitId === unitId && observedContext !== null
        && typeof result.searchIdentity === 'string'
      if (!ok || ctx === null) { add('evidence_integrity', `${unitId}: the measured record lacks deliveries / pooled / search / poolSizeAtStart / observedContext or they differ from the replay`); status = null; measured = false }
      else {
        searchIdentity = result.searchIdentity as string
        search = result.search as Json
        // Context drift (§4.2): the unit's re-derived context must be the CTX record one.
        if (observedContext!.reservationDigest !== ctx.record.reservationDigest || observedContext!.originDigest !== ctx.record.originDigest || !same(observedContext!.excludedRouteKeys, ctx.record.excludedRouteKeys)
          || observedContext!.currentBuildListEntryId !== c.currentBuildListEntryId) add('guardrail', `${unitId}: context_drift - the unit context is not the CTX record`)
        const priorKeys = new Set(pool.map(p => p.candidateStableKey))
        const d2b = new Map(c.d2bK0Pool.map(p => [p.keySha256, p.ordinal]))
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
          if (!isObject(d.r0) || d.r0.respects !== true) add('guardrail', `${unitId}: delivery ${i} does not respect the context reservation (R0)`)
          const d2bOrdinal = d2b.get(keySha256) ?? null
          const expectedAction = priorKeys.has(key) ? 'duplicate_of_lower_rung' : d2bOrdinal !== null ? 'same_key_as_d2b_k0_pool' : 'pooled'
          if (d.action !== expectedAction) add('raw_result_mismatch', `${unitId}: delivery ${i} action ${d.action} is not the replayed ${expectedAction}`)
          if ((d.d2bK0Ordinal ?? null) !== (expectedAction === 'same_key_as_d2b_k0_pool' ? d2bOrdinal : null)) add('raw_result_mismatch', `${unitId}: delivery ${i} D2-B K0 ordinal`)
          deliveries.push({ indexInUnit: i, keySha256, cost: d.cost, r0: isObject(d.r0) && d.r0.respects === true, action: expectedAction, d2bK0Ordinal: expectedAction === 'same_key_as_d2b_k0_pool' ? d2bOrdinal : null })
          if (expectedAction !== 'pooled') return
          const p = recordPooled[pooledIndex] ?? null
          pooledIndex += 1
          const indexInContext = pool.length + 1
          if (p === null || p.candidateStableKey !== key || p.indexInUnit !== i || p.indexInContext !== indexInContext) { add('raw_result_mismatch', `${unitId}: the pooled Candidate of delivery ${i} differs from the replay`); return }
          const file = isObject(p.generatedEntryFile) ? p.generatedEntryFile as unknown as D2CFileRef : null
          const stored = file ? input.poolFiles.get(file.file) ?? null : null
          const issues: string[] = []
          if (file === null || stored === null || stored.sha256 !== file.sha256 || stored.bytes !== file.bytes) issues.push('the G store body is missing or not the one the child wrote')
          if (file !== null && file.file !== `${c.contextId}-c${indexInContext}.generated-entry.json`) issues.push('the G store file name is not the context one')
          const body = stored !== null && isObject(stored.body) ? stored.body as unknown as BuildListEntry : null
          if (body === null || body.id !== p.generatedBuildListEntryId || body.targetWeaponId !== c.targetWeaponId || !isObject(body.candidateSnapshot) || candidateStableKey(body.candidateSnapshot) !== key
            || body.candidateSnapshot.searchRunId !== p.searchIdentity) issues.push('the G store body is not the pooled G (ID / Target / stable key / Search identity)')
          if (issues.length > 0) add('evidence_integrity', `${unitId} ${c.contextId} c${indexInContext}: ${issues.join('; ')}`)
          const replacement = isObject(p.replacement) ? { status: String(p.replacement.status), replacedBuildListEntryId: typeof p.replacement.replacedBuildListEntryId === 'string' ? p.replacement.replacedBuildListEntryId : null } : { status: 'missing', replacedBuildListEntryId: null }
          if (p.reusedExisting !== true && (replacement.status !== 'ready' || replacement.replacedBuildListEntryId !== c.currentBuildListEntryId)) add('guardrail', `${unitId} c${indexInContext}: the G does not replace O_t`)
          if (p.reservationDigest !== ctx.record.reservationDigest) add('guardrail', `${unitId} c${indexInContext}: the Search reservation digest is not the CTX record digest`)
          if (p.searchIdentity !== searchIdentity) add('raw_result_mismatch', `${unitId} c${indexInContext}: the pooled Search identity is not the unit one`)
          if (!isObject(p.r0) || p.r0.respects !== true) add('guardrail', `${unitId} c${indexInContext}: R0 fails`)
          pool.push({ contextId: c.contextId, k: c.k, supportBuildListEntryId: c.supportBuildListEntryId, unitId, rung: item.rung, indexInContext, indexInUnit: i, candidateStableKey: key, keySha256,
            cost: Number(p.cost), routeKind: String(p.routeKind), routeOperationCount: Number(p.routeOperationCount), r0: isObject(p.r0) && p.r0.respects === true, searchIdentity: String(p.searchIdentity),
            reservationDigest: String(p.reservationDigest), contextRecordSha256: ctx.recordSha256 || null, generatedBuildListEntryId: String(p.generatedBuildListEntryId), reusedExisting: p.reusedExisting === true,
            generatedEntry: issues.length === 0 && file ? { file: file.file, bytes: file.bytes, sha256: file.sha256 } : null, replacement })
        })
        if (pooledIndex !== recordPooled.length) add('raw_result_mismatch', `${unitId}: the record pools ${recordPooled.length} Candidate(s), the replay ${pooledIndex}`)
        if (recordDeliveries.length > D2C_BUDGETS.deliveriesPerUnitMax) add('guardrail', `${unitId}: ${recordDeliveries.length} deliveries, above ${D2C_BUDGETS.deliveriesPerUnitMax}`)
        if (search.deliveredCandidates !== recordDeliveries.length) add('raw_result_mismatch', `${unitId}: deliveredCandidates is not the delivery count`)
        let replayed: string | null
        try { replayed = d2DiscoveryUnitOutcome({ exhausted: search.exhausted === true, stoppedByExtent: search.stoppedByExtent === true }, search.stoppedByConsumer === true, item.rung) } catch { replayed = null }
        if (replayed !== status) add('raw_result_mismatch', `${unitId}: the status ${status} is not the replayed ${replayed}`)
        if ((status === 'discovery_cap_reached') !== (pool.length === D2C_K1_POOL_CAP)) add('raw_result_mismatch', `${unitId}: the consumer stop and the full pool do not go together`)
      }
    }
    const comparable = status !== null && (measured || status === 'discovery_calculation_error' || status === 'guardrail_violation')
    executed.set(unitId, { status, comparable, deliveredCandidates: search ? Number(search.deliveredCandidates) : null, row })
    const timing = result && isObject(result.timing) ? result.timing : null
    const unmeasuredReason = status === null || measured || status === 'not_executed' ? null : status
    units.push({ ...base, extent: d2cRungExtent(item.rung), status, unmeasuredReason, notExecutedReason: row.notExecutedReason, process: row.process, searchIdentity,
      reservationDigest: ctx?.record.reservationDigest ?? null, poolSizeAtEnd: pool.length, deliveries, search, phaseBParity: null,
      searchOnlyMs: typeof timing?.searchOnlyMs === 'number' ? timing.searchOnlyMs : null, materializeMs: typeof timing?.materializeMs === 'number' ? timing.materializeMs : null,
      wallMs: typeof row.process?.wallMs === 'number' ? row.process.wallMs : null, ...memoryOf(record, row.process) })
    scheduler.report(item.k, item.rung, status ?? 'process_failure', pool.length)
    if (!measured) contextDepends.set(item.k, { id: unitId, status, unmeasuredReason, notExecutedReason: row.notExecutedReason })
  }
  for (const extra of dscRows) add('guardrail', `discovery row ${extra.unitId} is beyond the registered rung-major escalation`)
  // Phase B K1 prefix parity (§9), one per registered Phase B unit.
  for (const c of v.contexts) {
    for (const pb of c.phaseBUnits) {
      const unitId = d2cDiscoveryUnitId(c.k, pb.rung)
      const u = executed.get(unitId)
      let state: D2CParityState, mismatches: string[] = [], notChecked: { dependsOn: DependsOn[] } | null = null
      if (u !== undefined) {
        const p = d2cPhaseBK1PrefixParity({ comparable: u.comparable, status: u.status as D2CDiscoveryUnitStatus | null, deliveredCandidates: u.deliveredCandidates })
        state = p.state; mismatches = p.mismatches
        if (state === 'not_checked') notChecked = { dependsOn: [{ id: unitId, status: u.status, unmeasuredReason: u.status === 'not_executed' ? null : u.status, notExecutedReason: u.row?.notExecutedReason ?? (u.row === null ? 'interrupted' : null) }] }
      } else {
        const stop = scheduler.stop(c.k)
        const dep = contextDepends.get(c.k) ?? null
        if ((stop === 'unmeasured' || stop === 'not_executed') && dep !== null) { state = 'not_checked'; notChecked = { dependsOn: [dep] } }
        else state = 'not_applicable'
      }
      const unit = units.find(x => x.unitId === unitId)
      if (unit) unit.phaseBParity = { state, phaseBUnitId: pb.unitId, mismatches, notChecked, observedPrefixDiagnostic: null }
      parity({ checkId: `phase_b_k1_prefix:${pb.unitId}`, kind: 'phase_b_k1_prefix', state, subjects: [unitId, `PhaseB:${pb.unitId}`], expected: { result: 'stopped_by_search_extent_bound', deliveredCandidates: 0 },
        observed: u ? { status: u.status, deliveredCandidates: u.deliveredCandidates } : null, mismatches, notChecked, category: 'phase_b_k1_parity' })
    }
  }
  for (const u of units) if (u.phaseBParity === null) u.phaseBParity = { state: 'not_applicable', phaseBUnitId: null, mismatches: [], notChecked: null, observedPrefixDiagnostic: null }

  // ---- pools, discovery ordinals and D-3 (§4.3 / §5.1)
  const pools = new Map<string, D2CPoolCandidate[]>()
  for (const t of v.scopeTargets) {
    const list: D2CPoolCandidate[] = []
    for (const c of v.contexts.filter(x => x.label === t.label).sort((a, b) => a.k - b.k)) for (const p of contextPools.get(c.k) ?? []) list.push({ ...p, ordinal: list.length + 1, crossContextSameKey: [] })
    for (const p of list) p.crossContextSameKey = list.filter(o => o.contextId !== p.contextId && o.candidateStableKey === p.candidateStableKey).map(o => ({ contextId: o.contextId, k: o.k, indexInContext: o.indexInContext }))
    pools.set(t.label, list)
  }
  const pooledAll = [...pools.values()].flat()
  if (pooledAll.length > D2C_BUDGETS.uniqueCandidatesMax) add('guardrail', `${pooledAll.length} pooled Candidates, above ${D2C_BUDGETS.uniqueCandidatesMax}`)
  for (const c of v.contexts) {
    const ctxJson = contexts.find(x => x.contextId === c.contextId)!
    const stop: D2CDiscoveryStop | null = ready(c.k) ? scheduler.stop(c.k) : 'not_executed'
    const poolSize = (contextPools.get(c.k) ?? []).length
    ctxJson.discoveryStop = stop
    ctxJson.discoveryIncompleteAfterUnmeasured = (stop === 'unmeasured' || stop === 'not_executed') && poolSize > 0
  }

  // ---- evaluations: replay the registered order (B0, I0, ADM, CMP)
  const rows = [...input.evaluationRows]
  const evaluations: Json[] = []
  const evalById = new Map<string, Json>()
  if (new Set(rows.map(r => r.evaluationId)).size !== rows.length) add('guardrail', 'an evaluation repeats')
  let b0Facts: D2EvaluationFacts | null = null
  let b0Selected: Set<string> | null = null
  const ctxByContextId = new Map(v.contexts.map(c => [c.contextId, c]))

  const evaluateRow = (spec: { evaluationId: string; stage: D2CStage; label: string | null; poolOrdinal: number | null; contextId: string | null; replacements: ReplacementRef[];
    reference: { evaluationId: string; facts: D2EvaluationFacts } | null }) => {
    const row = rows.shift() ?? null
    if (row !== null && row.evaluationId !== spec.evaluationId) { add('guardrail', `evaluation row ${row.evaluationId} is not the registered next evaluation ${spec.evaluationId}`); rows.unshift(row) }
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
    const reps = [...spec.replacements].sort((a, b) => a.targetIndex - b.targetIndex)
    const replacementTargets = reps.map(r => r.targetWeaponId)
    const generatedIds = reps.map(r => r.generatedBuildListEntryId)
    const shas = reps.map(r => r.sha256)
    const support = [...new Set(reps.flatMap(r => r.requiresSupport))].sort(compare)
    const evaluatedAgainst = d2cEvaluatedAgainst(spec.stage)
    const inputDigestAll = shas.some(s => s === null) ? null : d1InputDigest(replacementTargets, generatedIds, shas as string[], input.exportSha256)
    if (own !== null && (own.stage !== spec.stage || own.evaluatedAgainst !== evaluatedAgainst || !same(own.replacementTargets, replacementTargets) || !same(own.generatedEntryIds, generatedIds)
      || !same(own.generatedEntrySha256s, shas) || !same(own.requiresSupport, support) || own.poolOrdinal !== spec.poolOrdinal || own.contextId !== spec.contextId)) add('raw_result_mismatch', `${spec.evaluationId}: the row inputs are not the replayed inputs`)
    const executedRow = own !== null && own.process !== null
    if (executedRow && own.inputDigest !== inputDigestAll) add('raw_result_mismatch', `${spec.evaluationId}: inputDigest differs from the recomputed one`)
    const result = record !== null && isObject(record.result) ? record.result : null
    if (record !== null && status !== 'not_executed') for (const issue of recordCalculationIssues(record)) add('guardrail', `${spec.evaluationId}: ${issue}`)
    if (status === 'guardrail_violation') add('guardrail', `${spec.evaluationId}: ${JSON.stringify(result?.issues ?? [])}`)
    const measuredRun = status === 'evaluated' || status === 'preflight_refused' || status === 'planner_rerun_bound_reached'
    let facts: (D2EvaluationFacts & { supportBodySha256Observed: Record<string, string> }) | null = null
    if (measuredRun && result !== null) {
      const missing = MEASURED_FACT_FIELDS.filter(f => !(f in result))
      if (missing.length > 0) add('evidence_integrity', `${spec.evaluationId}: the measured record lacks ${missing.join(', ')}`)
      else facts = result as unknown as D2EvaluationFacts & { supportBodySha256Observed: Record<string, string> }
    }
    if (status === 'calculation_error' && (result === null || !isObject(result.error))) add('evidence_integrity', `${spec.evaluationId}: a calculation error record without the error`)
    if (facts !== null && facts.runConflictResolutions !== 0) add('guardrail', `${spec.evaluationId}: G1 - the run received a conflict resolution`)
    if (facts !== null && facts.fullRunsStarted > D2C_EVALUATION_FULL_RUN_CAP) add('guardrail', `${spec.evaluationId}: ${facts.fullRunsStarted} full runs, above 8`)
    const resultDigest = facts !== null ? d1ResultDigest(facts) : null
    if (facts !== null && facts.resultDigest !== resultDigest) add('raw_result_mismatch', `${spec.evaluationId}: resultDigest differs from the recomputed one`)
    // S4 / S5 (§7.2), checked against the CTX record independently of the child.
    const selected = new Set(facts?.plan.selectedBuildListEntryIds ?? [])
    const removed = new Set(facts?.runtimeUnsupportedRemoved ?? [])
    const supportChecksByEntry: Json = {}
    for (const id of support) {
      const owner = reps.find(r => r.requiresSupport.includes(id))!
      const ctx = owner.contextId === null ? null : ctxRecords.get(ctxByContextId.get(owner.contextId)?.k ?? -1) ?? null
      if (facts === null) { supportChecksByEntry[id] = { S1: null, S2: null, S3: null, S4: null, S5: null, selected: null, supportExpiryCause: null }; continue }
      const c = isObject(facts.supportStaticChecks) ? facts.supportStaticChecks[id] : undefined
      const dynamic = facts.supportChecks[id]
      if (c === undefined || !isObject(c.S5) || dynamic === undefined || ctx === null) { add('evidence_integrity', `${spec.evaluationId}: no static S4 / S5 or dynamic record of the support Entry ${id}, or no CTX record`); continue }
      const exportBody = (exportById.get(id) ?? [])[0]
      const exportSha = exportBody === undefined ? null : sha(stableStringify(exportBody))
      const s4 = c.S4 === true && facts.supportBodySha256Observed?.[id] === ctx.record.supportBodySha256 && exportSha === ctx.record.supportBodySha256
      if (!s4) add('guardrail', `${spec.evaluationId}: S4 of the support Entry ${id} does not hold against the CTX record`)
      if (c.S5.digestExpected !== ctx.record.reservationDigest || !same(c.S5.bodyExpected, ctx.record.reservationBody) || !isObject(c.S5.bodyExpected)) add('guardrail', `${spec.evaluationId}: S5 compared against a reservation that is not the CTX record digest / body`)
      const s5 = c.S5.digestMatched === true && c.S5.bodyMatched === true && c.S5.satisfied === true && c.S5.digestObserved === c.S5.digestExpected && same(c.S5.bodyObserved, c.S5.bodyExpected)
      if (!s5) add('guardrail', `${spec.evaluationId}: S5 of the support Entry ${id} does not hold`)
      if (dynamic.S4 !== c.S4 || dynamic.S5 !== c.S5.satisfied) add('raw_result_mismatch', `${spec.evaluationId}: supportChecks S4 / S5 are not the static checks`)
      // S1 recomputed: the support Target is not in T.
      const supportTarget = exportBody !== undefined && typeof exportBody.targetWeaponId === 'string' ? exportBody.targetWeaponId : null
      if (dynamic.S1 !== (supportTarget !== null && !replacementTargets.includes(supportTarget))) add('raw_result_mismatch', `${spec.evaluationId}: S1 of ${id} is not the recomputed one`)
      const isSelected = facts.plan.present ? selected.has(id) : null
      const checks = { S1: dynamic.S1, S2: dynamic.S2, S3: dynamic.S3, S4: s4, S5: s5 }
      supportChecksByEntry[id] = { S1: dynamic.S1, S2: dynamic.S2, S3: dynamic.S3, S4: s4,
        S5: { digestExpected: c.S5.digestExpected, digestObserved: c.S5.digestObserved, digestMatched: c.S5.digestMatched, bodyExpected: structuredClone(c.S5.bodyExpected), bodyObserved: structuredClone(c.S5.bodyObserved),
          bodyMatched: c.S5.bodyMatched, satisfied: s5 },
        selected: isSelected, supportExpiryCause: d2cSupportExpiryCause(checks, isSelected, removed.has(id)) }
    }
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
    const candidates = reps.map(r => {
      const commitment = (facts?.routeCommitment ?? []).find(x => x.buildListEntryId === r.generatedBuildListEntryId) ?? null
      const coParticipants = [...new Set((facts?.conflicts ?? []).filter(x => x.participants.includes(r.generatedBuildListEntryId)).flatMap(x => x.participants.filter(id => id !== r.generatedBuildListEntryId)))].sort(compare)
      return { targetWeaponId: r.targetWeaponId, label: r.label, generatedBuildListEntryId: r.generatedBuildListEntryId, poolOrdinal: r.poolOrdinal, contextId: r.contextId, fromD2B: r.fromD2B, isK1Candidate: r.requiresSupport.length > 0,
        selected: facts?.plan.present ? selected.has(r.generatedBuildListEntryId) : null, commitmentStatus: commitment?.status ?? null, winnerBuildListEntryId: commitment?.provisionalOutcomeSelectedBuildListEntryId ?? null,
        conflictCoParticipants: coParticipants,
        targetRegressedR: b0Selected === null || facts === null || !facts.plan.present ? null : b0Selected.has(r.currentBuildListEntryId) && !selected.has(r.generatedBuildListEntryId),
        requiresSupport: [...r.requiresSupport], supportSelected: r.requiresSupport.filter(id => selected.has(id)) }
    })
    const M = new Set([...generatedIds, ...support])
    const conflicts = (facts?.conflicts ?? []).map(x => ({ ...x, membersOfM: x.participants.filter(id => M.has(id)).length }))
    const diff = (other: D2EvaluationFacts | null) => {
      if (facts === null || other === null) return null
      return { completedDelta: (facts.plan.termination?.completedTargetCount ?? 0) - (other.plan.termination?.completedTargetCount ?? 0), conflictDelta: facts.conflicts.length - other.conflicts.length,
        stepsDelta: facts.plan.steps === null || other.plan.steps === null ? null : facts.plan.steps - other.plan.steps,
        targetsGained: facts.selectedTargetWeaponIds.filter(id => !other.selectedTargetWeaponIds.includes(id)).sort(compare),
        targetsLost: other.selectedTargetWeaponIds.filter(id => !facts.selectedTargetWeaponIds.includes(id)).sort(compare) }
    }
    const baselineDiff = spec.stage === 'B0' ? null : diff(b0Facts)
    const refDiff = spec.reference === null ? null : diff(spec.reference.facts)
    const referenceDiff = refDiff === null || spec.reference === null ? null : { referenceEvaluationId: spec.reference.evaluationId, ...refDiff }
    const proposedCompleted = facts?.plan.termination?.completedTargetCount ?? null
    const referenceCompleted = spec.reference?.facts.plan.termination?.completedTargetCount ?? null
    const gateJudged = spec.stage === 'CMP'
    const gate = gateJudged && facts !== null ? { judged: true, referenceCompleted, proposedCompleted, satisfied: proposedCompleted !== null && referenceCompleted !== null && proposedCompleted >= referenceCompleted }
      : { judged: false, referenceCompleted: gateJudged ? referenceCompleted : null, proposedCompleted: null, satisfied: null }
    const eligible = gateJudged && status === 'evaluated' && r5.satisfied === true && gate.satisfied === true
    const r5OnlyEligible = gateJudged && status === 'evaluated' && r5.satisfied === true && gate.satisfied !== true
    let r1r4: Json | null = null
    if (spec.stage === 'ADM') {
      const r = reps[0]!
      const pc = (pools.get(r.label) ?? []).find(p => p.ordinal === r.poolOrdinal) ?? null
      const discovery = { reusedExisting: pc?.reusedExisting === true, replacementReady: pc !== null && (pc.reusedExisting || (pc.replacement.status === 'ready' && pc.replacement.replacedBuildListEntryId === r.currentBuildListEntryId)) }
      const rr = d2R1R4((status ?? 'process_failure') as D2EvaluationStatus, facts, r.generatedBuildListEntryId, r.requiresSupport, discovery)
      const verdict = facts?.trialVerdict ?? null
      r1r4 = { R1: rr.R1, R1FailureReason: rr.R1FailureReason, R1Conditions: rr.conditions, R2: rr.R2, R3: rr.R3, R4: rr.R4, supportVacuous: rr.supportVacuous, targetRegressedR: candidates[0]!.targetRegressedR,
        foundRDiagnostic: verdict === null ? null : verdict.status === 'found_R', foundRVerdict: verdict, winnerBuildListEntryId: candidates[0]!.winnerBuildListEntryId, conflictCoParticipants: candidates[0]!.conflictCoParticipants,
        supportDynamicChecks: Object.fromEntries(r.requiresSupport.map(id => [id, facts?.supportChecks[id] ?? null])) }
      if (own?.runner && isObject(own.runner) && own.runner.r1 !== undefined && own.runner.r1 !== rr.R1) add('raw_result_mismatch', `${spec.evaluationId}: the runner R1 differs from the analyzer R1`)
    }
    const unmeasuredReason = status === null || MEASURED_EVALUATION.includes(status) || status === 'not_executed' ? null : status
    const e: Json = {
      evaluationId: spec.evaluationId, stage: spec.stage, ordinal: evaluations.length, evaluatedAgainst, targetLabel: spec.label, poolOrdinal: spec.poolOrdinal, contextId: spec.contextId,
      replacementTargets, replacementTargetLabels: reps.map(r => r.label), generatedEntryIds: generatedIds, generatedEntrySha256s: shas, requiresSupport: support,
      status, unmeasuredReason, notExecutedReason: status === 'not_executed' ? notExecutedReason : null, process: own?.process ?? null,
      inputDigest: executedRow ? inputDigestAll : null, replayedInputDigest: inputDigestAll, resultDigest,
      fullRunsStarted: facts?.fullRunsStarted ?? null, runtimeUnsupportedRemoved: facts?.runtimeUnsupportedRemoved ?? [],
      preflight: facts ? { status: facts.preflight.status, refusal: facts.preflight.refusal } : null,
      plan: facts ? { present: facts.plan.present, termination: facts.plan.termination, steps: facts.plan.steps, selectedBuildListEntryIds: facts.plan.selectedBuildListEntryIds, warningKinds: facts.plan.warningKinds } : null,
      conflicts, routeCommitment: facts?.routeCommitment ?? [], candidates, r5, r6, r1r4,
      rejectedBuildListEntries: facts?.rejectedBuildListEntries ?? [], resourceConflictRejections: facts?.resourceConflictRejections ?? null, selectedTargetWeaponIds: facts?.selectedTargetWeaponIds ?? [],
      supportChecksByEntry, parity: null, baselineDiff, referenceDiff, gate, eligible, r5OnlyEligible, d2bParity: null, composition: null,
      boundLimited: isD1BoundLimited(r5Status, facts), errorDetail: status === 'calculation_error' && result && isObject(result.error) ? result.error : null,
      wallMs: typeof own?.process?.wallMs === 'number' ? own.process.wallMs : null, childWallMs: record !== null && typeof record.wallMs === 'number' ? record.wallMs : null, ...memoryOf(record, own?.process ?? null),
    }
    evaluations.push(e)
    evalById.set(spec.evaluationId, e)
    return { e, status: status as D2EvaluationStatus | null, facts: facts as D2EvaluationFacts | null, r5Satisfied: r5.satisfied }
  }
  const isMeasuredEval = (s: unknown) => typeof s === 'string' && MEASURED_EVALUATION.includes(s)
  const i0Refs: ReplacementRef[] = v.i0.map(x => ({ label: x.label, targetIndex: x.targetIndex, targetWeaponId: x.targetWeaponId, currentBuildListEntryId: x.currentBuildListEntryId,
    generatedBuildListEntryId: x.generatedBuildListEntryId, sha256: x.sha256, requiresSupport: [], contextId: null, poolOrdinal: x.ordinal, fromD2B: true }))

  // B0
  const b0 = evaluateRow({ evaluationId: 'B0', stage: 'B0', label: null, poolOrdinal: null, contextId: null, replacements: [], reference: null })
  if (b0.status === 'evaluated' && b0.facts !== null) { b0Facts = b0.facts; b0Selected = new Set(b0.facts.plan.selectedBuildListEntryIds) }
  {
    const comparable = b0.status !== null && COMPARABLE_EVALUATION.includes(b0.status)
    let state: D2CParityState = 'not_checked', mismatches: string[] = []
    if (comparable) {
      const p = d1B0Parity(b0.facts?.baselineSummary ?? null, v.phase2c2BaselineSummary)
      mismatches = [...p.mismatches.map(m => `Phase 2-C2 ${m}`), ...(b0.status !== 'evaluated' ? [`status ${b0.status}`] : []),
        ...(v.d2 !== null && b0.e.resultDigest !== v.d2.b0.resultDigest ? ['resultDigest is not the D2 B0 one'] : []), ...(v.d2 !== null && b0.e.replayedInputDigest !== v.d2.b0.inputDigest ? ['inputDigest is not the D2 B0 one'] : [])]
      state = mismatches.length === 0 ? 'matched' : 'mismatched'
    }
    b0.e.parity = { compared: ['phase2c2BaselineSummary', 'd2B0InputDigest', 'd2B0ResultDigest'], matched: state === 'matched', state, mismatches }
    parity({ checkId: 'baseline:B0', kind: 'baseline', state, subjects: ['B0'], expected: { inputDigest: v.d2?.b0.inputDigest ?? null, resultDigest: v.d2?.b0.resultDigest ?? null },
      observed: { status: b0.status, inputDigest: b0.e.replayedInputDigest, resultDigest: b0.e.resultDigest }, mismatches,
      notChecked: state === 'not_checked' ? { dependsOn: [{ id: 'B0', status: b0.status, unmeasuredReason: b0.e.unmeasuredReason as string | null, notExecutedReason: b0.e.notExecutedReason as string | null }] } : null,
      category: 'baseline_parity_mismatch' })
  }

  // I0
  const i0 = evaluateRow({ evaluationId: 'I0', stage: 'I0', label: null, poolOrdinal: null, contextId: null, replacements: i0Refs, reference: null })
  let i0State: D2CParityState = 'not_checked'
  {
    const comparable = i0.status !== null && COMPARABLE_EVALUATION.includes(i0.status)
    let mismatches: string[] = []
    if (comparable) {
      mismatches = v.d2 === null ? ['no D2 reference'] : d2cI0Parity(v.d2.i0, { status: i0.status, inputDigest: i0.e.replayedInputDigest as string | null, resultDigest: i0.e.resultDigest as string | null,
        termination: i0.facts?.plan.termination?.status ?? null, completed: i0.facts?.plan.termination?.completedTargetCount ?? null, totalTargetCount: i0.facts?.plan.termination?.totalTargetCount ?? null,
        conflicts: i0.facts ? i0.facts.conflicts.length : null, steps: i0.facts?.plan.steps ?? null, r5Satisfied: i0.r5Satisfied })
      i0State = mismatches.length === 0 ? 'matched' : 'mismatched'
    }
    i0.e.d2bParity = { state: i0State, matchedD2EvaluationIds: i0State === 'matched' && v.d2 ? [v.d2.i0.evaluationId] : [], resultDigestsEqual: comparable ? i0.e.resultDigest === v.d2?.i0.resultDigest : null,
      notChecked: i0State === 'not_checked' ? { dependsOn: [{ id: 'I0', status: i0.status, unmeasuredReason: i0.e.unmeasuredReason, notExecutedReason: i0.e.notExecutedReason }] } : null }
    parity({ checkId: 'd2b_incumbent:I0', kind: 'd2b_incumbent', state: i0State, subjects: ['I0', `D2:${v.d2?.i0.evaluationId ?? 'CMP-t09-c1'}`], expected: v.d2?.i0 ?? null,
      observed: { status: i0.status, inputDigest: i0.e.replayedInputDigest, resultDigest: i0.e.resultDigest }, mismatches,
      notChecked: i0State === 'not_checked' ? { dependsOn: [{ id: 'I0', status: i0.status, unmeasuredReason: i0.e.unmeasuredReason as string | null, notExecutedReason: i0.e.notExecutedReason as string | null }] } : null,
      category: 'd2b_parity' })
  }
  const i0Measured = i0.status === 'evaluated' && i0.facts !== null

  // ADM (§5)
  const admitted = new Map<string, number[]>()
  const admissionUnmeasured = new Map<string, string[]>()
  const k1Ref = (label: string, p: D2CPoolCandidate): ReplacementRef => {
    const t = targetOfLabel(label)
    return { label, targetIndex: t.targetIndex, targetWeaponId: t.targetWeaponId, currentBuildListEntryId: t.currentBuildListEntryId, generatedBuildListEntryId: p.generatedBuildListEntryId,
      sha256: p.generatedEntry?.sha256 ?? null, requiresSupport: [p.supportBuildListEntryId], contextId: p.contextId, poolOrdinal: p.ordinal, fromD2B: false }
  }
  for (const t of v.scopeTargets) {
    const ok: number[] = [], bad: string[] = []
    for (const p of pools.get(t.label) ?? []) {
      const r = evaluateRow({ evaluationId: d2cAdmissionId(t.label, p.ordinal), stage: 'ADM', label: t.label, poolOrdinal: p.ordinal, contextId: p.contextId, replacements: [k1Ref(t.label, p)], reference: null })
      if (p.reusedExisting && r.status !== 'not_run_reused_existing') add('raw_result_mismatch', `${r.e.evaluationId}: a reused Entry was evaluated`)
      if (!p.reusedExisting && r.status === 'not_run_reused_existing') add('raw_result_mismatch', `${r.e.evaluationId}: not_run_reused_existing for a new Entry`)
      if (!isMeasuredEval(r.status)) bad.push(String(r.e.evaluationId))
      if ((r.e.r1r4 as Json | null)?.R1 === true) ok.push(p.ordinal)
    }
    admitted.set(t.label, ok)
    admissionUnmeasured.set(t.label, bad)
  }

  // CMP (§6.2)
  const compositionSteps: Json[] = []
  let accepted = [...i0Refs]
  let reference: { evaluationId: string; facts: D2EvaluationFacts } | null = i0Measured ? { evaluationId: 'I0', facts: i0.facts! } : null
  let afterUnmeasured = false
  let lastAccepted: Json | null = null
  for (const t of v.scopeTargets) {
    const before = accepted.map(a => a.label)
    const stop = v.contexts.filter(c => c.label === t.label).map(c => ready(c.k) ? scheduler.stop(c.k) : 'not_executed')
    const depUnmeasured = stop.some(s => s === 'unmeasured' || s === 'not_executed' || s === null) || (admissionUnmeasured.get(t.label) ?? []).length > 0
    const step: Json = { label: t.label, acceptedBefore: before, evaluatedCandidates: [], eligible: [], r5OnlyEligible: [], chosen: null, stepOutcome: null, stepNotEvaluatedReason: null, acceptedAfter: before, afterUnmeasuredStep: afterUnmeasured }
    if (depUnmeasured) {
      step.stepOutcome = 'step_unmeasured'; step.stepNotEvaluatedReason = 'dependency_unmeasured'; afterUnmeasured = true
      compositionSteps.push(step)
      continue
    }
    const cands = (admitted.get(t.label) ?? []).map(o => (pools.get(t.label) ?? []).find(p => p.ordinal === o)!)
    const results: { evaluationId: string; ordinal: number; contextId: string; status: D2EvaluationStatus; r5Satisfied: boolean | null; completed: number | null; conflicts: number | null; steps: number | null; facts: D2EvaluationFacts | null }[] = []
    for (const c of cands) {
      const proposed = [...accepted, k1Ref(t.label, c)].sort((a, b) => a.targetIndex - b.targetIndex)
      const id = d2cCompositionId(t.label, c.ordinal)
      const r = evaluateRow({ evaluationId: id, stage: 'CMP', label: t.label, poolOrdinal: c.ordinal, contextId: c.contextId, replacements: proposed, reference })
      if (!i0Measured && (r.status !== 'not_executed' || r.e.notExecutedReason !== 'i0_unmeasured')) add('raw_result_mismatch', `${id}: a CMP after an unmeasured I0 must be not_executed (i0_unmeasured)`)
      r.e.composition = { acceptedBefore: before, candidate: { label: t.label, ordinal: c.ordinal, contextId: c.contextId }, proposed: proposed.map(p => p.label), afterUnmeasuredStep: afterUnmeasured }
      results.push({ evaluationId: id, ordinal: c.ordinal, contextId: c.contextId, status: (r.status ?? 'process_failure') as D2EvaluationStatus, r5Satisfied: r.r5Satisfied,
        completed: r.facts?.plan.termination?.completedTargetCount ?? null, conflicts: r.facts ? r.facts.conflicts.length : null, steps: r.facts?.plan.steps ?? null, facts: r.facts })
    }
    const outcome = d2CompositionStep(results, reference?.facts.plan.termination?.completedTargetCount ?? null)
    Object.assign(step, { evaluatedCandidates: results.map(r => ({ evaluationId: r.evaluationId, ordinal: r.ordinal, contextId: r.contextId })), eligible: outcome.eligible, r5OnlyEligible: outcome.r5OnlyEligible,
      chosen: outcome.chosen, stepOutcome: outcome.stepOutcome })
    if (outcome.stepOutcome === 'step_unmeasured') afterUnmeasured = true
    if (outcome.stepOutcome === 'accepted') {
      const chosen = results.find(r => r.evaluationId === outcome.chosen)!
      const c = cands.find(x => x.ordinal === chosen.ordinal)!
      accepted = [...accepted, k1Ref(t.label, c)].sort((a, b) => a.targetIndex - b.targetIndex)
      reference = { evaluationId: chosen.evaluationId, facts: chosen.facts! }
      lastAccepted = evalById.get(chosen.evaluationId)!
    }
    step.acceptedAfter = accepted.map(a => a.label)
    compositionSteps.push(step)
  }
  for (const extra of rows) add('guardrail', `evaluation row ${extra.evaluationId} is beyond the registered evaluations`)
  if (input.compositionRows !== null) {
    if (input.compositionRows.length !== compositionSteps.length) add('raw_result_mismatch', `${input.compositionRows.length} recorded composition steps, the replay ${compositionSteps.length}`)
    input.compositionRows.forEach((r, i) => {
      const s = compositionSteps[i]
      if (!s || r.label !== s.label || !same(r.acceptedBefore, s.acceptedBefore) || !same(r.evaluatedCandidates, s.evaluatedCandidates) || !same(r.eligible, s.eligible) || r.chosen !== s.chosen
        || r.stepOutcome !== s.stepOutcome || !same(r.acceptedAfter, s.acceptedAfter) || r.afterUnmeasuredStep !== s.afterUnmeasuredStep || (r.stepNotEvaluatedReason ?? null) !== (s.stepNotEvaluatedReason ?? null)) {
        add('raw_result_mismatch', `step ${r.label}: the recorded step is not the replayed one`)
      }
    })
  }

  // ---- budgets and the process count
  const count = (stage: D2CStage) => evaluations.filter(e => e.stage === stage).length
  if (count('ADM') > D2C_BUDGETS.admissionEvaluationsMax || count('CMP') > D2C_BUDGETS.compositionEvaluationsMax || count('B0') !== 1 || count('I0') !== 1
    || evaluations.length > D2C_BUDGETS.evaluationRequestsMax) add('guardrail', 'an evaluation count is not within its registered budget')
  const startedContexts = contexts.filter(c => c.process !== null).length
  const startedUnits = units.filter(u => u.process !== null).length
  const startedEvals = evaluations.filter(e => e.process !== null).length
  if (startedContexts + startedUnits + startedEvals > D2C_BUDGETS.childProcessesMax) add('guardrail', 'more child processes than the registered 58')
  if (input.childProcessCount !== null && input.childProcessCount !== startedContexts + startedUnits + startedEvals) add('guardrail', `${input.childProcessCount} child processes, not the ${startedContexts + startedUnits + startedEvals} started items`)
  const allRows = [...contexts, ...units, ...evaluations]
  if (allRows.some(x => x.notExecutedReason === 'run_envelope_reached') && !input.runEnvelopeReached) add('raw_result_mismatch', 'run_envelope_reached rows without a reached run envelope')
  if (allRows.some(x => x.notExecutedReason === 'discovery_envelope_reached') && !input.discoveryEnvelopeReached) add('raw_result_mismatch', 'discovery_envelope_reached rows without a reached discovery envelope')
  if (evaluations.some(x => x.notExecutedReason === 'discovery_envelope_reached')) add('raw_result_mismatch', 'an evaluation stopped by the discovery envelope')
  const abortedRows = allRows.filter(x => x.notExecutedReason === 'aborted_after_invalid')

  // ---- determinism (§9: within D2-C, and against D2-B)
  const groups = new Map<string, Json[]>()
  for (const e of evaluations) if (typeof e.replayedInputDigest === 'string') groups.set(e.replayedInputDigest, [...(groups.get(e.replayedInputDigest) ?? []), e])
  const determinismCrossChecks: Json[] = []
  const dependsOf = (list: Json[]) => list.map(e => ({ id: String(e.evaluationId), status: e.status as string | null, unmeasuredReason: e.unmeasuredReason as string | null, notExecutedReason: e.notExecutedReason as string | null }))
  for (const [digest, list] of groups) {
    const comparable = list.filter(e => COMPARABLE_EVALUATION.includes(String(e.status)))
    const others = list.filter(e => !comparable.includes(e) && e.status !== 'not_run_reused_existing')
    if (list.length >= 2) {
      let state: D2CParityState
      if (comparable.length >= 2) state = new Set(comparable.map(e => `${e.status}|${e.resultDigest}`)).size === 1 ? 'matched' : 'mismatched'
      else state = others.length > 0 ? 'not_checked' : 'not_applicable'
      const ids = list.map(e => String(e.evaluationId))
      determinismCrossChecks.push({ inputDigest: digest, evaluationIds: ids, d2EvaluationIds: [], comparableEvaluationIds: comparable.map(e => String(e.evaluationId)), state,
        resultDigestsEqual: comparable.length >= 2 ? new Set(comparable.map(e => e.resultDigest)).size === 1 : null })
      parity({ checkId: `determinism_d2c:${digest}`, kind: 'determinism_d2c', state, subjects: ids, expected: null, observed: comparable.map(e => ({ id: e.evaluationId, status: e.status, resultDigest: e.resultDigest })),
        mismatches: state === 'mismatched' ? ['the comparable evaluations differ in status / resultDigest'] : [], notChecked: state === 'not_checked' ? { dependsOn: dependsOf(others) } : null, category: 'determinism' })
    }
    const d2 = v.d2?.byInputDigest[digest] ?? []
    if (d2.length > 0) {
      for (const e of list) {
        if (e.status === 'not_run_reused_existing') continue
        const isComparable = comparable.includes(e)
        const mismatches = isComparable ? d2.filter(x => x.status !== e.status || x.resultDigest !== e.resultDigest).map(x => `${x.evaluationId}: ${x.status} / ${x.resultDigest} vs ${e.status} / ${e.resultDigest}`) : []
        const state: D2CParityState = !isComparable ? 'not_checked' : mismatches.length === 0 ? 'matched' : 'mismatched'
        if (e.d2bParity === null) e.d2bParity = { state, matchedD2EvaluationIds: state === 'matched' ? d2.map(x => x.evaluationId) : [], resultDigestsEqual: isComparable ? mismatches.length === 0 : null,
          notChecked: state === 'not_checked' ? { dependsOn: dependsOf([e]) } : null }
        determinismCrossChecks.push({ inputDigest: digest, evaluationIds: [String(e.evaluationId)], d2EvaluationIds: d2.map(x => x.evaluationId), comparableEvaluationIds: isComparable ? [String(e.evaluationId)] : [],
          state, resultDigestsEqual: isComparable ? mismatches.length === 0 : null })
        parity({ checkId: `determinism_d2b:${e.evaluationId}`, kind: 'determinism_d2b', state, subjects: [String(e.evaluationId), ...d2.map(x => `D2:${x.evaluationId}`)],
          expected: d2, observed: { status: e.status, resultDigest: e.resultDigest }, mismatches, notChecked: state === 'not_checked' ? { dependsOn: dependsOf([e]) } : null, category: 'd2b_parity' })
      }
    }
  }
  for (const e of evaluations) if (e.d2bParity === null) e.d2bParity = { state: 'not_applicable', matchedD2EvaluationIds: [], resultDigestsEqual: null, notChecked: null }
  if (abortedRows.length > 0 && invalid.length === 0) add('raw_result_mismatch', `${abortedRows.length} row(s) aborted_after_invalid without an INVALID reason`)
  if (input.abortReason !== null && invalid.length === 0) add('raw_result_mismatch', `the runner aborted (${input.abortReason}) without an INVALID reason`)
  for (const check of parityChecks.filter(c => c.state === 'not_checked')) {
    const deps = isObject(check.notChecked) && Array.isArray(check.notChecked.dependsOn) ? check.notChecked.dependsOn as Json[] : []
    if (deps.length === 0 || deps.some(d => d.status === 'evaluated' || d.status === 'context_ready' || D2C_DISCOVERY_MEASURED.includes(d.status as D2CDiscoveryUnitStatus))) add('evidence_integrity', `${check.checkId}: not_checked without an unmeasured dependency`)
  }

  // ---- final, comparison, aggregates and the decision
  const metricsOf = (e: Json | null): D2CMetrics | null => {
    if (e === null) return null
    const plan = e.plan as Json | null
    const t = plan && isObject(plan.termination) ? plan.termination : null
    return t ? { completed: Number(t.completedTargetCount), conflicts: (e.conflicts as unknown[]).length, steps: plan!.steps as number | null } : null
  }
  const i0Json = i0Measured ? evalById.get('I0')! : null
  const finalEval = lastAccepted ?? i0Json
  const finalMetrics = metricsOf(finalEval)
  const finalR6 = finalEval !== null && (finalEval.r6 as D2R6Judgement).satisfied === true
  const k1Accepted = accepted.filter(a => !a.fromD2B).map(a => ({ label: a.label, contextId: a.contextId!, ordinal: a.poolOrdinal!, generatedBuildListEntryId: a.generatedBuildListEntryId }))
  const unmeasured = [
    ...contexts.filter(c => c.status !== 'context_ready' && c.status !== 'guardrail_violation').map(c => d2cContextUnitId(Number(c.k))),
    ...units.filter(u => u.status === null || !D2C_DISCOVERY_MEASURED.includes(u.status as D2CDiscoveryUnitStatus)).filter(u => u.status !== 'guardrail_violation').map(u => String(u.unitId)),
    ...evaluations.filter(e => !isMeasuredEval(e.status)).filter(e => e.status !== 'guardrail_violation').map(e => String(e.evaluationId))]
  const boundLimitedEvaluations = evaluations.filter(e => e.boundLimited === true).map(e => String(e.evaluationId))
  const contextsUnmeasured = contexts.filter(c => c.discoveryStop === 'unmeasured' || c.discoveryStop === 'not_executed').map(c => String(c.contextId))
  const contextsWithoutCandidateMeasured = contexts.filter(c => (c.discoveryStop === 'ladder_exhausted' || c.discoveryStop === 'discovery_exhausted') && (contextPools.get(Number(c.k)) ?? []).length === 0).map(c => String(c.contextId))
  const decision = classifyD2CDecision({ invalidReasons: invalid, unmeasured, k1Accepted, finalMetrics, finalR6, i0Metrics: metricsOf(i0Json), boundLimitedEvaluations, contextsWithoutCandidateMeasured, contextsUnmeasured })

  const discoveryTargets = v.scopeTargets.map(t => ({ label: t.label, targetWeaponId: t.targetWeaponId, currentBuildListEntryId: t.currentBuildListEntryId, contextIds: [...t.contextIds],
    oTSelectedInB0: b0Selected === null ? null : b0Selected.has(t.currentBuildListEntryId),
    pool: (pools.get(t.label) ?? []).map(p => ({ ordinal: p.ordinal, contextId: p.contextId, unitId: p.unitId, rung: p.rung, indexInContext: p.indexInContext, indexInUnit: p.indexInUnit,
      candidateStableKey: p.candidateStableKey, keySha256: p.keySha256, cost: p.cost, routeKind: p.routeKind, routeOperationCount: p.routeOperationCount, r0: p.r0, searchIdentity: p.searchIdentity,
      reservationDigest: p.reservationDigest, contextRecordSha256: p.contextRecordSha256, requiresSupport: [p.supportBuildListEntryId], generatedBuildListEntryId: p.generatedBuildListEntryId,
      reusedExisting: p.reusedExisting, generatedEntry: p.generatedEntry, replacement: p.replacement, crossContextSameKey: p.crossContextSameKey })) }))
  const stepOf = (label: string) => compositionSteps.find(s => s.label === label) ?? null
  const comparisonTargets = v.scopeTargets.map(t => {
    const step = stepOf(t.label)
    const chosen = step && typeof step.chosen === 'string' ? evalById.get(step.chosen) ?? null : null
    const winners = new Set<string>()
    const notSelected: string[] = [], expired: string[] = []
    for (const e of evaluations.filter(x => (x.stage === 'ADM' || x.stage === 'CMP') && x.targetLabel === t.label)) {
      for (const c of e.candidates as Json[]) if (c.label === t.label && c.selected === false && typeof c.winnerBuildListEntryId === 'string') winners.add(c.winnerBuildListEntryId)
      for (const s of Object.values(e.supportChecksByEntry as Json)) {
        if (!isObject(s)) continue
        if (s.supportExpiryCause === 'support_not_selected') notSelected.push(String(e.evaluationId))
        else if (s.supportExpiryCause !== null && s.supportExpiryCause !== undefined) expired.push(String(e.evaluationId))
      }
    }
    const refDiff = chosen && isObject(chosen.referenceDiff) ? chosen.referenceDiff : null
    return { label: t.label,
      contexts: v.contexts.filter(c => c.label === t.label).map(c => ({ contextId: c.contextId, discoveryStop: contexts.find(x => x.contextId === c.contextId)?.discoveryStop ?? null,
        poolSize: (contextPools.get(c.k) ?? []).length, admittedCount: (admitted.get(t.label) ?? []).filter(o => (pools.get(t.label) ?? []).find(p => p.ordinal === o)?.contextId === c.contextId).length })),
      mainOutcome: step?.stepOutcome ?? null, acceptedOrdinal: chosen ? chosen.poolOrdinal : null, acceptedContextId: chosen ? chosen.contextId : null,
      targetsGainedWhenAccepted: (refDiff?.targetsGained as string[] | undefined) ?? [], targetsLostWhenAccepted: (refDiff?.targetsLost as string[] | undefined) ?? [],
      winnersObserved: [...winners].sort(compare), supportNotSelectedEvaluations: notSelected, supportExpiredEvaluations: expired }
  })
  const countBy = <T,>(list: readonly T[], key: (x: T) => string | null) => list.reduce<Record<string, number>>((acc, x) => { const k = key(x); if (k !== null) acc[k] = (acc[k] ?? 0) + 1; return acc }, {})
  const judgedR5 = evaluations.filter(e => (e.r5 as Json).judged === true)
  const r6Judged = evaluations.filter(e => (e.r6 as Json).judged === true)
  const r6Satisfied = r6Judged.filter(e => (e.r6 as Json).satisfied === true)
  const supportCauses = evaluations.flatMap(e => Object.values(e.supportChecksByEntry as Json)).filter(isObject).map(s => s.supportExpiryCause).filter((x): x is string => typeof x === 'string')
  const aggregates = {
    contexts: { registered: v.contexts.length, executed: startedContexts, byStatus: countBy(contexts, c => String(c.status)) },
    discovery: { registeredUnitsMax: D2C_BUDGETS.discoveryUnitsMax, executed: startedUnits, byStatus: countBy(units, u => String(u.status)), pooledCandidates: pooledAll.length,
      byAction: countBy(units.flatMap(u => u.deliveries as Json[]), d => String(d.action)),
      searchOnlyMs: units.reduce((s, u) => s + (typeof u.searchOnlyMs === 'number' ? u.searchOnlyMs : 0), 0), wallMs: units.reduce((s, u) => s + (typeof u.wallMs === 'number' ? u.wallMs : 0), 0) },
    evaluations: { registeredMax: D2C_BUDGETS.evaluationRequestsMax, executed: startedEvals, registered: evaluations.length, measured: evaluations.filter(e => isMeasuredEval(e.status)).length,
      unmeasuredByReason: countBy(evaluations.filter(e => !isMeasuredEval(e.status) && e.status !== 'not_executed'), e => String(e.status)),
      notExecutedByReason: countBy(evaluations.filter(e => e.status === 'not_executed'), e => String(e.notExecutedReason)), byStage: countBy(evaluations, e => String(e.stage)), byStatus: countBy(evaluations, e => String(e.status)) },
    childProcesses: { registeredMax: D2C_BUDGETS.childProcessesMax, started: startedContexts + startedUnits + startedEvals },
    fullPlannerRunsStarted: evaluations.reduce((s, e) => s + (typeof e.fullRunsStarted === 'number' ? e.fullRunsStarted : 0), 0),
    runtimeUnsupportedRetries: evaluations.reduce((s, e) => s + (e.runtimeUnsupportedRemoved as unknown[]).length, 0),
    r5: { judged: judgedR5.length, satisfied: judgedR5.filter(e => (e.r5 as Json).satisfied === true).length },
    r6: { judged: r6Judged.length, satisfied: r6Satisfied.length, satisfiedEvaluationIds: r6Satisfied.map(e => String(e.evaluationId)) },
    boundLimitedEvaluations,
    supportOutcomes: { notSelected: supportCauses.filter(c => c === 'support_not_selected').length, expiredByCause: countBy(supportCauses.filter(c => c !== 'support_not_selected'), c => c) },
    determinismCrossChecks,
    parity: { byKindAndState: countBy(parityChecks, c => `${c.kind}:${c.state}`), mismatched: parityChecks.filter(c => c.state === 'mismatched').map(c => c.checkId),
      notChecked: parityChecks.filter(c => c.state === 'not_checked').map(c => ({ checkId: c.checkId, dependsOn: isObject(c.notChecked) ? c.notChecked.dependsOn : [] })) },
  }
  const composition = {
    main: { i0EvaluationId: 'I0', initialAccepted: i0Refs.map(a => ({ label: a.label, ordinal: a.poolOrdinal, generatedBuildListEntryId: a.generatedBuildListEntryId })), steps: compositionSteps,
      finalAccepted: accepted.map(a => ({ label: a.label, ordinal: a.poolOrdinal, contextId: a.contextId, generatedBuildListEntryId: a.generatedBuildListEntryId, requiresSupport: [...a.requiresSupport], fromD2B: a.fromD2B })),
      finalResultEvaluationId: finalEval === null ? null : String(finalEval.evaluationId), finalMetrics },
  }
  const comparison = { vsBaseline: decision.vsBaseline, vsD1Incumbent: decision.vsD1Incumbent, vsD2bMain: decision.vsD2bMain, targets: comparisonTargets }
  return { contexts, discovery: { units, targets: discoveryTargets }, evaluations, parityChecks, composition, comparison, aggregates, invalidReasons: invalid, decision, unmeasured }
}

/** §7.1: C1 / C3 / C4 recomputed from the Export and the recomputed origin digest; C2 from the record. Returns the analyzer's checks. */
function recomputeContextChecks(c: D2CContext, record: D2CContextRecord, input: D2CAnalysisInput, exportById: ReadonlyMap<string, Json[]>, sha: (t: string) => string,
  add: (category: D2CInvalidCategory, detail: string) => void): Json {
  const v = input.validated
  const bodies = exportById.get(c.supportBuildListEntryId) ?? []
  const supportBody = bodies.length === 1 ? bodies[0]! : null
  const supportTarget = supportBody !== null && typeof supportBody.targetWeaponId === 'string' ? supportBody.targetWeaponId : null
  const c1 = supportBody !== null && supportTarget !== null && !v.e1TargetWeaponIds.includes(supportTarget) && !c.supportBuildListEntryId.startsWith(D2C_GENERATED_ENTRY_PREFIX)
    && !v.e1CurrentBuildListEntryIds.includes(c.supportBuildListEntryId)
  const reservation = isObject(record.reservationBody) ? record.reservationBody : null
  const exclusive = reservation !== null && Array.isArray(reservation.exclusiveOwnedWeaponIds) ? (reservation.exclusiveOwnedWeaponIds as unknown[]).map(String) : []
  const referenced = supportBody !== null && isObject(supportBody.candidateSnapshot) && isObject(supportBody.candidateSnapshot.route)
    ? collectReferencedOwnedWeaponIds((supportBody as unknown as BuildListEntry).candidateSnapshot.route).map(String).sort(compare) : null
  const c3 = referenced !== null && same(referenced, record.checks.C3.referencedOwnedWeaponIds) && [...referenced, ...record.checks.C3.exclusiveConsumedOwnedWeaponIds].every(id => exclusive.includes(id))
    && same([...exclusive].sort(compare), record.checks.C3.exclusiveOwnedWeaponIds)
  const oT = (exportById.get(c.currentBuildListEntryId) ?? [])[0]
  const oTKey = oT !== undefined && isObject(oT.candidateSnapshot) ? candidateStableKey(oT.candidateSnapshot as unknown as BuildListEntry['candidateSnapshot']) : null
  const c4 = record.originDigest !== null && record.originDigest === record.scheduleOriginDigest && (input.recomputedOriginDigest === null || record.originDigest === input.recomputedOriginDigest)
    && oTKey !== null && same(record.excludedRouteKeys, [oTKey]) && same(record.scheduleExcludedRouteKeys, [oTKey]) && same(record.excludedRouteKeySha256s, [sha(oTKey)])
  const c2 = record.checks.C2.satisfied === true && record.reservationBody !== null && typeof record.reservationDigest === 'string'
  if (reservation === null || hashStableValue(reservation) !== record.reservationDigest) add('evidence_integrity', 'the CTX reservationBody does not hash to its reservationDigest')
  const supportSha = supportBody === null ? null : sha(stableStringify(supportBody))
  if (supportSha !== record.supportBodySha256) add('guardrail', 'the CTX supportBodySha256 is not SHA-256(stableStringify(Export support body))')
  if (record.supportTargetWeaponId !== supportTarget) add('raw_result_mismatch', 'the CTX support Target is not the Export one')
  if (!c1) add('guardrail', 'C1 does not hold (recomputed from the Export)')
  if (!c2) add('guardrail', 'C2 does not hold')
  if (!c3) add('guardrail', 'C3 does not hold (recomputed from the Export support Route)')
  if (!c4) add('guardrail', 'C4 does not hold (origin digest / excluded current Route key recomputed)')
  if (record.checks.C1.satisfied !== c1 || record.checks.C3.satisfied !== c3 || record.checks.C4.satisfied !== c4) add('raw_result_mismatch', 'the recorded C1 / C3 / C4 are not the recomputed ones')
  return { C1: c1, C2: c2, C3: { satisfied: c3, referencedOwnedWeaponIds: referenced ?? [], exclusiveConsumedOwnedWeaponIds: [...record.checks.C3.exclusiveConsumedOwnedWeaponIds], exclusiveOwnedWeaponIds: exclusive }, C4: c4 }
}
