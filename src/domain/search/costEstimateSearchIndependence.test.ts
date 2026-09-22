import { describe, expect, it } from 'vitest'
import { searchCandidates } from './candidateSearch'
import { candidateStableKey } from './candidateProcessing'
import { estimateCandidateCost } from '../cost'
import {
  createCandidateSearchEngine,
  createCandidateSearchInput,
  SEARCH_FIXTURE_TIME,
} from '../../test/fixtures/candidateSearch'
import { createRestorationBonusSet } from '../../test/fixtures/domainData'
import type { CandidateRouteFilter } from './searchTypes'

/*
 * The display-only cost estimate (`docs/SEARCH_SPEC.md` 4.3) must leave every
 * Search result exactly as it was before it existed. The expectations below
 * were recorded from the fixture search on the commit preceding the cost
 * estimate (main c4032f9) and are asserted verbatim: the canonical Ideal, its
 * Route, its stable key, its estimates and the searched / skipped Routes.
 */

const deterministicExecution = {
  now: () => SEARCH_FIXTURE_TIME,
  nowMs: () => 100,
}

const idealFinalBonuses = [
  '["bonus_type.fixture.attack","bonus_rank.fixture.high"]',
  '["bonus_type.fixture.attack","bonus_rank.fixture.high"]',
  '["bonus_type.fixture.element","bonus_rank.fixture.middle"]',
  '["bonus_type.fixture.sharpness","bonus_rank.fixture.high"]',
  '["bonus_type.fixture.utility","bonus_rank.fixture.low"]',
]

const existingGogmaCurrentStableKey = JSON.stringify({
  finalBonuses: idealFinalBonuses,
  groupSkillId: null,
  operations: [],
  restorationBonusScope: 'gogma_artian',
  routeKind: 'existing_gogma_current',
  seriesSkillId: 'series_skill.fixture.a',
  sourceOwnedWeaponId: 'owned.fixture.source',
})

const normalArtianStableKey = JSON.stringify({
  finalBonuses: idealFinalBonuses,
  groupSkillId: null,
  operations: [
    { count: 1, normalCounterAfter: 5, normalCounterBefore: 4, rarity: 8, type: 'create_normal_artian', weaponTypeId: 'weapon.fixture.a' },
    { skillCounterAfter: 8, skillCounterBefore: 7, type: 'convert_normal_to_gogma', weaponTypeId: 'weapon.fixture.a' },
    { gogmaCounterAfter: 11, gogmaCounterBefore: 10, sourceOwnedWeaponId: null, type: 'reset_bonuses' },
  ],
  restorationBonusScope: 'gogma_artian',
  routeKind: 'normal_artian_to_gogma',
  seriesSkillId: 'series_skill.fixture.a',
  sourceOwnedWeaponId: null,
})

interface RecordedOutcome {
  kind: string
  source: string | null
  operations: string[]
  stableKey: string
  estimates: [number, number | null, number, number]
  searchedRoutes: string[]
  skippedRoutes: [string, string][]
  requiredMaterials: unknown[]
  intermediateStateGroupIds: string[]
}

const recorded: Record<CandidateRouteFilter, RecordedOutcome> = {
  all: {
    kind: 'existing_gogma_current',
    source: 'owned.fixture.source',
    operations: [],
    stableKey: existingGogmaCurrentStableKey,
    estimates: [0, null, 0, 0],
    searchedRoutes: ['normal_artian_to_gogma', 'existing_gogma_current'],
    skippedRoutes: [
      ['owned_normal_artian_to_gogma', 'no_owned_weapon_available'],
      ['existing_gogma_reset_skills', 'no_unprotected_source_weapon'],
      ['existing_gogma_reset_bonuses', 'no_unprotected_source_weapon'],
      ['existing_gogma_keep_bonuses', 'no_unprotected_source_weapon'],
      ['existing_gogma_mixed', 'no_unprotected_source_weapon'],
    ],
    requiredMaterials: [],
    intermediateStateGroupIds: [],
  },
  normal_artian: {
    kind: 'normal_artian_to_gogma',
    source: null,
    operations: ['create_normal_artian', 'convert_normal_to_gogma', 'reset_bonuses'],
    stableKey: normalArtianStableKey,
    estimates: [3, 1, 1, 1],
    searchedRoutes: ['normal_artian_to_gogma'],
    skippedRoutes: [
      ['existing_gogma_current', 'disabled_by_filter'],
      ['existing_gogma_reset_bonuses', 'disabled_by_filter'],
      ['existing_gogma_keep_bonuses', 'disabled_by_filter'],
      ['existing_gogma_reset_skills', 'disabled_by_filter'],
      ['existing_gogma_mixed', 'disabled_by_filter'],
      ['owned_normal_artian_to_gogma', 'no_owned_weapon_available'],
    ],
    requiredMaterials: [],
    intermediateStateGroupIds: [],
  },
  existing_gogma: {
    kind: 'existing_gogma_current',
    source: 'owned.fixture.source',
    operations: [],
    stableKey: existingGogmaCurrentStableKey,
    estimates: [0, null, 0, 0],
    searchedRoutes: ['existing_gogma_current'],
    skippedRoutes: [
      ['normal_artian_to_gogma', 'disabled_by_filter'],
      ['owned_normal_artian_to_gogma', 'disabled_by_filter'],
      ['existing_gogma_reset_skills', 'no_unprotected_source_weapon'],
      ['existing_gogma_reset_bonuses', 'no_unprotected_source_weapon'],
      ['existing_gogma_keep_bonuses', 'no_unprotected_source_weapon'],
      ['existing_gogma_mixed', 'no_unprotected_source_weapon'],
    ],
    requiredMaterials: [],
    intermediateStateGroupIds: [],
  },
}

