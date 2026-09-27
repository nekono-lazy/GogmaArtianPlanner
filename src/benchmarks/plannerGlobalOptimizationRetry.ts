/** Phase 1-C Research controller. No persisted state or Production policy. */
import type { BuildListEntry } from '../domain/models/publicTypes'
import type { PlannerInput, PlannerResult } from '../domain/planner/plannerTypes'
import { comparePlannerEntryPriority } from '../domain/planner/plannerEntryPriority'
import type { CandidateSearchSettings } from '../domain/search/searchTypes'
import type { GlobalResearchReport } from './plannerGlobalOptimizationResearch'

export interface DiscoveryState {
  retainedEntryIds: string[]
  pendingTargetIds: string[]
  extent: CandidateSearchSettings
}
export function parseDiscoveryState(value: unknown): DiscoveryState {
  if (!value || typeof value !== 'object') throw new Error('Invalid discovery state')
  const v = value as Record<string, unknown>
  const ids = (a: unknown): a is string[] => Array.isArray(a) && a.every(id => typeof id === 'string' && id.length > 0) && new Set(a).size === a.length
  if (!ids(v.retainedEntryIds) || !ids(v.pendingTargetIds) || !v.extent || typeof v.extent !== 'object') throw new Error('Invalid discovery state IDs/extent')
  const e = v.extent as Record<string, unknown>
  const bound = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n > 0
  if (!bound(e.maxNormalAdvance) || !bound(e.maxGogmaAdvance) || !bound(e.maxSkillAdvance)) throw new Error('Invalid discovery extent')
  return { retainedEntryIds: [...v.retainedEntryIds], pendingTargetIds: [...v.pendingTargetIds], extent: {
    maxNormalAdvance: e.maxNormalAdvance, maxGogmaAdvance: e.maxGogmaAdvance, maxSkillAdvance: e.maxSkillAdvance,
  } }
}
export interface RetrySignals {
  notFound: string[]
  resourceRejected: string[]
  conflictTargets: string[]
  conflicts: { id: string; kind: string; participants: { entryId: string; targetId: string; role: 'retained' | 'generated' | 'pending_original' }[] }[]
  blockers: { targetId: string; classification: string }[]
}
export type StopReason = 'completed' | 'attempt_limit' | 'state_limit' | 'cycle_detected' | 'no_progress' | 'time_budget' | 'cancelled' |
  'search_error' | 'materialization_blocked' | 'projection_failed' | 'checkpoint_blocked' | 'retained_prefix_invalid' | 'unavailable' | 'planner_incomplete' | 'attempt_error' | 'memory_limit' | 'process_error'
export interface AttemptSummary {
  attemptId: number
  strategy: string
  reason: string
  state: DiscoveryState
  signature: string
  signals: RetrySignals
  report: GlobalResearchReport
  stop: StopReason | null
}
export const discoverySignature = (state: DiscoveryState): string => JSON.stringify({
  retainedEntryIds: [...state.retainedEntryIds].sort(), pendingTargetIds: state.pendingTargetIds,
  extent: { maxNormalAdvance: state.extent.maxNormalAdvance, maxGogmaAdvance: state.extent.maxGogmaAdvance, maxSkillAdvance: state.extent.maxSkillAdvance },
})
export function stableResearchEntries(input: PlannerInput): BuildListEntry[] {
  const targets = new Map(input.targetWeapons.map(t => [t.id, t]))
  return [...input.buildListEntries].sort((a, b) => comparePlannerEntryPriority(a, b, targets, input.buildListEntries))
}
const unique = (ids: readonly string[]) => [...new Set(ids)]

