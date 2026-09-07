import { describe, expect, it } from 'vitest'
import {
  PlannerOrchestrationBoundsError,
  assertPlannerOrchestrationBounds,
  validatePlannerOrchestrationBounds,
  type PlannerOrchestrationBounds,
} from './plannerOrchestrationBounds'

function bounds(
  overrides: Partial<PlannerOrchestrationBounds> = {},
): PlannerOrchestrationBounds {
  return {
    maxCandidateTrialsPerConflict: 4,
    maxGeneratedBuildListEntries: 3,
    maxPlannerReruns: 2,
    ...overrides,
  }
}

const fields = [
  'maxCandidateTrialsPerConflict',
  'maxGeneratedBuildListEntries',
  'maxPlannerReruns',
] as const

describe('PlannerOrchestrationBounds validation', () => {
  it('accepts positive integers', () => {
    expect(validatePlannerOrchestrationBounds(bounds()).isValid).toBe(true)
    expect(
      validatePlannerOrchestrationBounds({
        maxCandidateTrialsPerConflict: 1,
        maxGeneratedBuildListEntries: 1,
        maxPlannerReruns: 1,
      }).isValid,
    ).toBe(true)
    expect(
      validatePlannerOrchestrationBounds(bounds({ maxPlannerReruns: 1_000 }))
        .isValid,
    ).toBe(true)
  })

  it.each(fields)('rejects a non-positive-integer %s', (field) => {
    ;([0, -1, -4, 1.5, Number.NaN, Number.POSITIVE_INFINITY] as const).forEach(
      (value) => {
        const validation = validatePlannerOrchestrationBounds(
          bounds({ [field]: value }),
        )
        expect(validation.isValid).toBe(false)
        expect(validation.issues).toContainEqual({
          path: field,
          code: 'invalid_integer',
          message: expect.stringContaining('greater than or equal to 1'),
        })
      },
    )
  })

  it('rejects zero for every bound instead of copying enumeration zero-disable semantics', () => {
    const validation = validatePlannerOrchestrationBounds({
      maxCandidateTrialsPerConflict: 0,
      maxGeneratedBuildListEntries: 0,
      maxPlannerReruns: 0,
    })
    expect(validation.isValid).toBe(false)
    expect(validation.issues.map(({ path }) => path)).toEqual([...fields])
  })

  it('does not mutate or repair the input', () => {
    const invalid = bounds({ maxPlannerReruns: 0 })
    const before = structuredClone(invalid)
    validatePlannerOrchestrationBounds(invalid)
    expect(invalid).toEqual(before)

    const valid = bounds()
    const validBefore = structuredClone(valid)
    validatePlannerOrchestrationBounds(valid)
    expect(valid).toEqual(validBefore)
  })

  it('fails closed through the assertion helper', () => {
    expect(() => assertPlannerOrchestrationBounds(bounds())).not.toThrow()
    expect(() =>
      assertPlannerOrchestrationBounds(bounds({ maxPlannerReruns: 0 })),
    ).toThrow(PlannerOrchestrationBoundsError)
  })

  it('exposes no Production default', async () => {
    const module = await import('./plannerOrchestrationBounds')
    expect(
      Object.keys(module).some((name) => name.toLowerCase().startsWith('default')),
    ).toBe(false)
  })
})
