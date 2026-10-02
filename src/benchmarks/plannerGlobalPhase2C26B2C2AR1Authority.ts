/**
 * Issue #154 Phase 2-C2.6-B2-C2A-R1: the B2-C2A RESULT as the registered authority, and the retry manifest made from it.
 * Research only. Never import from Production, and never from the R1 Search side (`plannerGlobalPhase2C26B2C2AR1.ts`'s
 * runner never reads this module).
 *
 * The B2-C2A RESULT is post-hoc evidence (it holds compatibility, oracle coverage and first exact ranks). Only two
 * consumers read it: the retry-manifest step before the run, which takes from it nothing but the IDs of the rows B2-C2A
 * could not measure because their child timed out, and the R1 analyzer after the run. The retry selection is purely
 * `process === 'timeout' && record === null`; it never reads `compatible`, `coverage`, an exact index, a first compatible
 * rank, an oracle operation cost or a route kind.
 */
import { stableStringify } from '../domain/models/hashing'
import { defaultPlannerAlternativeSearchExtent } from '../domain/search'
import {
  PHASE2C26B2C2A_CANDIDATE_SAFETY_CAP,
  PHASE2C26B2C2A_CONTEXT_BUDGET,
  PHASE2C26B2C2A_EXPECTED_TASKS,
  PHASE2C26B2C2A_MAX_COST_COHORTS,
  PHASE2C26B2C2A_STAGE1,
  PHASE2C26B2C2A_VALIDATION_TARGETS,
} from './plannerGlobalPhase2C26B2C2A'
import type { Phase2C26B2C2ACapturePolicy } from './plannerGlobalPhase2C26B2C2AAnalysis'
import { PHASE2C26B2C2AR1_EXPECTED_RETRY_TASKS, PHASE2C26B2C2AR1_SOURCE, type Phase2C26B2C2AR1RetryManifest } from './plannerGlobalPhase2C26B2C2AR1'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const SHA256 = /^[0-9a-f]{64}$/
const COMMIT = /^[0-9a-f]{40}$/
const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0
const isRankOrNull = (value: unknown) => value === null || (Number.isSafeInteger(value) && (value as number) >= 1)

// ---------------------------------------------------------------- registered before the formal retry

/** The B2-C2A RESULT R1 is registered against, as read on main before R1. Any other value fails closed. */
export const PHASE2C26B2C2AR1_REGISTERED_B2C2A = {
  resultSha256: PHASE2C26B2C2AR1_SOURCE.b2c2aResultSha256,
  targetManifestSha256: PHASE2C26B2C2AR1_SOURCE.targetManifestSha256,
  decisionCase: 'B2C2A_INCOMPLETE',
  tasks: PHASE2C26B2C2A_EXPECTED_TASKS,
  targets: PHASE2C26B2C2A_VALIDATION_TARGETS,
  execution: { completed: 318, timeout: PHASE2C26B2C2AR1_EXPECTED_RETRY_TASKS, outOfMemory: 0, processFailure: 0, contextMismatch: 0 },
  exactTargets: { C8: 18, C32: 18, C4C: 20 },
  provenanceFlags: { oracleGuidedPolicySelection: true, oracleGuidedTargetPopulation: true, contextOrderingUsesOracle: false, oracleReadBySearchChild: false, oracleMatchUsedForEarlyStop: false },
} as const

// ---------------------------------------------------------------- the parsed authority

/** One B2-C2A context as its RESULT recorded it (post-hoc fields included; the Search side never sees them). */
export interface Phase2C26B2C2AR1OriginalTaskRow {
  taskId: string
  targetWeaponId: string
  contextRank: number
  groupIndex: number
  reservationDigest: string
  targetEligibleMinCardinality: number
  representativeFixedSetId: string
  representativeFixedTargetWeaponIds: string[]
  searchInputDigest: string
  process: string
  record: 'searched' | 'context_mismatch' | null
  wallMs: number | null
  peakHeapBytes: number | null
  peakRssBytes: number | null
  yields: number | null
  termination: string | null
  candidateCount: number | null
  capturedCosts: number[]
  captureComplete: boolean | null
  safetyCapHit: boolean | null
  compatible: boolean
  coverage: string | null
  firstExactIndex: number | null
  firstExactCost: number | null
  firstPartialIndex: number | null
  exactCount: number
  partialCount: number
  hit: Record<Phase2C26B2C2ACapturePolicy, boolean>
  sentinelExact: boolean
  reservationViolations: number
}

