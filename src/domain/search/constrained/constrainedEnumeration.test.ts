import { describe, expect, it, vi } from 'vitest'
import {
  enumerateConstrainedCandidates,
  hasOffAxisCells,
} from './constrainedEnumeration'
import { constrainedCandidateStableKey } from './constrainedCandidateFactory'
import type { ConstrainedCandidate } from './constrainedTypes'
import { CandidateSearchError } from '../searchTypes'
import { areRestorationBonusSetsEqual } from '../../models/publicTypes'
import {
  alternativePracticalBonuses,
  belowPracticalBonuses,
  constrainedBounds,
  constrainedInput,
  createConstrainedEngine,
  createConstrainedSearchOrigin,
  gogmaWeapon,
  idealBonuses,
  normalWeapon,
  practicalBonuses,
  practicalVariant,
} from '../../../test/fixtures/constrainedEnumeration'

const IDEAL_SKILL = 'series_skill.fixture.a'

function routeKinds(candidates: readonly ConstrainedCandidate[]): string[] {
  return [...new Set(candidates.map((candidate) => candidate.route.kind))].sort()
}

/**
 * An existing Gogma source whose Reset yields the Ideal five slots and whose
 * first Reset Skills yields the Ideal Series Skill, so one Ideal and several
 * strictly more expensive Practical Candidates coexist.
 */
function idealReachableSetup() {
  const origin = createConstrainedSearchOrigin({
    normalCounters: [],
    ownedWeapons: [
      gogmaWeapon('owned.constrained.gogma', {
        restorationBonuses: belowPracticalBonuses(),
        seriesSkillId: 'series_skill.fixture.z',
      }),
    ],
  })
  const engine = createConstrainedEngine(origin, {
    resetResultAt: (gogmaCounter) =>
      gogmaCounter === 10 ? idealBonuses() : belowPracticalBonuses(),
    skillResultAt: (skillCounter) => ({
      seriesSkillId:
        skillCounter === 7 ? IDEAL_SKILL : `series_skill.fixture.s${skillCounter}`,
      groupSkillId: null,
    }),
  })
  return { origin, engine }
}

