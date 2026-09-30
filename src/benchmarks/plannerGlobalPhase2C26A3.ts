/**
 * Issue #154 Phase 2-C2.6-A3: held-aware Gogma stream internal runtime localization, Research only. Never import from
 * Production.
 *
 * Phase 2-C2.6-A2 showed every C2.6-A timeout orientation was killed inside a Planner Alternative Search and that the
 * held-aware Gogma stream generates by far the most states, but it never timed a section of that stream. This phase does:
 * `createTargetBonusStream()` reports the boundaries of the six mutually exclusive sections of each held-aware depth
 * (`ReservedGogmaRuntimeEvent`, no clock inside the Domain), reached through
 * `PlannerAlternativeSearchInstrumentation.onGogmaReservedRuntime`, and the Research child stamps each boundary with its
 * own `now()`.
 *
 * Authorities. The committed Phase 2-C2.6-A2 RESULT decides which orientations to profile - its timeout-in-search rows
 * whose kernel spent the whole budget in the first Target's Search (one Target started, none completed, no trial, no full
 * Planner run, active Target ordinal 0) - and must itself be the registered formal A2 result made against the committed
 * Phase 2-C2.6-A RESULT, which stays the baseline / condition parity authority. No orientation ID is fixed here.
 *
 * Conditions. Everything is Phase 2-C2.6-A's except the concurrency, which is 1 (one Search at a time, so the section
 * wall times are not shared with sibling children). No absolute wall time is therefore compared with A2. The old heavy
 * depth observers (`onGogmaReservedDepth` / `onSkillReservedDepth`, which scan every generated state after each depth)
 * are NOT attached: the only Search instrumentation is the boundary observer.
 */
import { stableStringify } from '../domain/models/publicTypes'
import type {
  PlannerAlternativeKernelInstrumentation,
  PlannerAlternativeKernelInstrumentationEvent,
} from '../domain/planner/alternative'
import type { PlannerInput } from '../domain/planner/plannerTypes'
import {
  RESERVED_GOGMA_RUNTIME_PHASES,
  type ReservedGogmaRuntimeCounts,
  type ReservedGogmaRuntimeEvent,
  type ReservedGogmaRuntimeObserver,
  type ReservedGogmaRuntimePhase,
} from '../domain/search/bonusStream'
import type { PlannerAlternativePredictionCounts } from './plannerAlternativeBenchmarkProtocol'
import type { Phase2C2KernelRecord, Phase2C2Orientation, Phase2C2RunDependencies } from './plannerGlobalPhase2C2'
import { runPhase2C26AKernel, type Phase2C26AKernelTask } from './plannerGlobalPhase2C26A'
import {
  classifyPhase2C26A2Stage,
  PHASE2C26A2_CHILD_HEAP_MB,
  PHASE2C26A2_HEARTBEAT_INTERVAL_MS,
  PHASE2C26A2_MEMORY_SAMPLE_INTERVAL_MS,
  PHASE2C26A2_NODE_YIELD,
  PHASE2C26A2_ORIENTATION_BUDGET_MS,
  type Phase2C26A2Authority,
  type Phase2C26A2LifecycleRecord,
  type Phase2C26A2ProgressCounters,
  type Phase2C26A2RunConditions,
  type Phase2C26A2StageClass,
} from './plannerGlobalPhase2C26A2'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const same = (a: unknown, b: unknown) => stableStringify(a) === stableStringify(b)

export const PHASE2C26A3_PHASES = RESERVED_GOGMA_RUNTIME_PHASES
export type Phase2C26A3Phase = ReservedGogmaRuntimePhase

// ---------------------------------------------------------------- conditions

/** Phase 2-C2.6-A's heap, budget, yield, memory sampling and heartbeat, unchanged. */
export const PHASE2C26A3_CHILD_HEAP_MB = PHASE2C26A2_CHILD_HEAP_MB
export const PHASE2C26A3_ORIENTATION_BUDGET_MS = PHASE2C26A2_ORIENTATION_BUDGET_MS
export const PHASE2C26A3_NODE_YIELD = PHASE2C26A2_NODE_YIELD
export const PHASE2C26A3_MEMORY_SAMPLE_INTERVAL_MS = PHASE2C26A2_MEMORY_SAMPLE_INTERVAL_MS
export const PHASE2C26A3_HEARTBEAT_INTERVAL_MS = PHASE2C26A2_HEARTBEAT_INTERVAL_MS
/**
 * The one condition that differs from Phase 2-C2.6-A / A2 (3): one kernel child at a time, so a section's wall time is
 * not shared with a sibling child. Absolute wall times are never compared with A2 because of it.
 */
