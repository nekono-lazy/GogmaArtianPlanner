import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  CHECKPOINT_IDEAL_SKILL,
  CHECKPOINT_PRACTICAL_SKILL,
  checkpointConversionCandidate,
  checkpointIdealBonuses,
  checkpointMixedCandidate,
  checkpointPracticalBonuses,
  checkpointPracticalBonusesReordered,
  checkpointStrongerPracticalBonuses,
  intermediateOpportunityAt,
} from '../../test/fixtures/checkpointRoute'
import { createValidMasterDataFixture } from '../../test/fixtures/masterData'
import { defaultIntermediateStateSelection } from '../../domain/buildList'
import type { IntermediateStateSelection } from '../../domain/models/publicTypes'
import { IntermediateStateSelector } from './IntermediateStateSelector'
import { intermediateOpportunityLabel } from './searchPresentation'

const BONUS_ONE = 'この途中状態を採用する: 復元ボーナス操作1回目（再抽選）の直後'
const BONUS_TWO = 'この途中状態を採用する: 復元ボーナス操作2回目（再抽選）の直後'
const SKILL_ONE = 'この途中状態を採用する: スキルリセット1回目の直後'

function renderSelector(
  candidate: ReturnType<typeof checkpointMixedCandidate>['candidate'],
  selection: IntermediateStateSelection = defaultIntermediateStateSelection(),
  editable = true,
) {
  const onChange = vi.fn()
  render(
    <IntermediateStateSelector
      candidate={candidate}
      weaponTypeId="weapon.fixture.a"
      master={createValidMasterDataFixture()}
      selection={selection}
      onChange={editable ? onChange : undefined}
    />,
  )
  return onChange
}

