/**
 * Issue #154 Phase 2-C2.5-A: kernel OOM localization, Research only. Never import from Production.
 *
 * Phase 2-C2 recorded that 43 of 54 orientation kernel child processes died at the 8 GB heap limit, but not where. This
 * module takes one orientation of THIS run's own baseline (the ordinary Production Planner over the original Export),
 * rebuilds exactly the pre-search context the Planner Alternative kernel gives each non-fixed Target to its Search, and
 * runs only `visitPlannerAlternativeCandidates()` on it, stopping at the first delivered Candidate:
 *
 * ```text
 * orientation -> preparePlannerAlternativeKernel()  (the kernel's own preparation, unchanged)
 *   -> per scenario work, in the kernel's order:
 *        invalidated Entry O          (the one searchable Entry of the Target)
 *        fixed Route set              (explicit decision Entries without O; no prior lineage)
 *        reservation                  (derivePlannerAlternativeReservation(), the Planner authority)
 *        excluded Route keys          (candidateStableKey(O) only; no prior exclusion)
 *        origin / extent              (the prepared scenario origin, the Production default extent)
 *   -> Planner Alternative Search only, consumer stop at 1 Candidate
 * ```
 *
 * No conflict judgement, held / blocked meaning, reservation rule, ranking or Search ordering is re-implemented: every
 * value comes from the Domain authority the kernel itself calls. The observation (instrumented mode) reuses the
 * existing execution-only Search instrumentation through `createPlannerAlternativeSearchObserver()` and the existing
 * `createCountingRngEngine()`; it only adds numbers and never returns anything the Search reads.
 *
 * This module never reads a file, an earlier Phase result or oracle evidence. Target IDs, Entry IDs and Counter
 * positions all come from the run itself; the Phase 2-C2 evidence is read only by the runner / analysis, for workload
 * selection and post-hoc comparison.
 */
import type { BuildListEntry, BuildListEntryId } from '../domain/models/publicTypes'
import { hashStableValue } from '../domain/models/publicTypes'
import {
  createPlannerAlternativeMaterializer,
  derivePlannerAlternativeReservation,
  preparePlannerAlternativeKernel,
  type PreparedPlannerAlternativeKernel,
} from '../domain/planner/alternative'
import type { PlannerDependencies, PlannerInput } from '../domain/planner/plannerTypes'
import type { RngEngine } from '../domain/rng/rngEngine'
import {
  candidateStableKey,
  normalizePlannerAlternativeExcludedRouteKeys,
  normalizePlannerAlternativeReservation,
  visitPlannerAlternativeCandidates,
  type PlannerAlternativeCandidate,
  type PlannerAlternativeReservation,
  type PlannerAlternativeSearchExtent,
  type PlannerAlternativeSearchSummary,
} from '../domain/search'
import type { ReservedGogmaDepthObservation } from '../domain/search/bonusStream'
import type { ReservedSkillDepthObservation } from '../domain/search/skillStream'
import { createCountingRngEngine, createPlannerAlternativeSearchObserver } from './plannerAlternativeBenchmarkInstrumentation'
import type {
  PlannerAlternativeGogmaDepthAggregate,
  PlannerAlternativePredictionCounts,
  PlannerAlternativeSkillDepthAggregate,
} from './plannerAlternativeBenchmarkProtocol'
import { GLOBAL_RESEARCH_TIME } from './plannerGlobalOptimizationResearch'
import {
  phase2c2KernelRequest,
  phase2c2ProductionDefaultConditions,
  summarizePhase2C2Entry,
  type Phase2C2CandidateSummary,
  type Phase2C2Orientation,
} from './plannerGlobalPhase2C2'

/** Research constants of this Phase. None of them is a Production default. */
export const PHASE2C25A_CHILD_HEAP_MB = 8192
/** The consumer stops at the first delivered Candidate: the question is whether Search alone dies before it. */
export const PHASE2C25A_CANDIDATE_STOP_BOUND = 1
/** One child process at a time, so two 8 GB Searches never share the machine's memory pressure. */
export const PHASE2C25A_CONCURRENCY = 1
/** Wall-time budget of one Search-only child (preparation included). */
export const PHASE2C25A_RUN_BUDGET_MS = 20 * 60 * 1000
/**
 * Sparse progress snapshots of the instrumented mode: the child only updates an aggregate per event and sends a
 * snapshot to the parent on a heartbeat, on heap growth, on held-aware depth progress, right before the first
 * Candidate stop, and at the end. Never a full event trace, never a state or layout content.
 */
