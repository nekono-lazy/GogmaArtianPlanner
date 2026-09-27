import { describe, expect, it } from 'vitest'
import type { PlannerInput } from '../domain/planner/plannerTypes'
import {
  isPlannerGlobalBenchmarkRequest,
  isPlannerGlobalBenchmarkResponse,
  validatePlannerGlobalRunRequest,
  type PlannerGlobalRunRequest,
} from './plannerGlobalBrowserBenchmarkProtocol'
import { jsonSha256, webCryptoSha256 } from './plannerGlobalBrowserEvidence'

const input = { options: { maxPlanSteps: 20000 } } as PlannerInput
const run = (overrides: Partial<PlannerGlobalRunRequest> = {}): PlannerGlobalRunRequest => ({ type: 'pg2a_benchmark_run', requestId: 'r', input, mode: 'fallback',
  fallbackAxis: 'normal', rawCache: 'per-search', yieldMode: 'message-channel', maxPlanSteps: 20000, fallbackBudgetMs: 180000, fallbackMaxEpisodes: 3,
  attemptBudgetMs: 900000, attemptState: null, measurement: 'timing', profiler: false, ...overrides })

describe('Phase 2-A benchmark protocol', () => {
  it('guards requests and responses structurally with its own prefix', () => {
    expect(isPlannerGlobalBenchmarkRequest(run())).toBe(true)
    expect(isPlannerGlobalBenchmarkRequest({ type: 'pg2a_benchmark_ping', pingId: 1 })).toBe(true)
    expect(isPlannerGlobalBenchmarkRequest({ type: 'pg2a_benchmark_cancel', requestId: 'r' })).toBe(true)
    for (const bad of [null, [], {}, { type: 'create_plan', requestId: 'r', input }, { type: 'pg2a_benchmark_cancel', requestId: '' },
      { type: 'pg2a_benchmark_ping', pingId: 1.5 }, { ...run(), input: null }, (({ attemptState: _a, ...rest }) => { void _a; return rest })(run()),
      { ...run(), profiler: 'no' }]) {
      expect(isPlannerGlobalBenchmarkRequest(bad), JSON.stringify(bad)).toBe(false)
    }
    expect(isPlannerGlobalBenchmarkResponse({ type: 'pg2a_benchmark_ready', environment: {} })).toBe(true)
    expect(isPlannerGlobalBenchmarkResponse({ type: 'pg2a_benchmark_result', requestId: 'r', result: {} })).toBe(true)
    expect(isPlannerGlobalBenchmarkResponse({ type: 'pg2a_benchmark_accepted', requestId: 'r', priorityEntries: [] })).toBe(true)
    for (const bad of [{ type: 'pa3_benchmark_pong', pingId: 1 }, { type: 'pg2a_benchmark_result', requestId: 'r' }, { type: 'pg2a_benchmark_error', requestId: '', message: 'x' },
      { type: 'result', requestId: 'r', result: {} }]) expect(isPlannerGlobalBenchmarkResponse(bad)).toBe(false)
  })

  it('validates the run meaning without defaulting anything', () => {
    expect(validatePlannerGlobalRunRequest(run())).toEqual([])
    expect(validatePlannerGlobalRunRequest(run({ mode: 'control', fallbackAxis: null, fallbackBudgetMs: null, fallbackMaxEpisodes: null }))).toEqual([])
    expect(validatePlannerGlobalRunRequest(run({ mode: 'control' }))).toEqual(['control takes no fallback axis, budget or episode bound'])
    expect(validatePlannerGlobalRunRequest(run({ fallbackAxis: null }))).toEqual(['fallbackAxis: null'])
    expect(validatePlannerGlobalRunRequest(run({ fallbackMaxEpisodes: 0 }))).toEqual(['fallbackMaxEpisodes must be an integer 1..6'])
    expect(validatePlannerGlobalRunRequest(run({ fallbackBudgetMs: -1 }))).toEqual(['fallbackBudgetMs must be a finite number >= 0'])
    expect(validatePlannerGlobalRunRequest(run({ maxPlanSteps: 1000 }))).toEqual(['maxPlanSteps must equal input.options.maxPlanSteps'])
    expect(validatePlannerGlobalRunRequest(run({ rawCache: 'run' as never, yieldMode: 'microtask' as never, attemptBudgetMs: Number.NaN }))).toEqual([
      'rawCache: run', 'yieldMode: microtask', 'attemptBudgetMs must be null or a finite number >= 0'])
  })

  it('hashes with SHA-256 over the exact JSON text (the Node runner formula)', async () => {
    expect(await webCryptoSha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(await jsonSha256(webCryptoSha256, null)).toBe(await webCryptoSha256('null'))
    // Same content in the same key order hashes equal; the formula is JSON.stringify, so construction order is part of it.
    expect(await jsonSha256(webCryptoSha256, { a: 1, b: [2] })).toBe(await jsonSha256(webCryptoSha256, JSON.parse('{"a":1,"b":[2]}')))
    expect(await jsonSha256(webCryptoSha256, { a: 1, b: undefined })).toBe(await jsonSha256(webCryptoSha256, { a: 1 }))
    expect(() => jsonSha256(webCryptoSha256, undefined)).toThrow('not JSON-serializable')
  })
})
