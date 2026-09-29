/**
 * Issue #154 Phase 2-C2.6-A2: post-hoc analysis of one raw targeted runtime run, Research only. Never import from
 * Production.
 *
 * Nothing here runs a Planner or a Search. The raw run is read as untrusted JSON. Every stage is read deterministically
 * from the lifecycle records the kernel child wrote synchronously before it went on (so a budget kill keeps them up to the
 * kill); every time is the Research child's own `now()` offset from the kernel start. Time between two records is
 * attributed to the stage the earlier record opened (`classifyPhase2C26A2Stage()`); the time after the last record is
 * attributed to that same stage up to the last heartbeat, and what follows the last heartbeat is reported as unobserved.
 */
import { stableStringify } from '../domain/models/publicTypes'
import type { Phase2C2Orientation } from './plannerGlobalPhase2C2'
import {
  classifyPhase2C26A2Stage,
  parsePhase2C26AAuthority,
  phase2c26a2ResultClass,
  PHASE2C26A2_CHILD_HEAP_MB,
  PHASE2C26A2_CONCURRENCY,
  PHASE2C26A2_HEARTBEAT_INTERVAL_MS,
  PHASE2C26A2_ORIENTATION_BUDGET_MS,
  PHASE2C26A2_RESULT_CLASSES,
  PHASE2C26A2_STAGE_CLASSES,
  validatePhase2C26A2BaselineParity,
  validatePhase2C26A2ConditionParity,
  validatePhase2C26A2Selection,
  type Phase2C26A2Authority,
  type Phase2C26A2ResultClass,
  type Phase2C26A2RunConditions,
  type Phase2C26A2SearchDepths,
  type Phase2C26A2SearchSnapshot,
  type Phase2C26A2StageClass,
} from './plannerGlobalPhase2C26A2'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)

export interface Phase2C26A2Counts { predictNormalArtian: number; predictSkills: number; resetBonuses: number; keepBonuses: number }
const ZERO_COUNTS: Phase2C26A2Counts = { predictNormalArtian: 0, predictSkills: 0, resetBonuses: 0, keepBonuses: 0 }
const COUNT_KEYS = ['predictNormalArtian', 'predictSkills', 'resetBonuses', 'keepBonuses'] as const
function countsOf(value: unknown): Phase2C26A2Counts {
  const v = isObject(value) ? value : {}
  return { predictNormalArtian: num(v.predictNormalArtian) ?? 0, predictSkills: num(v.predictSkills) ?? 0, resetBonuses: num(v.resetBonuses) ?? 0, keepBonuses: num(v.keepBonuses) ?? 0 }
}
const diffCounts = (a: Phase2C26A2Counts, b: Phase2C26A2Counts): Phase2C26A2Counts =>
  ({ predictNormalArtian: a.predictNormalArtian - b.predictNormalArtian, predictSkills: a.predictSkills - b.predictSkills, resetBonuses: a.resetBonuses - b.resetBonuses, keepBonuses: a.keepBonuses - b.keepBonuses })
const addCounts = (a: Phase2C26A2Counts, b: Phase2C26A2Counts): Phase2C26A2Counts =>
  ({ predictNormalArtian: a.predictNormalArtian + b.predictNormalArtian, predictSkills: a.predictSkills + b.predictSkills, resetBonuses: a.resetBonuses + b.resetBonuses, keepBonuses: a.keepBonuses + b.keepBonuses })

function distribution(values: readonly number[]) {
  if (values.length === 0) return { count: 0, min: null, median: null, max: null, total: 0 }
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return { count: sorted.length, min: sorted[0], median: sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2, max: sorted.at(-1) as number,
    total: sorted.reduce((sum, value) => sum + value, 0) }
}

// ---------------------------------------------------------------- raw records

interface RawEvent {
  seq: number
  elapsedMs: number
  type: string
  event: Json
  predictionCounts: Phase2C26A2Counts
  search: Phase2C26A2SearchSnapshot | null
  searchDepths: Phase2C26A2SearchDepths | null
}

