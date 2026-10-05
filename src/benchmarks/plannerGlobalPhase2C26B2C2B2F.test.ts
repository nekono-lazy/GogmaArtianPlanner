import { beforeEach, describe, expect, it, vi } from 'vitest'
import rawB2C2B2E from '../../docs/PLANNER_GLOBAL_PHASE2C26B2C2B2E_RESULT.json?raw'
import rawResult from '../../docs/PLANNER_GLOBAL_PHASE2C26B2C2B2F_RESULT.json?raw'
import type { TargetWeapon } from '../domain/models/publicTypes'
import type { PlannerAlternativeSearchExecution } from '../domain/search'
import { SEARCH_RUNTIME_SECTION_PARENT, SEARCH_RUNTIME_SECTIONS, type SearchRuntimeEvent, type SearchRuntimeSection } from '../domain/search/searchRuntime'
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
import { PHASE2C26A4_SEARCH_INSTRUMENTATION, type Phase2C26A4SectionTotals } from './plannerGlobalPhase2C26A4'
import { derivePhase2C26B2C1Schedule } from './plannerGlobalPhase2C26B2C1'
import { runPhase2C26B2C2B2DSearch, runPhase2C26B2C2B2DTask, PHASE2C26B2C2B2D_STAGE1 } from './plannerGlobalPhase2C26B2C2B2D'
import d2Source from './plannerGlobalPhase2C26B2C2B2D.ts?raw'
import { buildPhase2C26B2C2B2ETasks, PHASE2C26B2C2B2E_STAGE1, type Phase2C26B2C2B2EProbe } from './plannerGlobalPhase2C26B2C2B2E'
import {
  buildPhase2C26B2C2B2FTasks,
  createPhase2C26B2C2B2FProfiler,
  parsePhase2C26B2C2B2FProbeManifest,
  phase2c26b2c2b2fChildSearchIdentity,
  phase2c26b2c2b2fRegisteredConditions,
  phase2c26b2c2b2fStartAttestationBody,
  phase2c26b2c2b2fTaskIdentity,
  phase2c26b2c2b2fTaskOutcome,
  runPhase2C26B2C2B2FSearch,
  runPhase2C26B2C2B2FTask,
  verifyPhase2C26B2C2B2FStartAttestation,
  PHASE2C26B2C2B2F_BUDGET_MS,
  PHASE2C26B2C2B2F_CHANGED_STAGE1_FIELDS,
  PHASE2C26B2C2B2F_CHILD_HEAP_MB,
  PHASE2C26B2C2B2F_CPU_PROFILER,
  PHASE2C26B2C2B2F_EXPECTED_TASKS,
  PHASE2C26B2C2B2F_NOT_RUN,
  PHASE2C26B2C2B2F_PROVENANCE_FLAGS,
  PHASE2C26B2C2B2F_SEARCH_INSTRUMENTATION,
  PHASE2C26B2C2B2F_STAGE1,
  PHASE2C26B2C2B2F_START_ATTESTATION_PHASE,
  PHASE2C26B2C2B2F_WINDOWS_MS,
  type Phase2C26B2C2B2FAttestationExpectation,
  type Phase2C26B2C2B2FProfileSnapshot,
  type Phase2C26B2C2B2FTaskIdentity,
} from './plannerGlobalPhase2C26B2C2B2F'
import searchSource from './plannerGlobalPhase2C26B2C2B2F.ts?raw'
import {
  parsePhase2C26B2C2B2FB2C2B2EAuthority,
  phase2c26b2c2b2fPopulation,
  phase2c26b2c2b2fProbeManifest,
  PHASE2C26B2C2B2F_REGISTERED_B2C2B2E,
} from './plannerGlobalPhase2C26B2C2B2FTargets'
import targetsSource from './plannerGlobalPhase2C26B2C2B2FTargets.ts?raw'
import {
  phase2c26b2c2b2fCategories,
  phase2c26b2c2b2fConditionIssues,
  phase2c26b2c2b2fDecision,
  phase2c26b2c2b2fSelectSnapshot,
  phase2c26b2c2b2fWindows,
  PHASE2C26B2C2B2F_CATEGORIES,
  PHASE2C26B2C2B2F_COVERAGE_THRESHOLD,
  PHASE2C26B2C2B2F_DOMINANT_THRESHOLD,
  PHASE2C26B2C2B2F_MIN_SEARCH_WALL_MS,
  PHASE2C26B2C2B2F_SECONDARY_THRESHOLD,
  PHASE2C26B2C2B2F_SECTION_CATEGORY,
  type Phase2C26B2C2B2FCategoryBreakdown,
} from './plannerGlobalPhase2C26B2C2B2FAnalysis'
import analysisSource from './plannerGlobalPhase2C26B2C2B2FAnalysis.ts?raw'
import prepareSource from '../../scripts/prepare-planner-global-phase2c26b2c2b2f-probes.mjs?raw'
import runnerSource from '../../scripts/run-planner-global-phase2c26b2c2b2f.mjs?raw'
import analyzerSource from '../../scripts/analyze-planner-global-phase2c26b2c2b2f.mjs?raw'

