import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Stack,
  Typography,
} from '@mui/material'
import { RestorationBonusSlots } from '../RestorationBonusSlots'
import { CompromiseCheckpointList } from './CompromiseCheckpointList'
import type { MasterDataRoot } from '../../domain/master/masterTypes'
import type {
  BuildCandidate,
  CompromiseCheckpointGroup,
  CompromiseCheckpointOpportunity,
  CompromiseCheckpointOpportunityId,
  OwnedWeapon,
  SkillAmendmentResult,
  TargetWeapon,
} from '../../domain/models/publicTypes'
import {
  bonusLabel,
  groupSkillLabel,
  materialLabel,
  operationLabel,
  routeKindLabels,
  seriesSkillLabel,
} from './searchPresentation'

interface CandidateCardProps {
  candidate: BuildCandidate
  target: TargetWeapon | null
  master: MasterDataRoot
  ownedWeapons?: readonly OwnedWeapon[]
  debugMode?: boolean
  onAdd?: (candidate: BuildCandidate) => void
  addDisabled?: boolean
  /**
   * The compromise checkpoints the user has chosen to use.
   *
   * Checkpoints are a BuildListEntry input, never part of the Candidate, so the
   * owner of the selection passes it in rather than the card holding it
   * (`docs/DATA_MODEL.md` 10.2).
   */
  selectedCheckpointOpportunityIds?: readonly CompromiseCheckpointOpportunityId[]
  onToggleCheckpoint?: (
    group: CompromiseCheckpointGroup,
    opportunity: CompromiseCheckpointOpportunity,
    selected: boolean,
  ) => void
}

