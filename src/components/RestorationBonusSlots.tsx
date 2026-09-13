import { Box, Chip } from '@mui/material'
import type { ArtianBonusScope, MasterDataRoot } from '../domain/master/masterTypes'
import type { RestorationBonusSet } from '../domain/models/publicTypes'
import { bonusLabel } from './search/searchPresentation'

/**
 * The five restoration bonus slots in their stored slot order.
 *
 * Slot order is semantic - Keep preserves the bonus family at each slot
 * position - so the slots are never sorted, grouped, or normalized to a
 * multiset for display, and the React key is the slot index because two slots
 * may legitimately hold the identical bonus.
 *
 * The slots are exposed as a labelled list, so assistive technology reads
 * five items rather than five loose chips. The wrapper is deliberately not a
 * `<ul>` / `<li>`: route step lists that contain these slots are `<ol>` items
 * of their own, and a nested `<li>` would be counted among them.
 *
 * `scope` selects the scope-specific Master definition label. Callers that
 * know the scope of what they render pass it; omitting it keeps the historical
 * lookup of `bonusLabel` for call sites that predate scope-aware display.
 */
export function RestorationBonusSlots({
  bonuses,
  weaponTypeId,
  master,
  scope,
  variant,
  label = '復元ボーナス5枠',
}: {
  bonuses: RestorationBonusSet
  weaponTypeId: string
  master: MasterDataRoot
  scope?: ArtianBonusScope
  variant?: 'filled' | 'outlined'
  /** Accessible name of the slot list. */
  label?: string
}) {
  return (
    <Box
      role="list"
      aria-label={label}
      sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, minWidth: 0 }}
    >
      {bonuses.map((bonus, index) => (
        <Box role="listitem" key={`slot-${index}`} sx={{ minWidth: 0, maxWidth: '100%' }}>
          <Chip
            label={bonusLabel(bonus, weaponTypeId, master, scope)}
            size="small"
            variant={variant}
            sx={{ maxWidth: '100%' }}
          />
        </Box>
      ))}
    </Box>
  )
}
