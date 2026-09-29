/**
 * Issue #154 Phase 2-C2.6-A2: targeted runtime analysis of the Phase 2-C2.6-A timeout orientations, Research only.
 * Never import from Production.
 *
 * The committed Phase 2-C2.6-A RESULT is an authority for two things only: which orientations to profile (the ones whose
 * child timed out) and parity (the current baseline, orientations and run conditions must equal the ones it recorded).
 * It is never a Search or Planner input: every kernel task is built from the current baseline's own orientation by the
 * unchanged Phase 2-C2 helpers, and every calculation is the unchanged current Planner Alternative kernel. What this
 * phase adds is observation: the kernel's optional lifecycle instrumentation
 * (`PlannerAlternativeKernelOptions.instrumentation`), the existing per-Target Search observer
 * (`createPlannerAlternativeSearchObserver()`) and the existing counting RNG Engine, aggregated in the child and turned
 * into a small stream of lifecycle records plus a periodic heartbeat that survive a budget kill. Nothing here reads a
 * clock for the kernel; the Research child stamps each record with its own `now()`.
 *
 * No orientation ID, Target ID, Entry ID or Conflict key is fixed here. The Phase 2-C2.6-A outcome counts this phase
 * starts from are pinned as the registered authority (`PHASE2C26A2_REGISTERED_AUTHORITY`) and cross-checked against the
 * RESULT's own per-orientation rows.
 */
import { stableStringify } from '../domain/models/publicTypes'
import type {
  PlannerAlternativeKernelInstrumentation,
  PlannerAlternativeKernelInstrumentationEvent,
} from '../domain/planner/alternative'
import type { PlannerInput } from '../domain/planner/plannerTypes'
import { createPlannerAlternativeSearchObserver, type PlannerAlternativeSearchObserver } from './plannerAlternativeBenchmarkInstrumentation'
import type { PlannerAlternativePredictionCounts } from './plannerAlternativeBenchmarkProtocol'
import type { Phase2C2BaselineSummary, Phase2C2KernelRecord, Phase2C2Orientation, Phase2C2RunDependencies } from './plannerGlobalPhase2C2'
import {
  comparePhase2C26ABaselineWithOldC2,
  comparePhase2C26AOrientationSets,
  PHASE2C26A_ORIENTATION_METADATA_FIELDS,
} from './plannerGlobalPhase2C26AAnalysis'
import {
  PHASE2C26A_CHILD_HEAP_MB,
  PHASE2C26A_CONCURRENCY,
  PHASE2C26A_MEMORY_SAMPLE_INTERVAL_MS,
  PHASE2C26A_NODE_YIELD,
  PHASE2C26A_ORIENTATION_BUDGET_MS,
  runPhase2C26AKernel,
  type Phase2C26AKernelTask,
} from './plannerGlobalPhase2C26A'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const same = (a: unknown, b: unknown) => stableStringify(a) === stableStringify(b)

// ---------------------------------------------------------------- conditions (Phase 2-C2.6-A's, unchanged)

/** Every run condition is Phase 2-C2.6-A's. None is lengthened, shortened or relaxed. */
export const PHASE2C26A2_CHILD_HEAP_MB = PHASE2C26A_CHILD_HEAP_MB
export const PHASE2C26A2_CONCURRENCY = PHASE2C26A_CONCURRENCY
export const PHASE2C26A2_ORIENTATION_BUDGET_MS = PHASE2C26A_ORIENTATION_BUDGET_MS
export const PHASE2C26A2_MEMORY_SAMPLE_INTERVAL_MS = PHASE2C26A_MEMORY_SAMPLE_INTERVAL_MS
export const PHASE2C26A2_NODE_YIELD = PHASE2C26A_NODE_YIELD
/** Child -> parent heartbeat interval. Lifecycle records are sent at once; nothing is sent per Search work item. */
export const PHASE2C26A2_HEARTBEAT_INTERVAL_MS = 5000

/**
 * The Phase 2-C2.6-A result this phase is registered against: its formal kernel series and its outcome counts. The
 * timeout orientation IDs are never listed here; they are derived from the RESULT's own per-orientation rows.
 */
