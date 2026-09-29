/**
 * Issue #154 Phase 2-C2.5-D2-b: post-hoc analysis. Research only. Never import from Production. Runs no Planner and no
 * Search.
 *
 * It merges the recorded sources of the D2-b Browser run - the page's own `exportJson()` of every page session and the
 * external CDP driver's evidence - with exactly the Phase 2-C2.5-B helpers (`mergePhase2C25BRun()`,
 * `phase2c25bPairClassification()`, `phase2c25bLostDuringSearchBeforeFirstCandidate()`, the heap limit wording), so the
 * observation and classification boundary is the Phase 2-C2.5-B one, unchanged:
 *
 * - a page record is the authority for its own status; a lost page is represented by the external evidence only;
 * - a page / browser loss is `inconclusive_page_or_browser_crash`, never a Search failure;
 * - both modes failing natively before the first Candidate is `browser_search_failure_reproduced`, never an OOM claim;
 * - an explicit V8 OOM crash key is the auxiliary label `explicit_v8_oom_crash_key`, beside - never instead of - it.
 *
 * It then compares, post hoc only: the Browser after (D2-b) with the Browser before (the committed Phase 2-C2.5-B
 * results) on the same contexts, and the Browser after with the Node D2-a result in status, Search summary, first Candidate
 * key, extent / exhaustion and (instrumented) prediction counts. Heap bytes and heap limits are never compared with Node.
 */
import { stableStringify } from '../domain/models/publicTypes'
import type { PlannerAlternativePredictionCounts } from './plannerAlternativeBenchmarkProtocol'
import {
  mergePhase2C25BRun,
  phase2c25bLostDuringSearchBeforeFirstCandidate,
  phase2c25bPairClassification,
  phase2c25bWorkerHeapLimitStatement,
  type Phase2C25BExternalEvidence,
  type Phase2C25BExternalRun,
  type Phase2C25BMergedRun,
  type Phase2C25BPageExport,
  type Phase2C25BPairClassification,
} from './plannerGlobalPhase2C25BAnalysis'
import { phase2c25bRepeatDecision, type Phase2C25BRunRecord } from './plannerGlobalPhase2C25BHarness'
import { isPhase2C25BNormalStatus, type Phase2C25BProgressSnapshot } from './plannerGlobalPhase2C25BProtocol'
import type { Phase2C25D2BWorkloadContext } from './plannerGlobalPhase2C25D2B'

type Mode = 'minimal' | 'instrumented'
const MODES: readonly Mode[] = ['minimal', 'instrumented']

function fail(source: string, message: string): never {
  throw new Error(`${source}: ${message}`)
}
function record(value: unknown, source: string, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(source, `${path} is not an object.`)
  return value as Record<string, unknown>
}
function list(value: unknown, source: string, path: string): unknown[] {
  if (!Array.isArray(value)) fail(source, `${path} is not an array.`)
  return value
}
function text(value: unknown, source: string, path: string): string {
  if (typeof value !== 'string' || value.length === 0) fail(source, `${path} is not a non-empty string.`)
  return value
}
function textOrNull(value: unknown, source: string, path: string): string | null {
  return value === null || value === undefined ? null : text(value, source, path)
}
function numberOrNull(value: unknown, source: string, path: string): number | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(source, `${path} is not a number.`)
  return value
}
function integer(value: unknown, source: string, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) fail(source, `${path} is not a non-negative integer.`)
  return value
}
function objectOrNull(value: unknown, source: string, path: string): Record<string, unknown> | null {
  return value === null || value === undefined ? null : record(value, source, path)
}

// ---------------------------------------------------------------- Node D2-a reference view

export interface Phase2C25D2BNodeMode {
  status: string
  searchSummary: Record<string, unknown> | null
  firstCandidateKeySha256: string | null
  predictionCounts: PlannerAlternativePredictionCounts | null
  timeToFirstMs: number | null
  searchElapsedMs: number | null
  /** Instrumented only: the last progress the Node parent received (for an OOM, the last before the process died). */
  metrics: null | { gogmaMaxDepth: number; cumulativeGogmaGenerated: number; cumulativeGogmaFrontier: number; maxGogmaGeneratedPerDepth: number; settledWorkItems: number }
}

export interface Phase2C25D2BNodeView {
  measuredHead: string
  exportSha256: string
  c25aEvidenceSha256: string
  contexts: { orientationId: string; workIndex: number; role: string; minimal: Phase2C25D2BNodeMode; instrumented: Phase2C25D2BNodeMode }[]
}

const D2A = 'D2-a result'

