import type { NormalArtianCounterIdentificationResult } from '../domain/rng/identification'
import type { RngPredictionUnsupportedReason } from '../domain/rng/rngEngine'

/** The formal result classes of `docs/RNG_SPEC.md` 9.12; only `unique` may be confirmed. */
export type NormalCounterIdentificationClassification = 'unique' | 'multiple' | 'zero' | 'truncated'

export function classifyNormalCounterIdentificationResult(
  result: NormalArtianCounterIdentificationResult,
): NormalCounterIdentificationClassification {
  if (result.isTruncated) return 'truncated'
  if (result.matches.length === 1) return 'unique'
  if (result.matches.length === 0) return 'zero'
  return 'multiple'
}

/**
 * The Japanese sentence for one structured unsupported reason. The reason only
 * selects the sentence; the enum text itself never reaches the ordinary UI.
 */
export function normalCounterIdentificationUnsupportedLabel(
  reason: RngPredictionUnsupportedReason | null,
): string {
  switch (reason) {
    case 'normal_pool_unverified':
      return 'この武器種の通常アーティア抽選テーブルはProduction検証対象外のため、Counter検索できません。'
    case 'engine_capability_unavailable':
      return '現在のRNG Engineは通常アーティア予測に対応していないため、Counter検索できません。'
    case 'reference_adapter_unsupported':
      return 'この武器種は現在のRNG Engineが扱えないため、Counter検索できません。'
    default:
      return 'この入力はCounter検索に対応していません。'
  }
}
