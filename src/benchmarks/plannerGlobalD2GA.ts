/**
 * Issue #154 D2-G-A (Research only, non-formal diagnosis): why the D2-F-B K3 Search ran out of memory
 * (`docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2GA.md`).
 *
 * One diagnostic unit re-runs the unchanged Production Planner Alternative Search of one already measured D2-E (K2) or D2-F (K3)
 * discovery unit - the same Export, Production RNG Engine, Planner-start origin, reservation (re-derived by the same authority,
 * `phase2c27bResolveSupportContext()`, and checked against the formal task's context record), extent and excluded Route keys - with
 * the existing read-only Search instrumentation attached:
 *
 * - `createPlannerAlternativeSearchObserver()` (settled work, held-aware Skill / Gogma depth aggregates),
 * - `createPhase2C26A4RuntimeTracker()` (section counts and inclusive / exclusive time, depth work counts),
 * - `createCountingRngEngine()` (prediction calls, each forwarded once with its own result),
 * - and a small per-stream / per-channel aggregator added here (live Gogma frontier per stream, retained Skill states per stream,
 *   retained Ideal solutions and subscribers per channel).
 *
 * Nothing here changes a Search input, ordering, extent, reservation, termination or delivery: the visitor only records the delivered
 * key and returns `continue`, except that a delivery the formal unit never had stops the diagnosis as a parity mismatch (the formal
 * L0 / L1 units of both contexts delivered nothing). Every observer keeps aggregates only (no state, Route body or event list). No GC
 * is forced. The diagnosis is non-formal: it never feeds a formal RESULT, and the formal D2-E / D2-F records stay the reference.
 *
 * It imports no D2-C / D2-D / D2-E / D2-F module (their tests pin the importers), no Phase 2-C2.5 module and no oracle.
 */
import { hashStableValue, stableStringify } from '../domain/models/hashing'
import type { PlannerDependencies, PlannerInput } from '../domain/planner/plannerTypes'
import {
  candidateStableKey,
  visitPlannerAlternativeCandidates,
  type PlannerAlternativeCandidate,
  type PlannerAlternativeSearchExtent,
  type PlannerAlternativeSearchInstrumentation,
} from '../domain/search'
import type { ReservedGogmaDepthObservation } from '../domain/search/bonusStream'
import { createCounterReservation, nextOperationPositions } from '../domain/search/counterReservation'
import type { SearchRuntimeObserver } from '../domain/search/searchRuntime'
import type { ReservedSkillDepthObservation } from '../domain/search/skillStream'
import { createCountingRngEngine, createPlannerAlternativeSearchObserver } from './plannerAlternativeBenchmarkInstrumentation'
import type { PlannerAlternativePredictionCounts } from './plannerAlternativeBenchmarkProtocol'
import { D2_LADDER, D2_RESEARCH_MAX_PLAN_STEPS } from './plannerGlobalD2'
import { createPhase2C26A4RuntimeTracker, type Phase2C26A4WorkSummaryRecord } from './plannerGlobalPhase2C26A4'
import { phase2c27bResolveSupportContext, type Phase2C27BRungId } from './plannerGlobalPhase2C27B'

export const D2GA_PHASE = 'Issue #154 D2-G-A: K3 Search memory diagnosis (non-formal)'
export const D2GA_DOC = 'docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2GA.md'
/** The main the diagnosis branches from (PR #234 merged). */
export const D2GA_BASE_MAIN = 'e292915b30833518fe72fc98378a609a27b87702'
export const D2GA_EXPORT_SHA256 = 'cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b'
export const D2GA_RESEARCH_MAX_PLAN_STEPS = D2_RESEARCH_MAX_PLAN_STEPS

export type D2GAContextId = 'K2' | 'K3'
export interface D2GAUnitSpec { id: string; context: D2GAContextId; rung: Phase2C27BRungId }

/**
 * The comparison protocol, fixed before any diagnostic child ran (D2-G-A §3). Four fresh children in this order, concurrency 1,
 * no retry, no fallback. K3 L2 is never re-run.
 */
