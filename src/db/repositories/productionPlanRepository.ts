import type {
  ISODateTimeString,
  ProductionPlan,
  ProductionPlanId,
} from '../../domain/models/publicTypes'
import { validateProductionPlan } from '../../domain/models/validation'
import { appDatabase, type AppDatabase } from '../AppDatabase'
import {
  assertRepositoryValidation,
  RepositoryError,
} from '../repositoryError'
import { runInRepositoryTransaction } from '../transaction'

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
        if (plan.status === 'active') {
          const activePlans = await this.database.productionPlans
            .where('status')
            .equals('active')
            .toArray()
          if (activePlans.some(({ id }) => id !== plan.id)) {
            throw new RepositoryError(
              'active_plan_conflict',
              'Another ProductionPlan is already active.',
            )
          }
        }
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
        if (plan.status === 'active') {
          const activePlans = await this.database.productionPlans
            .where('status')
            .equals('active')
            .toArray()
          if (activePlans.some(({ id }) => id !== plan.id)) {
            throw new RepositoryError(
              'active_plan_conflict',
              'Another ProductionPlan is already active.',
            )
          }
        }
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
      if (previousActivePlanReplacement.status === 'active') {
        throw new RepositoryError(
          'active_plan_conflict',
          'The previous active Plan replacement must have a non-active status.',
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
        const current = activePlans[0]
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
