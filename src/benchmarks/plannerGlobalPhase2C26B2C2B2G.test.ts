import { beforeEach, describe, expect, it, vi } from 'vitest'
import rawB2C2B2E from '../../docs/PLANNER_GLOBAL_PHASE2C26B2C2B2E_RESULT.json?raw'
import rawB2C2B2F from '../../docs/PLANNER_GLOBAL_PHASE2C26B2C2B2F_RESULT.json?raw'
import type { TargetWeapon } from '../domain/models/publicTypes'
import type { PlannerAlternativeSearchExecution } from '../domain/search'
import { RESERVED_GOGMA_RUNTIME_PHASES, type ReservedGogmaRuntimeEvent } from '../domain/search/bonusStream'
import type { SearchRuntimeEvent, SearchRuntimeSection } from '../domain/search/searchRuntime'
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
import { PHASE2C26A4_SEARCH_INSTRUMENTATION } from './plannerGlobalPhase2C26A4'
import { PHASE2C26A7_SEARCH_INSTRUMENTATION } from './plannerGlobalPhase2C26A7'
import { derivePhase2C26B2C1Schedule } from './plannerGlobalPhase2C26B2C1'
import { runPhase2C26B2C2B2DTask, PHASE2C26B2C2B2D_STAGE1 } from './plannerGlobalPhase2C26B2C2B2D'
import d2Source from './plannerGlobalPhase2C26B2C2B2D.ts?raw'
import { buildPhase2C26B2C2B2ETasks, type Phase2C26B2C2B2EProbe } from './plannerGlobalPhase2C26B2C2B2E'
import {
  createPhase2C26B2C2B2FProfiler,
  phase2c26b2c2b2fTaskIdentity,
  runPhase2C26B2C2B2FTask,
  PHASE2C26B2C2B2F_STAGE1,
  type Phase2C26B2C2B2FTaskIdentity,
} from './plannerGlobalPhase2C26B2C2B2F'
import {
  parsePhase2C26B2C2B2FB2C2B2EAuthority,
  phase2c26b2c2b2fPopulation,
  PHASE2C26B2C2B2F_REGISTERED_B2C2B2E,
} from './plannerGlobalPhase2C26B2C2B2FTargets'
import {
  buildPhase2C26B2C2B2GTasks,
  createPhase2C26B2C2B2GProfiler,
  parsePhase2C26B2C2B2GProbeManifest,
  phase2c26b2c2b2gChildSearchIdentity,
  phase2c26b2c2b2gRegisteredConditions,
  phase2c26b2c2b2gStartAttestationBody,
  runPhase2C26B2C2B2GSearch,
  runPhase2C26B2C2B2GTask,
  verifyPhase2C26B2C2B2GStartAttestation,
  PHASE2C26B2C2B2G_BUDGET_MS,
  PHASE2C26B2C2B2G_CHANGED_FROM_B2C2B2F,
  PHASE2C26B2C2B2G_CHANGED_STAGE1_FIELDS,
  PHASE2C26B2C2B2G_CHILD_HEAP_MB,
  PHASE2C26B2C2B2G_CPU_PROFILER,
  PHASE2C26B2C2B2G_EXPECTED_TASKS,
  PHASE2C26B2C2B2G_INNER_SECTIONS,
  PHASE2C26B2C2B2G_NOT_RUN,
  PHASE2C26B2C2B2G_PROVENANCE_FLAGS,
  PHASE2C26B2C2B2G_SEARCH_INSTRUMENTATION,
  PHASE2C26B2C2B2G_STAGE1,
  PHASE2C26B2C2B2G_START_ATTESTATION_PHASE,
  PHASE2C26B2C2B2G_WINDOWS_MS,
  type Phase2C26B2C2B2GAttestationExpectation,
  type Phase2C26B2C2B2GProfileSnapshot,
} from './plannerGlobalPhase2C26B2C2B2G'
import searchSource from './plannerGlobalPhase2C26B2C2B2G.ts?raw'
import {
  parsePhase2C26B2C2B2GB2C2B2FAuthority,
  phase2c26b2c2b2gPopulation,
  phase2c26b2c2b2gProbeManifest,
  PHASE2C26B2C2B2G_REGISTERED_B2C2B2F,
} from './plannerGlobalPhase2C26B2C2B2GTargets'
import targetsSource from './plannerGlobalPhase2C26B2C2B2GTargets.ts?raw'
import {
  phase2c26b2c2b2gCollectDepthRecords,
  phase2c26b2c2b2gConditionIssues,
  phase2c26b2c2b2gDecision,
  phase2c26b2c2b2gDepthStatistics,
  phase2c26b2c2b2gInnerObservation,
  phase2c26b2c2b2gOuterSanity,
  phase2c26b2c2b2gReconcile,
  phase2c26b2c2b2gSelectSnapshot,
  phase2c26b2c2b2gSnapshotReconciliation,
  phase2c26b2c2b2gWindows,
  PHASE2C26B2C2B2G_COVERAGE_THRESHOLD,
  PHASE2C26B2C2B2G_DECISION_CASES,
  PHASE2C26B2C2B2G_DOMINANT_THRESHOLD,
  PHASE2C26B2C2B2G_MIN_SEARCH_WALL_MS,
  PHASE2C26B2C2B2G_SECONDARY_THRESHOLD,
  type Phase2C26B2C2B2GInnerObservation,
} from './plannerGlobalPhase2C26B2C2B2GAnalysis'
import analysisSource from './plannerGlobalPhase2C26B2C2B2GAnalysis.ts?raw'
import prepareSource from '../../scripts/prepare-planner-global-phase2c26b2c2b2g-probes.mjs?raw'
import runnerSource from '../../scripts/run-planner-global-phase2c26b2c2b2g.mjs?raw'
import analyzerSource from '../../scripts/analyze-planner-global-phase2c26b2c2b2g.mjs?raw'

/*
 * Issue #154 Phase 2-C2.6-B2-C2B2G: bonus_depth_read inner runtime re-localization of the one B2-C2B2F BONUS-dominant Target in
 * B2-C2B2F's exact Search input. The synthetic worlds below are invented for the tests; the committed B2-C2B2F / B2-C2B2E RESULTs are
 * read only to check the authorities and the population derivation. No oracle module is imported here.
 */

/** Every Search call's input and execution options, in call order; the real Search always runs. */
const searchCalls = vi.hoisted(() => ({ inputs: [] as unknown[], options: [] as unknown[] }))
vi.mock('../domain/search/alternative/plannerAlternativeSearch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../domain/search/alternative/plannerAlternativeSearch')>()
  return {
    ...actual,
    visitPlannerAlternativeCandidates: async (...args: Parameters<typeof actual.visitPlannerAlternativeCandidates>): Promise<PlannerAlternativeSearchExecution> => {
      const [input, engine, onCandidate, options] = args
      searchCalls.inputs.push(structuredClone(input))
      searchCalls.options.push(options === undefined ? undefined : { keys: Object.keys(options).sort(), instrumentationKeys: options.instrumentation === undefined ? null : Object.keys(options.instrumentation).sort() })
      return actual.visitPlannerAlternativeCandidates(input, engine, onCandidate, options)
    },
  }
})
beforeEach(() => { searchCalls.inputs = []; searchCalls.options = [] })

type Json = Record<string, unknown>
const sha256 = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))).map(b => b.toString(16).padStart(2, '0')).join('')
const fJson = JSON.parse(rawB2C2B2F)
const eJson = JSON.parse(rawB2C2B2E)
const parsedE = parsePhase2C26B2C2B2FB2C2B2EAuthority(eJson, PHASE2C26B2C2B2F_REGISTERED_B2C2B2E.resultSha256)
const fWith = (patch: (j: Json & { decision: Json; provenance: Json; parity: Json; population: Json; conditions: Json }) => void) => {
  const copy = structuredClone(fJson)
  patch(copy)
  return parsePhase2C26B2C2B2GB2C2B2FAuthority(copy, PHASE2C26B2C2B2G_REGISTERED_B2C2B2F.resultSha256)
}
const SLOW = 120_000

// ---------------------------------------------------------------- population and probe manifest

