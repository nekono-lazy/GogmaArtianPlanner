/**
 * Issue #154 Global Assignment Phase A (Research only; never imported by the app).
 *
 * Shared plain-data types of the Global Assignment Research pipeline
 * (`docs/PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md` 4.1 - 4.3). Everything here is structured-clone data:
 * no RngEngine instance, no Clock, no random value. The names follow the design's proposals; the
 * meanings and invariants of design 4 / 5 are kept as written there.
 */
import type {
  ElementId, GroupSkillId, OwnedWeaponId, RestorationBonusScope, RestorationBonusSet, SeriesSkillId,
  TargetWeapon, TargetWeaponId, WeaponTypeId,
} from '../../domain/models/publicTypes'
import type { PlannerInput } from '../../domain/planner/plannerTypes'
import type { PlannerInputValidationResult } from '../../domain/planner/plannerValidation'

/** The persisted `NormalArtianCounter.id` (`<weaponTypeId>:<rarity>`), one rarity-8 stream per weapon type. */
export type NormalArtianCounterId = string

/** How many Counter positions of each stream one scan covers (design 4.1 / 5.1 / 10.3). */
export interface ReachWindow {
  normal: number
  gogma: number
  skill: number
}

/**
 * Phase 0 output (design 4.1): the planning Target set fixed with the Production rule
 * (`validatePlannerInput().validBuildListEntries` -> `derivePlannerPlanningTargets()`), kept for every
 * later Phase. The existing BuildListEntries decide only which Targets are planning Targets; their Route
 * contents are never read again after this point.
 */
export interface GlobalAssignmentContext {
  plannerInput: PlannerInput
  validation: PlannerInputValidationResult
  /** Target ID stable order; never changed by a later Phase. */
  planningTargets: readonly TargetWeapon[]
  planningTargetIds: ReadonlySet<TargetWeaponId>
}

export type GlobalAssignmentContextResult =
  | { kind: 'context'; context: GlobalAssignmentContext }
  /**
   * `invalid_planner_input`: `validatePlannerInput()` reported issues, so the input is never continued
   * as if it were valid. `no_planning_target`: the input is valid but no Target has a valid Entry
   * (zero planning Targets, never "every active Target").
   */
  | { kind: 'unsupported_input'; reason: 'invalid_planner_input' | 'no_planning_target'; detail: string; validation: PlannerInputValidationResult }

/** `keepFamilyLayoutKey()`: the ordered slot family layout. Never an unordered multiset. */
export type LayoutKey = string

export type SourceCandidate =
  | {
      kind: 'owned_gogma'
      ownedWeaponId: OwnedWeaponId
      layout: LayoutKey
      scope: RestorationBonusScope
      currentSkillIdeal: boolean
      currentBonusIdeal: boolean
      /** A protected Gogma is a source only while both current axes are Ideal (zero-operation option). */
      isProtected: boolean
      /** `getPredictionSupport({ type: 'gogma_keep', currentBonuses: <this weapon's five slots> })`. */
      keepSupported: boolean
    }
  | {
      kind: 'owned_normal'
      ownedWeaponId: OwnedWeaponId
      layout: LayoutKey
      /** Always false: a protected Normal is never a conversion source (REQUIREMENTS 21). */
      isProtected: false
      keepSupported: boolean
    }
  | {
      kind: 'new_normal'
      counterId: NormalArtianCounterId
      /** The production-target forge position (0-based block index of that forge's result). */
      position: number
      layout: LayoutKey
      keepSupported: boolean
    }

export type ExcludedOwnedWeaponReason =
  | 'protected_gogma_not_ideal'
  | 'protected_normal'
  | 'normal_rarity_not_8'

export interface InclusiveRange {
  from: number
  to: number
}

export interface TargetReach {
  targetWeaponId: TargetWeaponId
  weaponTypeId: WeaponTypeId
  elementId: ElementId
  /** The confirmed rarity-8 Normal Counter of the weapon type, or null (then no `new_normal` source exists). */
  normalCounterId: NormalArtianCounterId | null
  /** `getPredictionSupport()` of the Target's weapon type / element; Keep support is per source (`keepSupported`). */
  support: { normal: boolean; skill: boolean; gogmaReset: boolean }
  skill: {
    /**
     * Ideal Skill positions among `originSkill .. originSkill + window.skill` (ascending). The last
     * position is reachable only by a conversion Route's final Skill (SEARCH_SPEC 3.1: `M + 1`
     * positions); a Reset Skills of an existing Gogma uses positions up to `resetSkillsLimit`.
     */
    idealPositions: number[]
    resetSkillsLimit: number
    conversionLimit: number
  }
  bonus: {
    /** Gogma positions whose Reset result is Ideal in `gogma_artian` scope (ascending). */
    resetIdealPositions: number[]
    /** Ordered family layout of every scanned Reset result, in position order (for `reset_then_keep`). */
    resetLayoutByPosition: Map<number, LayoutKey>
    /**
     * Positions whose Keep from the layout is Ideal, for every layout of interest (a layout whose family
     * multiset equals the Ideal's and that occurs as a source or Reset layout in the window), keys in
     * ascending order. A layout outside the Ideal multiset is never Keep-Ideal (Keep preserves families)
     * and is therefore never predicted.
     */
    keepIdealPositionsByLayout: Map<LayoutKey, number[]>
    /** Layouts of interest whose Keep prediction input is unsupported by the Engine (no Keep option from them). */
    keepUnsupportedLayouts: LayoutKey[]
  }
  /** Owned sources in OwnedWeapon ID order, then `new_normal` by position. */
  sources: SourceCandidate[]
  excludedOwnedWeapons: { ownedWeaponId: OwnedWeaponId; reason: ExcludedOwnedWeaponReason }[]
}