export const PHASE2C26A3_CONCURRENCY = 1
/** The coverage threshold of the pre-registered direct-runtime rule. */
export const PHASE2C26A3_COVERAGE_THRESHOLD = 0.8
/** The registered primary count of the current A2 evidence (checked, never used to pick IDs). */
export const PHASE2C26A3_REGISTERED_PRIMARY_COUNT = 3

/** The Phase 2-C2.6-A2 RESULT this phase is registered against. */
export const PHASE2C26A3_REGISTERED_A2 = {
  orientations: 9,
  childStatus: { completed: 0, out_of_memory: 0, timeout: 9, process_failure: 0 },
  resultClass: { timeout_in_search: 9 },
  nextCase: 'A_search_runtime',
} as const

// ---------------------------------------------------------------- the Phase 2-C2.6-A2 RESULT (selection authority)

/** The A2 per-orientation fields the primary selection rule reads. */
export interface Phase2C26A3A2Row {
  orientationId: string
  kind: string
  fixedTargetWeaponId: string
  resultClass: string
  childOutcome: string
  activeTargetOrdinal: number | null
  counters: Phase2C26A2ProgressCounters
}

export interface Phase2C26A3A2Authority {
  measuredHead: string
  sha256OfC26aRecorded: string
  conditions: Json
  rows: Phase2C26A3A2Row[]
  /** Primary orientations derived by the rule, in the A2 row order. */
  primaryOrientationIds: string[]
}

export interface Phase2C26A3A2AuthorityParse {
  valid: boolean
  issues: string[]
  authority: Phase2C26A3A2Authority | null
}

/**
 * The pre-registered primary rule: a timeout-in-search orientation whose kernel started exactly one Target, completed
 * none, started no trial and no full Planner run, and was killed in Target ordinal 0 - one Planner Alternative Search
 * alone used the whole budget.
 */
export function isPhase2C26A3Primary(row: Phase2C26A3A2Row): boolean {
  return row.resultClass === 'timeout_in_search'
    && row.counters.startedTargets === 1
    && row.counters.completedTargets === 0
    && row.counters.trialsStarted === 0
    && row.counters.fullPlannerRunsStarted === 0
    && row.activeTargetOrdinal === 0
}

function a2Row(value: unknown): Phase2C26A3A2Row | null {
  if (!isObject(value) || typeof value.orientationId !== 'string' || !isObject(value.counters)) return null
  const c = value.counters
  const counters = {
    startedTargets: num(c.startedTargets), completedTargets: num(c.completedTargets), deliveredCandidates: num(c.deliveredCandidates),
    trialsStarted: num(c.trialsStarted), trialsCompleted: num(c.trialsCompleted), fullPlannerRunsStarted: num(c.fullPlannerRunsStarted),
    fullPlannerRunsCompleted: num(c.fullPlannerRunsCompleted),
  }
  if (Object.values(counters).some(v => v === null)) return null
  if (typeof value.resultClass !== 'string' || typeof value.childOutcome !== 'string' || typeof value.kind !== 'string'
    || typeof value.fixedTargetWeaponId !== 'string') return null
  if (value.activeTargetOrdinal !== null && num(value.activeTargetOrdinal) === null) return null
  return { orientationId: value.orientationId, kind: value.kind, fixedTargetWeaponId: value.fixedTargetWeaponId, resultClass: value.resultClass,
    childOutcome: value.childOutcome, activeTargetOrdinal: value.activeTargetOrdinal as number | null, counters: counters as unknown as Phase2C26A2ProgressCounters }
}

/**
 * Reads the committed Phase 2-C2.6-A2 RESULT as untrusted JSON and fails closed unless it is the registered formal A2
 * result made against exactly the C2.6-A RESULT file that was read (`actualC26aSha256`), then derives the primaries.
 */
