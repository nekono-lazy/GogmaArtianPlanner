import { describe, expect, it } from 'vitest'
import { enumerateConstrainedCandidates } from './constrainedEnumeration'
import type { ConstrainedCandidate } from './constrainedTypes'
import {
  alternativePracticalBonuses,
  belowPracticalBonuses,
  CONSTRAINED_START_SKILL_COUNTER,
  constrainedBounds,
  constrainedInput,
  createConstrainedEngine,
  createConstrainedSearchOrigin,
  gogmaWeapon,
  IDEAL_SERIES_SKILL_ID,
  idealBonuses,
  normalWeapon,
  practicalBonuses,
  sameLayoutLowerRanks,
} from '../../../test/fixtures/constrainedEnumeration'
import { areRestorationBonusSetsEqual } from '../../models/publicTypes'

function operationTypes(candidate: ConstrainedCandidate): string[] {
  return candidate.route.operations.map(({ type }) => type)
}

function forgeCounts(candidates: readonly ConstrainedCandidate[]): number[] {
  return [
    ...new Set(
      candidates.flatMap((candidate) =>
        candidate.route.operations.flatMap((operation) =>
          operation.type === 'create_normal_artian' ? [operation.count] : [],
        ),
      ),
    ),
  ].sort((left, right) => left - right)
}

function resetSkillsPositions(candidates: readonly ConstrainedCandidate[]): number[] {
  return [
    ...new Set(
      candidates.flatMap((candidate) =>
        candidate.route.operations.flatMap((operation) =>
          operation.type === 'reset_skills' ? [operation.skillCounterBefore] : [],
        ),
      ),
    ),
  ].sort((left, right) => left - right)
}

describe('Constrained Normal stream bounds', () => {
  it('treats maxNormalForgeCount as a forge count, from forgeCount 1 through the bound', async () => {
    const origin = createConstrainedSearchOrigin()
    const result = await enumerateConstrainedCandidates(
      constrainedInput(
        origin,
        constrainedBounds({
          maxNormalForgeCount: 3,
          maxGogmaAdvance: 1,
          maxSkillResetCount: 1,
        }),
      ),
      createConstrainedEngine(origin, { resetResultAt: () => origin.targetWeapons[0].idealBonuses }),
    )
    // Offsets 0..2 mean forging 1..3 weapons; forgeCount 4 is outside the bound.
    expect(forgeCounts(result.candidates)).toEqual([1, 2, 3])
  })

  it('reports a Normal bound stop rather than exhaustion', async () => {
    const origin = createConstrainedSearchOrigin()
    const result = await enumerateConstrainedCandidates(
      constrainedInput(origin, constrainedBounds({ maxNormalForgeCount: 1 })),
      createConstrainedEngine(origin, { resetResultAt: () => origin.targetWeapons[0].idealBonuses }),
    )
    expect(result.summary.stoppedByBound).toBe(true)
    expect(result.summary.exhausted).toBe(false)
  })

  it('keeps candidateCounter and forgeCount distinct in the emitted operations', async () => {
    const origin = createConstrainedSearchOrigin()
    const result = await enumerateConstrainedCandidates(
      constrainedInput(
        origin,
        constrainedBounds({
          maxNormalForgeCount: 2,
          maxGogmaAdvance: 1,
          maxSkillResetCount: 1,
        }),
      ),
      createConstrainedEngine(origin, { resetResultAt: () => origin.targetWeapons[0].idealBonuses }),
    )
    const forges = result.candidates.flatMap((candidate) =>
      candidate.route.operations.flatMap((operation) =>
        operation.type === 'create_normal_artian' ? [operation] : [],
      ),
    )
    for (const forge of forges) {
      expect(forge.normalCounterBefore).toBe(4)
      expect(forge.normalCounterAfter).toBe(4 + forge.count)
    }
  })
})

