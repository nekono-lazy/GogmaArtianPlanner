import { describe, expect, it } from 'vitest'
import c25aEvidence from '../../docs/PLANNER_GLOBAL_PHASE2C25A_RESULT.json'
import d2aResult from '../../docs/PLANNER_GLOBAL_PHASE2C25D2A_RESULT.json'
import { DATABASE_SCHEMA_VERSION } from '../db/AppDatabase'
import { CURRENT_CALCULATION_APP_SCHEMA_VERSION } from '../domain/models/common'
import { EXPORT_SCHEMA_VERSION } from '../domain/models/exportModel'
import { hashStableValue, stableStringify } from '../domain/models/hashing'
import type { TargetWeapon } from '../domain/models/publicTypes'
import { defaultPlannerAlternativeTrialBounds } from '../domain/planner/alternative'
import { defaultPlannerOptions } from '../domain/planner/plannerTypes'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../domain/rng/production/productionRngEngine'
import { defaultPlannerAlternativeSearchExtent } from '../domain/search'
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
import { globalResearchDependencies } from './plannerGlobalOptimizationResearch'
import { runPhase2C2Baseline } from './plannerGlobalPhase2C2'
import { derivePhase2C25APreSearchContexts } from './plannerGlobalPhase2C25A'
import { parsePhase2C25CEvidence, runPhase2C25CSearch, selectPhase2C25CWorkload, type Phase2C25CWorkload } from './plannerGlobalPhase2C25C'
import {
  comparePhase2C25D2CSemantics,
  createPhase2C25D2CProgressObserver,
  parsePhase2C25D2CD2AResult,
  phase2c25d2cSamplingPlan,
  phase2c25d2cThresholdMiss,
  phase2c25d2cWorkloadItems,
  selectPhase2C25D2CWorkload,
  PHASE2C25D2C_CANDIDATE_STOP_BOUND,
  PHASE2C25D2C_CONCURRENCY,
  PHASE2C25D2C_PROFILE_THRESHOLDS_MIB,
  PHASE2C25D2C_SAMPLING_CHILD_HEAP_MB,
  PHASE2C25D2C_SAMPLING_OPTIONS,
  PHASE2C25D2C_SNAPSHOT_CHILD_HEAP_MB,
  PHASE2C25D2C_SNAPSHOT_ROLES,
  PHASE2C25D2C_VARIANTS_BY_ROLE,
  type Phase2C25D2CD2AView,
  type Phase2C25D2CWorkloadItem,
} from './plannerGlobalPhase2C25D2C'
import {
  analyzePhase2C25D2CProfile,
  analyzePhase2C25D2CSnapshot,
  categorizePhase2C25D2CStack,
  evaluatePhase2C25D2CEffect,
  evaluatePhase2C25D2CHypotheses,
  phase2c25d2cContextLevel,
  phase2c25d2cEffectLevel,
  phase2c25d2cOverallLevel,
  phase2c25d2cStringClass,
  phase2c25d2cStrongestEffect,
  selectPhase2C25D2CRecommendation,
  PHASE2C25D2C_HOLDER_SIGNATURES,
  PHASE2C25D2C_HYPOTHESES,
  PHASE2C25D2C_IN_FLIGHT_COMBINED,
  PHASE2C25D2C_RULES,
  type Phase2C25D2CContextInputs,
  type Phase2C25D2CFrame,
} from './plannerGlobalPhase2C25D2CAnalysis'
import { PHASE2C25D2C_INTERPRETATION } from './plannerGlobalPhase2C25D2CInterpretation'
import { validateSamplingHeapProfile, type SamplingHeapProfileNode } from './plannerGlobalPhase2C25CProfileAnalysis'
import { buildHeapSnapshotGraph, parseHeapSnapshotText } from './plannerGlobalPhase2C25CSnapshotAnalysis'

const digest = (value: string) => hashStableValue(value)

// ---------------------------------------------------------------- workload

