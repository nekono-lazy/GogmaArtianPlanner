/**
 * Issue #154 Phase 2-C2.6-A4: Planner Alternative Search outer runtime localization, Research only. Never import from
 * Production.
 *
 * Phase 2-C2.6-A3 timed the six sections inside the held-aware Gogma `readReservedDepth()` and explained 67-71 % of the
 * primary Search wall time; about 30 % stayed outside those sections. This phase times the whole Search as one strict
 * hierarchy instead: `visitPlannerAlternativeCandidates()` and `TargetSearchScheduler` report the boundaries of the
 * sections registered in `SEARCH_RUNTIME_SECTION_PARENT` (Search root, setup, Route registration, each scheduler step and
 * the work it settles, the Bonus / Skill depth work outer phases, the Lazy Ideal Cross, composition, delivery) through
 * `PlannerAlternativeSearchInstrumentation.onSearchRuntime`, with no clock inside the Domain; the Research child stamps
 * each boundary with its own `now()` and keeps inclusive and exclusive time per section (exclusive = inclusive minus the
 * children), so nothing is counted twice. The whole `readReservedDepth()` is one leaf here (`bonus_depth_read`); A3's
 * inner sections are not re-timed (their observer is not attached), and A3's evidence is only referenced, never added.
 *
 * Authorities. The committed Phase 2-C2.6-A3 RESULT (formal, Case R) is the primary selection authority; it must have
 * been made against exactly the committed Phase 2-C2.6-A2 and C2.6-A RESULT files read, which stay the A2 rule and the
 * baseline / condition parity authorities. No orientation ID is fixed here.
 *
 * Conditions. Every A3 condition (heap, budget, concurrency 1, yield, extent, bounds, Research maxPlanSteps,
 * CalculationContext, empty lineage) is unchanged; only the Search instrumentation differs, so no absolute wall time is
 * compared with A3 - only the composition of each A4 run's own Search wall time.
 */
import { stableStringify } from '../domain/models/publicTypes'
import type {
  PlannerAlternativeKernelInstrumentation,
  PlannerAlternativeKernelInstrumentationEvent,
} from '../domain/planner/alternative'
import type { PlannerInput } from '../domain/planner/plannerTypes'
import {
  SEARCH_RUNTIME_SECTION_PARENT,
  SEARCH_RUNTIME_SECTIONS,
  type SearchRuntimeDepthCounts,
  type SearchRuntimeDepthWork,
  type SearchRuntimeEvent,
  type SearchRuntimeObserver,
  type SearchRuntimeSection,
} from '../domain/search/searchRuntime'
import type { PlannerAlternativePredictionCounts } from './plannerAlternativeBenchmarkProtocol'
import type { Phase2C2KernelRecord, Phase2C2RunDependencies } from './plannerGlobalPhase2C2'
import { runPhase2C26AKernel, type Phase2C26AKernelTask } from './plannerGlobalPhase2C26A'
import {
  classifyPhase2C26A2Stage,
  type Phase2C26A2Authority,
  type Phase2C26A2LifecycleRecord,
  type Phase2C26A2ProgressCounters,
  type Phase2C26A2RunConditions,
  type Phase2C26A2StageClass,
} from './plannerGlobalPhase2C26A2'
import {
  PHASE2C26A3_CHILD_HEAP_MB,
  PHASE2C26A3_CONCURRENCY,
  PHASE2C26A3_HEARTBEAT_INTERVAL_MS,
  PHASE2C26A3_MEMORY_SAMPLE_INTERVAL_MS,
  PHASE2C26A3_NODE_YIELD,
  PHASE2C26A3_ORIENTATION_BUDGET_MS,
  PHASE2C26A3_PHASES,
  validatePhase2C26A3ConditionParity,
  type Phase2C26A3A2Authority,
  type Phase2C26A3Phase,
} from './plannerGlobalPhase2C26A3'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const same = (a: unknown, b: unknown) => stableStringify(a) === stableStringify(b)

export const PHASE2C26A4_SECTIONS = SEARCH_RUNTIME_SECTIONS
export type Phase2C26A4Section = SearchRuntimeSection

// ---------------------------------------------------------------- conditions

