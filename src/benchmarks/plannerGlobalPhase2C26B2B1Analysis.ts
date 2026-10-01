/**
 * Issue #154 Phase 2-C2.6-B2-B1 post-hoc analysis only. It reads a finished B2-B1 fixed-set reservation snapshot and,
 * as explicit analyzer arguments AFTER the snapshot run ended, the B2-A RESULT (authority: its context gaps, its
 * single-winner contexts and their reachability verdicts), the 1,657 oracle RESULT and the oracle manifest. It runs no
 * Search, no kernel and no Planner, and it feeds no evidence into any calculation.
 *
 * The question: once 0, 1 or 2 CURRENT Routes are held fixed (every set, chosen without the oracle), which oracle Routes
 * become representable under the Search Domain's held / blocked / exclusive OwnedWeapon contract. Reachability is the
 * unchanged B2-A helper (`phase2c26b2aReachability()`, itself the Production `nextOperationPositions()` /
 * `heldPrefixNormalCreation()` walk) and the extent the unchanged `phase2c26b2aRouteExtent()`; nothing is re-implemented.
 *
 * A compatible context proves only that the oracle Route itself is expressible under that reservation; never that a
 * Search delivers it, nor that the fixed set belongs to a final 43-Target Plan. The oracle is a post-hoc diagnostic
 * fixture of Issue #154, never a Production heuristic and never a game rule; its support providers are read only after
 * every context exists, to explain a recovery, never to choose a fixed set.
 */
import { stableStringify } from '../domain/models/hashing'
import { defaultPlannerAlternativeSearchExtent, normalizePlannerAlternativeReservation, type PlannerAlternativeReservation } from '../domain/search'
import { phase2c26b1SearchInputDigest } from './plannerGlobalPhase2C26B1'
import type { Phase2C25APreSearchContext } from './plannerGlobalPhase2C25A'
import {
  phase2c26b2aOccupancy,
  phase2c26b2aPattern,
  phase2c26b2aRanges,
  phase2c26b2aReachability,
  phase2c26b2aReservationRanges,
  phase2c26b2aRouteExtent,
  phase2c26b2aRouteView,
  phase2c26b2aSupport,
  type Phase2C26B2ALaneCheck,
  type Phase2C26B2AOracle,
  type Phase2C26B2AOracleRouteSpec,
  type Phase2C26B2AOrigins,
  type Phase2C26B2AReachability,
  type Phase2C26B2ARouteExtent,
  type Phase2C26B2ARouteView,
} from './plannerGlobalPhase2C26B2AAnalysis'
import {
  enumeratePhase2C26B2B1FixedSets,
  phase2c26b2b1FixedSetId,
  type Phase2C26B2B1Cardinality,
  type Phase2C26B2B1Snapshot,
} from './plannerGlobalPhase2C26B2B1'

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

// ---------------------------------------------------------------- the B2-A RESULT (authority)

/** The B2-A result this phase is registered against. Any other value fails closed. */
export const PHASE2C26B2B1_REGISTERED_B2A = {
  /** The Export SHA-256 is not written here (the Phase 2-A.5 isolation rule): the analyzer checks snapshot = B2-A = oracle RESULT. */
  resultSha256: '7f425ca46d7908280793440570d8af6e85fe589ec8772160021f15f2e814b883',
  decisionCase: 'B2A_BOTH',
  coverage: { routes: 43, covered: 2, uncovered: 41 },
  uncovered: { probeGap: 1, contextGap: 40, compatibleContextUnfinished: 1, compatibleButExtentInsufficient: 1, noSearchContext: 9, noReservationCompatibleContext: 31 },
  /** Context-gap subgroups: non-participants (no Search context), participants (every single-winner context incompatible), uncovered oracle held Routes. */
  subgroups: { nonParticipantContextGap: 9, participantContextGap: 31, uncoveredOracleHeld: 17, uncoveredOracleHeldContextGap: 17 },
  snapshotContexts: 146,
} as const

/** The range form B2-A recorded for one lane / one reachability (`analyze-planner-global-phase2c26b2a.mjs`). */
export function phase2c26b2b1LaneRow(lane: Phase2C26B2ALaneCheck | null) {
  return lane === null ? null : { compatible: lane.compatible, missingHeld: phase2c26b2aRanges(lane.missingHeld), blockedOwn: phase2c26b2aRanges(lane.blockedOwn),
    heldPrefixOverlap: phase2c26b2aRanges(lane.heldPrefixOverlap), productionLimitAccepts: lane.productionLimitAccepts }
}
export function phase2c26b2b1ReachRow(reach: Phase2C26B2AReachability) {
  return { compatible: reach.compatible, reasons: reach.reasons,
    lanes: { normal: phase2c26b2b1LaneRow(reach.lanes.normal), skill: phase2c26b2b1LaneRow(reach.lanes.skill), gogma: phase2c26b2b1LaneRow(reach.lanes.gogma) },
    productionLimitAccepts: reach.productionLimitAccepts }
}

export interface Phase2C26B2B1B2AContextRow {
  orientationId: string
  workIndex: number
  targetWeaponId: string
  status: string
  searchInputDigest: string
  originDigest: string
  fixedRouteBuildListEntryIds: string[]
  invalidatedBuildListEntryId: string
  excludedRouteKeySha256s: string[]
  extent: unknown
  reservation: unknown
}

export interface Phase2C26B2B1B2ARoute {
  targetWeaponId: string
  conflictParticipant: boolean
  covered: boolean
  oracleHeldRoute: boolean
  probeGap: boolean
  contextGap: boolean
  pattern: string | null
  extent: unknown
  emptyReservation: unknown
  supportTargetWeaponIds: string[]
  ambiguousCandidateTargetWeaponIds: string[]
  contexts: { orientationId: string; workIndex: number; fixedTargetWeaponId: string; reservation: unknown }[]
}

export interface Phase2C26B2B1B2AAuthority {
  measuredHead: string
  analysisHead: string
  exportSha256: string
  oracleResultSha256: string
  oracleManifestFileSha256: string
  oracleManifestRoutesSha256: string
  origin: unknown
  rows: Phase2C26B2B1B2AContextRow[]
  routes: Phase2C26B2B1B2ARoute[]
}

/**
 * Reads the committed B2-A RESULT as untrusted JSON and fails closed unless it is the registered formal result: its own
 * SHA-256, formal with no calculation change after its measured HEAD, case B2A_BOTH, no invalid reason and no audit
 * inconsistency, coverage 2 / 41 of 43, probe gap 1 / context gap 40 (compatible-unfinished 1, compatible-but-extent 1,
 * no Search context 9, no compatible context 31), the 9 / 31 / 17 subgroups, and 146 readable single-fixed-Entry contexts.
 */
