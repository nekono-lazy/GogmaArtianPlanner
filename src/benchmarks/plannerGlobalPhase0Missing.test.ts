import { describe, expect, it } from 'vitest'
import { createCandidateSearchInput } from '../test/fixtures/candidateSearch'
import { buildListEntryId, createRestorationBonusSet } from '../test/fixtures/domainData'
import type { RestorationBonusSet } from '../domain/models/publicTypes'
import { createProductionPlan } from '../domain/planner/productionPlanGeneration'
import type { RngEngine } from '../domain/rng/rngEngine'
import { globalResearchDependencies } from './plannerGlobalOptimizationResearch'
import { mapGlobalResearchTargetResources, verifyGlobalResearchFreshPlan } from './plannerGlobalPhase0Missing'
import { globalResearchFixture } from './plannerGlobalOptimizationTestFixture'

const ideal = createRestorationBonusSet()
// Same families as the Ideal, reordered, a lower tier on one slot, and the Normal-side Sharpness spelling.
const sameFamilies: RestorationBonusSet = [
  { bonusTypeId: 'bonus_type.fixture.normal_sharpness', bonusRankId: 'bonus_rank.fixture.low' },
  ideal[2], ideal[3], ideal[0], { ...ideal[1], bonusRankId: 'bonus_rank.fixture.low' },
]
const otherFamilies: RestorationBonusSet = [ideal[0], ideal[0], ideal[0], ideal[3], ideal[4]]

function stubEngine(table: { normal: Record<number, RestorationBonusSet>; reset: Record<number, RestorationBonusSet>; skill: Record<number, string> }) {
  const calls = { normal: 0, gogma: 0, skill: 0 }
  const engine = {
    predictNormalArtian: ({ normalCounter }: { normalCounter: number }) => { calls.normal++; return table.normal[normalCounter] ?? otherFamilies },
    predictGogmaBonus: ({ gogmaCounter, operation }: { gogmaCounter: number; operation: { type: string } }) => {
      if (operation.type !== 'reset_bonuses') throw new Error('Resource map must only read Reset results.')
      calls.gogma++
      return table.reset[gogmaCounter] ?? otherFamilies
    },
    predictSkills: ({ skillCounter }: { skillCounter: number }) => { calls.skill++; return { seriesSkillId: table.skill[skillCounter] ?? 'series_skill.fixture.other', groupSkillId: null } },
  } as unknown as RngEngine
  return { engine, calls }
}

describe('Phase 0 missing-Target resource map', () => {
  it('lists family-compatible Normal / Reset positions, exact Ideal Resets and Ideal Skill positions without other predictions', () => {
    const search = createCandidateSearchInput()
    const { engine, calls } = stubEngine({ normal: { 2: sameFamilies, 5: ideal }, reset: { 11: sameFamilies, 13: ideal }, skill: { 4: 'series_skill.fixture.a', 9: 'series_skill.fixture.a' } })
    const map = mapGlobalResearchTargetResources(search, engine, { normal: { from: 0, to: 6 }, gogma: { from: 10, to: 14 }, skill: { from: 3, to: 9 } })
    expect(map.targetId).toBe(search.targetWeaponId)
    expect(map.projected).toEqual({ normal: search.normalCounters[0]!.counter, gogma: 10, skill: 7 })
    expect(map.normal.familyCompatiblePositions).toEqual([2, 5])
    expect(map.gogmaReset.familyCompatiblePositions).toEqual([11, 13])
    expect(map.gogmaReset.idealPositions).toEqual([13])
    expect(map.skill.idealPositions).toEqual([4, 9])
    // One prediction per position and stream: Reset results are shared between the two Reset lists.
    expect(calls).toEqual({ normal: 7, gogma: 5, skill: 7 })
  })

  it('refuses an invalid window and a missing Base Seed', () => {
    const search = createCandidateSearchInput()
    const { engine } = stubEngine({ normal: {}, reset: {}, skill: {} })
    expect(() => mapGlobalResearchTargetResources(search, engine, { normal: { from: 3, to: 2 }, gogma: { from: 0, to: 0 }, skill: { from: 0, to: 0 } })).toThrow(RangeError)
    search.rngState.baseSeed = { value: null, isConfirmed: false, source: null }
    expect(() => mapGlobalResearchTargetResources(search, engine, { normal: { from: 0, to: 0 }, gogma: { from: 0, to: 0 }, skill: { from: 0, to: 0 } })).toThrow('Base Seed')
  })
})

describe('Phase 0 missing-Target fresh Planner verification', () => {
  it('without generated Entries reproduces the ordinary Planner over the original input', async () => {
    const { input, engine } = await globalResearchFixture()
    const before = structuredClone(input)
    const dependencies = globalResearchDependencies(engine)
    const verification = await verifyGlobalResearchFreshPlan(input, [], dependencies)
    const ordinary = await createProductionPlan(structuredClone(input), dependencies)
    expect(input).toEqual(before)
    expect(verification.targetDefinitionsUnchanged).toBe(true)
    expect(verification.replacedTargetIds).toEqual([])
    expect(verification.keptOriginalTargetIds).toEqual(input.buildListEntries.map(e => e.targetWeaponId).sort())
    expect(verification.completedTargetCount).toBe(ordinary.termination.completedTargetCount)
    expect(verification.conflicts.map(c => c.id)).toEqual(ordinary.conflicts.map(c => c.id))
    expect(verification.steps).toBe(ordinary.plan?.steps.length ?? 0)
    expect(verification.plannerTraceReplay).toBe(ordinary.plan ? 'valid' : 'not_run')
    expect(verification.success).toBe(ordinary.plan !== null && ordinary.termination.status === 'completed' && ordinary.conflicts.length === 0 &&
      ordinary.plan.rejectedBuildListEntries.length === 0 && ordinary.termination.completedTargetCount === 2)
  })

  it('swaps a generated Entry in for its Target and refuses duplicate or foreign generated Entries', async () => {
    const { input, engine } = await globalResearchFixture()
    const dependencies = globalResearchDependencies(engine)
    const first = input.buildListEntries[0]!
    const generated = { ...structuredClone(first), id: buildListEntryId('build-list.generated.fixture') }
    const verification = await verifyGlobalResearchFreshPlan(input, [generated], dependencies)
    expect(verification.replacedTargetIds).toEqual([first.targetWeaponId])
    expect(verification.keptOriginalTargetIds).toEqual([input.buildListEntries[1]!.targetWeaponId])
    expect(verification.targetDefinitionsUnchanged).toBe(true)
    await expect(verifyGlobalResearchFreshPlan(input, [generated, { ...generated, id: buildListEntryId('build-list.generated.second') }], dependencies)).rejects.toThrow('Two generated Entries')
    await expect(verifyGlobalResearchFreshPlan(input, [{ ...generated, targetWeaponId: 'target.fixture.unknown' as typeof generated.targetWeaponId }], dependencies)).rejects.toThrow('outside the original Build List')
  })
})