/** Phase 2-C2.6-A3's heap, budget, concurrency 1, yield, memory sampling and heartbeat, unchanged. */
export const PHASE2C26A4_CHILD_HEAP_MB = PHASE2C26A3_CHILD_HEAP_MB
export const PHASE2C26A4_ORIENTATION_BUDGET_MS = PHASE2C26A3_ORIENTATION_BUDGET_MS
export const PHASE2C26A4_CONCURRENCY = PHASE2C26A3_CONCURRENCY
export const PHASE2C26A4_NODE_YIELD = PHASE2C26A3_NODE_YIELD
export const PHASE2C26A4_MEMORY_SAMPLE_INTERVAL_MS = PHASE2C26A3_MEMORY_SAMPLE_INTERVAL_MS
export const PHASE2C26A4_HEARTBEAT_INTERVAL_MS = PHASE2C26A3_HEARTBEAT_INTERVAL_MS
/** The registered coverage threshold (A3: 0.80; A4 bounds the whole Search, so 0.90). */
export const PHASE2C26A4_COVERAGE_THRESHOLD = 0.9
/** The registered share of the Search wall time an outer category must reach to be a bottleneck. */
export const PHASE2C26A4_CATEGORY_THRESHOLD = 0.1
/** The registered primary count of the A3 evidence (checked, never used to pick IDs). */
export const PHASE2C26A4_REGISTERED_PRIMARY_COUNT = 3
/** The only Search instrumentation a formal A4 child attaches. */
export const PHASE2C26A4_SEARCH_INSTRUMENTATION = {
  onSearchRuntime: true, onGogmaReservedRuntime: false, onGogmaReservedDepth: false, onSkillReservedDepth: false, onWorkSettled: false,
} as const

/** The Phase 2-C2.6-A3 RESULT this phase is registered against. */
export const PHASE2C26A4_REGISTERED_A3 = {
  orientations: 3,
  childStatus: { completed: 0, out_of_memory: 0, timeout: 3, process_failure: 0 },
  decisionCase: 'R_gogma_does_not_explain',
} as const

// ---------------------------------------------------------------- the Phase 2-C2.6-A3 RESULT (selection authority)

/** A3's own evidence for one primary, referenced (never added to A4 time). */
export interface Phase2C26A4A3Reference {
  orientationId: string
  childOutcome: string
  searchWallMs: number
  measuredGogmaMs: number
  coverage: number
  dominantPhase: Phase2C26A3Phase
  /** Share of each section inside the measured held-aware Gogma time. */
  phaseShareOfMeasured: Record<Phase2C26A3Phase, number>
}

export interface Phase2C26A4A3Authority {
  measuredHead: string
  analysisHead: string
  conditions: Json
  primaryOrientationIds: string[]
  references: Phase2C26A4A3Reference[]
}

export interface Phase2C26A4A3AuthorityParse {
  valid: boolean
  issues: string[]
  authority: Phase2C26A4A3Authority | null
}

function a3Reference(value: unknown): Phase2C26A4A3Reference | null {
  if (!isObject(value) || typeof value.orientationId !== 'string' || !isObject(value.primarySearch)) return null
  const search = value.primarySearch
  const searchWallMs = num(search.searchWallMs), measured = num(search.measuredGogmaMs), coverage = num(search.coverage)
  const share = isObject(search.phaseShare) ? search.phaseShare : null
  if (searchWallMs === null || measured === null || coverage === null || share === null || typeof search.dominantPhase !== 'string') return null
  const phaseShareOfMeasured = Object.fromEntries(PHASE2C26A3_PHASES.map(phase => [phase, num(share[phase])])) as Record<Phase2C26A3Phase, number | null>
  if (Object.values(phaseShareOfMeasured).some(v => v === null)) return null
  return { orientationId: value.orientationId, childOutcome: String(value.childOutcome), searchWallMs, measuredGogmaMs: measured, coverage,
    dominantPhase: search.dominantPhase as Phase2C26A3Phase, phaseShareOfMeasured: phaseShareOfMeasured as Record<Phase2C26A3Phase, number> }
}

/**
 * Reads the committed Phase 2-C2.6-A3 RESULT as untrusted JSON and fails closed unless it is the registered formal A3
 * result (Case R, 3 primaries, 3 timeouts) made against exactly the C2.6-A and A2 RESULT files read, and its selection is
 * the A2 rule's primary set. The primaries are the A3 selection, never fixed here.
 */
