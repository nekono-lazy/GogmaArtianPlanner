/**
 * Issue #154 Phase 2-C2.6-B2-C2A-R2: the R1 RESULT as the registered authority, and the retry manifest made from it plus
 * the B2-C2A RESULT. Research only. Never import from Production, and never from the R2 Search side
 * (`plannerGlobalPhase2C26B2C2AR2.ts`'s runner never reads this module).
 *
 * The B2-C2A and R1 RESULTs are post-hoc evidence (they hold compatibility, oracle coverage and first exact ranks). Only two
 * consumers read them: the retry-manifest step before the run, which takes from them nothing but the IDs of the tasks that
 * are still unmeasured after the R1 completion overlay, and the R2 analyzer after the run. The retry selection is purely
 * "B2-C2A did not measure it, and its R1 retry did not measure it either" (measured = the child completed with a Search
 * record); it never reads `compatible`, `coverage`, an exact index, a first compatible rank, an oracle operation cost, a
 * route kind, or whether the Target already holds an exact Candidate at another rank.
 *
 * The B2-C2A RESULT itself is parsed by the unchanged R1 authority (`parsePhase2C26B2C2AR1Authority()`).
 */
import { stableStringify } from '../domain/models/hashing'
import { defaultPlannerAlternativeSearchExtent } from '../domain/search'
import {
  PHASE2C26B2C2A_CANDIDATE_SAFETY_CAP,
  PHASE2C26B2C2A_EXPECTED_TASKS,
  PHASE2C26B2C2A_MAX_COST_COHORTS,
  PHASE2C26B2C2A_STAGE1,
} from './plannerGlobalPhase2C26B2C2A'
import type { Phase2C26B2C2ACapturePolicy } from './plannerGlobalPhase2C26B2C2AAnalysis'
import { PHASE2C26B2C2AR1_EXPECTED_RETRY_TASKS, PHASE2C26B2C2AR1_RETRY } from './plannerGlobalPhase2C26B2C2AR1'
import type { Phase2C26B2C2AR1Authority, Phase2C26B2C2AR1OriginalTaskRow } from './plannerGlobalPhase2C26B2C2AR1Authority'
import { PHASE2C26B2C2AR2_EXPECTED_RETRY_TASKS, PHASE2C26B2C2AR2_SOURCE, type Phase2C26B2C2AR2RetryManifest } from './plannerGlobalPhase2C26B2C2AR2'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const SHA256 = /^[0-9a-f]{64}$/
const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0
const isRankOrNull = (value: unknown) => value === null || (Number.isSafeInteger(value) && (value as number) >= 1)
const POLICIES: readonly Phase2C26B2C2ACapturePolicy[] = ['C8', 'C32', 'C4C']

// ---------------------------------------------------------------- registered before the formal retry

/** The R1 RESULT R2 is registered against, as read on main before R2. Any other value fails closed. */
export const PHASE2C26B2C2AR2_REGISTERED_R1 = {
  resultSha256: PHASE2C26B2C2AR2_SOURCE.r1ResultSha256,
  measuredHead: '62524dedbd89263014eadafcadce2f82e83410d6',
  analysisHead: '62524dedbd89263014eadafcadce2f82e83410d6',
  benchmarkCodeSha256: '1673c41c9d19fcdf4584ec88325b3daa0c542bcc92596683c309a9f59b78515d',
  retryManifestSha256: PHASE2C26B2C2AR2_SOURCE.r1RetryManifestSha256,
  b2c2aResultSha256: PHASE2C26B2C2AR2_SOURCE.b2c2aResultSha256,
  targetManifestSha256: PHASE2C26B2C2AR2_SOURCE.targetManifestSha256,
  decisionCase: 'B2C2AR1_INCOMPLETE',
  combinedB2C2ACase: 'B2C2A_INCOMPLETE',
  overlay: {
    original: { tasks: PHASE2C26B2C2A_EXPECTED_TASKS, measured: 318, timeout: PHASE2C26B2C2AR1_EXPECTED_RETRY_TASKS },
    retry: { selected: PHASE2C26B2C2AR1_EXPECTED_RETRY_TASKS, runs: PHASE2C26B2C2AR1_EXPECTED_RETRY_TASKS, measured: 1, timeout: 1, outOfMemory: 0, processFailure: 0, contextMismatch: 0, notRun: 0 },
    combined: { tasks: PHASE2C26B2C2A_EXPECTED_TASKS, measured: 319, unmeasured: PHASE2C26B2C2AR2_EXPECTED_RETRY_TASKS, resolvedByRetry: 1, unresolved: PHASE2C26B2C2AR2_EXPECTED_RETRY_TASKS },
  },
  combinedExactTargets: { C8: 18, C32: 18, C4C: 20 },
  hashChainEntries: 26,
  provenanceFlags: { oracleGuidedPolicySelection: true, oracleGuidedTargetPopulation: true, contextOrderingUsesOracle: false, retrySelectionUsesOracle: false,
    oracleReadBySearchChild: false, oracleMatchUsedForEarlyStop: false, originalEvidenceRerun: false, b2c2aResultRewritten: false },
} as const

