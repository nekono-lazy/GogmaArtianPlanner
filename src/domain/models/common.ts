export type Brand<T, B extends string> = T & { readonly __brand: B }

export type OwnedWeaponId = Brand<string, 'OwnedWeaponId'>
export type TargetWeaponId = Brand<string, 'TargetWeaponId'>
export type BuildCandidateId = Brand<string, 'BuildCandidateId'>
export type BuildListEntryId = Brand<string, 'BuildListEntryId'>
export type ProductionPlanId = Brand<string, 'ProductionPlanId'>
export type PlanStepId = Brand<string, 'PlanStepId'>
export type ExecutionHistoryId = Brand<string, 'ExecutionHistoryId'>
/**
 * One user-visible intermediate state of one stream lane (Skill or Bonus) of a
 * canonical Ideal Route.
 *
 * Derived deterministically from the Candidate's own meaning, the lane, and
 * the state's performance identity, never from a search run id, a clock, or an
 * enumeration ordinal (`docs/SEARCH_SPEC.md` 5.8).
 */
export type IntermediateStateGroupId = Brand<
  string,
  'IntermediateStateGroupId'
>
/** One lane position at which an intermediate state group's exact state is reached. */
export type IntermediateStateOpportunityId = Brand<
  string,
  'IntermediateStateOpportunityId'
>

export type ISODateTimeString = string
export type WeaponTypeId = string
export type ElementId = string
export type BonusTypeId = string
export type BonusRankId = string
export type SeriesSkillId = string
export type GroupSkillId = string
export type MaterialId = string

export type RngStateSource = 'manual' | 'observation'

export const V1_NORMAL_ARTIAN_RARITY = 8 as const
export type NormalArtianRarity = typeof V1_NORMAL_ARTIAN_RARITY
export type ArtianWeaponKind = 'normal' | 'gogma'
export type RestorationBonusScope = 'normal_artian' | 'gogma_artian'
/**
 * A user-facing organisation label on an owned Gogma Artian weapon, and nothing
 * more.
 *
 * It never decides whether the Planner or Search may operate on the weapon
 * (`isProtected` does), which weapon a Target starts from
 * (`TargetWeapon.preferredOwnedWeaponId` does), or whether a weapon satisfies a
 * Target (the actual restoration bonuses and Skills do). Because it carries no
 * calculation meaning, it is excluded from every semantic hash and calculation
 * identity, exactly like `name` and `memo` (`docs/DATA_MODEL.md` 3.2).
 */
export type OwnedWeaponStatus = 'unclassified' | 'practical' | 'ideal'
export type RouteKind =
  | 'normal_artian_to_gogma'
  | 'owned_normal_artian_to_gogma'
  | 'existing_gogma_current'
  | 'existing_gogma_reset_bonuses'
  | 'existing_gogma_keep_bonuses'
  | 'existing_gogma_reset_skills'
  | 'existing_gogma_mixed'
export type SkillMatchMode = 'all' | 'any'
export type ProductionPlanStatus =
  | 'draft'
  | 'active'
  | 'completed'
  | 'stale'
  | 'abandoned'
/** Why a Plan became `abandoned` (`docs/PLANNER_SPEC.md` 16.2). */
export type ProductionPlanAbandonmentReason =
  | 'user_abandoned'
  | 'replan_adopted'
  | 'finished_as_compromise'
  | 'breaking_change_approved'
export const productionPlanAbandonmentReasons = [
  'user_abandoned',
  'replan_adopted',
  'finished_as_compromise',
  'breaking_change_approved',
] as const satisfies readonly ProductionPlanAbandonmentReason[]
export type PlanStepOperationType =
  | 'create_normal_artian'
  | 'convert_normal_to_gogma'
  | 'reset_bonuses'
  | 'keep_bonuses'
  | 'reset_skills'
  /**
   * Current (calculation schema 12): confirms that an owned Gogma already holds
   * the Target's Ideal and completes the Target without advancing any Counter
   * (`docs/PLANNER_SPEC.md` 16.3).
   */
  | 'confirm_owned_ideal'
  /**
   * Legacy only: an independent secure Step of a calculation schema 11 or
   * earlier Plan. It stays in the type so a historical Plan can be displayed,
   * but the current Planner never generates it and it is never executable.
   */
  | 'reserve_weapon'
  /** Legacy only, exactly like `reserve_weapon`. */
  | 'confirm_result'
/**
 * What the user confirmed happened at one Step (`docs/PLANNER_SPEC.md` 16.4).
 *
 * Current Execution records only `confirmed_expected`,
 * `actual_result_different`, `operation_uncertain` and
 * `finished_as_compromise`. `secured_weapon` and `skipped_candidate` belong to
 * legacy Plans with an independent secure Step; they stay in the type so a
 * historical record can be displayed, and current Execution never writes them.
 */
export type ExecutionAction =
  | 'confirmed_expected'
  | 'actual_result_different'
  | 'operation_uncertain'
  | 'finished_as_compromise'
  | 'secured_weapon'
  | 'skipped_candidate'
