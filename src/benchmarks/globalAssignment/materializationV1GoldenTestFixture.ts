/**
 * Test-only golden of the Phase D-0A / D-0B materialization rule `d0a-v1` (Issue #154 Phase D-0A-2b,
 * `docs/PLANNER_GLOBAL_ASSIGNMENT_D0A2_DESIGN.md` 11 / 12 / 19): what the D-0A materialization, the D-0B diagnostics
 * and the D-0B runner return on the synthetic fixtures, serialized exactly as the runner serializes its semantic record
 * (`JSON.stringify`, key order included, so `semanticSha256` is covered too).
 *
 * `recordMaterializationV1Golden()` produced the expected records ONCE, on main 4be6ec6 (PR #248 merged), before any
 * D-0A-2b change, and they are frozen in `src/test/fixtures/globalAssignmentMaterializationV1GoldenPreD0A2B.json`. A test
 * never regenerates them: the `d0a-v1` path must keep returning exactly these values after the rule `d0a2-v2` exists.
 */
import { conversion, keep, NONE, reset, resetThenKeep } from './coverageTestFixture'
import { buildPlannerAlternativeRequest, buildProjectedRequest, executeMaterializationRequest, materializeStructuralCandidate } from './materialize'
import {
  countContinuationOptions, diagnoseBonusFrontierRisk, diagnosePlannerStartIdeal, diagnoseSearchPolicyShapes,
} from './materializationDiagnostics'
import type { MaterializationResearchConditions } from './materializationProtocol'
import { runMaterializationSmoke, summarizeMaterializationRun } from './materializationRunner'
import {
  ELEMENT_A, ELEMENT_B, materializationScenario, newNormalSource, OPEN_GATE, ownedSource, REORDERED_GOGMA, scenarioAlternativeFirst, scenarioConversionFallback,
  scenarioHeldCrossing, scenarioSkillDependency, TARGET, type MaterializationScenarioSpec,
} from './materializationTestFixture'
import type { CandidateInspection } from './materializationTypes'
import { IDEAL_BONUSES, ownedGogma } from './testFixture'
import { globalResearchDependencies } from '../plannerGlobalOptimizationResearch'
import type { StructuralCandidate } from './coverageTypes'
import type { MaterializationScenario } from './materializationTestFixture'

const WINDOW = { skill: 3, gogma: 5, normal: 2 }
const SERIES_IDEAL = 'series_skill.fixture.a'

/** The D-0B runner test inputs (the held-crossing and Search-policy specs). */
export const V1_GOLDEN_RUNNER_SPECS: Record<'held_crossing' | 'policy_first', MaterializationScenarioSpec> = {
  held_crossing: {
    targets: ['a', 'c'],
    owned: [ownedGogma('owned.g1', { seriesSkillId: SERIES_IDEAL }), ownedGogma('owned.g2', { seriesSkillId: SERIES_IDEAL })],
    reset: { [ELEMENT_A]: { 11: REORDERED_GOGMA, 12: IDEAL_BONUSES } },
    keepIdeal: [14],
    window: WINDOW,
  },
  policy_first: {
    targets: ['a', 'b'],
    owned: [],
    skillIdeal: { [ELEMENT_B]: [7, 9], [ELEMENT_A]: [10] },
    reset: { [ELEMENT_B]: { 11: IDEAL_BONUSES }, [ELEMENT_A]: { 12: IDEAL_BONUSES } },
    window: WINDOW,
  },
}

export function v1GoldenConditions(overrides: Partial<MaterializationResearchConditions> = {}): MaterializationResearchConditions {
  return {
    window: WINDOW, nodeBudget: 200, mrvLookahead: 4, coverageDrivenOrdering: true, structuralCandidateLimit: 1, deliveryCap: 1_000,
    searchScaleGate: OPEN_GATE, searchPolicyPrecheck: true, ...overrides,
  }
}

/** A plain-JSON copy with the key order `JSON.stringify` writes (what the runner hashes). */
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value))

async function diagnosticsOf(scene: MaterializationScenario, candidate: StructuralCandidate) {
  return plain({
    searchPolicyShapes: diagnoseSearchPolicyShapes(candidate, scene.table),
    continuationOptions: countContinuationOptions(candidate, scene.table),
    bonusFrontier: diagnoseBonusFrontierRisk(candidate, scene.table),
    plannerStartIdeal: diagnosePlannerStartIdeal(candidate, scene.context),
  })
}

async function materializeWithInspections(scene: MaterializationScenario, candidate: StructuralCandidate, searchPolicyPrecheck: boolean) {
  const inspections: CandidateInspection[] = []
  const result = await materializeStructuralCandidate(candidate, {
    ...scene.inputs(), ...(searchPolicyPrecheck ? { searchPolicyPrecheck: true } : {}), observer: { onCandidateInspected: value => { inspections.push(value) } },
  })
  return plain({ result, inspections })
}

async function runnerRecord(spec: MaterializationScenarioSpec, conditions: MaterializationResearchConditions) {
  const scene = await materializationScenario(spec)
  let tick = 0
  const result = await runMaterializationSmoke(scene.input, globalResearchDependencies(scene.engine), { conditions }, { now: () => (tick += 1) })
  return plain({ semantic: result.semantic, summary: summarizeMaterializationRun(result.semantic) })
}