// ---------------------------------------------------------------- the parsed R1 authority

/** One R1 retry row as the R1 RESULT recorded it (post-hoc fields included; the Search side never sees them). */
export interface Phase2C26B2C2AR2R1RetryRow {
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
  budgetMs: number
  wallMs: number | null
  searchElapsedMs: number | null
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
  /** The first exact Candidate's operation cost (`firstExactCandidate.estimatedOperationCount`), or null. */
  firstExactCost: number | null
  firstPartialIndex: number | null
  exactCount: number
  partialCount: number
  hit: Record<Phase2C26B2C2ACapturePolicy, boolean>
  sentinelExact: boolean
  reservationViolations: number
}

/** One R1 combined Target row, for the reproduction guard. */
export interface Phase2C26B2C2AR2R1CombinedTarget {
  targetWeaponId: string
  measuredContexts: number
  fullyMeasured: boolean
  safetyCapContexts: number
  policies: Record<Phase2C26B2C2ACapturePolicy, { firstExactContextRank: number | null; firstExactCandidateIndex: number | null; firstExactOperationCost: number | null }>
  recovery: string
  missClass: string | null
}

/** The R1 completion overlay counts as the R1 RESULT recorded them. */
export interface Phase2C26B2C2AR2R1Overlay {
  original: { tasks: number; measured: number; timeout: number }
  retry: { selected: number; runs: number; measured: number; timeout: number; outOfMemory: number; processFailure: number; contextMismatch: number; notRun: number }
  combined: { tasks: number; measured: number; unmeasured: number; resolvedByRetry: number; unresolved: number }
}

export interface Phase2C26B2C2AR2R1Authority {
  resultSha256: string
  measuredHead: string
  analysisHead: string
  benchmarkCodeSha256: string
  exportSha256: string
  b2c2aResultSha256: string
  targetManifestSha256: string
  retryManifestSha256: string
  b2c1ResultSha256: string
  b2b1ResultSha256: string
  b2b2aResultSha256: string
  b2b2a2ResultSha256: string
  oracleResultSha256: string
  oracleManifestFileSha256: string
  oracleManifestRoutesSha256: string
  retryTaskIds: string[]
  retry: Json
  overlay: Phase2C26B2C2AR2R1Overlay
  combined: { exactTargets: Record<Phase2C26B2C2ACapturePolicy, number>; budgetCoverage: Record<Phase2C26B2C2ACapturePolicy, Record<string, number>>; cascade: Json;
    unresolvedSafetyCapTargets: number; fullyMeasuredTargets: number }
  combinedTargets: Phase2C26B2C2AR2R1CombinedTarget[]
  retryRows: Phase2C26B2C2AR2R1RetryRow[]
}

const sha = (json: Json, key: string, issues: string[]) => {
  const value = json[key]
  if (typeof value !== 'string' || !SHA256.test(value)) { issues.push(`provenance.${key} is not a SHA-256`); return '' }
  return value
}

