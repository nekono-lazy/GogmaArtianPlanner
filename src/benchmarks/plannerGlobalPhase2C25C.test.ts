import { beforeEach, describe, expect, it, vi } from 'vitest'
import c25aEvidence from '../../docs/PLANNER_GLOBAL_PHASE2C25A_RESULT.json'
import { DATABASE_SCHEMA_VERSION } from '../db/AppDatabase'
import { CURRENT_CALCULATION_APP_SCHEMA_VERSION } from '../domain/models/common'
import { EXPORT_SCHEMA_VERSION } from '../domain/models/exportModel'
import { hashStableValue, stableStringify } from '../domain/models/hashing'
import type { TargetWeapon } from '../domain/models/publicTypes'
import { defaultPlannerAlternativeTrialBounds } from '../domain/planner/alternative'
import { defaultPlannerOptions } from '../domain/planner/plannerTypes'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../domain/rng/production/productionRngEngine'
import { defaultPlannerAlternativeSearchExtent } from '../domain/search'
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
import { positionRanges, runPhase2C2Baseline } from './plannerGlobalPhase2C2'
import { derivePhase2C25APreSearchContexts, runPhase2C25ASearchOnly } from './plannerGlobalPhase2C25A'
import {
  classifyPhase2C25CRun,
  comparePhase2C25CContextParity,
  comparePhase2C25CControl,
  createPhase2C25CProfilingYield,
  createPhase2C25CProgressObserver,
  createPhase2C25CThresholdTracker,
  parsePhase2C25CEvidence,
  phase2c25cContextKey,
  phase2c25cReservationEvidenceForm,
  runPhase2C25CSearch,
  selectPhase2C25CWorkload,
  PHASE2C25C_CANDIDATE_STOP_BOUND,
  PHASE2C25C_CONCURRENCY,
  PHASE2C25C_PROFILE_THRESHOLDS_MIB,
  PHASE2C25C_SAMPLING_CHILD_HEAP_MB,
  PHASE2C25C_SAMPLING_OPTIONS,
  PHASE2C25C_SAMPLING_VARIANTS,
  PHASE2C25C_SNAPSHOT_CHILD_HEAP_MB,
  type Phase2C25CEvidencePreSearchContext,
} from './plannerGlobalPhase2C25C'
import {
  analyzeSamplingHeapProfile,
  categorizePhase2C25CRepositoryFrame,
  comparePhase2C25CThresholds,
  normalizePhase2C25CUrl,
  validateSamplingHeapProfile,
  type SamplingHeapProfile,
  type SamplingHeapProfileNode,
} from './plannerGlobalPhase2C25CProfileAnalysis'
import {
  analyzeHeapSnapshot,
  buildHeapSnapshotGraph,
  createHeapSnapshotStreamParser,
  heapSnapshotBfs,
  heapSnapshotEdgeName,
  heapSnapshotMaxNodeId,
  heapSnapshotNodeSignature,
  heapSnapshotRetainingPath,
  HeapSnapshotFormatError,
  HeapSnapshotSchemaError,
  parseHeapSnapshotText,
} from './plannerGlobalPhase2C25CSnapshotAnalysis'
import {
  buildPhase2C25CConclusionScopes,
  buildPhase2C25CFindings,
  evaluatePhase2C25CHypotheses,
  phase2c25cContextStrength,
  phase2c25cVerdict,
  PHASE2C25C_HYPOTHESES,
  PHASE2C25C_INTERPRETATION,
} from './plannerGlobalPhase2C25CAnalysis'

/** Every input the Planner Alternative Search received, in call order. */
const searchCalls = vi.hoisted(() => ({ inputs: [] as unknown[] }))
vi.mock('../domain/search/alternative/plannerAlternativeSearch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../domain/search/alternative/plannerAlternativeSearch')>()
  return {
    ...actual,
    visitPlannerAlternativeCandidates: (...args: Parameters<typeof actual.visitPlannerAlternativeCandidates>) => {
      searchCalls.inputs.push(structuredClone(args[0]))
      return actual.visitPlannerAlternativeCandidates(...args)
    },
  }
})
beforeEach(() => { searchCalls.inputs = [] })

const digest = (value: string) => hashStableValue(value)
const SOURCE_A_SKILL = 'series_skill.fixture.z'
const SOURCE_B_SKILL = 'series_skill.fixture.b-source'
const ENTRY_A = 'build-list.c25c.a'
const ENTRY_B = 'build-list.c25c.b'

/** The Phase 2-C2 synthetic contention: A and B contend for Gogma 10; with A fixed, B has a later Reset alternative. */
function scenario() {
  const skill = { seriesSkillId: SOURCE_A_SKILL, groupSkillId: null, matchMode: 'all' as const }
  const a: TargetWeapon = orchestrationTarget('target.c25c.a', { priority: 5, idealSkillCondition: skill, practicalSkillCondition: skill })
  const b = skillConstrainedTarget('target.c25c.b', { priority: 1 })
  return orchestrationScenario({
    targets: [a, b],
    ownedWeapons: [orchestrationSource(ORCHESTRATION_SOURCE_A, { seriesSkillId: SOURCE_A_SKILL }),
      orchestrationSource(ORCHESTRATION_SOURCE_B, { restorationBonuses: belowPracticalBonuses(), seriesSkillId: SOURCE_B_SKILL })],
    entries: [
      orchestrationEntry(ENTRY_A, a, resetRoute(ORCHESTRATION_SOURCE_A), { finalBonuses: idealBonuses(), seriesSkillId: SOURCE_A_SKILL }),
      orchestrationEntry(ENTRY_B, b, { kind: 'existing_gogma_mixed', sourceOwnedWeaponId: resetRoute(ORCHESTRATION_SOURCE_B).sourceOwnedWeaponId,
        operations: [...resetRoute(ORCHESTRATION_SOURCE_B).operations, ...resetSkillsRoute(ORCHESTRATION_SOURCE_B).operations] }),
    ],
  })
}

async function preparedFixingA() {
  const built = scenario()
  const baseline = await runPhase2C2Baseline(built.input, { createEngine: () => built.engine, now: () => 0 })
  const orientation = baseline.orientations.find(o => o.fixedBuildListEntryId === ENTRY_A)!
  const prepared = derivePhase2C25APreSearchContexts(built.input, orientation, globalResearchDependencies(built.engine))
  return { built, orientation, prepared }
}

/** The C2.5-A committed evidence form of a derived context. */
function asEvidenceContext(context: ReturnType<typeof derivePhase2C25APreSearchContexts>['contexts'][number]): Phase2C25CEvidencePreSearchContext {
  return { orientationId: context.orientationId, workIndex: context.workIndex, targetWeaponId: context.targetWeaponId, status: context.status,
    invalidatedBuildListEntryId: context.invalidatedBuildListEntryId, invalidatedRouteKeySha256: digest(context.invalidatedRouteKey),
    fixedRouteBuildListEntryIds: context.fixedRouteBuildListEntryIds, reservation: phase2c25cReservationEvidenceForm(context.reservation),
    excludedRouteKeySha256s: context.excludedRouteKeys.map(digest), extent: context.extent, originDigest: context.originDigest, contextDigest: context.contextDigest }
}

// ---------------------------------------------------------------- workload

