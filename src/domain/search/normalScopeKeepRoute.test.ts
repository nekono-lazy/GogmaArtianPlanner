import { candidatesOf } from '../../test/fixtures/candidateSearch'
import { describe, expect, it } from 'vitest'
import type { BuildRoute } from '../models/publicTypes'
import { searchCandidates } from './candidateSearch'
import { enumerateConstrainedCandidates } from './constrained/constrainedEnumeration'
import {
  belowPracticalBonuses,
  candidateSearchInputFromOrigin,
  constrainedBounds,
  constrainedInput,
  createConstrainedEngine,
  createConstrainedSearchOrigin,
  gogmaWeapon,
  idealBonuses,
  IDEAL_SERIES_SKILL_ID,
  normalWeapon,
} from '../../test/fixtures/constrainedEnumeration'
import type { ConstrainedSearchOrigin } from './constrained/constrainedTypes'
import type { FakeRngEngine } from '../rng/fakeRngEngine'

/**
 * `docs/SEARCH_SPEC.md` 5.9: Keep is generated as the first Bonus amendment
 * whenever the Route base's five slots are known - an owned Normal after
 * conversion, an owned `normal_artian` scope Gogma, and a predicted new Normal
 * after conversion. Only a blind Normal (6.1.1), whose slots are unknown,
 * starts with Reset. Both Search boundaries must agree, because both delegate
 * to the same Domain authority.
 *
 * The Engine fixture makes Reset reach nothing the Target accepts and Keep from
 * the known five slots reach the Ideal, so a Keep-first Route is the canonical
 * Ideal Route wherever Keep is legal.
 */
function keepFirstEngine(origin: ConstrainedSearchOrigin): FakeRngEngine {
  return createConstrainedEngine(origin, {
    keepSupported: true,
    // Depth 2 also Keeps from the depth-1 Keep result, which is the Ideal.
    keepInputs: [belowPracticalBonuses(), idealBonuses()],
    normalResultAt: () => belowPracticalBonuses(),
    resetResultAt: () => belowPracticalBonuses(),
    keepResultAt: () => idealBonuses(),
  })
}

function amendmentTypes(route: BuildRoute): string[] {
  return route.operations
    .filter(({ type }) => type === 'reset_bonuses' || type === 'keep_bonuses')
    .map(({ type }) => type)
}

async function routesOfBothBoundaries(origin: ConstrainedSearchOrigin) {
  const ordinary = await searchCandidates(
    candidateSearchInputFromOrigin(origin, { maxGogmaAdvance: 2 }),
    keepFirstEngine(origin),
  )
  const constrained = await enumerateConstrainedCandidates(
    constrainedInput(origin, constrainedBounds({ maxGogmaAdvance: 2, maxSkillResetCount: 1 })),
    keepFirstEngine(origin),
  )
  return {
    ordinary: candidatesOf(ordinary.targetResult),
    constrained: constrained.candidates,
  }
}

describe('Keep as the first Bonus amendment from known normal-scope slots', () => {
  it('Keeps an inherited normal-scope owned Gogma without any conversion or Reset', async () => {
    const origin = createConstrainedSearchOrigin({
      normalCounters: [],
      ownedWeapons: [
        gogmaWeapon('owned.constrained.inherited', {
          restorationBonusScope: 'normal_artian',
          restorationBonuses: belowPracticalBonuses(),
          // The Ideal Skill is already held, so only the Bonus axis moves.
          seriesSkillId: IDEAL_SERIES_SKILL_ID,
        }),
      ],
    })
    const { ordinary, constrained } = await routesOfBothBoundaries(origin)
    expect(ordinary).toHaveLength(1)
    expect(ordinary[0].route.kind).toBe('existing_gogma_keep_bonuses')
    expect(ordinary[0].route.operations.map(({ type }) => type)).toEqual(['keep_bonuses'])
    expect(ordinary[0].restorationBonusScope).toBe('gogma_artian')
    const keepOnly = constrained.filter(({ route }) => route.kind === 'existing_gogma_keep_bonuses')
    expect(keepOnly.length).toBeGreaterThan(0)
    expect(keepOnly[0].route.operations.map(({ type }) => type)).toEqual(['keep_bonuses'])
    expect(keepOnly[0].restorationBonusScope).toBe('gogma_artian')
  })

  it('Keeps the converted owned Normal Artian directly after conversion', async () => {
    const origin = createConstrainedSearchOrigin({
      normalCounters: [],
      ownedWeapons: [
        normalWeapon('owned.constrained.normal', {
          restorationBonuses: belowPracticalBonuses(),
        }),
      ],
    })
    const { ordinary, constrained } = await routesOfBothBoundaries(origin)
    expect(ordinary).toHaveLength(1)
    expect(ordinary[0].route.kind).toBe('owned_normal_artian_to_gogma')
    expect(ordinary[0].route.operations.map(({ type }) => type))
      .toEqual(['convert_normal_to_gogma', 'keep_bonuses'])
    expect(ordinary[0].restorationBonusScope).toBe('gogma_artian')
    const converted = constrained.filter(({ route }) => route.kind === 'owned_normal_artian_to_gogma')
    expect(converted.some(({ route }) => amendmentTypes(route)[0] === 'keep_bonuses')).toBe(true)
  })

  it('Keeps a predicted new Normal Artian directly after conversion', async () => {
    const origin = createConstrainedSearchOrigin()
    const { ordinary, constrained } = await routesOfBothBoundaries(origin)
    expect(ordinary).toHaveLength(1)
    expect(ordinary[0].route.kind).toBe('normal_artian_to_gogma')
    expect(ordinary[0].route.operations.map(({ type }) => type))
      .toEqual(['create_normal_artian', 'convert_normal_to_gogma', 'keep_bonuses'])
    // The predicted variant: the forged slots are known, so no Reset is forced.
    expect(ordinary[0].route.operations[0]).toEqual(
      expect.objectContaining({ type: 'create_normal_artian', normalCounterBefore: 4, normalCounterAfter: 5 }),
    )
    expect(ordinary[0].restorationBonusScope).toBe('gogma_artian')
    const created = constrained.filter(({ route }) => route.kind === 'normal_artian_to_gogma')
    expect(created.some(({ route }) => amendmentTypes(route)[0] === 'keep_bonuses')).toBe(true)
  })

  it('still starts a blind new Normal Artian with Reset and Keeps only after it', async () => {
    const origin = createConstrainedSearchOrigin({ normalCounters: [], ownedWeapons: [] })
    const result = await searchCandidates(
      candidateSearchInputFromOrigin(origin, { maxGogmaAdvance: 2 }),
      keepFirstEngine(origin),
    )
    const candidates = candidatesOf(result.targetResult)
    expect(candidates).toHaveLength(1)
    expect(candidates[0].route.operations.map(({ type }) => type))
      .toEqual(['create_normal_artian', 'convert_normal_to_gogma', 'reset_bonuses', 'keep_bonuses'])
    expect(candidates[0].route.operations[0]).toEqual(
      expect.objectContaining({ type: 'create_normal_artian', normalCounterBefore: null, normalCounterAfter: null }),
    )
    // The unknown slots are an input problem, never a prediction-support gap.
    expect(result.warnings.filter(({ severity }) => severity === 'warning')).toEqual([])
  })
})