function readRetryRow(raw: unknown, index: number, issues: string[]): Phase2C26B2C2AR2R1RetryRow | null {
  if (!isObject(raw)) { issues.push(`retryRows[${index}] is not an object`); return null }
  const at = typeof raw.taskId === 'string' ? raw.taskId : `retryRows[${index}]`
  const bad: string[] = []
  if (typeof raw.taskId !== 'string' || !/^t\d{2}-r\d{2}$/.test(raw.taskId)) bad.push('taskId')
  for (const key of ['targetWeaponId', 'reservationDigest', 'representativeFixedSetId', 'searchInputDigest', 'process']) if (typeof raw[key] !== 'string') bad.push(key)
  for (const key of ['contextRank', 'groupIndex', 'targetEligibleMinCardinality', 'exactCount', 'partialCount', 'reservationViolations', 'budgetMs']) if (!isCount(raw[key])) bad.push(key)
  if (!Array.isArray(raw.representativeFixedTargetWeaponIds) || !raw.representativeFixedTargetWeaponIds.every(id => typeof id === 'string')) bad.push('representativeFixedTargetWeaponIds')
  if (raw.record !== null && raw.record !== 'searched' && raw.record !== 'context_mismatch') bad.push('record')
  if (typeof raw.compatible !== 'boolean' || typeof raw.sentinelExact !== 'boolean') bad.push('compatible / sentinelExact')
  if (!isObject(raw.hit) || !POLICIES.every(p => typeof (raw.hit as Json)[p] === 'boolean')) bad.push('hit')
  if (!Array.isArray(raw.capturedCosts) || !raw.capturedCosts.every(isCount)) bad.push('capturedCosts')
  for (const key of ['firstExactIndex', 'firstPartialIndex', 'candidateCount']) if (raw[key] !== null && !isCount(raw[key])) bad.push(key)
  for (const key of ['captureComplete', 'safetyCapHit']) if (raw[key] !== null && typeof raw[key] !== 'boolean') bad.push(key)
  for (const key of ['wallMs', 'searchElapsedMs', 'peakHeapBytes', 'peakRssBytes', 'yields']) if (raw[key] !== null && typeof raw[key] !== 'number') bad.push(key)
  for (const key of ['termination', 'coverage']) if (raw[key] !== null && typeof raw[key] !== 'string') bad.push(key)
  const firstExact = raw.firstExactCandidate
  if (firstExact !== null && (!isObject(firstExact) || !isCount(firstExact.estimatedOperationCount))) bad.push('firstExactCandidate')
  if ((raw.firstExactIndex === null) !== (firstExact === null)) bad.push('firstExactIndex / firstExactCandidate')
  if (bad.length > 0) { issues.push(`${at}: unreadable ${bad.join(', ')}`); return null }
  return {
    taskId: String(raw.taskId), targetWeaponId: String(raw.targetWeaponId), contextRank: raw.contextRank as number, groupIndex: raw.groupIndex as number,
    reservationDigest: String(raw.reservationDigest), targetEligibleMinCardinality: raw.targetEligibleMinCardinality as number, representativeFixedSetId: String(raw.representativeFixedSetId),
    representativeFixedTargetWeaponIds: (raw.representativeFixedTargetWeaponIds as string[]).map(String), searchInputDigest: String(raw.searchInputDigest), process: String(raw.process),
    record: raw.record as Phase2C26B2C2AR2R1RetryRow['record'], budgetMs: raw.budgetMs as number, wallMs: raw.wallMs as number | null, searchElapsedMs: raw.searchElapsedMs as number | null,
    peakHeapBytes: raw.peakHeapBytes as number | null, peakRssBytes: raw.peakRssBytes as number | null, yields: raw.yields as number | null, termination: raw.termination as string | null,
    candidateCount: raw.candidateCount as number | null, capturedCosts: [...(raw.capturedCosts as number[])], captureComplete: raw.captureComplete as boolean | null,
    safetyCapHit: raw.safetyCapHit as boolean | null, compatible: raw.compatible as boolean, coverage: raw.coverage as string | null, firstExactIndex: raw.firstExactIndex as number | null,
    firstExactCost: firstExact === null ? null : (firstExact as Json).estimatedOperationCount as number, firstPartialIndex: raw.firstPartialIndex as number | null,
    exactCount: raw.exactCount as number, partialCount: raw.partialCount as number, hit: { C8: (raw.hit as Json).C8 as boolean, C32: (raw.hit as Json).C32 as boolean, C4C: (raw.hit as Json).C4C as boolean },
    sentinelExact: raw.sentinelExact as boolean, reservationViolations: raw.reservationViolations as number,
  }
}