type FakeRow = { id: string; w: number; role: 'oom_representative' | 'completed_control'; status: string; classification?: string }
function fakeEvidence(rows: FakeRow[]) {
  const mode = (row: FakeRow) => ({ status: row.status, searchSummary: row.status === 'out_of_memory' ? null : { deliveredCandidates: row.status === 'first_candidate' ? 1 : 0 },
    firstCandidateKeySha256: row.status === 'first_candidate' ? `k-${row.id}` : null })
  return {
    provenance: { formal: true, exportSha256: 'export', measuredHead: 'head' },
    contexts: rows.map(row => ({ orientationId: row.id, role: row.role, kind: 'same_gogma_counter', workIndex: row.w, targetWeaponId: `t-${row.id}-${row.w}`,
      classification: row.classification ?? (row.status === 'out_of_memory' ? 'search_only_oom_reproduced' : 'no_oom'), minimal: mode(row), instrumented: mode(row) })),
    preSearchContexts: [...new Set(rows.map(r => r.id))].map(id => ({ orientationId: id, contexts: rows.filter(r => r.id === id).map(row => ({
      workIndex: row.w, targetWeaponId: `t-${row.id}-${row.w}`, status: 'searchable', invalidatedBuildListEntryId: 'e', invalidatedRouteKeySha256: 'x', fixedRouteBuildListEntryIds: [],
      reservation: null, excludedRouteKeySha256s: [], extent: {}, originDigest: 'o', contextDigest: `d-${row.id}-${row.w}` })) })),
  }
}
const ROWS: FakeRow[] = [
  { id: 'a', w: 0, role: 'oom_representative', status: 'out_of_memory' },
  { id: 'b', w: 0, role: 'oom_representative', status: 'first_candidate', classification: 'no_oom' },
  { id: 'c', w: 0, role: 'completed_control', status: 'stopped_by_extent_before_candidate' },
  { id: 'c', w: 1, role: 'completed_control', status: 'first_candidate' },
  { id: 'd', w: 0, role: 'completed_control', status: 'first_candidate' },
  { id: 'e', w: 0, role: 'oom_representative', status: 'out_of_memory' },
]

describe('Phase 2-C2.5-C workload', () => {
  it('derives the OOM representatives and one control per normal termination from the evidence order, never by ID', () => {
    const workload = selectPhase2C25CWorkload(parsePhase2C25CEvidence(fakeEvidence(ROWS)))
    expect(workload.oomRepresentatives.map(i => [i.orientationId, i.workIndex, i.contextDigest])).toEqual([['a', 0, 'd-a-0'], ['e', 0, 'd-e-0']])
    expect(workload.controls.map(i => [i.role, i.orientationId, i.workIndex])).toEqual([['control_first_candidate', 'c', 1], ['control_stopped_by_extent', 'c', 0]])
    // Reordering the evidence reorders the choice: the stable order is the evidence's, not a name.
    const reordered = selectPhase2C25CWorkload(parsePhase2C25CEvidence(fakeEvidence([ROWS[4], ...ROWS.filter((_, i) => i !== 4)])))
    expect(reordered.controls[0]).toMatchObject({ orientationId: 'd', workIndex: 0 })
    const renamed = selectPhase2C25CWorkload(parsePhase2C25CEvidence(fakeEvidence(ROWS.map(r => ({ ...r, id: `z${r.id}` })))))
    expect(renamed.oomRepresentatives.map(i => i.orientationId)).toEqual(['za', 'ze'])
  })

  it('derives three OOM representatives and two controls from the committed Phase 2-C2.5-A evidence', () => {
    const view = parsePhase2C25CEvidence(c25aEvidence)
    const workload = selectPhase2C25CWorkload(view)
    const expectedOom = view.contexts.filter(c => c.role === 'oom_representative' && c.minimal.status === 'out_of_memory' && c.instrumented.status === 'out_of_memory')
    expect(workload.oomRepresentatives).toHaveLength(3)
    expect(workload.oomRepresentatives.map(i => i.evidenceIndex)).toEqual(expectedOom.map(c => c.evidenceIndex))
    expect(new Set(workload.oomRepresentatives.map(i => i.kind)).size).toBe(3)
    const controls = view.contexts.filter(c => c.role === 'completed_control')
    expect(workload.controls[0].evidenceIndex).toBe(controls.find(c => c.minimal.status === 'first_candidate')!.evidenceIndex)
    expect(workload.controls[1].evidenceIndex).toBe(controls.find(c => c.minimal.status === 'stopped_by_extent_before_candidate')!.evidenceIndex)
    for (const item of [...workload.oomRepresentatives, ...workload.controls]) {
      expect(item.contextDigest).toBe(view.preSearchContexts.get(phase2c25cContextKey(item.orientationId, item.workIndex))!.contextDigest)
    }
  })

  it('fails closed on a malformed or non-formal evidence', () => {
    const evidence = fakeEvidence(ROWS)
    expect(() => parsePhase2C25CEvidence({ ...evidence, provenance: { ...evidence.provenance, formal: false } })).toThrow(/not formal/)
    const unknown = structuredClone(evidence)
    unknown.contexts[0].minimal.status = 'maybe'
    expect(() => parsePhase2C25CEvidence(unknown)).toThrow(/unknown/)
    const missing = structuredClone(evidence)
    missing.preSearchContexts = missing.preSearchContexts.filter(o => o.orientationId !== 'a')
    expect(() => selectPhase2C25CWorkload(parsePhase2C25CEvidence(missing))).toThrow(/no pre-search context/)
    const noControl = fakeEvidence(ROWS.filter(r => r.status !== 'stopped_by_extent_before_candidate'))
    expect(() => selectPhase2C25CWorkload(parsePhase2C25CEvidence(noControl))).toThrow(/lacks a completed control/)
  })
})

// ---------------------------------------------------------------- context parity and the Search call

describe('Phase 2-C2.5-C context parity', () => {
  it('matches the C2.5-A evidence form field by field and fails closed on any difference', async () => {
    const { prepared } = await preparedFixingA()
    const [context] = prepared.contexts
    const evidence = asEvidenceContext(context)
    expect(comparePhase2C25CContextParity(context, evidence, digest).matches).toBe(true)
    const field = (patch: Partial<Phase2C25CEvidencePreSearchContext>, name: string) => {
      const result = comparePhase2C25CContextParity(context, { ...evidence, ...patch }, digest)
      expect(result.matches).toBe(false)
      expect(result.fields.find(f => f.field === name)!.matches).toBe(false)
    }
    field({ contextDigest: 'fnv1a32:00000000' }, 'contextDigest')
    field({ originDigest: 'fnv1a32:00000000' }, 'originDigest')
    field({ extent: { ...context.extent, maxGogmaAdvance: context.extent.maxGogmaAdvance + 1 } }, 'extent')
    field({ excludedRouteKeySha256s: ['0'.repeat(8)] }, 'excludedRouteKeys')
    field({ reservation: { ...(evidence.reservation as object), gogma: { held: [[1, 99]], blocked: [] } } }, 'reservation')
    field({ targetWeaponId: 'other' }, 'targetWeaponId')
    field({ workIndex: 3 }, 'workIndex')
    expect(comparePhase2C25CContextParity(context, undefined, digest).matches).toBe(false)
    expect(phase2c25cReservationEvidenceForm(context.reservation)).toMatchObject({ gogma: { held: positionRanges(context.reservation!.gogma.held) } })
  })

  it('hands the Search exactly the C2.5-A Search-only input and returns the same record', async () => {
    const { built, prepared } = await preparedFixingA()
    await runPhase2C25ASearchOnly(built.input, prepared, 0, built.engine, { mode: 'minimal' })
    const c25a = searchCalls.inputs[0]
    const reference = await runPhase2C25ASearchOnly(built.input, prepared, 0, built.engine, { mode: 'minimal' })
    searchCalls.inputs = []
    const record = await runPhase2C25CSearch(prepared, 0, built.engine, {})
    expect(searchCalls.inputs).toHaveLength(1)
    expect(searchCalls.inputs[0]).toEqual(c25a)
    expect(record).toMatchObject({ status: reference.status, searchSummary: reference.searchSummary, firstCandidateKey: reference.firstCandidateKey, contextDigest: reference.contextDigest })
    expect(record.searchSummary.deliveredCandidates).toBe(PHASE2C25C_CANDIDATE_STOP_BOUND)
  })
})

