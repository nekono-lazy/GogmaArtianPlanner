import { describe, expect, it } from 'vitest'
import { globalResearchDependencies } from '../plannerGlobalOptimizationResearch'
import {
  conditionReachOptionSet, MATERIALIZATION_D0A2B_REGISTRATION_ITEMS, MATERIALIZATION_D0B2_REGISTRATION_ITEMS, MATERIALIZATION_REACH_OPTION_SETS,
  validateMaterializationRunConditions, type MaterializationResearchConditions,
} from './materializationProtocol'
import { runMaterializationSmoke } from './materializationRunner'
import { ELEMENT_A, materializationScenario, OPEN_GATE, SERIES_IDEAL, type MaterializationScenarioSpec } from './materializationTestFixture'
import { OPEN_SHAPE_BUDGET, OPEN_SHAPE_GATE } from './shapeMaterializationTestFixture'
import { IDEAL_BONUSES, ownedGogma } from './testFixture'
import { REACH_OPTION_SET_A1, REACH_OPTION_SET_A2, type ReachOptionSetVersion } from './types'

/*
 * Issue #154 Global Assignment Phase A-2: the option set as a run condition of either materialization rule. A condition without it
 * is the a1 option set every D-0B / D-0A-2b record was produced with (its record is unchanged, the d0a-v1 golden covers that); a
 * named option set is validated, used for the ReachTable and recorded. No real Export, no Planner run.
 */

const WINDOW = { skill: 3, gogma: 5, normal: 2 }
const d0b = (overrides: Partial<MaterializationResearchConditions> = {}): MaterializationResearchConditions => ({
  window: WINDOW, nodeBudget: 200, mrvLookahead: 4, coverageDrivenOrdering: true, structuralCandidateLimit: 3, deliveryCap: 1_000,
  searchScaleGate: OPEN_GATE, searchPolicyPrecheck: true, ...overrides,
})
const d0a2 = (reachOptionSet?: ReachOptionSetVersion) => ({
  rule: 'd0a2-v2' as const, window: WINDOW, nodeBudget: 200, mrvLookahead: 4, coverageDrivenOrdering: true, structuralCandidateLimit: 3,
  projectedSearchScaleGate: OPEN_GATE, shapeSearchScaleGate: OPEN_SHAPE_GATE, shapeSearchBudget: OPEN_SHAPE_BUDGET,
  routeVerification: 'every_shape_constrained_materialization' as const, ...(reachOptionSet === undefined ? {} : { reachOptionSet }),
})

/** An owned Gogma of a with Ideal Skills (a2 adds its Reset Skills continuations), the Ideal Reset at 12, Ideal Skills at 8 / 9. */
const SKILL_IDEAL_SOURCE: MaterializationScenarioSpec = {
  targets: ['a'], owned: [ownedGogma('owned.g1', { seriesSkillId: SERIES_IDEAL })],
  skillIdeal: { [ELEMENT_A]: [8, 9] }, reset: { [ELEMENT_A]: { 12: IDEAL_BONUSES } }, window: WINDOW,
}

describe('A-2: the option set as a materialization run condition', () => {
  it('names the two option sets, means a1 when absent, and refuses any other value under either rule', () => {
    expect(MATERIALIZATION_REACH_OPTION_SETS).toEqual({ a1: REACH_OPTION_SET_A1, a2: REACH_OPTION_SET_A2 })
    expect(Object.isFrozen(MATERIALIZATION_REACH_OPTION_SETS)).toBe(true)
    expect(conditionReachOptionSet(d0b())).toBe(REACH_OPTION_SET_A1)
    expect(conditionReachOptionSet(d0b({ reachOptionSet: REACH_OPTION_SET_A2 }))).toBe(REACH_OPTION_SET_A2)
    for (const value of [undefined, REACH_OPTION_SET_A1, REACH_OPTION_SET_A2]) {
      expect(validateMaterializationRunConditions(value === undefined ? d0b() : d0b({ reachOptionSet: value }))).toEqual([])
      expect(validateMaterializationRunConditions(d0a2(value))).toEqual([])
    }
    for (const value of ['a2', 'global-assignment-reach-options:a3', null, 2]) {
      expect(validateMaterializationRunConditions({ ...d0b(), reachOptionSet: value })).toEqual([expect.stringMatching(/^reachOptionSet must be global-assignment-reach-options:a1 or global-assignment-reach-options:a2/)])
      expect(validateMaterializationRunConditions({ ...d0a2(), reachOptionSet: value })).toEqual([expect.stringMatching(/^reachOptionSet must be/)])
    }
    // D-0B-2 registers the option set it measures (the item existed before A-2; its value now exists).
    expect(MATERIALIZATION_D0B2_REGISTRATION_ITEMS).toContain('optionSetVersion')
    expect(MATERIALIZATION_D0A2B_REGISTRATION_ITEMS).toContain('optionSetVersion')
  })

  it('builds the ReachTable with the named option set and records it; the a1 run records no field and keeps the D-0B diagnostics', async () => {
    const scene = await materializationScenario(SKILL_IDEAL_SOURCE)
    let tick = 0
    const runOf = (conditions: Parameters<typeof runMaterializationSmoke>[2]['conditions']) =>
      runMaterializationSmoke(scene.input, globalResearchDependencies(scene.engine), { conditions }, { now: () => (tick += 1) })
    for (const conditions of [d0b(), d0b({ reachOptionSet: REACH_OPTION_SET_A2 }), d0a2(), d0a2(REACH_OPTION_SET_A2)]) {
      const named = 'reachOptionSet' in conditions ? conditions.reachOptionSet : undefined
      const result = await runOf(conditions)
      expect(result.semantic.integrityIssues).toEqual([])
      expect('reachOptionSet' in result.semantic.conditions).toBe(named !== undefined)
      if (named !== undefined) expect((result.semantic.conditions as { reachOptionSet?: string }).reachOptionSet).toBe(named)
      const first = result.semantic.candidates[0]!
      // The first candidate is the dominating zero-Skill one under both sets (a2 continuations come later in the value order).
      expect(first.diagnostics.continuationOptions).toEqual({
        laneStartIdealSkillContinuation: 0,
        ownedGogmaContinuation: named === REACH_OPTION_SET_A2 ? { options: 0, skill: 0, bonus: 0 } : 'not_generated_by_current_phase_a',
      })
    }
    // Under a2 the later structural candidates hold the continuations: a d0a-v1 run classifies them as Search-policy shapes.
    const a2 = await runOf(d0b({ reachOptionSet: REACH_OPTION_SET_A2 }))
    const continued = a2.semantic.candidates.filter(candidate => typeof candidate.diagnostics.continuationOptions.ownedGogmaContinuation !== 'string'
      && candidate.diagnostics.continuationOptions.ownedGogmaContinuation.options > 0)
    expect(continued.length).toBeGreaterThan(0)
    for (const candidate of continued) expect(candidate.diagnostics.searchPolicyShapes.shapes.map(shape => shape.policyShape.policy)).toEqual(['lane_start_ideal_owned_gogma_continuation'])
    // The a1 run of the same input never reaches a continuation.
    for (const candidate of (await runOf(d0b())).semantic.candidates) expect(candidate.diagnostics.searchPolicyShapes.shapes).toEqual([])
  }, 60_000)
})
