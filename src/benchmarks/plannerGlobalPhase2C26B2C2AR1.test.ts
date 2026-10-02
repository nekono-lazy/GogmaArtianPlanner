import { describe, expect, it } from 'vitest'
import rawB2C2A from '../../docs/PLANNER_GLOBAL_PHASE2C26B2C2A_RESULT.json?raw'
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
import {
  parsePhase2C26B2C2AR1RetryManifest,
  selectPhase2C26B2C2AR1Tasks,
  PHASE2C26B2C2AR1_EXPECTED_RETRY_TASKS,
  PHASE2C26B2C2AR1_INHERITED,
  PHASE2C26B2C2AR1_RETRY,
  PHASE2C26B2C2AR1_SOURCE,
  type Phase2C26B2C2AR1RetryManifest,
} from './plannerGlobalPhase2C26B2C2AR1'
import searchSource from './plannerGlobalPhase2C26B2C2AR1.ts?raw'
import {
  parsePhase2C26B2C2AR1Authority,
  phase2c26b2c2ar1RetryManifest,
  phase2c26b2c2ar1TimeoutTaskIds,
  PHASE2C26B2C2AR1_REGISTERED_B2C2A,
  type Phase2C26B2C2AR1Authority,
  type Phase2C26B2C2AR1OriginalTaskRow,
} from './plannerGlobalPhase2C26B2C2AR1Authority'
import authoritySource from './plannerGlobalPhase2C26B2C2AR1Authority.ts?raw'
import {
  phase2c26b2c2ar1Decision,
  phase2c26b2c2ar1ReconstructionParity,
  runPhase2C26B2C2AR1Analysis,
  PHASE2C26B2C2AR1_DECISION_RULE,
} from './plannerGlobalPhase2C26B2C2AR1Analysis'
import analysisSource from './plannerGlobalPhase2C26B2C2AR1Analysis.ts?raw'
import prepareSource from '../../scripts/prepare-planner-global-phase2c26b2c2ar1-retry.mjs?raw'
import runnerSource from '../../scripts/run-planner-global-phase2c26b2c2ar1.mjs?raw'
import analyzerSource from '../../scripts/analyze-planner-global-phase2c26b2c2ar1.mjs?raw'
import b2c2aRunnerSource from '../../scripts/run-planner-global-phase2c26b2c2a.mjs?raw'

/*
 * Issue #154 Phase 2-C2.6-B2-C2A-R1: the B2-C2A timeout subset, searched again. The committed B2-C2A RESULT is read as the
 * registered authority; every other world below is synthetic. The oracle modules are never imported here (the Phase 2-A.5
 * isolation rule).
 */

const resultJson = JSON.parse(rawB2C2A)
const resultSha = PHASE2C26B2C2AR1_SOURCE.b2c2aResultSha256
const SHA = (c: string) => c.repeat(64)

// ---------------------------------------------------------------- the B2-C2A RESULT authority