function rawEvents(kernel: Json): RawEvent[] {
  return asArray(kernel.events).filter(isObject).filter(record => record.kind === 'lifecycle' && isObject(record.event)).map(record => ({
    seq: num(record.seq) ?? -1, elapsedMs: num(record.elapsedMs) ?? 0, type: String((record.event as Json).type), event: record.event as Json,
    predictionCounts: countsOf(record.predictionCounts),
    search: isObject(record.search) ? record.search as unknown as Phase2C26A2SearchSnapshot : null,
    searchDepths: isObject(record.searchDepths) ? record.searchDepths as unknown as Phase2C26A2SearchDepths : null,
  })).sort((a, b) => a.seq - b.seq)
}

function heartbeatsOf(kernel: Json): Json[] {
  return asArray(kernel.heartbeats).filter(isObject).filter(record => record.kind === 'heartbeat')
}

// ---------------------------------------------------------------- formal series validation

export interface Phase2C26A2FormalRunValidation {
  valid: boolean
  failures: string[]
  rawStatus: unknown
  smokeIsNull: boolean
  uncommittedBenchmarkCode: unknown
  authorityShaMatches: boolean
  exportShaMatches: boolean
  baselineParity: ReturnType<typeof validatePhase2C26A2BaselineParity> | null
  conditionParity: ReturnType<typeof validatePhase2C26A2ConditionParity> | null
  selection: ReturnType<typeof validatePhase2C26A2Selection> | null
  lifecycleIssues: { orientationId: string; issue: string }[]
  unknownStatuses: string[]
}

/**
 * The raw run is a formal targeted series only when it is a clean, non-smoke run of committed code against the same
 * authority file, the analyzer's own re-derivation of the baseline, condition and selection parity passes, and every
 * kernel child left a well-formed lifecycle stream (contiguous sequence numbers from 1; a completed child ends with
 * `kernel_completed`, any other child does not).
 */
