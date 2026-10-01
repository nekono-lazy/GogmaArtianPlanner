/**
 * Issue #154 Phase 2-C2.6-B2-C1 post-hoc analysis only. It reads a finished B2-C1 schedule and, as explicit analyzer
 * arguments AFTER the schedule run ended, the B2-B1 RESULT (authority: its formal reachability counts, minimal
 * cardinalities and subgroups), the 1,657 oracle RESULT and the oracle manifest. It runs no Search, no kernel and no
 * Planner, and it feeds no evidence into any calculation.
 *
 * The question: under each of the four fixed oracle-free policies P0..P3, at which rank does each oracle Route first meet a
 * reservation-compatible context? Compatibility is the unchanged B2-A helper (`phase2c26b2aReachability()`, itself the
 * Production `nextOperationPositions()` / `heldPrefixNormalCreation()` walk); the extent is reported as a separate axis
 * and is never part of compatibility here. Choosing one of P0..P3 as the Research candidate reads this oracle coverage
 * (`oracleGuidedPolicyEvaluation = true`), so the choice is never evidence for a Production policy.
 */
import { stableStringify } from '../domain/models/hashing'
import { defaultPlannerAlternativeSearchExtent } from '../domain/search'
import {
  phase2c26b2aReachability,
  phase2c26b2aReservationRanges,
  phase2c26b2aRouteExtent,
  phase2c26b2aRouteView,
  type Phase2C26B2AOracle,
  type Phase2C26B2AOracleRouteSpec,
  type Phase2C26B2AOrigins,
  type Phase2C26B2ARouteView,
} from './plannerGlobalPhase2C26B2AAnalysis'
import { validatePhase2C26B2B1Snapshot } from './plannerGlobalPhase2C26B2B1Analysis'
import {
  phase2c26b2c1DefaultWindows,
  phase2c26b2c1Rank,
  phase2c26b2c1ReservationFeatures,
  PHASE2C26B2C1_POLICIES,
  PHASE2C26B2C1_POLICY_IDS,
  type Phase2C26B2C1ContextRow,
  type Phase2C26B2C1PolicyId,
  type Phase2C26B2C1Schedule,
  type Phase2C26B2C1Windows,
} from './plannerGlobalPhase2C26B2C1'

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

// ---------------------------------------------------------------- registered before the formal run

/**
 * An independent copy of the four policies. The analyzer compares the schedule's recorded policies and the module's
 * `PHASE2C26B2C1_POLICIES` with it, so a policy changed after registration is a `policy definition drift`.
 */
export const PHASE2C26B2C1_REGISTERED_POLICIES = [
  { id: 'P0', name: 'stable_simple_first', keys: [['targetEligibleMinCardinality', 'asc'], ['reservationDigest', 'asc']] },
  { id: 'P1', name: 'default_simple_first', keys: [['targetEligibleMinCardinality', 'asc'], ['exclusiveOwnedWeaponCount', 'asc'], ['blockedCountDefaultTotal', 'asc'],
    ['shareableHeldCountDefaultTotal', 'desc'], ['reservationDigest', 'asc']] },
  { id: 'P2', name: 'default_utility_first', keys: [['exclusiveOwnedWeaponCount', 'asc'], ['blockedCountDefaultTotal', 'asc'], ['shareableHeldCountDefaultTotal', 'desc'],
    ['targetEligibleMinCardinality', 'asc'], ['reservationDigest', 'asc']] },
  { id: 'P3', name: 'full_utility_first', keys: [['exclusiveOwnedWeaponCount', 'asc'], ['blockedCountFullTotal', 'asc'], ['shareableHeldCountFullTotal', 'desc'],
    ['targetEligibleMinCardinality', 'asc'], ['reservationDigest', 'asc']] },
] as const

/** The powers-of-two diagnostic budgets (never Production defaults). */
export const PHASE2C26B2C1_BUDGETS = [1, 2, 4, 8, 16, 32, 64, 128, 256] as const

/** The B2-B1 result this phase is registered against. Any other value fails closed. */
export const PHASE2C26B2C1_REGISTERED_B2B1 = {
  resultSha256: '5a56ab010828519df00e7084c8b9cf6bd9276ad7425f609d520ba1392071309d',
  decisionCase: 'B2B1_PARTIAL_ELIGIBLE_RECOVERY',
  all: { routes: 43, k0: 0, k1: 31, k2: 9, unreached: 3, recovered: 40, withinDefaultExtent: 20, requiresLargerExtent: 20 },
  contextGap: { routes: 40, k0: 0, k1: 28, k2: 9, unreached: 3, recovered: 37, withinDefaultExtent: 18, requiresLargerExtent: 19 },
  probeGap: { routes: 1, k1: 1, requiresLargerExtent: 1 },
  covered: { routes: 2 },
  extentByStream: { normal: 4, skill: 20, gogma: 0 },
  fixedSets: { proposed: { '0': 1, '1': 43, '2': 903 }, valid: { '0': 1, '1': 43, '2': 835 } },
  uniqueReservations: 879,
  uniqueSemanticContexts: 36084,
} as const

export type Phase2C26B2C1Minimal = '0' | '1' | '2' | 'unreached' | 'checkpoint_hard_constraint'

export interface Phase2C26B2C1B2B1Route {
  targetWeaponId: string
  b2a: { covered: boolean; probeGap: boolean; contextGap: boolean; conflictParticipant: boolean }
  minimalCardinality: Phase2C26B2C1Minimal
  compatibleContexts: Record<'0' | '1' | '2', number>
  withinDefaultExtent: boolean
  extent: unknown
  supportTargetWeaponIds: string[]
}

export interface Phase2C26B2C1B2B1Authority {
  measuredHead: string
  analysisHead: string
  exportSha256: string
  oracleResultSha256: string
  oracleManifestFileSha256: string
  oracleManifestRoutesSha256: string
  origin: unknown
  originDigest: string
  targets: { targetWeaponId: string; currentBuildListEntryId: string; currentRouteKeySha256: string; checkpointHardConstraint: boolean; originSemanticDigest: string }[]
  fixedSets: { proposed: unknown; valid: unknown; invalid: unknown; invalidFixedSetIds: string[] }
  groups: { groupIndex: number; reservationDigest: string; minCardinality: number; aliasFixedSetIds: string[]; reservation: unknown }[]
  perTarget: { targetWeaponId: string; status: string; rawContexts: number; uniqueContexts: number; byMinCardinality: Record<string, number> }[]
  routes: Phase2C26B2C1B2B1Route[]
}