export interface Phase2C26B2C2AR1OriginalTargetRow {
  targetWeaponId: string
  b2c1FirstCompatibleRank: number | null
  policies: Record<Phase2C26B2C2ACapturePolicy, { firstExactContextRank: number | null; firstExactCandidateIndex: number | null; firstExactOperationCost: number | null }>
  recovery: string
  missClass: string | null
  safetyCapContexts: number
}

export interface Phase2C26B2C2AR1Authority {
  resultSha256: string
  measuredHead: string
  analysisHead: string
  benchmarkCodeSha256: string
  exportSha256: string
  targetManifestSha256: string
  b2c1ResultSha256: string
  b2b1ResultSha256: string
  b2b2aResultSha256: string
  b2b2a2ResultSha256: string
  oracleResultSha256: string
  oracleManifestFileSha256: string
  oracleManifestRoutesSha256: string
  stage1: Json
  execution: { tasks: number; completed: number; timeout: number; outOfMemory: number; processFailure: number; contextMismatch: number; notRun: number }
  exactTargets: Record<Phase2C26B2C2ACapturePolicy, number>
  budgetCoverage: Record<Phase2C26B2C2ACapturePolicy, Record<string, number>>
  cascade: Json
  targetWeaponIds: string[]
  taskRows: Phase2C26B2C2AR1OriginalTaskRow[]
  targets: Phase2C26B2C2AR1OriginalTargetRow[]
}

const POLICIES: readonly Phase2C26B2C2ACapturePolicy[] = ['C8', 'C32', 'C4C']
const sha = (json: Json, key: string, issues: string[]) => {
  const value = json[key]
  if (typeof value !== 'string' || !SHA256.test(value)) { issues.push(`provenance.${key} is not a SHA-256`); return '' }
  return value
}

function readTaskRow(raw: unknown, index: number, issues: string[]): Phase2C26B2C2AR1OriginalTaskRow | null {
  if (!isObject(raw)) { issues.push(`taskRows[${index}] is not an object`); return null }
  const at = typeof raw.taskId === 'string' ? raw.taskId : `taskRows[${index}]`
  const bad: string[] = []
  if (typeof raw.taskId !== 'string' || !/^t\d{2}-r\d{2}$/.test(raw.taskId)) bad.push('taskId')
  for (const key of ['targetWeaponId', 'reservationDigest', 'representativeFixedSetId', 'searchInputDigest', 'process']) if (typeof raw[key] !== 'string') bad.push(key)
  for (const key of ['contextRank', 'groupIndex', 'targetEligibleMinCardinality', 'exactCount', 'partialCount', 'reservationViolations']) if (!isCount(raw[key])) bad.push(key)
  if (!Array.isArray(raw.representativeFixedTargetWeaponIds) || !raw.representativeFixedTargetWeaponIds.every(id => typeof id === 'string')) bad.push('representativeFixedTargetWeaponIds')
  if (raw.record !== null && raw.record !== 'searched' && raw.record !== 'context_mismatch') bad.push('record')
  if (typeof raw.compatible !== 'boolean' || typeof raw.sentinelExact !== 'boolean') bad.push('compatible / sentinelExact')
  if (!isObject(raw.hit) || !POLICIES.every(p => typeof (raw.hit as Json)[p] === 'boolean')) bad.push('hit')
  if (!Array.isArray(raw.capturedCosts) || !raw.capturedCosts.every(isCount)) bad.push('capturedCosts')
  for (const key of ['firstExactIndex', 'firstExactCost', 'firstPartialIndex', 'candidateCount']) if (raw[key] !== null && !isCount(raw[key])) bad.push(key)
  for (const key of ['captureComplete', 'safetyCapHit']) if (raw[key] !== null && typeof raw[key] !== 'boolean') bad.push(key)
  for (const key of ['wallMs', 'peakHeapBytes', 'peakRssBytes', 'yields']) if (raw[key] !== null && typeof raw[key] !== 'number') bad.push(key)
  for (const key of ['termination', 'coverage']) if (raw[key] !== null && typeof raw[key] !== 'string') bad.push(key)
  if (bad.length > 0) { issues.push(`${at}: unreadable ${bad.join(', ')}`); return null }
  return {
    taskId: String(raw.taskId), targetWeaponId: String(raw.targetWeaponId), contextRank: raw.contextRank as number, groupIndex: raw.groupIndex as number,
    reservationDigest: String(raw.reservationDigest), targetEligibleMinCardinality: raw.targetEligibleMinCardinality as number, representativeFixedSetId: String(raw.representativeFixedSetId),
    representativeFixedTargetWeaponIds: (raw.representativeFixedTargetWeaponIds as string[]).map(String), searchInputDigest: String(raw.searchInputDigest), process: String(raw.process),
    record: raw.record as Phase2C26B2C2AR1OriginalTaskRow['record'], wallMs: raw.wallMs as number | null, peakHeapBytes: raw.peakHeapBytes as number | null, peakRssBytes: raw.peakRssBytes as number | null,
    yields: raw.yields as number | null, termination: raw.termination as string | null, candidateCount: raw.candidateCount as number | null, capturedCosts: [...(raw.capturedCosts as number[])],
    captureComplete: raw.captureComplete as boolean | null, safetyCapHit: raw.safetyCapHit as boolean | null, compatible: raw.compatible as boolean, coverage: raw.coverage as string | null,
    firstExactIndex: raw.firstExactIndex as number | null, firstExactCost: raw.firstExactCost as number | null, firstPartialIndex: raw.firstPartialIndex as number | null,
    exactCount: raw.exactCount as number, partialCount: raw.partialCount as number, hit: { C8: (raw.hit as Json).C8 as boolean, C32: (raw.hit as Json).C32 as boolean, C4C: (raw.hit as Json).C4C as boolean },
    sentinelExact: raw.sentinelExact as boolean, reservationViolations: raw.reservationViolations as number,
  }
}