function readCombinedTarget(raw: unknown, index: number, issues: string[]): Phase2C26B2C2AR2R1CombinedTarget | null {
  if (!isObject(raw) || typeof raw.targetWeaponId !== 'string' || !isCount(raw.measuredContexts) || typeof raw.fullyMeasured !== 'boolean' || !isCount(raw.safetyCapContexts)
    || !isObject(raw.policies) || typeof raw.recovery !== 'string' || (raw.missClass !== null && typeof raw.missClass !== 'string')) { issues.push(`combinedTargets[${index}] is unreadable`); return null }
  const policies = {} as Phase2C26B2C2AR2R1CombinedTarget['policies']
  for (const p of POLICIES) {
    const v = (raw.policies as Json)[p]
    if (!isObject(v) || !isRankOrNull(v.firstExactContextRank) || (v.firstExactCandidateIndex !== null && !isCount(v.firstExactCandidateIndex))
      || (v.firstExactOperationCost !== null && !isCount(v.firstExactOperationCost))) { issues.push(`combinedTargets[${index}].policies.${p} is unreadable`); return null }
    policies[p] = { firstExactContextRank: v.firstExactContextRank as number | null, firstExactCandidateIndex: v.firstExactCandidateIndex as number | null, firstExactOperationCost: v.firstExactOperationCost as number | null }
  }
  return { targetWeaponId: raw.targetWeaponId, measuredContexts: raw.measuredContexts, fullyMeasured: raw.fullyMeasured, safetyCapContexts: raw.safetyCapContexts, policies,
    recovery: raw.recovery, missClass: raw.missClass as string | null }
}

/** An R1 retry row is measured when its child completed with a Search record (the same rule as the B2-C2A rows). */
export const phase2c26b2c2ar2R1RetryMeasured = (row: Pick<Phase2C26B2C2AR2R1RetryRow, 'process' | 'record'>) => row.process === 'completed' && row.record === 'searched'

/**
 * Reads the committed R1 RESULT as untrusted JSON and fails closed unless it is the registered formal result: its own SHA-256,
 * formal with no calculation change after its measured HEAD (the registered measured / analysis HEAD and benchmark code), the
 * declared provenance flags, case B2C2AR1_INCOMPLETE with no invalid reason, the registered B2-C2A RESULT / Target manifest /
 * R1 retry manifest, the R1 retry / Search / capture / extent conditions, the overlay 318 + 1 = 319 / 320 with 1 unresolved,
 * combined exact Targets C8 18 / C32 18 / C4C 20, a 26-entry all-true hash chain, and readable retry / combined Target rows
 * that agree with those counts (every unmeasured retry row is a timeout without a record and without Candidates).
 */
