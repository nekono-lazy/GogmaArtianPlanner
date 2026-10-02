import { beforeEach, describe, expect, it, vi } from 'vitest'
import rawB2C2B1 from '../../docs/PLANNER_GLOBAL_PHASE2C26B2C2B1_RESULT.json?raw'
import rawB2C1 from '../../docs/PLANNER_GLOBAL_PHASE2C26B2C1_RESULT.json?raw'
import rawB2C2A from '../../docs/PLANNER_GLOBAL_PHASE2C26B2C2A_RESULT.json?raw'
import rawResult from '../../docs/PLANNER_GLOBAL_PHASE2C26B2C2B2A_RESULT.json?raw'
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
import { phase2c26b1SearchInputDigest } from './plannerGlobalPhase2C26B1'
import { reconstructPhase2C26B2B2AContext, type Phase2C26B2B2AContext } from './plannerGlobalPhase2C26B2B2A'
import type { Phase2C26B2B2A2DeliveredCandidate } from './plannerGlobalPhase2C26B2B2A2'
import { derivePhase2C26B2C1Schedule, type Phase2C26B2C1Schedule } from './plannerGlobalPhase2C26B2C1'
import { parsePhase2C26B2C2AB2C1Authority, PHASE2C26B2C2A_REGISTERED_B2C1 } from './plannerGlobalPhase2C26B2C2ATargets'
import {
  buildPhase2C26B2C2B2ATasks,
  parsePhase2C26B2C2B2ATargetManifest,
  phase2c26b2c2b2aL2Context,
  phase2c26b2c2b2aPolicyDrift,
  phase2c26b2c2b2aTaskOutcome,
  runPhase2C26B2C2B2ASearch,
  runPhase2C26B2C2B2ATask,
  PHASE2C26B2C2B2A_CANDIDATE_SAFETY_CAP,
  PHASE2C26B2C2B2A_CAPTURE_PREFIXES,
  PHASE2C26B2C2B2A_CONTEXT_BUDGET,
  PHASE2C26B2C2B2A_EXPECTED_TASKS,
  PHASE2C26B2C2B2A_EXTENT,
  PHASE2C26B2C2B2A_MAX_COST_COHORTS,
  PHASE2C26B2C2B2A_NOT_RUN,
  PHASE2C26B2C2B2A_REGISTERED_P1,
  PHASE2C26B2C2B2A_STAGE1,
  PHASE2C26B2C2B2A_TARGET_SOURCE,
  PHASE2C26B2C2B2A_TARGETS,
  type Phase2C26B2C2B2ASearchRecord,
  type Phase2C26B2C2B2ATaskInput,
} from './plannerGlobalPhase2C26B2C2B2A'
import searchSource from './plannerGlobalPhase2C26B2C2B2A.ts?raw'
import {
  parsePhase2C26B2C2B2AB2C2B1Authority,
  phase2c26b2c2b2aPopulation,
  phase2c26b2c2b2aTargetManifest,
  PHASE2C26B2C2B2A_REGISTERED_B2C2B1,
} from './plannerGlobalPhase2C26B2C2B2ATargets'
import targetsSource from './plannerGlobalPhase2C26B2C2B2ATargets.ts?raw'
import {
  parsePhase2C26B2C2B2AB2C2ADiagnostic,
  phase2c26b2c2b2aEvidenceGrade,
  phase2c26b2c2b2aLaunchProvenance,
  phase2c26b2c2b2aBudgetCoverage,
  phase2c26b2c2b2aCompareContext,
  phase2c26b2c2b2aDecision,
  phase2c26b2c2b2aPolicyLength,
  phase2c26b2c2b2aTargetRow,
  runPhase2C26B2C2B2AAnalysis,
  validatePhase2C26B2C2B2ARaw,
  PHASE2C26B2C2B2A_DECISION_RULE,
  PHASE2C26B2C2B2A_REGISTERED_B2C2A,
  type Phase2C26B2C2B2AContextComparison,
  type Phase2C26B2C2B2ARun,
} from './plannerGlobalPhase2C26B2C2B2AAnalysis'
import analysisSource from './plannerGlobalPhase2C26B2C2B2AAnalysis.ts?raw'
import prepareSource from '../../scripts/prepare-planner-global-phase2c26b2c2b2a-targets.mjs?raw'
import runnerSource from '../../scripts/run-planner-global-phase2c26b2c2b2a.mjs?raw'
import analyzerSource from '../../scripts/analyze-planner-global-phase2c26b2c2b2a.mjs?raw'
import reconstructSource from '../../scripts/reconstruct-planner-global-phase2c26b2c2b2a-partial-raw.mjs?raw'

/*
 * Issue #154 Phase 2-C2.6-B2-C2B2A: the E1 Targets searched in their P1 top-32 contexts at the common L2 extent. The
 * synthetic worlds below are invented for the tests; the committed B2-C2B1 / B2-C1 / B2-C2A RESULTs are read only to check
 * the authorities. The oracle modules are never imported here (the Phase 2-A.5 isolation rule).
 */

/** Every Search input, in call order; `script` replays one real Candidate with the scripted operation costs (as in B2-C2A). */
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

const b2c2b1Json = JSON.parse(rawB2C2B1)
const b2c2b1Sha = PHASE2C26B2C2B2A_REGISTERED_B2C2B1.resultSha256
const b2c1Json = JSON.parse(rawB2C1)
const b2c1Sha = PHASE2C26B2C2A_REGISTERED_B2C1.resultSha256
const L2 = { maxNormalAdvance: 128, maxGogmaAdvance: 235, maxSkillAdvance: 1500 }

// ---------------------------------------------------------------- the E1 authority, population and manifest