export function parsePhase2C26A3ResultAuthority(json: unknown, actualC26aSha256: string, actualA2Sha256: string,
  a2: Pick<Phase2C26A3A2Authority, 'primaryOrientationIds'>, c26a: Pick<Phase2C26A2Authority, 'conditions'>): Phase2C26A4A3AuthorityParse {
  const issues: string[] = []
  const fail = (message: string): Phase2C26A4A3AuthorityParse => ({ valid: false, issues: [...issues, message], authority: null })
  if (!isObject(json)) return fail('A3 RESULT is not an object')
  const provenance = isObject(json.provenance) ? json.provenance : null
  const summary = isObject(json.summary) ? json.summary : null
  const conditions = isObject(json.conditions) ? json.conditions : null
  const selection = isObject(json.selectionValidation) ? json.selectionValidation : null
  const rule = isObject(json.selectionRule) ? json.selectionRule : null
  if (!provenance || !summary || !conditions || !selection || !rule) return fail('A3 RESULT lacks provenance / summary / conditions / selection')
  if (provenance.formal !== true) issues.push('provenance.formal is not true')
  if (!isObject(json.formalSeriesValidation) || json.formalSeriesValidation.valid !== true) issues.push('formalSeriesValidation.valid is not true')
  if (selection.valid !== true) issues.push('selectionValidation.valid is not true')
  const expected = PHASE2C26A4_REGISTERED_A3
  if (summary.orientations !== expected.orientations) issues.push(`summary.orientations ${String(summary.orientations)} is not ${expected.orientations}`)
  const childStatus = isObject(summary.childStatus) ? summary.childStatus : {}
  for (const [status, count] of Object.entries(expected.childStatus)) if (childStatus[status] !== count) issues.push(`summary.childStatus.${status} ${String(childStatus[status])} is not ${count}`)
  const decision = isObject(summary.decision) ? summary.decision : {}
  if (decision.case !== expected.decisionCase) issues.push(`summary.decision.case ${String(decision.case)} is not ${expected.decisionCase}`)
  // The SHA chain: A3 was made against exactly the C2.6-A and A2 files read, and A3's record of A2's C2.6-A SHA agrees.
  if (provenance.c26aResultSha256 !== actualC26aSha256) issues.push('A3 provenance.c26aResultSha256 is not the SHA-256 of the C2.6-A RESULT read')
  if (provenance.c26aResultRecordedByRunner !== actualC26aSha256) issues.push('A3 provenance.c26aResultRecordedByRunner is not the SHA-256 of the C2.6-A RESULT read')
  if (provenance.c26aResultShaRecordedByA2 !== actualC26aSha256) issues.push('A3 provenance.c26aResultShaRecordedByA2 is not the SHA-256 of the C2.6-A RESULT read')
  if (provenance.c26a2ResultSha256 !== actualA2Sha256) issues.push('A3 provenance.c26a2ResultSha256 is not the SHA-256 of the A2 RESULT read')
  if (provenance.c26a2ResultRecordedByRunner !== actualA2Sha256) issues.push('A3 provenance.c26a2ResultRecordedByRunner is not the SHA-256 of the A2 RESULT read')
  const sources = isObject(json.sources) ? json.sources : {}
  if (!isObject(sources.c26aResult) || sources.c26aResult.sha256 !== actualC26aSha256) issues.push('A3 sources.c26aResult.sha256 differs')
  if (!isObject(sources.c26a2Result) || sources.c26a2Result.sha256 !== actualA2Sha256) issues.push('A3 sources.c26a2Result.sha256 differs')
  if (provenance.exportSha256 !== c26a.conditions.exportSha256) issues.push('A3 provenance.exportSha256 is not the C2.6-A Export')

  const primaries = asArray(selection.expected).filter((id): id is string => typeof id === 'string')
  if (primaries.length !== asArray(selection.expected).length) issues.push('A3 selectionValidation.expected is malformed')
  if (!same(primaries, asArray(selection.actual))) issues.push('A3 selectionValidation.actual is not its expected list')
  if (!same(primaries, asArray(rule.derivedPrimaryOrientationIds))) issues.push('A3 selectionRule.derivedPrimaryOrientationIds is not its selection')
  if (!same(primaries, a2.primaryOrientationIds)) issues.push('A3 selection is not the A2 rule\'s primary set')
  if (new Set(primaries).size !== primaries.length) issues.push('A3 selection has a duplicate')
  if (primaries.length !== PHASE2C26A4_REGISTERED_PRIMARY_COUNT) issues.push(`A3 selection has ${primaries.length} primaries, not ${PHASE2C26A4_REGISTERED_PRIMARY_COUNT}`)
  const references: Phase2C26A4A3Reference[] = []
  for (const value of asArray(json.perOrientation)) {
    const reference = a3Reference(value)
    if (reference === null) { issues.push('an A3 perOrientation row is malformed'); continue }
    references.push(reference)
  }
  if (!same(references.map(r => r.orientationId), primaries)) issues.push('A3 perOrientation is not exactly its selection, in order')
  for (const reference of references) if (reference.childOutcome !== 'timeout') issues.push(`A3 row ${reference.orientationId} is not a timeout`)
  if (issues.length > 0) return { valid: false, issues, authority: null }
  return { valid: true, issues: [], authority: { measuredHead: String(provenance.measuredHead), analysisHead: String(provenance.analysisHead), conditions,
    primaryOrientationIds: primaries, references } }
}

// ---------------------------------------------------------------- conditions parity