describe('Phase 2-C2.6-B2-C2A-R1 authority', () => {
  it('accepts the committed formal B2-C2A RESULT and fails closed on any registered value', () => {
    const parsed = parsePhase2C26B2C2AR1Authority(resultJson, resultSha)
    expect(parsed.issues).toEqual([])
    const authority = parsed.authority!
    expect(authority.taskRows).toHaveLength(320)
    expect(authority.targets).toHaveLength(20)
    expect(authority.targetWeaponIds).toHaveLength(20)
    expect(authority.exactTargets).toEqual({ C8: 18, C32: 18, C4C: 20 })
    expect(authority.execution).toMatchObject({ tasks: 320, completed: 318, timeout: 2, outOfMemory: 0, processFailure: 0, contextMismatch: 0, notRun: 0 })
    expect(authority.targetManifestSha256).toBe(PHASE2C26B2C2AR1_SOURCE.targetManifestSha256)
    expect(parsePhase2C26B2C2AR1Authority(resultJson, SHA('0')).valid).toBe(false)
    const mutate = (patch: (j: typeof resultJson) => void) => { const copy = structuredClone(resultJson); patch(copy); return parsePhase2C26B2C2AR1Authority(copy, resultSha).valid }
    expect(mutate(() => undefined)).toBe(true)
    expect(mutate(j => { j.provenance.formal = false })).toBe(false)
    expect(mutate(j => { j.provenance.calculationCodeChangedSinceMeasuredHead = ['src/x.ts'] })).toBe(false)
    expect(mutate(j => { j.provenance.contextOrderingUsesOracle = true })).toBe(false)
    expect(mutate(j => { j.provenance.oracleReadBySearchChild = true })).toBe(false)
    expect(mutate(j => { j.provenance.oracleMatchUsedForEarlyStop = true })).toBe(false)
    expect(mutate(j => { j.provenance.oracleGuidedTargetPopulation = false })).toBe(false)
    expect(mutate(j => { j.provenance.targetManifestSha256 = SHA('1') })).toBe(false)
    expect(mutate(j => { j.decision.case = 'B2C2A_ALL_C4C' })).toBe(false)
    expect(mutate(j => { j.invalidReasons = ['x'] })).toBe(false)
    expect(mutate(j => { j.decision.reasons = ['x'] })).toBe(false)
    expect(mutate(j => { j.tasks.total = 319 })).toBe(false)
    expect(mutate(j => { j.aggregates.execution.completed = 317 })).toBe(false)
    expect(mutate(j => { j.aggregates.execution.timeout = 3 })).toBe(false)
    expect(mutate(j => { j.aggregates.execution.outOfMemory = 1 })).toBe(false)
    expect(mutate(j => { j.aggregates.execution.processFailure = 1 })).toBe(false)
    expect(mutate(j => { j.aggregates.execution.contextMismatch = 1 })).toBe(false)
    expect(mutate(j => { j.aggregates.exactTargets.C8 = 19 })).toBe(false)
    expect(mutate(j => { j.aggregates.exactTargets.C4C = 19 })).toBe(false)
    expect(mutate(j => { j.conditions.stage1.budgetMs = 1_800_000 })).toBe(false)
    expect(mutate(j => { j.conditions.candidateSafetyCap = 512 })).toBe(false)
    expect(mutate(j => { j.conditions.extent.maxGogmaAdvance = 300 })).toBe(false)
    expect(mutate(j => { j.taskRows.pop() })).toBe(false)
    expect(mutate(j => { j.taskRows[1].taskId = j.taskRows[0].taskId })).toBe(false)
    // An unmeasured row that is not a timeout, and a timeout row that carries Candidates, fail closed.
    expect(mutate(j => { j.taskRows.find((row: { process: string }) => row.process === 'timeout').process = 'out_of_memory' })).toBe(false)
    expect(mutate(j => { j.taskRows.find((row: { process: string }) => row.process === 'timeout').candidateCount = 4 })).toBe(false)
    expect(parsePhase2C26B2C2AR1Authority(null, resultSha).valid).toBe(false)
  })

  it('registers the B2-C2A counts and the provenance flags it requires', () => {
    expect(PHASE2C26B2C2AR1_REGISTERED_B2C2A).toMatchObject({ decisionCase: 'B2C2A_INCOMPLETE', tasks: 320, targets: 20,
      execution: { completed: 318, timeout: 2, outOfMemory: 0, processFailure: 0, contextMismatch: 0 }, exactTargets: { C8: 18, C32: 18, C4C: 20 },
      provenanceFlags: { oracleGuidedPolicySelection: true, oracleGuidedTargetPopulation: true, contextOrderingUsesOracle: false, oracleReadBySearchChild: false, oracleMatchUsedForEarlyStop: false } })
    expect(PHASE2C26B2C2AR1_EXPECTED_RETRY_TASKS).toBe(2)
  })
})

// ---------------------------------------------------------------- the timeout subset and the retry manifest

