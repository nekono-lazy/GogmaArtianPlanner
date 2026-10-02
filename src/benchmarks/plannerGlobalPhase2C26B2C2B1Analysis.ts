/**
 * Issue #154 Phase 2-C2.6-B2-C2B1 post-hoc analysis only. It reads a finished B2-C2B1 calculation and, as explicit
 * analyzer arguments AFTER the calculation ended, the B2-B1 / B2-C1 / B2-A / B2-C2A-R2 RESULTs, the 1,657 oracle RESULT
 * and the oracle manifest. It runs no Search, no kernel and no Planner, and feeds no evidence into any calculation.
 *
 * The question: for the 20 extent-insufficient Targets (B2-C1 post-hoc subgroup), how much Production extent does each
 * oracle Route need on each stream, how far is that from the Production default, and which common, bounded extent ladder
 * should the next actual Search Phase of the 11 K1-minimal ones (E1) register? The 9 K2-minimal ones (E2) are
 * characterized too but go to a separate Target-relative K2 feature / grouping Phase, never to an extent increase.
 *
 * The extent meaning is the unchanged B2-A `phase2c26b2aRouteExtent()` (Normal production target offset, Gogma lane,
 * existing Gogma Reset Skills lane, conversion Route Skill lane one position wider), cross-checked against the B2-C1
 * windows and against the Production `nextOperationPositions()` / `heldPrefixNormalCreation()` walk cut at the extent
 * limit, at the required value and one below it. The ladder reads the E1 cohort's required extents (cohort percentiles,
 * a power-of-two grid and an existing ceiling), so it is oracle-informed and never a Production default; no Target gets
 * an individual oracle value as its Search extent.
 */
import { stableStringify } from '../domain/models/hashing'
import { recommendedCandidateSearchDefaults } from '../domain/models/common'
import { defaultPlannerAlternativeSearchExtent, type PlannerAlternativeReservation, type PlannerAlternativeSearchExtent } from '../domain/search'
import {
  phase2c26b2aReachability,
  phase2c26b2aRouteExtent,
  phase2c26b2aRouteView,
  type Phase2C26B2AOracle,
  type Phase2C26B2AOracleRouteSpec,
  type Phase2C26B2AOrigins,
  type Phase2C26B2ARouteView,
  type Phase2C26B2AStream,
} from './plannerGlobalPhase2C26B2AAnalysis'
import { phase2c26b2c1DefaultWindows } from './plannerGlobalPhase2C26B2C1'
import {
  phase2c26b2c1Percentile,
  phase2c26b2c1RouteWithinWindows,
  runPhase2C26B2C1Audit,
  type Phase2C26B2C1B2B1Authority,
  type Phase2C26B2C1B2B1Route,
  type Phase2C26B2C1RouteRow,
} from './plannerGlobalPhase2C26B2C1Analysis'
import { PHASE2C26B2C2A_REGISTERED_B2C1, type Phase2C26B2C2AB2C1Authority, type Phase2C26B2C2AB2C1Route } from './plannerGlobalPhase2C26B2C2ATargets'
import { phase2c26b2c2b1CalculationFromSchedule, PHASE2C26B2C2B1_ORDERING_POLICY, type Phase2C26B2C2B1Calculation } from './plannerGlobalPhase2C26B2C2B1'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const countBy = <T>(values: readonly T[], key: (value: T) => string): Record<string, number> => {
  const out: Record<string, number> = {}
  for (const value of values) out[key(value)] = (out[key(value)] ?? 0) + 1
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => compare(a, b)))
}
const SHA256 = /^[0-9a-f]{64}$/
const COMMIT = /^[0-9a-f]{40}$/

export const PHASE2C26B2C2B1_STREAMS: readonly Phase2C26B2AStream[] = ['normal', 'gogma', 'skill']
const EXTENT_KEY = { normal: 'maxNormalAdvance', gogma: 'maxGogmaAdvance', skill: 'maxSkillAdvance' } as const satisfies Record<Phase2C26B2AStream, keyof PlannerAlternativeSearchExtent>
export type Phase2C26B2C2B1PerStream<T> = Record<Phase2C26B2AStream, T>

// ---------------------------------------------------------------- registered before the formal run

/** The predecessor results this phase is registered against. Any other value fails closed. */
export const PHASE2C26B2C2B1_REGISTERED = {
  b2c1: PHASE2C26B2C2A_REGISTERED_B2C1,
  b2a: { resultSha256: '7f425ca46d7908280793440570d8af6e85fe589ec8772160021f15f2e814b883', decisionCase: 'B2A_BOTH', routes: 43,
    needsLargerExtent: 23, needsLargerExtentByStream: { normal: 6, skill: 23, gogma: 0 } },
  r2: { resultSha256: '5014571404310d287eaa03391d7f31c3d64621c6f68ee740e82fad8690ba6402', decisionCase: 'B2C2AR2_ALL_C4C', combinedTargets: 20, exactC4C: 20, fullyMeasuredTargets: 20 },
  /** B2-B1 `aggregates.all.recoveredRequiresLargerExtentByStream` (the B2-C1 parser registers the same value). */
  b2b1ExtentByStream: { normal: 4, skill: 20, gogma: 0 },
  /** B2-C1 P1 first compatible ranks of the two cohorts (K1-minimal max 32; K2-minimal 50..306). */
  b2c1P1: { e1MaxRank: 32, e2MinRank: 50, e2MaxRank: 306 },
} as const

/** The population the formal audit expects. */
export const PHASE2C26B2C2B1_EXPECTED_POPULATION = { extentInsufficient: 20, e1: 11, e2: 9, defaultExtent: 20, unreached: 3 } as const

/**
 * The extent ladder rule for the E1 actual Search Phase (registered before the formal run). A ladder is a short list of
 * common extents every E1 Target is searched with, in order; it is never an individual Target's oracle value and never a
 * Production default.
 */
export const PHASE2C26B2C2B1_LADDER_RULE = {
  population: 'E1: K1-minimal extent-insufficient Targets (B2-C1 post-hoc subgroups extentInsufficient and k1Minimal)',
  rungs: [
    'L0 default: the Production default extent (defaultPlannerAlternativeSearchExtent)',
    'L1 intermediate: per stream, grid(nearest-rank median of the required extent over the E1 Targets insufficient on that stream)',
    'L2 larger: per stream, grid(maximum of the required extent over the E1 Targets insufficient on that stream)',
  ],
  grid: 'a stream no E1 Target exceeds keeps its default; otherwise max(default, the smallest power of two >= the value), lowered to the ceiling when that power exceeds it; a value above the ceiling is unbounded',
  ceiling: 'recommendedCandidateSearchDefaults (the Candidate Search initial search range with the same max*Advance meanings, Browser-measured in Issue #104 / #125)',
  dedup: 'a rung equal to the previous rung is dropped',
  percentile: 'nearest rank: sorted[ceil(p / 100 * n) - 1]',
  note: 'The rung values read the E1 cohort required extents post hoc (oracleInformedLadder = true). The next Phase searches every E1 Target with the same rungs, in order; no rung is a Production default.',
} as const

