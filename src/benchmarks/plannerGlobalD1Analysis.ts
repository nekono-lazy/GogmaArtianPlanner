/**
 * Issue #154 D1-B post-hoc analysis. Research only. Never import from Production.
 *
 * Re-derives every judgement of a D1 run from the run dir records (never from the runner's own judgement): each R unit's status
 * and its G store body, each evaluation's status, `inputDigest` / `resultDigest`, R5 (an implementation independent from the
 * runner's `judgeD1R5()`, cross-checked against it), the B0 / S parity, the baseline diff, `target_regressed_R`, the A(c)
 * composition replay, the determinism cross-check, and the §7 decision. It reads no oracle, Phase B analysis or population-authority
 * module (a test walks the import closure); the Phase B RESULT is read through the D1 allowlist only.
 */
import { stableStringify } from '../domain/models/hashing'
import type { BuildListEntry } from '../domain/models/publicTypes'
import { candidateStableKey } from '../domain/search'
import {
  d1B0Parity,
  d1CompositionOutcome,
  d1InputDigest,
  d1R1R4,
  d1RegisteredEvaluations,
  d1ResultDigest,
  d1SParity,
  isD1BoundLimited,
  judgeD1R5,
  D1_CALCULATION_CONTEXT,
  D1_MEASURED_STATUSES,
  D1_REDELIVERY_MATCH_KEYS,
  D1_RESEARCH_MAX_PLAN_STEPS,
  D1_RNG_ENGINE_VERSION,
  D1_TARGETS,
  type D1EvaluatedAgainst,
  type D1EvaluationFacts,
  type D1EvaluationStatus,
  type D1FoundTarget,
  type D1R5Judgement,
  type D1Stage,
} from './plannerGlobalD1'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0

export type D1InvalidCategory = 'input_evidence' | 'provenance' | 'redelivery_mismatch' | 'baseline_parity_mismatch' | 'phase_b_parity_mismatch' | 'guardrail' | 'determinism' | 'raw_result_mismatch'
export interface D1InvalidReason { category: D1InvalidCategory; detail: string }
export type D1DecisionCase = 'D1_INVALID' | 'D1_INCOMPLETE' | 'D1_FOUND_R_SET_COEXISTS' | 'D1_FOUND_R_SET_PARTIAL' | 'D1_FOUND_R_SET_COEXISTENCE_NOT_OBSERVED'
export type D1RowStatus = D1EvaluationStatus | 'guardrail_violation'
const UNMEASURED_PROCESS = ['timeout', 'out_of_memory', 'process_failure', 'interrupted'] as const

// ---------------------------------------------------------------- R5, independently of the runner (§4.4)

export interface D1IndependentR5Input {
  status: D1RowStatus
  evaluatedAgainst: D1EvaluatedAgainst
  generatedBuildListEntryIds: readonly string[]
  requiresSupport: readonly string[]
  facts: Pick<D1EvaluationFacts, 'plan' | 'conflicts' | 'supportChecks'> | null
}