const MINIMALS = new Set(['0', '1', '2', 'unreached', 'checkpoint_hard_constraint'])

/**
 * Reads the committed B2-B1 RESULT as untrusted JSON and fails closed unless it is the registered formal result: its own
 * SHA-256, formal with no calculation change after its measured HEAD, case B2B1_PARTIAL_ELIGIBLE_RECOVERY, no invalid
 * reason, the registered all / context-gap / probe-gap / covered aggregates, the registered fixed-set and context counts,
 * and 43 readable Route rows that add up to them.
 */
export function parsePhase2C26B2C1B2B1Authority(json: unknown, resultSha256: string): { valid: boolean; issues: string[]; authority: Phase2C26B2C1B2B1Authority | null } {
  const issues: string[] = []
  const r = PHASE2C26B2C1_REGISTERED_B2B1
  if (!isObject(json) || !isObject(json.provenance) || !isObject(json.decision) || !isObject(json.aggregates) || !isObject(json.currentInput) || !isObject(json.fixedSets)
    || !isObject(json.reservations) || !isObject(json.contexts)) {
    return { valid: false, issues: ['B2-B1 RESULT lacks provenance / decision / aggregates / currentInput / fixedSets / reservations / contexts'], authority: null }
  }
  const { provenance, decision, aggregates, currentInput, fixedSets, reservations, contexts } = json
  if (resultSha256 !== r.resultSha256) issues.push(`B2-B1 RESULT SHA-256 ${resultSha256} is not the registered ${r.resultSha256}`)
  if (provenance.formal !== true) issues.push('provenance.formal is not true')
  if (!Array.isArray(provenance.calculationCodeChangedSinceMeasuredHead) || provenance.calculationCodeChangedSinceMeasuredHead.length !== 0) issues.push('provenance.calculationCodeChangedSinceMeasuredHead is not empty')
  if (provenance.oracleReadByCalculation !== false) issues.push('provenance.oracleReadByCalculation is not false')
  for (const field of ['measuredHead', 'analysisHead'] as const) if (typeof provenance[field] !== 'string' || !/^[0-9a-f]{40}$/.test(provenance[field] as string)) issues.push(`provenance.${field} is not a commit SHA`)
  for (const field of ['exportSha256', 'oracleResultSha256', 'oracleManifestFileSha256', 'oracleManifestRoutesSha256'] as const) {
    if (typeof provenance[field] !== 'string' || !/^[0-9a-f]{64}$/.test(provenance[field] as string)) issues.push(`provenance.${field} is not a SHA-256`)
  }
  if (decision.case !== r.decisionCase) issues.push(`decision.case ${String(decision.case)} is not ${r.decisionCase}`)
  if (!Array.isArray(json.invalidReasons) || json.invalidReasons.length !== 0) issues.push('invalidReasons is not empty')
  const checkDistribution = (name: 'all' | 'contextGap', expected: (typeof r)['all'] | (typeof r)['contextGap']) => {
    const d = isObject(aggregates[name]) ? aggregates[name] as Json : {}
    const m = isObject(d.minimalCardinality) ? d.minimalCardinality : {}
    const got = { routes: d.routes, k0: m['0'], k1: m['1'], k2: m['2'], unreached: m.unreached, recovered: d.recovered, withinDefaultExtent: d.recoveredWithinDefaultExtent,
      requiresLargerExtent: d.recoveredRequiresLargerExtent }
    for (const [field, value] of Object.entries(expected)) if (got[field as keyof typeof got] !== value) issues.push(`aggregates.${name}.${field} ${String(got[field as keyof typeof got])} is not ${value}`)
  }
  checkDistribution('all', r.all)
  checkDistribution('contextGap', r.contextGap)
  const all = isObject(aggregates.all) ? aggregates.all : {}
  if (!same(all.recoveredRequiresLargerExtentByStream, r.extentByStream)) issues.push('aggregates.all.recoveredRequiresLargerExtentByStream is not the registered value')
  if (!same(fixedSets.proposed, r.fixedSets.proposed) || !same(fixedSets.valid, r.fixedSets.valid)) issues.push('fixedSets proposed / valid are not the registered counts')
  if (reservations.uniqueReservations !== r.uniqueReservations) issues.push(`reservations.uniqueReservations ${String(reservations.uniqueReservations)} is not ${r.uniqueReservations}`)
  if (contexts.uniqueSemanticContexts !== r.uniqueSemanticContexts) issues.push(`contexts.uniqueSemanticContexts ${String(contexts.uniqueSemanticContexts)} is not ${r.uniqueSemanticContexts}`)

  const routes: Phase2C26B2C1B2B1Route[] = []
  for (const raw of asArray(json.routes)) {
    const b2a = isObject(raw) && isObject(raw.b2a) ? raw.b2a : null
    const extent = isObject(raw) && isObject(raw.extent) ? raw.extent : null
    const cc = isObject(raw) && isObject(raw.compatibleContexts) ? raw.compatibleContexts : null
    if (!isObject(raw) || !b2a || !extent || !cc || typeof raw.targetWeaponId !== 'string' || !MINIMALS.has(String(raw.minimalCardinality)) || typeof extent.withinDefaultExtent !== 'boolean'
      || !['0', '1', '2'].every(k => Number.isInteger(cc[k])) || !isObject(raw.oracleSupport)) { issues.push('a B2-B1 route row is malformed'); continue }
    routes.push({ targetWeaponId: raw.targetWeaponId, b2a: { covered: b2a.covered === true, probeGap: b2a.probeGap === true, contextGap: b2a.contextGap === true, conflictParticipant: b2a.conflictParticipant === true },
      minimalCardinality: String(raw.minimalCardinality) as Phase2C26B2C1Minimal, compatibleContexts: { '0': cc['0'] as number, '1': cc['1'] as number, '2': cc['2'] as number },
      withinDefaultExtent: extent.withinDefaultExtent, extent, supportTargetWeaponIds: asArray(raw.oracleSupport.supportTargetWeaponIds).map(String) })
  }
  if (routes.length !== r.all.routes || new Set(routes.map(x => x.targetWeaponId)).size !== routes.length) issues.push('B2-B1 routes are not 43 distinct Routes')
  const recovered = routes.filter(x => ['0', '1', '2'].includes(x.minimalCardinality))
  const probe = routes.filter(x => x.b2a.probeGap)
  if (routes.filter(x => x.minimalCardinality === '1').length !== r.all.k1 || routes.filter(x => x.minimalCardinality === '2').length !== r.all.k2
    || routes.filter(x => x.minimalCardinality === 'unreached').length !== r.all.unreached || recovered.filter(x => x.withinDefaultExtent).length !== r.all.withinDefaultExtent
    || recovered.filter(x => !x.withinDefaultExtent).length !== r.all.requiresLargerExtent) issues.push('B2-B1 route rows do not add up to the registered all aggregates')
  const gap = routes.filter(x => x.b2a.contextGap)
  if (gap.length !== r.contextGap.routes || gap.filter(x => x.minimalCardinality === '1').length !== r.contextGap.k1 || gap.filter(x => x.minimalCardinality === '2').length !== r.contextGap.k2
    || gap.filter(x => x.minimalCardinality === 'unreached').length !== r.contextGap.unreached || gap.filter(x => ['0', '1', '2'].includes(x.minimalCardinality) && x.withinDefaultExtent).length !== r.contextGap.withinDefaultExtent
    || gap.filter(x => ['0', '1', '2'].includes(x.minimalCardinality) && !x.withinDefaultExtent).length !== r.contextGap.requiresLargerExtent) issues.push('B2-B1 route rows do not add up to the registered context-gap aggregates')
  if (probe.length !== r.probeGap.routes || probe.some(x => x.minimalCardinality !== '1' || x.withinDefaultExtent)) issues.push('the B2-B1 probe-gap Route is not one K1-minimal, extent-insufficient Route')
  if (routes.filter(x => x.b2a.covered).length !== r.covered.routes) issues.push('B2-B1 covered Routes are not the registered count')
  if (routes.some(x => [x.b2a.covered, x.b2a.probeGap, x.b2a.contextGap].filter(Boolean).length !== 1)) issues.push('a B2-B1 Route is not exactly one of covered / probe gap / context gap')

  const targets: Phase2C26B2C1B2B1Authority['targets'] = []
  for (const raw of asArray(currentInput.targets)) {
    if (!isObject(raw) || typeof raw.targetWeaponId !== 'string' || typeof raw.currentBuildListEntryId !== 'string' || typeof raw.currentRouteKeySha256 !== 'string') { issues.push('a B2-B1 target row is malformed'); continue }
    targets.push({ targetWeaponId: raw.targetWeaponId, currentBuildListEntryId: raw.currentBuildListEntryId, currentRouteKeySha256: raw.currentRouteKeySha256,
      checkpointHardConstraint: raw.checkpointHardConstraint === true, originSemanticDigest: String(raw.originSemanticDigest) })
  }
  const groups: Phase2C26B2C1B2B1Authority['groups'] = []
  for (const raw of asArray(reservations.groups)) {
    if (!isObject(raw) || typeof raw.groupIndex !== 'number' || typeof raw.reservationDigest !== 'string' || !Array.isArray(raw.aliasFixedSetIds)) { issues.push('a B2-B1 group row is malformed'); continue }
    groups.push({ groupIndex: raw.groupIndex, reservationDigest: raw.reservationDigest, minCardinality: Number(raw.minCardinality), aliasFixedSetIds: raw.aliasFixedSetIds.map(String), reservation: raw.reservation })
  }
  const perTarget: Phase2C26B2C1B2B1Authority['perTarget'] = []
  for (const raw of asArray(contexts.perTarget)) {
    if (!isObject(raw) || typeof raw.targetWeaponId !== 'string' || !isObject(raw.byMinCardinality)) { issues.push('a B2-B1 per-Target context row is malformed'); continue }
    perTarget.push({ targetWeaponId: raw.targetWeaponId, status: String(raw.status), rawContexts: Number(raw.rawContexts), uniqueContexts: Number(raw.uniqueContexts),
      byMinCardinality: raw.byMinCardinality as Record<string, number> })
  }
  if (issues.length > 0) return { valid: false, issues, authority: null }
  return { valid: true, issues: [], authority: {
    measuredHead: String(provenance.measuredHead), analysisHead: String(provenance.analysisHead), exportSha256: String(provenance.exportSha256),
    oracleResultSha256: String(provenance.oracleResultSha256), oracleManifestFileSha256: String(provenance.oracleManifestFileSha256),
    oracleManifestRoutesSha256: String(provenance.oracleManifestRoutesSha256), origin: currentInput.origin, originDigest: String(currentInput.originDigest), targets,
    fixedSets: { proposed: fixedSets.proposed, valid: fixedSets.valid, invalid: fixedSets.invalid,
      invalidFixedSetIds: asArray(fixedSets.invalidRows).map(row => isObject(row) ? String(row.fixedSetId) : '?').sort(compare) },
    groups, perTarget, routes,
  } }
}

