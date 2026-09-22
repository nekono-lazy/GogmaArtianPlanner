import { describe, expect, it } from 'vitest'
import { loadMasterData } from '../../domain/master/loadMasterData'
import type { NormalArtianCounter } from '../../domain/models/publicTypes'
import { createValidNormalArtianCounter } from '../../test/fixtures/domainData'
import {
  debugTimestampLabel,
  debugWeaponTypeLabel,
  knownValueDebugView,
  orderNormalArtianCountersForDebug,
} from './debugStatePresentation'

const master = loadMasterData()
if (!master.ok) throw new Error('Production Master Data must load for the Debug ordering test.')
const productionMaster = master.data

function counter(weaponTypeId: string, overrides: Partial<NormalArtianCounter> = {}): NormalArtianCounter {
  return {
    ...createValidNormalArtianCounter(),
    id: `${weaponTypeId}:8`,
    weaponTypeId,
    ...overrides,
  }
}

describe('knownValueDebugView', () => {
  it('shows the stored value, confirmation and source of a confirmed value', () => {
    expect(
      knownValueDebugView({ value: 51231782, isConfirmed: true, source: 'observation' }),
    ).toEqual({
      value: '51231782',
      confirmed: 'true（確定）',
      source: 'observation（観測検索）',
    })
  })

  it('reports a null value and a null source as 未設定 rather than as the string "null"', () => {
    const view = knownValueDebugView({ value: null, isConfirmed: false, source: null })

    expect(view).toEqual({ value: '未設定', confirmed: 'false（未確定）', source: '未設定' })
    expect(view.value).not.toBe('null')
  })

  it('keeps a stored 0 distinct from a missing value', () => {
    expect(knownValueDebugView({ value: 0, isConfirmed: true, source: 'manual' }).value).toBe('0')
  })
})

describe('debugTimestampLabel', () => {
  it('shows a stored timestamp as it is and a missing one as 未設定', () => {
    expect(debugTimestampLabel('2026-09-15T00:00:00.000Z')).toBe('2026-09-15T00:00:00.000Z')
    expect(debugTimestampLabel(null)).toBe('未設定')
  })
})

describe('debugWeaponTypeLabel', () => {
  it('uses the Master display name and falls back to the raw ID', () => {
    expect(debugWeaponTypeLabel('weapon.bow', productionMaster)).toBe('弓')
    expect(debugWeaponTypeLabel('weapon.unknown', productionMaster)).toBe('weapon.unknown')
  })
})

describe('orderNormalArtianCountersForDebug', () => {
  it('orders by Master sortOrder regardless of the order the repository returned', () => {
    const repositoryOrder = [
      counter('weapon.bow'),
      counter('weapon.great_sword'),
      counter('weapon.long_sword'),
    ]

    expect(
      orderNormalArtianCountersForDebug(repositoryOrder, productionMaster).map(
        ({ weaponTypeId }) => weaponTypeId,
      ),
    ).toEqual(['weapon.great_sword', 'weapon.long_sword', 'weapon.bow'])
    expect(
      orderNormalArtianCountersForDebug([...repositoryOrder].reverse(), productionMaster).map(
        ({ weaponTypeId }) => weaponTypeId,
      ),
    ).toEqual(['weapon.great_sword', 'weapon.long_sword', 'weapon.bow'])
  })

  it('keeps a record of an unknown weapon type visible, after every known one, ordered by ID', () => {
    const ordered = orderNormalArtianCountersForDebug(
      [
        counter('weapon.zzz.unknown', { id: 'weapon.zzz.unknown:8' }),
        counter('weapon.aaa.unknown', { id: 'weapon.aaa.unknown:8' }),
        counter('weapon.great_sword'),
      ],
      productionMaster,
    )

    expect(ordered.map(({ weaponTypeId }) => weaponTypeId)).toEqual([
      'weapon.great_sword',
      'weapon.aaa.unknown',
      'weapon.zzz.unknown',
    ])
  })

  it('does not mutate the supplied array', () => {
    const counters = [counter('weapon.bow'), counter('weapon.great_sword')]
    orderNormalArtianCountersForDebug(counters, productionMaster)

    expect(counters.map(({ weaponTypeId }) => weaponTypeId)).toEqual([
      'weapon.bow',
      'weapon.great_sword',
    ])
  })
})
