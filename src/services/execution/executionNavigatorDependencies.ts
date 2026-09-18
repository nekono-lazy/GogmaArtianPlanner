import { appDatabase, type AppDatabase } from '../../db/AppDatabase'
import type { MasterDataRoot } from '../../domain/master/masterTypes'
import type {
  BuildListEntry,
  CalculationContext,
  OwnedWeapon,
  ProductionPlan,
  ProductionPlanId,
  TargetWeapon,
} from '../../domain/models/publicTypes'
import { createBuildListCalculationContext } from '../buildList/createBuildListCalculationContext'
import {
  createProductionPlanExecutionService,
  type ConfirmExpectedPlanStepRequest,
  type ConfirmExpectedPlanStepResult,
  type FinishProductionPlanAsCompromiseRequest,
  type FinishProductionPlanAsCompromiseResult,
  type ProductionPlanExecutionService,
} from './productionPlanExecutionService'

/**
 * The persisted state the Navigator displays. The Plan is the semantic
 * authority; the other collections only resolve names and the Entry
 * selections the compromise checkpoint projection reads.
 */
export interface ExecutionNavigatorSnapshot {
  plan: ProductionPlan
  ownedWeapons: OwnedWeapon[]
  targetWeapons: TargetWeapon[]
  buildListEntries: BuildListEntry[]
}

export interface ExecutionNavigatorPageDependencies {
  master: MasterDataRoot
  currentCalculationContext: CalculationContext
  /** The exact persisted Plan of the route and its display data; `null` when the Plan does not exist. */
  loadSnapshot(planId: ProductionPlanId): Promise<ExecutionNavigatorSnapshot | null>
  confirmExpectedPlanStep(request: ConfirmExpectedPlanStepRequest): Promise<ConfirmExpectedPlanStepResult>
  finishProductionPlanAsCompromise(
    request: FinishProductionPlanAsCompromiseRequest,
  ): Promise<FinishProductionPlanAsCompromiseResult>
}

export async function loadExecutionNavigatorSnapshot(
  database: AppDatabase,
  planId: ProductionPlanId,
): Promise<ExecutionNavigatorSnapshot | null> {
  const plan = await database.productionPlans.get(planId)
  if (!plan) return null
  const [ownedWeapons, targetWeapons, buildListEntries] = await Promise.all([
    database.ownedWeapons.toArray(),
    database.targetWeapons.toArray(),
    database.buildListEntries.toArray(),
  ])
  return { plan, ownedWeapons, targetWeapons, buildListEntries }
}

export function createExecutionNavigatorDependencies(
  master: MasterDataRoot,
  database: AppDatabase = appDatabase,
  service: ProductionPlanExecutionService = createProductionPlanExecutionService(master, database),
): ExecutionNavigatorPageDependencies {
  return {
    master,
    currentCalculationContext: createBuildListCalculationContext(master),
    loadSnapshot: (planId) => loadExecutionNavigatorSnapshot(database, planId),
    confirmExpectedPlanStep: (request) => service.confirmExpectedPlanStep(request),
    finishProductionPlanAsCompromise: (request) => service.finishProductionPlanAsCompromise(request),
  }
}
