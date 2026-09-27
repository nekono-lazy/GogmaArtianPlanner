import { describe, expect, it, vi } from 'vitest'
import { stableStringify } from '../domain/models/hashing'
import { validateBuildCandidate, validateBuildListEntry } from '../domain/models/publicTypes'
import { searchCandidates } from '../domain/search/candidateSearch'
import { createRestorationBonusSet } from '../test/fixtures/domainData'
import type { FakeRngEngine } from '../domain/rng/fakeRngEngine'
import { compareExtentVariants, createSingleAxisExtentFallback, eligibleExtentAxes, ExtentResearchLedger, isGlobalPlanSuccess, phase1dControllerOutcome,
  PHASE1D_BOUNDS, probeSearchInput, runGlobalExtentProbe, selectExtentProbeAnchors, singleAxisProbeExtent,
  type ExtentVariantOutcome, type StoredResearchAttempt } from './plannerGlobalOptimizationExtentProbe'
import { globalResearchDependencies, GLOBAL_RESEARCH_TIME, materializeGlobalResearchCandidate, runGlobalPlannerResearch,
  type GlobalResearchNoMatchCapture, type SearchMeasurement } from './plannerGlobalOptimizationResearch'
import { classifyAttempt, collectRetrySignals, discoverySignature, runDiscoveryRetries, type AttemptSummary, type DiscoveryState, type RetrySignals } from './plannerGlobalOptimizationRetry'
import { globalResearchFixture } from './plannerGlobalOptimizationTestFixture'

const sha = async (value: unknown) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableStringify(value))))]
  .map(b => b.toString(16).padStart(2, '0')).join('')
const utility = () => createRestorationBonusSet().map(b => ({ ...b, bonusTypeId: 'bonus_type.fixture.utility' })) as ReturnType<typeof createRestorationBonusSet>

/**
 * The pending Target starts at Gogma 11 after the retained prefix. Gogma 11 draws a non-Ideal set and
 * Gogma 12 the Ideal one, so the base extent (Gogma 1) is a bounded no-match that only a wider Gogma
 * window can resolve. Every other prediction is generic so a wider Normal / Skill window is supported.
 */
async function gapFixture(options: { gogma12?: 'ideal' | 'throw' } = {}) {
  const fixture = await globalResearchFixture()
  const engine: FakeRngEngine = fixture.engine
  const predict = engine.predictGogmaBonus.bind(engine)
  vi.spyOn(engine, 'predictGogmaBonus').mockImplementation(value => {
    if (value.gogmaCounter === 11) return utility()
    if (value.gogmaCounter >= 12) { if (options.gogma12 === 'throw') throw new Error('prediction failed at 12'); return createRestorationBonusSet() }
    return predict(value)
  })
  vi.spyOn(engine, 'advanceGogmaCounter').mockImplementation(current => current + 1)
  vi.spyOn(engine, 'predictNormalArtian').mockImplementation(() => createRestorationBonusSet())
  vi.spyOn(engine, 'advanceNormalCounter').mockImplementation((current, op) => current + op.count)
  const skill = fixture.input.targetWeapons[0].idealSkillCondition.seriesSkillId
  vi.spyOn(engine, 'predictSkills').mockImplementation(() => ({ seriesSkillId: skill, groupSkillId: null }))
  vi.spyOn(engine, 'advanceSkillCounter').mockImplementation(current => current + 1)
  return fixture
}

async function capturedNoMatch() {
  const fixture = await gapFixture()
  const captures: GlobalResearchNoMatchCapture[] = []
  const base = await runGlobalPlannerResearch(fixture.input, globalResearchDependencies(fixture.engine), { extent: fixture.search.settings, nowMs: () => 0,
    onBoundedNoMatch: capture => captures.push(capture) })
  expect(captures).toHaveLength(1)
  return { ...fixture, base, capture: captures[0] }
}

const EMPTY: RetrySignals = { notFound: [], resourceRejected: [], conflictTargets: [], conflicts: [], blockers: [] }