export function parsePhase2C26B2C2AR2R1Authority(json: unknown, fileSha256: string): { valid: boolean; issues: string[]; authority: Phase2C26B2C2AR2R1Authority | null } {
  const issues: string[] = []
  const r = PHASE2C26B2C2AR2_REGISTERED_R1
  if (fileSha256 !== r.resultSha256) issues.push(`the R1 RESULT SHA-256 ${fileSha256} is not the registered ${r.resultSha256}`)
  if (!isObject(json)) return { valid: false, issues: [...issues, 'the R1 RESULT is not an object'], authority: null }
  const provenance = isObject(json.provenance) ? json.provenance : {}
  const conditions = isObject(json.conditions) ? json.conditions : {}
  const aggregates = isObject(json.aggregates) ? json.aggregates : {}
  const combined = isObject(aggregates.combined) ? aggregates.combined : {}
  const decision = isObject(json.decision) ? json.decision : {}
  const parity = isObject(json.parity) ? json.parity : {}
  if (provenance.formal !== true) issues.push('provenance.formal is not true')
  if (!same(provenance.calculationCodeChangedSinceMeasuredHead, [])) issues.push('calculation code changed after the R1 measured HEAD')
  if (provenance.analysisCodeUncommitted !== false || provenance.uncommittedBenchmarkCode !== false || provenance.smoke !== null) issues.push('the R1 RESULT is not a committed, non-smoke run')
  if (provenance.measuredHead !== r.measuredHead) issues.push(`provenance.measuredHead is not the registered ${r.measuredHead}`)
  if (provenance.analysisHead !== r.analysisHead) issues.push(`provenance.analysisHead is not the registered ${r.analysisHead}`)
  if (provenance.benchmarkCodeSha256 !== r.benchmarkCodeSha256) issues.push('provenance.benchmarkCodeSha256 is not the registered R1 benchmark code')
  for (const [flag, value] of Object.entries(r.provenanceFlags)) if (provenance[flag] !== value) issues.push(`provenance.${flag} is not ${String(value)}`)
  if (decision.case !== r.decisionCase) issues.push(`decision.case is ${String(decision.case)}, not ${r.decisionCase}`)
  if (decision.combinedB2C2ACase !== r.combinedB2C2ACase) issues.push(`decision.combinedB2C2ACase is not ${r.combinedB2C2ACase}`)
  if (!same(decision.reasons, [])) issues.push('decision.reasons is not empty')
  if (!same(json.invalidReasons, [])) issues.push('invalidReasons is not empty')
  const shas = Object.fromEntries(['exportSha256', 'b2c2aResultSha256', 'targetManifestSha256', 'retryManifestSha256', 'b2c1ResultSha256', 'b2b1ResultSha256', 'b2b2aResultSha256',
    'b2b2a2ResultSha256', 'oracleResultSha256', 'oracleManifestFileSha256', 'oracleManifestRoutesSha256'].map(key => [key, sha(provenance, key, issues)]))
  if (shas.b2c2aResultSha256 !== '' && shas.b2c2aResultSha256 !== r.b2c2aResultSha256) issues.push('provenance.b2c2aResultSha256 is not the registered B2-C2A RESULT')
  if (shas.targetManifestSha256 !== '' && shas.targetManifestSha256 !== r.targetManifestSha256) issues.push('provenance.targetManifestSha256 is not the registered Target manifest')
  if (shas.retryManifestSha256 !== '' && shas.retryManifestSha256 !== r.retryManifestSha256) issues.push('provenance.retryManifestSha256 is not the registered R1 retry manifest')
  // Conditions: the R1 retry conditions, the B2-C2A Stage 1, the Production default extent and the capture rule.
  if (!same(conditions.retry, PHASE2C26B2C2AR1_RETRY)) issues.push('conditions.retry is not the R1 retry')
  if (!same(conditions.b2c2aStage1, PHASE2C26B2C2A_STAGE1)) issues.push('conditions.b2c2aStage1 is not the B2-C2A Stage 1')
  if (conditions.maxCostCohorts !== PHASE2C26B2C2A_MAX_COST_COHORTS || conditions.candidateSafetyCap !== PHASE2C26B2C2A_CANDIDATE_SAFETY_CAP || conditions.expectedTasks !== PHASE2C26B2C2A_EXPECTED_TASKS
    || conditions.expectedRetryTasks !== PHASE2C26B2C2AR1_EXPECTED_RETRY_TASKS) issues.push('conditions capture / task counts are not the R1 ones')
  if (!same(conditions.extent, { ...defaultPlannerAlternativeSearchExtent })) issues.push('conditions.extent is not the Production default extent')
  if (conditions.childScript !== 'scripts/run-planner-global-phase2c26b2c2a.mjs') issues.push('conditions.childScript is not the unchanged B2-C2A child')
  // The overlay, the combined aggregates and the hash chain.
  if (!same(json.overlay, r.overlay)) issues.push('overlay is not the registered 318 + 1 = 319 / 320 (1 unresolved)')
  const exactTargets = isObject(combined.exactTargets) ? combined.exactTargets : {}
  for (const p of POLICIES) if (exactTargets[p] !== r.combinedExactTargets[p]) issues.push(`aggregates.combined.exactTargets.${p} is ${String(exactTargets[p])}, not ${r.combinedExactTargets[p]}`)
  if (combined.unresolvedSafetyCapTargets !== 0) issues.push('aggregates.combined.unresolvedSafetyCapTargets is not 0')
  if (!isCount(combined.fullyMeasuredTargets)) issues.push('aggregates.combined.fullyMeasuredTargets is unreadable')
  const budgetCoverage = isObject(combined.budgetCoverage) ? combined.budgetCoverage as Phase2C26B2C2AR2R1Authority['combined']['budgetCoverage'] : null
  if (!budgetCoverage || !POLICIES.every(p => isObject(budgetCoverage[p]))) issues.push('aggregates.combined.budgetCoverage is unreadable')
  if (!isObject(combined.cascade)) issues.push('aggregates.combined.cascade is unreadable')
  const hashChain = isObject(parity.hashChain) ? parity.hashChain : null
  if (!hashChain || Object.keys(hashChain).length !== r.hashChainEntries || !Object.values(hashChain).every(v => v === true)) issues.push(`parity.hashChain is not ${r.hashChainEntries} true entries`)
  // The retry rows.
  const retryRows = asArray(json.retryRows).map((row, i) => readRetryRow(row, i, issues)).filter((row): row is Phase2C26B2C2AR2R1RetryRow => row !== null)
  if (asArray(json.retryRows).length !== PHASE2C26B2C2AR1_EXPECTED_RETRY_TASKS || retryRows.length !== PHASE2C26B2C2AR1_EXPECTED_RETRY_TASKS) issues.push(`retryRows holds ${retryRows.length} readable rows, not ${PHASE2C26B2C2AR1_EXPECTED_RETRY_TASKS}`)
  const retryTaskIds = retryRows.map(row => row.taskId)
  if (new Set(retryTaskIds).size !== retryTaskIds.length) issues.push('retryRows repeats a task')
  if (!same(retryTaskIds, [...retryTaskIds].sort(compare))) issues.push('retryRows are not in task order')
  const retryManifest = isObject(parity.retryManifest) ? parity.retryManifest : {}
  if (!same(retryManifest.taskIds, retryTaskIds)) issues.push('parity.retryManifest.taskIds are not the retry rows')
  const r1Authority = isObject(json.authority) && isObject(json.authority.b2c2a) ? json.authority.b2c2a : {}
  if (!same(r1Authority.timeoutTaskIds, retryTaskIds)) issues.push('authority.b2c2a.timeoutTaskIds are not the retry rows')
  for (const row of retryRows) {
    const measured = phase2c26b2c2ar2R1RetryMeasured(row)
    if (row.budgetMs !== PHASE2C26B2C2AR1_RETRY.budgetMs) issues.push(`${row.taskId}: a retry row run with another budget`)
    if (!measured && !(row.process === 'timeout' && row.record === null)) issues.push(`${row.taskId}: an unmeasured retry row that is not a timeout without a record`)
    if (!measured && (row.candidateCount !== null || row.captureComplete !== null || row.hit.C4C || row.exactCount > 0 || row.partialCount > 0 || row.coverage !== null)) issues.push(`${row.taskId}: an unmeasured retry row carries Candidates`)
    if (measured && (row.candidateCount === null || row.captureComplete === null || row.safetyCapHit === null || row.termination === null)) issues.push(`${row.taskId}: a measured retry row without a capture`)
  }
  const measuredRows = retryRows.filter(phase2c26b2c2ar2R1RetryMeasured).length
  if (measuredRows !== r.overlay.retry.measured || retryRows.filter(row => row.process === 'timeout').length !== r.overlay.retry.timeout) issues.push('retryRows do not agree with the overlay counts')
  const combinedTargets = asArray(json.combinedTargets).map((row, i) => readCombinedTarget(row, i, issues)).filter((row): row is Phase2C26B2C2AR2R1CombinedTarget => row !== null)
  if (combinedTargets.length !== 20 || new Set(combinedTargets.map(t => t.targetWeaponId)).size !== 20) issues.push('combinedTargets is not 20 distinct Targets')
  if (combinedTargets.reduce((sum, t) => sum + t.measuredContexts, 0) !== r.overlay.combined.measured) issues.push('combinedTargets measured contexts do not add up to the combined measured count')
  if (issues.length > 0) return { valid: false, issues, authority: null }
  return { valid: true, issues: [], authority: {
    resultSha256: fileSha256, measuredHead: String(provenance.measuredHead), analysisHead: String(provenance.analysisHead), benchmarkCodeSha256: String(provenance.benchmarkCodeSha256),
    exportSha256: shas.exportSha256!, b2c2aResultSha256: shas.b2c2aResultSha256!, targetManifestSha256: shas.targetManifestSha256!, retryManifestSha256: shas.retryManifestSha256!,
    b2c1ResultSha256: shas.b2c1ResultSha256!, b2b1ResultSha256: shas.b2b1ResultSha256!, b2b2aResultSha256: shas.b2b2aResultSha256!, b2b2a2ResultSha256: shas.b2b2a2ResultSha256!,
    oracleResultSha256: shas.oracleResultSha256!, oracleManifestFileSha256: shas.oracleManifestFileSha256!, oracleManifestRoutesSha256: shas.oracleManifestRoutesSha256!,
    retryTaskIds, retry: conditions.retry as Json, overlay: r.overlay,
    combined: { exactTargets: { C8: exactTargets.C8 as number, C32: exactTargets.C32 as number, C4C: exactTargets.C4C as number }, budgetCoverage: budgetCoverage!,
      cascade: combined.cascade as Json, unresolvedSafetyCapTargets: combined.unresolvedSafetyCapTargets as number, fullyMeasuredTargets: combined.fullyMeasuredTargets as number },
    combinedTargets, retryRows,
  } }
}