/** §4.4 R5 written again from the definition (not `judgeD1R5()`), so the analyzer can cross-check the runner. */
export function judgeD1R5Independently(input: D1IndependentR5Input): D1R5Judgement {
  const supportVacuous = input.requiresSupport.length === 0
  const empty = { allGeneratedSelected: null, allSupportSelected: null, supportDependenciesValid: null, noConflictWithinSet: null, planAndTraceReplayOk: null }
  const measured = input.status === 'evaluated' || input.status === 'preflight_refused' || input.status === 'planner_rerun_bound_reached'
  if (input.evaluatedAgainst !== 'replacement_set' || !measured || input.facts === null) return { judged: false, conditions: empty, satisfied: null, failureReasons: [], supportVacuous }
  const facts = input.facts
  if (input.status !== 'evaluated') return { judged: true, conditions: { ...empty, planAndTraceReplayOk: false }, satisfied: false, failureReasons: [input.status], supportVacuous }
  if (facts.plan.present !== true) return { judged: true, conditions: { ...empty, planAndTraceReplayOk: false }, satisfied: false, failureReasons: ['no_plan'], supportVacuous }
  const reasons: string[] = []
  const selected = facts.plan.selectedBuildListEntryIds
  const missingGenerated = input.generatedBuildListEntryIds.filter(id => selected.indexOf(id) < 0).sort(compare)
  if (missingGenerated.length > 0) reasons.push(`generated_not_selected:${missingGenerated.join(',')}`)
  const supportMissing = input.requiresSupport.some(id => selected.indexOf(id) < 0)
  if (supportMissing) reasons.push('support_not_selected')
  let expired = false
  for (const id of input.requiresSupport) {
    const c = facts.supportChecks[id]
    if (!c || c.S1 !== true || c.S2 !== true || c.S3 !== true) expired = true
  }
  if (expired) reasons.push('support_expired_R')
  const members = [...input.generatedBuildListEntryIds, ...input.requiresSupport]
  let withinSet = false
  for (const conflict of facts.conflicts) {
    let hits = 0
    for (const participant of conflict.participants) if (members.includes(participant)) hits += 1
    if (hits >= 2) withinSet = true
  }
  if (withinSet) reasons.push('conflict_within_set')
  const status = facts.plan.termination?.status
  const planOk = status === 'completed' || status === 'exhausted'
  if (!planOk) reasons.push('plan_bound_truncated')
  const conditions = { allGeneratedSelected: missingGenerated.length === 0, allSupportSelected: !supportMissing, supportDependenciesValid: !expired, noConflictWithinSet: !withinSet, planAndTraceReplayOk: planOk }
  return { judged: true, conditions, satisfied: Object.values(conditions).every(v => v === true), failureReasons: reasons, supportVacuous }
}

// ---------------------------------------------------------------- the decision (§7)

export interface D1DecisionInput {
  invalidReasons: readonly D1InvalidReason[]
  /** R units and evaluations that are unmeasured or not executed (any reason). */
  unmeasuredOrNotExecuted: number
  aASatisfied: boolean | null
  /** R5-satisfied evaluations of a replacement set of size >= 2 (P / A-b / A-c; A-a included). */
  satisfiedSetsOfSizeAtLeast2: readonly { evaluationId: string; stage: D1Stage; size: number }[]
  boundLimitedEvaluations: readonly string[]
}

export function classifyD1Decision(input: D1DecisionInput): { case: D1DecisionCase; reasons: string[]; lowerBound: boolean; boundLimitedEvaluations: string[]; coexistsObservedUnderIncomplete: boolean } {
  const bound = [...input.boundLimitedEvaluations]
  if (input.invalidReasons.length > 0) {
    return { case: 'D1_INVALID', reasons: input.invalidReasons.map(r => `${r.category}: ${r.detail}`), lowerBound: false, boundLimitedEvaluations: bound, coexistsObservedUnderIncomplete: false }
  }
  const partialSets = input.satisfiedSetsOfSizeAtLeast2.filter(s => s.stage !== 'A-a')
  if (input.unmeasuredOrNotExecuted > 0) {
    return { case: 'D1_INCOMPLETE', reasons: [`${input.unmeasuredOrNotExecuted} registered R unit(s) / evaluation(s) unmeasured or not executed; the measured evidence is a lower bound`,
      `observed R5-satisfied sets of size >= 2: ${input.satisfiedSetsOfSizeAtLeast2.map(s => s.evaluationId).join(', ') || 'none'}`],
    lowerBound: true, boundLimitedEvaluations: bound, coexistsObservedUnderIncomplete: input.aASatisfied === true }
  }
  if (input.aASatisfied === true) return { case: 'D1_FOUND_R_SET_COEXISTS', reasons: ['A-a satisfies R5'], lowerBound: false, boundLimitedEvaluations: bound, coexistsObservedUnderIncomplete: false }
  if (partialSets.length > 0) {
    return { case: 'D1_FOUND_R_SET_PARTIAL', reasons: ['A-a does not satisfy R5', `R5-satisfied sets of size >= 2: ${partialSets.map(s => `${s.evaluationId} (${s.size})`).join(', ')}`],
      lowerBound: false, boundLimitedEvaluations: bound, coexistsObservedUnderIncomplete: false }
  }
  return { case: 'D1_FOUND_R_SET_COEXISTENCE_NOT_OBSERVED', reasons: ['no registered replacement set of size >= 2 satisfied R5 (not a proof of non-coexistence)',
    ...(bound.length > 0 ? [`bound-limited evaluations: ${bound.join(', ')}`] : [])], lowerBound: false, boundLimitedEvaluations: bound, coexistsObservedUnderIncomplete: false }
}