function readTargetRow(raw: unknown, index: number, issues: string[]): Phase2C26B2C2AR1OriginalTargetRow | null {
  if (!isObject(raw) || typeof raw.targetWeaponId !== 'string' || !isRankOrNull(raw.b2c1FirstCompatibleRank) || !isObject(raw.policies) || typeof raw.recovery !== 'string'
    || (raw.missClass !== null && typeof raw.missClass !== 'string') || !isCount(raw.safetyCapContexts)) { issues.push(`targets[${index}] is unreadable`); return null }
  const policies = {} as Phase2C26B2C2AR1OriginalTargetRow['policies']
  for (const p of POLICIES) {
    const v = (raw.policies as Json)[p]
    if (!isObject(v) || !isRankOrNull(v.firstExactContextRank) || (v.firstExactCandidateIndex !== null && !isCount(v.firstExactCandidateIndex))
      || (v.firstExactOperationCost !== null && !isCount(v.firstExactOperationCost))) { issues.push(`targets[${index}].policies.${p} is unreadable`); return null }
    policies[p] = { firstExactContextRank: v.firstExactContextRank as number | null, firstExactCandidateIndex: v.firstExactCandidateIndex as number | null, firstExactOperationCost: v.firstExactOperationCost as number | null }
  }
  return { targetWeaponId: raw.targetWeaponId, b2c1FirstCompatibleRank: raw.b2c1FirstCompatibleRank as number | null, policies, recovery: raw.recovery, missClass: raw.missClass as string | null,
    safetyCapContexts: raw.safetyCapContexts as number }
}

/**
 * Reads the committed B2-C2A RESULT as untrusted JSON and fails closed unless it is the registered formal result: its own
 * SHA-256, formal with no calculation change after its measured HEAD, the declared oracle provenance flags, case
 * B2C2A_INCOMPLETE with no invalid reason, 320 tasks of 20 Targets x 16 ranks, 318 completed / 2 timeout / 0 OOM / 0 failure
 * / 0 context mismatch, exact Targets C8 18 / C32 18 / C4C 20, the registered Stage 1 / capture / extent conditions, and
 * readable task / Target rows that agree with those counts (every unmeasured row is a timeout without a record).
 */
