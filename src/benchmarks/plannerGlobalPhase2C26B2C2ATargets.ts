/**
 * Issue #154 Phase 2-C2.6-B2-C2A: the validation population and the authority chain. Research only. Never import from
 * Production, and never from the B2-C2A Search side (`plannerGlobalPhase2C26B2C2A.ts` and its runner).
 *
 * The validation population is the B2-C1 RESULT's post-hoc subgroup `defaultExtent` (20 Targets whose oracle Route is
 * reservation-compatible with some P1 context and lies inside the Production default extent). Choosing that population,
 * like choosing P1 itself, read B2-C1's oracle evaluation: `oracleGuidedTargetPopulation = true` and
 * `oracleGuidedPolicySelection = true`. This module turns that RESULT into a manifest of Target IDs only; the Search runner
 * reads the manifest, never the RESULT, and nothing here passes a rank, a digest, a first-compatible context or an oracle
 * field to it. The analyzer reuses the parsers below to re-check the whole hash chain after the run.
 */
import { stableStringify } from '../domain/models/hashing'
import { PHASE2C26B2C1_REGISTERED_POLICIES } from './plannerGlobalPhase2C26B2C1Analysis'
import {
  PHASE2C26B2C2A_CONTEXT_BUDGET,
  PHASE2C26B2C2A_REGISTERED_P1,
  PHASE2C26B2C2A_TARGET_SOURCE,
  PHASE2C26B2C2A_VALIDATION_TARGETS,
  type Phase2C26B2C2ATargetManifest,
} from './plannerGlobalPhase2C26B2C2A'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const SHA256 = /^[0-9a-f]{64}$/
const COMMIT = /^[0-9a-f]{40}$/

// ---------------------------------------------------------------- the B2-C1 RESULT (population authority)

/** The B2-C1 result this phase is registered against. Any other value fails closed. */
export const PHASE2C26B2C2A_REGISTERED_B2C1 = {
  resultSha256: PHASE2C26B2C2A_TARGET_SOURCE.resultSha256,
  decisionCase: 'B2C1_WIDE',
  selectedPolicy: 'P1',
  subgroups: { recovered: 40, defaultExtent: 20, extentInsufficient: 20, k1Minimal: 31, k2Minimal: 9, unreached: 3 },
  /** `policyAggregates.P1.defaultExtent`. */
  defaultExtentP1: { targets: 20, finite: 20, top16: 20, max: 11 },
  /** The predecessor RESULTs B2-C1 recorded. */
  b2b1ResultSha256: '5a56ab010828519df00e7084c8b9cf6bd9276ad7425f609d520ba1392071309d',
  b2b2a2ResultSha256: 'd3a81b8f65033d8d05d72971e621ae8f4c3bc336a8a9b3f6edcc95c34880285b',
} as const

/** The B2-B2A2 result B2-C1 recorded (hash chain only). */
export const PHASE2C26B2C2A_REGISTERED_B2B2A2 = {
  resultSha256: PHASE2C26B2C2A_REGISTERED_B2C1.b2b2a2ResultSha256,
  decisionCase: 'B2B2A2_ALL_LATE_EXACT',
} as const

export interface Phase2C26B2C2AB2C1Route {
  targetWeaponId: string
  subgroups: string[]
  /** B2-C1's P1 first reservation-compatible context (post-hoc; the analyzer reads it, the Search never does). */
  p1FirstCompatible: { rank: number | null; reservationDigest: string | null; cardinality: number | null; representativeFixedSetId: string | null }
}

export interface Phase2C26B2C2AB2C1Authority {
  resultSha256: string
  measuredHead: string
  analysisHead: string
  exportSha256: string
  b2b1ResultSha256: string
  b2b2a2ResultSha256: string
  oracleResultSha256: string
  oracleManifestFileSha256: string
  oracleManifestRoutesSha256: string
  routes: Phase2C26B2C2AB2C1Route[]
}

