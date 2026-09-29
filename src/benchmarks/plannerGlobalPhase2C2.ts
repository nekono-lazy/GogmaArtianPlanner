/**
 * Issue #154 Phase 2-C2: Candidate portfolio Research only. Never import from Production.
 *
 * From the ORIGINAL Export Build List:
 *
 * 1. the ordinary Production Planner run is the baseline authority (its Conflicts are the only source of decisions);
 * 2. every Conflict is turned into one orientation per participant Entry (that Entry fixed, the others searched);
 * 3. each orientation runs the current Production Planner Alternative kernel unchanged (no prior fixed Entry, no prior
 *    exclusion, the Production extent / trial bounds passed by the caller as explicit spread copies);
 * 4. for every searched Target of that kernel, the SAME Planner-start origin, reservation and excluded Route keys are
 *    given to `visitPlannerAlternativeCandidates()` once more, post-hoc, and up to `captureBound` delivered Candidates
 *    are recorded. That Search never feeds back into the kernel;
 * 5. the Target portfolio is the original Candidate plus every delivered alternative, deduplicated by
 *    `candidateStableKey()` within the Target, with every observing context kept as provenance.
 *
 * Nothing here selects a combination of Candidates, re-implements a Planner conflict judgement, re-derives a
 * reservation, or reads any earlier Phase result / oracle evidence. Target IDs, Entry IDs, Conflict keys and Counter
 * positions all come from the run itself.
 */
import type { BuildListEntry, ConflictKind, PlanConflict, RouteOperation } from '../domain/models/publicTypes'
import { stableStringify } from '../domain/models/publicTypes'
import {
  createPlannerAlternativeMaterializer,
  derivePlannerAlternativeReservation,
  preparePlannerAlternativeKernel,
  runPreparedPlannerAlternativeKernel,
  defaultPlannerAlternativeTrialBounds,
  type PlannerAlternativeKernelInstrumentation,
  type PlannerAlternativeKernelRequest,
  type PlannerAlternativeTrialBounds,
} from '../domain/planner/alternative'
import { createProductionPlan } from '../domain/planner/productionPlanGeneration'
import { createPlannerRouteUnitPlans, type PlannerRouteUnit } from '../domain/planner/plannerRouteProgress'
import type { PlannerInput, PlannerResult } from '../domain/planner/plannerTypes'
import type { RngEngine } from '../domain/rng/rngEngine'
import {
  candidateStableKey,
  defaultPlannerAlternativeSearchExtent,
  normalizePlannerAlternativeExcludedRouteKeys,
  normalizePlannerAlternativeReservation,
  visitPlannerAlternativeCandidates,
  type ConstrainedSearchOrigin,
  type PlannerAlternativeCandidate,
  type PlannerAlternativeReservation,
  type PlannerAlternativeSearchExtent,
} from '../domain/search'
import { globalResearchDependencies, GLOBAL_RESEARCH_TIME } from './plannerGlobalOptimizationResearch'

/** Research-only portfolio capture bound per Search context. Not a Production default. */
export const PHASE2C2_PORTFOLIO_CAPTURE_BOUND = 8
/** Prefix sizes of one captured run at which the portfolio diversity is also reported. */
export const PHASE2C2_DIVERSITY_PREFIXES = [1, 2, 4, 8] as const

export type Phase2C2Stream = 'normal' | 'gogma' | 'skill'
export type Phase2C2ProbeAxis = Phase2C2Stream

export interface Phase2C2Conditions {
  extent: PlannerAlternativeSearchExtent
  bounds: PlannerAlternativeTrialBounds
  captureBound: number
}

/**
 * The Production conditions of the first formal result: the current Production Planner Alternative extent and trial
 * bounds as explicit spread copies (never copied values), plus the Research capture bound.
 */
export function phase2c2ProductionDefaultConditions(): Phase2C2Conditions {
  return { extent: { ...defaultPlannerAlternativeSearchExtent }, bounds: { ...defaultPlannerAlternativeTrialBounds }, captureBound: PHASE2C2_PORTFOLIO_CAPTURE_BOUND }
}

/** Collapses sorted unique integers into inclusive ranges (a held Normal prefix of 207 positions is one range). */
export function positionRanges(values: readonly number[]): [number, number][] {
  const sorted = [...new Set(values)].sort((a, b) => a - b)
  const out: [number, number][] = []
  for (const value of sorted) {
    const last = out.at(-1)
    if (last && value === last[1] + 1) last[1] = value
    else out.push([value, value])
  }
  return out
}

// ---------------------------------------------------------------- baseline and orientations

export interface Phase2C2BaselineSummary {
  planningTargetCount: number
  completedTargetCount: number
  termination: string
  planSteps: number | null
  selectedTargets: string[]
  conflicts: number
  conflictsByKind: Record<string, number>
  /** Target-level `${kind}:${sorted participant Target IDs}` (the Phase 2-C1 signature, Entry-ID independent). */
  conflictSignatures: string[]
  rejected: number
  rejectedByReason: Record<string, number>
  warningsByKind: Record<string, number>
}

function countBy<T>(values: readonly T[], key: (value: T) => string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const value of values) out[key(value)] = (out[key(value)] ?? 0) + 1
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
}

export function phase2c2ConflictSignature(kind: string, targetWeaponIds: readonly string[]): string {
  return `${kind}:${[...targetWeaponIds].sort().join(',')}`
}

