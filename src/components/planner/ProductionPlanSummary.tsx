import { useId } from 'react'
import { Alert, Box, Paper, Stack, Typography } from '@mui/material'
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
  detail,
}: {
  label: string
  value: string | number
  span?: boolean
  numeric?: boolean
  /** A secondary line under the value, inside the same `dd`. */
  detail?: string
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
        {detail !== undefined && (
          <Typography
            component="span"
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', overflowWrap: 'anywhere' }}
          >
            {detail}
          </Typography>
        )}
      </Typography>
    </Box>
  )
}

/**
 * The Plan overview, derived only from the exact persisted Plan.
 *
 * The planned completion count is the distinct Targets of
 * `executionEffects.targetCompletions` (UI_FLOW 11.0); a legacy Plan shows it
 * as unknown. Neither the Target count nor
 * `selectedBuildListEntryIds.length` is treated as a weapon count. The
 * adopted BuildListEntry count is shown as its own figure, named as an Entry
 * count, so the two are never confused.
 *
 * The Conflict figure is `plan.conflicts.length` of this exact persisted Plan:
 * a count of Conflict records, never of Targets or weapons, never re-derived
 * from the current input, and never added to the rejected Entries. The stored
 * selections are shown as stored, so no Conflict is declared unresolved.
 * When any Conflict is recorded, a note says the Plan may not complete every
 * Target - without guessing how many.
 *
 * This is the single place the Plan ID and status are shown on the page.
 */
export function ProductionPlanSummary({ plan }: { plan: ProductionPlan }) {
  const summary = createProductionPlanSummary(plan)
  const hasConflicts = summary.conflictCount > 0
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
          {/* Text carries the state; the tone only reinforces it. */}
          <StatusChip
            label={hasConflicts ? `競合あり（${summary.conflictCount}件）` : '競合なし'}
            tone={hasConflicts ? 'caution' : 'neutral'}
          />
        </Stack>
        {/* A persistent part of the overview, not a status change: a `note`,
            so it is never announced as an alert. */}
        {hasConflicts && (
          <Alert severity="info" role="note">
            {`この計画には競合が${summary.conflictCount}件記録されています。` +
              '件数は競合の記録数で、作成できない目標武器の数ではありません。' +
              '競合の扱いによっては、この計画では完成しない目標武器がある場合があります。' +
              '「完成予定の目標武器数」と、競合の内容を確認してください。'}
          </Alert>
        )}
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
          {summary.plannedCompletionTargetCount === null ? (
            <SummaryFigure label="完成予定の目標武器数" value="不明（旧形式の計画）" />
          ) : (
            <SummaryFigure
              label="完成予定の目標武器数"
              value={summary.plannedCompletionTargetCount}
              numeric
            />
          )}
          <SummaryFigure
            label="採用候補（BuildListEntry）"
            value={plan.selectedBuildListEntryIds.length}
            numeric
          />
          <SummaryFigure
            label="競合（記録件数）"
            value={hasConflicts ? `${summary.conflictCount}件` : 'なし'}
            numeric={hasConflicts}
            detail={
              hasConflicts
                ? `うち候補を選択済み ${summary.selectedConflictCount}件`
                : undefined
            }
          />
          <SummaryFigure label="作成日時" value={summary.createdAt} />
          <SummaryFigure label="計画ID" value={summary.planId} />
        </Box>
      </Stack>
    </Paper>
  )
}
