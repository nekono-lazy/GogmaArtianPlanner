import { describe, expect, it, vi } from 'vitest'
import {
  createCandidateSearchInput,
  SEARCH_FIXTURE_TIME,
  candidatesOf,
} from '../../test/fixtures/candidateSearch'
import { createRestorationBonusSet } from '../../test/fixtures/domainData'
import { restorationBonus, restorationBonusSet } from '../../test/fixtures/targetEvaluation'
import type { OwnedGogmaArtianWeapon, RestorationBonusSet } from '../models/publicTypes'
import { FakeRngEngine, type FakeRngFixtures } from '../rng/fakeRngEngine'
import { searchCandidates } from './candidateSearch'
import { candidateStableKey } from './candidateProcessing'
import { defaultCandidateSearchSettings } from './searchTypes'
import type { CandidateSearchInput } from './searchTypes'

const deterministicExecution = {
  now: () => SEARCH_FIXTURE_TIME,
  nowMs: () => 100,
}

const IDEAL_SERIES_SKILL = 'series_skill.fixture.a'
const ENGINE_VERSION = 'fake-fixture:ideal-only-search'

/** The fixture Target's Ideal five slots. */
const idealBonuses = (): RestorationBonusSet => createRestorationBonusSet()

/** Ideal types and counts with the Sharpness rank relaxed: a Practical match. */
const practicalBonuses = (): RestorationBonusSet =>
  restorationBonusSet(
    restorationBonus('bonus_type.fixture.attack', 'bonus_rank.fixture.high'),
    restorationBonus('bonus_type.fixture.attack', 'bonus_rank.fixture.high'),
    restorationBonus('bonus_type.fixture.element', 'bonus_rank.fixture.middle'),
    restorationBonus('bonus_type.fixture.utility', 'bonus_rank.fixture.low'),
    restorationBonus('bonus_type.fixture.sharpness', 'bonus_rank.fixture.low'),
  )

const belowPracticalBonuses = (): RestorationBonusSet =>
  restorationBonusSet(
    restorationBonus('bonus_type.fixture.utility', 'bonus_rank.fixture.low'),
    restorationBonus('bonus_type.fixture.utility', 'bonus_rank.fixture.low'),
    restorationBonus('bonus_type.fixture.utility', 'bonus_rank.fixture.low'),
    restorationBonus('bonus_type.fixture.utility', 'bonus_rank.fixture.low'),
    restorationBonus('bonus_type.fixture.utility', 'bonus_rank.fixture.low'),
  )

interface EngineOptions {
  /** Reset Bonuses result at Gogma Counter `10 + index`. */
  resets: RestorationBonusSet[]
  /** Keep Bonuses results, keyed by the ordered five slots they read. */
  keeps?: Array<{
    gogmaCounter: number
    currentBonuses: RestorationBonusSet
    result: RestorationBonusSet
  }>
}

/**
 * An existing-Gogma search whose source already carries the Ideal Series
 * Skill, so the Ideal is decided on the Bonus axis alone.
 */
function existingGogmaInput(maxGogmaAdvance: number): CandidateSearchInput {
  const input = createCandidateSearchInput()
  input.routeFilter = 'existing_gogma'
  input.settings = { ...input.settings, maxGogmaAdvance, maxSkillAdvance: 1 }
  input.calculationContext.rngEngineVersion = ENGINE_VERSION
  const source = input.ownedWeapons[0] as OwnedGogmaArtianWeapon
  source.restorationBonusScope = 'gogma_artian'
  source.restorationBonuses = belowPracticalBonuses()
  source.seriesSkillId = IDEAL_SERIES_SKILL
  source.groupSkillId = null
  source.isProtected = false
  return input
}

