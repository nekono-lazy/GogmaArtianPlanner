/**
 * Issue #154 Phase 2-C2.5-B: the Browser Worker side of the Search-only reproduction. Research only. Never import from
 * Production.
 *
 * The pre-search context is exactly the Phase 2-C2.5-A one: `derivePhase2C25APreSearchContexts()` (the kernel's own
 * preparation, the Planner reservation authority, `candidateStableKey()` exclusion, the Production default extent),
 * derived here in the Worker from the PlannerInput the page built from the original Export and the orientation this
 * page session's own baseline produced. The Search is the same `visitPlannerAlternativeCandidates()` call with the
 * same input and a consumer stop at the first Candidate. Only the observation differs from the Node child:
 *
 * - memory is Worker-realm `performance.memory` when the Browser exposes it and `null` otherwise (the formal heap
 *   authority is the external CDP driver), so no new memory seam enters the Search;
 * - the first delivered Candidate is announced to the page before the consumer returns `stop`, so a Worker failure can
 *   be placed before or after the first Candidate.
 *
 * This module never reads the Phase 2-C2.5-A evidence, a file or an oracle; Target IDs, Entry IDs and Counter
 * positions all come from the run itself.
 */
import type { PlannerInput } from '../domain/planner/plannerTypes'
import type { RngEngine } from '../domain/rng/rngEngine'
import { candidateStableKey, visitPlannerAlternativeCandidates, type PlannerAlternativeCandidate } from '../domain/search'
import type { ReservedGogmaDepthObservation } from '../domain/search/bonusStream'
import type { ReservedSkillDepthObservation } from '../domain/search/skillStream'
import { createCountingRngEngine, createPlannerAlternativeSearchObserver } from './plannerAlternativeBenchmarkInstrumentation'
import type { PlannerAlternativePredictionCounts } from './plannerAlternativeBenchmarkProtocol'
import { GLOBAL_RESEARCH_TIME, globalResearchDependencies } from './plannerGlobalOptimizationResearch'
import { runPhase2C2Baseline, summarizePhase2C2Entry, type Phase2C2Orientation } from './plannerGlobalPhase2C2'
import { derivePhase2C25APreSearchContexts, phase2c25aSearchStatus, type Phase2C25APreparedOrientation } from './plannerGlobalPhase2C25A'
import { createPlannerAlternativeMaterializer } from '../domain/planner/alternative'
import {
  type Phase2C25BContextsResult,
  type Phase2C25BFirstCandidateSummary,
  type Phase2C25BMode,
  type Phase2C25BProgressSnapshot,
  type Phase2C25BSearchRecord,
  type Phase2C25BSnapshotPolicy,
  type Phase2C25BSnapshotTrigger,
  type Phase2C25BWorkerHeapSample,
} from './plannerGlobalPhase2C25BProtocol'

// ---------------------------------------------------------------- contexts

/**
 * This page session's own baseline (the ordinary Production Planner over the PlannerInput) and the Phase 2-C2.5-A
 * pre-search contexts of the requested orientations. An orientation the baseline does not produce fails closed.
 */
export async function derivePhase2C25BContexts(input: PlannerInput, orientationIds: readonly string[], createEngine: () => RngEngine,
  now: () => number = () => performance.now()): Promise<Phase2C25BContextsResult> {
  const started = now()
  const baseline = await runPhase2C2Baseline(input, { createEngine, now })
  const contexts: Phase2C25BContextsResult['contexts'] = {}
  for (const orientationId of orientationIds) {
    const orientation = baseline.orientations.find(o => o.orientationId === orientationId)
    if (!orientation) throw new Error(`This page session's baseline has no orientation ${orientationId}.`)
    contexts[orientationId] = derivePhase2C25APreSearchContexts(input, orientation, globalResearchDependencies(createEngine())).contexts
  }
  return { baseline: { summary: baseline.summary, orientations: baseline.orientations, elapsedMs: baseline.elapsedMs }, contexts, elapsedMs: now() - started }
}

/**
 * The Search Worker's own re-derivation of one context. It must be the context the page's contexts Worker derived
 * (same digest and Target); anything else fails closed before the Search.
 */
export function preparePhase2C25BSearchContext(input: PlannerInput, orientation: Phase2C2Orientation, workIndex: number, expectedContextDigest: string,
  engine: RngEngine): Phase2C25APreparedOrientation {
  const prepared = derivePhase2C25APreSearchContexts(input, orientation, globalResearchDependencies(engine))
  const context = prepared.contexts[workIndex]
  if (!context) throw new Error(`Orientation ${orientation.orientationId} has no pre-search context at work index ${workIndex}.`)
  if (context.contextDigest !== expectedContextDigest) {
    throw new Error(`Re-derived context ${orientation.orientationId}#${workIndex} differs from the page's (${context.contextDigest} != ${expectedContextDigest}).`)
  }
  if (context.status !== 'searchable' || context.searchReservation === null) throw new Error(`Context ${orientation.orientationId}#${workIndex} is not searched by the kernel.`)
  return prepared
}

// ---------------------------------------------------------------- progress observation