// ---------------------------------------------------------------- the run analysis

export interface D1RedeliveryRow {
  unitId: string
  targetIndex: number
  targetWeaponId: string
  status: string | null
  process: Json | null
  recordFile: { file: string; bytes: number; sha256: string } | null
  generatedEntry: { file: string; bytes: number; sha256: string } | null
  notExecutedReason: string | null
}

export interface D1EvaluationRow {
  evaluationId: string
  stage: D1Stage
  ordinal: number
  evaluatedAgainst: D1EvaluatedAgainst
  replacementTargetIndexes: number[]
  replacementTargets: string[]
  generatedEntryIds: string[]
  generatedEntrySha256s: (string | null)[]
  requiresSupport: string[]
  inputDigest: string | null
  status: string | null
  notExecutedReason: string | null
  process: Json | null
  recordFile: { file: string; bytes: number; sha256: string } | null
  runner: { r5: D1R5Judgement; parity: unknown; boundLimited: boolean } | null
  composition: { acceptedBefore: number[]; candidate: number; proposed?: number[]; accepted?: boolean | null; acceptedAfter?: number[] } | null
  afterUnmeasuredStep: boolean
}

export interface D1AnalysisInput {
  targets: readonly D1FoundTarget[]
  inputValidation: { passed: boolean; issues: string[] }
  phase2c2BaselineSummary: unknown
  exportSha256: string
  redeliveryRows: readonly D1RedeliveryRow[]
  /** By unit ID: the R child record (null = none). */
  redeliveryRecords: ReadonlyMap<string, Json | null>
  /** By unit ID: the G store file read back (null = missing). */
  generatedEntries: ReadonlyMap<string, { bytes: number; sha256: string; body: unknown } | null>
  evaluationRows: readonly D1EvaluationRow[]
  evaluationRecords: ReadonlyMap<string, Json | null>
  /** The run ended without a raw output (interrupted). */
  interrupted: boolean
  /** Already found by the caller: provenance (attestation, HEAD, code changes) and raw / record file consistency. */
  provenanceIssues: readonly string[]
  rawConsistencyIssues: readonly string[]
  /** The child processes the raw lists (null when the run was interrupted). */
  childProcessCount: number | null
}

const measuredStatus = (status: D1RowStatus | null): boolean => status !== null && (D1_MEASURED_STATUSES as readonly string[]).includes(status)
const recordCalculationIssues = (record: Json): string[] => {
  const issues: string[] = []
  if (!same(record.calculationContext, D1_CALCULATION_CONTEXT)) issues.push('CalculationContext is not the registered one')
  if (record.rngEngineVersion !== D1_RNG_ENGINE_VERSION) issues.push('the RNG Engine version is not production-rng:c5-e7')
  if (record.researchMaxPlanSteps !== D1_RESEARCH_MAX_PLAN_STEPS) issues.push('researchMaxPlanSteps is not 20000')
  return issues
}
const memoryOf = (record: Json | null, process: Json | null) => {
  const memory = record !== null && isObject(record.memory) ? record.memory : null
  const ipc = process !== null && isObject(process.lastIpcMemory) ? process.lastIpcMemory : null
  const heap = [memory?.sampledMaxHeapUsedBytes, ipc?.maxHeapUsedBytes].filter((v): v is number => typeof v === 'number')
  const rss = [memory?.sampledMaxRssBytes, ipc?.maxRssBytes, typeof memory?.maxRssKiB === 'number' ? memory.maxRssKiB * 1024 : undefined].filter((v): v is number => typeof v === 'number')
  return { peakHeapBytes: heap.length ? Math.max(...heap) : null, peakRssBytes: rss.length ? Math.max(...rss) : null }
}

/** One row's status as recorded by the files: the process outcome, then the child record's own status. */
function statusFromFiles(process: Json | null, record: Json | null, notExecutedReason: string | null, interrupted: boolean): D1RowStatus | 'redelivered' | 'redelivery_mismatch' | null {
  if (notExecutedReason !== null) return 'not_executed'
  if (process === null) return interrupted ? 'interrupted' : null
  const outcome = process.outcome
  if (outcome !== 'completed') return (UNMEASURED_PROCESS as readonly unknown[]).includes(outcome) ? outcome as D1RowStatus : 'process_failure'
  if (record === null || !isObject(record.result)) return 'process_failure'
  return record.result.status as D1RowStatus
}

