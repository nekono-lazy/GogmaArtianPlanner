/**
 * Issue #154 Phase 2-C2.6-A4: post-hoc analysis of one raw Planner Alternative Search outer runtime localization run,
 * Research only. Never import from Production.
 *
 * Nothing here runs a Planner or a Search. The raw run is read as untrusted JSON. Section times are the Research child's
 * own `now()` differences between the boundaries the Search reported. Sections nest strictly in the registered hierarchy;
 * each section's exclusive time (inclusive minus its children) maps to exactly one outer category, so the categories are
 * summed without double counting and, with the kernel's own time around the Search and the Search root's own exclusive
 * time, add up to the Search wall time.
 *
 * Observation point. For the primary Search (Target ordinal 0) the times are read at one instant: the kernel's
 * `search_completed` for a finished Search (totals from the Search summary record), otherwise the last heartbeat, whose
 * snapshot carries the completed totals and every open section's elapsed / partial exclusive time measured at the same
 * `now()`. What follows the last heartbeat is reported as unobserved; the open sections at the kill are read from the last
 * durable section-start record and the last heartbeat.
 */
import { stableStringify } from '../domain/models/publicTypes'
import { SEARCH_RUNTIME_SECTION_PARENT as PARENTS } from '../domain/search/searchRuntime'
import type { Phase2C2Orientation } from './plannerGlobalPhase2C2'
import {
  validatePhase2C26A2BaselineParity,
  type Phase2C26A2Authority,
  type Phase2C26A2RunConditions,
} from './plannerGlobalPhase2C26A2'
import { analyzePhase2C26A2Kernel } from './plannerGlobalPhase2C26A2Analysis'
import { validatePhase2C26A3Selection, type Phase2C26A3A2Authority } from './plannerGlobalPhase2C26A3'
import { pearson } from './plannerGlobalPhase2C26A3Analysis'
import {
  PHASE2C26A4_CATEGORY_THRESHOLD,
  PHASE2C26A4_CHILD_HEAP_MB,
  PHASE2C26A4_CONCURRENCY,
  PHASE2C26A4_CONTAINER_SECTIONS,
  PHASE2C26A4_COVERAGE_THRESHOLD,
  PHASE2C26A4_HEARTBEAT_INTERVAL_MS,
  PHASE2C26A4_ORIENTATION_BUDGET_MS,
  PHASE2C26A4_OUTER_CATEGORIES,
  PHASE2C26A4_REGISTERED_PRIMARY_COUNT,
  PHASE2C26A4_SEARCH_INSTRUMENTATION,
  PHASE2C26A4_SECTION_CATEGORY,
  PHASE2C26A4_SECTIONS,
  validatePhase2C26A4ConditionParity,
  type Phase2C26A4A3Authority,
  type Phase2C26A4A3Reference,
  type Phase2C26A4DepthAggregate,
  type Phase2C26A4OuterCategory,
  type Phase2C26A4Section,
  type Phase2C26A4SectionTotals,
} from './plannerGlobalPhase2C26A4'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const round = (value: number | null, digits = 4) => (value === null ? null : Number(value.toFixed(digits)))
type CategoryTotals = Record<Phase2C26A4OuterCategory, number>
const zeroCategories = (): CategoryTotals => Object.fromEntries(PHASE2C26A4_OUTER_CATEGORIES.map(c => [c, 0])) as CategoryTotals
const readSections = (value: unknown): Phase2C26A4SectionTotals => {
  const v = isObject(value) ? value : {}
  return Object.fromEntries(PHASE2C26A4_SECTIONS.map(section => [section, num(v[section]) ?? 0])) as Phase2C26A4SectionTotals
}

function distribution(values: readonly number[]) {
  if (values.length === 0) return { count: 0, min: null, median: null, max: null, total: 0 }
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return { count: sorted.length, min: sorted[0], median: sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2, max: sorted.at(-1) as number,
    total: sorted.reduce((sum, value) => sum + value, 0) }
}

// ---------------------------------------------------------------- raw records

interface WorkSummary {
  seq: number
  targetOrdinal: number
  section: 'bonus_depth_work' | 'skill_depth_work'
  work: { channel: number; depth: number } | null
  counts: { rawSolutions: number; unsupportedPredictions: number; idealSolutions: number; evaluatedSolutions: number; subscriberCount: number; retainedCountAfter: number; exhausted: boolean } | null
  inclusiveMs: number
  phaseMs: Record<string, number>
  startedMs: number
  completedMs: number
}
interface SectionStart { seq: number; elapsedMs: number; targetOrdinal: number; section: Phase2C26A4Section; stack: Phase2C26A4Section[]; work: unknown }

