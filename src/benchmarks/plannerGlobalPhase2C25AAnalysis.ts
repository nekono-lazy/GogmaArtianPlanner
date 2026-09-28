/**
 * Issue #154 Phase 2-C2.5-A: workload selection, pre-search context parity, run classification and post-hoc growth
 * analysis. Research only. Never import from Production.
 *
 * The Phase 2-C2 evidence is read here, and only here (through an explicit runner argument), for exactly four things:
 * whether an orientation's kernel child completed or ran out of memory, the representative workload selection, the
 * pre-search context parity of completed orientations, and a post-hoc comparison with the Search-only results. It is
 * never a Search input: no Counter position, reservation, Candidate, extent or Target order comes from it, and the
 * calculation module (`plannerGlobalPhase2C25A.ts`) never imports this file.
 */
import type { ConflictKind } from '../domain/models/publicTypes'
import { stableStringify } from '../domain/models/publicTypes'
import type { PlannerAlternativeReservation } from '../domain/search'
import type { Phase2C2ChildOutcome } from './plannerGlobalPhase2C2'
import { positionRanges } from './plannerGlobalPhase2C2'
import type { Phase2C25AMemorySample, Phase2C25APreSearchContext, Phase2C25AProgressSnapshot, Phase2C25ASearchRecord, Phase2C25ASearchStatus } from './plannerGlobalPhase2C25A'

// ---------------------------------------------------------------- the Phase 2-C2 evidence view

export type Phase2C25AC2ProcessOutcome = 'completed' | 'out_of_memory' | 'timeout' | 'process_failure'

export interface Phase2C25AC2RangeReservation {
  normal: { counterId: string; held: [number, number][]; blocked: [number, number][] }[]
  skill: { held: [number, number][]; blocked: [number, number][] }
  gogma: { held: [number, number][]; blocked: [number, number][] }
  exclusiveOwnedWeaponIds: string[]
}

export interface Phase2C25AC2KernelTarget {
  targetWeaponId: string
  invalidatedBuildListEntryId: string
  invalidatedRouteKeySha256: string
  fixedRouteBuildListEntryIds: string[]
  reservation: Phase2C25AC2RangeReservation | null
  excludedRouteKeySha256s: string[]
  outcome: string
  firstTrialCandidateKeySha256: string | null
}

export interface Phase2C25AC2Orientation {
  orientationId: string
  conflictIndex: number
  conflictKey: string
  kind: ConflictKind
  participantBuildListEntryIds: string[]
  participantTargetWeaponIds: string[]
  fixedBuildListEntryId: string
  fixedTargetWeaponId: string
  processOutcome: Phase2C25AC2ProcessOutcome
  /** Recorded kernel Targets, in the kernel's order; empty when the kernel child did not complete. */
  kernelTargets: Phase2C25AC2KernelTarget[]
}

export interface Phase2C25AC2EvidenceView {
  measuredHead: string
  exportSha256: string
  orientations: Phase2C25AC2Orientation[]
}

function fail(message: string): never {
  throw new Error(`Phase 2-C2 evidence: ${message}`)
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(`${path} is not an object.`)
  return value as Record<string, unknown>
}

function list(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(`${path} is not an array.`)
  return value
}

function text(value: unknown, path: string): string {
  if (typeof value !== 'string') fail(`${path} is not a string.`)
  return value
}

const PROCESS_OUTCOMES: readonly Phase2C25AC2ProcessOutcome[] = ['completed', 'out_of_memory', 'timeout', 'process_failure']

/**
 * The typed view of the committed Phase 2-C2 evidence JSON (`docs/PLANNER_GLOBAL_PHASE2C2_RESULT.json`). Unknown or
 * malformed fields fail closed; nothing is defaulted.
 */
