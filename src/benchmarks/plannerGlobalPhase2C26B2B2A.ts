/**
 * Issue #154 Phase 2-C2.6-B2-B2A: Search delivery of known-compatible, default-extent representative contexts. Research
 * only. Never import from Production.
 *
 * B2-B1 showed, post hoc against the 1,657 oracle, that 20 oracle Routes become reservation-compatible within the
 * Production default extent once ONE current Route is held fixed (K1). B2-B2A asks the next question only:
 *
 * ```text
 * a known-compatible representative context (B2-B1 post-hoc selection)
 *   -> re-derived from the Export through the unchanged B2-B1 calculation (derivePhase2C26B2B1Snapshot())
 *   -> visitPlannerAlternativeCandidates() unchanged, Production default extent, capture bound 32
 *   -> delivered Candidates (the analyzer, after the run, compares them with the oracle Route)
 * ```
 *
 * The task SELECTION is oracle-guided (B2-B1's `minimalCardinality`, `representative` and `extent.withinDefaultExtent`
 * come from a post-hoc oracle comparison) and is declared as such. The Search child is not: it receives only the Target,
 * the fixed-set selector and the expected Production digests, re-derives the Planner-start origin, the reservation, the
 * excluded current Route key and the extent from the Export, and stops only at the capture bound, an extent stop or
 * exhaustion. It never reads the oracle, its manifest, an oracle Candidate key, an oracle Counter position, an expected
 * source / Route kind or an expected delivery index. Nothing here proves that Production could choose these contexts
 * without the oracle.
 */
import { hashStableValue, stableStringify } from '../domain/models/hashing'
import type { BuildListEntry } from '../domain/models/publicTypes'
import { createPlannerAlternativeMaterializer } from '../domain/planner/alternative'
import type { PlannerInput } from '../domain/planner/plannerTypes'
import { createPlannerStartSearchOrigin } from '../domain/planner/replacement/plannerSearchOrigin'
import type { RngEngine } from '../domain/rng/rngEngine'
import {
  candidateStableKey,
  defaultPlannerAlternativeSearchExtent,
  visitPlannerAlternativeCandidates,
  type PlannerAlternativeCandidate,
  type PlannerAlternativeReservation,
  type PlannerAlternativeSearchExtent,
} from '../domain/search'
import { GLOBAL_RESEARCH_TIME } from './plannerGlobalOptimizationResearch'
import {
  phase2c2SearchStatus,
  respectsPhase2C2Reservation,
  summarizePhase2C2Entry,
  type Phase2C2CandidateSummary,
  type Phase2C2ChildOutcome,
  type Phase2C2SearchStatus,
} from './plannerGlobalPhase2C2'
import { phase2c26b1SearchInputDigest } from './plannerGlobalPhase2C26B1'
import type { Phase2C25APreSearchContext } from './plannerGlobalPhase2C25A'
import { phase2c26b2aReservationRanges } from './plannerGlobalPhase2C26B2AAnalysis'
import type { Phase2C26B2B1Snapshot } from './plannerGlobalPhase2C26B2B1'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0

// ---------------------------------------------------------------- Research execution conditions (registered, not Production defaults)

/** Candidates captured per context before the consumer stops the Search. Research only. */
export const PHASE2C26B2B2A_CAPTURE_BOUND = 32
export const PHASE2C26B2B2A_EXTENT_LABEL = 'default' as const
export const PHASE2C26B2B2A_NODE_YIELD = 'setImmediate' as const
export const PHASE2C26B2B2A_MEMORY_SAMPLE_INTERVAL_MS = 250
/** The tasks child (snapshot re-derivation + representative reconstruction, no Search). */
export const PHASE2C26B2B2A_TASKS_BUDGET_MS = 10 * 60 * 1000
export type Phase2C26B2B2AExecutionClass = 'stage1' | 'timeout_fallback'
/** Stage 1: every task once, fresh child, no retry. */
export const PHASE2C26B2B2A_STAGE1 = { executionClass: 'stage1', childHeapMb: 8192, concurrency: 3, budgetMs: 10 * 60 * 1000, retry: 'none' } as const
/**
 * Fallback: only a task whose Stage 1 child TIMED OUT, run once more with the identical task (same Target, origin,
 * reservation, fixed set, extent, excluded Route and capture bound), alone and with a longer budget. An out-of-memory or
 * other process failure is never retried; a Stage 1 completion never runs a fallback.
 */
export const PHASE2C26B2B2A_FALLBACK = { executionClass: 'timeout_fallback', trigger: 'timeout', childHeapMb: 8192, concurrency: 1, budgetMs: 30 * 60 * 1000, runs: 1, retry: 'none' } as const
/** What B2-B2A deliberately does not run. */
export const PHASE2C26B2B2A_NOT_RUN = ['production_change', 'search_algorithm_change', 'search_ordering_change', 'extent_default_change', 'candidate_search', 'planner_alternative_kernel',
  'candidate_trial', 'full_planner_rerun', 'global_assignment', 'final_43_target_coexistence', 'alternative_to_alternative_support', 'residual_unreached_search',
  'extent_insufficient_search', 'extent_probe', 'ui_change', 'runtime_optimization'] as const

