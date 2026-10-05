import { beforeEach, describe, expect, it, vi } from 'vitest'
import rawB2C2B1 from '../../docs/PLANNER_GLOBAL_PHASE2C26B2C2B1_RESULT.json?raw'
import rawB2C1 from '../../docs/PLANNER_GLOBAL_PHASE2C26B2C1_RESULT.json?raw'
import rawB2C2B2B from '../../docs/PLANNER_GLOBAL_PHASE2C26B2C2B2B_RESULT.json?raw'
import rawB2C2B2C from '../../docs/PLANNER_GLOBAL_PHASE2C26B2C2B2C_RESULT.json?raw'
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
import { phase2c26b2c2b1Covers } from './plannerGlobalPhase2C26B2C2B1Analysis'
import { parsePhase2C26B2C2AB2C1Authority, PHASE2C26B2C2A_REGISTERED_B2C1 } from './plannerGlobalPhase2C26B2C2ATargets'
import { phase2c26b2c2b2aL2Context, runPhase2C26B2C2B2ASearch } from './plannerGlobalPhase2C26B2C2B2A'
import b2c2b2aSearchSource from './plannerGlobalPhase2C26B2C2B2A.ts?raw'
import { parsePhase2C26B2C2B2AB2C2B1Authority, PHASE2C26B2C2B2A_REGISTERED_B2C2B1 } from './plannerGlobalPhase2C26B2C2B2ATargets'
import {
  PHASE2C26B2C2B2C_CANDIDATE_SAFETY_CAP,
  PHASE2C26B2C2B2C_EXTENT,
  PHASE2C26B2C2B2C_MAX_COST_COHORTS,
  PHASE2C26B2C2B2C_STAGE1,
  PHASE2C26B2C2B2C_START_ATTESTATION_PHASE,
} from './plannerGlobalPhase2C26B2C2B2C'
import { parsePhase2C26B2C2B2CB2C2B2BAuthority, phase2c26b2c2b2cPopulation, PHASE2C26B2C2B2C_REGISTERED_B2C2B2B } from './plannerGlobalPhase2C26B2C2B2CTargets'
import {
  buildPhase2C26B2C2B2DTasks,
  parsePhase2C26B2C2B2DProbeManifest,
  phase2c26b2c2b2dExtentBoundIssues,
  phase2c26b2c2b2dRegisteredConditions,
  phase2c26b2c2b2dStartAttestationBody,
  phase2c26b2c2b2dTaskOutcome,
  phase2c26b2c2b2dTightContext,
  runPhase2C26B2C2B2DSearch,
  runPhase2C26B2C2B2DTask,
  verifyPhase2C26B2C2B2DStartAttestation,
  PHASE2C26B2C2B2D_CANDIDATE_SAFETY_CAP,
  PHASE2C26B2C2B2D_CAPTURE_PREFIXES,
  PHASE2C26B2C2B2D_COMMON_L2_EXTENT,
  PHASE2C26B2C2B2D_CONTEXT_SELECTION,
  PHASE2C26B2C2B2D_CONTEXTS_PER_TARGET,
  PHASE2C26B2C2B2D_EXPECTED_TASKS,
  PHASE2C26B2C2B2D_EXTENT_RULE,
  PHASE2C26B2C2B2D_FLOOR_EXTENT,
  PHASE2C26B2C2B2D_MAX_COST_COHORTS,
  PHASE2C26B2C2B2D_NOT_RUN,
  PHASE2C26B2C2B2D_PROBE_SOURCE,
  PHASE2C26B2C2B2D_PROVENANCE_FLAGS,
  PHASE2C26B2C2B2D_REGISTERED_P1,
  PHASE2C26B2C2B2D_STAGE1,
  PHASE2C26B2C2B2D_START_ATTESTATION_FILE,
  PHASE2C26B2C2B2D_START_ATTESTATION_PHASE,
  PHASE2C26B2C2B2D_TARGETS,
  type Phase2C26B2C2B2DAttestationExpectation,
  type Phase2C26B2C2B2DProbe,
  type Phase2C26B2C2B2DSearchRecord,
  type Phase2C26B2C2B2DTaskInput,
} from './plannerGlobalPhase2C26B2C2B2D'
import searchSource from './plannerGlobalPhase2C26B2C2B2D.ts?raw'
import {
  parsePhase2C26B2C2B2DB2C2B2CAuthority,
  phase2c26b2c2b2dPopulation,
  phase2c26b2c2b2dProbeManifest,
  phase2c26b2c2b2dProbes,
  phase2c26b2c2b2dTightExtent,
  PHASE2C26B2C2B2D_REGISTERED_B2C2B2C,
  type Phase2C26B2C2B2DB2C2B2CTaskRow,
  type Phase2C26B2C2B2DProbeDerivation,
} from './plannerGlobalPhase2C26B2C2B2DTargets'
import targetsSource from './plannerGlobalPhase2C26B2C2B2DTargets.ts?raw'
import {
  phase2c26b2c2b2dDecision,
  phase2c26b2c2b2dE1Aggregate,
  phase2c26b2c2b2dEvidenceGrade,
  phase2c26b2c2b2dInterpretation,
  phase2c26b2c2b2dLaunchProvenance,
  phase2c26b2c2b2dPairedRow,
  runPhase2C26B2C2B2DAnalysis,
  validatePhase2C26B2C2B2DRaw,
  PHASE2C26B2C2B2D_DECISION_RULE,
  PHASE2C26B2C2B2D_E1_DIAGNOSTIC_LIMITATIONS,
  type Phase2C26B2C2B2DRun,
  type Phase2C26B2C2B2DTargetRow,
} from './plannerGlobalPhase2C26B2C2B2DAnalysis'
import analysisSource from './plannerGlobalPhase2C26B2C2B2DAnalysis.ts?raw'
import prepareSource from '../../scripts/prepare-planner-global-phase2c26b2c2b2d-probes.mjs?raw'
import runnerSource from '../../scripts/run-planner-global-phase2c26b2c2b2d.mjs?raw'
import analyzerSource from '../../scripts/analyze-planner-global-phase2c26b2c2b2d.mjs?raw'
import reconstructSource from '../../scripts/reconstruct-planner-global-phase2c26b2c2b2d-partial-raw.mjs?raw'

/*
 * Issue #154 Phase 2-C2.6-B2-C2B2D: the 4 E1 ∩ L2 Targets, each in its B2-C1 P1 first compatible context at a Target-relative
 * tight extent (an oracle-guided diagnostic). The synthetic worlds below are invented for the tests; the committed B2-C2B1 /
 * B2-C1 / B2-C2B2B / B2-C2B2C RESULTs are read only to check the authorities. The oracle modules are never imported here.
 */

/** Every Search input, in call order; `script` replays one real Candidate with the scripted operation costs (as in B2-C2B2C). */
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
const b2c2b2cJson = JSON.parse(rawB2C2B2C)
const b2c2b2cSha = PHASE2C26B2C2B2D_REGISTERED_B2C2B2C.resultSha256
const exportSha = b2c2b1Json.provenance.exportSha256 as string
const DEFAULT = { ...defaultPlannerAlternativeSearchExtent }
const L2 = { maxNormalAdvance: 128, maxGogmaAdvance: 235, maxSkillAdvance: 1500 }
const TIGHT = { maxNormalAdvance: 4, maxGogmaAdvance: 235, maxSkillAdvance: 446 }
const c2b2cExpected = { b2c2b1ResultSha256: b2c2b1Sha, b2c1ResultSha256: b2c1Sha, b2c2b2bResultSha256: b2c2b2bSha, exportSha256: exportSha }
const authorities = () => ({ b2c2b1: parsePhase2C26B2C2B2AB2C2B1Authority(b2c2b1Json, b2c2b1Sha).authority!, b2c1: parsePhase2C26B2C2AB2C1Authority(b2c1Json, b2c1Sha).authority!,
  b2c2b2b: parsePhase2C26B2C2B2CB2C2B2BAuthority(b2c2b2bJson, b2c2b2bSha, { b2c2b1ResultSha256: b2c2b1Sha, exportSha256: exportSha }).authority!,
  b2c2b2c: parsePhase2C26B2C2B2DB2C2B2CAuthority(b2c2b2cJson, b2c2b2cSha, c2b2cExpected).authority! })
type Required = { normal: number | null; gogma: number | null; skill: number | null }
const routesOf = (j: typeof b2c2b1Json) => j.routes as { targetWeaponId: string; cohort: string; firstLadderRung: string; p1FirstCompatibleRank: number; required: Required }[]

// ---------------------------------------------------------------- population, probes and the B2-C2B2C authority

