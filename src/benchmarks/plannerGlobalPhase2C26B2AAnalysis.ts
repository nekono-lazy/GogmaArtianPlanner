/**
 * Issue #154 Phase 2-C2.6-B2-A post-hoc analysis only. It reads a finished B2-A context snapshot and, as explicit analyzer
 * arguments AFTER the snapshot run ended, the B1 RESULT (parity authority and B1 Search outcomes), the 1,657 oracle RESULT
 * and the oracle manifest (the exact operation segments). It runs no Search, no kernel and no Planner, and it feeds no
 * evidence into any calculation.
 *
 * The question is where a known feasible Route of the 1,657 proven minimum is lost by the current single-winner
 * Conflict-orientation portfolio machinery. For every oracle Route and every B1 pre-Search context of the same Target:
 *
 * - reservation compatibility with the Production primitives, never a re-implementation: the Skill / Gogma 5.6.8 coverage
 *   walk is `nextOperationPositions()` over `createCounterReservation()` (every position from the origin up to an own
 *   operation is held, the own position is not blocked), the predicted Normal creation is `heldPrefixNormalCreation()`
 *   (the canonical held-prefix creation must be the oracle's create segment, the production target not blocked), and
 *   the oracle source OwnedWeapon must not be an exclusive OwnedWeapon of the fixed Route set;
 * - the default extent, from the oracle Route's own reach from the Planner-start origin (cross-checked against the oracle
 *   RESULT `materialization.estimated` and, for a compatible context, against the same Production walk cut at the
 *   Production limit);
 * - the B1 outcome of that context (completed / timeout; consumer stop at the capture bound).
 *
 * Several causes may hold at once; nothing is forced into one exclusive class. The oracle is a post-hoc diagnostic fixture
 * of Issue #154, never a Production heuristic and never a game rule.
 */
import { stableStringify } from '../domain/models/hashing'
import { defaultPlannerAlternativeSearchExtent, type PlannerAlternativeReservation, type PlannerAlternativeSearchExtent } from '../domain/search'
import {
  createCounterReservation,
  EMPTY_COUNTER_RESERVATION,
  heldPrefixNormalCreation,
  nextOperationPositions,
  type CounterReservation,
} from '../domain/search/counterReservation'
import type { Phase2C2BaselineSummary } from './plannerGlobalPhase2C2'
import { PHASE2C26B1_BASELINE_FIELDS } from './plannerGlobalPhase2C26B1'
import type { Phase2C26B2ASnapshotRecord } from './plannerGlobalPhase2C26B2A'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}
const sortStrings = (values: Iterable<string>) => [...values].sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
const countBy = <T>(values: readonly T[], key: (value: T) => string): Record<string, number> => {
  const out: Record<string, number> = {}
  for (const value of values) out[key(value)] = (out[key(value)] ?? 0) + 1
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
}
const range = (from: number, toExclusive: number) => Array.from({ length: Math.max(0, toExclusive - from) }, (_, i) => from + i)
const noSkip = async () => {}

// ---------------------------------------------------------------- the oracle Route shape (structural; the manifest module is never imported)

/**
 * The structural shape of one manifest Route as the analyzer hands it in. This module never imports the oracle modules
 * (the Phase 2-A.5 isolation rule: no other Research module reads them); the analyzer loads the manifest from its file
 * argument after the snapshot run, and the shape is validated against the oracle RESULT before any judgement.
 */
export type Phase2C26B2AOperationType = 'create_normal_artian' | 'convert_normal_to_gogma' | 'reset_bonuses' | 'keep_bonuses' | 'reset_skills'
export type Phase2C26B2AStream = 'normal' | 'skill' | 'gogma'
export interface Phase2C26B2AOracleRouteSpec {
  targetWeaponId: string
  source: { kind: 'owned'; ownedWeaponId: string } | { kind: 'new_normal'; normalPosition: number }
  materialization: 'candidate_search' | 'planner_alternative_search'
  routeKind: string
  /** Closed position ranges; for create_normal_artian `from` is the first forge and `to` the production target. */
  operations: readonly { type: Phase2C26B2AOperationType; from: number; to: number }[]
  required: { normal: number | null; skill: readonly number[]; gogma: readonly number[] }
  estimated: { operations: number; normal: number | null; gogma: number | null; skill: number | null }
}
export interface Phase2C26B2AOperation { type: Phase2C26B2AOperationType; stream: Phase2C26B2AStream; position: number }

const STREAM_OF: Record<Phase2C26B2AOperationType, Phase2C26B2AStream> = {
  create_normal_artian: 'normal', convert_normal_to_gogma: 'skill', reset_skills: 'skill', reset_bonuses: 'gogma', keep_bonuses: 'gogma',
}

/** The exact operation segments expanded to one operation per consumed Counter position, in Route order (never first..last guessed). */
export function phase2c26b2aExpandSegments(segments: Phase2C26B2AOracleRouteSpec['operations']): Phase2C26B2AOperation[] {
  return segments.flatMap(segment => {
    if (!Number.isSafeInteger(segment.from) || !Number.isSafeInteger(segment.to) || segment.to < segment.from || !(segment.type in STREAM_OF)) {
      throw new RangeError(`Invalid oracle segment ${JSON.stringify(segment)}`)
    }
    return range(segment.from, segment.to + 1).map(position => ({ type: segment.type, stream: STREAM_OF[segment.type], position }))
  })
}

/** Closed integer ranges of a position set (sorted, deduplicated). Lossless; never a raw position array in the RESULT. */
export function phase2c26b2aRanges(values: Iterable<number>): [number, number][] {
  const out: [number, number][] = []
  for (const value of [...new Set(values)].sort((a, b) => a - b)) {
    const last = out.at(-1)
    if (last && value === last[1] + 1) last[1] = value
    else out.push([value, value])
  }
  return out
}

export function phase2c26b2aExpandRanges(ranges: readonly (readonly [number, number])[]): number[] {
  return ranges.flatMap(([a, b]) => range(a, b + 1))
}

/** The range form B1 recorded for a normalized reservation. */
export function phase2c26b2aReservationRanges(reservation: PlannerAlternativeReservation | null) {
  return reservation === null ? null : {
    normal: reservation.normal.map(n => ({ counterId: n.counterId, held: phase2c26b2aRanges(n.held), blocked: phase2c26b2aRanges(n.blocked) })),
    skill: { held: phase2c26b2aRanges(reservation.skill.held), blocked: phase2c26b2aRanges(reservation.skill.blocked) },
    gogma: { held: phase2c26b2aRanges(reservation.gogma.held), blocked: phase2c26b2aRanges(reservation.gogma.blocked) },
    exclusiveOwnedWeaponIds: [...reservation.exclusiveOwnedWeaponIds],
  }
}

// ---------------------------------------------------------------- B1 RESULT (authority)

/** The B1 result this phase is registered against. Any other value fails closed. */
export const PHASE2C26B2A_REGISTERED_B1 = {
  decisionCase: 'B1_M_measurement_complete',
  participants: { total: 34, explored: 34 },
  orientations: 54,
  contexts: 146,
  stage1: { runs: 136, completed: 116, timeout: 20, outOfMemory: 0, processFailure: 0 },
  fallback: { runs: 3, completed: 3 },
  oracle: { routes: 43, exact: 2, uncovered: 41 },
  captureBound: 8,
} as const

export type Phase2C26B2AB1SearchStatus = 'consumer_stop' | 'stopped_by_extent' | 'exhausted'

export interface Phase2C26B2AB1Context {
  orientationId: string
  kind: string
  workIndex: number
  targetWeaponId: string
  status: string
  contextDigest: string
  searchInputDigest: string
  taskId: string | null
  fixedRouteBuildListEntryIds: string[]
  excludedRouteKeySha256s: string[]
  reservation: unknown
}

export interface Phase2C26B2AB1Run {
  taskId: string
  executionClass: string
  process: string
  record: string | null
  searchStatus: Phase2C26B2AB1SearchStatus | null
  delivered: number | null
  candidateKeySha256s: string[]
}

export interface Phase2C26B2AB1OracleRow {
  targetWeaponId: string
  coverage: string
  coveredBy: string | null
  matchedStableKeySha256: string | null
  oracleHeldRoute: boolean | null
  conflictParticipant: boolean
}

export interface Phase2C26B2AB1Authority {
  measuredHead: string
  analysisHead: string
  exportSha256: string
  oracleSha256: string
  extent: unknown
  captureBound: number
  calculationContext: unknown
  researchMaxPlanSteps: number
  baselineSummary: Phase2C2BaselineSummary
  orientations: { orientationId: string; kind: string }[]
  contexts: Phase2C26B2AB1Context[]
  runs: Phase2C26B2AB1Run[]
  participants: string[]
  oracleRows: Phase2C26B2AB1OracleRow[]
}

const SEARCH_STATUSES: readonly string[] = ['consumer_stop', 'stopped_by_extent', 'exhausted']

/**
 * Reads the committed B1 RESULT as untrusted JSON and fails closed unless it is the registered formal result: formal,
 * no calculation change after its measured HEAD, case B1-M, 34 / 34 participants explored, Stage 1 136 / 116 / 20 with no
 * OOM or process failure, the fallback 3 / 3, oracle coverage 2 exact / 41 uncovered of 43, the 54 orientations and 146
 * contexts, and a readable run row for every B1 Search execution.
 */
