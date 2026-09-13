import { useId, type ReactNode } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Stack,
  Typography,
} from '@mui/material'
import { DisclosureAccordion } from '../DisclosureAccordion'
import { RestorationBonusSlots } from '../RestorationBonusSlots'
import { StatusChip } from '../StatusChip'
import { CompromiseCheckpointList } from './CompromiseCheckpointList'
import { SearchDefinitionItem, SearchDefinitionList } from './SearchDefinitionList'
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
import { restorationBonusScopeLabels } from '../../presentation/labels'
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
   * Feedback about the last Build List addition, rendered next to the button
   * that caused it so its relation to this Candidate is unambiguous.
   */
  addFeedback?: ReactNode
  /**
   * Whether an equivalent Candidate is already in the Build List
   * (`docs/UI_FLOW.md` 9 「作成リスト追加状態」).
   *
   * Decided by the owner with the Build List Domain authority
   * (`isSameBuildListCandidate()`), never here and never by Candidate ID. An
   * `added` Candidate disables the add button as a convenience only: the
   * Build List Service keeps its own duplicate protection.
   */
  buildListStatus?: 'added' | 'not_added'
  /**
   * The compromise checkpoints the user has chosen to use.
   *
   * Checkpoints are a BuildListEntry input, never part of the Candidate, so the
   * owner of the selection passes it in rather than the card holding it
   * (`docs/DATA_MODEL.md` 9.4).
   */
  selectedCheckpointOpportunityIds?: readonly CompromiseCheckpointOpportunityId[]
  onToggleCheckpoint?: (
    group: CompromiseCheckpointGroup,
    opportunity: CompromiseCheckpointOpportunity,
    selected: boolean,
  ) => void
}

/** One figure of the operation summary. */
function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, px: 1.25, py: 1, minWidth: 0 }}>
      <Typography component="dt" variant="caption" color="text.secondary" sx={{ display: 'block' }}>
        {label}
      </Typography>
      <Typography component="dd" variant="subtitle1" className="tabular-nums" sx={{ m: 0 }}>
        {value}
      </Typography>
    </Box>
  )
}

