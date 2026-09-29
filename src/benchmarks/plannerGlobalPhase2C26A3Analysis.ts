/**
 * Issue #154 Phase 2-C2.6-A3: post-hoc analysis of one raw held-aware Gogma runtime localization run, Research only.
 * Never import from Production.
 *
 * Nothing here runs a Planner or a Search. The raw run is read as untrusted JSON. Section wall times are the Research
 * child's own `now()` differences between the boundaries the held-aware Gogma stream reported; they are mutually exclusive
 * (one section at a time, never nested), so they are summed without double counting. The inclusive depth time
 * (`depth_started` -> `depth_completed`) is kept apart and never added to a section total.
 *
 * Observation point. For the primary Search (Target ordinal 0) the coverage is computed at one instant: the kernel's
 * `search_completed` for a finished Search, otherwise the last heartbeat, which carries the cumulative completed-section
 * totals and the active section's elapsed time measured at the same `now()`. What follows the last heartbeat is reported
 * as unobserved; the active section at the kill is read from the last durable section-start record.
 */
import { stableStringify } from '../domain/models/publicTypes'
import type { Phase2C2Orientation } from './plannerGlobalPhase2C2'
import {
  validatePhase2C26A2BaselineParity,
  type Phase2C26A2Authority,
  type Phase2C26A2RunConditions,
} from './plannerGlobalPhase2C26A2'
import { analyzePhase2C26A2Kernel } from './plannerGlobalPhase2C26A2Analysis'
import {
  PHASE2C26A3_CHILD_HEAP_MB,
  PHASE2C26A3_CONCURRENCY,
  PHASE2C26A3_COVERAGE_THRESHOLD,
  PHASE2C26A3_HEARTBEAT_INTERVAL_MS,
  PHASE2C26A3_ORIENTATION_BUDGET_MS,
  PHASE2C26A3_PHASES,
  PHASE2C26A3_REGISTERED_PRIMARY_COUNT,
  validatePhase2C26A3ConditionParity,
  validatePhase2C26A3Selection,
  type Phase2C26A3A2Authority,
  type Phase2C26A3Phase,
  type Phase2C26A3PhaseTotals,
} from './plannerGlobalPhase2C26A3'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const zeroTotals = (): Phase2C26A3PhaseTotals => Object.fromEntries(PHASE2C26A3_PHASES.map(phase => [phase, 0])) as Phase2C26A3PhaseTotals
const sumTotals = (totals: Phase2C26A3PhaseTotals) => PHASE2C26A3_PHASES.reduce((sum, phase) => sum + totals[phase], 0)
const round = (value: number | null, digits = 4) => (value === null ? null : Number(value.toFixed(digits)))

function distribution(values: readonly number[]) {
  if (values.length === 0) return { count: 0, min: null, median: null, max: null, total: 0 }
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return { count: sorted.length, min: sorted[0], median: sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2, max: sorted.at(-1) as number,
    total: sorted.reduce((sum, value) => sum + value, 0) }
}

/** Pearson correlation of two equal-length series; null when undefined (n < 3 or zero variance). Descriptive only. */
export function pearson(xs: readonly number[], ys: readonly number[]): number | null {
  const n = xs.length
  if (n < 3 || ys.length !== n) return null
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n
  let sxy = 0, sxx = 0, syy = 0
  for (let i = 0; i < n; i += 1) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy }
  return sxx === 0 || syy === 0 ? null : sxy / Math.sqrt(sxx * syy)
}

// ---------------------------------------------------------------- raw runtime records

interface DepthRecord {
  seq: number
  targetOrdinal: number
  streamIndex: number
  startGogmaCounter: number
  depth: number
  exhausted: boolean
  counts: { frontierStatesBefore: number; legalPositionCount: number | null; generatedStates: number | null; frontierStatesAfter: number | null; windowMemoEntries: number }
  phaseMs: Partial<Phase2C26A3PhaseTotals>
  inclusiveMs: number
  startedMs: number
  completedMs: number
}

interface PhaseStartRecord { seq: number; elapsedMs: number; targetOrdinal: number; streamIndex: number; depth: number; phase: Phase2C26A3Phase }

function runtimeRecords(kernel: Json) {
  const records = asArray(kernel.runtime).filter(isObject)
  const phaseStarts: PhaseStartRecord[] = []
  const depths: DepthRecord[] = []
  for (const record of records) {
    if (record.kind === 'gogma_phase_started') phaseStarts.push(record as unknown as PhaseStartRecord)
    else if (record.kind === 'gogma_depth') depths.push(record as unknown as DepthRecord)
  }
  const all = [...phaseStarts, ...depths].sort((a, b) => a.seq - b.seq)
  return { phaseStarts, depths, all, count: records.length }
}

