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
  // The Ideal five slots and the Ideal Skill are both reachable at two
  // consecutive Counter positions, so the same result exists at more than one
  // position - exactly the work the initial Search stops before reaching.
  const engine = createConstrainedEngine(origin, {
    resetResultAt: (gogmaCounter) =>
      gogmaCounter <= 11 ? idealBonuses() : belowPracticalBonuses(),
    skillResultAt: (skillCounter) => ({
      seriesSkillId:
        skillCounter <= 8 ? IDEAL_SKILL : `series_skill.fixture.s${skillCounter}`,
      groupSkillId: `group_skill.fixture.g${skillCounter}`,
    }),
  })
  return { origin, engine }
}

describe('Constrained route policy', () => {
  it('enumerates every currently legal Route without a route filter', async () => {
    const origin = createConstrainedSearchOrigin({
      ownedWeapons: [
        normalWeapon('owned.constrained.normal'),
        gogmaWeapon('owned.constrained.gogma.bonus', {
          // Ideal Skill already; only the Bonus axis is amended.
          seriesSkillId: 'series_skill.fixture.a',
        }),
        gogmaWeapon('owned.constrained.gogma.skill', {
          // Ideal five slots already; only the Skill axis is amended.
          restorationBonuses: idealBonuses(),
        }),
      ],
    })
    const engine = createConstrainedEngine(origin)
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
        gogmaWeapon('owned.constrained.gogma.bonus', {
          seriesSkillId: 'series_skill.fixture.a',
        }),
        gogmaWeapon('owned.constrained.gogma.skill', {
          restorationBonuses: idealBonuses(),
        }),
      ],
    })
    const engine = createConstrainedEngine(origin, { normalSupported: false })
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
        gogmaWeapon('owned.constrained.gogma.bonus', {
          seriesSkillId: 'series_skill.fixture.a',
        }),
        gogmaWeapon('owned.constrained.gogma.skill', {
          restorationBonuses: idealBonuses(),
        }),
      ],
    })
    const engine = createConstrainedEngine(origin, { skillSupported: false })
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

  it('never schedules any performance amendment on a protected Gogma source', async () => {
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
    expect(routeKinds(result.candidates)).toEqual([])
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
    for (const candidate of result.candidates) {
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
    const cheapest = Math.min(
      ...result.candidates.map(({ estimatedOperationCount }) => estimatedOperationCount),
    )
    const beyondCheapest = result.candidates.filter(
      (candidate) => candidate.estimatedOperationCount > cheapest,
    )
    // The initial Search stops at the canonical Ideal; constrained enumeration
    // keeps the later Ideal solutions the Planner may need instead.
    expect(beyondCheapest.length).toBeGreaterThan(0)
    expect(result.candidates).toHaveLength(3)
  })

  it('does not apply the initial-Search Practical dominance', async () => {
    const origin = createConstrainedSearchOrigin({
      normalCounters: [],
      ownedWeapons: [
        gogmaWeapon('owned.constrained.gogma', {
          restorationBonuses: belowPracticalBonuses(),
          // The Ideal Skill is already held, so the Skill axis contributes its
          // zero-operation solution and the two solutions differ only in their
          // Gogma Counter position.
          seriesSkillId: IDEAL_SKILL,
        }),
      ],
    })
    const engine = createConstrainedEngine(origin, {
      resetResultAt: (gogmaCounter) =>
        gogmaCounter === 10 || gogmaCounter === 12
          ? idealBonuses()
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
          areRestorationBonusSetsEqual(candidate.finalBonuses, idealBonuses()),
      )
      .sort((left, right) => left.estimatedGogmaAdvance - right.estimatedGogmaAdvance)
    expect(sameResult).toHaveLength(2)
    const [cheaper, dearer] = sameResult
    // Identical completed result, skills, source weapon and destructive kind,
    // with the later position strictly worse on every cost axis: exactly the
    // pair the initial Search drops when it stops at the canonical Ideal. The
    // Planner may still need the later one.
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
      const engine = createConstrainedEngine(origin)
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
        engine: createConstrainedEngine(origin),
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
        restorationBonuses: belowPracticalBonuses(),
      }),
    ],
  })
  // Every Gogma position reaches the Ideal five slots and every Skill position
  // the Ideal Series Skill, so both axes hold several entries and genuine
  // off-axis cells exist.
  const engine = createConstrainedEngine(origin)
  return { origin, engine }
}

