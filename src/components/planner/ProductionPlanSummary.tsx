import { Chip, Paper, Stack, Typography } from '@mui/material'
import type { ProductionPlan } from '../../domain/models/publicTypes'
import { productionPlanStatusLabels } from '../../presentation/labels'
import { createProductionPlanSummary } from './productionPlanPresentation'

/**
 * The Plan overview, derived only from the exact persisted Plan.
 *
 * The secured-weapon count comes from the steps the Plan itself marks
 * `expectedResult.shouldSecure === true`; neither the Target count nor
 * `selectedBuildListEntryIds.length` is treated as a weapon count.
 */
export function ProductionPlanSummary({ plan }: { plan: ProductionPlan }) {
  const summary = createProductionPlanSummary(plan)
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={1}>
        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          sx={{ flexWrap: 'wrap', alignItems: 'center' }}
        >
          <Typography component="h2" variant="h2">
            計画の概要
          </Typography>
          <Chip
            label={productionPlanStatusLabels[summary.status]}
            size="small"
            color={summary.status === 'draft' ? 'primary' : 'default'}
          />
        </Stack>
        <Typography variant="body2">計画ID: {summary.planId}</Typography>
        <Typography variant="body2">作成日時: {summary.createdAt}</Typography>
        <Typography variant="body2">
          全ステップ数: {summary.totalStepCount}
        </Typography>
        <Typography variant="body2">
          目標武器数: {summary.targetWeaponCount}
        </Typography>
        <Typography variant="body2">
          確保予定数: {summary.securedStepCount}
        </Typography>
      </Stack>
    </Paper>
  )
}
