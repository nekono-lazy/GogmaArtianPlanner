/**
 * Issue #154 Production準備 P-1 (Research only; never imported by the app).
 *
 * The protocol between the Global Assignment Browser benchmark page and its Research-only Dedicated Worker
 * (`docs/PLANNER_GLOBAL_ASSIGNMENT_BROWSER_READINESS.md` 7.3): prefix `gab_`, version `global-assignment-browser:1`.
 *
 * A run request names the role (`first` / `fresh`), the Export the user picked (a `Blob`, or its bytes when a Blob cannot be
 * structured-cloned), the Export identity the main thread observed, the Entry set the first Worker returned (fresh only) and
 * execution-only options. It carries no condition, window, materialization rule, verification budget, expected hash, D-0C / D-1C
 * identity or RESULT: the Worker reads the registered conditions itself (`registeredD1cConditions()`), and every comparison with an
 * earlier record is post hoc (P-2). Every message carries the protocol version; a malformed or foreign-version message fails closed.
 *
 * Which terminal message is adopted is decided by the main-thread request lifecycle alone (`globalAssignmentBrowserHarness.ts`,
 * design 7.8): the Worker sends one terminal message per request and its cancel handling is best effort only.
 */
import type { CalculationContext } from '../../../domain/models/publicTypes'
import type { ExportIdentity } from '../assignmentProtocol'
import type { MaterializationProgressEvent, ShapeMaterializationResearchConditions } from '../materializationProtocol'
import type { MaterializationObservedRecord, MaterializationRunSummary, MaterializationSemanticRecord } from '../materializationRunner'
import { D1A_ENTRY_SET_KIND, type D1aEntrySet } from '../verificationProtocol'
import type { PlannerVerificationRecord, PlannerVerificationSemantic, PlannerVerificationStageEvent } from '../verify'

export const GLOBAL_ASSIGNMENT_BROWSER_PROTOCOL_VERSION = 'global-assignment-browser:1'
export type GlobalAssignmentBrowserProtocolVersion = typeof GLOBAL_ASSIGNMENT_BROWSER_PROTOCOL_VERSION

export const GAB_REQUEST_TYPES = ['gab_run', 'gab_cancel', 'gab_ping'] as const
export const GAB_RESPONSE_TYPES = ['gab_ready', 'gab_accepted', 'gab_progress', 'gab_heartbeat', 'gab_cancel_ack', 'gab_pong', 'gab_result', 'gab_cancelled', 'gab_error'] as const
export type GabRequestType = (typeof GAB_REQUEST_TYPES)[number]
export type GabResponseType = (typeof GAB_RESPONSE_TYPES)[number]

export type GabRole = 'first' | 'fresh'
export type GabYieldMode = 'message-channel' | 'timer'

/** The Export the user picked: the Blob itself, or (where a Blob cannot be structured-cloned) a transferred copy of its bytes. */
export type GabExportPayload =
  | { kind: 'blob'; blob: Blob }
  | { kind: 'array_buffer'; bytes: ArrayBuffer }

/** Execution-only options: none of them reaches a calculation or a semantic record. */
export interface GabExecutionOptions {
  yieldMode: GabYieldMode
  /** A heartbeat is sent at a yield when at least this long passed since the previous one. */
  heartbeatIntervalMs: number
  /** Worker-realm `performance.memory` in heartbeats when the Browser exposes it (never estimated). */
  workerHeapSampling: boolean
}

export interface GabRunRequest {
  type: 'gab_run'
  protocolVersion: GlobalAssignmentBrowserProtocolVersion
  requestId: string
  role: GabRole
  exportPayload: GabExportPayload
  /** The main thread's observation of the picked Export (name / bytes / SHA-256 of the raw bytes). */
  exportIdentity: ExportIdentity
  /** The first Worker's Entry set (plain data): required for `fresh`, null for `first`. */
  entrySet: D1aEntrySet | null
  execution: GabExecutionOptions
}

export interface GabCancelRequest {
  type: 'gab_cancel'
  protocolVersion: GlobalAssignmentBrowserProtocolVersion
  requestId: string
}

export interface GabPingRequest {
  type: 'gab_ping'
  protocolVersion: GlobalAssignmentBrowserProtocolVersion
  pingId: number
}

export type GabRequest = GabRunRequest | GabCancelRequest | GabPingRequest

/** The exact fields of a run request: anything else (a condition, an expected hash, a registration) is refused. */
export const GAB_RUN_REQUEST_KEYS = Object.freeze(['type', 'protocolVersion', 'requestId', 'role', 'exportPayload', 'exportIdentity', 'entrySet', 'execution'] as const)
export const GAB_EXECUTION_OPTION_KEYS = Object.freeze(['yieldMode', 'heartbeatIntervalMs', 'workerHeapSampling'] as const)
export const GAB_HEARTBEAT_INTERVAL_BOUNDS = Object.freeze({ min: 50, max: 600_000 })
const REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/
const SHA256_HEX = /^[0-9a-f]{64}$/

// ---------------------------------------------------------------------------------------------------------------------
// Worker -> main
// ---------------------------------------------------------------------------------------------------------------------

export interface GabWorkerHeapSample {
  usedJSHeapSize: number
  totalJSHeapSize: number
  jsHeapSizeLimit: number
}