describe('Constrained route policy', () => {
  it('enumerates every currently legal Route without a route filter', async () => {
    const origin = createConstrainedSearchOrigin({
      ownedWeapons: [
        normalWeapon('owned.constrained.normal'),
        gogmaWeapon('owned.constrained.gogma'),
      ],
    })
    const engine = createConstrainedEngine(origin, {
      resetResultAt: () => alternativePracticalBonuses(),
    })
    const result = await enumerateConstrainedCandidates(
      constrainedInput(
        origin,
        constrainedBounds({
          maxNormalForgeCount: 1,
          maxGogmaAdvance: 1,
          maxSkillResetCount: 1,
        }),
      ),
      engine,
    )
    expect(routeKinds(result.candidates)).toEqual([
      'existing_gogma_reset_bonuses',
      'existing_gogma_reset_skills',
      'normal_artian_to_gogma',
      'owned_normal_artian_to_gogma',
    ])
  })

  it('skips only the Route whose Production input support is missing', async () => {
    const origin = createConstrainedSearchOrigin({
      ownedWeapons: [
        normalWeapon('owned.constrained.normal'),
        gogmaWeapon('owned.constrained.gogma'),
      ],
    })
    const engine = createConstrainedEngine(origin, {
      normalSupported: false,
      resetResultAt: () => alternativePracticalBonuses(),
    })
    const result = await enumerateConstrainedCandidates(
      constrainedInput(
        origin,
        constrainedBounds({
          maxNormalForgeCount: 1,
          maxGogmaAdvance: 1,
          maxSkillResetCount: 1,
        }),
      ),
      engine,
    )
    expect(routeKinds(result.candidates)).toEqual([
      'existing_gogma_reset_bonuses',
      'existing_gogma_reset_skills',
      'owned_normal_artian_to_gogma',
    ])
  })

  it('drops every conversion Route when Skill prediction is unsupported', async () => {
    const origin = createConstrainedSearchOrigin({
      ownedWeapons: [
        normalWeapon('owned.constrained.normal'),
        gogmaWeapon('owned.constrained.gogma'),
      ],
    })
    const engine = createConstrainedEngine(origin, {
      skillSupported: false,
      resetResultAt: () => alternativePracticalBonuses(),
    })
    const result = await enumerateConstrainedCandidates(
      constrainedInput(
        origin,
        constrainedBounds({
          maxNormalForgeCount: 1,
          maxGogmaAdvance: 1,
          maxSkillResetCount: 1,
        }),
      ),
      engine,
    )
    expect(routeKinds(result.candidates)).toEqual(['existing_gogma_reset_bonuses'])
  })

  it('never uses a protected owned Normal Artian weapon as a conversion source', async () => {
    const origin = createConstrainedSearchOrigin({
      normalCounters: [],
      ownedWeapons: [normalWeapon('owned.constrained.normal', { isProtected: true })],
    })
    const result = await enumerateConstrainedCandidates(
      constrainedInput(origin, constrainedBounds()),
      createConstrainedEngine(origin),
    )
    expect(result.candidates).toEqual([])
  })

  it('never schedules a destructive amendment on a protected Gogma source', async () => {
    const origin = createConstrainedSearchOrigin({
      normalCounters: [],
      ownedWeapons: [
        gogmaWeapon('owned.constrained.protected', {
          isProtected: true,
          status: 'practical',
        }),
      ],
    })
    const engine = createConstrainedEngine(origin, {
      resetResultAt: () => alternativePracticalBonuses(),
    })
    const result = await enumerateConstrainedCandidates(
      constrainedInput(
        origin,
        constrainedBounds({ maxGogmaAdvance: 1, maxSkillResetCount: 1 }),
      ),
      engine,
    )
    // Reset Skills stays legal on a protected weapon in v1.
    expect(routeKinds(result.candidates)).toEqual(['existing_gogma_reset_skills'])
  })
})

