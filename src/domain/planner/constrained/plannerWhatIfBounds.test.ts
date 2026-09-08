import { describe, expect, it } from 'vitest'
import * as constrainedModule from './index'
import {
  assertPlannerWhatIfBounds,
  defaultPlannerWhatIfBounds,
  PlannerWhatIfBoundsError,
  validatePlannerWhatIfBounds,
  type PlannerWhatIfBounds,
} from './plannerWhatIfBounds'

function bounds(
  maxCandidateTrialsPerCategoryPerTarget: number,
  maxPlannerReruns: number,
): PlannerWhatIfBounds {
  return { maxCandidateTrialsPerCategoryPerTarget, maxPlannerReruns }
}

describe('B9-B1a PlannerWhatIfBounds validation', () => {
  it('accepts the smallest usable bounds', () => {
    expect(validatePlannerWhatIfBounds(bounds(1, 1))).toEqual({
      isValid: true,
      issues: [],
    })
  })

  it('accepts larger positive integers', () => {
    expect(validatePlannerWhatIfBounds(bounds(3, 12)).isValid).toBe(true)
    expect(validatePlannerWhatIfBounds(bounds(100, 100)).isValid).toBe(true)
  })

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['fraction', 1.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('rejects a %s trial bound', (_label, value) => {
    const validation = validatePlannerWhatIfBounds(bounds(value, 1))
    expect(validation.isValid).toBe(false)
    expect(validation.issues).toEqual([{
      path: 'maxCandidateTrialsPerCategoryPerTarget',
      code: 'invalid_integer',
      message:
        'maxCandidateTrialsPerCategoryPerTarget must be an integer greater than or equal to 1.',
    }])
  })

  it.each([
    ['zero', 0],
    ['negative', -4],
    ['fraction', 2.25],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('rejects a %s rerun bound', (_label, value) => {
    const validation = validatePlannerWhatIfBounds(bounds(1, value))
    expect(validation.isValid).toBe(false)
    expect(validation.issues).toEqual([{
      path: 'maxPlannerReruns',
      code: 'invalid_integer',
      message: 'maxPlannerReruns must be an integer greater than or equal to 1.',
    }])
  })

  it('reports every invalid field at once', () => {
    const validation = validatePlannerWhatIfBounds(bounds(0, -1))
    expect(validation.issues.map(({ path }) => path)).toEqual([
      'maxCandidateTrialsPerCategoryPerTarget',
      'maxPlannerReruns',
    ])
  })

  it('never mutates or repairs the caller value', () => {
    const invalid = bounds(0, 0)
    validatePlannerWhatIfBounds(invalid)
    expect(invalid).toEqual({
      maxCandidateTrialsPerCategoryPerTarget: 0,
      maxPlannerReruns: 0,
    })
  })
})

describe('B9-B1a assertPlannerWhatIfBounds', () => {
  it('accepts valid bounds without returning a substitute', () => {
    expect(assertPlannerWhatIfBounds(bounds(2, 5))).toBeUndefined()
  })

  it('throws a typed error carrying the issues', () => {
    let thrown: unknown = null
    try {
      assertPlannerWhatIfBounds(bounds(0, 1))
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(PlannerWhatIfBoundsError)
    expect((thrown as PlannerWhatIfBoundsError).name).toBe('PlannerWhatIfBoundsError')
    expect((thrown as PlannerWhatIfBoundsError).issues).toEqual([{
      path: 'maxCandidateTrialsPerCategoryPerTarget',
      code: 'invalid_integer',
      message:
        'maxCandidateTrialsPerCategoryPerTarget must be an integer greater than or equal to 1.',
    }])
  })

  it('leaves the invalid input unchanged instead of completing a field', () => {
    const invalid = bounds(Number.NaN, 0)
    expect(() => assertPlannerWhatIfBounds(invalid)).toThrow(PlannerWhatIfBoundsError)
    expect(Number.isNaN(invalid.maxCandidateTrialsPerCategoryPerTarget)).toBe(true)
    expect(invalid.maxPlannerReruns).toBe(0)
  })
})

describe('B9-B2c Production default', () => {
  it('is exactly the 2 / 8 tuple decided from the B9-B2b Browser measurements', () => {
    expect(defaultPlannerWhatIfBounds).toEqual({
      maxCandidateTrialsPerCategoryPerTarget: 2,
      maxPlannerReruns: 8,
    })
  })

  it('passes its own validation and assertion', () => {
    expect(validatePlannerWhatIfBounds(defaultPlannerWhatIfBounds)).toEqual({
      isValid: true,
      issues: [],
    })
    expect(assertPlannerWhatIfBounds(defaultPlannerWhatIfBounds)).toBeUndefined()
  })

  it('exports the same authority through the constrained and Planner barrels', async () => {
    const planner = await import('../index')
    expect(constrainedModule.defaultPlannerWhatIfBounds).toBe(defaultPlannerWhatIfBounds)
    expect(planner.defaultPlannerWhatIfBounds).toBe(defaultPlannerWhatIfBounds)
  })

  it('accepts explicit non-default caller bounds unchanged', () => {
    const callerBounds = bounds(7, 13)
    const before = structuredClone(callerBounds)
    expect(validatePlannerWhatIfBounds(callerBounds).isValid).toBe(true)
    expect(assertPlannerWhatIfBounds(callerBounds)).toBeUndefined()
    expect(callerBounds).toEqual(before)
    expect(callerBounds).not.toEqual(defaultPlannerWhatIfBounds)
  })

  const fields = [
    'maxCandidateTrialsPerCategoryPerTarget',
    'maxPlannerReruns',
  ] as const

  it.each(fields)('fails closed instead of repairing an invalid %s to the default', (field) => {
    const invalid = { ...defaultPlannerWhatIfBounds, [field]: 0 }
    const before = structuredClone(invalid)
    expect(validatePlannerWhatIfBounds(invalid).isValid).toBe(false)
    expect(() => assertPlannerWhatIfBounds(invalid)).toThrow(PlannerWhatIfBoundsError)
    expect(invalid).toEqual(before)
    expect(invalid[field]).toBe(0)
  })

  it.each(fields)('fails closed instead of completing a missing %s from the default', (field) => {
    const invalid = { ...defaultPlannerWhatIfBounds }
    // Model malformed runtime input without making the typed caller contract optional.
    Reflect.deleteProperty(invalid, field)
    const before = structuredClone(invalid)
    const validation = validatePlannerWhatIfBounds(invalid)
    expect(validation.isValid).toBe(false)
    expect(validation.issues.map(({ path }) => path)).toEqual([field])
    expect(() => assertPlannerWhatIfBounds(invalid)).toThrow(PlannerWhatIfBoundsError)
    expect(invalid).toEqual(before)
    expect(invalid).not.toHaveProperty(field)
  })

  it('leaves the B8 orchestration default untouched', () => {
    expect(constrainedModule.defaultPlannerOrchestrationBounds).toEqual({
      maxCandidateTrialsPerConflict: 2,
      maxGeneratedBuildListEntries: 1,
      maxPlannerReruns: 4,
    })
  })
})
