import type {
  RestorationBonus,
  RestorationBonusSet,
} from '../../domain/models/publicTypes'
import type { TargetEvaluationMasterSubset } from '../../domain/target'

export const targetEvaluationMaster: TargetEvaluationMasterSubset = {
  bonusRanks: [
    {
      id: 'bonus_rank.fixture.low',
      displayNameJa: '低（fixture）',
      displayNameEn: 'Low (fixture)',
      order: 1,
      isEx: false,
      isEnabled: true,
    },
    {
      id: 'bonus_rank.fixture.middle',
      displayNameJa: '中（fixture）',
      displayNameEn: 'Middle (fixture)',
      order: 2,
      isEx: false,
      isEnabled: true,
    },
    {
      id: 'bonus_rank.fixture.high',
      displayNameJa: '高（fixture）',
      displayNameEn: 'High (fixture)',
      order: 3,
      isEx: false,
      isEnabled: true,
    },
    {
      id: 'bonus_rank.fixture.special',
      displayNameJa: '特別（fixture）',
      displayNameEn: 'Special (fixture)',
      order: 4,
      isEx: true,
      isEnabled: true,
    },
  ],
}

export function restorationBonus(
  bonusTypeId: string,
  bonusRankId: string,
): RestorationBonus {
  return { bonusTypeId, bonusRankId }
}

export function restorationBonusSet(
  first: RestorationBonus,
  second: RestorationBonus,
  third: RestorationBonus,
  fourth: RestorationBonus,
  fifth: RestorationBonus,
): RestorationBonusSet {
  return [first, second, third, fourth, fifth]
}
