import { beforeEach, describe, expect, it, vi } from 'vitest'
import rawB2C2B2E from '../../docs/PLANNER_GLOBAL_PHASE2C26B2C2B2E_RESULT.json?raw'
import rawB2C2B2F from '../../docs/PLANNER_GLOBAL_PHASE2C26B2C2B2F_RESULT.json?raw'
import rawB2C2B2G from '../../docs/PLANNER_GLOBAL_PHASE2C26B2C2B2G_RESULT.json?raw'
import bonusStreamSource from '../domain/search/bonusStream.ts?raw'
import searchExecutionSource from '../domain/search/searchExecution.ts?raw'
import engineSource from '../domain/rng/production/productionRngEngine.ts?raw'
import gogmaPredictionSource from '../domain/rng/production/gogmaPrediction.ts?raw'
import gameGogmaSource from '../domain/rng/production/gameGogmaBonuses.ts?raw'
import familySource from '../domain/rng/gogmaBonusFamily.ts?raw'
import type { TargetWeapon } from '../domain/models/publicTypes'
import type { PlannerAlternativeSearchExecution } from '../domain/search'
import { RESERVED_GOGMA_RUNTIME_PHASES, type ReservedGogmaRuntimeEvent } from '../domain/search/bonusStream'
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
import { PHASE2C26A5_PROFILER } from './plannerGlobalPhase2C26A5'
import { createPhase2C26A5ScriptTable, type CpuProfile, type CpuProfileNode } from './plannerGlobalPhase2C26A5Analysis'
import { PHASE2C26A7_SEARCH_INSTRUMENTATION } from './plannerGlobalPhase2C26A7'
import { derivePhase2C26B2C1Schedule } from './plannerGlobalPhase2C26B2C1'
import { runPhase2C26B2C2B2DTask } from './plannerGlobalPhase2C26B2C2B2D'
import { buildPhase2C26B2C2B2ETasks, type Phase2C26B2C2B2EProbe } from './plannerGlobalPhase2C26B2C2B2E'
import { phase2c26b2c2b2fTaskIdentity, type Phase2C26B2C2B2FTaskIdentity } from './plannerGlobalPhase2C26B2C2B2F'
import { parsePhase2C26B2C2B2FB2C2B2EAuthority, PHASE2C26B2C2B2F_REGISTERED_B2C2B2E } from './plannerGlobalPhase2C26B2C2B2FTargets'
import {
  buildPhase2C26B2C2B2GTasks,
  createPhase2C26B2C2B2GProfiler,
  runPhase2C26B2C2B2GTask,
  PHASE2C26B2C2B2G_SEARCH_INSTRUMENTATION,
  PHASE2C26B2C2B2G_STAGE1,
  type Phase2C26B2C2B2GProfileSnapshot,
} from './plannerGlobalPhase2C26B2C2B2G'
import {
  parsePhase2C26B2C2B2GB2C2B2FAuthority,
  phase2c26b2c2b2gPopulation,
  PHASE2C26B2C2B2G_REGISTERED_B2C2B2F,
} from './plannerGlobalPhase2C26B2C2B2GTargets'
import {
  buildPhase2C26B2C2B2HTasks,
  createPhase2C26B2C2B2HProfiler,
  parsePhase2C26B2C2B2HProbeManifest,
  phase2c26b2c2b2hBoundaryRecord,
  phase2c26b2c2b2hRegisteredConditions,
  phase2c26b2c2b2hStartAttestationBody,
  runPhase2C26B2C2B2HTask,
  verifyPhase2C26B2C2B2HStartAttestation,
  PHASE2C26B2C2B2H_CHANGED_FROM_B2C2B2G,
  PHASE2C26B2C2B2H_CPU_PROFILER,
  PHASE2C26B2C2B2H_EXPECTED_TASKS,
  PHASE2C26B2C2B2H_NODE_FLAGS,
  PHASE2C26B2C2B2H_NOT_RUN,
  PHASE2C26B2C2B2H_PROVENANCE_FLAGS,
  PHASE2C26B2C2B2H_SEARCH_INSTRUMENTATION,
  PHASE2C26B2C2B2H_SECTION,
  PHASE2C26B2C2B2H_STAGE1,
  PHASE2C26B2C2B2H_START_ATTESTATION_PHASE,
  type Phase2C26B2C2B2HAttestationExpectation,
  type Phase2C26B2C2B2HBoundaryRecord,
} from './plannerGlobalPhase2C26B2C2B2H'
import searchSource from './plannerGlobalPhase2C26B2C2B2H.ts?raw'
import {
  parsePhase2C26B2C2B2HB2C2B2GAuthority,
  phase2c26b2c2b2hPopulation,
  phase2c26b2c2b2hProbeManifest,
  PHASE2C26B2C2B2H_REGISTERED_B2C2B2G,
} from './plannerGlobalPhase2C26B2C2B2HTargets'
import targetsSource from './plannerGlobalPhase2C26B2C2B2HTargets.ts?raw'
import {
  derivePhase2C26B2C2B2HFunctionSpans,
  derivePhase2C26B2C2B2HStateGenerationBlock,
  normalizePhase2C26B2C2B2HUrl,
  resolvePhase2C26B2C2B2HFrame,
  PHASE2C26B2C2B2H_FUNCTION_REGISTRY,
  PHASE2C26B2C2B2H_REQUIRED_SOURCE_FILES,
  type Phase2C26B2C2B2HFrame,
} from './plannerGlobalPhase2C26B2C2B2HCpuProfile'
import structureSource from './plannerGlobalPhase2C26B2C2B2HCpuProfile.ts?raw'
import {
  analyzePhase2C26B2C2B2HProfile,
  classifyPhase2C26B2C2B2HStack,
  phase2c26b2c2b2hConditionIssues,
  phase2c26b2c2b2hDecision,
  phase2c26b2c2b2hDepthParity,
  phase2c26b2c2b2hProfileQuality,
  phase2c26b2c2b2hYieldWait,
  reconstructPhase2C26B2C2B2HIntervals,
  PHASE2C26B2C2B2H_CATEGORIES,
  PHASE2C26B2C2B2H_DECISION_CASES,
  PHASE2C26B2C2B2H_DOMINANT_THRESHOLD,
  PHASE2C26B2C2B2H_MIN_PROFILE_DURATION_MS,
  PHASE2C26B2C2B2H_MIN_STATE_GENERATION_SAMPLES,
  PHASE2C26B2C2B2H_SECONDARY_THRESHOLD,
  type Phase2C26B2C2B2HCaptureFacts,
  type Phase2C26B2C2B2HCategory,
  type Phase2C26B2C2B2HProfileAnalysis,
} from './plannerGlobalPhase2C26B2C2B2HAnalysis'
import analysisSource from './plannerGlobalPhase2C26B2C2B2HAnalysis.ts?raw'
import prepareSource from '../../scripts/prepare-planner-global-phase2c26b2c2b2h-probes.mjs?raw'
import runnerSource from '../../scripts/run-planner-global-phase2c26b2c2b2h.mjs?raw'
import analyzerSource from '../../scripts/analyze-planner-global-phase2c26b2c2b2h.mjs?raw'

/*
 * Issue #154 Phase 2-C2.6-B2-C2B2H: CPU attribution inside the held-aware state_generation section of the one B2-C2B2G
 * STATE_GENERATION-dominant Target, in B2-C2B2G's exact Search input. The synthetic worlds and CPU profiles below are invented for the
 * tests; the committed B2-C2B2G / B2-C2B2F / B2-C2B2E RESULTs are read only to check the authorities and the population derivation.
 * No oracle module is imported here.
 */

/** Every Search call's execution options, in call order; the real Search always runs. */
const searchCalls = vi.hoisted(() => ({ options: [] as unknown[] }))
vi.mock('../domain/search/alternative/plannerAlternativeSearch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../domain/search/alternative/plannerAlternativeSearch')>()
  return {
    ...actual,
    visitPlannerAlternativeCandidates: async (...args: Parameters<typeof actual.visitPlannerAlternativeCandidates>): Promise<PlannerAlternativeSearchExecution> => {
      const [input, engine, onCandidate, options] = args
      searchCalls.options.push(options === undefined ? undefined : { keys: Object.keys(options).sort(), instrumentationKeys: options.instrumentation === undefined ? null : Object.keys(options.instrumentation).sort() })
      return actual.visitPlannerAlternativeCandidates(input, engine, onCandidate, options)
    },
  }
})
beforeEach(() => { searchCalls.options = [] })

type Json = Record<string, unknown>
const sha256 = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))).map(b => b.toString(16).padStart(2, '0')).join('')
const gJson = JSON.parse(rawB2C2B2G)
const fJson = JSON.parse(rawB2C2B2F)
const eJson = JSON.parse(rawB2C2B2E)
const parsedF = parsePhase2C26B2C2B2GB2C2B2FAuthority(fJson, PHASE2C26B2C2B2G_REGISTERED_B2C2B2F.resultSha256)
const parsedE = parsePhase2C26B2C2B2FB2C2B2EAuthority(eJson, PHASE2C26B2C2B2F_REGISTERED_B2C2B2E.resultSha256)
const gWith = (patch: (j: Json & { decision: Json; provenance: Json; parity: Json; population: Json; conditions: Json; sources: Json }) => void) => {
  const copy = structuredClone(gJson)
  patch(copy)
  return parsePhase2C26B2C2B2HB2C2B2GAuthority(copy, PHASE2C26B2C2B2H_REGISTERED_B2C2B2G.resultSha256)
}
const SLOW = 120_000
const SOURCES: Record<string, string> = {
  'src/domain/search/bonusStream.ts': bonusStreamSource, 'src/domain/search/searchExecution.ts': searchExecutionSource,
  'src/domain/rng/production/productionRngEngine.ts': engineSource, 'src/domain/rng/production/gogmaPrediction.ts': gogmaPredictionSource,
  'src/domain/rng/production/gameGogmaBonuses.ts': gameGogmaSource, 'src/domain/rng/gogmaBonusFamily.ts': familySource,
}

// ---------------------------------------------------------------- population and probe manifest