export function parsePhase2C26B2B1B2AAuthority(json: unknown, resultSha256: string): { valid: boolean; issues: string[]; authority: Phase2C26B2B1B2AAuthority | null } {
  const issues: string[] = []
  const r = PHASE2C26B2B1_REGISTERED_B2A
  if (!isObject(json) || !isObject(json.provenance) || !isObject(json.decision) || !isObject(json.aggregates) || !isObject(json.snapshot)) {
    return { valid: false, issues: ['B2-A RESULT lacks provenance / decision / aggregates / snapshot'], authority: null }
  }
  const { provenance, decision, aggregates, snapshot } = json
  if (resultSha256 !== r.resultSha256) issues.push(`B2-A RESULT SHA-256 ${resultSha256} is not the registered ${r.resultSha256}`)
  if (provenance.formal !== true) issues.push('provenance.formal is not true')
  if (!Array.isArray(provenance.calculationCodeChangedSinceMeasuredHead) || provenance.calculationCodeChangedSinceMeasuredHead.length !== 0) issues.push('provenance.calculationCodeChangedSinceMeasuredHead is not empty')
  if (typeof provenance.exportSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(provenance.exportSha256)) issues.push('provenance.exportSha256 is not a SHA-256')
  for (const field of ['measuredHead', 'analysisHead'] as const) if (typeof provenance[field] !== 'string' || !/^[0-9a-f]{40}$/.test(provenance[field] as string)) issues.push(`provenance.${field} is not a commit SHA`)
  for (const field of ['oracleResultSha256', 'oracleManifestFileSha256', 'oracleManifestRoutesSha256'] as const) {
    if (typeof provenance[field] !== 'string' || !/^[0-9a-f]{64}$/.test(provenance[field] as string)) issues.push(`provenance.${field} is not a SHA-256`)
  }
  if (decision.case !== r.decisionCase) issues.push(`decision.case ${String(decision.case)} is not ${r.decisionCase}`)
  if (!Array.isArray(json.invalidReasons) || json.invalidReasons.length !== 0) issues.push('invalidReasons is not empty')
  if (!Array.isArray(json.inconsistencies) || json.inconsistencies.length !== 0) issues.push('audit inconsistencies is not empty')
  const coverage = isObject(aggregates.coverage) ? aggregates.coverage : {}
  for (const [field, expected] of Object.entries(r.coverage)) if (coverage[field] !== expected) issues.push(`aggregates.coverage.${field} ${String(coverage[field])} is not ${expected}`)
  const uncovered = isObject(aggregates.uncovered) ? aggregates.uncovered : {}
  for (const [field, expected] of Object.entries(r.uncovered)) if (uncovered[field] !== expected) issues.push(`aggregates.uncovered.${field} ${String(uncovered[field])} is not ${expected}`)

  const rows: Phase2C26B2B1B2AContextRow[] = []
  for (const raw of asArray(snapshot.rows)) {
    if (!isObject(raw) || typeof raw.orientationId !== 'string' || typeof raw.workIndex !== 'number' || typeof raw.targetWeaponId !== 'string' || typeof raw.searchInputDigest !== 'string'
      || typeof raw.originDigest !== 'string' || !Array.isArray(raw.fixedRouteBuildListEntryIds) || typeof raw.invalidatedBuildListEntryId !== 'string' || !Array.isArray(raw.excludedRouteKeySha256s)) {
      issues.push('a B2-A snapshot row is malformed'); continue
    }
    rows.push({ orientationId: raw.orientationId, workIndex: raw.workIndex, targetWeaponId: raw.targetWeaponId, status: String(raw.status), searchInputDigest: raw.searchInputDigest,
      originDigest: raw.originDigest, fixedRouteBuildListEntryIds: raw.fixedRouteBuildListEntryIds as string[], invalidatedBuildListEntryId: raw.invalidatedBuildListEntryId,
      excludedRouteKeySha256s: raw.excludedRouteKeySha256s as string[], extent: raw.extent, reservation: raw.reservation ?? null })
  }
  if (rows.length !== r.snapshotContexts) issues.push(`B2-A snapshot has ${rows.length} contexts, not ${r.snapshotContexts}`)
  if (rows.some(row => row.fixedRouteBuildListEntryIds.length !== 1 || row.status !== 'searchable')) issues.push('a B2-A context is not a searchable single-fixed-Entry context')

  const routes: Phase2C26B2B1B2ARoute[] = []
  for (const raw of asArray(json.routes)) {
    const support = isObject(raw) && isObject(raw.support) ? raw.support : null
    if (!isObject(raw) || !support || typeof raw.targetWeaponId !== 'string' || typeof raw.conflictParticipant !== 'boolean' || typeof raw.covered !== 'boolean'
      || typeof raw.oracleHeldRoute !== 'boolean' || typeof raw.probeGap !== 'boolean' || typeof raw.contextGap !== 'boolean' || !Array.isArray(raw.contexts)) {
      issues.push('a B2-A route row is malformed'); continue
    }
    const contexts: Phase2C26B2B1B2ARoute['contexts'] = []
    for (const c of raw.contexts) {
      if (!isObject(c) || typeof c.orientationId !== 'string' || typeof c.workIndex !== 'number' || typeof c.fixedTargetWeaponId !== 'string') { issues.push(`a B2-A context of ${raw.targetWeaponId} is malformed`); continue }
      contexts.push({ orientationId: c.orientationId, workIndex: c.workIndex, fixedTargetWeaponId: c.fixedTargetWeaponId, reservation: c.reservation ?? null })
    }
    routes.push({ targetWeaponId: raw.targetWeaponId, conflictParticipant: raw.conflictParticipant, covered: raw.covered, oracleHeldRoute: raw.oracleHeldRoute, probeGap: raw.probeGap,
      contextGap: raw.contextGap, pattern: typeof raw.pattern === 'string' ? raw.pattern : null, extent: raw.extent, emptyReservation: raw.emptyReservation,
      supportTargetWeaponIds: asArray(support.supportTargetWeaponIds).map(String), ambiguousCandidateTargetWeaponIds: asArray(support.ambiguousCandidateTargetWeaponIds).map(String), contexts })
  }
  if (routes.length !== r.coverage.routes || new Set(routes.map(route => route.targetWeaponId)).size !== routes.length) issues.push('B2-A routes are not 43 distinct Routes')
  const counts = {
    nonParticipantContextGap: routes.filter(route => route.contextGap && !route.conflictParticipant).length,
    participantContextGap: routes.filter(route => route.contextGap && route.conflictParticipant).length,
    uncoveredOracleHeld: routes.filter(route => !route.covered && route.oracleHeldRoute).length,
    uncoveredOracleHeldContextGap: routes.filter(route => !route.covered && route.oracleHeldRoute && route.contextGap).length,
  }
  for (const [field, expected] of Object.entries(r.subgroups)) if (counts[field as keyof typeof counts] !== expected) issues.push(`B2-A subgroup ${field} ${counts[field as keyof typeof counts]} is not ${expected}`)
  if (routes.filter(route => route.covered).length !== r.coverage.covered || routes.filter(route => route.probeGap).length !== r.uncovered.probeGap
    || routes.filter(route => route.contextGap).length !== r.uncovered.contextGap) issues.push('B2-A route rows do not add up to the registered aggregates')
  if (issues.length > 0) return { valid: false, issues, authority: null }
  return { valid: true, issues: [], authority: {
    measuredHead: String(provenance.measuredHead), analysisHead: String(provenance.analysisHead), exportSha256: String(provenance.exportSha256),
    oracleResultSha256: String(provenance.oracleResultSha256), oracleManifestFileSha256: String(provenance.oracleManifestFileSha256),
    oracleManifestRoutesSha256: String(provenance.oracleManifestRoutesSha256), origin: snapshot.origin, rows, routes,
  } }
}