const heartbeatsOf = (kernel: Json) => asArray(kernel.heartbeats).filter(isObject).filter(record => record.kind === 'heartbeat')

// ---------------------------------------------------------------- formal series validation

export interface Phase2C26A3FormalRunValidation {
  valid: boolean
  failures: string[]
  rawStatus: unknown
  smokeIsNull: boolean
  uncommittedBenchmarkCode: unknown
  c26aShaMatches: boolean
  a2ShaMatches: boolean
  exportShaMatches: boolean
  searchInstrumentation: unknown
  baselineParity: ReturnType<typeof validatePhase2C26A2BaselineParity> | null
  conditionParity: ReturnType<typeof validatePhase2C26A3ConditionParity> | null
  selection: ReturnType<typeof validatePhase2C26A3Selection> | null
  recordIssues: { orientationId: string; issue: string }[]
  unknownStatuses: string[]
}

/**
 * The raw run is the formal A3 series only when it is a clean, non-smoke run of committed code against the same two
 * authority files and Export, run at the registered heap / concurrency 1 / budget / heartbeat with only the boundary
 * observer as Search instrumentation, the analyzer's own re-derivation of the baseline, condition and selection parity
 * passes, and every kernel child left well-formed lifecycle and runtime streams with no contract violation.
 */
export function validatePhase2C26A3FormalRun(raw: unknown, c26a: Phase2C26A2Authority, a2: Phase2C26A3A2Authority, c26aSha256: string, a2Sha256: string): Phase2C26A3FormalRunValidation {
  const failures: string[] = []
  const r = isObject(raw) ? raw : {}
  const environment = isObject(r.environment) ? r.environment : {}
  if (r.status !== 'completed') failures.push(`raw status is ${String(r.status)}`)
  const smokeIsNull = environment.smoke === null
  if (!smokeIsNull) failures.push('a smoke run is never formal')
  if (environment.uncommittedBenchmarkCode !== false) failures.push('benchmark code was not committed')
  const c26aShaMatches = environment.c26aResultSha256 === c26aSha256
  if (!c26aShaMatches) failures.push('the raw run was not made against this C2.6-A RESULT')
  const a2ShaMatches = environment.c26a2ResultSha256 === a2Sha256
  if (!a2ShaMatches) failures.push('the raw run was not made against this C2.6-A2 RESULT')
  const exportShaMatches = environment.exportSha256 === c26a.conditions.exportSha256
  if (!exportShaMatches) failures.push('Export SHA-256 differs from the authority')
  const searchInstrumentation = environment.searchInstrumentation
  if (stableStringify(searchInstrumentation) !== stableStringify({ onGogmaReservedRuntime: true, onGogmaReservedDepth: false, onSkillReservedDepth: false, onWorkSettled: false })) {
    failures.push('the Search instrumentation is not the boundary observer alone')
  }
  if (environment.childHeapLimitMb !== PHASE2C26A3_CHILD_HEAP_MB || environment.concurrency !== PHASE2C26A3_CONCURRENCY || environment.orientationBudgetMs !== PHASE2C26A3_ORIENTATION_BUDGET_MS
    || environment.heartbeatIntervalMs !== PHASE2C26A3_HEARTBEAT_INTERVAL_MS) failures.push('run environment is not the registered heap / concurrency 1 / budget / heartbeat')

  const baseline = isObject(r.baseline) ? r.baseline : null
  let baselineParity = null, conditionParity = null
  if (!baseline || !isObject(baseline.summary)) failures.push('baseline record missing')
  else {
    baselineParity = validatePhase2C26A2BaselineParity(baseline.summary as never, asArray(baseline.orientations) as Phase2C2Orientation[], c26a)
    if (!baselineParity.valid) failures.push(...baselineParity.issues.map(issue => `baseline parity: ${issue}`))
  }
  const kernels = asArray(r.kernels).filter(isObject)
  const current = isObject(r.currentConditions) ? r.currentConditions as unknown as Phase2C26A2RunConditions : null
  if (!current) failures.push('currentConditions missing')
  else {
    conditionParity = validatePhase2C26A3ConditionParity(current, c26a, a2.conditions)
    if (!conditionParity.valid) failures.push(...conditionParity.issues.map(issue => `condition parity: ${issue}`))
    const actual = { childHeapLimitMb: environment.childHeapLimitMb, concurrency: environment.concurrency, orientationBudgetMs: environment.orientationBudgetMs,
      nodeYield: environment.nodeYield, exportSha256: environment.exportSha256 }
    for (const [key, value] of Object.entries(actual)) if (stableStringify(value) !== stableStringify((current as unknown as Json)[key])) failures.push(`currentConditions.${key} is not the run environment's`)
    for (const kernel of kernels) {
      const conditions = isObject(kernel.task) && isObject(kernel.task.conditions) ? kernel.task.conditions : {}
      if (stableStringify(conditions.extent) !== stableStringify(current.extent) || stableStringify(conditions.bounds) !== stableStringify(current.bounds)) {
        failures.push(`kernel ${String(kernel.orientationId)} ran with other extent / bounds`)
      }
    }
  }
  const selection = validatePhase2C26A3Selection(kernels.map(kernel => (isObject(kernel.task) ? kernel.task.orientation : null) as Phase2C2Orientation).filter(Boolean),
    a2.primaryOrientationIds, c26a)
  if (!selection.valid) failures.push('the profiled orientations are not exactly the derived primary set')
  if (a2.primaryOrientationIds.length !== PHASE2C26A3_REGISTERED_PRIMARY_COUNT) failures.push('the primary count is not the registered one')

  const recordIssues: Phase2C26A3FormalRunValidation['recordIssues'] = []
  const unknownStatuses: string[] = []
  for (const kernel of kernels) {
    const id = String(kernel.orientationId)
    const orientationId = isObject(kernel.task) && isObject(kernel.task.orientation) ? String(kernel.task.orientation.orientationId) : null
    if (orientationId !== id) recordIssues.push({ orientationId: id, issue: 'task mismatch' })
    const outcome = isObject(kernel.process) ? String(kernel.process.outcome) : 'missing'
    if (!['completed', 'out_of_memory', 'timeout', 'process_failure'].includes(outcome)) unknownStatuses.push(`${id}:${outcome}`)
    const lifecycle = asArray(kernel.events).filter(isObject).filter(record => record.kind === 'lifecycle')
    if (lifecycle.length === 0) recordIssues.push({ orientationId: id, issue: 'no lifecycle record' })
    if (lifecycle.some((record, index) => record.seq !== index + 1)) recordIssues.push({ orientationId: id, issue: 'lifecycle sequence is not contiguous from 1' })
    const ended = isObject(lifecycle.at(-1)?.event) && (lifecycle.at(-1)?.event as Json).type === 'kernel_completed'
    if (outcome === 'completed' && !ended) recordIssues.push({ orientationId: id, issue: 'completed child without kernel_completed' })
    const { all, count } = runtimeRecords(kernel)
    if (all.length === 0) recordIssues.push({ orientationId: id, issue: 'no runtime record' })
    if (all.length !== count || all.some((record, index) => record.seq !== index + 1)) recordIssues.push({ orientationId: id, issue: 'runtime sequence is not contiguous from 1' })
    const heartbeats = heartbeatsOf(kernel)
    if (heartbeats.length === 0) recordIssues.push({ orientationId: id, issue: 'no heartbeat' })
    const runtime = isObject(heartbeats.at(-1)?.gogmaRuntime) ? heartbeats.at(-1)?.gogmaRuntime as Json : null
    if (runtime === null) recordIssues.push({ orientationId: id, issue: 'last heartbeat has no Gogma runtime' })
    else if (runtime.contractViolations !== 0) recordIssues.push({ orientationId: id, issue: `${String(runtime.contractViolations)} boundary contract violations` })
  }
  if (recordIssues.length > 0) failures.push('record stream issues')
  if (unknownStatuses.length > 0) failures.push('unknown child status')
  return { valid: failures.length === 0, failures, rawStatus: r.status, smokeIsNull, uncommittedBenchmarkCode: environment.uncommittedBenchmarkCode,
    c26aShaMatches, a2ShaMatches, exportShaMatches, searchInstrumentation, baselineParity, conditionParity, selection, recordIssues, unknownStatuses }
}

