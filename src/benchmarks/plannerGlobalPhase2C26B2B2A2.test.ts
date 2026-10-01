import { beforeEach, describe, expect, it, vi } from 'vitest'
import rawB2B2A from '../../docs/PLANNER_GLOBAL_PHASE2C26B2B2A_RESULT.json?raw'
import { hashStableValue } from '../domain/models/hashing'
import type { TargetWeapon } from '../domain/models/publicTypes'
import { createPlannerStartSearchOrigin } from '../domain/planner/replacement/plannerSearchOrigin'
import { defaultPlannerAlternativeSearchExtent, type PlannerAlternativeCandidate, type PlannerAlternativeSearchExecution } from '../domain/search'
import { belowPracticalBonuses, idealBonuses } from '../test/fixtures/constrainedEnumeration'
import {
  ORCHESTRATION_SOURCE_A,
  ORCHESTRATION_SOURCE_B,
  orchestrationEntry,
  orchestrationScenario,
  orchestrationSource,
  orchestrationTarget,
  resetRoute,
  resetSkillsRoute,
  skillConstrainedTarget,
} from '../test/fixtures/plannerConstrainedOrchestration'
import { globalResearchDependencies } from './plannerGlobalOptimizationResearch'
import type { Phase2C2CandidateSummary } from './plannerGlobalPhase2C2'
import { phase2c26b2aReservationRanges } from './plannerGlobalPhase2C26B2AAnalysis'
import { derivePhase2C26B2B1Snapshot, type Phase2C26B2B1Snapshot } from './plannerGlobalPhase2C26B2B1'
import { reconstructPhase2C26B2B2AContext, type Phase2C26B2B2AContext } from './plannerGlobalPhase2C26B2B2A'
import {
  comparePhase2C26B2B2A2RowReconstruction,
  parsePhase2C26B2B2A2B2B2AAuthority,
  phase2c26b2b2a2NeedsFallback,
  phase2c26b2b2a2TaskInput,
  phase2c26b2b2a2TaskOutcome,
  runPhase2C26B2B2A2Search,
  runPhase2C26B2B2A2Task,
  selectPhase2C26B2B2A2Tasks,
  PHASE2C26B2B2A2_COHORT_SAFETY_CAP,
  PHASE2C26B2B2A2_FALLBACK,
  PHASE2C26B2B2A2_PRIOR_PREFIX_LENGTH,
  PHASE2C26B2B2A2_REGISTERED_B2B2A,
  PHASE2C26B2B2A2_STAGE1,
  type Phase2C26B2B2A2Authority,
  type Phase2C26B2B2A2AuthorityRow,
  type Phase2C26B2B2A2DeliveredCandidate,
  type Phase2C26B2B2A2SearchRecord,
  type Phase2C26B2B2A2Selection,
  type Phase2C26B2B2A2TaskInput,
} from './plannerGlobalPhase2C26B2B2A2'
import calculationSource from './plannerGlobalPhase2C26B2B2A2.ts?raw'
import {
  phase2c26b2b2a2Compare,
  phase2c26b2b2a2Decision,
  phase2c26b2b2a2FinalOutcomes,
  phase2c26b2b2a2FirstDecidingKey,
  phase2c26b2b2a2PrefixParity,
  runPhase2C26B2B2A2Analysis,
  validatePhase2C26B2B2A2Raw,
  PHASE2C26B2B2A2_DECISION_RULE,
  type Phase2C26B2B2A2Run,
} from './plannerGlobalPhase2C26B2B2A2Analysis'
import analysisSource from './plannerGlobalPhase2C26B2B2A2Analysis.ts?raw'
import runnerSource from '../../scripts/run-planner-global-phase2c26b2b2a2.mjs?raw'
import analyzerSource from '../../scripts/analyze-planner-global-phase2c26b2b2a2.mjs?raw'

/*
 * Issue #154 Phase 2-C2.6-B2-B2A2: boundary operation-cost cohort drain. The synthetic worlds below are invented for the
 * tests; the committed B2-B2A RESULT is read only to check the task-selection authority. The oracle modules are never
 * imported here (the Phase 2-A.5 isolation rule).
 */

/**
 * Every Search input, in call order. `script` (a list of operation costs) makes the Search hand the visitor its first
 * real Candidate once per entry with that `estimatedOperationCount`, then end `exhausted` (or by extent); every visitor
 * decision is recorded.
 */
const searchCalls = vi.hoisted(() => ({ inputs: [] as unknown[], script: null as number[] | null, endByExtent: false, decisions: [] as string[] }))
vi.mock('../domain/search/alternative/plannerAlternativeSearch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../domain/search/alternative/plannerAlternativeSearch')>()
  return {
    ...actual,
    visitPlannerAlternativeCandidates: async (...args: Parameters<typeof actual.visitPlannerAlternativeCandidates>): Promise<PlannerAlternativeSearchExecution> => {
      const [input, engine, onCandidate, options] = args
      searchCalls.inputs.push(structuredClone(input))
      const script = searchCalls.script
      if (script === null) {
        return actual.visitPlannerAlternativeCandidates(input, engine, async candidate => { const d = await onCandidate(candidate); searchCalls.decisions.push(d); return d }, options)
      }
      let first: PlannerAlternativeCandidate | null = null
      await actual.visitPlannerAlternativeCandidates(input, engine, candidate => { first = candidate; return 'stop' }, options)
      if (first === null) throw new Error('The script world delivers no Candidate.')
      const base: PlannerAlternativeCandidate = first
      for (let index = 0; index < script.length; index += 1) {
        const d = await onCandidate({ ...base, estimatedOperationCount: script[index]! })
        searchCalls.decisions.push(d)
        if (d === 'stop') return { targetWeaponId: input.targetWeaponId, summary: { deliveredCandidates: index + 1, excludedCandidates: 0, exhausted: false, stoppedByExtent: false }, stoppedByConsumer: true, skippedExcludedRouteKeys: [] }
      }
      return { targetWeaponId: input.targetWeaponId, summary: { deliveredCandidates: script.length, excludedCandidates: 0, exhausted: !searchCalls.endByExtent, stoppedByExtent: searchCalls.endByExtent },
        stoppedByConsumer: false, skippedExcludedRouteKeys: [] }
    },
  }
})
beforeEach(() => { searchCalls.inputs = []; searchCalls.script = null; searchCalls.endByExtent = false; searchCalls.decisions = [] })

const digest = (value: string) => hashStableValue(value)
const b2b2aJson = JSON.parse(rawB2B2A)
const registeredSha = PHASE2C26B2B2A2_REGISTERED_B2B2A.resultSha256

// ---------------------------------------------------------------- the B2-B2A RESULT (task-selection authority)