describe('Phase 2-C2.6-B2-C2B2H population, probe and manifest', () => {
  it('reads the committed B2-C2B2G RESULT as the registered formal authority, failing closed on another SHA-256, case, dominant, next phase, Stage 1, instrumentation, profiler, chain or identity', async () => {
    expect(await sha256(rawB2C2B2G)).toBe(PHASE2C26B2C2B2H_REGISTERED_B2C2B2G.resultSha256)
    expect(await sha256(rawB2C2B2F)).toBe(PHASE2C26B2C2B2H_REGISTERED_B2C2B2G.b2c2b2fResultSha256)
    expect(await sha256(rawB2C2B2E)).toBe(PHASE2C26B2C2B2H_REGISTERED_B2C2B2G.b2c2b2eResultSha256)
    const parsed = parsePhase2C26B2C2B2HB2C2B2GAuthority(gJson, PHASE2C26B2C2B2H_REGISTERED_B2C2B2G.resultSha256)
    expect(parsed.issues).toEqual([])
    expect(parsed.authority).toMatchObject({ decisionCase: 'B2C2B2G_STATE_GENERATION_DOMINANT', dominant: 'state_generation', nextPhaseSections: ['state_generation'],
      measuredHead: PHASE2C26B2C2B2H_REGISTERED_B2C2B2G.measuredHead, b2c2b2fResultSha256: PHASE2C26B2C2B2G_REGISTERED_B2C2B2F.resultSha256,
      b2c2b2eResultSha256: PHASE2C26B2C2B2F_REGISTERED_B2C2B2E.resultSha256, profileFile: gJson.sources.profile && { file: gJson.sources.profile.file, sha256: gJson.sources.profile.sha256 } })
    expect(parsed.authority!.targetWeaponIds).toHaveLength(1)
    expect(parsed.authority!.background.stateGenerationMs).toBeGreaterThan(0)
    expect(parsePhase2C26B2C2B2HB2C2B2GAuthority(gJson, '0'.repeat(64)).valid).toBe(false)
    expect(gWith(j => { j.decision.case = 'B2C2B2G_MIXED' }).valid).toBe(false)
    expect(gWith(j => { j.decision.dominant = 'frontier_reduction_sort' }).valid).toBe(false)
    expect(gWith(j => { j.decision.nextPhaseSections = ['state_generation', 'solution_materialization'] }).valid).toBe(false)
    expect(gWith(j => { j.provenance.formal = false }).valid).toBe(false)
    expect(gWith(j => { j.provenance.partialRun = true }).valid).toBe(false)
    expect(gWith(j => { j.provenance.measuredHead = 'f'.repeat(40) }).valid).toBe(false)
    expect(gWith(j => { j.provenance.b2c2b2fResultSha256 = '1'.repeat(64) }).valid).toBe(false)
    expect(gWith(j => { j.invalidReasons = ['x'] }).valid).toBe(false)
    expect(gWith(j => { j.conditions.stage1 = { ...PHASE2C26B2C2B2G_STAGE1, budgetMs: 3_600_000 } }).valid).toBe(false)
    expect(gWith(j => { j.conditions.searchInstrumentation = { ...PHASE2C26A7_SEARCH_INSTRUMENTATION, onGogmaReservedDepth: true } }).valid).toBe(false)
    expect(gWith(j => { j.conditions.cpuProfiler = true }).valid).toBe(false)
    expect(gWith(j => { (j.parity.hashChain as Json).exportMatchesRunner = false }).valid).toBe(false)
    expect(gWith(j => { (j.parity.childIdentity as Json).searchInputDigest = false }).valid).toBe(false)
    expect(gWith(j => { (j.parity.identity as Json).rawEqualsExpected = false }).valid).toBe(false)
    expect(gWith(j => { (j.parity.excludedRoute as Json).childAttestedExcludedRouteKeySha256 = '2'.repeat(64) }).valid).toBe(false)
    expect(gWith(j => { j.population.probes = [] }).valid).toBe(false)
    expect(gWith(j => { j.sources.profile = null }).valid).toBe(false)
  })

  it('derives the population mechanically from B2-C2B2G (STATE_GENERATION dominant, 1 Target) and chains it to the B2-C2B2G-derived (B2-C2B2F / B2-C2B2E) probe, identity and excluded Route; never a hard-coded Target', () => {
    const g = parsePhase2C26B2C2B2HB2C2B2GAuthority(gJson, PHASE2C26B2C2B2H_REGISTERED_B2C2B2G.resultSha256).authority
    const derived = phase2c26b2c2b2hPopulation(g, parsedF.authority, parsedE.authority)
    expect(derived.issues).toEqual([])
    expect(Object.values(derived.chain).every(v => v === true)).toBe(true)
    expect(derived.targetWeaponIds).toEqual(gJson.population.targetWeaponIds)
    expect(derived.targetWeaponIds).toHaveLength(PHASE2C26B2C2B2H_EXPECTED_TASKS)
    expect(derived.probes).toEqual(gJson.population.probes)
    expect(derived.expectedTaskIdentities).toEqual([gJson.parity.identity.expected])
    const fromG = phase2c26b2c2b2gPopulation(parsedF.authority, parsedE.authority)
    expect(derived.probes).toEqual(fromG.probes)
    expect(derived.expectedTaskIdentities).toEqual(fromG.expectedTaskIdentities)
    expect(derived.excludedRouteKeySha256).toBe(fromG.excludedRouteKeySha256)
    // Fail closed: a drifting probe / identity / excluded Route / Export, a missing authority, another decision.
    expect(phase2c26b2c2b2hPopulation({ ...g!, probes: [{ ...g!.probes[0]!, contextRank: g!.probes[0]!.contextRank + 1 }] }, parsedF.authority, parsedE.authority).issues.join()).toMatch(/probesEqualB2C2B2GDerived/)
    expect(phase2c26b2c2b2hPopulation({ ...g!, excludedRouteKeySha256: '3'.repeat(64) }, parsedF.authority, parsedE.authority).issues.join()).toMatch(/excludedRouteEqualsB2C2B2GDerived/)
    expect(phase2c26b2c2b2hPopulation({ ...g!, exportSha256: '4'.repeat(64) }, parsedF.authority, parsedE.authority).issues.join()).toMatch(/exportEqualsB2C2B2F/)
    expect(phase2c26b2c2b2hPopulation({ ...g!, b2c2b2fResultSha256: '5'.repeat(64) }, parsedF.authority, parsedE.authority).issues.join()).toMatch(/b2c2b2fAuthorityIsB2C2B2GAuthority/)
    expect(phase2c26b2c2b2hPopulation({ ...g!, decisionCase: 'B2C2B2G_MIXED' }, parsedF.authority, parsedE.authority).valid).toBe(false)
    expect(phase2c26b2c2b2hPopulation({ ...g!, targetWeaponIds: [] }, parsedF.authority, parsedE.authority).valid).toBe(false)
    expect(phase2c26b2c2b2hPopulation(null, parsedF.authority, parsedE.authority)).toMatchObject({ valid: false, targetWeaponIds: [] })
    expect(phase2c26b2c2b2hPopulation(g, null, parsedE.authority)).toMatchObject({ valid: false, targetWeaponIds: [] })
    expect(phase2c26b2c2b2hPopulation(g, parsedF.authority, null)).toMatchObject({ valid: false, targetWeaponIds: [] })
  })

  it('writes the probe and its expected Search input identity only (no expected key / index / cost / outcome / section / hotspot / measurement), exactly what the runner accepts', () => {
    const g = parsePhase2C26B2C2B2HB2C2B2GAuthority(gJson, PHASE2C26B2C2B2H_REGISTERED_B2C2B2G.resultSha256).authority!
    const manifest = phase2c26b2c2b2hProbeManifest(g, parsedF.authority!, parsedE.authority!)
    expect(Object.keys(manifest).sort()).toEqual(['b2c2b2eResultSha256', 'b2c2b2fResultSha256', 'b2c2b2gResultSha256', 'contextSelection', 'expectedTaskIdentities', 'exportSha256', 'extentRule',
      'phase', 'policy', 'population', 'probes'])
    expect(manifest).toMatchObject({ b2c2b2gResultSha256: PHASE2C26B2C2B2H_REGISTERED_B2C2B2G.resultSha256, b2c2b2fResultSha256: PHASE2C26B2C2B2G_REGISTERED_B2C2B2F.resultSha256,
      b2c2b2eResultSha256: PHASE2C26B2C2B2F_REGISTERED_B2C2B2E.resultSha256, population: 'B2C2B2G_STATE_GENERATION_DOMINANT_PROFILED_TARGET', exportSha256: gJson.provenance.exportSha256 })
    expect(manifest.expectedTaskIdentities).toEqual([gJson.parity.identity.expected])
    expect(JSON.stringify(manifest.probes) + JSON.stringify(manifest.expectedTaskIdentities)).not.toMatch(/stableKey|candidateIndex|operationCost|exact|coverage|oracle|required|route|timeout|memory|heap|yield|wall|bottleneck|section|dominant|state_generation|hotspot|sample|category/i)
    expect(parsePhase2C26B2C2B2HProbeManifest(structuredClone(manifest))).toMatchObject({ valid: true, issues: [] })
    const bad = (patch: (m: Json & typeof manifest) => void) => { const copy = structuredClone(manifest) as Json & typeof manifest; patch(copy); return parsePhase2C26B2C2B2HProbeManifest(copy).valid }
    expect(bad(m => { m.probes = [...m.probes, m.probes[0]!] })).toBe(false)
    expect(bad(m => { m.probes = [] })).toBe(false)
    expect(bad(m => { m.expectedTaskIdentities[0]!.contextRank += 1 })).toBe(false)
    expect(bad(m => { (m as Json).population = 'B2C2B2F_BONUS_DOMINANT_PROFILED_TARGET' })).toBe(false)
    expect(bad(m => { (m as Json).b2c2b2gResultSha256 = 'x' })).toBe(false)
    expect(bad(m => { (m as Json).b2c2b2fResultSha256 = 'x' })).toBe(false)
    expect(bad(m => { m.probes[0]!.extent = { maxNormalAdvance: 128, maxGogmaAdvance: 235, maxSkillAdvance: 1500 } })).toBe(false)
    for (const field of ['expectedStableKey', 'expectedSection', 'expectedHotspot', 'expectedCategory', 'a8Result', 'b2c2b2gStateGenerationMs']) {
      expect(bad(m => { (m.probes[0] as unknown as Json)[field] = 1 })).toBe(false)
      expect(bad(m => { (m.expectedTaskIdentities[0] as unknown as Json)[field] = 1 })).toBe(false)
      expect(bad(m => { m[field] = {} })).toBe(false)
    }
  })
})

// ---------------------------------------------------------------- registered conditions