/*
 * Issue #154 Phase 2-C2.6-B2-C2B2F: outer runtime profiling of the one B2-C2B2E time-bound timeout Target in B2-C2B2E's exact Search
 * input. The synthetic worlds below are invented for the tests; the committed B2-C2B2E RESULT is read only to check the authority
 * and the population derivation. No oracle module is imported here.
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
const eJson = JSON.parse(rawB2C2B2E)
const eWith = (patch: (j: Json & { nextBranch: Json & { perTarget: Json[] }; targets: Json[]; taskRows: Json[]; probes: Json[] }) => void) => {
  const copy = structuredClone(eJson)
  patch(copy)
  return parsePhase2C26B2C2B2FB2C2B2EAuthority(copy, PHASE2C26B2C2B2F_REGISTERED_B2C2B2E.resultSha256)
}
const SLOW = 120_000

// ---------------------------------------------------------------- population and probe manifest

describe('Phase 2-C2.6-B2-C2B2F population, probe and manifest', () => {
  it('reads the committed B2-C2B2E RESULT as the registered formal authority, failing closed on another SHA-256, case, branch, Stage 1 or hash chain', async () => {
    expect(await sha256(rawB2C2B2E)).toBe(PHASE2C26B2C2B2F_REGISTERED_B2C2B2E.resultSha256)
    const parsed = parsePhase2C26B2C2B2FB2C2B2EAuthority(eJson, PHASE2C26B2C2B2F_REGISTERED_B2C2B2E.resultSha256)
    expect(parsed.issues).toEqual([])
    expect(parsed.authority).toMatchObject({ decisionCase: 'B2C2B2E_INCOMPLETE', evidenceGrade: 'formal', measuredHead: PHASE2C26B2C2B2F_REGISTERED_B2C2B2E.measuredHead, nextBranch: { branch: 'C' },
      stage1: PHASE2C26B2C2B2E_STAGE1, hashChainAllTrue: true })
    expect(parsePhase2C26B2C2B2FB2C2B2EAuthority(eJson, '0'.repeat(64)).valid).toBe(false)
    expect(eWith(j => { (j.decision as Json).case = 'B2C2B2E_ALL_C4C' }).valid).toBe(false)
    expect(eWith(j => { j.nextBranch.branch = 'D' }).valid).toBe(false)
    expect(eWith(j => { j.nextBranch.typesUnambiguous = false }).valid).toBe(false)
    expect(eWith(j => { (j.conditions as Json).stage1 = { ...PHASE2C26B2C2B2E_STAGE1, budgetMs: 600_000 } }).valid).toBe(false)
    expect(eWith(j => { ((j.parity as Json).hashChain as Json).exportMatchesRunner = false }).valid).toBe(false)
    expect(eWith(j => { (j.provenance as Json).formal = false }).valid).toBe(false)
    expect(eWith(j => { j.invalidReasons = ['x'] }).valid).toBe(false)
    expect(eWith(j => { j.taskRows = j.taskRows.slice(1) }).valid).toBe(false)
  })

  it('derives the population mechanically: the branch-C next-branch row of type time_bound with result timeout (exactly 1), never a hard-coded Target', () => {
    const { authority } = parsePhase2C26B2C2B2FB2C2B2EAuthority(eJson, PHASE2C26B2C2B2F_REGISTERED_B2C2B2E.resultSha256)
    const derived = phase2c26b2c2b2fPopulation(authority)
    expect(derived.issues).toEqual([])
    const expected = (eJson.nextBranch.perTarget as Json[]).filter(t => t.type === 'time_bound' && t.result === 'timeout')
    expect(derived.targetWeaponIds).toEqual(expected.map(t => t.targetWeaponId))
    expect(derived.targetWeaponIds).toHaveLength(PHASE2C26B2C2B2F_EXPECTED_TASKS)
    expect(derived.others).toEqual((eJson.nextBranch.perTarget as Json[]).filter(t => t.type !== 'time_bound').map(t => ({ targetWeaponId: t.targetWeaponId, type: t.type, result: t.result })))
    // The probe is the B2-C2B2E task row's Target / task / rank / tight extent; the identity its Search input identity.
    const row = (eJson.taskRows as Json[]).find(t => t.taskId === expected[0]!.taskId)!
    const target = (eJson.targets as Json[]).find(t => t.taskId === expected[0]!.taskId)!
    expect(derived.probes).toEqual([{ targetWeaponId: row.targetWeaponId, b2c2b2dTaskId: row.taskId, contextRank: row.contextRank, extent: row.extent }])
    expect(derived.probes[0]!.contextRank).toBe(target.selectedRank)
    expect(derived.probes[0]!.extent).toEqual((target.extents as Json).tight)
    for (const field of ['taskId', 'targetWeaponId', 'contextRank', 'groupIndex', 'reservationDigest', 'targetEligibleMinCardinality', 'representativeFixedSetId', 'representativeFixedTargetWeaponIds',
      'defaultSearchInputDigest', 'searchInputDigest', 'extent'] as const) expect(derived.expectedTaskIdentities[0]![field]).toEqual(row[field])
    expect(derived.b2c2b2e[0]!.rederivedExcludedRouteKeySha256).toBe(((target.paired as Json).identity as Json & { excludedRouteKeyComparison: Json }).excludedRouteKeyComparison.rederivedExcludedRouteKeySha256)
    // Fail closed: no / two time-bound timeouts, a row disagreeing, a task row with a record, a drifted extent or attested probe.
    const at = (patch: Parameters<typeof eWith>[0]) => phase2c26b2c2b2fPopulation(eWith(patch).authority)
    const id = expected[0]!.targetWeaponId
    expect(at(j => { j.nextBranch.perTarget = j.nextBranch.perTarget.map(t => ({ ...t, result: 'recovered' })) }).issues.join()).toMatch(/0 next-branch rows/)
    expect(at(j => { j.nextBranch.perTarget = j.nextBranch.perTarget.map(t => ({ ...t, type: 'time_bound', result: 'timeout' })) }).valid).toBe(false)
    expect(at(j => { j.targets = j.targets.map(t => t.targetWeaponId === id ? { ...t, type: 'heap_growth' } : t) }).issues.join()).toMatch(/Target row type/)
    expect(at(j => { j.taskRows = j.taskRows.map(t => t.targetWeaponId === id ? { ...t, candidateCount: 0 } : t) }).issues.join()).toMatch(/without a record or a Candidate count/)
    expect(at(j => { j.taskRows = j.taskRows.map(t => t.targetWeaponId === id ? { ...t, extent: { ...(t.extent as Json), maxSkillAdvance: 1000 } } : t) }).issues.join()).toMatch(/tight extent/)
    expect(at(j => { j.targets = j.targets.map(t => t.targetWeaponId === id ? { ...t, paired: { ...(t.paired as Json), identity: { matches: false } } } : t) }).issues.join()).toMatch(/not verified/)
    expect(at(j => {
      const att = ((j.provenance as Json).startAttestation as Json).body as Json
      att.probes = (att.probes as Json[]).map(p => p.targetWeaponId === id ? { ...p, contextRank: 12 } : p)
    }).issues.join()).toMatch(/start-attested probe/)
    expect(phase2c26b2c2b2fPopulation(null)).toMatchObject({ valid: false, targetWeaponIds: [] })
  })

  it('writes the probe and its expected Search input identity only (no expected key / index / cost / outcome / bottleneck / measurement), exactly what the runner accepts', () => {
    const { authority } = parsePhase2C26B2C2B2FB2C2B2EAuthority(eJson, PHASE2C26B2C2B2F_REGISTERED_B2C2B2E.resultSha256)
    const manifest = phase2c26b2c2b2fProbeManifest(authority!)
    expect(Object.keys(manifest).sort()).toEqual(['b2c2b2eResultSha256', 'contextSelection', 'expectedTaskIdentities', 'exportSha256', 'extentRule', 'phase', 'policy', 'population', 'probes'])
    expect(manifest).toMatchObject({ b2c2b2eResultSha256: PHASE2C26B2C2B2F_REGISTERED_B2C2B2E.resultSha256, population: 'B2C2B2E_BRANCH_C_TIME_BOUND_TIMEOUT', exportSha256: eJson.provenance.exportSha256 })
    expect(JSON.stringify(manifest.probes) + JSON.stringify(manifest.expectedTaskIdentities)).not.toMatch(/stableKey|candidateIndex|operationCost|exact|coverage|oracle|required|route|timeout|memory|heap|yield|wall|bottleneck|section|dominant/i)
    expect(parsePhase2C26B2C2B2FProbeManifest(structuredClone(manifest))).toMatchObject({ valid: true, issues: [] })
    const bad = (patch: (m: Json & typeof manifest) => void) => { const copy = structuredClone(manifest) as Json & typeof manifest; patch(copy); return parsePhase2C26B2C2B2FProbeManifest(copy).valid }
    expect(bad(m => { m.probes = [...m.probes, m.probes[0]!] })).toBe(false)
    expect(bad(m => { m.probes = [] })).toBe(false)
    expect(bad(m => { m.expectedTaskIdentities[0]!.contextRank += 1 })).toBe(false)
    expect(bad(m => { m.expectedTaskIdentities[0]!.taskId = 't09-r01' })).toBe(false)
    expect(bad(m => { m.probes[0]!.b2c2b2dTaskId = 't00-r99' })).toBe(false)
    expect(bad(m => { m.probes[0]!.extent = { maxNormalAdvance: 128, maxGogmaAdvance: 235, maxSkillAdvance: 1500 } })).toBe(false)
    expect(bad(m => { (m as Json).population = 'E1_L2' })).toBe(false)
    for (const field of ['expectedStableKey', 'expectedCandidateIndex', 'expectedSection', 'oracleRoute', 'b2c2b2eHeap']) {
      expect(bad(m => { (m.probes[0] as unknown as Json)[field] = 1 })).toBe(false)
      expect(bad(m => { (m.expectedTaskIdentities[0] as unknown as Json)[field] = 1 })).toBe(false)
      expect(bad(m => { m[field] = {} })).toBe(false)
    }
  })
})

// ---------------------------------------------------------------- registered conditions

describe('Phase 2-C2.6-B2-C2B2F registered conditions', () => {
  it('registers 1 task, B2-C2B2E\'s Stage 1 with only the budget shortened to 30 minutes, onSearchRuntime as the only instrumentation and no CPU profiler', () => {
    expect(PHASE2C26B2C2B2F_EXPECTED_TASKS).toBe(1)
    expect(PHASE2C26B2C2B2F_STAGE1).toEqual({ executionClass: 'stage1', childHeapMb: 12_288, concurrency: 1, budgetMs: 1_800_000, retry: 'none', fallback: 'none' })
    expect([PHASE2C26B2C2B2F_BUDGET_MS, PHASE2C26B2C2B2F_CHILD_HEAP_MB]).toEqual([1_800_000, 12_288])
    const changed = Object.keys(PHASE2C26B2C2B2F_STAGE1).filter(k => PHASE2C26B2C2B2F_STAGE1[k as keyof typeof PHASE2C26B2C2B2F_STAGE1] !== PHASE2C26B2C2B2E_STAGE1[k as keyof typeof PHASE2C26B2C2B2E_STAGE1])
    expect(changed).toEqual([...PHASE2C26B2C2B2F_CHANGED_STAGE1_FIELDS])
    expect(PHASE2C26B2C2B2F_CHANGED_STAGE1_FIELDS).toEqual(['budgetMs'])
    expect(PHASE2C26B2C2B2F_SEARCH_INSTRUMENTATION).toBe(PHASE2C26A4_SEARCH_INSTRUMENTATION)
    expect(PHASE2C26B2C2B2F_SEARCH_INSTRUMENTATION).toEqual({ onSearchRuntime: true, onGogmaReservedRuntime: false, onGogmaReservedDepth: false, onSkillReservedDepth: false, onWorkSettled: false })
    expect(PHASE2C26B2C2B2F_CPU_PROFILER).toBe(false)
    expect(PHASE2C26B2C2B2F_WINDOWS_MS).toEqual([[0, 600_000], [600_000, 1_200_000], [1_200_000, 1_800_000]])
    expect(PHASE2C26B2C2B2F_PROVENANCE_FLAGS).toMatchObject({ oracleReadBySearchChild: false, expectedOutcomeKnownBySearchChild: false, productionSchedulerEvidence: false, routeExactJudged: false, profilingOnly: true })
    for (const notRun of ['heap_16gb_retry', 'budget_60min_or_more', 'automatic_longer_retry', 'retry', 'v8_cpu_profiler', 'production_optimization', 'search_semantics_change', 'extent_change',
      'context_change', 'p1_change', 'e2_search', 'k2_feature_grouping', 'global_assignment', 'full_planner_rerun', 'ui_change', 'a3_a9_result_regeneration']) expect(PHASE2C26B2C2B2F_NOT_RUN).toContain(notRun)
    expect(phase2c26b2c2b2fConditionIssues({ smoke: false, runs: [{ taskId: 't', process: { budgetMs: 1_800_000, nodeFlags: ['--max-old-space-size=12288'] } }] })).toEqual([])
    expect(phase2c26b2c2b2fConditionIssues({ smoke: false, runs: [{ taskId: 't', process: { budgetMs: 3_600_000, nodeFlags: ['--max-old-space-size=12288'] } }] }).join()).toMatch(/budget/)
    expect(phase2c26b2c2b2fConditionIssues({ smoke: false, runs: [{ taskId: 't', process: { budgetMs: 1_800_000, nodeFlags: ['--max-old-space-size=16384'] } }] }).join()).toMatch(/heap/)
    expect(phase2c26b2c2b2fConditionIssues({ smoke: false, runs: [{ taskId: 't', process: { budgetMs: 1_800_000, nodeFlags: ['--max-old-space-size=12288', '--cpu-prof'] } }] }).join()).toMatch(/CPU profiler/)
    expect(phase2c26b2c2b2fConditionIssues({ smoke: false, runs: [{ taskId: 't', process: { budgetMs: 1_800_000 } }, { taskId: 't', process: { budgetMs: 1_800_000 } }] }).join()).toMatch(/no retry/)
  })
})

// ---------------------------------------------------------------- a synthetic world (B2-C2B2E's shape)

const SOURCE_A_SKILL = 'series_skill.fixture.z'
const SOURCE_B_SKILL = 'series_skill.fixture.b-source'
const L2 = { maxNormalAdvance: 128, maxGogmaAdvance: 235, maxSkillAdvance: 1500 }
const TIGHT = { maxNormalAdvance: 4, maxGogmaAdvance: 235, maxSkillAdvance: 64 }

function world() {
  const skill = { seriesSkillId: SOURCE_A_SKILL, groupSkillId: null, matchMode: 'all' as const }
  const a: TargetWeapon = orchestrationTarget('target.b2c2b2f.a', { priority: 5, idealSkillCondition: skill, practicalSkillCondition: skill })
  const b = skillConstrainedTarget('target.b2c2b2f.b', { priority: 1 })
  const built = orchestrationScenario({
    engine: { gogmaPositions: L2.maxGogmaAdvance + 8, skillPositions: L2.maxSkillAdvance + 8 },
    targets: [a, b],
    ownedWeapons: [orchestrationSource(ORCHESTRATION_SOURCE_A, { seriesSkillId: SOURCE_A_SKILL }),
      orchestrationSource(ORCHESTRATION_SOURCE_B, { restorationBonuses: belowPracticalBonuses(), seriesSkillId: SOURCE_B_SKILL })],
    entries: [
      orchestrationEntry('build-list.b2c2b2f.a', a, resetRoute(ORCHESTRATION_SOURCE_A), { finalBonuses: idealBonuses(), seriesSkillId: SOURCE_A_SKILL }),
      orchestrationEntry('build-list.b2c2b2f.b', b, { kind: 'existing_gogma_mixed', sourceOwnedWeaponId: resetRoute(ORCHESTRATION_SOURCE_B).sourceOwnedWeaponId,
        operations: [...resetRoute(ORCHESTRATION_SOURCE_B).operations, ...resetSkillsRoute(ORCHESTRATION_SOURCE_B).operations] }),
    ],
  })
  const schedule = derivePhase2C26B2C1Schedule(built.input, globalResearchDependencies(built.engine))
  return { built, schedule }
}
/** One probe named by a B2-C2B2E task ID that is NOT this phase's probe index (t02 of a 2-probe B2-C2B2E). */
const PROBE: Phase2C26B2C2B2EProbe = { targetWeaponId: 'target.b2c2b2f.b', b2c2b2dTaskId: 't02-r02', contextRank: 2, extent: { ...TIGHT } }
function manifestFor(schedule: ReturnType<typeof world>['schedule']) {
  const built = buildPhase2C26B2C2B2ETasks(schedule, [PROBE])
  if (!built.valid) throw new Error(built.issues.join())
  return { probes: [PROBE], expectedTaskIdentities: [phase2c26b2c2b2fTaskIdentity(built.tasks[0]!)] }
}