describe('Phase 2-C2.6-B2-B2A2 B2-B2A authority and task selection', () => {
  it('accepts the committed formal B2-B2A RESULT and fails closed on any registered value', () => {
    const parsed = parsePhase2C26B2B2A2B2B2AAuthority(b2b2aJson, registeredSha)
    expect(parsed.issues).toEqual([])
    expect(parsed.authority!.rows).toHaveLength(20)
    expect(parsed.authority!.extent).toEqual(defaultPlannerAlternativeSearchExtent)
    expect(parsed.authority!.b2b1ResultSha256).toBe(PHASE2C26B2B2A2_REGISTERED_B2B2A.b2b1ResultSha256)
    expect(parsePhase2C26B2B2A2B2B2AAuthority(b2b2aJson, '0'.repeat(64)).valid).toBe(false)
    const mutate = (patch: (j: typeof b2b2aJson) => void) => { const copy = structuredClone(b2b2aJson); patch(copy); return parsePhase2C26B2B2A2B2B2AAuthority(copy, registeredSha).valid }
    expect(mutate(j => { j.provenance.formal = false })).toBe(false)
    expect(mutate(j => { j.provenance.calculationCodeChangedSinceMeasuredHead = ['src/x.ts'] })).toBe(false)
    expect(mutate(j => { j.decision.case = 'B2B2A_ALL_EXACT' })).toBe(false)
    expect(mutate(j => { j.invalidReasons = ['x'] })).toBe(false)
    for (const field of ['targets', 'measured', 'exact', 'partial', 'capture_or_ordering_unresolved', 'completed_without_oracle_match', 'unmeasured'] as const) {
      expect(mutate(j => { j.aggregates.all[field] += 1 })).toBe(false)
    }
    expect(mutate(j => { j.aggregates.diversity.reservationViolations = 1 })).toBe(false)
    expect(mutate(j => { j.conditions.captureBound = 64 })).toBe(false)
    expect(mutate(j => { j.conditions.extent.maxGogmaAdvance = 236 })).toBe(false)
    expect(mutate(j => { j.parity.hashChain.exportMatchesOracle = false })).toBe(false)
    expect(mutate(j => { j.parity.reconstruction[0].matches = false })).toBe(false)
    expect(mutate(j => { j.provenance.oracleResultSha256RecordedByB2B1 = '0'.repeat(64) })).toBe(false)
    expect(mutate(j => { j.provenance.oracleManifestRoutesSha256RecordedByB2B1 = '0'.repeat(64) })).toBe(false)
    expect(mutate(j => { j.provenance.b2b1ResultSha256 = '0'.repeat(64) })).toBe(false)
    expect(mutate(j => { j.provenance.oracleReadBySearchRunner = true })).toBe(false)
    expect(mutate(j => { j.rows.pop() })).toBe(false)
    expect(mutate(j => { j.rows[0].search.candidates[3].deliveryIndex = 9 })).toBe(false)
    expect(parsePhase2C26B2B2A2B2B2AAuthority(null, registeredSha).valid).toBe(false)
  })

  it('selects exactly the capture_or_ordering_unresolved rows, deriving each boundary cost from its own index 31', () => {
    const authority = parsePhase2C26B2B2A2B2B2AAuthority(b2b2aJson, registeredSha).authority!
    const selection = selectPhase2C26B2B2A2Tasks(authority)
    expect(selection.issues).toEqual([])
    const unresolved = authority.rows.filter(r => r.deliveryClass === 'capture_or_ordering_unresolved').map(r => r.targetWeaponId).sort()
    expect(selection.selections.map(s => s.targetWeaponId)).toEqual(unresolved)
    expect(selection.selections).toHaveLength(PHASE2C26B2B2A2_REGISTERED_B2B2A.all.capture_or_ordering_unresolved)
    for (const s of selection.selections) {
      const row = authority.rows.find(r => r.targetWeaponId === s.targetWeaponId)!
      expect(s.boundaryCost).toBe(row.candidates[31]!.estimatedOperationCount)
      expect(s.priorPrefix).toHaveLength(PHASE2C26B2B2A2_PRIOR_PREFIX_LENGTH)
      expect(s).toMatchObject({ fixedSetId: row.fixedSetId, reservationDigest: row.reservationDigest, searchInputDigest: row.searchInputDigest, b2b2aTaskId: row.taskId })
    }
    // In this RESULT both boundary costs are 2: index 0 costs 1, indexes 1..31 cost 2.
    expect(selection.selections.map(s => s.boundaryCost)).toEqual([2, 2])
    const drift = (patch: (a: Phase2C26B2B2A2Authority, rows: Phase2C26B2B2A2AuthorityRow[]) => void) => {
      const copy = structuredClone(authority)
      patch(copy, copy.rows.filter(r => r.deliveryClass === 'capture_or_ordering_unresolved').sort((a, b) => a.targetWeaponId < b.targetWeaponId ? -1 : 1))
      return selectPhase2C26B2B2A2Tasks(copy)
    }
    // The boundary is index 31's own cost: a dearer index 31 moves it (still nondecreasing).
    expect(drift((_, [row]) => { row!.candidates[31]!.estimatedOperationCount = 3 }).selections[0]!.boundaryCost).toBe(3)
    expect(drift((_, [row]) => { row!.candidates[5]!.estimatedOperationCount = 3 }).issues.join()).toMatch(/nondecreasing/)
    expect(drift((_, [row]) => { row!.searchStatus = 'exhausted' }).valid).toBe(false)
    expect(drift((_, [row]) => { row!.delivered = 31 }).valid).toBe(false)
    expect(drift((_, [row]) => { row!.candidates.pop() }).valid).toBe(false)
    expect(drift((_, [row]) => { row!.coverage = 'partial_comparable' }).valid).toBe(false)
    expect(drift((_, [row]) => { row!.exactDeliveryIndexes = [4] }).valid).toBe(false)
    expect(drift((_, [row]) => { row!.candidates[2]!.respectsReservation = false }).valid).toBe(false)
    expect(drift(a => { a.rows.find(r => r.deliveryClass === 'exact')!.deliveryClass = 'capture_or_ordering_unresolved' }).issues.join()).toMatch(/not 2/)
    expect(drift((_, [row]) => { row!.deliveryClass = 'exact' }).issues.join()).toMatch(/not 2/)
  })
})

// ---------------------------------------------------------------- a synthetic world

const SOURCE_A_SKILL = 'series_skill.fixture.z'
const SOURCE_B_SKILL = 'series_skill.fixture.b-source'

