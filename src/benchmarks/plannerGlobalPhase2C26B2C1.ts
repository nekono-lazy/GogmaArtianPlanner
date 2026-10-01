/**
 * Issue #154 Phase 2-C2.6-B2-C1: the oracle-free fixed-set reservation context scheduler, Research only. Never import
 * from Production.
 *
 * B2-C1 runs no Search. It asks, without any oracle knowledge, in which order a scheduler should try the semantic
 * reservation contexts B2-B1 enumerated, so that a small context budget reaches a good reservation:
 *
 * ```text
 * derivePhase2C26B2B1Snapshot()          (unchanged: preparePlannerInitialContext(), K0 / K1 / K2 fixed sets, validity by
 *                                         createPlannerRouteUnitPlans() + detectPlannerConflicts(), reservations by
 *                                         derivePlannerAlternativeReservation(), semantic dedup, eligible aliases)
 *   -> per Target x semantic reservation context:
 *        targetEligibleMinCardinality      (recomputed from the Target's OWN eligible aliases, never the group minimum)
 *        representative alias              (provenance only: the first eligible alias of that cardinality by ID)
 *        exclusive / held / blocked / shareable-held counts, over the whole reservation and over the Production default
 *        window of the Planner-start origin (Normal: only the Target's own weapon-type Normal Counter)
 *   -> four fixed lexicographic policies P0..P3 (K0 always rank 1), ranks 1..N per Target
 * ```
 *
 * The scheduler identity is `(Target, reservation)`; alias fixed-set IDs are provenance. This module never reads a file,
 * an earlier Phase result or oracle evidence; it selects no Target, Entry or Counter position by anything but the Export.
 * Which context is reservation-compatible with any Route is the post-hoc analyzer's question alone.
 */
import type { PlannerDependencies, PlannerInput } from '../domain/planner/plannerTypes'
import { createPlannerStartSearchOrigin, resolvePlannerSearchOriginTarget } from '../domain/planner/replacement/plannerSearchOrigin'
import type { TargetWeaponId } from '../domain/models/publicTypes'
import {
  defaultPlannerAlternativeSearchExtent,
  selectSearchableNormalCounters,
  type PlannerAlternativeReservation,
  type PlannerAlternativeSearchExtent,
  type PlannerAlternativeStreamReservation,
} from '../domain/search'
import { derivePhase2C26B2B1Snapshot, type Phase2C26B2B1Cardinality, type Phase2C26B2B1Snapshot } from './plannerGlobalPhase2C26B2B1'

/** Research execution conditions of the schedule run (not Production defaults). */
export const PHASE2C26B2C1_SNAPSHOT_HEAP_MB = 8192
/** What B2-C1 deliberately does not run. */
export const PHASE2C26B2C1_NOT_RUN = ['planner_alternative_search', 'candidate_search', 'candidate_materialization', 'candidate_trial', 'planner_alternative_kernel',
  'full_planner_rerun', 'global_assignment', 'extent_probe', 'extent_change', 'candidate_capture_policy_change', 'search_ordering_change', 'search_comparator_change',
  'production_change', 'ui_change', 'runtime_optimization'] as const

const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0

// ---------------------------------------------------------------- the Production default window (Research helper)

/** A half-open Counter position window `[from, toExclusive)`. */
export interface Phase2C26B2C1Window { from: number; toExclusive: number }

export interface Phase2C26B2C1Windows {
  /** The production target positions of the Target's weapon-type Normal Counter: `origin .. origin + maxNormalAdvance - 1`. */
  normal: Phase2C26B2C1Window | null
  /** An existing Gogma's Reset Skills: `origin .. origin + maxSkillAdvance - 1`. */
  skillExistingGogma: Phase2C26B2C1Window
  /** A conversion Route's conversion and Reset Skills: `origin .. origin + maxSkillAdvance` (Search `conversionSkillPositionLimit`). */
  skillConversion: Phase2C26B2C1Window
  /** The Skill feature window: the union of both Skill windows, i.e. the conversion window. */
  skill: Phase2C26B2C1Window
  /** Gogma Counter positions `origin .. origin + maxGogmaAdvance - 1`. */
  gogma: Phase2C26B2C1Window
}

