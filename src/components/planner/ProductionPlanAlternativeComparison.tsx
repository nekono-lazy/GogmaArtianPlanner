import { Alert, Box, Paper, Stack, Typography } from '@mui/material'
import type { TargetWeapon, TargetWeaponId } from '../../domain/models/publicTypes'
import type {
  PlannerAlternativeConflictSummary,
  PlannerAlternativeOutcome,
  PlannerAlternativeScenarioOutcome,
  PlannerAlternativeWhatIfCalculationResult,
} from '../../domain/planner'
import { conflictKindLabels } from '../../presentation/labels'
import {
  plannerAlternativeInvalidPriorFixedEntryMessage,
  presentPlannerAlternativeAdoption,
  presentPlannerAlternativeInvalidResolution,
  presentPlannerAlternativeNoResult,
} from '../../services/planner/presentProductionPlanAlternative'
import {
  hasDeeperHeadingLevel,
  nextHeadingLevel,
  type SectionHeadingLevel,
} from '../headingLevel'

interface ProductionPlanAlternativeComparisonProps {
  /** A what-if result, or an actual repair's comparison wrapped as `completed`. */
  result: PlannerAlternativeWhatIfCalculationResult
  targetWeapons: readonly TargetWeapon[]
  /** Heading level of 「比較結果」; each Target and the scenario take the next level. */
  headingLevel: SectionHeadingLevel
  title?: string
}

function assertNever(value: never): never {
  throw new Error(`Unexpected Planner Alternative value: ${String(value)}`)
}

function formatCount(value: number): string {
  return value.toLocaleString('ja-JP')
}

function targetName(targetWeapons: readonly TargetWeapon[], id: TargetWeaponId): string {
  return targetWeapons.find((target) => target.id === id)?.name ?? id
}

/**
 * One Target's outcome. `estimatedOperationCount` is the Route's own operation
 * count; the three advances are relative amounts, never absolute Counter
 * values, and a `null` Normal advance is "not represented", never `0`.
 */
function AlternativeOutcome({ outcome }: { outcome: PlannerAlternativeOutcome }) {
  switch (outcome.status) {
    case 'found':
      return (
        <Stack spacing={0.5} className="tabular-nums">
          <Typography variant="body2">代替ルートあり</Typography>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            必要操作数: {formatCount(outcome.distance.estimatedOperationCount)}
          </Typography>
          <Typography variant="caption">
            復元ボーナス進行量: +{outcome.distance.estimatedGogmaAdvance}
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
          <Typography variant="body2">{presentPlannerAlternativeAdoption(outcome.adoptedInScenario)}</Typography>
        </Stack>
      )
    case 'not_found_within_search_extent':
    case 'stopped_by_search_extent_bound':
    case 'stopped_by_candidate_trial_bound':
    case 'stopped_by_planner_rerun_bound':
    case 'blocked_by_selected_checkpoint':
      return <Typography variant="body2">{presentPlannerAlternativeNoResult(outcome)}</Typography>
    default:
      return assertNever(outcome)
  }
}

function ConflictSummaryList({
  label,
  conflicts,
  targetWeapons,
}: {
  label: string
  conflicts: readonly PlannerAlternativeConflictSummary[]
  targetWeapons: readonly TargetWeapon[]
}) {
  return (
    <Stack spacing={0.5}>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {label}: {conflicts.length === 0 ? 'なし' : `${formatCount(conflicts.length)}件`}
      </Typography>
      {conflicts.length > 0 && (
        <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
          {conflicts.map((conflict, index) => (
            <Typography
              component="li"
              variant="body2"
              key={`${conflict.kind}:${conflict.participantTargetWeaponIds.join('/')}:${index}`}
              sx={{ overflowWrap: 'anywhere' }}
            >
              {conflictKindLabels[conflict.kind]}（
              {conflict.participantTargetWeaponIds.map((id) => targetName(targetWeapons, id)).join('・')}）
              {conflict.resolved ? ' 選択済み' : ' 未解決'}
            </Typography>
          ))}
        </Box>
      )}
    </Stack>
  )
}

/**
 * The whole 1-step scenario (`docs/PLANNER_SPEC.md` 9.2.19.13). The operation
 * count is shown only for an evaluated scenario and always beside what it
 * leaves open; a bound or a missing Plan is never shown as a count.
 */