export function summarizePhase2C2Baseline(input: PlannerInput, result: PlannerResult): Phase2C2BaselineSummary {
  const targetOf = new Map(input.buildListEntries.map(entry => [entry.id as string, entry.targetWeaponId as string]))
  return {
    planningTargetCount: result.termination.totalTargetCount,
    completedTargetCount: result.termination.completedTargetCount,
    termination: result.termination.status,
    planSteps: result.plan?.steps.length ?? null,
    selectedTargets: [...(result.plan?.selectedBuildListEntryIds ?? [])].map(id => targetOf.get(id)!).sort(),
    conflicts: result.conflicts.length,
    conflictsByKind: countBy(result.conflicts, conflict => conflict.kind),
    conflictSignatures: result.conflicts.map(conflict => phase2c2ConflictSignature(conflict.kind, conflict.buildListEntryIds.map(id => targetOf.get(id)!))).sort(),
    rejected: result.plan?.rejectedBuildListEntries.length ?? 0,
    rejectedByReason: countBy(result.plan?.rejectedBuildListEntries ?? [], rejected => rejected.reason),
    warningsByKind: countBy(result.warnings, warning => warning.kind),
  }
}

export interface Phase2C2Orientation {
  /** `c<conflict index>-p<participant index>`, in the baseline's own Conflict / participant order. */
  orientationId: string
  conflictIndex: number
  conflictKey: string
  kind: ConflictKind
  participantBuildListEntryIds: string[]
  participantTargetWeaponIds: string[]
  fixedBuildListEntryId: string
  fixedTargetWeaponId: string
}

/** Every Conflict of the baseline result, once per participant Entry as the fixed winner. */
export function derivePhase2C2Orientations(input: PlannerInput, conflicts: readonly PlanConflict[]): Phase2C2Orientation[] {
  const targetOf = new Map(input.buildListEntries.map(entry => [entry.id as string, entry.targetWeaponId as string]))
  return conflicts.flatMap((conflict, conflictIndex) => {
    const participants = [...conflict.buildListEntryIds] as string[]
    const targets = participants.map(id => {
      const target = targetOf.get(id)
      if (target === undefined) throw new Error(`Conflict ${conflict.id} names Entry ${id}, which is not in the Planner input.`)
      return target
    })
    return participants.map((fixed, participantIndex) => ({
      orientationId: `c${conflictIndex}-p${participantIndex}`, conflictIndex, conflictKey: conflict.id, kind: conflict.kind,
      participantBuildListEntryIds: participants, participantTargetWeaponIds: targets, fixedBuildListEntryId: fixed, fixedTargetWeaponId: targets[participantIndex],
    }))
  })
}

/** The kernel request of one orientation: the baseline's own Conflict key and participant Entry, no lineage. */
export function phase2c2KernelRequest(input: PlannerInput, orientation: Phase2C2Orientation, conditions: Phase2C2Conditions): PlannerAlternativeKernelRequest {
  return {
    plannerInput: input,
    decision: { conflictKey: orientation.conflictKey, selectedBuildListEntryId: orientation.fixedBuildListEntryId as BuildListEntry['id'] },
    priorFixedBuildListEntryIds: [],
    priorExcludedRoutes: [],
    extent: { ...conditions.extent },
    bounds: { ...conditions.bounds },
  }
}

/** The Research probe axis of a Conflict kind; `null` keeps the context at the default extent. */
export function phase2c2ProbeAxis(kind: ConflictKind): Phase2C2ProbeAxis | null {
  switch (kind) {
    case 'same_normal_counter': return 'normal'
    case 'same_skill_counter': return 'skill'
    case 'same_gogma_counter': return 'gogma'
    case 'same_owned_weapon_consumed': return null
  }
}

const AXIS_FIELD: Record<Phase2C2ProbeAxis, keyof PlannerAlternativeSearchExtent> = { normal: 'maxNormalAdvance', gogma: 'maxGogmaAdvance', skill: 'maxSkillAdvance' }

/** The next grid value above the current extent on `axis` only; `null` when the grid has none. */
export function phase2c2NextProbeExtent(extent: PlannerAlternativeSearchExtent, axis: Phase2C2ProbeAxis, grid: Readonly<Record<Phase2C2ProbeAxis, readonly number[]>>): PlannerAlternativeSearchExtent | null {
  const field = AXIS_FIELD[axis]
  const next = [...grid[axis]].sort((a, b) => a - b).find(value => value > extent[field])
  return next === undefined ? null : { ...extent, [field]: next }
}

export type Phase2C2SearchStatus = 'consumer_stop' | 'exhausted' | 'stopped_by_extent'

/** Whether a finished context needs the next probe value: only an extent stop that left the capture bound unfilled. */
export function phase2c2NeedsProbe(status: Phase2C2SearchStatus, delivered: number, captureBound: number): boolean {
  return status === 'stopped_by_extent' && delivered < captureBound
}

// ---------------------------------------------------------------- Candidate summaries

export type Phase2C2SourceKind = 'owned_gogma' | 'owned_normal' | 'new_normal'

export interface Phase2C2StreamUse {
  first: number
  last: number
  /** Own Route units on this stream (a `create_normal_artian(count = N)` is N units). */
  operations: number
  /** Every own unit position, as inclusive ranges. */
  positions: [number, number][]
  /** Positions of units the Planner never fast-forwards (`canSkipWhenCounterPassed === false`). */
  required: number[]
  /** Own unit positions are not consecutive: the Route holds its weapon across other positions. */
  crossesHeldPositions: boolean
  /** The first own unit lies after the Planner-start origin of this stream. */
  startsAfterOrigin: boolean
}