describe('Phase 2-C2.6-B2-C2B2G population, probe and manifest', () => {
  it('reads the committed B2-C2B2F RESULT as the registered formal authority, failing closed on another SHA-256, case, dominant, Stage 1, instrumentation, chain or identity', async () => {
    expect(await sha256(rawB2C2B2F)).toBe(PHASE2C26B2C2B2G_REGISTERED_B2C2B2F.resultSha256)
    expect(await sha256(rawB2C2B2E)).toBe(PHASE2C26B2C2B2G_REGISTERED_B2C2B2F.b2c2b2eResultSha256)
    const parsed = parsePhase2C26B2C2B2GB2C2B2FAuthority(fJson, PHASE2C26B2C2B2G_REGISTERED_B2C2B2F.resultSha256)
    expect(parsed.issues).toEqual([])
    expect(parsed.authority).toMatchObject({ decisionCase: 'B2C2B2F_BONUS_DOMINANT', dominant: 'BONUS', measuredHead: PHASE2C26B2C2B2G_REGISTERED_B2C2B2F.measuredHead,
      stage1: PHASE2C26B2C2B2F_STAGE1, searchInstrumentation: PHASE2C26A4_SEARCH_INSTRUMENTATION, b2c2b2eResultSha256: PHASE2C26B2C2B2F_REGISTERED_B2C2B2E.resultSha256 })
    expect(parsed.authority!.targetWeaponIds).toHaveLength(1)
    expect(parsePhase2C26B2C2B2GB2C2B2FAuthority(fJson, '0'.repeat(64)).valid).toBe(false)
    expect(fWith(j => { j.decision.case = 'B2C2B2F_MIXED' }).valid).toBe(false)
    expect(fWith(j => { j.decision.dominant = 'SKILL' }).valid).toBe(false)
    expect(fWith(j => { j.provenance.formal = false }).valid).toBe(false)
    expect(fWith(j => { j.provenance.partialRun = true }).valid).toBe(false)
    expect(fWith(j => { j.provenance.launchProvenanceVerified = false }).valid).toBe(false)
    expect(fWith(j => { j.provenance.b2c2b2eResultSha256 = '1'.repeat(64) }).valid).toBe(false)
    expect(fWith(j => { j.invalidReasons = ['x'] }).valid).toBe(false)
    expect(fWith(j => { j.conditions.stage1 = { ...PHASE2C26B2C2B2F_STAGE1, budgetMs: 3_600_000 } }).valid).toBe(false)
    expect(fWith(j => { j.conditions.searchInstrumentation = PHASE2C26A7_SEARCH_INSTRUMENTATION }).valid).toBe(false)
    expect(fWith(j => { (j.parity.hashChain as Json).exportMatchesRunner = false }).valid).toBe(false)
    expect(fWith(j => { (j.parity.childIdentity as Json).searchInputDigest = false }).valid).toBe(false)
    expect(fWith(j => { (j.parity.identity as Json).rawEqualsExpected = false }).valid).toBe(false)
    expect(fWith(j => { (j.parity.excludedRoute as Json).childAttestedExcludedRouteKeySha256 = '2'.repeat(64) }).valid).toBe(false)
    expect(fWith(j => { j.population.probes = [] }).valid).toBe(false)
  })

  it('derives the population mechanically from B2-C2B2F (BONUS dominant, 1 Target) and chains it to the B2-C2B2E-derived probe, identity and excluded Route; never a hard-coded Target', () => {
    const f = parsePhase2C26B2C2B2GB2C2B2FAuthority(fJson, PHASE2C26B2C2B2G_REGISTERED_B2C2B2F.resultSha256).authority
    const derived = phase2c26b2c2b2gPopulation(f, parsedE.authority)
    expect(derived.issues).toEqual([])
    expect(Object.values(derived.chain).every(v => v === true)).toBe(true)
    expect(derived.targetWeaponIds).toEqual(fJson.population.targetWeaponIds)
    expect(derived.targetWeaponIds).toHaveLength(PHASE2C26B2C2B2G_EXPECTED_TASKS)
    expect(derived.probes).toEqual(fJson.population.probes)
    expect(derived.expectedTaskIdentities).toEqual([fJson.parity.identity.expected])
    const fromE = phase2c26b2c2b2fPopulation(parsedE.authority)
    expect(derived.probes).toEqual(fromE.probes)
    expect(derived.expectedTaskIdentities).toEqual(fromE.expectedTaskIdentities)
    expect(derived.excludedRouteKeySha256).toBe(fromE.b2c2b2e[0]!.rederivedExcludedRouteKeySha256)
    // Fail closed: a B2-C2B2F probe / identity / excluded Route drifting from the B2-C2B2E-derived one, a missing authority.
    const at = (patch: Parameters<typeof fWith>[0]) => phase2c26b2c2b2gPopulation(fWith(patch).authority ?? null, parsedE.authority)
    const shift = (j: Json & { population: Json; provenance: Json }) => {
      const probes = j.population.probes as Json[]
      j.population.probes = probes.map(p => ({ ...p, contextRank: (p.contextRank as number) + 1 }))
      const body = (j.provenance.startAttestation as Json).body as Json
      body.probes = j.population.probes
    }
    expect(at(shift).issues.join()).toMatch(/probesEqualB2C2B2EDerived/)
    expect(phase2c26b2c2b2gPopulation({ ...f!, excludedRouteKeySha256: '3'.repeat(64) }, parsedE.authority).issues.join()).toMatch(/excludedRouteEqualsB2C2B2E/)
    expect(phase2c26b2c2b2gPopulation({ ...f!, exportSha256: '4'.repeat(64) }, parsedE.authority).issues.join()).toMatch(/exportEqualsB2C2B2E/)
    expect(phase2c26b2c2b2gPopulation({ ...f!, targetWeaponIds: [] }, parsedE.authority).valid).toBe(false)
    expect(phase2c26b2c2b2gPopulation(null, parsedE.authority)).toMatchObject({ valid: false, targetWeaponIds: [] })
    expect(phase2c26b2c2b2gPopulation(f, null)).toMatchObject({ valid: false, targetWeaponIds: [] })
  })

  it('writes the probe and its expected Search input identity only (no expected key / index / cost / outcome / section / measurement), exactly what the runner accepts', () => {
    const f = parsePhase2C26B2C2B2GB2C2B2FAuthority(fJson, PHASE2C26B2C2B2G_REGISTERED_B2C2B2F.resultSha256).authority!
    const manifest = phase2c26b2c2b2gProbeManifest(f, parsedE.authority!)
    expect(Object.keys(manifest).sort()).toEqual(['b2c2b2eResultSha256', 'b2c2b2fResultSha256', 'contextSelection', 'expectedTaskIdentities', 'exportSha256', 'extentRule', 'phase', 'policy', 'population', 'probes'])
    expect(manifest).toMatchObject({ b2c2b2fResultSha256: PHASE2C26B2C2B2G_REGISTERED_B2C2B2F.resultSha256, b2c2b2eResultSha256: PHASE2C26B2C2B2F_REGISTERED_B2C2B2E.resultSha256,
      population: 'B2C2B2F_BONUS_DOMINANT_PROFILED_TARGET', exportSha256: fJson.provenance.exportSha256 })
    expect(JSON.stringify(manifest.probes) + JSON.stringify(manifest.expectedTaskIdentities)).not.toMatch(/stableKey|candidateIndex|operationCost|exact|coverage|oracle|required|route|timeout|memory|heap|yield|wall|bottleneck|section|dominant|state_generation|frontier/i)
    expect(parsePhase2C26B2C2B2GProbeManifest(structuredClone(manifest))).toMatchObject({ valid: true, issues: [] })
    const bad = (patch: (m: Json & typeof manifest) => void) => { const copy = structuredClone(manifest) as Json & typeof manifest; patch(copy); return parsePhase2C26B2C2B2GProbeManifest(copy).valid }
    expect(bad(m => { m.probes = [...m.probes, m.probes[0]!] })).toBe(false)
    expect(bad(m => { m.probes = [] })).toBe(false)
    expect(bad(m => { m.expectedTaskIdentities[0]!.contextRank += 1 })).toBe(false)
    expect(bad(m => { (m as Json).population = 'B2C2B2E_BRANCH_C_TIME_BOUND_TIMEOUT' })).toBe(false)
    expect(bad(m => { (m as Json).b2c2b2fResultSha256 = 'x' })).toBe(false)
    expect(bad(m => { m.probes[0]!.extent = { maxNormalAdvance: 128, maxGogmaAdvance: 235, maxSkillAdvance: 1500 } })).toBe(false)
    for (const field of ['expectedStableKey', 'expectedSection', 'expectedDominant', 'a7Result', 'b2c2b2fBonusShare']) {
      expect(bad(m => { (m.probes[0] as unknown as Json)[field] = 1 })).toBe(false)
      expect(bad(m => { (m.expectedTaskIdentities[0] as unknown as Json)[field] = 1 })).toBe(false)
      expect(bad(m => { m[field] = {} })).toBe(false)
    }
  })
})

