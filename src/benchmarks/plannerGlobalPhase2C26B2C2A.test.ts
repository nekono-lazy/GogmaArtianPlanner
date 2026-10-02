import { beforeEach, describe, expect, it, vi } from 'vitest'
import rawB2C1 from '../../docs/PLANNER_GLOBAL_PHASE2C26B2C1_RESULT.json?raw'
import rawB2B2A2 from '../../docs/PLANNER_GLOBAL_PHASE2C26B2B2A2_RESULT.json?raw'
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
import { reconstructPhase2C26B2B2AContext } from './plannerGlobalPhase2C26B2B2A'
import type { Phase2C26B2B2A2DeliveredCandidate } from './plannerGlobalPhase2C26B2B2A2'
import { derivePhase2C26B2C1Schedule, type Phase2C26B2C1Schedule } from './plannerGlobalPhase2C26B2C1'
import {
  buildPhase2C26B2C2ATasks,
  createPhase2C26B2C2ACapture,
  parsePhase2C26B2C2ATargetManifest,
  phase2c26b2c2aPolicyDrift,
  phase2c26b2c2aTaskOutcome,
  runPhase2C26B2C2ASearch,
  runPhase2C26B2C2ATask,
  PHASE2C26B2C2A_CANDIDATE_SAFETY_CAP,
  PHASE2C26B2C2A_CONTEXT_BUDGET,
  PHASE2C26B2C2A_EXPECTED_TASKS,
  PHASE2C26B2C2A_MAX_COST_COHORTS,
  PHASE2C26B2C2A_REGISTERED_P1,
  PHASE2C26B2C2A_STAGE1,
  PHASE2C26B2C2A_TARGET_SOURCE,
  PHASE2C26B2C2A_VALIDATION_TARGETS,
  type Phase2C26B2C2ASearchRecord,
  type Phase2C26B2C2ATaskInput,
} from './plannerGlobalPhase2C26B2C2A'
import searchSource from './plannerGlobalPhase2C26B2C2A.ts?raw'
import {
  parsePhase2C26B2C2AB2B2A2Authority,
  parsePhase2C26B2C2AB2C1Authority,
  phase2c26b2c2aTargetManifest,
  PHASE2C26B2C2A_REGISTERED_B2C1,
} from './plannerGlobalPhase2C26B2C2ATargets'
import targetsSource from './plannerGlobalPhase2C26B2C2ATargets.ts?raw'
import {
  phase2c26b2c2aBudgetCoverage,
  phase2c26b2c2aCompareContext,
  phase2c26b2c2aDecision,
  phase2c26b2c2aPolicyLength,
  phase2c26b2c2aTargetRow,
  runPhase2C26B2C2AAnalysis,
  validatePhase2C26B2C2ARaw,
  PHASE2C26B2C2A_DECISION_RULE,
  type Phase2C26B2C2AContextComparison,
  type Phase2C26B2C2ARun,
} from './plannerGlobalPhase2C26B2C2AAnalysis'
import analysisSource from './plannerGlobalPhase2C26B2C2AAnalysis.ts?raw'
import prepareSource from '../../scripts/prepare-planner-global-phase2c26b2c2a-targets.mjs?raw'
import runnerSource from '../../scripts/run-planner-global-phase2c26b2c2a.mjs?raw'
import analyzerSource from '../../scripts/analyze-planner-global-phase2c26b2c2a.mjs?raw'

/*
 * Issue #154 Phase 2-C2.6-B2-C2A: the P1 top-16 reservation contexts, searched without oracle context selection. The
 * synthetic worlds below are invented for the tests; the committed B2-C1 / B2-B2A2 RESULTs are read only to check the
 * population authority. The oracle modules are never imported here (the Phase 2-A.5 isolation rule).
 */