describe('Phase 2-C2.6-B2-C2B2H registered conditions', () => {
  it('registers 1 task and B2-C2B2G\'s Stage 1 unchanged (30 minutes / 12,288 MB / concurrency 1 / no retry / no fallback), B2-C2B2G\'s two observers, and the CPU profiler as the only change', () => {
    expect(PHASE2C26B2C2B2H_EXPECTED_TASKS).toBe(1)
    expect(PHASE2C26B2C2B2H_SECTION).toBe('state_generation')
    expect(PHASE2C26B2C2B2H_STAGE1).toEqual({ executionClass: 'stage1', childHeapMb: 12_288, concurrency: 1, budgetMs: 1_800_000, retry: 'none', fallback: 'none' })
    expect(PHASE2C26B2C2B2H_STAGE1).toEqual(PHASE2C26B2C2B2G_STAGE1)
    expect(PHASE2C26B2C2B2H_SEARCH_INSTRUMENTATION).toBe(PHASE2C26B2C2B2G_SEARCH_INSTRUMENTATION)
    expect(PHASE2C26B2C2B2H_SEARCH_INSTRUMENTATION).toEqual({ onSearchRuntime: true, onGogmaReservedRuntime: true, onGogmaReservedDepth: false, onSkillReservedDepth: false, onWorkSettled: false })
    expect(PHASE2C26B2C2B2H_CHANGED_FROM_B2C2B2G).toEqual(['cpuProfiler'])
    expect(PHASE2C26B2C2B2H_CPU_PROFILER).toBe(PHASE2C26A5_PROFILER)
    expect(PHASE2C26B2C2B2H_CPU_PROFILER).toEqual({ requestedSamplingIntervalUs: 10_000, warmupMs: 120_000, profileStopMs: 720_000, requestedProfileDurationMs: 600_000 })
    expect(PHASE2C26B2C2B2H_NODE_FLAGS).toEqual(['--max-old-space-size=12288'])
    expect(PHASE2C26B2C2B2H_PROVENANCE_FLAGS).toMatchObject({ oracleReadBySearchChild: false, expectedOutcomeKnownBySearchChild: false, productionSchedulerEvidence: false, routeExactJudged: false,
      profilingOnly: true, cpuProfiling: true, absoluteRuntimeComparedWithB2C2B2G: false, optimization: false })
    for (const notRun of ['production_optimization', 'search_semantics_change', 'new_production_instrumentation_seam', 'per_state_timer_or_callback', 'no_inlining_diagnostic',
      'heap_allocation_profiler', 'heap_snapshot', 'heap_16gb', 'budget_60min_or_more', 'retry', 'timeout_fallback', 'extent_change', 'context_change', 'p1_change', 'e2_search',
      'k2_feature_grouping', 'residual_unreached_support', 'global_assignment', 'full_planner_rerun', 'ui_change', 'solution_materialization_optimization']) expect(PHASE2C26B2C2B2H_NOT_RUN).toContain(notRun)
    const ok = { smoke: false, runs: [{ taskId: 't', process: { budgetMs: 1_800_000, nodeFlags: ['--max-old-space-size=12288'] } }], cpuProfilerConfig: { ...PHASE2C26A5_PROFILER } }
    expect(phase2c26b2c2b2hConditionIssues(ok)).toEqual([])
    expect(phase2c26b2c2b2hConditionIssues({ ...ok, runs: [{ taskId: 't', process: { budgetMs: 3_600_000, nodeFlags: ['--max-old-space-size=12288'] } }] }).join()).toMatch(/budget/)
    expect(phase2c26b2c2b2hConditionIssues({ ...ok, runs: [{ taskId: 't', process: { budgetMs: 1_800_000, nodeFlags: ['--max-old-space-size=16384'] } }] }).join()).toMatch(/heap/)
    expect(phase2c26b2c2b2hConditionIssues({ ...ok, runs: [{ taskId: 't', process: { budgetMs: 1_800_000, nodeFlags: ['--no-turbo-inlining', '--no-maglev-inlining', '--max-old-space-size=12288'] } }] }).join()).toMatch(/Node flags/)
    expect(phase2c26b2c2b2hConditionIssues({ ...ok, runs: [{ taskId: 't', process: { budgetMs: 1_800_000, nodeFlags: ['--max-old-space-size=12288', '--cpu-prof'] } }] }).join()).toMatch(/CPU profiler/)
    expect(phase2c26b2c2b2hConditionIssues({ ...ok, runs: [ok.runs[0]!, ok.runs[0]!] }).join()).toMatch(/no retry/)
    expect(phase2c26b2c2b2hConditionIssues({ ...ok, cpuProfilerConfig: { ...PHASE2C26A5_PROFILER, warmupMs: 60_000 } }).join()).toMatch(/profiler window/)
  })
})

// ---------------------------------------------------------------- a synthetic world (B2-C2B2G's shape)

const SOURCE_A_SKILL = 'series_skill.fixture.z'
const SOURCE_B_SKILL = 'series_skill.fixture.b-source'
const L2 = { maxNormalAdvance: 128, maxGogmaAdvance: 235, maxSkillAdvance: 1500 }
const TIGHT = { maxNormalAdvance: 4, maxGogmaAdvance: 235, maxSkillAdvance: 64 }

function world() {
  const skill = { seriesSkillId: SOURCE_A_SKILL, groupSkillId: null, matchMode: 'all' as const }
  const a: TargetWeapon = orchestrationTarget('target.b2c2b2h.a', { priority: 5, idealSkillCondition: skill, practicalSkillCondition: skill })
  const b = skillConstrainedTarget('target.b2c2b2h.b', { priority: 1 })
  const built = orchestrationScenario({
    engine: { gogmaPositions: L2.maxGogmaAdvance + 8, skillPositions: L2.maxSkillAdvance + 8 },
    targets: [a, b],
    ownedWeapons: [orchestrationSource(ORCHESTRATION_SOURCE_A, { seriesSkillId: SOURCE_A_SKILL }),
      orchestrationSource(ORCHESTRATION_SOURCE_B, { restorationBonuses: belowPracticalBonuses(), seriesSkillId: SOURCE_B_SKILL })],
    entries: [
      orchestrationEntry('build-list.b2c2b2h.a', a, resetRoute(ORCHESTRATION_SOURCE_A), { finalBonuses: idealBonuses(), seriesSkillId: SOURCE_A_SKILL }),
      orchestrationEntry('build-list.b2c2b2h.b', b, { kind: 'existing_gogma_mixed', sourceOwnedWeaponId: resetRoute(ORCHESTRATION_SOURCE_B).sourceOwnedWeaponId,
        operations: [...resetRoute(ORCHESTRATION_SOURCE_B).operations, ...resetSkillsRoute(ORCHESTRATION_SOURCE_B).operations] }),
    ],
  })
  const schedule = derivePhase2C26B2C1Schedule(built.input, globalResearchDependencies(built.engine))
  return { built, schedule }
}
const PROBE: Phase2C26B2C2B2EProbe = { targetWeaponId: 'target.b2c2b2h.b', b2c2b2dTaskId: 't02-r02', contextRank: 2, extent: { ...TIGHT } }
function manifestFor(schedule: ReturnType<typeof world>['schedule']) {
  const built = buildPhase2C26B2C2B2ETasks(schedule, [PROBE])
  if (!built.valid) throw new Error(built.issues.join())
  return { probes: [PROBE], expectedTaskIdentities: [phase2c26b2c2b2fTaskIdentity(built.tasks[0]!)] }
}

describe('Phase 2-C2.6-B2-C2B2H task construction and child calculation', () => {
  it('builds B2-C2B2G\'s task (identity gate, 1 task), fails closed on identity drift, and runs B2-C2B2G\'s child calculation itself', () => {
    const { schedule } = world()
    const manifest = manifestFor(schedule)
    const ours = buildPhase2C26B2C2B2HTasks(schedule, manifest)
    expect(ours.issues).toEqual([])
    expect(ours.tasks).toEqual(buildPhase2C26B2C2B2GTasks(schedule, manifest).tasks)
    const drift = structuredClone(manifest)
    drift.expectedTaskIdentities[0]!.searchInputDigest = 'other'
    expect(buildPhase2C26B2C2B2HTasks(schedule, drift)).toMatchObject({ valid: false, tasks: [] })
    expect(buildPhase2C26B2C2B2HTasks(schedule, { ...manifest, expectedTaskIdentities: [] }).valid).toBe(false)
    expect(runPhase2C26B2C2B2HTask).toBe(runPhase2C26B2C2B2GTask)
  })

  it('changes no Search semantics: A (no instrumentation), B (B2-C2B2G\'s two observers) and C (B2-C2B2H\'s profiler, the same two observers) give the identical record; a failing section stream write never reaches the Search', async () => {
    const { built, schedule } = world()
    const task = buildPhase2C26B2C2B2HTasks(schedule, manifestFor(schedule)).tasks[0]!
    const a = await runPhase2C26B2C2B2DTask(built.input, schedule, task, built.engine, { now: () => 0 })
    let clockB = 0
    const profilerB = createPhase2C26B2C2B2GProfiler({ now: () => (clockB += 1) })
    profilerB.start()
    const b = await runPhase2C26B2C2B2GTask(built.input, schedule, task, built.engine, { now: () => 0, instrumentation: profilerB.instrumentation, yieldControl: profilerB.wrapYield(() => Promise.resolve()) })
    let clockC = 0
    const records: Phase2C26B2C2B2HBoundaryRecord[] = []
    const starts: number[] = []
    const profilerC = createPhase2C26B2C2B2HProfiler({ now: () => (clockC += 1), emitBoundary: record => { records.push(record) }, onSearchStarted: at => { starts.push(at) } })
    profilerC.start()
    const c = await runPhase2C26B2C2B2HTask(built.input, schedule, task, built.engine, { now: () => 0, instrumentation: profilerC.instrumentation, yieldControl: profilerC.wrapYield(() => Promise.resolve()) })
    let clockD = 0
    const profilerD = createPhase2C26B2C2B2HProfiler({ now: () => (clockD += 1), emitBoundary: () => { throw new Error('disk full') }, onSearchStarted: () => { throw new Error('controller') } })
    profilerD.start()
    const d = await runPhase2C26B2C2B2HTask(built.input, schedule, task, built.engine, { now: () => 0, instrumentation: profilerD.instrumentation, yieldControl: profilerD.wrapYield(() => Promise.resolve()) })
    if (a.status !== 'searched' || b.status !== 'searched' || c.status !== 'searched' || d.status !== 'searched') throw new Error('not searched')
    expect(a.search.candidates.length).toBeGreaterThan(0)
    expect(b).toEqual(a)
    expect(c).toEqual(a)
    expect(d).toEqual(a)
    // The instrumentation handed to the Search: none (A), then exactly the two boundary observers (B, C, D).
    const two = { keys: ['instrumentation', 'yieldControl'], instrumentationKeys: ['onGogmaReservedRuntime', 'onSearchRuntime'] }
    expect(searchCalls.options).toEqual([{ keys: ['yieldControl'], instrumentationKeys: null }, two, two, two])
    // The section stream: contiguous, one record per inner boundary, and it rebuilds one state_generation interval per completed depth.
    const snapshot = profilerC.snapshot('final')
    expect(records.map(r => r.seq)).toEqual(records.map((_, i) => i + 1))
    expect(snapshot.boundary).toEqual({ emitted: records.length, writeFailures: 0 })
    expect(snapshot.inner.events).toBe(records.length)
    expect(starts).toHaveLength(1)
    expect(snapshot.searchStartedResearchMs).toBe(starts[0])
    const reconstruction = reconstructPhase2C26B2C2B2HIntervals(records)
    expect(reconstruction.issues).toEqual([])
    expect(reconstruction.intervals.length).toBe(snapshot.inner.counts.completedDepths)
    expect(reconstruction.depthsCompleted).toBe(snapshot.inner.counts.completedDepths)
    expect(reconstruction.intervals.reduce((sum, i) => sum + (i.generatedStates ?? 0), 0)).toBe(snapshot.inner.counts.generatedStatesSum)
    expect(reconstruction.openInterval).toBeNull()
    expect(profilerD.snapshot('final').boundary.writeFailures).toBe(records.length + 1)
    // The profiler is B2-C2B2G's: the same inner / outer observation as B2-C2B2G's profiler on the same events.
    const g = profilerB.snapshot('final')
    expect(snapshot.inner.counts).toEqual(g.inner.counts)
    expect(phase2c26b2c2b2hDepthParity([g], [snapshot])).toMatchObject({ valid: true, commonDepths: g.inner.counts.completedDepths })
  }, SLOW)
})

