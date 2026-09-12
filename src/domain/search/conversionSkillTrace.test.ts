import { describe, expect, it, vi } from 'vitest'
import {
  createCandidateSearchEngine,
  createCandidateSearchInput,
  practicalOnlyBonuses,
  SEARCH_FIXTURE_TIME,
  candidatesOf,
} from '../../test/fixtures/candidateSearch'
import { createRestorationBonusSet } from '../../test/fixtures/domainData'
import { createBuildCandidateMeaningFingerprint } from '../buildList'
import type {
  BuildCandidate,
  OwnedGogmaArtianWeapon,
  RouteOperation,
} from '../models/publicTypes'
import { validateBuildCandidate } from '../models/validation'
import { createCandidateConversionSkillStep } from './candidateFactory'
import { searchCandidates } from './candidateSearch'
import { candidateDeduplicationKey, candidateStableKey } from './candidateProcessing'
import { conversionSkillPrediction } from './routeSearchShared'
import { CandidateSearchError } from './searchTypes'
import type { CandidateSearchInput } from './searchTypes'

const deterministicExecution = {
  now: () => SEARCH_FIXTURE_TIME,
  nowMs: () => 100,
}

/** The fixture Skill prediction at the conversion position, Skill Counter 7. */
const CONVERSION_SKILLS = { seriesSkillId: 'series_skill.fixture.a', groupSkillId: null }
/** A distinct Skill at the first Reset Skills position, Skill Counter 8. */
const RESET_SERIES_SKILL = 'series_skill.fixture.b'

/**
 * Makes the conversion Skill fall short of the Target's Ideal Skill condition,
 * so the Skill stream really searches Reset Skills instead of stopping on the
 * conversion result (SEARCH_SPEC 5.6.1).
 */
function requireResetSkills(input: CandidateSearchInput): void {
  input.targetWeapons[0].practicalSkillCondition = { seriesSkillId: null, groupSkillId: null, matchMode: 'all' }
  input.targetWeapons[0].idealSkillCondition = {
    seriesSkillId: RESET_SERIES_SKILL,
    groupSkillId: null,
    matchMode: 'all',
  }
}

/**
 * One unprotected Gogma source below both the Ideal bonuses and the Ideal
 * Skill, so the existing-Gogma routes really produce Reset Bonuses and Reset
 * Skills Candidates to compare against.
 */
function createExistingGogmaInput(): CandidateSearchInput {
  const input = createCandidateSearchInput()
  input.routeFilter = 'existing_gogma'
  // One Reset Skills reaches the Ideal Skill, so the canonical Ideal Candidate
  // really carries a Reset Skills record.
  input.targetWeapons[0].idealSkillCondition = { seriesSkillId: 'series_skill.fixture.a', groupSkillId: null, matchMode: 'all' }
  input.targetWeapons[0].practicalSkillCondition = { seriesSkillId: null, groupSkillId: null, matchMode: 'all' }
  input.ownedWeapons = [
    {
      ...(input.ownedWeapons[0] as OwnedGogmaArtianWeapon),
      restorationBonusScope: 'gogma_artian' as const,
      restorationBonuses: practicalOnlyBonuses(),
      // Distinct from the Skill predicted at the source's own Skill Counter, so
      // the stream-local retention keeps the `resetCount = 1` solution.
      seriesSkillId: 'series_skill.fixture.source',
      groupSkillId: null,
      isProtected: false,
    },
  ]
  return input
}

function operationTypes(candidate: BuildCandidate): string[] {
  return candidate.route.operations.map(({ type }) => type)
}

function findByOperationTypes(
  candidates: readonly BuildCandidate[],
  types: readonly string[],
): BuildCandidate {
  const matches = candidates.filter(
    (candidate) => operationTypes(candidate).join(',') === types.join(','),
  )
  expect(matches.length).toBeGreaterThan(0)
  return matches[0]
}