function runtimeRecords(kernel: Json) {
  const records = asArray(kernel.runtime).filter(isObject)
  const starts: SectionStart[] = [], works: WorkSummary[] = [], searches: Json[] = []
  for (const record of records) {
    if (record.kind === 'search_section_started') starts.push(record as unknown as SectionStart)
    else if (record.kind === 'search_work_summary') works.push(record as unknown as WorkSummary)
    else if (record.kind === 'search_summary') searches.push(record)
  }
  const all = [...starts, ...works, ...searches.map(s => ({ ...s, seq: num(s.seq) ?? -1 }))].sort((a, b) => (a.seq as number) - (b.seq as number))
  return { starts, works, searches, all, count: records.length }
}
const heartbeatsOf = (kernel: Json) => asArray(kernel.heartbeats).filter(isObject).filter(record => record.kind === 'heartbeat')

// ---------------------------------------------------------------- formal series validation

export interface Phase2C26A4FormalRunValidation {
  valid: boolean
  failures: string[]
  rawStatus: unknown
  smokeIsNull: boolean
  uncommittedBenchmarkCode: unknown
  c26aShaMatches: boolean
  a2ShaMatches: boolean
  a3ShaMatches: boolean
  exportShaMatches: boolean
  searchInstrumentation: unknown
  baselineParity: ReturnType<typeof validatePhase2C26A2BaselineParity> | null
  conditionParity: ReturnType<typeof validatePhase2C26A4ConditionParity> | null
  selection: ReturnType<typeof validatePhase2C26A3Selection> | null
  recordIssues: { orientationId: string; issue: string }[]
  unknownStatuses: string[]
}

/**
 * The raw run is the formal A4 series only when it is a clean, non-smoke run of committed code against the same three
 * authority files and Export, at the registered heap / concurrency 1 / budget / heartbeat with the section boundary
 * observer as the only Search instrumentation, the analyzer's own re-derivation of the baseline, condition and selection
 * parity passes, and every kernel child left well-formed lifecycle and runtime streams with no contract violation.
 */
export function validatePhase2C26A4FormalRun(raw: unknown, c26a: Phase2C26A2Authority, a2: Phase2C26A3A2Authority, a3: Phase2C26A4A3Authority,
  shas: { c26a: string; a2: string; a3: string }): Phase2C26A4FormalRunValidation {
  const failures: string[] = []
  const r = isObject(raw) ? raw : {}
  const environment = isObject(r.environment) ? r.environment : {}
  if (r.status !== 'completed') failures.push(`raw status is ${String(r.status)}`)
  const smokeIsNull = environment.smoke === null
  if (!smokeIsNull) failures.push('a smoke run is never formal')
  if (environment.uncommittedBenchmarkCode !== false) failures.push('benchmark code was not committed')
  const c26aShaMatches = environment.c26aResultSha256 === shas.c26a
  if (!c26aShaMatches) failures.push('the raw run was not made against this C2.6-A RESULT')
  const a2ShaMatches = environment.c26a2ResultSha256 === shas.a2
  if (!a2ShaMatches) failures.push('the raw run was not made against this C2.6-A2 RESULT')
  const a3ShaMatches = environment.c26a3ResultSha256 === shas.a3
  if (!a3ShaMatches) failures.push('the raw run was not made against this C2.6-A3 RESULT')
  const exportShaMatches = environment.exportSha256 === c26a.conditions.exportSha256 && environment.exportSha256 === a3.conditions.exportSha256
  if (!exportShaMatches) failures.push('Export SHA-256 differs from the authorities')
  const searchInstrumentation = environment.searchInstrumentation
  if (stableStringify(searchInstrumentation) !== stableStringify(PHASE2C26A4_SEARCH_INSTRUMENTATION)) failures.push('the Search instrumentation is not the section boundary observer alone')
  if (environment.childHeapLimitMb !== PHASE2C26A4_CHILD_HEAP_MB || environment.concurrency !== PHASE2C26A4_CONCURRENCY || environment.orientationBudgetMs !== PHASE2C26A4_ORIENTATION_BUDGET_MS
    || environment.heartbeatIntervalMs !== PHASE2C26A4_HEARTBEAT_INTERVAL_MS) failures.push('run environment is not the registered heap / concurrency 1 / budget / heartbeat')

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
    conditionParity = validatePhase2C26A4ConditionParity(current, a3.conditions, c26a, a2.conditions)
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
    a3.primaryOrientationIds, c26a)
  if (!selection.valid) failures.push('the profiled orientations are not exactly the A3 primary set')
  if (a3.primaryOrientationIds.length !== PHASE2C26A4_REGISTERED_PRIMARY_COUNT) failures.push('the primary count is not the registered one')

  const recordIssues: Phase2C26A4FormalRunValidation['recordIssues'] = []
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
    const { all, count, searches } = runtimeRecords(kernel)
    if (all.length === 0) recordIssues.push({ orientationId: id, issue: 'no runtime record' })
    if (all.length !== count || all.some((record, index) => record.seq !== index + 1)) recordIssues.push({ orientationId: id, issue: 'runtime sequence is not contiguous from 1' })
    const heartbeats = heartbeatsOf(kernel)
    if (heartbeats.length === 0) recordIssues.push({ orientationId: id, issue: 'no heartbeat' })
    const runtime = isObject(heartbeats.at(-1)?.searchRuntime) ? heartbeats.at(-1)?.searchRuntime as Json : null
    if (runtime === null) recordIssues.push({ orientationId: id, issue: 'last heartbeat has no Search runtime' })
    else if (runtime.contractViolations !== 0) recordIssues.push({ orientationId: id, issue: `${String(runtime.contractViolations)} boundary contract violations` })
    for (const search of searches) {
      const totals = isObject(search.totals) ? search.totals : {}
      if (num(totals.searchesCompleted) === null) recordIssues.push({ orientationId: id, issue: 'malformed Search summary' })
    }
  }
  if (recordIssues.length > 0) failures.push('record stream issues')
  if (unknownStatuses.length > 0) failures.push('unknown child status')
  return { valid: failures.length === 0, failures, rawStatus: r.status, smokeIsNull, uncommittedBenchmarkCode: environment.uncommittedBenchmarkCode,
    c26aShaMatches, a2ShaMatches, a3ShaMatches, exportShaMatches, searchInstrumentation, baselineParity, conditionParity, selection, recordIssues, unknownStatuses }
}