// ---------------------------------------------------------------- the section stream and the intervals

const COUNTS = { frontierStatesBefore: 1, legalPositionCount: null, generatedStates: null, frontierStatesAfter: null, windowMemoEntries: 1 }
const ev = (type: ReservedGogmaRuntimeEvent['type'], depth: number, extra: object = {}): ReservedGogmaRuntimeEvent =>
  ({ type, streamIndex: 0, startGogmaCounter: 10, depth, counts: { ...COUNTS }, ...(type === 'depth_completed' ? { exhausted: false } : {}), ...extra }) as ReservedGogmaRuntimeEvent
/** A whole depth with every section, state_generation over [s, e), as boundary records from seq `seq0 + 1`. */
function depthRecords(depth: number, s: number, e: number, seq0 = 0, generated = 100): Phase2C26B2C2B2HBoundaryRecord[] {
  const events: [number, ReservedGogmaRuntimeEvent][] = [[s - 3, ev('depth_started', depth)]]
  let t = s - 3
  for (const phase of RESERVED_GOGMA_RUNTIME_PHASES) {
    const begin = phase === 'state_generation' ? s : t + 0.5
    const end = phase === 'state_generation' ? e : begin + 0.25
    events.push([begin, ev('phase_started', depth, { phase })])
    events.push([end, ev('phase_completed', depth, { phase, counts: { ...COUNTS, generatedStates: phase === 'state_generation' ? generated : null } })])
    t = end
  }
  events.push([t + 0.5, ev('depth_completed', depth, { counts: { ...COUNTS, generatedStates: generated } })])
  return events.map(([at, event], i) => phase2c26b2c2b2hBoundaryRecord(seq0 + i + 1, at, event))
}

describe('Phase 2-C2.6-B2-C2B2H state_generation intervals', () => {
  it('rebuilds [phase_started, phase_completed) of state_generation from the section stream and fails closed on a gap, reversal, missing boundary, order break or overlap', () => {
    const one = depthRecords(1, 10, 20)
    const two = depthRecords(2, 30, 45, one.length)
    const ok = reconstructPhase2C26B2C2B2HIntervals([...one, ...two])
    expect(ok).toMatchObject({ valid: true, issues: [], depthsCompleted: 2, openInterval: null })
    expect(ok.intervals).toEqual([{ streamIndex: 0, depth: 1, startMs: 10, endMs: 20, generatedStates: 100 }, { streamIndex: 0, depth: 2, startMs: 30, endMs: 45, generatedStates: 100 }])
    expect(ok.phaseCompletions.state_generation).toBe(2)
    // The record shape carries the counts only at a state_generation / depth completion.
    expect(one.filter(r => r.generatedStates !== null).map(r => r.type)).toEqual(['phase_completed', 'depth_completed'])
    // A budget kill inside state_generation leaves an open interval, not an issue.
    const killed = [...one, ...depthRecords(2, 30, 45, one.length).slice(0, 6)]
    expect(killed.at(-1)).toMatchObject({ type: 'phase_started', phase: 'state_generation' })
    expect(reconstructPhase2C26B2C2B2HIntervals(killed)).toMatchObject({ valid: true, openInterval: { depth: 2, startMs: 30 } })
    const renumber = (records: Phase2C26B2C2B2HBoundaryRecord[]) => records.map((r, i) => ({ ...r, seq: i + 1 }))
    const bad = (records: unknown[]) => reconstructPhase2C26B2C2B2HIntervals(records).valid
    expect(bad([...one.slice(0, 3), ...one.slice(4)])).toBe(false) // a gap in seq
    expect(one[5]).toMatchObject({ type: 'phase_started', phase: 'state_generation' })
    expect(one[6]).toMatchObject({ type: 'phase_completed', phase: 'state_generation' })
    expect(bad(renumber([...one.slice(0, 6), ...one.slice(7)]))).toBe(false) // state_generation completion missing
    expect(bad(renumber([...one.slice(0, 5), ...one.slice(6)]))).toBe(false) // state_generation start missing
    expect(bad(one.map(r => (r.seq === 7 ? { ...r, atMs: 5 } : r)))).toBe(false) // reversed (completion before start)
    expect(bad(renumber([one[0]!, one[3]!, one[4]!, one[1]!, one[2]!, ...one.slice(5)]))).toBe(false) // phase order break
    expect(bad(renumber([...one.slice(0, -1), ...two]))).toBe(false) // depth never completed
    expect(bad([...one, ...depthRecords(2, 15, 25, one.length)])).toBe(false) // overlapping intervals
    expect(bad([...one, { kind: 'something', seq: one.length + 1 }])).toBe(false)
    expect(bad(one.map(r => (r.seq === 2 ? { ...r, atMs: Number.NaN } : r)))).toBe(false)
  })
})

// ---------------------------------------------------------------- the profile structure (spans, block, frames)

