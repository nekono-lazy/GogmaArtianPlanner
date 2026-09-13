import { Alert, Box, Paper, Stack, Typography } from '@mui/material'
import type { TargetWeapon } from '../../domain/models/publicTypes'
import type {
  PlannerWhatIfCalculationResult,
  PlannerWhatIfOutcome,
} from '../../domain/planner'
import {
  presentPlannerWhatIfInvalidResolution,
  presentPlannerWhatIfNoResult,
} from '../../services/planner/presentProductionPlanWhatIf'
import {
  hasDeeperHeadingLevel,
  nextHeadingLevel,
  type SectionHeadingLevel,
} from '../headingLevel'

interface ProductionPlanWhatIfComparisonProps {
  result: PlannerWhatIfCalculationResult
  targetWeapons: TargetWeapon[]
  /**
   * Heading level of 「比較結果」, one below the participant heading the
   * caller embeds this under. Each Target result takes the next level; below
   * `h6` a Target name is labelled text rather than a false sibling heading.
   */
  headingLevel: SectionHeadingLevel
}

function assertNever(value: never): never {
  throw new Error(`Unexpected what-if value: ${String(value)}`)
}

/**
 * One Target's outcome. `estimatedOperationCount` is the main distance; the
 * three advances are relative amounts, never absolute Counter values, and a
 * `null` Normal advance is "not represented", never `0`.
 */
function WhatIfOutcome({ outcome }: { outcome: PlannerWhatIfOutcome }) {
  switch (outcome.status) {
    case 'found':
      return (
        <Stack spacing={0.5} className="tabular-nums">
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
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

/**
 * The transient what-if preview for one scenario.
 *
 * `alternatives` is shown in the Domain's stable order; no UI sort is added.
 * Each typed failure keeps its own presentation instead of being folded into
 * a generic "no result".
 */
export function ProductionPlanWhatIfComparison({
  result,
  targetWeapons,
  headingLevel,
}: ProductionPlanWhatIfComparisonProps) {
  const targetLevel = hasDeeperHeadingLevel(headingLevel) ? nextHeadingLevel(headingLevel) : null
  switch (result.status) {
    case 'completed':
      return (
        <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 }, minWidth: 0 }}>
          <Stack spacing={1.5}>
            <Typography component={headingLevel} variant="subtitle1">
              比較結果
            </Typography>
            {result.comparison.alternatives.length === 0 && (
              <Typography variant="body2">比較対象となる別の目標はありません。</Typography>
            )}
            {result.comparison.alternatives.length > 0 && (
              <Box
                component="ul"
                sx={{
                  m: 0,
                  p: 0,
                  display: 'grid',
                  gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))' },
                  gap: 1,
                }}
              >
                {result.comparison.alternatives.map((alternative) => {
                  const target = targetWeapons.find(
                    ({ id }) => id === alternative.targetWeaponId,
                  )
                  return (
                    <Stack
                      component="li"
                      spacing={1}
                      key={alternative.targetWeaponId}
                      sx={{
                        listStyle: 'none',
                        border: 1,
                        borderColor: 'divider',
                        borderRadius: 1,
                        p: 1.5,
                        minWidth: 0,
                      }}
                    >
                      <Typography component={targetLevel ?? 'div'} variant="subtitle2" sx={{ overflowWrap: 'anywhere' }}>
                        {target?.name ?? alternative.targetWeaponId}
                      </Typography>
                      <Stack spacing={0.5}>
                        <Typography variant="caption" color="text.secondary">理想候補</Typography>
                        <WhatIfOutcome outcome={alternative.outcome} />
                      </Stack>
                    </Stack>
                  )
                })}
              </Box>
            )}
          </Stack>
        </Paper>
      )
    case 'planner_input_not_ready':
      return (
        <Alert severity="warning">
          <Typography component="p" variant="subtitle2">
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
          <Typography component="p" variant="subtitle2">
            {presentPlannerWhatIfInvalidResolution(result.reason)}
          </Typography>
          <Typography variant="body2">{result.detail}</Typography>
        </Alert>
      )
    default:
      return assertNever(result)
  }
}
