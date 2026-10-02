import { beforeEach, describe, expect, it, vi } from 'vitest'
import rawB2C2B1 from '../../docs/PLANNER_GLOBAL_PHASE2C26B2C2B1_RESULT.json?raw'
import rawB2C1 from '../../docs/PLANNER_GLOBAL_PHASE2C26B2C1_RESULT.json?raw'
import rawB2C2B2A from '../../docs/PLANNER_GLOBAL_PHASE2C26B2C2B2A_RESULT.json?raw'
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
import { phase2c26b2c2b2aL2Context, runPhase2C26B2C2B2ASearch, PHASE2C26B2C2B2A_CANDIDATE_SAFETY_CAP, PHASE2C26B2C2B2A_MAX_COST_COHORTS, PHASE2C26B2C2B2A_STAGE1 } from './plannerGlobalPhase2C26B2C2B2A'
import { parsePhase2C26B2C2B2AB2C2B1Authority, phase2c26b2c2b2aPopulation, PHASE2C26B2C2B2A_REGISTERED_B2C2B1 } from './plannerGlobalPhase2C26B2C2B2ATargets'
import {
  buildPhase2C26B2C2B2BTasks,
  parsePhase2C26B2C2B2BTargetManifest,
  phase2c26b2c2b2bL1Context,
  phase2c26b2c2b2bPolicyDrift,
  phase2c26b2c2b2bRegisteredConditions,
  phase2c26b2c2b2bStartAttestationBody,
  phase2c26b2c2b2bTaskOutcome,
  runPhase2C26B2C2B2BSearch,
  runPhase2C26B2C2B2BTask,
  verifyPhase2C26B2C2B2BStartAttestation,
  PHASE2C26B2C2B2B_CANDIDATE_SAFETY_CAP,
  PHASE2C26B2C2B2B_CAPTURE_PREFIXES,
  PHASE2C26B2C2B2B_CONTEXT_BUDGET,
  PHASE2C26B2C2B2B_EXPECTED_TASKS,
  PHASE2C26B2C2B2B_EXTENT,
  PHASE2C26B2C2B2B_MAX_COST_COHORTS,
  PHASE2C26B2C2B2B_NOT_RUN,
  PHASE2C26B2C2B2B_REGISTERED_P1,
  PHASE2C26B2C2B2B_STAGE1,
  PHASE2C26B2C2B2B_START_ATTESTATION_FILE,
  PHASE2C26B2C2B2B_TARGET_SOURCE,
  PHASE2C26B2C2B2B_TARGETS,
  type Phase2C26B2C2B2BAttestationExpectation,
  type Phase2C26B2C2B2BSearchRecord,
  type Phase2C26B2C2B2BTaskInput,
} from './plannerGlobalPhase2C26B2C2B2B'
import searchSource from './plannerGlobalPhase2C26B2C2B2B.ts?raw'
import { phase2c26b2c2b2bPopulation, phase2c26b2c2b2bRouteExtents, phase2c26b2c2b2bTargetManifest, PHASE2C26B2C2B2B_REGISTERED_B2C2B1 } from './plannerGlobalPhase2C26B2C2B2BTargets'
import targetsSource from './plannerGlobalPhase2C26B2C2B2BTargets.ts?raw'
import {
  parsePhase2C26B2C2B2BB2C2B2ADiagnostic,
  phase2c26b2c2b2bDecision,
  phase2c26b2c2b2bEvidenceGrade,
  phase2c26b2c2b2bL2Comparison,
  phase2c26b2c2b2bLaunchProvenance,
  runPhase2C26B2C2B2BAnalysis,
  validatePhase2C26B2C2B2BRaw,
  PHASE2C26B2C2B2B_DECISION_RULE,
  PHASE2C26B2C2B2B_REGISTERED_B2C2B2A,
  type Phase2C26B2C2B2BL2TaskRow,
  type Phase2C26B2C2B2BRun,
} from './plannerGlobalPhase2C26B2C2B2BAnalysis'
import analysisSource from './plannerGlobalPhase2C26B2C2B2BAnalysis.ts?raw'
import prepareSource from '../../scripts/prepare-planner-global-phase2c26b2c2b2b-targets.mjs?raw'
import runnerSource from '../../scripts/run-planner-global-phase2c26b2c2b2b.mjs?raw'
import analyzerSource from '../../scripts/analyze-planner-global-phase2c26b2c2b2b.mjs?raw'
import reconstructSource from '../../scripts/reconstruct-planner-global-phase2c26b2c2b2b-partial-raw.mjs?raw'

/*
 * Issue #154 Phase 2-C2.6-B2-C2B2B: the E1 ∩ L1 Targets searched in their P1 top-32 contexts at the common L1 extent. The
 * synthetic worlds below are invented for the tests; the committed B2-C2B1 / B2-C1 / B2-C2B2A RESULTs are read only to check
 * the authorities. The oracle modules are never imported here (the Phase 2-A.5 isolation rule).
 */

/** Every Search input, in call order; `script` replays one real Candidate with the scripted operation costs (as in B2-C2B2A). */
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
const L1 = { maxNormalAdvance: 8, maxGogmaAdvance: 235, maxSkillAdvance: 256 }
const L2 = { maxNormalAdvance: 128, maxGogmaAdvance: 235, maxSkillAdvance: 1500 }
const authorities = () => ({ b2c2b1: parsePhase2C26B2C2B2AB2C2B1Authority(b2c2b1Json, b2c2b1Sha).authority!, b2c1: parsePhase2C26B2C2AB2C1Authority(b2c1Json, b2c1Sha).authority! })

// ---------------------------------------------------------------- the E1 ∩ L1 population and manifest

