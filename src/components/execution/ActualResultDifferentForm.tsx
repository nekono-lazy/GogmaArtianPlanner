import { useId } from 'react'
import {
  Alert,
  Button,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Typography,
} from '@mui/material'
import type { ExecutionActualResultObservation } from '../../domain/execution'
import { getGroupSkillOptions, getSeriesSkillOptions } from '../../domain/master/masterSelectors'
import type { MasterDataRoot } from '../../domain/master/masterTypes'
import { BonusSetEditor } from '../forms/BonusSetEditor'
import { actualResultFromDraft, type ActualResultDraft, type ActualSkillChoice } from './actualResultDraft'
import type { ActualResultInputKind } from './executionStepPresentation'

const UNSET = ''
const NONE = '__none__'

function toSelectValue(choice: ActualSkillChoice): string {
  if (choice.status === 'unset') return UNSET
  return choice.status === 'none' ? NONE : choice.id
}

function fromSelectValue(value: string): ActualSkillChoice {
  if (value === UNSET) return { status: 'unset' }
  if (value === NONE) return { status: 'none' }
  return { status: 'skill', id: value }
}

function ActualSkillSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: { id: string; displayNameJa: string }[]
  value: ActualSkillChoice
  onChange(value: ActualSkillChoice): void
}) {
  const labelId = useId()
  return (
    <FormControl fullWidth>
      <InputLabel id={labelId}>{label}</InputLabel>
      <Select
        labelId={labelId}
        label={label}
        value={toSelectValue(value)}
        onChange={(event) => onChange(fromSelectValue(String(event.target.value)))}
      >
        <MenuItem value={UNSET} disabled>
          未入力
        </MenuItem>
        <MenuItem value={NONE}>スキルなし</MenuItem>
        {options.map((skill) => (
          <MenuItem key={skill.id} value={skill.id}>
            {skill.displayNameJa}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  )
}

/**
 * 「結果が違う」 actual result input (`docs/UI_FLOW.md` 12.4).
 *
 * The five slots reuse the Owned Weapon editor and its Production availability
 * with the scope the operation's result contract fixes; the Skills come from
 * the enabled Series / Group Skill Master options. Nothing is copied from the
 * expected result, and recording stays disabled until every field is entered.
 * The runtime still validates the record and refuses a result equal to the
 * prediction.
 */
export function ActualResultDifferentForm({
  master,
  kind,
  weaponTypeId,
  elementId,
  draft,
  disabled,
  onChange,
  onSubmit,
  onCancel,
}: {
  master: MasterDataRoot
  kind: ActualResultInputKind
  weaponTypeId: string
  elementId: string
  draft: ActualResultDraft
  disabled: boolean
  onChange(draft: ActualResultDraft): void
  onSubmit(actualResult: ExecutionActualResultObservation): void
  onCancel(): void
}) {
  const actualResult = actualResultFromDraft(kind, draft)
  return (
    <Stack spacing={1.5} role="region" aria-label="実際の結果の入力">
      <Alert severity="warning" role="note">
        案内どおりの操作を1回だけ行い、結果だけが想定と違った場合に記録します。
        記録すると、この操作のCounter消費と実際の結果を保存し、生産計画を停止します。
      </Alert>
      <Typography variant="body2">ゲーム画面に表示された実際の結果を入力してください。</Typography>
      {kind.kind === 'restoration_bonuses' ? (
        <BonusSetEditor
          label="実際の復元ボーナス5枠"
          master={master}
          weaponTypeId={weaponTypeId}
          elementId={elementId}
          scope={kind.scope}
          value={draft.slots}
          onChange={(slots) => onChange({ ...draft, slots })}
        />
      ) : (
        <Stack spacing={1.5}>
          <ActualSkillSelect
            label="実際のシリーズスキル"
            options={getSeriesSkillOptions(master)}
            value={draft.series}
            onChange={(series) => onChange({ ...draft, series })}
          />
          <ActualSkillSelect
            label="実際のグループスキル"
            options={getGroupSkillOptions(master)}
            value={draft.group}
            onChange={(group) => onChange({ ...draft, group })}
          />
        </Stack>
      )}
      {actualResult === null && (
        <Typography variant="body2" color="text.secondary">
          {kind.kind === 'restoration_bonuses'
            ? '5枠すべてのボーナス種別とランクを入力すると記録できます。'
            : 'シリーズスキルとグループスキルを両方選ぶと記録できます（無い場合は「スキルなし」）。'}
        </Typography>
      )}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} useFlexGap>
        <Button
          variant="contained"
          color="warning"
          size="large"
          disabled={disabled || actualResult === null}
          onClick={() => {
            if (actualResult !== null) onSubmit(actualResult)
          }}
          sx={{ minHeight: 48, width: { xs: '100%', sm: 'auto' } }}
        >
          実際の結果を記録して計画を停止
        </Button>
        <Button
          variant="outlined"
          color="inherit"
          disabled={disabled}
          onClick={onCancel}
          sx={{ minHeight: 44, width: { xs: '100%', sm: 'auto' } }}
        >
          入力をやめて戻る
        </Button>
      </Stack>
    </Stack>
  )
}