export const PHASE2C26B2C2B1_LADDER_CEILING: PlannerAlternativeSearchExtent = {
  maxNormalAdvance: recommendedCandidateSearchDefaults.maxNormalAdvance,
  maxGogmaAdvance: recommendedCandidateSearchDefaults.maxGogmaAdvance,
  maxSkillAdvance: recommendedCandidateSearchDefaults.maxSkillAdvance,
}

export type Phase2C26B2C2B1DecisionCase = 'B2C2B1_CHARACTERIZED' | 'B2C2B1_UNBOUNDED' | 'B2C2B1_UNDETERMINED' | 'B2C2B1_INVALID'

export const PHASE2C26B2C2B1_DECISION_RULE = {
  order: [
    'B2C2B1_INVALID: an authority / hash chain / provenance / population / extent semantics / B2-A or B2-B1 extent parity / B2-C1 subgroup or P1 rank parity / window or Production walk boundary / oracle isolation / raw-result inconsistency, a cohort Target the authority calls extent-insufficient with no insufficient stream, or a stream count that is not the registered B2-B1 one',
    'B2C2B1_UNDETERMINED: no invalid reason, but some extent-insufficient Target has a non-finite or unreadable required extent on a stream it operates on, so no Search condition can be fixed',
    'B2C2B1_UNBOUNDED: every required extent is finite, but some E1 required extent exceeds the ladder ceiling, so no bounded ladder exists',
    'B2C2B1_CHARACTERIZED: 20 / 20 extent-insufficient Targets characterized (E1 11 / E2 9), every required extent finite and equal to the B2-A / B2-B1 authority, no invalid reason, and a bounded ladder whose top rung covers every E1 Target',
  ],
  extent: 'phase2c26b2aRouteExtent(): required = last own position - origin + 1 (conversion Route Skill: one less); within the extent iff required <= the extent value',
} as const

export const PHASE2C26B2C2B1_RECOMMENDATION: Record<Phase2C26B2C2B1DecisionCase, string> = {
  B2C2B1_CHARACTERIZED: 'E1（K1-minimal extent不足）11件を対象に、P1 scheduler ordering + 登録したextent ladder（L0 → L1 → L2）でactual Search probeへ。E2（K2-minimal）9件はextent拡張ではなくTarget-relative K2 feature / grouping研究を先に行う',
  B2C2B1_UNBOUNDED: 'E1のextent要求がceilingを超えるため、ladder上限（Search runtime）を別途測定・設計してからactual Searchへ',
  B2C2B1_UNDETERMINED: 'required extentが読めないTargetがあるため、Search条件を決めず原因調査',
  B2C2B1_INVALID: '次へ進まず原因調査',
}

// ---------------------------------------------------------------- authorities (the committed RESULTs, untrusted JSON)

export interface Phase2C26B2C2B1B2AAuthority {
  resultSha256: string
  measuredHead: string
  exportSha256: string
  oracleResultSha256: string
  oracleManifestFileSha256: string
  oracleManifestRoutesSha256: string
  routes: { targetWeaponId: string; extent: unknown }[]
}

/**
 * The B2-A RESULT: the registered SHA-256, formal with no calculation change after its measured HEAD, case B2A_BOTH, no
 * invalid reason, the registered needs-larger-extent aggregate, and 43 readable Route extent rows that add up to it.
 */
export function parsePhase2C26B2C2B1B2AAuthority(json: unknown, resultSha256: string): { valid: boolean; issues: string[]; authority: Phase2C26B2C2B1B2AAuthority | null } {
  const reg = PHASE2C26B2C2B1_REGISTERED.b2a
  const issues: string[] = []
  if (!isObject(json) || !isObject(json.provenance) || !isObject(json.decision) || !isObject(json.aggregates)) return { valid: false, issues: ['B2-A RESULT lacks provenance / decision / aggregates'], authority: null }
  const { provenance, decision, aggregates } = json
  if (resultSha256 !== reg.resultSha256) issues.push(`B2-A RESULT SHA-256 ${resultSha256} is not the registered ${reg.resultSha256}`)
  if (provenance.formal !== true) issues.push('provenance.formal is not true')
  if (!Array.isArray(provenance.calculationCodeChangedSinceMeasuredHead) || provenance.calculationCodeChangedSinceMeasuredHead.length !== 0) issues.push('provenance.calculationCodeChangedSinceMeasuredHead is not empty')
  if (typeof provenance.measuredHead !== 'string' || !COMMIT.test(provenance.measuredHead)) issues.push('provenance.measuredHead is not a commit SHA')
  for (const field of ['exportSha256', 'oracleResultSha256', 'oracleManifestFileSha256', 'oracleManifestRoutesSha256'] as const) {
    if (typeof provenance[field] !== 'string' || !SHA256.test(provenance[field] as string)) issues.push(`provenance.${field} is not a SHA-256`)
  }
  if (decision.case !== reg.decisionCase) issues.push(`decision.case ${String(decision.case)} is not ${reg.decisionCase}`)
  if (!Array.isArray(json.invalidReasons) || json.invalidReasons.length !== 0) issues.push('invalidReasons is not empty')
  const all = isObject(aggregates.all) ? aggregates.all : {}
  if (all.routes !== reg.routes || all.needsLargerExtent !== reg.needsLargerExtent) issues.push('aggregates.all routes / needsLargerExtent are not the registered values')
  if (!same(all.needsLargerExtentByStream, reg.needsLargerExtentByStream)) issues.push('aggregates.all.needsLargerExtentByStream is not the registered value')
  const routes: Phase2C26B2C2B1B2AAuthority['routes'] = []
  for (const raw of asArray(json.routes)) {
    if (!isObject(raw) || typeof raw.targetWeaponId !== 'string' || !isObject(raw.extent) || !isObject(raw.extent.required) || !isObject(raw.extent.verdict)
      || typeof raw.extent.withinDefaultExtent !== 'boolean') { issues.push('a B2-A route row is malformed'); continue }
    routes.push({ targetWeaponId: raw.targetWeaponId, extent: raw.extent })
  }
  if (routes.length !== reg.routes || new Set(routes.map(r => r.targetWeaponId)).size !== routes.length) issues.push('B2-A routes are not 43 distinct Routes')
  const larger = routes.filter(r => (r.extent as Json).withinDefaultExtent === false)
  const byStream = Object.fromEntries((['normal', 'skill', 'gogma'] as const).map(s => [s, larger.filter(r => ((r.extent as Json).verdict as Json)[s] === 'requires_larger_extent').length]))
  if (larger.length !== reg.needsLargerExtent || !same(byStream, reg.needsLargerExtentByStream)) issues.push('B2-A route extent rows do not add up to the registered aggregate')
  if (issues.length > 0) return { valid: false, issues, authority: null }
  return { valid: true, issues: [], authority: { resultSha256, measuredHead: String(provenance.measuredHead), exportSha256: String(provenance.exportSha256),
    oracleResultSha256: String(provenance.oracleResultSha256), oracleManifestFileSha256: String(provenance.oracleManifestFileSha256),
    oracleManifestRoutesSha256: String(provenance.oracleManifestRoutesSha256), routes } }
}

