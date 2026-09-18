import { Alert, Button, Stack, Typography } from '@mui/material'
import { Link as RouterLink } from 'react-router-dom'
import type { ProductionPlan } from '../../domain/models/publicTypes'
import { productionPlanAbandonmentReasonLabels } from '../../presentation/labels'

/**
 * The Execution entry point of the Production Plan page (`docs/UI_FLOW.md` 11):
 * 「作成開始」 for a draft, 「実行ナビを再開する」 for an active Plan, and a
 * read-only note for an ended Plan. Starting is the runtime's decision; this
 * component never changes a Plan status on its own. A stale Plan is left to the
 * page's existing recalculation guidance.
 */
export function PlanExecutionEntry({
  plan,
  starting,
  startError,
  onStart,
}: {
  plan: ProductionPlan
  starting: boolean
  startError: string | null
  onStart(): void
}) {
  const buttonSx = { minHeight: 48, width: { xs: '100%', sm: 'auto' }, alignSelf: { sm: 'flex-start' } }
  switch (plan.status) {
    case 'draft':
      return (
        <Stack spacing={1.5}>
          <Button variant="contained" size="large" disabled={starting} onClick={onStart} sx={buttonSx}>
            作成開始
          </Button>
          {starting && (
            <Typography variant="body2" role="status">
              生産計画を開始しています。
            </Typography>
          )}
          {startError !== null && <Alert severity="error">{startError}</Alert>}
        </Stack>
      )
    case 'active':
      return (
        <Button
          component={RouterLink}
          to={`/plans/${plan.id}/run`}
          variant="contained"
          size="large"
          sx={buttonSx}
        >
          実行ナビを再開する
        </Button>
      )
    case 'completed':
      return <Alert severity="success">この生産計画は完了しています。</Alert>
    case 'abandoned':
      return (
        <Alert severity="info">
          この生産計画は終了しています（
          {plan.abandonmentReason === null
            ? '終了理由の記録なし'
            : productionPlanAbandonmentReasonLabels[plan.abandonmentReason]}
          ）。
        </Alert>
      )
    case 'stale':
      return null
  }
}
