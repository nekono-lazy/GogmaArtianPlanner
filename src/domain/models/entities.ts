import type {
  BonusRankId,
  BonusTypeId,
  BuildCandidateId,
  BuildListEntryId,
  CalculationContext,
  CandidateCategory,
  ElementId,
  GroupSkillId,
  ISODateTimeString,
  MaterialId,
  NormalArtianRarity,
  OwnedWeaponId,
  OwnedWeaponStatus,
  RestorationBonus,
  RestorationBonusSet,
  RouteKind,
  SeriesSkillId,
  SkillMatchMode,
  TargetWeaponId,
  WeaponTypeId,
} from './common'

export interface OwnedWeapon {
  id: OwnedWeaponId
  name: string
  weaponTypeId: WeaponTypeId
  elementId: ElementId
  restorationBonuses: RestorationBonusSet
  seriesSkillId: SeriesSkillId | null
  groupSkillId: GroupSkillId | null
  status: OwnedWeaponStatus
  isProtected: boolean
  relatedTargetWeaponIds: TargetWeaponId[]
  memo: string | null
  createdAt: ISODateTimeString
  updatedAt: ISODateTimeString
}

export interface TargetWeapon {
  id: TargetWeaponId
  name: string
  weaponTypeId: WeaponTypeId
  elementId: ElementId
  priority: 1 | 2 | 3 | 4 | 5
  isEnabled: boolean
  idealBonuses: RestorationBonusSet
  practicalBonusConditions: BonusCondition[]
  practicalAlternativeGroups: AlternativeBonusConditionGroup[]
  idealSkillCondition: SkillCondition
  practicalSkillCondition: SkillCondition
  memo: string | null
  createdAt: ISODateTimeString
  updatedAt: ISODateTimeString
}

export interface BonusCondition {
  id: string
  bonusTypeId: BonusTypeId
  minimumRankId: BonusRankId
  requiredCount: number
  requiredExCount: number
}

export interface AlternativeBonusConditionGroup {
  id: string
  requiredCount: number
  options: AlternativeBonusOption[]
}

export interface AlternativeBonusOption {
  bonusTypeId: BonusTypeId
  minimumRankId: BonusRankId
}

export interface SkillCondition {
  seriesSkillId: SeriesSkillId | null
  groupSkillId: GroupSkillId | null
  matchMode: SkillMatchMode
}

export interface BuildCandidate {
  id: BuildCandidateId
  targetWeaponId: TargetWeaponId
  category: CandidateCategory
  finalBonuses: RestorationBonusSet
  seriesSkillId: SeriesSkillId | null
  groupSkillId: GroupSkillId | null
  route: BuildRoute
  estimatedOperationCount: number
  estimatedGogmaAdvance: number
  estimatedSkillAdvance: number
  estimatedNormalAdvance: number | null
  requiredMaterials: MaterialRequirement[]
  idealDifference: IdealDifference
  isSimilarToIdeal: boolean
  similarityScore: number | null
  searchStateHash: string
  referencedOwnedWeaponsHash: string | null
  calculationContext: CalculationContext
  searchRunId: string
  createdAt: ISODateTimeString
}

export interface BuildRoute {
  kind: RouteKind
  operations: RouteOperation[]
  sourceOwnedWeaponId: OwnedWeaponId | null
}

export type RouteOperation =
  | CreateNormalArtianOperation
  | ConvertToGogmaOperation
  | ResetBonusesOperation
  | KeepBonusesOperation
  | ResetSkillsOperation
  | UseWeaponAsMaterialOperation

export interface CreateNormalArtianOperation {
  type: 'create_normal_artian'
  weaponTypeId: WeaponTypeId
  rarity: NormalArtianRarity
  count: number
  normalCounterBefore: number
  normalCounterAfter: number
}

export interface ConvertToGogmaOperation {
  type: 'convert_normal_to_gogma'
  weaponTypeId: WeaponTypeId
  gogmaCounterBefore: number
  gogmaCounterAfter: number
}

export interface ResetBonusesOperation {
  type: 'reset_bonuses'
  sourceOwnedWeaponId: OwnedWeaponId
  gogmaCounterBefore: number
  gogmaCounterAfter: number
}

type EngineParameters = Readonly<Record<string, string | number | boolean>>

export type KeepBonusSelection =
  | {
      mode: 'slot_indices'
      keptSlotIndices: number[]
      engineParameters: EngineParameters
    }
  | {
      mode: 'bonus_types'
      keptBonusTypeIds: BonusTypeId[]
      engineParameters: EngineParameters
    }
  | {
      mode: 'engine_defined'
      engineParameters: EngineParameters
    }

export interface KeepBonusesOperation {
  type: 'keep_bonuses'
  sourceOwnedWeaponId: OwnedWeaponId
  selection: KeepBonusSelection
  gogmaCounterBefore: number
  gogmaCounterAfter: number
}

export interface ResetSkillsOperation {
  type: 'reset_skills'
  sourceOwnedWeaponId: OwnedWeaponId | null
  skillCounterBefore: number
  skillCounterAfter: number
}

export interface UseWeaponAsMaterialOperation {
  type: 'use_weapon_as_material'
  ownedWeaponId: OwnedWeaponId
}

export interface IdealDifference {
  missingBonuses: RestorationBonus[]
  extraBonuses: RestorationBonus[]
  matchedBonusCount: number
  seriesSkillMatches: boolean
  groupSkillMatches: boolean
  summary: string
}

export type BuildListEntryStaleReason =
  | 'target_definition_changed'
  | 'rng_state_changed'
  | 'owned_weapon_changed'
  | 'calculation_context_changed'

export interface BuildListEntry {
  id: BuildListEntryId
  candidateId: BuildCandidateId
  targetWeaponId: TargetWeaponId
  candidateSnapshot: BuildCandidate
  targetDefinitionHash: string
  searchStateHash: string
  referencedOwnedWeaponsHash: string | null
  calculationContext: CalculationContext
  isStale: boolean
  staleReasons: BuildListEntryStaleReason[]
  createdAt: ISODateTimeString
}

export interface MaterialRequirement {
  materialId: MaterialId
  quantity: number
}

export interface RngCapabilities {
  canPredictGogma: boolean
  canPredictSkills: boolean
  canSearchSeed: boolean
  canSearchNormalArtian: boolean
  normalArtianSearchableCounterIds: string[]
  canRunPlanner: boolean
  missingRequirements: string[]
}