// ---------------------------------------------------------------- profiler boundary

describe('Phase 2-C2.5-C profiler boundary', () => {
  it('reports each threshold once, in ascending order, and rejects invalid thresholds', () => {
    const tracker = createPhase2C25CThresholdTracker([1024, 512, 2048])
    const MiB = 1024 * 1024
    expect(tracker.observe(100 * MiB)).toEqual([])
    expect(tracker.observe(1500 * MiB)).toEqual([512, 1024])
    expect(tracker.observe(1600 * MiB)).toEqual([])
    expect(tracker.observe(900 * MiB)).toEqual([])
    expect(tracker.observe(4000 * MiB)).toEqual([2048])
    expect(tracker.reached()).toEqual([512, 1024, 2048])
    expect(() => createPhase2C25CThresholdTracker([512, 512])).toThrow()
    expect(() => createPhase2C25CThresholdTracker([0])).toThrow()
  })

  it('never lets a profile capture (or its failure) change the Search result', async () => {
    const { built, prepared } = await preparedFixingA()
    const plain = await runPhase2C25CSearch(prepared, 0, built.engine, { yieldControl: async () => {} })
    let heap = 0
    const tracker = createPhase2C25CThresholdTracker([1, 2, 3])
    const failing = createPhase2C25CProfilingYield({
      yieldControl: async () => {}, heapUsed: () => (heap += 1024 * 1024), tracker,
      capture: () => { throw new Error('inspector unavailable') },
    })
    const progress = createPhase2C25CProgressObserver()
    const profiled = await runPhase2C25CSearch(prepared, 0, built.engine, { yieldControl: failing.yieldControl, instrumentation: progress.instrumentation })
    expect({ ...profiled, elapsedMs: 0 }).toEqual({ ...plain, elapsedMs: 0 })
    expect(profiled.status).toBe('first_candidate')
    expect(failing.events().every(e => e.outcome === 'profile_failed' && /inspector unavailable/.test(e.error!))).toBe(true)
    expect(progress.snapshot().maxDepth.gogma).toBeGreaterThanOrEqual(0)

    // A capture that returns something is never read either.
    const captured: number[][] = []
    const returning = createPhase2C25CProfilingYield({ yieldControl: async () => {}, heapUsed: () => 10 * 1024 * 1024 * 1024, tracker: createPhase2C25CThresholdTracker([1]),
      capture: (t) => { captured.push(t); return Promise.resolve() } })
    const again = await runPhase2C25CSearch(prepared, 0, built.engine, { yieldControl: returning.yieldControl })
    expect({ ...again, elapsedMs: 0 }).toEqual({ ...plain, elapsedMs: 0 })
    expect(captured.length).toBeLessThanOrEqual(1)
  })

  it('records a failing capture as profile_failed and still yields', async () => {
    let yields = 0
    const events: string[] = []
    const profiling = createPhase2C25CProfilingYield({ yieldControl: async () => { yields++ }, heapUsed: () => 3 * 1024 ** 2, tracker: createPhase2C25CThresholdTracker([1, 2, 4]),
      capture: () => { throw new Error('boom') }, onEvent: e => { events.push(e.outcome) } })
    await profiling.yieldControl()
    await profiling.yieldControl()
    expect(yields).toBe(2)
    expect(events).toEqual(['profile_failed'])
    expect(profiling.events()).toEqual([{ thresholdsMiB: [1, 2], heapUsedBytes: 3 * 1024 ** 2, outcome: 'profile_failed', error: 'Error: boom' }])
  })

  it('stops capturing once the consumer stopped', async () => {
    let stopped = false
    let captures = 0
    const profiling = createPhase2C25CProfilingYield({ yieldControl: async () => {}, heapUsed: () => 10 * 1024 ** 3, tracker: createPhase2C25CThresholdTracker([1, 2]),
      capture: () => { captures++ }, isStopped: () => stopped })
    stopped = true
    await profiling.yieldControl()
    expect(captures).toBe(0)
  })

  it('classifies a child failure as that failure and a profiling failure apart from the Search status', () => {
    expect(classifyPhase2C25CRun({ kind: 'sampling', childOutcome: 'out_of_memory', searchStatus: null })).toEqual({ outcome: 'out_of_memory', profilingOutcome: 'ok' })
    expect(classifyPhase2C25CRun({ kind: 'sampling', childOutcome: 'completed', searchStatus: 'stopped_by_extent_before_candidate', profilingFailures: 1 }))
      .toEqual({ outcome: 'stopped_by_extent_before_candidate', profilingOutcome: 'profile_failed' })
    expect(classifyPhase2C25CRun({ kind: 'sampling', childOutcome: 'timeout', searchStatus: null }).outcome).toBe('timeout')
    expect(classifyPhase2C25CRun({ kind: 'sampling', childOutcome: 'process_failure', searchStatus: null }).outcome).toBe('process_failure')
    expect(classifyPhase2C25CRun({ kind: 'snapshot', childOutcome: 'out_of_memory', searchStatus: null, snapshot: 'complete' }).outcome).toBe('snapshot_written_then_oom')
    for (const state of ['partial', 'not_written', 'written_before_search'] as const) {
      expect(classifyPhase2C25CRun({ kind: 'snapshot', childOutcome: 'out_of_memory', searchStatus: null, snapshot: state }).outcome).toBe('snapshot_failed')
    }
    expect(classifyPhase2C25CRun({ kind: 'snapshot', childOutcome: 'completed', searchStatus: 'first_candidate', snapshot: 'not_written' }).outcome).toBe('first_candidate')
    expect(() => classifyPhase2C25CRun({ kind: 'sampling', childOutcome: 'completed', searchStatus: null })).toThrow()
  })

  it('reports a control as contaminated when status, summary or first Candidate key differ from C2.5-A', () => {
    const [item] = selectPhase2C25CWorkload(parsePhase2C25CEvidence(fakeEvidence(ROWS))).controls
    const summary = { deliveredCandidates: 1 }
    const run = { status: 'first_candidate', searchSummary: summary, firstCandidateKey: 'raw' }
    const expectedItem = { ...item, expected: { ...item.expected, searchSummary: summary, firstCandidateKeySha256: digest('raw') } }
    expect(comparePhase2C25CControl(expectedItem, run, digest).contaminated).toBe(false)
    expect(comparePhase2C25CControl(expectedItem, { ...run, firstCandidateKey: 'other' }, digest)).toMatchObject({ contaminated: true, firstCandidateKeyMatches: false })
    expect(comparePhase2C25CControl(expectedItem, { ...run, searchSummary: { deliveredCandidates: 2 } }, digest).searchSummaryMatches).toBe(false)
    expect(comparePhase2C25CControl(expectedItem, null, digest).contaminated).toBe(true)
  })
})

// ---------------------------------------------------------------- sampling profile analysis