// ---------------------------------------------------------------- one orientation

export interface Phase2C26A4SectionRow {
  section: Phase2C26A4Section
  parent: Phase2C26A4Section | null
  inclusiveMs: number
  exclusiveMs: number
  count: number
  exclusiveShare: number
}

export interface Phase2C26A4ActiveAtEnd {
  /** `section` = a durable section had started and its work / Search never completed afterwards. */
  where: 'section' | 'after_record' | 'none'
  lastDurable: { section: Phase2C26A4Section; stack: Phase2C26A4Section[]; work: unknown; startedMs: number } | null
  /** The open stack of the last heartbeat (up to one heartbeat interval before the kill). */
  lastHeartbeatStack: { section: Phase2C26A4Section; elapsedMs: number; work: unknown }[]
  lastHeartbeatAtMs: number | null
  /** Estimated from the parent's kill time and the IPC clock offset (null for a completed child). */
  killElapsedEstimateMs: number | null
  lastDurableElapsedAtKillEstimateMs: number | null
}

export interface Phase2C26A4OrientationAnalysis {
  orientationId: string
  kind: string
  childOutcome: string
  resultClass: string
  primarySearch: {
    targetWeaponId: string | null
    completed: boolean
    observationPoint: 'search_completed' | 'last_heartbeat'
    observedAtMs: number
    searchStartedMs: number
    /** Search own wall time up to the observation point (trials inside it excluded), the A3 denominator. */
    searchWallMs: number
    searchWallAtKillEstimateMs: number | null
    unobservedTailMs: number | null
    /** The Search root's inclusive time at the observation point. */
    searchRuntimeInclusiveMs: number
    trialMsExcluded: number
    categoryTotalsMs: CategoryTotals
    categoryShare: Record<Phase2C26A4OuterCategory, number>
    measuredMs: number
    coverage: number
    /** Leaf sections only (container remainders, i.e. queue dispatch and the work items' own time, excluded). */
    strictCoverage: number
    unattributedSearchMs: number
    unattributedSearchShare: number
    maxCategory: Phase2C26A4OuterCategory
    maxCategoryShare: number
    groups: Record<string, { ms: number; share: number }>
    sections: Phase2C26A4SectionRow[]
    routeRegistration: { normalMs: number; ownedNormalMs: number; existingGogmaMs: number; ownMs: number }
    workCounts: Record<string, number>
    bonusDepth: Phase2C26A4DepthAggregate
    skillDepth: Phase2C26A4DepthAggregate
  } | null
  activeAtEnd: Phase2C26A4ActiveAtEnd
  counters: Json
  /** Per completed Bonus depth work of the primary Search. */
  bonusWork: {
    works: number
    phaseDistributions: Record<string, { count: number; totalMs: number; minMs: number | null; medianMs: number | null; maxMs: number | null }>
    nsPerRawSolution: Record<string, { count: number; min: number | null; median: number | null; max: number | null }>
    correlations: Record<string, number | null>
    maxRawSolutionsWork: { channel: number | null; depth: number | null; rawSolutions: number } | null
  }
  a3Reference: Phase2C26A4A3Reference | null
  memory: Json
  heartbeats: number
  maxHeartbeatGapMs: number | null
  predictionCounts: Json
  laterTargets: { targetOrdinal: number; state: string; searchOwnMs: number | null }[]
}