// ---------------------------------------------------------------- the B2-B1 RESULT (task-selection authority)

/** The B2-B1 result this phase is registered against. Any other value fails closed. */
export const PHASE2C26B2B2A_REGISTERED_B2B1 = {
  resultSha256: '5a56ab010828519df00e7084c8b9cf6bd9276ad7425f609d520ba1392071309d',
  decisionCase: 'B2B1_PARTIAL_ELIGIBLE_RECOVERY',
  contextGap: { routes: 40, k1: 28, k2: 9, unreached: 3, recoveredWithinDefaultExtent: 18, recoveredRequiresLargerExtent: 19 },
  all: { routes: 43, recoveredWithinDefaultExtent: 20 },
  /** The registered task population: minimal cardinality 1 or 2 within the default extent. */
  tasks: { total: 20, historicallyCovered: 2, newlyRecoveredDefaultExtent: 18, k1: 20, k2: 0 },
} as const

export interface Phase2C26B2B2ARepresentative {
  groupIndex: number
  reservationDigest: string
  fixedSetId: string
  fixedTargetWeaponIds: string[]
  cardinality: 1 | 2
}

export interface Phase2C26B2B2AAuthorityRoute {
  targetWeaponId: string
  minimalCardinality: string
  withinDefaultExtent: boolean
  b2a: { covered: boolean; contextGap: boolean; probeGap: boolean; conflictParticipant: boolean; oracleHeldRoute: boolean }
  representative: Phase2C26B2B2ARepresentative | null
}

export interface Phase2C26B2B2AAuthority {
  measuredHead: string
  analysisHead: string
  exportSha256: string
  b2aResultSha256: string
  oracleResultSha256: string
  oracleManifestFileSha256: string
  oracleManifestRoutesSha256: string
  extent: PlannerAlternativeSearchExtent
  calculationContext: unknown
  researchMaxPlanSteps: number
  originDigest: string
  targets: { targetWeaponId: string; currentBuildListEntryId: string; currentRouteKeySha256: string; checkpointHardConstraint: boolean; originSemanticDigest: string }[]
  /** Reservation group range forms (the RESULT's `reservations.groups`), by group index. */
  groups: { groupIndex: number; reservationDigest: string; minCardinality: number; aliasFixedSetIds: string[]; reservation: unknown }[]
  routes: Phase2C26B2B2AAuthorityRoute[]
}

const SHA256 = /^[0-9a-f]{64}$/
const COMMIT = /^[0-9a-f]{40}$/

/**
 * Reads the committed B2-B1 RESULT as untrusted JSON and fails closed unless it is the registered formal result: its own
 * SHA-256, formal with no calculation change after its measured HEAD, case B2B1_PARTIAL_ELIGIBLE_RECOVERY, no invalid
 * reason, valid snapshot consistency and B2-A parity (K1 contexts, reachability verdicts, extents), the registered
 * context-gap (K1 28 / K2 9 / unreached 3, default extent 18 / larger 19) and whole (recovered within default 20) counts,
 * the default extent, and a readable hash chain (B2-A, oracle, manifest, Export).
 */
