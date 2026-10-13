/**
 * Issue #154 Production準備 P-2 (Research only; never imported by the app, the page, the runner, the harness or the Worker).
 *
 * The committed measurement plan of the Browser measurement (`docs/PLANNER_GLOBAL_ASSIGNMENT_BROWSER_READINESS.md` 12.2 / 16.2) and the
 * binding of recorded logical runs to its slots. The plan is a JSON block inside the plan document, committed before any measurement:
 * the analysis reads it from the measured commit (`git show <measurement HEAD>:<plan>`), never from the working tree, so a plan edited
 * after the measurement is never used. It fixes, per environment, the run slots (ID, purpose, order, origin, the exact logical run
 * options), the cancel trials' triggers and re-run slots, and the number of required comparison runs.
 *
 * Binding is strict and never repairs a record: a record is bound to a slot only when it says it was planned, names a slot of a planned
 * environment, carries the slot's purpose and exact options, ran on the slot's origin and on the environment's Browser, and the slot is
 * still free (the earliest such record wins; a later one is a duplicate and stays unplanned). A failed or interrupted run keeps its slot:
 * nothing re-labels a purpose, moves a record to another slot or fills a slot with a later run.
 */
import { stableStringify, type CalculationContext } from '../../../domain/models/publicTypes'
import type { ExportIdentity } from '../assignmentProtocol'
import type { ShapeMaterializationResearchConditions } from '../materializationProtocol'
import { gabComparisonRole } from './globalAssignmentBrowserJudgement'
import { GAB_HEARTBEAT_INTERVAL_BOUNDS, GLOBAL_ASSIGNMENT_BROWSER_PROTOCOL_VERSION } from './globalAssignmentBrowserProtocol'
import { GAB_RUN_PURPOSES, gabLogicalRunOptionIssues, type GabLogicalRunOptions, type GabLogicalRunRecord, type GabRunPurpose } from './globalAssignmentBrowserRunner'

export const GAB_MEASUREMENT_PLAN_KIND = 'global-assignment-browser-p2-measurement-plan'
export const GAB_MEASUREMENT_PLAN_REVISION = 1
/** The plan document carries exactly one fenced JSON block between these markers. */
export const GAB_MEASUREMENT_PLAN_BEGIN = '<!-- gab-p2-measurement-plan:begin -->'
export const GAB_MEASUREMENT_PLAN_END = '<!-- gab-p2-measurement-plan:end -->'

/** Where a slot runs: the plain preview origin, or the cross-origin isolated one (memory APIs). */
export type GabSlotOrigin = 'non_isolated' | 'isolated'

/** Every logical run option of a slot, all keys explicit (`null` where an option is off): the record's `options` must equal it. */
export type GabSlotRunOptions = Required<Omit<GabLogicalRunOptions, 'slot'>>

export interface GabPlanSlot {
  slotId: string
  purpose: GabRunPurpose
  /** 1..n within the environment: the order the slots are run in. */
  order: number
  origin: GabSlotOrigin
  options: GabSlotRunOptions
  /** Cancel slots: the later slot whose completion shows a new logical run completes after the cancel (null: none planned). */
  rerunSlotId: string | null
  note: string
}

export interface GabPlanEnvironment {
  environmentId: string
  status: 'planned' | 'not_available'
  /** Why a not-available environment is not measured (never measured in its place: it stays unconfirmed). */
  unavailableReason: string | null
  description: string
  /** Substrings every bound record's user agent must contain (a record of another device or Browser is never bound here). */
  userAgentMustInclude: string[]
  /** The planned number of required comparison runs: exactly the number of `timing` / `rerun` slots. */
  requiredComparisonRuns: number
  slots: GabPlanSlot[]
}

