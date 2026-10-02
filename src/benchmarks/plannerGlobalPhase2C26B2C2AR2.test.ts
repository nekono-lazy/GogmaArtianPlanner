import { describe, expect, it } from 'vitest'
import rawB2C2A from '../../docs/PLANNER_GLOBAL_PHASE2C26B2C2A_RESULT.json?raw'
import rawR1 from '../../docs/PLANNER_GLOBAL_PHASE2C26B2C2AR1_RESULT.json?raw'
import { defaultPlannerAlternativeSearchExtent } from '../domain/search'
import type { Phase2C2CandidateSummary } from './plannerGlobalPhase2C2'
import type { Phase2C26B2B2A2DeliveredCandidate } from './plannerGlobalPhase2C26B2B2A2'
import {
  PHASE2C26B2C2A_CANDIDATE_SAFETY_CAP,
  PHASE2C26B2C2A_MAX_COST_COHORTS,
  PHASE2C26B2C2A_STAGE1,
  phase2c26b2c2aTaskOutcome,
  type Phase2C26B2C2ASearchRecord,
  type Phase2C26B2C2ATaskInput,
} from './plannerGlobalPhase2C26B2C2A'
import type { Phase2C26B2C2AReach, Phase2C26B2C2ARun } from './plannerGlobalPhase2C26B2C2AAnalysis'
import { PHASE2C26B2C2AR1_RETRY, PHASE2C26B2C2AR1_SOURCE } from './plannerGlobalPhase2C26B2C2AR1'
import { parsePhase2C26B2C2AR1Authority, type Phase2C26B2C2AR1Authority, type Phase2C26B2C2AR1OriginalTaskRow } from './plannerGlobalPhase2C26B2C2AR1Authority'
import {
  parsePhase2C26B2C2AR2RetryManifest,
  selectPhase2C26B2C2AR2Tasks,
  PHASE2C26B2C2AR2_EXPECTED_RETRY_TASKS,
  PHASE2C26B2C2AR2_INHERITED,
  PHASE2C26B2C2AR2_RETRY,
  PHASE2C26B2C2AR2_SOURCE,
  type Phase2C26B2C2AR2RetryManifest,
} from './plannerGlobalPhase2C26B2C2AR2'
import searchSource from './plannerGlobalPhase2C26B2C2AR2.ts?raw'
import {
  parsePhase2C26B2C2AR2R1Authority,
  phase2c26b2c2ar2ChainIssues,
  phase2c26b2c2ar2RetryManifest,
  phase2c26b2c2ar2TimeoutTaskIds,
  PHASE2C26B2C2AR2_REGISTERED_R1,
  type Phase2C26B2C2AR2R1Authority,
  type Phase2C26B2C2AR2R1RetryRow,
} from './plannerGlobalPhase2C26B2C2AR2Authority'
import authoritySource from './plannerGlobalPhase2C26B2C2AR2Authority.ts?raw'
import { phase2c26b2c2ar2Decision, phase2c26b2c2ar2R1Context, runPhase2C26B2C2AR2Analysis, PHASE2C26B2C2AR2_DECISION_RULE } from './plannerGlobalPhase2C26B2C2AR2Analysis'
import analysisSource from './plannerGlobalPhase2C26B2C2AR2Analysis.ts?raw'
import prepareSource from '../../scripts/prepare-planner-global-phase2c26b2c2ar2-retry.mjs?raw'
import runnerSource from '../../scripts/run-planner-global-phase2c26b2c2ar2.mjs?raw'
import analyzerSource from '../../scripts/analyze-planner-global-phase2c26b2c2ar2.mjs?raw'
import r1RunnerSource from '../../scripts/run-planner-global-phase2c26b2c2ar1.mjs?raw'

/*
 * Issue #154 Phase 2-C2.6-B2-C2A-R2: the task still unmeasured after the B2-C2A-R1 overlay, searched again with a 60-minute
 * budget. The committed B2-C2A and R1 RESULTs are read as the registered authorities; every other world below is synthetic.
 * The oracle modules are never imported here (the Phase 2-A.5 isolation rule).
 */

const b2c2aJson = JSON.parse(rawB2C2A)
const r1Json = JSON.parse(rawR1)
const b2c2aSha = PHASE2C26B2C2AR1_SOURCE.b2c2aResultSha256
const r1Sha = PHASE2C26B2C2AR2_SOURCE.r1ResultSha256
const SHA = (c: string) => c.repeat(64)

// ---------------------------------------------------------------- the R1 RESULT authority