function world() {
  const skill = { seriesSkillId: SOURCE_A_SKILL, groupSkillId: null, matchMode: 'all' as const }
  const a: TargetWeapon = orchestrationTarget('target.b2b2a2.a', { priority: 5, idealSkillCondition: skill, practicalSkillCondition: skill })
  const b = skillConstrainedTarget('target.b2b2a2.b', { priority: 1 })
  const built = orchestrationScenario({
    engine: { gogmaPositions: defaultPlannerAlternativeSearchExtent.maxGogmaAdvance + 8, skillPositions: defaultPlannerAlternativeSearchExtent.maxSkillAdvance + 8 },
    targets: [a, b],
    ownedWeapons: [orchestrationSource(ORCHESTRATION_SOURCE_A, { seriesSkillId: SOURCE_A_SKILL }),
      orchestrationSource(ORCHESTRATION_SOURCE_B, { restorationBonuses: belowPracticalBonuses(), seriesSkillId: SOURCE_B_SKILL })],
    entries: [
      orchestrationEntry('build-list.b2b2a2.a', a, resetRoute(ORCHESTRATION_SOURCE_A), { finalBonuses: idealBonuses(), seriesSkillId: SOURCE_A_SKILL }),
      orchestrationEntry('build-list.b2b2a2.b', b, { kind: 'existing_gogma_mixed', sourceOwnedWeaponId: resetRoute(ORCHESTRATION_SOURCE_B).sourceOwnedWeaponId,
        operations: [...resetRoute(ORCHESTRATION_SOURCE_B).operations, ...resetSkillsRoute(ORCHESTRATION_SOURCE_B).operations] }),
    ],
  })
  const snapshot = derivePhase2C26B2B1Snapshot(built.input, globalResearchDependencies(built.engine))
  return { built, snapshot }
}

function contextOf(snapshot: Phase2C26B2B1Snapshot, targetWeaponId = 'target.b2b2a2.b'): Phase2C26B2B2AContext {
  const target = snapshot.targets.find(t => t.targetWeaponId === targetWeaponId)!
  const row = snapshot.fixedSets.find(fs => fs.valid && fs.cardinality === 1 && !fs.fixedBuildListEntryIds.includes(target.currentBuildListEntryId))!
  const rebuilt = reconstructPhase2C26B2B2AContext(snapshot, { targetWeaponId, fixedSetId: row.fixedSetId, cardinality: 1, reservationDigest: snapshot.reservationGroups[row.reservationGroupIndex!]!.reservationDigest })
  if (!rebuilt.valid) throw new Error(rebuilt.issues.join())
  return rebuilt.context
}

const ranges = (context: Phase2C26B2B2AContext) => phase2c26b2aReservationRanges(context.reservation)

function rowOf(context: Phase2C26B2B2AContext): Phase2C26B2B2A2AuthorityRow {
  return { taskId: 't06', targetWeaponId: context.targetWeaponId, population: 'newly_recovered_default_extent', cardinality: context.cardinality, fixedSetId: context.fixedSetId,
    fixedTargetWeaponIds: [...context.fixedTargetWeaponIds], groupIndex: context.groupIndex, reservationDigest: context.reservationDigest, searchInputDigest: context.searchInputDigest,
    excludedRouteKeySha256: digest(context.excludedRouteKeys[0]!), extent: { ...context.extent }, reservation: ranges(context), searchStatus: 'consumer_stop', delivered: 32, candidates: [],
    deliveryClass: 'capture_or_ordering_unresolved', coverage: 'uncovered', exactDeliveryIndexes: [], partialDeliveryIndexes: [] }
}

describe('Phase 2-C2.6-B2-B2A2 reconstruction against the B2-B2A row', () => {
  it('matches the row it came from and names every drifting field', () => {
    const { snapshot } = world()
    const context = contextOf(snapshot)
    expect(comparePhase2C26B2B2A2RowReconstruction(context, rowOf(context), digest, ranges)).toEqual({ targetWeaponId: context.targetWeaponId, matches: true, mismatches: [] })
    const check = (patch: (row: Phase2C26B2B2A2AuthorityRow) => void) => { const row = rowOf(context); patch(row); return comparePhase2C26B2B2A2RowReconstruction(context, row, digest, ranges).mismatches }
    expect(check(r => { r.fixedSetId = 'K1:x' })).toEqual(['fixedSetId'])
    expect(check(r => { r.fixedTargetWeaponIds = ['x'] })).toEqual(['fixedTargetWeaponIds'])
    expect(check(r => { r.groupIndex += 1 })).toEqual(['groupIndex'])
    expect(check(r => { r.reservationDigest = 'x' })).toEqual(['reservationDigest'])
    expect(check(r => { r.reservation = null })).toEqual(['reservation'])
    expect(check(r => { r.searchInputDigest = 'x' })).toEqual(['searchInputDigest'])
    expect(check(r => { r.excludedRouteKeySha256 = 'x' })).toEqual(['excludedRouteKey'])
    expect(check(r => { r.extent = { ...defaultPlannerAlternativeSearchExtent, maxGogmaAdvance: 300 } })).toEqual(['extent'])
    expect(check(r => { r.cardinality = 2 })).toEqual(['cardinality'])
  })
})

// ---------------------------------------------------------------- the Search child

const BOUNDS = { boundaryCost: 2, cohortSafetyCap: PHASE2C26B2B2A2_COHORT_SAFETY_CAP }

