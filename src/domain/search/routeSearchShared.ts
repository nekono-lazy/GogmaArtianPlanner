import type {
  BonusAmendmentResult,
  BuildCandidate,
  BuildRoute,
  GroupSkillId,
  OwnedWeaponId,
  RestorationBonusScope,
  RestorationBonusSet,
  RouteOperation,
  SeriesSkillId,
  SkillAmendmentResult,
  TargetWeapon,
} from '../models/publicTypes'
import type { RngEngine } from '../rng/rngEngine'
import { evaluateSkillCondition, satisfiesIdealBonuses } from '../target'
import {
  bonusAmendmentOperations,
  bonusAmendmentResults,
  type BonusStreamSolutionSet,
  type TargetBonusStream,
} from './bonusStream'
import { createCandidateFromPrediction } from './candidateFactory'
import { crossStreamSolutions } from './crossComposition'
import type { SearchExecutionContext } from './searchExecution'
import type { SearchPredictionSupport } from './searchPredictionSupport'
import {
  CandidateSearchError,
  type CandidateSearchInput,
  type CandidateSearchWarning,
  type SkippedRoute,
} from './searchTypes'
import {
  buildBonusSolutionSet,
  buildSkillSolutionSet,
  selectBonusAxis,
  selectSkillAxis,
  type RouteBonusSolution,
  type RouteSkillSolution,
  type StreamCategoryPredicate,
} from './streamSolutions'
import {
  resetSkillsOperations,
  skillAmendmentResults,
  type SkillStreamSolutionSet,
  type TargetSkillStream,
} from './skillStream'

export { hasConfirmedGogmaInputs, hasConfirmedSkillInputs } from './searchRngInputs'
export {
  createSearchPredictionSupport,
  type SearchPredictionSupport,
} from './searchPredictionSupport'

const streamCategories: readonly StreamCategoryPredicate[] = ['ideal', 'practical']

export interface RouteSearchResult {
  candidates: BuildCandidate[]
  searchedRoutes: BuildRoute['kind'][]
  skippedRoutes: SkippedRoute[]
  warnings: CandidateSearchWarning[]
  /** Finalize reporting after scheduled work has settled. */
  finalize?(): void
}

