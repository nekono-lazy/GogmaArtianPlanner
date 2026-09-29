/**
 * Issue #154 Phase 2-C2.5-D2-e: post-hoc analysis. Research only. Never import from Production. Runs no Planner and no
 * Search.
 *
 * It merges the recorded sources of the D2-e Browser run - the page's own `exportJson()` of every page session and the
 * external CDP driver's evidence - with exactly the Phase 2-C2.5-B helpers D2-b used (`mergePhase2C25BRun()`,
 * `phase2c25bPairClassification()`, `phase2c25bLostDuringSearchBeforeFirstCandidate()`, the heap limit wording) and the D2-b
 * per-run helpers (`phase2c25d2bRunMetrics()`, `phase2c25d2bNodeParity()`, `phase2c25d2bProgressDelta()`), so the
 * observation and classification boundary is the D2-b one, unchanged:
 *
 * - a page record is the authority for its own status; a lost page is represented by the external evidence only;
 * - a page / browser loss is `inconclusive_page_or_browser_crash`, never a Search failure;
 * - a timeout is `inconclusive_timeout_or_abort`, never a page crash or an OOM;
 * - both modes failing natively before the first Candidate is `browser_search_failure_reproduced`, never an OOM claim;
 * - an explicit V8 OOM crash key is the auxiliary label `explicit_v8_oom_crash_key`, beside - never instead of - it.
 *
 * It then compares, post hoc only: the Browser after (D2-e) with the Node D2-d result in every context (all 5 ended
 * normally in Node D2-d, so every context needs Node parity in status, Search summary, first Candidate key, extent /
 * exhaustion, instrumented prediction counts and instrumented final progress), and with the Browser before (the committed
 * D2-b result) on the same contexts. Heap bytes and heap limits are never compared with Node.
 */
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
import type { Phase2C25BRunRecord } from './plannerGlobalPhase2C25BHarness'
import { isPhase2C25BNormalStatus, type Phase2C25BProgressSnapshot } from './plannerGlobalPhase2C25BProtocol'
import {
  phase2c25d2bNodeParity,
  phase2c25d2bProgressDelta,
  phase2c25d2bRunMetrics,
  type Phase2C25D2BNodeMode,
  type Phase2C25D2BNodeParity,
  type Phase2C25D2BRunMetrics,
} from './plannerGlobalPhase2C25D2BAnalysis'
import { parsePhase2C25D2EReference, type Phase2C25D2EReference, type Phase2C25D2EWorkloadContext } from './plannerGlobalPhase2C25D2E'

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
function integerOrNull(value: unknown, source: string, path: string): number | null {
  return value === null || value === undefined ? null : integer(value, source, path)
}
function objectOrNull(value: unknown, source: string, path: string): Record<string, unknown> | null {
  return value === null || value === undefined ? null : record(value, source, path)
}

// ---------------------------------------------------------------- Node D2-d reference view

/** The instrumented final progress fields compared with the Browser's final snapshot (the same Search observer). */
export interface Phase2C25D2EProgress {
  gogmaMaxDepth: number
  cumulativeGogmaGenerated: number
  cumulativeGogmaFrontier: number
  maxGogmaGeneratedPerDepth: number
  depthOfMaxGogmaGenerated: number | null
  skillMaxDepth: number
  cumulativeSkillStates: number
  settledWorkItems: number
}
export const PHASE2C25D2E_PROGRESS_FIELDS: readonly (keyof Phase2C25D2EProgress)[] = ['gogmaMaxDepth', 'cumulativeGogmaGenerated', 'cumulativeGogmaFrontier',
  'maxGogmaGeneratedPerDepth', 'depthOfMaxGogmaGenerated', 'skillMaxDepth', 'cumulativeSkillStates', 'settledWorkItems']

export interface Phase2C25D2ENodeMode extends Phase2C25D2BNodeMode {
  /** Instrumented only: the Node D2-d final progress (the last snapshot the parent received). */
  progress: Phase2C25D2EProgress | null
}

export interface Phase2C25D2ENodeView {
  measuredHead: string
  exportSha256: string
  c25aEvidenceSha256: string
  reference: Phase2C25D2EReference
  contexts: { orientationId: string; workIndex: number; role: string; minimal: Phase2C25D2ENodeMode; instrumented: Phase2C25D2ENodeMode }[]
}

const D2D = 'D2-d RESULT'