describe('Phase 2-C2.6-B2-C2B2F task construction and child calculation', () => {
  it('builds the task with B2-C2B2E\'s construction and gates every Search input identity field against the expected B2-C2B2E identity', () => {
    const { schedule } = world()
    const manifest = manifestFor(schedule)
    const ours = buildPhase2C26B2C2B2FTasks(schedule, manifest)
    expect(ours.issues).toEqual([])
    expect(ours.tasks).toEqual(buildPhase2C26B2C2B2ETasks(schedule, [PROBE]).tasks)
    expect(ours.tasks.map(t => t.taskId)).toEqual(['t02-r02'])
    for (const field of ['groupIndex', 'reservationDigest', 'defaultSearchInputDigest', 'searchInputDigest', 'representativeFixedSetId', 'targetEligibleMinCardinality'] as const) {
      const drift = structuredClone(manifest) as unknown as { probes: Phase2C26B2C2B2EProbe[]; expectedTaskIdentities: Json[] }
      drift.expectedTaskIdentities[0]![field] = typeof drift.expectedTaskIdentities[0]![field] === 'number' ? 99 : 'other'
      const built = buildPhase2C26B2C2B2FTasks(schedule, drift as unknown as Parameters<typeof buildPhase2C26B2C2B2FTasks>[1])
      expect(built.issues.join(), field).toMatch(new RegExp(`${field} is not the B2-C2B2E task's`))
      expect(built.tasks).toEqual([])
    }
    expect(buildPhase2C26B2C2B2FTasks(schedule, { ...manifest, expectedTaskIdentities: [] }).issues.join()).toMatch(/no expected task identity/)
  })

  it('is B2-C2B2D\'s Search body and task body line for line, except the instrumentation hand-over and the options type', () => {
    const body = (source: string, name: string) => {
      const start = source.indexOf(`export async function ${name}(`)
      const end = source.indexOf('\n}\n', start)
      if (start < 0 || end < 0) throw new Error(`no ${name}`)
      return source.slice(start, end)
    }
    const normalize = (text: string) => text
      .replace(/options\.instrumentation === undefined \? \{ yieldControl: options\.yieldControl \} : \{ yieldControl: options\.yieldControl, instrumentation: \{ onSearchRuntime: options\.instrumentation\.onSearchRuntime \} \}/, '{ yieldControl: options.yieldControl }')
      .replace(/options: Phase2C26B2C2B2FSearchOptions = \{\}/, 'options: { yieldControl?: () => Promise<void>; now?: () => number } = {}')
      .replace(/B2C2B2[DF]/g, 'X').replace(/Phase2C26B2C2B2[DF]/g, 'PhaseX')
    expect(normalize(body(searchSource, 'runPhase2C26B2C2B2FSearch'))).toBe(normalize(body(d2Source, 'runPhase2C26B2C2B2DSearch')))
    expect(normalize(body(searchSource, 'runPhase2C26B2C2B2FTask'))).toBe(normalize(body(d2Source, 'runPhase2C26B2C2B2DTask')))
    expect(searchSource).toMatch(/instrumentation: \{ onSearchRuntime: options\.instrumentation\.onSearchRuntime \}/)
  })

  it('changes no Search semantics: with the profiler the record (Candidates, order, summary, stops, exclusion) equals B2-C2B2D\'s uninstrumented Search', async () => {
    const { built, schedule } = world()
    const task = buildPhase2C26B2C2B2FTasks(schedule, manifestFor(schedule)).tasks[0]!
    const plain = await runPhase2C26B2C2B2DTask(built.input, schedule, task, built.engine, { now: () => 0 })
    let clock = 0
    const profiler = createPhase2C26B2C2B2FProfiler({ now: () => (clock += 1) })
    profiler.start()
    let yields = 0
    const profiled = await runPhase2C26B2C2B2FTask(built.input, schedule, task, built.engine, { now: () => 0, instrumentation: profiler.instrumentation,
      yieldControl: profiler.wrapYield(() => { yields += 1; return Promise.resolve() }) })
    const unprofiled = await runPhase2C26B2C2B2FTask(built.input, schedule, task, built.engine, { now: () => 0 })
    if (plain.status !== 'searched' || profiled.status !== 'searched') throw new Error('not searched')
    expect(plain.search.candidates.length).toBeGreaterThan(0)
    expect(profiled).toEqual(plain)
    expect(unprofiled).toEqual(plain)
    expect(profiled.search.candidates.map(c => c.stableKey)).toEqual(plain.search.candidates.map(c => c.stableKey))
    expect([profiled.search.summary, profiled.search.termination, profiled.search.excludedRouteKeys]).toEqual([plain.search.summary, plain.search.termination, plain.search.excludedRouteKeys])
    // The only instrumentation handed to the Search is onSearchRuntime; without the profiler none at all (B2-C2B2D's options).
    expect(searchCalls.options).toEqual([{ keys: ['yieldControl'], instrumentationKeys: null }, { keys: ['instrumentation', 'yieldControl'], instrumentationKeys: ['onSearchRuntime'] },
      { keys: ['yieldControl'], instrumentationKeys: null }])
    const snapshot = profiler.snapshot('final')
    expect(snapshot.runtime.contractViolations).toBe(0)
    expect(snapshot.runtime.activeStack).toEqual([])
    expect(snapshot.searchCompletedAtMs).not.toBeNull()
    const categories = phase2c26b2c2b2fCategories(snapshot.runtime.observed[0]!)
    expect(categories.partition.matches).toBe(true)
    expect(categories.searchWallMs).toBeGreaterThan(0)
    expect(snapshot.yields.count).toBe(yields)
    expect(snapshot.runtime.byTarget[0]!.sectionCounts.delivery_consumer).toBe(plain.search.summary.deliveredCandidates)
  }, SLOW)

  it('attests the Search identity the child rebuilt before searching (digests, extent, the one excluded current Route, hashed) and keeps the outcome rule', async () => {
    const { built, schedule } = world()
    const task = buildPhase2C26B2C2B2FTasks(schedule, manifestFor(schedule)).tasks[0]!
    const identity = phase2c26b2c2b2fChildSearchIdentity(schedule, task, key => `h:${key}`)
    expect(identity).toMatchObject({ valid: true, taskId: 't02-r02', searchInputDigest: task.searchInputDigest, defaultSearchInputDigest: task.defaultSearchInputDigest, extent: TIGHT,
      excludedRouteKeyCount: 1, excludedRouteIsCurrentRoute: true })
    const searched = await runPhase2C26B2C2B2DTask(built.input, schedule, task, built.engine, { now: () => 0 })
    if (searched.status !== 'searched') throw new Error('not searched')
    expect(identity.valid && identity.excludedRouteKeySha256s).toEqual(searched.search.excludedRouteKeys.map(k => `h:${k}`))
    expect(phase2c26b2c2b2fChildSearchIdentity(schedule, { ...task, contextRank: 31 }, k => k).valid).toBe(false)
    expect(phase2c26b2c2b2fTaskOutcome('t', 'timeout', null)).toEqual({ taskId: 't', process: 'timeout', record: null, searchStatus: null, termination: null, candidateCount: null })
    expect(phase2c26b2c2b2fTaskOutcome('t', 'completed', null).process).toBe('process_failure')
  }, SLOW)
})