export interface Phase2C2CandidateSummary {
  targetWeaponId: string
  routeKind: string
  sourceKind: Phase2C2SourceKind
  sourceOwnedWeaponId: string | null
  estimatedOperationCount: number
  estimatedAdvances: { normal: number | null; gogma: number; skill: number }
  ownOperationCount: number
  operationTypes: Record<string, number>
  normalCounterId: string | null
  /** The production target Normal's Counter position; `null` for a blind creation or no creation. */
  normalProductionTargetPosition: number | null
  blindNormalCreation: boolean
  conversionSkillPosition: number | null
  normal: Phase2C2StreamUse | null
  gogma: Phase2C2StreamUse | null
  skill: Phase2C2StreamUse | null
  /** Gogma units as runs of consecutive positions with one operation type: `[first, last, type]`. */
  gogmaTypeRuns: [number, number, string][]
  /** Gogma or Skill own positions are not consecutive (the Phase 2-B `crossesHeldPositions` definition). */
  heldRoute: boolean
  finalBonuses: { bonusTypeId: string; bonusRankId: string }[]
  restorationBonusScope: string
  seriesSkillId: string | null
  groupSkillId: string | null
}

function unitCount(operation: RouteOperation): number { return operation.type === 'create_normal_artian' ? operation.count : 1 }

function streamUse(units: readonly PlannerRouteUnit[], origin: number | null): Phase2C2StreamUse | null {
  const positions = units.map(unit => unit.counterBefore).filter((value): value is number => value !== null)
  if (positions.length === 0) return null
  const first = Math.min(...positions), last = Math.max(...positions)
  return {
    first, last, operations: positions.length, positions: positionRanges(positions),
    required: units.filter(unit => !unit.canSkipWhenCounterPassed && unit.counterBefore !== null).map(unit => unit.counterBefore!),
    crossesHeldPositions: last - first + 1 > positions.length,
    startsAfterOrigin: origin !== null && first > origin,
  }
}

function typeRuns(units: readonly PlannerRouteUnit[]): [number, number, string][] {
  const out: [number, number, string][] = []
  for (const unit of [...units].filter(u => u.counterBefore !== null).sort((a, b) => a.counterBefore! - b.counterBefore!)) {
    const last = out.at(-1)
    if (last && last[2] === unit.operation.type && unit.counterBefore === last[1] + 1) last[1] = unit.counterBefore!
    else out.push([unit.counterBefore!, unit.counterBefore!, unit.operation.type])
  }
  return out
}

/** The Route summary of one Entry, with Route units from the Production authority (`createPlannerRouteUnitPlans`). */
export function summarizePhase2C2Entry(entry: BuildListEntry, input: PlannerInput, engine: RngEngine): Phase2C2CandidateSummary {
  const units = createPlannerRouteUnitPlans([entry], engine).unitPlans.get(entry.id)
  if (!units) throw new Error(`No Planner route units for ${entry.id}.`)
  const candidate = entry.candidateSnapshot
  const route = candidate.route
  const create = route.operations.find(op => op.type === 'create_normal_artian')
  const convert = route.operations.find(op => op.type === 'convert_normal_to_gogma')
  const normalUnits = units.filter(unit => unit.counterStream === 'normal')
  const normalCounterId = normalUnits[0]?.counterId ?? null
  const normalOrigin = normalCounterId === null ? null : input.normalCounters.find(counter => counter.id === normalCounterId)?.counter ?? null
  const operationTypes: Record<string, number> = {}
  for (const op of route.operations) operationTypes[op.type] = (operationTypes[op.type] ?? 0) + unitCount(op)
  const gogma = streamUse(units.filter(unit => unit.counterStream === 'gogma'), input.rngState.gogmaCounter.value)
  const skill = streamUse(units.filter(unit => unit.counterStream === 'skill'), input.rngState.skillCounter.value)
  return {
    targetWeaponId: entry.targetWeaponId, routeKind: route.kind,
    sourceKind: create ? 'new_normal' : route.kind === 'owned_normal_artian_to_gogma' ? 'owned_normal' : 'owned_gogma',
    sourceOwnedWeaponId: route.sourceOwnedWeaponId,
    estimatedOperationCount: candidate.estimatedOperationCount,
    estimatedAdvances: { normal: candidate.estimatedNormalAdvance, gogma: candidate.estimatedGogmaAdvance, skill: candidate.estimatedSkillAdvance },
    ownOperationCount: route.operations.reduce((sum, op) => sum + unitCount(op), 0), operationTypes,
    normalCounterId,
    normalProductionTargetPosition: create && create.normalCounterAfter !== null ? create.normalCounterAfter - 1 : null,
    blindNormalCreation: create !== undefined && create.normalCounterAfter === null,
    conversionSkillPosition: convert ? convert.skillCounterBefore : null,
    normal: streamUse(normalUnits, normalOrigin), gogma, skill,
    gogmaTypeRuns: typeRuns(units.filter(unit => unit.counterStream === 'gogma')),
    heldRoute: Boolean(gogma?.crossesHeldPositions || skill?.crossesHeldPositions),
    finalBonuses: candidate.finalBonuses.map(bonus => ({ bonusTypeId: bonus.bonusTypeId, bonusRankId: bonus.bonusRankId })),
    restorationBonusScope: candidate.restorationBonusScope, seriesSkillId: candidate.seriesSkillId, groupSkillId: candidate.groupSkillId,
  }
}

/**
 * Observational check of the existing Search contract only (never a Planner conflict judgement): whether this Route
 * puts no own unit on a blocked position of the context's reservation and uses no exclusive OwnedWeapon.
 */
