import { describe, expect, it } from 'vitest'
import { loadMasterData } from './loadMasterData'
import { getMasterDataStatus } from './masterDataStatus'
import { createValidMasterDataFixture } from '../../test/fixtures/masterData'

const disableAll = <T extends { isEnabled: boolean }>(rows: T[]): T[] =>
  rows.map((row) => ({ ...row, isEnabled: false }))

describe('getMasterDataStatus', () => {
  it('marks the bundled core UI masters as production-ready', () => {
    const result = loadMasterData()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(getMasterDataStatus(result.data)).toEqual({
      isProductionReady: true,
      blockingReason: null,
    })
  })

  it('keeps the bundled Master ready while every Lottery and material cost placeholder is disabled, with no advisory', () => {
    const result = loadMasterData()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // The real Master: Lottery placeholder disabled, material cost placeholder
    // disabled. Neither blocks anything, and the disabled cost Master narrows
    // nothing the user sees: the cost figure is the display-only estimate
    // derived from a Route or a Plan (`docs/MASTER_DATA_STATUS.md`).
    expect(result.data.lotteries.every(({ isEnabled }) => !isEnabled)).toBe(true)
    expect(result.data.materialCosts.every(({ isEnabled }) => !isEnabled)).toBe(true)
    const status = getMasterDataStatus(result.data)
    expect(status).toEqual({ isProductionReady: true, blockingReason: null })
    expect(status).not.toHaveProperty('advisories')
  })

  it('reports the same readiness whether or not a Lottery or material cost is enabled', () => {
    const enabled = createValidMasterDataFixture()
    const disabled = createValidMasterDataFixture()
    disabled.lotteries = disableAll(disabled.lotteries)
    disabled.materialCosts = disableAll(disabled.materialCosts)
    const expected = { isProductionReady: true, blockingReason: null }
    expect(getMasterDataStatus(enabled)).toEqual(expected)
    expect(getMasterDataStatus(disabled)).toEqual(expected)
  })

  it('still blocks on a genuine core Master gap', () => {
    const master = createValidMasterDataFixture()
    master.weaponTypes = disableAll(master.weaponTypes)
    expect(getMasterDataStatus(master)).toEqual({
      isProductionReady: false,
      blockingReason:
        '武器入力に必要なマスターデータが不足しています。推測した選択肢は表示しません。',
    })
  })

  it('does not invent a warning for explicitly versioned non-placeholder metadata', () => {
    const master = createValidMasterDataFixture()
    master.manifest.gameVersion = 'verified-version'
    master.manifest.notes = 'Verified source reference.'
    expect(getMasterDataStatus(master)).toEqual({
      isProductionReady: true,
      blockingReason: null,
    })
  })
})