describe('Candidate conversion Skill trace', () => {
  it('records the initial Skills after conversion and Bonus Reset', async () => {
    const input = createCandidateSearchInput()
    input.routeFilter = 'normal_artian'
    const result = await searchCandidates(
      input,
      createCandidateSearchEngine(input, { resetResult: createRestorationBonusSet() }),
      deterministicExecution,
    )
    const candidate = findByOperationTypes(candidatesOf(result.targetResult), [
      'create_normal_artian',
      'convert_normal_to_gogma',
      'reset_bonuses',
    ])

    expect(candidate.conversionSkillTrace).toEqual({
      operationIndex: 1,
      operationType: 'convert_normal_to_gogma',
      ...CONVERSION_SKILLS,
    })
    // With no Reset Skills the conversion result IS the Candidate result, but
    // that is a property of this Route, not a validation invariant.
    expect(candidate.seriesSkillId).toBe(CONVERSION_SKILLS.seriesSkillId)
    expect(candidate.groupSkillId).toBe(CONVERSION_SKILLS.groupSkillId)
    expect(candidate.skillAmendmentTrace).toEqual([])
  })

  it('keeps the conversion result distinct from the Skills a later Reset produces', async () => {
    const input = createCandidateSearchInput()
    input.routeFilter = 'normal_artian'
    requireResetSkills(input)
    const result = await searchCandidates(
      input,
      createCandidateSearchEngine(input, {
        // The Reset reaches the Ideal five slots, so the composed result is a
        // canonical Ideal Candidate.
        resetResult: structuredClone(input.targetWeapons[0].idealBonuses),
        resetSkillSeriesSkillId: RESET_SERIES_SKILL,
      }),
      deterministicExecution,
    )
    const candidate = findByOperationTypes(candidatesOf(result.targetResult), [
      'create_normal_artian',
      'convert_normal_to_gogma',
      'reset_bonuses',
      'reset_skills',
    ])

    expect(candidate.conversionSkillTrace).toEqual({
      operationIndex: 1,
      operationType: 'convert_normal_to_gogma',
      ...CONVERSION_SKILLS,
    })
    expect(candidate.skillAmendmentTrace).toEqual([
      {
        operationIndex: 3,
        operationType: 'reset_skills',
        seriesSkillId: RESET_SERIES_SKILL,
        groupSkillId: null,
      },
    ])
    // The Reset overwrites the conversion result; the conversion record must
    // not be back-derived from the Candidate's own final Skills.
    expect(candidate.seriesSkillId).toBe(RESET_SERIES_SKILL)
    expect(candidate.conversionSkillTrace?.seriesSkillId).not.toBe(candidate.seriesSkillId)
  })

  it('binds the conversion, Bonus, and Skill records to disjoint operations', async () => {
    const input = createCandidateSearchInput()
    input.routeFilter = 'normal_artian'
    // No confirmed Normal Counter, so the forced Reset variant of SEARCH_SPEC
    // 6.1.1 runs and its Bonus axis starts at the mandatory Reset Bonuses.
    input.normalCounters = []
    requireResetSkills(input)
    const result = await searchCandidates(
      input,
      createCandidateSearchEngine(input, {
        // The Reset reaches the Ideal five slots, so the composed result is a
        // canonical Ideal Candidate.
        resetResult: structuredClone(input.targetWeapons[0].idealBonuses),
        resetSkillSeriesSkillId: RESET_SERIES_SKILL,
      }),
      deterministicExecution,
    )
    const candidate = findByOperationTypes(candidatesOf(result.targetResult), [
      'create_normal_artian',
      'convert_normal_to_gogma',
      'reset_bonuses',
      'reset_skills',
    ])

    expect(candidate.conversionSkillTrace?.operationIndex).toBe(1)
    expect(candidate.bonusAmendmentTrace?.map(({ operationIndex }) => operationIndex)).toEqual([2])
    expect(candidate.skillAmendmentTrace?.map(({ operationIndex }) => operationIndex)).toEqual([3])
    expect(candidate.bonusAmendmentTrace?.[0].restorationBonuses).toEqual(
      createRestorationBonusSet(),
    )
    expect(candidate.conversionSkillTrace).toMatchObject(CONVERSION_SKILLS)
    expect(candidate.skillAmendmentTrace?.[0].seriesSkillId).toBe(RESET_SERIES_SKILL)
  })

  it('records the conversion Skill on a blind Normal Artian route', async () => {
    const input = createCandidateSearchInput()
    input.routeFilter = 'normal_artian'
    input.normalCounters = []
    const result = await searchCandidates(
      input,
      createCandidateSearchEngine(input, { resetResult: createRestorationBonusSet() }),
      deterministicExecution,
    )
    const blind = candidatesOf(result.targetResult).filter(({ route }) =>
      route.operations.some(
        (operation) =>
          operation.type === 'create_normal_artian' && operation.normalCounterBefore === null,
      ),
    )

    expect(blind.length).toBeGreaterThan(0)
    blind.forEach((candidate) => {
      // The forged weapon's five slots are unknown, but the Skill assigned at
      // conversion is predicted normally, so the record is still produced.
      expect(candidate.conversionSkillTrace).toEqual({
        operationIndex: 1,
        operationType: 'convert_normal_to_gogma',
        ...CONVERSION_SKILLS,
      })
    })
  })

  it('records the conversion Skill on an owned Normal Artian route', async () => {
    const input = createCandidateSearchInput()
    input.routeFilter = 'normal_artian'
    input.normalCounters = []
    requireResetSkills(input)
    input.ownedWeapons = [
      {
        ...input.ownedWeapons[0],
        kind: 'normal' as const,
        rarity: 8 as const,
        restorationBonusScope: 'normal_artian' as const,
        restorationBonuses: practicalOnlyBonuses(),
        seriesSkillId: null,
        groupSkillId: null,
        status: null,
        isProtected: false,
      },
    ]
    const result = await searchCandidates(
      input,
      createCandidateSearchEngine(input, {
        // The Reset reaches the Ideal five slots, so the composed result is a
        // canonical Ideal Candidate.
        resetResult: structuredClone(input.targetWeapons[0].idealBonuses),
        resetSkillSeriesSkillId: RESET_SERIES_SKILL,
      }),
      deterministicExecution,
    )
    const owned = candidatesOf(result.targetResult).filter(
      ({ route }) => route.kind === 'owned_normal_artian_to_gogma',
    )

    expect(owned.length).toBeGreaterThan(0)
    owned.forEach((candidate) => {
      expect(operationTypes(candidate)[0]).toBe('convert_normal_to_gogma')
      expect(candidate.conversionSkillTrace).toEqual({
        operationIndex: 0,
        operationType: 'convert_normal_to_gogma',
        ...CONVERSION_SKILLS,
      })
    })
    expect(
      owned.some((candidate) => operationTypes(candidate).includes('reset_skills')),
    ).toBe(true)
  })

  it('records no conversion Skill for an existing Gogma route', async () => {
    const input = createExistingGogmaInput()
    const result = await searchCandidates(
      input,
      createCandidateSearchEngine(input, {
        // The Reset reaches the Ideal five slots, so the composed result is a
        // canonical Ideal Candidate.
        resetResult: structuredClone(input.targetWeapons[0].idealBonuses),
        resetSkillSeriesSkillId: RESET_SERIES_SKILL,
      }),
      deterministicExecution,
    )
    const candidates = candidatesOf(result.targetResult)
    expect(candidates.length).toBeGreaterThan(0)
    candidates.forEach((candidate) => {
      expect(operationTypes(candidate)).not.toContain('convert_normal_to_gogma')
      expect(candidate.conversionSkillTrace).toBeUndefined()
      // The Reset Skills record keeps working exactly as before.
      expect(candidate.skillAmendmentTrace).toBeDefined()
    })
    expect(
      candidates.some((candidate) => (candidate.skillAmendmentTrace ?? []).length > 0),
    ).toBe(true)
  })

  it('predicts each Skill Counter position once even though the record is kept', async () => {
    const input = createCandidateSearchInput()
    input.routeFilter = 'normal_artian'
    requireResetSkills(input)
    const engine = createCandidateSearchEngine(input, {
      resetResult: createRestorationBonusSet(),
        resetSkillSeriesSkillId: RESET_SERIES_SKILL,
    })
    const predictSkills = vi.spyOn(engine, 'predictSkills')
    const result = await searchCandidates(input, engine, deterministicExecution)

    expect(
      candidatesOf(result.targetResult).some(
        ({ conversionSkillTrace }) => conversionSkillTrace !== undefined,
      ),
    ).toBe(true)
    // The record reuses the Skill stream's memoized prediction, so the
    // conversion position is never predicted a second time for display.
    const positions = predictSkills.mock.calls.map(([request]) => request.skillCounter)
    expect(predictSkills).toHaveBeenCalled()
    expect(positions.length).toBe(new Set(positions).size)
  })

  it('leaves Candidate semantic identity untouched', async () => {
    const input = createCandidateSearchInput()
    input.routeFilter = 'normal_artian'
    const result = await searchCandidates(
      input,
      createCandidateSearchEngine(input, { resetResult: createRestorationBonusSet() }),
      deterministicExecution,
    )
    const candidate = findByOperationTypes(candidatesOf(result.targetResult), [
      'create_normal_artian',
      'convert_normal_to_gogma',
      'reset_bonuses',
    ])
    const withoutRecord = structuredClone(candidate)
    delete withoutRecord.conversionSkillTrace
    const alteredRecord = structuredClone(candidate)
    alteredRecord.conversionSkillTrace = {
      operationIndex: 1,
      operationType: 'convert_normal_to_gogma',
      seriesSkillId: null,
      groupSkillId: null,
    }

    for (const variant of [withoutRecord, alteredRecord]) {
      expect(candidateStableKey(variant)).toBe(candidateStableKey(candidate))
      expect(candidateDeduplicationKey(variant)).toBe(candidateDeduplicationKey(candidate))
      expect(createBuildCandidateMeaningFingerprint(variant)).toBe(
        createBuildCandidateMeaningFingerprint(candidate),
      )
      expect(variant.id).toBe(candidate.id)
      expect(variant.searchStateHash).toBe(candidate.searchStateHash)
      expect(variant.referencedOwnedWeaponsHash).toBe(candidate.referencedOwnedWeaponsHash)
    }
  })

  it('validates a conversion Candidate saved before the field existed', async () => {
    const input = createCandidateSearchInput()
    input.routeFilter = 'normal_artian'
    const result = await searchCandidates(
      input,
      createCandidateSearchEngine(input, { resetResult: createRestorationBonusSet() }),
      deterministicExecution,
    )
    const legacy = structuredClone(
      findByOperationTypes(candidatesOf(result.targetResult), [
        'create_normal_artian',
        'convert_normal_to_gogma',
        'reset_bonuses',
      ]),
    )
    delete legacy.conversionSkillTrace

    expect(operationTypes(legacy)).toContain('convert_normal_to_gogma')
    expect(validateBuildCandidate(legacy).isValid).toBe(true)
  })

  it('rejects a record that does not point at the conversion operation', async () => {
    const input = createCandidateSearchInput()
    input.routeFilter = 'normal_artian'
    const result = await searchCandidates(
      input,
      createCandidateSearchEngine(input, { resetResult: createRestorationBonusSet() }),
      deterministicExecution,
    )
    const broken = structuredClone(
      findByOperationTypes(candidatesOf(result.targetResult), [
        'create_normal_artian',
        'convert_normal_to_gogma',
        'reset_bonuses',
      ]),
    )
    broken.conversionSkillTrace = {
      ...(broken.conversionSkillTrace as NonNullable<BuildCandidate['conversionSkillTrace']>),
      operationIndex: 0,
    }

    const validation = validateBuildCandidate(broken)
    expect(validation.isValid).toBe(false)
    expect(validation.issues.map(({ path }) => path)).toContain(
      'conversionSkillTrace.operationIndex',
    )
  })

  it('rejects a record on a Route that has no conversion operation', async () => {
    const input = createExistingGogmaInput()
    const result = await searchCandidates(
      input,
      createCandidateSearchEngine(input, {
        // The Reset reaches the Ideal five slots, so the composed result is a
        // canonical Ideal Candidate.
        resetResult: structuredClone(input.targetWeapons[0].idealBonuses),
        resetSkillSeriesSkillId: RESET_SERIES_SKILL,
      }),
      deterministicExecution,
    )
    const broken = structuredClone(candidatesOf(result.targetResult)[0])
    expect(operationTypes(broken)).not.toContain('convert_normal_to_gogma')
    broken.conversionSkillTrace = {
      operationIndex: 0,
      operationType: 'convert_normal_to_gogma',
      ...CONVERSION_SKILLS,
    }

    const validation = validateBuildCandidate(broken)
    expect(validation.isValid).toBe(false)
    expect(validation.issues.map(({ path }) => path)).toContain('conversionSkillTrace')
  })
})

