import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  OwnedGogmaArtianWeapon,
  OwnedNormalArtianWeapon,
  OwnedWeapon,
  OwnedWeaponId,
  RestorationBonusSet,
} from '../models/publicTypes'
import type { RngEngine } from '../rng/rngEngine'
import { createBuildCandidateMeaningFingerprint } from '../buildList'
import { candidateDeduplicationKey, candidateStableKey } from './candidateProcessing'
import { searchCandidates } from './candidateSearch'
import { assertCandidateSearchInput } from './searchValidation'
import { CandidateSearchError, type CandidateRouteFilter, type CandidateSearchInput } from './searchTypes'
import { TargetSearchScheduler } from './targetSearchScheduler'
import {
  belowPracticalBonuses,
  createCandidateSearchEngine,
  createCandidateSearchInput,
  SEARCH_FIXTURE_TIME,
} from '../../test/fixtures/candidateSearch'
import {
  createRestorationBonusSet,
  createValidOwnedWeapon,
  ownedWeaponId,
} from '../../test/fixtures/domainData'

/*
 * Issue #157 PR-2 (`docs/SEARCH_SPEC.md` 3.3 / 13.7): the ordinary Candidate
 * Search request's `excludedSourceOwnedWeaponIds`. The exclusion removes owned
 * weapons from Route base enumeration, before any base or prediction exists for
 * them; without it the Search is exactly the Search it was.
 */

const deterministicExecution = {
  now: () => SEARCH_FIXTURE_TIME,
  nowMs: () => 100,
}

const LOW = 'bonus_rank.fixture.low'
const ATTACK = 'bonus_type.fixture.attack'
const ELEMENT = 'bonus_type.fixture.element'
const UTILITY = 'bonus_type.fixture.utility'
const SHARPNESS = 'bonus_type.fixture.sharpness'

/** Five low-rank slots: below Practical, so a Route base keeps searching. */
function slots(...types: [string, string, string, string, string]): RestorationBonusSet {
  return types.map((bonusTypeId) => ({ bonusTypeId, bonusRankId: LOW })) as RestorationBonusSet
}

/** Four family layouts distinct from each other and from the new Normal's. */
const LAYOUT_A = slots(ATTACK, ELEMENT, UTILITY, SHARPNESS, ATTACK)
const LAYOUT_B = slots(ELEMENT, ATTACK, UTILITY, SHARPNESS, ATTACK)
const LAYOUT_C = slots(UTILITY, ATTACK, ELEMENT, SHARPNESS, ATTACK)
const LAYOUT_D = slots(SHARPNESS, ATTACK, ELEMENT, UTILITY, ATTACK)

function layoutKey(bonuses: readonly { bonusTypeId: string }[]): string {
  return bonuses.map(({ bonusTypeId }) => bonusTypeId).join('|')
}

function gogma(
  id: string,
  bonuses: RestorationBonusSet,
  overrides: Partial<OwnedGogmaArtianWeapon> = {},
): OwnedGogmaArtianWeapon {
  return {
    ...createValidOwnedWeapon(ownedWeaponId(id)),
    restorationBonuses: bonuses,
    seriesSkillId: 'series_skill.fixture.other',
    groupSkillId: null,
    status: 'unclassified',
    isProtected: false,
    ...overrides,
  }
}

/** A Gogma that already is the fixture Target's Ideal: a zero-operation Candidate. */
function idealGogma(id: string, overrides: Partial<OwnedGogmaArtianWeapon> = {}): OwnedGogmaArtianWeapon {
  return gogma(id, createRestorationBonusSet(), { seriesSkillId: 'series_skill.fixture.a', ...overrides })
}

function normal(
  id: string,
  bonuses: RestorationBonusSet,
  overrides: Partial<OwnedNormalArtianWeapon> = {},
): OwnedNormalArtianWeapon {
  return {
    ...createValidOwnedWeapon(ownedWeaponId(id)),
    kind: 'normal',
    rarity: 8,
    restorationBonuses: bonuses,
    restorationBonusScope: 'normal_artian',
    seriesSkillId: null,
    groupSkillId: null,
    status: null,
    isProtected: false,
    ...overrides,
  }
}