// ---------------------------------------------------------------- schedule consistency (the calculation re-read)

export interface Phase2C26B2C1ScheduleConsistency { valid: boolean; issues: string[] }

/**
 * Re-reads the schedule and fails closed on any internal drift: the B2-B1 snapshot consistency (unchanged validator), the
 * calculation's own checks, the policy definitions against the registered copy, the Production default extent, each
 * Target's windows and relevant Normal Counter against the snapshot origin, every context row against the snapshot
 * groups (eligible aliases without the Target's own Entry, Target-specific eligible minimum, representative alias), every
 * feature recomputed from the group reservation, and every rank recomputed.
 */
export function validatePhase2C26B2C1Schedule(schedule: Phase2C26B2C1Schedule): Phase2C26B2C1ScheduleConsistency {
  const issues: string[] = []
  const snapshot = schedule.snapshot
  issues.push(...validatePhase2C26B2B1Snapshot(snapshot).issues.map(i => `snapshot: ${i}`))
  for (const [check, ok] of Object.entries(schedule.checks)) if (ok !== true) issues.push(`calculation check ${check} failed`)
  if (!same(schedule.policies, PHASE2C26B2C1_REGISTERED_POLICIES) || !same(PHASE2C26B2C1_POLICIES, PHASE2C26B2C1_REGISTERED_POLICIES)) issues.push('policy definition drift')
  if (!same(schedule.extent, { ...defaultPlannerAlternativeSearchExtent })) issues.push('the extent is not the Production default extent')
  if (schedule.origins.skill !== snapshot.origin.skillCounter.value || schedule.origins.gogma !== snapshot.origin.gogmaCounter.value) issues.push('the Skill / Gogma origin differs from the snapshot origin')
  if (!same(schedule.targets.map(t => t.targetWeaponId), snapshot.targets.map(t => t.targetWeaponId))) issues.push('the schedule Targets are not the snapshot Targets')
  const fixedById = new Map(snapshot.fixedSets.map(row => [row.fixedSetId, row]))
  const rowsByTarget = new Map<string, Phase2C26B2C1ContextRow[]>()
  for (const row of schedule.contexts) rowsByTarget.set(row.targetWeaponId, [...(rowsByTarget.get(row.targetWeaponId) ?? []), row])
  for (const target of schedule.targets) {
    const snapTarget = snapshot.targets.find(t => t.targetWeaponId === target.targetWeaponId)
    if (!snapTarget || snapTarget.currentBuildListEntryId !== target.currentBuildListEntryId || snapTarget.checkpointHardConstraint !== target.checkpointHardConstraint) {
      issues.push(`${target.targetWeaponId}: Target drift against the snapshot`); continue
    }
    const counter = target.relevantNormalCounterId === null ? null : snapshot.origin.normalCounters.find(c => c.counterId === target.relevantNormalCounterId)
    if (target.relevantNormalCounterId !== null && (!counter || !counter.isConfirmed || counter.counter === null)) issues.push(`${target.targetWeaponId}: the relevant Normal Counter is not a confirmed origin Counter`)
    const windows = phase2c26b2c1DefaultWindows({ skill: schedule.origins.skill, gogma: schedule.origins.gogma, normal: counter?.counter ?? null }, schedule.extent)
    if (!same(windows, target.windows)) issues.push(`${target.targetWeaponId}: default windows drift`)
    const rows = rowsByTarget.get(target.targetWeaponId) ?? []
    if (rows.length !== target.contexts) issues.push(`${target.targetWeaponId}: context count drift`)
    const expected: string[] = []
    for (const group of snapshot.reservationGroups) {
      const eligible = group.aliasFixedSetIds.map(id => fixedById.get(id)!).filter(fs => !fs.fixedBuildListEntryIds.includes(target.currentBuildListEntryId))
      if (target.checkpointHardConstraint || eligible.length === 0) continue
      const minimum = Math.min(...eligible.map(fs => fs.cardinality))
      const representative = eligible.filter(fs => fs.cardinality === minimum).map(fs => fs.fixedSetId).sort(compare)[0]
      expected.push(`${group.groupIndex}:${group.reservationDigest}:${minimum}:${eligible.length}:${representative}`)
    }
    if (!same(rows.map(r => `${r.groupIndex}:${r.reservationDigest}:${r.targetEligibleMinCardinality}:${r.eligibleAliasCount}:${r.representativeFixedSetId}`), expected)) {
      issues.push(`${target.targetWeaponId}: context rows are not the Target-specific eligible groups`)
    }
    for (const row of rows) {
      const group = snapshot.reservationGroups[row.groupIndex]
      const alias = fixedById.get(row.representativeFixedSetId)
      if (!group || !alias || alias.fixedBuildListEntryIds.includes(target.currentBuildListEntryId) || !same(alias.fixedTargetWeaponIds, row.representativeFixedTargetWeaponIds)) {
        issues.push(`${target.targetWeaponId} @ ${row.groupIndex}: representative alias drift`); continue
      }
      if (!same(phase2c26b2c1ReservationFeatures(group.reservation, target.relevantNormalCounterId, windows), row.features)) issues.push(`${target.targetWeaponId} @ ${row.groupIndex}: feature drift`)
    }
    if (rows.length > 0) {
      for (const policy of PHASE2C26B2C1_POLICIES) {
        let ranks: number[]
        try { ranks = phase2c26b2c1Rank(rows, policy) } catch (error) { issues.push(`${target.targetWeaponId}: ${(error as Error).message}`); continue }
        if (!same(ranks, rows.map(r => r.ranks[policy.id]))) issues.push(`${target.targetWeaponId}: ${policy.id} ranks are not the deterministic order`)
      }
    }
  }
  return { valid: issues.length === 0, issues }
}

