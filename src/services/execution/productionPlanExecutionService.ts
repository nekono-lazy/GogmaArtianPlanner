import { appDatabase, type AppDatabase } from '../../db/AppDatabase'
import { RepositoryError } from '../../db/repositoryError'
import { validateOwnedWeaponMasterReferences } from '../../domain/artian/entityMasterValidation'
import {
  ExecutionRuntimeError,
  executionFailure,
  prepareExpectedStepConfirmation,
  prepareProductionPlanStart,
  type ExecutionCounterAuthority,
  type ExecutionNormalRestorationBonusObservation,
  type ExecutionPersistedState,
  type ExpectedStepConfirmation,
} from '../../domain/execution'
import type { MasterDataRoot } from '../../domain/master/masterTypes'
import type {
  CalculationContext,
  ExecutionHistory,
  ExecutionHistoryId,
  ISODateTimeString,
  OwnedWeapon,
  PlanStepId,
  ProductionPlan,
  ProductionPlanId,
} from '../../domain/models/publicTypes'
import { executionSavePointIdForPlan } from '../../domain/models/publicTypes'
import { productionRngEngine } from '../../domain/rng/production/productionRngRuntime'
import { createBuildListCalculationContext } from '../buildList/createBuildListCalculationContext'

/** Runtime ID source of ExecutionHistory records. */
export interface ExecutionIdFactory {
  executionHistoryId(): ExecutionHistoryId
}

/** Runtime UTC clock of Execution writes. */
export interface ExecutionClock {
  now(): ISODateTimeString
}

export interface ProductionPlanExecutionServiceDependencies {
  database: AppDatabase
  currentCalculationContext: CalculationContext
  counterAuthority: ExecutionCounterAuthority
  validateObservedWeapon: (weapon: OwnedWeapon) => readonly string[]
  idFactory: ExecutionIdFactory
  clock: ExecutionClock
}

export interface ConfirmExpectedPlanStepRequest {
  planId: ProductionPlanId
  planStepId: PlanStepId
  /** The observed five slots; required exactly for a blind production-target Normal Step. */
  observation?: ExecutionNormalRestorationBonusObservation | null
}

export interface ConfirmExpectedPlanStepResult {
  plan: ProductionPlan
  history: ExecutionHistory
}

/**
 * The Execution runtime of a calculation schema 12 ProductionPlan
 * (`docs/PLANNER_SPEC.md` 16.1 / 16.2, `docs/DATA_MODEL.md` 14.4).
 *
 * Each operation is one Dexie read-write transaction: it reads the current
 * persisted state inside the transaction, lets the pure Execution Domain decide
 * and validate every change, and only then writes. A refusal throws
 * `ExecutionRuntimeError` and a storage failure `RepositoryError`; in both
 * cases the transaction is rolled back and nothing is changed.
 *
 * Implemented: starting a draft Plan and the ordinary `confirmed_expected`
 * Step confirmation (including a blind observation and `confirm_owned_ideal`).
 * Unexpected results, uncertain operations, finishing as a compromise, Undo,
 * game save point recording / restore, abandonment and replan adoption are not
 * implemented here yet.
 */
export class ProductionPlanExecutionService {
  private readonly dependencies: ProductionPlanExecutionServiceDependencies

  constructor(dependencies: ProductionPlanExecutionServiceDependencies) {
    this.dependencies = dependencies
  }

  /** `draft -> active` with no other change (16.2). */
  startProductionPlan(planId: ProductionPlanId): Promise<ProductionPlan> {
    const { database } = this.dependencies
    return this.runExecutionTransaction(async () => {
      const plan = await this.requirePlan(planId)
      const runningPlans = await database.productionPlans
        .where('status')
        .anyOf(['active', 'stale'])
        .toArray()
      const started = prepareProductionPlanStart({
        plan,
        runningPlans,
        state: await this.readState(plan),
        currentCalculationContext: this.dependencies.currentCalculationContext,
        now: this.dependencies.clock.now(),
      })
      await database.productionPlans.put(started)
      return started
    })
  }

