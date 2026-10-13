import { describe, expect, it } from 'vitest'
import type { PlannerInput } from '../../domain/planner/plannerTypes'
import type { TargetWeapon } from '../../domain/models/publicTypes'
import { collectLowerBoundProblem, solveLowerBoundRelaxation } from '../plannerGlobalLowerBound'
import { globalResearchDependencies } from '../plannerGlobalOptimizationResearch'
import { compareLowerBoundTargetSet, compareObjectiveWithRootLowerBound, measureRootLowerBound, type RootLowerBoundReport } from './assignmentRootBound'
import type { VerifiedUpperBound } from './assignmentTypes'
import { createGlobalAssignmentContext } from './context'
import { createGlobalAssignmentFixture, createTableEngine, IDEAL_BONUSES, IDEAL_FAMILIES_REORDERED_NORMAL, keepToIdealRanks, keepToLowRanks, OTHER_FAMILIES, ownedGogma, type GlobalAssignmentFixtureOptions } from './testFixture'
import { enumerateReachOptions } from './reachOptions'
import { buildReachTable } from './reachTable'
import { collectStructuralCandidates } from './structuralSearch'
import { REACH_OPTION_SET_A1, REACH_OPTION_SET_A2, type ReachOptionSetVersion } from './types'

/*
 * Issue #154 Global Assignment Phase B-2A (design 10.2): the root lower bound stage over a GlobalAssignmentContext.
 * Applicable only when the relaxation's Target set equals the planning Target set and no cross satisfaction pair
 * exists; never an upper bound. Small Fake-Engine tables, no oracle.
 */
const ELEMENT_A = 'element.fixture.a'
const SERIES_A = 'series_skill.fixture.a'
const fixtureSkills = { seriesSkillIds: [SERIES_A, 'series_skill.fixture.b'], groupSkillIds: ['group_skill.fixture.a', 'group_skill.fixture.b'] }
const skillAt = (series: string) => ({ seriesSkillId: series, groupSkillId: null })

/** Element a: Ideal Skill at 8 / 10, Ideal Reset at 12, Keep Ideal at 13; element b: Ideal Skill at 9, Ideal Reset at 10, Keep Ideal at 12. */
function scanEngine() {
  return createTableEngine({
    skill: (position, _type, element) => skillAt((element === ELEMENT_A ? [8, 10] : [9]).includes(position) ? SERIES_A : 'series_skill.fixture.other'),
    reset: (position, _type, element) => (element === ELEMENT_A ? position === 12 : position === 10) ? structuredClone(IDEAL_BONUSES) : structuredClone(OTHER_FAMILIES),
    keep: (position, current, _type, element) => (element === ELEMENT_A ? position === 13 : position === 12) ? keepToIdealRanks(current) : keepToLowRanks(current),
    normal: (position, _type, element) => (element === ELEMENT_A ? position === 5 : position === 4) ? structuredClone(IDEAL_FAMILIES_REORDERED_NORMAL) : structuredClone(OTHER_FAMILIES),
  })
}

async function prepared(options: GlobalAssignmentFixtureOptions & { extraTargets?: TargetWeapon[] } = {}) {
  const fixture = await createGlobalAssignmentFixture(options)
  const input: PlannerInput = { ...fixture.input, targetWeapons: [...fixture.input.targetWeapons, ...(options.extraTargets ?? [])] }
  const table = scanEngine()
  const result = createGlobalAssignmentContext(input, globalResearchDependencies(table.engine))
  if (result.kind !== 'context') throw new Error(`Expected a context, got ${result.kind}: ${result.detail}`)
  return { ...fixture, input, context: result.context, table }
}

function clock() {
  let tick = 0
  return () => (tick += 1)
}

