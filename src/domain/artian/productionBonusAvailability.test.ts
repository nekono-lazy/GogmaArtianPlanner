import { describe, expect, it } from 'vitest'
import { createValidMasterDataFixture } from '../../test/fixtures/masterData'
import { loadMasterData } from '../master/loadMasterData'
import {
  getBonusDefinitionsForWeapon,
  getEnabledElements,
  getEnabledWeaponTypes,
  MasterDataDomainError,
} from '../master/masterSelectors'
import type { ArtianBonusScope, MasterDataRoot } from '../master/masterTypes'
import type { RestorationBonus } from '../models/publicTypes'
import { productionGogmaResetCandidatesForWeaponAndElement } from '../rng/production/gameGogmaBonuses'
import { gameVerifiedNormalCandidatesForWeaponAndElement } from '../rng/production/gameNormalBonuses'
import { restorationBonusFromReferenceNormalId } from '../rng/production/referenceNormalBonuses'
import {
  getProductionAvailableBonusDefinitions,
  getProductionAvailableBonusTypeIds,
  getProductionAvailableRanksForBonusType,
  isProductionAvailableBonus,
  ProductionBonusAvailabilityError,
} from './productionBonusAvailability'

function verifiedMaster(): MasterDataRoot {
  const result = loadMasterData()
  if (!result.ok) throw new Error(JSON.stringify(result.issues))
  return result.data
}

const master = verifiedMaster()

function pair(bonus: RestorationBonus): string {
  return `${bonus.bonusTypeId}/${bonus.bonusRankId}`
}

function availablePairs(
  source: MasterDataRoot,
  weaponTypeId: string,
  elementId: string,
  scope: ArtianBonusScope,
): string[] {
  return getProductionAvailableBonusDefinitions(source, weaponTypeId, elementId, scope).map(pair).sort()
}

function typeIds(weaponTypeId: string, elementId: string, scope: ArtianBonusScope): string[] {
  return [...getProductionAvailableBonusTypeIds(master, weaponTypeId, elementId, scope)].sort()
}

function productionAuthorityPairs(weaponTypeId: string, elementId: string, scope: ArtianBonusScope): Set<string> {
  if (scope === 'gogma_artian') {
    return new Set(productionGogmaResetCandidatesForWeaponAndElement(weaponTypeId, elementId).map(({ bonus }) => pair(bonus)))
  }
  return new Set(
    gameVerifiedNormalCandidatesForWeaponAndElement(weaponTypeId, elementId).map((candidate) => {
      const bonus = restorationBonusFromReferenceNormalId(weaponTypeId, candidate.referenceId)
      if (bonus === null) throw new Error(`unmapped Production Normal candidate for ${weaponTypeId}`)
      return pair(bonus)
    }),
  )
}

function masterPairs(weaponTypeId: string, scope: ArtianBonusScope): Set<string> {
  return new Set(
    master.weaponBonusDefinitions
      .filter((definition) => definition.isEnabled && definition.weaponTypeId === weaponTypeId && definition.scope === scope)
      .map(pair),
  )
}

const GOGMA_ATTACK = ['bonus_type.attack/bonus_rank.ii', 'bonus_type.attack/bonus_rank.iii', 'bonus_type.attack/bonus_rank.ex']
const GOGMA_AFFINITY = ['bonus_type.affinity/bonus_rank.ii', 'bonus_type.affinity/bonus_rank.iii', 'bonus_type.affinity/bonus_rank.ex']
const GOGMA_ELEMENT = ['bonus_type.element/bonus_rank.ii', 'bonus_type.element/bonus_rank.ex']
const GOGMA_SHARPNESS_CAPACITY = ['bonus_type.gogma_sharpness_capacity/bonus_rank.base', 'bonus_type.gogma_sharpness_capacity/bonus_rank.ex']

