import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DATABASE_SCHEMA_VERSION } from '../db/AppDatabase'
import { CURRENT_CALCULATION_APP_SCHEMA_VERSION } from '../domain/models/common'
import { EXPORT_SCHEMA_VERSION } from '../domain/models/exportModel'
import { hashStableValue, stableStringify } from '../domain/models/hashing'
import type { TargetWeapon } from '../domain/models/publicTypes'
import { defaultPlannerAlternativeTrialBounds, derivePlannerAlternativeReservation } from '../domain/planner/alternative'
import { defaultPlannerOptions } from '../domain/planner/plannerTypes'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../domain/rng/production/productionRngEngine'
import {
  candidateStableKey,
  defaultPlannerAlternativeSearchExtent,
  normalizePlannerAlternativeReservation,
  visitPlannerAlternativeCandidates,
  type PlannerAlternativeReservation,
  type PlannerAlternativeSearchInput,
} from '../domain/search'
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
import { classifyPhase2C2ChildExit, phase2c2ProductionDefaultConditions, positionRanges, runPhase2C2Baseline, runPhase2C2Kernel } from './plannerGlobalPhase2C2'
import {
  createPhase2C25AProgressObserver,
  derivePhase2C25APreSearchContexts,
  phase2c25aSearchStatus,
  runPhase2C25ASearchOnly,
  PHASE2C25A_CANDIDATE_STOP_BOUND,
  PHASE2C25A_CHILD_HEAP_MB,
  PHASE2C25A_CONCURRENCY,
  type Phase2C25AMemorySample,
  type Phase2C25AProgressSnapshot,
} from './plannerGlobalPhase2C25A'
import {
  analyzePhase2C25ARun,
  comparePhase2C25AContextParity,
  comparePhase2C25AOrientations,
  comparePhase2C25AWithControls,
  createPhase2C25ARunCollector,
  parsePhase2C25AC2Evidence,
  parsePhase2C25AV8FatalGcTrace,
  phase2c25aComparableMetrics,
  phase2c25aGrowthSummary,
  phase2c25aOrientationClassification,
  phase2c25aRunStatus,
  phase2c25aSemanticDigest,
  phase2c25aTargetClassification,
  selectPhase2C25AWorkload,
  type Phase2C25AC2KernelTarget,
  type Phase2C25ARawRun,
} from './plannerGlobalPhase2C25AAnalysis'

/** Every input the Planner Alternative Search received, in call order (kernel and Search-only alike). */
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

/** The parity check takes its digest function as an argument (the runner passes SHA-256); any injective digest works here. */
const sha256 = (value: string) => hashStableValue(value)
const SOURCE_A_SKILL = 'series_skill.fixture.z'
const SOURCE_B_SKILL = 'series_skill.fixture.b-source'
const ENTRY_A = 'build-list.c25a.a'
const ENTRY_B = 'build-list.c25a.b'