/** What the Worker observed of its own realm when its module finished evaluating (design 6.3). Nothing is estimated. */
export interface GabWorkerEnvironment {
  protocolVersion: GlobalAssignmentBrowserProtocolVersion
  crossOriginIsolated: boolean | null
  isSecureContext: boolean | null
  hardwareConcurrency: number | null
  /** Chrome's rounded `navigator.deviceMemory` (null where absent). */
  deviceMemory: number | null
  userAgent: string | null
  language: string | null
  languages: string[] | null
  /** `Intl.DateTimeFormat().resolvedOptions().locale` (design 4.6: kept to separate an environment difference if one appears). */
  locale: string | null
  timeOrigin: number | null
  capabilities: { cryptoSubtle: boolean; messageChannel: boolean; structuredClone: boolean; textDecoder: boolean; workerPerformanceMemory: boolean }
  rngEngineVersion: string
  /** `__PLANNER_GLOBAL_BENCHMARK_BUILD__` as the benchmark build embedded it (null outside a benchmark build). */
  build: unknown
  /** The build commit (40 hex) when the build provenance names one; null otherwise. */
  buildCommit: string | null
}

export type GabInputStage = 'export_read' | 'export_hash' | 'utf8_decode' | 'json_parse' | 'input_build' | 'phase0'
export type GabEvidenceStage = 'materialization_semantic_hash' | 'entry_set' | 'verification_semantic_hash'

/** Progress in order: counts and stage names only, never a completion ratio or a remaining time (REQUIREMENTS 19). */
export type GabProgressEvent =
  | { kind: 'input'; stage: GabInputStage; status: 'started' | 'finished' }
  | { kind: 'materialization'; event: MaterializationProgressEvent }
  | { kind: 'verification'; event: PlannerVerificationStageEvent }
  | { kind: 'evidence'; stage: GabEvidenceStage; status: 'started' | 'finished' }

export interface GabHeartbeat {
  stage: string
  /** Worker ms since `gab_accepted`. */
  elapsedMs: number
  yields: number
  /** The longest interval between two yields (or between acceptance and the first yield) so far. */
  maxSliceMs: number
  /** The longest such interval since the previous heartbeat. */
  maxSliceSinceLastHeartbeatMs: number
  workerHeap: GabWorkerHeapSample | null
}

export interface GabSliceStat {
  /** Synchronous segments of this stage, split at yields and at stage boundaries. */
  segments: number
  maxSliceMs: number
  totalMs: number
  yields: number
}

export interface GabYieldGap {
  /** Worker ms between two yields (the event loop could dispatch nothing in between). */
  ms: number
  fromStage: string
  toStage: string
}

export interface GabWorkerTiming {
  input: { exportReadMs: number; exportHashMs: number; decodeMs: number; parseMs: number; buildInputMs: number; totalMs: number }
  /** The fresh Worker's own Phase 0 (the first Worker's is `materialization.observed.elapsedMs.context`). */
  phase0Ms: number | null
  materializationWallMs: number | null
  verificationWallMs: number | null
  evidence: { materializationHashMs: number | null; entrySetMs: number | null; verificationHashMs: number | null }
  /** Stage start -> stage result (input, calculation and evidence). */
  stageTotalMs: number
  /** `gab_accepted` -> result post. */
  workerTotalMs: number
}

export interface GabWorkerObserved {
  timing: GabWorkerTiming
  slices: Record<string, GabSliceStat>
  longestYieldGap: GabYieldGap | null
  yields: number
  heartbeats: number
  progressEvents: number
  workerHeap: GabWorkerHeapSample[] | null
  /** Main-thread alignment: `performance.timeOrigin + performance.now()` of the Worker when it accepted the request. */
  acceptedAtEpochMs: number
}

export interface GabConditionsRecord {
  materialization: ShapeMaterializationResearchConditions
  researchMaxPlanSteps: number
  verificationBudget: number
  /** Where the Worker read them (the Worker entry: `registeredD1cConditions`). Never a request field. */
  source: string
}

export interface GabWorkerResult {
  protocolVersion: GlobalAssignmentBrowserProtocolVersion
  requestId: string
  role: GabRole
  environment: GabWorkerEnvironment
  /** The Worker's own observation of the Export (SHA-256 over the raw bytes, before decoding). */
  exportObservation: ExportIdentity & { matchesRequest: boolean }
  calculationContext: CalculationContext
  rngEngineVersion: string
  conditions: GabConditionsRecord
  /** The PlannerInput's `options.maxPlanSteps` (validation only; Phase D' uses `conditions.researchMaxPlanSteps`). */
  plannerInputMaxPlanStepsForValidationOnly: number
  phase0: { planningTargetCount: number; planningTargetIdsSorted: string[] | null }
  /** First only. */
  materialization: { semantic: MaterializationSemanticRecord; semanticSha256: string; summary: MaterializationRunSummary; observed: MaterializationObservedRecord; handoffCount: number } | null
  /** First only, and only for an `all_materialized` handoff (design 7.4). */
  entrySet: { value: D1aEntrySet; sha256: string; entryFingerprint: string; entryCount: number } | null
  /** Fresh only: the Entry set it planned with, as it re-checked it. */
  freshEntrySet: { entryFingerprint: string; entryCount: number } | null
  /** Null when Phase D' was not reached (no handoff). */
  verification: { semantic: PlannerVerificationSemantic; semanticSha256: string; observed: PlannerVerificationRecord['observed'] } | null
  /** Integrity issues the Worker found in its own run (handoffs over the budget, a handoff that is not the record's Entries, ...). */
  integrityIssues: string[]
  observed: GabWorkerObserved
  formal: false
  oracleFreeExecution: true
}

