import { beforeEach, describe, expect, it, vi } from 'vitest'
import rawB2C2B1 from '../../docs/PLANNER_GLOBAL_PHASE2C26B2C2B1_RESULT.json?raw'
import rawB2C1 from '../../docs/PLANNER_GLOBAL_PHASE2C26B2C1_RESULT.json?raw'
import rawB2C2B2B from '../../docs/PLANNER_GLOBAL_PHASE2C26B2C2B2B_RESULT.json?raw'
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
import { reconstructPhase2C26B2B2AContext, type Phase2C26B2B2AContext } from './plannerGlobalPhase2C26B2B2A'
import type { Phase2C26B2B2A2DeliveredCandidate } from './plannerGlobalPhase2C26B2B2A2'
import { derivePhase2C26B2C1Schedule, type Phase2C26B2C1Schedule } from './plannerGlobalPhase2C26B2C1'
import { parsePhase2C26B2C2AB2C1Authority, PHASE2C26B2C2A_REGISTERED_B2C1 } from './plannerGlobalPhase2C26B2C2ATargets'
import {
  buildPhase2C26B2C2B2ATasks,
  phase2c26b2c2b2aL2Context,
  phase2c26b2c2b2aTaskOutcome,
  runPhase2C26B2C2B2ASearch,
  runPhase2C26B2C2B2ATask,
  PHASE2C26B2C2B2A_EXTENT,
  PHASE2C26B2C2B2A_STAGE1,
} from './plannerGlobalPhase2C26B2C2B2A'
import { parsePhase2C26B2C2B2AB2C2B1Authority, phase2c26b2c2b2aPopulation, PHASE2C26B2C2B2A_REGISTERED_B2C2B1 } from './plannerGlobalPhase2C26B2C2B2ATargets'
import { PHASE2C26B2C2B2B_CANDIDATE_SAFETY_CAP, PHASE2C26B2C2B2B_MAX_COST_COHORTS, PHASE2C26B2C2B2B_STAGE1, PHASE2C26B2C2B2B_START_ATTESTATION_PHASE } from './plannerGlobalPhase2C26B2C2B2B'
import { phase2c26b2c2b2bPopulation } from './plannerGlobalPhase2C26B2C2B2BTargets'
import {
  buildPhase2C26B2C2B2CTasks,
  parsePhase2C26B2C2B2CTargetManifest,
  phase2c26b2c2b2cL2Context,
  phase2c26b2c2b2cPolicyDrift,
  phase2c26b2c2b2cRegisteredConditions,
  phase2c26b2c2b2cStartAttestationBody,
  phase2c26b2c2b2cTaskOutcome,
  runPhase2C26B2C2B2CSearch,
  runPhase2C26B2C2B2CTask,
  verifyPhase2C26B2C2B2CStartAttestation,
  PHASE2C26B2C2B2C_CANDIDATE_SAFETY_CAP,
  PHASE2C26B2C2B2C_CAPTURE_PREFIXES,
  PHASE2C26B2C2B2C_CONTEXT_BUDGET,
  PHASE2C26B2C2B2C_EXPECTED_TASKS,
  PHASE2C26B2C2B2C_EXTENT,
  PHASE2C26B2C2B2C_MAX_COST_COHORTS,
  PHASE2C26B2C2B2C_NOT_RUN,
  PHASE2C26B2C2B2C_REGISTERED_P1,
  PHASE2C26B2C2B2C_STAGE1,
  PHASE2C26B2C2B2C_START_ATTESTATION_FILE,
  PHASE2C26B2C2B2C_START_ATTESTATION_PHASE,
  PHASE2C26B2C2B2C_TARGET_SOURCE,
  PHASE2C26B2C2B2C_TARGETS,
  type Phase2C26B2C2B2CAttestationExpectation,
  type Phase2C26B2C2B2CSearchRecord,
  type Phase2C26B2C2B2CTaskInput,
} from './plannerGlobalPhase2C26B2C2B2C'
import searchSource from './plannerGlobalPhase2C26B2C2B2C.ts?raw'
import {
  parsePhase2C26B2C2B2CB2C2B2BAuthority,
  phase2c26b2c2b2cPopulation,
  phase2c26b2c2b2cTargetManifest,
  PHASE2C26B2C2B2C_REGISTERED_B2C2B1,
  PHASE2C26B2C2B2C_REGISTERED_B2C2B2B,
} from './plannerGlobalPhase2C26B2C2B2CTargets'
import targetsSource from './plannerGlobalPhase2C26B2C2B2CTargets.ts?raw'
import {
  phase2c26b2c2b2cDecision,
  phase2c26b2c2b2cE1LadderAggregate,
  phase2c26b2c2b2cEvidenceGrade,
  phase2c26b2c2b2cLaunchProvenance,
  phase2c26b2c2b2cRouteRecoverySummary,
  runPhase2C26B2C2B2CAnalysis,
  validatePhase2C26B2C2B2CRaw,
  PHASE2C26B2C2B2C_DECISION_RULE,
  PHASE2C26B2C2B2C_E1_LADDER_LIMITATIONS,
  type Phase2C26B2C2B2CRun,
} from './plannerGlobalPhase2C26B2C2B2CAnalysis'
import analysisSource from './plannerGlobalPhase2C26B2C2B2CAnalysis.ts?raw'
import prepareSource from '../../scripts/prepare-planner-global-phase2c26b2c2b2c-targets.mjs?raw'
import runnerSource from '../../scripts/run-planner-global-phase2c26b2c2b2c.mjs?raw'
import analyzerSource from '../../scripts/analyze-planner-global-phase2c26b2c2b2c.mjs?raw'
import reconstructSource from '../../scripts/reconstruct-planner-global-phase2c26b2c2b2c-partial-raw.mjs?raw'

/*
 * Issue #154 Phase 2-C2.6-B2-C2B2C: the E1 ∩ L2 (L2-needed) Targets searched in their P1 top-32 contexts at the common L2 extent.
 * The synthetic worlds below are invented for the tests; the committed B2-C2B1 / B2-C1 / B2-C2B2B RESULTs are read only to
 * check the authorities. The oracle modules are never imported here (the Phase 2-A.5 isolation rule).
 */

/** Every Search input, in call order; `script` replays one real Candidate with the scripted operation costs (as in B2-C2B2B). */
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
const b2c2b2bJson = JSON.parse(rawB2C2B2B)
const b2c2b2bSha = PHASE2C26B2C2B2C_REGISTERED_B2C2B2B.resultSha256
const exportSha = b2c2b1Json.provenance.exportSha256 as string
const L1 = { maxNormalAdvance: 8, maxGogmaAdvance: 235, maxSkillAdvance: 256 }
const L2 = { maxNormalAdvance: 128, maxGogmaAdvance: 235, maxSkillAdvance: 1500 }
const authorities = () => ({ b2c2b1: parsePhase2C26B2C2B2AB2C2B1Authority(b2c2b1Json, b2c2b1Sha).authority!, b2c1: parsePhase2C26B2C2AB2C1Authority(b2c1Json, b2c1Sha).authority!,
  b2c2b2b: parsePhase2C26B2C2B2CB2C2B2BAuthority(b2c2b2bJson, b2c2b2bSha, { b2c2b1ResultSha256: b2c2b1Sha, exportSha256: exportSha }).authority! })
const routesOf = (j: typeof b2c2b1Json) => j.routes as { targetWeaponId: string; cohort: string; firstLadderRung: string; required: { normal: number | null; gogma: number | null; skill: number | null } }[]

// ---------------------------------------------------------------- the E1 ∩ L2 population and manifest