export function parsePhase2C26B2B2AB2B1Authority(json: unknown, resultSha256: string): { valid: boolean; issues: string[]; authority: Phase2C26B2B2AAuthority | null } {
  const r = PHASE2C26B2B2A_REGISTERED_B2B1
  const issues: string[] = []
  if (!isObject(json) || !isObject(json.provenance) || !isObject(json.decision) || !isObject(json.aggregates) || !isObject(json.parity) || !isObject(json.currentInput)
    || !isObject(json.reservations) || !isObject(json.conditions) || !isObject(json.snapshotConsistency)) {
    return { valid: false, issues: ['B2-B1 RESULT lacks provenance / decision / aggregates / parity / currentInput / reservations / conditions / snapshotConsistency'], authority: null }
  }
  const { provenance, decision, aggregates, parity, currentInput, reservations, conditions, snapshotConsistency } = json
  if (resultSha256 !== r.resultSha256) issues.push(`B2-B1 RESULT SHA-256 ${resultSha256} is not the registered ${r.resultSha256}`)
  if (provenance.formal !== true) issues.push('provenance.formal is not true')
  if (!Array.isArray(provenance.calculationCodeChangedSinceMeasuredHead) || provenance.calculationCodeChangedSinceMeasuredHead.length !== 0) issues.push('provenance.calculationCodeChangedSinceMeasuredHead is not empty')
  for (const field of ['measuredHead', 'analysisHead'] as const) if (typeof provenance[field] !== 'string' || !COMMIT.test(provenance[field] as string)) issues.push(`provenance.${field} is not a commit SHA`)
  for (const field of ['exportSha256', 'b2aResultSha256', 'oracleResultSha256', 'oracleManifestFileSha256', 'oracleManifestRoutesSha256'] as const) {
    if (typeof provenance[field] !== 'string' || !SHA256.test(provenance[field] as string)) issues.push(`provenance.${field} is not a SHA-256`)
  }
  // The B2-B1 analyzer recorded each hash twice (as read, and as its predecessor recorded it): both must agree.
  if (provenance.oracleResultSha256 !== provenance.oracleSha256RecordedByB2A) issues.push('provenance: the oracle SHA-256 differs from the one B2-A recorded')
  if (provenance.oracleManifestFileSha256 !== provenance.oracleManifestFileSha256RecordedByB2A) issues.push('provenance: the manifest file SHA-256 differs from the one B2-A recorded')
  if (provenance.oracleManifestRoutesSha256 !== provenance.oracleManifestSha256RecordedByOracle) issues.push('provenance: the manifest Routes SHA-256 differs from the one the oracle recorded')
  if (decision.case !== r.decisionCase) issues.push(`decision.case ${String(decision.case)} is not ${r.decisionCase}`)
  if (!Array.isArray(json.invalidReasons) || json.invalidReasons.length !== 0) issues.push('invalidReasons is not empty')
  if (snapshotConsistency.valid !== true) issues.push('snapshotConsistency.valid is not true')
  if (!Array.isArray(parity.issues) || parity.issues.length !== 0) issues.push('parity.issues is not empty (B2-A parity)')
  const exportParity = isObject(parity.exportSha256) ? parity.exportSha256 : {}
  if (exportParity.matches !== true) issues.push('parity.exportSha256.matches is not true')
  const k1 = isObject(parity.k1Contexts) ? parity.k1Contexts : {}
  if (typeof k1.checked !== 'number' || k1.checked !== k1.matched) issues.push('parity.k1Contexts: not every B2-A context matched')
  const reach = isObject(parity.reachability) ? parity.reachability : {}
  if (typeof reach.contextsChecked !== 'number' || reach.contextsChecked !== reach.verdictMatches || reach.routesChecked !== reach.extentMatches || reach.routesChecked !== reach.emptyReservationMatches) {
    issues.push('parity.reachability: a B2-A verdict / extent / empty-reservation verdict is not reproduced')
  }
  const gap = isObject(aggregates.contextGap) ? aggregates.contextGap : {}
  const gapMin = isObject(gap.minimalCardinality) ? gap.minimalCardinality : {}
  if (gap.routes !== r.contextGap.routes) issues.push(`aggregates.contextGap.routes ${String(gap.routes)} is not ${r.contextGap.routes}`)
  if (gapMin['1'] !== r.contextGap.k1 || gapMin['2'] !== r.contextGap.k2 || gapMin.unreached !== r.contextGap.unreached) issues.push('aggregates.contextGap: K1 / K2 / unreached is not 28 / 9 / 3')
  if (gap.recoveredWithinDefaultExtent !== r.contextGap.recoveredWithinDefaultExtent || gap.recoveredRequiresLargerExtent !== r.contextGap.recoveredRequiresLargerExtent) {
    issues.push('aggregates.contextGap: recovered within default / requiring a larger extent is not 18 / 19')
  }
  const all = isObject(aggregates.all) ? aggregates.all : {}
  if (all.routes !== r.all.routes || all.recoveredWithinDefaultExtent !== r.all.recoveredWithinDefaultExtent) issues.push('aggregates.all: routes / recoveredWithinDefaultExtent is not 43 / 20')
  if (!same(conditions.extent, { ...defaultPlannerAlternativeSearchExtent })) issues.push('conditions.extent is not the Production default extent')
  if (!isObject(conditions.calculationContext) || typeof conditions.researchMaxPlanSteps !== 'number') issues.push('conditions.calculationContext / researchMaxPlanSteps missing')
  if (typeof currentInput.originDigest !== 'string') issues.push('currentInput.originDigest missing')

  const targets: Phase2C26B2B2AAuthority['targets'] = []
  for (const raw of asArray(currentInput.targets)) {
    if (!isObject(raw) || typeof raw.targetWeaponId !== 'string' || typeof raw.currentBuildListEntryId !== 'string' || typeof raw.currentRouteKeySha256 !== 'string'
      || typeof raw.checkpointHardConstraint !== 'boolean' || typeof raw.originSemanticDigest !== 'string') { issues.push('a currentInput Target is malformed'); continue }
    targets.push({ targetWeaponId: raw.targetWeaponId, currentBuildListEntryId: raw.currentBuildListEntryId, currentRouteKeySha256: raw.currentRouteKeySha256,
      checkpointHardConstraint: raw.checkpointHardConstraint, originSemanticDigest: raw.originSemanticDigest })
  }
  const groups: Phase2C26B2B2AAuthority['groups'] = []
  asArray(reservations.groups).forEach((raw, index) => {
    if (!isObject(raw) || raw.groupIndex !== index || typeof raw.reservationDigest !== 'string' || typeof raw.minCardinality !== 'number' || !Array.isArray(raw.aliasFixedSetIds)) {
      issues.push(`reservation group ${index} is malformed`); return
    }
    groups.push({ groupIndex: index, reservationDigest: raw.reservationDigest, minCardinality: raw.minCardinality, aliasFixedSetIds: raw.aliasFixedSetIds.map(String), reservation: raw.reservation ?? null })
  })
  const routes: Phase2C26B2B2AAuthorityRoute[] = []
  for (const raw of asArray(json.routes)) {
    const b2a = isObject(raw) && isObject(raw.b2a) ? raw.b2a : null
    const extent = isObject(raw) && isObject(raw.extent) ? raw.extent : null
    if (!isObject(raw) || !b2a || !extent || typeof raw.targetWeaponId !== 'string' || typeof raw.minimalCardinality !== 'string' || typeof extent.withinDefaultExtent !== 'boolean'
      || typeof b2a.covered !== 'boolean' || typeof b2a.contextGap !== 'boolean' || typeof b2a.probeGap !== 'boolean') { issues.push('a route row is malformed'); continue }
    let representative: Phase2C26B2B2ARepresentative | null = null
    if (raw.representative !== null) {
      const rep = isObject(raw.representative) ? raw.representative : null
      if (!rep || typeof rep.groupIndex !== 'number' || typeof rep.reservationDigest !== 'string' || typeof rep.fixedSetId !== 'string' || !Array.isArray(rep.fixedTargetWeaponIds)
        || (rep.cardinality !== 1 && rep.cardinality !== 2 && rep.cardinality !== 0)) { issues.push(`${raw.targetWeaponId}: the representative is malformed`); continue }
      if (rep.cardinality !== 0) representative = { groupIndex: rep.groupIndex, reservationDigest: rep.reservationDigest, fixedSetId: rep.fixedSetId,
        fixedTargetWeaponIds: rep.fixedTargetWeaponIds.map(String), cardinality: rep.cardinality as 1 | 2 }
    }
    routes.push({ targetWeaponId: raw.targetWeaponId, minimalCardinality: raw.minimalCardinality, withinDefaultExtent: extent.withinDefaultExtent,
      b2a: { covered: b2a.covered, contextGap: b2a.contextGap, probeGap: b2a.probeGap, conflictParticipant: b2a.conflictParticipant === true, oracleHeldRoute: b2a.oracleHeldRoute === true },
      representative })
  }
  if (routes.length !== r.all.routes || new Set(routes.map(route => route.targetWeaponId)).size !== routes.length) issues.push('routes are not 43 distinct Routes')
  if (targets.length !== r.all.routes) issues.push('currentInput.targets is not 43 Targets')
  if (issues.length > 0) return { valid: false, issues, authority: null }
  return { valid: true, issues: [], authority: {
    measuredHead: String(provenance.measuredHead), analysisHead: String(provenance.analysisHead), exportSha256: String(provenance.exportSha256),
    b2aResultSha256: String(provenance.b2aResultSha256), oracleResultSha256: String(provenance.oracleResultSha256),
    oracleManifestFileSha256: String(provenance.oracleManifestFileSha256), oracleManifestRoutesSha256: String(provenance.oracleManifestRoutesSha256),
    extent: { ...defaultPlannerAlternativeSearchExtent }, calculationContext: conditions.calculationContext, researchMaxPlanSteps: conditions.researchMaxPlanSteps as number,
    originDigest: String(currentInput.originDigest), targets, groups, routes,
  } }
}