function scenarioInput(
  ownedWeapons: OwnedWeapon[],
  routeFilter: CandidateRouteFilter = 'all',
  excludedSourceOwnedWeaponIds?: string[],
): CandidateSearchInput {
  const input = createCandidateSearchInput()
  input.routeFilter = routeFilter
  input.ownedWeapons = ownedWeapons
  if (excludedSourceOwnedWeaponIds !== undefined) {
    input.excludedSourceOwnedWeaponIds = excludedSourceOwnedWeaponIds.map(ownedWeaponId)
  }
  return input
}

/**
 * A deterministic Engine for any number of sources: nothing it predicts is
 * Ideal (Skills are never the Ideal Skill, every Bonus result is low rank), so
 * with no owned Ideal the Search settles every base it registered.
 */
function scenarioEngine(input: CandidateSearchInput): RngEngine {
  return {
    version: input.calculationContext.rngEngineVersion,
    capabilities: {
      supportsNormalArtianPrediction: true,
      supportsGogmaPrediction: true,
      supportsSkillPrediction: true,
      supportsKeepBonusesPrediction: true,
    },
    getPredictionSupport: () => ({ supported: true }),
    normalizeSeed: (seed) => seed,
    predictNormalArtian: () => belowPracticalBonuses(),
    predictSkills: () => ({ seriesSkillId: 'series_skill.fixture.other', groupSkillId: null }),
    // Keep keeps each slot's family and only rerolls its tier.
    predictGogmaBonus: ({ operation }) => operation.type === 'reset_bonuses'
      ? belowPracticalBonuses()
      : slots(...(operation.currentBonuses.map(({ bonusTypeId }) => bonusTypeId) as [string, string, string, string, string])),
    advanceGogmaCounter: (current) => current + 1,
    advanceSkillCounter: (current) => current + 1,
    advanceNormalCounter: (current, operation) => current + operation.count,
  }
}

/** Records every prediction call, in call order, without changing the delegate. */
function logged(engine: RngEngine): { engine: RngEngine; calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    engine: {
      version: engine.version,
      capabilities: engine.capabilities,
      getPredictionSupport: engine.getPredictionSupport.bind(engine),
      normalizeSeed: engine.normalizeSeed.bind(engine),
      predictNormalArtian: (prediction) => {
        calls.push(`normal:${prediction.normalCounter}`)
        return engine.predictNormalArtian(prediction)
      },
      predictSkills: (prediction) => {
        calls.push(`skill:${prediction.skillCounter}`)
        return engine.predictSkills(prediction)
      },
      predictGogmaBonus: (prediction) => {
        calls.push(prediction.operation.type === 'reset_bonuses'
          ? `reset:${prediction.gogmaCounter}`
          : `keep:${prediction.gogmaCounter}:${layoutKey(prediction.operation.currentBonuses)}`)
        return engine.predictGogmaBonus(prediction)
      },
      advanceGogmaCounter: engine.advanceGogmaCounter.bind(engine),
      advanceSkillCounter: engine.advanceSkillCounter.bind(engine),
      advanceNormalCounter: engine.advanceNormalCounter.bind(engine),
    },
  }
}