export const PHASE2C26A2_REGISTERED_AUTHORITY = {
  orientations: 54,
  childStatus: { completed: 45, out_of_memory: 0, timeout: 9, process_failure: 0 },
  conclusionCase: 'timeout_without_out_of_memory',
} as const

// ---------------------------------------------------------------- the Phase 2-C2.6-A RESULT (selection / parity authority)

export interface Phase2C26A2RunConditions {
  exportSha256: string
  childHeapLimitMb: number
  concurrency: number
  orientationBudgetMs: number
  nodeYield: string
  extent: unknown
  bounds: unknown
  researchMaxPlanSteps: number
  calculationContext: unknown
  lineage: { priorFixedBuildListEntryIds: unknown; priorExcludedRoutes: unknown }
}

export interface Phase2C26A2Authority {
  measuredHead: string
  conditions: Phase2C26A2RunConditions
  baseline: Phase2C2BaselineSummary
  orientations: Phase2C2Orientation[]
  /** The child outcome Phase 2-C2.6-A recorded for each orientation. */
  outcomeById: Map<string, string>
  /** The orientations whose Phase 2-C2.6-A child timed out, in the RESULT's orientation order. */
  timeoutOrientationIds: string[]
}

export interface Phase2C26A2AuthorityParse {
  valid: boolean
  issues: string[]
  authority: Phase2C26A2Authority | null
}

/**
 * Reads the committed Phase 2-C2.6-A RESULT as untrusted JSON and fails closed unless it is the registered formal
 * result: formal provenance, a valid formal series, a valid old C2 comparability, the registered outcome counts and
 * conclusion case, and per-orientation rows that cover the orientation list exactly once and agree with those counts.
 */