/**
 * The Production default window of the Planner Alternative Search, as the 5.6.8 extent meanings and the Search wiring
 * read it (`PlannerAlternativeSearchExtent` docs; the Planner Alternative Search wiring passes
 * `conversionSkillPositionLimit = origin + maxSkillAdvance + 1`), and exactly the limits B2-A's
 * `phase2c26b2aRouteExtent()` / `phase2c26b2aReachability()` judge against. No Production helper returns these absolute
 * windows, so this Research helper states them once; the tests pin them to the B2-A extent verdicts at every boundary.
 */
export function phase2c26b2c1DefaultWindows(origins: { skill: number; gogma: number; normal: number | null }, extent: PlannerAlternativeSearchExtent): Phase2C26B2C1Windows {
  for (const value of [origins.skill, origins.gogma, ...(origins.normal === null ? [] : [origins.normal])]) {
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`Invalid Counter origin ${value}.`)
  }
  for (const value of [extent.maxNormalAdvance, extent.maxGogmaAdvance, extent.maxSkillAdvance]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`Invalid extent value ${value}.`)
  }
  const skillConversion = { from: origins.skill, toExclusive: origins.skill + extent.maxSkillAdvance + 1 }
  return {
    normal: origins.normal === null ? null : { from: origins.normal, toExclusive: origins.normal + extent.maxNormalAdvance },
    skillExistingGogma: { from: origins.skill, toExclusive: origins.skill + extent.maxSkillAdvance },
    skillConversion,
    skill: { ...skillConversion },
    gogma: { from: origins.gogma, toExclusive: origins.gogma + extent.maxGogmaAdvance },
  }
}

// ---------------------------------------------------------------- reservation geometry

export interface Phase2C26B2C1StreamGeometry { held: number; blocked: number; shareableHeld: number }

/**
 * Held / blocked / shareable-held counts of one normalized stream reservation, optionally inside a window. Positions are a
 * set (a duplicate fails closed), and the Production contract `blocked ⊆ held` makes shareable held = held - blocked: a
 * held position another Route may still operate on.
 */
export function phase2c26b2c1StreamGeometry(stream: PlannerAlternativeStreamReservation | null, window: Phase2C26B2C1Window | null | 'full'): Phase2C26B2C1StreamGeometry {
  if (stream === null || window === null) return { held: 0, blocked: 0, shareableHeld: 0 }
  const held = new Set(stream.held), blocked = new Set(stream.blocked)
  if (held.size !== stream.held.length || blocked.size !== stream.blocked.length) throw new Error('A stream reservation repeats a position.')
  for (const position of [...held, ...blocked]) if (!Number.isSafeInteger(position)) throw new RangeError(`Invalid reserved position ${position}.`)
  for (const position of blocked) if (!held.has(position)) throw new Error(`Blocked position ${position} is not held (blocked ⊆ held).`)
  const inside = (position: number) => window === 'full' || (position >= window.from && position < window.toExclusive)
  const heldCount = [...held].filter(inside).length, blockedCount = [...blocked].filter(inside).length
  return { held: heldCount, blocked: blockedCount, shareableHeld: heldCount - blockedCount }
}

export interface Phase2C26B2C1Geometry {
  normalRelevant: Phase2C26B2C1StreamGeometry
  skill: Phase2C26B2C1StreamGeometry
  gogma: Phase2C26B2C1StreamGeometry
  total: Phase2C26B2C1StreamGeometry
}

export interface Phase2C26B2C1Features {
  exclusiveOwnedWeaponCount: number
  full: Phase2C26B2C1Geometry
  default: Phase2C26B2C1Geometry
}