/**
 * Every Search input, in call order. `script` (a list of operation costs) makes the Search hand the visitor its first real
 * Candidate once per entry with that `estimatedOperationCount` (a distinct key each), then end `exhausted` (or by extent);
 * every visitor decision is recorded.
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

const b2c1Json = JSON.parse(rawB2C1)
const b2c1Sha = PHASE2C26B2C2A_REGISTERED_B2C1.resultSha256

// ---------------------------------------------------------------- the population authority and the Target manifest

describe('Phase 2-C2.6-B2-C2A population authority and Target manifest', () => {
  it('accepts the committed formal B2-C1 RESULT and fails closed on any registered value', () => {
    const parsed = parsePhase2C26B2C2AB2C1Authority(b2c1Json, b2c1Sha)
    expect(parsed.issues).toEqual([])
    expect(parsed.authority!.routes).toHaveLength(43)
    expect(parsed.authority!.routes.filter(r => r.subgroups.includes('defaultExtent'))).toHaveLength(20)
    expect(parsePhase2C26B2C2AB2C1Authority(b2c1Json, '0'.repeat(64)).valid).toBe(false)
    const mutate = (patch: (j: typeof b2c1Json) => void) => { const copy = structuredClone(b2c1Json); patch(copy); return parsePhase2C26B2C2AB2C1Authority(copy, b2c1Sha).valid }
    expect(mutate(j => { j.provenance.formal = false })).toBe(false)
    expect(mutate(j => { j.provenance.calculationCodeChangedSinceMeasuredHead = ['src/x.ts'] })).toBe(false)
    expect(mutate(j => { j.provenance.oracleReadByCalculation = true })).toBe(false)
    expect(mutate(j => { j.decision.case = 'B2C1_TOP16' })).toBe(false)
    expect(mutate(j => { j.invalidReasons = ['x'] })).toBe(false)
    expect(mutate(j => { j.selection.selected.policy = 'P2' })).toBe(false)
    expect(mutate(j => { j.conditions.policies[1].keys[1][1] = 'desc' })).toBe(false)
    expect(mutate(j => { j.subgroupCounts.k2Minimal = 8 })).toBe(false)
    expect(mutate(j => { j.subgroupCounts.unreached = 4 })).toBe(false)
    expect(mutate(j => { j.subgroupCounts.k1Minimal = 30 })).toBe(false)
    expect(mutate(j => { j.policyAggregates.P1.defaultExtent.rank.max = 12 })).toBe(false)
    expect(mutate(j => { j.policyAggregates.P1.defaultExtent.cdf.top16 = 19 })).toBe(false)
    expect(mutate(j => { j.provenance.b2b2a2ResultSha256 = '0'.repeat(64) })).toBe(false)
    expect(mutate(j => { j.provenance.oracleManifestRoutesSha256 = '0'.repeat(64) })).toBe(false)
    expect(mutate(j => { j.routes.pop() })).toBe(false)
    expect(mutate(j => { j.routes.find((r: { subgroups: string[] }) => r.subgroups.includes('defaultExtent')).firstCompatible.P1.rank = 17 })).toBe(false)
    expect(mutate(j => { j.routes.find((r: { subgroups: string[] }) => r.subgroups.includes('extentInsufficient')).subgroups.push('defaultExtent') })).toBe(false)
    expect(parsePhase2C26B2C2AB2C1Authority(null, b2c1Sha).valid).toBe(false)
  })

  it('writes the defaultExtent subgroup as 20 sorted Target IDs and nothing else, exactly what the Search runner accepts', () => {
    const authority = parsePhase2C26B2C2AB2C1Authority(b2c1Json, b2c1Sha).authority!
    const manifest = phase2c26b2c2aTargetManifest(authority)
    const expected = (b2c1Json.routes as { targetWeaponId: string; subgroups: string[] }[]).filter(r => r.subgroups.includes('defaultExtent')).map(r => r.targetWeaponId).sort()
    expect(manifest.targetWeaponIds).toEqual(expected)
    expect(manifest).toMatchObject({ sourceResultSha256: PHASE2C26B2C2A_TARGET_SOURCE.resultSha256, population: 'defaultExtent', policy: 'P1', contextBudget: 16, exportSha256: b2c1Json.provenance.exportSha256 })
    expect(Object.keys(manifest).sort()).toEqual(['contextBudget', 'exportSha256', 'phase', 'policy', 'population', 'sourceResultSha256', 'targetWeaponIds'])
    expect(JSON.stringify(manifest)).not.toMatch(/rank|fnv1a32|firstCompatible|K1:|oracle/i)
    expect(parsePhase2C26B2C2ATargetManifest(structuredClone(manifest))).toMatchObject({ valid: true, issues: [] })
    const bad = (patch: (m: Record<string, unknown> & typeof manifest) => void) => { const copy = structuredClone(manifest) as Record<string, unknown> & typeof manifest; patch(copy); return parsePhase2C26B2C2ATargetManifest(copy).valid }
    expect(bad(m => { m.targetWeaponIds = [...m.targetWeaponIds.slice(0, 19), m.targetWeaponIds[0]!].sort() })).toBe(false)
    expect(bad(m => { m.targetWeaponIds = m.targetWeaponIds.slice(1) })).toBe(false)
    expect(bad(m => { m.targetWeaponIds = [...m.targetWeaponIds].reverse() })).toBe(false)
    expect(bad(m => { m.sourceResultSha256 = '0'.repeat(64) })).toBe(false)
    expect(bad(m => { (m as Record<string, unknown>).population = 'recovered' })).toBe(false)
    expect(bad(m => { (m as Record<string, unknown>).policy = 'P2' })).toBe(false)
    expect(bad(m => { m.contextBudget = 8 })).toBe(false)
    expect(bad(m => { m.firstCompatibleRanks = [2] })).toBe(false)
    expect(parsePhase2C26B2C2ATargetManifest([]).valid).toBe(false)
    const firstMember = authority.routes.find(r => r.subgroups.includes('defaultExtent'))!
    expect(() => phase2c26b2c2aTargetManifest({ ...authority, routes: authority.routes.filter(r => r !== firstMember) })).toThrow(/not 20/)
  })

  it('reads the B2-B2A2 RESULT for its hash chain only and fails closed on another SHA-256 or case', () => {
    const json = JSON.parse(rawB2B2A2)
    const sha = PHASE2C26B2C2A_REGISTERED_B2C1.b2b2a2ResultSha256
    expect(parsePhase2C26B2C2AB2B2A2Authority(json, sha)).toMatchObject({ valid: true, authority: { exportSha256: b2c1Json.provenance.exportSha256, b2b1ResultSha256: PHASE2C26B2C2A_REGISTERED_B2C1.b2b1ResultSha256 } })
    expect(parsePhase2C26B2C2AB2B2A2Authority(json, '0'.repeat(64)).valid).toBe(false)
    expect(parsePhase2C26B2C2AB2B2A2Authority({ ...json, decision: { case: 'B2B2A2_INVALID' } }, sha).valid).toBe(false)
  })
})

// ---------------------------------------------------------------- a synthetic world

const SOURCE_A_SKILL = 'series_skill.fixture.z'
const SOURCE_B_SKILL = 'series_skill.fixture.b-source'

function world() {
  const skill = { seriesSkillId: SOURCE_A_SKILL, groupSkillId: null, matchMode: 'all' as const }
  const a: TargetWeapon = orchestrationTarget('target.b2c2a.a', { priority: 5, idealSkillCondition: skill, practicalSkillCondition: skill })
  const b = skillConstrainedTarget('target.b2c2a.b', { priority: 1 })
  const built = orchestrationScenario({
    engine: { gogmaPositions: defaultPlannerAlternativeSearchExtent.maxGogmaAdvance + 8, skillPositions: defaultPlannerAlternativeSearchExtent.maxSkillAdvance + 8 },
    targets: [a, b],
    ownedWeapons: [orchestrationSource(ORCHESTRATION_SOURCE_A, { seriesSkillId: SOURCE_A_SKILL }),
      orchestrationSource(ORCHESTRATION_SOURCE_B, { restorationBonuses: belowPracticalBonuses(), seriesSkillId: SOURCE_B_SKILL })],
    entries: [
      orchestrationEntry('build-list.b2c2a.a', a, resetRoute(ORCHESTRATION_SOURCE_A), { finalBonuses: idealBonuses(), seriesSkillId: SOURCE_A_SKILL }),
      orchestrationEntry('build-list.b2c2a.b', b, { kind: 'existing_gogma_mixed', sourceOwnedWeaponId: resetRoute(ORCHESTRATION_SOURCE_B).sourceOwnedWeaponId,
        operations: [...resetRoute(ORCHESTRATION_SOURCE_B).operations, ...resetSkillsRoute(ORCHESTRATION_SOURCE_B).operations] }),
    ],
  })
  const schedule = derivePhase2C26B2C1Schedule(built.input, globalResearchDependencies(built.engine))
  return { built, schedule }
}
const IDS = ['target.b2c2a.a', 'target.b2c2a.b']

// ---------------------------------------------------------------- P1 top-N task construction

describe('Phase 2-C2.6-B2-C2A task construction', () => {
  it('registers 20 Targets x 16 P1 ranks = 320 tasks and the exact P1 definition', () => {
    expect([PHASE2C26B2C2A_VALIDATION_TARGETS, PHASE2C26B2C2A_CONTEXT_BUDGET, PHASE2C26B2C2A_EXPECTED_TASKS]).toEqual([20, 16, 320])
    expect(PHASE2C26B2C2A_REGISTERED_P1).toEqual({ id: 'P1', name: 'default_simple_first', keys: [['targetEligibleMinCardinality', 'asc'], ['exclusiveOwnedWeaponCount', 'asc'],
      ['blockedCountDefaultTotal', 'asc'], ['shareableHeldCountDefaultTotal', 'desc'], ['reservationDigest', 'asc']] })
    expect([PHASE2C26B2C2A_MAX_COST_COHORTS, PHASE2C26B2C2A_CANDIDATE_SAFETY_CAP]).toEqual([4, 1024])
    expect(PHASE2C26B2C2A_STAGE1).toMatchObject({ childHeapMb: 8192, concurrency: 3, budgetMs: 600_000, retry: 'none', fallback: 'none' })
  })

  it('takes every P1 rank 1..N of every Target from the re-derived schedule and rebuilds each context through the unchanged reconstruction', () => {
    const { schedule } = world()
    const budget = Math.min(...IDS.map(id => schedule.contexts.filter(c => c.targetWeaponId === id).length))
    expect(budget).toBeGreaterThanOrEqual(2)
    const built = buildPhase2C26B2C2ATasks(schedule, IDS, budget)
    expect(built.issues).toEqual([])
    expect(built.tasks).toHaveLength(IDS.length * budget)
    for (const [targetIndex, id] of IDS.entries()) {
      const tasks = built.tasks.filter(t => t.targetWeaponId === id)
      expect(tasks.map(t => t.contextRank)).toEqual(Array.from({ length: budget }, (_, i) => i + 1))
      expect(tasks.map(t => t.taskId)).toEqual(tasks.map(t => `t0${targetIndex}-r${String(t.contextRank).padStart(2, '0')}`))
      for (const task of tasks) {
        const row = schedule.contexts.find(c => c.targetWeaponId === id && c.ranks.P1 === task.contextRank)!
        expect(task).toMatchObject({ groupIndex: row.groupIndex, reservationDigest: row.reservationDigest, targetEligibleMinCardinality: row.targetEligibleMinCardinality,
          representativeFixedSetId: row.representativeFixedSetId, representativeFixedTargetWeaponIds: row.representativeFixedTargetWeaponIds, policy: 'P1', maxCostCohorts: 4, candidateSafetyCap: 1024 })
        const rebuilt = reconstructPhase2C26B2B2AContext(schedule.snapshot, { targetWeaponId: id, fixedSetId: row.representativeFixedSetId, cardinality: row.targetEligibleMinCardinality, reservationDigest: row.reservationDigest })
        expect(rebuilt.valid && rebuilt.context.searchInputDigest).toBe(task.searchInputDigest)
      }
      // K0 is rank 1.
      expect(tasks[0]!.targetEligibleMinCardinality).toBe(0)
    }
    // No oracle field rides on a task.
    expect(Object.keys(built.tasks[0]!).sort()).toEqual(['candidateSafetyCap', 'contextRank', 'executionClass', 'groupIndex', 'maxCostCohorts', 'policy', 'representativeFixedSetId',
      'representativeFixedTargetWeaponIds', 'reservationDigest', 'searchInputDigest', 'targetEligibleMinCardinality', 'targetWeaponId', 'taskId'])
  })

  it('fails closed on too few contexts, an unknown or repeated Target, a rank gap or duplicate, and a P1 definition drift', () => {
    const { schedule } = world()
    const fewest = Math.min(...IDS.map(id => schedule.contexts.filter(c => c.targetWeaponId === id).length))
    const issues = (s: Phase2C26B2C1Schedule, ids = IDS, budget = fewest) => buildPhase2C26B2C2ATasks(s, ids, budget).issues.join('\n')
    expect(issues(schedule, IDS, fewest + 1)).toMatch(/fewer than the budget/)
    expect(buildPhase2C26B2C2ATasks(schedule, IDS, fewest + 1).tasks).toEqual([])
    expect(issues(schedule, [...IDS, 'target.none'])).toMatch(/not a schedule Target/)
    expect(issues(schedule, [IDS[0]!, IDS[0]!])).toMatch(/repeats/)
    const gap = structuredClone(schedule); gap.contexts.find(c => c.targetWeaponId === IDS[0] && c.ranks.P1 === 2)!.ranks.P1 = 9
    expect(issues(gap)).toMatch(/ranks 1\.\.\d+ are missing or repeated/)
    const dup = structuredClone(schedule); dup.contexts.find(c => c.targetWeaponId === IDS[0] && c.ranks.P1 === 2)!.ranks.P1 = 1
    expect(issues(dup)).toMatch(/missing or repeated/)
    const drift = structuredClone(schedule); (drift as { policies: unknown }).policies = drift.policies.map(p => p.id === 'P1' ? { ...p, keys: [...p.keys].reverse() } : p)
    expect(phase2c26b2c2aPolicyDrift(drift)).toEqual(['the schedule P1 is not the registered P1 definition'])
    expect(issues(drift)).toMatch(/registered P1/)
    const extent = structuredClone(schedule); extent.extent.maxGogmaAdvance = 300
    expect(issues(extent)).toMatch(/default extent/)
  })
})

// ---------------------------------------------------------------- the cost-cohort capture

describe('Phase 2-C2.6-B2-C2A cost-cohort capture', () => {
  it('captures the first four distinct costs completely and answers sentinel at the first fifth cost', () => {
    const run = (costs: number[], cohorts = 4, cap = 1024) => {
      const machine = createPhase2C26B2C2ACapture(cohorts, cap)
      const decisions: string[] = []
      for (const [i, cost] of costs.entries()) { const d = machine.offer(cost, i); decisions.push(d); if (d === 'sentinel' || machine.full) break }
      return { decisions, costs: machine.capturedCosts, full: machine.full, nonmonotonic: machine.nonmonotonicIndexes }
    }
    expect(run([1, 1, 1, 2, 2, 3, 3, 3, 4, 5, 5])).toEqual({ decisions: [...Array(9).fill('capture'), 'sentinel'], costs: [1, 2, 3, 4], full: false, nonmonotonic: [] })
    expect(run([2, 2])).toEqual({ decisions: ['capture', 'capture'], costs: [2], full: false, nonmonotonic: [] })
    expect(run([16, 17, 18, 19, 20])).toEqual({ decisions: ['capture', 'capture', 'capture', 'capture', 'sentinel'], costs: [16, 17, 18, 19], full: false, nonmonotonic: [] })
    expect(run(Array(10).fill(2), 4, 5)).toMatchObject({ decisions: Array(5).fill('capture'), full: true })
    // A cheaper Candidate after a dearer one is recorded for the analyzer (never silently accepted).
    expect(run([1, 3, 2]).nonmonotonic).toEqual([2])
    expect(() => createPhase2C26B2C2ACapture(0, 1)).toThrow()
    expect(() => createPhase2C26B2C2ACapture(4, 0)).toThrow()
  })

  it('cuts C8 / C32 from the one capture so that C8 ⊆ C32 ⊆ C4C', () => {
    expect([phase2c26b2c2aPolicyLength('C8', 433), phase2c26b2c2aPolicyLength('C32', 433), phase2c26b2c2aPolicyLength('C4C', 433)]).toEqual([8, 32, 433])
    expect([phase2c26b2c2aPolicyLength('C8', 4), phase2c26b2c2aPolicyLength('C32', 4), phase2c26b2c2aPolicyLength('C4C', 4)]).toEqual([4, 4, 4])
    expect([phase2c26b2c2aPolicyLength('C8', 20), phase2c26b2c2aPolicyLength('C32', 20)]).toEqual([8, 20])
  })
})

// ---------------------------------------------------------------- the Search child

const CAPTURE = { maxCostCohorts: PHASE2C26B2C2A_MAX_COST_COHORTS, candidateSafetyCap: PHASE2C26B2C2A_CANDIDATE_SAFETY_CAP }
const PROVENANCE = { contextRank: 2, targetEligibleMinCardinality: 1, representativeFixedSetId: 'K1:x', representativeFixedTargetWeaponIds: ['t'] }

function contextOf(schedule: Phase2C26B2C1Schedule, id = 'target.b2c2a.b', rank = 2) {
  const row = schedule.contexts.find(c => c.targetWeaponId === id && c.ranks.P1 === rank)!
  const rebuilt = reconstructPhase2C26B2B2AContext(schedule.snapshot, { targetWeaponId: id, fixedSetId: row.representativeFixedSetId, cardinality: row.targetEligibleMinCardinality, reservationDigest: row.reservationDigest })
  if (!rebuilt.valid) throw new Error(rebuilt.issues.join())
  return rebuilt.context
}

describe('Phase 2-C2.6-B2-C2A Search child', () => {
  it('gives visitPlannerAlternativeCandidates() exactly the rebuilt origin, reservation, exclusion and default extent, and captures to the natural end', async () => {
    const { built, schedule } = world()
    const context = contextOf(schedule)
    const record = await runPhase2C26B2C2ASearch(built.input, context, built.engine, CAPTURE, PROVENANCE, { now: () => 0 })
    expect(searchCalls.inputs).toEqual([{ origin: createPlannerStartSearchOrigin(built.input), targetWeaponId: 'target.b2c2a.b', extent: { ...defaultPlannerAlternativeSearchExtent },
      reservation: context.reservation, excludedRouteKeys: context.excludedRouteKeys }])
    expect(record.candidates.length).toBeGreaterThan(0)
    expect(record.capturedCosts.length).toBeLessThanOrEqual(4)
    expect(record.candidates.slice(1).every(c => c.comparatorWithPrevious === -1)).toBe(true)
    expect(record).toMatchObject({ contextRank: 2, captureComplete: true, safetyCapHit: false, costReadIssues: [], nonmonotonicIndexes: [] })
    if (record.nextCostSentinel === null) expect(['exhausted', 'stopped_by_extent']).toContain(record.termination)
    else expect(record.termination).toBe('four_cost_cohorts_drained')
  })

  it('stops at the first Candidate of a fifth cost (the sentinel, outside the capture) and at nothing else', async () => {
    const { built, schedule } = world()
    const context = contextOf(schedule)
    searchCalls.script = [1, 1, 2, 3, 3, 4, 4, 5, 5]
    const record = await runPhase2C26B2C2ASearch(built.input, context, built.engine, CAPTURE, PROVENANCE)
    expect(searchCalls.decisions).toEqual([...Array(7).fill('continue'), 'stop'])
    expect(record.candidates.map(c => c.orderingKeys.estimatedOperationCount)).toEqual([1, 1, 2, 3, 3, 4, 4])
    expect(record.nextCostSentinel).toMatchObject({ deliveryIndex: 7, orderingKeys: { estimatedOperationCount: 5 } })
    expect(record).toMatchObject({ termination: 'four_cost_cohorts_drained', status: 'consumer_stop', captureComplete: true, safetyCapHit: false, capturedCosts: [1, 2, 3, 4], distinctCostCohorts: 4 })
  })

  it('treats a natural end before a fifth cost as complete, recording how it ended', async () => {
    const { built, schedule } = world()
    const context = contextOf(schedule)
    searchCalls.script = [1, 2, 2]
    expect(await runPhase2C26B2C2ASearch(built.input, context, built.engine, CAPTURE, PROVENANCE)).toMatchObject({ termination: 'exhausted', captureComplete: true, nextCostSentinel: null, distinctCostCohorts: 2 })
    searchCalls.script = [7]
    searchCalls.endByExtent = true
    expect(await runPhase2C26B2C2ASearch(built.input, context, built.engine, CAPTURE, PROVENANCE)).toMatchObject({ termination: 'stopped_by_extent', captureComplete: true })
  })

  it('stops at the safety cap without claiming a complete capture, and refuses another capture rule or extent', async () => {
    const { built, schedule } = world()
    const context = contextOf(schedule)
    searchCalls.script = Array(PHASE2C26B2C2A_CANDIDATE_SAFETY_CAP + 5).fill(2)
    const record = await runPhase2C26B2C2ASearch(built.input, context, built.engine, CAPTURE, PROVENANCE)
    expect(searchCalls.decisions).toHaveLength(PHASE2C26B2C2A_CANDIDATE_SAFETY_CAP)
    expect(searchCalls.decisions.at(-1)).toBe('stop')
    expect(record).toMatchObject({ termination: 'candidate_safety_cap', captureComplete: false, safetyCapHit: true, nextCostSentinel: null })
    expect(record.candidates).toHaveLength(PHASE2C26B2C2A_CANDIDATE_SAFETY_CAP)
    await expect(runPhase2C26B2C2ASearch(built.input, context, built.engine, { ...CAPTURE, candidateSafetyCap: 32 }, PROVENANCE)).rejects.toThrow(/safety cap/)
    await expect(runPhase2C26B2C2ASearch(built.input, context, built.engine, { ...CAPTURE, maxCostCohorts: 1 }, PROVENANCE)).rejects.toThrow(/cost cohorts/)
    await expect(runPhase2C26B2C2ASearch(built.input, { ...context, extent: { ...context.extent, maxGogmaAdvance: 300 } }, built.engine, CAPTURE, PROVENANCE)).rejects.toThrow(/default extent/)
  }, 120_000)

  it('selects its context by Target and P1 rank from its own schedule and reports any drift as a context mismatch without searching', async () => {
    const { built, schedule } = world()
    const task = buildPhase2C26B2C2ATasks(schedule, IDS, 2).tasks.find(t => t.targetWeaponId === 'target.b2c2a.b' && t.contextRank === 2)!
    searchCalls.script = [1, 2, 3, 4, 5]
    expect(await runPhase2C26B2C2ATask(built.input, schedule, task, built.engine)).toMatchObject({ status: 'searched', search: { contextRank: 2, termination: 'four_cost_cohorts_drained' } })
    searchCalls.inputs = []
    const mismatch = async (patch: Partial<Phase2C26B2C2ATaskInput>) => runPhase2C26B2C2ATask(built.input, schedule, { ...task, ...patch }, built.engine)
    expect(await mismatch({ searchInputDigest: 'other' })).toMatchObject({ status: 'context_mismatch', issues: ['searchInputDigest'] })
    expect(await mismatch({ reservationDigest: 'other' })).toMatchObject({ status: 'context_mismatch', issues: ['reservationDigest'] })
    expect(await mismatch({ contextRank: 1 })).toMatchObject({ status: 'context_mismatch' })
    expect(await mismatch({ contextRank: 99 })).toMatchObject({ status: 'context_mismatch', issues: ['P1 rank 99 holds 0 contexts'] })
    const drift = structuredClone(schedule); (drift as { policies: unknown }).policies = []
    expect(await runPhase2C26B2C2ATask(built.input, drift, task, built.engine)).toMatchObject({ status: 'context_mismatch' })
    expect(searchCalls.inputs).toEqual([])
  })

  it('records a timeout / out of memory / failure as that failure, never as no Candidate', () => {
    expect(phase2c26b2c2aTaskOutcome('t', 'timeout', null)).toEqual({ taskId: 't', process: 'timeout', record: null, searchStatus: null, termination: null, candidateCount: null })
    expect(phase2c26b2c2aTaskOutcome('t', 'completed', null).process).toBe('process_failure')
    expect(phase2c26b2c2aTaskOutcome('t', 'completed', { status: 'context_mismatch', taskId: 't', issues: ['x'] }).record).toBe('context_mismatch')
  })
})

// ---------------------------------------------------------------- analysis over synthetic records

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

function taskOf(rank: number, patch: Partial<Phase2C26B2C2ATaskInput> = {}): Phase2C26B2C2ATaskInput {
  return { taskId: `t00-r${String(rank).padStart(2, '0')}`, executionClass: 'stage1', targetWeaponId: TARGET, contextRank: rank, policy: 'P1', groupIndex: 100 + rank,
    reservationDigest: `d${rank}`, targetEligibleMinCardinality: rank === 1 ? 0 : 1, representativeFixedSetId: rank === 1 ? 'K0' : `K1:e${rank}`, representativeFixedTargetWeaponIds: rank === 1 ? [] : [`x${rank}`],
    searchInputDigest: `s${rank}`, maxCostCohorts: 4, candidateSafetyCap: 1024, ...patch }
}
/** A delivered Candidate whose six keys are the summary's cost / advances (preferred rank 0) and a sortable key. */
function delivered(s: Phase2C2CandidateSummary, index: number): Phase2C26B2B2A2DeliveredCandidate {
  return { deliveryIndex: index, stableKey: `k${String(index).padStart(5, '0')}`, orderingKeys: { estimatedOperationCount: s.estimatedOperationCount, estimatedGogmaAdvance: s.estimatedAdvances.gogma,
    estimatedSkillAdvance: s.estimatedAdvances.skill, estimatedNormalAdvance: s.estimatedAdvances.normal, preferredSourceRank: 0 }, comparatorWithPrevious: index === 0 ? null : -1,
    summary: s, reservationCheck: { respects: true, blockedHits: {}, exclusiveHit: [] } }
}
/** Fillers of one cost with a Gogma advance at their own index so the six keys stay in comparator order. */
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
/** Cost 1 x1, cost 2 x(n) with the oracle Route at `at`, then costs 3 and 4, then the sentinel. */
function withMatchAt(task: Phase2C26B2C2ATaskInput, at: number) {
  const twos = filler(Math.max(at - 1, 0), 2)
  return capture(task, [summary({ estimatedOperationCount: 1, sourceOwnedWeaponId: 'cheap' }), ...twos, { ...MATCH }, ...filler(3, 3, 100), ...filler(2, 4, 200)], 'four_cost_cohorts_drained',
    summary({ estimatedOperationCount: 5, sourceOwnedWeaponId: 'dear' }))
}
const miss = (task: Phase2C26B2C2ATaskInput) => capture(task, [summary({ estimatedOperationCount: 1, sourceOwnedWeaponId: 'cheap' }), ...filler(5, 2)], 'exhausted')

