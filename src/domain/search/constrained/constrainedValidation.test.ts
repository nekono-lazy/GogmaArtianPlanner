import { describe, expect, it } from 'vitest'
import { enumerateConstrainedCandidates } from './constrainedEnumeration'
import {
  ConstrainedSearchError,
  type ConstrainedEnumerationBounds,
} from './constrainedTypes'
import {
  assertConstrainedCandidateSearchInput,
  validateConstrainedEnumerationBounds,
} from './constrainedValidation'
import {
  constrainedBounds,
  constrainedInput,
  constrainedTarget,
  createConstrainedEngine,
  createConstrainedSearchOrigin,
  gogmaWeapon,
} from '../../../test/fixtures/constrainedEnumeration'
import { targetWeaponId } from '../../../test/fixtures/domainData'

describe('Constrained enumeration input contract', () => {
  it('carries no UI request metadata on the origin or the input', () => {
    const origin = createConstrainedSearchOrigin()
    const input = constrainedInput(origin)

    expect(Object.keys(origin).sort()).toEqual([
      'calculationContext',
      'master',
      'normalCounters',
      'ownedWeapons',
      'rngState',
      'targetWeapons',
    ])
    for (const uiField of ['searchRunId', 'routeFilter', 'resultFilter', 'settings']) {
      expect(origin).not.toHaveProperty(uiField)
    }
    expect(Object.keys(input).sort()).toEqual(['bounds', 'origin', 'targetWeaponId'])
  })

  it('carries only enumeration bounds, never Planner orchestration bounds', () => {
    const bounds = constrainedBounds()
    expect(Object.keys(bounds).sort()).toEqual([
      'maxGogmaAdvance',
      'maxNormalForgeCount',
      'maxOffAxisPairEvaluations',
      'maxSkillResetCount',
    ])
    for (const orchestrationBound of [
      'maxCandidateTrialsPerConflict',
      'maxGeneratedBuildListEntries',
      'maxPlannerReruns',
    ]) {
      expect(bounds).not.toHaveProperty(orchestrationBound)
    }
  })

  it('does not require a historical Candidate Search request to enumerate', async () => {
    const origin = createConstrainedSearchOrigin()
    const result = await enumerateConstrainedCandidates(
      constrainedInput(origin),
      createConstrainedEngine(origin),
    )
    expect(result.targetWeaponId).toBe(origin.targetWeapons[0].id)
    expect(result.candidates.length).toBeGreaterThan(0)
  })
})

describe('validateConstrainedEnumerationBounds', () => {
  it.each([
    ['maxNormalForgeCount', 0],
    ['maxGogmaAdvance', 0],
    ['maxSkillResetCount', 0],
    ['maxNormalForgeCount', 1.5],
    ['maxOffAxisPairEvaluations', -1],
  ])('rejects %s = %s', (field, value) => {
    const bounds = {
      ...constrainedBounds(),
      [field]: value,
    } as ConstrainedEnumerationBounds
    expect(validateConstrainedEnumerationBounds(bounds)).toEqual([
      expect.objectContaining({ path: `bounds.${field}` }),
    ])
  })

  it('accepts maxOffAxisPairEvaluations = 0 as the Cross-only configuration', () => {
    expect(
      validateConstrainedEnumerationBounds(
        constrainedBounds({ maxOffAxisPairEvaluations: 0 }),
      ),
    ).toEqual([])
  })
})

