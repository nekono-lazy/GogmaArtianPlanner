import { describe, expect, it, vi } from 'vitest'
import {
  enumerateConstrainedCandidates,
  visitConstrainedCandidates,
} from './constrainedEnumeration'
import {
  compareConstrainedCandidates,
  constrainedCandidateStableKey,
} from './constrainedCandidateFactory'
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
      groupSkillId: 'group_skill.fixture.a',
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
        'conditionMatch',
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
    // The default bounds cap off-axis evaluation at zero, which is the
    // Cross-only policy, so only the two axes were composed here.
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

  it('reports a bound stop while reachable off-axis cells stay unevaluated', async () => {
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
    // Both axes hold more than one solution, so reachable off-axis Cross cells
    // exist while the cap refuses them. Together with the Gogma and Skill
    // stream bounds that is a bound stop, and never exhaustion.
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

/**
 * A Route base whose Bonus and Skill axes are both long enough to have off-axis
 * Cross cells.
 *
 * Bonus depth `d` yields `practicalVariant(d)` and Skill reset `k` yields a
 * distinct Series Skill, so `B(practical)` is `[d0, d1, ...]` and
 * `K(practical)` is `[k0, k1, ...]`. Nothing satisfies the Ideal condition, so
 * the Ideal matrix is empty and every cell belongs to one Practical lattice.
 */
function offAxisSetup() {
  const origin = createConstrainedSearchOrigin({
    normalCounters: [],
    ownedWeapons: [
      gogmaWeapon('owned.constrained.gogma', {
        restorationBonuses: practicalVariant(0),
      }),
    ],
  })
  const engine = createConstrainedEngine(origin, {
    resetResultAt: (gogmaCounter) => practicalVariant(gogmaCounter - 9),
  })
  return { origin, engine }
}

/**
 * The same base with the Ideal five slots reachable at Gogma depth 1 and the
 * Ideal Series Skill at Skill reset 1.
 *
 * That single pair is the Ideal matrix's own anchor `(0, 0)` and, at the same
 * time, the Practical matrix's off-axis cell `(1, 1)`. It therefore also covers
 * both `categoryRank` improvements inside the Practical matrix: along the Bonus
 * axis `(0, 1) -> (1, 1)` with the Ideal Skill fixed, and along the Skill axis
 * `(1, 0) -> (1, 1)` with the Ideal Bonus fixed.
 */
function overlappingCategorySetup() {
  const origin = createConstrainedSearchOrigin({
    normalCounters: [],
    ownedWeapons: [
      gogmaWeapon('owned.constrained.gogma', {
        restorationBonuses: practicalVariant(0),
      }),
    ],
  })
  const engine = createConstrainedEngine(origin, {
    resetResultAt: (gogmaCounter) =>
      gogmaCounter === 10 ? idealBonuses() : practicalVariant(gogmaCounter - 9),
    skillResultAt: (skillCounter) => ({
      seriesSkillId:
        skillCounter === 7 ? IDEAL_SKILL : `series_skill.fixture.s${skillCounter}`,
      groupSkillId: 'group_skill.fixture.a',
    }),
  })
  return { origin, engine }
}

function offAxisBounds(maxOffAxisPairEvaluations: number) {
  return constrainedBounds({
    maxGogmaAdvance: 2,
    maxSkillResetCount: 2,
    maxOffAxisPairEvaluations,
  })
}

/** `(gogmaAdvance, skillAdvance)` of each delivered Candidate, in order. */
function positions(candidates: readonly ConstrainedCandidate[]): string[] {
  return candidates.map(
    (candidate) =>
      `${candidate.estimatedGogmaAdvance},${candidate.estimatedSkillAdvance}`,
  )
}

async function collectSequentially(
  input: Parameters<typeof visitConstrainedCandidates>[0],
  engine: Parameters<typeof visitConstrainedCandidates>[1],
  onEach: (candidate: ConstrainedCandidate) => 'continue' | 'stop' = () => 'continue',
) {
  const candidates: ConstrainedCandidate[] = []
  const execution = await visitConstrainedCandidates(input, engine, (candidate) => {
    candidates.push(candidate)
    return onEach(candidate)
  })
  return { candidates, execution }
}

describe('Off-axis Cross cells', () => {
  it('reaches pairs the two Cross axes never compose once the cap allows it', async () => {
    const { origin, engine } = offAxisSetup()
    const axisOnly = await enumerateConstrainedCandidates(
      constrainedInput(origin, offAxisBounds(0)),
      engine,
    )
    const withOffAxis = await enumerateConstrainedCandidates(
      constrainedInput(origin, offAxisBounds(4)),
      createConstrainedEngine(origin, {
        resetResultAt: (gogmaCounter) => practicalVariant(gogmaCounter - 9),
      }),
    )
    // |B| = |K| = 3, so the Cross rule composes 3 + 3 - 1 = 5 cells and the
    // existing-Gogma d = 0 / k = 0 cell is not a Candidate.
    expect(positions(axisOnly.candidates).sort()).toEqual([
      '0,1',
      '0,2',
      '1,0',
      '2,0',
    ])
    expect(positions(withOffAxis.candidates).sort()).toEqual([
      '0,1',
      '0,2',
      '1,0',
      '1,1',
      '1,2',
      '2,0',
      '2,1',
      '2,2',
    ])
    expect(withOffAxis.summary.evaluatedOffAxisPairs).toBe(4)
    expect(withOffAxis.summary.examinedCandidates).toBe(8)
  })

  it('classifies an off-axis pair with the same authority as an axis pair', async () => {
    const { origin, engine } = offAxisSetup()
    const result = await enumerateConstrainedCandidates(
      constrainedInput(origin, offAxisBounds(4)),
      engine,
    )
    const offAxis = result.candidates.filter(
      (candidate) =>
        candidate.estimatedGogmaAdvance > 0 && candidate.estimatedSkillAdvance > 0,
    )
    expect(offAxis).toHaveLength(4)
    for (const candidate of offAxis) {
      expect(candidate.category).toBe('practical')
      expect(candidate.restorationBonusScope).toBe('gogma_artian')
      expect(candidate.route.kind).toBe('existing_gogma_mixed')
      expect(candidate.searchStateHash).toMatch(/^fnv1a32:/)
      expect(candidate.referencedOwnedWeaponsHash).toMatch(/^fnv1a32:/)
      expect(candidate.estimatedOperationCount).toBe(
        candidate.route.operations.length,
      )
    }
  })

  it('evaluates no off-axis pair at all when the cap is zero', async () => {
    const { origin, engine } = offAxisSetup()
    const result = await enumerateConstrainedCandidates(
      constrainedInput(origin, offAxisBounds(0)),
      engine,
    )
    // Zero is a valid setting: it is exactly the Cross-only policy. The axis
    // Candidates are still enumerated to the end.
    expect(result.summary.evaluatedOffAxisPairs).toBe(0)
    expect(result.candidates).toHaveLength(4)
    expect(result.summary.stoppedByBound).toBe(true)
    expect(result.summary.exhausted).toBe(false)
  })

  it('stops off-axis evaluation at the cap and keeps the remaining axis work', async () => {
    const { origin, engine } = offAxisSetup()
    const result = await enumerateConstrainedCandidates(
      constrainedInput(origin, offAxisBounds(2)),
      engine,
    )
    expect(result.summary.evaluatedOffAxisPairs).toBe(2)
    expect(result.summary.examinedCandidates).toBe(6)
    // The two cheapest off-axis cells are taken first, and every axis
    // Candidate survives the off-axis cap.
    expect(positions(result.candidates).sort()).toEqual([
      '0,1',
      '0,2',
      '1,0',
      '1,1',
      '1,2',
      '2,0',
    ])
    expect(result.summary.stoppedByBound).toBe(true)
    expect(result.summary.exhausted).toBe(false)
  })

  it('does not truncate when the cap exactly covers every reachable off-axis cell', async () => {
    const { origin } = offAxisSetup()
    const run = (cap: number) =>
      enumerateConstrainedCandidates(
        constrainedInput(origin, offAxisBounds(cap)),
        createConstrainedEngine(origin, {
          resetResultAt: (gogmaCounter) => practicalVariant(gogmaCounter - 9),
        }),
      )
    const exact = await run(4)
    const generous = await run(5)
    // Raising the cap past the reachable cells changes nothing, so the cap of
    // 4 refused no cell. The Gogma and Skill stream bounds are still reported,
    // because an off-axis cell can only exist once both streams were searched
    // to their own bound.
    expect(exact.summary.evaluatedOffAxisPairs).toBe(4)
    expect(generous.summary.evaluatedOffAxisPairs).toBe(4)
    expect(generous.candidates.map(constrainedCandidateStableKey)).toEqual(
      exact.candidates.map(constrainedCandidateStableKey),
    )
  })

  it('never re-evaluates or recounts a pair shared by the Ideal and Practical matrices', async () => {
    const { origin, engine } = overlappingCategorySetup()
    const result = await enumerateConstrainedCandidates(
      constrainedInput(origin, offAxisBounds(4)),
      engine,
    )
    const ideal = result.candidates.filter(({ category }) => category === 'ideal')
    expect(ideal).toHaveLength(1)
    expect(ideal[0].estimatedGogmaAdvance).toBe(1)
    expect(ideal[0].estimatedSkillAdvance).toBe(1)
    // The Ideal anchor and the Practical `(1, 1)` cell are the same actual
    // pair. It is evaluated once, as axis work, so it consumes no off-axis
    // budget, and the three remaining off-axis cells are still reached.
    expect(result.summary.evaluatedOffAxisPairs).toBe(3)
    expect(result.summary.examinedCandidates).toBe(8)
    expect(positions(result.candidates).sort()).toEqual([
      '0,1',
      '0,2',
      '1,0',
      '1,1',
      '1,2',
      '2,0',
      '2,1',
      '2,2',
    ])
  })

  it('keeps the frontier lazy instead of scanning the Cartesian product', async () => {
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
      resetResultAt: (gogmaCounter) => practicalVariant(gogmaCounter - 9),
    })
    const result = await enumerateConstrainedCandidates(
      constrainedInput(
        origin,
        constrainedBounds({
          maxGogmaAdvance: axisDepth,
          maxSkillResetCount: axisDepth,
          maxOffAxisPairEvaluations: 3,
        }),
      ),
      engine,
    )

    // |B| = |K| = 31. The two axes contribute 31 + 31 - 2 = 60 evaluated
    // combinations, and exactly 3 off-axis cells are added. A Cartesian
    // traversal would be 31 * 31 = 961.
    const axisSize = axisDepth + 1
    expect(result.summary.evaluatedOffAxisPairs).toBe(3)
    expect(result.summary.examinedCandidates).toBe(axisSize + axisSize - 2 + 3)
    expect(result.summary.examinedCandidates).toBeLessThan(axisSize * axisSize)
    expect(result.candidates).toHaveLength(axisSize + axisSize - 2 + 3)
    // Off-axis cells reuse the already solved stream positions, so they add no
    // Engine prediction at all.
    expect(callCounts.gogmaReset).toBe(axisDepth)
    expect(callCounts.skill).toBe(axisDepth)
    expect(result.summary.stoppedByBound).toBe(true)
    expect(result.summary.exhausted).toBe(false)
  })

  it('reports exhaustion when neither axis has an off-axis cell', async () => {
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
})

describe('Constrained sequential delivery', () => {
  it('hands each Candidate to the consumer as it is found', async () => {
    const { origin, engine } = offAxisSetup()
    let settled = false
    const seen: boolean[] = []
    const execution = await visitConstrainedCandidates(
      constrainedInput(origin, offAxisBounds(4)),
      engine,
      () => {
        seen.push(settled)
        return 'continue'
      },
    )
    settled = true
    // Every callback ran while the enumeration was still in progress, so the
    // consumer never had to wait for the complete collected result.
    expect(seen).toEqual([false, false, false, false, false, false, false, false])
    expect(execution.stoppedByConsumer).toBe(false)
    expect(execution.summary.examinedCandidates).toBe(8)
  })

  it('stops all further pair evaluation when the consumer stops', async () => {
    const { origin, engine } = offAxisSetup()
    const { candidates, execution } = await collectSequentially(
      constrainedInput(origin, offAxisBounds(4)),
      engine,
      () => 'stop',
    )
    expect(candidates).toHaveLength(1)
    expect(execution.stoppedByConsumer).toBe(true)
    // No pair beyond the delivered one was carried to Target evaluation, and
    // no further off-axis cell was expanded.
    expect(execution.summary.examinedCandidates).toBe(1)
    expect(execution.summary.evaluatedOffAxisPairs).toBe(0)
    // A consumer stop is not exhaustion and is not a bound truncation on its
    // own; it is also not the `shouldCancel()` cancellation.
    expect(execution.summary.exhausted).toBe(false)
  })

  it('lets the consumer take a few Candidates and then stop', async () => {
    const { origin, engine } = offAxisSetup()
    let delivered = 0
    const { candidates, execution } = await collectSequentially(
      constrainedInput(origin, offAxisBounds(4)),
      engine,
      () => {
        delivered += 1
        return delivered === 3 ? 'stop' : 'continue'
      },
    )
    expect(candidates).toHaveLength(3)
    expect(execution.summary.examinedCandidates).toBe(3)
    expect(execution.stoppedByConsumer).toBe(true)
  })

  it('awaits consumer work between Candidates', async () => {
    const { origin, engine } = offAxisSetup()
    const order: string[] = []
    const execution = await visitConstrainedCandidates(
      constrainedInput(origin, offAxisBounds(4)),
      engine,
      async (candidate) => {
        order.push(`in:${candidate.estimatedGogmaAdvance}`)
        await Promise.resolve()
        order.push(`out:${candidate.estimatedGogmaAdvance}`)
        return order.length >= 4 ? 'stop' : 'continue'
      },
    )
    expect(order).toEqual(['in:0', 'out:0', 'in:1', 'out:1'])
    expect(execution.stoppedByConsumer).toBe(true)
  })

  it('interleaves a near off-axis Candidate ahead of a distant axis Candidate', async () => {
    const origin = createConstrainedSearchOrigin({
      normalCounters: [],
      ownedWeapons: [
        gogmaWeapon('owned.constrained.gogma', {
          restorationBonuses: practicalVariant(0),
        }),
      ],
    })
    const engine = createConstrainedEngine(origin, {
      resetResultAt: (gogmaCounter) => practicalVariant(gogmaCounter - 9),
    })
    const { candidates } = await collectSequentially(
      constrainedInput(
        origin,
        constrainedBounds({
          maxGogmaAdvance: 4,
          maxSkillResetCount: 4,
          maxOffAxisPairEvaluations: 100,
        }),
      ),
      engine,
    )
    const delivered = positions(candidates)
    // `(B1, K1)` costs two operations while `(B3, k0)` costs three, so a
    // best-first traversal delivers the off-axis cell first. An "every axis
    // cell first" traversal would invert this.
    expect(delivered.indexOf('1,1')).toBeGreaterThanOrEqual(0)
    expect(delivered.indexOf('1,1')).toBeLessThan(delivered.indexOf('3,0'))
    expect(delivered.indexOf('1,1')).toBeLessThan(delivered.indexOf('0,3'))
    expect(candidates).toHaveLength(24)
  })

  it('repeats the identical delivery sequence regardless of stored input order', async () => {
    const bounds = constrainedBounds({
      maxGogmaAdvance: 2,
      maxSkillResetCount: 2,
      maxOffAxisPairEvaluations: 4,
    })
    const build = (reversed: boolean) => {
      const weapons = [
        gogmaWeapon('owned.constrained.gogma.b', {
          restorationBonuses: practicalVariant(0),
        }),
        gogmaWeapon('owned.constrained.gogma.a', {
          restorationBonuses: practicalVariant(0),
        }),
      ]
      const origin = createConstrainedSearchOrigin({
        normalCounters: [],
        ownedWeapons: reversed ? [...weapons].reverse() : weapons,
      })
      return {
        origin,
        engine: createConstrainedEngine(origin, {
          resetResultAt: (gogmaCounter) => practicalVariant(gogmaCounter - 9),
        }),
      }
    }
    const forward = build(false)
    const reversed = build(true)
    const first = await collectSequentially(
      constrainedInput(forward.origin, bounds),
      forward.engine,
    )
    const second = await collectSequentially(
      constrainedInput(reversed.origin, bounds),
      reversed.engine,
    )
    expect(first.candidates.length).toBeGreaterThan(8)
    expect(second.candidates.map(constrainedCandidateStableKey)).toEqual(
      first.candidates.map(constrainedCandidateStableKey),
    )
    expect(second.execution.summary).toEqual(first.execution.summary)
  })

  it('delivers no semantic duplicate to the consumer', async () => {
    const { origin, engine } = overlappingCategorySetup()
    const { candidates } = await collectSequentially(
      constrainedInput(origin, offAxisBounds(4)),
      engine,
    )
    const keys = candidates.map(constrainedCandidateStableKey)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('matches the collector helper on Candidates and on the summary', async () => {
    const bounds = offAxisBounds(4)
    const sequential = offAxisSetup()
    const collected = offAxisSetup()
    const visited = await collectSequentially(
      constrainedInput(sequential.origin, bounds),
      sequential.engine,
    )
    const result = await enumerateConstrainedCandidates(
      constrainedInput(collected.origin, bounds),
      collected.engine,
    )
    expect(visited.candidates.map(constrainedCandidateStableKey).sort()).toEqual(
      result.candidates.map(constrainedCandidateStableKey).sort(),
    )
    expect(visited.execution.summary).toEqual(result.summary)
    // The collector applies the existing final ordering, which the incremental
    // delivery order is not required to reproduce.
    expect(result.candidates).toEqual(
      [...visited.candidates].sort(compareConstrainedCandidates),
    )
  })

  it('rejects with a cancellation error instead of reporting a consumer stop', async () => {
    const { origin, engine } = offAxisSetup()
    await expect(
      visitConstrainedCandidates(
        constrainedInput(origin, offAxisBounds(4)),
        engine,
        () => 'continue',
        { shouldCancel: () => true },
      ),
    ).rejects.toMatchObject({ name: 'CandidateSearchError', code: 'cancelled' })
  })
})

/**
 * `practicalVariant(45)`: two attack at high, one element at middle and two
 * sharpness at high.
 *
 * It matches four of the five Ideal slots, exactly like `practicalBonuses()`,
 * so the two results tie on Ideal closeness. Its completed multiset sorts
 * BEFORE `practicalBonuses()` because "sharpness" precedes "utility", which is
 * what makes it the adversarial partner for a lexicographic-only ordering.
 */
function sharpnessPracticalBonuses() {
  const bonuses = idealBonuses()
  bonuses[3] = { bonusTypeId: 'bonus_type.fixture.sharpness', bonusRankId: 'bonus_rank.fixture.high' }
  return bonuses
}

/**
 * Two owned Gogma sources that still carry inherited `normal_artian` scope
 * slots, so their first amendment is a Reset and both share one Bonus stream.
 *
 * Nothing is Practical before Gogma depth 2. At depth 2 the stream publishes
 * two Practical results that tie on every leading work priority - same depth,
 * so the same operation count and Gogma advance, and the same matched Ideal
 * slot count - and differ only in required material quantity:
 *
 * ```text
 * reset -> reset   practicalBonuses()          material 1 + 1 = 2
 * reset -> keep    sharpnessPracticalBonuses() material 1 + 5 = 6
 * ```
 *
 * `compareBonusSolutions()` therefore puts the Reset result first, while its
 * completed multiset sorts second.
 */
function materialOrderingSetup() {
  const inherited = (id: string) =>
    gogmaWeapon(id, {
      restorationBonuses: belowPracticalBonuses(),
      restorationBonusScope: 'normal_artian',
    })
  const origin = createConstrainedSearchOrigin({
    normalCounters: [],
    ownedWeapons: [
      inherited('owned.constrained.gogma.a'),
      inherited('owned.constrained.gogma.b'),
    ],
  })
  origin.master.materialCosts = [
    {
      id: 'material_cost.fixture.reset',
      operationType: 'reset_bonuses',
      weaponTypeId: null,
      materialId: 'material.fixture.a',
      quantity: 1,
      isEnabled: true,
    },
    {
      id: 'material_cost.fixture.keep',
      operationType: 'keep_bonuses',
      weaponTypeId: null,
      materialId: 'material.fixture.a',
      quantity: 5,
      isEnabled: true,
    },
  ]
  const engine = createConstrainedEngine(origin, {
    keepSupported: true,
    keepInputs: [belowPracticalBonuses()],
    resetResultAt: (gogmaCounter) =>
      gogmaCounter === 11 ? practicalBonuses() : belowPracticalBonuses(),
    keepResultAt: () => sharpnessPracticalBonuses(),
  })
  return { origin, engine }
}

function materialQuantity(candidate: ConstrainedCandidate): number {
  return candidate.requiredMaterials.reduce(
    (total, requirement) => total + requirement.quantity,
    0,
  )
}

/** `(source weapon suffix, summed required material quantity)` per Candidate. */
function sourceAndMaterial(candidates: readonly ConstrainedCandidate[]): string[] {
  return candidates.map(
    (candidate) =>
      `${String(candidate.route.sourceOwnedWeaponId).slice(-1)}:${materialQuantity(candidate)}`,
  )
}

describe('Constrained delivery follows the canonical Bonus stream ordering', () => {
  const bounds = constrainedBounds({
    maxGogmaAdvance: 2,
    maxSkillResetCount: 1,
    maxOffAxisPairEvaluations: 0,
  })

  it('delivers the canonically cheaper Bonus result of every base before the dearer one', async () => {
    const { origin, engine } = materialOrderingSetup()
    const { candidates } = await collectSequentially(
      constrainedInput(origin, bounds),
      engine,
    )
    // A comparator that fell through to a stable key whose leading element is
    // the Route base would deliver `a:2, a:6, b:2, b:6`: the dearer child of
    // base `a` would outrank the cheaper seed of base `b`, which is exactly the
    // coordinate-wise non-monotonicity a single-seed lazy lattice cannot
    // tolerate.
    expect(sourceAndMaterial(candidates).slice(0, 4)).toEqual([
      'a:2',
      'b:2',
      'a:6',
      'b:6',
    ])
    expect(candidates).toHaveLength(6)
  })

  it('gives a consumer stopping early the canonically best Candidates', async () => {
    const { origin, engine } = materialOrderingSetup()
    let delivered = 0
    const { candidates, execution } = await collectSequentially(
      constrainedInput(origin, bounds),
      engine,
      () => {
        delivered += 1
        return delivered === 2 ? 'stop' : 'continue'
      },
    )
    expect(sourceAndMaterial(candidates)).toEqual(['a:2', 'b:2'])
    expect(execution.stoppedByConsumer).toBe(true)
    expect(execution.summary.examinedCandidates).toBe(2)
  })
})
