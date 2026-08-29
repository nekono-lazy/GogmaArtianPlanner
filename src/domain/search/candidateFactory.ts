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
import type { CandidateSearchInput } from './searchTypes'
import { CandidateSearchError } from './searchTypes'

export interface CandidatePrediction {
  finalBonuses: BuildCandidate['finalBonuses']
  seriesSkillId: BuildCandidate['seriesSkillId']
  groupSkillId: BuildCandidate['groupSkillId']
  route: BuildRoute
}

function materialOperation(
  operation: RouteOperation,
): { type: 'create_normal_artian' | 'convert_normal_to_gogma' | 'reset_bonuses' | 'keep_bonuses' | 'reset_skills'; units: number } | null {
  if (operation.type === 'use_weapon_as_material') return null
  return {
    type: operation.type,
    units: operation.type === 'create_normal_artian' ? operation.count : 1,
  }
}

export function collectRequiredMaterials(
  route: BuildRoute,
  weaponTypeId: string,
  input: Pick<CandidateSearchInput, 'master'>,
): MaterialRequirement[] {
  const quantities = new Map<string, number>()
  route.operations.forEach((operation) => {
    const materialOperationInfo = materialOperation(operation)
    if (!materialOperationInfo) return
    getMaterialCostsFromSubset(
      input.master,
      materialOperationInfo.type,
      weaponTypeId,
    ).forEach((cost) => {
      quantities.set(
        cost.materialId,
        (quantities.get(cost.materialId) ?? 0) +
          cost.quantity * materialOperationInfo.units,
      )
    })
  })
  return [...quantities]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([materialId, quantity]) => ({ materialId, quantity }))
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
  type: 'gogma' | 'skill' | 'normal',
): number | null {
  const differences = operations.flatMap((operation) => {
    if (
      type === 'gogma' &&
      (operation.type === 'convert_normal_to_gogma' ||
        operation.type === 'reset_bonuses' ||
        operation.type === 'keep_bonuses')
    ) {
      return operation.gogmaCounterAfter - operation.gogmaCounterBefore
    }
    if (type === 'skill' && operation.type === 'reset_skills') {
      return operation.skillCounterAfter - operation.skillCounterBefore
    }
    if (type === 'normal' && operation.type === 'create_normal_artian') {
      return operation.normalCounterAfter - operation.normalCounterBefore
    }
    return []
  })
  if (type === 'normal' && differences.length === 0) return null
  return differences.reduce((total, difference) => total + difference, 0)
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
  if (evaluation.category === null) return null

  const requiredMaterials = collectRequiredMaterials(
    prediction.route,
    target.weaponTypeId,
    input,
  )
  const semanticHash = hashStableValue({
    searchRunId: input.searchRunId,
    targetWeaponId: target.id,
    finalBonuses: prediction.finalBonuses,
    seriesSkillId: prediction.seriesSkillId,
    groupSkillId: prediction.groupSkillId,
    route: prediction.route,
  })
  const candidate: BuildCandidate = {
    id: execution.createCandidateId({
      targetWeaponId: target.id,
      semanticHash,
    }),
    targetWeaponId: target.id,
    category: evaluation.category,
    finalBonuses: prediction.finalBonuses.map((bonus) => ({ ...bonus })) as BuildCandidate['finalBonuses'],
    seriesSkillId: prediction.seriesSkillId,
    groupSkillId: prediction.groupSkillId,
    route: prediction.route,
    estimatedOperationCount: countRouteOperations(prediction.route),
    estimatedGogmaAdvance:
      operationAdvance(prediction.route.operations, 'gogma') ?? 0,
    estimatedSkillAdvance:
      operationAdvance(prediction.route.operations, 'skill') ?? 0,
    estimatedNormalAdvance: operationAdvance(
      prediction.route.operations,
      'normal',
    ),
    requiredMaterials,
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
  const validation = validateBuildCandidate(candidate, input.ownedWeapons)
  if (!validation.isValid) {
    throw new CandidateSearchError(
      'invalid_candidate',
      validation.issues
        .map(({ path, message }) => `${path}: ${message}`)
        .join('\n'),
    )
  }
  return candidate
}