export function parsePhase2C25AC2Evidence(value: unknown): Phase2C25AC2EvidenceView {
  const root = record(value, 'root')
  const provenance = record(root.provenance, 'provenance')
  const results = new Map(list(record(root.kernel, 'kernel').results, 'kernel.results').map((raw, index) => {
    const result = record(raw, `kernel.results[${index}]`)
    return [text(result.orientationId, `kernel.results[${index}].orientationId`), result] as const
  }))
  const orientations = list(root.orientations, 'orientations').map((raw, index): Phase2C25AC2Orientation => {
    const orientation = record(raw, `orientations[${index}]`)
    const orientationId = text(orientation.orientationId, `orientations[${index}].orientationId`)
    const result = results.get(orientationId) ?? fail(`orientation ${orientationId} has no kernel result.`)
    const outcome = text(record(result.process, `${orientationId}.process`).outcome, `${orientationId}.process.outcome`) as Phase2C25AC2ProcessOutcome
    if (!PROCESS_OUTCOMES.includes(outcome)) fail(`orientation ${orientationId} has an unknown process outcome ${outcome}.`)
    const kernelTargets = list(result.targets ?? [], `${orientationId}.targets`).map((rawTarget, t): Phase2C25AC2KernelTarget => {
      const target = record(rawTarget, `${orientationId}.targets[${t}]`)
      const trials = list(target.trials, `${orientationId}.targets[${t}].trials`)
      return {
        targetWeaponId: text(target.targetWeaponId, 'targetWeaponId'),
        invalidatedBuildListEntryId: text(target.invalidatedBuildListEntryId, 'invalidatedBuildListEntryId'),
        invalidatedRouteKeySha256: text(target.invalidatedRouteKeySha256, 'invalidatedRouteKeySha256'),
        fixedRouteBuildListEntryIds: list(target.fixedRouteBuildListEntryIds, 'fixedRouteBuildListEntryIds').map(id => text(id, 'fixed id')),
        reservation: (target.reservation ?? null) as Phase2C25AC2RangeReservation | null,
        excludedRouteKeySha256s: list(target.excludedRouteKeySha256s, 'excludedRouteKeySha256s').map(key => text(key, 'excluded key')),
        outcome: text(target.outcome, 'outcome'),
        firstTrialCandidateKeySha256: trials.length === 0 ? null : text(record(trials[0], 'trial').candidateKeySha256, 'candidateKeySha256'),
      }
    })
    if (outcome === 'completed' && kernelTargets.length === 0) fail(`completed orientation ${orientationId} records no kernel Target.`)
    if (outcome !== 'completed' && kernelTargets.length !== 0) fail(`failed orientation ${orientationId} records kernel Targets.`)
    return {
      orientationId, conflictIndex: orientation.conflictIndex as number, conflictKey: text(orientation.conflictKey, 'conflictKey'), kind: text(orientation.kind, 'kind') as ConflictKind,
      participantBuildListEntryIds: list(orientation.participantBuildListEntryIds, 'participants').map(id => text(id, 'participant')),
      participantTargetWeaponIds: list(orientation.participantTargetWeaponIds, 'participant Targets').map(id => text(id, 'participant Target')),
      fixedBuildListEntryId: text(orientation.fixedBuildListEntryId, 'fixedBuildListEntryId'), fixedTargetWeaponId: text(orientation.fixedTargetWeaponId, 'fixedTargetWeaponId'),
      processOutcome: outcome, kernelTargets,
    }
  })
  if (results.size !== orientations.length) fail('kernel results and orientations differ in number.')
  return { measuredHead: text(provenance.measuredHead, 'provenance.measuredHead'), exportSha256: text(provenance.exportSha256, 'provenance.exportSha256'), orientations }
}

// ---------------------------------------------------------------- workload selection

export const PHASE2C25A_OOM_REPRESENTATIVE_KINDS: readonly ConflictKind[] = ['same_gogma_counter', 'same_skill_counter', 'same_owned_weapon_consumed']
export const PHASE2C25A_COMPLETED_CONTROL_KINDS: readonly ConflictKind[] = ['same_gogma_counter', 'same_skill_counter', 'same_owned_weapon_consumed', 'same_normal_counter']

export const PHASE2C25A_SELECTION_RULE = 'For each listed Conflict kind, the first orientation, in the Phase 2-C2 baseline order '
  + '(Conflict order, then participant order, i.e. the orientation id order c<conflict>-p<participant>), whose Phase 2-C2 kernel '
  + 'child process outcome is out_of_memory (OOM representatives: same_gogma_counter, same_skill_counter, same_owned_weapon_consumed) '
  + 'or completed (completed controls: same_gogma_counter, same_skill_counter, same_owned_weapon_consumed, same_normal_counter). '
  + 'A kind with no such orientation is recorded as unavailable. Every searchable non-fixed Target of a selected orientation is run.'

export type Phase2C25ARole = 'oom_representative' | 'completed_control'

export interface Phase2C25ASelection {
  rule: string
  selected: { orientationId: string; kind: ConflictKind; role: Phase2C25ARole; c2ProcessOutcome: Phase2C25AC2ProcessOutcome }[]
  unavailable: { kind: ConflictKind; role: Phase2C25ARole }[]
}

/** Deterministic: the same evidence always gives the same selection, and no Target / Entry ID is named in code. */
export function selectPhase2C25AWorkload(view: Pick<Phase2C25AC2EvidenceView, 'orientations'>): Phase2C25ASelection {
  const pick = (kinds: readonly ConflictKind[], outcome: Phase2C25AC2ProcessOutcome, role: Phase2C25ARole) => kinds.map(kind => {
    const found = view.orientations.find(orientation => orientation.kind === kind && orientation.processOutcome === outcome)
    return found ? { selected: { orientationId: found.orientationId, kind, role, c2ProcessOutcome: outcome } } : { unavailable: { kind, role } }
  })
  const all = [...pick(PHASE2C25A_OOM_REPRESENTATIVE_KINDS, 'out_of_memory', 'oom_representative'), ...pick(PHASE2C25A_COMPLETED_CONTROL_KINDS, 'completed', 'completed_control')]
  return {
    rule: PHASE2C25A_SELECTION_RULE,
    selected: all.flatMap(item => 'selected' in item && item.selected ? [item.selected] : []),
    unavailable: all.flatMap(item => 'unavailable' in item && item.unavailable ? [item.unavailable] : []),
  }
}

// ---------------------------------------------------------------- parity

export interface Phase2C25AOrientationIdentity {
  orientationId: string
  conflictKey: string
  kind: string
  participantBuildListEntryIds: readonly string[]
  participantTargetWeaponIds: readonly string[]
  fixedBuildListEntryId: string
  fixedTargetWeaponId: string
}

