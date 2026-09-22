import { alpha } from '@mui/material/styles'
import type { BonusRankMasterLookup } from '../domain/master/masterSelectors'
import { isExRank } from '../domain/master/masterSelectors'
import type { BonusRankId, BonusTypeId } from '../domain/models/publicTypes'

/**
 * Presentation-only colour coding of restoration bonus slots (Issue #69,
 * `docs/UI_FLOW.md` 3.4).
 *
 * A tone is a display family of the Bonus Type: it makes the five slots
 * easier to tell apart at a glance and carries no Domain meaning. The text
 * label stays the authority - `RestorationBonusSlots` never changes it - so
 * colour is only a secondary cue, and an EX rank is additionally emphasised
 * through weight and border, never through colour alone.
 *
 * The family is resolved from the stable `bonusTypeId`, never from a display
 * name. Normal-side and Gogma-side types of one meaning share a family, so a
 * converted weapon's inherited normal-scope slots read like the Gogma slots
 * that replace them. A `bonusTypeId` outside this table gets no tone: the
 * caller keeps the standard Chip style instead of guessing a family from the
 * ID text.
 */
export type RestorationBonusTone = 'attack' | 'affinity' | 'element' | 'sharpness_capacity'

const TONE_BY_BONUS_TYPE_ID: Readonly<Record<string, RestorationBonusTone>> = {
  'bonus_type.attack': 'attack',
  'bonus_type.affinity': 'affinity',
  'bonus_type.element': 'element',
  'bonus_type.normal_sharpness': 'sharpness_capacity',
  'bonus_type.normal_capacity': 'sharpness_capacity',
  'bonus_type.gogma_sharpness_capacity': 'sharpness_capacity',
}

export function resolveRestorationBonusTone(
  bonusTypeId: BonusTypeId,
): RestorationBonusTone | null {
  return TONE_BY_BONUS_TYPE_ID[bonusTypeId] ?? null
}

/**
 * Whether a rank is EX, by the Master `BonusRankMaster.isEx` authority.
 *
 * Display must not throw on a persisted rank the Master no longer knows, so a
 * missing rank is "not EX" here; entity validation reports it elsewhere.
 */
export function isRestorationBonusExRank(
  master: BonusRankMasterLookup,
  bonusRankId: BonusRankId,
): boolean {
  if (!master.bonusRanks.some(({ id }) => id === bonusRankId)) return false
  return isExRank(master, bonusRankId)
}

/**
 * Tone colours on the light theme.
 *
 * `text` is the label colour and the reference colour of the background
 * tint; it keeps at least 4.5:1 against white and against every tint used
 * below. `border` is a lighter shade of the same hue for the outline and keeps
 * at least 3:1 against the page background (`#f5f5f1`), the WCAG non-text
 * minimum. The amber family deliberately uses a dark brown-amber text and
 * reserves the yellow for the border, because a bright yellow label is not
 * readable on a white surface.
 */
export const RESTORATION_BONUS_TONE_COLORS: Readonly<
  Record<RestorationBonusTone, { text: string; border: string }>
> = {
  attack: { text: '#9c2a21', border: '#c2554d' },
  affinity: { text: '#5f3d9e', border: '#8f73c4' },
  element: { text: '#1b6a8f', border: '#3f8db3' },
  sharpness_capacity: { text: '#7a5200', border: '#ad7f16' },
}

export type RestorationBonusChipVariant = 'filled' | 'outlined'

/** A plain `sx` object, so a caller can spread it next to its own layout rules. */
export interface RestorationBonusChipStyle {
  color: string
  borderColor: string
  bgcolor: string
  boxShadow: string
  '& .MuiChip-label': { fontWeight: number | undefined }
}

/**
 * Chip `sx` for one slot.
 *
 * The two variants keep their existing contrast: `outlined` stays a
 * transparent chip with a coloured 1px border, `filled` stays a tinted chip
 * and draws its border as an inset ring so no Chip dimension changes. EX adds
 * weight 700, one more ring pixel and a stronger tint, all inside the Chip's
 * fixed box, so an EX slot is exactly as tall and wide as a normal one and
 * the five slots wrap the same way as before.
 */
export function restorationBonusChipSx(
  tone: RestorationBonusTone,
  isEx: boolean,
  variant: RestorationBonusChipVariant,
): RestorationBonusChipStyle {
  const { text, border } = RESTORATION_BONUS_TONE_COLORS[tone]
  const ringWidth = variant === 'outlined' ? (isEx ? 1 : 0) : isEx ? 2 : 1
  const tint = variant === 'outlined' ? (isEx ? 0.08 : 0) : isEx ? 0.18 : 0.1
  return {
    color: text,
    borderColor: border,
    bgcolor: tint === 0 ? 'transparent' : alpha(text, tint),
    boxShadow: ringWidth === 0 ? 'none' : `inset 0 0 0 ${ringWidth}px ${border}`,
    '& .MuiChip-label': { fontWeight: isEx ? 700 : undefined },
  }
}