function createEngine(
  input: CandidateSearchInput,
  options: EngineOptions,
): FakeRngEngine {
  const baseSeed = input.rngState.baseSeed.value as string
  const target = input.targetWeapons[0]
  const keeps = options.keeps ?? []
  const fixtures: FakeRngFixtures = {
    version: 'ideal-only-search',
    capabilities: {
      supportsSeedSearch: false,
      supportsNormalArtianPrediction: false,
      supportsGogmaPrediction: true,
      supportsSkillPrediction: true,
      supportsKeepBonusesPrediction: keeps.length > 0,
    },
    normalizedSeeds: [],
    normalArtianPredictions: [],
    resetBonusPredictions: options.resets.map((result, index) => ({
      input: {
        baseSeed,
        gogmaCounter: 10 + index,
        weaponTypeId: target.weaponTypeId,
        elementId: target.elementId,
        operation: { type: 'reset_bonuses' as const },
        master: input.master,
      },
      result,
    })),
    keepBonusPredictions: keeps.map(({ gogmaCounter, currentBonuses, result }) => ({
      input: {
        baseSeed,
        gogmaCounter,
        weaponTypeId: target.weaponTypeId,
        elementId: target.elementId,
        operation: { type: 'keep_bonuses' as const, currentBonuses },
        master: input.master,
      },
      result,
    })),
    skillPredictions: [7, 8].map((skillCounter) => ({
      input: {
        baseSeed,
        skillCounter,
        weaponTypeId: target.weaponTypeId,
        elementId: target.elementId,
        master: input.master,
      },
      result: { seriesSkillId: 'series_skill.fixture.other', groupSkillId: null },
    })),
    gogmaCounterAdvances: options.resets.flatMap((_, index) => [
      { current: 10 + index, operation: { type: 'reset_bonuses' as const }, result: 11 + index },
      { current: 10 + index, operation: { type: 'keep_bonuses' as const }, result: 11 + index },
    ]),
    skillCounterAdvances: [
      { current: 7, operation: { type: 'reset_skills' as const }, result: 8 },
      { current: 8, operation: { type: 'reset_skills' as const }, result: 9 },
    ],
    normalCounterAdvances: [],
  }
  return new FakeRngEngine(fixtures)
}