// ---------------------------------------------------------------- one orientation

export interface Phase2C26A3PhaseDistribution {
  count: number
  totalMs: number
  minMs: number | null
  medianMs: number | null
  maxMs: number | null
  /** Where the largest completed-depth section ran. */
  maxAt: { streamIndex: number; depth: number } | null
}

export interface Phase2C26A3ActiveAtEnd {
  /** `section` = a section had started and its depth never completed; `between_depths` = no Gogma section was active. */
  where: 'section' | 'between_depths' | 'none'
  streamIndex: number | null
  depth: number | null
  phase: Phase2C26A3Phase | null
  startedMs: number | null
  /** Estimated from the parent's kill time and the IPC clock offset (null for a completed child). */
  elapsedAtKillEstimateMs: number | null
}

export interface Phase2C26A3OrientationAnalysis {
  orientationId: string
  kind: string
  childOutcome: string
  resultClass: string
  /** The primary Search (Target ordinal 0). */
  primarySearch: {
    targetWeaponId: string | null
    completed: boolean
    /** `search_completed` for a finished Search, otherwise the last heartbeat. */
    observationPoint: 'search_completed' | 'last_heartbeat'
    observedAtMs: number
    searchStartedMs: number
    /** Search own wall time up to the observation point (trials inside it excluded). */
    searchWallMs: number
    /** Estimated Search own wall time up to the kill (timeout only). */
    searchWallAtKillEstimateMs: number | null
    /** Unobserved tail: the kill estimate minus the observation point (timeout only). */
    unobservedTailMs: number | null
    /** Completed-section totals plus the active section's elapsed time at the observation point. */
    phaseTotalsMs: Phase2C26A3PhaseTotals
    phaseShare: Record<Phase2C26A3Phase, number>
    measuredGogmaMs: number
    coverage: number
    unattributedSearchMs: number
    /** Inclusive held-aware depth read time (`depth_started` -> `depth_completed`, plus the active depth). */
    inclusiveDepthReadMs: number
    /** Inclusive depth time not inside a section (cursor check, notices), never part of the coverage. */
    inDepthOutsideSectionsMs: number
    dominantPhase: Phase2C26A3Phase
    completedDepths: number
    maxDepthReached: number
    streams: number
    activeAtObservation: { streamIndex: number; depth: number; phase: Phase2C26A3Phase; elapsedMs: number } | null
  } | null
  activeAtEnd: Phase2C26A3ActiveAtEnd
  counters: Json
  /** Per-section distribution over the completed depths of the primary Search. */
  phaseDistributions: Record<Phase2C26A3Phase, Phase2C26A3PhaseDistribution>
  /** Per depth, summed over the streams that completed it. */
  byDepth: { depth: number; streams: number; generatedStates: number; frontierStatesBefore: number; frontierStatesAfter: number; legalPositionsMax: number; phaseMs: Phase2C26A3PhaseTotals }[]
  maxGeneratedDepth: { depth: number; generatedStates: number } | null
  maxFrontierDepth: { depth: number; frontierStatesAfter: number } | null
  maxGeneratedRecord: { streamIndex: number; depth: number; generatedStates: number } | null
  maxFrontierRecord: { streamIndex: number; depth: number; frontierStatesAfter: number } | null
  totals: { generatedStates: number; frontierStatesAfter: number }
  correlations: Json
  ratios: Json
  memory: Json
  heartbeats: number
  maxHeartbeatGapMs: number | null
  predictionCounts: Json
  laterTargets: { targetOrdinal: number; state: string; searchOwnMs: number | null }[]
}

