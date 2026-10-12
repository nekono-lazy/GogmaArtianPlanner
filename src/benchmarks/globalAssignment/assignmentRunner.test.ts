import { describe, expect, it } from 'vitest'
import type { TargetWeapon } from '../../domain/models/publicTypes'
import type { PlannerInput } from '../../domain/planner/plannerTypes'
import { globalResearchDependencies } from '../plannerGlobalOptimizationResearch'
import { findNonPlainJsonPaths, type AssignmentResearchConditions } from './assignmentProtocol'
import { runAssignmentOnly, type AssignmentRunExecution, type AssignmentRunResult } from './assignmentRunner'
import { collectResourceAssignments } from './assignmentSolver'
import { createGlobalAssignmentContext } from './context'
import { buildReachTable } from './reachTable'
import {
  createGlobalAssignmentFixture, createTableEngine, IDEAL_BONUSES, IDEAL_FAMILIES_REORDERED_NORMAL, keepToIdealRanks, keepToLowRanks, OTHER_FAMILIES,
  type GlobalAssignmentFixtureOptions, type TableEngineSpec,
} from './testFixture'
import type { ReachWindow } from './types'

/*
 * Issue #154 Global Assignment Phase B-2A (design 12 / 14 Phase B-2): the assignment-only runner as one pure
 * calculation over a PlannerInput: Phase 0 context -> Phase A ReachTable -> Phase B-1 search, with the design
 * 10.3 window decision. Small Fake-Engine tables, no oracle, no Planner / Search / Trace Replay.
 */
const ELEMENT_A = 'element.fixture.a'
const SERIES_A = 'series_skill.fixture.a'
const WINDOW: ReachWindow = { skill: 3, gogma: 4, normal: 3 }
const WIDER: ReachWindow = { skill: 6, gogma: 8, normal: 6 }
const LADDER = [WINDOW, WIDER]
const skillAt = (series: string) => ({ seriesSkillId: series, groupSkillId: null })

/** Element a: Ideal Skill at 8 / 10, Ideal Reset at 12, Keep Ideal at 13, Ideal-family Normals at 5 / 6; element b: Skill 9, Reset 10, Keep 12, Normal 4. */
function scanEngine(overrides: Partial<TableEngineSpec> = {}) {
  return createTableEngine({
    skill: (position, _type, element) => skillAt((element === ELEMENT_A ? [8, 10] : [9]).includes(position) ? SERIES_A : 'series_skill.fixture.other'),
    reset: (position, _type, element) => (element === ELEMENT_A ? position === 12 : position === 10) ? structuredClone(IDEAL_BONUSES) : structuredClone(OTHER_FAMILIES),
    keep: (position, current, _type, element) => (element === ELEMENT_A ? position === 13 : position === 12) ? keepToIdealRanks(current) : keepToLowRanks(current),
    normal: (position, _type, element) => (element === ELEMENT_A ? [5, 6].includes(position) : position === 4) ? structuredClone(IDEAL_FAMILIES_REORDERED_NORMAL) : structuredClone(OTHER_FAMILIES),
    ...overrides,
  })
}

function conditions(overrides: Partial<AssignmentResearchConditions> = {}): AssignmentResearchConditions {
  return { window: WINDOW, nodeBudget: 10_000, mrvLookahead: 8, candidateLimit: 10_000, snapshotLimit: 2, ...overrides }
}

function clock(): () => number {
  let tick = 0
  return () => (tick += 1)
}

async function prepared(options: GlobalAssignmentFixtureOptions & { engine?: ReturnType<typeof scanEngine>; extraTargets?: TargetWeapon[]; input?: (input: PlannerInput) => PlannerInput } = {}) {
  const fixture = await createGlobalAssignmentFixture(options)
  const table = options.engine ?? scanEngine()
  let input: PlannerInput = { ...fixture.input, targetWeapons: [...fixture.input.targetWeapons, ...(options.extraTargets ?? [])] }
  if (options.input) input = options.input(input)
  return { ...fixture, input, table, dependencies: globalResearchDependencies(table.engine) }
}