export const PHASE2C25A_SNAPSHOT_POLICY = {
  heartbeatMs: 2_000,
  heapGrowthBytes: 256 * 1024 * 1024,
  depthStep: 5,
} as const

export type Phase2C25AMode = 'minimal' | 'instrumented'

// ---------------------------------------------------------------- pre-search contexts

export interface Phase2C25APreSearchContext {
  orientationId: string
  /** Index of the Target's work in `scenario.works`: the kernel searches the Targets in this order. */
  workIndex: number
  targetWeaponId: string
  status: 'searchable' | 'blocked_by_selected_checkpoint'
  invalidatedBuildListEntryId: string
  invalidatedRouteKey: string
  fixedRouteBuildListEntryIds: string[]
  /** `normalizePlannerAlternativeReservation()` form; `null` when the kernel would not search this Target. */
  reservation: PlannerAlternativeReservation | null
  /** The reservation exactly as `derivePlannerAlternativeReservation()` returned it: what the kernel hands its Search. */
  searchReservation: PlannerAlternativeReservation | null
  excludedRouteKeys: string[]
  extent: PlannerAlternativeSearchExtent
  /** `hashStableValue()` of the prepared scenario origin (the Planner-start snapshot the Search reads). */
  originDigest: string
  /** `hashStableValue()` of every field above except the digest itself. */
  contextDigest: string
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
}

export interface Phase2C25APreparedOrientation {
  prepared: PreparedPlannerAlternativeKernel
  contexts: Phase2C25APreSearchContext[]
}

/**
 * The pre-search context of every scenario work of one orientation, exactly as the kernel's `runTarget()` builds it
 * right before its Search, under the Phase 2-C2 request (no prior fixed Entry, no prior exclusion, the Production
 * default extent as a spread copy). The invalidated Entry is the one searchable Entry of the Target and must be one of
 * the kernel preparation's own `invalidatedBuildListEntryIds`; the reservation is the Planner authority's.
 *
 * Budget exhaustion (a kernel stop before a later Target's Search) depends on earlier trials and is not reproduced:
 * every non-blocked work is a searchable context here.
 */
export function derivePhase2C25APreSearchContexts(input: PlannerInput, orientation: Phase2C2Orientation, dependencies: PlannerDependencies): Phase2C25APreparedOrientation {
  const conditions = phase2c2ProductionDefaultConditions()
  const request = phase2c2KernelRequest(input, orientation, conditions)
  if (request.priorFixedBuildListEntryIds.length !== 0 || request.priorExcludedRoutes.length !== 0) {
    throw new Error('Phase 2-C2.5-A reproduces the Phase 2-C2 request only: no prior fixed Entry and no prior exclusion.')
  }
  const preparation = preparePlannerAlternativeKernel(request, dependencies)
  if (preparation.status !== 'ready') throw new Error(`Kernel preparation of ${orientation.orientationId} failed: ${preparation.status}`)
  const prepared = preparation.prepared
  const { scenario, explicitDecisionBuildListEntryIds, invalidatedBuildListEntryIds } = prepared
  const originDigest = hashStableValue(scenario.origin)
  const contexts = scenario.works.map((work, workIndex): Phase2C25APreSearchContext => {
    const entries = scenario.initialContext.allSearchEntries.filter(entry => entry.targetWeaponId === work.targetWeaponId)
    if (entries.length !== 1) throw new Error(`Target ${work.targetWeaponId} holds ${entries.length} searchable Entries; the kernel needs exactly one.`)
    const invalidated = entries[0]
    if (!invalidatedBuildListEntryIds.includes(invalidated.id)) {
      throw new Error(`Entry ${invalidated.id} is not one of the kernel preparation's invalidated Entries.`)
    }
    const fixedRouteBuildListEntryIds = sortedUnique(explicitDecisionBuildListEntryIds).filter(id => id !== invalidated.id)
    const invalidatedRouteKey = candidateStableKey(invalidated.candidateSnapshot)
    const excludedRouteKeys = normalizePlannerAlternativeExcludedRouteKeys([invalidatedRouteKey])
    const blocked = work.blockedBySelectedCheckpoint
    const searchReservation = blocked ? null : derivePlannerAlternativeReservation(
      fixedRouteBuildListEntryIds.map(id => {
        const entry = scenario.initialContext.entriesById.get(id as BuildListEntryId)
        if (!entry) throw new Error(`Fixed Entry ${id} is not a valid Entry of the prepared scenario.`)
        return entry as BuildListEntry
      }), dependencies.rngEngine)
    const reservation = searchReservation === null ? null : normalizePlannerAlternativeReservation(searchReservation)
    const body = {
      orientationId: orientation.orientationId, workIndex, targetWeaponId: work.targetWeaponId as string,
      status: blocked ? 'blocked_by_selected_checkpoint' as const : 'searchable' as const,
      invalidatedBuildListEntryId: invalidated.id as string, invalidatedRouteKey,
      fixedRouteBuildListEntryIds: fixedRouteBuildListEntryIds as string[], reservation, searchReservation, excludedRouteKeys,
      extent: { ...conditions.extent }, originDigest,
    }
    return { ...body, contextDigest: hashStableValue(body) }
  })
  return { prepared, contexts }
}