/**
 * The committed Node D2-d RESULT (`PLANNER_GLOBAL_PHASE2C25D2D_RESULT.json`), typed. It is first checked as the formal D2-e
 * reference (`parsePhase2C25D2EReference()`: formal, formal run validation, 5 contexts, 2 primaries out of OOM and ended
 * normally, D2-a parity, no mode parity failure); malformed fields fail closed.
 */
export function parsePhase2C25D2DNodeResult(value: unknown): Phase2C25D2ENodeView {
  const reference = parsePhase2C25D2EReference(value)
  const root = record(value, D2D, 'root')
  const contexts = list(root.contexts, D2D, 'contexts').map((raw, i) => {
    const path = `contexts[${i}]`
    const c = record(raw, D2D, path)
    const after = record(c.after, D2D, `${path}.after`)
    const mode = (name: Mode): Phase2C25D2ENodeMode => {
      const p = `${path}.after.${name}`
      const m = record(after[name], D2D, p)
      if (m.mode !== name) fail(D2D, `${p}.mode is ${String(m.mode)}.`)
      const view = record(m.view, D2D, `${p}.view`)
      const metrics = objectOrNull(m.metrics, D2D, `${p}.metrics`)
      const maxima = objectOrNull(m.gogmaDepthMaxima, D2D, `${p}.gogmaDepthMaxima`)
      if ((metrics === null) !== (name === 'minimal')) fail(D2D, `${p}.metrics must be present exactly in the instrumented mode.`)
      return {
        status: text(view.status, D2D, `${p}.view.status`),
        searchSummary: objectOrNull(view.searchSummary, D2D, `${p}.view.searchSummary`),
        firstCandidateKeySha256: textOrNull(view.firstCandidateKeySha256, D2D, `${p}.view.firstCandidateKeySha256`),
        predictionCounts: objectOrNull(view.predictionCounts, D2D, `${p}.view.predictionCounts`) as PlannerAlternativePredictionCounts | null,
        timeToFirstMs: numberOrNull(view.timeToFirstMs, D2D, `${p}.view.timeToFirstMs`),
        searchElapsedMs: numberOrNull(view.searchElapsedMs, D2D, `${p}.view.searchElapsedMs`),
        metrics: metrics === null ? null : {
          gogmaMaxDepth: integer(metrics.gogmaMaxDepth, D2D, `${p}.metrics.gogmaMaxDepth`),
          cumulativeGogmaGenerated: integer(metrics.cumulativeGogmaGenerated, D2D, `${p}.metrics.cumulativeGogmaGenerated`),
          cumulativeGogmaFrontier: integer(metrics.cumulativeGogmaFrontier, D2D, `${p}.metrics.cumulativeGogmaFrontier`),
          maxGogmaGeneratedPerDepth: integer(metrics.maxGogmaGeneratedPerDepth, D2D, `${p}.metrics.maxGogmaGeneratedPerDepth`),
          settledWorkItems: integer(metrics.settledWorkItems, D2D, `${p}.metrics.settledWorkItems`),
        },
        progress: metrics === null ? null : {
          gogmaMaxDepth: integer(metrics.gogmaMaxDepth, D2D, `${p}.metrics.gogmaMaxDepth`),
          cumulativeGogmaGenerated: integer(metrics.cumulativeGogmaGenerated, D2D, `${p}.metrics.cumulativeGogmaGenerated`),
          cumulativeGogmaFrontier: integer(metrics.cumulativeGogmaFrontier, D2D, `${p}.metrics.cumulativeGogmaFrontier`),
          maxGogmaGeneratedPerDepth: integer(metrics.maxGogmaGeneratedPerDepth, D2D, `${p}.metrics.maxGogmaGeneratedPerDepth`),
          depthOfMaxGogmaGenerated: maxima === null ? null : integerOrNull(maxima.depthOfMaxGeneratedStates, D2D, `${p}.gogmaDepthMaxima.depthOfMaxGeneratedStates`),
          skillMaxDepth: integer(metrics.skillMaxDepth, D2D, `${p}.metrics.skillMaxDepth`),
          cumulativeSkillStates: integer(metrics.cumulativeSkillStates, D2D, `${p}.metrics.cumulativeSkillStates`),
          settledWorkItems: integer(metrics.settledWorkItems, D2D, `${p}.metrics.settledWorkItems`),
        },
      }
    }
    return { orientationId: text(c.orientationId, D2D, `${path}.orientationId`), workIndex: integer(c.workIndex, D2D, `${path}.workIndex`), role: text(c.role, D2D, `${path}.role`),
      minimal: mode('minimal'), instrumented: mode('instrumented') }
  })
  for (const item of reference.selection) {
    const c = contexts.find(x => x.orientationId === item.orientationId && x.workIndex === item.workIndex)
    if (!c || c.role !== item.role) fail(D2D, `the context ${item.orientationId}#${item.workIndex} of workloadSelection has no result with role ${item.role}.`)
  }
  return { measuredHead: reference.measuredHead, exportSha256: reference.exportSha256, c25aEvidenceSha256: reference.c25aEvidenceSha256, reference, contexts }
}

