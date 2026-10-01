import { beforeAll, describe, expect, it } from 'vitest'
import rawC26a from '../../docs/PLANNER_GLOBAL_PHASE2C26A_RESULT.json?raw'
import rawA2 from '../../docs/PLANNER_GLOBAL_PHASE2C26A2_RESULT.json?raw'
import rawA3 from '../../docs/PLANNER_GLOBAL_PHASE2C26A3_RESULT.json?raw'
import rawA4 from '../../docs/PLANNER_GLOBAL_PHASE2C26A4_RESULT.json?raw'
import rawA5 from '../../docs/PLANNER_GLOBAL_PHASE2C26A5_RESULT.json?raw'
import rawA6 from '../../docs/PLANNER_GLOBAL_PHASE2C26A6_RESULT.json?raw'
import rawA7 from '../../docs/PLANNER_GLOBAL_PHASE2C26A7_RESULT.json?raw'
import bonusStreamSource from '../domain/search/bonusStream.ts?raw'
import hashingSource from '../domain/models/hashing.ts?raw'
import semanticKeysSource from '../domain/search/semanticKeys.ts?raw'
import { preparePlannerInitialContext } from '../domain/planner/plannerInitialContext'
import {
  runPlannerAlternativeKernel,
  type PlannerAlternativeKernelRequest,
  type PlannerAlternativeKernelResult,
} from '../domain/planner/alternative'
import type { BuildListEntryId, TargetWeapon, TargetWeaponId } from '../domain/models/publicTypes'
import type { SearchRuntimeEvent } from '../domain/search/searchRuntime'
import { idealBonuses, belowPracticalBonuses } from '../test/fixtures/constrainedEnumeration'
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
import { parsePhase2C26AAuthority, type Phase2C26A2Authority, type Phase2C26A2RunConditions } from './plannerGlobalPhase2C26A2'
import { parsePhase2C26A2ResultAuthority, type Phase2C26A3A2Authority, type Phase2C26A3DepthRecord, type Phase2C26A3PhaseStartRecord } from './plannerGlobalPhase2C26A3'
import { parsePhase2C26A3ResultAuthority, type Phase2C26A4A3Authority } from './plannerGlobalPhase2C26A4'
import {
  createPhase2C26A5ProfileController,
  parsePhase2C26A4ResultAuthority,
  PHASE2C26A5_PROFILER,
  type Phase2C26A5A4Authority,
  type Phase2C26A5ClockPair,
} from './plannerGlobalPhase2C26A5'
import type { CpuProfile, CpuProfileCallFrame, Phase2C26A5ScriptTable } from './plannerGlobalPhase2C26A5Analysis'
import { parsePhase2C26A5ResultAuthority, type Phase2C26A6A5Authority } from './plannerGlobalPhase2C26A6'
import type { Phase2C26A6WorkPrefix } from './plannerGlobalPhase2C26A6Analysis'
import { comparePhase2C26A6WorkPrefix } from './plannerGlobalPhase2C26A6Analysis'
import { createPhase2C26A7KernelProgress, parsePhase2C26A6ResultAuthority, PHASE2C26A7_NODE_FLAGS, PHASE2C26A7_SEARCH_INSTRUMENTATION, type Phase2C26A7A6Authority } from './plannerGlobalPhase2C26A7'
import {
  createPhase2C26A8KernelInstrumentation,
  parsePhase2C26A7ResultAuthority,
  PHASE2C26A8_DIAGNOSTIC_NODE_FLAGS,
  PHASE2C26A8_PRIMARY_NODE_FLAGS,
  PHASE2C26A8_PRODUCTION_CHANGE,
  PHASE2C26A8_PROFILER,
  PHASE2C26A8_REQUIRED_SOURCE_FILES,
  PHASE2C26A8_SEARCH_INSTRUMENTATION,
  selectPhase2C26A8DiagnosticRepresentative,
  validatePhase2C26A8ConditionParity,
  validatePhase2C26A8NoProductionChange,
  type Phase2C26A8A7Authority,
} from './plannerGlobalPhase2C26A8'
import {
  analyzePhase2C26A8Profile,
  classifyPhase2C26A8Stack,
  comparePhase2C26A8DepthPrefix,
  derivePhase2C26A8FrontierBlock,
  derivePhase2C26A8FunctionSpans,
  phase2c26a8Decision,
  phase2c26a8DecisionRow,
  phase2c26a8KernelOrigin,
  phase2c26a8PooledShares,
  PHASE2C26A8_CATEGORIES,
  PHASE2C26A8_DECISION_RULE,
  PHASE2C26A8_FUNCTION_REGISTRY,
  reconstructPhase2C26A8FrontierIntervals,
  resolvePhase2C26A8Frame,
  validatePhase2C26A8CpuProfile,
  validatePhase2C26A8FormalRun,
  type Phase2C26A8Category,
  type Phase2C26A8Frame,
  type Phase2C26A8IntervalReconstruction,
  type Phase2C26A8ProfileAnalysis,
} from './plannerGlobalPhase2C26A8Analysis'

/*
 * Issue #154 Phase 2-C2.6-A8. No Production code changes: the Search instrumentation stays A7's pair of section boundary
 * observers (the A8 wrapper only reports the first Search start, the profile window anchor) and the V8 CPU profiler
 * observes the child from outside. The committed A7 .. C2.6-A RESULTs are the fail-closed authorities; the interval
 * reconstruction from the A3 stream, the stack classification, the profile analysis and the pre-registered decision rule
 * are fixed here on real records and synthetic profiles. No duration is asserted.
 */

const SLOW = 180_000

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
const c26aJson = JSON.parse(rawC26a), a2Json = JSON.parse(rawA2), a3Json = JSON.parse(rawA3), a4Json = JSON.parse(rawA4), a5Json = JSON.parse(rawA5)
const a6Json = JSON.parse(rawA6), a7Json = JSON.parse(rawA7)
let shas = { c26a: '', a2: '', a3: '', a4: '', a5: '', a6: '' }
let a7Sha = ''
beforeAll(async () => {
  shas = { c26a: await sha256Hex(rawC26a), a2: await sha256Hex(rawA2), a3: await sha256Hex(rawA3), a4: await sha256Hex(rawA4), a5: await sha256Hex(rawA5), a6: await sha256Hex(rawA6) }
  a7Sha = await sha256Hex(rawA7)
})

function authorities(): { c26a: Phase2C26A2Authority; a2: Phase2C26A3A2Authority; a3: Phase2C26A4A3Authority; a4: Phase2C26A5A4Authority; a5: Phase2C26A6A5Authority;
  a6: Phase2C26A7A6Authority } {
  const c26a = parsePhase2C26AAuthority(c26aJson)
  if (!c26a.authority) throw new Error(c26a.issues.join('; '))
  const a2 = parsePhase2C26A2ResultAuthority(a2Json, shas.c26a, c26a.authority)
  if (!a2.authority) throw new Error(a2.issues.join('; '))
  const a3 = parsePhase2C26A3ResultAuthority(a3Json, shas.c26a, shas.a2, a2.authority, c26a.authority)
  if (!a3.authority) throw new Error(a3.issues.join('; '))
  const a4 = parsePhase2C26A4ResultAuthority(a4Json, { c26a: shas.c26a, a2: shas.a2, a3: shas.a3 }, a3.authority, c26a.authority)
  if (!a4.authority) throw new Error(a4.issues.join('; '))
  const a5 = parsePhase2C26A5ResultAuthority(a5Json, { c26a: shas.c26a, a2: shas.a2, a3: shas.a3, a4: shas.a4 }, a4.authority, c26a.authority)
  if (!a5.authority) throw new Error(a5.issues.join('; '))
  const a6 = parsePhase2C26A6ResultAuthority(a6Json, { c26a: shas.c26a, a2: shas.a2, a3: shas.a3, a4: shas.a4, a5: shas.a5 }, a5.authority, c26a.authority)
  if (!a6.authority) throw new Error(a6.issues.join('; '))
  return { c26a: c26a.authority, a2: a2.authority, a3: a3.authority, a4: a4.authority, a5: a5.authority, a6: a6.authority }
}
function a7Authority(): Phase2C26A8A7Authority {
  const { c26a, a6 } = authorities()
  const parsed = parsePhase2C26A7ResultAuthority(a7Json, shas, a6, c26a)
  if (!parsed.authority) throw new Error(parsed.issues.join('; '))
  return parsed.authority
}

// ---------------------------------------------------------------- authority

