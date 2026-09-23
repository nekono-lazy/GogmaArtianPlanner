import { render, screen, within } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { describe, expect, it } from 'vitest'
import { appTheme, createAppTheme } from '../app/theme'
import { loadMasterData } from '../domain/master/loadMasterData'
import type { MasterDataRoot } from '../domain/master/masterTypes'
import type { RestorationBonusSet } from '../domain/models/publicTypes'
import { createValidMasterDataFixture } from '../test/fixtures/masterData'
import { BonusSlotList } from './ManagementListItem'
import { RestorationBonusSlots } from './RestorationBonusSlots'
import {
  RESTORATION_BONUS_DARK_TONE_COLORS,
  RESTORATION_BONUS_TONE_COLORS,
  isRestorationBonusExRank,
  resolveRestorationBonusTone,
  restorationBonusChipSx,
  restorationBonusToneColors,
} from './restorationBonusPresentation'
import { bonusLabel } from './search/searchPresentation'

function loadProductionMaster(): MasterDataRoot {
  const result = loadMasterData()
  if (!result.ok) throw new Error('production Master must validate')
  return result.data
}

const bonus = (bonusTypeId: string, bonusRankId: string) => ({ bonusTypeId, bonusRankId })

function renderSlots(
  bonuses: RestorationBonusSet,
  master: MasterDataRoot,
  props: { variant?: 'filled' | 'outlined'; weaponTypeId?: string } = {},
) {
  return render(
    <ThemeProvider theme={appTheme}>
      <RestorationBonusSlots
        bonuses={bonuses}
        weaponTypeId={props.weaponTypeId ?? master.weaponTypes[0].id}
        master={master}
        scope="gogma_artian"
        variant={props.variant}
      />
    </ThemeProvider>,
  )
}

/** jsdom reports hex colours as `rgb()`, so the expectation is normalised. */
function rgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16))
  return `rgb(${r}, ${g}, ${b})`
}

/** The alpha of an `rgba()` background; `transparent` and an opaque colour are 0 / 1. */
function tintAlpha(color: string): number {
  if (color === 'transparent') return 0
  const match = /rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)/.exec(color)
  return match ? Number(match[1]) : 1
}

describe('resolveRestorationBonusTone', () => {
  it('maps every current Bonus Type ID to its display family', () => {
    expect(resolveRestorationBonusTone('bonus_type.attack')).toBe('attack')
    expect(resolveRestorationBonusTone('bonus_type.affinity')).toBe('affinity')
    expect(resolveRestorationBonusTone('bonus_type.element')).toBe('element')
    expect(resolveRestorationBonusTone('bonus_type.normal_sharpness')).toBe('sharpness_capacity')
    expect(resolveRestorationBonusTone('bonus_type.normal_capacity')).toBe('sharpness_capacity')
    expect(resolveRestorationBonusTone('bonus_type.gogma_sharpness_capacity')).toBe(
      'sharpness_capacity',
    )
  })

  it('covers every enabled Bonus Type of the production Master', () => {
    const master = loadProductionMaster()
    for (const { id } of master.bonusTypes.filter(({ isEnabled }) => isEnabled)) {
      expect(resolveRestorationBonusTone(id), id).not.toBeNull()
    }
  })

  it('gives an unknown Bonus Type no family instead of guessing one from its ID text', () => {
    expect(resolveRestorationBonusTone('bonus_type.future_attack_variant')).toBeNull()
    expect(resolveRestorationBonusTone('bonus_type.fixture.attack')).toBeNull()
  })
})

describe('isRestorationBonusExRank', () => {
  it('follows BonusRankMaster.isEx rather than the rank ID text', () => {
    const master = createValidMasterDataFixture()
    // The fixture's EX rank is not named `bonus_rank.ex`, and its non-EX ranks
    // are not named by tier either.
    expect(isRestorationBonusExRank(master, 'bonus_rank.fixture.special')).toBe(true)
    expect(isRestorationBonusExRank(master, 'bonus_rank.fixture.high')).toBe(false)
  })

  it('treats a rank the Master does not know as not EX without throwing', () => {
    expect(isRestorationBonusExRank(createValidMasterDataFixture(), 'bonus_rank.ex')).toBe(false)
  })
})

