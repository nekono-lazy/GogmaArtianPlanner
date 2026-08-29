import type {
  BuildListEntry,
  BuildListEntryId,
  CalculationContext,
  ISODateTimeString,
  NormalArtianCounter,
  OwnedWeapon,
  OwnedWeaponId,
  PlanConflict,
  PlanStepId,
  ProductionPlan,
  ProductionPlanId,
  RngState,
  TargetWeapon,
} from '../models/publicTypes'
import type {
  BonusRankMaster,
  MaterialCostMaster,
} from '../master/masterTypes'
import type { RngEngine } from '../rng/rngEngine'

export interface PlannerOptions {
  maxPlanSteps: number
  beamWidth: number
  maxExpandedStates: number
}

export const defaultPlannerOptions: Readonly<PlannerOptions> = {
  maxPlanSteps: 300,
  beamWidth: 50,
  maxExpandedStates: 10_000,
}

export interface PlannerMasterSubset {
  materialCosts: MaterialCostMaster[]
  bonusRanks: BonusRankMaster[]
}

/** A local choice for one stable conflict key, not a manual Plan order. */
export interface PlannerConflictResolution {
  conflictKey: string
  selectedBuildListEntryId: BuildListEntryId
}

/**
 * A Planner-created need for a consumable Gogma weapon. It deliberately carries
 * no guessed weapon type, element, bonus, or material-cost constraint.
 */
export interface PlannerMaterialRequirement {
  id: string
  sourceBuildListEntryId: BuildListEntryId | null
  purpose: 'gogma_rng_progression'
}

export interface PlannerMaterialAssignment {
  requirementId: string
  ownedWeaponId: OwnedWeaponId
}

/** Structured-clone input. Engine instances and runtime dependencies are excluded. */
export interface PlannerInput {
  rngState: RngState
  normalCounters: NormalArtianCounter[]
  ownedWeapons: OwnedWeapon[]
  targetWeapons: TargetWeapon[]
  buildListEntries: BuildListEntry[]
  calculationContext: CalculationContext
  options: PlannerOptions
  master: PlannerMasterSubset
  conflictResolutions: PlannerConflictResolution[]
}

export type PlannerWarningKind =
  | 'no_build_list_entries'
  | 'rng_state_missing'
  | 'material_weapon_shortage'
  | 'protected_weapon_required'
  | 'build_list_entry_stale'
  | 'calculation_context_incompatible'
  | 'all_targets_already_satisfied'
  | 'invalid_conflict_resolution'
  | 'max_steps_reached'
  | 'max_expanded_states_reached'

export const plannerWarningKinds: readonly PlannerWarningKind[] = [
  'no_build_list_entries',
  'rng_state_missing',
  'material_weapon_shortage',
  'protected_weapon_required',
  'build_list_entry_stale',
  'calculation_context_incompatible',
  'all_targets_already_satisfied',
  'invalid_conflict_resolution',
  'max_steps_reached',
  'max_expanded_states_reached',
]

export interface PlannerWarning {
  kind: PlannerWarningKind
  message: string
}

export interface PlannerResult {
  plan: ProductionPlan | null
  conflicts: PlanConflict[]
  warnings: PlannerWarning[]
}

export interface PlannerIdFactory {
  productionPlanId(): ProductionPlanId
  planStepId(): PlanStepId
  ownedWeaponId(): OwnedWeaponId
}

export interface PlannerClock {
  now(): ISODateTimeString
}

/** Runtime-only dependencies. This type is never part of PlannerInput or persistence. */
export interface PlannerDependencies {
  rngEngine: RngEngine
  idFactory: PlannerIdFactory
  clock: PlannerClock
}

export interface PlannerProgress {
  expandedStates: number
  maxExpandedStates: number
}

export interface PlannerExecutionOptions {
  shouldCancel?: () => boolean
  onProgress?: (progress: PlannerProgress) => void
  yieldControl?: () => Promise<void>
}

export type CreateProductionPlanCalculation = (
  input: PlannerInput,
  dependencies: PlannerDependencies,
  options?: PlannerExecutionOptions,
) => Promise<PlannerResult>

export type PlannerWorkerRequest =
  | {
      type: 'create_plan'
      requestId: string
      input: PlannerInput
    }
  | {
      type: 'cancel'
      requestId: string
    }

export type PlannerWorkerResponse =
  | {
      type: 'create_plan_result'
      requestId: string
      result: PlannerResult
    }
  | {
      type: 'progress'
      requestId: string
      progress: PlannerProgress
    }
  | {
      type: 'error'
      requestId: string
      message: string
    }