describe('Phase 2-C2.5-D2-c workload', () => {
  const c25cWorkload = () => selectPhase2C25CWorkload(parsePhase2C25CEvidence(c25aEvidence))

  it('derives the primary OOM, the cleared reference and the controls from the committed D2-a RESULT, never by ID', () => {
    const view = parsePhase2C25D2CD2AResult(d2aResult)
    const workload = selectPhase2C25D2CWorkload(view, c25cWorkload())
    // Primary: every D2-a OOM representative out of memory in both modes; cleared: the one that ended normally in both.
    const both = (status: (s: string) => boolean) => view.contexts.filter(c => c.role === 'oom_representative' && status(c.minimal.status) && status(c.instrumented.status))
    expect(workload.primary.map(i => i.d2aIndex)).toEqual(both(s => s === 'out_of_memory').map(c => c.d2aIndex))
    expect(workload.clearedReferences.map(i => i.d2aIndex)).toEqual(both(s => s !== 'out_of_memory').map(c => c.d2aIndex))
    expect(workload.primary).toHaveLength(2)
    expect(workload.clearedReferences).toHaveLength(1)
    expect(workload.unselected).toEqual([])
    expect(workload.primary.every(i => i.expected.status === 'out_of_memory' && i.expected.searchSummary === null)).toBe(true)
    expect(workload.clearedReferences[0].expected.status).toBe('stopped_by_extent_before_candidate')
    expect(workload.controls.map(c => c.role)).toEqual(['control_first_candidate', 'control_stopped_by_extent'])
    // The controls are the C2.5-C rule's, with the D2-a digests.
    const c25c = c25cWorkload()
    expect(workload.controls.map(c => `${c.orientationId}#${c.workIndex}:${c.contextDigest}`)).toEqual(c25c.controls.map(c => `${c.orientationId}#${c.workIndex}:${c.contextDigest}`))
    // The D2-a depth record travels with the item (reference only): shallow primaries, a deep cleared reference.
    expect(workload.primary.every(i => (i.d2aDepth.gogmaMaxDepth ?? 99) < 20 && (i.d2aDepth.maxGeneratedStatesPerDepth ?? 0) > 1_000_000)).toBe(true)
    expect(workload.clearedReferences[0].d2aDepth.gogmaMaxDepth).toBeGreaterThan(200)
    expect(phase2c25d2cWorkloadItems(workload).map(i => i.role)).toEqual(['primary_oom', 'primary_oom', 'cleared_reference', 'control_first_candidate', 'control_stopped_by_extent'])
  })

  function fakeView(statuses: [string, string][], controlParity = true): { view: Phase2C25D2CD2AView; c25c: Phase2C25CWorkload } {
    const mode = (status: string) => ({ status: status as never, searchSummary: status === 'out_of_memory' ? null : { deliveredCandidates: 0 }, firstCandidateKeySha256: null })
    const item = (i: number, role: string) => ({ role, evidenceIndex: i, orientationId: `o${i}`, kind: 'k', workIndex: 0, targetWeaponId: `t${i}`, contextDigest: `d${i}` })
    const oom = statuses.map((_, i) => item(i, 'oom_representative'))
    const controls = [item(statuses.length, 'control_first_candidate'), item(statuses.length + 1, 'control_stopped_by_extent')]
    const depth = { gogmaMaxDepth: 1, maxGeneratedStatesPerDepth: 1, depthOfMaxGeneratedStates: 1, cumulativeGogmaGenerated: 1 }
    const contexts = [
      ...statuses.map(([a, b], i) => ({ d2aIndex: i, orientationId: `o${i}`, workIndex: 0, role: 'oom_representative', kind: 'k', targetWeaponId: `t${i}`, minimal: mode(a), instrumented: mode(b), controlParityMatches: null, instrumentedDepth: depth })),
      ...controls.map((c, j) => ({ d2aIndex: statuses.length + j, orientationId: c.orientationId, workIndex: 0, role: c.role, kind: 'k', targetWeaponId: c.targetWeaponId,
        minimal: mode(j === 0 ? 'first_candidate' : 'stopped_by_extent_before_candidate'), instrumented: mode(j === 0 ? 'first_candidate' : 'stopped_by_extent_before_candidate'),
        controlParityMatches: controlParity, instrumentedDepth: depth })),
    ]
    const view: Phase2C25D2CD2AView = { exportSha256: 'e', measuredHead: 'h', c25aEvidenceSha256: 'c', workloadSelection: { oomRepresentatives: oom, controls }, contexts, contextParityMatches: true }
    const expected = { status: 'out_of_memory' as const, searchSummary: null, firstCandidateKeySha256: null }
    const c25c: Phase2C25CWorkload = { rule: 'r', oomRepresentatives: oom.map(o => ({ ...o, role: 'oom_representative' as const, expected })),
      controls: controls.map(c => ({ ...c, role: c.role as never, expected })) }
    return { view, c25c }
  }

  it('reports an OOM representative whose modes differ as unselected, and fails closed on a disagreement', () => {
    const { view, c25c } = fakeView([['out_of_memory', 'out_of_memory'], ['out_of_memory', 'first_candidate'], ['first_candidate', 'first_candidate']])
    const workload = selectPhase2C25D2CWorkload(view, c25c)
    expect(workload.primary.map(i => i.orientationId)).toEqual(['o0'])
    expect(workload.clearedReferences.map(i => i.orientationId)).toEqual(['o2'])
    expect(workload.unselected).toEqual([{ orientationId: 'o1', workIndex: 0, reason: 'D2-a modes out_of_memory / first_candidate' }])
    // The D2-a selection must be the C2.5-C one.
    expect(() => selectPhase2C25D2CWorkload(view, { ...c25c, controls: [...c25c.controls].reverse() })).toThrow(/differs from the C2.5-C workload/)
    expect(() => selectPhase2C25D2CWorkload(view, { ...c25c, oomRepresentatives: c25c.oomRepresentatives.map(i => ({ ...i, contextDigest: 'x' })) })).toThrow(/differs/)
    // A control without D2-a semantic parity, or no primary at all, fails closed.
    expect(() => selectPhase2C25D2CWorkload(fakeView([['out_of_memory', 'out_of_memory']], false).view, fakeView([['out_of_memory', 'out_of_memory']], false).c25c)).toThrow(/lacks semantic parity/)
    const cleared = fakeView([['first_candidate', 'first_candidate']])
    expect(() => selectPhase2C25D2CWorkload(cleared.view, cleared.c25c)).toThrow(/no OOM representative/)
  })

  it('fails closed on a non-formal or malformed D2-a RESULT', () => {
    const clone = () => structuredClone(d2aResult) as unknown as Record<string, unknown>
    const nonFormal = clone(); (nonFormal.provenance as Record<string, unknown>).formal = false
    expect(() => parsePhase2C25D2CD2AResult(nonFormal)).toThrow(/formal/)
    const badStatus = clone(); ((((badStatus.contexts as unknown[])[0] as Record<string, unknown>).after as Record<string, Record<string, Record<string, unknown>>>).minimal.view).status = 'oom'
    expect(() => parsePhase2C25D2CD2AResult(badStatus)).toThrow(/unknown/)
    const noSelection = clone(); delete noSelection.workloadSelection
    expect(() => parsePhase2C25D2CD2AResult(noSelection)).toThrow(/workloadSelection/)
  })

  it('plans jit_default and no_inlining for the primaries and controls, jit_default only for the cleared reference, snapshots for the primaries only', () => {
    const workload = selectPhase2C25D2CWorkload(parsePhase2C25D2CD2AResult(d2aResult), c25cWorkload())
    const plan = phase2c25d2cSamplingPlan(workload)
    const roles = (variant: string) => plan.filter(p => p.variant === variant).map(p => p.item.role)
    expect(roles('jit_default')).toEqual(['primary_oom', 'primary_oom', 'cleared_reference', 'control_first_candidate', 'control_stopped_by_extent'])
    expect(roles('no_inlining')).toEqual(['primary_oom', 'primary_oom', 'control_first_candidate', 'control_stopped_by_extent'])
    expect(plan.findIndex(p => p.variant === 'no_inlining')).toBe(5)
    expect(PHASE2C25D2C_VARIANTS_BY_ROLE.cleared_reference).toEqual(['jit_default'])
    expect(PHASE2C25D2C_SNAPSHOT_ROLES).toEqual(['primary_oom'])
  })
})

// ---------------------------------------------------------------- the Search call, progress, parity

const SOURCE_A_SKILL = 'series_skill.fixture.z'
const SOURCE_B_SKILL = 'series_skill.fixture.b-source'
const ENTRY_A = 'build-list.d2c.a'
const ENTRY_B = 'build-list.d2c.b'

