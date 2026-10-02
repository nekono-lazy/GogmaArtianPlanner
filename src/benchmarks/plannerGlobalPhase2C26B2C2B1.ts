/**
 * Issue #154 Phase 2-C2.6-B2-C2B1: the oracle-free calculation of the extent requirement characterization, Research
 * only. Never import from Production.
 *
 * B2-C2B1 runs no Search. Its calculation re-derives, from the Export and the current Production code alone, the exact
 * state the next extent-insufficient Search Phase would start from:
 *
 * ```text
 * derivePhase2C26B2C1Schedule()          (unchanged: the B2-B1 snapshot - Planner-start origin, 43 Targets, K0 / K1 / K2
 *                                         fixed sets, Production reservations, semantic contexts - the Target-specific
 *                                         eligible minimum cardinality, the reservation geometry and the P0..P3 ranks)
 *   -> the P1 ordering projection per Target: the context counts by eligible minimum cardinality and the P1 rank ranges
 *      of the K1 and the K2 contexts (P1 is cardinality-first, so every K1 context precedes every K2 context)
 * ```
 *
 * Which Target is extent-insufficient, which is K1- or K2-minimal, where an oracle Route stands and how much extent it
 * needs are questions of the post-hoc analyzer alone. This module reads no file, no earlier
 * Phase result and no oracle evidence, and selects nothing by anything but the Export.
 */
import type { PlannerDependencies, PlannerInput } from '../domain/planner/plannerTypes'
import { derivePhase2C26B2C1Schedule, type Phase2C26B2C1ContextRow, type Phase2C26B2C1Schedule } from './plannerGlobalPhase2C26B2C1'

/** The one ordering the extent-insufficient Search Phase is registered to use (B2-C1's selected Research policy). */
export const PHASE2C26B2C2B1_ORDERING_POLICY = 'P1' as const
/** Research execution conditions of the calculation run (not Production defaults). */
export const PHASE2C26B2C2B1_CALCULATION_HEAP_MB = 8192
/** What B2-C2B1 deliberately does not run. */
export const PHASE2C26B2C2B1_NOT_RUN = ['planner_alternative_search', 'candidate_search', 'actual_search_probe', 'candidate_capture_comparison', 'candidate_materialization',
  'candidate_trial', 'planner_alternative_kernel', 'full_planner_rerun', 'global_assignment', 'extent_change', 'production_default_change', 'search_ordering_change',
  'search_comparator_change', 'policy_change', 'k2_feature_grouping', 'residual_unreached_support', 'production_change', 'ui_change'] as const

type Range = readonly [number, number]

export interface Phase2C26B2C2B1TargetOrdering {
  targetWeaponId: string
  contexts: number
  byEligibleMinCardinality: Record<'0' | '1' | '2', number>
  /** P1 ranks of the eligible-minimum K1 / K2 contexts as an inclusive range (null when the Target has none). */
  p1: { k0Rank: number | null; k1Ranks: Range | null; k2Ranks: Range | null }
}

export interface Phase2C26B2C2B1Calculation {
  schedule: Phase2C26B2C1Schedule
  orderingPolicy: typeof PHASE2C26B2C2B1_ORDERING_POLICY
  p1Ordering: Phase2C26B2C2B1TargetOrdering[]
  checks: {
    /** Under P1 every Target's K1 contexts take the ranks right after K0 and precede every K2 context. */
    p1CardinalityFirst: boolean
    /** The projection covers every schedule Target once, in schedule order. */
    p1OrderingCoversTargets: boolean
  }
}

const rangeOf = (ranks: readonly number[]): Range | null => ranks.length === 0 ? null : [Math.min(...ranks), Math.max(...ranks)]

/** The P1 ordering projection of one schedule (pure; the analyzer recomputes it to detect drift). */
export function phase2c26b2c2b1P1Ordering(schedule: Pick<Phase2C26B2C1Schedule, 'targets' | 'contexts'>): Phase2C26B2C2B1TargetOrdering[] {
  const rowsByTarget = new Map<string, Phase2C26B2C1ContextRow[]>()
  for (const row of schedule.contexts) rowsByTarget.set(row.targetWeaponId, [...(rowsByTarget.get(row.targetWeaponId) ?? []), row])
  return schedule.targets.map(target => {
    const rows = rowsByTarget.get(target.targetWeaponId) ?? []
    const ranks = (cardinality: number) => rows.filter(row => row.targetEligibleMinCardinality === cardinality).map(row => row.ranks[PHASE2C26B2C2B1_ORDERING_POLICY])
    const k0 = ranks(0)
    if (k0.length > 1) throw new Error(`Target ${target.targetWeaponId} holds ${k0.length} K0 contexts.`)
    return {
      targetWeaponId: target.targetWeaponId,
      contexts: rows.length,
      byEligibleMinCardinality: { '0': k0.length, '1': ranks(1).length, '2': ranks(2).length },
      p1: { k0Rank: k0[0] ?? null, k1Ranks: rangeOf(ranks(1)), k2Ranks: rangeOf(ranks(2)) },
    }
  })
}

/** Whether one Target's P1 projection is cardinality-first: K0 rank 1, K1 at 2..1+K1, K2 at 2+K1..1+K1+K2. */
export function phase2c26b2c2b1IsCardinalityFirst(row: Phase2C26B2C2B1TargetOrdering): boolean {
  if (row.contexts === 0) return row.p1.k0Rank === null && row.p1.k1Ranks === null && row.p1.k2Ranks === null
  const k1 = row.byEligibleMinCardinality['1'], k2 = row.byEligibleMinCardinality['2']
  const expect = (count: number, from: number): Range | null => count === 0 ? null : [from, from + count - 1]
  const same = (a: Range | null, b: Range | null) => a === null ? b === null : b !== null && a[0] === b[0] && a[1] === b[1]
  return row.p1.k0Rank === 1 && same(row.p1.k1Ranks, expect(k1, 2)) && same(row.p1.k2Ranks, expect(k2, 2 + k1))
}

/**
 * The whole B2-C2B1 calculation from one Planner input: the unchanged B2-C1 schedule (which itself re-derives the
 * unchanged B2-B1 snapshot) and the P1 ordering projection.
 */
export function derivePhase2C26B2C2B1Calculation(input: PlannerInput, dependencies: PlannerDependencies): Phase2C26B2C2B1Calculation {
  return phase2c26b2c2b1CalculationFromSchedule(derivePhase2C26B2C1Schedule(input, dependencies))
}

export function phase2c26b2c2b1CalculationFromSchedule(schedule: Phase2C26B2C1Schedule): Phase2C26B2C2B1Calculation {
  const p1Ordering = phase2c26b2c2b1P1Ordering(schedule)
  return {
    schedule,
    orderingPolicy: PHASE2C26B2C2B1_ORDERING_POLICY,
    p1Ordering,
    checks: {
      p1CardinalityFirst: p1Ordering.every(phase2c26b2c2b1IsCardinalityFirst),
      p1OrderingCoversTargets: p1Ordering.map(row => row.targetWeaponId).join('\u0000') === schedule.targets.map(target => target.targetWeaponId).join('\u0000'),
    },
  }
}