export const D2GA_PROTOCOL = Object.freeze({
  units: Object.freeze([
    Object.freeze({ id: 'K2-L0', context: 'K2' as const, rung: 'L0' as const }),
    Object.freeze({ id: 'K3-L0', context: 'K3' as const, rung: 'L0' as const }),
    Object.freeze({ id: 'K2-L1', context: 'K2' as const, rung: 'L1' as const }),
    Object.freeze({ id: 'K3-L1', context: 'K3' as const, rung: 'L1' as const }),
  ]) as readonly D2GAUnitSpec[],
  childHeapMb: 12_288,
  childWallMs: 15 * 60_000,
  totalWallMs: 90 * 60_000,
  concurrency: 1,
  retry: 'none',
  fallback: 'none',
  /** `process.memoryUsage()` every 250 ms (the formal D2-E / D2-F interval); every 4th sample (1 s) is kept in the time series. */
  memorySampleIntervalMs: 250,
  keepEverySample: 4,
  /** At most this many kept samples per child; beyond it every other kept sample is dropped (the series stays thinned, never grows). */
  maxKeptSamples: 1_200,
  /** At most this many major GC observations are kept individually; the rest are counted. */
  maxMajorGcEntries: 2_000,
  nodeYield: 'setImmediate',
  forcedGc: false,
})

/** The formal run directories and tasks the diagnosis reads (read-only; never written). */
export const D2GA_FORMAL_SOURCES = Object.freeze({
  K2: Object.freeze({ runDir: '.local/d2e-k2-formal2.run', task: (rung: Phase2C27BRungId) => `DSC-K2-${rung}.task.json`, record: (rung: Phase2C27BRungId) => `DSC-K2-${rung}.record.json`,
    memory: (rung: Phase2C27BRungId) => `DSC-K2-${rung}.memory.jsonl`, reservationDigest: 'fnv1a32:fd85c864', resultFile: 'docs/PLANNER_GLOBAL_D2E_RESULT.json' }),
  K3: Object.freeze({ runDir: '.local/d2f-k3-formal.run', task: (rung: Phase2C27BRungId) => `DSC-K3-${rung}.task.json`, record: (rung: Phase2C27BRungId) => `DSC-K3-${rung}.record.json`,
    memory: (rung: Phase2C27BRungId) => `DSC-K3-${rung}.memory.jsonl`, reservationDigest: 'fnv1a32:6e2a0744', resultFile: 'docs/PLANNER_GLOBAL_D2F_RESULT.json' }),
})
export const D2GA_ORIGIN_DIGEST = 'fnv1a32:ff018910'

/** The formal reference values (D2-E-B / D2-F-B RESULT); read-only comparison values, never overwritten by the diagnosis. */
export const D2GA_FORMAL_REFERENCE = Object.freeze({
  'K2-L0': { childWallS: 42.5, heapPeakGb: 1.38, outcome: 'stopped_by_search_extent_bound', delivered: 0 },
  'K2-L1': { childWallS: 63.0, heapPeakGb: 1.95, outcome: 'stopped_by_search_extent_bound', delivered: 0 },
  'K2-L2': { childWallS: 671.2, heapPeakGb: 6.0, outcome: 'discovery_cap_reached', delivered: 2 },
  'K3-L0': { childWallS: 149.8, heapPeakGb: 4.0, outcome: 'stopped_by_search_extent_bound', delivered: 0 },
  'K3-L1': { childWallS: 246.1, heapPeakGb: 7.4, outcome: 'stopped_by_search_extent_bound', delivered: 0 },
  'K3-L2': { childWallS: 2662.0, heapPeakGb: 10.4, outcome: 'out_of_memory', delivered: null },
})

export const d2gaRungExtent = (rung: Phase2C27BRungId): PlannerAlternativeSearchExtent => ({ ...D2_LADDER.find(r => r.id === rung)!.extent })

/** The formal discovery task fields the diagnosis reads (both the D2-E and the D2-F task carry them). */
export interface D2GAFormalTask {
  unitId: string
  contextId: string
  targetWeaponId: string
  supportBuildListEntryIds: string[]
  currentBuildListEntryId: string
  rung: Phase2C27BRungId
  extent: PlannerAlternativeSearchExtent
  context: { reservationBody: unknown; reservationDigest: string; originDigest: string; excludedRouteKeys: string[] }
  researchMaxPlanSteps: number
}