describe('Phase 2-C2.6-B2-C2B2A E1 authority and Target manifest', () => {
  it('accepts the committed formal B2-C2B1 RESULT and fails closed on any registered value', () => {
    const parsed = parsePhase2C26B2C2B2AB2C2B1Authority(b2c2b1Json, b2c2b1Sha)
    expect(parsed.issues).toEqual([])
    expect(parsed.authority!.e1).toHaveLength(11)
    expect(parsed.authority!.e2).toHaveLength(9)
    expect(Math.max(...parsed.authority!.routes.filter(r => r.cohort === 'E1').map(r => r.p1FirstCompatibleRank))).toBe(32)
    expect(PHASE2C26B2C2B2A_REGISTERED_B2C2B1.rungs.map(r => r.id)).toEqual(['L0', 'L1', 'L2'])
    expect(PHASE2C26B2C2B2A_REGISTERED_B2C2B1.rungs[2]!.extent).toEqual(L2)
    expect(parsePhase2C26B2C2B2AB2C2B1Authority(b2c2b1Json, '0'.repeat(64)).valid).toBe(false)
    const mutate = (patch: (j: typeof b2c2b1Json) => void) => { const copy = structuredClone(b2c2b1Json); patch(copy); return parsePhase2C26B2C2B2AB2C2B1Authority(copy, b2c2b1Sha).valid }
    expect(mutate(() => undefined)).toBe(true)
    expect(mutate(j => { j.provenance.formal = false })).toBe(false)
    expect(mutate(j => { j.provenance.calculationCodeChangedSinceMeasuredHead = ['src/x.ts'] })).toBe(false)
    expect(mutate(j => { j.provenance.oracleReadByCalculation = true })).toBe(false)
    expect(mutate(j => { j.provenance.targetIndividualOracleExtentAsSearchInput = true })).toBe(false)
    expect(mutate(j => { j.provenance.b2c1ResultSha256 = '0'.repeat(64) })).toBe(false)
    expect(mutate(j => { j.provenance.r2ResultSha256 = '0'.repeat(64) })).toBe(false)
    expect(mutate(j => { j.decision.case = 'B2C2B1_UNBOUNDED' })).toBe(false)
    expect(mutate(j => { j.decision.case = 'B2C2B1_INVALID' })).toBe(false)
    expect(mutate(j => { j.invalidReasons = ['x'] })).toBe(false)
    expect(mutate(j => { j.cohorts.counts.e1 = 10 })).toBe(false)
    expect(mutate(j => { j.cohorts.counts.unreached = 4 })).toBe(false)
    expect(mutate(j => { j.cohorts.counts.defaultExtent = 19 })).toBe(false)
    expect(mutate(j => { j.cohorts.e1 = j.cohorts.e1.slice(1) })).toBe(false)
    expect(mutate(j => { j.routes.find((r: { cohort: string }) => r.cohort === 'E1').p1FirstCompatibleRank = 33 })).toBe(false)
    expect(mutate(j => { j.routes.find((r: { cohort: string }) => r.cohort === 'E2').cohort = 'E1' })).toBe(false)
    expect(mutate(j => { j.routes.pop() })).toBe(false)
    expect(mutate(j => { j.ladder.rungs[2].extent.maxSkillAdvance = 1024 })).toBe(false)
    expect(mutate(j => { j.ladder.rungs.pop() })).toBe(false)
    expect(mutate(j => { j.ladderCoverage.e1.byRung[2].covered = 10 })).toBe(false)
    expect(mutate(j => { j.conditions.p1.keys[0][1] = 'desc' })).toBe(false)
    expect(mutate(j => { const chain = j.hashChain.exportSha256; chain[Object.keys(chain)[0]!] = '0'.repeat(64) })).toBe(false)
    expect(mutate(j => { j.unreadableTargets = ['x'] })).toBe(false)
    expect(parsePhase2C26B2C2B2AB2C2B1Authority(null, b2c2b1Sha).valid).toBe(false)
  })

  it('re-derives E1 as the 11 B2-C1 extentInsufficient AND k1Minimal Targets, disjoint from E2 / defaultExtent / unreached', () => {
    const authority = parsePhase2C26B2C2B2AB2C2B1Authority(b2c2b1Json, b2c2b1Sha).authority!
    const b2c1 = parsePhase2C26B2C2AB2C1Authority(b2c1Json, b2c1Sha).authority!
    const population = phase2c26b2c2b2aPopulation(authority, b2c1)
    expect(population.issues).toEqual([])
    expect(population.e1).toHaveLength(PHASE2C26B2C2B2A_TARGETS)
    const sub = (name: string) => new Set(b2c1.routes.filter(r => r.subgroups.includes(name)).map(r => r.targetWeaponId))
    const expected = b2c1.routes.filter(r => r.subgroups.includes('extentInsufficient') && r.subgroups.includes('k1Minimal')).map(r => r.targetWeaponId).sort()
    expect(population.e1).toEqual(expected)
    for (const name of ['defaultExtent', 'unreached', 'k2Minimal']) expect(population.e1.filter(id => sub(name).has(id))).toEqual([])
    expect(population.e1.filter(id => authority.e2.includes(id))).toEqual([])
    // A B2-C1 subgroup drift is a population mismatch.
    const drift = structuredClone(b2c1)
    drift.routes.find(r => r.targetWeaponId === population.e1[0])!.subgroups.push('defaultExtent')
    expect(phase2c26b2c2b2aPopulation(authority, drift).valid).toBe(false)
    const rank = structuredClone(b2c1)
    rank.routes.find(r => r.targetWeaponId === population.e1[0])!.p1FirstCompatible.rank = 99
    expect(phase2c26b2c2b2aPopulation(authority, rank).issues.join()).toMatch(/different P1 first compatible ranks/)
    expect(phase2c26b2c2b2aPopulation({ ...authority, exportSha256: '0'.repeat(64) }, b2c1).valid).toBe(false)
  })

  it('writes E1 as 11 sorted Target IDs and nothing else, exactly what the Search runner accepts', () => {
    const authority = parsePhase2C26B2C2B2AB2C2B1Authority(b2c2b1Json, b2c2b1Sha).authority!
    const b2c1 = parsePhase2C26B2C2AB2C1Authority(b2c1Json, b2c1Sha).authority!
    const manifest = phase2c26b2c2b2aTargetManifest(authority, b2c1)
    expect(manifest.targetWeaponIds).toEqual([...b2c2b1Json.cohorts.e1].sort())
    expect(manifest).toMatchObject({ sourceResultSha256: PHASE2C26B2C2B2A_TARGET_SOURCE.resultSha256, population: 'E1', policy: 'P1', contextBudget: 32, exportSha256: b2c2b1Json.provenance.exportSha256 })
    expect(Object.keys(manifest).sort()).toEqual(['contextBudget', 'exportSha256', 'phase', 'policy', 'population', 'sourceResultSha256', 'targetWeaponIds'])
    expect(JSON.stringify(manifest)).not.toMatch(/rank|fnv1a32|firstCompatible|required|maxSkill|maxNormal|L1|L2|K1:|oracle/i)
    expect(parsePhase2C26B2C2B2ATargetManifest(structuredClone(manifest))).toMatchObject({ valid: true, issues: [] })
    const bad = (patch: (m: Record<string, unknown> & typeof manifest) => void) => { const copy = structuredClone(manifest) as Record<string, unknown> & typeof manifest; patch(copy); return parsePhase2C26B2C2B2ATargetManifest(copy).valid }
    expect(bad(m => { m.targetWeaponIds = [...m.targetWeaponIds.slice(0, 10), m.targetWeaponIds[0]!].sort() })).toBe(false)
    expect(bad(m => { m.targetWeaponIds = m.targetWeaponIds.slice(1) })).toBe(false)
    expect(bad(m => { m.targetWeaponIds = [...m.targetWeaponIds].reverse() })).toBe(false)
    expect(bad(m => { m.sourceResultSha256 = '0'.repeat(64) })).toBe(false)
    expect(bad(m => { (m as Record<string, unknown>).population = 'defaultExtent' })).toBe(false)
    expect(bad(m => { (m as Record<string, unknown>).policy = 'P2' })).toBe(false)
    expect(bad(m => { m.contextBudget = 16 })).toBe(false)
    for (const field of ['firstCompatibleRanks', 'requiredExtents', 'oracleRoutes', 'expectedStableKeys', 'expectedCandidateIndex', 'expectedCost', 'routeKinds', 'compatibility', 'extent']) {
      expect(bad(m => { m[field] = {} })).toBe(false)
    }
    expect(parsePhase2C26B2C2B2ATargetManifest([]).valid).toBe(false)
  })

  it('reads the B2-C2A RESULT for the diagnostic runtime comparison only, failing closed on another SHA-256, case or predecessor', () => {
    const json = JSON.parse(rawB2C2A)
    const expected = { b2c1ResultSha256: b2c1Sha, exportSha256: b2c2b1Json.provenance.exportSha256 }
    const ok = parsePhase2C26B2C2B2AB2C2ADiagnostic(json, PHASE2C26B2C2B2A_REGISTERED_B2C2A.resultSha256, expected)
    expect(ok.issues).toEqual([])
    expect(ok.diagnostic!.stage1).toMatchObject({ concurrency: 3, childHeapMb: 8192 })
    expect(parsePhase2C26B2C2B2AB2C2ADiagnostic(json, '0'.repeat(64), expected).valid).toBe(false)
    expect(parsePhase2C26B2C2B2AB2C2ADiagnostic({ ...json, decision: { case: 'B2C2A_ALL_C8' } }, PHASE2C26B2C2B2A_REGISTERED_B2C2A.resultSha256, expected).valid).toBe(false)
    expect(parsePhase2C26B2C2B2AB2C2ADiagnostic(json, PHASE2C26B2C2B2A_REGISTERED_B2C2A.resultSha256, { ...expected, exportSha256: '0'.repeat(64) }).valid).toBe(false)
  })
})

// ---------------------------------------------------------------- a synthetic world (Search positions beyond L2)

const SOURCE_A_SKILL = 'series_skill.fixture.z'
const SOURCE_B_SKILL = 'series_skill.fixture.b-source'

function world() {
  const skill = { seriesSkillId: SOURCE_A_SKILL, groupSkillId: null, matchMode: 'all' as const }
  const a: TargetWeapon = orchestrationTarget('target.b2c2b2a.a', { priority: 5, idealSkillCondition: skill, practicalSkillCondition: skill })
  const b = skillConstrainedTarget('target.b2c2b2a.b', { priority: 1 })
  const built = orchestrationScenario({
    engine: { gogmaPositions: L2.maxGogmaAdvance + 8, skillPositions: L2.maxSkillAdvance + 8 },
    targets: [a, b],
    ownedWeapons: [orchestrationSource(ORCHESTRATION_SOURCE_A, { seriesSkillId: SOURCE_A_SKILL }),
      orchestrationSource(ORCHESTRATION_SOURCE_B, { restorationBonuses: belowPracticalBonuses(), seriesSkillId: SOURCE_B_SKILL })],
    entries: [
      orchestrationEntry('build-list.b2c2b2a.a', a, resetRoute(ORCHESTRATION_SOURCE_A), { finalBonuses: idealBonuses(), seriesSkillId: SOURCE_A_SKILL }),
      orchestrationEntry('build-list.b2c2b2a.b', b, { kind: 'existing_gogma_mixed', sourceOwnedWeaponId: resetRoute(ORCHESTRATION_SOURCE_B).sourceOwnedWeaponId,
        operations: [...resetRoute(ORCHESTRATION_SOURCE_B).operations, ...resetSkillsRoute(ORCHESTRATION_SOURCE_B).operations] }),
    ],
  })
  const schedule = derivePhase2C26B2C1Schedule(built.input, globalResearchDependencies(built.engine))
  return { built, schedule }
}
const IDS = ['target.b2c2b2a.a', 'target.b2c2b2a.b']

function defaultContextOf(schedule: Phase2C26B2C1Schedule, id = 'target.b2c2b2a.b', rank = 2): Phase2C26B2B2AContext {
  const row = schedule.contexts.find(c => c.targetWeaponId === id && c.ranks.P1 === rank)!
  const rebuilt = reconstructPhase2C26B2B2AContext(schedule.snapshot, { targetWeaponId: id, fixedSetId: row.representativeFixedSetId, cardinality: row.targetEligibleMinCardinality, reservationDigest: row.reservationDigest })
  if (!rebuilt.valid) throw new Error(rebuilt.issues.join())
  return rebuilt.context
}
function l2ContextOf(schedule: Phase2C26B2C1Schedule, id = 'target.b2c2b2a.b', rank = 2) {
  const l2 = phase2c26b2c2b2aL2Context(defaultContextOf(schedule, id, rank))
  if (!l2.valid) throw new Error(l2.issues.join())
  return l2.context
}

// ---------------------------------------------------------------- the L2 context and task construction

