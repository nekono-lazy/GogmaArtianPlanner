import { describe, expect, it, vi } from 'vitest'
import { stableStringify } from '../domain/models/hashing'
import { validateBuildListEntry } from '../domain/models/publicTypes'
import { CURRENT_CALCULATION_APP_SCHEMA_VERSION, recommendedCandidateSearchDefaults } from '../domain/models/common'
import { EXPORT_SCHEMA_VERSION } from '../domain/models/exportModel'
import { DATABASE_SCHEMA_VERSION } from '../db/AppDatabase'
import { defaultPlannerOptions } from '../domain/planner/plannerTypes'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../domain/rng/production/productionRngEngine'
import { createRestorationBonusSet } from '../test/fixtures/domainData'
import type { FakeRngEngine } from '../domain/rng/fakeRngEngine'
import { EXTENT_AXES, runGlobalExtentProbe, singleAxisProbeExtent, type ExtentAxis } from './plannerGlobalOptimizationExtentProbe'
import { createPhase1EFallback, derivedAttemptState, isRetryablePartialAttempt, PHASE1E_BOUNDS, phase1eControllerOutcome, phase1eStrategyName, phase1eVariantOutcome,
  reproducePhase1EWinner, runPhase1EController, validatePhase1EBounds, type Phase1EDependencies, type PriorityEntries } from './plannerGlobalOptimizationPhase1E'
import { globalResearchDependencies, GLOBAL_RESEARCH_EXTENT, runGlobalPlannerResearch, type GlobalResearchNoMatchCapture, type GlobalResearchReport } from './plannerGlobalOptimizationResearch'
import { classifyAttempt, collectRetrySignals, discoverySignature, PHASE1C_BOUNDS, stableResearchEntries, type AttemptSummary, type DiscoveryState, type RetrySignals } from './plannerGlobalOptimizationRetry'
import { globalResearchFixture } from './plannerGlobalOptimizationTestFixture'

const sha = async (value: unknown) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableStringify(value))))]
  .map(b => b.toString(16).padStart(2, '0')).join('')
const utility = () => createRestorationBonusSet().map(b => ({ ...b, bonusTypeId: 'bonus_type.fixture.utility' })) as ReturnType<typeof createRestorationBonusSet>

/** Gogma counters listed in `gaps` draw a non-Ideal set; every other draw, Normal and Skill prediction is Ideal / generic. */
async function gapFixture(gaps: readonly number[], extraTargets = 0) {
  const fixture = await globalResearchFixture({ extraTargets })
  const engine: FakeRngEngine = fixture.engine
  vi.spyOn(engine, 'predictGogmaBonus').mockImplementation(value => gaps.includes(value.gogmaCounter) ? utility() : createRestorationBonusSet())
  vi.spyOn(engine, 'advanceGogmaCounter').mockImplementation(current => current + 1)
  vi.spyOn(engine, 'predictNormalArtian').mockImplementation(() => createRestorationBonusSet())
  vi.spyOn(engine, 'advanceNormalCounter').mockImplementation((current, op) => current + op.count)
  const skill = fixture.input.targetWeapons[0].idealSkillCondition.seriesSkillId
  vi.spyOn(engine, 'predictSkills').mockImplementation(() => ({ seriesSkillId: skill, groupSkillId: null }))
  vi.spyOn(engine, 'advanceSkillCounter').mockImplementation(current => current + 1)
  return fixture
}
/**
 * Two base bounded no-matches in one Phase 0 attempt: three Targets whose original Entries all Reset at
 * Gogma 10, one retained; the next pending Target starts at 11 (non-Ideal, Ideal at 12) and the last at 13
 * (non-Ideal, Ideal at 14). `attempt` is undefined: the run derives its retained set and order itself.
 */
async function twoGapAttempt() {
  const fixture = await gapFixture([11, 13], 1)
  return { ...fixture, attempt: undefined }
}