export interface ReachScanSummary {
  /** Engine prediction calls actually made (memo misses). */
  predictions: { skill: number; gogmaReset: number; gogmaKeep: number; normal: number }
  /** Prediction requests answered from the memo (shared between Targets of one weapon type / element). */
  memoHits: { skill: number; gogmaReset: number; gogmaKeep: number; normal: number }
  supportQueries: number
  groups: {
    weaponTypeId: WeaponTypeId
    elementId: ElementId
    targetWeaponIds: TargetWeaponId[]
    keepLayoutsOfInterest: LayoutKey[]
  }[]
  /** Unsupported predictions: an option absence, never "the Ideal is unreachable". */
  unsupported: { targetWeaponId: TargetWeaponId; prediction: 'skill' | 'gogma_reset' | 'gogma_keep' | 'normal_artian'; reason: string; layout?: LayoutKey }[]
}

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

export interface ReachTable {
  /** The option set every Phase derives and validates this table's options with (`ReachOptionSetVersion`). */
  optionSet: ReachOptionSetVersion
  originSkill: number
  originGogma: number
  originNormal: Record<NormalArtianCounterId, number>
  window: ReachWindow
  /** The positions actually scanned per stream (inclusive). Nothing outside them is "absent". */
  scanned: { skill: InclusiveRange; gogma: InclusiveRange; normal: Record<NormalArtianCounterId, InclusiveRange> }
  /** The same elements and order as `GlobalAssignmentContext.planningTargets`. */
  targets: TargetReach[]
  summary: ReachScanSummary
}

export type ReachTableResult =
  | { kind: 'reach_table'; table: ReachTable }
  /**
   * `unconfirmed_rng_state`: Base Seed, Skill Counter or Gogma Counter is not a confirmed value, so no
   * stream origin exists. `unconfirmed_counter`: a planning Target has no owned source and no confirmed
   * rarity-8 Normal Counter (the blind variant is never an option). `blind_route_required`: a planning
   * Target has no owned source and its Normal prediction is unsupported, so only a blind Route could
   * reach it. `checkpoint_selection`: a valid Entry of a planning Target holds a selected intermediate
   * state, which this design never pins (design 15.1). None of them means the Ideal is unreachable.
   */
  | { kind: 'unsupported_input'; reason: 'unconfirmed_rng_state' | 'unconfirmed_counter' | 'blind_route_required' | 'checkpoint_selection'; detail: string }
  /** `shouldCancel()` returned true; the partial scan is reported as progress, never as "no option". */
  | { kind: 'cancelled'; progress: { predictions: ReachScanSummary['predictions']; lastGroup: { weaponTypeId: WeaponTypeId; elementId: ElementId } | null } }

export type SkillRequirement =
  | { kind: 'none' }
  /** Owned Gogma: the last Reset Skills position `s*`. */
  | { kind: 'reset_skills'; finalPosition: number }
  /** New / owned Normal: conversion at `c`, final Skill position `s*` (`c = s*`: the conversion Skill is Ideal). */
  | { kind: 'conversion'; conversionPosition: number; finalPosition: number }

export type BonusRequirement =
  | { kind: 'none' }
  | { kind: 'reset'; finalPosition: number }
  | { kind: 'keep_from_source'; finalPosition: number }
  /** `Keep(layout(Reset(resetPosition)), finalPosition)` is Ideal, `resetPosition < finalPosition`. */
  | { kind: 'reset_then_keep'; resetPosition: number; finalPosition: number }

export interface StreamEnd {
  skill: number
  gogma: number
  normal: Record<NormalArtianCounterId, number>
}

/**
 * One necessary condition under which one Target reaches its Ideal (design 4.3 / 5.2): a source plus
 * the required Counter positions of each stream. It is not a Route, and it proves no coexistence.
 */
export interface ReachOption {
  targetWeaponId: TargetWeaponId
  source: SourceCandidate
  skillRequired: SkillRequirement
  bonusRequired: BonusRequirement
  /** The production-target forge of a `new_normal` source, otherwise null. */
  normalRequired: { counterId: NormalArtianCounterId; position: number } | null
  /** Last required position + 1 per stream; a stream without an operation ends at its origin. */
  streamEnd: StreamEnd
  /** `necessary_only` from the scan; `rng_replayed` only after `replayReachOptionRequiredOnly()` (design 5.3). */
  verification: 'necessary_only' | 'rng_replayed'
}

/** The required-only replay's final weapon state (design 5.3 `rng_replayed`, the shape 8.3 later compares). */
export interface ReachOptionFinalState {
  finalBonuses: RestorationBonusSet
  restorationBonusScope: RestorationBonusScope
  seriesSkillId: SeriesSkillId | null
  groupSkillId: GroupSkillId | null
}

export type GlobalAssignmentInvariantCode =
  | 'target_not_planning'
  | 'source_missing'
  | 'source_kind_mismatch'
  | 'requirement_inconsistent'
  | 'prediction_unsupported'
  | 'ideal_mismatch'
  | 'engine_contract_violation'
  | 'window_invalid'
  /** Phase C-1: a coverage / materialization order derivation contradicted its own pre-check (design 8.2). */
  | 'coverage_invariant'

/** A Research-internal inconsistency (design 5.3): the scan and the Ideal judgement share one authority, so a mismatch is a bug, never a game fact. */
export class GlobalAssignmentInvariantError extends Error {
  readonly code: GlobalAssignmentInvariantCode

  constructor(code: GlobalAssignmentInvariantCode, message: string) {
    super(message)
    this.name = 'GlobalAssignmentInvariantError'
    this.code = code
  }
}
