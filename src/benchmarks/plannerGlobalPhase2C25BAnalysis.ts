/**
 * Issue #154 Phase 2-C2.5-B: post-hoc analysis. Research only. Never import from Production.
 *
 * It merges three recorded sources and runs no Planner and no Search:
 *
 * 1. the page's own `exportJson()` of every page session (the Browser records, verbatim);
 * 2. the external CDP driver's evidence (Worker heap samples, target lifecycle, page / browser loss, the page's relayed
 *    console events, crash dump keys) - the only source for a run whose page was lost;
 * 3. the Phase 2-C2.5-A evidence view (post-hoc Node comparison only).
 *
 * The classification rules are the pre-registered ones: a Worker failure is never a "no Candidate" result, a native
 * Worker failure is never by itself an out-of-memory claim, and a page / browser loss is inconclusive, never a Search
 * failure. An explicit Browser OOM diagnostic (a V8 OOM crash key in the renderer crash dump of that run) is reported
 * as a separate auxiliary label, beside - never instead of - the formal classification.
 */
import { stableStringify } from '../domain/models/publicTypes'
import type { Phase2C25BEvidenceView, Phase2C25BNodeContext, Phase2C25BRole } from './plannerGlobalPhase2C25BEvidence'
import type { Phase2C25BRunRecord } from './plannerGlobalPhase2C25BHarness'
import { isPhase2C25BNormalStatus, type Phase2C25BProgressSnapshot, type Phase2C25BRunStatus } from './plannerGlobalPhase2C25BProtocol'

// ---------------------------------------------------------------- recorded source shapes

export interface Phase2C25BPageExport {
  protocolVersion: string
  environment: Record<string, unknown>
  exportInfo: { fileName: string; byteSize: number; sha256: string } | null
  evidenceInfo: { fileName: string; byteSize: number; sha256: string } | null
  preparation: { status: string; parity: { matches: boolean; rows: { matches: boolean }[] } | null } | null
  records: Phase2C25BRunRecord[]
}

export interface Phase2C25BExternalWorkerTarget {
  targetIdSha: string
  createdAt: number
  attachedAt: number | null
  firstSampleAt: number | null
  lastSuccessfulSampleAt: number | null
  samples: number
  detachedAt: number | null
  destroyedAt: number | null
}

export interface Phase2C25BExternalRun {
  runKey: string
  orientationId: string
  workIndex: number
  mode: 'minimal' | 'instrumented'
  attempt: number
  sessionIndex: number
  startedAt: number
  endedAt: number | null
  driverStatus: 'page_settled' | 'page_crashed' | 'browser_crashed' | 'driver_timeout' | null
  pageStatus: string | null
  driverObservation?: string
  workerTargets: Phase2C25BExternalWorkerTarget[]
  heapSamples: { atEpochMs: number; requestMs: number; targetIdSha: string; usedSize: number; totalSize: number }[]
  sampleErrors: { at: number; requestMs: number; message: string }[]
  events: { at: number; event: string }[]
  pageEvents: ({ receivedAt: number; event: string; runKey?: string; epochMs?: number; snapshot?: Phase2C25BProgressSnapshot } & Record<string, unknown>)[]
  crash: null | { detectedAt: number; via: string; reason?: string | null; errorCode?: number | null }
  crashDumps: { ptype: string | null; loadedOrigin: string | null; v8OomLocation: string | null; v8OomDetails: string | null; mentionsAllocationFailure: boolean; mtime: string }[]
}

export interface Phase2C25BExternalEvidence {
  driver: Record<string, unknown>
  machine: Record<string, unknown>
  sessions: { index: number; crash: unknown; environment: Record<string, unknown> | null; preparation: unknown }[]
  runs: Phase2C25BExternalRun[]
  browserEvents: unknown[]
  repeatDecisions?: { context: string; attempt: number; decision: { repeat: boolean; reasons: string[] } }[]
}

// ---------------------------------------------------------------- per-run merge

export interface Phase2C25BCdpSummary {
  samples: number
  sampleErrors: number
  maxUsedBytes: number | null
  /** The last successful sample before the run ended (for a lost page: before the loss). */
  lastUsedBytes: number | null
  lastSampleBeforeEndMs: number | null
  firstSampleAfterWorkerCreateMs: number | null
  medianIntervalMs: number | null
  maxRequestMs: number | null
  /** `[ms since Worker target creation, usedSize]`, every sample (sampled, not a continuous peak). */
  trajectory: [number, number][]
}