export function parsePhase2C26AAuthority(json: unknown): Phase2C26A2AuthorityParse {
  const issues: string[] = []
  const fail = (message: string): Phase2C26A2AuthorityParse => ({ valid: false, issues: [...issues, message], authority: null })
  if (!isObject(json)) return fail('C2.6-A RESULT is not an object')
  const provenance = isObject(json.provenance) ? json.provenance : null
  const conditions = isObject(json.conditions) ? json.conditions : null
  const baseline = isObject(json.baseline) && isObject(json.baseline.summary) ? json.baseline.summary : null
  const kernel = isObject(json.kernel) ? json.kernel : null
  const conclusion = isObject(json.conclusion) ? json.conclusion : null
  if (!provenance || !conditions || !baseline || !kernel || !conclusion) return fail('C2.6-A RESULT lacks provenance / conditions / baseline.summary / kernel / conclusion')
  if (provenance.formal !== true) issues.push('provenance.formal is not true')
  if (!isObject(json.formalRunValidation) || json.formalRunValidation.valid !== true) issues.push('formalRunValidation.valid is not true')
  if (!isObject(json.oldC2Comparability) || json.oldC2Comparability.valid !== true) issues.push('oldC2Comparability.valid is not true')
  const expected = PHASE2C26A2_REGISTERED_AUTHORITY
  if (kernel.orientations !== expected.orientations) issues.push(`kernel.orientations ${String(kernel.orientations)} is not ${expected.orientations}`)
  const childStatus = isObject(kernel.childStatus) ? kernel.childStatus : {}
  for (const [status, count] of Object.entries(expected.childStatus)) {
    if (childStatus[status] !== count) issues.push(`kernel.childStatus.${status} ${String(childStatus[status])} is not ${count}`)
  }
  if (conclusion.case !== expected.conclusionCase) issues.push(`conclusion.case ${String(conclusion.case)} is not ${expected.conclusionCase}`)

  const orientations = asArray(json.orientations) as Phase2C2Orientation[]
  const rows = asArray(json.perOrientation)
  const outcomeById = new Map<string, string>()
  for (const row of rows) {
    if (!isObject(row) || typeof row.orientationId !== 'string' || !isObject(row.child) || typeof row.child.outcome !== 'string') {
      issues.push('a perOrientation row is malformed')
      continue
    }
    if (outcomeById.has(row.orientationId)) issues.push(`perOrientation duplicates ${row.orientationId}`)
    outcomeById.set(row.orientationId, row.child.outcome)
    const orientation = orientations.find(o => o.orientationId === row.orientationId)
    if (!orientation) {
      issues.push(`perOrientation ${row.orientationId} is not an orientation of the RESULT`)
      continue
    }
    for (const field of ['conflictIndex', 'conflictKey', 'kind', 'fixedBuildListEntryId', 'fixedTargetWeaponId', 'participantTargetWeaponIds'] as const) {
      if (!same(row[field], orientation[field])) issues.push(`perOrientation ${row.orientationId}.${field} differs from orientations`)
    }
  }
  if (orientations.length !== expected.orientations) issues.push(`orientations has ${orientations.length} entries, not ${expected.orientations}`)
  if (new Set(orientations.map(o => o.orientationId)).size !== orientations.length) issues.push('orientations holds a duplicate orientation ID')
  for (const orientation of orientations) if (!outcomeById.has(orientation.orientationId)) issues.push(`no perOrientation row for ${orientation.orientationId}`)
  const derived: Record<string, number> = {}
  for (const outcome of outcomeById.values()) derived[outcome] = (derived[outcome] ?? 0) + 1
  for (const [status, count] of Object.entries(expected.childStatus)) {
    if ((derived[status] ?? 0) !== count) issues.push(`perOrientation holds ${derived[status] ?? 0} ${status} rows, not ${count}`)
  }
  const exportSha256 = provenance.exportSha256
  if (typeof exportSha256 !== 'string') issues.push('provenance.exportSha256 missing')
  const lineage = isObject(conditions.lineage) ? conditions.lineage : null
  if (!lineage) issues.push('conditions.lineage missing')
  for (const field of ['childHeapLimitMb', 'concurrency', 'orientationBudgetMs', 'researchMaxPlanSteps'] as const) {
    if (typeof conditions[field] !== 'number') issues.push(`conditions.${field} missing`)
  }
  if (typeof conditions.nodeYield !== 'string') issues.push('conditions.nodeYield missing')
  if (!isObject(conditions.extent) || !isObject(conditions.bounds) || !isObject(conditions.calculationContext)) issues.push('conditions.extent / bounds / calculationContext missing')
  if (issues.length > 0) return { valid: false, issues, authority: null }
  return {
    valid: true,
    issues: [],
    authority: {
      measuredHead: String(provenance.measuredHead),
      conditions: {
        exportSha256: exportSha256 as string,
        childHeapLimitMb: conditions.childHeapLimitMb as number,
        concurrency: conditions.concurrency as number,
        orientationBudgetMs: conditions.orientationBudgetMs as number,
        nodeYield: conditions.nodeYield as string,
        extent: conditions.extent,
        bounds: conditions.bounds,
        researchMaxPlanSteps: conditions.researchMaxPlanSteps as number,
        calculationContext: conditions.calculationContext,
        lineage: { priorFixedBuildListEntryIds: lineage?.priorFixedBuildListEntryIds, priorExcludedRoutes: lineage?.priorExcludedRoutes },
      },
      baseline: baseline as unknown as Phase2C2BaselineSummary,
      orientations,
      outcomeById,
      timeoutOrientationIds: orientations.map(o => o.orientationId).filter(id => outcomeById.get(id) === 'timeout'),
    },
  }
}

// ---------------------------------------------------------------- current baseline parity

export interface Phase2C26A2BaselineParity {
  valid: boolean
  issues: string[]
  baseline: ReturnType<typeof comparePhase2C26ABaselineWithOldC2>
  orientationSet: ReturnType<typeof comparePhase2C26AOrientationSets>
  orderedIdsMatch: boolean
  /** Timeout orientations whose current orientation is not field-for-field the one the authority recorded. */
  timeoutOrientationMismatches: { orientationId: string; fields: string[] }[]
}