const BONUS_OUTER_PHASES = ['bonus_depth_read', 'bonus_notice_scan', 'bonus_ideal_filter', 'bonus_route_materialization', 'bonus_evaluate_sort',
  'bonus_channel_publication', 'bonus_depth_advance', 'self'] as const

/** One kernel child: the A2 lifecycle view plus the hierarchical Search timing of its primary Search. */
export function analyzePhase2C26A4Kernel(kernel: unknown, sha256: (value: string) => string, a3Reference: Phase2C26A4A3Reference | null): Phase2C26A4OrientationAnalysis {
  const k = isObject(kernel) ? kernel : {}
  const lifecycle = analyzePhase2C26A2Kernel(k, sha256)
  const process = isObject(k.process) ? k.process : {}
  const ipc = isObject(process.ipc) ? process.ipc : {}
  const { starts, works, searches } = runtimeRecords(k)
  const heartbeats = heartbeatsOf(k)
  const primaryTarget = lifecycle.targets.find(target => target.targetOrdinal === 0) ?? null
  const primaryWorks = works.filter(w => w.targetOrdinal === 0)
  const lastHeartbeat = heartbeats.at(-1) ?? null
  const lastSnapshot = isObject(lastHeartbeat?.searchRuntime) ? lastHeartbeat?.searchRuntime as Json : null

  // The open sections at the kill.
  const origin = isObject(ipc.kernelInvoked) ? num(ipc.kernelInvoked.originChildProcessMs) : null
  const offset = num(ipc.minClockOffsetMs)
  const killedAt = num(process.killedAtMs)
  const killElapsed = killedAt !== null && origin !== null && offset !== null ? killedAt - origin - offset : null
  const lastStart = starts.at(-1) ?? null
  const lastWorkAfter = lastStart !== null && works.some(w => w.seq > lastStart.seq)
  const lastSearchAfter = lastStart !== null && searches.some(s => (num(s.seq) ?? -1) > lastStart.seq)
  const activeAtEnd: Phase2C26A4ActiveAtEnd = {
    where: lifecycle.childOutcome === 'completed' || lastStart === null ? 'none' : (lastWorkAfter || lastSearchAfter ? 'after_record' : 'section'),
    lastDurable: lastStart === null ? null : { section: lastStart.section, stack: lastStart.stack, work: lastStart.work, startedMs: lastStart.elapsedMs },
    lastHeartbeatStack: asArray(lastSnapshot?.activeStack).filter(isObject).map(f => ({ section: f.section as Phase2C26A4Section, elapsedMs: num(f.elapsedMs) ?? 0, work: f.work ?? null })),
    lastHeartbeatAtMs: num(lastSnapshot?.atMs),
    killElapsedEstimateMs: lifecycle.childOutcome === 'completed' ? null : killElapsed,
    lastDurableElapsedAtKillEstimateMs: lifecycle.childOutcome === 'completed' || killElapsed === null || lastStart === null ? null : killElapsed - lastStart.elapsedMs,
  }

  let primarySearch: Phase2C26A4OrientationAnalysis['primarySearch'] = null
  if (primaryTarget && primaryTarget.searchStartMs !== null) {
    const completed = primaryTarget.searchEndMs !== null
    let observedAtMs: number, inclusive: Phase2C26A4SectionTotals, exclusive: Phase2C26A4SectionTotals, settleWithoutWorkMs: number
    let counts: Phase2C26A4SectionTotals, bonusDepth: Phase2C26A4DepthAggregate, skillDepth: Phase2C26A4DepthAggregate, settleWithoutWorkCount: number
    const target0 = (list: unknown) => asArray(list).filter(isObject).find(t => t.targetOrdinal === 0) ?? {}
    if (completed) {
      observedAtMs = primaryTarget.searchEndMs as number
      const summary = searches.find(s => s.targetOrdinal === 0)
      const totals = isObject(summary?.totals) ? summary.totals : {}
      inclusive = readSections(totals.inclusiveMs); exclusive = readSections(totals.exclusiveMs); counts = readSections(totals.sectionCounts)
      const settle = isObject(totals.settleWithoutWork) ? totals.settleWithoutWork : {}
      settleWithoutWorkMs = num(settle.inclusiveMs) ?? 0; settleWithoutWorkCount = num(settle.count) ?? 0
      bonusDepth = totals.bonusDepth as unknown as Phase2C26A4DepthAggregate; skillDepth = totals.skillDepth as unknown as Phase2C26A4DepthAggregate
    } else {
      observedAtMs = num(lastSnapshot?.atMs) ?? num(lastHeartbeat?.elapsedMs) ?? 0
      const observed = target0(lastSnapshot?.observed)
      inclusive = readSections(observed.inclusiveMs); exclusive = readSections(observed.exclusiveMs)
      settleWithoutWorkMs = num(observed.settleWithoutWorkMs) ?? 0
      const byTarget = target0(lastSnapshot?.byTarget)
      counts = readSections(byTarget.sectionCounts)
      const settle = isObject(byTarget.settleWithoutWork) ? byTarget.settleWithoutWork : {}
      settleWithoutWorkCount = num(settle.count) ?? 0
      bonusDepth = byTarget.bonusDepth as unknown as Phase2C26A4DepthAggregate; skillDepth = byTarget.skillDepth as unknown as Phase2C26A4DepthAggregate
    }
    const trialMs = primaryTarget.trials.reduce((sum, trial) => sum + (Math.min(trial.endMs ?? observedAtMs, observedAtMs) - trial.startMs), 0)
    const windowMs = observedAtMs - (primaryTarget.searchStartMs as number)
    const searchWallMs = windowMs - trialMs
    const runtimeInclusive = inclusive.search_runtime
    const categories = zeroCategories()
    for (const section of PHASE2C26A4_SECTIONS) {
      const category = PHASE2C26A4_SECTION_CATEGORY[section]
      if (category !== null) categories[category] += exclusive[section]
    }
    categories.route_base_work = settleWithoutWorkMs
    categories.queue_dispatch_or_unclassified -= settleWithoutWorkMs
    categories.kernel_search_wrapper = windowMs - runtimeInclusive
    // Trials run inside the consumer callback; the A3 denominator excludes them, so the delivery category does too.
    const trialAdjustment = Math.min(trialMs, Math.max(0, exclusive.delivery_consumer))
    categories.delivery -= trialAdjustment
    const measured = PHASE2C26A4_OUTER_CATEGORIES.reduce((sum, c) => sum + categories[c], 0)
    const strictMeasured = PHASE2C26A4_SECTIONS.filter(s => !PHASE2C26A4_CONTAINER_SECTIONS.has(s)).reduce((sum, s) => sum + exclusive[s], 0)
      - trialAdjustment + settleWithoutWorkMs + categories.kernel_search_wrapper
    const share = (ms: number) => (searchWallMs <= 0 ? 0 : ms / searchWallMs)
    const maxCategory = PHASE2C26A4_OUTER_CATEGORIES.reduce((best, c) => (categories[c] > categories[best] ? c : best), PHASE2C26A4_OUTER_CATEGORIES[0])
    const atKill = !completed && killElapsed !== null ? killElapsed - (primaryTarget.searchStartMs as number) - trialMs : null
    const group = (ms: number) => ({ ms, share: share(ms) })
    const bonusWorkInclusive = inclusive.bonus_depth_work
    primarySearch = {
      targetWeaponId: primaryTarget.targetWeaponId, completed, observationPoint: completed ? 'search_completed' : 'last_heartbeat', observedAtMs,
      searchStartedMs: primaryTarget.searchStartMs as number, searchWallMs, searchWallAtKillEstimateMs: atKill, unobservedTailMs: atKill === null ? null : atKill - searchWallMs,
      searchRuntimeInclusiveMs: runtimeInclusive, trialMsExcluded: trialAdjustment,
      categoryTotalsMs: categories, categoryShare: Object.fromEntries(PHASE2C26A4_OUTER_CATEGORIES.map(c => [c, share(categories[c])])) as Record<Phase2C26A4OuterCategory, number>,
      measuredMs: measured, coverage: share(measured), strictCoverage: share(strictMeasured), unattributedSearchMs: searchWallMs - measured,
      unattributedSearchShare: share(searchWallMs - measured), maxCategory, maxCategoryShare: share(categories[maxCategory]),
      groups: {
        bonus_depth_work_inclusive: group(bonusWorkInclusive),
        bonus_post_read: group(bonusWorkInclusive - inclusive.bonus_depth_read - exclusive.cross_add_bonus),
        skill_total: group(categories.skill_depth),
        lazy_cross_total: group(categories.lazy_cross),
        composition_total: group(categories.composition),
        delivery_total: group(categories.delivery),
        scheduler_checkpoint: group(categories.scheduler_checkpoint),
        queue_dispatch_or_unclassified: group(categories.queue_dispatch_or_unclassified),
        route_base_work: group(categories.route_base_work),
        initial_route_registration: group(categories.initial_route_registration),
      },
      sections: PHASE2C26A4_SECTIONS.map(section => ({ section, parent: null, inclusiveMs: inclusive[section], exclusiveMs: exclusive[section], count: counts[section],
        exclusiveShare: share(exclusive[section]) })),
      routeRegistration: { normalMs: inclusive.normal_route_registration, ownedNormalMs: inclusive.owned_normal_route_registration,
        existingGogmaMs: inclusive.existing_gogma_route_registration, ownMs: exclusive.route_registration },
      workCounts: {
        schedulerSteps: counts.scheduler_step, bonusDepthWorks: counts.bonus_depth_work, skillDepthWorks: counts.skill_depth_work, compositionWorks: counts.composition_work,
        crossWakeWorks: counts.cross_wake_work, routeBaseWorks: settleWithoutWorkCount, crossAddBonus: counts.cross_add_bonus, crossAddSkill: counts.cross_add_skill,
        crossOpenNext: counts.cross_open_next, deliveryFlushes: counts.delivery_flush, deliveryConsumerCalls: counts.delivery_consumer,
      },
      bonusDepth, skillDepth,
    }
    for (const row of primarySearch.sections) row.parent = PARENTS[row.section]
  }

  // Per completed Bonus depth work of the primary Search.
  const bonusWorks = primaryWorks.filter(w => w.section === 'bonus_depth_work')
  const phaseMs = (w: WorkSummary, phase: string) => num(w.phaseMs[phase]) ?? 0
  const phaseDistributions = Object.fromEntries(BONUS_OUTER_PHASES.map(phase => {
    const dist = distribution(bonusWorks.map(w => phaseMs(w, phase)))
    return [phase, { count: dist.count, totalMs: dist.total, minMs: dist.min, medianMs: dist.median, maxMs: dist.max }]
  }))
  const withRaw = bonusWorks.filter(w => (w.counts?.rawSolutions ?? 0) > 0)
  const raw = (w: WorkSummary) => w.counts?.rawSolutions ?? 0
  const nsPer = (phase: string) => {
    const dist = distribution(withRaw.map(w => (phaseMs(w, phase) * 1e6) / raw(w)))
    return { count: dist.count, min: round(dist.min, 2), median: round(dist.median, 2), max: round(dist.max, 2) }
  }
  const maxRaw = bonusWorks.reduce<WorkSummary | null>((best, w) => (best === null || raw(w) > raw(best) ? w : best), null)
  let maxGap: number | null = null
  for (let i = 1; i < heartbeats.length; i += 1) maxGap = Math.max(maxGap ?? 0, (num(heartbeats[i].elapsedMs) ?? 0) - (num(heartbeats[i - 1].elapsedMs) ?? 0))
  return {
    orientationId: lifecycle.orientationId, kind: lifecycle.kind, childOutcome: lifecycle.childOutcome, resultClass: lifecycle.resultClass,
    primarySearch, activeAtEnd, counters: lifecycle.counters as unknown as Json,
    bonusWork: {
      works: bonusWorks.length,
      phaseDistributions,
      nsPerRawSolution: Object.fromEntries(BONUS_OUTER_PHASES.map(phase => [phase, nsPer(phase)])),
      correlations: Object.fromEntries(BONUS_OUTER_PHASES.map(phase => [`rawSolutions_vs_${phase}`, round(pearson(withRaw.map(raw), withRaw.map(w => phaseMs(w, phase))))])),
      maxRawSolutionsWork: maxRaw === null ? null : { channel: maxRaw.work?.channel ?? null, depth: maxRaw.work?.depth ?? null, rawSolutions: raw(maxRaw) },
    },
    a3Reference,
    memory: lifecycle.memory as unknown as Json, heartbeats: heartbeats.length, maxHeartbeatGapMs: maxGap,
    predictionCounts: lifecycle.predictionCounts as unknown as Json,
    laterTargets: lifecycle.targets.filter(t => t.targetOrdinal > 0).map(t => ({ targetOrdinal: t.targetOrdinal, state: t.state, searchOwnMs: t.searchOwnMs })),
  }
}