// ---------------------------------------------------------------- progress observation

export interface Phase2C25AMemorySample {
  heapUsed: number
  heapTotal: number
  rss: number
  external: number
  arrayBuffers: number
}

export type Phase2C25ASnapshotTrigger = 'start' | 'heartbeat' | 'heap_growth' | 'depth_progress' | 'first_candidate' | 'final'

export interface Phase2C25AProgressSnapshot {
  seq: number
  trigger: Phase2C25ASnapshotTrigger
  elapsedMs: number
  settledWorkItems: number
  lastEvent: null | {
    type: 'skill' | 'gogma'
    streamIndex: number
    startCounter: number
    depth: number
    skill: { transitions: number; states: number; absolutePositions: number } | null
    gogma: { generatedStates: number; frontierStates: number; absolutePositions: number; familyLayouts: number } | null
  }
  streams: { skill: number; gogma: number }
  maxDepth: { skill: number; gogma: number }
  cumulative: { totalSkillStates: number; totalSkillTransitions: number; totalGogmaGeneratedStates: number; totalGogmaFrontierStates: number }
  predictionCounts: PlannerAlternativePredictionCounts
  memory: Phase2C25AMemorySample
  /** Sampled maximum of each memory field over every sample this child took so far (not a true peak). */
  sampledMax: Phase2C25AMemorySample
  /** Per-depth aggregates summed over held-aware streams (numbers only, never state or layout contents). */
  skillDepths: readonly PlannerAlternativeSkillDepthAggregate[]
  gogmaDepths: readonly PlannerAlternativeGogmaDepthAggregate[]
}

export interface Phase2C25AObservationEnvironment {
  memory: () => Phase2C25AMemorySample
  now: () => number
  /** Starts a repeating timer; returns its stop function. */
  setHeartbeat: (callback: () => void, intervalMs: number) => () => void
  emit: (snapshot: Phase2C25AProgressSnapshot) => void
}

function maxSample(left: Phase2C25AMemorySample, right: Phase2C25AMemorySample): Phase2C25AMemorySample {
  return { heapUsed: Math.max(left.heapUsed, right.heapUsed), heapTotal: Math.max(left.heapTotal, right.heapTotal), rss: Math.max(left.rss, right.rss),
    external: Math.max(left.external, right.external), arrayBuffers: Math.max(left.arrayBuffers, right.arrayBuffers) }
}

/**
 * The instrumented-mode progress observer: the existing Search observer's aggregates plus the last event, snapshotted
 * sparsely. Each Search callback forwards to the existing observer and updates a few numbers; a snapshot is built only
 * when a trigger fires.
 */