export function respectsPhase2C2Reservation(summary: Phase2C2CandidateSummary, route: { operations: readonly RouteOperation[]; sourceOwnedWeaponId: string | null },
  reservation: PlannerAlternativeReservation): { respects: boolean; blockedHits: Record<string, number[]>; exclusiveHit: string[] } {
  const expand = (use: Phase2C2StreamUse | null) => use === null ? [] : use.positions.flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i))
  const hits = (own: number[], blocked: readonly number[]) => own.filter(position => blocked.includes(position))
  const normalBlocked = reservation.normal.find(entry => entry.counterId === summary.normalCounterId)?.blocked ?? []
  // A blocked Normal position holds no production target (a Counter-advance forge is never blocked): the required
  // Normal units are the production target forges.
  const normalOwn = summary.normal?.required ?? []
  const blockedHits = { normal: hits(normalOwn, normalBlocked), gogma: hits(expand(summary.gogma), reservation.gogma.blocked), skill: hits(expand(summary.skill), reservation.skill.blocked) }
  const referenced = new Set<string>([...(route.sourceOwnedWeaponId ? [route.sourceOwnedWeaponId] : []),
    ...route.operations.flatMap(op => 'sourceOwnedWeaponId' in op && op.sourceOwnedWeaponId ? [op.sourceOwnedWeaponId as string] : [])])
  const exclusiveHit = reservation.exclusiveOwnedWeaponIds.filter(id => referenced.has(id))
  const respects = Object.values(blockedHits).every(list => list.length === 0) && exclusiveHit.length === 0
  return { respects, blockedHits, exclusiveHit }
}

// ---------------------------------------------------------------- kernel and Search contexts

export interface Phase2C2CapturedCandidate {
  /** 0-based delivery index in this context. */
  deliveredIndex: number
  /** `candidateStableKey()` of the Candidate (the portfolio dedup key within its Target). */
  stableKey: string
  summary: Phase2C2CandidateSummary
  reservationCheck: ReturnType<typeof respectsPhase2C2Reservation>
  /** Planner Alternative kernel judgement of this very Candidate in this context, when it was trialled. */
  kernel: { status: 'kernel_found'; generatedSelected: boolean } | { status: 'kernel_trial_rejected'; reason: string } | { status: 'search_delivered' }
}

export interface Phase2C2SearchContextRecord {
  contextId: string
  orientationId: string
  conflictKey: string
  kind: ConflictKind
  fixedTargetWeaponId: string
  targetWeaponId: string
  extent: PlannerAlternativeSearchExtent
  extentLabel: string
  reservation: PlannerAlternativeReservation
  excludedRouteKeys: string[]
  fixedRouteBuildListEntryIds: string[]
  status: Phase2C2SearchStatus
  summary: { deliveredCandidates: number; excludedCandidates: number; exhausted: boolean; stoppedByExtent: boolean; stoppedByConsumer: boolean }
  candidates: Phase2C2CapturedCandidate[]
  /** The kernel's trialled Candidate keys equal the first delivered keys of this post-hoc run (default extent only). */
  kernelTrialPrefixMatches: boolean | null
  elapsedMs: number
}

export function phase2c2SearchStatus(summary: { exhausted: boolean; stoppedByExtent: boolean }, stoppedByConsumer: boolean): Phase2C2SearchStatus {
  if (stoppedByConsumer) return 'consumer_stop'
  if (summary.stoppedByExtent) return 'stopped_by_extent'
  if (summary.exhausted) return 'exhausted'
  throw new Error('A Planner Alternative Search ended with neither a consumer stop, an extent stop nor exhaustion.')
}

export interface Phase2C2ContextInput {
  input: PlannerInput
  origin: ConstrainedSearchOrigin
  orientation: Phase2C2Orientation
  targetWeaponId: string
  extent: PlannerAlternativeSearchExtent
  extentLabel: string
  reservation: PlannerAlternativeReservation
  excludedRouteKeys: readonly string[]
  fixedRouteBuildListEntryIds: readonly string[]
  captureBound: number
  /** The kernel's trial records of this Target (default-extent context only), to mark trialled Candidates. */
  kernelTrials?: Phase2C2KernelTargetRecord['trials']
}

/**
 * The post-hoc portfolio Search of one context: `visitPlannerAlternativeCandidates()` with exactly the given origin,
 * reservation and excluded Route keys, stopped by the consumer at `captureBound` delivered Candidates. Each delivered
 * Candidate is materialized by the Planner Alternative materializer of this very context only to read its Route units.
 */
