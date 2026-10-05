import { beforeEach, describe, expect, it, vi } from 'vitest'
import rawB2C2B1 from '../../docs/PLANNER_GLOBAL_PHASE2C26B2C2B1_RESULT.json?raw'
import rawB2C1 from '../../docs/PLANNER_GLOBAL_PHASE2C26B2C1_RESULT.json?raw'
import rawB2C2B2B from '../../docs/PLANNER_GLOBAL_PHASE2C26B2C2B2B_RESULT.json?raw'
import rawB2C2B2C from '../../docs/PLANNER_GLOBAL_PHASE2C26B2C2B2C_RESULT.json?raw'
import rawB2C2B2D from '../../docs/PLANNER_GLOBAL_PHASE2C26B2C2B2D_RESULT.json?raw'
import rawResult from '../../docs/PLANNER_GLOBAL_PHASE2C26B2C2B2E_RESULT.json?raw'
import type { TargetWeapon } from '../domain/models/publicTypes'
import type { PlannerAlternativeCandidate, PlannerAlternativeSearchExecution } from '../domain/search'
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
import type { Phase2C26B2B2A2DeliveredCandidate } from './plannerGlobalPhase2C26B2B2A2'
import { derivePhase2C26B2C1Schedule } from './plannerGlobalPhase2C26B2C1'
import { parsePhase2C26B2C2AB2C1Authority, PHASE2C26B2C2A_REGISTERED_B2C1 } from './plannerGlobalPhase2C26B2C2ATargets'
import { parsePhase2C26B2C2B2AB2C2B1Authority, PHASE2C26B2C2B2A_REGISTERED_B2C2B1 } from './plannerGlobalPhase2C26B2C2B2ATargets'
import { parsePhase2C26B2C2B2CB2C2B2BAuthority, PHASE2C26B2C2B2C_REGISTERED_B2C2B2B } from './plannerGlobalPhase2C26B2C2B2CTargets'
import {
  buildPhase2C26B2C2B2DTasks,
  phase2c26b2c2b2dTaskOutcome,
  runPhase2C26B2C2B2DSearch,
  runPhase2C26B2C2B2DTask,
  PHASE2C26B2C2B2D_CANDIDATE_SAFETY_CAP,
  PHASE2C26B2C2B2D_CAPTURE_PREFIXES,
  PHASE2C26B2C2B2D_CONTEXT_SELECTION,
  PHASE2C26B2C2B2D_EXTENT_RULE,
  PHASE2C26B2C2B2D_MAX_COST_COHORTS,
  PHASE2C26B2C2B2D_MEMORY_SAMPLE_INTERVAL_MS,
  PHASE2C26B2C2B2D_NODE_YIELD,
  PHASE2C26B2C2B2D_PROVENANCE_FLAGS,
  PHASE2C26B2C2B2D_STAGE1,
  PHASE2C26B2C2B2D_START_ATTESTATION_PHASE,
  type Phase2C26B2C2B2DSearchRecord,
} from './plannerGlobalPhase2C26B2C2B2D'
import { phase2c26b2c2b2dRederiveBaselineContext, type Phase2C26B2C2B2DBaselineRederivation } from './plannerGlobalPhase2C26B2C2B2DAnalysis'
import { parsePhase2C26B2C2B2DB2C2B2CAuthority, PHASE2C26B2C2B2D_REGISTERED_B2C2B2C } from './plannerGlobalPhase2C26B2C2B2DTargets'
import {
  buildPhase2C26B2C2B2ETasks,
  parsePhase2C26B2C2B2EProbeManifest,
  phase2c26b2c2b2eRegisteredConditions,
  phase2c26b2c2b2eStartAttestationBody,
  phase2c26b2c2b2eTaskOutcome,
  runPhase2C26B2C2B2ETask,
  verifyPhase2C26B2C2B2EStartAttestation,
  PHASE2C26B2C2B2E_BUDGET_MS,
  PHASE2C26B2C2B2E_B2C2B2D_STAGE1,
  PHASE2C26B2C2B2E_CANDIDATE_SAFETY_CAP,
  PHASE2C26B2C2B2E_CAPTURE_PREFIXES,
  PHASE2C26B2C2B2E_CHANGED_STAGE1_FIELDS,
  PHASE2C26B2C2B2E_CHILD_HEAP_MB,
  PHASE2C26B2C2B2E_CONTEXT_SELECTION,
  PHASE2C26B2C2B2E_CONTEXTS_PER_TARGET,
  PHASE2C26B2C2B2E_EXPECTED_TASKS,
  PHASE2C26B2C2B2E_EXTENT_RULE,
  PHASE2C26B2C2B2E_MAX_COST_COHORTS,
  PHASE2C26B2C2B2E_MEMORY_SAMPLE_INTERVAL_MS,
  PHASE2C26B2C2B2E_NODE_YIELD,
  PHASE2C26B2C2B2E_NOT_RUN,
  PHASE2C26B2C2B2E_PROBE_SOURCE,
  PHASE2C26B2C2B2E_PROVENANCE_FLAGS,
  PHASE2C26B2C2B2E_STAGE1,
  PHASE2C26B2C2B2E_START_ATTESTATION_FILE,
  PHASE2C26B2C2B2E_START_ATTESTATION_PHASE,
  PHASE2C26B2C2B2E_TARGETS,
  type Phase2C26B2C2B2EAttestationExpectation,
  type Phase2C26B2C2B2EProbe,
  type Phase2C26B2C2B2ETaskInput,
} from './plannerGlobalPhase2C26B2C2B2E'
import searchSource from './plannerGlobalPhase2C26B2C2B2E.ts?raw'
import {
  parsePhase2C26B2C2B2EB2C2B2DAuthority,
  phase2c26b2c2b2ePopulation,
  phase2c26b2c2b2eProbeManifest,
  phase2c26b2c2b2eProbes,
  PHASE2C26B2C2B2E_REGISTERED_B2C2B2D,
  type Phase2C26B2C2B2EB2C2B2DAuthority,
  type Phase2C26B2C2B2EB2C2B2DTaskRow,
  type Phase2C26B2C2B2EProbeDerivation,
} from './plannerGlobalPhase2C26B2C2B2ETargets'
import targetsSource from './plannerGlobalPhase2C26B2C2B2ETargets.ts?raw'
import {
  phase2c26b2c2b2eDecision,
  phase2c26b2c2b2eE1Aggregate,
  phase2c26b2c2b2eEvidenceGrade,
  phase2c26b2c2b2eLaunchProvenance,
  phase2c26b2c2b2eNextBranch,
  phase2c26b2c2b2ePairedRow,
  phase2c26b2c2b2eTrajectory,
  runPhase2C26B2C2B2EAnalysis,
  validatePhase2C26B2C2B2ERaw,
  PHASE2C26B2C2B2E_DECISION_RULE,
  PHASE2C26B2C2B2E_E1_DIAGNOSTIC_LIMITATIONS,
  type Phase2C26B2C2B2EMemorySample,
  type Phase2C26B2C2B2ERun,
  type Phase2C26B2C2B2ETargetRow,
} from './plannerGlobalPhase2C26B2C2B2EAnalysis'
import analysisSource from './plannerGlobalPhase2C26B2C2B2EAnalysis.ts?raw'
import prepareSource from '../../scripts/prepare-planner-global-phase2c26b2c2b2e-probes.mjs?raw'
import runnerSource from '../../scripts/run-planner-global-phase2c26b2c2b2e.mjs?raw'
import analyzerSource from '../../scripts/analyze-planner-global-phase2c26b2c2b2e.mjs?raw'
import reconstructSource from '../../scripts/reconstruct-planner-global-phase2c26b2c2b2e-partial-raw.mjs?raw'

/*
 * Issue #154 Phase 2-C2.6-B2-C2B2E: the 2 B2-C2B2D Targets left unmeasured and unrecovered, searched again in B2-C2B2D's exact Search
 * input with only the execution budget extended (60 minutes, 12,288 MB). The synthetic worlds below are invented for the tests; the
 * committed B2-C2B1 / B2-C1 / B2-C2B2B / B2-C2B2C / B2-C2B2D RESULTs are read only to check the authorities. The oracle modules are
 * never imported here.
 */

/** Every Search input, in call order; `script` replays one real Candidate with the scripted operation costs (as in B2-C2B2D). */
const searchCalls = vi.hoisted(() => ({ inputs: [] as unknown[], script: null as number[] | null }))
vi.mock('../domain/search/alternative/plannerAlternativeSearch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../domain/search/alternative/plannerAlternativeSearch')>()
  return {
    ...actual,
    visitPlannerAlternativeCandidates: async (...args: Parameters<typeof actual.visitPlannerAlternativeCandidates>): Promise<PlannerAlternativeSearchExecution> => {
      const [input, engine, onCandidate, options] = args
      searchCalls.inputs.push(structuredClone(input))
      const script = searchCalls.script
      if (script === null) return actual.visitPlannerAlternativeCandidates(input, engine, onCandidate, options)
      let first: PlannerAlternativeCandidate | null = null
      await actual.visitPlannerAlternativeCandidates(input, engine, candidate => { first = candidate; return 'stop' }, options)
      if (first === null) throw new Error('The script world delivers no Candidate.')
      const base: PlannerAlternativeCandidate = first
      for (let index = 0; index < script.length; index += 1) {
        if (await onCandidate({ ...base, estimatedOperationCount: script[index]! }) === 'stop') {
          return { targetWeaponId: input.targetWeaponId, summary: { deliveredCandidates: index + 1, excludedCandidates: 0, exhausted: false, stoppedByExtent: false }, stoppedByConsumer: true, skippedExcludedRouteKeys: [] }
        }
      }
      return { targetWeaponId: input.targetWeaponId, summary: { deliveredCandidates: script.length, excludedCandidates: 0, exhausted: true, stoppedByExtent: false }, stoppedByConsumer: false, skippedExcludedRouteKeys: [] }
    },
  }
})
beforeEach(() => { searchCalls.inputs = []; searchCalls.script = null })

const sha = {
  b2c2b1: PHASE2C26B2C2B2A_REGISTERED_B2C2B1.resultSha256,
  b2c1: PHASE2C26B2C2A_REGISTERED_B2C1.resultSha256,
  b2b1: JSON.parse(rawB2C2B1).provenance.b2b1ResultSha256 as string,
  b2c2b2b: PHASE2C26B2C2B2C_REGISTERED_B2C2B2B.resultSha256,
  b2c2b2c: PHASE2C26B2C2B2D_REGISTERED_B2C2B2C.resultSha256,
  b2c2b2d: PHASE2C26B2C2B2E_REGISTERED_B2C2B2D.resultSha256,
}
const b2c2b1Json = JSON.parse(rawB2C2B1)
const b2c2b2dJson = JSON.parse(rawB2C2B2D)
const exportSha = b2c2b1Json.provenance.exportSha256 as string
const L2 = { maxNormalAdvance: 128, maxGogmaAdvance: 235, maxSkillAdvance: 1500 }
const d2Expected = { b2c2b1ResultSha256: sha.b2c2b1, b2c1ResultSha256: sha.b2c1, b2b1ResultSha256: sha.b2b1, b2c2b2bResultSha256: sha.b2c2b2b, b2c2b2cResultSha256: sha.b2c2b2c, exportSha256: exportSha }
const authorities = () => ({ b2c2b1: parsePhase2C26B2C2B2AB2C2B1Authority(b2c2b1Json, sha.b2c2b1).authority!, b2c1: parsePhase2C26B2C2AB2C1Authority(JSON.parse(rawB2C1), sha.b2c1).authority!,
  b2c2b2b: parsePhase2C26B2C2B2CB2C2B2BAuthority(JSON.parse(rawB2C2B2B), sha.b2c2b2b, { b2c2b1ResultSha256: sha.b2c2b1, exportSha256: exportSha }).authority!,
  b2c2b2c: parsePhase2C26B2C2B2DB2C2B2CAuthority(JSON.parse(rawB2C2B2C), sha.b2c2b2c, { b2c2b1ResultSha256: sha.b2c2b1, b2c1ResultSha256: sha.b2c1, b2c2b2bResultSha256: sha.b2c2b2b, exportSha256: exportSha }).authority!,
  b2c2b2d: parsePhase2C26B2C2B2EB2C2B2DAuthority(b2c2b2dJson, sha.b2c2b2d, d2Expected).authority! })