// ---------------------------------------------------------------- snapshot consistency (the calculation re-read)

export interface Phase2C26B2B1SnapshotConsistency {
  valid: boolean
  issues: string[]
  fixedSets: { proposed: Record<'0' | '1' | '2', number>; valid: Record<'0' | '1' | '2', number>; invalid: Record<'0' | '1' | '2', number> }
}

/**
 * Re-reads the snapshot and fails closed on any internal drift: the calculation's own checks, one current Entry per
 * planning Target, the deterministic K0 / K1 / K2 enumeration over those Entries, the group alias partition and minimum
 * cardinality, and every Target's contexts re-derived from the groups (no context with the Target's own Entry, none for
 * a checkpoint hard-constraint Target).
 */
export function validatePhase2C26B2B1Snapshot(snapshot: Phase2C26B2B1Snapshot): Phase2C26B2B1SnapshotConsistency {
  const issues: string[] = []
  for (const [check, ok] of Object.entries(snapshot.checks)) {
    if (check === 'k2ConflictPairs') {
      if (snapshot.input.initialRelevantEntries === snapshot.input.allSearchEntries && !snapshot.checks.k2ConflictPairs.matches) issues.push('an invalid K2 pair is listed in no initial Conflict')
    } else if (ok !== true) issues.push(`calculation check ${check} failed`)
  }
  if (snapshot.input.planningTargets !== snapshot.targets.length || snapshot.input.allSearchEntries !== snapshot.targets.length) issues.push('planning Targets and current searchable Entries are not one to one')
  if (new Set(snapshot.targets.map(t => t.currentBuildListEntryId)).size !== snapshot.targets.length) issues.push('two Targets share one current Entry')
  if (!same(snapshot.extent, { ...defaultPlannerAlternativeSearchExtent })) issues.push('the extent is not the Production default extent')
  const expected = enumeratePhase2C26B2B1FixedSets(snapshot.targets.map(t => t.currentBuildListEntryId)).map(ids => phase2c26b2b1FixedSetId(ids))
  if (!same(snapshot.fixedSets.map(row => row.fixedSetId), expected)) issues.push('the fixed sets are not the deterministic K0 / K1 / K2 enumeration')
  const targetOfEntry = new Map(snapshot.targets.map(t => [t.currentBuildListEntryId, t.targetWeaponId]))
  const proposed = { '0': 0, '1': 0, '2': 0 }, valid = { '0': 0, '1': 0, '2': 0 }, invalid = { '0': 0, '1': 0, '2': 0 }
  for (const row of snapshot.fixedSets) {
    const k = String(row.cardinality) as '0' | '1' | '2'
    proposed[k] += 1
    if (row.valid) valid[k] += 1
    else invalid[k] += 1
    if (row.fixedBuildListEntryIds.length !== row.cardinality || phase2c26b2b1FixedSetId(row.fixedBuildListEntryIds) !== row.fixedSetId) issues.push(`${row.fixedSetId}: cardinality / ID drift`)
    if (!same(row.fixedTargetWeaponIds, row.fixedBuildListEntryIds.map(id => targetOfEntry.get(id) ?? '?').sort(compare))) issues.push(`${row.fixedSetId}: fixed Target IDs drift`)
    if (row.valid !== (row.routePlanRejectionEntryIds.length === 0 && row.conflicts.length === 0)) issues.push(`${row.fixedSetId}: validity is not "no rejection and no Conflict"`)
    if (row.valid !== (row.reservationGroupIndex !== null)) issues.push(`${row.fixedSetId}: a valid set without a reservation (or the reverse)`)
    if (row.reservationGroupIndex !== null && !snapshot.reservationGroups[row.reservationGroupIndex]?.aliasFixedSetIds.includes(row.fixedSetId)) issues.push(`${row.fixedSetId}: not an alias of its group`)
  }
  const aliasCount = snapshot.reservationGroups.reduce((sum, group) => sum + group.aliasFixedSetIds.length, 0)
  if (aliasCount !== snapshot.fixedSets.filter(row => row.valid).length) issues.push('the reservation groups do not partition the valid fixed sets')
  if (new Set(snapshot.reservationGroups.map(group => stableStringify(group.reservation))).size !== snapshot.reservationGroups.length) issues.push('two reservation groups hold the same reservation')
  const byId = new Map(snapshot.fixedSets.map(row => [row.fixedSetId, row]))
  snapshot.reservationGroups.forEach((group, index) => {
    if (group.groupIndex !== index) issues.push(`group ${index}: index drift`)
    const cards = group.aliasFixedSetIds.map(id => byId.get(id)?.cardinality ?? -1)
    if (cards.length === 0 || group.minCardinality !== Math.min(...cards)) issues.push(`group ${index}: minimum cardinality drift`)
  })
  for (const target of snapshot.targets) {
    const row = snapshot.targetContexts.find(c => c.targetWeaponId === target.targetWeaponId)
    if (!row) { issues.push(`${target.targetWeaponId}: no context row`); continue }
    if (target.checkpointHardConstraint) {
      if (row.status !== 'checkpoint_hard_constraint' || row.contexts.length !== 0) issues.push(`${target.targetWeaponId}: a checkpoint hard-constraint Target got contexts`)
      continue
    }
    const derived: [number, number, number][] = []
    let raw = 0
    for (const group of snapshot.reservationGroups) {
      const eligible = group.aliasFixedSetIds.map(id => byId.get(id)!).filter(fs => !fs.fixedBuildListEntryIds.includes(target.currentBuildListEntryId))
      if (eligible.length === 0) continue
      raw += eligible.length
      derived.push([group.groupIndex, Math.min(...eligible.map(fs => fs.cardinality)), eligible.length])
    }
    if (row.status !== 'searchable' || !same(row.contexts, derived) || row.rawContexts !== raw) issues.push(`${target.targetWeaponId}: contexts are not the eligible groups`)
  }
  if (snapshot.targetContexts.length !== snapshot.targets.length) issues.push('context rows and Targets differ in number')
  return { valid: issues.length === 0, issues, fixedSets: { proposed, valid, invalid } }
}

// ---------------------------------------------------------------- B2-A parity (origin, K1 contexts, reachability verdicts)

