import { Alert, Divider, Paper, Stack, Typography } from '@mui/material'
import type { TargetWeapon } from '../../domain/models/publicTypes'
import type {
  PlannerWhatIfCalculationResult,
  PlannerWhatIfOutcome,
} from '../../domain/planner'
import {
  presentPlannerWhatIfInvalidResolution,
  presentPlannerWhatIfNoResult,
} from '../../services/planner/presentProductionPlanWhatIf'

interface ProductionPlanWhatIfComparisonProps {
  result: PlannerWhatIfCalculationResult
  targetWeapons: TargetWeapon[]
}

function assertNever(value: never): never {
  throw new Error(`Unexpected what-if value: ${String(value)}`)
}

function WhatIfOutcome({ outcome }: { outcome: PlannerWhatIfOutcome }) {
  switch (outcome.status) {
    case 'found':
      return (
        <Stack spacing={0.5}>
          <Typography variant="body2">
            必要操作数: {outcome.distance.estimatedOperationCount}
          </Typography>
          <Typography variant="caption">
            巨戟進行量: +{outcome.distance.estimatedGogmaAdvance}
          </Typography>
          <Typography variant="caption">
            スキル進行量: +{outcome.distance.estimatedSkillAdvance}
          </Typography>
          <Typography variant="caption">
            通常進行量:{' '}
            {outcome.distance.estimatedNormalAdvance === null
              ? '対象外'
              : `+${outcome.distance.estimatedNormalAdvance}`}
          </Typography>
        </Stack>
      )
    case 'not_found_within_search_extent':
    case 'stopped_by_enumeration_bound':
    case 'stopped_by_candidate_trial_bound':
    case 'stopped_by_planner_rerun_bound':
    case 'blocked_by_selected_checkpoint':
      return (
        <Typography variant="body2">
          {presentPlannerWhatIfNoResult(outcome)}
        </Typography>
      )
    default:
      return assertNever(outcome)
  }
}

export function ProductionPlanWhatIfComparison({
  result,
  targetWeapons,
}: ProductionPlanWhatIfComparisonProps) {
  switch (result.status) {
    case 'completed':
      return (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={2}>
            <Typography component="h4" variant="subtitle1">
              比較結果
            </Typography>
            {result.comparison.alternatives.length === 0 && (
              <Typography variant="body2">比較対象となる別の目標はありません。</Typography>
            )}
            {result.comparison.alternatives.map((alternative) => {
              const target = targetWeapons.find(
                ({ id }) => id === alternative.targetWeaponId,
              )
              return (
                <Stack spacing={1} key={alternative.targetWeaponId}>
                  <Typography component="h5" variant="subtitle2">
                    {target?.name ?? alternative.targetWeaponId}
                  </Typography>
                  <Paper variant="outlined" sx={{ p: 1.5 }}>
                    <Stack spacing={1}>
                      <Typography variant="subtitle2">理想候補</Typography>
                      <WhatIfOutcome outcome={alternative.outcome} />
                    </Stack>
                  </Paper>
                  <Divider />
                </Stack>
              )
            })}
          </Stack>
        </Paper>
      )
    case 'planner_input_not_ready':
      return (
        <Alert severity="warning">
          <Typography variant="subtitle2">
            Planner入力を準備できませんでした
          </Typography>
          {result.issues.map((issue, index) => (
            <Typography
              variant="body2"
              key={`issue:${issue.path}:${issue.code}:${index}`}
            >
              {issue.message}
            </Typography>
          ))}
          {result.warnings.map((warning, index) => (
            <Typography
              variant="body2"
              key={`warning:${warning.kind}:${index}`}
            >
              {warning.message}
            </Typography>
          ))}
          {result.excludedBuildListEntries.map((entry) => (
            <Typography variant="body2" key={entry.entry.id}>
              {entry.reason}
            </Typography>
          ))}
        </Alert>
      )
    case 'invalid_fixed_resolution':
      return (
        <Alert severity="warning">
          <Typography variant="subtitle2">
            {presentPlannerWhatIfInvalidResolution(result.reason)}
          </Typography>
          <Typography variant="body2">{result.detail}</Typography>
        </Alert>
      )
    default:
      return assertNever(result)
  }
}