export function CandidateCard({
  candidate,
  target,
  master,
  ownedWeapons = [],
  debugMode = false,
  onAdd,
  addDisabled = false,
  selectedCheckpointOpportunityIds = [],
  onToggleCheckpoint,
}: CandidateCardProps) {
  const weaponTypeId = target?.weaponTypeId ?? candidate.route.operations.find(
    (operation) => 'weaponTypeId' in operation,
  )?.weaponTypeId ?? ''
  // Keyed by the operation's own index, so a run of identical Reset or Keep
  // operations can never be shifted by one against its predicted result.
  const amendmentByOperationIndex = new Map(
    (candidate.bonusAmendmentTrace ?? []).map((step) => [step.operationIndex, step]),
  )
  const missingAmendmentTrace =
    candidate.bonusAmendmentTrace === undefined &&
    candidate.route.operations.some(
      (operation) =>
        operation.type === 'reset_bonuses' || operation.type === 'keep_bonuses',
    )
  // Same binding rule for every Skill prediction: consecutive Reset Skills
  // operations are told apart by their own operation index, never by their
  // position among the Reset Skills alone. The conversion's initial Skill
  // assignment is a separate observational contract, but it describes the same
  // kind of result and renders identically, so both share one lookup keyed by
  // the operation they belong to. The two can never collide: one describes
  // `reset_skills`, the other `convert_normal_to_gogma`.
  const skillPredictionByOperationIndex = new Map<number, SkillAmendmentResult>([
    ...(candidate.skillAmendmentTrace ?? []).map(
      (step) => [step.operationIndex, step] as const,
    ),
    ...(candidate.conversionSkillTrace === undefined
      ? []
      : [[candidate.conversionSkillTrace.operationIndex, candidate.conversionSkillTrace] as const]),
  ])
  const missingSkillAmendmentTrace =
    candidate.skillAmendmentTrace === undefined &&
    candidate.route.operations.some((operation) => operation.type === 'reset_skills')
  const sourceName = candidate.route.sourceOwnedWeaponId === null
    ? null
    : ownedWeapons.find(({ id }) => id === candidate.route.sourceOwnedWeaponId)?.name ??
      '参照元の所持武器が見つかりません'

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={2}>
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
            <Chip color="success" label="理想候補" size="small" />
            <Chip label={routeKindLabels[candidate.route.kind]} size="small" variant="outlined" />
          </Stack>
          <RestorationBonusSlots
            bonuses={candidate.finalBonuses}
            weaponTypeId={weaponTypeId}
            master={master}
          />
          <Typography variant="body2">
            シリーズ: {seriesSkillLabel(candidate.seriesSkillId, master)} ／ グループ:{' '}
            {groupSkillLabel(candidate.groupSkillId, master)}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            操作 {candidate.estimatedOperationCount}回 ・ 通常進行 {candidate.estimatedNormalAdvance ?? '—'} ・
            巨戟進行 {candidate.estimatedGogmaAdvance} ・ スキル進行 {candidate.estimatedSkillAdvance}
          </Typography>
          {sourceName && <Alert severity={sourceName.startsWith('参照元') ? 'warning' : 'info'}>起点武器: {sourceName}</Alert>}
          {/* Long Routes reach well over a hundred amendments, so the detail
              content is mounted only while the panel is open. */}
          <Accordion disableGutters elevation={0} slotProps={{ transition: { unmountOnExit: true } }}>
            <AccordionSummary aria-controls={`candidate-${candidate.id}-detail`}>
              <Typography>候補詳細・作成ルート</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Stack spacing={2}>
                <Typography variant="subtitle2">理想との差分</Typography>
                <Typography variant="body2">
                  ボーナス一致 {candidate.idealDifference.matchedBonusCount}/5 ／ シリーズ
                  {candidate.idealDifference.seriesSkillMatches ? '一致' : '不一致'} ／ グループ
                  {candidate.idealDifference.groupSkillMatches ? '一致' : '不一致'}
                </Typography>
                <Typography variant="body2">
                  不足: {candidate.idealDifference.missingBonuses.map((bonus) => bonusLabel(bonus, weaponTypeId, master)).join('、') || 'なし'}
                </Typography>
                <Typography variant="body2">
                  余剰: {candidate.idealDifference.extraBonuses.map((bonus) => bonusLabel(bonus, weaponTypeId, master)).join('、') || 'なし'}
                </Typography>
                <Divider />
                {missingAmendmentTrace && (
                  <Typography variant="body2" color="text.secondary">
                    この候補には各復元ボーナス操作後の予測結果が記録されていません。
                  </Typography>
                )}
                {missingSkillAmendmentTrace && (
                  <Typography variant="body2" color="text.secondary">
                    この候補には各スキルリセット後の予測結果が記録されていません。
                  </Typography>
                )}
                <ol>
                  {candidate.route.operations.map((operation, index) => {
                    const amendment = amendmentByOperationIndex.get(index)
                    const skillPrediction = skillPredictionByOperationIndex.get(index)
                    return (
                      <li key={`${operation.type}:${index}`}>
                        <Stack
                          direction={{ xs: 'column', sm: 'row' }}
                          spacing={{ xs: 0.5, sm: 1 }}
                          sx={{ alignItems: { sm: 'baseline' }, mb: 0.5 }}
                        >
                          <Typography variant="body2">{operationLabel(operation)}</Typography>
                          {amendment && (
                            <Stack
                              direction="row"
                              spacing={0.5}
                              useFlexGap
                              sx={{ flexWrap: 'wrap', alignItems: 'center' }}
                            >
                              <Typography variant="caption" color="text.secondary">
                                予測結果:
                              </Typography>
                              <RestorationBonusSlots
                                bonuses={amendment.restorationBonuses}
                                weaponTypeId={weaponTypeId}
                                master={master}
                                variant="outlined"
                              />
                            </Stack>
                          )}
                          {skillPrediction && (
                            <Stack
                              direction="row"
                              spacing={0.5}
                              useFlexGap
                              sx={{ flexWrap: 'wrap', alignItems: 'center' }}
                            >
                              <Typography variant="caption" color="text.secondary">
                                予測結果:
                              </Typography>
                              <Typography variant="caption">
                                シリーズ: {seriesSkillLabel(skillPrediction.seriesSkillId, master)} ／ グループ:{' '}
                                {groupSkillLabel(skillPrediction.groupSkillId, master)}
                              </Typography>
                            </Stack>
                          )}
                        </Stack>
                      </li>
                    )
                  })}
                </ol>
                <Typography variant="body2">
                  必要素材（アイテム）: {candidate.requiredMaterials.map((item) => `${materialLabel(item.materialId, master)} × ${item.quantity}`).join('、') || 'なし'}
                </Typography>
                {debugMode && (
                  <Alert severity="info">
                    Candidate ID: {candidate.id}<br />searchRunId: {candidate.searchRunId}<br />
                    searchStateHash: {candidate.searchStateHash}<br />referencedOwnedWeaponsHash: {candidate.referencedOwnedWeaponsHash ?? 'null'}<br />
                    RouteKind: {candidate.route.kind}
                  </Alert>
                )}
              </Stack>
            </AccordionDetails>
          </Accordion>
          {/* A checkpoint is an intermediate state of this very Route, so it
              is shown on the Candidate that owns it rather than as a separate
              result (`docs/UI_FLOW.md` 6.4). */}
          <CompromiseCheckpointList
            groups={candidate.checkpointGroups ?? []}
            weaponTypeId={weaponTypeId}
            master={master}
            selectedOpportunityIds={selectedCheckpointOpportunityIds}
            onToggle={onToggleCheckpoint}
          />
          <Typography variant="body2" color="text.secondary">
            最終 {candidate.estimatedOperationCount}手目 ［理想］
          </Typography>
          {onAdd && <Button variant="contained" onClick={() => onAdd(candidate)} disabled={addDisabled}>ビルドリストへ追加</Button>}
        </Stack>
      </CardContent>
    </Card>
  )
}