export interface Phase2C26B2B1B2AParity {
  valid: boolean
  issues: string[]
  origin: { digestMatches: boolean; countersMatch: boolean }
  k1Contexts: { checked: number; matched: number; mismatched: { orientationId: string; workIndex: number; fields: string[] }[] }
  reachability: { routesChecked: number; contextsChecked: number; extentMatches: number; emptyReservationMatches: number; verdictMatches: number; mismatches: string[] }
}

const originCounters = (snapshot: Phase2C26B2B1Snapshot) => ({ skill: snapshot.origin.skillCounter.value, gogma: snapshot.origin.gogmaCounter.value,
  normal: Object.fromEntries(snapshot.origin.normalCounters.map(n => [n.counterId, n.counter])) })

/**
 * B2-A's single-winner contexts must be K1 contexts of this snapshot: per B2-A row, its one fixed Entry is a valid K1
 * set whose group reservation is the B2-A reservation (range form), the Target's current Entry / excluded Route key /
 * extent / origin are B2-A's, the group is an eligible context of the Target, and the B1 searchInputDigest re-computed
 * from these fields is B2-A's. Then every B2-A (Route, context) reachability verdict, every B2-A empty-reservation
 * verdict (against K0) and every B2-A extent is reproduced by the same helpers.
 */
