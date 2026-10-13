import { describe, expect, it } from 'vitest'
import type { RngEngineCapabilities } from '../../domain/rng/rngEngine'
import { ShapeConstrainedSearchError } from '../../domain/search/research'
import { globalResearchDependencies } from '../plannerGlobalOptimizationResearch'
import { buildPlannerAlternativeRequest, executeMaterializationRequest, materializeStructuralCandidate, productionShapeMaterializationSearchPort } from './materialize'
import {
  bonusFrontierLowerRequestRisk, diagnoseBonusFrontierLowerRisk, diagnoseBonusFrontierRisk, measureBonusFrontierLowerCollapse,
} from './materializationDiagnostics'
import {
  classifyMaterializationStage, MATERIALIZATION_D0A2B_PROTOCOL_VERSION, MATERIALIZATION_D0A2B_REGISTRATION_ITEMS, MATERIALIZATION_D0B_PROTOCOL_VERSION, MATERIALIZATION_D0B2_REGISTRATION_ITEMS,
  materializationFollowUp, materializationProtocolVersion, validateMaterializationRunConditions, validateShapeMaterializationResearchConditions,
  type ShapeMaterializationResearchConditions,
} from './materializationProtocol'
import { runMaterializationSmoke, summarizeMaterializationRun, type MaterializationRunExecution } from './materializationRunner'
import { materializationScenario, OPEN_GATE, TARGET, type MaterializationScenarioSpec } from './materializationTestFixture'
import type { CandidateInspection, MaterializationStageOutcome, PlannerAlternativeAttempt } from './materializationTypes'
import { V1_GOLDEN_RUNNER_SPECS, v1GoldenConditions } from './materializationV1GoldenTestFixture'
import { OPEN_SHAPE_BUDGET, OPEN_SHAPE_GATE, scenarioG3Lower, shapeInputs, OPEN_SHAPE_SETTINGS } from './shapeMaterializationTestFixture'
import type { ShapeConstrainedAttempt } from './shapeMaterializationTypes'

/*
 * Issue #154 Global Assignment Phase D-0A-2b (`docs/PLANNER_GLOBAL_ASSIGNMENT_D0A2_DESIGN.md` 10.2 / 11 / 12): the runner and
 * protocol of the rule d0a2-v2 beside the unchanged d0a-v1 - conditions of their own type, the protocol version, the candidate
 * classes and their design 10.3 roles, the shape attempt records, the G3 lower variant (separate fields), the summary, and the
 * determinism of the semantic record. No real Export, no Planner run.
 */

const WINDOW = { skill: 3, gogma: 5, normal: 2 }

function shapeConditions(overrides: Partial<ShapeMaterializationResearchConditions> = {}): ShapeMaterializationResearchConditions {
  return {
    rule: 'd0a2-v2', window: WINDOW, nodeBudget: 200, mrvLookahead: 4, coverageDrivenOrdering: true, structuralCandidateLimit: 1,
    projectedSearchScaleGate: OPEN_GATE, shapeSearchScaleGate: OPEN_SHAPE_GATE, shapeSearchBudget: OPEN_SHAPE_BUDGET, routeVerification: 'every_shape_constrained_materialization',
    ...overrides,
  }
}

type Scene = Awaited<ReturnType<typeof materializationScenario>>

async function run(spec: MaterializationScenarioSpec, conditions: Parameters<typeof runMaterializationSmoke>[2]['conditions'], execution: Partial<MaterializationRunExecution> | ((scene: Scene) => Partial<MaterializationRunExecution>) = {}) {
  const scene = await materializationScenario(spec)
  let tick = 0
  const extra = typeof execution === 'function' ? execution(scene) : execution
  const result = await runMaterializationSmoke(scene.input, globalResearchDependencies(scene.engine), { conditions }, { now: () => (tick += 1), ...extra })
  return { scene, result }
}