  /** One `confirmed_expected` Step confirmation, persisted immediately (16.1). */
  confirmExpectedPlanStep(
    request: ConfirmExpectedPlanStepRequest,
  ): Promise<ConfirmExpectedPlanStepResult> {
    return this.runExecutionTransaction(async () => {
      const plan = await this.requirePlan(request.planId)
      const confirmation = prepareExpectedStepConfirmation({
        plan,
        planStepId: request.planStepId,
        observation: request.observation ?? null,
        state: await this.readState(plan),
        currentCalculationContext: this.dependencies.currentCalculationContext,
        counterAuthority: this.dependencies.counterAuthority,
        validateObservedWeapon: this.dependencies.validateObservedWeapon,
        executionHistoryId: this.dependencies.idFactory.executionHistoryId(),
        now: this.dependencies.clock.now(),
      })
      await this.writeConfirmation(confirmation)
      return { plan: confirmation.plan, history: confirmation.history }
    })
  }

  private async writeConfirmation(confirmation: ExpectedStepConfirmation): Promise<void> {
    const { database } = this.dependencies
    if (confirmation.rngState !== null) await database.rngState.put(confirmation.rngState)
    if (confirmation.normalCounters.length > 0) {
      await database.normalArtianCounters.bulkPut(confirmation.normalCounters)
    }
    if (confirmation.ownedWeapons.length > 0) {
      await database.ownedWeapons.bulkPut(confirmation.ownedWeapons)
    }
    if (confirmation.targetWeapons.length > 0) {
      await database.targetWeapons.bulkPut(confirmation.targetWeapons)
    }
    await database.productionPlans.put(confirmation.plan)
    if (confirmation.deletesExecutionSavePoint) {
      await database.executionSavePoints
        .where('productionPlanId')
        .equals(confirmation.plan.id)
        .delete()
    }
    // A history ID that already exists is a different record; never replace it.
    await database.executionHistory.add(confirmation.history)
  }

  private async requirePlan(planId: ProductionPlanId): Promise<ProductionPlan> {
    const plan = await this.dependencies.database.productionPlans.get(planId)
    if (!plan) executionFailure('plan_not_found', `ProductionPlan '${planId}' was not found.`)
    return plan
  }

  private async readState(plan: ProductionPlan): Promise<ExecutionPersistedState> {
    const { database } = this.dependencies
    const rngState = await database.rngState.get('current')
    if (!rngState) {
      executionFailure('execution_state_mismatch', 'No RngState is stored, so the Plan cannot be executed.')
    }
    return {
      rngState,
      normalCounters: await database.normalArtianCounters.toArray(),
      ownedWeapons: await database.ownedWeapons.toArray(),
      targetWeapons: await database.targetWeapons.toArray(),
      buildListEntries: await database.buildListEntries.toArray(),
      planExecutionHistory: await database.executionHistory.where('planId').equals(plan.id).toArray(),
      executionSavePoint:
        (await database.executionSavePoints.get(executionSavePointIdForPlan(plan.id))) ?? null,
    }
  }

  private async runExecutionTransaction<T>(operation: () => Promise<T>): Promise<T> {
    const { database } = this.dependencies
    try {
      return await database.transaction(
        'rw',
        [
          database.rngState,
          database.normalArtianCounters,
          database.ownedWeapons,
          database.targetWeapons,
          database.buildListEntries,
          database.productionPlans,
          database.executionHistory,
          database.executionSavePoints,
        ],
        operation,
      )
    } catch (error: unknown) {
      if (error instanceof ExecutionRuntimeError || error instanceof RepositoryError) throw error
      throw new RepositoryError(
        'transaction_failed',
        'The Execution transaction failed and was rolled back.',
        { cause: error },
      )
    }
  }
}

/** The Production Execution runtime over the loaded Master Data. */
export function createProductionPlanExecutionService(
  master: MasterDataRoot,
  database: AppDatabase = appDatabase,
): ProductionPlanExecutionService {
  return new ProductionPlanExecutionService({
    database,
    currentCalculationContext: createBuildListCalculationContext(master),
    counterAuthority: productionRngEngine,
    // The same Master / Production availability authority an Owned Weapon save
    // applies (`docs/PLANNER_SPEC.md` 16.4).
    validateObservedWeapon: (weapon) => validateOwnedWeaponMasterReferences(weapon, master),
    idFactory: { executionHistoryId: () => globalThis.crypto.randomUUID() as ExecutionHistoryId },
    clock: { now: () => new Date().toISOString() },
  })
}