describe('Phase 2-C2.6-B2-C2B2C E1 ∩ L2 population and Target manifest', () => {
  it('derives the population mechanically from the committed B2-C2B1 RESULT: E1 = L1 7 (the B2-C2B2B Targets) + L2-needed 4, overlap 0, union 11', () => {
    const { b2c2b1, b2c1, b2c2b2b } = authorities()
    const population = phase2c26b2c2b2cPopulation(b2c2b1, b2c1, b2c2b1Json, b2c2b2b)
    expect(population.issues).toEqual([])
    expect(population.targetWeaponIds).toHaveLength(PHASE2C26B2C2B2C_TARGETS)
    // The same sets straight from the RESULT rows (no ID is written down anywhere).
    const fromRows = (rung: string) => routesOf(b2c2b1Json).filter(r => r.cohort === 'E1' && r.firstLadderRung === rung).map(r => r.targetWeaponId).sort()
    expect(population.targetWeaponIds).toEqual(fromRows('L2'))
    expect(population.split.l2).toEqual(fromRows('L2'))
    expect(population.split.l1).toEqual(fromRows('L1'))
    expect(population.split).toMatchObject({ overlap: 0, union: 11 })
    expect([population.split.e1.length, population.split.l1.length, population.split.l2.length]).toEqual([11, 7, 4])
    // E1 is the B2-C2B2A E1 population; E1 ∩ L1 is exactly what B2-C2B2B searched; E1 ∩ L2 is B2-C2B2B's excluded L2-needed set.
    const e1 = phase2c26b2c2b2aPopulation(b2c2b1, b2c1).e1
    expect(population.split.e1).toEqual(e1)
    expect([...population.split.l1, ...population.split.l2].sort()).toEqual(e1)
    expect(population.split.l1).toEqual(b2c2b2b.targetWeaponIds)
    expect(population.split.l2).toEqual(phase2c26b2c2b2bPopulation(b2c2b1, b2c1, b2c2b1Json).l2Needed)
    expect(population.targetWeaponIds.some(id => b2c2b2b.targetWeaponIds.includes(id))).toBe(false)
    expect(PHASE2C26B2C2B2C_REGISTERED_B2C2B1).toMatchObject({ e1: 11, l1Covered: 7, l2Covered: 11, l2Needed: 4, l2Rung: { id: 'L2', extent: L2 }, l1Rung: { id: 'L1', extent: L1 } })
    // Every population Route's recorded required extent fits L2 but not L1.
    const fits = (id: string, e: typeof L1) => { const r = routesOf(b2c2b1Json).find(x => x.targetWeaponId === id)!.required; return (r.normal ?? 0) <= e.maxNormalAdvance && (r.gogma ?? 0) <= e.maxGogmaAdvance && (r.skill ?? 0) <= e.maxSkillAdvance }
    expect(population.targetWeaponIds.every(id => fits(id, L2))).toBe(true)
    expect(population.targetWeaponIds.some(id => fits(id, L1))).toBe(false)
  })

  it('fails closed when the split, a rung, a required extent, coverage or the B2-C2B2B Targets drift', () => {
    const { b2c2b1, b2c1, b2c2b2b } = authorities()
    const population = phase2c26b2c2b2cPopulation(b2c2b1, b2c1, b2c2b1Json, b2c2b2b).targetWeaponIds
    const mutate = (patch: (j: typeof b2c2b1Json) => void) => { const copy = structuredClone(b2c2b1Json); patch(copy); return phase2c26b2c2b2cPopulation(b2c2b1, b2c1, copy, b2c2b2b) }
    const row = (j: typeof b2c2b1Json, id: string) => routesOf(j).find(r => r.targetWeaponId === id)!
    expect(mutate(j => { row(j, population[0]!).required.skill = 2000 }).issues.join()).toMatch(/does not fit L2/)
    // An L2-needed Route without a Normal stream whose Skill is pulled inside L1.
    const skillOnly = population.find(id => routesOf(b2c2b1Json).find(r => r.targetWeaponId === id)!.required.normal === null)!
    expect(mutate(j => { row(j, skillOnly).required.skill = 100 }).valid).toBe(false)
    expect(mutate(j => { row(j, population[0]!).firstLadderRung = 'L1' }).valid).toBe(false)
    expect(mutate(j => { j.ladder.rungs[2].extent.maxSkillAdvance = 1024 }).issues.join()).toMatch(/rung L2 is not the common L2 extent/)
    expect(mutate(j => { j.ladderCoverage.e1.byRung[2].covered = 10 }).issues.join()).toMatch(/L2 is not the registered 11 of 11/)
    expect(mutate(j => { j.ladderCoverage.e1.firstRungHistogram.L2 = 3 }).issues.join()).toMatch(/firstRungHistogram/)
    // A parsed authority whose rung moved: the split is no longer 7 + 4.
    const moved = structuredClone(b2c2b1)
    moved.routes.find(r => r.targetWeaponId === population[0])!.firstLadderRung = 'L1'
    expect(phase2c26b2c2b2cPopulation(moved, b2c1, b2c2b1Json, b2c2b2b).valid).toBe(false)
    // The B2-C2B2B Targets must be exactly E1 ∩ L1.
    expect(phase2c26b2c2b2cPopulation(b2c2b1, b2c1, b2c2b1Json, { ...b2c2b2b, targetWeaponIds: b2c2b2b.targetWeaponIds.slice(1) }).issues.join()).toMatch(/B2-C2B2B RESULT Targets are not E1 ∩ L1/)
    expect(phase2c26b2c2b2cPopulation(b2c2b1, b2c1, b2c2b1Json, { ...b2c2b2b, targetWeaponIds: [...b2c2b2b.targetWeaponIds.slice(1), population[0]!].sort() }).valid).toBe(false)
    expect(phase2c26b2c2b2cPopulation(b2c2b1, b2c1, b2c2b1Json, { ...b2c2b2b, b2c2b1ResultSha256: '0'.repeat(64) }).valid).toBe(false)
    expect(phase2c26b2c2b2cPopulation(b2c2b1, b2c1, b2c2b1Json, null).issues.join()).toMatch(/no B2-C2B2B authority/)
    expect(phase2c26b2c2b2cPopulation({ ...b2c2b1, exportSha256: '0'.repeat(64) }, b2c1, b2c2b1Json, b2c2b2b).valid).toBe(false)
    expect(() => phase2c26b2c2b2cTargetManifest(moved, b2c1, b2c2b1Json, b2c2b2b)).toThrow(/not valid/)
  })

  it('reads the committed B2-C2B2B RESULT as the formal L1 predecessor only, failing closed on another SHA-256, case, grade, extent or Target row', () => {
    const expected = { b2c2b1ResultSha256: b2c2b1Sha, exportSha256: exportSha }
    const ok = parsePhase2C26B2C2B2CB2C2B2BAuthority(b2c2b2bJson, b2c2b2bSha, expected)
    expect(ok.issues).toEqual([])
    expect(ok.authority).toMatchObject({ decisionCase: 'B2C2B2B_INCOMPLETE', evidenceGrade: 'formal', formal: true, partialRun: false, extent: L1,
      exactTargets: { C8: 6, C32: 6, C4C: 7 }, firstExactEqualsFirstCompatible: { recoveredC4C: 7, equal: 7, later: 0 },
      execution: { tasks: 224, started: 224, completed: 191, timeout: 33, outOfMemory: 0, processFailure: 0, contextMismatch: 0, notRun: 0 } })
    expect(ok.authority!.targetWeaponIds).toHaveLength(7)
    expect(ok.authority!.targets.every(t => t.firstLadderRung === 'L1')).toBe(true)
    const bad = (patch: (j: typeof b2c2b2bJson) => void, sha: string = b2c2b2bSha, e: { b2c2b1ResultSha256: string; exportSha256: string } = expected) => { const copy = structuredClone(b2c2b2bJson); patch(copy); return parsePhase2C26B2C2B2CB2C2B2BAuthority(copy, sha, e).valid }
    expect(bad(() => undefined, '0'.repeat(64))).toBe(false)
    expect(bad(j => { j.decision.case = 'B2C2B2B_ALL_C4C' })).toBe(false)
    expect(bad(j => { j.provenance.formal = false })).toBe(false)
    expect(bad(j => { j.provenance.partialRun = true })).toBe(false)
    expect(bad(j => { j.conditions.searchExtent = L2 })).toBe(false)
    expect(bad(j => { j.targets[0].firstLadderRung = 'L2' })).toBe(false)
    expect(bad(j => { j.targets.pop() })).toBe(false)
    expect(bad(j => { j.aggregates.exactTargets.C4C = 6 })).toBe(false)
    expect(bad(j => { j.invalidReasons = ['x'] })).toBe(false)
    expect(bad(() => undefined, b2c2b2bSha, { ...expected, exportSha256: '0'.repeat(64) })).toBe(false)
    expect(bad(() => undefined, b2c2b2bSha, { ...expected, b2c2b1ResultSha256: '0'.repeat(64) })).toBe(false)
  })

  it('writes the population as 4 sorted Target IDs and nothing else, exactly what the Search runner accepts', () => {
    const { b2c2b1, b2c1, b2c2b2b } = authorities()
    const manifest = phase2c26b2c2b2cTargetManifest(b2c2b1, b2c1, b2c2b1Json, b2c2b2b)
    expect(manifest).toMatchObject({ sourceResultSha256: PHASE2C26B2C2B2C_TARGET_SOURCE.resultSha256, population: 'E1_L2', policy: 'P1', contextBudget: 32, exportSha256: exportSha })
    expect(Object.keys(manifest).sort()).toEqual(['contextBudget', 'exportSha256', 'phase', 'policy', 'population', 'sourceResultSha256', 'targetWeaponIds'])
    expect(JSON.stringify({ ...manifest, phase: '', population: '' })).not.toMatch(/rank|fnv1a32|firstCompatible|required|maxSkill|maxNormal|L1|L2|K1:|oracle/i)
    expect(parsePhase2C26B2C2B2CTargetManifest(structuredClone(manifest))).toMatchObject({ valid: true, issues: [] })
    const bad = (patch: (m: Record<string, unknown> & typeof manifest) => void) => { const copy = structuredClone(manifest) as Record<string, unknown> & typeof manifest; patch(copy); return parsePhase2C26B2C2B2CTargetManifest(copy).valid }
    expect(bad(m => { m.targetWeaponIds = m.targetWeaponIds.slice(1) })).toBe(false)
    expect(bad(m => { m.targetWeaponIds = [...m.targetWeaponIds].reverse() })).toBe(false)
    expect(bad(m => { m.targetWeaponIds = [...m.targetWeaponIds, ...b2c2b2b.targetWeaponIds].sort() })).toBe(false)
    expect(bad(m => { m.sourceResultSha256 = '0'.repeat(64) })).toBe(false)
    expect(bad(m => { (m as Record<string, unknown>).population = 'E1_L1' })).toBe(false)
    expect(bad(m => { m.contextBudget = 16 })).toBe(false)
    for (const field of ['firstCompatibleRanks', 'requiredExtents', 'firstLadderRungs', 'oracleRoutes', 'expectedStableKeys', 'compatibility', 'extent']) expect(bad(m => { m[field] = {} })).toBe(false)
  })
})

