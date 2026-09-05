import { stableStringify } from '../models/publicTypes'
import type { EvaluatedBonusSolution, EvaluatedSkillSolution } from './streamSolutions'

interface AxisState {
  bonusAnchor: EvaluatedBonusSolution | null
  skillAnchor: EvaluatedSkillSolution | null
  waitingBonuses: EvaluatedBonusSolution[]
  waitingSkills: EvaluatedSkillSolution[]
}

/**
 * B3 Cross delivered incrementally for one Route base. Complete sorted depths
 * arrive in ascending advance order, so anchors never move. A waiting axis is
 * drained once when its opposite anchor first arrives. Afterwards only the new
 * entry is paired with the opposite anchor. No old pair or off-axis product is
 * traversed. A shared pair of Ideal/Practical axes is published just once.
 */
export function createDeltaCross(
  emit: (bonus: EvaluatedBonusSolution, skill: EvaluatedSkillSolution) => void,
) {
  const state = (): AxisState => ({ bonusAnchor: null, skillAnchor: null, waitingBonuses: [], waitingSkills: [] })
  const axes = { ideal: state(), practical: state() }
  const bonusSeen = new Set<string>()
  const skillSeen = new Set<string>()
  const pairs = new Set<string>()
  function publish(bonus: EvaluatedBonusSolution, skill: EvaluatedSkillSolution) {
    const key = stableStringify([bonus.bonusKey, skill.semanticKey])
    if (pairs.has(key)) return
    pairs.add(key)
    emit(bonus, skill)
  }
  return {
    addBonus(bonus: EvaluatedBonusSolution): void {
      if (bonusSeen.has(bonus.bonusKey)) return
      bonusSeen.add(bonus.bonusKey)
      for (const category of ['ideal', 'practical'] as const) {
        if (!(category === 'ideal' ? bonus.idealMatch : bonus.practicalMatch)) continue
        const axis = axes[category]
        const first = axis.bonusAnchor === null
        axis.bonusAnchor ??= bonus
        if (!axis.skillAnchor) axis.waitingBonuses.push(bonus)
        else if (first) {
          for (const skill of axis.waitingSkills) publish(bonus, skill)
          axis.waitingSkills = []
        } else publish(bonus, axis.skillAnchor)
      }
    },
    addSkill(skill: EvaluatedSkillSolution): void {
      if (skillSeen.has(skill.semanticKey)) return
      skillSeen.add(skill.semanticKey)
      for (const category of ['ideal', 'practical'] as const) {
        if (!(category === 'ideal' ? skill.idealMatch : skill.practicalMatch)) continue
        const axis = axes[category]
        const first = axis.skillAnchor === null
        axis.skillAnchor ??= skill
        if (!axis.bonusAnchor) axis.waitingSkills.push(skill)
        else if (first) {
          for (const bonus of axis.waitingBonuses) publish(bonus, skill)
          axis.waitingBonuses = []
        } else publish(axis.bonusAnchor, skill)
      }
    },
  }
}