export interface Phase2C26B2C2B1R2Authority {
  resultSha256: string
  measuredHead: string
  analysisHead: string
  exportSha256: string
  b2c1ResultSha256: string
  b2b1ResultSha256: string
  oracleResultSha256: string
  oracleManifestFileSha256: string
  oracleManifestRoutesSha256: string
  /** The 20 Targets whose default-extent Search evidence R2 closed (320 / 320 measured). */
  defaultExtentTargetWeaponIds: string[]
}

/**
 * The B2-C2A-R2 RESULT, read only as "the default extent Search validation is complete": the registered SHA-256, formal
 * with no calculation change, case B2C2AR2_ALL_C4C, no invalid reason, the registered B2-C1 / B2-B1 predecessors, 20
 * distinct combined Targets all fully measured, and C4C exact 20. Nothing about the extent requirement is derived from it.
 */
export function parsePhase2C26B2C2B1R2Authority(json: unknown, resultSha256: string): { valid: boolean; issues: string[]; authority: Phase2C26B2C2B1R2Authority | null } {
  const reg = PHASE2C26B2C2B1_REGISTERED.r2
  const issues: string[] = []
  if (!isObject(json) || !isObject(json.provenance) || !isObject(json.decision) || !isObject(json.aggregates)) return { valid: false, issues: ['R2 RESULT lacks provenance / decision / aggregates'], authority: null }
  const { provenance, decision, aggregates } = json
  if (resultSha256 !== reg.resultSha256) issues.push(`R2 RESULT SHA-256 ${resultSha256} is not the registered ${reg.resultSha256}`)
  if (provenance.formal !== true) issues.push('provenance.formal is not true')
  if (!Array.isArray(provenance.calculationCodeChangedSinceMeasuredHead) || provenance.calculationCodeChangedSinceMeasuredHead.length !== 0) issues.push('provenance.calculationCodeChangedSinceMeasuredHead is not empty')
  for (const field of ['measuredHead', 'analysisHead'] as const) if (typeof provenance[field] !== 'string' || !COMMIT.test(provenance[field] as string)) issues.push(`provenance.${field} is not a commit SHA`)
  for (const field of ['exportSha256', 'b2c1ResultSha256', 'b2b1ResultSha256', 'oracleResultSha256', 'oracleManifestFileSha256', 'oracleManifestRoutesSha256'] as const) {
    if (typeof provenance[field] !== 'string' || !SHA256.test(provenance[field] as string)) issues.push(`provenance.${field} is not a SHA-256`)
  }
  if (provenance.b2c1ResultSha256 !== PHASE2C26B2C2B1_REGISTERED.b2c1.resultSha256) issues.push('provenance.b2c1ResultSha256 is not the registered B2-C1 RESULT')
  if (provenance.b2b1ResultSha256 !== PHASE2C26B2C2B1_REGISTERED.b2c1.b2b1ResultSha256) issues.push('provenance.b2b1ResultSha256 is not the registered B2-B1 RESULT')
  if (decision.case !== reg.decisionCase) issues.push(`decision.case ${String(decision.case)} is not ${reg.decisionCase}`)
  if (!Array.isArray(json.invalidReasons) || json.invalidReasons.length !== 0) issues.push('invalidReasons is not empty')
  const combined = isObject(aggregates.combined) ? aggregates.combined : {}
  const exact = isObject(combined.exactTargets) ? combined.exactTargets : {}
  if (exact.C4C !== reg.exactC4C || combined.fullyMeasuredTargets !== reg.fullyMeasuredTargets) issues.push('aggregates.combined C4C exact / fully measured Targets are not the registered values')
  const rows = asArray(json.combinedTargets)
  const ids = rows.map(row => isObject(row) && typeof row.targetWeaponId === 'string' ? row.targetWeaponId : null)
  if (ids.some(id => id === null) || rows.some(row => !isObject(row) || row.fullyMeasured !== true)) issues.push('a combined Target row is malformed or not fully measured')
  if (rows.length !== reg.combinedTargets || new Set(ids).size !== rows.length) issues.push(`combinedTargets are not ${reg.combinedTargets} distinct Targets`)
  if (issues.length > 0) return { valid: false, issues, authority: null }
  return { valid: true, issues: [], authority: { resultSha256, measuredHead: String(provenance.measuredHead), analysisHead: String(provenance.analysisHead), exportSha256: String(provenance.exportSha256),
    b2c1ResultSha256: String(provenance.b2c1ResultSha256), b2b1ResultSha256: String(provenance.b2b1ResultSha256), oracleResultSha256: String(provenance.oracleResultSha256),
    oracleManifestFileSha256: String(provenance.oracleManifestFileSha256), oracleManifestRoutesSha256: String(provenance.oracleManifestRoutesSha256),
    defaultExtentTargetWeaponIds: (ids as string[]).sort(compare) } }
}

/** One recorded hash of the chain: which file / record says which value. */
export interface Phase2C26B2C2B1HashChainInput {
  exportSha256: Record<string, string>
  oracleResultSha256: Record<string, string>
  oracleManifestFileSha256: Record<string, string>
  oracleManifestRoutesSha256: Record<string, string>
  b2c1ResultSha256: Record<string, string>
  b2b1ResultSha256: Record<string, string>
}