/** Projects the read fields of a formal task wrapper (`{ task, poolDir }`); anything missing or mistyped is an issue, never a default. */
export function readD2GAFormalTask(json: unknown): { task: D2GAFormalTask | null; issues: string[] } {
  const issues: string[] = []
  const wrapper = json as { task?: Record<string, unknown> } | null
  const t = wrapper?.task
  if (typeof t !== 'object' || t === null) return { task: null, issues: ['the task wrapper has no task object'] }
  const str = (k: string) => { if (typeof t[k] !== 'string') issues.push(`task.${k} is not a string`); return t[k] as string }
  const context = t.context as Record<string, unknown> | undefined
  if (typeof context !== 'object' || context === null) issues.push('task.context is not an object')
  const extent = t.extent as Record<string, unknown> | undefined
  if (typeof extent !== 'object' || extent === null || !['maxNormalAdvance', 'maxGogmaAdvance', 'maxSkillAdvance'].every(k => Number.isInteger(extent[k]))) issues.push('task.extent is not an extent')
  if (!Array.isArray(t.supportBuildListEntryIds) || !t.supportBuildListEntryIds.every(x => typeof x === 'string')) issues.push('task.supportBuildListEntryIds')
  if (context && (typeof context.reservationDigest !== 'string' || typeof context.originDigest !== 'string' || !Array.isArray(context.excludedRouteKeys)
    || typeof context.reservationBody !== 'object' || context.reservationBody === null)) issues.push('task.context fields')
  const task = { unitId: str('unitId'), contextId: str('contextId'), targetWeaponId: str('targetWeaponId'), currentBuildListEntryId: str('currentBuildListEntryId'),
    rung: str('rung') as Phase2C27BRungId, supportBuildListEntryIds: t.supportBuildListEntryIds as string[], extent: extent as unknown as PlannerAlternativeSearchExtent,
    context: context as unknown as D2GAFormalTask['context'], researchMaxPlanSteps: t.researchMaxPlanSteps as number }
  if (!['L0', 'L1', 'L2'].includes(task.rung)) issues.push('task.rung')
  if (task.researchMaxPlanSteps !== D2GA_RESEARCH_MAX_PLAN_STEPS) issues.push('task.researchMaxPlanSteps is not the Research 20000')
  return { task: issues.length === 0 ? task : null, issues }
}

/** Checks a formal task against the diagnosis unit: the registered context digest, origin digest and rung extent. */
export function checkD2GAFormalTask(unit: D2GAUnitSpec, task: D2GAFormalTask): string[] {
  const issues: string[] = []
  const source = D2GA_FORMAL_SOURCES[unit.context]
  if (task.rung !== unit.rung) issues.push(`rung ${task.rung} is not ${unit.rung}`)
  if (stableStringify(task.extent) !== stableStringify(d2gaRungExtent(unit.rung))) issues.push('the task extent is not the registered rung extent')
  if (task.context.reservationDigest !== source.reservationDigest) issues.push(`reservation digest ${task.context.reservationDigest} is not ${source.reservationDigest}`)
  if (hashStableValue(task.context.reservationBody) !== task.context.reservationDigest) issues.push('the reservation body does not hash to its digest')
  if (task.context.originDigest !== D2GA_ORIGIN_DIGEST) issues.push('the origin digest is not the registered origin')
  if (task.supportBuildListEntryIds.length !== (unit.context === 'K2' ? 2 : 3)) issues.push('the support count is not the context size')
  return issues
}

// ---------------------------------------------------------------- static structure (read-only use of Production primitives)

export interface D2GAReservationShape {
  stream: 'skill' | 'gogma' | 'normal'
  counterId: string | null
  held: number
  blocked: number
  /** Contiguous held runs as `[from, to]` (inclusive). */
  heldRuns: [number, number][]
}