describe('Phase 2-C2.6-B2-C2B2D population, probes and probe manifest', () => {
  it('derives the population mechanically: E1 11 = L1 7 + L2 4 (overlap 0, union 11), and E1 ∩ L2 is exactly the 4 Targets B2-C2B2C searched', () => {
    const { b2c2b1, b2c1, b2c2b2b, b2c2b2c } = authorities()
    const population = phase2c26b2c2b2dPopulation(b2c2b1, b2c1, b2c2b1Json, b2c2b2b, b2c2b2c)
    expect(population.issues).toEqual([])
    expect(population.targetWeaponIds).toHaveLength(PHASE2C26B2C2B2D_TARGETS)
    expect([population.split.e1.length, population.split.l1.length, population.split.l2.length, population.split.overlap, population.split.union]).toEqual([11, 7, 4, 0, 11])
    // The same set straight from the RESULT rows and B2-C2B2C's own population (no ID is written down anywhere).
    const fromRows = routesOf(b2c2b1Json).filter(r => r.cohort === 'E1' && r.firstLadderRung === 'L2').map(r => r.targetWeaponId).sort()
    expect(population.targetWeaponIds).toEqual(fromRows)
    expect(population.targetWeaponIds).toEqual(phase2c26b2c2b2cPopulation(b2c2b1, b2c1, b2c2b1Json, b2c2b2b).targetWeaponIds)
    expect(population.targetWeaponIds).toEqual(b2c2b2c.targetWeaponIds)
    expect(population.targetWeaponIds).toEqual((b2c2b2cJson.targets as { targetWeaponId: string }[]).map(t => t.targetWeaponId))
    expect(population.split.l1).toEqual(b2c2b2b.targetWeaponIds)
    // Fail closed when the B2-C2B2C Targets are not E1 ∩ L2, or no B2-C2B2C authority is given.
    expect(phase2c26b2c2b2dPopulation(b2c2b1, b2c1, b2c2b1Json, b2c2b2b, { ...b2c2b2c, targetWeaponIds: b2c2b2c.targetWeaponIds.slice(1) }).issues.join()).toMatch(/B2-C2B2C RESULT Targets are not E1 ∩ L2/)
    expect(phase2c26b2c2b2dPopulation(b2c2b1, b2c1, b2c2b1Json, b2c2b2b, null).issues.join()).toMatch(/no B2-C2B2C authority/)
    expect(phase2c26b2c2b2dPopulation(b2c2b1, b2c1, b2c2b1Json, b2c2b2b, { ...b2c2b2c, exportSha256: '0'.repeat(64) }).valid).toBe(false)
    expect(phase2c26b2c2b2dPopulation(b2c2b1, b2c1, b2c2b1Json, null, b2c2b2c).valid).toBe(false)
  })

  it('selects each Target\'s B2-C1 P1 first compatible rank, equal to B2-C2B1\'s recorded rank and B2-C2B2C\'s recomputed rank', () => {
    const { b2c2b1, b2c1, b2c2b2b, b2c2b2c } = authorities()
    const derived = phase2c26b2c2b2dProbes(b2c2b1, b2c1, b2c2b1Json, b2c2b2b, b2c2b2c)
    expect(derived.issues).toEqual([])
    expect(derived.probes).toHaveLength(4)
    for (const probe of derived.probes) {
      const b2c1Rank = b2c1.routes.find(r => r.targetWeaponId === probe.targetWeaponId)!.p1FirstCompatible.rank
      const b2c2b1Rank = routesOf(b2c2b1Json).find(r => r.targetWeaponId === probe.targetWeaponId)!.p1FirstCompatibleRank
      const row = (b2c2b2cJson.targets as { targetWeaponId: string; b2c1FirstCompatibleRank: number; recomputedFirstCompatibleRank: number }[]).find(t => t.targetWeaponId === probe.targetWeaponId)!
      expect([probe.contextRank, probe.contextRank, probe.contextRank, probe.contextRank]).toEqual([b2c1Rank, b2c2b1Rank, row.b2c1FirstCompatibleRank, row.recomputedFirstCompatibleRank])
      expect(probe.contextRank).toBeGreaterThanOrEqual(1)
      expect(probe.contextRank).toBeLessThanOrEqual(32)
    }
    // A rank drift in any authority fails closed (never picks one of them).
    const drift = structuredClone(b2c2b1)
    drift.routes.find(r => r.targetWeaponId === derived.probes[0]!.targetWeaponId)!.p1FirstCompatibleRank += 1
    expect(phase2c26b2c2b2dProbes(drift, b2c1, b2c2b1Json, b2c2b2b, b2c2b2c).issues.join()).toMatch(/B2-C2B1 recorded P1 first compatible rank/)
    const c2Drift = structuredClone(b2c2b2c)
    c2Drift.targets[1]!.recomputedFirstCompatibleRank = 1
    expect(phase2c26b2c2b2dProbes(b2c2b1, b2c1, b2c2b1Json, b2c2b2b, c2Drift).issues.join()).toMatch(/B2-C2B2C first compatible ranks disagree/)
    const b2c1Drift = structuredClone(b2c1)
    b2c1Drift.routes.find(r => r.targetWeaponId === derived.probes[2]!.targetWeaponId)!.p1FirstCompatible.rank = 40
    expect(phase2c26b2c2b2dProbes(b2c2b1, b2c1Drift, b2c2b1Json, b2c2b2b, b2c2b2c).valid).toBe(false)
  })

  it('derives the tight extent from the B2-C2B1 required extent by max(Production default, required): it covers the Route, stays >= default and <= L2, and is strictly below L2 for every Target', () => {
    const { b2c2b1, b2c1, b2c2b2b, b2c2b2c } = authorities()
    const derived = phase2c26b2c2b2dProbes(b2c2b1, b2c1, b2c2b1Json, b2c2b2b, b2c2b2c)
    const keys = ['maxNormalAdvance', 'maxGogmaAdvance', 'maxSkillAdvance'] as const
    const stream = { maxNormalAdvance: 'normal', maxGogmaAdvance: 'gogma', maxSkillAdvance: 'skill' } as const
    for (const d of derived.derivations) {
      const required = routesOf(b2c2b1Json).find(r => r.targetWeaponId === d.targetWeaponId)!.required
      expect(d.required).toEqual(required)
      // The rule, recomputed here from the row itself.
      for (const k of keys) expect(d.tightExtent[k]).toBe(required[stream[k]] === null ? DEFAULT[k] : Math.max(DEFAULT[k], required[stream[k]]!))
      expect(phase2c26b2c2b2dTightExtent(required)).toEqual(d.tightExtent)
      expect(phase2c26b2c2b1Covers(required, d.tightExtent)).toBe(true)
      for (const k of keys) {
        expect(d.tightExtent[k]).toBeGreaterThanOrEqual(DEFAULT[k])
        expect(d.tightExtent[k]).toBeLessThanOrEqual(L2[k])
      }
      expect(d.tightExtent).not.toEqual(L2)
      expect(d.tightExtent).not.toEqual(DEFAULT)
      expect(d.strictlySmallerStreams.length).toBeGreaterThan(0)
      expect(phase2c26b2c2b2dExtentBoundIssues(d.tightExtent)).toEqual([])
      // One below the required value on an operated stream above the default no longer covers the Route (the extent is tight).
      for (const k of keys) {
        const need = required[stream[k]]
        if (need !== null && need > DEFAULT[k]) expect(phase2c26b2c2b1Covers(required, { ...d.tightExtent, [k]: need - 1 })).toBe(false)
      }
    }
    // Targets get different extents (perTargetExtent).
    expect(new Set(derived.probes.map(p => JSON.stringify(p.extent))).size).toBeGreaterThan(1)
    // The rule keeps the default for a stream the Route does not operate on, and never goes below it.
    expect(phase2c26b2c2b2dTightExtent({ normal: null, gogma: 3, skill: 2 })).toEqual(DEFAULT)
    expect(phase2c26b2c2b2dTightExtent({ normal: 126, gogma: 23, skill: 450 })).toEqual({ maxNormalAdvance: 126, maxGogmaAdvance: 235, maxSkillAdvance: 450 })
    // A required extent beyond L2, or a B2-C2B2C copy that disagrees with B2-C2B1, fails closed.
    const bad = structuredClone(b2c2b1Json)
    routesOf(bad).find(r => r.targetWeaponId === derived.probes[0]!.targetWeaponId)!.required.skill = 1600
    expect(phase2c26b2c2b2dProbes(b2c2b1, b2c1, bad, b2c2b2b, b2c2b2c).valid).toBe(false)
    const copy = structuredClone(b2c2b2c)
    copy.targets[0]!.b2c2b1Required = { ...copy.targets[0]!.b2c2b1Required, skill: 1 }
    expect(phase2c26b2c2b2dProbes(b2c2b1, b2c1, b2c2b1Json, b2c2b2b, copy).issues.join()).toMatch(/copy of the B2-C2B1 required extent differs/)
  })

  it('reads the committed B2-C2B2C RESULT as the formal paired baseline only, failing closed on another SHA-256, case, grade, extent, Target row or task row', () => {
    const ok = parsePhase2C26B2C2B2DB2C2B2CAuthority(b2c2b2cJson, b2c2b2cSha, c2b2cExpected)
    expect(ok.issues).toEqual([])
    expect(ok.authority).toMatchObject({ decisionCase: 'B2C2B2C_INCOMPLETE', evidenceGrade: 'formal', extent: L2, scheduleExtent: DEFAULT, stage1: PHASE2C26B2C2B2C_STAGE1,
      exactTargets: { C8: 1, C32: 1, C4C: 2 }, origins: { skill: 341, gogma: 55 } })
    expect(ok.authority!.taskRows).toHaveLength(128)
    expect(ok.authority!.targets.map(t => t.recovery)).toEqual(['none', 'C8', 'none', 'C4C'])
    const bad = (patch: (j: typeof b2c2b2cJson) => void, sha: string = b2c2b2cSha, e = c2b2cExpected) => { const copy = structuredClone(b2c2b2cJson); patch(copy); return parsePhase2C26B2C2B2DB2C2B2CAuthority(copy, sha, e).valid }
    expect(bad(() => undefined, '0'.repeat(64))).toBe(false)
    expect(bad(j => { j.decision.case = 'B2C2B2C_ALL_C4C' })).toBe(false)
    expect(bad(j => { j.provenance.formal = false })).toBe(false)
    expect(bad(j => { j.provenance.partialRun = true })).toBe(false)
    expect(bad(j => { j.conditions.searchExtent = TIGHT })).toBe(false)
    expect(bad(j => { j.targets.pop() })).toBe(false)
    expect(bad(j => { j.taskRows.pop() })).toBe(false)
    expect(bad(j => { j.taskRows[0].extent = TIGHT })).toBe(false)
    expect(bad(j => { j.aggregates.exactTargets.C4C = 3 })).toBe(false)
    expect(bad(j => { j.invalidReasons = ['x'] })).toBe(false)
    for (const field of ['b2c2b1ResultSha256', 'b2c1ResultSha256', 'b2c2b2bResultSha256', 'exportSha256'] as const) expect(bad(() => undefined, b2c2b2cSha, { ...c2b2cExpected, [field]: '0'.repeat(64) })).toBe(false)
  })

  it('writes per Target only its ID, selected P1 rank and tight extent (no expected key / index / cost / outcome), exactly what the Search runner accepts', () => {
    const { b2c2b1, b2c1, b2c2b2b, b2c2b2c } = authorities()
    const manifest = phase2c26b2c2b2dProbeManifest(b2c2b1, b2c1, b2c2b1Json, b2c2b2b, b2c2b2c)
    expect(manifest).toMatchObject({ sourceResultSha256: PHASE2C26B2C2B2D_PROBE_SOURCE.resultSha256, population: 'E1_L2', policy: 'P1', contextSelection: PHASE2C26B2C2B2D_CONTEXT_SELECTION.id,
      extentRule: PHASE2C26B2C2B2D_EXTENT_RULE.id, exportSha256: exportSha })
    expect(Object.keys(manifest).sort()).toEqual(['contextSelection', 'exportSha256', 'extentRule', 'phase', 'policy', 'population', 'probes', 'sourceResultSha256'])
    for (const probe of manifest.probes) {
      expect(Object.keys(probe).sort()).toEqual(['contextRank', 'extent', 'targetWeaponId'])
      expect(Object.keys(probe.extent).sort()).toEqual(['maxGogmaAdvance', 'maxNormalAdvance', 'maxSkillAdvance'])
    }
    expect(JSON.stringify(manifest.probes)).not.toMatch(/stableKey|candidateIndex|operationCost|exact|partial|coverage|oracle|required|route|fnv1a32|K1:/i)
    expect(manifest.probes.map(p => p.targetWeaponId)).toEqual(b2c2b2c.targetWeaponIds)
    expect(parsePhase2C26B2C2B2DProbeManifest(structuredClone(manifest))).toMatchObject({ valid: true, issues: [] })
    const bad = (patch: (m: Record<string, unknown> & typeof manifest) => void) => { const copy = structuredClone(manifest) as Record<string, unknown> & typeof manifest; patch(copy); return parsePhase2C26B2C2B2DProbeManifest(copy).valid }
    expect(bad(m => { m.probes = m.probes.slice(1) })).toBe(false)
    expect(bad(m => { m.probes = [...m.probes].reverse() })).toBe(false)
    expect(bad(m => { m.probes[0]!.contextRank = 33 })).toBe(false)
    expect(bad(m => { m.probes[0]!.contextRank = 0 })).toBe(false)
    expect(bad(m => { m.probes[0]!.extent = { ...L2 } })).toBe(false)
    expect(bad(m => { m.probes[0]!.extent = { ...m.probes[0]!.extent, maxSkillAdvance: 1501 } })).toBe(false)
    expect(bad(m => { m.probes[0]!.extent = { ...m.probes[0]!.extent, maxNormalAdvance: 3 } })).toBe(false)
    expect(bad(m => { m.sourceResultSha256 = '0'.repeat(64) })).toBe(false)
    expect(bad(m => { (m as Record<string, unknown>).extentRule = 'other' })).toBe(false)
    expect(bad(m => { (m as Record<string, unknown>).contextSelection = 'p1_top32' })).toBe(false)
    for (const field of ['expectedStableKey', 'expectedCandidateIndex', 'expectedOperationCost', 'oracleRoute', 'required']) {
      expect(bad(m => { (m.probes[0] as unknown as Record<string, unknown>)[field] = 1 })).toBe(false)
      expect(bad(m => { m[field] = {} })).toBe(false)
    }
  })
})