export interface Phase2C25BMergedRun {
  runKey: string
  orientationId: string
  workIndex: number
  mode: 'minimal' | 'instrumented'
  attempt: number
  sessionIndex: number
  status: Phase2C25BRunStatus
  source: 'page_record' | 'external_only'
  searchStarted: boolean
  firstCandidateNoticed: boolean
  finalResultReceived: boolean
  structuredError: boolean
  nativeWorkerError: boolean
  semanticDigest: string | null
  result: Phase2C25BRunRecord['result'] | null
  /** Worker ms since the Search start of the last progress snapshot the page received (instrumented only). */
  lastProgress: Phase2C25BProgressSnapshot | null
  progressSnapshots: number
  cdp: Phase2C25BCdpSummary
  lifecycle: { workerTargetCreatedAtMs: number | null; attachedAtMs: number | null; firstSampleAtMs: number | null; lastSuccessfulSampleAtMs: number | null;
    detachedAtMs: number | null; destroyedAtMs: number | null; lossDetectedAtMs: number | null; lossVia: string | null; lossReason: string | null }
  /** Search start (the page's relayed `search_ready`) to the page loss, driver clock. */
  searchStartToLossMs: number | null
  workerLifetimeMs: number | null
  crashDump: null | { ptype: string | null; loadedOrigin: string | null; v8OomLocation: string | null; mentionsAllocationFailure: boolean }
  browserOomEvidence: 'explicit_v8_oom_crash_key' | null
}

