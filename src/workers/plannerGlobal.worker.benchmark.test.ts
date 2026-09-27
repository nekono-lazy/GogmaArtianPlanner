import { describe, expect, it, vi } from 'vitest'
import type { PlannerGlobalBenchmarkResponse, PlannerGlobalRunRequest, PlannerGlobalWorkerResult } from '../benchmarks/plannerGlobalBrowserBenchmarkProtocol'
import { jsonSha256, webCryptoSha256 } from '../benchmarks/plannerGlobalBrowserEvidence'
import { plannerGlobalBrowserRealFixture } from '../benchmarks/plannerGlobalBrowserTestFixture'
import { singleAxisProbeExtent, EXTENT_AXES } from '../benchmarks/plannerGlobalOptimizationExtentProbe'
import { createPhase1EFallback, derivedAttemptState } from '../benchmarks/plannerGlobalOptimizationPhase1E'
import { GLOBAL_RESEARCH_EXTENT, globalResearchDependencies, runGlobalPlannerResearch, type SearchMeasurement } from '../benchmarks/plannerGlobalOptimizationResearch'
import { classifyAttempt, collectRetrySignals, stableResearchEntries } from '../benchmarks/plannerGlobalOptimizationRetry'
import { globalResearchFixture } from '../benchmarks/plannerGlobalOptimizationTestFixture'
import { GlobalRawBlockResearch } from '../benchmarks/plannerGlobalRawBlocks'
import type { PlannerInput } from '../domain/planner/plannerTypes'
import type { CandidateSearchResult } from '../domain/search/searchTypes'
import type { RngEngine } from '../domain/rng/rngEngine'
import { ProductionRngEngine } from '../domain/rng/production/productionRngEngine'
import { createRestorationBonusSet } from '../test/fixtures/domainData'
import { createPlannerGlobalBenchmarkController, plannerGlobalMessageChannelYield, plannerGlobalTimerYield, type PlannerGlobalBenchmarkControllerOptions } from './plannerGlobal.worker.benchmark'

function runRequest(input: PlannerInput, overrides: Partial<PlannerGlobalRunRequest> = {}): PlannerGlobalRunRequest {
  return { type: 'pg2a_benchmark_run', requestId: 'r1', input, mode: 'control', fallbackAxis: null, rawCache: 'per-search', yieldMode: 'timer',
    maxPlanSteps: input.options.maxPlanSteps, fallbackBudgetMs: null, fallbackMaxEpisodes: null, attemptBudgetMs: null, attemptState: null,
    measurement: 'timing', profiler: false, ...overrides }
}

function realController(extra: Partial<PlannerGlobalBenchmarkControllerOptions> = {}) {
  const messages: PlannerGlobalBenchmarkResponse[] = []
  const modes: string[] = []
  const controller = createPlannerGlobalBenchmarkController(m => messages.push(structuredClone(m)), {
    createEngine: () => new ProductionRngEngine(),
    createRawBlocks: mode => { modes.push(mode); return new GlobalRawBlockResearch(mode) },
    yieldFor: () => async () => undefined, ...extra,
  })
  return { controller, messages, modes }
}
const resultOf = (messages: PlannerGlobalBenchmarkResponse[]) => {
  const found = messages.find(m => m.type === 'pg2a_benchmark_result' || m.type === 'pg2a_benchmark_cancelled')
  if (!found || (found.type !== 'pg2a_benchmark_result' && found.type !== 'pg2a_benchmark_cancelled')) throw new Error(JSON.stringify(messages.filter(m => m.type === 'pg2a_benchmark_error')))
  return found.result
}