/** This run's own baseline orientations against the Phase 2-C2 ones: every identity field, in the same order. */
export function comparePhase2C25AOrientations(current: readonly Phase2C25AOrientationIdentity[], c2: readonly Phase2C25AOrientationIdentity[]) {
  const identity = (orientation: Phase2C25AOrientationIdentity) => stableStringify({ orientationId: orientation.orientationId, conflictKey: orientation.conflictKey, kind: orientation.kind,
    participantBuildListEntryIds: orientation.participantBuildListEntryIds, participantTargetWeaponIds: orientation.participantTargetWeaponIds,
    fixedBuildListEntryId: orientation.fixedBuildListEntryId, fixedTargetWeaponId: orientation.fixedTargetWeaponId })
  const mismatches = current.length !== c2.length ? [`count ${current.length} != ${c2.length}`]
    : current.flatMap((orientation, index) => identity(orientation) === identity(c2[index]) ? [] : [orientation.orientationId])
  return { matches: mismatches.length === 0, compared: current.length, mismatches }
}

function rangeReservation(reservation: PlannerAlternativeReservation | Phase2C25AC2RangeReservation, alreadyRanges: boolean): Phase2C25AC2RangeReservation {
  const ranges = (values: readonly number[] | readonly [number, number][]) => alreadyRanges
    ? positionRanges((values as [number, number][]).flatMap(([from, to]) => Array.from({ length: to - from + 1 }, (_, i) => from + i)))
    : positionRanges(values as number[])
  return {
    normal: reservation.normal.map(entry => ({ counterId: entry.counterId as string, held: ranges(entry.held as never), blocked: ranges(entry.blocked as never) }))
      .filter(entry => entry.held.length > 0 || entry.blocked.length > 0)
      .sort((left, right) => left.counterId < right.counterId ? -1 : left.counterId > right.counterId ? 1 : 0),
    skill: { held: ranges(reservation.skill.held as never), blocked: ranges(reservation.skill.blocked as never) },
    gogma: { held: ranges(reservation.gogma.held as never), blocked: ranges(reservation.gogma.blocked as never) },
    exclusiveOwnedWeaponIds: [...reservation.exclusiveOwnedWeaponIds].map(id => id as string).sort(),
  }
}

export interface Phase2C25AContextParityRow {
  orientationId: string
  workIndex: number
  targetWeaponId: string
  checks: Record<'targetWeaponId' | 'invalidatedBuildListEntryId' | 'invalidatedRouteKey' | 'fixedRouteBuildListEntryIds' | 'reservation' | 'excludedRouteKeys', boolean>
  matches: boolean
}

/**
 * The re-derived pre-search contexts of one completed Phase 2-C2 orientation against the kernel Targets that run
 * recorded: Target (in order), invalidated Entry, invalidated Route key and excluded Route keys (as SHA-256), fixed
 * Route set, and reservation (as position ranges, empty Normal entries dropped). Any mismatch invalidates the formal
 * OOM comparison.
 */
export function comparePhase2C25AContextParity(contexts: readonly Pick<Phase2C25APreSearchContext, 'orientationId' | 'workIndex' | 'targetWeaponId' | 'invalidatedBuildListEntryId' | 'invalidatedRouteKey' | 'fixedRouteBuildListEntryIds' | 'reservation' | 'excludedRouteKeys'>[],
  kernelTargets: readonly Phase2C25AC2KernelTarget[], sha256: (value: string) => string): { matches: boolean; rows: Phase2C25AContextParityRow[]; countMatches: boolean } {
  const countMatches = contexts.length === kernelTargets.length
  const rows = contexts.map((context, index): Phase2C25AContextParityRow => {
    const kernel = kernelTargets[index]
    const checks = kernel === undefined
      ? { targetWeaponId: false, invalidatedBuildListEntryId: false, invalidatedRouteKey: false, fixedRouteBuildListEntryIds: false, reservation: false, excludedRouteKeys: false }
      : {
          targetWeaponId: context.targetWeaponId === kernel.targetWeaponId,
          invalidatedBuildListEntryId: context.invalidatedBuildListEntryId === kernel.invalidatedBuildListEntryId,
          invalidatedRouteKey: sha256(context.invalidatedRouteKey) === kernel.invalidatedRouteKeySha256,
          fixedRouteBuildListEntryIds: stableStringify(context.fixedRouteBuildListEntryIds) === stableStringify(kernel.fixedRouteBuildListEntryIds),
          reservation: (context.reservation === null) === (kernel.reservation === null) && (context.reservation === null
            || stableStringify(rangeReservation(context.reservation, false)) === stableStringify(rangeReservation(kernel.reservation!, true))),
          excludedRouteKeys: stableStringify(context.excludedRouteKeys.map(sha256)) === stableStringify(kernel.excludedRouteKeySha256s),
        }
    return { orientationId: context.orientationId, workIndex: context.workIndex, targetWeaponId: context.targetWeaponId, checks, matches: Object.values(checks).every(Boolean) }
  })
  return { matches: countMatches && rows.every(row => row.matches), rows, countMatches }
}

// ---------------------------------------------------------------- run classification

