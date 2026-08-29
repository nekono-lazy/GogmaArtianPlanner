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
import type { MasterDataRoot } from '../../domain/master/masterTypes'
import type { BuildCandidate, OwnedWeapon, TargetWeapon } from '../../domain/models/publicTypes'
import {
  bonusLabel,
  categoryLabels,
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
}

export function CandidateCard({
  candidate,
  target,
  master,
  ownedWeapons = [],
  debugMode = false,
  onAdd,
  addDisabled = false,
}: CandidateCardProps) {
  const weaponTypeId = target?.weaponTypeId ?? candidate.route.operations.find(
    (operation) => 'weaponTypeId' in operation,
  )?.weaponTypeId ?? ''
  const sourceName = candidate.route.sourceOwnedWeaponId === null
    ? null
    : ownedWeapons.find(({ id }) => id === candidate.route.sourceOwnedWeaponId)?.name ??
      '参照元の所持武器が見つかりません'

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={2}>
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
            <Chip
              color={candidate.category === 'ideal' ? 'success' : 'primary'}
              label={categoryLabels[candidate.category]}
              size="small"
            />
            {candidate.category === 'practical' && candidate.isSimilarToIdeal && (
              <Chip label="理想に近い" variant="outlined" size="small" />
            )}
            <Chip label={routeKindLabels[candidate.route.kind]} size="small" variant="outlined" />
          </Stack>
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
            {candidate.finalBonuses.map((bonus, index) => (
              <Chip
                key={`${bonus.bonusTypeId}:${bonus.bonusRankId}:${index}`}
                label={bonusLabel(bonus, weaponTypeId, master)}
                size="small"
              />
            ))}
          </Stack>
          <Typography variant="body2">
            シリーズ: {seriesSkillLabel(candidate.seriesSkillId, master)} ／ グループ:{' '}
            {groupSkillLabel(candidate.groupSkillId, master)}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            操作 {candidate.estimatedOperationCount}回 ・ Normal {candidate.estimatedNormalAdvance ?? '—'} ・
            Gogma {candidate.estimatedGogmaAdvance} ・ Skill {candidate.estimatedSkillAdvance}
          </Typography>
          {sourceName && <Alert severity={sourceName.startsWith('参照元') ? 'warning' : 'info'}>起点武器: {sourceName}</Alert>}
          <Accordion disableGutters elevation={0}>
            <AccordionSummary aria-controls={`candidate-${candidate.id}-detail`}>
              <Typography>候補詳細・Route</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Stack spacing={2}>
                <Typography variant="subtitle2">Idealとの差分</Typography>
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
                <Typography variant="body2">類似度: {candidate.similarityScore === null ? '—' : candidate.similarityScore.toFixed(2)}</Typography>
                <Divider />
                <ol>
                  {candidate.route.operations.map((operation, index) => (
                    <li key={`${operation.type}:${index}`}><Typography variant="body2">{operationLabel(operation)}</Typography></li>
                  ))}
                </ol>
                <Typography variant="body2">
                  必要素材: {candidate.requiredMaterials.map((item) => `${materialLabel(item.materialId, master)} × ${item.quantity}`).join('、') || 'なし'}
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
          {onAdd && <Button variant="contained" onClick={() => onAdd(candidate)} disabled={addDisabled}>Build Listへ追加</Button>}
        </Stack>
      </CardContent>
    </Card>
  )
}