// ---------------------------------------------------------------- the profiler

const s = (section: SearchRuntimeSection, extra: object = {}): SearchRuntimeEvent => ({ type: 'section_started', section, ...extra }) as SearchRuntimeEvent
const c = (section: SearchRuntimeSection, extra: object = {}): SearchRuntimeEvent => ({ type: 'section_completed', section, ...extra }) as SearchRuntimeEvent
const COUNTS = { rawSolutions: 100, unsupportedPredictions: 0, idealSolutions: 2, evaluatedSolutions: 2, subscriberCount: 3, retainedCountAfter: 7, exhausted: false }

describe('Phase 2-C2.6-B2-C2B2F profiler', () => {
  function drive(sequence: Array<[number, SearchRuntimeEvent]>) {
    let clock = 0
    const profiler = createPhase2C26B2C2B2FProfiler({ now: () => clock })
    profiler.start()
    for (const [at, event] of sequence) { clock = at; profiler.observer(event) }
    return { profiler, setClock: (at: number) => { clock = at } }
  }

  it('reconciles inclusive / exclusive time without double counting and keeps the open stack at a kill (timeout)', () => {
    const { profiler, setClock } = drive([
      [0, s('search_runtime')], [1, s('search_setup')], [2, c('search_setup')], [2, s('route_registration')], [2, s('existing_gogma_route_registration')],
      [4, c('existing_gogma_route_registration')], [4, c('route_registration')],
      [4, s('scheduler_step')], [4, s('scheduler_checkpoint')], [5, c('scheduler_checkpoint')], [5, s('scheduler_settle')],
      [5, s('skill_depth_work', { work: { channel: 0, depth: 1 } })], [6, s('skill_depth_read')], [30, c('skill_depth_read')], [30, s('skill_channel_publication')],
      [31, s('cross_add_skill')], [33, c('cross_add_skill')], [34, c('skill_channel_publication')], [35, c('skill_depth_work', { counts: COUNTS })],
      [35, c('scheduler_settle')], [36, s('scheduler_post_settle')], [37, c('scheduler_post_settle')], [37, c('scheduler_step')],
      [37, s('scheduler_step')], [37, s('scheduler_checkpoint')], [38, c('scheduler_checkpoint')], [38, s('scheduler_settle')],
      [38, s('bonus_depth_work', { work: { channel: 2, depth: 5 } })], [40, s('bonus_depth_read')],
    ])
    setClock(100)
    const snap = profiler.snapshot('heartbeat')
    expect(snap.runtime.contractViolations).toBe(0)
    expect(snap.runtime.activeStack.map(f => f.section)).toEqual(['search_runtime', 'scheduler_step', 'scheduler_settle', 'bonus_depth_work', 'bonus_depth_read'])
    const observed = snap.runtime.observed[0]!
    expect(observed.inclusiveMs.search_runtime).toBe(100)
    expect(observed.inclusiveMs.skill_depth_work).toBe(30)
    expect(observed.exclusiveMs.skill_depth_work).toBe(30 - 24 - 4)
    expect(observed.exclusiveMs.skill_channel_publication).toBe(4 - 2)
    expect(observed.inclusiveMs.bonus_depth_read).toBe(60)
    expect(observed.inclusiveMs.bonus_depth_work).toBe(62)
    const categories = phase2c26b2c2b2fCategories(observed)
    expect(categories.partition.matches).toBe(true)
    expect(categories.ms).toEqual({ BONUS: 62, SKILL: 30, COMPOSITION: 0, SCHEDULER_OVERHEAD: (37 - 4) + (100 - 37) - 62 - 30, DELIVERY: 0, REGISTRATION_SETUP: 1 + 2, UNACCOUNTED: 100 - 96 - 3 })
    expect(Object.values(categories.ms).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 9)
    expect(categories.coverage).toBeCloseTo(0.99, 9)
    expect(snap.depth.skill).toMatchObject({ startedWorks: 1, completedWorks: 1, withCounts: 1, channels: 1, maxDepth: 1, subscriberCountSum: 3, retainedCountAfterSum: 7, lastRetainedCountAfter: 7 })
    expect(snap.depth.bonus).toMatchObject({ startedWorks: 1, completedWorks: 0, channels: 1, maxDepth: 5 })
    expect(snap.searchElapsedMs).toBe(100)
    expect(snap.searchCompletedAtMs).toBeNull()
  })

  it('counts a broken nesting as a contract violation (never throws into the Search) and attributes each yield wait to the innermost open section', async () => {
    const { profiler } = drive([[0, s('search_runtime')], [1, s('bonus_depth_read')], [2, c('scheduler_step')]])
    expect(profiler.snapshot('heartbeat').runtime.contractViolations).toBeGreaterThan(0)
    let clock = 0
    const p = createPhase2C26B2C2B2FProfiler({ now: () => clock })
    p.start()
    const wrapped = p.wrapYield(async () => { clock += 5 })
    await wrapped()
    p.observer(s('search_runtime')); p.observer(s('scheduler_step')); p.observer(s('scheduler_checkpoint'))
    await wrapped(); await wrapped()
    const snap = p.snapshot('heartbeat')
    expect(snap.yields).toEqual({ count: 3, totalMs: 15, bySection: { outside_search: { count: 1, totalMs: 5 }, scheduler_checkpoint: { count: 2, totalMs: 10 } } })
  })
})