export interface Phase2C25BObservationEnvironment {
  now: () => number
  /** Worker-realm `performance.memory` or `null`; never estimated. */
  heap: () => Phase2C25BWorkerHeapSample | null
  /** Starts a repeating timer; returns its stop function. */
  setHeartbeat: (callback: () => void, intervalMs: number) => () => void
  emit: (snapshot: Phase2C25BProgressSnapshot) => void
}

/**
 * The instrumented-mode observer: the existing Search observer's aggregates plus the last event, snapshotted sparsely.
 * Each Search callback forwards to the existing observer and updates a few numbers; a snapshot is built only when a
 * trigger fires, and carries aggregates only.
 */
export function createPhase2C25BProgressObserver(environment: Phase2C25BObservationEnvironment, counts: () => PlannerAlternativePredictionCounts,
  policy: Phase2C25BSnapshotPolicy) {
  const observer = createPlannerAlternativeSearchObserver()
  const started = environment.now()
  let seq = 0
  let lastEvent: Phase2C25BProgressSnapshot['lastEvent'] = null
  let lastSentHeap = environment.heap()?.usedJSHeapSize ?? null
  let lastSentDepth = { skill: 0, gogma: 0 }
  let maxDepth = { skill: 0, gogma: 0 }
  let last: Phase2C25BProgressSnapshot | null = null
  const snapshot = (trigger: Phase2C25BSnapshotTrigger, heap = environment.heap()) => {
    const skill = observer.skill()
    const gogma = observer.gogma()
    const maxGenerated = gogma.depths.reduce((max, depth) => Math.max(max, depth.generatedStates), 0)
    const value: Phase2C25BProgressSnapshot = {
      seq: seq++, trigger, elapsedMs: environment.now() - started, settledWorkItems: observer.settledWorkItems(),
      skill: { streams: skill.streams, maxDepth: skill.maxDepth, totalStates: skill.totalStates, totalTransitions: skill.totalTransitions },
      gogma: { streams: gogma.streams, maxDepth: gogma.maxDepth, totalGeneratedStates: gogma.totalGeneratedStates, totalFrontierStates: gogma.totalFrontierStates,
        maxGeneratedStatesPerDepth: maxGenerated, depthOfMaxGeneratedStates: gogma.depths.find(depth => depth.generatedStates === maxGenerated && maxGenerated > 0)?.depth ?? null },
      lastEvent, predictionCounts: counts(), workerHeap: heap,
    }
    lastSentHeap = heap?.usedJSHeapSize ?? lastSentHeap
    lastSentDepth = { ...maxDepth }
    last = value
    environment.emit(value)
    return value
  }
  const maybeSnapshot = () => {
    const heap = environment.heap()
    if (heap !== null && lastSentHeap !== null && heap.usedJSHeapSize - lastSentHeap >= policy.heapGrowthBytes) snapshot('heap_growth', heap)
    else if (maxDepth.gogma - lastSentDepth.gogma >= policy.depthStep || maxDepth.skill - lastSentDepth.skill >= policy.depthStep) snapshot('depth_progress', heap)
  }
  const onSkill = (event: ReservedSkillDepthObservation) => {
    observer.instrumentation.onSkillReservedDepth?.(event)
    lastEvent = { type: 'skill', streamIndex: event.streamIndex, startCounter: event.startSkillCounter, depth: event.depth, absolutePositions: event.absolutePositions,
      generatedStates: null, frontierStates: null, familyLayouts: null, transitions: event.transitions, states: event.states }
    maxDepth = { ...maxDepth, skill: Math.max(maxDepth.skill, event.depth) }
    maybeSnapshot()
  }
  const onGogma = (event: ReservedGogmaDepthObservation) => {
    observer.instrumentation.onGogmaReservedDepth?.(event)
    lastEvent = { type: 'gogma', streamIndex: event.streamIndex, startCounter: event.startGogmaCounter, depth: event.depth, absolutePositions: event.absolutePositions,
      generatedStates: event.generatedStates, frontierStates: event.frontierStates, familyLayouts: event.familyLayouts, transitions: null, states: null }
    maxDepth = { ...maxDepth, gogma: Math.max(maxDepth.gogma, event.depth) }
    maybeSnapshot()
  }
  let stopHeartbeat: (() => void) | null = null
  return {
    instrumentation: { onWorkSettled: observer.instrumentation.onWorkSettled, onSkillReservedDepth: onSkill, onGogmaReservedDepth: onGogma },
    start: () => {
      snapshot('start')
      stopHeartbeat = environment.setHeartbeat(() => { snapshot('heartbeat') }, policy.heartbeatMs)
    },
    snapshot,
    stop: () => { stopHeartbeat?.(); stopHeartbeat = null },
    last: () => last,
    emitted: () => seq,
  }
}

// ---------------------------------------------------------------- Search-only run