describe('restorationBonusChipSx', () => {
  it('sets EX apart from a normal rank only by a slightly stronger tint', () => {
    for (const variant of ['filled', 'outlined'] as const) {
      const normal = restorationBonusChipSx('attack', false, variant)
      const ex = restorationBonusChipSx('attack', true, variant)
      // Same family colours - EX is not a different colour.
      expect(ex.color).toBe(normal.color)
      expect(ex.borderColor).toBe(normal.borderColor)
      // Same border / ring strength and no label weight override: the `EX`
      // text of the label already names the rank.
      expect(ex.boxShadow).toBe(normal.boxShadow)
      expect(ex).not.toHaveProperty('& .MuiChip-label')
      expect(normal).not.toHaveProperty('& .MuiChip-label')
      // Only the background tint differs, and only by a small step.
      expect(ex.bgcolor).not.toBe(normal.bgcolor)
      expect(tintAlpha(ex.bgcolor)).toBeGreaterThan(tintAlpha(normal.bgcolor))
      expect(tintAlpha(ex.bgcolor) - tintAlpha(normal.bgcolor)).toBeLessThanOrEqual(0.1)
    }
  })

  it('keeps filled and outlined distinguishable', () => {
    const outlined = restorationBonusChipSx('element', false, 'outlined')
    const filled = restorationBonusChipSx('element', false, 'filled')
    expect(outlined.bgcolor).toBe('transparent')
    expect(outlined.boxShadow).toBe('none')
    expect(filled.bgcolor).not.toBe('transparent')
    expect(filled.boxShadow).not.toBe('none')
  })
})

describe('RestorationBonusSlots', () => {
  const master = loadProductionMaster()
  const attack = 'bonus_type.attack'
  const element = 'bonus_type.element'
  const rankIi = 'bonus_rank.ii'
  const rankEx = 'bonus_rank.ex'

  it('renders five list items in slot order with their unchanged labels, duplicates included', () => {
    const bonuses: RestorationBonusSet = [
      bonus(attack, rankIi),
      bonus(element, rankEx),
      bonus(attack, rankIi),
      bonus('bonus_type.affinity', rankIi),
      bonus('bonus_type.gogma_sharpness_capacity', rankEx),
    ]
    renderSlots(bonuses, master)

    const list = screen.getByRole('list', { name: '復元ボーナス5枠' })
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(5)
    const weaponTypeId = master.weaponTypes[0].id
    items.forEach((item, index) => {
      expect(item).toHaveTextContent(bonusLabel(bonuses[index], weaponTypeId, master, 'gogma_artian'))
    })
    // Each chip carries the family of its own slot, in slot order.
    const chips = items.map((item) => item.querySelector('.MuiChip-root'))
    expect(chips.map((chip) => chip?.getAttribute('data-bonus-tone'))).toEqual([
      'attack',
      'element',
      'attack',
      'affinity',
      'sharpness_capacity',
    ])
    expect(chips.map((chip) => chip?.getAttribute('data-bonus-ex'))).toEqual([
      'false',
      'true',
      'false',
      'false',
      'true',
    ])
  })

  it('colours the label and border by family and sets EX apart by tint alone', () => {
    renderSlots(
      [
        bonus(attack, rankIi),
        bonus('bonus_type.affinity', rankIi),
        bonus(element, rankIi),
        bonus('bonus_type.gogma_sharpness_capacity', rankIi),
        bonus(attack, rankEx),
      ],
      master,
      { variant: 'outlined' },
    )
    const chips = screen
      .getAllByRole('listitem')
      .map((item) => item.querySelector<HTMLElement>('.MuiChip-root'))
    const families = ['attack', 'affinity', 'element', 'sharpness_capacity'] as const
    families.forEach((family, index) => {
      const chip = chips[index]
      expect(chip).toHaveStyle({ color: rgb(RESTORATION_BONUS_TONE_COLORS[family].text) })
      expect(chip).toHaveStyle({ borderColor: rgb(RESTORATION_BONUS_TONE_COLORS[family].border) })
    })
    // The four families use four different label colours.
    expect(new Set(families.map((family) => RESTORATION_BONUS_TONE_COLORS[family].text)).size).toBe(4)

    // The EX slot of the same family keeps the family colours, the same label
    // weight and the same border as the normal slot; only its background
    // tint is stronger, and its label still says `EX`.
    const normalChip = chips[0]!
    const exChip = chips[4]!
    const normalLabel = normalChip.querySelector<HTMLElement>('.MuiChip-label')!
    const exLabel = exChip.querySelector<HTMLElement>('.MuiChip-label')!
    expect(exChip).toHaveStyle({ color: rgb(RESTORATION_BONUS_TONE_COLORS.attack.text) })
    expect(exChip).toHaveStyle({ borderColor: rgb(RESTORATION_BONUS_TONE_COLORS.attack.border) })
    expect(exLabel).toHaveTextContent('EX')
    expect(getComputedStyle(exLabel).fontWeight).toBe(getComputedStyle(normalLabel).fontWeight)
    expect(getComputedStyle(exChip).boxShadow).toBe(getComputedStyle(normalChip).boxShadow)
    expect(getComputedStyle(exChip).borderWidth).toBe(getComputedStyle(normalChip).borderWidth)
    expect(tintAlpha(getComputedStyle(normalChip).backgroundColor)).toBe(0)
    expect(tintAlpha(getComputedStyle(exChip).backgroundColor)).toBeGreaterThan(0)
  })

  it('keeps the standard chip style for a Bonus Type without a known family', () => {
    const fixture = createValidMasterDataFixture()
    renderSlots(
      [
        bonus('bonus_type.fixture.attack', 'bonus_rank.fixture.special'),
        bonus('bonus_type.fixture.attack', 'bonus_rank.fixture.high'),
        bonus('bonus_type.fixture.unused', 'bonus_rank.fixture.high'),
        bonus('bonus_type.fixture.unused', 'bonus_rank.fixture.high'),
        bonus('bonus_type.fixture.attack', 'bonus_rank.fixture.high'),
      ],
      fixture,
      { weaponTypeId: 'weapon.fixture.a' },
    )
    const chips = screen
      .getAllByRole('listitem')
      .map((item) => item.querySelector<HTMLElement>('.MuiChip-root'))
    expect(chips).toHaveLength(5)
    for (const chip of chips) {
      expect(chip).not.toHaveAttribute('data-bonus-tone')
      expect(chip).not.toHaveAttribute('data-bonus-ex')
    }
  })
})