export function validatePhase2C26A2FormalRun(raw: unknown, authority: Phase2C26A2Authority, authoritySha256: string): Phase2C26A2FormalRunValidation {
  const failures: string[] = []
  const r = isObject(raw) ? raw : {}
  const environment = isObject(r.environment) ? r.environment : {}
  if (r.status !== 'completed') failures.push(`raw status is ${String(r.status)}`)
  const smokeIsNull = environment.smoke === null
  if (!smokeIsNull) failures.push('a smoke run is never formal')
  if (environment.uncommittedBenchmarkCode !== false) failures.push('benchmark code was not committed')
  const authorityShaMatches = environment.c26aResultSha256 === authoritySha256
  if (!authorityShaMatches) failures.push('the raw run was not made against this C2.6-A RESULT')
  const exportShaMatches = environment.exportSha256 === authority.conditions.exportSha256
  if (!exportShaMatches) failures.push('Export SHA-256 differs from the authority')
  const baseline = isObject(r.baseline) ? r.baseline : null
  let baselineParity = null, conditionParity = null
  if (!baseline || !isObject(baseline.summary)) failures.push('baseline record missing')
  else {
    baselineParity = validatePhase2C26A2BaselineParity(baseline.summary as never, asArray(baseline.orientations) as Phase2C2Orientation[], authority)
    if (!baselineParity.valid) failures.push(...baselineParity.issues.map(issue => `baseline parity: ${issue}`))
  }
  const kernels = asArray(r.kernels).filter(isObject)
  const current = isObject(r.currentConditions) ? r.currentConditions as unknown as Phase2C26A2RunConditions : null
  if (!current) failures.push('currentConditions missing')
  else {
    conditionParity = validatePhase2C26A2ConditionParity(current, authority)
    if (!conditionParity.valid) failures.push(...conditionParity.issues.map(issue => `condition parity: ${issue}`))
    // The recorded conditions must be the ones the run actually used.
    const actual = { childHeapLimitMb: environment.childHeapLimitMb, concurrency: environment.concurrency, orientationBudgetMs: environment.orientationBudgetMs,
      nodeYield: environment.nodeYield, exportSha256: environment.exportSha256 }
    for (const [key, value] of Object.entries(actual)) if (stableStringify(value) !== stableStringify((current as unknown as Json)[key])) failures.push(`currentConditions.${key} is not the run environment's`)
    if (environment.childHeapLimitMb !== PHASE2C26A2_CHILD_HEAP_MB || environment.concurrency !== PHASE2C26A2_CONCURRENCY || environment.orientationBudgetMs !== PHASE2C26A2_ORIENTATION_BUDGET_MS
      || environment.heartbeatIntervalMs !== PHASE2C26A2_HEARTBEAT_INTERVAL_MS) failures.push('run environment is not the registered heap / concurrency / budget / heartbeat')
    for (const kernel of kernels) {
      const task = isObject(kernel.task) ? kernel.task : {}
      const conditions = isObject(task.conditions) ? task.conditions : {}
      if (stableStringify(conditions.extent) !== stableStringify(current.extent) || stableStringify(conditions.bounds) !== stableStringify(current.bounds)) {
        failures.push(`kernel ${String(kernel.orientationId)} ran with other extent / bounds`)
      }
    }
  }
  const selection = validatePhase2C26A2Selection(kernels.map(kernel => (isObject(kernel.task) ? kernel.task.orientation : null) as Phase2C2Orientation).filter(Boolean), authority)
  if (!selection.valid) failures.push('the profiled orientations are not exactly the authority timeout set')
  for (const kernel of kernels) {
    if (String(kernel.orientationId) !== String((kernel.task as Json | undefined)?.orientation && ((kernel.task as Json).orientation as Json).orientationId)) failures.push(`kernel ${String(kernel.orientationId)} task mismatch`)
  }
  const lifecycleIssues: Phase2C26A2FormalRunValidation['lifecycleIssues'] = []
  const unknownStatuses: string[] = []
  for (const kernel of kernels) {
    const id = String(kernel.orientationId)
    const outcome = isObject(kernel.process) ? String(kernel.process.outcome) : 'missing'
    if (!['completed', 'out_of_memory', 'timeout', 'process_failure'].includes(outcome)) unknownStatuses.push(`${id}:${outcome}`)
    const events = rawEvents(kernel)
    if (events.length === 0) lifecycleIssues.push({ orientationId: id, issue: 'no lifecycle record' })
    if (events.some((event, index) => event.seq !== index + 1)) lifecycleIssues.push({ orientationId: id, issue: 'lifecycle sequence is not contiguous from 1' })
    const ended = events.at(-1)?.type === 'kernel_completed'
    if (outcome === 'completed' && !ended) lifecycleIssues.push({ orientationId: id, issue: 'completed child without kernel_completed' })
    if (outcome === 'timeout' && heartbeatsOf(kernel).length === 0) lifecycleIssues.push({ orientationId: id, issue: 'timeout child without heartbeat' })
  }
  if (lifecycleIssues.length > 0) failures.push('lifecycle stream issues')
  if (unknownStatuses.length > 0) failures.push('unknown child status')
  return { valid: failures.length === 0, failures, rawStatus: r.status, smokeIsNull, uncommittedBenchmarkCode: environment.uncommittedBenchmarkCode,
    authorityShaMatches, exportShaMatches, baselineParity, conditionParity, selection, lifecycleIssues, unknownStatuses }
}

export { parsePhase2C26AAuthority }

// ---------------------------------------------------------------- one orientation

export interface Phase2C26A2TrialTimeline {
  trialIndex: number
  candidateKeySha256: string
  startMs: number
  endMs: number | null
  preflight: { startMs: number; endMs: number | null; status: string | null } | null
  fullRun: { startMs: number; endMs: number | null; status: string | null; rerunOrdinal: number } | null
  result: unknown
  durationMs: number
}

export interface Phase2C26A2TargetTimeline {
  targetOrdinal: number
  targetWeaponId: string
  state: 'completed' | 'active_at_end' | 'not_started'
  startMs: number | null
  endMs: number | null
  durationMs: number | null
  searchStartMs: number | null
  searchEndMs: number | null
  /** Search call wall time, trials inside it included. */
  searchWindowMs: number | null
  /** Search wall time minus the trials run inside its Candidate callback. */
  searchOwnMs: number | null
  deliveredCandidates: number
  trials: Phase2C26A2TrialTimeline[]
  trialMs: number
  fullPlannerRunMs: number
  outcome: string | null
  search: Phase2C26A2SearchSnapshot | null
  searchDepths: Phase2C26A2SearchDepths | null
}

