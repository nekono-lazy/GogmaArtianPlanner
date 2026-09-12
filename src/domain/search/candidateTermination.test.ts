import * as streamSolutions from './streamSolutions'
import * as routeShared from './routeSearchShared'
import { SearchWorkQueue } from './searchWorkQueue'
import { TargetSearchScheduler } from './targetSearchScheduler'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCandidateSearchEngine, createCandidateSearchInput, practicalOnlyBonuses, SEARCH_FIXTURE_TIME, candidatesOf } from '../../test/fixtures/candidateSearch'
import { candidateId, ownedWeaponId } from '../../test/fixtures/domainData'
import type { BuildCandidate, OwnedGogmaArtianWeapon, RestorationBonusSet } from '../models/publicTypes'
import { searchCandidates } from './candidateSearch'
import { candidateStableKey, deduplicateCandidates } from './candidateProcessing'
import { createTargetSkillStream } from './skillStream'
import { createTargetBonusStream } from './bonusStream'
import {
  bonusStreamInputForSearch,
  skillStreamInputForSearch,
} from './searchStreamInputs'
import { createSearchExecutionContext } from './searchExecution'
import { createSearchPredictionSupport, type RouteSearchContext } from './routeSearchShared'
import { searchNormalArtianRoutes } from './normalArtianRouteSearch'
import { searchOwnedNormalArtianRoutes } from './ownedNormalArtianRouteSearch'
import { searchExistingGogmaRoutes } from './existingGogmaRouteSearch'
import { selectCanonicalIdealCandidate } from './candidateRetention'
import { gogmaKeepFamilyLayoutKey } from '../rng/gogmaBonusFamily'

function fixture(ideal = true, bound = 100) {
  const input = createCandidateSearchInput()
  input.settings = { ...input.settings, maxNormalAdvance: bound, maxGogmaAdvance: bound, maxSkillAdvance: bound }
  input.ownedWeapons[0].restorationBonusScope = 'gogma_artian'
  input.ownedWeapons[0].restorationBonuses = practicalOnlyBonuses()
  input.ownedWeapons[0].isProtected = false
  input.ownedWeapons[0].seriesSkillId = 'series.other'
  const engine = createCandidateSearchEngine(input, { keepSupported: true })
  const calls: string[] = []
  vi.spyOn(engine, 'predictNormalArtian').mockImplementation(({ normalCounter }) => {
    calls.push('normal:' + normalCounter)
    return practicalOnlyBonuses()
  })
  vi.spyOn(engine, 'predictSkills').mockImplementation(({ skillCounter }) => {
    calls.push('skill:' + skillCounter)
    return { seriesSkillId: ideal && skillCounter === 8 ? 'series_skill.fixture.a' : 'series.other.' + skillCounter, groupSkillId: 'group_skill.fixture.a' }
  })
  vi.spyOn(engine, 'predictGogmaBonus').mockImplementation(({ gogmaCounter, operation }) => {
    calls.push(operation.type + ':' + gogmaCounter + (operation.type === 'keep_bonuses' ? ':' + gogmaKeepFamilyLayoutKey(operation.currentBonuses) : ''))
    if (operation.type === 'reset_bonuses' && gogmaCounter === 10) return structuredClone(input.targetWeapons[0].idealBonuses)
    return practicalOnlyBonuses()
  })
  vi.spyOn(engine, 'advanceNormalCounter').mockImplementation((counter, operation) => counter + operation.count)
  vi.spyOn(engine, 'advanceSkillCounter').mockImplementation((counter) => counter + 1)
  vi.spyOn(engine, 'advanceGogmaCounter').mockImplementation((counter) => counter + 1)
  return { input, engine, calls }
}
const options = { now: () => SEARCH_FIXTURE_TIME, nowMs: () => 0 }
const keys = (candidates: BuildCandidate[]) => candidates.map(candidateStableKey).sort()

afterEach(() => vi.restoreAllMocks())