export function parsePhase2C26A2ResultAuthority(json: unknown, actualC26aSha256: string, c26a: Pick<Phase2C26A2Authority, 'timeoutOrientationIds' | 'orientations'>): Phase2C26A3A2AuthorityParse {
  const issues: string[] = []
  const fail = (message: string): Phase2C26A3A2AuthorityParse => ({ valid: false, issues: [...issues, message], authority: null })
  if (!isObject(json)) return fail('A2 RESULT is not an object')
  const provenance = isObject(json.provenance) ? json.provenance : null
  const summary = isObject(json.summary) ? json.summary : null
  const conclusion = isObject(json.conclusion) ? json.conclusion : null
  const conditions = isObject(json.conditions) ? json.conditions : null
  if (!provenance || !summary || !conclusion || !conditions) return fail('A2 RESULT lacks provenance / summary / conclusion / conditions')
  if (provenance.formal !== true) issues.push('provenance.formal is not true')
  if (!isObject(json.formalSeriesValidation) || json.formalSeriesValidation.valid !== true) issues.push('formalSeriesValidation.valid is not true')
  if (!isObject(json.selectionValidation) || json.selectionValidation.valid !== true) issues.push('selectionValidation.valid is not true')
  const expected = PHASE2C26A3_REGISTERED_A2
  if (summary.orientations !== expected.orientations) issues.push(`summary.orientations ${String(summary.orientations)} is not ${expected.orientations}`)
  const childStatus = isObject(summary.childStatus) ? summary.childStatus : {}
  for (const [status, count] of Object.entries(expected.childStatus)) if (childStatus[status] !== count) issues.push(`summary.childStatus.${status} ${String(childStatus[status])} is not ${count}`)
  const resultClass = isObject(summary.resultClass) ? summary.resultClass : {}
  for (const [cls, count] of Object.entries(expected.resultClass)) if (resultClass[cls] !== count) issues.push(`summary.resultClass.${cls} ${String(resultClass[cls])} is not ${count}`)
  const next = isObject(conclusion.next) ? conclusion.next : {}
  if (next.case !== expected.nextCase) issues.push(`conclusion.next.case ${String(next.case)} is not ${expected.nextCase}`)
  if (provenance.c26aResultSha256 !== actualC26aSha256) issues.push('A2 provenance.c26aResultSha256 is not the SHA-256 of the C2.6-A RESULT read')
  if (provenance.c26aResultRecordedByRunner !== actualC26aSha256) issues.push('A2 provenance.c26aResultRecordedByRunner is not the SHA-256 of the C2.6-A RESULT read')
  if (isObject(json.sources) && isObject(json.sources.c26aResult) && json.sources.c26aResult.sha256 !== actualC26aSha256) issues.push('A2 sources.c26aResult.sha256 differs')

  const rows: Phase2C26A3A2Row[] = []
  const seen = new Set<string>()
  for (const value of asArray(json.perOrientation)) {
    const row = a2Row(value)
    if (row === null) { issues.push('an A2 perOrientation row is malformed'); continue }
    if (seen.has(row.orientationId)) issues.push(`A2 perOrientation duplicates ${row.orientationId}`)
    seen.add(row.orientationId)
    rows.push(row)
  }
  // A2 profiled exactly the C2.6-A timeout set.
  if (!same([...seen].sort(), [...c26a.timeoutOrientationIds].sort())) issues.push('A2 perOrientation is not exactly the C2.6-A timeout set')
  for (const row of rows) {
    const recorded = c26a.orientations.find(o => o.orientationId === row.orientationId)
    if (recorded && (recorded.kind !== row.kind || recorded.fixedTargetWeaponId !== row.fixedTargetWeaponId)) issues.push(`A2 row ${row.orientationId} kind / fixed Target differs from C2.6-A`)
    if (row.childOutcome !== 'timeout') issues.push(`A2 row ${row.orientationId} is not a timeout`)
  }
  if (rows.length !== expected.orientations) issues.push(`A2 perOrientation has ${rows.length} rows, not ${expected.orientations}`)
  const primaryOrientationIds = rows.filter(isPhase2C26A3Primary).map(row => row.orientationId)
  if (primaryOrientationIds.length !== PHASE2C26A3_REGISTERED_PRIMARY_COUNT) issues.push(`the rule derives ${primaryOrientationIds.length} primaries, not ${PHASE2C26A3_REGISTERED_PRIMARY_COUNT}`)
  if (issues.length > 0) return { valid: false, issues, authority: null }
  return {
    valid: true, issues: [],
    authority: { measuredHead: String(provenance.measuredHead), sha256OfC26aRecorded: String(provenance.c26aResultSha256), conditions, rows, primaryOrientationIds },
  }
}