export type Phase2C25ARunStatus = Phase2C25ASearchStatus | 'out_of_memory' | 'timeout' | 'process_failure'

const NORMAL_STATUSES: readonly Phase2C25ARunStatus[] = ['first_candidate', 'stopped_by_extent_before_candidate', 'exhausted_before_candidate']

/** One Search-only child: a completed child reports its Search status; a failed child is its failure, never "no Candidate". */
export function phase2c25aRunStatus(outcome: Phase2C2ChildOutcome, finalRecord: { status: Phase2C25ASearchStatus } | null): Phase2C25ARunStatus {
  if (outcome === 'completed') {
    if (finalRecord === null) throw new Error('A completed child without a final record.')
    return finalRecord.status
  }
  return outcome
}

export type Phase2C25ATargetClassification =
  | 'search_only_oom_reproduced'
  | 'instrumentation_contamination'
  | 'no_oom'
  | 'observer_semantic_mismatch'
  | 'inconsistent_modes'
  | 'inconclusive'

/**
 * The two modes of one context. Both OOM: Search alone reproduces the OOM. Minimal normal but instrumented OOM: the
 * observer contaminated the measurement. Both normal: they must agree on the Search semantics (status, summary, first
 * Candidate key). A timeout or other process failure is inconclusive, never a normal termination.
 */
export function phase2c25aTargetClassification(minimal: { status: Phase2C25ARunStatus; semanticDigest: string | null },
  instrumented: { status: Phase2C25ARunStatus; semanticDigest: string | null }): Phase2C25ATargetClassification {
  const normal = (status: Phase2C25ARunStatus) => NORMAL_STATUSES.includes(status)
  if ([minimal.status, instrumented.status].some(status => status === 'timeout' || status === 'process_failure')) return 'inconclusive'
  if (minimal.status === 'out_of_memory' && instrumented.status === 'out_of_memory') return 'search_only_oom_reproduced'
  if (normal(minimal.status) && instrumented.status === 'out_of_memory') return 'instrumentation_contamination'
  if (minimal.status === 'out_of_memory' && normal(instrumented.status)) return 'inconsistent_modes'
  if (minimal.semanticDigest === null || instrumented.semanticDigest === null) throw new Error('A normal termination without a semantic digest.')
  return minimal.semanticDigest === instrumented.semanticDigest ? 'no_oom' : 'observer_semantic_mismatch'
}

export type Phase2C25AOrientationClassification =
  | 'search_localized'
  | 'not_reproduced_in_first_candidate_search'
  | 'measurement_contaminated'
  | 'inconclusive'
  | 'control_completed'
  | 'control_anomaly'

/**
 * A Phase 2-C2 OOM orientation is Search-localized when at least one searchable Target reproduces the OOM in both
 * modes; not reproduced when every searchable Target ends normally in both modes with equal semantics; contaminated
 * when the observer made a difference and nothing reproduced. A completed control must end normally everywhere.
 */
export function phase2c25aOrientationClassification(role: Phase2C25ARole, targets: readonly Phase2C25ATargetClassification[]): Phase2C25AOrientationClassification {
  if (role === 'completed_control') return targets.length > 0 && targets.every(target => target === 'no_oom') ? 'control_completed' : 'control_anomaly'
  if (targets.length === 0) return 'inconclusive'
  if (targets.includes('search_only_oom_reproduced')) return 'search_localized'
  if (targets.some(target => target === 'instrumentation_contamination' || target === 'observer_semantic_mismatch')) return 'measurement_contaminated'
  if (targets.every(target => target === 'no_oom')) return 'not_reproduced_in_first_candidate_search'
  return 'inconclusive'
}

// ---------------------------------------------------------------- growth analysis

export type Phase2C25ACompactSnapshot = Omit<Phase2C25AProgressSnapshot, 'skillDepths' | 'gogmaDepths'>

export function compactPhase2C25ASnapshot(snapshot: Phase2C25AProgressSnapshot): Phase2C25ACompactSnapshot {
  const { skillDepths: _skill, gogmaDepths: _gogma, ...compact } = snapshot
  void _skill
  void _gogma
  return compact
}

function pearson(xs: readonly number[], ys: readonly number[]): number | null {
  if (xs.length < 3) return null
  const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length
  const mx = mean(xs), my = mean(ys)
  let sxy = 0, sxx = 0, syy = 0
  for (let i = 0; i < xs.length; i += 1) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2 }
  return sxx === 0 || syy === 0 ? null : sxy / Math.sqrt(sxx * syy)
}

