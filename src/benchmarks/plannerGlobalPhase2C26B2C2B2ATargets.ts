/**
 * Issue #154 Phase 2-C2.6-B2-C2B2A: the E1 population and its authority chain. Research only. Never import from
 * Production, and never from the B2-C2B2A Search side's runner (the Search module never imports this one).
 *
 * The E1 population is B2-C2B1's cohort `E1` (extent-insufficient AND K1-minimal, 11 Targets), which B2-C2B1 derived post
 * hoc from the B2-C1 subgroups (themselves read from oracle evidence): `oracleGuidedTargetPopulation = true`. The common L2
 * extent is B2-C2B1's ladder rung L2, read from the E1 cohort required extents post hoc: `oracleInformedLadder = true`.
 * This module turns that RESULT into a manifest of Target IDs only; no rank, digest, first-compatible context, required
 * extent, ladder rung or oracle field reaches the Search runner. The analyzer reuses the parsers below after the run.
 */
import { stableStringify } from '../domain/models/hashing'
import { defaultPlannerAlternativeSearchExtent } from '../domain/search'
import { PHASE2C26B2C2A_REGISTERED_B2C1, type Phase2C26B2C2AB2C1Authority } from './plannerGlobalPhase2C26B2C2ATargets'
import { phase2c26b2c2b1HashChainIssues, PHASE2C26B2C2B1_REGISTERED } from './plannerGlobalPhase2C26B2C2B1Analysis'
import {
  PHASE2C26B2C2B2A_CONTEXT_BUDGET,
  PHASE2C26B2C2B2A_EXTENT,
  PHASE2C26B2C2B2A_REGISTERED_P1,
  PHASE2C26B2C2B2A_TARGET_SOURCE,
  PHASE2C26B2C2B2A_TARGETS,
  type Phase2C26B2C2B2ATargetManifest,
} from './plannerGlobalPhase2C26B2C2B2A'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const SHA256 = /^[0-9a-f]{64}$/
const COMMIT = /^[0-9a-f]{40}$/

// ---------------------------------------------------------------- the B2-C2B1 RESULT (population and extent authority)

/** The B2-C2B1 result this phase is registered against. Any other value fails closed. */
export const PHASE2C26B2C2B2A_REGISTERED_B2C2B1 = {
  resultSha256: PHASE2C26B2C2B2A_TARGET_SOURCE.resultSha256,
  decisionCase: 'B2C2B1_CHARACTERIZED',
  counts: { extentInsufficient: 20, e1: 11, e2: 9, defaultExtent: 20, unreached: 3 },
  e1P1RankMax: 32,
  e2P1Ranks: { min: 50, max: 306 },
  rungs: [
    { id: 'L0', name: 'default', extent: { ...defaultPlannerAlternativeSearchExtent } },
    { id: 'L1', name: 'intermediate', extent: { maxNormalAdvance: 8, maxGogmaAdvance: 235, maxSkillAdvance: 256 } },
    { id: 'L2', name: 'larger', extent: { ...PHASE2C26B2C2B2A_EXTENT } },
  ],
  e1Coverage: [{ id: 'L0', covered: 0, of: 11 }, { id: 'L1', covered: 7, of: 11 }, { id: 'L2', covered: 11, of: 11 }],
  /** The predecessor RESULTs B2-C2B1 recorded. */
  b2c1ResultSha256: PHASE2C26B2C2B1_REGISTERED.b2c1.resultSha256,
  b2b1ResultSha256: PHASE2C26B2C2B1_REGISTERED.b2c1.b2b1ResultSha256,
  b2aResultSha256: PHASE2C26B2C2B1_REGISTERED.b2a.resultSha256,
  r2ResultSha256: PHASE2C26B2C2B1_REGISTERED.r2.resultSha256,
} as const

export interface Phase2C26B2C2B2AB2C2B1Route {
  targetWeaponId: string
  cohort: 'E1' | 'E2'
  /** B2-C1's P1 first reservation-compatible rank (post-hoc; the analyzer reads it, the Search never does). */
  p1FirstCompatibleRank: number
  firstLadderRung: string | null
}