/** The current baseline's own summary and orientations against the authority: counts, order, identity and metadata. */
export function validatePhase2C26A2BaselineParity(current: Phase2C2BaselineSummary, orientations: readonly Phase2C2Orientation[],
  authority: Pick<Phase2C26A2Authority, 'baseline' | 'orientations' | 'timeoutOrientationIds'>): Phase2C26A2BaselineParity {
  const baseline = comparePhase2C26ABaselineWithOldC2(current, orientations.length, authority)
  const orientationSet = comparePhase2C26AOrientationSets(orientations, authority.orientations)
  const orderedIdsMatch = same(orientations.map(o => o.orientationId), authority.orientations.map(o => o.orientationId))
  const currentById = new Map(orientations.map(o => [o.orientationId, o]))
  const timeoutOrientationMismatches: Phase2C26A2BaselineParity['timeoutOrientationMismatches'] = []
  for (const id of authority.timeoutOrientationIds) {
    const recorded = authority.orientations.find(o => o.orientationId === id)
    const now = currentById.get(id)
    if (!recorded || !now) {
      timeoutOrientationMismatches.push({ orientationId: id, fields: ['missing'] })
      continue
    }
    const fields = (['conflictIndex', 'kind', 'fixedTargetWeaponId', ...PHASE2C26A_ORIENTATION_METADATA_FIELDS] as const).filter(field => !same(now[field], recorded[field]))
    if (fields.length > 0) timeoutOrientationMismatches.push({ orientationId: id, fields })
  }
  const issues: string[] = []
  if (!baseline.matches) issues.push(`baseline differs: ${baseline.checks.filter(check => !check.matches).map(check => check.field).join(', ')}`)
  if (!orientationSet.matches) issues.push('orientation identity differs')
  if (orientationSet.auxiliaryMismatches.length > 0) issues.push('orientation metadata (Conflict key / Entry IDs / participant order) differs')
  if (!orderedIdsMatch) issues.push('ordered orientation IDs differ')
  if (timeoutOrientationMismatches.length > 0) issues.push(`timeout orientation metadata differs: ${timeoutOrientationMismatches.map(m => m.orientationId).join(', ')}`)
  return { valid: issues.length === 0, issues, baseline, orientationSet, orderedIdsMatch, timeoutOrientationMismatches }
}

// ---------------------------------------------------------------- run condition parity

export interface Phase2C26A2ConditionParity {
  valid: boolean
  issues: string[]
  checks: { condition: string; current: unknown; authority: unknown; matches: boolean }[]
}

/** Every Phase 2-C2.6-A run condition must be equal; nothing is lengthened, shortened or relaxed. */
export function validatePhase2C26A2ConditionParity(current: Phase2C26A2RunConditions, authority: Pick<Phase2C26A2Authority, 'conditions'>): Phase2C26A2ConditionParity {
  const keys = ['exportSha256', 'childHeapLimitMb', 'concurrency', 'orientationBudgetMs', 'nodeYield', 'extent', 'bounds', 'researchMaxPlanSteps', 'calculationContext', 'lineage'] as const
  const checks = keys.map(condition => ({ condition, current: current[condition], authority: authority.conditions[condition], matches: same(current[condition], authority.conditions[condition]) }))
  const issues = checks.filter(check => !check.matches).map(check => `${check.condition} differs`)
  return { valid: issues.length === 0, issues, checks }
}

// ---------------------------------------------------------------- targeted selection

/** The current baseline's kernel tasks of the authority's timeout orientations, in the current baseline order. */
export function selectPhase2C26A2Tasks(tasks: readonly Phase2C26AKernelTask[], authority: Pick<Phase2C26A2Authority, 'timeoutOrientationIds'>): Phase2C26AKernelTask[] {
  const selected = new Set(authority.timeoutOrientationIds)
  return tasks.filter(task => selected.has(task.orientation.orientationId))
}

export interface Phase2C26A2SelectionValidation {
  valid: boolean
  expected: number
  actual: number
  missing: string[]
  duplicate: string[]
  /** Not an orientation of the authority at all. */
  foreign: string[]
  /** An authority orientation whose Phase 2-C2.6-A child did not time out. */
  nonTimeout: string[]
  metadataMismatches: { orientationId: string; fields: string[] }[]
}

/**
 * The profiled orientation list must be exactly the authority's timeout set: no missing (a subset), duplicate, foreign or
 * non-timeout (a completed sibling) orientation, and each profiled orientation field-for-field the one recorded.
 */
