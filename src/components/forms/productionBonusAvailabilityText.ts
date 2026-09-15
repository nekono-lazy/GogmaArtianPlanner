import type { ProductionBonusAvailabilityError } from '../../domain/artian/productionBonusAvailability'

/**
 * The label of a stored value outside the Production bonus availability.
 *
 * Such a value is shown so the user can recognise it and replace it, but the
 * option carrying it is always disabled: it is never offered as a normal
 * selectable candidate, and nothing rewrites it automatically
 * (`docs/UI_FLOW.md` 7, `docs/DATA_MODEL.md` 7.1).
 */
export function legacyBonusOptionLabel(name: string): string {
  return `${name}（現在値・Production抽選対象外）`
}

export function productionBonusAvailabilityErrorMessage(
  error: ProductionBonusAvailabilityError,
): string {
  return error.reason === 'no_available_definitions'
    ? '復元ボーナスのマスターデータが利用できません。'
    : 'この武器種・属性の復元ボーナス抽選対象を判定できません。'
}