/** Only typed IDs/reasons are authority; human-readable reason/detail are never read. */
export function collectRetrySignals(input: PlannerInput, report: GlobalResearchReport, result: PlannerResult | null, generated: readonly BuildListEntry[]): RetrySignals {
  const replaced = new Map(generated.map(e => [e.targetWeaponId, e]))
  const entries = new Map(input.buildListEntries.map(e => { const current = replaced.get(e.targetWeaponId) ?? e; return [current.id as string, current] }))
  const retained = new Set(report.retainedOriginalEntryIds), generatedIds = new Set(generated.map(e => e.id as string))
  const resolve = (id: string) => { const entry = entries.get(id); if (!entry) throw new Error(`Unknown typed conflict/rejection participant: ${id}`); return entry }
  const conflicts = (result?.conflicts ?? []).filter(c => c.selectedBuildListEntryId === null).map(c => ({ id: c.id, kind: c.kind,
    participants: c.buildListEntryIds.map(id => ({ entryId: id as string, targetId: resolve(id).targetWeaponId as string,
      role: retained.has(id) ? 'retained' as const : generatedIds.has(id) ? 'generated' as const : 'pending_original' as const })),
  }))
  return { notFound: report.searches.filter(s => s.status === 'not_found_within_extent').map(s => s.targetId),
    resourceRejected: unique((result?.plan?.rejectedBuildListEntries ?? []).filter(e => e.reason === 'resource_conflict').map(e => resolve(e.buildListEntryId).targetWeaponId)),
    conflictTargets: unique(conflicts.flatMap(c => c.participants.map(p => p.targetId))), conflicts,
    blockers: report.searches.filter(s => s.status !== 'found' && s.status !== 'not_found_within_extent').map(s => ({ targetId: s.targetId, classification: s.status })),
  }
}
export function classifyAttempt(report: GlobalResearchReport, signals: RetrySignals): StopReason | null {
  if (report.status === 'time_budget_reached') return 'time_budget'
  if (report.status === 'cancelled') return 'cancelled'
  if (report.status === 'blocked' && report.stage === 'retained_prefix') return 'retained_prefix_invalid'
  const blocker = signals.blockers[0]?.classification
  if (blocker) return blocker === 'time_budget_reached' ? 'time_budget' :
    ['search_error', 'materialization_blocked', 'projection_failed', 'checkpoint_blocked', 'cancelled', 'unavailable'].includes(blocker) ? blocker as StopReason : 'attempt_error'
  if (report.status === 'error') return 'attempt_error'
  if (report.final?.status === 'incomplete') return 'planner_incomplete'
  if (report.status === 'completed' && report.final?.completedTargetCount === report.planningTargetCount &&
    report.final.conflicts === 0 && report.final.rejected === 0 && report.final.traceReplay === 'passed') return 'completed'
  return null
}

/** Stable partition only. No timing, cache statistics, random numbers or game-specific IDs. */
export function orderingVariants(baseline: readonly string[], history: readonly RetrySignals[]) {
  const latest = history.at(-1)
  if (!latest) return []
  const unresolved = (s: RetrySignals) => unique([...s.notFound, ...s.resourceRejected])
  const current = unresolved(latest), accumulated = unique(history.flatMap(unresolved))
  const partition = (ids: readonly string[]) => [...baseline.filter(id => ids.includes(id)), ...baseline.filter(id => !ids.includes(id))]
  const explicit = (ids: readonly string[]) => [...unique(ids).filter(id => baseline.includes(id)), ...baseline.filter(id => !ids.includes(id))]
  return [
    { reason: 'latest unresolved first; baseline within groups', order: partition(current) },
    { reason: 'accumulated unresolved first; baseline within groups', order: partition(accumulated) },
    { reason: 'newest unresolved history first; baseline remainder', order: explicit([...history].reverse().flatMap(unresolved)) },
    { reason: 'all direct unresolved-conflict participants first; baseline within groups', order: partition(unique([...current, ...latest.conflictTargets])) },
    { reason: 'oldest unresolved observation first; baseline remainder', order: explicit(accumulated) },
  ]
}

export function retainedReleaseCandidates(signals: RetrySignals, retained: readonly string[], priorityEntries: readonly { id: string }[]): string[] {
  const unresolved = new Set([...signals.notFound, ...signals.resourceRejected])
  const candidates = new Set(signals.conflicts.filter(c => c.participants.some(p => unresolved.has(p.targetId)))
    .flatMap(c => c.participants.filter(p => p.role === 'retained' && retained.includes(p.entryId)).map(p => p.entryId)))
  return priorityEntries.filter(e => candidates.has(e.id)).map(e => e.id)
}
export function compareResearchAttempts(a: AttemptSummary, b: AttemptSummary): number {
  const af = a.report.final, bf = b.report.final
  const scores = (x: AttemptSummary, f: typeof af) => [x.stop === 'completed' ? 0 : 1, f?.resourceConflictRejected ?? Infinity,
    f?.conflicts ?? Infinity, -(f?.completedTargetCount ?? 0), -x.state.retainedEntryIds.length, f?.steps ?? Infinity]
  const aa = scores(a, af), bb = scores(b, bf)
  for (let i = 0; i < aa.length; i++) if (aa[i] !== bb[i]) return aa[i] < bb[i] ? -1 : 1
  return a.signature < b.signature ? -1 : a.signature > b.signature ? 1 : 0
}

