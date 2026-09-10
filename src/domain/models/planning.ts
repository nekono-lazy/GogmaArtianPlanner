import type {
  BuildCandidateId,
  BuildListEntryId,
  CalculationContext,
  CandidateCategory,
  ConflictKind,
  ExecutionAction,
  ExecutionHistoryId,
  GroupSkillId,
  ISODateTimeString,
  NormalArtianCounter,
  OwnedWeaponId,
  PlanStepId,
  PlanStepOperationType,
  ProductionPlanId,
  ProductionPlanStatus,
  RecalculationReason,
  RestorationBonusSet,
  RestorationBonusScope,
  RngState,
  SeriesSkillId,
  TargetWeaponId,
} from './common'
import type {
  MaterialRequirement,
  OwnedWeapon,
} from './entities'

export interface ProductionPlan {
  id: ProductionPlanId
  status: ProductionPlanStatus
  baseSnapshot: PlanningInputSnapshot
  selectedBuildListEntryIds: BuildListEntryId[]
  calculationContext: CalculationContext
  steps: PlanStep[]
  conflicts: PlanConflict[]
  rejectedBuildListEntries: RejectedBuildListEntry[]
  requiredMaterials: MaterialRequirement[]
  currentStepId: PlanStepId | null
  recalculationReasons: RecalculationReason[]
  createdAt: ISODateTimeString
  updatedAt: ISODateTimeString
}

export interface PlanningInputSnapshot {
  initialExecutionState: ExpectedPlanState
  targetWeaponsHash: string
  buildListEntriesHash: string
  calculationContext: CalculationContext
  createdAt: ISODateTimeString
}

export interface ExpectedPlanState {
  rngStateHash: string
  normalCountersHash: string
  ownedWeaponsHash: string
}

export interface PlanStep {
  id: PlanStepId
  order: number
  operationType: PlanStepOperationType
  title: string
  instruction: string
  targetWeaponId: TargetWeaponId | null
  buildListEntryId: BuildListEntryId | null
  /**
   * Observational metadata: every TargetWeapon whose Route this one physical
   * Step advanced. It never replaces the primary `targetWeaponId` /
   * `buildListEntryId` presentation authority, and `undefined` means the Plan
   * predates the field, so its shared attribution must not be inferred.
   */
  progressedTargetWeaponIds?: TargetWeaponId[]
  candidateId: BuildCandidateId | null
  ownedWeaponId: OwnedWeaponId | null
  expectedResult: ExpectedResult | null
  expectedStateBefore: ExpectedPlanState
  expectedStateAfter: ExpectedPlanState
  inventoryChange: InventoryChange | null
  rngAdvance: RngAdvance
  requiresUserConfirmation: boolean
  isCompleted: boolean
  completedAt: ISODateTimeString | null
  debug: PlanStepDebugInfo | null
}

export interface ExpectedResult {
  restorationBonuses: RestorationBonusSet | null
  restorationBonusScope: RestorationBonusScope | null
  seriesSkillId: SeriesSkillId | null
  groupSkillId: GroupSkillId | null
  candidateCategory: CandidateCategory | null
  isSimilarToIdeal: boolean
  shouldSecure: boolean
}

export interface InventoryChange {
  addOwnedWeapon: OwnedWeapon | null
  removeOwnedWeaponIds: OwnedWeaponId[]
  updateOwnedWeapons: OwnedWeapon[]
  materialRequirements: MaterialRequirement[]
}

export interface RngAdvance {
  gogmaCounterDelta: number
  skillCounterDelta: number
  normalCounterDelta: number | null
  affectedNormalCounterId: string | null
}

export interface PlanStepDebugInfo {
  startBaseSeed: string | null
  startGogmaCounter: number | null
  endGogmaCounter: number | null
  startSkillCounter: number | null
  endSkillCounter: number | null
  startNormalCounter: number | null
  endNormalCounter: number | null
  plannerReason: string
}

export interface PlanConflict {
  id: string
  kind: ConflictKind
  buildListEntryIds: BuildListEntryId[]
  reason: string
  recommendedBuildListEntryId: BuildListEntryId | null
  selectedBuildListEntryId: BuildListEntryId | null
  resolutionNote: string | null
}

export interface RejectedBuildListEntry {
  buildListEntryId: BuildListEntryId
  reason:
    | 'lower_priority'
    | 'resource_conflict'
    | 'longer_route'
    | 'already_satisfied'
    | 'requires_protected_weapon'
    | 'dominated_by_better_candidate'
  detail: string
}

export interface ExecutionHistory {
  id: ExecutionHistoryId
  planId: ProductionPlanId
  planStepId: PlanStepId
  action: ExecutionAction
  actualResult: ActualResult | null
  wasExpected: boolean
  recalculationReason: RecalculationReason | null
  undoSnapshot: ExecutionUndoSnapshot
  createdAt: ISODateTimeString
}

export interface ActualResult {
  restorationBonuses: RestorationBonusSet | null
  restorationBonusScope: RestorationBonusScope | null
  seriesSkillId: SeriesSkillId | null
  groupSkillId: GroupSkillId | null
  securedOwnedWeaponId: OwnedWeaponId | null
  note: string | null
}

export interface ExecutionUndoSnapshot {
  rngStateBefore: RngState
  normalCountersBefore: NormalArtianCounter[]
  affectedOwnedWeaponsBefore: OwnedWeapon[]
  addedOwnedWeaponIds: OwnedWeaponId[]
  removedOwnedWeaponsBefore: OwnedWeapon[]
  /** Undo restores this snapshot verbatim; it must not infer new stale reasons. */
  productionPlanBefore: ProductionPlan
}