let nextId = 1
function frame(functionName: string, scriptId: string, url: string, selfSize: number, children: SamplingHeapProfileNode[] = [], lineNumber = 0): SamplingHeapProfileNode {
  return { callFrame: { functionName, scriptId, url, lineNumber, columnNumber: 0 }, selfSize, id: nextId++, children }
}
function syntheticProfile(scale = 1): SamplingHeapProfile {
  nextId = 1
  const recursion = frame('reservedBonusSteps', '11', '', 10 * scale, [], 204)
  const steps = frame('reservedBonusSteps', '11', '', 50 * scale, [recursion], 204)
  const anonymous = frame('', '10', '', 20 * scale, [], 340)
  const map = frame('map', '0', '', 30 * scale, [anonymous])
  const settle = frame('settle', '10', '', 100 * scale, [map, steps], 328)
  const runtime = frame('foo', '5', 'node:internal/foo', 5)
  const head = frame('(root)', '0', '', 0, [settle, runtime])
  return { head, samples: [{ size: 64, nodeId: settle.id, ordinal: 1 }, { size: 64, nodeId: settle.id, ordinal: 2 }, { size: 32, nodeId: steps.id, ordinal: 3 }, { size: 8, nodeId: runtime.id, ordinal: 4 }] }
}
const SCRIPTS = {
  urlOf: (id: string) => ({ '10': 'D:/GogmaArtianPlanner/src/domain/search/targetSearchScheduler.ts', '11': 'D:/GogmaArtianPlanner/src/domain/search/bonusStream.ts' } as Record<string, string>)[id] ?? null,
}

describe('Phase 2-C2.5-C sampling profile analysis', () => {
  it('computes self and inclusive sampled bytes per callsite, counting a recursive frame once per allocation', () => {
    const result = analyzeSamplingHeapProfile(validateSamplingHeapProfile(syntheticProfile()), SCRIPTS)
    const raw = (name: string) => result.callsites.find(s => s.functionName === name)!
    expect(result.totalSampledBytes).toBe(215)
    expect(result.totalSamples).toBe(4)
    expect(raw('settle')).toMatchObject({ sampledSelfBytes: 100, sampledInclusiveBytes: 210, selfSamples: 2, repository: true, category: 'scheduler_channel', url: 'src/domain/search/targetSearchScheduler.ts' })
    expect(raw('reservedBonusSteps')).toMatchObject({ sampledSelfBytes: 60, sampledInclusiveBytes: 60, selfSamples: 1, category: 'reserved_bonus_steps' })
    expect(raw('map')).toMatchObject({ sampledSelfBytes: 30, sampledInclusiveBytes: 50, repository: false, category: 'runtime' })
    expect(raw('(root)').sampledInclusiveBytes).toBe(215)
    // Native and anonymous frames are attributed to the nearest named Repository frame on their stack.
    const attributed = (name: string) => result.attributedCallsites.find(s => s.functionName === name)
    expect(attributed('settle')!.sampledSelfBytes).toBe(150)
    expect(attributed('map')).toBeUndefined()
    expect(attributed('foo')!.sampledSelfBytes).toBe(5)
    expect(result.attributedCallsites.reduce((sum, s) => sum + s.sampledSelfBytes, 0)).toBe(result.totalSampledBytes)
    expect(result.categories).toEqual([
      { category: 'scheduler_channel', sampledSelfBytes: 150, share: 150 / 215, selfSamples: 2 },
      { category: 'reserved_bonus_steps', sampledSelfBytes: 60, share: 60 / 215, selfSamples: 1 },
      { category: 'runtime', sampledSelfBytes: 5, share: 5 / 215, selfSamples: 1 },
    ])
    expect(result.repositorySelfBytes).toBe(210)
  })

  it('groups one function reached through different stacks into one callsite', () => {
    nextId = 1
    const a = frame('evaluateBonusSolution', '12', '', 7)
    const b = frame('evaluateBonusSolution', '12', '', 9)
    const head = frame('(root)', '0', '', 0, [frame('x', '12', '', 0, [a]), frame('y', '12', '', 0, [b])])
    const result = analyzeSamplingHeapProfile(validateSamplingHeapProfile({ head, samples: [] }), { urlOf: () => 'file:///D:/GogmaArtianPlanner/src/domain/search/streamSolutions.ts' })
    expect(result.callsites.filter(s => s.functionName === 'evaluateBonusSolution')).toHaveLength(1)
    expect(result.callsites.find(s => s.functionName === 'evaluateBonusSolution')!.sampledSelfBytes).toBe(16)
    expect(result.categories[0].category).toBe('stream_solution_evaluation')
  })

  it('compares thresholds by category share and callsite growth relative to the whole sampled heap', () => {
    const small = analyzeSamplingHeapProfile(syntheticProfile(1), SCRIPTS)
    const large = analyzeSamplingHeapProfile(syntheticProfile(2), SCRIPTS)
    const growth = comparePhase2C25CThresholds([{ thresholdMiB: 1024, heapUsedBytes: 2, analysis: large }, { thresholdMiB: 512, heapUsedBytes: 1, analysis: small }], 5)
    expect(growth.thresholdsMiB).toEqual([512, 1024])
    expect(growth.totalSampledBytes).toEqual([215, 425])
    const settle = growth.topCallsites.find(s => s.key.startsWith('settle'))!
    expect(settle.sampledSelfBytes).toEqual([150, 300])
    expect(settle.growthVsTotal).toBeCloseTo((300 / 150) / (425 / 215))
    expect(growth.categories[0]).toMatchObject({ category: 'scheduler_channel', sampledSelfBytes: [150, 300] })
  })

  it('normalizes urls and categorizes Repository frames mechanically, never guessing an unknown one', () => {
    expect(normalizePhase2C25CUrl('file:///D:/GogmaArtianPlanner/src/domain/search/bonusStream.ts')).toBe('src/domain/search/bonusStream.ts')
    expect(normalizePhase2C25CUrl('D:\\GogmaArtianPlanner\\src\\domain\\rng\\x.ts')).toBe('src/domain/rng/x.ts')
    expect(normalizePhase2C25CUrl('file:///D:/GogmaArtianPlanner/node_modules/vite/dist/x.js')).toBe('node_modules/vite/dist/x.js')
    expect(categorizePhase2C25CRepositoryFrame('src/domain/search/bonusStream.ts', 'ensureReserved')).toBe('reserved_bonus_generation')
    expect(categorizePhase2C25CRepositoryFrame('src/domain/search/bonusStream.ts', 'somethingElse')).toBe('bonus_stream_other')
    expect(categorizePhase2C25CRepositoryFrame('src/domain/search/lazyIdealCross.ts', 'openNext')).toBe('lazy_ideal_cross')
    expect(categorizePhase2C25CRepositoryFrame('src/domain/search/searchWorkQueue.ts', 'enqueue')).toBe('search_work_queue')
    expect(categorizePhase2C25CRepositoryFrame('src/domain/foo/bar.ts', 'x')).toBe('other_repo')
  })

  it('fails closed on a malformed profile', () => {
    expect(() => validateSamplingHeapProfile({ head: { callFrame: {}, selfSize: 1, id: 1, children: [] }, samples: [] })).toThrow(/callFrame/)
    const profile = syntheticProfile()
    expect(() => validateSamplingHeapProfile({ ...profile, samples: [{ size: 1, nodeId: 999, ordinal: 1 }] })).toThrow(/unknown node/)
    expect(() => validateSamplingHeapProfile({ head: profile.head })).toThrow(/samples/)
  })
})

// ---------------------------------------------------------------- heap snapshot parsing and analysis

interface SynthNode { type: string; name: string; id: number; self: number; edges: { type: string; name: string | number; to: number }[] }
const NODE_TYPES = ['hidden', 'array', 'string', 'object', 'code', 'closure', 'regexp', 'number', 'native', 'synthetic', 'concatenated string', 'sliced string', 'symbol', 'bigint', 'object shape']
const EDGE_TYPES = ['context', 'element', 'property', 'internal', 'hidden', 'shortcut', 'weak']