// ---------------------------------------------------------------- B2-B1 parity (the context universe)

/**
 * The schedule's context universe against the B2-B1 RESULT: origin, Targets, fixed-set counts and invalid sets, every
 * reservation group (digest, minimum cardinality, aliases, reservation range form) and every Target's context counts by
 * Target-specific eligible minimum cardinality.
 */
export function validatePhase2C26B2C1B2B1Parity(schedule: Phase2C26B2C1Schedule, authority: Phase2C26B2C1B2B1Authority, sha: (value: string) => string): { valid: boolean; issues: string[] } {
  const issues: string[] = []
  const snapshot = schedule.snapshot
  const origin = { skill: snapshot.origin.skillCounter.value, gogma: snapshot.origin.gogmaCounter.value, normal: Object.fromEntries(snapshot.origin.normalCounters.map(n => [n.counterId, n.counter])) }
  if (!same(origin, authority.origin) || snapshot.originDigest !== authority.originDigest) issues.push('the Planner-start origin differs from B2-B1')
  const targets = snapshot.targets.map(t => ({ targetWeaponId: t.targetWeaponId, currentBuildListEntryId: t.currentBuildListEntryId, currentRouteKeySha256: sha(t.currentRouteKey),
    checkpointHardConstraint: t.checkpointHardConstraint, originSemanticDigest: t.originSemanticDigest }))
  if (!same(targets, authority.targets)) issues.push('the Targets / current Entries / Route keys differ from B2-B1')
  const count = (valid: boolean | null) => {
    const out = { '0': 0, '1': 0, '2': 0 }
    for (const row of snapshot.fixedSets) if (valid === null || row.valid === valid) out[String(row.cardinality) as '0' | '1' | '2'] += 1
    return out
  }
  if (!same(count(null), authority.fixedSets.proposed) || !same(count(true), authority.fixedSets.valid) || !same(count(false), authority.fixedSets.invalid)) issues.push('the K0 / K1 / K2 universe counts differ from B2-B1')
  if (!same(snapshot.fixedSets.filter(row => !row.valid).map(row => row.fixedSetId).sort(compare), authority.fixedSets.invalidFixedSetIds)) issues.push('the invalid K2 sets differ from B2-B1')
  const groups = snapshot.reservationGroups.map(g => ({ groupIndex: g.groupIndex, reservationDigest: g.reservationDigest, minCardinality: g.minCardinality, aliasFixedSetIds: g.aliasFixedSetIds,
    reservation: phase2c26b2aReservationRanges(g.reservation) }))
  if (!same(groups, authority.groups)) issues.push('the semantic reservation groups differ from B2-B1')
  for (const target of schedule.targets) {
    const b2b1 = authority.perTarget.find(row => row.targetWeaponId === target.targetWeaponId)
    const rows = schedule.contexts.filter(c => c.targetWeaponId === target.targetWeaponId)
    const by: Record<string, number> = {}
    for (const row of rows) by[row.targetEligibleMinCardinality] = (by[row.targetEligibleMinCardinality] ?? 0) + 1
    if (!b2b1 || b2b1.uniqueContexts !== rows.length || b2b1.rawContexts !== rows.reduce((sum, r) => sum + r.eligibleAliasCount, 0) || !same(b2b1.byMinCardinality, by)) {
      issues.push(`${target.targetWeaponId}: the Target-specific context universe differs from B2-B1`)
    }
  }
  return { valid: issues.length === 0, issues }
}