// ---------------------------------------------------------------- task selection (oracle-guided, declared)

export type Phase2C26B2B2APopulation = 'historically_covered_control' | 'newly_recovered_default_extent'

/** One selected Target: the B2-B1 representative as a selector, plus its population label (analysis only). */
export interface Phase2C26B2B2ASelection {
  targetWeaponId: string
  population: Phase2C26B2B2APopulation
  representative: Phase2C26B2B2ARepresentative
}

/**
 * The registered selection rule over the B2-B1 routes: `minimalCardinality` 1 or 2 AND `extent.withinDefaultExtent`. No
 * unreached Route, no extent-insufficient Route, no checkpoint hard constraint. It must give exactly the registered 20
 * (historically covered 2 + newly recovered 18), all K1, every one carrying a representative of its own minimal
 * cardinality; anything else fails closed. Selections are in Target ID order.
 */
export function selectPhase2C26B2B2ATasks(authority: Pick<Phase2C26B2B2AAuthority, 'routes'>): { valid: boolean; issues: string[]; selections: Phase2C26B2B2ASelection[] } {
  const r = PHASE2C26B2B2A_REGISTERED_B2B1.tasks
  const issues: string[] = []
  const selected = authority.routes.filter(route => (route.minimalCardinality === '1' || route.minimalCardinality === '2') && route.withinDefaultExtent)
    .sort((a, b) => compare(a.targetWeaponId, b.targetWeaponId))
  const selections: Phase2C26B2B2ASelection[] = []
  for (const route of selected) {
    const rep = route.representative
    if (rep === null) { issues.push(`${route.targetWeaponId}: no representative`); continue }
    if (String(rep.cardinality) !== route.minimalCardinality) issues.push(`${route.targetWeaponId}: the representative cardinality is not the minimal cardinality`)
    if (route.b2a.covered === route.b2a.contextGap || route.b2a.probeGap) issues.push(`${route.targetWeaponId}: neither a B2-A covered Route nor a B2-A context gap`)
    selections.push({ targetWeaponId: route.targetWeaponId, population: route.b2a.covered ? 'historically_covered_control' : 'newly_recovered_default_extent', representative: { ...rep } })
  }
  const count = (predicate: (s: Phase2C26B2B2ASelection) => boolean) => selections.filter(predicate).length
  if (selected.length !== r.total) issues.push(`the selection holds ${selected.length} Targets, not ${r.total}`)
  if (count(s => s.population === 'historically_covered_control') !== r.historicallyCovered) issues.push(`historically covered controls are not ${r.historicallyCovered}`)
  if (count(s => s.population === 'newly_recovered_default_extent') !== r.newlyRecoveredDefaultExtent) issues.push(`newly recovered default-extent Targets are not ${r.newlyRecoveredDefaultExtent}`)
  if (count(s => s.representative.cardinality === 1) !== r.k1 || count(s => s.representative.cardinality === 2) !== r.k2) issues.push('the K1-only fixture condition does not hold (a K2 representative is an authority drift)')
  return { valid: issues.length === 0, issues, selections }
}

