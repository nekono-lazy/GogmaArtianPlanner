/**
 * Issue #154 Phase 2-C2.6-B2-B1: the all-current fixed-set reservation snapshot, Research only. Never import from
 * Production.
 *
 * B2-B1 runs no Search. B2-A found that the single fixed winner a Conflict orientation chooses leaves most uncovered
 * oracle Routes without a reservation-compatible context. This calculation asks, without any oracle knowledge, which
 * reservations the CURRENT Routes alone can produce when 0, 1 or 2 of them are held fixed:
 *
 * ```text
 * preparePlannerInitialContext()            (the shared Planner authority: valid Entries, unit plans, planning Targets,
 *                                            checkpoint requirements, initial Conflicts)
 *   -> current searchable Entry per planning Target (exactly one, or the run fails closed)
 *   -> fixed sets K0 (empty), K1 (every Entry), K2 (every unordered pair), in Entry ID order
 *   -> validity: createPlannerRouteUnitPlans() rejections + detectPlannerConflicts() over the fixed Entries only
 *   -> reservation: derivePlannerAlternativeReservation() (already normalizePlannerAlternativeReservation() form)
 *   -> semantic reservation groups (exact dedup; every alias fixed set kept as provenance)
 *   -> per Target: the groups having at least one alias without the Target's own Entry (no context for a Target whose
 *      required checkpoint Entry is a hard constraint: checkpointRequirements.requiredEntryIdByTargetId)
 * ```
 *
 * A context's Search semantic input is `{ targetWeaponId, origin (normalizePlannerSearchOrigin), reservation,
 * excludedRouteKeys = [candidateStableKey(current Route)], extent = Production default }`; origin, exclusion and extent
 * are per-Target constants here, so the exact `(Target, reservation group)` pair is the context identity. Fixed Entry IDs
 * never enter it: different fixed sets with the same reservation are one context, with every alias kept.
 *
 * This module never reads a file, an earlier Phase result or oracle evidence; nothing here selects a Target, an Entry
 * or a Counter position by anything but the Export itself. Reachability of any Route is the post-hoc analyzer's.
 */
import type { BuildListEntry, BuildListEntryId, TargetWeapon } from '../domain/models/publicTypes'
import { hashStableValue, stableStringify } from '../domain/models/hashing'
import { derivePlannerAlternativeReservation } from '../domain/planner/alternative'
import { detectPlannerConflicts } from '../domain/planner/plannerConflictDetection'
import { preparePlannerInitialContext } from '../domain/planner/plannerInitialContext'
import { createPlannerRouteUnitPlans } from '../domain/planner/plannerRouteProgress'
import type { PlannerDependencies, PlannerInput } from '../domain/planner/plannerTypes'
import { createPlannerStartSearchOrigin, normalizePlannerSearchOrigin } from '../domain/planner/replacement/plannerSearchOrigin'
import {
  candidateStableKey,
  defaultPlannerAlternativeSearchExtent,
  emptyPlannerAlternativeReservation,
  isEmptyPlannerAlternativeReservation,
  normalizePlannerAlternativeExcludedRouteKeys,
  normalizePlannerAlternativeReservation,
  type PlannerAlternativeReservation,
  type PlannerAlternativeSearchExtent,
} from '../domain/search'
import { phase2c26b2aOriginSnapshot, type Phase2C26B2AOriginSnapshot } from './plannerGlobalPhase2C26B2A'

/** Research execution conditions of the snapshot run (not Production defaults). */
export const PHASE2C26B2B1_SNAPSHOT_HEAP_MB = 8192
/** The largest fixed-set cardinality this Phase enumerates. */
export const PHASE2C26B2B1_MAX_CARDINALITY = 2
/** What B2-B1 deliberately does not run. */
export const PHASE2C26B2B1_NOT_RUN = ['planner_alternative_search', 'candidate_search', 'extent_probe', 'candidate_capture', 'planner_alternative_kernel',
  'planner_trial', 'full_planner_rerun', 'global_assignment', 'candidate_combination_search', 'alternative_route_generation', 'k3_or_larger_fixed_sets',
  'runtime_optimization'] as const

