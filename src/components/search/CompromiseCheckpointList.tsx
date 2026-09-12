import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Checkbox,
  Chip,
  FormControlLabel,
  Paper,
  Stack,
  Typography,
} from '@mui/material'
import { RestorationBonusSlots } from '../RestorationBonusSlots'
import type { MasterDataRoot } from '../../domain/master/masterTypes'
import type {
  CompromiseCheckpointGroup,
  CompromiseCheckpointOpportunity,
  CompromiseCheckpointOpportunityId,
} from '../../domain/models/publicTypes'
import { compromiseCheckpointBadgeLabel } from '../../presentation/labels'
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
      control={
        <Checkbox
          checked={selected}
          onChange={(event) => onToggle(group, opportunity, event.target.checked)}
          slotProps={{ input: { 'aria-label': label } }}
        />
      }
      label={label}
    />
  )
}

function CheckpointGroupCard({
  group,
  weaponTypeId,
  master,
  selectedOpportunityIds,
  onToggle,
}: CompromiseCheckpointListProps & { group: CompromiseCheckpointGroup }) {
  const selected = new Set<string>(selectedOpportunityIds)
  // Ascending by Route position, so the first entry is the earliest arrival.
  const [primary, ...later] = group.opportunities
  return (
    <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 } }}>
      <Stack spacing={1}>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
          <Chip
            size="small"
            label={compromiseCheckpointBadgeLabel(group.conditionMatch)}
            color={group.conditionMatch.bonus === 'alternative' ? 'secondary' : 'primary'}
          />
        </Stack>
        <RestorationBonusSlots
          bonuses={group.restorationBonuses}
          weaponTypeId={weaponTypeId}
          master={master}
          variant="outlined"
        />
        <Typography variant="body2">
          シリーズ: {seriesSkillLabel(group.seriesSkillId, master)} ／ グループ:{' '}
          {groupSkillLabel(group.groupSkillId, master)}
        </Typography>
        <CheckpointOpportunityRow
          group={group}
          opportunity={primary}
          selected={selected.has(primary.id)}
          onToggle={onToggle}
        />
        {later.length > 0 && (
          // Later arrivals at the very same compromise product are kept, never
          // deduplicated away: a Counter conflict can make a later one the only
          // usable arrival (`docs/SEARCH_SPEC.md` 5.8.3).
          <Accordion disableGutters elevation={0}>
            <AccordionSummary>
              <Typography variant="body2">その他の到達点（{later.length}）</Typography>
            </AccordionSummary>
            <AccordionDetails>
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
            </AccordionDetails>
          </Accordion>
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
 * selectable behind them (`docs/UI_FLOW.md` 6.4).
 */
export function CompromiseCheckpointList(props: CompromiseCheckpointListProps) {
  const { groups } = props
  if (groups.length === 0) {
    return (
      <Alert severity="info">
        この理想ルートの途中に、妥協条件を満たす状態はありません。
      </Alert>
    )
  }
  const primary = groups.filter(({ isDisplaySecondary }) => !isDisplaySecondary)
  const secondary = groups.filter(({ isDisplaySecondary }) => isDisplaySecondary)
  return (
    <Stack spacing={1}>
      <Typography variant="subtitle2">途中で利用可能</Typography>
      {primary.map((group) => (
        <CheckpointGroupCard key={group.id} {...props} group={group} />
      ))}
      {secondary.length > 0 && (
        <Accordion disableGutters elevation={0}>
          <AccordionSummary>
            <Typography variant="body2">その他の候補（{secondary.length}）</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Stack spacing={1}>
              {secondary.map((group) => (
                <CheckpointGroupCard key={group.id} {...props} group={group} />
              ))}
            </Stack>
          </AccordionDetails>
        </Accordion>
      )}
    </Stack>
  )
}