describe('Constrained Candidate yield contract', () => {
  it('yields Ideal and Practical Candidates and nothing below the Practical line', async () => {
    const { origin, engine } = idealReachableSetup()
    const result = await enumerateConstrainedCandidates(
      constrainedInput(
        origin,
        constrainedBounds({ maxGogmaAdvance: 2, maxSkillResetCount: 2 }),
      ),
      engine,
    )
    expect(result.candidates.some(({ category }) => category === 'ideal')).toBe(true)
    expect(result.candidates.some(({ category }) => category === 'practical')).toBe(true)
    for (const candidate of result.candidates) {
      expect(['ideal', 'practical']).toContain(candidate.category)
      expect(
        areRestorationBonusSetsEqual(candidate.finalBonuses, belowPracticalBonuses()),
      ).toBe(false)
    }
  })

  it('does not stop at the canonical Ideal or apply the initial Practical horizon', async () => {
    const { origin, engine } = idealReachableSetup()
    const result = await enumerateConstrainedCandidates(
      constrainedInput(
        origin,
        constrainedBounds({ maxGogmaAdvance: 2, maxSkillResetCount: 2 }),
      ),
      engine,
    )
    const ideal = result.candidates.find(({ category }) => category === 'ideal')
    expect(ideal).toBeDefined()
    const beyondIdeal = result.candidates.filter(
      (candidate) =>
        candidate.estimatedOperationCount >
        (ideal as ConstrainedCandidate).estimatedOperationCount,
    )
    // The initial Search would drop every Practical past the canonical Ideal's
    // operation count; constrained enumeration keeps them.
    expect(beyondIdeal.length).toBeGreaterThan(0)
    expect(result.candidates).toHaveLength(3)
  })

  it('does not apply the initial-Search Practical dominance', async () => {
    const origin = createConstrainedSearchOrigin({
      normalCounters: [],
      ownedWeapons: [
        gogmaWeapon('owned.constrained.gogma', {
          restorationBonuses: belowPracticalBonuses(),
        }),
      ],
    })
    const engine = createConstrainedEngine(origin, {
      resetResultAt: (gogmaCounter) =>
        gogmaCounter === 10 || gogmaCounter === 12
          ? practicalBonuses()
          : belowPracticalBonuses(),
    })
    const result = await enumerateConstrainedCandidates(
      constrainedInput(
        origin,
        constrainedBounds({ maxGogmaAdvance: 3, maxSkillResetCount: 1 }),
      ),
      engine,
    )
    const sameResult = result.candidates
      .filter(
        (candidate) =>
          candidate.estimatedSkillAdvance === 0 &&
          areRestorationBonusSetsEqual(candidate.finalBonuses, practicalBonuses()),
      )
      .sort((left, right) => left.estimatedGogmaAdvance - right.estimatedGogmaAdvance)
    expect(sameResult).toHaveLength(2)
    const [cheaper, dearer] = sameResult
    // Identical completed result, skills, source weapon and destructive kind,
    // with the later position strictly worse on every cost axis: exactly the
    // pair the initial Search drops. The Planner may still need the later one.
    expect(cheaper.estimatedOperationCount).toBeLessThan(dearer.estimatedOperationCount)
    expect(cheaper.estimatedGogmaAdvance).toBeLessThan(dearer.estimatedGogmaAdvance)
    expect(cheaper.seriesSkillId).toBe(dearer.seriesSkillId)
    expect(cheaper.route.sourceOwnedWeaponId).toBe(dearer.route.sourceOwnedWeaponId)
    expect(constrainedCandidateStableKey(cheaper)).not.toBe(
      constrainedCandidateStableKey(dearer),
    )
  })

  it('records concrete ordered operations and the two semantic hashes', async () => {
    const origin = createConstrainedSearchOrigin({
      ownedWeapons: [gogmaWeapon('owned.constrained.gogma')],
    })
    const engine = createConstrainedEngine(origin, {
      resetResultAt: () => alternativePracticalBonuses(),
    })
    const result = await enumerateConstrainedCandidates(
      constrainedInput(
        origin,
        constrainedBounds({
          maxNormalForgeCount: 1,
          maxGogmaAdvance: 1,
          maxSkillResetCount: 1,
        }),
      ),
      engine,
    )
    const forged = result.candidates.find(
      ({ route }) => route.kind === 'normal_artian_to_gogma',
    )
    expect(forged).toBeDefined()
    expect((forged as ConstrainedCandidate).route.sourceOwnedWeaponId).toBeNull()
    expect((forged as ConstrainedCandidate).referencedOwnedWeaponsHash).toBeNull()
    expect((forged as ConstrainedCandidate).searchStateHash).toMatch(/^fnv1a32:/)
    const existing = result.candidates.find(({ route }) =>
      route.kind.startsWith('existing_gogma_'),
    )
    expect((existing as ConstrainedCandidate).referencedOwnedWeaponsHash).toMatch(
      /^fnv1a32:/,
    )
    for (const candidate of result.candidates) {
      expect(candidate.calculationContext).toEqual(origin.calculationContext)
      expect(candidate.similarityScore).toBeGreaterThanOrEqual(0)
      expect(candidate.similarityScore).toBeLessThanOrEqual(1)
    }
  })
})