/** A tiny V8-format snapshot with PERMUTED field orders, so the parser must read the meta. */
function synthSnapshot(nodes: SynthNode[], options: { dropField?: string; nodeCount?: number } = {}): string {
  const nodeFields = ['name', 'type', 'edge_count', 'id', 'self_size', 'detachedness'].filter(f => f !== options.dropField)
  const edgeFields = ['to_node', 'type', 'name_or_index']
  const strings: string[] = []
  const str = (s: string) => { const i = strings.indexOf(s); if (i >= 0) return i; strings.push(s); return strings.length - 1 }
  const nodeTypes = nodeFields.map(f => f === 'type' ? NODE_TYPES : 'number')
  const flatNodes: number[] = []
  for (const n of nodes) {
    const values: Record<string, number> = { name: str(n.name), type: NODE_TYPES.indexOf(n.type), edge_count: n.edges.length, id: n.id, self_size: n.self, detachedness: 0 }
    for (const f of nodeFields) flatNodes.push(values[f])
  }
  const flatEdges: number[] = []
  for (const n of nodes) for (const e of n.edges) {
    const type = EDGE_TYPES.indexOf(e.type)
    const values: Record<string, number> = { to_node: e.to * nodeFields.length, type, name_or_index: typeof e.name === 'number' ? e.name : str(e.name) }
    for (const f of edgeFields) flatEdges.push(values[f])
  }
  const header = { meta: { node_fields: nodeFields, node_types: [...nodeTypes, 'number'], edge_fields: edgeFields,
    edge_types: edgeFields.map(f => f === 'type' ? EDGE_TYPES : f === 'to_node' ? 'node' : 'string_or_number'),
    location_fields: ['object_index', 'script_id', 'line', 'column'] }, node_count: options.nodeCount ?? nodes.length, edge_count: flatEdges.length / 3, trace_function_count: 0 }
  return `{"snapshot":${JSON.stringify(header)},\n"nodes":[${flatNodes.join(',')}],\n"edges":[${flatEdges.join(',\n')}],\n"trace_function_infos":[],\n"trace_tree":[[1,[2,[]]]],\n"samples":[],\n` +
    `"extra":"a,}]\\"x",\n"locations":[1,2,3,4],\n"strings":${JSON.stringify(strings)}}\n`
}

/** root -> scheduler -> channel -retained-> array -> (node5 -previous-> node7, element 1 -> node7); weak edge to a string. */
function schedulerGraph(): SynthNode[] {
  return [
    { type: 'synthetic', name: '', id: 1, self: 0, edges: [{ type: 'element', name: 1, to: 1 }] },
    { type: 'object', name: 'TargetSearchScheduler', id: 3, self: 40, edges: [{ type: 'property', name: 'queue', to: 2 }, { type: 'property', name: 'bonuses', to: 3 }] },
    { type: 'object', name: 'SearchWorkQueue', id: 5, self: 24, edges: [{ type: 'property', name: 'heap', to: 6 }] },
    { type: 'object', name: 'Object', id: 7, self: 32, edges: [{ type: 'property', name: 'retained', to: 4 }, { type: 'property', name: 'subscribers', to: 6 }] },
    { type: 'object', name: 'Array', id: 101, self: 16, edges: [{ type: 'element', name: 0, to: 5 }, { type: 'element', name: 1, to: 7 }] },
    { type: 'object', name: 'Object', id: 103, self: 32, edges: [{ type: 'property', name: 'previous', to: 7 }, { type: 'property', name: 'result', to: 8 }] },
    { type: 'object', name: 'Array', id: 9, self: 16, edges: [{ type: 'weak', name: 'w', to: 8 }] },
    { type: 'object', name: 'Object', id: 105, self: 50, edges: [] },
    { type: 'string', name: 'he"llo\\n\u00e9', id: 107, self: 20, edges: [] },
  ]
}