async function preparedFixingA() {
  const skill = { seriesSkillId: SOURCE_A_SKILL, groupSkillId: null, matchMode: 'all' as const }
  const a: TargetWeapon = orchestrationTarget('target.d2c.a', { priority: 5, idealSkillCondition: skill, practicalSkillCondition: skill })
  const b = skillConstrainedTarget('target.d2c.b', { priority: 1 })
  const built = orchestrationScenario({
    targets: [a, b],
    ownedWeapons: [orchestrationSource(ORCHESTRATION_SOURCE_A, { seriesSkillId: SOURCE_A_SKILL }),
      orchestrationSource(ORCHESTRATION_SOURCE_B, { restorationBonuses: belowPracticalBonuses(), seriesSkillId: SOURCE_B_SKILL })],
    entries: [
      orchestrationEntry(ENTRY_A, a, resetRoute(ORCHESTRATION_SOURCE_A), { finalBonuses: idealBonuses(), seriesSkillId: SOURCE_A_SKILL }),
      orchestrationEntry(ENTRY_B, b, { kind: 'existing_gogma_mixed', sourceOwnedWeaponId: resetRoute(ORCHESTRATION_SOURCE_B).sourceOwnedWeaponId,
        operations: [...resetRoute(ORCHESTRATION_SOURCE_B).operations, ...resetSkillsRoute(ORCHESTRATION_SOURCE_B).operations] }),
    ],
  })
  const baseline = await runPhase2C2Baseline(built.input, { createEngine: () => built.engine, now: () => 0 })
  const orientation = baseline.orientations.find(o => o.fixedBuildListEntryId === ENTRY_A)!
  return { built, prepared: derivePhase2C25APreSearchContexts(built.input, orientation, globalResearchDependencies(built.engine)) }
}

describe('Phase 2-C2.5-D2-c progress observer and semantic parity', () => {
  it('records per-depth generated / frontier counts only, and never changes the Search result', async () => {
    const { built, prepared } = await preparedFixingA()
    const index = prepared.contexts.findIndex(c => c.status === 'searchable')
    const plain = await runPhase2C25CSearch(prepared, index, built.engine, { now: () => 0 })
    const progress = createPhase2C25D2CProgressObserver()
    const observed = await runPhase2C25CSearch(prepared, index, built.engine, { now: () => 0, instrumentation: progress.instrumentation })
    expect(stableStringify(observed)).toBe(stableStringify(plain))
    const snapshot = progress.snapshot()
    expect(snapshot.gogmaDepths.length).toBe(snapshot.gogmaEvents)
    const max = Math.max(0, ...snapshot.gogmaDepths.map(d => d.generatedStates))
    expect(snapshot.gogmaDepthMaxima.maxGeneratedStatesInOneDepth).toBe(max)
    expect(snapshot.gogmaDepths.reduce((n, d) => n + d.generatedStates, 0)).toBe(snapshot.cumulative.gogmaGeneratedStates)
    // Numbers only: every per-depth record has exactly the four count fields.
    for (const d of snapshot.gogmaDepths) expect(Object.keys(d).sort()).toEqual(['depth', 'frontierStates', 'generatedStates', 'streamIndex'])
  })

  it('tracks the largest depth and its frontier from the events alone', () => {
    const progress = createPhase2C25D2CProgressObserver()
    const gogma = progress.instrumentation.onGogmaReservedDepth!
    gogma({ streamIndex: 0, startGogmaCounter: 5, depth: 1, generatedStates: 10, frontierStates: 4, absolutePositions: 3, familyLayouts: 2 })
    gogma({ streamIndex: 1, startGogmaCounter: 5, depth: 3, generatedStates: 50, frontierStates: 2, absolutePositions: 3, familyLayouts: 2 })
    gogma({ streamIndex: 0, startGogmaCounter: 5, depth: 2, generatedStates: 20, frontierStates: 9, absolutePositions: 3, familyLayouts: 2 })
    expect(progress.snapshot().gogmaDepthMaxima).toEqual({ maxGeneratedStatesInOneDepth: 50, depthOfMaxGenerated: 3, streamIndexOfMaxGenerated: 1,
      maxFrontierStatesInOneDepth: 9, depthOfMaxFrontier: 2, streamIndexOfMaxFrontier: 0 })
    expect(progress.snapshot().cumulative).toEqual({ gogmaGeneratedStates: 80, gogmaFrontierStates: 15, skillStates: 0 })
  })

  it('reports a normally ending run as contaminated when status, summary, first Candidate key or the extent flags differ from D2-a', () => {
    const summary = { deliveredCandidates: 1, excludedCandidates: 0, exhausted: false, stoppedByExtent: false, stoppedByConsumer: true, skippedExcludedRouteKeys: 0 }
    const item = { orientationId: 'o', workIndex: 0, role: 'control_first_candidate', expected: { status: 'first_candidate', searchSummary: summary, firstCandidateKeySha256: digest('k') } } as unknown as Phase2C25D2CWorkloadItem
    expect(comparePhase2C25D2CSemantics(item, 'jit_default', { status: 'first_candidate', searchSummary: summary, firstCandidateKey: 'k' }, digest).contaminated).toBe(false)
    expect(comparePhase2C25D2CSemantics(item, 'jit_default', { status: 'first_candidate', searchSummary: summary, firstCandidateKey: 'other' }, digest)).toMatchObject({ firstCandidateKeyMatches: false, contaminated: true })
    expect(comparePhase2C25D2CSemantics(item, 'no_inlining', { status: 'first_candidate', searchSummary: { ...summary, stoppedByExtent: true }, firstCandidateKey: 'k' }, digest))
      .toMatchObject({ searchSummaryMatches: false, extentAndExhaustionMatch: false, contaminated: true })
    expect(comparePhase2C25D2CSemantics(item, 'no_inlining', null, digest).contaminated).toBe(true)
  })

  it('explains a threshold without a profile, never folding an OOM into a profiling failure', () => {
    const run = (outcome: string) => ({ outcome, capturedThresholds: [512, 1024], failedThresholds: [2048] })
    expect(phase2c25d2cThresholdMiss(512, run('out_of_memory'))).toBe('reached')
    expect(phase2c25d2cThresholdMiss(2048, run('out_of_memory'))).toBe('profile_failed')
    expect(phase2c25d2cThresholdMiss(7168, run('out_of_memory'))).toBe('out_of_memory_before_threshold')
    expect(phase2c25d2cThresholdMiss(7168, run('stopped_by_extent_before_candidate'))).toBe('search_ended_before_threshold')
    expect(phase2c25d2cThresholdMiss(7168, run('timeout'))).toBe('child_failed_before_threshold')
  })
})

// ---------------------------------------------------------------- sampling categories

const F = (functionName: string, url: string): Phase2C25D2CFrame => ({ functionName, url, repository: url.startsWith('src/') })