export const currentExecutionActions = [
  'confirmed_expected',
  'actual_result_different',
  'operation_uncertain',
  'finished_as_compromise',
] as const satisfies readonly ExecutionAction[]
export const legacyExecutionActions = [
  'secured_weapon',
  'skipped_candidate',
] as const satisfies readonly ExecutionAction[]
export type RecalculationReason =
  | 'rng_state_changed'
  | 'normal_counter_changed'
  | 'target_changed'
  | 'build_list_changed'
  | 'owned_weapon_changed'
  | 'calculation_context_changed'
  | 'unexpected_result'
  /** The user recorded that what or how many operations were performed is unknown (16.15). */
  | 'execution_operation_uncertain'
  | 'planned_candidate_not_secured'
  | 'different_candidate_secured'
  | 'manual_recalculate'
export type ConflictKind =
  | 'same_gogma_counter'
  | 'same_skill_counter'
  | 'same_normal_counter'
  | 'same_owned_weapon_consumed'

export interface KnownValue<T> {
  value: T | null
  isConfirmed: boolean
  source: RngStateSource | null
}

// Application calculation semantics, independent of Dexie and AppSettings schemas.
// Version 2 invalidates pre-B5-F1 scope-blind Candidate Search results.
// Version 3 invalidates ProductionPlans created before physical operation
// subjects became part of transient Gogma action-sharing identity.
// Version 4 invalidates ProductionPlans created before a Route prefix another
// Entry's real operation already passed could be fast-forwarded: those Plans can
// hold shared Counter positions as conflicts and Entries rejected as
// counter_before_current that the current calculation would neither report nor
// reject.
// Version 5 invalidates ProductionPlans created before a partial result of a
// search a PlannerOptions bound truncated stopped being accepted as an
// executable ProductionPlan. Such a Plan was persistable as an ordinary Draft
// under version 4, a persisted Plan records no PlannerSearchTermination, and
// ProductionPlan compatibility is exact four-field equality, so a version 4
// Plan cannot be told apart from a complete one and is failed closed as a
// whole.
// Version 2, 3 and 4 BuildCandidate / BuildListEntry results remain explicitly
// compatible, because Search and snapshot semantics are unchanged.
// Version 6 changes Target compromise semantics, Candidate acceptance and Search
// termination. All version 1..5 Candidates, Build List snapshots and Plans are
// incompatible. The historical 2..5 build-result exception does not extend to 6.
// Version 7 makes protection cover every OwnedWeapon performance mutation,
// including Reset Skills, adds the zero-operation existing-Gogma Candidate,
// and changes new Practical protection defaults. All version 1..6 calculation
// artifacts are incompatible with these Search and Planner semantics.
// Dexie schema 2 migrates Targets separately; RNG semantics remain unchanged.
// Version 8 replaces `OwnedWeapon.relatedTargetWeaponIds` with the Target-side
// `preferredOwnedWeaponId`. That changes Target definition semantics, the
// same-cost Route selection of Candidate Search, and Planner Plan preference,
// so all version 1..7 Candidates, Build List snapshots and Plans are
// incompatible and fail closed. The historical 2..5 build-result exception is
// not extended to version 8. Dexie schema 3 migrates the persisted shape
// separately; RNG semantics remain unchanged.
// Version 9 removes the "consume an owned Gogma Artian weapon as material"
// Domain model entirely and reduces `OwnedWeapon.status` to a user-facing
// organisation label. That changes the active RouteOperation set
// (`use_weapon_as_material` no longer exists), Planner inventory semantics,
// Planner scoring, the PlanStep operation set, and the OwnedWeapon semantic
// hash contract, so all version 1..8 Candidates, Build List snapshots and Plans
// are incompatible and fail closed with `calculation_context_changed`. The
// historical 2..5 build-result exception is not extended to version 9. Dexie
// schema 4 migrates the persisted `material` status separately; RNG semantics
// remain unchanged. Game item materials (`MaterialRequirement`) are a different
// concept and are untouched.
// Version 10 replaces the independent Practical / Alternative BuildCandidate
// with the canonical Ideal Route plus selectable compromise checkpoints. A
// Candidate no longer carries a category, a condition match, or any similarity
// metadata; a Search result is at most one canonical Ideal per Target; a
// BuildListEntry additionally carries the user's selected checkpoint
// opportunities as a hard Planner constraint; and Planner scoring, PlanStep
// milestone metadata and `ExpectedResult` change with it. So all version 1..9
// Candidates, Build List snapshots and Plans are incompatible and fail closed
// with `calculation_context_changed`. The historical 2..5 build-result
// exception is not extended to version 10. No Dexie table shape changed, so
// `DATABASE_SCHEMA_VERSION` stays 4; the Export current shape does change, so
// `ExportRoot.schemaVersion` moves to 5. RNG semantics remain unchanged.
// Version 11 replaces the strict-prefix compromise checkpoint of one fixed
// operation sequence with axis-separated intermediate states: a Candidate
// carries the accepted states of its Skill lane and of its Bonus lane
// (`intermediateStateGroups`), a BuildListEntry carries at most one selected
// state per lane plus an improvement preference, and the Planner executes each
// Route as interleavable Skill / Bonus lanes whose selected states pin the
// compromise checkpoint. A version 10 `checkpointGroups` /
// `selectedCheckpointOpportunityIds` pair names strict-prefix operation
// indexes that no lane pin can be derived from, and reading it as "no
// selection" would silently drop a hard constraint, so all version 1..10
// Candidates, Build List snapshots and Plans are incompatible and fail closed
// with `calculation_context_changed`. No Dexie table shape changed, so
// `DATABASE_SCHEMA_VERSION` stays 4; the persisted entity shape does change, so
// `ExportRoot.schemaVersion` moves to 6. RNG semantics remain unchanged.
// The Execution lifecycle persistence foundation (Target lifecycle,
// `OwnedWeapon.executionInProgress`, `ExecutionSavePoint`) moves Dexie to 5 and
// `ExportRoot.schemaVersion` to 7 but deliberately stays at 11: its defaults
// change no calculation meaning, and the Target definition hash, planning-input
// hashes, expected execution state, PlanStep effects and reserve semantics are
// switched together, with their own version boundary, by a later PR.
// Version 12 switches the Execution lifecycle calculation contract
// (`docs/PLANNER_SPEC.md` 16): `createTargetDefinitionHash()` covers the Target
// performance definition only (priority, isEnabled, preferredOwnedWeaponId and
// lifecycle leave it), `PlanningInputSnapshot.targetWeaponsHash` becomes its own
// planning-input normalization and gains the Plan-dependent Target / Entry
// hashes, `ExpectedPlanState` gains the Plan-dependent Target execution state,
// every PlanStep carries `executionEffects` (tracked OwnedWeapon, Normal creation
// role, registration, observation binding, Target link, compromise label and
// Target completion), the independent `reserve_weapon` Step leaves the current
// Plan (completion rides on the last physical Step, and a zero-operation Ideal
// becomes `confirm_owned_ideal`), an owned Normal's conversion keeps its
// OwnedWeapon ID, a blind production-target Normal is bound to the user's
// observation instead of a prediction, and Ideal completion protects existing
// weapons too. A version 11 Plan's Steps, expected states and reserve Steps
// cannot be mapped onto that contract without guessing, and a version 11
// Candidate / Build List Entry carries a Target definition hash of the old
// normalization, so all version 1..11 Candidates, Build List snapshots and Plans
// are incompatible and fail closed with `calculation_context_changed`; none is
// migrated. No Dexie table or index changes, so `DATABASE_SCHEMA_VERSION` stays
// 5; the persisted ProductionPlan shape does change, so `ExportRoot.schemaVersion`
// moves to 8. RNG semantics remain unchanged.
//
// Version 13 moves the Target link of every Entry that starts from an existing
// OwnedWeapon from the Entry's first physical Step to the Plan start effect
// (`docs/PLANNER_SPEC.md` 16.2 / 16.11): Draft generation still changes nothing
// persisted, `draft -> active` applies those links in the same transaction, and
// `PlanningInputSnapshot.initialExecutionState` becomes the pre-start premise
// while the first Step's `expectedStateBefore` is the state after the start
// effect. Only a registered production-target Normal is still linked by a Step.
// A version 12 Plan expects those links on its Steps, and executing it under
// the new start would disagree with its own expected states, so every version
// 1..12 Plan fails closed with `calculation_context_changed`. Candidate Search
// and Build List snapshot semantics do not change, so an explicit build-result
// exception (`isBuildResultCalculationContextCompatible()`) keeps version 12
// Candidates and Build List Entries usable under 13; version 1..11 stay
// incompatible. No persisted shape changes,
// so `DATABASE_SCHEMA_VERSION` stays 6 and `ExportRoot.schemaVersion` stays 9.
export const CURRENT_CALCULATION_APP_SCHEMA_VERSION = 13