export type Phase2C26B2B1Cardinality = 0 | 1 | 2

const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0

// ---------------------------------------------------------------- fixed sets

/** Deterministic fixed-set ID: `K0`, `K1:<entry>`, `K2:<entry>|<entry>` (Entry IDs ascending). */
export function phase2c26b2b1FixedSetId(entryIds: readonly string[]): string {
  const sorted = [...entryIds].sort(compare)
  if (new Set(sorted).size !== sorted.length) throw new Error('A fixed set repeats an Entry.')
  return `K${sorted.length}${sorted.length === 0 ? '' : `:${sorted.join('|')}`}`
}

/**
 * K0, every K1 and every unordered K2 pair of the given Entry IDs, in that order; inside a family in ascending Entry ID
 * order (pairs lexicographically by (first, second)). No pair repeats and no pair holds one Entry twice.
 */
export function enumeratePhase2C26B2B1FixedSets(entryIds: readonly string[]): string[][] {
  const ids = [...new Set(entryIds)].sort(compare)
  if (ids.length !== entryIds.length) throw new Error('Fixed-set enumeration needs distinct Entry IDs.')
  const sets: string[][] = [[]]
  for (const id of ids) sets.push([id])
  for (let i = 0; i < ids.length; i += 1) for (let j = i + 1; j < ids.length; j += 1) sets.push([ids[i]!, ids[j]!])
  return sets
}

export interface Phase2C26B2B1ConflictRow { kind: string; buildListEntryIds: string[] }

export interface Phase2C26B2B1FixedSetRow {
  fixedSetId: string
  cardinality: Phase2C26B2B1Cardinality
  fixedBuildListEntryIds: string[]
  fixedTargetWeaponIds: string[]
  /** No Route unit plan rejection and no Conflict among the fixed Entries themselves. */
  valid: boolean
  routePlanRejectionEntryIds: string[]
  conflicts: Phase2C26B2B1ConflictRow[]
  invalidConflictKinds: string[]
  /** Index into `reservationGroups` (null for an invalid set). */
  reservationGroupIndex: number | null
}

export interface Phase2C26B2B1ReservationGroup {
  groupIndex: number
  /** `hashStableValue()` of the normalized reservation (a label; dedup is by the exact serialization). */
  reservationDigest: string
  reservation: PlannerAlternativeReservation
  /** Every valid fixed set deriving this reservation, in enumeration order. */
  aliasFixedSetIds: string[]
  minCardinality: Phase2C26B2B1Cardinality
  aliasesByCardinality: Record<'0' | '1' | '2', number>
}

/**
 * One fixed set judged by the existing Planner authorities only: the Route unit plans of the fixed Entries
 * (`createPlannerRouteUnitPlans()`) and the Conflicts among those Entries alone (`detectPlannerConflicts()`, no
 * resolution). A shareable physical action is never a Conflict there, so it never invalidates a set.
 */
export function judgePhase2C26B2B1FixedSet(fixed: readonly BuildListEntry[], targets: readonly TargetWeapon[], dependencies: Pick<PlannerDependencies, 'rngEngine'>) {
  const plans = createPlannerRouteUnitPlans(fixed, dependencies.rngEngine)
  const routePlanRejectionEntryIds = [...new Set(plans.rejections.map(rejection => rejection.buildListEntryId as string))].sort(compare)
  const detection = detectPlannerConflicts(fixed, plans.unitPlans, targets, [], false)
  const conflicts = detection.conflicts.map(conflict => ({ kind: conflict.kind as string, buildListEntryIds: [...conflict.buildListEntryIds].map(String).sort(compare) }))
  return { unitPlans: plans.unitPlans, routePlanRejectionEntryIds, conflicts, valid: routePlanRejectionEntryIds.length === 0 && conflicts.length === 0 }
}