export interface Phase2C25AGrowthSummary {
  snapshots: number
  lastSnapshot: {
    seq: number
    trigger: string
    elapsedMs: number
    settledWorkItems: number
    lastEvent: Phase2C25AProgressSnapshot['lastEvent']
    maxDepth: { skill: number; gogma: number }
    streams: { skill: number; gogma: number }
    cumulative: Phase2C25AProgressSnapshot['cumulative']
    predictionCounts: Phase2C25AProgressSnapshot['predictionCounts']
    memory: Phase2C25AMemorySample
    sampledMax: Phase2C25AMemorySample
  }
  gogma: {
    reachedDepths: number
    maxDepth: number
    maxGeneratedStatesPerDepth: number
    depthOfMaxGeneratedStates: number | null
    maxFrontierStatesPerDepth: number
    maxFamilyLayoutsPerDepth: number
    maxAbsolutePositionsPerDepth: number
    /**
     * Sum over reached depths of `depth x generatedStates`: the total own-amendment history length of every generated
     * state. A descriptive proxy computed from the existing per-depth aggregates, never an allocation measurement.
     */
    depthWeightedGeneratedStates: number
    /** `[depth, generatedStates, frontierStates, familyLayouts, absolutePositions, streams]` per reached depth. */
    perDepth: [number, number, number, number, number, number][]
  }
  skill: {
    reachedDepths: number
    maxDepth: number
    /** `[depth, transitions, states, absolutePositions, streams]` per reached depth. */
    perDepth: [number, number, number, number, number][]
  }
  /** `[elapsedMs, heapUsed, rss, cumulative Gogma generated, cumulative Gogma frontier, Gogma max depth, cumulative Skill states, settled work]`. */
  series: [number, number, number, number, number, number, number, number][]
  /** Descriptive only: a correlation over the sampled series is not a proof that these states hold the heap. */
  heapVersusStates: {
    correlationOnly: true
    pearsonHeapUsedVsCumulativeGogmaGenerated: number | null
    pearsonHeapUsedVsCumulativeGogmaFrontier: number | null
    heapUsedDeltaBytes: number
    cumulativeGogmaGeneratedDelta: number
    heapUsedDeltaPerGeneratedStateBytes: number | null
  }
}

function depthWeightedGeneratedStates(depths: readonly { depth: number; generatedStates: number }[]): number {
  return depths.reduce((sum, depth) => sum + depth.depth * depth.generatedStates, 0)
}

/** The growth of one instrumented run up to its last received snapshot (the last one before the process died, for an OOM). */
export function phase2c25aGrowthSummary(series: readonly Phase2C25ACompactSnapshot[], lastFull: Phase2C25AProgressSnapshot): Phase2C25AGrowthSummary {
  const gogmaDepths = lastFull.gogmaDepths
  const skillDepths = lastFull.skillDepths
  const maxBy = <T>(values: readonly T[], key: (value: T) => number) => values.reduce((max, value) => Math.max(max, key(value)), 0)
  const maxGenerated = maxBy(gogmaDepths, depth => depth.generatedStates)
  const rows = series.map((snapshot): Phase2C25AGrowthSummary['series'][number] => [Math.round(snapshot.elapsedMs), snapshot.memory.heapUsed, snapshot.memory.rss,
    snapshot.cumulative.totalGogmaGeneratedStates, snapshot.cumulative.totalGogmaFrontierStates, snapshot.maxDepth.gogma, snapshot.cumulative.totalSkillStates, snapshot.settledWorkItems])
  const first = series[0]
  const heapUsedDeltaBytes = first === undefined ? 0 : lastFull.memory.heapUsed - first.memory.heapUsed
  const cumulativeGogmaGeneratedDelta = first === undefined ? 0 : lastFull.cumulative.totalGogmaGeneratedStates - first.cumulative.totalGogmaGeneratedStates
  return {
    snapshots: series.length,
    lastSnapshot: { seq: lastFull.seq, trigger: lastFull.trigger, elapsedMs: lastFull.elapsedMs, settledWorkItems: lastFull.settledWorkItems, lastEvent: lastFull.lastEvent,
      maxDepth: lastFull.maxDepth, streams: lastFull.streams, cumulative: lastFull.cumulative, predictionCounts: lastFull.predictionCounts, memory: lastFull.memory, sampledMax: lastFull.sampledMax },
    gogma: {
      reachedDepths: gogmaDepths.length, maxDepth: lastFull.maxDepth.gogma, maxGeneratedStatesPerDepth: maxGenerated,
      depthOfMaxGeneratedStates: gogmaDepths.find(depth => depth.generatedStates === maxGenerated)?.depth ?? null,
      maxFrontierStatesPerDepth: maxBy(gogmaDepths, depth => depth.frontierStates), maxFamilyLayoutsPerDepth: maxBy(gogmaDepths, depth => depth.familyLayouts),
      maxAbsolutePositionsPerDepth: maxBy(gogmaDepths, depth => depth.absolutePositions),
      depthWeightedGeneratedStates: depthWeightedGeneratedStates(gogmaDepths),
      perDepth: gogmaDepths.map(depth => [depth.depth, depth.generatedStates, depth.frontierStates, depth.familyLayouts, depth.absolutePositions, depth.streams]),
    },
    skill: { reachedDepths: skillDepths.length, maxDepth: lastFull.maxDepth.skill,
      perDepth: skillDepths.map(depth => [depth.depth, depth.transitions, depth.states, depth.absolutePositions, depth.streams]) },
    series: rows,
    heapVersusStates: {
      correlationOnly: true,
      pearsonHeapUsedVsCumulativeGogmaGenerated: pearson(rows.map(row => row[1]), rows.map(row => row[3])),
      pearsonHeapUsedVsCumulativeGogmaFrontier: pearson(rows.map(row => row[1]), rows.map(row => row[4])),
      heapUsedDeltaBytes, cumulativeGogmaGeneratedDelta,
      heapUsedDeltaPerGeneratedStateBytes: cumulativeGogmaGeneratedDelta > 0 ? heapUsedDeltaBytes / cumulativeGogmaGeneratedDelta : null,
    },
  }
}

