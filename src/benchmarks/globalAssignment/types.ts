/**
 * Issue #154 Global Assignment Research adapter of the shared Phase 0 - C types (Research only; never imported by the app).
 *
 * The plain-data types of the Global Assignment Research pipeline (`docs/PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md` 4.1 - 4.3)
 * moved to the Production Domain module `src/domain/planner/buildListOptimization/` (Issue #260 PR-2); this file
 * re-exports them under the Research names and keeps only what is the Research's own: the option set identities `a1` /
 * `a2` (A-2) and the Research view of a ReachTable, which carries its option set identity alone. The Production
 * ReachTable also states the option rule (`continuesCurrentIdealLanes`); the Research derives it from the identity
 * exactly as before (`a1` without, every other option set with continuation), so no Research record changes meaning.
 */
import type {
  ReachOptionSet,
  ReachTable as ProductionReachTable,
  ReachTableResult as ProductionReachTableResult,
} from '../../domain/planner/buildListOptimization'

export {
  BuildListOptimizationInvariantError as GlobalAssignmentInvariantError,
  type BonusRequirement,
  type BuildListOptimizationContext as GlobalAssignmentContext,
  type BuildListOptimizationContextResult as GlobalAssignmentContextResult,
  type BuildListOptimizationInvariantCode as GlobalAssignmentInvariantCode,
  type ExcludedOwnedWeaponReason,
  type InclusiveRange,
  type LayoutKey,
  type NormalArtianCounterId,
  type ReachOption,
  type ReachOptionFinalState,
  type ReachScanSummary,
  type ReachWindow,
  type SkillRequirement,
  type SourceCandidate,
  type StreamEnd,
  type TargetReach,
} from '../../domain/planner/buildListOptimization'

/**
 * The option set a ReachTable's options follow (design 5.2 / 19, Issue #154 A-2). Every Phase reads the option rule of a table
 * through this value, so Phase A, B and C never judge one option by two different rules, and a result produced with one option
 * set is never read as another.
 *
 * - `a1`: the option set of Phase A through D-0A-2b (every record and RESULT before A-2, the B-2A formal protocol, D-0B, the
 *   `d0a-v1` golden). An owned Gogma's current-Ideal lane has the requirement `none` only.
 * - `a2`: A-2. An owned Gogma's current-Ideal lane also lists the continuations (G2: `reset_skills` on a current-Ideal Skill,
 *   `reset` / `keep_from_source` / `reset_then_keep` on a current-Ideal `gogma_artian` Bonus) after `none`, except on a source that
 *   is Ideal on both axes for the Target (G4-iii, audit 3.6: the Production Planner never commits that Target's own Entry) and
 *   on a protected source (REQUIREMENTS 21).
 */
export const REACH_OPTION_SET_A1 = 'global-assignment-reach-options:a1' as const
export const REACH_OPTION_SET_A2 = 'global-assignment-reach-options:a2' as const
export type ReachOptionSetVersion = typeof REACH_OPTION_SET_A1 | typeof REACH_OPTION_SET_A2

export function isReachOptionSetVersion(value: unknown): value is ReachOptionSetVersion {
  return value === REACH_OPTION_SET_A1 || value === REACH_OPTION_SET_A2
}

/** The Research view of a ReachTable: the Production table with its option set named by the Research identity alone. */
export type ReachTable = Omit<ProductionReachTable, 'optionSet' | 'continuesCurrentIdealLanes'> & {
  /** The option set every Phase derives and validates this table's options with (`ReachOptionSetVersion`). */
  optionSet: ReachOptionSetVersion
}

export type ReachTableResult =
  | { kind: 'reach_table'; table: ReachTable }
  /**
   * `unconfirmed_rng_state`: Base Seed, Skill Counter or Gogma Counter is not a confirmed value, so no
   * stream origin exists. `unconfirmed_counter`: a planning Target has no owned source and no confirmed
   * rarity-8 Normal Counter (the blind variant is never an option; the Production name is `target_without_source`).
   * `blind_route_required`: a planning Target has no owned source and its Normal prediction is unsupported, so only
   * a blind Route could reach it. `checkpoint_selection`: a valid Entry of a planning Target holds a selected
   * intermediate state, which this design never pins (design 15.1). None of them means the Ideal is unreachable.
   */
  | { kind: 'unsupported_input'; reason: 'unconfirmed_rng_state' | 'unconfirmed_counter' | 'blind_route_required' | 'checkpoint_selection'; detail: string }
  /** `shouldCancel()` returned true; the partial scan is reported as progress, never as "no option". */
  | Extract<ProductionReachTableResult, { kind: 'cancelled' }>

/** Whether a Research option set continues an owned Gogma's current-Ideal lanes: every option set but `a1` (the A-2 rule). */
export function researchContinuesCurrentIdealLanes(optionSet: string): boolean {
  return optionSet !== REACH_OPTION_SET_A1
}

/** The Production option set a Research option set identity runs as. */
export function researchReachOptionSet(optionSet: ReachOptionSetVersion): ReachOptionSet {
  return { id: optionSet, continuesCurrentIdealLanes: researchContinuesCurrentIdealLanes(optionSet) }
}

/**
 * The Production table a Research table (or the part of it a caller passes) stands for: the same fields plus the option rule its
 * identity names. Every Research entry point that hands a table to the Production module goes through it.
 */
export function productionReachTableOf<T extends { optionSet: string }>(table: T): T & { continuesCurrentIdealLanes: boolean } {
  return { ...table, continuesCurrentIdealLanes: researchContinuesCurrentIdealLanes(table.optionSet) }
}

/** The Research view of a Production table built under a Research option set; a table whose rule contradicts the identity fails closed. */
export function researchReachTableOf(table: ProductionReachTable, optionSet: ReachOptionSetVersion): ReachTable {
  const { continuesCurrentIdealLanes, ...rest } = table
  if (table.optionSet !== optionSet || continuesCurrentIdealLanes !== researchContinuesCurrentIdealLanes(optionSet)) {
    throw new RangeError(`The ReachTable's option set ${table.optionSet} / ${String(continuesCurrentIdealLanes)} is not the Research option set ${optionSet}.`)
  }
  return { ...rest, optionSet }
}
