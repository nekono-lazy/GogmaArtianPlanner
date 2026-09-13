import { useId } from 'react'
import { Alert, Box, Checkbox, FormControlLabel, Paper, Stack, Typography } from '@mui/material'
import { DisclosureAccordion, type DisclosureHeadingLevel } from '../DisclosureAccordion'
import { RestorationBonusSlots } from '../RestorationBonusSlots'
import { StatusChip } from '../StatusChip'
import { SearchDefinitionItem, SearchDefinitionList } from './SearchDefinitionList'
import type { MasterDataRoot } from '../../domain/master/masterTypes'
import type {
  CompromiseCheckpointGroup,
  CompromiseCheckpointOpportunity,
  CompromiseCheckpointOpportunityId,
} from '../../domain/models/publicTypes'
import {
  compromiseBonusMatchLabels,
  compromiseCheckpointBadgeLabel,
  compromiseSkillMatchLabels,
  restorationBonusScopeLabels,
} from '../../presentation/labels'
import { groupSkillLabel, seriesSkillLabel } from './searchPresentation'

export interface CompromiseCheckpointListProps {
  groups: readonly CompromiseCheckpointGroup[]
  weaponTypeId: string
  master: MasterDataRoot
  selectedOpportunityIds: readonly CompromiseCheckpointOpportunityId[]
  /**
   * Omitted where the selection is read-only. Supplying it makes every
   * opportunity selectable, including the ones behind the two secondary
   * disclosures: nothing shown here is ever unavailable, only tidied away.
   */
  onToggle?: (
    group: CompromiseCheckpointGroup,
    opportunity: CompromiseCheckpointOpportunity,
    selected: boolean,
  ) => void
  /**
   * Heading level of the section heading. Group headings and the two
   * disclosures take the following levels, so the page outline stays
   * sequential wherever the list is embedded.
   */
  headingLevel?: DisclosureHeadingLevel
}

function nextHeadingLevel(level: DisclosureHeadingLevel): DisclosureHeadingLevel {
  switch (level) {
    case 'h2':
      return 'h3'
    case 'h3':
      return 'h4'
    case 'h4':
      return 'h5'
    default:
      return 'h6'
  }
}

function opportunityLabel(opportunity: CompromiseCheckpointOpportunity): string {
  return `${opportunity.operationCount}手目（理想まで残り${opportunity.remainingOperationCount}操作）`
}

function CheckpointOpportunityRow({
  group,
  opportunity,
  selected,
  onToggle,
}: {
  group: CompromiseCheckpointGroup
  opportunity: CompromiseCheckpointOpportunity
  selected: boolean
  onToggle?: CompromiseCheckpointListProps['onToggle']
}) {
  const label = opportunityLabel(opportunity)
  if (!onToggle) {
    return (
      <Typography variant="body2">
        {selected ? '利用する: ' : ''}
        {label}
      </Typography>
    )
  }
  return (
    <FormControlLabel
      sx={{ m: 0, minHeight: 44, alignItems: 'center', maxWidth: '100%' }}
      control={
        <Checkbox
          checked={selected}
          onChange={(event) => onToggle(group, opportunity, event.target.checked)}
          slotProps={{ input: { 'aria-label': label } }}
        />
      }
      label={
        <Typography component="span" variant="body2" className="tabular-nums">
          {label}
        </Typography>
      }
    />
  )
}