// ---------------------------------------------------------------- representative reconstruction (Production authority)

/** The Search context of one task, rebuilt from the snapshot alone. */
export interface Phase2C26B2B2AContext {
  targetWeaponId: string
  currentBuildListEntryId: string
  /** `candidateStableKey()` of the current Route (the raw record keeps it; the RESULT writes SHA-256). */
  currentRouteKey: string
  excludedRouteKeys: string[]
  fixedSetId: string
  fixedBuildListEntryIds: string[]
  fixedTargetWeaponIds: string[]
  cardinality: number
  groupIndex: number
  reservationDigest: string
  reservation: PlannerAlternativeReservation
  extent: PlannerAlternativeSearchExtent
  originDigest: string
  originSemanticDigest: string
  /** The B1 provenance-free body digest of exactly this Search input. */
  searchInputDigest: string
}

/**
 * Rebuilds a context from the B2-B1 snapshot and the fixed-set selector only. Fails closed (returns issues) unless the
 * Target is a searchable non-checkpoint snapshot Target, the fixed set is a valid set of the given cardinality without the
 * Target's own Entry, its group carries the given digest and is one of the Target's eligible contexts, and the extent is
 * the Production default. The reservation is the snapshot's own (`derivePlannerAlternativeReservation()`), never a copy
 * of a RESULT.
 */