describe('Phase 2-C2.6-A7 RESULT as the selection and hotspot authority', () => {
  it('accepts the committed formal A7 RESULT (Case F, frontier_reduction_sort) made against the committed A6 .. C2.6-A RESULTs and takes its selection', () => {
    const { c26a, a6 } = authorities()
    const parsed = parsePhase2C26A7ResultAuthority(a7Json, shas, a6, c26a)
    expect(parsed.issues).toEqual([])
    expect(parsed.authority?.decisionCase).toBe('F_dominant_inner_section')
    expect(parsed.authority?.decisionSection).toBe('frontier_reduction_sort')
    // The selection is A7's, which is A6's; no ID is fixed in the source (evidence check only).
    expect(parsed.authority?.primaryOrientationIds).toEqual(a6.primaryOrientationIds)
    expect(parsed.authority?.primaryOrientationIds).toEqual(['c6-p1', 'c13-p1', 'c14-p0'])
    for (const reference of parsed.authority?.references ?? []) {
      expect(reference.dominantSection).toBe('frontier_reduction_sort')
      expect(reference.innerCoverageOfBonusDepthRead).toBeGreaterThanOrEqual(0.9)
      expect(reference.childOutcome).toBe('timeout')
      expect(reference.frontierShareOfBonusDepthRead).toBeGreaterThan(0.5)
    }
    expect(parsed.authority?.runSha256).toBe(a7Json.sources.run.sha256)
  })

  it('fails closed on a non-formal A7, another case / section, a failure count, a weaker coverage, a broken SHA chain or another selection', () => {
    const { c26a, a6 } = authorities()
    const mutate = (edit: (json: typeof a7Json) => void) => { const json = structuredClone(a7Json); edit(json); return parsePhase2C26A7ResultAuthority(json, shas, a6, c26a) }
    const zero = '0'.repeat(64)
    for (const key of ['c26a', 'a2', 'a3', 'a4', 'a5', 'a6'] as const) expect(parsePhase2C26A7ResultAuthority(a7Json, { ...shas, [key]: zero }, a6, c26a).valid).toBe(false)
    expect(parsePhase2C26A7ResultAuthority(a7Json, shas, { ...a6, primaryOrientationIds: ['c6-p1', 'c13-p1', 'c20-p1'] }, c26a).valid).toBe(false)
    expect(parsePhase2C26A7ResultAuthority(a7Json, shas, { ...a6, measuredHead: '0'.repeat(40) }, c26a).valid).toBe(false)
    expect(parsePhase2C26A7ResultAuthority(a7Json, shas, { ...a6, runSha256: zero }, c26a).valid).toBe(false)
    expect(mutate(json => { json.provenance.formal = false }).valid).toBe(false)
    expect(mutate(json => { json.provenance.calculationCodeChangedSinceMeasuredHead = ['src/domain/search/bonusStream.ts'] }).valid).toBe(false)
    expect(mutate(json => { json.formalSeriesValidation.valid = false }).valid).toBe(false)
    expect(mutate(json => { json.selectionValidation.valid = false }).valid).toBe(false)
    expect(mutate(json => { json.conditionParity.valid = false }).valid).toBe(false)
    expect(mutate(json => { json.baselineParity.valid = false }).valid).toBe(false)
    expect(mutate(json => { json.summary.decision.case = 'M_mixed' }).valid).toBe(false)
    expect(mutate(json => { json.summary.decision.section = 'state_generation' }).valid).toBe(false)
    expect(mutate(json => { json.conclusion.decision.section = 'state_generation' }).valid).toBe(false)
    expect(mutate(json => { json.summary.childStatus.timeout = 2; json.summary.childStatus.out_of_memory = 1 }).valid).toBe(false)
    expect(mutate(json => { json.summary.childStatus.process_failure = 1 }).valid).toBe(false)
    expect(mutate(json => { json.summary.semanticFailures = 1 }).valid).toBe(false)
    expect(mutate(json => { json.summary.contractViolations = 1 }).valid).toBe(false)
    expect(mutate(json => { json.summary.orientations = 2 }).valid).toBe(false)
    expect(mutate(json => { json.perOrientation[1].semanticFailures = 1 }).valid).toBe(false)
    expect(mutate(json => { json.perOrientation[1].contractViolations.inner = 1 }).valid).toBe(false)
    expect(mutate(json => { json.perOrientation[0].searchCompleted = true }).valid).toBe(false)
    expect(mutate(json => { json.perOrientation[2].inner.dominantSection = 'state_generation' }).valid).toBe(false)
    expect(mutate(json => { json.perOrientation[2].inner.innerCoverageOfBonusDepthRead = 0.85 }).valid).toBe(false)
    expect(mutate(json => { json.summary.decision.dominantByPrimary['c13-p1'] = 'state_generation' }).valid).toBe(false)
    expect(mutate(json => { json.provenance.authorityShaChain.a6ChainRecordedByA6.a5ChainRecordedByA5.a4ChainRecordedByA4.a2ShaRecordedByA3 = zero }).valid).toBe(false)
    expect(mutate(json => { json.provenance.authorityShaChain.a5ShaRecordedByA6 = zero }).valid).toBe(false)
    expect(mutate(json => { json.sources.c26a6Result.sha256 = zero }).valid).toBe(false)
    expect(mutate(json => { json.sources.a6Run.sha256 = zero }).valid).toBe(false)
    expect(mutate(json => { delete json.sources.run }).valid).toBe(false)
    expect(mutate(json => { json.conditions.cpuProfiler = true }).valid).toBe(false)
    expect(mutate(json => { json.conditions.searchInstrumentation.onGogmaReservedRuntime = false }).valid).toBe(false)
    expect(mutate(json => { json.selectionValidation.expected = ['c6-p1', 'c13-p1'] }).valid).toBe(false)
    expect(mutate(json => { json.perOrientation = [json.perOrientation[1], json.perOrientation[0], json.perOrientation[2]] }).valid).toBe(false)
    expect(parsePhase2C26A7ResultAuthority(null, shas, a6, c26a).valid).toBe(false)
  })

  it('derives the no-inlining representative from the A7 evidence (largest frontier share of bonus_depth_read, ties in A7 order)', () => {
    const a7 = a7Authority()
    const selection = selectPhase2C26A8DiagnosticRepresentative(a7)
    const expected = [...a7.references].sort((a, b) => b.frontierShareOfBonusDepthRead - a.frontierShareOfBonusDepthRead)[0].orientationId
    expect(selection.representativeOrientationId).toBe(expected)
    const tied = { primaryOrientationIds: ['x', 'y', 'z'], references: ['x', 'y', 'z'].map((orientationId, index) => ({ ...a7.references[0], orientationId,
      frontierShareOfBonusDepthRead: index === 0 ? 0.4 : 0.6 })) }
    expect(selectPhase2C26A8DiagnosticRepresentative(tied).representativeOrientationId).toBe('y')
    expect(() => selectPhase2C26A8DiagnosticRepresentative({ primaryOrientationIds: ['q'], references: [] })).toThrow()
  })
})

describe('Phase 2-C2.6-A8 has no Production change', () => {
  it('accepts Research / test sources only and fails closed on any Production calculation source', () => {
    expect(PHASE2C26A8_PRODUCTION_CHANGE).toEqual([])
    expect(validatePhase2C26A8NoProductionChange([]).valid).toBe(true)
    expect(validatePhase2C26A8NoProductionChange(['src/benchmarks/plannerGlobalPhase2C26A8.ts', 'src/domain/search/bonusStream.test.ts', 'src/test/fixtures/x.ts']).valid).toBe(true)
    for (const path of ['src/domain/search/bonusStream.ts', 'src/domain/models/hashing.ts', 'src/domain/search/semanticKeys.ts', 'docs/SEARCH_SPEC.md']) {
      expect(validatePhase2C26A8NoProductionChange([path]).valid, path).toBe(false)
    }
  })
})

describe('Phase 2-C2.6-A8 conditions', () => {
  it('accepts every A7 condition and the A7 pair of observers, and rejects another budget, heap flag, instrumentation or a profiled A7', () => {
    const { c26a, a2, a3, a4, a5, a6 } = authorities()
    const a7 = a7Authority()
    const current = { ...a7.conditions, nodeFlags: [...PHASE2C26A8_PRIMARY_NODE_FLAGS], searchInstrumentation: { ...PHASE2C26A8_SEARCH_INSTRUMENTATION } } as unknown as
      Phase2C26A2RunConditions & { nodeFlags: string[]; searchInstrumentation: unknown }
    const parity = (value: typeof current, a7Conditions = a7.conditions) => validatePhase2C26A8ConditionParity(value, a7Conditions, a6.conditions, a5.conditions, a4.conditions,
      a3.conditions, c26a, a2.conditions)
    expect(parity(current).issues).toEqual([])
    expect(PHASE2C26A8_PRIMARY_NODE_FLAGS).toEqual(PHASE2C26A7_NODE_FLAGS)
    expect(PHASE2C26A8_SEARCH_INSTRUMENTATION).toEqual(PHASE2C26A7_SEARCH_INSTRUMENTATION)
    expect(PHASE2C26A8_PROFILER).toEqual(PHASE2C26A5_PROFILER)
    expect(PHASE2C26A8_PROFILER).toEqual({ requestedSamplingIntervalUs: 10_000, warmupMs: 120_000, profileStopMs: 720_000, requestedProfileDurationMs: 600_000 })
    expect(PHASE2C26A8_DIAGNOSTIC_NODE_FLAGS).toEqual(['--no-turbo-inlining', '--no-maglev-inlining', '--max-old-space-size=8192'])
    expect(parity({ ...current, orientationBudgetMs: 60_000 }).valid).toBe(false)
    expect(parity({ ...current, nodeFlags: ['--max-old-space-size=4096'] }).valid).toBe(false)
    expect(parity({ ...current, nodeFlags: [...PHASE2C26A8_DIAGNOSTIC_NODE_FLAGS] }).valid).toBe(false)
    expect(parity({ ...current, searchInstrumentation: { ...PHASE2C26A8_SEARCH_INSTRUMENTATION, onWorkSettled: true } }).valid).toBe(false)
    expect(parity({ ...current, concurrency: 2 }).valid).toBe(false)
    expect(parity(current, { ...a7.conditions, cpuProfiler: true }).valid).toBe(false)
  })
})

// ---------------------------------------------------------------- kernel level (the A8 wrapper over the A7 instrumentation)