export type GabErrorCode =
  | 'invalid_request'
  | 'duplicate_request'
  | 'worker_already_used'
  | 'export_read_failed'
  | 'export_changed'
  | 'input_build_failed'
  | 'condition_refused'
  | 'fresh_phase0_refused'
  | 'entry_set_refused'
  | 'calculation_failed'

export interface GabWorkerError {
  code: GabErrorCode
  stage: string
  errorName: string
  message: string
}

export interface GabCancelledObservation {
  /** The stage the Worker was in when it stopped. */
  stoppedAt: string
  /** `cancel_point`: an existing cancel point or a stage boundary stopped it; `before_result`: the result was ready but the flag was set. */
  via: 'cancel_point' | 'before_result'
  elapsedMs: number
  yields: number
  maxSliceMs: number
}

export type GabResponse =
  | { type: 'gab_ready'; protocolVersion: GlobalAssignmentBrowserProtocolVersion; environment: GabWorkerEnvironment }
  | { type: 'gab_accepted'; protocolVersion: GlobalAssignmentBrowserProtocolVersion; requestId: string; role: GabRole; acceptedAtEpochMs: number }
  | { type: 'gab_progress'; protocolVersion: GlobalAssignmentBrowserProtocolVersion; requestId: string; event: GabProgressEvent; atMs: number }
  | { type: 'gab_heartbeat'; protocolVersion: GlobalAssignmentBrowserProtocolVersion; requestId: string; heartbeat: GabHeartbeat }
  | { type: 'gab_cancel_ack'; protocolVersion: GlobalAssignmentBrowserProtocolVersion; requestId: string }
  | { type: 'gab_pong'; protocolVersion: GlobalAssignmentBrowserProtocolVersion; pingId: number }
  | { type: 'gab_result'; protocolVersion: GlobalAssignmentBrowserProtocolVersion; requestId: string; result: GabWorkerResult }
  | { type: 'gab_cancelled'; protocolVersion: GlobalAssignmentBrowserProtocolVersion; requestId: string; observed: GabCancelledObservation }
  | { type: 'gab_error'; protocolVersion: GlobalAssignmentBrowserProtocolVersion; requestId: string | null; error: GabWorkerError }

// ---------------------------------------------------------------------------------------------------------------------
// Guards and validation
// ---------------------------------------------------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A message that claims to be a `gab_` request (its fields are validated separately). */
export function isGabRequestType(value: unknown): value is { type: GabRequestType } {
  return isRecord(value) && (GAB_REQUEST_TYPES as readonly unknown[]).includes(value.type)
}

/** A message that claims to be a `gab_` response (its fields are validated by `gabResponseIssues()`). */
export function isGabResponseType(value: unknown): value is { type: GabResponseType } {
  return isRecord(value) && (GAB_RESPONSE_TYPES as readonly unknown[]).includes(value.type)
}

function exportIdentityIssues(value: unknown, at: string): string[] {
  if (!isRecord(value)) return [`${at} must be an object.`]
  const issues: string[] = []
  const keys = Object.keys(value).sort()
  if (JSON.stringify(keys) !== JSON.stringify(['bytes', 'fileName', 'sha256'])) issues.push(`${at} must have exactly fileName, bytes and sha256.`)
  if (typeof value.fileName !== 'string' || value.fileName.length === 0 || value.fileName.length > 512) issues.push(`${at}.fileName must be a non-empty string.`)
  if (!Number.isSafeInteger(value.bytes) || (value.bytes as number) < 0) issues.push(`${at}.bytes must be a non-negative integer.`)
  if (typeof value.sha256 !== 'string' || !SHA256_HEX.test(value.sha256)) issues.push(`${at}.sha256 must be 64 lower-case hex characters.`)
  return issues
}

/** An ArrayBuffer of any realm (a structured clone or another global's buffer is not `instanceof` this realm's ArrayBuffer). */
function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return Object.prototype.toString.call(value) === '[object ArrayBuffer]'
}

function exportPayloadIssues(value: unknown): string[] {
  if (!isRecord(value)) return ['exportPayload must be an object.']
  if (value.kind === 'blob') {
    const blob = value.blob as { arrayBuffer?: unknown; size?: unknown } | null | undefined
    const ok = typeof blob === 'object' && blob !== null && typeof blob.arrayBuffer === 'function' && typeof blob.size === 'number'
    return [...(Object.keys(value).sort().join(',') === 'blob,kind' ? [] : ['exportPayload (blob) must have exactly kind and blob.']), ...(ok ? [] : ['exportPayload.blob must be a Blob.'])]
  }
  if (value.kind === 'array_buffer') {
    return [...(Object.keys(value).sort().join(',') === 'bytes,kind' ? [] : ['exportPayload (array_buffer) must have exactly kind and bytes.']),
      ...(isArrayBuffer(value.bytes) ? [] : ['exportPayload.bytes must be an ArrayBuffer.'])]
  }
  return [`exportPayload.kind must be blob or array_buffer (got ${JSON.stringify(value.kind)}).`]
}