// ---------------------------------------------------------------- a synthetic world (Search positions beyond L1)

const SOURCE_A_SKILL = 'series_skill.fixture.z'
const SOURCE_B_SKILL = 'series_skill.fixture.b-source'

function world() {
  const skill = { seriesSkillId: SOURCE_A_SKILL, groupSkillId: null, matchMode: 'all' as const }
  const a: TargetWeapon = orchestrationTarget('target.b2c2b2c.a', { priority: 5, idealSkillCondition: skill, practicalSkillCondition: skill })
  const b = skillConstrainedTarget('target.b2c2b2c.b', { priority: 1 })
  const built = orchestrationScenario({
    engine: { gogmaPositions: L2.maxGogmaAdvance + 8, skillPositions: L2.maxSkillAdvance + 8 },
    targets: [a, b],
    ownedWeapons: [orchestrationSource(ORCHESTRATION_SOURCE_A, { seriesSkillId: SOURCE_A_SKILL }),
      orchestrationSource(ORCHESTRATION_SOURCE_B, { restorationBonuses: belowPracticalBonuses(), seriesSkillId: SOURCE_B_SKILL })],
    entries: [
      orchestrationEntry('build-list.b2c2b2c.a', a, resetRoute(ORCHESTRATION_SOURCE_A), { finalBonuses: idealBonuses(), seriesSkillId: SOURCE_A_SKILL }),
      orchestrationEntry('build-list.b2c2b2c.b', b, { kind: 'existing_gogma_mixed', sourceOwnedWeaponId: resetRoute(ORCHESTRATION_SOURCE_B).sourceOwnedWeaponId,
        operations: [...resetRoute(ORCHESTRATION_SOURCE_B).operations, ...resetSkillsRoute(ORCHESTRATION_SOURCE_B).operations] }),
    ],
  })
  const schedule = derivePhase2C26B2C1Schedule(built.input, globalResearchDependencies(built.engine))
  return { built, schedule }
}
const IDS = ['target.b2c2b2c.a', 'target.b2c2b2c.b']

function defaultContextOf(schedule: Phase2C26B2C1Schedule, id = 'target.b2c2b2c.b', rank = 2): Phase2C26B2B2AContext {
  const row = schedule.contexts.find(c => c.targetWeaponId === id && c.ranks.P1 === rank)!
  const rebuilt = reconstructPhase2C26B2B2AContext(schedule.snapshot, { targetWeaponId: id, fixedSetId: row.representativeFixedSetId, cardinality: row.targetEligibleMinCardinality, reservationDigest: row.reservationDigest })
  if (!rebuilt.valid) throw new Error(rebuilt.issues.join())
  return rebuilt.context
}
function l2ContextOf(schedule: Phase2C26B2C1Schedule, id = 'target.b2c2b2c.b', rank = 2) {
  const l2 = phase2c26b2c2b2cL2Context(defaultContextOf(schedule, id, rank))
  if (!l2.valid) throw new Error(l2.issues.join())
  return l2.context
}

// ---------------------------------------------------------------- the L2 context and task construction

describe('Phase 2-C2.6-B2-C2B2C L2 context and task construction', () => {
  it('registers 4 Targets x 32 P1 ranks = 128 tasks at the common L2 extent, with the B2-C2B2B capture and Stage 1 conditions unchanged', () => {
    expect([PHASE2C26B2C2B2C_TARGETS, PHASE2C26B2C2B2C_CONTEXT_BUDGET, PHASE2C26B2C2B2C_EXPECTED_TASKS]).toEqual([4, 32, 128])
    expect(PHASE2C26B2C2B2C_EXTENT).toEqual(L2)
    expect(PHASE2C26B2C2B2C_EXTENT).toBe(PHASE2C26B2C2B2A_EXTENT)
    expect(Object.isFrozen(PHASE2C26B2C2B2C_EXTENT)).toBe(true)
    expect(PHASE2C26B2C2B2A_REGISTERED_B2C2B1.rungs[2]).toEqual({ id: 'L2', name: 'larger', extent: L2 })
    // Everything but the population and the extent is B2-C2B2B's (and B2-C2B2A's).
    expect([PHASE2C26B2C2B2C_MAX_COST_COHORTS, PHASE2C26B2C2B2C_CANDIDATE_SAFETY_CAP]).toEqual([PHASE2C26B2C2B2B_MAX_COST_COHORTS, PHASE2C26B2C2B2B_CANDIDATE_SAFETY_CAP])
    expect([PHASE2C26B2C2B2C_MAX_COST_COHORTS, PHASE2C26B2C2B2C_CANDIDATE_SAFETY_CAP]).toEqual([4, 1024])
    expect(PHASE2C26B2C2B2C_CAPTURE_PREFIXES).toEqual({ C8: 8, C32: 32 })
    expect(PHASE2C26B2C2B2C_STAGE1).toEqual(PHASE2C26B2C2B2B_STAGE1)
    expect(PHASE2C26B2C2B2C_STAGE1).toEqual(PHASE2C26B2C2B2A_STAGE1)
    expect(PHASE2C26B2C2B2C_STAGE1).toEqual({ executionClass: 'stage1', childHeapMb: 8192, concurrency: 1, budgetMs: 600_000, retry: 'none', fallback: 'none' })
    expect(PHASE2C26B2C2B2C_REGISTERED_P1).toEqual({ id: 'P1', name: 'default_simple_first', keys: [['targetEligibleMinCardinality', 'asc'], ['exclusiveOwnedWeaponCount', 'asc'],
      ['blockedCountDefaultTotal', 'asc'], ['shareableHeldCountDefaultTotal', 'desc'], ['reservationDigest', 'asc']] })
    for (const item of ['l1_search', 'e1_l1_search', 'per_target_extent', 'e2_search', 'retry', 'timeout_fallback', 'b2c2b2b_timeout_retry', 'incompatible_context_optimization', 'k2_feature_grouping',
      'residual_unreached_support', 'production_rung_selector', 'global_assignment', 'full_planner_rerun', 'context_level_early_stop', 'target_level_early_stop', 'compatibility_based_context_skip',
      'b2c2b2a_result_regeneration', 'b2c2b2b_result_regeneration', 'runtime_optimization', 'ui_change']) {
      expect(PHASE2C26B2C2B2C_NOT_RUN).toContain(item)
    }
  })

  it('is B2-C2B2A\'s L2 context replacement unchanged, and refuses L1, the default and any Target-specific extent', () => {
    const { schedule } = world()
    const base = defaultContextOf(schedule)
    expect(base.extent).toEqual({ ...defaultPlannerAlternativeSearchExtent })
    const l2 = phase2c26b2c2b2cL2Context(base)
    expect(l2).toEqual(phase2c26b2c2b2aL2Context(base))
    expect(l2.valid).toBe(true)
    if (!l2.valid) return
    const { extent, searchInputDigest, defaultSearchInputDigest, ...rest } = l2.context
    const { extent: baseExtent, searchInputDigest: baseDigest, ...baseRest } = base
    expect(rest).toEqual(baseRest)
    expect(extent).toEqual(L2)
    expect(baseExtent).toEqual({ ...defaultPlannerAlternativeSearchExtent })
    expect(defaultSearchInputDigest).toBe(baseDigest)
    expect(searchInputDigest).not.toBe(baseDigest)
    for (const other of [L1, { ...L2, maxSkillAdvance: 1083 }, { ...L2, maxNormalAdvance: 126 }, { ...defaultPlannerAlternativeSearchExtent }]) {
      expect(phase2c26b2c2b2cL2Context(base, { ...other }).valid).toBe(false)
    }
    expect(phase2c26b2c2b2cL2Context({ ...base, extent: { ...L2 } }).valid).toBe(false)
    expect(phase2c26b2c2b2cL2Context({ ...base, searchInputDigest: 'other' }).valid).toBe(false)
    expect(phase2c26b2c2b2cL2Context({ ...base, reservationDigest: 'other' }).valid).toBe(false)
  })

  it('takes every P1 rank 1..N of every Target from the schedule, each at the common L2 extent, exactly as B2-C2B2A builds them', () => {
    const { schedule } = world()
    const budget = Math.min(...IDS.map(id => schedule.contexts.filter(c => c.targetWeaponId === id).length))
    expect(budget).toBeGreaterThanOrEqual(2)
    const built = buildPhase2C26B2C2B2CTasks(schedule, IDS, budget)
    expect(built.issues).toEqual([])
    expect(built.tasks).toEqual(buildPhase2C26B2C2B2ATasks(schedule, IDS, budget).tasks)
    expect(built.tasks).toHaveLength(IDS.length * budget)
    for (const [targetIndex, id] of IDS.entries()) {
      const tasks = built.tasks.filter(t => t.targetWeaponId === id)
      expect(tasks.map(t => t.contextRank)).toEqual(Array.from({ length: budget }, (_, i) => i + 1))
      expect(tasks.map(t => t.taskId)).toEqual(tasks.map(t => `t0${targetIndex}-r${String(t.contextRank).padStart(2, '0')}`))
      for (const task of tasks) {
        const row = schedule.contexts.find(c => c.targetWeaponId === id && c.ranks.P1 === task.contextRank)!
        expect(task).toMatchObject({ groupIndex: row.groupIndex, reservationDigest: row.reservationDigest, policy: 'P1', maxCostCohorts: 4, candidateSafetyCap: 1024, extent: L2 })
        expect(task.defaultSearchInputDigest).toBe(defaultContextOf(schedule, id, task.contextRank).searchInputDigest)
        expect(task.searchInputDigest).toBe(l2ContextOf(schedule, id, task.contextRank).searchInputDigest)
      }
    }
    expect(new Set(built.tasks.map(t => JSON.stringify(t.extent))).size).toBe(1)
    expect(Object.keys(built.tasks[0]!).sort()).toEqual(['candidateSafetyCap', 'contextRank', 'defaultSearchInputDigest', 'executionClass', 'extent', 'groupIndex', 'maxCostCohorts', 'policy',
      'representativeFixedSetId', 'representativeFixedTargetWeaponIds', 'reservationDigest', 'searchInputDigest', 'targetEligibleMinCardinality', 'targetWeaponId', 'taskId'])
  })

  it('fails closed on too few contexts, an unknown or repeated Target, a rank gap, a P1 drift and a non-default schedule extent', () => {
    const { schedule } = world()
    const fewest = Math.min(...IDS.map(id => schedule.contexts.filter(c => c.targetWeaponId === id).length))
    const issues = (s: Phase2C26B2C1Schedule, ids = IDS, budget = fewest) => buildPhase2C26B2C2B2CTasks(s, ids, budget).issues.join('\n')
    expect(issues(schedule, IDS, fewest + 1)).toMatch(/fewer than the budget/)
    expect(issues(schedule, [...IDS, 'target.none'])).toMatch(/not a schedule Target/)
    expect(issues(schedule, [IDS[0]!, IDS[0]!])).toMatch(/repeats/)
    const gap = structuredClone(schedule); gap.contexts.find(c => c.targetWeaponId === IDS[0] && c.ranks.P1 === 2)!.ranks.P1 = 9
    expect(issues(gap)).toMatch(/missing or repeated/)
    const drift = structuredClone(schedule); (drift as { policies: unknown }).policies = drift.policies.map(p => p.id === 'P1' ? { ...p, keys: [...p.keys].reverse() } : p)
    expect(phase2c26b2c2b2cPolicyDrift(drift)).toEqual(['the schedule P1 is not the registered P1 definition'])
    expect(issues(drift)).toMatch(/registered P1/)
    const extent = structuredClone(schedule); extent.extent = { ...L2 }
    expect(issues(extent)).toMatch(/Production default extent/)
    expect(buildPhase2C26B2C2B2CTasks(extent, IDS, fewest).tasks).toEqual([])
  })
})