describe('Phase 2-C2.5-D2-c sampling categories', () => {
  it('attributes an allocation to the innermost named Repository frame and resolves key helpers by their caller', () => {
    const scheduler = F('settle', 'src/domain/search/targetSearchScheduler.ts')
    const ensure = F('ensureReserved', 'src/domain/search/bonusStream.ts')
    const stringify = F('stableStringify', 'src/domain/models/hashing.ts')
    const serialize = F('serializeStable', 'src/domain/models/hashing.ts')
    const builtin = F('join', '')
    expect(categorizePhase2C25D2CStack([scheduler, ensure])).toBe('reserved_generation')
    expect(categorizePhase2C25D2CStack([scheduler, ensure, F('reservedBonusSteps', 'src/domain/search/bonusStream.ts'), F('push', '')])).toBe('reserved_steps')
    expect(categorizePhase2C25D2CStack([scheduler, ensure, F('reservedGeneratedState', 'src/domain/search/bonusStream.ts'), F('keepFamilyLayoutKey', 'src/domain/rng/gogmaBonusFamily.ts'), builtin])).toBe('family_layout_key')
    // A stable key built for the held-aware frontier is not a Candidate semantic key of the scheduler publication.
    expect(categorizePhase2C25D2CStack([scheduler, ensure, F('compareReservedRepresentative', 'src/domain/search/bonusStream.ts'), stringify, serialize, builtin])).toBe('reserved_key_generation')
    expect(categorizePhase2C25D2CStack([scheduler, ensure, stringify, serialize])).toBe('reserved_key_generation')
    expect(categorizePhase2C25D2CStack([scheduler, F('evaluateBonusSolutions', 'src/domain/search/streamSolutions.ts'), stringify, serialize])).toBe('publication_keys')
    expect(categorizePhase2C25D2CStack([scheduler, stringify])).toBe('publication_keys')
    expect(categorizePhase2C25D2CStack([F('x', 'src/domain/foo.ts'), stringify])).toBe('other_keys')
    expect(categorizePhase2C25D2CStack([scheduler, F('bonusAmendmentOperations', 'src/domain/search/bonusStream.ts')])).toBe('publication_materialization')
    expect(categorizePhase2C25D2CStack([scheduler, ensure, F('predictKeep', 'src/domain/search/bonusStream.ts')])).toBe('rng_prediction')
    expect(categorizePhase2C25D2CStack([F('predictGogmaBonus', 'src/domain/rng/production/productionRngEngine.ts')])).toBe('rng_prediction')
    expect(categorizePhase2C25D2CStack([scheduler])).toBe('scheduler_publication')
    expect(categorizePhase2C25D2CStack([F('(root)', ''), F('x', 'node_modules/vite/dist/x.js')])).toBe('dependency')
    expect(categorizePhase2C25D2CStack([F('(root)', ''), F('(garbage collector)', '')])).toBe('runtime')
    // An anonymous Repository frame is skipped (its bytes go to the named frame that called it).
    expect(categorizePhase2C25D2CStack([ensure, F('', 'src/domain/search/bonusStream.ts'), builtin])).toBe('reserved_generation')
  })

  it('sums category bytes to the sampled total and counts inclusive bytes once per function per allocation', () => {
    let id = 1
    const node = (functionName: string, scriptId: string, selfSize: number, children: SamplingHeapProfileNode[] = []): SamplingHeapProfileNode =>
      ({ callFrame: { functionName, scriptId, url: '', lineNumber: 0, columnNumber: 0 }, selfSize, id: id++, children })
    const steps = node('reservedBonusSteps', '11', 40)
    const recursion = node('ensureReserved', '11', 5)
    const layout = node('keepFamilyLayoutKey', '12', 30)
    const ensure = node('ensureReserved', '11', 100, [steps, node('', '11', 20, [recursion]), layout])
    const head = node('(root)', '0', 0, [node('settle', '10', 10, [ensure]), node('foo', '5', 7)])
    const scripts = { urlOf: (s: string) => ({ '10': 'D:/GogmaArtianPlanner/src/domain/search/targetSearchScheduler.ts', '11': 'D:/GogmaArtianPlanner/src/domain/search/bonusStream.ts',
      '12': 'D:/GogmaArtianPlanner/src/domain/rng/gogmaBonusFamily.ts', '5': 'node:internal/x' } as Record<string, string>)[s] ?? null }
    const result = analyzePhase2C25D2CProfile(validateSamplingHeapProfile({ head, samples: [] }), scripts)
    expect(result.totalSampledBytes).toBe(212)
    expect(result.categories.reduce((n, c) => n + c.sampledSelfBytes, 0)).toBe(212)
    const bytes = (category: string) => result.categories.find(c => c.category === category)?.sampledSelfBytes
    expect(bytes('reserved_generation')).toBe(125)
    expect(bytes('reserved_steps')).toBe(40)
    expect(bytes('family_layout_key')).toBe(30)
    expect(bytes('scheduler_publication')).toBe(10)
    expect(bytes('runtime')).toBe(7)
    const inclusive = (key: string) => result.inclusive.find(i => i.key === key)?.sampledInclusiveBytes
    // ensureReserved appears twice on one stack (recursion under an anonymous frame) and is counted once.
    expect(inclusive('src/domain/search/bonusStream.ts#ensureReserved')).toBe(195)
    expect(inclusive('src/domain/search/targetSearchScheduler.ts#settle')).toBe(205)
    expect(result.base.totalSampledBytes).toBe(212)
  })
})

// ---------------------------------------------------------------- snapshot analysis

interface SynthNode { type: string; name: string; id: number; self: number; edges: { type: string; name: string | number; to: number }[] }
const NODE_TYPES = ['hidden', 'array', 'string', 'object', 'code', 'closure', 'regexp', 'number', 'native', 'synthetic', 'concatenated string', 'sliced string', 'symbol', 'bigint', 'object shape']
const EDGE_TYPES = ['context', 'element', 'property', 'internal', 'hidden', 'shortcut', 'weak']

function synthSnapshot(nodes: SynthNode[]): string {
  const nodeFields = ['type', 'name', 'id', 'self_size', 'edge_count', 'detachedness']
  const edgeFields = ['type', 'name_or_index', 'to_node']
  const strings: string[] = []
  const str = (s: string) => { const i = strings.indexOf(s); if (i >= 0) return i; strings.push(s); return strings.length - 1 }
  const flatNodes: number[] = []
  for (const n of nodes) {
    const values: Record<string, number> = { name: str(n.name), type: NODE_TYPES.indexOf(n.type), edge_count: n.edges.length, id: n.id, self_size: n.self, detachedness: 0 }
    for (const f of nodeFields) flatNodes.push(values[f])
  }
  const flatEdges: number[] = []
  for (const n of nodes) for (const e of n.edges) {
    const values: Record<string, number> = { to_node: e.to * nodeFields.length, type: EDGE_TYPES.indexOf(e.type), name_or_index: typeof e.name === 'number' ? e.name : str(e.name) }
    for (const f of edgeFields) flatEdges.push(values[f])
  }
  const header = { meta: { node_fields: nodeFields, node_types: nodeFields.map(f => f === 'type' ? NODE_TYPES : 'number'), edge_fields: edgeFields,
    edge_types: edgeFields.map(f => f === 'type' ? EDGE_TYPES : f === 'to_node' ? 'node' : 'string_or_number') }, node_count: nodes.length, edge_count: flatEdges.length / 3 }
  return `{"snapshot":${JSON.stringify(header)},"nodes":[${flatNodes.join(',')}],"edges":[${flatEdges.join(',')}],"strings":${JSON.stringify(strings)}}`
}