export function CandidateCard({
  candidate,
  target,
  master,
  ownedWeapons = [],
  debugMode = false,
  onAdd,
  addDisabled = false,
  addFeedback,
  buildListStatus,
  selectedCheckpointOpportunityIds = [],
  onToggleCheckpoint,
}: CandidateCardProps) {
  const headingId = useId()
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
  const scope = candidate.restorationBonusScope

  return (
    <Card component="section" aria-labelledby={headingId} variant="outlined">
      <CardContent sx={{ p: { xs: 2, md: 2.5 }, '&:last-child': { pb: { xs: 2, md: 2.5 } } }}>
        <Stack spacing={2}>
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
            <Typography id={headingId} component="h3" variant="h3">
              理想候補
            </Typography>
            <StatusChip label={routeKindLabels[candidate.route.kind]} tone="info" />
            {buildListStatus === 'added' && <StatusChip label="作成リスト: 追加済み" tone="positive" />}
            {buildListStatus === 'not_added' && <StatusChip label="作成リスト: 未追加" tone="neutral" />}
          </Stack>

          {/* The finished weapon. The five slots keep their stored order and the
              scope says whether they are still the normal-tier slots inherited
              at conversion or Gogma-tier slots after an amendment
              (`docs/UI_FLOW.md` 9). */}
          <SearchDefinitionList>
            <SearchDefinitionItem label="完成時の復元ボーナス（5枠・判定は順不同）" span>
              <RestorationBonusSlots
                bonuses={candidate.finalBonuses}
                weaponTypeId={weaponTypeId}
                master={master}
                scope={scope}
                label="完成時の復元ボーナス5枠"
              />
            </SearchDefinitionItem>
            <SearchDefinitionItem label="ボーナス区分">
              <StatusChip
                label={restorationBonusScopeLabels[scope]}
                tone={scope === 'gogma_artian' ? 'info' : 'caution'}
              />
            </SearchDefinitionItem>
            <SearchDefinitionItem label="シリーズスキル / グループスキル">
              シリーズ: {seriesSkillLabel(candidate.seriesSkillId, master)} ／ グループ:{' '}
              {groupSkillLabel(candidate.groupSkillId, master)}
            </SearchDefinitionItem>
          </SearchDefinitionList>

          <Box
            component="dl"
            aria-label="操作量の概要"
            sx={{
              m: 0,
              display: 'grid',
              gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(4, minmax(0, 1fr))' },
              gap: 1,
            }}
          >
            <SummaryTile label="操作回数" value={`${candidate.estimatedOperationCount}回`} />
            <SummaryTile label="通常進行" value={candidate.estimatedNormalAdvance === null ? '—' : `${candidate.estimatedNormalAdvance}`} />
            <SummaryTile label="巨戟進行" value={`${candidate.estimatedGogmaAdvance}`} />
            <SummaryTile label="スキル進行" value={`${candidate.estimatedSkillAdvance}`} />
          </Box>

          {sourceName && (
            <Alert severity={sourceName.startsWith('参照元') ? 'warning' : 'info'}>
              起点武器: {sourceName}
            </Alert>
          )}

          {/* Long Routes reach well over a hundred amendments, so the detail
              content is mounted only while the panel is open. */}
          <DisclosureAccordion title="候補詳細・作成ルート" headingLevel="h4" unmountOnExit>
            <Stack spacing={2}>
              <Box>
                <Typography component="h5" variant="subtitle2" sx={{ mb: 1 }}>
                  理想との差分
                </Typography>
                <SearchDefinitionList>
                  <SearchDefinitionItem label="ボーナス一致">
                    {candidate.idealDifference.matchedBonusCount}/5
                  </SearchDefinitionItem>
                  <SearchDefinitionItem label="スキル一致">
                    シリーズ{candidate.idealDifference.seriesSkillMatches ? '一致' : '不一致'} ／ グループ
                    {candidate.idealDifference.groupSkillMatches ? '一致' : '不一致'}
                  </SearchDefinitionItem>
                  <SearchDefinitionItem label="不足">
                    {candidate.idealDifference.missingBonuses
                      .map((bonus) => bonusLabel(bonus, weaponTypeId, master, 'gogma_artian'))
                      .join('、') || 'なし'}
                  </SearchDefinitionItem>
                  <SearchDefinitionItem label="余剰">
                    {candidate.idealDifference.extraBonuses
                      .map((bonus) => bonusLabel(bonus, weaponTypeId, master, scope))
                      .join('、') || 'なし'}
                  </SearchDefinitionItem>
                </SearchDefinitionList>
              </Box>
              <Divider />
              <Box>
                <Typography component="h5" variant="subtitle2" sx={{ mb: 1 }}>
                  作成ルート（実行順）
                </Typography>
                {missingAmendmentTrace && (
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    この候補には各復元ボーナス操作後の予測結果が記録されていません。
                  </Typography>
                )}
                {missingSkillAmendmentTrace && (
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    この候補には各スキルリセット後の予測結果が記録されていません。
                  </Typography>
                )}
                <Box component="ol" sx={{ m: 0, pl: 3, display: 'grid', gap: 0.75 }}>
                  {candidate.route.operations.map((operation, index) => {
                    const amendment = amendmentByOperationIndex.get(index)
                    const skillPrediction = skillPredictionByOperationIndex.get(index)
                    return (
                      <Box component="li" key={`${operation.type}:${index}`} sx={{ minWidth: 0 }}>
                        <Stack spacing={0.5} sx={{ minWidth: 0 }}>
                          <Typography variant="body2">{operationLabel(operation)}</Typography>
                          {amendment && (
                            <Stack
                              direction="row"
                              spacing={0.5}
                              useFlexGap
                              sx={{ flexWrap: 'wrap', alignItems: 'center', minWidth: 0 }}
                            >
                              <Typography variant="caption" color="text.secondary">
                                予測結果:
                              </Typography>
                              <RestorationBonusSlots
                                bonuses={amendment.restorationBonuses}
                                weaponTypeId={weaponTypeId}
                                master={master}
                                scope={amendment.restorationBonusScope}
                                variant="outlined"
                                label={`${index + 1}番目の操作後の復元ボーナス5枠`}
                              />
                            </Stack>
                          )}
                          {skillPrediction && (
                            <Stack
                              direction="row"
                              spacing={0.5}
                              useFlexGap
                              sx={{ flexWrap: 'wrap', alignItems: 'center', minWidth: 0 }}
                            >
                              <Typography variant="caption" color="text.secondary">
                                予測結果:
                              </Typography>
                              <Typography variant="caption" sx={{ overflowWrap: 'anywhere' }}>
                                シリーズ: {seriesSkillLabel(skillPrediction.seriesSkillId, master)} ／ グループ:{' '}
                                {groupSkillLabel(skillPrediction.groupSkillId, master)}
                              </Typography>
                            </Stack>
                          )}
                        </Stack>
                      </Box>
                    )
                  })}
                </Box>
              </Box>
              <Box>
                <Typography component="h5" variant="subtitle2" sx={{ mb: 1 }}>
                  必要素材（アイテム）
                </Typography>
                {candidate.requiredMaterials.length === 0 ? (
                  <Typography variant="body2">なし</Typography>
                ) : (
                  <Box
                    role="list"
                    aria-label="必要素材（アイテム）"
                    sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}
                  >
                    {candidate.requiredMaterials.map((item) => (
                      <Box role="listitem" key={item.materialId} sx={{ maxWidth: '100%' }}>
                        <Chip
                          size="small"
                          variant="outlined"
                          label={`${materialLabel(item.materialId, master)} × ${item.quantity}`}
                          sx={{ maxWidth: '100%' }}
                        />
                      </Box>
                    ))}
                  </Box>
                )}
              </Box>
              {debugMode && (
                <Alert severity="info">
                  Candidate ID: {candidate.id}<br />searchRunId: {candidate.searchRunId}<br />
                  searchStateHash: {candidate.searchStateHash}<br />referencedOwnedWeaponsHash: {candidate.referencedOwnedWeaponsHash ?? 'null'}<br />
                  RouteKind: {candidate.route.kind}
                </Alert>
              )}
            </Stack>
          </DisclosureAccordion>

          {/* A checkpoint is an intermediate state of this very Route, so it
              is shown on the Candidate that owns it rather than as a separate
              result (`docs/UI_FLOW.md` 9). */}
          <CompromiseCheckpointList
            groups={candidate.checkpointGroups ?? []}
            weaponTypeId={weaponTypeId}
            master={master}
            selectedOpportunityIds={selectedCheckpointOpportunityIds}
            onToggle={onToggleCheckpoint}
            headingLevel="h4"
          />

          <Divider />
          <Stack spacing={1.5}>
            <Typography variant="body2" color="text.secondary" className="tabular-nums">
              理想品の完成: {candidate.estimatedOperationCount}手目（この候補の最終状態）
            </Typography>
            {onAdd && (
              <Button
                variant="contained"
                onClick={() => onAdd(candidate)}
                disabled={addDisabled || buildListStatus === 'added'}
                sx={{ minHeight: 44, alignSelf: { xs: 'stretch', sm: 'flex-start' } }}
              >
                ビルドリストへ追加
              </Button>
            )}
            {addFeedback}
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  )
}