/** The committed Node D2-a result (`PLANNER_GLOBAL_PHASE2C25D2A_RESULT.json`), typed; malformed fields fail closed. */
export function parsePhase2C25D2ANodeResult(value: unknown): Phase2C25D2BNodeView {
  const root = record(value, D2A, 'root')
  const provenance = record(root.provenance, D2A, 'provenance')
  if (provenance.formal !== true) fail(D2A, 'provenance.formal is not true.')
  const contexts = list(root.contexts, D2A, 'contexts').map((raw, i) => {
    const path = `contexts[${i}]`
    const c = record(raw, D2A, path)
    const after = record(c.after, D2A, `${path}.after`)
    const mode = (name: Mode): Phase2C25D2BNodeMode => {
      const m = record(after[name], D2A, `${path}.after.${name}`)
      const view = record(m.view, D2A, `${path}.after.${name}.view`)
      const metrics = objectOrNull(m.metrics, D2A, `${path}.after.${name}.metrics`)
      return {
        status: text(view.status, D2A, `${path}.after.${name}.view.status`),
        searchSummary: objectOrNull(view.searchSummary, D2A, `${path}.after.${name}.view.searchSummary`),
        firstCandidateKeySha256: textOrNull(view.firstCandidateKeySha256, D2A, `${path}.after.${name}.view.firstCandidateKeySha256`),
        predictionCounts: objectOrNull(view.predictionCounts, D2A, `${path}.after.${name}.view.predictionCounts`) as PlannerAlternativePredictionCounts | null,
        timeToFirstMs: numberOrNull(view.timeToFirstMs, D2A, `${path}.after.${name}.view.timeToFirstMs`),
        searchElapsedMs: numberOrNull(view.searchElapsedMs, D2A, `${path}.after.${name}.view.searchElapsedMs`),
        metrics: metrics === null ? null : {
          gogmaMaxDepth: integer(metrics.gogmaMaxDepth, D2A, 'metrics.gogmaMaxDepth'), cumulativeGogmaGenerated: integer(metrics.cumulativeGogmaGenerated, D2A, 'metrics.cumulativeGogmaGenerated'),
          cumulativeGogmaFrontier: integer(metrics.cumulativeGogmaFrontier, D2A, 'metrics.cumulativeGogmaFrontier'),
          maxGogmaGeneratedPerDepth: integer(metrics.maxGogmaGeneratedPerDepth, D2A, 'metrics.maxGogmaGeneratedPerDepth'),
          settledWorkItems: integer(metrics.settledWorkItems, D2A, 'metrics.settledWorkItems'),
        },
      }
    }
    return { orientationId: text(c.orientationId, D2A, `${path}.orientationId`), workIndex: integer(c.workIndex, D2A, `${path}.workIndex`), role: text(c.role, D2A, `${path}.role`),
      minimal: mode('minimal'), instrumented: mode('instrumented') }
  })
  return { measuredHead: text(provenance.measuredHead, D2A, 'provenance.measuredHead'), exportSha256: text(provenance.exportSha256, D2A, 'provenance.exportSha256'),
    c25aEvidenceSha256: text(provenance.c25aEvidenceSha256, D2A, 'provenance.c25aEvidenceSha256'), contexts }
}

// ---------------------------------------------------------------- Browser before (Phase 2-C2.5-B) view

export interface Phase2C25D2BBeforeView {
  measuredHead: string
  exportSha256: string
  evidenceSha256: string
  contexts: { orientationId: string; workIndex: number; classification: string }[]
  runs: Phase2C25BMergedRun[]
}

const C25B = 'C2.5-B results'

/** The committed Phase 2-C2.5-B results (`PLANNER_GLOBAL_PHASE2C25B_RESULTS.json`): its formal context classifications and merged runs. */
export function parsePhase2C25BBrowserBefore(value: unknown): Phase2C25D2BBeforeView {
  const root = record(value, C25B, 'root')
  const provenance = record(root.provenance, C25B, 'provenance')
  if (provenance.formal !== true) fail(C25B, 'provenance.formal is not true.')
  const contexts = list(root.contexts, C25B, 'contexts').map((raw, i) => {
    const c = record(raw, C25B, `contexts[${i}]`)
    return { orientationId: text(c.orientationId, C25B, `contexts[${i}].orientationId`), workIndex: integer(c.workIndex, C25B, `contexts[${i}].workIndex`),
      classification: text(c.classification, C25B, `contexts[${i}].classification`) }
  })
  const runs = list(root.runs, C25B, 'runs').map((raw, i) => {
    const r = record(raw, C25B, `runs[${i}]`)
    for (const field of ['runKey', 'orientationId', 'mode', 'status']) text(r[field], C25B, `runs[${i}].${field}`)
    integer(r.workIndex, C25B, `runs[${i}].workIndex`)
    integer(r.attempt, C25B, `runs[${i}].attempt`)
    record(r.cdp, C25B, `runs[${i}].cdp`)
    return r as unknown as Phase2C25BMergedRun
  })
  return { measuredHead: text(provenance.measuredHead, C25B, 'provenance.measuredHead'), exportSha256: text(provenance.exportSha256, C25B, 'provenance.exportSha256'),
    evidenceSha256: text(provenance.evidenceSha256, C25B, 'provenance.evidenceSha256'), contexts, runs }
}

// ---------------------------------------------------------------- per-run comparable metrics

export interface Phase2C25D2BRunMetrics {
  runKey: string
  mode: Mode
  attempt: number
  status: string
  firstCandidateNoticed: boolean
  /** Normal termination: the Worker's Search elapsed (Search start to the result). */
  searchElapsedMs: number | null
  /** Page loss: the page's relayed Search start to the loss (driver clock). */
  searchStartToLossMs: number | null
  workerLifetimeMs: number | null
  cdpSamples: number
  cdpSampledMaxUsedBytes: number | null
  cdpLastUsedBytes: number | null
  lastProgress: null | { elapsedMs: number; trigger: string; gogmaMaxDepth: number; skillMaxDepth: number; cumulativeGogmaGenerated: number; cumulativeGogmaFrontier: number;
    maxGogmaGeneratedPerDepth: number; depthOfMaxGogmaGenerated: number | null; cumulativeSkillStates: number; settledWorkItems: number;
    predictionCounts: PlannerAlternativePredictionCounts }
  searchSummary: Record<string, unknown> | null
  firstCandidateKeySha256: string | null
  predictionCounts: PlannerAlternativePredictionCounts | null
  browserOomEvidence: 'explicit_v8_oom_crash_key' | null
  v8OomLocation: string | null
}