describe('Ideal-only Candidate Search', () => {
  it('takes exactly one TargetWeapon', () => {
    const input = createCandidateSearchInput()

    expect(typeof input.targetWeaponId).toBe('string')
    expect(Object.keys(input)).not.toContain('targetWeaponIds')
    expect(Object.keys(input)).not.toContain('resultFilter')
  })

  it('refuses a disabled Target with a notice instead of a Candidate', async () => {
    const input = existingGogmaInput(2)
    input.targetWeapons[0].isEnabled = false
    const engine = createEngine(input, { resets: [practicalBonuses(), idealBonuses()] })

    const result = await searchCandidates(input, engine, deterministicExecution)

    expect(result.targetResult.candidate).toBeNull()
    expect(result.targetResult.searchedRoutes).toEqual([])
    expect(result.warnings).toEqual([
      expect.objectContaining({
        targetWeaponId: input.targetWeapons[0].id,
        severity: 'warning',
      }),
    ])
  })

  it('still applies routeFilter to the searched and skipped Route kinds', async () => {
    const input = existingGogmaInput(2)
    const engine = createEngine(input, { resets: [practicalBonuses(), idealBonuses()] })

    const result = await searchCandidates(input, engine, deterministicExecution)

    expect(result.targetResult.searchedRoutes.every((route) =>
      route.startsWith('existing_gogma'),
    )).toBe(true)
    expect(result.targetResult.skippedRoutes).toContainEqual(
      expect.objectContaining({
        route: 'normal_artian_to_gogma',
        reason: 'disabled_by_filter',
      }),
    )
  })

  it('carries only the three advance bounds as Search settings', () => {
    expect(Object.keys(defaultCandidateSearchSettings).sort()).toEqual([
      'maxGogmaAdvance',
      'maxNormalAdvance',
      'maxSkillAdvance',
    ])
    const settings = createCandidateSearchInput().settings as unknown as Record<string, unknown>
    expect(settings.similarityThreshold).toBeUndefined()
    expect(settings.maxCandidatesPerTarget).toBeUndefined()
  })

  it('returns exactly one canonical Ideal Candidate with its checkpoints', async () => {
    const input = existingGogmaInput(2)
    const engine = createEngine(input, { resets: [practicalBonuses(), idealBonuses()] })

    const result = await searchCandidates(input, engine, deterministicExecution)
    const candidates = candidatesOf(result.targetResult)

    expect(candidates).toHaveLength(1)
    expect(candidates[0].finalBonuses).toEqual(idealBonuses())
    expect(candidates[0].restorationBonusScope).toBe('gogma_artian')
    expect(candidates[0].checkpointGroups).toHaveLength(1)
    expect(candidates[0].checkpointGroups?.[0].conditionMatch).toEqual({
      bonus: 'practical',
      skill: 'ideal',
    })
  })

  it('returns no Candidate at all when no Ideal is reachable', async () => {
    const input = existingGogmaInput(2)
    const engine = createEngine(input, {
      resets: [belowPracticalBonuses(), belowPracticalBonuses()],
    })

    const result = await searchCandidates(input, engine, deterministicExecution)

    expect(result.targetResult.candidate).toBeNull()
    expect(result.targetResult.searchedRoutes.length).toBeGreaterThan(0)
  })

  it('returns no Candidate when only a compromise state is reachable', async () => {
    const input = existingGogmaInput(2)
    const engine = createEngine(input, {
      resets: [practicalBonuses(), practicalBonuses()],
    })

    const result = await searchCandidates(input, engine, deterministicExecution)

    // A compromise state is a checkpoint of a real Ideal Route or nothing at
    // all; it is never an independent Candidate (`docs/SEARCH_SPEC.md` 5.7).
    expect(result.targetResult.candidate).toBeNull()
  })

  it('never turns a compromise state off the Ideal Route into a checkpoint', async () => {
    const input = existingGogmaInput(2)
    const source = input.ownedWeapons[0] as OwnedGogmaArtianWeapon
    const engine = createEngine(input, {
      // The Ideal Route is Reset then Reset, and its only prefix is below the
      // compromise line. The Keep branch does reach a compromise state, but it
      // branches away from the Ideal Route and therefore offers nothing.
      resets: [belowPracticalBonuses(), idealBonuses()],
      keeps: [
        {
          gogmaCounter: 10,
          currentBonuses: source.restorationBonuses,
          result: practicalBonuses(),
        },
        {
          gogmaCounter: 11,
          currentBonuses: practicalBonuses(),
          result: belowPracticalBonuses(),
        },
        {
          gogmaCounter: 11,
          currentBonuses: belowPracticalBonuses(),
          result: belowPracticalBonuses(),
        },
      ],
    })

    const result = await searchCandidates(input, engine, deterministicExecution)
    const [candidate] = candidatesOf(result.targetResult)

    expect(candidate.route.operations.map(({ type }) => type)).toEqual([
      'reset_bonuses',
      'reset_bonuses',
    ])
    expect(candidate.checkpointGroups).toEqual([])
  })

  it('adds no RNG prediction call and moves no canonical Ideal for its checkpoints', async () => {
    const run = async (withCompromise: boolean) => {
      const input = existingGogmaInput(2)
      if (!withCompromise) {
        // No compromise condition at all: the same Search, with no checkpoint
        // the extraction could possibly find.
        input.targetWeapons[0].practicalBonusConditions = []
        input.targetWeapons[0].alternativeBonusRules = []
        input.targetWeapons[0].practicalSkillCondition = {
          seriesSkillId: null,
          groupSkillId: null,
          matchMode: 'all',
        }
      }
      const engine = createEngine(input, { resets: [practicalBonuses(), idealBonuses()] })
      const gogma = vi.spyOn(engine, 'predictGogmaBonus')
      const skills = vi.spyOn(engine, 'predictSkills')
      const normal = vi.spyOn(engine, 'predictNormalArtian')
      const result = await searchCandidates(input, engine, deterministicExecution)
      return {
        candidate: candidatesOf(result.targetResult)[0],
        calls: {
          gogma: gogma.mock.calls.length,
          skills: skills.mock.calls.length,
          normal: normal.mock.calls.length,
        },
      }
    }

    const withCheckpoints = await run(true)
    const withoutCheckpoints = await run(false)

    expect(withCheckpoints.calls).toEqual(withoutCheckpoints.calls)
    expect(withCheckpoints.candidate.checkpointGroups).toHaveLength(1)
    expect(withoutCheckpoints.candidate.checkpointGroups).toEqual([])
    // Checkpoint existence never moves the canonical Ideal selection.
    expect(candidateStableKey(withCheckpoints.candidate)).toBe(
      candidateStableKey(withoutCheckpoints.candidate),
    )
  })
})