export interface Phase2C26B2C2B2AB2C2B1Authority {
  resultSha256: string
  measuredHead: string
  analysisHead: string
  exportSha256: string
  b2c1ResultSha256: string
  b2b1ResultSha256: string
  b2aResultSha256: string
  r2ResultSha256: string
  oracleResultSha256: string
  oracleManifestFileSha256: string
  oracleManifestRoutesSha256: string
  e1: string[]
  e2: string[]
  routes: Phase2C26B2C2B2AB2C2B1Route[]
}

/**
 * Reads the committed B2-C2B1 RESULT as untrusted JSON and fails closed unless it is the registered formal result: its own
 * SHA-256; formal, analysis committed, no calculation change after its measured HEAD; the oracle-free calculation and
 * no-individual-extent declarations; case B2C2B1_CHARACTERIZED with no reason and no invalid reason; no unreadable Target;
 * the registered predecessors and an internally agreeing hash chain; the registered P1; the registered population counts;
 * 20 readable Route rows whose cohorts are the recorded E1 / E2 lists (disjoint, 11 / 9), E1 ranks <= 32 with maximum 32,
 * E2 ranks 50..306; the ladder exactly L0 / L1 / L2 with the registered extents (L2 = 128 / 235 / 1500), and E1 coverage
 * 0 / 7 / 11 of 11 with every E1 Route's first rung L1 or L2.
 */