export function phase2c25d2bRunMetrics(run: Phase2C25BMergedRun): Phase2C25D2BRunMetrics {
  const last: Phase2C25BProgressSnapshot | null = run.lastProgress
  const result = run.result
  return {
    runKey: run.runKey, mode: run.mode, attempt: run.attempt, status: run.status, firstCandidateNoticed: run.firstCandidateNoticed,
    searchElapsedMs: result?.elapsedMs ?? null, searchStartToLossMs: run.searchStartToLossMs, workerLifetimeMs: run.workerLifetimeMs,
    cdpSamples: run.cdp.samples, cdpSampledMaxUsedBytes: run.cdp.maxUsedBytes, cdpLastUsedBytes: run.cdp.lastUsedBytes,
    lastProgress: last === null ? null : { elapsedMs: last.elapsedMs, trigger: last.trigger, gogmaMaxDepth: last.gogma.maxDepth, skillMaxDepth: last.skill.maxDepth,
      cumulativeGogmaGenerated: last.gogma.totalGeneratedStates, cumulativeGogmaFrontier: last.gogma.totalFrontierStates, maxGogmaGeneratedPerDepth: last.gogma.maxGeneratedStatesPerDepth,
      depthOfMaxGogmaGenerated: last.gogma.depthOfMaxGeneratedStates, cumulativeSkillStates: last.skill.totalStates, settledWorkItems: last.settledWorkItems,
      predictionCounts: last.predictionCounts },
    searchSummary: result === null ? null : result.searchSummary as unknown as Record<string, unknown>,
    firstCandidateKeySha256: result?.firstCandidateKeySha256 ?? null, predictionCounts: result?.predictionCounts ?? null,
    browserOomEvidence: run.browserOomEvidence, v8OomLocation: run.crashDump?.v8OomLocation ?? null,
  }
}

// ---------------------------------------------------------------- Node D2-a parity

export interface Phase2C25D2BNodeParity {
  runKey: string
  mode: Mode
  nodeStatus: string
  browserStatus: string
  /** Parity is judged only when both ended with a normal Search termination. */
  applicable: boolean
  reason: 'compared' | 'node_not_terminated' | 'browser_not_terminated'
  statusMatches: boolean | null
  searchSummaryMatches: boolean | null
  firstCandidateKeyMatches: boolean | null
  extentAndExhaustedMatch: boolean | null
  /** Instrumented only (the minimal modes count nothing). */
  predictionCountsMatch: boolean | null
  matches: boolean | null
}

export function phase2c25d2bNodeParity(run: Pick<Phase2C25BMergedRun, 'runKey' | 'mode' | 'status' | 'result'>, node: Phase2C25D2BNodeMode): Phase2C25D2BNodeParity {
  const base = { runKey: run.runKey, mode: run.mode, nodeStatus: node.status, browserStatus: run.status }
  const empty = { statusMatches: null, searchSummaryMatches: null, firstCandidateKeyMatches: null, extentAndExhaustedMatch: null, predictionCountsMatch: null, matches: null }
  if (!isPhase2C25BNormalStatus(node.status)) return { ...base, applicable: false, reason: 'node_not_terminated', ...empty }
  const result = run.result
  if (!isPhase2C25BNormalStatus(run.status) || result === null) return { ...base, applicable: false, reason: 'browser_not_terminated', ...empty }
  const summary = result.searchSummary as unknown as Record<string, unknown>
  const statusMatches = run.status === node.status
  const searchSummaryMatches = node.searchSummary !== null && stableStringify(summary) === stableStringify(node.searchSummary)
  const firstCandidateKeyMatches = result.firstCandidateKeySha256 === node.firstCandidateKeySha256
  const extentAndExhaustedMatch = node.searchSummary !== null && summary.stoppedByExtent === node.searchSummary.stoppedByExtent && summary.exhausted === node.searchSummary.exhausted
  const predictionCountsMatch = run.mode === 'instrumented' ? result.predictionCounts !== null && stableStringify(result.predictionCounts) === stableStringify(node.predictionCounts) : null
  const matches = statusMatches && searchSummaryMatches && firstCandidateKeyMatches && extentAndExhaustedMatch && predictionCountsMatch !== false
  return { ...base, applicable: true, reason: 'compared', statusMatches, searchSummaryMatches, firstCandidateKeyMatches, extentAndExhaustedMatch, predictionCountsMatch, matches }
}

// ---------------------------------------------------------------- Browser before -> after

export interface Phase2C25D2BProgressDelta {
  mode: Mode
  before: Phase2C25D2BRunMetrics['lastProgress']
  after: Phase2C25D2BRunMetrics['lastProgress']
  beforeRunKey: string | null
  afterRunKey: string | null
  /** after / before of the last received progress values: how much further the Search got, NOT a memory-efficiency ratio. */
  progressRatio: null | { gogmaMaxDepth: number | null; cumulativeGogmaGenerated: number | null; cumulativeGogmaFrontier: number | null; settledWorkItems: number | null }
}