export async function runPhase2C2SearchContext(context: Phase2C2ContextInput, engine: RngEngine,
  options: { yieldControl?: () => Promise<void>; now?: () => number } = {}): Promise<Phase2C2SearchContextRecord> {
  const now = options.now ?? (() => performance.now())
  const started = now()
  const materializer = createPlannerAlternativeMaterializer({ origin: context.origin, targetWeaponId: context.targetWeaponId as never, extent: context.extent,
    reservation: context.reservation, excludedRouteKeys: context.excludedRouteKeys, clock: { now: () => GLOBAL_RESEARCH_TIME } })
  const trialByKey = new Map((context.kernelTrials ?? []).map(trial => [trial.candidateKey, trial]))
  const candidates: Phase2C2CapturedCandidate[] = []
  const execution = await visitPlannerAlternativeCandidates({ origin: context.origin, targetWeaponId: context.targetWeaponId as never, extent: context.extent,
    reservation: context.reservation, excludedRouteKeys: context.excludedRouteKeys }, engine, (candidate: PlannerAlternativeCandidate) => {
    const stableKey = candidateStableKey(candidate)
    const entry = materializer.materializeBuildListEntry(candidate, []).entry
    const summary = summarizePhase2C2Entry(entry, context.input, engine)
    const trial = trialByKey.get(stableKey)
    candidates.push({ deliveredIndex: candidates.length, stableKey, summary, reservationCheck: respectsPhase2C2Reservation(summary, candidate.route, context.reservation),
      kernel: trial === undefined ? { status: 'search_delivered' } : trial.result === 'found' ? { status: 'kernel_found', generatedSelected: trial.generatedSelected === true }
        : { status: 'kernel_trial_rejected', reason: trial.reason ?? trial.result } })
    return candidates.length >= context.captureBound ? 'stop' : 'continue'
  }, { yieldControl: options.yieldControl })
  const trialKeys = (context.kernelTrials ?? []).map(trial => trial.candidateKey)
  return {
    contextId: `${context.orientation.orientationId}:${context.targetWeaponId}:${context.extentLabel}`,
    orientationId: context.orientation.orientationId, conflictKey: context.orientation.conflictKey, kind: context.orientation.kind,
    fixedTargetWeaponId: context.orientation.fixedTargetWeaponId, targetWeaponId: context.targetWeaponId,
    extent: { ...context.extent }, extentLabel: context.extentLabel,
    reservation: normalizePlannerAlternativeReservation(context.reservation), excludedRouteKeys: normalizePlannerAlternativeExcludedRouteKeys(context.excludedRouteKeys),
    fixedRouteBuildListEntryIds: [...context.fixedRouteBuildListEntryIds],
    status: phase2c2SearchStatus(execution.summary, execution.stoppedByConsumer),
    summary: { ...execution.summary, stoppedByConsumer: execution.stoppedByConsumer },
    candidates,
    kernelTrialPrefixMatches: context.kernelTrials === undefined ? null
      : trialKeys.every((key, index) => candidates[index]?.stableKey === key),
    elapsedMs: now() - started,
  }
}

export interface Phase2C2KernelTargetRecord {
  targetWeaponId: string
  invalidatedBuildListEntryId: string
  invalidatedRouteKey: string
  fixedRouteBuildListEntryIds: string[]
  reservation: PlannerAlternativeReservation | null
  excludedRouteKeys: string[]
  outcome: string
  found: null | { stableKey: string; summary: Phase2C2CandidateSummary; generatedSelected: boolean;
    trialPlan: { completedTargetCount: number; totalTargetCount: number; termination: string; conflicts: number; conflictsByKind: Record<string, number>; planSteps: number | null } }
  trials: { candidateKey: string; result: string; reason: string | null; generatedSelected: boolean | null }[]
  search: null | { deliveredCandidates: number; excludedCandidates: number; exhausted: boolean; stoppedByExtent: boolean; stoppedByConsumer: boolean }
  skippedExcludedRouteKeys: number
}

export interface Phase2C2KernelRecord {
  orientation: Phase2C2Orientation
  conditions: Phase2C2Conditions
  kernel: { status: 'completed'; plannerRerunsUsed: number; explicitDecisionBuildListEntryIds: string[]; targets: Phase2C2KernelTargetRecord[] }
    | { status: 'preparation_failed'; failure: string; detail: string }
  timing: { kernelMs: number }
}

export interface Phase2C2RunDependencies {
  createEngine: () => RngEngine
  yieldControl?: () => Promise<void>
  now?: () => number
  /**
   * Phase 2-C2.6-A2 only: the optional, observational kernel lifecycle instrumentation, passed to the kernel as it is.
   * Absent (every earlier phase), the kernel runs exactly as before.
   */
  kernelInstrumentation?: PlannerAlternativeKernelInstrumentation
}

/** One orientation's current Planner Alternative kernel over the original input, recorded without any change. */
export async function runPhase2C2Kernel(input: PlannerInput, orientation: Phase2C2Orientation, conditions: Phase2C2Conditions,
  dependencies: Phase2C2RunDependencies): Promise<Phase2C2KernelRecord> {
  const now = dependencies.now ?? (() => performance.now())
  const plannerDependencies = globalResearchDependencies(dependencies.createEngine())
  const request = phase2c2KernelRequest(input, orientation, conditions)
  const kernelStarted = now()
  const preparation = preparePlannerAlternativeKernel(request, plannerDependencies)
  if (preparation.status !== 'ready') {
    return { orientation, conditions, kernel: { status: 'preparation_failed', failure: preparation.status, detail: stableStringify(preparation) }, timing: { kernelMs: now() - kernelStarted } }
  }
  const kernel = await runPreparedPlannerAlternativeKernel(preparation.prepared, request, plannerDependencies,
    { executionOptions: { yieldControl: dependencies.yieldControl }, instrumentation: dependencies.kernelInstrumentation })
  const kernelMs = now() - kernelStarted
  const targets: Phase2C2KernelTargetRecord[] = kernel.targets.map(target => {
    const outcome = target.outcome
    let found: Phase2C2KernelTargetRecord['found'] = null
    if (outcome.status === 'found') {
      const trial = outcome.trialResult
      found = { stableKey: candidateStableKey(outcome.candidate), summary: summarizePhase2C2Entry(outcome.generated.entry, input, plannerDependencies.rngEngine),
        generatedSelected: outcome.generatedSelected,
        trialPlan: { completedTargetCount: trial.termination.completedTargetCount, totalTargetCount: trial.termination.totalTargetCount, termination: trial.termination.status,
          conflicts: trial.conflicts.length, conflictsByKind: countBy(trial.conflicts, conflict => conflict.kind), planSteps: trial.plan?.steps.length ?? null } }
    }
    return {
      targetWeaponId: target.targetWeaponId, invalidatedBuildListEntryId: target.invalidatedBuildListEntryId, invalidatedRouteKey: target.invalidatedRouteKey,
      fixedRouteBuildListEntryIds: [...target.fixedRouteBuildListEntryIds], reservation: target.reservation, excludedRouteKeys: [...target.excludedRouteKeys],
      outcome: outcome.status, found,
      trials: target.trials.map(trial => ({ candidateKey: trial.candidateKey, result: trial.result.status,
        reason: trial.result.status === 'rejected' ? trial.result.reason : null, generatedSelected: trial.result.status === 'found' ? trial.result.generatedSelected : null })),
      search: target.search === null ? null : { deliveredCandidates: target.search.deliveredCandidates, excludedCandidates: target.search.excludedCandidates,
        exhausted: target.search.exhausted, stoppedByExtent: target.search.stoppedByExtent, stoppedByConsumer: target.search.stoppedByConsumer },
      skippedExcludedRouteKeys: target.skippedExcludedRouteKeys.length,
    }
  })
  // Sanity: the kernel's non-fixed Targets are exactly the other participants of the baseline Conflict.
  const expected = orientation.participantTargetWeaponIds.filter(id => id !== orientation.fixedTargetWeaponId).sort()
  const actual = targets.map(target => target.targetWeaponId).sort()
  if (stableStringify(expected) !== stableStringify(actual)) {
    throw new Error(`Orientation ${orientation.orientationId}: kernel searched ${actual.join(',')}, the Conflict's other participants are ${expected.join(',')}.`)
  }
  return {
    orientation, conditions,
    kernel: { status: 'completed', plannerRerunsUsed: kernel.plannerRerunsUsed, explicitDecisionBuildListEntryIds: [...kernel.explicitDecisionBuildListEntryIds], targets },
    timing: { kernelMs },
  }
}