export function validatePhase2C26A2Selection(actual: readonly Phase2C2Orientation[],
  authority: Pick<Phase2C26A2Authority, 'orientations' | 'outcomeById' | 'timeoutOrientationIds'>): Phase2C26A2SelectionValidation {
  const ids = actual.map(o => o.orientationId)
  const seen = new Set<string>(), duplicate = new Set<string>()
  for (const id of ids) (seen.has(id) ? duplicate : seen).add(id)
  const recordedById = new Map(authority.orientations.map(o => [o.orientationId, o]))
  const foreign = [...seen].filter(id => !recordedById.has(id))
  const nonTimeout = [...seen].filter(id => recordedById.has(id) && authority.outcomeById.get(id) !== 'timeout')
  const missing = authority.timeoutOrientationIds.filter(id => !seen.has(id))
  const metadataMismatches: Phase2C26A2SelectionValidation['metadataMismatches'] = []
  for (const orientation of actual) {
    const recorded = recordedById.get(orientation.orientationId)
    if (!recorded) continue
    const fields = Object.keys({ ...recorded, ...orientation }).filter(field =>
      !same((orientation as unknown as Json)[field], (recorded as unknown as Json)[field]))
    if (fields.length > 0) metadataMismatches.push({ orientationId: orientation.orientationId, fields })
  }
  const valid = missing.length === 0 && duplicate.size === 0 && foreign.length === 0 && nonTimeout.length === 0 && metadataMismatches.length === 0
    && ids.length === authority.timeoutOrientationIds.length
  return { valid, expected: authority.timeoutOrientationIds.length, actual: ids.length, missing, duplicate: [...duplicate], foreign, nonTimeout, metadataMismatches }
}

// ---------------------------------------------------------------- stage classification

/** Where a kernel is, read deterministically from its last lifecycle event. */
export const PHASE2C26A2_STAGE_CLASSES = [
  'kernel_preparation', 'search_running', 'trial_preflight', 'full_planner_run', 'trial_postprocessing', 'between_targets', 'after_kernel', 'unknown',
] as const
export type Phase2C26A2StageClass = typeof PHASE2C26A2_STAGE_CLASSES[number]

/**
 * The stage a kernel is in after `lastEventType` until its next event. `null` (no event yet) is the kernel preparation.
 * `trial_started` / `preflight_*` cover materialization, replacement resolution and the preflight; a completed
 * preflight is immediately followed by the full run or the trial result. A completed trial returns to the Search.
 */
export function classifyPhase2C26A2Stage(lastEventType: string | null): Phase2C26A2StageClass {
  switch (lastEventType) {
    case null: return 'kernel_preparation'
    case 'search_started':
    case 'candidate_delivered':
    case 'trial_completed': return 'search_running'
    case 'trial_started':
    case 'preflight_started':
    case 'preflight_completed': return 'trial_preflight'
    case 'full_planner_run_started': return 'full_planner_run'
    case 'full_planner_run_completed': return 'trial_postprocessing'
    case 'target_started':
    case 'target_skipped_checkpoint':
    case 'target_stopped_rerun_bound':
    case 'search_completed':
    case 'target_completed': return 'between_targets'
    case 'kernel_completed': return 'after_kernel'
    default: return 'unknown'
  }
}

export const PHASE2C26A2_RESULT_CLASSES = [
  'completed', 'timeout_in_search', 'timeout_in_preflight', 'timeout_in_full_planner_run', 'timeout_elsewhere', 'out_of_memory', 'process_failure',
] as const
export type Phase2C26A2ResultClass = typeof PHASE2C26A2_RESULT_CLASSES[number]

/** One orientation's result class: the child outcome, and for a timeout the stage it was killed in. */
export function phase2c26a2ResultClass(childOutcome: string, stageAtEnd: Phase2C26A2StageClass): Phase2C26A2ResultClass {
  if (childOutcome === 'completed') return 'completed'
  if (childOutcome === 'out_of_memory') return 'out_of_memory'
  if (childOutcome !== 'timeout') return 'process_failure'
  if (stageAtEnd === 'search_running') return 'timeout_in_search'
  if (stageAtEnd === 'trial_preflight') return 'timeout_in_preflight'
  if (stageAtEnd === 'full_planner_run') return 'timeout_in_full_planner_run'
  return 'timeout_elsewhere'
}

// ---------------------------------------------------------------- in-child progress (observation only)