// ---------------------------------------------------------------- registered conditions

describe('Phase 2-C2.6-B2-C2B2G registered conditions', () => {
  it('registers 1 task and B2-C2B2F\'s Stage 1 unchanged (30 minutes / 12,288 MB / concurrency 1 / no retry / no fallback), exactly the two boundary observers and no CPU profiler', () => {
    expect(PHASE2C26B2C2B2G_EXPECTED_TASKS).toBe(1)
    expect(PHASE2C26B2C2B2G_STAGE1).toEqual({ executionClass: 'stage1', childHeapMb: 12_288, concurrency: 1, budgetMs: 1_800_000, retry: 'none', fallback: 'none' })
    expect(PHASE2C26B2C2B2G_STAGE1).toEqual(PHASE2C26B2C2B2F_STAGE1)
    expect([PHASE2C26B2C2B2G_BUDGET_MS, PHASE2C26B2C2B2G_CHILD_HEAP_MB]).toEqual([1_800_000, 12_288])
    expect(PHASE2C26B2C2B2G_CHANGED_STAGE1_FIELDS).toEqual([])
    expect(PHASE2C26B2C2B2G_SEARCH_INSTRUMENTATION).toEqual({ onSearchRuntime: true, onGogmaReservedRuntime: true, onGogmaReservedDepth: false, onSkillReservedDepth: false, onWorkSettled: false })
    expect(PHASE2C26B2C2B2G_SEARCH_INSTRUMENTATION).toBe(PHASE2C26A7_SEARCH_INSTRUMENTATION)
    const changed = Object.keys(PHASE2C26B2C2B2G_SEARCH_INSTRUMENTATION).filter(k => PHASE2C26B2C2B2G_SEARCH_INSTRUMENTATION[k as keyof typeof PHASE2C26B2C2B2G_SEARCH_INSTRUMENTATION]
      !== PHASE2C26A4_SEARCH_INSTRUMENTATION[k as keyof typeof PHASE2C26A4_SEARCH_INSTRUMENTATION])
    expect(changed).toEqual(['onGogmaReservedRuntime'])
    expect(PHASE2C26B2C2B2G_CHANGED_FROM_B2C2B2F).toEqual(['searchInstrumentation.onGogmaReservedRuntime'])
    expect(PHASE2C26B2C2B2G_CPU_PROFILER).toBe(false)
    expect(PHASE2C26B2C2B2G_INNER_SECTIONS).toBe(RESERVED_GOGMA_RUNTIME_PHASES)
    expect([...PHASE2C26B2C2B2G_INNER_SECTIONS]).toEqual(['window_collection', 'support_evaluation', 'state_generation', 'solution_materialization', 'frontier_reduction_sort', 'exhaustion_scan'])
    expect(PHASE2C26B2C2B2G_WINDOWS_MS).toEqual([[0, 600_000], [600_000, 1_200_000], [1_200_000, 1_800_000]])
    expect(PHASE2C26B2C2B2G_PROVENANCE_FLAGS).toMatchObject({ oracleReadBySearchChild: false, expectedOutcomeKnownBySearchChild: false, productionSchedulerEvidence: false, routeExactJudged: false,
      profilingOnly: true, innerRuntimeProfiling: true, absoluteRuntimeComparedWithB2C2B2F: false })
    for (const notRun of ['heap_16gb', 'budget_60min_or_more', 'automatic_longer_retry', 'retry', 'timeout_fallback', 'v8_cpu_profiler', 'production_optimization', 'search_semantics_change',
      'new_production_instrumentation_seam', 'new_inner_section', 'extent_change', 'context_change', 'p1_change', 'e2_search', 'k2_feature_grouping', 'residual_unreached_support',
      'global_assignment', 'full_planner_rerun', 'ui_change', 'a3_a9_result_regeneration', 'b2c2b2e_result_regeneration', 'b2c2b2f_result_regeneration']) expect(PHASE2C26B2C2B2G_NOT_RUN).toContain(notRun)
    expect(phase2c26b2c2b2gConditionIssues({ smoke: false, runs: [{ taskId: 't', process: { budgetMs: 1_800_000, nodeFlags: ['--max-old-space-size=12288'] } }] })).toEqual([])
    expect(phase2c26b2c2b2gConditionIssues({ smoke: false, runs: [{ taskId: 't', process: { budgetMs: 3_600_000, nodeFlags: ['--max-old-space-size=12288'] } }] }).join()).toMatch(/budget/)
    expect(phase2c26b2c2b2gConditionIssues({ smoke: false, runs: [{ taskId: 't', process: { budgetMs: 1_800_000, nodeFlags: ['--max-old-space-size=16384'] } }] }).join()).toMatch(/heap/)
    expect(phase2c26b2c2b2gConditionIssues({ smoke: false, runs: [{ taskId: 't', process: { budgetMs: 1_800_000, nodeFlags: ['--max-old-space-size=12288', '--cpu-prof'] } }] }).join()).toMatch(/CPU profiler/)
    expect(phase2c26b2c2b2gConditionIssues({ smoke: false, runs: [{ taskId: 't', process: { budgetMs: 1_800_000 } }, { taskId: 't', process: { budgetMs: 1_800_000 } }] }).join()).toMatch(/no retry/)
  })
})

// ---------------------------------------------------------------- a synthetic world (B2-C2B2F's shape)

const SOURCE_A_SKILL = 'series_skill.fixture.z'
const SOURCE_B_SKILL = 'series_skill.fixture.b-source'
const L2 = { maxNormalAdvance: 128, maxGogmaAdvance: 235, maxSkillAdvance: 1500 }
const TIGHT = { maxNormalAdvance: 4, maxGogmaAdvance: 235, maxSkillAdvance: 64 }

function world() {
  const skill = { seriesSkillId: SOURCE_A_SKILL, groupSkillId: null, matchMode: 'all' as const }
  const a: TargetWeapon = orchestrationTarget('target.b2c2b2g.a', { priority: 5, idealSkillCondition: skill, practicalSkillCondition: skill })
  const b = skillConstrainedTarget('target.b2c2b2g.b', { priority: 1 })
  const built = orchestrationScenario({
    engine: { gogmaPositions: L2.maxGogmaAdvance + 8, skillPositions: L2.maxSkillAdvance + 8 },
    targets: [a, b],
    ownedWeapons: [orchestrationSource(ORCHESTRATION_SOURCE_A, { seriesSkillId: SOURCE_A_SKILL }),
      orchestrationSource(ORCHESTRATION_SOURCE_B, { restorationBonuses: belowPracticalBonuses(), seriesSkillId: SOURCE_B_SKILL })],
    entries: [
      orchestrationEntry('build-list.b2c2b2g.a', a, resetRoute(ORCHESTRATION_SOURCE_A), { finalBonuses: idealBonuses(), seriesSkillId: SOURCE_A_SKILL }),
      orchestrationEntry('build-list.b2c2b2g.b', b, { kind: 'existing_gogma_mixed', sourceOwnedWeaponId: resetRoute(ORCHESTRATION_SOURCE_B).sourceOwnedWeaponId,
        operations: [...resetRoute(ORCHESTRATION_SOURCE_B).operations, ...resetSkillsRoute(ORCHESTRATION_SOURCE_B).operations] }),
    ],
  })
  const schedule = derivePhase2C26B2C1Schedule(built.input, globalResearchDependencies(built.engine))
  return { built, schedule }
}
const PROBE: Phase2C26B2C2B2EProbe = { targetWeaponId: 'target.b2c2b2g.b', b2c2b2dTaskId: 't02-r02', contextRank: 2, extent: { ...TIGHT } }
function manifestFor(schedule: ReturnType<typeof world>['schedule']) {
  const built = buildPhase2C26B2C2B2ETasks(schedule, [PROBE])
  if (!built.valid) throw new Error(built.issues.join())
  return { probes: [PROBE], expectedTaskIdentities: [phase2c26b2c2b2fTaskIdentity(built.tasks[0]!)] }
}