describe('Phase 2-C2.5-C heap snapshot parser', () => {
  it('reads field positions from the meta, streams across any chunk boundary, and skips unknown sections', () => {
    const text = synthSnapshot(schedulerGraph())
    const whole = parseHeapSnapshotText(text)
    for (const size of [1, 2, 3, 7, 64]) {
      const parser = createHeapSnapshotStreamParser()
      for (let i = 0; i < text.length; i += size) parser.push(text.slice(i, i + size))
      const parsed = parser.finish()
      expect([...parsed.nodes]).toEqual([...whole.nodes])
      expect([...parsed.edges]).toEqual([...whole.edges])
      expect(parsed.strings).toEqual(whole.strings)
    }
    expect(whole.sections).toEqual(['snapshot', 'nodes', 'edges', 'trace_function_infos', 'trace_tree', 'samples', 'extra', 'locations', 'strings'])
    const graph = buildHeapSnapshotGraph(whole)
    expect(graph.schema).toMatchObject({ nodeFieldCount: 6, nodeType: 1, nodeName: 0, nodeEdgeCount: 2, nodeId: 3, nodeSelfSize: 4, edgeToNode: 0, edgeType: 1, edgeNameOrIndex: 2, nodeCount: 9, edgeCount: 11 })
    expect(whole.strings).toContain('he"llo\\n\u00e9')
    expect(heapSnapshotEdgeName(graph, 0)).toBe('[1]')
    expect(heapSnapshotEdgeName(graph, 1)).toBe('queue')
    expect(heapSnapshotMaxNodeId(graph)).toBe(107)
    expect(heapSnapshotNodeSignature(graph, 5)).toBe('object:Object{previous,result}')
    expect(heapSnapshotNodeSignature(graph, 8)).toBe('string:he"llo\\n\u00e9')
  })

  it('finds a shortest retaining path over non-weak edges', () => {
    const graph = buildHeapSnapshotGraph(parseHeapSnapshotText(synthSnapshot(schedulerGraph())))
    const bfs = heapSnapshotBfs(graph, [0])
    const path = heapSnapshotRetainingPath(graph, bfs, 7, () => false)!
    expect(path.steps.map(s => `${s.from.name}-${s.edgeType}:${s.edgeName}`)).toEqual(['-element:[1]', 'TargetSearchScheduler-property:bonuses', 'Object-property:retained', 'Array-element:[1]'])
    // The string is reached through `result`, never through the weak edge.
    expect(heapSnapshotRetainingPath(graph, bfs, 8, () => false)!.steps.at(-1)!.edgeName).toBe('result')
  })

  it('fails closed on an incomplete file, a schema mismatch and inconsistent counts', () => {
    const text = synthSnapshot(schedulerGraph())
    expect(() => parseHeapSnapshotText(text.slice(0, text.length - 5))).toThrow(HeapSnapshotFormatError)
    expect(() => parseHeapSnapshotText(text.slice(0, text.indexOf('"edges"')))).toThrow(HeapSnapshotFormatError)
    expect(() => parseHeapSnapshotText(text.replace('"strings":', '"strangs":'))).toThrow(/strings is missing/)
    expect(() => buildHeapSnapshotGraph(parseHeapSnapshotText(synthSnapshot(schedulerGraph(), { dropField: 'self_size' })))).toThrow(HeapSnapshotSchemaError)
    expect(() => buildHeapSnapshotGraph(parseHeapSnapshotText(synthSnapshot(schedulerGraph(), { nodeCount: 10 })))).toThrow(/node_count/)
    const dangling = schedulerGraph()
    dangling[7].edges.push({ type: 'property', name: 'x', to: 99 })
    expect(() => buildHeapSnapshotGraph(parseHeapSnapshotText(synthSnapshot(dangling)))).toThrow(/outside the nodes array/)
    const notRoot = schedulerGraph()
    notRoot[0] = { ...notRoot[0], type: 'object' }
    expect(() => buildHeapSnapshotGraph(parseHeapSnapshotText(synthSnapshot(notRoot)))).toThrow(/synthetic root/)
    expect(() => parseHeapSnapshotText(text.replace('"nodes":[', '"nodes":[-'))).toThrow(HeapSnapshotFormatError)
  })

  it('splits new nodes by the baseline id, measures edge cuts, and never reports a retained size', () => {
    const graph = buildHeapSnapshotGraph(parseHeapSnapshotText(synthSnapshot(schedulerGraph())))
    const result = analyzeHeapSnapshot(graph, { baselineMaxNodeId: 100, targetedEdgeNames: ['retained', 'previous', 'heap', 'queue', 'result'],
      edgeGroups: [{ group: 'G', edgeNames: ['retained'], holderSignaturePrefixes: ['object:Object{retained,'], edgeTypes: ['property'] },
        { group: 'none', edgeNames: ['retained'], holderSignaturePrefixes: ['object:Nothing'], edgeTypes: null }] })
    expect(result.totalShallowSize).toBe(230)
    expect(result.reachableFromRoot).toEqual({ nodes: 9, size: 230, newNodes: 4, newSize: 118 })
    expect(result.newNodeCount).toBe(4)
    const edge = (name: string) => result.targetedEdges.find(e => e.edgeName === name)!
    expect(edge('retained').edgeCut).toEqual({ nodes: 4, size: 118, newNodes: 4, newSize: 118 })
    expect(edge('retained').holders[0].holderSignature).toBe('object:Object{retained,subscribers}')
    // `previous` alone keeps nothing alive: its target is also an element of the retained array.
    expect(edge('previous').edgeCut.size).toBe(0)
    expect(edge('previous').occurrences).toBe(1)
    expect(result.groupEdgeCuts[0]).toMatchObject({ group: 'G', matchedEdges: 1, edgeCut: { newSize: 118 } })
    expect(result.groupEdgeCuts[1]).toMatchObject({ matchedEdges: 0, edgeCut: { size: 0 } })
    expect(result.topNewSignaturesByShallowSize[0]).toEqual({ key: 'object:Object{}', count: 1, shallowSize: 50 })
    expect(result.terminology.dominatorTreeComputed).toBe(false)
    const keys: string[] = []
    const walk = (value: unknown) => {
      if (Array.isArray(value)) value.forEach(walk)
      else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) { keys.push(k); walk(v) }
    }
    walk(result)
    expect(keys.filter(k => /retained|dominator(?!TreeComputed)/i.test(k))).toEqual([])
    // Without a baseline nothing is new.
    expect(analyzeHeapSnapshot(graph, { baselineMaxNodeId: null, targetedEdgeNames: ['retained'] }).newNodeCount).toBe(0)
  })

  it('splits new nodes into those a long-lived root reaches and in-flight ones, and adds requested path examples', () => {
    const nodes = schedulerGraph()
    // A new array held only by the synthetic root (a local of a running frame), not by the scheduler.
    nodes[0].edges.push({ type: 'element', name: 2, to: 9 })
    nodes.push({ type: 'object', name: 'Array', id: 109, self: 64, edges: [] })
    const graph = buildHeapSnapshotGraph(parseHeapSnapshotText(synthSnapshot(nodes)))
    const result = analyzeHeapSnapshot(graph, { baselineMaxNodeId: 100, targetedEdgeNames: ['retained'], persistentRootSignaturePrefixes: ['object:TargetSearchScheduler{'],
      pathSignaturePrefixes: ['object:Object{previous,', 'object:Nothing'], elementPropertyCensus: [{ edgeName: 'retained', property: 'result' }] })
    // The retained array holds node 5 (whose `result` is the string) and node 7 (no such property).
    expect(result.elementPropertyCensus).toEqual([{ edgeName: 'retained', property: 'result', rows: [
      { holderSignature: 'object:Object{retained,subscribers}', value: '(absent)', count: 1 },
      { holderSignature: 'object:Object{retained,subscribers}', value: 'string:he"llo\\né', count: 1 }] }])
    expect(result.persistentSplit).toEqual({ rootSignaturePrefixes: ['object:TargetSearchScheduler{'], roots: 1,
      reachableFromRoots: { nodes: 8, size: 230, newNodes: 4, newSize: 118 }, newNotReachableFromRoots: { newNodes: 1, newSize: 64 } })
    const extra = result.retainingPathExamples.slice(-2)
    expect(extra[0].path!.target.signature).toBe('object:Object{previous,result}')
    expect(extra[1]).toEqual({ reason: 'no new node has a signature starting with object:Nothing', path: null })
  })
})

