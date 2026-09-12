import { describe, expect, it, vi } from 'vitest'
import { createCandidateSearchInput, createCandidateSearchEngine, belowPracticalBonuses, candidatesOf } from '../../test/fixtures/candidateSearch'
import { createRestorationBonusSet } from '../../test/fixtures/domainData'
import { searchCandidates } from './candidateSearch'
import { candidateStableKey } from './candidateProcessing'
import { buildBonusSolutionSet, buildSkillSolutionSet, selectIdealBonusAxis, selectIdealSkillAxis } from './streamSolutions'
import { hasTargetCompromise } from '../target'

function idealOnlyInput() {
  const input = createCandidateSearchInput()
  input.routeFilter = 'existing_gogma'
  input.targetWeapons[0].practicalBonusConditions = []
  input.targetWeapons[0].alternativeBonusRules = []
  input.targetWeapons[0].practicalSkillCondition = { seriesSkillId: null, groupSkillId: null, matchMode: 'all' }
  input.ownedWeapons[0].isProtected = false
  input.ownedWeapons[0].restorationBonuses = belowPracticalBonuses()
  input.settings.maxGogmaAdvance = 100
  return input
}

describe('Ideal-only Search', () => {
  it('has no Practical axes even when Ideal matches; no Practical horizon is scheduled', () => {
    const input = idealOnlyInput(), target = input.targetWeapons[0]
    expect(hasTargetCompromise(target)).toBe(false)
    const bonus = buildBonusSolutionSet(target, input, [{ finalBonuses: createRestorationBonusSet(), restorationBonusScope: 'gogma_artian', gogmaAdvance: 0, lastResetDepth: 0, operations: [], amendmentResults: [] }])
    const skill = buildSkillSolutionSet(target, [{ seriesSkillId: 'series_skill.fixture.a', groupSkillId: null, resetCount: 0, estimatedSkillAdvance: 0, operations: [], amendmentResults: [] }])
    expect(selectIdealBonusAxis(bonus)).toHaveLength(1)
    expect(selectIdealSkillAxis(skill)).toHaveLength(1)
  })
  it('retains the canonical Ideal, never predicts beyond it, and repeats deterministically', async () => {
    const sequences: string[][] = []
    for (const searchRunId of ['ideal-only-a', 'ideal-only-b']) {
      const input = idealOnlyInput(); input.searchRunId = searchRunId
      const engine = createCandidateSearchEngine(input, { resetResult: createRestorationBonusSet() })
      const bonusCalls = vi.spyOn(engine, 'predictGogmaBonus')
      const skillCalls = vi.spyOn(engine, 'predictSkills')
      const result = await searchCandidates(input, engine)
      const candidates = candidatesOf(result.targetResult)
      expect(candidates).toHaveLength(1)
      expect(candidates[0].restorationBonusScope).toBe('gogma_artian')
      expect(bonusCalls).toHaveBeenCalledTimes(1)
      expect(skillCalls).not.toHaveBeenCalled()
      sequences.push(candidates.map(candidateStableKey))
    }
    expect(sequences[0]).toEqual(sequences[1])
  })
})