const ratio = (after: number | undefined, before: number | undefined) => after === undefined || before === undefined || before === 0 ? null : after / before

/** Instrumented only (the minimal mode sends no progress): the furthest attempt of each side, never mixing modes. */
export function phase2c25d2bProgressDelta(before: readonly Phase2C25D2BRunMetrics[], after: readonly Phase2C25D2BRunMetrics[]): Phase2C25D2BProgressDelta {
  const furthest = (runs: readonly Phase2C25D2BRunMetrics[]) => runs.filter(run => run.mode === 'instrumented' && run.lastProgress !== null)
    .reduce<Phase2C25D2BRunMetrics | null>((best, run) => best === null || run.lastProgress!.cumulativeGogmaGenerated > best.lastProgress!.cumulativeGogmaGenerated ? run : best, null)
  const b = furthest(before), a = furthest(after)
  const bp = b?.lastProgress ?? null, ap = a?.lastProgress ?? null
  return {
    mode: 'instrumented', before: bp, after: ap, beforeRunKey: b?.runKey ?? null, afterRunKey: a?.runKey ?? null,
    progressRatio: bp === null || ap === null ? null : {
      gogmaMaxDepth: ratio(ap.gogmaMaxDepth, bp.gogmaMaxDepth), cumulativeGogmaGenerated: ratio(ap.cumulativeGogmaGenerated, bp.cumulativeGogmaGenerated),
      cumulativeGogmaFrontier: ratio(ap.cumulativeGogmaFrontier, bp.cumulativeGogmaFrontier), settledWorkItems: ratio(ap.settledWorkItems, bp.settledWorkItems),
    },
  }
}

// ---------------------------------------------------------------- formal series completeness

export interface Phase2C25D2BFormalSeriesInput {
  workload: readonly Pick<Phase2C25D2BWorkloadContext, 'orientationId' | 'workIndex'>[]
  /** The external driver evidence: the run set authority (a renderer-loss run has no page record). */
  external: {
    driver: { modes?: unknown; allowRepeat?: unknown; only?: unknown }
    completedAt?: unknown
    runs: readonly Pick<Phase2C25BExternalRun, 'runKey' | 'orientationId' | 'workIndex' | 'mode' | 'attempt' | 'driverStatus' | 'pageStatus' | 'workerTargets'>[]
    repeatDecisions?: readonly { context: string; attempt: number; decision: { repeat: boolean; reasons: readonly string[] } }[]
  }
}

export interface Phase2C25D2BFormalSeriesValidation {
  valid: boolean
  workloadContexts: number
  /** Derived from the workload and the Phase 2-C2.5-B repeat rule over each attempt 1 pair (never a fixed number). */
  expectedRuns: number
  actualRuns: number
  repeatedContexts: string[]
  duplicateRunKeys: string[]
  duplicateLogicalRuns: string[]
  missingRuns: string[]
  unexpectedRuns: string[]
  foreignRuns: string[]
  attemptsAboveTwo: string[]
  repeatDecisions: { expected: number; recorded: number; missing: string[]; duplicate: string[]; unexpected: string[]; mismatches: string[] }
  driverIssues: string[]
  issues: string[]
}

type ExternalRunLike = Phase2C25D2BFormalSeriesInput['external']['runs'][number]
const logicalKey = (orientationId: string, workIndex: number, mode: string, attempt: number) => `${orientationId}#${workIndex}:${mode}:a${attempt}`

/** What the driver passed to `repeatDecision()` for a run: the page status when the page settled, the driver's terminal status otherwise. */
function driverObservedStatus(run: ExternalRunLike): string | null {
  return run.driverStatus === 'page_settled' ? run.pageStatus : run.driverStatus
}

/**
 * The pre-registered formal series, checked fail-closed on the external run set before any formal result: for every
 * workload context exactly one attempt 1 minimal and instrumented run; the Phase 2-C2.5-B repeat decision recomputed
 * from that pair (`phase2c25bRepeatDecision()`, the driver-observed status, semantic digest and CDP attach failure) and
 * equal to the one recorded; exactly one attempt 2 pair where it says repeat and none otherwise; the attempt 2 decision
 * recomputed as no repeat; no attempt above 2, no foreign context, no duplicate run key or logical run, no mode but
 * minimal / instrumented; exactly one recorded decision per executed pair and none for an attempt not run; the driver
 * with both modes, repeat enabled, no subset and a completion time. Page session counts and timestamps are not checked.
 */