// ---------------------------------------------------------------- per Target reachability and first compatible rank

export interface Phase2C26B2C1FirstCompatible {
  rank: number | null
  reservationDigest: string | null
  cardinality: number | null
  representativeFixedSetId: string | null
  representativeFixedTargetWeaponIds: string[]
  /** Contexts of eligible minimum K1 / K2 ranked before the first compatible one (all of them when none is compatible). */
  k1Before: number
  k2Before: number
  /** Post-hoc diagnostic only: the representative alias fixes at least one oracle support Target of this Route. */
  representativeIncludesOracleSupporter: boolean | null
}

export interface Phase2C26B2C1TargetReach {
  targetWeaponId: string
  contexts: number
  compatibleGroupIndexes: number[]
  compatibleByCardinality: Record<'0' | '1' | '2', number>
  minimalCardinality: Phase2C26B2C1Minimal
  firstCompatible: Record<Phase2C26B2C1PolicyId, Phase2C26B2C1FirstCompatible>
  inconsistencies: string[]
}

/** The first compatible context of one policy (rank order). */
export function phase2c26b2c1FirstCompatible(rows: readonly Phase2C26B2C1ContextRow[], compatible: ReadonlySet<number>, policy: Phase2C26B2C1PolicyId,
  supporters: ReadonlySet<string> | null): Phase2C26B2C1FirstCompatible {
  const ordered = [...rows].sort((a, b) => a.ranks[policy] - b.ranks[policy])
  const index = ordered.findIndex(row => compatible.has(row.groupIndex))
  const before = index < 0 ? ordered : ordered.slice(0, index)
  const first = index < 0 ? null : ordered[index]!
  return {
    rank: first?.ranks[policy] ?? null, reservationDigest: first?.reservationDigest ?? null, cardinality: first?.targetEligibleMinCardinality ?? null,
    representativeFixedSetId: first?.representativeFixedSetId ?? null, representativeFixedTargetWeaponIds: first ? [...first.representativeFixedTargetWeaponIds] : [],
    k1Before: before.filter(row => row.targetEligibleMinCardinality === 1).length, k2Before: before.filter(row => row.targetEligibleMinCardinality === 2).length,
    representativeIncludesOracleSupporter: first === null || supporters === null ? null : first.representativeFixedTargetWeaponIds.some(id => supporters.has(id)),
  }
}

/** Every context of one Target judged against the oracle Route by the unchanged B2-A reachability helper. */
export async function phase2c26b2c1TargetReach(input: { view: Phase2C26B2ARouteView; origins: Phase2C26B2AOrigins; schedule: Phase2C26B2C1Schedule;
  rows: readonly Phase2C26B2C1ContextRow[]; supporters: ReadonlySet<string> | null }): Promise<Phase2C26B2C1TargetReach> {
  const { view, origins, schedule, rows } = input
  const inconsistencies: string[] = []
  const target = schedule.targets.find(t => t.targetWeaponId === view.targetWeaponId)
  const compatible = new Set<number>()
  const compatibleByCardinality = { '0': 0, '1': 0, '2': 0 }
  for (const row of rows) {
    const reach = await phase2c26b2aReachability(view, schedule.snapshot.reservationGroups[row.groupIndex]!.reservation, origins, schedule.extent)
    if (reach.inconsistent) inconsistencies.push(`${view.targetWeaponId} @ group ${row.groupIndex}: a primitive verdict disagrees with its decomposition`)
    if (!reach.compatible) continue
    compatible.add(row.groupIndex)
    compatibleByCardinality[String(row.targetEligibleMinCardinality) as '0' | '1' | '2'] += 1
  }
  const minimal: Phase2C26B2C1Minimal = target?.checkpointHardConstraint ? 'checkpoint_hard_constraint'
    : compatibleByCardinality['0'] > 0 ? '0' : compatibleByCardinality['1'] > 0 ? '1' : compatibleByCardinality['2'] > 0 ? '2' : 'unreached'
  const firstCompatible = Object.fromEntries(PHASE2C26B2C1_POLICY_IDS.map(policy => [policy, phase2c26b2c1FirstCompatible(rows, compatible, policy, input.supporters)])) as Record<Phase2C26B2C1PolicyId, Phase2C26B2C1FirstCompatible>
  return { targetWeaponId: view.targetWeaponId, contexts: rows.length, compatibleGroupIndexes: [...compatible].sort((a, b) => a - b), compatibleByCardinality, minimalCardinality: minimal,
    firstCompatible, inconsistencies }
}

/**
 * The default windows against the B2-A Route extent: a Route is within the default extent exactly when its production
 * target lies in the Normal window, its Gogma lane in the Gogma window, and its Skill lane in the Skill window of its own
 * kind (existing Gogma Reset Skills or a conversion Route).
 */
export function phase2c26b2c1RouteWithinWindows(view: Phase2C26B2ARouteView, windows: Phase2C26B2C1Windows): boolean {
  const inside = (position: number | undefined, window: { from: number; toExclusive: number } | null) => position === undefined || (window !== null && position < window.toExclusive)
  const normalOk = view.sourceKind !== 'new_normal' || inside(view.normal.at(-1), windows.normal)
  const skillOk = inside(view.skill.at(-1), view.conversion === null ? windows.skillExistingGogma : windows.skillConversion)
  return normalOk && skillOk && inside(view.gogma.at(-1), windows.gogma)
}