const sumGeometry = (parts: Phase2C26B2C1StreamGeometry[]): Phase2C26B2C1StreamGeometry =>
  parts.reduce((acc, part) => ({ held: acc.held + part.held, blocked: acc.blocked + part.blocked, shareableHeld: acc.shareableHeld + part.shareableHeld }), { held: 0, blocked: 0, shareableHeld: 0 })

/**
 * The reservation features of one context for one Target. Normal reads only the Target's own weapon-type Normal Counter
 * (`relevantNormalCounterId`, from `selectSearchableNormalCounters()`); no other Normal Counter is ever summed.
 */
export function phase2c26b2c1ReservationFeatures(reservation: PlannerAlternativeReservation, relevantNormalCounterId: string | null, windows: Phase2C26B2C1Windows): Phase2C26B2C1Features {
  const exclusive = new Set(reservation.exclusiveOwnedWeaponIds)
  if (exclusive.size !== reservation.exclusiveOwnedWeaponIds.length) throw new Error('A reservation repeats an exclusive OwnedWeapon.')
  const normalEntries = reservation.normal.filter(entry => entry.counterId === relevantNormalCounterId)
  if (normalEntries.length > 1) throw new Error(`A reservation lists Normal Counter ${relevantNormalCounterId} twice.`)
  const normal = relevantNormalCounterId === null ? null : normalEntries[0] ?? null
  const geometry = (scope: 'full' | 'default'): Phase2C26B2C1Geometry => {
    const normalRelevant = phase2c26b2c1StreamGeometry(normal, scope === 'full' ? 'full' : windows.normal)
    const skill = phase2c26b2c1StreamGeometry(reservation.skill, scope === 'full' ? 'full' : windows.skill)
    const gogma = phase2c26b2c1StreamGeometry(reservation.gogma, scope === 'full' ? 'full' : windows.gogma)
    return { normalRelevant, skill, gogma, total: sumGeometry([normalRelevant, skill, gogma]) }
  }
  return { exclusiveOwnedWeaponCount: exclusive.size, full: geometry('full'), default: geometry('default') }
}

// ---------------------------------------------------------------- the four fixed policies (registered before the formal run)

export type Phase2C26B2C1PolicyId = 'P0' | 'P1' | 'P2' | 'P3'
export type Phase2C26B2C1SortField = 'targetEligibleMinCardinality' | 'exclusiveOwnedWeaponCount' | 'blockedCountDefaultTotal' | 'shareableHeldCountDefaultTotal'
  | 'blockedCountFullTotal' | 'shareableHeldCountFullTotal' | 'reservationDigest'
export interface Phase2C26B2C1Policy { id: Phase2C26B2C1PolicyId; name: string; keys: readonly (readonly [Phase2C26B2C1SortField, 'asc' | 'desc'])[] }

/**
 * Lexicographic keys only (no weighted score). K0, the empty reservation, is rank 1 under every policy; these keys order
 * the K1 / K2 contexts after it. `reservationDigest ASC` is always the last key.
 */
export const PHASE2C26B2C1_POLICIES: readonly Phase2C26B2C1Policy[] = [
  { id: 'P0', name: 'stable_simple_first', keys: [['targetEligibleMinCardinality', 'asc'], ['reservationDigest', 'asc']] },
  { id: 'P1', name: 'default_simple_first', keys: [['targetEligibleMinCardinality', 'asc'], ['exclusiveOwnedWeaponCount', 'asc'], ['blockedCountDefaultTotal', 'asc'],
    ['shareableHeldCountDefaultTotal', 'desc'], ['reservationDigest', 'asc']] },
  { id: 'P2', name: 'default_utility_first', keys: [['exclusiveOwnedWeaponCount', 'asc'], ['blockedCountDefaultTotal', 'asc'], ['shareableHeldCountDefaultTotal', 'desc'],
    ['targetEligibleMinCardinality', 'asc'], ['reservationDigest', 'asc']] },
  { id: 'P3', name: 'full_utility_first', keys: [['exclusiveOwnedWeaponCount', 'asc'], ['blockedCountFullTotal', 'asc'], ['shareableHeldCountFullTotal', 'desc'],
    ['targetEligibleMinCardinality', 'asc'], ['reservationDigest', 'asc']] },
]
export const PHASE2C26B2C1_POLICY_IDS: readonly Phase2C26B2C1PolicyId[] = ['P0', 'P1', 'P2', 'P3']