describe('Phase 2-C2.6-B2-B2A2 cohort drain', () => {
  it('gives visitPlannerAlternativeCandidates() exactly the rebuilt origin, reservation, exclusion and default extent, and drains to the natural end', async () => {
    const { built, snapshot } = world()
    const context = contextOf(snapshot)
    const record = await runPhase2C26B2B2A2Search(built.input, context, built.engine, { boundaryCost: 1000, cohortSafetyCap: PHASE2C26B2B2A2_COHORT_SAFETY_CAP }, { now: () => 0 })
    expect(searchCalls.inputs).toEqual([{ origin: createPlannerStartSearchOrigin(built.input), targetWeaponId: 'target.b2b2a2.b', extent: { ...defaultPlannerAlternativeSearchExtent },
      reservation: context.reservation, excludedRouteKeys: context.excludedRouteKeys }])
    expect(record.cohort.length).toBeGreaterThan(1)
    expect(searchCalls.decisions.every(d => d === 'continue')).toBe(true)
    expect(record).toMatchObject({ nextCostSentinel: null, cohortDrained: true, safetyCapHit: false, costReadIssues: [] })
    expect(['exhausted', 'stopped_by_extent']).toContain(record.termination)
    expect(record.termination).toBe(record.status)
    // The real delivery sequence passes the raw checks: the recorded comparator says "earlier first" every time and agrees with the six keys.
    expect(record.cohort.slice(1).every(c => c.comparatorWithPrevious === -1)).toBe(true)
    expect(record.cohort.slice(1).every((c, i) => phase2c26b2b2aSign(record.cohort[i]!, c) === -1)).toBe(true)
    const task = { ...phase2c26b2b2a2TaskInput('t00', 'stage1', context, 1000) }
    const run = runOf(record, task)
    expect(validatePhase2C26B2B2A2Raw({ selections: [selectionOf(context, 1000)], tasks: [task], stage1: [run], fallback: [], smoke: false })).toEqual([])
  })

  it('continues while a delivery costs at most the boundary and stops at the first dearer one (the sentinel, outside the cohort)', async () => {
    const { built, snapshot } = world()
    const context = contextOf(snapshot)
    searchCalls.script = [1, 2, 2, 2, 2, 3, 3, 4]
    const record = await runPhase2C26B2B2A2Search(built.input, context, built.engine, BOUNDS, { now: () => 0 })
    expect(searchCalls.decisions).toEqual(['continue', 'continue', 'continue', 'continue', 'continue', 'stop'])
    expect(record.cohort.map(c => c.orderingKeys.estimatedOperationCount)).toEqual([1, 2, 2, 2, 2])
    expect(record.nextCostSentinel).toMatchObject({ deliveryIndex: 5, orderingKeys: { estimatedOperationCount: 3 } })
    expect(record).toMatchObject({ termination: 'next_cost_sentinel', status: 'consumer_stop', cohortDrained: true, safetyCapHit: false })
    expect(record.summary.deliveredCandidates).toBe(6)
  })

  it('treats a natural end before any dearer Candidate as drained, and records how it ended', async () => {
    const { built, snapshot } = world()
    const context = contextOf(snapshot)
    searchCalls.script = [1, 2, 2]
    const exhausted = await runPhase2C26B2B2A2Search(built.input, context, built.engine, BOUNDS)
    expect(exhausted).toMatchObject({ termination: 'exhausted', cohortDrained: true, nextCostSentinel: null })
    searchCalls.script = [2, 2]
    searchCalls.endByExtent = true
    const byExtent = await runPhase2C26B2B2A2Search(built.input, context, built.engine, BOUNDS)
    expect(byExtent).toMatchObject({ termination: 'stopped_by_extent', cohortDrained: true })
  })

  it('stops at the safety cap without claiming a drained cohort, and never stops for any other reason', async () => {
    const { built, snapshot } = world()
    const context = contextOf(snapshot)
    searchCalls.script = Array(PHASE2C26B2B2A2_COHORT_SAFETY_CAP + 5).fill(2)
    const record = await runPhase2C26B2B2A2Search(built.input, context, built.engine, BOUNDS)
    expect(searchCalls.decisions).toHaveLength(PHASE2C26B2B2A2_COHORT_SAFETY_CAP)
    expect(searchCalls.decisions.slice(0, -1).every(d => d === 'continue')).toBe(true)
    expect(searchCalls.decisions.at(-1)).toBe('stop')
    expect(record).toMatchObject({ termination: 'cohort_safety_cap', cohortDrained: false, safetyCapHit: true, nextCostSentinel: null })
    expect(record.cohort).toHaveLength(PHASE2C26B2B2A2_COHORT_SAFETY_CAP)
    await expect(runPhase2C26B2B2A2Search(built.input, context, built.engine, { boundaryCost: 2, cohortSafetyCap: 64 })).rejects.toThrow(/safety cap/)
    await expect(runPhase2C26B2B2A2Search(built.input, { ...context, extent: { ...context.extent, maxGogmaAdvance: 300 } }, built.engine, BOUNDS)).rejects.toThrow(/default extent/)
  }, 120_000)

  it('re-derives the context in the child (no oracle field in the task) and reports a drift as a context mismatch without searching', async () => {
    const { built, snapshot } = world()
    const context = contextOf(snapshot)
    const task = phase2c26b2b2a2TaskInput('t00', 'stage1', context, 2)
    expect(Object.keys(task).sort()).toEqual(['boundaryCost', 'cardinality', 'cohortSafetyCap', 'executionClass', 'fixedSetId', 'reservationDigest', 'searchInputDigest', 'targetWeaponId', 'taskId'])
    searchCalls.script = [1, 2, 3]
    const ok = await runPhase2C26B2B2A2Task(built.input, snapshot, task, built.engine)
    expect(ok).toMatchObject({ status: 'searched', search: { termination: 'next_cost_sentinel' } })
    searchCalls.inputs = []
    expect(await runPhase2C26B2B2A2Task(built.input, snapshot, { ...task, searchInputDigest: 'other' }, built.engine)).toMatchObject({ status: 'context_mismatch', issues: ['searchInputDigest'] })
    expect(await runPhase2C26B2B2A2Task(built.input, snapshot, { ...task, fixedSetId: 'K1:none' }, built.engine)).toMatchObject({ status: 'context_mismatch', issues: ['fixed_set_not_in_snapshot'] })
    expect(searchCalls.inputs).toEqual([])
  })

  it('records a timeout / out of memory / failure as that failure and falls back on a timeout only', () => {
    expect(phase2c26b2b2a2TaskOutcome('t', 'stage1', 'timeout', null)).toEqual({ taskId: 't', executionClass: 'stage1', process: 'timeout', record: null, searchStatus: null, termination: null, cohortCandidates: null })
    expect(phase2c26b2b2a2TaskOutcome('t', 'stage1', 'completed', null).process).toBe('process_failure')
    expect(phase2c26b2b2a2NeedsFallback({ process: 'timeout' })).toBe(true)
    for (const process of ['completed', 'out_of_memory', 'process_failure'] as const) expect(phase2c26b2b2a2NeedsFallback({ process })).toBe(false)
    expect(PHASE2C26B2B2A2_STAGE1).toMatchObject({ childHeapMb: 8192, concurrency: 1, budgetMs: 1_800_000, retry: 'none' })
    expect(PHASE2C26B2B2A2_FALLBACK).toMatchObject({ trigger: 'timeout', childHeapMb: 8192, concurrency: 1, budgetMs: 3_600_000, runs: 1 })
    expect(PHASE2C26B2B2A2_COHORT_SAFETY_CAP).toBe(8192)
  })
})

// ---------------------------------------------------------------- analysis

const phase2c26b2b2aSign = (a: Phase2C26B2B2A2DeliveredCandidate, b: Phase2C26B2B2A2DeliveredCandidate) => phase2c26b2b2a2FirstDecidingKey(a, b).sign

const TARGET = 't1'
function summary(patch: Partial<Phase2C2CandidateSummary> = {}): Phase2C2CandidateSummary {
  return { targetWeaponId: TARGET, routeKind: 'existing_gogma_reset_bonuses', sourceKind: 'owned_gogma', sourceOwnedWeaponId: 'w1', estimatedOperationCount: 2,
    estimatedAdvances: { normal: null, gogma: 1, skill: 0 }, ownOperationCount: 2, operationTypes: { reset_bonuses: 2 }, normalCounterId: null, normalProductionTargetPosition: null,
    blindNormalCreation: false, conversionSkillPosition: null, normal: null,
    gogma: { first: 1, last: 2, operations: 2, positions: [[1, 2]], required: [2], crossesHeldPositions: false, startsAfterOrigin: false }, skill: null,
    gogmaTypeRuns: [[1, 2, 'reset_bonuses']], heldRoute: false, finalBonuses: [], restorationBonusScope: 'gogma_artian', seriesSkillId: null, groupSkillId: null, ...patch }
}
/** The oracle Route: owned w2, Gogma 11 and 13 (held 12), two operations. */
const ORACLE_ROUTE = { targetWeaponId: TARGET, sourceKind: 'owned', sourceOwnedWeaponId: 'w2', normalPosition: null, conversionPosition: null, normal: { first: null, last: null, operations: 0 },
  gogma: { first: 11, last: 13, operations: 2, required: [13] }, skill: { first: null, last: null, operations: 0, required: [] }, routeOperationCount: 2,
  finalBonuses: [], finalScope: 'gogma_artian', finalSeriesSkillId: null, finalGroupSkillId: null,
  materialization: { method: 'planner_alternative_search', routeKind: 'existing_gogma_reset_bonuses', estimated: { operations: 2, normal: null, gogma: 13, skill: 0 } } }
