import { Box, Divider, Paper, Stack, Typography } from '@mui/material'
import type { MasterDataRoot } from '../../domain/master/masterTypes'
import type {
  PlanStep,
  TargetWeaponId,
} from '../../domain/models/publicTypes'
import {
  planStepOperationLabels,
  restorationBonusScopeFieldLabel,
  restorationBonusScopeLabels,
} from '../../presentation/labels'
import type { SectionHeadingLevel } from '../headingLevel'
import { RestorationBonusSlots } from '../RestorationBonusSlots'
import { StatusChip } from '../StatusChip'
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

/**
 * The persisted `ExpectedResult` of one Step.
 *
 * `expectedResult.restorationBonuses` is the only bonus authority, shown in
 * stored slot order. The persisted `restorationBonusScope` selects the
 * scope-specific label; a `null` scope is a legal record with no scope, so the
 * generic Master label is used instead of assuming a scope. `null` results
 * are ordinary states, not errors.
 */
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
    <Stack spacing={0.75}>
      <Typography component="p" variant="subtitle2">想定結果</Typography>
      {expected.restorationBonuses === null ? (
        <Typography variant="body2" color="text.secondary">
          復元ボーナス: 対象外
        </Typography>
      ) : (
        <>
          <RestorationBonusSlots
            bonuses={expected.restorationBonuses}
            weaponTypeId={weaponTypeId}
            master={master}
            scope={expected.restorationBonusScope}
            variant="outlined"
            label={`ステップ ${step.order} の予測復元ボーナス5枠`}
          />
          <Typography variant="caption" color="text.secondary">
            {restorationBonusScopeFieldLabel}:{' '}
            {expected.restorationBonusScope === null
              ? '記録なし'
              : restorationBonusScopeLabels[expected.restorationBonusScope]}
          </Typography>
        </>
      )}
      <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
        シリーズ: {seriesSkillLabel(expected.seriesSkillId, master)} ／ グループ:{' '}
        {groupSkillLabel(expected.groupSkillId, master)}
      </Typography>
    </Stack>
  )
}

/**
 * One persisted PlanStep, as a list item.
 *
 * Everything shown comes from the Step itself: its persisted `order`,
 * `title` / `instruction`, `operationType`, and `expectedResult`. The operation
 * is never regenerated from a Candidate route, no RNG prediction runs here,
 * and the order is the persisted `step.order`, never the DOM index.
 */
export function ProductionPlanStepCard({
  step,
  lookup,
  master,
  showSharedBadge = false,
  headingLevel = 'h4',
  debugMode = false,
}: {
  step: PlanStep
  lookup: TargetWeaponLookup
  master: MasterDataRoot
  showSharedBadge?: boolean
  headingLevel?: SectionHeadingLevel
  /** Debug Mode adds the raw milestone identifiers; the normal UI shows none. */
  debugMode?: boolean
}) {
  // `undefined` means the Plan predates the field: nothing is inferred for it
  // from a Candidate or Entry, and no section is shown. `[]` means this Step
  // reaches no selected checkpoint (`docs/PLANNER_SPEC.md` 7.5.4).
  const milestones = step.checkpointMilestones ?? []
  // The primary Target decides which weapon-type bonus names apply; a shared
  // Step keeps that single persisted resolution rather than inventing one.
  const weaponTypeId =
    step.targetWeaponId === null
      ? ''
      : lookup.byId(step.targetWeaponId)?.weaponTypeId ?? ''
  const shared = showSharedBadge && isSharedPlanStep(step)
  return (
    <Paper
      component="li"
      variant="outlined"
      sx={{ p: { xs: 1.5, md: 2 }, minWidth: 0, listStyle: 'none' }}
    >
      <Stack spacing={1}>
        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          sx={{ flexWrap: 'wrap', alignItems: 'center' }}
        >
          <Typography component={headingLevel} variant="subtitle1" className="tabular-nums">
            ステップ {step.order}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {planStepOperationLabels[step.operationType]}
          </Typography>
          {step.expectedResult?.shouldSecure === true && (
            <StatusChip label="確保予定" tone="positive" />
          )}
          {shared && <StatusChip label="共有操作" tone="info" />}
        </Stack>
        <Typography sx={{ fontWeight: 500, overflowWrap: 'anywhere' }}>{step.title}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
          {step.instruction}
        </Typography>
        <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
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
        {shared && (
          <Typography variant="caption" color="text.secondary">
            この操作は他の目標武器と共有され、計画全体では1回だけ実行します。
          </Typography>
        )}
        {milestones.length > 0 && (
          // Persisted milestone metadata on the physical Step that reaches the
          // selected checkpoint: every stored entry is listed in stored order,
          // a shared Step included, and nothing else changes - no extra Step,
          // no stop, no reservation.
          <Box>
            <Typography component="p" variant="subtitle2">チェックポイント到達</Typography>
            <Box
              component="ul"
              aria-label={`ステップ ${step.order} のチェックポイント到達`}
              sx={{ m: 0, mt: 0.25, pl: 2.5, display: 'grid', gap: 0.25 }}
            >
              {milestones.map((milestone, index) => (
                <Typography
                  component="li"
                  variant="body2"
                  key={`${milestone.buildListEntryId}:${milestone.checkpointOpportunityId}:${index}`}
                  className="tabular-nums"
                  sx={{ overflowWrap: 'anywhere' }}
                >
                  <TargetWeaponReference targetWeaponId={milestone.targetWeaponId} lookup={lookup} />
                  （理想まで残り{milestone.remainingOperationCount}操作）
                  {debugMode && (
                    <Typography
                      component="span"
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: 'block', overflowWrap: 'anywhere' }}
                    >
                      BuildListEntry ID: {milestone.buildListEntryId} ／ group: {milestone.checkpointGroupId} ／ opportunity: {milestone.checkpointOpportunityId}
                    </Typography>
                  )}
                </Typography>
              ))}
            </Box>
          </Box>
        )}
        <Divider />
        <ExpectedResultView step={step} weaponTypeId={weaponTypeId} master={master} />
      </Stack>
    </Paper>
  )
}

/**
 * An ordered list of persisted Steps, in the order the caller supplies (the
 * caller has already applied `orderPlanSteps()`; nothing is re-sorted here).
 */
export function ProductionPlanStepList({
  steps,
  lookup,
  master,
  showSharedBadge = false,
  headingLevel = 'h4',
  label,
  debugMode = false,
}: {
  steps: readonly PlanStep[]
  lookup: TargetWeaponLookup
  master: MasterDataRoot
  showSharedBadge?: boolean
  headingLevel?: SectionHeadingLevel
  /** Accessible name of the list. */
  label: string
  debugMode?: boolean
}) {
  return (
    <Stack component="ol" spacing={1} aria-label={label} sx={{ m: 0, p: 0, minWidth: 0 }}>
      {steps.map((step) => (
        <ProductionPlanStepCard
          key={step.id}
          step={step}
          lookup={lookup}
          master={master}
          showSharedBadge={showSharedBadge}
          headingLevel={headingLevel}
          debugMode={debugMode}
        />
      ))}
    </Stack>
  )
}