export function validatePhase2C25D2BFormalSeries({ workload, external }: Phase2C25D2BFormalSeriesInput): Phase2C25D2BFormalSeriesValidation {
  const driverIssues: string[] = []
  const modes = Array.isArray(external.driver.modes) ? external.driver.modes : null
  if (modes === null || modes.length !== MODES.length || !MODES.every(mode => modes.includes(mode)) || modes.some(mode => !MODES.includes(mode as Mode))) {
    driverIssues.push(`driver.modes is ${JSON.stringify(external.driver.modes)}, not exactly minimal and instrumented`)
  }
  if (external.driver.allowRepeat !== true) driverIssues.push('driver.allowRepeat is not true')
  if (external.driver.only !== null) driverIssues.push('driver.only is not null (a subset run)')
  if (external.completedAt === undefined || external.completedAt === null) driverIssues.push('the driver recorded no completedAt')

  const runs = external.runs
  const inWorkload = (run: ExternalRunLike) => workload.some(c => c.orientationId === run.orientationId && c.workIndex === run.workIndex)
  const count = <T>(values: readonly T[]) => values.reduce((map, value) => map.set(value, (map.get(value) ?? 0) + 1), new Map<T, number>())
  const duplicates = <T>(values: readonly T[]) => [...count(values)].filter(([, n]) => n > 1).map(([value]) => String(value))
  const duplicateRunKeys = duplicates(runs.map(run => run.runKey))
  const duplicateLogicalRuns = duplicates(runs.map(run => logicalKey(run.orientationId, run.workIndex, run.mode, run.attempt)))
  const foreignRuns = runs.filter(run => !inWorkload(run)).map(run => run.runKey)
  const attemptsAboveTwo = runs.filter(run => !Number.isSafeInteger(run.attempt) || run.attempt < 1 || run.attempt > 2).map(run => run.runKey)
  const unexpectedRuns = runs.filter(run => inWorkload(run) && !MODES.includes(run.mode)).map(run => run.runKey)

  const recorded = external.repeatDecisions ?? []
  const decisionKeys = recorded.map(d => `${d.context}:a${d.attempt}`)
  const duplicateDecisions = duplicates(decisionKeys)
  const missingRuns: string[] = []
  const missingDecisions: string[] = []
  const mismatches: string[] = []
  const repeatedContexts: string[] = []
  const executedAttempts = new Set<string>()
  let expectedRuns = 0
  let expectedDecisions = 0

  const pairOf = (context: string, orientationId: string, workIndex: number, attempt: number) => {
    const find = (mode: Mode) => runs.filter(run => run.orientationId === orientationId && run.workIndex === workIndex && run.mode === mode && run.attempt === attempt)
    const minimal = find('minimal'), instrumented = find('instrumented')
    if (minimal.length > 0 || instrumented.length > 0) executedAttempts.add(`${context}:a${attempt}`)
    return { minimal: minimal.length === 1 ? minimal[0] : null, instrumented: instrumented.length === 1 ? instrumented[0] : null, minimalCount: minimal.length, instrumentedCount: instrumented.length }
  }
  const recompute = (context: string, attempt: number, pair: { minimal: ExternalRunLike; instrumented: ExternalRunLike }) => {
    const observed = (run: ExternalRunLike) => ({ status: driverObservedStatus(run) as never, semanticDigest: (run as { semanticDigest?: string | null }).semanticDigest ?? null })
    const cdpAttachFailure = [pair.minimal, pair.instrumented].some(run => !run.workerTargets.some(target => target.samples > 0))
    const expected = phase2c25bRepeatDecision({ attempt, minimal: observed(pair.minimal), instrumented: observed(pair.instrumented), cdpAttachFailure })
    expectedDecisions += 1
    const records = recorded.filter(d => d.context === context && d.attempt === attempt)
    if (records.length === 0) missingDecisions.push(`${context}:a${attempt}`)
    else if (records.length === 1 && stableStringify(records[0].decision) !== stableStringify(expected)) {
      mismatches.push(`${context}:a${attempt} recorded ${stableStringify(records[0].decision)} != recomputed ${stableStringify(expected)}`)
    }
    return expected
  }

  for (const context of workload) {
    const key = `${context.orientationId}#${context.workIndex}`
    expectedRuns += MODES.length
    const first = pairOf(key, context.orientationId, context.workIndex, 1)
    for (const mode of MODES) if ((mode === 'minimal' ? first.minimalCount : first.instrumentedCount) === 0) missingRuns.push(logicalKey(context.orientationId, context.workIndex, mode, 1))
    const second = pairOf(key, context.orientationId, context.workIndex, 2)
    if (first.minimal === null || first.instrumented === null) continue
    const decision = recompute(key, 1, { minimal: first.minimal, instrumented: first.instrumented })
    if (!decision.repeat) {
      for (const run of runs.filter(r => r.orientationId === context.orientationId && r.workIndex === context.workIndex && r.attempt === 2)) unexpectedRuns.push(run.runKey)
      continue
    }
    repeatedContexts.push(key)
    expectedRuns += MODES.length
    for (const mode of MODES) if ((mode === 'minimal' ? second.minimalCount : second.instrumentedCount) === 0) missingRuns.push(logicalKey(context.orientationId, context.workIndex, mode, 2))
    if (second.minimal === null || second.instrumented === null) continue
    const again = recompute(key, 2, { minimal: second.minimal, instrumented: second.instrumented })
    if (again.repeat) mismatches.push(`${key}:a2 recomputed a repeat beyond the maximum attempt`)
  }
  const unexpectedDecisions = recorded.map(d => `${d.context}:a${d.attempt}`).filter(k => !executedAttempts.has(k)
    || !workload.some(c => k.startsWith(`${c.orientationId}#${c.workIndex}:`)))

  const issues = [
    ...driverIssues,
    ...duplicateRunKeys.map(k => `duplicate runKey ${k}`),
    ...duplicateLogicalRuns.map(k => `duplicate logical run ${k}`),
    ...foreignRuns.map(k => `foreign run ${k}`),
    ...attemptsAboveTwo.map(k => `attempt outside 1..2: ${k}`),
    ...missingRuns.map(k => `missing run ${k}`),
    ...[...new Set(unexpectedRuns)].map(k => `unexpected run ${k}`),
    ...missingDecisions.map(k => `missing repeat decision ${k}`),
    ...duplicateDecisions.map(k => `duplicate repeat decision ${k}`),
    ...[...new Set(unexpectedDecisions)].map(k => `repeat decision for an attempt not run ${k}`),
    ...mismatches.map(k => `repeat decision mismatch ${k}`),
  ]
  if (issues.length === 0 && runs.length !== expectedRuns) issues.push(`run count ${runs.length} != expected ${expectedRuns}`)
  return {
    valid: issues.length === 0, workloadContexts: workload.length, expectedRuns, actualRuns: runs.length, repeatedContexts, duplicateRunKeys, duplicateLogicalRuns,
    missingRuns, unexpectedRuns: [...new Set(unexpectedRuns)], foreignRuns, attemptsAboveTwo,
    repeatDecisions: { expected: expectedDecisions, recorded: recorded.length, missing: missingDecisions, duplicate: duplicateDecisions, unexpected: [...new Set(unexpectedDecisions)], mismatches },
    driverIssues, issues,
  }
}

