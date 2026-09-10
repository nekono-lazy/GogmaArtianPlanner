import { useMemo } from 'react'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Paper,
  Stack,
  Typography,
} from '@mui/material'
import type { MasterDataRoot } from '../../domain/master/masterTypes'
import type {
  ProductionPlan,
  TargetWeapon,
} from '../../domain/models/publicTypes'
import {
  createTargetWeaponLookup,
  groupPlanStepsByTargetWeapon,
  isLegacyProductionPlan,
  orderPlanSteps,
} from './productionPlanPresentation'
import { ProductionPlanSummary } from './ProductionPlanSummary'
import { ProductionPlanStepList } from './ProductionPlanStepList'

interface ProductionPlanContentProps {
  plan: ProductionPlan
  targetWeapons: readonly TargetWeapon[]
  master: MasterDataRoot
}

/**
 * The read-only confirmation view of an already persisted ProductionPlan.
 *
 * The exact persisted Plan is the only authority (UI_FLOW 11): no Active or
 * latest Plan fallback, no Worker result, no PlanStep rebuilt from a
 * BuildCandidate, and no RNG prediction. It renders independently of the
 * what-if / replan preparation lifecycle, so a stale Plan or a failed Worker
 * preparation still shows the stored contents.
 *
 * A Plan reaches a few hundred steps, so both detail sections are Accordions
 * whose contents are unmounted while collapsed, and the grouping is computed
 * once per Plan rather than per render.
 */
export function ProductionPlanContent({
  plan,
  targetWeapons,
  master,
}: ProductionPlanContentProps) {
  const orderedSteps = useMemo(() => orderPlanSteps(plan), [plan])
  const targetGroups = useMemo(() => groupPlanStepsByTargetWeapon(plan), [plan])
  const isLegacy = useMemo(() => isLegacyProductionPlan(plan), [plan])
  const lookup = useMemo(
    () => createTargetWeaponLookup(targetWeapons),
    [targetWeapons],
  )

  return (
    <Stack spacing={2}>
      <ProductionPlanSummary plan={plan} />
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={1}>
          <Typography component="h2" variant="h2">
            目標武器ごとの作成ルート
          </Typography>
          {isLegacy && (
            <Alert severity="info">
              この計画は共有Target進行情報の保存機能追加前に作成されたため、
              目標武器ごとのルートでは一部の共有操作が表示されない可能性があります。
              計画全体の実行順を確認してください。
            </Alert>
          )}
          {targetGroups.length === 0 ? (
            <Typography variant="body2">
              目標武器に紐づく手順はありません。
            </Typography>
          ) : (
            targetGroups.map((group) => {
              const target = lookup.byId(group.targetWeaponId)
              return (
                <Accordion
                  key={group.targetWeaponId}
                  disableGutters
                  elevation={0}
                  slotProps={{ transition: { unmountOnExit: true } }}
                >
                  <AccordionSummary
                    aria-controls={`plan-target-route-${group.targetWeaponId}`}
                  >
                    <Typography>
                      {target
                        ? target.name
                        : `削除済みまたは参照できない目標武器（${group.targetWeaponId}）`}
                      （{group.steps.length}ステップ）
                    </Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <ProductionPlanStepList
                      steps={group.steps}
                      lookup={lookup}
                      master={master}
                      showSharedBadge
                    />
                  </AccordionDetails>
                </Accordion>
              )
            })
          )}
        </Stack>
      </Paper>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={1}>
          <Typography component="h2" variant="h2">
            計画全体の実行順
          </Typography>
          <Accordion
            disableGutters
            elevation={0}
            slotProps={{ transition: { unmountOnExit: true } }}
          >
            <AccordionSummary aria-controls="plan-global-timeline">
              <Typography>全{orderedSteps.length}ステップを表示</Typography>
            </AccordionSummary>
            <AccordionDetails>
              {/* One physical Step appears exactly once here, even when it
                  advanced several Target Routes. */}
              <ProductionPlanStepList
                steps={orderedSteps}
                lookup={lookup}
                master={master}
              />
            </AccordionDetails>
          </Accordion>
        </Stack>
      </Paper>
    </Stack>
  )
}