const TARGET_A = 'target.a8.a'
const TARGET_B = 'target.a8.b' as TargetWeaponId
const ENTRY_A = 'build-list.a8.a' as BuildListEntryId
const SOURCE_A_SKILL = 'series_skill.fixture.z'
const SOURCE_B_SKILL = 'series_skill.fixture.b-source'

function kernelScenario() {
  const skill = { seriesSkillId: SOURCE_A_SKILL, groupSkillId: null, matchMode: 'all' as const }
  const a: TargetWeapon = orchestrationTarget(TARGET_A, { priority: 5, idealSkillCondition: skill, practicalSkillCondition: skill })
  const b = skillConstrainedTarget(TARGET_B, { priority: 1 })
  return orchestrationScenario({
    targets: [a, b],
    ownedWeapons: [
      orchestrationSource(ORCHESTRATION_SOURCE_A, { seriesSkillId: SOURCE_A_SKILL }),
      orchestrationSource(ORCHESTRATION_SOURCE_B, { restorationBonuses: belowPracticalBonuses(), seriesSkillId: SOURCE_B_SKILL }),
    ],
    entries: [
      orchestrationEntry(ENTRY_A, a, resetRoute(ORCHESTRATION_SOURCE_A), { finalBonuses: idealBonuses(), seriesSkillId: SOURCE_A_SKILL }),
      orchestrationEntry('build-list.a8.b' as BuildListEntryId, b, {
        kind: 'existing_gogma_mixed',
        sourceOwnedWeaponId: resetRoute(ORCHESTRATION_SOURCE_B).sourceOwnedWeaponId,
        operations: [...resetRoute(ORCHESTRATION_SOURCE_B).operations, ...resetSkillsRoute(ORCHESTRATION_SOURCE_B).operations],
      }),
    ],
  })
}

function kernelRequest(built: ReturnType<typeof kernelScenario>, extent: PlannerAlternativeKernelRequest['extent']): PlannerAlternativeKernelRequest {
  const prepared = preparePlannerInitialContext(built.input, built.dependencies)
  if (prepared.status !== 'ready') throw new Error('fixture not ready')
  const conflict = prepared.context.initialConflictDetection.conflicts.find(({ kind, buildListEntryIds }) => kind === 'same_gogma_counter' && buildListEntryIds.includes(ENTRY_A))
  if (!conflict) throw new Error('no Gogma conflict with A')
  return {
    plannerInput: built.input, decision: { conflictKey: conflict.id, selectedBuildListEntryId: ENTRY_A },
    priorFixedBuildListEntryIds: [], priorExcludedRoutes: [], extent, bounds: { maxCandidateTrialsPerTarget: 4, maxPlannerReruns: 8 },
  }
}

describe('Phase 2-C2.6-A8 kernel instrumentation (A7 unchanged + the Search start anchor)', () => {
  it('forwards every event to the A7 observer first, reports the first Search start once and requires both A7 observers', () => {
    const seen: SearchRuntimeEvent[] = []
    const starts: number[] = []
    let clock = 100
    const a7 = { onEvent: () => undefined, searchInstrumentationForTarget: () => ({ onSearchRuntime: (event: SearchRuntimeEvent) => { seen.push(event) }, onGogmaReservedRuntime: () => undefined }) }
    const wrapped = createPhase2C26A8KernelInstrumentation(a7, { now: () => (clock += 1), onSearchStarted: at => { starts.push(at); expect(seen.at(-1)?.type).toBe('section_started') } })
    const first = wrapped.searchInstrumentationForTarget?.('t' as TargetWeaponId, 0)
    const second = wrapped.searchInstrumentationForTarget?.('u' as TargetWeaponId, 1)
    expect(Object.keys(first ?? {}).sort()).toEqual(['onGogmaReservedRuntime', 'onSearchRuntime'])
    const events: SearchRuntimeEvent[] = [
      { type: 'section_started', section: 'search_runtime' }, { type: 'section_started', section: 'bonus_depth_read' },
      { type: 'section_completed', section: 'bonus_depth_read' }, { type: 'section_completed', section: 'search_runtime' },
    ]
    for (const event of events) first?.onSearchRuntime?.(event)
    second?.onSearchRuntime?.({ type: 'section_started', section: 'search_runtime' })
    expect(seen).toEqual([...events, { type: 'section_started', section: 'search_runtime' }])
    expect(starts).toEqual([101])
    expect(() => createPhase2C26A8KernelInstrumentation({ searchInstrumentationForTarget: () => ({ onSearchRuntime: () => undefined }) }, { now: () => 0, onSearchStarted: () => undefined })
      .searchInstrumentationForTarget?.('t' as TargetWeaponId, 0)).toThrow()
  })

  it('returns the identical kernel result with and without it, and its A3 stream rebuilds exactly one frontier interval per depth that ran the section', async () => {
    const extent = { maxNormalAdvance: 1, maxGogmaAdvance: 5, maxSkillAdvance: 2 }
    const plainBuilt = kernelScenario()
    const plain: PlannerAlternativeKernelResult = await runPlannerAlternativeKernel(kernelRequest(plainBuilt, extent), plainBuilt.dependencies, {})
    let clock = 0
    const phases: Phase2C26A3PhaseStartRecord[] = [], depths: Phase2C26A3DepthRecord[] = [], starts: number[] = []
    const progress = createPhase2C26A7KernelProgress({ now: () => (clock += 1),
      predictionCounts: () => ({ predictNormalArtian: 0, predictSkills: 0, resetBonuses: 0, keepBonuses: 0 }),
      emitLifecycle: () => undefined, emitSectionStarted: () => undefined, emitWorkSummary: () => undefined, emitSearchSummary: () => undefined,
      emitGogmaPhaseStarted: r => phases.push(r), emitGogmaDepth: r => depths.push(r) })
    const origin = progress.start()
    const instrumentation = createPhase2C26A8KernelInstrumentation(progress.instrumentation, { now: () => clock, onSearchStarted: at => starts.push(at) })
    const observedBuilt = kernelScenario()
    const observed = await runPlannerAlternativeKernel(kernelRequest(observedBuilt, extent), observedBuilt.dependencies, { instrumentation })
    expect(observed).toEqual(plain)
    expect(starts).toHaveLength(1)
    expect(progress.heartbeat().gogmaRuntime.contractViolations).toBe(0)
    const rebuilt = reconstructPhase2C26A8FrontierIntervals([...phases, ...depths], origin)
    expect(rebuilt.issues).toEqual([])
    const withFrontier = depths.filter(d => d.phaseMs.frontier_reduction_sort !== undefined)
    expect(withFrontier.length).toBeGreaterThan(0)
    expect(rebuilt.intervals).toHaveLength(withFrontier.length)
    expect(rebuilt.openFrontier).toBeNull()
    for (const [index, interval] of rebuilt.intervals.entries()) {
      expect(interval.endMs - interval.startMs).toBeCloseTo(withFrontier[index].phaseMs.frontier_reduction_sort as number, 9)
      expect(interval.endMs).toBeLessThanOrEqual(interval.nextBoundaryMs)
      expect(interval.generatedStates).toBe(withFrontier[index].counts.generatedStates)
    }
  }, SLOW)
})

// ---------------------------------------------------------------- interval reconstruction (synthetic A3 records)

const phaseRecord = (seq: number, elapsedMs: number, phase: string, depth = 1, streamIndex = 0, targetOrdinal = 0) =>
  ({ kind: 'gogma_phase_started', seq, elapsedMs, targetOrdinal, streamIndex, depth, phase })
const depthRecord = (seq: number, startedMs: number, completedMs: number, phaseMs: Record<string, number>, depth = 1, streamIndex = 0, targetOrdinal = 0) =>
  ({ kind: 'gogma_depth', seq, targetOrdinal, streamIndex, startGogmaCounter: 10, depth, exhausted: false,
    counts: { frontierStatesBefore: 1, legalPositionCount: 2, generatedStates: 40, frontierStatesAfter: 6, windowMemoEntries: 1 }, phaseMs, inclusiveMs: completedMs - startedMs, startedMs, completedMs })
/** One complete depth: window 10-11, support 11-12, generation 12-20, materialization 20-22, frontier 22-30, exhaustion 31-32. */
function oneDepth(seqStart: number, offset: number, depth = 1, streamIndex = 0) {
  const at = (ms: number) => offset + ms
  const phases = ['window_collection', 'support_evaluation', 'state_generation', 'solution_materialization', 'frontier_reduction_sort', 'exhaustion_scan']
  const startsAt = [10, 11, 12, 20, 22, 31], walls = [1, 1, 8, 2, 8, 1]
  return [
    ...phases.map((phase, index) => phaseRecord(seqStart + index, at(startsAt[index]), phase, depth, streamIndex)),
    depthRecord(seqStart + phases.length, at(9.5), at(32.5), Object.fromEntries(phases.map((phase, index) => [phase, walls[index]])), depth, streamIndex),
  ]
}