/** One kernel child: the A2 lifecycle view plus the Gogma section timing of its primary Search. */
export function analyzePhase2C26A3Kernel(kernel: unknown, sha256: (value: string) => string): Phase2C26A3OrientationAnalysis {
  const k = isObject(kernel) ? kernel : {}
  const lifecycle = analyzePhase2C26A2Kernel(k, sha256)
  const process = isObject(k.process) ? k.process : {}
  const ipc = isObject(process.ipc) ? process.ipc : {}
  const { depths, all } = runtimeRecords(k)
  const heartbeats = heartbeatsOf(k)
  const primaryTarget = lifecycle.targets.find(target => target.targetOrdinal === 0) ?? null
  const primaryDepths = depths.filter(d => d.targetOrdinal === 0)

  // Active section at the kill: the last durable record, unless its depth completed afterwards.
  const origin = isObject(ipc.kernelInvoked) ? num(ipc.kernelInvoked.originChildProcessMs) : null
  const offset = num(ipc.minClockOffsetMs)
  const killedAt = num(process.killedAtMs)
  const killElapsed = killedAt !== null && origin !== null && offset !== null ? killedAt - origin - offset : null
  const last = all.at(-1) ?? null
  let activeAtEnd: Phase2C26A3ActiveAtEnd = { where: 'none', streamIndex: null, depth: null, phase: null, startedMs: null, elapsedAtKillEstimateMs: null }
  if (lifecycle.childOutcome !== 'completed' && last !== null) {
    if ('phase' in last) {
      activeAtEnd = { where: 'section', streamIndex: last.streamIndex, depth: last.depth, phase: last.phase, startedMs: last.elapsedMs,
        elapsedAtKillEstimateMs: killElapsed === null ? null : killElapsed - last.elapsedMs }
    } else activeAtEnd = { where: 'between_depths', streamIndex: last.streamIndex, depth: last.depth, phase: null, startedMs: last.completedMs, elapsedAtKillEstimateMs: killElapsed === null ? null : killElapsed - last.completedMs }
  }

  // Coverage of the primary Search at one observation instant.
  let primarySearch: Phase2C26A3OrientationAnalysis['primarySearch'] = null
  if (primaryTarget && primaryTarget.searchStartMs !== null) {
    const completed = primaryTarget.searchEndMs !== null
    let totals = zeroTotals(), observedAtMs: number, activeAtObservation: NonNullable<Phase2C26A3OrientationAnalysis['primarySearch']>['activeAtObservation'] = null
    let inclusive = 0, completedDepths: number, maxDepthReached: number, streams: number
    if (completed) {
      observedAtMs = primaryTarget.searchEndMs as number
      for (const d of primaryDepths) {
        for (const phase of PHASE2C26A3_PHASES) totals[phase] += d.phaseMs[phase] ?? 0
        inclusive += d.inclusiveMs
      }
      completedDepths = primaryDepths.length
      maxDepthReached = Math.max(0, ...primaryDepths.map(d => d.depth))
      streams = new Set(primaryDepths.map(d => d.streamIndex)).size
    } else {
      const hb = heartbeats.at(-1) ?? {}
      observedAtMs = num(hb.elapsedMs) ?? 0
      const runtime = isObject(hb.gogmaRuntime) ? hb.gogmaRuntime : {}
      const target = asArray(runtime.byTarget).filter(isObject).find(t => t.targetOrdinal === 0) ?? {}
      const recorded = isObject(target.phaseTotalsMs) ? target.phaseTotalsMs : {}
      totals = Object.fromEntries(PHASE2C26A3_PHASES.map(phase => [phase, num(recorded[phase]) ?? 0])) as Phase2C26A3PhaseTotals
      inclusive = num(target.inclusiveDepthMs) ?? 0
      completedDepths = num(target.completedDepths) ?? 0
      maxDepthReached = num(target.maxDepthReached) ?? 0
      streams = num(target.streams) ?? 0
      const active = isObject(runtime.activePhase) && runtime.activePhase.targetOrdinal === 0 ? runtime.activePhase : null
      if (active) {
        const phase = active.phase as Phase2C26A3Phase
        const elapsed = num(active.elapsedMs) ?? 0
        totals[phase] += elapsed
        activeAtObservation = { streamIndex: num(active.streamIndex) ?? -1, depth: num(active.depth) ?? -1, phase, elapsedMs: elapsed }
      }
      const activeDepth = isObject(runtime.activeDepth) && runtime.activeDepth.targetOrdinal === 0 ? runtime.activeDepth : null
      if (activeDepth) inclusive += num(activeDepth.elapsedMs) ?? 0
    }
    const trialMs = primaryTarget.trials.reduce((sum, trial) => sum + (Math.min(trial.endMs ?? observedAtMs, observedAtMs) - trial.startMs), 0)
    const searchWallMs = observedAtMs - (primaryTarget.searchStartMs as number) - trialMs
    const measured = sumTotals(totals)
    const dominantPhase = PHASE2C26A3_PHASES.reduce((best, phase) => (totals[phase] > totals[best] ? phase : best), PHASE2C26A3_PHASES[0])
    const atKill = !completed && killElapsed !== null ? killElapsed - (primaryTarget.searchStartMs as number) - trialMs : null
    primarySearch = {
      targetWeaponId: primaryTarget.targetWeaponId, completed, observationPoint: completed ? 'search_completed' : 'last_heartbeat', observedAtMs,
      searchStartedMs: primaryTarget.searchStartMs as number, searchWallMs, searchWallAtKillEstimateMs: atKill,
      unobservedTailMs: atKill === null ? null : atKill - searchWallMs,
      phaseTotalsMs: totals, phaseShare: Object.fromEntries(PHASE2C26A3_PHASES.map(phase => [phase, measured === 0 ? 0 : totals[phase] / measured])) as Record<Phase2C26A3Phase, number>,
      measuredGogmaMs: measured, coverage: searchWallMs <= 0 ? 0 : measured / searchWallMs, unattributedSearchMs: searchWallMs - measured,
      inclusiveDepthReadMs: inclusive, inDepthOutsideSectionsMs: inclusive - measured, dominantPhase, completedDepths, maxDepthReached, streams, activeAtObservation,
    }
  }

  // Depth distributions over the completed depths.
  const phaseDistributions = Object.fromEntries(PHASE2C26A3_PHASES.map(phase => {
    const ran = primaryDepths.filter(d => d.phaseMs[phase] !== undefined)
    const values = ran.map(d => d.phaseMs[phase] as number)
    const dist = distribution(values)
    const maxRecord = ran.reduce<DepthRecord | null>((best, d) => (best === null || (d.phaseMs[phase] as number) > (best.phaseMs[phase] as number) ? d : best), null)
    return [phase, { count: dist.count, totalMs: dist.total, minMs: dist.min, medianMs: dist.median, maxMs: dist.max,
      maxAt: maxRecord === null ? null : { streamIndex: maxRecord.streamIndex, depth: maxRecord.depth } }]
  })) as Record<Phase2C26A3Phase, Phase2C26A3PhaseDistribution>
  const depthMap = new Map<number, Phase2C26A3OrientationAnalysis['byDepth'][number]>()
  for (const d of primaryDepths) {
    let row = depthMap.get(d.depth)
    if (!row) { row = { depth: d.depth, streams: 0, generatedStates: 0, frontierStatesBefore: 0, frontierStatesAfter: 0, legalPositionsMax: 0, phaseMs: zeroTotals() }; depthMap.set(d.depth, row) }
    row.streams += 1
    row.generatedStates += d.counts.generatedStates ?? 0
    row.frontierStatesBefore += d.counts.frontierStatesBefore
    row.frontierStatesAfter += d.counts.frontierStatesAfter ?? 0
    row.legalPositionsMax = Math.max(row.legalPositionsMax, d.counts.legalPositionCount ?? 0)
    for (const phase of PHASE2C26A3_PHASES) row.phaseMs[phase] += d.phaseMs[phase] ?? 0
  }
  const byDepth = [...depthMap.values()].sort((a, b) => a.depth - b.depth)
  const maxBy = <T>(items: T[], value: (item: T) => number) => items.reduce<T | null>((best, item) => (best === null || value(item) > value(best) ? item : best), null)
  const gd = maxBy(byDepth, row => row.generatedStates), fd = maxBy(byDepth, row => row.frontierStatesAfter)
  const gr = maxBy(primaryDepths, d => d.counts.generatedStates ?? 0), fr = maxBy(primaryDepths, d => d.counts.frontierStatesAfter ?? 0)

  // Volume / time: descriptive correlation over the completed depth records, and ns-per-unit ratios.
  const withGenerated = primaryDepths.filter(d => (d.counts.generatedStates ?? 0) > 0)
  const ms = (d: DepthRecord, phase: Phase2C26A3Phase) => d.phaseMs[phase] ?? 0
  const gen = (d: DepthRecord) => d.counts.generatedStates ?? 0
  const after = (d: DepthRecord) => d.counts.frontierStatesAfter ?? 0
  const correlations = {
    records: withGenerated.length,
    generatedStates_vs_state_generation: round(pearson(withGenerated.map(gen), withGenerated.map(d => ms(d, 'state_generation')))),
    generatedStates_vs_solution_materialization: round(pearson(withGenerated.map(gen), withGenerated.map(d => ms(d, 'solution_materialization')))),
    depth_vs_solution_materialization: round(pearson(withGenerated.map(d => d.depth), withGenerated.map(d => ms(d, 'solution_materialization')))),
    generatedTimesDepth_vs_solution_materialization: round(pearson(withGenerated.map(d => gen(d) * d.depth), withGenerated.map(d => ms(d, 'solution_materialization')))),
    generatedStates_vs_frontier_reduction_sort: round(pearson(withGenerated.map(gen), withGenerated.map(d => ms(d, 'frontier_reduction_sort')))),
    frontierStatesAfter_vs_frontier_reduction_sort: round(pearson(withGenerated.map(after), withGenerated.map(d => ms(d, 'frontier_reduction_sort')))),
    frontierStatesAfter_vs_exhaustion_scan: round(pearson(withGenerated.map(after), withGenerated.map(d => ms(d, 'exhaustion_scan')))),
    frontierStatesBefore_vs_window_collection: round(pearson(withGenerated.map(d => d.counts.frontierStatesBefore), withGenerated.map(d => ms(d, 'window_collection')))),
    frontierStatesBefore_vs_support_evaluation: round(pearson(withGenerated.map(d => d.counts.frontierStatesBefore), withGenerated.map(d => ms(d, 'support_evaluation')))),
  }
  const ns = (values: DepthRecord[], phase: Phase2C26A3Phase, unit: (d: DepthRecord) => number) => {
    const ratios = values.filter(d => unit(d) > 0 && d.phaseMs[phase] !== undefined).map(d => (ms(d, phase) * 1e6) / unit(d))
    const dist = distribution(ratios)
    return { count: dist.count, min: round(dist.min, 2), median: round(dist.median, 2), max: round(dist.max, 2) }
  }
  const ratios = {
    unit: 'ns per unit, per completed depth record',
    state_generation_per_generatedState: ns(withGenerated, 'state_generation', gen),
    solution_materialization_per_generatedState: ns(withGenerated, 'solution_materialization', gen),
    solution_materialization_per_generatedState_depth: ns(withGenerated, 'solution_materialization', d => gen(d) * d.depth),
    frontier_reduction_sort_per_generatedState: ns(withGenerated, 'frontier_reduction_sort', gen),
    exhaustion_scan_per_frontierStateAfter: ns(withGenerated, 'exhaustion_scan', after),
    window_collection_per_frontierStateBefore: ns(withGenerated, 'window_collection', d => d.counts.frontierStatesBefore),
    support_evaluation_per_frontierStateBefore: ns(withGenerated, 'support_evaluation', d => d.counts.frontierStatesBefore),
    state_generation_per_position_x_frontierBefore: ns(withGenerated, 'state_generation', d => (d.counts.legalPositionCount ?? 0) * d.counts.frontierStatesBefore),
  }
  let maxGap: number | null = null
  for (let i = 1; i < heartbeats.length; i += 1) maxGap = Math.max(maxGap ?? 0, (num(heartbeats[i].elapsedMs) ?? 0) - (num(heartbeats[i - 1].elapsedMs) ?? 0))
  return {
    orientationId: lifecycle.orientationId, kind: lifecycle.kind, childOutcome: lifecycle.childOutcome, resultClass: lifecycle.resultClass,
    primarySearch, activeAtEnd, counters: lifecycle.counters as unknown as Json, phaseDistributions, byDepth,
    maxGeneratedDepth: gd && { depth: gd.depth, generatedStates: gd.generatedStates }, maxFrontierDepth: fd && { depth: fd.depth, frontierStatesAfter: fd.frontierStatesAfter },
    maxGeneratedRecord: gr && { streamIndex: gr.streamIndex, depth: gr.depth, generatedStates: gen(gr) },
    maxFrontierRecord: fr && { streamIndex: fr.streamIndex, depth: fr.depth, frontierStatesAfter: after(fr) },
    totals: { generatedStates: primaryDepths.reduce((s, d) => s + gen(d), 0), frontierStatesAfter: primaryDepths.reduce((s, d) => s + after(d), 0) },
    correlations, ratios, memory: lifecycle.memory as unknown as Json, heartbeats: heartbeats.length, maxHeartbeatGapMs: maxGap,
    predictionCounts: lifecycle.predictionCounts as unknown as Json,
    laterTargets: lifecycle.targets.filter(t => t.targetOrdinal > 0).map(t => ({ targetOrdinal: t.targetOrdinal, state: t.state, searchOwnMs: t.searchOwnMs })),
  }
}