// ---------------------------------------------------------------- the Search child

const CAPTURE = { maxCostCohorts: PHASE2C26B2C2B2C_MAX_COST_COHORTS, candidateSafetyCap: PHASE2C26B2C2B2C_CANDIDATE_SAFETY_CAP }
const PROVENANCE = { contextRank: 2, targetEligibleMinCardinality: 1, representativeFixedSetId: 'K1:x', representativeFixedTargetWeaponIds: ['t'] }

describe('Phase 2-C2.6-B2-C2B2C Search child', () => {
  it('is B2-C2B2A\'s L2 Search and child calculation unchanged (the same functions, not a copy)', () => {
    expect(runPhase2C26B2C2B2CSearch).toBe(runPhase2C26B2C2B2ASearch)
    expect(runPhase2C26B2C2B2CTask).toBe(runPhase2C26B2C2B2ATask)
    expect(phase2c26b2c2b2cTaskOutcome).toBe(phase2c26b2c2b2aTaskOutcome)
  })

  it('gives visitPlannerAlternativeCandidates() exactly the rebuilt origin, reservation, exclusion and the common L2 extent', async () => {
    const { built, schedule } = world()
    const context = l2ContextOf(schedule)
    searchCalls.script = [1, 2, 3, 4, 5]
    const record = await runPhase2C26B2C2B2CSearch(built.input, context, built.engine, CAPTURE, PROVENANCE, { now: () => 0 })
    expect(searchCalls.inputs).toEqual([{ origin: createPlannerStartSearchOrigin(built.input), targetWeaponId: 'target.b2c2b2c.b', extent: L2,
      reservation: context.reservation, excludedRouteKeys: context.excludedRouteKeys }])
    expect(record).toMatchObject({ extent: L2, searchInputDigest: context.searchInputDigest, defaultSearchInputDigest: context.defaultSearchInputDigest, termination: 'four_cost_cohorts_drained' })
    expect(searchCalls.decisions).toEqual([...Array(4).fill('continue'), 'stop'])
  })

  it('stops at the first Candidate of a fifth cost and at the safety cap and at nothing else, and refuses a non-L2 extent', async () => {
    const { built, schedule } = world()
    const context = l2ContextOf(schedule)
    searchCalls.script = [1, 1, 2, 3, 3, 4, 4, 5, 5]
    expect(await runPhase2C26B2C2B2CSearch(built.input, context, built.engine, CAPTURE, PROVENANCE)).toMatchObject({ termination: 'four_cost_cohorts_drained', capturedCosts: [1, 2, 3, 4] })
    expect(searchCalls.decisions).toEqual([...Array(7).fill('continue'), 'stop'])
    searchCalls.script = Array(PHASE2C26B2C2B2C_CANDIDATE_SAFETY_CAP + 3).fill(2)
    expect(await runPhase2C26B2C2B2CSearch(built.input, context, built.engine, CAPTURE, PROVENANCE)).toMatchObject({ termination: 'candidate_safety_cap', captureComplete: false, safetyCapHit: true })
    await expect(runPhase2C26B2C2B2CSearch(built.input, { ...context, extent: { ...L1 } }, built.engine, CAPTURE, PROVENANCE)).rejects.toThrow(/common L2 extent/)
    await expect(runPhase2C26B2C2B2CSearch(built.input, { ...context, extent: { ...L2, maxSkillAdvance: 1083 } }, built.engine, CAPTURE, PROVENANCE)).rejects.toThrow(/common L2 extent/)
  }, 120_000)

  it('selects its context by Target and P1 rank from its own schedule and reports any drift as a context mismatch without searching', async () => {
    const { built, schedule } = world()
    const task = buildPhase2C26B2C2B2CTasks(schedule, IDS, 2).tasks.find(t => t.targetWeaponId === 'target.b2c2b2c.b' && t.contextRank === 2)!
    searchCalls.script = [1, 2, 3, 4, 5]
    expect(await runPhase2C26B2C2B2CTask(built.input, schedule, task, built.engine)).toMatchObject({ status: 'searched', search: { contextRank: 2, extent: L2, termination: 'four_cost_cohorts_drained' } })
    searchCalls.inputs = []
    const mismatch = async (patch: Partial<Phase2C26B2C2B2CTaskInput>) => runPhase2C26B2C2B2CTask(built.input, schedule, { ...task, ...patch }, built.engine)
    expect(await mismatch({ searchInputDigest: 'other' })).toMatchObject({ status: 'context_mismatch', issues: ['searchInputDigest'] })
    expect(await mismatch({ defaultSearchInputDigest: 'other' })).toMatchObject({ status: 'context_mismatch', issues: ['defaultSearchInputDigest'] })
    expect(await mismatch({ extent: { ...L1 } })).toMatchObject({ status: 'context_mismatch', issues: ['extent'] })
    expect(await mismatch({ extent: { ...L2, maxSkillAdvance: 1083 } })).toMatchObject({ status: 'context_mismatch', issues: ['extent'] })
    expect(await mismatch({ reservationDigest: 'other' })).toMatchObject({ status: 'context_mismatch', issues: ['reservationDigest'] })
    expect(await mismatch({ contextRank: 99 })).toMatchObject({ status: 'context_mismatch', issues: ['P1 rank 99 holds 0 contexts'] })
    expect(searchCalls.inputs).toEqual([])
  })

  it('records a timeout / out of memory / failure as that failure, never as no Candidate', () => {
    expect(phase2c26b2c2b2cTaskOutcome('t', 'timeout', null)).toEqual({ taskId: 't', process: 'timeout', record: null, searchStatus: null, termination: null, candidateCount: null })
    expect(phase2c26b2c2b2cTaskOutcome('t', 'out_of_memory', null)).toMatchObject({ process: 'out_of_memory', candidateCount: null })
    expect(phase2c26b2c2b2cTaskOutcome('t', 'completed', null).process).toBe('process_failure')
  })
})

// ---------------------------------------------------------------- the runner start attestation

const HEAD = 'a'.repeat(40)
const observation = { createdAt: '2026-10-04T01:00:00.000Z', runnerScript: 'scripts/run-planner-global-phase2c26b2c2b2c.mjs', node: 'v24.19.0', repositoryHead: HEAD, uncommittedBenchmarkCode: false,
  benchmarkCodeSha256: 'b'.repeat(64), exportFileName: 'export.json', exportSha256: 'c'.repeat(64), exportBytes: 10, targetManifestFileName: 'targets.json.local', targetManifestSha256: 'd'.repeat(64),
  targetManifestSourceResultSha256: PHASE2C26B2C2B2C_TARGET_SOURCE.resultSha256, targetWeaponIds: ['t1', 't2'], stage1: { ...PHASE2C26B2C2B2C_STAGE1 }, smoke: null }
