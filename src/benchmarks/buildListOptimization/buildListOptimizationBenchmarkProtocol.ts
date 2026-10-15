import type { BuildListOptimizationBounds, BuildListOptimizationStage } from '../../domain/planner/buildListOptimization'
import { BUILD_LIST_OPTIMIZATION_STAGES, BUILD_LIST_OPTIMIZATION_WORKER_PROTOCOL_VERSION } from '../../workers/buildListOptimizationWorkerContracts'

/**
 * Issue #260 PR-5A: the raw record of one Browser measurement run of the Production Build List global optimization (benchmark only;
 * never imported by the application).
 *
 * A record describes one run of the Production calculation through the Production Worker Client and the benchmark-only measurement
 * Worker (`buildListOptimization.worker.benchmark.entry.ts`): the same controller, Production adapter, Engine, ID factory and Clock
 * as the Production Worker, with the search bounds of the run given by the benchmark-only configuration message. The record holds
 * what the main thread observed (timestamps, the typed outcome, fixed-point memory, long tasks, lifecycle events and storage) and a
 * minimized view of the result: counts, classifications, diagnostics without identities, and SHA-256 fingerprints of the result's
 * semantics. It carries no Export body, no Target / Entry / OwnedWeapon ID, no Seed or Counter value and no file path, so a record
 * never discloses the measured data; the fingerprints alone decide semantic parity.
 *
 * Every time is a millisecond offset from the run's own start (`performance.now()` at `t0`) or an ISO wall-clock string; a value the
 * environment cannot provide is `null` (never estimated, never filled in from another source).
 */

export const BLO_BROWSER_RECORD_KIND = 'build-list-optimization-browser-run' as const
export const BLO_BROWSER_RECORD_PROTOCOL = 'build-list-optimization-browser-record:1' as const
/** The benchmark configuration message protocol of the measurement Worker (`buildListOptimization.worker.benchmark.ts`). */
export const BLO_BENCHMARK_CONFIG_PROTOCOL = 'build-list-optimization-benchmark:1' as const
export const BLO_WORKER_PROTOCOL = BUILD_LIST_OPTIMIZATION_WORKER_PROTOCOL_VERSION

/**
 * Why a run was made. `mechanics` and `lifecycle` exercise the harness itself with synthetic inputs; `pilot` is a first real run
 * observed outside every population; `timing` / `rerun` are the required semantic comparison runs (and the timing population);
 * `bounds` observes a comparison bounds set; `cancel` is a cancel trial; `memory` samples memory (its own population).
 */
export const BLO_RUN_PURPOSES = ['mechanics', 'lifecycle', 'pilot', 'timing', 'rerun', 'bounds', 'cancel', 'memory'] as const
export type BloRunPurpose = (typeof BLO_RUN_PURPOSES)[number]

/** A harness fault injection (synthetic `lifecycle` runs only): never applied to a measurement of real data. */
export const BLO_FAULT_INJECTIONS = ['worker_error', 'corrupt_result'] as const
export type BloFaultInjection = (typeof BLO_FAULT_INJECTIONS)[number]

/** Cancels the run `delayMs` after the main thread received the progress of `stage` (the first time). */
export interface BloCancelTrigger {
  stage: BuildListOptimizationStage
  delayMs: number
}

export interface BloMemoryOptions {
  /** Fixed-point readings in the page (`performance.memory`, and `measureUserAgentSpecificMemory()` when cross-origin isolated). */
  fixedPoints: boolean
  /** How long the page waits before the reading after the result was released (a GC opportunity, never a forced GC). */
  gcWaitMs: number
  /** The external driver samples every attached Worker's heap over CDP (`Runtime.getHeapUsage`). */
  cdpWorkerHeap: boolean
  /** The external driver samples the renderer processes' memory from the OS. */
  osProcessMemory: boolean
}

/** What one run is asked to do: the slot of the plan (or an unplanned run) with every option explicit. */
export interface BloSlotSpec {
  slotId: string
  purpose: BloRunPurpose
  /** True only for a run the driver makes from the committed measurement plan. */
  planned: boolean
  inputId: string
  boundsId: string
  bounds: BuildListOptimizationBounds
  cancelTrigger: BloCancelTrigger | null
  faultInjection: BloFaultInjection | null
  memory: BloMemoryOptions | null
}

