import type { PracticalBonusCondition, RestorationBonusSet, SkillCondition } from '../domain/models/publicTypes'

/** Explicit rank compromises for a fixed Production layout; never a type wildcard. */
export function benchmarkPracticalBonuses(ideal: RestorationBonusSet): PracticalBonusCondition[] {
  return [...new Set(ideal.map(({ bonusTypeId }) => bonusTypeId))].map((bonusTypeId) => ({
    id: 'benchmark.practical.' + bonusTypeId, bonusTypeId, minimumRankId: 'bonus_rank.base', requiredExCount: 0,
  }))
}

/** An explicit Series fallback; the Ideal adds a Group constraint. */
export function benchmarkPracticalSkills(ideal: SkillCondition): SkillCondition {
  return { seriesSkillId: ideal.seriesSkillId, groupSkillId: null, matchMode: 'all' }
}
