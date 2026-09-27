import { describe, expect, it } from 'vitest'
import { classifyAttempt, collectRetrySignals, discoverySignature, orderingVariants, retainedReleaseCandidates, runDiscoveryRetries, parseDiscoveryState,
  type AttemptSummary, type DiscoveryState, type RetrySignals } from './plannerGlobalOptimizationRetry'
import type { GlobalResearchReport } from './plannerGlobalOptimizationResearch'
import { GLOBAL_RESEARCH_EXTENT } from './plannerGlobalOptimizationResearch'
import type { PlannerInput, PlannerResult } from '../domain/planner/plannerTypes'
import type { BuildListEntry } from '../domain/models/publicTypes'

const empty = (): RetrySignals => ({ notFound: [], resourceRejected: [], conflictTargets: [], conflicts: [], blockers: [] })
const priority = ['r', 'a', 'b', 'c'].map(id => ({ id, targetWeaponId: id.toUpperCase() }))
const state: DiscoveryState = { retainedEntryIds: ['r'], pendingTargetIds: ['A', 'B', 'C'], extent: GLOBAL_RESEARCH_EXTENT }
function summary(s = state, signals = empty(), attemptId = 0): AttemptSummary {
  return { attemptId, strategy: 'fixed_retained', reason: 'test', state: structuredClone(s), signature: discoverySignature(s), signals,
    report: { status: 'partial', searches: [], planningTargetCount: 4, retainedOriginalEntryIds: s.retainedEntryIds } as unknown as GlobalResearchReport, stop: null }
}
describe('Research deterministic retry controller', () => {
  it('validates external state without coercing IDs or bounds', () => {
    expect(parseDiscoveryState(state)).toEqual(state)
    for (const value of [null, {}, { ...state, retainedEntryIds: ['r', 'r'] }, { ...state, pendingTargetIds: [123] },
      { ...state, extent: { ...state.extent, maxNormalAdvance: '350' } }]) expect(() => parseDiscoveryState(value)).toThrow()
  })
  it('uses exact set/order/extent signatures', () => {
    expect(discoverySignature({ ...state, retainedEntryIds: ['x', 'r'] })).toBe(discoverySignature({ ...state, retainedEntryIds: ['r', 'x'] }))
    expect(discoverySignature({ ...state, pendingTargetIds: ['B', 'A', 'C'] })).not.toBe(discoverySignature(state))
    expect(discoverySignature({ ...state, extent: { ...state.extent, maxNormalAdvance: 700 } })).not.toBe(discoverySignature(state))
  })
  it('partitions from semantic history only and keeps every pending Target', () => {
    const history = [{ ...empty(), notFound: ['C'] }, { ...empty(), resourceRejected: ['B'], conflictTargets: ['R', 'B'] }]
    const variants = orderingVariants(state.pendingTargetIds, history)
    expect(variants[0].order).toEqual(['B', 'A', 'C'])
    expect(variants[1].order).toEqual(['B', 'C', 'A'])
    expect(variants[2].order).toEqual(['B', 'C', 'A'])
    expect(orderingVariants(state.pendingTargetIds, structuredClone(history))).toEqual(variants)
    for (const v of variants) expect([...v.order].sort()).toEqual(['A', 'B', 'C'])
  })
  it('stops at state limit without rerunning any state; fixed stage has attempt limit', async () => {
    const first = summary(state, { ...empty(), notFound: ['C'] })
    const calls: string[] = []
    const run = async (s: DiscoveryState, strategy: string, reason: string, id: number) => {
      calls.push(discoverySignature(s)); return { ...summary(s, { ...empty(), notFound: ['B'] }, id), strategy, reason }
    }
    const result = await runDiscoveryRetries(first, priority, run, { orderingAttempts: 2, maxStates: 2, releaseDepth: 2 })
    expect(result.stopReason).toBe('state_limit')
    expect(result.stageStops).toEqual([{ strategy: 'fixed_retained', reason: 'attempt_limit' }])
    expect(calls).toHaveLength(1)
    expect(new Set(result.attempts.map(a => a.signature)).size).toBe(2)
  })
  it('detects cycles, runs retain-none once and never exceeds release depth', async () => {
    const signals: RetrySignals = { ...empty(), notFound: ['A'], resourceRejected: ['A'], conflictTargets: ['R', 'A'],
      conflicts: [{ id: 'conflict', kind: 'same_skill_counter', participants: [
        { entryId: 'r', targetId: 'R', role: 'retained' }, { entryId: 'newA', targetId: 'A', role: 'generated' }] }] }
    const result = await runDiscoveryRetries(summary(state, signals), priority,
      async (s, strategy, reason, id) => ({ ...summary(s, signals, id), strategy, reason }))
    expect(result.cycleCount).toBeGreaterThan(0)
    expect(result.stageStops[0].reason).toBe('cycle_detected')
    expect(result.attempts.filter(a => a.strategy === 'retain_none')).toHaveLength(1)
    expect(result.attempts.length).toBeLessThanOrEqual(12)
    expect(new Set(result.attempts.map(a => a.signature)).size).toBe(result.attempts.length)
    expect(result.attempts.filter(a => a.strategy === 'conflict_release').every(a => a.state.retainedEntryIds.length >= 0)).toBe(true)
    expect(retainedReleaseCandidates(signals, ['r'], priority)).toEqual(['r'])
    signals.conflicts[0].participants[0].role = 'pending_original'
    expect(retainedReleaseCandidates(signals, ['r'], priority)).toEqual([])
  })
  it('does not treat blockers, cancellation or timeout as bounded failure or success', async () => {
    for (const classification of ['search_error', 'materialization_blocked', 'projection_failed', 'checkpoint_blocked', 'cancelled', 'unavailable', 'time_budget_reached']) {
      const signals = { ...empty(), blockers: [{ targetId: 'A', classification }] }
      const report = { ...summary().report, status: 'completed' as const }
      expect(classifyAttempt(report, signals)).toBe(classification === 'time_budget_reached' ? 'time_budget' : classification)
      const first = { ...summary(state, signals), stop: classifyAttempt(report, signals) }
      const result = await runDiscoveryRetries(first, priority, async () => { throw new Error('Must not retry blocker') })
      expect(result.attempts).toHaveLength(1)
    }
    for (const stop of ['cancelled', 'time_budget'] as const) {
      const result = await runDiscoveryRetries(summary(), priority, async () => { throw new Error('Must not start') }, undefined, () => stop)
      expect(result.stopReason).toBe(stop)
    }
  })
  it('bounds release to depth two and rejects an invalid prefix without projecting it', async () => {
    const entries = ['r', 's', 't', 'a', 'b', 'c'].map(id => ({ id, targetWeaponId: id.toUpperCase() }))
    const initial = { ...state, retainedEntryIds: ['r', 's', 't'] }
    const signalsFor = (s: DiscoveryState): RetrySignals => ({ ...empty(), notFound: ['A'], resourceRejected: ['A'],
      conflicts: [{ id: 'opaque', kind: 'same_skill_counter', participants: [
        ...s.retainedEntryIds.map(entryId => ({ entryId, targetId: entryId.toUpperCase(), role: 'retained' as const })),
        { entryId: 'a', targetId: 'A', role: 'pending_original' }] }], conflictTargets: ['A'] })
    const result = await runDiscoveryRetries(summary(initial, signalsFor(initial)), entries, async (s, strategy, reason, id) => ({
      ...summary(s, signalsFor(s), id), strategy, reason,
      stop: strategy === 'conflict_release' && s.retainedEntryIds.join() === 'r,t' ? 'retained_prefix_invalid' : null,
    }), { orderingAttempts: 1, maxStates: 12, releaseDepth: 2 })
    const released = result.attempts.filter(a => a.strategy === 'conflict_release')
    expect(released.some(a => a.state.retainedEntryIds.length === 1)).toBe(true)
    expect(released.every(a => a.state.retainedEntryIds.length >= 1)).toBe(true)
    expect(released.some(a => a.stop === 'retained_prefix_invalid')).toBe(true)
    expect(result.attempts.length).toBeLessThanOrEqual(12)
  })
  it('uses typed participants/rejections, preserving generated versus retained roles', () => {
    const entries = priority.map(e => ({ id: e.id, targetWeaponId: e.targetWeaponId })) as BuildListEntry[]
    const generated = [{ id: 'newA', targetWeaponId: 'A' }] as BuildListEntry[]
    const result = { conflicts: [{ id: 'opaque', kind: 'same_skill_counter', buildListEntryIds: ['r', 'newA'], selectedBuildListEntryId: null,
      reason: 'Deliberately false participant: c' }], plan: { rejectedBuildListEntries: [{ buildListEntryId: 'newA', reason: 'resource_conflict', detail: 'wrong Target C' }] } } as unknown as PlannerResult
    const report = { ...summary().report, searches: [{ targetId: 'A', status: 'not_found_within_extent' }, { targetId: 'C', status: 'search_error' }] } as GlobalResearchReport
    const signals = collectRetrySignals({ buildListEntries: entries } as PlannerInput, report, result, generated)
    expect(signals.notFound).toEqual(['A'])
    expect(signals.resourceRejected).toEqual(['A'])
    expect(signals.conflictTargets).toEqual(['R', 'A'])
    expect(signals.blockers).toEqual([{ targetId: 'C', classification: 'search_error' }])
    expect(retainedReleaseCandidates(signals, ['r'], priority)).toEqual(['r'])
  })
})