describe('Phase 2-C2.6-B2-C2B2B E1 ∩ L1 population and Target manifest', () => {
  it('derives the population mechanically from the committed B2-C2B1 RESULT: E1 ∩ firstLadderRung L1 = 7, the other 4 E1 Routes L2-needed', () => {
    const { b2c2b1, b2c1 } = authorities()
    const population = phase2c26b2c2b2bPopulation(b2c2b1, b2c1, b2c2b1Json)
    expect(population.issues).toEqual([])
    expect(population.targetWeaponIds).toHaveLength(PHASE2C26B2C2B2B_TARGETS)
    // The same set straight from the RESULT rows (no ID is written down anywhere).
    const fromRows = (rung: string) => (b2c2b1Json.routes as { targetWeaponId: string; cohort: string; firstLadderRung: string }[])
      .filter(r => r.cohort === 'E1' && r.firstLadderRung === rung).map(r => r.targetWeaponId).sort()
    expect(population.targetWeaponIds).toEqual(fromRows('L1'))
    expect(population.l2Needed).toEqual(fromRows('L2'))
    expect(population.l2Needed).toHaveLength(4)
    // It is a subset of the B2-C2B2A E1 population and agrees with ladderCoverage L1 7 of 11.
    const e1 = phase2c26b2c2b2aPopulation(b2c2b1, b2c1).e1
    expect(population.targetWeaponIds.every(id => e1.includes(id))).toBe(true)
    expect([...population.targetWeaponIds, ...population.l2Needed].sort()).toEqual(e1)
    expect(PHASE2C26B2C2B2B_REGISTERED_B2C2B1).toMatchObject({ l1Covered: 7, e1: 11, l1Rung: { id: 'L1', extent: L1 } })
    // Every population Route's recorded required extent fits L1, every L2-needed one does not.
    const extents = phase2c26b2c2b2bRouteExtents(b2c2b1Json, e1)
    expect(extents.issues).toEqual([])
    const fits = (id: string) => { const r = extents.routes.find(x => x.targetWeaponId === id)!.required; return (r.normal ?? 0) <= 8 && (r.gogma ?? 0) <= 235 && (r.skill ?? 0) <= 256 }
    expect(population.targetWeaponIds.every(fits)).toBe(true)
    expect(population.l2Needed.some(fits)).toBe(false)
  })

  it('fails closed when a first ladder rung disagrees with the recorded required extent, the L1 rung or coverage drifts, or the population size moves', () => {
    const { b2c2b1, b2c1 } = authorities()
    const population = phase2c26b2c2b2bPopulation(b2c2b1, b2c1, b2c2b1Json).targetWeaponIds
    const mutate = (patch: (j: typeof b2c2b1Json) => void) => { const copy = structuredClone(b2c2b1Json); patch(copy); return phase2c26b2c2b2bPopulation(b2c2b1, b2c1, copy) }
    const row = (j: typeof b2c2b1Json, id: string) => (j.routes as { targetWeaponId: string; required: { skill: number }; firstLadderRung: string }[]).find(r => r.targetWeaponId === id)!
    expect(mutate(j => { row(j, population[0]!).required.skill = 300 }).issues.join()).toMatch(/does not fit L1/)
    // An L2-needed Route without a Normal stream (its shortage is Skill only) whose Skill is pulled inside L1.
    const l2 = phase2c26b2c2b2bPopulation(b2c2b1, b2c1, b2c2b1Json).l2Needed.find(id => (b2c2b1Json.routes as { targetWeaponId: string; required: { normal: number | null } }[])
      .find(r => r.targetWeaponId === id)!.required.normal === null)!
    expect(mutate(j => { row(j, l2).required.skill = 100 }).issues.join()).toMatch(/fits L1/)
    expect(mutate(j => { row(j, population[0]!).firstLadderRung = 'L2' }).issues.join()).toMatch(/first ladder rungs disagree/)
    expect(mutate(j => { j.ladder.rungs[1].extent.maxSkillAdvance = 512 }).valid).toBe(false)
    expect(mutate(j => { j.ladderCoverage.e1.byRung[1].covered = 6 }).valid).toBe(false)
    // A parsed authority whose first rung moved: the population size is no longer 7.
    const moved = structuredClone(b2c2b1)
    moved.routes.find(r => r.targetWeaponId === l2)!.firstLadderRung = 'L1'
    expect(phase2c26b2c2b2bPopulation(moved, b2c1, b2c2b1Json).valid).toBe(false)
    expect(phase2c26b2c2b2bPopulation({ ...b2c2b1, exportSha256: '0'.repeat(64) }, b2c1, b2c2b1Json).valid).toBe(false)
    expect(() => phase2c26b2c2b2bTargetManifest(moved, b2c1, b2c2b1Json)).toThrow(/not valid/)
  })

  it('writes the population as 7 sorted Target IDs and nothing else, exactly what the Search runner accepts', () => {
    const { b2c2b1, b2c1 } = authorities()
    const manifest = phase2c26b2c2b2bTargetManifest(b2c2b1, b2c1, b2c2b1Json)
    expect(manifest).toMatchObject({ sourceResultSha256: PHASE2C26B2C2B2B_TARGET_SOURCE.resultSha256, population: 'E1_L1', policy: 'P1', contextBudget: 32, exportSha256: b2c2b1Json.provenance.exportSha256 })
    expect(Object.keys(manifest).sort()).toEqual(['contextBudget', 'exportSha256', 'phase', 'policy', 'population', 'sourceResultSha256', 'targetWeaponIds'])
    expect(JSON.stringify({ ...manifest, phase: '', population: '' })).not.toMatch(/rank|fnv1a32|firstCompatible|required|maxSkill|maxNormal|L1|L2|K1:|oracle/i)
    expect(parsePhase2C26B2C2B2BTargetManifest(structuredClone(manifest))).toMatchObject({ valid: true, issues: [] })
    const bad = (patch: (m: Record<string, unknown> & typeof manifest) => void) => { const copy = structuredClone(manifest) as Record<string, unknown> & typeof manifest; patch(copy); return parsePhase2C26B2C2B2BTargetManifest(copy).valid }
    expect(bad(m => { m.targetWeaponIds = m.targetWeaponIds.slice(1) })).toBe(false)
    expect(bad(m => { m.targetWeaponIds = [...m.targetWeaponIds].reverse() })).toBe(false)
    expect(bad(m => { m.sourceResultSha256 = '0'.repeat(64) })).toBe(false)
    expect(bad(m => { (m as Record<string, unknown>).population = 'E1' })).toBe(false)
    expect(bad(m => { m.contextBudget = 16 })).toBe(false)
    for (const field of ['firstCompatibleRanks', 'requiredExtents', 'firstLadderRungs', 'oracleRoutes', 'expectedStableKeys', 'compatibility', 'extent']) expect(bad(m => { m[field] = {} })).toBe(false)
  })

  it('reads the B2-C2B2A RESULT only as non-formal diagnostic L2 rows, failing closed on another SHA-256, case, grade or extent', () => {
    const json = JSON.parse(rawB2C2B2A)
    const expected = { b2c2b1ResultSha256: b2c2b1Sha, exportSha256: b2c2b1Json.provenance.exportSha256 }
    const ok = parsePhase2C26B2C2B2BB2C2B2ADiagnostic(json, PHASE2C26B2C2B2B_REGISTERED_B2C2B2A.resultSha256, expected)
    expect(ok.issues).toEqual([])
    expect(ok.rows).toHaveLength(352)
    expect(ok.rows.filter(r => r.process !== 'not_run')).toHaveLength(44)
    expect(parsePhase2C26B2C2B2BB2C2B2ADiagnostic(json, '0'.repeat(64), expected).valid).toBe(false)
    expect(parsePhase2C26B2C2B2BB2C2B2ADiagnostic({ ...json, decision: { case: 'B2C2B2A_ALL_C8' } }, PHASE2C26B2C2B2B_REGISTERED_B2C2B2A.resultSha256, expected).valid).toBe(false)
    expect(parsePhase2C26B2C2B2BB2C2B2ADiagnostic({ ...json, provenance: { ...json.provenance, formal: true, evidenceGrade: 'formal' } }, PHASE2C26B2C2B2B_REGISTERED_B2C2B2A.resultSha256, expected).valid).toBe(false)
    expect(parsePhase2C26B2C2B2BB2C2B2ADiagnostic({ ...json, conditions: { ...json.conditions, searchExtent: L1 } }, PHASE2C26B2C2B2B_REGISTERED_B2C2B2A.resultSha256, expected).valid).toBe(false)
    expect(parsePhase2C26B2C2B2BB2C2B2ADiagnostic(json, PHASE2C26B2C2B2B_REGISTERED_B2C2B2A.resultSha256, { ...expected, exportSha256: '0'.repeat(64) }).valid).toBe(false)
  })
})

// ---------------------------------------------------------------- a synthetic world (Search positions beyond L1)

const SOURCE_A_SKILL = 'series_skill.fixture.z'
const SOURCE_B_SKILL = 'series_skill.fixture.b-source'

function world() {
  const skill = { seriesSkillId: SOURCE_A_SKILL, groupSkillId: null, matchMode: 'all' as const }
  const a: TargetWeapon = orchestrationTarget('target.b2c2b2b.a', { priority: 5, idealSkillCondition: skill, practicalSkillCondition: skill })
  const b = skillConstrainedTarget('target.b2c2b2b.b', { priority: 1 })
  const built = orchestrationScenario({
    engine: { gogmaPositions: L1.maxGogmaAdvance + 8, skillPositions: L2.maxSkillAdvance + 8 },
    targets: [a, b],
    ownedWeapons: [orchestrationSource(ORCHESTRATION_SOURCE_A, { seriesSkillId: SOURCE_A_SKILL }),
      orchestrationSource(ORCHESTRATION_SOURCE_B, { restorationBonuses: belowPracticalBonuses(), seriesSkillId: SOURCE_B_SKILL })],
    entries: [
      orchestrationEntry('build-list.b2c2b2b.a', a, resetRoute(ORCHESTRATION_SOURCE_A), { finalBonuses: idealBonuses(), seriesSkillId: SOURCE_A_SKILL }),
      orchestrationEntry('build-list.b2c2b2b.b', b, { kind: 'existing_gogma_mixed', sourceOwnedWeaponId: resetRoute(ORCHESTRATION_SOURCE_B).sourceOwnedWeaponId,
        operations: [...resetRoute(ORCHESTRATION_SOURCE_B).operations, ...resetSkillsRoute(ORCHESTRATION_SOURCE_B).operations] }),
    ],
  })
  const schedule = derivePhase2C26B2C1Schedule(built.input, globalResearchDependencies(built.engine))
  return { built, schedule }
}
const IDS = ['target.b2c2b2b.a', 'target.b2c2b2b.b']

function defaultContextOf(schedule: Phase2C26B2C1Schedule, id = 'target.b2c2b2b.b', rank = 2): Phase2C26B2B2AContext {
  const row = schedule.contexts.find(c => c.targetWeaponId === id && c.ranks.P1 === rank)!
  const rebuilt = reconstructPhase2C26B2B2AContext(schedule.snapshot, { targetWeaponId: id, fixedSetId: row.representativeFixedSetId, cardinality: row.targetEligibleMinCardinality, reservationDigest: row.reservationDigest })
  if (!rebuilt.valid) throw new Error(rebuilt.issues.join())
  return rebuilt.context
}
function l1ContextOf(schedule: Phase2C26B2C1Schedule, id = 'target.b2c2b2b.b', rank = 2) {
  const l1 = phase2c26b2c2b2bL1Context(defaultContextOf(schedule, id, rank))
  if (!l1.valid) throw new Error(l1.issues.join())
  return l1.context
}

// ---------------------------------------------------------------- the L1 context and task construction