describe('Phase 1-E generic fallback inside one attempt', () => {
  it('keeps the fallback-free Phase 0 control identical (Phase 0 / 1-C / 1-D parity)', async () => {
    const { input, search, engine } = await globalResearchFixture()
    const control = await runGlobalPlannerResearch(input, globalResearchDependencies(engine), { extent: search.settings, nowMs: () => 0 })
    expect(await sha(control)).toBe('9ae56d7eb3c06352bd140d28c66bd5db3c42c2f5b98a7c50c97ad11610a73cb7')
    // A configured but unused Phase 1-E fallback changes no Plan and no Entry.
    const withFallback = await runGlobalPlannerResearch(input, globalResearchDependencies(engine), { extent: search.settings, nowMs: () => 0, extentFallback: createPhase1EFallback('normal', 1000) })
    expect(withFallback.finalResult).toEqual(control.finalResult)
    expect(withFallback.generatedEntries).toEqual(control.generatedEntries)
    expect(withFallback.report.extentFallback).toEqual({ strategy: 'normal-2x-fallback', searches: 0, searchElapsedMs: 0, maxEpisodes: 3 })
  })

  it('applies the same rule to every bounded no-match of an attempt, each episode with its own request', async () => {
    const { input, search, engine, attempt } = await twoGapAttempt()
    const result = await runGlobalPlannerResearch(input, globalResearchDependencies(engine), { extent: search.settings, nowMs: () => 0, attempt, extentFallback: createPhase1EFallback('gogma', 1000) })
    expect(result.report.searches.map(s => [s.status, s.targetOutcome, s.fallback?.status])).toEqual([
      ['not_found_within_extent', 'resolved_by_extent_fallback', 'found'], ['not_found_within_extent', 'resolved_by_extent_fallback', 'found']])
    expect(result.report.extentFallback).toMatchObject({ searches: 2, maxEpisodes: 3 })
    const fingerprints = result.report.searches.map(s => s.fallback!.requestFingerprint)
    expect(new Set(fingerprints).size).toBe(2)
    for (const f of fingerprints) expect(f).toMatch(/^fnv1a32:/)
    // Only the axis changes; the base Search status is never overwritten.
    for (const s of result.report.searches) {
      expect(s.fallback!.baseExtent).toEqual(search.settings)
      expect(s.fallback!.extent).toEqual(singleAxisProbeExtent(search.settings, 'gogma'))
      expect(s.routeKind).toBeNull()
    }
    expect(result.report.status, JSON.stringify(result.report.final)).toBe('completed')
    expect(result.report.final).toMatchObject({ completedTargetCount: 3, conflicts: 0, rejected: 0, resourceConflictRejected: 0, traceReplay: 'passed', status: 'completed' })
    for (const entry of result.generatedEntries) expect(validateBuildListEntry(entry).isValid).toBe(true)
    expect(classifyAttempt(result.report, collectRetrySignals(input, result.report, result.finalResult, result.generatedEntries))).toBe('completed')
  })

  it('blocks at the episode limit instead of continuing without a Candidate', async () => {
    const { input, search, engine, attempt } = await twoGapAttempt()
    const run = (max: number) => runGlobalPlannerResearch(input, globalResearchDependencies(engine), { extent: search.settings, nowMs: () => 0, attempt,
      extentFallback: createPhase1EFallback('gogma', 1000, { ...PHASE1E_BOUNDS, maxFallbackEpisodesPerAttempt: max }) })
    const limited = await run(1)
    expect(limited.report.searches.map(s => s.fallback?.status)).toEqual(['found', 'episode_limit_reached'])
    expect(limited.report.searches[1]).toMatchObject({ status: 'not_found_within_extent', fallback: { elapsedMs: 0, stoppedBy: null } })
    expect(limited.report.extentFallback).toMatchObject({ searches: 1, maxEpisodes: 1 })
    expect(limited.report.status).toBe('blocked')
    expect(limited.finalResult).toBeNull()
    const signals = collectRetrySignals(input, limited.report, limited.finalResult, limited.generatedEntries)
    expect(signals.blockers).toEqual([{ targetId: limited.report.searches[1].targetId, classification: 'extent_fallback_episode_limit_reached' }])
    expect(classifyAttempt(limited.report, signals)).toBe('fallback_episode_limit')
    // Zero episodes is only a direct test bound; the Phase 1-E default stays 3.
    const zero = await runGlobalPlannerResearch(input, globalResearchDependencies(engine), { extent: search.settings, nowMs: () => 0, attempt,
      extentFallback: { ...createPhase1EFallback('gogma', 1000), maxEpisodes: 0 } })
    expect(zero.report.searches.map(s => s.fallback?.status)).toEqual(['episode_limit_reached'])
    await expect(runGlobalPlannerResearch(input, globalResearchDependencies(engine), { attempt, extentFallback: { ...createPhase1EFallback('gogma', 1000), maxEpisodes: 1.5 } })).rejects.toThrow('episode limit')
    expect(() => validatePhase1EBounds({ ...PHASE1E_BOUNDS, maxFallbackEpisodesPerAttempt: 0 })).toThrow()
    expect(() => validatePhase1EBounds({ ...PHASE1E_BOUNDS, retry: { ...PHASE1C_BOUNDS, maxStates: 13 } })).toThrow()
    expect(() => validatePhase1EBounds({ ...PHASE1E_BOUNDS, retry: { ...PHASE1C_BOUNDS, releaseDepth: 3 } })).toThrow()
  })

  it('keeps fallback deadline, cancel and Search errors apart from a no-match with the episode bound on', async () => {
    const { input, search, engine, attempt } = await twoGapAttempt()
    const deadline = await runGlobalPlannerResearch(input, globalResearchDependencies(engine), { extent: search.settings, nowMs: () => 0, attempt, extentFallback: createPhase1EFallback('gogma', 0) })
    expect(deadline.report.searches[0]).toMatchObject({ status: 'not_found_within_extent', fallback: { status: 'time_budget_reached', stoppedBy: 'fallback_budget' } })
    expect(classifyAttempt(deadline.report, collectRetrySignals(input, deadline.report, deadline.finalResult, deadline.generatedEntries))).toBe('extent_fallback_blocked')
    let cancel = false
    const cancelled = await runGlobalPlannerResearch(input, globalResearchDependencies(engine), { extent: search.settings, nowMs: () => 0, attempt, extentFallback: createPhase1EFallback('gogma', 1000),
      shouldCancel: () => cancel, onProgress: r => { if (r.searches.some(s => s.fallback?.status === 'searching')) cancel = true } })
    expect(cancelled.report.status).toBe('cancelled')
    expect(cancelled.report.searches[0].fallback).toMatchObject({ status: 'cancelled', stoppedBy: 'external_cancel' })
    vi.spyOn(engine, 'predictGogmaBonus').mockImplementation(value => { if (value.gogmaCounter === 12) throw new Error('prediction failed at 12'); return value.gogmaCounter === 11 ? utility() : createRestorationBonusSet() })
    const error = await runGlobalPlannerResearch(input, globalResearchDependencies(engine), { extent: search.settings, nowMs: () => 0, attempt, extentFallback: createPhase1EFallback('gogma', 1000) })
    expect(error.report.searches[0].fallback).toMatchObject({ status: 'search_error', error: 'prediction failed at 12' })
    expect(error.report.status).toBe('blocked')
  })

  it('starts N / G / S from the same original input with a self-derived retained set, leaking nothing between them', async () => {
    const { input, search, engine } = await gapFixture([11])
    const before = structuredClone(input)
    const control = await runGlobalPlannerResearch(input, globalResearchDependencies(engine), { extent: search.settings, nowMs: () => 0 })
    const priority = stableResearchEntries(input).map(e => ({ id: e.id, targetWeaponId: e.targetWeaponId }))
    const derived = derivedAttemptState(control.report.retainedOriginalEntryIds, priority, search.settings)
    expect(derived.pendingTargetIds).toEqual(control.report.searches.map(s => s.targetId))
    const run = (axis: ExtentAxis) => runGlobalPlannerResearch(input, globalResearchDependencies(engine), { extent: search.settings, nowMs: () => 0, extentFallback: createPhase1EFallback(axis, 1000) })
    const sequential = []
    for (const axis of EXTENT_AXES) sequential.push(await run(axis))
    expect(input).toEqual(before)
    for (const r of sequential) {
      expect(r.report.retainedOriginalEntryIds).toEqual(control.report.retainedOriginalEntryIds)
      expect(r.report.searches.map(s => s.targetId)).toEqual(derived.pendingTargetIds)
      expect(r.report.baseline).toEqual(control.report.baseline)
    }
    expect(sequential.map(r => r.report.searches[0].fallback?.status)).toEqual(['not_found_within_extent', 'found', 'not_found_within_extent'])
    // Order independence: Skill alone, and Normal after Gogma, give the same results.
    expect(await run('skill')).toEqual(sequential[2])
    expect(await run('normal')).toEqual(sequential[0])
  })

  it('names snapshot metadata after its value', async () => {
    const { input, search, engine } = await gapFixture([11])
    const captures: GlobalResearchNoMatchCapture[] = []
    await runGlobalPlannerResearch(input, globalResearchDependencies(engine), { extent: search.settings, nowMs: () => 0, onBoundedNoMatch: c => captures.push(c) })
    const probe = await runGlobalExtentProbe(input, captures[0], 'gogma', globalResearchDependencies(engine), { timeBudgetMs: 1000, nowMs: () => 0 })
    expect(probe.snapshotFingerprint).toMatch(/^fnv1a32:[0-9a-f]{8}$/)
    expect(probe).not.toHaveProperty('snapshotSha256')
  })
})

