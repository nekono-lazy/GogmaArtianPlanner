import { describe, expect, it } from 'vitest'
import { PlannerAlternativeSearchError } from '../../domain/search/alternative'
import { globalResearchDependencies } from '../plannerGlobalOptimizationResearch'
import { materializeStructuralCandidate, productionMaterializationSearchPort } from './materialize'
import { parseProgressJournal, type MaterializationProgressEvent, type MaterializationResearchConditions } from './materializationProtocol'
import { runMaterializationSmoke, summarizeMaterializationRun, type MaterializationRunExecution } from './materializationRunner'
import { ELEMENT_A, ELEMENT_B, materializationScenario, OPEN_GATE, REORDERED_GOGMA, TARGET, type MaterializationScenarioSpec } from './materializationTestFixture'
import { collectStructuralCandidates } from './structuralSearch'
import { IDEAL_BONUSES, ownedGogma } from './testFixture'

/*
 * Issue #154 Global Assignment Phase D-0B: the in-process runner over the synthetic fixture and a deterministic table Engine -
 * Phase 0 -> A -> C-2 -> diagnostics -> D-0A connected exactly like the direct calls, the typed run outcomes (no structural
 * candidate, node budget, all materialized, partially unconfirmed, Search policy, gate, cancel, fail closed), the progress
 * events a journal keeps, and a semantic record that is the same on a second run. No real Export, no Planner run.
 */

const WINDOW = { skill: 3, gogma: 5, normal: 2 }
const SERIES_IDEAL = 'series_skill.fixture.a'

function conditionsFor(overrides: Partial<MaterializationResearchConditions> = {}): MaterializationResearchConditions {
  return {
    window: WINDOW, nodeBudget: 200, mrvLookahead: 4, coverageDrivenOrdering: true, structuralCandidateLimit: 1, deliveryCap: 1_000,
    searchScaleGate: OPEN_GATE, searchPolicyPrecheck: true, ...overrides,
  }
}

/** Two owned Gogma with Ideal Skills for a and c (the D-0A held-crossing fixture as an input; the solver picks its own candidate). */
const HELD_CROSSING: MaterializationScenarioSpec = {
  targets: ['a', 'c'],
  owned: [ownedGogma('owned.g1', { seriesSkillId: SERIES_IDEAL }), ownedGogma('owned.g2', { seriesSkillId: SERIES_IDEAL })],
  reset: { [ELEMENT_A]: { 11: REORDERED_GOGMA, 12: IDEAL_BONUSES } },
  keepIdeal: [14],
  window: WINDOW,
}

/**
 * Two new-Normal Targets: b's Ideal Skills at 7 and 9, a's at 10. The coverage-driven ordering makes the first structural
 * candidate convert b at 7 (already Ideal) and Reset Skills to 9 so that b's chain covers Skill 8: a Search-policy shape.
 */
const POLICY_FIRST: MaterializationScenarioSpec = {
  targets: ['a', 'b'],
  owned: [],
  skillIdeal: { [ELEMENT_B]: [7, 9], [ELEMENT_A]: [10] },
  reset: { [ELEMENT_B]: { 11: IDEAL_BONUSES }, [ELEMENT_A]: { 12: IDEAL_BONUSES } },
  window: WINDOW,
}

async function run(spec: MaterializationScenarioSpec, conditions: MaterializationResearchConditions, execution: Partial<MaterializationRunExecution> = {}) {
  const scene = await materializationScenario(spec)
  let tick = 0
  const events: MaterializationProgressEvent[] = []
  const result = await runMaterializationSmoke(scene.input, globalResearchDependencies(scene.engine), { conditions }, {
    now: () => (tick += 1), onProgress: event => events.push(event), ...execution,
  })
  return { scene, result, events }
}

