import type { TargetSearchScheduler } from './targetSearchScheduler'
import type { RouteOperation } from '../models/publicTypes'
import { V1_NORMAL_ARTIAN_RARITY } from '../models/publicTypes'
import type { BonusStreamNotice } from './targetSearchScheduler'
import {
  hasConfirmedGogmaInputs,
  hasConfirmedSkillInputs,
  type RouteSearchContext,
  type RouteSearchResult,
} from './routeSearchShared'
import { selectSearchableNormalCounters } from './routeEligibility'
import type {
  CandidateSearchNoticeSeverity,
  CandidateSearchWarning,
  SkippedRouteReason,
} from './searchTypes'
import type { RouteSkillSolution } from './streamSolutions'

interface RouteSkip {
  reason: SkippedRouteReason
  detail: string
}

/**
 * Why the predicted Normal Artian variant of SEARCH_SPEC 6.1 cannot run.
 *
 * It needs a confirmed Normal Artian Counter, a confirmed Base Seed, and
 * Normal Artian prediction, because it reads the forged weapon's five slots.
 */
function predictedNormalSkip(context: RouteSearchContext): RouteSkip | null {
  const { engine, input, target } = context
  if (selectSearchableNormalCounters(target, input.normalCounters).length === 0) {
    return {
      reason: 'normal_counter_unconfirmed',
      detail: `No confirmed Normal Artian Counter is available for '${target.weaponTypeId}'.`,
    }
  }
  if (!input.rngState.baseSeed.isConfirmed || input.rngState.baseSeed.value === null) {
    return {
      reason: 'rng_state_unconfirmed',
      detail: 'A confirmed Base Seed is required for Normal prediction.',
    }
  }
  if (!engine.capabilities.supportsNormalArtianPrediction) {
    return {
      reason: 'normal_prediction_unsupported',
      detail: 'The active RNG Engine does not support Normal Artian prediction.',
    }
  }
  const normalSupport = context.predictionSupport.normalArtian()
  if (!normalSupport.supported) {
    return {
      reason: 'normal_prediction_unsupported',
      detail: `The active RNG Engine does not support this Normal Artian input (${normalSupport.reason}).`,
    }
  }
  return null
}

/** Conversion is required by both variants of this RouteKind. */
function conversionSkip(context: RouteSearchContext): RouteSkip | null {
  const { engine, input } = context
  if (!hasConfirmedSkillInputs(input)) {
    return {
      reason: 'rng_state_unconfirmed',
      detail: 'Confirmed Base Seed and Skill Counter are required for conversion.',
    }
  }
  if (!engine.capabilities.supportsSkillPrediction) {
    return {
      reason: 'skill_prediction_unsupported',
      detail: 'The active RNG Engine does not support Skill prediction required for conversion.',
    }
  }
  const skillSupport = context.predictionSupport.skill()
  if (!skillSupport.supported) {
    return {
      reason: 'skill_prediction_unsupported',
      detail: `The active RNG Engine does not support this Skill input (${skillSupport.reason}).`,
    }
  }
  return null
}

/** Why Reset Bonuses cannot be predicted from the current Gogma position. */
function resetBonusesSkip(context: RouteSearchContext): RouteSkip | null {
  const { engine, input } = context
  if (!hasConfirmedGogmaInputs(input)) {
    return {
      reason: 'rng_state_unconfirmed',
      detail: 'Confirmed Base Seed and Gogma Counter are required for Reset Bonuses.',
    }
  }
  if (!engine.capabilities.supportsGogmaPrediction) {
    return {
      reason: 'gogma_prediction_unsupported',
      detail: 'The active RNG Engine does not support Gogma bonus prediction.',
    }
  }
  const resetSupport = context.predictionSupport.gogmaReset()
  if (!resetSupport.supported) {
    return {
      reason: 'gogma_prediction_unsupported',
      detail: `The active RNG Engine does not support this Reset Bonuses input (${resetSupport.reason}).`,
    }
  }
  return null
}

function addWarning(
  result: RouteSearchResult,
  targetWeaponId: CandidateSearchWarning['targetWeaponId'],
  severity: CandidateSearchNoticeSeverity,
  message: string,
): void {
  if (result.warnings.some((warning) => warning.message === message)) return
  result.warnings.push({ targetWeaponId, severity, message })
}

/**
 * How the forced Reset Bonuses route (SEARCH_SPEC 6.1.1) is announced to the
 * user.
 *
 * The route really was searched and its Candidates are ordinary Candidates, so
 * this is an informational notice rather than a warning: the text says what was
 * searched before it says what was unavailable. `docs/UI_FLOW.md` 9 forbids
 * showing an internal reason enum in the normal UI, so the reason only selects
 * which sentence is used and never appears in the text. The two supported
 * causes are genuinely different facts and must not be collapsed into one: an
 * unconfirmed Counter is not the same as missing Normal prediction, and a
 * Counter can be confirmed while only the prediction is unavailable.
 */