describe('Phase 2-C2.6-B2-C2A-R2 R1 authority', () => {
  it('accepts the committed formal R1 RESULT and fails closed on any registered value', () => {
    const parsed = parsePhase2C26B2C2AR2R1Authority(r1Json, r1Sha)
    expect(parsed.issues).toEqual([])
    const r1 = parsed.authority!
    expect(r1.retryRows).toHaveLength(2)
    expect(r1.combinedTargets).toHaveLength(20)
    expect(r1.combined.exactTargets).toEqual({ C8: 18, C32: 18, C4C: 20 })
    expect(r1.overlay.combined).toEqual({ tasks: 320, measured: 319, unmeasured: 1, resolvedByRetry: 1, unresolved: 1 })
    expect(r1.b2c2aResultSha256).toBe(b2c2aSha)
    expect(r1.retryManifestSha256).toBe(PHASE2C26B2C2AR2_SOURCE.r1RetryManifestSha256)
    expect(r1.retry).toEqual({ ...PHASE2C26B2C2AR1_RETRY })
    expect(parsePhase2C26B2C2AR2R1Authority(r1Json, SHA('0')).valid).toBe(false)
    const mutate = (patch: (j: typeof r1Json) => void) => { const copy = structuredClone(r1Json); patch(copy); return parsePhase2C26B2C2AR2R1Authority(copy, r1Sha).valid }
    expect(mutate(() => undefined)).toBe(true)
    expect(mutate(j => { j.provenance.formal = false })).toBe(false)
    expect(mutate(j => { j.provenance.calculationCodeChangedSinceMeasuredHead = ['src/x.ts'] })).toBe(false)
    expect(mutate(j => { j.provenance.uncommittedBenchmarkCode = true })).toBe(false)
    expect(mutate(j => { j.provenance.smoke = { budgetMs: 60000 } })).toBe(false)
    expect(mutate(j => { j.provenance.measuredHead = 'a'.repeat(40) })).toBe(false)
    expect(mutate(j => { j.provenance.analysisHead = 'a'.repeat(40) })).toBe(false)
    expect(mutate(j => { j.provenance.benchmarkCodeSha256 = SHA('1') })).toBe(false)
    expect(mutate(j => { j.provenance.retrySelectionUsesOracle = true })).toBe(false)
    expect(mutate(j => { j.provenance.oracleMatchUsedForEarlyStop = true })).toBe(false)
    expect(mutate(j => { j.provenance.b2c2aResultRewritten = true })).toBe(false)
    expect(mutate(j => { j.provenance.b2c2aResultSha256 = SHA('1') })).toBe(false)
    expect(mutate(j => { j.provenance.targetManifestSha256 = SHA('1') })).toBe(false)
    expect(mutate(j => { j.provenance.retryManifestSha256 = SHA('1') })).toBe(false)
    expect(mutate(j => { j.provenance.exportSha256 = 'x' })).toBe(false)
    expect(mutate(j => { j.decision.case = 'B2C2AR1_ALL_C4C' })).toBe(false)
    expect(mutate(j => { j.decision.reasons = ['x'] })).toBe(false)
    expect(mutate(j => { j.invalidReasons = ['x'] })).toBe(false)
    expect(mutate(j => { j.conditions.retry.budgetMs = 3_600_000 })).toBe(false)
    expect(mutate(j => { j.conditions.retry.childHeapMb = 4096 })).toBe(false)
    expect(mutate(j => { j.conditions.candidateSafetyCap = 512 })).toBe(false)
    expect(mutate(j => { j.conditions.maxCostCohorts = 3 })).toBe(false)
    expect(mutate(j => { j.conditions.extent.maxGogmaAdvance = 300 })).toBe(false)
    expect(mutate(j => { j.conditions.childScript = 'scripts/other.mjs' })).toBe(false)
    expect(mutate(j => { j.overlay.combined.measured = 320 })).toBe(false)
    expect(mutate(j => { j.overlay.retry.timeout = 2 })).toBe(false)
    expect(mutate(j => { j.aggregates.combined.exactTargets.C8 = 19 })).toBe(false)
    expect(mutate(j => { j.aggregates.combined.exactTargets.C4C = 19 })).toBe(false)
    expect(mutate(j => { j.parity.hashChain.exportMatchesOracle = false })).toBe(false)
    expect(mutate(j => { delete j.parity.hashChain.exportMatchesOracle })).toBe(false)
    expect(mutate(j => { j.retryRows.pop() })).toBe(false)
    expect(mutate(j => { j.retryRows.reverse() })).toBe(false)
    // An unmeasured retry row that is not a timeout, and a timeout row that carries Candidates, fail closed.
    expect(mutate(j => { j.retryRows.find((row: { process: string }) => row.process === 'timeout').process = 'out_of_memory' })).toBe(false)
    expect(mutate(j => { j.retryRows.find((row: { process: string }) => row.process === 'timeout').candidateCount = 4 })).toBe(false)
    // A measured retry row whose record vanished no longer agrees with the overlay.
    expect(mutate(j => { j.retryRows.find((row: { process: string }) => row.process === 'completed').record = null })).toBe(false)
    expect(mutate(j => { j.combinedTargets.pop() })).toBe(false)
    expect(parsePhase2C26B2C2AR2R1Authority(null, r1Sha).valid).toBe(false)
  })

  it('registers the R1 heads, counts and provenance flags it requires', () => {
    expect(PHASE2C26B2C2AR2_REGISTERED_R1).toMatchObject({ decisionCase: 'B2C2AR1_INCOMPLETE', combinedB2C2ACase: 'B2C2A_INCOMPLETE', hashChainEntries: 26,
      combinedExactTargets: { C8: 18, C32: 18, C4C: 20 }, overlay: { original: { tasks: 320, measured: 318, timeout: 2 }, combined: { measured: 319, unmeasured: 1, unresolved: 1 } },
      provenanceFlags: { retrySelectionUsesOracle: false, oracleMatchUsedForEarlyStop: false, originalEvidenceRerun: false, b2c2aResultRewritten: false } })
    expect(PHASE2C26B2C2AR2_REGISTERED_R1.measuredHead).toMatch(/^[0-9a-f]{40}$/)
    expect(PHASE2C26B2C2AR2_REGISTERED_R1.analysisHead).toBe(PHASE2C26B2C2AR2_REGISTERED_R1.measuredHead)
    expect(PHASE2C26B2C2AR2_EXPECTED_RETRY_TASKS).toBe(1)
  })

  it('reads the B2-C2A and R1 RESULTs as one chain', () => {
    const b2c2a = parsePhase2C26B2C2AR1Authority(b2c2aJson, b2c2aSha).authority!
    const r1 = parsePhase2C26B2C2AR2R1Authority(r1Json, r1Sha).authority!
    expect(phase2c26b2c2ar2ChainIssues(b2c2a, r1)).toEqual([])
    expect(phase2c26b2c2ar2ChainIssues(b2c2a, { ...r1, exportSha256: SHA('0') }).join()).toMatch(/exportSha256 is not the B2-C2A one/)
    expect(phase2c26b2c2ar2ChainIssues(b2c2a, { ...r1, oracleResultSha256: SHA('0') }).join()).toMatch(/oracleResultSha256/)
    expect(phase2c26b2c2ar2ChainIssues(b2c2a, { ...r1, retryTaskIds: r1.retryTaskIds.slice(1) }).join()).toMatch(/are not the B2-C2A unmeasured rows/)
    expect(phase2c26b2c2ar2ChainIssues(b2c2a, { ...r1, retryRows: r1.retryRows.map((row, i) => i === 0 ? { ...row, searchInputDigest: 'other' } : row) }).join()).toMatch(/searchInputDigest differ/)
    expect(phase2c26b2c2ar2ChainIssues(b2c2a, { ...r1, retryRows: r1.retryRows.map((row, i) => i === 0 ? { ...row, compatible: !row.compatible } : row) }).join()).toMatch(/compatible differ/)
  })
})

// ---------------------------------------------------------------- the still-unmeasured subset and the retry manifest

describe('Phase 2-C2.6-B2-C2A-R2 retry manifest', () => {
  const b2c2a = parsePhase2C26B2C2AR1Authority(b2c2aJson, b2c2aSha).authority!
  const r1 = parsePhase2C26B2C2AR2R1Authority(r1Json, r1Sha).authority!

  it('takes exactly the R1 retry rows with process = timeout and record = null, whatever their compatibility, coverage or other-rank exact', () => {
    const ids = phase2c26b2c2ar2TimeoutTaskIds(r1.retryRows)
    expect(ids).toHaveLength(1)
    expect(ids).toEqual(r1.retryRows.filter(row => row.process === 'timeout' && row.record === null).map(row => row.taskId))
    // The R1 retry rows are the B2-C2A unmeasured rows, so the selected task was never measured by B2-C2A either.
    expect(ids.every(id => b2c2a.taskRows.find(row => row.taskId === id)!.record === null)).toBe(true)
    // Selection never reads compatibility, coverage, exact information, Candidate count, cost or route data, nor another rank's exact.
    const scramble = <T extends object>(row: T) => ({ ...row, compatible: true, coverage: 'exact', firstExactIndex: 0, exactCount: 9, hit: { C8: true, C32: true, C4C: true },
      firstExactCost: 1, partialCount: 3, candidateCount: 7, termination: 'four_cost_cohorts_drained' })
    expect(phase2c26b2c2ar2TimeoutTaskIds(r1.retryRows.map(scramble))).toEqual(ids)
    // An R1-measured row is never selected, an R1 timeout without a record always is; any other outcome or a timeout holding a record is not.
    expect(phase2c26b2c2ar2TimeoutTaskIds([{ taskId: 't00-r03', process: 'timeout', record: null }, { taskId: 't00-r01', process: 'completed', record: 'searched' },
      { taskId: 't00-r02', process: 'timeout', record: null }, { taskId: 't00-r04', process: 'out_of_memory', record: null }, { taskId: 't00-r05', process: 'timeout', record: 'searched' },
      { taskId: 't00-r06', process: 'process_failure', record: null }])).toEqual(['t00-r02', 't00-r03'])
    // The function body reads nothing post-hoc.
    const body = authoritySource.slice(authoritySource.indexOf('export function phase2c26b2c2ar2TimeoutTaskIds'), authoritySource.indexOf('/** The retry manifest:'))
    expect(body).not.toMatch(/compatible|coverage|exact|firstCompatible|routeKind|oracle|cost|rank|hit\b|candidate/i)
  })

  it('writes task IDs and source hashes only, exactly what the retry runner accepts', () => {
    const manifest = phase2c26b2c2ar2RetryManifest(r1)
    expect(Object.keys(manifest).sort()).toEqual(['exportSha256', 'phase', 'sourceB2C2AResultSha256', 'sourceR1ResultSha256', 'sourceR1RetryManifestSha256', 'sourceTargetManifestSha256', 'taskIds'])
    expect(manifest).toMatchObject({ sourceR1ResultSha256: r1Sha, sourceR1RetryManifestSha256: PHASE2C26B2C2AR2_SOURCE.r1RetryManifestSha256, sourceB2C2AResultSha256: b2c2aSha,
      sourceTargetManifestSha256: PHASE2C26B2C2AR2_SOURCE.targetManifestSha256, exportSha256: r1.exportSha256, taskIds: phase2c26b2c2ar2TimeoutTaskIds(r1.retryRows) })
    expect(JSON.stringify({ ...manifest, phase: '' })).not.toMatch(/compatib|coverage|exact|oracle|firstCompatible|rank|candidate|stableKey|cost|fnv1a32|[0-9a-f]{8}-[0-9a-f]{4}-/i)
    expect(parsePhase2C26B2C2AR2RetryManifest(structuredClone(manifest))).toMatchObject({ valid: true, issues: [] })
    // If R1 had measured every retry task, there would be nothing to retry: the manifest refuses an empty subset.
    expect(() => phase2c26b2c2ar2RetryManifest({ ...r1, retryRows: r1.retryRows.map(row => ({ ...row, process: 'completed', record: 'searched' as const })) })).toThrow(/holds 0 tasks, not 1/)
  })

  it('fails closed on another count, a duplicate, an extra key or another source', () => {
    const manifest = phase2c26b2c2ar2RetryManifest(r1)
    const bad = (patch: (m: Record<string, unknown> & Phase2C26B2C2AR2RetryManifest) => void) => {
      const copy = structuredClone(manifest) as Record<string, unknown> & Phase2C26B2C2AR2RetryManifest
      patch(copy)
      return parsePhase2C26B2C2AR2RetryManifest(copy)
    }
    expect(bad(m => { m.taskIds = [m.taskIds[0]!, m.taskIds[0]!] }).issues.join()).toMatch(/repeats/)
    expect(bad(m => { m.taskIds = [] }).issues.join()).toMatch(/not 1/)
    expect(bad(m => { m.taskIds = ['t00-r01', 't19-r16'] }).issues.join()).toMatch(/not 1/)
    expect(bad(m => { m.taskIds = ['x'] }).valid).toBe(false)
    expect(bad(m => { m.sourceR1ResultSha256 = SHA('0') }).issues.join()).toMatch(/registered R1 RESULT/)
    expect(bad(m => { m.sourceR1RetryManifestSha256 = SHA('0') }).issues.join()).toMatch(/registered R1 retry manifest/)
    expect(bad(m => { m.sourceB2C2AResultSha256 = SHA('0') }).issues.join()).toMatch(/registered B2-C2A RESULT/)
    expect(bad(m => { m.sourceTargetManifestSha256 = SHA('0') }).issues.join()).toMatch(/registered B2-C2A Target manifest/)
    expect(bad(m => { m.exportSha256 = 'x' }).valid).toBe(false)
    expect(bad(m => { m.compatible = [false] }).issues.join()).toMatch(/keys are not exactly/)
    expect(bad(m => { m.otherRankExact = true }).valid).toBe(false)
    expect(parsePhase2C26B2C2AR2RetryManifest(null).valid).toBe(false)
  })
})

