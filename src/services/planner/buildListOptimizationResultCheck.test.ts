import { beforeAll, describe, expect, it } from 'vitest'
import type { BuildListOptimizationResult } from '../../domain/planner/buildListOptimization'
import { createOptimizedBuildListOptimizationTestResult } from '../../test/fixtures/buildListOptimizationWorkerFixtures'
import { buildListOptimizationResultIssues } from './buildListOptimizationResultCheck'

type Optimized = Extract<BuildListOptimizationResult, { status: 'optimized' }>
let optimized: Optimized
beforeAll(async () => {
  optimized = await createOptimizedBuildListOptimizationTestResult()
})

/** A structured clone of the optimized result with one change applied (the body arrives structured-cloned anyway). */
function corrupt(change: (result: Optimized) => void): unknown {
  const copy = structuredClone(optimized)
  change(copy)
  return copy
}

const diagnostics = { reachTable: null, structuralSearch: null, candidates: [], plannerVerifications: 0, elapsedMs: null }

describe('buildListOptimizationResultIssues', () => {
  it('passes every result class the calculation returns', () => {
    expect(optimized.artifact.replacements.length).toBeGreaterThan(0)
    expect(optimized.artifact.unchangedTargetWeaponIds.length).toBeGreaterThan(0)
    expect(buildListOptimizationResultIssues(structuredClone(optimized))).toEqual([])
    expect(buildListOptimizationResultIssues({ status: 'not_found', reason: 'no_structural_candidate', diagnostics })).toEqual([])
    expect(buildListOptimizationResultIssues({ status: 'search_bound_reached', bounds: [{ kind: 'structural_search_node_budget', nodeBudget: 10 }], diagnostics })).toEqual([])
    expect(buildListOptimizationResultIssues({ status: 'unsupported', reasons: [{ kind: 'checkpoint_selection', entries: [] }, { kind: 'unconfirmed_rng_state', missing: ['gogma_counter'] }] })).toEqual([])
  })

  it('refuses a body that is no result of this calculation', () => {
    expect(buildListOptimizationResultIssues(null)).toEqual(['result must be an object.'])
    expect(buildListOptimizationResultIssues({ status: 'best_found' })).toEqual(['result.status must be optimized, not_found, search_bound_reached or unsupported.'])
    expect(buildListOptimizationResultIssues({ status: 'not_found', reason: 'none_exists', diagnostics })).toEqual(['result.reason must be no_structural_candidate or candidates_rejected.'])
    expect(buildListOptimizationResultIssues({ status: 'not_found', reason: 'candidates_rejected' })).toEqual(['result.diagnostics must be an object.'])
    expect(buildListOptimizationResultIssues({ status: 'search_bound_reached', bounds: [], diagnostics })).toEqual(['result.bounds must name at least one reached search bound.'])
    expect(buildListOptimizationResultIssues({ status: 'unsupported', reasons: [] })).toHaveLength(1)
    // The running Plan is the Application's decision, never the calculation's.
    expect(buildListOptimizationResultIssues({ status: 'unsupported', reasons: [{ kind: 'running_plan_exists' }] })).toHaveLength(1)
  })

  it('refuses an optimized artifact whose final Planner result is not a completed draft of a new chain', () => {
    const cases: [(result: Optimized) => void, string][] = [
      [result => { result.artifact.plannerResult.plan = null }, 'result.artifact.plannerResult.plan must be a Plan.'],
      [result => { result.artifact.plannerResult.termination.status = 'exhausted' }, 'result.artifact.plannerResult.termination.status must be completed.'],
      [result => { result.artifact.plannerResult.plan!.status = 'active' }, 'result.artifact.plannerResult.plan.status must be draft.'],
      [result => { result.artifact.plannerResult.plan!.conflictRepairLineage = { decisions: [] } as never }, 'result.artifact.plannerResult.plan.conflictRepairLineage must be null.'],
    ]
    for (const [change, issue] of cases) expect(buildListOptimizationResultIssues(corrupt(change))).toContain(issue)
    // The Domain Plan validation runs, and a body that makes it throw is an issue, not a crash.
    expect(buildListOptimizationResultIssues(corrupt(result => { result.artifact.plannerResult.plan!.id = '' as never })).join(' ')).toMatch(/result\.artifact\.plannerResult\.plan\.id/)
    expect(buildListOptimizationResultIssues(corrupt(result => { delete (result.artifact.plannerResult.plan as unknown as Record<string, unknown>).baseSnapshot })).join(' '))
      .toMatch(/result\.artifact\.plannerResult\.plan could not be validated|baseSnapshot/)
  })

  it('refuses a summary that contradicts the Plan or the termination it was read from (it recomputes none of them)', () => {
    const cases: [(result: Optimized) => void, string][] = [
      [result => { result.artifact.summary.planStepCount += 1 }, 'result.artifact.summary.planStepCount must equal the Plan Step count.'],
      [result => { result.artifact.summary.physicalOperationCount += 1 }, 'result.artifact.summary: physicalOperationCount + nonPhysicalStepCount must equal planStepCount.'],
      [result => { result.artifact.summary.completedTargetCount -= 1 }, 'result.artifact.summary: every planning Target must be completed.'],
      [result => { result.artifact.summary.maxPlanSteps += 500 }, 'result.artifact.summary.maxPlanSteps must be the bound the final verification ran with.'],
      [result => { result.artifact.plannerResult.termination.totalTargetCount += 1 }, 'result.artifact.summary Target counts must equal the termination\'s.'],
      [result => { result.artifact.summary.maxPlanSteps = 0 }, 'result.artifact.summary.maxPlanSteps must be a positive integer.'],
      [result => { (result.artifact.summary as unknown as Record<string, unknown>).outOfScopeTargetCounts = { noEntry: 0 } }, 'result.artifact.summary.outOfScopeTargetCounts needs noEntry, excludedEntryOnly, disabled and completed counts.'],
    ]
    for (const [change, issue] of cases) expect(buildListOptimizationResultIssues(corrupt(change)), issue).toContain(issue)
  })

  it('refuses replacements, generated Entries and planning Targets that do not partition the planning Targets', () => {
    const replaced = () => optimized.artifact.replacements[0]!.targetWeaponId
    const cases: [(result: Optimized) => void, RegExp][] = [
      [result => { result.artifact.replacements.pop() }, /one replacement per generated Entry/],
      [result => { result.artifact.replacements.reverse() }, /must name generatedBuildListEntries\[0\]|must name generatedBuildListEntries\[1\]/],
      [result => { result.artifact.unchangedTargetWeaponIds.push(replaced()) }, /is both replaced and unchanged/],
      [result => { result.artifact.unchangedTargetWeaponIds = [] }, /every planning Target must be either replaced or unchanged/],
      [result => { result.artifact.planningTargetWeaponIds.push('target.elsewhere' as never) }, /every planning Target must be either replaced or unchanged|must hold totalTargetCount Targets/],
      [result => { result.artifact.unchangedTargetWeaponIds = ['target.elsewhere' as never] }, /Target target\.elsewhere is not a planning Target/],
      [result => { result.artifact.generatedBuildListEntries[0]!.searchStateHash = 'changed' }, /generatedBuildListEntries\[0\]\.searchStateHash/],
      [result => { result.artifact.replacements[0]!.replacedBuildListEntryId = result.artifact.replacements[0]!.generatedBuildListEntryId }, /result\.artifact\.replacements/],
    ]
    for (const [change, issue] of cases) expect(buildListOptimizationResultIssues(corrupt(change)).join(' ')).toMatch(issue)
  })

  it('refuses a missing input token item, exclusion record or diagnostics', () => {
    const cases: [(result: Optimized) => void, string][] = [
      [result => { result.artifact.inputToken.initialExecutionState.targetExecutionStateHash = undefined }, 'result.artifact.inputToken.initialExecutionState.targetExecutionStateHash must be a non-empty string.'],
      [result => { result.artifact.inputToken.targetWeaponsHash = '' }, 'result.artifact.inputToken.targetWeaponsHash must be a non-empty string.'],
      [result => { result.artifact.inputToken.inputBuildListEntriesHash = '' }, 'result.artifact.inputToken.inputBuildListEntriesHash must be a non-empty string.'],
      [result => { result.artifact.inputToken.calculationContext.appSchemaVersion = 0 }, 'result.artifact.inputToken.calculationContext.appSchemaVersion must be a positive integer.'],
      [result => { result.artifact.inputExclusions = [{ buildListEntryId: 'x' }] as never }, 'result.artifact.inputExclusions must list the excluded Entries with their Target and warning kind.'],
      [result => { (result.artifact as unknown as Record<string, unknown>).diagnostics = null }, 'result.artifact.diagnostics must be an object.'],
    ]
    for (const [change, issue] of cases) expect(buildListOptimizationResultIssues(corrupt(change)), issue).toContain(issue)
  })
})