// ---------------------------------------------------------------- categories, coverage, decision, windows

const zeroTotals = (): Phase2C26A4SectionTotals => Object.fromEntries(SEARCH_RUNTIME_SECTIONS.map(x => [x, 0])) as Phase2C26A4SectionTotals
/** A strictly nested synthetic observation: each section's exclusive time given, inclusive derived from the hierarchy. */
function observation(exclusive: Partial<Record<SearchRuntimeSection, number>>) {
  const exclusiveMs = { ...zeroTotals(), ...exclusive }
  const inclusiveMs = zeroTotals()
  for (const section of [...SEARCH_RUNTIME_SECTIONS].reverse()) {
    inclusiveMs[section] += exclusiveMs[section]
    const parent = SEARCH_RUNTIME_SECTION_PARENT[section]
    if (parent !== null) inclusiveMs[parent] += inclusiveMs[section]
  }
  return { inclusiveMs, exclusiveMs }
}
const breakdown = (shares: Partial<Record<'bonus' | 'skill' | 'composition' | 'scheduler' | 'delivery' | 'unaccounted', number>>, wall = 1_000_000) => phase2c26b2c2b2fCategories(observation({
  bonus_depth_read: (shares.bonus ?? 0) * wall, skill_depth_read: (shares.skill ?? 0) * wall, compose_route: (shares.composition ?? 0) * wall, scheduler_checkpoint: (shares.scheduler ?? 0) * wall,
  delivery_sort: (shares.delivery ?? 0) * wall, search_runtime: (shares.unaccounted ?? 0) * wall }))

