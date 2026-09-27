import { describe, expect, it, vi } from 'vitest'
import { loadMasterData } from '../domain/master/loadMasterData'
import { CURRENT_CALCULATION_APP_SCHEMA_VERSION, type RestorationBonusSet } from '../domain/models/publicTypes'
import { createBuildListEntry } from '../domain/buildList'
import { searchCandidates } from '../domain/search/candidateSearch'
import type { CandidateSearchInput } from '../domain/search/searchTypes'
import { ProductionRngEngine } from '../domain/rng/production/productionRngEngine'
import { readReferenceRngBlock } from '../domain/rng/production/referencePrng'
import * as reference from '../domain/rng/production/referencePrng'
import { deriveGogmaSeed } from '../domain/rng/production/seedDerivation'
import { predictProductionGogmaReset, predictReferenceGogmaKeep } from '../domain/rng/production/gogmaPrediction'
import { gameVerifiedGogmaResetVectors, gameVerifiedGogmaKeepVector, gameVerifiedProductionGogmaResetVectors } from '../test/fixtures/gameVerifiedGogmaVectors'
import { createCandidateSearchInput } from '../test/fixtures/candidateSearch'
import { createValidOwnedWeapon, ownedWeaponId, targetWeaponId } from '../test/fixtures/domainData'
import { GlobalRawBlockResearch } from './plannerGlobalRawBlocks'
import { GlobalSearchProfiler } from './plannerGlobalOptimizationProfile'
import { GLOBAL_RESEARCH_TIME, globalResearchDependencies, runGlobalPlannerResearch } from './plannerGlobalOptimizationResearch'
import { runGlobalResearchFocus } from './plannerGlobalOptimizationFocus'

function master() {
  const loaded = loadMasterData()
  if (!loaded.ok) throw new Error('Missing master')
  return loaded.data
}

function fixture(): CandidateSearchInput {
  const input = createCandidateSearchInput(), data = master(), engine = new ProductionRngEngine()
  input.master = data
  input.calculationContext = { gameVersion: data.manifest.gameVersion, masterDataVersion: data.manifest.dataVersion,
    rngEngineVersion: engine.version, appSchemaVersion: CURRENT_CALCULATION_APP_SCHEMA_VERSION }
  input.rngState.baseSeed.value = '51231782'
  input.rngState.gogmaCounter.value = 55
  input.settings = { maxNormalAdvance: 2, maxGogmaAdvance: 8, maxSkillAdvance: 200 }
  const target = input.targetWeapons[0]
  target.weaponTypeId = 'weapon.bow'; target.elementId = 'element.fire'
  target.idealBonuses = structuredClone(gameVerifiedGogmaResetVectors[0].bonuses)
  target.practicalBonusConditions = []; target.alternativeBonusRules = []
  target.practicalSkillCondition = { seriesSkillId: null, groupSkillId: null, matchMode: 'all' }
  const skills = Array.from({ length: 100 }, (_, i) => engine.predictSkills({ baseSeed: '51231782', skillCounter: 15 + i,
    weaponTypeId: target.weaponTypeId, elementId: target.elementId, master: data })).find(value => value.seriesSkillId !== null)!
  target.idealSkillCondition = { seriesSkillId: skills.seriesSkillId, groupSkillId: null, matchMode: 'all' }
  input.normalCounters[0].weaponTypeId = target.weaponTypeId
  input.normalCounters[0].id = `${target.weaponTypeId}:8`
  input.ownedWeapons = [0, 1].map(i => ({ ...createValidOwnedWeapon(ownedWeaponId(`owned.raw.${i}`)),
    weaponTypeId: target.weaponTypeId, elementId: target.elementId, isProtected: false,
    restorationBonuses: structuredClone(target.idealBonuses), seriesSkillId: null, groupSkillId: null }))
  target.preferredOwnedWeaponId = input.ownedWeapons[0].id
  input.targetWeapons.push({ ...structuredClone(target), id: targetWeaponId('target.raw.b'), preferredOwnedWeaponId: input.ownedWeapons[1].id })
  const secondBonuses = engine.predictGogmaBonus({ baseSeed: '51231782', gogmaCounter: 56, weaponTypeId: target.weaponTypeId,
    elementId: target.elementId, master: data, operation: { type: 'reset_bonuses' } })
  input.targetWeapons[1].idealBonuses = secondBonuses
  input.ownedWeapons[1].restorationBonuses = structuredClone(secondBonuses)
  return input
}

