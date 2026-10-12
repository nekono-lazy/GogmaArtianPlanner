import { describe, expect, it } from 'vitest'
import type { OwnedWeapon, RestorationBonusSet } from '../../domain/models/publicTypes'
import type { PlannerInput } from '../../domain/planner/plannerTypes'
import { globalResearchDependencies } from '../plannerGlobalOptimizationResearch'
import { assignmentKeyOf } from './assignmentTestFixture'
import { collectResourceAssignments } from './assignmentSolver'
import { createGlobalAssignmentContext } from './context'
import type { CoverageSearch, CoverageSearchRequest, StructuralSearchDiagnostics } from './coverageSearchTypes'
import type { StructuralCandidate } from './coverageTypes'
import { buildReachTable } from './reachTable'
import { buildStructuralCandidate } from './structuralCandidate'
import { collectStructuralCandidates, createStructuralCandidateSearch } from './structuralSearch'
import { decideStructuralWindowTransition, structuralStageOutcomeOf } from './structuralWindowPolicy'
import {
  createGlobalAssignmentFixture, createTableEngine, IDEAL_BONUSES, IDEAL_FAMILIES_REORDERED_NORMAL, keepToIdealRanks, keepToLowRanks, OTHER_FAMILIES, ownedGogma, ownedNormal,
} from './testFixture'
import { GlobalAssignmentInvariantError, type ReachTable } from './types'

/*
 * Issue #154 Global Assignment Phase C-2 (design 6.3 / 6.4 / 8 / 13.1 Phase C): the structural candidate
 * generator over a real Phase 0 context and a Phase A ReachTable scanned with a deterministic table
 * Engine. Only coverage-feasible assignments reach the Phase C-1 builder; a replay inconsistency stays an
 * invariant error. No oracle, no Search, no Planner run.
 */
const SERIES_A = 'series_skill.fixture.a'
const WINDOW = { skill: 3, gogma: 5, normal: 2 }
const LADDER = [WINDOW, { skill: 6, gogma: 10, normal: 4 }]
const REORDERED_GOGMA: RestorationBonusSet = [
  { bonusTypeId: 'bonus_type.fixture.sharpness', bonusRankId: 'bonus_rank.fixture.low' }, IDEAL_BONUSES[2], IDEAL_BONUSES[3], IDEAL_BONUSES[0],
  { ...IDEAL_BONUSES[1], bonusRankId: 'bonus_rank.fixture.low' },
]
const REQUEST: Omit<CoverageSearchRequest, 'coverageDrivenOrdering'> = { nodeBudget: 1_000_000, mrvLookahead: 8 }

/**
 * Three Targets of one weapon type (Skill origin 7, Gogma origin 10, Normal origin 4), the owned Gogma G1
 * whose Skills are already Ideal (so nobody holds a Gogma weapon in the Skill stream before a conversion)
 * and the owned Normal N1: some resource assignments leave the Skill origin uncovered.
 */
async function scenario() {
  const skillIdeal = [7, 8, 9, 10]
  const resetIdeal = [12, 14]
  const keepIdeal = [13, 15]
  const table = createTableEngine({
    skill: position => ({ seriesSkillId: skillIdeal.includes(position) ? SERIES_A : 'series_skill.fixture.other', groupSkillId: null }),
    reset: position => resetIdeal.includes(position) ? structuredClone(IDEAL_BONUSES) : position === 11 ? structuredClone(REORDERED_GOGMA) : structuredClone(OTHER_FAMILIES),
    keep: (position, current) => keepIdeal.includes(position) ? keepToIdealRanks(current) : keepToLowRanks(current),
  })
  const fixture = await createGlobalAssignmentFixture({ sameElementTarget: true })
  const owned: OwnedWeapon[] = [ownedGogma('owned.g1', { seriesSkillId: SERIES_A }), ownedNormal('owned.n1', { elementId: 'element.fixture.b', restorationBonuses: structuredClone(IDEAL_FAMILIES_REORDERED_NORMAL) })]
  const input: PlannerInput = { ...fixture.input, ownedWeapons: owned }
  const created = createGlobalAssignmentContext(input, globalResearchDependencies(table.engine))
  if (created.kind !== 'context') throw new Error(created.detail)
  const reach = await buildReachTable(created.context, table.engine, WINDOW)
  if (reach.kind !== 'reach_table') throw new Error(JSON.stringify(reach))
  return { engine: table.engine, calls: table.calls, reach: reach.table, context: created.context, inputs: { table: reach.table, context: created.context, engine: table.engine } }
}