describe('Phase B-2A root lower bound stage', () => {
  it('claims the relaxation minimum when the Target sets coincide and no cross satisfaction pair exists', async () => {
    const { context, table, input } = await prepared()
    // The relaxation scans thresholds whose total stays below the budget; the fixture optimum (Skill 3 + Gogma 3 + Normal 2) needs a budget above 8.
    const budget = 20
    const report = measureRootLowerBound(context, table.engine, budget, fixtureSkills, { now: clock() })
    const relaxation = solveLowerBoundRelaxation(collectLowerBoundProblem(input, scanEngine().engine, budget, fixtureSkills))
    expect(relaxation.status).toBe('found')
    expect(report.status).toBe('found')
    if (report.status !== 'found') return
    expect(report.provenLowerBound).toBe(relaxation.minimum!.total)
    expect(report.budget).toBe(budget)
    expect(report.targetSet).toMatchObject({ matches: true, planningTargetCount: 2, eligibleTargetCount: 2, eligibleWithoutValidEntry: [], planningNotEligible: [] })
    expect(report.crossSatisfaction).toMatchObject({ planningTargetCount: 2, possiblePairCount: 0, distinctSourcePreconditionHolds: true })
    expect(report.relaxation.status).toBe('found')
    expect(report.relaxation.targets.map(target => target.targetWeaponId)).toEqual(context.planningTargets.map(target => target.id))
    expect(report.elapsedMs).toBeGreaterThan(0)
    // The module's own relaxation decides; nothing here re-implements it.
    expect(report.relaxation.minimum).toEqual(relaxation.minimum)
  })

  it('does not claim the bound when a planning-eligible Target has no valid Entry (the relaxation would bound a different set)', async () => {
    const base = await createGlobalAssignmentFixture()
    const extra: TargetWeapon = { ...structuredClone(base.targets.a), id: 'target.fixture.d' as TargetWeapon['id'] }
    const { context, table } = await prepared({ extraTargets: [extra] })
    expect(compareLowerBoundTargetSet(context)).toEqual({ matches: false, planningTargetCount: 2, eligibleTargetCount: 3, eligibleWithoutValidEntry: ['target.fixture.d'], planningNotEligible: [] })
    const report = measureRootLowerBound(context, table.engine, 4, fixtureSkills, { now: clock() })
    expect(report).toMatchObject({ status: 'not_applicable', reason: 'planning_target_set_mismatch', budget: 4 })
    expect(report.status === 'not_applicable' && report.detail).toMatch(/3 planning-eligible Targets but the solver plans 2/)
    // No threshold scan was paid for.
    expect(table.calls).toMatchObject({ skill: 0, reset: 0, keep: 0, normal: 0 })
  })

  it('does not claim the bound when one weapon state can meet two planning Targets (cross satisfaction possible)', async () => {
    const { context, table } = await prepared({ sameElementTarget: true })
    expect(compareLowerBoundTargetSet(context).matches).toBe(true)
    const report = measureRootLowerBound(context, table.engine, 4, fixtureSkills, { now: clock() })
    expect(report).toMatchObject({ status: 'not_applicable', reason: 'cross_satisfaction_possible' })
    if (report.status !== 'not_applicable') return
    expect(report.crossSatisfaction).toMatchObject({ planningTargetCount: 3, possiblePairCount: 1, distinctSourcePreconditionHolds: false })
    expect(report.crossSatisfaction?.possiblePairs[0]?.targetWeaponIds.sort()).toEqual(['target.fixture.c', context.planningTargets[0]!.id].sort())
    expect(table.calls).toMatchObject({ skill: 0, reset: 0, keep: 0, normal: 0 })
  })

  it('reports none_below_budget as "at least the budget", never as "no feasible Plan"', async () => {
    const { context, table } = await prepared()
    const report = measureRootLowerBound(context, table.engine, 1, fixtureSkills, { now: clock() })
    expect(report).toMatchObject({ status: 'none_below_budget', provenAtLeast: 1, budget: 1 })
    if (report.status !== 'none_below_budget') return
    expect(report.relaxation.status).toBe('none_below_budget')
    expect(report.relaxation.targetsWithoutOption.length).toBeGreaterThan(0)
  })

  it('reports an input the relaxation refuses (no confirmed Normal Counter) as not_applicable / unsupported_input', async () => {
    const { context, table } = await prepared({ normalCounterConfirmed: false })
    const report = measureRootLowerBound(context, table.engine, 4, fixtureSkills, { now: clock() })
    expect(report).toMatchObject({ status: 'not_applicable', reason: 'unsupported_input' })
    expect(report.status === 'not_applicable' && report.detail).toMatch(/Normal Counter/)
  })

  it('refuses a non-positive budget', async () => {
    const { context, table } = await prepared()
    expect(() => measureRootLowerBound(context, table.engine, 0, fixtureSkills, { now: clock() })).toThrow(RangeError)
  })

  it('compares a structural objective with the bound as diagnostics only, flagging an objective below the bound as inconsistent', () => {
    const found = { status: 'found', provenLowerBound: 8 } as unknown as RootLowerBoundReport
    expect(compareObjectiveWithRootLowerBound(10, found)).toEqual({ bestObjective: 10, lowerBound: 8, lowerBoundKind: 'proven_minimum_of_relaxation', gap: 2, consistency: 'consistent' })
    expect(compareObjectiveWithRootLowerBound(8, found).consistency).toBe('consistent')
    expect(compareObjectiveWithRootLowerBound(5, found)).toMatchObject({ gap: -3, consistency: 'inconsistent' })
    expect(compareObjectiveWithRootLowerBound(null, found)).toMatchObject({ lowerBound: 8, gap: null, consistency: 'not_comparable' })
    expect(compareObjectiveWithRootLowerBound(10, { status: 'none_below_budget', provenAtLeast: 4 } as unknown as RootLowerBoundReport))
      .toEqual({ bestObjective: 10, lowerBound: 4, lowerBoundKind: 'at_least_budget', gap: 6, consistency: 'consistent' })
    expect(compareObjectiveWithRootLowerBound(10, { status: 'not_requested' })).toEqual({ bestObjective: 10, lowerBound: null, lowerBoundKind: null, gap: null, consistency: 'not_comparable' })
    expect(compareObjectiveWithRootLowerBound(10, { status: 'unmeasured', reason: 'timeout', detail: '' }).consistency).toBe('not_comparable')
    expect(compareObjectiveWithRootLowerBound(10, { status: 'not_applicable' } as unknown as RootLowerBoundReport).consistency).toBe('not_comparable')
  })

  it('A-2: reads no option set - the a1 and a2 tables of one context compare their (equal) structural optimum with the same bound', async () => {
    const { context, table, input } = await prepared()
    // An owned Gogma of element a whose current Skills are Ideal: a2 adds its Reset Skills continuations.
    const owned = ownedGogma('owned.skill.ideal', { seriesSkillId: SERIES_A })
    const withOwned = { ...input, ownedWeapons: [owned] }
    const created = createGlobalAssignmentContext(withOwned, globalResearchDependencies(table.engine))
    if (created.kind !== 'context') throw new Error(created.detail)
    const window = { normal: 2, gogma: 5, skill: 4 }
    const optimumOf = async (optionSet: ReachOptionSetVersion) => {
      const built = await buildReachTable(created.context, table.engine, window, optionSet)
      if (built.kind !== 'reach_table') throw new Error(built.kind)
      const options = built.table.targets.reduce((count, row) => count + [...enumerateReachOptions(row, built.table)].length, 0)
      const found = collectStructuralCandidates({ table: built.table, context: created.context, engine: table.engine }, { nodeBudget: 1_000_000, mrvLookahead: 8, coverageDrivenOrdering: true }, 1_000_000)
      if (found.status !== 'candidates_found' || found.completeness !== 'exhausted') throw new Error(`${optionSet}: ${found.status}`)
      return { options, best: Math.min(...found.candidates.map(candidate => candidate.assignment.objective)), candidates: found.candidates.length }
    }
    const a1 = await optimumOf(REACH_OPTION_SET_A1)
    const a2 = await optimumOf(REACH_OPTION_SET_A2)
    expect(a2.options).toBeGreaterThan(a1.options)
    expect(a2.candidates).toBeGreaterThan(a1.candidates)
    expect(a2.best).toBe(a1.best)
    // The bound itself is a function of the context and the Engine only (no table, no option set), so both compare alike.
    const report = measureRootLowerBound(created.context, table.engine, 20, fixtureSkills, { now: clock() })
    expect(compareObjectiveWithRootLowerBound(a2.best, report)).toEqual(compareObjectiveWithRootLowerBound(a1.best, report))
    expect(compareObjectiveWithRootLowerBound(a2.best, report).consistency).not.toBe('inconsistent')
    expect(context.planningTargets).toHaveLength(2)
  }, 60_000)

  it('cannot be passed where the solver expects a VerifiedUpperBound', async () => {
    const { context, table } = await prepared()
    const report = measureRootLowerBound(context, table.engine, 4, fixtureSkills, { now: clock() })
    // @ts-expect-error -- a root lower bound report has neither physicalOperations nor the literal provenance.
    const bound: VerifiedUpperBound = report
    expect(bound).not.toHaveProperty('provenance')
    expect(bound).not.toHaveProperty('physicalOperations')
  })
})