export interface RetryBounds { orderingAttempts: number; maxStates: number; releaseDepth: number }
export const PHASE1C_BOUNDS: RetryBounds = { orderingAttempts: 6, maxStates: 12, releaseDepth: 2 }
/** execute receives only a state. A runner reloads the ORIGINAL Export in a fresh process. */
export async function runDiscoveryRetries(first: AttemptSummary, priorityEntries: readonly { id: string; targetWeaponId: string }[],
  execute: (state: DiscoveryState, strategy: string, reason: string, attemptId: number) => Promise<AttemptSummary>,
  bounds: RetryBounds = PHASE1C_BOUNDS, shouldStop: () => 'cancelled' | 'time_budget' | null = () => null) {
  if (!Number.isSafeInteger(bounds.orderingAttempts) || bounds.orderingAttempts < 1 || bounds.orderingAttempts > 6 ||
    !Number.isSafeInteger(bounds.maxStates) || bounds.maxStates < 1 || bounds.maxStates > 12 ||
    !Number.isSafeInteger(bounds.releaseDepth) || bounds.releaseDepth < 0 || bounds.releaseDepth > 2) throw new Error('Invalid Research bounds')
  const attempts = [first], seen = new Set([first.signature]), initialRetained = first.state.retainedEntryIds
  const stageStops: { strategy: string; reason: StopReason }[] = []
  let cycleCount = 0
  const pending = (retained: readonly string[]) => priorityEntries.filter(e => !retained.includes(e.id)).map(e => e.targetWeaponId)
  const run = async (state: DiscoveryState, strategy: string, reason: string): Promise<AttemptSummary> => {
    const signature = discoverySignature(state)
    if (seen.has(signature)) throw new Error('Duplicate discovery state')
    seen.add(signature)
    const attempt = await execute(structuredClone(state), strategy, reason, attempts.length)
    if (attempt.signature !== signature) throw new Error('Executor changed discovery state')
    attempts.push(attempt)
    return attempt
  }
  const finish = (stopReason: StopReason) => ({ stopReason, stageStops, cycleCount, attempts,
    bestAttemptId: [...attempts].sort(compareResearchAttempts)[0].attemptId })
  if (first.stop) return finish(first.stop)
  for (let i = 1; i < bounds.orderingAttempts; i++) {
    const stop = shouldStop(); if (stop) return finish(stop)
    if (attempts.length >= bounds.maxStates) return finish('state_limit')
    const variants = orderingVariants(pending(initialRetained), attempts.map(a => a.signals))
    const next = variants.map(v => ({ ...v, state: { ...first.state, pendingTargetIds: v.order } }))
      .find(v => { if (seen.has(discoverySignature(v.state))) { cycleCount++; return false }; return true })
    if (!next) { stageStops.push({ strategy: 'fixed_retained', reason: cycleCount ? 'cycle_detected' : 'no_progress' }); break }
    const result = await run(next.state, 'fixed_retained', next.reason)
    if (result.stop) return finish(result.stop)
  }
  if (!stageStops.length) stageStops.push({ strategy: 'fixed_retained', reason: 'attempt_limit' })
  if (attempts.length >= bounds.maxStates) return finish('state_limit')
  const stop = shouldStop(); if (stop) return finish(stop)
  const controlState = { ...first.state, retainedEntryIds: [], pendingTargetIds: pending([]) }
  if (!seen.has(discoverySignature(controlState))) {
    const control = await run(controlState, 'retain_none', 'control: ordinary stable Planner priority')
    // A successful control still leaves the bounded release experiment useful.
    // This independent control supplies no release evidence. A process resource
    // failure must be recorded, but cannot erase earlier typed conflict evidence.
    if (control.stop === 'memory_limit') stageStops.push({ strategy: 'retain_none', reason: control.stop })
    else if (control.stop && control.stop !== 'completed') return finish(control.stop)
  }
  while (attempts.length < bounds.maxStates) {
    const stop = shouldStop(); if (stop) return finish(stop)
    const parents = attempts.filter(a => a.strategy !== 'retain_none' && !a.stop &&
      initialRetained.length - a.state.retainedEntryIds.length < bounds.releaseDepth).sort(compareResearchAttempts)
    let next: { state: DiscoveryState; reason: string } | null = null
    for (const parent of parents) {
      for (const id of retainedReleaseCandidates(parent.signals, parent.state.retainedEntryIds, priorityEntries)) {
        const retainedEntryIds = parent.state.retainedEntryIds.filter(e => e !== id)
        const base = pending(retainedEntryIds)
        const order = orderingVariants(base, [parent.signals])[0]?.order ?? base
        const state = { ...first.state, retainedEntryIds, pendingTargetIds: order }
        if (seen.has(discoverySignature(state))) { cycleCount++; continue }
        next = { state, reason: `release ${id}; direct conflict with unresolved Target in attempt ${parent.attemptId}; latest unresolved first` }; break
      }
      if (next) break
    }
    if (!next) return finish(attempts.some(a => a.stop === 'completed') ? 'completed' : cycleCount ? 'cycle_detected' : 'no_progress')
    const result = await run(next.state, 'conflict_release', next.reason)
    if (result.stop === 'retained_prefix_invalid') continue
    if (result.stop) return finish(result.stop)
  }
  return finish(attempts.some(a => a.stop === 'completed') ? 'completed' : 'state_limit')
}
