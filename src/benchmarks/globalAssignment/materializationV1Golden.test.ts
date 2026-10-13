import { describe, expect, it } from 'vitest'
import golden from '../../test/fixtures/globalAssignmentMaterializationV1GoldenPreD0A2B.json'
import { recordMaterializationV1Golden } from './materializationV1GoldenTestFixture'

/*
 * Issue #154 Global Assignment Phase D-0A-2b (`docs/PLANNER_GLOBAL_ASSIGNMENT_D0A2_DESIGN.md` 11 / 12 / 19): the rule
 * `d0a-v1` (the D-0A materialization, the D-0B diagnostics and the D-0B runner, which run it when no rule is named) returns
 * exactly the records frozen on main 4be6ec6 before any D-0A-2b change - the same values, the same serialization (key order
 * included, so the runner's `semanticSha256` is unchanged) and the same classifications. The golden is never regenerated.
 */

describe('Phase D-0A-2b: the d0a-v1 rule is unchanged', () => {
  it('reproduces every frozen d0a-v1 record verbatim', async () => {
    const recorded = await recordMaterializationV1Golden()
    const frozen = golden as Record<string, unknown>
    expect(Object.keys(recorded)).toEqual(Object.keys(frozen))
    for (const key of Object.keys(frozen)) {
      expect(JSON.stringify(recorded[key]), key).toBe(JSON.stringify(frozen[key]))
    }
  }, 120_000)
})