describe('Phase 2-C2.6-B2-C2A-R1 retry manifest', () => {
  const authority = parsePhase2C26B2C2AR1Authority(resultJson, resultSha).authority!

  it('takes exactly the rows with process = timeout and record = null, whatever their compatibility or coverage', () => {
    const ids = phase2c26b2c2ar1TimeoutTaskIds(authority.taskRows)
    expect(ids).toHaveLength(2)
    expect(ids).toEqual(authority.taskRows.filter(row => row.process === 'timeout' && row.record === null).map(row => row.taskId).sort())
    // Selection never reads compatibility, coverage, exact information, cost or route data.
    const scrambled = authority.taskRows.map(row => ({ ...row, compatible: !row.compatible, coverage: 'exact', firstExactIndex: 0, exactCount: 9, hit: { C8: true, C32: true, C4C: true },
      firstExactCost: 1, partialCount: 3 }))
    expect(phase2c26b2c2ar1TimeoutTaskIds(scrambled)).toEqual(ids)
    // A timeout row that holds a record is not selected; a non-timeout row never is.
    expect(phase2c26b2c2ar1TimeoutTaskIds([{ taskId: 't00-r01', process: 'timeout', record: 'searched' }, { taskId: 't00-r02', process: 'completed', record: null },
      { taskId: 't00-r03', process: 'out_of_memory', record: null }, { taskId: 't00-r04', process: 'timeout', record: null }])).toEqual(['t00-r04'])
    // The function body reads nothing post-hoc.
    const body = authoritySource.slice(authoritySource.indexOf('export function phase2c26b2c2ar1TimeoutTaskIds'), authoritySource.indexOf('/** The retry manifest:'))
    expect(body).not.toMatch(/compatible|coverage|exact|firstCompatible|routeKind|oracle|cost|rank/i)
  })

  it('writes task IDs and source hashes only, exactly what the retry runner accepts', () => {
    const manifest = phase2c26b2c2ar1RetryManifest(authority)
    expect(Object.keys(manifest).sort()).toEqual(['exportSha256', 'phase', 'sourceB2C2AResultSha256', 'sourceTargetManifestSha256', 'taskIds'])
    expect(manifest).toMatchObject({ sourceB2C2AResultSha256: resultSha, sourceTargetManifestSha256: PHASE2C26B2C2AR1_SOURCE.targetManifestSha256, exportSha256: authority.exportSha256,
      taskIds: phase2c26b2c2ar1TimeoutTaskIds(authority.taskRows) })
    expect(JSON.stringify({ ...manifest, phase: '' })).not.toMatch(/compatib|coverage|exact|oracle|firstCompatible|rank|candidate|stableKey|cost|fnv1a32|[0-9a-f]{8}-[0-9a-f]{4}-/i)
    expect(parsePhase2C26B2C2AR1RetryManifest(structuredClone(manifest))).toMatchObject({ valid: true, issues: [] })
    expect(() => phase2c26b2c2ar1RetryManifest({ ...authority, taskRows: authority.taskRows.map(row => row.process === 'timeout' ? row : { ...row, process: 'timeout', record: null }) })).toThrow(/not 2/)
  })

  it('fails closed on another count, a duplicate, an extra key or another source', () => {
    const manifest = phase2c26b2c2ar1RetryManifest(authority)
    const bad = (patch: (m: Record<string, unknown> & Phase2C26B2C2AR1RetryManifest) => void) => {
      const copy = structuredClone(manifest) as Record<string, unknown> & Phase2C26B2C2AR1RetryManifest
      patch(copy)
      return parsePhase2C26B2C2AR1RetryManifest(copy)
    }
    expect(bad(m => { m.taskIds = [m.taskIds[0]!, m.taskIds[0]!] }).issues.join()).toMatch(/repeats/)
    expect(bad(m => { m.taskIds = m.taskIds.slice(1) }).issues.join()).toMatch(/not 2/)
    expect(bad(m => { m.taskIds = [...m.taskIds, 't19-r16'] }).issues.join()).toMatch(/not 2/)
    expect(bad(m => { m.taskIds = [...m.taskIds].reverse() }).issues.join()).toMatch(/ascending/)
    expect(bad(m => { m.taskIds = ['x', 'y'] }).valid).toBe(false)
    expect(bad(m => { m.sourceB2C2AResultSha256 = SHA('0') }).issues.join()).toMatch(/registered B2-C2A RESULT/)
    expect(bad(m => { m.sourceTargetManifestSha256 = SHA('0') }).issues.join()).toMatch(/registered B2-C2A Target manifest/)
    expect(bad(m => { m.exportSha256 = 'x' }).valid).toBe(false)
    expect(bad(m => { m.compatible = [false, false] }).issues.join()).toMatch(/keys are not exactly/)
    expect(bad(m => { m.expectedCandidates = 0 }).valid).toBe(false)
    expect(parsePhase2C26B2C2AR1RetryManifest(null).valid).toBe(false)
  })
})

// ---------------------------------------------------------------- reconstruction and selection

/** A reconstructed task carrying exactly the identity of a B2-C2A row. */
const taskFromRow = (row: Phase2C26B2C2AR1OriginalTaskRow): Phase2C26B2C2ATaskInput => ({ taskId: row.taskId, executionClass: 'stage1', targetWeaponId: row.targetWeaponId,
  contextRank: row.contextRank, policy: 'P1', groupIndex: row.groupIndex, reservationDigest: row.reservationDigest, targetEligibleMinCardinality: row.targetEligibleMinCardinality,
  representativeFixedSetId: row.representativeFixedSetId, representativeFixedTargetWeaponIds: [...row.representativeFixedTargetWeaponIds], searchInputDigest: row.searchInputDigest,
  maxCostCohorts: PHASE2C26B2C2A_MAX_COST_COHORTS, candidateSafetyCap: PHASE2C26B2C2A_CANDIDATE_SAFETY_CAP })