function CheckpointGroupCard({
  group,
  index,
  weaponTypeId,
  master,
  selectedOpportunityIds,
  onToggle,
  headingLevel,
}: Omit<CompromiseCheckpointListProps, 'groups' | 'headingLevel'> & {
  group: CompromiseCheckpointGroup
  /** 1-based display number; presentation only, never an identity. */
  index: number
  headingLevel: DisclosureHeadingLevel
}) {
  const headingId = useId()
  const selected = new Set<string>(selectedOpportunityIds)
  // Ascending by Route position, so the first entry is the earliest arrival.
  const [primary, ...later] = group.opportunities
  const badge = compromiseCheckpointBadgeLabel(group.conditionMatch)
  return (
    <Paper
      component="section"
      aria-labelledby={headingId}
      variant="outlined"
      sx={{ p: { xs: 1.5, sm: 2 }, minWidth: 0 }}
    >
      <Stack spacing={1.25}>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <Typography id={headingId} component={headingLevel} variant="subtitle2">
            チェックポイント {index}
          </Typography>
          <StatusChip
            label={`判定: ${badge}`}
            tone={group.conditionMatch.bonus === 'alternative' ? 'caution' : 'info'}
          />
        </Stack>
        <SearchDefinitionList>
          <SearchDefinitionItem label="復元ボーナス（5枠・判定は順不同）" span>
            <RestorationBonusSlots
              bonuses={group.restorationBonuses}
              weaponTypeId={weaponTypeId}
              master={master}
              scope={group.restorationBonusScope}
              variant="outlined"
              label={`チェックポイント ${index} の復元ボーナス5枠`}
            />
          </SearchDefinitionItem>
          <SearchDefinitionItem label="ボーナス区分">
            {restorationBonusScopeLabels[group.restorationBonusScope]}
          </SearchDefinitionItem>
          <SearchDefinitionItem label="判定理由">
            ボーナス判定: {compromiseBonusMatchLabels[group.conditionMatch.bonus]} ／ スキル判定:{' '}
            {compromiseSkillMatchLabels[group.conditionMatch.skill]}
          </SearchDefinitionItem>
          <SearchDefinitionItem label="シリーズスキル">
            {seriesSkillLabel(group.seriesSkillId, master)}
          </SearchDefinitionItem>
          <SearchDefinitionItem label="グループスキル">
            {groupSkillLabel(group.groupSkillId, master)}
          </SearchDefinitionItem>
        </SearchDefinitionList>
        <Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            最短の到達点
          </Typography>
          <CheckpointOpportunityRow
            group={group}
            opportunity={primary}
            selected={selected.has(primary.id)}
            onToggle={onToggle}
          />
        </Box>
        {later.length > 0 && (
          // Later arrivals at the very same compromise product are kept, never
          // deduplicated away: a Counter conflict can make a later one the only
          // usable arrival (`docs/SEARCH_SPEC.md` 5.8.3).
          <DisclosureAccordion
            title={`その他の到達点（${later.length}）`}
            headingLevel={nextHeadingLevel(headingLevel)}
          >
            <Stack>
              {later.map((opportunity) => (
                <CheckpointOpportunityRow
                  key={opportunity.id}
                  group={group}
                  opportunity={opportunity}
                  selected={selected.has(opportunity.id)}
                  onToggle={onToggle}
                />
              ))}
            </Stack>
          </DisclosureAccordion>
        )}
      </Stack>
    </Paper>
  )
}

/**
 * The compromise checkpoints of one canonical Ideal Route.
 *
 * Nothing here is a separate Candidate: every entry is an intermediate state of
 * the same physical Route, so selecting one only asks the Planner to really
 * stop by that state on the way to the Ideal result.
 *
 * The two disclosures are display organisation only. A later arrival at the
 * same compromise product and a conservatively worse group both stay fully
 * selectable behind them (`docs/UI_FLOW.md` 9).
 */
export function CompromiseCheckpointList(props: CompromiseCheckpointListProps) {
  const { groups, onToggle, headingLevel = 'h4' } = props
  const sectionHeadingId = useId()
  const primary = groups.filter(({ isDisplaySecondary }) => !isDisplaySecondary)
  const secondary = groups.filter(({ isDisplaySecondary }) => isDisplaySecondary)
  const groupLevel = nextHeadingLevel(headingLevel)
  const secondaryGroupLevel = nextHeadingLevel(groupLevel)
  return (
    <Box component="section" aria-labelledby={sectionHeadingId}>
      <Stack spacing={1}>
        <Typography id={sectionHeadingId} component={headingLevel} variant="subtitle1">
          途中で利用可能な妥協チェックポイント
        </Typography>
        {groups.length === 0 ? (
          <Alert severity="info">この理想ルートの途中に、妥協条件を満たす状態はありません。</Alert>
        ) : (
          <>
            {onToggle && (
              <Typography variant="body2" color="text.secondary">
                選択すると、この到達点を作成途中で必ず経由する条件として作成リストへ登録します。何も選ばなければ理想品まで進みます。性能ごとに選べる到達点は1つまでです。
              </Typography>
            )}
            {primary.map((group, position) => (
              <CheckpointGroupCard
                key={group.id}
                {...props}
                group={group}
                index={position + 1}
                headingLevel={groupLevel}
              />
            ))}
            {secondary.length > 0 && (
              <DisclosureAccordion
                title={`その他の候補（${secondary.length}）`}
                headingLevel={groupLevel}
              >
                <Stack spacing={1}>
                  <Typography variant="body2" color="text.secondary">
                    同じ区分・スキルで、より良い復元ボーナスへ同じ手数以内に到達できるチェックポイントがあるため折りたたんでいます。選択は可能です。
                  </Typography>
                  {secondary.map((group, position) => (
                    <CheckpointGroupCard
                      key={group.id}
                      {...props}
                      group={group}
                      index={primary.length + position + 1}
                      headingLevel={secondaryGroupLevel}
                    />
                  ))}
                </Stack>
              </DisclosureAccordion>
            )}
          </>
        )}
      </Stack>
    </Box>
  )
}
