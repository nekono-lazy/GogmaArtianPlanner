import { getMaterialCostsFromSubset } from '../master/masterSelectors'
import {
  createReferencedOwnedWeaponsHash,
  createSearchStateHash,
  hashStableValue,
} from '../models/hashing'
import type {
  BuildCandidate,
  BuildRoute,
  MaterialRequirement,
  RouteOperation,
  TargetWeapon,
} from '../models/publicTypes'
import { validateBuildCandidate } from '../models/validation'
import { evaluateTargetCandidate } from '../target'
import type { SearchExecutionContext } from './searchExecution'
import { CandidateSearchError } from './searchTypes'
import type { CandidateSearchInput } from './searchTypes'

export interface CandidatePrediction {
  finalBonuses: BuildCandidate['finalBonuses']
  restorationBonusScope: BuildCandidate['restorationBonusScope']
  seriesSkillId: BuildCandidate['seriesSkillId']
  groupSkillId: BuildCandidate['groupSkillId']
  route: BuildRoute
}

function materialOperation(
  operation: RouteOperation,
): {
  type:
    | 'create_normal_artian'
    | 'convert_normal_to_gogma'
    | 'reset_bonuses'
    | 'keep_bonuses'
    | 'reset_skills'
  units: number
} | null {
  if (operation.type === 'use_weapon_as_material') return null
  return {
    type: operation.type,
    units: operation.type === 'create_normal_artian' ? operation.count : 1,
  }
}

export function collectRequiredMaterialsForOperations(
  operations: readonly RouteOperation[],
  weaponTypeId: string,
  input: Pick<CandidateSearchInput, 'master'>,
): MaterialRequirement[] {
  const quantities = new Map<string, number>()
  operations.forEach((operation) => {
    const info = materialOperation(operation)
    if (!info) return
    getMaterialCostsFromSubset(input.master, info.type, weaponTypeId).forEach(
      (cost) => {
        quantities.set(
          cost.materialId,
          (quantities.get(cost.materialId) ?? 0) + cost.quantity * info.units,
        )
      },
    )
  })
  return [...quantities]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([materialId, quantity]) => ({ materialId, quantity }))
}

export function collectRequiredMaterials(
  route: BuildRoute,
  weaponTypeId: string,
  input: Pick<CandidateSearchInput, 'master'>,
): MaterialRequirement[] {
  return collectRequiredMaterialsForOperations(
    route.operations,
    weaponTypeId,
    input,
  )
}

/**
 * The summed required quantity of one operation sequence.
 *
 * SEARCH_SPEC 5.5.3 uses this only as a deterministic tie-break inside one
 * stream's anchor ordering. It is NOT the Practical dominance comparison,
 * which stays component-wise per `materialId` (5.5.6.2).
 */
export function totalMaterialQuantity(
  operations: readonly RouteOperation[],
  weaponTypeId: string,
  input: Pick<CandidateSearchInput, 'master'>,
): number {
  return collectRequiredMaterialsForOperations(
    operations,
    weaponTypeId,
    input,
  ).reduce((total, requirement) => total + requirement.quantity, 0)
}

export function countRouteOperations(route: BuildRoute): number {
  return route.operations.reduce(
    (total, operation) =>
      total + (operation.type === 'create_normal_artian' ? operation.count : 1),
    0,
  )
}

function operationAdvance(
  operations: readonly RouteOperation[],
  stream: 'gogma' | 'skill' | 'normal',
): number | null {
  const values = operations.flatMap((operation) => {
    if (stream === 'normal' && operation.type === 'create_normal_artian') {
      return [operation.normalCounterAfter - operation.normalCounterBefore]
    }
    if (
      stream === 'skill' &&
      (operation.type === 'convert_normal_to_gogma' ||
        operation.type === 'reset_skills')
    ) {
      return [operation.skillCounterAfter - operation.skillCounterBefore]
    }
    if (
      stream === 'gogma' &&
      (operation.type === 'reset_bonuses' || operation.type === 'keep_bonuses')
    ) {
      return [operation.gogmaCounterAfter - operation.gogmaCounterBefore]
    }
    return []
  })
  return stream === 'normal' && values.length === 0
    ? null
    : values.reduce((total, value) => total + value, 0)
}

export function createCandidateFromPrediction(
  target: TargetWeapon,
  prediction: CandidatePrediction,
  input: CandidateSearchInput,
  execution: SearchExecutionContext,
): BuildCandidate | null {
  const evaluation = evaluateTargetCandidate(
    target,
    prediction.finalBonuses,
    prediction.seriesSkillId,
    prediction.groupSkillId,
    input.master,
    input.settings.similarityThreshold,
  )
  if (!evaluation.category) return null

  const semanticHash = hashStableValue({
    searchRunId: input.searchRunId,
    targetWeaponId: target.id,
    finalBonuses: prediction.finalBonuses,
    restorationBonusScope: prediction.restorationBonusScope,
    seriesSkillId: prediction.seriesSkillId,
    groupSkillId: prediction.groupSkillId,
    route: prediction.route,
  })
  const candidate: BuildCandidate = {
    id: execution.createCandidateId({ targetWeaponId: target.id, semanticHash }),
    targetWeaponId: target.id,
    category: evaluation.category,
    finalBonuses: prediction.finalBonuses.map((bonus) => ({ ...bonus })) as BuildCandidate['finalBonuses'],
    restorationBonusScope: prediction.restorationBonusScope,
    seriesSkillId: prediction.seriesSkillId,
    groupSkillId: prediction.groupSkillId,
    route: prediction.route,
    estimatedOperationCount: countRouteOperations(prediction.route),
    estimatedGogmaAdvance: operationAdvance(prediction.route.operations, 'gogma') ?? 0,
    estimatedSkillAdvance: operationAdvance(prediction.route.operations, 'skill') ?? 0,
    estimatedNormalAdvance: operationAdvance(prediction.route.operations, 'normal'),
    requiredMaterials: collectRequiredMaterials(
      prediction.route,
      target.weaponTypeId,
      input,
    ),
    idealDifference: evaluation.idealDifference,
    isSimilarToIdeal: evaluation.isSimilarToIdeal,
    similarityScore: evaluation.similarityScore,
    searchStateHash: createSearchStateHash(
      prediction.route,
      input.rngState,
      input.normalCounters,
    ),
    referencedOwnedWeaponsHash: createReferencedOwnedWeaponsHash(
      prediction.route,
      input.ownedWeapons,
    ),
    calculationContext: { ...input.calculationContext },
    searchRunId: input.searchRunId,
    createdAt: execution.now(),
  }
  const valid = validateBuildCandidate(candidate, input.ownedWeapons)
  if (!valid.isValid) {
    throw new CandidateSearchError(
      'invalid_candidate',
      valid.issues.map(({ path, message }) => `${path}: ${message}`).join('\n'),
    )
  }
  return candidate
}