const runsOf = (values: readonly number[]): [number, number][] => {
  const runs: [number, number][] = []
  for (const v of [...values].sort((a, b) => a - b)) {
    const last = runs.at(-1)
    if (last && last[1] === v - 1) last[1] = v
    else runs.push([v, v])
  }
  return runs
}

/** The held / blocked shape of one reservation body (counts and runs only). */
export function d2gaReservationShape(body: unknown): D2GAReservationShape[] {
  const r = body as { skill: { held: number[]; blocked: number[] }; gogma: { held: number[]; blocked: number[] }; normal: { counterId: string; held: number[]; blocked: number[] }[] }
  return [
    { stream: 'skill', counterId: null, held: r.skill.held.length, blocked: r.skill.blocked.length, heldRuns: runsOf(r.skill.held) },
    { stream: 'gogma', counterId: null, held: r.gogma.held.length, blocked: r.gogma.blocked.length, heldRuns: runsOf(r.gogma.held) },
    ...r.normal.map(n => ({ stream: 'normal' as const, counterId: n.counterId, held: n.held.length, blocked: n.blocked.length, heldRuns: runsOf(n.held) })),
  ]
}

/**
 * The legal conversion Skill positions a Planner Alternative Route may convert at (the Production `conversionSkillPositions()` rule:
 * `nextOperationPositions()` from the origin Skill Counter up to `origin + maxSkillAdvance + 1`). Every conversion position is a separate
 * Route base and a separate Skill stream start, so this count multiplies the conversion Route bases. Computed with the Production
 * primitive itself; it predicts nothing.
 */
export async function d2gaConversionSkillPositions(body: unknown, originSkillCounter: number, maxSkillAdvance: number): Promise<{ positions: number[]; beyondLimit: boolean }> {
  const r = body as { skill: { held: number[]; blocked: number[] } }
  return nextOperationPositions(createCounterReservation(r.skill.held, r.skill.blocked), originSkillCounter, originSkillCounter + maxSkillAdvance + 1, async () => {})
}

// ---------------------------------------------------------------- the diagnostic observer

export interface D2GAChannelStats { works: number; lastRetained: number; maxSubscribers: number; rawSolutions: number; idealSolutions: number }

export interface D2GAProbe {
  settledWork: number
  predictions: PlannerAlternativePredictionCounts
  skill: { streams: number; depthReads: number; retainedStates: number; transitions: number; maxStatesPerDepth: number; maxDepth: number }
  gogma: { streams: number; depthReads: number; generatedStates: number; liveFrontierStates: number; maxFrontierPerStream: number; maxGeneratedPerDepth: number; maxDepth: number }
  sections: { compositionWork: number; crossWakeWork: number; bonusDepthWork: number; skillDepthWork: number; schedulerSteps: number; deliveryFlush: number }
  channels: { bonus: number; skill: number; retainedIdealBonus: number; retainedIdealSkill: number; bonusSubscriptions: number; skillSubscriptions: number }
}

export interface D2GADiagnosticObserver {
  readonly instrumentation: PlannerAlternativeSearchInstrumentation
  readonly countingEngine: ReturnType<typeof createCountingRngEngine>
  /** A cheap aggregate read (no per-state scan); safe to call from a 1 s timer. */
  probe(): D2GAProbe
  /** The full aggregates at the end (per-depth tables, section times, per-channel stats). */
  final(): D2GAFinalObservation
}

export interface D2GAFinalObservation {
  probe: D2GAProbe
  skillDepths: ReturnType<ReturnType<typeof createPlannerAlternativeSearchObserver>['skill']>
  gogmaDepths: ReturnType<ReturnType<typeof createPlannerAlternativeSearchObserver>['gogma']>
  skillStreams: { streamIndex: number; startSkillCounter: number; depths: number; retainedStates: number; maxStates: number }[]
  gogmaStreams: { streamIndex: number; startGogmaCounter: number; depths: number; generatedStates: number; lastFrontierStates: number; maxFrontierStates: number; maxFamilyLayouts: number }[]
  channels: { key: string; stats: D2GAChannelStats }[]
  runtime: ReturnType<ReturnType<typeof createPhase2C26A4RuntimeTracker>['snapshot']>
}