export interface Phase2C26A4ConditionParity {
  valid: boolean
  issues: string[]
  checks: { condition: string; current: unknown; authority: unknown; matches: boolean }[]
}

/**
 * Every A3 condition must be equal (concurrency 1 included), and A3's own conditions must pass A3's parity against
 * C2.6-A / A2 (every C2.6-A condition except the concurrency, which is 1).
 */
export function validatePhase2C26A4ConditionParity(current: Phase2C26A2RunConditions, a3Conditions: Json,
  c26a: Pick<Phase2C26A2Authority, 'conditions'>, a2Conditions: Json): Phase2C26A4ConditionParity {
  const keys = ['exportSha256', 'childHeapLimitMb', 'concurrency', 'orientationBudgetMs', 'nodeYield', 'extent', 'bounds', 'researchMaxPlanSteps', 'calculationContext', 'lineage'] as const
  const checks: Phase2C26A4ConditionParity['checks'] = keys.map(condition => ({ condition, current: current[condition], authority: a3Conditions[condition],
    matches: same(current[condition], a3Conditions[condition]) }))
  checks.push({ condition: 'concurrency is 1', current: current.concurrency, authority: PHASE2C26A4_CONCURRENCY, matches: current.concurrency === PHASE2C26A4_CONCURRENCY })
  const a3Parity = validatePhase2C26A3ConditionParity(a3Conditions as unknown as Phase2C26A2RunConditions, c26a, a2Conditions)
  for (const check of a3Parity.checks) checks.push({ condition: `a3.${check.condition}`, current: check.current, authority: check.authority, matches: check.matches })
  const issues = checks.filter(check => !check.matches).map(check => `${check.condition} differs`)
  return { valid: issues.length === 0, issues, checks }
}

// ---------------------------------------------------------------- in-child hierarchical runtime tracker

export type Phase2C26A4SectionTotals = Record<Phase2C26A4Section, number>
const zeroSections = (): Phase2C26A4SectionTotals => Object.fromEntries(PHASE2C26A4_SECTIONS.map(section => [section, 0])) as Phase2C26A4SectionTotals

/** Sections whose start is written durably (low frequency: per Search, per registration, per depth work, per flush). */
export const PHASE2C26A4_DURABLE_SECTIONS: ReadonlySet<Phase2C26A4Section> = new Set<Phase2C26A4Section>([
  'search_runtime', 'search_setup', 'route_registration', 'normal_route_registration', 'owned_normal_route_registration', 'existing_gogma_route_registration',
  'bonus_depth_work', 'bonus_depth_read', 'bonus_notice_scan', 'bonus_ideal_filter', 'bonus_route_materialization', 'bonus_evaluate_sort',
  'bonus_channel_publication', 'bonus_depth_advance',
  'skill_depth_work', 'skill_depth_read', 'skill_ideal_filter', 'skill_route_materialization', 'skill_evaluate_sort', 'skill_channel_publication', 'skill_depth_advance',
  'delivery_flush', 'delivery_sort', 'delivery_consumer',
])

/** Written durably at each durable section start (one small line), so a kill keeps the active section. */
export interface Phase2C26A4SectionStartRecord {
  kind: 'search_section_started'
  seq: number
  elapsedMs: number
  targetOrdinal: number
  section: Phase2C26A4Section
  /** The open sections, root first, this one last. */
  stack: Phase2C26A4Section[]
  work: SearchRuntimeDepthWork | null
}

/** One completed Bonus / Skill depth work. */
export interface Phase2C26A4WorkSummaryRecord {
  kind: 'search_work_summary'
  seq: number
  targetOrdinal: number
  section: 'bonus_depth_work' | 'skill_depth_work'
  work: SearchRuntimeDepthWork | null
  counts: SearchRuntimeDepthCounts | null
  inclusiveMs: number
  /** Exclusive time of each direct child phase of this work, plus `self`. */
  phaseMs: Partial<Record<Phase2C26A4Section | 'self', number>>
  startedMs: number
  completedMs: number
}

/** The per-target totals when a Search completed (the observation point of a completed Search). */
export interface Phase2C26A4SearchSummaryRecord {
  kind: 'search_summary'
  seq: number
  targetOrdinal: number
  completedMs: number
  totals: Phase2C26A4TargetRuntime
}

export interface Phase2C26A4DepthAggregate {
  works: number
  withCounts: number
  rawSolutions: number
  unsupportedPredictions: number
  idealSolutions: number
  evaluatedSolutions: number
  /** Sum over works of evaluated solutions x subscribers (subscriber callbacks run). */
  subscriberPublications: number
  maxRawSolutions: number
  maxSubscriberCount: number
  maxRetainedCountAfter: number
  exhaustedWorks: number
}
const zeroAggregate = (): Phase2C26A4DepthAggregate => ({ works: 0, withCounts: 0, rawSolutions: 0, unsupportedPredictions: 0, idealSolutions: 0, evaluatedSolutions: 0,
  subscriberPublications: 0, maxRawSolutions: 0, maxSubscriberCount: 0, maxRetainedCountAfter: 0, exhaustedWorks: 0 })