/**
 * Reads the committed B2-C1 RESULT as untrusted JSON and fails closed unless it is the registered formal result: its own
 * SHA-256, formal with no calculation change after its measured HEAD, the oracle-free calculation declaration, case
 * B2C1_WIDE, no invalid reason, P1 selected and recorded with the registered definition, the registered subgroup counts
 * (K1-minimal 31, K2-minimal 9, unreached 3, defaultExtent 20), P1 over defaultExtent 20 / 20 finite with top16 20 and
 * max 11, the recorded predecessor SHA-256s, and 43 readable Route rows whose defaultExtent members each carry a finite P1
 * rank <= 16.
 */
export function parsePhase2C26B2C2AB2C1Authority(json: unknown, resultSha256: string): { valid: boolean; issues: string[]; authority: Phase2C26B2C2AB2C1Authority | null } {
  const reg = PHASE2C26B2C2A_REGISTERED_B2C1
  const issues: string[] = []
  if (!isObject(json) || !isObject(json.provenance) || !isObject(json.decision) || !isObject(json.selection) || !isObject(json.conditions) || !isObject(json.policyAggregates)
    || !isObject(json.subgroupCounts)) {
    return { valid: false, issues: ['B2-C1 RESULT lacks provenance / decision / selection / conditions / policyAggregates / subgroupCounts'], authority: null }
  }
  const { provenance, decision, selection, conditions, policyAggregates, subgroupCounts } = json
  if (resultSha256 !== reg.resultSha256) issues.push(`B2-C1 RESULT SHA-256 ${resultSha256} is not the registered ${reg.resultSha256}`)
  if (provenance.formal !== true) issues.push('provenance.formal is not true')
  if (!Array.isArray(provenance.calculationCodeChangedSinceMeasuredHead) || provenance.calculationCodeChangedSinceMeasuredHead.length !== 0) issues.push('provenance.calculationCodeChangedSinceMeasuredHead is not empty')
  if (provenance.uncommittedBenchmarkCode !== false) issues.push('provenance.uncommittedBenchmarkCode is not false')
  if (provenance.oracleReadByCalculation !== false || provenance.oracleGuidedPolicyEvaluation !== true) issues.push('provenance: the oracle-free calculation / oracle-guided policy evaluation declaration is missing')
  for (const field of ['measuredHead', 'analysisHead'] as const) if (typeof provenance[field] !== 'string' || !COMMIT.test(provenance[field] as string)) issues.push(`provenance.${field} is not a commit SHA`)
  for (const field of ['exportSha256', 'b2b1ResultSha256', 'b2b2a2ResultSha256', 'oracleResultSha256', 'oracleManifestFileSha256', 'oracleManifestRoutesSha256'] as const) {
    if (typeof provenance[field] !== 'string' || !SHA256.test(provenance[field] as string)) issues.push(`provenance.${field} is not a SHA-256`)
  }
  if (provenance.b2b1ResultSha256 !== reg.b2b1ResultSha256) issues.push('provenance.b2b1ResultSha256 is not the registered B2-B1 RESULT')
  if (provenance.b2b2a2ResultSha256 !== reg.b2b2a2ResultSha256) issues.push('provenance.b2b2a2ResultSha256 is not the registered B2-B2A2 RESULT')
  if (provenance.oracleResultSha256 !== provenance.oracleSha256RecordedByB2B1 || provenance.oracleManifestFileSha256 !== provenance.oracleManifestFileSha256RecordedByB2B1
    || provenance.oracleManifestRoutesSha256 !== provenance.oracleManifestSha256RecordedByOracle) issues.push('provenance: an oracle / manifest SHA-256 differs from the one its predecessor recorded')
  if (decision.case !== reg.decisionCase) issues.push(`decision.case ${String(decision.case)} is not ${reg.decisionCase}`)
  if (!Array.isArray(json.invalidReasons) || json.invalidReasons.length !== 0) issues.push('invalidReasons is not empty')
  const selected = isObject(selection.selected) ? selection.selected : {}
  if (selected.policy !== reg.selectedPolicy) issues.push(`selection.selected.policy ${String(selected.policy)} is not ${reg.selectedPolicy}`)
  const recordedP1 = asArray(conditions.policies).find(p => isObject(p) && p.id === 'P1')
  if (!same(recordedP1, PHASE2C26B2C2A_REGISTERED_P1)) issues.push('conditions.policies P1 is not the registered P1 definition')
  if (!same(PHASE2C26B2C1_REGISTERED_POLICIES.find(p => p.id === 'P1'), PHASE2C26B2C2A_REGISTERED_P1)) issues.push('PHASE2C26B2C1_REGISTERED_POLICIES P1 is not the registered P1 definition')
  for (const [field, expected] of Object.entries(reg.subgroups)) if (subgroupCounts[field] !== expected) issues.push(`subgroupCounts.${field} ${String(subgroupCounts[field])} is not ${expected}`)
  const p1 = isObject(policyAggregates.P1) && isObject(policyAggregates.P1.defaultExtent) ? policyAggregates.P1.defaultExtent : {}
  const cdf = isObject(p1.cdf) ? p1.cdf : {}
  const rank = isObject(p1.rank) ? p1.rank : {}
  const got = { targets: p1.targets, finite: p1.finite, top16: cdf.top16, max: rank.max }
  for (const [field, expected] of Object.entries(reg.defaultExtentP1)) if (got[field as keyof typeof got] !== expected) issues.push(`policyAggregates.P1.defaultExtent.${field} ${String(got[field as keyof typeof got])} is not ${expected}`)

  const routes: Phase2C26B2C2AB2C1Route[] = []
  for (const raw of asArray(json.routes)) {
    const first = isObject(raw) && isObject(raw.firstCompatible) && isObject(raw.firstCompatible.P1) ? raw.firstCompatible.P1 : null
    if (!isObject(raw) || typeof raw.targetWeaponId !== 'string' || !Array.isArray(raw.subgroups) || !first || !(first.rank === null || Number.isInteger(first.rank))) {
      issues.push('a B2-C1 route row is malformed'); continue
    }
    routes.push({ targetWeaponId: raw.targetWeaponId, subgroups: raw.subgroups.map(String),
      p1FirstCompatible: { rank: first.rank as number | null, reservationDigest: typeof first.reservationDigest === 'string' ? first.reservationDigest : null,
        cardinality: Number.isInteger(first.cardinality) ? first.cardinality as number : null, representativeFixedSetId: typeof first.representativeFixedSetId === 'string' ? first.representativeFixedSetId : null } })
  }
  if (routes.length !== 43 || new Set(routes.map(r => r.targetWeaponId)).size !== routes.length) issues.push('B2-C1 routes are not 43 distinct Routes')
  const members = routes.filter(r => r.subgroups.includes('defaultExtent'))
  if (members.length !== reg.subgroups.defaultExtent) issues.push(`the defaultExtent subgroup holds ${members.length} Routes, not ${reg.subgroups.defaultExtent}`)
  if (members.some(r => r.p1FirstCompatible.rank === null || r.p1FirstCompatible.rank > PHASE2C26B2C2A_CONTEXT_BUDGET)) issues.push(`a defaultExtent Route has no P1 rank <= ${PHASE2C26B2C2A_CONTEXT_BUDGET}`)
  if (members.some(r => !r.subgroups.includes('recovered') || r.subgroups.includes('extentInsufficient') || r.subgroups.includes('unreached'))) issues.push('a defaultExtent Route is not recovered within the default extent')
  if (issues.length > 0) return { valid: false, issues, authority: null }
  return { valid: true, issues: [], authority: {
    resultSha256, measuredHead: String(provenance.measuredHead), analysisHead: String(provenance.analysisHead), exportSha256: String(provenance.exportSha256),
    b2b1ResultSha256: String(provenance.b2b1ResultSha256), b2b2a2ResultSha256: String(provenance.b2b2a2ResultSha256), oracleResultSha256: String(provenance.oracleResultSha256),
    oracleManifestFileSha256: String(provenance.oracleManifestFileSha256), oracleManifestRoutesSha256: String(provenance.oracleManifestRoutesSha256), routes,
  } }
}

