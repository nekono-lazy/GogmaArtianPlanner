import type {
  ArtianWeaponKind,
  BonusRankId,
  BonusTypeId,
  BuildCandidateId,
  BuildListEntryId,
  CalculationContext,
  CompromiseCheckpointGroupId,
  CompromiseCheckpointOpportunityId,
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
  /**
   * The owned weapon this Target prefers as the starting point of its Route.
   *
   * A soft planning preference, never a hard Route constraint: Search still
   * explores every executable Route, and a shorter or otherwise better one wins
   * (`docs/SEARCH_SPEC.md` 8.1, `docs/PLANNER_SPEC.md` 7.4). The relation is an
   * optional 1:1 - a Target names at most one weapon, and one weapon is the
   * preferred origin of at most one Target - and it never restricts Target
   * Satisfaction, which stays a judgment about actual weapon performance.
   */
  preferredOwnedWeaponId: OwnedWeaponId | null
  idealBonuses: RestorationBonusSet
  practicalBonusConditions: PracticalBonusCondition[]
  alternativeBonusRules: AlternativeBonusRule[]
  /** Legacy compromise conditions were cleared; cleared after explicit save. */
  compromiseNeedsReview?: boolean
  idealSkillCondition: SkillCondition
  practicalSkillCondition: SkillCondition
  memo: string | null
  createdAt: ISODateTimeString
  updatedAt: ISODateTimeString
}

export interface PracticalBonusCondition {
  id: string
  bonusTypeId: BonusTypeId
  minimumRankId: BonusRankId
  requiredExCount: number
}

export interface AlternativeBonusRule {
  id: string
  sourceBonusTypeId: BonusTypeId
  maxReplacementCount: number
  options: AlternativeBonusOption[]
}