export interface Phase2C26A4TargetRuntime {
  targetOrdinal: number
  /** Completed sections only. */
  inclusiveMs: Phase2C26A4SectionTotals
  exclusiveMs: Phase2C26A4SectionTotals
  sectionCounts: Phase2C26A4SectionTotals
  /** `scheduler_settle` that settled no scheduler-owned work (a Route base a Route search primitive queued). */
  settleWithoutWork: { count: number; inclusiveMs: number }
  bonusDepth: Phase2C26A4DepthAggregate
  skillDepth: Phase2C26A4DepthAggregate
  searchesStarted: number
  searchesCompleted: number
}

export interface Phase2C26A4ActiveFrame {
  section: Phase2C26A4Section
  startedMs: number
  elapsedMs: number
  work: SearchRuntimeDepthWork | null
}

export interface Phase2C26A4RuntimeSnapshot {
  /** The tracker's own elapsed time of this snapshot (the observation instant). */
  atMs: number
  byTarget: Phase2C26A4TargetRuntime[]
  /** Completed plus the open sections' elapsed / partial exclusive time at `atMs`, per target. */
  observed: { targetOrdinal: number; inclusiveMs: Phase2C26A4SectionTotals; exclusiveMs: Phase2C26A4SectionTotals; settleWithoutWorkMs: number }[]
  activeTargetOrdinal: number | null
  activeStack: Phase2C26A4ActiveFrame[]
  contractViolations: number
  contractViolationSamples: string[]
}

interface Frame {
  section: Phase2C26A4Section
  startedMs: number
  childInclusiveMs: number
  children: number
  work: SearchRuntimeDepthWork | null
  childExclusive: Partial<Record<Phase2C26A4Section, number>> | null
}

function newTarget(targetOrdinal: number): Phase2C26A4TargetRuntime {
  return { targetOrdinal, inclusiveMs: zeroSections(), exclusiveMs: zeroSections(), sectionCounts: zeroSections(), settleWithoutWork: { count: 0, inclusiveMs: 0 },
    bonusDepth: zeroAggregate(), skillDepth: zeroAggregate(), searchesStarted: 0, searchesCompleted: 0 }
}
const cloneTarget = (t: Phase2C26A4TargetRuntime): Phase2C26A4TargetRuntime => ({ ...t, inclusiveMs: { ...t.inclusiveMs }, exclusiveMs: { ...t.exclusiveMs },
  sectionCounts: { ...t.sectionCounts }, settleWithoutWork: { ...t.settleWithoutWork }, bonusDepth: { ...t.bonusDepth }, skillDepth: { ...t.skillDepth } })

function aggregate(into: Phase2C26A4DepthAggregate, counts: SearchRuntimeDepthCounts | undefined) {
  into.works += 1
  if (counts === undefined) return
  into.withCounts += 1
  into.rawSolutions += counts.rawSolutions
  into.unsupportedPredictions += counts.unsupportedPredictions
  into.idealSolutions += counts.idealSolutions
  into.evaluatedSolutions += counts.evaluatedSolutions
  into.subscriberPublications += counts.evaluatedSolutions * counts.subscriberCount
  into.maxRawSolutions = Math.max(into.maxRawSolutions, counts.rawSolutions)
  into.maxSubscriberCount = Math.max(into.maxSubscriberCount, counts.subscriberCount)
  into.maxRetainedCountAfter = Math.max(into.maxRetainedCountAfter, counts.retainedCountAfter)
  if (counts.exhausted) into.exhaustedWorks += 1
}

/**
 * The child-side aggregator of the section boundaries. It stamps each boundary with `now()`, keeps one stack of open
 * sections (one Search runs at a time), attributes inclusive and exclusive time per section and Target, writes one small
 * durable record per durable section start, one summary per completed Bonus / Skill depth work and one per completed
 * Search, and never scans anything. It checks the event contract (the registered parent, strict nesting, a depth
 * detail exactly on depth work starts, counts on held-aware depth work completions, one Search at a time) and counts
 * violations instead of throwing, so a Research bug never changes the Search.
 */