describe('Phase D-0B runner: Phase 0 -> A -> C-2 -> D-0A', () => {
  it('connects the stages exactly like the direct calls and records the first structural candidate\'s materialization', async () => {
    const { scene, result, events } = await run(HELD_CROSSING, conditionsFor())
    const semantic = result.semantic
    expect(semantic.input).toMatchObject({ plannerInputValid: true, planningTargetCount: 2, targetWeaponCount: 2, validEntryCount: 2 })
    expect(semantic.reachTable.status).toBe('reach_table')
    expect(semantic.structuralSearch).toMatchObject({ outcome: { kind: 'structural_candidates_found', completeness: 'candidate_limit_reached' }, candidatesCollected: 1, unexploredBranchesRemain: true, upperBoundSupplied: false })
    // The same first structural candidate as a direct C-2 collection, and the same D-0A materialization of it.
    const direct = collectStructuralCandidates({ table: scene.table, context: scene.context, engine: scene.engine }, { nodeBudget: 200, mrvLookahead: 4, coverageDrivenOrdering: true }, 1)
    if (direct.status !== 'candidates_found') throw new Error(direct.status)
    const first = direct.candidates[0]!
    const [record] = semantic.candidates
    expect(record!.candidate).toMatchObject({ candidateIndex: 0, ordinal: first.ordinal, objective: first.assignment.objective, materializationOrder: first.materializationOrder })
    const materialization = await materializeStructuralCandidate(first, { ...scene.inputs(), searchPolicyPrecheck: true })
    if (materialization.kind !== 'materialization') throw new Error(materialization.kind)
    expect(record!.classification).toBe('all_materialized')
    expect(materialization.outcome).toEqual({ kind: 'all_materialized' })
    expect(record!.targets.map(target => target.outcome.kind === 'materialized' ? target.outcome.entryId : null)).toEqual(materialization.materializedEntries.map(entry => entry.id))
    expect(record).toMatchObject({ followUp: { followUp: 'planner_verification_pending' }, firstUnresolved: null, attemptedTargetCount: 2, materializedTargetCount: 2, notAttemptedTargetWeaponIds: [], failClosed: null })
    expect(semantic.outcome).toEqual({ kind: 'structural_candidates_materialized', classifications: ['all_materialized'] })
    expect(semantic.integrityIssues).toEqual([])
    // Every attempted Target keeps its predicted scale next to what the Search observed.
    for (const target of record!.targets) for (const attempt of target.attempts) {
      expect(attempt.predictedSearchScale).toBeDefined()
      expect(attempt.observed).not.toBeNull()
    }
    // Progress events in stage order; a journal of them confirms the same settled Targets.
    expect(events.map(event => event.kind)).toEqual(['context', 'reach_table', 'structural_candidate', 'structural_search', 'candidate_started', 'target_started', 'target_settled', 'target_started', 'target_settled', 'candidate_settled'])
    const journal = parseProgressJournal(events.map((event, index) => JSON.stringify({ kind: 'progress', atMs: index, event })).join('\n'))
    expect(journal.candidates[0]!.settledTargets.map(target => target.targetWeaponId)).toEqual(first.materializationOrder)
    expect(journal.candidates[0]!.settled).toMatchObject({ classification: 'all_materialized', materializedTargetCount: 2 })
    // The summary carries counts and order indexes only.
    const summary = summarizeMaterializationRun(semantic)
    expect(summary).toMatchObject({ planningTargetCount: 2, candidates: [{ classification: 'all_materialized', materializedTargetCount: 2, targetCount: 2, notAttemptedTargetCount: 0 }] })
    expect(JSON.stringify(summary)).not.toMatch(/target\.fixture|owned\.g/)
  }, 60_000)

  it('returns an identical semantic record on a second run (observed timings excluded)', async () => {
    for (const spec of [HELD_CROSSING, POLICY_FIRST]) {
      const one = await run(spec, conditionsFor({ structuralCandidateLimit: 3 }))
      const two = await run(spec, conditionsFor({ structuralCandidateLimit: 3 }))
      expect(two.result.semantic).toEqual(one.result.semantic)
      expect(JSON.stringify(two.result.semantic)).toBe(JSON.stringify(one.result.semantic))
    }
  }, 60_000)
})