/**
 * The B2-C2A authority and the R1 authority describe one evidence chain: the R1 RESULT names this B2-C2A RESULT, Target
 * manifest, Export and every upstream RESULT the B2-C2A RESULT names, its retry rows are exactly the B2-C2A rows that were
 * unmeasured, and each retry row carries exactly that row's task identity and B2-C2A compatibility.
 */
export function phase2c26b2c2ar2ChainIssues(b2c2a: Phase2C26B2C2AR1Authority, r1: Phase2C26B2C2AR2R1Authority): string[] {
  const issues: string[] = []
  const pairs: [string, string, string][] = [['b2c2aResultSha256', r1.b2c2aResultSha256, b2c2a.resultSha256], ['targetManifestSha256', r1.targetManifestSha256, b2c2a.targetManifestSha256],
    ['exportSha256', r1.exportSha256, b2c2a.exportSha256], ['b2c1ResultSha256', r1.b2c1ResultSha256, b2c2a.b2c1ResultSha256], ['b2b1ResultSha256', r1.b2b1ResultSha256, b2c2a.b2b1ResultSha256],
    ['b2b2aResultSha256', r1.b2b2aResultSha256, b2c2a.b2b2aResultSha256], ['b2b2a2ResultSha256', r1.b2b2a2ResultSha256, b2c2a.b2b2a2ResultSha256],
    ['oracleResultSha256', r1.oracleResultSha256, b2c2a.oracleResultSha256], ['oracleManifestFileSha256', r1.oracleManifestFileSha256, b2c2a.oracleManifestFileSha256],
    ['oracleManifestRoutesSha256', r1.oracleManifestRoutesSha256, b2c2a.oracleManifestRoutesSha256]]
  for (const [name, a, b] of pairs) if (a !== b) issues.push(`chain: the R1 ${name} is not the B2-C2A one`)
  const unmeasured = b2c2a.taskRows.filter(row => !(row.process === 'completed' && row.record === 'searched')).map(row => row.taskId).sort(compare)
  if (!same(r1.retryTaskIds, unmeasured)) issues.push(`chain: the R1 retry rows ${r1.retryTaskIds.join(',')} are not the B2-C2A unmeasured rows ${unmeasured.join(',')}`)
  const rowOf = new Map(b2c2a.taskRows.map(row => [row.taskId, row]))
  for (const retry of r1.retryRows) {
    const row = rowOf.get(retry.taskId)
    if (!row) { issues.push(`chain: ${retry.taskId}: no B2-C2A row`); continue }
    const drift = (['targetWeaponId', 'contextRank', 'groupIndex', 'reservationDigest', 'targetEligibleMinCardinality', 'representativeFixedSetId', 'representativeFixedTargetWeaponIds',
      'searchInputDigest', 'compatible'] as const).filter(key => !same(retry[key], row[key]))
    if (drift.length > 0) issues.push(`chain: ${retry.taskId}: ${drift.join(', ')} differ from the B2-C2A row`)
  }
  return issues
}