export interface Phase2C26A2SearchSnapshot {
  settledWorkItems: number
  skill: { streams: number; maxDepth: number; totalStates: number; totalTransitions: number }
  gogma: { streams: number; maxDepth: number; totalGeneratedStates: number; totalFrontierStates: number }
}

/** Compact per-depth aggregate: Skill `[depth, streams, states, transitions]`, Gogma `[depth, streams, generated, frontier, familyLayouts]`. */
export interface Phase2C26A2SearchDepths {
  skill: [number, number, number, number][]
  gogma: [number, number, number, number, number][]
}

export interface Phase2C26A2LifecycleRecord {
  kind: 'lifecycle'
  seq: number
  /** Research-side: `now()` at receipt minus the kernel start. The kernel reads no clock for it. */
  elapsedMs: number
  event: PlannerAlternativeKernelInstrumentationEvent
  predictionCounts: PlannerAlternativePredictionCounts
  /** The Search of the Target this event belongs to, when that Target has one. */
  search: Phase2C26A2SearchSnapshot | null
  /** Only on `search_completed`: that Search's final per-depth aggregate. */
  searchDepths: Phase2C26A2SearchDepths | null
}

export interface Phase2C26A2ProgressCounters {
  startedTargets: number
  completedTargets: number
  deliveredCandidates: number
  trialsStarted: number
  trialsCompleted: number
  fullPlannerRunsStarted: number
  fullPlannerRunsCompleted: number
}

export interface Phase2C26A2Heartbeat {
  kind: 'heartbeat'
  heartbeatSeq: number
  elapsedMs: number
  lastEventSeq: number | null
  lastEventType: string | null
  lastEventElapsedMs: number | null
  stage: Phase2C26A2StageClass
  activeTarget: { targetWeaponId: string; targetOrdinal: number; targetCount: number; startedMs: number } | null
  counters: Phase2C26A2ProgressCounters
  rerunBudget: { used: number; limit: number } | null
  predictionCounts: PlannerAlternativePredictionCounts
  /** Every Search started so far, in Target order. */
  searches: { targetWeaponId: string; targetOrdinal: number; snapshot: Phase2C26A2SearchSnapshot }[]
  /** The per-depth aggregate of the active Target's Search, when it has one. */
  activeSearchDepths: Phase2C26A2SearchDepths | null
}

export interface Phase2C26A2KernelProgress {
  /** Starts the Research clock; call immediately before the kernel is invoked. */
  start(): void
  readonly instrumentation: PlannerAlternativeKernelInstrumentation
  heartbeat(): Phase2C26A2Heartbeat
}

function searchSnapshot(observer: PlannerAlternativeSearchObserver): Phase2C26A2SearchSnapshot {
  const skill = observer.skill(), gogma = observer.gogma()
  return {
    settledWorkItems: observer.settledWorkItems(),
    skill: { streams: skill.streams, maxDepth: skill.maxDepth, totalStates: skill.totalStates, totalTransitions: skill.totalTransitions },
    gogma: { streams: gogma.streams, maxDepth: gogma.maxDepth, totalGeneratedStates: gogma.totalGeneratedStates, totalFrontierStates: gogma.totalFrontierStates },
  }
}

function searchDepths(observer: PlannerAlternativeSearchObserver): Phase2C26A2SearchDepths {
  return {
    skill: observer.skill().depths.map(d => [d.depth, d.streams, d.states, d.transitions]),
    gogma: observer.gogma().depths.map(d => [d.depth, d.streams, d.generatedStates, d.frontierStates, d.familyLayouts]),
  }
}

/**
 * The child-side aggregator of one kernel run. The kernel instrumentation it returns only records: each event becomes
 * one lifecycle record handed to `emit` at once (the runner writes it to disk synchronously and sends it over IPC), and
 * each Target's Search gets its own `createPlannerAlternativeSearchObserver()`, aggregated in memory and read only by
 * `heartbeat()` and the `search_completed` record. Nothing is emitted per Search work item.
 */