/**
 * The composed read-only observer. `now` stamps the section boundaries (the A4 tracker); the Search never reads it. Every callback
 * only adds numbers to a fixed-size or per-stream / per-channel record.
 */
export function createD2GADiagnosticObserver(engine: PlannerDependencies['rngEngine'], now: () => number = () => performance.now()): D2GADiagnosticObserver {
  const base = createPlannerAlternativeSearchObserver()
  const countingEngine = createCountingRngEngine(engine)
  const origin = now()
  const channels = new Map<string, D2GAChannelStats>()
  const onWorkSummary = (record: Phase2C26A4WorkSummaryRecord) => {
    const key = `${record.section === 'bonus_depth_work' ? 'bonus' : 'skill'}:${record.work?.channel ?? -1}`
    let c = channels.get(key)
    if (!c) { c = { works: 0, lastRetained: 0, maxSubscribers: 0, rawSolutions: 0, idealSolutions: 0 }; channels.set(key, c) }
    c.works += 1
    if (record.counts) {
      c.lastRetained = record.counts.retainedCountAfter
      c.maxSubscribers = Math.max(c.maxSubscribers, record.counts.subscriberCount)
      c.rawSolutions += record.counts.rawSolutions
      c.idealSolutions += record.counts.idealSolutions
    }
  }
  const tracker = createPhase2C26A4RuntimeTracker({ now, origin: () => origin, emitSectionStarted: () => {}, emitWorkSummary: onWorkSummary, emitSearchSummary: () => {} })
  const runtime: SearchRuntimeObserver = tracker.observerForTarget(0)
  // Counters the section snapshot would otherwise need a full table clone for.
  const sectionCounts = { compositionWork: 0, crossWakeWork: 0, bonusDepthWork: 0, skillDepthWork: 0, schedulerSteps: 0, deliveryFlush: 0 }
  const onSearchRuntime: SearchRuntimeObserver = (event) => {
    runtime(event)
    if (event.type !== 'section_completed') return
    switch (event.section) {
      case 'composition_work': sectionCounts.compositionWork += 1; break
      case 'cross_wake_work': sectionCounts.crossWakeWork += 1; break
      case 'bonus_depth_work': sectionCounts.bonusDepthWork += 1; break
      case 'skill_depth_work': sectionCounts.skillDepthWork += 1; break
      case 'scheduler_step': sectionCounts.schedulerSteps += 1; break
      case 'delivery_flush': sectionCounts.deliveryFlush += 1; break
      default: break
    }
  }
  const skillStreams = new Map<number, { startSkillCounter: number; depths: number; retainedStates: number; maxStates: number }>()
  const gogmaStreams = new Map<number, { startGogmaCounter: number; depths: number; generatedStates: number; lastFrontierStates: number; maxFrontierStates: number; maxFamilyLayouts: number }>()
  const skillTotals = { depthReads: 0, retainedStates: 0, transitions: 0, maxStatesPerDepth: 0, maxDepth: 0 }
  const gogmaTotals = { depthReads: 0, generatedStates: 0, liveFrontierStates: 0, maxFrontierPerStream: 0, maxGeneratedPerDepth: 0, maxDepth: 0 }
  const onSkill = (event: ReservedSkillDepthObservation) => {
    base.instrumentation.onSkillReservedDepth?.(event)
    let s = skillStreams.get(event.streamIndex)
    if (!s) { s = { startSkillCounter: event.startSkillCounter, depths: 0, retainedStates: 0, maxStates: 0 }; skillStreams.set(event.streamIndex, s) }
    s.depths += 1
    // `createTargetSkillStream()` keeps every depth's states (`set.depths`), so the retained count is the cumulative one.
    s.retainedStates += event.states
    s.maxStates = Math.max(s.maxStates, event.states)
    skillTotals.depthReads += 1
    skillTotals.retainedStates += event.states
    skillTotals.transitions += event.transitions
    skillTotals.maxStatesPerDepth = Math.max(skillTotals.maxStatesPerDepth, event.states)
    skillTotals.maxDepth = Math.max(skillTotals.maxDepth, event.depth)
  }
  const onGogma = (event: ReservedGogmaDepthObservation) => {
    base.instrumentation.onGogmaReservedDepth?.(event)
    let g = gogmaStreams.get(event.streamIndex)
    if (!g) { g = { startGogmaCounter: event.startGogmaCounter, depths: 0, generatedStates: 0, lastFrontierStates: 0, maxFrontierStates: 0, maxFamilyLayouts: 0 }; gogmaStreams.set(event.streamIndex, g) }
    // The held-aware Bonus stream keeps only its reduced frontier (single-pass), so the live count is the last one per stream.
    gogmaTotals.liveFrontierStates += event.frontierStates - g.lastFrontierStates
    g.depths += 1
    g.generatedStates += event.generatedStates
    g.lastFrontierStates = event.frontierStates
    g.maxFrontierStates = Math.max(g.maxFrontierStates, event.frontierStates)
    g.maxFamilyLayouts = Math.max(g.maxFamilyLayouts, event.familyLayouts)
    gogmaTotals.depthReads += 1
    gogmaTotals.generatedStates += event.generatedStates
    gogmaTotals.maxFrontierPerStream = Math.max(gogmaTotals.maxFrontierPerStream, event.frontierStates)
    gogmaTotals.maxGeneratedPerDepth = Math.max(gogmaTotals.maxGeneratedPerDepth, event.generatedStates)
    gogmaTotals.maxDepth = Math.max(gogmaTotals.maxDepth, event.depth)
  }
  const channelTotals = () => {
    const out = { bonus: 0, skill: 0, retainedIdealBonus: 0, retainedIdealSkill: 0, bonusSubscriptions: 0, skillSubscriptions: 0 }
    for (const [key, c] of channels) {
      if (key.startsWith('bonus:')) { out.bonus += 1; out.retainedIdealBonus += c.lastRetained; out.bonusSubscriptions += c.maxSubscribers }
      else { out.skill += 1; out.retainedIdealSkill += c.lastRetained; out.skillSubscriptions += c.maxSubscribers }
    }
    return out
  }
  const probe = (): D2GAProbe => ({
    settledWork: base.settledWorkItems(),
    predictions: countingEngine.counts(),
    skill: { streams: skillStreams.size, ...skillTotals },
    gogma: { streams: gogmaStreams.size, ...gogmaTotals },
    sections: { ...sectionCounts },
    channels: channelTotals(),
  })
  return {
    instrumentation: {
      onWorkSettled: base.instrumentation.onWorkSettled,
      onSkillReservedDepth: onSkill,
      onGogmaReservedDepth: onGogma,
      onSearchRuntime,
    },
    countingEngine,
    probe,
    final: () => ({
      probe: probe(),
      skillDepths: base.skill(),
      gogmaDepths: base.gogma(),
      skillStreams: [...skillStreams.entries()].sort(([a], [b]) => a - b).map(([streamIndex, s]) => ({ streamIndex, ...s })),
      gogmaStreams: [...gogmaStreams.entries()].sort(([a], [b]) => a - b).map(([streamIndex, g]) => ({ streamIndex, ...g })),
      channels: [...channels.entries()].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([key, stats]) => ({ key, stats: { ...stats } })),
      runtime: tracker.snapshot(),
    }),
  }
}