// ---- controller (fake executors; each call stands for a fresh child from the original Export) ----
const EMPTY: RetrySignals = { notFound: [], resourceRejected: [], conflictTargets: [], conflicts: [], blockers: [] }
const priority: PriorityEntries = [{ id: 'r', targetWeaponId: 'R' }, { id: 'a', targetWeaponId: 'A' }, { id: 'b', targetWeaponId: 'B' }]
type Final = NonNullable<GlobalResearchReport['final']>
const DONE = { completedTargetCount: 3, conflicts: 0, rejected: 0, resourceConflictRejected: 0, steps: 50, traceReplay: 'passed', status: 'completed' } as Final
const PARTIAL = { ...DONE, completedTargetCount: 2, conflicts: 1, rejected: 1, resourceConflictRejected: 1, status: 'exhausted' } as Final
function attemptOf(state: DiscoveryState, attemptId: number, final: Final | null, stop: AttemptSummary['stop'], signals: RetrySignals = EMPTY): AttemptSummary {
  return { attemptId, strategy: 'fixed_retained', reason: 'fake', state: structuredClone(state), signature: discoverySignature(state), signals, stop,
    report: { status: stop === 'completed' ? 'completed' : 'partial', error: null, planningTargetCount: 3, retainedOriginalEntryIds: state.retainedEntryIds, searches: [], final } as unknown as GlobalResearchReport }
}
const initialState = derivedAttemptState(['r'], priority, GLOBAL_RESEARCH_EXTENT)
function fakeDeps(outcomes: Partial<Record<ExtentAxis, { final: Final | null; stop: AttemptSummary['stop'] }>>, retryOutcome: (axis: ExtentAxis, state: DiscoveryState) => { final: Final | null; stop: AttemptSummary['stop'] } = () => ({ final: PARTIAL, stop: null })) {
  const calls: { kind: string; args: unknown[] }[] = []
  const unresolved = { ...EMPTY, notFound: ['A'] }
  let now = 0
  const deps: Phase1EDependencies<AttemptSummary> & { stopWith: 'cancelled' | 'time_budget' | null } = {
    stopWith: null,
    nowMs: () => (now += 10),
    shouldStop() { return this.stopWith },
    control: async () => { calls.push({ kind: 'control', args: [] }); return { attempt: attemptOf(initialState, 0, PARTIAL, null, unresolved), priorityEntries: priority } },
    initial: async (...args) => {
      calls.push({ kind: 'initial', args })
      const o = outcomes[args[0]] ?? { final: PARTIAL, stop: null }
      return { attempt: attemptOf(initialState, 0, o.final, o.stop, o.stop === 'completed' ? EMPTY : unresolved), priorityEntries: priority }
    },
    retry: async (...args) => {
      calls.push({ kind: 'retry', args: structuredClone(args) })
      const [axis, state, strategy, reason, attemptId] = args
      const o = retryOutcome(axis, state)
      return { ...attemptOf(state, attemptId, o.final, o.stop, o.stop === 'completed' ? EMPTY : unresolved), strategy, reason }
    },
  }
  return { deps, calls }
}