export interface Phase2C26B2C1SortableContext {
  reservationDigest: string
  targetEligibleMinCardinality: Phase2C26B2B1Cardinality
  features: Phase2C26B2C1Features
}

export function phase2c26b2c1SortValue(context: Phase2C26B2C1SortableContext, field: Phase2C26B2C1SortField): number | string {
  switch (field) {
    case 'targetEligibleMinCardinality': return context.targetEligibleMinCardinality
    case 'exclusiveOwnedWeaponCount': return context.features.exclusiveOwnedWeaponCount
    case 'blockedCountDefaultTotal': return context.features.default.total.blocked
    case 'shareableHeldCountDefaultTotal': return context.features.default.total.shareableHeld
    case 'blockedCountFullTotal': return context.features.full.total.blocked
    case 'shareableHeldCountFullTotal': return context.features.full.total.shareableHeld
    case 'reservationDigest': return context.reservationDigest
  }
}

export function phase2c26b2c1ComparePolicy(policy: Phase2C26B2C1Policy, left: Phase2C26B2C1SortableContext, right: Phase2C26B2C1SortableContext): number {
  for (const [field, direction] of policy.keys) {
    const a = phase2c26b2c1SortValue(left, field), b = phase2c26b2c1SortValue(right, field)
    const order = typeof a === 'number' && typeof b === 'number' ? a - b : compare(String(a), String(b))
    if (order !== 0) return direction === 'asc' ? order : -order
  }
  return 0
}

/**
 * Ranks 1..N of one Target's contexts under one policy, returned in the input order. K0 (eligible minimum cardinality 0)
 * is rank 1; every other context is sorted by the policy keys. Equal keys (only possible for an equal digest) and a
 * missing or repeated K0 fail closed, so no Map / insertion order ever decides a rank.
 */
export function phase2c26b2c1Rank<T extends Phase2C26B2C1SortableContext>(contexts: readonly T[], policy: Phase2C26B2C1Policy): number[] {
  const k0 = contexts.map((c, i) => [c, i] as const).filter(([c]) => c.targetEligibleMinCardinality === 0)
  if (k0.length !== 1) throw new Error(`A Target holds ${k0.length} K0 contexts; the schedule needs exactly one.`)
  const rest = contexts.map((c, i) => [c, i] as const).filter(([c]) => c.targetEligibleMinCardinality !== 0)
  rest.sort(([a], [b]) => {
    const order = phase2c26b2c1ComparePolicy(policy, a, b)
    if (order === 0) throw new Error(`Policy ${policy.id} cannot order two contexts with equal keys (${a.reservationDigest}).`)
    return order
  })
  const ranks = new Array<number>(contexts.length)
  ranks[k0[0]![1]] = 1
  rest.forEach(([, index], position) => { ranks[index] = position + 2 })
  return ranks
}

// ---------------------------------------------------------------- the schedule

export interface Phase2C26B2C1TargetRow {
  targetWeaponId: string
  currentBuildListEntryId: string
  checkpointHardConstraint: boolean
  originSemanticDigest: string
  /** `selectSearchableNormalCounters()` of the Target over the Planner-start origin (null: no Normal Search for it). */
  relevantNormalCounterId: string | null
  windows: Phase2C26B2C1Windows
  contexts: number
}