function drain(search: CoverageSearch<StructuralCandidate, StructuralSearchDiagnostics>, maxNodes?: number): StructuralCandidate[] {
  const candidates: StructuralCandidate[] = []
  while (true) {
    const event = search.next(maxNodes)
    if (event.kind === 'candidate') candidates.push(event.candidate)
    if (event.kind === 'finished') return candidates
  }
}

const keyOf = (candidate: StructuralCandidate) => assignmentKeyOf(candidate.assignment.chosen.values())

describe('Phase C-2 structural candidate generator (design 6.3 / 6.4)', () => {
  it('builds structural candidates from coverage-feasible assignments only, exactly the Phase C-1 results over the whole Phase B-1 sequence', async () => {
    const scene = await scenario()
    const b1 = collectResourceAssignments(scene.reach, scene.context.planningTargets, REQUEST, 1_000_000)
    if (b1.status !== 'assignments_found' || b1.completeness !== 'exhausted') throw new Error(b1.status)
    const built = b1.candidates.map(assignment => buildStructuralCandidate(assignment, scene.inputs))
    const reference = built.flatMap(result => (result.kind === 'structural_candidate' ? [result.candidate] : []))
    const infeasible = built.filter(result => result.kind === 'coverage_infeasible')
    expect(infeasible.length).toBeGreaterThan(0)
    expect(reference.length).toBeGreaterThan(0)
    expect(built.some(result => result.kind === 'invalid_input')).toBe(false)

    for (const coverageDrivenOrdering of [false, true]) {
      const result = collectStructuralCandidates(scene.inputs, { ...REQUEST, coverageDrivenOrdering }, 1_000_000)
      if (result.status !== 'candidates_found') throw new Error(result.status)
      expect(result.completeness).toBe('exhausted')
      // The same set as the C-1 post-processing of every B-1 assignment; each candidate is exactly C-1's build of its assignment.
      expect(result.candidates.map(keyOf).sort()).toEqual(reference.map(keyOf).sort())
      for (const candidate of result.candidates) {
        expect(buildStructuralCandidate(candidate.assignment, scene.inputs)).toEqual({ kind: 'structural_candidate', candidate })
        expect(candidate).not.toHaveProperty('physicalOperations')
        expect(candidate).not.toHaveProperty('provenance')
      }
      const diagnostics = result.diagnostics
      expect(diagnostics.structuralCandidates).toBe(result.candidates.length)
      expect(diagnostics.coverageFeasible).toBe(result.candidates.length)
      expect(diagnostics.coverageRejections).toBe(diagnostics.completeAssignmentsInspected - result.candidates.length)
      expect(diagnostics.completeAssignmentsInspected).toBe(b1.candidates.length)
      // bestStructural is the best structural objective, kept apart from the underlying best resource assignment.
      expect(diagnostics.bestStructural!.objective).toBe(Math.min(...result.candidates.map(candidate => candidate.assignment.objective)))
      expect(diagnostics.resource.bestAssignment!.objective).toBe(Math.min(...b1.candidates.map(candidate => candidate.objective)))
      expect(diagnostics.replayPredictions).toEqual(result.candidates.reduce((sum, candidate) => ({
        skill: sum.skill + candidate.replayPredictions.skill, gogmaReset: sum.gogmaReset + candidate.replayPredictions.gogmaReset,
        gogmaKeep: sum.gogmaKeep + candidate.replayPredictions.gogmaKeep, normal: sum.normal + candidate.replayPredictions.normal,
      }), { skill: 0, gogmaReset: 0, gogmaKeep: 0, normal: 0 }))
      // A rejection records the lowest uncovered Skill position: the origin, which only a conversion at 7 can hold here.
      expect(diagnostics.lowestUncoveredPosition).toBe(7)
      for (const candidate of result.candidates) {
        expect([...candidate.assignment.chosen.values()].some(option => option.skillRequired.kind === 'conversion' && option.skillRequired.conversionPosition === 7)).toBe(true)
      }
      // A window holding structural candidates is held: whether they come true is Phase D's question.
      expect(decideStructuralWindowTransition(structuralStageOutcomeOf(result), 0, LADDER)).toMatchObject({ action: 'hold', conclusion: 'structural_candidates_enumerated' })
    }
  }, 30_000)

  it('reaches the first structural candidate no later with the coverage-driven ordering, and resumes after pauses with the same sequence', async () => {
    const scene = await scenario()
    const first = (coverageDrivenOrdering: boolean) => {
      const result = collectStructuralCandidates(scene.inputs, { ...REQUEST, coverageDrivenOrdering }, 1)
      if (result.status !== 'candidates_found') throw new Error(result.status)
      return result.diagnostics.assignmentsUntilFirstCoverageFeasible!
    }
    expect(first(true)).toBeLessThanOrEqual(first(false))
    for (const coverageDrivenOrdering of [false, true]) {
      const create = () => {
        const created = createStructuralCandidateSearch(scene.inputs, { ...REQUEST, coverageDrivenOrdering })
        if (created.kind !== 'search') throw new Error(created.detail)
        return created.search
      }
      const whole = create()
      const reference = drain(whole)
      for (const maxNodes of [1, 4]) {
        const paused = create()
        expect(drain(paused, maxNodes)).toEqual(reference)
        expect(paused.diagnostics).toEqual(whole.diagnostics)
      }
    }
  }, 30_000)

  it('keeps a replay inconsistency an invariant error instead of a rejection or "no candidate"', async () => {
    const scene = await scenario()
    // Every row claims an Ideal Reset at 10, where the Engine draws a non-Ideal set: options there pass coverage and fail the replay.
    const forged: ReachTable = structuredClone(scene.reach)
    for (const row of forged.targets) row.bonus.resetIdealPositions = [10, ...row.bonus.resetIdealPositions]
    const created = createStructuralCandidateSearch({ ...scene.inputs, table: forged }, { ...REQUEST, coverageDrivenOrdering: true })
    if (created.kind !== 'search') throw new Error(created.detail)
    let error: unknown
    try {
      drain(created.search)
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(GlobalAssignmentInvariantError)
    expect((error as GlobalAssignmentInvariantError).code).toBe('ideal_mismatch')
  })

  it('refuses a ReachTable that does not belong to the context before any search', async () => {
    const scene = await scenario()
    expect(createStructuralCandidateSearch({ ...scene.inputs, table: { ...scene.reach, originSkill: 8 } }, { ...REQUEST, coverageDrivenOrdering: true }))
      .toMatchObject({ kind: 'invalid_input', reason: 'origin_mismatch' })
    expect(createStructuralCandidateSearch({ ...scene.inputs, table: { ...scene.reach, targets: [...scene.reach.targets].reverse() } }, { ...REQUEST, coverageDrivenOrdering: true }))
      .toMatchObject({ kind: 'invalid_input', reason: 'planning_target_mismatch' })
    expect(collectStructuralCandidates(scene.inputs, { ...REQUEST, coverageDrivenOrdering: true }, 0)).toMatchObject({ status: 'invalid_input', reason: 'invalid_candidate_limit' })
  })

  it('reports a node budget stop as search_incomplete and holds the window', async () => {
    const scene = await scenario()
    const result = collectStructuralCandidates(scene.inputs, { ...REQUEST, nodeBudget: 2, coverageDrivenOrdering: true }, 10)
    expect(result).toMatchObject({ status: 'search_incomplete', completeness: 'node_budget_reached' })
    expect(decideStructuralWindowTransition(structuralStageOutcomeOf(result), 0, LADDER)).toMatchObject({ action: 'hold', conclusion: 'search_incomplete', concludesInfeasibility: false })
  })
})
