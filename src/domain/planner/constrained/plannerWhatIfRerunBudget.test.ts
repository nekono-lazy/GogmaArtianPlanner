import { describe, expect, it } from 'vitest'
import { runtimeUnsupportedFixture } from '../../../test/fixtures/plannerRuntimeUnsupported'
import { createProductionPlanWithObserver } from '../productionPlanGeneration'
import { PlannerWhatIfBoundsError } from './plannerWhatIfBounds'
import {
  createPlannerWhatIfFullBeamBudget,
  PlannerWhatIfRerunLimitError,
} from './plannerWhatIfRerunBudget'

/**
 * The B9 shared `maxPlannerReruns` budget (PLANNER_SPEC 9.2.4.9).
 *
 * The retry tests drive the real shared Production Plan generation over the
 * existing two-Beam fixture, so the rule that a runtime-unsupported retry Beam
 * Search consumes the budget is asserted against actual behaviour rather than
 * against a hand-made observer call sequence.
 */

describe('B9 what-if full Beam budget', () => {
  it('fails closed on invalid bounds instead of substituting a default', () => {
    expect(() =>
      createPlannerWhatIfFullBeamBudget({
        maxCandidateTrialsPerCategoryPerTarget: 1,
        maxPlannerReruns: 0,
      }),
    ).toThrow(PlannerWhatIfBoundsError)
  })

  it('counts every started execution and reports exhaustion without truncating', () => {
    const budget = createPlannerWhatIfFullBeamBudget({
      maxCandidateTrialsPerCategoryPerTarget: 1,
      maxPlannerReruns: 2,
    })

    expect({ used: budget.used, exhausted: budget.exhausted }).toEqual({
      used: 0,
      exhausted: false,
    })
    budget.beforeBeamSearch()
    expect({ used: budget.used, exhausted: budget.exhausted }).toEqual({
      used: 1,
      exhausted: false,
    })
    // Reaching the limit is not itself a stop: the limit-th execution runs.
    budget.beforeBeamSearch()
    expect({ used: budget.used, exhausted: budget.exhausted }).toEqual({
      used: 2,
      exhausted: true,
    })
  })

  it('refuses the execution the limit actually blocks', () => {
    const budget = createPlannerWhatIfFullBeamBudget({
      maxCandidateTrialsPerCategoryPerTarget: 1,
      maxPlannerReruns: 1,
    })
    budget.beforeBeamSearch()

    expect(() => budget.beforeBeamSearch()).toThrow(PlannerWhatIfRerunLimitError)
    // The refused execution never started, so it is not counted.
    expect(budget.used).toBe(1)
    try {
      budget.beforeBeamSearch()
    } catch (error) {
      expect(error).toBeInstanceOf(PlannerWhatIfRerunLimitError)
      if (!(error instanceof PlannerWhatIfRerunLimitError)) return
      expect({ limit: error.limit, used: error.used }).toEqual({ limit: 1, used: 1 })
    }
  })

  it('counts a runtime-unsupported retry Beam Search', async () => {
    const { input, dependencies } = runtimeUnsupportedFixture()
    const budget = createPlannerWhatIfFullBeamBudget({
      maxCandidateTrialsPerCategoryPerTarget: 1,
      maxPlannerReruns: 2,
    })

    const result = await createProductionPlanWithObserver(
      input,
      dependencies,
      undefined,
      budget,
    )

    expect(result.plan).not.toBeNull()
    // One initial Beam Search plus the retry the Trace Replay forced.
    expect(budget.used).toBe(2)
  })

  it('blocks the retry Beam Search when only one execution is affordable', async () => {
    const { input, dependencies } = runtimeUnsupportedFixture()
    const budget = createPlannerWhatIfFullBeamBudget({
      maxCandidateTrialsPerCategoryPerTarget: 1,
      maxPlannerReruns: 1,
    })

    // The first Beam Search's Trace Replay never succeeded, so its result must
    // not be turned into a Plan. The blocked retry raises the typed signal
    // instead, and the caller reports a bound rather than a decided Candidate.
    await expect(
      createProductionPlanWithObserver(input, dependencies, undefined, budget),
    ).rejects.toBeInstanceOf(PlannerWhatIfRerunLimitError)
    expect(budget.used).toBe(1)
  })
})