export interface Phase2C26B2C1ContextRow extends Phase2C26B2C1SortableContext {
  targetWeaponId: string
  groupIndex: number
  representativeFixedSetId: string
  representativeFixedTargetWeaponIds: string[]
  eligibleAliasCount: number
  ranks: Record<Phase2C26B2C1PolicyId, number>
}

export interface Phase2C26B2C1Schedule {
  snapshot: Phase2C26B2B1Snapshot
  extent: PlannerAlternativeSearchExtent
  origins: { skill: number; gogma: number }
  policies: readonly Phase2C26B2C1Policy[]
  targets: Phase2C26B2C1TargetRow[]
  /** Per Target (ascending ID), its contexts in group index order. */
  contexts: Phase2C26B2C1ContextRow[]
  checks: {
    /** Every Target's ranks are a permutation of 1..N under every policy. */
    ranksArePermutations: boolean
    /** K0 is rank 1 for every Target under every policy. */
    k0RankOne: boolean
    /** No Target holds two contexts with one digest. */
    digestsUniquePerTarget: boolean
    /** The context rows are exactly the B2-B1 Target contexts (group, eligible minimum, eligible alias count). */
    contextsMatchSnapshot: boolean
  }
}

/** The Planner-start origin values the schedule reads, already resolved through the Production authorities. */
export interface Phase2C26B2C1ScheduleOrigin {
  skill: number
  gogma: number
  /** The Target's one searchable weapon-type Normal Counter (`selectSearchableNormalCounters()`), or null. */
  relevantNormalCounter: (targetWeaponId: string) => { id: string; counter: number } | null
}

/**
 * The whole B2-C1 calculation from one Planner input: the unchanged B2-B1 snapshot, the Production origin resolution
 * (confirmed Skill / Gogma Counters, `selectSearchableNormalCounters()` per Target), then the schedule. Fails closed when a
 * Counter origin is not confirmed or a Target has more than one searchable Normal Counter.
 */
export function derivePhase2C26B2C1Schedule(input: PlannerInput, dependencies: PlannerDependencies): Phase2C26B2C1Schedule {
  const snapshot = derivePhase2C26B2B1Snapshot(input, dependencies)
  const origin = createPlannerStartSearchOrigin(input)
  const skill = origin.rngState.skillCounter, gogma = origin.rngState.gogmaCounter
  if (!skill.isConfirmed || skill.value === null || !gogma.isConfirmed || gogma.value === null) throw new Error('The Planner-start Skill / Gogma Counter is not confirmed.')
  return phase2c26b2c1ScheduleFromSnapshot(snapshot, {
    skill: skill.value,
    gogma: gogma.value,
    relevantNormalCounter: targetWeaponId => {
      const counters = selectSearchableNormalCounters(resolvePlannerSearchOriginTarget(origin, targetWeaponId as TargetWeaponId), origin.normalCounters)
      if (counters.length > 1) throw new Error(`Target ${targetWeaponId} has ${counters.length} searchable Normal Counters.`)
      const counter = counters[0]
      return counter === undefined || counter.counter === null ? null : { id: counter.id, counter: counter.counter }
    },
  })
}

/**
 * The schedule over one B2-B1 snapshot: per Target, every semantic reservation group with at least one alias without the
 * Target's own Entry (none for a checkpoint hard-constraint Target), its Target-specific eligible minimum cardinality and
 * representative alias, its features, and its rank under each policy. Fails closed on any feature contract violation.
 */
