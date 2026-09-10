import { Chip, Divider, Paper, Stack, Typography } from '@mui/material'
import type { MasterDataRoot } from '../../domain/master/masterTypes'
import type {
  PlanStep,
  TargetWeaponId,
} from '../../domain/models/publicTypes'
import {
  candidateCategoryLabels,
  planStepOperationLabels,
} from '../../presentation/labels'
import { RestorationBonusSlots } from '../RestorationBonusSlots'
import { groupSkillLabel, seriesSkillLabel } from '../search/searchPresentation'
import {
  isSharedPlanStep,
  type TargetWeaponLookup,
} from './productionPlanPresentation'

/**
 * A Target reference that may no longer resolve.
 *
 * Ordinary CRUD protects a referenced Target from deletion, but imported,
 * legacy, or corrupt data can still leave a dangling reference. It falls back
 * to the raw ID instead of hiding the Step or failing the page, and no
 * generation-time Target name snapshot is introduced for it.
 */
function TargetWeaponReference({
  targetWeaponId,
  lookup,
}: {
  targetWeaponId: TargetWeaponId
  lookup: TargetWeaponLookup
}) {
  const target = lookup.byId(targetWeaponId)
  if (target) return <>{target.name}</>
  return <>削除済みまたは参照できない目標武器（{targetWeaponId}）</>
}

function ExpectedResultView({
  step,
  weaponTypeId,
  master,
}: {
  step: PlanStep
  weaponTypeId: string
  master: MasterDataRoot
}) {
  const expected = step.expectedResult
  if (expected === null) {
    return (
      <Typography variant="body2" color="text.secondary">
        想定結果: 予測結果なし
      </Typography>
    )
  }
  return (
    <Stack spacing={0.5}>
      <Typography variant="body2">想定結果</Typography>
      {expected.restorationBonuses === null ? (
        <Typography variant="body2" color="text.secondary">
          復元ボーナス: 対象外
        </Typography>
      ) : (
        <RestorationBonusSlots
          bonuses={expected.restorationBonuses}
          weaponTypeId={weaponTypeId}
          master={master}
          variant="outlined"
        />
      )}
      <Typography variant="body2">
        シリーズ: {seriesSkillLabel(expected.seriesSkillId, master)} ／ グループ:{' '}
        {groupSkillLabel(expected.groupSkillId, master)}
      </Typography>
      {expected.candidateCategory !== null && (
        <Typography variant="body2">
          候補区分: {candidateCategoryLabels[expected.candidateCategory]}
        </Typography>
      )}
    </Stack>
  )
}

/**
 * One persisted PlanStep.
 *
 * Everything shown comes from the Step itself: its persisted `title` /
 * `instruction`, its `operationType`, and its `expectedResult`. The operation
 * is never regenerated from a Candidate route, and no RNG prediction runs here.
 */
export function ProductionPlanStepCard({
  step,
  lookup,
  master,
  showSharedBadge = false,
}: {
  step: PlanStep
  lookup: TargetWeaponLookup
  master: MasterDataRoot
  showSharedBadge?: boolean
}) {
  // The primary Target decides which weapon-type bonus names apply; a shared
  // Step keeps that single persisted resolution rather than inventing one.
  const weaponTypeId =
    step.targetWeaponId === null
      ? ''
      : lookup.byId(step.targetWeaponId)?.weaponTypeId ?? ''
  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Stack spacing={0.75}>
        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          sx={{ flexWrap: 'wrap', alignItems: 'center' }}
        >
          <Typography variant="subtitle2">ステップ {step.order}</Typography>
          <Chip
            label={planStepOperationLabels[step.operationType]}
            size="small"
            variant="outlined"
          />
          {step.expectedResult?.shouldSecure === true && (
            <Chip label="確保予定" size="small" color="success" />
          )}
          {showSharedBadge && isSharedPlanStep(step) && (
            <Chip label="共有操作" size="small" color="info" variant="outlined" />
          )}
        </Stack>
        <Typography variant="body2">{step.title}</Typography>
        <Typography variant="body2" color="text.secondary">
          {step.instruction}
        </Typography>
        <Typography variant="body2">
          対象:{' '}
          {step.targetWeaponId === null ? (
            '目標武器に紐づかない操作'
          ) : (
            <TargetWeaponReference
              targetWeaponId={step.targetWeaponId}
              lookup={lookup}
            />
          )}
        </Typography>
        {showSharedBadge && isSharedPlanStep(step) && (
          <Typography variant="caption" color="text.secondary">
            この操作は他の目標武器と共有され、計画全体では1回だけ実行します。
          </Typography>
        )}
        <Divider />
        <ExpectedResultView step={step} weaponTypeId={weaponTypeId} master={master} />
      </Stack>
    </Paper>
  )
}

export function ProductionPlanStepList({
  steps,
  lookup,
  master,
  showSharedBadge = false,
}: {
  steps: readonly PlanStep[]
  lookup: TargetWeaponLookup
  master: MasterDataRoot
  showSharedBadge?: boolean
}) {
  return (
    <Stack spacing={1}>
      {steps.map((step) => (
        <ProductionPlanStepCard
          key={step.id}
          step={step}
          lookup={lookup}
          master={master}
          showSharedBadge={showSharedBadge}
        />
      ))}
    </Stack>
  )
}