function executionIssues(value: unknown): string[] {
  if (!isRecord(value)) return ['execution must be an object.']
  const issues: string[] = []
  const unknown = Object.keys(value).filter(key => !(GAB_EXECUTION_OPTION_KEYS as readonly string[]).includes(key))
  if (unknown.length > 0) issues.push(`execution has unknown fields: ${unknown.sort().join(', ')}.`)
  for (const key of GAB_EXECUTION_OPTION_KEYS) if (!(key in value)) issues.push(`execution.${key} is required.`)
  if (value.yieldMode !== 'message-channel' && value.yieldMode !== 'timer') issues.push('execution.yieldMode must be message-channel or timer.')
  const interval = value.heartbeatIntervalMs
  if (!Number.isSafeInteger(interval) || (interval as number) < GAB_HEARTBEAT_INTERVAL_BOUNDS.min || (interval as number) > GAB_HEARTBEAT_INTERVAL_BOUNDS.max) {
    issues.push(`execution.heartbeatIntervalMs must be an integer in ${GAB_HEARTBEAT_INTERVAL_BOUNDS.min}..${GAB_HEARTBEAT_INTERVAL_BOUNDS.max}.`)
  }
  if (typeof value.workerHeapSampling !== 'boolean') issues.push('execution.workerHeapSampling must be a boolean.')
  return issues
}

/**
 * Why a run request must be refused before any calculation (`[]` = it may run): a field other than the exact run fields (no
 * condition, expected hash or registration ever travels), another protocol version, a malformed request ID, role, Export payload or
 * identity, execution option, and a role / Entry set mismatch (first: null; fresh: an Entry set object, which the Worker then
 * re-checks with `d1aEntrySetIssues()` against its own observations).
 */
export function gabRunRequestIssues(value: unknown): string[] {
  if (!isRecord(value)) return ['The run request is not an object.']
  const issues: string[] = []
  const unknown = Object.keys(value).filter(key => !(GAB_RUN_REQUEST_KEYS as readonly string[]).includes(key))
  if (unknown.length > 0) issues.push(`The run request has fields outside the protocol: ${unknown.sort().join(', ')} (no condition, expected hash or registration travels in a request).`)
  for (const key of GAB_RUN_REQUEST_KEYS) if (!(key in value)) issues.push(`The run request has no ${key}.`)
  if (value.type !== 'gab_run') issues.push(`type must be gab_run (got ${JSON.stringify(value.type)}).`)
  if (value.protocolVersion !== GLOBAL_ASSIGNMENT_BROWSER_PROTOCOL_VERSION) issues.push(`protocolVersion must be ${GLOBAL_ASSIGNMENT_BROWSER_PROTOCOL_VERSION} (got ${JSON.stringify(value.protocolVersion)}).`)
  if (typeof value.requestId !== 'string' || !REQUEST_ID.test(value.requestId)) issues.push('requestId must be 1..128 characters of [A-Za-z0-9._:-].')
  if (value.role !== 'first' && value.role !== 'fresh') issues.push(`role must be first or fresh (got ${JSON.stringify(value.role)}).`)
  if ('exportPayload' in value) issues.push(...exportPayloadIssues(value.exportPayload))
  if ('exportIdentity' in value) issues.push(...exportIdentityIssues(value.exportIdentity, 'exportIdentity'))
  if ('execution' in value) issues.push(...executionIssues(value.execution))
  if (value.role === 'first' && value.entrySet !== null) issues.push('A first request carries no Entry set (entrySet must be null).')
  if (value.role === 'fresh' && !(isRecord(value.entrySet) && value.entrySet.kind === D1A_ENTRY_SET_KIND)) issues.push(`A fresh request needs the first Worker's Entry set (kind ${D1A_ENTRY_SET_KIND}).`)
  return issues
}

export function gabCancelRequestIssues(value: unknown): string[] {
  if (!isRecord(value)) return ['The cancel request is not an object.']
  const issues: string[] = []
  if (Object.keys(value).sort().join(',') !== 'protocolVersion,requestId,type') issues.push('A cancel request has exactly type, protocolVersion and requestId.')
  if (value.protocolVersion !== GLOBAL_ASSIGNMENT_BROWSER_PROTOCOL_VERSION) issues.push(`protocolVersion must be ${GLOBAL_ASSIGNMENT_BROWSER_PROTOCOL_VERSION}.`)
  if (typeof value.requestId !== 'string' || !REQUEST_ID.test(value.requestId)) issues.push('requestId must be 1..128 characters of [A-Za-z0-9._:-].')
  return issues
}

export function gabPingRequestIssues(value: unknown): string[] {
  if (!isRecord(value)) return ['The ping request is not an object.']
  const issues: string[] = []
  if (Object.keys(value).sort().join(',') !== 'pingId,protocolVersion,type') issues.push('A ping request has exactly type, protocolVersion and pingId.')
  if (value.protocolVersion !== GLOBAL_ASSIGNMENT_BROWSER_PROTOCOL_VERSION) issues.push(`protocolVersion must be ${GLOBAL_ASSIGNMENT_BROWSER_PROTOCOL_VERSION}.`)
  if (!Number.isSafeInteger(value.pingId) || (value.pingId as number) < 0) issues.push('pingId must be a non-negative integer.')
  return issues
}

