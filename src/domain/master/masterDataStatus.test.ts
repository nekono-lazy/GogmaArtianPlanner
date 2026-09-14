import { describe, expect, it } from 'vitest'
import { loadMasterData } from './loadMasterData'
import {
  getMasterDataStatus,
  hasUsableMaterialCosts,
  MATERIAL_COST_UNVERIFIED_MESSAGE,
} from './masterDataStatus'
import { createValidMasterDataFixture } from '../../test/fixtures/masterData'

const disableAll = <T extends { isEnabled: boolean }>(rows: T[]): T[] =>
  rows.map((row) => ({ ...row, isEnabled: false }))

const materialAdvisory = {
  kind: 'material_cost_unverified',
  message: MATERIAL_COST_UNVERIFIED_MESSAGE,
}

describe('getMasterDataStatus', () => {
  it('marks the bundled core UI masters as production-ready', () => {
    const result = loadMasterData()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(getMasterDataStatus(result.data)).toEqual({
      isProductionReady: true,
      blockingReason: null,
      advisories: [],
    })
  })

  it('keeps the bundled Master search-ready while every Lottery and material cost is disabled', () => {
    const result = loadMasterData()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // The real Master: Lottery placeholder disabled, material cost placeholder
    // disabled. Neither blocks Search; only the material cost is an advisory.
    expect(result.data.lotteries.every(({ isEnabled }) => !isEnabled)).toBe(true)
    expect(hasUsableMaterialCosts(result.data)).toBe(false)
    const status = getMasterDataStatus(result.data, 'search')
    expect(status).toEqual({
      isProductionReady: true,
      blockingReason: null,
      advisories: [materialAdvisory],
    })
    expect(status.advisories[0].message).toContain('候補検索は利用できます')
    expect(status.advisories[0].message).not.toContain('抽選')
    expect(status.advisories[0].message).not.toContain('利用できません')
  })

  it('reports no advisory at all when Lottery is disabled but a material cost is usable', () => {
    const master = createValidMasterDataFixture()
    master.lotteries = disableAll(master.lotteries)
    expect(hasUsableMaterialCosts(master)).toBe(true)
    expect(getMasterDataStatus(master, 'search')).toEqual({
      isProductionReady: true,
      blockingReason: null,
      advisories: [],
    })
  })

  it('lets only the material cost decide the search advisory, never the Lottery flag', () => {
    const enabledLottery = createValidMasterDataFixture()
    enabledLottery.materialCosts = disableAll(enabledLottery.materialCosts)
    const disabledLottery = createValidMasterDataFixture()
    disabledLottery.materialCosts = disableAll(disabledLottery.materialCosts)
    disabledLottery.lotteries = disableAll(disabledLottery.lotteries)

    const expected = {
      isProductionReady: true,
      blockingReason: null,
      advisories: [materialAdvisory],
    }
    expect(getMasterDataStatus(enabledLottery, 'search')).toEqual(expected)
    expect(getMasterDataStatus(disabledLottery, 'search')).toEqual(expected)
  })

  it('never raises the material advisory for the core UI feature', () => {
    const master = createValidMasterDataFixture()
    master.materialCosts = disableAll(master.materialCosts)
    expect(getMasterDataStatus(master)).toEqual({
      isProductionReady: true,
      blockingReason: null,
      advisories: [],
    })
  })

  it('still blocks on a genuine core Master gap, with no advisory attached', () => {
    const master = createValidMasterDataFixture()
    master.weaponTypes = disableAll(master.weaponTypes)
    expect(getMasterDataStatus(master, 'search')).toEqual({
      isProductionReady: false,
      blockingReason:
        '武器入力に必要なマスターデータが不足しています。推測した選択肢は表示しません。',
      advisories: [],
    })
  })

  it('does not invent a warning for explicitly versioned non-placeholder metadata', () => {
    const master = createValidMasterDataFixture()
    master.manifest.gameVersion = 'verified-version'
    master.manifest.notes = 'Verified source reference.'
    expect(getMasterDataStatus(master)).toEqual({
      isProductionReady: true,
      blockingReason: null,
      advisories: [],
    })
  })
})