export function createPhase2C26A4RuntimeTracker(options: {
  now: () => number
  origin: () => number
  emitSectionStarted: (record: Phase2C26A4SectionStartRecord) => void
  emitWorkSummary: (record: Phase2C26A4WorkSummaryRecord) => void
  emitSearchSummary: (record: Phase2C26A4SearchSummaryRecord) => void
}) {
  const targets = new Map<number, Phase2C26A4TargetRuntime>()
  const stack: Frame[] = []
  let activeTarget: number | null = null
  let seq = 0
  let violations = 0
  const samples: string[] = []
  const violate = (message: string) => { violations += 1; if (samples.length < 20) samples.push(message) }
  const elapsed = () => options.now() - options.origin()
  const target = (ordinal: number) => {
    let t = targets.get(ordinal)
    if (!t) { t = newTarget(ordinal); targets.set(ordinal, t) }
    return t
  }

  const close = (t: Phase2C26A4TargetRuntime, frame: Frame, at: number, counts: SearchRuntimeDepthCounts | undefined, targetOrdinal: number) => {
    const inclusive = at - frame.startedMs
    const exclusive = inclusive - frame.childInclusiveMs
    t.inclusiveMs[frame.section] += inclusive
    t.exclusiveMs[frame.section] += exclusive
    t.sectionCounts[frame.section] += 1
    const parent = stack.at(-1)
    if (parent) {
      parent.childInclusiveMs += inclusive
      parent.children += 1
      if (parent.childExclusive !== null) parent.childExclusive[frame.section] = (parent.childExclusive[frame.section] ?? 0) + exclusive
    }
    if (frame.section === 'scheduler_settle' && frame.children === 0) {
      t.settleWithoutWork.count += 1
      t.settleWithoutWork.inclusiveMs += inclusive
    }
    if (frame.section === 'bonus_depth_work' || frame.section === 'skill_depth_work') {
      aggregate(frame.section === 'bonus_depth_work' ? t.bonusDepth : t.skillDepth, counts)
      seq += 1
      options.emitWorkSummary({ kind: 'search_work_summary', seq, targetOrdinal, section: frame.section, work: frame.work, counts: counts ?? null, inclusiveMs: inclusive,
        phaseMs: { ...(frame.childExclusive ?? {}), self: exclusive }, startedMs: frame.startedMs, completedMs: at })
    }
    if (frame.section === 'search_runtime') {
      t.searchesCompleted += 1
      activeTarget = null
      seq += 1
      options.emitSearchSummary({ kind: 'search_summary', seq, targetOrdinal, completedMs: at, totals: cloneTarget(t) })
    }
  }

  const observe = (targetOrdinal: number, event: SearchRuntimeEvent) => {
    const at = elapsed()
    const t = target(targetOrdinal)
    const where = `t${targetOrdinal}/${event.section}`
    if (event.type === 'section_started') {
      const parent = SEARCH_RUNTIME_SECTION_PARENT[event.section]
      const top = stack.at(-1)?.section ?? null
      if (event.section === 'search_runtime') {
        if (stack.length > 0 || activeTarget !== null) violate(`${where}: a Search started while another is open`)
        activeTarget = targetOrdinal
        t.searchesStarted += 1
      } else if (activeTarget !== targetOrdinal) violate(`${where}: started outside its Target's Search`)
      if (parent !== top) violate(`${where}: started under ${String(top)}, registered parent ${String(parent)}`)
      const isDepthWork = event.section === 'bonus_depth_work' || event.section === 'skill_depth_work'
      if (isDepthWork !== (event.work !== undefined)) violate(`${where}: depth detail ${event.work === undefined ? 'missing' : 'unexpected'}`)
      const frame: Frame = { section: event.section, startedMs: at, childInclusiveMs: 0, children: 0, work: event.work ?? null, childExclusive: isDepthWork ? {} : null }
      stack.push(frame)
      if (PHASE2C26A4_DURABLE_SECTIONS.has(event.section)) {
        seq += 1
        options.emitSectionStarted({ kind: 'search_section_started', seq, elapsedMs: at, targetOrdinal, section: event.section, stack: stack.map(f => f.section),
          work: event.work ?? null })
      }
      return
    }
    const top = stack.at(-1)
    if (!top || top.section !== event.section) {
      violate(`${where}: completed while ${top?.section ?? 'nothing'} is open`)
      // Recover to the matching frame when there is one, attributing nothing to the skipped frames.
      const index = stack.map(f => f.section).lastIndexOf(event.section)
      if (index < 0) return
      stack.length = index + 1
    }
    if (activeTarget !== targetOrdinal) violate(`${where}: completed outside its Target's Search`)
    if (event.counts !== undefined && event.section !== 'bonus_depth_work' && event.section !== 'skill_depth_work') violate(`${where}: counts on a non-depth section`)
    const frame = stack.pop() as Frame
    close(t, frame, at, event.counts, targetOrdinal)
  }

  return {
    observerForTarget(targetOrdinal: number): SearchRuntimeObserver {
      return (event) => observe(targetOrdinal, event)
    },
    snapshot(): Phase2C26A4RuntimeSnapshot {
      const at = elapsed()
      const observed = [...targets.entries()].sort(([a], [b]) => a - b).map(([ordinal, t]) => {
        const inclusiveMs = { ...t.inclusiveMs }, exclusiveMs = { ...t.exclusiveMs }
        let settleWithoutWorkMs = t.settleWithoutWork.inclusiveMs
        if (ordinal === activeTarget) {
          // Open frames: inclusive = elapsed; exclusive = elapsed - completed children - the open child's elapsed.
          for (const [index, frame] of stack.entries()) {
            const frameElapsed = at - frame.startedMs
            const child = stack[index + 1]
            inclusiveMs[frame.section] += frameElapsed
            exclusiveMs[frame.section] += frameElapsed - frame.childInclusiveMs - (child === undefined ? 0 : at - child.startedMs)
            if (frame.section === 'scheduler_settle' && frame.children === 0 && child === undefined) settleWithoutWorkMs += frameElapsed
          }
        }
        return { targetOrdinal: ordinal, inclusiveMs, exclusiveMs, settleWithoutWorkMs }
      })
      return {
        atMs: at,
        byTarget: [...targets.entries()].sort(([a], [b]) => a - b).map(([, t]) => cloneTarget(t)),
        observed,
        activeTargetOrdinal: activeTarget,
        activeStack: stack.map(frame => ({ section: frame.section, startedMs: frame.startedMs, elapsedMs: at - frame.startedMs, work: frame.work })),
        contractViolations: violations,
        contractViolationSamples: [...samples],
      }
    },
  }
}