// ---------------------------------------------------------------- whole analysis

export type Phase2C25D2BContextClassification = Phase2C25BPairClassification | 'inconclusive_attempts_disagree' | 'not_run'

const SEMANTIC_PAIR_FAILURES: readonly string[] = ['observer_semantic_mismatch', 'instrumentation_contamination', 'inconsistent_modes']
const NATIVE: readonly string[] = ['worker_error_before_first_candidate', 'worker_error_after_first_candidate', 'worker_messageerror', 'worker_target_destroyed_before_first_candidate']

export interface Phase2C25D2BAnalysisInput {
  pages: readonly Phase2C25BPageExport[]
  external: Phase2C25BExternalEvidence
  workload: readonly Phase2C25D2BWorkloadContext[]
  node: Phase2C25D2BNodeView
  before: Phase2C25D2BBeforeView
}

export function analyzePhase2C25D2B({ pages, external, workload, node, before }: Phase2C25D2BAnalysisInput) {
  const pageRecords = new Map<string, Phase2C25BRunRecord>()
  for (const page of pages) for (const pageRecord of page.records) {
    if (pageRecords.has(pageRecord.runKey)) throw new Error(`Two page records for ${pageRecord.runKey}.`)
    pageRecords.set(pageRecord.runKey, pageRecord)
  }
  const runs = external.runs.map(run => mergePhase2C25BRun(run, pageRecords.get(run.runKey) ?? null))
  const unmatched = [...pageRecords.keys()].filter(key => !external.runs.some(run => run.runKey === key))
  if (unmatched.length > 0) throw new Error(`Page records the driver never started: ${unmatched.join(', ')}.`)
  const foreign = runs.filter(run => !workload.some(c => c.orientationId === run.orientationId && c.workIndex === run.workIndex))
  if (foreign.length > 0) throw new Error(`Runs outside the D2-a workload: ${foreign.map(run => run.runKey).join(', ')}.`)

  const contexts = workload.map(context => {
    const same = (c: { orientationId: string; workIndex: number }) => c.orientationId === context.orientationId && c.workIndex === context.workIndex
    const nodeContext = node.contexts.find(same) ?? fail(D2A, `no Node D2-a result for ${context.orientationId}#${context.workIndex}.`)
    const beforeContext = before.contexts.find(same) ?? fail(C25B, `no Browser before result for ${context.orientationId}#${context.workIndex}.`)
    const ofContext = runs.filter(same)
    const attempts = [...new Set(ofContext.map(run => run.attempt))].sort((a, b) => a - b).map(attempt => {
      const minimal = ofContext.find(run => run.attempt === attempt && run.mode === 'minimal') ?? null
      const instrumented = ofContext.find(run => run.attempt === attempt && run.mode === 'instrumented') ?? null
      return {
        attempt, classification: minimal && instrumented ? phase2c25bPairClassification(minimal, instrumented) : null,
        minimalRunKey: minimal?.runKey ?? null, instrumentedRunKey: instrumented?.runKey ?? null,
        auxiliary: {
          lostDuringSearchBeforeFirstCandidate: [minimal, instrumented].map(run => run !== null && phase2c25bLostDuringSearchBeforeFirstCandidate(run)),
          browserOomEvidence: [minimal, instrumented].map(run => run?.browserOomEvidence ?? null),
          v8OomLocation: [minimal, instrumented].map(run => run?.crashDump?.v8OomLocation ?? null),
        },
      }
    })
    const classes = attempts.map(a => a.classification)
    const classification: Phase2C25D2BContextClassification = classes.length === 0 || classes.includes(null) ? 'not_run'
      : new Set(classes).size === 1 ? classes[0]! : 'inconclusive_attempts_disagree'
    const nodeParity = ofContext.map(run => phase2c25d2bNodeParity(run, nodeContext[run.mode]))
    const nodeTerminatedInBothModes = MODES.every(mode => isPhase2C25BNormalStatus(nodeContext[mode].status))
    const nodeParityHolds = nodeParity.length > 0 && nodeParity.every(p => p.applicable && p.matches === true)
    const afterMetrics = ofContext.map(phase2c25d2bRunMetrics)
    const beforeRuns = before.runs.filter(same)
    const beforeMetrics = beforeRuns.map(phase2c25d2bRunMetrics)
    const isControl = context.role === 'completed_control'
    return {
      orientationId: context.orientationId, workIndex: context.workIndex, targetWeaponId: context.targetWeaponId, kind: context.kind, role: context.role,
      selectionRole: context.selectionRole, classification, attempts,
      browserOomEvidenceRuns: ofContext.filter(run => run.browserOomEvidence === 'explicit_v8_oom_crash_key').length,
      node: { minimal: nodeContext.minimal, instrumented: nodeContext.instrumented, terminatedInBothModes: nodeTerminatedInBothModes },
      nodeParity,
      /** Controls: both modes normal with equal Browser semantics, and equal to Node D2-a in every compared field. */
      controlSemanticParity: isControl ? classification === 'browser_no_failure' && nodeParityHolds : null,
      /**
       * An OOM representative Node D2-a now terminates: the Browser formal classification is `browser_no_failure` and both
       * modes equal Node D2-a in status, Search summary, first Candidate key, extent / exhaustion and prediction counts.
       */
      nodeTerminatedRepresentativeAcceptance: !isControl && nodeTerminatedInBothModes
        ? { accepted: classification === 'browser_no_failure' && nodeParityHolds, classification, nodeParityHolds } : null,
      browserBefore: { classification: beforeContext.classification, runs: beforeMetrics },
      browserAfter: { classification, runs: afterMetrics },
      progressDelta: phase2c25d2bProgressDelta(beforeMetrics, afterMetrics),
    }
  })

  const count = (values: readonly string[]) => values.reduce<Record<string, number>>((out, value) => ({ ...out, [value]: (out[value] ?? 0) + 1 }), {})
  const representatives = contexts.filter(c => c.role === 'oom_representative')
  const controls = contexts.filter(c => c.role === 'completed_control')
  const repRuns = runs.filter(run => representatives.some(r => r.orientationId === run.orientationId && r.workIndex === run.workIndex))
  const repClasses = representatives.map(r => r.classification)
  const semanticFailures = [
    ...contexts.filter(c => SEMANTIC_PAIR_FAILURES.includes(c.classification)).map(c => `${c.orientationId}#${c.workIndex}: ${c.classification}`),
    ...controls.filter(c => c.controlSemanticParity !== true).map(c => `${c.orientationId}#${c.workIndex}: control without Node D2-a semantic parity`),
    ...representatives.filter(r => r.nodeTerminatedRepresentativeAcceptance !== null && r.classification === 'browser_no_failure' && !r.nodeTerminatedRepresentativeAcceptance.nodeParityHolds)
      .map(r => `${r.orientationId}#${r.workIndex}: normal Browser termination without Node D2-a semantic parity`),
  ]
  // The Phase 2-C2.5-B overall rule over the representatives; a semantic failure takes precedence over any memory result.
  const representativeVerdict = repClasses.length > 0 && repClasses.every(c => c === 'browser_search_failure_reproduced') ? 'browser_search_failure_reproduced'
    : repClasses.length > 0 && repClasses.every(c => c === 'inconclusive_page_or_browser_crash') ? 'inconclusive_page_or_browser_crash'
    : repClasses.length > 0 && repClasses.every(c => c === 'browser_no_failure') ? 'not_reproduced'
    : 'mixed'
  const maxHeap = runs.reduce<number | null>((max, run) => run.cdp.maxUsedBytes === null ? max : Math.max(max ?? 0, run.cdp.maxUsedBytes), null)
  return {
    totals: {
      contexts: contexts.length, runs: runs.length, attemptsRepeated: contexts.filter(c => c.attempts.length > 1).length,
      repeatedContexts: contexts.filter(c => c.attempts.length > 1).map(c => `${c.orientationId}#${c.workIndex}`),
      runStatuses: count(runs.map(run => run.status)),
      minimalStatuses: count(runs.filter(run => run.mode === 'minimal').map(run => run.status)),
      instrumentedStatuses: count(runs.filter(run => run.mode === 'instrumented').map(run => run.status)),
      contextClassifications: count(contexts.map(c => c.classification)),
      nativeWorkerFailures: runs.filter(run => NATIVE.includes(run.status)).length,
      structuredErrors: runs.filter(run => run.status === 'structured_error').length,
      pageCrashes: runs.filter(run => run.status === 'page_crashed').length,
      browserCrashes: runs.filter(run => run.status === 'browser_crashed').length,
      timeouts: runs.filter(run => run.status === 'timeout' || run.status === 'driver_timeout').length,
      firstCandidateReachedRuns: runs.filter(run => run.firstCandidateNoticed).length,
      controlsWithSemanticParity: controls.filter(c => c.controlSemanticParity === true).length,
      controls: controls.length,
      sampledMaxWorkerHeapBytes: maxHeap,
    },
    verdict: {
      formal: semanticFailures.length > 0 ? 'semantic_failure' : representativeVerdict,
      representativeVerdict,
      semanticFailures,
      perContext: contexts.map(c => ({ orientationId: c.orientationId, workIndex: c.workIndex, selectionRole: c.selectionRole, classification: c.classification,
        browserBeforeClassification: c.browserBefore.classification })),
      auxiliary: {
        representativeRuns: repRuns.length,
        lostDuringSearchBeforeFirstCandidate: repRuns.filter(phase2c25bLostDuringSearchBeforeFirstCandidate).length,
        explicitV8OomCrashKey: repRuns.filter(run => run.browserOomEvidence === 'explicit_v8_oom_crash_key').length,
        firstCandidateReached: repRuns.filter(run => run.firstCandidateNoticed).length,
        v8OomLocations: count(repRuns.map(run => run.crashDump?.v8OomLocation ?? 'none')),
      },
    },
    contexts,
    runs,
  }
}
export type Phase2C25D2BAnalysis = ReturnType<typeof analyzePhase2C25D2B>