// ---------------------------------------------------------------- one diagnostic unit

export type D2GAUnitStatus = 'completed' | 'context_drift' | 'parity_mismatch'

export interface D2GAUnitResult {
  status: D2GAUnitStatus
  issues: string[]
  unit: D2GAUnitSpec
  observedContext: { reservationDigest: string; originDigest: string; excludedRouteKeys: number; supportBuildListEntryIds: string[] } | null
  structure: { reservation: D2GAReservationShape[]; conversionSkillPositions: number; conversionBeyondLimit: boolean; originSkillCounter: number | null; originGogmaCounter: number | null } | null
  search: { deliveredCandidates: number; excludedCandidates: number; exhausted: boolean; stoppedByExtent: boolean; stoppedByConsumer: boolean } | null
  /** SHA-256 (caller-supplied) of each delivered `candidateStableKey`, in order. */
  deliveredKeySha256s: string[]
  timing: { searchVisitMs: number } | null
  observation: D2GAFinalObservation | null
}

/**
 * Runs one diagnostic unit. The context is re-derived with the formal authority and compared with the formal task's context record
 * (reservation body / digest, origin digest, excluded Route keys, current Entry, supports); any difference stops before the Search.
 */
export async function runD2GADiagnosticUnit(input: PlannerInput, unit: D2GAUnitSpec, task: D2GAFormalTask, dependencies: PlannerDependencies,
  observer: D2GADiagnosticObserver, options: { sha256OfText: (text: string) => string; yieldControl?: () => Promise<void>; now?: () => number }): Promise<D2GAUnitResult> {
  const now = options.now ?? (() => performance.now())
  const empty = { observedContext: null, structure: null, search: null, deliveredKeySha256s: [], timing: null, observation: null }
  const pre = [...checkD2GAFormalTask(unit, task)]
  if (input.conflictResolutions.length !== 0) pre.push('the baseline PlannerInput carries a conflict resolution')
  if (input.options.maxPlanSteps !== D2GA_RESEARCH_MAX_PLAN_STEPS) pre.push('the Research maxPlanSteps is not 20000')
  if (pre.length > 0) return { status: 'context_drift', issues: pre, unit, ...empty }
  const resolved = phase2c27bResolveSupportContext(input, dependencies, task.targetWeaponId, task.supportBuildListEntryIds)
  if (resolved.status !== 'ready') return { status: 'context_drift', issues: ['the context is not ready', ...resolved.issues], unit, ...empty }
  const prepared = resolved.prepared
  const drift: string[] = []
  if (stableStringify(prepared.reservation) !== stableStringify(task.context.reservationBody)) drift.push('the reservation body differs from the formal context record')
  if (hashStableValue(prepared.reservation) !== task.context.reservationDigest) drift.push('the reservation digest differs from the formal context record')
  if (hashStableValue(prepared.origin) !== task.context.originDigest) drift.push('the origin digest differs from the formal context record')
  if (stableStringify(prepared.excludedRouteKeys) !== stableStringify(task.context.excludedRouteKeys)) drift.push('excludedRouteKeys differ from the formal context record')
  if (prepared.invalidated.id !== task.currentBuildListEntryId) drift.push('O_t differs from the formal task')
  if (stableStringify(prepared.supportBuildListEntryIds) !== stableStringify(task.supportBuildListEntryIds)) drift.push('the support set differs from the formal task')
  const observedContext = { reservationDigest: hashStableValue(prepared.reservation), originDigest: hashStableValue(prepared.origin), excludedRouteKeys: prepared.excludedRouteKeys.length,
    supportBuildListEntryIds: [...prepared.supportBuildListEntryIds] }
  if (drift.length > 0) return { status: 'context_drift', issues: drift, unit, ...empty, observedContext }

  const originSkillCounter = prepared.origin.rngState.skillCounter.value
  const conversions = originSkillCounter === null ? { positions: [], beyondLimit: false } : await d2gaConversionSkillPositions(prepared.reservation, originSkillCounter, task.extent.maxSkillAdvance)
  const structure = { reservation: d2gaReservationShape(prepared.reservation), conversionSkillPositions: conversions.positions.length, conversionBeyondLimit: conversions.beyondLimit,
    originSkillCounter, originGogmaCounter: prepared.origin.rngState.gogmaCounter.value }

  const searchInput = { origin: prepared.origin, targetWeaponId: task.targetWeaponId as never, extent: { ...task.extent }, reservation: prepared.reservation, excludedRouteKeys: [...prepared.excludedRouteKeys] }
  const deliveredKeySha256s: string[] = []
  const started = now()
  const execution = await visitPlannerAlternativeCandidates(searchInput, observer.countingEngine.engine, async (candidate: PlannerAlternativeCandidate) => {
    deliveredKeySha256s.push(options.sha256OfText(candidateStableKey(candidate)))
    // The formal L0 / L1 units delivered nothing; any delivery is a parity mismatch and ends the diagnosis of this unit.
    return 'stop' as const
  }, { yieldControl: options.yieldControl, instrumentation: observer.instrumentation })
  const searchVisitMs = now() - started
  const search = { ...execution.summary, stoppedByConsumer: execution.stoppedByConsumer }
  const status: D2GAUnitStatus = deliveredKeySha256s.length > 0 ? 'parity_mismatch' : 'completed'
  return { status, issues: status === 'parity_mismatch' ? ['a delivery occurred where the formal unit delivered none'] : [], unit, observedContext, structure, search, deliveredKeySha256s,
    timing: { searchVisitMs }, observation: observer.final() }
}