describe('createCandidateConversionSkillStep', () => {
  const conversion = (skillCounterBefore: number): RouteOperation => ({
    type: 'convert_normal_to_gogma',
    weaponTypeId: 'weapon.fixture.a',
    skillCounterBefore,
    skillCounterAfter: skillCounterBefore + 1,
  })
  const create: RouteOperation = {
    type: 'create_normal_artian',
    weaponTypeId: 'weapon.fixture.a',
    rarity: 8,
    count: 1,
    normalCounterBefore: 4,
    normalCounterAfter: 5,
  }
  const resetSkills: RouteOperation = {
    type: 'reset_skills',
    sourceOwnedWeaponId: null,
    skillCounterBefore: 8,
    skillCounterAfter: 9,
  }

  it('binds the result to the conversion position inside the whole Route', () => {
    expect(
      createCandidateConversionSkillStep(
        [create, conversion(7), resetSkills],
        CONVERSION_SKILLS,
      ),
    ).toEqual({
      operationIndex: 1,
      operationType: 'convert_normal_to_gogma',
      ...CONVERSION_SKILLS,
    })
  })

  it('fails loudly when the Route contains no conversion', () => {
    expect(() =>
      createCandidateConversionSkillStep([resetSkills], CONVERSION_SKILLS),
    ).toThrow(CandidateSearchError)
  })

  it('fails loudly instead of binding one of several conversions', () => {
    expect(() =>
      createCandidateConversionSkillStep(
        [conversion(7), conversion(8)],
        CONVERSION_SKILLS,
      ),
    ).toThrow(/2 conversion operation\(s\)/)
  })
})