describe('assertConstrainedCandidateSearchInput', () => {
  it('fails closed when the Target is not part of the origin', () => {
    const origin = createConstrainedSearchOrigin()
    expect(() =>
      assertConstrainedCandidateSearchInput({
        origin,
        targetWeaponId: targetWeaponId('target.fixture.missing'),
        bounds: constrainedBounds(),
      }),
    ).toThrowError(ConstrainedSearchError)
  })

  it('fails closed when the Target is disabled', () => {
    const origin = createConstrainedSearchOrigin()
    origin.targetWeapons[0].isEnabled = false
    expect(() =>
      assertConstrainedCandidateSearchInput(constrainedInput(origin)),
    ).toThrowError(/disabled/)
  })

  it('fails closed when the Target violates the Ideal implies Practical invariant', () => {
    const origin = createConstrainedSearchOrigin()
    origin.targetWeapons[0].practicalBonusConditions = [
      {
        id: 'condition.fixture.impossible',
        bonusTypeId: 'bonus_type.fixture.utility',
        minimumRankId: 'bonus_rank.fixture.high',
        requiredCount: 5,
        requiredExCount: 0,
      },
    ]
    expect(() =>
      assertConstrainedCandidateSearchInput(constrainedInput(origin)),
    ).toThrowError(/containment invariant/)
  })

  it('fails closed on an invalid RngState', () => {
    const origin = createConstrainedSearchOrigin()
    origin.rngState.skillCounter = {
      value: null,
      isConfirmed: true,
      source: 'manual',
    }
    expect(() =>
      assertConstrainedCandidateSearchInput(constrainedInput(origin)),
    ).toThrowError(/origin\.rngState\.skillCounter/)
  })

  it('fails closed on an invalid Normal Artian counter', () => {
    const origin = createConstrainedSearchOrigin()
    origin.normalCounters[0].counter = -1
    expect(() =>
      assertConstrainedCandidateSearchInput(constrainedInput(origin)),
    ).toThrowError(/origin\.normalCounters\[0\]\.counter/)
  })

  it('fails closed on an invalid OwnedWeapon', () => {
    const origin = createConstrainedSearchOrigin({
      ownedWeapons: [
        gogmaWeapon('owned.constrained.broken', {
          // A Gogma weapon requires a valid OwnedWeapon status.
          status: 'unknown' as never,
        }),
      ],
    })
    expect(() =>
      assertConstrainedCandidateSearchInput(constrainedInput(origin)),
    ).toThrowError(/origin\.ownedWeapons\[0\]\.status/)
  })

  it('fails closed on a structurally invalid selected TargetWeapon', () => {
    const origin = createConstrainedSearchOrigin()
    origin.targetWeapons[0].priority = 9 as never
    expect(() =>
      assertConstrainedCandidateSearchInput(constrainedInput(origin)),
    ).toThrowError(/origin\.targetWeapons\[0\]\.priority/)
  })

  it('fails closed when an unselected origin TargetWeapon is structurally invalid', () => {
    const other = constrainedTarget()
    other.id = targetWeaponId('target.fixture.other')
    other.priority = 9 as never
    const origin = createConstrainedSearchOrigin({ extraTargetWeapons: [other] })
    // The enumerated Target itself is valid; the origin snapshot is not.
    expect(origin.targetWeapons[0].id).toBe(constrainedInput(origin).targetWeaponId)
    expect(() =>
      assertConstrainedCandidateSearchInput(constrainedInput(origin)),
    ).toThrowError(/origin\.targetWeapons\[1\]\.priority/)
  })

  it('fails closed on an invalid CalculationContext structure', () => {
    const origin = createConstrainedSearchOrigin()
    origin.calculationContext.masterDataVersion = 0
    expect(() =>
      assertConstrainedCandidateSearchInput(constrainedInput(origin)),
    ).toThrowError(/masterDataVersion/)
  })

  it('returns the enumerated Target for a valid input', () => {
    const origin = createConstrainedSearchOrigin()
    expect(assertConstrainedCandidateSearchInput(constrainedInput(origin)).id).toBe(
      origin.targetWeapons[0].id,
    )
  })
})

describe('Constrained enumeration CalculationContext compatibility', () => {
  it('fails closed when the Engine version does not match the origin context', async () => {
    const origin = createConstrainedSearchOrigin()
    const engine = createConstrainedEngine(origin)
    origin.calculationContext.rngEngineVersion = 'fake-fixture:other'
    await expect(
      enumerateConstrainedCandidates(constrainedInput(origin), engine),
    ).rejects.toThrowError(ConstrainedSearchError)
  })
})

describe('Constrained enumeration fails closed before any Engine prediction', () => {
  it('runs no prediction when the origin snapshot is invalid', async () => {
    const callCounts = { normal: 0, skill: 0, gogmaReset: 0, gogmaKeep: 0 }
    const origin = createConstrainedSearchOrigin()
    const engine = createConstrainedEngine(origin, { callCounts })
    origin.rngState.skillCounter = {
      value: null,
      isConfirmed: true,
      source: 'manual',
    }
    await expect(
      enumerateConstrainedCandidates(constrainedInput(origin), engine),
    ).rejects.toMatchObject({ name: 'ConstrainedSearchError', code: 'invalid_input' })
    expect(callCounts).toEqual({ normal: 0, skill: 0, gogmaReset: 0, gogmaKeep: 0 })
  })

  it('runs no prediction when an unselected origin TargetWeapon is invalid', async () => {
    const callCounts = { normal: 0, skill: 0, gogmaReset: 0, gogmaKeep: 0 }
    const other = constrainedTarget()
    other.id = targetWeaponId('target.fixture.other')
    other.priority = 9 as never
    const origin = createConstrainedSearchOrigin({ extraTargetWeapons: [other] })
    const engine = createConstrainedEngine(origin, { callCounts })
    await expect(
      enumerateConstrainedCandidates(constrainedInput(origin), engine),
    ).rejects.toMatchObject({ name: 'ConstrainedSearchError', code: 'invalid_input' })
    expect(callCounts).toEqual({ normal: 0, skill: 0, gogmaReset: 0, gogmaKeep: 0 })
  })

  it('runs no prediction when the bounds are invalid', async () => {
    const callCounts = { normal: 0, skill: 0, gogmaReset: 0, gogmaKeep: 0 }
    const origin = createConstrainedSearchOrigin()
    const engine = createConstrainedEngine(origin, { callCounts })
    await expect(
      enumerateConstrainedCandidates(
        constrainedInput(origin, constrainedBounds({ maxGogmaAdvance: 0 })),
        engine,
      ),
    ).rejects.toBeInstanceOf(ConstrainedSearchError)
    expect(callCounts).toEqual({ normal: 0, skill: 0, gogmaReset: 0, gogmaKeep: 0 })
  })
})