describe('Phase 2-C2.6-B2-C2B2H profile structure', () => {
  it('derives every registered function span and the state_generation block (with its sub-blocks) from the current source text, failing closed on a missing or ambiguous declaration', () => {
    expect([...PHASE2C26B2C2B2H_REQUIRED_SOURCE_FILES].sort()).toEqual(Object.keys(SOURCES).sort())
    const spans = derivePhase2C26B2C2B2HFunctionSpans(SOURCES)
    expect(spans).toHaveLength(PHASE2C26B2C2B2H_FUNCTION_REGISTRY.length)
    for (const span of spans) {
      const lines = SOURCES[span.file]!.split(/\r?\n/)
      expect(lines[span.startLine - 1]).toContain(span.functionName)
      expect(span.endLine).toBeGreaterThanOrEqual(span.startLine)
    }
    const owner = spans.find(s => s.functionName === 'generateReservedDepth')!
    expect(bonusStreamSource.split(/\r?\n/)[owner.startLine - 1]).toMatch(/async function generateReservedDepth\(/)
    const advance = spans.find(s => s.functionName === 'advanceGogmaCounter')!
    expect(advance.endLine).toBe(advance.startLine) // a one-line class method
    const checkpoint = spans.find(s => s.functionName === 'checkpoint')!
    expect(searchExecutionSource.split(/\r?\n/)[checkpoint.startLine - 1]).toMatch(/checkpoint: async \(\) => \{/)
    expect(searchExecutionSource.split(/\r?\n/)[checkpoint.endLine - 1]).toMatch(/^\s+\},?$/)
    const block = derivePhase2C26B2C2B2HStateGenerationBlock(bonusStreamSource)
    expect(block.startLine).toBeGreaterThan(owner.startLine)
    expect(block.endLine).toBeLessThan(owner.endLine)
    expect(block.subBlocks.map(s => s.label)).toEqual(['block_head', 'sorted_position_loop', 'reset_branch', 'reset_parent_lookup', 'reset_parent_guard', 'reset_checkpoint', 'reset_prediction',
      'reset_counter_advance', 'reset_state_construction', 'frontier_scan', 'keep_eligibility_windows_has', 'keep_checkpoint', 'keep_prediction', 'keep_counter_advance', 'keep_state_construction',
      'generation_end'])
    const labelOf = (marker: string) => block.lines.find(l => l.text.includes(marker))?.label
    expect(labelOf('predictReset(position)')).toBe('reset_prediction')
    expect(labelOf('predictKeep(position')).toBe('keep_prediction')
    expect(labelOf('set.frontier.find(')).toBe('reset_parent_lookup')
    expect(block.lines.filter(l => l.text === 'await execution.checkpoint()').map(l => l.label)).toEqual(['reset_checkpoint', 'keep_checkpoint'])
    // Fail closed.
    expect(() => derivePhase2C26B2C2B2HFunctionSpans({ ...SOURCES, 'src/domain/rng/gogmaBonusFamily.ts': familySource.replace('export function keepFamilyLayoutKey(', 'export function keepFamilyLayoutKey2(') })).toThrow(/0 declarations/)
    expect(() => derivePhase2C26B2C2B2HFunctionSpans({ ...SOURCES, 'src/domain/rng/gogmaBonusFamily.ts': `${familySource}\nexport function keepFamilyLayoutKey(x: string) {\n  return x\n}\n` })).toThrow(/2 declarations/)
    expect(() => derivePhase2C26B2C2B2HFunctionSpans({})).toThrow(/No source text/)
    expect(() => derivePhase2C26B2C2B2HStateGenerationBlock(bonusStreamSource.replace("runtime.phase('phase_started', 'state_generation')", ''))).toThrow(/markers/)
    expect(() => derivePhase2C26B2C2B2HStateGenerationBlock(bonusStreamSource.replace('predictKeep(position, state.familyLayoutKey, state.bonuses)', 'predictKeep2()'))).toThrow(/keep_prediction/)
  })

  it('normalizes frame urls (Repository, runner script, node internal) and resolves registered frames by name or, for closures, by span', () => {
    expect(normalizePhase2C26B2C2B2HUrl('file:///D:/repo/src/domain/search/bonusStream.ts')).toBe('src/domain/search/bonusStream.ts')
    expect(normalizePhase2C26B2C2B2HUrl('file:///D:/repo/scripts/run-planner-global-phase2c26b2c2b2h.mjs')).toBe('scripts/run-planner-global-phase2c26b2c2b2h.mjs')
    expect(normalizePhase2C26B2C2B2HUrl('node:internal/timers')).toBe('node:internal/timers')
    const spans = derivePhase2C26B2C2B2HFunctionSpans(SOURCES)
    const owner = spans.find(s => s.functionName === 'generateReservedDepth')!
    const table = createPhase2C26A5ScriptTable([{ scriptId: '1', url: 'file:///D:/repo/src/domain/search/bonusStream.ts', sourceMap: {} }], () => ({ originalPositionFor: ({ line }) => ({ line }) }))
    const frame = (functionName: string, line: number) => resolvePhase2C26B2C2B2HFrame({ functionName, scriptId: '1', url: '', lineNumber: line - 1, columnNumber: 0 }, table, spans)
    expect(frame('generateReservedDepth', owner.startLine)).toMatchObject({ registered: 'src/domain/search/bonusStream.ts#generateReservedDepth', role: 'owner', byName: true, kind: 'repository' })
    expect(frame('', owner.startLine + 40)).toMatchObject({ role: 'owner', byName: false })
    expect(frame('', 3)).toMatchObject({ role: null, registered: null })
    const predictKeep = spans.find(s => s.functionName === 'predictKeep')!
    expect(frame('', predictKeep.startLine + 1)).toMatchObject({ role: null }) // predictKeep is never matched by span
    expect(frame('predictKeep', predictKeep.startLine)).toMatchObject({ role: 'keep_prediction', byName: true })
  })
})

// ---------------------------------------------------------------- classification

const F = (o: Partial<Phase2C26B2C2B2HFrame>): Phase2C26B2C2B2HFrame => ({ functionName: 'f', file: 'src/x.ts', originalLine: 1, registered: null, role: null, byName: true, kind: 'repository', ...o })
const ROOT = F({ functionName: '(root)', file: '', originalLine: null, kind: 'root' })
const OWNER = F({ functionName: 'generateReservedDepth', file: 'src/domain/search/bonusStream.ts', role: 'owner', registered: 'b#generateReservedDepth' })
const role = (r: Phase2C26B2C2B2HFrame['role'], name = 'g', file = 'src/domain/rng/production/productionRngEngine.ts') => F({ functionName: name, file, role: r, registered: `${file}#${name}` })
const NATIVE = (name: string) => F({ functionName: name, file: '', originalLine: null, kind: 'native' })
const HARNESS = F({ functionName: 'innerObserver', file: 'src/benchmarks/plannerGlobalPhase2C26B2C2B2H.ts', kind: 'research_harness' })

describe('Phase 2-C2.6-B2-C2B2H stack classification', () => {
  it('applies the registered priority: gc, idle, program, observer overhead, checkpoint, Reset / Keep / shared prediction, counter advance, state construction, owner, other', () => {
    const c = (...stack: Phase2C26B2C2B2HFrame[]) => classifyPhase2C26B2C2B2HStack([ROOT, ...stack])
    expect(c(OWNER, role('keep_prediction', 'predictKeep'), F({ functionName: '(garbage collector)', file: '', kind: 'gc' }))).toMatchObject({ category: 'gc' })
    expect(classifyPhase2C26B2C2B2HStack([ROOT, F({ functionName: '(idle)', file: '', kind: 'idle' })])).toMatchObject({ category: 'idle' })
    expect(classifyPhase2C26B2C2B2HStack([ROOT, F({ functionName: '(program)', file: '', kind: 'program' })])).toMatchObject({ category: 'program' })
    expect(classifyPhase2C26B2C2B2HStack([ROOT])).toMatchObject({ category: 'program' })
    // Research harness deeper than every Repository frame (the observers, the yield wrapper, the runner timers) is observer overhead ...
    expect(c(OWNER, F({ functionName: '', file: 'src/domain/search/bonusStream.ts' }), HARNESS, NATIVE('writeSync'))).toMatchObject({ category: 'observer_overhead' })
    expect(c(F({ functionName: 'heartbeat', file: 'scripts/run-planner-global-phase2c26b2c2b2h.mjs', kind: 'research_harness' }))).toMatchObject({ category: 'observer_overhead' })
    expect(c(role('checkpoint', 'checkpoint', 'src/domain/search/searchExecution.ts'), HARNESS)).toMatchObject({ category: 'observer_overhead' })
    // ... but a harness frame that is only an ancestor of the Search (the task call) is not.
    expect(c(HARNESS, OWNER)).toMatchObject({ category: 'generation_owner_or_inlined', ownerDetail: 'self' })
    expect(c(OWNER, role('checkpoint', 'checkpoint', 'src/domain/search/searchExecution.ts'))).toMatchObject({ category: 'checkpoint_cpu' })
    expect(c(role('checkpoint', 'checkpoint', 'src/domain/search/searchExecution.ts'))).toMatchObject({ category: 'checkpoint_cpu' }) // resumed after the yield
    expect(c(OWNER, role('reset_prediction', 'predictReset', 'src/domain/search/bonusStream.ts'), role('prediction_shared', 'predictGogmaBonus'))).toMatchObject({ category: 'reset_prediction' })
    expect(c(OWNER, role('prediction_shared', 'predictGogmaBonus'), role('reset_prediction', 'predictProductionGogmaReset', 'src/domain/rng/production/gogmaPrediction.ts'))).toMatchObject({ category: 'reset_prediction' })
    expect(c(OWNER, role('keep_prediction', 'predictKeep', 'src/domain/search/bonusStream.ts'))).toMatchObject({ category: 'keep_prediction' })
    expect(c(OWNER, role('prediction_shared', 'predictGogmaBonus'), role('prediction_shared', 'getPredictionSupport'), role('keep_prediction', 'hasUnreadableKeepFamily'),
      role('state_construction', 'keepFamilyBonusTypeId', 'src/domain/rng/gogmaBonusFamily.ts'))).toMatchObject({ category: 'keep_prediction' })
    expect(c(OWNER, role('prediction_shared', 'predictGogmaBonus'), role('prediction_shared', 'normalizedBaseSeed'))).toMatchObject({ category: 'gogma_prediction_shared' })
    expect(c(OWNER, F({ functionName: 'readReferenceRngBlock', file: 'src/domain/rng/production/referencePrng.ts' }))).toMatchObject({ category: 'gogma_prediction_shared' })
    expect(c(OWNER, role('counter_advance', 'advanceGogmaCounter'), role('counter_advance', 'advanceOneCounter'))).toMatchObject({ category: 'counter_advance' })
    expect(c(OWNER, role('state_construction', 'reservedGeneratedState', 'src/domain/search/bonusStream.ts'), role('state_construction', 'keepFamilyLayoutKey', 'src/domain/rng/gogmaBonusFamily.ts'), NATIVE('join')))
      .toMatchObject({ category: 'state_construction_family_layout' })
    expect(c(OWNER)).toMatchObject({ category: 'generation_owner_or_inlined', ownerDetail: 'self' })
    expect(c(OWNER, NATIVE('find'), F({ functionName: '', file: 'src/domain/search/bonusStream.ts', role: 'owner', byName: false, originalLine: 848 })))
      .toMatchObject({ category: 'generation_owner_or_inlined', ownerDetail: 'closure:848' })
    expect(c(OWNER, NATIVE('sort'))).toMatchObject({ category: 'generation_owner_or_inlined', ownerDetail: 'native:sort' })
    // Other: an event loop turn, a Vite loader frame, an unregistered Repository frame, a native leaf outside the owner.
    expect(c(F({ functionName: 'processImmediate', file: 'node:internal/timers', originalLine: null, kind: 'node_internal' }))).toMatchObject({ category: 'other_state_generation', otherReason: 'native_or_node_internal' })
    expect(c(NATIVE('resolve'))).toMatchObject({ category: 'other_state_generation', otherReason: 'native_or_node_internal' })
    expect(c(OWNER, F({ functionName: 'get', file: 'node_modules/vite/dist/node/module-runner.js', originalLine: null, kind: 'vite_module_runner' }))).toMatchObject({ category: 'other_state_generation', otherReason: 'vite_loader' })
    expect(c(OWNER, F({ functionName: 'compareStableKeys', file: 'src/domain/search/semanticKeys.ts' }))).toMatchObject({ category: 'other_state_generation', otherReason: 'other_repository' })
  })
})

// ---------------------------------------------------------------- one synthetic CPU profile

const OFFSET = 1_000 // hrtime ms - performance.now() ms
const pair = (perfMs: number) => ({ perfMs, hrMs: perfMs + OFFSET, precisionMs: 0.01 })
type Leaf = 'owner' | 'closure' | 'sort' | 'keep' | 'reset' | 'shared' | 'state' | 'advance' | 'checkpoint' | 'gc' | 'idle' | 'program' | 'observer' | 'event_loop'

/** A synthetic profile over the real spans: one node per leaf kind, the samples at the given Research times. */
function syntheticProfile(samples: readonly [number, Leaf][], window: { start: number; stop: number }) {
  const spans = derivePhase2C26B2C2B2HFunctionSpans(SOURCES)
  const fileUrl: Record<string, string> = Object.fromEntries(Object.keys(SOURCES).map((file, i) => [file, String(i + 1)]))
  const rows = Object.keys(SOURCES).map((file, i) => ({ scriptId: String(i + 1), url: `file:///D:/repo/${file}`, sourceMap: {} }))
  rows.push({ scriptId: '90', url: 'file:///D:/repo/src/benchmarks/plannerGlobalPhase2C26B2C2B2H.ts', sourceMap: {} })
  const table = createPhase2C26A5ScriptTable(rows, () => ({ originalPositionFor: ({ line }) => ({ line }) }))
  const at = (name: string) => spans.find(s => s.functionName === name)!
  const fn = (name: string) => ({ functionName: name, scriptId: fileUrl[at(name).file]!, url: '', lineNumber: at(name).startLine - 1, columnNumber: 0 })
  const native = (name: string) => ({ functionName: name, scriptId: '0', url: '', lineNumber: -1, columnNumber: -1 })
  const nodes: (CpuProfileNode & { positionTicks?: { line: number; ticks: number }[] })[] = []
  const add = (id: number, callFrame: CpuProfileNode['callFrame'], parent: number | null, positionTicks?: { line: number; ticks: number }[]) => {
    nodes.push({ id, callFrame, children: [], ...(positionTicks ? { positionTicks } : {}) })
    if (parent !== null) nodes.find(n => n.id === parent)!.children!.push(id)
  }
  const block = derivePhase2C26B2C2B2HStateGenerationBlock(bonusStreamSource)
  const keepLine = block.lines.find(l => l.label === 'keep_eligibility_windows_has')!.line
  add(1, native('(root)'), null)
  add(2, fn('generateReservedDepth'), 1, [{ line: keepLine, ticks: 7 }, { line: at('predictKeep').startLine + 5, ticks: 3 }])
  add(3, { ...native(''), scriptId: fileUrl['src/domain/search/bonusStream.ts']!, lineNumber: block.lines.find(l => l.label === 'reset_parent_lookup')!.line - 1, columnNumber: 0 }, 2)
  add(4, native('sort'), 2)
  add(5, fn('predictKeep'), 2)
  add(6, fn('predictGogmaBonus'), 2)
  add(7, fn('predictProductionGogmaReset'), 6)
  add(8, fn('normalizedBaseSeed'), 6)
  add(9, fn('reservedGeneratedState'), 2)
  add(10, fn('keepFamilyLayoutKey'), 9)
  add(11, fn('advanceGogmaCounter'), 2)
  add(12, fn('checkpoint'), 2)
  add(13, native('(garbage collector)'), 1)
  add(14, native('(idle)'), 1)
  add(15, native('(program)'), 1)
  add(16, { functionName: 'innerObserver', scriptId: '90', url: '', lineNumber: 10, columnNumber: 0 }, 2)
  add(17, { functionName: 'processImmediate', scriptId: '0', url: 'node:internal/timers', lineNumber: 1, columnNumber: 0 }, 1)
  const leafId: Record<Leaf, number> = { owner: 2, closure: 3, sort: 4, keep: 5, reset: 7, shared: 8, state: 10, advance: 11, checkpoint: 12, gc: 13, idle: 14, program: 15, observer: 16, event_loop: 17 }
  const startUs = (window.start + OFFSET) * 1000
  const times = samples.map(([t]) => (t + OFFSET) * 1000)
  const profile: CpuProfile = { nodes, startTime: startUs, endTime: (window.stop + OFFSET) * 1000, samples: samples.map(([, leaf]) => leafId[leaf]),
    timeDeltas: times.map((t, i) => t - (i === 0 ? startUs : times[i - 1]!)) }
  return { profile, table, spans, block, clock: { startPre: pair(window.start - 0.01), startPost: pair(window.start + 0.01), stopPre: pair(window.stop - 0.01), stopPost: pair(window.stop + 0.01) } }
}

describe('Phase 2-C2.6-B2-C2B2H CPU attribution of one profile', () => {
  const intervals = reconstructPhase2C26B2C2B2HIntervals([...depthRecords(1, 100, 200), ...depthRecords(2, 300, 400, 14)])
  const samples: [number, Leaf][] = [
    [50, 'owner'], [60, 'keep'], // outside (before the first interval)
    [101, 'owner'], [102, 'owner'], [103, 'closure'], [104, 'sort'], [105, 'keep'], [106, 'keep'], [107, 'reset'], [108, 'shared'], [109, 'state'], [110, 'advance'],
    [111, 'checkpoint'], [112, 'gc'], [113, 'idle'], [114, 'idle'], [115, 'program'], [116, 'observer'], [117, 'event_loop'],
    [250, 'state'], // outside (between intervals): a state_generation-only function outside the intervals
    [301, 'owner'], [302, 'owner'], [399.9, 'owner'], [400, 'owner'], // [400 is the end, exclusive]
  ]
  const s = syntheticProfile(samples, { start: 40, stop: 450 })
  const analysis = analyzePhase2C26B2C2B2HProfile(s.profile, s.table, s.spans, SOURCES, s.block, s.clock, intervals)

  it('aligns the clocks, keeps only the samples inside a state_generation interval, and reports the active denominator without idle (program, GC, overhead and other stay in it)', () => {
    expect(analysis.alignment).toMatchObject({ valid: true, negativeDeltas: 0 })
    expect(analysis.intervalValidation).toMatchObject({ valid: true, count: 2, openIntervalInsideProfile: false })
    expect(analysis.allProfileSamples).toBe(samples.length)
    expect(analysis.intervalSamples).toBe(20)
    expect(analysis.idleSamples).toBe(2)
    expect(analysis.activeSamples).toBe(18)
    expect(analysis.programSamples).toBe(1)
    expect(analysis.gcSamples).toBe(1)
    const of = (category: Phase2C26B2C2B2HCategory) => analysis.categories.find(c => c.category === category)!
    expect(of('generation_owner_or_inlined')).toMatchObject({ samples: 7, shareOfActive: 7 / 18, shareOfInterval: 7 / 20 })
    expect(of('keep_prediction').samples).toBe(2)
    expect([of('reset_prediction').samples, of('gogma_prediction_shared').samples, of('state_construction_family_layout').samples, of('counter_advance').samples, of('checkpoint_cpu').samples])
      .toEqual([1, 1, 1, 1, 1])
    expect([of('gc').samples, of('program').samples, of('observer_overhead').samples, of('other_state_generation').samples]).toEqual([1, 1, 1, 1])
    expect(of('idle')).toMatchObject({ samples: 2, shareOfActive: null, shareOfInterval: 0.1 })
    expect(analysis.categories.filter(c => c.category !== 'idle').reduce((sum, c) => sum + c.samples, 0)).toBe(analysis.activeSamples)
    expect(analysis.unattributedActiveShare).toBeCloseTo(3 / 18, 12)
    expect(analysis.idleOrProgramShareOfInterval).toBeCloseTo(3 / 20, 12)
    expect(analysis.sourceMapResolution).toEqual({ repositoryNodes: 11, mappedNodes: 11, unmappedNodes: 0, registeredNamedNodes: 9, registeredAnonymousNodes: 1 })
    expect(analysis.ownerDetails).toEqual(expect.arrayContaining([{ detail: 'self', samples: 5, shareOfActive: 5 / 18 }, expect.objectContaining({ detail: 'native:sort', samples: 1 }),
      expect.objectContaining({ detail: expect.stringMatching(/^closure:\d+$/), samples: 1 })]))
    expect(analysis.stateGenerationOnlySamples).toEqual({ inside: 1, outside: 1 })
    expect(analysis.registeredLineMismatches).toEqual([])
    expect(analysis.intervalsInProfile).toBe(2)
    expect(analysis.intervalMsInProfile).toBe(200)
    expect(analysis.workInWindow).toEqual({ intervals: 2, partialIntervals: 0, generatedStates: 200 })
    expect(analysis.registeredInclusive.find(r => r.registered.endsWith('#generateReservedDepth'))!.samples).toBeGreaterThanOrEqual(13)
    expect(analysis.topLeaves[0]).toMatchObject({ category: 'generation_owner_or_inlined', samples: 5 })
    // Line ticks: the owner's in-block line labelled with its sub-block, and a predictKeep line inlined into it.
    const owner = analysis.lineTicks.find(l => l.registered.endsWith('#generateReservedDepth'))!
    expect(owner.inSpan).toEqual([expect.objectContaining({ ticks: 7, subBlock: 'keep_eligibility_windows_has' })])
    expect(owner.outsideSpan).toEqual([{ into: 'src/domain/search/bonusStream.ts#predictKeep', ticks: 3 }])
    expect(analysis.ownerSubBlockTicks).toEqual([{ subBlock: 'keep_eligibility_windows_has', ticks: 7 }])
  })

  it('maps no sample when the clocks or the intervals are not valid, and fails closed on an open interval inside the profile', () => {
    const misaligned = analyzePhase2C26B2C2B2HProfile(s.profile, s.table, s.spans, SOURCES, s.block, { ...s.clock, stopPost: { ...s.clock.stopPost, hrMs: s.clock.stopPost.hrMs + 50 } }, intervals)
    expect(misaligned.alignment.valid).toBe(false)
    expect(misaligned.intervalSamples).toBe(0)
    const open = reconstructPhase2C26B2C2B2HIntervals([...depthRecords(1, 100, 200), ...depthRecords(2, 300, 400, 14).slice(0, 6)])
    const withOpen = analyzePhase2C26B2C2B2HProfile(s.profile, s.table, s.spans, SOURCES, s.block, s.clock, open)
    expect(withOpen.intervalValidation).toMatchObject({ valid: false, openIntervalInsideProfile: true })
    expect(withOpen.intervalSamples).toBe(0)
    const negative = syntheticProfile([[101, 'owner'], [100.5, 'owner']], { start: 40, stop: 450 })
    const n = analyzePhase2C26B2C2B2HProfile(negative.profile, negative.table, negative.spans, SOURCES, negative.block, negative.clock, intervals)
    expect(n.alignment.negativeDeltas).toBe(1)
    expect(phase2c26b2c2b2hProfileQuality(capture0, n).join()).toMatch(/negative timeDeltas: 1/)
    // A named registered frame that does not resolve to its declaration line.
    const shifted = syntheticProfile(samples, { start: 40, stop: 450 })
    shifted.profile.nodes.find(node => node.callFrame.functionName === 'predictKeep')!.callFrame.lineNumber += 2
    expect(analyzePhase2C26B2C2B2HProfile(shifted.profile, shifted.table, shifted.spans, SOURCES, shifted.block, shifted.clock, intervals).registeredLineMismatches)
      .toEqual([expect.stringMatching(/#predictKeep@/)])
  })
})

// ---------------------------------------------------------------- quality and decision

const capture0: Phase2C26B2C2B2HCaptureFacts = { profileWritten: true, scriptTableWritten: true, requiredSourceMaps: Object.fromEntries(PHASE2C26B2C2B2H_REQUIRED_SOURCE_FILES.map(f => [f, true])),
  window: { stoppedBy: 'window', error: null, actualProfileDurationMs: 600_000 }, spanDerivationError: null, outerContractViolations: 0, innerContractViolations: 0, outsideReadViolations: 0,
  boundaryWriteFailures: 0 }

/** A minimal valid analysis with the given active-category counts (idle given separately). */
function shaped(counts: Partial<Record<Phase2C26B2C2B2HCategory, number>>, idle = 0): Phase2C26B2C2B2HProfileAnalysis {
  const active = Object.entries(counts).reduce((sum, [, n]) => sum + (n ?? 0), 0)
  const unattributed = (counts.observer_overhead ?? 0) + (counts.program ?? 0) + (counts.other_state_generation ?? 0)
  return { alignment: { valid: true, issues: [], offsetMs: OFFSET, offsetSpreadMs: 0, maxPairPrecisionMs: 0, profileStartMs: 0, profileEndMs: 600_000, profileDurationMs: 600_000, sumDeltasMs: 600_000,
      negativeDeltas: 0, startBracketMs: [0, 0], stopBracketMs: [0, 0], researchProfileStartMs: 0, researchProfileEndMs: 600_000 },
    intervalValidation: { valid: true, issues: [], count: 10, openIntervalInsideProfile: false }, intervalSamples: active + idle, idleSamples: idle, activeSamples: active,
    unattributedActiveShare: active > 0 ? unattributed / active : null, registeredLineMismatches: [],
    categories: PHASE2C26B2C2B2H_CATEGORIES.map(category => ({ category, samples: category === 'idle' ? idle : counts[category] ?? 0,
      shareOfActive: category === 'idle' ? null : (counts[category] ?? 0) / active, shareOfInterval: (category === 'idle' ? idle : counts[category] ?? 0) / (active + idle) })) } as unknown as Phase2C26B2C2B2HProfileAnalysis
}

describe('Phase 2-C2.6-B2-C2B2H profile quality and decision', () => {
  it('requires a complete capture, valid clocks and intervals, no negative delta, >= 300 s, >= 1,000 state_generation samples, resolved frames, no contract violation and a mostly attributed active population', () => {
    expect(PHASE2C26B2C2B2H_MIN_PROFILE_DURATION_MS).toBe(300_000)
    expect(PHASE2C26B2C2B2H_MIN_STATE_GENERATION_SAMPLES).toBe(1_000)
    const good = shaped({ generation_owner_or_inlined: 3_000 }, 100)
    expect(phase2c26b2c2b2hProfileQuality(capture0, good)).toEqual([])
    const q = (capture: Partial<Phase2C26B2C2B2HCaptureFacts>, analysis: Phase2C26B2C2B2HProfileAnalysis | null = good) => phase2c26b2c2b2hProfileQuality({ ...capture0, ...capture }, analysis).join(' | ')
    expect(q({ profileWritten: false })).toMatch(/no CPU profile/)
    expect(q({ requiredSourceMaps: { ...capture0.requiredSourceMaps, 'src/domain/search/bonusStream.ts': false } })).toMatch(/no source map for src\/domain\/search\/bonusStream\.ts/)
    expect(q({ window: { stoppedBy: null, error: 'boom', actualProfileDurationMs: 600_000 } })).toMatch(/boom/)
    expect(q({ window: { stoppedBy: 'window', error: null, actualProfileDurationMs: 299_999 } })).toMatch(/below 300000/)
    expect(q({ spanDerivationError: 'x' })).toMatch(/span derivation/)
    expect(q({ innerContractViolations: 1 })).toMatch(/inner tracker contract/)
    expect(q({ outerContractViolations: null })).toMatch(/outer Search contract/)
    expect(q({ outsideReadViolations: 2 })).toMatch(/outside an open bonus_depth_read/)
    expect(q({ boundaryWriteFailures: 1 })).toMatch(/section stream write/)
    expect(q({}, null)).toMatch(/no profile analysis/)
    expect(q({}, shaped({ generation_owner_or_inlined: 999 }))).toMatch(/999 < 1000/)
    expect(q({}, { ...good, intervalValidation: { valid: false, issues: ['interval 3 overlaps the previous one'], count: 4, openIntervalInsideProfile: false } })).toMatch(/overlaps/)
    expect(q({}, { ...good, alignment: { ...good.alignment, valid: false, issues: ['skew'] } })).toMatch(/clock: skew/)
    expect(q({}, { ...good, registeredLineMismatches: ['x#f@3 (declaration 1)'] })).toMatch(/line mismatch/)
    expect(q({}, shaped({ generation_owner_or_inlined: 1_000, program: 600, observer_overhead: 400 }))).toMatch(/unattributed active share 0\.5000/)
    expect(q({}, shaped({ generation_owner_or_inlined: 1_001, program: 600, observer_overhead: 399 }))).toBe('')
  })

  it('applies the registered decision rule on the active shares (dominant >= 0.50, secondary >= 0.20, MIXED takes at most two), INVALID / INSUFFICIENT first', () => {
    expect([PHASE2C26B2C2B2H_DOMINANT_THRESHOLD, PHASE2C26B2C2B2H_SECONDARY_THRESHOLD]).toEqual([0.5, 0.2])
    expect(PHASE2C26B2C2B2H_DECISION_CASES).toEqual(['B2C2B2H_INVALID', 'B2C2B2H_INSUFFICIENT', 'B2C2B2H_GENERATION_OWNER_DOMINANT', 'B2C2B2H_RESET_PREDICTION_DOMINANT',
      'B2C2B2H_KEEP_PREDICTION_DOMINANT', 'B2C2B2H_GOGMA_PREDICTION_SHARED_DOMINANT', 'B2C2B2H_STATE_CONSTRUCTION_DOMINANT', 'B2C2B2H_COUNTER_ADVANCE_DOMINANT', 'B2C2B2H_CHECKPOINT_CPU_DOMINANT',
      'B2C2B2H_GC_DOMINANT', 'B2C2B2H_MIXED'])
    const decide = (analysis: Phase2C26B2C2B2HProfileAnalysis, invalid: string[] = [], insufficient: string[] = []) => phase2c26b2c2b2hDecision({ invalidReasons: invalid, insufficientReasons: insufficient, analysis })
    // Exactly at 0.50 of the active samples (idle excluded): dominant.
    const half = decide(shaped({ state_construction_family_layout: 500, generation_owner_or_inlined: 300, gc: 200 }, 400))
    expect(half).toMatchObject({ case: 'B2C2B2H_STATE_CONSTRUCTION_DOMINANT', dominant: 'state_construction_family_layout', dominantShareOfActive: 0.5, nextPhaseCategories: ['state_construction_family_layout'] })
    expect(half.secondary).toEqual([{ category: 'generation_owner_or_inlined', shareOfActive: 0.3 }, { category: 'gc', shareOfActive: 0.2 }])
    expect(decide(shaped({ state_construction_family_layout: 499, generation_owner_or_inlined: 301, gc: 200 })).case).toBe('B2C2B2H_MIXED')
    for (const [category, caseId] of [['generation_owner_or_inlined', 'B2C2B2H_GENERATION_OWNER_DOMINANT'], ['reset_prediction', 'B2C2B2H_RESET_PREDICTION_DOMINANT'],
      ['keep_prediction', 'B2C2B2H_KEEP_PREDICTION_DOMINANT'], ['gogma_prediction_shared', 'B2C2B2H_GOGMA_PREDICTION_SHARED_DOMINANT'], ['counter_advance', 'B2C2B2H_COUNTER_ADVANCE_DOMINANT'],
      ['checkpoint_cpu', 'B2C2B2H_CHECKPOINT_CPU_DOMINANT'], ['gc', 'B2C2B2H_GC_DOMINANT']] as const) {
      expect(decide(shaped({ [category]: 600, other_state_generation: 400 })).case).toBe(caseId)
    }
    const mixed = decide(shaped({ keep_prediction: 350, generation_owner_or_inlined: 300, counter_advance: 200, gc: 150 }))
    expect(mixed).toMatchObject({ case: 'B2C2B2H_MIXED', dominant: null, nextPhaseCategories: ['keep_prediction', 'generation_owner_or_inlined'] })
    expect(mixed.secondary.map(x => x.category)).toEqual(['keep_prediction', 'generation_owner_or_inlined', 'counter_advance'])
    // Non-hotspot categories never become the decision or a next-phase candidate.
    expect(decide(shaped({ program: 450, generation_owner_or_inlined: 300, keep_prediction: 250 }))).toMatchObject({ case: 'B2C2B2H_MIXED', nextPhaseCategories: ['generation_owner_or_inlined', 'keep_prediction'] })
    expect(decide(shaped({ generation_owner_or_inlined: 900 }), ['hash_chain: x'], ['short'])).toMatchObject({ case: 'B2C2B2H_INVALID', reasons: ['hash_chain: x'] })
    expect(decide(shaped({ generation_owner_or_inlined: 900 }), [], ['short'])).toMatchObject({ case: 'B2C2B2H_INSUFFICIENT', reasons: ['short'] })
    expect(phase2c26b2c2b2hDecision({ invalidReasons: [], insufficientReasons: [], analysis: null }).case).toBe('B2C2B2H_INSUFFICIENT')
  })
})

// ---------------------------------------------------------------- yield wait and semantic parity

describe('Phase 2-C2.6-B2-C2B2H yield wait and semantic parity', () => {
  it('reports the Research yield wait inside state_generation as wall time (whole run and the snapshots bracketing the profile window), never as CPU', async () => {
    let clock = 0
    const records: Phase2C26B2C2B2HBoundaryRecord[] = []
    const p = createPhase2C26B2C2B2HProfiler({ now: () => clock, emitBoundary: r => { records.push(r) } })
    p.start()
    const o = (section: string) => p.outerObserver({ type: 'section_started', section } as never)
    o('search_runtime'); o('scheduler_step'); o('scheduler_settle'); p.outerObserver({ type: 'section_started', section: 'bonus_depth_work', work: { channel: 0, depth: 1 } } as never); o('bonus_depth_read')
    p.innerObserver(ev('depth_started', 1))
    p.innerObserver(ev('phase_started', 1, { phase: 'state_generation' }))
    const s0 = p.snapshot('heartbeat')
    const wrapped = p.wrapYield(async () => { clock += 4 })
    clock = 10; await wrapped(); clock += 6
    const s1 = p.snapshot('heartbeat')
    clock += 10; await wrapped()
    const s2 = p.snapshot('heartbeat')
    const snaps = [s0, s1, s2] as Phase2C26B2C2B2GProfileSnapshot[]
    const w = phase2c26b2c2b2hYieldWait(snaps, { fromMs: 0, toMs: 20 })!
    expect(w.wholeRun).toEqual({ stateGenerationWallMs: 34, yieldCount: 2, yieldWaitMs: 8, stateGenerationYieldWaitShare: 8 / 34 })
    // The window [0, 20] is bracketed by s0 (at 0) and s1 (at 20): one yield of 4 ms in 20 ms of state_generation.
    expect(w.profileWindow).toEqual({ fromAtMs: 0, toAtMs: 20, stateGenerationWallMs: 20, yieldCount: 1, yieldWaitMs: 4, stateGenerationYieldWaitShare: 0.2 })
    expect(phase2c26b2c2b2hYieldWait(snaps, { fromMs: 1, toMs: 35 })!.profileWindow).toBeNull()
    expect(phase2c26b2c2b2hYieldWait([], null)).toBeNull()
    expect(records.map(r => r.type)).toEqual(['depth_started', 'phase_started'])
  })

  it('compares the held-aware depth records of B2-C2B2G\'s formal run and this run on their common prefix and fails closed on a difference', () => {
    const p = (generated: number) => {
      let clock = 0
      const profiler = createPhase2C26B2C2B2HProfiler({ now: () => (clock += 1), emitBoundary: () => undefined })
      profiler.start()
      const o = (section: string, extra: object = {}) => profiler.outerObserver({ type: 'section_started', section, ...extra } as never)
      o('search_runtime'); o('scheduler_step'); o('scheduler_settle'); o('bonus_depth_work', { work: { channel: 0, depth: 1 } }); o('bonus_depth_read')
      profiler.innerObserver(ev('depth_started', 1))
      for (const phase of RESERVED_GOGMA_RUNTIME_PHASES) {
        profiler.innerObserver(ev('phase_started', 1, { phase }))
        profiler.innerObserver(ev('phase_completed', 1, { phase }))
      }
      profiler.innerObserver(ev('depth_completed', 1, { counts: { ...COUNTS, generatedStates: generated } }))
      return [profiler.snapshot('heartbeat')] as Phase2C26B2C2B2GProfileSnapshot[]
    }
    expect(phase2c26b2c2b2hDepthParity(p(100), p(100))).toMatchObject({ valid: true, commonDepths: 1, commonGeneratedStates: 100, firstMismatch: null })
    expect(phase2c26b2c2b2hDepthParity(p(100), p(101))).toMatchObject({ valid: false, firstMismatch: { index: 0 } })
    expect(phase2c26b2c2b2hDepthParity([], p(100)).valid).toBe(false)
  })
})

// ---------------------------------------------------------------- the runner start attestation

const HEAD = 'a'.repeat(40)
const OBS_PROBES: Phase2C26B2C2B2EProbe[] = [{ targetWeaponId: 't1', b2c2b2dTaskId: 't05-r03', contextRank: 3, extent: { maxNormalAdvance: 4, maxGogmaAdvance: 235, maxSkillAdvance: 900 } }]
const OBS_IDENTITIES: Phase2C26B2C2B2FTaskIdentity[] = [{ taskId: 't05-r03', targetWeaponId: 't1', contextRank: 3, groupIndex: 1, reservationDigest: 'r', targetEligibleMinCardinality: 1,
  representativeFixedSetId: 'k', representativeFixedTargetWeaponIds: ['t9'], defaultSearchInputDigest: 'd', searchInputDigest: 's', extent: { maxNormalAdvance: 4, maxGogmaAdvance: 235, maxSkillAdvance: 900 } }]
const observation0 = { createdAt: '2026-10-06T15:00:00.000Z', runnerScript: 'scripts/run-planner-global-phase2c26b2c2b2h.mjs', node: 'v24.19.0', repositoryHead: HEAD, uncommittedBenchmarkCode: false,
  benchmarkCodeSha256: 'b'.repeat(64), exportFileName: 'export.json', exportSha256: 'c'.repeat(64), exportBytes: 10, probeManifestFileName: 'probes.json.local', probeManifestSha256: 'd'.repeat(64),
  probeManifestB2C2B2GResultSha256: PHASE2C26B2C2B2H_REGISTERED_B2C2B2G.resultSha256, probeManifestB2C2B2FResultSha256: PHASE2C26B2C2B2G_REGISTERED_B2C2B2F.resultSha256,
  probeManifestB2C2B2EResultSha256: PHASE2C26B2C2B2F_REGISTERED_B2C2B2E.resultSha256, targetWeaponIds: ['t1'], probes: OBS_PROBES, expectedTaskIdentities: OBS_IDENTITIES,
  stage1: { ...PHASE2C26B2C2B2H_STAGE1 }, cpuProfilerConfig: { ...PHASE2C26B2C2B2H_CPU_PROFILER }, smoke: null }
const expectation: Phase2C26B2C2B2HAttestationExpectation = { repositoryHead: HEAD, benchmarkCodeSha256: 'b'.repeat(64), exportSha256: 'c'.repeat(64), probeManifestSha256: 'd'.repeat(64),
  b2c2b2gResultSha256: PHASE2C26B2C2B2H_REGISTERED_B2C2B2G.resultSha256, b2c2b2fResultSha256: PHASE2C26B2C2B2G_REGISTERED_B2C2B2F.resultSha256,
  b2c2b2eResultSha256: PHASE2C26B2C2B2F_REGISTERED_B2C2B2E.resultSha256, probes: OBS_PROBES, expectedTaskIdentities: OBS_IDENTITIES, firstChildStartedAt: '2026-10-06T15:00:00.500Z' }

describe('Phase 2-C2.6-B2-C2B2H runner start attestation', () => {
  it('carries the launch observation and every registered condition (30 minutes / 12,288 MB / concurrency 1 / the two observers / the CPU profiler window / heap-only flags) and verifies only against independent values', () => {
    const attestation = phase2c26b2c2b2hStartAttestationBody(observation0)
    expect(attestation).toMatchObject({ attestedBy: 'runner', phase: PHASE2C26B2C2B2H_START_ATTESTATION_PHASE, stage1: { childHeapMb: 12_288, budgetMs: 1_800_000, concurrency: 1, retry: 'none', fallback: 'none' },
      b2c2b2gStage1: PHASE2C26B2C2B2G_STAGE1, changedStage1Fields: [], changedFromB2C2B2G: ['cpuProfiler'], expectedTasks: 1, section: 'state_generation',
      searchInstrumentation: PHASE2C26A7_SEARCH_INSTRUMENTATION, b2c2b2gCpuProfiler: false, cpuProfiler: true, cpuProfilerConfig: PHASE2C26A5_PROFILER, nodeFlags: ['--max-old-space-size=12288'], smoke: null })
    expect(verifyPhase2C26B2C2B2HStartAttestation(attestation, expectation)).toEqual({ verified: true, issues: [], integrityIssues: [] })
    const integrity = (patch: Json) => verifyPhase2C26B2C2B2HStartAttestation({ ...attestation, ...patch }, expectation).integrityIssues.length > 0
    for (const patch of [{ repositoryHead: 'f'.repeat(40) }, { benchmarkCodeSha256: '0'.repeat(64) }, { exportSha256: '0'.repeat(64) }, { probeManifestSha256: '0'.repeat(64) },
      { probeManifestB2C2B2GResultSha256: '0'.repeat(64) }, { probeManifestB2C2B2FResultSha256: '0'.repeat(64) }, { probeManifestB2C2B2EResultSha256: '0'.repeat(64) }, { targetWeaponIds: [] },
      { probes: [{ ...OBS_PROBES[0]!, contextRank: 4 }] }, { expectedTaskIdentities: [{ ...OBS_IDENTITIES[0]!, searchInputDigest: 'x' }] }, { attestedBy: 'reconstruction' },
      { createdAt: '2026-10-06T15:00:01.000Z' }, { extra: 1 }]) expect(integrity(patch)).toBe(true)
    for (const patch of [{ uncommittedBenchmarkCode: true }, { smoke: { budgetMs: 1000, warmupMs: null, profileStopMs: null } }, { stage1: { ...PHASE2C26B2C2B2H_STAGE1, budgetMs: 3_600_000 } },
      { stage1: { ...PHASE2C26B2C2B2H_STAGE1, childHeapMb: 16_384 } }, { stage1: { ...PHASE2C26B2C2B2H_STAGE1, concurrency: 2 } }, { stage1: { ...PHASE2C26B2C2B2H_STAGE1, retry: 'once' } },
      { cpuProfiler: false }, { cpuProfilerConfig: { ...PHASE2C26B2C2B2H_CPU_PROFILER, warmupMs: 60_000 } }, { nodeFlags: ['--no-turbo-inlining', '--max-old-space-size=12288'] },
      { searchInstrumentation: { ...PHASE2C26A7_SEARCH_INSTRUMENTATION, onGogmaReservedDepth: true } }, { changedFromB2C2B2G: [] }, { innerSections: ['state_generation'] }]) {
      expect(integrity(patch)).toBe(false)
      expect(verifyPhase2C26B2C2B2HStartAttestation({ ...attestation, ...patch }, expectation).verified).toBe(false)
    }
    expect(verifyPhase2C26B2C2B2HStartAttestation(null, expectation).verified).toBe(false)
    expect(Object.keys(phase2c26b2c2b2hRegisteredConditions())).toEqual(expect.arrayContaining(['searchInstrumentation', 'cpuProfiler', 'cpuProfilerConfig', 'nodeFlags', 'sectionStream']))
  })
})

// ---------------------------------------------------------------- isolation and provenance

describe('Phase 2-C2.6-B2-C2B2H isolation and provenance', () => {
  it('is never imported by Production, adds no Production seam, and hard-codes no Target, task, rank, extent or digest value of the population', () => {
    const production = import.meta.glob(['../domain/**/*.ts', '../services/**/*.ts', '../workers/**/*.ts', '../pages/**/*.tsx', '../components/**/*.tsx', '../db/**/*.ts', '!../**/*.test.ts', '!../**/*.test.tsx'],
      { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    expect(Object.keys(production).length).toBeGreaterThan(50)
    expect(Object.entries(production).filter(([, source]) => /plannerGlobalPhase2C26B2C2B2H/.test(source)).map(([path]) => path)).toEqual([])
    for (const source of [searchSource, targetsSource, structureSource, analysisSource, prepareSource, runnerSource, analyzerSource]) {
      expect(source).not.toMatch(/fnv1a32[-:][0-9a-f]{8}|[0-9a-f]{8}-[0-9a-f]{4}-|build-list\.|a367c177|070a1222|4a875aac/)
      expect(source).not.toMatch(/\bt0\d-r\d\d\b/)
      expect(source).not.toMatch(/\b(1083|1084)\b/)
    }
    for (const source of [searchSource, targetsSource, structureSource, analysisSource]) expect(source).not.toMatch(/node:fs|readFile|import\.meta\.glob/)
  })

  it('keeps the oracle, every RESULT, A5 / A8 / A9 results and earlier measurements out of the Search side; the Search child never learns an expected outcome, hotspot, section or category', () => {
    for (const source of [searchSource, runnerSource]) {
      expect(source).not.toMatch(/ORACLE_[1]657|1657|--oracle|--manifest|--b2c2b2[efg]-result|_RESULT|Targets'|Analysis'\)|HAnalysis|expectedStableKey|expectedCandidateIndex|expectedSection|expectedHotspot|expectedCategory|peakHeapBytes/)
    }
    expect(searchSource).not.toMatch(/plannerGlobalPhase2C26B2C2B2[A-H]Targets|plannerGlobalPhase2C26B2C2B2[A-H]Analysis|plannerGlobalPhase2C26A[3-9]Analysis|plannerGlobalPhase2C26A8'|plannerGlobalPhase2C26A9|CpuProfile'/)
    expect(runnerSource).toMatch(/--probes/)
    expect(runnerSource).toMatch(/h\.runPhase2C26B2C2B2HTask\(input, schedule, task, engine, \{ yieldControl, instrumentation: profiler\.instrumentation \}\)/)
    expect(runnerSource).toMatch(/new Session\(\)/)
    expect(runnerSource).not.toMatch(/--cpu-prof|--no-turbo-inlining|--no-maglev-inlining|--inspect|HeapProfiler|takeHeapSnapshot|startSampling/)
    expect(prepareSource).toMatch(/--b2c2b2g-result/)
    expect(prepareSource).not.toMatch(/--oracle|visitPlannerAlternativeCandidates/)
    expect(analyzerSource).not.toMatch(/--oracle|ORACLE_[1]657|PHASE2C26A5_RESULT|PHASE2C26A8_RESULT|PHASE2C26A9_RESULT/)
    for (const source of [analysisSource, analyzerSource, targetsSource, prepareSource, structureSource]) expect(source).not.toMatch(/visitPlannerAlternativeCandidates|runPhase2C26B2C2B2[DFGH]Search\(|runPhase2C26B2C2B2[DFGH]Task\(/)
    // The Search side reuses B2-C2B2G's profiler and task and attaches exactly the two observers; nothing reads a clock in the Search.
    expect(searchSource).toMatch(/createPhase2C26B2C2B2GProfiler\(/)
    expect(searchSource).not.toMatch(/onSkillReservedDepth:|onGogmaReservedDepth:|onWorkSettled:/)
    expect(searchSource).not.toMatch(/Date\.now|performance\.now/)
  })
})