// ---------------------------------------------------------------- Browser before (D2-b) view

export interface Phase2C25D2EBeforeContext {
  orientationId: string
  workIndex: number
  classification: string
  attempts: number
  browserOomEvidenceRuns: number
  runs: Phase2C25D2BRunMetrics[]
}

export interface Phase2C25D2EBeforeView {
  measuredHead: string
  exportSha256: string
  c25aEvidenceSha256: string
  contexts: Phase2C25D2EBeforeContext[]
}

const D2B = 'D2-b RESULT'

/** The committed Browser D2-b RESULT (`PLANNER_GLOBAL_PHASE2C25D2B_RESULT.json`): formal with a complete formal series, its per-context classification and run metrics. */
export function parsePhase2C25D2BBrowserBeforeResult(value: unknown): Phase2C25D2EBeforeView {
  const root = record(value, D2B, 'root')
  const provenance = record(root.provenance, D2B, 'provenance')
  if (provenance.formal !== true) fail(D2B, 'provenance.formal is not true.')
  if (record(root.formalSeriesValidation, D2B, 'formalSeriesValidation').valid !== true) fail(D2B, 'formalSeriesValidation.valid is not true.')
  const contexts = list(root.contexts, D2B, 'contexts').map((raw, i) => {
    const path = `contexts[${i}]`
    const c = record(raw, D2B, path)
    const after = record(c.browserAfter, D2B, `${path}.browserAfter`)
    const runs = list(after.runs, D2B, `${path}.browserAfter.runs`).map((r, j) => {
      const run = record(r, D2B, `${path}.browserAfter.runs[${j}]`)
      for (const field of ['runKey', 'mode', 'status']) text(run[field], D2B, `${path}.browserAfter.runs[${j}].${field}`)
      integer(run.attempt, D2B, `${path}.browserAfter.runs[${j}].attempt`)
      return run as unknown as Phase2C25D2BRunMetrics
    })
    return { orientationId: text(c.orientationId, D2B, `${path}.orientationId`), workIndex: integer(c.workIndex, D2B, `${path}.workIndex`),
      classification: text(c.classification, D2B, `${path}.classification`), attempts: list(c.attempts, D2B, `${path}.attempts`).length,
      browserOomEvidenceRuns: integer(c.browserOomEvidenceRuns, D2B, `${path}.browserOomEvidenceRuns`), runs }
  })
  return { measuredHead: text(provenance.measuredHead, D2B, 'provenance.measuredHead'), exportSha256: text(provenance.exportSha256, D2B, 'provenance.exportSha256'),
    c25aEvidenceSha256: text(provenance.c25aEvidenceSha256, D2B, 'provenance.c25aEvidenceSha256'), contexts }
}

// ---------------------------------------------------------------- instrumented final progress parity

/** The Browser instrumented run's final snapshot (`trigger: 'final'`, taken after the Search returned) as comparable progress. */
export function phase2c25d2eBrowserFinalProgress(snapshot: Phase2C25BProgressSnapshot | null): Phase2C25D2EProgress | null {
  if (snapshot === null || snapshot.trigger !== 'final') return null
  return { gogmaMaxDepth: snapshot.gogma.maxDepth, cumulativeGogmaGenerated: snapshot.gogma.totalGeneratedStates, cumulativeGogmaFrontier: snapshot.gogma.totalFrontierStates,
    maxGogmaGeneratedPerDepth: snapshot.gogma.maxGeneratedStatesPerDepth, depthOfMaxGogmaGenerated: snapshot.gogma.depthOfMaxGeneratedStates,
    skillMaxDepth: snapshot.skill.maxDepth, cumulativeSkillStates: snapshot.skill.totalStates, settledWorkItems: snapshot.settledWorkItems }
}