/** Gogma counters in `gaps` draw a non-Ideal set, as in the Phase 1-E fallback tests (fake engine). */
async function gapFixture(gaps: readonly number[]) {
  const fixture = await globalResearchFixture({ extraTargets: 1 })
  const engine = fixture.engine
  vi.spyOn(engine, 'predictGogmaBonus').mockImplementation(value => gaps.includes(value.gogmaCounter)
    ? createRestorationBonusSet().map(b => ({ ...b, bonusTypeId: 'bonus_type.fixture.utility' })) as ReturnType<typeof createRestorationBonusSet> : createRestorationBonusSet())
  vi.spyOn(engine, 'advanceGogmaCounter').mockImplementation(current => current + 1)
  vi.spyOn(engine, 'predictNormalArtian').mockImplementation(() => createRestorationBonusSet())
  vi.spyOn(engine, 'advanceNormalCounter').mockImplementation((current, op) => current + op.count)
  const skill = fixture.input.targetWeapons[0].idealSkillCondition.seriesSkillId
  vi.spyOn(engine, 'predictSkills').mockImplementation(() => ({ seriesSkillId: skill, groupSkillId: null }))
  vi.spyOn(engine, 'advanceSkillCounter').mockImplementation(current => current + 1)
  return fixture
}
/** A raw block Research stand-in for the fake Engine: the Search reads the given Engine; begin/end are recorded. */
function fakeRawBlocks(engine: RngEngine, calls: string[]) {
  return { beginSearch: (target: string) => { calls.push(`begin:${target}`); return { engine, profile: {}, read: () => { throw new Error('unused') }, end: () => { calls.push('end') } } },
    summary: () => ({ fake: true }), endRun: () => { calls.push('endRun') } } as unknown as GlobalRawBlockResearch
}