const ORACLE_USAGE = [{ position: 11, targetWeaponId: TARGET, type: 'reset_bonuses', required: false }, { position: 13, targetWeaponId: TARGET, type: 'reset_bonuses', required: true }]
const MATCH = summary({ sourceOwnedWeaponId: 'w2', estimatedAdvances: { normal: null, gogma: 13, skill: 0 },
  gogma: { first: 11, last: 13, operations: 2, positions: [[11, 11], [13, 13]], required: [13], crossesHeldPositions: true, startsAfterOrigin: true },
  gogmaTypeRuns: [[11, 11, 'reset_bonuses'], [13, 13, 'reset_bonuses']], heldRoute: true })
const ORACLE = { routes: [ORACLE_ROUTE], gogmaUsage: ORACLE_USAGE }

const TASK: Phase2C26B2B2A2TaskInput = { taskId: 't00', executionClass: 'stage1', targetWeaponId: TARGET, fixedSetId: 'K1:e0', cardinality: 1, reservationDigest: 'r', searchInputDigest: 's',
  boundaryCost: 2, cohortSafetyCap: PHASE2C26B2B2A2_COHORT_SAFETY_CAP }

/** A delivered Candidate whose six keys are the summary's cost / advances (preferred rank 0) and a sortable key. */
function delivered(s: Phase2C2CandidateSummary, index: number): Phase2C26B2B2A2DeliveredCandidate {
  return { deliveryIndex: index, stableKey: `k${String(index).padStart(5, '0')}`, orderingKeys: { estimatedOperationCount: s.estimatedOperationCount, estimatedGogmaAdvance: s.estimatedAdvances.gogma,
    estimatedSkillAdvance: s.estimatedAdvances.skill, estimatedNormalAdvance: s.estimatedAdvances.normal, preferredSourceRank: 0 }, comparatorWithPrevious: index === 0 ? null : -1,
    summary: s, reservationCheck: { respects: true, blockedHits: {}, exclusiveHit: [] } }
}
/** Gogma advances must be nondecreasing within one cost for the six keys to agree; the filler keeps every Candidate's advance at its index. */
const filler = (n: number, from = 0, cost = 2) => Array.from({ length: n }, (_, i) => summary({ sourceOwnedWeaponId: `other-${from + i}`, estimatedOperationCount: cost, estimatedAdvances: { normal: null, gogma: 1, skill: 0 } }))

function drain(summaries: Phase2C2CandidateSummary[], termination: Phase2C26B2B2A2SearchRecord['termination'], sentinel: Phase2C2CandidateSummary | null = null,
  patch: Partial<Phase2C26B2B2A2SearchRecord> = {}): Phase2C26B2B2A2SearchRecord {
  const cohort = summaries.map(delivered)
  const status = termination === 'next_cost_sentinel' || termination === 'cohort_safety_cap' ? 'consumer_stop' : termination
  return { targetWeaponId: TARGET, fixedSetId: 'K1:e0', fixedTargetWeaponIds: ['t0'], cardinality: 1, reservationDigest: 'r', searchInputDigest: 's', extent: { ...defaultPlannerAlternativeSearchExtent },
    excludedRouteKeys: ['current'], preferredOwnedWeaponId: null, boundaryCost: 2, cohortSafetyCap: PHASE2C26B2B2A2_COHORT_SAFETY_CAP, status,
    summary: { deliveredCandidates: cohort.length + (sentinel ? 1 : 0), excludedCandidates: 0, exhausted: status === 'exhausted', stoppedByExtent: status === 'stopped_by_extent', stoppedByConsumer: status === 'consumer_stop' },
    cohort, nextCostSentinel: sentinel ? delivered(sentinel, cohort.length) : null, termination, cohortDrained: termination !== 'cohort_safety_cap', safetyCapHit: termination === 'cohort_safety_cap',
    costReadIssues: [], elapsedMs: 1, ...patch }
}
function runOf(record: Phase2C26B2B2A2SearchRecord | null, task = TASK, process: 'completed' | 'timeout' | 'out_of_memory' | 'process_failure' = 'completed', executionClass: 'stage1' | 'timeout_fallback' = 'stage1'): Phase2C26B2B2A2Run {
  const child = record === null ? null : { status: 'searched' as const, taskId: task.taskId, executionClass, search: record }
  return { taskId: task.taskId, executionClass, task: { ...task, executionClass }, outcome: phase2c26b2b2a2TaskOutcome(task.taskId, executionClass, process, process === 'completed' ? child : null),
    process: { outcome: process, wallMs: 10, timedOut: process === 'timeout', budgetMs: 1 }, childWallMs: 9, yields: 3,
    memory: process === 'completed' ? { sampledMaxHeapUsedBytes: 100, sampledMaxRssBytes: 200, maxRssKiB: 1 } : null, lastIpcMemory: { maxHeapUsedBytes: 50, maxRssBytes: 300 },
    record: process === 'completed' ? child : null }
}
function selectionOf(context: Pick<Phase2C26B2B2AContext, 'targetWeaponId' | 'fixedSetId' | 'cardinality' | 'reservationDigest' | 'searchInputDigest'>, boundaryCost = 2,
  priorPrefix: Phase2C26B2B2A2Selection['priorPrefix'] = []): Phase2C26B2B2A2Selection {
  return { targetWeaponId: context.targetWeaponId, b2b2aTaskId: 't06', fixedSetId: context.fixedSetId, cardinality: context.cardinality, reservationDigest: context.reservationDigest,
    searchInputDigest: context.searchInputDigest, boundaryCost, priorPrefix }
}
/** The prior B2-B2A prefix exactly as the RESULT would record this cohort's first 32. */
const priorOf = (record: Phase2C26B2B2A2SearchRecord): Phase2C26B2B2A2Selection['priorPrefix'] => record.cohort.slice(0, 32).map(c => ({
  deliveryIndex: c.deliveryIndex, stableKeySha256: digest(c.stableKey), routeKind: c.summary.routeKind, sourceKind: c.summary.sourceKind, estimatedOperationCount: c.summary.estimatedOperationCount,
  normal: null, gogma: c.summary.gogma && { first: c.summary.gogma.first, last: c.summary.gogma.last, operations: c.summary.gogma.operations, positions: c.summary.gogma.positions,
    crossesHeldPositions: c.summary.gogma.crossesHeldPositions, startsAfterOrigin: c.summary.gogma.startsAfterOrigin }, skill: null, heldRoute: c.summary.heldRoute, respectsReservation: true }))