// ---------------------------------------------------------------- decision

export type Phase2C26A4DecisionCase = 'O_outer_bottleneck' | 'I_inner_read_dominant' | 'U_instrumentation_gap' | 'M_mixed'

export const PHASE2C26A4_RECOMMENDATION: Record<Phase2C26A4OuterCategory, string> = {
  kernel_search_wrapper: 'kernel側のSearch呼び出し前後を局所化',
  search_setup: 'Search setup（context / stream / scheduler構築）を局所化',
  initial_route_registration: 'Route base登録（Normal / Owned Normal / Existing Gogma別）を詳細化',
  scheduler_checkpoint: 'scheduler checkpoint（cancel / yield間隔）を詳細化',
  queue_dispatch_or_unclassified: 'SearchWorkQueue dispatch（heap操作）を詳細化',
  scheduler_post_settle: 'scheduler post-settle signalを詳細化',
  route_base_work: 'Route search primitiveが登録するRoute base work（Normal offset予測、conversion base）を詳細化',
  bonus_depth_read: 'held-aware Gogma readReservedDepth内部（A3: frontier_reduction_sort / state_generation）を詳細化',
  bonus_notice_scan: 'raw solution全件のroute_kind notice走査（JSON.stringify dedup）を最適化設計',
  bonus_ideal_filter: 'raw solution全件のsatisfiesIdealBonuses() filterを最適化設計',
  bonus_route_materialization: 'Ideal Bonus solutionのoperation / amendment materializationを最適化設計',
  bonus_evaluate_sort: 'evaluateBonusSolutions()を最適化設計',
  bonus_channel_publication: 'Bonus channel retention / subscriber publicationを最適化設計',
  bonus_depth_advance: 'depth advance / extent判定を詳細化',
  bonus_depth_work_other: 'Bonus depth work内の未分類時間を詳細化',
  skill_depth: 'Skill depth workを詳細化',
  lazy_cross: 'Lazy Ideal Cross（addBonus / addSkill / openNext / wake）を詳細化',
  composition: 'composition（checkpoint / compose / Candidate materialization）を詳細化',
  delivery: 'delivery flush（sort / key dedup / consumer）を詳細化',
}