export function reconstructPhase2C26B2B2AContext(snapshot: Phase2C26B2B1Snapshot, selector: { targetWeaponId: string; fixedSetId: string; cardinality: number; reservationDigest: string }):
  { valid: true; context: Phase2C26B2B2AContext } | { valid: false; issues: string[] } {
  const issues: string[] = []
  const target = snapshot.targets.find(t => t.targetWeaponId === selector.targetWeaponId)
  const fixed = snapshot.fixedSets.find(row => row.fixedSetId === selector.fixedSetId)
  if (!target) return { valid: false, issues: ['target_not_in_snapshot'] }
  if (!fixed) return { valid: false, issues: ['fixed_set_not_in_snapshot'] }
  if (target.checkpointHardConstraint) issues.push('checkpoint_hard_constraint')
  if (!fixed.valid || fixed.reservationGroupIndex === null) issues.push('fixed_set_invalid')
  if (fixed.cardinality !== selector.cardinality) issues.push('cardinality')
  if (fixed.fixedBuildListEntryIds.includes(target.currentBuildListEntryId)) issues.push('fixed_set_holds_own_entry')
  const group = fixed.reservationGroupIndex === null ? undefined : snapshot.reservationGroups[fixed.reservationGroupIndex]
  if (!group) issues.push('no_reservation_group')
  else {
    if (group.reservationDigest !== selector.reservationDigest || group.reservationDigest !== hashStableValue(group.reservation)) issues.push('reservation_digest')
    const contexts = snapshot.targetContexts.find(row => row.targetWeaponId === target.targetWeaponId)
    if (!contexts?.contexts.some(c => c[0] === group.groupIndex)) issues.push('not_an_eligible_context')
  }
  if (!same(snapshot.extent, { ...defaultPlannerAlternativeSearchExtent })) issues.push('extent')
  if (issues.length > 0 || !group) return { valid: false, issues }
  const body: Phase2C25APreSearchContext = { orientationId: '', workIndex: 0, targetWeaponId: target.targetWeaponId, status: 'searchable',
    invalidatedBuildListEntryId: target.currentBuildListEntryId, invalidatedRouteKey: target.currentRouteKey, fixedRouteBuildListEntryIds: [...fixed.fixedBuildListEntryIds],
    reservation: group.reservation, searchReservation: group.reservation, excludedRouteKeys: [...target.excludedRouteKeys], extent: { ...snapshot.extent },
    originDigest: snapshot.originDigest, contextDigest: '' }
  return { valid: true, context: {
    targetWeaponId: target.targetWeaponId, currentBuildListEntryId: target.currentBuildListEntryId, currentRouteKey: target.currentRouteKey,
    excludedRouteKeys: [...target.excludedRouteKeys], fixedSetId: fixed.fixedSetId, fixedBuildListEntryIds: [...fixed.fixedBuildListEntryIds],
    fixedTargetWeaponIds: [...fixed.fixedTargetWeaponIds], cardinality: fixed.cardinality, groupIndex: group.groupIndex, reservationDigest: group.reservationDigest,
    reservation: group.reservation, extent: { ...snapshot.extent }, originDigest: snapshot.originDigest, originSemanticDigest: target.originSemanticDigest,
    searchInputDigest: phase2c26b1SearchInputDigest(body),
  } }
}

export interface Phase2C26B2B2AReconstructionParity {
  targetWeaponId: string
  matches: boolean
  /** The field names that differ from the B2-B1 RESULT (empty when it matches). */
  mismatches: string[]
}

/**
 * The reconstructed context against the B2-B1 RESULT: representative (group index, digest, fixed set, fixed Targets,
 * cardinality), the group's range-form reservation, the Target's current Entry / current Route key SHA-256 / origin
 * semantic digest and the Planner-start origin digest. `sha` is SHA-256 over the raw key (the analyzer's own digest).
 */
export function comparePhase2C26B2B2AReconstruction(context: Phase2C26B2B2AContext, selection: Phase2C26B2B2ASelection, authority: Pick<Phase2C26B2B2AAuthority, 'targets' | 'groups' | 'originDigest' | 'extent'>,
  sha: (value: string) => string): Phase2C26B2B2AReconstructionParity {
  const mismatches: string[] = []
  const rep = selection.representative
  const target = authority.targets.find(t => t.targetWeaponId === selection.targetWeaponId)
  const group = authority.groups[rep.groupIndex]
  if (context.targetWeaponId !== selection.targetWeaponId) mismatches.push('targetWeaponId')
  if (context.groupIndex !== rep.groupIndex) mismatches.push('groupIndex')
  if (context.reservationDigest !== rep.reservationDigest) mismatches.push('reservationDigest')
  if (context.fixedSetId !== rep.fixedSetId) mismatches.push('fixedSetId')
  if (!same(context.fixedTargetWeaponIds, rep.fixedTargetWeaponIds)) mismatches.push('fixedTargetWeaponIds')
  if (context.cardinality !== rep.cardinality) mismatches.push('cardinality')
  if (!group || group.reservationDigest !== context.reservationDigest || !same(phase2c26b2aReservationRanges(context.reservation), group.reservation)) mismatches.push('reservation')
  if (!group || !group.aliasFixedSetIds.includes(context.fixedSetId)) mismatches.push('fixed_set_not_a_group_alias')
  if (!target) mismatches.push('target')
  else {
    if (target.currentBuildListEntryId !== context.currentBuildListEntryId) mismatches.push('currentBuildListEntryId')
    if (target.currentRouteKeySha256 !== sha(context.currentRouteKey)) mismatches.push('currentRouteKey')
    if (target.checkpointHardConstraint) mismatches.push('checkpointHardConstraint')
    if (target.originSemanticDigest !== context.originSemanticDigest) mismatches.push('originSemanticDigest')
  }
  if (!same(context.excludedRouteKeys, [context.currentRouteKey])) mismatches.push('excludedRouteKeys')
  if (context.originDigest !== authority.originDigest) mismatches.push('originDigest')
  if (!same(context.extent, authority.extent)) mismatches.push('extent')
  return { targetWeaponId: selection.targetWeaponId, matches: mismatches.length === 0, mismatches }
}