describe('Constrained enumeration determinism', () => {
  it('produces no run or persistence metadata on a Candidate', async () => {
    const { origin, engine } = idealReachableSetup()
    const result = await enumerateConstrainedCandidates(
      constrainedInput(
        origin,
        constrainedBounds({ maxGogmaAdvance: 2, maxSkillResetCount: 2 }),
      ),
      engine,
    )
    expect(result.candidates.length).toBeGreaterThan(0)
    for (const candidate of result.candidates) {
      for (const runField of ['id', 'searchRunId', 'createdAt', 'isSimilarToIdeal']) {
        expect(candidate).not.toHaveProperty(runField)
      }
      expect(Object.keys(candidate).sort()).toEqual([
        'calculationContext',
        'category',
        'estimatedGogmaAdvance',
        'estimatedNormalAdvance',
        'estimatedOperationCount',
        'estimatedSkillAdvance',
        'finalBonuses',
        'groupSkillId',
        'idealDifference',
        'referencedOwnedWeaponsHash',
        'requiredMaterials',
        'restorationBonusScope',
        'route',
        'searchStateHash',
        'seriesSkillId',
        'similarityScore',
        'targetWeaponId',
      ])
    }
  })

  it('repeats the identical ordered sequence for the same input and bounds', async () => {
    const bounds = constrainedBounds({
      maxNormalForgeCount: 3,
      maxGogmaAdvance: 2,
      maxSkillResetCount: 2,
    })
    const runOnce = async () => {
      const origin = createConstrainedSearchOrigin({
        ownedWeapons: [
          normalWeapon('owned.constrained.normal'),
          gogmaWeapon('owned.constrained.gogma'),
        ],
      })
      const engine = createConstrainedEngine(origin, {
        resetResultAt: () => alternativePracticalBonuses(),
      })
      return enumerateConstrainedCandidates(constrainedInput(origin, bounds), engine)
    }
    const first = await runOnce()
    const second = await runOnce()
    expect(first.candidates.length).toBeGreaterThan(1)
    expect(second.candidates).toEqual(first.candidates)
    expect(second.candidates.map(constrainedCandidateStableKey)).toEqual(
      first.candidates.map(constrainedCandidateStableKey),
    )
    expect(second.summary).toEqual(first.summary)
  })

  it('does not depend on the stored order of owned weapons or counters', async () => {
    const bounds = constrainedBounds({
      maxNormalForgeCount: 1,
      maxGogmaAdvance: 1,
      maxSkillResetCount: 1,
    })
    const build = (reversed: boolean) => {
      const weapons = [
        gogmaWeapon('owned.constrained.gogma.b'),
        gogmaWeapon('owned.constrained.gogma.a'),
      ]
      const origin = createConstrainedSearchOrigin({
        ownedWeapons: reversed ? [...weapons].reverse() : weapons,
      })
      return {
        origin,
        engine: createConstrainedEngine(origin, {
          resetResultAt: () => alternativePracticalBonuses(),
        }),
      }
    }
    const forward = build(false)
    const reversed = build(true)
    const first = await enumerateConstrainedCandidates(
      constrainedInput(forward.origin, bounds),
      forward.engine,
    )
    const second = await enumerateConstrainedCandidates(
      constrainedInput(reversed.origin, bounds),
      reversed.engine,
    )
    expect(second.candidates.map(constrainedCandidateStableKey)).toEqual(
      first.candidates.map(constrainedCandidateStableKey),
    )
  })
})