// ---------------------------------------------------------------- decision

export type Phase2C26A3DecisionCase = 'G_gogma_phase_dominant' | 'R_gogma_does_not_explain' | 'M_mixed'

export const PHASE2C26A3_RECOMMENDATION: Record<Phase2C26A3Phase, string> = {
  state_generation: 'H6: held-aware Gogma state generation algorithm (position x frontier Keep scan / Reset parent lookup) を次Phaseで設計',
  solution_materialization: 'H2系: reservedBonusSteps() / raw solution history materialization を優先',
  frontier_reduction_sort: 'frontier key / representative 比較 / sort を優先',
  window_collection: 'reservation window / frontier window 収集を優先',
  exhaustion_scan: 'reservation window / frontier exhaustion scan を優先',
  support_evaluation: 'prediction support path の調査',
}

/**
 * The pre-registered direct-runtime rule over the primary Searches (registered count 3, threshold 2):
 * - R: at least 2 have coverage < 0.80 -> the Gogma sections do not explain the Search; time the rest next.
 * - G: at least 2 have coverage >= 0.80 with the same dominant section -> that section is the next optimization candidate.
 * - M: otherwise (coverage >= 0.80 in at least 2, but no single dominant section among them) -> localize the context next.
 */
export function phase2c26a3Decision(rows: readonly Phase2C26A3OrientationAnalysis[]) {
  const searches = rows.map(row => ({ orientationId: row.orientationId, search: row.primarySearch }))
  const threshold = 2
  const covered = searches.filter(s => s.search !== null && s.search.coverage >= PHASE2C26A3_COVERAGE_THRESHOLD)
  const uncovered = searches.filter(s => s.search === null || s.search.coverage < PHASE2C26A3_COVERAGE_THRESHOLD)
  const dominantAll = searches.map(s => s.search?.dominantPhase ?? null)
  const allSameDominant = dominantAll.every(p => p !== null && p === dominantAll[0])
  const byPhase = new Map<Phase2C26A3Phase, string[]>()
  for (const s of covered) {
    const phase = s.search?.dominantPhase as Phase2C26A3Phase
    byPhase.set(phase, [...(byPhase.get(phase) ?? []), s.orientationId])
  }
  const g = [...byPhase.entries()].find(([, ids]) => ids.length >= threshold) ?? null
  let decision: { case: Phase2C26A3DecisionCase; dominantPhase: Phase2C26A3Phase | null; reason: string; recommendation: string }
  if (rows.length !== PHASE2C26A3_REGISTERED_PRIMARY_COUNT) {
    decision = { case: 'M_mixed', dominantPhase: null, reason: `primary count ${rows.length} is not the registered ${PHASE2C26A3_REGISTERED_PRIMARY_COUNT}`, recommendation: 'fail closed: no decision' }
  } else if (uncovered.length >= threshold) {
    decision = { case: 'R_gogma_does_not_explain', dominantPhase: null,
      reason: `coverage < ${PHASE2C26A3_COVERAGE_THRESHOLD} in ${uncovered.length} / ${rows.length} primaries (${uncovered.map(s => s.orientationId).join(', ')})`,
      recommendation: 'Gogma stream内部だけではSearch runtimeを説明できない。次Phaseはscheduler / Bonus publication / Ideal filter / Lazy Cross等のruntime計時。optimizationへ進まない。' }
  } else if (g !== null) {
    decision = { case: 'G_gogma_phase_dominant', dominantPhase: g[0],
      reason: `coverage >= ${PHASE2C26A3_COVERAGE_THRESHOLD} with dominant ${g[0]} in ${g[1].length} / ${rows.length} primaries (${g[1].join(', ')})`,
      recommendation: PHASE2C26A3_RECOMMENDATION[g[0]] }
  } else {
    decision = { case: 'M_mixed', dominantPhase: null,
      reason: `coverage >= ${PHASE2C26A3_COVERAGE_THRESHOLD} in ${covered.length} / ${rows.length}, but no single dominant section among them (${covered.map(s => `${s.orientationId}:${s.search?.dominantPhase}`).join(', ')})`,
      recommendation: '次Phaseでcontext差の原因を局所化。optimizationへ進まない。' }
  }
  return {
    threshold: PHASE2C26A3_COVERAGE_THRESHOLD, majority: threshold,
    coverage: Object.fromEntries(searches.map(s => [s.orientationId, s.search === null ? null : round(s.search.coverage)])),
    dominantPhaseByPrimary: Object.fromEntries(searches.map(s => [s.orientationId, s.search?.dominantPhase ?? null])),
    dominantPhaseConsistentAcrossPrimaries: allSameDominant,
    ...decision,
  }
}

export function summarizePhase2C26A3(rows: readonly Phase2C26A3OrientationAnalysis[]) {
  const totals = zeroTotals()
  let searchWall = 0, measured = 0
  for (const row of rows) {
    if (!row.primarySearch) continue
    for (const phase of PHASE2C26A3_PHASES) totals[phase] += row.primarySearch.phaseTotalsMs[phase]
    searchWall += row.primarySearch.searchWallMs
    measured += row.primarySearch.measuredGogmaMs
  }
  return {
    orientations: rows.length,
    childStatus: Object.fromEntries(['completed', 'out_of_memory', 'timeout', 'process_failure'].map(s => [s, rows.filter(r => r.childOutcome === s).length])),
    primarySearchCompleted: rows.filter(r => r.primarySearch?.completed === true).length,
    phaseTotalsMs: totals,
    phaseShareOfMeasured: Object.fromEntries(PHASE2C26A3_PHASES.map(phase => [phase, measured === 0 ? 0 : round(totals[phase] / measured)])),
    searchWallMs: searchWall,
    measuredGogmaMs: measured,
    pooledCoverage: searchWall === 0 ? null : round(measured / searchWall),
    unattributedSearchMs: searchWall - measured,
    decision: phase2c26a3Decision(rows),
  }
}