/**
 * The run-level conditions of the rebuilt snapshot against the B2-B1 RESULT: the Production default extent, the
 * Planner-start origin digest, the CalculationContext, the Research maxPlanSteps, and the snapshot's own calculation checks
 * (the K2 Conflict cross-check is a diagnostic there and read the way B2-B1 reads it).
 */
export function comparePhase2C26B2B2AConditions(current: { extent: unknown; originDigest: string; calculationContext: unknown; researchMaxPlanSteps: number;
  snapshotChecks: Phase2C26B2B1Snapshot['checks'] }, authority: Pick<Phase2C26B2B2AAuthority, 'extent' | 'originDigest' | 'calculationContext' | 'researchMaxPlanSteps'>) {
  const checks = {
    extentIsDefault: same(current.extent, { ...defaultPlannerAlternativeSearchExtent }) && same(current.extent, authority.extent),
    originDigestMatches: current.originDigest === authority.originDigest,
    calculationContextMatches: same(current.calculationContext, authority.calculationContext),
    researchMaxPlanStepsMatches: current.researchMaxPlanSteps === authority.researchMaxPlanSteps,
    snapshotChecksPass: current.snapshotChecks.k0IsEmptyReservation && current.snapshotChecks.reservationsNormalized && current.snapshotChecks.unitPlansMatchInitialContext
      && current.snapshotChecks.reservationDigestsUnique && current.snapshotChecks.k2ConflictPairs.matches,
  }
  const issues = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name)
  return { valid: issues.length === 0, issues, checks }
}

// ---------------------------------------------------------------- one Search task (child calculation)

/**
 * What a Search child receives. No oracle field exists here: the Target, the fixed-set selector and the expected
 * Production digests (to fail closed on a drift), and the capture bound.
 */
export interface Phase2C26B2B2ATaskInput {
  taskId: string
  executionClass: Phase2C26B2B2AExecutionClass
  targetWeaponId: string
  fixedSetId: string
  cardinality: number
  reservationDigest: string
  searchInputDigest: string
  captureBound: number
}

export function phase2c26b2b2aTaskInput(taskId: string, executionClass: Phase2C26B2B2AExecutionClass, context: Phase2C26B2B2AContext): Phase2C26B2B2ATaskInput {
  return { taskId, executionClass, targetWeaponId: context.targetWeaponId, fixedSetId: context.fixedSetId, cardinality: context.cardinality,
    reservationDigest: context.reservationDigest, searchInputDigest: context.searchInputDigest, captureBound: PHASE2C26B2B2A_CAPTURE_BOUND }
}

export interface Phase2C26B2B2ACapturedCandidate {
  /** 0-based delivery index in this context. */
  deliveryIndex: number
  stableKey: string
  summary: Phase2C2CandidateSummary
  reservationCheck: ReturnType<typeof respectsPhase2C2Reservation>
}

export interface Phase2C26B2B2ASearchRecord {
  targetWeaponId: string
  fixedSetId: string
  fixedTargetWeaponIds: string[]
  cardinality: number
  reservationDigest: string
  searchInputDigest: string
  extent: PlannerAlternativeSearchExtent
  excludedRouteKeys: string[]
  captureBound: number
  status: Phase2C2SearchStatus
  summary: { deliveredCandidates: number; excludedCandidates: number; exhausted: boolean; stoppedByExtent: boolean; stoppedByConsumer: boolean }
  candidates: Phase2C26B2B2ACapturedCandidate[]
  elapsedMs: number
}

export type Phase2C26B2B2AChildRecord =
  | { status: 'searched'; taskId: string; executionClass: Phase2C26B2B2AExecutionClass; search: Phase2C26B2B2ASearchRecord }
  /** The re-derived context is not the planned one: a semantic failure, never a Candidate count. */
  | { status: 'context_mismatch'; taskId: string; executionClass: Phase2C26B2B2AExecutionClass; issues: string[] }

/**
 * The Search of one context: `visitPlannerAlternativeCandidates()` with exactly the Planner-start origin, the snapshot
 * reservation, the excluded current Route key and the Production default extent; the consumer stops only once
 * `captureBound` Candidates were delivered. Each delivered Candidate is materialized by the Planner Alternative
 * materializer of this very context only to read its Route units (the Phase 2-C2 summary and reservation check).
 */
