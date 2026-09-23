import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCandidateSearchEngine, createCandidateSearchInput, belowPracticalBonuses } from '../../test/fixtures/candidateSearch'
import { measureNormalRouteSearch } from '../../test/fixtures/normalRouteReduction'
import { candidateStableKey, compareCanonicalIdeals } from './candidateProcessing'
import { searchCandidates } from './candidateSearch'
import { keepFamilyLayoutKey, keepFamilyOfBonus } from '../rng/gogmaBonusFamily'
import type { RestorationBonusSet } from '../models/publicTypes'

function fixture(kind: 'reset' | 'keep' | 'mixed' | 'none', skillDepth = 0, normalBound = 20) {
  const input = createCandidateSearchInput()
  input.routeFilter = 'normal_artian'; input.ownedWeapons = []
  input.settings = { maxNormalAdvance: normalBound, maxGogmaAdvance: 5, maxSkillAdvance: Math.max(5, skillDepth) }
  const ideal = structuredClone(input.targetWeapons[0].idealBonuses)
  const lower = structuredClone(ideal); lower[4].bonusRankId = 'bonus_rank.fixture.low'
  const other = belowPracticalBonuses()
  const engine = createCandidateSearchEngine(input, { keepSupported: true })
  vi.spyOn(engine, 'predictNormalArtian').mockImplementation(({ normalCounter }) =>
    structuredClone(normalCounter < 6 ? other : normalCounter % 2 ? ideal : lower))
  vi.spyOn(engine, 'predictSkills').mockImplementation(({ skillCounter }) => ({
    seriesSkillId: skillCounter === 7 + skillDepth ? 'series_skill.fixture.a' : 'series.other', groupSkillId: null,
  }))
  vi.spyOn(engine, 'predictGogmaBonus').mockImplementation(({ gogmaCounter, operation }) => {
    if (operation.type === 'reset_bonuses') {
      if (kind === 'reset' && gogmaCounter === 12) return structuredClone(ideal)
      return structuredClone(kind === 'mixed' ? lower : other)
    }
    // Family-preserving prediction: tiers alone change. Reset-derived layout
    // has the same future as the matching later Normal, testing frontier merges.
    const matches = keepFamilyLayoutKey(operation.currentBonuses, input.master) === keepFamilyLayoutKey(ideal, input.master)
    return structuredClone(matches && kind !== 'none' && gogmaCounter >= 11 ? ideal : operation.currentBonuses)
  })
  vi.spyOn(engine, 'advanceNormalCounter').mockImplementation((c, op) => c + op.count)
  vi.spyOn(engine, 'advanceSkillCounter').mockImplementation(c => c + 1)
  vi.spyOn(engine, 'advanceGogmaCounter').mockImplementation(c => c + 1)
  return { input, engine, ideal, lower, other }
}

afterEach(() => vi.restoreAllMocks())

