import { Alert, Box, FormControl, InputLabel, MenuItem, Select, Stack, Typography } from '@mui/material'
import type { ArtianBonusScope, MasterDataRoot } from '../../domain/master/masterTypes'
import { getBonusDefinitionsForWeapon, getRanksForBonusType } from '../../domain/master/masterSelectors'
import type { RestorationBonusSet } from '../../domain/models/publicTypes'

interface BonusSetEditorProps {
  label: string
  master: MasterDataRoot
  weaponTypeId: string
  elementId: string
  scope: ArtianBonusScope
  value: RestorationBonusSet
  onChange(value: RestorationBonusSet): void
}

export function BonusSetEditor({ label, master, weaponTypeId, elementId, scope, value, onChange }: BonusSetEditorProps) {
  const definitions = getBonusDefinitionsForWeapon(
    master,
    weaponTypeId,
    elementId,
    scope,
  )
  const typeIds = [...new Set(definitions.map(({ bonusTypeId }) => bonusTypeId))]
  if (typeIds.length === 0) return <Alert severity="error">{label}: 復元ボーナスのマスターデータが利用できません。</Alert>

  const update = (index: number, bonusTypeId: string, bonusRankId?: string) => {
    const ranks = getRanksForBonusType(master, weaponTypeId, elementId, bonusTypeId, scope)
    const next = value.map((bonus) => ({ ...bonus })) as RestorationBonusSet
    next[index] = { bonusTypeId, bonusRankId: bonusRankId ?? ranks[0]?.id ?? '' }
    onChange(next)
  }

  return <Stack spacing={1.5}>
    <Typography component="h3" variant="h3">{label}</Typography>
    {value.map((bonus, index) => {
      const ranks = getRanksForBonusType(master, weaponTypeId, elementId, bonus.bonusTypeId, scope)
      // One slot per row, type and rank side by side at every width, so a
      // rank always reads as belonging to its slot on a narrow screen too.
      return <Box key={index} sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1fr)', gap: 1 }}>
        <FormControl fullWidth><InputLabel id={`${label}-${index}-type`}>枠{index + 1} ボーナス種別</InputLabel><Select labelId={`${label}-${index}-type`} label={`枠${index + 1} ボーナス種別`} value={bonus.bonusTypeId} onChange={(event) => update(index, event.target.value)}>{typeIds.map((id) => <MenuItem key={id} value={id}>{master.bonusTypes.find((type) => type.id === id)?.displayNameJa ?? '不明'}</MenuItem>)}</Select></FormControl>
        <FormControl fullWidth><InputLabel id={`${label}-${index}-rank`}>枠{index + 1} ランク</InputLabel><Select labelId={`${label}-${index}-rank`} label={`枠${index + 1} ランク`} value={bonus.bonusRankId} onChange={(event) => update(index, bonus.bonusTypeId, event.target.value)}>{ranks.map((rank) => <MenuItem key={rank.id} value={rank.id}>{rank.displayNameJa}</MenuItem>)}</Select></FormControl>
      </Box>
    })}
  </Stack>
}