function ScenarioOutcome({
  scenario,
  targetWeapons,
}: {
  scenario: PlannerAlternativeScenarioOutcome
  targetWeapons: readonly TargetWeapon[]
}) {
  switch (scenario.status) {
    case 'evaluated':
      return (
        <Stack spacing={1} className="tabular-nums">
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            この候補を優先した場合の計画手数（暫定）: {formatCount(scenario.scenarioOperationCount)}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            未解決の競合や、この計画で作成しない目標武器が残る場合、この手数は完成までの確定値ではありません。
          </Typography>
          <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
            この計画で作成しない目標武器:{' '}
            {scenario.unplannedTargetWeaponIds.length === 0
              ? 'なし'
              : scenario.unplannedTargetWeaponIds.map((id) => targetName(targetWeapons, id)).join('・')}
          </Typography>
          <ConflictSummaryList
            label="新しく発生する競合"
            conflicts={scenario.introducedConflicts}
            targetWeapons={targetWeapons}
          />
          <ConflictSummaryList
            label="残る競合"
            conflicts={scenario.remainingConflicts}
            targetWeapons={targetWeapons}
          />
        </Stack>
      )
    case 'no_plan':
      return <Typography variant="body2">この条件では生産計画を作成できません。計画手数はありません。</Typography>
    case 'stopped_by_plan_step_bound':
      return (
        <Typography variant="body2">
          最大計画ステップ数 {formatCount(scenario.maxPlanSteps)} に到達したため、計画全体の手数は未確定です。
        </Typography>
      )
    case 'stopped_by_planner_rerun_bound':
      return <Typography variant="body2">Planner再計算上限のため、計画全体の手数は未確認です。</Typography>
    default:
      return assertNever(scenario)
  }
}

/**
 * The Planner Alternative comparison of one participant (`docs/UI_FLOW.md`
 * 11.3 / 11.4.1): each non-fixed Target in the Domain's stable order, then the
 * whole scenario. The minimal Phase 5-B presentation; Issue #122 redesigns it.
 */
export function ProductionPlanAlternativeComparison({
  result,
  targetWeapons,
  headingLevel,
  title = '比較結果',
}: ProductionPlanAlternativeComparisonProps) {
  const childLevel = hasDeeperHeadingLevel(headingLevel) ? nextHeadingLevel(headingLevel) : null
  switch (result.status) {
    case 'completed':
      return (
        <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 }, minWidth: 0 }}>
          <Stack spacing={1.5}>
            <Typography component={headingLevel} variant="subtitle1">
              {title}
            </Typography>
            {result.comparison.alternatives.length === 0 && (
              <Typography variant="body2">代替ルートを探す別の目標武器はありません。</Typography>
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
                {result.comparison.alternatives.map((alternative) => (
                  <Stack
                    component="li"
                    spacing={1}
                    key={alternative.alternativeTargetWeaponId}
                    sx={{
                      listStyle: 'none',
                      border: 1,
                      borderColor: 'divider',
                      borderRadius: 1,
                      p: 1.5,
                      minWidth: 0,
                    }}
                  >
                    <Typography component={childLevel ?? 'div'} variant="subtitle2" sx={{ overflowWrap: 'anywhere' }}>
                      {targetName(targetWeapons, alternative.alternativeTargetWeaponId)}
                    </Typography>
                    <AlternativeOutcome outcome={alternative.outcome} />
                    {alternative.excludedByRepairLineageCount > 0 && (
                      <Typography variant="caption" color="text.secondary">
                        以前の競合解決で外したルートを除外: {formatCount(alternative.excludedByRepairLineageCount)}件
                      </Typography>
                    )}
                  </Stack>
                ))}
              </Box>
            )}
            <Stack spacing={1} sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
              <Typography component={childLevel ?? 'div'} variant="subtitle2">
                計画全体
              </Typography>
              <ScenarioOutcome scenario={result.comparison.scenario} targetWeapons={targetWeapons} />
            </Stack>
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
            <Typography variant="body2" key={`issue:${issue.path}:${issue.code}:${index}`}>
              {issue.message}
            </Typography>
          ))}
          {result.warnings.map((warning, index) => (
            <Typography variant="body2" key={`warning:${warning.kind}:${index}`}>
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
            {presentPlannerAlternativeInvalidResolution(result.reason)}
          </Typography>
          <Typography variant="body2">{result.detail}</Typography>
        </Alert>
      )
    case 'invalid_prior_fixed_entry':
      return (
        <Alert severity="warning">
          <Typography component="p" variant="subtitle2">
            {plannerAlternativeInvalidPriorFixedEntryMessage}
          </Typography>
        </Alert>
      )
    default:
      return assertNever(result)
  }
}