/** How the run's input was identified: an Export file by its bytes, or a synthetic case of this harness. */
export type BloInputIdentity =
  | { kind: 'export'; fileName: string; bytes: number; sha256: string }
  | { kind: 'synthetic'; caseId: string; bytes: number; sha256: string }

export type BloInputRefusalCode =
  /** The text is not JSON. */
  | 'invalid_json'
  /** `prepareExportRootForImport()` refused the root (an unsupported schema or shape). */
  | 'export_unsupported'
  /** `validateExportRootForFullReplacement()` refused the root. */
  | 'export_invalid'
  /** The Export holds no RngState: the Production start reader fails closed instead of creating one. */
  | 'rng_state_missing'
  /** An `active` / `stale` Plan exists: the Production Application answers `unsupported(running_plan_exists)` without a calculation. */
  | 'running_plan_exists'

export interface BloInputPreparation {
  status: 'ready' | 'refused'
  refusal: { code: BloInputRefusalCode; issueCount: number } | null
  /** Main-thread milliseconds from the text to the PlannerInput (parse, migration, full-replacement validation, `createPlannerInput()`). */
  preparationMs: number
  /** The CalculationContext of the PlannerInput (`createBuildListCalculationContext()`); null when refused before it. */
  calculationContext: { gameVersion: string; masterDataVersion: number; rngEngineVersion: string; appSchemaVersion: number } | null
  counts: { targetWeapons: number; buildListEntries: number; ownedWeapons: number; normalCounters: number } | null
  draftPresent: boolean | null
}

export interface BloProgressReceipt {
  stage: BuildListOptimizationStage
  receivedAtMs: number
}

/** The main thread's timeline of one run; every value is milliseconds from the run's start, `null` when it did not happen. */
export interface BloTimeline {
  inputPreparedAtMs: number | null
  workerCreateStartedAtMs: number | null
  workerCreatedAtMs: number | null
  /** The benchmark-only bounds configuration message was posted (before the run request). */
  boundsPostedAtMs: number | null
  runPostStartedAtMs: number | null
  /** `postMessage(blo_run)` returned: the main thread finished serializing the PlannerInput. */
  runPostedAtMs: number | null
  progress: BloProgressReceipt[]
  /** The terminal message (`blo_result` / `blo_error`) reached the main thread. */
  terminalReceivedAtMs: number | null
  terminalType: 'blo_result' | 'blo_error' | null
  /** Reading `event.data` of the terminal message (it includes deserialization where the Browser deserializes lazily). */
  terminalDataReadMs: number | null
  /** The Client's own handling of the terminal message (the structural result check and the settle). */
  clientHandlingMs: number | null
  cancelRequestedAtMs: number | null
  /** The run's outcome was delivered to the harness. */
  outcomeAtMs: number | null
  /** The harness finished its own post-processing (projection, fingerprints, memory readings, late-message wait). */
  finishedAtMs: number | null
}

export type BloRunFailure =
  | { kind: 'worker_unavailable' | 'worker_start_failed' }
  | { kind: 'calculation_error'; code: string; domainCode: string | null; stage: BuildListOptimizationStage | null }
  | { kind: 'worker_error' | 'worker_message_error' }
  | { kind: 'protocol_violation' | 'invalid_result'; issueCount: number }

export interface BloRunOutcome {
  /** `not_run`: the input was refused before a Worker was created. */
  status: 'completed' | 'failed' | 'cancelled' | 'not_run'
  failure: BloRunFailure | null
  cancelReason: 'cancelled' | 'superseded' | 'disposed' | 'page_hidden' | null
  /** The stage of the last progress the main thread received before the outcome (null: none). */
  lastStage: BuildListOptimizationStage | null
}

export type BloResultStatus = 'optimized' | 'not_found' | 'search_bound_reached' | 'unsupported'