export interface Phase2C26A2OrientationAnalysis {
  orientationId: string
  kind: string
  fixedTargetWeaponId: string
  nonFixedTargetCount: number
  childOutcome: string
  resultClass: Phase2C26A2ResultClass
  lastStage: string | null
  stageAtEnd: Phase2C26A2StageClass
  activeTargetWeaponId: string | null
  activeTargetOrdinal: number | null
  /** Observed kernel time: kernel_completed, or the later of the last record and the last heartbeat. */
  elapsedInKernelObservedMs: number
  /** Parent-measured time from the last heartbeat's arrival to the child's end (null without a heartbeat). */
  lastHeartbeatAgeAtEndMs: number | null
  /** Kernel start offset inside the child process (Vite loader + Export load before it). */
  kernelStartedAtChildProcessMs: number | null
  elapsedInCurrentTargetMs: number | null
  elapsedInCurrentStageMs: number | null
  counters: { startedTargets: number; completedTargets: number; deliveredCandidates: number; trialsStarted: number; trialsCompleted: number; fullPlannerRunsStarted: number; fullPlannerRunsCompleted: number }
  rerunBudget: { used: number; limit: number } | null
  stageTimeMs: Record<Phase2C26A2StageClass, number>
  stagePredictionCounts: Record<Phase2C26A2StageClass, Phase2C26A2Counts>
  dominantStage: Phase2C26A2StageClass
  predictionCounts: Phase2C26A2Counts
  memory: { source: string; sampledMaxHeapUsedBytes: number | null; sampledMaxRssBytes: number | null }
  yields: number | null
  heartbeats: number
  maxHeartbeatGapMs: number | null
  targets: Phase2C26A2TargetTimeline[]
  fullPlannerRuns: { targetOrdinal: number; trialIndex: number; rerunOrdinal: number; durationMs: number | null; completed: boolean }[]
}

const emptyStageTimes = (): Record<Phase2C26A2StageClass, number> => Object.fromEntries(PHASE2C26A2_STAGE_CLASSES.map(stage => [stage, 0])) as Record<Phase2C26A2StageClass, number>
const emptyStageCounts = (): Record<Phase2C26A2StageClass, Phase2C26A2Counts> => Object.fromEntries(PHASE2C26A2_STAGE_CLASSES.map(stage => [stage, { ...ZERO_COUNTS }])) as Record<Phase2C26A2StageClass, Phase2C26A2Counts>