export interface GabMeasurementPlan {
  kind: typeof GAB_MEASUREMENT_PLAN_KIND
  revision: typeof GAB_MEASUREMENT_PLAN_REVISION
  series: string
  protocolVersion: typeof GLOBAL_ASSIGNMENT_BROWSER_PROTOCOL_VERSION
  /** The commit the plan was registered on (the plan's own commit is the measurement HEAD and cannot name itself). */
  baseCommit: string
  export: ExportIdentity
  calculationContext: CalculationContext
  conditions: {
    /** Where the Worker reads them (`registeredD1cConditions`); never a request field. */
    source: string
    /** The D-1C registration fingerprint at registration (null where none applies). */
    registrationFingerprint: string | null
    materialization: ShapeMaterializationResearchConditions
    verification: { researchMaxPlanSteps: number; verificationBudget: number }
  }
  references: {
    /** The D-1C public RESULT the analysis compares with, read from the measured commit (its SHA-256 is fixed here). */
    d1cPublicResult: { path: string; sha256: string }
    /** The Node reference: the existing non-formal runner, run at the measurement HEAD. */
    nodeReference: { runner: string; runs: number }
  }
  environments: GabPlanEnvironment[]
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isPositiveInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0
const isNonNegativeInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0
const SHA256_HEX = /^[0-9a-f]{64}$/
const COMMIT = /^[0-9a-f]{40}$/
const SLOT_ID = /^[A-Za-z0-9._:-]{1,64}$/
const ENVIRONMENT_ID = /^[a-z0-9-]{1,48}$/
const SLOT_OPTION_KEYS = ['cancelTrigger', 'envelope', 'execution', 'exportTransport', 'lateResponseWaitMs', 'memory', 'ping'] as const
const ORIGINS: readonly GabSlotOrigin[] = ['non_isolated', 'isolated']

/** The plan JSON of a plan document (`[]` issues = exactly one block between the markers, holding valid JSON). Nothing is repaired. */
export function extractGabMeasurementPlan(markdown: string): { plan: unknown; issues: string[] } {
  const begins = markdown.split(GAB_MEASUREMENT_PLAN_BEGIN).length - 1
  const ends = markdown.split(GAB_MEASUREMENT_PLAN_END).length - 1
  if (begins !== 1 || ends !== 1) return { plan: null, issues: [`The plan document must hold exactly one plan block (begin markers ${begins}, end markers ${ends}).`] }
  const start = markdown.indexOf(GAB_MEASUREMENT_PLAN_BEGIN) + GAB_MEASUREMENT_PLAN_BEGIN.length
  const end = markdown.indexOf(GAB_MEASUREMENT_PLAN_END)
  if (end < start) return { plan: null, issues: ['The plan block ends before it begins.'] }
  const blocks = [...markdown.slice(start, end).matchAll(/```json\r?\n([\s\S]*?)\r?\n```/g)]
  if (blocks.length !== 1) return { plan: null, issues: [`The plan block must hold exactly one fenced json block (found ${blocks.length}).`] }
  try {
    return { plan: JSON.parse(blocks[0]![1]!), issues: [] }
  } catch (error) {
    return { plan: null, issues: [`The plan JSON does not parse: ${error instanceof Error ? error.message : String(error)}`] }
  }
}

function slotOptionIssues(slot: Record<string, unknown>, at: string): string[] {
  const options = slot.options
  if (!isRecord(options)) return [`${at}.options must be an object.`]
  const issues: string[] = []
  const keys = Object.keys(options).sort()
  if (JSON.stringify(keys) !== JSON.stringify([...SLOT_OPTION_KEYS])) issues.push(`${at}.options must have exactly ${SLOT_OPTION_KEYS.join(', ')} (null where off).`)
  const execution = options.execution
  if (!isRecord(execution) || (execution.yieldMode !== 'message-channel' && execution.yieldMode !== 'timer') || !Number.isSafeInteger(execution.heartbeatIntervalMs)
    || (execution.heartbeatIntervalMs as number) < GAB_HEARTBEAT_INTERVAL_BOUNDS.min || (execution.heartbeatIntervalMs as number) > GAB_HEARTBEAT_INTERVAL_BOUNDS.max || typeof execution.workerHeapSampling !== 'boolean'
    || Object.keys(execution).length !== 3) {
    issues.push(`${at}.options.execution must be { yieldMode, heartbeatIntervalMs, workerHeapSampling } with protocol values.`)
  }
  if (!isRecord(options.envelope) || Object.keys(options.envelope).sort().join(',') !== 'cancelGraceMs,firstWallMs,freshWallMs,readyTimeoutMs') issues.push(`${at}.options.envelope must be { firstWallMs, freshWallMs, cancelGraceMs, readyTimeoutMs }.`)
  if (options.exportTransport !== 'auto' && options.exportTransport !== 'blob' && options.exportTransport !== 'array_buffer') issues.push(`${at}.options.exportTransport must be auto, blob or array_buffer.`)
  if (!isNonNegativeInteger(options.lateResponseWaitMs)) issues.push(`${at}.options.lateResponseWaitMs must be a non-negative integer.`)
  if (issues.length > 0) return issues
  const runOptions = { slot: { slotId: String(slot.slotId), purpose: slot.purpose as GabRunPurpose, planned: true, note: null }, ...(options as unknown as GabSlotRunOptions) }
  return gabLogicalRunOptionIssues(runOptions).map(issue => `${at}.options: ${issue}`)
}

/**
 * Why a plan must not be used (`[]` = valid). Beyond the shape: slot IDs are unique across the plan, each planned environment's slots
 * are ordered 1..n, the planned number of required comparison runs is exactly its `timing` / `rerun` slots, a cancel slot (and only
 * a cancel slot) carries a cancel trigger and may name a later completing slot of its own environment and origin to re-run, a ping runs
 * only in a `responsiveness` slot and a memory reading only in a `memory` slot on the isolated origin, and a not-available environment
 * has a reason and no slot.
 */
export function gabMeasurementPlanIssues(value: unknown): string[] {
  if (!isRecord(value)) return ['The plan is not an object.']
  const issues: string[] = []
  if (value.kind !== GAB_MEASUREMENT_PLAN_KIND) issues.push(`kind must be ${GAB_MEASUREMENT_PLAN_KIND}.`)
  if (value.revision !== GAB_MEASUREMENT_PLAN_REVISION) issues.push(`revision must be ${GAB_MEASUREMENT_PLAN_REVISION}.`)
  if (typeof value.series !== 'string' || !/^[a-z0-9.-]{1,32}$/.test(value.series)) issues.push('series must be 1..32 characters of [a-z0-9.-].')
  if (value.protocolVersion !== GLOBAL_ASSIGNMENT_BROWSER_PROTOCOL_VERSION) issues.push(`protocolVersion must be ${GLOBAL_ASSIGNMENT_BROWSER_PROTOCOL_VERSION}.`)
  if (typeof value.baseCommit !== 'string' || !COMMIT.test(value.baseCommit)) issues.push('baseCommit must be a 40-hex commit.')
  const exportIdentity = value.export
  if (!isRecord(exportIdentity) || typeof exportIdentity.fileName !== 'string' || exportIdentity.fileName === '' || !isNonNegativeInteger(exportIdentity.bytes)
    || typeof exportIdentity.sha256 !== 'string' || !SHA256_HEX.test(exportIdentity.sha256) || Object.keys(exportIdentity).length !== 3) {
    issues.push('export must be { fileName, bytes, sha256 }.')
  }
  const context = value.calculationContext
  if (!isRecord(context) || typeof context.gameVersion !== 'string' || !Number.isFinite(context.masterDataVersion) || typeof context.rngEngineVersion !== 'string' || !Number.isFinite(context.appSchemaVersion)) {
    issues.push('calculationContext must be { gameVersion, masterDataVersion, rngEngineVersion, appSchemaVersion }.')
  }
  const conditions = value.conditions
  if (!isRecord(conditions) || typeof conditions.source !== 'string' || conditions.source === '' || !(conditions.registrationFingerprint === null || typeof conditions.registrationFingerprint === 'string')
    || !isRecord(conditions.materialization) || !isRecord(conditions.verification) || !isPositiveInteger(conditions.verification.researchMaxPlanSteps) || conditions.verification.verificationBudget !== 1) {
    issues.push('conditions must be { source, registrationFingerprint, materialization, verification: { researchMaxPlanSteps, verificationBudget: 1 } }.')
  }
  const references = value.references
  const d1c = isRecord(references) ? references.d1cPublicResult : undefined
  const node = isRecord(references) ? references.nodeReference : undefined
  if (!isRecord(d1c) || typeof d1c.path !== 'string' || !/^docs\/[A-Za-z0-9_.-]+\.json$/.test(d1c.path) || typeof d1c.sha256 !== 'string' || !SHA256_HEX.test(d1c.sha256)) {
    issues.push('references.d1cPublicResult must be { path: docs/<file>.json, sha256 }.')
  }
  if (!isRecord(node) || typeof node.runner !== 'string' || !/^scripts\/[A-Za-z0-9_.-]+\.mjs$/.test(node.runner) || !isPositiveInteger(node.runs)) issues.push('references.nodeReference must be { runner: scripts/<file>.mjs, runs }.')
  const environments = value.environments
  if (!Array.isArray(environments) || environments.length === 0) return [...issues, 'environments must be a non-empty array.']
  const environmentIds = new Set<string>()
  const slotIds = new Set<string>()
  environments.forEach((environment, index) => {
    const at = `environments[${index}]`
    if (!isRecord(environment)) { issues.push(`${at} must be an object.`); return }
    if (typeof environment.environmentId !== 'string' || !ENVIRONMENT_ID.test(environment.environmentId)) issues.push(`${at}.environmentId must be 1..48 characters of [a-z0-9-].`)
    else if (environmentIds.has(environment.environmentId)) issues.push(`${at}.environmentId ${environment.environmentId} is not unique.`)
    else environmentIds.add(environment.environmentId)
    if (typeof environment.description !== 'string' || environment.description === '') issues.push(`${at}.description must be a non-empty string.`)
    const include = environment.userAgentMustInclude
    if (!Array.isArray(include) || !include.every(item => typeof item === 'string' && item !== '')) issues.push(`${at}.userAgentMustInclude must be an array of non-empty strings.`)
    const slots = environment.slots
    if (!Array.isArray(slots)) { issues.push(`${at}.slots must be an array.`); return }
    if (environment.status === 'not_available') {
      if (typeof environment.unavailableReason !== 'string' || environment.unavailableReason === '') issues.push(`${at}: a not_available environment needs its unavailableReason.`)
      if (slots.length !== 0 || environment.requiredComparisonRuns !== 0) issues.push(`${at}: a not_available environment has no slot and requires no run.`)
      return
    }
    if (environment.status !== 'planned') { issues.push(`${at}.status must be planned or not_available.`); return }
    if (environment.unavailableReason !== null) issues.push(`${at}: a planned environment has unavailableReason null.`)
    if (!Array.isArray(include) || include.length === 0) issues.push(`${at}: a planned environment names the user agent it runs on.`)
    if (slots.length === 0) issues.push(`${at}: a planned environment needs slots.`)
    const orders: number[] = []
    let requiredSlots = 0
    const byId = new Map<string, Record<string, unknown>>()
    slots.forEach((slot, slotIndex) => {
      const slotAt = `${at}.slots[${slotIndex}]`
      if (!isRecord(slot)) { issues.push(`${slotAt} must be an object.`); return }
      if (typeof slot.slotId !== 'string' || !SLOT_ID.test(slot.slotId)) issues.push(`${slotAt}.slotId must be 1..64 characters of [A-Za-z0-9._:-].`)
      else if (slotIds.has(slot.slotId)) issues.push(`${slotAt}.slotId ${slot.slotId} is not unique in the plan.`)
      else { slotIds.add(slot.slotId); byId.set(slot.slotId, slot) }
      if (!GAB_RUN_PURPOSES.includes(slot.purpose as GabRunPurpose)) { issues.push(`${slotAt}.purpose must be one of ${GAB_RUN_PURPOSES.join(', ')}.`); return }
      const purpose = slot.purpose as GabRunPurpose
      if (gabComparisonRole(purpose) === 'required') requiredSlots += 1
      if (!isPositiveInteger(slot.order)) issues.push(`${slotAt}.order must be a positive integer.`)
      else orders.push(slot.order)
      if (!ORIGINS.includes(slot.origin as GabSlotOrigin)) issues.push(`${slotAt}.origin must be non_isolated or isolated.`)
      if (typeof slot.note !== 'string') issues.push(`${slotAt}.note must be a string.`)
      const optionIssues = slotOptionIssues(slot, slotAt)
      issues.push(...optionIssues)
      if (optionIssues.length > 0) return
      const options = slot.options as unknown as GabSlotRunOptions
      if ((purpose === 'cancel') !== (options.cancelTrigger !== null)) issues.push(`${slotAt}: a cancel trigger belongs to a cancel slot, and a cancel slot needs one.`)
      if ((purpose === 'responsiveness') !== (options.ping !== null)) issues.push(`${slotAt}: a chained ping belongs to a responsiveness slot, and a responsiveness slot needs one.`)
      if ((purpose === 'memory') !== (options.memory !== null)) issues.push(`${slotAt}: a memory reading belongs to a memory slot, and a memory slot needs one.`)
      if (purpose === 'memory' && slot.origin !== 'isolated') issues.push(`${slotAt}: a memory slot runs on the isolated origin.`)
      if (purpose !== 'cancel' && slot.rerunSlotId !== null) issues.push(`${slotAt}: only a cancel slot names a re-run slot.`)
      if (purpose === 'cancel' && !(slot.rerunSlotId === null || typeof slot.rerunSlotId === 'string')) issues.push(`${slotAt}.rerunSlotId must be a slot ID or null.`)
    })
    const sorted = [...orders].sort((left, right) => left - right)
    if (sorted.length !== slots.length || sorted.some((order, index) => order !== index + 1)) issues.push(`${at}: the slot orders must be exactly 1..${slots.length}.`)
    if (environment.requiredComparisonRuns !== requiredSlots) issues.push(`${at}.requiredComparisonRuns must be its number of timing / rerun slots (${requiredSlots}).`)
    for (const slot of byId.values()) {
      if (slot.purpose !== 'cancel' || typeof slot.rerunSlotId !== 'string') continue
      const rerun = byId.get(slot.rerunSlotId)
      if (rerun === undefined) { issues.push(`${at}: the re-run slot ${slot.rerunSlotId} of ${String(slot.slotId)} is not a slot of this environment.`); continue }
      if (rerun.purpose === 'cancel' || rerun.purpose === 'pilot' || !((rerun.order as number) > (slot.order as number)) || rerun.origin !== slot.origin) {
        issues.push(`${at}: the re-run slot ${slot.rerunSlotId} of ${String(slot.slotId)} must be a later completing slot (timing / rerun / responsiveness / memory) on the same origin.`)
      }
    }
  })
  return issues
}

/** A logical run record as read from a raw file, with the page's own user agent (for a record whose Worker never became ready). */
export interface GabRecordedRun {
  record: GabLogicalRunRecord
  /** The raw file the record came from (its base name). */
  source: string
  pageUserAgent: string | null
}

export type GabUnplannedReason =
  | 'not_planned' | 'unknown_slot' | 'environment_not_planned' | 'purpose_mismatch' | 'options_mismatch' | 'origin_mismatch' | 'environment_mismatch' | 'duplicate_slot'

export interface GabSlotBinding {
  /** Slot ID -> the record bound to it. */
  bound: Map<string, GabRecordedRun>
  unplanned: { slotId: string; purpose: string; reason: GabUnplannedReason; source: string; startedAt: string }[]
  /** Per planned environment: whether the bound slots ran in plan order (by record start), and the slots that did not. */
  order: Record<string, { followed: boolean; outOfOrderSlots: string[] }>
}

const userAgentOf = (run: GabRecordedRun): string | null => run.record.first.environment?.userAgent ?? run.record.fresh.environment?.userAgent ?? run.pageUserAgent

/** Binds recorded logical runs to the plan's slots (see the module comment). Records are taken in start order; nothing is repaired. */
export function bindGabRecordsToPlan(plan: GabMeasurementPlan, runs: readonly GabRecordedRun[]): GabSlotBinding {
  const slots = new Map<string, { environment: GabPlanEnvironment; slot: GabPlanSlot }>()
  for (const environment of plan.environments) for (const slot of environment.slots) slots.set(slot.slotId, { environment, slot })
  const ordered = [...runs].sort((left, right) => (left.record.startedAt < right.record.startedAt ? -1 : left.record.startedAt > right.record.startedAt ? 1 : left.record.sequence - right.record.sequence))
  const binding: GabSlotBinding = { bound: new Map(), unplanned: [], order: {} }
  for (const run of ordered) {
    const record = run.record
    const unplanned = (reason: GabUnplannedReason) => { binding.unplanned.push({ slotId: record.slot.slotId, purpose: record.slot.purpose, reason, source: run.source, startedAt: record.startedAt }) }
    if (record.slot.planned !== true) { unplanned('not_planned'); continue }
    const entry = slots.get(record.slot.slotId)
    if (entry === undefined) { unplanned('unknown_slot'); continue }
    if (entry.environment.status !== 'planned') { unplanned('environment_not_planned'); continue }
    if (record.slot.purpose !== entry.slot.purpose) { unplanned('purpose_mismatch'); continue }
    if (stableStringify(record.options) !== stableStringify(entry.slot.options)) { unplanned('options_mismatch'); continue }
    if (record.main.crossOriginIsolated !== (entry.slot.origin === 'isolated')) { unplanned('origin_mismatch'); continue }
    const userAgent = userAgentOf(run)
    if (userAgent !== null && !entry.environment.userAgentMustInclude.every(part => userAgent.includes(part))) { unplanned('environment_mismatch'); continue }
    if (binding.bound.has(entry.slot.slotId)) { unplanned('duplicate_slot'); continue }
    binding.bound.set(entry.slot.slotId, run)
  }
  for (const environment of plan.environments) {
    if (environment.status !== 'planned') continue
    const boundInRunOrder = ordered.filter(run => environment.slots.some(slot => binding.bound.get(slot.slotId) === run))
    const outOfOrderSlots: string[] = []
    let highest = 0
    for (const run of boundInRunOrder) {
      const order = environment.slots.find(slot => slot.slotId === run.record.slot.slotId)!.order
      if (order < highest) outOfOrderSlots.push(run.record.slot.slotId)
      highest = Math.max(highest, order)
    }
    binding.order[environment.environmentId] = { followed: outOfOrderSlots.length === 0, outOfOrderSlots }
  }
  return binding
}