export function parsePhase2C26B2C2B2AB2C2B1Authority(json: unknown, resultSha256: string): { valid: boolean; issues: string[]; authority: Phase2C26B2C2B2AB2C2B1Authority | null } {
  const reg = PHASE2C26B2C2B2A_REGISTERED_B2C2B1
  const issues: string[] = []
  if (!isObject(json) || !isObject(json.provenance) || !isObject(json.decision) || !isObject(json.cohorts) || !isObject(json.ladder) || !isObject(json.ladderCoverage)
    || !isObject(json.conditions) || !isObject(json.hashChain)) {
    return { valid: false, issues: ['B2-C2B1 RESULT lacks provenance / decision / cohorts / ladder / ladderCoverage / conditions / hashChain'], authority: null }
  }
  const { provenance, decision, cohorts, ladder, ladderCoverage, conditions, hashChain } = json
  if (resultSha256 !== reg.resultSha256) issues.push(`B2-C2B1 RESULT SHA-256 ${resultSha256} is not the registered ${reg.resultSha256}`)
  if (provenance.formal !== true) issues.push('provenance.formal is not true')
  if (!Array.isArray(provenance.calculationCodeChangedSinceMeasuredHead) || provenance.calculationCodeChangedSinceMeasuredHead.length !== 0) issues.push('provenance.calculationCodeChangedSinceMeasuredHead is not empty')
  if (provenance.uncommittedBenchmarkCode !== false) issues.push('provenance.uncommittedBenchmarkCode is not false')
  if (provenance.analysisCodeUncommitted !== false) issues.push('provenance.analysisCodeUncommitted is not false')
  if (provenance.oracleReadByCalculation !== false) issues.push('provenance.oracleReadByCalculation is not false')
  if (provenance.targetIndividualOracleExtentAsSearchInput !== false) issues.push('provenance.targetIndividualOracleExtentAsSearchInput is not false')
  if (provenance.oracleFedBackToCalculation !== false) issues.push('provenance.oracleFedBackToCalculation is not false')
  for (const field of ['measuredHead', 'analysisHead'] as const) if (typeof provenance[field] !== 'string' || !COMMIT.test(provenance[field] as string)) issues.push(`provenance.${field} is not a commit SHA`)
  for (const field of ['exportSha256', 'b2c1ResultSha256', 'b2b1ResultSha256', 'b2aResultSha256', 'r2ResultSha256', 'oracleResultSha256', 'oracleManifestFileSha256', 'oracleManifestRoutesSha256'] as const) {
    if (typeof provenance[field] !== 'string' || !SHA256.test(provenance[field] as string)) issues.push(`provenance.${field} is not a SHA-256`)
  }
  for (const field of ['b2c1ResultSha256', 'b2b1ResultSha256', 'b2aResultSha256', 'r2ResultSha256'] as const) if (provenance[field] !== reg[field]) issues.push(`provenance.${field} is not the registered predecessor`)
  // The hash chain B2-C2B1 recorded must agree with itself and with its provenance.
  const chainIssues = phase2c26b2c2b1HashChainIssues(hashChain as never)
  issues.push(...chainIssues.map(i => `hashChain: ${i}`))
  if (!Array.isArray(json.hashChainIssues) || json.hashChainIssues.length !== 0) issues.push('hashChainIssues is not empty')
  for (const field of ['exportSha256', 'oracleResultSha256', 'oracleManifestFileSha256', 'oracleManifestRoutesSha256', 'b2c1ResultSha256', 'b2b1ResultSha256'] as const) {
    const recorders = isObject(hashChain[field]) ? Object.values(hashChain[field] as Json) : []
    if (recorders.length === 0 || recorders.some(value => value !== provenance[field])) issues.push(`hashChain.${field} is not the provenance value`)
  }
  if (decision.case !== reg.decisionCase) issues.push(`decision.case ${String(decision.case)} is not ${reg.decisionCase}`)
  if (!Array.isArray(decision.reasons) || decision.reasons.length !== 0) issues.push('decision.reasons is not empty')
  if (!Array.isArray(json.invalidReasons) || json.invalidReasons.length !== 0) issues.push('invalidReasons is not empty')
  if (!Array.isArray(json.unreadableTargets) || json.unreadableTargets.length !== 0) issues.push('unreadableTargets is not empty')
  if (conditions.orderingPolicy !== 'P1' || !same(conditions.p1, PHASE2C26B2C2B2A_REGISTERED_P1)) issues.push('conditions: the ordering policy is not the registered P1')
  if (!same(conditions.defaultExtent, { ...defaultPlannerAlternativeSearchExtent })) issues.push('conditions.defaultExtent is not the Production default extent')
  if (!same(cohorts.counts, reg.counts)) issues.push(`cohorts.counts ${JSON.stringify(cohorts.counts)} is not the registered ${JSON.stringify(reg.counts)}`)

  const routes: Phase2C26B2C2B2AB2C2B1Route[] = []
  for (const raw of asArray(json.routes)) {
    if (!isObject(raw) || typeof raw.targetWeaponId !== 'string' || (raw.cohort !== 'E1' && raw.cohort !== 'E2') || raw.minimalCardinality !== (raw.cohort === 'E1' ? '1' : '2')
      || !Number.isSafeInteger(raw.p1FirstCompatibleRank) || (raw.p1FirstCompatibleRank as number) < 1 || !(raw.firstLadderRung === null || typeof raw.firstLadderRung === 'string')) {
      issues.push('a B2-C2B1 route row is malformed'); continue
    }
    routes.push({ targetWeaponId: raw.targetWeaponId, cohort: raw.cohort, p1FirstCompatibleRank: raw.p1FirstCompatibleRank as number, firstLadderRung: raw.firstLadderRung as string | null })
  }
  if (routes.length !== reg.counts.extentInsufficient || new Set(routes.map(r => r.targetWeaponId)).size !== routes.length) issues.push(`B2-C2B1 routes are not ${reg.counts.extentInsufficient} distinct Routes`)
  const ids = (cohort: 'E1' | 'E2') => routes.filter(r => r.cohort === cohort).map(r => r.targetWeaponId).sort(compare)
  const e1 = ids('E1'), e2 = ids('E2')
  const listed = (value: unknown) => asArray(value).every(id => typeof id === 'string') ? (asArray(value) as string[]) : null
  const recordedE1 = listed(cohorts.e1), recordedE2 = listed(cohorts.e2)
  if (!recordedE1 || !same(recordedE1, [...recordedE1].sort(compare)) || !same(recordedE1, e1)) issues.push('cohorts.e1 is not the sorted E1 Route list')
  if (!recordedE2 || !same(recordedE2, [...recordedE2].sort(compare)) || !same(recordedE2, e2)) issues.push('cohorts.e2 is not the sorted E2 Route list')
  if (e1.length !== reg.counts.e1 || e2.length !== reg.counts.e2) issues.push(`E1 / E2 hold ${e1.length} / ${e2.length} Routes, not ${reg.counts.e1} / ${reg.counts.e2}`)
  if (e1.some(id => e2.includes(id))) issues.push('an E1 Target is also E2')
  const e1Ranks = routes.filter(r => r.cohort === 'E1').map(r => r.p1FirstCompatibleRank)
  const e2Ranks = routes.filter(r => r.cohort === 'E2').map(r => r.p1FirstCompatibleRank)
  if (e1Ranks.length > 0 && Math.max(...e1Ranks) !== reg.e1P1RankMax) issues.push(`the E1 P1 first compatible rank maximum is not ${reg.e1P1RankMax}`)
  if (e1Ranks.some(rank => rank > PHASE2C26B2C2B2A_CONTEXT_BUDGET)) issues.push(`an E1 P1 first compatible rank exceeds the context budget ${PHASE2C26B2C2B2A_CONTEXT_BUDGET}`)
  if (e2Ranks.length > 0 && (Math.min(...e2Ranks) !== reg.e2P1Ranks.min || Math.max(...e2Ranks) !== reg.e2P1Ranks.max)) issues.push(`the E2 P1 first compatible ranks are not ${reg.e2P1Ranks.min}..${reg.e2P1Ranks.max}`)
  // The ladder and its E1 coverage: exactly L0 / L1 / L2, L2 the common Search extent, covering every E1 Target.
  if (ladder.bounded !== true || !Array.isArray(ladder.unboundedStreams) || ladder.unboundedStreams.length !== 0) issues.push('ladder is not bounded')
  if (!same(ladder.rungs, reg.rungs)) issues.push('ladder.rungs is not exactly the registered L0 / L1 / L2')
  const e1Coverage = isObject(ladderCoverage.e1) ? ladderCoverage.e1 : {}
  if (!same(e1Coverage.byRung, reg.e1Coverage)) issues.push('ladderCoverage.e1.byRung is not the registered 0 / 7 / 11 of 11')
  if (routes.some(r => r.cohort === 'E1' && r.firstLadderRung !== 'L1' && r.firstLadderRung !== 'L2')) issues.push('an E1 Route is not covered by L1 or L2')
  if (issues.length > 0) return { valid: false, issues, authority: null }
  return { valid: true, issues: [], authority: {
    resultSha256, measuredHead: String(provenance.measuredHead), analysisHead: String(provenance.analysisHead), exportSha256: String(provenance.exportSha256),
    b2c1ResultSha256: String(provenance.b2c1ResultSha256), b2b1ResultSha256: String(provenance.b2b1ResultSha256), b2aResultSha256: String(provenance.b2aResultSha256),
    r2ResultSha256: String(provenance.r2ResultSha256), oracleResultSha256: String(provenance.oracleResultSha256), oracleManifestFileSha256: String(provenance.oracleManifestFileSha256),
    oracleManifestRoutesSha256: String(provenance.oracleManifestRoutesSha256), e1, e2, routes,
  } }
}