describe('B4 actual Target-wide termination', () => {
  it.each([100, 5000])('B5-F1 continues past Normal-scope D=2 to Gogma-scope Ideal D=3 at bound %i', async (bound) => {
    const { input, engine } = fixture(true, bound)
    input.routeFilter = 'normal_artian'
    input.ownedWeapons = []
    const idealBonuses = structuredClone(input.targetWeapons[0].idealBonuses)
    vi.mocked(engine.predictNormalArtian).mockReturnValue(idealBonuses)
    vi.mocked(engine.predictSkills).mockReturnValue({ seriesSkillId: 'series_skill.fixture.a', groupSkillId: null })
    const result = await searchCandidates(input, engine, options)
    const candidates = candidatesOf(result.targetResult)
    expect(candidates.find((c) => c.estimatedOperationCount === 2)).toBeUndefined()
    // Every returned Candidate is the canonical Ideal, so a Normal-scope D=2
    // result is not returned at all (`docs/SEARCH_SPEC.md` 5.5.4).
    const ideals = candidates
    expect(ideals).toHaveLength(1)
    expect(ideals[0]).toMatchObject({
      restorationBonusScope: 'gogma_artian', finalBonuses: idealBonuses,
      estimatedOperationCount: 3, estimatedGogmaAdvance: 1,
      estimatedSkillAdvance: 1, estimatedNormalAdvance: 1,
    })
    expect(ideals[0].route.operations.map((op) => op.type))
      .toEqual(['create_normal_artian', 'convert_normal_to_gogma', 'reset_bonuses'])
    expect(engine.predictGogmaBonus).toHaveBeenCalledTimes(1)
    expect(engine.predictGogmaBonus).toHaveBeenCalledWith(expect.objectContaining({
      gogmaCounter: 10, operation: { type: 'reset_bonuses' },
    }))
    expect(engine.predictSkills).toHaveBeenCalledTimes(1) // Conversion only: independent Skill shortcut.
    expect(candidates.every((c) => c.estimatedOperationCount <= 3)).toBe(true)
  })

  it('B5-F1 resets an existing normal-scope Gogma with exact Ideal labels and Skills', async () => {
    const { input, engine } = fixture(true, 5000)
    input.routeFilter = 'existing_gogma'
    const source = input.ownedWeapons[0] as OwnedGogmaArtianWeapon
    source.restorationBonusScope = 'normal_artian'
    source.restorationBonuses = structuredClone(input.targetWeapons[0].idealBonuses)
    source.seriesSkillId = 'series_skill.fixture.a'
    const result = await searchCandidates(input, engine, options)
    expect(candidatesOf(result.targetResult)).toHaveLength(1)
    expect(candidatesOf(result.targetResult)[0]).toMatchObject({
      restorationBonusScope: 'gogma_artian', estimatedOperationCount: 1,
      route: { kind: 'existing_gogma_reset_bonuses', sourceOwnedWeaponId: source.id },
    })
    expect(engine.predictGogmaBonus).toHaveBeenCalledTimes(1)
    expect(engine.predictGogmaBonus).toHaveBeenCalledWith(expect.objectContaining({
      operation: { type: 'reset_bonuses' },
    }))
    expect(engine.predictSkills).not.toHaveBeenCalled()
  })

  it.each([100, 5000])('settles D=3 without eagerly predicting configured %i bounds', async (bound) => {
    const { input, engine, calls } = fixture(true, bound)
    const result = await searchCandidates(input, engine, options)
    const candidates = candidatesOf(result.targetResult)
    expect(candidates).toHaveLength(1)
    expect(candidates[0].estimatedOperationCount).toBe(3)
    expect(engine.predictNormalArtian).toHaveBeenCalledTimes(2)
    expect(engine.predictSkills).toHaveBeenCalledTimes(3)
    expect(calls.filter((call) => call.startsWith('reset_bonuses:'))).toEqual(['reset_bonuses:10', 'reset_bonuses:11', 'reset_bonuses:12'])
    expect(new Set(calls).size).toBe(calls.length)
    expect(candidates.every((c) => c.estimatedOperationCount <= 3)).toBe(true)
    expect(calls.filter((call) => call.startsWith('keep_bonuses:'))).toHaveLength(4)
  })

  it('exhausts configured positions when no Ideal exists, preserving one prediction per key', async () => {
    const { input, engine, calls } = fixture(false, 4)
    const result = await searchCandidates(input, engine, options)
    // No Ideal inside the configured extent means no Candidate at all: a
    // compromise state found on the way is never returned, because only a
    // strict prefix of a real Ideal Route can be one (SEARCH_SPEC 5.7).
    expect(candidatesOf(result.targetResult)).toEqual([])
    expect(engine.predictNormalArtian).toHaveBeenCalledTimes(4)
    expect(engine.predictSkills).toHaveBeenCalledTimes(5) // conversion S plus M Reset positions
    expect(calls.filter((call) => call.startsWith('reset_bonuses:'))).toEqual(['reset_bonuses:10', 'reset_bonuses:11', 'reset_bonuses:12', 'reset_bonuses:13'])
    expect(new Set(calls).size).toBe(calls.length)
  })

  it('has an identical Prediction sequence and canonical Ideal across repeated runs', async () => {
    // There is no result filter and no output cap left to vary, so the only
    // thing a repeated run may differ in is its run-dependent identity.
    const reference = fixture()
    const all = await searchCandidates(reference.input, reference.engine, options)
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const run = fixture()
      run.input.searchRunId = `rerun-${attempt}`
      const result = await searchCandidates(run.input, run.engine, options)
      expect(run.calls).toEqual(reference.calls)
      expect(keys(candidatesOf(result.targetResult)))
        .toEqual(keys(candidatesOf(all.targetResult)))
    }
  })

  it('is independent of source order, Normal counter order, run, IDs and clock', async () => {
    const run = async (reverse: boolean) => {
      const { input, engine } = fixture()
      const source = input.ownedWeapons[0] as OwnedGogmaArtianWeapon
      input.ownedWeapons.push({ ...structuredClone(source), id: ownedWeaponId('owned.other') })
      input.normalCounters.push({ ...input.normalCounters[0], id: 'counter.other', counter: 20 })
      if (reverse) {
        input.ownedWeapons.reverse()
        input.normalCounters.reverse()
        input.searchRunId = 'other-run'
      }
      let serial = 0
      const result = await searchCandidates(input, engine, { ...options,
        now: () => reverse ? '2026-09-05T00:00:00.000Z' : SEARCH_FIXTURE_TIME,
        createCandidateId: () => candidateId(String(reverse ? 1000 - serial++ : serial++)),
      })
      return keys(candidatesOf(result.targetResult))
    }
    expect(await run(true)).toEqual(await run(false))
  })

  it('keeps the ordered output identical when only searchRunId, IDs and the clock change', async () => {
    // B6-F1: `compareCandidates()` ties on `candidateStableKey`, not on
    // `BuildCandidate.id`, whose `semanticHash` folds in `searchRunId`.
    const run = async (second: boolean) => {
      const { input, engine } = fixture()
      if (second) input.searchRunId = 'determinism-b'
      let serial = 0
      const result = await searchCandidates(input, engine, {
        ...options,
        now: () => (second ? '2026-09-05T00:00:00.000Z' : SEARCH_FIXTURE_TIME),
        createCandidateId: () => candidateId(String(second ? 1000 - serial++ : serial++)),
      })
      return candidatesOf(result.targetResult)
    }
    const first = await run(false)
    const second = await run(true)
    expect(first).toHaveLength(1)
    // The one canonical Ideal is identical, not merely equivalent.
    expect(second.map(candidateStableKey)).toEqual(first.map(candidateStableKey))
    // Only the ordering was fixed; run-dependent identity still differs.
    expect(second.map(({ id }) => id)).not.toEqual(first.map(({ id }) => id))
  })

  it('settles the same set with Ideal-producing RouteKinds evaluated first or last', async () => {
    async function run(reverse: boolean) {
      const { input, engine, calls } = fixture(true, 5)
      const execution = createSearchExecutionContext(options)
      const target = input.targetWeapons[0]
      const support = createSearchPredictionSupport(engine, target, input.master)
      const context: RouteSearchContext = { target, input, engine, execution, predictionSupport: support,
        skillStream: createTargetSkillStream(target, skillStreamInputForSearch(input), engine, execution, () => true),
        bonusStream: createTargetBonusStream(target, bonusStreamInputForSearch(input), engine, execution, support),
        normalPredictions: new Map<number, RestorationBonusSet>() }
      const searchers = [searchNormalArtianRoutes, searchOwnedNormalArtianRoutes, searchExistingGogmaRoutes]
      if (reverse) searchers.reverse()
      const scheduler = new TargetSearchScheduler(context)
      const results = []
      for (const search of searchers) results.push(await search(context, scheduler))
      await scheduler.run()
      const candidates = results.flatMap((result) => result.candidates)
      const canonical = selectCanonicalIdealCandidate(candidates)
      return { candidates: canonical === null ? [] : [canonical], calls }
    }
    const first = await run(false)
    const last = await run(true)
    expect(keys(first.candidates)).toEqual(keys(last.candidates))
    expect([...first.calls].sort()).toEqual([...last.calls].sort())
  })

  it('agrees with exhaustive configured Cross evaluation inside the settled horizon', async () => {
    const { input, engine } = fixture(true, 4)
    const bounded = await searchCandidates(input, engine, options)
    const full = fixture(true, 4)
    const execution = createSearchExecutionContext(options)
    const target = full.input.targetWeapons[0]
    const support = createSearchPredictionSupport(full.engine, target, full.input.master)
    const context: RouteSearchContext = { target, input: full.input, engine: full.engine, execution, predictionSupport: support,
      skillStream: createTargetSkillStream(target, skillStreamInputForSearch(full.input), full.engine, execution, () => true),
      bonusStream: createTargetBonusStream(target, bonusStreamInputForSearch(full.input), full.engine, execution, support) }
    const scheduler = new TargetSearchScheduler(context)
    const results = []
    for (const search of [searchNormalArtianRoutes, searchOwnedNormalArtianRoutes, searchExistingGogmaRoutes]) {
      results.push(await search(context, scheduler))
    }
    await scheduler.run(false)
    expect(scheduler.queue.pendingCount).toBe(0)
    const candidates = results.flatMap((result) => result.candidates)
    const canonical = selectCanonicalIdealCandidate(deduplicateCandidates(candidates))
    expect(keys(candidatesOf(bounded.targetResult)))
      .toEqual(keys(canonical === null ? [] : [canonical]))
  })
})

