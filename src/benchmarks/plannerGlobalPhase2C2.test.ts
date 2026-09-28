import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DATABASE_SCHEMA_VERSION } from '../db/AppDatabase'
import { CURRENT_CALCULATION_APP_SCHEMA_VERSION, recommendedCandidateSearchDefaults } from '../domain/models/common'
import { EXPORT_SCHEMA_VERSION } from '../domain/models/exportModel'
import { stableStringify } from '../domain/models/hashing'
import type { BuildListEntryId, PlanConflict, TargetWeapon } from '../domain/models/publicTypes'
import { defaultPlannerAlternativeTrialBounds } from '../domain/planner/alternative'
import { defaultPlannerOptions } from '../domain/planner/plannerTypes'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../domain/rng/production/productionRngEngine'
import { candidateStableKey, defaultPlannerAlternativeSearchExtent, normalizePlannerAlternativeReservation } from '../domain/search'
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
import { BENCHMARK_ONLY_EXTENT_GRID } from './plannerAlternativeBenchmarkFixtures'
import {
  buildPhase2C2Portfolio,
  classifyPhase2C2ChildExit,
  derivePhase2C2Orientations,
  phase2c2Diversity,
  phase2c2KernelRequest,
  phase2c2NextProbeExtent,
  phase2c2ProbeAxis,
  phase2c2ProbeDecision,
  phase2c2ProductionDefaultConditions,
  phase2c2SearchStatus,
  positionRanges,
  respectsPhase2C2Reservation,
  runPhase2C2Baseline,
  runPhase2C2Kernel,
  runPhase2C2PortfolioContext,
  summarizePhase2C2Entry,
  PHASE2C2_PORTFOLIO_CAPTURE_BOUND,
  type Phase2C2CandidateSummary,
  type Phase2C2Conditions,
  type Phase2C2SearchContextRecord,
} from './plannerGlobalPhase2C2'
import { comparePhase2C2BaselineWithC1, phase2c2OracleCoverage } from './plannerGlobalPhase2C2Analysis'

/** Every input the Planner Alternative Search received, in call order (kernel and post-hoc portfolio Search alike). */
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

const SOURCE_A_SKILL = 'series_skill.fixture.z'
const SOURCE_B_SKILL = 'series_skill.fixture.b-source'
const ENTRY_A = 'build-list.c2.a'
const ENTRY_B = 'build-list.c2.b'

/**
 * A (its source's own Skill is Ideal; one Reset at the contested Gogma 10 completes it) and B (Reset at 10 + Reset
 * Skills at 7) contend for Gogma 10. With either one fixed, the other has a later Reset alternative (Ideal at 12).
 */