/**
 * baseline (ids <= 10): root, GC roots, stack roots.
 * persistent: scheduler -> context (bonusStream closure) -reservedSets-> set {depths, frontier, ...} -depths-> [[solution]]
 *   solution {steps -> [step], results -> node -result-> result, -step-> step}; frontier -> [state(frontier)]
 * in-flight (stack roots): generated JSArray -> [state] (familyLayoutKey string, results -> node2), map Vector FixedArray -> [solution2 {steps -> [step2], results -> node2}]
 */
function reservedGraph(): SynthNode[] {
  const N: SynthNode[] = []
  const add = (n: Omit<SynthNode, 'edges'> & { edges?: SynthNode['edges'] }) => { N.push({ edges: [], ...n }); return N.length - 1 }
  const root = add({ type: 'synthetic', name: '', id: 1, self: 0 })
  const gc = add({ type: 'synthetic', name: '(GC roots)', id: 3, self: 0 })
  const stack = add({ type: 'synthetic', name: '(Stack roots)', id: 5, self: 0 })
  const step = add({ type: 'object', name: 'Object', id: 101, self: 40 })
  N[step].edges = [{ type: 'property', name: 'gogmaCounterAfter', to: step }, { type: 'property', name: 'gogmaCounterBefore', to: step }]
  const result = add({ type: 'object', name: 'Object', id: 103, self: 40 })
  const bonuses = add({ type: 'object', name: 'Array', id: 9, self: 32 })
  N[result].edges = [{ type: 'property', name: 'restorationBonusScope', to: bonuses }, { type: 'property', name: 'restorationBonuses', to: bonuses }]
  const node = add({ type: 'object', name: 'Object', id: 105, self: 56 })
  N[node].edges = [{ type: 'property', name: 'depth', to: bonuses }, { type: 'property', name: 'previous', to: bonuses }, { type: 'property', name: 'result', to: result }, { type: 'property', name: 'step', to: step }]
  const stepsArray = add({ type: 'object', name: 'Array', id: 107, self: 32 })
  const stepsStore = add({ type: 'array', name: '(object elements)', id: 109, self: 152 })
  N[stepsArray].edges = [{ type: 'element', name: 0, to: step }, { type: 'internal', name: 'elements', to: stepsStore }]
  const solution = add({ type: 'object', name: 'Object', id: 111, self: 72 })
  N[solution].edges = ['bonuses', 'depth', 'lastResetDepth', 'restorationBonusScope'].map(p => ({ type: 'property', name: p, to: bonuses }))
  N[solution].edges.push({ type: 'property', name: 'results', to: node }, { type: 'property', name: 'steps', to: stepsArray })
  const depth0 = add({ type: 'object', name: 'Array', id: 113, self: 32 })
  N[depth0].edges = [{ type: 'element', name: 0, to: solution }]
  const depths = add({ type: 'object', name: 'Array', id: 115, self: 32 })
  N[depths].edges = [{ type: 'element', name: 0, to: depth0 }]
  const stateProps = ['bonuses', 'depth', 'familyLayoutKey', 'lastResetDepth', 'nextFrom', 'position', 'results', 'scope']
  const layoutString = (id: number) => add({ type: 'string', name: 'bonus_type.attack bonus_type.attack bonus_type.affinity bonus_type.element bonus_type.attack', id, self: 136 })
  const frontierKey = layoutString(117)
  const frontierState = add({ type: 'object', name: 'Object', id: 119, self: 80 })
  N[frontierState].edges = stateProps.map(p => ({ type: 'property', name: p, to: p === 'familyLayoutKey' ? frontierKey : p === 'results' ? node : bonuses }))
  const frontier = add({ type: 'object', name: 'Array', id: 121, self: 32 })
  N[frontier].edges = [{ type: 'element', name: 0, to: frontierState }]
  const set = add({ type: 'object', name: 'Object', id: 123, self: 64 })
  N[set].edges = ['cutByExtent', 'done', 'index', 'unsupported', 'windows'].map(p => ({ type: 'property', name: p, to: bonuses }))
  N[set].edges.push({ type: 'property', name: 'depths', to: depths }, { type: 'property', name: 'frontier', to: frontier })
  const sets = add({ type: 'object', name: 'Map', id: 125, self: 40 })
  N[sets].edges = [{ type: 'internal', name: 'table', to: set }]
  const context = add({ type: 'object', name: 'system / Context', id: 127, self: 48 })
  N[context].edges = [{ type: 'context', name: 'reservedSets', to: sets }]
  const scheduler = add({ type: 'object', name: 'TargetSearchScheduler', id: 129, self: 40 })
  N[scheduler].edges = [{ type: 'property', name: 'context', to: context }]
  // in-flight
  const node2 = add({ type: 'object', name: 'Object', id: 131, self: 56 })
  N[node2].edges = [{ type: 'property', name: 'depth', to: bonuses }, { type: 'property', name: 'previous', to: node }, { type: 'property', name: 'result', to: result }, { type: 'property', name: 'step', to: step }]
  const genKey = layoutString(133)
  const genState = add({ type: 'object', name: 'Object', id: 135, self: 80 })
  N[genState].edges = stateProps.map(p => ({ type: 'property', name: p, to: p === 'familyLayoutKey' ? genKey : p === 'results' ? node2 : bonuses }))
  const generated = add({ type: 'object', name: 'Array', id: 137, self: 32 })
  N[generated].edges = [{ type: 'element', name: 0, to: genState }]
  const step2 = add({ type: 'object', name: 'Object', id: 139, self: 40 })
  N[step2].edges = [{ type: 'property', name: 'gogmaCounterAfter', to: step2 }, { type: 'property', name: 'gogmaCounterBefore', to: step2 }]
  const steps2 = add({ type: 'object', name: 'Array', id: 141, self: 32 })
  N[steps2].edges = [{ type: 'element', name: 0, to: step2 }]
  const solution2 = add({ type: 'object', name: 'Object', id: 143, self: 72 })
  N[solution2].edges = ['bonuses', 'depth', 'lastResetDepth', 'restorationBonusScope'].map(p => ({ type: 'property', name: p, to: bonuses }))
  N[solution2].edges.push({ type: 'property', name: 'results', to: node2 }, { type: 'property', name: 'steps', to: steps2 })
  const vector = add({ type: 'array', name: '', id: 145, self: 48 })
  N[vector].edges = [{ type: 'internal', name: '0', to: solution2 }, { type: 'internal', name: 'map', to: bonuses }]
  N[stack].edges = [{ type: 'internal', name: '0', to: generated }, { type: 'internal', name: '1', to: vector }, { type: 'internal', name: '2', to: scheduler }]
  N[gc].edges = [{ type: 'element', name: 0, to: stack }]
  N[root].edges = [{ type: 'element', name: 0, to: gc }]
  return N
}