// ---------------------------------------------------------------- a synthetic world

const SOURCE_A_SKILL = 'series_skill.fixture.z'
const SOURCE_B_SKILL = 'series_skill.fixture.b-source'

function world() {
  const skill = { seriesSkillId: SOURCE_A_SKILL, groupSkillId: null, matchMode: 'all' as const }
  const a: TargetWeapon = orchestrationTarget('target.b2c2b2d.a', { priority: 5, idealSkillCondition: skill, practicalSkillCondition: skill })
  const b = skillConstrainedTarget('target.b2c2b2d.b', { priority: 1 })
  const built = orchestrationScenario({
    engine: { gogmaPositions: L2.maxGogmaAdvance + 8, skillPositions: L2.maxSkillAdvance + 8 },
    targets: [a, b],
    ownedWeapons: [orchestrationSource(ORCHESTRATION_SOURCE_A, { seriesSkillId: SOURCE_A_SKILL }),
      orchestrationSource(ORCHESTRATION_SOURCE_B, { restorationBonuses: belowPracticalBonuses(), seriesSkillId: SOURCE_B_SKILL })],
    entries: [
      orchestrationEntry('build-list.b2c2b2d.a', a, resetRoute(ORCHESTRATION_SOURCE_A), { finalBonuses: idealBonuses(), seriesSkillId: SOURCE_A_SKILL }),
      orchestrationEntry('build-list.b2c2b2d.b', b, { kind: 'existing_gogma_mixed', sourceOwnedWeaponId: resetRoute(ORCHESTRATION_SOURCE_B).sourceOwnedWeaponId,
        operations: [...resetRoute(ORCHESTRATION_SOURCE_B).operations, ...resetSkillsRoute(ORCHESTRATION_SOURCE_B).operations] }),
    ],
  })
  const schedule = derivePhase2C26B2C1Schedule(built.input, globalResearchDependencies(built.engine))
  return { built, schedule }
}
const PROBES: Phase2C26B2C2B2DProbe[] = [{ targetWeaponId: 'target.b2c2b2d.a', contextRank: 1, extent: { maxNormalAdvance: 8, maxGogmaAdvance: 235, maxSkillAdvance: 256 } },
  { targetWeaponId: 'target.b2c2b2d.b', contextRank: 2, extent: { ...TIGHT } }]

function defaultContextOf(schedule: Phase2C26B2C1Schedule, id = 'target.b2c2b2d.b', rank = 2): Phase2C26B2B2AContext {
  const row = schedule.contexts.find(c => c.targetWeaponId === id && c.ranks.P1 === rank)!
  const rebuilt = reconstructPhase2C26B2B2AContext(schedule.snapshot, { targetWeaponId: id, fixedSetId: row.representativeFixedSetId, cardinality: row.targetEligibleMinCardinality, reservationDigest: row.reservationDigest })
  if (!rebuilt.valid) throw new Error(rebuilt.issues.join())
  return rebuilt.context
}
function tightContextOf(schedule: Phase2C26B2C1Schedule, extent = TIGHT, id = 'target.b2c2b2d.b', rank = 2) {
  const tight = phase2c26b2c2b2dTightContext(defaultContextOf(schedule, id, rank), { ...extent })
  if (!tight.valid) throw new Error(tight.issues.join())
  return tight.context
}

// ---------------------------------------------------------------- registered conditions, tight context and task construction

describe('Phase 2-C2.6-B2-C2B2D registered conditions, tight context and task construction', () => {
  it('registers 4 Targets x 1 context = 4 tasks with B2-C2B2C\'s capture and Stage 1 unchanged (10 minutes, heap 8192 MB, concurrency 1, no retry / fallback)', () => {
    expect([PHASE2C26B2C2B2D_TARGETS, PHASE2C26B2C2B2D_CONTEXTS_PER_TARGET, PHASE2C26B2C2B2D_EXPECTED_TASKS]).toEqual([4, 1, 4])
    expect(PHASE2C26B2C2B2D_STAGE1).toBe(PHASE2C26B2C2B2C_STAGE1)
    expect(PHASE2C26B2C2B2D_STAGE1).toEqual({ executionClass: 'stage1', childHeapMb: 8192, concurrency: 1, budgetMs: 600_000, retry: 'none', fallback: 'none' })
    expect([PHASE2C26B2C2B2D_MAX_COST_COHORTS, PHASE2C26B2C2B2D_CANDIDATE_SAFETY_CAP]).toEqual([PHASE2C26B2C2B2C_MAX_COST_COHORTS, PHASE2C26B2C2B2C_CANDIDATE_SAFETY_CAP])
    expect([PHASE2C26B2C2B2D_MAX_COST_COHORTS, PHASE2C26B2C2B2D_CANDIDATE_SAFETY_CAP]).toEqual([4, 1024])
    expect(PHASE2C26B2C2B2D_CAPTURE_PREFIXES).toEqual({ C8: 8, C32: 32 })
    expect(PHASE2C26B2C2B2D_COMMON_L2_EXTENT).toBe(PHASE2C26B2C2B2C_EXTENT)
    expect(PHASE2C26B2C2B2D_FLOOR_EXTENT).toEqual(DEFAULT)
    expect(PHASE2C26B2C2B2D_REGISTERED_P1).toEqual({ id: 'P1', name: 'default_simple_first', keys: [['targetEligibleMinCardinality', 'asc'], ['exclusiveOwnedWeaponCount', 'asc'],
      ['blockedCountDefaultTotal', 'asc'], ['shareableHeldCountDefaultTotal', 'desc'], ['reservationDigest', 'asc']] })
    // The oracle-guided flags are declared true, never disguised.
    expect(PHASE2C26B2C2B2D_PROVENANCE_FLAGS).toMatchObject({ oracleGuidedTargetPopulation: true, oracleGuidedContextSelection: true, oracleInformedPerTargetExtent: true,
      targetIndividualOracleExtentAsSearchInput: true, perTargetExtent: true, commonExtentForEveryTask: false, oracleReadBySearchChild: false, oracleMatchUsedForEarlyStop: false,
      expectedOutcomeKnownBySearchChild: false, productionSchedulerEvidence: false, productionExtentSelectionEvidence: false })
    for (const item of ['budget_increase_60min', 'heap_increase', 'b2c2b2c_timeout_retry', 'b2c2b2b_timeout_retry', 'retry', 'timeout_fallback', 'search_optimization', 'production_extent_selector',
      'production_rung_selector', 'e2_search', 'k2_feature_grouping', 'residual_unreached_support', 'global_assignment', 'full_planner_rerun', 'ui_change', 'production_change']) {
      expect(PHASE2C26B2C2B2D_NOT_RUN).toContain(item)
    }
  })

  it('accepts only an extent between the Production default and the common L2 extent and strictly below L2 somewhere', () => {
    expect(phase2c26b2c2b2dExtentBoundIssues(TIGHT)).toEqual([])
    expect(phase2c26b2c2b2dExtentBoundIssues(DEFAULT)).toEqual([])
    expect(phase2c26b2c2b2dExtentBoundIssues({ ...L2, maxNormalAdvance: 127 })).toEqual([])
    expect(phase2c26b2c2b2dExtentBoundIssues(L2).join()).toMatch(/common L2 extent itself/)
    expect(phase2c26b2c2b2dExtentBoundIssues({ ...TIGHT, maxSkillAdvance: 1501 }).join()).toMatch(/above the common L2/)
    expect(phase2c26b2c2b2dExtentBoundIssues({ ...TIGHT, maxGogmaAdvance: 234 }).join()).toMatch(/below the Production default/)
    expect(phase2c26b2c2b2dExtentBoundIssues({ ...TIGHT, maxSkillAdvance: 446.5 }).join()).toMatch(/not an integer/)
    expect(phase2c26b2c2b2dExtentBoundIssues({ ...TIGHT, extra: 1 }).join()).toMatch(/keys/)
    expect(phase2c26b2c2b2dExtentBoundIssues(null)).not.toEqual([])
  })

  it('replaces the extent of the unchanged default reconstruction by the tight extent and nothing else, exactly as B2-C2B2A moves it to L2', () => {
    const { schedule } = world()
    const base = defaultContextOf(schedule)
    expect(base.extent).toEqual(DEFAULT)
    const tight = phase2c26b2c2b2dTightContext(base, { ...TIGHT })
    const l2 = phase2c26b2c2b2aL2Context(base)
    expect(tight.valid && l2.valid).toBe(true)
    if (!tight.valid || !l2.valid) return
    const { extent, searchInputDigest, ...rest } = tight.context
    const { extent: l2Extent, searchInputDigest: l2Digest, ...l2Rest } = l2.context
    expect(rest).toEqual(l2Rest)
    expect([extent, l2Extent]).toEqual([TIGHT, L2])
    expect(tight.context.defaultSearchInputDigest).toBe(base.searchInputDigest)
    expect(new Set([searchInputDigest, l2Digest, base.searchInputDigest]).size).toBe(3)
    for (const other of [L2, { ...TIGHT, maxSkillAdvance: 2000 }, { ...TIGHT, maxNormalAdvance: 3 }]) expect(phase2c26b2c2b2dTightContext(base, { ...other }).valid).toBe(false)
    expect(phase2c26b2c2b2dTightContext({ ...base, extent: { ...TIGHT } }, { ...TIGHT }).valid).toBe(false)
    expect(phase2c26b2c2b2dTightContext({ ...base, searchInputDigest: 'other' }, { ...TIGHT }).valid).toBe(false)
    expect(phase2c26b2c2b2dTightContext({ ...base, reservationDigest: 'other' }, { ...TIGHT }).valid).toBe(false)
  })

  it('builds exactly one task per probe at the probe\'s rank and tight extent, with B2-C2B2C\'s task ID (t<probe index>-r<rank>)', () => {
    const { schedule } = world()
    const built = buildPhase2C26B2C2B2DTasks(schedule, PROBES)
    expect(built.issues).toEqual([])
    expect(built.tasks.map(t => [t.taskId, t.targetWeaponId, t.contextRank, t.extent])).toEqual([['t00-r01', 'target.b2c2b2d.a', 1, PROBES[0]!.extent], ['t01-r02', 'target.b2c2b2d.b', 2, TIGHT]])
    for (const task of built.tasks) {
      const row = schedule.contexts.find(c => c.targetWeaponId === task.targetWeaponId && c.ranks.P1 === task.contextRank)!
      expect(task).toMatchObject({ groupIndex: row.groupIndex, reservationDigest: row.reservationDigest, policy: 'P1', maxCostCohorts: 4, candidateSafetyCap: 1024 })
      expect(task.defaultSearchInputDigest).toBe(defaultContextOf(schedule, task.targetWeaponId, task.contextRank).searchInputDigest)
      expect(task.searchInputDigest).toBe(tightContextOf(schedule, task.extent, task.targetWeaponId, task.contextRank).searchInputDigest)
    }
    expect(Object.keys(built.tasks[0]!).sort()).toEqual(['candidateSafetyCap', 'contextRank', 'defaultSearchInputDigest', 'executionClass', 'extent', 'groupIndex', 'maxCostCohorts', 'policy',
      'representativeFixedSetId', 'representativeFixedTargetWeaponIds', 'reservationDigest', 'searchInputDigest', 'targetEligibleMinCardinality', 'targetWeaponId', 'taskId'])
    // Fail closed: an unknown Target, a repeated Target, a rank the schedule does not hold, an extent outside the bounds, a non-default schedule.
    const issues = (probes: Phase2C26B2C2B2DProbe[], s = schedule) => buildPhase2C26B2C2B2DTasks(s, probes).issues.join('\n')
    expect(issues([...PROBES, { ...PROBES[0]!, targetWeaponId: 'target.none' }])).toMatch(/not a schedule Target/)
    expect(issues([PROBES[0]!, PROBES[0]!])).toMatch(/repeats/)
    expect(issues([{ ...PROBES[1]!, contextRank: 33 }])).toMatch(/not in 1\.\.32/)
    expect(issues([{ ...PROBES[1]!, contextRank: 31 }])).toMatch(/schedule rows hold the rank/)
    expect(issues([{ ...PROBES[1]!, extent: { ...L2 } }])).toMatch(/common L2 extent itself/)
    const extent = structuredClone(schedule); extent.extent = { ...L2 }
    expect(issues(PROBES, extent)).toMatch(/Production default extent/)
    expect(buildPhase2C26B2C2B2DTasks(extent, PROBES).tasks).toEqual([])
  })
})