export interface Phase2C25D2EProgressParity {
  runKey: string
  applicable: boolean
  reason: 'compared' | 'not_instrumented' | 'node_not_terminated' | 'browser_not_terminated' | 'no_final_progress'
  fields: { field: keyof Phase2C25D2EProgress; browser: number | null; node: number | null; matches: boolean }[]
  matches: boolean | null
}

/** Instrumented runs that both ended normally: the Browser final snapshot equals the Node D2-d final progress in every field. */
export function phase2c25d2eProgressParity(run: Pick<Phase2C25BMergedRun, 'runKey' | 'mode' | 'status' | 'result'>, node: Phase2C25D2ENodeMode): Phase2C25D2EProgressParity {
  const none = (reason: Phase2C25D2EProgressParity['reason']): Phase2C25D2EProgressParity => ({ runKey: run.runKey, applicable: false, reason, fields: [], matches: null })
  if (run.mode !== 'instrumented') return none('not_instrumented')
  if (!isPhase2C25BNormalStatus(node.status)) return none('node_not_terminated')
  if (!isPhase2C25BNormalStatus(run.status) || run.result === null) return none('browser_not_terminated')
  const browser = phase2c25d2eBrowserFinalProgress(run.result.finalSnapshot)
  if (browser === null || node.progress === null) return none('no_final_progress')
  const fields = PHASE2C25D2E_PROGRESS_FIELDS.map(field => ({ field, browser: browser[field], node: node.progress![field], matches: browser[field] === node.progress![field] }))
  return { runKey: run.runKey, applicable: true, reason: 'compared', fields, matches: fields.every(f => f.matches) }
}

// ---------------------------------------------------------------- CDP detail

export interface Phase2C25D2ECdpDetail {
  samples: number
  sampleErrors: number
  sampledMaxUsedBytes: number | null
  /** ms since the Worker target was created, of the sample holding the sampled maximum. */
  sampledMaxUsedAtMs: number | null
  totalBytesAtSampledMaxUsed: number | null
  sampledMaxTotalBytes: number | null
  lastUsedBytes: number | null
  lastTotalBytes: number | null
  lastSampleAtMs: number | null
}

/** Sampled values only (about every 500 ms, no concurrent request): never a continuous or true peak. */
export function phase2c25d2eCdpDetail(run: Pick<Phase2C25BExternalRun, 'heapSamples' | 'sampleErrors' | 'workerTargets' | 'startedAt' | 'crash' | 'endedAt'>): Phase2C25D2ECdpDetail {
  const origin = run.workerTargets.at(-1)?.createdAt ?? run.startedAt
  const end = run.crash?.detectedAt ?? run.endedAt ?? Infinity
  const samples = run.heapSamples
  const max = samples.reduce<typeof samples[number] | null>((best, s) => best === null || s.usedSize > best.usedSize ? s : best, null)
  const last = samples.filter(s => s.atEpochMs <= end).at(-1) ?? null
  return {
    samples: samples.length, sampleErrors: run.sampleErrors.length,
    sampledMaxUsedBytes: max?.usedSize ?? null, sampledMaxUsedAtMs: max === null ? null : Math.round(max.atEpochMs - origin), totalBytesAtSampledMaxUsed: max?.totalSize ?? null,
    sampledMaxTotalBytes: samples.length ? Math.max(...samples.map(s => s.totalSize)) : null,
    lastUsedBytes: last?.usedSize ?? null, lastTotalBytes: last?.totalSize ?? null, lastSampleAtMs: last === null ? null : Math.round(last.atEpochMs - origin),
  }
}

// ---------------------------------------------------------------- whole analysis

export type Phase2C25D2EContextClassification = Phase2C25BPairClassification | 'inconclusive_attempts_disagree' | 'not_run'

const SEMANTIC_PAIR_FAILURES: readonly string[] = ['observer_semantic_mismatch', 'instrumentation_contamination', 'inconsistent_modes']
const NATIVE: readonly string[] = ['worker_error_before_first_candidate', 'worker_error_after_first_candidate', 'worker_messageerror', 'worker_target_destroyed_before_first_candidate']
const TIMEOUT: readonly string[] = ['timeout', 'driver_timeout']
/** The analysis threshold for the runtime note of the next-phase recommendation, fixed before the formal run: half the Search budget. */
export const PHASE2C25D2E_LONG_RUNTIME_FRACTION_OF_BUDGET = 0.5