async function run(input: CandidateSearchInput, createEngine: (input: CandidateSearchInput) => RngEngine = scenarioEngine) {
  const { engine, calls } = logged(createEngine(input))
  const addBase = vi.spyOn(TargetSearchScheduler.prototype, 'addBase')
  try {
    const result = await searchCandidates(input, engine, deterministicExecution)
    return {
      result,
      calls,
      baseSources: addBase.mock.calls.map(([base]) => base.sourceOwnedWeaponId),
    }
  } finally {
    addBase.mockRestore()
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

const N1 = 'owned.normal.1'
const N2 = 'owned.normal.2'
const G1 = 'owned.gogma.1'
const G2 = 'owned.gogma.2'

function mixedSources(): OwnedWeapon[] {
  return [normal(N1, LAYOUT_A), normal(N2, LAYOUT_B), gogma(G1, LAYOUT_C), gogma(G2, LAYOUT_D)]
}

describe('source exclusion: an absent field and [] are the unexcluded Search', () => {
  const scenarios: Array<{ name: string; input: () => CandidateSearchInput; engine?: (input: CandidateSearchInput) => RngEngine }> = [
    { name: 'every source kind, nothing Ideal', input: () => scenarioInput(mixedSources()) },
    { name: 'an owned zero-operation Ideal beside the other sources', input: () => scenarioInput([...mixedSources(), idealGogma('owned.gogma.ideal')]) },
    { name: 'the shared fixture, all routes', input: () => scenarioInput(createCandidateSearchInput().ownedWeapons), engine: (input) => createCandidateSearchEngine(input) },
    {
      name: 'the shared fixture, Normal routes, blind Normal',
      input: () => {
        const input = scenarioInput(createCandidateSearchInput().ownedWeapons, 'normal_artian')
        input.normalCounters[0] = { ...input.normalCounters[0], counter: null, isConfirmed: false }
        return input
      },
      engine: (input) => createCandidateSearchEngine(input, { resetResult: createRestorationBonusSet() }),
    },
    { name: 'the shared fixture, existing Gogma routes', input: () => scenarioInput(createCandidateSearchInput().ownedWeapons, 'existing_gogma'), engine: (input) => createCandidateSearchEngine(input) },
  ]

  it.each(scenarios)('$name', async ({ input, engine }) => {
    const absent = await run(input(), engine)
    const emptyInput = input()
    emptyInput.excludedSourceOwnedWeaponIds = []
    const empty = await run(emptyInput, engine)

    expect('excludedSourceOwnedWeaponIds' in input()).toBe(false)
    // The whole result: Candidate (identity, hashes, intermediate states), the
    // canonical choice, searchedRoutes, skippedRoutes and warnings.
    expect(empty.result).toEqual(absent.result)
    expect(empty.result.targetResult.excludedSourceOwnedWeaponIds).toEqual([])
    expect(empty.result.targetResult.skippedRoutes.map(({ reason }) => reason))
      .not.toContain('source_excluded_for_other_targets')
    // The same predictions in the same order, and the same Route bases.
    expect(empty.calls).toEqual(absent.calls)
    expect(empty.baseSources).toEqual(absent.baseSources)
  })

  it('reports an exclusion that names no possible source here as no exclusion at all', async () => {
    // An incompatible weapon, an element mismatch and a protected owned Normal
    // can never be a source of this Target, so excluding them changes nothing.
    const owned = [
      ...mixedSources(),
      gogma('owned.gogma.other-type', LAYOUT_A, { weaponTypeId: 'weapon.fixture.b' }),
      normal('owned.normal.other-element', LAYOUT_A, { elementId: 'element.fixture.b' }),
      normal('owned.normal.protected', LAYOUT_A, { isProtected: true }),
    ]
    const off = await run(scenarioInput(owned))
    const on = await run(scenarioInput(owned, 'all', ['owned.gogma.other-type', 'owned.normal.other-element', 'owned.normal.protected']))
    expect(on.result).toEqual(off.result)
    expect(on.calls).toEqual(off.calls)
    expect(on.result.targetResult.excludedSourceOwnedWeaponIds).toEqual([])
  })
})

describe('source exclusion at Route base enumeration', () => {
  it('registers no base for an excluded owned Normal or Gogma and makes none of its predictions', async () => {
    const off = await run(scenarioInput(mixedSources()))
    const on = await run(scenarioInput(mixedSources(), 'all', [N1, G1]))

    expect(off.baseSources).toEqual(expect.arrayContaining([N1, N2, G1, G2, null]))
    expect(on.baseSources).not.toContain(N1)
    expect(on.baseSources).not.toContain(G1)
    expect(on.baseSources).toEqual(expect.arrayContaining([N2, G2, null]))

    // Without the exclusion both excluded weapons' own Keep streams run; with
    // it they never do, and every other prediction is exactly the same.
    const ownKeeps = [`keep:10:${layoutKey(LAYOUT_A)}`, `keep:10:${layoutKey(LAYOUT_C)}`]
    for (const call of ownKeeps) {
      expect(off.calls).toContain(call)
      expect(on.calls).not.toContain(call)
    }
    expect([...on.calls].sort()).toEqual(off.calls.filter((call) => !ownKeeps.includes(call)).sort())

    // Another source of each kind remains, so every RouteKind stays searched.
    expect(on.result.targetResult.searchedRoutes).toEqual(off.result.targetResult.searchedRoutes)
    expect(on.result.targetResult.skippedRoutes).toEqual(off.result.targetResult.skippedRoutes)
    expect(on.result.targetResult.excludedSourceOwnedWeaponIds).toEqual([G1, N1])
  })

  it('excludes the zero-operation current Route of a protected Gogma', async () => {
    const protectedIdeal = idealGogma('owned.gogma.protected', { isProtected: true })
    const off = await run(scenarioInput([protectedIdeal], 'existing_gogma'))
    const on = await run(scenarioInput([protectedIdeal], 'existing_gogma', [protectedIdeal.id]))

    expect(off.result.targetResult.candidate?.route).toMatchObject({ kind: 'existing_gogma_current', sourceOwnedWeaponId: protectedIdeal.id })
    expect(on.result.targetResult.candidate).toBeNull()
    expect(on.baseSources).toEqual([])
    expect(on.calls).toEqual([])
    expect(on.result.targetResult.searchedRoutes).toEqual([])
    expect(on.result.targetResult.skippedRoutes.filter(({ route }) => route.startsWith('existing_gogma'))).toEqual([
      { route: 'existing_gogma_current', reason: 'source_excluded_for_other_targets', detail: expect.any(String) },
      // A protected weapon was never an amendment source: the ordinary reason.
      ...['existing_gogma_reset_bonuses', 'existing_gogma_keep_bonuses', 'existing_gogma_reset_skills', 'existing_gogma_mixed']
        .map((route) => ({ route, reason: 'no_unprotected_source_weapon', detail: expect.any(String) })),
    ])
    expect(on.result.targetResult.excludedSourceOwnedWeaponIds).toEqual([protectedIdeal.id])
  })

  it('searches the protected current Route and skips the amendments when the excluded Gogma was the only unprotected one', async () => {
    const unprotectedSource = gogma('owned.gogma.unprotected', LAYOUT_C)
    const protectedSource = gogma('owned.gogma.protected', LAYOUT_D, { isProtected: true })
    const owned = [unprotectedSource, protectedSource]
    const off = await run(scenarioInput(owned, 'existing_gogma'))
    const on = await run(scenarioInput(owned, 'existing_gogma', [unprotectedSource.id]))

    expect(off.result.targetResult.searchedRoutes).toEqual(expect.arrayContaining(['existing_gogma_current', 'existing_gogma_reset_bonuses']))
    expect(on.result.targetResult.searchedRoutes).toEqual(['existing_gogma_current'])
    expect(on.result.targetResult.skippedRoutes.filter(({ route }) => route.startsWith('existing_gogma'))).toEqual(
      ['existing_gogma_reset_skills', 'existing_gogma_reset_bonuses', 'existing_gogma_keep_bonuses', 'existing_gogma_mixed']
        .map((route) => ({ route, reason: 'source_excluded_for_other_targets', detail: expect.any(String) })),
    )
    expect(on.baseSources).toEqual([protectedSource.id])
    // The remaining protected weapon opens no amendment stream.
    expect(on.calls).toEqual([])
    expect(on.result.targetResult.excludedSourceOwnedWeaponIds).toEqual([unprotectedSource.id])
  })

  it('keeps the ordinary reasons when the excluded Gogma was protected and another unprotected one remains', async () => {
    const protectedSource = gogma('owned.gogma.protected', LAYOUT_C, { isProtected: true })
    const unprotectedSource = gogma('owned.gogma.unprotected', LAYOUT_D)
    const owned = [protectedSource, unprotectedSource]
    const off = await run(scenarioInput(owned, 'existing_gogma'))
    const on = await run(scenarioInput(owned, 'existing_gogma', [protectedSource.id]))

    expect(on.result.targetResult.searchedRoutes).toEqual(off.result.targetResult.searchedRoutes)
    expect(on.result.targetResult.skippedRoutes).toEqual(off.result.targetResult.skippedRoutes)
    expect(on.calls).toEqual(off.calls)
    expect(on.baseSources).toEqual([unprotectedSource.id])
    expect(on.result.targetResult.excludedSourceOwnedWeaponIds).toEqual([protectedSource.id])
  })

  it.each([
    ['predicted', true],
    ['blind', false],
  ] as const)('skips the owned Normal route alone and keeps the %s new Normal route', async (_, normalCounterConfirmed) => {
    const make = (excluded?: string[]) => {
      const input = scenarioInput([normal(N1, LAYOUT_A)], 'normal_artian', excluded)
      if (!normalCounterConfirmed) input.normalCounters[0] = { ...input.normalCounters[0], counter: null, isConfirmed: false }
      return input
    }
    const off = await run(make())
    const on = await run(make([N1]))

    expect(off.result.targetResult.searchedRoutes).toEqual(['normal_artian_to_gogma', 'owned_normal_artian_to_gogma'])
    expect(on.result.targetResult.searchedRoutes).toEqual(['normal_artian_to_gogma'])
    expect(on.result.targetResult.skippedRoutes).toEqual([
      ...off.result.targetResult.skippedRoutes,
      { route: 'owned_normal_artian_to_gogma', reason: 'source_excluded_for_other_targets', detail: expect.any(String) },
    ])
    expect(on.baseSources).toEqual([null])
    expect(on.calls.some((call) => call.startsWith('normal:'))).toBe(normalCounterConfirmed)
    // The new Normal route makes exactly the predictions it made beside the
    // owned Normal; only the owned Normal's own Keep stream is gone.
    const ownKeep = `keep:10:${layoutKey(LAYOUT_A)}`
    expect(off.calls).toContain(ownKeep)
    expect([...on.calls].sort()).toEqual(off.calls.filter((call) => call !== ownKeep).sort())
    expect(on.result.warnings).toEqual(off.result.warnings)
    expect(on.result.targetResult.excludedSourceOwnedWeaponIds).toEqual([N1])
  })

  it('keeps the ordinary owned Normal reason when no convertible source existed', async () => {
    const protectedNormal = normal(N1, LAYOUT_A, { isProtected: true })
    const off = await run(scenarioInput([protectedNormal], 'normal_artian'))
    const on = await run(scenarioInput([protectedNormal], 'normal_artian', [N1]))
    expect(on.result).toEqual(off.result)
    expect(on.result.targetResult.skippedRoutes).toContainEqual(
      expect.objectContaining({ route: 'owned_normal_artian_to_gogma', reason: 'no_unprotected_source_weapon' }),
    )
    expect(on.result.targetResult.excludedSourceOwnedWeaponIds).toEqual([])
  })

  it('keeps no_owned_weapon_available when no compatible Gogma existed', async () => {
    const otherType = gogma('owned.gogma.other-type', LAYOUT_A, { weaponTypeId: 'weapon.fixture.b' })
    const off = await run(scenarioInput([otherType], 'existing_gogma'))
    const on = await run(scenarioInput([otherType], 'existing_gogma', [otherType.id]))
    expect(on.result).toEqual(off.result)
    expect(new Set(on.result.targetResult.skippedRoutes
      .filter(({ route }) => route.startsWith('existing_gogma'))
      .map(({ reason }) => reason))).toEqual(new Set(['no_owned_weapon_available']))
  })
})

describe('source exclusion and the canonical Ideal', () => {
  it('never falls back to the excluded weapon when nothing else reaches the Ideal', async () => {
    const only = idealGogma('owned.gogma.ideal')
    const off = await run(scenarioInput([only]))
    const on = await run(scenarioInput([only], 'all', [only.id]))

    expect(off.result.targetResult.candidate?.route.sourceOwnedWeaponId).toBe(only.id)
    expect(on.result.targetResult.candidate).toBeNull()
    expect(on.baseSources).not.toContain(only.id)
    expect(on.result.targetResult.searchedRoutes).toEqual(['normal_artian_to_gogma'])
    expect(on.result.targetResult.skippedRoutes.filter(({ route }) => route.startsWith('existing_gogma')))
      .toEqual(['existing_gogma_current', 'existing_gogma_reset_bonuses', 'existing_gogma_keep_bonuses', 'existing_gogma_reset_skills', 'existing_gogma_mixed']
        .map((route) => ({ route, reason: 'source_excluded_for_other_targets', detail: expect.any(String) })))
  })

  it('takes the Ideal from a remaining compatible source', async () => {
    const first = idealGogma('owned.gogma.a')
    const second = idealGogma('owned.gogma.b')
    const off = await run(scenarioInput([first, second]))
    const on = await run(scenarioInput([first, second], 'all', [first.id]))
    expect(off.result.targetResult.candidate?.route.sourceOwnedWeaponId).toBe(first.id)
    expect(on.result.targetResult.candidate?.route.sourceOwnedWeaponId).toBe(second.id)
  })

  it('searches when the Target\'s own preferred source is excluded, with every other tie-break unchanged', async () => {
    const preferred = idealGogma('owned.gogma.a')
    const other = idealGogma('owned.gogma.b')
    const prefer = (input: CandidateSearchInput) => {
      input.targetWeapons[0] = { ...input.targetWeapons[0], preferredOwnedWeaponId: preferred.id }
      return input
    }
    const offPreferred = await run(prefer(scenarioInput([other, preferred])))
    const onPreferred = await run(prefer(scenarioInput([other, preferred], 'all', [preferred.id])))
    const onUnpreferred = await run(scenarioInput([other, preferred], 'all', [preferred.id]))

    expect(offPreferred.result.targetResult.candidate?.route.sourceOwnedWeaponId).toBe(preferred.id)
    expect(onPreferred.result.targetResult.candidate?.route.sourceOwnedWeaponId).toBe(other.id)
    expect(onPreferred.result.targetResult.candidate).toEqual(onUnpreferred.result.targetResult.candidate)
  })

  it('gives the same Route the same Candidate identity and hashes with and without the exclusion', async () => {
    const kept = idealGogma('owned.gogma.a')
    const excluded = idealGogma('owned.gogma.b')
    const off = await run(scenarioInput([kept, excluded]))
    const on = await run(scenarioInput([kept, excluded], 'all', [excluded.id]))
    const offCandidate = off.result.targetResult.candidate
    const onCandidate = on.result.targetResult.candidate
    expect(offCandidate?.route.sourceOwnedWeaponId).toBe(kept.id)
    expect(onCandidate).not.toBeNull()
    expect(onCandidate).toEqual(offCandidate)
    expect(candidateStableKey(onCandidate!)).toBe(candidateStableKey(offCandidate!))
    expect(candidateDeduplicationKey(onCandidate!)).toBe(candidateDeduplicationKey(offCandidate!))
    expect(createBuildCandidateMeaningFingerprint(onCandidate!)).toBe(createBuildCandidateMeaningFingerprint(offCandidate!))
    expect(onCandidate!.searchStateHash).toBe(offCandidate!.searchStateHash)
    expect(onCandidate!.referencedOwnedWeaponsHash).toBe(offCandidate!.referencedOwnedWeaponsHash)
    expect(JSON.stringify(onCandidate)).not.toContain('excludedSourceOwnedWeaponIds')
  })
})

describe('excludedSourceOwnedWeaponIds in the result', () => {
  // Upper-case 'N' sorts before lower-case 'g' by code unit, after it by locale.
  const NORMAL = 'owned.Normal'
  const GOGMA = 'owned.gogma'
  const owned = () => [
    normal(NORMAL, LAYOUT_A),
    gogma(GOGMA, LAYOUT_C),
    normal('owned.normal.protected', LAYOUT_B, { isProtected: true }),
    gogma('owned.gogma.other-type', LAYOUT_D, { weaponTypeId: 'weapon.fixture.b' }),
  ]
  const excludeAll = () => owned().map(({ id }) => id)

  it.each([
    ['all', [NORMAL, GOGMA]],
    ['normal_artian', [NORMAL]],
    ['existing_gogma', [GOGMA]],
  ] as const)('lists, for routeFilter %s, only the sources it really removed, in code unit order', async (routeFilter, expected) => {
    const { result } = await run(scenarioInput(owned(), routeFilter, excludeAll()))
    expect(result.targetResult.excludedSourceOwnedWeaponIds).toEqual(expected)
  })

  it('does not depend on the order of the excluded IDs', async () => {
    const forward = await run(scenarioInput(mixedSources(), 'all', [N1, G1, N2]))
    const backward = await run(scenarioInput(mixedSources(), 'all', [N2, G1, N1]))
    expect(backward.result).toEqual(forward.result)
    expect(backward.calls).toEqual(forward.calls)
    expect(forward.result.targetResult.excludedSourceOwnedWeaponIds).toEqual([G1, N1, N2])
  })

  it('is empty in the early results that enumerate no Route base', async () => {
    const disabled = scenarioInput(mixedSources(), 'all', [N1])
    disabled.targetWeapons[0] = { ...disabled.targetWeapons[0], isEnabled: false }
    expect((await run(disabled)).result.targetResult.excludedSourceOwnedWeaponIds).toEqual([])

    const otherContext = scenarioInput(mixedSources(), 'all', [N1])
    const { result } = await run(otherContext, (input) => ({ ...scenarioEngine(input), version: 'another-engine-version' }))
    expect(result.targetResult.skippedRoutes.every(({ reason }) => reason === 'calculation_context_incompatible')).toBe(true)
    expect(result.targetResult.excludedSourceOwnedWeaponIds).toEqual([])
  })
})

function thrownBy(action: () => void): unknown {
  try {
    action()
  } catch (error: unknown) {
    return error
  }
  throw new Error('Expected the action to throw.')
}

describe('excludedSourceOwnedWeaponIds validation', () => {
  const source = createCandidateSearchInput().ownedWeapons[0].id

  it.each([
    ['a repeated ID', [source, source]],
    ['an ID missing from ownedWeapons', ['owned.missing']],
    ['an empty string', ['']],
    ['a blank string', ['  ']],
    ['a non-string element', [42]],
    ['a string instead of an array', source],
    ['null instead of an array', null],
  ] as const)('fails closed on %s', async (_, value) => {
    const input = createCandidateSearchInput()
    ;(input as { excludedSourceOwnedWeaponIds?: unknown }).excludedSourceOwnedWeaponIds = value
    expect(thrownBy(() => assertCandidateSearchInput(input))).toMatchObject({
      name: 'CandidateSearchError',
      code: 'invalid_input',
      message: expect.stringContaining('excludedSourceOwnedWeaponIds'),
    })
    const { engine, calls } = logged(createCandidateSearchEngine(input))
    await expect(searchCandidates(input, engine, deterministicExecution)).rejects.toMatchObject({
      name: 'CandidateSearchError',
      code: 'invalid_input',
    })
    expect(calls).toEqual([])
  })

  it.each([
    ['every slot is empty', () => new Array(1) as unknown[], 0],
    ['a slot after an existing ID is empty', () => {
      const ids: unknown[] = [source, source]
      delete ids[1]
      return ids
    }, 1],
  ] as const)('fails closed on a sparse array where %s', async (_, makeIds, emptyIndex) => {
    const ids = makeIds()
    expect(emptyIndex in ids).toBe(false)
    const input = createCandidateSearchInput()
    ;(input as { excludedSourceOwnedWeaponIds?: unknown }).excludedSourceOwnedWeaponIds = ids
    const error = thrownBy(() => assertCandidateSearchInput(input))
    expect(error).toBeInstanceOf(CandidateSearchError)
    expect(error).toMatchObject({
      code: 'invalid_input',
      message: expect.stringContaining(`excludedSourceOwnedWeaponIds[${emptyIndex}] is an empty slot`),
    })
    const { engine, calls } = logged(createCandidateSearchEngine(input))
    await expect(searchCandidates(input, engine, deterministicExecution)).rejects.toMatchObject({
      name: 'CandidateSearchError',
      code: 'invalid_input',
      message: expect.stringContaining(`excludedSourceOwnedWeaponIds[${emptyIndex}]`),
    })
    expect(calls).toEqual([])
  })

  it('accepts an absent field, [] and existing unique IDs', () => {
    const input = createCandidateSearchInput()
    expect(() => assertCandidateSearchInput(input)).not.toThrow()
    input.excludedSourceOwnedWeaponIds = []
    expect(() => assertCandidateSearchInput(input)).not.toThrow()
    input.excludedSourceOwnedWeaponIds = [source as OwnedWeaponId]
    expect(() => assertCandidateSearchInput(input)).not.toThrow()
  })
})

/**
 * Only the ordinary Candidate Search reads the exclusion (`docs/SEARCH_SPEC.md`
 * 3.3): constrained enumeration, Planner Alternative Search, the
 * shape-constrained Route search and the Build List optimization's projected
 * Stage D input never set it, so their behaviour cannot change.
 */
describe('source exclusion stays out of the other Search consumers', () => {
  const sources = import.meta.glob(
    ['./**/*.ts', '../planner/**/*.ts', '!./**/*.test.ts', '!../planner/**/*.test.ts'],
    { query: '?raw', import: 'default', eager: true },
  ) as Record<string, string>

  it('is named by the ordinary Candidate Search modules alone', () => {
    const naming = Object.entries(sources)
      .filter(([, text]) => text.includes('excludedSourceOwnedWeaponIds'))
      .map(([path]) => path)
      .sort()
    expect(naming).toEqual([
      './candidateSearch.ts',
      './existingGogmaRouteSearch.ts',
      './ownedNormalArtianRouteSearch.ts',
      './routeSearchShared.ts',
      './searchTypes.ts',
      './searchValidation.ts',
    ])
  })

  it('is scanned over the consumers it must not reach', () => {
    const paths = Object.keys(sources)
    for (const consumer of ['./alternative/', './constrained/', './shapeConstrained/', '../planner/buildListOptimization/']) {
      expect(paths.some((path) => path.startsWith(consumer))).toBe(true)
    }
  })
})