describe('Phase D-0A-2b protocol: the rule d0a2-v2 beside d0a-v1', () => {
  it('validates d0a2-v2 conditions of their own type, never as d0a-v1 conditions with extra fields, and keeps d0a-v1 without a rule field', () => {
    expect(validateShapeMaterializationResearchConditions(shapeConditions())).toEqual([])
    expect(validateMaterializationRunConditions(shapeConditions())).toEqual([])
    expect(validateMaterializationRunConditions(v1GoldenConditions())).toEqual([])
    const issuesOf = (edit: Record<string, unknown>) => validateMaterializationRunConditions({ ...shapeConditions(), ...edit })
    expect(issuesOf({ shapeSearchScaleGate: undefined })[0]).toMatch(/^shapeSearchScaleGate must name/)
    expect(issuesOf({ shapeSearchBudget: { ...OPEN_SHAPE_BUDGET, maxSettledWork: -1 } })[0]).toMatch(/^shapeSearchBudget must name/)
    expect(issuesOf({ projectedSearchScaleGate: { maxConversionPositions: 1 } })[0]).toMatch(/^projectedSearchScaleGate must name/)
    expect(issuesOf({ routeVerification: 'continuation_only' })[0]).toMatch(/^routeVerification must be every_shape_constrained_materialization/)
    expect(issuesOf({ deliveryCap: 500 })).toEqual(['deliveryCap belongs to the rule d0a-v1 and is not a d0a2-v2 condition.'])
    expect(issuesOf({ searchPolicyPrecheck: true })).toEqual(['searchPolicyPrecheck belongs to the rule d0a-v1 and is not a d0a2-v2 condition.'])
    expect(validateMaterializationRunConditions({ ...v1GoldenConditions(), rule: 'd0a-v1' })).toEqual(['rule must be d0a2-v2, or absent for the rule d0a-v1 (got d0a-v1).'])
    expect(validateMaterializationRunConditions({ ...v1GoldenConditions(), rule: 'd0a2-v3' })[0]).toMatch(/^rule must be d0a2-v2/)
    expect(materializationProtocolVersion(shapeConditions())).toBe(MATERIALIZATION_D0A2B_PROTOCOL_VERSION)
    expect(materializationProtocolVersion(v1GoldenConditions())).toBe(MATERIALIZATION_D0B_PROTOCOL_VERSION)
    expect(MATERIALIZATION_D0B_PROTOCOL_VERSION).toBe('global-assignment-d0b:1')
    // Nothing is registered: the d0a2-v2 items are left to D-0B-2 apart from the unchanged D-0B list.
    expect(MATERIALIZATION_D0B2_REGISTRATION_ITEMS).toEqual(['deliveryCap', 'searchScaleGate', 'childWallMs', 'childHeapMb', 'nodeBudget', 'structuralCandidateLimit', 'optionSetVersion', 'methodSelectionRule', 'searchPolicyShapeRule'])
    for (const item of ['shapeSearchScaleGate', 'shapeSearchBudget', 'routeVerification', 'methodSelectionRule']) expect(MATERIALIZATION_D0A2B_REGISTRATION_ITEMS).toContain(item)
  })

  it('classifies the shape method\'s budget stop, gate and unsupported ends, each with its design 10.3 role', () => {
    const T = TARGET.a
    const cases: [MaterializationStageOutcome, string, string][] = [
      [{ kind: 'materialization_unconfirmed', targetWeaponId: T, outcome: { kind: 'unconfirmed', reason: 'shape_search_budget_reached', budgetExceeded: ['settledWork'], delivered: 0, closestMismatch: null } }, 'unconfirmed_shape_search_budget', 'settings_review'],
      [{ kind: 'materialization_unconfirmed', targetWeaponId: T, outcome: { kind: 'not_executed', reason: 'search_scale_gate', method: 'shape_constrained', predicted: {} as never, exceeded: ['depthUpperBound'] } }, 'not_executed_search_scale_gate', 'settings_review'],
      [{ kind: 'materialization_unsupported', targetWeaponId: T, outcome: { kind: 'unsupported', reason: 'capability_unavailable', detail: { origin: 'base_diagnosis', unavailable: null, predictions: [], questions: [] } } }, 'unsupported_shape_prediction', 'support_review'],
    ]
    for (const [stage, expected, followUp] of cases) {
      const kind = classifyMaterializationStage(stage)
      expect(kind).toBe(expected)
      expect(materializationFollowUp(kind).followUp).toBe(followUp)
      // None of them is a window expansion basis; support is never a setting.
      expect(materializationFollowUp(kind).windowExpansionBasis).toBe(false)
    }
    expect(materializationFollowUp('unsupported_shape_prediction')).toEqual({ followUp: 'support_review', windowExpansionBasis: false, settingsReviewBasis: false })
  })
})