export interface RouteSearchContext {
  /** Normal predictions shared across counter records. */
  normalPredictions?: Map<number, RestorationBonusSet>
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
 * A Route base as defined by SEARCH_SPEC 5.5.1: one Normal Counter and
 * `candidateOffset`, one owned Normal source, or one owned Gogma source.
 *
 * The Bonus and Skill stream predictions are shared across Route bases, but the
 * base itself is not: a different source OwnedWeapon, a different forge count,
 * or different inherited five slots stay separate Route bases even when they
 * reach the same completed result.
 */
export interface RouteCompositionBase {
  /**
   * Conversion Routes have a fixed RouteKind. Existing-Gogma Routes derive it
   * from the composed `(gogmaAdvance, resetCount)` pair instead.
   */
  kindResolution:
    | { type: 'fixed'; kind: BuildRoute['kind'] }
    | { type: 'existing_gogma' }
  sourceOwnedWeaponId: OwnedWeaponId | null
  /** `create_normal_artian` / `convert_normal_to_gogma`, in execution order. */
  baseOperations: readonly RouteOperation[]
  /**
   * The Skills `convert_normal_to_gogma` assigns for this base, or `null` for a
   * base without a conversion (SEARCH_SPEC 5.5.2.2).
   *
   * Required rather than optional so every Route base states which case it is:
   * an existing-Gogma base's own current Skills are not a conversion result and
   * must never be reported as one.
   */
  conversionSkill: SkillAmendmentResult | null
  bonusSolutions: readonly RouteBonusSolution[]
  skillSolutions: readonly RouteSkillSolution[]
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
 * A Route base whose current Gogma-scope five slots match `idealBonuses`
 * searches no Bonus amendment at all, so it consumes no `maxGogmaAdvance` position and
 * calls `predictGogmaBonus` zero times. The Skill stream keeps running.
 */
export function bonusesSatisfyIdeal(
  context: RouteSearchContext,
  bonuses: RestorationBonusSet,
  restorationBonusScope: RestorationBonusScope,
): boolean {
  return satisfiesIdealBonuses(context.target, bonuses, restorationBonusScope, context.input.master)
}

/**
 * The Route base's Skill solutions: the zero-operation solution plus the shared
 * stream's Reset Skills solutions (SEARCH_SPEC 5.5.2 / 5.5.5).
 *
 * `set` is `null` when the Skill stream was not solved for this base, either
 * because Skill prediction is unavailable or because the current Skills already
 * satisfy the Ideal condition. The zero-operation solution still exists.
 */
export function routeSkillSolutions(
  set: SkillStreamSolutionSet | null,
  zeroSolution: RouteSkillSolution,
  sourceOwnedWeaponId: OwnedWeaponId | null,
  skillAdvanceOffset: number,
): RouteSkillSolution[] {
  if (!set) return [zeroSolution]
  return [
    zeroSolution,
    ...set.solutions.map((solution) => ({
      resetCount: solution.resetCount,
      seriesSkillId: solution.seriesSkillId,
      groupSkillId: solution.groupSkillId,
      estimatedSkillAdvance: solution.resetCount + skillAdvanceOffset,
      operations: resetSkillsOperations(
        set,
        solution.resetCount,
        sourceOwnedWeaponId,
      ),
      amendmentResults: skillAmendmentResults(set, solution.resetCount),
    })),
  ]
}

/**
 * The Route base's Bonus solutions: the zero-operation solution plus the shared
 * stream's amendment solutions (SEARCH_SPEC 5.5.3 / 5.5.5).
 *
 * `set` is `null` when no amendment was searched for this base, either because
 * Gogma prediction is unavailable, the source is protected, or the current
 * Gogma-scope five slots already match `idealBonuses`.
 */
export function routeBonusSolutions(
  set: BonusStreamSolutionSet | null,
  zeroSolution: RouteBonusSolution,
  sourceOwnedWeaponId: OwnedWeaponId | null,
): RouteBonusSolution[] {
  if (!set) return [zeroSolution]
  return [
    zeroSolution,
    ...set.solutions.map((solution) => ({
      gogmaAdvance: solution.depth,
      lastResetDepth: solution.lastResetDepth,
      finalBonuses: solution.bonuses,
      restorationBonusScope: solution.restorationBonusScope,
      operations: bonusAmendmentOperations(set, solution, sourceOwnedWeaponId),
      amendmentResults: bonusAmendmentResults(solution),
    })),
  ]
}

/**
 * The Search composition boundary's fail-loud check that a conversion Route
 * really carries its conversion Skill observation and a non-conversion Route
 * does not (SEARCH_SPEC 5.5.2.2).
 *
 * The correspondence is structural here rather than best effort: every Search
 * Route base states its `conversionSkill`, so a base whose operations disagree
 * with it is an internal inconsistency, never a Candidate that silently drops
 * the display.
 */
export function conversionSkillPrediction(
  route: BuildRoute,
  conversionSkill: SkillAmendmentResult | null,
): SkillAmendmentResult | undefined {
  const hasConversion = route.operations.some(
    (operation) => operation.type === 'convert_normal_to_gogma',
  )
  if (hasConversion === (conversionSkill !== null)) {
    return conversionSkill ?? undefined
  }
  throw new CandidateSearchError(
    'invalid_candidate',
    hasConversion
      ? 'A conversion Route base must supply the predicted initial Skills of its conversion.'
      : 'A Route base without a conversion operation must not supply a conversion Skill result.',
  )
}

export function createBaseCandidate(
  context: RouteSearchContext,
  bonuses: RestorationBonusSet,
  restorationBonusScope: RestorationBonusScope,
  seriesSkillId: SeriesSkillId | null,
  groupSkillId: GroupSkillId | null,
  route: BuildRoute,
  bonusAmendmentResults: readonly BonusAmendmentResult[],
  skillAmendmentResults: readonly SkillAmendmentResult[],
  conversionSkill: SkillAmendmentResult | null,
): BuildCandidate | null {
  const conversionSkillResult = conversionSkillPrediction(route, conversionSkill)
  return createCandidateFromPrediction(
    context.target,
    {
      finalBonuses: bonuses,
      restorationBonusScope,
      seriesSkillId,
      groupSkillId,
      route,
      bonusAmendmentResults,
      skillAmendmentResults,
      ...(conversionSkillResult === undefined ? {} : { conversionSkillResult }),
    },
    context.input,
    context.execution,
  )
}

/**
 * The existing-Gogma RouteKind of one composed `(d, k)` pair.
 *
 * The canonical amendment history is Reset for depths `1 ... lastResetDepth`
 * and Keep afterwards, so the Bonus-only kind follows from those two numbers.
 * `d = 0` with `k = 0` produces an empty operation list, which is not a
 * Candidate: that weapon already satisfies the Target and the Planner derives
 * the satisfaction from the owned Gogma directly (SEARCH_SPEC 5.5.5).
 */
export function existingGogmaRouteKind(
  bonus: RouteBonusSolution,
  skill: RouteSkillSolution,
): BuildRoute['kind'] | null {
  if (bonus.gogmaAdvance === 0) {
    return skill.resetCount === 0 ? null : 'existing_gogma_reset_skills'
  }
  if (skill.resetCount > 0) return 'existing_gogma_mixed'
  if (bonus.lastResetDepth === bonus.gogmaAdvance) {
    return 'existing_gogma_reset_bonuses'
  }
  return bonus.lastResetDepth === 0
    ? 'existing_gogma_keep_bonuses'
    : 'existing_gogma_mixed'
}

function routeKindFor(
  base: RouteCompositionBase,
  bonus: RouteBonusSolution,
  skill: RouteSkillSolution,
): BuildRoute['kind'] | null {
  return base.kindResolution.type === 'fixed'
    ? base.kindResolution.kind
    : existingGogmaRouteKind(bonus, skill)
}

/**
 * Composes one Route base's independently solved Bonus and Skill solutions with
 * the Cross rule (SEARCH_SPEC 5.5.4).
 *
 * No prediction happens here, so composing more Bonus states, more source
 * weapons, or more Normal offsets never adds a `predictSkills` or
 * `predictGogmaBonus` call. The number of Candidates built per Route base is
 * bounded by `|B(c)| + |K(c)| - 1` summed over the two category predicates,
 * never by `|B(c)| * |K(c)|`.
 *
 * The category predicate only selects which stream solutions enter an axis. The
 * final `category`, `idealDifference`, `similarityScore`, and `isSimilarToIdeal`
 * always come from the existing Target evaluator inside
 * `createCandidateFromPrediction()`.
 */
export async function composeRouteCandidates(
  context: RouteSearchContext,
  base: RouteCompositionBase,
): Promise<BuildCandidate[]> {
  const bonusSet = buildBonusSolutionSet(
    context.target,
    context.input,
    base.bonusSolutions,
  )
  const skillSet = buildSkillSolutionSet(context.target, base.skillSolutions)
  const candidates: BuildCandidate[] = []
  // The Ideal and Practical Cross series can select the same pair; the pair is
  // built once here so the Candidate count stays linear in the axis lengths.
  const composed = new Set<string>()

  for (const category of streamCategories) {
    const pairs = crossStreamSolutions(
      selectBonusAxis(bonusSet, category),
      selectSkillAxis(skillSet, category),
    )
    for (const pair of pairs) {
      const pairKey = `${pair.bonus.index},${pair.skill.index}`
      if (composed.has(pairKey)) continue
      composed.add(pairKey)
      const bonus = pair.bonus.solution
      const skill = pair.skill.solution
      const kind = routeKindFor(base, bonus, skill)
      if (kind === null) continue
      const operations = [
        ...base.baseOperations,
        ...bonus.operations,
        ...skill.operations,
      ]
      if (operations.length === 0) continue
      await context.execution.checkpoint()
      const candidate = createBaseCandidate(
        context,
        bonus.finalBonuses,
        bonus.restorationBonusScope,
        skill.seriesSkillId,
        skill.groupSkillId,
        { kind, sourceOwnedWeaponId: base.sourceOwnedWeaponId, operations },
        bonus.amendmentResults,
        skill.amendmentResults,
        base.conversionSkill,
      )
      if (candidate) candidates.push(candidate)
    }
  }
  return candidates
}
