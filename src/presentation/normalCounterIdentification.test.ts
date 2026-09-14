import { describe, expect, it } from 'vitest'
import { loadMasterData } from '../domain/master/loadMasterData'
import {
  normalCounterIdentificationSharedPoolNote,
  normalCounterIdentificationTableClassOptions,
} from './normalCounterIdentification'

const loadedMaster = loadMasterData()
if (!loadedMaster.ok) throw new Error('Test Master is unavailable.')
const elements = loadedMaster.data.elements

describe('normalCounterIdentificationSharedPoolNote', () => {
  it('is derived from the Domain pool identity: Bowguns and Switch Axe share one pool across both classes', () => {
    for (const weaponTypeId of ['weapon.light_bowgun', 'weapon.heavy_bowgun', 'weapon.switch_axe']) {
      const note = normalCounterIdentificationSharedPoolNote(weaponTypeId)
      expect(note).toMatch(/属性の有無によらず同じ復元ボーナス抽選/)
      expect(note).not.toMatch(/table_a|table_b|switch_axe|bowgun/)
    }
  })

  it('is absent where the two classes draw different pools, and for a weapon type with no Production pool', () => {
    for (const weaponTypeId of ['weapon.bow', 'weapon.long_sword', 'weapon.great_sword', 'weapon.insect_glaive']) {
      expect(normalCounterIdentificationSharedPoolNote(weaponTypeId)).toBeNull()
    }
    expect(normalCounterIdentificationSharedPoolNote('weapon.unknown')).toBeNull()
  })
})

describe('normalCounterIdentificationTableClassOptions', () => {
  it('labels Switch Axe with the generic 属性あり / 無属性 pair, never a Bow-style element list', () => {
    expect(normalCounterIdentificationTableClassOptions('weapon.switch_axe', elements)).toEqual([
      { tableClass: 'table_a', label: '属性あり' },
      { tableClass: 'table_b', label: '無属性' },
    ])
    expect(normalCounterIdentificationTableClassOptions('weapon.bow', elements)?.map(({ label }) => label)).toEqual([
      'テーブルA（火・水・雷・氷・龍・爆破）',
      'テーブルB（無属性・毒・麻痺・睡眠）',
    ])
    expect(normalCounterIdentificationTableClassOptions('weapon.unknown', elements)).toBeNull()
  })
})