describe('Phase 2-C2.5-D2-c snapshot analysis', () => {
  const analyzed = () => analyzePhase2C25D2CSnapshot(buildHeapSnapshotGraph(parseHeapSnapshotText(synthSnapshot(reservedGraph()))), { baselineMaxNodeId: 10 })

  it('splits new bytes into persistent (a TargetSearchScheduler reaches them) and in-flight, and every cut the same way', () => {
    const result = analyzed()
    expect(result.persistent.roots).toBe(1)
    expect(result.newRoot.size).toBe(result.persistent.newSize + result.inFlight.newSize)
    // In-flight: generated array + state + its key + node2 + vector + solution2 + steps2 + step2.
    expect(result.inFlight.newSize).toBe(32 + 80 + 136 + 56 + 48 + 72 + 32 + 40)
    const cut = (group: string) => result.splitCuts.find(g => g.group === group)!
    // depths keeps the published solution, its steps[] and store, and the depth array (node / step / result are shared).
    expect(cut('H1').cut).toMatchObject({ newSize: 32 + 32 + 72 + 32 + 152, persistentNewSize: 32 + 32 + 72 + 32 + 152, inFlightNewSize: 0 })
    expect(cut('H2').matchedEdges).toBe(2)
    // steps2 is the only holder of step2; the persistent step is also held by node.step.
    expect(cut('H2').cut).toMatchObject({ persistentNewSize: 32 + 152, inFlightNewSize: 32 + 40 })
    expect(cut('H5').cut.newSize).toBe(32 + 80 + 136)
    expect(cut('H9').cut).toMatchObject({ persistentNewSize: 136, inFlightNewSize: 136 })
    expect(cut('H4').matchedEdges).toBe(0)
    expect(JSON.stringify(result)).not.toMatch(/retainedSize|retained size/i)
  })

  it('measures the in-flight generated[] and the map store apart and together, never counting a persistent array', () => {
    const result = analyzed()
    const cut = (label: string) => result.inFlightArrayCuts.find(g => g.elementSignature === label)!
    expect(cut(PHASE2C25D2C_HOLDER_SIGNATURES.reservedBonusState)).toMatchObject({ arrays: 1, elements: 1 })
    // generated alone keeps the array, the state and its key string (node2 is shared with the map store's solution).
    expect(cut(PHASE2C25D2C_HOLDER_SIGNATURES.reservedBonusState).cut.newSize).toBe(32 + 80 + 136)
    expect(cut(PHASE2C25D2C_HOLDER_SIGNATURES.reservedBonusSolution)).toMatchObject({ arrays: 1, elements: 1 })
    expect(cut(PHASE2C25D2C_HOLDER_SIGNATURES.reservedBonusSolution).cut.newSize).toBe(48 + 72 + 32 + 40)
    expect(cut(PHASE2C25D2C_IN_FLIGHT_COMBINED).cut.newSize).toBe(result.inFlight.newSize)
    const census = result.arrayCensus.map(a => `${a.class}:${a.kind}:${a.elementSignature}`)
    expect(census).toContain(`in_flight:fixed_array:${PHASE2C25D2C_HOLDER_SIGNATURES.reservedBonusSolution}`)
    expect(census).toContain(`persistent:js_array:${PHASE2C25D2C_HOLDER_SIGNATURES.reservedBonusState}`)
    // A JSArray backing store is never a second (fixed) array.
    expect(result.arrayCensus.filter(a => a.kind === 'fixed_array' && a.elementSignature.includes('gogmaCounter'))).toEqual([])
    const strings = Object.fromEntries(result.stringCensus.map(s => [s.class, s]))
    expect(strings.family_layout_key).toMatchObject({ persistent: { count: 1, size: 136 }, inFlight: { count: 1, size: 136 } })
    expect(result.inFlightArrayPaths[0].path?.steps.map(s => s.from.name)).toEqual(['', '(GC roots)', '(Stack roots)'])
  })

  it('classifies layout keys whatever the NUL separator became in the snapshot', () => {
    const key = ['bonus_type.attack', 'bonus_type.affinity', 'bonus_type.element', 'bonus_type.attack', 'bonus_type.gogma_sharpness_capacity']
    expect(phase2c25d2cStringClass('string', key.join('\u0000'))).toBe('family_layout_key')
    expect(phase2c25d2cStringClass('string', key.join(' '))).toBe('family_layout_key')
    expect(phase2c25d2cStringClass('string', `114 ${key.join(' ')}`)).toBe('position_layout_key')
    expect(phase2c25d2cStringClass('string', key.slice(0, 4).join(' '))).toBe('other_string')
    expect(phase2c25d2cStringClass('string', '[{"a":1}]')).toBe('stable_json')
    expect(phase2c25d2cStringClass('concatenated string', 'x')).toBe('concatenated_string')
  })
})

// ---------------------------------------------------------------- pre-registered rules