function blindResetSearchedMessage(reason: SkippedRouteReason): string {
  const cause =
    reason === 'normal_counter_unconfirmed'
      ? '通常アーティアのカウンターが未確定のため、作成直後の復元ボーナスは予測していません。'
      : '通常アーティアの初期復元ボーナス予測を利用できないため、作成直後の復元ボーナスは予測していません。'
  return [
    '通常アーティアの初期ボーナスを使わないルートで検索しました。',
    cause,
    '通常アーティアを1本作成して巨戟化したあと、復元ボーナスを再抽選して5枠を確定するルートを検索しています。',
  ].join('\n')
}

/**
 * The counterpart notice for the case where the forced Reset route is not
 * available either, so the whole RouteKind was skipped.
 *
 * This one stays a warning: nothing was searched for this RouteKind. The
 * predicted variant's own blocker is already reported as a `SkippedRoute`, so
 * the text explains only why the fallback could not stand in for it.
 */
function blindResetUnavailableMessage(reason: SkippedRouteReason): string {
  const cause =
    reason === 'rng_state_unconfirmed'
      ? '巨戟アーティアのカウンターが未確定のため、復元ボーナスの再抽選を予測できません。'
      : '現在の予測エンジンでは復元ボーナスの再抽選を予測できません。'
  return [
    '通常アーティアの初期ボーナスを使わないルートも実行できなかったため、通常アーティア経由のルートは検索していません。',
    cause,
  ].join('\n')
}

interface ConversionBase {
  skillCounter: number
  skillCounterAfter: number
  zeroSkill: RouteSkillSolution
}

export async function searchNormalArtianRoutes(
  context: RouteSearchContext,
  scheduler: TargetSearchScheduler,
): Promise<RouteSearchResult> {
  const { engine, input, target } = context
  const result: RouteSearchResult = {
    candidates: [],
    searchedRoutes: [],
    skippedRoutes: [],
    warnings: [],
  }

  const normalSkip = predictedNormalSkip(context)
  const conversionUnavailable = conversionSkip(context)
  if (conversionUnavailable) {
    // Conversion is required by both variants, so neither can run. The
    // predicted variant reports its own blocker first, preserving the existing
    // skip reason whenever a confirmed Normal Counter is genuinely missing.
    result.skippedRoutes.push({
      route: 'normal_artian_to_gogma',
      ...(normalSkip ?? conversionUnavailable),
    })
    return result
  }

  const skillCounter = input.rngState.skillCounter.value
  if (skillCounter === null) return result
  /**
   * The conversion assigns the initial Series / Group Skills at the current
   * Skill position, identically for both variants of this RouteKind.
   *
   * It stays lazy so a Route that is never registered predicts nothing, exactly
   * as before this variant existed.
   */
  const conversion = (): ConversionBase => {
    const skills = context.skillStream.predictAt(skillCounter)
    return {
      skillCounter,
      skillCounterAfter: engine.advanceSkillCounter(skillCounter, {
        type: 'convert_normal_to_gogma',
      }),
      zeroSkill: {
        resetCount: 0,
        seriesSkillId: skills.seriesSkillId,
        groupSkillId: skills.groupSkillId,
        estimatedSkillAdvance: 1,
        operations: [],
        amendmentResults: [],
      },
    }
  }
  const onBonusNotice = (notice: BonusStreamNotice): void => {
    if (notice.type !== 'unsupported') return
    addWarning(
      result,
      target.id,
      'warning',
      `${notice.prediction.type} was excluded from the Normal Artian route by input support (${notice.prediction.reason}).`,
    )
  }

  if (normalSkip === null) {
    searchPredictedNormalRoutes(context, scheduler, result, conversion, onBonusNotice)
    return result
  }
  searchBlindResetNormalRoute(context, scheduler, result, conversion, onBonusNotice, normalSkip)
  return result
}

/**
 * The forced Reset Bonuses Normal Artian route (SEARCH_SPEC 6.1.1).
 *
 * Exactly one Normal Artian is forged and its five slots are never predicted,
 * so neither a confirmed Normal Artian Counter nor Normal Artian prediction is
 * required. The Route is well defined only because its first bonus amendment is
 * always Reset Bonuses, which redraws all five slots from the Gogma Counter
 * position alone and therefore reads nothing the forge produced.
 */