/** The request issues of any `gab_` request message. */
export function gabRequestIssues(value: unknown): string[] {
  if (!isGabRequestType(value)) return ['Not a gab_ request.']
  switch (value.type) {
    case 'gab_run': return gabRunRequestIssues(value)
    case 'gab_cancel': return gabCancelRequestIssues(value)
    case 'gab_ping': return gabPingRequestIssues(value)
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Response bodies: the structure the main thread reads (never a deep walk of a semantic record; the re-hash, the Entry set check and
// the integrity checks of the runner own the rest)
// ---------------------------------------------------------------------------------------------------------------------

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const isNonNegativeInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0
const isPositiveInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string')
const GAB_INPUT_STAGES: readonly GabInputStage[] = ['export_read', 'export_hash', 'utf8_decode', 'json_parse', 'input_build', 'phase0']
const GAB_EVIDENCE_STAGES: readonly GabEvidenceStage[] = ['materialization_semantic_hash', 'entry_set', 'verification_semantic_hash']
const MATERIALIZATION_OUTCOME_KINDS = ['unsupported_input', 'scan_cancelled', 'structural_search_invalid', 'no_structural_candidate', 'structural_search_incomplete', 'structural_candidates_materialized']
const VERIFICATION_OUTCOME_KINDS = ['conditions_met', 'materialization_failed', 'materialization_unconfirmed', 'materialization_unsupported', 'planning_target_set_changed', 'planner_rejected', 'objective_mismatch', 'unmeasured']

/** The environment fields the main thread reads (`gabEnvironmentIssues()`, the runner's provenance checks, the page). */
function environmentBodyIssues(value: unknown, at: string): string[] {
  if (!isRecord(value)) return [`${at} must be an object.`]
  const issues: string[] = []
  if (typeof value.protocolVersion !== 'string') issues.push(`${at}.protocolVersion must be a string.`)
  for (const key of ['crossOriginIsolated', 'isSecureContext'] as const) if (value[key] !== null && typeof value[key] !== 'boolean') issues.push(`${at}.${key} must be a boolean or null.`)
  const capabilities = value.capabilities
  if (!isRecord(capabilities)) issues.push(`${at}.capabilities must be an object.`)
  else for (const key of ['cryptoSubtle', 'messageChannel', 'structuredClone', 'textDecoder', 'workerPerformanceMemory']) if (typeof capabilities[key] !== 'boolean') issues.push(`${at}.capabilities.${key} must be a boolean.`)
  if (typeof value.rngEngineVersion !== 'string') issues.push(`${at}.rngEngineVersion must be a string.`)
  if (value.buildCommit !== null && typeof value.buildCommit !== 'string') issues.push(`${at}.buildCommit must be a string or null.`)
  if (value.locale !== null && typeof value.locale !== 'string') issues.push(`${at}.locale must be a string or null.`)
  return issues
}

function progressEventIssues(value: unknown): string[] {
  if (!isRecord(value)) return ['gab_progress.event must be an object.']
  const status = (status: unknown) => status === 'started' || status === 'finished'
  switch (value.kind) {
    case 'input': return GAB_INPUT_STAGES.includes(value.stage as GabInputStage) && status(value.status) ? [] : ['gab_progress input event needs a known stage and status.']
    case 'evidence': return GAB_EVIDENCE_STAGES.includes(value.stage as GabEvidenceStage) && status(value.status) ? [] : ['gab_progress evidence event needs a known stage and status.']
    case 'materialization': return isRecord(value.event) && typeof value.event.kind === 'string' ? [] : ['gab_progress materialization event needs event.kind.']
    case 'verification': return isRecord(value.event) && typeof value.event.stage === 'string' && status(value.event.status) ? [] : ['gab_progress verification event needs event.stage and event.status.']
    default: return [`gab_progress.event.kind ${JSON.stringify(value.kind)} is unknown.`]
  }
}

function numbersIssues(value: Record<string, unknown>, at: string, keys: readonly string[]): string[] {
  return keys.filter(key => !isFiniteNumber(value[key])).map(key => `${at}.${key} must be a finite number.`)
}

/** The body of each response type (`gab_result` only as an object here: `gabWorkerResultIssues()` validates it when it is adopted). */
function responseBodyIssues(type: GabResponseType, message: Record<string, unknown>): string[] {
  switch (type) {
    case 'gab_ready': return environmentBodyIssues(message.environment, 'gab_ready.environment')
    case 'gab_accepted': return [...(message.role === 'first' || message.role === 'fresh' ? [] : ['gab_accepted.role must be first or fresh.']), ...(isFiniteNumber(message.acceptedAtEpochMs) ? [] : ['gab_accepted.acceptedAtEpochMs must be a finite number.'])]
    case 'gab_progress': return [...progressEventIssues(message.event), ...(isFiniteNumber(message.atMs) ? [] : ['gab_progress.atMs must be a finite number.'])]
    case 'gab_heartbeat': {
      const heartbeat = message.heartbeat
      if (!isRecord(heartbeat)) return ['gab_heartbeat.heartbeat must be an object.']
      return [...(typeof heartbeat.stage === 'string' ? [] : ['gab_heartbeat.heartbeat.stage must be a string.']),
        ...numbersIssues(heartbeat, 'gab_heartbeat.heartbeat', ['elapsedMs', 'yields', 'maxSliceMs', 'maxSliceSinceLastHeartbeatMs']),
        ...(heartbeat.workerHeap === null || isRecord(heartbeat.workerHeap) ? [] : ['gab_heartbeat.heartbeat.workerHeap must be an object or null.'])]
    }
    case 'gab_cancel_ack': return []
    case 'gab_pong': return isNonNegativeInteger(message.pingId) ? [] : ['gab_pong.pingId must be a non-negative integer.']
    case 'gab_result': return isRecord(message.result) ? [] : ['gab_result.result must be an object.']
    case 'gab_cancelled': {
      const observed = message.observed
      if (!isRecord(observed)) return ['gab_cancelled.observed must be an object.']
      return [...(typeof observed.stoppedAt === 'string' ? [] : ['gab_cancelled.observed.stoppedAt must be a string.']),
        ...(observed.via === 'cancel_point' || observed.via === 'before_result' ? [] : ['gab_cancelled.observed.via must be cancel_point or before_result.']),
        ...numbersIssues(observed, 'gab_cancelled.observed', ['elapsedMs', 'yields', 'maxSliceMs'])]
    }
    case 'gab_error': {
      const error = message.error
      if (!isRecord(error)) return ['gab_error.error must be an object.']
      return ['code', 'stage', 'errorName', 'message'].filter(key => typeof error[key] !== 'string').map(key => `gab_error.error.${key} must be a string.`)
    }
  }
}

/**
 * Why a message that claims to be a `gab_` response is malformed (`[]` = well-formed): another protocol version, a missing request ID
 * / ping ID, or a body without the fields the main thread reads. The main thread fails a run closed on a malformed response; it never
 * guesses its meaning. A `gab_result` body is validated in full by `gabWorkerResultIssues()` before it is adopted.
 */
export function gabResponseIssues(value: unknown): string[] {
  if (!isGabResponseType(value)) return ['Not a gab_ response.']
  const message = value as Record<string, unknown>
  const issues: string[] = []
  if (message.protocolVersion !== GLOBAL_ASSIGNMENT_BROWSER_PROTOCOL_VERSION) issues.push(`protocolVersion must be ${GLOBAL_ASSIGNMENT_BROWSER_PROTOCOL_VERSION} (got ${JSON.stringify(message.protocolVersion)}).`)
  const requestScoped = value.type !== 'gab_ready' && value.type !== 'gab_pong'
  if (requestScoped && value.type !== 'gab_error' && typeof message.requestId !== 'string') issues.push(`${value.type} needs a requestId.`)
  if (value.type === 'gab_error' && message.requestId !== null && typeof message.requestId !== 'string') issues.push('gab_error needs a requestId or null.')
  issues.push(...responseBodyIssues(value.type, message))
  return issues
}

function materializationBodyIssues(value: unknown): string[] {
  if (!isRecord(value)) return ['result.materialization must be an object or null.']
  const issues: string[] = []
  const semantic = value.semantic
  if (!isRecord(semantic)) issues.push('result.materialization.semantic must be an object.')
  else {
    if (!isRecord(semantic.outcome) || !MATERIALIZATION_OUTCOME_KINDS.includes(semantic.outcome.kind as string)) issues.push('result.materialization.semantic.outcome needs a known kind.')
    if (!isRecord(semantic.input)) issues.push('result.materialization.semantic.input must be an object.')
    if (!Array.isArray(semantic.candidates)) issues.push('result.materialization.semantic.candidates must be an array.')
    if (!Array.isArray(semantic.integrityIssues)) issues.push('result.materialization.semantic.integrityIssues must be an array.')
  }
  if (typeof value.semanticSha256 !== 'string' || !SHA256_HEX.test(value.semanticSha256)) issues.push('result.materialization.semanticSha256 must be 64 lower-case hex characters.')
  if (!isRecord(value.summary)) issues.push('result.materialization.summary must be an object.')
  if (!isRecord(value.observed) || !isRecord(value.observed.elapsedMs)) issues.push('result.materialization.observed.elapsedMs must be an object.')
  if (!isNonNegativeInteger(value.handoffCount)) issues.push('result.materialization.handoffCount must be a non-negative integer.')
  return issues
}

function verificationBodyIssues(value: unknown): string[] {
  if (!isRecord(value)) return ['result.verification must be an object or null.']
  const issues: string[] = []
  const semantic = value.semantic
  if (!isRecord(semantic)) issues.push('result.verification.semantic must be an object.')
  else {
    const outcome = semantic.outcome
    if (!isRecord(outcome) || !VERIFICATION_OUTCOME_KINDS.includes(outcome.kind as string)) issues.push('result.verification.semantic.outcome needs a known kind.')
    if (!isRecord(semantic.candidate) || !isNonNegativeInteger(semantic.candidate.planningTargetCount)) issues.push('result.verification.semantic.candidate.planningTargetCount must be a non-negative integer.')
    const finalInput = semantic.finalInput
    if (finalInput !== null && !(isRecord(finalInput) && isStringArray(finalInput.phase0PlanningTargetIds))) issues.push('result.verification.semantic.finalInput must be null or carry phase0PlanningTargetIds.')
    const planner = semantic.planner
    if (planner !== null && !(isRecord(planner) && isNonNegativeInteger(planner.fullPlannerRuns))) issues.push('result.verification.semantic.planner must be null or carry fullPlannerRuns.')
    const physical = semantic.physical
    if (physical !== null && !(isRecord(physical) && isFiniteNumber(physical.objective))) issues.push('result.verification.semantic.physical must be null or carry objective.')
    // The judgement reads these of a run that met every condition.
    if (isRecord(outcome) && outcome.kind === 'conditions_met') {
      if (!isRecord(finalInput) || !isRecord(planner) || !isRecord(physical) || !isNonNegativeInteger(physical.physicalOperations) || !isNonNegativeInteger(physical.planSteps)) {
        issues.push('result.verification.semantic of conditions_met needs finalInput, planner and physical (physicalOperations, planSteps).')
      }
    }
  }
  if (typeof value.semanticSha256 !== 'string' || !SHA256_HEX.test(value.semanticSha256)) issues.push('result.verification.semanticSha256 must be 64 lower-case hex characters.')
  if (!isRecord(value.observed) || !isRecord(value.observed.elapsedMs)) issues.push('result.verification.observed.elapsedMs must be an object.')
  return issues
}

function entrySetBodyIssues(value: unknown): string[] {
  if (!isRecord(value)) return ['result.entrySet must be an object or null.']
  const issues: string[] = []
  const set = value.value
  if (!isRecord(set) || set.kind !== D1A_ENTRY_SET_KIND || !Array.isArray(set.materializedEntries) || typeof set.entryFingerprint !== 'string' || !isRecord(set.candidate)) {
    issues.push(`result.entrySet.value must be a ${D1A_ENTRY_SET_KIND} with a candidate, materializedEntries and entryFingerprint.`)
  } else {
    if (value.entryFingerprint !== set.entryFingerprint) issues.push('result.entrySet.entryFingerprint is not the Entry set\'s own.')
    if (value.entryCount !== set.materializedEntries.length) issues.push('result.entrySet.entryCount is not the Entry set\'s own.')
  }
  if (typeof value.sha256 !== 'string' || !SHA256_HEX.test(value.sha256)) issues.push('result.entrySet.sha256 must be 64 lower-case hex characters.')
  if (typeof value.entryFingerprint !== 'string') issues.push('result.entrySet.entryFingerprint must be a string.')
  if (!isNonNegativeInteger(value.entryCount)) issues.push('result.entrySet.entryCount must be a non-negative integer.')
  return issues
}

/**
 * Why a `gab_result` body must not be adopted (`[]` = the main thread can read it safely): the structure the runner, the judgement and
 * the page read, which fields may be null and which must exist, and what each role must carry. It does not walk a semantic record: its
 * content is checked by the main thread's re-hash, the Entry set check and the run's integrity checks. `expected` is the request the
 * harness is adopting (another request ID or role is never adopted).
 */
export function gabWorkerResultIssues(value: unknown, expected?: { requestId: string; role: GabRole }): string[] {
  if (!isRecord(value)) return ['result must be an object.']
  const issues: string[] = []
  if (value.protocolVersion !== GLOBAL_ASSIGNMENT_BROWSER_PROTOCOL_VERSION) issues.push(`result.protocolVersion must be ${GLOBAL_ASSIGNMENT_BROWSER_PROTOCOL_VERSION}.`)
  if (typeof value.requestId !== 'string') issues.push('result.requestId must be a string.')
  if (value.role !== 'first' && value.role !== 'fresh') issues.push('result.role must be first or fresh.')
  if (expected !== undefined && (value.requestId !== expected.requestId || value.role !== expected.role)) issues.push(`result is for ${String(value.role)} / ${String(value.requestId)}, not ${expected.role} / ${expected.requestId}.`)
  issues.push(...environmentBodyIssues(value.environment, 'result.environment'))
  const observation = value.exportObservation
  if (!isRecord(observation)) issues.push('result.exportObservation must be an object.')
  else {
    if (typeof observation.fileName !== 'string') issues.push('result.exportObservation.fileName must be a string.')
    if (!isNonNegativeInteger(observation.bytes)) issues.push('result.exportObservation.bytes must be a non-negative integer.')
    if (typeof observation.sha256 !== 'string' || !SHA256_HEX.test(observation.sha256)) issues.push('result.exportObservation.sha256 must be 64 lower-case hex characters.')
    if (typeof observation.matchesRequest !== 'boolean') issues.push('result.exportObservation.matchesRequest must be a boolean.')
  }
  const context = value.calculationContext
  if (!isRecord(context) || typeof context.gameVersion !== 'string' || !isFiniteNumber(context.masterDataVersion) || typeof context.rngEngineVersion !== 'string' || !isFiniteNumber(context.appSchemaVersion)) {
    issues.push('result.calculationContext needs gameVersion, masterDataVersion, rngEngineVersion and appSchemaVersion.')
  }
  if (typeof value.rngEngineVersion !== 'string') issues.push('result.rngEngineVersion must be a string.')
  const conditions = value.conditions
  if (!isRecord(conditions) || !isRecord(conditions.materialization) || !isPositiveInteger(conditions.researchMaxPlanSteps) || !isPositiveInteger(conditions.verificationBudget) || typeof conditions.source !== 'string') {
    issues.push('result.conditions needs materialization, researchMaxPlanSteps, verificationBudget and source.')
  }
  if (!isPositiveInteger(value.plannerInputMaxPlanStepsForValidationOnly)) issues.push('result.plannerInputMaxPlanStepsForValidationOnly must be a positive integer.')
  const phase0 = value.phase0
  if (!isRecord(phase0) || !isNonNegativeInteger(phase0.planningTargetCount) || !(phase0.planningTargetIdsSorted === null || isStringArray(phase0.planningTargetIdsSorted))) {
    issues.push('result.phase0 needs planningTargetCount and planningTargetIdsSorted (a string array or null).')
  }
  for (const key of ['materialization', 'entrySet', 'freshEntrySet', 'verification'] as const) if (!(key in value)) issues.push(`result.${key} is required (null when absent).`)
  if (value.materialization !== null && value.materialization !== undefined) issues.push(...materializationBodyIssues(value.materialization))
  if (value.verification !== null && value.verification !== undefined) issues.push(...verificationBodyIssues(value.verification))
  if (value.entrySet !== null && value.entrySet !== undefined) issues.push(...entrySetBodyIssues(value.entrySet))
  const fresh = value.freshEntrySet
  if (fresh !== null && fresh !== undefined && !(isRecord(fresh) && typeof fresh.entryFingerprint === 'string' && isNonNegativeInteger(fresh.entryCount))) issues.push('result.freshEntrySet must be null or carry entryFingerprint and entryCount.')
  if (!isStringArray(value.integrityIssues)) issues.push('result.integrityIssues must be an array of strings.')
  const observed = value.observed
  if (!isRecord(observed)) issues.push('result.observed must be an object.')
  else {
    if (!isRecord(observed.timing) || !isFiniteNumber(observed.timing.workerTotalMs)) issues.push('result.observed.timing needs workerTotalMs.')
    if (!isRecord(observed.slices)) issues.push('result.observed.slices must be an object.')
    if (observed.longestYieldGap !== null && !(isRecord(observed.longestYieldGap) && isFiniteNumber(observed.longestYieldGap.ms))) issues.push('result.observed.longestYieldGap must be null or carry ms.')
    for (const key of ['yields', 'heartbeats', 'progressEvents']) if (!isNonNegativeInteger(observed[key])) issues.push(`result.observed.${key} must be a non-negative integer.`)
    if (observed.workerHeap !== null && !Array.isArray(observed.workerHeap)) issues.push('result.observed.workerHeap must be an array or null.')
    if (!isFiniteNumber(observed.acceptedAtEpochMs)) issues.push('result.observed.acceptedAtEpochMs must be a finite number.')
  }
  if (value.formal !== false || value.oracleFreeExecution !== true) issues.push('result must be formal: false and oracleFreeExecution: true.')
  // What each role carries (design 6.2 / 7.4): first materializes and hands over an Entry set only with a verified handoff; fresh plans.
  // (A missing part is reported above as required; these read the parts that are there.)
  if (value.role === 'first') {
    if (value.materialization === null) issues.push('a first result needs its materialization record.')
    if (value.freshEntrySet != null) issues.push('a first result carries no freshEntrySet.')
    if (value.entrySet != null && value.verification === null) issues.push('a first result with an Entry set needs its verification record.')
  }
  if (value.role === 'fresh') {
    if (value.materialization != null || value.entrySet != null) issues.push('a fresh result carries no materialization record or Entry set.')
    if (value.verification === null || value.freshEntrySet === null) issues.push('a fresh result needs its verification record and freshEntrySet.')
    if (isRecord(phase0) && phase0.planningTargetIdsSorted === null) issues.push('a fresh result needs its own Phase 0 planning Target IDs.')
  }
  return issues
}

/** The name of a thrown value (an Error, a DOMException of any realm, or the value's type). */
export function gabErrorName(error: unknown): string {
  return typeof error === 'object' && error !== null && typeof (error as { name?: unknown }).name === 'string' ? (error as { name: string }).name : typeof error
}

/** The message of a thrown value (its `message` when it has one, its text otherwise). */
export function gabErrorMessage(error: unknown): string {
  return typeof error === 'object' && error !== null && typeof (error as { message?: unknown }).message === 'string' ? (error as { message: string }).message : String(error)
}

/** The realm's resolved default locale (design 4.6: recorded to separate an environment difference), or null when unavailable. */
export function gabResolvedLocale(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale
  } catch {
    return null
  }
}

/** The build commit a benchmark build provenance names (40 hex), or null. */
export function buildCommitOf(build: unknown): string | null {
  const commit = typeof build === 'object' && build !== null ? (build as { commit?: unknown }).commit : undefined
  return typeof commit === 'string' && /^[0-9a-f]{40}$/.test(commit) ? commit : null
}

/** The Entry set's `repositoryHeadSha` when no build commit exists (a dev or test build): a fixed label, never a guessed commit. */
export const GAB_UNBUILT_COMMIT = 'no-benchmark-build-commit'

/** A short, stable key of a progress event (UI and cancel triggers): `input:<stage>:<status>`, `materialization:<kind>`, `verification:<stage>:<status>`, `evidence:<stage>:<status>`. */
export function gabProgressKey(event: GabProgressEvent): string {
  switch (event.kind) {
    case 'input': return `input:${event.stage}:${event.status}`
    case 'materialization': return `materialization:${event.event.kind}`
    case 'verification': return `verification:${event.event.stage}:${event.event.status}`
    case 'evidence': return `evidence:${event.stage}:${event.status}`
  }
}