/**
 * One base whose Bonus and Skill axes both hold several Ideal entries, so the
 * same actual `(Bonus, Skill)` pair can be reached from more than one frontier
 * node. It is evaluated once and never recounted, while every node still
 * expands its own neighbours.
 */
function overlappingCategorySetup() {
  return offAxisSetup()
}

function offAxisBounds(maxOffAxisPairEvaluations: number) {
  // Three Ideal entries on each axis, so the Cross rule composes 3 + 3 - 1 = 5
  // axis cells and leaves exactly four off-axis cells for the cap to govern.
  return constrainedBounds({
    maxGogmaAdvance: 3,
    maxSkillResetCount: 3,
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
      engine,
    )
    // |B| = |K| = 3, so the Cross rule composes 3 + 3 - 1 = 5 axis cells. Both
    // axes start at depth 1, because the source is Ideal on neither of them.
    expect(positions(axisOnly.candidates).sort()).toEqual([
      '1,1',
      '1,2',
      '1,3',
      '2,1',
      '3,1',
    ])
    expect(positions(withOffAxis.candidates).sort()).toEqual([
      '1,1',
      '1,2',
      '1,3',
      '2,1',
      '2,2',
      '2,3',
      '3,1',
      '3,2',
      '3,3',
    ])
    expect(withOffAxis.summary.evaluatedOffAxisPairs).toBe(4)
    expect(withOffAxis.summary.examinedCandidates).toBe(9)
  })

  it('classifies an off-axis pair with the same authority as an axis pair', async () => {
    const { origin, engine } = offAxisSetup()
    const result = await enumerateConstrainedCandidates(
      constrainedInput(origin, offAxisBounds(4)),
      engine,
    )
    // Both Cross anchors sit at depth 1, because the source is Ideal on
    // neither axis, so an off-axis cell is one that advanced past the anchor
    // on both streams.
    const offAxis = result.candidates.filter(
      (candidate) =>
        candidate.estimatedGogmaAdvance > 1 && candidate.estimatedSkillAdvance > 1,
    )
    expect(offAxis).toHaveLength(4)
    for (const candidate of offAxis) {
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
    expect(result.candidates).toHaveLength(5)
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
    expect(result.summary.examinedCandidates).toBe(7)
    // The two cheapest off-axis cells are taken first, and every axis
    // Candidate survives the off-axis cap.
    expect(positions(result.candidates).sort()).toEqual([
      '1,1',
      '1,2',
      '1,3',
      '2,1',
      '2,2',
      '2,3',
      '3,1',
    ])
    expect(result.summary.stoppedByBound).toBe(true)
    expect(result.summary.exhausted).toBe(false)
  })

  it('does not truncate when the cap exactly covers every reachable off-axis cell', async () => {
    const { origin } = offAxisSetup()
    const run = (cap: number) =>
      enumerateConstrainedCandidates(
        constrainedInput(origin, offAxisBounds(cap)),
        createConstrainedEngine(origin),
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

  it('never re-evaluates or recounts an actual pair reached from two frontier nodes', async () => {
    const { origin, engine } = overlappingCategorySetup()
    const result = await enumerateConstrainedCandidates(
      constrainedInput(origin, offAxisBounds(4)),
      engine,
    )
    // Every actual pair is evaluated exactly once, however many frontier
    // nodes reach it, so the counts stay the axis and off-axis cell counts.
    expect(result.summary.evaluatedOffAxisPairs).toBe(4)
    expect(result.summary.examinedCandidates).toBe(9)
    expect(positions(result.candidates).sort()).toEqual([
      '1,1',
      '1,2',
      '1,3',
      '2,1',
      '2,2',
      '2,3',
      '3,1',
      '3,2',
      '3,3',
    ])
  })

  it('keeps the frontier lazy instead of scanning the Cartesian product', async () => {
    const axisDepth = 30
    const callCounts = { normal: 0, skill: 0, gogmaReset: 0, gogmaKeep: 0 }
    const origin = createConstrainedSearchOrigin({
      normalCounters: [],
      ownedWeapons: [
        gogmaWeapon('owned.constrained.gogma', {
          restorationBonuses: belowPracticalBonuses(),
        }),
      ],
    })
    const engine = createConstrainedEngine(origin, {
      callCounts,
      gogmaPositions: axisDepth + 2,
      skillPositions: axisDepth + 2,
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

    // |B| = |K| = 30, because the source is Ideal on neither axis and both
    // Cross anchors therefore sit at depth 1. The two axes contribute
    // 30 + 30 - 1 = 59 evaluated combinations, and exactly 3 off-axis cells
    // are added. A Cartesian traversal would be 30 * 30 = 900.
    const axisSize = axisDepth
    expect(result.summary.evaluatedOffAxisPairs).toBe(3)
    expect(result.summary.examinedCandidates).toBe(axisSize + axisSize - 1 + 3)
    expect(result.summary.examinedCandidates).toBeLessThan(axisSize * axisSize)
    expect(result.candidates).toHaveLength(axisSize + axisSize - 1 + 3)
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
    expect(seen).toEqual([
      false, false, false, false, false, false, false, false, false,
    ])
    expect(execution.stoppedByConsumer).toBe(false)
    expect(execution.summary.examinedCandidates).toBe(9)
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
    // The anchor and the next delivered cell both advance one Gogma position:
    // the second delivery is the Skill-axis cell `(B1, K2)`.
    expect(order).toEqual(['in:1', 'out:1', 'in:1', 'out:1'])
    expect(execution.stoppedByConsumer).toBe(true)
  })

  it('interleaves a near off-axis Candidate ahead of a distant axis Candidate', async () => {
    const origin = createConstrainedSearchOrigin({
      normalCounters: [],
      ownedWeapons: [
        gogmaWeapon('owned.constrained.gogma', {
          restorationBonuses: belowPracticalBonuses(),
        }),
      ],
    })
    const engine = createConstrainedEngine(origin)
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
    // `(B2, K2)` costs four operations while `(B4, K1)` costs five, so a
    // best-first traversal delivers the near off-axis cell first. An "every
    // axis cell first" traversal would invert this.
    expect(delivered.indexOf('2,2')).toBeGreaterThanOrEqual(0)
    expect(delivered.indexOf('2,2')).toBeLessThan(delivered.indexOf('4,1'))
    expect(delivered.indexOf('2,2')).toBeLessThan(delivered.indexOf('1,4'))
    expect(candidates).toHaveLength(16)
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
          restorationBonuses: belowPracticalBonuses(),
        }),
        gogmaWeapon('owned.constrained.gogma.a', {
          restorationBonuses: belowPracticalBonuses(),
        }),
      ]
      const origin = createConstrainedSearchOrigin({
        normalCounters: [],
        ownedWeapons: reversed ? [...weapons].reverse() : weapons,
      })
      return { origin, engine: createConstrainedEngine(origin) }
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
    expect(first.candidates.length).toBeGreaterThan(4)
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
 * Two owned Gogma sources that still carry inherited `normal_artian` scope
 * slots, so their first amendment is a Reset and both share one Bonus stream.
 *
 * Nothing is Practical before Gogma depth 2. At depth 2 the stream publishes
 * two Ideal results that tie on every leading work priority - same depth, so
 * the same operation count and Gogma advance, and the same matched Ideal slot
 * count - and differ only in required material quantity:
 *
 * ```text
 * reset -> reset   idealBonuses()   material 1 + 1 = 2
 * reset -> keep    idealBonuses()   material 1 + 5 = 6
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
      // The Ideal Skill is already held, so the Skill axis contributes its
      // zero-operation solution and only the Bonus ordering is exercised.
      seriesSkillId: IDEAL_SKILL,
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
    // Two Routes reach the very same Ideal five slots at the same depth, one
    // through a second Reset and one through a Keep, so they tie on every
    // leading work priority and differ only in required material quantity.
    resetResultAt: (gogmaCounter) =>
      gogmaCounter === 11 ? idealBonuses() : belowPracticalBonuses(),
    keepResultAt: () => idealBonuses(),
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
    // Two Route bases with two Ideal Bonus results each. The Skill axis
    // contributes only its zero-operation solution, because both sources
    // already hold the Ideal Skill.
    expect(candidates).toHaveLength(4)
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