export interface Phase2C25AComparableMetrics {
  gogmaMaxDepth: number
  cumulativeGogmaGenerated: number
  cumulativeGogmaFrontier: number
  maxGogmaGeneratedPerDepth: number
  maxGogmaFrontierPerDepth: number
  maxGogmaFamilyLayoutsPerDepth: number
  gogmaDepthWeightedGeneratedStates: number
  skillMaxDepth: number
  cumulativeSkillStates: number
  settledWorkItems: number
  predictionCalls: number
  resetBonuses: number
  keepBonuses: number
  predictSkills: number
  sampledMaxHeapUsed: number
  sampledMaxRss: number
}

export function phase2c25aComparableMetrics(snapshot: Phase2C25AProgressSnapshot): Phase2C25AComparableMetrics {
  const maxBy = <T>(values: readonly T[], key: (value: T) => number) => values.reduce((max, value) => Math.max(max, key(value)), 0)
  const p = snapshot.predictionCounts
  return {
    gogmaMaxDepth: snapshot.maxDepth.gogma, cumulativeGogmaGenerated: snapshot.cumulative.totalGogmaGeneratedStates, cumulativeGogmaFrontier: snapshot.cumulative.totalGogmaFrontierStates,
    maxGogmaGeneratedPerDepth: maxBy(snapshot.gogmaDepths, depth => depth.generatedStates), maxGogmaFrontierPerDepth: maxBy(snapshot.gogmaDepths, depth => depth.frontierStates),
    maxGogmaFamilyLayoutsPerDepth: maxBy(snapshot.gogmaDepths, depth => depth.familyLayouts),
    gogmaDepthWeightedGeneratedStates: depthWeightedGeneratedStates(snapshot.gogmaDepths),
    skillMaxDepth: snapshot.maxDepth.skill, cumulativeSkillStates: snapshot.cumulative.totalSkillStates, settledWorkItems: snapshot.settledWorkItems,
    predictionCalls: p.predictNormalArtian + p.predictSkills + p.resetBonuses + p.keepBonuses, resetBonuses: p.resetBonuses, keepBonuses: p.keepBonuses, predictSkills: p.predictSkills,
    sampledMaxHeapUsed: snapshot.sampledMax.heapUsed, sampledMaxRss: snapshot.sampledMax.rss,
  }
}

/**
 * One OOM context's last-snapshot metrics against the largest value any completed control reached: the ratio and its
 * order of magnitude per metric (`null` when the control maximum is 0).
 */
export function comparePhase2C25AWithControls(oom: Phase2C25AComparableMetrics, controls: readonly Phase2C25AComparableMetrics[]) {
  const keys = Object.keys(oom) as (keyof Phase2C25AComparableMetrics)[]
  return Object.fromEntries(keys.map(key => {
    const controlMax = controls.reduce((max, control) => Math.max(max, control[key]), 0)
    const ratio = controlMax === 0 ? null : oom[key] / controlMax
    return [key, { oomLastSnapshot: oom[key], controlMax, ratio, log10Ratio: ratio === null || ratio <= 0 ? null : Math.log10(ratio) }]
  })) as Record<keyof Phase2C25AComparableMetrics, { oomLastSnapshot: number; controlMax: number; ratio: number | null; log10Ratio: number | null }>
}

// ---------------------------------------------------------------- parent-side run collection

export interface Phase2C25ACollectedRun {
  status: Phase2C25ARunStatus
  childOutcome: Phase2C2ChildOutcome
  ready: Record<string, unknown> | null
  final: Record<string, unknown> | null
  snapshots: number
  compactSnapshots: Phase2C25ACompactSnapshot[]
  /** The last snapshot the parent received: for an OOM child, the last one before the process died. */
  lastSnapshot: Phase2C25AProgressSnapshot | null
}

/**
 * The parent side of one Search-only child: it keeps every received snapshot (compact) and the last full one, so a
 * child that dies without a final record still leaves its progress. The child outcome decides the status; a failure is
 * never turned into an empty or "no Candidate" result.
 */
export function createPhase2C25ARunCollector() {
  let ready: Record<string, unknown> | null = null
  let final: Record<string, unknown> | null = null
  const compact: Phase2C25ACompactSnapshot[] = []
  let lastSnapshot: Phase2C25AProgressSnapshot | null = null
  return {
    onMessage(message: unknown): Phase2C25AProgressSnapshot | null {
      if (typeof message !== 'object' || message === null) throw new Error('A child sent a non-object message.')
      const typed = message as { type?: string; snapshot?: Phase2C25AProgressSnapshot }
      if (typed.type === 'ready') ready = typed as Record<string, unknown>
      else if (typed.type === 'final') final = typed as Record<string, unknown>
      else if (typed.type === 'snapshot' && typed.snapshot) {
        compact.push(compactPhase2C25ASnapshot(typed.snapshot))
        lastSnapshot = typed.snapshot
        return typed.snapshot
      } else throw new Error(`A child sent an unknown message type ${String(typed.type)}.`)
      return null
    },
    hasFinal: () => final !== null,
    finish(childOutcome: Phase2C2ChildOutcome): Phase2C25ACollectedRun {
      const record = final === null ? null : (final as { record: { status: Phase2C25ASearchStatus } }).record
      return { status: phase2c25aRunStatus(childOutcome, record), childOutcome, ready, final, snapshots: compact.length, compactSnapshots: [...compact], lastSnapshot }
    },
  }
}