export interface Phase2C25D2EAnalysisInput {
  pages: readonly Phase2C25BPageExport[]
  external: Phase2C25BExternalEvidence
  workload: readonly Phase2C25D2EWorkloadContext[]
  node: Phase2C25D2ENodeView
  before: Phase2C25D2EBeforeView
  /** The page's Search budget (the D2-b 20 minutes), for the runtime note only. */
  runBudgetMs: number
}

export function analyzePhase2C25D2E({ pages, external, workload, node, before, runBudgetMs }: Phase2C25D2EAnalysisInput) {
  const pageRecords = new Map<string, Phase2C25BRunRecord>()
  for (const page of pages) for (const pageRecord of page.records) {
    if (pageRecords.has(pageRecord.runKey)) throw new Error(`Two page records for ${pageRecord.runKey}.`)
    pageRecords.set(pageRecord.runKey, pageRecord)
  }
  const runs = external.runs.map(run => mergePhase2C25BRun(run, pageRecords.get(run.runKey) ?? null))
  const unmatched = [...pageRecords.keys()].filter(key => !external.runs.some(run => run.runKey === key))
  if (unmatched.length > 0) throw new Error(`Page records the driver never started: ${unmatched.join(', ')}.`)
  const foreign = runs.filter(run => !workload.some(c => c.orientationId === run.orientationId && c.workIndex === run.workIndex))
  if (foreign.length > 0) throw new Error(`Runs outside the D2-e workload: ${foreign.map(run => run.runKey).join(', ')}.`)
  const cdpDetail = new Map(external.runs.map(run => [run.runKey, phase2c25d2eCdpDetail(run)]))

  const contexts = workload.map(context => {
    const same = (c: { orientationId: string; workIndex: number }) => c.orientationId === context.orientationId && c.workIndex === context.workIndex
    const nodeContext = node.contexts.find(same) ?? fail(D2D, `no Node D2-d result for ${context.orientationId}#${context.workIndex}.`)
    const beforeContext = before.contexts.find(same) ?? fail(D2B, `no Browser before result for ${context.orientationId}#${context.workIndex}.`)
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
    const classification: Phase2C25D2EContextClassification = classes.length === 0 || classes.includes(null) ? 'not_run'
      : new Set(classes).size === 1 ? classes[0]! : 'inconclusive_attempts_disagree'
    const nodeParity: Phase2C25D2BNodeParity[] = ofContext.map(run => phase2c25d2bNodeParity(run, nodeContext[run.mode]))
    const progressParity = ofContext.filter(run => run.mode === 'instrumented').map(run => phase2c25d2eProgressParity(run, nodeContext.instrumented))
    const nodeTerminatedInBothModes = MODES.every(mode => isPhase2C25BNormalStatus(nodeContext[mode].status))
    const nodeParityHolds = nodeParity.length > 0 && nodeParity.every(p => p.applicable && p.matches === true)
    const progressParityHolds = progressParity.length > 0 && progressParity.every(p => p.applicable && p.matches === true)
    const afterMetrics = ofContext.map(phase2c25d2bRunMetrics)
    const accepted = classification === 'browser_no_failure' && nodeParityHolds && progressParityHolds
    return {
      orientationId: context.orientationId, workIndex: context.workIndex, targetWeaponId: context.targetWeaponId, kind: context.kind, role: context.role,
      selectionRole: context.selectionRole, d2dRole: context.d2dRole, classification, attempts,
      browserOomEvidenceRuns: ofContext.filter(run => run.browserOomEvidence === 'explicit_v8_oom_crash_key').length,
      node: { minimal: nodeContext.minimal, instrumented: nodeContext.instrumented, terminatedInBothModes: nodeTerminatedInBothModes },
      nodeParity,
      progressParity,
      /**
       * Every D2-e context ended normally in Node D2-d, so every context is accepted only when the Browser formal
       * classification is `browser_no_failure` and every run equals Node D2-d in status, Search summary, first Candidate key,
       * extent / exhaustion and (instrumented) prediction counts and final progress.
       */
      nodeD2DAcceptance: { accepted, classification, nodeTerminatedInBothModes, nodeParityHolds, progressParityHolds },
      runtime: {
        browserSearchElapsedMs: Object.fromEntries(MODES.map(mode => [mode, ofContext.filter(run => run.mode === mode).map(run => run.result?.elapsedMs ?? null)])),
        nodeSearchElapsedMs: { minimal: nodeContext.minimal.searchElapsedMs, instrumented: nodeContext.instrumented.searchElapsedMs },
        note: 'One run per mode and attempt: a reference value, never a speed ratio between the runtimes.',
      },
      cdp: ofContext.map(run => ({ runKey: run.runKey, ...cdpDetail.get(run.runKey)! })),
      browserBefore: { classification: beforeContext.classification, attempts: beforeContext.attempts, browserOomEvidenceRuns: beforeContext.browserOomEvidenceRuns, runs: beforeContext.runs },
      browserAfter: { classification, attempts: attempts.length, browserOomEvidenceRuns: ofContext.filter(run => run.browserOomEvidence === 'explicit_v8_oom_crash_key').length, runs: afterMetrics },
      progressDelta: phase2c25d2bProgressDelta(beforeContext.runs, afterMetrics),
    }
  })

  const count = (values: readonly string[]) => values.reduce<Record<string, number>>((out, value) => ({ ...out, [value]: (out[value] ?? 0) + 1 }), {})
  const keyOf = (c: { orientationId: string; workIndex: number }) => `${c.orientationId}#${c.workIndex}`
  const representatives = contexts.filter(c => c.selectionRole === 'oom_representative')
  const primaries = contexts.filter(c => c.d2dRole === 'primary_oom')
  const repRuns = runs.filter(run => representatives.some(r => r.orientationId === run.orientationId && r.workIndex === run.workIndex))
  const repClasses = representatives.map(r => r.classification)
  const semanticFailures = [
    ...contexts.filter(c => SEMANTIC_PAIR_FAILURES.includes(c.classification)).map(c => `${keyOf(c)}: ${c.classification}`),
    ...contexts.filter(c => c.classification === 'browser_no_failure' && !(c.nodeD2DAcceptance.nodeParityHolds && c.nodeD2DAcceptance.progressParityHolds))
      .map(c => `${keyOf(c)}: normal Browser termination without Node D2-d parity`),
  ]
  // The Phase 2-C2.5-B / D2-b overall rule over the (D2-b) OOM representatives, unchanged; a semantic failure takes precedence.
  const representativeVerdict = repClasses.length > 0 && repClasses.every(c => c === 'browser_search_failure_reproduced') ? 'browser_search_failure_reproduced'
    : repClasses.length > 0 && repClasses.every(c => c === 'inconclusive_page_or_browser_crash') ? 'inconclusive_page_or_browser_crash'
    : repClasses.length > 0 && repClasses.every(c => c === 'browser_no_failure') ? 'not_reproduced'
    : 'mixed'
  const allAccepted = contexts.length > 0 && contexts.every(c => c.nodeD2DAcceptance.accepted)
  const overallSummary = semanticFailures.length > 0 ? 'semantic_failure'
    : allAccepted ? 'browser_no_failure_all_selected_contexts' : 'not_all_selected_contexts_browser_no_failure'
  const primaryAccepted = primaries.filter(c => c.nodeD2DAcceptance.accepted)
  const primaryTimedOut = primaries.filter(c => runs.some(run => keyOf(run) === keyOf(c) && TIMEOUT.includes(run.status)))
  const primaryLost = primaries.filter(c => c.classification === 'inconclusive_page_or_browser_crash')
  const outcomeCategory = semanticFailures.length > 0 ? 'semantic_failure'
    : allAccepted ? 'A_all_selected_contexts_normal_with_node_d2d_parity'
    : primaryTimedOut.length > 0 ? 'E_browser_timeout'
    : primaryAccepted.length === primaries.length ? 'A_primaries_normal_non_primary_not'
    : primaryAccepted.length > 0 ? 'B_or_C_one_primary_normal'
    : primaryLost.length === primaries.length ? 'D_primary_loss_continues'
    : 'other'
  const longBudgetMs = runBudgetMs * PHASE2C25D2E_LONG_RUNTIME_FRACTION_OF_BUDGET
  const longRuntimePrimaries = primaryAccepted.filter(c => runs.some(run => keyOf(run) === keyOf(c) && (run.result?.elapsedMs ?? 0) >= longBudgetMs)).map(keyOf)
  const nextPhase = {
    recommendation: primaryAccepted.length === primaries.length && primaries.length > 0 ? 'A_return_to_global_planner_kernel_formal_reevaluation'
      : primaryLost.length > 0 ? 'B_post_h1_heap_localization_browser_specific_residual'
      : primaryTimedOut.length > 0 ? 'E_browser_timeout_runtime_analysis'
      : 'undecided',
    runtimeNote: longRuntimePrimaries.length > 0 ? 'C_generation_volume_h6_runtime_optimization_to_consider' : null,
    longRuntimePrimaries,
    longRuntimeThresholdMs: longBudgetMs,
  }
  const maxHeap = runs.reduce<number | null>((max, run) => run.cdp.maxUsedBytes === null ? max : Math.max(max ?? 0, run.cdp.maxUsedBytes), null)
  return {
    totals: {
      contexts: contexts.length, runs: runs.length, attemptsRepeated: contexts.filter(c => c.attempts.length > 1).length,
      repeatedContexts: contexts.filter(c => c.attempts.length > 1).map(keyOf),
      pageSessions: pages.length,
      runStatuses: count(runs.map(run => run.status)),
      minimalStatuses: count(runs.filter(run => run.mode === 'minimal').map(run => run.status)),
      instrumentedStatuses: count(runs.filter(run => run.mode === 'instrumented').map(run => run.status)),
      contextClassifications: count(contexts.map(c => c.classification)),
      nativeWorkerFailures: runs.filter(run => NATIVE.includes(run.status)).length,
      structuredErrors: runs.filter(run => run.status === 'structured_error').length,
      pageCrashes: runs.filter(run => run.status === 'page_crashed').length,
      browserCrashes: runs.filter(run => run.status === 'browser_crashed').length,
      timeouts: runs.filter(run => TIMEOUT.includes(run.status)).length,
      explicitV8OomRuns: runs.filter(run => run.browserOomEvidence === 'explicit_v8_oom_crash_key').length,
      firstCandidateReachedRuns: runs.filter(run => run.firstCandidateNoticed).length,
      acceptedContexts: contexts.filter(c => c.nodeD2DAcceptance.accepted).length,
      primaries: primaries.length,
      primariesAccepted: primaryAccepted.length,
      sampledMaxWorkerHeapBytes: maxHeap,
    },
    verdict: {
      formal: semanticFailures.length > 0 ? 'semantic_failure' : representativeVerdict,
      representativeVerdict,
      overallSummary,
      outcomeCategory,
      semanticFailures,
      perContext: contexts.map(c => ({ orientationId: c.orientationId, workIndex: c.workIndex, d2dRole: c.d2dRole, selectionRole: c.selectionRole, classification: c.classification,
        nodeD2DAccepted: c.nodeD2DAcceptance.accepted, browserBeforeClassification: c.browserBefore.classification })),
      auxiliary: {
        representativeRuns: repRuns.length,
        lostDuringSearchBeforeFirstCandidate: repRuns.filter(phase2c25bLostDuringSearchBeforeFirstCandidate).length,
        explicitV8OomCrashKey: repRuns.filter(run => run.browserOomEvidence === 'explicit_v8_oom_crash_key').length,
        firstCandidateReached: repRuns.filter(run => run.firstCandidateNoticed).length,
        v8OomLocations: count(repRuns.map(run => run.crashDump?.v8OomLocation ?? 'none')),
      },
      nextPhase,
    },
    contexts,
    runs,
  }
}
export type Phase2C25D2EAnalysis = ReturnType<typeof analyzePhase2C25D2E>

