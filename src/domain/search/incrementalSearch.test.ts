import { describe, expect, it } from 'vitest'
import { createCandidateSearchInput, practicalOnlyBonuses } from '../../test/fixtures/candidateSearch'
import { createDeltaCross } from './deltaCross'
import { createIncrementalBonusRetention, createIncrementalSkillRetention } from './incrementalStreamSolutions'
import { SearchWorkQueue } from './searchWorkQueue'
import { crossStreamSolutions } from './crossComposition'
import {
  buildBonusSolutionSet, buildSkillSolutionSet, selectIdealBonusAxis, selectIdealSkillAxis,
  type EvaluatedBonusSolution, type EvaluatedSkillSolution,
  type RouteBonusSolution, type RouteSkillSolution,
} from './streamSolutions'

const input = createCandidateSearchInput()
const target = input.targetWeapons[0]
const skill = (depth: number, series = 'series.' + depth): RouteSkillSolution => ({
  resetCount: depth, seriesSkillId: series, groupSkillId: null, estimatedSkillAdvance: depth, operations: [],
  amendmentResults: [],
})
const bonus = (depth: number, ideal = false): RouteBonusSolution => ({
  gogmaAdvance: depth, lastResetDepth: depth, restorationBonusScope: 'gogma_artian',
  finalBonuses: ideal ? structuredClone(target.idealBonuses) : practicalOnlyBonuses(), operations: [],
  amendmentResults: [],
})

describe('incremental stream retention', () => {
  it('retains Normal then Gogma exact-label outcomes and agrees with full-prefix retention', () => {
    const normal: RouteBonusSolution = { ...bonus(0, true), restorationBonusScope: 'normal_artian' }
    const depths = [normal, bonus(1, true), bonus(2, true)]
    const retention = createIncrementalBonusRetention(target, input)
    const retained = depths.flatMap((solution) => retention.appendDepth([solution]))
    expect(retained.map(({ solution, idealMatch }) => [
      solution.gogmaAdvance, solution.restorationBonusScope, idealMatch,
    ])).toEqual([[0, 'normal_artian', false], [1, 'gogma_artian', true]])
    expect(retained.map((entry, index) => ({ ...entry, index })))
      .toEqual(buildBonusSolutionSet(target, input, depths))
  })

  it('orders otherwise identical scopes deterministically within a depth', () => {
    const gogma = bonus(0, true)
    const normal: RouteBonusSolution = { ...gogma, restorationBonusScope: 'normal_artian' }
    const retained = createIncrementalBonusRetention(target, input).appendDepth([normal, gogma])
    expect(retained).toHaveLength(2)
    expect(createIncrementalBonusRetention(target, input).appendDepth([gogma, normal])).toEqual(retained)
    expect(retained).toEqual(buildBonusSolutionSet(target, input, [normal, gogma]))
  })

  it('publishes only Gogma scope through delta Cross', () => {
    const normal: RouteBonusSolution = { ...bonus(0, true), restorationBonusScope: 'normal_artian' }
    const bonuses = buildBonusSolutionSet(target, input, [normal, bonus(1, true)])
    const [idealSkill] = buildSkillSolutionSet(target, [skill(0, 'series_skill.fixture.a')])
    const pairs: string[] = []
    const cross = createDeltaCross((b) => pairs.push(b.solution.restorationBonusScope))
    cross.addBonus(bonuses[0])
    cross.addSkill(idealSkill)
    cross.addBonus(bonuses[1])
    cross.addBonus(bonuses[1])
    expect(pairs).toEqual(['gogma_artian'])
  })

  it('retains new Skill outcomes at their first depth and rejects prefix replay', () => {
    const retention = createIncrementalSkillRetention(target)
    const first = retention.appendDepth([skill(1)])
    expect(first.map((s) => s.solution.resetCount)).toEqual([1])
    expect(retention.appendDepth([skill(2, 'series.1')])).toEqual([])
    expect(retention.appendDepth([skill(3)]).map((s) => s.solution.resetCount)).toEqual([3])
    expect(() => retention.appendDepth([skill(1), skill(2), skill(3), skill(4)])).toThrow('new complete depth')
    expect(() => retention.appendDepth([skill(3)])).toThrow('new complete depth')
  })

  it('retains completed Bonus multisets per scope without slot-order identity, at first depth only', () => {
    const retention = createIncrementalBonusRetention(target, input)
    expect(retention.appendDepth([bonus(1)])).toHaveLength(1)
    const later = bonus(2)
    later.finalBonuses.reverse()
    expect(retention.appendDepth([later])).toEqual([])
    expect(retention.appendDepth([bonus(3, true)]).map((s) => s.solution.gogmaAdvance)).toEqual([3])
    expect(() => retention.appendDepth([bonus(1), bonus(2), bonus(3)])).toThrow('new complete depth')
  })

  it('settles same-depth Bonus ties before publication using unchanged B3 ordering', () => {
    const reset = { ...bonus(1), operations: [{ type: 'reset_bonuses' as const, sourceOwnedWeaponId: null, gogmaCounterBefore: 10, gogmaCounterAfter: 11 }] }
    const keep = { ...bonus(1), lastResetDepth: 0, operations: [{ type: 'keep_bonuses' as const, sourceOwnedWeaponId: null, gogmaCounterBefore: 10, gogmaCounterAfter: 11 }] }
    const depth = [reset, bonus(1, true), keep]
    const incremental = createIncrementalBonusRetention(target, input).appendDepth(depth)
    expect(incremental).toEqual(buildBonusSolutionSet(target, input, depth))
    const reversed = createIncrementalBonusRetention(target, input).appendDepth([...depth].reverse())
    expect(reversed).toEqual(incremental)
  })
})

