import type { MasterDataRoot } from './masterTypes'

/**
 * A Master Data condition that narrows what a feature can show without
 * making the feature itself unavailable.
 *
 * `material_cost_unverified`: no usable enabled `MaterialCostMaster` entry
 * exists, so the item materials a Route needs cannot be priced. Candidate
 * Search still runs; its `requiredMaterials` means "unknown", never "zero",
 * and no unverified cost takes part in any material comparison
 * (`docs/MASTER_DATA_STATUS.md`, `docs/SEARCH_SPEC.md` 4.1).
 */
export type MasterDataAdvisoryKind = 'material_cost_unverified'

export interface MasterDataAdvisory {
  kind: MasterDataAdvisoryKind
  message: string
}

/**
 * Whether a feature can run on the loaded Master, and what it must caveat.
 *
 * `isProductionReady` is false only for a `blockingReason`: a Master gap that
 * makes the feature unusable. An advisory never lowers readiness. The
 * provisional `LotteryMaster` is never consulted here: Production RNG reads
 * its own reference-verified tables, and Route availability is decided
 * route-locally by RngState, RngEngine capability, `getPredictionSupport()`,
 * the semantic Masters a prediction actually needs, and Route eligibility -
 * never by this generic status.
 */
export interface MasterDataStatus {
  isProductionReady: boolean
  blockingReason: string | null
  advisories: readonly MasterDataAdvisory[]
}

export type MasterDataFeature = 'core_ui' | 'search'

export const MATERIAL_COST_UNVERIFIED_MESSAGE =
  '素材コストは未検証です。候補検索は利用できますが、候補の必要素材（アイテム）は表示できず、素材量による候補比較にも未検証の素材コストは使用しません。'

/**
 * Whether the loaded Master carries any usable item material cost.
 *
 * This is the current-state check only: "at least one enabled cost". It
 * claims nothing about completeness across operations or weapon types, because
 * no such authority exists in the repository.
 */
export function hasUsableMaterialCosts(
  master: Pick<MasterDataRoot, 'materialCosts'>,
): boolean {
  return master.materialCosts.some(({ isEnabled }) => isEnabled)
}

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
      blockingReason:
        '武器入力に必要なマスターデータが不足しています。推測した選択肢は表示しません。',
      advisories: [],
    }
  }

  const advisories: MasterDataAdvisory[] = []
  if (feature === 'search' && !hasUsableMaterialCosts(master)) {
    advisories.push({
      kind: 'material_cost_unverified',
      message: MATERIAL_COST_UNVERIFIED_MESSAGE,
    })
  }

  return { isProductionReady: true, blockingReason: null, advisories }
}