export interface Phase2C25BSearchRunOptions {
  mode: Phase2C25BMode
  yieldControl: () => Promise<void>
  now: () => number
  /** Called once, inside the consumer, right before it returns `stop` for the first delivered Candidate. */
  onFirstCandidate: (timeToFirstMs: number) => void
  /** SHA-256 (hex) of a UTF-8 string: the raw stable key never leaves this function. */
  sha256: (text: string) => Promise<string>
  /** Instrumented mode only. */
  observation?: Omit<Phase2C25BObservationEnvironment, 'now'>
  snapshotPolicy: Phase2C25BSnapshotPolicy
}

function compactSummary(summary: ReturnType<typeof summarizePhase2C2Entry>): Phase2C25BFirstCandidateSummary {
  return { routeKind: summary.routeKind, sourceKind: summary.sourceKind, estimatedOperationCount: summary.estimatedOperationCount,
    ownOperationCount: summary.ownOperationCount, operationTypes: summary.operationTypes, heldRoute: summary.heldRoute }
}

/**
 * The Search of one pre-search context, alone, with the Phase 2-C2.5-A input: `visitPlannerAlternativeCandidates()` with
 * the context's origin, reservation, excluded Route keys and extent, and a consumer that stops at the first Candidate.
 *
 * - `minimal`: the Engine as given, no instrumentation, no counting, no progress (only the first Candidate notice).
 * - `instrumented`: the existing counting Engine wrapper and the existing Search observer, with sparse snapshots.
 *
 * The first Candidate is summarized and its key hashed only after the Search returned, never inside it.
 */
export async function runPhase2C25BSearchOnly(input: PlannerInput, prepared: Phase2C25APreparedOrientation, workIndex: number, engine: RngEngine,
  options: Phase2C25BSearchRunOptions): Promise<Phase2C25BSearchRecord> {
  const context = prepared.contexts[workIndex]
  if (!context || context.status !== 'searchable' || context.searchReservation === null) throw new Error(`No searchable pre-search context at work index ${workIndex}.`)
  const now = options.now
  const origin = prepared.prepared.scenario.origin
  const searchInput = { origin, targetWeaponId: context.targetWeaponId as never, extent: { ...context.extent }, reservation: context.searchReservation, excludedRouteKeys: context.excludedRouteKeys }
  let searchEngine = engine
  let counts: (() => PlannerAlternativePredictionCounts) | null = null
  let progress: ReturnType<typeof createPhase2C25BProgressObserver> | null = null
  if (options.mode === 'instrumented') {
    if (!options.observation) throw new Error('The instrumented mode needs an observation environment.')
    const counting = createCountingRngEngine(engine)
    searchEngine = counting.engine
    counts = counting.counts
    progress = createPhase2C25BProgressObserver({ ...options.observation, now }, counting.counts, options.snapshotPolicy)
  }
  let first: PlannerAlternativeCandidate | null = null
  let timeToFirstMs: number | null = null
  let countsAtFirst: PlannerAlternativePredictionCounts | null = null
  const started = now()
  progress?.start()
  let execution
  try {
    execution = await visitPlannerAlternativeCandidates(searchInput, searchEngine, (candidate) => {
      if (first === null) {
        first = candidate
        timeToFirstMs = now() - started
        countsAtFirst = counts?.() ?? null
        progress?.snapshot('first_candidate')
        options.onFirstCandidate(timeToFirstMs)
      }
      return 'stop'
    }, { yieldControl: options.yieldControl, instrumentation: progress?.instrumentation })
  } finally {
    progress?.stop()
  }
  const elapsedMs = now() - started
  const finalSnapshot = progress?.snapshot('final') ?? null
  // The Phase 2-C2.5-A status authority also refuses a consumer stop after any count other than the stop bound (1).
  const status = phase2c25aSearchStatus(execution.summary, execution.stoppedByConsumer, execution.summary.deliveredCandidates)
  const firstCandidate = first as PlannerAlternativeCandidate | null
  let firstCandidateSummary: Phase2C25BFirstCandidateSummary | null = null
  let firstCandidateKeySha256: string | null = null
  if (firstCandidate !== null) {
    const materializer = createPlannerAlternativeMaterializer({ origin, targetWeaponId: context.targetWeaponId as never, extent: searchInput.extent,
      reservation: context.searchReservation, excludedRouteKeys: context.excludedRouteKeys, clock: { now: () => GLOBAL_RESEARCH_TIME } })
    firstCandidateSummary = compactSummary(summarizePhase2C2Entry(materializer.materializeBuildListEntry(firstCandidate, []).entry, input, engine))
    firstCandidateKeySha256 = await options.sha256(candidateStableKey(firstCandidate))
  }
  return {
    mode: options.mode, orientationId: context.orientationId, targetWeaponId: context.targetWeaponId, workIndex, contextDigest: context.contextDigest, status,
    searchSummary: { ...execution.summary, stoppedByConsumer: execution.stoppedByConsumer, skippedExcludedRouteKeys: execution.skippedExcludedRouteKeys.length },
    timeToFirstMs, elapsedMs, firstCandidateKeySha256, firstCandidateSummary,
    predictionCounts: counts?.() ?? null, predictionCountsAtFirstCandidate: countsAtFirst, finalSnapshot, snapshotsEmitted: progress?.emitted() ?? 0,
  }
}