describe('Phase 2-C2.6-B2-C2A-R1 reconstruction and retry selection', () => {
  const authority = parsePhase2C26B2C2AR1Authority(resultJson, resultSha).authority!
  const tasks = authority.taskRows.map(taskFromRow)
  const ids = phase2c26b2c2ar1TimeoutTaskIds(authority.taskRows)

  it('checks every reconstructed task against its B2-C2A row (all 320 task identities)', () => {
    expect(phase2c26b2c2ar1ReconstructionParity(tasks, authority.taskRows)).toEqual([])
    const drift = (key: keyof Phase2C26B2C2ATaskInput, value: unknown) => phase2c26b2c2ar1ReconstructionParity(tasks.map((t, i) => i === 7 ? { ...t, [key]: value } : t), authority.taskRows).join()
    expect(drift('searchInputDigest', 'other')).toMatch(/searchInputDigest differ/)
    expect(drift('reservationDigest', 'other')).toMatch(/reservationDigest differ/)
    expect(drift('groupIndex', 9999)).toMatch(/groupIndex differ/)
    expect(drift('representativeFixedTargetWeaponIds', [])).toMatch(/representativeFixedTargetWeaponIds differ/)
    expect(drift('targetEligibleMinCardinality', 7)).toMatch(/targetEligibleMinCardinality differ/)
    expect(phase2c26b2c2ar1ReconstructionParity(tasks.slice(1), authority.taskRows).join()).toMatch(/319 reconstructed tasks/)
  })

  it('selects exactly the retry tasks out of 320, unchanged, and fails closed otherwise', () => {
    const construction = { valid: true, issues: [], tasks }
    const selected = selectPhase2C26B2C2AR1Tasks(construction, ids)
    expect(selected.issues).toEqual([])
    expect(selected.tasks.map(t => t.taskId)).toEqual(ids)
    for (const task of selected.tasks) expect(task).toEqual(tasks.find(t => t.taskId === task.taskId))
    expect(selected.tasks.every(t => t.maxCostCohorts === 4 && t.candidateSafetyCap === 1024)).toBe(true)
    expect(selectPhase2C26B2C2AR1Tasks({ ...construction, valid: false, issues: ['x'] }, ids).issues.join()).toMatch(/not valid/)
    expect(selectPhase2C26B2C2AR1Tasks({ ...construction, tasks: tasks.slice(0, 319) }, ids).valid).toBe(false)
    expect(selectPhase2C26B2C2AR1Tasks({ ...construction, tasks: [...tasks.slice(0, 319), tasks[0]!] }, ids).issues.join()).toMatch(/repeats a task ID/)
    expect(selectPhase2C26B2C2AR1Tasks(construction, [ids[0]!]).issues.join()).toMatch(/1 retry tasks/)
    expect(selectPhase2C26B2C2AR1Tasks(construction, [ids[0]!, ids[0]!]).issues.join()).toMatch(/repeats/)
    expect(selectPhase2C26B2C2AR1Tasks(construction, [ids[0]!, 't99-r99']).issues.join()).toMatch(/0 reconstructed tasks/)
    expect(selectPhase2C26B2C2AR1Tasks(construction, ['t99-r98', 't99-r99']).tasks).toEqual([])
  })
})

// ---------------------------------------------------------------- the retry execution conditions