// ---------------------------------------------------------------- memory series (pure helpers shared by the runner and the analysis)

export interface D2GAMemorySample {
  atMs: number
  heapUsed: number
  heapTotal: number
  rss: number
  external: number
  arrayBuffers: number
  yields: number
  probe: D2GAProbe | null
}

/**
 * A bounded time series: keeps every `keepEvery`-th offered sample, and halves itself (drops every other kept sample) when it reaches
 * `max`, doubling `keepEvery`. So the series stays at most `max` points for any run length and remains evenly thinned.
 */
export function createD2GASeries<T>(keepEvery: number, max: number) {
  let every = keepEvery
  let offered = 0
  let kept: T[] = []
  return {
    offer(sample: () => T): void {
      offered += 1
      if (offered % every !== 0) return
      kept.push(sample())
      if (kept.length >= max) { kept = kept.filter((_, i) => i % 2 === 0); every *= 2 }
    },
    values: (): T[] => [...kept],
    keepEvery: () => every,
  }
}

/** One formal memory.jsonl line of the D2-E / D2-F runners (cumulative maxima, sent every 20th IPC message). */
export interface D2GAFormalMemoryRow { receivedAtMs: number; maxima: { samples: number; maxHeapUsedBytes: number; maxRssBytes: number; lastElapsedMs: number }; yields: number }