// ---------------------------------------------------------------- selection

/** The current baseline's kernel tasks of the derived primaries, in the current baseline order. */
export function selectPhase2C26A3Tasks(tasks: readonly Phase2C26AKernelTask[], primaryOrientationIds: readonly string[]): Phase2C26AKernelTask[] {
  const selected = new Set(primaryOrientationIds)
  return tasks.filter(task => selected.has(task.orientation.orientationId))
}

export interface Phase2C26A3SelectionValidation {
  valid: boolean
  expected: string[]
  actual: string[]
  missing: string[]
  duplicate: string[]
  /** Not an orientation of the C2.6-A authority at all. */
  foreign: string[]
  /** An authority orientation the primary rule does not select. */
  notPrimary: string[]
  metadataMismatches: { orientationId: string; fields: string[] }[]
}

/**
 * The profiled list must be exactly the derived primary set: no missing, duplicate, foreign or rule-non-matching
 * orientation, and each profiled orientation field-for-field the one C2.6-A recorded.
 */
export function validatePhase2C26A3Selection(actual: readonly Phase2C2Orientation[], expectedPrimaryIds: readonly string[],
  c26a: Pick<Phase2C26A2Authority, 'orientations'>): Phase2C26A3SelectionValidation {
  const ids = actual.map(o => o.orientationId)
  const seen = new Set<string>(), duplicate = new Set<string>()
  for (const id of ids) (seen.has(id) ? duplicate : seen).add(id)
  const recordedById = new Map(c26a.orientations.map(o => [o.orientationId, o]))
  const expected = new Set(expectedPrimaryIds)
  const foreign = [...seen].filter(id => !recordedById.has(id))
  const notPrimary = [...seen].filter(id => recordedById.has(id) && !expected.has(id))
  const missing = expectedPrimaryIds.filter(id => !seen.has(id))
  const metadataMismatches: Phase2C26A3SelectionValidation['metadataMismatches'] = []
  for (const orientation of actual) {
    const recorded = recordedById.get(orientation.orientationId)
    if (!recorded) continue
    const fields = Object.keys({ ...recorded, ...orientation }).filter(field => !same((orientation as unknown as Json)[field], (recorded as unknown as Json)[field]))
    if (fields.length > 0) metadataMismatches.push({ orientationId: orientation.orientationId, fields })
  }
  const valid = missing.length === 0 && duplicate.size === 0 && foreign.length === 0 && notPrimary.length === 0 && metadataMismatches.length === 0
    && ids.length === expectedPrimaryIds.length
  return { valid, expected: [...expectedPrimaryIds], actual: ids, missing, duplicate: [...duplicate], foreign, notPrimary, metadataMismatches }
}

// ---------------------------------------------------------------- conditions parity

export interface Phase2C26A3ConditionParity {
  valid: boolean
  issues: string[]
  checks: { condition: string; current: unknown; authority: unknown; matches: boolean; note?: string }[]
}

/**
 * Every Phase 2-C2.6-A run condition must be equal, except the concurrency, which must be this phase's registered 1
 * (recorded against the authority's value, never silently equal). The A2 RESULT's recorded conditions must also be the
 * C2.6-A ones, so A2 and A3 share every Search condition.
 */
export function validatePhase2C26A3ConditionParity(current: Phase2C26A2RunConditions, c26a: Pick<Phase2C26A2Authority, 'conditions'>, a2Conditions: Json): Phase2C26A3ConditionParity {
  const keys = ['exportSha256', 'childHeapLimitMb', 'orientationBudgetMs', 'nodeYield', 'extent', 'bounds', 'researchMaxPlanSteps', 'calculationContext', 'lineage'] as const
  const checks: Phase2C26A3ConditionParity['checks'] = keys.map(condition => ({ condition, current: current[condition], authority: c26a.conditions[condition],
    matches: same(current[condition], c26a.conditions[condition]) }))
  checks.push({ condition: 'concurrency', current: current.concurrency, authority: c26a.conditions.concurrency, matches: current.concurrency === PHASE2C26A3_CONCURRENCY,
    note: `A3 formal condition is ${PHASE2C26A3_CONCURRENCY}; C2.6-A / A2 ran ${String(c26a.conditions.concurrency)}. Absolute wall time is not compared with A2.` })
  for (const key of keys) {
    checks.push({ condition: `a2.${key}`, current: a2Conditions[key], authority: c26a.conditions[key], matches: same(a2Conditions[key], c26a.conditions[key]) })
  }
  const issues = checks.filter(check => !check.matches).map(check => `${check.condition} differs`)
  return { valid: issues.length === 0, issues, checks }
}