describe('Phase 2-C2.6-B2-C2A analysis', () => {
  it('validates the raw capture: task identity, cost cohorts, sentinel, comparator, termination and nonmonotonic costs', () => {
    const task = taskOf(2)
    const check = (record: Phase2C26B2C2ASearchRecord) => validatePhase2C26B2C2ARaw({ tasks: [task], runs: [runOf(task, record)], smoke: false })
    expect(check(withMatchAt(task, 5))).toEqual([])
    const mutate = (patch: (r: Phase2C26B2C2ASearchRecord) => void) => { const r = withMatchAt(task, 5); patch(r); return check(r).join('\n') }
    expect(mutate(r => { r.candidates[4]!.orderingKeys.estimatedOperationCount = 1; r.candidates[4]!.summary = { ...r.candidates[4]!.summary, estimatedOperationCount: 1 } })).toMatch(/semantic_failure: .*nonmonotonic/)
    expect(mutate(r => { r.nonmonotonicIndexes = [3] })).toMatch(/nonmonotonic/)
    expect(mutate(r => { r.capturedCosts = [1, 2, 3] })).toMatch(/cohorts drift/)
    expect(mutate(r => { r.nextCostSentinel!.orderingKeys.estimatedOperationCount = 4 })).toMatch(/sentinel is not the first Candidate of a fifth cost/)
    expect(mutate(r => { r.captureComplete = false })).toMatch(/termination disagrees/)
    expect(mutate(r => { r.contextRank = 3 })).toMatch(/not the task's context/)
    expect(mutate(r => { r.reservationDigest = 'x' })).toMatch(/not the task's context/)
    expect(mutate(r => { r.candidateSafetyCap = 32 })).toMatch(/capture rule drift/)
    expect(mutate(r => { r.extent = { ...r.extent, maxSkillAdvance: 5 } })).toMatch(/Production default/)
    expect(mutate(r => { r.candidates[2]!.stableKey = 'current' })).toMatch(/excluded Route was delivered/)
    expect(mutate(r => { r.candidates[2]!.comparatorWithPrevious = 1 })).toMatch(/comparator/)
    expect(validatePhase2C26B2C2ARaw({ tasks: [task, taskOf(3)], runs: [runOf(task, withMatchAt(task, 5))], smoke: false }).join()).toMatch(/ran 1 of 2/)
    expect(validatePhase2C26B2C2ARaw({ tasks: [task], runs: [{ ...runOf(task, withMatchAt(task, 5)), task: taskOf(3) }], smoke: false }).join()).toMatch(/another task/)
  })

  it('finds the exact index per context and holds a policy only when the exact Candidate lies inside its prefix', () => {
    const task = taskOf(2)
    const at = (index: number) => phase2c26b2c2aCompareContext(runOf(task, withMatchAt(task, index)), task, true, ORACLE)
    expect(at(3)).toMatchObject({ coverage: 'exact', firstExactIndex: 3, firstExactCost: 2, hit: { C8: true, C32: true, C4C: true }, inconsistencies: [] })
    expect(at(10)).toMatchObject({ firstExactIndex: 10, hit: { C8: false, C32: true, C4C: true } })
    expect(at(40)).toMatchObject({ firstExactIndex: 40, hit: { C8: false, C32: false, C4C: true } })
    expect(phase2c26b2c2aCompareContext(runOf(task, miss(task)), task, true, ORACLE)).toMatchObject({ coverage: 'uncovered', firstExactIndex: null, hit: { C8: false, C32: false, C4C: false } })
    expect(phase2c26b2c2aCompareContext(runOf(task, null, 'timeout'), task, true, ORACLE)).toMatchObject({ measured: false, hit: { C4C: false } })
  })

  it('fails closed on an exact Candidate from an incompatible context and on a reservation violation (sentinel included)', () => {
    const task = taskOf(2)
    expect(phase2c26b2c2aCompareContext(runOf(task, withMatchAt(task, 3)), task, false, ORACLE).inconsistencies.join()).toMatch(/semantic_failure: .*reservation-incompatible/)
    const exactSentinel = capture(task, [summary({ estimatedOperationCount: 1 }), ...filler(2, 2), ...filler(1, 3, 10), ...filler(1, 4, 20)], 'four_cost_cohorts_drained', { ...MATCH, estimatedOperationCount: 5 })
    // An oracle Route of five operations, so that a cost-5 sentinel can match it.
    const dearOracle = { routes: [{ ...ORACLE_ROUTE, materialization: { ...ORACLE_ROUTE.materialization, estimated: { ...ORACLE_ROUTE.materialization.estimated, operations: 5 } } }], gogmaUsage: ORACLE_USAGE }
    const sentinelRow = phase2c26b2c2aCompareContext(runOf(task, exactSentinel), task, false, dearOracle)
    expect(sentinelRow).toMatchObject({ sentinelExact: true, hit: { C4C: false } })
    expect(sentinelRow.inconsistencies.join()).toMatch(/sentinel is exact from a reservation-incompatible/)
    const violating = withMatchAt(task, 3)
    violating.nextCostSentinel!.reservationCheck = { respects: false, blockedHits: { gogma: [12] }, exclusiveHit: [] }
    expect(phase2c26b2c2aCompareContext(runOf(task, violating), task, true, ORACLE).inconsistencies.join()).toMatch(/semantic_failure: .*violate the reservation/)
  })

  it('takes the smallest P1 rank per policy, keeps it at or after the first compatible rank, and classifies a miss', () => {
    const context = (rank: number, patch: Partial<Phase2C26B2C2AContextComparison>): Phase2C26B2C2AContextComparison => ({ taskId: `r${rank}`, targetWeaponId: TARGET, contextRank: rank, groupIndex: rank,
      measured: true, compatible: false, captureComplete: true, safetyCapHit: false, candidateCount: 10, capturedCosts: [1, 2, 3, 4], coverage: 'uncovered', exactIndexes: [], partialIndexes: [],
      firstExactIndex: null, firstExactCost: null, firstPartialIndex: null, hit: { C8: false, C32: false, C4C: false }, sentinelExact: false, reservationViolations: 0, inconsistencies: [], ...patch })
    const all = (patches: Record<number, Partial<Phase2C26B2C2AContextComparison>>) => Array.from({ length: 16 }, (_, i) => context(i + 1, patches[i + 1] ?? {}))
    const recovered = phase2c26b2c2aTargetRow(TARGET, all({ 3: { compatible: true, firstExactIndex: 40, firstExactCost: 4, hit: { C8: false, C32: false, C4C: true } },
      7: { compatible: true, firstExactIndex: 2, firstExactCost: 2, hit: { C8: true, C32: true, C4C: true } } }), 3, undefined, 4)
    expect(recovered.inconsistencies).toEqual([])
    expect(recovered.row.policies).toEqual({ C8: { firstExactContextRank: 7, firstExactCandidateIndex: 2, firstExactOperationCost: 2, deltaFromFirstCompatible: 4 },
      C32: { firstExactContextRank: 7, firstExactCandidateIndex: 2, firstExactOperationCost: 2, deltaFromFirstCompatible: 4 },
      C4C: { firstExactContextRank: 3, firstExactCandidateIndex: 40, firstExactOperationCost: 4, deltaFromFirstCompatible: 0 } })
    expect(recovered.row).toMatchObject({ recovery: 'C8', missClass: null, compatibleRanksInBudget: [3, 7], fullyMeasured: true })
    expect(phase2c26b2c2aTargetRow(TARGET, all({ 2: { compatible: true, hit: { C8: true, C32: true, C4C: true }, firstExactIndex: 0 } }), 3, undefined, 2).inconsistencies.join()).toMatch(/before the B2-C1 first compatible rank/)
    expect(phase2c26b2c2aTargetRow(TARGET, all({ 4: { measured: false } }), 3, undefined, 2).row.missClass).toBe('unmeasured')
    expect(phase2c26b2c2aTargetRow(TARGET, all({}), 3, undefined, 2).row.missClass).toBe('no_compatible_context_in_budget')
    expect(phase2c26b2c2aTargetRow(TARGET, all({ 3: { compatible: true, safetyCapHit: true, captureComplete: false } }), 3, undefined, 2).row.missClass).toBe('safety_cap_unresolved')
    expect(phase2c26b2c2aTargetRow(TARGET, all({ 3: { compatible: true } }), 3, undefined, 9).row.missClass).toBe('capture_insufficient')
    expect(phase2c26b2c2aTargetRow(TARGET, all({ 3: { compatible: true } }), 3, undefined, 2).row.missClass).toBe('compatible_non_delivery')
    expect(phase2c26b2c2aBudgetCoverage([recovered.row])).toEqual({ C8: { top1: 0, top2: 0, top4: 0, top8: 1, top12: 1, top16: 1 }, C32: { top1: 0, top2: 0, top4: 0, top8: 1, top12: 1, top16: 1 },
      C4C: { top1: 0, top2: 0, top4: 1, top8: 1, top12: 1, top16: 1 } })
  })

  it('searches every rank regardless of an earlier exact match and aggregates one Target end to end', () => {
    const tasks = Array.from({ length: 16 }, (_, i) => taskOf(i + 1))
    const runs = tasks.map(task => runOf(task, task.contextRank === 2 ? withMatchAt(task, 3) : task.contextRank === 9 ? withMatchAt(task, 1) : miss(task)))
    const result = runPhase2C26B2C2AAnalysis({ targetWeaponIds: [TARGET], tasks, runs, reach: [{ targetWeaponId: TARGET, compatibleGroupIndexes: [102, 109], p1FirstCompatibleRank: 2, inconsistencies: [] }],
      b2c1FirstCompatible: new Map([[TARGET, 2]]), oracle: ORACLE, smoke: true })
    expect(result.invalidReasons).toEqual([])
    expect(result.rows[0]).toMatchObject({ recovery: 'C8', policies: { C8: { firstExactContextRank: 2, firstExactCandidateIndex: 3, deltaFromFirstCompatible: 0 } } })
    expect(result.aggregates.compatibility).toMatchObject({ measured: 16, compatibleSearched: 2, compatibleWithExact: { C8: 2, C32: 2, C4C: 2 }, incompatibleWithExact: 0 })
    expect(result.aggregates.execution).toMatchObject({ completed: 16, targets: { fullyMeasured: 1 } })
    expect(result.decisionInput).toMatchObject({ tasks: 16, targets: 1, unmeasuredTasks: 0, exactTargets: { C8: 1, C32: 1, C4C: 1 } })
    // A recomputed first compatible rank other than B2-C1's is an authority mismatch.
    const drift = runPhase2C26B2C2AAnalysis({ targetWeaponIds: [TARGET], tasks, runs, reach: [{ targetWeaponId: TARGET, compatibleGroupIndexes: [102, 109], p1FirstCompatibleRank: 2, inconsistencies: [] }],
      b2c1FirstCompatible: new Map([[TARGET, 3]]), oracle: ORACLE, smoke: true })
    expect(drift.invalidReasons.join()).toMatch(/authority: .*not B2-C1's/)
    // An exact Candidate from a context the reachability calls incompatible fails closed.
    const incompatible = runPhase2C26B2C2AAnalysis({ targetWeaponIds: [TARGET], tasks, runs, reach: [{ targetWeaponId: TARGET, compatibleGroupIndexes: [102], p1FirstCompatibleRank: 2, inconsistencies: [] }],
      b2c1FirstCompatible: new Map([[TARGET, 2]]), oracle: ORACLE, smoke: true })
    expect(incompatible.invalidReasons.join()).toMatch(/semantic_failure: t00-r09: an exact Candidate from a reservation-incompatible context/)
    const mismatch = runPhase2C26B2C2AAnalysis({ targetWeaponIds: [TARGET], tasks, runs: runs.map((r, i) => i === 4 ? { ...r, outcome: { ...r.outcome, record: 'context_mismatch' as const }, record: { status: 'context_mismatch' as const, taskId: r.taskId, issues: ['x'] } } : r),
      reach: [{ targetWeaponId: TARGET, compatibleGroupIndexes: [102, 109], p1FirstCompatibleRank: 2, inconsistencies: [] }], b2c1FirstCompatible: new Map([[TARGET, 2]]), oracle: ORACLE, smoke: true })
    expect(mismatch.invalidReasons.join()).toMatch(/context mismatch/)
  })

  it('decides ALL_C8 / ALL_C32 / ALL_C4C / PARTIAL / INCOMPLETE / INVALID by the registered rule', () => {
    const d = (C8: number, C32: number, C4C: number, extra: Partial<Parameters<typeof phase2c26b2c2aDecision>[0]> = {}) =>
      phase2c26b2c2aDecision({ invalidReasons: [], tasks: 320, targets: 20, unmeasuredTasks: 0, exactTargets: { C8, C32, C4C }, unresolvedSafetyCapTargets: 0, ...extra }).case
    expect(d(20, 20, 20)).toBe('B2C2A_ALL_C8')
    expect(d(19, 20, 20)).toBe('B2C2A_ALL_C32')
    expect(d(15, 19, 20)).toBe('B2C2A_ALL_C4C')
    expect(d(10, 12, 19)).toBe('B2C2A_PARTIAL')
    expect(phase2c26b2c2aDecision({ invalidReasons: [], tasks: 320, targets: 20, unmeasuredTasks: 0, exactTargets: { C8: 0, C32: 0, C4C: 0 }, unresolvedSafetyCapTargets: 0 })).toMatchObject({ case: 'B2C2A_PARTIAL', noExactTarget: true })
    expect(d(10, 12, 19, { unresolvedSafetyCapTargets: 1 })).toBe('B2C2A_INCOMPLETE')
    expect(d(20, 20, 20, { unmeasuredTasks: 1 })).toBe('B2C2A_INCOMPLETE')
    expect(d(20, 20, 20, { invalidReasons: ['x'] })).toBe('B2C2A_INVALID')
    expect(d(20, 20, 20, { tasks: 319 })).toBe('B2C2A_INVALID')
    expect(d(19, 19, 19, { targets: 19, unresolvedSafetyCapTargets: 0 })).toBe('B2C2A_INVALID')
    expect(() => d(20, 19, 20)).toThrow()
    expect(() => d(10, 12, 19, { unresolvedSafetyCapTargets: 2 })).toThrow()
    expect(PHASE2C26B2C2A_DECISION_RULE.order).toHaveLength(7)
  })
})

// ---------------------------------------------------------------- isolation

describe('Phase 2-C2.6-B2-C2A isolation', () => {
  it('is never imported by Production and hard-codes no Target, Entry, OwnedWeapon or reservation', () => {
    const production = import.meta.glob(['../domain/**/*.ts', '../services/**/*.ts', '../workers/**/*.ts', '../pages/**/*.tsx', '../components/**/*.tsx', '../db/**/*.ts', '!../**/*.test.ts', '!../**/*.test.tsx'],
      { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    expect(Object.keys(production).length).toBeGreaterThan(50)
    expect(Object.entries(production).filter(([, source]) => /plannerGlobalPhase2C26B2C2A/.test(source)).map(([path]) => path)).toEqual([])
    for (const source of [searchSource, targetsSource, analysisSource, prepareSource, runnerSource, analyzerSource]) {
      expect(source).not.toMatch(/\bc\d+-p\d+\b|fnv1a32[-:][0-9a-f]{8}|[0-9a-f]{8}-[0-9a-f]{4}-|build-list\.|46bf2c78|c140578c|9733b090/)
    }
    for (const source of [searchSource, targetsSource, analysisSource]) expect(source).not.toMatch(/node:fs|readFile|import\.meta\.glob/)
  })

  it('keeps the oracle, its manifest and every earlier RESULT out of the Search side: only the analyzer reads them, after the run', () => {
    for (const source of [searchSource, runnerSource]) {
      // The character classes keep these names out of this file's own text (the Phase 2-A.5 isolation test reads it).
      expect(source).not.toMatch(/ORACLE_[1]657|1657|--oracle|--manifest|--b2c1-result|--b2b1-result|--b2b2a-result|--b2b2a2-result|gogmaUsage|plannerGlobal[O]racle|_RESULT|phase2c2OracleCoverage|Analysis'|Targets'|firstCompatible|supportTargetWeaponIds|phase2c26b2aReachability|materialization\.estimated/)
    }
    // The Search module never imports the population / authority module; the runner reads the manifest only.
    expect(searchSource).not.toMatch(/plannerGlobalPhase2C26B2C2ATargets|plannerGlobalPhase2C26B2C1Analysis/)
    expect(runnerSource).toMatch(/--targets/)
    expect(runnerSource).toMatch(/oracleGuidedPolicySelection: true, oracleGuidedTargetPopulation: true, contextOrderingUsesOracle: false, oracleReadBySearchChild: false, oracleMatchUsedForEarlyStop: false/)
    expect(prepareSource).toMatch(/--b2c1-result/)
    expect(prepareSource).not.toMatch(/--oracle|--manifest|visitPlannerAlternativeCandidates/)
    expect(analyzerSource).toMatch(/--oracle/)
    expect(analyzerSource).toMatch(/--manifest/)
    expect(analyzerSource).toMatch(/oracleGuidedPolicySelection: true, oracleGuidedTargetPopulation: true, contextOrderingUsesOracle: false, oracleReadBySearchChild: false, oracleMatchUsedForEarlyStop: false/)
    expect(analysisSource).toMatch(/phase2c26b2b2aCompare\(/)
    expect(analysisSource).toMatch(/phase2c26b2c1TargetReach\(/)
  })

  it('captures through the unchanged Production Search and existing Research helpers, with only the sentinel and the safety cap as stop rules and no early stop per Target', () => {
    expect(searchSource).toMatch(/visitPlannerAlternativeCandidates\(/)
    expect(searchSource).toMatch(/createPlannerAlternativeMaterializer\(/)
    expect(searchSource).toMatch(/summarizePhase2C2Entry\(/)
    expect(searchSource).toMatch(/respectsPhase2C2Reservation\(/)
    expect(searchSource).toMatch(/candidateStableKey\(/)
    expect(searchSource).toMatch(/compareConstrainedCandidates\(/)
    expect(searchSource).toMatch(/reconstructPhase2C26B2B2AContext\(/)
    expect(searchSource).toMatch(/derivePhase2C26B2C1Schedule|Phase2C26B2C1Schedule/)
    expect((searchSource.match(/'stop'/g) ?? []).length).toBe(2)
    expect(searchSource).toMatch(/if \(machine\.offer\(candidate\.estimatedOperationCount, deliveryIndex\) === 'sentinel'\) \{\s*nextCostSentinel = delivered\s*return 'stop'/)
    expect(searchSource).toMatch(/return safetyCapHit \? 'stop' : 'continue'/)
    // Every task of every Target runs: the pool walks the whole task list, no per-Target stop exists.
    expect(runnerSource).toMatch(/const stage1 = await pool\(stage1Tasks,/)
    expect(runnerSource).not.toMatch(/timeout_fallback|fallbackTasks|FALLBACK/)
    expect(runnerSource).toMatch(/derivePhase2C26B2C1Schedule\(/)
    for (const source of [searchSource, analysisSource, runnerSource, analyzerSource]) {
      expect(source).not.toMatch(/runPreparedPlannerAlternativeKernel|preparePlannerAlternativeKernel|createProductionPlan|runPhase2C2Kernel|runPhase2C2Baseline|runPlannerDeterministicSchedule|createPlannerAlternativeWhatIfComparison|searchCandidates\(/)
    }
    for (const source of [analysisSource, analyzerSource, targetsSource, prepareSource]) expect(source).not.toMatch(/visitPlannerAlternativeCandidates|runPhase2C26B2C2ASearch|runPhase2C26B2C2ATask\(/)
  })
})