describe('Phase D-0A-2b runner under d0a2-v2', () => {
  it('materializes the Search-policy candidate d0a-v1 stops at, records the shape attempts, and keeps d0a-v1 records free of d0a2-v2 fields', async () => {
    const { result } = await run(V1_GOLDEN_RUNNER_SPECS.policy_first, shapeConditions({ structuralCandidateLimit: 3 }))
    const semantic = result.semantic
    expect(semantic.protocolVersion).toBe(MATERIALIZATION_D0A2B_PROTOCOL_VERSION)
    expect(semantic.conditions).toEqual(shapeConditions({ structuralCandidateLimit: 3 }))
    expect(semantic.integrityIssues).toEqual([])
    expect(semantic.outcome).toEqual({ kind: 'structural_candidates_materialized', classifications: ['all_materialized', 'all_materialized', 'all_materialized'] })
    const [first] = semantic.candidates
    expect(first!.diagnostics.searchPolicyShapes.shapes).toHaveLength(1)
    const b = first!.targets.find(target => target.targetWeaponId === TARGET.b)!
    expect(b.selection).toMatchObject({ materializationRule: 'd0a2-v2', rule: 'continuation_shape_constrained_only', policyShape: { conversionPosition: 7, finalPosition: 9 } })
    expect(b.outcome).toMatchObject({ kind: 'materialized', method: 'shape_constrained' })
    expect(b.attempts).toHaveLength(1)
    const attempt = b.attempts[0]!
    if (attempt.method !== 'shape_constrained') throw new Error(attempt.method)
    expect(attempt).toMatchObject({ materializationRule: 'd0a2-v2', premiseViolations: [], routeChecks: { passed: true, issues: [] }, observed: { deliveredCandidates: 1, stop: { by: 'consumer' } } })
    expect(attempt.searchIdentity.startsWith('research.global-assignment.shape.')).toBe(true)
    expect(first!.shapeGateExceeded).toEqual({ depthUpperBound: 0, gogmaGeneratedStateUpperBound: 0, normalForgeCount: 0, conversionWalkPositions: 0 })
    expect(first!.diagnostics.bonusFrontierLower).toBeDefined()
    expect(b.bonusFrontierLower).toBeDefined()
    const summary = summarizeMaterializationRun(semantic)
    expect(summary.candidates[0]!.shapeConstrained).toMatchObject({ policyShapesTakenOn: 1, materializedBy: { shape_constrained: expect.any(Number), candidate_search_projected: expect.any(Number) } })
    expect(summary.candidates[0]!.shapeConstrained!.materializedBy.shape_constrained + summary.candidates[0]!.shapeConstrained!.materializedBy.candidate_search_projected).toBe(2)
    expect(JSON.stringify(summary)).not.toMatch(/target\.fixture|owned\.g/)
    // The d0a-v1 record of the same input has none of the d0a2-v2 fields.
    const v1 = await run(V1_GOLDEN_RUNNER_SPECS.policy_first, v1GoldenConditions({ structuralCandidateLimit: 3 }))
    const v1Text = JSON.stringify(v1.result.semantic)
    for (const field of ['shapeGateExceeded', 'bonusFrontierLower', 'materializationRule', 'routeChecks', 'shapeConstrained', MATERIALIZATION_D0A2B_PROTOCOL_VERSION]) expect(v1Text).not.toContain(field)
    expect(JSON.stringify(summarizeMaterializationRun(v1.result.semantic))).not.toContain('shapeConstrained')
  }, 60_000)

  it('returns an identical semantic record on a second run', async () => {
    for (const spec of [V1_GOLDEN_RUNNER_SPECS.held_crossing, V1_GOLDEN_RUNNER_SPECS.policy_first]) {
      const one = await run(spec, shapeConditions({ structuralCandidateLimit: 3 }))
      const two = await run(spec, shapeConditions({ structuralCandidateLimit: 3 }))
      expect(JSON.stringify(two.result.semantic)).toBe(JSON.stringify(one.result.semantic))
    }
  }, 60_000)

  it('records a budget stop, a gate and an unsupported capability apart, and a fail-closed stop with its detail', async () => {
    const budget = await run(V1_GOLDEN_RUNNER_SPECS.held_crossing, shapeConditions({ projectedSearchScaleGate: { ...OPEN_GATE, maxGogmaLegalWidth: 0 }, shapeSearchBudget: { ...OPEN_SHAPE_BUDGET, maxSettledWork: 0 } }))
    expect(budget.result.semantic.candidates[0]).toMatchObject({ classification: 'unconfirmed_shape_search_budget', followUp: { followUp: 'settings_review' }, stage: { outcome: { kind: 'unconfirmed', reason: 'shape_search_budget_reached', budgetExceeded: ['settledWork'] } } })
    const gate = await run(V1_GOLDEN_RUNNER_SPECS.held_crossing, shapeConditions({ projectedSearchScaleGate: { ...OPEN_GATE, maxGogmaLegalWidth: 0 }, shapeSearchScaleGate: { ...OPEN_SHAPE_GATE, maxDepthUpperBound: 0 } }))
    const gated = gate.result.semantic.candidates[0]!
    expect(gated).toMatchObject({ classification: 'not_executed_search_scale_gate', shapeGateExceeded: { depthUpperBound: 1 }, gateExceeded: { gogmaLegalWidth: 1 } })
    // The Engine loses a capability flag Phase A / C never read (they ask the prediction support, which still answers supported)
    // after the structural search: unsupported(capability_unavailable), never a mismatch or a failure.
    const supportKept = { ...V1_GOLDEN_RUNNER_SPECS.held_crossing, support: (input: { type: string }) => (input.type === 'gogma_reset' || input.type === 'gogma_keep' ? { supported: true as const } : null) }
    const unsupported = await run(supportKept, shapeConditions({ projectedSearchScaleGate: { ...OPEN_GATE, maxGogmaLegalWidth: 0 } }), scene => ({
      onProgress: event => { if (event.kind === 'structural_search') (scene.engine.capabilities as RngEngineCapabilities).supportsGogmaPrediction = false },
    }))
    expect(unsupported.result.semantic.candidates[0]!.failClosed).toBeNull()
    expect(unsupported.result.semantic.candidates[0]).toMatchObject({
      classification: 'unsupported_shape_prediction', followUp: { followUp: 'support_review', windowExpansionBasis: false, settingsReviewBasis: false },
      stage: { kind: 'materialization_unsupported', outcome: { kind: 'unsupported', reason: 'capability_unavailable' } },
    })
    const failing = await run(V1_GOLDEN_RUNNER_SPECS.held_crossing, shapeConditions({ projectedSearchScaleGate: { ...OPEN_GATE, maxGogmaLegalWidth: 0 } }), {
      shapeSearch: { ...productionShapeMaterializationSearchPort, visitShapeConstrainedRouteCandidates: async () => { throw new ShapeConstrainedSearchError('shape_search_contract_violation', 'broken') } },
    })
    expect(failing.result.semantic.candidates[0]).toMatchObject({ classification: 'fail_closed', followUp: { followUp: 'run_error' }, failClosed: { code: 'shape_search_contract_violation' } })
  }, 60_000)
})

