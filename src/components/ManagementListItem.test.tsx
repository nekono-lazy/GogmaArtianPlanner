import { render, screen, within } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { describe, expect, it } from 'vitest'
import { appTheme } from '../app/theme'
import { loadMasterData } from '../domain/master/loadMasterData'
import type { ArtianBonusScope, MasterDataRoot } from '../domain/master/masterTypes'
import type { RestorationBonusSet } from '../domain/models/publicTypes'
import { createValidMasterDataFixture } from '../test/fixtures/masterData'
import { BonusSlotList } from './ManagementListItem'
import { restorationBonusChipSx } from './restorationBonusPresentation'
import { bonusLabel } from './search/searchPresentation'

function loadProductionMaster(): MasterDataRoot {
  const result = loadMasterData()
  if (!result.ok) throw new Error('production Master must validate')
  return result.data
}

const bonus = (bonusTypeId: string, bonusRankId: string) => ({ bonusTypeId, bonusRankId })

/** jsdom reports hex colours as `rgb()`, so the expectation is normalised. */
function rgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16))
  return `rgb(${r}, ${g}, ${b})`
}

/** The alpha of an `rgba()` background; `transparent` and an opaque colour are 0 / 1. */
function tintAlpha(color: string): number {
  if (color === 'transparent' || color === 'rgba(0, 0, 0, 0)') return 0
  const match = /rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)/.exec(color)
  return match ? Number(match[1]) : 1
}

function renderList(
  bonuses: RestorationBonusSet,
  master: MasterDataRoot,
  props: { scope?: ArtianBonusScope; weaponTypeId?: string; heading?: string } = {},
) {
  return render(
    <ThemeProvider theme={appTheme}>
      <BonusSlotList
        heading={props.heading ?? '復元ボーナス'}
        bonuses={bonuses}
        weaponTypeId={props.weaponTypeId ?? 'weapon.dual_blades'}
        master={master}
        scope={props.scope ?? 'gogma_artian'}
      />
    </ThemeProvider>,
  )
}

/** The `<li>` slots of the one rendered list, in DOM order. */
function slotItems(name = '復元ボーナス'): HTMLElement[] {
  const list = screen.getByRole('list', { name })
  expect(list.tagName).toBe('OL')
  const items = within(list).getAllByRole('listitem')
  for (const item of items) expect(item.tagName).toBe('LI')
  return items
}

const numberOf = (item: HTMLElement) => item.querySelectorAll('span')[0]
const labelOf = (item: HTMLElement) => item.querySelectorAll('span')[1]