export function createPhase2C26A2KernelProgress(options: {
  now: () => number
  predictionCounts: () => PlannerAlternativePredictionCounts
  emit: (record: Phase2C26A2LifecycleRecord) => void
}): Phase2C26A2KernelProgress {
  let origin: number | null = null
  let seq = 0, heartbeatSeq = 0
  let last: { seq: number; type: string; elapsedMs: number } | null = null
  let activeTarget: Phase2C26A2Heartbeat['activeTarget'] = null
  let rerunBudget: Phase2C26A2Heartbeat['rerunBudget'] = null
  const counters: Phase2C26A2ProgressCounters = { startedTargets: 0, completedTargets: 0, deliveredCandidates: 0, trialsStarted: 0, trialsCompleted: 0, fullPlannerRunsStarted: 0, fullPlannerRunsCompleted: 0 }
  const observers = new Map<number, { targetWeaponId: string; observer: PlannerAlternativeSearchObserver }>()
  const elapsed = () => (origin === null ? 0 : options.now() - origin)
  const onEvent = (event: PlannerAlternativeKernelInstrumentationEvent) => {
    const elapsedMs = elapsed()
    if ('budget' in event) rerunBudget = { ...event.budget }
    switch (event.type) {
      case 'target_started':
        counters.startedTargets += 1
        activeTarget = { targetWeaponId: event.targetWeaponId, targetOrdinal: event.targetOrdinal, targetCount: event.targetCount, startedMs: elapsedMs }
        break
      case 'target_completed': counters.completedTargets += 1; break
      case 'candidate_delivered': counters.deliveredCandidates += 1; break
      case 'trial_started': counters.trialsStarted += 1; break
      case 'trial_completed': counters.trialsCompleted += 1; break
      case 'full_planner_run_started': counters.fullPlannerRunsStarted += 1; break
      case 'full_planner_run_completed': counters.fullPlannerRunsCompleted += 1; break
      default: break
    }
    const observed = 'targetOrdinal' in event ? observers.get(event.targetOrdinal) : undefined
    seq += 1
    last = { seq, type: event.type, elapsedMs }
    options.emit({
      kind: 'lifecycle', seq, elapsedMs, event: structuredClone(event), predictionCounts: { ...options.predictionCounts() },
      search: observed ? searchSnapshot(observed.observer) : null,
      searchDepths: observed && event.type === 'search_completed' ? searchDepths(observed.observer) : null,
    })
  }
  return {
    start() { origin = options.now() },
    instrumentation: {
      onEvent,
      searchInstrumentationForTarget: (targetWeaponId, targetOrdinal) => {
        const observer = createPlannerAlternativeSearchObserver()
        observers.set(targetOrdinal, { targetWeaponId, observer })
        return observer.instrumentation
      },
    },
    heartbeat() {
      heartbeatSeq += 1
      const active = activeTarget === null ? undefined : observers.get(activeTarget.targetOrdinal)
      const current = last as { seq: number; type: string; elapsedMs: number } | null
      return {
        kind: 'heartbeat', heartbeatSeq, elapsedMs: elapsed(),
        lastEventSeq: current?.seq ?? null, lastEventType: current?.type ?? null, lastEventElapsedMs: current?.elapsedMs ?? null,
        stage: classifyPhase2C26A2Stage(current?.type ?? null),
        activeTarget: activeTarget === null ? null : { ...activeTarget },
        counters: { ...counters },
        rerunBudget: rerunBudget === null ? null : { ...(rerunBudget as { used: number; limit: number }) },
        predictionCounts: { ...options.predictionCounts() },
        searches: [...observers.entries()].sort(([a], [b]) => a - b)
          .map(([targetOrdinal, { targetWeaponId, observer }]) => ({ targetWeaponId, targetOrdinal, snapshot: searchSnapshot(observer) })),
        activeSearchDepths: active ? searchDepths(active.observer) : null,
      }
    },
  }
}

/** One profiled kernel child calculation: the unchanged Phase 2-C2.6-A kernel helper with the observational instrumentation. */
export function runPhase2C26A2Kernel(input: PlannerInput, task: Phase2C26AKernelTask, dependencies: Phase2C2RunDependencies,
  instrumentation: PlannerAlternativeKernelInstrumentation): Promise<Phase2C2KernelRecord> {
  return runPhase2C26AKernel(input, task, { ...dependencies, kernelInstrumentation: instrumentation })
}