export function parsePhase2C26B2C2AR1Authority(json: unknown, fileSha256: string): { valid: boolean; issues: string[]; authority: Phase2C26B2C2AR1Authority | null } {
  const issues: string[] = []
  const r = PHASE2C26B2C2AR1_REGISTERED_B2C2A
  if (fileSha256 !== r.resultSha256) issues.push(`the B2-C2A RESULT SHA-256 ${fileSha256} is not the registered ${r.resultSha256}`)
  if (!isObject(json)) return { valid: false, issues: [...issues, 'the B2-C2A RESULT is not an object'], authority: null }
  const provenance = isObject(json.provenance) ? json.provenance : {}
  const conditions = isObject(json.conditions) ? json.conditions : {}
  const aggregates = isObject(json.aggregates) ? json.aggregates : {}
  const execution = isObject(aggregates.execution) ? aggregates.execution : {}
  const decision = isObject(json.decision) ? json.decision : {}
  if (provenance.formal !== true) issues.push('provenance.formal is not true')
  if (!same(provenance.calculationCodeChangedSinceMeasuredHead, [])) issues.push('calculation code changed after the B2-C2A measured HEAD')
  if (provenance.analysisCodeUncommitted !== false || provenance.uncommittedBenchmarkCode !== false || provenance.smoke !== null) issues.push('the B2-C2A RESULT is not a committed, non-smoke run')
  for (const [flag, value] of Object.entries(r.provenanceFlags)) if (provenance[flag] !== value) issues.push(`provenance.${flag} is not ${String(value)}`)
  if (typeof provenance.measuredHead !== 'string' || !COMMIT.test(provenance.measuredHead)) issues.push('provenance.measuredHead is not a commit')
  if (typeof provenance.analysisHead !== 'string' || !COMMIT.test(provenance.analysisHead)) issues.push('provenance.analysisHead is not a commit')
  if (decision.case !== r.decisionCase) issues.push(`decision.case is ${String(decision.case)}, not ${r.decisionCase}`)
  if (!same(decision.reasons, [])) issues.push('decision.reasons is not empty')
  if (!same(json.invalidReasons, [])) issues.push('invalidReasons is not empty')
  const tasks = isObject(json.tasks) ? json.tasks : {}
  if (tasks.total !== r.tasks || tasks.targets !== r.targets || tasks.contextBudget !== PHASE2C26B2C2A_CONTEXT_BUDGET) issues.push(`tasks is not ${r.tasks} = ${r.targets} x ${PHASE2C26B2C2A_CONTEXT_BUDGET}`)
  if (execution.tasks !== r.tasks || execution.runs !== r.tasks || execution.notRun !== 0) issues.push('aggregates.execution does not run every task once')
  for (const [key, value] of Object.entries(r.execution)) if (execution[key] !== value) issues.push(`aggregates.execution.${key} is ${String(execution[key])}, not ${value}`)
  const exactTargets = isObject(aggregates.exactTargets) ? aggregates.exactTargets : {}
  for (const p of POLICIES) if (exactTargets[p] !== r.exactTargets[p]) issues.push(`aggregates.exactTargets.${p} is ${String(exactTargets[p])}, not ${r.exactTargets[p]}`)
  if (!same(conditions.stage1, PHASE2C26B2C2A_STAGE1)) issues.push('conditions.stage1 is not the B2-C2A Stage 1')
  if (conditions.maxCostCohorts !== PHASE2C26B2C2A_MAX_COST_COHORTS || conditions.candidateSafetyCap !== PHASE2C26B2C2A_CANDIDATE_SAFETY_CAP || conditions.contextBudget !== PHASE2C26B2C2A_CONTEXT_BUDGET) {
    issues.push('conditions capture / budget are not the B2-C2A ones')
  }
  if (!same(conditions.extent, { ...defaultPlannerAlternativeSearchExtent })) issues.push('conditions.extent is not the Production default extent')
  const shas = Object.fromEntries(['exportSha256', 'targetManifestSha256', 'b2c1ResultSha256', 'b2b1ResultSha256', 'b2b2aResultSha256', 'b2b2a2ResultSha256', 'oracleResultSha256',
    'oracleManifestFileSha256', 'oracleManifestRoutesSha256', 'benchmarkCodeSha256'].map(key => [key, sha(provenance, key, issues)]))
  if (shas.targetManifestSha256 !== '' && shas.targetManifestSha256 !== r.targetManifestSha256) issues.push('provenance.targetManifestSha256 is not the registered Target manifest')

  const taskRows = asArray(json.taskRows).map((row, i) => readTaskRow(row, i, issues)).filter((row): row is Phase2C26B2C2AR1OriginalTaskRow => row !== null)
  if (asArray(json.taskRows).length !== r.tasks || taskRows.length !== r.tasks) issues.push(`taskRows holds ${taskRows.length} readable rows, not ${r.tasks}`)
  if (new Set(taskRows.map(row => row.taskId)).size !== taskRows.length) issues.push('taskRows repeats a task')
  const targetWeaponIds = [...new Set(taskRows.map(row => row.targetWeaponId))]
  if (targetWeaponIds.length !== r.targets) issues.push(`taskRows covers ${targetWeaponIds.length} Targets, not ${r.targets}`)
  for (const id of targetWeaponIds) {
    if (!same(taskRows.filter(row => row.targetWeaponId === id).map(row => row.contextRank), Array.from({ length: PHASE2C26B2C2A_CONTEXT_BUDGET }, (_, i) => i + 1))) issues.push(`${id}: taskRows ranks are not 1..${PHASE2C26B2C2A_CONTEXT_BUDGET}`)
  }
  for (const row of taskRows) {
    const measured = row.process === 'completed' && row.record === 'searched'
    if (!measured && !(row.process === 'timeout' && row.record === null)) issues.push(`${row.taskId}: an unmeasured row that is not a timeout without a record`)
    if (!measured && (row.candidateCount !== null || row.hit.C4C || row.exactCount > 0 || row.partialCount > 0)) issues.push(`${row.taskId}: an unmeasured row carries Candidates`)
    if (measured && (row.candidateCount === null || row.captureComplete === null || row.safetyCapHit === null)) issues.push(`${row.taskId}: a measured row without a capture`)
  }
  const counted = { completed: taskRows.filter(row => row.process === 'completed' && row.record === 'searched').length, timeout: taskRows.filter(row => row.process === 'timeout').length }
  if (counted.completed !== r.execution.completed || counted.timeout !== r.execution.timeout) issues.push(`taskRows count ${counted.completed} completed / ${counted.timeout} timeout, not the aggregate`)
  const targets = asArray(json.targets).map((row, i) => readTargetRow(row, i, issues)).filter((row): row is Phase2C26B2C2AR1OriginalTargetRow => row !== null)
  if (targets.length !== r.targets || !same(targets.map(t => t.targetWeaponId).sort(compare), [...targetWeaponIds].sort(compare))) issues.push('targets rows are not the taskRows Targets')
  const budgetCoverage = isObject(aggregates.budgetCoverage) ? aggregates.budgetCoverage as Phase2C26B2C2AR1Authority['budgetCoverage'] : null
  if (!budgetCoverage || !POLICIES.every(p => isObject(budgetCoverage[p]))) issues.push('aggregates.budgetCoverage is unreadable')
  if (issues.length > 0) return { valid: false, issues, authority: null }
  return { valid: true, issues: [], authority: {
    resultSha256: fileSha256, measuredHead: String(provenance.measuredHead), analysisHead: String(provenance.analysisHead), benchmarkCodeSha256: shas.benchmarkCodeSha256!,
    exportSha256: shas.exportSha256!, targetManifestSha256: shas.targetManifestSha256!, b2c1ResultSha256: shas.b2c1ResultSha256!, b2b1ResultSha256: shas.b2b1ResultSha256!,
    b2b2aResultSha256: shas.b2b2aResultSha256!, b2b2a2ResultSha256: shas.b2b2a2ResultSha256!, oracleResultSha256: shas.oracleResultSha256!, oracleManifestFileSha256: shas.oracleManifestFileSha256!,
    oracleManifestRoutesSha256: shas.oracleManifestRoutesSha256!, stage1: conditions.stage1 as Json,
    execution: { tasks: execution.tasks as number, completed: execution.completed as number, timeout: execution.timeout as number, outOfMemory: execution.outOfMemory as number,
      processFailure: execution.processFailure as number, contextMismatch: execution.contextMismatch as number, notRun: execution.notRun as number },
    exactTargets: { C8: exactTargets.C8 as number, C32: exactTargets.C32 as number, C4C: exactTargets.C4C as number }, budgetCoverage: budgetCoverage!,
    cascade: isObject(aggregates.cascade) ? aggregates.cascade : {}, targetWeaponIds, taskRows, targets,
  } }
}