describe('Phase D-0A-2b G3 lower variant diagnostics (design 3.7), apart from the upper one', () => {
  it('finds q below g1 statically, reads the request\'s reservation, and counts the collapse signature in Planner Alternative deliveries', async () => {
    const { scene, candidate, shape } = await scenarioG3Lower()
    const lower = diagnoseBonusFrontierLowerRisk(candidate, scene.table)
    expect(lower).toMatchObject({ applicableOptions: 1, withStaticRisk: 1, targets: [{ targetWeaponId: TARGET.c, requiredGogma: [11, 14], scanRange: { from: 10, to: 10 }, sameLayoutResetPositions: [10], otherTargetRequired: [] }] })
    // The upper variant of the same option scans 12 .. 13 only and finds nothing: two separate counts.
    expect(diagnoseBonusFrontierRisk(candidate, scene.table).targets.find(row => row.targetWeaponId === TARGET.c)).toMatchObject({ scanRange: { from: 12, to: 13 }, sameLayoutResetPositions: [] })
    const risk = lower.targets[0]!
    // a materialized from the origin (projected gated): 10 .. 12 held, 12 blocked.
    const run = await materializeStructuralCandidate(candidate, shapeInputs(scene, { settings: { ...OPEN_SHAPE_SETTINGS, projectedSearchScaleGate: { ...OPEN_GATE, maxGogmaLegalWidth: 0 } } }))
    if (run.kind !== 'materialization') throw new Error(run.kind)
    const aEntry = run.materializedEntries[0]!
    const cAttempt = run.targets[1]!.attempts[0] as ShapeConstrainedAttempt
    expect(bonusFrontierLowerRequestRisk(risk, cAttempt)).toEqual({
      method: 'shape_constrained', gogmaStart: 10, nextNonHeldAfterReset: 13, positions: [{ position: 10, reservation: 'held', heldThroughResetPosition: true }], collapseConditionHolds: true,
    })
    // Under the empty reservation nothing is held: no condition.
    const alone = await buildPlannerAlternativeRequest(shape.c!, [], scene.inputs())
    expect(bonusFrontierLowerRequestRisk(risk, { method: 'planner_alternative_reservation', request: alone, outcome: { kind: 'unmeasured', reason: 'cancelled' }, observed: null }))
      .toMatchObject({ nextNonHeldAfterReset: 12, collapseConditionHolds: false })
    // Planner Alternative Search under a's reservation: the first delivery carries the q history (required {10, 14}).
    const inspections: CandidateInspection[] = []
    const request = await buildPlannerAlternativeRequest(shape.c!, [aEntry], scene.inputs())
    const attempt = await executeMaterializationRequest(request, [aEntry], { ...scene.inputs(), observer: { onCandidateInspected: value => inspections.push(value) } }) as PlannerAlternativeAttempt
    expect(attempt.outcome).toMatchObject({ kind: 'materialized', deliveredBeforeMatch: 1 })
    expect(measureBonusFrontierLowerCollapse(risk, inspections, 3)).toEqual({ sameFinalPositionMismatches: 1, collapseSignatures: 1, collapseSamples: [[10, 14]] })
  }, 30_000)
})