export function parsePhase2C26B2AB1Authority(json: unknown): { valid: boolean; issues: string[]; authority: Phase2C26B2AB1Authority | null } {
  const issues: string[] = []
  const fail = (message: string) => ({ valid: false, issues: [...issues, message], authority: null })
  if (!isObject(json)) return fail('B1 RESULT is not an object')
  const { provenance, decision, stage1, fallback, conditions, participants, oracleCoverage, contexts, baseline } = json
  if (!isObject(provenance) || !isObject(decision) || !isObject(stage1) || !isObject(fallback) || !isObject(conditions) || !isObject(participants) || !isObject(oracleCoverage)
    || !isObject(contexts) || !isObject(baseline) || !isObject(baseline.summary)) return fail('B1 RESULT lacks provenance / decision / stage1 / fallback / conditions / participants / oracleCoverage / contexts / baseline.summary')
  const r = PHASE2C26B2A_REGISTERED_B1
  if (provenance.formal !== true) issues.push('provenance.formal is not true')
  if (!Array.isArray(provenance.calculationCodeChangedSinceMeasuredHead) || provenance.calculationCodeChangedSinceMeasuredHead.length !== 0) issues.push('provenance.calculationCodeChangedSinceMeasuredHead is not empty')
  for (const field of ['measuredHead', 'analysisHead'] as const) if (typeof provenance[field] !== 'string' || !/^[0-9a-f]{40}$/.test(provenance[field] as string)) issues.push(`provenance.${field} is not a commit SHA`)
  for (const field of ['exportSha256', 'oracleSha256'] as const) if (typeof provenance[field] !== 'string' || !/^[0-9a-f]{64}$/.test(provenance[field] as string)) issues.push(`provenance.${field} is not a SHA-256`)
  if (decision.case !== r.decisionCase) issues.push(`decision.case ${String(decision.case)} is not ${r.decisionCase}`)
  if (participants.total !== r.participants.total || participants.explored !== r.participants.explored) issues.push(`participants ${String(participants.explored)}/${String(participants.total)} is not ${r.participants.explored}/${r.participants.total}`)
  for (const [field, expected] of Object.entries(r.stage1)) if (stage1[field] !== expected) issues.push(`stage1.${field} ${String(stage1[field])} is not ${expected}`)
  for (const [field, expected] of Object.entries(r.fallback)) if (fallback[field] !== expected) issues.push(`fallback.${field} ${String(fallback[field])} is not ${expected}`)
  const totals = isObject(oracleCoverage.totals) ? oracleCoverage.totals : {}
  for (const [field, expected] of Object.entries(r.oracle)) if (totals[field] !== expected) issues.push(`oracleCoverage.totals.${field} ${String(totals[field])} is not ${expected}`)
  if (conditions.captureBound !== r.captureBound) issues.push(`conditions.captureBound is not ${r.captureBound}`)
  if (!isObject(conditions.extent) || !isObject(conditions.calculationContext) || typeof conditions.researchMaxPlanSteps !== 'number') issues.push('conditions.extent / calculationContext / researchMaxPlanSteps missing')

  const orientations: Phase2C26B2AB1Authority['orientations'] = []
  const contextRows: Phase2C26B2AB1Context[] = []
  for (const raw of asArray(contexts.perOrientation)) {
    if (!isObject(raw) || typeof raw.orientationId !== 'string' || typeof raw.kind !== 'string') { issues.push('a perOrientation row is malformed'); continue }
    orientations.push({ orientationId: raw.orientationId, kind: raw.kind })
    for (const c of asArray(raw.contexts)) {
      if (!isObject(c) || typeof c.workIndex !== 'number' || typeof c.targetWeaponId !== 'string' || typeof c.status !== 'string' || typeof c.contextDigest !== 'string'
        || typeof c.searchInputDigest !== 'string' || !Array.isArray(c.fixedRouteBuildListEntryIds) || !Array.isArray(c.excludedRouteKeySha256s)) { issues.push(`a context of ${raw.orientationId} is malformed`); continue }
      contextRows.push({ orientationId: raw.orientationId, kind: raw.kind, workIndex: c.workIndex, targetWeaponId: c.targetWeaponId, status: c.status, contextDigest: c.contextDigest,
        searchInputDigest: c.searchInputDigest, taskId: typeof c.taskId === 'string' ? c.taskId : null, fixedRouteBuildListEntryIds: c.fixedRouteBuildListEntryIds as string[],
        excludedRouteKeySha256s: c.excludedRouteKeySha256s as string[], reservation: c.reservation ?? null })
    }
  }
  if (orientations.length !== r.orientations) issues.push(`perOrientation has ${orientations.length} orientations, not ${r.orientations}`)
  if (new Set(orientations.map(o => o.orientationId)).size !== orientations.length) issues.push('perOrientation duplicates an orientation')
  if (contextRows.length !== r.contexts || contexts.derived !== r.contexts) issues.push(`contexts ${contextRows.length} (derived ${String(contexts.derived)}) is not ${r.contexts}`)

  const runs: Phase2C26B2AB1Run[] = []
  for (const raw of asArray(json.runs)) {
    const outcome = isObject(raw) && isObject(raw.outcome) ? raw.outcome : null
    if (!isObject(raw) || !outcome || typeof raw.taskId !== 'string' || typeof raw.executionClass !== 'string' || typeof outcome.process !== 'string') { issues.push('a run row is malformed'); continue }
    const searchStatus = outcome.searchStatus === null || outcome.searchStatus === undefined ? null : String(outcome.searchStatus)
    if (searchStatus !== null && !SEARCH_STATUSES.includes(searchStatus)) { issues.push(`run ${raw.taskId}: unknown search status ${searchStatus}`); continue }
    const search = isObject(raw.search) ? raw.search : null
    runs.push({ taskId: raw.taskId, executionClass: raw.executionClass, process: outcome.process, record: typeof outcome.record === 'string' ? outcome.record : null,
      searchStatus: searchStatus as Phase2C26B2AB1SearchStatus | null, delivered: typeof outcome.delivered === 'number' ? outcome.delivered : null,
      candidateKeySha256s: search ? asArray(search.candidates).map(x => isObject(x) && typeof x.stableKeySha256 === 'string' ? x.stableKeySha256 : '') : [] })
  }
  if (runs.filter(run => run.executionClass === 'stage1').length !== r.stage1.runs || runs.filter(run => run.executionClass === 'coverage_fallback').length !== r.fallback.runs) issues.push('the run rows are not the registered Stage 1 / fallback runs')
  if (runs.some(run => run.candidateKeySha256s.some(key => key === ''))) issues.push('a run Candidate has no stable key SHA-256')
  const participantIds = asArray(participants.rows).map(row => isObject(row) && typeof row.targetWeaponId === 'string' ? row.targetWeaponId : '')
  if (participantIds.length !== r.participants.total || participantIds.some(id => id === '')) issues.push('participants.rows is not the 34 participants')

  const oracleRows: Phase2C26B2AB1OracleRow[] = []
  for (const raw of asArray(oracleCoverage.targets)) {
    if (!isObject(raw) || typeof raw.targetWeaponId !== 'string' || typeof raw.coverage !== 'string' || typeof raw.conflictParticipant !== 'boolean') { issues.push('an oracle coverage row is malformed'); continue }
    oracleRows.push({ targetWeaponId: raw.targetWeaponId, coverage: raw.coverage, coveredBy: typeof raw.coveredBy === 'string' ? raw.coveredBy : null,
      matchedStableKeySha256: typeof raw.matchedStableKeySha256 === 'string' ? raw.matchedStableKeySha256 : null,
      oracleHeldRoute: typeof raw.oracleHeldRoute === 'boolean' ? raw.oracleHeldRoute : null, conflictParticipant: raw.conflictParticipant })
  }
  if (oracleRows.length !== r.oracle.routes) issues.push(`oracleCoverage.targets has ${oracleRows.length} rows, not ${r.oracle.routes}`)
  if (oracleRows.filter(row => row.coverage === 'exact').length !== r.oracle.exact || oracleRows.filter(row => row.coverage === 'uncovered').length !== r.oracle.uncovered) issues.push('oracleCoverage.targets do not add up to the registered totals')
  if (oracleRows.some(row => row.coverage === 'exact' && row.matchedStableKeySha256 === null)) issues.push('a covered oracle row names no matched Candidate')
  if (issues.length > 0) return { valid: false, issues, authority: null }
  return {
    valid: true, issues: [],
    authority: {
      measuredHead: String(provenance.measuredHead), analysisHead: String(provenance.analysisHead), exportSha256: String(provenance.exportSha256), oracleSha256: String(provenance.oracleSha256),
      extent: conditions.extent, captureBound: conditions.captureBound as number, calculationContext: conditions.calculationContext, researchMaxPlanSteps: conditions.researchMaxPlanSteps as number,
      baselineSummary: baseline.summary as unknown as Phase2C2BaselineSummary, orientations, contexts: contextRows, runs, participants: participantIds, oracleRows,
    },
  }
}

// ---------------------------------------------------------------- snapshot parity with B1

export interface Phase2C26B2AContextParity {
  valid: boolean
  issues: string[]
  exportSha256Matches: boolean
  baselineChecks: { field: string; matches: boolean }[]
  orientationOrderMatches: boolean
  contextCount: { snapshot: number; b1: number }
  contextMismatches: { orientationId: string; workIndex: number; fields: string[] }[]
  /** Every B1 Search task stands for exactly one searchInputDigest of this snapshot. */
  taskMappingMatches: boolean
  extentIsProductionDefault: boolean
  originsUniform: boolean
}

/**
 * The re-derived snapshot against B1, field by field and in order: Export, baseline, orientation order / kind, context
 * count, and per context its Target, status, contextDigest, searchInputDigest, fixed Route Entry IDs, normalized
 * reservation (B1's range form), excluded Route key SHA-256s, task mapping and the default extent. Never fills a field in.
 */