// ---------------------------------------------------------------- the still-unmeasured subset and the retry manifest

/**
 * The tasks that are still unmeasured after the R1 completion overlay: B2-C2A did not measure them (its child did not
 * complete with a Search record) and their R1 retry did not measure them either. Nothing else is read (no compatibility,
 * coverage, exact, first compatible rank, oracle operation cost, route kind, or another rank's exact). Sorted by task ID.
 * An originally unmeasured task without an R1 retry row is an inconsistency and throws.
 */
export function phase2c26b2c2ar2UnmeasuredTaskIds(taskRows: readonly Pick<Phase2C26B2C2AR1OriginalTaskRow, 'taskId' | 'process' | 'record'>[],
  r1RetryRows: readonly Pick<Phase2C26B2C2AR2R1RetryRow, 'taskId' | 'process' | 'record'>[]): string[] {
  const retryOf = new Map(r1RetryRows.map(row => [row.taskId, row]))
  const ids: string[] = []
  for (const row of taskRows) {
    if (row.process === 'completed' && row.record === 'searched') continue
    const retry = retryOf.get(row.taskId)
    if (retry === undefined) throw new Error(`${row.taskId} was unmeasured by B2-C2A and has no R1 retry row.`)
    if (!(retry.process === 'completed' && retry.record === 'searched')) ids.push(row.taskId)
  }
  return ids.sort(compare)
}