/** One kernel child's timeline, stage attribution and final state, from its lifecycle records and heartbeats only. */
export function analyzePhase2C26A2Kernel(kernel: unknown, sha256: (value: string) => string): Phase2C26A2OrientationAnalysis {
  const k = isObject(kernel) ? kernel : {}
  const task = isObject(k.task) ? k.task : {}
  const orientation = (isObject(task.orientation) ? task.orientation : {}) as unknown as Phase2C2Orientation
  const process = isObject(k.process) ? k.process : {}
  const ipc = isObject(process.ipc) ? process.ipc : {}
  const childOutcome = String(process.outcome)
  const events = rawEvents(k)
  const heartbeats = heartbeatsOf(k)
  const lastHeartbeat = heartbeats.at(-1) ?? null
  const lastEvent = events.at(-1) ?? null
  const completedKernel = lastEvent?.type === 'kernel_completed'
  const heartbeatElapsed = num(lastHeartbeat?.elapsedMs) ?? 0
  const endObserved = completedKernel ? (lastEvent?.elapsedMs ?? 0) : Math.max(lastEvent?.elapsedMs ?? 0, heartbeatElapsed)
  const endCounts = !completedKernel && lastHeartbeat && heartbeatElapsed >= (lastEvent?.elapsedMs ?? 0) ? countsOf(lastHeartbeat.predictionCounts) : (lastEvent?.predictionCounts ?? { ...ZERO_COUNTS })

  // Stage attribution.
  const stageTimeMs = emptyStageTimes(), stagePredictionCounts = emptyStageCounts()
  let previousType: string | null = null, previousMs = 0, previousCounts: Phase2C26A2Counts = { ...ZERO_COUNTS }
  for (const event of events) {
    const stage = classifyPhase2C26A2Stage(previousType)
    stageTimeMs[stage] += event.elapsedMs - previousMs
    stagePredictionCounts[stage] = addCounts(stagePredictionCounts[stage], diffCounts(event.predictionCounts, previousCounts))
    previousType = event.type; previousMs = event.elapsedMs; previousCounts = event.predictionCounts
  }
  const stageAtEnd = classifyPhase2C26A2Stage(previousType)
  if (!completedKernel) {
    stageTimeMs[stageAtEnd] += Math.max(0, endObserved - previousMs)
    stagePredictionCounts[stageAtEnd] = addCounts(stagePredictionCounts[stageAtEnd], diffCounts(endCounts, previousCounts))
  }
  const dominantStage = PHASE2C26A2_STAGE_CLASSES.reduce((best, stage) => (stageTimeMs[stage] > stageTimeMs[best] ? stage : best), PHASE2C26A2_STAGE_CLASSES[0])

  // Target timelines.
  const targetCount = orientation.participantTargetWeaponIds ? orientation.participantTargetWeaponIds.length - 1 : 0
  const targets: Phase2C26A2TargetTimeline[] = []
  const fullPlannerRuns: Phase2C26A2OrientationAnalysis['fullPlannerRuns'] = []
  const byOrdinal = new Map<number, Phase2C26A2TargetTimeline>()
  const trialOf = (target: Phase2C26A2TargetTimeline, index: number) => target.trials.find(trial => trial.trialIndex === index)
  for (const event of events) {
    const ordinal = num(event.event.targetOrdinal)
    if (ordinal === null) continue
    let target = byOrdinal.get(ordinal)
    if (!target) {
      target = { targetOrdinal: ordinal, targetWeaponId: String(event.event.targetWeaponId), state: 'active_at_end', startMs: null, endMs: null, durationMs: null,
        searchStartMs: null, searchEndMs: null, searchWindowMs: null, searchOwnMs: null, deliveredCandidates: 0, trials: [], trialMs: 0, fullPlannerRunMs: 0,
        outcome: null, search: null, searchDepths: null }
      byOrdinal.set(ordinal, target)
      targets.push(target)
    }
    if (event.search) target.search = event.search
    const trialIndex = num(event.event.trialIndex)
    const budgetUsed = isObject(event.event.budget) ? num(event.event.budget.used) ?? 0 : 0
    switch (event.type) {
      case 'target_started': target.startMs = event.elapsedMs; break
      case 'search_started': target.searchStartMs = event.elapsedMs; break
      case 'candidate_delivered': target.deliveredCandidates += 1; break
      case 'trial_started':
        target.trials.push({ trialIndex: trialIndex ?? target.trials.length, candidateKeySha256: sha256(String(event.event.candidateKey)), startMs: event.elapsedMs,
          endMs: null, preflight: null, fullRun: null, result: null, durationMs: 0 })
        break
      case 'preflight_started': { const trial = trialOf(target, trialIndex ?? -1); if (trial) trial.preflight = { startMs: event.elapsedMs, endMs: null, status: null }; break }
      case 'preflight_completed': { const trial = trialOf(target, trialIndex ?? -1); if (trial?.preflight) { trial.preflight.endMs = event.elapsedMs; trial.preflight.status = String(event.event.status) } break }
      case 'full_planner_run_started': { const trial = trialOf(target, trialIndex ?? -1); if (trial) trial.fullRun = { startMs: event.elapsedMs, endMs: null, status: null, rerunOrdinal: budgetUsed + 1 }; break }
      case 'full_planner_run_completed': { const trial = trialOf(target, trialIndex ?? -1); if (trial?.fullRun) { trial.fullRun.endMs = event.elapsedMs; trial.fullRun.status = String(event.event.status) } break }
      case 'trial_completed': { const trial = trialOf(target, trialIndex ?? -1); if (trial) { trial.endMs = event.elapsedMs; trial.result = event.event.result } break }
      case 'search_completed': target.searchEndMs = event.elapsedMs; target.searchDepths = event.searchDepths; break
      case 'target_completed': target.endMs = event.elapsedMs; target.outcome = String(event.event.outcome); target.state = 'completed'; break
      default: break
    }
  }
  // The heartbeat is later than the last record for a killed child: its Search snapshots are the latest.
  const heartbeatSearches = lastHeartbeat && heartbeatElapsed >= (lastEvent?.elapsedMs ?? 0) ? asArray(lastHeartbeat.searches).filter(isObject) : []
  for (const entry of heartbeatSearches) {
    const target = byOrdinal.get(num(entry.targetOrdinal) ?? -1)
    if (target && target.state !== 'completed' && isObject(entry.snapshot)) target.search = entry.snapshot as unknown as Phase2C26A2SearchSnapshot
  }
  const activeHeartbeat = lastHeartbeat && isObject(lastHeartbeat.activeTarget) ? lastHeartbeat.activeTarget : null
  for (const target of targets) {
    const end = target.endMs ?? endObserved
    target.durationMs = target.startMs === null ? null : end - target.startMs
    for (const trial of target.trials) {
      const trialEnd = trial.endMs ?? endObserved
      trial.durationMs = trialEnd - trial.startMs
      target.trialMs += trial.durationMs
      if (trial.fullRun) {
        const runMs = (trial.fullRun.endMs ?? endObserved) - trial.fullRun.startMs
        target.fullPlannerRunMs += runMs
        fullPlannerRuns.push({ targetOrdinal: target.targetOrdinal, trialIndex: trial.trialIndex, rerunOrdinal: trial.fullRun.rerunOrdinal,
          durationMs: trial.fullRun.endMs === null ? null : runMs, completed: trial.fullRun.endMs !== null })
      }
    }
    if (target.searchStartMs !== null) {
      target.searchWindowMs = (target.searchEndMs ?? endObserved) - target.searchStartMs
      target.searchOwnMs = target.searchWindowMs - target.trialMs
    }
    if (target.state !== 'completed' && activeHeartbeat === null && completedKernel) target.state = 'completed'
    if (target.state !== 'completed' && target.searchDepths === null && activeHeartbeat && num(activeHeartbeat.targetOrdinal) === target.targetOrdinal && isObject(lastHeartbeat?.activeSearchDepths)) {
      target.searchDepths = lastHeartbeat.activeSearchDepths as unknown as Phase2C26A2SearchDepths
    }
  }
  for (let ordinal = 0; ordinal < targetCount; ordinal += 1) {
    if (!byOrdinal.has(ordinal)) targets.push({ targetOrdinal: ordinal, targetWeaponId: '', state: 'not_started', startMs: null, endMs: null, durationMs: null,
      searchStartMs: null, searchEndMs: null, searchWindowMs: null, searchOwnMs: null, deliveredCandidates: 0, trials: [], trialMs: 0, fullPlannerRunMs: 0, outcome: null, search: null, searchDepths: null })
  }
  targets.sort((a, b) => a.targetOrdinal - b.targetOrdinal)
  // A not-started Target's ID is the participant order the kernel uses (stable createPlannerConflictWorks()); it is not
  // inferred here: it stays empty unless an event named it.
  const active = targets.find(target => target.state === 'active_at_end') ?? null
  const counters = {
    startedTargets: events.filter(e => e.type === 'target_started').length,
    completedTargets: events.filter(e => e.type === 'target_completed').length,
    deliveredCandidates: events.filter(e => e.type === 'candidate_delivered').length,
    trialsStarted: events.filter(e => e.type === 'trial_started').length,
    trialsCompleted: events.filter(e => e.type === 'trial_completed').length,
    fullPlannerRunsStarted: events.filter(e => e.type === 'full_planner_run_started').length,
    fullPlannerRunsCompleted: events.filter(e => e.type === 'full_planner_run_completed').length,
  }
  const budgetEvent = [...events].reverse().find(e => isObject(e.event.budget))
  const heartbeatBudget = lastHeartbeat && isObject(lastHeartbeat.rerunBudget) ? lastHeartbeat.rerunBudget : null
  const rerunBudget = budgetEvent ? { used: num((budgetEvent.event.budget as Json).used) ?? 0, limit: num((budgetEvent.event.budget as Json).limit) ?? 0 }
    : heartbeatBudget ? { used: num(heartbeatBudget.used) ?? 0, limit: num(heartbeatBudget.limit) ?? 0 } : null
  const recordMemory = isObject(k.memory) ? k.memory : null
  const heartbeatMemory = lastHeartbeat && isObject(lastHeartbeat.memory) && isObject(lastHeartbeat.memory.maxima) ? lastHeartbeat.memory.maxima : null
  const memory = recordMemory
    ? { source: 'record', sampledMaxHeapUsedBytes: num(recordMemory.sampledMaxHeapUsedBytes), sampledMaxRssBytes: num(recordMemory.sampledMaxRssBytes) }
    : { source: 'last_heartbeat', sampledMaxHeapUsedBytes: num(heartbeatMemory?.maxHeapUsedBytes), sampledMaxRssBytes: num(heartbeatMemory?.maxRssBytes) }
  let maxGap: number | null = null
  for (let index = 1; index < heartbeats.length; index += 1) {
    const gap = (num(heartbeats[index].elapsedMs) ?? 0) - (num(heartbeats[index - 1].elapsedMs) ?? 0)
    maxGap = Math.max(maxGap ?? 0, gap)
  }
  const invoked = isObject(ipc.kernelInvoked) ? num(ipc.kernelInvoked.childProcessMs) : null
  return {
    orientationId: orientation.orientationId, kind: orientation.kind, fixedTargetWeaponId: orientation.fixedTargetWeaponId, nonFixedTargetCount: targetCount,
    childOutcome, resultClass: phase2c26a2ResultClass(childOutcome, stageAtEnd), lastStage: lastEvent?.type ?? null, stageAtEnd,
    activeTargetWeaponId: active?.targetWeaponId ?? null, activeTargetOrdinal: active?.targetOrdinal ?? null,
    elapsedInKernelObservedMs: endObserved, lastHeartbeatAgeAtEndMs: num(process.lastHeartbeatAgeAtEndMs), kernelStartedAtChildProcessMs: invoked,
    elapsedInCurrentTargetMs: active?.startMs === null || active === null ? null : endObserved - (active.startMs as number),
    elapsedInCurrentStageMs: completedKernel ? null : endObserved - previousMs,
    counters, rerunBudget, stageTimeMs, stagePredictionCounts, dominantStage, predictionCounts: completedKernel ? (lastEvent?.predictionCounts ?? { ...ZERO_COUNTS }) : endCounts,
    memory, yields: num(k.yields) ?? num(lastHeartbeat?.yields), heartbeats: heartbeats.length, maxHeartbeatGapMs: maxGap, targets, fullPlannerRuns,
  }
}