describe('Phase 2-C2.6-B2-C2B2B L1 context and task construction', () => {
  it('registers 7 Targets x 32 P1 ranks = 224 tasks, the common L1 extent and B2-C2B2A\'s capture and Stage 1 conditions unchanged', () => {
    expect([PHASE2C26B2C2B2B_TARGETS, PHASE2C26B2C2B2B_CONTEXT_BUDGET, PHASE2C26B2C2B2B_EXPECTED_TASKS]).toEqual([7, 32, 224])
    expect(PHASE2C26B2C2B2B_EXTENT).toEqual(L1)
    expect(Object.isFrozen(PHASE2C26B2C2B2B_EXTENT)).toBe(true)
    expect(PHASE2C26B2C2B2A_REGISTERED_B2C2B1.rungs[1]).toEqual({ id: 'L1', name: 'intermediate', extent: L1 })
    // Everything but the extent is B2-C2B2A's.
    expect([PHASE2C26B2C2B2B_MAX_COST_COHORTS, PHASE2C26B2C2B2B_CANDIDATE_SAFETY_CAP]).toEqual([PHASE2C26B2C2B2A_MAX_COST_COHORTS, PHASE2C26B2C2B2A_CANDIDATE_SAFETY_CAP])
    expect([PHASE2C26B2C2B2B_MAX_COST_COHORTS, PHASE2C26B2C2B2B_CANDIDATE_SAFETY_CAP]).toEqual([4, 1024])
    expect(PHASE2C26B2C2B2B_CAPTURE_PREFIXES).toEqual({ C8: 8, C32: 32 })
    expect(PHASE2C26B2C2B2B_STAGE1).toEqual(PHASE2C26B2C2B2A_STAGE1)
    expect(PHASE2C26B2C2B2B_STAGE1).toEqual({ executionClass: 'stage1', childHeapMb: 8192, concurrency: 1, budgetMs: 600_000, retry: 'none', fallback: 'none' })
    expect(PHASE2C26B2C2B2B_REGISTERED_P1).toEqual({ id: 'P1', name: 'default_simple_first', keys: [['targetEligibleMinCardinality', 'asc'], ['exclusiveOwnedWeaponCount', 'asc'],
      ['blockedCountDefaultTotal', 'asc'], ['shareableHeldCountDefaultTotal', 'desc'], ['reservationDigest', 'asc']] })
    for (const item of ['l2_search', 'e1_l2_needed_search', 'per_target_extent', 'e2_search', 'retry', 'timeout_fallback', 'context_level_early_stop', 'target_level_early_stop', 'compatibility_based_context_skip', 'b2c2b2a_result_regeneration']) {
      expect(PHASE2C26B2C2B2B_NOT_RUN).toContain(item)
    }
  })

  it('replaces the extent of the unchanged reconstruction by L1 and nothing else, recomputing the Search input digest by the B1 digest', () => {
    const { schedule } = world()
    const base = defaultContextOf(schedule)
    expect(base.extent).toEqual({ ...defaultPlannerAlternativeSearchExtent })
    const l1 = phase2c26b2c2b2bL1Context(base)
    expect(l1.valid).toBe(true)
    if (!l1.valid) return
    const { extent, searchInputDigest, defaultSearchInputDigest, ...rest } = l1.context
    const { extent: baseExtent, searchInputDigest: baseDigest, ...baseRest } = base
    expect(rest).toEqual(baseRest)
    expect(extent).toEqual(L1)
    expect(baseExtent).toEqual({ ...defaultPlannerAlternativeSearchExtent })
    expect(defaultSearchInputDigest).toBe(baseDigest)
    expect(searchInputDigest).not.toBe(baseDigest)
    expect(searchInputDigest).toBe(phase2c26b1SearchInputDigest({ orientationId: '', workIndex: 0, targetWeaponId: base.targetWeaponId, status: 'searchable',
      invalidatedBuildListEntryId: base.currentBuildListEntryId, invalidatedRouteKey: base.currentRouteKey, fixedRouteBuildListEntryIds: base.fixedBuildListEntryIds,
      reservation: base.reservation, searchReservation: base.reservation, excludedRouteKeys: base.excludedRouteKeys, extent: L1, originDigest: base.originDigest, contextDigest: '' }))
    // The same context at L2 (B2-C2B2A) differs only in the extent and the extent-dependent digest.
    const l2 = phase2c26b2c2b2aL2Context(base)
    expect(l2.valid).toBe(true)
    if (l2.valid) {
      const { extent: e2, searchInputDigest: d2, defaultSearchInputDigest: default2, ...rest2 } = l2.context
      expect(rest2).toEqual(rest)
      expect(default2).toBe(defaultSearchInputDigest)
      expect(e2).toEqual(L2)
      expect(d2).not.toBe(searchInputDigest)
    }
    // Fails closed: a non-default input, any extent other than the common L1 (a Target-specific one or L2 included), a tampered digest or reservation.
    expect(phase2c26b2c2b2bL1Context({ ...base, extent: { ...L1 } }).valid).toBe(false)
    expect(phase2c26b2c2b2bL1Context(base, { ...L1, maxSkillAdvance: 22 }).valid).toBe(false)
    expect(phase2c26b2c2b2bL1Context(base, { ...L2 }).valid).toBe(false)
    expect(phase2c26b2c2b2bL1Context({ ...base, searchInputDigest: 'other' }).valid).toBe(false)
    expect(phase2c26b2c2b2bL1Context({ ...base, reservationDigest: 'other' }).valid).toBe(false)
  })

  it('takes every P1 rank 1..N of every Target from the schedule, each at the common L1 extent with both digests', () => {
    const { schedule } = world()
    const budget = Math.min(...IDS.map(id => schedule.contexts.filter(c => c.targetWeaponId === id).length))
    expect(budget).toBeGreaterThanOrEqual(2)
    const built = buildPhase2C26B2C2B2BTasks(schedule, IDS, budget)
    expect(built.issues).toEqual([])
    expect(built.tasks).toHaveLength(IDS.length * budget)
    for (const [targetIndex, id] of IDS.entries()) {
      const tasks = built.tasks.filter(t => t.targetWeaponId === id)
      expect(tasks.map(t => t.contextRank)).toEqual(Array.from({ length: budget }, (_, i) => i + 1))
      expect(tasks.map(t => t.taskId)).toEqual(tasks.map(t => `t0${targetIndex}-r${String(t.contextRank).padStart(2, '0')}`))
      for (const task of tasks) {
        const row = schedule.contexts.find(c => c.targetWeaponId === id && c.ranks.P1 === task.contextRank)!
        expect(task).toMatchObject({ groupIndex: row.groupIndex, reservationDigest: row.reservationDigest, policy: 'P1', maxCostCohorts: 4, candidateSafetyCap: 1024, extent: L1 })
        expect(task.defaultSearchInputDigest).toBe(defaultContextOf(schedule, id, task.contextRank).searchInputDigest)
        expect(task.searchInputDigest).toBe(l1ContextOf(schedule, id, task.contextRank).searchInputDigest)
      }
    }
    expect(new Set(built.tasks.map(t => JSON.stringify(t.extent))).size).toBe(1)
    expect(Object.keys(built.tasks[0]!).sort()).toEqual(['candidateSafetyCap', 'contextRank', 'defaultSearchInputDigest', 'executionClass', 'extent', 'groupIndex', 'maxCostCohorts', 'policy',
      'representativeFixedSetId', 'representativeFixedTargetWeaponIds', 'reservationDigest', 'searchInputDigest', 'targetEligibleMinCardinality', 'targetWeaponId', 'taskId'])
  })

  it('fails closed on too few contexts, an unknown or repeated Target, a rank gap or duplicate, a P1 drift and a non-default schedule extent', () => {
    const { schedule } = world()
    const fewest = Math.min(...IDS.map(id => schedule.contexts.filter(c => c.targetWeaponId === id).length))
    const issues = (s: Phase2C26B2C1Schedule, ids = IDS, budget = fewest) => buildPhase2C26B2C2B2BTasks(s, ids, budget).issues.join('\n')
    expect(issues(schedule, IDS, fewest + 1)).toMatch(/fewer than the budget/)
    expect(issues(schedule, [...IDS, 'target.none'])).toMatch(/not a schedule Target/)
    expect(issues(schedule, [IDS[0]!, IDS[0]!])).toMatch(/repeats/)
    const gap = structuredClone(schedule); gap.contexts.find(c => c.targetWeaponId === IDS[0] && c.ranks.P1 === 2)!.ranks.P1 = 9
    expect(issues(gap)).toMatch(/missing or repeated/)
    const drift = structuredClone(schedule); (drift as { policies: unknown }).policies = drift.policies.map(p => p.id === 'P1' ? { ...p, keys: [...p.keys].reverse() } : p)
    expect(phase2c26b2c2b2bPolicyDrift(drift)).toEqual(['the schedule P1 is not the registered P1 definition'])
    expect(issues(drift)).toMatch(/registered P1/)
    const extent = structuredClone(schedule); extent.extent = { ...L1 }
    expect(issues(extent)).toMatch(/Production default extent/)
  })
})

// ---------------------------------------------------------------- the Search child

const CAPTURE = { maxCostCohorts: PHASE2C26B2C2B2B_MAX_COST_COHORTS, candidateSafetyCap: PHASE2C26B2C2B2B_CANDIDATE_SAFETY_CAP }
const PROVENANCE = { contextRank: 2, targetEligibleMinCardinality: 1, representativeFixedSetId: 'K1:x', representativeFixedTargetWeaponIds: ['t'] }