export interface CalculationContext {
  gameVersion: string
  masterDataVersion: number
  rngEngineVersion: string
  appSchemaVersion: number
}

export interface RestorationBonus {
  bonusTypeId: BonusTypeId
  bonusRankId: BonusRankId
}

export type RestorationBonusSet = [
  RestorationBonus,
  RestorationBonus,
  RestorationBonus,
  RestorationBonus,
  RestorationBonus,
]

export interface RngState {
  id: 'current'
  schemaVersion: 1
  baseSeed: KnownValue<string>
  gogmaCounter: KnownValue<number>
  skillCounter: KnownValue<number>
  counterGate: KnownValue<number>
  notes: string | null
  createdAt: ISODateTimeString
  updatedAt: ISODateTimeString
}

export interface NormalArtianCounter {
  id: string
  weaponTypeId: WeaponTypeId
  rarity: NormalArtianRarity
  counter: number | null
  isConfirmed: boolean
  observationCount: number
  lastObservedAt: ISODateTimeString | null
  candidateCount: number | null
  createdAt: ISODateTimeString
  updatedAt: ISODateTimeString
}

export interface AppSettings {
  id: 'settings'
  schemaVersion: 1
  debugMode: boolean
  resultPageSize: number
  defaultSearchLimit: number
  createdAt: ISODateTimeString
  updatedAt: ISODateTimeString
}
