import type {
  ConstrainedCandidate,
  ConstrainedEnumerationBounds,
  ConstrainedSearchOrigin,
} from '../../search'
import type { TargetWeaponId } from '../../models/publicTypes'
import type { PlannerClock } from '../plannerTypes'
import {
  createDeterministicMaterializer,
  type DeterministicMaterializer,
} from '../replacement/plannerDeterministicMaterializer'
import { resolvePlannerSearchOriginTarget } from '../replacement/plannerSearchOrigin'
import { createConstrainedSearchIdentity } from './constrainedSearchIdentity'

export interface ConstrainedMaterializationContext {
  origin: ConstrainedSearchOrigin
  targetWeaponId: TargetWeaponId
  bounds: ConstrainedEnumerationBounds
  clock: PlannerClock
}

export type ConstrainedMaterializer = DeterministicMaterializer<ConstrainedCandidate>

/**
 * The B8-C2 deterministic materializer (PLANNER_SPEC 9.2.13, SEARCH_SPEC 5.6.7):
 * the shared core with the B8 constrained search identity and the
 * `candidate.constrained.` Candidate ID prefix. A `ConstrainedCandidate`
 * carries no observational trace, so none is materialized. The ordinary
 * `createCandidateFromPrediction()` ID rule, the ordinary `searchRunId`
 * contract, and the ordinary `createBuildListEntry()` default behavior are all
 * untouched. The core is the shared `../replacement/plannerDeterministicMaterializer`
 * (Phase 6-B2a); only this B8 adapter stays here.
 */
export function createConstrainedMaterializer(
  context: ConstrainedMaterializationContext,
): ConstrainedMaterializer {
  return createDeterministicMaterializer<ConstrainedCandidate>({
    origin: context.origin,
    target: resolvePlannerSearchOriginTarget(context.origin, context.targetWeaponId),
    searchIdentity: createConstrainedSearchIdentity({
      origin: context.origin,
      targetWeaponId: context.targetWeaponId,
      bounds: context.bounds,
    }),
    candidateIdPrefix: 'candidate.constrained.',
    clock: context.clock,
  })
}