describe('delta Cross semantic work', () => {
  const bonusAxis = (): EvaluatedBonusSolution[] =>
    [0, 1, 2].map((depth) => ({
      ...buildBonusSolutionSet(target, input, [bonus(depth)])[0],
      bonusKey: 'b' + depth, retentionKey: 'b' + depth, index: depth, idealMatch: true,
    }))
  const skillAxis = (): EvaluatedSkillSolution[] =>
    [0, 1, 2].map((depth) => ({
      ...buildSkillSolutionSet(target, [skill(depth)])[0],
      semanticKey: 'k' + depth, index: depth, idealMatch: true,
    }))
  const key = (b: EvaluatedBonusSolution, k: EvaluatedSkillSolution) => b.bonusKey + ',' + k.semanticKey

  it.each(['bonus-first', 'skill-first', 'interleaved'] as const)(
    'emits each pair of the single Ideal axis exactly once (%s)', (order) => {
      const bonuses = bonusAxis(), skills = skillAxis(), emitted: string[] = []
      const cross = createDeltaCross((b, k) => emitted.push(key(b, k)))
      if (order === 'bonus-first') {
        bonuses.forEach(cross.addBonus)
        expect(emitted).toEqual([])
        skills.forEach(cross.addSkill)
      } else if (order === 'skill-first') {
        skills.forEach(cross.addSkill)
        expect(emitted).toEqual([])
        bonuses.forEach(cross.addBonus)
      } else {
        for (let i = 0; i < 3; i += 1) {
          cross.addBonus(bonuses[i])
          cross.addSkill(skills[i])
        }
      }
      const expected = new Set(
        crossStreamSolutions(
          selectIdealBonusAxis(bonuses),
          selectIdealSkillAxis(skills),
        ).map(({ bonus: b, skill: k }) => key(b, k)),
      )
      expect([...emitted].sort()).toEqual([...expected].sort())
      expect(new Set(emitted).size).toBe(emitted.length)
      expect(emitted).not.toContain('b2,k2') // Off-axis on the Ideal axis.
      const settled = [...emitted]
      bonuses.forEach(cross.addBonus)
      skills.forEach(cross.addSkill)
      expect(emitted).toEqual(settled)
    },
  )

  it('pairs each newly retained solution with its anchor without traversing old pairs', () => {
    const bonuses = bonusAxis()
    const skills = skillAxis()
    const emitted: string[] = []
    const cross = createDeltaCross((b, k) => emitted.push(key(b, k)))
    cross.addBonus(bonuses[0])
    cross.addSkill(skills[0])
    expect(emitted).toEqual(['b0,k0'])
    cross.addBonus(bonuses[1])
    expect(emitted.slice(1)).toEqual(['b1,k0'])
    cross.addSkill(skills[1])
    expect(emitted.slice(2)).toEqual(['b0,k1'])
    cross.addBonus(bonuses[2])
    cross.addSkill(skills[2])
    expect(emitted.slice(3)).toEqual(['b2,k0', 'b0,k2'])
    expect(emitted).toHaveLength(3 + 3 - 1)
  })
})

describe('pending work queue', () => {
  it('settles only explicit work, including newly discovered same-layer work', async () => {
    const queue = new SearchWorkQueue(), settled: number[] = []
    queue.enqueue({ lowerBound: 100, settle: () => { settled.push(100) } })
    queue.enqueue({ lowerBound: 3, settle: () => {
      settled.push(3)
      queue.enqueue({ lowerBound: 3, settle: () => { settled.push(3) } })
    } })
    while (queue.nextLowerBound !== null && queue.nextLowerBound <= 3) await queue.settleNext()
    expect(settled).toEqual([3, 3])
    expect(queue.pendingCount).toBe(1)
    expect(queue.nextLowerBound).toBe(100)
    await queue.settleNext()
    expect(queue.pendingCount).toBe(0)
    expect(queue.nextLowerBound).toBeNull()
    expect(settled).toEqual([3, 3, 100]) // No steps for empty layers 4..99.
    expect(() => queue.enqueue({ lowerBound: 99, settle() {} })).toThrow('monotone')
  })
})