/**
 * Every `d0a-v1` record of the golden, keyed by case name. The cases are the D-0A materialization scenarios (with and
 * without the D-0B Search-policy precheck), the D-0A G1 shape, the gate, the G3 Keep-chain collapse, the D-0B static
 * diagnostics of each candidate, and the D-0B runner (all materialized, Search-policy shape over three candidates, gate).
 */
export async function recordMaterializationV1Golden(): Promise<Record<string, unknown>> {
  const golden: Record<string, unknown> = {}
  const scenarios = [
    ['held_crossing', scenarioHeldCrossing], ['conversion_fallback', scenarioConversionFallback],
    ['skill_dependency', scenarioSkillDependency], ['alternative_first', scenarioAlternativeFirst],
  ] as const
  for (const [name, build] of scenarios) {
    const { scene, candidate } = await build()
    golden[`materialize.${name}`] = await materializeWithInspections(scene, candidate, false)
    golden[`materialize.${name}.precheck`] = await materializeWithInspections(scene, candidate, true)
    golden[`diagnostics.${name}`] = await diagnosticsOf(scene, candidate)
  }
  {
    const { scene, candidate } = await scenarioHeldCrossing()
    golden['materialize.held_crossing.gate'] = plain(await materializeStructuralCandidate(candidate, scene.inputs({ settings: { deliveryCap: 1_000, searchScaleGate: { ...OPEN_GATE, maxGogmaLegalWidth: 0 } } })))
    golden['materialize.held_crossing.cap1'] = plain(await materializeStructuralCandidate(candidate, scene.inputs({ settings: { deliveryCap: 1, searchScaleGate: OPEN_GATE } })))
    // c alone under the empty reservation: its cheaper Ideal Routes come first, so a cap of 1 stops before the match.
    const shapeC = candidate.expectedShapes.find(value => value.targetWeaponId === TARGET.c)!
    const shapeA = candidate.expectedShapes.find(value => value.targetWeaponId === TARGET.a)!
    const capped = scene.inputs({ settings: { deliveryCap: 1, searchScaleGate: OPEN_GATE } })
    golden['request.held_crossing.c_alone.cap1'] = plain(await executeMaterializationRequest(await buildPlannerAlternativeRequest(shapeC, [], capped), [], capped))
    golden['request.held_crossing.c_alone.open'] = plain(await executeMaterializationRequest(await buildPlannerAlternativeRequest(shapeC, [], scene.inputs()), [], scene.inputs()))
    golden['request.held_crossing.a_projected'] = plain(await executeMaterializationRequest(await buildProjectedRequest(shapeA, scene.inputs()), [], scene.inputs()))
  }
  {
    // D-0A: a conversion whose Skill is already Ideal before a later final Skill (design 19.3 G1).
    const scene = await materializationScenario({
      targets: ['b'], owned: [], skillIdeal: { [ELEMENT_B]: [7, 8] }, reset: { [ELEMENT_B]: { 10: IDEAL_BONUSES } }, window: WINDOW,
    })
    const candidate = scene.candidate([scene.option(TARGET.b, newNormalSource(4), conversion(7, 8), reset(10))])
    golden['materialize.g1_policy_shape'] = await materializeWithInspections(scene, candidate, false)
    golden['materialize.g1_policy_shape.precheck'] = await materializeWithInspections(scene, candidate, true)
    golden['diagnostics.g1_policy_shape'] = await diagnosticsOf(scene, candidate)
  }
  {
    // D-0B G3 (upper): a Keep chain over a same-layout Reset position collapses into the Reset history.
    const scene = await materializationScenario({
      targets: ['a'],
      owned: [ownedGogma('owned.g1', { seriesSkillId: SERIES_IDEAL, restorationBonuses: structuredClone(REORDERED_GOGMA) })],
      reset: { [ELEMENT_A]: { 12: REORDERED_GOGMA } },
      keepIdeal: [14],
      window: WINDOW,
    })
    const candidate = scene.candidate([scene.option(TARGET.a, ownedSource('owned.g1'), NONE, keep(14))])
    golden['materialize.g3_upper_keep_chain'] = await materializeWithInspections(scene, candidate, true)
    golden['diagnostics.g3_upper_keep_chain'] = await diagnosticsOf(scene, candidate)
    const rtk = scene.candidate([scene.option(TARGET.a, ownedSource('owned.g1'), NONE, resetThenKeep(12, 14))])
    golden['materialize.g3_upper_reset_then_keep'] = await materializeWithInspections(scene, rtk, true)
    golden['diagnostics.g3_upper_reset_then_keep'] = await diagnosticsOf(scene, rtk)
  }
  golden['runner.held_crossing'] = await runnerRecord(V1_GOLDEN_RUNNER_SPECS.held_crossing, v1GoldenConditions())
  golden['runner.policy_first.limit3'] = await runnerRecord(V1_GOLDEN_RUNNER_SPECS.policy_first, v1GoldenConditions({ structuralCandidateLimit: 3 }))
  golden['runner.held_crossing.gate'] = await runnerRecord(V1_GOLDEN_RUNNER_SPECS.held_crossing, v1GoldenConditions({ searchScaleGate: { ...OPEN_GATE, maxGogmaLegalWidth: 0 } }))
  golden['runner.held_crossing.cap1'] = await runnerRecord(V1_GOLDEN_RUNNER_SPECS.held_crossing, v1GoldenConditions({ deliveryCap: 1, structuralCandidateLimit: 2 }))
  return golden
}