const median = (values: readonly number[]) => {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function cdpSummary(run: Phase2C25BExternalRun): Phase2C25BCdpSummary {
  const worker = run.workerTargets.at(-1) ?? null
  const origin = worker?.createdAt ?? run.startedAt
  const samples = run.heapSamples
  const end = run.crash?.detectedAt ?? run.endedAt ?? Infinity
  const before = samples.filter(sample => sample.atEpochMs <= end)
  const last = before.at(-1) ?? null
  return {
    samples: samples.length, sampleErrors: run.sampleErrors.length,
    maxUsedBytes: samples.length ? Math.max(...samples.map(sample => sample.usedSize)) : null,
    lastUsedBytes: last?.usedSize ?? null, lastSampleBeforeEndMs: last === null || end === Infinity ? null : end - last.atEpochMs,
    firstSampleAfterWorkerCreateMs: samples.length ? samples[0].atEpochMs - origin : null,
    medianIntervalMs: median(samples.slice(1).map((sample, i) => sample.atEpochMs - samples[i].atEpochMs)),
    maxRequestMs: samples.length ? Math.max(...samples.map(sample => sample.requestMs)) : null,
    trajectory: samples.map(sample => [Math.round(sample.atEpochMs - origin), sample.usedSize]),
  }
}

/**
 * One run as the page recorded it, or - when the page was lost - as the external driver observed it. A page record is
 * the authority for its own status; the external evidence adds only what the page cannot know (heap samples, target
 * lifecycle, the loss itself, the crash dump key). A driver abort after the Worker target disappeared while the page
 * stayed alive becomes `worker_target_destroyed_before_first_candidate`.
 */
export function mergePhase2C25BRun(external: Phase2C25BExternalRun, page: Phase2C25BRunRecord | null): Phase2C25BMergedRun {
  if (external.driverStatus === 'page_settled' && page === null) throw new Error(`Run ${external.runKey} settled on the page but no page record exists.`)
  if (page !== null && page.runKey !== external.runKey) throw new Error(`Run key mismatch ${page.runKey} != ${external.runKey}.`)
  const relayed = (event: string) => external.pageEvents.filter(e => e.event === event)
  const relayedProgress = relayed('progress').map(e => e.snapshot).filter((s): s is Phase2C25BProgressSnapshot => s !== undefined)
  let status: Phase2C25BRunStatus
  if (page !== null) {
    status = page.status === 'aborted' && external.driverObservation === 'worker_target_destroyed_before_first_candidate'
      ? 'worker_target_destroyed_before_first_candidate' : page.status
  } else if (external.driverStatus === 'page_crashed' || external.driverStatus === 'browser_crashed' || external.driverStatus === 'driver_timeout') {
    status = external.driverStatus
  } else {
    throw new Error(`Run ${external.runKey} has neither a page record nor an external terminal status.`)
  }
  const worker = external.workerTargets.at(-1) ?? null
  const origin = worker?.createdAt ?? external.startedAt
  const rel = (value: number | null | undefined) => value === null || value === undefined ? null : value - origin
  const searchReady = relayed('search_ready')[0]?.receivedAt ?? null
  const rendererDump = external.crashDumps.find(dump => dump.ptype === 'renderer') ?? null
  const lossDetectedAt = external.crash?.detectedAt ?? null
  return {
    runKey: external.runKey, orientationId: external.orientationId, workIndex: external.workIndex, mode: external.mode, attempt: external.attempt, sessionIndex: external.sessionIndex,
    status, source: page === null ? 'external_only' : 'page_record',
    searchStarted: page !== null ? page.timeline.searchReadyAtMs !== null : searchReady !== null,
    firstCandidateNoticed: page !== null ? page.firstCandidateNotice !== null : relayed('first_candidate').length > 0,
    finalResultReceived: page?.result != null,
    structuredError: page?.error?.source === 'structured',
    nativeWorkerError: page?.error?.source === 'native_error' || page?.error?.source === 'messageerror',
    semanticDigest: page?.semanticDigest ?? null, result: page?.result ?? null,
    lastProgress: page !== null ? page.progress.snapshots.at(-1) ?? null : relayedProgress.at(-1) ?? null,
    progressSnapshots: page !== null ? page.progress.count : relayedProgress.length,
    cdp: cdpSummary(external),
    lifecycle: { workerTargetCreatedAtMs: worker === null ? null : 0, attachedAtMs: rel(worker?.attachedAt), firstSampleAtMs: rel(worker?.firstSampleAt),
      lastSuccessfulSampleAtMs: rel(worker?.lastSuccessfulSampleAt), detachedAtMs: rel(worker?.detachedAt), destroyedAtMs: rel(worker?.destroyedAt),
      lossDetectedAtMs: rel(lossDetectedAt), lossVia: external.crash?.via ?? null, lossReason: external.crash?.reason ?? null },
    searchStartToLossMs: searchReady !== null && lossDetectedAt !== null ? lossDetectedAt - searchReady : null,
    workerLifetimeMs: page?.workerLifetimeMs ?? (worker?.destroyedAt != null ? worker.destroyedAt - worker.createdAt : null),
    crashDump: rendererDump && { ptype: rendererDump.ptype, loadedOrigin: rendererDump.loadedOrigin, v8OomLocation: rendererDump.v8OomLocation,
      mentionsAllocationFailure: rendererDump.mentionsAllocationFailure },
    browserOomEvidence: status === 'page_crashed' && rendererDump?.v8OomLocation ? 'explicit_v8_oom_crash_key' : null,
  }
}

// ---------------------------------------------------------------- classification

export type Phase2C25BPairClassification =
  | 'browser_search_failure_reproduced'
  | 'browser_search_structured_error'
  | 'browser_search_failure_mixed'
  | 'failure_after_first_candidate'
  | 'browser_no_failure'
  | 'observer_semantic_mismatch'
  | 'instrumentation_contamination'
  | 'inconsistent_modes'
  | 'inconclusive_page_or_browser_crash'
  | 'inconclusive_timeout_or_abort'

type PairMode = Pick<Phase2C25BMergedRun, 'status' | 'firstCandidateNoticed' | 'semanticDigest'>

const LOST: readonly string[] = ['page_crashed', 'browser_crashed']
const UNSETTLED: readonly string[] = ['timeout', 'driver_timeout', 'worker_not_ready', 'aborted']
const NATIVE: readonly string[] = ['worker_error_before_first_candidate', 'worker_error_after_first_candidate', 'worker_messageerror', 'worker_target_destroyed_before_first_candidate']

function failureBeforeFirst(mode: PairMode): 'native' | 'structured' | null {
  if (mode.firstCandidateNoticed) return null
  if (NATIVE.includes(mode.status) && mode.status !== 'worker_error_after_first_candidate') return 'native'
  if (mode.status === 'structured_error') return 'structured'
  return null
}

/**
 * The pre-registered classification of one minimal / instrumented pair. A lost page or browser is inconclusive (never a
 * Search failure); both native Worker failures before the first Candidate is the Browser reproduction (not an OOM
 * claim); a Worker failure is never a normal termination.
 */
export function phase2c25bPairClassification(minimal: PairMode, instrumented: PairMode): Phase2C25BPairClassification {
  const modes = [minimal, instrumented]
  if (modes.some(mode => LOST.includes(mode.status))) return 'inconclusive_page_or_browser_crash'
  if (modes.some(mode => UNSETTLED.includes(mode.status))) return 'inconclusive_timeout_or_abort'
  const minimalNormal = isPhase2C25BNormalStatus(minimal.status), instrumentedNormal = isPhase2C25BNormalStatus(instrumented.status)
  if (minimalNormal && instrumentedNormal) {
    if (minimal.semanticDigest === null || instrumented.semanticDigest === null) throw new Error('A normal termination without a semantic digest.')
    return minimal.semanticDigest === instrumented.semanticDigest ? 'browser_no_failure' : 'observer_semantic_mismatch'
  }
  if (minimalNormal) return 'instrumentation_contamination'
  if (instrumentedNormal) return 'inconsistent_modes'
  const a = failureBeforeFirst(minimal), b = failureBeforeFirst(instrumented)
  if (a === null || b === null) return 'failure_after_first_candidate'
  if (a === 'native' && b === 'native') return 'browser_search_failure_reproduced'
  if (a === 'structured' && b === 'structured') return 'browser_search_structured_error'
  return 'browser_search_failure_mixed'
}

/**
 * Descriptive only, beside the formal classification: the page was lost while this run's Search Worker was running,
 * after the Search started and before any first Candidate notice, and the Worker target disappeared with it.
 */
export function phase2c25bLostDuringSearchBeforeFirstCandidate(run: Phase2C25BMergedRun): boolean {
  return run.status === 'page_crashed' && run.searchStarted && !run.firstCandidateNoticed && !run.finalResultReceived
    && run.lifecycle.destroyedAtMs !== null && run.lifecycle.lossDetectedAtMs !== null && Math.abs(run.lifecycle.destroyedAtMs - run.lifecycle.lossDetectedAtMs) <= 2000
}

// ---------------------------------------------------------------- Node comparison

function nodeMode(node: Phase2C25BNodeContext, mode: 'minimal' | 'instrumented') { return node[mode] }

function controlParity(run: Phase2C25BMergedRun, node: Phase2C25BNodeContext) {
  const n = nodeMode(node, run.mode)
  const result = run.result
  return {
    nodeStatus: n.status, browserStatus: run.status, statusMatches: run.status === n.status,
    searchSummaryMatches: result !== null && n.searchSummary !== null ? stableStringify(result.searchSummary) === stableStringify(n.searchSummary) : null,
    firstCandidateKeyMatches: result === null ? null : result.firstCandidateKeySha256 === n.firstCandidateKeySha256,
    nodeFirstCandidateKeySha256: n.firstCandidateKeySha256, browserFirstCandidateKeySha256: result?.firstCandidateKeySha256 ?? null,
    nodeTimeToFirstMs: n.timeToFirstMs, browserTimeToFirstMs: result?.timeToFirstMs ?? null,
  }
}

function oomComparison(run: Phase2C25BMergedRun, node: Phase2C25BNodeContext) {
  const n = nodeMode(node, run.mode)
  const last = run.lastProgress
  return {
    node: { status: n.status, failureWallMs: n.wallMs, lastGcBeforeMb: n.lastGc?.beforeMb ?? null,
      lastSnapshot: run.mode === 'instrumented' ? node.lastSnapshot : null },
    browser: {
      status: run.status, searchStartToLossMs: run.searchStartToLossMs, workerLifetimeMs: run.workerLifetimeMs,
      sampledMaxWorkerHeapBytes: run.cdp.maxUsedBytes, lastWorkerHeapBytesBeforeLoss: run.cdp.lastUsedBytes,
      /** Up to the last snapshot received before the page was lost (instrumented only). */
      lastReceivedProgress: last === null ? null : { elapsedMs: last.elapsedMs, trigger: last.trigger, gogmaMaxDepth: last.gogma.maxDepth, skillMaxDepth: last.skill.maxDepth,
        cumulativeGogmaGenerated: last.gogma.totalGeneratedStates, cumulativeGogmaFrontier: last.gogma.totalFrontierStates,
        maxGogmaGeneratedPerDepth: last.gogma.maxGeneratedStatesPerDepth, settledWorkItems: last.settledWorkItems, lastEvent: last.lastEvent },
    },
  }
}

// ---------------------------------------------------------------- heap limit wording

const gib = (bytes: number) => (bytes / 2 ** 30).toFixed(2)

/**
 * The one statement about the Browser heap limit. It keeps three things apart: the Dedicated Worker used heap the
 * external CDP driver sampled (a measurement), the page realm `jsHeapSizeLimit` (reference only, another realm), and
 * the Dedicated Worker's own heap limit, which is unknown unless the Worker realm exposed `performance.memory`. It
 * never equates the page realm limit with the Worker limit, and never compares either with the Node 8 GB limit.
 */
export function phase2c25bWorkerHeapLimitStatement(input: { readonly representativeSampledMaxBytes: readonly number[]; readonly pageRealmJsHeapSizeLimit: number | null;
  readonly workerRealmJsHeapSizeLimit: number | null; /** When the samples were taken; Phase 2-C2.5-B: every representative run ended with the renderer loss. */
  readonly sampledWhen?: string }): string {
  const sampled = input.representativeSampledMaxBytes
  const used = sampled.length === 0 ? 'no Dedicated Worker used heap was sampled by CDP in the representative runs'
    : `the Dedicated Worker used heap sampled by CDP reached ${gib(Math.min(...sampled))}-${gib(Math.max(...sampled))} GiB (per-run sampled maxima) ${input.sampledWhen ?? 'before the renderer loss'}`
  const page = input.pageRealmJsHeapSizeLimit === null ? 'the page realm exposed no jsHeapSizeLimit'
    : `the page realm reported performance.memory.jsHeapSizeLimit ${input.pageRealmJsHeapSizeLimit} bytes (about ${gib(input.pageRealmJsHeapSizeLimit)} GiB), a value of another realm given for reference only`
  const worker = input.workerRealmJsHeapSizeLimit === null
    ? 'the Dedicated Worker realm did not expose its own jsHeapSizeLimit, so the Worker\'s actual heap limit was not measured (unknown) and is not taken to equal the page realm value'
    : `the Dedicated Worker realm reported its own jsHeapSizeLimit ${input.workerRealmJsHeapSizeLimit} bytes`
  return `Heap measurement boundary: ${used}; ${page}; ${worker}. Neither value is compared directly with the Node 8 GB heap limit.`
}

// ---------------------------------------------------------------- whole analysis

export function analyzePhase2C25B(pages: readonly Phase2C25BPageExport[], external: Phase2C25BExternalEvidence, view: Phase2C25BEvidenceView) {
  const pageRecords = new Map<string, Phase2C25BRunRecord>()
  for (const page of pages) for (const record of page.records) {
    if (pageRecords.has(record.runKey)) throw new Error(`Two page records for ${record.runKey}.`)
    pageRecords.set(record.runKey, record)
  }
  const runs = external.runs.map(run => mergePhase2C25BRun(run, pageRecords.get(run.runKey) ?? null))
  const unmatched = [...pageRecords.keys()].filter(key => !external.runs.some(run => run.runKey === key))
  if (unmatched.length > 0) throw new Error(`Page records the driver never started: ${unmatched.join(', ')}.`)
  const workload = view.expectedContexts.filter(context => context.status === 'searchable')
  const contexts = workload.map(context => {
    const node = view.nodeContexts.find(n => n.orientationId === context.orientationId && n.workIndex === context.workIndex)
    if (!node) throw new Error(`No Node result for ${context.orientationId}#${context.workIndex}.`)
    const ofContext = runs.filter(run => run.orientationId === context.orientationId && run.workIndex === context.workIndex)
    const attempts = [...new Set(ofContext.map(run => run.attempt))].sort((a, b) => a - b).map(attempt => {
      const minimal = ofContext.find(run => run.attempt === attempt && run.mode === 'minimal') ?? null
      const instrumented = ofContext.find(run => run.attempt === attempt && run.mode === 'instrumented') ?? null
      const classification = minimal && instrumented ? phase2c25bPairClassification(minimal, instrumented) : null
      return { attempt, classification, minimalRunKey: minimal?.runKey ?? null, instrumentedRunKey: instrumented?.runKey ?? null,
        auxiliary: {
          lostDuringSearchBeforeFirstCandidate: [minimal, instrumented].map(run => run !== null && phase2c25bLostDuringSearchBeforeFirstCandidate(run)),
          browserOomEvidence: [minimal, instrumented].map(run => run?.browserOomEvidence ?? null),
          v8OomLocation: [minimal, instrumented].map(run => run?.crashDump?.v8OomLocation ?? null),
        } }
    })
    const classes = attempts.map(a => a.classification)
    const classification = classes.length === 0 || classes.includes(null) ? 'not_run'
      : new Set(classes).size === 1 ? classes[0]! : 'inconclusive_attempts_disagree'
    return {
      orientationId: context.orientationId, workIndex: context.workIndex, targetWeaponId: context.targetWeaponId, role: context.role as Phase2C25BRole, kind: context.kind,
      nodeClassification: node.classification, classification, attempts,
      nodeComparison: ofContext.map(run => ({ runKey: run.runKey,
        ...(context.role === 'completed_control' ? { control: controlParity(run, node) } : { oom: oomComparison(run, node) }) })),
      /** Controls: both modes normal with equal Browser semantics and equal to Node in status, Search summary and first Candidate key. */
      controlSemanticParity: context.role !== 'completed_control' ? null : ofContext.every(run => {
        const p = controlParity(run, node)
        return p.statusMatches && p.searchSummaryMatches !== false && p.firstCandidateKeyMatches !== false
      }) && classification === 'browser_no_failure',
    }
  })
  const count = (values: readonly string[]) => values.reduce<Record<string, number>>((out, value) => ({ ...out, [value]: (out[value] ?? 0) + 1 }), {})
  const representatives = contexts.filter(context => context.role === 'oom_representative')
  const repRuns = runs.filter(run => representatives.some(r => r.orientationId === run.orientationId && r.workIndex === run.workIndex))
  const repClasses = representatives.map(r => r.classification)
  const verdict = repClasses.length > 0 && repClasses.every(c => c === 'browser_search_failure_reproduced') ? 'browser_search_failure_reproduced'
    : repClasses.length > 0 && repClasses.every(c => c === 'inconclusive_page_or_browser_crash') ? 'inconclusive_page_or_browser_crash'
    : repClasses.length > 0 && repClasses.every(c => c === 'browser_no_failure') ? 'not_reproduced'
    : 'mixed'
  const maxHeap = runs.reduce<number | null>((max, run) => run.cdp.maxUsedBytes === null ? max : Math.max(max ?? 0, run.cdp.maxUsedBytes), null)
  return {
    totals: {
      contexts: contexts.length, runs: runs.length, attemptsRepeated: contexts.filter(c => c.attempts.length > 1).length,
      runStatuses: count(runs.map(run => run.status)),
      minimalStatuses: count(runs.filter(run => run.mode === 'minimal').map(run => run.status)),
      instrumentedStatuses: count(runs.filter(run => run.mode === 'instrumented').map(run => run.status)),
      contextClassifications: count(contexts.map(c => c.classification)),
      nativeWorkerFailures: runs.filter(run => NATIVE.includes(run.status)).length,
      structuredErrors: runs.filter(run => run.status === 'structured_error').length,
      pageCrashes: runs.filter(run => run.status === 'page_crashed').length,
      browserCrashes: runs.filter(run => run.status === 'browser_crashed').length,
      timeouts: runs.filter(run => run.status === 'timeout' || run.status === 'driver_timeout').length,
      instrumentationContamination: contexts.filter(c => c.classification === 'instrumentation_contamination').length,
      controlsWithSemanticParity: contexts.filter(c => c.controlSemanticParity === true).length,
      controls: contexts.filter(c => c.role === 'completed_control').length,
      firstCandidateReachedRuns: runs.filter(run => run.firstCandidateNoticed).length,
      sampledMaxWorkerHeapBytes: maxHeap,
    },
    verdict: {
      formal: verdict,
      representatives: representatives.map(r => ({ orientationId: r.orientationId, workIndex: r.workIndex, kind: r.kind, nodeClassification: r.nodeClassification, browserClassification: r.classification })),
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