describe('Phase 1-D default parity', () => {
  // SHA-256 of the complete { report, finalResult, generatedEntries } computed with the pre-Phase 1-D implementation.
  it('keeps Phase 0 and explicit Phase 1-C attempts semantically identical when no fallback is requested', async () => {
    const { input, search, engine } = await globalResearchFixture()
    const run = (o = {}) => runGlobalPlannerResearch(input, globalResearchDependencies(engine), { extent: search.settings, nowMs: () => 0, ...o })
    const a = await run()
    expect(await sha(a)).toBe('9ae56d7eb3c06352bd140d28c66bd5db3c42c2f5b98a7c50c97ad11610a73cb7')
    const attempt = { retainedEntryIds: a.report.retainedOriginalEntryIds, pendingTargetIds: a.report.searches.map(s => s.targetId) }
    expect(await sha(await run({ attempt }))).toBe('9ae56d7eb3c06352bd140d28c66bd5db3c42c2f5b98a7c50c97ad11610a73cb7')
    expect(await sha(await run({ attempt: { retainedEntryIds: [], pendingTargetIds: input.buildListEntries.map(e => e.targetWeaponId) } })))
      .toBe('f14a313a54bb35a75e57cf71c283f965c7e427ec8d7a42c5f1ef592e28a4676f')
    const predict = engine.predictGogmaBonus.bind(engine)
    vi.spyOn(engine, 'predictGogmaBonus').mockImplementation(value => value.gogmaCounter === 11 ? utility() : predict(value))
    const noMatch = await run()
    expect(noMatch.report.searches.map(s => s.status)).toEqual(['not_found_within_extent'])
    expect(await sha(noMatch)).toBe('8617186360bf0c426cef083b5f525815172227c0493979ceb63b0814a82f4a2b')
    expect(noMatch.report.extentFallback).toBeUndefined()
    expect(noMatch.report.searches[0].fallback).toBeUndefined()
  })
})