describe('conversionSkillPrediction', () => {
  const route = (types: readonly RouteOperation['type'][]) => ({
    kind: 'normal_artian_to_gogma' as const,
    sourceOwnedWeaponId: null,
    operations: types.map((type) =>
      type === 'convert_normal_to_gogma'
        ? {
            type,
            weaponTypeId: 'weapon.fixture.a',
            skillCounterBefore: 7,
            skillCounterAfter: 8,
          }
        : {
            type: 'reset_skills' as const,
            sourceOwnedWeaponId: null,
            skillCounterBefore: 8,
            skillCounterAfter: 9,
          },
    ) as RouteOperation[],
  })

  it('passes the record through for a conversion Route', () => {
    expect(
      conversionSkillPrediction(route(['convert_normal_to_gogma']), CONVERSION_SKILLS),
    ).toEqual(CONVERSION_SKILLS)
  })

  it('reports no record for a Route without a conversion', () => {
    expect(conversionSkillPrediction(route(['reset_skills']), null)).toBeUndefined()
  })

  it('fails loudly when a conversion Route supplies no record', () => {
    expect(() =>
      conversionSkillPrediction(route(['convert_normal_to_gogma']), null),
    ).toThrow(CandidateSearchError)
  })

  it('fails loudly when a Route without a conversion supplies a record', () => {
    expect(() =>
      conversionSkillPrediction(route(['reset_skills']), CONVERSION_SKILLS),
    ).toThrow(CandidateSearchError)
  })
})
