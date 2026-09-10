import { Chip, Stack } from '@mui/material'
import type { MasterDataRoot } from '../domain/master/masterTypes'
import type { RestorationBonusSet } from '../domain/models/publicTypes'
import { bonusLabel } from './search/searchPresentation'

/**
 * The five restoration bonus slots in their stored slot order.
 *
 * Slot order is semantic - Keep preserves the bonus family at each slot
 * position - so the slots are never sorted, grouped, or normalized to a
 * multiset for display, and the React key is the slot index because two slots
 * may legitimately hold the identical bonus.
 */
export function RestorationBonusSlots({
  bonuses,
  weaponTypeId,
  master,
  variant,
}: {
  bonuses: RestorationBonusSet
  weaponTypeId: string
  master: MasterDataRoot
  variant?: 'filled' | 'outlined'
}) {
  return (
    <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
      {bonuses.map((bonus, index) => (
        <Chip
          key={`slot-${index}`}
          label={bonusLabel(bonus, weaponTypeId, master)}
          size="small"
          variant={variant}
        />
      ))}
    </Stack>
  )
}
