import { describe, expect, it } from 'vitest'
import { loadMasterData } from './loadMasterData'
import { getMasterDataStatus } from './masterDataStatus'
import { createValidMasterDataFixture } from '../../test/fixtures/masterData'

describe('getMasterDataStatus', () => {
  it('marks the bundled placeholder data as unavailable for production use', () => {
    const result = loadMasterData()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(getMasterDataStatus(result.data)).toMatchObject({ isProductionReady: false })
  })

  it('does not invent a warning for explicitly versioned non-placeholder metadata', () => {
    const master = createValidMasterDataFixture()
    master.manifest.gameVersion = 'verified-version'
    master.manifest.notes = 'Verified source reference.'
    expect(getMasterDataStatus(master)).toEqual({ isProductionReady: true, reason: null })
  })
})
