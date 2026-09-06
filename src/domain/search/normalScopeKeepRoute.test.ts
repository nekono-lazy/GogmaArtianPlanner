import { describe, expect, it } from 'vitest'
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
  practicalBonuses,
} from '../../test/fixtures/constrainedEnumeration'

/**
 * AGENTS.md Existing Gogma Mixed: a mixed Route whose source still holds
 * inherited `normal_artian` scope performs Reset Bonuses before any Keep
 * Bonuses. The Reset moves the route-local scope to `gogma_artian`, so the
 * following Keep is inside the existing Production Keep prediction support.
 *
 * This is not B11. B11 is the still-unverified direct prediction of Keep from
 * `normal_artian` scope current bonuses, which neither Search boundary emits.
 *
 * Both Search boundaries must reach the same conclusion because both delegate
 * to the same Domain authority, `validateBuildRoute()`.
 */
function inheritedScopeSetup() {
  const origin = createConstrainedSearchOrigin({
    normalCounters: [],
    ownedWeapons: [
      gogmaWeapon('owned.constrained.inherited', {
        restorationBonusScope: 'normal_artian',
        restorationBonuses: belowPracticalBonuses(),
      }),
    ],
  })
  const engine = createConstrainedEngine(origin, {
    keepSupported: true,
    keepInputs: [belowPracticalBonuses()],
    resetResultAt: () => belowPracticalBonuses(),
    keepResultAt: () => practicalBonuses(),
  })
  return { origin, engine }
}

describe('Reset Bonuses then Keep Bonuses from an inherited normal-scope Gogma', () => {
  it('is produced by ordinary Candidate Search without throwing', async () => {
    const { origin, engine } = inheritedScopeSetup()
    const result = await searchCandidates(
      candidateSearchInputFromOrigin(origin, { maxGogmaAdvance: 2 }),
      engine,
    )
    const mixed = result.targetResults[0].candidates.filter((candidate) =>
      candidate.route.operations.some(({ type }) => type === 'keep_bonuses'),
    )
    expect(mixed.length).toBeGreaterThan(0)
    expect(mixed[0].route.kind).toBe('existing_gogma_mixed')
    expect(
      mixed[0].route.operations
        .filter(
          ({ type }) => type === 'reset_bonuses' || type === 'keep_bonuses',
        )
        .map(({ type }) => type),
    ).toEqual(['reset_bonuses', 'keep_bonuses'])
    expect(mixed[0].restorationBonusScope).toBe('gogma_artian')
  })

  it('is produced by the constrained enumerator from the same origin', async () => {
    const { origin, engine } = inheritedScopeSetup()
    const result = await enumerateConstrainedCandidates(
      constrainedInput(
        origin,
        constrainedBounds({ maxGogmaAdvance: 2, maxSkillResetCount: 1 }),
      ),
      engine,
    )
    const mixed = result.candidates.filter((candidate) =>
      candidate.route.operations.some(({ type }) => type === 'keep_bonuses'),
    )
    expect(mixed.length).toBeGreaterThan(0)
    expect(mixed[0].route.kind).toBe('existing_gogma_mixed')
    expect(
      mixed[0].route.operations
        .filter(
          ({ type }) => type === 'reset_bonuses' || type === 'keep_bonuses',
        )
        .map(({ type }) => type),
    ).toEqual(['reset_bonuses', 'keep_bonuses'])
    expect(mixed[0].restorationBonusScope).toBe('gogma_artian')
  })

  it('never emits Keep Bonuses as the first amendment in either boundary', async () => {
    const { origin, engine } = inheritedScopeSetup()
    const ordinary = await searchCandidates(
      candidateSearchInputFromOrigin(origin, { maxGogmaAdvance: 2 }),
      engine,
    )
    const constrained = await enumerateConstrainedCandidates(
      constrainedInput(
        origin,
        constrainedBounds({ maxGogmaAdvance: 2, maxSkillResetCount: 1 }),
      ),
      engine,
    )
    const routes = [
      ...ordinary.targetResults[0].candidates.map(({ route }) => route),
      ...constrained.candidates.map(({ route }) => route),
    ]
    expect(routes.length).toBeGreaterThan(0)
    for (const route of routes) {
      const amendments = route.operations
        .filter(({ type }) => type === 'reset_bonuses' || type === 'keep_bonuses')
        .map(({ type }) => type)
      if (amendments.length > 0) expect(amendments[0]).toBe('reset_bonuses')
    }
  })
})