// ---------------------------------------------------------------- the population, cross-checked against the B2-C1 RESULT

/**
 * The E1 population re-derived from both authorities: the B2-C1 Routes with subgroups extentInsufficient AND k1Minimal must
 * be exactly the B2-C2B1 E1 list; each is recovered and none is defaultExtent / unreached / k2Minimal; the E2 list is the
 * B2-C1 extentInsufficient AND k2Minimal set; and the two RESULTs name the same B2-C1 RESULT, B2-B1 RESULT and Export.
 */
export function phase2c26b2c2b2aPopulation(b2c2b1: Phase2C26B2C2B2AB2C2B1Authority, b2c1: Phase2C26B2C2AB2C1Authority): { valid: boolean; issues: string[]; e1: string[] } {
  const issues: string[] = []
  if (b2c2b1.b2c1ResultSha256 !== b2c1.resultSha256 || b2c1.resultSha256 !== PHASE2C26B2C2A_REGISTERED_B2C1.resultSha256) issues.push('the B2-C1 RESULT is not the one B2-C2B1 recorded')
  if (b2c2b1.b2b1ResultSha256 !== b2c1.b2b1ResultSha256) issues.push('B2-C2B1 and B2-C1 record different B2-B1 RESULTs')
  if (b2c2b1.exportSha256 !== b2c1.exportSha256) issues.push('B2-C2B1 and B2-C1 record different Exports')
  if (b2c2b1.oracleResultSha256 !== b2c1.oracleResultSha256 || b2c2b1.oracleManifestFileSha256 !== b2c1.oracleManifestFileSha256 || b2c2b1.oracleManifestRoutesSha256 !== b2c1.oracleManifestRoutesSha256) {
    issues.push('B2-C2B1 and B2-C1 record different oracle / manifest SHA-256s')
  }
  const has = (subgroups: readonly string[], name: string) => subgroups.includes(name)
  const c1E1 = b2c1.routes.filter(r => has(r.subgroups, 'extentInsufficient') && has(r.subgroups, 'k1Minimal')).map(r => r.targetWeaponId).sort(compare)
  const c1E2 = b2c1.routes.filter(r => has(r.subgroups, 'extentInsufficient') && has(r.subgroups, 'k2Minimal')).map(r => r.targetWeaponId).sort(compare)
  if (!same(c1E1, b2c2b1.e1)) issues.push('the B2-C1 extentInsufficient AND k1Minimal Routes are not the B2-C2B1 E1 list')
  if (!same(c1E2, b2c2b1.e2)) issues.push('the B2-C1 extentInsufficient AND k2Minimal Routes are not the B2-C2B1 E2 list')
  for (const id of b2c2b1.e1) {
    const route = b2c1.routes.find(r => r.targetWeaponId === id)
    if (!route) { issues.push(`${id}: not a B2-C1 Route`); continue }
    if (!has(route.subgroups, 'recovered')) issues.push(`${id}: an E1 Target is not recovered`)
    for (const other of ['defaultExtent', 'unreached', 'k2Minimal']) if (has(route.subgroups, other)) issues.push(`${id}: an E1 Target is also ${other}`)
    const b2c2b1Route = b2c2b1.routes.find(r => r.targetWeaponId === id)
    if (!b2c2b1Route || route.p1FirstCompatible.rank !== b2c2b1Route.p1FirstCompatibleRank) issues.push(`${id}: B2-C1 and B2-C2B1 record different P1 first compatible ranks`)
  }
  const defaultIds = new Set(b2c1.routes.filter(r => has(r.subgroups, 'defaultExtent')).map(r => r.targetWeaponId))
  const unreachedIds = new Set(b2c1.routes.filter(r => has(r.subgroups, 'unreached')).map(r => r.targetWeaponId))
  if (b2c2b1.e1.some(id => defaultIds.has(id) || unreachedIds.has(id) || b2c2b1.e2.includes(id))) issues.push('the E1 population overlaps defaultExtent / unreached / E2')
  if (b2c2b1.e1.length !== PHASE2C26B2C2B2A_TARGETS) issues.push(`E1 holds ${b2c2b1.e1.length} Targets, not ${PHASE2C26B2C2B2A_TARGETS}`)
  return { valid: issues.length === 0, issues, e1: issues.length === 0 ? [...b2c2b1.e1] : [] }
}

/**
 * The E1 Target manifest from the two parsed authorities: the E1 Target IDs in ascending order, and nothing of their ranks,
 * digests, required extents, ladder rungs or oracle comparison.
 */
export function phase2c26b2c2b2aTargetManifest(b2c2b1: Phase2C26B2C2B2AB2C2B1Authority, b2c1: Phase2C26B2C2AB2C1Authority): Phase2C26B2C2B2ATargetManifest {
  const population = phase2c26b2c2b2aPopulation(b2c2b1, b2c1)
  if (!population.valid) throw new Error(`The E1 population is not valid: ${population.issues.join('; ')}`)
  return { phase: 'Issue #154 Phase 2-C2.6-B2-C2B2A E1 Target manifest (B2-C2B1 cohort E1 = extentInsufficient AND k1Minimal; Target IDs only)',
    sourceResultSha256: b2c2b1.resultSha256, population: 'E1', policy: 'P1', contextBudget: PHASE2C26B2C2B2A_CONTEXT_BUDGET, exportSha256: b2c2b1.exportSha256,
    targetWeaponIds: [...population.e1].sort(compare) }
}
