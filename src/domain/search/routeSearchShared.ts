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
import { V1_NORMAL_ARTIAN_RARITY } from '../models/publicTypes'
import type {
  RngEngine,
  RngPredictionSupport,
  RngPredictionUnsupportedReason,
} from '../rng/rngEngine'
import { evaluateSkillCondition } from '../target'
import { createCandidateFromPrediction } from './candidateFactory'
import type { SearchExecutionContext } from './searchExecution'
import type { CandidateSearchInput, CandidateSearchWarning, SkippedRoute } from './searchTypes'
import {
  resetSkillsOperations,
  type SkillStreamSolutionSet,
  type TargetSkillStream,
} from './skillStream'
import { stableStringify } from '../models/publicTypes'

export { hasConfirmedGogmaInputs, hasConfirmedSkillInputs } from './searchRngInputs'

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
}

export interface SearchPredictionSupport {
  normalArtian(): RngPredictionSupport
  skill(): RngPredictionSupport
  gogmaReset(): RngPredictionSupport
  gogmaKeep(currentBonuses: RestorationBonusSet): RngPredictionSupport
}

export function createSearchPredictionSupport(
  engine: RngEngine,
  target: TargetWeapon,
  master: CandidateSearchInput['master'],
): SearchPredictionSupport {
  let normalArtian: RngPredictionSupport | null = null
  let skill: RngPredictionSupport | null = null
  let gogmaReset: RngPredictionSupport | null = null
  const gogmaKeep = new Map<string, RngPredictionSupport>()

  return {
    normalArtian: () => normalArtian ??= engine.getPredictionSupport({
      type: 'normal_artian',
      weaponTypeId: target.weaponTypeId,
      elementId: target.elementId,
      rarity: V1_NORMAL_ARTIAN_RARITY,
    }),
    skill: () => skill ??= engine.getPredictionSupport({
      type: 'skill',
      weaponTypeId: target.weaponTypeId,
      elementId: target.elementId,
    }),
    gogmaReset: () => gogmaReset ??= engine.getPredictionSupport({
      type: 'gogma_reset',
      weaponTypeId: target.weaponTypeId,
      elementId: target.elementId,
      master,
    }),
    gogmaKeep: (currentBonuses) => {
      const key = stableStringify(currentBonuses)
      const cached = gogmaKeep.get(key)
      if (cached) return cached
      const support = engine.getPredictionSupport({
        type: 'gogma_keep',
        weaponTypeId: target.weaponTypeId,
        elementId: target.elementId,
        currentBonuses,
      })
      gogmaKeep.set(key, support)
      return support
    },
  }
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

export interface AmendmentSearchBase {
  bonuses: RestorationBonusSet
  restorationBonusScope: RestorationBonusScope
  operations: readonly RouteOperation[]
  gogmaCounterBefore: number
  amendmentSourceOwnedWeaponId: OwnedWeaponId | null
  kind: BuildRoute['kind']
  kindForAmendment?(operations: RouteOperation[]): BuildRoute['kind']
}

/** One reached Bonus state, returned as a Bonus-side Route base. */
export interface BonusAmendmentResult {
  bonuses: RestorationBonusSet
  restorationBonusScope: RestorationBonusScope
  operations: RouteOperation[]
  kind: BuildRoute['kind']
}

/**
 * Explores only verified amendment operations. A normal-scope Gogma must Reset
 * before Keep; every later state may Reset or Keep, and Keep receives the last
 * complete five-slot result as its explicit input.
 *
 * This traversal belongs to the Bonus stream alone. It never reads or advances
 * the Skill stream, so `predictSkills` call count cannot grow with the number of
 * Gogma states.
 */
export async function searchBonusAmendmentVariants(
  context: RouteSearchContext,
  base: AmendmentSearchBase,
): Promise<BonusAmendmentSearchResult> {
  const { engine, execution, input, target } = context
  const baseSeed = input.rngState.baseSeed.value
  const emptyResult = (): BonusAmendmentSearchResult => ({
    results: [],
    searchedRoutes: [],
    unsupportedPredictions: [],
  })
  if (
    baseSeed === null ||
    !engine.capabilities.supportsGogmaPrediction
  ) return emptyResult()

  type State = {
    bonuses: RestorationBonusSet
    scope: RestorationBonusScope
    gogmaCounter: number
    operations: RouteOperation[]
  }

  type AmendmentHistoryClass = 'reset-only' | 'keep-only' | 'mixed'

  function amendmentHistoryClass(
    operations: readonly RouteOperation[],
  ): AmendmentHistoryClass {
    const hasReset = operations.some(({ type }) => type === 'reset_bonuses')
    const hasKeep = operations.some(({ type }) => type === 'keep_bonuses')
    if (hasReset && hasKeep) return 'mixed'
    return hasReset ? 'reset-only' : 'keep-only'
  }

  function compareCanonicalState(left: State, right: State): number {
    return left.operations.length - right.operations.length ||
      stableStringify(left.operations).localeCompare(stableStringify(right.operations))
  }
  let frontier: State[] = [{
    bonuses: structuredClone(base.bonuses),
    scope: base.restorationBonusScope,
    gogmaCounter: base.gogmaCounterBefore,
    operations: [...base.operations],
  }]
  const results: BonusAmendmentResult[] = []
  const searchedRoutes = new Set<BuildRoute['kind']>()
  const unsupportedPredictions = new Map<string, UnsupportedAmendmentPrediction>()

  for (let depth = 0; depth < input.settings.maxGogmaAdvance; depth += 1) {
    const nextFrontier = new Map<string, State>()
    for (const state of frontier) {
      const operations = state.scope === 'normal_artian' || !engine.capabilities.supportsKeepBonusesPrediction
        ? ['reset_bonuses'] as const
        : ['reset_bonuses', 'keep_bonuses'] as const
      for (const type of operations) {
        await execution.checkpoint()
        const support = type === 'reset_bonuses'
          ? context.predictionSupport.gogmaReset()
          : context.predictionSupport.gogmaKeep(state.bonuses)
        if (!support.supported) {
          const unsupported = { type, reason: support.reason }
          unsupportedPredictions.set(`${type}\u0000${support.reason}`, unsupported)
          continue
        }
        const prediction = engine.predictGogmaBonus({
          baseSeed,
          gogmaCounter: state.gogmaCounter,
          weaponTypeId: target.weaponTypeId,
          elementId: target.elementId,
          operation: type === 'reset_bonuses'
            ? { type }
            : { type, currentBonuses: state.bonuses },
          master: input.master,
        })
        const nextCounter = engine.advanceGogmaCounter(state.gogmaCounter, { type })
        const operation: RouteOperation = {
          type,
          sourceOwnedWeaponId: base.amendmentSourceOwnedWeaponId,
          gogmaCounterBefore: state.gogmaCounter,
          gogmaCounterAfter: nextCounter,
        }
        const next: State = {
          bonuses: prediction,
          scope: 'gogma_artian',
          gogmaCounter: nextCounter,
          operations: [...state.operations, operation],
        }
        const kind = base.kindForAmendment?.(next.operations) ?? base.kind
        searchedRoutes.add(kind)
        results.push({
          bonuses: next.bonuses,
          restorationBonusScope: next.scope,
          operations: next.operations,
          kind,
        })
        // Reset ignores the current bonuses, so several histories routinely
        // converge here. Keep the first canonical history for each state;
        // every reached state is still returned above for composition.
        const semanticKey = stableStringify({
          bonuses: next.bonuses,
          gogmaCounter: next.gogmaCounter,
          historyClass: amendmentHistoryClass(next.operations),
          scope: next.scope,
        })
        const current = nextFrontier.get(semanticKey)
        if (!current || compareCanonicalState(next, current) < 0) {
          nextFrontier.set(semanticKey, next)
        }
      }
    }
    frontier = [...nextFrontier.values()]
  }
  return {
    results,
    searchedRoutes: [...searchedRoutes],
    unsupportedPredictions: [...unsupportedPredictions.values()],
  }
}

export interface UnsupportedAmendmentPrediction {
  type: 'reset_bonuses' | 'keep_bonuses'
  reason: RngPredictionUnsupportedReason
}

export interface BonusAmendmentSearchResult {
  results: BonusAmendmentResult[]
  searchedRoutes: BuildRoute['kind'][]
  unsupportedPredictions: UnsupportedAmendmentPrediction[]
}