describe('Phase 2-C2.6-B2-C2B2A L2 context and task construction', () => {
  it('registers 11 E1 Targets x 32 P1 ranks = 352 tasks, the common L2 extent, the C4C capture and the Stage 1 conditions', () => {
    expect([PHASE2C26B2C2B2A_TARGETS, PHASE2C26B2C2B2A_CONTEXT_BUDGET, PHASE2C26B2C2B2A_EXPECTED_TASKS]).toEqual([11, 32, 352])
    expect(PHASE2C26B2C2B2A_EXTENT).toEqual(L2)
    expect(Object.isFrozen(PHASE2C26B2C2B2A_EXTENT)).toBe(true)
    expect([PHASE2C26B2C2B2A_MAX_COST_COHORTS, PHASE2C26B2C2B2A_CANDIDATE_SAFETY_CAP]).toEqual([4, 1024])
    expect(PHASE2C26B2C2B2A_CAPTURE_PREFIXES).toEqual({ C8: 8, C32: 32 })
    expect(PHASE2C26B2C2B2A_STAGE1).toEqual({ executionClass: 'stage1', childHeapMb: 8192, concurrency: 1, budgetMs: 600_000, retry: 'none', fallback: 'none' })
    expect(PHASE2C26B2C2B2A_REGISTERED_P1).toEqual({ id: 'P1', name: 'default_simple_first', keys: [['targetEligibleMinCardinality', 'asc'], ['exclusiveOwnedWeaponCount', 'asc'],
      ['blockedCountDefaultTotal', 'asc'], ['shareableHeldCountDefaultTotal', 'desc'], ['reservationDigest', 'asc']] })
    for (const item of ['l0_search', 'l1_search', 'per_target_extent', 'e2_search', 'retry', 'timeout_fallback', 'context_level_early_stop', 'target_level_early_stop']) expect(PHASE2C26B2C2B2A_NOT_RUN).toContain(item)
  })

  it('replaces the extent of the unchanged reconstruction by L2 and nothing else, recomputing the Search input digest by the B1 digest', () => {
    const { schedule } = world()
    const base = defaultContextOf(schedule)
    expect(base.extent).toEqual({ ...defaultPlannerAlternativeSearchExtent })
    const l2 = phase2c26b2c2b2aL2Context(base)
    expect(l2.valid).toBe(true)
    if (!l2.valid) return
    const { extent, searchInputDigest, defaultSearchInputDigest, ...rest } = l2.context
    const { extent: baseExtent, searchInputDigest: baseDigest, ...baseRest } = base
    expect(rest).toEqual(baseRest)
    expect(extent).toEqual(L2)
    expect(baseExtent).toEqual({ ...defaultPlannerAlternativeSearchExtent })
    expect(defaultSearchInputDigest).toBe(baseDigest)
    expect(searchInputDigest).not.toBe(baseDigest)
    expect(searchInputDigest).toBe(phase2c26b1SearchInputDigest({ orientationId: '', workIndex: 0, targetWeaponId: base.targetWeaponId, status: 'searchable',
      invalidatedBuildListEntryId: base.currentBuildListEntryId, invalidatedRouteKey: base.currentRouteKey, fixedRouteBuildListEntryIds: base.fixedBuildListEntryIds,
      reservation: base.reservation, searchReservation: base.reservation, excludedRouteKeys: base.excludedRouteKeys, extent: L2, originDigest: base.originDigest, contextDigest: '' }))
    // Fails closed: a non-default input, any extent other than the common L2 (a Target-specific one included), a tampered digest or reservation.
    expect(phase2c26b2c2b2aL2Context({ ...base, extent: { ...L2 } }).valid).toBe(false)
    expect(phase2c26b2c2b2aL2Context(base, { ...L2, maxSkillAdvance: 1083 }).valid).toBe(false)
    expect(phase2c26b2c2b2aL2Context(base, { maxNormalAdvance: 8, maxGogmaAdvance: 235, maxSkillAdvance: 256 }).valid).toBe(false)
    expect(phase2c26b2c2b2aL2Context({ ...base, searchInputDigest: 'other' }).valid).toBe(false)
    expect(phase2c26b2c2b2aL2Context({ ...base, reservationDigest: 'other' }).valid).toBe(false)
  })

  it('takes every P1 rank 1..N of every Target from the schedule, each at the common L2 extent with both digests', () => {
    const { schedule } = world()
    expect(schedule.extent).toEqual({ ...defaultPlannerAlternativeSearchExtent })
    const budget = Math.min(...IDS.map(id => schedule.contexts.filter(c => c.targetWeaponId === id).length))
    expect(budget).toBeGreaterThanOrEqual(2)
    const built = buildPhase2C26B2C2B2ATasks(schedule, IDS, budget)
    expect(built.issues).toEqual([])
    expect(built.tasks).toHaveLength(IDS.length * budget)
    for (const [targetIndex, id] of IDS.entries()) {
      const tasks = built.tasks.filter(t => t.targetWeaponId === id)
      expect(tasks.map(t => t.contextRank)).toEqual(Array.from({ length: budget }, (_, i) => i + 1))
      expect(tasks.map(t => t.taskId)).toEqual(tasks.map(t => `t0${targetIndex}-r${String(t.contextRank).padStart(2, '0')}`))
      for (const task of tasks) {
        const row = schedule.contexts.find(c => c.targetWeaponId === id && c.ranks.P1 === task.contextRank)!
        expect(task).toMatchObject({ groupIndex: row.groupIndex, reservationDigest: row.reservationDigest, targetEligibleMinCardinality: row.targetEligibleMinCardinality,
          representativeFixedSetId: row.representativeFixedSetId, policy: 'P1', maxCostCohorts: 4, candidateSafetyCap: 1024, extent: L2 })
        const base = defaultContextOf(schedule, id, task.contextRank)
        expect(task.defaultSearchInputDigest).toBe(base.searchInputDigest)
        expect(task.searchInputDigest).toBe(l2ContextOf(schedule, id, task.contextRank).searchInputDigest)
      }
    }
    expect(new Set(built.tasks.map(t => JSON.stringify(t.extent))).size).toBe(1)
    // No oracle field and no Target-specific extent rides on a task.
    expect(Object.keys(built.tasks[0]!).sort()).toEqual(['candidateSafetyCap', 'contextRank', 'defaultSearchInputDigest', 'executionClass', 'extent', 'groupIndex', 'maxCostCohorts', 'policy',
      'representativeFixedSetId', 'representativeFixedTargetWeaponIds', 'reservationDigest', 'searchInputDigest', 'targetEligibleMinCardinality', 'targetWeaponId', 'taskId'])
  })

  it('fails closed on too few contexts, an unknown or repeated Target, a rank gap or duplicate, a P1 drift and a non-default schedule extent', () => {
    const { schedule } = world()
    const fewest = Math.min(...IDS.map(id => schedule.contexts.filter(c => c.targetWeaponId === id).length))
    const issues = (s: Phase2C26B2C1Schedule, ids = IDS, budget = fewest) => buildPhase2C26B2C2B2ATasks(s, ids, budget).issues.join('\n')
    expect(issues(schedule, IDS, fewest + 1)).toMatch(/fewer than the budget/)
    expect(buildPhase2C26B2C2B2ATasks(schedule, IDS, fewest + 1).tasks).toEqual([])
    expect(issues(schedule, [...IDS, 'target.none'])).toMatch(/not a schedule Target/)
    expect(issues(schedule, [IDS[0]!, IDS[0]!])).toMatch(/repeats/)
    const gap = structuredClone(schedule); gap.contexts.find(c => c.targetWeaponId === IDS[0] && c.ranks.P1 === 2)!.ranks.P1 = 9
    expect(issues(gap)).toMatch(/missing or repeated/)
    const dup = structuredClone(schedule); dup.contexts.find(c => c.targetWeaponId === IDS[0] && c.ranks.P1 === 2)!.ranks.P1 = 1
    expect(issues(dup)).toMatch(/missing or repeated/)
    const drift = structuredClone(schedule); (drift as { policies: unknown }).policies = drift.policies.map(p => p.id === 'P1' ? { ...p, keys: [...p.keys].reverse() } : p)
    expect(phase2c26b2c2b2aPolicyDrift(drift)).toEqual(['the schedule P1 is not the registered P1 definition'])
    expect(issues(drift)).toMatch(/registered P1/)
    const extent = structuredClone(schedule); extent.extent = { ...L2 }
    expect(issues(extent)).toMatch(/Production default extent/)
  })
})

// ---------------------------------------------------------------- the Search child

const CAPTURE = { maxCostCohorts: PHASE2C26B2C2B2A_MAX_COST_COHORTS, candidateSafetyCap: PHASE2C26B2C2B2A_CANDIDATE_SAFETY_CAP }
const PROVENANCE = { contextRank: 2, targetEligibleMinCardinality: 1, representativeFixedSetId: 'K1:x', representativeFixedTargetWeaponIds: ['t'] }