const SELECTION = selectionOf(TASK)
const analyze = (stage1: Phase2C26B2B2A2Run[], fallback: Phase2C26B2B2A2Run[] = [], selection = SELECTION) =>
  runPhase2C26B2B2A2Analysis({ selections: [selection], tasks: [TASK], stage1, fallback, oracle: ORACLE, sha: digest, rawPriorByTarget: null, smoke: false })
const lateExact = () => drain([summary({ estimatedOperationCount: 1, sourceOwnedWeaponId: 'cheap' }), ...filler(39, 1), MATCH, ...filler(10, 41).map(s => ({ ...s, estimatedAdvances: { normal: null, gogma: 20, skill: 0 } }))],
  'next_cost_sentinel', summary({ estimatedOperationCount: 3, sourceOwnedWeaponId: 'dear' }))

describe('Phase 2-C2.6-B2-B2A2 analysis', () => {
  it('validates the raw drain: index / key / cost order, comparator agreement, termination flags and the sentinel', () => {
    const check = (record: Phase2C26B2B2A2SearchRecord, fallback: Phase2C26B2B2A2Run[] = []) => validatePhase2C26B2B2A2Raw({ selections: [SELECTION], tasks: [TASK], stage1: [runOf(record)], fallback, smoke: false })
    expect(check(lateExact())).toEqual([])
    const mutate = (patch: (r: Phase2C26B2B2A2SearchRecord) => void) => { const r = lateExact(); patch(r); return check(r).join() }
    expect(mutate(r => { r.cohort[5]!.orderingKeys.estimatedOperationCount = 1; r.cohort[5]!.summary = { ...r.cohort[5]!.summary, estimatedOperationCount: 1 } })).toMatch(/non-monotonic/)
    expect(mutate(r => { r.cohort[5]!.comparatorWithPrevious = 1 })).toMatch(/comparator/)
    expect(mutate(r => { r.cohort[6]!.orderingKeys.estimatedGogmaAdvance = 0 })).toMatch(/six recorded keys disagree/)
    expect(mutate(r => { r.nextCostSentinel!.orderingKeys.estimatedOperationCount = 2 })).toMatch(/sentinel does not cost more/)
    expect(mutate(r => { r.cohort[3]!.orderingKeys.estimatedOperationCount = 3 })).toMatch(/costs more than the boundary/)
    expect(mutate(r => { r.cohortDrained = false })).toMatch(/termination disagrees/)
    expect(mutate(r => { r.termination = 'exhausted' })).toMatch(/termination disagrees/)
    expect(mutate(r => { r.cohort[2]!.stableKey = 'current' })).toMatch(/excluded Route was delivered/)
    expect(mutate(r => { r.cohort[2]!.stableKey = r.cohort[1]!.stableKey })).toMatch(/twice/)
    expect(mutate(r => { r.boundaryCost = 3 })).toMatch(/boundary cost/)
    expect(mutate(r => { r.summary.deliveredCandidates -= 1 })).toMatch(/delivered count/)
    expect(check(drain(filler(5), 'cohort_safety_cap')).join()).toMatch(/termination disagrees/)
    expect(check(drain(filler(5), 'exhausted'), [runOf(drain(filler(5), 'exhausted'), TASK, 'completed', 'timeout_fallback')]).join()).toMatch(/fallback/)
    expect(validatePhase2C26B2B2A2Raw({ selections: [SELECTION], tasks: [TASK], stage1: [runOf(null, TASK, 'timeout')], fallback: [], smoke: false }).join()).toMatch(/fallback/)
  })

  it('reads the first deciding key in comparator order', () => {
    const base = delivered(summary(), 0)
    const other = (patch: Partial<Phase2C26B2B2A2DeliveredCandidate['orderingKeys']>, key = base.stableKey) => ({ stableKey: key, orderingKeys: { ...base.orderingKeys, ...patch } })
    expect(phase2c26b2b2a2FirstDecidingKey(base, other({ estimatedOperationCount: 3, estimatedGogmaAdvance: 0 }))).toEqual({ key: 'operation_cost', sign: -1 })
    expect(phase2c26b2b2a2FirstDecidingKey(base, other({ estimatedGogmaAdvance: 0, estimatedSkillAdvance: 9 }))).toEqual({ key: 'gogma_advance', sign: 1 })
    expect(phase2c26b2b2a2FirstDecidingKey(base, other({ estimatedSkillAdvance: 1 }))).toEqual({ key: 'skill_advance', sign: -1 })
    expect(phase2c26b2b2a2FirstDecidingKey(base, other({ estimatedNormalAdvance: 3 }))).toEqual({ key: 'normal_advance', sign: 1 })
    expect(phase2c26b2b2a2FirstDecidingKey(base, other({ preferredSourceRank: 1 }))).toEqual({ key: 'preferred_source', sign: -1 })
    expect(phase2c26b2b2a2FirstDecidingKey(base, other({}, 'k99999'))).toEqual({ key: 'stable_key', sign: -1 })
    expect(phase2c26b2b2a2FirstDecidingKey(base, other({}))).toEqual({ key: 'equal', sign: 0 })
  })

  it('checks the first 32 against the B2-B2A prefix by stable-key SHA-256 and the recorded summary fields', () => {
    const record = lateExact()
    const prior = priorOf(record)
    expect(phase2c26b2b2a2PrefixParity(TARGET, record.cohort, prior, digest, null)).toMatchObject({ valid: true, stableKeyMatches: 32, mismatches: [] })
    const wrongKey = structuredClone(prior); wrongKey[7]!.stableKeySha256 = '0'.repeat(64)
    expect(phase2c26b2b2a2PrefixParity(TARGET, record.cohort, wrongKey, digest, null)).toMatchObject({ valid: false, stableKeyMatches: 31, mismatches: [{ deliveryIndex: 7, fields: ['stableKeySha256'] }] })
    const wrongKind = structuredClone(prior); wrongKind[3]!.routeKind = 'existing_gogma_keep_bonuses'
    expect(phase2c26b2b2a2PrefixParity(TARGET, record.cohort, wrongKind, digest, null).mismatches).toEqual([{ deliveryIndex: 3, fields: ['routeKind'] }])
    expect(phase2c26b2b2a2PrefixParity(TARGET, record.cohort.slice(0, 20), prior, digest, null).valid).toBe(false)
    const raw = record.cohort.slice(0, 32).map(c => ({ stableKey: c.stableKey, summary: c.summary }))
    expect(phase2c26b2b2a2PrefixParity(TARGET, record.cohort, prior, digest, raw).valid).toBe(true)
    raw[4] = { ...raw[4]!, summary: { ...raw[4]!.summary, estimatedAdvances: { normal: null, gogma: 99, skill: 0 } } }
    expect(phase2c26b2b2a2PrefixParity(TARGET, record.cohort, prior, digest, raw).mismatches).toEqual([{ deliveryIndex: 4, fields: ['raw:estimatedAdvances', 'raw:summary'] }])
    const result = analyze([runOf(record)], [], selectionOf(TASK, 2, wrongKey))
    expect(result.invalidReasons.join()).toMatch(/prefix/)
  })

  it('classifies a late exact match in the boundary cohort and explains its predecessors with the six comparator keys', () => {
    const record = lateExact()
    const result = analyze([runOf(record)], [], selectionOf(TASK, 2, priorOf(record)))
    expect(result.invalidReasons).toEqual([])
    const c = result.rows[0]!.comparison
    expect([c.cohortClass, c.firstExactIndex, c.beyondPriorCapture, c.oracleOperationCost]).toEqual(['late_exact_in_boundary_cohort', 40, true, 2])
    // index 0 costs 1; indexes 1..39 cost 2 with a lower Gogma advance (1 < 13).
    expect(c.orderingExplanation).toMatchObject({ predecessors: 40, precededBy: { lower_operation_cost: 1, same_cost_lower_gogma_advance: 39, stable_key_tie_break: 0 },
      sameCostPredecessorGogmaAdvance: { lower: 39, equal: 0 }, inconsistencies: [] })
    expect(result.rows[0]!.cohort).toMatchObject({ boundaryCost: 2, deliveredUpToBoundary: 51, cohortCandidateCount: 50, belowBoundary: 1, nextCostSentinel: { deliveryIndex: 51, estimatedOperationCount: 3 },
      termination: 'next_cost_sentinel', cohortDrained: true })
    expect(result.rows[0]!.cohort!.boundaryCohort.estimatedGogmaAdvance).toEqual([{ value: 1, count: 39 }, { value: 13, count: 1 }, { value: 20, count: 10 }])
    expect(result.decisionInput).toEqual({ tasks: 1, measured: 1, exact: 1, drained: 1 })
    // A tie on every advance falls to the stable key.
    const tied = drain([...filler(39), { ...MATCH, estimatedAdvances: { normal: null, gogma: 1, skill: 0 } }], 'exhausted')
    const t = phase2c26b2b2a2Compare(phase2c26b2b2a2FinalOutcomes([TASK], [runOf(tied)], [])[0]!, 2, { routes: [{ ...ORACLE_ROUTE, materialization: { ...ORACLE_ROUTE.materialization, estimated: { operations: 2, normal: null, gogma: 1, skill: 0 } } }], gogmaUsage: ORACLE_USAGE })
    expect(t.orderingExplanation!.precededBy).toMatchObject({ stable_key_tie_break: 39, same_cost_lower_gogma_advance: 0 })
  })

  it('classifies partial / drained-without-match / safety-cap / unmeasured, and an oracle match never depends on how the drain ended', () => {
    const classify = (record: Phase2C26B2B2A2SearchRecord | null, oracle = ORACLE, process: 'completed' | 'timeout' | 'out_of_memory' = 'completed') =>
      phase2c26b2b2a2Compare(phase2c26b2b2a2FinalOutcomes([TASK], [runOf(record, TASK, process)], [])[0]!, 2, oracle)
    const noUsage = { routes: [ORACLE_ROUTE], gogmaUsage: [] }
    expect(classify(drain([...filler(33), MATCH], 'exhausted'), noUsage)).toMatchObject({ cohortClass: 'partial_in_boundary_cohort', firstPartialIndex: 33, beyondPriorCapture: true })
    expect(classify(drain(filler(60), 'next_cost_sentinel', summary({ estimatedOperationCount: 3 })))).toMatchObject({ cohortClass: 'boundary_cohort_drained_without_match', firstExactIndex: null })
    expect(classify(drain(filler(60), 'stopped_by_extent')).cohortClass).toBe('boundary_cohort_drained_without_match')
    expect(classify(drain(filler(60), 'cohort_safety_cap')).cohortClass).toBe('safety_cap_unresolved')
    // An exact found before the cap is recorded, the cohort still undrained.
    const capped = classify(drain([...filler(40), MATCH], 'cohort_safety_cap'))
    expect([capped.cohortClass, capped.firstExactIndex]).toEqual(['late_exact_in_boundary_cohort', 40])
    expect(classify(null, ORACLE, 'timeout').cohortClass).toBe('unmeasured')
    expect(classify(null, ORACLE, 'out_of_memory').cohortClass).toBe('unmeasured')
    // The sentinel is not a cohort Candidate: an oracle-equal sentinel is never a match.
    expect(classify(drain(filler(40), 'next_cost_sentinel', { ...MATCH, estimatedOperationCount: 3 })).cohortClass).toBe('boundary_cohort_drained_without_match')
  })

  it('fails closed on an exact inside the B2-B2A prefix, an oracle cost other than the boundary, a reservation violation (sentinel included) and a context mismatch', () => {
    const early = analyze([runOf(drain([...filler(5), MATCH, ...filler(30, 6).map(s => ({ ...s, estimatedAdvances: { normal: null, gogma: 20, skill: 0 } }))], 'exhausted'))])
    expect(early.invalidReasons.join()).toMatch(/inside the B2-B2A prefix/)
    const wrongCost = phase2c26b2b2a2Compare(phase2c26b2b2a2FinalOutcomes([TASK], [runOf(lateExact())], [])[0]!, 2,
      { routes: [{ ...ORACLE_ROUTE, materialization: { ...ORACLE_ROUTE.materialization, estimated: { operations: 3, normal: null, gogma: 13, skill: 0 } } }], gogmaUsage: ORACLE_USAGE })
    expect(wrongCost.inconsistencies.join()).toMatch(/oracle operation cost 3 is not the boundary cost 2/)
    const violating = lateExact()
    violating.nextCostSentinel!.reservationCheck = { respects: false, blockedHits: { gogma: [11] }, exclusiveHit: [] }
    const result = analyze([runOf(violating)], [], selectionOf(TASK, 2, priorOf(violating)))
    expect(result.invalidReasons.join()).toMatch(/semantic_failure/)
    expect(phase2c26b2b2a2Decision({ invalidReasons: result.invalidReasons, tasks: 2, measured: 2, exact: 2, drained: 2 }).case).toBe('B2B2A2_INVALID')
    const mismatch = runOf(null)
    mismatch.outcome = { ...mismatch.outcome, process: 'completed', record: 'context_mismatch' }
    mismatch.record = { status: 'context_mismatch', taskId: TASK.taskId, executionClass: 'stage1', issues: ['reservationDigest'] }
    expect(analyze([mismatch]).invalidReasons.join()).toMatch(/context mismatch/)
  })

  it('takes the fallback of a Stage 1 timeout as the formal outcome', () => {
    const [timedOut] = phase2c26b2b2a2FinalOutcomes([TASK], [runOf(null, TASK, 'timeout')], [runOf(lateExact(), TASK, 'completed', 'timeout_fallback')])
    expect([timedOut!.formalRun, timedOut!.measured, timedOut!.stage1.outcome.process]).toEqual(['timeout_fallback', true, 'timeout'])
    const [missing] = phase2c26b2b2a2FinalOutcomes([TASK], [runOf(null, TASK, 'timeout')], [])
    expect([missing!.formalRun, missing!.measured]).toEqual(['timeout_fallback', false])
  })

  it('decides ALL_LATE_EXACT / PARTIAL_LATE_EXACT / NO_MATCH_AFTER_DRAIN / INCOMPLETE / INVALID by the registered rule', () => {
    const d = (measured: number, exact: number, drained: number, invalidReasons: string[] = [], tasks = 2) => phase2c26b2b2a2Decision({ invalidReasons, tasks, measured, exact, drained }).case
    expect(d(2, 2, 2)).toBe('B2B2A2_ALL_LATE_EXACT')
    expect(d(2, 2, 1)).toBe('B2B2A2_ALL_LATE_EXACT')
    expect(d(2, 1, 2)).toBe('B2B2A2_PARTIAL_LATE_EXACT')
    expect(d(2, 1, 1)).toBe('B2B2A2_PARTIAL_LATE_EXACT')
    expect(d(2, 0, 2)).toBe('B2B2A2_NO_MATCH_AFTER_DRAIN')
    expect(d(2, 0, 1)).toBe('B2B2A2_INCOMPLETE')
    expect(d(1, 1, 1)).toBe('B2B2A2_INCOMPLETE')
    expect(d(2, 2, 2, ['x'])).toBe('B2B2A2_INVALID')
    expect(phase2c26b2b2a2Decision({ invalidReasons: [], tasks: 3, measured: 3, exact: 3, drained: 3 })).toMatchObject({ case: 'B2B2A2_INVALID', reasons: ['task_count_3'] })
    expect(() => phase2c26b2b2a2Decision({ invalidReasons: [], tasks: 2, measured: 1, exact: 2, drained: 0 })).toThrow()
    expect(PHASE2C26B2B2A2_DECISION_RULE.drained).toMatch(/safety-cap stop .* is never drained/)
  })
})