export function validatePhase2C26B2AContextParity(snapshot: Phase2C26B2ASnapshotRecord & { exportSha256: string; calculationContext: unknown; researchMaxPlanSteps: number },
  authority: Phase2C26B2AB1Authority, sha: (value: string) => string): Phase2C26B2AContextParity {
  const issues: string[] = []
  const exportSha256Matches = snapshot.exportSha256 === authority.exportSha256
  if (!exportSha256Matches) issues.push('Export SHA-256 differs from the B1 Export')
  const baselineChecks = PHASE2C26B1_BASELINE_FIELDS.map(field => ({ field, matches: field === 'selectedTargets' || field === 'conflictSignatures'
    ? same([...(snapshot.baseline.summary[field] ?? [])].sort(), [...(authority.baselineSummary[field] ?? [])].sort()) : same(snapshot.baseline.summary[field], authority.baselineSummary[field]) }))
  for (const check of baselineChecks) if (!check.matches) issues.push(`baseline.${check.field} differs`)
  const orientationOrderMatches = same(snapshot.baseline.orientations.map(o => [o.orientationId, o.kind]), authority.orientations.map(o => [o.orientationId, o.kind]))
  if (!orientationOrderMatches) issues.push('orientation order / kind differs')
  if (!same(snapshot.calculationContext, authority.calculationContext)) issues.push('CalculationContext differs')
  if (snapshot.researchMaxPlanSteps !== authority.researchMaxPlanSteps) issues.push('Research maxPlanSteps differs')
  const contextMismatches: Phase2C26B2AContextParity['contextMismatches'] = []
  const length = Math.max(snapshot.contexts.length, authority.contexts.length)
  for (let index = 0; index < length; index += 1) {
    const mine = snapshot.contexts[index], b1 = authority.contexts[index]
    if (!mine || !b1) { contextMismatches.push({ orientationId: (mine ?? b1)!.orientationId, workIndex: (mine ?? b1)!.workIndex, fields: ['missing'] }); continue }
    const fields: string[] = []
    if (mine.orientationId !== b1.orientationId || mine.workIndex !== b1.workIndex) fields.push('position')
    for (const field of ['targetWeaponId', 'status', 'contextDigest', 'searchInputDigest'] as const) if (mine[field] !== b1[field]) fields.push(field)
    if (!same(mine.fixedRouteBuildListEntryIds, b1.fixedRouteBuildListEntryIds)) fields.push('fixedRouteBuildListEntryIds')
    if (!same(phase2c26b2aReservationRanges(mine.reservation), b1.reservation)) fields.push('reservation')
    if (!same(mine.excludedRouteKeys.map(sha), b1.excludedRouteKeySha256s)) fields.push('excludedRouteKeys')
    if (!same(mine.extent, authority.extent)) fields.push('extent')
    if (fields.length > 0) contextMismatches.push({ orientationId: b1.orientationId, workIndex: b1.workIndex, fields })
  }
  if (snapshot.contexts.length !== authority.contexts.length) issues.push(`context count ${snapshot.contexts.length} is not B1 ${authority.contexts.length}`)
  if (contextMismatches.length > 0) issues.push(`context fields differ: ${contextMismatches.slice(0, 10).map(m => `${m.orientationId}#${m.workIndex}(${m.fields.join('/')})`).join(', ')}`)
  const taskByDigest = new Map<string, Set<string | null>>()
  const digestByTask = new Map<string | null, Set<string>>()
  snapshot.contexts.forEach((context, index) => {
    const taskId = authority.contexts[index]?.taskId ?? null
    taskByDigest.set(context.searchInputDigest, (taskByDigest.get(context.searchInputDigest) ?? new Set()).add(taskId))
    digestByTask.set(taskId, (digestByTask.get(taskId) ?? new Set()).add(context.searchInputDigest))
  })
  const taskMappingMatches = [...taskByDigest.values()].every(set => set.size === 1 && !set.has(null)) && [...digestByTask.values()].every(set => set.size === 1)
  if (!taskMappingMatches) issues.push('the B1 task IDs are not a bijection with the snapshot searchInputDigests')
  const extentIsProductionDefault = same(authority.extent, { ...defaultPlannerAlternativeSearchExtent }) && snapshot.contexts.every(c => same(c.extent, { ...defaultPlannerAlternativeSearchExtent }))
  if (!extentIsProductionDefault) issues.push('the extent is not the Production default extent')
  const originsUniform = snapshot.contexts.every(c => same(c.origin, snapshot.contexts[0]?.origin) && c.originDigest === snapshot.contexts[0]?.originDigest)
  if (!originsUniform) issues.push('the contexts do not share one Planner-start origin')
  return { valid: issues.length === 0, issues, exportSha256Matches, baselineChecks, orientationOrderMatches, contextCount: { snapshot: snapshot.contexts.length, b1: authority.contexts.length },
    contextMismatches, taskMappingMatches, extentIsProductionDefault, originsUniform }
}

// ---------------------------------------------------------------- the oracle (post-hoc fixture only)

interface OracleStreamJson { first: number | null; last: number | null; operations: number; required?: number[] }
export interface Phase2C26B2AOracleRouteJson {
  targetWeaponId: string
  weaponTypeId: string
  sourceKind: string
  sourceOwnedWeaponId: string | null
  normalPosition: number | null
  conversionPosition: number | null
  normal: OracleStreamJson | null
  gogma: OracleStreamJson | null
  skill: OracleStreamJson | null
  routeOperationCount: number
  materialization: { method: string; routeKind: string; estimated: { operations: number; normal: number | null; gogma: number | null; skill: number | null }; plannerRequired: { normal: number | null; skill: number[]; gogma: number[] } }
}
interface OracleUsageJson { position: number; targetWeaponId: string; type: string; required: boolean }
export interface Phase2C26B2AOracle {
  exportSha256: string
  routes: Phase2C26B2AOracleRouteJson[]
  gogmaUsage: OracleUsageJson[]
  requiredSkillUsage: OracleUsageJson[]
  requiredNormalUsage: Record<string, OracleUsageJson[]>
  summary: { skill: { start: number; end: number }; gogma: { start: number; end: number }; normal: Record<string, { start: number; end: number }>; physicalOperations: number }
  manifestSha256: string
}

/** The oracle RESULT as untrusted JSON: the proven 1,657 minimum, 43 / 43 completed, Conflict 0, valid Trace Replay. */
export function parsePhase2C26B2AOracle(json: unknown): { valid: boolean; issues: string[]; oracle: Phase2C26B2AOracle | null } {
  const issues: string[] = []
  if (!isObject(json) || !isObject(json.environment) || !isObject(json.summary) || !isObject(json.summary.stageC) || !isObject(json.hashes)) return { valid: false, issues: ['oracle RESULT is malformed'], oracle: null }
  const summary = json.summary, stageC = json.summary.stageC as Json
  const termination = isObject(stageC.termination) ? stageC.termination : {}
  const trace = isObject(stageC.traceReplay) ? stageC.traceReplay : {}
  if (json.verdict !== 'proven_minimum') issues.push(`verdict ${String(json.verdict)} is not proven_minimum`)
  if (summary.targets !== 43) issues.push('summary.targets is not 43')
  if (summary.physicalOperations !== 1657 || stageC.physicalSteps !== 1657) issues.push('physical operations are not 1657')
  if (stageC.conflicts !== 0) issues.push('the oracle Plan holds a Conflict')
  if (termination.completedTargetCount !== 43 || termination.totalTargetCount !== 43 || termination.status !== 'completed') issues.push('the oracle Plan does not complete 43 / 43')
  if (trace.isValid !== true) issues.push('the oracle Trace Replay is not valid')
  if (typeof json.environment.exportSha256 !== 'string') issues.push('environment.exportSha256 missing')
  const routes = asArray(json.routes) as Phase2C26B2AOracleRouteJson[]
  if (routes.length !== 43 || routes.some(r => !isObject(r) || typeof r.targetWeaponId !== 'string' || !isObject(r.materialization))) issues.push('routes are not 43 readable Routes')
  if (issues.length > 0) return { valid: false, issues, oracle: null }
  return { valid: true, issues: [], oracle: {
    exportSha256: String(json.environment.exportSha256), routes, gogmaUsage: asArray(json.gogmaUsage) as OracleUsageJson[], requiredSkillUsage: asArray(json.requiredSkillUsage) as OracleUsageJson[],
    requiredNormalUsage: (isObject(json.requiredNormalUsage) ? json.requiredNormalUsage : {}) as Record<string, OracleUsageJson[]>,
    summary: summary as unknown as Phase2C26B2AOracle['summary'], manifestSha256: String(json.hashes.manifestSha256),
  } }
}

export const normalCounterIdOf = (weaponTypeId: string) => `${weaponTypeId}:8`

/** One oracle Route in the lane form the audit reads, from the manifest segments (the authority) and the RESULT's weapon type. */
export interface Phase2C26B2ARouteView {
  targetWeaponId: string
  weaponTypeId: string
  normalCounterId: string
  sourceKind: 'owned' | 'new_normal'
  sourceOwnedWeaponId: string | null
  method: string
  operations: Phase2C26B2AOperation[]
  /** Own positions per lane, ascending: Normal forges, the Skill lane (conversion first), the Bonus lane. */
  normal: number[]
  conversion: number | null
  skill: number[]
  gogma: number[]
  required: { normal: number | null; skill: number[]; gogma: number[] }
  estimated: { operations: number; normal: number | null; gogma: number | null; skill: number | null }
  /** Phase 2-C2's definition: an own lane spreads over a position it does not operate on. */
  oracleHeldRoute: boolean
}

export function phase2c26b2aRouteView(spec: Phase2C26B2AOracleRouteSpec, weaponTypeId: string): Phase2C26B2ARouteView {
  const operations = phase2c26b2aExpandSegments(spec.operations)
  const lane = (stream: Phase2C26B2AStream) => operations.filter(op => op.stream === stream).map(op => op.position)
  const normal = lane('normal'), skill = lane('skill'), gogma = lane('gogma')
  for (const [name, positions] of [['normal', normal], ['skill', skill], ['gogma', gogma]] as const) {
    if (positions.some((p, i) => i > 0 && p <= positions[i - 1]!)) throw new Error(`Oracle Route ${spec.targetWeaponId}: the ${name} lane is not strictly ascending.`)
  }
  const conversions = operations.filter(op => op.type === 'convert_normal_to_gogma')
  if (conversions.length > 1 || (conversions.length === 1 && skill[0] !== conversions[0]!.position)) throw new Error(`Oracle Route ${spec.targetWeaponId}: the conversion is not the first Skill lane operation.`)
  const spread = (positions: number[]) => positions.length > 0 && positions[positions.length - 1]! - positions[0]! + 1 > positions.length
  return {
    targetWeaponId: spec.targetWeaponId, weaponTypeId, normalCounterId: normalCounterIdOf(weaponTypeId), sourceKind: spec.source.kind,
    sourceOwnedWeaponId: spec.source.kind === 'owned' ? spec.source.ownedWeaponId : null, method: spec.materialization, operations, normal, conversion: conversions[0]?.position ?? null,
    skill, gogma, required: { normal: spec.required.normal, skill: [...spec.required.skill], gogma: [...spec.required.gogma] }, estimated: spec.estimated, oracleHeldRoute: spread(gogma) || spread(skill),
  }
}

export interface Phase2C26B2AOracleConsistency { valid: boolean; issues: string[]; checkedRoutes: number; gogmaUsage: number; requiredSkillUsage: number; requiredNormalUsage: number }

/**
 * The manifest (exact operation segments) against the oracle RESULT, per Route and per stream: source, Normal target,
 * conversion position, first / last / operation count, required positions (the manifest's against the RESULT's Planner
 * `plannerRequired`, taken by the oracle run from `createPlannerRouteUnitPlans()`, and the per-stream `required`), Route
 * kind, method and estimates, the
 * full Gogma usage, the required Skill / Normal usage, the stream spans and the physical operation count.
 */
export function validatePhase2C26B2AOracleManifest(manifest: readonly Phase2C26B2AOracleRouteSpec[], oracle: Phase2C26B2AOracle, manifestShaMatches: boolean): Phase2C26B2AOracleConsistency {
  const issues: string[] = []
  if (!manifestShaMatches) issues.push('the manifest does not hash to the oracle RESULT manifestSha256')
  const byTarget = new Map(oracle.routes.map(route => [route.targetWeaponId, route]))
  if (manifest.length !== oracle.routes.length || byTarget.size !== oracle.routes.length || new Set(manifest.map(r => r.targetWeaponId)).size !== manifest.length) issues.push('the manifest and the RESULT do not list the same Routes once each')
  const gogmaUsage: OracleUsageJson[] = [], skillUsage: OracleUsageJson[] = [], normalUsage: Record<string, OracleUsageJson[]> = {}
  const streamPositions: Record<string, number[]> = {}
  for (const spec of manifest) {
    const route = byTarget.get(spec.targetWeaponId)
    if (!route) { issues.push(`${spec.targetWeaponId}: not in the RESULT`); continue }
    let view: Phase2C26B2ARouteView
    try { view = phase2c26b2aRouteView(spec, route.weaponTypeId) } catch (error) { issues.push((error as Error).message); continue }
    const fail = (field: string) => issues.push(`${spec.targetWeaponId}: ${field} differs`)
    const derived = view.required
    if (!same(route.materialization.plannerRequired, spec.required)) fail('plannerRequired vs manifest required')
    if (route.sourceKind !== spec.source.kind || route.sourceOwnedWeaponId !== view.sourceOwnedWeaponId) fail('source')
    if (route.normalPosition !== (spec.source.kind === 'new_normal' ? spec.source.normalPosition : null) || (spec.source.kind === 'new_normal' && view.normal.at(-1) !== spec.source.normalPosition)) fail('normalPosition')
    if (route.conversionPosition !== view.conversion) fail('conversionPosition')
    for (const stream of ['normal', 'gogma', 'skill'] as const) {
      const positions = view[stream], json = route[stream]
      const recorded = json === null ? { first: null, last: null, operations: 0 } : { first: json.first, last: json.last, operations: json.operations }
      if (!same(recorded, { first: positions[0] ?? null, last: positions.at(-1) ?? null, operations: positions.length })) fail(`${stream} first / last / operations`)
      if (stream !== 'normal' && json !== null && json.operations > 0 && !same([...(json.required ?? [])].sort((a, b) => a - b), [...spec.required[stream]].sort((a, b) => a - b))) fail(`${stream} required`)
    }
    if (route.routeOperationCount !== view.operations.length || route.materialization.estimated.operations !== view.operations.length) fail('operation count')
    if (route.materialization.method !== spec.materialization || route.materialization.routeKind !== spec.routeKind || !same(route.materialization.estimated, spec.estimated)) fail('materialization')
    for (const op of view.operations) {
      const key = op.stream === 'normal' ? `normal\u0000${view.normalCounterId}` : op.stream
      ;(streamPositions[key] ??= []).push(op.position)
    }
    for (const op of view.operations.filter(op => op.stream === 'gogma')) gogmaUsage.push({ position: op.position, targetWeaponId: spec.targetWeaponId, type: op.type, required: derived.gogma.includes(op.position) })
    for (const op of view.operations.filter(op => op.stream === 'skill' && derived.skill.includes(op.position))) skillUsage.push({ position: op.position, targetWeaponId: spec.targetWeaponId, type: op.type, required: true })
    if (derived.normal !== null) (normalUsage[view.normalCounterId] ??= []).push({ position: derived.normal, targetWeaponId: spec.targetWeaponId, type: 'create_normal_artian', required: true })
  }
  const key = (u: OracleUsageJson) => `${String(u.position).padStart(8, '0')}\u0000${u.targetWeaponId}\u0000${u.type}\u0000${u.required}`
  const sameUsage = (a: readonly OracleUsageJson[], b: readonly OracleUsageJson[]) => same(a.map(key).sort(), b.map(key).sort())
  if (!sameUsage(gogmaUsage, oracle.gogmaUsage)) issues.push('gogmaUsage differs from the manifest expansion')
  if (!sameUsage(skillUsage, oracle.requiredSkillUsage)) issues.push('requiredSkillUsage differs from the manifest expansion')
  if (!same(sortStrings(Object.keys(normalUsage)), sortStrings(Object.keys(oracle.requiredNormalUsage)))
    || Object.keys(normalUsage).some(id => !sameUsage(normalUsage[id]!, oracle.requiredNormalUsage[id] ?? []))) issues.push('requiredNormalUsage differs from the manifest expansion')
  // Every stream span is covered without a gap, and the physical count is the sum of the stream advances.
  let physical = 0
  const span = (name: string, positions: number[] | undefined, start: number, end: number) => {
    const set = new Set(positions ?? [])
    physical += end - start
    if (set.size === 0 || Math.min(...set) !== start || Math.max(...set) !== end - 1 || set.size !== end - start) issues.push(`${name}: the oracle operations do not cover [${start}, ${end}) without a gap`)
  }
  span('skill', streamPositions.skill, oracle.summary.skill.start, oracle.summary.skill.end)
  span('gogma', streamPositions.gogma, oracle.summary.gogma.start, oracle.summary.gogma.end)
  for (const [counterId, s] of Object.entries(oracle.summary.normal)) span(counterId, streamPositions[`normal\u0000${counterId}`], s.start, s.end)
  if (Object.keys(streamPositions).filter(k => k.startsWith('normal\u0000')).length !== Object.keys(oracle.summary.normal).length) issues.push('the Normal Counters used differ from summary.normal')
  if (physical !== oracle.summary.physicalOperations) issues.push(`the stream advances sum to ${physical}, not ${oracle.summary.physicalOperations}`)
  return { valid: issues.length === 0, issues, checkedRoutes: manifest.length, gogmaUsage: gogmaUsage.length, requiredSkillUsage: skillUsage.length,
    requiredNormalUsage: Object.values(normalUsage).flat().length }
}

// ---------------------------------------------------------------- extent (the Route's own reach from the origin)

export type Phase2C26B2AExtentVerdict = 'within_default_extent' | 'requires_larger_extent' | 'not_applicable'

export interface Phase2C26B2AOrigins { skill: number; gogma: number; normal: number | null }

export interface Phase2C26B2ARouteExtent {
  reach: { normal: number | null; gogma: number; skill: number }
  /** The Production extent value this Route needs on each stream (Skill: one less for a conversion Route). */
  required: { normal: number | null; gogma: number | null; skill: number | null }
  verdict: Record<Phase2C26B2AStream, Phase2C26B2AExtentVerdict>
  withinDefaultExtent: boolean
  /** The oracle RESULT `materialization.estimated` reproduced from the origin and the manifest positions. */
  estimatedMatches: boolean
}

/**
 * Reach = last own position - origin + 1 (0 / null without an own operation), exactly the advances the Candidate
 * estimates. A Gogma operation must stand below origin + maxGogmaAdvance; a Reset Skills of an existing Gogma below
 * origin + maxSkillAdvance, a conversion Route's Skill lane below origin + maxSkillAdvance + 1; a production target
 * at offset < maxNormalAdvance.
 */
export function phase2c26b2aRouteExtent(route: Phase2C26B2ARouteView, origins: Phase2C26B2AOrigins, extent: PlannerAlternativeSearchExtent): Phase2C26B2ARouteExtent {
  const last = (positions: number[]) => positions.at(-1)
  const gogmaReach = route.gogma.length === 0 ? 0 : last(route.gogma)! - origins.gogma + 1
  const skillReach = route.skill.length === 0 ? 0 : last(route.skill)! - origins.skill + 1
  const normalReach = route.sourceKind === 'new_normal' ? (origins.normal === null ? null : last(route.normal)! - origins.normal + 1) : null
  const required = {
    normal: normalReach,
    gogma: route.gogma.length === 0 ? null : gogmaReach,
    skill: route.skill.length === 0 ? null : route.conversion === null ? skillReach : skillReach - 1,
  }
  const judge = (need: number | null, limit: number): Phase2C26B2AExtentVerdict => need === null ? 'not_applicable' : need <= limit ? 'within_default_extent' : 'requires_larger_extent'
  const verdict = { normal: judge(required.normal, extent.maxNormalAdvance), gogma: judge(required.gogma, extent.maxGogmaAdvance), skill: judge(required.skill, extent.maxSkillAdvance) }
  const estimatedMatches = route.estimated.normal === normalReach && route.estimated.gogma === gogmaReach && route.estimated.skill === skillReach && route.estimated.operations === route.operations.length
  return { reach: { normal: normalReach, gogma: gogmaReach, skill: skillReach }, required, verdict,
    withinDefaultExtent: Object.values(verdict).every(v => v !== 'requires_larger_extent'), estimatedMatches }
}

// ---------------------------------------------------------------- reservation compatibility (Production primitives)

export interface Phase2C26B2ALaneCheck {
  compatible: boolean
  /** Positions the Route leaves (from the origin through its last own operation) that the context does not hold. */
  missingHeld: number[]
  /** Own operation positions the context blocks. */
  blockedOwn: number[]
  /** Normal only: positions the oracle forges itself that the canonical held-prefix creation leaves to the fixed Routes. */
  heldPrefixOverlap: number[]
  /** For a compatible lane: the same walk cut at the Production extent limit accepts every own position. */
  productionLimitAccepts: boolean | null
  /** The primitive verdict and the decomposition (missing held / blocked / overlap) disagree: an audit inconsistency. */
  inconsistent: boolean
}

/**
 * One Skill or Gogma lane: from the origin, each own operation must be a legal position of `nextOperationPositions()`
 * from the position right after the previous own operation (5.6.8 coverage). The decomposition into missing held and
 * blocked positions is checked against the primitive's own verdict.
 */
export async function phase2c26b2aLaneCheck(reservation: CounterReservation, origin: number, positions: readonly number[], limit: number): Promise<Phase2C26B2ALaneCheck> {
  let from = origin, compatible = true, inconsistent = false
  const missingHeld: number[] = [], blockedOwn: number[] = []
  for (const position of positions) {
    if (position < from) throw new Error(`Lane position ${position} stands before ${from}.`)
    const window = await nextOperationPositions(reservation, from, Number.MAX_SAFE_INTEGER, noSkip)
    const accepted = window.positions.includes(position)
    const gaps = range(from, position).filter(p => !reservation.isHeld(p))
    const blocked = reservation.isBlocked(position)
    if (accepted !== (gaps.length === 0 && !blocked)) inconsistent = true
    if (!accepted) compatible = false
    missingHeld.push(...gaps)
    if (blocked) blockedOwn.push(position)
    from = position + 1
  }
  let productionLimitAccepts: boolean | null = null
  if (compatible) {
    productionLimitAccepts = true
    from = origin
    for (const position of positions) {
      const window = await nextOperationPositions(reservation, from, limit, noSkip)
      if (!window.positions.includes(position)) { productionLimitAccepts = false; break }
      from = position + 1
    }
  }
  return { compatible, missingHeld, blockedOwn, heldPrefixOverlap: [], productionLimitAccepts, inconsistent }
}

/**
 * The Normal lane of a new-Normal Route: the canonical `heldPrefixNormalCreation()` from the origin to the oracle's own
 * production target must be the oracle create segment, and the production target must not be blocked.
 */
export function phase2c26b2aNormalCheck(reservation: CounterReservation, origin: number, forges: readonly number[], maxNormalAdvance: number): Phase2C26B2ALaneCheck {
  const from = forges[0]!, target = forges.at(-1)!
  if (forges.length !== target - from + 1) throw new Error('An oracle create segment is not contiguous.')
  if (from < origin) throw new Error(`An oracle create segment starts at ${from}, before the origin ${origin}.`)
  const canonical = heldPrefixNormalCreation(reservation, origin, target)
  const blocked = reservation.isBlocked(target)
  const compatible = !blocked && canonical.normalCounterBefore === from && canonical.normalCounterAfter === target + 1 && canonical.count === forges.length
  const missingHeld = range(origin, from).filter(p => !reservation.isHeld(p))
  const heldPrefixOverlap = canonical.normalCounterBefore > from ? range(from, canonical.normalCounterBefore) : []
  const inconsistent = compatible !== (!blocked && missingHeld.length === 0 && heldPrefixOverlap.length === 0)
  return { compatible, missingHeld, blockedOwn: blocked ? [target] : [], heldPrefixOverlap, productionLimitAccepts: compatible ? target - origin < maxNormalAdvance : null, inconsistent }
}

export type Phase2C26B2AIncompatibility = 'exclusive_owned_weapon_conflict' | 'blocked_position_conflict' | 'held_coverage_gap' | 'normal_held_prefix_mismatch'

export interface Phase2C26B2AReachability {
  compatible: boolean
  reasons: Phase2C26B2AIncompatibility[]
  exclusiveOwnedWeaponConflict: boolean
  lanes: { normal: Phase2C26B2ALaneCheck | null; skill: Phase2C26B2ALaneCheck | null; gogma: Phase2C26B2ALaneCheck | null }
  /** The compatible Route also passes the Production walk cut at the extent limit (null when incompatible). */
  productionLimitAccepts: boolean | null
  inconsistent: boolean
}

/** One oracle Route under one context reservation (an empty reservation when `reservation` is null). */
export async function phase2c26b2aReachability(route: Phase2C26B2ARouteView, reservation: PlannerAlternativeReservation | null, origins: Phase2C26B2AOrigins,
  extent: PlannerAlternativeSearchExtent): Promise<Phase2C26B2AReachability> {
  const skillRes = reservation === null ? EMPTY_COUNTER_RESERVATION : createCounterReservation(reservation.skill.held, reservation.skill.blocked)
  const gogmaRes = reservation === null ? EMPTY_COUNTER_RESERVATION : createCounterReservation(reservation.gogma.held, reservation.gogma.blocked)
  const normalEntry = reservation?.normal.find(n => n.counterId === route.normalCounterId)
  const normalRes = normalEntry ? createCounterReservation(normalEntry.held, normalEntry.blocked) : EMPTY_COUNTER_RESERVATION
  const exclusiveOwnedWeaponConflict = route.sourceOwnedWeaponId !== null && (reservation?.exclusiveOwnedWeaponIds ?? []).some(id => id === route.sourceOwnedWeaponId)
  const skillLimit = route.conversion === null ? origins.skill + extent.maxSkillAdvance : origins.skill + extent.maxSkillAdvance + 1
  const lanes = {
    normal: route.sourceKind === 'new_normal' ? phase2c26b2aNormalCheck(normalRes, origins.normal!, route.normal, extent.maxNormalAdvance) : null,
    skill: route.skill.length > 0 ? await phase2c26b2aLaneCheck(skillRes, origins.skill, route.skill, skillLimit) : null,
    gogma: route.gogma.length > 0 ? await phase2c26b2aLaneCheck(gogmaRes, origins.gogma, route.gogma, origins.gogma + extent.maxGogmaAdvance) : null,
  }
  const all = [lanes.normal, lanes.skill, lanes.gogma].filter((lane): lane is Phase2C26B2ALaneCheck => lane !== null)
  const reasons: Phase2C26B2AIncompatibility[] = []
  if (exclusiveOwnedWeaponConflict) reasons.push('exclusive_owned_weapon_conflict')
  if (all.some(lane => lane.blockedOwn.length > 0)) reasons.push('blocked_position_conflict')
  if (all.some(lane => lane.missingHeld.length > 0)) reasons.push('held_coverage_gap')
  if (all.some(lane => lane.heldPrefixOverlap.length > 0)) reasons.push('normal_held_prefix_mismatch')
  const compatible = !exclusiveOwnedWeaponConflict && all.every(lane => lane.compatible)
  return { compatible, reasons, exclusiveOwnedWeaponConflict, lanes,
    productionLimitAccepts: compatible ? all.every(lane => lane.productionLimitAccepts === true) : null,
    inconsistent: all.some(lane => lane.inconsistent) || compatible !== (reasons.length === 0) }
}

// ---------------------------------------------------------------- oracle support (who covers the positions a Route leaves)

export interface Phase2C26B2ASupport {
  /** Positions the Route itself leaves, per stream (from the origin through its last own operation; Normal: before its create segment). */
  needed: { normal: number[]; skill: number[]; gogma: number[] }
  /** Per needed position: the other Target whose required unit stands there, else the only other Target operating there. */
  supportTargetWeaponIds: string[]
  /** Needed positions with several other operating Targets and no required unit (executor not fixed by the manifest). */
  ambiguousPositions: number
  ambiguousCandidateTargetWeaponIds: string[]
  /** Needed positions no other oracle Route operates on: impossible in a gap-free oracle (an audit inconsistency). */
  unsupportedPositions: number
  /** Other oracle Routes that alone operate on every needed position (a single carrier of the whole span). */
  singleRouteCoverTargetWeaponIds: string[]
  providers: number
  providerBucket: '0' | '1' | '2+'
}

type Occupancy = Map<string, Map<number, { targetWeaponId: string; required: boolean }[]>>

/** Every oracle Route unit by stream key (`skill`, `gogma`, `normal\u0000<counterId>`) and position. */
export function phase2c26b2aOccupancy(routes: readonly Phase2C26B2ARouteView[]): Occupancy {
  const out: Occupancy = new Map()
  for (const route of routes) {
    for (const op of route.operations) {
      const key = op.stream === 'normal' ? `normal\u0000${route.normalCounterId}` : op.stream
      const stream = out.get(key) ?? new Map()
      const required = op.stream === 'normal' ? route.required.normal === op.position : route.required[op.stream].includes(op.position)
      stream.set(op.position, [...(stream.get(op.position) ?? []), { targetWeaponId: route.targetWeaponId, required }])
      out.set(key, stream)
    }
  }
  return out
}

export function phase2c26b2aSupport(route: Phase2C26B2ARouteView, origins: Phase2C26B2AOrigins, occupancy: Occupancy): Phase2C26B2ASupport {
  const leftBetween = (origin: number, own: readonly number[]) => own.length === 0 ? [] : range(origin, own.at(-1)!).filter(p => !own.includes(p))
  const needed = {
    normal: route.sourceKind === 'new_normal' && origins.normal !== null ? range(origins.normal, route.normal[0]!) : [],
    skill: leftBetween(origins.skill, route.skill),
    gogma: leftBetween(origins.gogma, route.gogma),
  }
  const support = new Set<string>(), ambiguous = new Set<string>()
  let ambiguousPositions = 0, unsupportedPositions = 0
  const perPositionOperators: Set<string>[] = []
  const visit = (key: string, positions: number[]) => {
    for (const position of positions) {
      const others = (occupancy.get(key)?.get(position) ?? []).filter(u => u.targetWeaponId !== route.targetWeaponId)
      perPositionOperators.push(new Set(others.map(u => u.targetWeaponId)))
      const required = others.filter(u => u.required)
      if (required.length >= 1) required.forEach(u => support.add(u.targetWeaponId))
      else if (others.length === 1) support.add(others[0]!.targetWeaponId)
      else if (others.length === 0) unsupportedPositions += 1
      else { ambiguousPositions += 1; others.forEach(u => ambiguous.add(u.targetWeaponId)) }
    }
  }
  visit(`normal\u0000${route.normalCounterId}`, needed.normal)
  visit('skill', needed.skill)
  visit('gogma', needed.gogma)
  const candidates = perPositionOperators.length === 0 ? [] : [...perPositionOperators[0]!].filter(id => perPositionOperators.every(set => set.has(id)))
  const providers = new Set([...support, ...ambiguous]).size
  return { needed, supportTargetWeaponIds: sortStrings(support), ambiguousPositions, ambiguousCandidateTargetWeaponIds: sortStrings(ambiguous), unsupportedPositions,
    singleRouteCoverTargetWeaponIds: sortStrings(candidates), providers, providerBucket: providers === 0 ? '0' : providers === 1 ? '1' : '2+' }
}

// ---------------------------------------------------------------- B1 context outcome

export interface Phase2C26B2AB1ContextOutcome {
  taskId: string | null
  /** consumer_stop / stopped_by_extent / exhausted when some run of the task completed; otherwise the Stage 1 failure. */
  status: Phase2C26B2AB1SearchStatus | 'timeout' | 'out_of_memory' | 'process_failure' | 'context_mismatch' | 'not_searched'
  completed: boolean
  completedBy: string | null
  delivered: number | null
  /** Every run of the task, in order: `<executionClass>:<status>`. */
  runs: string[]
  keySha256s: string[]
}

export function phase2c26b2aB1ContextOutcome(taskId: string | null, runs: readonly Phase2C26B2AB1Run[]): Phase2C26B2AB1ContextOutcome {
  const own = runs.filter(run => taskId !== null && run.taskId === taskId)
  const isCompleted = (run: Phase2C26B2AB1Run) => run.process === 'completed' && run.record === 'searched' && run.searchStatus !== null
  const labels = own.map(run => `${run.executionClass}:${isCompleted(run) ? run.searchStatus : run.record === 'context_mismatch' ? 'context_mismatch' : run.process}`)
  const completed = own.find(isCompleted)
  if (completed) return { taskId, status: completed.searchStatus!, completed: true, completedBy: completed.executionClass, delivered: completed.delivered, runs: labels, keySha256s: completed.candidateKeySha256s }
  const first = own[0]
  const status = !first ? 'not_searched' : first.record === 'context_mismatch' ? 'context_mismatch'
    : (['timeout', 'out_of_memory', 'process_failure'].includes(first.process) ? first.process : 'process_failure') as Phase2C26B2AB1ContextOutcome['status']
  return { taskId, status, completed: false, completedBy: null, delivered: null, runs: labels, keySha256s: [] }
}

// ---------------------------------------------------------------- per (oracle Route, context) classification

export type Phase2C26B2AContextClass =
  | 'observed'
  | 'default_context_unfinished'
  | 'capture_or_ordering_unresolved'
  | 'extent_insufficient'
  | 'eligible_but_not_observed'
  | 'reservation_incompatible'

export const PHASE2C26B2A_PROBE_CLASSES: readonly Phase2C26B2AContextClass[] = ['default_context_unfinished', 'capture_or_ordering_unresolved', 'extent_insufficient', 'eligible_but_not_observed']

/**
 * - reservation incompatible: some exclusive / blocked / held / Normal held-prefix condition fails;
 * - compatible but outside the default extent: `extent_insufficient`;
 * - compatible and inside: the B1 outcome decides - the oracle Candidate delivered (`observed`), no completed run
 *   (`default_context_unfinished`, never Candidate 0), a consumer stop at the capture bound
 *   (`capture_or_ordering_unresolved`, never "no oracle Candidate"), an extent stop / exhaustion without it
 *   (`eligible_but_not_observed`, not a Search bug by itself).
 */
export function phase2c26b2aClassifyContext(input: { compatible: boolean; withinDefaultExtent: boolean; b1: Phase2C26B2AB1ContextOutcome; deliveredOracle: boolean; captureBound: number }): Phase2C26B2AContextClass {
  const { compatible, withinDefaultExtent, b1, deliveredOracle, captureBound } = input
  if (deliveredOracle && (!compatible || !withinDefaultExtent || !b1.completed)) throw new Error('A context delivered the oracle Candidate although the audit finds it unreachable there.')
  if (!compatible) return 'reservation_incompatible'
  if (!withinDefaultExtent) return 'extent_insufficient'
  if (deliveredOracle) return 'observed'
  if (!b1.completed) return 'default_context_unfinished'
  if (b1.status === 'consumer_stop') {
    if (b1.delivered !== captureBound) throw new Error(`A consumer stop delivered ${String(b1.delivered)}, not the capture bound ${captureBound}.`)
    return 'capture_or_ordering_unresolved'
  }
  return 'eligible_but_not_observed'
}

// ---------------------------------------------------------------- per Target flags and aggregation

export interface Phase2C26B2ATargetFlags {
  alreadyCovered: boolean
  hasB1SearchContext: boolean
  hasReservationCompatibleContext: boolean
  hasDefaultExtentCompatibleContext: boolean
  hasUnfinishedCompatibleContext: boolean
  hasCaptureLimitedCompatibleContext: boolean
  hasCompletedEligibleButUnobservedContext: boolean
  needsLargerExtent: boolean
  hasExclusiveOwnedWeaponConflict: boolean
  hasBlockedPositionConflict: boolean
  hasHeldCoverageGap: boolean
  hasNormalHeldPrefixMismatch: boolean
  needsMultipleOracleSupportTargets: boolean
  noSingleWinnerSearchContext: boolean
}

export interface Phase2C26B2AContextRow {
  orientationId: string
  workIndex: number
  fixedTargetWeaponId: string
  reservation: Phase2C26B2AReachability
  b1: Phase2C26B2AB1ContextOutcome
  deliveredOracle: boolean
  classification: Phase2C26B2AContextClass
  /** The orientation's fixed winner is one of this Route's oracle support Targets. */
  fixedTargetIsOracleSupporter: boolean
}

export function phase2c26b2aTargetFlags(input: { covered: boolean; extent: Phase2C26B2ARouteExtent; support: Phase2C26B2ASupport; contexts: readonly Phase2C26B2AContextRow[] }): Phase2C26B2ATargetFlags {
  const { contexts } = input
  const has = (cls: Phase2C26B2AContextClass) => contexts.some(row => row.classification === cls)
  return {
    alreadyCovered: input.covered,
    hasB1SearchContext: contexts.length > 0,
    hasReservationCompatibleContext: contexts.some(row => row.reservation.compatible),
    hasDefaultExtentCompatibleContext: contexts.some(row => row.reservation.compatible) && input.extent.withinDefaultExtent,
    hasUnfinishedCompatibleContext: has('default_context_unfinished'),
    hasCaptureLimitedCompatibleContext: has('capture_or_ordering_unresolved'),
    hasCompletedEligibleButUnobservedContext: has('eligible_but_not_observed'),
    needsLargerExtent: !input.extent.withinDefaultExtent,
    hasExclusiveOwnedWeaponConflict: contexts.some(row => row.reservation.reasons.includes('exclusive_owned_weapon_conflict')),
    hasBlockedPositionConflict: contexts.some(row => row.reservation.reasons.includes('blocked_position_conflict')),
    hasHeldCoverageGap: contexts.some(row => row.reservation.reasons.includes('held_coverage_gap')),
    hasNormalHeldPrefixMismatch: contexts.some(row => row.reservation.reasons.includes('normal_held_prefix_mismatch')),
    needsMultipleOracleSupportTargets: input.support.providerBucket === '2+',
    noSingleWinnerSearchContext: contexts.length === 0,
  }
}

/** A probe-able gap: some context could deliver the oracle Route under its reservation (Search completion / capture / extent). */
export const phase2c26b2aHasProbeGap = (contexts: readonly Pick<Phase2C26B2AContextRow, 'classification'>[]) => contexts.some(row => PHASE2C26B2A_PROBE_CLASSES.includes(row.classification))
/** A context gap: no single-winner context exists, or none satisfies the reservation / held / exclusive conditions. */
export const phase2c26b2aHasContextGap = (flags: Pick<Phase2C26B2ATargetFlags, 'noSingleWinnerSearchContext' | 'hasReservationCompatibleContext'>) =>
  flags.noSingleWinnerSearchContext || !flags.hasReservationCompatibleContext

export interface Phase2C26B2ATargetAudit {
  targetWeaponId: string
  conflictParticipant: boolean
  covered: boolean
  oracleHeldRoute: boolean
  flags: Phase2C26B2ATargetFlags
  probeGap: boolean
  contextGap: boolean
  supportProviderBucket: '0' | '1' | '2+'
  extentRequiresLarger: Phase2C26B2AStream[]
}

const flagCount = (rows: readonly Phase2C26B2ATargetAudit[], flag: keyof Phase2C26B2ATargetFlags) => rows.filter(row => row.flags[flag]).length

/** The registered aggregate of a Route group (uncovered / participants / non-participants / oracle held Routes). */
export function phase2c26b2aAggregate(rows: readonly Phase2C26B2ATargetAudit[]) {
  return {
    routes: rows.length,
    noSearchContext: flagCount(rows, 'noSingleWinnerSearchContext'),
    withSearchContext: flagCount(rows, 'hasB1SearchContext'),
    reservationCompatibleContext: flagCount(rows, 'hasReservationCompatibleContext'),
    noReservationCompatibleContext: rows.filter(row => row.flags.hasB1SearchContext && !row.flags.hasReservationCompatibleContext).length,
    defaultExtentCompatibleContext: flagCount(rows, 'hasDefaultExtentCompatibleContext'),
    needsLargerExtent: flagCount(rows, 'needsLargerExtent'),
    needsLargerExtentByStream: { normal: rows.filter(row => row.extentRequiresLarger.includes('normal')).length, skill: rows.filter(row => row.extentRequiresLarger.includes('skill')).length,
      gogma: rows.filter(row => row.extentRequiresLarger.includes('gogma')).length },
    compatibleButExtentInsufficient: rows.filter(row => row.flags.hasReservationCompatibleContext && row.flags.needsLargerExtent).length,
    compatibleContextUnfinished: flagCount(rows, 'hasUnfinishedCompatibleContext'),
    compatibleContextCaptureUnresolved: flagCount(rows, 'hasCaptureLimitedCompatibleContext'),
    eligibleButNotObserved: flagCount(rows, 'hasCompletedEligibleButUnobservedContext'),
    heldCoverageGap: flagCount(rows, 'hasHeldCoverageGap'),
    exclusiveOwnedWeaponConflict: flagCount(rows, 'hasExclusiveOwnedWeaponConflict'),
    blockedPositionConflict: flagCount(rows, 'hasBlockedPositionConflict'),
    normalHeldPrefixMismatch: flagCount(rows, 'hasNormalHeldPrefixMismatch'),
    supportProviders: { '0': rows.filter(row => row.supportProviderBucket === '0').length, '1': rows.filter(row => row.supportProviderBucket === '1').length,
      '2+': rows.filter(row => row.supportProviderBucket === '2+').length },
    probeGap: rows.filter(row => row.probeGap).length,
    contextGap: rows.filter(row => row.contextGap).length,
    probeAndContextGap: rows.filter(row => row.probeGap && row.contextGap).length,
  }
}

// ---------------------------------------------------------------- representative single-winner patterns

const laneNames = ['normal', 'skill', 'gogma'] as const
const missingTotal = (reach: Phase2C26B2AReachability) => laneNames.reduce((sum, lane) => sum + (reach.lanes[lane]?.missingHeld.length ?? 0) + (reach.lanes[lane]?.heldPrefixOverlap.length ?? 0), 0)

/** The context closest to the oracle Route: fewest missing held / overlap positions, then fewest reasons, then context order. */
export function phase2c26b2aBestContext<T extends Pick<Phase2C26B2AContextRow, 'reservation'>>(contexts: readonly T[]): T | null {
  let best: T | null = null
  for (const row of contexts) {
    if (best === null || missingTotal(row.reservation) < missingTotal(best.reservation)
      || (missingTotal(row.reservation) === missingTotal(best.reservation) && row.reservation.reasons.length < best.reservation.reasons.length)) best = row
  }
  return best
}

/** Which reasons and lanes keep the oracle Route out of its best single-winner context (or why there is none). */
export function phase2c26b2aPattern(contexts: readonly Pick<Phase2C26B2AContextRow, 'reservation' | 'classification'>[], emptyReservation: Phase2C26B2AReachability): string {
  const lanesOf = (reach: Phase2C26B2AReachability, pick: (lane: Phase2C26B2ALaneCheck) => number[]) => laneNames.filter(lane => reach.lanes[lane] && pick(reach.lanes[lane]!).length > 0)
  if (contexts.length === 0) {
    const held = lanesOf(emptyReservation, lane => lane.missingHeld)
    return held.length === 0 ? 'no_context:needs_no_held' : `no_context:needs_held[${held.join('+')}]`
  }
  const best = phase2c26b2aBestContext(contexts)!
  if (best.reservation.compatible) return `compatible:${best.classification}`
  const parts = best.reservation.reasons.map(reason => reason === 'held_coverage_gap' ? `held_coverage_gap[${lanesOf(best.reservation, lane => lane.missingHeld).join('+')}]`
    : reason === 'blocked_position_conflict' ? `blocked_position_conflict[${lanesOf(best.reservation, lane => lane.blockedOwn).join('+')}]` : reason)
  return `incompatible:${parts.join('+')}`
}

// ---------------------------------------------------------------- decision (registered before the formal snapshot)

export type Phase2C26B2ADecisionCase = 'B2A_BOTH' | 'B2A_PROBE' | 'B2A_CONTEXT' | 'B2A_COVERED' | 'B2A_INVALID'

export const PHASE2C26B2A_DECISION_RULE = {
  order: [
    'B2A-INVALID: a B1 authority mismatch, a baseline / context parity failure, an oracle / manifest mismatch, an origin / estimated reach inconsistency, an inconsistency between a Production primitive verdict and its decomposition, a context that delivered the oracle Candidate although the audit finds it unreachable there, a covered oracle Route not observed in a context that delivered it, or an uncovered Route explained by neither a probe-able gap nor a context gap',
    'B2A-COVERED: no uncovered oracle Route',
    'B2A-BOTH: among the uncovered Routes, at least one probe-able gap (a reservation-compatible context that is unfinished, capture-limited at the bound, outside the default extent, or completed without observing the Route) AND at least one context gap (no single-winner Search context, or no context satisfying the reservation / held / exclusive conditions)',
    'B2A-PROBE: probe-able gaps only',
    'B2A-CONTEXT: context gaps only',
  ],
  probeGap: ['default_context_unfinished', 'capture_or_ordering_unresolved', 'extent_insufficient', 'eligible_but_not_observed'],
  contextGap: ['no_single_winner_search_context', 'no context satisfying the reservation / held / exclusive / Normal held-prefix conditions'],
  note: 'Per Route the two gap kinds are exclusive by construction (a Route either has a reservation-compatible context or not); the case is about the uncovered set. Cause flags are not exclusive. The oracle is a post-hoc fixture, never a heuristic.',
} as const

export const PHASE2C26B2A_RECOMMENDATION: Record<Phase2C26B2ADecisionCase, string> = {
  B2A_BOTH: 'B2-Bを「Search / extent側（compatible contextの完走・capture・extent probe）」と「context生成側（multi-route reservation・non-conflict context）」に分けて実施する',
  B2A_PROBE: 'B2-BはSearch completion / capture / extent probeを中心に実施する',
  B2A_CONTEXT: 'extent probeを先に広げず、multi-route reservation / non-conflict context生成を検討する',
  B2A_COVERED: 'portfolio / global assignmentへ進む',
  B2A_INVALID: '次へ進まず原因調査',
}

export function phase2c26b2aDecision(input: { invalidReasons: readonly string[]; uncovered: number; probeGapRoutes: number; contextGapRoutes: number; unexplainedRoutes: number }) {
  const { uncovered, probeGapRoutes, contextGapRoutes, unexplainedRoutes } = input
  if (![uncovered, probeGapRoutes, contextGapRoutes, unexplainedRoutes].every(v => Number.isInteger(v) && v >= 0) || probeGapRoutes > uncovered || contextGapRoutes > uncovered || unexplainedRoutes > uncovered) {
    throw new Error(`Inconsistent Phase 2-C2.6-B2-A decision input: ${JSON.stringify(input)}`)
  }
  const reasons = [...input.invalidReasons, ...(unexplainedRoutes > 0 ? ['unexplained_uncovered_route'] : [])]
  const caseId: Phase2C26B2ADecisionCase = reasons.length > 0 ? 'B2A_INVALID' : uncovered === 0 ? 'B2A_COVERED'
    : probeGapRoutes > 0 && contextGapRoutes > 0 ? 'B2A_BOTH' : probeGapRoutes > 0 ? 'B2A_PROBE' : 'B2A_CONTEXT'
  return { case: caseId, reasons, recommendation: PHASE2C26B2A_RECOMMENDATION[caseId] }
}

// ---------------------------------------------------------------- the whole audit

export interface Phase2C26B2AAuditInput {
  snapshot: Phase2C26B2ASnapshotRecord
  authority: Phase2C26B2AB1Authority
  manifest: readonly Phase2C26B2AOracleRouteSpec[]
  oracle: Phase2C26B2AOracle
}

/**
 * Every oracle Route against every B1 context of its Target. Returns the per-Route rows, the aggregates and the audit
 * inconsistencies (each one makes the case B2A-INVALID). The origin is the snapshot's own (uniform) Planner-start origin.
 */
export async function runPhase2C26B2AAudit({ snapshot, authority, manifest, oracle }: Phase2C26B2AAuditInput) {
  const inconsistencies: string[] = []
  const origin = snapshot.contexts[0]!.origin
  const extent = snapshot.contexts[0]!.extent
  const weaponTypeOf = new Map(oracle.routes.map(route => [route.targetWeaponId, route.weaponTypeId]))
  const views = manifest.map(spec => phase2c26b2aRouteView(spec, weaponTypeOf.get(spec.targetWeaponId)!))
  const originsOf = (view: Phase2C26B2ARouteView): Phase2C26B2AOrigins => ({
    skill: origin.skillCounter.value!, gogma: origin.gogmaCounter.value!,
    normal: origin.normalCounters.find(c => c.counterId === view.normalCounterId)?.counter ?? null,
  })
  // The snapshot origin must be the oracle's own Planner-start stream starts.
  if (origin.skillCounter.value !== oracle.summary.skill.start || origin.gogmaCounter.value !== oracle.summary.gogma.start) inconsistencies.push('the snapshot Skill / Gogma origin is not the oracle stream start')
  for (const [counterId, s] of Object.entries(oracle.summary.normal)) {
    if (origin.normalCounters.find(c => c.counterId === counterId)?.counter !== s.start) inconsistencies.push(`the snapshot ${counterId} origin is not the oracle stream start`)
  }
  const occupancy = phase2c26b2aOccupancy(views)
  const orientationById = new Map(snapshot.baseline.orientations.map(o => [o.orientationId, o]))
  const coverageByTarget = new Map(authority.oracleRows.map(row => [row.targetWeaponId, row]))
  const participants = new Set(authority.participants)
  const routes = []
  for (const view of views) {
    const coverage = coverageByTarget.get(view.targetWeaponId)
    if (!coverage) { inconsistencies.push(`${view.targetWeaponId}: no B1 oracle coverage row`); continue }
    const origins = originsOf(view)
    const routeExtent = phase2c26b2aRouteExtent(view, origins, extent)
    if (!routeExtent.estimatedMatches) inconsistencies.push(`${view.targetWeaponId}: the reach from the origin is not the oracle estimated advance`)
    if (coverage.oracleHeldRoute !== null && coverage.oracleHeldRoute !== view.oracleHeldRoute) inconsistencies.push(`${view.targetWeaponId}: oracle held Route flag differs from B1`)
    if (coverage.conflictParticipant !== participants.has(view.targetWeaponId)) inconsistencies.push(`${view.targetWeaponId}: participant flag differs from B1`)
    const support = phase2c26b2aSupport(view, origins, occupancy)
    if (support.unsupportedPositions > 0) inconsistencies.push(`${view.targetWeaponId}: ${support.unsupportedPositions} needed positions no oracle Route operates on`)
    const emptyReservation = await phase2c26b2aReachability(view, null, origins, extent)
    const covered = coverage.coverage === 'exact' || coverage.coverage === 'partial_comparable'
    const contexts: Phase2C26B2AContextRow[] = []
    for (const [index, context] of snapshot.contexts.entries()) {
      if (context.targetWeaponId !== view.targetWeaponId) continue
      const b1Context = authority.contexts[index]!
      const b1 = context.status === 'searchable' ? phase2c26b2aB1ContextOutcome(b1Context.taskId, authority.runs) : { ...phase2c26b2aB1ContextOutcome(null, []), status: 'not_searched' as const }
      const reach = await phase2c26b2aReachability(view, context.reservation, origins, extent)
      if (reach.inconsistent) inconsistencies.push(`${view.targetWeaponId} @ ${context.orientationId}#${context.workIndex}: a primitive verdict disagrees with its decomposition`)
      if (reach.compatible && reach.productionLimitAccepts !== routeExtent.withinDefaultExtent) inconsistencies.push(`${view.targetWeaponId} @ ${context.orientationId}#${context.workIndex}: the Production limit walk disagrees with the reach extent verdict`)
      const deliveredOracle = coverage.matchedStableKeySha256 !== null && b1.keySha256s.includes(coverage.matchedStableKeySha256)
      let classification: Phase2C26B2AContextClass
      try {
        classification = phase2c26b2aClassifyContext({ compatible: reach.compatible, withinDefaultExtent: routeExtent.withinDefaultExtent, b1, deliveredOracle, captureBound: authority.captureBound })
      } catch (error) {
        inconsistencies.push(`${view.targetWeaponId} @ ${context.orientationId}#${context.workIndex}: ${(error as Error).message}`)
        classification = 'reservation_incompatible'
      }
      const fixedTargetWeaponId = orientationById.get(context.orientationId)?.fixedTargetWeaponId ?? ''
      contexts.push({ orientationId: context.orientationId, workIndex: context.workIndex, fixedTargetWeaponId, reservation: reach, b1, deliveredOracle, classification,
        fixedTargetIsOracleSupporter: support.supportTargetWeaponIds.includes(fixedTargetWeaponId) || support.ambiguousCandidateTargetWeaponIds.includes(fixedTargetWeaponId) })
    }
    if (covered && !contexts.some(row => row.classification === 'observed')) inconsistencies.push(`${view.targetWeaponId}: covered by B1 but observed in no context the audit finds reachable`)
    const flags = phase2c26b2aTargetFlags({ covered, extent: routeExtent, support, contexts })
    const probeGap = !covered && phase2c26b2aHasProbeGap(contexts)
    const contextGap = !covered && phase2c26b2aHasContextGap(flags)
    const extentRequiresLarger = (['normal', 'skill', 'gogma'] as const).filter(stream => routeExtent.verdict[stream] === 'requires_larger_extent')
    const audit: Phase2C26B2ATargetAudit = { targetWeaponId: view.targetWeaponId, conflictParticipant: participants.has(view.targetWeaponId), covered, oracleHeldRoute: view.oracleHeldRoute,
      flags, probeGap, contextGap, supportProviderBucket: support.providerBucket, extentRequiresLarger }
    routes.push({ view, origins, extent: routeExtent, support, emptyReservation, contexts, audit })
  }
  const audits = routes.map(route => route.audit)
  const uncovered = audits.filter(row => !row.covered)
  const unexplained = uncovered.filter(row => !row.probeGap && !row.contextGap)
  const aggregates = {
    all: phase2c26b2aAggregate(audits),
    uncovered: phase2c26b2aAggregate(uncovered),
    uncoveredParticipants: phase2c26b2aAggregate(uncovered.filter(row => row.conflictParticipant)),
    uncoveredNonParticipants: phase2c26b2aAggregate(uncovered.filter(row => !row.conflictParticipant)),
    oracleHeldRoutes: phase2c26b2aAggregate(audits.filter(row => row.oracleHeldRoute)),
    uncoveredOracleHeldRoutes: phase2c26b2aAggregate(uncovered.filter(row => row.oracleHeldRoute)),
    coverage: { routes: audits.length, covered: audits.length - uncovered.length, uncovered: uncovered.length,
      participants: { total: audits.filter(r => r.conflictParticipant).length, covered: audits.filter(r => r.conflictParticipant && r.covered).length },
      nonParticipants: { total: audits.filter(r => !r.conflictParticipant).length, covered: audits.filter(r => !r.conflictParticipant && r.covered).length } },
    singleWinnerPatterns: countBy(routes.filter(r => !r.audit.covered), r => phase2c26b2aPattern(r.contexts, r.emptyReservation)),
    contextClasses: countBy(routes.filter(r => !r.audit.covered).flatMap(r => r.contexts), row => row.classification),
    incompatibilityReasons: countBy(routes.filter(r => !r.audit.covered).flatMap(r => r.contexts.flatMap(row => row.reservation.reasons)), reason => reason),
    /** B1 outcome of every context of an uncovered Route, by audit class: a timeout context is never read as Candidate 0. */
    contextClassByB1Status: countBy(routes.filter(r => !r.audit.covered).flatMap(r => r.contexts), row => `${row.classification}|${row.b1.status}`),
    contextsWhoseFixedTargetIsOracleSupporter: countBy(routes.filter(r => !r.audit.covered).flatMap(r => r.contexts), row => String(row.fixedTargetIsOracleSupporter)),
  }
  return { routes, aggregates, unexplained: unexplained.map(row => row.targetWeaponId), inconsistencies }
}