export interface D2GAFormalSegment { fromS: number; toS: number; heapMaxFromGb: number; heapMaxToGb: number; rssMaxToGb: number; yieldsPerS: number; heapGrowthGbPerMillionYields: number | null }

/**
 * Reads a formal memory series (read-only) into fixed time segments: the cumulative heap / RSS maxima at both ends, the checkpoint
 * yield rate (one yield per 50 Search checkpoints) and the heap maximum growth per million yields. The maxima are cumulative, so a
 * flat maximum means "no new peak", not "no allocation".
 */
export function d2gaFormalSegments(rows: readonly D2GAFormalMemoryRow[], boundariesS: readonly number[]): D2GAFormalSegment[] {
  if (rows.length === 0) return []
  const at = (s: number) => {
    let best = rows[0]!
    for (const r of rows) { if (r.receivedAtMs / 1000 <= s) best = r; else break }
    return best
  }
  const segments: D2GAFormalSegment[] = []
  const lastS = rows.at(-1)!.receivedAtMs / 1000
  const points = [...boundariesS.filter(s => s < lastS), lastS]
  for (let i = 1; i < points.length; i += 1) {
    const a = at(points[i - 1]!), b = at(points[i]!)
    const dt = (b.receivedAtMs - a.receivedAtMs) / 1000
    const dy = b.yields - a.yields
    const dh = (b.maxima.maxHeapUsedBytes - a.maxima.maxHeapUsedBytes) / 2 ** 30
    segments.push({ fromS: a.receivedAtMs / 1000, toS: b.receivedAtMs / 1000, heapMaxFromGb: a.maxima.maxHeapUsedBytes / 2 ** 30, heapMaxToGb: b.maxima.maxHeapUsedBytes / 2 ** 30,
      rssMaxToGb: b.maxima.maxRssBytes / 2 ** 30, yieldsPerS: dt > 0 ? dy / dt : 0, heapGrowthGbPerMillionYields: dy > 0 ? dh / (dy / 1e6) : null })
  }
  return segments
}