async function runFixtureSearch(routeFilter: CandidateRouteFilter) {
  const input = createCandidateSearchInput()
  input.routeFilter = routeFilter
  return searchCandidates(
    input,
    createCandidateSearchEngine(input, { resetResult: createRestorationBonusSet() }),
    deterministicExecution,
  )
}

describe('Candidate Search is independent of the cost estimate', () => {
  it.each(Object.keys(recorded) as CandidateRouteFilter[])(
    'returns the canonical Candidate recorded before the cost estimate existed (%s)',
    async (routeFilter) => {
      const result = await runFixtureSearch(routeFilter)
      const candidate = result.targetResult.candidate
      expect(candidate).not.toBeNull()
      if (candidate === null) return
      const expected = recorded[routeFilter]
      expect(candidate.route.kind).toBe(expected.kind)
      expect(candidate.route.sourceOwnedWeaponId).toBe(expected.source)
      expect(candidate.route.operations.map(({ type }) => type)).toEqual(expected.operations)
      expect(candidateStableKey(candidate)).toBe(expected.stableKey)
      expect([
        candidate.estimatedOperationCount,
        candidate.estimatedNormalAdvance,
        candidate.estimatedGogmaAdvance,
        candidate.estimatedSkillAdvance,
      ]).toEqual(expected.estimates)
      expect(result.targetResult.searchedRoutes).toEqual(expected.searchedRoutes)
      expect(result.targetResult.skippedRoutes.map(({ route, reason }) => [route, reason])).toEqual(
        expected.skippedRoutes,
      )
      expect(candidate.requiredMaterials).toEqual(expected.requiredMaterials)
      expect((candidate.intermediateStateGroups ?? []).map(({ id }) => id)).toEqual(
        expected.intermediateStateGroupIds,
      )
    },
  )

  it('adds no cost field to a Candidate and leaves it unchanged when the estimate is derived', async () => {
    const result = await runFixtureSearch('normal_artian')
    const candidate = result.targetResult.candidate
    expect(candidate).not.toBeNull()
    if (candidate === null) return
    expect(Object.keys(candidate).some((key) => /cost|zenny|part/i.test(key))).toBe(false)
    const before = structuredClone(candidate)
    const estimate = estimateCandidateCost(candidate)
    expect(estimate.zenny).toBe(10_000 + 10_000 + 30_000 + 5_000)
    expect(candidate).toEqual(before)
    expect(candidateStableKey(candidate)).toBe(normalArtianStableKey)
  })

  it('is never imported by the Search, Planner, Execution, Worker or Service layers', () => {
    // The sources of every calculation and runtime layer, read as text.
    const sources: Record<string, string> = {
      ...import.meta.glob('../{search,planner,buildList,execution,rng,target}/**/*.ts', { query: '?raw', import: 'default', eager: true }),
      ...import.meta.glob('../../{workers,services,db}/**/*.ts', { query: '?raw', import: 'default', eager: true }),
    } as Record<string, string>
    const paths = Object.keys(sources)
    expect(paths.length).toBeGreaterThan(50)
    const offenders = paths.filter(
      (path) =>
        !/\.test\.tsx?$/.test(path) &&
        /from '[^']*(?:domain\/cost|costEstimate)[^']*'/.test(sources[path]),
    )
    expect(offenders).toEqual([])
  })
})