describe('Phase 2-C2.6-B2-C2B2F categories and decision', () => {
  it('partitions the Search wall along the hierarchy: every section exclusive time falls in exactly one category and nothing is counted twice', () => {
    expect(Object.keys(PHASE2C26B2C2B2F_SECTION_CATEGORY).sort()).toEqual([...SEARCH_RUNTIME_SECTIONS].sort())
    const exclusive = Object.fromEntries(SEARCH_RUNTIME_SECTIONS.map((x, i) => [x, i + 1])) as Record<SearchRuntimeSection, number>
    const result = phase2c26b2c2b2fCategories(observation(exclusive))
    expect(result.partition.matches).toBe(true)
    expect(result.searchWallMs).toBe(SEARCH_RUNTIME_SECTIONS.reduce((sum, _x, i) => sum + i + 1, 0))
    for (const category of PHASE2C26B2C2B2F_CATEGORIES) {
      const expected = SEARCH_RUNTIME_SECTIONS.filter(x => PHASE2C26B2C2B2F_SECTION_CATEGORY[x] === category).reduce((sum, x) => sum + exclusive[x], 0)
      expect(result.ms[category], category).toBeCloseTo(expected, 9)
    }
    // cross_add_bonus counts in BONUS once (under bonus_channel_publication), cross_wake in COMPOSITION, the scheduler parts in SCHEDULER_OVERHEAD.
    expect(result.scheduler).toEqual({ stepExclusiveMs: exclusive.scheduler_step, checkpointMs: exclusive.scheduler_checkpoint, settleExclusiveMs: exclusive.scheduler_settle, postSettleMs: exclusive.scheduler_post_settle })
    expect(result.coverage).toBeCloseTo(1 - exclusive.search_runtime / result.searchWallMs, 12)
    // A broken observation (a child longer than its parent) is not a partition.
    const broken = observation({ bonus_depth_read: 10 }); broken.inclusiveMs.bonus_depth_work = 5
    expect(phase2c26b2c2b2fCategories(broken).partition.matches).toBe(false)
  })

  it('applies the registered decision rule at its boundaries (coverage 0.90, dominant 0.50, secondary 0.20, minimum Search wall)', () => {
    expect([PHASE2C26B2C2B2F_COVERAGE_THRESHOLD, PHASE2C26B2C2B2F_DOMINANT_THRESHOLD, PHASE2C26B2C2B2F_SECONDARY_THRESHOLD, PHASE2C26B2C2B2F_MIN_SEARCH_WALL_MS]).toEqual([0.9, 0.5, 0.2, 60_000])
    const decide = (b: Phase2C26B2C2B2FCategoryBreakdown | null, invalidReasons: string[] = [], insufficientReasons: string[] = []) => phase2c26b2c2b2fDecision({ invalidReasons, insufficientReasons, categories: b })
    expect(decide(breakdown({ skill: 0.5, bonus: 0.3, scheduler: 0.2 }))).toMatchObject({ case: 'B2C2B2F_SKILL_DOMINANT', dominant: 'SKILL', secondary: ['BONUS', 'SCHEDULER_OVERHEAD'] })
    expect(decide(breakdown({ skill: 0.49, bonus: 0.31, scheduler: 0.2 }))).toMatchObject({ case: 'B2C2B2F_MIXED', dominant: null, secondary: ['SKILL', 'BONUS', 'SCHEDULER_OVERHEAD'], nextPhaseCategories: ['SKILL', 'BONUS'] })
    expect(decide(breakdown({ bonus: 0.81, skill: 0.19 }))).toMatchObject({ case: 'B2C2B2F_BONUS_DOMINANT', secondary: [] })
    expect(decide(breakdown({ composition: 0.6, bonus: 0.4 })).case).toBe('B2C2B2F_COMPOSITION_DOMINANT')
    expect(decide(breakdown({ scheduler: 0.95, bonus: 0.05 })).case).toBe('B2C2B2F_SCHEDULER_DOMINANT')
    expect(decide(breakdown({ delivery: 0.7, bonus: 0.3 })).case).toBe('B2C2B2F_DELIVERY_DOMINANT')
    expect(decide(breakdown({ bonus: 0.9, unaccounted: 0.1 })).case).toBe('B2C2B2F_BONUS_DOMINANT')
    expect(decide(breakdown({ bonus: 0.89, unaccounted: 0.11 }))).toMatchObject({ case: 'B2C2B2F_INSUFFICIENT', reasons: [expect.stringMatching(/coverage/)] })
    expect(decide(breakdown({ bonus: 1 }, 59_999))).toMatchObject({ case: 'B2C2B2F_INSUFFICIENT', reasons: [expect.stringMatching(/Search wall/)] })
    expect(decide(breakdown({ bonus: 1 }, 60_000)).case).toBe('B2C2B2F_BONUS_DOMINANT')
    expect(decide(null).case).toBe('B2C2B2F_INSUFFICIENT')
    expect(decide(breakdown({ bonus: 1 }), [], ['no profile snapshot']).case).toBe('B2C2B2F_INSUFFICIENT')
    expect(decide(breakdown({ bonus: 1 }), ['x']).case).toBe('B2C2B2F_INVALID')
  })

  it('reads the durable snapshots in order and computes descriptive windows as snapshot differences (the last one partial at a kill)', () => {
    const snap = (seq: number, reason: Phase2C26B2C2B2FProfileSnapshot['reason'], searchElapsedMs: number, windowBoundaryMs: number | null, exclusive: Partial<Record<SearchRuntimeSection, number>>,
      bonusWorks: number): Phase2C26B2C2B2FProfileSnapshot => ({ kind: 'profile_snapshot', reason, seq, atMs: searchElapsedMs + 1, searchElapsedMs, windowBoundaryMs,
      runtime: { atMs: searchElapsedMs + 1, byTarget: [], observed: [{ targetOrdinal: 0, ...observation(exclusive), settleWithoutWorkMs: 0 }], activeTargetOrdinal: 0, activeStack: [], contractViolations: 0, contractViolationSamples: [] },
      depth: { bonus: { startedWorks: bonusWorks, completedWorks: bonusWorks, withCounts: bonusWorks, channels: 1, maxDepth: bonusWorks, subscriberCountSum: 0, retainedCountAfterSum: 0, lastRetainedCountAfter: null, exhaustedWorks: 0 },
        skill: { startedWorks: 0, completedWorks: 0, withCounts: 0, channels: 0, maxDepth: 0, subscriberCountSum: 0, retainedCountAfterSum: 0, lastRetainedCountAfter: null, exhaustedWorks: 0 } },
      yields: { count: seq * 10, totalMs: 0, bySection: {} }, events: 0, searchStartedAtMs: 1, searchCompletedAtMs: null })
    const snapshots = [snap(1, 'heartbeat', 5_000, null, { bonus_depth_read: 5_000 }, 1), snap(2, 'window_boundary', 600_000, 600_000, { bonus_depth_read: 600_000 }, 10),
      snap(3, 'window_boundary', 1_200_000, 1_200_000, { bonus_depth_read: 900_000, skill_depth_read: 300_000 }, 12), snap(4, 'heartbeat', 1_700_000, null, { bonus_depth_read: 900_000, skill_depth_read: 800_000 }, 12)]
    expect(phase2c26b2c2b2fSelectSnapshot(snapshots)).toMatchObject({ valid: true, source: 'last_durable_snapshot', snapshots: 4 })
    expect(phase2c26b2c2b2fSelectSnapshot([...snapshots].reverse()).valid).toBe(false)
    expect(phase2c26b2c2b2fSelectSnapshot([])).toMatchObject({ valid: false, last: null, source: 'none' })
    const windows = phase2c26b2c2b2fWindows(snapshots)
    expect(windows.map(w => [w.partial, w.observedFromMs, w.observedToMs])).toEqual([[false, 0, 600_000], [false, 600_000, 1_200_000], [true, 1_200_000, 1_700_000]])
    expect(windows.map(w => w.categories!.shares.BONUS)).toEqual([1, 0.5, 0])
    expect(windows.map(w => w.categories!.shares.SKILL)).toEqual([0, 0.5, 1])
    expect(windows.map(w => w.depth!.bonusCompletedWorks)).toEqual([10, 2, 0])
    // A run killed before the first boundary has a partial first window and no later window.
    const early = phase2c26b2c2b2fWindows(snapshots.slice(0, 1))
    expect(early.map(w => [w.partial, w.categories === null])).toEqual([[true, false], [true, true], [true, true]])
  })
})

// ---------------------------------------------------------------- the runner start attestation

const HEAD = 'a'.repeat(40)
const OBS_PROBES: Phase2C26B2C2B2EProbe[] = [{ targetWeaponId: 't1', b2c2b2dTaskId: 't05-r03', contextRank: 3, extent: { maxNormalAdvance: 4, maxGogmaAdvance: 235, maxSkillAdvance: 900 } }]
const OBS_IDENTITIES: Phase2C26B2C2B2FTaskIdentity[] = [{ taskId: 't05-r03', targetWeaponId: 't1', contextRank: 3, groupIndex: 1, reservationDigest: 'r', targetEligibleMinCardinality: 1,
  representativeFixedSetId: 'k', representativeFixedTargetWeaponIds: ['t9'], defaultSearchInputDigest: 'd', searchInputDigest: 's', extent: { maxNormalAdvance: 4, maxGogmaAdvance: 235, maxSkillAdvance: 900 } }]