describe('Phase 2-C2.6-B2-C2B2G task construction and child calculation', () => {
  it('builds the task with B2-C2B2F\'s identity-gated construction (1 task) and fails closed on identity drift', () => {
    const { schedule } = world()
    const manifest = manifestFor(schedule)
    const ours = buildPhase2C26B2C2B2GTasks(schedule, manifest)
    expect(ours.issues).toEqual([])
    expect(ours.tasks).toEqual(buildPhase2C26B2C2B2ETasks(schedule, [PROBE]).tasks)
    const drift = structuredClone(manifest)
    drift.expectedTaskIdentities[0]!.searchInputDigest = 'other'
    expect(buildPhase2C26B2C2B2GTasks(schedule, drift)).toMatchObject({ valid: false, tasks: [] })
    expect(buildPhase2C26B2C2B2GTasks(schedule, { ...manifest, expectedTaskIdentities: [] }).valid).toBe(false)
  })

  it('is B2-C2B2D\'s Search body and task body line for line, except the instrumentation hand-over (the two boundary observers) and the options type', () => {
    const body = (source: string, name: string) => {
      const start = source.indexOf(`export async function ${name}(`)
      const end = source.indexOf('\n}\n', start)
      if (start < 0 || end < 0) throw new Error(`no ${name}`)
      return source.slice(start, end)
    }
    const normalize = (text: string) => text
      .replace(/options\.instrumentation === undefined \? \{ yieldControl: options\.yieldControl \} : \{ yieldControl: options\.yieldControl,\s+instrumentation: \{ onSearchRuntime: options\.instrumentation\.onSearchRuntime, onGogmaReservedRuntime: options\.instrumentation\.onGogmaReservedRuntime \} \}/, '{ yieldControl: options.yieldControl }')
      .replace(/options: Phase2C26B2C2B2GSearchOptions = \{\}/, 'options: { yieldControl?: () => Promise<void>; now?: () => number } = {}')
      .replace(/B2C2B2[DG]/g, 'X').replace(/Phase2C26B2C2B2[DG]/g, 'PhaseX')
    expect(normalize(body(searchSource, 'runPhase2C26B2C2B2GSearch'))).toBe(normalize(body(d2Source, 'runPhase2C26B2C2B2DSearch')))
    expect(normalize(body(searchSource, 'runPhase2C26B2C2B2GTask'))).toBe(normalize(body(d2Source, 'runPhase2C26B2C2B2DTask')))
    expect(searchSource).toMatch(/instrumentation: \{ onSearchRuntime: options\.instrumentation\.onSearchRuntime, onGogmaReservedRuntime: options\.instrumentation\.onGogmaReservedRuntime \}/)
    expect(typeof runPhase2C26B2C2B2GSearch).toBe('function')
  })

  it('changes no Search semantics: A (no instrumentation), B (onSearchRuntime) and C (onSearchRuntime + onGogmaReservedRuntime) give the identical record, and the inner profile reconciles', async () => {
    const { built, schedule } = world()
    const task = buildPhase2C26B2C2B2GTasks(schedule, manifestFor(schedule)).tasks[0]!
    const a = await runPhase2C26B2C2B2DTask(built.input, schedule, task, built.engine, { now: () => 0 })
    let clockB = 0
    const profilerB = createPhase2C26B2C2B2FProfiler({ now: () => (clockB += 1) })
    profilerB.start()
    const b = await runPhase2C26B2C2B2FTask(built.input, schedule, task, built.engine, { now: () => 0, instrumentation: profilerB.instrumentation,
      yieldControl: profilerB.wrapYield(() => Promise.resolve()) })
    let clockC = 0
    const profilerC = createPhase2C26B2C2B2GProfiler({ now: () => (clockC += 1) })
    profilerC.start()
    let yields = 0
    const c = await runPhase2C26B2C2B2GTask(built.input, schedule, task, built.engine, { now: () => 0, instrumentation: profilerC.instrumentation,
      yieldControl: profilerC.wrapYield(() => { yields += 1; return Promise.resolve() }) })
    const unprofiled = await runPhase2C26B2C2B2GTask(built.input, schedule, task, built.engine, { now: () => 0 })
    if (a.status !== 'searched' || b.status !== 'searched' || c.status !== 'searched') throw new Error('not searched')
    expect(a.search.candidates.length).toBeGreaterThan(0)
    expect(b).toEqual(a)
    expect(c).toEqual(a)
    expect(unprofiled).toEqual(a)
    expect(c.search.candidates.map(x => x.stableKey)).toEqual(a.search.candidates.map(x => x.stableKey))
    expect(c.search.candidates.map(x => x.deliveryIndex)).toEqual(a.search.candidates.map(x => x.deliveryIndex))
    expect([c.search.summary, c.search.termination, c.search.excludedRouteKeys, c.search.summary.stoppedByConsumer, c.search.summary.stoppedByExtent])
      .toEqual([a.search.summary, a.search.termination, a.search.excludedRouteKeys, a.search.summary.stoppedByConsumer, a.search.summary.stoppedByExtent])
    // The instrumentation handed to the Search: none (A), onSearchRuntime (B), exactly the two boundary observers (C), none (unprofiled C).
    expect(searchCalls.options).toEqual([{ keys: ['yieldControl'], instrumentationKeys: null }, { keys: ['instrumentation', 'yieldControl'], instrumentationKeys: ['onSearchRuntime'] },
      { keys: ['instrumentation', 'yieldControl'], instrumentationKeys: ['onGogmaReservedRuntime', 'onSearchRuntime'] }, { keys: ['yieldControl'], instrumentationKeys: null }])
    const snapshot = profilerC.snapshot('final')
    expect(snapshot.runtime.contractViolations).toBe(0)
    expect(snapshot.runtime.activeStack).toEqual([])
    expect(snapshot.inner.runtime.contractViolations).toBe(0)
    expect(snapshot.inner.outsideReadViolations).toBe(0)
    expect(snapshot.inner.runtime.activePhase).toBeNull()
    expect(snapshot.inner.runtime.activeDepth).toBeNull()
    expect(snapshot.inner.atMs).toBe(snapshot.runtime.atMs)
    expect(snapshot.inner.counts.completedDepths).toBeGreaterThan(0)
    expect(snapshot.newDepthRecords).toHaveLength(snapshot.inner.counts.completedDepths)
    expect(snapshot.yields.count).toBe(yields)
    const reconciliation = phase2c26b2c2b2gSnapshotReconciliation(snapshot)!
    expect(reconciliation.issues).toEqual([])
    expect(reconciliation.innerSectionsMs).toBeGreaterThan(0)
    expect(reconciliation.innerCoverageOfBonusDepthRead).toBeLessThanOrEqual(1)
    expect(reconciliation.remainderSplitMs.inDepthOutsideSections).toBeGreaterThanOrEqual(0)
    expect(reconciliation.remainderSplitMs.outsideDepthBoundaries).toBeGreaterThanOrEqual(0)
    expect(phase2c26b2c2b2gCollectDepthRecords([snapshot])).toMatchObject({ valid: true, issues: [] })
    // The inner tracker saw every depth the outer Bonus depth works read (one held-aware read per Bonus depth work).
    expect(snapshot.inner.counts.completedDepths).toBe(snapshot.depth.bonus.completedWorks)
  }, SLOW)

  it('attests the Search identity the child rebuilt before searching (B2-C2B2F\'s rule unchanged)', () => {
    const { schedule } = world()
    const task = buildPhase2C26B2C2B2GTasks(schedule, manifestFor(schedule)).tasks[0]!
    expect(phase2c26b2c2b2gChildSearchIdentity(schedule, task, key => `h:${key}`)).toMatchObject({ valid: true, taskId: 't02-r02', searchInputDigest: task.searchInputDigest,
      defaultSearchInputDigest: task.defaultSearchInputDigest, extent: TIGHT, excludedRouteKeyCount: 1, excludedRouteIsCurrentRoute: true })
  })
})

// ---------------------------------------------------------------- the profiler

const os = (section: SearchRuntimeSection, extra: object = {}): SearchRuntimeEvent => ({ type: 'section_started', section, ...extra }) as SearchRuntimeEvent
const oc = (section: SearchRuntimeSection, extra: object = {}): SearchRuntimeEvent => ({ type: 'section_completed', section, ...extra }) as SearchRuntimeEvent
const COUNTS0 = { frontierStatesBefore: 2, legalPositionCount: null, generatedStates: null, frontierStatesAfter: null, windowMemoEntries: 1 }
const ie = (type: ReservedGogmaRuntimeEvent['type'], depth: number, extra: object = {}): ReservedGogmaRuntimeEvent =>
  ({ type, streamIndex: 0, startGogmaCounter: 10, depth, counts: { ...COUNTS0 }, ...(type === 'depth_completed' ? { exhausted: false } : {}), ...extra }) as ReservedGogmaRuntimeEvent