export function phase2c26b2c1ScheduleFromSnapshot(snapshot: Phase2C26B2B1Snapshot, scheduleOrigin: Phase2C26B2C1ScheduleOrigin): Phase2C26B2C1Schedule {
  const extent = { ...defaultPlannerAlternativeSearchExtent }
  const fixedSetById = new Map(snapshot.fixedSets.map(row => [row.fixedSetId, row]))
  const targets: Phase2C26B2C1TargetRow[] = []
  const contexts: Phase2C26B2C1ContextRow[] = []
  let contextsMatchSnapshot = true
  for (const target of snapshot.targets) {
    const counter = scheduleOrigin.relevantNormalCounter(target.targetWeaponId)
    const windows = phase2c26b2c1DefaultWindows({ skill: scheduleOrigin.skill, gogma: scheduleOrigin.gogma, normal: counter === null ? null : counter.counter }, extent)
    const contextRow = snapshot.targetContexts.find(row => row.targetWeaponId === target.targetWeaponId)
    if (!contextRow) throw new Error(`Target ${target.targetWeaponId} has no B2-B1 context row.`)
    const rows: Phase2C26B2C1ContextRow[] = []
    for (const group of snapshot.reservationGroups) {
      const eligible = group.aliasFixedSetIds.map(id => fixedSetById.get(id)!).filter(fs => !fs.fixedBuildListEntryIds.includes(target.currentBuildListEntryId))
      if (target.checkpointHardConstraint || eligible.length === 0) continue
      const minimum = Math.min(...eligible.map(fs => fs.cardinality)) as Phase2C26B2B1Cardinality
      const representative = eligible.filter(fs => fs.cardinality === minimum).sort((a, b) => compare(a.fixedSetId, b.fixedSetId))[0]!
      rows.push({
        targetWeaponId: target.targetWeaponId, groupIndex: group.groupIndex, reservationDigest: group.reservationDigest, targetEligibleMinCardinality: minimum,
        representativeFixedSetId: representative.fixedSetId, representativeFixedTargetWeaponIds: [...representative.fixedTargetWeaponIds], eligibleAliasCount: eligible.length,
        features: phase2c26b2c1ReservationFeatures(group.reservation, counter?.id ?? null, windows),
        ranks: { P0: 0, P1: 0, P2: 0, P3: 0 },
      })
    }
    const expected = contextRow.contexts.map(([groupIndex, minimum, count]) => `${groupIndex}:${minimum}:${count}`)
    if (expected.join(',') !== rows.map(r => `${r.groupIndex}:${r.targetEligibleMinCardinality}:${r.eligibleAliasCount}`).join(',')) contextsMatchSnapshot = false
    if (rows.length > 0) {
      for (const policy of PHASE2C26B2C1_POLICIES) phase2c26b2c1Rank(rows, policy).forEach((rank, i) => { rows[i]!.ranks[policy.id] = rank })
    }
    targets.push({ targetWeaponId: target.targetWeaponId, currentBuildListEntryId: target.currentBuildListEntryId, checkpointHardConstraint: target.checkpointHardConstraint,
      originSemanticDigest: target.originSemanticDigest, relevantNormalCounterId: counter?.id ?? null, windows, contexts: rows.length })
    contexts.push(...rows)
  }
  const byTarget = (id: string) => contexts.filter(c => c.targetWeaponId === id)
  const ranksArePermutations = targets.every(t => PHASE2C26B2C1_POLICY_IDS.every(p => {
    const ranks = byTarget(t.targetWeaponId).map(c => c.ranks[p]).sort((a, b) => a - b)
    return ranks.every((rank, i) => rank === i + 1)
  }))
  const k0RankOne = contexts.filter(c => c.targetEligibleMinCardinality === 0).every(c => PHASE2C26B2C1_POLICY_IDS.every(p => c.ranks[p] === 1))
    && targets.every(t => t.contexts === 0 || byTarget(t.targetWeaponId).filter(c => c.targetEligibleMinCardinality === 0).length === 1)
  const digestsUniquePerTarget = targets.every(t => new Set(byTarget(t.targetWeaponId).map(c => c.reservationDigest)).size === t.contexts)
  return { snapshot, extent, origins: { skill: scheduleOrigin.skill, gogma: scheduleOrigin.gogma }, policies: PHASE2C26B2C1_POLICIES, targets, contexts,
    checks: { ranksArePermutations, k0RankOne, digestsUniquePerTarget, contextsMatchSnapshot } }
}