// ---------------------------------------------------------------- summary, conclusion, next phase

export type Phase2C26A2NextCase =
  | 'A_search_runtime'
  | 'B_full_planner_rerun'
  | 'C_serial_target_search_accumulation'
  | 'D_many_completed_suspect_variance'
  | 'mixed'

/** Search own time of one Target as a share of the whole orientation's Search own time. */
function largestTargetSearchShare(row: Phase2C26A2OrientationAnalysis): number {
  const own = row.targets.map(target => target.searchOwnMs ?? 0)
  const total = own.reduce((sum, value) => sum + value, 0)
  return total === 0 ? 0 : Math.max(...own) / total
}

/**
 * The pre-registered next-phase rule:
 * 1. more than half of the profiled orientations completed -> D (suspect run variance / concurrency);
 * 2. otherwise, over the timeouts, the dominant stage by attributed time:
 *    full Planner run dominant in more than half -> B;
 *    Search dominant in more than half -> C when more than half of those spread their Search time over Targets (no one
 *    Target holds half of it), A otherwise;
 * 3. anything else -> mixed.
 */
export function phase2c26a2NextCase(rows: readonly Phase2C26A2OrientationAnalysis[]): { case: Phase2C26A2NextCase; reason: string } {
  const completed = rows.filter(row => row.childOutcome === 'completed').length
  if (completed * 2 > rows.length) return { case: 'D_many_completed_suspect_variance', reason: `${completed} / ${rows.length} profiled orientations completed` }
  const timeouts = rows.filter(row => row.childOutcome === 'timeout')
  const fullRun = timeouts.filter(row => row.dominantStage === 'full_planner_run')
  const search = timeouts.filter(row => row.dominantStage === 'search_running')
  if (fullRun.length * 2 > timeouts.length) return { case: 'B_full_planner_rerun', reason: `full Planner run dominant in ${fullRun.length} / ${timeouts.length} timeouts` }
  if (search.length * 2 > timeouts.length) {
    const spread = search.filter(row => largestTargetSearchShare(row) < 0.5)
    return spread.length * 2 > search.length
      ? { case: 'C_serial_target_search_accumulation', reason: `Search dominant in ${search.length} / ${timeouts.length} timeouts; ${spread.length} of them spread Search time over Targets` }
      : { case: 'A_search_runtime', reason: `Search dominant in ${search.length} / ${timeouts.length} timeouts; ${search.length - spread.length} of them concentrate it in one Target` }
  }
  return { case: 'mixed', reason: `no stage dominates more than half of ${timeouts.length} timeouts` }
}