describe('Phase 2-A benchmark Worker controller', () => {
  it('runs the Research itself on the real Production Engine and returns the Node runner evidence (SHA-256 of the same JSON)', async () => {
    const input = await plannerGlobalBrowserRealFixture()
    const { controller, messages, modes } = realController()
    await controller.handleMessage(runRequest(input))
    expect(modes).toEqual(['per-search'])
    const accepted = messages.find(m => m.type === 'pg2a_benchmark_accepted')
    expect(accepted).toMatchObject({ priorityEntries: stableResearchEntries(input).map(e => ({ id: e.id, targetWeaponId: e.targetWeaponId })) })
    const result = resultOf(messages)
    expect(result.stop).toBe('completed')
    expect(result.report.final?.traceReplay).toBe('passed')
    expect(result.evidence.searchEvidence.length).toBeGreaterThan(0)

    // The Node Phase 1-E runner, reproduced here: the same Research call, a JSON file round trip, the same projections.
    const searchResults: CandidateSearchResult[] = []
    const node = await runGlobalPlannerResearch(input, globalResearchDependencies(new ProductionRngEngine()), { rawBlocks: new GlobalRawBlockResearch('per-search'),
      onSearchResult: r => searchResults.push(r) })
    const sha = (value: unknown) => jsonSha256(webCryptoSha256, value)
    const searchEvidence = await Promise.all(searchResults.map(async found => {
      const { elapsedMs: _elapsedMs, ...semantic } = found
      void _elapsedMs
      return { targetId: found.targetResult.targetWeaponId, resultSha256: await sha(semantic), candidateSha256: await sha(found.targetResult.candidate) }
    }))
    const stored = JSON.parse(JSON.stringify(node.report)) as typeof node.report
    const priority = stableResearchEntries(input).map(e => ({ id: e.id, targetWeaponId: e.targetWeaponId }))
    const signals = collectRetrySignals(input, node.report, node.finalResult, node.generatedEntries)
    const expectedSemantic = {
      retainedOriginalEntryIds: [...stored.retainedOriginalEntryIds].sort(), pendingOrder: stored.searches.map(s => s.targetId),
      state: derivedAttemptState(stored.retainedOriginalEntryIds, priority, GLOBAL_RESEARCH_EXTENT),
      statuses: stored.searches.map(s => ({ targetId: s.targetId, status: s.status, targetOutcome: s.targetOutcome ?? null })), fallbacks: [],
      fallbackSearchEvidence: [], searchEvidence,
      generatedEntries: await Promise.all(node.generatedEntries.map(async e => ({ id: e.id, candidateSha256: await sha(e.candidateSnapshot), entrySha256: await sha(e) }))),
      selected: node.finalResult?.plan?.selectedBuildListEntryIds ?? [], planSha256: await sha(node.finalResult?.plan ?? null),
      finalResultSha256: await sha(node.finalResult ?? null), resultSha256: await sha({ finalResult: node.finalResult, generatedEntries: node.generatedEntries }),
      stop: classifyAttempt(node.report, signals), final: stored.final && { ...stored.final, elapsedMs: undefined },
    }
    expect(result.semantic).toEqual(JSON.parse(JSON.stringify(expectedSemantic)))
    expect(result.semanticSha256).toBe(await sha(expectedSemantic))
    expect(result.evidence.planSha256).toBe(expectedSemantic.planSha256)
    expect(result.evidence.resultSha256).toBe(expectedSemantic.resultSha256)
  })

  it('excludes every timing and memory value from the semantic evidence; raw cache off / per-search give identical semantics', async () => {
    const input = await plannerGlobalBrowserRealFixture()
    let tick = 0
    const slow = realController({ now: () => (tick += 1000) })
    await slow.controller.handleMessage(runRequest(input))
    const off = realController()
    await off.controller.handleMessage(runRequest(input, { rawCache: 'off' }))
    const a = resultOf(slow.messages), b = resultOf(off.messages)
    expect(off.modes).toEqual(['off'])
    expect(a.timing.workerElapsedMs).not.toBe(b.timing.workerElapsedMs)
    expect(b.semanticSha256).toBe(a.semanticSha256)
    expect(b.evidence).toEqual(a.evidence)
    expect(JSON.stringify(a.semantic)).not.toMatch(/elapsed|Ms"|memory|heap|visibility|userAgent/i)
    const summary = (r: PlannerGlobalWorkerResult) => r.rawBlockSummary as { hits: number; requests: number }
    expect(summary(b).hits).toBe(0)
    expect(summary(a).requests).toBe(summary(b).requests)
  })

  it('creates one raw block Research per run, ends every Search lifetime and the run, and uses the requested fallback axis', async () => {
    for (const axis of EXTENT_AXES) {
      const { input, engine } = await gapFixture([11])
      const calls: string[] = []
      const messages: PlannerGlobalBenchmarkResponse[] = []
      const controller = createPlannerGlobalBenchmarkController(m => messages.push(m), { createEngine: () => engine,
        createRawBlocks: () => fakeRawBlocks(engine, calls), yieldFor: () => async () => undefined })
      await controller.handleMessage(runRequest(input, { mode: 'fallback', fallbackAxis: axis, fallbackBudgetMs: 1000, fallbackMaxEpisodes: 3 }))
      const result = resultOf(messages)
      expect(result.report.algorithm).toBe(`phase1d-extent-fallback-v1:${axis}-2x-fallback`)
      expect(result.report.extentFallback).toMatchObject({ strategy: `${axis}-2x-fallback`, maxEpisodes: 3 })
      expect(calls.at(-1)).toBe('endRun')
      const lifetimes = calls.slice(0, -1)
      expect(lifetimes.filter(c => c === 'end').length).toBe(lifetimes.filter(c => c.startsWith('begin:')).length)
      lifetimes.forEach((call, i) => expect(call.startsWith('begin:')).toBe(i % 2 === 0))
      for (const f of result.fallbacks) expect(f.fallback.extent).toEqual(singleAxisProbeExtent(GLOBAL_RESEARCH_EXTENT, axis))
    }
    const measurement = { status: 'not_found_within_extent', extent: GLOBAL_RESEARCH_EXTENT,
      predictionBoundaryReached: { normal: true, gogma: true, skillExisting: true, skillConversion: true } } as SearchMeasurement
    expect(EXTENT_AXES.map(axis => createPhase1EFallback(axis, 1000).request(measurement)?.extent)).toEqual([
      { maxNormalAdvance: 700, maxGogmaAdvance: 500, maxSkillAdvance: 1500 },
      { maxNormalAdvance: 350, maxGogmaAdvance: 1000, maxSkillAdvance: 1500 },
      { maxNormalAdvance: 350, maxGogmaAdvance: 500, maxSkillAdvance: 3000 }])
  })

  it('refuses a duplicate, concurrent or second request (fresh Worker policy) and an invalid run before any calculation', async () => {
    const { input, engine } = await gapFixture([])
    const messages: PlannerGlobalBenchmarkResponse[] = []
    const created: string[] = []
    const controller = createPlannerGlobalBenchmarkController(m => messages.push(m), { createEngine: () => { created.push('engine'); return engine },
      createRawBlocks: () => fakeRawBlocks(engine, []), yieldFor: () => async () => undefined })
    await controller.handleMessage(runRequest(input, { requestId: 'bad', maxPlanSteps: 7 }))
    expect(messages).toEqual([{ type: 'pg2a_benchmark_error', requestId: 'bad', message: expect.stringContaining('maxPlanSteps must equal') }])
    expect(created).toEqual([])
    const fresh = createPlannerGlobalBenchmarkController(m => messages.push(m), { createEngine: () => engine, createRawBlocks: () => fakeRawBlocks(engine, []), yieldFor: () => async () => undefined })
    const first = fresh.handleMessage(runRequest(input, { requestId: 'one' }))
    await fresh.handleMessage(runRequest(input, { requestId: 'one' }))
    await fresh.handleMessage(runRequest(input, { requestId: 'two' }))
    await first
    expect(messages.filter(m => m.type === 'pg2a_benchmark_error').map(m => 'message' in m ? m.message : '')).toEqual([
      expect.stringContaining('maxPlanSteps'), "Duplicate request 'one'.", 'Fresh Worker policy: this Worker already ran an attempt.'])
    expect(messages.filter(m => m.type === 'pg2a_benchmark_result').map(m => 'requestId' in m && m.requestId)).toEqual(['one'])
  })

  it('answers ping and cancel between calculation slices; a cancel lands through a yield and is never a result or a no-match', async () => {
    // A long pending Search (non-Ideal Gogma draws 11..299) passes many Search checkpoints, so the calculation yields.
    const { input, engine } = await gapFixture(Array.from({ length: 289 }, (_, i) => 11 + i))
    const messages: PlannerGlobalBenchmarkResponse[] = []
    let yields = 0
    // Each yield stands for one macrotask turn in which the Worker dispatches whatever message is pending.
    const yieldControl = async () => {
      yields += 1
      if (yields === 1) await controller.handleMessage({ type: 'pg2a_benchmark_ping', pingId: 7 })
      if (yields === 2) await controller.handleMessage({ type: 'pg2a_benchmark_cancel', requestId: 'r1' })
    }
    const controller = createPlannerGlobalBenchmarkController(m => messages.push(structuredClone(m)), { createEngine: () => engine,
      createRawBlocks: () => fakeRawBlocks(engine, []), yieldFor: () => yieldControl })
    await controller.handleMessage(runRequest(input))
    const types = messages.map(m => m.type)
    expect(yields, JSON.stringify(types)).toBeGreaterThanOrEqual(2)
    expect(types).toContain('pg2a_benchmark_pong')
    expect(types.indexOf('pg2a_benchmark_cancel_ack')).toBeGreaterThan(types.indexOf('pg2a_benchmark_pong'))
    expect(types).not.toContain('pg2a_benchmark_result')
    const cancelled = messages.find(m => m.type === 'pg2a_benchmark_cancelled')!
    expect(cancelled.type === 'pg2a_benchmark_cancelled' && cancelled.result.report.status).toBe('cancelled')
    expect(cancelled.type === 'pg2a_benchmark_cancelled' && cancelled.result.stop).toBe('cancelled')
    expect(cancelled.type === 'pg2a_benchmark_cancelled' && cancelled.result.signals.notFound).toEqual([])
    expect(cancelled.type === 'pg2a_benchmark_cancelled' && cancelled.result.report.searches.at(-1)?.status).toBe('cancelled')
  })

  it('reports a deadline as time_budget_reached, never as a no-match or a cancel', async () => {
    const { input, engine } = await gapFixture([11])
    const messages: PlannerGlobalBenchmarkResponse[] = []
    let clock = 0
    const controller = createPlannerGlobalBenchmarkController(m => messages.push(m), { createEngine: () => engine, createRawBlocks: () => fakeRawBlocks(engine, []),
      yieldFor: () => async () => { clock += 10 }, now: () => clock })
    await controller.handleMessage(runRequest(input, { attemptBudgetMs: 0 }))
    const result = resultOf(messages)
    expect(messages.some(m => m.type === 'pg2a_benchmark_cancelled')).toBe(false)
    expect(result.report.status).toBe('time_budget_reached')
    expect(result.stop).toBe('time_budget')
  })

  it('yields through a MessageChannel task: it resolves only after the already queued microtasks, never as a microtask', async () => {
    // Deterministic: compares this yield's own resolution with a microtask, not the dispatch order of another MessagePort.
    const order: string[] = []
    const yielded = plannerGlobalMessageChannelYield().then(() => { order.push('message-channel') })
    await Promise.resolve().then(() => { order.push('microtask') })
    expect(order).toEqual(['microtask'])
    await yielded
    expect(order).toEqual(['microtask', 'message-channel'])
    await expect(plannerGlobalTimerYield()).resolves.toBeUndefined()
  })
})