describe('Constrained enumeration summary', () => {
  it('counts every completed combination carried to Target evaluation', async () => {
    const { origin, engine } = idealReachableSetup()
    const result = await enumerateConstrainedCandidates(
      constrainedInput(
        origin,
        constrainedBounds({ maxGogmaAdvance: 2, maxSkillResetCount: 2 }),
      ),
      engine,
    )
    expect(result.summary.examinedCandidates).toBe(3)
    // B8-B1a composes the two Cross axes only; off-axis pairs arrive in B8-B1b.
    expect(result.summary.evaluatedOffAxisPairs).toBe(0)
  })

  it('reports a Gogma bound stop and never calls it exhaustion', async () => {
    const origin = createConstrainedSearchOrigin({
      normalCounters: [],
      ownedWeapons: [
        gogmaWeapon('owned.constrained.gogma', {
          restorationBonuses: belowPracticalBonuses(),
        }),
      ],
    })
    const engine = createConstrainedEngine(origin, {
      resetResultAt: () => practicalBonuses(),
    })
    const result = await enumerateConstrainedCandidates(
      constrainedInput(
        origin,
        constrainedBounds({ maxGogmaAdvance: 2, maxSkillResetCount: 2 }),
      ),
      engine,
    )
    expect(result.summary.stoppedByBound).toBe(true)
    expect(result.summary.exhausted).toBe(false)
  })

  it('claims neither exhaustion nor a bound stop while off-axis cells remain', async () => {
    const origin = createConstrainedSearchOrigin({
      normalCounters: [],
      ownedWeapons: [
        gogmaWeapon('owned.constrained.gogma', {
          restorationBonuses: practicalBonuses(),
        }),
      ],
    })
    const engine = createConstrainedEngine(origin, {
      resetResultAt: () => alternativePracticalBonuses(),
      gogmaPositions: 1,
      skillPositions: 1,
    })
    const result = await enumerateConstrainedCandidates(
      constrainedInput(
        origin,
        constrainedBounds({ maxGogmaAdvance: 1, maxSkillResetCount: 1 }),
      ),
      engine,
    )
    // Both axes hold more than one solution, so off-axis Cross cells exist and
    // B8-B1a has not evaluated them. Neither flag may be raised.
    expect(result.summary.stoppedByBound).toBe(true)
    expect(result.summary.exhausted).toBe(false)
  })

  it('reports exhaustion when no bound truncated the enumeration', async () => {
    const origin = createConstrainedSearchOrigin({
      normalCounters: [],
      ownedWeapons: [
        gogmaWeapon('owned.constrained.gogma', {
          restorationBonuses: idealBonuses(),
          seriesSkillId: IDEAL_SKILL,
        }),
      ],
    })
    // Both streams already satisfy the Ideal condition, so neither is searched
    // and no bound can truncate the enumeration.
    const result = await enumerateConstrainedCandidates(
      constrainedInput(
        origin,
        constrainedBounds({ maxGogmaAdvance: 2, maxSkillResetCount: 2 }),
      ),
      createConstrainedEngine(origin),
    )
    expect(result.candidates).toEqual([])
    expect(result.summary.stoppedByBound).toBe(false)
    expect(result.summary.exhausted).toBe(true)
  })
})

describe('Constrained enumeration execution', () => {
  it('stops on cancellation and yields no Candidate', async () => {
    const origin = createConstrainedSearchOrigin()
    await expect(
      enumerateConstrainedCandidates(
        constrainedInput(origin, constrainedBounds()),
        createConstrainedEngine(origin),
        { shouldCancel: () => true },
      ),
    ).rejects.toMatchObject({ name: 'CandidateSearchError', code: 'cancelled' })
  })

  it('stops mid-enumeration once cancellation is requested', async () => {
    const origin = createConstrainedSearchOrigin()
    const engine = createConstrainedEngine(origin, { normalPositions: 40 })
    let checkpoints = 0
    await expect(
      enumerateConstrainedCandidates(
        constrainedInput(origin, constrainedBounds({ maxNormalForgeCount: 30 })),
        engine,
        {
          shouldCancel: () => {
            checkpoints += 1
            return checkpoints > 5
          },
        },
      ),
    ).rejects.toBeInstanceOf(CandidateSearchError)
  })

  it('yields control to the Worker during a long enumeration', async () => {
    const origin = createConstrainedSearchOrigin()
    const engine = createConstrainedEngine(origin, { normalPositions: 80 })
    const yieldControl = vi.fn(() => Promise.resolve())
    await enumerateConstrainedCandidates(
      constrainedInput(
        origin,
        constrainedBounds({
          maxNormalForgeCount: 70,
          maxGogmaAdvance: 1,
          maxSkillResetCount: 1,
        }),
      ),
      engine,
      { yieldControl },
    )
    expect(yieldControl).toHaveBeenCalled()
  })
})

