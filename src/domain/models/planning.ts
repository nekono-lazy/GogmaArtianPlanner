import type {
  BuildCandidateId,
  BuildListEntryId,
  CalculationContext,
  CompromiseCheckpointGroupId,
  CompromiseCheckpointOpportunityId,
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
  /**
   * The selected compromise checkpoints this one physical Step reaches
   * (`docs/PLANNER_SPEC.md` 7.5.4).
   *
   * A checkpoint is never its own operation: it is milestone metadata on the
   * real Step that produces the state, so no `PlanStepOperationType` is added,
   * nothing is reserved, no OwnedWeapon is created, no status or protection
   * changes, and the Plan neither stops nor completes there. One shared
   * physical Step can reach several Entries' milestones at once.
   *
   * `undefined` means the Plan predates the field, which must not be read as
   * "this Step reaches no milestone".
   */
  checkpointMilestones?: PlanStepCheckpointMilestone[]
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

/**
 * One selected checkpoint reached by the Step carrying it.
 *
 * Typed metadata rather than a reused `ExpectedResult` category: the Step's
 * `ExpectedResult` keeps its own responsibility of describing the actual state
 * expected after the physical operation.
 */
export interface PlanStepCheckpointMilestone {
  buildListEntryId: BuildListEntryId
  targetWeaponId: TargetWeaponId
  checkpointGroupId: CompromiseCheckpointGroupId
  checkpointOpportunityId: CompromiseCheckpointOpportunityId
  /** Operation units still remaining until this Entry's Ideal result. */
  remainingOperationCount: number
}

/**
 * The actual weapon state expected after one physical operation.
 *
 * It carries no Candidate category and no similarity metadata: independent
 * Practical Candidates and the similarity concept no longer exist, and
 * checkpoint explanation belongs to `PlanStep.checkpointMilestones` instead
 * (`docs/PLANNER_SPEC.md` 7.5.4).
 */
export interface ExpectedResult {
  restorationBonuses: RestorationBonusSet | null
  restorationBonusScope: RestorationBonusScope | null
  seriesSkillId: SeriesSkillId | null
  groupSkillId: GroupSkillId | null
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

/**
 * One conflict participant whose competing unit is a selected checkpoint
 * endpoint (`docs/PLANNER_SPEC.md` 9.5).
 *
 * Typed metadata so the UI can say that resolving this conflict requires
 * changing a checkpoint selection in the Build List, instead of inferring it
 * from a message. It never enters `PlanConflict.id`, which keeps its existing
 * generation rule.
 */
export interface PlanConflictCheckpointParticipant {
  buildListEntryId: BuildListEntryId
  checkpointGroupId: CompromiseCheckpointGroupId
  checkpointOpportunityId: CompromiseCheckpointOpportunityId
}

export interface PlanConflict {
  id: string
  kind: ConflictKind
  buildListEntryIds: BuildListEntryId[]
  reason: string
  recommendedBuildListEntryId: BuildListEntryId | null
  selectedBuildListEntryId: BuildListEntryId | null
  resolutionNote: string | null
  /**
   * Participants whose competing unit is a selected checkpoint endpoint.
   *
   * Empty means no selected checkpoint is involved. `undefined` means the Plan
   * predates the field and carries no such judgement; it must not be read as
   * "no checkpoint is involved".
   */
  checkpointParticipants?: PlanConflictCheckpointParticipant[]
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
