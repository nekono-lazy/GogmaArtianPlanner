import {
  createReferencedOwnedWeaponsHash,
  createSearchStateHash,
} from '../../models/hashing'
import type {
  BuildRoute,
  GroupSkillId,
  RestorationBonusScope,
  RestorationBonusSet,
  SeriesSkillId,
  TargetWeapon,
} from '../../models/publicTypes'
import { validateBuildRoute } from '../../models/publicTypes'
import {
  calculateSimilarityScore,
  evaluateTargetBonusMatch,
  evaluateTargetSkillMatch,
  createIdealDifference,
} from '../../target'
import { candidateStableKey } from '../candidateProcessing'
import { compareStableKeys } from '../semanticKeys'
import { createCandidateRouteEstimates } from '../candidateFactory'
import {
  ConstrainedSearchError,
  type ConstrainedCandidate,
  type ConstrainedSearchOrigin,
} from './constrainedTypes'

export interface ConstrainedCandidatePrediction {
  finalBonuses: RestorationBonusSet
  restorationBonusScope: RestorationBonusScope
  seriesSkillId: SeriesSkillId | null
  groupSkillId: GroupSkillId | null
  route: BuildRoute
}

/**
 * Builds one transient `ConstrainedCandidate`.
 *
 * Every field comes from an existing Domain authority: `classifyCandidate()`,
 * `createIdealDifference()`, `calculateSimilarityScore()`,
 * `createCandidateRouteEstimates()`, `createSearchStateHash()` and
 * `createReferencedOwnedWeaponsHash()`. No similarity threshold is applied, so
 * `CandidateSearchSettings` never reaches this boundary, and no `id`,
 * `searchRunId`, `createdAt`, Clock value, or enumeration ordinal is produced.
 *
 * Returns `null` when the composed result satisfies neither the Ideal nor the
 * Practical condition, which is the yield contract of SEARCH_SPEC 5.6.7.
 */
export function createConstrainedCandidate(
  target: TargetWeapon,
  origin: ConstrainedSearchOrigin,
  prediction: ConstrainedCandidatePrediction,
): ConstrainedCandidate | null {
  const bonus = evaluateTargetBonusMatch(
    target,
    prediction.finalBonuses,
    prediction.restorationBonusScope,
    origin.master,
  )
  const skill = evaluateTargetSkillMatch(target, prediction.seriesSkillId, prediction.groupSkillId)
  if (!bonus || !skill) return null
  const category = bonus === 'ideal' && skill === 'ideal' ? 'ideal' : 'practical'

  const valid = validateBuildRoute(prediction.route, origin.ownedWeapons)
  if (!valid.isValid) {
    throw new ConstrainedSearchError(
      'invalid_candidate',
      valid.issues.map(({ path, message }) => `${path}: ${message}`).join('\n'),
    )
  }

  const idealDifference = createIdealDifference(
    target,
    prediction.finalBonuses,
    prediction.seriesSkillId,
    prediction.groupSkillId,
  )
  return {
    targetWeaponId: target.id,
    category,
    conditionMatch: { bonus, skill },
    finalBonuses: prediction.finalBonuses.map((bonus) => ({
      ...bonus,
    })) as RestorationBonusSet,
    restorationBonusScope: prediction.restorationBonusScope,
    seriesSkillId: prediction.seriesSkillId,
    groupSkillId: prediction.groupSkillId,
    route: prediction.route,
    ...createCandidateRouteEstimates(prediction.route, target.weaponTypeId, {
      master: origin.master,
    }),
    idealDifference,
    similarityScore: calculateSimilarityScore(target, idealDifference),
    searchStateHash: createSearchStateHash(
      prediction.route,
      origin.rngState,
      origin.normalCounters,
    ),
    referencedOwnedWeaponsHash: createReferencedOwnedWeaponsHash(
      prediction.route,
      origin.ownedWeapons,
    ),
    calculationContext: { ...origin.calculationContext },
  }
}

/**
 * The run-independent semantic identity of one constrained Candidate, reusing
 * the `candidateStableKey()` authority. Two solutions reaching the same result
 * at different Counter positions have different concrete operations, so they
 * keep different keys and are never collapsed into one.
 */
export function constrainedCandidateStableKey(
  candidate: ConstrainedCandidate,
): string {
  return candidateStableKey(candidate)
}

function nullableAscending(left: number | null, right: number | null): number {
  if (left === null) return right === null ? 0 : 1
  if (right === null) return -1
  return left - right
}

/**
 * The deterministic enumeration order, mirroring the existing bounded-selection
 * ordering `compareCandidateSelection()`: Ideal before Practical, then cheaper
 * routes, then closeness, then the stable semantic key.
 *
 * No run-dependent value participates: there is no Candidate ID, no
 * `searchRunId`, no Clock value, and no Map insertion or Promise resolution
 * order in this comparison.
 */
export function compareConstrainedCandidates(
  left: ConstrainedCandidate,
  right: ConstrainedCandidate,
): number {
  return (
    Number(left.category === 'practical') -
      Number(right.category === 'practical') ||
    left.estimatedOperationCount - right.estimatedOperationCount ||
    left.estimatedGogmaAdvance - right.estimatedGogmaAdvance ||
    left.estimatedSkillAdvance - right.estimatedSkillAdvance ||
    nullableAscending(left.estimatedNormalAdvance, right.estimatedNormalAdvance) ||
    (right.similarityScore ?? -1) - (left.similarityScore ?? -1) ||
    right.idealDifference.matchedBonusCount -
      left.idealDifference.matchedBonusCount ||
    compareStableKeys(
      constrainedCandidateStableKey(left),
      constrainedCandidateStableKey(right),
    )
  )
}