function run(input: PlannerInput, dependencies: ReturnType<typeof globalResearchDependencies>, overrides: Partial<AssignmentResearchConditions> = {},
  execution: Partial<AssignmentRunExecution> = {}, ladder: readonly ReachWindow[] = LADDER): Promise<AssignmentRunResult> {
  return runAssignmentOnly(input, dependencies, { conditions: conditions(overrides), windowLadder: ladder, rungIndex: 0 }, { now: clock(), ...execution })
}

describe('Phase B-2A assignment-only runner', () => {
  it('runs Phase 0 -> Phase A -> Phase B-1, collects resource assignments, replays the snapshots and supplies no upper bound', async () => {
    const { input, dependencies } = await prepared()
    const result = await run(input, dependencies)
    const { semantic, observed } = result
    expect(semantic.protocolVersion).toBe('global-assignment-b2a:1')
    expect(semantic.context).toEqual({ status: 'context' })
    expect(semantic.reachTable).toEqual({ status: 'reach_table' })
    expect(semantic.input).toMatchObject({ plannerInputValid: true, planningTargetCount: 2, targetWeaponCount: 2, validEntryCount: 2, excludedEntryCount: 0 })
    expect(semantic.scan!.perTarget.map(target => target.targetWeaponId)).toEqual(input.targetWeapons.map(target => target.id).sort())
    expect(semantic.scan!.targetsWithoutOption).toEqual([])
    expect(semantic.scan!.perTarget.every(target => target.rootMrvCount >= 1 && target.optionsUpToCap >= 1)).toBe(true)
    expect(semantic.outcome).toEqual({ kind: 'assignments_found', completeness: 'exhausted' })
    expect(semantic.solver).toMatchObject({ upperBoundSupplied: false, nodeBudget: 10_000, mrvLookahead: 8, candidateLimit: 10_000 })
    expect(semantic.solver!.diagnostics.pruned).toBe(0)
    expect(semantic.solver!.diagnostics.completeness).toBe('exhausted')
    expect(semantic.solver!.nodeTraceLength).toBe(semantic.solver!.diagnostics.expandedNodes)
    expect(semantic.solver!.nodeTrace.length).toBe(Math.min(semantic.solver!.nodeTraceLength, 256))
    expect(semantic.solver!.nodeTraceHash).toMatch(/^fnv1a32:[0-9a-f]{8}$/)
    expect(semantic.solver!.windowLocalRootBound).not.toBeNull()
    expect(semantic.candidates!.generated).toBeGreaterThan(0)
    expect(semantic.candidates!.objectives.length).toBe(semantic.candidates!.generated)
    expect(semantic.candidates!.bestObjective).toBe(Math.min(...semantic.candidates!.objectives))
    expect(semantic.candidates!.bestObjective).toBeGreaterThanOrEqual(semantic.solver!.windowLocalRootBound!)
    expect(semantic.candidates!.snapshots.length).toBe(Math.min(2, semantic.candidates!.generated))
    expect(semantic.candidates!.nature).toBe('resource_assignment_only')
    expect(semantic.replay).toMatchObject({ status: 'passed', candidatesReplayed: semantic.candidates!.snapshots.length, optionsReplayed: semantic.candidates!.snapshots.length * 2, violations: [] })
    expect(semantic.windowTransition).toMatchObject({ action: 'hold', conclusion: 'assignments_enumerated', concludesInfeasibility: false })
    expect(semantic.integrityIssues).toEqual([])
    expect(semantic.oracleFreeExecution).toBe(true)
    expect(observed.elapsedMs.total).toBeGreaterThan(0)
    expect(observed.elapsedMs.reachTable).not.toBeNull()
    expect(observed.elapsedMs.solverConstruction).not.toBeNull()
    expect(observed.elapsedMs.optionCount).not.toBeNull()
    expect(observed.elapsedMs.rootMrvCount).not.toBeNull()
    expect(observed.elapsedMs.toFirstCandidate).not.toBeNull()
    expect(observed.nodeTimeline.length).toBeGreaterThan(0)
    // No status of this record says verified, proven_minimum or completed.
    expect(JSON.stringify(semantic)).not.toMatch(/"verified"|proven_minimum|completedTarget/)
  })

  it('fixes the planning Targets from the valid Entries only: an eligible Target without an Entry is not scanned', async () => {
    const base = await createGlobalAssignmentFixture()
    const extra: TargetWeapon = { ...structuredClone(base.targets.a), id: 'target.fixture.d' as TargetWeapon['id'] }
    const { input, dependencies } = await prepared({ extraTargets: [extra] })
    const { semantic } = await run(input, dependencies)
    expect(semantic.input).toMatchObject({ planningTargetCount: 2, planningEligibleTargetCount: 3, targetWeaponCount: 3 })
    expect(semantic.scan!.perTarget.map(target => target.targetWeaponId)).not.toContain('target.fixture.d')
    expect(semantic.candidates!.snapshots[0]!.chosen.map(option => option.targetWeaponId)).not.toContain('target.fixture.d')
  })

  it('reproduces the Phase B-1 collectResourceAssignments() outcome, objectives, stream ends and node count on the same table', async () => {
    const { input, dependencies, table } = await prepared()
    const context = createGlobalAssignmentContext(input, dependencies)
    if (context.kind !== 'context') throw new Error(context.reason)
    const built = await buildReachTable(context.context, table.engine, WINDOW)
    if (built.kind !== 'reach_table') throw new Error(built.kind)
    for (const candidateLimit of [1, 2, 100]) {
      const reference = collectResourceAssignments(built.table, context.context.planningTargets, { nodeBudget: 10_000, mrvLookahead: 8 }, candidateLimit)
      const { semantic } = await run(input, dependencies, { candidateLimit, snapshotLimit: 1 })
      if (reference.status !== 'assignments_found') throw new Error(reference.status)
      expect(semantic.outcome).toEqual({ kind: 'assignments_found', completeness: reference.completeness })
      expect(semantic.candidates!.objectives).toEqual(reference.candidates.map(candidate => candidate.objective))
      expect(semantic.candidates!.snapshots[0]!.streamEnd).toEqual(reference.candidates[0]!.streamEnd)
      expect(semantic.candidates!.snapshots[0]!.chosen.map(option => option.source)).toEqual([...reference.candidates[0]!.chosen.values()].map(option => option.source))
      expect(semantic.solver!.diagnostics.expandedNodes).toBe(reference.diagnostics.expandedNodes)
      expect(semantic.solver!.diagnostics.rejections).toEqual(reference.diagnostics.rejections)
    }
  })

  it('treats the candidate limit as a collection stop, never as the absence of further assignments', async () => {
    const { input, dependencies } = await prepared()
    const { semantic } = await run(input, dependencies, { candidateLimit: 1, snapshotLimit: 1 })
    expect(semantic.outcome).toEqual({ kind: 'assignments_found', completeness: 'candidate_limit_reached' })
    expect(semantic.candidates!.generated).toBe(1)
    expect(semantic.solver!.diagnostics.completeness).toBe('running')
    expect(semantic.windowTransition).toMatchObject({ action: 'hold', conclusion: 'assignments_found_remainder_unconfirmed', nextRungIndex: null, concludesInfeasibility: false })
  })

  it('reports the node budget as search_incomplete and holds the window', async () => {
    const { input, dependencies } = await prepared()
    const { semantic } = await run(input, dependencies, { nodeBudget: 1 })
    expect(semantic.outcome).toEqual({ kind: 'search_incomplete', completeness: 'node_budget_reached' })
    expect(semantic.solver!.diagnostics).toMatchObject({ expandedNodes: 1, completeness: 'node_budget_reached' })
    expect(semantic.candidates!.generated).toBe(0)
    expect(semantic.windowTransition).toMatchObject({ action: 'hold', conclusion: 'search_incomplete' })
  })

  it('reports a cancel inside the solver as search_incomplete / cancelled and a cancel inside the scan as scan_cancelled', async () => {
    const { input, dependencies } = await prepared()
    let nodes = 0
    const cancelled = await run(input, dependencies, {}, { shouldCancel: () => nodes >= 1, onNodeExpanded: () => { nodes += 1 } })
    expect(cancelled.semantic.outcome).toEqual({ kind: 'search_incomplete', completeness: 'cancelled' })
    expect(cancelled.semantic.windowTransition).toMatchObject({ action: 'hold', conclusion: 'interrupted' })
    const scanCancelled = await run(input, dependencies, {}, { shouldCancel: () => true })
    expect(scanCancelled.semantic.reachTable).toEqual({ status: 'cancelled' })
    expect(scanCancelled.semantic.outcome).toEqual({ kind: 'scan_cancelled' })
    expect(scanCancelled.semantic.scan).toBeNull()
    expect(scanCancelled.semantic.windowTransition).toMatchObject({ action: 'hold', conclusion: 'interrupted' })
  })

  it('refuses invalid conditions before any prediction, and a window that is not the ladder rung', async () => {
    const { input, dependencies, table } = await prepared()
    await expect(run(input, dependencies, { nodeBudget: 0 })).rejects.toThrow(RangeError)
    await expect(run(input, dependencies, { snapshotLimit: 5, candidateLimit: 2 })).rejects.toThrow(/snapshotLimit/)
    await expect(runAssignmentOnly(input, dependencies, { conditions: conditions(), windowLadder: LADDER, rungIndex: 2 }, { now: clock() })).rejects.toThrow(/rungIndex/)
    await expect(runAssignmentOnly(input, dependencies, { conditions: conditions({ window: WIDER }), windowLadder: LADDER, rungIndex: 0 }, { now: clock() })).rejects.toThrow(/not windowLadder\[0\]/)
    expect(table.calls).toEqual({ skill: 0, reset: 0, keep: 0, normal: 0, support: 0 })
  })

  it('fails closed on an invalid PlannerInput and on an input without a confirmed Normal Counter for a new-Normal Target', async () => {
    const invalid = await prepared({ input: input => ({ ...input, options: { ...input.options, preferPracticalBeforeIdeal: true } as PlannerInput['options'] }) })
    const refused = await run(invalid.input, invalid.dependencies)
    expect(refused.semantic.context).toMatchObject({ status: 'unsupported_input', reason: 'invalid_planner_input' })
    expect(refused.semantic.reachTable).toEqual({ status: 'not_reached' })
    expect(refused.semantic.input.plannerInputValid).toBe(false)
    expect(refused.semantic.outcome).toEqual({ kind: 'unsupported_input', reason: 'invalid_planner_input' })
    expect(refused.semantic.scan).toBeNull()
    expect(refused.semantic.windowTransition).toMatchObject({ action: 'hold', conclusion: 'unsupported_input' })
    const blind = await prepared({ normalCounterConfirmed: false })
    const unconfirmed = await run(blind.input, blind.dependencies)
    expect(unconfirmed.semantic.context).toEqual({ status: 'context' })
    expect(unconfirmed.semantic.reachTable).toMatchObject({ status: 'unsupported_input', reason: 'unconfirmed_counter' })
    expect(unconfirmed.semantic.outcome).toEqual({ kind: 'unsupported_input', reason: 'unconfirmed_counter' })
    expect(unconfirmed.semantic.windowTransition.action).toBe('hold')
  })

  it('asks for the next rung when a planning Target has no option in the window, and reports the ladder exhausted at its top', async () => {
    // Element b never reaches its Ideal inside the window: Target b has no reach option.
    const engine = scanEngine({
      skill: (position, _type, element) => skillAt(element === ELEMENT_A && [8, 10].includes(position) ? SERIES_A : 'series_skill.fixture.other'),
      reset: (position, _type, element) => element === ELEMENT_A && position === 12 ? structuredClone(IDEAL_BONUSES) : structuredClone(OTHER_FAMILIES),
      keep: (_position, current) => keepToLowRanks(current),
    })
    const { input, dependencies, targets } = await prepared({ engine })
    const { semantic } = await run(input, dependencies)
    expect(semantic.scan!.targetsWithoutOption).toEqual([targets.b.id])
    expect(semantic.outcome).toEqual({ kind: 'no_resource_assignment', reason: 'target_without_option' })
    // A Target without any option makes LB(empty) infinite: recorded as "no finite bound", never as a non-finite number.
    expect(semantic.solver!.windowLocalRootBound).toBeNull()
    expect(semantic.integrityIssues).toEqual([])
    expect(semantic.windowTransition).toMatchObject({ action: 'expand', conclusion: 'no_assignment_in_window', nextRungIndex: 1, ladderExhausted: false, concludesInfeasibility: false })
    const top = await run(input, dependencies, {}, {}, [WINDOW])
    expect(top.semantic.windowTransition).toMatchObject({ action: 'expand', nextRungIndex: null, ladderExhausted: true, concludesInfeasibility: false })
  })

  it('asks for the next rung when every Target has options but C1 / C2 leave no complete assignment', async () => {
    // Targets a and c share element a: one Ideal Skill position (8), one Ideal Reset (12) and no Keep, so both need Skill 8 and Gogma 12.
    const engine = scanEngine({
      skill: (position, _type, element) => skillAt((element === ELEMENT_A ? [8] : [9]).includes(position) ? SERIES_A : 'series_skill.fixture.other'),
      keep: (_position, current) => keepToLowRanks(current),
    })
    const { input, dependencies } = await prepared({ engine, sameElementTarget: true })
    const { semantic } = await run(input, dependencies)
    expect(semantic.input.planningTargetCount).toBe(3)
    expect(semantic.scan!.targetsWithoutOption).toEqual([])
    expect(semantic.scan!.perTarget.every(target => target.optionsUpToCap >= 1)).toBe(true)
    expect(semantic.outcome).toEqual({ kind: 'no_resource_assignment', reason: 'resource_exclusivity' })
    expect(semantic.solver!.diagnostics.deadEnds).toBeGreaterThan(0)
    expect(semantic.candidates!.generated).toBe(0)
    expect(semantic.windowTransition).toMatchObject({ action: 'expand', conclusion: 'no_assignment_in_window', nextRungIndex: 1 })
  })

  it('is deterministic: the semantic record and the node trace hash of two runs are identical', async () => {
    const { input, dependencies } = await prepared()
    const first = await run(input, dependencies)
    const second = await run(input, dependencies)
    expect(second.semantic).toEqual(first.semantic)
    expect(second.semantic.solver!.nodeTraceHash).toBe(first.semantic.solver!.nodeTraceHash)
    expect(JSON.stringify(second.semantic)).toBe(JSON.stringify(first.semantic))
  })

  it('keeps the whole record plain JSON data and bounds the snapshots by the snapshot limit', async () => {
    const { input, dependencies } = await prepared()
    const result = await run(input, dependencies, { snapshotLimit: 0 })
    expect(findNonPlainJsonPaths(result)).toEqual([])
    expect(JSON.parse(JSON.stringify(result))).toEqual(result)
    expect(result.semantic.candidates!.snapshots).toEqual([])
    expect(result.semantic.candidates!.objectives.length).toBe(result.semantic.candidates!.generated)
    expect(result.semantic.replay).toMatchObject({ status: 'skipped', candidatesReplayed: 0, optionsReplayed: 0 })
    const noReplay = await runAssignmentOnly(input, dependencies, { conditions: conditions(), windowLadder: LADDER, rungIndex: 0, replaySnapshots: false }, { now: clock() })
    expect(noReplay.semantic.replay!.status).toBe('skipped')
    expect(noReplay.observed.elapsedMs.replay).toBeNull()
  })

  it('counts yields and forwards node expansions through the Research seam', async () => {
    const { input, dependencies } = await prepared()
    let yields = 0
    let nodes = 0
    const result = await run(input, dependencies, {}, { yieldControl: async () => { yields += 1 }, onNodeExpanded: () => { nodes += 1 } })
    expect(nodes).toBe(result.semantic.solver!.diagnostics.expandedNodes)
    expect(result.observed.yields).toBe(yields)
    expect(yields).toBeGreaterThan(0)
  })
})