// ---------------------------------------------------------------- the snapshot

export interface Phase2C26B2B1TargetRow {
  targetWeaponId: string
  currentBuildListEntryId: string
  /** `candidateStableKey()` of the current Route (raw only; the RESULT writes SHA-256). */
  currentRouteKey: string
  excludedRouteKeys: string[]
  /** A required checkpoint Entry of this Target (the shared checkpoint authority): no context is generated for it. */
  checkpointHardConstraint: boolean
  /** In `initialRelevantEntries` of the initial context (diagnostic). */
  initiallyRelevant: boolean
  /** `hashStableValue(normalizePlannerSearchOrigin(origin, target))`: the Planner Alternative search identity's origin part. */
  originSemanticDigest: string
}

export interface Phase2C26B2B1TargetContexts {
  targetWeaponId: string
  status: 'searchable' | 'checkpoint_hard_constraint'
  /** Valid fixed sets without the Target's own Entry (raw Target x fixed-set contexts). */
  rawContexts: number
  /** One row per semantic context: `[groupIndex, minimum eligible alias cardinality, eligible alias count]`, by group index. */
  contexts: [number, Phase2C26B2B1Cardinality, number][]
}

export interface Phase2C26B2B1Snapshot {
  input: {
    planningTargets: number
    allSearchEntries: number
    validBuildListEntries: number
    initialRelevantEntries: number
    routePlanRejections: number
    initialConflicts: number
    checkpointHardConstraintTargets: string[]
  }
  /** `hashStableValue()` of `createPlannerStartSearchOrigin(input)` and its Counter origins. */
  originDigest: string
  origin: Phase2C26B2AOriginSnapshot
  extent: PlannerAlternativeSearchExtent
  targets: Phase2C26B2B1TargetRow[]
  fixedSets: Phase2C26B2B1FixedSetRow[]
  reservationGroups: Phase2C26B2B1ReservationGroup[]
  targetContexts: Phase2C26B2B1TargetContexts[]
  checks: {
    /** `derivePlannerAlternativeReservation([])` is the Production empty reservation. */
    k0IsEmptyReservation: boolean
    /** Every derived reservation is a fixed point of `normalizePlannerAlternativeReservation()`. */
    reservationsNormalized: boolean
    /** Per Entry, the K1 unit plan equals the initial context's `allUnitPlans`. */
    unitPlansMatchInitialContext: boolean
    /** Distinct reservations never share a digest label. */
    reservationDigestsUnique: boolean
    /**
     * Cross-check against the initial context's own Conflict detection (`initialConflictDetection`, over the initially
     * relevant Entries' remaining units): every invalid K2 pair is listed together in one of its Conflicts (`matches`
     * reads only this direction). The reverse is not required - a Conflict of three Entries can list two that share one
     * shareable physical action - so `onlyInitialDetection` is a diagnostic. Meaningful when every Entry is initially
     * relevant (`input.initialRelevantEntries === input.allSearchEntries`).
     */
    k2ConflictPairs: { k2Invalid: number; initialDetectionPairs: number; onlyK2: string[]; onlyInitialDetection: string[]; matches: boolean }
  }
}

/**
 * The whole B2-B1 calculation from one Planner input. Fails closed (throws) when the initial context is not ready, when
 * a planning Target does not hold exactly one current searchable Entry, or when a searchable Entry names a Target outside
 * the planning Targets: the Research fixture's premise, never a representative chosen here.
 */
