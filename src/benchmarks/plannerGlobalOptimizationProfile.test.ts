import { describe, expect, it, vi } from 'vitest'
import { createCandidateSearchInput, createCandidateSearchEngine } from '../test/fixtures/candidateSearch'
import { createRestorationBonusSet } from '../test/fixtures/domainData'
import { searchCandidates } from '../domain/search/candidateSearch'
import type { NormalArtianPredictionInput } from '../domain/rng/rngEngine'
import { GlobalSearchProfiler, ExactPredictionKeys } from './plannerGlobalOptimizationProfile'
import { GLOBAL_RESEARCH_TIME, orderGlobalResearchPending } from './plannerGlobalOptimizationResearch'
import { runGlobalResearchFocus } from './plannerGlobalOptimizationFocus'

function setup() {
  const input = createCandidateSearchInput()
  input.ownedWeapons = []
  const engine = createCandidateSearchEngine(input, { resetResult: createRestorationBonusSet() })
  return { input, engine }
}

describe('Phase 1-A observation', () => {
  it('preserves complete Candidate results and the interleaved prediction call sequence', async () => {
    const { input, engine } = setup()
    const calls: unknown[] = []
    for (const name of ['predictNormalArtian', 'predictGogmaBonus', 'predictSkills'] as const) {
      const original = engine[name].bind(engine)
      // Explicit branches preserve each method input/result signature.
      if (name === 'predictNormalArtian') vi.spyOn(engine, name).mockImplementation(v => { calls.push([name, structuredClone(v)]); return (original as typeof engine.predictNormalArtian)(v) })
      if (name === 'predictGogmaBonus') vi.spyOn(engine, name).mockImplementation(v => { calls.push([name, structuredClone(v)]); return (original as typeof engine.predictGogmaBonus)(v) })
      if (name === 'predictSkills') vi.spyOn(engine, name).mockImplementation(v => { calls.push([name, structuredClone(v)]); return (original as typeof engine.predictSkills)(v) })
    }
    const options = { now: () => GLOBAL_RESEARCH_TIME, nowMs: () => 0 }
    const plain = await searchCandidates(input, engine, options)
    const sequence = structuredClone(calls)
    expect(sequence.length).toBeGreaterThan(2)
    calls.length = 0
    const profiler = new GlobalSearchProfiler()
    const observed = profiler.begin(engine, options, () => 0)
    observed.profile.settledWorkItems = -900 // Measurements cannot feed a Search decision.
    const measured = await searchCandidates(input, observed.engine, observed.execution)
    expect(measured).toEqual(plain)
    expect(calls).toEqual(sequence)
    expect(observed.profile.settledCountExact).toBe(true)
    expect(observed.profile.candidateIdentityCalls).toBeGreaterThan(0)
    const yielded = profiler.begin(engine, { ...options, yieldControl: () => new Promise(resolve => setTimeout(resolve, 0)) }, () => 0)
    expect(await searchCandidates(input, yielded.engine, yielded.execution)).toEqual(plain)
    const again = profiler.begin(engine, options, () => 0)
    await searchCandidates(structuredClone(input), again.engine, again.execution)
    for (const axis of ['normal', 'gogma', 'skill'] as const) {
      expect(again.profile.predictions[axis].previousSearchDuplicateCalls).toBe(again.profile.predictions[axis].calls)
      expect(profiler.summary()[axis].calls).toBe(3 * observed.profile.predictions[axis].calls)
    }
  })

  it('forwards the input, return reference, exception and call count exactly', () => {
    const { input, engine } = setup()
    const v: NormalArtianPredictionInput = { baseSeed: input.rngState.baseSeed.value!, weaponTypeId: input.targetWeapons[0].weaponTypeId,
      elementId: input.targetWeapons[0].elementId, rarity: 8, normalCounter: 4, master: input.master }
    const output = createRestorationBonusSet()
    const spy = vi.spyOn(engine, 'predictNormalArtian').mockReturnValue(output)
    const observed = new GlobalSearchProfiler().begin(engine)
    expect(observed.engine.predictNormalArtian(v)).toBe(output)
    expect(spy.mock.calls[0][0]).toBe(v)
    const failure = new Error('fixture prediction failure')
    spy.mockImplementation(() => { throw failure })
    expect(() => observed.engine.predictNormalArtian(v)).toThrow(failure)
    expect(spy).toHaveBeenCalledTimes(2)
    expect(observed.profile.predictions.normal).toMatchObject({ calls: 2, uniqueInputs: 1, withinSearchDuplicateCalls: 1 })
  })

  it('uses deterministic complete keys, distinguishing every changed input including Master and slot order', () => {
    const { input } = setup()
    const v = { baseSeed: '12', weaponTypeId: 'weapon.a', elementId: 'element.a', rarity: 8 as const, normalCounter: 4, master: input.master }
    const keys = new ExactPredictionKeys(), key = keys.forSearch('engine.v1')
    expect(key('normal', v)).toBe(keys.forSearch('engine.v1')('normal', structuredClone(v)))
    expect(key('normal', v)).toBe(key('normal', { master: v.master, normalCounter: v.normalCounter, rarity: v.rarity,
      elementId: v.elementId, weaponTypeId: v.weaponTypeId, baseSeed: v.baseSeed }))
    expect(key('normal', v)).toBe(new ExactPredictionKeys().forSearch('engine.v1')('normal', v))
    for (const change of [{ baseSeed: '13' }, { normalCounter: 5 }, { weaponTypeId: 'weapon.b' }, { elementId: 'element.b' },
      { master: { ...input.master, bonusRanks: [] } }]) {
      expect(key('normal', { ...v, ...change })).not.toBe(key('normal', v))
    }
    expect(keys.forSearch('engine.v2')('normal', v)).not.toBe(key('normal', v))
    const bonuses = createRestorationBonusSet()
    const keep = { ...v, gogmaCounter: 10, operation: { type: 'keep_bonuses' as const, currentBonuses: bonuses } }
    expect(key('gogma', keep)).not.toBe(key('gogma', { ...keep, operation: { type: 'reset_bonuses' } }))
    const reversed = [...bonuses].reverse() as typeof bonuses
    expect(key('gogma', keep)).not.toBe(key('gogma', { ...keep, operation: { ...keep.operation, currentBonuses: reversed } }))
  })

  it('isolates route-family and bound experiments and distinguishes deadline, cancel and bounded no-match', async () => {
    const { input, engine } = setup(), before = structuredClone(input)
    const options = { timeBudgetMs: 100, nowMs: () => 0 }
    const a = await runGlobalResearchFocus(input, engine, options)
    expect(a.status).toBe('found')
    const existing = await runGlobalResearchFocus(input, engine, { ...options, routeFilter: 'existing_gogma' })
    expect(existing.status).toBe('unavailable')
    const extent = { ...input.settings, maxNormalAdvance: input.settings.maxNormalAdvance + 1 }
    const expanded = await runGlobalResearchFocus(input, engine, { ...options, extent })
    expect(expanded.extent).toEqual(extent)
    expanded.extent.maxNormalAdvance++
    expect(extent.maxNormalAdvance).toBe(input.settings.maxNormalAdvance + 1)
    expect(await runGlobalResearchFocus(input, engine, options)).toEqual(a)
    expect(input).toEqual(before)
    expect((await runGlobalResearchFocus(input, engine, { ...options, timeBudgetMs: 0 })).status).toBe('time_budget_reached')
    expect((await runGlobalResearchFocus(input, engine, { ...options, shouldCancel: () => true })).status).toBe('cancelled')
    const noMatch = createCandidateSearchEngine(input)
    expect((await runGlobalResearchFocus(input, noMatch, options)).status).toBe('not_found_within_extent')
  })

  it('moves caller-observed failures first with stable remainder, without embedded Target IDs', () => {
    const pending = ['z', 'a', 'q', 'b'].map(targetWeaponId => ({ targetWeaponId }))
    expect(orderGlobalResearchPending(pending)).toEqual(pending)
    expect(orderGlobalResearchPending(pending, ['q']).map(e => e.targetWeaponId)).toEqual(['q', 'z', 'a', 'b'])
    expect(orderGlobalResearchPending(pending, ['b', 'a']).map(e => e.targetWeaponId)).toEqual(['a', 'b', 'z', 'q'])
    expect(pending.map(e => e.targetWeaponId)).toEqual(['z', 'a', 'q', 'b'])
  })
})