describe('Phase 1-D single-axis probe', () => {
  it('changes exactly one axis by the bounded factor and derives eligibility from observed boundaries only', () => {
    const base = { maxNormalAdvance: 350, maxGogmaAdvance: 500, maxSkillAdvance: 1500 }
    expect(singleAxisProbeExtent(base, 'normal')).toEqual({ maxNormalAdvance: 700, maxGogmaAdvance: 500, maxSkillAdvance: 1500 })
    expect(singleAxisProbeExtent(base, 'gogma')).toEqual({ maxNormalAdvance: 350, maxGogmaAdvance: 1000, maxSkillAdvance: 1500 })
    expect(singleAxisProbeExtent(base, 'skill')).toEqual({ maxNormalAdvance: 350, maxGogmaAdvance: 500, maxSkillAdvance: 3000 })
    expect(base).toEqual({ maxNormalAdvance: 350, maxGogmaAdvance: 500, maxSkillAdvance: 1500 })
    const none = { normal: false, gogma: false, skillExisting: false, skillConversion: false }
    expect(eligibleExtentAxes(none)).toEqual([])
    expect(eligibleExtentAxes({ ...none, gogma: true })).toEqual(['gogma'])
    expect(eligibleExtentAxes({ ...none, skillConversion: true })).toEqual(['skill'])
    expect(eligibleExtentAxes({ ...none, normal: true, skillExisting: true })).toEqual(['normal', 'skill'])
  })

  it('fires the generic fallback only for a bounded no-match whose axis reached its boundary, whatever the Target', () => {
    const measurement = { targetId: 'T1', status: 'not_found_within_extent', extent: { maxNormalAdvance: 3, maxGogmaAdvance: 4, maxSkillAdvance: 5 },
      predictionBoundaryReached: { normal: false, gogma: true, skillExisting: false, skillConversion: false } } as SearchMeasurement
    const gogma = createSingleAxisExtentFallback('gogma', 10), normal = createSingleAxisExtentFallback('normal', 10)
    expect(gogma.request(measurement)).toEqual({ axis: 'gogma', extent: { maxNormalAdvance: 3, maxGogmaAdvance: 8, maxSkillAdvance: 5 } })
    expect(gogma.request({ ...measurement, targetId: 'another-target' })).toEqual(gogma.request(measurement))
    expect(normal.request(measurement)).toBeNull()
    for (const status of ['found', 'unavailable', 'search_error', 'cancelled', 'time_budget_reached'] as const) expect(gogma.request({ ...measurement, status })).toBeNull()
    expect(() => createSingleAxisExtentFallback('all' as 'gogma', 10)).toThrow()
  })

  it('probes every eligible axis independently from one unchanged snapshot with a regenerated identity', async () => {
    const { input, engine, capture } = await capturedNoMatch()
    expect(capture.measurement.status).toBe('not_found_within_extent')
    const axes = eligibleExtentAxes(capture.measurement.predictionBoundaryReached)
    expect(axes).toEqual(['normal', 'gogma', 'skill'])
    const before = structuredClone(capture)
    // The captured request is exactly what the Research authority builds for the base extent.
    expect(probeSearchInput(capture, capture.measurement.extent)).toEqual(capture.searchInput)
    const records = []
    for (const axis of axes) records.push(await runGlobalExtentProbe(input, capture, axis, globalResearchDependencies(engine), { timeBudgetMs: 1000, nowMs: () => 0 }))
    expect(capture).toEqual(before)
    expect(records.map(r => r.status)).toEqual(['not_found_within_extent', 'found', 'not_found_within_extent'])
    for (const r of records) {
      expect(r.baseExtent).toEqual(capture.measurement.extent)
      expect(r.probeExtent).toEqual(singleAxisProbeExtent(capture.measurement.extent, r.axis))
      expect(r.probeSearchRunId).not.toBe(capture.searchInput.searchRunId)
      expect(r.snapshotFingerprint).toBe(records[0].snapshotFingerprint)
      expect(r.snapshotFingerprint).toMatch(/^fnv1a32:/)
    }
    expect(new Set(records.map(r => r.probeSearchRunId)).size).toBe(3)
    const found = records[1]
    expect(found).toMatchObject({ routeKind: 'normal_artian_to_gogma', advances: { gogma: 2 }, validation: { status: 'passed' } })
    // Order independence: the Gogma probe alone gives the same Candidate.
    const alone = await runGlobalExtentProbe(input, before, 'gogma', globalResearchDependencies(engine), { timeBudgetMs: 1000, nowMs: () => 0 })
    expect(alone.candidateFingerprint).toBe(found.candidateFingerprint)
    // No post-hoc hash rewrite: the probe Candidate is what the ordinary Search returns for the probe request.
    const probeInput = probeSearchInput(capture, found.probeExtent)
    const direct = (await searchCandidates(probeInput, engine, { now: () => GLOBAL_RESEARCH_TIME })).targetResult.candidate!
    expect(direct.searchRunId).toBe(found.probeSearchRunId)
    expect(validateBuildCandidate(direct, capture.searchInput.ownedWeapons).isValid).toBe(true)
    const entry = materializeGlobalResearchCandidate(input, probeInput, direct)
    expect(validateBuildListEntry(entry).isValid).toBe(true)
    expect(entry.id).toBe(found.validation.generatedEntryId)
    await expect(runGlobalExtentProbe(input, { ...capture, measurement: { ...capture.measurement, predictionBoundaryReached: { normal: false, gogma: false, skillExisting: false, skillConversion: false } } },
      'gogma', globalResearchDependencies(engine), { timeBudgetMs: 1000 })).rejects.toThrow('boundary')
    const forged = structuredClone(capture)
    forged.searchInput.searchRunId = 'research.global.search.forged'
    await expect(runGlobalExtentProbe(input, forged, 'gogma', globalResearchDependencies(engine), { timeBudgetMs: 1000 })).rejects.toThrow('authority')
  })

  it('keeps probe deadline, cancellation and prediction errors apart from a bounded no-match', async () => {
    const { input, engine, capture } = await capturedNoMatch()
    const deadline = await runGlobalExtentProbe(input, capture, 'gogma', globalResearchDependencies(engine), { timeBudgetMs: 0, nowMs: () => 0 })
    expect(deadline).toMatchObject({ status: 'time_budget_reached', routeKind: null, candidateFingerprint: null })
    const cancelled = await runGlobalExtentProbe(input, capture, 'gogma', globalResearchDependencies(engine), { timeBudgetMs: 1000, nowMs: () => 0, shouldCancel: () => true })
    expect(cancelled.status).toBe('cancelled')
    const failing = await gapFixture({ gogma12: 'throw' })
    const error = await runGlobalExtentProbe(input, capture, 'gogma', globalResearchDependencies(failing.engine), { timeBudgetMs: 1000, nowMs: () => 0 })
    expect(error).toMatchObject({ status: 'search_error', error: 'prediction failed at 12' })
  })
})

