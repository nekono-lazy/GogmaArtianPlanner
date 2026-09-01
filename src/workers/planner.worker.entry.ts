import { createProductionPlan } from '../domain/planner'
import { attachPlannerWorker, type PlannerWorkerScope } from './planner.worker'
import { createProductionPlannerWorkerDependencies } from './planner.worker.production'

attachPlannerWorker(
  self as unknown as PlannerWorkerScope,
  createProductionPlannerWorkerDependencies,
  createProductionPlan,
)