// ---------------------------------------------------------------- the timeout subset and the retry manifest

/**
 * The B2-C2A rows that were never measured because their child timed out: `process === 'timeout' && record === null`,
 * nothing else read, sorted by task ID.
 */
export function phase2c26b2c2ar1TimeoutTaskIds(taskRows: readonly Pick<Phase2C26B2C2AR1OriginalTaskRow, 'taskId' | 'process' | 'record'>[]): string[] {
  return taskRows.filter(row => row.process === 'timeout' && row.record === null).map(row => row.taskId).sort(compare)
}

/** The retry manifest: task IDs and source hashes only. Throws unless the timeout subset is exactly the registered size. */
export function phase2c26b2c2ar1RetryManifest(authority: Pick<Phase2C26B2C2AR1Authority, 'resultSha256' | 'targetManifestSha256' | 'exportSha256' | 'taskRows'>): Phase2C26B2C2AR1RetryManifest {
  const taskIds = phase2c26b2c2ar1TimeoutTaskIds(authority.taskRows)
  if (taskIds.length !== PHASE2C26B2C2AR1_EXPECTED_RETRY_TASKS) throw new Error(`The B2-C2A timeout subset holds ${taskIds.length} tasks, not ${PHASE2C26B2C2AR1_EXPECTED_RETRY_TASKS}.`)
  return { phase: 'Issue #154 Phase 2-C2.6-B2-C2A-R1 retry manifest (B2-C2A timeout subset)', sourceB2C2AResultSha256: authority.resultSha256,
    sourceTargetManifestSha256: authority.targetManifestSha256, exportSha256: authority.exportSha256, taskIds }
}
