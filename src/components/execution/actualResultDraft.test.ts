import { describe, expect, it } from 'vitest'
import type { RestorationBonusSet } from '../../domain/models/publicTypes'
import { actualResultFromDraft, emptyActualResultDraft } from './actualResultDraft'

const filledSlots = Array.from({ length: 5 }, () => ({
  bonusTypeId: 'bonus_type.attack',
  bonusRankId: 'bonus_rank.base',
})) as RestorationBonusSet

describe('actualResultDraft', () => {
  it('starts with five unfilled slots and unset Skills', () => {
    const draft = emptyActualResultDraft()
    expect(draft.slots).toHaveLength(5)
    draft.slots.forEach((slot) => expect(slot).toEqual({ bonusTypeId: '', bonusRankId: '' }))
    expect(draft.series).toEqual({ status: 'unset' })
    expect(draft.group).toEqual({ status: 'unset' })
  })

  it('yields five slots with the scope the operation fixes only once every slot is complete', () => {
    const draft = emptyActualResultDraft()
    const kind = { kind: 'restoration_bonuses', scope: 'gogma_artian' } as const
    expect(actualResultFromDraft(kind, draft)).toBeNull()
    const partial = { ...draft, slots: filledSlots.map((slot, index) => (index === 4 ? { ...slot, bonusRankId: '' } : slot)) as RestorationBonusSet }
    expect(actualResultFromDraft(kind, partial)).toBeNull()
    expect(actualResultFromDraft(kind, { ...draft, slots: filledSlots })).toEqual({
      kind: 'restoration_bonuses',
      restorationBonuses: filledSlots,
      restorationBonusScope: 'gogma_artian',
    })
  })

  it('never sends an unset Skill as none, and sends none only when chosen', () => {
    const kind = { kind: 'skills' } as const
    const draft = emptyActualResultDraft()
    expect(actualResultFromDraft(kind, { ...draft, series: { status: 'none' } })).toBeNull()
    expect(actualResultFromDraft(kind, { ...draft, group: { status: 'skill', id: 'group_skill.a' } })).toBeNull()
    expect(actualResultFromDraft(kind, {
      ...draft,
      series: { status: 'skill', id: 'series_skill.a' },
      group: { status: 'none' },
    })).toEqual({ kind: 'skills', seriesSkillId: 'series_skill.a', groupSkillId: null })
  })
})