/** The last V8 GC lines of a fatal heap trace (stderr): V8's own numbers at the process death, not a sampled value. */
export function parsePhase2C25AV8FatalGcTrace(stderr: string | null): null | { lastGc: { atMs: number; kind: string; beforeMb: number; beforeCommittedMb: number; afterMb: number; afterCommittedMb: number }; fatal: boolean } {
  if (stderr === null) return null
  const matches = [...stderr.matchAll(/(\d+) ms: (Mark-Compact(?: \(reduce\))?|Scavenge(?: \(interleaved\))?)\s+([\d.]+) \(([\d.]+)\) -> ([\d.]+) \(([\d.]+)\) MB/g)]
  const last = matches.at(-1)
  if (!last) return null
  return { lastGc: { atMs: Number(last[1]), kind: last[2], beforeMb: Number(last[3]), beforeCommittedMb: Number(last[4]), afterMb: Number(last[5]), afterCommittedMb: Number(last[6]) },
    fatal: /heap out of memory/.test(stderr) }
}

// ---------------------------------------------------------------- post-hoc analysis of one raw run

/** The Search-semantic part of a final record, which must be equal between the two modes of one context. */
export function phase2c25aSemanticDigest(record: Pick<Phase2C25ASearchRecord, 'status' | 'searchSummary' | 'firstCandidateKey'>): string {
  return stableStringify({ status: record.status, summary: record.searchSummary, firstCandidateKey: record.firstCandidateKey })
}

interface RawMode {
  process: { outcome: Phase2C2ChildOutcome; wallMs: number; exitCode: number | null; signal: string | null; timedOut: boolean; stderrTail: string | null }
  status: Phase2C25ARunStatus
  ready: { preparationMs: number; preSearchMemory: Phase2C25AMemorySample; heapSizeLimitBytes: number } | null
  final: null | { record: Phase2C25ASearchRecord & { firstCandidateKeySha256: string | null }; postSearchMemory: Phase2C25AMemorySample; maxRssKiB: number }
  snapshots: number
  compactSnapshots: Phase2C25ACompactSnapshot[]
  lastSnapshot: Phase2C25AProgressSnapshot | null
  arrival: { readyAtMs: number | null; firstSnapshotAtMs: number | null; lastSnapshotAtMs: number | null }
}

export interface Phase2C25ARawRun {
  runs: { orientationId: string; role: Phase2C25ARole; kind: ConflictKind; workIndex: number; targetWeaponId: string; contextDigest: string; modes: Record<'minimal' | 'instrumented', RawMode> }[]
  selection: Phase2C25ASelection & { selectedRun: Phase2C25ASelection['selected'] }
}

function summarizeFirstCandidate(summary: Phase2C25ASearchRecord['firstCandidateSummary']) {
  if (summary === null) return null
  return { routeKind: summary.routeKind, sourceKind: summary.sourceKind, estimatedOperationCount: summary.estimatedOperationCount, ownOperationCount: summary.ownOperationCount,
    operationTypes: summary.operationTypes, estimatedAdvances: summary.estimatedAdvances, normalProductionTargetPosition: summary.normalProductionTargetPosition,
    conversionSkillPosition: summary.conversionSkillPosition, gogmaTypeRuns: summary.gogmaTypeRuns,
    skill: summary.skill && { first: summary.skill.first, last: summary.skill.last, operations: summary.skill.operations }, heldRoute: summary.heldRoute }
}

function modeView(mode: RawMode) {
  const record = mode.final?.record ?? null
  return {
    status: mode.status, childOutcome: mode.process.outcome, wallMs: mode.process.wallMs, exitCode: mode.process.exitCode,
    preparationMs: mode.ready?.preparationMs ?? null, preSearchMemory: mode.ready?.preSearchMemory ?? null, heapSizeLimitBytes: mode.ready?.heapSizeLimitBytes ?? null,
    searchElapsedMs: record?.elapsedMs ?? null, timeToFirstMs: record?.timeToFirstMs ?? null, searchSummary: record?.searchSummary ?? null,
    firstCandidateKeySha256: record?.firstCandidateKeySha256 ?? null, firstCandidate: summarizeFirstCandidate(record?.firstCandidateSummary ?? null),
    predictionCounts: record?.predictionCounts ?? null, predictionCountsAtFirstCandidate: record?.predictionCountsAtFirstCandidate ?? null,
    postSearchMemory: mode.final?.postSearchMemory ?? null, maxRssKiB: mode.final?.maxRssKiB ?? null,
    snapshots: mode.snapshots, arrival: mode.arrival,
    v8FatalGc: mode.process.outcome === 'out_of_memory' ? parsePhase2C25AV8FatalGcTrace(mode.process.stderrTail) : null,
  }
}