/** One candidate's diagnostics without identities (the ordinal is a generation order, never an identity). */
export interface BloCandidateView {
  ordinal: number
  objective: number
  routeGeneration: { outcome: string; generatedTargetCount: number; methods: { candidate_search_projected: number; shape_constrained: number } }
  verification: null | { outcome: string; maxPlanSteps: number; fullPlannerRuns: number; rejectionCodes: string[] }
}

export interface BloDiagnosticsView {
  reachTable: null | {
    window: { normal: number; gogma: number; skill: number }
    predictions: { skill: number; gogmaReset: number; gogmaKeep: number; normal: number }
    memoHits: { skill: number; gogmaReset: number; gogmaKeep: number; normal: number }
    supportQueries: number
  }
  structuralSearch: null | {
    completeness: string
    expandedNodes: number
    coverageRejections: number
    structuralCandidates: number
    noStructuralCandidateReason: string | null
  }
  candidates: BloCandidateView[]
  plannerVerifications: number
  /** The Domain's per-stage milliseconds measured inside the Worker (its monotonic clock); null when none were recorded. */
  workerStageMs: Partial<Record<BuildListOptimizationStage, number>> | null
}

/** The SHA-256 fingerprints of the result's semantics (`buildListOptimizationBenchmarkSemantic.ts`): IDs and times of the run excluded. */
export interface BloSemanticFingerprint {
  sha256: string
  components: Record<string, string>
}

export interface BloResultView {
  status: BloResultStatus
  /** optimized */
  planningTargetCount: number | null
  completedTargetCount: number | null
  physicalOperationCount: number | null
  planStepCount: number | null
  nonPhysicalStepCount: number | null
  structuralObjective: number | null
  maxPlanSteps: number | null
  conflictCount: number | null
  rejectedEntryCount: number | null
  warningCount: number | null
  generatedEntryCount: number | null
  unchangedTargetCount: number | null
  inputExclusionCount: number | null
  outOfScopeTargetCounts: { noEntry: number; excludedEntryOnly: number; disabled: number; completed: number } | null
  /** search_bound_reached: the kinds of the bounds reached, in the order reported. */
  boundKinds: string[]
  /** not_found */
  notFoundReason: string | null
  /** unsupported: the kinds of the reasons, in the order reported. */
  unsupportedReasonKinds: string[]
  diagnostics: BloDiagnosticsView | null
  semantic: BloSemanticFingerprint
}

export interface BloMemoryReading {
  label: 'before_input' | 'before_run' | 'after_outcome' | 'after_release'
  atMs: number
  /** `performance.memory` (Chrome; coarse unless precise memory info is enabled). */
  mainHeap: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } | null
  /** `performance.measureUserAgentSpecificMemory()` (cross-origin isolated pages only), summed by scope. */
  userAgentSpecific: { bytes: number; workerBytes: number; windowBytes: number; otherBytes: number } | null
  error: string | null
}

export interface BloStorageSnapshot {
  indexedDbDatabases: number | null
  localStorageKeys: number | null
  sessionStorageKeys: number | null
  cacheKeys: number | null
  serviceWorkerRegistrations: number | null
}

export interface BloRunRecord {
  kind: typeof BLO_BROWSER_RECORD_KIND
  recordProtocol: typeof BLO_BROWSER_RECORD_PROTOCOL
  /** Page-session-unique: `<sessionToken>#<sequence>`. Never the Worker requestId. */
  recordId: string
  sequence: number
  startedAt: string
  endedAt: string
  slot: Pick<BloSlotSpec, 'slotId' | 'purpose' | 'planned' | 'inputId' | 'boundsId' | 'cancelTrigger' | 'faultInjection' | 'memory'>
  bounds: BuildListOptimizationBounds
  protocols: { worker: typeof BLO_WORKER_PROTOCOL; benchmarkConfig: typeof BLO_BENCHMARK_CONFIG_PROTOCOL }
  /** `__PLANNER_GLOBAL_BENCHMARK_BUILD__` as the benchmark build embedded it (null outside a benchmark build). */
  build: unknown
  environment: {
    userAgent: string | null
    language: string | null
    hardwareConcurrency: number | null
    deviceMemory: number | null
    crossOriginIsolated: boolean | null
    isSecureContext: boolean | null
    visibilityAtStart: string | null
  }
  input: { identity: BloInputIdentity | null; preparation: BloInputPreparation }
  timeline: BloTimeline
  outcome: BloRunOutcome
  result: BloResultView | null
  /** Messages the run's Worker delivered after the outcome settled (never applied by the Client). */
  lateMessages: { count: number; types: string[] }
  memory: BloMemoryReading[]
  mainThread: { longTaskObserved: boolean; longTaskCount: number | null; longTaskMaxMs: number | null; longTaskTotalMs: number | null }
  interruptions: { type: string; atMs: number; visibilityState: string | null }[]
  storage: { before: BloStorageSnapshot | null; after: BloStorageSnapshot | null }
  /** What the harness itself found inconsistent in this run (empty for a clean record). */
  integrityIssues: string[]
}

