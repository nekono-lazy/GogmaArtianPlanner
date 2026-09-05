import type {
  BuildCandidate,
  BuildRoute,
  GroupSkillId,
  OwnedWeaponId,
  RestorationBonusScope,
  RestorationBonusSet,
  RouteOperation,
  SeriesSkillId,
  TargetWeapon,
} from '../models/publicTypes'
import { areRestorationBonusSetsEqual } from '../models/domainRules'
import type { RngEngine } from '../rng/rngEngine'
import { evaluateSkillCondition } from '../target'
import type { TargetBonusStream } from './bonusStream'
import { createCandidateFromPrediction } from './candidateFactory'
import type { SearchExecutionContext } from './searchExecution'
import type { SearchPredictionSupport } from './searchPredictionSupport'
import type { CandidateSearchInput, CandidateSearchWarning, SkippedRoute } from './searchTypes'
import {
  resetSkillsOperations,
  type SkillStreamSolutionSet,
  type TargetSkillStream,
} from './skillStream'

export { hasConfirmedGogmaInputs, hasConfirmedSkillInputs } from './searchRngInputs'
export {
  createSearchPredictionSupport,
  type SearchPredictionSupport,
} from './searchPredictionSupport'

export interface RouteSearchResult {
  candidates: BuildCandidate[]
  searchedRoutes: BuildRoute['kind'][]
  skippedRoutes: SkippedRoute[]
  warnings: CandidateSearchWarning[]
}

export interface RouteSearchContext {
  target: TargetWeapon
  input: CandidateSearchInput
  engine: RngEngine
  execution: SearchExecutionContext
  predictionSupport: SearchPredictionSupport
  /** Solved once per Target; never re-entered from inside a Gogma state. */
  skillStream: TargetSkillStream
  /** Solved once per Route base class; never re-entered from a Skill result. */
  bonusStream: TargetBonusStream
}

/**
 * A Bonus-side Route base awaiting composition with the Skill stream.
 * `operations` holds the Bonus-side operations in execution order; Reset Skills
 * operations are appended after them.
 */
export interface SkillCompositionBase {
  bonuses: RestorationBonusSet
  restorationBonusScope: RestorationBonusScope
  operations: readonly RouteOperation[]
  sourceOwnedWeaponId: OwnedWeaponId | null
  /** Skills of the `resetCount = 0` solution, which is Route-base specific. */
  seriesSkillId: SeriesSkillId | null
  groupSkillId: GroupSkillId | null
  kind: BuildRoute['kind']
  /** RouteKind used once Reset Skills operations are appended. */
  skillKind?: BuildRoute['kind']
  /** Source recorded on each appended Reset Skills operation. */
  resetSkillsSourceOwnedWeaponId?: OwnedWeaponId | null
}

/**
 * A Skill stream whose current Skills already satisfy the Ideal Skill condition
 * is finished: Ideal implies Practical, so no later Skill position can produce a
 * higher category. Only the Skill stream stops; the Bonus stream is unaffected.
 */
export function skillsSatisfyIdeal(
  context: RouteSearchContext,
  seriesSkillId: SeriesSkillId | null,
  groupSkillId: GroupSkillId | null,
): boolean {
  return evaluateSkillCondition(
    context.target.idealSkillCondition,
    seriesSkillId,
    groupSkillId,
  )
}

/**
 * The Bonus-stream counterpart of `skillsSatisfyIdeal` (SEARCH_SPEC 5.6.1).
 * A Route base whose current five slots already match `idealBonuses` searches
 * no Bonus amendment at all, so it consumes no `maxGogmaAdvance` position and
 * calls `predictGogmaBonus` zero times. The Skill stream keeps running.
 */
export function bonusesSatisfyIdeal(
  context: RouteSearchContext,
  bonuses: RestorationBonusSet,
): boolean {
  return areRestorationBonusSetsEqual(context.target.idealBonuses, bonuses)
}

export function createBaseCandidate(
  context: RouteSearchContext,
  bonuses: RestorationBonusSet,
  restorationBonusScope: RestorationBonusScope,
  seriesSkillId: SeriesSkillId | null,
  groupSkillId: GroupSkillId | null,
  route: BuildRoute,
): BuildCandidate | null {
  return createCandidateFromPrediction(
    context.target,
    { finalBonuses: bonuses, restorationBonusScope, seriesSkillId, groupSkillId, route },
    context.input,
    context.execution,
  )
}

/**
 * Composes one Bonus-side Route base with the already solved Skill stream.
 * No Skill prediction happens here, so composing more Bonus states, more source
 * weapons, or more Normal offsets never adds a `predictSkills` call.
 */
export async function composeSkillCandidates(
  context: RouteSearchContext,
  base: SkillCompositionBase,
  skillSolutions: SkillStreamSolutionSet | null,
): Promise<BuildCandidate[]> {
  const candidates: BuildCandidate[] = []
  const resetSource = base.resetSkillsSourceOwnedWeaponId === undefined
    ? base.sourceOwnedWeaponId
    : base.resetSkillsSourceOwnedWeaponId

  if (base.operations.length > 0) {
    const candidate = createBaseCandidate(
      context,
      base.bonuses,
      base.restorationBonusScope,
      base.seriesSkillId,
      base.groupSkillId,
      {
        kind: base.kind,
        sourceOwnedWeaponId: base.sourceOwnedWeaponId,
        operations: [...base.operations],
      },
    )
    if (candidate) candidates.push(candidate)
  }
  if (!skillSolutions) return candidates

  for (const solution of skillSolutions.solutions) {
    await context.execution.checkpoint()
    const candidate = createBaseCandidate(
      context,
      base.bonuses,
      base.restorationBonusScope,
      solution.seriesSkillId,
      solution.groupSkillId,
      {
        kind: base.skillKind ?? base.kind,
        sourceOwnedWeaponId: base.sourceOwnedWeaponId,
        operations: [
          ...base.operations,
          ...resetSkillsOperations(skillSolutions, solution.resetCount, resetSource),
        ],
      },
    )
    if (candidate) candidates.push(candidate)
  }
  return candidates
}