export function createPhase2C25AProgressObserver(environment: Phase2C25AObservationEnvironment, counts: () => PlannerAlternativePredictionCounts,
  policy: { heartbeatMs: number; heapGrowthBytes: number; depthStep: number } = PHASE2C25A_SNAPSHOT_POLICY) {
  const observer = createPlannerAlternativeSearchObserver()
  const started = environment.now()
  let seq = 0
  let lastEvent: Phase2C25AProgressSnapshot['lastEvent'] = null
  let sampledMax = environment.memory()
  let lastSentHeap = 0
  let lastSentDepth = { skill: 0, gogma: 0 }
  let maxDepth = { skill: 0, gogma: 0 }
  let last: Phase2C25AProgressSnapshot | null = null
  const sample = () => {
    const memory = environment.memory()
    sampledMax = maxSample(sampledMax, memory)
    return memory
  }
  const snapshot = (trigger: Phase2C25ASnapshotTrigger, memory = sample()) => {
    const skill = observer.skill()
    const gogma = observer.gogma()
    const value: Phase2C25AProgressSnapshot = {
      seq: seq++, trigger, elapsedMs: environment.now() - started, settledWorkItems: observer.settledWorkItems(), lastEvent,
      streams: { skill: skill.streams, gogma: gogma.streams }, maxDepth: { skill: skill.maxDepth, gogma: gogma.maxDepth },
      cumulative: { totalSkillStates: skill.totalStates, totalSkillTransitions: skill.totalTransitions,
        totalGogmaGeneratedStates: gogma.totalGeneratedStates, totalGogmaFrontierStates: gogma.totalFrontierStates },
      predictionCounts: counts(), memory, sampledMax, skillDepths: skill.depths, gogmaDepths: gogma.depths,
    }
    lastSentHeap = memory.heapUsed
    lastSentDepth = { ...maxDepth }
    last = value
    environment.emit(value)
    return value
  }
  const maybeSnapshot = () => {
    const memory = sample()
    if (memory.heapUsed - lastSentHeap >= policy.heapGrowthBytes) snapshot('heap_growth', memory)
    else if (maxDepth.gogma - lastSentDepth.gogma >= policy.depthStep || maxDepth.skill - lastSentDepth.skill >= policy.depthStep) snapshot('depth_progress', memory)
  }
  const onSkill = (event: ReservedSkillDepthObservation) => {
    observer.instrumentation.onSkillReservedDepth?.(event)
    lastEvent = { type: 'skill', streamIndex: event.streamIndex, startCounter: event.startSkillCounter, depth: event.depth,
      skill: { transitions: event.transitions, states: event.states, absolutePositions: event.absolutePositions }, gogma: null }
    maxDepth = { ...maxDepth, skill: Math.max(maxDepth.skill, event.depth) }
    maybeSnapshot()
  }
  const onGogma = (event: ReservedGogmaDepthObservation) => {
    observer.instrumentation.onGogmaReservedDepth?.(event)
    lastEvent = { type: 'gogma', streamIndex: event.streamIndex, startCounter: event.startGogmaCounter, depth: event.depth, skill: null,
      gogma: { generatedStates: event.generatedStates, frontierStates: event.frontierStates, absolutePositions: event.absolutePositions, familyLayouts: event.familyLayouts } }
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
  }
}

// ---------------------------------------------------------------- Search-only run

export type Phase2C25ASearchStatus = 'first_candidate' | 'stopped_by_extent_before_candidate' | 'exhausted_before_candidate'

export function phase2c25aSearchStatus(summary: Pick<PlannerAlternativeSearchSummary, 'exhausted' | 'stoppedByExtent'>, stoppedByConsumer: boolean, delivered: number): Phase2C25ASearchStatus {
  if (stoppedByConsumer) {
    if (delivered !== PHASE2C25A_CANDIDATE_STOP_BOUND) throw new Error(`A consumer stop after ${delivered} Candidates; the stop bound is ${PHASE2C25A_CANDIDATE_STOP_BOUND}.`)
    return 'first_candidate'
  }
  if (delivered !== 0) throw new Error('The Search ended by itself after delivering a Candidate; the consumer should have stopped at the first.')
  if (summary.stoppedByExtent) return 'stopped_by_extent_before_candidate'
  if (summary.exhausted) return 'exhausted_before_candidate'
  throw new Error('A Planner Alternative Search ended with neither a consumer stop, an extent stop nor exhaustion.')
}

export interface Phase2C25ASearchRecord {
  mode: Phase2C25AMode
  orientationId: string
  targetWeaponId: string
  workIndex: number
  contextDigest: string
  status: Phase2C25ASearchStatus
  searchSummary: PlannerAlternativeSearchSummary & { stoppedByConsumer: boolean; skippedExcludedRouteKeys: number }
  /** Search start to the first delivery (ms); `null` without a Candidate. */
  timeToFirstMs: number | null
  elapsedMs: number
  /** Raw `candidateStableKey()` of the first Candidate (the runner hashes it before any committed evidence). */
  firstCandidateKey: string | null
  firstCandidateSummary: Phase2C2CandidateSummary | null
  /** Instrumented mode only. */
  predictionCounts: PlannerAlternativePredictionCounts | null
  predictionCountsAtFirstCandidate: PlannerAlternativePredictionCounts | null
  finalSnapshot: Phase2C25AProgressSnapshot | null
}