describe('Phase 2-C2.6-B2-C2B2A Search child', () => {
  it('gives visitPlannerAlternativeCandidates() exactly the rebuilt origin, reservation, exclusion and the common L2 extent', async () => {
    const { built, schedule } = world()
    const context = l2ContextOf(schedule)
    searchCalls.script = [1, 2, 3, 4, 5]
    const record = await runPhase2C26B2C2B2ASearch(built.input, context, built.engine, CAPTURE, PROVENANCE, { now: () => 0 })
    expect(searchCalls.inputs).toEqual([{ origin: createPlannerStartSearchOrigin(built.input), targetWeaponId: 'target.b2c2b2a.b', extent: L2,
      reservation: context.reservation, excludedRouteKeys: context.excludedRouteKeys }])
    expect(record).toMatchObject({ extent: L2, searchInputDigest: context.searchInputDigest, defaultSearchInputDigest: context.defaultSearchInputDigest, termination: 'four_cost_cohorts_drained' })
  })

  it('stops at the first Candidate of a fifth cost (the sentinel, outside the capture) and at nothing else', async () => {
    const { built, schedule } = world()
    searchCalls.script = [1, 1, 2, 3, 3, 4, 4, 5, 5]
    const record = await runPhase2C26B2C2B2ASearch(built.input, l2ContextOf(schedule), built.engine, CAPTURE, PROVENANCE)
    expect(searchCalls.decisions).toEqual([...Array(7).fill('continue'), 'stop'])
    expect(record.candidates.map(c => c.orderingKeys.estimatedOperationCount)).toEqual([1, 1, 2, 3, 3, 4, 4])
    expect(record.nextCostSentinel).toMatchObject({ deliveryIndex: 7, orderingKeys: { estimatedOperationCount: 5 } })
    expect(record).toMatchObject({ termination: 'four_cost_cohorts_drained', status: 'consumer_stop', captureComplete: true, safetyCapHit: false, capturedCosts: [1, 2, 3, 4] })
    searchCalls.script = [1, 2, 2]
    expect(await runPhase2C26B2C2B2ASearch(built.input, l2ContextOf(schedule), built.engine, CAPTURE, PROVENANCE)).toMatchObject({ termination: 'exhausted', captureComplete: true, nextCostSentinel: null })
    searchCalls.script = [7]
    searchCalls.endByExtent = true
    expect(await runPhase2C26B2C2B2ASearch(built.input, l2ContextOf(schedule), built.engine, CAPTURE, PROVENANCE)).toMatchObject({ termination: 'stopped_by_extent', captureComplete: true })
  })

  it('stops at the safety cap without claiming a complete capture, and refuses another capture rule or a non-L2 extent', async () => {
    const { built, schedule } = world()
    const context = l2ContextOf(schedule)
    searchCalls.script = Array(PHASE2C26B2C2B2A_CANDIDATE_SAFETY_CAP + 5).fill(2)
    const record = await runPhase2C26B2C2B2ASearch(built.input, context, built.engine, CAPTURE, PROVENANCE)
    expect(searchCalls.decisions).toHaveLength(PHASE2C26B2C2B2A_CANDIDATE_SAFETY_CAP)
    expect(record).toMatchObject({ termination: 'candidate_safety_cap', captureComplete: false, safetyCapHit: true, nextCostSentinel: null })
    await expect(runPhase2C26B2C2B2ASearch(built.input, context, built.engine, { ...CAPTURE, candidateSafetyCap: 32 }, PROVENANCE)).rejects.toThrow(/safety cap/)
    await expect(runPhase2C26B2C2B2ASearch(built.input, context, built.engine, { ...CAPTURE, maxCostCohorts: 1 }, PROVENANCE)).rejects.toThrow(/cost cohorts/)
    await expect(runPhase2C26B2C2B2ASearch(built.input, { ...context, extent: { ...defaultPlannerAlternativeSearchExtent } }, built.engine, CAPTURE, PROVENANCE)).rejects.toThrow(/common L2 extent/)
    await expect(runPhase2C26B2C2B2ASearch(built.input, { ...context, extent: { ...L2, maxSkillAdvance: 1083 } }, built.engine, CAPTURE, PROVENANCE)).rejects.toThrow(/common L2 extent/)
  }, 120_000)

  it('selects its context by Target and P1 rank from its own schedule and reports any drift as a context mismatch without searching', async () => {
    const { built, schedule } = world()
    const task = buildPhase2C26B2C2B2ATasks(schedule, IDS, 2).tasks.find(t => t.targetWeaponId === 'target.b2c2b2a.b' && t.contextRank === 2)!
    searchCalls.script = [1, 2, 3, 4, 5]
    expect(await runPhase2C26B2C2B2ATask(built.input, schedule, task, built.engine)).toMatchObject({ status: 'searched', search: { contextRank: 2, extent: L2, termination: 'four_cost_cohorts_drained' } })
    searchCalls.inputs = []
    const mismatch = async (patch: Partial<Phase2C26B2C2B2ATaskInput>) => runPhase2C26B2C2B2ATask(built.input, schedule, { ...task, ...patch }, built.engine)
    expect(await mismatch({ searchInputDigest: 'other' })).toMatchObject({ status: 'context_mismatch', issues: ['searchInputDigest'] })
    expect(await mismatch({ defaultSearchInputDigest: 'other' })).toMatchObject({ status: 'context_mismatch', issues: ['defaultSearchInputDigest'] })
    expect(await mismatch({ extent: { ...L2, maxSkillAdvance: 1083 } })).toMatchObject({ status: 'context_mismatch', issues: ['extent'] })
    expect(await mismatch({ extent: { ...defaultPlannerAlternativeSearchExtent } })).toMatchObject({ status: 'context_mismatch', issues: ['extent'] })
    expect(await mismatch({ reservationDigest: 'other' })).toMatchObject({ status: 'context_mismatch', issues: ['reservationDigest'] })
    expect(await mismatch({ contextRank: 99 })).toMatchObject({ status: 'context_mismatch', issues: ['P1 rank 99 holds 0 contexts'] })
    const drift = structuredClone(schedule); (drift as { policies: unknown }).policies = []
    expect(await runPhase2C26B2C2B2ATask(built.input, drift, task, built.engine)).toMatchObject({ status: 'context_mismatch' })
    const wide = structuredClone(schedule); wide.extent = { ...L2 }
    expect(await runPhase2C26B2C2B2ATask(built.input, wide, task, built.engine)).toMatchObject({ status: 'context_mismatch', issues: ['schedule extent'] })
    expect(searchCalls.inputs).toEqual([])
  })

  it('records a timeout / out of memory / failure as that failure, never as no Candidate', () => {
    expect(phase2c26b2c2b2aTaskOutcome('t', 'timeout', null)).toEqual({ taskId: 't', process: 'timeout', record: null, searchStatus: null, termination: null, candidateCount: null })
    expect(phase2c26b2c2b2aTaskOutcome('t', 'out_of_memory', null)).toMatchObject({ process: 'out_of_memory', candidateCount: null })
    expect(phase2c26b2c2b2aTaskOutcome('t', 'completed', null).process).toBe('process_failure')
    expect(phase2c26b2c2b2aTaskOutcome('t', 'completed', { status: 'context_mismatch', taskId: 't', issues: ['x'] }).record).toBe('context_mismatch')
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
const ORACLE_ROUTE = { targetWeaponId: TARGET, sourceKind: 'owned', sourceOwnedWeaponId: 'w2', normalPosition: null, conversionPosition: null, normal: { first: null, last: null, operations: 0 },
  gogma: { first: 11, last: 13, operations: 2, required: [13] }, skill: { first: null, last: null, operations: 0, required: [] }, routeOperationCount: 2,
  finalBonuses: [], finalScope: 'gogma_artian', finalSeriesSkillId: null, finalGroupSkillId: null,
  materialization: { method: 'planner_alternative_search', routeKind: 'existing_gogma_reset_bonuses', estimated: { operations: 2, normal: null, gogma: 13, skill: 0 } } }
const ORACLE_USAGE = [{ position: 11, targetWeaponId: TARGET, type: 'reset_bonuses', required: false }, { position: 13, targetWeaponId: TARGET, type: 'reset_bonuses', required: true }]
const MATCH = summary({ sourceOwnedWeaponId: 'w2', estimatedAdvances: { normal: null, gogma: 13, skill: 0 },
  gogma: { first: 11, last: 13, operations: 2, positions: [[11, 11], [13, 13]], required: [13], crossesHeldPositions: true, startsAfterOrigin: true },
  gogmaTypeRuns: [[11, 11, 'reset_bonuses'], [13, 13, 'reset_bonuses']], heldRoute: true })
const ORACLE = { routes: [ORACLE_ROUTE], gogmaUsage: ORACLE_USAGE }
/** The same oracle Route with an incomplete Gogma usage: MATCH is then only partial_comparable. */
const PARTIAL_ORACLE = { routes: [ORACLE_ROUTE], gogmaUsage: [ORACLE_USAGE[1]!] }

function taskOf(rank: number, patch: Partial<Phase2C26B2C2B2ATaskInput> = {}): Phase2C26B2C2B2ATaskInput {
  return { taskId: `t00-r${String(rank).padStart(2, '0')}`, executionClass: 'stage1', targetWeaponId: TARGET, contextRank: rank, policy: 'P1', groupIndex: 100 + rank,
    reservationDigest: `d${rank}`, targetEligibleMinCardinality: rank === 1 ? 0 : 1, representativeFixedSetId: rank === 1 ? 'K0' : `K1:e${rank}`, representativeFixedTargetWeaponIds: rank === 1 ? [] : [`x${rank}`],
    defaultSearchInputDigest: `s${rank}`, searchInputDigest: `l${rank}`, extent: { ...L2 }, maxCostCohorts: 4, candidateSafetyCap: 1024, ...patch }
}
function delivered(s: Phase2C2CandidateSummary, index: number): Phase2C26B2B2A2DeliveredCandidate {
  return { deliveryIndex: index, stableKey: `k${String(index).padStart(5, '0')}`, orderingKeys: { estimatedOperationCount: s.estimatedOperationCount, estimatedGogmaAdvance: s.estimatedAdvances.gogma,
    estimatedSkillAdvance: s.estimatedAdvances.skill, estimatedNormalAdvance: s.estimatedAdvances.normal, preferredSourceRank: 0 }, comparatorWithPrevious: index === 0 ? null : -1,
    summary: s, reservationCheck: { respects: true, blockedHits: {}, exclusiveHit: [] } }
}
const filler = (n: number, cost: number, from = 0) => Array.from({ length: n }, (_, i) => summary({ sourceOwnedWeaponId: `other-${from + i}`, estimatedOperationCount: cost, estimatedAdvances: { normal: null, gogma: 1, skill: 0 } }))

function capture(task: Phase2C26B2C2B2ATaskInput, summaries: Phase2C2CandidateSummary[], termination: Phase2C26B2C2B2ASearchRecord['termination'], sentinel: Phase2C2CandidateSummary | null = null): Phase2C26B2C2B2ASearchRecord {
  const candidates = summaries.map(delivered)
  const status = termination === 'four_cost_cohorts_drained' || termination === 'candidate_safety_cap' ? 'consumer_stop' : termination
  const costs = [...new Set(summaries.map(s => s.estimatedOperationCount))]
  return { targetWeaponId: task.targetWeaponId, contextRank: task.contextRank, groupIndex: task.groupIndex, reservationDigest: task.reservationDigest, targetEligibleMinCardinality: task.targetEligibleMinCardinality,
    representativeFixedSetId: task.representativeFixedSetId, representativeFixedTargetWeaponIds: [...task.representativeFixedTargetWeaponIds], defaultSearchInputDigest: task.defaultSearchInputDigest,
    searchInputDigest: task.searchInputDigest, extent: { ...L2 }, excludedRouteKeys: ['current'], preferredOwnedWeaponId: null, maxCostCohorts: 4, candidateSafetyCap: 1024, status,
    summary: { deliveredCandidates: candidates.length + (sentinel ? 1 : 0), excludedCandidates: 0, exhausted: status === 'exhausted', stoppedByExtent: status === 'stopped_by_extent', stoppedByConsumer: status === 'consumer_stop' },
    candidates, nextCostSentinel: sentinel ? delivered(sentinel, candidates.length) : null, termination, captureComplete: termination !== 'candidate_safety_cap', safetyCapHit: termination === 'candidate_safety_cap',
    capturedCosts: costs, distinctCostCohorts: costs.length, nonmonotonicIndexes: [], costReadIssues: [], elapsedMs: 1 }
}
function runOf(task: Phase2C26B2C2B2ATaskInput, record: Phase2C26B2C2B2ASearchRecord | null, process: 'completed' | 'timeout' | 'out_of_memory' | 'process_failure' = 'completed'): Phase2C26B2C2B2ARun {
  const child = record === null ? null : { status: 'searched' as const, taskId: task.taskId, search: record }
  return { taskId: task.taskId, task, outcome: phase2c26b2c2b2aTaskOutcome(task.taskId, process, process === 'completed' ? child : null),
    process: { outcome: process, wallMs: 10, timedOut: process === 'timeout', budgetMs: 1 }, childWallMs: 9, scheduleMs: 1, yields: 3,
    memory: process === 'completed' ? { sampledMaxHeapUsedBytes: 100, sampledMaxRssBytes: 200, maxRssKiB: 1 } : null, lastIpcMemory: { maxHeapUsedBytes: 50, maxRssBytes: 300 },
    record: process === 'completed' ? child : null }
}
/** Cost 1 x1, cost 2 x(n) with the oracle Route at `at`, then costs 3 and 4, then the sentinel. */
function withMatchAt(task: Phase2C26B2C2B2ATaskInput, at: number) {
  return capture(task, [summary({ estimatedOperationCount: 1, sourceOwnedWeaponId: 'cheap' }), ...filler(Math.max(at - 1, 0), 2), { ...MATCH }, ...filler(3, 3, 100), ...filler(2, 4, 200)],
    'four_cost_cohorts_drained', summary({ estimatedOperationCount: 5, sourceOwnedWeaponId: 'dear' }))
}
const miss = (task: Phase2C26B2C2B2ATaskInput) => capture(task, [summary({ estimatedOperationCount: 1, sourceOwnedWeaponId: 'cheap' }), ...filler(5, 2)], 'exhausted')
const reachOf = (groups: number[], first: number | null = 2) => [{ targetWeaponId: TARGET, compatibleGroupIndexes: groups, p1FirstCompatibleRank: first, inconsistencies: [] }]

describe('Phase 2-C2.6-B2-C2B2A analysis', () => {
  it('validates the raw capture: L2 extent, both digests, cost cohorts, sentinel, comparator, termination and nonmonotonic costs', () => {
    const task = taskOf(2)
    const check = (record: Phase2C26B2C2B2ASearchRecord, t = task) => validatePhase2C26B2C2B2ARaw({ tasks: [t], runs: [runOf(t, record)], smoke: false })
    expect(check(withMatchAt(task, 5))).toEqual([])
    const mutate = (patch: (r: Phase2C26B2C2B2ASearchRecord) => void) => { const r = withMatchAt(task, 5); patch(r); return check(r).join('\n') }
    expect(mutate(r => { r.candidates[4]!.orderingKeys.estimatedOperationCount = 1; r.candidates[4]!.summary = { ...r.candidates[4]!.summary, estimatedOperationCount: 1 } })).toMatch(/semantic_failure: .*nonmonotonic/)
    expect(mutate(r => { r.capturedCosts = [1, 2, 3] })).toMatch(/cohorts drift/)
    expect(mutate(r => { r.nextCostSentinel!.orderingKeys.estimatedOperationCount = 4 })).toMatch(/sentinel is not the first Candidate of a fifth cost/)
    expect(mutate(r => { r.captureComplete = false })).toMatch(/termination disagrees/)
    expect(mutate(r => { r.extent = { ...defaultPlannerAlternativeSearchExtent } })).toMatch(/not the common L2 extent/)
    expect(mutate(r => { r.extent = { ...L2, maxSkillAdvance: 1083 } })).toMatch(/not the common L2 extent/)
    expect(mutate(r => { r.defaultSearchInputDigest = 'x' })).toMatch(/not the task's context/)
    expect(mutate(r => { r.searchInputDigest = 'x' })).toMatch(/not the task's context/)
    expect(mutate(r => { r.candidateSafetyCap = 32 })).toMatch(/capture rule drift/)
    expect(mutate(r => { r.candidates[2]!.stableKey = 'current' })).toMatch(/excluded Route was delivered/)
    expect(mutate(r => { r.candidates[2]!.comparatorWithPrevious = 1 })).toMatch(/comparator/)
    // A Target-specific extent on a task, a missing task, a task run twice, a run outside the plan.
    const individual = taskOf(2, { extent: { ...L2, maxSkillAdvance: 1083 } })
    expect(validatePhase2C26B2C2B2ARaw({ tasks: [individual], runs: [], smoke: true }).join()).toMatch(/task extent is not the common L2 extent/)
    expect(validatePhase2C26B2C2B2ARaw({ tasks: [task, taskOf(3)], runs: [runOf(task, withMatchAt(task, 5))], smoke: false }).join()).toMatch(/ran 1 of 2/)
    expect(validatePhase2C26B2C2B2ARaw({ tasks: [task], runs: [runOf(task, withMatchAt(task, 5)), runOf(task, withMatchAt(task, 5))], smoke: true }).join()).toMatch(/ran twice/)
    expect(validatePhase2C26B2C2B2ARaw({ tasks: [task], runs: [runOf(taskOf(9), miss(taskOf(9)))], smoke: true }).join()).toMatch(/not a planned task/)
  })

  it('cuts C8 / C32 from the one C4C capture and holds a policy only when the exact Candidate lies inside its prefix', () => {
    expect([phase2c26b2c2b2aPolicyLength('C8', 433), phase2c26b2c2b2aPolicyLength('C32', 433), phase2c26b2c2b2aPolicyLength('C4C', 433)]).toEqual([8, 32, 433])
    expect([phase2c26b2c2b2aPolicyLength('C8', 4), phase2c26b2c2b2aPolicyLength('C32', 4), phase2c26b2c2b2aPolicyLength('C4C', 4)]).toEqual([4, 4, 4])
    const task = taskOf(2)
    const at = (index: number) => phase2c26b2c2b2aCompareContext(runOf(task, withMatchAt(task, index)), task, true, ORACLE)
    expect(at(3)).toMatchObject({ coverage: 'exact', firstExactIndex: 3, firstExactCost: 2, hit: { C8: true, C32: true, C4C: true }, inconsistencies: [] })
    expect(at(10)).toMatchObject({ firstExactIndex: 10, hit: { C8: false, C32: true, C4C: true } })
    expect(at(40)).toMatchObject({ firstExactIndex: 40, hit: { C8: false, C32: false, C4C: true } })
    expect(phase2c26b2c2b2aCompareContext(runOf(task, miss(task)), task, true, ORACLE)).toMatchObject({ coverage: 'uncovered', hit: { C8: false, C32: false, C4C: false } })
    expect(phase2c26b2c2b2aCompareContext(runOf(task, null, 'timeout'), task, true, ORACLE)).toMatchObject({ measured: false, hit: { C4C: false } })
  })

  it('fails closed on an exact or partial Candidate (or sentinel) from an incompatible context and on a reservation violation', () => {
    const task = taskOf(2)
    expect(phase2c26b2c2b2aCompareContext(runOf(task, withMatchAt(task, 3)), task, false, ORACLE).inconsistencies.join()).toMatch(/semantic_failure: .*exact Candidate from a reservation-incompatible/)
    const partial = phase2c26b2c2b2aCompareContext(runOf(task, withMatchAt(task, 3)), task, false, PARTIAL_ORACLE)
    expect(partial).toMatchObject({ coverage: 'partial_comparable', hit: { C4C: false } })
    expect(partial.inconsistencies.join()).toMatch(/semantic_failure: .*partial Candidate from a reservation-incompatible/)
    // A compatible partial is legal.
    expect(phase2c26b2c2b2aCompareContext(runOf(task, withMatchAt(task, 3)), task, true, PARTIAL_ORACLE).inconsistencies).toEqual([])
    const dear = (oracle: typeof ORACLE) => ({ routes: [{ ...ORACLE_ROUTE, materialization: { ...ORACLE_ROUTE.materialization, estimated: { ...ORACLE_ROUTE.materialization.estimated, operations: 5 } } }], gogmaUsage: oracle.gogmaUsage })
    const withSentinel = capture(task, [summary({ estimatedOperationCount: 1 }), ...filler(2, 2), ...filler(1, 3, 10), ...filler(1, 4, 20)], 'four_cost_cohorts_drained', { ...MATCH, estimatedOperationCount: 5 })
    const exactSentinel = phase2c26b2c2b2aCompareContext(runOf(task, withSentinel), task, false, dear(ORACLE))
    expect(exactSentinel).toMatchObject({ sentinelExact: true, hit: { C4C: false } })
    expect(exactSentinel.inconsistencies.join()).toMatch(/sentinel is exact from a reservation-incompatible/)
    const partialSentinel = phase2c26b2c2b2aCompareContext(runOf(task, withSentinel), task, false, dear(PARTIAL_ORACLE))
    expect(partialSentinel).toMatchObject({ sentinelPartial: true })
    expect(partialSentinel.inconsistencies.join()).toMatch(/sentinel is partial from a reservation-incompatible/)
    const violating = withMatchAt(task, 3)
    violating.nextCostSentinel!.reservationCheck = { respects: false, blockedHits: { gogma: [12] }, exclusiveHit: [] }
    expect(phase2c26b2c2b2aCompareContext(runOf(task, violating), task, true, ORACLE).inconsistencies.join()).toMatch(/semantic_failure: .*violate the reservation/)
  })

  it('takes the smallest P1 rank per policy over 32 ranks: before the first compatible rank fails closed, after it is a legal measurement', () => {
    const context = (rank: number, patch: Partial<Phase2C26B2C2B2AContextComparison>): Phase2C26B2C2B2AContextComparison => ({ taskId: `r${rank}`, targetWeaponId: TARGET, contextRank: rank, groupIndex: rank,
      measured: true, compatible: false, captureComplete: true, safetyCapHit: false, candidateCount: 10, capturedCosts: [1, 2, 3, 4], coverage: 'uncovered', exactIndexes: [], partialIndexes: [],
      firstExactIndex: null, firstExactCost: null, firstPartialIndex: null, hit: { C8: false, C32: false, C4C: false }, sentinelExact: false, sentinelPartial: false, reservationViolations: 0, inconsistencies: [], ...patch })
    const all = (patches: Record<number, Partial<Phase2C26B2C2B2AContextComparison>>) => Array.from({ length: 32 }, (_, i) => context(i + 1, patches[i + 1] ?? {}))
    const later = phase2c26b2c2b2aTargetRow(TARGET, all({ 20: { compatible: true }, 27: { compatible: true, firstExactIndex: 40, firstExactCost: 4, hit: { C8: false, C32: false, C4C: true } } }), 20, undefined, 4)
    expect(later.inconsistencies).toEqual([])
    expect(later.row).toMatchObject({ recovery: 'C4C', fullyMeasured: true, compatibleRanksInBudget: [20, 27], compatibleWithExactRanks: [27], compatibleWithoutExactRanks: [20],
      policies: { C4C: { firstExactContextRank: 27, deltaFromFirstCompatible: 7 }, C8: { firstExactContextRank: null } } })
    expect(phase2c26b2c2b2aTargetRow(TARGET, all({ 2: { compatible: true, hit: { C8: true, C32: true, C4C: true }, firstExactIndex: 0 } }), 3, undefined, 2).inconsistencies.join()).toMatch(/before the B2-C1 first compatible rank/)
    expect(phase2c26b2c2b2aTargetRow(TARGET, all({ 31: { measured: false } }), 3, undefined, 2).row).toMatchObject({ missClass: 'unmeasured', fullyMeasured: false })
    expect(phase2c26b2c2b2aTargetRow(TARGET, all({}), 3, undefined, 2).row.missClass).toBe('no_compatible_context_in_budget')
    expect(phase2c26b2c2b2aTargetRow(TARGET, all({ 3: { compatible: true, safetyCapHit: true, captureComplete: false } }), 3, undefined, 2).row.missClass).toBe('safety_cap_unresolved')
    expect(phase2c26b2c2b2aTargetRow(TARGET, all({ 3: { compatible: true } }), 3, undefined, 9).row.missClass).toBe('capture_insufficient')
    expect(phase2c26b2c2b2aTargetRow(TARGET, all({ 3: { compatible: true } }), 3, undefined, 2).row.missClass).toBe('compatible_non_delivery')
    // 16 contexts are not a fully measured Target here.
    expect(phase2c26b2c2b2aTargetRow(TARGET, all({}).slice(0, 16), 3, undefined, 2).row.fullyMeasured).toBe(false)
    expect(phase2c26b2c2b2aBudgetCoverage([later.row])).toEqual({ C8: { top1: 0, top2: 0, top4: 0, top8: 0, top16: 0, top32: 0 }, C32: { top1: 0, top2: 0, top4: 0, top8: 0, top16: 0, top32: 0 },
      C4C: { top1: 0, top2: 0, top4: 0, top8: 0, top16: 0, top32: 1 } })
  })

  it('searches every rank regardless of an earlier exact match and aggregates one Target end to end', () => {
    const tasks = Array.from({ length: 32 }, (_, i) => taskOf(i + 1))
    const runs = tasks.map(task => runOf(task, task.contextRank === 2 ? withMatchAt(task, 3) : task.contextRank === 30 ? withMatchAt(task, 1) : miss(task)))
    const result = runPhase2C26B2C2B2AAnalysis({ targetWeaponIds: [TARGET], tasks, runs, reach: reachOf([102, 130]), b2c1FirstCompatible: new Map([[TARGET, 2]]), oracle: ORACLE, smoke: false })
    expect(result.invalidReasons).toEqual([])
    expect(result.rows[0]).toMatchObject({ recovery: 'C8', fullyMeasured: true, policies: { C8: { firstExactContextRank: 2, firstExactCandidateIndex: 3, deltaFromFirstCompatible: 0 } } })
    expect(result.aggregates.compatibility).toMatchObject({ measured: 32, compatibleSearched: 2, compatibleWithExact: { C8: 2, C32: 2, C4C: 2 }, incompatibleWithExact: 0, incompatibleWithPartial: 0 })
    expect(result.aggregates.execution).toMatchObject({ completed: 32, timeout: 0, targets: { fullyMeasured: 1 } })
    expect(result.aggregates.firstExactEqualsFirstCompatible).toEqual({ recoveredC4C: 1, equal: 1, later: 0 })
    expect(result.decisionInput).toMatchObject({ tasks: 32, targets: 1, unmeasuredTasks: 0, exactTargets: { C8: 1, C32: 1, C4C: 1 } })
    // A timeout is unmeasured, never a miss.
    const timedOut = runPhase2C26B2C2B2AAnalysis({ targetWeaponIds: [TARGET], tasks, runs: runs.map((r, i) => i === 5 ? runOf(r.task, null, 'timeout') : r), reach: reachOf([102, 130]),
      b2c1FirstCompatible: new Map([[TARGET, 2]]), oracle: ORACLE, smoke: false })
    expect(timedOut.decisionInput.unmeasuredTasks).toBe(1)
    expect(timedOut.aggregates.execution).toMatchObject({ timeout: 1, completed: 31, targets: { fullyMeasured: 0, partiallyMeasured: 1 } })
    // A recomputed first compatible rank other than B2-C1's is an authority mismatch.
    const drift = runPhase2C26B2C2B2AAnalysis({ targetWeaponIds: [TARGET], tasks, runs, reach: reachOf([102, 130]), b2c1FirstCompatible: new Map([[TARGET, 3]]), oracle: ORACLE, smoke: false })
    expect(drift.invalidReasons.join()).toMatch(/authority: .*not B2-C1's/)
    const incompatible = runPhase2C26B2C2B2AAnalysis({ targetWeaponIds: [TARGET], tasks, runs, reach: reachOf([102]), b2c1FirstCompatible: new Map([[TARGET, 2]]), oracle: ORACLE, smoke: false })
    expect(incompatible.invalidReasons.join()).toMatch(/semantic_failure: t00-r30: an exact Candidate from a reservation-incompatible context/)
    const mismatch = runPhase2C26B2C2B2AAnalysis({ targetWeaponIds: [TARGET], tasks, runs: runs.map((r, i) => i === 4 ? { ...r, outcome: { ...r.outcome, record: 'context_mismatch' as const }, record: { status: 'context_mismatch' as const, taskId: r.taskId, issues: ['x'] } } : r),
      reach: reachOf([102, 130]), b2c1FirstCompatible: new Map([[TARGET, 2]]), oracle: ORACLE, smoke: false })
    expect(mismatch.invalidReasons.join()).toMatch(/context mismatch/)
    const outside = runPhase2C26B2C2B2AAnalysis({ targetWeaponIds: ['other'], tasks, runs, reach: [], b2c1FirstCompatible: new Map(), oracle: ORACLE, smoke: true })
    expect(outside.invalidReasons.join()).toMatch(/a task outside the manifest/)
  })

  it('analyzes an intentionally stopped run: ran tasks a prefix, the rest notRun (never Candidate 0), never promoted past INCOMPLETE', () => {
    const tasks = Array.from({ length: 32 }, (_, i) => taskOf(i + 1))
    const ran = tasks.slice(0, 12).map(task => runOf(task, task.contextRank === 2 ? withMatchAt(task, 3) : task.contextRank === 10 ? null : miss(task), task.contextRank === 10 ? 'timeout' : 'completed'))
    const stop = { stoppedAt: '2026-10-02T12:44:17.919Z', reason: 'owner stop', notRunTaskIds: tasks.slice(12).map(t => t.taskId) }
    const result = runPhase2C26B2C2B2AAnalysis({ targetWeaponIds: [TARGET], tasks, runs: ran, reach: reachOf([102]), b2c1FirstCompatible: new Map([[TARGET, 2]]), oracle: ORACLE, smoke: false, intentionalStop: stop })
    expect(result.invalidReasons).toEqual([])
    expect(result.aggregates.execution).toMatchObject({ tasks: 32, started: 12, completed: 11, timeout: 1, notRun: 20,
      perTarget: [{ targetWeaponId: TARGET, planned: 32, started: 12, completed: 11, timeout: 1, outOfMemory: 0, notRun: 20 }] })
    expect(result.contexts.filter(c => !c.measured).map(c => c.candidateCount)).toEqual(Array(21).fill(null))
    expect(result.decisionInput).toMatchObject({ unmeasuredTasks: 21, exactTargets: { C8: 1, C32: 1, C4C: 1 } })
    // Even with every Target recovered, notRun tasks keep the case INCOMPLETE.
    expect(phase2c26b2c2b2aDecision({ invalidReasons: [], ...result.decisionInput, tasks: 352, targets: 11, exactTargets: { C8: 11, C32: 11, C4C: 11 } }).case).toBe('B2C2B2A_INCOMPLETE')
    // Without the stop record the missing tasks are a raw failure; a non-prefix or a wrong notRun list fails closed.
    expect(runPhase2C26B2C2B2AAnalysis({ targetWeaponIds: [TARGET], tasks, runs: ran, reach: reachOf([102]), b2c1FirstCompatible: new Map([[TARGET, 2]]), oracle: ORACLE, smoke: false }).invalidReasons.join()).toMatch(/ran 12 of 32/)
    expect(validatePhase2C26B2C2B2ARaw({ tasks, runs: [ran[0]!, ran[2]!], smoke: false, intentionalStop: { ...stop, notRunTaskIds: tasks.slice(2).map(t => t.taskId) } }).join()).toMatch(/not a prefix/)
    expect(validatePhase2C26B2C2B2ARaw({ tasks, runs: ran, smoke: false, intentionalStop: { ...stop, notRunTaskIds: stop.notRunTaskIds.slice(1) } }).join()).toMatch(/notRun tasks are not exactly/)
  })

  it('verifies launch provenance only from the runner itself: a reconstructed raw without a start attestation is never formal', () => {
    const environment = { repositoryHead: 'a'.repeat(40), uncommittedBenchmarkCode: false, benchmarkCodeSha256: 'b'.repeat(64), exportSha256: 'c'.repeat(64), targetManifestSha256: 'd'.repeat(64),
      stage1: { ...PHASE2C26B2C2B2A_STAGE1 } }
    const reconstruction = { postHoc: true, childRecordsModified: false }
    // A completed raw written by the runner attests its own launch environment.
    expect(phase2c26b2c2b2aLaunchProvenance({ status: 'completed', environment })).toMatchObject({ verified: true, source: 'runner_raw', workingTreeCleanVerified: true })
    expect(phase2c26b2c2b2aLaunchProvenance({ status: 'completed', environment: { ...environment, uncommittedBenchmarkCode: true } }).verified).toBe(false)
    // The reconstructed intentional stop: no start attestation, whatever HEAD / cleanliness the reconstruction wrote.
    const none = phase2c26b2c2b2aLaunchProvenance({ status: 'intentionally_stopped', environment, reconstruction })
    expect(none).toMatchObject({ verified: false, source: 'none', workingTreeCleanVerified: false })
    expect(none.reason).toMatch(/did not persist an immutable start attestation/)
    expect(phase2c26b2c2b2aLaunchProvenance({ status: 'intentionally_stopped', environment: { ...environment, uncommittedBenchmarkCode: null }, reconstruction }).verified).toBe(false)
    expect(phase2c26b2c2b2aLaunchProvenance({ status: 'completed', environment, reconstruction }).verified).toBe(false)
    // An arbitrary --measured-head given to the reconstruction cannot make it formal.
    for (const head of ['0'.repeat(40), 'f'.repeat(40)]) expect(phase2c26b2c2b2aLaunchProvenance({ status: 'intentionally_stopped', environment: { ...environment, repositoryHead: head }, reconstruction }).verified).toBe(false)
    // A runner start attestation verifies only when complete, runner-authored, clean and equal to the environment.
    const attestation = { ...environment, createdAt: '2026-10-02T10:13:21.000Z', attestedBy: 'runner' }
    expect(phase2c26b2c2b2aLaunchProvenance({ status: 'intentionally_stopped', environment, reconstruction, launchAttestation: attestation })).toMatchObject({ verified: true, source: 'runner_start_attestation' })
    expect(phase2c26b2c2b2aLaunchProvenance({ status: 'intentionally_stopped', environment, reconstruction, launchAttestation: { ...attestation, attestedBy: 'reconstruction' } }).verified).toBe(false)
    expect(phase2c26b2c2b2aLaunchProvenance({ status: 'intentionally_stopped', environment, reconstruction, launchAttestation: { ...attestation, repositoryHead: '0'.repeat(40) } }).verified).toBe(false)
    expect(phase2c26b2c2b2aLaunchProvenance({ status: 'intentionally_stopped', environment, reconstruction, launchAttestation: { ...attestation, uncommittedBenchmarkCode: null } }).verified).toBe(false)
    const missing: Record<string, unknown> = { ...attestation }
    delete missing.createdAt
    expect(phase2c26b2c2b2aLaunchProvenance({ status: 'intentionally_stopped', environment, reconstruction, launchAttestation: missing }).verified).toBe(false)
    // The evidence grade: formal needs both axes; a partial run without verified launch provenance is diagnostic.
    expect(phase2c26b2c2b2aEvidenceGrade({ formalConditions: true, launchProvenanceVerified: true, partialRun: true })).toBe('formal')
    expect(phase2c26b2c2b2aEvidenceGrade({ formalConditions: true, launchProvenanceVerified: false, partialRun: true })).toBe('diagnostic_partial')
    expect(phase2c26b2c2b2aEvidenceGrade({ formalConditions: true, launchProvenanceVerified: false, partialRun: false })).toBe('non_formal')
    expect(phase2c26b2c2b2aEvidenceGrade({ formalConditions: false, launchProvenanceVerified: true, partialRun: false })).toBe('non_formal')
  })

  it('counts an unresolved safety cap only on a compatible context of a Target without a C4C exact', () => {
    const tasks = Array.from({ length: 32 }, (_, i) => taskOf(i + 1))
    const capped = (task: Phase2C26B2C2B2ATaskInput) => capture(task, filler(1024, 2), 'candidate_safety_cap')
    const runs = tasks.map(task => runOf(task, task.contextRank === 4 || task.contextRank === 9 ? capped(task) : miss(task)))
    const compatibleCap = runPhase2C26B2C2B2AAnalysis({ targetWeaponIds: [TARGET], tasks, runs, reach: reachOf([104], 4), b2c1FirstCompatible: new Map([[TARGET, 4]]), oracle: ORACLE, smoke: false })
    expect(compatibleCap.invalidReasons).toEqual([])
    expect(compatibleCap.decisionInput.unresolvedSafetyCapTargets).toBe(1)
    const incompatibleCap = runPhase2C26B2C2B2AAnalysis({ targetWeaponIds: [TARGET], tasks, runs, reach: reachOf([105], 5), b2c1FirstCompatible: new Map([[TARGET, 5]]), oracle: ORACLE, smoke: false })
    expect(incompatibleCap.decisionInput.unresolvedSafetyCapTargets).toBe(0)
  })

  it('decides ALL_C8 / ALL_C32 / ALL_C4C / PARTIAL / INCOMPLETE / INVALID by the registered rule', () => {
    const d = (C8: number, C32: number, C4C: number, extra: Partial<Parameters<typeof phase2c26b2c2b2aDecision>[0]> = {}) =>
      phase2c26b2c2b2aDecision({ invalidReasons: [], tasks: 352, targets: 11, unmeasuredTasks: 0, exactTargets: { C8, C32, C4C }, unresolvedSafetyCapTargets: 0, ...extra }).case
    expect(d(11, 11, 11)).toBe('B2C2B2A_ALL_C8')
    expect(d(10, 11, 11)).toBe('B2C2B2A_ALL_C32')
    expect(d(8, 10, 11)).toBe('B2C2B2A_ALL_C4C')
    expect(d(5, 7, 10)).toBe('B2C2B2A_PARTIAL')
    expect(phase2c26b2c2b2aDecision({ invalidReasons: [], tasks: 352, targets: 11, unmeasuredTasks: 0, exactTargets: { C8: 0, C32: 0, C4C: 0 }, unresolvedSafetyCapTargets: 0 })).toMatchObject({ case: 'B2C2B2A_PARTIAL', noExactTarget: true })
    expect(d(5, 7, 10, { unresolvedSafetyCapTargets: 1 })).toBe('B2C2B2A_INCOMPLETE')
    expect(d(11, 11, 11, { unmeasuredTasks: 1 })).toBe('B2C2B2A_INCOMPLETE')
    expect(d(11, 11, 11, { invalidReasons: ['x'] })).toBe('B2C2B2A_INVALID')
    expect(d(11, 11, 11, { invalidReasons: ['x'], unmeasuredTasks: 5 })).toBe('B2C2B2A_INVALID')
    expect(d(11, 11, 11, { tasks: 351 })).toBe('B2C2B2A_INVALID')
    expect(d(10, 10, 10, { targets: 10 })).toBe('B2C2B2A_INVALID')
    expect(() => d(11, 10, 11)).toThrow()
    expect(() => d(5, 7, 10, { unresolvedSafetyCapTargets: 2 })).toThrow()
    expect(PHASE2C26B2C2B2A_DECISION_RULE.order.map(line => line.split(':')[0])).toEqual(['B2C2B2A_INVALID', 'B2C2B2A_INCOMPLETE', 'B2C2B2A_ALL_C8', 'B2C2B2A_ALL_C32', 'B2C2B2A_ALL_C4C', 'B2C2B2A_INCOMPLETE', 'B2C2B2A_PARTIAL'])
  })
})

// ---------------------------------------------------------------- the committed formal RESULT

describe('Phase 2-C2.6-B2-C2B2A committed RESULT', () => {
  const result = JSON.parse(rawResult)
  it('pins the intentionally stopped partial run: non-formal diagnostic evidence, INCOMPLETE, 44 / 352 started, 308 notRun, no invalid reason', () => {
    // Evidence grade (provenance) and the Search decision are separate axes.
    expect(result.provenance).toMatchObject({ formal: false, evidenceGrade: 'diagnostic_partial', partialRun: true, launchProvenanceVerified: false, launchProvenanceSource: 'none',
      launchWorkingTreeCleanVerified: false, launchAttestation: null, uncommittedBenchmarkCode: null, measuredHeadSource: 'post_hoc_reconstruction_argument',
      reconstructedMeasuredHead: '32130e843cabcb3777f6675a84fa580d114ed27d', measuredHead: '32130e843cabcb3777f6675a84fa580d114ed27d',
      calculationCodeChangedSinceMeasuredHead: [], measurementCodeChangedSinceMeasuredHead: [], analysisCodeUncommitted: false, smoke: null, b2c2b1ResultSha256: PHASE2C26B2C2B2A_REGISTERED_B2C2B1.resultSha256, b2c1ResultSha256: b2c1Sha, perTargetExtent: false, targetIndividualOracleExtentAsSearchInput: false,
      oracleReadBySearchChild: false, oracleMatchUsedForEarlyStop: false })
    expect(result.provenance.launchProvenanceReason).toMatch(/did not persist an immutable start attestation .*reconstructed post hoc/)
    expect(result.provenance.benchmarkCodeSha256Source).toMatch(/recomputed post hoc/)
    expect(result.provenance.reconstruction).toMatchObject({ postHoc: true, childRecordsModified: false, searchRun: false })
    // Only post-hoc analysis files and tests changed after the measurement candidate HEAD.
    expect(result.provenance.codeChangedSinceMeasuredHead.every((path: string) => result.provenance.postHocAllowedFiles.includes(path) || path.endsWith('.test.ts'))).toBe(true)
    expect(result.provenance.postHocAllowedFiles).toEqual(['src/benchmarks/plannerGlobalPhase2C26B2C2B2AAnalysis.ts', 'scripts/analyze-planner-global-phase2c26b2c2b2a.mjs',
      'scripts/reconstruct-planner-global-phase2c26b2c2b2a-partial-raw.mjs', '*.test.ts'])
    // The retained raw is the one reconstructed before this provenance correction; its recorded flag is kept only as such.
    expect(result.sources.run.sha256).toBe('d393c263d17a05e769d024df62a929efac2c260741e5e2273234c61e344dcb6f')
    expect(result.provenance.rawRecordedUncommittedBenchmarkCode).toBe(false)
    expect(result.provenance.intentionalStop).toMatchObject({ ranTasks: 44, notRunTasks: 308, noRetry: true, conditionsUnchanged: true })
    expect(result.decision).toMatchObject({ case: 'B2C2B2A_INCOMPLETE', reasons: [] })
    expect(result.invalidReasons).toEqual([])
    expect(Object.values(result.parity.hashChain).every(Boolean)).toBe(true)
    expect(Object.values(result.parity.scheduleParity).every(v => v === true || v === 352)).toBe(true)
    expect(result.conditions).toMatchObject({ searchExtent: L2, scheduleExtent: { ...defaultPlannerAlternativeSearchExtent }, contextBudget: 32, expectedTasks: 352,
      stage1: { ...PHASE2C26B2C2B2A_STAGE1 }, ladderRungsSearched: ['L2'] })
    expect(result.aggregates.execution).toMatchObject({ tasks: 352, started: 44, completed: 35, timeout: 7, outOfMemory: 2, processFailure: 0, contextMismatch: 0, notRun: 308,
      targets: { total: 11, fullyMeasured: 0, partiallyMeasured: 2, unmeasured: 9 } })
    expect(result.aggregates.execution.perTarget.map((r: { started: number; completed: number; timeout: number; outOfMemory: number; notRun: number }) =>
      [r.started, r.completed, r.timeout, r.outOfMemory, r.notRun])).toEqual([[32, 25, 5, 2, 0], [12, 10, 2, 0, 20], ...Array(9).fill([0, 0, 0, 0, 32])])
    expect(result.aggregates.exactTargets).toEqual({ C8: 2, C32: 2, C4C: 2 })
    expect(result.aggregates.compatibility).toMatchObject({ measured: 35, compatibleSearched: 6, compatibleWithExact: { C4C: 6 }, incompatibleWithExact: 0, incompatibleWithPartial: 0 })
    expect(result.aggregates.candidates.reservationViolations).toBe(0)
    expect(result.aggregates.firstExactEqualsFirstCompatible).toEqual({ recoveredC4C: 2, equal: 2, later: 0 })
    // Every timeout / OOM task is unmeasured (never Candidate 0) and every notRun task is neither a Search nor a failure.
    const rows = result.taskRows as { process: string; candidateCount: number | null; coverage: string | null; compatible: boolean }[]
    expect(rows.filter(r => r.process === 'timeout' || r.process === 'out_of_memory').every(r => r.candidateCount === null && r.coverage === null)).toBe(true)
    expect(rows.filter(r => r.process === 'not_run')).toHaveLength(308)
    expect(rows.filter(r => r.process === 'not_run').every(r => r.candidateCount === null && r.coverage === null)).toBe(true)
    expect(rows.filter(r => r.process === 'timeout' || r.process === 'out_of_memory').every(r => !r.compatible)).toBe(true)
    // The t00 diagnostic: first covering rung L1, yet timeouts / OOM at the common L2.
    expect(result.extentDiagnostic[0].b2c2b1).toMatchObject({ required: { normal: 5, gogma: 119, skill: 22 }, firstLadderRung: 'L1' })
    // The registered rule over the recorded counts: 352 - 35 completed = 317 unmeasured (9 timeout / OOM + 308 notRun).
    expect(phase2c26b2c2b2aDecision({ invalidReasons: [], tasks: 352, targets: 11, unmeasuredTasks: 352 - result.aggregates.execution.completed,
      exactTargets: result.aggregates.exactTargets, unresolvedSafetyCapTargets: 0 }).case).toBe('B2C2B2A_INCOMPLETE')
  })
})

// ---------------------------------------------------------------- isolation and provenance

describe('Phase 2-C2.6-B2-C2B2A isolation and provenance', () => {
  it('is never imported by Production and hard-codes no Target, Entry, OwnedWeapon or reservation', () => {
    const production = import.meta.glob(['../domain/**/*.ts', '../services/**/*.ts', '../workers/**/*.ts', '../pages/**/*.tsx', '../components/**/*.tsx', '../db/**/*.ts', '!../**/*.test.ts', '!../**/*.test.tsx'],
      { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    expect(Object.keys(production).length).toBeGreaterThan(50)
    expect(Object.entries(production).filter(([, source]) => /plannerGlobalPhase2C26B2C2B2A/.test(source)).map(([path]) => path)).toEqual([])
    for (const source of [searchSource, targetsSource, analysisSource, prepareSource, runnerSource, analyzerSource]) {
      expect(source).not.toMatch(/\bc\d+-p\d+\b|fnv1a32[-:][0-9a-f]{8}|[0-9a-f]{8}-[0-9a-f]{4}-|build-list\.|46bf2c78|c140578c|9733b090/)
    }
    for (const source of [searchSource, targetsSource, analysisSource]) expect(source).not.toMatch(/node:fs|readFile|import\.meta\.glob/)
  })

  it('keeps the oracle, its manifest, every earlier RESULT and every Target-specific extent out of the Search side', () => {
    for (const source of [searchSource, runnerSource]) {
      expect(source).not.toMatch(/ORACLE_[1]657|1657|--oracle|--manifest|--b2c2b1-result|--b2c1-result|--b2b1-result|--b2c2a-result|gogmaUsage|plannerGlobal[O]racle|_RESULT|phase2c2OracleCoverage|Analysis'|Targets'|firstCompatible|firstLadderRung|requiredExtent|phase2c26b2aReachability|phase2c26b2aRouteExtent|materialization\.estimated/)
    }
    expect(searchSource).not.toMatch(/plannerGlobalPhase2C26B2C2B2ATargets|plannerGlobalPhase2C26B2C2B1Analysis|plannerGlobalPhase2C26B2C1Analysis/)
    expect(runnerSource).toMatch(/--targets/)
    expect(runnerSource).toMatch(/oracleGuidedPolicySelection: true, oracleGuidedTargetPopulation: true, contextOrderingUsesOracle: false, oracleReadBySearchChild: false, oracleMatchUsedForEarlyStop: false/)
    expect(runnerSource).toMatch(/perTargetExtent: false, targetIndividualOracleExtentAsSearchInput: false, ladderRungsSearched: \['L2'\]/)
    expect(runnerSource).toMatch(/a task extent is not the common L2 extent/)
    expect(prepareSource).toMatch(/--b2c2b1-result/)
    expect(prepareSource).not.toMatch(/--oracle|--manifest|visitPlannerAlternativeCandidates/)
    expect(analyzerSource).toMatch(/--oracle/)
    expect(analyzerSource).toMatch(/--manifest/)
    expect(analyzerSource).toMatch(/oracleReadBySearchChild: false/)
    expect(analysisSource).toMatch(/phase2c26b2c2aCompareContext\(/)
    expect(analysisSource).toMatch(/phase2c26b2b2aCompare\(/)
  })

  it('captures through the unchanged Production Search and B2-C2A capture, with only the sentinel and the safety cap as stop rules', () => {
    expect(searchSource).toMatch(/visitPlannerAlternativeCandidates\(/)
    expect(searchSource).toMatch(/createPhase2C26B2C2ACapture\(/)
    expect(searchSource).toMatch(/reconstructPhase2C26B2B2AContext\(/)
    expect(searchSource).toMatch(/phase2c26b1SearchInputDigest\(/)
    expect(searchSource).toMatch(/compareConstrainedCandidates\(/)
    expect((searchSource.match(/'stop'/g) ?? []).length).toBe(2)
    expect(searchSource).toMatch(/if \(machine\.offer\(candidate\.estimatedOperationCount, deliveryIndex\) === 'sentinel'\) \{\s*nextCostSentinel = delivered\s*return 'stop'/)
    expect(searchSource).toMatch(/return safetyCapHit \? 'stop' : 'continue'/)
    expect(runnerSource).toMatch(/const stage1 = await pool\(stage1Tasks,/)
    expect(runnerSource).not.toMatch(/timeout_fallback|fallbackTasks|FALLBACK|retryTasks/)
    expect(runnerSource).toMatch(/derivePhase2C26B2C1Schedule\(/)
    for (const source of [searchSource, analysisSource, runnerSource, analyzerSource]) {
      expect(source).not.toMatch(/runPreparedPlannerAlternativeKernel|preparePlannerAlternativeKernel|createProductionPlan|runPhase2C2Kernel|runPhase2C2Baseline|runPlannerDeterministicSchedule|createPlannerAlternativeWhatIfComparison|searchCandidates\(/)
    }
    for (const source of [analysisSource, analyzerSource, targetsSource, prepareSource]) expect(source).not.toMatch(/visitPlannerAlternativeCandidates|runPhase2C26B2C2B2ASearch|runPhase2C26B2C2B2ATask\(/)
  })

  it('records formal provenance only for committed code, no smoke option, no calculation change after the measured HEAD and verified launch provenance', () => {
    expect(runnerSource).toMatch(/Commit ALL benchmark code before a formal measurement/)
    expect(runnerSource).toMatch(/non-formal smoke options and need --allow-uncommitted/)
    // formal = the ordinary formal conditions AND launch provenance the runner itself attested; --allow-nonformal never enters it.
    expect(analyzerSource).toMatch(/const formalConditions = formalRunConditions && calculationCodeChangedSinceMeasuredHead\.length === 0 && !analysisUncommitted\s+const formal = formalConditions && launchProvenance\.verified\n/)
    expect(analyzerSource).toMatch(/const launchProvenance = analysis\.phase2c26b2c2b2aLaunchProvenance\(r\)/)
    expect(analyzerSource).toMatch(/if \(!launchProvenance\.verified && !allowNonformal\) throw/)
    expect(analyzerSource.match(/const formal = [^\n]*/)![0]).not.toMatch(/allowNonformal|intentionallyStopped|reconstruction/)
    expect(analyzerSource.match(/const formalRunConditions = [^\n]*/)![0]).not.toMatch(/allowNonformal|uncommittedBenchmarkCode/)
    expect(analyzerSource).toMatch(/uncommittedBenchmarkCode: reconstructedLaunch \? null/)
    expect(analyzerSource).toMatch(/plannerGlobalPhase2C26B2C2B2AAnalysis\.ts', 'scripts\/analyze-planner-global-phase2c26b2c2b2a\.mjs', 'scripts\/reconstruct-planner-global-phase2c26b2c2b2a-partial-raw\.mjs'/)
  })

  it('rebuilds an intentionally stopped raw post hoc without running a Search or rewriting a child record', () => {
    expect(reconstructSource).not.toMatch(/visitPlannerAlternativeCandidates|runPhase2C26B2C2B2ATask\(|runPhase2C26B2C2B2ASearch|spawn\(|derivePhase2C26B2C1Schedule|--oracle|--manifest|_RESULT/)
    expect(reconstructSource).not.toMatch(/writeFile\([^)]*runDir|\brm\(|\bunlink\(|\brename\(|\bcopyFile\(/)
    expect(reconstructSource).toMatch(/writeFile\(paths\.output, text, \{ flag: 'wx' \}\)/)
    expect(reconstructSource).toMatch(/status: 'intentionally_stopped'/)
    expect(reconstructSource).toMatch(/childRecordsModified: false, searchRun: false/)
    // The reconstruction never asserts the launch: working tree unknown (null), no attestation, HEAD / hash marked as reconstruction inputs.
    expect(reconstructSource).toMatch(/uncommittedBenchmarkCode: null, launchWorkingTreeCleanVerified: false/)
    expect(reconstructSource).toMatch(/repositoryHeadSource: 'post_hoc_reconstruction_argument'/)
    expect(reconstructSource).toMatch(/launchProvenanceVerified: false/)
    expect(reconstructSource).not.toMatch(/uncommittedBenchmarkCode: false|launchAttestation:|attestedBy/)
    expect(reconstructSource).toMatch(/The ran tasks are not a prefix of the task order/)
    expect(analyzerSource).toMatch(/r\.reconstruction\?\.postHoc === true && r\.reconstruction\?\.childRecordsModified === false/)
  })
})