// ---------------------------------------------------------------- the Search child

const CAPTURE = { maxCostCohorts: PHASE2C26B2C2B2D_MAX_COST_COHORTS, candidateSafetyCap: PHASE2C26B2C2B2D_CANDIDATE_SAFETY_CAP }
const PROVENANCE = { contextRank: 2, targetEligibleMinCardinality: 1, representativeFixedSetId: 'K1:x', representativeFixedTargetWeaponIds: ['t'] }

/** The body of one exported async function, from its signature to the closing brace at column 0. */
const functionBody = (source: string, name: string) => {
  const start = source.indexOf(`export async function ${name}(`)
  const end = source.indexOf('\n}\n', start)
  if (start < 0 || end < 0) throw new Error(`no ${name}`)
  return source.slice(start, end)
}

describe('Phase 2-C2.6-B2-C2B2D Search child', () => {
  it('is B2-C2B2A\'s Search body line for line, except the extent guard (bounds instead of exactly L2) and the phase names', () => {
    const normalize = (body: string) => body.split('\n')
      .filter(line => !/context\.extent, \{ \.\.\.PHASE2C26B2C2B2A_EXTENT \}|const bound = phase2c26b2c2b2dExtentBoundIssues|if \(bound\.length > 0\)/.test(line))
      .join('\n').replace(/B2C2B2[AD]/g, 'X').replace(/B2-C2B2[AD]/g, 'X').replace(/Phase2C26B2C2B2[AD]/g, 'PhaseX').replace(/PHASE2C26B2C2B2[AD]/g, 'PHASEX')
    const ours = normalize(functionBody(searchSource, 'runPhase2C26B2C2B2DSearch'))
    const theirs = normalize(functionBody(b2c2b2aSearchSource, 'runPhase2C26B2C2B2ASearch'))
    expect(ours).toBe(theirs)
    expect(ours).toMatch(/visitPlannerAlternativeCandidates\(searchInput, engine/)
  })

  it('gives visitPlannerAlternativeCandidates() exactly the rebuilt origin, reservation, exclusion and the tight extent', async () => {
    const { built, schedule } = world()
    const context = tightContextOf(schedule)
    searchCalls.script = [1, 2, 3, 4, 5]
    const record = await runPhase2C26B2C2B2DSearch(built.input, context, built.engine, CAPTURE, PROVENANCE, { now: () => 0 })
    expect(searchCalls.inputs).toEqual([{ origin: createPlannerStartSearchOrigin(built.input), targetWeaponId: 'target.b2c2b2d.b', extent: TIGHT,
      reservation: context.reservation, excludedRouteKeys: context.excludedRouteKeys }])
    expect(record).toMatchObject({ extent: TIGHT, searchInputDigest: context.searchInputDigest, defaultSearchInputDigest: context.defaultSearchInputDigest, termination: 'four_cost_cohorts_drained' })
    expect(searchCalls.decisions).toEqual([...Array(4).fill('continue'), 'stop'])
  })

  it('captures exactly as B2-C2B2A does at L2 for the same deliveries: the records differ in the extent and its digest only', async () => {
    const { built, schedule } = world()
    const l2 = phase2c26b2c2b2aL2Context(defaultContextOf(schedule))
    if (!l2.valid) throw new Error('L2 context')
    for (const script of [[1, 1, 2, 3, 3, 4, 4, 5, 5], [1, 2, 2], Array(PHASE2C26B2C2B2D_CANDIDATE_SAFETY_CAP + 3).fill(2)]) {
      searchCalls.script = script
      searchCalls.decisions = []
      const atTight = await runPhase2C26B2C2B2DSearch(built.input, tightContextOf(schedule), built.engine, CAPTURE, PROVENANCE, { now: () => 0 })
      const tightDecisions = [...searchCalls.decisions]
      searchCalls.decisions = []
      const atL2 = await runPhase2C26B2C2B2ASearch(built.input, l2.context, built.engine, CAPTURE, PROVENANCE, { now: () => 0 })
      expect(tightDecisions).toEqual(searchCalls.decisions)
      const { extent: e1, searchInputDigest: d1, ...rest1 } = atTight
      const { extent: e2, searchInputDigest: d2, ...rest2 } = atL2
      expect(rest1).toEqual(rest2)
      expect([e1, e2]).toEqual([TIGHT, L2])
      expect(d1).not.toBe(d2)
    }
  }, 120_000)

  it('stops at the first Candidate of a fifth cost and at the safety cap and at nothing else, and refuses another capture rule or an out-of-bounds extent', async () => {
    const { built, schedule } = world()
    const context = tightContextOf(schedule)
    searchCalls.script = [1, 1, 2, 3, 3, 4, 4, 5, 5]
    expect(await runPhase2C26B2C2B2DSearch(built.input, context, built.engine, CAPTURE, PROVENANCE)).toMatchObject({ termination: 'four_cost_cohorts_drained', capturedCosts: [1, 2, 3, 4] })
    expect(searchCalls.decisions).toEqual([...Array(7).fill('continue'), 'stop'])
    searchCalls.script = [7]
    searchCalls.endByExtent = true
    expect(await runPhase2C26B2C2B2DSearch(built.input, context, built.engine, CAPTURE, PROVENANCE)).toMatchObject({ termination: 'stopped_by_extent', captureComplete: true })
    searchCalls.endByExtent = false
    searchCalls.script = Array(PHASE2C26B2C2B2D_CANDIDATE_SAFETY_CAP + 3).fill(2)
    expect(await runPhase2C26B2C2B2DSearch(built.input, context, built.engine, CAPTURE, PROVENANCE)).toMatchObject({ termination: 'candidate_safety_cap', captureComplete: false, safetyCapHit: true })
    await expect(runPhase2C26B2C2B2DSearch(built.input, context, built.engine, { ...CAPTURE, candidateSafetyCap: 32 }, PROVENANCE)).rejects.toThrow(/safety cap/)
    await expect(runPhase2C26B2C2B2DSearch(built.input, context, built.engine, { ...CAPTURE, maxCostCohorts: 1 }, PROVENANCE)).rejects.toThrow(/cost cohorts/)
    await expect(runPhase2C26B2C2B2DSearch(built.input, { ...context, extent: { ...L2 } }, built.engine, CAPTURE, PROVENANCE)).rejects.toThrow(/tight extent/)
    await expect(runPhase2C26B2C2B2DSearch(built.input, { ...context, extent: { ...TIGHT, maxSkillAdvance: 1600 } }, built.engine, CAPTURE, PROVENANCE)).rejects.toThrow(/tight extent/)
  }, 120_000)

  it('selects its context by Target and P1 rank from its own schedule and reports any drift as a context mismatch without searching', async () => {
    const { built, schedule } = world()
    const task = buildPhase2C26B2C2B2DTasks(schedule, PROBES).tasks[1]!
    searchCalls.script = [1, 2, 3, 4, 5]
    expect(await runPhase2C26B2C2B2DTask(built.input, schedule, task, built.engine)).toMatchObject({ status: 'searched', search: { contextRank: 2, extent: TIGHT, termination: 'four_cost_cohorts_drained' } })
    searchCalls.inputs = []
    const mismatch = async (patch: Partial<Phase2C26B2C2B2DTaskInput>) => runPhase2C26B2C2B2DTask(built.input, schedule, { ...task, ...patch }, built.engine)
    expect(await mismatch({ searchInputDigest: 'other' })).toMatchObject({ status: 'context_mismatch', issues: ['searchInputDigest'] })
    expect(await mismatch({ defaultSearchInputDigest: 'other' })).toMatchObject({ status: 'context_mismatch', issues: ['defaultSearchInputDigest'] })
    expect(await mismatch({ extent: { ...L2 } })).toMatchObject({ status: 'context_mismatch', issues: ['extent'] })
    // Another in-bounds extent than the one the digest was computed for is a digest mismatch.
    expect(await mismatch({ extent: { ...TIGHT, maxSkillAdvance: 447 } })).toMatchObject({ status: 'context_mismatch', issues: ['searchInputDigest'] })
    expect(await mismatch({ reservationDigest: 'other' })).toMatchObject({ status: 'context_mismatch', issues: ['reservationDigest'] })
    expect(await mismatch({ contextRank: 99 })).toMatchObject({ status: 'context_mismatch', issues: ['P1 rank 99 holds 0 contexts'] })
    expect(searchCalls.inputs).toEqual([])
  })

  it('records a timeout / out of memory / failure as that failure, never as no Candidate', () => {
    expect(phase2c26b2c2b2dTaskOutcome('t', 'timeout', null)).toEqual({ taskId: 't', process: 'timeout', record: null, searchStatus: null, termination: null, candidateCount: null })
    expect(phase2c26b2c2b2dTaskOutcome('t', 'out_of_memory', null)).toMatchObject({ process: 'out_of_memory', candidateCount: null })
    expect(phase2c26b2c2b2dTaskOutcome('t', 'completed', null).process).toBe('process_failure')
  })
})

// ---------------------------------------------------------------- the runner start attestation

const HEAD = 'a'.repeat(40)
const OBS_PROBES: Phase2C26B2C2B2DProbe[] = [{ targetWeaponId: 't1', contextRank: 17, extent: { maxNormalAdvance: 126, maxGogmaAdvance: 235, maxSkillAdvance: 450 } },
  { targetWeaponId: 't2', contextRank: 11, extent: { maxNormalAdvance: 4, maxGogmaAdvance: 235, maxSkillAdvance: 1083 } }]
const observation = { createdAt: '2026-10-05T01:00:00.000Z', runnerScript: 'scripts/run-planner-global-phase2c26b2c2b2d.mjs', node: 'v24.19.0', repositoryHead: HEAD, uncommittedBenchmarkCode: false,
  benchmarkCodeSha256: 'b'.repeat(64), exportFileName: 'export.json', exportSha256: 'c'.repeat(64), exportBytes: 10, probeManifestFileName: 'probes.json.local', probeManifestSha256: 'd'.repeat(64),
  probeManifestSourceResultSha256: PHASE2C26B2C2B2D_PROBE_SOURCE.resultSha256, targetWeaponIds: ['t1', 't2'], probes: OBS_PROBES, stage1: { ...PHASE2C26B2C2B2D_STAGE1 }, smoke: null }
const expectation: Phase2C26B2C2B2DAttestationExpectation = { repositoryHead: HEAD, benchmarkCodeSha256: 'b'.repeat(64), exportSha256: 'c'.repeat(64), probeManifestSha256: 'd'.repeat(64),
  probes: OBS_PROBES, firstChildStartedAt: '2026-10-05T01:00:00.500Z' }
const environmentOf = (a: { [K in 'repositoryHead' | 'uncommittedBenchmarkCode' | 'benchmarkCodeSha256' | 'exportSha256' | 'probeManifestSha256' | 'stage1' | 'probes']: unknown }) => ({ repositoryHead: a.repositoryHead, uncommittedBenchmarkCode: a.uncommittedBenchmarkCode, benchmarkCodeSha256: a.benchmarkCodeSha256,
  exportSha256: a.exportSha256, probeManifestSha256: a.probeManifestSha256, stage1: a.stage1, probes: a.probes })

describe('Phase 2-C2.6-B2-C2B2D runner start attestation', () => {
  it('carries the launch observation (selected ranks, tight extents), every registered condition and the true oracle-guided flags, and verifies only against the independently obtained values', () => {
    const attestation = phase2c26b2c2b2dStartAttestationBody(observation)
    expect(attestation).toMatchObject({ attestedBy: 'runner', phase: PHASE2C26B2C2B2D_START_ATTESTATION_PHASE, repositoryHead: HEAD, uncommittedBenchmarkCode: false, stage1: PHASE2C26B2C2B2D_STAGE1,
      targets: 4, contextsPerTarget: 1, expectedTasks: 4, contextSelection: PHASE2C26B2C2B2D_CONTEXT_SELECTION.id, extentRule: PHASE2C26B2C2B2D_EXTENT_RULE.id, extentFloor: DEFAULT, extentCeiling: L2,
      candidateSafetyCap: 1024, captureRule: { policy: 'C4C', maxCostCohorts: 4 }, registeredP1: PHASE2C26B2C2B2D_REGISTERED_P1, smoke: null, probes: OBS_PROBES,
      provenanceFlags: { oracleGuidedContextSelection: true, targetIndividualOracleExtentAsSearchInput: true, perTargetExtent: true } })
    for (const field of ['attestedBy', 'createdAt', 'repositoryHead', 'uncommittedBenchmarkCode', 'benchmarkCodeSha256', 'exportSha256', 'probeManifestSha256', 'targetWeaponIds', 'probes', 'stage1',
      'expectedTasks', 'extentRule', 'captureRule', 'candidateSafetyCap', 'registeredP1', 'smoke', 'provenanceFlags']) expect(attestation).toHaveProperty(field)
    expect(verifyPhase2C26B2C2B2DStartAttestation(attestation, expectation)).toEqual({ verified: true, issues: [], integrityIssues: [] })
    const issue = (patch: Record<string, unknown>, expected: Partial<Phase2C26B2C2B2DAttestationExpectation> = {}) =>
      verifyPhase2C26B2C2B2DStartAttestation({ ...attestation, ...patch }, { ...expectation, ...expected }).issues.join('\n')
    const integrity = (patch: Record<string, unknown>) => verifyPhase2C26B2C2B2DStartAttestation({ ...attestation, ...patch }, expectation).integrityIssues.length > 0
    for (const patch of [{ repositoryHead: 'f'.repeat(40) }, { benchmarkCodeSha256: '0'.repeat(64) }, { exportSha256: '0'.repeat(64) }, { probeManifestSha256: '0'.repeat(64) },
      { targetWeaponIds: ['t1'] }, { probes: [OBS_PROBES[0]] }, { probes: [{ ...OBS_PROBES[0]!, contextRank: 18 }, OBS_PROBES[1]] }, { attestedBy: 'reconstruction' },
      { createdAt: '2026-10-05T01:00:01.000Z' }, { extra: 1 }, { phase: PHASE2C26B2C2B2C_START_ATTESTATION_PHASE }]) expect(integrity(patch)).toBe(true)
    // A truthfully attested non-formal launch, or a condition other than the registered one, is not an integrity issue.
    for (const patch of [{ uncommittedBenchmarkCode: true }, { smoke: { taskIds: ['t00-r17'], budgetMs: null } }, { stage1: { ...PHASE2C26B2C2B2D_STAGE1, budgetMs: 3_600_000 } },
      { stage1: { ...PHASE2C26B2C2B2D_STAGE1, childHeapMb: 16384 } }, { expectedTasks: 128 }, { extentCeiling: TIGHT },
      { provenanceFlags: { ...PHASE2C26B2C2B2D_PROVENANCE_FLAGS, oracleGuidedContextSelection: false } }, { provenanceFlags: { ...PHASE2C26B2C2B2D_PROVENANCE_FLAGS, perTargetExtent: false } }]) {
      expect(integrity(patch)).toBe(false)
      expect(issue(patch)).not.toBe('')
    }
    expect(issue({ provenanceFlags: { ...PHASE2C26B2C2B2D_PROVENANCE_FLAGS, targetIndividualOracleExtentAsSearchInput: false } })).toMatch(/provenanceFlags differs/)
    expect(issue({}, { repositoryHead: 'f'.repeat(40) })).toMatch(/repositoryHead differs/)
    expect(issue({ uncommittedBenchmarkCode: null })).toMatch(/uncommitted/)
    expect(issue({ createdAt: '2026-10-05 01:00' })).toMatch(/canonical UTC/)
    expect(verifyPhase2C26B2C2B2DStartAttestation(null, expectation).verified).toBe(false)
    expect(Object.keys(phase2c26b2c2b2dRegisteredConditions()).sort()).toEqual(['candidateSafetyCap', 'captureRule', 'contextSelection', 'contextsPerTarget', 'expectedTasks', 'extentCeiling',
      'extentFloor', 'extentRule', 'memorySampleIntervalMs', 'nodeYield', 'provenanceFlags', 'registeredP1', 'stage1', 'targets', 'tasksBudgetMs'])
  })

  it('grades launch provenance by the attestation file alone: absent never formal; present and correct verifies; any mismatch fails closed', () => {
    const attestation = phase2c26b2c2b2dStartAttestationBody(observation)
    const file = { sha256: 'e'.repeat(64), body: attestation }
    const environment = environmentOf(attestation)
    expect(phase2c26b2c2b2dLaunchProvenance({ attestationFile: file, recordedAttestationSha256: file.sha256, environment, expected: expectation }))
      .toMatchObject({ verified: true, source: 'runner_start_attestation', workingTreeCleanVerified: true, issues: [] })
    expect(phase2c26b2c2b2dLaunchProvenance({ attestationFile: null, recordedAttestationSha256: null, environment, expected: expectation })).toMatchObject({ verified: false, source: 'none' })
    expect(phase2c26b2c2b2dLaunchProvenance({ attestationFile: file, recordedAttestationSha256: '0'.repeat(64), environment, expected: expectation }).integrityIssues.join()).toMatch(/not the one the raw recorded/)
    expect(phase2c26b2c2b2dLaunchProvenance({ attestationFile: file, recordedAttestationSha256: file.sha256, environment: { ...environment, probes: [] }, expected: expectation }).verified).toBe(false)
    for (const expected of [{ repositoryHead: 'f'.repeat(40) }, { benchmarkCodeSha256: '0'.repeat(64) }, { exportSha256: '0'.repeat(64) }, { probeManifestSha256: '0'.repeat(64) }, { probes: [] }]) {
      expect(phase2c26b2c2b2dLaunchProvenance({ attestationFile: file, recordedAttestationSha256: file.sha256, environment, expected: { ...expectation, ...expected } }).verified).toBe(false)
    }
    expect(phase2c26b2c2b2dEvidenceGrade({ formalConditions: true, launchProvenanceVerified: true, partialRun: true })).toBe('formal')
    expect(phase2c26b2c2b2dEvidenceGrade({ formalConditions: true, launchProvenanceVerified: false, partialRun: true })).toBe('diagnostic_partial')
    expect(phase2c26b2c2b2dEvidenceGrade({ formalConditions: false, launchProvenanceVerified: true, partialRun: false })).toBe('non_formal')
  })

  it('is written by the runner into the run dir, once and read-only, before the tasks child and before any Search child', () => {
    expect(PHASE2C26B2C2B2D_START_ATTESTATION_FILE).toBe('start-attestation.json')
    const write = runnerSource.indexOf('await write(attestationPath, attestation)')
    const chmod = runnerSource.indexOf('await chmod(attestationPath, 0o444)')
    const tasksChild = runnerSource.indexOf("await runChild('tasks', 'tasks'")
    const stage1 = runnerSource.indexOf('const stage1 = await pool(stage1Tasks,')
    const mkdirAt = runnerSource.indexOf('await mkdir(runDir, { recursive: true })')
    expect([mkdirAt, write, chmod, tasksChild, stage1].every(i => i > 0)).toBe(true)
    expect(mkdirAt < write && write < chmod && chmod < tasksChild && tasksChild < stage1).toBe(true)
    expect(runnerSource).toMatch(/const write = \(path, value, pretty = true\) => writeFile\(path, [^\n]*\{ flag: 'wx' \}\)/)
    expect(runnerSource).toMatch(/if \(existsSync\(runDir\)\) throw new Error/)
    expect(runnerSource).toMatch(/phase2c26b2c2b2dStartAttestationBody\(\{ createdAt: new Date\(\)\.toISOString\(\)/)
    expect(runnerSource).toMatch(/The start attestation read back is not the one written/)
    expect(runnerSource).toMatch(/verifyPhase2C26B2C2B2DStartAttestation\(/)
    expect(runnerSource).toMatch(/Commit ALL benchmark code before a formal measurement/)
    expect(runnerSource).toMatch(/appendFileSync\(processesPath, JSON\.stringify\(\{ \.\.\.entry, recordFile \}\) \+ '\\n'\)/)
    expect(runnerSource).toMatch(/const SCRIPT_PATH = 'scripts\/run-planner-global-phase2c26b2c2b2d\.mjs'/)
    expect(runnerSource).toMatch(/smoke options and need --allow-uncommitted/)
    // Stage 1 is B2-C2B2C's: the budget and heap come from the registered Stage 1 only (a smoke budget is non-formal).
    expect(runnerSource).toMatch(/const stage1Conditions = \{ \.\.\.c2b2d\.PHASE2C26B2C2B2D_STAGE1, budgetMs: smokeBudgetMs \?\? c2b2d\.PHASE2C26B2C2B2D_STAGE1\.budgetMs \}/)
    expect(runnerSource).toMatch(/heapMb: stage1Conditions\.childHeapMb, budgetMs: stage1Conditions\.budgetMs/)
  })

  it('reconstructs an interrupted run only with a verifying attestation (fail closed otherwise) and never invents one', () => {
    expect(reconstructSource).not.toMatch(/visitPlannerAlternativeCandidates|runPhase2C26B2C2B2DTask\(|runPhase2C26B2C2B2DSearch|spawn\(|derivePhase2C26B1Schedule|--oracle|--manifest|_RESULT/)
    expect(reconstructSource).not.toMatch(/writeFile\([^)]*runDir|\brm\(|\bunlink\(|\brename\(|\bcopyFile\(|chmod\(/)
    expect(reconstructSource).toMatch(/writeFile\(paths\.output, text, \{ flag: 'wx' \}\)/)
    expect(reconstructSource).toMatch(/verifyPhase2C26B2C2B2DStartAttestation\(attestation, \{ repositoryHead: measuredHead, benchmarkCodeSha256: recomputedBenchmarkCodeSha256,/)
    expect(reconstructSource).toMatch(/if \(check\.integrityIssues\.length > 0\) throw new Error\(`The runner start attestation does not verify/)
    expect(reconstructSource).toMatch(/if \(!check\.verified && !allowNonformal\) throw/)
    expect(reconstructSource).toMatch(/firstChildStartedAt: tasksEnded\.startedAt/)
    expect(reconstructSource).not.toMatch(/attestedBy|phase2c26b2c2b2dStartAttestationBody|c2b2c\.|PHASE2C26B2C2B2C/)
    expect(reconstructSource).toMatch(/status: 'interrupted'/)
    expect(reconstructSource).toMatch(/childRecordsModified: false, searchRun: false/)
    expect(reconstructSource).toMatch(/a valid 4-task construction/)
    expect(reconstructSource).toMatch(/\.\.\.c2b2d\.PHASE2C26B2C2B2D_PROVENANCE_FLAGS/)
  })

  it('makes a RESULT formal only with verified launch provenance; --allow-nonformal never promotes it; the interpretation and E1 aggregate stay out of the decision', () => {
    expect(analyzerSource).toMatch(/const formalConditions = formalRunConditions && calculationCodeChangedSinceMeasuredHead\.length === 0 && !analysisUncommitted\s+const formal = formalConditions && launchProvenance\.verified\n/)
    expect(analyzerSource.match(/const formal = [^\n]*/)![0]).not.toMatch(/allowNonformal|interrupted|reconstruction/)
    expect(analyzerSource).toMatch(/if \(!launchProvenance\.verified && !allowNonformal\) throw/)
    expect(analyzerSource).toMatch(/if \(attestationFile !== null\) invalidReasons\.push\(\.\.\.launchProvenance\.integrityIssues/)
    expect(analyzerSource).toMatch(/plannerGlobalPhase2C26B2C2B2DAnalysis\.ts', 'scripts\/analyze-planner-global-phase2c26b2c2b2d\.mjs', 'scripts\/reconstruct-planner-global-phase2c26b2c2b2d-partial-raw\.mjs'/)
    expect(analyzerSource.match(/const finalDecision = [^\n]*/)![0]).not.toMatch(/interpretation|e1Aggregate/)
    expect(analyzerSource).toMatch(/--b2c2b2c-result/)
    expect(analyzerSource).toMatch(/phase2c26b2c2b2dProbes\(authority, b2c1Authority, b2c2b1Json, b2c2b2bAuthority, b2c2b2cAuthority\)/)
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

function taskOf(rank: number, patch: Partial<Phase2C26B2C2B2DTaskInput> = {}): Phase2C26B2C2B2DTaskInput {
  return { taskId: `t00-r${String(rank).padStart(2, '0')}`, executionClass: 'stage1', targetWeaponId: TARGET, contextRank: rank, policy: 'P1', groupIndex: 100 + rank,
    reservationDigest: `d${rank}`, targetEligibleMinCardinality: 1, representativeFixedSetId: `K1:e${rank}`, representativeFixedTargetWeaponIds: [`x${rank}`],
    defaultSearchInputDigest: `s${rank}`, searchInputDigest: `tight${rank}`, extent: { ...TIGHT }, maxCostCohorts: 4, candidateSafetyCap: 1024, ...patch }
}
function delivered(s: Phase2C2CandidateSummary, index: number): Phase2C26B2B2A2DeliveredCandidate {
  return { deliveryIndex: index, stableKey: `k${String(index).padStart(5, '0')}`, orderingKeys: { estimatedOperationCount: s.estimatedOperationCount, estimatedGogmaAdvance: s.estimatedAdvances.gogma,
    estimatedSkillAdvance: s.estimatedAdvances.skill, estimatedNormalAdvance: s.estimatedAdvances.normal, preferredSourceRank: 0 }, comparatorWithPrevious: index === 0 ? null : -1,
    summary: s, reservationCheck: { respects: true, blockedHits: {}, exclusiveHit: [] } }
}
const filler = (n: number, cost: number, from = 0) => Array.from({ length: n }, (_, i) => summary({ sourceOwnedWeaponId: `other-${from + i}`, estimatedOperationCount: cost, estimatedAdvances: { normal: null, gogma: 1, skill: 0 } }))

function capture(task: Phase2C26B2C2B2DTaskInput, summaries: Phase2C2CandidateSummary[], termination: Phase2C26B2C2B2DSearchRecord['termination'], sentinel: Phase2C2CandidateSummary | null = null): Phase2C26B2C2B2DSearchRecord {
  const candidates = summaries.map(delivered)
  const status = termination === 'four_cost_cohorts_drained' || termination === 'candidate_safety_cap' ? 'consumer_stop' : termination
  const costs = [...new Set(summaries.map(s => s.estimatedOperationCount))]
  return { targetWeaponId: task.targetWeaponId, contextRank: task.contextRank, groupIndex: task.groupIndex, reservationDigest: task.reservationDigest, targetEligibleMinCardinality: task.targetEligibleMinCardinality,
    representativeFixedSetId: task.representativeFixedSetId, representativeFixedTargetWeaponIds: [...task.representativeFixedTargetWeaponIds], defaultSearchInputDigest: task.defaultSearchInputDigest,
    searchInputDigest: task.searchInputDigest, extent: { ...task.extent }, excludedRouteKeys: ['current'], preferredOwnedWeaponId: null, maxCostCohorts: 4, candidateSafetyCap: 1024, status,
    summary: { deliveredCandidates: candidates.length + (sentinel ? 1 : 0), excludedCandidates: 0, exhausted: status === 'exhausted', stoppedByExtent: status === 'stopped_by_extent', stoppedByConsumer: status === 'consumer_stop' },
    candidates, nextCostSentinel: sentinel ? delivered(sentinel, candidates.length) : null, termination, captureComplete: termination !== 'candidate_safety_cap', safetyCapHit: termination === 'candidate_safety_cap',
    capturedCosts: costs, distinctCostCohorts: costs.length, nonmonotonicIndexes: [], costReadIssues: [], elapsedMs: 1 }
}
function runOf(task: Phase2C26B2C2B2DTaskInput, record: Phase2C26B2C2B2DSearchRecord | null, process: 'completed' | 'timeout' | 'out_of_memory' | 'process_failure' = 'completed'): Phase2C26B2C2B2DRun {
  const child = record === null ? null : { status: 'searched' as const, taskId: task.taskId, search: record }
  return { taskId: task.taskId, task, outcome: phase2c26b2c2b2dTaskOutcome(task.taskId, process, process === 'completed' ? child : null),
    process: { outcome: process, wallMs: process === 'timeout' ? 600_000 : 10, timedOut: process === 'timeout', budgetMs: 600_000 }, childWallMs: 9, scheduleMs: 1, yields: 3,
    memory: process === 'completed' ? { sampledMaxHeapUsedBytes: 100, sampledMaxRssBytes: 200, maxRssKiB: 1 } : null, lastIpcMemory: { maxHeapUsedBytes: 50, maxRssBytes: 300 },
    record: process === 'completed' ? child : null }
}
function withMatchAt(task: Phase2C26B2C2B2DTaskInput, at: number) {
  return capture(task, [summary({ estimatedOperationCount: 1, sourceOwnedWeaponId: 'cheap' }), ...filler(Math.max(at - 1, 0), 2), { ...MATCH }, ...filler(3, 3, 100), ...filler(2, 4, 200)],
    'four_cost_cohorts_drained', summary({ estimatedOperationCount: 5, sourceOwnedWeaponId: 'dear' }))
}
const miss = (task: Phase2C26B2C2B2DTaskInput) => capture(task, [summary({ estimatedOperationCount: 1, sourceOwnedWeaponId: 'cheap' }), ...filler(5, 2)], 'exhausted')
const derivationOf = (rank: number, extent = TIGHT): Phase2C26B2C2B2DProbeDerivation => ({ targetWeaponId: TARGET, b2c1FirstCompatibleRank: rank, b2c2b1P1FirstCompatibleRank: rank,
  b2c2b2cRecomputedFirstCompatibleRank: rank, required: { normal: null, gogma: 17, skill: 446 }, tightExtent: { ...extent }, commonL2Extent: { ...L2 },
  extentDeltaFromCommonL2: { maxNormalAdvance: extent.maxNormalAdvance - 128, maxGogmaAdvance: 0, maxSkillAdvance: extent.maxSkillAdvance - 1500 },
  extentRatioToCommonL2: { maxNormalAdvance: extent.maxNormalAdvance / 128, maxGogmaAdvance: 1, maxSkillAdvance: extent.maxSkillAdvance / 1500 }, strictlySmallerStreams: ['maxNormalAdvance', 'maxSkillAdvance'] })
function baselineRow(task: Phase2C26B2C2B2DTaskInput, patch: Partial<Phase2C26B2C2B2DB2C2B2CTaskRow> = {}): Phase2C26B2C2B2DB2C2B2CTaskRow {
  return { taskId: task.taskId, targetWeaponId: task.targetWeaponId, contextRank: task.contextRank, groupIndex: task.groupIndex, reservationDigest: task.reservationDigest,
    targetEligibleMinCardinality: task.targetEligibleMinCardinality, representativeFixedSetId: task.representativeFixedSetId, representativeFixedTargetWeaponIds: [...task.representativeFixedTargetWeaponIds],
    defaultSearchInputDigest: task.defaultSearchInputDigest, searchInputDigest: `l2-${task.contextRank}`, excludedRouteKeySha256: null, process: 'out_of_memory', record: null, wallMs: 476_000,
    searchElapsedMs: null, peakHeapBytes: 8_300_000_000, peakRssBytes: 8_900_000_000, yields: 5_000_000, termination: null, candidateCount: null, deliveredCandidates: null, captureComplete: null,
    safetyCapHit: null, capturedCosts: [], compatible: true, coverage: null, firstExactIndex: null, firstExactCost: null, hit: { C8: false, C32: false, C4C: false }, ...patch }
}
const reachOf = (groups: number[], first: number | null) => [{ targetWeaponId: TARGET, compatibleGroupIndexes: groups, p1FirstCompatibleRank: first, inconsistencies: [] }]
const authorityWith = (rows: Phase2C26B2C2B2DB2C2B2CTaskRow[]) => ({ ...authorities().b2c2b2c, taskRows: rows })
const analyze = (task: Phase2C26B2C2B2DTaskInput, run: Phase2C26B2C2B2DRun | null, opts: { groups?: number[]; first?: number; baseline?: Phase2C26B2C2B2DB2C2B2CTaskRow[]; rank?: number } = {}) =>
  runPhase2C26B2C2B2DAnalysis({ derivations: [derivationOf(opts.rank ?? task.contextRank)], tasks: [task], runs: run === null ? [] : [run], reach: reachOf(opts.groups ?? [task.groupIndex], opts.first ?? task.contextRank),
    excludedRouteKeySha256: new Map([[task.taskId, null]]), b2c2b2c: authorityWith(opts.baseline ?? [baselineRow(task)]), oracle: ORACLE, smoke: run === null, interruption: null })

describe('Phase 2-C2.6-B2-C2B2D analysis', () => {
  it('validates the raw capture at the Target\'s tight extent: another extent, the common L2 extent, a digest drift, a capture drift and nonmonotonic costs fail closed', () => {
    const task = taskOf(17)
    const expectedExtents = new Map([[TARGET, TIGHT]])
    const check = (record: Phase2C26B2C2B2DSearchRecord, t = task) => validatePhase2C26B2C2B2DRaw({ tasks: [t], runs: [runOf(t, record)], smoke: false, expectedExtents })
    expect(check(withMatchAt(task, 5))).toEqual([])
    const mutate = (patch: (r: Phase2C26B2C2B2DSearchRecord) => void) => { const r = withMatchAt(task, 5); patch(r); return check(r).join('\n') }
    expect(mutate(r => { r.candidates[4]!.orderingKeys.estimatedOperationCount = 1; r.candidates[4]!.summary = { ...r.candidates[4]!.summary, estimatedOperationCount: 1 } })).toMatch(/semantic_failure: .*nonmonotonic/)
    expect(mutate(r => { r.extent = { ...L2 } })).toMatch(/not the task's tight extent/)
    expect(mutate(r => { r.extent = { ...TIGHT, maxSkillAdvance: 447 } })).toMatch(/not the task's tight extent/)
    expect(mutate(r => { r.searchInputDigest = 'x' })).toMatch(/not the task's context/)
    expect(mutate(r => { r.candidateSafetyCap = 32 })).toMatch(/capture rule drift/)
    expect(mutate(r => { r.capturedCosts = [1, 2, 3] })).toMatch(/cohorts drift/)
    const raw = (t: Phase2C26B2C2B2DTaskInput, e = expectedExtents) => validatePhase2C26B2C2B2DRaw({ tasks: [t], runs: [], smoke: true, expectedExtents: e }).join()
    expect(raw(taskOf(17, { extent: { ...L2 } }))).toMatch(/outside the bounds/)
    expect(raw(taskOf(17, { extent: { ...TIGHT, maxSkillAdvance: 500 } }))).toMatch(/not the Target's tight extent/)
    expect(raw(task, new Map())).toMatch(/no expected tight extent/)
    expect(validatePhase2C26B2C2B2DRaw({ tasks: [task, taskOf(18)], runs: [], smoke: true, expectedExtents }).join()).toMatch(/more than one task/)
  })

  it('records the exact Route of the one context, pairs it with B2-C2B2C\'s same Target and rank, and reports the resource deltas', () => {
    const task = taskOf(17)
    const result = analyze(task, runOf(task, withMatchAt(task, 3)))
    expect(result.invalidReasons).toEqual([])
    expect(result.rows[0]).toMatchObject({ selectedRank: 17, compatible: true, measured: true, recovery: 'C8', firstExactIndex: 3, firstExactCost: 2, missClass: null, hit: { C8: true, C32: true, C4C: true } })
    expect(result.aggregates.exactTargets).toEqual({ C8: 1, C32: 1, C4C: 1 })
    expect(result.paired[0]).toMatchObject({ b2c2b2cTaskId: 't00-r17', outcomeTransition: 'out_of_memory -> completed', identity: { matches: true, issues: [] },
      delta: { wallMs: 10 - 476_000, peakHeapBytes: 100 - 8_300_000_000, extent: { maxNormalAdvance: -124, maxGogmaAdvance: 0, maxSkillAdvance: -1054 } } })
    expect(result.paired[0]!.b2c2b2c).toMatchObject({ process: 'out_of_memory', searchElapsedMs: null, candidateCount: null })
    expect(result.paired[0]!.delta.searchElapsedMs).toBeNull()
    expect(result.decisionInput).toMatchObject({ tasks: 1, unmeasuredTasks: 0 })
  })

  it('fails closed on a paired identity drift (group / reservation / representative / default digest / excluded Route), an unchanged digest, a missing counterpart, an incompatible or non-first-compatible context', () => {
    const task = taskOf(17)
    const run = runOf(task, withMatchAt(task, 3))
    const reasons = (opts: Parameters<typeof analyze>[2]) => analyze(task, run, opts).invalidReasons.join('\n')
    for (const patch of [{ groupIndex: 1 }, { reservationDigest: 'other' }, { representativeFixedSetId: 'K1:other' }, { representativeFixedTargetWeaponIds: ['y'] }, { defaultSearchInputDigest: 'other' },
      { targetEligibleMinCardinality: 2 }]) expect(reasons({ baseline: [baselineRow(task, patch)] })).toMatch(/paired: .* differs from B2-C2B2C/)
    expect(reasons({ baseline: [baselineRow(task, { searchInputDigest: task.searchInputDigest })] })).toMatch(/equals B2-C2B2C's/)
    expect(reasons({ baseline: [] })).toMatch(/0 B2-C2B2C tasks hold this Target and rank/)
    expect(reasons({ baseline: [baselineRow(task, { taskId: 't01-r17' })] })).toMatch(/B2-C2B2C task ID is t01-r17/)
    expect(reasons({ groups: [] })).toMatch(/not reservation-compatible/)
    expect(reasons({ first: 11 })).toMatch(/recomputed P1 first compatible rank 11/)
    expect(reasons({ rank: 11 })).toMatch(/task rank is not the B2-C1 first compatible rank/)
    // The excluded current Route is compared whenever both sides recorded it.
    const pair = (sha: string | null, theirs: string | null) => phase2c26b2c2b2dPairedRow(task, run, analyze(task, run).contexts[0]!, sha, [baselineRow(task, { excludedRouteKeySha256: theirs })])
    expect(pair('a', 'a').identity).toEqual({ matches: true, issues: [], excludedRouteKeyCompared: true })
    expect(pair('a', 'b').identity.issues.join()).toMatch(/excluded current Route differs/)
    expect(pair('a', null).identity).toMatchObject({ matches: true, excludedRouteKeyCompared: false })
  })

  it('never reads a timeout / OOM as Candidate 0, and classifies a completed miss (capture insufficient / safety cap / non-delivery)', () => {
    const task = taskOf(11)
    const timeout = analyze(task, runOf(task, null, 'timeout'), { baseline: [baselineRow(task, { process: 'timeout', wallMs: 600_300 })] })
    expect(timeout.invalidReasons).toEqual([])
    expect(timeout.rows[0]).toMatchObject({ measured: false, process: 'timeout', candidateCount: null, coverage: null, recovery: 'none', missClass: 'unmeasured' })
    expect(timeout.paired[0]).toMatchObject({ outcomeTransition: 'timeout -> timeout' })
    expect(timeout.aggregates.measurementCompleteness).toMatchObject({ status: 'incomplete', unmeasured: 1, breakdown: { timeout: 1 } })
    expect(phase2c26b2c2b2dDecision({ invalidReasons: [], tasks: 4, targets: 4, unmeasuredTasks: timeout.decisionInput.unmeasuredTasks, exactTargets: { C8: 3, C32: 3, C4C: 3 } }).case).toBe('B2C2B2D_INCOMPLETE')
    const oom = analyze(task, runOf(task, null, 'out_of_memory'))
    expect(oom.rows[0]).toMatchObject({ process: 'out_of_memory', missClass: 'unmeasured', candidateCount: null })
    expect(analyze(task, runOf(task, miss(task))).rows[0]).toMatchObject({ measured: true, recovery: 'none', missClass: 'compatible_non_delivery' })
    const capped = capture(task, filler(PHASE2C26B2C2B2D_CANDIDATE_SAFETY_CAP, 2), 'candidate_safety_cap')
    expect(analyze(task, runOf(task, capped)).rows[0]).toMatchObject({ recovery: 'none', missClass: 'safety_cap_unresolved', safetyCapHit: true })
  })

  it('decides ALL_C8 / ALL_C32 / ALL_C4C / PARTIAL / INCOMPLETE / INVALID for 4 Targets x 1 context, as a diagnostic decision', () => {
    const d = (C8: number, C32: number, C4C: number, extra: Partial<Parameters<typeof phase2c26b2c2b2dDecision>[0]> = {}) =>
      phase2c26b2c2b2dDecision({ invalidReasons: [], tasks: 4, targets: 4, unmeasuredTasks: 0, exactTargets: { C8, C32, C4C }, ...extra }).case
    expect(d(4, 4, 4)).toBe('B2C2B2D_ALL_C8')
    expect(d(3, 4, 4)).toBe('B2C2B2D_ALL_C32')
    expect(d(2, 3, 4)).toBe('B2C2B2D_ALL_C4C')
    expect(d(1, 2, 3)).toBe('B2C2B2D_PARTIAL')
    expect(d(0, 0, 0)).toBe('B2C2B2D_PARTIAL')
    expect(d(4, 4, 4, { unmeasuredTasks: 1 })).toBe('B2C2B2D_INCOMPLETE')
    expect(d(4, 4, 4, { invalidReasons: ['x'] })).toBe('B2C2B2D_INVALID')
    expect(d(4, 4, 4, { tasks: 128 })).toBe('B2C2B2D_INVALID')
    expect(d(3, 3, 3, { targets: 3 })).toBe('B2C2B2D_INVALID')
    expect(() => d(4, 3, 4)).toThrow()
    expect(PHASE2C26B2C2B2D_DECISION_RULE.order.map(line => line.split(':')[0])).toEqual(['B2C2B2D_INVALID', 'B2C2B2D_INCOMPLETE', 'B2C2B2D_ALL_C8', 'B2C2B2D_ALL_C32', 'B2C2B2D_ALL_C4C', 'B2C2B2D_PARTIAL'])
    expect(PHASE2C26B2C2B2D_DECISION_RULE.scope).toMatch(/never a scheduler decision/)
    expect(PHASE2C26B2C2B2D_DECISION_RULE.order[1]).toMatch(/never Candidate 0/)
    expect(PHASE2C26B2C2B2D_DECISION_RULE.interpretation).toMatch(/never a decision input/)
  })

  it('interprets the two B2-C2B2C-unrecovered Targets as A (both recovered), B (still unmeasured), C (completed without exact) or B_AND_C', () => {
    const row = (id: string, measured: boolean, recovery: Phase2C26B2C2B2DTargetRow['recovery'], process = measured ? 'completed' : 'timeout') => ({ targetWeaponId: id, measured, recovery, process }) as Phase2C26B2C2B2DTargetRow
    const interpret = (rows: Phase2C26B2C2B2DTargetRow[], invalid = false) => phase2c26b2c2b2dInterpretation({ invalid, previouslyUnrecovered: ['u1', 'u2'], previouslyRecovered: ['r1'], rows: [...rows, row('r1', true, 'C8')] })
    expect(interpret([row('u1', true, 'C4C'), row('u2', true, 'C8')])).toMatchObject({ case: 'A', recoveredOf: { recovered: 2, of: 2 }, previouslyRecoveredStillRecovered: true })
    // A partly recovered set is B: A needs every previously unrecovered Target.
    expect(interpret([row('u1', true, 'C4C'), row('u2', false, 'none')]).case).toBe('B')
    expect(interpret([row('u1', false, 'none'), row('u2', false, 'none')]).case).toBe('B')
    expect(interpret([row('u1', true, 'none'), row('u2', true, 'C4C')]).case).toBe('C')
    expect(interpret([row('u1', true, 'none'), row('u2', false, 'none')]).case).toBe('B_AND_C')
    expect(interpret([row('u1', true, 'C4C'), row('u2', true, 'C4C')], true).case).toBeNull()
    // A task that never ran (interruption / smoke) leaves the interpretation undetermined, never B.
    expect(interpret([row('u1', true, 'C4C'), row('u2', false, 'none', 'not_run')])).toMatchObject({ case: null, previouslyUnrecovered: [{ result: 'recovered' }, { result: 'not_run' }] })
    expect(interpret([row('u1', false, 'none', 'out_of_memory'), row('u2', true, 'C4C')]).case).toBe('B')
    expect(phase2c26b2c2b2dInterpretation({ invalid: false, previouslyUnrecovered: ['u1'], previouslyRecovered: ['r1'], rows: [row('u1', true, 'C4C'), row('r1', true, 'none')] }).previouslyRecoveredStillRecovered).toBe(false)
  })

  it('states E1 11 / 11 only under oracle-guided diagnostic conditions and only when L1 7 / 7 and L2 4 / 4, keeping the common ladder at 9 / 11', () => {
    const { b2c2b1, b2c1, b2c2b2b, b2c2b2c } = authorities()
    const split = phase2c26b2c2b2dPopulation(b2c2b1, b2c1, b2c2b1Json, b2c2b2b, b2c2b2c).split
    const rowsWith = (recovered: number) => split.l2.map((id, i) => ({ targetWeaponId: id, hit: { C8: i < recovered, C32: i < recovered, C4C: i < recovered } }) as Phase2C26B2C2B2DTargetRow)
    const aggregate = (recovered: number, l2 = split.l2) => phase2c26b2c2b2dE1Aggregate({ e1: split.e1, l1: split.l1, l2, b2c2b2b, b2c2b2c, rows: rowsWith(recovered), decision: 'B2C2B2D_ALL_C8', evidenceGrade: 'formal' })
    const full = aggregate(4)
    expect(full.issues).toEqual([])
    expect(full.commonLadder).toMatchObject({ total: { C4C: { recovered: 9, of: 11 }, C8: { recovered: 7, of: 11 } }, statement: null })
    expect(full.diagnostic).toMatchObject({ allRecovered: true, total: { C4C: { recovered: 11, of: 11 }, C8: { recovered: 10, of: 11 } } })
    expect(full.diagnostic.statement).toMatch(/^E1 11 \/ 11: .*at least under oracle-guided diagnostic conditions/)
    expect(full.diagnostic.statement).not.toMatch(/registered (common )?ladder/)
    expect(full.diagnostic.statementScope).toMatch(/not "11 \/ 11 under the registered common L1 \/ L2 ladder"/)
    expect(full.limitations).toEqual([...PHASE2C26B2C2B2D_E1_DIAGNOSTIC_LIMITATIONS])
    expect(full.limitations.join(' ')).toMatch(/stays C4C 9 \/ 11/)
    expect(full.limitations.join(' ')).toMatch(/Production scheduler/)
    expect(aggregate(3).diagnostic).toMatchObject({ allRecovered: false, statement: null, total: { C4C: { recovered: 10, of: 11 } } })
    expect(aggregate(4, split.l2.slice(1)).diagnostic.statement).toBeNull()
  })
})

// ---------------------------------------------------------------- isolation and provenance

describe('Phase 2-C2.6-B2-C2B2D isolation and provenance', () => {
  it('is never imported by Production and hard-codes no Target, Entry, OwnedWeapon, reservation, rank or extent value of the population', () => {
    const production = import.meta.glob(['../domain/**/*.ts', '../services/**/*.ts', '../workers/**/*.ts', '../pages/**/*.tsx', '../components/**/*.tsx', '../db/**/*.ts', '!../**/*.test.ts', '!../**/*.test.tsx'],
      { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    expect(Object.keys(production).length).toBeGreaterThan(50)
    expect(Object.entries(production).filter(([, source]) => /plannerGlobalPhase2C26B2C2B2D/.test(source)).map(([path]) => path)).toEqual([])
    for (const source of [searchSource, targetsSource, analysisSource, prepareSource, runnerSource, analyzerSource, reconstructSource]) {
      expect(source).not.toMatch(/\bc\d+-p\d+\b|fnv1a32[-:][0-9a-f]{8}|[0-9a-f]{8}-[0-9a-f]{4}-|build-list\.|070a1222|188571a7|a367c177|d453ca34|02876df4|05e6b206/)
      // No tight extent value of the 4 Targets is written down (they are derived).
      expect(source).not.toMatch(/\b(126|446|1083|547|450)\b/)
    }
    for (const source of [searchSource, targetsSource, analysisSource]) expect(source).not.toMatch(/node:fs|readFile|import\.meta\.glob/)
  })

  it('keeps the oracle, its manifest, every earlier RESULT and the required extent out of the Search side; the Search child never learns what counts as success', () => {
    for (const source of [searchSource, runnerSource]) {
      expect(source).not.toMatch(/ORACLE_[1]657|1657|--oracle|--manifest|--b2c2b1-result|--b2c1-result|--b2b1-result|--b2c2b2b-result|--b2c2b2c-result|gogmaUsage|plannerGlobal[O]racle|_RESULT|phase2c2OracleCoverage|Analysis'|Targets'|phase2c26b2aReachability|phase2c26b2aRouteExtent|phase2c26b2c2b1Covers|materialization\.estimated|expectedStableKey|expectedCandidateIndex|expectedOperationCost/)
    }
    expect(searchSource).not.toMatch(/plannerGlobalPhase2C26B2C2B2DTargets|plannerGlobalPhase2C26B2C2B2CTargets|plannerGlobalPhase2C26B2C2B2BTargets|plannerGlobalPhase2C26B2C2B2ATargets|plannerGlobalPhase2C26B2C2B1Analysis|plannerGlobalPhase2C26B2C1Analysis|Analysis'/)
    expect(runnerSource).toMatch(/--probes/)
    expect(runnerSource).toMatch(/\.\.\.c2b2d\.PHASE2C26B2C2B2D_PROVENANCE_FLAGS/)
    expect(runnerSource).toMatch(/c2b2d\.runPhase2C26B2C2B2DTask\(input, schedule, task, engine/)
    expect(runnerSource).toMatch(/c2b2d\.buildPhase2C26B2C2B2DTasks\(schedule, task\.probes\)/)
    expect(prepareSource).toMatch(/--b2c2b1-result/)
    expect(prepareSource).toMatch(/--b2c2b2c-result/)
    expect(prepareSource).not.toMatch(/--oracle|--manifest|visitPlannerAlternativeCandidates/)
    expect(analyzerSource).toMatch(/--oracle/)
    expect(analysisSource).toMatch(/phase2c26b2c2b2aCompareContext\(/)
    expect(targetsSource).toMatch(/phase2c26b2c2b1Covers\(route\.required, tight\)/)
  })

  it('captures through the unchanged Production Search and B2-C2A capture, with no early stop, retry or fallback', () => {
    // The only visitor is the Search body (B2-C2B2A's), holding exactly the two 'stop' rules (sentinel, safety cap).
    expect(searchSource.match(/'stop'/g)).toHaveLength(2)
    expect(searchSource.match(/await visitPlannerAlternativeCandidates\(/g)).toHaveLength(1)
    expect(searchSource).toMatch(/createPhase2C26B2C2ACapture\(capture\.maxCostCohorts, capture\.candidateSafetyCap\)/)
    expect(runnerSource).toMatch(/const stage1 = await pool\(stage1Tasks,/)
    expect(runnerSource).not.toMatch(/timeout_fallback|fallbackTasks|FALLBACK|retryTasks/)
    for (const source of [searchSource, analysisSource, runnerSource, analyzerSource]) {
      expect(source).not.toMatch(/runPreparedPlannerAlternativeKernel|preparePlannerAlternativeKernel|createProductionPlan|runPhase2C2Kernel|runPhase2C2Baseline|runPlannerDeterministicSchedule|createPlannerAlternativeWhatIfComparison|searchCandidates\(/)
    }
    for (const source of [analysisSource, analyzerSource, targetsSource, prepareSource]) expect(source).not.toMatch(/visitPlannerAlternativeCandidates|runPhase2C26B2C2B2DSearch|runPhase2C26B2C2B2DTask\(/)
  })
})