export function derivePhase2C26B2B1Snapshot(input: PlannerInput, dependencies: PlannerDependencies): Phase2C26B2B1Snapshot {
  const prepared = preparePlannerInitialContext(input, dependencies)
  if (prepared.status !== 'ready') throw new Error(`The initial context is not ready: ${JSON.stringify(prepared.issues ?? [])}`)
  const context = prepared.context
  const planningTargetIds = new Set<string>(context.planningTargetIds)
  for (const entry of context.allSearchEntries) {
    if (!planningTargetIds.has(entry.targetWeaponId)) throw new Error(`Searchable Entry ${entry.id} names a Target outside the planning Targets.`)
  }
  const entryByTarget = new Map<string, BuildListEntry>()
  for (const target of context.planningTargets) {
    const entries = context.allSearchEntries.filter(entry => entry.targetWeaponId === target.id)
    if (entries.length !== 1) throw new Error(`Planning Target ${target.id} holds ${entries.length} current searchable Entries; this Research fixture needs exactly one.`)
    entryByTarget.set(target.id, entries[0]!)
  }
  const origin = createPlannerStartSearchOrigin(input)
  const extent = { ...defaultPlannerAlternativeSearchExtent }
  const relevant = new Set(context.initialRelevantEntries.map(entry => entry.id as string))
  const required = context.checkpointRequirements.requiredEntryIdByTargetId
  const targets = context.planningTargets.map((target): Phase2C26B2B1TargetRow => {
    const entry = entryByTarget.get(target.id)!
    const currentRouteKey = candidateStableKey(entry.candidateSnapshot)
    return {
      targetWeaponId: target.id, currentBuildListEntryId: entry.id, currentRouteKey, excludedRouteKeys: normalizePlannerAlternativeExcludedRouteKeys([currentRouteKey]),
      checkpointHardConstraint: required.has(target.id), initiallyRelevant: relevant.has(entry.id),
      originSemanticDigest: hashStableValue(normalizePlannerSearchOrigin(origin, target)),
    }
  }).sort((a, b) => compare(a.targetWeaponId, b.targetWeaponId))

  const entriesById = context.entriesById as ReadonlyMap<string, BuildListEntry>
  const targetOfEntry = (id: string) => entriesById.get(id)!.targetWeaponId as string
  const groups: Phase2C26B2B1ReservationGroup[] = []
  const groupByKey = new Map<string, number>()
  let reservationsNormalized = true
  let unitPlansMatchInitialContext = true
  const fixedSets = enumeratePhase2C26B2B1FixedSets(context.allSearchEntries.map(entry => entry.id)).map((ids): Phase2C26B2B1FixedSetRow => {
    const fixed = ids.map(id => entriesById.get(id)!)
    const judged = judgePhase2C26B2B1FixedSet(fixed, context.planningTargets, dependencies)
    if (ids.length === 1) {
      const own = judged.unitPlans.get(ids[0] as BuildListEntryId), shared = context.allUnitPlans.get(ids[0] as BuildListEntryId)
      if (stableStringify(own ?? null) !== stableStringify(shared ?? null)) unitPlansMatchInitialContext = false
    }
    const cardinality = ids.length as Phase2C26B2B1Cardinality
    const fixedSetId = phase2c26b2b1FixedSetId(ids)
    let reservationGroupIndex: number | null = null
    if (judged.valid) {
      const reservation = derivePlannerAlternativeReservation(fixed, dependencies.rngEngine)
      const key = stableStringify(reservation)
      if (stableStringify(normalizePlannerAlternativeReservation(reservation)) !== key) reservationsNormalized = false
      let index = groupByKey.get(key)
      if (index === undefined) {
        index = groups.length
        groupByKey.set(key, index)
        groups.push({ groupIndex: index, reservationDigest: hashStableValue(reservation), reservation, aliasFixedSetIds: [], minCardinality: cardinality, aliasesByCardinality: { '0': 0, '1': 0, '2': 0 } })
      }
      const group = groups[index]!
      group.aliasFixedSetIds.push(fixedSetId)
      group.aliasesByCardinality[String(cardinality) as '0' | '1' | '2'] += 1
      if (cardinality < group.minCardinality) group.minCardinality = cardinality
      reservationGroupIndex = index
    }
    return {
      fixedSetId, cardinality, fixedBuildListEntryIds: [...ids], fixedTargetWeaponIds: ids.map(targetOfEntry).sort(compare), valid: judged.valid,
      routePlanRejectionEntryIds: judged.routePlanRejectionEntryIds, conflicts: judged.conflicts,
      invalidConflictKinds: [...new Set(judged.conflicts.map(c => c.kind))].sort(compare), reservationGroupIndex,
    }
  })

  const fixedSetById = new Map(fixedSets.map(row => [row.fixedSetId, row]))
  const targetContexts = targets.map((target): Phase2C26B2B1TargetContexts => {
    if (target.checkpointHardConstraint) return { targetWeaponId: target.targetWeaponId, status: 'checkpoint_hard_constraint', rawContexts: 0, contexts: [] }
    let rawContexts = 0
    const contexts: [number, Phase2C26B2B1Cardinality, number][] = []
    for (const group of groups) {
      const eligible = group.aliasFixedSetIds.map(id => fixedSetById.get(id)!).filter(row => !row.fixedBuildListEntryIds.includes(target.currentBuildListEntryId))
      if (eligible.length === 0) continue
      rawContexts += eligible.length
      contexts.push([group.groupIndex, Math.min(...eligible.map(row => row.cardinality)) as Phase2C26B2B1Cardinality, eligible.length])
    }
    return { targetWeaponId: target.targetWeaponId, status: 'searchable', rawContexts, contexts }
  })

  const k2Invalid = new Set(fixedSets.filter(row => row.cardinality === 2 && !row.valid).map(row => row.fixedSetId))
  const initialPairs = new Set<string>()
  for (const conflict of context.initialConflictDetection.conflicts) {
    const ids = [...conflict.buildListEntryIds].map(String).sort(compare)
    for (let i = 0; i < ids.length; i += 1) for (let j = i + 1; j < ids.length; j += 1) initialPairs.add(phase2c26b2b1FixedSetId([ids[i]!, ids[j]!]))
  }
  const onlyK2 = [...k2Invalid].filter(id => !initialPairs.has(id)).sort(compare)
  const onlyInitialDetection = [...initialPairs].filter(id => !k2Invalid.has(id)).sort(compare)

  const k0 = fixedSets[0]!
  const k0Reservation = k0.reservationGroupIndex === null ? null : groups[k0.reservationGroupIndex]!.reservation
  const digests = new Set(groups.map(group => group.reservationDigest))
  return {
    input: {
      planningTargets: context.planningTargets.length, allSearchEntries: context.allSearchEntries.length, validBuildListEntries: context.validBuildListEntries.length,
      initialRelevantEntries: context.initialRelevantEntries.length, routePlanRejections: context.routePlanRejections.length,
      initialConflicts: context.initialConflictDetection.conflicts.length,
      checkpointHardConstraintTargets: targets.filter(t => t.checkpointHardConstraint).map(t => t.targetWeaponId),
    },
    originDigest: hashStableValue(origin),
    origin: phase2c26b2aOriginSnapshot(origin),
    extent,
    targets,
    fixedSets,
    reservationGroups: groups,
    targetContexts,
    checks: {
      k0IsEmptyReservation: k0.valid && k0Reservation !== null && isEmptyPlannerAlternativeReservation(k0Reservation)
        && stableStringify(k0Reservation) === stableStringify(normalizePlannerAlternativeReservation(emptyPlannerAlternativeReservation)),
      reservationsNormalized,
      unitPlansMatchInitialContext,
      reservationDigestsUnique: digests.size === groups.length,
      k2ConflictPairs: { k2Invalid: k2Invalid.size, initialDetectionPairs: initialPairs.size, onlyK2, onlyInitialDetection,
        matches: onlyK2.length === 0 },
    },
  }
}