export function summarizePhase2C26A2(rows: readonly Phase2C26A2OrientationAnalysis[]) {
  const resultClass = Object.fromEntries(PHASE2C26A2_RESULT_CLASSES.map(c => [c, rows.filter(row => row.resultClass === c).length])) as Record<Phase2C26A2ResultClass, number>
  const kinds = [...new Set(rows.map(row => row.kind))].sort()
  const resultClassByKind = Object.fromEntries(kinds.map(kind => [kind, Object.fromEntries(PHASE2C26A2_RESULT_CLASSES.map(c =>
    [c, rows.filter(row => row.kind === kind && row.resultClass === c).length]))]))
  const allTargets = rows.flatMap(row => row.targets.map(target => ({ row, target })))
  const completedSearches = allTargets.filter(({ target }) => target.searchEndMs !== null)
  const activeSearches = allTargets.filter(({ target }) => target.searchStartMs !== null && target.searchEndMs === null)
  const runs = rows.flatMap(row => row.fullPlannerRuns)
  const maxOf = (values: number[]) => (values.length === 0 ? null : Math.max(...values))
  const searches = allTargets.map(({ target }) => target.search).filter((s): s is Phase2C26A2SearchSnapshot => s !== null)
  const stageTotals = Object.fromEntries(PHASE2C26A2_STAGE_CLASSES.map(stage => [stage, rows.filter(r => r.childOutcome === 'timeout').reduce((sum, row) => sum + row.stageTimeMs[stage], 0)]))
  return {
    orientations: rows.length,
    childStatus: {
      completed: rows.filter(r => r.childOutcome === 'completed').length,
      out_of_memory: rows.filter(r => r.childOutcome === 'out_of_memory').length,
      timeout: rows.filter(r => r.childOutcome === 'timeout').length,
      process_failure: rows.filter(r => r.childOutcome === 'process_failure').length,
    },
    resultClass,
    resultClassByKind,
    dominantStageOfTimeouts: Object.fromEntries(PHASE2C26A2_STAGE_CLASSES.map(stage => [stage, rows.filter(r => r.childOutcome === 'timeout' && r.dominantStage === stage).length])),
    attributedTimeOfTimeoutsMs: stageTotals,
    searchOwnMs: { completedSearches: distribution(completedSearches.map(({ target }) => target.searchOwnMs ?? 0)), activeAtEnd: distribution(activeSearches.map(({ target }) => target.searchOwnMs ?? 0)) },
    fullPlannerRunMs: { completed: distribution(runs.filter(run => run.completed).map(run => run.durationMs ?? 0)), activeAtEnd: runs.filter(run => !run.completed).length },
    searchAggregateMax: {
      settledWorkItems: maxOf(searches.map(s => s.settledWorkItems)),
      skillMaxDepth: maxOf(searches.map(s => s.skill.maxDepth)), skillTotalStates: maxOf(searches.map(s => s.skill.totalStates)), skillTotalTransitions: maxOf(searches.map(s => s.skill.totalTransitions)),
      gogmaMaxDepth: maxOf(searches.map(s => s.gogma.maxDepth)), gogmaTotalGeneratedStates: maxOf(searches.map(s => s.gogma.totalGeneratedStates)), gogmaTotalFrontierStates: maxOf(searches.map(s => s.gogma.totalFrontierStates)),
    },
    predictionCountsMax: Object.fromEntries(COUNT_KEYS.map(key => [key, maxOf(rows.map(row => row.predictionCounts[key]))])),
    memoryMax: { sampledMaxHeapUsedBytes: maxOf(rows.map(r => r.memory.sampledMaxHeapUsedBytes ?? 0)), sampledMaxRssBytes: maxOf(rows.map(r => r.memory.sampledMaxRssBytes ?? 0)) },
    maxHeartbeatGapMs: maxOf(rows.map(r => r.maxHeartbeatGapMs ?? 0)),
    next: phase2c26a2NextCase(rows),
  }
}

/** Compact, committed form of one orientation (Candidate keys already SHA-256; per-depth arrays kept). */
export function compactPhase2C26A2Row(row: Phase2C26A2OrientationAnalysis) {
  return { ...row }
}