// ---------------------------------------------------------------- in-child runtime tracker (observation only)

export type Phase2C26A3PhaseTotals = Record<Phase2C26A3Phase, number>
const zeroTotals = (): Phase2C26A3PhaseTotals => Object.fromEntries(PHASE2C26A3_PHASES.map(phase => [phase, 0])) as Phase2C26A3PhaseTotals

/** Written durably at each phase start (one small line), so a kill keeps the active phase. */
export interface Phase2C26A3PhaseStartRecord {
  kind: 'gogma_phase_started'
  seq: number
  elapsedMs: number
  targetOrdinal: number
  streamIndex: number
  depth: number
  phase: Phase2C26A3Phase
}

/** One completed depth read of one held-aware Gogma stream. */
export interface Phase2C26A3DepthRecord {
  kind: 'gogma_depth'
  seq: number
  targetOrdinal: number
  streamIndex: number
  startGogmaCounter: number
  depth: number
  exhausted: boolean
  counts: ReservedGogmaRuntimeCounts
  /** Exclusive wall time of each section this depth ran (absent section: not run). */
  phaseMs: Partial<Phase2C26A3PhaseTotals>
  /** `depth_started` -> `depth_completed`, inclusive; never added to a section total. */
  inclusiveMs: number
  startedMs: number
  completedMs: number
}

export interface Phase2C26A3ActivePhase {
  targetOrdinal: number
  streamIndex: number
  depth: number
  phase: Phase2C26A3Phase
  startedMs: number
  elapsedMs: number
}

export interface Phase2C26A3TargetRuntime {
  targetOrdinal: number
  /** Completed sections only; the active section is in `activePhase`. */
  phaseTotalsMs: Phase2C26A3PhaseTotals
  phaseCounts: Record<Phase2C26A3Phase, number>
  completedDepths: number
  inclusiveDepthMs: number
  maxDepthReached: number
  streams: number
}

export interface Phase2C26A3RuntimeSnapshot {
  byTarget: Phase2C26A3TargetRuntime[]
  activePhase: Phase2C26A3ActivePhase | null
  activeDepth: { targetOrdinal: number; streamIndex: number; depth: number; startedMs: number; elapsedMs: number; phaseMs: Partial<Phase2C26A3PhaseTotals> } | null
  contractViolations: number
  contractViolationSamples: string[]
}

interface TargetState {
  totals: Phase2C26A3PhaseTotals
  counts: Record<Phase2C26A3Phase, number>
  completedDepths: number
  inclusiveDepthMs: number
  maxDepthReached: number
  lastDepthByStream: Map<number, number>
  closedStreams: Set<number>
}

/**
 * The child-side aggregator of the section boundaries. It stamps each boundary with `now()`, keeps running totals per
 * Target and the one active section / depth, writes one small phase-start record and one depth summary through the
 * given emitters, and never scans anything. It also checks the event contract (pairing, no overlap, ascending depth per
 * stream, nothing after a stream closed) and counts violations instead of throwing, so a Research bug never changes the
 * Search.
 */