// ---------------------------------------------------------------- reconstruction and selection

/** A reconstructed task carrying exactly the identity of a B2-C2A row. */
const taskFromRow = (row: Phase2C26B2C2AR1OriginalTaskRow): Phase2C26B2C2ATaskInput => ({ taskId: row.taskId, executionClass: 'stage1', targetWeaponId: row.targetWeaponId,
  contextRank: row.contextRank, policy: 'P1', groupIndex: row.groupIndex, reservationDigest: row.reservationDigest, targetEligibleMinCardinality: row.targetEligibleMinCardinality,
  representativeFixedSetId: row.representativeFixedSetId, representativeFixedTargetWeaponIds: [...row.representativeFixedTargetWeaponIds], searchInputDigest: row.searchInputDigest,
  maxCostCohorts: PHASE2C26B2C2A_MAX_COST_COHORTS, candidateSafetyCap: PHASE2C26B2C2A_CANDIDATE_SAFETY_CAP })

describe('Phase 2-C2.6-B2-C2A-R2 retry selection', () => {
  const b2c2a = parsePhase2C26B2C2AR1Authority(b2c2aJson, b2c2aSha).authority!
  const r1 = parsePhase2C26B2C2AR2R1Authority(r1Json, r1Sha).authority!
  const tasks = b2c2a.taskRows.map(taskFromRow)
  const ids = phase2c26b2c2ar2TimeoutTaskIds(r1.retryRows)

  it('selects exactly the retry task out of 320, unchanged, and fails closed otherwise', () => {
    const construction = { valid: true, issues: [], tasks }
    const selected = selectPhase2C26B2C2AR2Tasks(construction, ids)
    expect(selected.issues).toEqual([])
    expect(selected.tasks.map(t => t.taskId)).toEqual(ids)
    for (const task of selected.tasks) expect(task).toEqual(tasks.find(t => t.taskId === task.taskId))
    expect(selected.tasks.every(t => t.maxCostCohorts === 4 && t.candidateSafetyCap === 1024)).toBe(true)
    expect(selectPhase2C26B2C2AR2Tasks({ ...construction, valid: false, issues: ['x'] }, ids).issues.join()).toMatch(/not valid/)
    expect(selectPhase2C26B2C2AR2Tasks({ ...construction, tasks: tasks.slice(0, 319) }, ids).valid).toBe(false)
    expect(selectPhase2C26B2C2AR2Tasks({ ...construction, tasks: [...tasks.slice(0, 319), tasks[0]!] }, ids).issues.join()).toMatch(/repeats a task ID/)
    expect(selectPhase2C26B2C2AR2Tasks(construction, [...ids, ...r1.retryTaskIds.filter(id => !ids.includes(id))]).issues.join()).toMatch(/2 retry tasks/)
    expect(selectPhase2C26B2C2AR2Tasks(construction, ['t99-r99']).issues.join()).toMatch(/0 reconstructed tasks/)
    expect(selectPhase2C26B2C2AR2Tasks(construction, ['t99-r99']).tasks).toEqual([])
  })
})

// ---------------------------------------------------------------- the retry execution conditions

