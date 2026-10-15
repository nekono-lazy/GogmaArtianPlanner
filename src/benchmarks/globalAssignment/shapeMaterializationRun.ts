/**
 * Issue #154 Global Assignment Phase D-0A-2b (Research adapter; never imported by the app).
 *
 * The execution and the classification of one shape-constrained request (`docs/PLANNER_GLOBAL_ASSIGNMENT_D0A2_DESIGN.md` 5.4 / 5.5 /
 * 9.3 / 10) - the premise check, the gate, the shape-constrained Route search through a counting Engine with the runtime budget, the
 * first delivery's materialization, match and independent Route checks, and the classification of 10.1 - is the Production Domain's
 * (`src/domain/planner/buildListOptimization/shapeConstrainedRun.ts`, Issue #260 PR-3). This adapter keeps the Research API: a fixed
 * Research `createdAt` and the Research Candidate ID prefix, and a request and an attempt in their Research views.
 */
import type { BuildListEntry, ISODateTimeString } from '../../domain/models/publicTypes'
import { executeShapeConstrainedRoute, type RouteGenerationSettings, type ShapeConstrainedSearchVisit } from '../../domain/planner/buildListOptimization'
import type { RngEngine } from '../../domain/rng/rngEngine'
import type { CandidateInspection } from './materializationTypes'
import { SHAPE_CONSTRAINED_CANDIDATE_ID_PREFIX, type ShapeConstrainedAttempt, type ShapeConstrainedMaterializationRequest } from './shapeMaterializationTypes'
import { productionReachTableOf, type GlobalAssignmentContext, type ReachTable } from './types'

export { reachTableSupportJudgement as phaseASupportJudgement, type ShapeConstrainedSearchVisit } from '../../domain/planner/buildListOptimization'

export interface ShapeRunDependencies {
  context: GlobalAssignmentContext
  table: ReachTable
  engine: RngEngine
  settings: RouteGenerationSettings
  /** The Entries materialized before this Target, in order (the formal reservation's only source; the Route checks derive it again). */
  materializedEntries: readonly BuildListEntry[]
  /** The PlannerInput's own Entries, read by the deterministic materializer's ID-collision / reuse rule only. */
  collisionCheckEntries: readonly BuildListEntry[]
  /** The fixed display-only `createdAt` of a materialized Entry (never a run-dependent value). */
  researchTime: ISODateTimeString
  visit?: ShapeConstrainedSearchVisit
  shouldCancel?: () => boolean
  yieldControl?: () => Promise<void>
  onInspected?: (inspection: CandidateInspection) => void
}

/**
 * Design 5.4 steps 4 - 7 for a request already re-derived by the caller. Returns the attempt (materialized, budget stop, gate,
 * unsupported, cancel) or throws `GlobalAssignmentMaterializationError` for every fail-closed end.
 */
export async function runShapeConstrainedRequest(request: ShapeConstrainedMaterializationRequest, deps: ShapeRunDependencies): Promise<ShapeConstrainedAttempt> {
  const { researchTime, table, ...rest } = deps
  const attempt = await executeShapeConstrainedRoute(request, {
    ...rest, table: productionReachTableOf(table), clock: { now: () => researchTime }, candidateIdPrefix: SHAPE_CONSTRAINED_CANDIDATE_ID_PREFIX,
  })
  return { ...attempt, request }
}