/** WCAG contrast of two opaque `#rrggbb` colours. */
function contrast(foreground: string, background: string): number {
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((offset) => {
      const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (lighter + 0.05) / (darker + 0.05)
}

/** `foreground` at `opacity` over an opaque `background`, as `#rrggbb`. */
function blend(foreground: string, background: string, opacity: number): string {
  const channels = [1, 3, 5].map((offset) => {
    const fg = parseInt(foreground.slice(offset, offset + 2), 16)
    const bg = parseInt(background.slice(offset, offset + 2), 16)
    return Math.round(fg * opacity + bg * (1 - opacity)).toString(16).padStart(2, '0')
  })
  return '#' + channels.join('')
}

describe('restoration bonus colours on the dark theme', () => {
  const master = loadProductionMaster()
  const darkTheme = createAppTheme('dark')
  const families = ['attack', 'affinity', 'element', 'sharpness_capacity'] as const
  const rankIi = 'bonus_rank.ii'
  const rankEx = 'bonus_rank.ex'
  const familyBonuses: RestorationBonusSet = [
    bonus('bonus_type.attack', rankIi),
    bonus('bonus_type.affinity', rankIi),
    bonus('bonus_type.element', rankIi),
    bonus('bonus_type.gogma_sharpness_capacity', rankIi),
    bonus('bonus_type.attack', rankEx),
  ]

  it('selects the table by mode and keeps Light as the default', () => {
    expect(restorationBonusToneColors('light')).toBe(RESTORATION_BONUS_TONE_COLORS)
    expect(restorationBonusToneColors('dark')).toBe(RESTORATION_BONUS_DARK_TONE_COLORS)
    expect(restorationBonusChipSx('attack', false, 'filled')).toEqual(
      restorationBonusChipSx('attack', false, 'filled', 'light'),
    )
    for (const family of families) {
      expect(RESTORATION_BONUS_DARK_TONE_COLORS[family].text).not.toBe(RESTORATION_BONUS_TONE_COLORS[family].text)
    }
  })

  it('keeps four distinct families readable on the dark surfaces', () => {
    const { paper, default: page } = darkTheme.palette.background
    expect(new Set(families.map((family) => RESTORATION_BONUS_DARK_TONE_COLORS[family].text)).size).toBe(4)
    expect(new Set(families.map((family) => RESTORATION_BONUS_DARK_TONE_COLORS[family].border)).size).toBe(4)
    for (const family of families) {
      const { text, border } = RESTORATION_BONUS_DARK_TONE_COLORS[family]
      for (const surface of [paper, page]) {
        // The label against the plain surface and against the strongest (EX filled) tint.
        expect(contrast(text, surface)).toBeGreaterThanOrEqual(4.5)
        expect(contrast(text, blend(text, surface, 0.16))).toBeGreaterThanOrEqual(4.5)
        // The outline, a non-text cue, against the surface.
        expect(contrast(border, surface)).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('keeps the EX rule in Dark: the same family colours and only a stronger tint', () => {
    for (const variant of ['filled', 'outlined'] as const) {
      for (const family of families) {
        const normal = restorationBonusChipSx(family, false, variant, 'dark')
        const ex = restorationBonusChipSx(family, true, variant, 'dark')
        expect(normal.color).toBe(RESTORATION_BONUS_DARK_TONE_COLORS[family].text)
        expect(normal.borderColor).toBe(RESTORATION_BONUS_DARK_TONE_COLORS[family].border)
        expect(ex.color).toBe(normal.color)
        expect(ex.borderColor).toBe(normal.borderColor)
        expect(ex.boxShadow).toBe(normal.boxShadow)
        expect(tintAlpha(ex.bgcolor)).toBeGreaterThan(tintAlpha(normal.bgcolor))
      }
    }
  })

  it('colours RestorationBonusSlots from the dark table under the dark theme', () => {
    render(
      <ThemeProvider theme={darkTheme}>
        <RestorationBonusSlots
          bonuses={familyBonuses}
          weaponTypeId={master.weaponTypes[0].id}
          master={master}
          scope="gogma_artian"
        />
      </ThemeProvider>,
    )
    const chips = screen
      .getAllByRole('listitem')
      .map((item) => item.querySelector<HTMLElement>('.MuiChip-root')!)
    families.forEach((family, index) => {
      expect(chips[index]).toHaveStyle({ color: rgb(RESTORATION_BONUS_DARK_TONE_COLORS[family].text) })
    })
    expect(chips[4]).toHaveStyle({ color: rgb(RESTORATION_BONUS_DARK_TONE_COLORS.attack.text) })
    expect(chips[4]).toHaveTextContent('EX')
    expect(tintAlpha(getComputedStyle(chips[4]).backgroundColor)).toBeGreaterThan(
      tintAlpha(getComputedStyle(chips[0]).backgroundColor),
    )
  })

  it('gives BonusSlotList exactly the colours RestorationBonusSlots uses under the dark theme', () => {
    render(
      <ThemeProvider theme={darkTheme}>
        <RestorationBonusSlots
          bonuses={familyBonuses}
          weaponTypeId={master.weaponTypes[0].id}
          master={master}
          scope="gogma_artian"
          variant="outlined"
        />
        <BonusSlotList
          heading="番号付き5枠"
          bonuses={familyBonuses}
          weaponTypeId={master.weaponTypes[0].id}
          master={master}
          scope="gogma_artian"
        />
      </ThemeProvider>,
    )
    const chips = within(screen.getByRole('list', { name: '復元ボーナス5枠' }))
      .getAllByRole('listitem')
      .map((item) => item.querySelector<HTMLElement>('.MuiChip-root')!)
    const items = within(screen.getByRole('list', { name: '番号付き5枠' })).getAllByRole('listitem')
    items.forEach((item, index) => {
      const chip = getComputedStyle(chips[index])
      const slot = getComputedStyle(item)
      expect([index, slot.color, slot.borderColor, slot.backgroundColor]).toEqual([
        index,
        chip.color,
        chip.borderColor,
        chip.backgroundColor,
      ])
    })
    expect(items[0]).toHaveStyle({ color: rgb(RESTORATION_BONUS_DARK_TONE_COLORS.attack.text) })
  })

  it('keeps the standard chip for an unknown family under the dark theme', () => {
    const fixture = createValidMasterDataFixture()
    render(
      <ThemeProvider theme={darkTheme}>
        <RestorationBonusSlots
          bonuses={[
            bonus('bonus_type.fixture.attack', 'bonus_rank.fixture.special'),
            bonus('bonus_type.fixture.attack', 'bonus_rank.fixture.high'),
            bonus('bonus_type.fixture.unused', 'bonus_rank.fixture.high'),
            bonus('bonus_type.fixture.unused', 'bonus_rank.fixture.high'),
            bonus('bonus_type.fixture.attack', 'bonus_rank.fixture.high'),
          ]}
          weaponTypeId="weapon.fixture.a"
          master={fixture}
          scope="gogma_artian"
        />
      </ThemeProvider>,
    )
    const darkTexts = new Set(families.map((family) => rgb(RESTORATION_BONUS_DARK_TONE_COLORS[family].text)))
    for (const item of screen.getAllByRole('listitem')) {
      const chip = item.querySelector<HTMLElement>('.MuiChip-root')!
      expect(chip).not.toHaveAttribute('data-bonus-tone')
      expect(darkTexts.has(getComputedStyle(chip).color)).toBe(false)
    }
  })
})