type Json = Record<string, unknown>
const d2With = (patch: (j: Json & { targets: Json[]; taskRows: Json[]; probes: Json[] }) => void) => {
  const copy = structuredClone(b2c2b2dJson)
  patch(copy)
  return parsePhase2C26B2C2B2EB2C2B2DAuthority(copy, sha.b2c2b2d, d2Expected)
}

// ---------------------------------------------------------------- population, probes and the B2-C2B2D authority

describe('Phase 2-C2.6-B2-C2B2E population, probes and probe manifest', () => {
  it('reads the committed B2-C2B2D RESULT as the formal paired baseline only, failing closed on another SHA-256, case, Stage 1, Target row or task row', () => {
    const parsed = parsePhase2C26B2C2B2EB2C2B2DAuthority(b2c2b2dJson, sha.b2c2b2d, d2Expected)
    expect(parsed.issues).toEqual([])
    expect(parsed.authority).toMatchObject({ decisionCase: 'B2C2B2D_INCOMPLETE', evidenceGrade: 'formal', measuredHead: PHASE2C26B2C2B2E_REGISTERED_B2C2B2D.measuredHead, stage1: PHASE2C26B2C2B2D_STAGE1 })
    expect(parsed.authority!.targets).toHaveLength(4)
    expect(parsed.authority!.taskRows).toHaveLength(4)
    expect(parsed.authority!.exactTargets).toEqual(b2c2b2dJson.aggregates.exactTargets)
    expect(parsePhase2C26B2C2B2EB2C2B2DAuthority(b2c2b2dJson, '0'.repeat(64), d2Expected).valid).toBe(false)
    expect(parsePhase2C26B2C2B2EB2C2B2DAuthority(b2c2b2dJson, sha.b2c2b2d, { ...d2Expected, b2c2b2cResultSha256: '0'.repeat(64) }).valid).toBe(false)
    expect(d2With(j => { (j.decision as Json).case = 'B2C2B2D_ALL_C4C' }).valid).toBe(false)
    expect(d2With(j => { (j.conditions as Json).stage1 = { ...PHASE2C26B2C2B2D_STAGE1, budgetMs: 3_600_000 } }).valid).toBe(false)
    expect(d2With(j => { (j.provenance as Json).formal = false }).valid).toBe(false)
    expect(d2With(j => { j.invalidReasons = ['x'] }).valid).toBe(false)
    expect(d2With(j => { j.taskRows = j.taskRows.slice(1) }).valid).toBe(false)
    expect(d2With(j => { (j.taskRows[0]!.extent as Json).maxSkillAdvance = 1 }).issues.join()).toMatch(/task row disagrees with its Target row/)
    expect(d2With(j => { (j.targets[1]! as Json).recovery = 'C4C' }).issues.join()).toMatch(/hits disagree with its recovery/)
    expect(d2With(j => { (j.probes[0]!.tightExtent as Json).maxSkillAdvance = 1 }).issues.join()).toMatch(/probe derivation disagrees/)
  })

  it('derives the population mechanically: the B2-C2B2D Targets with recovery none and a timeout / out-of-memory task (2), with the other 2 recovered', () => {
    const { b2c2b2d } = authorities()
    const population = phase2c26b2c2b2ePopulation(b2c2b2d)
    expect(population.issues).toEqual([])
    const expected = (b2c2b2dJson.targets as Json[]).filter(t => t.recovery === 'none' && ['timeout', 'out_of_memory'].includes(t.process as string)).map(t => t.targetWeaponId)
    expect(population.targetWeaponIds).toEqual(expected)
    expect(population.targetWeaponIds).toHaveLength(PHASE2C26B2C2B2E_TARGETS)
    expect(population.previouslyUnrecovered).toHaveLength(2)
    expect(population.previouslyRecovered).toEqual((b2c2b2dJson.targets as Json[]).filter(t => t.recovery !== 'none').map(t => t.targetWeaponId))
    expect(population.previouslyRecovered).toHaveLength(2)
    expect(population.otherwiseUnrecovered).toEqual([])
    // It equals the B2-C2B2D interpretation's "previously unrecovered and still unmeasured" Targets.
    expect(population.targetWeaponIds).toEqual((b2c2b2dJson.interpretation.previouslyUnrecovered as Json[]).filter(t => t.result === 'still_unmeasured').map(t => t.targetWeaponId))
    // Fail closed: a third unmeasured Target, a recovered Target turned into a completed miss, no authority.
    const third = structuredClone(b2c2b2d); third.targets[1] = { ...third.targets[1]!, recovery: 'none', process: 'timeout', measured: false }
    third.taskRows = third.taskRows.map(r => r.targetWeaponId === third.targets[1]!.targetWeaponId ? { ...r, record: null, candidateCount: null } : r)
    expect(phase2c26b2c2b2ePopulation(third).issues.join()).toMatch(/3 B2-C2B2D Targets are unrecovered/)
    const miss = structuredClone(b2c2b2d); miss.targets[1] = { ...miss.targets[1]!, recovery: 'none' }
    expect(phase2c26b2c2b2ePopulation(miss).issues.join()).toMatch(/unrecovered for another reason/)
    const contradicting = structuredClone(b2c2b2d)
    const unmeasuredId = population.targetWeaponIds[0]!
    contradicting.taskRows = contradicting.taskRows.map(r => r.targetWeaponId === unmeasuredId ? { ...r, candidateCount: 0 } : r)
    expect(phase2c26b2c2b2ePopulation(contradicting).issues.join()).toMatch(/unmeasured B2-C2B2D task carries a record or a Candidate count/)
    expect(phase2c26b2c2b2ePopulation(null)).toMatchObject({ valid: false, targetWeaponIds: [] })
  })

  it('re-derives B2-C2B2D\'s probes over the authority chain and requires its rank, tight extent and task ID for every population Target', () => {
    const { b2c2b1, b2c1, b2c2b2b, b2c2b2c, b2c2b2d } = authorities()
    const derived = phase2c26b2c2b2eProbes(b2c2b1, b2c1, b2c2b1Json, b2c2b2b, b2c2b2c, b2c2b2d)
    expect(derived.issues).toEqual([])
    expect(derived.probes).toHaveLength(2)
    for (const probe of derived.probes) {
      const target = (b2c2b2dJson.targets as Json[]).find(t => t.targetWeaponId === probe.targetWeaponId)!
      const row = (b2c2b2dJson.taskRows as Json[]).find(t => t.targetWeaponId === probe.targetWeaponId)!
      const recorded = (b2c2b2dJson.probes as Json[]).find(p => p.targetWeaponId === probe.targetWeaponId)!
      expect(probe).toEqual({ targetWeaponId: target.targetWeaponId, b2c2b2dTaskId: target.taskId, contextRank: target.selectedRank, extent: (target.extents as Json).tight })
      expect([probe.b2c2b2dTaskId, probe.contextRank, probe.extent]).toEqual([row.taskId, row.contextRank, row.extent])
      expect(probe.extent).toEqual(recorded.tightExtent)
      expect(probe.contextRank).toBe(recorded.b2c1FirstCompatibleRank)
    }
    for (const d of derived.derivations) expect(d.b2c2b2dProcess).toMatch(/^(timeout|out_of_memory)$/)
    // A B2-C2B2D RESULT whose recorded probe derivations differ from the re-derivation fails closed.
    const drift = structuredClone(b2c2b2d); drift.probes = drift.probes.map(p => ({ ...p, required: { ...p.required, skill: (p.required.skill ?? 0) + 1 } }))
    expect(phase2c26b2c2b2eProbes(b2c2b1, b2c1, b2c2b1Json, b2c2b2b, b2c2b2c, drift).issues.join()).toMatch(/not the ones the B2-C2B2D RESULT recorded/)
    const rank = structuredClone(b2c2b2d); const id = derived.probes[0]!.targetWeaponId
    rank.targets = rank.targets.map(t => t.targetWeaponId === id ? { ...t, selectedRank: t.selectedRank + 1 } : t)
    expect(phase2c26b2c2b2eProbes(b2c2b1, b2c1, b2c2b1Json, b2c2b2b, b2c2b2c, rank).issues.join()).toMatch(/re-derived rank/)
    const extent = structuredClone(b2c2b2d)
    extent.taskRows = extent.taskRows.map(r => r.targetWeaponId === id ? { ...r, extent: { ...r.extent, maxGogmaAdvance: r.extent.maxGogmaAdvance - 1 } } : r)
    expect(phase2c26b2c2b2eProbes(b2c2b1, b2c1, b2c2b1Json, b2c2b2b, b2c2b2c, extent).issues.join()).toMatch(/tight extent is not B2-C2B2D's/)
  })

  it('writes per Target only its ID, B2-C2B2D task ID, selected P1 rank and tight extent (no expected key / index / cost / outcome / measurement), exactly what the Search runner accepts', () => {
    const { b2c2b1, b2c1, b2c2b2b, b2c2b2c, b2c2b2d } = authorities()
    const manifest = phase2c26b2c2b2eProbeManifest(b2c2b1, b2c1, b2c2b1Json, b2c2b2b, b2c2b2c, b2c2b2d)
    expect(manifest).toMatchObject({ sourceResultSha256: PHASE2C26B2C2B2E_PROBE_SOURCE.resultSha256, b2c2b2dResultSha256: sha.b2c2b2d, population: 'E1_L2_B2C2B2D_UNMEASURED_UNRECOVERED',
      policy: 'P1', contextSelection: PHASE2C26B2C2B2D_CONTEXT_SELECTION.id, extentRule: PHASE2C26B2C2B2D_EXTENT_RULE.id, exportSha256: exportSha })
    expect(Object.keys(manifest).sort()).toEqual(['b2c2b2dResultSha256', 'contextSelection', 'exportSha256', 'extentRule', 'phase', 'policy', 'population', 'probes', 'sourceResultSha256'])
    for (const probe of manifest.probes) expect(Object.keys(probe).sort()).toEqual(['b2c2b2dTaskId', 'contextRank', 'extent', 'targetWeaponId'])
    expect(JSON.stringify(manifest.probes)).not.toMatch(/stableKey|candidateIndex|operationCost|exact|partial|coverage|oracle|required|route|fnv1a32|K1:|timeout|memory|heap|yield|wall/i)
    expect(parsePhase2C26B2C2B2EProbeManifest(structuredClone(manifest))).toMatchObject({ valid: true, issues: [] })
    const bad = (patch: (m: Json & typeof manifest) => void) => { const copy = structuredClone(manifest) as Json & typeof manifest; patch(copy); return parsePhase2C26B2C2B2EProbeManifest(copy).valid }
    expect(bad(m => { m.probes = m.probes.slice(1) })).toBe(false)
    expect(bad(m => { m.probes = [...m.probes, { ...m.probes[0]!, targetWeaponId: 'zzz' }] })).toBe(false)
    expect(bad(m => { m.probes = [...m.probes].reverse() })).toBe(false)
    expect(bad(m => { m.probes[0]!.contextRank = 33 })).toBe(false)
    expect(bad(m => { m.probes[0]!.b2c2b2dTaskId = 't00-r99' })).toBe(false)
    expect(bad(m => { m.probes[0]!.b2c2b2dTaskId = m.probes[1]!.b2c2b2dTaskId })).toBe(false)
    expect(bad(m => { m.probes[0]!.extent = { ...L2 } })).toBe(false)
    expect(bad(m => { m.probes[0]!.extent = { ...m.probes[0]!.extent, maxSkillAdvance: 1501 } })).toBe(false)
    expect(bad(m => { m.sourceResultSha256 = '0'.repeat(64) })).toBe(false)
    expect(bad(m => { (m as Json).population = 'E1_L2' })).toBe(false)
    expect(bad(m => { (m as Json).b2c2b2dResultSha256 = 'x' })).toBe(false)
    for (const field of ['expectedStableKey', 'expectedCandidateIndex', 'expectedOperationCost', 'oracleRoute', 'required', 'b2c2b2dHeap']) {
      expect(bad(m => { (m.probes[0] as unknown as Json)[field] = 1 })).toBe(false)
      expect(bad(m => { m[field] = {} })).toBe(false)
    }
  })
})

// ---------------------------------------------------------------- a synthetic world (B2-C2B2D's)

const SOURCE_A_SKILL = 'series_skill.fixture.z'
const SOURCE_B_SKILL = 'series_skill.fixture.b-source'
const TIGHT = { maxNormalAdvance: 4, maxGogmaAdvance: 235, maxSkillAdvance: 446 }

function world() {
  const skill = { seriesSkillId: SOURCE_A_SKILL, groupSkillId: null, matchMode: 'all' as const }
  const a: TargetWeapon = orchestrationTarget('target.b2c2b2e.a', { priority: 5, idealSkillCondition: skill, practicalSkillCondition: skill })
  const b = skillConstrainedTarget('target.b2c2b2e.b', { priority: 1 })
  const built = orchestrationScenario({
    engine: { gogmaPositions: L2.maxGogmaAdvance + 8, skillPositions: L2.maxSkillAdvance + 8 },
    targets: [a, b],
    ownedWeapons: [orchestrationSource(ORCHESTRATION_SOURCE_A, { seriesSkillId: SOURCE_A_SKILL }),
      orchestrationSource(ORCHESTRATION_SOURCE_B, { restorationBonuses: belowPracticalBonuses(), seriesSkillId: SOURCE_B_SKILL })],
    entries: [
      orchestrationEntry('build-list.b2c2b2e.a', a, resetRoute(ORCHESTRATION_SOURCE_A), { finalBonuses: idealBonuses(), seriesSkillId: SOURCE_A_SKILL }),
      orchestrationEntry('build-list.b2c2b2e.b', b, { kind: 'existing_gogma_mixed', sourceOwnedWeaponId: resetRoute(ORCHESTRATION_SOURCE_B).sourceOwnedWeaponId,
        operations: [...resetRoute(ORCHESTRATION_SOURCE_B).operations, ...resetSkillsRoute(ORCHESTRATION_SOURCE_B).operations] }),
    ],
  })
  const schedule = derivePhase2C26B2C1Schedule(built.input, globalResearchDependencies(built.engine))
  return { built, schedule }
}
/** Two probes named by B2-C2B2D task IDs that are NOT this phase's probe indexes (t00 / t02 of a 4-probe B2-C2B2D). */
const PROBES: Phase2C26B2C2B2EProbe[] = [{ targetWeaponId: 'target.b2c2b2e.a', b2c2b2dTaskId: 't00-r01', contextRank: 1, extent: { maxNormalAdvance: 8, maxGogmaAdvance: 235, maxSkillAdvance: 256 } },
  { targetWeaponId: 'target.b2c2b2e.b', b2c2b2dTaskId: 't02-r02', contextRank: 2, extent: { ...TIGHT } }]
const asD = (probes: Phase2C26B2C2B2EProbe[]) => probes.map(({ targetWeaponId, contextRank, extent }) => ({ targetWeaponId, contextRank, extent }))

// ---------------------------------------------------------------- registered conditions and task construction

describe('Phase 2-C2.6-B2-C2B2E registered conditions and task construction', () => {
  it('registers 2 Targets x 1 context = 2 tasks and B2-C2B2D\'s Stage 1 with only the budget (60 minutes) and the heap (12,288 MB) raised', () => {
    expect([PHASE2C26B2C2B2E_TARGETS, PHASE2C26B2C2B2E_CONTEXTS_PER_TARGET, PHASE2C26B2C2B2E_EXPECTED_TASKS]).toEqual([2, 1, 2])
    expect(PHASE2C26B2C2B2E_STAGE1).toEqual({ executionClass: 'stage1', childHeapMb: 12_288, concurrency: 1, budgetMs: 3_600_000, retry: 'none', fallback: 'none' })
    expect([PHASE2C26B2C2B2E_BUDGET_MS, PHASE2C26B2C2B2E_CHILD_HEAP_MB]).toEqual([3_600_000, 12_288])
    expect(PHASE2C26B2C2B2E_B2C2B2D_STAGE1).toBe(PHASE2C26B2C2B2D_STAGE1)
    expect(PHASE2C26B2C2B2D_STAGE1).toEqual({ executionClass: 'stage1', childHeapMb: 8192, concurrency: 1, budgetMs: 600_000, retry: 'none', fallback: 'none' })
    const changed = Object.keys(PHASE2C26B2C2B2E_STAGE1).filter(k => PHASE2C26B2C2B2E_STAGE1[k as keyof typeof PHASE2C26B2C2B2E_STAGE1] !== PHASE2C26B2C2B2D_STAGE1[k as keyof typeof PHASE2C26B2C2B2D_STAGE1])
    expect(changed.sort()).toEqual([...PHASE2C26B2C2B2E_CHANGED_STAGE1_FIELDS].sort())
    expect(PHASE2C26B2C2B2E_CHANGED_STAGE1_FIELDS).toEqual(['budgetMs', 'childHeapMb'])
    // Capture, yield, sampling, context selection, extent rule and provenance are B2-C2B2D's, by reference.
    expect([PHASE2C26B2C2B2E_MAX_COST_COHORTS, PHASE2C26B2C2B2E_CANDIDATE_SAFETY_CAP]).toEqual([PHASE2C26B2C2B2D_MAX_COST_COHORTS, PHASE2C26B2C2B2D_CANDIDATE_SAFETY_CAP])
    expect([PHASE2C26B2C2B2E_MAX_COST_COHORTS, PHASE2C26B2C2B2E_CANDIDATE_SAFETY_CAP]).toEqual([4, 1024])
    expect(PHASE2C26B2C2B2E_CAPTURE_PREFIXES).toBe(PHASE2C26B2C2B2D_CAPTURE_PREFIXES)
    expect([PHASE2C26B2C2B2E_NODE_YIELD, PHASE2C26B2C2B2E_MEMORY_SAMPLE_INTERVAL_MS]).toEqual([PHASE2C26B2C2B2D_NODE_YIELD, PHASE2C26B2C2B2D_MEMORY_SAMPLE_INTERVAL_MS])
    expect([PHASE2C26B2C2B2E_NODE_YIELD, PHASE2C26B2C2B2E_MEMORY_SAMPLE_INTERVAL_MS]).toEqual(['setImmediate', 250])
    expect(PHASE2C26B2C2B2E_CONTEXT_SELECTION).toBe(PHASE2C26B2C2B2D_CONTEXT_SELECTION)
    expect(PHASE2C26B2C2B2E_EXTENT_RULE).toBe(PHASE2C26B2C2B2D_EXTENT_RULE)
    expect(PHASE2C26B2C2B2E_PROVENANCE_FLAGS).toBe(PHASE2C26B2C2B2D_PROVENANCE_FLAGS)
    expect(PHASE2C26B2C2B2E_PROVENANCE_FLAGS).toMatchObject({ oracleGuidedTargetPopulation: true, oracleGuidedContextSelection: true, oracleInformedPerTargetExtent: true,
      targetIndividualOracleExtentAsSearchInput: true, perTargetExtent: true, productionSchedulerEvidence: false, productionExtentSelectionEvidence: false,
      oracleReadBySearchChild: false, oracleMatchUsedForEarlyStop: false, expectedOutcomeKnownBySearchChild: false })
    for (const notRun of ['heap_16gb_retry', 'budget_over_60min', 'retry', 'automatic_fallback', 'timeout_fallback', 'oom_fallback', 'b2c2b2d_recovered_target_rerun', 'b2c2b2c_timeout_retry',
      'b2c2b2b_timeout_retry', 'search_optimization', 'production_change', 'extent_change', 'context_change', 'e2_search', 'k2_feature_grouping', 'global_assignment', 'ui_change', 'exact_early_stop']) {
      expect(PHASE2C26B2C2B2E_NOT_RUN).toContain(notRun)
    }
  })

  it('builds the tasks with B2-C2B2D\'s construction: identical Search input (digests, extent, context) and B2-C2B2D\'s task ID, failing closed on a drift', () => {
    const { schedule } = world()
    const ours = buildPhase2C26B2C2B2ETasks(schedule, PROBES)
    expect(ours.issues).toEqual([])
    const theirs = buildPhase2C26B2C2B2DTasks(schedule, asD(PROBES))
    expect(theirs.tasks.map(t => t.taskId)).toEqual(['t00-r01', 't01-r02'])
    expect(ours.tasks.map(t => t.taskId)).toEqual(['t00-r01', 't02-r02'])
    // Everything but the task ID is B2-C2B2D's task, digests and extent included.
    const withoutId = (task: Phase2C26B2C2B2ETaskInput) => { const { taskId, ...rest } = task; void taskId; return rest }
    expect(ours.tasks.map(withoutId)).toEqual(theirs.tasks.map(withoutId))
    expect(ours.tasks.map(t => [t.searchInputDigest, t.defaultSearchInputDigest])).toEqual(theirs.tasks.map(t => [t.searchInputDigest, t.defaultSearchInputDigest]))
    const issues = (probes: Phase2C26B2C2B2EProbe[]) => buildPhase2C26B2C2B2ETasks(schedule, probes).issues.join('\n')
    expect(issues([PROBES[0]!, { ...PROBES[1]!, contextRank: 31 }])).toMatch(/schedule rows hold the rank/)
    expect(issues([PROBES[0]!, { ...PROBES[1]!, extent: { ...L2 } }])).toMatch(/common L2 extent itself/)
    expect(issues([PROBES[0]!, { ...PROBES[1]!, b2c2b2dTaskId: PROBES[0]!.b2c2b2dTaskId }])).toMatch(/task ID repeats/)
    expect(buildPhase2C26B2C2B2ETasks(schedule, [PROBES[0]!, { ...PROBES[1]!, contextRank: 31 }]).tasks).toEqual([])
  })

  it('re-derives the excluded current Route of a B2-C2B2D task row by B2-C2B2D\'s own re-derivation (PR #203), equal to the key the Search child excludes', async () => {
    const { built, schedule } = world()
    const task = buildPhase2C26B2C2B2ETasks(schedule, PROBES).tasks[1]!
    const hashKey = (key: string) => `h:${key}`
    const rederived = phase2c26b2c2b2dRederiveBaselineContext(schedule, b2dRow(task), hashKey)
    expect(rederived).toMatchObject({ valid: true, issues: [], taskId: 't02-r02', defaultSearchInputDigest: task.defaultSearchInputDigest, excludedRouteKeyCount: 1, excludedRouteIsCurrentRoute: true })
    searchCalls.script = [1, 2, 3, 4, 5]
    const child = await runPhase2C26B2C2B2ETask(built.input, schedule, task, built.engine)
    if (child.status !== 'searched') throw new Error('not searched')
    expect(child.search.excludedRouteKeys.map(hashKey)).toEqual([rederived.excludedRouteKeySha256])
    expect(phase2c26b2c2b2dRederiveBaselineContext(schedule, b2dRow(task, { defaultSearchInputDigest: 'other' }), hashKey).valid).toBe(false)
  })

  it('runs B2-C2B2D\'s child calculation itself (the same function objects): same Search input, same capture, timeout / out-of-memory never Candidate 0', async () => {
    expect(runPhase2C26B2C2B2ETask).toBe(runPhase2C26B2C2B2DTask)
    expect(phase2c26b2c2b2eTaskOutcome).toBe(phase2c26b2c2b2dTaskOutcome)
    const { built, schedule } = world()
    const task = buildPhase2C26B2C2B2ETasks(schedule, PROBES).tasks[1]!
    searchCalls.script = [1, 2, 3, 4, 5]
    const child = await runPhase2C26B2C2B2ETask(built.input, schedule, task, built.engine)
    expect(child).toMatchObject({ status: 'searched', taskId: 't02-r02', search: { contextRank: 2, extent: TIGHT, searchInputDigest: task.searchInputDigest, termination: 'four_cost_cohorts_drained' } })
    expect(searchCalls.inputs).toHaveLength(1)
    expect(searchCalls.inputs[0]).toMatchObject({ targetWeaponId: 'target.b2c2b2e.b', extent: TIGHT })
    expect(phase2c26b2c2b2eTaskOutcome('t', 'timeout', null)).toEqual({ taskId: 't', process: 'timeout', record: null, searchStatus: null, termination: null, candidateCount: null })
    expect(phase2c26b2c2b2eTaskOutcome('t', 'out_of_memory', null)).toMatchObject({ process: 'out_of_memory', candidateCount: null })
    expect(phase2c26b2c2b2eTaskOutcome('t', 'completed', null).process).toBe('process_failure')
  })
})

// ---------------------------------------------------------------- the runner start attestation

const HEAD = 'a'.repeat(40)
const OBS_PROBES: Phase2C26B2C2B2EProbe[] = [{ targetWeaponId: 't1', b2c2b2dTaskId: 't00-r05', contextRank: 5, extent: { maxNormalAdvance: 100, maxGogmaAdvance: 235, maxSkillAdvance: 400 } },
  { targetWeaponId: 't2', b2c2b2dTaskId: 't02-r03', contextRank: 3, extent: { maxNormalAdvance: 4, maxGogmaAdvance: 235, maxSkillAdvance: 1000 } }]
const observation = { createdAt: '2026-10-05T01:00:00.000Z', runnerScript: 'scripts/run-planner-global-phase2c26b2c2b2e.mjs', node: 'v24.19.0', repositoryHead: HEAD, uncommittedBenchmarkCode: false,
  benchmarkCodeSha256: 'b'.repeat(64), exportFileName: 'export.json', exportSha256: 'c'.repeat(64), exportBytes: 10, probeManifestFileName: 'probes.json.local', probeManifestSha256: 'd'.repeat(64),
  probeManifestSourceResultSha256: PHASE2C26B2C2B2E_PROBE_SOURCE.resultSha256, probeManifestB2C2B2DResultSha256: sha.b2c2b2d, targetWeaponIds: ['t1', 't2'], probes: OBS_PROBES,
  stage1: { ...PHASE2C26B2C2B2E_STAGE1 }, smoke: null }
const expectation: Phase2C26B2C2B2EAttestationExpectation = { repositoryHead: HEAD, benchmarkCodeSha256: 'b'.repeat(64), exportSha256: 'c'.repeat(64), probeManifestSha256: 'd'.repeat(64),
  b2c2b2dResultSha256: sha.b2c2b2d, probes: OBS_PROBES, firstChildStartedAt: '2026-10-05T01:00:00.500Z' }
const environmentOf = (a: Json) => ({ repositoryHead: a.repositoryHead, uncommittedBenchmarkCode: a.uncommittedBenchmarkCode, benchmarkCodeSha256: a.benchmarkCodeSha256,
  exportSha256: a.exportSha256, probeManifestSha256: a.probeManifestSha256, stage1: a.stage1, probes: a.probes })

describe('Phase 2-C2.6-B2-C2B2E runner start attestation', () => {
  it('carries the launch observation and every registered condition (60 minutes / 12,288 MB, B2-C2B2D\'s Stage 1, no retry / fallback) and verifies only against the independently obtained values', () => {
    const attestation = phase2c26b2c2b2eStartAttestationBody(observation)
    expect(attestation).toMatchObject({ attestedBy: 'runner', phase: PHASE2C26B2C2B2E_START_ATTESTATION_PHASE, repositoryHead: HEAD, uncommittedBenchmarkCode: false,
      stage1: { childHeapMb: 12_288, budgetMs: 3_600_000, concurrency: 1, retry: 'none', fallback: 'none' }, b2c2b2dStage1: PHASE2C26B2C2B2D_STAGE1, changedStage1Fields: ['budgetMs', 'childHeapMb'],
      targets: 2, contextsPerTarget: 1, expectedTasks: 2, candidateSafetyCap: 1024, captureRule: { policy: 'C4C', maxCostCohorts: 4 }, smoke: null, probes: OBS_PROBES,
      provenanceFlags: { oracleGuidedContextSelection: true, targetIndividualOracleExtentAsSearchInput: true, perTargetExtent: true, productionSchedulerEvidence: false } })
    expect(verifyPhase2C26B2C2B2EStartAttestation(attestation, expectation)).toEqual({ verified: true, issues: [], integrityIssues: [] })
    const issue = (patch: Json, expected: Partial<Phase2C26B2C2B2EAttestationExpectation> = {}) =>
      verifyPhase2C26B2C2B2EStartAttestation({ ...attestation, ...patch }, { ...expectation, ...expected }).issues.join('\n')
    const integrity = (patch: Json) => verifyPhase2C26B2C2B2EStartAttestation({ ...attestation, ...patch }, expectation).integrityIssues.length > 0
    for (const patch of [{ repositoryHead: 'f'.repeat(40) }, { benchmarkCodeSha256: '0'.repeat(64) }, { exportSha256: '0'.repeat(64) }, { probeManifestSha256: '0'.repeat(64) },
      { probeManifestB2C2B2DResultSha256: '0'.repeat(64) }, { targetWeaponIds: ['t1'] }, { probes: [OBS_PROBES[0]] }, { probes: [{ ...OBS_PROBES[0]!, contextRank: 6 }, OBS_PROBES[1]] },
      { probes: [{ ...OBS_PROBES[0]!, b2c2b2dTaskId: 't01-r05' }, OBS_PROBES[1]] }, { attestedBy: 'reconstruction' }, { createdAt: '2026-10-05T01:00:01.000Z' }, { extra: 1 },
      { phase: PHASE2C26B2C2B2D_START_ATTESTATION_PHASE }]) expect(integrity(patch)).toBe(true)
    // A truthfully attested non-formal launch, or a condition other than the registered one, is not an integrity issue but never verifies.
    for (const patch of [{ uncommittedBenchmarkCode: true }, { smoke: { taskIds: ['t00-r05'], budgetMs: null } }, { stage1: { ...PHASE2C26B2C2B2D_STAGE1 } },
      { stage1: { ...PHASE2C26B2C2B2E_STAGE1, childHeapMb: 16_384 } }, { stage1: { ...PHASE2C26B2C2B2E_STAGE1, budgetMs: 7_200_000 } }, { stage1: { ...PHASE2C26B2C2B2E_STAGE1, concurrency: 2 } },
      { stage1: { ...PHASE2C26B2C2B2E_STAGE1, retry: 'once' } }, { stage1: { ...PHASE2C26B2C2B2E_STAGE1, fallback: 'heap_16gb' } }, { b2c2b2dStage1: { ...PHASE2C26B2C2B2E_STAGE1 } },
      { changedStage1Fields: ['budgetMs'] }, { expectedTasks: 4 }, { provenanceFlags: { ...PHASE2C26B2C2B2E_PROVENANCE_FLAGS, productionSchedulerEvidence: true } }]) {
      expect(integrity(patch)).toBe(false)
      expect(issue(patch)).not.toBe('')
    }
    expect(issue({}, { repositoryHead: 'f'.repeat(40) })).toMatch(/repositoryHead differs/)
    expect(issue({ createdAt: '2026-10-05 01:00' })).toMatch(/canonical UTC/)
    expect(verifyPhase2C26B2C2B2EStartAttestation(null, expectation).verified).toBe(false)
    expect(Object.keys(phase2c26b2c2b2eRegisteredConditions()).sort()).toEqual(['b2c2b2dStage1', 'candidateSafetyCap', 'captureRule', 'changedStage1Fields', 'contextSelection', 'contextsPerTarget',
      'expectedTasks', 'extentCeiling', 'extentFloor', 'extentRule', 'memorySampleIntervalMs', 'nodeYield', 'population', 'provenanceFlags', 'registeredP1', 'stage1', 'targets', 'tasksBudgetMs'])
  })

  it('grades launch provenance by the attestation file alone: absent never formal; present and correct verifies; any mismatch fails closed', () => {
    const attestation = phase2c26b2c2b2eStartAttestationBody(observation)
    const file = { sha256: 'e'.repeat(64), body: attestation }
    const environment = environmentOf(attestation as unknown as Json)
    expect(phase2c26b2c2b2eLaunchProvenance({ attestationFile: file, recordedAttestationSha256: file.sha256, environment, expected: expectation }))
      .toMatchObject({ verified: true, source: 'runner_start_attestation', workingTreeCleanVerified: true, issues: [] })
    expect(phase2c26b2c2b2eLaunchProvenance({ attestationFile: null, recordedAttestationSha256: null, environment, expected: expectation })).toMatchObject({ verified: false, source: 'none' })
    expect(phase2c26b2c2b2eLaunchProvenance({ attestationFile: file, recordedAttestationSha256: '0'.repeat(64), environment, expected: expectation }).integrityIssues.join()).toMatch(/not the one the raw recorded/)
    expect(phase2c26b2c2b2eLaunchProvenance({ attestationFile: file, recordedAttestationSha256: file.sha256, environment: { ...environment, stage1: { ...PHASE2C26B2C2B2D_STAGE1 } }, expected: expectation }).verified).toBe(false)
    for (const expected of [{ repositoryHead: 'f'.repeat(40) }, { benchmarkCodeSha256: '0'.repeat(64) }, { exportSha256: '0'.repeat(64) }, { probeManifestSha256: '0'.repeat(64) },
      { b2c2b2dResultSha256: '0'.repeat(64) }, { probes: [] }]) {
      expect(phase2c26b2c2b2eLaunchProvenance({ attestationFile: file, recordedAttestationSha256: file.sha256, environment, expected: { ...expectation, ...expected } }).verified).toBe(false)
    }
    expect(phase2c26b2c2b2eEvidenceGrade({ formalConditions: true, launchProvenanceVerified: true, partialRun: true })).toBe('formal')
    expect(phase2c26b2c2b2eEvidenceGrade({ formalConditions: true, launchProvenanceVerified: false, partialRun: true })).toBe('diagnostic_partial')
    expect(phase2c26b2c2b2eEvidenceGrade({ formalConditions: false, launchProvenanceVerified: true, partialRun: false })).toBe('non_formal')
  })

  it('is written by the runner into the run dir, once and read-only, before the tasks child and before any Search child; Stage 1 runs each task once at 60 minutes / 12,288 MB', () => {
    expect(PHASE2C26B2C2B2E_START_ATTESTATION_FILE).toBe('start-attestation.json')
    const write = runnerSource.indexOf('await write(attestationPath, attestation)')
    const chmod = runnerSource.indexOf('await chmod(attestationPath, 0o444)')
    const tasksChild = runnerSource.indexOf("await runChild('tasks', 'tasks'")
    const stage1 = runnerSource.indexOf('const stage1 = await pool(stage1Tasks,')
    const mkdirAt = runnerSource.indexOf('await mkdir(runDir, { recursive: true })')
    expect([mkdirAt, write, chmod, tasksChild, stage1].every(i => i > 0)).toBe(true)
    expect(mkdirAt < write && write < chmod && chmod < tasksChild && tasksChild < stage1).toBe(true)
    expect(runnerSource).toMatch(/const write = \(path, value, pretty = true\) => writeFile\(path, [^\n]*\{ flag: 'wx' \}\)/)
    expect(runnerSource).toMatch(/if \(existsSync\(runDir\)\) throw new Error/)
    expect(runnerSource).toMatch(/phase2c26b2c2b2eStartAttestationBody\(\{ createdAt: new Date\(\)\.toISOString\(\)/)
    expect(runnerSource).toMatch(/The start attestation read back is not the one written/)
    expect(runnerSource).toMatch(/verifyPhase2C26B2C2B2EStartAttestation\(/)
    expect(runnerSource).toMatch(/Commit ALL benchmark code before a formal measurement/)
    expect(runnerSource).toMatch(/appendFileSync\(processesPath, JSON\.stringify\(\{ \.\.\.entry, recordFile \}\) \+ '\\n'\)/)
    expect(runnerSource).toMatch(/const SCRIPT_PATH = 'scripts\/run-planner-global-phase2c26b2c2b2e\.mjs'/)
    expect(runnerSource).toMatch(/smoke options and need --allow-uncommitted/)
    // Stage 1 comes from the registered 60-minute / 12,288 MB conditions only (a smoke budget is non-formal), each task once.
    expect(runnerSource).toMatch(/const stage1Conditions = \{ \.\.\.c2b2e\.PHASE2C26B2C2B2E_STAGE1, budgetMs: smokeBudgetMs \?\? c2b2e\.PHASE2C26B2C2B2E_STAGE1\.budgetMs \}/)
    expect(runnerSource).toMatch(/heapMb: stage1Conditions\.childHeapMb, budgetMs: stage1Conditions\.budgetMs/)
    expect(runnerSource).toMatch(/const nodeFlags = \[`--max-old-space-size=\$\{heapMb\}`\]/)
    expect(runnerSource).toMatch(/const stage1 = await pool\(stage1Tasks, stage1Conditions\.concurrency,/)
    expect(runnerSource.match(/runChild\(`stage1-/g)).toHaveLength(1)
    expect(runnerSource).not.toMatch(/16384|16_384|7200000|retryTasks|fallbackTasks|FALLBACK/)
    expect(runnerSource).toMatch(/c2b2e\.runPhase2C26B2C2B2ETask\(input, schedule, task, engine/)
    expect(runnerSource).toMatch(/c2b2e\.buildPhase2C26B2C2B2ETasks\(schedule, task\.probes\)/)
    expect(runnerSource).toMatch(/task\.taskId !== probe\.b2c2b2dTaskId/)
  })

  it('reconstructs an interrupted run only with a verifying attestation (fail closed otherwise) and never invents one', () => {
    expect(reconstructSource).not.toMatch(/visitPlannerAlternativeCandidates|runPhase2C26B2C2B2[DE]Task\(|runPhase2C26B2C2B2DSearch|spawn\(|--oracle|--manifest|_RESULT/)
    expect(reconstructSource).not.toMatch(/writeFile\([^)]*runDir|\brm\(|\bunlink\(|\brename\(|\bcopyFile\(|chmod\(/)
    expect(reconstructSource).toMatch(/writeFile\(paths\.output, text, \{ flag: 'wx' \}\)/)
    expect(reconstructSource).toMatch(/verifyPhase2C26B2C2B2EStartAttestation\(attestation, \{ repositoryHead: measuredHead, benchmarkCodeSha256: recomputedBenchmarkCodeSha256,/)
    expect(reconstructSource).toMatch(/if \(check\.integrityIssues\.length > 0\) throw new Error\(`The runner start attestation does not verify/)
    expect(reconstructSource).toMatch(/if \(!check\.verified && !allowNonformal\) throw/)
    expect(reconstructSource).toMatch(/status: 'interrupted'/)
    expect(reconstructSource).toMatch(/childRecordsModified: false, searchRun: false/)
    expect(reconstructSource).toMatch(/a valid 2-task construction/)
    expect(reconstructSource).not.toMatch(/attestedBy|phase2c26b2c2b2eStartAttestationBody|c2b2d\.|PHASE2C26B2C2B2D_/)
  })

  it('makes a RESULT formal only with verified launch provenance; --allow-nonformal never promotes it; the next branch and E1 aggregate stay out of the decision', () => {
    expect(analyzerSource).toMatch(/const formalConditions = formalRunConditions && calculationCodeChangedSinceMeasuredHead\.length === 0 && !analysisUncommitted\s+const formal = formalConditions && launchProvenance\.verified\n/)
    expect(analyzerSource.match(/const formal = [^\n]*/)![0]).not.toMatch(/allowNonformal|interrupted|reconstruction/)
    expect(analyzerSource).toMatch(/if \(!launchProvenance\.verified && !allowNonformal\) throw/)
    expect(analyzerSource).toMatch(/if \(attestationFile !== null\) invalidReasons\.push\(\.\.\.launchProvenance\.integrityIssues/)
    expect(analyzerSource).toMatch(/plannerGlobalPhase2C26B2C2B2EAnalysis\.ts', 'scripts\/analyze-planner-global-phase2c26b2c2b2e\.mjs', 'scripts\/reconstruct-planner-global-phase2c26b2c2b2e-partial-raw\.mjs'/)
    expect(analyzerSource.match(/const finalDecision = [^\n]*/)![0]).not.toMatch(/nextBranch|e1Aggregate|trajector/)
    expect(analyzerSource).toMatch(/--b2c2b2d-result/)
    expect(analyzerSource).toMatch(/phase2c26b2c2b2eProbes\(authority, b2c1Authority, b2c2b1Json, b2c2b2bAuthority, b2c2b2cAuthority, b2c2b2dAuthority\)/)
    // The excluded current Route of every pair is re-derived by B2-C2B2D's own re-derivation (PR #203) over the B2-C2B2D task row.
    expect(analyzerSource).toMatch(/d2Analysis\.phase2c26b2c2b2dRederiveBaselineContext\(schedule, row, sha\)/)
    expect(analyzerSource).toMatch(/childCalculationIsB2C2B2D: c2b2e\.runPhase2C26B2C2B2ETask === c2b2d\.runPhase2C26B2C2B2DTask/)
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
const CONDITIONS = { budgetMs: PHASE2C26B2C2B2E_BUDGET_MS, childHeapMb: PHASE2C26B2C2B2E_CHILD_HEAP_MB }

function taskOf(rank: number, patch: Partial<Phase2C26B2C2B2ETaskInput> = {}): Phase2C26B2C2B2ETaskInput {
  return { taskId: `t02-r${String(rank).padStart(2, '0')}`, executionClass: 'stage1', targetWeaponId: TARGET, contextRank: rank, policy: 'P1', groupIndex: 100 + rank,
    reservationDigest: `d${rank}`, targetEligibleMinCardinality: 1, representativeFixedSetId: `K1:e${rank}`, representativeFixedTargetWeaponIds: [`x${rank}`],
    defaultSearchInputDigest: `s${rank}`, searchInputDigest: `tight${rank}`, extent: { ...TIGHT }, maxCostCohorts: 4, candidateSafetyCap: 1024, ...patch }
}
function delivered(s: Phase2C2CandidateSummary, index: number): Phase2C26B2B2A2DeliveredCandidate {
  return { deliveryIndex: index, stableKey: `k${String(index).padStart(5, '0')}`, orderingKeys: { estimatedOperationCount: s.estimatedOperationCount, estimatedGogmaAdvance: s.estimatedAdvances.gogma,
    estimatedSkillAdvance: s.estimatedAdvances.skill, estimatedNormalAdvance: s.estimatedAdvances.normal, preferredSourceRank: 0 }, comparatorWithPrevious: index === 0 ? null : -1,
    summary: s, reservationCheck: { respects: true, blockedHits: {}, exclusiveHit: [] } }
}
const filler = (n: number, cost: number, from = 0) => Array.from({ length: n }, (_, i) => summary({ sourceOwnedWeaponId: `other-${from + i}`, estimatedOperationCount: cost, estimatedAdvances: { normal: null, gogma: 1, skill: 0 } }))
function capture(task: Phase2C26B2C2B2ETaskInput, summaries: Phase2C2CandidateSummary[], termination: Phase2C26B2C2B2DSearchRecord['termination'], sentinel: Phase2C2CandidateSummary | null = null): Phase2C26B2C2B2DSearchRecord {
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
type Process = 'completed' | 'timeout' | 'out_of_memory' | 'process_failure'
function runOf(task: Phase2C26B2C2B2ETaskInput, record: Phase2C26B2C2B2DSearchRecord | null, process: Process = 'completed', budgetMs = PHASE2C26B2C2B2E_BUDGET_MS): Phase2C26B2C2B2ERun {
  const child = record === null ? null : { status: 'searched' as const, taskId: task.taskId, search: record }
  return { taskId: task.taskId, task, outcome: phase2c26b2c2b2eTaskOutcome(task.taskId, process, process === 'completed' ? child : null),
    process: { outcome: process, wallMs: process === 'timeout' ? budgetMs : 1_234_000, timedOut: process === 'timeout', budgetMs }, childWallMs: 9, scheduleMs: 1, yields: 3,
    memory: process === 'completed' ? { sampledMaxHeapUsedBytes: 9_000_000_000, sampledMaxRssBytes: 9_500_000_000, maxRssKiB: 1 } : null, lastIpcMemory: { maxHeapUsedBytes: 50, maxRssBytes: 300 },
    record: process === 'completed' ? child : null }
}
function withMatchAt(task: Phase2C26B2C2B2ETaskInput, at: number) {
  return capture(task, [summary({ estimatedOperationCount: 1, sourceOwnedWeaponId: 'cheap' }), ...filler(Math.max(at - 1, 0), 2), { ...MATCH }, ...filler(3, 3, 100), ...filler(2, 4, 200)],
    'four_cost_cohorts_drained', summary({ estimatedOperationCount: 5, sourceOwnedWeaponId: 'dear' }))
}
const miss = (task: Phase2C26B2C2B2ETaskInput) => capture(task, [summary({ estimatedOperationCount: 1, sourceOwnedWeaponId: 'cheap' }), ...filler(5, 2)], 'exhausted')
const derivationOf = (task: Phase2C26B2C2B2ETaskInput, b2c2b2c = 'out_of_memory'): Phase2C26B2C2B2EProbeDerivation => ({ targetWeaponId: task.targetWeaponId, b2c1FirstCompatibleRank: task.contextRank,
  b2c2b1P1FirstCompatibleRank: task.contextRank, b2c2b2cRecomputedFirstCompatibleRank: task.contextRank, required: { normal: null, gogma: 17, skill: 446 }, tightExtent: { ...task.extent }, commonL2Extent: { ...L2 },
  extentDeltaFromCommonL2: { maxNormalAdvance: task.extent.maxNormalAdvance - 128, maxGogmaAdvance: 0, maxSkillAdvance: task.extent.maxSkillAdvance - 1500 },
  extentRatioToCommonL2: { maxNormalAdvance: task.extent.maxNormalAdvance / 128, maxGogmaAdvance: 1, maxSkillAdvance: task.extent.maxSkillAdvance / 1500 }, strictlySmallerStreams: ['maxNormalAdvance', 'maxSkillAdvance'],
  b2c2b2dTaskId: task.taskId, b2c2b2dProcess: 'timeout', b2c2b2cSameContextProcess: b2c2b2c })
function b2dRow(task: Phase2C26B2C2B2ETaskInput, patch: Partial<Phase2C26B2C2B2EB2C2B2DTaskRow> = {}): Phase2C26B2C2B2EB2C2B2DTaskRow {
  return { taskId: task.taskId, targetWeaponId: task.targetWeaponId, contextRank: task.contextRank, groupIndex: task.groupIndex, reservationDigest: task.reservationDigest,
    targetEligibleMinCardinality: task.targetEligibleMinCardinality, representativeFixedSetId: task.representativeFixedSetId, representativeFixedTargetWeaponIds: [...task.representativeFixedTargetWeaponIds],
    defaultSearchInputDigest: task.defaultSearchInputDigest, searchInputDigest: task.searchInputDigest, extent: { ...task.extent }, excludedRouteKeySha256: null, process: 'timeout', record: null,
    wallMs: 600_300, searchElapsedMs: null, peakHeapBytes: 5_000_000_000, peakRssBytes: 5_400_000_000, yields: 2_854_034, termination: null, candidateCount: null, deliveredCandidates: null,
    captureComplete: null, safetyCapHit: null, capturedCosts: [], compatible: true, coverage: null, firstExactIndex: null, firstExactCost: null, hit: { C8: false, C32: false, C4C: false }, ...patch }
}
/** A synthetic B2-C2B2D authority: the committed one with its Target / task rows replaced by the given tasks' (unmeasured at B2-C2B2D). */
function b2dAuthorityFor(tasks: Phase2C26B2C2B2ETaskInput[], opts: { b2c2b2c?: string[]; rows?: Phase2C26B2C2B2EB2C2B2DTaskRow[]; rederivedSha?: string | null } = {}): Phase2C26B2C2B2EB2C2B2DAuthority {
  const base = authorities().b2c2b2d
  return { ...base, targetWeaponIds: tasks.map(t => t.targetWeaponId), taskRows: opts.rows ?? tasks.map(t => b2dRow(t)),
    targets: tasks.map((t, i) => ({ targetWeaponId: t.targetWeaponId, taskId: t.taskId, selectedRank: t.contextRank, process: 'timeout', measured: false, recovery: 'none' as const, missClass: 'unmeasured',
      tightExtent: { ...t.extent }, b2c2b2cSameContextProcess: opts.b2c2b2c?.[i] ?? 'out_of_memory', rederivedExcludedRouteKeySha256: opts.rederivedSha === undefined ? 'h:current' : opts.rederivedSha,
      pairedIdentityMatches: true })) }
}
const rederivationOf = (task: Phase2C26B2C2B2ETaskInput, patch: Partial<Phase2C26B2C2B2DBaselineRederivation> = {}): Phase2C26B2C2B2DBaselineRederivation => ({ taskId: task.taskId, valid: true, issues: [],
  scheduleRows: 1, groupIndex: task.groupIndex, reservationDigest: task.reservationDigest, targetEligibleMinCardinality: task.targetEligibleMinCardinality,
  representativeFixedSetId: task.representativeFixedSetId, representativeFixedTargetWeaponIds: [...task.representativeFixedTargetWeaponIds], defaultSearchInputDigest: task.defaultSearchInputDigest,
  bodyDigestMatches: true, excludedRouteKeyCount: 1, excludedRouteIsCurrentRoute: true, excludedRouteKeySha256: 'h:current', ...patch })
const reachOf = (task: Phase2C26B2C2B2ETaskInput) => [{ targetWeaponId: task.targetWeaponId, compatibleGroupIndexes: [task.groupIndex], p1FirstCompatibleRank: task.contextRank, inconsistencies: [] }]
const analyze = (task: Phase2C26B2C2B2ETaskInput, run: Phase2C26B2C2B2ERun | null, opts: { b2d?: Phase2C26B2C2B2EB2C2B2DAuthority; rederivation?: Phase2C26B2C2B2DBaselineRederivation | null;
  ourSha?: string | null; memory?: Phase2C26B2C2B2EMemorySample[]; conditions?: typeof CONDITIONS; smoke?: boolean } = {}) =>
  runPhase2C26B2C2B2EAnalysis({ derivations: [derivationOf(task)], tasks: [task], runs: run === null ? [] : [run], reach: reachOf(task),
    excludedRouteKeySha256: new Map([[task.taskId, opts.ourSha !== undefined ? opts.ourSha : run?.record?.status === 'searched' ? 'h:current' : null]]),
    rederivations: new Map(opts.rederivation === null ? [] : [[task.taskId, opts.rederivation ?? rederivationOf(task)]]), memorySamples: new Map([[task.taskId, opts.memory ?? []]]),
    b2c2b2d: opts.b2d ?? b2dAuthorityFor([task]), oracle: ORACLE, smoke: opts.smoke ?? false, conditions: opts.conditions ?? CONDITIONS, interruption: null })

describe('Phase 2-C2.6-B2-C2B2E analysis', () => {
  it('pairs every task with B2-C2B2D\'s task of the same Target: identical Search input (digests, extent, task ID), excluded current Route proved by re-derivation, budget / heap the only difference', () => {
    const task = taskOf(11)
    const result = analyze(task, runOf(task, withMatchAt(task, 3)))
    expect(result.invalidReasons).toEqual([])
    expect(result.rows[0]).toMatchObject({ selectedRank: 11, compatible: true, measured: true, recovery: 'C8', firstExactIndex: 3, firstExactCost: 2, missClass: null })
    expect(result.paired[0]).toMatchObject({ b2c2b2dTaskId: 't02-r11', b2c2b2cSameContextProcess: 'out_of_memory', outcomeTransition: 'timeout -> completed',
      identity: { matches: true, issues: [], excludedRouteKeyComparison: { verified: true, rederivedExcludedRouteKeySha256: 'h:current', b2c2b2dRederivedExcludedRouteKeySha256: 'h:current',
        b2c2b2dRecordMatchesRederived: null, b2c2b2eSource: 'b2c2b2e_record', b2c2b2eRecordMatchesRederived: true } },
      b2c2b2d: { process: 'timeout', budgetMs: 600_000, childHeapMb: 8192, candidateCount: null, searchElapsedMs: null },
      b2c2b2e: { process: 'completed', budgetMs: 3_600_000, childHeapMb: 12_288, candidateCount: 9 },
      delta: { wallMs: 1_234_000 - 600_300, peakHeapBytes: 9_000_000_000 - 5_000_000_000 } })
    // Every identity field, the tight digest and the extent included, must be B2-C2B2D's.
    const reasons = (row: Partial<Phase2C26B2C2B2EB2C2B2DTaskRow>) => analyze(task, runOf(task, withMatchAt(task, 3)), { b2d: b2dAuthorityFor([task], { rows: [b2dRow(task, row)] }) }).invalidReasons.join('\n')
    const drifts: [Partial<Phase2C26B2C2B2EB2C2B2DTaskRow>, string][] = [[{ searchInputDigest: 'other' }, 'searchInputDigest'], [{ defaultSearchInputDigest: 'other' }, 'defaultSearchInputDigest'],
      [{ extent: { ...TIGHT, maxSkillAdvance: 447 } }, 'extent'], [{ groupIndex: 1 }, 'groupIndex'], [{ reservationDigest: 'other' }, 'reservationDigest'],
      [{ representativeFixedSetId: 'K1:o' }, 'representativeFixedSetId'], [{ representativeFixedTargetWeaponIds: ['o'] }, 'representativeFixedTargetWeaponIds'], [{ contextRank: 12 }, 'contextRank'],
      [{ taskId: 't00-r11' }, 'taskId'], [{ targetEligibleMinCardinality: 2 }, 'targetEligibleMinCardinality']]
    for (const [patch, field] of drifts) {
      expect(reasons(patch)).toMatch(new RegExp(`paired: t02-r11: ${field} differs from B2-C2B2D`))
    }
    expect(analyze(task, runOf(task, withMatchAt(task, 3)), { b2d: b2dAuthorityFor([task], { rows: [] }) }).invalidReasons.join()).toMatch(/0 B2-C2B2D tasks hold this Target/)
    // The paired row checks the child budget against this phase's conditions directly.
    const paired = phase2c26b2c2b2ePairedRow(task, runOf(task, withMatchAt(task, 3), 'completed', 600_000), result.contexts[0]!, 'h:current', b2dAuthorityFor([task]), rederivationOf(task), CONDITIONS)
    expect(paired.identity.issues).toEqual(['t02-r11: the child budget is not this phase\'s'])
    expect(paired.identity.matches).toBe(false)
  })

  it('proves the excluded current Route against B2-C2B2D\'s re-derived key, its record key and this phase\'s record key, and fails closed on any mismatch', () => {
    const task = taskOf(11)
    const run = runOf(task, withMatchAt(task, 3))
    const reasons = (opts: Parameters<typeof analyze>[2]) => analyze(task, run, opts).invalidReasons.join('\n')
    expect(reasons({ rederivation: null })).toMatch(/no re-derived default context/)
    expect(reasons({ rederivation: rederivationOf(task, { valid: false, issues: ['x drift'] }) })).toMatch(/x drift/)
    expect(reasons({ rederivation: rederivationOf(task, { excludedRouteKeySha256: 'h:other' }) })).toMatch(/excluded current Route B2-C2B2D re-derived differs/)
    expect(reasons({ b2d: b2dAuthorityFor([task], { rederivedSha: 'h:other' }) })).toMatch(/excluded current Route B2-C2B2D re-derived differs/)
    expect(reasons({ ourSha: 'h:other' })).toMatch(/B2-C2B2E record's excluded current Route differs/)
    expect(reasons({ b2d: b2dAuthorityFor([task], { rows: [b2dRow(task, { excludedRouteKeySha256: 'h:other', record: 'searched' })] }) })).toMatch(/B2-C2B2D record's excluded current Route differs/)
    expect(reasons({ b2d: b2dAuthorityFor([task], { rows: [b2dRow(task, { excludedRouteKeySha256: null, record: 'searched' })] }) })).toMatch(/searched B2-C2B2D task without a recorded excluded current Route/)
    expect(reasons({ rederivation: rederivationOf(task, { defaultSearchInputDigest: 'other' }) })).toMatch(/re-derived default digest is not this task's default digest/)
    // A record-less side (timeout) is bound by the re-derivation alone.
    const timeout = analyze(task, runOf(task, null, 'timeout'))
    expect(timeout.invalidReasons).toEqual([])
    expect(timeout.paired[0]!.identity.excludedRouteKeyComparison).toMatchObject({ verified: true, b2c2b2eSource: 'rederived_default_context', b2c2b2eRecordMatchesRederived: null })
  })

  it('never reads a timeout / OOM as Candidate 0 and checks the execution conditions (60 minutes / 12,288 MB) of every child', () => {
    const task = taskOf(11)
    for (const process of ['timeout', 'out_of_memory', 'process_failure'] as const) {
      const result = analyze(task, runOf(task, null, process))
      expect(result.invalidReasons).toEqual([])
      expect(result.rows[0]).toMatchObject({ measured: false, candidateCount: null, coverage: null, recovery: 'none', missClass: 'unmeasured', process })
      expect(result.paired[0]!.b2c2b2e).toMatchObject({ process, candidateCount: null, termination: null, firstExactIndex: null })
      expect(result.aggregates.measurementCompleteness).toMatchObject({ status: 'incomplete', unmeasured: 1 })
      expect(phase2c26b2c2b2eDecision({ invalidReasons: result.invalidReasons, ...result.decisionInput, tasks: 2, targets: 2, unmeasuredTasks: 1 }).case).toBe('B2C2B2E_INCOMPLETE')
    }
    expect(analyze(task, runOf(task, withMatchAt(task, 3), 'completed', 600_000)).invalidReasons.join()).toMatch(/child budget is 600000 ms, not 3600000/)
    expect(analyze(task, runOf(task, withMatchAt(task, 3)), { conditions: { budgetMs: 3_600_000, childHeapMb: 16_384 } }).invalidReasons.join()).toMatch(/not 60 minutes \/ 12,288 MB/)
    expect(analyze(task, runOf(task, withMatchAt(task, 3)), { conditions: { budgetMs: 600_000, childHeapMb: 12_288 } }).invalidReasons.join()).toMatch(/not 60 minutes \/ 12,288 MB/)
    // B2-C2B2D's raw checks still apply: a task that ran twice, or an extent other than the Target's, fails closed.
    const twice = validatePhase2C26B2C2B2ERaw({ tasks: [task], runs: [runOf(task, miss(task)), runOf(task, miss(task))], smoke: false, expectedExtents: new Map([[TARGET, TIGHT]]) })
    expect(twice.join()).toMatch(/a task ran twice/)
    expect(validatePhase2C26B2C2B2ERaw({ tasks: [task], runs: [], smoke: true, expectedExtents: new Map([[TARGET, { ...TIGHT, maxSkillAdvance: 1 }]]) }).join()).toMatch(/not the Target's tight extent/)
    expect(validatePhase2C26B2C2B2ERaw({ tasks: [task, taskOf(12, { targetWeaponId: 't2' }), taskOf(13, { targetWeaponId: 't3' })], runs: [], smoke: true,
      expectedExtents: new Map([[TARGET, TIGHT], ['t2', TIGHT], ['t3', TIGHT]]) }).join()).toMatch(/3 planned tasks, more than 2/)
  })

  it('classifies a completed miss and decides ALL_C8 / ALL_C32 / ALL_C4C / PARTIAL / INCOMPLETE / INVALID for 2 Targets, as a diagnostic decision', () => {
    const task = taskOf(11)
    expect(analyze(task, runOf(task, miss(task))).rows[0]).toMatchObject({ measured: true, recovery: 'none', missClass: 'compatible_non_delivery' })
    const decide = (exact: [number, number, number], unmeasured = 0, invalid: string[] = []) =>
      phase2c26b2c2b2eDecision({ invalidReasons: invalid, tasks: 2, targets: 2, unmeasuredTasks: unmeasured, exactTargets: { C8: exact[0], C32: exact[1], C4C: exact[2] } }).case
    expect(decide([2, 2, 2])).toBe('B2C2B2E_ALL_C8')
    expect(decide([1, 2, 2])).toBe('B2C2B2E_ALL_C32')
    expect(decide([0, 1, 2])).toBe('B2C2B2E_ALL_C4C')
    expect(decide([0, 0, 1])).toBe('B2C2B2E_PARTIAL')
    expect(decide([1, 1, 1], 1)).toBe('B2C2B2E_INCOMPLETE')
    expect(decide([2, 2, 2], 0, ['x'])).toBe('B2C2B2E_INVALID')
    expect(phase2c26b2c2b2eDecision({ invalidReasons: [], tasks: 4, targets: 2, unmeasuredTasks: 0, exactTargets: { C8: 0, C32: 0, C4C: 0 } }).case).toBe('B2C2B2E_INVALID')
    expect(() => decide([2, 1, 1])).toThrow(/Inconsistent/)
    expect(PHASE2C26B2C2B2E_DECISION_RULE.scope).toMatch(/never a scheduler decision/)
    expect(PHASE2C26B2C2B2E_DECISION_RULE.order[1]).toMatch(/never followed by an automatic 16 GB or longer fallback/)
  })

  it('branches A / B / C / D by which typed Target recovered (types from B2-C2B2C\'s same-context process, never from an ID)', () => {
    const heap = taskOf(17, { targetWeaponId: 'h', taskId: 't00-r17' })
    const time = taskOf(11, { targetWeaponId: 't', taskId: 't02-r11' })
    const b2d = b2dAuthorityFor([heap, time], { b2c2b2c: ['out_of_memory', 'timeout'] })
    const row = (task: Phase2C26B2C2B2ETaskInput, recovered: boolean | 'miss' | 'not_run'): Phase2C26B2C2B2ETargetRow => ({ targetWeaponId: task.targetWeaponId, taskId: task.taskId, selectedRank: task.contextRank,
      b2c1FirstCompatibleRank: task.contextRank, recomputedFirstCompatibleRank: task.contextRank, compatible: true, measured: recovered === true || recovered === 'miss',
      process: recovered === 'not_run' ? 'not_run' : recovered === true || recovered === 'miss' ? 'completed' : 'timeout', termination: null, candidateCount: null, captureComplete: null, safetyCapHit: null,
      capturedCosts: [], coverage: null, firstExactIndex: null, firstExactCost: null, oracleOperationCost: null, hit: { C8: recovered === true, C32: recovered === true, C4C: recovered === true },
      recovery: recovered === true ? 'C8' : 'none', missClass: recovered === true ? null : 'unmeasured', partialWithoutExact: false })
    const branch = (h: Parameters<typeof row>[1], t: Parameters<typeof row>[1], d = b2d, invalid = false) => phase2c26b2c2b2eNextBranch({ invalid, rows: [row(heap, h), row(time, t)], b2c2b2d: d })
    expect(branch(true, true).branch).toBe('A')
    expect(branch(false, true).branch).toBe('B')
    expect(branch(true, false).branch).toBe('C')
    expect(branch(false, false).branch).toBe('D')
    expect(branch('miss', 'miss').branch).toBe('D')
    expect(branch('miss', 'miss').perTarget.map(t => t.result)).toEqual(['measured_without_exact', 'measured_without_exact'])
    expect(branch(false, true).perTarget).toEqual([{ targetWeaponId: 'h', taskId: 't00-r17', type: 'heap_growth', b2c2b2cSameContextProcess: 'out_of_memory', result: 'timeout' },
      { targetWeaponId: 't', taskId: 't02-r11', type: 'time_bound', b2c2b2cSameContextProcess: 'timeout', result: 'recovered' }])
    expect(branch(true, 'not_run').branch).toBeNull()
    expect(branch(true, true, b2d, true).branch).toBeNull()
    // With an ambiguous type assignment, A and D still hold but B / C are not decided.
    const ambiguous = b2dAuthorityFor([heap, time], { b2c2b2c: ['timeout', 'timeout'] })
    expect(branch(false, true, ambiguous).branch).toBeNull()
    expect(branch(true, true, ambiguous).branch).toBe('A')
    expect(branch(false, false, ambiguous).branch).toBe('D')
    expect(branch(false, true).meaning).toMatch(/heap_growth-Target profiling/)
    expect(branch(false, false).meaning).toMatch(/16 GB heap retry is never the automatic next step/)
  })

  it('states E1 11 / 11 only under oracle-guided diagnostic conditions when every E1 Route recovered, keeping the common ladder at 9 / 11', () => {
    const { b2c2b1, b2c1, b2c2b2b, b2c2b2c, b2c2b2d } = authorities()
    const derived = phase2c26b2c2b2eProbes(b2c2b1, b2c1, b2c2b1Json, b2c2b2b, b2c2b2c, b2c2b2d)
    const e1 = (b2c2b1Json.routes as Json[]).filter(r => r.cohort === 'E1').map(r => r.targetWeaponId as string)
    const l1 = [...b2c2b2b.targetWeaponIds], l2 = [...b2c2b2d.targetWeaponIds]
    const rowsWith = (hits: boolean[]) => derived.probes.map((p, i) => ({ targetWeaponId: p.targetWeaponId, hit: { C8: false, C32: hits[i]!, C4C: hits[i]! }, recovery: hits[i] ? 'C32' : 'none' }) as unknown as Phase2C26B2C2B2ETargetRow)
    const all = phase2c26b2c2b2eE1Aggregate({ e1, l1, l2, b2c2b2b, b2c2b2d, rows: rowsWith([true, true]), decision: 'B2C2B2E_ALL_C32', evidenceGrade: 'formal' })
    expect(all.issues).toEqual([])
    expect(all.diagnostic.total.C4C).toEqual({ recovered: 11, of: 11 })
    expect(all.diagnostic.allRecovered).toBe(true)
    expect(all.diagnostic.statement).toMatch(/^E1 11 \/ 11 exact oracle Routes have now been delivered at least under oracle-guided diagnostic conditions/)
    expect(all.diagnostic.statement).toMatch(/60 minutes \/ 12 GB/)
    expect(all.diagnostic.statementScope).toMatch(/not "11 \/ 11 under the registered common L1 \/ L2 ladder"/)
    expect(all.commonLadder.total.C4C).toEqual({ recovered: 9, of: 11 })
    expect(all.commonLadder.statement).toBeNull()
    expect(all.diagnostic.l2.fromB2C2B2D.targets).toBe(2)
    expect(all.diagnostic.previous.C4C).toEqual({ recovered: 9, of: 11 })
    const one = phase2c26b2c2b2eE1Aggregate({ e1, l1, l2, b2c2b2b, b2c2b2d, rows: rowsWith([false, true]), decision: 'B2C2B2E_INCOMPLETE', evidenceGrade: 'formal' })
    expect(one.diagnostic.total.C4C).toEqual({ recovered: 10, of: 11 })
    expect(one.diagnostic.statement).toBeNull()
    const none = phase2c26b2c2b2eE1Aggregate({ e1, l1, l2, b2c2b2b, b2c2b2d, rows: rowsWith([false, false]), decision: 'B2C2B2E_INCOMPLETE', evidenceGrade: 'formal' })
    expect(none.diagnostic.total).toEqual(b2c2b2d.e1.diagnostic)
    // Re-running a Target B2-C2B2D recovered breaks the partition.
    const recoveredId = b2c2b2d.targets.find(t => t.recovery !== 'none')!.targetWeaponId
    const wrong = phase2c26b2c2b2eE1Aggregate({ e1, l1, l2, b2c2b2b, b2c2b2d, rows: [{ ...rowsWith([true])[0]!, targetWeaponId: recoveredId }], decision: null, evidenceGrade: 'formal' })
    expect(wrong.issues.join()).toMatch(/re-ran a Target B2-C2B2D recovered/)
    expect(wrong.diagnostic.statement).toBeNull()
    expect(PHASE2C26B2C2B2E_E1_DIAGNOSTIC_LIMITATIONS.join(' ')).toMatch(/stays C4C 9 \/ 11/)
  })

  it('summarizes the memory log as running maxima: checkpoints, yield rates, 90 % / 99 % of the peak and a last-third plateau', () => {
    const sample = (sec: number, gb: number, yields: number): Phase2C26B2C2B2EMemorySample => ({ receivedAtMs: sec * 1000, maxima: { samples: sec * 4, maxHeapUsedBytes: gb * 1e9, maxRssBytes: gb * 1.1e9, lastElapsedMs: sec * 1000 }, yields })
    const growing = phase2c26b2c2b2eTrajectory(Array.from({ length: 61 }, (_, i) => sample(i * 60, 1 + i * 0.15, i * 100_000)))
    expect(growing.checkpoints.find(c => c.atMs === 600_000)).toMatchObject({ receivedAtMs: 600_000, maxHeapUsedBytes: 2.5e9, yields: 1_000_000 })
    expect(growing.checkpoints.find(c => c.atMs === 3_600_000)).toMatchObject({ receivedAtMs: 3_600_000 })
    expect(growing.yieldsPerSecond[0]!.value).toBeCloseTo(100_000 / 60)
    expect(growing.heapPlateauInLastThird).toBe(false)
    expect(growing.heapReached99PctAtMs).toBeGreaterThan(3_500_000)
    const flat = phase2c26b2c2b2eTrajectory(Array.from({ length: 61 }, (_, i) => sample(i * 60, Math.min(5, 1 + i), i * 300_000)))
    expect(flat.heapPlateauInLastThird).toBe(true)
    expect(flat.heapReached90PctAtMs).toBe(240_000)
    // A child that ended early leaves the later checkpoints and windows null (never 0).
    const short = phase2c26b2c2b2eTrajectory([sample(0, 1, 0), sample(60, 2, 10), sample(120, 3, 20)])
    expect(short.checkpoints.filter(c => c.atMs >= 300_000).every(c => c.receivedAtMs === null && c.maxHeapUsedBytes === null)).toBe(true)
    expect(short.yieldsPerSecond.every(w => w.value === null)).toBe(true)
    expect(short.heapPlateauInLastThird).toBeNull()
    expect(phase2c26b2c2b2eTrajectory([])).toMatchObject({ samples: 0, peakHeapBytes: null, heapReached90PctAtMs: null })
  })
})

// ---------------------------------------------------------------- the committed RESULT

describe('Phase 2-C2.6-B2-C2B2E committed RESULT', () => {
  const result = JSON.parse(rawResult)
  const MEASURED_HEAD = 'e69a94ea0fdd1ef39a39286dffab1bfc44fb1f0b'
  type TargetJson = Json & { paired: { b2c2b2e: { peakHeapBytes: number; wallMs: number } }; trajectory: { heapPlateauInLastThird: boolean | null } }
  const byTask = (id: string) => (result.targets as TargetJson[]).find(t => t.taskId === id)!

  it('pins the formal run: runner-attested launch at the measurement HEAD before any child, 60 minutes / 12,288 MB, 2 / 2 started, INCOMPLETE with no invalid reason, the oracle-guided flags true', () => {
    expect(result.provenance).toMatchObject({ formal: true, evidenceGrade: 'formal', partialRun: false, launchProvenanceVerified: true, launchProvenanceSource: 'runner_start_attestation',
      launchProvenanceIssues: [], launchProvenanceIntegrityIssues: [], launchWorkingTreeCleanVerified: true, measuredHead: MEASURED_HEAD, measuredHeadSource: 'runner_start_attestation',
      measuredHeadIsAncestor: true, uncommittedBenchmarkCode: false, smoke: null, calculationCodeChangedSinceMeasuredHead: [], measurementCodeChangedSinceMeasuredHead: [],
      b2c2b2dResultSha256: sha.b2c2b2d, b2c2b2cResultSha256: sha.b2c2b2c, b2c2b1ResultSha256: sha.b2c2b1, exportSha256: exportSha,
      oracleGuidedTargetPopulation: true, oracleGuidedContextSelection: true, oracleInformedPerTargetExtent: true, targetIndividualOracleExtentAsSearchInput: true, perTargetExtent: true,
      productionSchedulerEvidence: false, productionExtentSelectionEvidence: false })
    expect(result.provenance.benchmarkCodeSha256).toBe(result.provenance.recomputedBenchmarkCodeSha256)
    const attestation = result.provenance.startAttestation.body
    expect(attestation).toMatchObject({ attestedBy: 'runner', phase: PHASE2C26B2C2B2E_START_ATTESTATION_PHASE, repositoryHead: MEASURED_HEAD, uncommittedBenchmarkCode: false, smoke: null,
      stage1: { childHeapMb: 12_288, budgetMs: 3_600_000, concurrency: 1, retry: 'none', fallback: 'none' }, b2c2b2dStage1: PHASE2C26B2C2B2D_STAGE1, changedStage1Fields: ['budgetMs', 'childHeapMb'],
      expectedTasks: 2, candidateSafetyCap: 1024, captureRule: { policy: 'C4C', maxCostCohorts: 4 }, probeManifestB2C2B2DResultSha256: sha.b2c2b2d })
    // createdAt <= the tasks child start is part of the verification the analyzer recorded as launchProvenanceVerified.
    expect(attestation.createdAt).toBe(result.provenance.measuredAt)
    expect(result.provenance.recordedStartAttestation.sha256).toBe(result.provenance.startAttestation.sha256)
    expect(Object.values(result.parity.hashChain).every(v => v === true)).toBe(true)
    expect(Object.entries(result.parity.scheduleParity).filter(([, v]) => v === false)).toEqual([])
    expect(Object.values(result.conditions.conditionChecks).every(v => v === true)).toBe(true)
    expect(result.conditions.stage1).toEqual(PHASE2C26B2C2B2E_STAGE1)
    expect(result.decision.case).toBe('B2C2B2E_INCOMPLETE')
    expect(result.invalidReasons).toEqual([])
    expect(result.aggregates.measurementCompleteness).toMatchObject({ status: 'incomplete', tasks: 2, measured: 1, unmeasured: 1, breakdown: { timeout: 1, outOfMemory: 0, processFailure: 0, notRun: 0, contextMismatch: 0 } })
  })

  it('pins the population and probes as B2-C2B2D\'s unmeasured unrecovered Targets at B2-C2B2D\'s rank, tight extent, task ID and Search input digests', () => {
    const { b2c2b1, b2c1, b2c2b2b, b2c2b2c, b2c2b2d } = authorities()
    const derived = phase2c26b2c2b2eProbes(b2c2b1, b2c1, b2c2b1Json, b2c2b2b, b2c2b2c, b2c2b2d)
    expect(result.parity.population).toMatchObject({ manifestEqualsDerivedProbes: true, populationIsB2C2B2DUnmeasuredUnrecovered: true, targets: 2, previouslyUnrecovered: 2, previouslyRecovered: 2, otherwiseUnrecovered: 0 })
    expect(result.conditions.probes).toEqual(derived.probes)
    for (const row of result.taskRows as Json[]) {
      const d = (b2c2b2dJson.taskRows as Json[]).find(r => r.targetWeaponId === row.targetWeaponId)!
      for (const field of ['taskId', 'contextRank', 'groupIndex', 'reservationDigest', 'representativeFixedSetId', 'defaultSearchInputDigest', 'searchInputDigest', 'extent']) expect(row[field]).toEqual(d[field])
    }
    expect((result.parity.pairedIdentity as Json[]).every(p => p.matches === true && (p.excludedRouteKeyComparison as Json).verified === true)).toBe(true)
  })

  it('pins the outcome: the heap-growth Target recovered at C8 (index 0, cost 128) within 60 minutes / 12 GB, the time-bound Target timed out again (unmeasured, never Candidate 0), branch C, E1 diagnostic C4C 10 / 11 and the common ladder 9 / 11', () => {
    expect(result.aggregates.exactTargets).toEqual({ C8: 1, C32: 1, C4C: 1 })
    expect(byTask('t00-r17')).toMatchObject({ type: 'heap_growth', process: 'completed', termination: 'candidate_safety_cap', recovery: 'C8', firstExactIndex: 0, firstExactCost: 128, oracleOperationCost: 128,
      paired: { outcomeTransition: 'timeout -> completed', b2c2b2cSameContextProcess: 'out_of_memory' } })
    expect(byTask('t02-r11')).toMatchObject({ type: 'time_bound', process: 'timeout', measured: false, candidateCount: null, coverage: null, recovery: 'none', missClass: 'unmeasured',
      paired: { outcomeTransition: 'timeout -> timeout', b2c2b2cSameContextProcess: 'timeout' } })
    expect(byTask('t00-r17').paired.b2c2b2e.peakHeapBytes).toBeGreaterThan(8192 * 2 ** 20)
    expect(byTask('t02-r11').paired.b2c2b2e.wallMs).toBeGreaterThanOrEqual(3_600_000)
    expect(byTask('t02-r11').trajectory.heapPlateauInLastThird).toBe(true)
    expect(result.nextBranch).toMatchObject({ branch: 'C', typesUnambiguous: true, recoveredOf: { recovered: 1, of: 2 } })
    expect(result.e1Aggregate.commonLadder.total.C4C).toEqual({ recovered: 9, of: 11 })
    expect(result.e1Aggregate.diagnostic.total).toEqual({ C8: { recovered: 8, of: 11 }, C32: { recovered: 9, of: 11 }, C4C: { recovered: 10, of: 11 } })
    expect(result.e1Aggregate.diagnostic.allRecovered).toBe(false)
    expect(result.e1Aggregate.diagnostic.statement).toBeNull()
    expect(result.e1Aggregate.diagnostic.l2.fromB2C2B2E.decision).toBe('B2C2B2E_INCOMPLETE')
  })
})

// ---------------------------------------------------------------- isolation and provenance

describe('Phase 2-C2.6-B2-C2B2E isolation and provenance', () => {
  it('is never imported by Production and hard-codes no Target, Entry, OwnedWeapon, reservation, task, rank or extent value of the population', () => {
    const production = import.meta.glob(['../domain/**/*.ts', '../services/**/*.ts', '../workers/**/*.ts', '../pages/**/*.tsx', '../components/**/*.tsx', '../db/**/*.ts', '!../**/*.test.ts', '!../**/*.test.tsx'],
      { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    expect(Object.keys(production).length).toBeGreaterThan(50)
    expect(Object.entries(production).filter(([, source]) => /plannerGlobalPhase2C26B2C2B2E/.test(source)).map(([path]) => path)).toEqual([])
    for (const source of [searchSource, targetsSource, analysisSource, prepareSource, runnerSource, analyzerSource, reconstructSource]) {
      expect(source).not.toMatch(/\bc\d+-p\d+\b|fnv1a32[-:][0-9a-f]{8}|[0-9a-f]{8}-[0-9a-f]{4}-|build-list\.|070a1222|188571a7|a367c177|d453ca34/)
      expect(source).not.toMatch(/\bt0\d-r\d\d\b/)
      // No tight extent value or rank of the population is written down (they are derived).
      expect(source).not.toMatch(/\b(126|450|1083)\b/)
    }
    for (const source of [searchSource, targetsSource, analysisSource]) expect(source).not.toMatch(/node:fs|readFile|import\.meta\.glob/)
  })

  it('keeps the oracle, its manifest, every earlier RESULT and B2-C2B2D\'s measurements out of the Search side; the Search child never learns what counts as success', () => {
    for (const source of [searchSource, runnerSource]) {
      expect(source).not.toMatch(/ORACLE_[1]657|1657|--oracle|--manifest|--b2c2b1-result|--b2c1-result|--b2b1-result|--b2c2b2b-result|--b2c2b2c-result|--b2c2b2d-result|gogmaUsage|plannerGlobal[O]racle|_RESULT|phase2c2OracleCoverage|Analysis'|Targets'|phase2c26b2c2b1Covers|expectedStableKey|expectedCandidateIndex|expectedOperationCost|peakHeapBytes|lastIpcYields\b.*b2c2b2d/)
    }
    expect(searchSource).not.toMatch(/plannerGlobalPhase2C26B2C2B2[A-E]Targets|plannerGlobalPhase2C26B2C2B2[A-E]Analysis|plannerGlobalPhase2C26B2C2B1Analysis|plannerGlobalPhase2C26B2C1Analysis/)
    expect(runnerSource).toMatch(/--probes/)
    expect(runnerSource).toMatch(/\.\.\.c2b2e\.PHASE2C26B2C2B2E_PROVENANCE_FLAGS/)
    expect(prepareSource).toMatch(/--b2c2b2d-result/)
    expect(prepareSource).not.toMatch(/--oracle|--manifest|visitPlannerAlternativeCandidates/)
    expect(analyzerSource).toMatch(/--oracle/)
    expect(analysisSource).toMatch(/phase2c26b2c2b2aCompareContext\(/)
    expect(targetsSource).toMatch(/phase2c26b2c2b2dProbes\(b2c2b1, b2c1, b2c2b1Json, b2c2b2b, b2c2b2c\)/)
  })

  it('captures through B2-C2B2D\'s unchanged Search body and C4C capture, with no early stop, retry or fallback added', () => {
    // The B2-C2B2E Search module holds no Search body of its own: it re-exports B2-C2B2D's child calculation.
    expect(searchSource).not.toMatch(/visitPlannerAlternativeCandidates|createPhase2C26B2C2ACapture|'stop'/)
    expect(searchSource).toMatch(/export const runPhase2C26B2C2B2ETask = runPhase2C26B2C2B2DTask/)
    expect(runPhase2C26B2C2B2ETask).toBe(runPhase2C26B2C2B2DTask)
    expect(typeof runPhase2C26B2C2B2DSearch).toBe('function')
    for (const source of [searchSource, analysisSource, runnerSource, analyzerSource]) {
      expect(source).not.toMatch(/runPreparedPlannerAlternativeKernel|preparePlannerAlternativeKernel|createProductionPlan|runPhase2C2Kernel|runPhase2C2Baseline|runPlannerDeterministicSchedule|createPlannerAlternativeWhatIfComparison|searchCandidates\(/)
    }
    for (const source of [analysisSource, analyzerSource, targetsSource, prepareSource]) expect(source).not.toMatch(/visitPlannerAlternativeCandidates|runPhase2C26B2C2B2DSearch|runPhase2C26B2C2B2[DE]Task\(/)
  })
})