describe('IntermediateStateSelector', () => {
  it('lists the Skill lane and the Bonus lane separately, each ending with the Ideal goal', () => {
    const { candidate } = checkpointMixedCandidate({
      bonusResults: [checkpointPracticalBonuses(), checkpointIdealBonuses()],
      skillResults: [CHECKPOINT_PRACTICAL_SKILL, CHECKPOINT_IDEAL_SKILL],
    })
    renderSelector(candidate)

    const skillSection = screen.getByRole('heading', { name: 'スキル候補' }).closest('section')!
    const bonusSection = screen.getByRole('heading', { name: '復元ボーナス候補' }).closest('section')!
    expect(within(skillSection).getByRole('heading', { name: 'スキル候補 1' })).toBeInTheDocument()
    expect(within(skillSection).getByRole('heading', { name: 'スキル候補（理想）' })).toBeInTheDocument()
    expect(within(bonusSection).getByRole('heading', { name: '復元ボーナス候補 1' })).toBeInTheDocument()
    expect(within(bonusSection).getByRole('heading', { name: '復元ボーナス候補（理想）' })).toBeInTheDocument()
    // The Ideal end is a goal, never a checkbox; no Skill × Bonus combination
    // is offered anywhere.
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
    expect(screen.getAllByText('最終目標')).toHaveLength(2)
    expect(screen.queryByText(/×/)).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '生産計画に任せる' })).toBeChecked()
  })

  it('selects at most one state per lane and reports the whole selection', async () => {
    const user = userEvent.setup()
    const { candidate } = checkpointMixedCandidate({
      bonusResults: [checkpointPracticalBonuses(), checkpointPracticalBonusesReordered(), checkpointIdealBonuses()],
      skillResults: [CHECKPOINT_PRACTICAL_SKILL, CHECKPOINT_IDEAL_SKILL],
    })
    const onChange = renderSelector(candidate)
    const skill = intermediateOpportunityAt(candidate, 'skill', 1).opportunity
    const bonusLater = intermediateOpportunityAt(candidate, 'bonus', 2).opportunity

    await user.click(screen.getByRole('checkbox', { name: SKILL_ONE }))
    expect(onChange).toHaveBeenLastCalledWith({
      ...defaultIntermediateStateSelection(),
      skillOpportunityId: skill.id,
    })
    await user.click(screen.getByRole('button', { name: 'その他の到達点（1）' }))
    await user.click(await screen.findByRole('checkbox', { name: BONUS_TWO }))
    expect(onChange).toHaveBeenLastCalledWith({
      ...defaultIntermediateStateSelection(),
      bonusOpportunityId: bonusLater.id,
    })
  })

  it('replaces a selected Bonus state with another arrival of the same lane', async () => {
    const user = userEvent.setup()
    const { candidate } = checkpointMixedCandidate({
      bonusResults: [checkpointPracticalBonuses(), checkpointPracticalBonusesReordered(), checkpointIdealBonuses()],
      skillResults: [],
    })
    const first = intermediateOpportunityAt(candidate, 'bonus', 1).opportunity
    const onChange = renderSelector(candidate, { ...defaultIntermediateStateSelection(), bonusOpportunityId: first.id })

    expect(screen.getByRole('checkbox', { name: BONUS_ONE })).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'その他の到達点（1）' }))
    await user.click(await screen.findByRole('checkbox', { name: BONUS_TWO }))
    expect(onChange).toHaveBeenLastCalledWith({
      ...defaultIntermediateStateSelection(),
      bonusOpportunityId: intermediateOpportunityAt(candidate, 'bonus', 2).opportunity.id,
    })
    await user.click(screen.getByRole('checkbox', { name: BONUS_ONE }))
    expect(onChange).toHaveBeenLastCalledWith(defaultIntermediateStateSelection())
  })

  it('offers the improvement preference and reports it with the selection', async () => {
    const user = userEvent.setup()
    const { candidate } = checkpointMixedCandidate({
      bonusResults: [checkpointPracticalBonuses(), checkpointIdealBonuses()],
      skillResults: [],
    })
    const onChange = renderSelector(candidate)

    await user.click(screen.getByRole('radio', { name: 'スキルを優先' }))
    expect(onChange).toHaveBeenLastCalledWith({
      ...defaultIntermediateStateSelection(),
      improvementPreference: 'skill_first',
    })
    expect(screen.getByRole('radio', { name: '復元ボーナスを優先' })).toBeInTheDocument()
  })

  it('names the conversion-assigned Skills as a zero-Reset state', () => {
    const candidate = checkpointConversionCandidate({
      conversionSkill: CHECKPOINT_PRACTICAL_SKILL,
      bonusResults: [checkpointIdealBonuses()],
      skillResults: [CHECKPOINT_IDEAL_SKILL],
    })
    const start = intermediateOpportunityAt(candidate, 'skill', 0).opportunity
    expect(intermediateOpportunityLabel(candidate, start)).toBe('巨戟化直後のスキル（スキルリセット0回）')
    renderSelector(candidate)
    expect(screen.getByRole('checkbox', { name: `この途中状態を採用する: ${intermediateOpportunityLabel(candidate, start)}` }))
      .toBeInTheDocument()
  })

  it('tidies a dominated Bonus state behind その他の候補 while keeping it selectable', async () => {
    const user = userEvent.setup()
    const { candidate } = checkpointMixedCandidate({
      bonusResults: [checkpointStrongerPracticalBonuses(), checkpointPracticalBonuses(), checkpointIdealBonuses()],
      skillResults: [],
    })
    const onChange = renderSelector(candidate)

    expect(screen.queryByRole('checkbox', { name: BONUS_TWO })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'その他の候補（1）' }))
    await user.click(await screen.findByRole('checkbox', { name: BONUS_TWO }))
    expect(onChange).toHaveBeenLastCalledWith({
      ...defaultIntermediateStateSelection(),
      bonusOpportunityId: intermediateOpportunityAt(candidate, 'bonus', 2).opportunity.id,
    })
  })

  it('renders read-only when no change handler is given', () => {
    const { candidate } = checkpointMixedCandidate({
      bonusResults: [checkpointPracticalBonuses(), checkpointIdealBonuses()],
      skillResults: [],
    })
    const first = intermediateOpportunityAt(candidate, 'bonus', 1).opportunity
    renderSelector(candidate, { ...defaultIntermediateStateSelection(), bonusOpportunityId: first.id, improvementPreference: 'bonus_first' }, false)

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.getByText(/採用する: 復元ボーナス操作1回目/)).toBeInTheDocument()
    expect(screen.getByText('理想品までの改善優先: 復元ボーナスを優先')).toBeInTheDocument()
  })
})