export function createPhase2C26A3RuntimeTracker(options: {
  now: () => number
  origin: () => number
  emitPhaseStarted: (record: Phase2C26A3PhaseStartRecord) => void
  emitDepth: (record: Phase2C26A3DepthRecord) => void
}) {
  const targets = new Map<number, TargetState>()
  let seq = 0
  let activePhase: Omit<Phase2C26A3ActivePhase, 'elapsedMs'> | null = null
  let activeDepth: { targetOrdinal: number; streamIndex: number; depth: number; startedMs: number; phaseMs: Partial<Phase2C26A3PhaseTotals> } | null = null
  let violations = 0
  const samples: string[] = []
  const violate = (message: string) => { violations += 1; if (samples.length < 20) samples.push(message) }
  const elapsed = () => options.now() - options.origin()
  const state = (targetOrdinal: number) => {
    let s = targets.get(targetOrdinal)
    if (!s) {
      s = { totals: zeroTotals(), counts: Object.fromEntries(PHASE2C26A3_PHASES.map(p => [p, 0])) as Record<Phase2C26A3Phase, number>,
        completedDepths: 0, inclusiveDepthMs: 0, maxDepthReached: 0, lastDepthByStream: new Map(), closedStreams: new Set() }
      targets.set(targetOrdinal, s)
    }
    return s
  }
  const observe = (targetOrdinal: number, event: ReservedGogmaRuntimeEvent) => {
    const at = elapsed()
    const s = state(targetOrdinal)
    const where = `t${targetOrdinal}/s${event.streamIndex}/d${event.depth}`
    if (s.closedStreams.has(event.streamIndex)) violate(`${where}: ${event.type} after the stream closed`)
    switch (event.type) {
      case 'depth_started': {
        if (activeDepth !== null) violate(`${where}: depth_started while another depth is active`)
        const last = s.lastDepthByStream.get(event.streamIndex) ?? 0
        if (event.depth !== last + 1) violate(`${where}: depth ${event.depth} after ${last}`)
        s.lastDepthByStream.set(event.streamIndex, event.depth)
        s.maxDepthReached = Math.max(s.maxDepthReached, event.depth)
        activeDepth = { targetOrdinal, streamIndex: event.streamIndex, depth: event.depth, startedMs: at, phaseMs: {} }
        break
      }
      case 'phase_started': {
        if (activePhase !== null) violate(`${where}: ${event.phase} started while ${activePhase.phase} is active`)
        if (activeDepth === null || activeDepth.streamIndex !== event.streamIndex || activeDepth.depth !== event.depth || activeDepth.targetOrdinal !== targetOrdinal) {
          violate(`${where}: ${event.phase} started outside its depth`)
        }
        activePhase = { targetOrdinal, streamIndex: event.streamIndex, depth: event.depth, phase: event.phase, startedMs: at }
        seq += 1
        options.emitPhaseStarted({ kind: 'gogma_phase_started', seq, elapsedMs: at, targetOrdinal, streamIndex: event.streamIndex, depth: event.depth, phase: event.phase })
        break
      }
      case 'phase_completed': {
        if (activePhase === null || activePhase.phase !== event.phase || activePhase.streamIndex !== event.streamIndex || activePhase.depth !== event.depth
          || activePhase.targetOrdinal !== targetOrdinal) {
          violate(`${where}: ${event.phase} completed without its start`)
          activePhase = null
          break
        }
        const wall = at - activePhase.startedMs
        s.totals[event.phase] += wall
        s.counts[event.phase] += 1
        if (activeDepth !== null) activeDepth.phaseMs[event.phase] = (activeDepth.phaseMs[event.phase] ?? 0) + wall
        activePhase = null
        break
      }
      case 'depth_completed': {
        if (activePhase !== null) violate(`${where}: depth completed while ${activePhase.phase} is active`)
        if (activeDepth === null || activeDepth.streamIndex !== event.streamIndex || activeDepth.depth !== event.depth || activeDepth.targetOrdinal !== targetOrdinal) {
          violate(`${where}: depth_completed without its start`)
          activeDepth = null
          break
        }
        const inclusiveMs = at - activeDepth.startedMs
        s.completedDepths += 1
        s.inclusiveDepthMs += inclusiveMs
        if (event.exhausted) s.closedStreams.add(event.streamIndex)
        seq += 1
        options.emitDepth({ kind: 'gogma_depth', seq, targetOrdinal, streamIndex: event.streamIndex, startGogmaCounter: event.startGogmaCounter, depth: event.depth,
          exhausted: event.exhausted, counts: { ...event.counts }, phaseMs: { ...activeDepth.phaseMs }, inclusiveMs, startedMs: activeDepth.startedMs, completedMs: at })
        activeDepth = null
        break
      }
    }
  }
  return {
    observerForTarget(targetOrdinal: number): ReservedGogmaRuntimeObserver {
      return (event) => observe(targetOrdinal, event)
    },
    snapshot(): Phase2C26A3RuntimeSnapshot {
      const at = elapsed()
      return {
        byTarget: [...targets.entries()].sort(([a], [b]) => a - b).map(([targetOrdinal, s]) => ({
          targetOrdinal, phaseTotalsMs: { ...s.totals }, phaseCounts: { ...s.counts }, completedDepths: s.completedDepths, inclusiveDepthMs: s.inclusiveDepthMs,
          maxDepthReached: s.maxDepthReached, streams: s.lastDepthByStream.size,
        })),
        activePhase: activePhase === null ? null : { ...activePhase, elapsedMs: at - activePhase.startedMs },
        activeDepth: activeDepth === null ? null : { ...activeDepth, phaseMs: { ...activeDepth.phaseMs }, elapsedMs: at - activeDepth.startedMs },
        contractViolations: violations,
        contractViolationSamples: [...samples],
      }
    },
  }
}