describe('BonusSlotList', () => {
  const master = loadProductionMaster()
  const attack = 'bonus_type.attack'
  const affinity = 'bonus_type.affinity'
  const element = 'bonus_type.element'
  const sharpnessCapacity = 'bonus_type.gogma_sharpness_capacity'
  const rankIi = 'bonus_rank.ii'
  const rankEx = 'bonus_rank.ex'

  it('keeps the numbered ordered list in stored slot order with duplicates and unchanged labels', () => {
    const bonuses: RestorationBonusSet = [
      bonus(element, rankEx),
      bonus(attack, rankIi),
      bonus(element, rankEx),
      bonus(affinity, rankIi),
      bonus(sharpnessCapacity, rankEx),
    ]
    renderList(bonuses, master)

    const items = slotItems()
    expect(items).toHaveLength(5)
    items.forEach((item, index) => {
      // Slot number first, then the scope-aware Master label, exactly as before.
      expect(item.textContent).toBe(
        `${index + 1}${bonusLabel(bonuses[index], 'weapon.dual_blades', master, 'gogma_artian')}`,
      )
    })
    // Not sorted, not grouped: the two identical slots stay two items in place.
    expect(items.map((item) => item.getAttribute('data-bonus-tone'))).toEqual([
      'element',
      'attack',
      'element',
      'affinity',
      'sharpness_capacity',
    ])
    expect(items.map((item) => item.getAttribute('data-bonus-ex'))).toEqual([
      'true',
      'false',
      'true',
      'false',
      'true',
    ])
  })

  it('labels the slots by the scope the caller passes, never by guessing one', () => {
    const inherited: RestorationBonusSet = [
      bonus(attack, 'bonus_rank.base'),
      bonus(affinity, 'bonus_rank.base'),
      bonus(element, 'bonus_rank.base'),
      bonus('bonus_type.normal_sharpness', 'bonus_rank.base'),
      bonus(attack, 'bonus_rank.base'),
    ]
    renderList(inherited, master, { scope: 'normal_artian' })
    const items = slotItems()
    items.forEach((item, index) => {
      const expected = bonusLabel(inherited[index], 'weapon.dual_blades', master, 'normal_artian')
      expect(item).toHaveTextContent(expected)
      // The normal-scope definition, not the Gogma one of the same type.
      expect(expected).not.toBe(
        bonusLabel(inherited[index], 'weapon.dual_blades', master, 'gogma_artian'),
      )
    })
    // The Normal-side sharpness type shares the Gogma sharpness / capacity family.
    expect(items[3]).toHaveAttribute('data-bonus-tone', 'sharpness_capacity')
    expect(items[3]).toHaveAttribute('data-bonus-ex', 'false')
  })

  it('colours the label, border and background through the shared outlined presentation authority', () => {
    renderList(
      [
        bonus(attack, rankIi),
        bonus(affinity, rankIi),
        bonus(element, rankIi),
        bonus(sharpnessCapacity, 'bonus_rank.base'),
        bonus(attack, rankEx),
      ],
      master,
    )
    const items = slotItems()
    const families = ['attack', 'affinity', 'element', 'sharpness_capacity'] as const
    families.forEach((family, index) => {
      const expected = restorationBonusChipSx(family, false, 'outlined')
      expect(items[index]).toHaveStyle({ color: rgb(expected.color) })
      expect(items[index]).toHaveStyle({ borderColor: rgb(expected.borderColor) })
      expect(tintAlpha(getComputedStyle(items[index]).backgroundColor)).toBe(0)
    })

    // EX: same family colours, same border strength, same label weight; only a
    // slightly stronger tint, and the label still says `EX`.
    const normalItem = items[0]
    const exItem = items[4]
    const expectedEx = restorationBonusChipSx('attack', true, 'outlined')
    expect(exItem).toHaveStyle({ color: rgb(expectedEx.color) })
    expect(exItem).toHaveStyle({ borderColor: rgb(expectedEx.borderColor) })
    expect(exItem).toHaveTextContent('EX')
    expect(getComputedStyle(exItem).borderWidth).toBe(getComputedStyle(normalItem).borderWidth)
    expect(getComputedStyle(exItem).boxShadow).toBe(getComputedStyle(normalItem).boxShadow)
    expect(getComputedStyle(labelOf(exItem)).fontWeight).toBe(
      getComputedStyle(labelOf(normalItem)).fontWeight,
    )
    expect(tintAlpha(getComputedStyle(exItem).backgroundColor)).toBeGreaterThan(0)
    expect(tintAlpha(getComputedStyle(exItem).backgroundColor)).toBe(tintAlpha(expectedEx.bgcolor))
  })

  it('keeps the slot number in the neutral secondary text colour rather than the family colour', () => {
    renderList(
      [
        bonus(attack, rankIi),
        bonus(affinity, rankIi),
        bonus(element, rankIi),
        bonus(sharpnessCapacity, rankEx),
        bonus(attack, rankEx),
      ],
      master,
    )
    const items = slotItems()
    items.forEach((item, index) => {
      const number = numberOf(item)
      expect(number).toHaveTextContent(String(index + 1))
      expect(number).toHaveStyle({ color: rgb(appTheme.palette.text.secondary) })
      expect(getComputedStyle(number).color).not.toBe(getComputedStyle(item).color)
    })
  })

  it('keeps the standard bordered style for a Bonus Type without a known family, whatever its label says', () => {
    const fixture = createValidMasterDataFixture()
    renderList(
      [
        bonus('bonus_type.fixture.attack', 'bonus_rank.fixture.special'),
        bonus('bonus_type.fixture.attack', 'bonus_rank.fixture.high'),
        bonus('bonus_type.fixture.unused', 'bonus_rank.fixture.high'),
        bonus('bonus_type.fixture.attack', 'bonus_rank.fixture.high'),
        bonus('bonus_type.fixture.unused', 'bonus_rank.fixture.high'),
      ],
      fixture,
      { weaponTypeId: 'weapon.fixture.a' },
    )
    const items = slotItems()
    expect(items).toHaveLength(5)
    // The fixture label contains 攻撃, but the family is never read from text.
    expect(items[0]).toHaveTextContent('攻撃Special fixture')
    for (const item of items) {
      expect(item).not.toHaveAttribute('data-bonus-tone')
      expect(item).not.toHaveAttribute('data-bonus-ex')
      expect(item).toHaveStyle({ borderColor: appTheme.palette.divider })
      expect(tintAlpha(getComputedStyle(item).backgroundColor)).toBe(0)
    }
    // The numbering still reaches assistive technology as an ordered list.
    expect(items.map((item) => numberOf(item).textContent)).toEqual(['1', '2', '3', '4', '5'])
  })

  it('lets the five slots wrap without a fixed width', () => {
    renderList(
      [
        bonus(attack, rankIi),
        bonus(affinity, rankIi),
        bonus(element, rankIi),
        bonus(sharpnessCapacity, rankEx),
        bonus(attack, rankEx),
      ],
      master,
    )
    const list = screen.getByRole('list', { name: '復元ボーナス' })
    expect(getComputedStyle(list).flexWrap).toBe('wrap')
    for (const item of slotItems()) {
      expect(getComputedStyle(item).width).toBe('auto')
      expect(getComputedStyle(item).minWidth).toBe('0px')
      expect(getComputedStyle(item).maxWidth).toBe('100%')
    }
  })
})