describe('Phase 2-C2.5-C conclusion scopes', () => {
  /** A synthetic OOM context: jit_default publication-path inclusive share, retained edge-cut and persistent share. */
  function oomContext(key: string, depth: number, publicationInclusive: number, retainedCut: number, persistent: number) {
    const summary = { thresholdMiB: 7168, totalSampledBytes: 1000, repositorySelfBytes: 1000,
      categories: [{ category: 'scheduler_channel' as const, sampledSelfBytes: 600, share: 0.6 }],
      attributedRepositoryCallsites: [{ key: 'settle src/domain/search/targetSearchScheduler.ts:328', functionName: 'settle', url: 'src/domain/search/targetSearchScheduler.ts',
        category: 'scheduler_channel' as const, sampledSelfBytes: 600, sampledInclusiveBytes: publicationInclusive * 1000 }] }
    return { contextKey: key, kind: 'k', gogmaMaxDepthAtLastProgress: depth, sampling: { jit_default: summary, no_inlining: summary },
      snapshot: { newReachableBytes: 1000, persistentNewBytes: persistent * 1000, groupCutNewBytes: { H4: retainedCut * 1000 }, reservedBonusResultNodeShallowBytes: 0 } }
  }
  const h4 = (verdict: string) => [{ id: 'H4', verdict }] as unknown as Parameters<typeof buildPhase2C25CConclusionScopes>[1]
  const controls = { contexts: 2, runs: 4, contaminated: 0 }

  it('keeps the common allocation path, the persistent retaining structure and the in-flight working set apart', () => {
    // c0-p0-like (major), c12-p0-like (retained low, in-flight high, H4 mixed), c2-p1-like (major).
    const findings = buildPhase2C25CFindings([oomContext('deep#0', 134, 0.876, 0.838, 0.995), oomContext('mixed#0', 5, 0.778, 0.143, 0.418), oomContext('shallow#0', 7, 0.786, 0.555, 0.870)], [])
    const scopes = buildPhase2C25CConclusionScopes(findings.perContext, h4('partially_supported'), controls)
    expect(scopes.commonAllocationPath).toMatchObject({ path: 'held_aware_bonus_publication', holdsInEveryContext: true, basis: 'jit_default inclusive share (Production-like JIT)' })
    expect(scopes.persistentRetention.perContext.map(r => r.role)).toEqual(['major_persistent_retaining_structure', 'contributing_not_dominant', 'major_persistent_retaining_structure'])
    expect(scopes.persistentRetention).toMatchObject({ dominantInEveryContext: false, majorIn: ['deep#0', 'shallow#0'], notDominantIn: ['mixed#0'], h4ResearchVerdict: 'partially_supported' })
    expect(scopes.inFlightWorkingSet.majorityIn).toEqual(['mixed#0'])
    expect(scopes.inFlightWorkingSet.perContext[1].inFlightShareOfNewBytes).toBeCloseTo(0.582)
    const text = scopes.statements.join('\n')
    expect(text).not.toMatch(/全OOM contextでmajor|every context|3 context共通|3 contextとも最大/)
    expect(text).toMatch(/mixed#0 では edge-cut 14\.3%.*支配的とは言えない/)
    expect(scopes.statements).toHaveLength(4)
    expect(Object.keys(scopes)).toEqual(expect.arrayContaining(['commonAllocationPath', 'persistentRetention', 'inFlightWorkingSet', 'noInliningScope']))
  })

  it('claims retention in every context only when every context is major, and never claims heap parity for no_inlining', () => {
    const findings = buildPhase2C25CFindings([oomContext('a#0', 134, 0.9, 0.8, 0.95), oomContext('b#0', 7, 0.8, 0.7, 0.9)], [])
    const scopes = buildPhase2C25CConclusionScopes(findings.perContext, h4('supported'), controls)
    expect(scopes.persistentRetention.dominantInEveryContext).toBe(true)
    expect(scopes.statements[1]).toMatch(/全OOM contextでmajor/)
    expect(scopes.noInliningScope).toEqual({ role: 'diagnostic_allocation_attribution', semanticOutputParity: 'confirmed_for_controls', heapAllocationParityWithJitDefault: 'not_proven', controls })
    expect(scopes.statements[3]).toMatch(/diagnostic condition/)
    expect(scopes.statements[3]).toMatch(/heap-allocation parity）は確認していない/)
    const unknown = buildPhase2C25CConclusionScopes(buildPhase2C25CFindings([{ ...oomContext('c#0', 3, 0.9, 0.8, 0.9), snapshot: null }], []).perContext, h4('inconclusive'), { ...controls, contaminated: 1 })
    expect(unknown.persistentRetention.perContext[0].role).toBe('unknown')
    expect(unknown.persistentRetention.dominantInEveryContext).toBe(false)
    expect(unknown.noInliningScope.semanticOutputParity).toBe('not_confirmed')
  })

  it('writes the interpretation within the reviewed boundaries', () => {
    const all = JSON.stringify(PHASE2C25C_INTERPRETATION)
    const conclusions = PHASE2C25C_INTERPRETATION.formalConclusions.join('\n')
    // no_inlining is a diagnostic condition: no unchanged-live-object claim, no Production share claim.
    expect(conclusions).not.toMatch(/live objectは不変|live objects? (are|is) unchanged|Search・data・live object/)
    for (const line of PHASE2C25C_INTERPRETATION.formalConclusions.filter(l => l.includes('no_inlining'))) expect(line).toMatch(/diagnostic/)
    expect(PHASE2C25C_INTERPRETATION.noInliningScope).toMatch(/diagnostic condition/)
    expect(PHASE2C25C_INTERPRETATION.noInliningScope).toMatch(/保証するものではない/)
    // channel.retained is never the common dominant retaining structure; c12-p0 and the in-flight share stay explicit.
    expect(conclusions).not.toMatch(/共通の最大の保持構造|3 contextとも最大の保持構造|3 context共通の支配的保持構造(?!だとは結論しない)/)
    expect(conclusions).toMatch(/c12-p0ではchannel\.retainedは保持要因の1つだが、この512 MB snapshotでは支配的とは言えない/)
    expect(conclusions).toMatch(/58\.2%/)
    expect(PHASE2C25C_INTERPRETATION.q8.candidates.find(c => c.id === 'C3')!.evidence).toMatch(/全OOM patternの最大原因とは言わない/)
    expect(PHASE2C25C_INTERPRETATION.nextPhaseCandidates.join('\n')).toMatch(/peak working set/)
    expect(all).toMatch(/事前登録したResearch判定規則（snapshot edge-cut \+ no_inlining diagnostic sampling）/)
  })
})

describe('Phase 2-C2.5-C findings', () => {
  it('labels growth types by the reached Gogma depth and reads each question from the measures only', () => {
    const sampling = (top: string, bytes: number) => ({ thresholdMiB: 7168, totalSampledBytes: 1000, repositorySelfBytes: 990,
      categories: [{ category: 'bonus_solution_materialization' as const, sampledSelfBytes: bytes, share: bytes / 1000 }, { category: 'reserved_bonus_steps' as const, sampledSelfBytes: 100, share: 0.1 }],
      attributedRepositoryCallsites: [{ key: `${top} src/x.ts:1`, functionName: top, url: 'src/x.ts', category: 'bonus_solution_materialization' as const, sampledSelfBytes: bytes }] })
    const context = (key: string, depth: number, top: string) => ({ contextKey: key, kind: 'k', gogmaMaxDepthAtLastProgress: depth,
      sampling: { jit_default: null, no_inlining: sampling(top, 600) },
      snapshot: { newReachableBytes: 400, persistentNewBytes: 200, groupCutNewBytes: { H4: 100, H1: 40, H2: 20, H3: 4 }, reservedBonusResultNodeShallowBytes: 8 } })
    const findings = buildPhase2C25CFindings([context('a#0', 134, 'bonusAmendmentOperations'), context('b#0', 5, 'serializeStable')], [])
    expect(findings.perContext.map(c => c.growthType)).toEqual(['deep', 'shallow'])
    expect(findings.perContext[0]).toMatchObject({ reservedBonusStepsShare: 0.1, bonusAmendmentOperationsShare: 0.6, snapshotRetainedCutShare: 0.25,
      snapshotRetainedCutShareOfPersistent: 0.5, snapshotPersistentShare: 0.5, snapshotStepsCutShare: 0.05, snapshotResultNodeShallowShare: 0.02 })
    expect(findings.perContext[1].bonusAmendmentOperationsShare).toBe(0)
    expect(findings.answers.Q2.sameTopCallsite).toBe(false)
    expect(findings.answers.Q4.verdict).toBe('inconclusive')
    const missing = buildPhase2C25CFindings([{ ...context('c#0', 3, 'x'), snapshot: null, sampling: { jit_default: null, no_inlining: null } }], [])
    expect(missing.perContext[0]).toMatchObject({ snapshotRetainedCutShare: null, reservedBonusStepsShare: null, topCallsiteNoInlining: null })
  })
})

// ---------------------------------------------------------------- pre-registered hypothesis rules

describe('Phase 2-C2.5-C hypothesis rules', () => {
  it('judges each context by both measures and never reads a missing measure as 0 %', () => {
    expect(phase2c25cContextStrength(0.3, 0.4)).toBe('strong')
    expect(phase2c25cContextStrength(0.3, 0.1)).toBe('mixed')
    expect(phase2c25cContextStrength(0.01, 0.04)).toBe('none')
    expect(phase2c25cContextStrength(null, 0.9)).toBe('missing')
    expect(phase2c25cVerdict(['strong', 'strong', 'strong'])).toBe('supported')
    expect(phase2c25cVerdict(['none', 'none', 'none'])).toBe('not_supported')
    expect(phase2c25cVerdict(['strong', 'none', 'strong'])).toBe('partially_supported')
    expect(phase2c25cVerdict(['strong', 'strong', 'missing'])).toBe('partially_supported')
    expect(phase2c25cVerdict(['none', 'none', 'missing'])).toBe('partially_supported')
    expect(phase2c25cVerdict(['missing', 'missing', 'missing'])).toBe('inconclusive')
  })

  it('evaluates every hypothesis from the edge-group cuts and the no_inlining sampling categories', () => {
    const graph = buildHeapSnapshotGraph(parseHeapSnapshotText(synthSnapshot(schedulerGraph())))
    const snapshot = analyzeHeapSnapshot(graph, { baselineMaxNodeId: 100, edgeGroups: PHASE2C25C_HYPOTHESES.map(h => h.snapshotEdgeGroup) })
    const sampling = analyzeSamplingHeapProfile(syntheticProfile(), SCRIPTS)
    const [single] = [evaluatePhase2C25CHypotheses([{ contextKey: 'x#0', snapshot, sampling: { no_inlining: { thresholdMiB: 512, analysis: sampling }, jit_default: null } }])]
    const h4 = single.find(h => h.id === 'H4')!
    expect(h4.measures[0]).toMatchObject({ snapshotShare: 1, samplingShare: 150 / 215, samplingShareJitDefault: null, strength: 'strong' })
    expect(h4.verdict).toBe('supported')
    const h2 = single.find(h => h.id === 'H2')!
    expect(h2.measures[0]).toMatchObject({ snapshotShare: 0, samplingShare: 60 / 215, strength: 'mixed' })
    const missing = evaluatePhase2C25CHypotheses([{ contextKey: 'x#0', snapshot: null, sampling: { no_inlining: null, jit_default: null } }])
    expect(missing.every(h => h.verdict === 'inconclusive')).toBe(true)
  })
})

// ---------------------------------------------------------------- isolation

const ORACLE_NAMES = new RegExp(['plannerGlobal' + 'Oracle1657', 'plannerGlobal' + 'LowerBound', 'PLANNER_GLOBAL_' + '1657', 'ORACLE_' + 'RESULT', 'optimum' + 'Route'].join('|'))
const benchmarkSources = import.meta.glob('./plannerGlobalPhase2C25C*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const scriptSources = import.meta.glob('../../scripts/*phase2c25c*.mjs', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const production = import.meta.glob('../{app,components,db,domain,services,stores,workers,pages,presentation,data}/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

describe('Phase 2-C2.5-C isolation', () => {
  it('keeps the oracle, hard-coded IDs and evidence files out of the Research modules', () => {
    const modules = Object.entries(benchmarkSources).filter(([path]) => !path.endsWith('.test.ts'))
    expect(modules.map(([path]) => path).sort()).toEqual(['./plannerGlobalPhase2C25C.ts', './plannerGlobalPhase2C25CAnalysis.ts', './plannerGlobalPhase2C25CProfileAnalysis.ts', './plannerGlobalPhase2C25CSnapshotAnalysis.ts'])
    const ids = parsePhase2C25CEvidence(c25aEvidence).contexts.flatMap(c => [c.targetWeaponId, c.orientationId])
    for (const [, source] of [...modules, ...Object.entries(scriptSources)]) {
      expect(source).not.toMatch(ORACLE_NAMES)
      expect(source).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
      expect(source).not.toMatch(/\b[0-9a-f]{64}\b/i)
      expect(source).not.toMatch(/['"]c\d+-p\d+['"]/)
      for (const id of ids) expect(source.includes(`'${id}'`) || source.includes(`"${id}"`)).toBe(false)
    }
    for (const [, source] of modules) expect(source).not.toMatch(/readFile|fetch\(|from ['"][^'"]*\.json['"]|from ['"]node:/)
    // The Search call never reaches the evidence parsing, and the analyses never run a Planner or a Search.
    const calculation = benchmarkSources['./plannerGlobalPhase2C25C.ts']
    expect(calculation).toMatch(/visitPlannerAlternativeCandidates\(searchInput/)
    for (const path of ['./plannerGlobalPhase2C25CAnalysis.ts', './plannerGlobalPhase2C25CProfileAnalysis.ts', './plannerGlobalPhase2C25CSnapshotAnalysis.ts']) {
      expect(benchmarkSources[path]).not.toMatch(/visitPlannerAlternativeCandidates|preparePlannerAlternativeKernel|createProductionPlan|derivePlannerAlternativeReservation/)
    }
  })

  it('reads the C2.5-A evidence only in the parent and never profiles and snapshots in one child', () => {
    const runner = Object.entries(scriptSources).find(([path]) => path.endsWith('run-planner-global-phase2c25c.mjs'))![1]
    const analyzer = Object.entries(scriptSources).find(([path]) => path.endsWith('analyze-planner-global-phase2c25c.mjs'))![1]
    const children = runner.slice(runner.indexOf("if (role === 'contexts')"), runner.search(/\/\/ -+ parent/))
    expect(children.length).toBeGreaterThan(1000)
    expect(children).not.toMatch(/c25aPath|--c25a|parsePhase2C25CEvidence|view\./)
    const sampling = children.slice(children.indexOf("if (role === 'sampling')"), children.indexOf("if (role === 'snapshot')"))
    const snapshot = children.slice(children.indexOf("if (role === 'snapshot')"))
    expect(sampling).toMatch(/HeapProfiler\.startSampling/)
    expect(sampling).not.toMatch(/writeHeapSnapshot|heapsnapshot/)
    expect(snapshot).toMatch(/writeHeapSnapshot/)
    expect(snapshot).not.toMatch(/HeapProfiler|Session/)
    expect(runner).toMatch(/option\('--c25a'\)/)
    expect(analyzer).not.toMatch(/visitPlannerAlternativeCandidates|runPhase2C25CSearch|createProductionPlan|derivePhase2C25APreSearchContexts/)
    expect(analyzer).toMatch(/calculationCodeChangedSinceMeasuredHead/)
  })

  it('is reached by no Production module, and Production keeps its defaults, schema and versions', () => {
    const paths = Object.keys(production).filter(path => !/\.test\.tsx?$|\.worker\.benchmark|BenchmarkPage|\/pages\/BenchmarkApp/.test(path))
    expect(paths.length).toBeGreaterThan(100)
    expect(paths.filter(path => /plannerGlobalPhase2C25C|PHASE2C25C|phase2c25c/i.test(production[path]))).toEqual([])
    expect(PHASE2C25C_SAMPLING_CHILD_HEAP_MB).toBe(8192)
    expect(PHASE2C25C_SNAPSHOT_CHILD_HEAP_MB).toBe(512)
    expect(PHASE2C25C_CONCURRENCY).toBe(1)
    expect([...PHASE2C25C_PROFILE_THRESHOLDS_MIB]).toEqual([512, 1024, 2048, 4096, 6144, 7168])
    expect(PHASE2C25C_SAMPLING_OPTIONS).toMatchObject({ samplingInterval: 256 * 1024, stackDepth: 64, includeObjectsCollectedByMajorGC: false, includeObjectsCollectedByMinorGC: false })
    expect(PHASE2C25C_SAMPLING_VARIANTS.map(v => v.id)).toEqual(['jit_default', 'no_inlining'])
    expect(CURRENT_CALCULATION_APP_SCHEMA_VERSION).toBe(17)
    expect(DATABASE_SCHEMA_VERSION).toBe(10)
    expect(EXPORT_SCHEMA_VERSION).toBe(13)
    expect(PRODUCTION_RNG_ENGINE_VERSION).toBe('production-rng:c5-e7')
    expect(defaultPlannerOptions).toEqual({ maxPlanSteps: 1000 })
    expect(stableStringify({ ...defaultPlannerAlternativeSearchExtent })).toBe(stableStringify({ maxNormalAdvance: 4, maxGogmaAdvance: 235, maxSkillAdvance: 4 }))
    expect({ ...defaultPlannerAlternativeTrialBounds }).toEqual({ maxCandidateTrialsPerTarget: 2, maxPlannerReruns: 8 })
  })
})