// ---------------------------------------------------------------- in-child kernel progress

export interface Phase2C26A3Heartbeat {
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
  gogmaRuntime: Phase2C26A3RuntimeSnapshot
}

/**
 * The child-side aggregator of one kernel run: the A2 lifecycle records (with no Search snapshot, because no Search
 * observer counts states here), plus the section-boundary tracker as each Target's only Search instrumentation.
 */
export function createPhase2C26A3KernelProgress(options: {
  now: () => number
  predictionCounts: () => PlannerAlternativePredictionCounts
  emitLifecycle: (record: Phase2C26A2LifecycleRecord) => void
  emitPhaseStarted: (record: Phase2C26A3PhaseStartRecord) => void
  emitDepth: (record: Phase2C26A3DepthRecord) => void
}) {
  let origin: number | null = null
  let seq = 0, heartbeatSeq = 0
  let last: { seq: number; type: string; elapsedMs: number } | null = null
  let activeTarget: Phase2C26A3Heartbeat['activeTarget'] = null
  let rerunBudget: Phase2C26A3Heartbeat['rerunBudget'] = null
  const counters: Phase2C26A2ProgressCounters = { startedTargets: 0, completedTargets: 0, deliveredCandidates: 0, trialsStarted: 0, trialsCompleted: 0, fullPlannerRunsStarted: 0, fullPlannerRunsCompleted: 0 }
  const elapsed = () => (origin === null ? 0 : options.now() - origin)
  const tracker = createPhase2C26A3RuntimeTracker({ now: options.now, origin: () => origin ?? options.now(), emitPhaseStarted: options.emitPhaseStarted, emitDepth: options.emitDepth })
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
    // The boundary observer is the only Search instrumentation: no onWorkSettled, no heavy depth observer.
    searchInstrumentationForTarget: (_targetWeaponId, targetOrdinal) => ({ onGogmaReservedRuntime: tracker.observerForTarget(targetOrdinal) }),
  }
  return {
    /** Starts the Research clock; call immediately before the kernel is invoked. Returns the origin. */
    start(): number { origin = options.now(); return origin },
    instrumentation,
    heartbeat(): Phase2C26A3Heartbeat {
      heartbeatSeq += 1
      const current = last as { seq: number; type: string; elapsedMs: number } | null
      return {
        kind: 'heartbeat', heartbeatSeq, elapsedMs: elapsed(),
        lastEventSeq: current?.seq ?? null, lastEventType: current?.type ?? null, lastEventElapsedMs: current?.elapsedMs ?? null,
        stage: classifyPhase2C26A2Stage(current?.type ?? null),
        activeTarget: activeTarget === null ? null : { ...activeTarget },
        counters: { ...counters },
        rerunBudget: rerunBudget === null ? null : { ...(rerunBudget as { used: number; limit: number }) },
        predictionCounts: { ...options.predictionCounts() },
        gogmaRuntime: tracker.snapshot(),
      }
    },
  }
}

/** One profiled kernel child calculation: the unchanged Phase 2-C2.6-A kernel helper with the boundary instrumentation. */
export function runPhase2C26A3Kernel(input: PlannerInput, task: Phase2C26AKernelTask, dependencies: Phase2C2RunDependencies,
  instrumentation: PlannerAlternativeKernelInstrumentation): Promise<Phase2C2KernelRecord> {
  return runPhase2C26AKernel(input, task, { ...dependencies, kernelInstrumentation: instrumentation })
}
