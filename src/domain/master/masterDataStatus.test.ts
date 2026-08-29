import { describe, expect, it } from 'vitest'
import { loadMasterData } from './loadMasterData'
import { getMasterDataStatus } from './masterDataStatus'
import { createValidMasterDataFixture } from '../../test/fixtures/masterData'

describe('getMasterDataStatus', () => {
  it('marks the bundled core UI masters as production-ready', () => {
    const result = loadMasterData()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(getMasterDataStatus(result.data)).toEqual({ isProductionReady: true, reason: null })
    expect(getMasterDataStatus(result.data, 'search')).toMatchObject({
      isProductionReady: false,
      reason: expect.stringContaining('抽選マスターデータは未検証'),
    })
  })

  it('does not invent a warning for explicitly versioned non-placeholder metadata', () => {
    const master = createValidMasterDataFixture()
    master.manifest.gameVersion = 'verified-version'
    master.manifest.notes = 'Verified source reference.'
    expect(getMasterDataStatus(master)).toEqual({ isProductionReady: true, reason: null })
  })
})