describe('Phase 2-C2.6-B2-C2A-R1 retry execution', () => {
  it('changes only the budget (30 minutes) and the concurrency (1) and inherits every Search / capture condition', () => {
    expect(PHASE2C26B2C2AR1_RETRY).toEqual({ executionClass: 'r1_retry', childHeapMb: 8192, concurrency: 1, budgetMs: 1_800_000, retry: 'none', fallback: 'none' })
    expect(PHASE2C26B2C2AR1_RETRY.childHeapMb).toBe(PHASE2C26B2C2A_STAGE1.childHeapMb)
    expect(PHASE2C26B2C2AR1_INHERITED).toEqual({ maxCostCohorts: 4, candidateSafetyCap: 1024, expectedTasks: 320, stage1HeapMb: 8192 })
    expect(defaultPlannerAlternativeSearchExtent).toEqual({ maxNormalAdvance: 4, maxGogmaAdvance: 235, maxSkillAdvance: 4 })
  })

  it('runs every retry task in the unchanged B2-C2A child, one at a time, with no second retry, fallback or early stop', () => {
    expect(runnerSource).toMatch(/const CHILD_SCRIPT_PATH = 'scripts\/run-planner-global-phase2c26b2c2a\.mjs'/)
    expect(runnerSource).toMatch(/runChild\('tasks', 'tasks', \{ targetWeaponIds: targets\.targetWeaponIds \}/)
    expect(runnerSource).toMatch(/runChild\(`r1-\$\{task\.taskId\}`, 'search', task,/)
    expect(runnerSource).toMatch(/for \(const task of retryTasks\) \{\s*const run = await runChild/)
    expect(runnerSource).toMatch(/selectPhase2C26B2C2AR1Tasks\(construction, retry\.taskIds\)/)
    expect(runnerSource).not.toMatch(/pool\(|Promise\.all\(|fallback\(|retryAgain|budgetMs \* 2|3_600_000|60 \* 60/)
    // The child is the B2-C2A Search child: its search role runs runPhase2C26B2C2ATask() and nothing else.
    expect(b2c2aRunnerSource).toMatch(/result = await c2a\.runPhase2C26B2C2ATask\(input, schedule, task, engine, \{ yieldControl: \(\) => new Promise\(done => \{ yields \+= 1; setImmediate\(done\) \}\) \}\)/)
    expect(b2c2aRunnerSource).toMatch(/const construction = c2a\.buildPhase2C26B2C2ATasks\(schedule, task\.targetWeaponIds\)/)
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

/** 16 ranks of one Target: rank 2 is compatible with an exact Candidate at index 3; ranks 4 and 6 timed out; the rest missed. */
const TIMEOUT_RANKS = [4, 6]
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
const COVERAGE = { top1: 0, top2: 1, top4: 1, top8: 1, top12: 1, top16: 1 }
function syntheticAuthority(patch: (a: Phase2C26B2C2AR1Authority) => void = () => undefined): Phase2C26B2C2AR1Authority {
  const first = { firstExactContextRank: 2, firstExactCandidateIndex: 3, firstExactOperationCost: 2 }
  const authority: Phase2C26B2C2AR1Authority = { resultSha256: PHASE2C26B2C2AR1_SOURCE.b2c2aResultSha256, measuredHead: 'a'.repeat(40), analysisHead: 'b'.repeat(40), benchmarkCodeSha256: SHA('c'),
    exportSha256: SHA('e'), targetManifestSha256: PHASE2C26B2C2AR1_SOURCE.targetManifestSha256, b2c1ResultSha256: SHA('1'), b2b1ResultSha256: SHA('2'), b2b2aResultSha256: SHA('3'),
    b2b2a2ResultSha256: SHA('4'), oracleResultSha256: SHA('5'), oracleManifestFileSha256: SHA('6'), oracleManifestRoutesSha256: SHA('7'), stage1: { ...PHASE2C26B2C2A_STAGE1 },
    execution: { tasks: 16, completed: 14, timeout: 2, outOfMemory: 0, processFailure: 0, contextMismatch: 0, notRun: 0 }, exactTargets: { C8: 1, C32: 1, C4C: 1 },
    budgetCoverage: { C8: { ...COVERAGE }, C32: { ...COVERAGE }, C4C: { ...COVERAGE } }, cascade: { c8: 1, c8MissC32: 0, c32MissC4C: 0, c4cMiss: 0 }, targetWeaponIds: [TARGET],
    taskRows: TASKS.map(originalRow),
    targets: [{ targetWeaponId: TARGET, b2c1FirstCompatibleRank: 2, policies: { C8: { ...first }, C32: { ...first }, C4C: { ...first } }, recovery: 'C8', missClass: null, safetyCapContexts: 0 }] }
  patch(authority)
  return authority
}
const MANIFEST: Phase2C26B2C2AR1RetryManifest = { phase: 'synthetic', sourceB2C2AResultSha256: PHASE2C26B2C2AR1_SOURCE.b2c2aResultSha256,
  sourceTargetManifestSha256: PHASE2C26B2C2AR1_SOURCE.targetManifestSha256, exportSha256: SHA('e'), taskIds: ['t00-r04', 't00-r06'] }
const SELECTED = TASKS.filter(t => TIMEOUT_RANKS.includes(t.contextRank))
const REACH: Phase2C26B2C2AReach[] = [{ targetWeaponId: TARGET, compatibleGroupIndexes: [102], p1FirstCompatibleRank: 2, inconsistencies: [] }]

function analyze(runs: Phase2C26B2C2ARun[], patch: { authority?: Phase2C26B2C2AR1Authority; manifest?: Phase2C26B2C2AR1RetryManifest; reach?: Phase2C26B2C2AReach[]; reference?: typeof REFERENCE; selected?: Phase2C26B2C2ATaskInput[] } = {}) {
  return runPhase2C26B2C2AR1Analysis({ authority: patch.authority ?? syntheticAuthority(), retryManifest: patch.manifest ?? MANIFEST, tasks: TASKS, selectedTasks: patch.selected ?? SELECTED, runs,
    reach: patch.reach ?? REACH, oracle: patch.reference ?? REFERENCE, oracleOperationCost: () => 2, smoke: false })
}

describe('Phase 2-C2.6-B2-C2A-R1 analysis', () => {
  it('overlays completed retry tasks onto the original rows without counting a task twice and reproduces the original aggregates first', () => {
    const result = analyze(SELECTED.map(t => runOf(t, miss(t))))
    expect(result.invalidReasons).toEqual([])
    expect(result.originalReproduction).toEqual({ exactTargets: true, budgetCoverage: true, cascade: true, targets: true })
    expect(result.overlay).toEqual({ original: { tasks: 16, measured: 14, timeout: 2 },
      retry: { selected: 2, runs: 2, measured: 2, timeout: 0, outOfMemory: 0, processFailure: 0, contextMismatch: 0, notRun: 0 },
      combined: { tasks: 16, measured: 16, unmeasured: 0, resolvedByRetry: 2, unresolved: 0 } })
    expect(result.combined.exactTargets).toEqual({ C8: 1, C32: 1, C4C: 1 })
    expect(result.combined.rows[0]).toMatchObject({ fullyMeasured: true, measuredContexts: 16, recovery: 'C8' })
    expect(result.original.rows[0]).toMatchObject({ fullyMeasured: false, measuredContexts: 14 })
    expect(result.decisionInput).toMatchObject({ retrySelected: 2, retryMeasured: 2, retryUnmeasured: 0, combined: { unmeasuredTasks: 0, exactTargets: { C8: 1, C32: 1, C4C: 1 } } })
    // Each retried context is compared with the unchanged B2-C2A comparison and recomputed compatibility.
    expect(result.retryContexts.map(c => ({ taskId: c.taskId, measured: c.measured, compatible: c.compatible, coverage: c.coverage }))).toEqual([
      { taskId: 't00-r04', measured: true, compatible: false, coverage: 'uncovered' }, { taskId: 't00-r06', measured: true, compatible: false, coverage: 'uncovered' }])
    expect(result.compatibilityParity.filter(p => p.recorded !== p.recomputed)).toEqual([])
  })

  it('keeps a retry timeout unmeasured (never Candidate 0) and counts it as unresolved', () => {
    const result = analyze([runOf(SELECTED[0]!, miss(SELECTED[0]!)), runOf(SELECTED[1]!, null, 'timeout')])
    expect(result.invalidReasons).toEqual([])
    expect(result.overlay.retry).toMatchObject({ measured: 1, timeout: 1 })
    expect(result.overlay.combined).toEqual({ tasks: 16, measured: 15, unmeasured: 1, resolvedByRetry: 1, unresolved: 1 })
    expect(result.retryContexts[1]).toMatchObject({ measured: false, candidateCount: null, coverage: null })
    expect(analyze([runOf(SELECTED[0]!, null, 'out_of_memory'), runOf(SELECTED[1]!, null, 'process_failure')]).overlay.retry).toMatchObject({ measured: 0, outOfMemory: 1, processFailure: 1 })
  })

  it('treats a safety-capped retry as measured with an incomplete capture', () => {
    const capped = (t: Phase2C26B2C2ATaskInput) => capture(t, [summary({ estimatedOperationCount: 1, sourceOwnedWeaponId: 'cheap' }), ...filler(PHASE2C26B2C2A_CANDIDATE_SAFETY_CAP - 1, 2)], 'candidate_safety_cap')
    const result = analyze(SELECTED.map(t => runOf(t, capped(t))))
    expect(result.invalidReasons).toEqual([])
    expect(result.retryContexts.every(c => c.measured && c.safetyCapHit === true && c.captureComplete === false && c.candidateCount === 1024)).toBe(true)
    expect(result.overlay.combined).toMatchObject({ measured: 16, unmeasured: 0 })
    // The Target already holds a C4C exact, so the safety cap does not make it undetermined.
    expect(result.combined.unresolvedSafetyCapTargets).toBe(0)
  })

  it('fails closed on a reservation violation, and on an exact or partial Candidate from a reservation-incompatible context', () => {
    const violating = miss(SELECTED[0]!)
    violating.candidates[2]!.reservationCheck = { respects: false, blockedHits: { gogma: [12] }, exclusiveHit: [] }
    expect(analyze([runOf(SELECTED[0]!, violating), runOf(SELECTED[1]!, miss(SELECTED[1]!))]).invalidReasons.join()).toMatch(/semantic_failure: t00-r04: 1 delivered Candidate\(s\) violate the reservation/)
    const exact = analyze([runOf(SELECTED[0]!, withMatchAt(SELECTED[0]!, 3)), runOf(SELECTED[1]!, miss(SELECTED[1]!))])
    expect(exact.invalidReasons.join()).toMatch(/semantic_failure: t00-r04: an exact Candidate from a reservation-incompatible context/)
    const partial = analyze([runOf(SELECTED[0]!, withMatchAt(SELECTED[0]!, 3)), runOf(SELECTED[1]!, miss(SELECTED[1]!))], { reference: PARTIAL_REFERENCE })
    expect(partial.retryContexts[0]).toMatchObject({ coverage: 'partial_comparable', exactIndexes: [] })
    expect(partial.invalidReasons.join()).toMatch(/semantic_failure: t00-r04: a partial Candidate from a reservation-incompatible context/)
  })

  it('fails closed on a compatibility parity mismatch, a first compatible drift and a retry selection that is not the timeout subset', () => {
    const runs = SELECTED.map(t => runOf(t, miss(t)))
    // B2-C2A recorded the timeout row as compatible, the recomputation says it is not.
    const recordedCompatible = syntheticAuthority(a => { a.taskRows.find(r => r.taskId === 't00-r04')!.compatible = true })
    expect(analyze(runs, { authority: recordedCompatible }).invalidReasons.join()).toMatch(/compatibility_parity: t00-r04: recomputed false, B2-C2A recorded true/)
    expect(analyze(runs, { reach: [{ ...REACH[0]!, p1FirstCompatibleRank: 3 }] }).invalidReasons.join()).toMatch(/authority: t1: recomputed P1 first compatible rank 3/)
    expect(analyze(runs, { reach: [{ ...REACH[0]!, compatibleGroupIndexes: [102, 104] }] }).invalidReasons.join()).toMatch(/compatibility_parity: t00-r04/)
    expect(analyze(runs, { manifest: { ...MANIFEST, taskIds: ['t00-r04', 't00-r05'] } }).invalidReasons.join()).toMatch(/retry_manifest: taskIds .* are not the B2-C2A timeout rows/)
    expect(analyze(runs, { manifest: { ...MANIFEST, sourceB2C2AResultSha256: SHA('0') } }).invalidReasons.join()).toMatch(/sourceB2C2AResultSha256 is not the authority/)
    expect(analyze(runs, { manifest: { ...MANIFEST, exportSha256: SHA('0') } }).invalidReasons.join()).toMatch(/exportSha256 is not the authority/)
    expect(analyze([...runs, runOf(TASKS[2]!, miss(TASKS[2]!))]).invalidReasons.join()).toMatch(/retry_run: t00-r03 is not a retry manifest task/)
    expect(analyze(runs, { selected: [SELECTED[1]!, SELECTED[0]!] }).invalidReasons.join()).toMatch(/retry_selection/)
    expect(analyze(runs, { selected: [SELECTED[0]!, { ...SELECTED[1]!, searchInputDigest: 'other' }] }).invalidReasons.join()).toMatch(/retry_selection: t00-r06 is not the reconstructed task/)
    // The original rows must reproduce the B2-C2A aggregates.
    expect(analyze(runs, { authority: syntheticAuthority(a => { a.exactTargets.C8 = 0 }) }).invalidReasons.join()).toMatch(/raw_result: the original rows do not reproduce the B2-C2A exactTargets/)
    expect(analyze(runs, { authority: syntheticAuthority(a => { a.targets[0]!.policies.C4C.firstExactCandidateIndex = 4 }) }).invalidReasons.join()).toMatch(/do not reproduce the B2-C2A targets/)
  })

  it('fails closed on a raw record drift or a context mismatch in a retry child', () => {
    const drift = miss(SELECTED[0]!)
    drift.extent = { ...drift.extent, maxGogmaAdvance: 300 }
    expect(analyze([runOf(SELECTED[0]!, drift), runOf(SELECTED[1]!, miss(SELECTED[1]!))]).invalidReasons.join()).toMatch(/raw: t00-r04: the extent is not the Production default/)
    const capRule = miss(SELECTED[0]!)
    capRule.candidateSafetyCap = 512
    expect(analyze([runOf(SELECTED[0]!, capRule), runOf(SELECTED[1]!, miss(SELECTED[1]!))]).invalidReasons.join()).toMatch(/capture rule drift/)
    const mismatch: Phase2C26B2C2ARun = { ...runOf(SELECTED[0]!, miss(SELECTED[0]!)), record: { status: 'context_mismatch', taskId: 't00-r04', issues: ['searchInputDigest'] } }
    mismatch.outcome = phase2c26b2c2aTaskOutcome('t00-r04', 'completed', mismatch.record)
    expect(analyze([mismatch, runOf(SELECTED[1]!, miss(SELECTED[1]!))]).invalidReasons.join()).toMatch(/context mismatch in the retry Search child/)
  })
})

// ---------------------------------------------------------------- decision

describe('Phase 2-C2.6-B2-C2A-R1 decision', () => {
  const decide = (patch: Partial<Parameters<typeof phase2c26b2c2ar1Decision>[0]> = {}, combined: Partial<Parameters<typeof phase2c26b2c2ar1Decision>[0]['combined']> = {}) =>
    phase2c26b2c2ar1Decision({ invalidReasons: [], retrySelected: 2, retryMeasured: 2, retryUnmeasured: 0, originalExactTargets: { C8: 18, C32: 18, C4C: 20 },
      ...patch, combined: { tasks: 320, targets: 20, unmeasuredTasks: 0, exactTargets: { C8: 18, C32: 18, C4C: 20 }, unresolvedSafetyCapTargets: 0, ...combined } })

  it('decides ALL_C4C when both retries measured, 320 / 320, C4C 20 and C32 < 20', () => {
    expect(decide()).toMatchObject({ case: 'B2C2AR1_ALL_C4C', reasons: [], combinedB2C2ACase: 'B2C2A_ALL_C4C' })
    expect(decide({}, { exactTargets: { C8: 19, C32: 20, C4C: 20 } }).case).toBe('B2C2AR1_ALL_C32')
    expect(decide({}, { exactTargets: { C8: 20, C32: 20, C4C: 20 } }).case).toBe('B2C2AR1_ALL_C8')
  })

  it('decides INCOMPLETE on a retry timeout / OOM / failure and INVALID on any invalid reason or inconsistency', () => {
    expect(decide({ retryMeasured: 1, retryUnmeasured: 1 }, { unmeasuredTasks: 1 }).case).toBe('B2C2AR1_INCOMPLETE')
    expect(decide({ retryMeasured: 0, retryUnmeasured: 2 }, { unmeasuredTasks: 2 }).case).toBe('B2C2AR1_INCOMPLETE')
    expect(decide({ invalidReasons: ['hash_chain: x'] }).case).toBe('B2C2AR1_INVALID')
    expect(decide({ retrySelected: 3, retryMeasured: 3 }).case).toBe('B2C2AR1_INVALID')
    expect(decide({ retryMeasured: 1, retryUnmeasured: 0 }).case).toBe('B2C2AR1_INVALID')
    // An unmeasured combined task that is not an unmeasured retry task, and a combined count below the original, are inconsistencies.
    expect(decide({}, { unmeasuredTasks: 1 }).case).toBe('B2C2AR1_INVALID')
    expect(decide({}, { exactTargets: { C8: 17, C32: 18, C4C: 20 } }).reasons).toContain('combined_C8_below_original')
    expect(decide({}, { tasks: 319 }).case).toBe('B2C2AR1_INVALID')
    // A combined PARTIAL contradicts the original C4C 20 / 20 authority.
    expect(decide({ originalExactTargets: { C8: 10, C32: 10, C4C: 19 } }, { exactTargets: { C8: 10, C32: 10, C4C: 19 } })).toMatchObject({ case: 'B2C2AR1_INVALID', combinedB2C2ACase: 'B2C2A_PARTIAL' })
    expect(PHASE2C26B2C2AR1_DECISION_RULE.order).toHaveLength(4)
  })
})

// ---------------------------------------------------------------- isolation

describe('Phase 2-C2.6-B2-C2A-R1 isolation', () => {
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

  it('keeps the oracle, compatibility and the B2-C2A RESULT out of the Search side: only the retry-manifest step and the analyzer read them', () => {
    for (const source of [searchSource, runnerSource]) {
      // The character classes keep these names out of this file's own text (the Phase 2-A.5 isolation test reads it).
      expect(source).not.toMatch(/ORACLE_[1]657|1657|--oracle|--manifest|--b2c2a-result|--b2c1-result|gogmaUsage|plannerGlobal[O]racle|_RESULT|phase2c2OracleCoverage|Analysis'|Authority'|firstCompatible|compatibleGroupIndexes|phase2c26b2aReachability|phase2c26b2c2aReach|\.compatible\b/)
    }
    expect(searchSource).not.toMatch(/plannerGlobalPhase2C26B2C2AR1Authority|plannerGlobalPhase2C26B2C2AR1Analysis|plannerGlobalPhase2C26B2C2AAnalysis|plannerGlobalPhase2C26B2C2ATargets/)
    expect(runnerSource).toMatch(/--retry/)
    expect(runnerSource).toMatch(/--targets/)
    expect(runnerSource).toMatch(/oracleGuidedPolicySelection: true, oracleGuidedTargetPopulation: true, contextOrderingUsesOracle: false, retrySelectionUsesOracle: false, oracleReadBySearchChild: false, oracleMatchUsedForEarlyStop: false/)
    expect(prepareSource).toMatch(/--b2c2a-result/)
    expect(prepareSource).not.toMatch(/--oracle|--manifest|visitPlannerAlternativeCandidates|\.compatible\b|compatibleGroupIndexes/)
    expect(analyzerSource).toMatch(/--oracle/)
    expect(analyzerSource).toMatch(/--b2c2a-result/)
    expect(analyzerSource).toMatch(/oracleGuidedPolicySelection: true, oracleGuidedTargetPopulation: true, contextOrderingUsesOracle: false, retrySelectionUsesOracle: false, oracleReadBySearchChild: false,\s*oracleMatchUsedForEarlyStop: false/)
    // The analysis reuses the B2-C2A authorities; it never re-implements oracle matching or compatibility.
    expect(analysisSource).toMatch(/phase2c26b2c2aCompareContext\(/)
    expect(analysisSource).toMatch(/phase2c26b2c2aTargetRow\(/)
    expect(analysisSource).toMatch(/validatePhase2C26B2C2ARaw\(/)
    expect(analysisSource).toMatch(/phase2c26b2c2aDecision\(/)
    expect(analyzerSource).toMatch(/c2aAnalysis\.phase2c26b2c2aReach\(/)
    expect(analysisSource).not.toMatch(/from '\.\/plannerGlobalPhase2C2Analysis'|from '\.\/plannerGlobalPhase2C26B2AAnalysis'|matchOracleRoute\(|phase2c26b2aReachability\(/)
  })

  it('runs no Search, kernel or Planner outside the unchanged B2-C2A child, and never re-runs the original tasks', () => {
    for (const source of [searchSource, authoritySource, analysisSource, prepareSource, runnerSource, analyzerSource]) {
      expect(source).not.toMatch(/runPreparedPlannerAlternativeKernel|preparePlannerAlternativeKernel|createProductionPlan|runPhase2C2Kernel|runPhase2C2Baseline|runPlannerDeterministicSchedule|createPlannerAlternativeWhatIfComparison|searchCandidates\(/)
    }
    for (const source of [authoritySource, analysisSource, prepareSource, analyzerSource]) expect(source).not.toMatch(/visitPlannerAlternativeCandidates|runPhase2C26B2C2ASearch|runPhase2C26B2C2ATask\(/)
    // Only the selected retry tasks reach a search child.
    expect(runnerSource).toMatch(/const retryTasks = smokeTaskIds !== null \? selection\.tasks\.filter\(t => smokeTaskIds\.includes\(t\.taskId\)\) : selection\.tasks/)
    expect(runnerSource).not.toMatch(/for \(const task of tasks\)|tasks\.map\(task => runChild/)
  })
})