// ---------------------------------------------------------------- in-child kernel progress

export interface Phase2C26A4Heartbeat {
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
  searchRuntime: Phase2C26A4RuntimeSnapshot
}

/**
 * The child-side aggregator of one kernel run: the A2 lifecycle records (no Search snapshot), plus the section boundary
 * tracker as each Target's only Search instrumentation.
 */
export function createPhase2C26A4KernelProgress(options: {
  now: () => number
  predictionCounts: () => PlannerAlternativePredictionCounts
  emitLifecycle: (record: Phase2C26A2LifecycleRecord) => void
  emitSectionStarted: (record: Phase2C26A4SectionStartRecord) => void
  emitWorkSummary: (record: Phase2C26A4WorkSummaryRecord) => void
  emitSearchSummary: (record: Phase2C26A4SearchSummaryRecord) => void
}) {
  let origin: number | null = null
  let seq = 0, heartbeatSeq = 0
  let last: { seq: number; type: string; elapsedMs: number } | null = null
  let activeTarget: Phase2C26A4Heartbeat['activeTarget'] = null
  let rerunBudget: Phase2C26A4Heartbeat['rerunBudget'] = null
  const counters: Phase2C26A2ProgressCounters = { startedTargets: 0, completedTargets: 0, deliveredCandidates: 0, trialsStarted: 0, trialsCompleted: 0, fullPlannerRunsStarted: 0, fullPlannerRunsCompleted: 0 }
  const elapsed = () => (origin === null ? 0 : options.now() - origin)
  const tracker = createPhase2C26A4RuntimeTracker({ now: options.now, origin: () => origin ?? options.now(), emitSectionStarted: options.emitSectionStarted,
    emitWorkSummary: options.emitWorkSummary, emitSearchSummary: options.emitSearchSummary })
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
    seq += 1
    last = { seq, type: event.type, elapsedMs }
    options.emitLifecycle({ kind: 'lifecycle', seq, elapsedMs, event: structuredClone(event), predictionCounts: { ...options.predictionCounts() }, search: null, searchDepths: null })
  }
  const instrumentation: PlannerAlternativeKernelInstrumentation = {
    onEvent,
    // The section boundary observer is the only Search instrumentation: no A3 section observer, no heavy depth observer.
    searchInstrumentationForTarget: (_targetWeaponId, targetOrdinal) => ({ onSearchRuntime: tracker.observerForTarget(targetOrdinal) }),
  }
  return {
    /** Starts the Research clock; call immediately before the kernel is invoked. Returns the origin. */
    start(): number { origin = options.now(); return origin },
    instrumentation,
    heartbeat(): Phase2C26A4Heartbeat {
      heartbeatSeq += 1
      const current = last as { seq: number; type: string; elapsedMs: number } | null
      const searchRuntime = tracker.snapshot()
      return {
        kind: 'heartbeat', heartbeatSeq, elapsedMs: searchRuntime.atMs,
        lastEventSeq: current?.seq ?? null, lastEventType: current?.type ?? null, lastEventElapsedMs: current?.elapsedMs ?? null,
        stage: classifyPhase2C26A2Stage(current?.type ?? null),
        activeTarget: activeTarget === null ? null : { ...activeTarget },
        counters: { ...counters },
        rerunBudget: rerunBudget === null ? null : { ...(rerunBudget as { used: number; limit: number }) },
        predictionCounts: { ...options.predictionCounts() },
        searchRuntime,
      }
    },
  }
}

