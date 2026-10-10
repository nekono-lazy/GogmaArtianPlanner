import { describe, expect, it } from 'vitest'
import {
  emptyWeaponListFilter,
  isWeaponListFilterActive,
  matchesWeaponListFilter,
} from './weaponListFilter'

const bowFire = { weaponTypeId: 'weapon.bow', elementId: 'element.fire' }
const bowWater = { weaponTypeId: 'weapon.bow', elementId: 'element.water' }
const lanceFire = { weaponTypeId: 'weapon.lance', elementId: 'element.fire' }

describe('weaponListFilter', () => {
  it('shows every item while cleared', () => {
    expect(isWeaponListFilterActive(emptyWeaponListFilter)).toBe(false)
    for (const item of [bowFire, bowWater, lanceFire]) {
      expect(matchesWeaponListFilter(item, emptyWeaponListFilter)).toBe(true)
    }
  })

  it('narrows by weapon type alone', () => {
    const filter = { weaponTypeId: 'weapon.bow', elementId: null }
    expect(isWeaponListFilterActive(filter)).toBe(true)
    expect([bowFire, bowWater, lanceFire].filter((item) => matchesWeaponListFilter(item, filter))).toEqual([bowFire, bowWater])
  })

  it('narrows by element alone', () => {
    const filter = { weaponTypeId: null, elementId: 'element.fire' }
    expect(isWeaponListFilterActive(filter)).toBe(true)
    expect([bowFire, bowWater, lanceFire].filter((item) => matchesWeaponListFilter(item, filter))).toEqual([bowFire, lanceFire])
  })

  it('requires both when both are chosen', () => {
    const filter = { weaponTypeId: 'weapon.bow', elementId: 'element.fire' }
    expect([bowFire, bowWater, lanceFire].filter((item) => matchesWeaponListFilter(item, filter))).toEqual([bowFire])
  })
})