/** Every recorder of one value must agree; each disagreement is one issue naming the value and the recorders. */
export function phase2c26b2c2b1HashChainIssues(chain: Phase2C26B2C2B1HashChainInput): string[] {
  const issues: string[] = []
  for (const [name, recorders] of Object.entries(chain) as [string, Record<string, string>][]) {
    const values = new Set(Object.values(recorders))
    if (Object.keys(recorders).length < 2) issues.push(`${name}: fewer than two recorders`)
    if (values.size !== 1) issues.push(`${name}: ${Object.entries(recorders).map(([who, value]) => `${who}=${value}`).join(', ')}`)
  }
  return issues
}

// ---------------------------------------------------------------- required extent (B2-A semantics) and its boundaries

export interface Phase2C26B2C2B1RequiredExtent {
  reach: { normal: number | null; gogma: number; skill: number }
  required: Phase2C26B2C2B1PerStream<number | null>
  verdict: Phase2C26B2C2B1PerStream<string>
  withinDefaultExtent: boolean
  estimatedMatches: boolean
  /** max(0, required - default) per stream (0 for a stream the Route does not operate on). */
  shortage: Phase2C26B2C2B1PerStream<number>
  insufficientStreams: Phase2C26B2AStream[]
  /** Streams the Route operates on whose required value is not a finite non-negative integer (Normal: positive). */
  unreadableStreams: Phase2C26B2AStream[]
}

/** The streams a Route operates on (Normal only for a new-Normal Route: its production target). */
export function phase2c26b2c2b1OperatedStreams(view: Phase2C26B2ARouteView): Phase2C26B2AStream[] {
  return PHASE2C26B2C2B1_STREAMS.filter(s => s === 'normal' ? view.sourceKind === 'new_normal' : view[s].length > 0)
}

/** The unchanged B2-A extent of one Route plus its shortage against `extent` (the Production default). */
export function phase2c26b2c2b1RequiredExtent(view: Phase2C26B2ARouteView, origins: Phase2C26B2AOrigins, extent: PlannerAlternativeSearchExtent): Phase2C26B2C2B1RequiredExtent {
  const e = phase2c26b2aRouteExtent(view, origins, extent)
  const operated = phase2c26b2c2b1OperatedStreams(view)
  const unreadableStreams = operated.filter(s => {
    const value = e.required[s]
    return value === null || !Number.isSafeInteger(value) || value < (s === 'normal' ? 1 : 0)
  })
  const shortage = Object.fromEntries(PHASE2C26B2C2B1_STREAMS.map(s => {
    const value = e.required[s]
    return [s, value === null || !Number.isSafeInteger(value) ? 0 : Math.max(0, value - extent[EXTENT_KEY[s]])]
  })) as Phase2C26B2C2B1PerStream<number>
  return { reach: e.reach, required: e.required, verdict: e.verdict, withinDefaultExtent: e.withinDefaultExtent, estimatedMatches: e.estimatedMatches, shortage,
    insufficientStreams: PHASE2C26B2C2B1_STREAMS.filter(s => shortage[s] > 0), unreadableStreams }
}

/** The smallest extent that holds the Route: per stream max(1, required), the base value for a stream it does not operate on. */
export function phase2c26b2c2b1ExactExtent(required: Phase2C26B2C2B1PerStream<number | null>, base: PlannerAlternativeSearchExtent): PlannerAlternativeSearchExtent {
  const pick = (s: Phase2C26B2AStream) => required[s] === null ? base[EXTENT_KEY[s]] : Math.max(1, required[s]!)
  return { maxNormalAdvance: pick('normal'), maxGogmaAdvance: pick('gogma'), maxSkillAdvance: pick('skill') }
}

const lower = (extent: PlannerAlternativeSearchExtent, stream: Phase2C26B2AStream): PlannerAlternativeSearchExtent => ({ ...extent, [EXTENT_KEY[stream]]: extent[EXTENT_KEY[stream]] - 1 })
/** Streams whose required value is at least 2, so one below it is still a legal extent. */
const lowerable = (required: Phase2C26B2C2B1PerStream<number | null>) => PHASE2C26B2C2B1_STREAMS.filter(s => required[s] !== null && required[s]! >= 2)

export interface Phase2C26B2C2B1Boundary {
  /** The Route is accepted at the exact required extent. */
  acceptedAtRequired: boolean
  /** Per stream with required >= 2: the Route is rejected with that one stream one below its required value. */
  rejectedBelow: Partial<Phase2C26B2C2B1PerStream<boolean>>
  valid: boolean
}

/**
 * The B2-C1 window boundary: the Route lies inside `phase2c26b2c1DefaultWindows()` of its exact required extent, and
 * falls outside as soon as any one stream is one below it. This pins the required value as the exact minimum under the
 * B2-C1 window semantics (including the conversion Route's one wider Skill window).
 */
export function phase2c26b2c2b1WindowBoundary(view: Phase2C26B2ARouteView, origins: Phase2C26B2AOrigins, required: Phase2C26B2C2B1PerStream<number | null>,
  base: PlannerAlternativeSearchExtent): Phase2C26B2C2B1Boundary {
  const exact = phase2c26b2c2b1ExactExtent(required, base)
  const within = (extent: PlannerAlternativeSearchExtent) => phase2c26b2c1RouteWithinWindows(view, phase2c26b2c1DefaultWindows(origins, extent))
  const acceptedAtRequired = within(exact)
  const rejectedBelow = Object.fromEntries(lowerable(required).map(s => [s, !within(lower(exact, s))])) as Partial<Phase2C26B2C2B1PerStream<boolean>>
  return { acceptedAtRequired, rejectedBelow, valid: acceptedAtRequired && Object.values(rejectedBelow).every(Boolean) }
}

/**
 * The Production walk boundary under a reservation the Route is compatible with (the P1 first compatible context): the
 * unchanged `phase2c26b2aReachability()` accepts every lane at the exact required extent and rejects the lowered lane
 * when one stream is one below it. This is the Production `nextOperationPositions()` / `heldPrefixNormalCreation()`
 * limit walk, not a re-implementation.
 */
export async function phase2c26b2c2b1WalkBoundary(view: Phase2C26B2ARouteView, reservation: PlannerAlternativeReservation, origins: Phase2C26B2AOrigins,
  required: Phase2C26B2C2B1PerStream<number | null>, base: PlannerAlternativeSearchExtent): Promise<Phase2C26B2C2B1Boundary & { compatible: boolean }> {
  const exact = phase2c26b2c2b1ExactExtent(required, base)
  const atExact = await phase2c26b2aReachability(view, reservation, origins, exact)
  const lanes = [atExact.lanes.normal, atExact.lanes.skill, atExact.lanes.gogma].filter(lane => lane !== null)
  const acceptedAtRequired = atExact.compatible && !atExact.inconsistent && lanes.every(lane => lane.productionLimitAccepts === true)
  const rejectedBelow: Partial<Phase2C26B2C2B1PerStream<boolean>> = {}
  for (const s of lowerable(required)) {
    const below = await phase2c26b2aReachability(view, reservation, origins, lower(exact, s))
    rejectedBelow[s] = below.compatible && below.lanes[s]?.productionLimitAccepts === false
  }
  return { compatible: atExact.compatible, acceptedAtRequired, rejectedBelow, valid: acceptedAtRequired && Object.values(rejectedBelow).every(Boolean) }
}