/**
 * The formal classification of one raw run, post-hoc: per context the two modes and their classification, per
 * orientation its classification, the growth up to the last snapshot of every instrumented run, and the comparison of
 * every Search-only OOM with the completed controls. The Phase 2-C2 view is used only for the post-hoc kernel
 * comparison (the kernel's first trialled Candidate against the Search-only first Candidate).
 */
export function analyzePhase2C25ARun(raw: Phase2C25ARawRun, view: Pick<Phase2C25AC2EvidenceView, 'orientations'>) {
  const c2Of = new Map(view.orientations.map(orientation => [orientation.orientationId, orientation]))
  const digest = (mode: RawMode) => mode.final === null ? null : phase2c25aSemanticDigest(mode.final.record)
  const contexts = raw.runs.map(run => {
    const minimal = run.modes.minimal, instrumented = run.modes.instrumented
    const classification = phase2c25aTargetClassification({ status: minimal.status, semanticDigest: digest(minimal) }, { status: instrumented.status, semanticDigest: digest(instrumented) })
    const kernelTarget = c2Of.get(run.orientationId)?.kernelTargets.find(target => target.targetWeaponId === run.targetWeaponId) ?? null
    const searchFirst = minimal.final?.record.firstCandidateKeySha256 ?? null
    return {
      orientationId: run.orientationId, role: run.role, kind: run.kind, workIndex: run.workIndex, targetWeaponId: run.targetWeaponId,
      minimal: modeView(minimal), instrumented: modeView(instrumented), classification,
      semanticParity: digest(minimal) !== null && digest(instrumented) !== null ? digest(minimal) === digest(instrumented) : null,
      c2KernelPostHoc: kernelTarget === null ? null : { kernelOutcome: kernelTarget.outcome, kernelFirstTrialCandidateKeySha256: kernelTarget.firstTrialCandidateKeySha256,
        searchOnlyFirstCandidateMatchesKernelFirstTrial: kernelTarget.firstTrialCandidateKeySha256 === null || searchFirst === null ? null : kernelTarget.firstTrialCandidateKeySha256 === searchFirst },
      growth: instrumented.lastSnapshot === null ? null : phase2c25aGrowthSummary(instrumented.compactSnapshots, instrumented.lastSnapshot),
      metrics: instrumented.lastSnapshot === null ? null : phase2c25aComparableMetrics(instrumented.lastSnapshot),
    }
  })
  const orientations = raw.selection.selectedRun.map(item => {
    const rows = contexts.filter(context => context.orientationId === item.orientationId)
    const c2 = c2Of.get(item.orientationId)
    return {
      orientationId: item.orientationId, role: item.role, kind: item.kind, c2ProcessOutcome: item.c2ProcessOutcome,
      participants: c2?.participantTargetWeaponIds.length ?? null, searchedContexts: rows.length,
      classification: phase2c25aOrientationClassification(item.role, rows.map(row => row.classification)),
      targetClassifications: rows.map(row => ({ workIndex: row.workIndex, targetWeaponId: row.targetWeaponId, classification: row.classification })),
      contaminatedContexts: rows.filter(row => row.classification === 'instrumentation_contamination').length,
    }
  })
  const controls = contexts.filter(context => context.role === 'completed_control' && context.classification === 'no_oom' && context.metrics !== null)
  const controlMetrics = controls.map(context => context.metrics as Phase2C25AComparableMetrics)
  const oomContexts = contexts.filter(context => context.classification === 'search_only_oom_reproduced')
  const count = (values: readonly string[]) => values.reduce<Record<string, number>>((out, value) => ({ ...out, [value]: (out[value] ?? 0) + 1 }), {})
  const statuses = contexts.flatMap(context => [context.minimal.status, context.instrumented.status])
  return {
    totals: {
      selectedOrientations: orientations.length, contexts: contexts.length,
      minimalOutcomes: count(contexts.map(context => context.minimal.status)), instrumentedOutcomes: count(contexts.map(context => context.instrumented.status)),
      targetClassifications: count(contexts.map(context => context.classification)), orientationClassifications: count(orientations.map(orientation => orientation.classification)),
      searchOnlyOomContexts: oomContexts.length,
      instrumentationContamination: contexts.filter(context => context.classification === 'instrumentation_contamination').length,
      searchLocalizedOrientations: orientations.filter(orientation => orientation.classification === 'search_localized').length,
      notReproducedOrientations: orientations.filter(orientation => orientation.classification === 'not_reproduced_in_first_candidate_search').length,
      timeouts: statuses.filter(status => status === 'timeout').length,
      processFailures: statuses.filter(status => status === 'process_failure').length,
    },
    orientations,
    contexts,
    controlComparison: {
      controls: controls.map(context => ({ orientationId: context.orientationId, targetWeaponId: context.targetWeaponId, metrics: context.metrics,
        instrumentedTimeToFirstMs: context.instrumented.timeToFirstMs, minimalTimeToFirstMs: context.minimal.timeToFirstMs })),
      oom: oomContexts.map(context => ({ orientationId: context.orientationId, targetWeaponId: context.targetWeaponId,
        versusControls: context.metrics === null ? null : comparePhase2C25AWithControls(context.metrics, controlMetrics) })),
    },
  }
}