/** The Phase 2-C2 synthetic contention: A and B contend for Gogma 10; with either fixed, the other has a later Reset alternative. */
function scenario() {
  const skill = { seriesSkillId: SOURCE_A_SKILL, groupSkillId: null, matchMode: 'all' as const }
  const a: TargetWeapon = orchestrationTarget('target.c25a.a', { priority: 5, idealSkillCondition: skill, practicalSkillCondition: skill })
  const b = skillConstrainedTarget('target.c25a.b', { priority: 1 })
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

async function orientationFixingA() {
  const built = scenario()
  const baseline = await runPhase2C2Baseline(built.input, { createEngine: () => built.engine, now: () => 0 })
  const orientation = baseline.orientations.find(o => o.fixedBuildListEntryId === ENTRY_A)!
  return { built, baseline, orientation }
}

/** The Phase 2-C2 analyzer's evidence form of one recorded kernel Target (SHA-256 keys, position ranges). */
function asEvidenceKernelTarget(target: { targetWeaponId: string; invalidatedBuildListEntryId: string; invalidatedRouteKey: string; fixedRouteBuildListEntryIds: string[];
  reservation: PlannerAlternativeReservation | null; excludedRouteKeys: string[]; outcome: string; trials: { candidateKey: string }[] }): Phase2C25AC2KernelTarget {
  const r = target.reservation
  return {
    targetWeaponId: target.targetWeaponId, invalidatedBuildListEntryId: target.invalidatedBuildListEntryId, invalidatedRouteKeySha256: sha256(target.invalidatedRouteKey),
    fixedRouteBuildListEntryIds: target.fixedRouteBuildListEntryIds,
    reservation: r === null ? null : { normal: r.normal.map(n => ({ counterId: n.counterId, held: positionRanges(n.held), blocked: positionRanges(n.blocked) })),
      skill: { held: positionRanges(r.skill.held), blocked: positionRanges(r.skill.blocked) }, gogma: { held: positionRanges(r.gogma.held), blocked: positionRanges(r.gogma.blocked) },
      exclusiveOwnedWeaponIds: [...r.exclusiveOwnedWeaponIds] },
    excludedRouteKeySha256s: target.excludedRouteKeys.map(sha256), outcome: target.outcome, firstTrialCandidateKeySha256: target.trials[0] ? sha256(target.trials[0].candidateKey) : null,
  }
}

// ---------------------------------------------------------------- workload selection

function fakeEvidence(rows: { id: string; kind: string; outcome: string }[]) {
  return {
    provenance: { measuredHead: 'head', exportSha256: 'export' },
    orientations: rows.map((row, index) => ({ orientationId: row.id, conflictIndex: index, conflictKey: `k${index}`, kind: row.kind, participantBuildListEntryIds: ['e1', 'e2'],
      participantTargetWeaponIds: ['t1', 't2'], fixedBuildListEntryId: 'e1', fixedTargetWeaponId: 't1' })),
    kernel: { results: rows.map(row => ({ orientationId: row.id, process: { outcome: row.outcome },
      targets: row.outcome === 'completed' ? [{ targetWeaponId: 't2', invalidatedBuildListEntryId: 'e2', invalidatedRouteKeySha256: 'x', fixedRouteBuildListEntryIds: ['e1'],
        reservation: null, excludedRouteKeySha256s: ['x'], outcome: 'found', trials: [{ candidateKeySha256: 'y' }] }] : [] })) },
  }
}

const ROWS = [
  { id: 'c0-p0', kind: 'same_gogma_counter', outcome: 'out_of_memory' },
  { id: 'c0-p1', kind: 'same_gogma_counter', outcome: 'out_of_memory' },
  { id: 'c1-p0', kind: 'same_owned_weapon_consumed', outcome: 'completed' },
  { id: 'c1-p1', kind: 'same_owned_weapon_consumed', outcome: 'out_of_memory' },
  { id: 'c2-p0', kind: 'same_skill_counter', outcome: 'completed' },
  { id: 'c3-p0', kind: 'same_gogma_counter', outcome: 'completed' },
  { id: 'c3-p1', kind: 'same_gogma_counter', outcome: 'completed' },
]

describe('Phase 2-C2.5-A workload selection', () => {
  it('selects, per kind and process outcome, the first orientation in the Phase 2-C2 order, deterministically', () => {
    const view = parsePhase2C25AC2Evidence(fakeEvidence(ROWS))
    const selection = selectPhase2C25AWorkload(view)
    expect(selection.selected).toEqual([
      { orientationId: 'c0-p0', kind: 'same_gogma_counter', role: 'oom_representative', c2ProcessOutcome: 'out_of_memory' },
      { orientationId: 'c1-p1', kind: 'same_owned_weapon_consumed', role: 'oom_representative', c2ProcessOutcome: 'out_of_memory' },
      { orientationId: 'c3-p0', kind: 'same_gogma_counter', role: 'completed_control', c2ProcessOutcome: 'completed' },
      { orientationId: 'c2-p0', kind: 'same_skill_counter', role: 'completed_control', c2ProcessOutcome: 'completed' },
      { orientationId: 'c1-p0', kind: 'same_owned_weapon_consumed', role: 'completed_control', c2ProcessOutcome: 'completed' },
    ])
    expect(selection.unavailable).toEqual([{ kind: 'same_skill_counter', role: 'oom_representative' }, { kind: 'same_normal_counter', role: 'completed_control' }])
    expect(selectPhase2C25AWorkload(parsePhase2C25AC2Evidence(fakeEvidence(ROWS)))).toEqual(selection)
    // The order of the evidence decides; no ID is preferred by name.
    const renamed = parsePhase2C25AC2Evidence(fakeEvidence(ROWS.map(row => ({ ...row, id: `z-${row.id}` }))))
    expect(selectPhase2C25AWorkload(renamed).selected.map(s => s.orientationId)).toEqual(selection.selected.map(s => `z-${s.orientationId}`))
    expect(view.orientations.find(o => o.orientationId === 'c1-p0')!.kernelTargets[0].firstTrialCandidateKeySha256).toBe('y')
  })

  it('fails closed on a malformed Phase 2-C2 evidence instead of defaulting a field', () => {
    const evidence = fakeEvidence(ROWS)
    expect(() => parsePhase2C25AC2Evidence({ ...evidence, provenance: {} })).toThrow(/measuredHead/)
    const unknown = structuredClone(evidence)
    unknown.kernel.results[0].process.outcome = 'maybe'
    expect(() => parsePhase2C25AC2Evidence(unknown)).toThrow(/unknown process outcome/)
    const empty = structuredClone(evidence)
    empty.kernel.results[2].targets = []
    expect(() => parsePhase2C25AC2Evidence(empty)).toThrow(/records no kernel Target/)
    const missing = structuredClone(evidence)
    missing.kernel.results.pop()
    expect(() => parsePhase2C25AC2Evidence(missing)).toThrow(/no kernel result/)
  })
})

// ---------------------------------------------------------------- pre-search contexts and parity

describe('Phase 2-C2.5-A pre-search contexts', () => {
  it('rebuilds exactly the Search input the kernel gives its Target: target, origin, fixed Route set, reservation, exclusions and extent', async () => {
    const { built, orientation } = await orientationFixingA()
    searchCalls.inputs = []
    const kernel = await runPhase2C2Kernel(built.input, orientation, phase2c2ProductionDefaultConditions(), { createEngine: () => built.engine, now: () => 0 })
    if (kernel.kernel.status !== 'completed') throw new Error(kernel.kernel.status)
    const kernelSearch = searchCalls.inputs[0] as PlannerAlternativeSearchInput
    const [target] = kernel.kernel.targets

    const prepared = derivePhase2C25APreSearchContexts(built.input, orientation, globalResearchDependencies(built.engine))
    expect(prepared.contexts).toHaveLength(1)
    const [context] = prepared.contexts
    expect(context).toMatchObject({ orientationId: orientation.orientationId, workIndex: 0, targetWeaponId: 'target.c25a.b', status: 'searchable',
      invalidatedBuildListEntryId: ENTRY_B, fixedRouteBuildListEntryIds: [ENTRY_A], extent: defaultPlannerAlternativeSearchExtent })
    expect(context.extent).not.toBe(defaultPlannerAlternativeSearchExtent)
    expect(context.fixedRouteBuildListEntryIds).toEqual(target.fixedRouteBuildListEntryIds)
    expect(context.excludedRouteKeys).toEqual(target.excludedRouteKeys)
    expect(context.excludedRouteKeys).toEqual([candidateStableKey(built.input.buildListEntries.find(e => e.id === ENTRY_B)!.candidateSnapshot)])
    expect(context.invalidatedRouteKey).toBe(target.invalidatedRouteKey)
    expect(context.reservation).toEqual(normalizePlannerAlternativeReservation(target.reservation!))
    expect(context.searchReservation).toEqual(derivePlannerAlternativeReservation([built.input.buildListEntries.find(e => e.id === ENTRY_A)!], built.engine))
    expect(context.originDigest).toBe(hashStableValue(kernelSearch.origin))

    // The Search-only run hands the Search exactly the kernel's input.
    searchCalls.inputs = []
    const record = await runPhase2C25ASearchOnly(built.input, prepared, 0, built.engine, { mode: 'minimal' })
    expect(searchCalls.inputs).toHaveLength(1)
    expect(searchCalls.inputs[0]).toEqual(kernelSearch)
    expect(record.status).toBe('first_candidate')
    expect(record.firstCandidateKey).toBe(target.trials[0].candidateKey)
    expect(record.searchSummary.deliveredCandidates).toBe(PHASE2C25A_CANDIDATE_STOP_BOUND)
    // The digest is a function of the context only.
    expect(derivePhase2C25APreSearchContexts(built.input, orientation, globalResearchDependencies(built.engine)).contexts[0].contextDigest).toBe(context.contextDigest)
  })

  it('matches a completed Phase 2-C2 kernel record, and reports every differing field as a parity failure', async () => {
    const { built, orientation } = await orientationFixingA()
    const kernel = await runPhase2C2Kernel(built.input, orientation, phase2c2ProductionDefaultConditions(), { createEngine: () => built.engine, now: () => 0 })
    if (kernel.kernel.status !== 'completed') throw new Error(kernel.kernel.status)
    const recorded = kernel.kernel.targets.map(asEvidenceKernelTarget)
    const { contexts } = derivePhase2C25APreSearchContexts(built.input, orientation, globalResearchDependencies(built.engine))
    const parity = comparePhase2C25AContextParity(contexts, recorded, sha256)
    expect(parity.matches).toBe(true)
    expect(parity.rows[0].checks).toEqual({ targetWeaponId: true, invalidatedBuildListEntryId: true, invalidatedRouteKey: true, fixedRouteBuildListEntryIds: true, reservation: true, excludedRouteKeys: true })
    const broken = (patch: Partial<Phase2C25AC2KernelTarget>) => comparePhase2C25AContextParity(contexts, [{ ...recorded[0], ...patch }], sha256)
    expect(broken({ reservation: { ...recorded[0].reservation!, gogma: { held: [[1, 99]], blocked: [] } } }).rows[0].checks.reservation).toBe(false)
    expect(broken({ fixedRouteBuildListEntryIds: [] }).rows[0].checks.fixedRouteBuildListEntryIds).toBe(false)
    expect(broken({ excludedRouteKeySha256s: ['0'.repeat(64)] }).rows[0].checks.excludedRouteKeys).toBe(false)
    expect(broken({ targetWeaponId: 'other' }).matches).toBe(false)
    expect(broken({ invalidatedRouteKeySha256: 'f'.repeat(64) }).rows[0].checks.invalidatedRouteKey).toBe(false)
    const extra = comparePhase2C25AContextParity(contexts, [...recorded, recorded[0]], sha256)
    expect(extra).toMatchObject({ matches: false, countMatches: false })
  })

  it('compares this run\'s baseline orientations with the Phase 2-C2 ones field by field', async () => {
    const { baseline } = await orientationFixingA()
    expect(comparePhase2C25AOrientations(baseline.orientations, baseline.orientations).matches).toBe(true)
    const moved = baseline.orientations.map((o, i) => i === 0 ? { ...o, fixedBuildListEntryId: 'x' } : o)
    expect(comparePhase2C25AOrientations(moved, baseline.orientations)).toMatchObject({ matches: false, mismatches: [baseline.orientations[0].orientationId] })
    expect(comparePhase2C25AOrientations(baseline.orientations.slice(1), baseline.orientations).matches).toBe(false)
  })
})

// ---------------------------------------------------------------- observation

function fakeObservation(heapStep = 0) {
  let heap = 100
  let heartbeat: (() => void) | null = null
  const snapshots: Phase2C25AProgressSnapshot[] = []
  const memory = (): Phase2C25AMemorySample => { heap += heapStep; return { heapUsed: heap, heapTotal: heap * 2, rss: heap * 3, external: 1, arrayBuffers: 1 } }
  return {
    snapshots,
    fireHeartbeat: () => heartbeat?.(),
    environment: { memory, emit: (s: Phase2C25AProgressSnapshot) => { snapshots.push(s) }, setHeartbeat: (callback: () => void) => { heartbeat = callback; return () => { heartbeat = null } } },
  }
}

describe('Phase 2-C2.5-A observation', () => {
  it('leaves the Search result and the whole Candidate key sequence unchanged', async () => {
    const { built, orientation } = await orientationFixingA()
    const prepared = derivePhase2C25APreSearchContexts(built.input, orientation, globalResearchDependencies(built.engine))
    const [context] = prepared.contexts
    // A small extent the fixture Engine covers completely, so the whole delivered sequence is compared (as in Phase 2-C2).
    const input = { origin: prepared.prepared.scenario.origin, targetWeaponId: context.targetWeaponId as never, extent: { maxNormalAdvance: 1, maxGogmaAdvance: 5, maxSkillAdvance: 2 }, reservation: context.searchReservation!, excludedRouteKeys: context.excludedRouteKeys }
    const collect = async (instrumented: boolean) => {
      const keys: string[] = []
      const fake = fakeObservation(1)
      const observer = createPhase2C25AProgressObserver({ ...fake.environment, now: () => 0 }, () => ({ predictNormalArtian: 0, predictSkills: 0, resetBonuses: 0, keepBonuses: 0 }), { heartbeatMs: 1, heapGrowthBytes: 1, depthStep: 1 })
      if (instrumented) observer.start()
      const execution = await visitPlannerAlternativeCandidates(input, built.engine, candidate => { keys.push(candidateStableKey(candidate)); return 'continue' },
        instrumented ? { instrumentation: observer.instrumentation } : {})
      observer.stop()
      return { keys, summary: execution.summary, snapshots: fake.snapshots.length }
    }
    const plain = await collect(false)
    const observed = await collect(true)
    expect(plain.keys.length).toBeGreaterThan(0)
    expect(observed.keys).toEqual(plain.keys)
    expect(observed.summary).toEqual(plain.summary)
    expect(observed.snapshots).toBeGreaterThan(1)

    const minimal = await runPhase2C25ASearchOnly(built.input, prepared, 0, built.engine, { mode: 'minimal', now: () => 0 })
    const fake = fakeObservation(0)
    const instrumented = await runPhase2C25ASearchOnly(built.input, prepared, 0, built.engine, { mode: 'instrumented', now: () => 0, observation: fake.environment })
    expect(phase2c25aSemanticDigest(instrumented)).toBe(phase2c25aSemanticDigest(minimal))
    expect(minimal.predictionCounts).toBeNull()
    expect(minimal.finalSnapshot).toBeNull()
    expect(instrumented.predictionCounts).not.toBeNull()
    expect(instrumented.firstCandidateSummary).toEqual(minimal.firstCandidateSummary)
    expect(fake.snapshots.map(s => s.trigger)).toEqual(['start', 'first_candidate', 'final'])
    expect(instrumented.finalSnapshot).toEqual(fake.snapshots.at(-1))
    await expect(runPhase2C25ASearchOnly(built.input, prepared, 0, built.engine, { mode: 'instrumented' })).rejects.toThrow(/observation environment/)
  })

  it('snapshots sparsely on heartbeat, heap growth and depth progress, and keeps a sampled maximum', () => {
    const fake = fakeObservation(10)
    const observer = createPhase2C25AProgressObserver({ ...fake.environment, now: () => 5 }, () => ({ predictNormalArtian: 1, predictSkills: 2, resetBonuses: 3, keepBonuses: 4 }),
      { heartbeatMs: 1000, heapGrowthBytes: 25, depthStep: 5 })
    observer.start()
    const gogma = (depth: number) => observer.instrumentation.onGogmaReservedDepth({ streamIndex: 0, startGogmaCounter: 55, depth, generatedStates: depth * 10, frontierStates: depth, absolutePositions: 2, familyLayouts: 3 })
    gogma(1) // heap +10: no trigger
    gogma(2) // heap +20: no trigger
    gogma(3) // heap +30 since start: heap_growth
    fake.fireHeartbeat()
    observer.instrumentation.onSkillReservedDepth({ streamIndex: 1, startSkillCounter: 341, depth: 1, transitions: 1, states: 1, absolutePositions: 1 })
    observer.stop()
    fake.fireHeartbeat()
    const triggers = fake.snapshots.map(s => s.trigger)
    expect(triggers).toEqual(['start', 'heap_growth', 'heartbeat'])
    const last = fake.snapshots.at(-1)!
    expect(last.lastEvent).toMatchObject({ type: 'gogma', streamIndex: 0, startCounter: 55, depth: 3, gogma: { generatedStates: 30, frontierStates: 3 } })
    expect(last.cumulative).toEqual({ totalSkillStates: 0, totalSkillTransitions: 0, totalGogmaGeneratedStates: 60, totalGogmaFrontierStates: 6 })
    expect(last.predictionCounts).toEqual({ predictNormalArtian: 1, predictSkills: 2, resetBonuses: 3, keepBonuses: 4 })
    expect(last.sampledMax.heapUsed).toBeGreaterThanOrEqual(last.memory.heapUsed)
    expect(last.gogmaDepths.map(d => d.depth)).toEqual([1, 2, 3])
    // Depth progress fires once the maximum depth moved by the step.
    const depthFake = fakeObservation(0)
    const depthObserver = createPhase2C25AProgressObserver({ ...depthFake.environment, now: () => 0 }, () => ({ predictNormalArtian: 0, predictSkills: 0, resetBonuses: 0, keepBonuses: 0 }),
      { heartbeatMs: 1000, heapGrowthBytes: 1e12, depthStep: 5 })
    depthObserver.start()
    for (let depth = 1; depth <= 10; depth += 1) depthObserver.instrumentation.onGogmaReservedDepth({ streamIndex: 0, startGogmaCounter: 0, depth, generatedStates: 1, frontierStates: 1, absolutePositions: 1, familyLayouts: 1 })
    expect(depthFake.snapshots.map(s => [s.trigger, s.maxDepth.gogma])).toEqual([['start', 0], ['depth_progress', 5], ['depth_progress', 10]])
  })
})

// ---------------------------------------------------------------- classification

describe('Phase 2-C2.5-A classification', () => {
  it('maps the Search termination to one status, never merging a consumer stop into exhaustion', () => {
    expect(phase2c25aSearchStatus({ exhausted: false, stoppedByExtent: false }, true, 1)).toBe('first_candidate')
    expect(phase2c25aSearchStatus({ exhausted: false, stoppedByExtent: true }, false, 0)).toBe('stopped_by_extent_before_candidate')
    expect(phase2c25aSearchStatus({ exhausted: true, stoppedByExtent: false }, false, 0)).toBe('exhausted_before_candidate')
    expect(() => phase2c25aSearchStatus({ exhausted: false, stoppedByExtent: false }, true, 2)).toThrow()
    expect(() => phase2c25aSearchStatus({ exhausted: true, stoppedByExtent: false }, false, 1)).toThrow()
    expect(() => phase2c25aSearchStatus({ exhausted: false, stoppedByExtent: false }, false, 0)).toThrow()
  })

  it('keeps a completed Search, an extent stop, exhaustion, an OOM, a timeout and a process failure apart', () => {
    const ok = { code: 0, signal: null, timedOut: false, stderrTail: '', recordWritten: true }
    expect(phase2c25aRunStatus(classifyPhase2C2ChildExit(ok), { status: 'first_candidate' })).toBe('first_candidate')
    expect(phase2c25aRunStatus(classifyPhase2C2ChildExit(ok), { status: 'stopped_by_extent_before_candidate' })).toBe('stopped_by_extent_before_candidate')
    expect(phase2c25aRunStatus(classifyPhase2C2ChildExit(ok), { status: 'exhausted_before_candidate' })).toBe('exhausted_before_candidate')
    const oom = classifyPhase2C2ChildExit({ ...ok, code: 134, recordWritten: false, stderrTail: 'FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory' })
    expect(phase2c25aRunStatus(oom, null)).toBe('out_of_memory')
    expect(phase2c25aRunStatus(classifyPhase2C2ChildExit({ ...ok, timedOut: true, code: null, signal: 'SIGKILL', recordWritten: false }), null)).toBe('timeout')
    expect(phase2c25aRunStatus(classifyPhase2C2ChildExit({ ...ok, code: 1, recordWritten: false, stderrTail: 'Error: boom' }), null)).toBe('process_failure')
    expect(() => phase2c25aRunStatus('completed', null)).toThrow(/without a final record/)
  })

  it('classifies the two modes of one context and the orientation', () => {
    const n = (status: 'first_candidate' | 'exhausted_before_candidate', digest = 'd') => ({ status, semanticDigest: digest })
    const f = (status: 'out_of_memory' | 'timeout' | 'process_failure') => ({ status, semanticDigest: null })
    expect(phase2c25aTargetClassification(f('out_of_memory'), f('out_of_memory'))).toBe('search_only_oom_reproduced')
    expect(phase2c25aTargetClassification(n('first_candidate'), f('out_of_memory'))).toBe('instrumentation_contamination')
    expect(phase2c25aTargetClassification(f('out_of_memory'), n('first_candidate'))).toBe('inconsistent_modes')
    expect(phase2c25aTargetClassification(n('first_candidate'), n('first_candidate'))).toBe('no_oom')
    expect(phase2c25aTargetClassification(n('first_candidate'), n('first_candidate', 'other'))).toBe('observer_semantic_mismatch')
    expect(phase2c25aTargetClassification(f('timeout'), f('out_of_memory'))).toBe('inconclusive')
    expect(phase2c25aTargetClassification(n('exhausted_before_candidate'), f('process_failure'))).toBe('inconclusive')
    expect(phase2c25aOrientationClassification('oom_representative', ['no_oom', 'search_only_oom_reproduced', 'instrumentation_contamination'])).toBe('search_localized')
    expect(phase2c25aOrientationClassification('oom_representative', ['no_oom', 'instrumentation_contamination'])).toBe('measurement_contaminated')
    expect(phase2c25aOrientationClassification('oom_representative', ['no_oom', 'no_oom'])).toBe('not_reproduced_in_first_candidate_search')
    expect(phase2c25aOrientationClassification('oom_representative', ['no_oom', 'inconclusive'])).toBe('inconclusive')
    expect(phase2c25aOrientationClassification('oom_representative', [])).toBe('inconclusive')
    expect(phase2c25aOrientationClassification('completed_control', ['no_oom'])).toBe('control_completed')
    expect(phase2c25aOrientationClassification('completed_control', ['no_oom', 'search_only_oom_reproduced'])).toBe('control_anomaly')
  })
})

// ---------------------------------------------------------------- IPC collection and growth

function snapshot(seq: number, heapUsed: number, generated: number, depth: number, trigger: Phase2C25AProgressSnapshot['trigger'] = 'heartbeat'): Phase2C25AProgressSnapshot {
  const memory = { heapUsed, heapTotal: heapUsed, rss: heapUsed * 2, external: 0, arrayBuffers: 0 }
  return { seq, trigger, elapsedMs: seq * 1000, settledWorkItems: seq * 10, lastEvent: { type: 'gogma', streamIndex: 0, startCounter: 55, depth, skill: null,
    gogma: { generatedStates: 100, frontierStates: 90, absolutePositions: 10, familyLayouts: 5 } }, streams: { skill: 1, gogma: 1 }, maxDepth: { skill: 1, gogma: depth },
    cumulative: { totalSkillStates: 1, totalSkillTransitions: 1, totalGogmaGeneratedStates: generated, totalGogmaFrontierStates: Math.floor(generated * 0.9) },
    predictionCounts: { predictNormalArtian: 0, predictSkills: 1, resetBonuses: depth, keepBonuses: depth * 10 }, memory, sampledMax: memory, skillDepths: [],
    gogmaDepths: Array.from({ length: depth }, (_, i) => ({ depth: i + 1, streams: 1, generatedStates: 100 + i, frontierStates: 90, absolutePositions: 10, familyLayouts: 5, maxGeneratedStatesPerStream: 100 + i, maxFamilyLayoutsPerStream: 5 })) }
}

describe('Phase 2-C2.5-A IPC collection and growth', () => {
  it('keeps every received snapshot when the child dies without a final record, and never turns the OOM into an empty result', () => {
    const collector = createPhase2C25ARunCollector()
    collector.onMessage({ type: 'ready', preparationMs: 1, preSearchMemory: snapshot(0, 1, 0, 0).memory })
    for (let i = 1; i <= 3; i += 1) expect(collector.onMessage({ type: 'snapshot', snapshot: snapshot(i, i * 100, i * 1000, i) })).not.toBeNull()
    expect(collector.hasFinal()).toBe(false)
    const run = collector.finish('out_of_memory')
    expect(run).toMatchObject({ status: 'out_of_memory', childOutcome: 'out_of_memory', final: null, snapshots: 3 })
    expect(run.lastSnapshot!.seq).toBe(3)
    expect(run.compactSnapshots.every(s => !('gogmaDepths' in s))).toBe(true)
    expect(() => createPhase2C25ARunCollector().finish('completed')).toThrow(/without a final record/)
    expect(() => collector.onMessage({ type: 'unknown' })).toThrow(/unknown message type/)
    const completed = createPhase2C25ARunCollector()
    completed.onMessage({ type: 'final', record: { status: 'exhausted_before_candidate' } })
    expect(completed.finish('completed').status).toBe('exhausted_before_candidate')
  })

  it('reads the last V8 GC line of a fatal heap trace', () => {
    const stderr = '[1:0]    48721 ms: Scavenge (interleaved) 8179.5 (8192.1) -> 8175.8 (8200.3) MB, pooled\n[1:0]    49830 ms: Mark-Compact (reduce) 8175.9 (8200.8) -> 8174.8 (8185.3) MB, pooled\nFATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory'
    expect(parsePhase2C25AV8FatalGcTrace(stderr)).toEqual({ lastGc: { atMs: 49830, kind: 'Mark-Compact (reduce)', beforeMb: 8175.9, beforeCommittedMb: 8200.8, afterMb: 8174.8, afterCommittedMb: 8185.3 }, fatal: true })
    expect(parsePhase2C25AV8FatalGcTrace('Error: boom')).toBeNull()
    expect(parsePhase2C25AV8FatalGcTrace(null)).toBeNull()
  })

  it('summarizes growth up to the last snapshot as description only, and compares it with the controls', () => {
    const series = [snapshot(1, 1000, 100, 1), snapshot(2, 2000, 200, 2), snapshot(3, 3000, 300, 3)]
    const growth = phase2c25aGrowthSummary(series, series[2])
    expect(growth.snapshots).toBe(3)
    expect(growth.gogma).toMatchObject({ reachedDepths: 3, maxDepth: 3, maxGeneratedStatesPerDepth: 102, depthOfMaxGeneratedStates: 3 })
    expect(growth.heapVersusStates).toMatchObject({ correlationOnly: true, heapUsedDeltaBytes: 2000, cumulativeGogmaGeneratedDelta: 200, heapUsedDeltaPerGeneratedStateBytes: 10 })
    expect(growth.heapVersusStates.pearsonHeapUsedVsCumulativeGogmaGenerated).toBeCloseTo(1)
    const versus = comparePhase2C25AWithControls(phase2c25aComparableMetrics(series[2]), [phase2c25aComparableMetrics(snapshot(1, 100, 3, 1))])
    expect(versus.cumulativeGogmaGenerated).toEqual({ oomLastSnapshot: 300, controlMax: 3, ratio: 100, log10Ratio: 2 })
    expect(versus.skillMaxDepth.ratio).toBe(1)
  })

  it('classifies a raw run post-hoc, comparing a completed control with the Phase 2-C2 kernel only after the fact', () => {
    const mode = (status: string, final: object | null, last: Phase2C25AProgressSnapshot | null, outcome = status === 'out_of_memory' ? 'out_of_memory' : 'completed') => ({
      process: { outcome, wallMs: 1, exitCode: outcome === 'completed' ? 0 : 134, signal: null, timedOut: false, stderrTail: outcome === 'completed' ? null : 'JavaScript heap out of memory' },
      status, ready: null, final, snapshots: last === null ? 0 : 1, compactSnapshots: [], lastSnapshot: last, arrival: { readyAtMs: null, firstSnapshotAtMs: null, lastSnapshotAtMs: null } })
    const finalRecord = { record: { status: 'first_candidate', searchSummary: { deliveredCandidates: 1 }, firstCandidateKey: 'k', firstCandidateKeySha256: 'y', firstCandidateSummary: null, elapsedMs: 1, timeToFirstMs: 1,
      predictionCounts: null, predictionCountsAtFirstCandidate: null }, postSearchMemory: null, maxRssKiB: 1 }
    const raw = {
      selection: { rule: '', selected: [], unavailable: [], selectedRun: [
        { orientationId: 'c0-p0', kind: 'same_gogma_counter', role: 'oom_representative', c2ProcessOutcome: 'out_of_memory' },
        { orientationId: 'c1-p0', kind: 'same_owned_weapon_consumed', role: 'completed_control', c2ProcessOutcome: 'completed' }] },
      runs: [
        { orientationId: 'c0-p0', role: 'oom_representative', kind: 'same_gogma_counter', workIndex: 0, targetWeaponId: 't2', contextDigest: 'd',
          modes: { minimal: mode('out_of_memory', null, null), instrumented: mode('out_of_memory', null, snapshot(9, 8e9, 9e5, 134)) } },
        { orientationId: 'c1-p0', role: 'completed_control', kind: 'same_owned_weapon_consumed', workIndex: 0, targetWeaponId: 't2', contextDigest: 'e',
          modes: { minimal: mode('first_candidate', finalRecord, null), instrumented: mode('first_candidate', finalRecord, snapshot(2, 3e8, 1e5, 2, 'final')) } },
      ],
    } as unknown as Phase2C25ARawRun
    const view = parsePhase2C25AC2Evidence(fakeEvidence([{ id: 'c0-p0', kind: 'same_gogma_counter', outcome: 'out_of_memory' }, { id: 'c1-p0', kind: 'same_owned_weapon_consumed', outcome: 'completed' }]))
    const result = analyzePhase2C25ARun(raw, view)
    expect(result.orientations.map(o => o.classification)).toEqual(['search_localized', 'control_completed'])
    expect(result.totals).toMatchObject({ contexts: 2, searchOnlyOomContexts: 1, searchLocalizedOrientations: 1, notReproducedOrientations: 0, instrumentationContamination: 0, timeouts: 0, processFailures: 0 })
    expect(result.contexts[0].minimal.v8FatalGc).toBeNull()
    expect(result.contexts[0].growth!.lastSnapshot.maxDepth.gogma).toBe(134)
    expect(result.contexts[1].c2KernelPostHoc).toEqual({ kernelOutcome: 'found', kernelFirstTrialCandidateKeySha256: 'y', searchOnlyFirstCandidateMatchesKernelFirstTrial: true })
    expect(result.controlComparison.oom[0].versusControls!.cumulativeGogmaGenerated.ratio).toBe(9)
  })
})

// ---------------------------------------------------------------- isolation

// Built from parts so that this test itself never names the oracle modules (their own isolation test scans every Research file).
const ORACLE_NAMES = new RegExp(['plannerGlobal' + 'Oracle1657', 'plannerGlobal' + 'LowerBound', 'PLANNER_GLOBAL_' + '1657', 'ORACLE_' + 'RESULT', 'PHASE2C1_' + 'RESULT'].join('|'))
const benchmarkSources = import.meta.glob('./*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const scriptSources = import.meta.glob('../../scripts/*phase2c25a*.mjs', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const production = import.meta.glob('../{app,components,db,domain,services,stores,workers,pages,presentation,data}/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

describe('Phase 2-C2.5-A isolation', () => {
  it('keeps the Phase 2-C2 evidence, the oracle and hard-coded IDs out of the Search calculation', () => {
    const calculation = benchmarkSources['./plannerGlobalPhase2C25A.ts']
    const analysis = benchmarkSources['./plannerGlobalPhase2C25AAnalysis.ts']
    expect(calculation).toBeDefined()
    expect(analysis).toBeDefined()
    for (const source of [calculation, analysis]) {
      expect(source).not.toMatch(ORACLE_NAMES)
      expect(source).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
      expect(source).not.toMatch(/\b[0-9a-f]{64}\b/i)
      expect(source).not.toMatch(/readFile|fetch\(|from ['"][^'"]*\.json['"]/)
      // No Counter position or orientation id is named in code.
      expect(source).not.toMatch(/['"]c\d+-p\d+['"]/)
    }
    // The calculation never imports the evidence-reading analysis; the analysis never runs a Planner or a Search.
    expect(calculation).not.toMatch(/plannerGlobalPhase2C25AAnalysis|parsePhase2C25AC2Evidence|PHASE2C2_RESULT/)
    expect(analysis).not.toMatch(/visitPlannerAlternativeCandidates|preparePlannerAlternativeKernel|createProductionPlan|runPlannerAlternativeKernel|derivePlannerAlternativeReservation/)
    // The reservation is the Planner authority's, never rebuilt from Route units here.
    expect(calculation).toMatch(/derivePlannerAlternativeReservation\(/)
    expect(calculation).not.toMatch(/createPlannerRouteUnitPlans/)
  })

  it('reads the Phase 2-C2 evidence only as an explicit runner argument, and never hands it to a Search child', () => {
    const runner = Object.entries(scriptSources).find(([path]) => path.endsWith('run-planner-global-phase2c25a.mjs'))![1]
    const analyzer = Object.entries(scriptSources).find(([path]) => path.endsWith('analyze-planner-global-phase2c25a.mjs'))![1]
    for (const source of [runner, analyzer]) {
      expect(source).not.toMatch(ORACLE_NAMES)
      expect(source).not.toMatch(/--optimum|--c1\b|\b[0-9a-f]{64}\b/)
      expect(source).toMatch(/option\('--c2'\)/)
      expect(source).not.toMatch(/PLANNER_GLOBAL_PHASE2C2_RESULT\.json['"]\)/)
    }
    const childSections = runner.slice(runner.indexOf("if (role === 'contexts')"), runner.search(/\/\/ -+ parent/))
    expect(childSections.length).toBeGreaterThan(500)
    expect(childSections).not.toMatch(/c2Path|--c2|parsePhase2C25AC2Evidence|analysis\.|view\./)
    expect(childSections).toMatch(/derivePhase2C25APreSearchContexts\(input, task\.orientation/)
    expect(analyzer).not.toMatch(/visitPlannerAlternativeCandidates|runPhase2C25ASearchOnly|createProductionPlan|derivePhase2C25APreSearchContexts/)
    expect(analyzer).toMatch(/calculationCodeChangedSinceMeasuredHead/)
  })

  it('is reached by no Production module, and Production keeps its defaults, schema and versions', () => {
    const paths = Object.keys(production).filter(path => !/\.test\.tsx?$|\.worker\.benchmark|BenchmarkPage|\/pages\/BenchmarkApp/.test(path))
    expect(paths.length).toBeGreaterThan(100)
    expect(paths.filter(path => /plannerGlobalPhase2C25A|PHASE2C25A|phase2c25a/i.test(production[path]))).toEqual([])
    expect(PHASE2C25A_CHILD_HEAP_MB).toBe(8192)
    expect(PHASE2C25A_CONCURRENCY).toBe(1)
    expect(PHASE2C25A_CANDIDATE_STOP_BOUND).toBe(1)
    expect(CURRENT_CALCULATION_APP_SCHEMA_VERSION).toBe(17)
    expect(DATABASE_SCHEMA_VERSION).toBe(10)
    expect(EXPORT_SCHEMA_VERSION).toBe(13)
    expect(PRODUCTION_RNG_ENGINE_VERSION).toBe('production-rng:c5-e7')
    expect(defaultPlannerOptions).toEqual({ maxPlanSteps: 1000 })
    expect(stableStringify({ ...defaultPlannerAlternativeSearchExtent })).toBe(stableStringify({ maxNormalAdvance: 4, maxGogmaAdvance: 235, maxSkillAdvance: 4 }))
    expect({ ...defaultPlannerAlternativeTrialBounds }).toEqual({ maxCandidateTrialsPerTarget: 2, maxPlannerReruns: 8 })
  })
})