// ---------------------------------------------------------------- aggregates

export interface Phase2C26B2C2B1Stats { n: number; min: number | null; median: number | null; p75: number | null; p90: number | null; max: number | null }

export function phase2c26b2c2b1Stats(values: readonly number[]): Phase2C26B2C2B1Stats {
  return { n: values.length, min: values.length === 0 ? null : Math.min(...values), median: phase2c26b2c1Percentile(values, 50), p75: phase2c26b2c1Percentile(values, 75),
    p90: phase2c26b2c1Percentile(values, 90), max: values.length === 0 ? null : Math.max(...values) }
}

export type Phase2C26B2C2B1Cohort = 'E1' | 'E2'

export interface Phase2C26B2C2B1Row {
  targetWeaponId: string
  cohort: Phase2C26B2C2B1Cohort
  minimalCardinality: '1' | '2'
  p1FirstCompatibleRank: number
  p1FirstCompatibleReservationDigest: string
  route: { sourceKind: string; method: string; routeKind: string | null; conversion: boolean; operations: number }
  origins: Phase2C26B2AOrigins
  extent: Phase2C26B2C2B1RequiredExtent
  windowBoundary: Phase2C26B2C2B1Boundary
  walkBoundary: (Phase2C26B2C2B1Boundary & { compatible: boolean }) | null
  parity: { b2b1Extent: boolean; b2aExtent: boolean; b2c1Subgroups: boolean; b2c1P1Rank: boolean }
}

/** Required extent / shortage / rank distributions of one cohort. */
export function phase2c26b2c2b1CohortAggregate(rows: readonly Phase2C26B2C2B1Row[]) {
  const per = <T>(f: (s: Phase2C26B2AStream) => T) => Object.fromEntries(PHASE2C26B2C2B1_STREAMS.map(s => [s, f(s)])) as Phase2C26B2C2B1PerStream<T>
  return {
    targets: rows.length,
    insufficientTargetsByStream: per(s => rows.filter(r => r.extent.shortage[s] > 0).length),
    operatedTargetsByStream: per(s => rows.filter(r => r.extent.required[s] !== null).length),
    multiStreamInsufficient: rows.filter(r => r.extent.insufficientStreams.length > 1).length,
    insufficientCombination: countBy(rows, r => r.extent.insufficientStreams.join('+') || 'none'),
    /** Over the Targets that operate on the stream. */
    required: per(s => phase2c26b2c2b1Stats(rows.map(r => r.extent.required[s]).filter((v): v is number => v !== null))),
    /** Over the Targets insufficient on the stream. */
    shortage: per(s => phase2c26b2c2b1Stats(rows.filter(r => r.extent.shortage[s] > 0).map(r => r.extent.shortage[s]))),
    p1FirstCompatibleRank: phase2c26b2c2b1Stats(rows.map(r => r.p1FirstCompatibleRank)),
    sourceKind: countBy(rows, r => r.route.sourceKind),
    routeKind: countBy(rows, r => r.route.routeKind ?? 'unknown'),
    conversionRoutes: rows.filter(r => r.route.conversion).length,
  }
}

// ---------------------------------------------------------------- the ladder (registered rule)

/** The smallest power of two >= value (value >= 1). */
export function phase2c26b2c2b1NextPowerOfTwo(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`Invalid ladder value ${value}.`)
  let power = 1
  while (power < value) power *= 2
  return power
}

/** One rung value of one stream on the registered grid; null when the value is above the ceiling (unbounded). */
export function phase2c26b2c2b1GridValue(value: number | null, defaultValue: number, ceiling: number): number | null {
  if (defaultValue > ceiling) throw new RangeError(`The default ${defaultValue} exceeds the ceiling ${ceiling}.`)
  if (value === null || value <= defaultValue) return defaultValue
  if (value > ceiling) return null
  return Math.max(defaultValue, Math.min(phase2c26b2c2b1NextPowerOfTwo(value), ceiling))
}

export interface Phase2C26B2C2B1Rung { id: 'L0' | 'L1' | 'L2'; name: 'default' | 'intermediate' | 'larger'; extent: PlannerAlternativeSearchExtent }

export interface Phase2C26B2C2B1Ladder {
  /** Per stream, the E1 required values the rule reads (Targets insufficient on that stream only). */
  inputs: Phase2C26B2C2B1PerStream<{ values: number[]; median: number | null; max: number | null }>
  bounded: boolean
  unboundedStreams: Phase2C26B2AStream[]
  /** L0 / L1 / L2 after dedup (empty when unbounded). */
  rungs: Phase2C26B2C2B1Rung[]
}

/** The registered ladder over the E1 rows. */
export function phase2c26b2c2b1Ladder(e1: readonly Pick<Phase2C26B2C2B1Row, 'extent'>[], base: PlannerAlternativeSearchExtent, ceiling: PlannerAlternativeSearchExtent): Phase2C26B2C2B1Ladder {
  const inputs = Object.fromEntries(PHASE2C26B2C2B1_STREAMS.map(s => {
    const values = e1.filter(r => r.extent.shortage[s] > 0).map(r => r.extent.required[s]!).sort((a, b) => a - b)
    return [s, { values, median: phase2c26b2c1Percentile(values, 50), max: values.length === 0 ? null : values.at(-1)! }]
  })) as Phase2C26B2C2B1Ladder['inputs']
  const rung = (pick: (s: Phase2C26B2AStream) => number | null) => {
    const values = Object.fromEntries(PHASE2C26B2C2B1_STREAMS.map(s => [s, phase2c26b2c2b1GridValue(pick(s), base[EXTENT_KEY[s]], ceiling[EXTENT_KEY[s]])])) as Phase2C26B2C2B1PerStream<number | null>
    return { values, extent: { maxNormalAdvance: values.normal ?? 0, maxGogmaAdvance: values.gogma ?? 0, maxSkillAdvance: values.skill ?? 0 } }
  }
  const l1 = rung(s => inputs[s].median), l2 = rung(s => inputs[s].max)
  const unboundedStreams = PHASE2C26B2C2B1_STREAMS.filter(s => l1.values[s] === null || l2.values[s] === null)
  if (unboundedStreams.length > 0) return { inputs, bounded: false, unboundedStreams, rungs: [] }
  const candidates: Phase2C26B2C2B1Rung[] = [{ id: 'L0', name: 'default', extent: { ...base } }, { id: 'L1', name: 'intermediate', extent: l1.extent }, { id: 'L2', name: 'larger', extent: l2.extent }]
  const rungs = candidates.filter((r, i) => i === 0 || !same(r.extent, candidates[i - 1]!.extent))
  return { inputs, bounded: true, unboundedStreams: [], rungs }
}

