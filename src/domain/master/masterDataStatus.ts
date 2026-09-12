import type { MasterDataRoot } from './masterTypes'

export interface MasterDataStatus {
  isProductionReady: boolean
  reason: string | null
}

export type MasterDataFeature = 'core_ui' | 'search'

export function getMasterDataStatus(
  master: MasterDataRoot,
  feature: MasterDataFeature = 'core_ui',
): MasterDataStatus {
  const hasCoreData =
    master.weaponTypes.some(({ isEnabled }) => isEnabled) &&
    master.elements.some(({ isEnabled }) => isEnabled) &&
    master.weaponBonusDefinitions.some(
      ({ isEnabled, scope }) => isEnabled && scope === 'normal_artian',
    ) &&
    master.weaponBonusDefinitions.some(
      ({ isEnabled, scope }) => isEnabled && scope === 'gogma_artian',
    ) &&
    master.artianBonusTypeMappings.length > 0 &&
    master.seriesSkills.some(({ isEnabled }) => isEnabled) &&
    master.groupSkills.some(({ isEnabled }) => isEnabled)

  if (!hasCoreData) {
    return {
      isProductionReady: false,
      reason: '武器入力に必要なマスターデータが不足しています。推測した選択肢は表示しません。',
    }
  }

  if (feature === 'search' && !master.lotteries.some(({ isEnabled }) => isEnabled)) {
    return {
      isProductionReady: false,
      reason: '抽選マスターデータは未検証のため無効です。通常アーティア経由の検索は利用できません。アイテム素材コストも未検証です。',
    }
  }

  return { isProductionReady: true, reason: null }
}
