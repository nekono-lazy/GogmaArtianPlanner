import { useId } from 'react'
import { Box, Paper, Stack, Typography } from '@mui/material'
import type { ProductionPlan, ProductionPlanStatus } from '../../domain/models/publicTypes'
import { productionPlanStatusLabels } from '../../presentation/labels'
import { StatusChip, type StatusTone } from '../StatusChip'
import { createProductionPlanSummary } from './productionPlanPresentation'

const statusTones: Record<ProductionPlanStatus, StatusTone> = {
  draft: 'info',
  active: 'positive',
  completed: 'positive',
  stale: 'caution',
  abandoned: 'neutral',
}

/** One figure of the overview. Numbers are tabular; long tokens wrap. */
function SummaryFigure({
  label,
  value,
  span = false,
  numeric = false,
}: {
  label: string
  value: string | number
  span?: boolean
  numeric?: boolean
}) {
  return (
    <Box
      sx={{
        border: 1,
        borderColor: 'divider',
        borderRadius: 1,
        px: 1.25,
        py: 1,
        minWidth: 0,
        gridColumn: span ? '1 / -1' : undefined,
      }}
    >
      <Typography component="dt" variant="caption" color="text.secondary" sx={{ display: 'block' }}>
        {label}
      </Typography>
      <Typography
        component="dd"
        variant={numeric ? 'h3' : 'body2'}
        className={numeric ? 'tabular-nums' : undefined}
        sx={{ m: 0, overflowWrap: 'anywhere', ...(numeric ? { fontSize: '1.25rem' } : {}) }}
      >
        {value}
      </Typography>
    </Box>
  )
}

/**
 * The Plan overview, derived only from the exact persisted Plan.
 *
 * The secured-weapon count comes from the steps the Plan itself marks
 * `expectedResult.shouldSecure === true`; neither the Target count nor
 * `selectedBuildListEntryIds.length` is treated as a weapon count. The
 * adopted BuildListEntry count is shown as its own figure, named as an Entry
 * count, so the two are never confused.
 *
 * This is the single place the Plan ID and status are shown on the page.
 */
export function ProductionPlanSummary({ plan }: { plan: ProductionPlan }) {
  const summary = createProductionPlanSummary(plan)
  const headingId = useId()
  return (
    <Paper
      component="section"
      aria-labelledby={headingId}
      variant="outlined"
      sx={{ p: { xs: 2, md: 2.5 }, minWidth: 0 }}
    >
      <Stack spacing={1.5}>
        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          sx={{ flexWrap: 'wrap', alignItems: 'center' }}
        >
          <Typography id={headingId} component="h2" variant="h2">
            計画の概要
          </Typography>
          <StatusChip
            label={productionPlanStatusLabels[summary.status]}
            tone={statusTones[summary.status]}
          />
        </Stack>
        <Box
          component="dl"
          sx={{
            m: 0,
            display: 'grid',
            gridTemplateColumns: {
              xs: 'repeat(2, minmax(0, 1fr))',
              md: 'repeat(4, minmax(0, 1fr))',
            },
            gap: 1,
          }}
        >
          <SummaryFigure label="全ステップ数" value={summary.totalStepCount} numeric />
          <SummaryFigure label="目標武器数" value={summary.targetWeaponCount} numeric />
          <SummaryFigure label="確保予定数" value={summary.securedStepCount} numeric />
          <SummaryFigure
            label="採用候補（BuildListEntry）"
            value={plan.selectedBuildListEntryIds.length}
            numeric
          />
          <SummaryFigure label="作成日時" value={summary.createdAt} />
          <SummaryFigure label="計画ID" value={summary.planId} />
        </Box>
      </Stack>
    </Paper>
  )
}
