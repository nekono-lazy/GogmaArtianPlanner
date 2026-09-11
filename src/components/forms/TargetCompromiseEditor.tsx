import { Button, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material'
import { getBonusDefinitionsForWeapon, getRanksForBonusType } from '../../domain/master/masterSelectors'
import type { MasterDataRoot } from '../../domain/master/masterTypes'
import type { AlternativeBonusOption, TargetWeapon } from '../../domain/models/publicTypes'
import type { TargetWeaponDraft } from '../../services/crud/entityCrudServices'

type Compromise = Pick<TargetWeapon, 'practicalBonusConditions' | 'alternativeBonusRules'>

export function TargetCompromiseEditor({ target, master, onChange }: {
  target: TargetWeaponDraft
  master: MasterDataRoot
  onChange(value: Compromise): void
}) {
  const idealTypes = [...new Set(target.idealBonuses.map((bonus) => bonus.bonusTypeId))]
  const availableTypes = [...new Set(getBonusDefinitionsForWeapon(master, target.weaponTypeId, target.elementId, 'gogma_artian').map((bonus) => bonus.bonusTypeId))]
  const count = (type: string) => target.idealBonuses.filter((bonus) => bonus.bonusTypeId === type).length
  const label = (type: string) => master.bonusTypes.find((entry) => entry.id === type)?.displayNameJa ?? type
  const ranks = (type: string) => getRanksForBonusType(master, target.weaponTypeId, target.elementId, type, 'gogma_artian')
  const minimum = (type: string) => ranks(type)[0]?.id ?? ''
  const newOption = (type: string): AlternativeBonusOption => ({ alternativeBonusTypeId: type, minimumRankId: minimum(type), requiredExCount: 0 })
  const setPractical = (practicalBonusConditions: Compromise['practicalBonusConditions']) => onChange({ practicalBonusConditions, alternativeBonusRules: target.alternativeBonusRules })
  const setRules = (alternativeBonusRules: Compromise['alternativeBonusRules']) => onChange({ practicalBonusConditions: target.practicalBonusConditions, alternativeBonusRules })
  const unusedPractical = idealTypes.filter((type) => !target.practicalBonusConditions.some((condition) => condition.bonusTypeId === type))
  const unusedSources = idealTypes.filter((type) => !target.alternativeBonusRules.some((rule) => rule.sourceBonusTypeId === type))
  const number = (value: string) => value === '' ? Number.NaN : Number(value)
  const displayed = (value: number) => Number.isNaN(value) ? '' : value
  return <Stack spacing={3}>
    <Stack spacing={1}>
      <Typography variant="h3">実用ボーナス条件</Typography>
      <Typography>種類と個数は理想のまま、指定した種類のランクだけ妥協します。未登録の種類は理想のランク構成が必要です。</Typography>
      {target.practicalBonusConditions.map((condition, index) => {
        const update = (changes: Partial<typeof condition>) => setPractical(target.practicalBonusConditions.map((entry, i) => i === index ? { ...entry, ...changes } : entry))
        return <Paper key={condition.id} variant="outlined" sx={{ p: 2 }}><Stack spacing={1}>
          <TextField select label="ボーナス種別" value={condition.bonusTypeId} onChange={(event) => update({ bonusTypeId: event.target.value, minimumRankId: minimum(event.target.value), requiredExCount: 0 })}>
            {idealTypes.filter((type) => type === condition.bonusTypeId || unusedPractical.includes(type)).map((type) => <MenuItem key={type} value={type}>{label(type)}</MenuItem>)}
          </TextField>
          <Typography>理想での個数: {count(condition.bonusTypeId)}</Typography>
          <TextField select label="最低ランク" value={condition.minimumRankId} onChange={(event) => update({ minimumRankId: event.target.value })}>
            {ranks(condition.bonusTypeId).map((rank) => <MenuItem key={rank.id} value={rank.id}>{rank.displayNameJa}</MenuItem>)}
          </TextField>
          <TextField label="EX最低必要数" type="number" value={displayed(condition.requiredExCount)} slotProps={{ htmlInput: { min: 0, max: count(condition.bonusTypeId) } }} onChange={(event) => update({ requiredExCount: number(event.target.value) })} />
          <Button color="error" onClick={() => setPractical(target.practicalBonusConditions.filter((_, i) => i !== index))}>条件を削除</Button>
        </Stack></Paper>
      })}
      <Button disabled={unusedPractical.length === 0} onClick={() => {
        const type = unusedPractical[0]
        if (type) setPractical([...target.practicalBonusConditions, { id: crypto.randomUUID(), bonusTypeId: type, minimumRankId: minimum(type), requiredExCount: 0 }])
      }}>実用条件を追加</Button>
    </Stack>
    <Stack spacing={1}>
      <Typography variant="h3">代替ボーナス条件</Typography>
      <Typography>代替条件は1つの元ボーナス・1つの代替候補だけを使用します。複数の代替条件を同時には使用しません。代替した枠以外は理想条件のままです。実用ボーナス条件との併用はしません。</Typography>
      {target.alternativeBonusRules.map((rule, index) => {
        const update = (changes: Partial<typeof rule>) => setRules(target.alternativeBonusRules.map((entry, i) => i === index ? { ...entry, ...changes } : entry))
        const unusedOptions = availableTypes.filter((type) => type !== rule.sourceBonusTypeId && !rule.options.some((option) => option.alternativeBonusTypeId === type))
        return <Paper key={rule.id} variant="outlined" sx={{ p: 2 }}><Stack spacing={2}>
          <TextField select label="元ボーナス" value={rule.sourceBonusTypeId} onChange={(event) => {
            const source = event.target.value
            const alternative = availableTypes.find((type) => type !== source)
            update({ sourceBonusTypeId: source, maxReplacementCount: 1, options: alternative ? [newOption(alternative)] : [] })
          }}>
            {idealTypes.filter((type) => type === rule.sourceBonusTypeId || unusedSources.includes(type)).map((type) => <MenuItem key={type} value={type}>{label(type)}</MenuItem>)}
          </TextField>
          <TextField label="最大置換数" type="number" value={displayed(rule.maxReplacementCount)} slotProps={{ htmlInput: { min: 1, max: count(rule.sourceBonusTypeId) } }} onChange={(event) => update({ maxReplacementCount: number(event.target.value) })} />
          {rule.options.map((option, optionIndex) => {
            const updateOption = (changes: Partial<AlternativeBonusOption>) => update({ options: rule.options.map((entry, i) => i === optionIndex ? { ...entry, ...changes } : entry) })
            return <Stack key={optionIndex} spacing={1}>
              <TextField select label="代替ボーナス種別" value={option.alternativeBonusTypeId} onChange={(event) => updateOption(newOption(event.target.value))}>
                {availableTypes.filter((type) => type !== rule.sourceBonusTypeId && (type === option.alternativeBonusTypeId || unusedOptions.includes(type))).map((type) => <MenuItem key={type} value={type}>{label(type)}</MenuItem>)}
              </TextField>
              <TextField select label="代替最低ランク" value={option.minimumRankId} onChange={(event) => updateOption({ minimumRankId: event.target.value })}>
                {ranks(option.alternativeBonusTypeId).map((rank) => <MenuItem key={rank.id} value={rank.id}>{rank.displayNameJa}</MenuItem>)}
              </TextField>
              <TextField label="代替EX最低必要数" type="number" value={displayed(option.requiredExCount)} slotProps={{ htmlInput: { min: 0, max: rule.maxReplacementCount } }} onChange={(event) => updateOption({ requiredExCount: number(event.target.value) })} />
              <Button color="error" onClick={() => update({ options: rule.options.filter((_, i) => i !== optionIndex) })}>代替候補を削除</Button>
            </Stack>
          })}
          <Button disabled={unusedOptions.length === 0} onClick={() => {
            const type = unusedOptions[0]
            if (type) update({ options: [...rule.options, newOption(type)] })
          }}>代替候補を追加</Button>
          <Button color="error" onClick={() => setRules(target.alternativeBonusRules.filter((_, i) => i !== index))}>代替条件を削除</Button>
        </Stack></Paper>
      })}
      <Button disabled={unusedSources.length === 0 || availableTypes.length < 2} onClick={() => {
        const source = unusedSources[0]
        const alternative = availableTypes.find((type) => type !== source)
        if (source && alternative) setRules([...target.alternativeBonusRules, { id: crypto.randomUUID(), sourceBonusTypeId: source, maxReplacementCount: 1, options: [newOption(alternative)] }])
      }}>代替条件を追加</Button>
    </Stack>
  </Stack>
}