/**
 * The pre-registered rule over the primary Searches (registered count 3, majority 2, coverage threshold 0.90, category
 * threshold 0.10 of the Search wall time), evaluated in this order:
 * - U: at least 2 have coverage < 0.90 -> instrumentation gap; localize the remaining unattributed boundary.
 * - O: among the covered primaries (coverage >= 0.90), at least 2 share an outer category other than `bonus_depth_read`
 *   with share >= 0.10 -> outer bottleneck identified (every such category is listed; the largest pooled one leads).
 * - I: at least 2 covered primaries have `bonus_depth_read` as the largest category and every other category < 0.10 ->
 *   return to A3's inner evidence (frontier_reduction_sort / state_generation).
 * - M: otherwise (the covered primaries' largest categories differ) -> mixed context; no optimization.
 */
export function phase2c26a4Decision(rows: readonly Phase2C26A4OrientationAnalysis[]) {
  const majority = 2
  const searches = rows.map(row => ({ orientationId: row.orientationId, search: row.primarySearch }))
  const covered = searches.filter(s => s.search !== null && s.search.coverage >= PHASE2C26A4_COVERAGE_THRESHOLD)
  const uncovered = searches.filter(s => s.search === null || s.search.coverage < PHASE2C26A4_COVERAGE_THRESHOLD)
  const outerCandidates = PHASE2C26A4_OUTER_CATEGORIES.filter(c => c !== 'bonus_depth_read')
    .map(category => ({ category, primaries: covered.filter(s => (s.search?.categoryShare[category] ?? 0) >= PHASE2C26A4_CATEGORY_THRESHOLD).map(s => s.orientationId),
      pooledShare: pooledShare(rows, category) }))
    .filter(c => c.primaries.length >= majority)
    .sort((a, b) => b.pooledShare - a.pooledShare)
  const readDominant = covered.filter(s => s.search !== null && s.search.maxCategory === 'bonus_depth_read'
    && PHASE2C26A4_OUTER_CATEGORIES.every(c => c === 'bonus_depth_read' || (s.search?.categoryShare[c] ?? 0) < PHASE2C26A4_CATEGORY_THRESHOLD))
  let decision: { case: Phase2C26A4DecisionCase; category: Phase2C26A4OuterCategory | null; reason: string; recommendation: string }
  if (rows.length !== PHASE2C26A4_REGISTERED_PRIMARY_COUNT) {
    decision = { case: 'M_mixed', category: null, reason: `primary count ${rows.length} is not the registered ${PHASE2C26A4_REGISTERED_PRIMARY_COUNT}`, recommendation: 'fail closed: no decision' }
  } else if (uncovered.length >= majority) {
    decision = { case: 'U_instrumentation_gap', category: null,
      reason: `coverage < ${PHASE2C26A4_COVERAGE_THRESHOLD} in ${uncovered.length} / ${rows.length} primaries (${uncovered.map(s => s.orientationId).join(', ')})`,
      recommendation: '残りのunattributed境界を追加局所化する。optimizationへ進まない。' }
  } else if (outerCandidates.length > 0) {
    const lead = outerCandidates[0]
    decision = { case: 'O_outer_bottleneck', category: lead.category,
      reason: `coverage >= ${PHASE2C26A4_COVERAGE_THRESHOLD} and ${outerCandidates.map(c => `${c.category} >= ${PHASE2C26A4_CATEGORY_THRESHOLD} in ${c.primaries.join(', ')}`).join('; ')}`,
      recommendation: `${lead.category}: ${PHASE2C26A4_RECOMMENDATION[lead.category]}（次Phaseで詳細化またはoptimization設計。本Phaseではoptimizationしない）` }
  } else if (readDominant.length >= majority) {
    decision = { case: 'I_inner_read_dominant', category: 'bonus_depth_read',
      reason: `coverage >= ${PHASE2C26A4_COVERAGE_THRESHOLD}, bonus_depth_read is the largest category and every other category < ${PHASE2C26A4_CATEGORY_THRESHOLD} in ${readDominant.map(s => s.orientationId).join(', ')}`,
      recommendation: 'A3のinner evidenceを再利用し、frontier_reduction_sort / state_generationの詳細局所化へ戻る。' }
  } else {
    decision = { case: 'M_mixed', category: null,
      reason: `no outer category reaches ${PHASE2C26A4_CATEGORY_THRESHOLD} in ${majority} covered primaries and bonus_depth_read is not uniformly dominant (${covered.map(s => `${s.orientationId}:${s.search?.maxCategory}`).join(', ')})`,
      recommendation: '次Phaseでcontext差の原因を局所化。optimizationへ進まない。' }
  }
  return {
    coverageThreshold: PHASE2C26A4_COVERAGE_THRESHOLD, categoryThreshold: PHASE2C26A4_CATEGORY_THRESHOLD, majority,
    coverage: Object.fromEntries(searches.map(s => [s.orientationId, s.search === null ? null : round(s.search.coverage)])),
    maxCategoryByPrimary: Object.fromEntries(searches.map(s => [s.orientationId, s.search?.maxCategory ?? null])),
    maxCategoryConsistentAcrossPrimaries: searches.every(s => s.search !== null && s.search.maxCategory === searches[0].search?.maxCategory),
    outerCandidates: outerCandidates.map(c => ({ ...c, pooledShare: round(c.pooledShare) })),
    ...decision,
  }
}