/**
 * The validation Target manifest from a parsed B2-C1 authority: the defaultExtent subgroup's Target IDs in ascending
 * order, and nothing of their ranks, digests or oracle comparison. The count must be the registered 20.
 */
export function phase2c26b2c2aTargetManifest(authority: Phase2C26B2C2AB2C1Authority): Phase2C26B2C2ATargetManifest {
  const ids = authority.routes.filter(r => r.subgroups.includes(PHASE2C26B2C2A_TARGET_SOURCE.population)).map(r => r.targetWeaponId).sort(compare)
  if (ids.length !== PHASE2C26B2C2A_VALIDATION_TARGETS || new Set(ids).size !== ids.length) throw new Error(`The defaultExtent population holds ${ids.length} Targets, not ${PHASE2C26B2C2A_VALIDATION_TARGETS}.`)
  return { phase: 'Issue #154 Phase 2-C2.6-B2-C2A validation Target manifest (B2-C1 post-hoc subgroup defaultExtent; Target IDs only)',
    sourceResultSha256: authority.resultSha256, population: 'defaultExtent', policy: 'P1', contextBudget: PHASE2C26B2C2A_CONTEXT_BUDGET, exportSha256: authority.exportSha256,
    targetWeaponIds: ids }
}

// ---------------------------------------------------------------- the B2-B2A2 RESULT (hash chain only)