/** Whether a Route of this required extent lies within one extent (the B2-A judgement: required <= value). */
export const phase2c26b2c2b1Covers = (required: Phase2C26B2C2B1PerStream<number | null>, extent: PlannerAlternativeSearchExtent) =>
  PHASE2C26B2C2B1_STREAMS.every(s => required[s] === null || required[s]! <= extent[EXTENT_KEY[s]])

/** Per rung: the Targets it covers (cumulative by construction of a monotone ladder) and each Target's first covering rung. */
export function phase2c26b2c2b1LadderCoverage(rungs: readonly Phase2C26B2C2B1Rung[], rows: readonly Pick<Phase2C26B2C2B1Row, 'targetWeaponId' | 'extent'>[]) {
  const firstRung = Object.fromEntries(rows.map(r => [r.targetWeaponId, rungs.find(rung => phase2c26b2c2b1Covers(r.extent.required, rung.extent))?.id ?? null]))
  return {
    byRung: rungs.map(rung => ({ id: rung.id, covered: rows.filter(r => phase2c26b2c2b1Covers(r.extent.required, rung.extent)).length, of: rows.length })),
    firstRungHistogram: countBy(rows, r => firstRung[r.targetWeaponId] ?? 'none'),
    firstRung,
  }
}

/** A ladder is monotone when every stream is non-decreasing rung to rung. */
export const phase2c26b2c2b1LadderMonotone = (rungs: readonly Phase2C26B2C2B1Rung[]) =>
  rungs.every((rung, i) => i === 0 || PHASE2C26B2C2B1_STREAMS.every(s => rung.extent[EXTENT_KEY[s]] >= rungs[i - 1]!.extent[EXTENT_KEY[s]]))

// ---------------------------------------------------------------- decision (registered before the formal run)

export function phase2c26b2c2b1Decision(input: { invalidReasons: readonly string[]; unreadableTargets: readonly string[]; ladderBounded: boolean; e1: number; e1CoveredByTopRung: number }) {
  if (!Number.isInteger(input.e1) || input.e1 < 0 || !Number.isInteger(input.e1CoveredByTopRung) || input.e1CoveredByTopRung < 0 || input.e1CoveredByTopRung > input.e1) {
    throw new Error(`Inconsistent Phase 2-C2.6-B2-C2B1 decision input: ${JSON.stringify(input)}`)
  }
  const reasons = [...input.invalidReasons]
  if (input.unreadableTargets.length === 0 && input.ladderBounded && input.e1CoveredByTopRung !== input.e1) reasons.push('ladder_top_rung_does_not_cover_e1')
  if (input.e1 === 0) reasons.push('no_e1_target')
  const caseId: Phase2C26B2C2B1DecisionCase = reasons.length > 0 ? 'B2C2B1_INVALID' : input.unreadableTargets.length > 0 ? 'B2C2B1_UNDETERMINED'
    : !input.ladderBounded ? 'B2C2B1_UNBOUNDED' : 'B2C2B1_CHARACTERIZED'
  return { case: caseId, reasons, recommendation: PHASE2C26B2C2B1_RECOMMENDATION[caseId] }
}

// ---------------------------------------------------------------- characterization (rows, parity, aggregates, ladder)

export interface Phase2C26B2C2B1CharacterizeInput {
  /** The B2-C1 audit rows of all 43 Routes (subgroups from the B2-B1 authority, P1 first compatible from the reach). */
  c1Rows: readonly Phase2C26B2C1RouteRow[]
  views: ReadonlyMap<string, Phase2C26B2ARouteView>
  originsOf: (view: Phase2C26B2ARouteView) => Phase2C26B2AOrigins
  reservationOfDigest: (digest: string) => PlannerAlternativeReservation | null
  extent: PlannerAlternativeSearchExtent
  b2b1Routes: readonly Pick<Phase2C26B2C1B2B1Route, 'targetWeaponId' | 'extent'>[]
  b2aRoutes: readonly Phase2C26B2C2B1B2AAuthority['routes'][number][]
  b2c1Routes: readonly Phase2C26B2C2AB2C1Route[]
  r2DefaultExtentTargetWeaponIds: readonly string[]
  routeKindOf: (targetWeaponId: string) => string | null
  ceiling?: PlannerAlternativeSearchExtent
  /** Tests only: a synthetic world's population and P1 rank ranges. The analyzer never passes them. */
  expected?: { extentInsufficient: number; e1: number; e2: number; defaultExtent: number; unreached: number }
  expectedRanks?: { e1MaxRank: number; e2MinRank: number; e2MaxRank: number }
  expectedByStream?: Phase2C26B2C2B1PerStream<number>
}

const extentRecord = (e: Pick<Phase2C26B2C2B1RequiredExtent, 'reach' | 'required' | 'verdict' | 'withinDefaultExtent'>) =>
  ({ withinDefaultExtent: e.withinDefaultExtent, verdict: e.verdict, required: e.required, reach: e.reach })

