import type {
  ISODateTimeString,
  ProductionPlan,
  ProductionPlanId,
  ProductionPlanStatus,
} from '../../domain/models/publicTypes'
import { validateProductionPlan } from '../../domain/models/validation'
import { appDatabase, type AppDatabase } from '../AppDatabase'
import {
  assertRepositoryValidation,
  RepositoryError,
} from '../repositoryError'
import { runInRepositoryTransaction } from '../transaction'

/** At most one Plan may be running at a time (`docs/PLANNER_SPEC.md` 16.2). */
const RUNNING_PLAN_STATUSES: readonly ProductionPlanStatus[] = ['active', 'stale']

export function isRunningProductionPlanStatus(status: ProductionPlanStatus): boolean {
  return RUNNING_PLAN_STATUSES.includes(status)
}

function sortPlans(plans: ProductionPlan[]): ProductionPlan[] {
  return plans.sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id),
  )
}

export class ProductionPlanRepository {
  private readonly database: AppDatabase

  constructor(database: AppDatabase) {
    this.database = database
  }

  getProductionPlan(
    id: ProductionPlanId,
  ): Promise<ProductionPlan | undefined> {
    return this.database.productionPlans.get(id)
  }

  async getAllProductionPlans(): Promise<ProductionPlan[]> {
    return sortPlans(await this.database.productionPlans.toArray())
  }

  async getActiveProductionPlan(): Promise<ProductionPlan | undefined> {
    const activePlans = await this.database.productionPlans
      .where('status')
      .equals('active')
      .toArray()
    if (activePlans.length > 1) {
      throw new RepositoryError(
        'active_plan_conflict',
        'Persistence contains more than one active ProductionPlan.',
      )
    }
    return activePlans[0]
  }

  /**
   * The one running Plan (`active` or `stale`, `docs/PLANNER_SPEC.md` 16.2), or
   * `undefined`. More than one fails closed.
   */
  async getRunningProductionPlan(): Promise<ProductionPlan | undefined> {
    const running = await this.readRunningPlans()
    if (running.length > 1) {
      throw new RepositoryError(
        'active_plan_conflict',
        'Persistence contains more than one running (active or stale) ProductionPlan.',
      )
    }
    return running[0]
  }

  /** Reads every running Plan in the current transaction zone. */
  private readRunningPlans(): Promise<ProductionPlan[]> {
    return this.database.productionPlans
      .where('status')
      .anyOf(RUNNING_PLAN_STATUSES)
      .toArray()
  }

  private async assertNoOtherRunningPlan(plan: ProductionPlan): Promise<void> {
    if (!isRunningProductionPlanStatus(plan.status)) return
    const running = await this.readRunningPlans()
    if (running.some(({ id }) => id !== plan.id)) {
      throw new RepositoryError(
        'active_plan_conflict',
        'Another ProductionPlan is already running (active or stale).',
      )
    }
  }

  /**
   * Inserts a Plan that must not already exist.
   *
   * A newly calculated Plan carries a fresh ID, so a colliding key means the
   * stored Plan is a different Plan; it is never silently replaced. The active
   * Plan guard and Domain validation are the same authorities `put` uses.
   */
  addProductionPlan(plan: ProductionPlan): Promise<ProductionPlan> {
    assertRepositoryValidation('ProductionPlan', validateProductionPlan(plan))
    return runInRepositoryTransaction(
      this.database,
      [this.database.productionPlans],
      async () => {
        await this.assertNoOtherRunningPlan(plan)
        await this.database.productionPlans.add(plan)
        return plan
      },
    )
  }

  putProductionPlan(plan: ProductionPlan): Promise<ProductionPlan> {
    assertRepositoryValidation('ProductionPlan', validateProductionPlan(plan))
    return runInRepositoryTransaction(
      this.database,
      [this.database.productionPlans],
      async () => {
        await this.assertNoOtherRunningPlan(plan)
        await this.database.productionPlans.put(plan)
        return plan
      },
    )
  }

  deleteProductionPlan(id: ProductionPlanId): Promise<void> {
    return this.database.productionPlans.delete(id)
  }

  activateProductionPlan(
    planId: ProductionPlanId,
    previousActivePlanReplacement?: ProductionPlan,
    now: ISODateTimeString = new Date().toISOString(),
  ): Promise<ProductionPlan> {
    if (previousActivePlanReplacement) {
      assertRepositoryValidation(
        'ProductionPlan',
        validateProductionPlan(previousActivePlanReplacement),
      )
      if (isRunningProductionPlanStatus(previousActivePlanReplacement.status)) {
        throw new RepositoryError(
          'active_plan_conflict',
          'The previous running Plan replacement must be neither active nor stale.',
        )
      }
    }

    return runInRepositoryTransaction(
      this.database,
      [this.database.productionPlans],
      async () => {
        const next = await this.database.productionPlans.get(planId)
        if (!next) {
          throw new RepositoryError(
            'not_found',
            `ProductionPlan '${planId}' was not found.`,
          )
        }
        const runningPlans = await this.readRunningPlans()
        if (runningPlans.length > 1) {
          throw new RepositoryError(
            'active_plan_conflict',
            'Persistence contains more than one running (active or stale) ProductionPlan.',
          )
        }
        const current = runningPlans[0]
        if (current && current.id !== planId) {
          if (
            !previousActivePlanReplacement ||
            previousActivePlanReplacement.id !== current.id
          ) {
            throw new RepositoryError(
              'active_plan_conflict',
              'Switching active Plans requires the previous Plan replacement.',
            )
          }
          await this.database.productionPlans.put(previousActivePlanReplacement)
        }
        const activated: ProductionPlan = {
          ...next,
          status: 'active',
          updatedAt: now,
        }
        assertRepositoryValidation(
          'ProductionPlan',
          validateProductionPlan(activated),
        )
        await this.database.productionPlans.put(activated)
        return activated
      },
    )
  }
}

export const productionPlanRepository = new ProductionPlanRepository(appDatabase)