export function analyzeD1Run(input: D1AnalysisInput) {
  const invalid: D1InvalidReason[] = []
  const add = (category: D1InvalidCategory, detail: string) => invalid.push({ category, detail })
  if (!input.inputValidation.passed) for (const issue of input.inputValidation.issues) add('input_evidence', issue)
  for (const issue of input.provenanceIssues) add('provenance', issue)
  for (const issue of input.rawConsistencyIssues) add('raw_result_mismatch', issue)
  const targets = input.targets
  const byIndex = new Map(targets.map(t => [t.targetIndex, t]))

  // ---- R
  const redelivery = targets.map((target) => {
    const row = input.redeliveryRows.find(r => r.unitId === target.unitId) ?? null
    const record = input.redeliveryRecords.get(target.unitId) ?? null
    const result = record !== null && isObject(record.result) ? record.result : null
    const status = row === null ? (input.interrupted ? 'not_executed' : null) : statusFromFiles(row.process, record, row.notExecutedReason, input.interrupted)
    if (status === null) add('raw_result_mismatch', `${target.unitId}: no R row`)
    if (row !== null && row.status !== status && !(row.status === 'redelivery_mismatch' && status === 'redelivered')) add('raw_result_mismatch', `${target.unitId}: the R row status ${row.status} is not the record status ${status}`)
    const matches = isObject(result?.matches) ? result.matches as Record<string, boolean> : null
    const mismatches = Array.isArray(result?.mismatches) ? result.mismatches as string[] : Array.isArray(result?.issues) ? result.issues as string[] : result && isObject(result.error) ? [String(result.error.message)] : []
    let finalStatus = status
    const g = input.generatedEntries.get(target.unitId) ?? null
    if (status === 'redelivered') {
      const issues: string[] = []
      if (matches === null || !D1_REDELIVERY_MATCH_KEYS.every(k => matches[k] === true)) issues.push('a §3.3 match is false')
      if (record !== null) issues.push(...recordCalculationIssues(record))
      const recordG = record !== null && isObject(record.generatedEntryFile) ? record.generatedEntryFile : null
      if (g === null || row?.generatedEntry === null || row?.generatedEntry?.sha256 !== g.sha256 || recordG?.sha256 !== g.sha256) issues.push('the G store body is missing or not the one R wrote')
      const body = g !== null && isObject(g.body) ? g.body as unknown as BuildListEntry : null
      if (body === null || body.id !== target.generatedBuildListEntryId || body.targetWeaponId !== target.targetWeaponId || !isObject(body.candidateSnapshot)
        || candidateStableKey(body.candidateSnapshot) !== target.candidateStableKey) issues.push('the G store body is not the registered G (ID / Target / stable key)')
      if (issues.length > 0) { add('redelivery_mismatch', `${target.unitId}: ${issues.join('; ')}`); finalStatus = 'redelivery_mismatch' }
    } else if (status === 'redelivery_mismatch') add('redelivery_mismatch', `${target.unitId}: ${mismatches.join('; ') || 'mismatch'}`)
    const timing = result && isObject(result.timing) ? result.timing : null
    return { unitId: target.unitId, targetWeaponId: target.targetWeaponId, status: finalStatus, process: row?.process ?? null,
      searchIdentity: typeof result?.searchIdentity === 'string' ? result.searchIdentity : null, originDigest: typeof result?.originDigest === 'string' ? result.originDigest : null,
      reservationDigest: typeof result?.reservationDigest === 'string' ? result.reservationDigest : null,
      matches: matches ?? Object.fromEntries(D1_REDELIVERY_MATCH_KEYS.map(k => [k, false])), mismatches,
      generatedEntry: finalStatus === 'redelivered' && row?.generatedEntry ? { file: row.generatedEntry.file, sha256: row.generatedEntry.sha256 } : null,
      searchOnlyMs: typeof timing?.searchOnlyMs === 'number' ? timing.searchOnlyMs : null, wallMs: typeof row?.process?.wallMs === 'number' ? row.process.wallMs : null,
      ...memoryOf(record, row?.process ?? null), notExecutedReason: row?.notExecutedReason ?? null }
  })
  const gSha = new Map(redelivery.filter(r => r.status === 'redelivered' && r.generatedEntry !== null).map(r => [r.unitId, r.generatedEntry!.sha256]))

  // ---- evaluations: registry order and count
  const registry = d1RegisteredEvaluations(targets.length || D1_TARGETS)
  const rows = input.evaluationRows
  if (!input.interrupted && rows.length !== registry.length) add('guardrail', `${rows.length} evaluation rows, not the registered ${registry.length}`)
  rows.forEach((row, i) => {
    const reg = registry[i]
    if (!reg || reg.evaluationId !== row.evaluationId || reg.stage !== row.stage || reg.ordinal !== row.ordinal || reg.evaluatedAgainst !== row.evaluatedAgainst
      || (reg.targetIndexes !== null && !same(reg.targetIndexes, row.replacementTargetIndexes))) add('guardrail', `evaluation row ${i} (${row.evaluationId}) is not the registered evaluation`)
  })
  if (new Set(rows.map(r => r.evaluationId)).size !== rows.length) add('guardrail', 'an evaluation repeats')

  // ---- per evaluation facts and judgements
  const b0Row = rows.find(r => r.stage === 'B0') ?? null
  const b0Record = b0Row ? input.evaluationRecords.get(b0Row.evaluationId) ?? null : null
  const b0Status = b0Row ? statusFromFiles(b0Row.process, b0Record, b0Row.notExecutedReason, input.interrupted) : null
  const b0Facts = b0Status === 'evaluated' && b0Record && isObject(b0Record.result) ? b0Record.result as unknown as D1EvaluationFacts : null
  const b0Selected = b0Facts ? new Set(b0Facts.plan.selectedBuildListEntryIds) : null

  let accepted: number[] = []
  let unmeasuredSeen = false
  const evaluations = registry.map((reg) => {
    const row = rows.find(r => r.evaluationId === reg.evaluationId) ?? null
    const record = row ? input.evaluationRecords.get(reg.evaluationId) ?? null : null
    const status: D1RowStatus = row === null ? 'not_executed' : (statusFromFiles(row.process, record, row.notExecutedReason, input.interrupted) as D1RowStatus | null) ?? 'process_failure'
    const notExecutedReason = row === null ? (input.interrupted ? 'interrupted' : 'missing_row') : row.notExecutedReason
    if (row !== null && row.status !== status) add('raw_result_mismatch', `${reg.evaluationId}: the row status ${row.status} is not the record status ${status}`)
    const indexes = reg.stage === 'A-c' ? [...new Set([...accepted, reg.candidateIndex!])].sort((a, b) => a - b) : reg.targetIndexes!
    if (row !== null && !same(row.replacementTargetIndexes, indexes)) add('raw_result_mismatch', `${reg.evaluationId}: the replacement set ${JSON.stringify(row.replacementTargetIndexes)} is not the replayed ${JSON.stringify(indexes)}`)
    const ts = indexes.map(i => byIndex.get(i)).filter((t): t is D1FoundTarget => t !== undefined)
    const generatedIds = ts.map(t => t.generatedBuildListEntryId)
    const support = [...new Set(ts.flatMap(t => t.supportBuildListEntryIds))].sort(compare)
    const result = record !== null && isObject(record.result) ? record.result : null
    const facts = measuredStatus(status) && result !== null ? result as unknown as D1EvaluationFacts : null
    if (record !== null && status !== 'not_executed') for (const issue of recordCalculationIssues(record)) add('guardrail', `${reg.evaluationId}: ${issue}`)
    if (status === 'guardrail_violation') add('guardrail', `${reg.evaluationId}: ${JSON.stringify(result?.issues ?? [])}`)
    if (facts !== null && facts.runConflictResolutions !== 0) add('guardrail', `${reg.evaluationId}: G1 - the run received a conflict resolution`)
    // inputDigest / resultDigest
    let inputDigest: string | null = null
    if (row !== null && status !== 'not_executed') {
      const shas = ts.map(t => gSha.get(t.unitId) ?? null)
      if (shas.some(s => s === null)) add('raw_result_mismatch', `${reg.evaluationId}: ran without a redelivered G`)
      inputDigest = d1InputDigest(ts.map(t => t.targetWeaponId), generatedIds, shas.map(s => s ?? ''), input.exportSha256)
      if (row.inputDigest !== inputDigest) add('raw_result_mismatch', `${reg.evaluationId}: inputDigest differs from the recomputed one`)
      if (!same(row.generatedEntrySha256s, shas)) add('raw_result_mismatch', `${reg.evaluationId}: the row G store SHA-256s are not R's`)
    }
    const resultDigest = facts !== null ? d1ResultDigest(facts) : null
    if (facts !== null && facts.resultDigest !== resultDigest) add('raw_result_mismatch', `${reg.evaluationId}: resultDigest differs from the recomputed one`)
    // R5 (independent) and the runner cross-check
    const r5 = judgeD1R5Independently({ status, evaluatedAgainst: reg.evaluatedAgainst, generatedBuildListEntryIds: generatedIds, requiresSupport: support, facts })
    if (row?.runner && !same(row.runner.r5, r5)) add('raw_result_mismatch', `${reg.evaluationId}: the runner R5 differs from the analyzer R5`)
    if (facts !== null && !same(judgeD1R5({ status: status as D1EvaluationStatus, evaluatedAgainst: reg.evaluatedAgainst, generatedBuildListEntryIds: generatedIds, requiresSupport: support, facts }), r5)) {
      add('raw_result_mismatch', `${reg.evaluationId}: the two R5 implementations disagree`)
    }
    // parity (B0 / S)
    let parity: { compared: string[]; matched: boolean; mismatches: string[] } | null = null
    if (reg.stage === 'B0' && status !== 'not_executed' && !UNMEASURED_PROCESS.includes(status as never)) {
      parity = d1B0Parity(facts?.baselineSummary ?? null, input.phase2c2BaselineSummary)
      if (!parity.matched || status !== 'evaluated') add('baseline_parity_mismatch', `B0 ${status}: ${parity.mismatches.join(', ')}`)
    }
    if (reg.stage === 'S' && status !== 'not_executed' && !UNMEASURED_PROCESS.includes(status as never)) {
      parity = d1SParity(facts, ts[0]!.trial)
      if (!parity.matched || status === 'calculation_error' || status === 'guardrail_violation') add('phase_b_parity_mismatch', `${reg.evaluationId} ${status}: ${parity.mismatches.join(', ')}`)
    }
    // candidates
    const commitments = facts?.routeCommitment ?? []
    const selected = new Set(facts?.plan.selectedBuildListEntryIds ?? [])
    const candidates = ts.map(t => {
      const checks = Object.fromEntries(t.supportBuildListEntryIds.map(id => [id, facts?.supportChecks[id] ?? null]))
      const valid = t.supportBuildListEntryIds.every(id => { const c = facts?.supportChecks[id]; return c && c.S1 && c.S2 && c.S3 && c.S4 && c.S5 })
      return { targetWeaponId: t.targetWeaponId, generatedBuildListEntryId: t.generatedBuildListEntryId, selected: facts?.plan.present ? selected.has(t.generatedBuildListEntryId) : null,
        commitmentStatus: commitments.find(c => c.buildListEntryId === t.generatedBuildListEntryId)?.status ?? null,
        targetRegressedR: b0Selected === null || facts === null || !facts.plan.present ? null : b0Selected.has(t.currentBuildListEntryId) && !selected.has(t.generatedBuildListEntryId),
        requiresSupport: [...t.supportBuildListEntryIds], supportSelected: t.supportBuildListEntryIds.filter(id => selected.has(id)),
        // D1 holds at most one support Entry per G (§4.5): its S1..S5, or null for K0 (vacuous). Every support Entry is also listed by ID.
        supportChecks: t.supportBuildListEntryIds.length === 1 ? checks[t.supportBuildListEntryIds[0]!] ?? null : null, supportChecksByEntry: checks,
        supportValidity: t.supportBuildListEntryIds.length === 0 ? 'vacuous' : facts === null ? null : valid ? 'valid' : 'expired' }
    })
    const M = new Set([...generatedIds, ...support])
    const conflicts = (facts?.conflicts ?? []).map(c => ({ ...c, membersOfM: c.participants.filter(id => M.has(id)).length }))
    // baseline diff
    let baselineDiff: Json | null = null
    if (facts !== null && b0Facts !== null && reg.stage !== 'B0') {
      const sig = (c: { kind: string; participants: string[] }) => `${c.kind}:${[...c.participants].sort(compare).join(',')}`
      const b0Sig = new Set(b0Facts.conflicts.map(sig)), sig2 = new Set(facts.conflicts.map(sig))
      baselineDiff = {
        completedDelta: (facts.plan.termination?.completedTargetCount ?? 0) - (b0Facts.plan.termination?.completedTargetCount ?? 0),
        conflictDelta: facts.conflicts.length - b0Facts.conflicts.length,
        stepsDelta: facts.plan.steps === null || b0Facts.plan.steps === null ? null : facts.plan.steps - b0Facts.plan.steps,
        selectedAdded: facts.plan.selectedBuildListEntryIds.filter(id => !b0Selected!.has(id)).sort(compare),
        selectedRemoved: [...b0Selected!].filter(id => !selected.has(id)).sort(compare),
        conflictsAdded: [...sig2].filter(s => !b0Sig.has(s)).sort(compare), conflictsRemoved: [...b0Sig].filter(s => !sig2.has(s)).sort(compare),
      }
    }
    const baselineDiffNullReason = baselineDiff !== null || reg.stage === 'B0' ? null : b0Facts === null ? 'B0 is not measured' : 'this evaluation has no measured facts'
    // A(c)
    let composition: Json | null = null
    if (reg.stage === 'A-c') {
      const outcome = d1CompositionOutcome(accepted, reg.candidateIndex!, measuredStatus(status), r5.satisfied)
      composition = { acceptedBefore: [...accepted], candidate: reg.candidateIndex, proposed: outcome.proposed, acceptedAfter: outcome.acceptedAfter, accepted: outcome.accepted, afterUnmeasuredStep: unmeasuredSeen }
      if (row?.composition && (!same(row.composition.acceptedBefore, accepted) || !same(row.composition.proposed, outcome.proposed) || row.composition.accepted !== outcome.accepted
        || !same(row.composition.acceptedAfter, outcome.acceptedAfter))) add('raw_result_mismatch', `${reg.evaluationId}: the recorded A(c) step is not the replayed one`)
      if (row !== null && row.afterUnmeasuredStep !== unmeasuredSeen) add('raw_result_mismatch', `${reg.evaluationId}: afterUnmeasuredStep is not the replayed one`)
      accepted = outcome.acceptedAfter
      if (!measuredStatus(status)) unmeasuredSeen = true
    }
    const recordTiming = record !== null && typeof record.wallMs === 'number' ? record.wallMs : null
    const unmeasuredReason = measuredStatus(status) || status === 'not_executed' ? null : status
    return {
      evaluationId: reg.evaluationId, stage: reg.stage, ordinal: reg.ordinal, evaluatedAgainst: reg.evaluatedAgainst,
      replacementTargets: ts.map(t => t.targetWeaponId), replacementTargetLabels: ts.map(t => t.label), generatedEntryIds: generatedIds,
      generatedEntrySha256s: ts.map(t => gSha.get(t.unitId) ?? null), requiresSupport: support, status,
      unmeasuredReason, notExecutedReason: status === 'not_executed' ? notExecutedReason : null,
      process: row?.process ?? null, inputDigest, resultDigest, fullRunsStarted: facts?.fullRunsStarted ?? null, runtimeUnsupportedRemoved: facts?.runtimeUnsupportedRemoved ?? [],
      preflight: facts ? { status: facts.preflight.status, refusal: facts.preflight.refusal } : null,
      plan: facts ? { present: facts.plan.present, termination: facts.plan.termination, steps: facts.plan.steps, selectedBuildListEntryIds: facts.plan.selectedBuildListEntryIds, warningKinds: facts.plan.warningKinds } : null,
      conflicts, routeCommitment: commitments, candidates, r5,
      r1r4: reg.stage === 'S' && ts[0] ? d1R1R4(status as D1EvaluationStatus, facts, ts[0].generatedBuildListEntryId, ts[0].supportBuildListEntryIds, false) : null,
      parity, baselineDiff, baselineDiffNullReason, composition, boundLimited: isD1BoundLimited(status as D1EvaluationStatus, facts),
      wallMs: typeof row?.process?.wallMs === 'number' ? row.process.wallMs : null, childWallMs: recordTiming, ...memoryOf(record, row?.process ?? null),
    }
  })

  // ---- process count (G: one child per R unit / evaluation actually started, never a retry)
  const started = redelivery.filter(r => r.process !== null).length + evaluations.filter(e => e.process !== null).length
  if (input.childProcessCount !== null && input.childProcessCount !== started) add('guardrail', `${input.childProcessCount} child processes, not the ${started} started R units / evaluations`)

  // ---- determinism (§9.4)
  const groups = new Map<string, { evaluationId: string; resultDigest: string }[]>()
  for (const e of evaluations) if (e.inputDigest !== null && e.resultDigest !== null) groups.set(e.inputDigest, [...(groups.get(e.inputDigest) ?? []), { evaluationId: e.evaluationId, resultDigest: e.resultDigest }])
  const determinismCrossChecks = [...groups.entries()].filter(([, list]) => list.length > 1).map(([inputDigest, list]) => ({ inputDigest, evaluationIds: list.map(x => x.evaluationId),
    resultDigestsEqual: new Set(list.map(x => x.resultDigest)).size === 1 }))
  for (const check of determinismCrossChecks) if (!check.resultDigestsEqual) add('determinism', `${check.evaluationIds.join(' / ')} share inputDigest ${check.inputDigest} but not resultDigest`)

  // ---- aggregates
  const count = <T,>(list: readonly T[], key: (x: T) => string | null) => list.reduce<Record<string, number>>((acc, x) => { const k = key(x); if (k !== null) acc[k] = (acc[k] ?? 0) + 1; return acc }, {})
  const rUnmeasured = redelivery.filter(r => r.status !== 'redelivered' && r.status !== 'redelivery_mismatch')
  const eUnmeasured = evaluations.filter(e => !measuredStatus(e.status))
  const judged = evaluations.filter(e => e.r5.judged)
  const satisfied = judged.filter(e => e.r5.satisfied === true)
  const satisfiedSetsOfSizeAtLeast2 = satisfied.filter(e => e.generatedEntryIds.length >= 2).map(e => ({ evaluationId: e.evaluationId, stage: e.stage, size: e.generatedEntryIds.length, targets: e.replacementTargetLabels }))
  const aA = evaluations.find(e => e.stage === 'A-a')!
  const boundLimitedEvaluations = evaluations.filter(e => e.boundLimited).map(e => e.evaluationId)
  const regressed: Record<string, number> = {}
  for (const e of evaluations) for (const c of e.candidates) if (c.targetRegressedR === true) regressed[c.targetWeaponId] = (regressed[c.targetWeaponId] ?? 0) + 1
  const aggregates = {
    redelivery: { registered: targets.length, redelivered: redelivery.filter(r => r.status === 'redelivered').length, mismatched: redelivery.filter(r => r.status === 'redelivery_mismatch').length,
      unmeasuredByReason: count(rUnmeasured, r => String(r.status)) },
    evaluations: { registered: registry.length, measured: evaluations.length - eUnmeasured.length, unmeasuredByReason: count(eUnmeasured.filter(e => e.status !== 'not_executed'), e => e.status),
      notExecutedByReason: count(evaluations.filter(e => e.status === 'not_executed'), e => e.notExecutedReason ?? 'unknown'), byStatus: count(evaluations, e => e.status) },
    fullPlannerRunsStarted: evaluations.reduce((sum, e) => sum + (e.fullRunsStarted ?? 0), 0),
    runtimeUnsupportedRetries: evaluations.reduce((sum, e) => sum + e.runtimeUnsupportedRemoved.length, 0),
    r5: { judged: judged.length, satisfied: satisfied.length, satisfiedByStage: count(satisfied, e => e.stage), satisfiedSetsOfSizeAtLeast2,
      maxObservedSatisfiedSetSize: satisfiedSetsOfSizeAtLeast2.reduce((max, s) => Math.max(max, s.size), 0) },
    aAGeneratedSelectedCount: aA.plan?.present ? aA.candidates.filter(c => c.selected === true).length : null,
    aCFinalAccepted: [...accepted],
    boundLimitedEvaluations,
    targetRegressedR: { byEvaluation: Object.fromEntries(evaluations.map(e => [e.evaluationId, e.candidates.filter(c => c.targetRegressedR === true).length])), byTarget: regressed },
    determinismCrossChecks,
  }
  const unmeasuredOrNotExecuted = rUnmeasured.length + eUnmeasured.length
  const decision = classifyD1Decision({ invalidReasons: invalid, unmeasuredOrNotExecuted, aASatisfied: aA.r5.satisfied,
    satisfiedSetsOfSizeAtLeast2, boundLimitedEvaluations })
  return { redelivery, evaluations, aggregates, invalidReasons: invalid, decision }
}