export async function phase2c26b2c2b1Characterize(input: Phase2C26B2C2B1CharacterizeInput) {
  const { c1Rows, views, extent } = input
  const expected = input.expected ?? PHASE2C26B2C2B1_EXPECTED_POPULATION
  const expectedRanks = input.expectedRanks ?? PHASE2C26B2C2B1_REGISTERED.b2c1P1
  const expectedByStream = input.expectedByStream ?? PHASE2C26B2C2B1_REGISTERED.b2b1ExtentByStream
  const ceiling = input.ceiling ?? PHASE2C26B2C2B1_LADDER_CEILING
  const invalidReasons: string[] = []
  if (!same(extent, { ...defaultPlannerAlternativeSearchExtent })) invalidReasons.push('extent: the calculation extent is not the Production default extent')

  // Population (post-hoc authority: the B2-B1 subgroups the B2-C1 audit recomputed).
  const has = (row: Phase2C26B2C1RouteRow, subgroup: string) => row.subgroups.includes(subgroup)
  const insufficient = c1Rows.filter(r => has(r, 'extentInsufficient'))
  const e1Ids = insufficient.filter(r => has(r, 'k1Minimal')).map(r => r.targetWeaponId).sort(compare)
  const e2Ids = insufficient.filter(r => has(r, 'k2Minimal')).map(r => r.targetWeaponId).sort(compare)
  const defaultIds = c1Rows.filter(r => has(r, 'defaultExtent')).map(r => r.targetWeaponId).sort(compare)
  const unreachedIds = c1Rows.filter(r => has(r, 'unreached')).map(r => r.targetWeaponId).sort(compare)
  const counts = { extentInsufficient: insufficient.length, e1: e1Ids.length, e2: e2Ids.length, defaultExtent: defaultIds.length, unreached: unreachedIds.length }
  if (!same(counts, expected)) invalidReasons.push(`population: ${JSON.stringify(counts)} is not the registered ${JSON.stringify(expected)}`)
  if (insufficient.some(r => has(r, 'k1Minimal') === has(r, 'k2Minimal'))) invalidReasons.push('population: an extent-insufficient Target is not exactly one of K1-minimal / K2-minimal')
  const insufficientSet = new Set(insufficient.map(r => r.targetWeaponId))
  if (defaultIds.some(id => insufficientSet.has(id)) || unreachedIds.some(id => insufficientSet.has(id))) invalidReasons.push('population: an extent-insufficient Target is also defaultExtent / unreached')
  if (!same([...input.r2DefaultExtentTargetWeaponIds].sort(compare), defaultIds)) invalidReasons.push('population: the R2 default-extent Targets are not the defaultExtent subgroup')
  if (input.r2DefaultExtentTargetWeaponIds.some(id => insufficientSet.has(id))) invalidReasons.push('population: an R2 default-extent Target is extent-insufficient')

  // B2-C1 RESULT parity for every Route: subgroups and the P1 first compatible context.
  const b2c1ById = new Map(input.b2c1Routes.map(r => [r.targetWeaponId, r]))
  if (input.b2c1Routes.length !== c1Rows.length || c1Rows.some(r => !b2c1ById.has(r.targetWeaponId))) invalidReasons.push('b2c1_parity: the B2-C1 RESULT Routes are not the audited Routes')
  const b2b1ById = new Map(input.b2b1Routes.map(r => [r.targetWeaponId, r]))
  const b2aById = new Map(input.b2aRoutes.map(r => [r.targetWeaponId, r]))
  if (input.b2aRoutes.length !== c1Rows.length || c1Rows.some(r => !b2aById.has(r.targetWeaponId))) invalidReasons.push('b2a_parity: the B2-A RESULT Routes are not the audited Routes')

  const rows: Phase2C26B2C2B1Row[] = []
  const unreadableTargets: string[] = []
  for (const c1 of [...c1Rows].sort((a, b) => compare(a.targetWeaponId, b.targetWeaponId))) {
    const view = views.get(c1.targetWeaponId)
    const b2c1 = b2c1ById.get(c1.targetWeaponId)
    const p1 = c1.reach.firstCompatible[PHASE2C26B2C2B1_ORDERING_POLICY]
    const subgroupsMatch = b2c1 !== undefined && same(b2c1.subgroups, c1.subgroups)
    const rankMatch = b2c1 !== undefined && b2c1.p1FirstCompatible.rank === p1.rank && b2c1.p1FirstCompatible.reservationDigest === p1.reservationDigest
    if (!subgroupsMatch) invalidReasons.push(`b2c1_parity: ${c1.targetWeaponId}: subgroups differ from the B2-C1 RESULT`)
    if (!rankMatch) invalidReasons.push(`b2c1_parity: ${c1.targetWeaponId}: the P1 first compatible context differs from the B2-C1 RESULT`)
    if (!view) { invalidReasons.push(`views: ${c1.targetWeaponId}: no oracle Route`); continue }
    const origins = input.originsOf(view)
    const required = phase2c26b2c2b1RequiredExtent(view, origins, extent)
    const b2b1 = b2b1ById.get(c1.targetWeaponId), b2a = b2aById.get(c1.targetWeaponId)
    const b2b1Match = b2b1 !== undefined && same(extentRecord(required), b2b1.extent)
    const b2aMatch = b2a !== undefined && same({ ...extentRecord(required), estimatedMatches: required.estimatedMatches }, b2a.extent)
    if (!b2b1Match) invalidReasons.push(`extent_parity: ${c1.targetWeaponId}: the required extent differs from B2-B1`)
    if (!b2aMatch) invalidReasons.push(`extent_parity: ${c1.targetWeaponId}: the required extent differs from B2-A`)
    if (!required.estimatedMatches) invalidReasons.push(`extent_parity: ${c1.targetWeaponId}: the oracle estimated advances are not reproduced`)
    // Recovered Routes only: an unreached Route is neither defaultExtent nor extentInsufficient whatever its extent. An
    // unreadable stream makes the verdict meaningless; that Target is UNDETERMINED, not a semantic mismatch.
    if (has(c1, 'recovered') && required.unreadableStreams.length === 0 && has(c1, 'extentInsufficient') === required.withinDefaultExtent) invalidReasons.push(`extent_semantics: ${c1.targetWeaponId}: the extentInsufficient subgroup disagrees with the required extent`)
    if (!has(c1, 'extentInsufficient')) continue

    const cohort: Phase2C26B2C2B1Cohort = has(c1, 'k1Minimal') ? 'E1' : 'E2'
    if (required.unreadableStreams.length > 0) unreadableTargets.push(c1.targetWeaponId)
    else if (required.insufficientStreams.length === 0) invalidReasons.push(`extent_semantics: ${c1.targetWeaponId}: extent-insufficient with no insufficient stream`)
    if (p1.rank === null || p1.reservationDigest === null) { invalidReasons.push(`rank: ${c1.targetWeaponId}: an extent-insufficient Target has no P1 first compatible context`); continue }
    const windowBoundary = phase2c26b2c2b1WindowBoundary(view, origins, required.required, extent)
    const reservation = input.reservationOfDigest(p1.reservationDigest)
    const walkBoundary = reservation === null ? null : await phase2c26b2c2b1WalkBoundary(view, reservation, origins, required.required, extent)
    if (required.unreadableStreams.length === 0) {
      if (!windowBoundary.valid) invalidReasons.push(`boundary: ${c1.targetWeaponId}: the B2-C1 window boundary is not at the required extent ${JSON.stringify(windowBoundary)}`)
      if (walkBoundary === null) invalidReasons.push(`boundary: ${c1.targetWeaponId}: the P1 first compatible reservation is not in the schedule`)
      else if (!walkBoundary.compatible || !walkBoundary.valid) invalidReasons.push(`boundary: ${c1.targetWeaponId}: the Production walk boundary is not at the required extent ${JSON.stringify(walkBoundary)}`)
    }
    rows.push({
      targetWeaponId: c1.targetWeaponId, cohort, minimalCardinality: cohort === 'E1' ? '1' : '2', p1FirstCompatibleRank: p1.rank, p1FirstCompatibleReservationDigest: p1.reservationDigest,
      route: { sourceKind: view.sourceKind, method: view.method, routeKind: input.routeKindOf(c1.targetWeaponId), conversion: view.conversion !== null, operations: view.operations.length },
      origins, extent: required, windowBoundary, walkBoundary,
      parity: { b2b1Extent: b2b1Match, b2aExtent: b2aMatch, b2c1Subgroups: subgroupsMatch, b2c1P1Rank: rankMatch },
    })
  }

  const e1 = rows.filter(r => r.cohort === 'E1'), e2 = rows.filter(r => r.cohort === 'E2')
  if (e1.some(r => r.p1FirstCompatibleRank > expectedRanks.e1MaxRank)) invalidReasons.push(`rank: an E1 P1 first compatible rank exceeds the registered ${expectedRanks.e1MaxRank}`)
  if (e2.length > 0 && (Math.min(...e2.map(r => r.p1FirstCompatibleRank)) !== expectedRanks.e2MinRank || Math.max(...e2.map(r => r.p1FirstCompatibleRank)) !== expectedRanks.e2MaxRank)) {
    invalidReasons.push(`rank: the E2 P1 first compatible ranks are not the registered ${expectedRanks.e2MinRank}..${expectedRanks.e2MaxRank}`)
  }
  const all = phase2c26b2c2b1CohortAggregate(rows)
  if (unreadableTargets.length === 0 && !same(all.insufficientTargetsByStream, { normal: expectedByStream.normal, gogma: expectedByStream.gogma, skill: expectedByStream.skill })) {
    invalidReasons.push(`aggregate: the insufficient Targets by stream ${JSON.stringify(all.insufficientTargetsByStream)} are not the registered B2-B1 ${JSON.stringify(expectedByStream)}`)
  }
  const ladder = unreadableTargets.length > 0 ? null : phase2c26b2c2b1Ladder(e1, extent, ceiling)
  if (ladder && ladder.bounded && !phase2c26b2c2b1LadderMonotone(ladder.rungs)) invalidReasons.push('ladder: the ladder is not monotone')
  const coverage = ladder && ladder.bounded ? { e1: phase2c26b2c2b1LadderCoverage(ladder.rungs, e1), e2Diagnostic: phase2c26b2c2b1LadderCoverage(ladder.rungs, e2) } : null
  const top = coverage?.e1.byRung.at(-1)
  return {
    rows, invalidReasons, unreadableTargets: unreadableTargets.sort(compare),
    cohorts: { counts, e1: e1Ids, e2: e2Ids },
    aggregates: { all, e1: phase2c26b2c2b1CohortAggregate(e1), e2: phase2c26b2c2b1CohortAggregate(e2) },
    ladder, coverage,
    decisionInput: { unreadableTargets: unreadableTargets.sort(compare), ladderBounded: ladder?.bounded ?? false, e1: e1.length, e1CoveredByTopRung: top?.covered ?? 0 },
  }
}