describe('Phase 1-B raw block boundary', () => {
  it('defaults to the existing reference reader and preserves fixed game vectors', () => {
    const spy = vi.spyOn(reference, 'readReferenceRngBlock')
    try {
      const engine = new ProductionRngEngine(), data = master()
      for (const v of [...gameVerifiedGogmaResetVectors, ...gameVerifiedProductionGogmaResetVectors]) {
        expect(engine.predictGogmaBonus({ ...v, baseSeed: String(v.baseSeed), master: data, operation: { type: 'reset_bonuses' } })).toEqual(v.bonuses)
      }
      expect(spy).toHaveBeenCalledTimes(gameVerifiedGogmaResetVectors.length + gameVerifiedProductionGogmaResetVectors.length)
      const v = gameVerifiedGogmaResetVectors[0]
      expect(spy).toHaveBeenCalledWith(deriveGogmaSeed(v.baseSeed, v.weaponTypeId, v.elementId), v.gogmaCounter)
      expect(engine.version).toBe('production-rng:c5-e7')
    } finally { spy.mockRestore() }
  })

  it('keys exact reader arguments, freezes owned copies, evicts safely and ends the lifetime', () => {
    const source = vi.fn(readReferenceRngBlock), research = new GlobalRawBlockResearch('per-search', source, () => 0, 2)
    const a = research.beginSearch('a')
    const block = a.read(123, 5)
    expect(a.read(123, 5)).toBe(block)
    expect(Object.isFrozen(block)).toBe(true); expect(Object.isFrozen(block.values)).toBe(true)
    expect(() => { (block.values as number[])[0] = 0 }).toThrow(TypeError)
    expect(a.read(124, 5)).toEqual(readReferenceRngBlock(124, 5))
    expect(a.read(123, 6)).toEqual(readReferenceRngBlock(123, 6))
    expect(a.read(123, 5)).toEqual(block) // evicted, recomputed by authority
    expect(source).toHaveBeenCalledTimes(4)
    expect(a.profile).toMatchObject({ requests: 5, hits: 1, uniqueBlocks: 3, peakEntries: 2, rawUint32Count: 20, approximatePayloadBytes: 80 })
    a.end()
    expect(() => a.read(123, 5)).toThrow('lifetime has ended')
    const b = research.beginSearch('b'); b.read(123, 5); b.end()
    expect(source).toHaveBeenCalledTimes(5)
  })

  it('observes off without changing references and never caches or converts an exception', () => {
    for (const mode of ['off', 'per-search', 'run'] as const) {
      const failure = new Error('raw failure'), block = readReferenceRngBlock(1, 0)
      const read = vi.fn<typeof readReferenceRngBlock>().mockImplementationOnce(() => { throw failure }).mockImplementationOnce(() => { throw failure }).mockReturnValue(block)
      const scope = new GlobalRawBlockResearch(mode, read, () => 0).beginSearch('test')
      expect(() => scope.read(1, 0)).toThrow(failure); expect(() => scope.read(1, 0)).toThrow(failure)
      expect(scope.read(1, 0)).toEqual(block)
      if (mode === 'off') expect(scope.read(1, 0)).toBe(block)
      else expect(scope.read(1, 0)).toBe(scope.read(1, 0))
      expect(scope.profile.failures).toBe(2)
      scope.end()
      const ordinary = new GlobalRawBlockResearch(mode).beginSearch('range')
      expect(() => ordinary.read(1, -1)).toThrow('RNG block index')
      expect(() => ordinary.read(1, -1)).toThrow('RNG block index')
      expect(ordinary.profile).toMatchObject({ failures: 2, hits: 0, misses: 2 })
      ordinary.end()
    }
  })

  it('uses the effective gate block, still derives seeds and draws Reset and each Keep layout separately', () => {
    const scope = new GlobalRawBlockResearch('per-search').beginSearch('gate')
    const v = gameVerifiedGogmaResetVectors[0]
    for (const gogmaCounter of [55, 56]) {
      const input = { ...v, counterGate: 0, gogmaCounter }
      expect(predictProductionGogmaReset(input, scope.read)).toEqual(predictProductionGogmaReset(input))
    }
    expect(scope.profile).toMatchObject({ requests: 2, uniqueBlocks: 1, hits: 1, maxBlockIndex: 0 })
    expect(predictProductionGogmaReset(v, scope.read)).toEqual(predictProductionGogmaReset(v))
    expect(scope.profile.uniqueBlocks).toBe(2)
    expect(() => predictProductionGogmaReset({ ...v, baseSeed: -1 }, scope.read)).toThrow()
    const keep = gameVerifiedGogmaKeepVector
    const variants = [keep.currentBonuses, [...keep.currentBonuses].reverse() as RestorationBonusSet,
      keep.currentBonuses.map(() => ({ bonusTypeId: 'bonus_type.attack', bonusRankId: 'bonus_rank.ii' })) as RestorationBonusSet]
    const results = variants.map(currentBonuses => {
      const input = { ...keep, currentBonuses }
      const result = predictReferenceGogmaKeep(input, scope.read)
      expect(result).toEqual(predictReferenceGogmaKeep(input))
      return result
    })
    expect(results[0]).not.toEqual(results[2])
    expect(scope.profile.hits).toBeGreaterThanOrEqual(3)
    const count = scope.profile.requests
    expect(() => scope.engine.predictGogmaBonus({ ...v, weaponTypeId: 'weapon.unknown', baseSeed: String(v.baseSeed), master: master(), operation: { type: 'reset_bonuses' } })).toThrow()
    expect(scope.profile.requests).toBe(count)
    scope.end()
  })

  it('preserves complete Search results, work, identity and prediction count; only raw misses fall', async () => {
    const input = fixture(), results = []
    for (const mode of ['off', 'per-search'] as const) {
      const scope = new GlobalRawBlockResearch(mode, readReferenceRngBlock, () => 0).beginSearch('search')
      const observed = new GlobalSearchProfiler().begin(scope.engine, { now: () => GLOBAL_RESEARCH_TIME, nowMs: () => 0 }, () => 0)
      const result = await searchCandidates(input, observed.engine, observed.execution)
      results.push({ result, profile: observed.profile, raw: scope.profile }); scope.end()
    }
    expect(results[0].result.targetResult.candidate).not.toBeNull()
    expect(results[1].result).toEqual(results[0].result)
    expect(results[1].profile).toEqual(results[0].profile)
    expect(results[1].raw.requests).toBe(results[0].raw.requests)
    expect(results[1].raw.hits).toBeGreaterThan(0)
    expect(results[1].raw.misses).toBeLessThan(results[0].raw.misses)
  })

  it('preserves synthetic Global generated Entries, Plan, statuses and uncached Trace Replay', async () => {
    const search = fixture(), engine = new ProductionRngEngine()
    const entries = []
    for (const target of search.targetWeapons) {
      const result = await searchCandidates({ ...search, targetWeaponId: target.id }, engine, { now: () => GLOBAL_RESEARCH_TIME })
      entries.push(createBuildListEntry(result.targetResult.candidate!, target, { createdAt: GLOBAL_RESEARCH_TIME }))
    }
    const input = { ...search, buildListEntries: entries, conflictResolutions: [], options: { maxPlanSteps: 1000 } }
    const run = (mode: 'off' | 'per-search' | 'run') => runGlobalPlannerResearch(input, globalResearchDependencies(new ProductionRngEngine()),
      { extent: search.settings, nowMs: () => 0, rawBlocks: new GlobalRawBlockResearch(mode) })
    const off = await run('off'), cached = await run('per-search')
    expect(cached).toEqual(off)
    expect(await run('run')).toEqual(off)
    expect(off.generatedEntries.length, JSON.stringify(off.report)).toBeGreaterThan(0)
    expect(off.report.final?.traceReplay).toBe('passed')
    for (const mode of ['off', 'per-search'] as const) {
      const explicit = await runGlobalPlannerResearch(input, globalResearchDependencies(new ProductionRngEngine()), {
        extent: search.settings, nowMs: () => 0, rawBlocks: new GlobalRawBlockResearch(mode),
        attempt: { retainedEntryIds: off.report.retainedOriginalEntryIds, pendingTargetIds: off.report.searches.map(s => s.targetId) },
      })
      expect(explicit).toEqual(off)
    }
  })

  it('keeps cancellation and deadline classifications on the existing Search checkpoint', async () => {
    for (const mode of ['off', 'per-search', 'run'] as const) {
      const input = fixture(), rawBlocks = new GlobalRawBlockResearch(mode)
      let yields = 0
      const result = await runGlobalResearchFocus(input, new ProductionRngEngine(), { rawBlocks, timeBudgetMs: 1000, nowMs: () => 0,
        yieldControl: async () => { yields++ }, shouldCancel: () => yields >= 1 })
      expect(result.status).toBe('cancelled')
      expect(result.profile.yieldCount).toBe(1)
      expect((await runGlobalResearchFocus(input, new ProductionRngEngine(), { rawBlocks, timeBudgetMs: 0, nowMs: () => 0 })).status).toBe('time_budget_reached')
    }
  })

  it('shares run blocks across Searches, preserves results under eviction, and disposes the run', async () => {
    const input = fixture(), research = new GlobalRawBlockResearch('run', readReferenceRngBlock, () => 0, 2)
    const a = research.beginSearch('first'), value = a.read(1, 0); a.end()
    const b = research.beginSearch('second')
    expect(b.read(1, 0)).toBe(value)
    expect(b.profile.hits).toBe(1)
    b.read(1, 1); b.read(2, 0)
    expect(b.read(1, 0)).toEqual(value)
    expect(b.profile.evictions).toBe(2)
    b.end()
    const options = { now: () => GLOBAL_RESEARCH_TIME, nowMs: () => 0 }
    const plain = await searchCandidates(input, new ProductionRngEngine(), options)
    for (let i = 0; i < 2; i++) {
      const scope = research.beginSearch(`search-${i}`)
      expect(await searchCandidates(input, scope.engine, options)).toEqual(plain)
      scope.end()
    }
    expect(research.summary().peakEntries).toBe(2)
    research.endRun()
    expect(() => research.beginSearch('after')).toThrow('run has ended')
    const fresh = new GlobalRawBlockResearch('run').beginSearch('fresh')
    fresh.read(1, 0); expect(fresh.profile.hits).toBe(0); fresh.end()
  })
})