describe('Phase 2-C2.5-D2-c rules', () => {
  it('fixes the per-context level at the registered thresholds and never reads a missing measure as 0 %', () => {
    expect(phase2c25d2cContextLevel(0.25, 0.10)).toBe('strong')
    expect(phase2c25d2cContextLevel(0.25, 0.0999)).toBe('contributing')
    expect(phase2c25d2cContextLevel(0.2499, 0.9)).toBe('contributing')
    expect(phase2c25d2cContextLevel(0.05, 0)).toBe('contributing')
    expect(phase2c25d2cContextLevel(0.0499, 0.5)).toBe('minor')
    expect(phase2c25d2cContextLevel(0.004, 0.02)).toBe('minor')
    expect(phase2c25d2cContextLevel(0.004, 0.009)).toBe('not_supported')
    expect(phase2c25d2cContextLevel(null, 0.5)).toBe('inconclusive')
    expect(phase2c25d2cContextLevel(0.5, null)).toBe('inconclusive')
    expect(phase2c25d2cOverallLevel(['strong', 'contributing'])).toBe('contributing')
    expect(phase2c25d2cOverallLevel(['strong', 'strong'])).toBe('strong')
    expect(phase2c25d2cOverallLevel(['minor', 'not_supported'])).toBe('not_supported')
    expect(phase2c25d2cOverallLevel(['strong', 'inconclusive'])).toBe('inconclusive')
    expect(phase2c25d2cOverallLevel([])).toBe('inconclusive')
  })

  it('reads an old major as gone only when it is gone in every context', () => {
    expect(phase2c25d2cEffectLevel([0.3, null, 0])).toBe('major')
    expect(phase2c25d2cEffectLevel([0.01, 0.06, null])).toBe('contributing')
    expect(phase2c25d2cEffectLevel([0.0005, 0.002])).toBe('minor')
    expect(phase2c25d2cEffectLevel([0, 0.0009])).toBe('not_observed')
    expect(phase2c25d2cEffectLevel([null, null])).toBe('not_available')
    expect(phase2c25d2cStrongestEffect(['not_observed', 'minor'])).toBe('minor')
    expect(phase2c25d2cStrongestEffect(['not_available', 'not_observed'])).toBe('not_observed')
  })

  function inputs(key: string, cuts: Record<string, number>, arrays: Record<string, number>, categories: Record<string, number>): Phase2C25D2CContextInputs {
    const cut = (newSize: number) => ({ nodes: 1, newNodes: 1, newSize, persistentNewSize: newSize, inFlightNewSize: 0 })
    const total = Object.values(categories).reduce((a, b) => a + b, 0)
    const analysis = { totalSampledBytes: total, categories: Object.entries(categories).map(([category, sampledSelfBytes]) => ({ category: category as never, sampledSelfBytes, share: sampledSelfBytes / total })) }
    return { contextKey: key, snapshot: { newRoot: { nodes: 1, size: 1000 },
      splitCuts: PHASE2C25D2C_HYPOTHESES.flatMap(h => h.snapshot.type === 'edge_group' ? [{ group: h.snapshot.group.group, matchedEdges: 1, cut: cut(cuts[h.id] ?? 0) }] : []),
      inFlightArrayCuts: PHASE2C25D2C_HYPOTHESES.flatMap(h => h.snapshot.type === 'in_flight_arrays' ? [{ elementSignature: h.snapshot.elementSignature, arrays: 1, elements: 1, maxLength: 1, cut: cut(arrays[h.id] ?? 0) }] : []) },
    sampling: { jit_default: { thresholdMiB: 7168, analysis }, no_inlining: null } }
  }

  it('evaluates every hypothesis from its own snapshot measure and the jit_default categories, and ranks the recommendation mechanically', () => {
    const categories = { reserved_generation: 600, reserved_steps: 100, family_layout_key: 50, scheduler_publication: 5, rng_prediction: 1, runtime: 244 }
    const hypotheses = evaluatePhase2C25D2CHypotheses([
      inputs('a', { H1: 700, H2: 300, H3: 100, H9: 60, H4: 0 }, { H6: 280, H7: 20 }, categories),
      inputs('b', { H1: 400, H2: 350, H3: 30, H9: 80, H4: 0 }, { H6: 300, H7: 0 }, categories),
    ])
    const level = (id: string) => hypotheses.find(h => h.id === id)!.level
    expect(level('H1')).toBe('strong')
    expect(level('H2')).toBe('strong')
    expect(level('H3')).toBe('minor')
    expect(level('H4')).toBe('not_supported')
    expect(level('H6')).toBe('strong')
    expect(level('H7')).toBe('minor')
    expect(level('H9')).toBe('contributing')
    expect(hypotheses.find(h => h.id === 'H3')!.sameLevelInEveryContext).toBe(false)
    const recommendation = selectPhase2C25D2CRecommendation(hypotheses)
    // min snap: H1 0.40, H2 0.30, H6 0.28.
    expect(recommendation.pool).toBe('strong')
    expect(recommendation.primary?.id).toBe('H1')
    expect(recommendation.secondary.map(s => s.id)).toEqual(['H2', 'H6'])
    // Without a snapshot every hypothesis is inconclusive and nothing is recommended.
    const missing = evaluatePhase2C25D2CHypotheses([{ ...inputs('a', {}, {}, categories), snapshot: null }])
    expect(missing.every(h => h.level === 'inconclusive')).toBe(true)
    expect(selectPhase2C25D2CRecommendation(missing)).toMatchObject({ pool: 'none', primary: null })
  })

  it('reads the D2-a effect from the post-D2 measures of the old majors', () => {
    const empty = { nodes: 0, newNodes: 0, newSize: 0, persistentNewSize: 0, inFlightNewSize: 0 }
    const snapshot = { newRoot: { nodes: 1, size: 1000 }, splitCuts: ['H4', 'route_bonus_operations', 'route_bonus_amendment_results', 'evaluated_solution_keys'].map(group => ({ group, matchedEdges: 0, cut: empty })) }
    const profile = (categories: Record<string, number>) => ({ totalSampledBytes: 100, categories: Object.entries(categories).map(([category, sampledSelfBytes]) => ({ category: category as never, sampledSelfBytes, share: sampledSelfBytes / 100 })),
      base: { totalSampledBytes: 100, attributedCallsites: [] } as never })
    const effect = evaluatePhase2C25D2CEffect([{ contextKey: 'a', snapshot, jitDefault: profile({ reserved_generation: 99, scheduler_publication: 1 }), noInlining: profile({ reserved_generation: 100 }) }])
    expect(Object.fromEntries(effect.map(e => [e.id, e.level]))).toEqual({ channel_retained: 'minor', bonus_amendment_operations: 'not_observed',
      bonus_amendment_results: 'not_observed', candidate_semantic_keys: 'not_observed' })
  })

  it('keeps the rules serializable for the formal digest, and the interpretation empty until the evidence exists or complete after it', () => {
    expect(() => stableStringify(PHASE2C25D2C_RULES)).not.toThrow()
    expect(PHASE2C25D2C_HYPOTHESES.map(h => h.id)).toEqual(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7', 'H8', 'H9'])
    expect(PHASE2C25D2C_HYPOTHESES.filter(h => h.retention === 'in_flight').map(h => h.id)).toEqual(['H6', 'H7'])
    if (PHASE2C25D2C_INTERPRETATION !== null) {
      expect(PHASE2C25D2C_INTERPRETATION.writtenAfterFormalEvidence).toBe(true)
      expect(PHASE2C25D2C_INTERPRETATION.recommendation.notImplementedInThisPhase).toBe(true)
      expect(PHASE2C25D2C_INTERPRETATION.formalConclusions.length).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------- isolation

const ORACLE_NAMES = new RegExp(['plannerGlobal' + 'Oracle1657', 'plannerGlobal' + 'LowerBound', 'PLANNER_GLOBAL_' + '1657', 'ORACLE_' + 'RESULT'].join('|'))
const benchmarkSources = import.meta.glob('./plannerGlobalPhase2C25D2C*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const scriptSources = import.meta.glob('../../scripts/*phase2c25d2c*.mjs', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const production = import.meta.glob('../{app,components,db,domain,services,stores,workers,pages,presentation,data}/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

describe('Phase 2-C2.5-D2-c isolation', () => {
  it('keeps hard-coded IDs, hashes, the oracle and file reads out of the Research modules', () => {
    const modules = Object.entries(benchmarkSources).filter(([path]) => !path.endsWith('.test.ts'))
    expect(modules.map(([path]) => path).sort()).toEqual(['./plannerGlobalPhase2C25D2C.ts', './plannerGlobalPhase2C25D2CAnalysis.ts', './plannerGlobalPhase2C25D2CInterpretation.ts'])
    const ids = parsePhase2C25D2CD2AResult(d2aResult).contexts.flatMap(c => [c.targetWeaponId, c.orientationId])
    for (const [, source] of [...modules, ...Object.entries(scriptSources)]) {
      expect(source).not.toMatch(ORACLE_NAMES)
      expect(source).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
      expect(source).not.toMatch(/\b[0-9a-f]{64}\b/i)
      expect(source).not.toMatch(/['"]c\d+-p\d+['"]/)
      for (const id of ids) expect(source.includes(`'${id}'`) || source.includes(`"${id}"`)).toBe(false)
    }
    for (const [, source] of modules) expect(source).not.toMatch(/readFile|fetch\(|from ['"][^'"]*\.json['"]|from ['"]node:/)
    // The calculation calls the unchanged C2.5-C Search; the analysis never runs a Planner or a Search.
    expect(benchmarkSources['./plannerGlobalPhase2C25D2C.ts']).not.toMatch(/visitPlannerAlternativeCandidates|createProductionPlan/)
    expect(benchmarkSources['./plannerGlobalPhase2C25D2CAnalysis.ts']).not.toMatch(/visitPlannerAlternativeCandidates|runPhase2C25CSearch|createProductionPlan|derivePlannerAlternativeReservation/)
  })

  it('reads the evidence only in the parent, never profiles and snapshots in one child, and fails closed on changed rules or code', () => {
    const runner = Object.entries(scriptSources).find(([path]) => path.endsWith('run-planner-global-phase2c25d2c.mjs'))![1]
    const analyzer = Object.entries(scriptSources).find(([path]) => path.endsWith('analyze-planner-global-phase2c25d2c.mjs'))![1]
    const children = runner.slice(runner.indexOf("if (role === 'contexts')"), runner.search(/\/\/ -+ parent/))
    expect(children.length).toBeGreaterThan(1000)
    expect(children).not.toMatch(/d2aPath|c25aPath|--d2a|--c25a|parsePhase2C25D2CD2AResult|parsePhase2C25CEvidence|PHASE2C25D2C_RULES/)
    const sampling = children.slice(children.indexOf("if (role === 'sampling')"), children.indexOf("if (role === 'snapshot')"))
    const snapshot = children.slice(children.indexOf("if (role === 'snapshot')"))
    expect(sampling).toMatch(/HeapProfiler\.startSampling/)
    expect(sampling).not.toMatch(/writeHeapSnapshot|heapsnapshot/)
    expect(snapshot).toMatch(/writeHeapSnapshot/)
    expect(snapshot).not.toMatch(/HeapProfiler|Session/)
    expect(runner).toMatch(/runPhase2C25CSearch\(prepared, task\.workIndex, engine/)
    expect(runner).toMatch(/rulesSha256 = sha256\(hashing\.stableStringify\(analysis\.PHASE2C25D2C_RULES\)\)/)
    expect(analyzer).not.toMatch(/visitPlannerAlternativeCandidates|runPhase2C25CSearch|createProductionPlan|derivePhase2C25APreSearchContexts/)
    expect(analyzer).toMatch(/calculationCodeChangedSinceMeasuredHead/)
    expect(analyzer).toMatch(/rulesSha256 !== r\.environment\.rulesSha256/)
  })

  it('is reached by no Production module, and Production keeps its defaults, schema and versions', () => {
    const paths = Object.keys(production).filter(path => !/\.test\.tsx?$|\.worker\.benchmark|BenchmarkPage|\/pages\/BenchmarkApp/.test(path))
    expect(paths.length).toBeGreaterThan(100)
    expect(paths.filter(path => /plannerGlobalPhase2C25D2C|PHASE2C25D2C|phase2c25d2c/i.test(production[path]))).toEqual([])
    expect(PHASE2C25D2C_SAMPLING_CHILD_HEAP_MB).toBe(8192)
    expect(PHASE2C25D2C_SNAPSHOT_CHILD_HEAP_MB).toBe(512)
    expect(PHASE2C25D2C_CONCURRENCY).toBe(1)
    expect(PHASE2C25D2C_CANDIDATE_STOP_BOUND).toBe(1)
    expect([...PHASE2C25D2C_PROFILE_THRESHOLDS_MIB]).toEqual([512, 1024, 2048, 4096, 6144, 7168])
    expect(PHASE2C25D2C_SAMPLING_OPTIONS).toMatchObject({ samplingInterval: 256 * 1024, stackDepth: 64, includeObjectsCollectedByMajorGC: false, includeObjectsCollectedByMinorGC: false })
    expect(CURRENT_CALCULATION_APP_SCHEMA_VERSION).toBe(17)
    expect(DATABASE_SCHEMA_VERSION).toBe(10)
    expect(EXPORT_SCHEMA_VERSION).toBe(13)
    expect(PRODUCTION_RNG_ENGINE_VERSION).toBe('production-rng:c5-e7')
    expect(defaultPlannerOptions).toEqual({ maxPlanSteps: 1000 })
    expect(stableStringify({ ...defaultPlannerAlternativeSearchExtent })).toBe(stableStringify({ maxNormalAdvance: 4, maxGogmaAdvance: 235, maxSkillAdvance: 4 }))
    expect({ ...defaultPlannerAlternativeTrialBounds }).toEqual({ maxCandidateTrialsPerTarget: 2, maxPlannerReruns: 8 })
  })
})