describe('Phase 2-C2.6-B2-C2B2B Search child', () => {
  it('gives visitPlannerAlternativeCandidates() exactly the rebuilt origin, reservation, exclusion and the common L1 extent', async () => {
    const { built, schedule } = world()
    const context = l1ContextOf(schedule)
    searchCalls.script = [1, 2, 3, 4, 5]
    const record = await runPhase2C26B2C2B2BSearch(built.input, context, built.engine, CAPTURE, PROVENANCE, { now: () => 0 })
    expect(searchCalls.inputs).toEqual([{ origin: createPlannerStartSearchOrigin(built.input), targetWeaponId: 'target.b2c2b2b.b', extent: L1,
      reservation: context.reservation, excludedRouteKeys: context.excludedRouteKeys }])
    expect(record).toMatchObject({ extent: L1, searchInputDigest: context.searchInputDigest, defaultSearchInputDigest: context.defaultSearchInputDigest, termination: 'four_cost_cohorts_drained' })
  })

  it('captures exactly as B2-C2B2A does at L2 for the same deliveries: the records differ in the extent and its digest only', async () => {
    const { built, schedule } = world()
    const base = defaultContextOf(schedule)
    const l2 = phase2c26b2c2b2aL2Context(base)
    if (!l2.valid) throw new Error('L2 context')
    for (const script of [[1, 1, 2, 3, 3, 4, 4, 5, 5], [1, 2, 2], Array(PHASE2C26B2C2B2B_CANDIDATE_SAFETY_CAP + 3).fill(2)]) {
      searchCalls.script = script
      searchCalls.decisions = []
      const atL1 = await runPhase2C26B2C2B2BSearch(built.input, l1ContextOf(schedule), built.engine, CAPTURE, PROVENANCE, { now: () => 0 })
      const l1Decisions = [...searchCalls.decisions]
      searchCalls.decisions = []
      const atL2 = await runPhase2C26B2C2B2ASearch(built.input, l2.context, built.engine, CAPTURE, PROVENANCE, { now: () => 0 })
      expect(l1Decisions).toEqual(searchCalls.decisions)
      const { extent: e1, searchInputDigest: d1, ...rest1 } = atL1
      const { extent: e2, searchInputDigest: d2, ...rest2 } = atL2
      expect(rest1).toEqual(rest2)
      expect([e1, e2]).toEqual([L1, L2])
      expect(d1).not.toBe(d2)
    }
  }, 120_000)

  it('stops at the first Candidate of a fifth cost and at the safety cap and at nothing else, and refuses another capture rule or a non-L1 extent', async () => {
    const { built, schedule } = world()
    const context = l1ContextOf(schedule)
    searchCalls.script = [1, 1, 2, 3, 3, 4, 4, 5, 5]
    const record = await runPhase2C26B2C2B2BSearch(built.input, context, built.engine, CAPTURE, PROVENANCE)
    expect(searchCalls.decisions).toEqual([...Array(7).fill('continue'), 'stop'])
    expect(record).toMatchObject({ termination: 'four_cost_cohorts_drained', status: 'consumer_stop', captureComplete: true, safetyCapHit: false, capturedCosts: [1, 2, 3, 4] })
    searchCalls.script = [7]
    searchCalls.endByExtent = true
    expect(await runPhase2C26B2C2B2BSearch(built.input, context, built.engine, CAPTURE, PROVENANCE)).toMatchObject({ termination: 'stopped_by_extent', captureComplete: true })
    await expect(runPhase2C26B2C2B2BSearch(built.input, context, built.engine, { ...CAPTURE, candidateSafetyCap: 32 }, PROVENANCE)).rejects.toThrow(/safety cap/)
    await expect(runPhase2C26B2C2B2BSearch(built.input, context, built.engine, { ...CAPTURE, maxCostCohorts: 1 }, PROVENANCE)).rejects.toThrow(/cost cohorts/)
    await expect(runPhase2C26B2C2B2BSearch(built.input, { ...context, extent: { ...L2 } }, built.engine, CAPTURE, PROVENANCE)).rejects.toThrow(/common L1 extent/)
    await expect(runPhase2C26B2C2B2BSearch(built.input, { ...context, extent: { ...L1, maxSkillAdvance: 22 } }, built.engine, CAPTURE, PROVENANCE)).rejects.toThrow(/common L1 extent/)
  }, 120_000)

  it('selects its context by Target and P1 rank from its own schedule and reports any drift as a context mismatch without searching', async () => {
    const { built, schedule } = world()
    const task = buildPhase2C26B2C2B2BTasks(schedule, IDS, 2).tasks.find(t => t.targetWeaponId === 'target.b2c2b2b.b' && t.contextRank === 2)!
    searchCalls.script = [1, 2, 3, 4, 5]
    expect(await runPhase2C26B2C2B2BTask(built.input, schedule, task, built.engine)).toMatchObject({ status: 'searched', search: { contextRank: 2, extent: L1, termination: 'four_cost_cohorts_drained' } })
    searchCalls.inputs = []
    const mismatch = async (patch: Partial<Phase2C26B2C2B2BTaskInput>) => runPhase2C26B2C2B2BTask(built.input, schedule, { ...task, ...patch }, built.engine)
    expect(await mismatch({ searchInputDigest: 'other' })).toMatchObject({ status: 'context_mismatch', issues: ['searchInputDigest'] })
    expect(await mismatch({ defaultSearchInputDigest: 'other' })).toMatchObject({ status: 'context_mismatch', issues: ['defaultSearchInputDigest'] })
    expect(await mismatch({ extent: { ...L2 } })).toMatchObject({ status: 'context_mismatch', issues: ['extent'] })
    expect(await mismatch({ extent: { ...L1, maxSkillAdvance: 22 } })).toMatchObject({ status: 'context_mismatch', issues: ['extent'] })
    expect(await mismatch({ reservationDigest: 'other' })).toMatchObject({ status: 'context_mismatch', issues: ['reservationDigest'] })
    expect(await mismatch({ contextRank: 99 })).toMatchObject({ status: 'context_mismatch', issues: ['P1 rank 99 holds 0 contexts'] })
    expect(searchCalls.inputs).toEqual([])
  })

  it('records a timeout / out of memory / failure as that failure, never as no Candidate', () => {
    expect(phase2c26b2c2b2bTaskOutcome('t', 'timeout', null)).toEqual({ taskId: 't', process: 'timeout', record: null, searchStatus: null, termination: null, candidateCount: null })
    expect(phase2c26b2c2b2bTaskOutcome('t', 'out_of_memory', null)).toMatchObject({ process: 'out_of_memory', candidateCount: null })
    expect(phase2c26b2c2b2bTaskOutcome('t', 'completed', null).process).toBe('process_failure')
    expect(phase2c26b2c2b2bTaskOutcome('t', 'completed', { status: 'context_mismatch', taskId: 't', issues: ['x'] }).record).toBe('context_mismatch')
  })
})

// ---------------------------------------------------------------- the runner start attestation

const HEAD = 'a'.repeat(40)
const observation = { createdAt: '2026-10-03T01:00:00.000Z', runnerScript: 'scripts/run-planner-global-phase2c26b2c2b2b.mjs', node: 'v24.19.0', repositoryHead: HEAD, uncommittedBenchmarkCode: false,
  benchmarkCodeSha256: 'b'.repeat(64), exportFileName: 'export.json', exportSha256: 'c'.repeat(64), exportBytes: 10, targetManifestFileName: 'targets.json.local', targetManifestSha256: 'd'.repeat(64),
  targetManifestSourceResultSha256: PHASE2C26B2C2B2B_TARGET_SOURCE.resultSha256, targetWeaponIds: ['t1', 't2'], stage1: { ...PHASE2C26B2C2B2B_STAGE1 }, smoke: null }
const expectation: Phase2C26B2C2B2BAttestationExpectation = { repositoryHead: HEAD, benchmarkCodeSha256: 'b'.repeat(64), exportSha256: 'c'.repeat(64), targetManifestSha256: 'd'.repeat(64),
  targetWeaponIds: ['t1', 't2'], firstChildStartedAt: '2026-10-03T01:00:00.500Z' }
const environmentOf = (a: { [K in 'repositoryHead' | 'uncommittedBenchmarkCode' | 'benchmarkCodeSha256' | 'exportSha256' | 'targetManifestSha256' | 'stage1']: unknown }) => ({ repositoryHead: a.repositoryHead, uncommittedBenchmarkCode: a.uncommittedBenchmarkCode, benchmarkCodeSha256: a.benchmarkCodeSha256,
  exportSha256: a.exportSha256, targetManifestSha256: a.targetManifestSha256, stage1: a.stage1 })