/**
 * The post-hoc portfolio Search of one searched Target of a recorded kernel, at `extent` (the kernel's own extent for
 * the `default` context, a Research probe extent otherwise). The kernel's own preparation gives the Planner-start
 * origin again (no kernel run); the recorded fixed Route set gives the reservation again through the Planner authority
 * (`derivePlannerAlternativeReservation()`), which must equal the reservation the kernel recorded; the excluded Route
 * keys are the kernel's. Search only: nothing is trialled or run through the Planner. The kernel's trial records mark
 * trialled Candidates in the default context only.
 */
export async function runPhase2C2PortfolioContext(input: PlannerInput,
  kernelTarget: Pick<Phase2C2KernelTargetRecord, 'targetWeaponId' | 'reservation' | 'excludedRouteKeys' | 'fixedRouteBuildListEntryIds' | 'trials'>,
  orientation: Phase2C2Orientation, conditions: Phase2C2Conditions, extent: PlannerAlternativeSearchExtent, extentLabel: string,
  dependencies: Phase2C2RunDependencies): Promise<Phase2C2SearchContextRecord> {
  if (kernelTarget.reservation === null) throw new Error(`Kernel Target ${kernelTarget.targetWeaponId} was not searched; it has no portfolio context.`)
  const plannerDependencies = globalResearchDependencies(dependencies.createEngine())
  const preparation = preparePlannerAlternativeKernel(phase2c2KernelRequest(input, orientation, conditions), plannerDependencies)
  if (preparation.status !== 'ready') throw new Error(`Portfolio preparation of ${orientation.orientationId} failed: ${preparation.status}`)
  const { entriesById } = preparation.prepared.scenario.initialContext
  const fixed = kernelTarget.fixedRouteBuildListEntryIds.map(id => {
    const entry = entriesById.get(id as never)
    if (!entry) throw new Error(`Recorded fixed Entry ${id} is not a valid Entry of the current input.`)
    return entry
  })
  const reservation = derivePlannerAlternativeReservation(fixed, plannerDependencies.rngEngine)
  if (stableStringify(normalizePlannerAlternativeReservation(reservation)) !== stableStringify(normalizePlannerAlternativeReservation(kernelTarget.reservation))) {
    throw new Error(`Portfolio context of ${orientation.orientationId}/${kernelTarget.targetWeaponId}: the re-derived reservation differs from the recorded kernel reservation.`)
  }
  const kernelTrials = extentLabel === 'default' ? kernelTarget.trials : undefined
  return runPhase2C2SearchContext({ input, origin: preparation.prepared.scenario.origin, orientation, targetWeaponId: kernelTarget.targetWeaponId, extent, extentLabel,
    reservation, excludedRouteKeys: kernelTarget.excludedRouteKeys, fixedRouteBuildListEntryIds: kernelTarget.fixedRouteBuildListEntryIds, captureBound: conditions.captureBound,
    kernelTrials }, dependencies.createEngine(), { yieldControl: dependencies.yieldControl, now: dependencies.now })
}

// ---------------------------------------------------------------- baseline run

export interface Phase2C2BaselineRecord {
  summary: Phase2C2BaselineSummary
  orientations: Phase2C2Orientation[]
  /** Every original Export Entry: its Target, Entry ID, stable key and Route summary. */
  originals: { targetWeaponId: string; buildListEntryId: string; stableKey: string; summary: Phase2C2CandidateSummary }[]
  elapsedMs: number
}

export async function runPhase2C2Baseline(input: PlannerInput, dependencies: Phase2C2RunDependencies): Promise<Phase2C2BaselineRecord> {
  const now = dependencies.now ?? (() => performance.now())
  const started = now()
  const plannerDependencies = globalResearchDependencies(dependencies.createEngine())
  const result = await createProductionPlan(input, plannerDependencies)
  return {
    summary: summarizePhase2C2Baseline(input, result),
    orientations: derivePhase2C2Orientations(input, result.conflicts),
    originals: [...input.buildListEntries].sort((a, b) => a.targetWeaponId < b.targetWeaponId ? -1 : a.targetWeaponId > b.targetWeaponId ? 1 : 0)
      .map(entry => ({ targetWeaponId: entry.targetWeaponId, buildListEntryId: entry.id, stableKey: candidateStableKey(entry.candidateSnapshot),
        summary: summarizePhase2C2Entry(entry, input, plannerDependencies.rngEngine) })),
    elapsedMs: now() - started,
  }
}