export async function runPhase2C26B2B2ASearch(input: PlannerInput, context: Phase2C26B2B2AContext, engine: RngEngine, captureBound: number,
  options: { yieldControl?: () => Promise<void>; now?: () => number } = {}): Promise<Phase2C26B2B2ASearchRecord> {
  if (captureBound !== PHASE2C26B2B2A_CAPTURE_BOUND) throw new Error(`The B2-B2A capture bound is ${PHASE2C26B2B2A_CAPTURE_BOUND}, not ${captureBound}.`)
  if (!same(context.extent, { ...defaultPlannerAlternativeSearchExtent })) throw new Error('B2-B2A searches the Production default extent only.')
  const now = options.now ?? (() => performance.now())
  const started = now()
  const origin = createPlannerStartSearchOrigin(input)
  if (hashStableValue(origin) !== context.originDigest) throw new Error('The Planner-start origin does not hash to the context origin digest.')
  const searchInput = { origin, targetWeaponId: context.targetWeaponId as never, extent: { ...context.extent }, reservation: context.reservation, excludedRouteKeys: context.excludedRouteKeys }
  const materializer = createPlannerAlternativeMaterializer({ ...searchInput, clock: { now: () => GLOBAL_RESEARCH_TIME } })
  const candidates: Phase2C26B2B2ACapturedCandidate[] = []
  const execution = await visitPlannerAlternativeCandidates(searchInput, engine, (candidate: PlannerAlternativeCandidate) => {
    const entry: BuildListEntry = materializer.materializeBuildListEntry(candidate, []).entry
    const summary = summarizePhase2C2Entry(entry, input, engine)
    candidates.push({ deliveryIndex: candidates.length, stableKey: candidateStableKey(candidate), summary,
      reservationCheck: respectsPhase2C2Reservation(summary, candidate.route, context.reservation) })
    return candidates.length >= captureBound ? 'stop' : 'continue'
  }, { yieldControl: options.yieldControl })
  return {
    targetWeaponId: context.targetWeaponId, fixedSetId: context.fixedSetId, fixedTargetWeaponIds: [...context.fixedTargetWeaponIds], cardinality: context.cardinality,
    reservationDigest: context.reservationDigest, searchInputDigest: context.searchInputDigest, extent: { ...context.extent }, excludedRouteKeys: [...context.excludedRouteKeys],
    captureBound, status: phase2c2SearchStatus(execution.summary, execution.stoppedByConsumer),
    summary: { deliveredCandidates: execution.summary.deliveredCandidates, excludedCandidates: execution.summary.excludedCandidates, exhausted: execution.summary.exhausted,
      stoppedByExtent: execution.summary.stoppedByExtent, stoppedByConsumer: execution.stoppedByConsumer },
    candidates, elapsedMs: now() - started,
  }
}

/** The child calculation: rebuild the context from the snapshot, fail closed on any drift from the task, then search. */
export async function runPhase2C26B2B2ATask(input: PlannerInput, snapshot: Phase2C26B2B1Snapshot, task: Phase2C26B2B2ATaskInput, engine: RngEngine,
  options: { yieldControl?: () => Promise<void>; now?: () => number } = {}): Promise<Phase2C26B2B2AChildRecord> {
  const rebuilt = reconstructPhase2C26B2B2AContext(snapshot, task)
  if (!rebuilt.valid) return { status: 'context_mismatch', taskId: task.taskId, executionClass: task.executionClass, issues: rebuilt.issues }
  const issues: string[] = []
  if (rebuilt.context.searchInputDigest !== task.searchInputDigest) issues.push('searchInputDigest')
  if (rebuilt.context.reservationDigest !== task.reservationDigest) issues.push('reservationDigest')
  if (issues.length > 0) return { status: 'context_mismatch', taskId: task.taskId, executionClass: task.executionClass, issues }
  const search = await runPhase2C26B2B2ASearch(input, rebuilt.context, engine, task.captureBound, options)
  return { status: 'searched', taskId: task.taskId, executionClass: task.executionClass, search }
}

// ---------------------------------------------------------------- task outcomes

export interface Phase2C26B2B2ATaskOutcome {
  taskId: string
  executionClass: Phase2C26B2B2AExecutionClass
  process: Phase2C2ChildOutcome
  record: 'searched' | 'context_mismatch' | null
  searchStatus: Phase2C2SearchStatus | null
  delivered: number | null
}

/** A timeout / out-of-memory / failure is that failure, never "no Candidate"; a completed child without a record is a failure. */
export function phase2c26b2b2aTaskOutcome(taskId: string, executionClass: Phase2C26B2B2AExecutionClass, process: Phase2C2ChildOutcome, record: Phase2C26B2B2AChildRecord | null): Phase2C26B2B2ATaskOutcome {
  if (process !== 'completed' || record === null) return { taskId, executionClass, process: process === 'completed' ? 'process_failure' : process, record: null, searchStatus: null, delivered: null }
  if (record.status === 'context_mismatch') return { taskId, executionClass, process, record: 'context_mismatch', searchStatus: null, delivered: null }
  return { taskId, executionClass, process, record: 'searched', searchStatus: record.search.status, delivered: record.search.summary.deliveredCandidates }
}

/** The registered fallback trigger: a Stage 1 timeout, and nothing else. */
export function phase2c26b2b2aNeedsFallback(stage1: Pick<Phase2C26B2B2ATaskOutcome, 'process'>): boolean {
  return stage1.process === 'timeout'
}