describe('Constrained Skill stream', () => {
  it('reaches the same Skill outcome at two different Reset Skills positions', async () => {
    const origin = createConstrainedSearchOrigin({
      normalCounters: [],
      ownedWeapons: [gogmaWeapon('owned.constrained.gogma')],
    })
    const engine = createConstrainedEngine(origin, {
      // Skill Counter 7 and 9 publish the same Ideal Series Skill, so the
      // initial-Search minimum-resetCount retention would drop the second one.
      skillResultAt: (skillCounter) => ({
        seriesSkillId:
          skillCounter === 7 || skillCounter === 9
            ? IDEAL_SERIES_SKILL_ID
            : `series_skill.fixture.s${skillCounter}`,
        groupSkillId: 'group_skill.fixture.a',
      }),
    })
    const result = await enumerateConstrainedCandidates(
      constrainedInput(
        origin,
        constrainedBounds({ maxGogmaAdvance: 1, maxSkillResetCount: 3 }),
      ),
      engine,
    )
    const repeated = result.candidates.filter(
      (candidate) => candidate.seriesSkillId === IDEAL_SERIES_SKILL_ID,
    )
    expect(repeated.map((candidate) => candidate.estimatedSkillAdvance).sort()).toEqual([1, 3])
    expect(resetSkillsPositions(repeated)).toEqual([7, 8, 9])
  })

  it('caps an existing-Gogma Route at Reset Skills advance 0 through M', async () => {
    // Advance 0 and advances 1 ... M never coexist: the Skill stream searches
    // Reset Skills only while the current Skills do not satisfy the Ideal
    // condition, so each end of the 0 ... M range needs its own source.
    const run = async (seriesSkillId: string) => {
      const origin = createConstrainedSearchOrigin({
        normalCounters: [],
        ownedWeapons: [
          gogmaWeapon('owned.constrained.gogma', {
            restorationBonuses: practicalBonuses(),
            seriesSkillId,
          }),
        ],
      })
      const result = await enumerateConstrainedCandidates(
        constrainedInput(
          origin,
          constrainedBounds({ maxGogmaAdvance: 1, maxSkillResetCount: 2 }),
        ),
        createConstrainedEngine(origin),
      )
      return {
        advances: [
          ...new Set(
            result.candidates.map(({ estimatedSkillAdvance }) => estimatedSkillAdvance),
          ),
        ].sort(),
        positions: resetSkillsPositions(result.candidates),
      }
    }

    // The source already satisfies the Ideal Skill condition: advance 0 only.
    const settled = await run(IDEAL_SERIES_SKILL_ID)
    expect(settled.advances).toEqual([0])
    expect(settled.positions).toEqual([])

    // The source does not: Reset Skills 1 ... M, capped at M.
    const searching = await run('series_skill.fixture.z')
    expect(searching.advances).toEqual([1, 2])
    // M Reset Skills positions start at the current Skill Counter.
    expect(searching.positions).toEqual([7, 8])
  })

  it('caps a conversion Route at Reset Skills advance 1 through M + 1', async () => {
    const origin = createConstrainedSearchOrigin()
    const engine = createConstrainedEngine(origin, {
      resetResultAt: () => origin.targetWeapons[0].idealBonuses,
      // The conversion Skill at position 7 is not Ideal, so every Reset Skills
      // position the bound allows stays part of the enumeration.
      skillResultAt: (skillCounter) => ({
        seriesSkillId:
          skillCounter === CONSTRAINED_START_SKILL_COUNTER
            ? 'series_skill.fixture.s7'
            : IDEAL_SERIES_SKILL_ID,
        groupSkillId: `group_skill.fixture.g${skillCounter}`,
      }),
    })
    const result = await enumerateConstrainedCandidates(
      constrainedInput(
        origin,
        constrainedBounds({
          maxNormalForgeCount: 1,
          maxGogmaAdvance: 1,
          maxSkillResetCount: 2,
        }),
      ),
      engine,
    )
    const advances = [
      ...new Set(result.candidates.map(({ estimatedSkillAdvance }) => estimatedSkillAdvance)),
    ].sort()
    // The conversion Skill is not Ideal here, so advance 1 - conversion with no
    // Reset Skills - is not an Ideal solution and the range runs 2 ... M + 1.
    expect(advances).toEqual([2, 3])
    // Conversion consumes position 7; the M Resets run at 8 and 9.
    expect(resetSkillsPositions(result.candidates)).toEqual([8, 9])
    for (const candidate of result.candidates) {
      const conversion = candidate.route.operations.find(
        (operation) => operation.type === 'convert_normal_to_gogma',
      )
      expect(conversion).toEqual(
        expect.objectContaining({ skillCounterBefore: 7, skillCounterAfter: 8 }),
      )
    }
  })

  it('predicts each absolute Skill Counter position once across every Route base', async () => {
    const callCounts = { normal: 0, skill: 0, gogmaReset: 0, gogmaKeep: 0 }
    const origin = createConstrainedSearchOrigin({
      ownedWeapons: [
        normalWeapon('owned.constrained.normal.a'),
        normalWeapon('owned.constrained.normal.b'),
      ],
    })
    const engine = createConstrainedEngine(origin, {
      callCounts,
      // The conversion Skill is not Ideal, so the Skill stream keeps reading
      // the Reset positions the bound allows.
      skillResultAt: (skillCounter) => ({
        seriesSkillId:
          skillCounter === CONSTRAINED_START_SKILL_COUNTER
            ? 'series_skill.fixture.s7'
            : IDEAL_SERIES_SKILL_ID,
        groupSkillId: `group_skill.fixture.g${skillCounter}`,
      }),
    })
    await enumerateConstrainedCandidates(
      constrainedInput(
        origin,
        constrainedBounds({
          maxNormalForgeCount: 3,
          maxGogmaAdvance: 1,
          maxSkillResetCount: 2,
        }),
      ),
      engine,
    )
    // Conversion position 7 plus Reset positions 8 and 9: three predictions for
    // five Route bases, so the count never scales with the base count.
    expect(callCounts.skill).toBe(3)
  })
})