// ---------------------------------------------------------------- aggregation

/** Nearest-rank percentile (`sorted[ceil(p / 100 * n) - 1]`); null for an empty set. */
export function phase2c26b2c1Percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]!
}

export interface Phase2C26B2C1PolicyAggregate {
  targets: number
  finite: number
  cdf: Record<string, number>
  rank: { min: number | null; median: number | null; p75: number | null; p90: number | null; p95: number | null; max: number | null }
}

/** Coverage at each diagnostic budget (`top N` = first compatible rank <= N) and the rank percentiles of one subgroup. */
export function phase2c26b2c1PolicyAggregate(ranks: readonly (number | null)[]): Phase2C26B2C1PolicyAggregate {
  const finite = ranks.filter((rank): rank is number => rank !== null)
  const cdf: Record<string, number> = {}
  for (const budget of PHASE2C26B2C1_BUDGETS) cdf[`top${budget}`] = finite.filter(rank => rank <= budget).length
  cdf.all = finite.length
  return { targets: ranks.length, finite: finite.length, cdf, rank: { min: finite.length === 0 ? null : Math.min(...finite), median: phase2c26b2c1Percentile(finite, 50),
    p75: phase2c26b2c1Percentile(finite, 75), p90: phase2c26b2c1Percentile(finite, 90), p95: phase2c26b2c1Percentile(finite, 95), max: finite.length === 0 ? null : Math.max(...finite) } }
}

export interface Phase2C26B2C1RouteRow {
  targetWeaponId: string
  subgroups: string[]
  b2b1: { minimalCardinality: Phase2C26B2C1Minimal; withinDefaultExtent: boolean; b2a: Phase2C26B2C1B2B1Route['b2a'] }
  reach: Phase2C26B2C1TargetReach
}

/** The subgroups the RESULT reports. */
export const PHASE2C26B2C1_SUBGROUPS = ['recovered', 'defaultExtent', 'extentInsufficient', 'contextGapRecovered', 'b2aCovered', 'probeGap', 'k1Minimal', 'k2Minimal', 'unreached'] as const

export function phase2c26b2c1Subgroups(route: Phase2C26B2C1B2B1Route): string[] {
  const recovered = ['0', '1', '2'].includes(route.minimalCardinality)
  const out: string[] = []
  if (recovered) out.push('recovered')
  if (recovered && route.withinDefaultExtent) out.push('defaultExtent')
  if (recovered && !route.withinDefaultExtent) out.push('extentInsufficient')
  if (recovered && route.b2a.contextGap) out.push('contextGapRecovered')
  if (route.b2a.covered) out.push('b2aCovered')
  if (route.b2a.probeGap) out.push('probeGap')
  if (route.minimalCardinality === '1') out.push('k1Minimal')
  if (route.minimalCardinality === '2') out.push('k2Minimal')
  if (route.minimalCardinality === 'unreached') out.push('unreached')
  return out
}

export function phase2c26b2c1PolicyAggregates(rows: readonly Phase2C26B2C1RouteRow[]) {
  return Object.fromEntries(PHASE2C26B2C1_POLICY_IDS.map(policy => [policy, Object.fromEntries(PHASE2C26B2C1_SUBGROUPS.map(subgroup => {
    const members = rows.filter(row => row.subgroups.includes(subgroup))
    const aggregate = phase2c26b2c1PolicyAggregate(members.map(row => row.reach.firstCompatible[policy].rank))
    const extra = subgroup === 'k2Minimal' ? { k1ContextsBeforeFirstCompatible: phase2c26b2c1PolicyAggregate(members.map(row => row.reach.firstCompatible[policy].k1Before)).rank } : {}
    return [subgroup, { ...aggregate, ...extra }]
  }))])) as Record<Phase2C26B2C1PolicyId, Record<string, Phase2C26B2C1PolicyAggregate & { k1ContextsBeforeFirstCompatible?: Phase2C26B2C1PolicyAggregate['rank'] }>>
}

/** Distribution of one numeric feature over context rows. */
function featureSummary(values: readonly number[]) {
  return { contexts: values.length, zero: values.filter(v => v === 0).length, min: values.length === 0 ? null : Math.min(...values), p25: phase2c26b2c1Percentile(values, 25),
    median: phase2c26b2c1Percentile(values, 50), p75: phase2c26b2c1Percentile(values, 75), p90: phase2c26b2c1Percentile(values, 90), max: values.length === 0 ? null : Math.max(...values) }
}

/** Feature distributions over every Target x context row, by eligible minimum cardinality (oracle-free). */
export function phase2c26b2c1FeatureAggregates(contexts: readonly Phase2C26B2C1ContextRow[]) {
  const pick = {
    exclusiveOwnedWeaponCount: (c: Phase2C26B2C1ContextRow) => c.features.exclusiveOwnedWeaponCount,
    blockedDefaultTotal: (c: Phase2C26B2C1ContextRow) => c.features.default.total.blocked,
    shareableHeldDefaultTotal: (c: Phase2C26B2C1ContextRow) => c.features.default.total.shareableHeld,
    heldDefaultTotal: (c: Phase2C26B2C1ContextRow) => c.features.default.total.held,
    blockedFullTotal: (c: Phase2C26B2C1ContextRow) => c.features.full.total.blocked,
    shareableHeldFullTotal: (c: Phase2C26B2C1ContextRow) => c.features.full.total.shareableHeld,
    heldFullTotal: (c: Phase2C26B2C1ContextRow) => c.features.full.total.held,
    ...Object.fromEntries((['normalRelevant', 'skill', 'gogma'] as const).flatMap(stream => (['full', 'default'] as const).flatMap(scope => (['held', 'blocked', 'shareableHeld'] as const)
      .map(field => [`${stream}.${scope}.${field}`, (c: Phase2C26B2C1ContextRow) => c.features[scope][stream][field]])))),
  } as Record<string, (c: Phase2C26B2C1ContextRow) => number>
  const by = (subset: readonly Phase2C26B2C1ContextRow[]) => Object.fromEntries(Object.entries(pick).map(([name, f]) => [name, featureSummary(subset.map(f))]))
  return {
    contexts: contexts.length,
    byCardinality: countBy(contexts, c => String(c.targetEligibleMinCardinality)),
    exclusiveOwnedWeaponCountHistogram: countBy(contexts, c => String(c.features.exclusiveOwnedWeaponCount)),
    k1: by(contexts.filter(c => c.targetEligibleMinCardinality === 1)),
    k2: by(contexts.filter(c => c.targetEligibleMinCardinality === 2)),
  }
}