// ---------------------------------------------------------------- isolation

describe('Phase 2-C2.6-B2-B2A2 isolation', () => {
  it('is never imported by Production and fixes no Target, Entry, OwnedWeapon or Counter position', () => {
    const production = import.meta.glob(['../domain/**/*.ts', '../services/**/*.ts', '../workers/**/*.ts', '../pages/**/*.tsx', '../components/**/*.tsx', '../db/**/*.ts', '!../**/*.test.ts', '!../**/*.test.tsx'],
      { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    expect(Object.keys(production).length).toBeGreaterThan(50)
    expect(Object.entries(production).filter(([, source]) => /plannerGlobalPhase2C26B2B2A2/.test(source)).map(([path]) => path)).toEqual([])
    for (const source of [calculationSource, analysisSource, runnerSource, analyzerSource]) {
      expect(source).not.toMatch(/\bc\d+-p\d+\b|fnv1a32[-:][0-9a-f]{8}|[0-9a-f]{8}-[0-9a-f]{4}-/)
      // No Target-specific boundary cost: the boundary is read from each B2-B2A row.
      expect(source).not.toMatch(/boundaryCost\s*[:=]\s*2\b/)
    }
    for (const source of [calculationSource, analysisSource]) expect(source).not.toMatch(/node:fs|readFile|import\.meta\.glob/)
  })

  it('keeps the oracle and its manifest out of the Search side: only the analyzer reads them, after the run', () => {
    for (const source of [calculationSource, runnerSource]) {
      // The character classes keep these names out of this file's own text (the Phase 2-A.5 isolation test reads it).
      expect(source).not.toMatch(/ORACLE_[1]657|1657_|--oracle|--manifest|--b2a-result|gogmaUsage|plannerGlobal[O]racle|phase2c2OracleCoverage|plannerGlobalPhase2C2Analysis|parsePhase2C26B2AOracle|B2B2AAnalysis|B2B2A2Analysis|materialization\.estimated/)
    }
    expect(runnerSource).toMatch(/oracleGuidedTaskSelection: true, oracleReadBySearchRunner: false/)
    expect(analyzerSource).toMatch(/--oracle/)
    expect(analyzerSource).toMatch(/--manifest/)
    expect(analyzerSource).toMatch(/oracleGuidedTaskSelection: true, oracleReadBySearchRunner: false/)
    expect(analysisSource).toMatch(/phase2c26b2b2aCompare\(/)
    expect(analysisSource).toMatch(/materialization\?\.estimated\?\.operations/)
  })

  it('drains through the unchanged Production Search and the existing Research helpers, with exactly the sentinel and the cap as stop rules', () => {
    expect(calculationSource).toMatch(/visitPlannerAlternativeCandidates\(/)
    expect(calculationSource).toMatch(/createPlannerAlternativeMaterializer\(/)
    expect(calculationSource).toMatch(/summarizePhase2C2Entry\(/)
    expect(calculationSource).toMatch(/respectsPhase2C2Reservation\(/)
    expect(calculationSource).toMatch(/candidateStableKey\(/)
    expect(calculationSource).toMatch(/compareConstrainedCandidates\(/)
    expect(calculationSource).toMatch(/reconstructPhase2C26B2B2AContext/)
    expect((calculationSource.match(/'stop'/g) ?? []).length).toBe(2)
    expect(calculationSource).toMatch(/if \(candidate\.estimatedOperationCount > boundaryCost\) \{\s*nextCostSentinel = delivered\s*return 'stop'/)
    expect(calculationSource).toMatch(/return safetyCapHit \? 'stop' : 'continue'/)
    for (const source of [calculationSource, analysisSource, runnerSource, analyzerSource]) {
      expect(source).not.toMatch(/runPreparedPlannerAlternativeKernel|preparePlannerAlternativeKernel|createProductionPlan|runPhase2C2Kernel|runPhase2C2Baseline|runPlannerDeterministicSchedule|createPlannerAlternativeWhatIfComparison|searchCandidates\(/)
    }
    for (const source of [analysisSource, analyzerSource]) expect(source).not.toMatch(/visitPlannerAlternativeCandidates|runPhase2C26B2B2A2Search|runPhase2C26B2B2A2Task\(/)
  })
})