export interface AlternativeBonusOption {
  alternativeBonusTypeId: BonusTypeId
  minimumRankId: BonusRankId
  requiredExCount: number
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

/**
 * The predicted Series / Group Skills produced by one Reset Skills operation.
 *
 * The Skill counterpart of `BonusAmendmentResult`, and purely observational for
 * the same reason: it explains a Route that is already decided, so it never
 * participates in Candidate semantic identity, hashing, ordering, retention, or
 * deduplication. `null` keeps its ordinary meaning of "no skill".
 */
export interface SkillAmendmentResult {
  seriesSkillId: SeriesSkillId | null
  groupSkillId: GroupSkillId | null
}

/**
 * One entry of `BuildCandidate.skillAmendmentTrace`.
 *
 * `operationIndex` is the position of the described operation inside
 * `BuildRoute.operations`, so a run of consecutive `reset_skills` operations can
 * never be shifted by one against its predicted result.
 */
export interface CandidateSkillAmendmentStep extends SkillAmendmentResult {
  operationIndex: number
  operationType: 'reset_skills'
}

/**
 * `BuildCandidate.conversionSkillTrace`: the initial Series / Group Skills that
 * `convert_normal_to_gogma` assigns.
 *
 * A separate observational contract from `skillAmendmentTrace`, which stays
 * Reset Skills only (`docs/SEARCH_SPEC.md` 5.5.2.1). It is singular because a
 * Route carries at most one conversion operation (SEARCH_SPEC 6.1 / 6.1.1 /
 * 6.2), and it is bound by `operationIndex` inside the finished
 * `BuildRoute.operations` for the same reason the other traces are.
 */
export interface CandidateConversionSkillStep extends SkillAmendmentResult {
  operationIndex: number
  operationType: 'convert_normal_to_gogma'
}

/**
 * Which Target condition one compromise checkpoint state satisfies.
 *
 * Purely explanatory: it is derived from the Target definition and the reached
 * performance state, so it is never a checkpoint group's identity authority,
 * never a Candidate identity input, and never a Planner decision input
 * (`docs/SEARCH_SPEC.md` 5.8.2).
 */
export interface CompromiseConditionMatch {
  bonus: 'ideal' | 'practical' | 'alternative'
  skill: 'ideal' | 'practical'
}

/**
 * One position on the canonical Ideal Route at which a checkpoint group's
 * exact weapon state is reached (`docs/SEARCH_SPEC.md` 5.8.3).
 *
 * The ordered five slots are kept here, not on the group: two Route positions
 * reaching the same unordered multiset are the same user-visible compromise
 * product but different Route states, and Planner / Trace Replay must use the
 * exact ordered state.
 */
export interface CompromiseCheckpointOpportunity {
  id: CompromiseCheckpointOpportunityId
  /**
   * Index inside `BuildRoute.operations` of the last operation of the strict
   * prefix that reaches this state. The prefix is `operations[0 ..
   * afterOperationIndex]`, and it is always strict: the Ideal-completing final
   * operation is never a checkpoint.
   */
  afterOperationIndex: number
  /** Operation units executed up to and including `afterOperationIndex`. */
  operationCount: number
  /** Operation units still remaining until the Ideal result is reached. */
  remainingOperationCount: number
  /** The exact ordered five slots at this Route position. */
  restorationBonuses: RestorationBonusSet
  restorationBonusScope: RestorationBonusScope
  seriesSkillId: SeriesSkillId | null
  groupSkillId: GroupSkillId | null
  conditionMatch: CompromiseConditionMatch
}

/**
 * One user-visible compromise product reachable on the canonical Ideal Route.
 *
 * Group identity is the performance state a player would recognise: scope, the
 * unordered five-slot multiset with duplicate counts preserved, and the two
 * Skills. Slot order is deliberately excluded here and preserved per
 * opportunity instead (`docs/SEARCH_SPEC.md` 5.8.2).
 */
export interface CompromiseCheckpointGroup {
  id: CompromiseCheckpointGroupId
  restorationBonusScope: RestorationBonusScope
  /** Representative ordered slots, taken from the earliest opportunity. */
  restorationBonuses: RestorationBonusSet
  seriesSkillId: SeriesSkillId | null
  groupSkillId: GroupSkillId | null
  /** Explanatory only; derived from the Target and this state. */
  conditionMatch: CompromiseConditionMatch
  /** Ascending by `afterOperationIndex`; never empty, never deduplicated. */
  opportunities: CompromiseCheckpointOpportunity[]
  /**
   * Display organisation only (`docs/SEARCH_SPEC.md` 5.8.4).
   *
   * `true` means another retained group is conservatively, obviously better.
   * It is never a Domain dominance: the group and every one of its
   * opportunities stay available to the user and to the Planner, because a
   * "worse" checkpoint can be the only one that avoids a Counter conflict.
   */
  isDisplaySecondary: boolean
  dominatingGroupId: CompromiseCheckpointGroupId | null
}

export interface BuildCandidate {
  id: BuildCandidateId
  targetWeaponId: TargetWeaponId
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
  /**
   * The compromise checkpoints reachable on this Candidate's own Route.
   *
   * Derived from the finished Route and the Target definition, so it changes
   * no Candidate semantic identity: it never enters the Candidate ID
   * `semanticHash`, `candidateStableKey`, the deduplication key, the
   * `BuildCandidateMeaning` fingerprint, `searchStateHash`, or
   * `referencedOwnedWeaponsHash`, and checkpoint availability never influences
   * canonical Ideal selection (`docs/SEARCH_SPEC.md` 5.8.6).
   *
   * Optional so a Candidate persisted before this field existed still loads
   * and renders. Every Candidate generated under the current
   * `CalculationContext` carries it, and validation requires it there.
   */
  checkpointGroups?: CompromiseCheckpointGroup[]
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
  /**
   * Observational per-Reset-Skills expected results, in execution order.
   *
   * Optional for the same reason as `bonusAmendmentTrace`: Candidates persisted
   * before this field existed stay valid and never become stale, because the
   * field explains an already decided Route and changes no calculation meaning.
   * `seriesSkillId` / `groupSkillId` remain the authority for the Route's final
   * Skills. UI omits the prediction display when the field is absent.
   */
  skillAmendmentTrace?: CandidateSkillAmendmentStep[]
  /**
   * Observational initial Skill assignment of this Route's conversion.
   *
   * Present only for a Route containing `convert_normal_to_gogma`, and optional
   * for the same reason as the two amendment traces: it explains an already
   * decided Route, so a Candidate persisted before this field existed stays
   * valid and never becomes stale. `seriesSkillId` / `groupSkillId` remain the
   * authority for the Route's final Skills, which a later `reset_skills`
   * overwrites. UI omits the prediction display when the field is absent.
   */
  conversionSkillTrace?: CandidateConversionSkillStep
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
  /**
   * The checkpoint opportunities the user chose to use, as a hard Planner
   * constraint (`docs/PLANNER_SPEC.md` 7.5).
   *
   * Every id must exist in `candidateSnapshot.checkpointGroups`, and at most
   * one id per group may be selected. It is the user's Planner input, not part
   * of the Candidate's own meaning, so it never participates in
   * `createBuildCandidateMeaningFingerprint()` and changing it alone never
   * makes this entry stale - but it does change what the Planner must achieve,
   * so it participates in the Plan's build-list semantic hash.
   *
   * Optional so a BuildListEntry persisted before this field existed still
   * loads and renders; absent means no checkpoint is selected.
   */
  selectedCheckpointOpportunityIds?: CompromiseCheckpointOpportunityId[]
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