describe('Phase 2-C2.6-B2-C2B2B runner start attestation', () => {
  it('carries the launch observation and every registered condition, and verifies only against the independently obtained values', () => {
    const attestation = phase2c26b2c2b2bStartAttestationBody(observation)
    expect(attestation).toMatchObject({ attestedBy: 'runner', repositoryHead: HEAD, uncommittedBenchmarkCode: false, stage1: PHASE2C26B2C2B2B_STAGE1, extent: L1, extentLabel: 'L1',
      contextBudget: 32, targets: 7, expectedTasks: 224, candidateSafetyCap: 1024, captureRule: { policy: 'C4C', maxCostCohorts: 4 }, registeredP1: PHASE2C26B2C2B2B_REGISTERED_P1, smoke: null })
    for (const field of ['attestedBy', 'createdAt', 'repositoryHead', 'uncommittedBenchmarkCode', 'benchmarkCodeSha256', 'exportSha256', 'targetManifestSha256', 'stage1']) expect(attestation).toHaveProperty(field)
    expect(verifyPhase2C26B2C2B2BStartAttestation(attestation, expectation)).toEqual({ verified: true, issues: [], integrityIssues: [] })
    const issue = (patch: Record<string, unknown>, expected: Partial<Phase2C26B2C2B2BAttestationExpectation> = {}) =>
      verifyPhase2C26B2C2B2BStartAttestation({ ...attestation, ...patch }, { ...expectation, ...expected }).issues.join('\n')
    const integrity = (patch: Record<string, unknown>) => verifyPhase2C26B2C2B2BStartAttestation({ ...attestation, ...patch }, expectation).integrityIssues.length > 0
    // HEAD / code / Export / manifest / Target / authorship / time mismatches break integrity; an uncommitted / smoke / other-condition launch is a truthful non-formal launch.
    for (const patch of [{ repositoryHead: 'f'.repeat(40) }, { benchmarkCodeSha256: '0'.repeat(64) }, { exportSha256: '0'.repeat(64) }, { targetManifestSha256: '0'.repeat(64) },
      { targetWeaponIds: ['t1'] }, { attestedBy: 'reconstruction' }, { createdAt: '2026-10-03T01:00:01.000Z' }, { extra: 1 }]) expect(integrity(patch)).toBe(true)
    for (const patch of [{ uncommittedBenchmarkCode: true }, { smoke: { tasks: 4, taskIds: null, budgetMs: null } }, { stage1: { ...PHASE2C26B2C2B2B_STAGE1, budgetMs: 60_000 } }]) {
      expect(integrity(patch)).toBe(false)
      expect(issue(patch)).not.toBe('')
    }
    // HEAD / code / Export / manifest / Stage 1 mismatches fail closed.
    expect(issue({ repositoryHead: 'f'.repeat(40) })).toMatch(/repositoryHead differs/)
    expect(issue({}, { repositoryHead: 'f'.repeat(40) })).toMatch(/repositoryHead differs/)
    expect(issue({ benchmarkCodeSha256: '0'.repeat(64) })).toMatch(/benchmarkCodeSha256 differs/)
    expect(issue({ exportSha256: '0'.repeat(64) })).toMatch(/exportSha256 differs/)
    expect(issue({ targetManifestSha256: '0'.repeat(64) })).toMatch(/targetManifestSha256 differs/)
    expect(issue({ stage1: { ...PHASE2C26B2C2B2B_STAGE1, concurrency: 3 } })).toMatch(/stage1 differs/)
    expect(issue({ stage1: { ...PHASE2C26B2C2B2B_STAGE1, budgetMs: 60_000 } })).toMatch(/stage1 differs/)
    expect(issue({ extent: L2 })).toMatch(/extent differs/)
    expect(issue({ candidateSafetyCap: 32 })).toMatch(/candidateSafetyCap differs/)
    expect(issue({ targetWeaponIds: ['t1'] })).toMatch(/targetWeaponIds differ/)
    // Not the runner, not clean, a smoke option, a later or malformed createdAt, a missing or extra field.
    expect(issue({ attestedBy: 'reconstruction' })).toMatch(/not attested by the runner/)
    expect(issue({ uncommittedBenchmarkCode: true })).toMatch(/uncommitted/)
    expect(issue({ uncommittedBenchmarkCode: null })).toMatch(/uncommitted/)
    expect(issue({ smoke: { tasks: 4, taskIds: null, budgetMs: null } })).toMatch(/smoke/)
    expect(issue({ createdAt: '2026-10-03T01:00:01.000Z' })).toMatch(/later than the first child start/)
    expect(issue({ createdAt: '2026-10-03 01:00' })).toMatch(/canonical UTC/)
    const missing: Record<string, unknown> = { ...attestation }
    delete missing.createdAt
    expect(verifyPhase2C26B2C2B2BStartAttestation(missing, expectation).verified).toBe(false)
    expect(issue({ firstCompatibleRanks: {} })).toMatch(/keys/)
    expect(verifyPhase2C26B2C2B2BStartAttestation(null, expectation).verified).toBe(false)
    expect(Object.keys(phase2c26b2c2b2bRegisteredConditions()).sort()).toEqual(['candidateSafetyCap', 'captureRule', 'contextBudget', 'expectedTasks', 'extent', 'extentLabel', 'memorySampleIntervalMs',
      'nodeYield', 'registeredP1', 'stage1', 'targets', 'tasksBudgetMs'])
  })

  it('grades launch provenance by the attestation file alone: absent never formal; present and correct verifies an interrupted reconstruction too; any mismatch fails closed', () => {
    const attestation = phase2c26b2c2b2bStartAttestationBody(observation)
    const file = { sha256: 'e'.repeat(64), body: attestation }
    const environment = environmentOf(attestation)
    // A correct runner attestation verifies, whether the raw came from the runner or from an interrupted-run reconstruction.
    expect(phase2c26b2c2b2bLaunchProvenance({ attestationFile: file, recordedAttestationSha256: file.sha256, environment, expected: expectation }))
      .toMatchObject({ verified: true, source: 'runner_start_attestation', workingTreeCleanVerified: true, issues: [] })
    // No attestation: never verified, whatever HEAD or cleanliness the raw claims.
    const none = phase2c26b2c2b2bLaunchProvenance({ attestationFile: null, recordedAttestationSha256: null, environment, expected: expectation })
    expect(none).toMatchObject({ verified: false, source: 'none', workingTreeCleanVerified: false })
    expect(none.reason).toMatch(/attestation is missing/)
    // A raw that names another attestation file, a raw environment disagreeing with the attestation, and each attested mismatch.
    expect(phase2c26b2c2b2bLaunchProvenance({ attestationFile: file, recordedAttestationSha256: '0'.repeat(64), environment, expected: expectation }).verified).toBe(false)
    expect(phase2c26b2c2b2bLaunchProvenance({ attestationFile: file, recordedAttestationSha256: file.sha256, environment: { ...environment, repositoryHead: 'f'.repeat(40) }, expected: expectation }).verified).toBe(false)
    for (const expected of [{ repositoryHead: 'f'.repeat(40) }, { benchmarkCodeSha256: '0'.repeat(64) }, { exportSha256: '0'.repeat(64) }, { targetManifestSha256: '0'.repeat(64) }]) {
      expect(phase2c26b2c2b2bLaunchProvenance({ attestationFile: file, recordedAttestationSha256: file.sha256, environment, expected: { ...expectation, ...expected } }).verified).toBe(false)
    }
    // A smoke launch is attested truthfully: not verified (never formal), yet no integrity issue (not an invalid run).
    const smoke = phase2c26b2c2b2bStartAttestationBody({ ...observation, uncommittedBenchmarkCode: true, stage1: { ...PHASE2C26B2C2B2B_STAGE1, budgetMs: 60_000 }, smoke: { tasks: 2, taskIds: null, budgetMs: 60_000 } })
    expect(phase2c26b2c2b2bLaunchProvenance({ attestationFile: { sha256: file.sha256, body: smoke }, recordedAttestationSha256: file.sha256, environment: environmentOf(smoke), expected: expectation }))
      .toMatchObject({ verified: false, integrityIssues: [] })
    expect(phase2c26b2c2b2bLaunchProvenance({ attestationFile: file, recordedAttestationSha256: '0'.repeat(64), environment, expected: expectation }).integrityIssues.join()).toMatch(/not the one the raw recorded/)
    // The evidence grade: formal needs both axes; an interrupted run is graded by the attestation, never automatically non-formal.
    expect(phase2c26b2c2b2bEvidenceGrade({ formalConditions: true, launchProvenanceVerified: true, partialRun: true })).toBe('formal')
    expect(phase2c26b2c2b2bEvidenceGrade({ formalConditions: true, launchProvenanceVerified: false, partialRun: true })).toBe('diagnostic_partial')
    expect(phase2c26b2c2b2bEvidenceGrade({ formalConditions: true, launchProvenanceVerified: false, partialRun: false })).toBe('non_formal')
    expect(phase2c26b2c2b2bEvidenceGrade({ formalConditions: false, launchProvenanceVerified: true, partialRun: false })).toBe('non_formal')
  })

  it('is written by the runner into the run dir, once and read-only, before the tasks child and before any Search child', () => {
    expect(PHASE2C26B2C2B2B_START_ATTESTATION_FILE).toBe('start-attestation.json')
    const write = runnerSource.indexOf('await write(attestationPath, attestation)')
    const chmod = runnerSource.indexOf('await chmod(attestationPath, 0o444)')
    const tasksChild = runnerSource.indexOf("await runChild('tasks', 'tasks'")
    const stage1 = runnerSource.indexOf('const stage1 = await pool(stage1Tasks,')
    const mkdirAt = runnerSource.indexOf('await mkdir(runDir, { recursive: true })')
    expect([mkdirAt, write, chmod, tasksChild, stage1].every(i => i > 0)).toBe(true)
    expect(mkdirAt < write && write < chmod && chmod < tasksChild && tasksChild < stage1).toBe(true)
    // The runner's own write helper creates files exclusively (`wx`): an existing attestation is never overwritten.
    expect(runnerSource).toMatch(/const write = \(path, value, pretty = true\) => writeFile\(path, [^\n]*\{ flag: 'wx' \}\)/)
    expect(runnerSource).toMatch(/if \(existsSync\(runDir\)\) throw new Error/)
    // The launch observation is taken by the runner itself before the attestation; a formal launch verifies it right away.
    expect(runnerSource).toMatch(/const repositoryHead = git\('rev-parse', 'HEAD'\)/)
    expect(runnerSource).toMatch(/phase2c26b2c2b2bStartAttestationBody\(\{ createdAt: new Date\(\)\.toISOString\(\)/)
    expect(runnerSource).toMatch(/stage1: stage1Conditions, smoke: smokeOptions \}\)/)
    expect(runnerSource).toMatch(/The start attestation read back is not the one written/)
    expect(runnerSource).toMatch(/verifyPhase2C26B2C2B2BStartAttestation\(/)
    expect(runnerSource).toMatch(/Commit ALL benchmark code before a formal measurement/)
    // Every ended child is persisted beside its record so an interrupted run keeps the parent's bookkeeping.
    expect(runnerSource).toMatch(/appendFileSync\(processesPath, JSON\.stringify\(\{ \.\.\.entry, recordFile \}\) \+ '\\n'\)/)
    expect(runnerSource).toMatch(/START \$\{id\} pid=/)
  })

  it('reconstructs an interrupted run only with a verifying attestation (fail closed otherwise) and never invents one', () => {
    expect(reconstructSource).not.toMatch(/visitPlannerAlternativeCandidates|runPhase2C26B2C2B2BTask\(|runPhase2C26B2C2B2BSearch|spawn\(|derivePhase2C26B2C1Schedule|--oracle|--manifest|_RESULT/)
    expect(reconstructSource).not.toMatch(/writeFile\([^)]*runDir|\brm\(|\bunlink\(|\brename\(|\bcopyFile\(|chmod\(/)
    expect(reconstructSource).toMatch(/writeFile\(paths\.output, text, \{ flag: 'wx' \}\)/)
    expect(reconstructSource).toMatch(/verifyPhase2C26B2C2B2BStartAttestation\(attestation, \{ repositoryHead: measuredHead, benchmarkCodeSha256: recomputedBenchmarkCodeSha256,/)
    expect(reconstructSource).toMatch(/if \(check\.integrityIssues\.length > 0\) throw new Error\(`The runner start attestation does not verify/)
    expect(reconstructSource).toMatch(/if \(!check\.verified && !allowNonformal\) throw/)
    expect(reconstructSource).toMatch(/firstChildStartedAt: tasksEnded\.startedAt/)
    expect(reconstructSource).toMatch(/uncommittedBenchmarkCode: attested \? attestation\.uncommittedBenchmarkCode : null/)
    expect(reconstructSource).not.toMatch(/attestedBy|phase2c26b2c2b2bStartAttestationBody/)
    expect(reconstructSource).toMatch(/status: 'interrupted'/)
    expect(reconstructSource).toMatch(/childRecordsModified: false, searchRun: false/)
    expect(reconstructSource).toMatch(/The ran tasks are not a prefix of the task order/)
  })

  it('makes a RESULT formal only with verified launch provenance; --allow-nonformal never promotes it', () => {
    expect(analyzerSource).toMatch(/const formalConditions = formalRunConditions && calculationCodeChangedSinceMeasuredHead\.length === 0 && !analysisUncommitted\s+const formal = formalConditions && launchProvenance\.verified\n/)
    expect(analyzerSource.match(/const formal = [^\n]*/)![0]).not.toMatch(/allowNonformal|interrupted|reconstruction/)
    expect(analyzerSource.match(/const formalRunConditions = [^\n]*/)![0]).not.toMatch(/allowNonformal|uncommittedBenchmarkCode/)
    expect(analyzerSource).toMatch(/if \(!launchProvenance\.verified && !allowNonformal\) throw/)
    expect(analyzerSource).toMatch(/phase2c26b2c2b2bLaunchProvenance\(\{\s*attestationFile:/)
    // The expected values come from the analyzer's own reads: the git objects of the measured HEAD, the Export and the manifest file.
    expect(analyzerSource).toMatch(/expected: \{ repositoryHead: measuredHead, benchmarkCodeSha256: recomputedBenchmarkCodeSha256, exportSha256: exportFile\.source\.sha256, targetManifestSha256: targetsFile\.source\.sha256,/)
    // A present attestation whose integrity fails is an invalid run.
    expect(analyzerSource).toMatch(/if \(attestationFile !== null\) invalidReasons\.push\(\.\.\.launchProvenance\.integrityIssues/)
    expect(analyzerSource).toMatch(/plannerGlobalPhase2C26B2C2B2BAnalysis\.ts', 'scripts\/analyze-planner-global-phase2c26b2c2b2b\.mjs', 'scripts\/reconstruct-planner-global-phase2c26b2c2b2b-partial-raw\.mjs'/)
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

function taskOf(rank: number, patch: Partial<Phase2C26B2C2B2BTaskInput> = {}): Phase2C26B2C2B2BTaskInput {
  return { taskId: `t00-r${String(rank).padStart(2, '0')}`, executionClass: 'stage1', targetWeaponId: TARGET, contextRank: rank, policy: 'P1', groupIndex: 100 + rank,
    reservationDigest: `d${rank}`, targetEligibleMinCardinality: rank === 1 ? 0 : 1, representativeFixedSetId: rank === 1 ? 'K0' : `K1:e${rank}`, representativeFixedTargetWeaponIds: rank === 1 ? [] : [`x${rank}`],
    defaultSearchInputDigest: `s${rank}`, searchInputDigest: `l${rank}`, extent: { ...L1 }, maxCostCohorts: 4, candidateSafetyCap: 1024, ...patch }
}
function delivered(s: Phase2C2CandidateSummary, index: number): Phase2C26B2B2A2DeliveredCandidate {
  return { deliveryIndex: index, stableKey: `k${String(index).padStart(5, '0')}`, orderingKeys: { estimatedOperationCount: s.estimatedOperationCount, estimatedGogmaAdvance: s.estimatedAdvances.gogma,
    estimatedSkillAdvance: s.estimatedAdvances.skill, estimatedNormalAdvance: s.estimatedAdvances.normal, preferredSourceRank: 0 }, comparatorWithPrevious: index === 0 ? null : -1,
    summary: s, reservationCheck: { respects: true, blockedHits: {}, exclusiveHit: [] } }
}
const filler = (n: number, cost: number, from = 0) => Array.from({ length: n }, (_, i) => summary({ sourceOwnedWeaponId: `other-${from + i}`, estimatedOperationCount: cost, estimatedAdvances: { normal: null, gogma: 1, skill: 0 } }))

function capture(task: Phase2C26B2C2B2BTaskInput, summaries: Phase2C2CandidateSummary[], termination: Phase2C26B2C2B2BSearchRecord['termination'], sentinel: Phase2C2CandidateSummary | null = null): Phase2C26B2C2B2BSearchRecord {
  const candidates = summaries.map(delivered)
  const status = termination === 'four_cost_cohorts_drained' || termination === 'candidate_safety_cap' ? 'consumer_stop' : termination
  const costs = [...new Set(summaries.map(s => s.estimatedOperationCount))]
  return { targetWeaponId: task.targetWeaponId, contextRank: task.contextRank, groupIndex: task.groupIndex, reservationDigest: task.reservationDigest, targetEligibleMinCardinality: task.targetEligibleMinCardinality,
    representativeFixedSetId: task.representativeFixedSetId, representativeFixedTargetWeaponIds: [...task.representativeFixedTargetWeaponIds], defaultSearchInputDigest: task.defaultSearchInputDigest,
    searchInputDigest: task.searchInputDigest, extent: { ...L1 }, excludedRouteKeys: ['current'], preferredOwnedWeaponId: null, maxCostCohorts: 4, candidateSafetyCap: 1024, status,
    summary: { deliveredCandidates: candidates.length + (sentinel ? 1 : 0), excludedCandidates: 0, exhausted: status === 'exhausted', stoppedByExtent: status === 'stopped_by_extent', stoppedByConsumer: status === 'consumer_stop' },
    candidates, nextCostSentinel: sentinel ? delivered(sentinel, candidates.length) : null, termination, captureComplete: termination !== 'candidate_safety_cap', safetyCapHit: termination === 'candidate_safety_cap',
    capturedCosts: costs, distinctCostCohorts: costs.length, nonmonotonicIndexes: [], costReadIssues: [], elapsedMs: 1 }
}
function runOf(task: Phase2C26B2C2B2BTaskInput, record: Phase2C26B2C2B2BSearchRecord | null, process: 'completed' | 'timeout' | 'out_of_memory' | 'process_failure' = 'completed'): Phase2C26B2C2B2BRun {
  const child = record === null ? null : { status: 'searched' as const, taskId: task.taskId, search: record }
  return { taskId: task.taskId, task, outcome: phase2c26b2c2b2bTaskOutcome(task.taskId, process, process === 'completed' ? child : null),
    process: { outcome: process, wallMs: 10, timedOut: process === 'timeout', budgetMs: 1 }, childWallMs: 9, scheduleMs: 1, yields: 3,
    memory: process === 'completed' ? { sampledMaxHeapUsedBytes: 100, sampledMaxRssBytes: 200, maxRssKiB: 1 } : null, lastIpcMemory: { maxHeapUsedBytes: 50, maxRssBytes: 300 },
    record: process === 'completed' ? child : null }
}
function withMatchAt(task: Phase2C26B2C2B2BTaskInput, at: number) {
  return capture(task, [summary({ estimatedOperationCount: 1, sourceOwnedWeaponId: 'cheap' }), ...filler(Math.max(at - 1, 0), 2), { ...MATCH }, ...filler(3, 3, 100), ...filler(2, 4, 200)],
    'four_cost_cohorts_drained', summary({ estimatedOperationCount: 5, sourceOwnedWeaponId: 'dear' }))
}
const miss = (task: Phase2C26B2C2B2BTaskInput) => capture(task, [summary({ estimatedOperationCount: 1, sourceOwnedWeaponId: 'cheap' }), ...filler(5, 2)], 'exhausted')
const reachOf = (groups: number[], first: number | null = 2) => [{ targetWeaponId: TARGET, compatibleGroupIndexes: groups, p1FirstCompatibleRank: first, inconsistencies: [] }]

describe('Phase 2-C2.6-B2-C2B2B analysis', () => {
  it('validates the raw capture at L1: an L2 or Target-specific extent, a digest drift, a capture drift and nonmonotonic costs fail closed', () => {
    const task = taskOf(2)
    const check = (record: Phase2C26B2C2B2BSearchRecord, t = task) => validatePhase2C26B2C2B2BRaw({ tasks: [t], runs: [runOf(t, record)], smoke: false })
    expect(check(withMatchAt(task, 5))).toEqual([])
    const mutate = (patch: (r: Phase2C26B2C2B2BSearchRecord) => void) => { const r = withMatchAt(task, 5); patch(r); return check(r).join('\n') }
    expect(mutate(r => { r.candidates[4]!.orderingKeys.estimatedOperationCount = 1; r.candidates[4]!.summary = { ...r.candidates[4]!.summary, estimatedOperationCount: 1 } })).toMatch(/semantic_failure: .*nonmonotonic/)
    expect(mutate(r => { r.extent = { ...L2 } })).toMatch(/not the common L1 extent/)
    expect(mutate(r => { r.extent = { ...L1, maxSkillAdvance: 22 } })).toMatch(/not the common L1 extent/)
    expect(mutate(r => { r.searchInputDigest = 'x' })).toMatch(/not the task's context/)
    expect(mutate(r => { r.candidateSafetyCap = 32 })).toMatch(/capture rule drift/)
    expect(mutate(r => { r.capturedCosts = [1, 2, 3] })).toMatch(/cohorts drift/)
    expect(validatePhase2C26B2C2B2BRaw({ tasks: [taskOf(2, { extent: { ...L2 } })], runs: [], smoke: true }).join()).toMatch(/task extent is not the common L1 extent/)
    expect(validatePhase2C26B2C2B2BRaw({ tasks: [task, taskOf(3)], runs: [runOf(task, withMatchAt(task, 5))], smoke: false }).join()).toMatch(/ran 1 of 2/)
  })

  it('searches every rank regardless of an earlier exact match and aggregates one Target with per-Target resources', () => {
    const tasks = Array.from({ length: 32 }, (_, i) => taskOf(i + 1))
    const runs = tasks.map(task => runOf(task, task.contextRank === 2 ? withMatchAt(task, 3) : task.contextRank === 30 ? withMatchAt(task, 1) : miss(task)))
    const result = runPhase2C26B2C2B2BAnalysis({ targetWeaponIds: [TARGET], tasks, runs, reach: reachOf([102, 130]), b2c1FirstCompatible: new Map([[TARGET, 2]]), oracle: ORACLE, smoke: false })
    expect(result.invalidReasons).toEqual([])
    expect(result.rows[0]).toMatchObject({ recovery: 'C8', fullyMeasured: true, policies: { C8: { firstExactContextRank: 2, firstExactCandidateIndex: 3, deltaFromFirstCompatible: 0 } } })
    expect(result.aggregates.firstExactEqualsFirstCompatible).toEqual({ recoveredC4C: 1, equal: 1, later: 0 })
    expect(result.aggregates.targetResources).toEqual([expect.objectContaining({ targetWeaponId: TARGET, started: 32, completed: 32, peakHeapBytesMax: 100, peakRssBytesMax: 1024 })])
    expect(result.decisionInput).toMatchObject({ tasks: 32, targets: 1, unmeasuredTasks: 0, exactTargets: { C8: 1, C32: 1, C4C: 1 } })
    // An exact from an incompatible context, and a first exact before the first compatible rank, fail closed.
    expect(runPhase2C26B2C2B2BAnalysis({ targetWeaponIds: [TARGET], tasks, runs, reach: reachOf([102]), b2c1FirstCompatible: new Map([[TARGET, 2]]), oracle: ORACLE, smoke: false })
      .invalidReasons.join()).toMatch(/semantic_failure: t00-r30: an exact Candidate from a reservation-incompatible context/)
  })

  it('never reads a timeout / OOM / notRun as Candidate 0, and keeps an interrupted run INCOMPLETE whatever was recovered', () => {
    const tasks = Array.from({ length: 32 }, (_, i) => taskOf(i + 1))
    const ran = tasks.slice(0, 12).map(task => runOf(task, task.contextRank === 2 ? withMatchAt(task, 3) : [10, 11].includes(task.contextRank) ? null : miss(task),
      task.contextRank === 10 ? 'timeout' : task.contextRank === 11 ? 'out_of_memory' : 'completed'))
    const interruption = { stoppedAt: '2026-10-03T05:00:00.000Z', reason: 'host restart', notRunTaskIds: tasks.slice(12).map(t => t.taskId) }
    const result = runPhase2C26B2C2B2BAnalysis({ targetWeaponIds: [TARGET], tasks, runs: ran, reach: reachOf([102]), b2c1FirstCompatible: new Map([[TARGET, 2]]), oracle: ORACLE, smoke: false, interruption })
    expect(result.invalidReasons).toEqual([])
    expect(result.aggregates.execution).toMatchObject({ tasks: 32, started: 12, completed: 10, timeout: 1, outOfMemory: 1, notRun: 20 })
    expect(result.contexts.filter(c => !c.measured).map(c => c.candidateCount)).toEqual(Array(22).fill(null))
    expect(result.contexts.filter(c => !c.measured).every(c => c.coverage === null && !c.hit.C4C)).toBe(true)
    expect(result.decisionInput).toMatchObject({ unmeasuredTasks: 22, exactTargets: { C8: 1, C32: 1, C4C: 1 } })
    expect(phase2c26b2c2b2bDecision({ invalidReasons: [], ...result.decisionInput, tasks: 224, targets: 7, exactTargets: { C8: 7, C32: 7, C4C: 7 } }).case).toBe('B2C2B2B_INCOMPLETE')
    expect(runPhase2C26B2C2B2BAnalysis({ targetWeaponIds: [TARGET], tasks, runs: ran, reach: reachOf([102]), b2c1FirstCompatible: new Map([[TARGET, 2]]), oracle: ORACLE, smoke: false }).invalidReasons.join()).toMatch(/ran 12 of 32/)
    expect(validatePhase2C26B2C2B2BRaw({ tasks, runs: [ran[0]!, ran[2]!], smoke: false, interruption: { ...interruption, notRunTaskIds: tasks.slice(2).map(t => t.taskId) } }).join()).toMatch(/not a prefix/)
  })

  it('decides ALL_C8 / ALL_C32 / ALL_C4C / PARTIAL / INCOMPLETE / INVALID by the registered rule for 7 Targets x 224 tasks', () => {
    const d = (C8: number, C32: number, C4C: number, extra: Partial<Parameters<typeof phase2c26b2c2b2bDecision>[0]> = {}) =>
      phase2c26b2c2b2bDecision({ invalidReasons: [], tasks: 224, targets: 7, unmeasuredTasks: 0, exactTargets: { C8, C32, C4C }, unresolvedSafetyCapTargets: 0, ...extra }).case
    expect(d(7, 7, 7)).toBe('B2C2B2B_ALL_C8')
    expect(d(6, 7, 7)).toBe('B2C2B2B_ALL_C32')
    expect(d(5, 6, 7)).toBe('B2C2B2B_ALL_C4C')
    expect(d(3, 4, 6)).toBe('B2C2B2B_PARTIAL')
    expect(phase2c26b2c2b2bDecision({ invalidReasons: [], tasks: 224, targets: 7, unmeasuredTasks: 0, exactTargets: { C8: 0, C32: 0, C4C: 0 }, unresolvedSafetyCapTargets: 0 })).toMatchObject({ case: 'B2C2B2B_PARTIAL', noExactTarget: true })
    expect(d(3, 4, 6, { unresolvedSafetyCapTargets: 1 })).toBe('B2C2B2B_INCOMPLETE')
    expect(d(7, 7, 7, { unmeasuredTasks: 1 })).toBe('B2C2B2B_INCOMPLETE')
    expect(d(7, 7, 7, { invalidReasons: ['x'] })).toBe('B2C2B2B_INVALID')
    expect(d(7, 7, 7, { tasks: 352 })).toBe('B2C2B2B_INVALID')
    expect(d(7, 7, 7, { tasks: 223 })).toBe('B2C2B2B_INVALID')
    expect(d(6, 6, 6, { targets: 6 })).toBe('B2C2B2B_INVALID')
    expect(() => d(7, 6, 7)).toThrow()
    expect(PHASE2C26B2C2B2B_DECISION_RULE.order.map(line => line.split(':')[0])).toEqual(['B2C2B2B_INVALID', 'B2C2B2B_INCOMPLETE', 'B2C2B2B_ALL_C8', 'B2C2B2B_ALL_C32', 'B2C2B2B_ALL_C4C', 'B2C2B2B_INCOMPLETE', 'B2C2B2B_PARTIAL'])
    expect(PHASE2C26B2C2B2B_DECISION_RULE.order[1]).toMatch(/never Candidate 0/)
    expect(PHASE2C26B2C2B2B_DECISION_RULE.order[6]).toMatch(/never read as "the Route does not exist"/)
  })

  it('compares L1 with B2-C2B2A L2 on the contexts both phases started, matched by Target, rank and digests (diagnostic only)', () => {
    const row = (taskId: string, rank: number, process: string, patch: Partial<Phase2C26B2C2B2BL2TaskRow> = {}): Phase2C26B2C2B2BL2TaskRow => ({ taskId, targetWeaponId: 'x', contextRank: rank,
      reservationDigest: `d${rank}`, defaultSearchInputDigest: `s${rank}`, process, wallMs: process === 'not_run' ? null : 100, searchElapsedMs: process === 'completed' ? 90 : null,
      peakHeapBytes: process === 'not_run' ? null : 1000, peakRssBytes: process === 'not_run' ? null : 2000, yields: process === 'completed' ? 5 : null, termination: process === 'completed' ? 'exhausted' : null,
      candidateCount: process === 'completed' ? 4 : null, safetyCapHit: process === 'completed' ? false : null, compatible: rank === 2, hitC4C: false, ...patch })
    const l2 = [row('t00-r01', 1, 'completed'), row('t00-r02', 2, 'timeout'), row('t00-r03', 3, 'out_of_memory'), row('t00-r04', 4, 'not_run')]
    const l1 = [row('t00-r01', 1, 'completed', { searchElapsedMs: 45, peakHeapBytes: 500 }), row('t00-r02', 2, 'completed', { hitC4C: true }), row('t00-r03', 3, 'completed'), row('t00-r04', 4, 'completed')]
    const result = phase2c26b2c2b2bL2Comparison(l2, l1)
    expect(result.issues).toEqual([])
    expect(result).toMatchObject({ pairs: 3, bothCompleted: 1, processTransitions: { 'completed->completed': 1, 'out_of_memory->completed': 1, 'timeout->completed': 1 } })
    expect(result.l2).toMatchObject({ started: 3, completed: 1, timeout: 1, outOfMemory: 1 })
    expect(result.l1).toMatchObject({ started: 3, completed: 3, timeout: 0, outOfMemory: 0, exactC4C: 1 })
    expect(result.bothCompletedRatios).toMatchObject({ searchElapsedSumL1OverL2: 0.5, peakHeapMedianOfRatios: 0.5 })
    expect(phase2c26b2c2b2bL2Comparison([row('t00-r01', 1, 'completed', { reservationDigest: 'other' })], [row('t00-r01', 1, 'completed')]).issues.join()).toMatch(/not this context/)
  })
})

// ---------------------------------------------------------------- isolation and provenance

describe('Phase 2-C2.6-B2-C2B2B isolation and provenance', () => {
  it('is never imported by Production and hard-codes no Target, Entry, OwnedWeapon or reservation', () => {
    const production = import.meta.glob(['../domain/**/*.ts', '../services/**/*.ts', '../workers/**/*.ts', '../pages/**/*.tsx', '../components/**/*.tsx', '../db/**/*.ts', '!../**/*.test.ts', '!../**/*.test.tsx'],
      { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    expect(Object.keys(production).length).toBeGreaterThan(50)
    expect(Object.entries(production).filter(([, source]) => /plannerGlobalPhase2C26B2C2B2B/.test(source)).map(([path]) => path)).toEqual([])
    for (const source of [searchSource, targetsSource, analysisSource, prepareSource, runnerSource, analyzerSource, reconstructSource]) {
      expect(source).not.toMatch(/\bc\d+-p\d+\b|fnv1a32[-:][0-9a-f]{8}|[0-9a-f]{8}-[0-9a-f]{4}-|build-list\.|02876df4|05e6b206|a6c17e25|b27e57a7|b6780f04|e4147de7|e523209e/)
    }
    for (const source of [searchSource, targetsSource, analysisSource]) expect(source).not.toMatch(/node:fs|readFile|import\.meta\.glob/)
  })

  it('keeps the oracle, its manifest, every earlier RESULT, the ladder rung of a Target and every Target-specific extent out of the Search side', () => {
    for (const source of [searchSource, runnerSource]) {
      expect(source).not.toMatch(/ORACLE_[1]657|1657|--oracle|--manifest|--b2c2b1-result|--b2c1-result|--b2b1-result|--b2c2b2a-result|gogmaUsage|plannerGlobal[O]racle|_RESULT|phase2c2OracleCoverage|Analysis'|Targets'|firstCompatible|firstLadderRung|requiredExtent|phase2c26b2aReachability|phase2c26b2aRouteExtent|materialization\.estimated/)
    }
    expect(searchSource).not.toMatch(/plannerGlobalPhase2C26B2C2B2BTargets|plannerGlobalPhase2C26B2C2B2ATargets|plannerGlobalPhase2C26B2C2B1Analysis|plannerGlobalPhase2C26B2C1Analysis|Analysis'/)
    expect(runnerSource).toMatch(/--targets/)
    expect(runnerSource).toMatch(/oracleGuidedPolicySelection: true, oracleGuidedTargetPopulation: true, contextOrderingUsesOracle: false, oracleReadBySearchChild: false, oracleMatchUsedForEarlyStop: false/)
    expect(runnerSource).toMatch(/perTargetExtent: false, targetIndividualOracleExtentAsSearchInput: false, ladderRungsSearched: \['L1'\]/)
    expect(runnerSource).toMatch(/a task extent is not the common L1 extent/)
    expect(prepareSource).toMatch(/--b2c2b1-result/)
    expect(prepareSource).not.toMatch(/--oracle|--manifest|visitPlannerAlternativeCandidates/)
    expect(analyzerSource).toMatch(/--oracle/)
    expect(analyzerSource).toMatch(/--b2c2b2a-result/)
    expect(analysisSource).toMatch(/phase2c26b2c2b2aCompareContext\(/)
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
    for (const source of [searchSource, analysisSource, runnerSource, analyzerSource]) {
      expect(source).not.toMatch(/runPreparedPlannerAlternativeKernel|preparePlannerAlternativeKernel|createProductionPlan|runPhase2C2Kernel|runPhase2C2Baseline|runPlannerDeterministicSchedule|createPlannerAlternativeWhatIfComparison|searchCandidates\(/)
    }
    for (const source of [analysisSource, analyzerSource, targetsSource, prepareSource]) expect(source).not.toMatch(/visitPlannerAlternativeCandidates|runPhase2C26B2C2B2BSearch|runPhase2C26B2C2B2BTask\(/)
  })
})