describe('B4 delta scheduler: semantic work, not Prediction memo counts', () => {
  it('registers Normal offsets 0..3 once and evaluates only new stream depths and Cross pairs', async () => {
    const { input, engine } = fixture(false, 4)
    input.routeFilter = 'normal_artian'
    input.ownedWeapons = []
    const bases = vi.spyOn(TargetSearchScheduler.prototype, 'addBase')
    const skillSets = vi.spyOn(streamSolutions, 'buildSkillSolutionSet')
    const bonusSets = vi.spyOn(streamSolutions, 'buildBonusSolutionSet')
    const compositions = vi.spyOn(routeShared, 'createBaseCandidate')
    const steps = vi.spyOn(SearchWorkQueue.prototype, 'settleNext')
    await searchCandidates(input, engine, options)

    expect(bases.mock.calls.map(([base]) => base.baseOperations[0]))
      .toEqual([1, 2, 3, 4].map((count) => expect.objectContaining({ type: 'create_normal_artian', count })))
    const skillDepths = skillSets.mock.calls.map(([, solutions]) => solutions.map((s) => s.resetCount))
    expect(skillDepths.filter((depths) => depths[0] > 0)).toEqual([[1], [2], [3], [4]])
    expect(skillDepths.filter((depths) => depths[0] === 0)).toHaveLength(4)
    const bonusDepths = bonusSets.mock.calls.map(([, , solutions]) => solutions.map((s) => s.gogmaAdvance))
      .filter((depths) => depths[0] > 0)
    expect(bonusDepths.map((depths) => [...new Set(depths)])).toEqual([[1], [2], [3], [4]])
    // Memo cannot hide duplicate Candidate evaluator calls or base registration.
    const evaluated = compositions.mock.calls.map(([, bonuses, scope, series, group, route]) =>
      JSON.stringify({ bonuses, scope, series, group, route }))
    expect(new Set(evaluated).size).toBe(evaluated.length)
    // This fixture reaches no Ideal Skill, so the Ideal Skill axis is empty and
    // the Cross rule composes nothing at all. The delta scheduling above still
    // registered every base once and read every new stream depth exactly once:
    // composition work is what an unreachable Ideal removes, not stream work.
    expect(evaluated).toEqual([])
    expect((steps.mock.contexts[0] as SearchWorkQueue).pendingCount).toBe(0)
  })

  it.each([100, 5000])('does zero scheduler steps with no compatible source at bound %i', async (bound) => {
    const { input, engine } = fixture(false, bound)
    input.routeFilter = 'existing_gogma'
    input.ownedWeapons = []
    const steps = vi.spyOn(SearchWorkQueue.prototype, 'settleNext')
    const shouldCancel = vi.fn(() => false)
    const result = await searchCandidates(input, engine, { ...options, shouldCancel })
    expect(steps).not.toHaveBeenCalled()
    expect(shouldCancel).toHaveBeenCalledTimes(1) // Target entry only.
    expect(candidatesOf(result.targetResult)).toEqual([])
    expect(engine.predictSkills).not.toHaveBeenCalled()
    expect(engine.predictGogmaBonus).not.toHaveBeenCalled()
  })

  it('exhausts d=0/k=0 current Ideal after generating one current-state Candidate', async () => {
    const { input, engine } = fixture(true, 5000)
    input.routeFilter = 'existing_gogma'
    const source = input.ownedWeapons[0] as OwnedGogmaArtianWeapon
    source.restorationBonuses = structuredClone(input.targetWeapons[0].idealBonuses)
    source.seriesSkillId = 'series_skill.fixture.a'
    const steps = vi.spyOn(SearchWorkQueue.prototype, 'settleNext')
    const compositions = vi.spyOn(routeShared, 'createBaseCandidate')
    const shouldCancel = vi.fn(() => false)
    const result = await searchCandidates(input, engine, { ...options, shouldCancel })
    expect(steps).toHaveBeenCalledTimes(1)
    expect(compositions).toHaveBeenCalledTimes(1)
    expect(candidatesOf(result.targetResult)).toHaveLength(1)
    expect(candidatesOf(result.targetResult)[0].route.kind).toBe('existing_gogma_current')
    expect(engine.predictSkills).not.toHaveBeenCalled()
    expect(engine.predictGogmaBonus).not.toHaveBeenCalled()
  })

  it('exhausts unsupported active input after one attempt, without empty future layers', async () => {
    const { input, engine } = fixture(false, 5000)
    input.routeFilter = 'existing_gogma'
    input.rngState.skillCounter.isConfirmed = false
    vi.spyOn(engine, 'getPredictionSupport').mockReturnValue({ supported: false, reason: 'master_data_unavailable' })
    const steps = vi.spyOn(SearchWorkQueue.prototype, 'settleNext')
    const result = await searchCandidates(input, engine, options)
    expect(steps).toHaveBeenCalledTimes(1) // Bonus support check exhausts the frontier.
    expect((steps.mock.contexts[0] as SearchWorkQueue).pendingCount).toBe(0)
    expect(candidatesOf(result.targetResult)).toEqual([])
    expect(engine.predictSkills).not.toHaveBeenCalled()
    expect(engine.predictGogmaBonus).not.toHaveBeenCalled()
  })

  it('returns exactly the canonical Ideal and reports no truncation concept', async () => {
    const reference = fixture()
    const all = await searchCandidates(reference.input, reference.engine, options)
    expect(candidatesOf(all.targetResult)).toHaveLength(1)
    // `isTruncated` only ever meant "the output cap omitted a Candidate", and
    // the cap is gone (`docs/SEARCH_SPEC.md` 4.2).
    expect((all as unknown as Record<string, unknown>).isTruncated).toBeUndefined()
  })
})
