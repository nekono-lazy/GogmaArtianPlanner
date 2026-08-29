import { describe, expect, it } from 'vitest'
import { loadMasterData } from './loadMasterData'
import { getBonusDefinitionsForWeapon } from './masterSelectors'
import { parseMasterManifest } from './validateMasterData'

describe('Master Data loading', () => {
  it('loads verified UI masters while keeping Lottery disabled', () => {
    const result = loadMasterData()

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.manifest.gameVersion).toBe('unknown-initial')
      expect(result.data.manifest.dataVersion).toBe(3)
      expect(result.data.manifest.notes).toContain('project-owner verified')
      expect(result.data.weaponTypes).toHaveLength(14)
      expect(result.data.elements).toHaveLength(10)
      expect(result.data.seriesSkills).toHaveLength(25)
      expect(result.data.groupSkills).toHaveLength(17)
      expect(result.data.lotteries).toEqual([
        expect.objectContaining({
          internalValue: 'unverified-placeholder',
          isEnabled: false,
        }),
      ])
    }
  })

  it('loads JSON through validation and exposes definitions to selectors', () => {
    const result = loadMasterData()
    expect(result.ok).toBe(true)
    if (result.ok) {
      const definitions = getBonusDefinitionsForWeapon(
        result.data,
        'weapon.dual_blades',
        'element.thunder',
        'gogma_artian',
      )
      expect(definitions).toHaveLength(13)
      expect(definitions.every(({ scope }) => scope === 'gogma_artian')).toBe(true)
    }
  })

  it('rejects an invalid manifest', () => {
    expect(parseMasterManifest({ gameTitle: 'unknown' })).toBeNull()
  })
})