describe('#104 Normal base dominance against pre-reduction registration', () => {
  it.each(['reset', 'keep', 'mixed', 'none'] as const)('%s: same full canonical Candidate, scopes, traces and checkpoints', async kind => {
    const { input, engine } = fixture(kind, 9)
    const before = await measureNormalRouteSearch(input, engine, false, true)
    const after = await measureNormalRouteSearch(input, engine, true)
    expect(after.candidate).toEqual(before.candidate)
    expect(after.metrics.normalBases).toBeLessThanOrEqual(2)
    if (kind === 'none') expect(after.candidate).toBeNull()
    else {
      expect(after.candidate).not.toBeNull()
      expect(candidateStableKey(after.candidate!)).toBe(candidateStableKey(before.candidate!))
      expect(compareCanonicalIdeals(after.candidate!, before.candidate!)).toBe(0)
      expect(after.candidate!.route.operations.some(op => op.type === 'reset_skills')).toBe(true)
    }
    if (kind === 'mixed') expect(after.candidate!.route.operations.slice(2, 4).map(op => op.type)).toEqual(['reset_bonuses', 'keep_bonuses'])
    if (kind === 'keep') expect(after.candidate!.route.operations.slice(2, 4).map(op => op.type)).toEqual(['keep_bonuses', 'keep_bonuses'])
  })

  it.each(['reset', 'mixed', 'none'] as const)('filters incompatible later families but preserves offset zero: %s', async kind => {
    const { input, engine, ideal, lower, other } = fixture(kind, 12, 100)
    vi.mocked(engine.predictNormalArtian).mockImplementation(({ normalCounter }) => {
      const slots = structuredClone(other)
      slots[normalCounter % 5] = ideal[0]
      return slots
    })
    vi.mocked(engine.predictGogmaBonus).mockImplementation(({ operation }) => {
      if (operation.type === 'reset_bonuses') return structuredClone(kind === 'reset' ? ideal : kind === 'mixed' ? lower : other)
      return structuredClone(kind === 'mixed' && keepFamilyLayoutKey(operation.currentBonuses, input.master) === keepFamilyLayoutKey(ideal, input.master)
        ? ideal : operation.currentBonuses)
    })
    const before = await measureNormalRouteSearch(input, engine, false, true)
    const after = await measureNormalRouteSearch(input, engine, true, true)
    expect(after.candidate).toEqual(before.candidate)
    expect(after.metrics).toMatchObject({ normalPredictions: 100, familyCompatibleNormals: 0,
      compatibleUniqueLayouts: 0, uniqueLayouts: 5, normalBases: 1, bonusChannels: 1 })
    expect(before.metrics.normalBases).toBe(100)
    expect(after.metrics.bonusStates).toBeLessThan(before.metrics.bonusStates)
    expect(after.metrics.settledWork).toBeLessThan(before.metrics.settledWork)
    if (kind === 'none') expect(after.candidate).toBeNull()
    else {
      expect(after.candidate!.estimatedNormalAdvance).toBe(1)
      expect(after.candidate!.route.operations[2].type).toBe('reset_bonuses')
      expect(after.candidate!.route.operations.some(op => op.type === 'reset_skills')).toBe(true)
      if (kind === 'mixed') expect(after.candidate!.route.operations[3].type).toBe('keep_bonuses')
    }
  })

  it('keeps both A A A S S and S A S A A while folding tier and mapped-type duplicates', async () => {
    const { input, engine, ideal, other } = fixture('keep', 12, 30)
    const goal: RestorationBonusSet = [ideal[0], ideal[0], ideal[0], ideal[4], ideal[4]]
    input.targetWeapons[0].idealBonuses = goal
    const first: RestorationBonusSet = [goal[0], goal[1], goal[2], goal[3], { ...goal[4], bonusRankId: 'bonus_rank.fixture.low' }]
    const second: RestorationBonusSet = [first[3], first[0], first[4], first[1], first[2]]
    const mapped = structuredClone(first)
    mapped[3].bonusTypeId = 'bonus_type.fixture.normal_sharpness'
    mapped[4].bonusTypeId = 'bonus_type.fixture.normal_sharpness'
    const values = [other, first, mapped, second, goal]
    vi.mocked(engine.predictNormalArtian).mockImplementation(({ normalCounter }) => values[(normalCounter - 4) % values.length])
    vi.mocked(engine.predictGogmaBonus).mockImplementation(({ operation }) => operation.type === 'reset_bonuses' ? other
      : operation.currentBonuses.map(slot => goal.find(g => g.bonusTypeId === keepFamilyOfBonus(slot, input.master)) ?? slot) as RestorationBonusSet)
    const before = await measureNormalRouteSearch(input, engine, false, true)
    const after = await measureNormalRouteSearch(input, engine, true, true)
    expect(after.candidate).toEqual(before.candidate)
    expect(after.candidate).not.toBeNull()
    expect(after.metrics).toMatchObject({ normalPredictions: 30, familyCompatibleNormals: 24,
      compatibleUniqueLayouts: 2, normalBases: 3, bonusChannels: 3 })
    expect(after.candidate!.estimatedNormalAdvance).toBe(2)
  })

  it('keeps the lowest forgeCount Reset route even when every offset could Reset', async () => {
    const { input, engine, ideal, other } = fixture('reset', 12, 100)
    vi.mocked(engine.predictGogmaBonus).mockImplementation(({ operation }) => operation.type === 'reset_bonuses' ? ideal : other)
    const before = await measureNormalRouteSearch(input, engine, false, true)
    const after = await measureNormalRouteSearch(input, engine, true)
    expect(after.candidate).toEqual(before.candidate)
    expect(after.candidate).toMatchObject({ estimatedNormalAdvance: 1, estimatedGogmaAdvance: 1, estimatedSkillAdvance: 13, estimatedOperationCount: 15 })
    expect(after.candidate!.route.operations[2].type).toBe('reset_bonuses')
    expect(after.metrics.compositions).toBeLessThan(before.metrics.compositions)
  })

  it('keeps a later Normal when equal total cost wins on Gogma advance', async () => {
    const { input, engine, ideal, other } = fixture('keep')
    const predict = vi.mocked(engine.predictGogmaBonus).getMockImplementation()!
    vi.mocked(engine.predictGogmaBonus).mockImplementation(args => args.operation.type === 'reset_bonuses'
      ? args.gogmaCounter === 13 ? ideal : other : predict(args))
    const before = await measureNormalRouteSearch(input, engine, false, true)
    const after = await measureNormalRouteSearch(input, engine, true)
    expect(after.candidate).toEqual(before.candidate)
    expect(after.candidate).toMatchObject({ estimatedOperationCount: 6, estimatedGogmaAdvance: 2,
      estimatedSkillAdvance: 1, estimatedNormalAdvance: 3 })
  })

  it('does not treat exact Ideal labels in normal scope as an amendment-free Ideal', async () => {
    const { input, engine, ideal, other } = fixture('none')
    vi.mocked(engine.predictNormalArtian).mockReturnValue(ideal)
    vi.mocked(engine.predictGogmaBonus).mockReturnValue(other)
    expect((await measureNormalRouteSearch(input, engine, false)).candidate).toBeNull()
    const after = await measureNormalRouteSearch(input, engine, true)
    expect(after.candidate).toBeNull()
    expect(after.metrics.normalPredictions).toBe(20)
    expect(after.metrics.normalBases).toBe(1)
  })

  it('retains later unique ordered layouts, but folds tiers and Normal-side family spellings', async () => {
    const { input, engine, ideal, lower, other } = fixture('keep', 12)
    const reversed = [...lower].reverse() as RestorationBonusSet
    const mapped = structuredClone(lower); mapped[4].bonusTypeId = 'bonus_type.fixture.normal_sharpness'
    const values = [other, lower, mapped, ideal, reversed, reversed]
    vi.mocked(engine.predictNormalArtian).mockImplementation(({ normalCounter }) => values[(normalCounter - 4) % values.length])
    const before = await measureNormalRouteSearch(input, engine, false, true)
    const after = await measureNormalRouteSearch(input, engine, true)
    expect(after.candidate).toEqual(before.candidate)
    expect(after.metrics.uniqueLayouts).toBe(3)
    expect(after.metrics.normalBases).toBe(3)
    expect(after.candidate!.estimatedNormalAdvance).toBe(2)
  })

  it('does not pre-read the maximum after a nearby Ideal', async () => {
    const { input, engine, ideal } = fixture('reset', 0, 1000)
    vi.mocked(engine.predictGogmaBonus).mockReturnValue(ideal)
    const after = await measureNormalRouteSearch(input, engine, true)
    expect(after.candidate!.estimatedOperationCount).toBe(3)
    expect(after.metrics.normalPredictions).toBe(2)
    const before = await measureNormalRouteSearch(input, engine, false)
    expect(after.candidate).toEqual(before.candidate)
  })

  it.each([1, 100, 500, 1000])('deep Skill Ideal keeps parity and at most two bases at Normal %i', async bound => {
    const { input, engine } = fixture('mixed', 1084, bound)
    const before = await measureNormalRouteSearch(input, engine, false)
    const after = await measureNormalRouteSearch(input, engine, true)
    expect(after.candidate).toEqual(before.candidate)
    expect(after.candidate!.estimatedSkillAdvance).toBe(1085)
    expect(after.metrics.normalPredictions).toBe(bound)
    expect(after.metrics.normalBases).toBeLessThanOrEqual(2)
    expect(after.metrics.skillChannels).toBe(1)
    expect(after.metrics.bonusChannels).toBeLessThanOrEqual(2)
    if (bound > 1) expect(after.metrics.bonusStates).toBeLessThan(before.metrics.bonusStates)
  })

  it('preserves preferred-source/stable ties and existing Gogma skill-only routes', async () => {
    const { input, engine, ideal } = fixture('mixed', 4)
    input.routeFilter = 'all'
    const source = createCandidateSearchInput().ownedWeapons[0]
    if (source.kind !== 'gogma') throw new Error('fixture')
    source.restorationBonusScope = 'gogma_artian'; source.restorationBonuses = ideal
    source.seriesSkillId = 'series.other'; source.isProtected = false
    const second = { ...source, id: 'owned.second' as typeof source.id }
    input.ownedWeapons = [second, source]
    for (const preference of [null, source.id, second.id]) {
      input.targetWeapons[0].preferredOwnedWeaponId = preference
      const before = await measureNormalRouteSearch(input, engine, false, true)
      const after = await measureNormalRouteSearch(input, engine, true)
      expect(after.candidate).toEqual(before.candidate)
      expect(after.candidate!.route.kind).toBe('existing_gogma_reset_skills')
      if (preference) expect(after.candidate!.route.sourceOwnedWeaponId).toBe(preference)
    }
  })

  it('still checks cancellation while skipping duplicate bases and reports final settled work', async () => {
    const { input, engine } = fixture('none', 2, 1000)
    let yields = 0
    await expect(searchCandidates(input, engine, { yieldControl: async () => { yields++ }, shouldCancel: () => yields >= 2 })).rejects.toThrow('cancelled')
    const progress = vi.fn()
    const result = await searchCandidates(input, engine, { onProgress: progress })
    expect(result.targetResult.candidate).toBeNull()
    expect(progress.mock.calls[0][0]).toMatchObject({ phase: 'preparing', processedWorkItems: 0 })
    expect(progress.mock.calls.at(-1)![0]).toMatchObject({ phase: 'finalizing' })
    expect(progress.mock.calls.at(-1)![0].processedWorkItems).toBeGreaterThanOrEqual(1000)
  })
})