describe('Production bonus availability', () => {
  it('offers Element to Switch Axe element.none in both scopes', () => {
    expect(typeIds('weapon.switch_axe', 'element.none', 'normal_artian')).toEqual([
      'bonus_type.affinity', 'bonus_type.attack', 'bonus_type.element', 'bonus_type.normal_sharpness',
    ])
    expect(availablePairs(master, 'weapon.switch_axe', 'element.none', 'gogma_artian')).toEqual(
      [...GOGMA_ATTACK, ...GOGMA_AFFINITY, ...GOGMA_ELEMENT, ...GOGMA_SHARPNESS_CAPACITY].sort(),
    )
  })

  it.each(['element.poison', 'element.paralysis', 'element.sleep', 'element.none'])(
    'offers no Element to Bow Table B %s in either scope',
    (elementId) => {
      expect(typeIds('weapon.bow', elementId, 'normal_artian')).toEqual(['bonus_type.affinity', 'bonus_type.attack'])
      expect(availablePairs(master, 'weapon.bow', elementId, 'gogma_artian')).toEqual([...GOGMA_ATTACK, ...GOGMA_AFFINITY].sort())
    },
  )

  it.each(['element.fire', 'element.blast'])('offers Element to Bow Table A %s in both scopes', (elementId) => {
    expect(typeIds('weapon.bow', elementId, 'normal_artian')).toEqual(['bonus_type.affinity', 'bonus_type.attack', 'bonus_type.element'])
    expect(availablePairs(master, 'weapon.bow', elementId, 'gogma_artian')).toEqual([...GOGMA_ATTACK, ...GOGMA_AFFINITY, ...GOGMA_ELEMENT].sort())
  })

  it.each([
    ['weapon.light_bowgun', 'element.fire'],
    ['weapon.light_bowgun', 'element.none'],
    ['weapon.heavy_bowgun', 'element.poison'],
    ['weapon.heavy_bowgun', 'element.none'],
  ])('offers no Element to %s / %s, with Capacity in normal scope and Sharpness/Capacity in gogma scope', (weaponTypeId, elementId) => {
    expect(typeIds(weaponTypeId, elementId, 'normal_artian')).toEqual(['bonus_type.affinity', 'bonus_type.attack', 'bonus_type.normal_capacity'])
    expect(availablePairs(master, weaponTypeId, elementId, 'gogma_artian')).toEqual([...GOGMA_ATTACK, ...GOGMA_AFFINITY, ...GOGMA_SHARPNESS_CAPACITY].sort())
  })

  it('equals Master definitions x the Production Normal / Gogma authority for all 14 weapon types x 10 elements', () => {
    const weaponTypes = getEnabledWeaponTypes(master)
    const elements = getEnabledElements(master)
    expect(weaponTypes).toHaveLength(14)
    expect(elements).toHaveLength(10)
    for (const { id: weaponTypeId } of weaponTypes) {
      for (const { id: elementId } of elements) {
        for (const scope of ['normal_artian', 'gogma_artian'] as const) {
          const production = productionAuthorityPairs(weaponTypeId, elementId, scope)
          const declared = masterPairs(weaponTypeId, scope)
          const expected = [...production].filter((key) => declared.has(key)).sort()
          const actual = availablePairs(master, weaponTypeId, elementId, scope)
          expect(actual, `${weaponTypeId} / ${elementId} / ${scope}`).toEqual(expected)
          // The verified Master declares every Production-drawable bonus, so
          // the product loses nothing the Production lottery can draw.
          expect(actual, `${weaponTypeId} / ${elementId} / ${scope}`).toEqual([...production].sort())
        }
      }
    }
  })

  it('leaves the Master-only getBonusDefinitionsForWeapon() semantics unchanged', () => {
    const masterOnly = (weaponTypeId: string, elementId: string) =>
      getBonusDefinitionsForWeapon(master, weaponTypeId, elementId, 'gogma_artian').map(({ bonusTypeId }) => bonusTypeId)
    expect(masterOnly('weapon.switch_axe', 'element.none')).not.toContain('bonus_type.element')
    expect(masterOnly('weapon.bow', 'element.poison')).toContain('bonus_type.element')
  })

  it('derives ranks from the same availability', () => {
    const rankIds = (weaponTypeId: string, elementId: string, bonusTypeId: string, scope: ArtianBonusScope) =>
      getProductionAvailableRanksForBonusType(master, weaponTypeId, elementId, bonusTypeId, scope).map(({ id }) => id)
    expect(rankIds('weapon.switch_axe', 'element.none', 'bonus_type.element', 'gogma_artian')).toEqual(['bonus_rank.ii', 'bonus_rank.ex'])
    expect(rankIds('weapon.switch_axe', 'element.none', 'bonus_type.element', 'normal_artian')).toEqual(['bonus_rank.base'])
    expect(rankIds('weapon.great_sword', 'element.fire', 'bonus_type.attack', 'gogma_artian')).toEqual(['bonus_rank.ii', 'bonus_rank.iii', 'bonus_rank.ex'])
    expect(rankIds('weapon.bow', 'element.poison', 'bonus_type.element', 'gogma_artian')).toEqual([])
  })

  it('judges one bonus with the same availability', () => {
    const element = { bonusTypeId: 'bonus_type.element', bonusRankId: 'bonus_rank.ii' }
    expect(isProductionAvailableBonus(master, 'weapon.switch_axe', 'element.none', 'gogma_artian', element)).toBe(true)
    expect(isProductionAvailableBonus(master, 'weapon.bow', 'element.poison', 'gogma_artian', element)).toBe(false)
    expect(isProductionAvailableBonus(master, 'weapon.bow', 'element.fire', 'gogma_artian', { bonusTypeId: 'bonus_type.element', bonusRankId: 'bonus_rank.i' })).toBe(false)
  })

  it('never regenerates a Production bonus whose Master definition is missing, and never falls back to Master-only availability', () => {
    const partial = structuredClone(master)
    partial.weaponBonusDefinitions = partial.weaponBonusDefinitions.filter(
      (definition) => !(definition.weaponTypeId === 'weapon.switch_axe' && definition.scope === 'gogma_artian' && definition.bonusTypeId === 'bonus_type.element' && definition.bonusRankId === 'bonus_rank.ex'),
    )
    const actual = availablePairs(partial, 'weapon.switch_axe', 'element.none', 'gogma_artian')
    expect(actual).toContain('bonus_type.element/bonus_rank.ii')
    expect(actual).not.toContain('bonus_type.element/bonus_rank.ex')
    expect(actual).not.toEqual(getBonusDefinitionsForWeapon(partial, 'weapon.switch_axe', 'element.none', 'gogma_artian').map(pair).sort())
  })

  it('never offers a Master definition the Production lottery cannot draw', () => {
    const widened = structuredClone(master)
    widened.weaponBonusDefinitions.push({
      ...widened.weaponBonusDefinitions.find((definition) => definition.weaponTypeId === 'weapon.bow' && definition.scope === 'gogma_artian')!,
      id: 'weapon_bonus.test.bow.sharpness_capacity',
      bonusTypeId: 'bonus_type.gogma_sharpness_capacity',
      bonusRankId: 'bonus_rank.base',
    })
    expect(typeIds('weapon.bow', 'element.fire', 'gogma_artian')).not.toContain('bonus_type.gogma_sharpness_capacity')
    expect(getProductionAvailableBonusTypeIds(widened, 'weapon.bow', 'element.fire', 'gogma_artian')).not.toContain('bonus_type.gogma_sharpness_capacity')
  })

  it('excludes a disabled Master definition or rank', () => {
    const disabled = structuredClone(master)
    disabled.bonusRanks = disabled.bonusRanks.map((rank) => rank.id === 'bonus_rank.ex' ? { ...rank, isEnabled: false } : rank)
    expect(availablePairs(disabled, 'weapon.great_sword', 'element.fire', 'gogma_artian').some((key) => key.endsWith('/bonus_rank.ex'))).toBe(false)
  })

  it('fails closed when Master declares none of the Production bonuses for the scope', () => {
    const empty = structuredClone(master)
    empty.weaponBonusDefinitions = empty.weaponBonusDefinitions.filter(
      (definition) => !(definition.weaponTypeId === 'weapon.switch_axe' && definition.scope === 'gogma_artian'),
    )
    expect(() => getProductionAvailableBonusDefinitions(empty, 'weapon.switch_axe', 'element.none', 'gogma_artian'))
      .toThrow(expect.objectContaining({ name: 'ProductionBonusAvailabilityError', reason: 'no_available_definitions' }))
  })

  it('fails closed for a weapon type the Production authority cannot classify', () => {
    const fixture = createValidMasterDataFixture()
    let caught: unknown
    try {
      getProductionAvailableBonusDefinitions(fixture, 'weapon.fixture.a', 'element.fixture.a', 'gogma_artian')
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(ProductionBonusAvailabilityError)
    expect((caught as ProductionBonusAvailabilityError).reason).toBe('production_authority_unavailable')
  })

  it('raises a Master Domain Error for an unknown Master weapon type or element', () => {
    expect(() => getProductionAvailableBonusDefinitions(master, 'weapon.missing', 'element.none', 'gogma_artian')).toThrow(MasterDataDomainError)
    expect(() => getProductionAvailableBonusDefinitions(master, 'weapon.bow', 'element.missing', 'gogma_artian')).toThrow(MasterDataDomainError)
  })
})