// ---------------------------------------------------------------- portfolio

export interface Phase2C2ProvenanceEntry {
  contextId: string
  orientationId: string
  conflictKind: string
  fixedTargetWeaponId: string
  extentLabel: string
  deliveredIndex: number
  kernel: Phase2C2CapturedCandidate['kernel']['status']
  kernelDetail: string | null
  respectsReservation: boolean
}

export interface Phase2C2PortfolioCandidate {
  stableKey: string
  origin: 'original' | 'alternative'
  summary: Phase2C2CandidateSummary
  provenance: Phase2C2ProvenanceEntry[]
  kernelFound: boolean
}

export interface Phase2C2Diversity {
  candidates: number
  alternatives: number
  sourceKinds: number
  distinctOwnedWeaponSources: number
  distinctNewNormalPositions: number
  distinctConversionSkillPositions: number
  distinctRequiredSkillSets: number
  distinctRequiredGogmaSets: number
  heldRoutes: number
  routeKinds: number
  kernelFound: number
}

export function phase2c2Diversity(candidates: readonly Pick<Phase2C2PortfolioCandidate, 'origin' | 'summary' | 'kernelFound'>[]): Phase2C2Diversity {
  const distinct = (values: readonly unknown[]) => new Set(values.map(value => stableStringify(value))).size
  const s = candidates.map(candidate => candidate.summary)
  return {
    candidates: candidates.length,
    alternatives: candidates.filter(candidate => candidate.origin === 'alternative').length,
    sourceKinds: distinct(s.map(summary => summary.sourceKind)),
    distinctOwnedWeaponSources: distinct(s.filter(summary => summary.sourceOwnedWeaponId !== null).map(summary => summary.sourceOwnedWeaponId)),
    distinctNewNormalPositions: distinct(s.filter(summary => summary.sourceKind === 'new_normal').map(summary => [summary.normalCounterId, summary.normalProductionTargetPosition])),
    distinctConversionSkillPositions: distinct(s.filter(summary => summary.conversionSkillPosition !== null).map(summary => summary.conversionSkillPosition)),
    distinctRequiredSkillSets: distinct(s.map(summary => [...(summary.skill?.required ?? [])].sort((a, b) => a - b))),
    distinctRequiredGogmaSets: distinct(s.map(summary => [...(summary.gogma?.required ?? [])].sort((a, b) => a - b))),
    heldRoutes: s.filter(summary => summary.heldRoute).length,
    routeKinds: distinct(s.map(summary => summary.routeKind)),
    kernelFound: candidates.filter(candidate => candidate.kernelFound).length,
  }
}

export interface Phase2C2TargetPortfolio {
  targetWeaponId: string
  conflictParticipant: boolean
  /** Contexts in which this Target was searched (non-fixed side). */
  searchedContexts: string[]
  candidates: Phase2C2PortfolioCandidate[]
  diversity: Phase2C2Diversity
  /** Diversity using only the first k delivered Candidates of each default-extent context (plus the original). */
  diversityByDefaultPrefix: Record<string, Phase2C2Diversity>
  /** Diversity using only default-extent contexts (all captured Candidates). */
  diversityDefaultExtent: Phase2C2Diversity
  has: {
    multipleCandidates: boolean
    sourceAlternative: boolean
    counterPositionAlternative: boolean
    heldRoute: boolean
    /** At least one alternative that respects its context's fixed reservation (no blocked own position, no exclusive weapon). */
    reservationRespectingAlternative: boolean
  }
}

/**
 * The per-Target portfolio: original Candidate + every captured alternative, deduplicated by `candidateStableKey()`
 * within the Target (never by Candidate ID, search run or ordinal), keeping every observing context. The original is
 * never dropped.
 */