export async function validatePhase2C26B2B1B2AParity(input: { snapshot: Phase2C26B2B1Snapshot; authority: Phase2C26B2B1B2AAuthority; views: ReadonlyMap<string, Phase2C26B2ARouteView>;
  originsOf: (view: Phase2C26B2ARouteView) => Phase2C26B2AOrigins; sha: (value: string) => string }): Promise<Phase2C26B2B1B2AParity> {
  const { snapshot, authority, views, originsOf, sha } = input
  const issues: string[] = []
  const digestMatches = authority.rows.every(row => row.originDigest === snapshot.originDigest)
  const countersMatch = same(originCounters(snapshot), authority.origin)
  if (!digestMatches) issues.push('the Planner-start origin digest differs from B2-A')
  if (!countersMatch) issues.push('the Planner-start Counter origins differ from B2-A')
  const targetById = new Map(snapshot.targets.map(t => [t.targetWeaponId, t]))
  const fixedById = new Map(snapshot.fixedSets.map(row => [row.fixedSetId, row]))
  const contextsByTarget = new Map(snapshot.targetContexts.map(row => [row.targetWeaponId, new Set(row.contexts.map(c => c[0]))]))
  const groupOfRow = new Map<string, number>()
  const mismatched: Phase2C26B2B1B2AParity['k1Contexts']['mismatched'] = []
  for (const row of authority.rows) {
    const fields: string[] = []
    const target = targetById.get(row.targetWeaponId)
    const fixed = fixedById.get(phase2c26b2b1FixedSetId(row.fixedRouteBuildListEntryIds))
    if (!target) fields.push('target')
    if (!fixed || fixed.cardinality !== 1) fields.push('k1_fixed_set')
    else if (!fixed.valid || fixed.reservationGroupIndex === null) fields.push('k1_valid')
    const group = fixed?.reservationGroupIndex === null || fixed === undefined ? undefined : snapshot.reservationGroups[fixed.reservationGroupIndex]
    if (target && group) {
      if (target.currentBuildListEntryId !== row.invalidatedBuildListEntryId) fields.push('invalidatedBuildListEntryId')
      if (!same(target.excludedRouteKeys.map(sha), row.excludedRouteKeySha256s)) fields.push('excludedRouteKeys')
      if (!same(phase2c26b2aReservationRanges(group.reservation), row.reservation)) fields.push('reservation')
      if (!same(snapshot.extent, row.extent)) fields.push('extent')
      if (row.originDigest !== snapshot.originDigest) fields.push('originDigest')
      if (!contextsByTarget.get(target.targetWeaponId)?.has(group.groupIndex)) fields.push('not_an_eligible_context')
      const body: Phase2C25APreSearchContext = { orientationId: '', workIndex: 0, targetWeaponId: target.targetWeaponId, status: 'searchable',
        invalidatedBuildListEntryId: target.currentBuildListEntryId, invalidatedRouteKey: target.currentRouteKey, fixedRouteBuildListEntryIds: [...fixed!.fixedBuildListEntryIds],
        reservation: group.reservation, searchReservation: group.reservation, excludedRouteKeys: [...target.excludedRouteKeys], extent: { ...snapshot.extent },
        originDigest: snapshot.originDigest, contextDigest: '' }
      if (phase2c26b1SearchInputDigest(body) !== row.searchInputDigest) fields.push('searchInputDigest')
      groupOfRow.set(`${row.orientationId}\u0000${row.workIndex}`, group.groupIndex)
    }
    if (fields.length > 0) mismatched.push({ orientationId: row.orientationId, workIndex: row.workIndex, fields })
  }
  if (mismatched.length > 0) issues.push(`B2-A contexts are not K1 contexts: ${mismatched.slice(0, 10).map(m => `${m.orientationId}#${m.workIndex}(${m.fields.join('/')})`).join(', ')}`)

  const k0 = snapshot.fixedSets[0]!
  const empty = k0.reservationGroupIndex === null ? null : snapshot.reservationGroups[k0.reservationGroupIndex]!.reservation
  const mismatches: string[] = []
  let contextsChecked = 0, extentMatches = 0, emptyReservationMatches = 0, verdictMatches = 0
  for (const route of authority.routes) {
    const view = views.get(route.targetWeaponId)
    if (!view) { mismatches.push(`${route.targetWeaponId}: no oracle Route`); continue }
    const origins = originsOf(view)
    if (same(phase2c26b2aRouteExtent(view, origins, snapshot.extent), route.extent)) extentMatches += 1
    else mismatches.push(`${route.targetWeaponId}: extent`)
    if (empty !== null && same(phase2c26b2b1ReachRow(await phase2c26b2aReachability(view, empty, origins, snapshot.extent)), route.emptyReservation)) emptyReservationMatches += 1
    else mismatches.push(`${route.targetWeaponId}: empty reservation (K0) verdict`)
    for (const context of route.contexts) {
      contextsChecked += 1
      const groupIndex = groupOfRow.get(`${context.orientationId}\u0000${context.workIndex}`)
      if (groupIndex === undefined) { mismatches.push(`${route.targetWeaponId} @ ${context.orientationId}#${context.workIndex}: no K1 context`); continue }
      const reach = await phase2c26b2aReachability(view, snapshot.reservationGroups[groupIndex]!.reservation, origins, snapshot.extent)
      if (same(phase2c26b2b1ReachRow(reach), context.reservation)) verdictMatches += 1
      else mismatches.push(`${route.targetWeaponId} @ ${context.orientationId}#${context.workIndex}: reachability verdict`)
    }
  }
  if (mismatches.length > 0) issues.push(`B2-A reachability is not reproduced: ${mismatches.slice(0, 10).join(', ')}`)
  return { valid: issues.length === 0, issues, origin: { digestMatches, countersMatch },
    k1Contexts: { checked: authority.rows.length, matched: authority.rows.length - mismatched.length, mismatched },
    reachability: { routesChecked: authority.routes.length, contextsChecked, extentMatches, emptyReservationMatches, verdictMatches, mismatches } }
}

// ---------------------------------------------------------------- oracle reachability over every context

export type Phase2C26B2B1MinimalCardinality = '0' | '1' | '2' | 'unreached' | 'checkpoint_hard_constraint'

/** The held positions of several reservations at once, nothing blocked, no exclusive OwnedWeapon (a relaxation, never a context). */
function unionHeldOnly(reservations: readonly PlannerAlternativeReservation[]): PlannerAlternativeReservation {
  const normal = new Map<string, Set<number>>(), skill = new Set<number>(), gogma = new Set<number>()
  for (const res of reservations) {
    res.skill.held.forEach(p => skill.add(p))
    res.gogma.held.forEach(p => gogma.add(p))
    res.normal.forEach(n => { const set = normal.get(n.counterId) ?? new Set<number>(); n.held.forEach(p => set.add(p)); normal.set(n.counterId, set) })
  }
  const sorted = (set: Set<number>) => [...set].sort((a, b) => a - b)
  return { normal: [...normal.entries()].sort(([a], [b]) => compare(a, b)).map(([counterId, held]) => ({ counterId, held: sorted(held), blocked: [] })),
    skill: { held: sorted(skill), blocked: [] }, gogma: { held: sorted(gogma), blocked: [] }, exclusiveOwnedWeaponIds: [] }
}

/** The relaxation diagnostic: every current Route's held positions at once, nothing blocked, no exclusive OwnedWeapon. */
export function phase2c26b2b1HeldUnionReservation(snapshot: Phase2C26B2B1Snapshot): PlannerAlternativeReservation {
  return unionHeldOnly(snapshot.fixedSets.filter(row => row.cardinality === 1 && row.reservationGroupIndex !== null)
    .map(row => snapshot.reservationGroups[row.reservationGroupIndex!]!.reservation))
}

export interface Phase2C26B2B1RouteReach {
  targetWeaponId: string
  minimalCardinality: Phase2C26B2B1MinimalCardinality
  /** Reservation-compatible semantic contexts by their minimum eligible alias cardinality. */
  compatibleContexts: Record<'0' | '1' | '2', number>
  /** Contexts whose eligible aliases include a K1 set (whatever their minimum): "some single current Route suffices". */
  anyK1Compatible: boolean
  contextsChecked: number
  /** The first compatible context of the minimal cardinality in group order (diagnostic display only, never a ranking). */
  representative: null | { groupIndex: number; reservationDigest: string; fixedSetId: string; fixedTargetWeaponIds: string[]; cardinality: Phase2C26B2B1Cardinality }
  /** Every eligible alias of the minimal cardinality over every compatible context of that cardinality. */
  minimalAliases: { fixedSetId: string; fixedTargetWeaponIds: string[] }[]
  /** For an unreached Route: B2-A's pattern over every K<=2 context (best context = fewest missing held, then fewest reasons). */
  unreachedPattern: string | null
  unreachedBestMissing: null | { normal: number; skill: number; gogma: number; blockedOwn: number; reasons: string[] }
  /**
   * The held-union relaxation (every current Route held at once, nothing blocked, no exclusive OwnedWeapon). Only its
   * missing held positions are read: a position no current Route holds is held by no K of current Routes, so
   * `coversAllNeeded = false` rules out every current fixed set of any size. The union may over-hold a Normal prefix, so
   * its compatibility itself is not a necessary condition and is not used.
   */
  heldUnion: { coversAllNeeded: boolean; missingHeld: { normal: number; skill: number; gogma: number } }
  /**
   * The tighter relaxation (post-hoc analysis addition): the held union of only those current Routes (never the Target's
   * own) whose own K1 reservation neither blocks an own position of this Route nor holds its source OwnedWeapon exclusive.
   * A compatible fixed set of any size consists of such Routes only (its blocked / exclusive sets contain every member's),
   * so `coversAllNeeded = false` rules out every current fixed set of any size; `true` leaves K>=3 open (pairwise
   * Conflicts and the Normal held prefix are not considered).
   */
  nonBlockingHeldUnion: { members: number; coversAllNeeded: boolean; missingHeld: { normal: number; skill: number; gogma: number } }
  extent: Phase2C26B2ARouteExtent
  inconsistencies: string[]
}

const laneNames = ['normal', 'skill', 'gogma'] as const

export async function phase2c26b2b1RouteReach(input: { view: Phase2C26B2ARouteView; origins: Phase2C26B2AOrigins; snapshot: Phase2C26B2B1Snapshot; heldUnion: PlannerAlternativeReservation }): Promise<Phase2C26B2B1RouteReach> {
  const { view, origins, snapshot } = input
  const inconsistencies: string[] = []
  const extent = phase2c26b2aRouteExtent(view, origins, snapshot.extent)
  const target = snapshot.targets.find(t => t.targetWeaponId === view.targetWeaponId)
  const contextsRow = snapshot.targetContexts.find(row => row.targetWeaponId === view.targetWeaponId)
  const unionReach = await phase2c26b2aReachability(view, input.heldUnion, origins, snapshot.extent)
  const unionMissing = Object.fromEntries(laneNames.map(lane => [lane, unionReach.lanes[lane]?.missingHeld.length ?? 0])) as { normal: number; skill: number; gogma: number }
  const heldUnion = { coversAllNeeded: laneNames.every(lane => unionMissing[lane] === 0), missingHeld: unionMissing }
  const nonBlockingMembers: PlannerAlternativeReservation[] = []
  for (const row of snapshot.fixedSets) {
    if (row.cardinality !== 1 || row.reservationGroupIndex === null || row.fixedBuildListEntryIds[0] === target?.currentBuildListEntryId) continue
    const member = snapshot.reservationGroups[row.reservationGroupIndex]!.reservation
    const memberReach = await phase2c26b2aReachability(view, member, origins, snapshot.extent)
    if (!memberReach.reasons.includes('blocked_position_conflict') && !memberReach.reasons.includes('exclusive_owned_weapon_conflict')) nonBlockingMembers.push(member)
  }
  const nonBlockingUnion = normalizePlannerAlternativeReservation(unionHeldOnly(nonBlockingMembers))
  const nonBlockingReach = await phase2c26b2aReachability(view, nonBlockingUnion, origins, snapshot.extent)
  const nonBlockingMissing = Object.fromEntries(laneNames.map(lane => [lane, nonBlockingReach.lanes[lane]?.missingHeld.length ?? 0])) as { normal: number; skill: number; gogma: number }
  const nonBlockingHeldUnion = { members: nonBlockingMembers.length, coversAllNeeded: laneNames.every(lane => nonBlockingMissing[lane] === 0), missingHeld: nonBlockingMissing }
  const base = { targetWeaponId: view.targetWeaponId, compatibleContexts: { '0': 0, '1': 0, '2': 0 }, anyK1Compatible: false, contextsChecked: 0, representative: null,
    minimalAliases: [], unreachedPattern: null, unreachedBestMissing: null, heldUnion, nonBlockingHeldUnion, extent, inconsistencies }
  if (!target || !contextsRow) return { ...base, minimalCardinality: 'unreached', inconsistencies: [`${view.targetWeaponId}: not a snapshot Target`] }
  if (target.checkpointHardConstraint) return { ...base, minimalCardinality: 'checkpoint_hard_constraint' }
  const fixedById = new Map(snapshot.fixedSets.map(row => [row.fixedSetId, row]))
  const compatibleContexts = { '0': 0, '1': 0, '2': 0 }
  let anyK1Compatible = false
  const compatibleRows: { groupIndex: number; minCard: Phase2C26B2B1Cardinality }[] = []
  const incompatibleRows: { reservation: Phase2C26B2AReachability; classification: 'reservation_incompatible' }[] = []
  for (const [groupIndex, minCard] of contextsRow.contexts) {
    const group = snapshot.reservationGroups[groupIndex]!
    const reach = await phase2c26b2aReachability(view, group.reservation, origins, snapshot.extent)
    if (reach.inconsistent) inconsistencies.push(`${view.targetWeaponId} @ group ${groupIndex}: a primitive verdict disagrees with its decomposition`)
    if (reach.compatible && reach.productionLimitAccepts !== extent.withinDefaultExtent) inconsistencies.push(`${view.targetWeaponId} @ group ${groupIndex}: the Production limit walk disagrees with the reach extent verdict`)
    if (!reach.compatible) { incompatibleRows.push({ reservation: reach, classification: 'reservation_incompatible' }); continue }
    compatibleContexts[String(minCard) as '0' | '1' | '2'] += 1
    compatibleRows.push({ groupIndex, minCard })
    if (group.aliasFixedSetIds.some(id => { const fs = fixedById.get(id)!; return fs.cardinality === 1 && !fs.fixedBuildListEntryIds.includes(target.currentBuildListEntryId) })) anyK1Compatible = true
  }
  const minimal = compatibleRows.length === 0 ? null : Math.min(...compatibleRows.map(row => row.minCard)) as Phase2C26B2B1Cardinality
  let representative: Phase2C26B2B1RouteReach['representative'] = null
  const minimalAliases: Phase2C26B2B1RouteReach['minimalAliases'] = []
  if (minimal !== null) {
    for (const row of compatibleRows.filter(r => r.minCard === minimal)) {
      const group = snapshot.reservationGroups[row.groupIndex]!
      const aliases = group.aliasFixedSetIds.map(id => fixedById.get(id)!).filter(fs => fs.cardinality === minimal && !fs.fixedBuildListEntryIds.includes(target.currentBuildListEntryId))
      for (const alias of aliases) minimalAliases.push({ fixedSetId: alias.fixedSetId, fixedTargetWeaponIds: alias.fixedTargetWeaponIds })
      if (representative === null && aliases[0]) representative = { groupIndex: row.groupIndex, reservationDigest: group.reservationDigest, fixedSetId: aliases[0].fixedSetId,
        fixedTargetWeaponIds: aliases[0].fixedTargetWeaponIds, cardinality: minimal }
    }
  }
  let unreachedPattern: string | null = null, unreachedBestMissing: Phase2C26B2B1RouteReach['unreachedBestMissing'] = null
  if (minimal === null) {
    // No compatible context, so the context list is non-empty only if K0 exists (it always does: K0 is valid and eligible).
    unreachedPattern = phase2c26b2aPattern(incompatibleRows, incompatibleRows[0]?.reservation ?? unionReach)
    const best = incompatibleRows.reduce<Phase2C26B2AReachability | null>((acc, row) => {
      const missing = (r: Phase2C26B2AReachability) => laneNames.reduce((sum, lane) => sum + (r.lanes[lane]?.missingHeld.length ?? 0) + (r.lanes[lane]?.heldPrefixOverlap.length ?? 0), 0)
      return acc === null || missing(row.reservation) < missing(acc) || (missing(row.reservation) === missing(acc) && row.reservation.reasons.length < acc.reasons.length) ? row.reservation : acc
    }, null)
    if (best) unreachedBestMissing = { ...Object.fromEntries(laneNames.map(lane => [lane, (best.lanes[lane]?.missingHeld.length ?? 0) + (best.lanes[lane]?.heldPrefixOverlap.length ?? 0)])) as { normal: number; skill: number; gogma: number },
      blockedOwn: laneNames.reduce((sum, lane) => sum + (best.lanes[lane]?.blockedOwn.length ?? 0), 0), reasons: [...best.reasons] }
  }
  return { ...base, minimalCardinality: minimal === null ? 'unreached' : String(minimal) as '0' | '1' | '2', compatibleContexts, anyK1Compatible, contextsChecked: contextsRow.contexts.length,
    representative, minimalAliases, unreachedPattern, unreachedBestMissing }
}

// ---------------------------------------------------------------- aggregation

export interface Phase2C26B2B1RouteRow {
  targetWeaponId: string
  b2a: { covered: boolean; conflictParticipant: boolean; oracleHeldRoute: boolean; probeGap: boolean; contextGap: boolean; pattern: string | null }
  reach: Phase2C26B2B1RouteReach
  /** Post-hoc only: how many minimal aliases fix at least one / only oracle support Targets of this Route. */
  oracleSupport: { supportTargetWeaponIds: string[]; minimalAliases: number; aliasesWithSupporter: number; aliasesAllSupporters: number }
}

export function phase2c26b2b1Distribution(rows: readonly Phase2C26B2B1RouteRow[]) {
  const by = (value: Phase2C26B2B1MinimalCardinality) => rows.filter(row => row.reach.minimalCardinality === value).length
  const recovered = rows.filter(row => ['0', '1', '2'].includes(row.reach.minimalCardinality))
  return {
    routes: rows.length,
    minimalCardinality: { '0': by('0'), '1': by('1'), '2': by('2'), unreached: by('unreached'), checkpoint_hard_constraint: by('checkpoint_hard_constraint') },
    /** Compatible at K0 (an empty reservation context). */
    newlyCompatibleByK0: by('0'),
    /** First compatible at K1: some single current Route held fixed suffices, while the empty reservation does not. */
    newlyCompatibleByAllCurrentK1: by('1'),
    /** First compatible at K2: only the held union of two current Routes suffices. */
    newlyCompatibleByK2: by('2'),
    stillUnreached: by('unreached'),
    anyK1Compatible: rows.filter(row => row.reach.anyK1Compatible).length,
    recovered: recovered.length,
    recoveredWithinDefaultExtent: recovered.filter(row => row.reach.extent.withinDefaultExtent).length,
    recoveredRequiresLargerExtent: recovered.filter(row => !row.reach.extent.withinDefaultExtent).length,
    recoveredRequiresLargerExtentByStream: Object.fromEntries((['normal', 'skill', 'gogma'] as const).map(s => [s, recovered.filter(row => row.reach.extent.verdict[s] === 'requires_larger_extent').length])),
    /** Unreached, and some needed position is held by no current Route at all: no current fixed set of ANY size reaches it. */
    unreachedHeldByNoCurrentRoute: rows.filter(row => row.reach.minimalCardinality === 'unreached' && !row.reach.heldUnion.coversAllNeeded).length,
    /** Unreached, though every needed position is held by some current Route: K>=3 is not ruled out by this relaxation. */
    unreachedHeldUnionCoversNeeded: rows.filter(row => row.reach.minimalCardinality === 'unreached' && row.reach.heldUnion.coversAllNeeded).length,
    /** Unreached, and the current Routes that neither block it nor take its source cannot hold every needed position: no current fixed set of any size. */
    unreachedNonBlockingUnionMissesNeeded: rows.filter(row => row.reach.minimalCardinality === 'unreached' && !row.reach.nonBlockingHeldUnion.coversAllNeeded).length,
    /** Unreached, though the non-blocking current Routes together hold every needed position: K>=3 is not ruled out. */
    unreachedNonBlockingUnionCoversNeeded: rows.filter(row => row.reach.minimalCardinality === 'unreached' && row.reach.nonBlockingHeldUnion.coversAllNeeded).length,
    recoveredWithSupporterInMinimalAlias: recovered.filter(row => row.oracleSupport.aliasesWithSupporter > 0).length,
    recoveredWithoutSupporterInMinimalAlias: recovered.filter(row => row.reach.minimalCardinality !== '0' && row.oracleSupport.aliasesWithSupporter === 0).length,
  }
}

export function phase2c26b2b1PatternCross(rows: readonly Phase2C26B2B1RouteRow[]) {
  return countBy(rows, row => `${row.b2a.pattern ?? 'covered'} -> ${row.reach.minimalCardinality}`)
}

// ---------------------------------------------------------------- decision (registered before the formal snapshot)

export type Phase2C26B2B1DecisionCase = 'B2B1_ALL_ELIGIBLE_RECOVERED' | 'B2B1_PARTIAL_ELIGIBLE_RECOVERY' | 'B2B1_NO_ELIGIBLE_RECOVERY' | 'B2B1_INVALID'

export const PHASE2C26B2B1_DECISION_RULE = {
  order: [
    'B2B1_INVALID: a B2-A authority mismatch, an Export / oracle / manifest mismatch, an initial-context or one-Entry-per-Target failure, a snapshot consistency failure (enumeration, validity, alias partition, contexts, calculation checks), an origin parity mismatch, a B2-A K1 context / reachability / extent parity mismatch, a B2-A probe-gap Route not reproduced as K1-compatible and extent-insufficient, a covered Route without a K<=1 compatible context, a primitive verdict / decomposition or Production-limit inconsistency, or no search-eligible context gap',
    'B2B1_ALL_ELIGIBLE_RECOVERED: every search-eligible B2-A context gap Route (B2-A context gap minus checkpoint hard-constraint Targets) is reservation-compatible under some K0 / K1 / K2 context',
    'B2B1_PARTIAL_ELIGIBLE_RECOVERY: at least one is, at least one is not',
    'B2B1_NO_ELIGIBLE_RECOVERY: none is',
  ],
  searchEligibleContextGaps: 'B2-A contextGap Routes whose Target is not a checkpoint hard constraint in this snapshot',
  recovered: 'minimal cardinality 0, 1 or 2 (a reservation-compatible context exists); the extent is reported separately and never part of recovery',
  note: 'Recovery is reservation compatibility of the oracle Route itself, not Search delivery and not final-Plan coexistence. The oracle is a post-hoc fixture, never a heuristic or a fixed-set selector.',
} as const

export const PHASE2C26B2B1_RECOMMENDATION: Record<Phase2C26B2B1DecisionCase, string> = {
  B2B1_ALL_ELIGIBLE_RECOVERED: 'B2-B2でminimal compatible contextsだけを対象に実Searchへ進む（extent不足は別軸）',
  B2B1_PARTIAL_ELIGIBLE_RECOVERY: 'recovered RouteはB2-B2のSearch / extent validationへ、residualはcurrent Route固定では不足するためalternative Route support / iterative context生成を研究する',
  B2B1_NO_ELIGIBLE_RECOVERY: 'current fixed Route組合せのSearchは先に回さず、alternative-to-alternative support / iterative global contextへ進む',
  B2B1_INVALID: '次へ進まず原因調査',
}

export function phase2c26b2b1Decision(input: { invalidReasons: readonly string[]; searchEligibleContextGaps: number; recovered: number }) {
  const { searchEligibleContextGaps, recovered } = input
  if (![searchEligibleContextGaps, recovered].every(v => Number.isInteger(v) && v >= 0) || recovered > searchEligibleContextGaps) {
    throw new Error(`Inconsistent Phase 2-C2.6-B2-B1 decision input: ${JSON.stringify(input)}`)
  }
  const reasons = [...input.invalidReasons, ...(searchEligibleContextGaps === 0 ? ['no_search_eligible_context_gap'] : [])]
  const caseId: Phase2C26B2B1DecisionCase = reasons.length > 0 ? 'B2B1_INVALID' : recovered === searchEligibleContextGaps ? 'B2B1_ALL_ELIGIBLE_RECOVERED'
    : recovered > 0 ? 'B2B1_PARTIAL_ELIGIBLE_RECOVERY' : 'B2B1_NO_ELIGIBLE_RECOVERY'
  return { case: caseId, reasons, recommendation: PHASE2C26B2B1_RECOMMENDATION[caseId] }
}

// ---------------------------------------------------------------- the whole audit

export interface Phase2C26B2B1AuditInput {
  snapshot: Phase2C26B2B1Snapshot
  authority: Phase2C26B2B1B2AAuthority
  manifest: readonly Phase2C26B2AOracleRouteSpec[]
  oracle: Phase2C26B2AOracle
  sha: (value: string) => string
}

/**
 * Snapshot consistency, B2-A parity, then every oracle Route against every K0 / K1 / K2 semantic context of its Target.
 * Returns the per-Route rows, the aggregates and every invalid reason (each makes the case B2B1_INVALID).
 */
export async function runPhase2C26B2B1Audit({ snapshot, authority, manifest, oracle, sha }: Phase2C26B2B1AuditInput) {
  const invalidReasons: string[] = []
  const consistency = validatePhase2C26B2B1Snapshot(snapshot)
  invalidReasons.push(...consistency.issues.map(i => `snapshot: ${i}`))
  const weaponTypeOf = new Map(oracle.routes.map(route => [route.targetWeaponId, route.weaponTypeId]))
  const views = new Map(manifest.map(spec => [spec.targetWeaponId, phase2c26b2aRouteView(spec, weaponTypeOf.get(spec.targetWeaponId)!)] as const))
  const originsOf = (view: Phase2C26B2ARouteView): Phase2C26B2AOrigins => ({
    skill: snapshot.origin.skillCounter.value!, gogma: snapshot.origin.gogmaCounter.value!,
    normal: snapshot.origin.normalCounters.find(c => c.counterId === view.normalCounterId)?.counter ?? null,
  })
  if (snapshot.origin.skillCounter.value !== oracle.summary.skill.start || snapshot.origin.gogmaCounter.value !== oracle.summary.gogma.start) invalidReasons.push('origin: the Skill / Gogma origin is not the oracle stream start')
  for (const [counterId, s] of Object.entries(oracle.summary.normal)) {
    if (snapshot.origin.normalCounters.find(c => c.counterId === counterId)?.counter !== s.start) invalidReasons.push(`origin: the ${counterId} origin is not the oracle stream start`)
  }
  const targetIds = snapshot.targets.map(t => t.targetWeaponId).sort(compare)
  if (!same(targetIds, [...views.keys()].sort(compare)) || !same(targetIds, authority.routes.map(r => r.targetWeaponId).sort(compare))) invalidReasons.push('targets: the snapshot planning Targets are not the oracle / B2-A Routes')
  const parity = await validatePhase2C26B2B1B2AParity({ snapshot, authority, views, originsOf, sha })
  invalidReasons.push(...parity.issues.map(i => `b2a_parity: ${i}`))

  const occupancy = phase2c26b2aOccupancy([...views.values()])
  const heldUnion = phase2c26b2b1HeldUnionReservation(snapshot)
  const b2aByTarget = new Map(authority.routes.map(route => [route.targetWeaponId, route]))
  const rows: Phase2C26B2B1RouteRow[] = []
  for (const view of views.values()) {
    const b2a = b2aByTarget.get(view.targetWeaponId)
    if (!b2a) continue
    const origins = originsOf(view)
    const reach = await phase2c26b2b1RouteReach({ view, origins, snapshot, heldUnion })
    invalidReasons.push(...reach.inconsistencies.map(i => `audit: ${i}`))
    const support = phase2c26b2aSupport(view, origins, occupancy)
    if (!same(support.supportTargetWeaponIds, b2a.supportTargetWeaponIds) || !same(support.ambiguousCandidateTargetWeaponIds, b2a.ambiguousCandidateTargetWeaponIds)) invalidReasons.push(`audit: ${view.targetWeaponId}: oracle support differs from B2-A`)
    const supporters = new Set([...support.supportTargetWeaponIds, ...support.ambiguousCandidateTargetWeaponIds])
    rows.push({
      targetWeaponId: view.targetWeaponId,
      b2a: { covered: b2a.covered, conflictParticipant: b2a.conflictParticipant, oracleHeldRoute: b2a.oracleHeldRoute, probeGap: b2a.probeGap, contextGap: b2a.contextGap, pattern: b2a.pattern },
      reach,
      oracleSupport: { supportTargetWeaponIds: [...supporters].sort(compare), minimalAliases: reach.minimalAliases.length,
        aliasesWithSupporter: reach.minimalAliases.filter(a => a.fixedTargetWeaponIds.some(id => supporters.has(id))).length,
        aliasesAllSupporters: reach.minimalAliases.filter(a => a.fixedTargetWeaponIds.length > 0 && a.fixedTargetWeaponIds.every(id => supporters.has(id))).length },
    })
  }
  rows.sort((a, b) => compare(a.targetWeaponId, b.targetWeaponId))
  // B2-A carry-over: its probe-gap Route stays K1-compatible and extent-insufficient; its covered Routes keep a K<=1 compatible context.
  for (const row of rows) {
    if (row.b2a.probeGap && (!row.reach.anyK1Compatible || row.reach.extent.withinDefaultExtent)) invalidReasons.push(`carry_over: ${row.targetWeaponId}: the B2-A probe-gap Route is not K1-compatible with an insufficient extent`)
    if (row.b2a.covered && !(row.reach.minimalCardinality === '0' || row.reach.anyK1Compatible)) invalidReasons.push(`carry_over: ${row.targetWeaponId}: a B2-A covered Route has no K<=1 compatible context`)
    if (!row.b2a.contextGap && !row.b2a.covered && !row.b2a.probeGap) invalidReasons.push(`carry_over: ${row.targetWeaponId}: an uncovered B2-A Route with neither gap`)
  }
  const contextGaps = rows.filter(row => row.b2a.contextGap)
  const eligible = contextGaps.filter(row => row.reach.minimalCardinality !== 'checkpoint_hard_constraint')
  const recovered = eligible.filter(row => ['0', '1', '2'].includes(row.reach.minimalCardinality))
  const aggregates = {
    all: phase2c26b2b1Distribution(rows),
    uncovered: phase2c26b2b1Distribution(rows.filter(row => !row.b2a.covered)),
    contextGap: phase2c26b2b1Distribution(contextGaps),
    searchEligibleContextGap: phase2c26b2b1Distribution(eligible),
    nonParticipantContextGap: phase2c26b2b1Distribution(contextGaps.filter(row => !row.b2a.conflictParticipant)),
    participantContextGap: phase2c26b2b1Distribution(contextGaps.filter(row => row.b2a.conflictParticipant)),
    uncoveredOracleHeld: phase2c26b2b1Distribution(rows.filter(row => !row.b2a.covered && row.b2a.oracleHeldRoute)),
    probeGap: phase2c26b2b1Distribution(rows.filter(row => row.b2a.probeGap)),
    covered: phase2c26b2b1Distribution(rows.filter(row => row.b2a.covered)),
    patternCross: { contextGap: phase2c26b2b1PatternCross(contextGaps), uncovered: phase2c26b2b1PatternCross(rows.filter(row => !row.b2a.covered)) },
    unreachedPatterns: countBy(rows.filter(row => row.reach.minimalCardinality === 'unreached'), row => row.reach.unreachedPattern ?? 'none'),
    unreachedReasonsAtBest: countBy(rows.filter(row => row.reach.minimalCardinality === 'unreached'), row => row.reach.unreachedBestMissing?.reasons.join('+') ?? 'none'),
    heldUnionMissingLanes: countBy(rows.filter(row => row.reach.minimalCardinality === 'unreached'), row => row.reach.heldUnion.coversAllNeeded ? 'covers_all_needed'
      : `held_by_no_current_route[${laneNames.filter(lane => row.reach.heldUnion.missingHeld[lane] > 0).join('+')}]`),
  }
  return { consistency, parity, rows, aggregates, invalidReasons,
    decisionInput: { searchEligibleContextGaps: eligible.length, recovered: recovered.length } }
}
