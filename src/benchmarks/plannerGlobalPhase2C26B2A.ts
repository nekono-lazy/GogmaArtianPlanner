/**
 * Issue #154 Phase 2-C2.6-B2-A: the pre-Search context snapshot of the CURRENT Production, Research only. Never import
 * from Production.
 *
 * B2-A runs no Search. Its one calculation re-derives, from this run's own baseline (the ordinary Production Planner over
 * the original Export), every orientation's pre-Search context through the unchanged B1 path
 * (`derivePhase2C25APreSearchContexts()` + `withPhase2C26B1SearchInputDigest()`, exactly what `derivePhase2C26B1Contexts()`
 * does) and records, per context, what a post-hoc reachability audit needs:
 *
 * ```text
 * Counter origins (the prepared scenario origin the Search would read: Skill, Gogma, every Normal Counter)
 * normalized reservation (normal / skill / gogma held + blocked, exclusive OwnedWeapon IDs)
 * extent, fixed Route Entry IDs, excluded Route keys, contextDigest, searchInputDigest
 * ```
 *
 * The same fields are recorded for every context; nothing here selects a context, a Target or a position. This module
 * never reads a file, an earlier Phase result or oracle evidence: the B1 RESULT (parity authority) and the 1,657 oracle
 * are read only by the post-hoc analyzer, after this snapshot exists.
 */
import { hashStableValue } from '../domain/models/publicTypes'
import type { PlannerDependencies, PlannerInput } from '../domain/planner/plannerTypes'
import type { PlannerAlternativeReservation, PlannerAlternativeSearchExtent } from '../domain/search'
import type { Phase2C2BaselineSummary, Phase2C2Orientation } from './plannerGlobalPhase2C2'
import { derivePhase2C25APreSearchContexts } from './plannerGlobalPhase2C25A'
import { withPhase2C26B1SearchInputDigest } from './plannerGlobalPhase2C26B1'

/** Research execution conditions of the snapshot run (not Production defaults). */
export const PHASE2C26B2A_SNAPSHOT_HEAP_MB = 8192
/** What B2-A deliberately does not run. */
export const PHASE2C26B2A_NOT_RUN = ['planner_alternative_search', 'extent_probe', 'capture_bound_change', 'planner_alternative_kernel', 'planner_trial',
  'full_planner_rerun', 'global_assignment', 'candidate_combination_search', 'runtime_optimization'] as const

export interface Phase2C26B2ACounterOrigin { value: number | null; isConfirmed: boolean }

/** The Counter origins of the prepared scenario origin (the Planner-start snapshot the Search reads). */
export interface Phase2C26B2AOriginSnapshot {
  skillCounter: Phase2C26B2ACounterOrigin
  gogmaCounter: Phase2C26B2ACounterOrigin
  /** Every Normal Counter of the origin, sorted by Counter ID. */
  normalCounters: { counterId: string; counter: number | null; isConfirmed: boolean }[]
}

export interface Phase2C26B2AContextSnapshot {
  orientationId: string
  workIndex: number
  targetWeaponId: string
  status: 'searchable' | 'blocked_by_selected_checkpoint'
  invalidatedBuildListEntryId: string
  fixedRouteBuildListEntryIds: string[]
  /** `normalizePlannerAlternativeReservation()` form; `null` for a blocked context. */
  reservation: PlannerAlternativeReservation | null
  excludedRouteKeys: string[]
  extent: PlannerAlternativeSearchExtent
  originDigest: string
  /** `hashStableValue()` of the prepared origin re-computed here: must equal `originDigest`. */
  origin: Phase2C26B2AOriginSnapshot
  contextDigest: string
  searchInputDigest: string
}

interface OriginLike {
  rngState: { skillCounter: { value: number | null; isConfirmed: boolean }; gogmaCounter: { value: number | null; isConfirmed: boolean } }
  normalCounters: readonly { id: string; counter: number | null; isConfirmed: boolean }[]
}

export function phase2c26b2aOriginSnapshot(origin: OriginLike): Phase2C26B2AOriginSnapshot {
  return {
    skillCounter: { value: origin.rngState.skillCounter.value, isConfirmed: origin.rngState.skillCounter.isConfirmed },
    gogmaCounter: { value: origin.rngState.gogmaCounter.value, isConfirmed: origin.rngState.gogmaCounter.isConfirmed },
    normalCounters: origin.normalCounters.map(counter => ({ counterId: counter.id, counter: counter.counter, isConfirmed: counter.isConfirmed }))
      .sort((a, b) => a.counterId < b.counterId ? -1 : a.counterId > b.counterId ? 1 : 0),
  }
}

/**
 * Every orientation's pre-Search contexts, in the baseline's orientation order and the kernel's work order, through the
 * same calls `derivePhase2C26B1Contexts()` makes, plus each orientation's prepared origin Counters. The origin read here
 * must hash to the context's own `originDigest`, or the snapshot fails closed.
 */
export function derivePhase2C26B2AContextSnapshots(input: PlannerInput, orientations: readonly Phase2C2Orientation[], dependencies: () => PlannerDependencies): Phase2C26B2AContextSnapshot[] {
  return orientations.flatMap(orientation => {
    const prepared = derivePhase2C25APreSearchContexts(input, orientation, dependencies())
    const origin = prepared.prepared.scenario.origin
    const originDigest = hashStableValue(origin)
    const snapshot = phase2c26b2aOriginSnapshot(origin)
    return prepared.contexts.map(withPhase2C26B1SearchInputDigest).map((context): Phase2C26B2AContextSnapshot => {
      if (context.originDigest !== originDigest) throw new Error(`Context ${context.orientationId}#${context.workIndex}: the prepared origin does not hash to its originDigest.`)
      return {
        orientationId: context.orientationId, workIndex: context.workIndex, targetWeaponId: context.targetWeaponId, status: context.status,
        invalidatedBuildListEntryId: context.invalidatedBuildListEntryId, fixedRouteBuildListEntryIds: [...context.fixedRouteBuildListEntryIds],
        reservation: context.reservation, excludedRouteKeys: [...context.excludedRouteKeys], extent: { ...context.extent }, originDigest: context.originDigest,
        origin: snapshot, contextDigest: context.contextDigest, searchInputDigest: context.searchInputDigest,
      }
    })
  })
}

export interface Phase2C26B2ASnapshotRecord {
  baseline: { summary: Phase2C2BaselineSummary; orientations: Phase2C2Orientation[] }
  contexts: Phase2C26B2AContextSnapshot[]
}