describe('Phase D-0B runner outcomes', () => {
  it('reports no structural candidate only for an exhausted tree, and a node budget stop as incomplete', async () => {
    const none = await run({ targets: ['b'], owned: [], window: WINDOW }, conditionsFor())
    expect(none.result.semantic.outcome).toEqual({ kind: 'no_structural_candidate', reason: 'target_without_option' })
    expect(none.result.semantic.structuralSearch!.windowDecision).toMatchObject({ action: 'expand', concludesInfeasibility: false })
    expect(none.result.semantic.candidates).toEqual([])
    const budget = await run(HELD_CROSSING, conditionsFor({ nodeBudget: 1 }))
    expect(budget.result.semantic.outcome).toEqual({ kind: 'structural_search_incomplete', completeness: 'node_budget_reached' })
    expect(budget.result.semantic.structuralSearch).toMatchObject({ unexploredBranchesRemain: true, windowDecision: { action: 'hold', conclusion: 'search_incomplete' } })
  }, 60_000)

  it('classifies a Search-policy shape before any Search, apart from a gate, an extent or a mismatch, and keeps later candidates independent', async () => {
    const calls: string[] = []
    const search = {
      visitPlannerAlternativeCandidates: ((input, engine, onCandidate, options) => { calls.push(`alternative:${input.targetWeaponId}`); return productionMaterializationSearchPort.visitPlannerAlternativeCandidates(input, engine, onCandidate, options) }) as typeof productionMaterializationSearchPort.visitPlannerAlternativeCandidates,
      searchCandidates: ((input, engine, options) => { calls.push(`candidate:${input.targetWeaponId}`); return productionMaterializationSearchPort.searchCandidates(input, engine, options) }) as typeof productionMaterializationSearchPort.searchCandidates,
    }
    const { result } = await run(POLICY_FIRST, conditionsFor({ structuralCandidateLimit: 3 }), { search })
    const [first, second, third] = result.semantic.candidates
    expect(first!.diagnostics.searchPolicyShapes.shapes).toEqual([
      { targetWeaponId: TARGET.b, orderIndex: 0, sourceKind: 'new_normal', policyShape: { policy: 'lane_start_ideal_skill_continuation', stream: 'skill', conversionPosition: 7, finalPosition: 9 } },
    ])
    expect(first).toMatchObject({
      classification: 'not_executed_search_policy', followUp: { followUp: 'method_extension', windowExpansionBasis: false, settingsReviewBasis: false },
      firstUnresolved: { orderIndex: 0, targetWeaponId: TARGET.b }, attemptedTargetCount: 1, materializedTargetCount: 0, notAttemptedTargetWeaponIds: [TARGET.a],
      stage: { kind: 'materialization_unconfirmed', targetWeaponId: TARGET.b, outcome: { kind: 'not_executed', reason: 'search_policy_shape' } },
    })
    expect(first!.targets[0]).toMatchObject({ selection: null, attempts: [], inspections: { inspected: 0 } })
    expect(first!.diagnostics.continuationOptions.laneStartIdealSkillContinuation).toBe(1)
    // The candidate summary lists every Target's option by order index, and every Skill prerequisite precedes its conversion Target.
    expect(first!.candidate.targets.map(target => [target.orderIndex, target.skill])).toEqual([[0, 'conversion(7,9)'], [1, expect.stringMatching(/^conversion\(\d+,10\)$/)]])
    for (const dependency of first!.candidate.skillDependencies) for (const index of dependency.prerequisiteOrderIndexes) expect(index).toBeLessThan(dependency.orderIndex)
    // The later candidates are materialized from scratch: the policy shape excluded nothing.
    expect([second!.classification, third!.classification]).toEqual(['all_materialized', 'all_materialized'])
    // The first candidate's b reached no Search: every Search call belongs to the later candidates (two Targets each).
    const firstCandidateCalls = calls.length - [second!, third!].reduce((sum, record) => sum + record.targets.reduce((count, target) => count + target.attempts.length, 0), 0)
    expect(firstCandidateCalls).toBe(0)
  }, 60_000)

  it('stops at a gated Target as not executed, counts the exceeded components, and never reads it as a failure', async () => {
    const { result } = await run(HELD_CROSSING, conditionsFor({ searchScaleGate: { ...OPEN_GATE, maxGogmaLegalWidth: 0 } }))
    const [record] = result.semantic.candidates
    expect(record).toMatchObject({ classification: 'not_executed_search_scale_gate', followUp: { followUp: 'settings_review', windowExpansionBasis: false, settingsReviewBasis: true }, materializedTargetCount: 0, attemptedTargetCount: 1 })
    expect(record!.notAttemptedTargetWeaponIds).toHaveLength(1)
    expect(record!.gateExceeded.gogmaLegalWidth).toBeGreaterThanOrEqual(1)
    expect(record!.targets[0]!.attempts.every(attempt => attempt.observed === null)).toBe(true)
  }, 60_000)

  it('ends a run cancelled during the materialization as unmeasured(cancelled) and keeps the Targets settled before it', async () => {
    let cancel = false
    const { result } = await run(HELD_CROSSING, conditionsFor(), {
      shouldCancel: () => cancel,
      onProgress: event => { if (event.kind === 'target_settled') cancel = true },
    })
    const [record] = result.semantic.candidates
    expect(record).toMatchObject({ classification: 'unmeasured_cancelled', materializedTargetCount: 1, attemptedTargetCount: 2, notAttemptedTargetWeaponIds: [] })
    expect(record!.targets[1]!.outcome).toEqual({ kind: 'unmeasured', reason: 'cancelled' })
  }, 60_000)

  it('records a fail-closed stop of the materialization as an error of the run, never as an outcome', async () => {
    const refusing = {
      ...productionMaterializationSearchPort,
      visitPlannerAlternativeCandidates: (async () => { throw new PlannerAlternativeSearchError('invalid_reservation', 'refused') }) as typeof productionMaterializationSearchPort.visitPlannerAlternativeCandidates,
      searchCandidates: (async (input, engine, options) => {
        const value = await productionMaterializationSearchPort.searchCandidates(input, engine, options)
        return { ...value, targetResult: { ...value.targetResult, candidate: null } }
      }) as typeof productionMaterializationSearchPort.searchCandidates,
    }
    const { result } = await run(HELD_CROSSING, conditionsFor({ structuralCandidateLimit: 2 }), { search: refusing })
    expect(result.semantic.candidates).toHaveLength(1)
    const [record] = result.semantic.candidates
    expect(record).toMatchObject({ classification: 'fail_closed', followUp: { followUp: 'run_error' }, stage: null, attemptedTargetCount: 0, materializedTargetCount: 0 })
    expect(record!.failClosed).toMatchObject({ code: 'search_refused' })
    expect(record!.notAttemptedTargetWeaponIds).toHaveLength(2)
    expect(result.semantic.integrityIssues.some(issue => /failed closed \(search_refused/.test(issue))).toBe(true)
  }, 60_000)

  it('stops at Phase 0 for an input without a planning Target', async () => {
    const scene = await materializationScenario(HELD_CROSSING)
    const result = await runMaterializationSmoke({ ...scene.input, buildListEntries: [] }, globalResearchDependencies(scene.engine), { conditions: conditionsFor() }, { now: () => 0 })
    expect(result.semantic).toMatchObject({ outcome: { kind: 'unsupported_input', stage: 'context', reason: 'no_planning_target' }, reachTable: { status: 'not_reached' }, structuralSearch: null, candidates: [] })
  }, 30_000)

  it('refuses invalid conditions before anything runs', async () => {
    const scene = await materializationScenario(HELD_CROSSING)
    await expect(runMaterializationSmoke(scene.input, globalResearchDependencies(scene.engine), { conditions: { ...conditionsFor(), deliveryCap: 0 } }, { now: () => 0 })).rejects.toThrow(/deliveryCap must be a positive integer/)
    await expect(runMaterializationSmoke(scene.input, globalResearchDependencies(scene.engine), { conditions: { ...conditionsFor(), searchPolicyPrecheck: false as never } }, { now: () => 0 })).rejects.toThrow(/searchPolicyPrecheck/)
  }, 30_000)
})