const observation0 = { createdAt: '2026-10-05T13:00:00.000Z', runnerScript: 'scripts/run-planner-global-phase2c26b2c2b2f.mjs', node: 'v24.19.0', repositoryHead: HEAD, uncommittedBenchmarkCode: false,
  benchmarkCodeSha256: 'b'.repeat(64), exportFileName: 'export.json', exportSha256: 'c'.repeat(64), exportBytes: 10, probeManifestFileName: 'probes.json.local', probeManifestSha256: 'd'.repeat(64),
  probeManifestB2C2B2EResultSha256: PHASE2C26B2C2B2F_REGISTERED_B2C2B2E.resultSha256, targetWeaponIds: ['t1'], probes: OBS_PROBES, expectedTaskIdentities: OBS_IDENTITIES,
  stage1: { ...PHASE2C26B2C2B2F_STAGE1 }, smoke: null }
const expectation: Phase2C26B2C2B2FAttestationExpectation = { repositoryHead: HEAD, benchmarkCodeSha256: 'b'.repeat(64), exportSha256: 'c'.repeat(64), probeManifestSha256: 'd'.repeat(64),
  b2c2b2eResultSha256: PHASE2C26B2C2B2F_REGISTERED_B2C2B2E.resultSha256, probes: OBS_PROBES, expectedTaskIdentities: OBS_IDENTITIES, firstChildStartedAt: '2026-10-05T13:00:00.500Z' }

describe('Phase 2-C2.6-B2-C2B2F runner start attestation', () => {
  it('carries the launch observation and every registered condition (30 minutes / 12,288 MB / concurrency 1 / onSearchRuntime only) and verifies only against independent values', () => {
    const attestation = phase2c26b2c2b2fStartAttestationBody(observation0)
    expect(attestation).toMatchObject({ attestedBy: 'runner', phase: PHASE2C26B2C2B2F_START_ATTESTATION_PHASE, stage1: { childHeapMb: 12_288, budgetMs: 1_800_000, concurrency: 1, retry: 'none', fallback: 'none' },
      b2c2b2eStage1: PHASE2C26B2C2B2E_STAGE1, changedStage1Fields: ['budgetMs'], expectedTasks: 1, searchInstrumentation: PHASE2C26A4_SEARCH_INSTRUMENTATION, cpuProfiler: false, smoke: null })
    expect(verifyPhase2C26B2C2B2FStartAttestation(attestation, expectation)).toEqual({ verified: true, issues: [], integrityIssues: [] })
    const integrity = (patch: Json) => verifyPhase2C26B2C2B2FStartAttestation({ ...attestation, ...patch }, expectation).integrityIssues.length > 0
    for (const patch of [{ repositoryHead: 'f'.repeat(40) }, { benchmarkCodeSha256: '0'.repeat(64) }, { exportSha256: '0'.repeat(64) }, { probeManifestSha256: '0'.repeat(64) },
      { probeManifestB2C2B2EResultSha256: '0'.repeat(64) }, { targetWeaponIds: [] }, { probes: [{ ...OBS_PROBES[0]!, contextRank: 4 }] },
      { expectedTaskIdentities: [{ ...OBS_IDENTITIES[0]!, searchInputDigest: 'x' }] }, { attestedBy: 'reconstruction' }, { createdAt: '2026-10-05T13:00:01.000Z' }, { extra: 1 }]) expect(integrity(patch)).toBe(true)
    for (const patch of [{ uncommittedBenchmarkCode: true }, { smoke: { budgetMs: 1000 } }, { stage1: { ...PHASE2C26B2C2B2E_STAGE1 } }, { stage1: { ...PHASE2C26B2C2B2F_STAGE1, childHeapMb: 16_384 } },
      { stage1: { ...PHASE2C26B2C2B2F_STAGE1, concurrency: 2 } }, { stage1: { ...PHASE2C26B2C2B2F_STAGE1, retry: 'once' } }, { cpuProfiler: true },
      { searchInstrumentation: { ...PHASE2C26A4_SEARCH_INSTRUMENTATION, onGogmaReservedRuntime: true } }, { b2c2b2eStage1: { ...PHASE2C26B2C2B2D_STAGE1 } }]) {
      expect(integrity(patch)).toBe(false)
      expect(verifyPhase2C26B2C2B2FStartAttestation({ ...attestation, ...patch }, expectation).verified).toBe(false)
    }
    expect(verifyPhase2C26B2C2B2FStartAttestation(null, expectation).verified).toBe(false)
    expect(Object.keys(phase2c26b2c2b2fRegisteredConditions())).toContain('searchInstrumentation')
  })
})

// ---------------------------------------------------------------- isolation and provenance