describe('Off-axis Cross cells in B8-B1a', () => {
  it('decides off-axis availability from the two axis lengths alone', () => {
    // A single-solution axis has no off-axis cell, so it must never mark the
    // enumeration as incomplete.
    expect(hasOffAxisCells(1, 1)).toBe(false)
    expect(hasOffAxisCells(5, 1)).toBe(false)
    expect(hasOffAxisCells(1, 5)).toBe(false)
    expect(hasOffAxisCells(2, 2)).toBe(true)
    expect(hasOffAxisCells(30, 30)).toBe(true)
  })

  it('reports unevaluated off-axis cells when both axes hold several solutions', async () => {
    const origin = createConstrainedSearchOrigin({
      normalCounters: [],
      ownedWeapons: [
        gogmaWeapon('owned.constrained.gogma', {
          restorationBonuses: practicalBonuses(),
        }),
      ],
    })
    const engine = createConstrainedEngine(origin, {
      resetResultAt: () => alternativePracticalBonuses(),
    })
    const result = await enumerateConstrainedCandidates(
      constrainedInput(
        origin,
        constrainedBounds({ maxGogmaAdvance: 1, maxSkillResetCount: 1 }),
      ),
      engine,
    )
    expect(result.summary.exhausted).toBe(false)
    expect(result.summary.evaluatedOffAxisPairs).toBe(0)
  })

  it('does not treat a single-solution axis as an unevaluated off-axis cell', async () => {
    const origin = createConstrainedSearchOrigin({
      normalCounters: [],
      ownedWeapons: [
        gogmaWeapon('owned.constrained.gogma', {
          restorationBonuses: idealBonuses(),
          seriesSkillId: IDEAL_SKILL,
        }),
      ],
    })
    // Both streams already satisfy Ideal, so each axis holds only its
    // zero-operation solution and no bound is reached.
    const result = await enumerateConstrainedCandidates(
      constrainedInput(
        origin,
        constrainedBounds({ maxGogmaAdvance: 2, maxSkillResetCount: 2 }),
      ),
      createConstrainedEngine(origin),
    )
    expect(result.summary.stoppedByBound).toBe(false)
    expect(result.summary.exhausted).toBe(true)
    expect(result.summary.evaluatedOffAxisPairs).toBe(0)
  })

  it('stays linear in the axis lengths instead of scanning the Cartesian product', async () => {
    const axisDepth = 30
    const callCounts = { normal: 0, skill: 0, gogmaReset: 0, gogmaKeep: 0 }
    const origin = createConstrainedSearchOrigin({
      normalCounters: [],
      ownedWeapons: [
        gogmaWeapon('owned.constrained.gogma', {
          restorationBonuses: practicalVariant(0),
        }),
      ],
    })
    const engine = createConstrainedEngine(origin, {
      callCounts,
      gogmaPositions: axisDepth + 2,
      skillPositions: axisDepth + 2,
      // Every Gogma position yields a distinct Practical result and every Skill
      // position a distinct Series Skill, so both axes are long.
      resetResultAt: (gogmaCounter) => practicalVariant(gogmaCounter - 9),
    })
    const result = await enumerateConstrainedCandidates(
      constrainedInput(
        origin,
        constrainedBounds({
          maxGogmaAdvance: axisDepth,
          maxSkillResetCount: axisDepth,
        }),
      ),
      engine,
    )

    // |B(practical)| = |K(practical)| = 1 zero-operation solution + 30 stream
    // solutions. The Cross rule composes |B| + |K| - 1 pairs, and the existing
    // Gogma d = 0 / k = 0 pair is not a Candidate, so 60 combinations reach
    // Target evaluation. A Cartesian traversal would be 31 * 31 = 961.
    const axisSize = axisDepth + 1
    expect(result.summary.examinedCandidates).toBe(axisSize + axisSize - 2)
    expect(result.summary.examinedCandidates).toBeLessThan(axisSize * axisSize)
    expect(result.candidates).toHaveLength(axisSize + axisSize - 2)
    // Prediction stays one call per Counter position on each stream.
    expect(callCounts.gogmaReset).toBe(axisDepth)
    expect(callCounts.skill).toBe(axisDepth)
    expect(result.summary.evaluatedOffAxisPairs).toBe(0)
    expect(result.summary.exhausted).toBe(false)
  })
})
