import type {
  ArtianWeaponKind,
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
  RestorationBonusScope,
  RouteKind,
  SeriesSkillId,
  SkillMatchMode,
  TargetWeaponId,
  WeaponTypeId,
} from './common'

export interface OwnedWeaponBase {
  id: OwnedWeaponId
  kind: ArtianWeaponKind
  name: string
  weaponTypeId: WeaponTypeId
  elementId: ElementId
  restorationBonuses: RestorationBonusSet
  /** All five stored slots belong to this family; mixed scope is invalid. */
  restorationBonusScope: RestorationBonusScope
  isProtected: boolean
  relatedTargetWeaponIds: TargetWeaponId[]
  memo: string | null
  createdAt: ISODateTimeString
  updatedAt: ISODateTimeString
}

export interface OwnedNormalArtianWeapon extends OwnedWeaponBase {
  kind: 'normal'
  rarity: NormalArtianRarity
  seriesSkillId: null
  groupSkillId: null
  status: null
}

export interface OwnedGogmaArtianWeapon extends OwnedWeaponBase {
  kind: 'gogma'
  seriesSkillId: SeriesSkillId | null
  groupSkillId: GroupSkillId | null
  status: OwnedWeaponStatus
}

export type OwnedWeapon = OwnedNormalArtianWeapon | OwnedGogmaArtianWeapon

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

/**
 * The predicted five slots produced by one Bonus amendment operation.
 *
 * Purely observational: it explains a Route that is already decided, so it
 * never participates in Candidate semantic identity, hashing, ordering, or
 * deduplication. The five slots keep their stored slot order because Keep
 * preserves the bonus family at each slot position.
 */
export interface BonusAmendmentResult {
  restorationBonuses: RestorationBonusSet
  restorationBonusScope: RestorationBonusScope
}

/**
 * One entry of `BuildCandidate.bonusAmendmentTrace`.
 *
 * `operationIndex` is the position of the described operation inside
 * `BuildRoute.operations`, so the association survives repeated identical
 * operation types.
 */
export interface CandidateBonusAmendmentStep extends BonusAmendmentResult {
  operationIndex: number
  operationType: 'reset_bonuses' | 'keep_bonuses'
}

export interface BuildCandidate {
  id: BuildCandidateId
  targetWeaponId: TargetWeaponId
  category: CandidateCategory
  finalBonuses: RestorationBonusSet
  restorationBonusScope: RestorationBonusScope
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
  /**
   * Observational per-amendment expected results, in execution order.
   *
   * Optional so Candidates persisted before this field existed stay valid and
   * never become stale: the field explains an already decided Route and changes
   * no calculation meaning. UI omits the prediction display when it is absent.
   */
  bonusAmendmentTrace?: CandidateBonusAmendmentStep[]
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

interface CreateNormalArtianOperationBase {
  type: 'create_normal_artian'
  weaponTypeId: WeaponTypeId
  rarity: NormalArtianRarity
}

/**
 * Normal Artian creation from a confirmed Normal Artian Counter.
 *
 * The absolute Counter positions are known, so the five restoration bonus
 * slots of every forged weapon are predictable and the Planner can check the
 * Counter precondition of each forge.
 */
export interface PredictedCreateNormalArtianOperation
  extends CreateNormalArtianOperationBase {
  count: number
  normalCounterBefore: number
  normalCounterAfter: number
}

/**
 * Normal Artian creation with no confirmed Normal Artian Counter
 * (`docs/SEARCH_SPEC.md` 6.1.1).
 *
 * The forged weapon's five slots are never read: the Route's first bonus
 * amendment is always `reset_bonuses`, which redraws all five slots from the
 * Gogma Counter position alone. Exactly one weapon is forged, because forging
 * more would only add operations and materials without changing the result.
 *
 * `null` means the absolute Normal Counter position is unknown, never that the
 * Counter does not advance. The game Counter does advance by one; the tool
 * simply holds no confirmed value to advance, so it stores none rather than
 * inventing one.
 */
export interface BlindCreateNormalArtianOperation
  extends CreateNormalArtianOperationBase {
  count: 1
  normalCounterBefore: null
  normalCounterAfter: null
}

export type CreateNormalArtianOperation =
  | PredictedCreateNormalArtianOperation
  | BlindCreateNormalArtianOperation

/**
 * Whether one `create_normal_artian` operation is the blind variant.
 *
 * The two variants are discriminated by the nullability of their Counter
 * positions, so an operation persisted before the blind variant existed keeps
 * its exact predicted meaning and stays valid.
 */
export function isBlindCreateNormalArtianOperation(
  operation: CreateNormalArtianOperation,
): operation is BlindCreateNormalArtianOperation {
  return operation.normalCounterBefore === null
}

export interface ConvertToGogmaOperation {
  type: 'convert_normal_to_gogma'
  weaponTypeId: WeaponTypeId
  skillCounterBefore: number
  skillCounterAfter: number
}

export interface ResetBonusesOperation {
  type: 'reset_bonuses'
  /** null denotes the transient Gogma created by this route. */
  sourceOwnedWeaponId: OwnedWeaponId | null
  gogmaCounterBefore: number
  gogmaCounterAfter: number
}

export interface KeepBonusesOperation {
  type: 'keep_bonuses'
  /** null denotes the transient Gogma created by this route. */
  sourceOwnedWeaponId: OwnedWeaponId | null
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
