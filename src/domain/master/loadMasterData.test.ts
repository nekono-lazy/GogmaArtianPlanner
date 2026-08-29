import { describe, expect, it } from 'vitest'
import { loadMasterData } from './loadMasterData'
import { getBonusDefinitionsForWeapon } from './masterSelectors'
import { parseMasterManifest } from './validateMasterData'

describe('Master Data loading', () => {
  it('loads the unverified placeholder manifest', () => {
    const result = loadMasterData()

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.manifest.gameVersion).toBe('unknown-initial')
      expect(result.data.manifest.notes).toContain('not yet verified')
      expect(result.data.weaponTypes).not.toHaveLength(0)
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
      )
      expect(definitions.map(({ id }) => id)).toEqual([
        'weapon_bonus.weapon.dual_blades.bonus_type.attack.bonus_rank.ex',
      ])
    }
  })

  it('rejects an invalid manifest', () => {
    expect(parseMasterManifest({ gameTitle: 'unknown' })).toBeNull()
  })
})