describe('Phase 1-D integrated fallback', () => {
  it('rediscovers the Candidate in a fresh run, keeps the base no-match, materializes, projects and completes', async () => {
    const { input, search, engine } = await gapFixture()
    const before = structuredClone(input)
    const captures: GlobalResearchNoMatchCapture[] = []
    const run = () => runGlobalPlannerResearch(input, globalResearchDependencies(engine), { extent: search.settings, nowMs: () => 0,
      extentFallback: createSingleAxisExtentFallback('gogma', 1000), onBoundedNoMatch: capture => captures.push(capture) })
    const result = await run()
    const [measurement] = result.report.searches
    expect(measurement.status).toBe('not_found_within_extent')
    expect(measurement.routeKind).toBeNull()
    expect(measurement.targetOutcome).toBe('resolved_by_extent_fallback')
    expect(measurement.fallback).toMatchObject({ axis: 'gogma', status: 'found', stoppedBy: null, extent: { ...search.settings, maxGogmaAdvance: 2 },
      baseExtent: search.settings, routeKind: 'normal_artian_to_gogma', generatedEntryId: measurement.generatedEntryId })
    // Same projected snapshot, identity regenerated through the one request authority.
    expect(measurement.fallback!.searchRunId).toBe(probeSearchInput(captures[0], measurement.fallback!.extent).searchRunId)
    expect(measurement.fallback!.searchRunId).not.toBe(captures[0].searchInput.searchRunId)
    expect(result.report.extentFallback).toEqual({ strategy: 'gogma-2x-fallback', searches: 1, searchElapsedMs: 0 })
    expect(result.report.algorithm).toBe('phase1d-extent-fallback-v1:gogma-2x-fallback')
    expect(result.report.status, JSON.stringify(result.report)).toBe('completed')
    expect(result.report.final).toMatchObject({ completedTargetCount: 2, conflicts: 0, rejected: 0, resourceConflictRejected: 0, traceReplay: 'passed', status: 'completed' })
    expect(result.generatedEntries).toHaveLength(1)
    expect(validateBuildListEntry(result.generatedEntries[0]).isValid).toBe(true)
    const signals = collectRetrySignals(input, result.report, result.finalResult, result.generatedEntries)
    expect(signals.notFound).toEqual([])
    expect(signals.blockers).toEqual([])
    expect(classifyAttempt(result.report, signals)).toBe('completed')
    // Independent rerun with fresh dependencies reproduces every semantic byte.
    expect(await run()).toEqual(result)
    expect(input).toEqual(before)
    // The same generic policy discovers what the focused probe found, without receiving it.
    const { capture } = await capturedNoMatch()
    const probe = await runGlobalExtentProbe(input, capture, 'gogma', globalResearchDependencies(engine), { timeBudgetMs: 1000, nowMs: () => 0 })
    expect(result.generatedEntries[0].id).toBe(probe.validation.generatedEntryId)
  })

  it('records an unresolved fallback no-match, and never treats fallback stops or errors as a no-match', async () => {
    const { input, search, engine } = await gapFixture()
    const dependencies = () => globalResearchDependencies(engine)
    const normal = await runGlobalPlannerResearch(input, dependencies(), { extent: search.settings, nowMs: () => 0, extentFallback: createSingleAxisExtentFallback('normal', 1000) })
    expect(normal.report.searches[0]).toMatchObject({ status: 'not_found_within_extent', targetOutcome: 'unresolved_after_extent_fallback', fallback: { status: 'not_found_within_extent' } })
    const normalSignals = collectRetrySignals(input, normal.report, normal.finalResult, normal.generatedEntries)
    expect(normalSignals.notFound).toEqual([normal.report.searches[0].targetId])
    expect(normal.report.status).toBe('partial')
    expect(normal.report.final).not.toBeNull()

    const deadline = await runGlobalPlannerResearch(input, dependencies(), { extent: search.settings, nowMs: () => 0, extentFallback: createSingleAxisExtentFallback('gogma', 0) })
    expect(deadline.report.searches[0]).toMatchObject({ status: 'not_found_within_extent', fallback: { status: 'time_budget_reached', stoppedBy: 'fallback_budget' } })
    expect(deadline.report.status).toBe('blocked')
    expect(deadline.finalResult).toBeNull()
    const deadlineSignals = collectRetrySignals(input, deadline.report, deadline.finalResult, deadline.generatedEntries)
    expect(deadlineSignals.blockers).toEqual([{ targetId: deadline.report.searches[0].targetId, classification: 'extent_fallback_time_budget_reached' }])
    expect(classifyAttempt(deadline.report, deadlineSignals)).toBe('extent_fallback_blocked')

    let cancel = false
    const cancelled = await runGlobalPlannerResearch(input, dependencies(), { extent: search.settings, nowMs: () => 0, extentFallback: createSingleAxisExtentFallback('gogma', 1000),
      shouldCancel: () => cancel, onProgress: report => { if (report.searches.some(s => s.fallback?.status === 'searching')) cancel = true } })
    expect(cancelled.report.status).toBe('cancelled')
    expect(cancelled.report.searches[0]).toMatchObject({ status: 'not_found_within_extent', fallback: { status: 'cancelled', stoppedBy: 'external_cancel' } })
    expect(cancelled.finalResult).toBeNull()

    const failing = await gapFixture({ gogma12: 'throw' })
    const error = await runGlobalPlannerResearch(failing.input, globalResearchDependencies(failing.engine), { extent: failing.search.settings, nowMs: () => 0,
      extentFallback: createSingleAxisExtentFallback('gogma', 1000) })
    expect(error.report.searches[0]).toMatchObject({ status: 'not_found_within_extent', fallback: { status: 'search_error', error: 'prediction failed at 12' } })
    expect(error.report.status).toBe('blocked')
    expect(error.finalResult).toBeNull()
    expect(classifyAttempt(error.report, collectRetrySignals(failing.input, error.report, error.finalResult, error.generatedEntries))).toBe('extent_fallback_blocked')
  })

  it('does not fire when the Search found a Candidate, even with a fallback configured', async () => {
    const { input, search, engine } = await globalResearchFixture()
    const plain = await runGlobalPlannerResearch(input, globalResearchDependencies(engine), { extent: search.settings, nowMs: () => 0 })
    const configured = await runGlobalPlannerResearch(input, globalResearchDependencies(engine), { extent: search.settings, nowMs: () => 0,
      extentFallback: createSingleAxisExtentFallback('gogma', 1000) })
    expect(configured.report.extentFallback?.searches).toBe(0)
    expect(configured.finalResult).toEqual(plain.finalResult)
    expect(configured.generatedEntries).toEqual(plain.generatedEntries)
  })
})