// ---------------------------------------------------------------- statements

const gib = (bytes: number | null) => bytes === null ? 'n/a' : `${(bytes / 2 ** 30).toFixed(2)} GiB`
const key = (c: { orientationId: string; workIndex: number }) => `${c.orientationId}#${c.workIndex}`

/**
 * What the analysis allows to be said, and what it does not, derived from the results (nothing is pre-written as a
 * conclusion). The heap wording is the Phase 2-C2.5-B boundary: the CDP-sampled Worker used heap is a measurement, the page
 * realm limit is another realm's reference value, and the Dedicated Worker's own limit is unknown unless the Worker realm
 * reported one; neither is compared with Node.
 */
export function phase2c25d2bStatements(analysis: Phase2C25D2BAnalysis, heap: { pageRealmJsHeapSizeLimit: number | null; workerRealmJsHeapSizeLimit: number | null }) {
  const { totals: t, verdict: v } = analysis
  const representatives = analysis.contexts.filter(c => c.role === 'oom_representative')
  const cleared = representatives.filter(r => r.browserBefore.classification === 'inconclusive_page_or_browser_crash' && r.nodeTerminatedRepresentativeAcceptance?.accepted === true)
  const remaining = representatives.filter(r => r.classification !== 'browser_no_failure')
  const repSampled = analysis.runs.filter(run => representatives.some(r => r.orientationId === run.orientationId && r.workIndex === run.workIndex))
    .map(run => run.cdp.maxUsedBytes).filter((bytes): bytes is number => bytes !== null)
  const formal = [
    `Context parity: before any Search, every page session re-derived the workload orientations from the original Export and matched the Phase 2-C2.5-A evidence field by field (digests included).`,
    `Controls: ${t.controlsWithSemanticParity} / ${t.controls} ended normally in both modes with equal Browser semantics, equal to Node D2-a in status, Search summary, first Candidate key, extent / exhaustion and instrumented prediction counts.`,
    `Formal Browser classification per context (Phase 2-C2.5-B rule, unchanged): ${v.perContext.map(c => `${key(c)} ${c.classification} (before: ${c.browserBeforeClassification})`).join('; ')}. Overall: ${v.formal}.`,
    ...cleared.map(r => `After the D2-a Ideal-only publication, ${key(r)} no longer reproduced the Phase 2-C2.5-B renderer loss in the Chrome Dedicated Worker: both modes ended ${r.node.minimal.status}, equal to Node D2-a in status, Search summary, first Candidate key, extent / exhaustion and instrumented prediction counts.`),
    `Auxiliary: ${v.auxiliary.explicitV8OomCrashKey} / ${v.auxiliary.representativeRuns} representative runs carry an explicit V8 OOM crash key in their renderer crash dump (explicit_v8_oom_crash_key, beside the formal classification); ${v.auxiliary.lostDuringSearchBeforeFirstCandidate} lost the renderer while the Search Worker ran, before any first Candidate notice.`,
    `Run outcomes: ${t.runs} runs; first Candidate reached ${t.firstCandidateReachedRuns}; renderer (page) loss ${t.pageCrashes}; browser loss ${t.browserCrashes}; native Worker failure ${t.nativeWorkerFailures}; structured error ${t.structuredErrors}; timeout ${t.timeouts}.`,
  ]
  const notYet = [
    remaining.length > 0
      ? `That the Browser memory problem is solved: ${remaining.map(r => `${key(r)} (${r.classification})`).join(', ')} still did not end normally in the Chrome Dedicated Worker.`
      : `That the Browser memory problem is solved in general: only these ${analysis.contexts.length} contexts were measured (not the other Phase 2-C2 OOM orientations, not the kernel, other browsers or devices).`,
    'A memory-efficiency multiple from the CDP samples: they are sampled (about 500 ms), include uncollected garbage, and a lost run is cut at the loss; progress ratios below describe how far the Search got, not bytes per state.',
    `The Dedicated Worker's own heap limit. ${phase2c25bWorkerHeapLimitStatement({ representativeSampledMaxBytes: repSampled, sampledWhen: 'in the representative runs (normal terminations and losses alike)', ...heap })}`,
    `A heap comparison with Node D2-a: Node heap bytes and limits are not compared with the Browser (different runtimes; the sampled Browser maximum over all runs was ${gib(t.sampledMaxWorkerHeapBytes)}).`,
  ]
  return { formal, notYet }
}