const ip = (type: 'phase_started' | 'phase_completed', phase: typeof RESERVED_GOGMA_RUNTIME_PHASES[number], depth: number, counts: object = {}) => ie(type, depth, { phase, counts: { ...COUNTS0, ...counts } })
const WORK_COUNTS = { rawSolutions: 100, unsupportedPredictions: 0, idealSolutions: 0, evaluatedSolutions: 0, subscriberCount: 1, retainedCountAfter: 0, exhausted: false }

type Step = [number, 'o', SearchRuntimeEvent] | [number, 'i', ReservedGogmaRuntimeEvent]
function drive(steps: Step[], scale = 1) {
  let clock = 0
  const profiler = createPhase2C26B2C2B2GProfiler({ now: () => clock })
  profiler.start()
  for (const [at, kind, event] of steps) {
    clock = at * scale
    if (kind === 'o') profiler.outerObserver(event as SearchRuntimeEvent)
    else profiler.innerObserver(event as ReservedGogmaRuntimeEvent)
  }
  return { profiler, setClock: (at: number) => { clock = at * scale } }
}
/** Two depths of one held-aware stream inside two Bonus depth works; the second read, depth and state_generation are still open. */
const TWO_DEPTHS: Step[] = [
  [0, 'o', os('search_runtime')], [1, 'o', os('scheduler_step')], [1, 'o', os('scheduler_settle')], [2, 'o', os('bonus_depth_work', { work: { channel: 0, depth: 1 } })], [3, 'o', os('bonus_depth_read')],
  [4, 'i', ie('depth_started', 1)], [5, 'i', ip('phase_started', 'window_collection', 1)], [7, 'i', ip('phase_completed', 'window_collection', 1, { legalPositionCount: 3 })],
  [7, 'i', ip('phase_started', 'support_evaluation', 1)], [8, 'i', ip('phase_completed', 'support_evaluation', 1)], [8, 'i', ip('phase_started', 'state_generation', 1)],
  [20, 'i', ip('phase_completed', 'state_generation', 1, { legalPositionCount: 3, generatedStates: 100 })], [20, 'i', ip('phase_started', 'solution_materialization', 1)],
  [22, 'i', ip('phase_completed', 'solution_materialization', 1)], [22, 'i', ip('phase_started', 'frontier_reduction_sort', 1)],
  [30, 'i', ip('phase_completed', 'frontier_reduction_sort', 1, { legalPositionCount: 3, generatedStates: 100, frontierStatesAfter: 5 })], [30, 'i', ip('phase_started', 'exhaustion_scan', 1)],
  [31, 'i', ip('phase_completed', 'exhaustion_scan', 1)], [32, 'i', ie('depth_completed', 1, { counts: { ...COUNTS0, legalPositionCount: 3, generatedStates: 100, frontierStatesAfter: 5 } })],
  [33, 'o', oc('bonus_depth_read')], [35, 'o', oc('bonus_depth_work', { counts: WORK_COUNTS })], [35, 'o', oc('scheduler_settle')], [35, 'o', oc('scheduler_step')],
  [36, 'o', os('scheduler_step')], [36, 'o', os('scheduler_settle')], [36, 'o', os('bonus_depth_work', { work: { channel: 0, depth: 2 } })], [37, 'o', os('bonus_depth_read')],
  [38, 'i', ie('depth_started', 2, { counts: { ...COUNTS0, frontierStatesBefore: 5 } })], [39, 'i', ip('phase_started', 'window_collection', 2)],
  [40, 'i', ip('phase_completed', 'window_collection', 2)], [40, 'i', ip('phase_started', 'state_generation', 2)],
]

describe('Phase 2-C2.6-B2-C2B2G profiler', () => {
  it('observes outer and inner on one frozen instant and reconciles them without double counting, keeping the open read / depth / phase at a kill', () => {
    // A clock that moves on every read still gives one instant to both trackers inside a snapshot.
    let moving = 0
    const p = createPhase2C26B2C2B2GProfiler({ now: () => (moving += 7) })
    p.start()
    const frozenSnap = p.snapshot('heartbeat')
    expect(frozenSnap.inner.atMs).toBe(frozenSnap.runtime.atMs)

    const { profiler, setClock } = drive(TWO_DEPTHS)
    setClock(100)
    const snap = profiler.snapshot('heartbeat')
    expect(snap.inner.atMs).toBe(100)
    expect(snap.runtime.atMs).toBe(100)
    expect(snap.runtime.contractViolations).toBe(0)
    expect(snap.inner.runtime.contractViolations).toBe(0)
    expect(snap.inner.outsideReadViolations).toBe(0)
    expect(snap.runtime.activeStack.map(f => f.section)).toEqual(['search_runtime', 'scheduler_step', 'scheduler_settle', 'bonus_depth_work', 'bonus_depth_read'])
    expect(snap.inner.runtime.activeDepth).toMatchObject({ streamIndex: 0, depth: 2, elapsedMs: 62, phaseMs: { window_collection: 1 } })
    expect(snap.inner.runtime.activePhase).toMatchObject({ depth: 2, phase: 'state_generation', elapsedMs: 60 })
    const inner = phase2c26b2c2b2gInnerObservation(snap)
    expect(inner.sectionMs).toEqual({ window_collection: 2 + 1, support_evaluation: 1, state_generation: 12 + 60, solution_materialization: 2, frontier_reduction_sort: 8, exhaustion_scan: 1 })
    expect(inner.completedSectionMs.state_generation).toBe(12)
    expect(inner.sectionCounts).toEqual({ window_collection: 2, support_evaluation: 1, state_generation: 1, solution_materialization: 1, frontier_reduction_sort: 1, exhaustion_scan: 1 })
    expect(inner.inclusiveMs).toBe(28 + 62)
    const r = phase2c26b2c2b2gSnapshotReconciliation(snap)!
    expect(r.issues).toEqual([])
    expect(r.bonusDepthReadMs).toBe(30 + 63)
    expect(r.innerSectionsMs).toBe(87)
    expect(r.innerCoverageOfBonusDepthRead).toBeCloseTo(87 / 93, 12)
    expect(r.remainderMs).toBe(6)
    expect(r.remainderSplitMs).toEqual({ inDepthOutsideSections: 3, outsideDepthBoundaries: 3 })
    expect(r.remainderSplitMs.inDepthOutsideSections + r.remainderSplitMs.outsideDepthBoundaries).toBe(r.remainderMs)
    expect(r.sections.reduce((sum, s) => sum + s.totalMs, 0)).toBe(r.innerSectionsMs)
    expect(r.dominantSection).toBe('state_generation')
    expect(r.dominantShareOfBonusDepthRead).toBeCloseTo(72 / 93, 12)
    expect(r.secondLargestSection).toBe('frontier_reduction_sort')
    expect(r.searchWallMs).toBe(100)
    // The depth record of the completed depth is handed out exactly once.
    expect(snap.newDepthRecords).toHaveLength(1)
    expect(snap.newDepthRecords[0]).toMatchObject({ depth: 1, inclusiveMs: 28, counts: { generatedStates: 100, frontierStatesAfter: 5, legalPositionCount: 3 } })
    expect(snap.inner.counts).toMatchObject({ completedDepths: 1, generatedStatesSum: 100, frontierStatesAfterSum: 5, legalPositionCountSum: 3, frontierStatesBeforeSum: 2 })
    expect(profiler.snapshot('heartbeat').newDepthRecords).toEqual([])
    expect(phase2c26b2c2b2gCollectDepthRecords([snap, profiler.snapshot('heartbeat')])).toMatchObject({ valid: true })
    expect(phase2c26b2c2b2gCollectDepthRecords([snap, snap]).valid).toBe(false)
  })

  it('counts overlapping inner sections and inner boundaries outside an open bonus_depth_read as contract violations (never throws into the Search)', () => {
    const overlap = drive([[0, 'o', os('search_runtime')], [1, 'o', os('scheduler_step')], [1, 'o', os('scheduler_settle')], [2, 'o', os('bonus_depth_work', { work: { channel: 0, depth: 1 } })],
      [3, 'o', os('bonus_depth_read')], [4, 'i', ie('depth_started', 1)], [5, 'i', ip('phase_started', 'window_collection', 1)], [6, 'i', ip('phase_started', 'state_generation', 1)]])
    expect(overlap.profiler.snapshot('heartbeat').inner.runtime.contractViolations).toBeGreaterThan(0)
    const outside = drive([[0, 'o', os('search_runtime')], [1, 'o', os('scheduler_step')], [2, 'i', ie('depth_started', 1)], [3, 'i', ie('depth_completed', 1)]])
    const snap = outside.profiler.snapshot('heartbeat')
    expect(snap.inner.outsideReadViolations).toBe(2)
    expect(snap.inner.outsideReadViolationSamples[0]).toMatch(/inside scheduler_step/)
    const skipped = drive([[0, 'o', os('search_runtime')], [1, 'o', os('scheduler_step')], [1, 'o', os('scheduler_settle')], [2, 'o', os('bonus_depth_work', { work: { channel: 0, depth: 1 } })],
      [3, 'o', os('bonus_depth_read')], [4, 'i', ie('depth_started', 2)]])
    expect(skipped.profiler.snapshot('heartbeat').inner.runtime.contractViolations).toBeGreaterThan(0)
  })

  it('attributes each Research yield wait to the outer section and to the open inner section (or between sections) at the call', async () => {
    let clock = 0
    const p = createPhase2C26B2C2B2GProfiler({ now: () => clock })
    p.start()
    const wrapped = p.wrapYield(async () => { clock += 5 })
    await wrapped()
    p.outerObserver(os('search_runtime')); p.outerObserver(os('scheduler_step')); p.outerObserver(os('scheduler_settle'))
    p.outerObserver(os('bonus_depth_work', { work: { channel: 0, depth: 1 } })); p.outerObserver(os('bonus_depth_read'))
    p.innerObserver(ie('depth_started', 1))
    await wrapped()
    p.innerObserver(ip('phase_started', 'state_generation', 1))
    await wrapped(); await wrapped()
    p.innerObserver(ip('phase_completed', 'state_generation', 1))
    p.innerObserver(ip('phase_started', 'window_collection', 1))
    await wrapped()
    const snap = p.snapshot('heartbeat')
    expect(snap.yields).toEqual({ count: 5, totalMs: 25, bySection: { outside_search: { count: 1, totalMs: 5 }, bonus_depth_read: { count: 4, totalMs: 20 } } })
    expect(snap.inner.yieldsByInnerSection).toEqual({ outside_inner_section: { count: 1, totalMs: 5 }, state_generation: { count: 2, totalMs: 10 }, window_collection: { count: 1, totalMs: 5 } })
    // The inner phase wall includes the yield waits inside it (the Search's own wall time).
    expect(phase2c26b2c2b2gInnerObservation(snap).sectionMs.state_generation).toBe(10)
  })
})