/** The page's export of its records (one file per logical session or per run). */
export interface BloRecordExport {
  kind: 'build-list-optimization-browser-records'
  recordProtocol: typeof BLO_BROWSER_RECORD_PROTOCOL
  exportedAt: string
  records: BloRunRecord[]
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isNonNegativeInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const isFiniteNonNegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
const isNullableTime = (value: unknown) => value === null || isFiniteNonNegative(value)
const SHA256_HEX = /^[0-9a-f]{64}$/
const SLOT_ID = /^[A-Za-z0-9._:-]{1,64}$/
const STAGES: readonly string[] = BUILD_LIST_OPTIMIZATION_STAGES

/** Whether `value` is a cancel trigger of the protocol. */
export function isBloCancelTrigger(value: unknown): value is BloCancelTrigger {
  return isRecord(value) && Object.keys(value).sort().join(',') === 'delayMs,stage' && STAGES.includes(value.stage as string) && isNonNegativeInteger(value.delayMs)
}

/** Whether `value` is a memory option set of the protocol (every key explicit). */
export function isBloMemoryOptions(value: unknown): value is BloMemoryOptions {
  return isRecord(value) && Object.keys(value).sort().join(',') === 'cdpWorkerHeap,fixedPoints,gcWaitMs,osProcessMemory'
    && typeof value.fixedPoints === 'boolean' && isNonNegativeInteger(value.gcWaitMs) && typeof value.cdpWorkerHeap === 'boolean' && typeof value.osProcessMemory === 'boolean'
}

/**
 * Why a slot spec must not run (`[]` = runnable). The bounds are checked for presence only: their values are the Domain's to validate
 * (`assertBuildListOptimizationBounds()` inside the Worker), and an invalid one fails the run instead of being repaired here.
 */
export function bloSlotSpecIssues(value: unknown): string[] {
  if (!isRecord(value)) return ['slot must be an object.']
  const issues: string[] = []
  const keys = ['boundsId', 'bounds', 'cancelTrigger', 'faultInjection', 'inputId', 'memory', 'planned', 'purpose', 'slotId']
  for (const key of Object.keys(value)) if (!keys.includes(key)) issues.push(`slot.${key} is not a slot field.`)
  for (const key of keys) if (!(key in value)) issues.push(`slot.${key} is required (null where off).`)
  if (typeof value.slotId !== 'string' || !SLOT_ID.test(value.slotId)) issues.push('slot.slotId must be 1..64 characters of [A-Za-z0-9._:-].')
  if (!BLO_RUN_PURPOSES.includes(value.purpose as BloRunPurpose)) issues.push(`slot.purpose must be one of ${BLO_RUN_PURPOSES.join(', ')}.`)
  if (typeof value.planned !== 'boolean') issues.push('slot.planned must be a boolean.')
  if (typeof value.inputId !== 'string' || value.inputId === '') issues.push('slot.inputId must be a non-empty string.')
  if (typeof value.boundsId !== 'string' || value.boundsId === '') issues.push('slot.boundsId must be a non-empty string.')
  if (!isRecord(value.bounds)) issues.push('slot.bounds must be an object (every bound explicit).')
  if (!(value.cancelTrigger === null || isBloCancelTrigger(value.cancelTrigger))) issues.push('slot.cancelTrigger must be { stage, delayMs } or null.')
  if (!(value.faultInjection === null || BLO_FAULT_INJECTIONS.includes(value.faultInjection as BloFaultInjection))) issues.push('slot.faultInjection must be worker_error, corrupt_result or null.')
  if (!(value.memory === null || isBloMemoryOptions(value.memory))) issues.push('slot.memory must be { fixedPoints, gcWaitMs, cdpWorkerHeap, osProcessMemory } or null.')
  if (value.faultInjection !== null && value.purpose !== 'lifecycle') issues.push('slot.faultInjection belongs to a lifecycle run only.')
  if (value.cancelTrigger !== null && value.faultInjection !== null) issues.push('slot: a cancel trial injects no fault.')
  return issues
}

function semanticIssues(value: unknown, path: string): string[] {
  if (!isRecord(value) || typeof value.sha256 !== 'string' || !SHA256_HEX.test(value.sha256) || !isRecord(value.components)) return [`${path} must be { sha256, components }.`]
  return Object.entries(value.components).filter(([, sha]) => typeof sha !== 'string' || !SHA256_HEX.test(sha)).map(([name]) => `${path}.components.${name} must be a SHA-256.`)
}

/**
 * Why a raw record must not be analyzed (`[]` = well-formed). The analysis re-checks its own consistency rules; this is the shape
 * and the minimization (no field outside the protocol, every fingerprint a SHA-256, every time a non-negative number or null).
 */
export function bloRunRecordIssues(value: unknown): string[] {
  if (!isRecord(value)) return ['record must be an object.']
  const issues: string[] = []
  const keys = ['bounds', 'build', 'endedAt', 'environment', 'input', 'integrityIssues', 'interruptions', 'kind', 'lateMessages', 'mainThread', 'memory', 'outcome',
    'protocols', 'recordId', 'recordProtocol', 'result', 'sequence', 'slot', 'startedAt', 'storage', 'timeline']
  for (const key of Object.keys(value)) if (!keys.includes(key)) issues.push(`record.${key} is not a record field.`)
  for (const key of keys) if (!(key in value)) issues.push(`record.${key} is missing.`)
  if (issues.length > 0) return issues
  if (value.kind !== BLO_BROWSER_RECORD_KIND) issues.push(`record.kind must be ${BLO_BROWSER_RECORD_KIND}.`)
  if (value.recordProtocol !== BLO_BROWSER_RECORD_PROTOCOL) issues.push(`record.recordProtocol must be ${BLO_BROWSER_RECORD_PROTOCOL}.`)
  if (typeof value.recordId !== 'string' || value.recordId === '') issues.push('record.recordId must be a non-empty string.')
  if (!isNonNegativeInteger(value.sequence)) issues.push('record.sequence must be a non-negative integer.')
  for (const key of ['startedAt', 'endedAt'] as const) if (typeof value[key] !== 'string' || Number.isNaN(Date.parse(value[key] as string))) issues.push(`record.${key} must be an ISO time.`)
  const slotIssues = bloSlotSpecIssues(isRecord(value.slot) ? { ...value.slot, bounds: value.bounds } : value.slot)
  issues.push(...slotIssues.map(issue => `record.${issue}`))
  const protocols = value.protocols
  if (!isRecord(protocols) || protocols.worker !== BLO_WORKER_PROTOCOL || protocols.benchmarkConfig !== BLO_BENCHMARK_CONFIG_PROTOCOL) issues.push('record.protocols must name the Worker and benchmark configuration protocols.')
  const input = value.input
  if (!isRecord(input) || !isRecord(input.preparation)) {
    issues.push('record.input must be { identity, preparation }.')
  } else {
    const identity = input.identity
    if (!(identity === null || (isRecord(identity) && (identity.kind === 'export' || identity.kind === 'synthetic') && isNonNegativeInteger(identity.bytes)
      && typeof identity.sha256 === 'string' && SHA256_HEX.test(identity.sha256)))) issues.push('record.input.identity must be an Export or synthetic identity, or null.')
    if (isRecord(identity) && identity.kind === 'export' && (typeof identity.fileName !== 'string' || /[\\/]/.test(identity.fileName))) issues.push('record.input.identity.fileName must be a base name (no path).')
    const preparation = input.preparation
    if (preparation.status !== 'ready' && preparation.status !== 'refused') issues.push('record.input.preparation.status must be ready or refused.')
    if (!isFiniteNonNegative(preparation.preparationMs)) issues.push('record.input.preparation.preparationMs must be a non-negative number.')
    if ((preparation.status === 'refused') !== (preparation.refusal !== null)) issues.push('record.input.preparation: a refusal goes with status refused.')
  }
  const timeline = value.timeline
  if (!isRecord(timeline) || !Array.isArray(timeline.progress)) {
    issues.push('record.timeline must hold a progress array.')
  } else {
    for (const key of ['inputPreparedAtMs', 'workerCreateStartedAtMs', 'workerCreatedAtMs', 'boundsPostedAtMs', 'runPostStartedAtMs', 'runPostedAtMs', 'terminalReceivedAtMs',
      'terminalDataReadMs', 'clientHandlingMs', 'cancelRequestedAtMs', 'outcomeAtMs', 'finishedAtMs']) {
      if (!isNullableTime(timeline[key])) issues.push(`record.timeline.${key} must be a non-negative number or null.`)
    }
    if (!timeline.progress.every(receipt => isRecord(receipt) && STAGES.includes(receipt.stage as string) && isFiniteNonNegative(receipt.receivedAtMs))) {
      issues.push('record.timeline.progress must list { stage, receivedAtMs } receipts.')
    }
  }
  const outcome = value.outcome
  if (!isRecord(outcome) || !['completed', 'failed', 'cancelled', 'not_run'].includes(outcome.status as string)) {
    issues.push('record.outcome.status must be completed, failed, cancelled or not_run.')
  } else {
    if ((outcome.status === 'failed') !== (outcome.failure !== null)) issues.push('record.outcome: a failure goes with status failed.')
    if ((outcome.status === 'cancelled') !== (outcome.cancelReason !== null)) issues.push('record.outcome: a cancel reason goes with status cancelled.')
    if ((outcome.status === 'completed') !== (value.result !== null)) issues.push('record: a result is recorded exactly for a completed run.')
  }
  if (isRecord(value.result)) {
    if (!['optimized', 'not_found', 'search_bound_reached', 'unsupported'].includes(value.result.status as string)) issues.push('record.result.status must be a result status.')
    issues.push(...semanticIssues(value.result.semantic, 'record.result.semantic'))
  }
  const late = value.lateMessages
  if (!isRecord(late) || !isNonNegativeInteger(late.count) || !Array.isArray(late.types)) issues.push('record.lateMessages must be { count, types }.')
  if (!Array.isArray(value.memory)) issues.push('record.memory must be an array.')
  if (!Array.isArray(value.interruptions)) issues.push('record.interruptions must be an array.')
  if (!Array.isArray(value.integrityIssues) || !value.integrityIssues.every(issue => typeof issue === 'string')) issues.push('record.integrityIssues must be a string array.')
  const serialized = JSON.stringify(value)
  // Minimization: a record carries no file path and no UUID (a Target / OwnedWeapon / Plan identity of the measured data).
  if (/[A-Za-z]:\\\\|\/Users\/|\/home\//.test(serialized)) issues.push('record must not contain a file path.')
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(serialized)) issues.push('record must not contain a UUID.')
  return issues
}

/** The records of one page export (`[]` issues = every record is well-formed). */
export function readBloRecordExport(value: unknown): { records: BloRunRecord[]; issues: string[] } {
  if (!isRecord(value) || value.kind !== 'build-list-optimization-browser-records' || value.recordProtocol !== BLO_BROWSER_RECORD_PROTOCOL || !Array.isArray(value.records)) {
    return { records: [], issues: ['The file is not a Build List optimization Browser record export.'] }
  }
  const issues = value.records.flatMap((record, index) => bloRunRecordIssues(record).map(issue => `records[${index}]: ${issue}`))
  return { records: issues.length === 0 ? (value.records as BloRunRecord[]) : [], issues }
}