describe('Phase 2-C2.6-A8 frontier_reduction_sort interval reconstruction', () => {
  it('rebuilds [start, start + wall) on the Research clock, bounded by the next boundary, for every depth and stream', () => {
    const records = [...oneDepth(1, 0, 1, 0), ...oneDepth(8, 100, 2, 0), ...oneDepth(15, 200, 1, 1)]
    const rebuilt = reconstructPhase2C26A8FrontierIntervals(records, 1_000)
    expect(rebuilt.issues).toEqual([])
    expect(rebuilt.intervals.map(i => [i.streamIndex, i.depth, i.startMs, i.endMs, i.nextBoundaryMs])).toEqual([
      [0, 1, 1_022, 1_030, 1_031], [0, 2, 1_122, 1_130, 1_131], [1, 1, 1_222, 1_230, 1_231]])
    expect(rebuilt.intervals[0].generatedStates).toBe(40)
    expect(rebuilt.intervals[0].frontierStatesAfter).toBe(6)
    expect(rebuilt.gapToNextBoundaryMs).toBeCloseTo(3)
    expect(rebuilt.phaseStartRecords).toBe(18)
    expect(rebuilt.depthRecords).toBe(3)
    // Records may arrive in any order: the sequence decides.
    expect(reconstructPhase2C26A8FrontierIntervals([...records].reverse(), 1_000).intervals).toEqual(rebuilt.intervals)
    // An exhausted depth that ran no section, and a depth that ended without the frontier section, add no interval.
    const empty = reconstructPhase2C26A8FrontierIntervals([...oneDepth(1, 0), depthRecord(8, 50, 51, {}, 2)], 0)
    expect(empty.issues).toEqual([])
    expect(empty.intervals).toHaveLength(1)
    const noFrontier = [phaseRecord(1, 10, 'window_collection'), phaseRecord(2, 11, 'support_evaluation'), phaseRecord(3, 12, 'state_generation'),
      depthRecord(4, 9, 20, { window_collection: 1, support_evaluation: 1, state_generation: 8 })]
    expect(reconstructPhase2C26A8FrontierIntervals(noFrontier, 0)).toMatchObject({ valid: true, intervals: [] })
  })

  it('keeps an open frontier start (stream ended inside it) apart instead of guessing its end', () => {
    const records = [...oneDepth(1, 0), phaseRecord(8, 110, 'window_collection', 2), phaseRecord(9, 111, 'support_evaluation', 2), phaseRecord(10, 112, 'state_generation', 2),
      phaseRecord(11, 120, 'solution_materialization', 2), phaseRecord(12, 122, 'frontier_reduction_sort', 2)]
    const rebuilt = reconstructPhase2C26A8FrontierIntervals(records, 0)
    expect(rebuilt.valid).toBe(true)
    expect(rebuilt.intervals).toHaveLength(1)
    expect(rebuilt.openFrontier).toEqual({ targetOrdinal: 0, streamIndex: 0, depth: 2, startMs: 122 })
  })

  it('fails closed on phase order, duplicate start, overlap, negative duration, depth / stream mismatch, a missing boundary, a gap in the sequence or an unknown record', () => {
    const base = oneDepth(1, 0)
    const edit = (index: number, patch: Record<string, unknown>) => base.map((record, i) => (i === index ? { ...record, ...patch } : record))
    const invalid = (records: unknown[], origin = 0) => reconstructPhase2C26A8FrontierIntervals(records, origin)
    // Phase order: frontier recorded before solution_materialization.
    expect(invalid(edit(3, { phase: 'exhaustion_scan' })).valid).toBe(false)
    // Duplicate start of one phase in one depth.
    expect(invalid(edit(5, { phase: 'frontier_reduction_sort' })).valid).toBe(false)
    // A phase start before the previous one (negative duration).
    expect(invalid(edit(4, { elapsedMs: 19 })).valid).toBe(false)
    // A negative wall time.
    expect(invalid(base.map(r => (r.kind === 'gogma_depth' ? { ...r, phaseMs: { ...(r as { phaseMs: Record<string, number> }).phaseMs, frontier_reduction_sort: -1 } } : r))).valid).toBe(false)
    // An end past the next boundary (frontier 22 + 10 > exhaustion start 31).
    expect(invalid(base.map(r => (r.kind === 'gogma_depth' ? { ...r, phaseMs: { ...(r as { phaseMs: Record<string, number> }).phaseMs, frontier_reduction_sort: 10 } } : r))).valid).toBe(false)
    // A depth record of another depth / stream / Target closes the phases.
    expect(invalid(edit(6, { depth: 2 })).valid).toBe(false)
    expect(invalid(edit(6, { streamIndex: 3 })).valid).toBe(false)
    expect(invalid(edit(6, { targetOrdinal: 1 })).valid).toBe(false)
    // A phase of another depth starts before the depth record (missing boundary).
    expect(invalid([...base.slice(0, 5), phaseRecord(6, 40, 'window_collection', 2), ...base.slice(5).map(r => ({ ...r, seq: (r.seq as number) + 1 }))]).valid).toBe(false)
    // A started phase without its wall time, and a wall time without its start.
    expect(invalid(base.map(r => (r.kind === 'gogma_depth' ? { ...r, phaseMs: { window_collection: 1, support_evaluation: 1, state_generation: 8, solution_materialization: 2, exhaustion_scan: 1 } } : r))).valid).toBe(false)
    expect(invalid([...base.slice(0, 4), ...base.slice(5).map(r => ({ ...r, seq: (r.seq as number) - 1 }))]).valid).toBe(false)
    // A phase starting before its depth, and a depth completing before it starts.
    expect(invalid(base.map(r => (r.kind === 'gogma_depth' ? { ...r, startedMs: 10.5 } : r))).valid).toBe(false)
    expect(invalid(base.map(r => (r.kind === 'gogma_depth' ? { ...r, completedMs: 5 } : r))).valid).toBe(false)
    // Overlapping intervals of two depths.
    expect(invalid([...base, ...oneDepth(8, 5, 2)]).valid).toBe(false)
    // A gap in the sequence, an unknown record, an unknown phase, a non-finite origin.
    expect(invalid(base.map(r => ({ ...r, seq: (r.seq as number) + 1 }))).valid).toBe(false)
    expect(invalid([...base, { kind: 'heartbeat', seq: 8 }]).valid).toBe(false)
    expect(invalid(edit(2, { phase: 'state_sorting' })).valid).toBe(false)
    expect(invalid(base, Number.NaN).valid).toBe(false)
    expect(invalid(base).valid).toBe(true)
  })

  it('reads the kernel origin from the kernel_invoked record', () => {
    expect(phase2c26a8KernelOrigin({ events: [{ kind: 'lifecycle' }, { kind: 'kernel_invoked', originChildProcessMs: 1234.5 }] })).toBe(1234.5)
    expect(phase2c26a8KernelOrigin({ events: [] })).toBeNull()
    expect(phase2c26a8KernelOrigin(null)).toBeNull()
  })
})

// ---------------------------------------------------------------- registered functions, spans, frontier block

const sources: Record<string, string> = {
  'src/domain/search/bonusStream.ts': bonusStreamSource,
  'src/domain/models/hashing.ts': hashingSource,
  'src/domain/search/semanticKeys.ts': semanticKeysSource,
}
const lineOf = (text: string, pattern: RegExp) => text.split(/\r?\n/).findIndex(line => pattern.test(line)) + 1