export interface Phase2C26B2C2AB2B2A2Authority {
  exportSha256: string
  b2b2aResultSha256: string
  b2b1ResultSha256: string
  oracleResultSha256: string
  oracleManifestFileSha256: string
  oracleManifestRoutesSha256: string
}

/** The B2-B2A2 RESULT, read for its recorded predecessor hashes only: registered SHA-256, formal, registered case. */
export function parsePhase2C26B2C2AB2B2A2Authority(json: unknown, resultSha256: string): { valid: boolean; issues: string[]; authority: Phase2C26B2C2AB2B2A2Authority | null } {
  const reg = PHASE2C26B2C2A_REGISTERED_B2B2A2
  const issues: string[] = []
  if (!isObject(json) || !isObject(json.provenance) || !isObject(json.decision)) return { valid: false, issues: ['B2-B2A2 RESULT lacks provenance / decision'], authority: null }
  const { provenance, decision } = json
  if (resultSha256 !== reg.resultSha256) issues.push(`B2-B2A2 RESULT SHA-256 ${resultSha256} is not the registered ${reg.resultSha256}`)
  if (provenance.formal !== true) issues.push('provenance.formal is not true')
  if (!Array.isArray(provenance.calculationCodeChangedSinceMeasuredHead) || provenance.calculationCodeChangedSinceMeasuredHead.length !== 0) issues.push('provenance.calculationCodeChangedSinceMeasuredHead is not empty')
  if (decision.case !== reg.decisionCase) issues.push(`decision.case ${String(decision.case)} is not ${reg.decisionCase}`)
  if (!Array.isArray(json.invalidReasons) || json.invalidReasons.length !== 0) issues.push('invalidReasons is not empty')
  const fields = ['exportSha256', 'b2b2aResultSha256', 'b2b1ResultSha256', 'oracleResultSha256', 'oracleManifestFileSha256', 'oracleManifestRoutesSha256'] as const
  for (const field of fields) if (typeof provenance[field] !== 'string' || !SHA256.test(provenance[field] as string)) issues.push(`provenance.${field} is not a SHA-256`)
  if (issues.length > 0) return { valid: false, issues, authority: null }
  return { valid: true, issues: [], authority: Object.fromEntries(fields.map(field => [field, String(provenance[field])])) as unknown as Phase2C26B2C2AB2B2A2Authority }
}
