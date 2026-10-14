import { describe, expect, it } from 'vitest'
import * as plannerRuntimeOptions from '../../services/planner/plannerRuntimeOptions'
import { PLANNER_MAX_PLAN_STEPS_INCREMENT, roundUpPlannerMaxPlanSteps } from './plannerStepBound'

/*
 * Issue #260 PR-2 (`docs/PLANNER_SPEC.md` 17.13, `docs/PLANNER_GLOBAL_ASSIGNMENT_PRODUCTION_INTEGRATION.md` 14.1 / 19.1):
 * the 500 rounding rule moved from the Service layer to a shared Domain helper with the same contract. The Service keeps
 * the same names as a re-export (its own `plannerRuntimeOptions.test.ts` runs unchanged).
 */

const sources = import.meta.glob('./plannerStepBound.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

describe('roundUpPlannerMaxPlanSteps (shared Domain helper)', () => {
  it('rounds a non-negative Step count up to the next multiple of 500', () => {
    expect(PLANNER_MAX_PLAN_STEPS_INCREMENT).toBe(500)
    expect([0, 1, 500, 501, 1000, 1001].map(roundUpPlannerMaxPlanSteps)).toEqual([0, 500, 500, 1000, 1000, 1500])
  })

  it.each([-1, -0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('refuses %s with a RangeError, as before', (value) => {
    expect(() => roundUpPlannerMaxPlanSteps(value)).toThrow(RangeError)
    expect(() => roundUpPlannerMaxPlanSteps(value)).toThrow(`A Planner Step count must be a non-negative finite number: ${value}`)
  })

  it('is what the Service re-exports: the same function and the same value', () => {
    expect(plannerRuntimeOptions.roundUpPlannerMaxPlanSteps).toBe(roundUpPlannerMaxPlanSteps)
    expect(plannerRuntimeOptions.PLANNER_MAX_PLAN_STEPS_INCREMENT).toBe(PLANNER_MAX_PLAN_STEPS_INCREMENT)
  })

  it('reads no Service, persistence, UI setting or Worker request (Domain -> Service would invert the dependency)', () => {
    const source = sources['./plannerStepBound.ts']!
    expect(source).toBeDefined()
    // The module comment names what it does not read; the checks read code only.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect([...code.matchAll(/from '([^']+)'/g)]).toEqual([])
    expect(code).not.toMatch(/AppSettings|indexedDB|Dexie|localStorage|services|import\(/)
  })
})