// ---------------------------------------------------------------- selection and decision (registered before the formal run)

export type Phase2C26B2C1DecisionCase = 'B2C1_TOP8' | 'B2C1_TOP16' | 'B2C1_TOP32' | 'B2C1_WIDE' | 'B2C1_INVALID'

export const PHASE2C26B2C1_SELECTION_RULE = {
  oracleGuidedPolicyEvaluation: true,
  population: 'recovered (B2-B1 minimal cardinality 0 / 1 / 2: 40 Routes)',
  keys: ['top8 coverage DESC', 'top16 coverage DESC', 'top32 coverage DESC', 'p90 firstCompatibleRank ASC', 'max firstCompatibleRank ASC', 'policy ID ASC'],
  note: 'The selection only picks the Research candidate among P0..P3 by post-hoc oracle coverage; it is not a Production policy adoption.',
} as const

export const PHASE2C26B2C1_DECISION_RULE = {
  order: [
    'B2C1_INVALID: a formal context universe mismatch, a B2-B1 authority mismatch, an Export / oracle / manifest mismatch, a Target count mismatch, a K0 / K1 / K2 universe mismatch, a B2-B1 compatible count parity mismatch, a minimal cardinality mismatch, a policy definition drift, a nondeterministic ordering, an oracle isolation failure, a provenance failure, a raw / result inconsistency, an unreached Route with a finite rank, or a recovered Route without one',
    'B2C1_TOP8: under the selected Research policy every recovered Route has a first compatible rank <= 8',
    'B2C1_TOP16: <= 16 (not TOP8)',
    'B2C1_TOP32: <= 32 (not above)',
    'B2C1_WIDE: every recovered rank is finite, the maximum is > 32',
  ],
  compatible: 'reservation compatibility only (phase2c26b2aReachability); an extent-insufficient Route under a compatible reservation still counts',
  budgets: 'powers-of-two diagnostic budgets for the next Research Search Phase, never Production defaults',
} as const

export const PHASE2C26B2C1_RECOMMENDATION: Record<Phase2C26B2C1DecisionCase, string> = {
  B2C1_TOP8: 'selected policyをoracle無しで実際に走らせるscheduler Search Phaseへ（default extent内20件をまず再検証し、Candidate capture policyも同時に比較）',
  B2C1_TOP16: 'selected policyをoracle無しで実際に走らせるscheduler Search Phaseへ（default extent内20件をまず再検証し、Candidate capture policyも同時に比較）',
  B2C1_TOP32: 'Search runtimeを考慮してstaged budget / early-stop設計を先に行う',
  B2C1_WIDE: '現在のreservation geometryだけでは良いscheduler orderingになっていないため、Searchを大量実行する前にcontext feature / groupingを再研究',
  B2C1_INVALID: '次へ進まず原因調査',
}

export interface Phase2C26B2C1SelectionRow { policy: Phase2C26B2C1PolicyId; top8: number; top16: number; top32: number; p90: number | null; max: number | null }

/** Lexicographic selection over the recovered population (the registered rule). */
export function phase2c26b2c1SelectPolicy(rows: readonly Phase2C26B2C1SelectionRow[]): Phase2C26B2C1SelectionRow {
  if (rows.length === 0) throw new Error('No policy to select.')
  const nullHigh = (value: number | null) => value ?? Number.POSITIVE_INFINITY
  return [...rows].sort((a, b) => b.top8 - a.top8 || b.top16 - a.top16 || b.top32 - a.top32 || nullHigh(a.p90) - nullHigh(b.p90) || nullHigh(a.max) - nullHigh(b.max)
    || compare(a.policy, b.policy))[0]!
}

export function phase2c26b2c1Decision(input: { invalidReasons: readonly string[]; recovered: number; selectedFiniteRanks: readonly number[] }) {
  const { recovered, selectedFiniteRanks } = input
  if (!Number.isInteger(recovered) || recovered < 0 || selectedFiniteRanks.some(rank => !Number.isInteger(rank) || rank < 1)) throw new Error(`Inconsistent Phase 2-C2.6-B2-C1 decision input: ${JSON.stringify(input)}`)
  const reasons = [...input.invalidReasons, ...(recovered === 0 ? ['no_recovered_route'] : []), ...(selectedFiniteRanks.length !== recovered ? ['selected_policy_leaves_a_recovered_route_unranked'] : [])]
  const max = selectedFiniteRanks.length === 0 ? Number.POSITIVE_INFINITY : Math.max(...selectedFiniteRanks)
  const caseId: Phase2C26B2C1DecisionCase = reasons.length > 0 ? 'B2C1_INVALID' : max <= 8 ? 'B2C1_TOP8' : max <= 16 ? 'B2C1_TOP16' : max <= 32 ? 'B2C1_TOP32' : 'B2C1_WIDE'
  return { case: caseId, reasons, recommendation: PHASE2C26B2C1_RECOMMENDATION[caseId] }
}

// ---------------------------------------------------------------- the whole audit

/** The registered population the formal audit expects (the B2-B1 authority's 43 Routes and their subgroups). */
export const PHASE2C26B2C1_EXPECTED_POPULATION = {
  targets: 43,
  subgroups: { recovered: 40, defaultExtent: 20, extentInsufficient: 20, contextGapRecovered: 37, b2aCovered: 2, probeGap: 1, k1Minimal: 31, k2Minimal: 9, unreached: 3 },
} as const

export interface Phase2C26B2C1AuditInput {
  schedule: Phase2C26B2C1Schedule
  authority: Phase2C26B2C1B2B1Authority
  manifest: readonly Phase2C26B2AOracleRouteSpec[]
  oracle: Phase2C26B2AOracle
  sha: (value: string) => string
  /** Tests only: a synthetic world's population. The analyzer never passes it. */
  expected?: { targets: number; subgroups: Record<string, number> }
}

/**
 * Schedule consistency, B2-B1 parity, then every oracle Route against every context of its Target, the B2-B1 compatible
 * count / minimal cardinality / extent parity, the first compatible rank under each policy, the aggregates, the selection
 * and every invalid reason.
 */
