import { getMaterialCostsFromSubset } from '../master/masterSelectors'
import {
  createReferencedOwnedWeaponsHash,
  createSearchStateHash,
  hashStableValue,
} from '../models/hashing'
import type {
  BonusAmendmentResult,
  BuildCandidate,
  BuildRoute,
  CandidateBonusAmendmentStep,
  CandidateSkillAmendmentStep,
  MaterialRequirement,
  RouteOperation,
  SkillAmendmentResult,
  TargetWeapon,
} from '../models/publicTypes'
import { isBlindCreateNormalArtianOperation } from '../models/publicTypes'
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
  /**
   * The Bonus stream's predicted result of each amendment of this Route, in
   * execution order. Omitted when the caller has no observational trace; the
   * Candidate then simply carries no `bonusAmendmentTrace`.
   */
  bonusAmendmentResults?: readonly BonusAmendmentResult[]
  /**
   * The Skill stream's predicted result of each Reset Skills of this Route, in
   * execution order. Omitted when the caller has no observational trace; the
   * Candidate then simply carries no `skillAmendmentTrace`.
   */
  skillAmendmentResults?: readonly SkillAmendmentResult[]
}

/**
 * Binds the Bonus stream's ordered amendment results to the positions the
 * amendment operations actually occupy in the finished Route.
 *
 * The binding is positional over the amendment operations themselves, not over
 * a precomputed base-operation offset, so a run of identical operation types
 * can never shift by one. A count mismatch is an internal inconsistency and
 * fails loudly rather than displaying a wrong result next to an operation.
 */
export function createCandidateBonusAmendmentTrace(
  operations: readonly RouteOperation[],
  results: readonly BonusAmendmentResult[],
): CandidateBonusAmendmentStep[] {
  const amendments = operations.flatMap((operation, operationIndex) =>
    operation.type === 'reset_bonuses' || operation.type === 'keep_bonuses'
      ? [{ operationIndex, operationType: operation.type }]
      : [],
  )
  if (amendments.length !== results.length) {
    throw new CandidateSearchError(
      'invalid_candidate',
      `Route has ${amendments.length} bonus amendment operation(s) but ${results.length} predicted result(s).`,
    )
  }
  return amendments.map(({ operationIndex, operationType }, index) => ({
    operationIndex,
    operationType,
    restorationBonuses: results[index].restorationBonuses.map((bonus) => ({
      ...bonus,
    })) as CandidateBonusAmendmentStep['restorationBonuses'],
    restorationBonusScope: results[index].restorationBonusScope,
  }))
}

/**
 * The Skill counterpart of `createCandidateBonusAmendmentTrace()`.
 *
 * The binding is positional over the `reset_skills` operations themselves, so a
 * run of consecutive Reset Skills can never shift by one, and a count mismatch
 * fails loudly instead of repeating the final Skills next to every operation.
 */
export function createCandidateSkillAmendmentTrace(
  operations: readonly RouteOperation[],
  results: readonly SkillAmendmentResult[],
): CandidateSkillAmendmentStep[] {
  const amendments = operations.flatMap((operation, operationIndex) =>
    operation.type === 'reset_skills' ? [operationIndex] : [],
  )
  if (amendments.length !== results.length) {
    throw new CandidateSearchError(
      'invalid_candidate',
      `Route has ${amendments.length} Reset Skills operation(s) but ${results.length} predicted result(s).`,
    )
  }
  return amendments.map((operationIndex, index) => ({
    operationIndex,
    operationType: 'reset_skills',
    seriesSkillId: results[index].seriesSkillId,
    groupSkillId: results[index].groupSkillId,
  }))
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

/**
 * Operation units of one ordered operation sequence, counting a
 * `create_normal_artian` step as its forge `count`.
 *
 * Split out of `countRouteOperations()` so the constrained enumerator can score
 * a not-yet-composed `(base, Bonus, Skill)` combination with the same authority
 * the finished Candidate estimate uses (SEARCH_SPEC 5.6.7).
 */
export function countRouteOperationUnits(
  operations: readonly RouteOperation[],
): number {
  return operations.reduce(
    (total, operation) =>
      total + (operation.type === 'create_normal_artian' ? operation.count : 1),
    0,
  )
}

export function countRouteOperations(route: BuildRoute): number {
  return countRouteOperationUnits(route.operations)
}

function operationAdvance(
  operations: readonly RouteOperation[],
  stream: 'gogma' | 'skill' | 'normal',
): number | null {
  const values = operations.flatMap((operation) => {
    if (stream === 'normal' && operation.type === 'create_normal_artian') {
      // A blind creation has no absolute Counter pair, so it contributes no
      // representable advance. A Route whose only Normal creation is blind
      // therefore reports `estimatedNormalAdvance = null`, which means "not
      // represented", never "the Normal Counter did not advance".
      return isBlindCreateNormalArtianOperation(operation)
        ? []
        : [operation.normalCounterAfter - operation.normalCounterBefore]
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

/**
 * The route-derived estimate and material fields of one composed result.
 *
 * They are a pure function of the concrete `RouteOperation[]`, the weapon type,
 * and the Master subset, so ordinary Candidate Search and the constrained
 * enumerator (SEARCH_SPEC 5.6.7) share this single authority. Nothing here
 * depends on `searchRunId`, the Clock, or any Candidate ID.
 */
export interface CandidateRouteEstimates {
  estimatedOperationCount: number
  estimatedGogmaAdvance: number
  estimatedSkillAdvance: number
  estimatedNormalAdvance: number | null
  requiredMaterials: MaterialRequirement[]
}

export function createCandidateRouteEstimates(
  route: BuildRoute,
  weaponTypeId: string,
  master: Pick<CandidateSearchInput, 'master'>,
): CandidateRouteEstimates {
  return {
    estimatedOperationCount: countRouteOperations(route),
    estimatedGogmaAdvance: operationAdvance(route.operations, 'gogma') ?? 0,
    estimatedSkillAdvance: operationAdvance(route.operations, 'skill') ?? 0,
    estimatedNormalAdvance: operationAdvance(route.operations, 'normal'),
    requiredMaterials: collectRequiredMaterials(route, weaponTypeId, master),
  }
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
    prediction.restorationBonusScope,
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
    ...createCandidateRouteEstimates(
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
    ...(prediction.bonusAmendmentResults === undefined
      ? {}
      : {
          bonusAmendmentTrace: createCandidateBonusAmendmentTrace(
            prediction.route.operations,
            prediction.bonusAmendmentResults,
          ),
        }),
    ...(prediction.skillAmendmentResults === undefined
      ? {}
      : {
          skillAmendmentTrace: createCandidateSkillAmendmentTrace(
            prediction.route.operations,
            prediction.skillAmendmentResults,
          ),
        }),
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