describe('Phase 2-C2.6-B2-C2B2F isolation and provenance', () => {
  it('is never imported by Production and hard-codes no Target, task, rank, extent or digest value of the population', () => {
    const production = import.meta.glob(['../domain/**/*.ts', '../services/**/*.ts', '../workers/**/*.ts', '../pages/**/*.tsx', '../components/**/*.tsx', '../db/**/*.ts', '!../**/*.test.ts', '!../**/*.test.tsx'],
      { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    expect(Object.keys(production).length).toBeGreaterThan(50)
    expect(Object.entries(production).filter(([, source]) => /plannerGlobalPhase2C26B2C2B2F/.test(source)).map(([path]) => path)).toEqual([])
    for (const source of [searchSource, targetsSource, analysisSource, prepareSource, runnerSource, analyzerSource]) {
      expect(source).not.toMatch(/fnv1a32[-:][0-9a-f]{8}|[0-9a-f]{8}-[0-9a-f]{4}-|build-list\.|070a1222|a367c177|4a875aac/)
      expect(source).not.toMatch(/\bt0\d-r\d\d\b/)
      expect(source).not.toMatch(/\b(1083|1084)\b/)
    }
    for (const source of [searchSource, targetsSource, analysisSource]) expect(source).not.toMatch(/node:fs|readFile|import\.meta\.glob/)
  })

  it('keeps the oracle, every RESULT and B2-C2B2E\'s measurements out of the Search side; the Search child never learns an expected outcome or bottleneck', () => {
    for (const source of [searchSource, runnerSource]) {
      expect(source).not.toMatch(/ORACLE_[1]657|1657|--oracle|--manifest|--b2c2b2e-result|_RESULT|Targets'|Analysis'|expectedStableKey|expectedCandidateIndex|expectedSection|expectedBottleneck|peakHeapBytes/)
    }
    expect(searchSource).not.toMatch(/plannerGlobalPhase2C26B2C2B2[A-F]Targets|plannerGlobalPhase2C26B2C2B2[A-F]Analysis/)
    expect(runnerSource).toMatch(/--probes/)
    expect(runnerSource).toMatch(/runPhase2C26B2C2B2FTask\(input, schedule, task, engine, \{ yieldControl, instrumentation: profiler\.instrumentation \}\)/)
    expect(runnerSource).not.toMatch(/--cpu-prof|inspector|Session\(/)
    expect(prepareSource).toMatch(/--b2c2b2e-result/)
    expect(prepareSource).not.toMatch(/--oracle|visitPlannerAlternativeCandidates/)
    expect(analyzerSource).not.toMatch(/--oracle|ORACLE_[1]657/)
    for (const source of [analysisSource, analyzerSource, targetsSource, prepareSource]) expect(source).not.toMatch(/visitPlannerAlternativeCandidates|runPhase2C26B2C2B2[DF]Search\(|runPhase2C26B2C2B2[DF]Task\(/)
    // The Search side reuses A4's tracker rather than a tracker of its own; no new Production instrumentation seam.
    expect(searchSource).toMatch(/createPhase2C26A4RuntimeTracker\(/)
    expect(searchSource).not.toMatch(/onGogmaReservedRuntime:|onSkillReservedDepth:|onGogmaReservedDepth:|onWorkSettled:/)
    expect(typeof runPhase2C26B2C2B2DSearch).toBe('function')
    expect(typeof runPhase2C26B2C2B2FSearch).toBe('function')
  })
})


// ---------------------------------------------------------------- the committed formal RESULT

describe('Phase 2-C2.6-B2-C2B2F committed RESULT', () => {
  const result = JSON.parse(rawResult)
  const MEASURED_HEAD = 'dd41061d492d91c0ebc9a2ecdc13ebc0a857f280'

  it('is formal: runner start attestation verified against the independently obtained HEAD / code / Export / manifest / B2-C2B2E RESULT, no invalid reason', () => {
    expect(result.provenance).toMatchObject({ formal: true, evidenceGrade: 'formal', partialRun: false, launchProvenanceVerified: true, launchProvenanceSource: 'runner_start_attestation',
      launchProvenanceIssues: [], launchProvenanceIntegrityIssues: [], measuredHead: MEASURED_HEAD, analysisHead: MEASURED_HEAD, measuredHeadIsAncestor: true, uncommittedBenchmarkCode: false,
      smoke: null, calculationCodeChangedSinceMeasuredHead: [], b2c2b2eResultSha256: PHASE2C26B2C2B2F_REGISTERED_B2C2B2E.resultSha256, exportSha256: eJson.provenance.exportSha256,
      profilingOnly: true, routeExactJudged: false, oracleReadBySearchChild: false, expectedOutcomeKnownBySearchChild: false, productionSchedulerEvidence: false })
    expect(result.provenance.benchmarkCodeSha256).toBe(result.provenance.recomputedBenchmarkCodeSha256)
    expect(result.provenance.startAttestation.body).toMatchObject({ attestedBy: 'runner', phase: PHASE2C26B2C2B2F_START_ATTESTATION_PHASE, repositoryHead: MEASURED_HEAD, smoke: null,
      stage1: PHASE2C26B2C2B2F_STAGE1, b2c2b2eStage1: PHASE2C26B2C2B2E_STAGE1, changedStage1Fields: ['budgetMs'], searchInstrumentation: PHASE2C26A4_SEARCH_INSTRUMENTATION, cpuProfiler: false })
    expect(result.provenance.startAttestation.body.createdAt).toBe(result.provenance.measuredAt)
    expect(Object.values(result.parity.hashChain).every(v => v === true)).toBe(true)
    expect(Object.values(result.conditions.conditionChecks).every(v => v === true)).toBe(true)
    expect(result.invalidReasons).toEqual([])
  })

  it('profiled exactly the B2-C2B2E time-bound timeout Target in B2-C2B2E\'s Search input (identity, rebuilt task, excluded current Route, child-attested identity)', () => {
    const { authority } = parsePhase2C26B2C2B2FB2C2B2EAuthority(eJson, PHASE2C26B2C2B2F_REGISTERED_B2C2B2E.resultSha256)
    const derived = phase2c26b2c2b2fPopulation(authority)
    expect(result.population.targetWeaponIds).toEqual(derived.targetWeaponIds)
    expect(result.population.probes).toEqual(derived.probes)
    expect(result.parity.population).toMatchObject({ manifestEqualsDerived: true, runnerTargetsEqualManifest: true, runnerProbesEqualManifest: true, runnerIdentitiesEqualManifest: true, targets: 1 })
    expect(result.parity.identity.rawEqualsExpected).toBe(true)
    expect(result.parity.identity.expected).toEqual(derived.expectedTaskIdentities[0])
    expect(result.parity.taskRebuild).toMatchObject({ valid: true, tasksEqualRebuilt: true })
    expect(Object.values(result.parity.childIdentity).every(v => v === true)).toBe(true)
    const route = result.parity.excludedRoute
    expect(route).toMatchObject({ valid: true, excludedRouteKeyCount: 1, excludedRouteIsCurrentRoute: true })
    expect([route.childAttestedExcludedRouteKeySha256, route.b2c2b2eRederivedExcludedRouteKeySha256]).toEqual([route.rederivedExcludedRouteKeySha256, route.rederivedExcludedRouteKeySha256])
    expect(route.rederivedExcludedRouteKeySha256).toBe(derived.b2c2b2e[0]!.rederivedExcludedRouteKeySha256)
  })

  it('pins the outcome and the decision: a 30-minute timeout (never Candidate 0, no delivery), coverage ~1, BONUS dominant with no secondary, stable across the windows', () => {
    expect(result.outcome).toMatchObject({ process: 'timeout', record: null, naturalCompletion: false, candidateCount: null, budgetMs: 1_800_000, profileSource: 'last_durable_snapshot',
      deliveredBeforeKill: { deliveryFlushes: 0, deliveryConsumerCalls: 0 } })
    expect(result.outcome.tail.unobservedTailMs).toBeLessThan(10_000)
    expect(result.profile.contractViolations).toBe(0)
    expect(result.profile.partition.matches).toBe(true)
    expect(result.profile.coverage).toBeGreaterThanOrEqual(0.999)
    expect(result.profile.searchWallMs).toBeGreaterThan(1_700_000)
    expect(result.profile.categoryShares.BONUS).toBeGreaterThan(0.999)
    expect(result.profile.categoryShares.SKILL).toBeLessThan(0.001)
    expect(result.decision).toMatchObject({ case: 'B2C2B2F_BONUS_DOMINANT', dominant: 'BONUS', secondary: [], reasons: [] })
    // Recomputing from the recorded totals gives the same categories and decision.
    const recomputed = phase2c26b2c2b2fCategories({ inclusiveMs: result.profile.inclusiveMs, exclusiveMs: result.profile.exclusiveMs })
    expect(recomputed.shares).toEqual(result.profile.categoryShares)
    expect(phase2c26b2c2b2fDecision({ invalidReasons: [], insufficientReasons: [], categories: recomputed }).case).toBe('B2C2B2F_BONUS_DOMINANT')
    // Inside BONUS: the held-aware Bonus stream read dominates, then the Ideal filter and the notice scan.
    const bonus = result.profile.sectionExclusiveMs.BONUS
    expect(bonus.bonus_depth_read / result.profile.searchWallMs).toBeGreaterThan(0.8)
    expect(Object.entries(bonus).sort((a, b) => (b[1] as number) - (a[1] as number)).slice(0, 3).map(([k]) => k)).toEqual(['bonus_depth_read', 'bonus_ideal_filter', 'bonus_notice_scan'])
    expect(result.profile.yields.bySection.bonus_depth_read.count / result.profile.yields.count).toBeGreaterThan(0.999)
    expect(result.profile.depth.skill).toMatchObject({ completedWorks: 97, rawSolutions: 97, idealSolutions: 0 })
    expect(result.profile.depth.bonus).toMatchObject({ completedWorks: 281, channels: 6, maxDepth: 49, idealSolutions: 61_693 })
    expect(result.profile.activeStackAtLastSnapshot.map((f: { section: string }) => f.section)).toEqual(['search_runtime', 'scheduler_step', 'scheduler_settle', 'bonus_depth_work', 'bonus_depth_read'])
    expect(result.windows.map((w: { partial: boolean }) => w.partial)).toEqual([false, false, true])
    for (const w of result.windows) expect(w.categories.shares.BONUS).toBeGreaterThan(0.999)
  })
})