/** The retry manifest: task IDs and source hashes only. Throws unless the still-unmeasured subset is exactly the registered size. */
export function phase2c26b2c2ar2RetryManifest(b2c2a: Pick<Phase2C26B2C2AR1Authority, 'taskRows'>, r1: Pick<Phase2C26B2C2AR2R1Authority, 'resultSha256' | 'retryManifestSha256'
  | 'b2c2aResultSha256' | 'targetManifestSha256' | 'exportSha256' | 'retryRows'>): Phase2C26B2C2AR2RetryManifest {
  const taskIds = phase2c26b2c2ar2UnmeasuredTaskIds(b2c2a.taskRows, r1.retryRows)
  if (taskIds.length !== PHASE2C26B2C2AR2_EXPECTED_RETRY_TASKS) throw new Error(`The still-unmeasured subset holds ${taskIds.length} tasks, not ${PHASE2C26B2C2AR2_EXPECTED_RETRY_TASKS}.`)
  return { phase: 'Issue #154 Phase 2-C2.6-B2-C2A-R2 retry manifest (tasks unmeasured after the R1 completion overlay)', sourceR1ResultSha256: r1.resultSha256,
    sourceR1RetryManifestSha256: r1.retryManifestSha256, sourceB2C2AResultSha256: r1.b2c2aResultSha256, sourceTargetManifestSha256: r1.targetManifestSha256,
    exportSha256: r1.exportSha256, taskIds }
}