export function buildPhase2C2Portfolio(baseline: Pick<Phase2C2BaselineRecord, 'originals' | 'orientations'>, contexts: readonly Phase2C2SearchContextRecord[]): Phase2C2TargetPortfolio[] {
  const participants = new Set(baseline.orientations.flatMap(orientation => orientation.participantTargetWeaponIds))
  const build = (filter: (context: Phase2C2SearchContextRecord) => boolean, prefix: number | null) => {
    const byTarget = new Map<string, Map<string, Phase2C2PortfolioCandidate>>()
    for (const original of baseline.originals) {
      const map = byTarget.get(original.targetWeaponId) ?? new Map<string, Phase2C2PortfolioCandidate>()
      if (map.has(original.stableKey)) throw new Error(`Target ${original.targetWeaponId} holds two original Entries with one stable key.`)
      map.set(original.stableKey, { stableKey: original.stableKey, origin: 'original', summary: original.summary, provenance: [], kernelFound: false })
      byTarget.set(original.targetWeaponId, map)
    }
    for (const context of contexts) {
      if (!filter(context)) continue
      const map = byTarget.get(context.targetWeaponId)
      if (!map) throw new Error(`Context ${context.contextId} searched a Target without an original Entry.`)
      for (const captured of prefix === null ? context.candidates : context.candidates.slice(0, prefix)) {
        const known = map.get(captured.stableKey)
        const provenance: Phase2C2ProvenanceEntry = { contextId: context.contextId, orientationId: context.orientationId, conflictKind: context.kind,
          fixedTargetWeaponId: context.fixedTargetWeaponId, extentLabel: context.extentLabel, deliveredIndex: captured.deliveredIndex, kernel: captured.kernel.status,
          kernelDetail: captured.kernel.status === 'kernel_trial_rejected' ? captured.kernel.reason : captured.kernel.status === 'kernel_found' ? `generatedSelected=${captured.kernel.generatedSelected}` : null,
          respectsReservation: captured.reservationCheck.respects }
        if (known) {
          if (stableStringify(known.summary) !== stableStringify(captured.summary)) throw new Error(`Two Candidates of ${context.targetWeaponId} share a stable key with different summaries.`)
          known.provenance.push(provenance)
          known.kernelFound ||= captured.kernel.status === 'kernel_found'
        } else {
          map.set(captured.stableKey, { stableKey: captured.stableKey, origin: 'alternative', summary: captured.summary, provenance: [provenance], kernelFound: captured.kernel.status === 'kernel_found' })
        }
      }
    }
    return byTarget
  }
  const full = build(() => true, null)
  const defaultOnly = build(context => context.extentLabel === 'default', null)
  const prefixes = Object.fromEntries(PHASE2C2_DIVERSITY_PREFIXES.map(k => [String(k), build(context => context.extentLabel === 'default', k)]))
  return [...full.keys()].sort().map(targetWeaponId => {
    const candidates = [...full.get(targetWeaponId)!.values()]
    const original = candidates.find(candidate => candidate.origin === 'original')!
    const alternatives = candidates.filter(candidate => candidate.origin === 'alternative')
    const requiredCounters = (summary: Phase2C2CandidateSummary) => stableStringify({ normal: [summary.normalCounterId, summary.normalProductionTargetPosition],
      skill: [...(summary.skill?.required ?? [])].sort((a, b) => a - b), gogma: [...(summary.gogma?.required ?? [])].sort((a, b) => a - b) })
    const sourceOf = (summary: Phase2C2CandidateSummary) => stableStringify([summary.sourceKind, summary.sourceOwnedWeaponId, summary.normalCounterId, summary.normalProductionTargetPosition])
    return {
      targetWeaponId, conflictParticipant: participants.has(targetWeaponId),
      searchedContexts: contexts.filter(context => context.targetWeaponId === targetWeaponId).map(context => context.contextId),
      candidates,
      diversity: phase2c2Diversity(candidates),
      diversityByDefaultPrefix: Object.fromEntries(Object.entries(prefixes).map(([k, map]) => [k, phase2c2Diversity([...map.get(targetWeaponId)!.values()])])),
      diversityDefaultExtent: phase2c2Diversity([...defaultOnly.get(targetWeaponId)!.values()]),
      has: {
        multipleCandidates: candidates.length > 1,
        sourceAlternative: alternatives.some(candidate => sourceOf(candidate.summary) !== sourceOf(original.summary)),
        counterPositionAlternative: alternatives.some(candidate => requiredCounters(candidate.summary) !== requiredCounters(original.summary)),
        heldRoute: candidates.some(candidate => candidate.summary.heldRoute),
        reservationRespectingAlternative: alternatives.some(candidate => candidate.provenance.some(entry => entry.respectsReservation)),
      },
    }
  })
}

// ---------------------------------------------------------------- probe scheduling and child processes

export type Phase2C2ProbeDecision =
  | { status: 'probe'; axis: Phase2C2ProbeAxis; extent: PlannerAlternativeSearchExtent }
  | { status: 'skip'; reason: 'capture_bound_filled' | 'exhausted' | 'no_probe_axis_for_kind' | 'grid_exhausted' }

/**
 * Whether a finished context gets the next Research probe: only an extent stop that left the capture bound unfilled,
 * only on the axis of its Conflict kind (`same_owned_weapon_consumed` stays at the default extent), only to the next
 * grid value above its current extent. A failed probe is never passed here: the caller stops that context.
 */
export function phase2c2ProbeDecision(context: Pick<Phase2C2SearchContextRecord, 'kind' | 'status' | 'extent'> & { delivered: number }, captureBound: number,
  grid: Readonly<Record<Phase2C2ProbeAxis, readonly number[]>>): Phase2C2ProbeDecision {
  if (context.status === 'consumer_stop' || context.delivered >= captureBound) return { status: 'skip', reason: 'capture_bound_filled' }
  if (context.status === 'exhausted') return { status: 'skip', reason: 'exhausted' }
  if (!phase2c2NeedsProbe(context.status, context.delivered, captureBound)) return { status: 'skip', reason: 'exhausted' }
  const axis = phase2c2ProbeAxis(context.kind)
  if (axis === null) return { status: 'skip', reason: 'no_probe_axis_for_kind' }
  const extent = phase2c2NextProbeExtent(context.extent, axis, grid)
  return extent === null ? { status: 'skip', reason: 'grid_exhausted' } : { status: 'probe', axis, extent }
}

export type Phase2C2ChildOutcome = 'completed' | 'timeout' | 'out_of_memory' | 'process_failure'

/**
 * How one child process ended. Only a written record of a zero exit is `completed`; a timeout, an out-of-memory
 * death or any other failure is a failure and is never read as "no Candidate".
 */
export function classifyPhase2C2ChildExit(exit: { code: number | null; signal: string | null; timedOut: boolean; stderrTail: string; recordWritten: boolean }): Phase2C2ChildOutcome {
  if (exit.timedOut) return 'timeout'
  if (/JavaScript heap out of memory|Allocation failed|ERR_WORKER_OUT_OF_MEMORY|\bOOM\b/.test(exit.stderrTail)) return 'out_of_memory'
  if (exit.code === 0 && exit.signal === null && exit.recordWritten) return 'completed'
  return 'process_failure'
}