describe('Phase 1-E controller', () => {
  it('runs control and all three axis strategies from the original, compares final Plans, and skips retry after an initial success', async () => {
    const { deps, calls } = fakeDeps({ normal: { final: { ...DONE, steps: 90 }, stop: 'completed' }, skill: { final: DONE, stop: 'completed' } })
    const result = await runPhase1EController(deps)
    expect(calls.map(c => c.kind)).toEqual(['control', 'initial', 'initial', 'initial'])
    // Initial strategies receive the axis only - no state, Target, order, snapshot or Candidate.
    expect(calls.filter(c => c.kind === 'initial').map(c => c.args)).toEqual([['normal'], ['gogma'], ['skill']])
    expect(result.initialSuccess).toBe(true)
    expect(result.retryStarted).toBe(false)
    // Final Global Plan comparison: fewer steps wins among 43/43-equivalent variants, never an axis name.
    expect(result.ranking.map(v => v.axis)).toEqual(['skill', 'normal', 'gogma'])
    expect(result.winner).toMatchObject({ axis: 'skill', stage: 'initial' })
    expect(result.firstCompleted).toMatchObject({ axis: 'normal', stage: 'initial' })
    expect(result.outcome).toBe('completed')
    expect(result.variants.map(v => v.strategy)).toEqual(EXTENT_AXES.map(phase1eStrategyName))
  })

  it('starts the bounded retry only when every initial strategy is partial, best axis first, from full independent states', async () => {
    const { deps, calls } = fakeDeps({ gogma: { final: { ...PARTIAL, conflicts: 0 }, stop: null } }, (axis, state) => axis === 'gogma' && state.pendingTargetIds.length === 3 ? { final: DONE, stop: 'completed' } : { final: PARTIAL, stop: null })
    const result = await runPhase1EController(deps)
    expect(result.initialSuccess).toBe(false)
    expect(result.retryStarted).toBe(true)
    const retries = calls.filter(c => c.kind === 'retry')
    expect(retries.length).toBeGreaterThan(0)
    // Gogma ranks first (fewer Conflicts), and the chain ends at its first completed state.
    expect(retries.every(c => c.args[0] === 'gogma')).toBe(true)
    for (const c of retries) expect(Object.keys(c.args[1] as object).sort()).toEqual(['extent', 'pendingTargetIds', 'retainedEntryIds'])
    expect(result.retries).toHaveLength(1)
    expect(result.retries[0].stopReason).toBe('completed')
    expect(result.winner).toMatchObject({ axis: 'gogma', stage: 'retry' })
    expect(retries.length).toBeLessThanOrEqual(PHASE1C_BOUNDS.maxStates - 1)
  })

  it('stays bounded when nothing completes', async () => {
    const { deps, calls } = fakeDeps({})
    const result = await runPhase1EController(deps)
    expect(result.outcome).not.toBe('completed')
    expect(result.retries.map(r => r.axis)).toHaveLength(3)
    for (const axis of EXTENT_AXES) expect(calls.filter(c => c.kind === 'retry' && c.args[0] === axis).length).toBeLessThanOrEqual(PHASE1C_BOUNDS.maxStates - 1)
    expect(new Set(result.variants.map(v => v.outcome.signature)).size).toBe(result.variants.length)
  })

  it('never starts the retry from an error, memory limit, Worker / process failure, cancel or deadline initial (Phase 2-A, PR #164 review)', async () => {
    for (const stop of ['memory_limit', 'process_error', 'attempt_error', 'cancelled', 'time_budget', 'search_error'] as const) {
      const { deps, calls } = fakeDeps({ gogma: { final: null, stop } })
      const result = await runPhase1EController(deps)
      expect(result.initialSuccess).toBe(false)
      expect(result.retryStarted).toBe(false)
      expect(calls.filter(c => c.kind === 'retry')).toEqual([])
      expect(result.nonRetryableInitial).toEqual([{ axis: 'gogma', stop, status: 'partial' }])
      expect(result.outcome).toBe('not_completed')
    }
    const partial = attemptOf(initialState, 0, PARTIAL, null)
    expect(isRetryablePartialAttempt(partial)).toBe(true)
    expect(isRetryablePartialAttempt({ ...partial, report: { ...partial.report, error: 'x' } })).toBe(false)
    expect(isRetryablePartialAttempt({ ...partial, report: { ...partial.report, status: 'error' } })).toBe(false)
    expect(isRetryablePartialAttempt({ ...partial, report: { ...partial.report, final: null } })).toBe(false)
    // A completed initial is not listed as non-retryable; it simply makes the retry unnecessary.
    const done = await runPhase1EController(fakeDeps({ normal: { final: DONE, stop: 'completed' } }).deps)
    expect(done.nonRetryableInitial).toEqual([])
  })

  it('never lets a later failure, cancel or deadline overwrite a completed variant, and records the cancel apart', async () => {
    const { deps } = fakeDeps({ normal: { final: DONE, stop: 'completed' }, gogma: { final: null, stop: 'memory_limit' } })
    const initial = deps.initial.bind(deps)
    deps.initial = async axis => { const r = await initial(axis); if (axis === 'gogma') deps.stopWith = 'cancelled'; return r }
    const result = await runPhase1EController(deps)
    expect(result.variants.map(v => v.axis)).toEqual(['normal', 'gogma'])
    expect(result.outcome).toBe('completed')
    expect(result.stop).toBe('cancelled')
    expect(result.cancel).toEqual({ requested: true, completedBeforeStop: true })
    expect(phase1eControllerOutcome([phase1eVariantOutcome('gogma', attemptOf(initialState, 0, null, 'memory_limit'))], 'time_budget')).toBe('time_budget')
    const none = fakeDeps({})
    none.deps.stopWith = 'cancelled'
    const stopped = await runPhase1EController(none.deps)
    expect(none.calls).toEqual([])
    expect(stopped).toMatchObject({ outcome: 'cancelled', cancel: { requested: true, completedBeforeStop: false } })
  })

  it('refuses priority evidence that differs between fresh runs', async () => {
    const { deps } = fakeDeps({})
    const initial = deps.initial.bind(deps)
    deps.initial = async axis => ({ ...(await initial(axis)), priorityEntries: [...priority].reverse() })
    await expect(runPhase1EController(deps)).rejects.toThrow('Priority entries differ')
  })

  it('reproduces a winner from the axis strategy only', async () => {
    const { deps, calls } = fakeDeps({ normal: { final: DONE, stop: 'completed' } })
    const winner = { axis: 'normal' as const, stage: 'initial' as const, outcome: phase1eVariantOutcome('normal', attemptOf(initialState, 0, DONE, 'completed')) }
    const repeated = await reproducePhase1EWinner(winner, deps)
    expect(calls).toEqual([{ kind: 'initial', args: ['normal'] }])
    expect(repeated?.signature).toBe(discoverySignature(initialState))
    // A retry winner reruns its chain; every retry state is derived by that chain, not handed on.
    const chain = fakeDeps({}, (_axis, state) => state.pendingTargetIds.length === 3 ? { final: DONE, stop: 'completed' } : { final: PARTIAL, stop: null })
    const first = await runPhase1EController(chain.deps)
    const retryWinner = first.winner!
    expect(retryWinner.stage).toBe('retry')
    const fresh = fakeDeps({}, (_axis, state) => state.pendingTargetIds.length === 3 ? { final: DONE, stop: 'completed' } : { final: PARTIAL, stop: null })
    const again = await reproducePhase1EWinner(retryWinner, fresh.deps)
    expect(fresh.calls[0]).toEqual({ kind: 'initial', args: [retryWinner.axis] })
    expect(again?.signature).toBe(retryWinner.attempt.signature)
  })
})

describe('Phase 1-E boundaries', () => {
  it('changes no Production default, schema or version', () => {
    expect(CURRENT_CALCULATION_APP_SCHEMA_VERSION).toBe(17)
    expect(DATABASE_SCHEMA_VERSION).toBe(10)
    expect(EXPORT_SCHEMA_VERSION).toBe(13)
    expect(PRODUCTION_RNG_ENGINE_VERSION).toBe('production-rng:c5-e7')
    expect(defaultPlannerOptions.maxPlanSteps).toBe(1000)
    expect({ ...recommendedCandidateSearchDefaults }).toEqual({ maxNormalAdvance: 350, maxGogmaAdvance: 500, maxSkillAdvance: 1500 })
    expect(GLOBAL_RESEARCH_EXTENT).toEqual({ maxNormalAdvance: 350, maxGogmaAdvance: 500, maxSkillAdvance: 1500 })
    expect(PHASE1E_BOUNDS).toEqual({ maxFallbackEpisodesPerAttempt: 3, axisStrategies: 3, retry: PHASE1C_BOUNDS })
  })
})
