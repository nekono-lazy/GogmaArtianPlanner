import { describe, expect, it } from 'vitest'
import { defaultIntermediateStateSelection } from '../../domain/buildList'
import type { IntermediateStateOpportunityId } from '../../domain/models/publicTypes'
import {
  checkpointCandidate,
  checkpointIdealBonuses,
  checkpointPracticalBonuses,
  intermediateOpportunityAt,
} from '../../test/fixtures/checkpointRoute'
import { createValidMasterDataFixture } from '../../test/fixtures/masterData'
import { BuildListCardinalityError } from '../../services/buildList/buildListService'
import {
  buildListCardinalityRefusalMessage,
  summarizeIntermediateStateSelection,
} from './buildListReplacementPresentation'

describe('summarizeIntermediateStateSelection', () => {
  const master = createValidMasterDataFixture()
  const candidate = checkpointCandidate([checkpointPracticalBonuses(), checkpointIdealBonuses()])

  it('reads an empty selection as going straight to the Ideal', () => {
    expect(summarizeIntermediateStateSelection(candidate, defaultIntermediateStateSelection(), master)).toEqual({
      skill: '未選択（理想品まで進む）',
      bonus: '未選択（理想品まで進む）',
      improvementPreference: '生産計画に任せる',
    })
  })

  it('names a selected lane position with the same words as the selector', () => {
    const bonus = intermediateOpportunityAt(candidate, 'bonus', 1).opportunity.id
    const summary = summarizeIntermediateStateSelection(
      candidate,
      { skillOpportunityId: null, bonusOpportunityId: bonus, improvementPreference: 'skill_first' },
      master,
    )
    expect(summary.bonus).toBe('復元ボーナス操作1回目（再抽選）の直後')
    expect(summary.improvementPreference).toBe('スキルを優先')
  })

  it('never reads an id the Candidate does not record as unselected', () => {
    const summary = summarizeIntermediateStateSelection(
      candidate,
      { ...defaultIntermediateStateSelection(), skillOpportunityId: 'missing' as IntermediateStateOpportunityId },
      master,
    )
    expect(summary.skill).toBe('候補の記録と一致しない状態')
  })
})

describe('buildListCardinalityRefusalMessage', () => {
  it('names typed cardinality refusals only', () => {
    expect(buildListCardinalityRefusalMessage(new BuildListCardinalityError('replacement_target_changed'))).toBe(
      '置き換える作成リストの候補が変更されました。作成リストを確認してから、もう一度操作してください。',
    )
    expect(buildListCardinalityRefusalMessage(new Error('other'))).toBeNull()
  })
})