describe('Constrained Bonus stream', () => {
  it('reaches the same Bonus outcome at two different Gogma Counter positions', async () => {
    const origin = createConstrainedSearchOrigin({
      normalCounters: [],
      ownedWeapons: [
        gogmaWeapon('owned.constrained.gogma', {
          restorationBonuses: belowPracticalBonuses(),
          seriesSkillId: IDEAL_SERIES_SKILL_ID,
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
    const repeated = result.candidates.filter(
      (candidate) =>
        candidate.estimatedSkillAdvance === 0 &&
        areRestorationBonusSetsEqual(candidate.finalBonuses, idealBonuses()),
    )
    // The initial-Search retention keeps only the smallest advance per
    // (scope, completed multiset); constrained enumeration keeps both.
    expect(
      repeated
        .map(({ estimatedGogmaAdvance }) => estimatedGogmaAdvance)
        .sort((left, right) => left - right),
    ).toEqual([1, 3])
  })

  it('makes no Keep prediction from normal-scope current bonuses', async () => {
    const callCounts = { normal: 0, skill: 0, gogmaReset: 0, gogmaKeep: 0 }
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
      callCounts,
      keepSupported: true,
      keepInputs: [belowPracticalBonuses()],
      resetResultAt: () => idealBonuses(),
    })
    const result = await enumerateConstrainedCandidates(
      constrainedInput(
        origin,
        constrainedBounds({ maxGogmaAdvance: 1, maxSkillResetCount: 1 }),
      ),
      engine,
    )
    expect(result.candidates.length).toBeGreaterThan(0)
    // The exclusion is missing Production Keep prediction support for
    // normal-scope current bonuses, never a game rule forbidding Keep.
    expect(callCounts.gogmaKeep).toBe(0)
    expect(callCounts.gogmaReset).toBe(1)
    for (const candidate of result.candidates) {
      expect(operationTypes(candidate)).not.toContain('keep_bonuses')
    }
  })

  it('predicts Keep once from gogma-scope current bonuses at the same bound', async () => {
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
      keepSupported: true,
      keepInputs: [belowPracticalBonuses()],
      resetResultAt: () => practicalBonuses(),
      keepResultAt: () => alternativePracticalBonuses(),
    })
    const result = await enumerateConstrainedCandidates(
      constrainedInput(
        origin,
        constrainedBounds({ maxGogmaAdvance: 1, maxSkillResetCount: 1 }),
      ),
      engine,
    )
    expect(callCounts.gogmaKeep).toBe(1)
    expect(
      result.candidates.some((candidate) =>
        operationTypes(candidate).includes('keep_bonuses'),
      ),
    ).toBe(true)
  })

  it('emits Reset Bonuses before Keep Bonuses on a normal-scope conversion Route', async () => {
    const origin = createConstrainedSearchOrigin()
    const engine = createConstrainedEngine(origin, {
      keepSupported: true,
      keepInputs: [belowPracticalBonuses()],
      normalResultAt: () => belowPracticalBonuses(),
      resetResultAt: () => belowPracticalBonuses(),
      keepResultAt: () => idealBonuses(),
    })
    const result = await enumerateConstrainedCandidates(
      constrainedInput(
        origin,
        constrainedBounds({
          maxNormalForgeCount: 1,
          maxGogmaAdvance: 2,
          maxSkillResetCount: 1,
        }),
      ),
      engine,
    )
    expect(result.candidates.length).toBeGreaterThan(0)
    for (const candidate of result.candidates) {
      const amendments = operationTypes(candidate).filter(
        (type) => type === 'reset_bonuses' || type === 'keep_bonuses',
      )
      expect(amendments[0]).toBe('reset_bonuses')
      // The post-conversion amendments target the unregistered route output.
      for (const operation of candidate.route.operations) {
        if (operation.type === 'reset_bonuses' || operation.type === 'keep_bonuses') {
          expect(operation.sourceOwnedWeaponId).toBeNull()
        }
      }
    }
    expect(
      result.candidates.some((candidate) =>
        operationTypes(candidate).includes('keep_bonuses'),
      ),
    ).toBe(true)
  })

  it('keeps the B2 family-layout frontier reduction', async () => {
    const callCounts = { normal: 0, skill: 0, gogmaReset: 0, gogmaKeep: 0 }
    const origin = createConstrainedSearchOrigin({
      normalCounters: [],
      ownedWeapons: [
        gogmaWeapon('owned.constrained.gogma', {
          restorationBonuses: practicalBonuses(),
        }),
      ],
    })
    const engine = createConstrainedEngine(origin, {
      callCounts,
      keepSupported: true,
      keepInputs: [practicalBonuses(), sameLayoutLowerRanks()],
      // Both depth-1 outcomes share one ordered Bonus Type layout, so the
      // frontier folds them into a single representative for depth 2.
      resetResultAt: () => sameLayoutLowerRanks(),
      keepResultAt: () => practicalBonuses(),
    })
    await enumerateConstrainedCandidates(
      constrainedInput(
        origin,
        constrainedBounds({ maxGogmaAdvance: 2, maxSkillResetCount: 1 }),
      ),
      engine,
    )
    // One Reset per Gogma Counter position, and one Keep per surviving layout.
    expect(callCounts.gogmaReset).toBe(2)
    expect(callCounts.gogmaKeep).toBe(2)
  })

  it('shares one Bonus stream across every normal-scope conversion base', async () => {
    const callCounts = { normal: 0, skill: 0, gogmaReset: 0, gogmaKeep: 0 }
    const origin = createConstrainedSearchOrigin()
    const engine = createConstrainedEngine(origin, { callCounts })
    await enumerateConstrainedCandidates(
      constrainedInput(
        origin,
        constrainedBounds({
          maxNormalForgeCount: 4,
          maxGogmaAdvance: 2,
          maxSkillResetCount: 1,
        }),
      ),
      engine,
    )
    // Reset ignores the current bonuses, so four Normal offsets still cost one
    // Reset prediction per covered Gogma Counter position.
    expect(callCounts.gogmaReset).toBe(2)
    expect(callCounts.normal).toBe(4)
  })
})