function searchBlindResetNormalRoute(
  context: RouteSearchContext,
  scheduler: TargetSearchScheduler,
  result: RouteSearchResult,
  conversion: () => ConversionBase,
  onBonusNotice: (notice: BonusStreamNotice) => void,
  normalSkip: RouteSkip,
): void {
  const { input, target } = context
  const resetSkip = resetBonusesSkip(context)
  if (resetSkip !== null) {
    result.skippedRoutes.push({ route: 'normal_artian_to_gogma', ...normalSkip })
    addWarning(result, target.id, 'warning', blindResetUnavailableMessage(resetSkip.reason))
    return
  }

  result.searchedRoutes.push('normal_artian_to_gogma')
  addWarning(result, target.id, 'info', blindResetSearchedMessage(normalSkip.reason))
  scheduler.queue.enqueue({
    // create + convert + the mandatory first Reset Bonuses.
    lowerBound: 3,
    async settle() {
      const converted = conversion()
      const operations: RouteOperation[] = [
        {
          type: 'create_normal_artian',
          weaponTypeId: target.weaponTypeId,
          rarity: V1_NORMAL_ARTIAN_RARITY,
          count: 1,
          normalCounterBefore: null,
          normalCounterAfter: null,
        },
        {
          type: 'convert_normal_to_gogma',
          weaponTypeId: target.weaponTypeId,
          skillCounterBefore: converted.skillCounter,
          skillCounterAfter: converted.skillCounterAfter,
        },
      ]
      scheduler.addBase({
        kindResolution: { type: 'fixed', kind: 'normal_artian_to_gogma' },
        sourceOwnedWeaponId: null,
        baseOperations: operations,
        // No zero-amendment solution exists: the inherited five slots are
        // unknown, and no fabricated bonus set stands in for them. The Bonus
        // axis therefore starts at the first Reset Bonuses.
        zeroBonus: null,
        zeroSkill: converted.zeroSkill,
        startSkillCounter: converted.skillCounterAfter,
        bonusBase: {
          startGogmaCounter: input.rngState.gogmaCounter.value as number,
          bonuses: null,
          restorationBonusScope: 'normal_artian',
        },
        onCandidate: (candidate) => result.candidates.push(candidate),
        onBonusNotice,
      })
    },
  })
}

/** The predicted Normal Artian route of SEARCH_SPEC 6.1, unchanged. */
function searchPredictedNormalRoutes(
  context: RouteSearchContext,
  scheduler: TargetSearchScheduler,
  result: RouteSearchResult,
  conversion: () => ConversionBase,
  onBonusNotice: (notice: BonusStreamNotice) => void,
): void {
  const { engine, input, target } = context
  const baseSeed = input.rngState.baseSeed.value as string
  const counters = selectSearchableNormalCounters(target, input.normalCounters)
  let canSearchAmendments =
    hasConfirmedGogmaInputs(input) && engine.capabilities.supportsGogmaPrediction
  if (canSearchAmendments) {
    const resetSupport = context.predictionSupport.gogmaReset()
    if (!resetSupport.supported) {
      addWarning(
        result,
        target.id,
        'warning',
        `Reset Bonuses was excluded from the Normal Artian route by input support (${resetSupport.reason}).`,
      )
      canSearchAmendments = false
    }
  }
  result.searchedRoutes.push('normal_artian_to_gogma')
  for (const counter of counters) {
    if (counter.counter === null) continue
    const start = counter.counter
    const scheduleOffset = (offset: number): void => {
      if (offset >= input.settings.maxNormalAdvance) return
      const forgeCount = offset + 1
      scheduler.queue.enqueue({
        lowerBound: forgeCount + 1,
        async settle() {
          const converted = conversion()
          const candidateCounter = start + offset
          const bonuses = context.normalPredictions?.get(candidateCounter) ?? engine.predictNormalArtian({
            baseSeed, weaponTypeId: target.weaponTypeId, elementId: target.elementId,
            rarity: counter.rarity, normalCounter: candidateCounter, master: input.master,
          })
          context.normalPredictions?.set(candidateCounter, bonuses)
          const normalCounterAfter = engine.advanceNormalCounter(start, { type: 'create_normal_artian', count: forgeCount })
          const operations: RouteOperation[] = [
            { type: 'create_normal_artian', weaponTypeId: target.weaponTypeId, rarity: counter.rarity, count: forgeCount, normalCounterBefore: start, normalCounterAfter },
            { type: 'convert_normal_to_gogma', weaponTypeId: target.weaponTypeId, skillCounterBefore: converted.skillCounter, skillCounterAfter: converted.skillCounterAfter },
          ]
          scheduler.addBase({
            kindResolution: { type: 'fixed', kind: 'normal_artian_to_gogma' },
            sourceOwnedWeaponId: null,
            baseOperations: operations,
            zeroBonus: { gogmaAdvance: 0, lastResetDepth: 0, finalBonuses: bonuses, restorationBonusScope: 'normal_artian', operations: [], amendmentResults: [] },
            zeroSkill: converted.zeroSkill,
            startSkillCounter: converted.skillCounterAfter,
            bonusBase: canSearchAmendments ? { startGogmaCounter: input.rngState.gogmaCounter.value as number, bonuses, restorationBonusScope: 'normal_artian' } : null,
            onCandidate: (candidate) => result.candidates.push(candidate),
            onBonusNotice,
          })
          // This cursor advances once; no previous offset is registered again.
          scheduleOffset(offset + 1)
        },
      })
    }
    scheduleOffset(0)
  }
}