function scenario() {
  const skill = { seriesSkillId: SOURCE_A_SKILL, groupSkillId: null, matchMode: 'all' as const }
  const a: TargetWeapon = orchestrationTarget('target.c2.a', { priority: 5, idealSkillCondition: skill, practicalSkillCondition: skill })
  const b = skillConstrainedTarget('target.c2.b', { priority: 1 })
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

const CONDITIONS: Phase2C2Conditions = { extent: { maxNormalAdvance: 1, maxGogmaAdvance: 5, maxSkillAdvance: 2 }, bounds: { maxCandidateTrialsPerTarget: 2, maxPlannerReruns: 8 }, captureBound: 8 }

function conflict(id: string, kind: PlanConflict['kind'], entries: string[]): PlanConflict {
  return { id, kind, buildListEntryIds: entries as BuildListEntryId[], reason: '', recommendedBuildListEntryId: null, selectedBuildListEntryId: null, resolutionNote: null }
}

describe('Phase 2-C2 orientations', () => {
  it('derives one orientation per participant of every baseline Conflict, from the Conflict itself', () => {
    const { input } = scenario()
    const conflicts = [conflict('k-two', 'same_gogma_counter', [ENTRY_B, ENTRY_A]), conflict('k-three', 'same_skill_counter', [ENTRY_A, ENTRY_B, ENTRY_A])]
    const orientations = derivePhase2C2Orientations(input, conflicts)
    expect(orientations).toHaveLength(2 + 3)
    expect(orientations.map(o => o.orientationId)).toEqual(['c0-p0', 'c0-p1', 'c1-p0', 'c1-p1', 'c1-p2'])
    expect(orientations[0]).toMatchObject({ conflictKey: 'k-two', kind: 'same_gogma_counter', fixedBuildListEntryId: ENTRY_B, fixedTargetWeaponId: 'target.c2.b',
      participantBuildListEntryIds: [ENTRY_B, ENTRY_A], participantTargetWeaponIds: ['target.c2.b', 'target.c2.a'] })
    expect(orientations[1]).toMatchObject({ fixedBuildListEntryId: ENTRY_A, fixedTargetWeaponId: 'target.c2.a' })
    expect(() => derivePhase2C2Orientations(input, [conflict('k', 'same_gogma_counter', ['build-list.unknown'])])).toThrow(/not in the Planner input/)
  })

  it('builds the kernel request from the Conflict key and participant, with no lineage and Production defaults as spread copies', () => {
    const { input } = scenario()
    const [orientation] = derivePhase2C2Orientations(input, [conflict('k-two', 'same_gogma_counter', [ENTRY_A, ENTRY_B])])
    const conditions = phase2c2ProductionDefaultConditions()
    expect(conditions.extent).toEqual(defaultPlannerAlternativeSearchExtent)
    expect(conditions.extent).not.toBe(defaultPlannerAlternativeSearchExtent)
    expect(conditions.bounds).toEqual(defaultPlannerAlternativeTrialBounds)
    expect(conditions.bounds).not.toBe(defaultPlannerAlternativeTrialBounds)
    expect(conditions.captureBound).toBe(PHASE2C2_PORTFOLIO_CAPTURE_BOUND)
    const request = phase2c2KernelRequest(input, orientation, conditions)
    expect(request.decision).toEqual({ conflictKey: 'k-two', selectedBuildListEntryId: ENTRY_A })
    expect(request.priorFixedBuildListEntryIds).toEqual([])
    expect(request.priorExcludedRoutes).toEqual([])
    expect(request.plannerInput).toBe(input)
    expect(request.extent).toEqual(conditions.extent)
    expect(request.extent).not.toBe(conditions.extent)
  })
})

describe('Phase 2-C2 kernel and post-hoc portfolio Search', () => {
  it('runs the baseline Planner, the kernel per orientation, and the portfolio Search with the kernel\'s own origin, reservation and exclusions', async () => {
    const built = scenario()
    const before = structuredClone(built.input)
    const deps = { createEngine: () => built.engine, now: () => 0 }
    const baseline = await runPhase2C2Baseline(built.input, deps)
    expect(baseline.summary.conflicts).toBeGreaterThan(0)
    expect(baseline.orientations.length).toBe(baseline.summary.conflicts * 2)
    expect(baseline.originals.map(o => o.buildListEntryId).sort()).toEqual([ENTRY_A, ENTRY_B])
    expect(baseline.originals.every(o => o.stableKey === candidateStableKey(built.input.buildListEntries.find(e => e.id === o.buildListEntryId)!.candidateSnapshot))).toBe(true)

    const orientation = baseline.orientations.find(o => o.fixedBuildListEntryId === ENTRY_A)!
    searchCalls.inputs = []
    const record = await runPhase2C2Kernel(built.input, orientation, CONDITIONS, deps)
    if (record.kernel.status !== 'completed') throw new Error(record.kernel.status)
    const [target] = record.kernel.targets
    const context = await runPhase2C2PortfolioContext(built.input, target, orientation, CONDITIONS, CONDITIONS.extent, 'default', deps)
    expect(built.input).toEqual(before)
    expect(target.targetWeaponId).toBe('target.c2.b')
    expect(target.fixedRouteBuildListEntryIds).toEqual([ENTRY_A])
    expect(target.outcome).toBe('found')
    // Two Search calls: the kernel's, then the post-hoc one with exactly the same origin, reservation, exclusions and extent.
    expect(searchCalls.inputs).toHaveLength(2)
    expect(searchCalls.inputs[1]).toEqual(searchCalls.inputs[0])
    expect(context.reservation).toEqual(normalizePlannerAlternativeReservation(target.reservation!))
    expect(context.excludedRouteKeys).toEqual(target.excludedRouteKeys)
    expect(context.excludedRouteKeys).toContain(target.invalidatedRouteKey)
    expect(context.kernelTrialPrefixMatches).toBe(true)
    // Search-delivered and kernel-found stay apart: only the trialled found Candidate is marked found.
    const found = context.candidates.filter(c => c.kernel.status === 'kernel_found')
    expect(found).toHaveLength(1)
    expect(found[0].stableKey).toBe(target.found!.stableKey)
    expect(context.candidates.slice(target.trials.length).every(c => c.kernel.status === 'search_delivered')).toBe(true)
    // The Search contract holds: no own unit on a blocked position, no exclusive weapon.
    expect(context.candidates.every(c => c.reservationCheck.respects)).toBe(true)
    expect(context.candidates.every(c => c.summary.targetWeaponId === 'target.c2.b')).toBe(true)
  })

  it('stops at the capture bound as a consumer stop, and otherwise reports the Search termination as it is', async () => {
    const built = scenario()
    const deps = { createEngine: () => built.engine, now: () => 0 }
    const baseline = await runPhase2C2Baseline(built.input, deps)
    const orientation = baseline.orientations.find(o => o.fixedBuildListEntryId === ENTRY_A)!
    const record = await runPhase2C2Kernel(built.input, orientation, CONDITIONS, deps)
    if (record.kernel.status !== 'completed') throw new Error(record.kernel.status)
    const [target] = record.kernel.targets
    const one = await runPhase2C2PortfolioContext(built.input, target, orientation, { ...CONDITIONS, captureBound: 1 }, CONDITIONS.extent, 'default', deps)
    expect(one.status).toBe('consumer_stop')
    expect(one.candidates).toHaveLength(1)
    expect(one.summary.exhausted).toBe(false)
    expect(one.summary.stoppedByExtent).toBe(false)
    const all = await runPhase2C2PortfolioContext(built.input, target, orientation, { ...CONDITIONS, captureBound: 1000 }, CONDITIONS.extent, 'default', deps)
    expect(['exhausted', 'stopped_by_extent']).toContain(all.status)
    expect(all.summary.stoppedByConsumer).toBe(false)
    // A probe re-derives the same reservation through the Planner authority and changes only the extent.
    const probe = await runPhase2C2PortfolioContext(built.input, target, orientation, CONDITIONS, { ...CONDITIONS.extent, maxGogmaAdvance: 6 }, 'probe:gogma=6', deps)
    expect(probe.reservation).toEqual(all.reservation)
    expect(probe.excludedRouteKeys).toEqual(all.excludedRouteKeys)
    expect(probe.extent).toEqual({ ...CONDITIONS.extent, maxGogmaAdvance: 6 })
    expect(probe.kernelTrialPrefixMatches).toBeNull()
    expect(probe.candidates.every(c => c.kernel.status === 'search_delivered')).toBe(true)
    await expect(runPhase2C2PortfolioContext(built.input, { ...target, reservation: { ...target.reservation!, gogma: { held: [99], blocked: [] } } }, orientation, CONDITIONS,
      CONDITIONS.extent, 'x', deps)).rejects.toThrow(/re-derived reservation differs/)
    await expect(runPhase2C2PortfolioContext(built.input, { ...target, reservation: null }, orientation, CONDITIONS, CONDITIONS.extent, 'default', deps)).rejects.toThrow(/was not searched/)
  })

  it('maps the Search summary to one status and never merges a consumer stop into exhaustion', () => {
    expect(phase2c2SearchStatus({ exhausted: false, stoppedByExtent: false }, true)).toBe('consumer_stop')
    expect(phase2c2SearchStatus({ exhausted: true, stoppedByExtent: false }, false)).toBe('exhausted')
    expect(phase2c2SearchStatus({ exhausted: false, stoppedByExtent: true }, false)).toBe('stopped_by_extent')
    expect(() => phase2c2SearchStatus({ exhausted: false, stoppedByExtent: false }, false)).toThrow()
  })
})

describe('Phase 2-C2 Route summaries', () => {
  it('derives held Routes from the Route unit positions, never from where the Candidate came from', () => {
    const built = scenario()
    const [a] = built.input.targetWeapons
    const contiguous = summarizePhase2C2Entry(built.input.buildListEntries[0], built.input, built.engine)
    expect(contiguous.heldRoute).toBe(false)
    expect(contiguous.gogma).toMatchObject({ first: 10, last: 10, operations: 1, crossesHeldPositions: false, startsAfterOrigin: false })
    const gap = orchestrationEntry('build-list.c2.gap', a, { kind: 'existing_gogma_reset_bonuses', sourceOwnedWeaponId: resetRoute(ORCHESTRATION_SOURCE_A).sourceOwnedWeaponId,
      operations: [...resetRoute(ORCHESTRATION_SOURCE_A, 10).operations, ...resetRoute(ORCHESTRATION_SOURCE_A, 12).operations] }, { finalBonuses: idealBonuses(), seriesSkillId: SOURCE_A_SKILL })
    const held = summarizePhase2C2Entry(gap, built.input, built.engine)
    expect(held.gogma).toMatchObject({ first: 10, last: 12, operations: 2, positions: [[10, 10], [12, 12]], crossesHeldPositions: true })
    expect(held.heldRoute).toBe(true)
    expect(held.gogmaTypeRuns).toEqual([[10, 10, 'reset_bonuses'], [12, 12, 'reset_bonuses']])
    const late = orchestrationEntry('build-list.c2.late', a, resetRoute(ORCHESTRATION_SOURCE_A, 11), { finalBonuses: idealBonuses(), seriesSkillId: SOURCE_A_SKILL })
    expect(summarizePhase2C2Entry(late, built.input, built.engine)).toMatchObject({ heldRoute: false, gogma: { startsAfterOrigin: true, crossesHeldPositions: false } })
    expect(positionRanges([5, 1, 2, 3, 7, 5])).toEqual([[1, 3], [5, 5], [7, 7]])
  })

  it('checks the reservation contract only as set arithmetic on own positions and weapons', () => {
    const built = scenario()
    const entry = built.input.buildListEntries[0]
    const summary = summarizePhase2C2Entry(entry, built.input, built.engine)
    const empty = { normal: [], skill: { held: [], blocked: [] }, gogma: { held: [], blocked: [] }, exclusiveOwnedWeaponIds: [] }
    expect(respectsPhase2C2Reservation(summary, entry.candidateSnapshot.route, empty).respects).toBe(true)
    expect(respectsPhase2C2Reservation(summary, entry.candidateSnapshot.route, { ...empty, gogma: { held: [10], blocked: [] } }).respects).toBe(true)
    expect(respectsPhase2C2Reservation(summary, entry.candidateSnapshot.route, { ...empty, gogma: { held: [10], blocked: [10] } }).blockedHits.gogma).toEqual([10])
    expect(respectsPhase2C2Reservation(summary, entry.candidateSnapshot.route, { ...empty, exclusiveOwnedWeaponIds: [ORCHESTRATION_SOURCE_A] as never }).exclusiveHit).toEqual([ORCHESTRATION_SOURCE_A])
  })
})

function fakeSummary(targetWeaponId: string, overrides: Partial<Phase2C2CandidateSummary> = {}): Phase2C2CandidateSummary {
  return { targetWeaponId, routeKind: 'existing_gogma_reset_bonuses', sourceKind: 'owned_gogma', sourceOwnedWeaponId: 'w1', estimatedOperationCount: 1,
    estimatedAdvances: { normal: null, gogma: 1, skill: 0 }, ownOperationCount: 1, operationTypes: { reset_bonuses: 1 }, normalCounterId: null,
    normalProductionTargetPosition: null, blindNormalCreation: false, conversionSkillPosition: null, normal: null,
    gogma: { first: 10, last: 10, operations: 1, positions: [[10, 10]], required: [10], crossesHeldPositions: false, startsAfterOrigin: false }, skill: null,
    gogmaTypeRuns: [[10, 10, 'reset_bonuses']], heldRoute: false, finalBonuses: [], restorationBonusScope: 'gogma_artian', seriesSkillId: null, groupSkillId: null, ...overrides }
}

function fakeContext(id: string, targetWeaponId: string, extentLabel: string, keys: { key: string; summary: Phase2C2CandidateSummary; found?: boolean }[]): Phase2C2SearchContextRecord {
  return { contextId: `${id}:${targetWeaponId}:${extentLabel}`, orientationId: id, conflictKey: `k-${id}`, kind: 'same_gogma_counter', fixedTargetWeaponId: 'fixed', targetWeaponId,
    extent: { maxNormalAdvance: 4, maxGogmaAdvance: 235, maxSkillAdvance: 4 }, extentLabel, reservation: { normal: [], skill: { held: [], blocked: [] }, gogma: { held: [10], blocked: [10] }, exclusiveOwnedWeaponIds: [] },
    excludedRouteKeys: ['orig'], fixedRouteBuildListEntryIds: ['e-fixed'], status: 'exhausted',
    summary: { deliveredCandidates: keys.length, excludedCandidates: 0, exhausted: true, stoppedByExtent: false, stoppedByConsumer: false },
    candidates: keys.map((k, deliveredIndex) => ({ deliveredIndex, stableKey: k.key, summary: k.summary, reservationCheck: { respects: true, blockedHits: {}, exclusiveHit: [] },
      kernel: k.found ? { status: 'kernel_found', generatedSelected: true } : { status: 'search_delivered' } })), kernelTrialPrefixMatches: null, elapsedMs: 0 }
}

describe('Phase 2-C2 portfolio', () => {
  const baseline = {
    originals: [{ targetWeaponId: 't1', buildListEntryId: 'e1', stableKey: 'orig', summary: fakeSummary('t1') }, { targetWeaponId: 't2', buildListEntryId: 'e2', stableKey: 'orig2', summary: fakeSummary('t2') }],
    orientations: [{ orientationId: 'c0-p0', conflictIndex: 0, conflictKey: 'k', kind: 'same_gogma_counter' as const, participantBuildListEntryIds: ['e1', 'e3'], participantTargetWeaponIds: ['t1', 't3'],
      fixedBuildListEntryId: 'e3', fixedTargetWeaponId: 't3' }],
  }
  const alt = fakeSummary('t1', { sourceOwnedWeaponId: 'w2', gogma: { first: 11, last: 13, operations: 2, positions: [[11, 11], [13, 13]], required: [13], crossesHeldPositions: true, startsAfterOrigin: true }, heldRoute: true })

  it('deduplicates by stable key within the Target, keeps every provenance and never drops the original', () => {
    const portfolio = buildPhase2C2Portfolio(baseline, [
      fakeContext('c0-p0', 't1', 'default', [{ key: 'alt-1', summary: alt, found: true }, { key: 'alt-2', summary: fakeSummary('t1', { sourceOwnedWeaponId: 'w3' }) }]),
      fakeContext('c1-p0', 't1', 'default', [{ key: 'alt-1', summary: alt }]),
      fakeContext('c1-p0', 't1', 'probe:gogma=240', [{ key: 'alt-3', summary: fakeSummary('t1', { routeKind: 'existing_gogma_mixed' }) }]),
    ])
    const t1 = portfolio.find(p => p.targetWeaponId === 't1')!
    expect(t1.candidates.map(c => c.stableKey)).toEqual(['orig', 'alt-1', 'alt-2', 'alt-3'])
    expect(t1.candidates[0].origin).toBe('original')
    const merged = t1.candidates.find(c => c.stableKey === 'alt-1')!
    expect(merged.provenance.map(p => p.contextId)).toEqual(['c0-p0:t1:default', 'c1-p0:t1:default'])
    expect(merged.kernelFound).toBe(true)
    expect(t1.diversity).toMatchObject({ candidates: 4, alternatives: 3, distinctOwnedWeaponSources: 3, heldRoutes: 1, routeKinds: 2, kernelFound: 1 })
    expect(t1.diversityDefaultExtent.candidates).toBe(3)
    expect(t1.diversityByDefaultPrefix['1'].candidates).toBe(2)
    expect(t1.diversityByDefaultPrefix['8'].candidates).toBe(3)
    expect(t1.has).toEqual({ multipleCandidates: true, sourceAlternative: true, counterPositionAlternative: true, heldRoute: true, reservationRespectingAlternative: true })
    expect(t1.conflictParticipant).toBe(true)
    const t2 = portfolio.find(p => p.targetWeaponId === 't2')!
    expect(t2.candidates).toHaveLength(1)
    expect(t2.conflictParticipant).toBe(false)
    expect(t2.has.multipleCandidates).toBe(false)
  })

  it('refuses one stable key with two different summaries, and a context for a Target with no original', () => {
    expect(() => buildPhase2C2Portfolio(baseline, [fakeContext('a', 't1', 'default', [{ key: 'x', summary: alt }]), fakeContext('b', 't1', 'default', [{ key: 'x', summary: fakeSummary('t1') }])])).toThrow(/different summaries/)
    expect(() => buildPhase2C2Portfolio(baseline, [fakeContext('a', 't9', 'default', [])])).toThrow(/without an original/)
    expect(phase2c2Diversity([]).candidates).toBe(0)
  })
})

describe('Phase 2-C2 extent probes and child processes', () => {
  it('probes only the Conflict kind\'s axis, stepwise on the benchmark grid, and only after an unfilled extent stop', () => {
    expect(phase2c2ProbeAxis('same_normal_counter')).toBe('normal')
    expect(phase2c2ProbeAxis('same_skill_counter')).toBe('skill')
    expect(phase2c2ProbeAxis('same_gogma_counter')).toBe('gogma')
    expect(phase2c2ProbeAxis('same_owned_weapon_consumed')).toBeNull()
    const extent = { ...defaultPlannerAlternativeSearchExtent }
    expect(phase2c2NextProbeExtent(extent, 'gogma', BENCHMARK_ONLY_EXTENT_GRID)).toEqual({ ...extent, maxGogmaAdvance: 240 })
    expect(phase2c2NextProbeExtent(extent, 'normal', BENCHMARK_ONLY_EXTENT_GRID)).toEqual({ ...extent, maxNormalAdvance: 16 })
    expect(phase2c2NextProbeExtent(extent, 'skill', BENCHMARK_ONLY_EXTENT_GRID)).toEqual({ ...extent, maxSkillAdvance: 8 })
    expect(phase2c2NextProbeExtent({ ...extent, maxNormalAdvance: 80 }, 'normal', BENCHMARK_ONLY_EXTENT_GRID)).toBeNull()
    const base = { kind: 'same_gogma_counter' as const, extent }
    expect(phase2c2ProbeDecision({ ...base, status: 'stopped_by_extent', delivered: 3 }, 8, BENCHMARK_ONLY_EXTENT_GRID)).toEqual({ status: 'probe', axis: 'gogma', extent: { ...extent, maxGogmaAdvance: 240 } })
    expect(phase2c2ProbeDecision({ ...base, status: 'consumer_stop', delivered: 8 }, 8, BENCHMARK_ONLY_EXTENT_GRID)).toEqual({ status: 'skip', reason: 'capture_bound_filled' })
    expect(phase2c2ProbeDecision({ ...base, status: 'exhausted', delivered: 2 }, 8, BENCHMARK_ONLY_EXTENT_GRID)).toEqual({ status: 'skip', reason: 'exhausted' })
    expect(phase2c2ProbeDecision({ ...base, kind: 'same_owned_weapon_consumed', status: 'stopped_by_extent', delivered: 0 }, 8, BENCHMARK_ONLY_EXTENT_GRID)).toEqual({ status: 'skip', reason: 'no_probe_axis_for_kind' })
    expect(phase2c2ProbeDecision({ ...base, extent: { ...extent, maxGogmaAdvance: 350 }, status: 'stopped_by_extent', delivered: 0 }, 8, BENCHMARK_ONLY_EXTENT_GRID)).toEqual({ status: 'skip', reason: 'grid_exhausted' })
  })

  it('classifies a timeout, an out-of-memory death and any other failure as failures, never as a completed empty context', () => {
    const ok = { code: 0, signal: null, timedOut: false, stderrTail: '', recordWritten: true }
    expect(classifyPhase2C2ChildExit(ok)).toBe('completed')
    expect(classifyPhase2C2ChildExit({ ...ok, timedOut: true, code: null, signal: 'SIGKILL' })).toBe('timeout')
    expect(classifyPhase2C2ChildExit({ ...ok, code: 134, stderrTail: 'FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory' })).toBe('out_of_memory')
    expect(classifyPhase2C2ChildExit({ ...ok, code: 1, stderrTail: 'Error: boom' })).toBe('process_failure')
    expect(classifyPhase2C2ChildExit({ ...ok, recordWritten: false })).toBe('process_failure')
  })
})

describe('Phase 2-C2 post-hoc analysis', () => {
  it('compares the baseline with the Phase 2-C1 evidence at the Target level', () => {
    const summary = { planningTargetCount: 2, completedTargetCount: 1, termination: 'exhausted', planSteps: 5, selectedTargets: ['a'], conflicts: 1,
      conflictsByKind: { same_gogma_counter: 1 }, conflictSignatures: ['same_gogma_counter:a,b'], rejected: 1, rejectedByReason: {}, warningsByKind: {} }
    const c1 = { origin: { baselineComparison: { original: { selectedTargets: ['a'], conflictSignatures: ['same_gogma_counter:a,b'], steps: 5, completedTargetCount: 1, termination: 'exhausted' } } } }
    expect(comparePhase2C2BaselineWithC1(summary, c1).matches).toBe(true)
    expect(comparePhase2C2BaselineWithC1({ ...summary, planSteps: 6 }, c1).matches).toBe(false)
  })

  it('reports oracle coverage as exact / partial comparable / not comparable / uncovered without inventing fields', () => {
    const route = { targetWeaponId: 't1', sourceKind: 'owned', sourceOwnedWeaponId: 'w2', normalPosition: null, conversionPosition: null, normal: { first: null, last: null, operations: 0 },
      gogma: { first: 11, last: 13, operations: 2, required: [13] }, skill: { first: null, last: null, operations: 0, required: [] }, routeOperationCount: 2,
      finalBonuses: [], finalScope: 'gogma_artian', finalSeriesSkillId: null, finalGroupSkillId: null, materialization: { routeKind: 'existing_gogma_reset_bonuses', estimated: { operations: 1, normal: null, gogma: 1, skill: 0 } } }
    const alt = fakeSummary('t1', { sourceOwnedWeaponId: 'w2', ownOperationCount: 2, gogma: { first: 11, last: 13, operations: 2, positions: [[11, 11], [13, 13]], required: [13], crossesHeldPositions: true, startsAfterOrigin: true },
      gogmaTypeRuns: [[11, 11, 'reset_bonuses'], [13, 13, 'reset_bonuses']], heldRoute: true })
    const portfolio = [{ targetWeaponId: 't1', candidates: [{ stableKey: 'orig', origin: 'original' as const, summary: fakeSummary('t1'), provenance: [], kernelFound: false },
      { stableKey: 'alt', origin: 'alternative' as const, summary: alt, provenance: [{ extentLabel: 'default' }], kernelFound: false }] }]
    const usage = [{ position: 11, targetWeaponId: 't1', type: 'reset_bonuses', required: false }, { position: 13, targetWeaponId: 't1', type: 'reset_bonuses', required: true }]
    const exact = phase2c2OracleCoverage(portfolio as never, { routes: [route], gogmaUsage: usage })
    expect(exact.targets[0]).toMatchObject({ targetWeaponId: 't1', coverage: 'exact', coveredBy: 'alternative', matchedStableKey: 'alt' })
    // Without the per-unit Gogma usage the positions are not all determined: at most a partial comparable match.
    const partial = phase2c2OracleCoverage(portfolio as never, { routes: [route], gogmaUsage: [] })
    expect(partial.targets[0].coverage).toBe('partial_comparable')
    const none = phase2c2OracleCoverage(portfolio as never, { routes: [{ ...route, sourceOwnedWeaponId: 'w9' }], gogmaUsage: usage })
    expect(none.targets[0].coverage).toBe('uncovered')
    const missing = phase2c2OracleCoverage(portfolio as never, { routes: [{ ...route, finalBonuses: undefined }], gogmaUsage: usage })
    expect(missing.targets[0].coverage).toBe('not_comparable')
  })
})

// Built from parts so that this test itself never names the oracle modules (their own isolation test scans every Research file).
const ORACLE_NAMES = new RegExp(['plannerGlobal' + 'Oracle1657', 'plannerGlobal' + 'LowerBound', 'PLANNER_GLOBAL_' + '1657', 'ORACLE_' + 'RESULT', 'PHASE2C1_' + 'RESULT'].join('|'))
const benchmarkSources = import.meta.glob('./*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const scriptSources = import.meta.glob('../../scripts/*phase2c2*.mjs', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const production = import.meta.glob('../{app,components,db,domain,services,stores,workers,pages,presentation,data}/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

describe('Phase 2-C2 isolation', () => {
  it('keeps the oracle, the Phase 2-C1 evidence and hard-coded IDs out of the calculation', () => {
    const source = benchmarkSources['./plannerGlobalPhase2C2.ts']
    expect(source).toBeDefined()
    expect(source).not.toMatch(ORACLE_NAMES)
    expect(source).not.toMatch(/plannerGlobalPhase2C2Analysis|plannerGlobalPhase2BGapAnalysis|parseOptimumEvidence|plannerGlobalPhase2C1Analysis/)
    expect(source).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
    expect(source).not.toMatch(/\b[0-9a-f]{64}\b/i)
    expect(source).not.toMatch(/readFile|fetch\(|from ['"][^'"]*\.json['"]/)
    // The reservation is only ever the kernel's (or re-derived by the Planner authority), never rebuilt by hand.
    expect(source).not.toMatch(/createPlannerRouteUnitPlans\([^)]*fixed/)
    const runner = Object.entries(scriptSources).find(([path]) => path.endsWith('run-planner-global-phase2c2.mjs'))![1]
    expect(runner).not.toMatch(ORACLE_NAMES)
    expect(runner).not.toMatch(/--optimum|--c1|plannerGlobalPhase2C2Analysis|plannerGlobalPhase2C1|\b[0-9a-f]{64}\b/)
    const analysis = Object.entries(scriptSources).find(([path]) => path.endsWith('analyze-planner-global-phase2c2.mjs'))![1]
    expect(analysis).toMatch(/option\('--optimum'\)/)
    expect(analysis).toMatch(/option\('--c1'\)/)
    expect(analysis).not.toMatch(/runPhase2C2Kernel|runPhase2C2Baseline|runPhase2C2PortfolioContext|createProductionPlan|visitPlannerAlternativeCandidates/)
    expect(analysis).not.toMatch(new RegExp('plannerGlobal' + 'Oracle1657|plannerGlobal' + 'LowerBound'))
    const analysisModule = benchmarkSources['./plannerGlobalPhase2C2Analysis.ts']
    expect(analysisModule).not.toMatch(/runPhase2C2|createProductionPlan|visitPlannerAlternativeCandidates|runPlannerAlternativeKernel|readFile/)
  })

  it('is reached by no Production module, and Production keeps its defaults, schema and versions', () => {
    const paths = Object.keys(production).filter(path => !/\.test\.tsx?$|\.worker\.benchmark|BenchmarkPage|\/pages\/BenchmarkApp/.test(path))
    expect(paths.length).toBeGreaterThan(100)
    expect(paths.filter(path => /plannerGlobalPhase2C2|PHASE2C2|phase2c2/i.test(production[path]))).toEqual([])
    expect(CURRENT_CALCULATION_APP_SCHEMA_VERSION).toBe(17)
    expect(DATABASE_SCHEMA_VERSION).toBe(10)
    expect(EXPORT_SCHEMA_VERSION).toBe(13)
    expect(PRODUCTION_RNG_ENGINE_VERSION).toBe('production-rng:c5-e7')
    expect(defaultPlannerOptions).toEqual({ maxPlanSteps: 1000 })
    expect({ ...recommendedCandidateSearchDefaults }).toEqual({ maxNormalAdvance: 350, maxGogmaAdvance: 500, maxSkillAdvance: 1500 })
    expect({ ...defaultPlannerAlternativeSearchExtent }).toEqual({ maxNormalAdvance: 4, maxGogmaAdvance: 235, maxSkillAdvance: 4 })
    expect({ ...defaultPlannerAlternativeTrialBounds }).toEqual({ maxCandidateTrialsPerTarget: 2, maxPlannerReruns: 8 })
    expect(stableStringify({ ...BENCHMARK_ONLY_EXTENT_GRID })).toBe(stableStringify({ normal: [1, 4, 16, 40, 80], gogma: [30, 60, 120, 180, 220, 235, 240, 300, 350], skill: [1, 2, 4, 8, 16, 32, 64] }))
  })
})