// ---------------------------------------------------------------- reconciliation and decision

const READ = 1_000_000
function innerOf(sectionShares: Partial<Record<typeof RESERVED_GOGMA_RUNTIME_PHASES[number], number>>, opts: { inclusiveExtra?: number; read?: number } = {}): Phase2C26B2C2B2GInnerObservation {
  const read = opts.read ?? READ
  const sectionMs = Object.fromEntries(RESERVED_GOGMA_RUNTIME_PHASES.map(s => [s, (sectionShares[s] ?? 0) * read])) as Phase2C26B2C2B2GInnerObservation['sectionMs']
  const sum = Object.values(sectionMs).reduce((a, b) => a + b, 0)
  return { atMs: 1, sectionMs, completedSectionMs: { ...sectionMs }, sectionCounts: Object.fromEntries(RESERVED_GOGMA_RUNTIME_PHASES.map(s => [s, 1])) as Phase2C26B2C2B2GInnerObservation['sectionCounts'],
    inclusiveMs: sum + (opts.inclusiveExtra ?? 0), completedDepths: 1, maxDepthReached: 1, streams: 1, activePhase: null, activeDepth: null, contractViolations: 0, contractViolationSamples: [],
    outsideReadViolations: 0, outsideReadViolationSamples: [] }
}
const reconcile = (shares: Parameters<typeof innerOf>[0], opts: { wall?: number; read?: number; inclusiveExtra?: number } = {}) =>
  phase2c26b2c2b2gReconcile({ atMs: 1, inclusiveMs: { search_runtime: opts.wall ?? 2 * (opts.read ?? READ), bonus_depth_read: opts.read ?? READ } }, innerOf(shares, opts))
const decide = (r: ReturnType<typeof reconcile> | null, invalidReasons: string[] = [], insufficientReasons: string[] = []) => phase2c26b2c2b2gDecision({ invalidReasons, insufficientReasons, reconciliation: r })

