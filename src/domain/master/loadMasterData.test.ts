import { describe, expect, it } from 'vitest'
import { loadMasterData } from './loadMasterData'
import { parseMasterManifest } from './validateMasterData'

describe('Master Data loading', () => {
  it('loads the unverified placeholder manifest', () => {
    const result = loadMasterData()

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.manifest.gameVersion).toBe('unknown-initial')
      expect(result.data.manifest.notes).toContain('not yet verified')
      expect(result.data.lotteries).toEqual([])
    }
  })

  it('rejects an invalid manifest', () => {
    expect(parseMasterManifest({ gameTitle: 'unknown' })).toBeNull()
  })
})