const expectation: Phase2C26B2C2B2CAttestationExpectation = { repositoryHead: HEAD, benchmarkCodeSha256: 'b'.repeat(64), exportSha256: 'c'.repeat(64), targetManifestSha256: 'd'.repeat(64),
  targetWeaponIds: ['t1', 't2'], firstChildStartedAt: '2026-10-04T01:00:00.500Z' }
const environmentOf = (a: { [K in 'repositoryHead' | 'uncommittedBenchmarkCode' | 'benchmarkCodeSha256' | 'exportSha256' | 'targetManifestSha256' | 'stage1']: unknown }) => ({ repositoryHead: a.repositoryHead, uncommittedBenchmarkCode: a.uncommittedBenchmarkCode, benchmarkCodeSha256: a.benchmarkCodeSha256,
  exportSha256: a.exportSha256, targetManifestSha256: a.targetManifestSha256, stage1: a.stage1 })

describe('Phase 2-C2.6-B2-C2B2C runner start attestation', () => {
  it('carries the launch observation and every registered condition (L2, 4 Targets, 128 tasks), and verifies only against the independently obtained values', () => {
    const attestation = phase2c26b2c2b2cStartAttestationBody(observation)
    expect(attestation).toMatchObject({ attestedBy: 'runner', phase: PHASE2C26B2C2B2C_START_ATTESTATION_PHASE, repositoryHead: HEAD, uncommittedBenchmarkCode: false, stage1: PHASE2C26B2C2B2C_STAGE1,
      extent: L2, extentLabel: 'L2', contextBudget: 32, targets: 4, expectedTasks: 128, candidateSafetyCap: 1024, captureRule: { policy: 'C4C', maxCostCohorts: 4 },
      registeredP1: PHASE2C26B2C2B2C_REGISTERED_P1, smoke: null })
    for (const field of ['attestedBy', 'createdAt', 'repositoryHead', 'uncommittedBenchmarkCode', 'benchmarkCodeSha256', 'exportSha256', 'targetManifestSha256', 'targetWeaponIds', 'stage1', 'contextBudget',
      'expectedTasks', 'extent', 'captureRule', 'candidateSafetyCap', 'registeredP1', 'smoke']) expect(attestation).toHaveProperty(field)
    expect(verifyPhase2C26B2C2B2CStartAttestation(attestation, expectation)).toEqual({ verified: true, issues: [], integrityIssues: [] })
    const issue = (patch: Record<string, unknown>, expected: Partial<Phase2C26B2C2B2CAttestationExpectation> = {}) =>
      verifyPhase2C26B2C2B2CStartAttestation({ ...attestation, ...patch }, { ...expectation, ...expected }).issues.join('\n')
    const integrity = (patch: Record<string, unknown>) => verifyPhase2C26B2C2B2CStartAttestation({ ...attestation, ...patch }, expectation).integrityIssues.length > 0
    for (const patch of [{ repositoryHead: 'f'.repeat(40) }, { benchmarkCodeSha256: '0'.repeat(64) }, { exportSha256: '0'.repeat(64) }, { targetManifestSha256: '0'.repeat(64) },
      { targetWeaponIds: ['t1'] }, { attestedBy: 'reconstruction' }, { createdAt: '2026-10-04T01:00:01.000Z' }, { extra: 1 },
      // A B2-C2B2B attestation is a foreign attestation here.
      { phase: PHASE2C26B2C2B2B_START_ATTESTATION_PHASE }]) expect(integrity(patch)).toBe(true)
    for (const patch of [{ uncommittedBenchmarkCode: true }, { smoke: { tasks: 4, taskIds: null, budgetMs: null } }, { stage1: { ...PHASE2C26B2C2B2C_STAGE1, budgetMs: 60_000 } },
      { extent: L1 }, { expectedTasks: 224 }, { targets: 7 }]) {
      expect(integrity(patch)).toBe(false)
      expect(issue(patch)).not.toBe('')
    }
    expect(issue({}, { repositoryHead: 'f'.repeat(40) })).toMatch(/repositoryHead differs/)
    expect(issue({ stage1: { ...PHASE2C26B2C2B2C_STAGE1, concurrency: 3 } })).toMatch(/stage1 differs/)
    expect(issue({ extent: L1 })).toMatch(/extent differs/)
    expect(issue({ candidateSafetyCap: 32 })).toMatch(/candidateSafetyCap differs/)
    expect(issue({ uncommittedBenchmarkCode: null })).toMatch(/uncommitted/)
    expect(issue({ createdAt: '2026-10-04 01:00' })).toMatch(/canonical UTC/)
    expect(issue({ firstCompatibleRanks: {} })).toMatch(/keys/)
    expect(verifyPhase2C26B2C2B2CStartAttestation(null, expectation).verified).toBe(false)
    expect(Object.keys(phase2c26b2c2b2cRegisteredConditions()).sort()).toEqual(['candidateSafetyCap', 'captureRule', 'contextBudget', 'expectedTasks', 'extent', 'extentLabel', 'memorySampleIntervalMs',
      'nodeYield', 'registeredP1', 'stage1', 'targets', 'tasksBudgetMs'])
  })

  it('grades launch provenance by the attestation file alone: absent never formal; present and correct verifies an interrupted reconstruction too; any mismatch fails closed', () => {
    const attestation = phase2c26b2c2b2cStartAttestationBody(observation)
    const file = { sha256: 'e'.repeat(64), body: attestation }
    const environment = environmentOf(attestation)
    expect(phase2c26b2c2b2cLaunchProvenance({ attestationFile: file, recordedAttestationSha256: file.sha256, environment, expected: expectation }))
      .toMatchObject({ verified: true, source: 'runner_start_attestation', workingTreeCleanVerified: true, issues: [] })
    const none = phase2c26b2c2b2cLaunchProvenance({ attestationFile: null, recordedAttestationSha256: null, environment, expected: expectation })
    expect(none).toMatchObject({ verified: false, source: 'none', workingTreeCleanVerified: false })
    expect(phase2c26b2c2b2cLaunchProvenance({ attestationFile: file, recordedAttestationSha256: '0'.repeat(64), environment, expected: expectation }).integrityIssues.join()).toMatch(/not the one the raw recorded/)
    expect(phase2c26b2c2b2cLaunchProvenance({ attestationFile: file, recordedAttestationSha256: file.sha256, environment: { ...environment, repositoryHead: 'f'.repeat(40) }, expected: expectation }).verified).toBe(false)
    for (const expected of [{ repositoryHead: 'f'.repeat(40) }, { benchmarkCodeSha256: '0'.repeat(64) }, { exportSha256: '0'.repeat(64) }, { targetManifestSha256: '0'.repeat(64) }]) {
      expect(phase2c26b2c2b2cLaunchProvenance({ attestationFile: file, recordedAttestationSha256: file.sha256, environment, expected: { ...expectation, ...expected } }).verified).toBe(false)
    }
    const smoke = phase2c26b2c2b2cStartAttestationBody({ ...observation, uncommittedBenchmarkCode: true, stage1: { ...PHASE2C26B2C2B2C_STAGE1, budgetMs: 60_000 }, smoke: { tasks: 2, taskIds: null, budgetMs: 60_000 } })
    expect(phase2c26b2c2b2cLaunchProvenance({ attestationFile: { sha256: file.sha256, body: smoke }, recordedAttestationSha256: file.sha256, environment: environmentOf(smoke), expected: expectation }))
      .toMatchObject({ verified: false, integrityIssues: [] })
    expect(phase2c26b2c2b2cEvidenceGrade({ formalConditions: true, launchProvenanceVerified: true, partialRun: true })).toBe('formal')
    expect(phase2c26b2c2b2cEvidenceGrade({ formalConditions: true, launchProvenanceVerified: false, partialRun: true })).toBe('diagnostic_partial')
    expect(phase2c26b2c2b2cEvidenceGrade({ formalConditions: true, launchProvenanceVerified: false, partialRun: false })).toBe('non_formal')
    expect(phase2c26b2c2b2cEvidenceGrade({ formalConditions: false, launchProvenanceVerified: true, partialRun: false })).toBe('non_formal')
  })

  it('is written by the runner into the run dir, once and read-only, before the tasks child and before any Search child', () => {
    expect(PHASE2C26B2C2B2C_START_ATTESTATION_FILE).toBe('start-attestation.json')
    const write = runnerSource.indexOf('await write(attestationPath, attestation)')
    const chmod = runnerSource.indexOf('await chmod(attestationPath, 0o444)')
    const tasksChild = runnerSource.indexOf("await runChild('tasks', 'tasks'")
    const stage1 = runnerSource.indexOf('const stage1 = await pool(stage1Tasks,')
    const mkdirAt = runnerSource.indexOf('await mkdir(runDir, { recursive: true })')
    expect([mkdirAt, write, chmod, tasksChild, stage1].every(i => i > 0)).toBe(true)
    expect(mkdirAt < write && write < chmod && chmod < tasksChild && tasksChild < stage1).toBe(true)
    expect(runnerSource).toMatch(/const write = \(path, value, pretty = true\) => writeFile\(path, [^\n]*\{ flag: 'wx' \}\)/)
    expect(runnerSource).toMatch(/if \(existsSync\(runDir\)\) throw new Error/)
    expect(runnerSource).toMatch(/const repositoryHead = git\('rev-parse', 'HEAD'\)/)
    expect(runnerSource).toMatch(/phase2c26b2c2b2cStartAttestationBody\(\{ createdAt: new Date\(\)\.toISOString\(\)/)
    expect(runnerSource).toMatch(/The start attestation read back is not the one written/)
    expect(runnerSource).toMatch(/verifyPhase2C26B2C2B2CStartAttestation\(/)
    expect(runnerSource).toMatch(/Commit ALL benchmark code before a formal measurement/)
    expect(runnerSource).toMatch(/appendFileSync\(processesPath, JSON\.stringify\(\{ \.\.\.entry, recordFile \}\) \+ '\\n'\)/)
    expect(runnerSource).toMatch(/START \$\{id\} pid=/)
    expect(runnerSource).toMatch(/const SCRIPT_PATH = 'scripts\/run-planner-global-phase2c26b2c2b2c\.mjs'/)
    expect(runnerSource).toMatch(/smoke options and need --allow-uncommitted/)
  })

  it('reconstructs an interrupted run only with a verifying attestation (fail closed otherwise) and never invents one', () => {
    expect(reconstructSource).not.toMatch(/visitPlannerAlternativeCandidates|runPhase2C26B2C2B2CTask\(|runPhase2C26B2C2B2CSearch|spawn\(|derivePhase2C26B2C1Schedule|--oracle|--manifest|_RESULT/)
    expect(reconstructSource).not.toMatch(/writeFile\([^)]*runDir|\brm\(|\bunlink\(|\brename\(|\bcopyFile\(|chmod\(/)
    expect(reconstructSource).toMatch(/writeFile\(paths\.output, text, \{ flag: 'wx' \}\)/)
    expect(reconstructSource).toMatch(/verifyPhase2C26B2C2B2CStartAttestation\(attestation, \{ repositoryHead: measuredHead, benchmarkCodeSha256: recomputedBenchmarkCodeSha256,/)
    expect(reconstructSource).toMatch(/if \(check\.integrityIssues\.length > 0\) throw new Error\(`The runner start attestation does not verify/)
    expect(reconstructSource).toMatch(/if \(!check\.verified && !allowNonformal\) throw/)
    expect(reconstructSource).toMatch(/firstChildStartedAt: tasksEnded\.startedAt/)
    expect(reconstructSource).toMatch(/uncommittedBenchmarkCode: attested \? attestation\.uncommittedBenchmarkCode : null/)
    expect(reconstructSource).not.toMatch(/attestedBy|phase2c26b2c2b2cStartAttestationBody/)
    expect(reconstructSource).toMatch(/status: 'interrupted'/)
    expect(reconstructSource).toMatch(/childRecordsModified: false, searchRun: false/)
    expect(reconstructSource).toMatch(/The ran tasks are not a prefix of the task order/)
    expect(reconstructSource).toMatch(/a valid 128-task construction/)
    expect(reconstructSource).toMatch(/ladderRungsSearched: \['L2'\]/)
  })

  it('makes a RESULT formal only with verified launch provenance; --allow-nonformal never promotes it', () => {
    expect(analyzerSource).toMatch(/const formalConditions = formalRunConditions && calculationCodeChangedSinceMeasuredHead\.length === 0 && !analysisUncommitted\s+const formal = formalConditions && launchProvenance\.verified\n/)
    expect(analyzerSource.match(/const formal = [^\n]*/)![0]).not.toMatch(/allowNonformal|interrupted|reconstruction/)
    expect(analyzerSource.match(/const formalRunConditions = [^\n]*/)![0]).not.toMatch(/allowNonformal|uncommittedBenchmarkCode/)
    expect(analyzerSource).toMatch(/if \(!launchProvenance\.verified && !allowNonformal\) throw/)
    expect(analyzerSource).toMatch(/expected: \{ repositoryHead: measuredHead, benchmarkCodeSha256: recomputedBenchmarkCodeSha256, exportSha256: exportFile\.source\.sha256, targetManifestSha256: targetsFile\.source\.sha256,/)
    expect(analyzerSource).toMatch(/if \(attestationFile !== null\) invalidReasons\.push\(\.\.\.launchProvenance\.integrityIssues/)
    expect(analyzerSource).toMatch(/plannerGlobalPhase2C26B2C2B2CAnalysis\.ts', 'scripts\/analyze-planner-global-phase2c26b2c2b2c\.mjs', 'scripts\/reconstruct-planner-global-phase2c26b2c2b2c-partial-raw\.mjs'/)
    // The route recovery summary and the E1 ladder are written beside the decision, never into it.
    expect(analyzerSource).toMatch(/routeRecoverySummary: audit\.routeRecoverySummary,\s*e1Ladder,/)
    expect(analyzerSource.match(/const decision = [^\n]*/)![0]).not.toMatch(/routeRecovery|e1Ladder/)
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

function taskOf(rank: number, patch: Partial<Phase2C26B2C2B2CTaskInput> = {}): Phase2C26B2C2B2CTaskInput {
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

function capture(task: Phase2C26B2C2B2CTaskInput, summaries: Phase2C2CandidateSummary[], termination: Phase2C26B2C2B2CSearchRecord['termination'], sentinel: Phase2C2CandidateSummary | null = null): Phase2C26B2C2B2CSearchRecord {
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
function runOf(task: Phase2C26B2C2B2CTaskInput, record: Phase2C26B2C2B2CSearchRecord | null, process: 'completed' | 'timeout' | 'out_of_memory' | 'process_failure' = 'completed'): Phase2C26B2C2B2CRun {
  const child = record === null ? null : { status: 'searched' as const, taskId: task.taskId, search: record }
  return { taskId: task.taskId, task, outcome: phase2c26b2c2b2cTaskOutcome(task.taskId, process, process === 'completed' ? child : null),
    process: { outcome: process, wallMs: 10, timedOut: process === 'timeout', budgetMs: 1 }, childWallMs: 9, scheduleMs: 1, yields: 3,
    memory: process === 'completed' ? { sampledMaxHeapUsedBytes: 100, sampledMaxRssBytes: 200, maxRssKiB: 1 } : null, lastIpcMemory: { maxHeapUsedBytes: 50, maxRssBytes: 300 },
    record: process === 'completed' ? child : null }
}
function withMatchAt(task: Phase2C26B2C2B2CTaskInput, at: number) {
  return capture(task, [summary({ estimatedOperationCount: 1, sourceOwnedWeaponId: 'cheap' }), ...filler(Math.max(at - 1, 0), 2), { ...MATCH }, ...filler(3, 3, 100), ...filler(2, 4, 200)],
    'four_cost_cohorts_drained', summary({ estimatedOperationCount: 5, sourceOwnedWeaponId: 'dear' }))
}
const miss = (task: Phase2C26B2C2B2CTaskInput) => capture(task, [summary({ estimatedOperationCount: 1, sourceOwnedWeaponId: 'cheap' }), ...filler(5, 2)], 'exhausted')
const reachOf = (groups: number[], first: number | null = 2) => [{ targetWeaponId: TARGET, compatibleGroupIndexes: groups, p1FirstCompatibleRank: first, inconsistencies: [] }]

describe('Phase 2-C2.6-B2-C2B2C analysis', () => {
  it('validates the raw capture at L2: an L1 or Target-specific extent, a digest drift, a capture drift and nonmonotonic costs fail closed', () => {
    const task = taskOf(2)
    const check = (record: Phase2C26B2C2B2CSearchRecord, t = task) => validatePhase2C26B2C2B2CRaw({ tasks: [t], runs: [runOf(t, record)], smoke: false })
    expect(check(withMatchAt(task, 5))).toEqual([])
    const mutate = (patch: (r: Phase2C26B2C2B2CSearchRecord) => void) => { const r = withMatchAt(task, 5); patch(r); return check(r).join('\n') }
    expect(mutate(r => { r.candidates[4]!.orderingKeys.estimatedOperationCount = 1; r.candidates[4]!.summary = { ...r.candidates[4]!.summary, estimatedOperationCount: 1 } })).toMatch(/semantic_failure: .*nonmonotonic/)
    expect(mutate(r => { r.extent = { ...L1 } })).toMatch(/not the common L2 extent/)
    expect(mutate(r => { r.extent = { ...L2, maxSkillAdvance: 1083 } })).toMatch(/not the common L2 extent/)
    expect(mutate(r => { r.searchInputDigest = 'x' })).toMatch(/not the task's context/)
    expect(mutate(r => { r.candidateSafetyCap = 32 })).toMatch(/capture rule drift/)
    expect(mutate(r => { r.capturedCosts = [1, 2, 3] })).toMatch(/cohorts drift/)
    expect(validatePhase2C26B2C2B2CRaw({ tasks: [taskOf(2, { extent: { ...L1 } })], runs: [], smoke: true }).join()).toMatch(/task extent is not the common L2 extent/)
    expect(validatePhase2C26B2C2B2CRaw({ tasks: [task, taskOf(3)], runs: [runOf(task, withMatchAt(task, 5))], smoke: false }).join()).toMatch(/ran 1 of 2/)
  })

  it('searches every rank regardless of an earlier exact match, and fails closed on an exact from an incompatible context', () => {
    const tasks = Array.from({ length: 32 }, (_, i) => taskOf(i + 1))
    const runs = tasks.map(task => runOf(task, task.contextRank === 2 ? withMatchAt(task, 3) : task.contextRank === 30 ? withMatchAt(task, 1) : miss(task)))
    const result = runPhase2C26B2C2B2CAnalysis({ targetWeaponIds: [TARGET], tasks, runs, reach: reachOf([102, 130]), b2c1FirstCompatible: new Map([[TARGET, 2]]), oracle: ORACLE, smoke: false })
    expect(result.invalidReasons).toEqual([])
    expect(result.rows[0]).toMatchObject({ recovery: 'C8', fullyMeasured: true, policies: { C8: { firstExactContextRank: 2, firstExactCandidateIndex: 3, deltaFromFirstCompatible: 0 } } })
    expect(result.aggregates.firstExactEqualsFirstCompatible).toEqual({ recoveredC4C: 1, equal: 1, later: 0 })
    expect(result.routeRecoverySummary).toMatchObject({ measurementCompleteness: { status: 'complete', tasks: 32, measured: 32, unmeasured: 0 }, recoveryIsLowerBound: false,
      routeRecovery: { C8: { recovered: 1, of: 1, all: true }, C4C: { recovered: 1, of: 1, all: true } } })
    expect(runPhase2C26B2C2B2CAnalysis({ targetWeaponIds: [TARGET], tasks, runs, reach: reachOf([102]), b2c1FirstCompatible: new Map([[TARGET, 2]]), oracle: ORACLE, smoke: false })
      .invalidReasons.join()).toMatch(/semantic_failure: t00-r30: an exact Candidate from a reservation-incompatible context/)
  })

  it('never reads a timeout / OOM / notRun as Candidate 0, and keeps route recovery apart from the INCOMPLETE decision', () => {
    const tasks = Array.from({ length: 32 }, (_, i) => taskOf(i + 1))
    const ran = tasks.slice(0, 12).map(task => runOf(task, task.contextRank === 2 ? withMatchAt(task, 3) : [10, 11].includes(task.contextRank) ? null : miss(task),
      task.contextRank === 10 ? 'timeout' : task.contextRank === 11 ? 'out_of_memory' : 'completed'))
    const interruption = { stoppedAt: '2026-10-04T05:00:00.000Z', reason: 'host resource safety', notRunTaskIds: tasks.slice(12).map(t => t.taskId) }
    const result = runPhase2C26B2C2B2CAnalysis({ targetWeaponIds: [TARGET], tasks, runs: ran, reach: reachOf([102]), b2c1FirstCompatible: new Map([[TARGET, 2]]), oracle: ORACLE, smoke: false, interruption })
    expect(result.invalidReasons).toEqual([])
    expect(result.aggregates.execution).toMatchObject({ tasks: 32, started: 12, completed: 10, timeout: 1, outOfMemory: 1, notRun: 20 })
    expect(result.contexts.filter(c => !c.measured).map(c => c.candidateCount)).toEqual(Array(22).fill(null))
    expect(result.contexts.filter(c => !c.measured).every(c => c.coverage === null && !c.hit.C4C)).toBe(true)
    expect(result.decisionInput).toMatchObject({ unmeasuredTasks: 22, exactTargets: { C8: 1, C32: 1, C4C: 1 } })
    // The decision is INCOMPLETE, yet the route recovery summary still reports the recovered Route.
    expect(phase2c26b2c2b2cDecision({ invalidReasons: [], ...result.decisionInput, tasks: 128, targets: 4, exactTargets: { C8: 4, C32: 4, C4C: 4 } }).case).toBe('B2C2B2C_INCOMPLETE')
    expect(result.routeRecoverySummary).toMatchObject({ measurementCompleteness: { status: 'incomplete', tasks: 32, measured: 10, unmeasured: 22,
      breakdown: { contextMismatch: 0, timeout: 1, outOfMemory: 1, processFailure: 0, notRun: 20 } }, recoveryIsLowerBound: true,
      routeRecovery: { C8: { recovered: 1, of: 1, all: true }, C32: { recovered: 1, of: 1, all: true }, C4C: { recovered: 1, of: 1, all: true } } })
    expect(validatePhase2C26B2C2B2CRaw({ tasks, runs: [ran[0]!, ran[2]!], smoke: false, interruption: { ...interruption, notRunTaskIds: tasks.slice(2).map(t => t.taskId) } }).join()).toMatch(/not a prefix/)
  })

  it('reports measurement completeness and C8 / C32 / C4C recovery as separate axes, refusing an inconsistent count', () => {
    const s = (patch: Partial<Parameters<typeof phase2c26b2c2b2cRouteRecoverySummary>[0]> = {}) => phase2c26b2c2b2cRouteRecoverySummary({ tasks: 128, targets: 4, completed: 128, contextMismatch: 0,
      timeout: 0, outOfMemory: 0, processFailure: 0, notRun: 0, exactTargets: { C8: 3, C32: 3, C4C: 4 }, ...patch })
    expect(s()).toMatchObject({ measurementCompleteness: { status: 'complete', unmeasured: 0 }, recoveryIsLowerBound: false,
      routeRecovery: { C8: { recovered: 3, of: 4, all: false }, C32: { recovered: 3, of: 4, all: false }, C4C: { recovered: 4, of: 4, all: true } } })
    expect(s({ completed: 120, timeout: 6, outOfMemory: 2 })).toMatchObject({ measurementCompleteness: { status: 'incomplete', measured: 120, unmeasured: 8, breakdown: { timeout: 6, outOfMemory: 2 } },
      recoveryIsLowerBound: true, routeRecovery: { C4C: { recovered: 4, of: 4, all: true } } })
    expect(s({ completed: 127, contextMismatch: 1 }).measurementCompleteness).toMatchObject({ status: 'incomplete', unmeasured: 1 })
    expect(() => s({ completed: 127 })).toThrow()
    expect(() => s({ exactTargets: { C8: 4, C32: 3, C4C: 4 } })).toThrow()
    expect(() => s({ exactTargets: { C8: 1, C32: 1, C4C: 5 } })).toThrow()
  })

  it('decides ALL_C8 / ALL_C32 / ALL_C4C / PARTIAL / INCOMPLETE / INVALID by the registered rule for 4 Targets x 128 tasks', () => {
    const d = (C8: number, C32: number, C4C: number, extra: Partial<Parameters<typeof phase2c26b2c2b2cDecision>[0]> = {}) =>
      phase2c26b2c2b2cDecision({ invalidReasons: [], tasks: 128, targets: 4, unmeasuredTasks: 0, exactTargets: { C8, C32, C4C }, unresolvedSafetyCapTargets: 0, ...extra }).case
    expect(d(4, 4, 4)).toBe('B2C2B2C_ALL_C8')
    expect(d(3, 4, 4)).toBe('B2C2B2C_ALL_C32')
    expect(d(2, 3, 4)).toBe('B2C2B2C_ALL_C4C')
    expect(d(1, 2, 3)).toBe('B2C2B2C_PARTIAL')
    expect(phase2c26b2c2b2cDecision({ invalidReasons: [], tasks: 128, targets: 4, unmeasuredTasks: 0, exactTargets: { C8: 0, C32: 0, C4C: 0 }, unresolvedSafetyCapTargets: 0 })).toMatchObject({ case: 'B2C2B2C_PARTIAL', noExactTarget: true })
    expect(d(1, 2, 3, { unresolvedSafetyCapTargets: 1 })).toBe('B2C2B2C_INCOMPLETE')
    // timeout / OOM / process failure / notRun never become ALL_*.
    expect(d(4, 4, 4, { unmeasuredTasks: 1 })).toBe('B2C2B2C_INCOMPLETE')
    expect(d(4, 4, 4, { invalidReasons: ['x'] })).toBe('B2C2B2C_INVALID')
    expect(d(4, 4, 4, { tasks: 224 })).toBe('B2C2B2C_INVALID')
    expect(d(4, 4, 4, { tasks: 352 })).toBe('B2C2B2C_INVALID')
    expect(d(3, 3, 3, { targets: 3 })).toBe('B2C2B2C_INVALID')
    expect(d(4, 4, 4, { targets: 7 })).toBe('B2C2B2C_INVALID')
    expect(() => d(4, 3, 4)).toThrow()
    expect(PHASE2C26B2C2B2C_DECISION_RULE.order.map(line => line.split(':')[0])).toEqual(['B2C2B2C_INVALID', 'B2C2B2C_INCOMPLETE', 'B2C2B2C_ALL_C8', 'B2C2B2C_ALL_C32', 'B2C2B2C_ALL_C4C', 'B2C2B2C_INCOMPLETE', 'B2C2B2C_PARTIAL'])
    expect(PHASE2C26B2C2B2C_DECISION_RULE.order[1]).toMatch(/never Candidate 0/)
    expect(PHASE2C26B2C2B2C_DECISION_RULE.order[6]).toMatch(/never read as "the Route does not exist"/)
    expect(PHASE2C26B2C2B2C_DECISION_RULE.routeRecovery).toMatch(/never a decision input/)
  })

  it('aggregates the E1 ladder (B2-C2B2B L1 7 + this phase L2 4) and states 11 / 11 only when both rungs recovered every Route, with the limitations', () => {
    const { b2c2b1, b2c1, b2c2b2b } = authorities()
    const split = phase2c26b2c2b2cPopulation(b2c2b1, b2c1, b2c2b1Json, b2c2b2b).split
    const tasks = split.l2.flatMap((id, t) => Array.from({ length: 2 }, (_, i) => taskOf(i + 1, { taskId: `t0${t}-r0${i + 1}`, targetWeaponId: id })))
    const rowsWith = (recovered: number) => runPhase2C26B2C2B2CAnalysis({ targetWeaponIds: split.l2, tasks, runs: tasks.map(task => runOf(task, miss(task))), reach: split.l2.map(id => ({ targetWeaponId: id,
      compatibleGroupIndexes: [], p1FirstCompatibleRank: null, inconsistencies: [] })), b2c1FirstCompatible: new Map(split.l2.map(id => [id, null])), oracle: { routes: [], gogmaUsage: [] }, smoke: true })
      .rows.map((row, i) => i < recovered ? { ...row, policies: { ...row.policies, C4C: { ...row.policies.C4C, firstExactContextRank: 17, deltaFromFirstCompatible: 0 } } } : row)
    const measurement = phase2c26b2c2b2cRouteRecoverySummary({ tasks: 128, targets: 4, completed: 120, contextMismatch: 0, timeout: 8, outOfMemory: 0, processFailure: 0, notRun: 0,
      exactTargets: { C8: 0, C32: 0, C4C: 4 } })
    const full = phase2c26b2c2b2cE1LadderAggregate({ e1: split.e1, l1: split.l1, l2: split.l2, b2c2b2b, l2Rows: rowsWith(4), l2Measurement: measurement, l2Decision: 'B2C2B2C_INCOMPLETE', l2EvidenceGrade: 'formal' })
    expect(full.issues).toEqual([])
    expect(full).toMatchObject({ e1Total: 11, allRecovered: true, statement: 'E1 11 / 11 routes rediscovered under the registered Research ladder', total: { C4C: { recovered: 11, of: 11 } } })
    expect(full.rungs.map(r => [r.rung, r.population, r.routeRecovery.C4C!.recovered, r.decision])).toEqual([['L1', 7, 7, 'B2C2B2B_INCOMPLETE'], ['L2', 4, 4, 'B2C2B2C_INCOMPLETE']])
    expect(full.rungs[0]!.measurementCompleteness).toMatchObject({ status: 'incomplete', tasks: 224, measured: 191, breakdown: { timeout: 33 } })
    expect(full.rungs[1]!.measurementCompleteness).toMatchObject({ status: 'incomplete', unmeasured: 8 })
    expect(full.limitations).toEqual([...PHASE2C26B2C2B2C_E1_LADDER_LIMITATIONS])
    expect(full.limitations.join(' ')).toMatch(/without the oracle/)
    expect(full.limitations.join(' ')).toMatch(/adopted in Production/)
    expect(full.statementScope).toMatch(/not a Production rung selector/)
    const partial = phase2c26b2c2b2cE1LadderAggregate({ e1: split.e1, l1: split.l1, l2: split.l2, b2c2b2b, l2Rows: rowsWith(3), l2Measurement: measurement, l2Decision: 'B2C2B2C_PARTIAL', l2EvidenceGrade: 'formal' })
    expect(partial).toMatchObject({ allRecovered: false, statement: null, total: { C4C: { recovered: 10, of: 11 } } })
    // A split that does not partition E1, or B2-C2B2B Targets other than E1 ∩ L1, is an issue and never a statement.
    expect(phase2c26b2c2b2cE1LadderAggregate({ e1: split.e1, l1: split.l1, l2: split.l2.slice(1), b2c2b2b, l2Rows: rowsWith(4), l2Measurement: measurement, l2Decision: null, l2EvidenceGrade: 'formal' }))
      .toMatchObject({ allRecovered: false, statement: null })
    expect(phase2c26b2c2b2cE1LadderAggregate({ e1: split.e1, l1: split.l1, l2: split.l2, b2c2b2b: { ...b2c2b2b, targetWeaponIds: split.l2 }, l2Rows: rowsWith(4), l2Measurement: measurement,
      l2Decision: null, l2EvidenceGrade: 'formal' }).issues.join()).toMatch(/B2-C2B2B Targets are not the L1 population/)
  })
})

// ---------------------------------------------------------------- isolation and provenance

describe('Phase 2-C2.6-B2-C2B2C isolation and provenance', () => {
  it('is never imported by Production and hard-codes no Target, Entry, OwnedWeapon or reservation', () => {
    const production = import.meta.glob(['../domain/**/*.ts', '../services/**/*.ts', '../workers/**/*.ts', '../pages/**/*.tsx', '../components/**/*.tsx', '../db/**/*.ts', '!../**/*.test.ts', '!../**/*.test.tsx'],
      { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    expect(Object.keys(production).length).toBeGreaterThan(50)
    expect(Object.entries(production).filter(([, source]) => /plannerGlobalPhase2C26B2C2B2C/.test(source)).map(([path]) => path)).toEqual([])
    for (const source of [searchSource, targetsSource, analysisSource, prepareSource, runnerSource, analyzerSource, reconstructSource]) {
      expect(source).not.toMatch(/\bc\d+-p\d+\b|fnv1a32[-:][0-9a-f]{8}|[0-9a-f]{8}-[0-9a-f]{4}-|build-list\.|070a1222|188571a7|a367c177|d453ca34|02876df4|05e6b206|a6c17e25|b27e57a7|b6780f04|e4147de7|e523209e/)
    }
    for (const source of [searchSource, targetsSource, analysisSource]) expect(source).not.toMatch(/node:fs|readFile|import\.meta\.glob/)
  })

  it('keeps the oracle, its manifest, every earlier RESULT, the ladder rung of a Target and every Target-specific extent out of the Search side', () => {
    for (const source of [searchSource, runnerSource]) {
      expect(source).not.toMatch(/ORACLE_[1]657|1657|--oracle|--manifest|--b2c2b1-result|--b2c1-result|--b2b1-result|--b2c2b2a-result|--b2c2b2b-result|gogmaUsage|plannerGlobal[O]racle|_RESULT|phase2c2OracleCoverage|Analysis'|Targets'|firstCompatible|firstLadderRung|requiredExtent|phase2c26b2aReachability|phase2c26b2aRouteExtent|materialization\.estimated/)
    }
    expect(searchSource).not.toMatch(/plannerGlobalPhase2C26B2C2B2CTargets|plannerGlobalPhase2C26B2C2B2BTargets|plannerGlobalPhase2C26B2C2B2ATargets|plannerGlobalPhase2C26B2C2B1Analysis|plannerGlobalPhase2C26B2C1Analysis|Analysis'/)
    expect(runnerSource).toMatch(/--targets/)
    expect(runnerSource).toMatch(/oracleGuidedPolicySelection: true, oracleGuidedTargetPopulation: true, contextOrderingUsesOracle: false, oracleReadBySearchChild: false, oracleMatchUsedForEarlyStop: false/)
    expect(runnerSource).toMatch(/oracleInformedCommonExtent: true, commonExtentForEveryTask: true, perTargetExtent: false, targetIndividualOracleExtentAsSearchInput: false, ladderRungsSearched: \['L2'\]/)
    expect(runnerSource).toMatch(/a task extent is not the common L2 extent/)
    expect(runnerSource).toMatch(/c2b2c\.runPhase2C26B2C2B2CTask\(input, schedule, task, engine/)
    expect(runnerSource).toMatch(/c2b2c\.buildPhase2C26B2C2B2CTasks\(schedule, task\.targetWeaponIds\)/)
    expect(prepareSource).toMatch(/--b2c2b1-result/)
    expect(prepareSource).toMatch(/--b2c2b2b-result/)
    expect(prepareSource).not.toMatch(/--oracle|--manifest|visitPlannerAlternativeCandidates/)
    expect(analyzerSource).toMatch(/--oracle/)
    expect(analyzerSource).toMatch(/--b2c2b2b-result/)
    expect(analysisSource).toMatch(/phase2c26b2c2b2aCompareContext\(/)
  })

  it('captures through the unchanged Production Search and B2-C2A capture (via B2-C2B2A), with no early stop, retry or fallback', () => {
    expect(searchSource).toMatch(/runPhase2C26B2C2B2CSearch = runPhase2C26B2C2B2ASearch/)
    expect(searchSource).toMatch(/runPhase2C26B2C2B2CTask = runPhase2C26B2C2B2ATask/)
    expect(searchSource).toMatch(/buildPhase2C26B2C2B2ATasks\(schedule, targetWeaponIds, budget\)/)
    // The Search module calls no visitor of its own (the only visitor is B2-C2B2A's, which holds the two 'stop' rules).
    expect(searchSource).not.toMatch(/'stop'|visitPlannerAlternativeCandidates\(search|visitPlannerAlternativeCandidates,/)
    expect(runnerSource).toMatch(/const stage1 = await pool\(stage1Tasks,/)
    expect(runnerSource).not.toMatch(/timeout_fallback|fallbackTasks|FALLBACK|retryTasks/)
    for (const source of [searchSource, analysisSource, runnerSource, analyzerSource]) {
      expect(source).not.toMatch(/runPreparedPlannerAlternativeKernel|preparePlannerAlternativeKernel|createProductionPlan|runPhase2C2Kernel|runPhase2C2Baseline|runPlannerDeterministicSchedule|createPlannerAlternativeWhatIfComparison|searchCandidates\(/)
    }
    for (const source of [analysisSource, analyzerSource, targetsSource, prepareSource]) expect(source).not.toMatch(/visitPlannerAlternativeCandidates|runPhase2C26B2C2B2CSearch|runPhase2C26B2C2B2CTask\(/)
  })
})