describe('Phase 2-C2.6-B2-C2B2G reconciliation and decision', () => {
  it('computes coverage, the remainder and its split from the same instant and fails the reconciliation closed on a negative or impossible duration', () => {
    const r = reconcile({ state_generation: 0.6, frontier_reduction_sort: 0.3 }, { inclusiveExtra: 0.05 * READ })
    expect(r.issues).toEqual([])
    expect(r.innerCoverageOfBonusDepthRead).toBeCloseTo(0.9, 12)
    expect(r.remainderMs).toBeCloseTo(0.1 * READ, 6)
    expect(r.remainderSplitMs.inDepthOutsideSections).toBeCloseTo(0.05 * READ, 6)
    expect(r.remainderSplitMs.outsideDepthBoundaries).toBeCloseTo(0.05 * READ, 6)
    expect(r.sections.find(s => s.section === 'state_generation')).toMatchObject({ shareOfBonusDepthRead: 0.6, shareOfSearchWall: 0.3 })
    expect([r.dominantSection, r.secondLargestSection]).toEqual(['state_generation', 'frontier_reduction_sort'])
    expect(reconcile({ state_generation: 0.6, frontier_reduction_sort: 0.5 }).issues.join()).toMatch(/exceeds bonus_depth_read/)
    expect(reconcile({ state_generation: 0.6 }, { inclusiveExtra: -0.1 * READ }).issues.join()).toMatch(/exceed the inner inclusive/)
    expect(reconcile({ state_generation: -0.1 }).issues.join()).toMatch(/negative/)
    expect(phase2c26b2c2b2gReconcile({ atMs: 2, inclusiveMs: { search_runtime: 10, bonus_depth_read: 5 } }, innerOf({}, { read: 5 })).issues.join()).toMatch(/instants differ/)
    expect(decide(reconcile({ state_generation: 0.6, frontier_reduction_sort: 0.5 })).case).toBe('B2C2B2G_INVALID')
  })

  it('applies the registered decision rule at its boundaries (coverage 0.90, dominant 0.50, secondary 0.20, Search wall 60 s)', () => {
    expect([PHASE2C26B2C2B2G_COVERAGE_THRESHOLD, PHASE2C26B2C2B2G_DOMINANT_THRESHOLD, PHASE2C26B2C2B2G_SECONDARY_THRESHOLD, PHASE2C26B2C2B2G_MIN_SEARCH_WALL_MS]).toEqual([0.9, 0.5, 0.2, 60_000])
    expect(PHASE2C26B2C2B2G_DECISION_CASES).toEqual(['B2C2B2G_INVALID', 'B2C2B2G_INSUFFICIENT', 'B2C2B2G_WINDOW_COLLECTION_DOMINANT', 'B2C2B2G_SUPPORT_EVALUATION_DOMINANT',
      'B2C2B2G_STATE_GENERATION_DOMINANT', 'B2C2B2G_SOLUTION_MATERIALIZATION_DOMINANT', 'B2C2B2G_FRONTIER_REDUCTION_SORT_DOMINANT', 'B2C2B2G_EXHAUSTION_SCAN_DOMINANT', 'B2C2B2G_MIXED'])
    expect(decide(reconcile({ state_generation: 0.5, frontier_reduction_sort: 0.2, window_collection: 0.2 }))).toMatchObject({ case: 'B2C2B2G_STATE_GENERATION_DOMINANT', dominant: 'state_generation',
      secondary: ['window_collection', 'frontier_reduction_sort'], nextPhaseSections: ['state_generation'] })
    expect(decide(reconcile({ state_generation: 0.49, frontier_reduction_sort: 0.3, window_collection: 0.11 }))).toMatchObject({ case: 'B2C2B2G_MIXED', dominant: null,
      secondary: ['state_generation', 'frontier_reduction_sort'], nextPhaseSections: ['state_generation', 'frontier_reduction_sort'] })
    expect(decide(reconcile({ state_generation: 0.3, frontier_reduction_sort: 0.29, window_collection: 0.21, exhaustion_scan: 0.1 }))).toMatchObject({ case: 'B2C2B2G_MIXED',
      nextPhaseSections: ['state_generation', 'frontier_reduction_sort'] })
    expect(decide(reconcile({ frontier_reduction_sort: 0.9 })).case).toBe('B2C2B2G_FRONTIER_REDUCTION_SORT_DOMINANT')
    expect(decide(reconcile({ window_collection: 0.95 })).case).toBe('B2C2B2G_WINDOW_COLLECTION_DOMINANT')
    expect(decide(reconcile({ support_evaluation: 0.95 })).case).toBe('B2C2B2G_SUPPORT_EVALUATION_DOMINANT')
    expect(decide(reconcile({ solution_materialization: 0.95 })).case).toBe('B2C2B2G_SOLUTION_MATERIALIZATION_DOMINANT')
    expect(decide(reconcile({ exhaustion_scan: 0.95 })).case).toBe('B2C2B2G_EXHAUSTION_SCAN_DOMINANT')
    expect(decide(reconcile({ state_generation: 0.9 })).case).toBe('B2C2B2G_STATE_GENERATION_DOMINANT')
    expect(decide(reconcile({ state_generation: 0.89 }, { inclusiveExtra: 0.11 * READ }))).toMatchObject({ case: 'B2C2B2G_INSUFFICIENT', reasons: [expect.stringMatching(/innerCoverage/)] })
    expect(decide(reconcile({ state_generation: 1 }, { read: 29_999.5, wall: 59_999 }))).toMatchObject({ case: 'B2C2B2G_INSUFFICIENT', reasons: [expect.stringMatching(/Search wall/)] })
    expect(decide(reconcile({ state_generation: 1 }, { read: 30_000, wall: 60_000 })).case).toBe('B2C2B2G_STATE_GENERATION_DOMINANT')
    expect(decide(reconcile({}, { read: 0, wall: 100_000 }))).toMatchObject({ case: 'B2C2B2G_INSUFFICIENT', reasons: [expect.stringMatching(/no bonus_depth_read/)] })
    expect(decide(null).case).toBe('B2C2B2G_INSUFFICIENT')
    expect(decide(reconcile({ state_generation: 1 }), [], ['no profile snapshot']).case).toBe('B2C2B2G_INSUFFICIENT')
    expect(decide(reconcile({ state_generation: 1 }), ['x']).case).toBe('B2C2B2G_INVALID')
  })

  it('reads the durable snapshots in order (outer / inner instants equal) and computes descriptive windows of outer and inner from the same snapshots', () => {
    const MIN = 60_000
    const { profiler, setClock } = drive(TWO_DEPTHS, MIN / 10)
    const snaps: Phase2C26B2C2B2GProfileSnapshot[] = []
    // TWO_DEPTHS at 6 s per unit: the first depth completes at 192 s; boundaries at 10 / 20 minutes, a heartbeat at 25 minutes.
    setClock(100); snaps.push(profiler.snapshot('window_boundary', 600_000))
    setClock(200); snaps.push(profiler.snapshot('window_boundary', 1_200_000))
    setClock(250); snaps.push(profiler.snapshot('heartbeat'))
    expect(phase2c26b2c2b2gSelectSnapshot(snaps)).toMatchObject({ valid: true, source: 'last_durable_snapshot', snapshots: 3 })
    expect(phase2c26b2c2b2gSelectSnapshot([...snaps].reverse()).valid).toBe(false)
    const broken = structuredClone(snaps); broken[1]!.inner.atMs += 1
    expect(phase2c26b2c2b2gSelectSnapshot(broken).valid).toBe(false)
    const windows = phase2c26b2c2b2gWindows(snaps)
    expect(windows.map(w => [w.partial, w.observedFromMs, w.observedToMs])).toEqual([[false, 0, 600_000], [false, 600_000, 1_200_000], [true, 1_200_000, 1_500_000]])
    // Window 1 (0-10 min): the first depth's completed sections only (the read is open from 37 units on, nothing inner yet at 100... until 38/39/40).
    expect(windows[0]!.bonusDepthReadMs).toBe((30 + 63) * 6_000)
    expect(windows[0]!.completedDepths).toBe(1)
    expect(windows[0]!.generatedStates).toBe(100)
    expect(windows[1]!.completedDepths).toBe(0)
    expect(windows[1]!.dominantSection).toBe('state_generation')
    expect(windows[1]!.sections!.state_generation.ms).toBe(100 * 6_000)
    expect(windows[1]!.innerCoverageOfBonusDepthRead).toBeCloseTo(1, 12)
    for (const w of windows) expect(w.outerShares).not.toBeNull()
    // The windows sum to the cumulative observation.
    const total = windows.reduce((sum, w) => sum + (w.innerSectionsMs ?? 0), 0)
    expect(total).toBeCloseTo(phase2c26b2c2b2gSnapshotReconciliation(snaps[2]!)!.innerSectionsMs, 9)
    expect(phase2c26b2c2b2gWindows(snaps.slice(0, 0)).every(w => w.innerSectionsMs === null)).toBe(true)
    // Outer sanity of the last snapshot: BONUS the largest, the read observed, nothing delivered, a partition.
    expect(phase2c26b2c2b2gOuterSanity(snaps[2]!).checks).toEqual({ bonusIsLargestCategory: true, bonusDepthReadObserved: true, beforeFirstDelivery: true, outerContractViolationsZero: true,
      outerPartitionMatches: true })
    const stats = phase2c26b2c2b2gDepthStatistics(phase2c26b2c2b2gCollectDepthRecords(snaps).records)
    expect(stats.depths).toBe(1)
    expect(stats.perUnitNs.state_generation).toMatchObject({ unit: 'generatedStates', count: 1, median: (12 * 6_000 * 1e6) / 100 })
    expect(stats.byStream).toEqual([expect.objectContaining({ streamIndex: 0, depths: 1, generatedStates: 100 })])
  })
})

// ---------------------------------------------------------------- the runner start attestation

const HEAD = 'a'.repeat(40)
const OBS_PROBES: Phase2C26B2C2B2EProbe[] = [{ targetWeaponId: 't1', b2c2b2dTaskId: 't05-r03', contextRank: 3, extent: { maxNormalAdvance: 4, maxGogmaAdvance: 235, maxSkillAdvance: 900 } }]
const OBS_IDENTITIES: Phase2C26B2C2B2FTaskIdentity[] = [{ taskId: 't05-r03', targetWeaponId: 't1', contextRank: 3, groupIndex: 1, reservationDigest: 'r', targetEligibleMinCardinality: 1,
  representativeFixedSetId: 'k', representativeFixedTargetWeaponIds: ['t9'], defaultSearchInputDigest: 'd', searchInputDigest: 's', extent: { maxNormalAdvance: 4, maxGogmaAdvance: 235, maxSkillAdvance: 900 } }]
const observation0 = { createdAt: '2026-10-05T15:00:00.000Z', runnerScript: 'scripts/run-planner-global-phase2c26b2c2b2g.mjs', node: 'v24.19.0', repositoryHead: HEAD, uncommittedBenchmarkCode: false,
  benchmarkCodeSha256: 'b'.repeat(64), exportFileName: 'export.json', exportSha256: 'c'.repeat(64), exportBytes: 10, probeManifestFileName: 'probes.json.local', probeManifestSha256: 'd'.repeat(64),
  probeManifestB2C2B2FResultSha256: PHASE2C26B2C2B2G_REGISTERED_B2C2B2F.resultSha256, probeManifestB2C2B2EResultSha256: PHASE2C26B2C2B2F_REGISTERED_B2C2B2E.resultSha256,
  targetWeaponIds: ['t1'], probes: OBS_PROBES, expectedTaskIdentities: OBS_IDENTITIES, stage1: { ...PHASE2C26B2C2B2G_STAGE1 }, smoke: null }