describe('Phase 2-C2.6-B2-C2A-R2 retry execution', () => {
  it('changes only the budget (30 -> 60 minutes) against R1 and inherits every Search / capture / heap / concurrency condition', () => {
    expect(PHASE2C26B2C2AR2_RETRY).toEqual({ executionClass: 'r2_retry', childHeapMb: 8192, concurrency: 1, budgetMs: 3_600_000, retry: 'none', fallback: 'none' })
    const { budgetMs: r2Budget, executionClass: r2Class, ...r2Rest } = PHASE2C26B2C2AR2_RETRY
    const { budgetMs: r1Budget, executionClass: r1Class, ...r1Rest } = PHASE2C26B2C2AR1_RETRY
    expect(r2Rest).toEqual(r1Rest)
    expect(r2Budget).toBe(2 * r1Budget)
    expect(r2Class).not.toBe(r1Class)
    expect(PHASE2C26B2C2AR2_RETRY.childHeapMb).toBe(PHASE2C26B2C2A_STAGE1.childHeapMb)
    expect(PHASE2C26B2C2AR2_INHERITED).toEqual({ maxCostCohorts: 4, candidateSafetyCap: 1024, expectedTasks: 320, stage1HeapMb: 8192, r1HeapMb: 8192, r1Concurrency: 1, r1BudgetMs: 1_800_000 })
    expect(defaultPlannerAlternativeSearchExtent).toEqual({ maxNormalAdvance: 4, maxGogmaAdvance: 235, maxSkillAdvance: 4 })
  })

  it('runs the retry task in the unchanged B2-C2A child, one at a time, with no second retry, fallback or early stop', () => {
    expect(runnerSource).toMatch(/const CHILD_SCRIPT_PATH = 'scripts\/run-planner-global-phase2c26b2c2a\.mjs'/)
    expect(runnerSource).toMatch(/runChild\('tasks', 'tasks', \{ targetWeaponIds: targets\.targetWeaponIds \}/)
    expect(runnerSource).toMatch(/runChild\(`r2-\$\{task\.taskId\}`, 'search', task, \{ heapMb: retryConditions\.childHeapMb, budgetMs: retryConditions\.budgetMs \}\)/)
    expect(runnerSource).toMatch(/for \(const task of retryTasks\) \{\s*const run = await runChild/)
    expect(runnerSource).toMatch(/selectPhase2C26B2C2AR2Tasks\(construction, retry\.taskIds\)/)
    expect(runnerSource).toMatch(/const retryTasks = selection\.tasks\n/)
    expect(runnerSource).not.toMatch(/pool\(|Promise\.all\(|fallback\(|retryAgain|budgetMs \* 2|7_200_000|120 \* 60|smoke-task-ids/)
    // The runner is the R1 runner with only the R2 module, the budget source and the smoke subset option changed.
    const childBlock = (source: string) => source.slice(source.indexOf('const runChild = '), source.indexOf('const retryConditions = '))
    expect(childBlock(runnerSource)).toBe(childBlock(r1RunnerSource))
    // The retry runner never builds its own Search, capture or context.
    for (const source of [runnerSource, searchSource]) {
      expect(source).not.toMatch(/\.visitPlannerAlternativeCandidates\(|visitPlannerAlternativeCandidates\(searchInput|\.runPhase2C26B2C2ASearch\(|reconstructPhase2C26B2B2AContext\(schedule|createPhase2C26B2C2ACapture\(|'stop'|^import .*domain\/search/m)
    }
    expect(searchSource).not.toMatch(/maxCostCohorts:\s*\d|candidateSafetyCap:\s*\d/)
  })
})

// ---------------------------------------------------------------- analysis over a synthetic world

const TARGET = 't1'
function summary(patch: Partial<Phase2C2CandidateSummary> = {}): Phase2C2CandidateSummary {
  return { targetWeaponId: TARGET, routeKind: 'existing_gogma_reset_bonuses', sourceKind: 'owned_gogma', sourceOwnedWeaponId: 'w1', estimatedOperationCount: 2,
    estimatedAdvances: { normal: null, gogma: 1, skill: 0 }, ownOperationCount: 2, operationTypes: { reset_bonuses: 2 }, normalCounterId: null, normalProductionTargetPosition: null,
    blindNormalCreation: false, conversionSkillPosition: null, normal: null,
    gogma: { first: 1, last: 2, operations: 2, positions: [[1, 2]], required: [2], crossesHeldPositions: false, startsAfterOrigin: false }, skill: null,
    gogmaTypeRuns: [[1, 2, 'reset_bonuses']], heldRoute: false, finalBonuses: [], restorationBonusScope: 'gogma_artian', seriesSkillId: null, groupSkillId: null, ...patch }
}
/** The synthetic reference Route: owned w2, Gogma 11 and 13 (held 12), two operations. */
const ROUTE = { targetWeaponId: TARGET, sourceKind: 'owned', sourceOwnedWeaponId: 'w2', normalPosition: null, conversionPosition: null, normal: { first: null, last: null, operations: 0 },
  gogma: { first: 11, last: 13, operations: 2, required: [13] }, skill: { first: null, last: null, operations: 0, required: [] }, routeOperationCount: 2,
  finalBonuses: [], finalScope: 'gogma_artian', finalSeriesSkillId: null, finalGroupSkillId: null,
  materialization: { method: 'planner_alternative_search', routeKind: 'existing_gogma_reset_bonuses', estimated: { operations: 2, normal: null, gogma: 13, skill: 0 } } }
const USAGE = [{ position: 11, targetWeaponId: TARGET, type: 'reset_bonuses', required: false }, { position: 13, targetWeaponId: TARGET, type: 'reset_bonuses', required: true }]
const MATCH = summary({ sourceOwnedWeaponId: 'w2', estimatedAdvances: { normal: null, gogma: 13, skill: 0 },
  gogma: { first: 11, last: 13, operations: 2, positions: [[11, 11], [13, 13]], required: [13], crossesHeldPositions: true, startsAfterOrigin: true },
  gogmaTypeRuns: [[11, 11, 'reset_bonuses'], [13, 13, 'reset_bonuses']], heldRoute: true })
const REFERENCE = { routes: [ROUTE], gogmaUsage: USAGE }
/** The same Route with incomplete per-unit usage: a matching Candidate is partial_comparable, never exact. */
const PARTIAL_REFERENCE = { routes: [ROUTE], gogmaUsage: [USAGE[1]!] }

function taskOf(rank: number): Phase2C26B2C2ATaskInput {
  return { taskId: `t00-r${String(rank).padStart(2, '0')}`, executionClass: 'stage1', targetWeaponId: TARGET, contextRank: rank, policy: 'P1', groupIndex: 100 + rank,
    reservationDigest: `d${rank}`, targetEligibleMinCardinality: rank === 1 ? 0 : 1, representativeFixedSetId: rank === 1 ? 'K0' : `K1:e${rank}`, representativeFixedTargetWeaponIds: rank === 1 ? [] : [`x${rank}`],
    searchInputDigest: `s${rank}`, maxCostCohorts: 4, candidateSafetyCap: 1024 }
}
function delivered(s: Phase2C2CandidateSummary, index: number): Phase2C26B2B2A2DeliveredCandidate {
  return { deliveryIndex: index, stableKey: `k${String(index).padStart(5, '0')}`, orderingKeys: { estimatedOperationCount: s.estimatedOperationCount, estimatedGogmaAdvance: s.estimatedAdvances.gogma,
    estimatedSkillAdvance: s.estimatedAdvances.skill, estimatedNormalAdvance: s.estimatedAdvances.normal, preferredSourceRank: 0 }, comparatorWithPrevious: index === 0 ? null : -1,
    summary: s, reservationCheck: { respects: true, blockedHits: {}, exclusiveHit: [] } }
}
const filler = (n: number, cost: number, from = 0) => Array.from({ length: n }, (_, i) => summary({ sourceOwnedWeaponId: `other-${from + i}`, estimatedOperationCount: cost, estimatedAdvances: { normal: null, gogma: 1, skill: 0 } }))
function capture(task: Phase2C26B2C2ATaskInput, summaries: Phase2C2CandidateSummary[], termination: Phase2C26B2C2ASearchRecord['termination'], sentinel: Phase2C2CandidateSummary | null = null): Phase2C26B2C2ASearchRecord {
  const candidates = summaries.map(delivered)
  const status = termination === 'four_cost_cohorts_drained' || termination === 'candidate_safety_cap' ? 'consumer_stop' : termination
  const costs = [...new Set(summaries.map(s => s.estimatedOperationCount))]
  return { targetWeaponId: task.targetWeaponId, contextRank: task.contextRank, groupIndex: task.groupIndex, reservationDigest: task.reservationDigest, targetEligibleMinCardinality: task.targetEligibleMinCardinality,
    representativeFixedSetId: task.representativeFixedSetId, representativeFixedTargetWeaponIds: [...task.representativeFixedTargetWeaponIds], searchInputDigest: task.searchInputDigest,
    extent: { ...defaultPlannerAlternativeSearchExtent }, excludedRouteKeys: ['current'], preferredOwnedWeaponId: null, maxCostCohorts: 4, candidateSafetyCap: 1024, status,
    summary: { deliveredCandidates: candidates.length + (sentinel ? 1 : 0), excludedCandidates: 0, exhausted: status === 'exhausted', stoppedByExtent: status === 'stopped_by_extent', stoppedByConsumer: status === 'consumer_stop' },
    candidates, nextCostSentinel: sentinel ? delivered(sentinel, candidates.length) : null, termination, captureComplete: termination !== 'candidate_safety_cap', safetyCapHit: termination === 'candidate_safety_cap',
    capturedCosts: costs, distinctCostCohorts: costs.length, nonmonotonicIndexes: [], costReadIssues: [], elapsedMs: 1 }
}
function runOf(task: Phase2C26B2C2ATaskInput, record: Phase2C26B2C2ASearchRecord | null, process: 'completed' | 'timeout' | 'out_of_memory' | 'process_failure' = 'completed'): Phase2C26B2C2ARun {
  const child = record === null ? null : { status: 'searched' as const, taskId: task.taskId, search: record }
  return { taskId: task.taskId, task, outcome: phase2c26b2c2aTaskOutcome(task.taskId, process, process === 'completed' ? child : null),
    process: { outcome: process, wallMs: 10, timedOut: process === 'timeout', budgetMs: 1 }, childWallMs: 9, scheduleMs: 1, yields: 3,
    memory: process === 'completed' ? { sampledMaxHeapUsedBytes: 100, sampledMaxRssBytes: 200, maxRssKiB: 1 } : null, lastIpcMemory: { maxHeapUsedBytes: 50, maxRssBytes: 300 },
    record: process === 'completed' ? child : null }
}
const miss = (task: Phase2C26B2C2ATaskInput) => capture(task, [summary({ estimatedOperationCount: 1, sourceOwnedWeaponId: 'cheap' }), ...filler(5, 2)], 'exhausted')
const withMatchAt = (task: Phase2C26B2C2ATaskInput, at: number) => capture(task, [summary({ estimatedOperationCount: 1, sourceOwnedWeaponId: 'cheap' }), ...filler(Math.max(at - 1, 0), 2), { ...MATCH },
  ...filler(3, 3, 100), ...filler(2, 4, 200)], 'four_cost_cohorts_drained', summary({ estimatedOperationCount: 5, sourceOwnedWeaponId: 'dear' }))

/** 16 ranks of one Target: rank 2 is compatible with an exact Candidate at index 3; ranks 4 and 6 timed out in B2-C2A; R1 measured rank 4 and timed out on rank 6. */
const TIMEOUT_RANKS = [4, 6]
const R1_MEASURED_RANK = 4
const TASKS = Array.from({ length: 16 }, (_, i) => taskOf(i + 1))
function originalRow(task: Phase2C26B2C2ATaskInput): Phase2C26B2C2AR1OriginalTaskRow {
  const timeout = TIMEOUT_RANKS.includes(task.contextRank)
  const exact = task.contextRank === 2
  return { taskId: task.taskId, targetWeaponId: task.targetWeaponId, contextRank: task.contextRank, groupIndex: task.groupIndex, reservationDigest: task.reservationDigest,
    targetEligibleMinCardinality: task.targetEligibleMinCardinality, representativeFixedSetId: task.representativeFixedSetId, representativeFixedTargetWeaponIds: [...task.representativeFixedTargetWeaponIds],
    searchInputDigest: task.searchInputDigest, process: timeout ? 'timeout' : 'completed', record: timeout ? null : 'searched', wallMs: timeout ? 600_000 : 10, peakHeapBytes: 1, peakRssBytes: 1, yields: 1,
    termination: timeout ? null : exact ? 'four_cost_cohorts_drained' : 'exhausted', candidateCount: timeout ? null : exact ? 10 : 6, capturedCosts: timeout ? [] : exact ? [1, 2, 3, 4] : [1, 2],
    captureComplete: timeout ? null : true, safetyCapHit: timeout ? null : false, compatible: exact, coverage: timeout ? null : exact ? 'exact' : 'uncovered',
    firstExactIndex: exact ? 3 : null, firstExactCost: exact ? 2 : null, firstPartialIndex: null, exactCount: exact ? 1 : 0, partialCount: 0,
    hit: { C8: exact, C32: exact, C4C: exact }, sentinelExact: false, reservationViolations: 0 }
}
function r1Row(task: Phase2C26B2C2ATaskInput): Phase2C26B2C2AR2R1RetryRow {
  const measured = task.contextRank === R1_MEASURED_RANK
  return { taskId: task.taskId, targetWeaponId: task.targetWeaponId, contextRank: task.contextRank, groupIndex: task.groupIndex, reservationDigest: task.reservationDigest,
    targetEligibleMinCardinality: task.targetEligibleMinCardinality, representativeFixedSetId: task.representativeFixedSetId, representativeFixedTargetWeaponIds: [...task.representativeFixedTargetWeaponIds],
    searchInputDigest: task.searchInputDigest, process: measured ? 'completed' : 'timeout', record: measured ? 'searched' : null, budgetMs: 1_800_000, wallMs: measured ? 1_000_000 : 1_800_000,
    searchElapsedMs: measured ? 999_000 : null, peakHeapBytes: 1, peakRssBytes: 1, yields: 1, termination: measured ? 'stopped_by_extent' : null, candidateCount: measured ? 0 : null,
    capturedCosts: [], captureComplete: measured ? true : null, safetyCapHit: measured ? false : null, compatible: false, coverage: measured ? 'uncovered' : null,
    firstExactIndex: null, firstExactCost: null, firstPartialIndex: null, exactCount: 0, partialCount: 0, hit: { C8: false, C32: false, C4C: false }, sentinelExact: false, reservationViolations: 0 }
}
const COVERAGE = { top1: 0, top2: 1, top4: 1, top8: 1, top12: 1, top16: 1 }
const FIRST = { firstExactContextRank: 2, firstExactCandidateIndex: 3, firstExactOperationCost: 2 }
function syntheticB2C2A(patch: (a: Phase2C26B2C2AR1Authority) => void = () => undefined): Phase2C26B2C2AR1Authority {
  const authority: Phase2C26B2C2AR1Authority = { resultSha256: PHASE2C26B2C2AR1_SOURCE.b2c2aResultSha256, measuredHead: 'a'.repeat(40), analysisHead: 'b'.repeat(40), benchmarkCodeSha256: SHA('c'),
    exportSha256: SHA('e'), targetManifestSha256: PHASE2C26B2C2AR1_SOURCE.targetManifestSha256, b2c1ResultSha256: SHA('1'), b2b1ResultSha256: SHA('2'), b2b2aResultSha256: SHA('3'),
    b2b2a2ResultSha256: SHA('4'), oracleResultSha256: SHA('5'), oracleManifestFileSha256: SHA('6'), oracleManifestRoutesSha256: SHA('7'), stage1: { ...PHASE2C26B2C2A_STAGE1 },
    execution: { tasks: 16, completed: 14, timeout: 2, outOfMemory: 0, processFailure: 0, contextMismatch: 0, notRun: 0 }, exactTargets: { C8: 1, C32: 1, C4C: 1 },
    budgetCoverage: { C8: { ...COVERAGE }, C32: { ...COVERAGE }, C4C: { ...COVERAGE } }, cascade: { c8: 1, c8MissC32: 0, c32MissC4C: 0, c4cMiss: 0 }, targetWeaponIds: [TARGET],
    taskRows: TASKS.map(originalRow),
    targets: [{ targetWeaponId: TARGET, b2c1FirstCompatibleRank: 2, policies: { C8: { ...FIRST }, C32: { ...FIRST }, C4C: { ...FIRST } }, recovery: 'C8', missClass: null, safetyCapContexts: 0 }] }
  patch(authority)
  return authority
}
function syntheticR1(patch: (a: Phase2C26B2C2AR2R1Authority) => void = () => undefined): Phase2C26B2C2AR2R1Authority {
  const r1: Phase2C26B2C2AR2R1Authority = { resultSha256: PHASE2C26B2C2AR2_SOURCE.r1ResultSha256, measuredHead: 'd'.repeat(40), analysisHead: 'd'.repeat(40), benchmarkCodeSha256: SHA('f'),
    exportSha256: SHA('e'), b2c2aResultSha256: PHASE2C26B2C2AR1_SOURCE.b2c2aResultSha256, targetManifestSha256: PHASE2C26B2C2AR1_SOURCE.targetManifestSha256,
    retryManifestSha256: PHASE2C26B2C2AR2_SOURCE.r1RetryManifestSha256, b2c1ResultSha256: SHA('1'), b2b1ResultSha256: SHA('2'), b2b2aResultSha256: SHA('3'), b2b2a2ResultSha256: SHA('4'),
    oracleResultSha256: SHA('5'), oracleManifestFileSha256: SHA('6'), oracleManifestRoutesSha256: SHA('7'), retryTaskIds: ['t00-r04', 't00-r06'], retry: { ...PHASE2C26B2C2AR1_RETRY },
    overlay: { original: { tasks: 16, measured: 14, timeout: 2 }, retry: { selected: 2, runs: 2, measured: 1, timeout: 1, outOfMemory: 0, processFailure: 0, contextMismatch: 0, notRun: 0 },
      combined: { tasks: 16, measured: 15, unmeasured: 1, resolvedByRetry: 1, unresolved: 1 } },
    combined: { exactTargets: { C8: 1, C32: 1, C4C: 1 }, budgetCoverage: { C8: { ...COVERAGE }, C32: { ...COVERAGE }, C4C: { ...COVERAGE } }, cascade: { c8: 1, c8MissC32: 0, c32MissC4C: 0, c4cMiss: 0 },
      unresolvedSafetyCapTargets: 0, fullyMeasuredTargets: 0 },
    combinedTargets: [{ targetWeaponId: TARGET, measuredContexts: 15, fullyMeasured: false, safetyCapContexts: 0, policies: { C8: { ...FIRST }, C32: { ...FIRST }, C4C: { ...FIRST } }, recovery: 'C8', missClass: null }],
    retryRows: TASKS.filter(t => TIMEOUT_RANKS.includes(t.contextRank)).map(r1Row) }
  patch(r1)
  return r1
}
const MANIFEST: Phase2C26B2C2AR2RetryManifest = { phase: 'synthetic', sourceR1ResultSha256: PHASE2C26B2C2AR2_SOURCE.r1ResultSha256, sourceR1RetryManifestSha256: PHASE2C26B2C2AR2_SOURCE.r1RetryManifestSha256,
  sourceB2C2AResultSha256: PHASE2C26B2C2AR1_SOURCE.b2c2aResultSha256, sourceTargetManifestSha256: PHASE2C26B2C2AR1_SOURCE.targetManifestSha256, exportSha256: SHA('e'), taskIds: ['t00-r06'] }
const SELECTED = TASKS.filter(t => t.contextRank === 6)
const REACH: Phase2C26B2C2AReach[] = [{ targetWeaponId: TARGET, compatibleGroupIndexes: [102], p1FirstCompatibleRank: 2, inconsistencies: [] }]

function analyze(runs: Phase2C26B2C2ARun[], patch: { b2c2a?: Phase2C26B2C2AR1Authority; r1?: Phase2C26B2C2AR2R1Authority; manifest?: Phase2C26B2C2AR2RetryManifest; reach?: Phase2C26B2C2AReach[];
  reference?: typeof REFERENCE; selected?: Phase2C26B2C2ATaskInput[] } = {}) {
  return runPhase2C26B2C2AR2Analysis({ b2c2a: patch.b2c2a ?? syntheticB2C2A(), r1: patch.r1 ?? syntheticR1(), retryManifest: patch.manifest ?? MANIFEST, tasks: TASKS,
    selectedTasks: patch.selected ?? SELECTED, runs, reach: patch.reach ?? REACH, oracle: patch.reference ?? REFERENCE, oracleOperationCost: () => 2, smoke: false })
}

describe('Phase 2-C2.6-B2-C2A-R2 analysis', () => {
  it('reproduces the B2-C2A and R1 aggregates first, then overlays the measured R2 task without counting a task twice', () => {
    const result = analyze(SELECTED.map(t => runOf(t, miss(t))))
    expect(result.invalidReasons).toEqual([])
    expect(result.originalReproduction).toEqual({ exactTargets: true, budgetCoverage: true, cascade: true, targets: true })
    expect(result.r1Reproduction).toEqual({ measured: true, exactTargets: true, budgetCoverage: true, cascade: true, unresolvedSafetyCapTargets: true, fullyMeasuredTargets: true, targets: true })
    expect(result.overlay).toEqual({ original: { tasks: 16, measured: 14, timeout: 2 }, r1: { tasks: 16, measured: 15, unmeasured: 1 },
      retry: { selected: 1, runs: 1, measured: 1, timeout: 0, outOfMemory: 0, processFailure: 0, contextMismatch: 0, notRun: 0 },
      combined: { tasks: 16, measured: 16, unmeasured: 0, resolvedByR1: 1, resolvedByR2: 1, unresolved: 0 } })
    expect(result.combined.exactTargets).toEqual({ C8: 1, C32: 1, C4C: 1 })
    expect(result.combined.rows[0]).toMatchObject({ fullyMeasured: true, measuredContexts: 16, recovery: 'C8' })
    expect(result.r1Base.rows[0]).toMatchObject({ fullyMeasured: false, measuredContexts: 15 })
    expect(result.original.rows[0]).toMatchObject({ fullyMeasured: false, measuredContexts: 14 })
    expect(result.decisionInput).toMatchObject({ retrySelected: 1, retryMeasured: 1, retryUnmeasured: 0, combined: { unmeasuredTasks: 0, exactTargets: { C8: 1, C32: 1, C4C: 1 } } })
    // The R1-measured row is carried by the overlay as R1 recorded it, never re-run.
    expect(result.combinedContexts.find(c => c.taskId === 't00-r04')).toEqual(phase2c26b2c2ar2R1Context(syntheticR1().retryRows[0]!))
    expect(result.retryContexts.map(c => ({ taskId: c.taskId, measured: c.measured, compatible: c.compatible, coverage: c.coverage }))).toEqual([
      { taskId: 't00-r06', measured: true, compatible: false, coverage: 'uncovered' }])
    expect(result.compatibilityParity.filter(p => p.recorded !== p.recomputed)).toEqual([])
  })

  it('keeps an R2 timeout / OOM / failure unmeasured (never Candidate 0) and counts it as unresolved', () => {
    const result = analyze([runOf(SELECTED[0]!, null, 'timeout')])
    expect(result.invalidReasons).toEqual([])
    expect(result.overlay.retry).toMatchObject({ measured: 0, timeout: 1 })
    expect(result.overlay.combined).toEqual({ tasks: 16, measured: 15, unmeasured: 1, resolvedByR1: 1, resolvedByR2: 0, unresolved: 1 })
    expect(result.retryContexts[0]).toMatchObject({ measured: false, candidateCount: null, coverage: null })
    expect(analyze([runOf(SELECTED[0]!, null, 'out_of_memory')]).overlay.retry).toMatchObject({ measured: 0, outOfMemory: 1 })
    expect(analyze([runOf(SELECTED[0]!, null, 'process_failure')]).overlay.retry).toMatchObject({ measured: 0, processFailure: 1 })
  })

  it('treats a safety-capped retry as measured with an incomplete capture', () => {
    const capped = (t: Phase2C26B2C2ATaskInput) => capture(t, [summary({ estimatedOperationCount: 1, sourceOwnedWeaponId: 'cheap' }), ...filler(PHASE2C26B2C2A_CANDIDATE_SAFETY_CAP - 1, 2)], 'candidate_safety_cap')
    const result = analyze(SELECTED.map(t => runOf(t, capped(t))))
    expect(result.invalidReasons).toEqual([])
    expect(result.retryContexts.every(c => c.measured && c.safetyCapHit === true && c.captureComplete === false && c.candidateCount === 1024)).toBe(true)
    expect(result.overlay.combined).toMatchObject({ measured: 16, unmeasured: 0 })
    expect(result.combined.unresolvedSafetyCapTargets).toBe(0)
  })

  it('fails closed on a reservation violation, and on an exact or partial Candidate from a reservation-incompatible context', () => {
    const violating = miss(SELECTED[0]!)
    violating.candidates[2]!.reservationCheck = { respects: false, blockedHits: { gogma: [12] }, exclusiveHit: [] }
    expect(analyze([runOf(SELECTED[0]!, violating)]).invalidReasons.join()).toMatch(/semantic_failure: t00-r06: 1 delivered Candidate\(s\) violate the reservation/)
    const exact = analyze([runOf(SELECTED[0]!, withMatchAt(SELECTED[0]!, 3))])
    expect(exact.invalidReasons.join()).toMatch(/semantic_failure: t00-r06: an exact Candidate from a reservation-incompatible context/)
    const partial = analyze([runOf(SELECTED[0]!, withMatchAt(SELECTED[0]!, 3))], { reference: PARTIAL_REFERENCE })
    expect(partial.retryContexts[0]).toMatchObject({ coverage: 'partial_comparable', exactIndexes: [] })
    expect(partial.invalidReasons.join()).toMatch(/semantic_failure: t00-r06: a partial Candidate from a reservation-incompatible context/)
  })

  it('fails closed on a retry selection that is not the tasks unmeasured after R1, a chain break, or a compatibility drift', () => {
    const runs = SELECTED.map(t => runOf(t, miss(t)))
    // The R1-measured task, or both B2-C2A timeouts, are not the R2 subset.
    expect(analyze(runs, { manifest: { ...MANIFEST, taskIds: ['t00-r04'] } }).invalidReasons.join()).toMatch(/retry_manifest: taskIds t00-r04 are not the R1 timeout rows t00-r06/)
    expect(analyze(runs, { manifest: { ...MANIFEST, taskIds: ['t00-r04', 't00-r06'] } }).invalidReasons.join()).toMatch(/retry_manifest: 2 tasks, not 1/)
    expect(analyze(runs, { manifest: { ...MANIFEST, sourceR1ResultSha256: SHA('0') } }).invalidReasons.join()).toMatch(/sourceR1ResultSha256 is not the R1 authority/)
    expect(analyze(runs, { manifest: { ...MANIFEST, sourceB2C2AResultSha256: SHA('0') } }).invalidReasons.join()).toMatch(/sourceB2C2AResultSha256 is not the B2-C2A authority/)
    expect(analyze(runs, { manifest: { ...MANIFEST, exportSha256: SHA('0') } }).invalidReasons.join()).toMatch(/exportSha256 is not the authority/)
    expect(analyze(runs, { r1: syntheticR1(a => { a.exportSha256 = SHA('9') }) }).invalidReasons.join()).toMatch(/chain: the R1 exportSha256 is not the B2-C2A one/)
    expect(analyze(runs, { r1: syntheticR1(a => { a.retryRows = a.retryRows.slice(1); a.retryTaskIds = ['t00-r06'] }) }).invalidReasons.join()).toMatch(/chain: the R1 retry rows t00-r06 are not the B2-C2A unmeasured rows t00-r04,t00-r06/)
    expect(analyze([...runs, runOf(TASKS[3]!, miss(TASKS[3]!))]).invalidReasons.join()).toMatch(/retry_run: t00-r04 is not a retry manifest task/)
    expect(analyze(runs, { selected: [{ ...SELECTED[0]!, searchInputDigest: 'other' }] }).invalidReasons.join()).toMatch(/retry_selection: t00-r06 is not the reconstructed task/)
    // Compatibility: the B2-C2A row, the R1 row and the recomputation must agree.
    expect(analyze(runs, { b2c2a: syntheticB2C2A(a => { a.taskRows.find(r => r.taskId === 't00-r06')!.compatible = true }) }).invalidReasons.join()).toMatch(/compatibility_parity: t00-r06: recomputed false, B2-C2A recorded true/)
    expect(analyze(runs, { r1: syntheticR1(a => { a.retryRows[1]!.compatible = true }) }).invalidReasons.join()).toMatch(/compatibility_parity: t00-r06: recomputed false, R1 recorded true/)
    expect(analyze(runs, { reach: [{ ...REACH[0]!, p1FirstCompatibleRank: 3 }] }).invalidReasons.join()).toMatch(/authority: t1: recomputed P1 first compatible rank 3/)
  })

  it('fails closed when the recorded rows do not reproduce the B2-C2A or the R1 aggregates', () => {
    const runs = SELECTED.map(t => runOf(t, miss(t)))
    expect(analyze(runs, { b2c2a: syntheticB2C2A(a => { a.exactTargets.C8 = 0 }) }).invalidReasons.join()).toMatch(/raw_result: the original rows do not reproduce the B2-C2A exactTargets/)
    expect(analyze(runs, { r1: syntheticR1(a => { a.combined.exactTargets.C8 = 0 }) }).invalidReasons.join()).toMatch(/raw_result: the R1 overlay does not reproduce the R1 combined exactTargets/)
    expect(analyze(runs, { r1: syntheticR1(a => { a.overlay.combined.measured = 16 }) }).invalidReasons.join()).toMatch(/does not reproduce the R1 combined measured/)
    expect(analyze(runs, { r1: syntheticR1(a => { a.combinedTargets[0]!.measuredContexts = 16 }) }).invalidReasons.join()).toMatch(/does not reproduce the R1 combined targets/)
    expect(analyze(runs, { r1: syntheticR1(a => { a.combined.fullyMeasuredTargets = 1 }) }).invalidReasons.join()).toMatch(/does not reproduce the R1 combined fullyMeasuredTargets/)
    // An R1 row whose measurement the R1 combined aggregate counted, read back as unmeasured, is a reproduction failure too.
    const unmeasuredR1 = analyze(runs, { r1: syntheticR1(a => { Object.assign(a.retryRows[0]!, { process: 'timeout', record: null, termination: null, candidateCount: null,
      captureComplete: null, safetyCapHit: null, coverage: null }) }) }).invalidReasons.join()
    expect(unmeasuredR1).toMatch(/does not reproduce the R1 combined measured/)
    expect(unmeasuredR1).toMatch(/does not reproduce the R1 combined targets/)
  })

  it('fails closed on a raw record drift or a context mismatch in the retry child', () => {
    const drift = miss(SELECTED[0]!)
    drift.extent = { ...drift.extent, maxGogmaAdvance: 300 }
    expect(analyze([runOf(SELECTED[0]!, drift)]).invalidReasons.join()).toMatch(/raw: t00-r06: the extent is not the Production default/)
    const capRule = miss(SELECTED[0]!)
    capRule.candidateSafetyCap = 512
    expect(analyze([runOf(SELECTED[0]!, capRule)]).invalidReasons.join()).toMatch(/capture rule drift/)
    const mismatch: Phase2C26B2C2ARun = { ...runOf(SELECTED[0]!, miss(SELECTED[0]!)), record: { status: 'context_mismatch', taskId: 't00-r06', issues: ['searchInputDigest'] } }
    mismatch.outcome = phase2c26b2c2aTaskOutcome('t00-r06', 'completed', mismatch.record)
    expect(analyze([mismatch]).invalidReasons.join()).toMatch(/context mismatch in the retry Search child/)
  })
})

// ---------------------------------------------------------------- decision

describe('Phase 2-C2.6-B2-C2A-R2 decision', () => {
  const decide = (patch: Partial<Parameters<typeof phase2c26b2c2ar2Decision>[0]> = {}, combined: Partial<Parameters<typeof phase2c26b2c2ar2Decision>[0]['combined']> = {}) =>
    phase2c26b2c2ar2Decision({ invalidReasons: [], retrySelected: 1, retryMeasured: 1, retryUnmeasured: 0, r1ExactTargets: { C8: 18, C32: 18, C4C: 20 },
      ...patch, combined: { tasks: 320, targets: 20, unmeasuredTasks: 0, exactTargets: { C8: 18, C32: 18, C4C: 20 }, unresolvedSafetyCapTargets: 0, ...combined } })

  it('decides ALL_C4C when the retry measured, 320 / 320, C4C 20 and C32 < 20', () => {
    expect(decide()).toMatchObject({ case: 'B2C2AR2_ALL_C4C', reasons: [], combinedB2C2ACase: 'B2C2A_ALL_C4C' })
    expect(decide({}, { exactTargets: { C8: 19, C32: 20, C4C: 20 } }).case).toBe('B2C2AR2_ALL_C32')
    expect(decide({}, { exactTargets: { C8: 20, C32: 20, C4C: 20 } }).case).toBe('B2C2AR2_ALL_C8')
  })

  it('decides INCOMPLETE on a retry timeout / OOM / failure and INVALID on any invalid reason or inconsistency', () => {
    expect(decide({ retryMeasured: 0, retryUnmeasured: 1 }, { unmeasuredTasks: 1 })).toMatchObject({ case: 'B2C2AR2_INCOMPLETE', reasons: [] })
    expect(decide({ invalidReasons: ['hash_chain: x'] }).case).toBe('B2C2AR2_INVALID')
    expect(decide({ retrySelected: 2, retryMeasured: 2 }).case).toBe('B2C2AR2_INVALID')
    expect(decide({ retryMeasured: 0, retryUnmeasured: 0 }).case).toBe('B2C2AR2_INVALID')
    expect(decide({}, { unmeasuredTasks: 1 }).case).toBe('B2C2AR2_INVALID')
    expect(decide({}, { exactTargets: { C8: 17, C32: 18, C4C: 20 } }).reasons).toContain('combined_C8_below_r1')
    expect(decide({}, { tasks: 319 }).case).toBe('B2C2AR2_INVALID')
    // A combined PARTIAL contradicts the R1 C4C 20 / 20 authority.
    expect(decide({ r1ExactTargets: { C8: 10, C32: 10, C4C: 19 } }, { exactTargets: { C8: 10, C32: 10, C4C: 19 } })).toMatchObject({ case: 'B2C2AR2_INVALID', combinedB2C2ACase: 'B2C2A_PARTIAL' })
    expect(PHASE2C26B2C2AR2_DECISION_RULE.order).toHaveLength(4)
  })
})

// ---------------------------------------------------------------- isolation

describe('Phase 2-C2.6-B2-C2A-R2 isolation', () => {
  it('is never imported by Production and hard-codes no Target, task, Entry or reservation', () => {
    const production = import.meta.glob(['../domain/**/*.ts', '../services/**/*.ts', '../workers/**/*.ts', '../pages/**/*.tsx', '../components/**/*.tsx', '../db/**/*.ts', '!../**/*.test.ts', '!../**/*.test.tsx'],
      { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    expect(Object.keys(production).length).toBeGreaterThan(50)
    expect(Object.entries(production).filter(([, source]) => /plannerGlobalPhase2C26B2C2A/.test(source)).map(([path]) => path)).toEqual([])
    for (const source of [searchSource, authoritySource, analysisSource, prepareSource, runnerSource, analyzerSource]) {
      expect(source).not.toMatch(/\bt\d\d-r\d\d\b|fnv1a32[-:][0-9a-f]{8}|[0-9a-f]{8}-[0-9a-f]{4}-|build-list\.|K1:/)
    }
    for (const source of [searchSource, authoritySource, analysisSource]) expect(source).not.toMatch(/node:fs|readFile|import\.meta\.glob/)
  })

  it('keeps the oracle, compatibility and the RESULTs out of the Search side: only the retry-manifest step and the analyzer read them', () => {
    for (const source of [searchSource, runnerSource]) {
      // The character classes keep these names out of this file's own text (the Phase 2-A.5 isolation test reads it).
      expect(source).not.toMatch(/ORACLE_[1]657|1657|--oracle|--manifest|--b2c2a-result|--r1-result|--b2c1-result|gogmaUsage|plannerGlobal[O]racle|_RESULT|phase2c2OracleCoverage|Analysis'|Authority'|firstCompatible|compatibleGroupIndexes|phase2c26b2aReachability|phase2c26b2c2aReach|\.compatible\b/)
    }
    expect(searchSource).not.toMatch(/plannerGlobalPhase2C26B2C2AR2Authority|plannerGlobalPhase2C26B2C2AR2Analysis|plannerGlobalPhase2C26B2C2AR1Authority|plannerGlobalPhase2C26B2C2AR1Analysis|plannerGlobalPhase2C26B2C2AAnalysis|plannerGlobalPhase2C26B2C2ATargets/)
    expect(runnerSource).toMatch(/--retry/)
    expect(runnerSource).toMatch(/--targets/)
    expect(runnerSource).toMatch(/oracleGuidedPolicySelection: true, oracleGuidedTargetPopulation: true, contextOrderingUsesOracle: false, retrySelectionUsesOracle: false, oracleReadBySearchChild: false, oracleMatchUsedForEarlyStop: false/)
    expect(prepareSource).toMatch(/--b2c2a-result/)
    expect(prepareSource).toMatch(/--r1-result/)
    expect(prepareSource).not.toMatch(/--oracle|--manifest|visitPlannerAlternativeCandidates|\.compatible\b|compatibleGroupIndexes/)
    expect(analyzerSource).toMatch(/--oracle/)
    expect(analyzerSource).toMatch(/--r1-result/)
    expect(analyzerSource).toMatch(/oracleGuidedPolicySelection: true, oracleGuidedTargetPopulation: true, contextOrderingUsesOracle: false, retrySelectionUsesOracle: false, oracleReadBySearchChild: false,\s*oracleMatchUsedForEarlyStop: false/)
    // The analysis reuses the B2-C2A / R1 authorities; it never re-implements oracle matching or compatibility.
    expect(analysisSource).toMatch(/phase2c26b2c2aCompareContext\(/)
    expect(analysisSource).toMatch(/phase2c26b2c2aTargetRow\(/)
    expect(analysisSource).toMatch(/validatePhase2C26B2C2ARaw\(/)
    expect(analysisSource).toMatch(/phase2c26b2c2aDecision\(/)
    expect(analysisSource).toMatch(/phase2c26b2c2ar1OriginalContext/)
    expect(analyzerSource).toMatch(/c2aAnalysis\.phase2c26b2c2aReach\(/)
    expect(analyzerSource).toMatch(/r1Authority\.parsePhase2C26B2C2AR1Authority\(/)
    expect(analysisSource).not.toMatch(/from '\.\/plannerGlobalPhase2C2Analysis'|from '\.\/plannerGlobalPhase2C26B2AAnalysis'|matchOracleRoute\(|phase2c26b2aReachability\(/)
  })

  it('runs no Search, kernel or Planner outside the unchanged B2-C2A child, and never re-runs a measured task', () => {
    for (const source of [searchSource, authoritySource, analysisSource, prepareSource, runnerSource, analyzerSource]) {
      expect(source).not.toMatch(/runPreparedPlannerAlternativeKernel|preparePlannerAlternativeKernel|createProductionPlan|runPhase2C2Kernel|runPhase2C2Baseline|runPlannerDeterministicSchedule|createPlannerAlternativeWhatIfComparison|searchCandidates\(/)
    }
    for (const source of [authoritySource, analysisSource, prepareSource, analyzerSource]) expect(source).not.toMatch(/visitPlannerAlternativeCandidates|runPhase2C26B2C2ASearch|runPhase2C26B2C2ATask\(/)
    expect(runnerSource).not.toMatch(/for \(const task of tasks\)|tasks\.map\(task => runChild/)
  })
})