// ---------------------------------------------------------------- the whole audit

export interface Phase2C26B2C2B1AuditInput {
  calculation: Phase2C26B2C2B1Calculation
  b2b1: Phase2C26B2C1B2B1Authority
  b2c1: Phase2C26B2C2AB2C1Authority
  b2a: Phase2C26B2C2B1B2AAuthority
  r2: Phase2C26B2C2B1R2Authority
  manifest: readonly Phase2C26B2AOracleRouteSpec[]
  oracle: Phase2C26B2AOracle
  sha: (value: string) => string
}

/**
 * The calculation re-read (the B2-C1 schedule consistency, B2-B1 parity, every oracle Route against every context of its
 * Target - the unchanged B2-C1 audit - and the P1 ordering projection recomputed), then the extent characterization.
 */
export async function runPhase2C26B2C2B1Audit({ calculation, b2b1, b2c1, b2a, r2, manifest, oracle, sha }: Phase2C26B2C2B1AuditInput) {
  const schedule = calculation.schedule
  const invalidReasons: string[] = []
  const recomputed = phase2c26b2c2b1CalculationFromSchedule(schedule)
  if (calculation.orderingPolicy !== PHASE2C26B2C2B1_ORDERING_POLICY) invalidReasons.push('calculation: the ordering policy is not P1')
  if (!same(recomputed.p1Ordering, calculation.p1Ordering)) invalidReasons.push('calculation: the P1 ordering projection drifts from the schedule')
  for (const [check, ok] of Object.entries(calculation.checks)) if (ok !== true) invalidReasons.push(`calculation: check ${check} failed`)
  if (!same(recomputed.checks, calculation.checks)) invalidReasons.push('calculation: the recorded checks are not the recomputed checks')
  const c1 = await runPhase2C26B2C1Audit({ schedule, authority: b2b1, manifest, oracle, sha })
  invalidReasons.push(...c1.invalidReasons.map(i => `b2c1_audit: ${i}`))
  const weaponTypeOf = new Map(oracle.routes.map(route => [route.targetWeaponId, route.weaponTypeId]))
  const routeKindOf = new Map(oracle.routes.map(route => [route.targetWeaponId, route.materialization.routeKind]))
  const views = new Map(manifest.map(spec => [spec.targetWeaponId, phase2c26b2aRouteView(spec, weaponTypeOf.get(spec.targetWeaponId)!)] as const))
  const groupsByDigest = new Map(schedule.snapshot.reservationGroups.map(group => [group.reservationDigest, group.reservation]))
  const characterization = await phase2c26b2c2b1Characterize({
    c1Rows: c1.rows, views,
    originsOf: view => ({ skill: schedule.origins.skill, gogma: schedule.origins.gogma, normal: schedule.snapshot.origin.normalCounters.find(c => c.counterId === view.normalCounterId)?.counter ?? null }),
    reservationOfDigest: digest => groupsByDigest.get(digest) ?? null,
    extent: schedule.extent, b2b1Routes: b2b1.routes, b2aRoutes: b2a.routes, b2c1Routes: b2c1.routes, r2DefaultExtentTargetWeaponIds: r2.defaultExtentTargetWeaponIds,
    routeKindOf: id => routeKindOf.get(id) ?? null,
  })
  invalidReasons.push(...characterization.invalidReasons)
  return { c1, characterization, invalidReasons }
}