/** One profiled kernel child calculation: the unchanged Phase 2-C2.6-A kernel helper with the A4 instrumentation. */
export function runPhase2C26A4Kernel(input: PlannerInput, task: Phase2C26AKernelTask, dependencies: Phase2C2RunDependencies,
  instrumentation: PlannerAlternativeKernelInstrumentation): Promise<Phase2C2KernelRecord> {
  return runPhase2C26AKernel(input, task, { ...dependencies, kernelInstrumentation: instrumentation })
}

// ---------------------------------------------------------------- outer categories (analysis vocabulary)

/**
 * The registered outer categories: a partition of the measured Search wall time (every exclusive section maps to
 * exactly one category), plus the kernel time between the kernel's `search_started` and the Search root. The Search
 * root's own exclusive time (the delivery loop's bookkeeping and anything between two boundaries) is the only
 * unattributed time.
 */
export const PHASE2C26A4_OUTER_CATEGORIES = [
  'kernel_search_wrapper',
  'search_setup',
  'initial_route_registration',
  'scheduler_checkpoint',
  'queue_dispatch_or_unclassified',
  'scheduler_post_settle',
  'route_base_work',
  'bonus_depth_read',
  'bonus_notice_scan',
  'bonus_ideal_filter',
  'bonus_route_materialization',
  'bonus_evaluate_sort',
  'bonus_channel_publication',
  'bonus_depth_advance',
  'bonus_depth_work_other',
  'skill_depth',
  'lazy_cross',
  'composition',
  'delivery',
] as const
export type Phase2C26A4OuterCategory = typeof PHASE2C26A4_OUTER_CATEGORIES[number]

/**
 * The category of each section's exclusive time. `search_runtime` is unattributed; `scheduler_settle` is split by the
 * analysis into `route_base_work` (a settle with no scheduler-owned work) and `queue_dispatch_or_unclassified`.
 */
export const PHASE2C26A4_SECTION_CATEGORY: Readonly<Record<Phase2C26A4Section, Phase2C26A4OuterCategory | null>> = {
  search_runtime: null,
  search_setup: 'search_setup',
  route_registration: 'initial_route_registration',
  normal_route_registration: 'initial_route_registration',
  owned_normal_route_registration: 'initial_route_registration',
  existing_gogma_route_registration: 'initial_route_registration',
  scheduler_step: 'queue_dispatch_or_unclassified',
  scheduler_checkpoint: 'scheduler_checkpoint',
  scheduler_settle: 'queue_dispatch_or_unclassified',
  scheduler_post_settle: 'scheduler_post_settle',
  bonus_depth_work: 'bonus_depth_work_other',
  bonus_depth_read: 'bonus_depth_read',
  bonus_notice_scan: 'bonus_notice_scan',
  bonus_ideal_filter: 'bonus_ideal_filter',
  bonus_route_materialization: 'bonus_route_materialization',
  bonus_evaluate_sort: 'bonus_evaluate_sort',
  bonus_channel_publication: 'bonus_channel_publication',
  cross_add_bonus: 'lazy_cross',
  bonus_depth_advance: 'bonus_depth_advance',
  skill_depth_work: 'skill_depth',
  skill_depth_read: 'skill_depth',
  skill_ideal_filter: 'skill_depth',
  skill_route_materialization: 'skill_depth',
  skill_evaluate_sort: 'skill_depth',
  skill_channel_publication: 'skill_depth',
  cross_add_skill: 'lazy_cross',
  skill_depth_advance: 'skill_depth',
  composition_work: 'composition',
  composition_checkpoint: 'composition',
  compose_route: 'composition',
  composition_consumer: 'composition',
  cross_open_next: 'lazy_cross',
  cross_wake_work: 'lazy_cross',
  cross_wake: 'lazy_cross',
  delivery_flush: 'delivery',
  delivery_sort: 'delivery',
  delivery_checkpoint: 'delivery',
  delivery_key_dedup: 'delivery',
  delivery_consumer: 'delivery',
}

/** Container sections, whose exclusive time is a remainder between their children (excluded from the strict coverage). */
export const PHASE2C26A4_CONTAINER_SECTIONS: ReadonlySet<Phase2C26A4Section> = new Set(
  PHASE2C26A4_SECTIONS.filter(section => PHASE2C26A4_SECTIONS.some(child => SEARCH_RUNTIME_SECTION_PARENT[child] === section)))
