export type Brand<T, B extends string> = T & { readonly __brand: B }

export type OwnedWeaponId = Brand<string, 'OwnedWeaponId'>
export type TargetWeaponId = Brand<string, 'TargetWeaponId'>
export type BuildCandidateId = Brand<string, 'BuildCandidateId'>
export type BuildListEntryId = Brand<string, 'BuildListEntryId'>
export type ProductionPlanId = Brand<string, 'ProductionPlanId'>
export type PlanStepId = Brand<string, 'PlanStepId'>
export type ExecutionHistoryId = Brand<string, 'ExecutionHistoryId'>

export type ISODateTimeString = string
export type WeaponTypeId = string
export type ElementId = string
export type BonusTypeId = string
export type BonusRankId = string
export type SeriesSkillId = string
export type GroupSkillId = string
export type MaterialId = string

export type RngStateSource =
  | 'gogma_seed_finder_import'
  | 'manual'
  | 'observation'

export const V1_NORMAL_ARTIAN_RARITY = 8 as const
export type NormalArtianRarity = typeof V1_NORMAL_ARTIAN_RARITY
export type ArtianWeaponKind = 'normal' | 'gogma'
export type RestorationBonusScope = 'normal_artian' | 'gogma_artian'
export type OwnedWeaponStatus = 'material' | 'practical' | 'ideal'
export type CandidateCategory = 'ideal' | 'practical'
export type RouteKind =
  | 'normal_artian_to_gogma'
  | 'owned_normal_artian_to_gogma'
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
export type PlanStepOperationType =
  | 'create_normal_artian'
  | 'convert_normal_to_gogma'
  | 'create_material_gogma'
  | 'reset_bonuses'
  | 'keep_bonuses'
  | 'reset_skills'
  | 'reserve_weapon'
  | 'use_weapon_as_material'
  | 'change_owned_weapon_status'
  | 'confirm_result'
export type ExecutionAction =
  | 'confirmed_expected'
  | 'secured_weapon'
  | 'confirmed_weapon_status_change'
  | 'declined_weapon_status_change'
  | 'actual_result_different'
  | 'skipped_candidate'
export type RecalculationReason =
  | 'rng_state_changed'
  | 'normal_counter_changed'
  | 'target_changed'
  | 'build_list_changed'
  | 'owned_weapon_changed'
  | 'calculation_context_changed'
  | 'unexpected_result'
  | 'planned_candidate_not_secured'
  | 'different_candidate_secured'
  | 'planned_status_change_declined'
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
export const CURRENT_CALCULATION_APP_SCHEMA_VERSION = 5

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
