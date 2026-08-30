import type { OwnedWeapon, RestorationBonusScope } from './publicTypes'

type LegacyOwnedWeapon = Omit<OwnedWeapon, 'restorationBonusScope'> & {
  restorationBonusScope?: RestorationBonusScope
}

/** Read/import boundary normalization for pre-B1 records only. */
export function normalizeOwnedWeaponRestorationBonusScope(
  weapon: LegacyOwnedWeapon,
): OwnedWeapon {
  if (weapon.restorationBonusScope !== undefined) return weapon as OwnedWeapon
  return {
    ...weapon,
    restorationBonusScope:
      weapon.kind === 'normal' ? 'normal_artian' : 'gogma_artian',
  } as OwnedWeapon
}