function attempt(id: number, notFound: string[], final: Partial<NonNullable<AttemptSummary['report']['final']>> | null, extra: Partial<StoredResearchAttempt> = {}): StoredResearchAttempt {
  const state: DiscoveryState = { retainedEntryIds: ['r'], pendingTargetIds: [`order-${id}`], extent: { maxNormalAdvance: 350, maxGogmaAdvance: 500, maxSkillAdvance: 1500 } }
  return { attemptId: id, strategy: 'fixed_retained', reason: 'test', state, signature: discoverySignature(state), stop: null,
    signals: { ...EMPTY, notFound }, evidence: { resultSha256: `sha-${id}`, planSha256: `plan-${id}` },
    report: { status: 'partial', error: null, planningTargetCount: 43, searches: notFound.map(targetId => ({ targetId, status: 'not_found_within_extent' })),
      final: final && { completedTargetCount: 42, conflicts: 2, rejected: 1, resourceConflictRejected: 1, steps: 6000, traceReplay: 'passed', ...final } } as unknown as AttemptSummary['report'],
    ...extra }
}

describe('Phase 1-D anchors, bounds and comparison', () => {
  it('selects anchors from observed attempts only: best evidenced partial plus one with a different no-match Target', () => {
    const attempts = [attempt(0, ['X'], { steps: 7000 }), attempt(1, ['Y'], { steps: 6214 }), attempt(2, ['X'], { steps: 6448 }),
      attempt(3, ['Z'], { steps: 10 }, { signals: { ...EMPTY, notFound: ['Z'], blockers: [{ targetId: 'Z', classification: 'search_error' }] }, stop: 'search_error' }),
      attempt(4, ['W'], { completedTargetCount: 41, steps: 1 }), attempt(5, ['V'], { steps: 5, traceReplay: 'not_run' }), attempt(6, ['U'], { steps: 5 }, { evidence: null })]
    const selection = selectExtentProbeAnchors(attempts, 1)
    expect(selection.anchors.map(a => [a.role, a.attemptId])).toEqual([['primary', 1], ['secondary', 2]])
    expect(selection.primaryMatchesReportedBest).toBe(true)
    expect(selection.rejectedAttemptIds).toEqual([3, 5, 6])
    expect(selection.anchors[0].expected).toMatchObject({ completed: 42, steps: 6214, notFound: ['Y'], resultSha256: 'sha-1' })
    // Renaming every Target changes nothing about which observed state is chosen.
    const renamed = attempts.map(a => ({ ...a, signals: { ...a.signals, notFound: a.signals.notFound.map(id => `renamed-${id}`) } }))
    expect(selectExtentProbeAnchors(renamed, 1).anchors.map(a => a.attemptId)).toEqual([1, 2])
    expect(selectExtentProbeAnchors([attempts[1], attempts[1]], 1).anchors).toHaveLength(1)
    expect(selectExtentProbeAnchors([{ ...attempts[1], signature: 'tampered' }], 1).anchors).toHaveLength(0)
  })

  it('never reruns the same anchor + axis and keeps probe / variant upper bounds', () => {
    const ledger = new ExtentResearchLedger()
    expect(ledger.claimProbe('a', 's', 'normal')).toBe(true)
    expect(ledger.claimProbe('a', 's', 'normal')).toBe(false)
    expect(ledger.claimVariant('a', 'normal-2x-fallback')).toBe(true)
    expect(ledger.claimVariant('a', 'normal-2x-fallback')).toBe(false)
    for (let i = 1; i < PHASE1D_BOUNDS.maxProbes; i++) ledger.claimProbe('b', `s${i}`, 'gogma')
    expect(() => ledger.claimProbe('c', 's', 'skill')).toThrow('bound')
    for (let i = 1; i < PHASE1D_BOUNDS.maxVariants; i++) ledger.claimVariant(`v${i}`, 'skill-2x-fallback')
    expect(() => ledger.claimVariant('z', 'gogma-2x-fallback')).toThrow('bound')
  })

  it('compares integrated variants by their final Global Plans, never by a Candidate or an axis name', () => {
    const v = (signature: string, final: ExtentVariantOutcome['final'], stop: string | null = null): ExtentVariantOutcome => ({ signature, planningTargetCount: 43, final, stop })
    const done = { completedTargetCount: 43, conflicts: 0, rejected: 0, resourceConflictRejected: 0, steps: 5000, traceReplay: 'passed', status: 'completed' }
    const partial = { ...done, completedTargetCount: 42, conflicts: 1, rejected: 1, resourceConflictRejected: 1, steps: 100, status: 'exhausted' }
    const ranked = [v('a-skill', partial), v('b-normal', done, 'completed'), v('c-gogma', { ...done, steps: 4000 }, 'completed'), v('d', null, 'process_error')].sort(compareExtentVariants)
    expect(ranked.map(x => x.signature)).toEqual(['c-gogma', 'b-normal', 'a-skill', 'd'])
    expect(isGlobalPlanSuccess(v('x', { ...done, traceReplay: 'not_run' }, 'completed'))).toBe(false)
    expect(isGlobalPlanSuccess(v('x', { ...done, resourceConflictRejected: 1 }, 'completed'))).toBe(false)
    expect(isGlobalPlanSuccess(v('x', { ...done, status: 'incomplete' }, 'completed'))).toBe(false)
    expect([v('z', done, 'completed'), v('y', done, 'completed')].sort(compareExtentVariants).map(x => x.signature)).toEqual(['y', 'z'])
  })

  it('never lets a later error or OOM overwrite a completed outcome', async () => {
    const done = { completedTargetCount: 43, conflicts: 0, rejected: 0, resourceConflictRejected: 0, steps: 5000, traceReplay: 'passed', status: 'completed' }
    expect(phase1dControllerOutcome([{ signature: 'a', planningTargetCount: 43, final: done, stop: 'completed' },
      { signature: 'b', planningTargetCount: 43, final: null, stop: 'memory_limit' }], 'process_error')).toBe('completed')
    expect(phase1dControllerOutcome([{ signature: 'b', planningTargetCount: 43, final: null, stop: 'memory_limit' }], null)).toBe('not_completed')
    // Phase 1-C controller: a completed retain-none control followed by a failing release stays completed.
    const state: DiscoveryState = { retainedEntryIds: ['r'], pendingTargetIds: ['A'], extent: { maxNormalAdvance: 1, maxGogmaAdvance: 1, maxSkillAdvance: 1 } }
    const signals: RetrySignals = { ...EMPTY, notFound: ['A'], conflicts: [{ id: 'c', kind: 'same_skill_counter', participants: [
      { entryId: 'r', targetId: 'R', role: 'retained' }, { entryId: 'a', targetId: 'A', role: 'pending_original' }] }] }
    const summary = (s: DiscoveryState, id: number, stop: AttemptSummary['stop']): AttemptSummary => ({ attemptId: id, strategy: 'fixed_retained', reason: 't', state: s,
      signature: discoverySignature(s), signals, stop, report: { status: 'partial', searches: [], planningTargetCount: 2, retainedOriginalEntryIds: s.retainedEntryIds } as unknown as AttemptSummary['report'] })
    const result = await runDiscoveryRetries(summary(state, 0, null), [{ id: 'r', targetWeaponId: 'R' }, { id: 'a', targetWeaponId: 'A' }],
      async (s, strategy, reason, id) => ({ ...summary(s, id, strategy === 'retain_none' ? 'completed' : 'memory_limit'), strategy, reason }),
      { orderingAttempts: 1, maxStates: 4, releaseDepth: 1 })
    expect(result.attempts.map(a => a.stop)).toEqual([null, 'completed', 'memory_limit'])
    expect(result.stopReason).toBe('completed')
  })
})