describe('Phase 2-C2.6-A8 registered functions and the frontier block', () => {
  it('derives each span (nested functions included) from the source text and fails closed on a missing, duplicate or unterminated declaration', () => {
    const spans = derivePhase2C26A8FunctionSpans(sources)
    expect(spans.map(s => s.functionName)).toEqual(PHASE2C26A8_FUNCTION_REGISTRY.map(e => e.functionName))
    expect([...new Set(PHASE2C26A8_FUNCTION_REGISTRY.map(e => e.file))].sort()).toEqual([...PHASE2C26A8_REQUIRED_SOURCE_FILES].sort())
    const span = (name: string) => spans.find(s => s.functionName === name)!
    expect(span('generateReservedDepth').startLine).toBe(lineOf(bonusStreamSource, /^ {2}async function generateReservedDepth\(/))
    expect(span('compareReservedRepresentative').startLine).toBe(lineOf(bonusStreamSource, /^ {2}function compareReservedRepresentative\(/))
    expect(span('compareReservedFrontier').startLine).toBe(lineOf(bonusStreamSource, /^ {2}function compareReservedFrontier\(/))
    expect(span('stableStringify').startLine).toBe(lineOf(hashingSource, /^export function stableStringify\(/))
    expect(span('serializeStable').startLine).toBe(lineOf(hashingSource, /^function serializeStable\(/))
    // The nested closures end at their own indentation, not at the enclosing function's end.
    expect(span('compareReservedRepresentative').endLine).toBeLessThan(span('compareReservedFrontier').startLine)
    expect(span('generateReservedDepth').endLine).toBeGreaterThan(lineOf(bonusStreamSource, /\.sort\(compareReservedFrontier\)/))
    // The ordinary stream's representative rule is another function and never matches the held-aware one.
    expect(lineOf(bonusStreamSource, /^function compareRepresentative\(/)).toBeGreaterThan(0)
    // The array / object map callbacks of serializeStable lie inside its span.
    expect(lineOf(hashingSource, /serializeStable\(entry, ancestors\)/)).toBeGreaterThan(span('serializeStable').startLine)
    expect(lineOf(hashingSource, /serializeStable\(entry, ancestors\)/)).toBeLessThan(span('serializeStable').endLine)
    for (const s of spans) expect(s.endLine).toBeGreaterThan(s.startLine)
    expect(() => derivePhase2C26A8FunctionSpans({ ...sources, 'src/domain/models/hashing.ts': '' })).toThrow()
    expect(() => derivePhase2C26A8FunctionSpans({ ...sources, 'src/domain/search/semanticKeys.ts': `${semanticKeysSource}\nexport function compareStableKeys() {\n}\n` })).toThrow()
    expect(() => derivePhase2C26A8FunctionSpans({ 'src/x.ts': '  function a() {\n    return 1\n}' }, [{ file: 'src/x.ts', functionName: 'a' }])).toThrow()
  })

  it('derives the frontier block (reduction loop, key, Map, representative, spread + sort) between the section boundaries', () => {
    const block = derivePhase2C26A8FrontierBlock(bonusStreamSource)
    const texts = block.lines.map(l => l.text)
    expect(texts).toEqual(expect.arrayContaining(['const byKey = new Map<string, ReservedBonusState>()', 'const current = byKey.get(key)',
      'set.frontier = [...byKey.values()].sort(compareReservedFrontier)']))
    expect(texts.some(t => t.includes('compareReservedRepresentative(state, current)'))).toBe(true)
    expect(texts.some(t => t.startsWith('const key = `${state.position}'))).toBe(true)
    expect(block.lines.at(-1)?.text).toBe("runtime.phase('phase_completed', 'frontier_reduction_sort')")
    expect(block.startLine).toBe(lineOf(bonusStreamSource, /runtime\.phase\('phase_started', 'frontier_reduction_sort'\)/) + 1)
    expect(() => derivePhase2C26A8FrontierBlock('nothing here')).toThrow()
    expect(() => derivePhase2C26A8FrontierBlock(`${bonusStreamSource}\n    runtime.phase('phase_started', 'frontier_reduction_sort')\n`)).toThrow()
  })
})

// ---------------------------------------------------------------- frames and the classification

/** A script table over fake scripts: scriptId `s:<file>` with an identity source map (generated line n -> original n + 1). */
const fakeScripts: Phase2C26A5ScriptTable = {
  urlOf: id => (id.startsWith('s:') ? `D:/repo/${id.slice(2)}` : null),
  originalLine: (id, lineNumber) => (id.startsWith('s:src/') && lineNumber >= 0 ? lineNumber + 1 : null),
}
const spans = derivePhase2C26A8FunctionSpans(sources)
const span = (name: string) => spans.find(s => s.functionName === name)!
const frame = (functionName: string, file: string, originalLine = 1, url = ''): CpuProfileCallFrame =>
  ({ functionName, scriptId: file === '' ? '0' : `s:${file}`, url, lineNumber: originalLine - 1, columnNumber: 0 })
const BS = 'src/domain/search/bonusStream.ts', HS = 'src/domain/models/hashing.ts', SK = 'src/domain/search/semanticKeys.ts'
const F = {
  root: frame('(root)', ''),
  gc: frame('(garbage collector)', ''),
  program: frame('(program)', ''),
  owner: frame('generateReservedDepth', BS, span('generateReservedDepth').startLine),
  representative: frame('compareReservedRepresentative', BS, span('compareReservedRepresentative').startLine),
  frontierComparator: frame('compareReservedFrontier', BS, span('compareReservedFrontier').startLine),
  stringify: frame('stableStringify', HS, span('stableStringify').startLine),
  serialize: frame('serializeStable', HS, span('serializeStable').startLine),
  serializeCallback: frame('', HS, span('serializeStable').startLine + 24),
  keyCompare: frame('compareStableKeys', SK, span('compareStableKeys').startLine),
  ownerCallback: frame('', BS, span('generateReservedDepth').startLine + 24),
  gogmaKeep: frame('gogmaKeep', 'src/domain/search/searchPredictionSupport.ts', 41),
  nativeSort: frame('sort', ''),
  nativeWrite: frame('writeString', ''),
  nodeInternal: frame('processImmediate', '', 1, 'node:internal/timers'),
  viteGetter: frame('get', 'node_modules/vite/dist/node/module-runner.js'),
  viteUnmapped: frame('', HS, 0),
  boundaryArrow: frame('', BS, span('generateReservedDepth').endLine + 20),
  harnessObserve: frame('observe', 'src/benchmarks/plannerGlobalPhase2C26A3.ts', 374),
  harnessRoot: frame('runPhase2C26AKernel', 'src/benchmarks/plannerGlobalPhase2C26A.ts', 10),
  otherRepo: frame('predictKeep', BS, 482),
}
const resolved = (callFrames: CpuProfileCallFrame[]): Phase2C26A8Frame[] => callFrames.map(f => resolvePhase2C26A8Frame(f, fakeScripts, spans))
const classify = (callFrames: CpuProfileCallFrame[]) => classifyPhase2C26A8Stack(resolved(callFrames))

describe('Phase 2-C2.6-A8 frame resolution and stack classification', () => {
  it('resolves registered functions by name, serializeStable callbacks by span, and never an owner callback or the ordinary stream as a registered frame', () => {
    expect(resolved([F.owner])[0]).toMatchObject({ role: 'reduction_owner', byName: true, kind: 'repository', originalLine: span('generateReservedDepth').startLine })
    expect(resolved([F.serializeCallback])[0]).toMatchObject({ role: 'serialization', byName: false })
    expect(resolved([F.ownerCallback])[0].role).toBeNull()
    expect(resolved([frame('compareRepresentative', BS, 336)])[0].role).toBeNull()
    expect(resolved([F.viteGetter])[0].kind).toBe('vite_module_runner')
    expect(resolved([F.viteUnmapped])[0].kind).toBe('vite_ssr_unmapped')
    expect(resolved([F.nativeSort])[0].kind).toBe('native')
    expect(resolved([F.nodeInternal])[0].kind).toBe('node_internal')
    expect(resolved([F.harnessObserve])[0].kind).toBe('research_harness')
    expect(resolved([F.gc])[0].kind).toBe('gc')
  })

  it('applies the registered priority and never counts a serialization without the representative ancestor as representative serialization', () => {
    const cases: [CpuProfileCallFrame[], Phase2C26A8Category, string | null][] = [
      [[F.root, F.gc], 'gc', null],
      [[F.root, F.owner, F.boundaryArrow, F.harnessObserve, F.nativeWrite], 'other_frontier', 'observer_overhead'],
      [[F.root, F.owner, F.representative, F.stringify, F.serialize, F.serializeCallback, F.serialize], 'representative_stable_serialization', null],
      [[F.root, F.owner, F.representative, F.serializeCallback], 'representative_stable_serialization', null],
      [[F.root, F.owner, F.representative, F.stringify, F.nativeWrite], 'representative_stable_serialization', null],
      [[F.root, F.owner, F.frontierComparator], 'frontier_sort', null],
      [[F.root, F.owner, F.frontierComparator, F.keyCompare], 'frontier_sort', null],
      [[F.root, F.owner, F.frontierComparator, F.viteUnmapped], 'frontier_sort', null],
      [[F.root, F.owner, F.nativeSort], 'frontier_sort', null],
      [[F.root, F.owner, F.representative], 'representative_compare_or_inlined', null],
      [[F.root, F.owner, F.representative, F.keyCompare], 'representative_compare_or_inlined', null],
      [[F.root, F.owner, F.representative, F.viteGetter], 'representative_compare_or_inlined', null],
      [[F.root, F.owner], 'reduction_loop_or_inlined', null],
      [[F.root, F.harnessRoot, F.owner], 'reduction_loop_or_inlined', null],
      [[F.root, F.owner, F.nativeWrite], 'reduction_loop_or_inlined', null],
      // stableStringify from another use (support evaluation) is never representative serialization.
      [[F.root, F.owner, F.gogmaKeep, F.stringify, F.serialize], 'other_frontier', 'serialization_without_representative'],
      // A serialization frame whose representative frame was lost to inlining is not attributed either.
      [[F.root, F.owner, F.serialize, F.serializeCallback], 'other_frontier', 'serialization_without_representative'],
      [[F.root, F.program], 'other_frontier', 'program'],
      [[F.root, F.owner, F.ownerCallback], 'other_frontier', 'other_repository'],
      [[F.root, F.owner, F.otherRepo], 'other_frontier', 'other_repository'],
      [[F.root, F.owner, F.viteGetter], 'other_frontier', 'vite_loader'],
      [[F.root, F.nodeInternal], 'other_frontier', 'native_or_internal'],
      [[F.root, F.owner, F.nodeInternal], 'other_frontier', 'native_or_internal'],
    ]
    for (const [stack, category, reason] of cases) {
      const label = stack.map(f => f.functionName || '(anon)').join('>')
      expect(classify(stack), label).toEqual({ category, otherReason: reason })
    }
  })
})

// ---------------------------------------------------------------- one profile

type ProfileNode = { id: number; callFrame: CpuProfileCallFrame; children: number[]; positionTicks?: { line: number; ticks: number }[] }
/** Builds a CPU profile whose samples are the given stacks at the given profile-clock times (us). */
function buildProfile(samples: { atUs: number; stack: CpuProfileCallFrame[] }[], startUs: number, endUs: number): CpuProfile {
  const nodes: ProfileNode[] = [{ id: 1, callFrame: F.root, children: [] }]
  const leafOf = (stack: CpuProfileCallFrame[]) => {
    let node = nodes[0]
    for (const f of stack.slice(1)) {
      let child = node.children.map(id => nodes.find(n => n.id === id)!).find(n => n.callFrame === f)
      if (!child) { child = { id: nodes.length + 1, callFrame: f, children: [] }; nodes.push(child); node.children.push(child.id) }
      node = child
    }
    return node.id
  }
  let previous = startUs
  const ids: number[] = [], deltas: number[] = []
  for (const sample of samples) { ids.push(leafOf(sample.stack)); deltas.push(sample.atUs - previous); previous = sample.atUs }
  return { nodes, startTime: startUs, endTime: endUs, samples: ids, timeDeltas: deltas }
}
const OFFSET_MS = 1_000_000 // hrtime ms - performance.now() ms
const pair = (perfMs: number): Phase2C26A5ClockPair => ({ perfMs, hrMs: perfMs + OFFSET_MS, precisionMs: 0.01 })
/** A profile window from Research time 100 ms to 200 ms. */
const window = { startPre: pair(99.9), startPost: pair(100.2), stopPre: pair(199.8), stopPost: pair(200.3) }
const us = (researchMs: number) => (researchMs + OFFSET_MS) * 1000
const block = derivePhase2C26A8FrontierBlock(bonusStreamSource)

function reconstructionOf(intervals: [number, number][]): Phase2C26A8IntervalReconstruction {
  return { valid: true, issues: [], openFrontier: null, phaseStartRecords: 0, depthRecords: 0, gapToNextBoundaryMs: 0,
    intervals: intervals.map(([startMs, endMs], index) => ({ targetOrdinal: 0, streamIndex: 0, depth: index + 1, startMs, endMs, nextBoundaryMs: endMs + 1,
      frontierStatesBefore: 3, generatedStates: 100, frontierStatesAfter: 10 })) }
}

describe('Phase 2-C2.6-A8 profile analysis', () => {
  const stacks = {
    serialization: [F.root, F.owner, F.representative, F.stringify, F.serialize, F.serializeCallback],
    representative: [F.root, F.owner, F.representative, F.keyCompare],
    sort: [F.root, F.owner, F.frontierComparator],
    loop: [F.root, F.owner],
    gc: [F.root, F.gc],
    generation: [F.root, F.owner, F.otherRepo],
  }
  const profileSamples = [
    { atUs: us(105), stack: stacks.generation }, // outside
    { atUs: us(110), stack: stacks.loop }, // start inclusive
    { atUs: us(112), stack: stacks.serialization },
    { atUs: us(115), stack: stacks.serialization },
    { atUs: us(118), stack: stacks.representative },
    { atUs: us(121), stack: stacks.gc },
    { atUs: us(129.999), stack: stacks.sort },
    { atUs: us(130), stack: stacks.representative }, // end exclusive -> outside (a comparator outside)
    { atUs: us(140), stack: stacks.generation }, // outside
    { atUs: us(150), stack: stacks.loop },
    { atUs: us(170), stack: stacks.serialization },
    { atUs: us(195), stack: stacks.generation }, // outside
  ]
  const profile = buildProfile(profileSamples, us(100), us(200))
  const ownerNode = (profile.nodes as ProfileNode[]).find(n => n.callFrame === F.owner)!
  const byKeyLine = block.lines.find(l => l.text === 'const current = byKey.get(key)')!.line
  // positionTicks lines are generated 1-based lines; the fake source map maps generated line n to original n.
  ownerNode.positionTicks = [{ line: byKeyLine, ticks: 3 }, { line: span('generateReservedDepth').startLine, ticks: 1 }, { line: span('generateReservedDepth').startLine + 30, ticks: 2 }]
  const intervals = reconstructionOf([[110, 130], [150, 190]])

  it('validates the untrusted profile structure (positionTicks included)', () => {
    expect(validatePhase2C26A8CpuProfile(profile)).toBe(profile)
    const broken = structuredClone(profile) as CpuProfile & { nodes: ProfileNode[] }
    broken.nodes[1].positionTicks = [{ line: 'x' as unknown as number, ticks: 1 }]
    expect(() => validatePhase2C26A8CpuProfile(broken)).toThrow()
    expect(() => validatePhase2C26A8CpuProfile({ ...profile, samples: [...profile.samples, 1] })).toThrow()
  })

  it('classifies only the samples inside [start, end) of a rebuilt interval and counts the work of the intervals in the window', () => {
    const result = analyzePhase2C26A8Profile(profile, fakeScripts, spans, sources, block, window, intervals)
    expect(result.alignment.valid).toBe(true)
    expect(result.frontierSamples).toBe(8)
    expect(result.windowSamples).toBe(profileSamples.length)
    const count = (category: Phase2C26A8Category) => result.categories.find(c => c.category === category)?.samples
    expect(count('representative_stable_serialization')).toBe(3)
    expect(count('representative_compare_or_inlined')).toBe(1)
    expect(count('frontier_sort')).toBe(1)
    expect(count('reduction_loop_or_inlined')).toBe(2)
    expect(count('gc')).toBe(1)
    expect(count('other_frontier')).toBe(0)
    expect(result.categories.reduce((sum, c) => sum + c.share, 0)).toBeCloseTo(1)
    expect(result.comparatorSamples).toEqual({ inside: 5, outside: 1, outsideShare: 1 / 6 })
    expect(result.intervalsInProfile).toBe(2)
    expect(result.intervalMsInProfile).toBeCloseTo(60)
    expect(result.workInWindow).toEqual({ intervals: 2, partialIntervals: 0, generatedStates: 200, frontierStatesAfter: 20, representativeCompareCalls: 180 })
    expect(result.registeredLineMismatches).toEqual([])
    expect(result.reductionLeafCheck).toEqual({ inIntervalLeafSamples: 2, frontierBlockLineTicks: 3, functionStartLineTicks: 1 })
    const owner = result.lineTicks.find(l => l.registered.endsWith('#generateReservedDepth'))!
    expect(owner.totalSelfTicks).toBe(6)
    expect(owner.inSpan.find(l => l.line === byKeyLine)).toEqual({ line: byKeyLine, text: 'const current = byKey.get(key)', ticks: 3, inFrontierBlock: true })
    expect(result.registeredInclusive.find(r => r.registered.endsWith('#compareReservedRepresentative'))?.samples).toBe(4)
    expect(result.gcSamples).toBe(1)
    expect(result.repositoryAttributedSamples).toBe(7)
  })

  it('clips an interval to the profile window and counts it as partial', () => {
    const result = analyzePhase2C26A8Profile(profile, fakeScripts, spans, sources, block, window, reconstructionOf([[90, 111]]))
    expect(result.intervalsInProfile).toBe(1)
    expect(result.workInWindow.partialIntervals).toBe(1)
    // Samples at 105 and 110 fall inside [90, 111) and the window.
    expect(result.frontierSamples).toBe(2)
  })

  it('maps no sample when the clocks are not aligned, the reconstruction is invalid, or an open interval starts inside the window', () => {
    const misaligned = analyzePhase2C26A8Profile(profile, fakeScripts, spans, sources, block, { ...window, stopPost: { ...pair(200.3), hrMs: pair(200.3).hrMs + 5 } }, intervals)
    expect(misaligned.alignment.valid).toBe(false)
    expect(misaligned.frontierSamples).toBe(0)
    const invalid = analyzePhase2C26A8Profile(profile, fakeScripts, spans, sources, block, window, { ...intervals, valid: false, issues: ['x'] })
    expect(invalid.intervalValidation.valid).toBe(false)
    expect(invalid.frontierSamples).toBe(0)
    const open = analyzePhase2C26A8Profile(profile, fakeScripts, spans, sources, block, window, { ...intervals, openFrontier: { targetOrdinal: 0, streamIndex: 0, depth: 9, startMs: 195 } })
    expect(open.intervalValidation.valid).toBe(false)
    expect(open.frontierSamples).toBe(0)
    const openAfter = analyzePhase2C26A8Profile(profile, fakeScripts, spans, sources, block, window, { ...intervals, openFrontier: { targetOrdinal: 0, streamIndex: 0, depth: 9, startMs: 500 } })
    expect(openAfter.intervalValidation.valid).toBe(true)
  })

  it('reports a named registered frame that does not resolve to its declaration line', () => {
    const shifted = buildProfile([{ atUs: us(112), stack: [F.root, frame('generateReservedDepth', BS, span('generateReservedDepth').startLine + 1)] }], us(100), us(200))
    const result = analyzePhase2C26A8Profile(shifted, fakeScripts, spans, sources, block, window, intervals)
    expect(result.registeredLineMismatches).toHaveLength(1)
    expect(phase2c26a8DecisionRow('x', result).invalidReasons.some(r => r.startsWith('registered frame line mismatch'))).toBe(true)
  })
})

// ---------------------------------------------------------------- decision rule

describe('Phase 2-C2.6-A8 pre-registered decision rule', () => {
  const analysisWith = (n: number, shares: Partial<Record<Phase2C26A8Category, number>>, outsideShare = 0, negativeDeltas = 0): Phase2C26A8ProfileAnalysis => ({
    alignment: { valid: true, issues: [], negativeDeltas } as never, intervalValidation: { valid: true, issues: [], count: 1 },
    allProfileSamples: n * 2, windowSamples: n * 2, observedIntervalUs: { median: 10_000, mean: 10_000 }, intervalsInProfile: 1, intervalMsInProfile: 1, intervalShareOfProfile: 0.5,
    frontierSamples: n, frontierSampleShare: 0.5,
    categories: PHASE2C26A8_CATEGORIES.map(category => ({ category, samples: Math.round((shares[category] ?? 0) * n), share: shares[category] ?? 0 })),
    otherReasons: [], leafKinds: [], categoryLeafKinds: {} as never, repositoryAttributedSamples: n, unattributedOrNativeSamples: 0, gcSamples: 0, topLeaves: [], topStacks: [],
    registeredInclusive: [], comparatorSamples: { inside: 100, outside: Math.round(100 * outsideShare), outsideShare }, boundarySamples: 0, registeredLineMismatches: [], lineTicks: [],
    reductionLeafCheck: { inIntervalLeafSamples: 0, frontierBlockLineTicks: 0, functionStartLineTicks: 0 },
    workInWindow: { intervals: 1, partialIntervals: 0, generatedStates: 0, frontierStatesAfter: 0, representativeCompareCalls: 0 },
  })
  const decide = (rows: [number, Partial<Record<Phase2C26A8Category, number>>][]) => {
    const built = rows.map(([n, shares], index) => ({ id: `p${index}`, analysis: analysisWith(n, shares) }))
    const decisionRows = built.map(row => phase2c26a8DecisionRow(row.id, row.analysis))
    const pooled = phase2c26a8PooledShares(built.map((row, index) => ({ valid: decisionRows[index].valid, analysis: row.analysis })))
    return phase2c26a8Decision(decisionRows, pooled)
  }
  const serialization = { representative_stable_serialization: 0.5, reduction_loop_or_inlined: 0.3, representative_compare_or_inlined: 0.1, frontier_sort: 0.05, gc: 0.05 }
  const loop = { representative_stable_serialization: 0.3, reduction_loop_or_inlined: 0.5, representative_compare_or_inlined: 0.1, frontier_sort: 0.05, gc: 0.05 }
  const sort = { frontier_sort: 0.4, reduction_loop_or_inlined: 0.3, representative_stable_serialization: 0.3 }
  const compare = { representative_compare_or_inlined: 0.4, reduction_loop_or_inlined: 0.3, representative_stable_serialization: 0.3 }

  it('decides S / T / R / C / M with majority 2 of 3, a unique largest category and a 0.25 floor', () => {
    expect(PHASE2C26A8_DECISION_RULE).toMatchObject({ registeredPrimaryCount: 3, majority: 2, minimumFrontierSamples: 5_000, dominantShareThreshold: 0.25, maxComparatorOutsideShare: 0.01,
      maxNegativeTimeDeltas: 0 })
    const s = decide([[6_000, serialization], [6_000, serialization], [6_000, loop]])
    expect(s.case).toBe('S_stable_serialization_dominant')
    expect(s.category).toBe('representative_stable_serialization')
    expect(s.primariesAtThreshold.representative_stable_serialization).toEqual(['p0', 'p1'])
    expect(decide([[6_000, sort], [6_000, sort], [6_000, serialization]]).case).toBe('T_frontier_sort_dominant')
    expect(decide([[6_000, loop], [6_000, serialization], [6_000, loop]]).case).toBe('R_reduction_loop_dominant_unresolved')
    expect(decide([[6_000, compare], [6_000, compare], [6_000, loop]]).case).toBe('C_representative_compare_dominant')
    // Disagreement across primaries.
    expect(decide([[6_000, serialization], [6_000, loop], [6_000, sort]]).case).toBe('M_mixed_or_insufficient')
    // gc / other largest never names a code hotspot.
    const gcHeavy = { gc: 0.6, reduction_loop_or_inlined: 0.4 }
    expect(decide([[6_000, gcHeavy], [6_000, gcHeavy], [6_000, loop]]).case).toBe('M_mixed_or_insufficient')
    const otherHeavy = { other_frontier: 0.5, representative_stable_serialization: 0.5 - 1e-9 }
    expect(decide([[6_000, otherHeavy], [6_000, otherHeavy], [6_000, serialization]]).case).toBe('M_mixed_or_insufficient')
    // A tie for the largest category, and a largest share below 0.25.
    const tie = { representative_stable_serialization: 0.4, reduction_loop_or_inlined: 0.4, gc: 0.2 }
    expect(decide([[6_000, tie], [6_000, tie], [6_000, loop]]).case).toBe('M_mixed_or_insufficient')
    const flat = { representative_stable_serialization: 0.24, reduction_loop_or_inlined: 0.2, representative_compare_or_inlined: 0.2, frontier_sort: 0.2, gc: 0.16 }
    expect(decide([[6_000, flat], [6_000, flat], [6_000, flat]]).case).toBe('M_mixed_or_insufficient')
  })

  it('fails closed on too few samples or an invalid primary, and never mixes a fourth (diagnostic) row into the registered three', () => {
    const insufficient = decide([[4_999, serialization], [5_000, serialization], [100, serialization]])
    expect(insufficient.case).toBe('M_mixed_or_insufficient')
    expect(insufficient.validPrimaries).toEqual(['p1'])
    const withOneInvalid = decide([[6_000, serialization], [6_000, serialization], [100, loop]])
    expect(withOneInvalid.case).toBe('S_stable_serialization_dominant')
    expect(withOneInvalid.invalidPrimaries.map(p => p.orientationId)).toEqual(['p2'])
    expect(decide([[6_000, serialization], [6_000, serialization], [6_000, serialization], [6_000, serialization]]).case).toBe('M_mixed_or_insufficient')
    const leaking = phase2c26a8DecisionRow('leak', analysisWith(6_000, serialization, 0.02))
    expect(leaking.valid).toBe(false)
    expect(phase2c26a8DecisionRow('none', null).valid).toBe(false)
    expect(phase2c26a8DecisionRow('capture', analysisWith(6_000, serialization), ['profile SHA-256 differs from the child record']).valid).toBe(false)
    expect(phase2c26a8DecisionRow('ok', analysisWith(6_000, serialization, 0.01)).valid).toBe(true)
  })
})

describe('Phase 2-C2.6-A8 negative timeDelta fail-closed', () => {
  const analysisWith = (n: number, shares: Partial<Record<Phase2C26A8Category, number>>, negativeDeltas: unknown = 0): Phase2C26A8ProfileAnalysis => ({
    alignment: { valid: true, issues: [], negativeDeltas } as never, intervalValidation: { valid: true, issues: [], count: 1 },
    allProfileSamples: n * 2, windowSamples: n * 2, observedIntervalUs: { median: 10_000, mean: 10_000 }, intervalsInProfile: 1, intervalMsInProfile: 1, intervalShareOfProfile: 0.5,
    frontierSamples: n, frontierSampleShare: 0.5,
    categories: PHASE2C26A8_CATEGORIES.map(category => ({ category, samples: Math.round((shares[category] ?? 0) * n), share: shares[category] ?? 0 })),
    otherReasons: [], leafKinds: [], categoryLeafKinds: {} as never, repositoryAttributedSamples: n, unattributedOrNativeSamples: 0, gcSamples: 0, topLeaves: [], topStacks: [],
    registeredInclusive: [], comparatorSamples: { inside: 100, outside: 0, outsideShare: 0 }, boundarySamples: 0, registeredLineMismatches: [], lineTicks: [],
    reductionLeafCheck: { inIntervalLeafSamples: 0, frontierBlockLineTicks: 0, functionStartLineTicks: 0 },
    workInWindow: { intervals: 1, partialIntervals: 0, generatedStates: 0, frontierStatesAfter: 0, representativeCompareCalls: 0 },
  })
  const serialization = { representative_stable_serialization: 0.6, reduction_loop_or_inlined: 0.3, gc: 0.1 }
  const loop = { representative_stable_serialization: 0.3, reduction_loop_or_inlined: 0.6, gc: 0.1 }
  const decideRows = (rows: [Partial<Record<Phase2C26A8Category, number>>, number][]) => {
    const built = rows.map(([shares, negative], index) => ({ id: `p${index}`, analysis: analysisWith(6_000, shares, negative) }))
    const decisionRows = built.map(row => phase2c26a8DecisionRow(row.id, row.analysis))
    return phase2c26a8Decision(decisionRows, phase2c26a8PooledShares(built.map((row, index) => ({ valid: decisionRows[index].valid, analysis: row.analysis }))))
  }

  it('keeps a profile with no negative timeDelta valid and invalidates one with any (or with no count), even when the A5 alignment is valid', () => {
    const ok = phase2c26a8DecisionRow('ok', analysisWith(6_000, serialization, 0))
    expect(ok.valid).toBe(true)
    expect(ok.negativeTimeDeltas).toBe(0)
    const one = phase2c26a8DecisionRow('one', analysisWith(6_000, serialization, 1))
    expect(one.valid).toBe(false)
    expect(one.negativeTimeDeltas).toBe(1)
    expect(one.invalidReasons).toContain('CPU profile contains negative timeDeltas: 1')
    expect(phase2c26a8DecisionRow('many', analysisWith(6_000, serialization, 3)).invalidReasons).toContain('CPU profile contains negative timeDeltas: 3')
    expect(phase2c26a8DecisionRow('missing', analysisWith(6_000, serialization, null)).valid).toBe(false)
    expect(PHASE2C26A8_DECISION_RULE.validity.some(text => text.includes('negativeDeltas = 0'))).toBe(true)
  })

  it('invalidates a real profile whose cumulative sample times run backwards, although A5 accepts its alignment', () => {
    const stack = [F.root, F.owner, F.representative, F.stringify, F.serialize]
    const samples = Array.from({ length: 5_200 }, (_, index) => ({ atUs: us(110 + index * 0.01), stack }))
    const profile = buildProfile(samples, us(100), us(200))
    const clean = analyzePhase2C26A8Profile(profile, fakeScripts, spans, sources, block, window, reconstructionOf([[105, 190]]))
    expect(clean.alignment.negativeDeltas).toBe(0)
    expect(phase2c26a8DecisionRow('clean', clean).valid).toBe(true)
    const backwards = structuredClone(profile)
    backwards.timeDeltas[10] = -5
    backwards.timeDeltas[11] += 5
    const analyzed = analyzePhase2C26A8Profile(backwards, fakeScripts, spans, sources, block, window, reconstructionOf([[105, 190]]))
    expect(analyzed.alignment.valid).toBe(true)
    expect(analyzed.alignment.negativeDeltas).toBe(1)
    const row = phase2c26a8DecisionRow('backwards', analyzed)
    expect(row.valid).toBe(false)
    expect(row.invalidReasons).toContain('CPU profile contains negative timeDeltas: 1')
  })

  it('never counts a negative-delta profile as a majority vote, decides with the valid primaries only, and falls to M below two', () => {
    // 3 / 3 valid, all serialization: S.
    expect(decideRows([[serialization, 0], [serialization, 0], [serialization, 0]]).case).toBe('S_stable_serialization_dominant')
    // The serialization vote of a negative-delta profile is not counted: 1 valid S + 1 valid R -> M.
    const excluded = decideRows([[serialization, 0], [serialization, 1], [loop, 0]])
    expect(excluded.case).toBe('M_mixed_or_insufficient')
    expect(excluded.validPrimaries).toEqual(['p0', 'p2'])
    expect(excluded.invalidPrimaries).toEqual([{ orientationId: 'p1', reasons: ['CPU profile contains negative timeDeltas: 1'] }])
    // 2 / 3 valid and both satisfy S: S (majority 2 of the registered 3 is unchanged).
    const twoValid = decideRows([[serialization, 0], [serialization, 0], [serialization, 2]])
    expect(twoValid.case).toBe('S_stable_serialization_dominant')
    expect(twoValid.primariesAtThreshold.representative_stable_serialization).toEqual(['p0', 'p1'])
    expect(decideRows([[loop, 1], [loop, 0], [loop, 0]]).case).toBe('R_reduction_loop_dominant_unresolved')
    // 1 / 3 or 0 / 3 valid: M.
    const oneValid = decideRows([[serialization, 0], [serialization, 1], [serialization, 1]])
    expect(oneValid.case).toBe('M_mixed_or_insufficient')
    expect(oneValid.reason).toBe('1 valid primaries (< 2)')
    expect(decideRows([[serialization, 1], [serialization, 1], [serialization, 1]]).case).toBe('M_mixed_or_insufficient')
    expect(PHASE2C26A8_DECISION_RULE.registeredPrimaryCount).toBe(3)
    expect(PHASE2C26A8_DECISION_RULE.majority).toBe(2)
  })
})

// ---------------------------------------------------------------- semantic parity with the A7 formal raw run

describe('Phase 2-C2.6-A8 semantic common-prefix parity', () => {
  const depth = (seq: number, d: number, generatedStates: number) => ({ kind: 'gogma_depth', seq, targetOrdinal: 0, streamIndex: 0, startGogmaCounter: 5, depth: d, exhausted: false,
    counts: { frontierStatesBefore: 1, legalPositionCount: 3, generatedStates, frontierStatesAfter: 2, windowMemoEntries: 1 }, phaseMs: { frontier_reduction_sort: seq }, inclusiveMs: seq,
    startedMs: seq, completedMs: seq + 1 })
  const phase = (seq: number) => ({ kind: 'gogma_phase_started', seq, elapsedMs: seq, targetOrdinal: 0, streamIndex: 0, depth: 1, phase: 'window_collection' })

  it('compares the held-aware depth records on their common prefix, ignoring times and phase records', () => {
    const a7 = { gogmaRuntime: [phase(1), depth(2, 1, 10), depth(3, 2, 20), depth(4, 3, 30)] }
    const a8 = { gogmaRuntime: [depth(9, 1, 10), depth(10, 2, 20)] }
    const same = comparePhase2C26A8DepthPrefix(a7, a8)
    expect(same).toMatchObject({ valid: true, beforeDepths: 3, afterDepths: 2, commonDepths: 2, commonGeneratedStates: 30, commonFrontierStatesAfter: 4 })
    const differing = comparePhase2C26A8DepthPrefix(a7, { gogmaRuntime: [depth(1, 1, 10), depth(2, 2, 21)] })
    expect(differing.valid).toBe(false)
    expect(differing.firstMismatch?.index).toBe(1)
    expect(comparePhase2C26A8DepthPrefix(a7, { gogmaRuntime: [] }).valid).toBe(false)
    expect(comparePhase2C26A8DepthPrefix(null, a8).valid).toBe(false)
  })

  it('reuses the A6 completed-work prefix: identity and counts must match, times need not', () => {
    const work = (seq: number, raw: number, startedMs: number) => ({ kind: 'search_work_summary', seq, targetOrdinal: 0, section: 'bonus_depth_work', work: { channel: 0, depth: seq },
      counts: { rawSolutions: raw, idealSolutions: 0 }, phaseMs: { bonus_depth_read: startedMs }, startedMs, completedMs: startedMs + 1 })
    const prefix: Phase2C26A6WorkPrefix = comparePhase2C26A6WorkPrefix({ runtime: [work(1, 5, 0), work(2, 6, 1)] }, { runtime: [work(1, 5, 10), work(2, 6, 99), work(3, 7, 200)] })
    expect(prefix.valid).toBe(true)
    expect(prefix.commonWorks).toBe(2)
    expect(comparePhase2C26A6WorkPrefix({ runtime: [work(1, 5, 0)] }, { runtime: [work(1, 4, 0)] }).valid).toBe(false)
  })
})

// ---------------------------------------------------------------- formal series validation

describe('Phase 2-C2.6-A8 formal series validation', () => {
  it('refuses a raw run that is not a completed, committed, non-smoke run with a probe, the registered profiler, the A7 selection and A7 semantic parity', () => {
    const all = authorities()
    const a7 = a7Authority()
    const validation = validatePhase2C26A8FormalRun({ status: 'probe_failed', environment: { smoke: { orientationIds: ['c6-p1'] }, searchInstrumentation: PHASE2C26A8_SEARCH_INSTRUMENTATION } },
      { ...all, a7 }, { ...shas, a7: a7Sha }, { productionChangeSinceA7: ['src/domain/search/bonusStream.ts'], a7RawShaMatches: false, workPrefix: [], depthPrefix: [] })
    expect(validation.valid).toBe(false)
    expect(validation.failures).toEqual(expect.arrayContaining([
      'A4 formal-run contract: raw status is probe_failed', 'A4 formal-run contract: a smoke run is never formal', 'the profiler probe did not succeed',
      'the profiler window / sampling interval is not the registered one', 'the diagnostic did not run on the rule\'s representative',
      'the runner did not record the Production change since the A7 measured HEAD', 'the re-derived Production change since the A7 measured HEAD is not empty',
      'the A7 raw run is not the one the A7 RESULT recorded', 'the work prefix comparison does not cover exactly the A7 primaries',
      'the held-aware depth prefix comparison does not cover exactly the A7 primaries', 'the raw run was not made against this C2.6-A7 RESULT']))
    expect(validation.diagnosticRepresentative.expected).toBe(selectPhase2C26A8DiagnosticRepresentative(a7).representativeOrientationId)
    const wrongInstrumentation = validatePhase2C26A8FormalRun({ status: 'completed', environment: { searchInstrumentation: { ...PHASE2C26A8_SEARCH_INSTRUMENTATION, onGogmaReservedRuntime: false } } },
      { ...all, a7 }, { ...shas, a7: a7Sha }, { productionChangeSinceA7: [], a7RawShaMatches: true, workPrefix: [], depthPrefix: [] })
    expect(wrongInstrumentation.failures).toContain('the Search instrumentation is not the A7 pair of boundary observers')
  })
})

describe('Phase 2-C2.6-A8 profile window controller (A5 controller, A8 registered window)', () => {
  it('starts at Search start + 120 s and stops at + 720 s, recording both delays', async () => {
    let perf = 0
    const timers: { at: number; callback: () => void }[] = []
    const calls: string[] = []
    const controller = createPhase2C26A5ProfileController({
      clockPair: () => ({ perfMs: perf, hrMs: perf + 1_000_000, precisionMs: 0.01 }),
      setTimer: (callback, delayMs) => { timers.push({ at: perf + delayMs, callback }) },
      startProfiler: async () => { calls.push('start'); perf += 3 },
      stopProfiler: async () => { calls.push('stop'); perf += 4; return { profile: true } },
      onCaptured: () => { calls.push('captured') },
      config: PHASE2C26A8_PROFILER,
    })
    const advanceTo = async (at: number) => {
      for (;;) {
        timers.sort((a, b) => a.at - b.at)
        const next = timers[0]
        if (next === undefined || next.at > at) break
        timers.shift()
        perf = Math.max(perf, next.at)
        next.callback()
        await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
      }
      perf = Math.max(perf, at)
    }
    perf = 500
    controller.onSearchStarted(500)
    await advanceTo(500 + PHASE2C26A8_PROFILER.warmupMs - 1)
    expect(controller.state()).toBe('scheduled')
    await advanceTo(500 + PHASE2C26A8_PROFILER.warmupMs + 1)
    expect(controller.state()).toBe('running')
    await advanceTo(500 + PHASE2C26A8_PROFILER.profileStopMs + 100)
    await controller.settled()
    expect(calls).toEqual(['start', 'stop', 'captured'])
    const recorded = controller.window()
    expect(recorded.stoppedBy).toBe('window')
    expect(recorded.startDelayMs).toBeCloseTo(3)
    expect(recorded.stopDelayMs).toBeGreaterThanOrEqual(0)
    expect(recorded.actualProfileDurationMs).toBeCloseTo(PHASE2C26A8_PROFILER.requestedProfileDurationMs - 3, 0)
  })
})