// ---------------------------------------------------------------- statements

const gib = (bytes: number | null) => bytes === null ? 'n/a' : `${(bytes / 2 ** 30).toFixed(2)} GiB`
const key = (c: { orientationId: string; workIndex: number }) => `${c.orientationId}#${c.workIndex}`
const minutes = (ms: number | null | undefined) => ms === null || ms === undefined ? 'n/a' : `${(ms / 60_000).toFixed(1)} min`

/**
 * What the analysis allows to be said, and what it does not, derived from the results (nothing is pre-written as a
 * conclusion). The heap wording is the D2-b boundary: the CDP-sampled Worker used heap is a measurement, the page realm
 * limit is another realm's reference value, and the Dedicated Worker's own limit is unknown unless the Worker realm reported
 * one; neither is compared with Node. Never "the Global Planner memory problem is solved": the kernel was not measured.
 */
export function phase2c25d2eStatements(analysis: Phase2C25D2EAnalysis, heap: { pageRealmJsHeapSizeLimit: number | null; workerRealmJsHeapSizeLimit: number | null }) {
  const { totals: t, verdict: v } = analysis
  const accepted = analysis.contexts.filter(c => c.nodeD2DAcceptance.accepted)
  const clearedPrimaries = accepted.filter(c => c.d2dRole === 'primary_oom' && c.browserBefore.classification === 'inconclusive_page_or_browser_crash')
  const remaining = analysis.contexts.filter(c => !c.nodeD2DAcceptance.accepted)
  const primarySampled = analysis.runs.filter(run => analysis.contexts.some(c => c.d2dRole === 'primary_oom' && key(c) === key(run)))
    .map(run => run.cdp.maxUsedBytes).filter((bytes): bytes is number => bytes !== null)
  const formal = [
    'Context parity: before any Search, every page session re-derived the workload orientations from the original Export and matched the Phase 2-C2.5-A evidence field by field (digests included); the workload equals the D2-d RESULT workloadSelection.',
    `Formal Browser classification per context (Phase 2-C2.5-B / D2-b rule, unchanged): ${v.perContext.map(c => `${key(c)} ${c.classification} (D2-b before: ${c.browserBeforeClassification})`).join('; ')}. Representative verdict: ${v.formal}. Summary: ${v.overallSummary}.`,
    ...clearedPrimaries.map(c => `After H1, ${key(c)} no longer reproduced the D2-b renderer loss in the Chrome Dedicated Worker: both modes ended ${c.node.minimal.status}, equal to Node D2-d in status, Search summary, first Candidate key, extent / exhaustion, instrumented prediction counts and instrumented final progress.`),
    ...(v.overallSummary === 'browser_no_failure_all_selected_contexts'
      ? [`In the ${t.contexts} measured contexts, every H1-after Chrome Dedicated Worker Search-only run ended normally, and its Candidate-visible semantics equalled Node D2-d.`] : []),
    `Run outcomes: ${t.runs} runs over ${t.pageSessions} page sessions; first Candidate reached ${t.firstCandidateReachedRuns}; renderer (page) loss ${t.pageCrashes}; browser loss ${t.browserCrashes}; native Worker failure ${t.nativeWorkerFailures}; structured error ${t.structuredErrors}; timeout ${t.timeouts}; explicit V8 OOM crash key ${t.explicitV8OomRuns}.`,
    `Auxiliary: ${v.auxiliary.explicitV8OomCrashKey} / ${v.auxiliary.representativeRuns} representative runs carry an explicit V8 OOM crash key (explicit_v8_oom_crash_key, beside the formal classification); ${v.auxiliary.lostDuringSearchBeforeFirstCandidate} lost the renderer while the Search Worker ran, before any first Candidate notice.`,
    ...analysis.contexts.map(c => `Runtime (reference, one run each): ${key(c)} Browser ${MODES.map(mode => `${mode} ${(c.runtime.browserSearchElapsedMs[mode] ?? []).map(minutes).join(' / ')}`).join(', ')}; Node D2-d minimal ${minutes(c.runtime.nodeSearchElapsedMs.minimal)}, instrumented ${minutes(c.runtime.nodeSearchElapsedMs.instrumented)}.`),
  ]
  const notYet = [
    'That the Global Planner memory problem is solved: only the Search-only run of these contexts was measured, not the Global Planner kernel (portfolio, trials, full runs), the other Phase 2-C2 OOM orientations, other browsers or devices.',
    ...(remaining.length > 0 ? [`That the Browser Search-only memory problem is solved for these contexts: ${remaining.map(c => `${key(c)} (${c.classification})`).join(', ')} did not end normally with Node D2-d parity.`] : []),
    'A memory-efficiency multiple from the CDP samples: they are sampled (about 500 ms), include uncollected garbage, depend on GC timing, and runs end at different points (a lost run is cut at the loss); the before / after values describe what was observed, not bytes per state.',
    `The Dedicated Worker's own heap limit. ${phase2c25bWorkerHeapLimitStatement({ representativeSampledMaxBytes: primarySampled, sampledWhen: 'in the primary runs (normal terminations and losses alike)', ...heap })}`,
    `A heap comparison with Node D2-d: Node heap bytes and limits are not compared with the Browser (different runtimes; the sampled Browser maximum over all runs was ${gib(t.sampledMaxWorkerHeapBytes)}).`,
    'A Browser / Node speed ratio: one run per mode and attempt only.',
  ]
  return { formal, notYet }
}