function pooledShare(rows: readonly Phase2C26A4OrientationAnalysis[], category: Phase2C26A4OuterCategory): number {
  let wall = 0, ms = 0
  for (const row of rows) { if (!row.primarySearch) continue; wall += row.primarySearch.searchWallMs; ms += row.primarySearch.categoryTotalsMs[category] }
  return wall === 0 ? 0 : ms / wall
}

export function summarizePhase2C26A4(rows: readonly Phase2C26A4OrientationAnalysis[]) {
  const totals = zeroCategories()
  let searchWall = 0, measured = 0
  for (const row of rows) {
    if (!row.primarySearch) continue
    for (const c of PHASE2C26A4_OUTER_CATEGORIES) totals[c] += row.primarySearch.categoryTotalsMs[c]
    searchWall += row.primarySearch.searchWallMs
    measured += row.primarySearch.measuredMs
  }
  return {
    orientations: rows.length,
    childStatus: Object.fromEntries(['completed', 'out_of_memory', 'timeout', 'process_failure'].map(s => [s, rows.filter(r => r.childOutcome === s).length])),
    primarySearchCompleted: rows.filter(r => r.primarySearch?.completed === true).length,
    categoryTotalsMs: totals,
    categoryShareOfSearchWall: Object.fromEntries(PHASE2C26A4_OUTER_CATEGORIES.map(c => [c, searchWall === 0 ? 0 : round(totals[c] / searchWall)])),
    searchWallMs: searchWall,
    measuredMs: measured,
    pooledCoverage: searchWall === 0 ? null : round(measured / searchWall),
    unattributedSearchMs: searchWall - measured,
    decision: phase2c26a4Decision(rows),
  }
}