export interface Phase2C25ASearchRunOptions {
  mode: Phase2C25AMode
  yieldControl?: () => Promise<void>
  now?: () => number
  /** Instrumented mode only. */
  observation?: Omit<Phase2C25AObservationEnvironment, 'now'>
  snapshotPolicy?: { heartbeatMs: number; heapGrowthBytes: number; depthStep: number }
}

/**
 * The Search of one pre-search context, alone: `visitPlannerAlternativeCandidates()` with the context's origin,
 * reservation, excluded Route keys and extent, and a consumer that stops at the first delivered Candidate.
 *
 * - `minimal`: the engine as given, no instrumentation, no counting, no progress: the closest control to Production.
 * - `instrumented`: the existing counting Engine wrapper and the existing Search observer, with sparse snapshots.
 *
 * The first Candidate is summarized (materialized by the Planner Alternative materializer of this very context) only
 * after the Search has returned, so the summary never runs inside the Search.
 */
export async function runPhase2C25ASearchOnly(input: PlannerInput, prepared: Phase2C25APreparedOrientation, workIndex: number, engine: RngEngine,
  options: Phase2C25ASearchRunOptions): Promise<Phase2C25ASearchRecord> {
  const context = prepared.contexts[workIndex]
  if (!context) throw new Error(`No pre-search context at work index ${workIndex}.`)
  if (context.status !== 'searchable' || context.reservation === null || context.searchReservation === null) throw new Error(`Context ${context.orientationId}/${context.targetWeaponId} is not searched by the kernel.`)
  const now = options.now ?? (() => performance.now())
  const origin = prepared.prepared.scenario.origin
  const searchInput = { origin, targetWeaponId: context.targetWeaponId as never, extent: { ...context.extent }, reservation: context.searchReservation, excludedRouteKeys: context.excludedRouteKeys }
  let searchEngine = engine
  let counts: (() => PlannerAlternativePredictionCounts) | null = null
  let progress: ReturnType<typeof createPhase2C25AProgressObserver> | null = null
  if (options.mode === 'instrumented') {
    if (!options.observation) throw new Error('The instrumented mode needs an observation environment.')
    const counting = createCountingRngEngine(engine)
    searchEngine = counting.engine
    counts = counting.counts
    progress = createPhase2C25AProgressObserver({ ...options.observation, now }, counting.counts, options.snapshotPolicy)
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
      }
      return 'stop'
    }, { yieldControl: options.yieldControl, instrumentation: progress?.instrumentation })
  } finally {
    progress?.stop()
  }
  const elapsedMs = now() - started
  const finalSnapshot = progress?.snapshot('final') ?? null
  const firstCandidate = first as PlannerAlternativeCandidate | null
  let firstCandidateSummary: Phase2C2CandidateSummary | null = null
  if (firstCandidate !== null) {
    const materializer = createPlannerAlternativeMaterializer({ origin, targetWeaponId: context.targetWeaponId as never, extent: searchInput.extent,
      reservation: context.searchReservation, excludedRouteKeys: context.excludedRouteKeys, clock: { now: () => GLOBAL_RESEARCH_TIME } })
    firstCandidateSummary = summarizePhase2C2Entry(materializer.materializeBuildListEntry(firstCandidate, []).entry, input, engine)
  }
  return {
    mode: options.mode, orientationId: context.orientationId, targetWeaponId: context.targetWeaponId, workIndex, contextDigest: context.contextDigest,
    status: phase2c25aSearchStatus(execution.summary, execution.stoppedByConsumer, execution.summary.deliveredCandidates),
    searchSummary: { ...execution.summary, stoppedByConsumer: execution.stoppedByConsumer, skippedExcludedRouteKeys: execution.skippedExcludedRouteKeys.length },
    timeToFirstMs, elapsedMs,
    firstCandidateKey: firstCandidate === null ? null : candidateStableKey(firstCandidate),
    firstCandidateSummary,
    predictionCounts: counts?.() ?? null,
    predictionCountsAtFirstCandidate: countsAtFirst,
    finalSnapshot,
  }
}