const expectation: Phase2C26B2C2B2GAttestationExpectation = { repositoryHead: HEAD, benchmarkCodeSha256: 'b'.repeat(64), exportSha256: 'c'.repeat(64), probeManifestSha256: 'd'.repeat(64),
  b2c2b2fResultSha256: PHASE2C26B2C2B2G_REGISTERED_B2C2B2F.resultSha256, b2c2b2eResultSha256: PHASE2C26B2C2B2F_REGISTERED_B2C2B2E.resultSha256, probes: OBS_PROBES,
  expectedTaskIdentities: OBS_IDENTITIES, firstChildStartedAt: '2026-10-05T15:00:00.500Z' }

describe('Phase 2-C2.6-B2-C2B2G runner start attestation', () => {
  it('carries the launch observation and every registered condition (30 minutes / 12,288 MB / concurrency 1 / the two observers / no CPU profiler) and verifies only against independent values', () => {
    const attestation = phase2c26b2c2b2gStartAttestationBody(observation0)
    expect(attestation).toMatchObject({ attestedBy: 'runner', phase: PHASE2C26B2C2B2G_START_ATTESTATION_PHASE, stage1: { childHeapMb: 12_288, budgetMs: 1_800_000, concurrency: 1, retry: 'none', fallback: 'none' },
      b2c2b2fStage1: PHASE2C26B2C2B2F_STAGE1, changedStage1Fields: [], changedFromB2C2B2F: ['searchInstrumentation.onGogmaReservedRuntime'], expectedTasks: 1,
      searchInstrumentation: PHASE2C26A7_SEARCH_INSTRUMENTATION, b2c2b2fSearchInstrumentation: PHASE2C26A4_SEARCH_INSTRUMENTATION, cpuProfiler: false, smoke: null })
    expect(verifyPhase2C26B2C2B2GStartAttestation(attestation, expectation)).toEqual({ verified: true, issues: [], integrityIssues: [] })
    const integrity = (patch: Json) => verifyPhase2C26B2C2B2GStartAttestation({ ...attestation, ...patch }, expectation).integrityIssues.length > 0
    for (const patch of [{ repositoryHead: 'f'.repeat(40) }, { benchmarkCodeSha256: '0'.repeat(64) }, { exportSha256: '0'.repeat(64) }, { probeManifestSha256: '0'.repeat(64) },
      { probeManifestB2C2B2FResultSha256: '0'.repeat(64) }, { probeManifestB2C2B2EResultSha256: '0'.repeat(64) }, { targetWeaponIds: [] }, { probes: [{ ...OBS_PROBES[0]!, contextRank: 4 }] },
      { expectedTaskIdentities: [{ ...OBS_IDENTITIES[0]!, searchInputDigest: 'x' }] }, { attestedBy: 'reconstruction' }, { createdAt: '2026-10-05T15:00:01.000Z' }, { extra: 1 }]) expect(integrity(patch)).toBe(true)
    for (const patch of [{ uncommittedBenchmarkCode: true }, { smoke: { budgetMs: 1000 } }, { stage1: { ...PHASE2C26B2C2B2G_STAGE1, budgetMs: 3_600_000 } }, { stage1: { ...PHASE2C26B2C2B2G_STAGE1, childHeapMb: 16_384 } },
      { stage1: { ...PHASE2C26B2C2B2G_STAGE1, concurrency: 2 } }, { stage1: { ...PHASE2C26B2C2B2G_STAGE1, retry: 'once' } }, { cpuProfiler: true },
      { searchInstrumentation: PHASE2C26A4_SEARCH_INSTRUMENTATION }, { searchInstrumentation: { ...PHASE2C26A7_SEARCH_INSTRUMENTATION, onGogmaReservedDepth: true } },
      { b2c2b2fStage1: { ...PHASE2C26B2C2B2D_STAGE1 } }, { innerSections: ['state_generation'] }]) {
      expect(integrity(patch)).toBe(false)
      expect(verifyPhase2C26B2C2B2GStartAttestation({ ...attestation, ...patch }, expectation).verified).toBe(false)
    }
    expect(verifyPhase2C26B2C2B2GStartAttestation(null, expectation).verified).toBe(false)
    expect(Object.keys(phase2c26b2c2b2gRegisteredConditions())).toEqual(expect.arrayContaining(['searchInstrumentation', 'b2c2b2fSearchInstrumentation', 'innerSections', 'cpuProfiler']))
  })
})

// ---------------------------------------------------------------- isolation and provenance

describe('Phase 2-C2.6-B2-C2B2G isolation and provenance', () => {
  it('is never imported by Production, adds no Production seam, and hard-codes no Target, task, rank, extent or digest value of the population', () => {
    const production = import.meta.glob(['../domain/**/*.ts', '../services/**/*.ts', '../workers/**/*.ts', '../pages/**/*.tsx', '../components/**/*.tsx', '../db/**/*.ts', '!../**/*.test.ts', '!../**/*.test.tsx'],
      { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    expect(Object.keys(production).length).toBeGreaterThan(50)
    expect(Object.entries(production).filter(([, source]) => /plannerGlobalPhase2C26B2C2B2G/.test(source)).map(([path]) => path)).toEqual([])
    // The two observers are the existing Production instrumentation fields; no other observer field is introduced.
    const searchApi = Object.entries(production).find(([path]) => path.endsWith('/search/alternative/plannerAlternativeSearch.ts'))![1]
    expect(searchApi).toMatch(/onGogmaReservedRuntime\?: ReservedGogmaRuntimeObserver/)
    expect(searchApi).toMatch(/onSearchRuntime\?: SearchRuntimeObserver/)
    for (const source of [searchSource, targetsSource, analysisSource, prepareSource, runnerSource, analyzerSource]) {
      expect(source).not.toMatch(/fnv1a32[-:][0-9a-f]{8}|[0-9a-f]{8}-[0-9a-f]{4}-|build-list\.|070a1222|a367c177|4a875aac/)
      expect(source).not.toMatch(/\bt0\d-r\d\d\b/)
      expect(source).not.toMatch(/\b(1083|1084)\b/)
    }
    for (const source of [searchSource, targetsSource, analysisSource]) expect(source).not.toMatch(/node:fs|readFile|import\.meta\.glob/)
  })

  it('keeps the oracle, every RESULT, A7 / A8 results and earlier measurements out of the Search side; the Search child never learns an expected outcome, bottleneck or section', () => {
    for (const source of [searchSource, runnerSource]) {
      expect(source).not.toMatch(/ORACLE_[1]657|1657|--oracle|--manifest|--b2c2b2[ef]-result|_RESULT|Targets'|Analysis'|expectedStableKey|expectedCandidateIndex|expectedSection|expectedBottleneck|expectedDominant|peakHeapBytes/)
    }
    expect(searchSource).not.toMatch(/plannerGlobalPhase2C26B2C2B2[A-G]Targets|plannerGlobalPhase2C26B2C2B2[A-G]Analysis|plannerGlobalPhase2C26A[3-9]Analysis|plannerGlobalPhase2C26A8|plannerGlobalPhase2C26A9/)
    expect(runnerSource).toMatch(/--probes/)
    expect(runnerSource).toMatch(/runPhase2C26B2C2B2GTask\(input, schedule, task, engine, \{ yieldControl, instrumentation: profiler\.instrumentation \}\)/)
    expect(runnerSource).not.toMatch(/--cpu-prof|inspector|Session\(/)
    expect(prepareSource).toMatch(/--b2c2b2f-result/)
    expect(prepareSource).not.toMatch(/--oracle|visitPlannerAlternativeCandidates/)
    expect(analyzerSource).not.toMatch(/--oracle|ORACLE_[1]657|PHASE2C26A7_RESULT|PHASE2C26A8_RESULT|PHASE2C26A9_RESULT/)
    for (const source of [analysisSource, analyzerSource, targetsSource, prepareSource]) expect(source).not.toMatch(/visitPlannerAlternativeCandidates|runPhase2C26B2C2B2[DFG]Search\(|runPhase2C26B2C2B2[DFG]Task\(/)
    // The Search side reuses the existing trackers (B2-C2B2F's profiler = A4's tracker, A3's tracker) and attaches exactly the two observers.
    expect(searchSource).toMatch(/createPhase2C26B2C2B2FProfiler\(/)
    expect(searchSource).toMatch(/createPhase2C26A3RuntimeTracker\(/)
    expect(searchSource).not.toMatch(/onSkillReservedDepth:|onGogmaReservedDepth:|onWorkSettled:/)
    expect(searchSource).not.toMatch(/Date\.now/)
  })
})
