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
import { createCandidateFromPrediction } from './candidateFactory'
import type { SearchExecutionContext } from './searchExecution'
import type { CandidateSearchInput, CandidateSearchWarning, SkippedRoute } from './searchTypes'
import { stableStringify } from '../models/publicTypes'

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

export interface SkillVariantBase {
  bonuses: RestorationBonusSet
  restorationBonusScope: RestorationBonusScope
  operations: RouteOperation[]
  sourceOwnedWeaponId: OwnedWeaponId | null
  resetSkillsSourceOwnedWeaponId?: OwnedWeaponId | null
  skillCounterBefore?: number
  kind: BuildRoute['kind']
}

export interface AmendmentSearchBase extends SkillVariantBase {
  seriesSkillId: SeriesSkillId | null
  groupSkillId: GroupSkillId | null
  gogmaCounterBefore: number
  amendmentSourceOwnedWeaponId: OwnedWeaponId | null
  kindForAmendment?(operations: RouteOperation[]): BuildRoute['kind']
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

export async function searchResetSkillVariants(
  context: RouteSearchContext,
  base: SkillVariantBase,
): Promise<BuildCandidate[]> {
  const { engine, execution, input, target } = context
  const baseSeed = input.rngState.baseSeed.value
  const start = base.skillCounterBefore ?? input.rngState.skillCounter.value
  if (
    !hasConfirmedSkillInputs(input) ||
    baseSeed === null ||
    start === null
  ) return []
  if (!engine.capabilities.supportsSkillPrediction) return []
  if (!context.predictionSupport.skill().supported) return []

  const resetSource = base.resetSkillsSourceOwnedWeaponId === undefined
    ? base.sourceOwnedWeaponId
    : base.resetSkillsSourceOwnedWeaponId
  const candidates: BuildCandidate[] = []
  const resetOperations: RouteOperation[] = []
  let skillCounter = start

  for (let index = 0; index < input.settings.maxSkillAdvance; index += 1) {
    await execution.checkpoint()
    const skills = engine.predictSkills({
      baseSeed,
      skillCounter,
      weaponTypeId: target.weaponTypeId,
      elementId: target.elementId,
      master: input.master,
    })
    const nextSkillCounter = engine.advanceSkillCounter(skillCounter, {
      type: 'reset_skills',
    })
    resetOperations.push({
      type: 'reset_skills',
      sourceOwnedWeaponId: resetSource,
      skillCounterBefore: skillCounter,
      skillCounterAfter: nextSkillCounter,
    })
    const candidate = createBaseCandidate(
      context,
      base.bonuses,
      base.restorationBonusScope,
      skills.seriesSkillId,
      skills.groupSkillId,
      {
        kind: base.kind,
        sourceOwnedWeaponId: base.sourceOwnedWeaponId,
        operations: [...base.operations, ...resetOperations],
      },
    )
    if (candidate) candidates.push(candidate)
    skillCounter = nextSkillCounter
  }
  return candidates
}

/**
 * Explores only verified amendment operations. A normal-scope Gogma must Reset
 * before Keep; every later state may Reset or Keep, and Keep receives the last
 * complete five-slot result as its explicit input.
 */
export async function searchBonusAmendmentVariants(
  context: RouteSearchContext,
  base: AmendmentSearchBase,
): Promise<BonusAmendmentSearchResult> {
  const { engine, execution, input, target } = context
  const baseSeed = input.rngState.baseSeed.value
  const emptyResult = (): BonusAmendmentSearchResult => ({
    candidates: [],
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
  const candidates: BuildCandidate[] = []
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
        const candidate = createBaseCandidate(
          context,
          next.bonuses,
          next.scope,
          base.seriesSkillId,
          base.groupSkillId,
          {
            kind,
            sourceOwnedWeaponId: base.sourceOwnedWeaponId,
            operations: next.operations,
          },
        )
        if (candidate) candidates.push(candidate)
        if (
          hasConfirmedSkillInputs(input) &&
          engine.capabilities.supportsSkillPrediction &&
          context.predictionSupport.skill().supported
        ) {
          if (kind.startsWith('existing_gogma_')) {
            searchedRoutes.add('existing_gogma_mixed')
          }
          candidates.push(...await searchResetSkillVariants(context, {
            bonuses: next.bonuses,
            restorationBonusScope: next.scope,
            operations: next.operations,
            sourceOwnedWeaponId: base.sourceOwnedWeaponId,
            resetSkillsSourceOwnedWeaponId: base.amendmentSourceOwnedWeaponId,
            skillCounterBefore: base.skillCounterBefore,
            kind: kind.startsWith('existing_gogma_') ? 'existing_gogma_mixed' : kind,
          }))
        }
        // Reset ignores the current bonuses, so several histories routinely
        // converge here. Keep the first canonical history for each state;
        // every result is still emitted above as a candidate.
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
    candidates,
    searchedRoutes: [...searchedRoutes],
    unsupportedPredictions: [...unsupportedPredictions.values()],
  }
}

export interface UnsupportedAmendmentPrediction {
  type: 'reset_bonuses' | 'keep_bonuses'
  reason: RngPredictionUnsupportedReason
}

export interface BonusAmendmentSearchResult {
  candidates: BuildCandidate[]
  searchedRoutes: BuildRoute['kind'][]
  unsupportedPredictions: UnsupportedAmendmentPrediction[]
}

export function hasConfirmedSkillInputs(input: CandidateSearchInput): boolean {
  return input.rngState.baseSeed.isConfirmed && input.rngState.baseSeed.value !== null
    && input.rngState.skillCounter.isConfirmed && input.rngState.skillCounter.value !== null
}

export function hasConfirmedGogmaInputs(input: CandidateSearchInput): boolean {
  return input.rngState.baseSeed.isConfirmed && input.rngState.baseSeed.value !== null
    && input.rngState.gogmaCounter.isConfirmed && input.rngState.gogmaCounter.value !== null
}