export async function runPhase2C26B2C1Audit({ schedule, authority, manifest, oracle, sha, expected = PHASE2C26B2C1_EXPECTED_POPULATION }: Phase2C26B2C1AuditInput) {
  const invalidReasons: string[] = []
  const consistency = validatePhase2C26B2C1Schedule(schedule)
  invalidReasons.push(...consistency.issues.map(i => `schedule: ${i}`))
  const parity = validatePhase2C26B2C1B2B1Parity(schedule, authority, sha)
  invalidReasons.push(...parity.issues.map(i => `b2b1_parity: ${i}`))
  const snapshot = schedule.snapshot
  const weaponTypeOf = new Map(oracle.routes.map(route => [route.targetWeaponId, route.weaponTypeId]))
  const views = new Map(manifest.map(spec => [spec.targetWeaponId, phase2c26b2aRouteView(spec, weaponTypeOf.get(spec.targetWeaponId)!)] as const))
  const originsOf = (view: Phase2C26B2ARouteView): Phase2C26B2AOrigins => ({ skill: schedule.origins.skill, gogma: schedule.origins.gogma,
    normal: snapshot.origin.normalCounters.find(c => c.counterId === view.normalCounterId)?.counter ?? null })
  const targetIds = schedule.targets.map(t => t.targetWeaponId).sort(compare)
  if (targetIds.length !== expected.targets) invalidReasons.push(`targets: ${targetIds.length} Targets, not ${expected.targets}`)
  if (!same(targetIds, [...views.keys()].sort(compare)) || !same(targetIds, authority.routes.map(r => r.targetWeaponId).sort(compare))) invalidReasons.push('targets: the schedule Targets are not the oracle / B2-B1 Routes')
  const b2b1ByTarget = new Map(authority.routes.map(route => [route.targetWeaponId, route]))
  const rowsByTarget = new Map<string, Phase2C26B2C1ContextRow[]>()
  for (const row of schedule.contexts) rowsByTarget.set(row.targetWeaponId, [...(rowsByTarget.get(row.targetWeaponId) ?? []), row])
  const rows: Phase2C26B2C1RouteRow[] = []
  for (const view of [...views.values()].sort((a, b) => compare(a.targetWeaponId, b.targetWeaponId))) {
    const b2b1 = b2b1ByTarget.get(view.targetWeaponId)
    const target = schedule.targets.find(t => t.targetWeaponId === view.targetWeaponId)
    if (!b2b1 || !target) continue
    const origins = originsOf(view)
    if (target.relevantNormalCounterId !== null && target.relevantNormalCounterId !== view.normalCounterId) invalidReasons.push(`normal: ${view.targetWeaponId}: the relevant Normal Counter is not the Route's weapon-type Counter`)
    const extent = phase2c26b2aRouteExtent(view, origins, schedule.extent)
    if (!same({ withinDefaultExtent: extent.withinDefaultExtent, verdict: extent.verdict, required: extent.required, reach: extent.reach }, b2b1.extent)) invalidReasons.push(`extent: ${view.targetWeaponId}: the Route extent differs from B2-B1`)
    if (phase2c26b2c1RouteWithinWindows(view, target.windows) !== extent.withinDefaultExtent) invalidReasons.push(`windows: ${view.targetWeaponId}: the default windows disagree with the B2-A Route extent`)
    const reach = await phase2c26b2c1TargetReach({ view, origins, schedule, rows: rowsByTarget.get(view.targetWeaponId) ?? [], supporters: new Set(b2b1.supportTargetWeaponIds) })
    invalidReasons.push(...reach.inconsistencies.map(i => `audit: ${i}`))
    if (!same(reach.compatibleByCardinality, b2b1.compatibleContexts)) invalidReasons.push(`b2b1_compatible_count: ${view.targetWeaponId}: ${JSON.stringify(reach.compatibleByCardinality)} vs ${JSON.stringify(b2b1.compatibleContexts)}`)
    if (reach.minimalCardinality !== b2b1.minimalCardinality) invalidReasons.push(`b2b1_minimal_cardinality: ${view.targetWeaponId}: ${reach.minimalCardinality} vs ${b2b1.minimalCardinality}`)
    const subgroups = phase2c26b2c1Subgroups(b2b1)
    for (const policy of PHASE2C26B2C1_POLICY_IDS) {
      const rank = reach.firstCompatible[policy].rank
      if (subgroups.includes('unreached') && rank !== null) invalidReasons.push(`rank: ${view.targetWeaponId}: an unreached Route has a finite ${policy} rank`)
      if (subgroups.includes('recovered') && rank === null) invalidReasons.push(`rank: ${view.targetWeaponId}: a recovered Route has no ${policy} rank`)
    }
    rows.push({ targetWeaponId: view.targetWeaponId, subgroups, b2b1: { minimalCardinality: b2b1.minimalCardinality, withinDefaultExtent: b2b1.withinDefaultExtent, b2a: b2b1.b2a }, reach })
  }
  const subgroupCounts = Object.fromEntries(PHASE2C26B2C1_SUBGROUPS.map(s => [s, rows.filter(row => row.subgroups.includes(s)).length]))
  if (!same(subgroupCounts, expected.subgroups)) invalidReasons.push(`subgroups: ${JSON.stringify(subgroupCounts)} are not the registered ${JSON.stringify(expected.subgroups)}`)
  const policyAggregates = phase2c26b2c1PolicyAggregates(rows)
  const selectionRows: Phase2C26B2C1SelectionRow[] = PHASE2C26B2C1_POLICY_IDS.map(policy => {
    const agg = policyAggregates[policy].recovered!
    return { policy, top8: agg.cdf.top8!, top16: agg.cdf.top16!, top32: agg.cdf.top32!, p90: agg.rank.p90, max: agg.rank.max }
  })
  const selected = phase2c26b2c1SelectPolicy(selectionRows)
  const recovered = rows.filter(row => row.subgroups.includes('recovered'))
  const selectedFiniteRanks = recovered.map(row => row.reach.firstCompatible[selected.policy].rank).filter((rank): rank is number => rank !== null)
  return { consistency, parity, rows, subgroupCounts, policyAggregates, featureAggregates: phase2c26b2c1FeatureAggregates(schedule.contexts), selectionRows, selected,
    invalidReasons, decisionInput: { recovered: recovered.length, selectedFiniteRanks } }
}
