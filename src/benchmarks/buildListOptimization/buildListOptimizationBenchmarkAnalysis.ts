import { stableStringify } from '../../domain/models/publicTypes'
import type { BuildListOptimizationStage } from '../../domain/planner/buildListOptimization'
import {
  BLO_PLAN_KIND,
  bindBloRecordsToPlan,
  bloMeasurementPlanIssues,
  extractBloMeasurementPlan,
  type BloCriterion,
  type BloMeasurementPlan,
  type BloPlanSlot,
  type BloRecordedRun,
} from './buildListOptimizationBenchmarkPlan'
import { readBloRecordExport, type BloRunRecord, type BloStorageSnapshot } from './buildListOptimizationBenchmarkProtocol'

/**
 * Issue #260 PR-5A: the post-hoc analysis of a Production Build List optimization Browser measurement (benchmark only; run by
 * `scripts/analyze-build-list-optimization-browser.mjs`, never by the page or the Worker).
 *
 * It reads the plan taken from the measured commit, the page's raw record exports, the driver record and the Node reference records,
 * and derives one public RESULT. Four axes are kept apart and none reads another: semantic parity, the computation and its bounds,
 * performance and memory, and cancel / lifecycle. A plan whose criteria are only proposed (Owner approval pending) yields
 * observations and the verdict `not_yet_registered` on every axis; a mechanics plan yields the mechanics checks only.
 *
 * It refuses (derives nothing) when a source was recorded with other code: every Browser record must carry the benchmark build of the
 * measurement HEAD with no uncommitted benchmark code, and the driver and Node references must name the same HEAD. It never fills in
 * a missing value: an unrecorded slot, an unmeasured reading or a run that did not complete is reported as such and never counts as a
 * pass. The RESULT holds no Export body, no Target / Entry / OwnedWeapon ID, no Seed or Counter value and no file path.
 */

export const BLO_PUBLIC_RESULT_KIND = 'build-list-optimization-browser-result' as const
export const BLO_DRIVER_RECORD_KIND = 'build-list-optimization-browser-driver-record' as const
export const BLO_NODE_REFERENCE_KIND = 'build-list-optimization-node-reference' as const

export interface BloSourceFile {
  /** A base name (a raw file) or `<head>:<path>` (a file of the measured commit). */
  file: string
  bytes: number
  sha256: string
  text: string
}

export interface BloAnalysisSources {
  measurementHead: string
  plan: BloSourceFile
  browserRaw: BloSourceFile[]
  driver: BloSourceFile | null
  nodeReferences: BloSourceFile[]
}

/** One sample of the driver's CDP Worker heap sampling (wall-clock epoch milliseconds of the driver's machine). */
export interface BloDriverHeapSample { atEpochMs: number; target: string; usedSize: number; totalSize: number }
export interface BloDriverOsSample { atEpochMs: number; privateBytes: number; workingSetBytes: number; processCount: number }

export interface BloDriverSlot {
  slotId: string
  sessionId: string
  startedAt: string
  endedAt: string | null
  outcome: 'record_saved' | 'page_lost' | 'driver_deadline' | 'driver_error'
  rawFile: string | null
  cpuLoadPercentBefore: number | null
  external: { kind: 'page_lost' | 'out_of_memory'; evidence: string } | null
  cdpWorkerHeap: { intervalMs: number; samples: BloDriverHeapSample[]; errors: number; workerTargets: { target: string; attachedAtEpochMs: number; detachedAtEpochMs: number | null }[] } | null
  osRendererMemory: { intervalMs: number; samples: BloDriverOsSample[] } | null
}

export interface BloDriverRecord {
  kind: typeof BLO_DRIVER_RECORD_KIND
  revision: 1
  measurementHead: string
  plan: { path: string; sha256: string }
  driverSha256: string
  launcher: { browser: string; version: string; headless: boolean; flags: string[] }
  machine: { cpuModel: string | null; logicalCpuCount: number; totalMemoryBytes: number; os: string }
  sessions: { sessionId: string; origin: 'non_isolated' | 'isolated'; storageBefore: BloStorageSnapshot | null; storageAfter: BloStorageSnapshot | null; pageLost: boolean }[]
  slots: BloDriverSlot[]
}

export interface BloNodeReferenceRecord {
  kind: typeof BLO_NODE_REFERENCE_KIND
  revision: 1
  measurementHead: string
  plan: { path: string; sha256: string }
  inputId: string
  boundsId: string
  inputIdentity: { kind: 'export' | 'synthetic'; fileName: string | null; caseId: string | null; bytes: number; sha256: string }
  bounds: unknown
  node: { version: string; platform: string }
  outcome: { status: 'completed' | 'failed' | 'not_run'; failure: string | null; refusal: string | null }
  resultStatus: string | null
  semantic: { sha256: string; components: Record<string, string> } | null
  elapsedMs: number | null
}

export type BloAxisVerdict = 'not_yet_registered' | 'passed' | 'failed' | 'not_comparable' | 'not_applicable'

const median = (values: number[]): number | null => {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}
const stats = (values: number[]) => (values.length === 0 ? null : { count: values.length, min: Math.min(...values), median: median(values)!, max: Math.max(...values) })
const round = (value: number | null) => (value === null ? null : Math.round(value * 10) / 10)
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const STAGE_ORDER: readonly BuildListOptimizationStage[] = ['input_check', 'reach_table', 'assignment_search', 'route_generation', 'plan_verification']

/** The intervals of one run (milliseconds; `null` where the run did not reach the point). Never mixes two intervals into one "total". */
export function bloRunIntervals(record: BloRunRecord) {
  const t = record.timeline
  const diff = (to: number | null, from: number | null) => (to === null || from === null ? null : to - from)
  const workerStageMs = record.result?.diagnostics?.workerStageMs ?? null
  const workerStageTotalMs = workerStageMs === null ? null : Object.values(workerStageMs).reduce((sum, value) => sum + (value ?? 0), 0)
  const mainObservedStageMs: Partial<Record<BuildListOptimizationStage, number>> = {}
  t.progress.forEach((receipt, index) => {
    const next = t.progress[index + 1]?.receivedAtMs ?? t.terminalReceivedAtMs
    if (next !== null && next !== undefined) mainObservedStageMs[receipt.stage] = (mainObservedStageMs[receipt.stage] ?? 0) + (next - receipt.receivedAtMs)
  })
  return {
    /** Input preparation on the main thread (parse, migration, validation, `createPlannerInput()`); outside every calculation interval. */
    inputPreparationMs: record.input.preparation.preparationMs,
    /** From starting to create the Worker to the run request having been posted (Worker creation, bounds message, request serialization). */
    workerCreateToRequestPostedMs: diff(t.runPostedAtMs, t.workerCreateStartedAtMs),
    /** `postMessage(blo_run)` alone: the main thread's serialization of the PlannerInput. */
    requestPostMs: diff(t.runPostedAtMs, t.runPostStartedAtMs),
    /** From the posted request to the first progress (Worker start-up and input deserialization included). */
    requestToFirstProgressMs: diff(t.progress[0]?.receivedAtMs ?? null, t.runPostedAtMs),
    /** From the posted request to the terminal message reaching the main thread. */
    requestToTerminalMs: diff(t.terminalReceivedAtMs, t.runPostedAtMs),
    terminalDataReadMs: t.terminalDataReadMs,
    /** The Client's handling of the terminal message (its structural result check and the settle). */
    clientHandlingMs: t.clientHandlingMs,
    /** The Domain's per-stage times inside the Worker, and their sum (the Worker's calculation time). */
    workerStageMs,
    workerStageTotalMs,
    /** Per stage as the main thread saw the progress (to the next progress or the terminal message). */
    mainObservedStageMs,
    /** From starting to create the Worker to the outcome (the Production run without the input preparation). */
    workerCreateToOutcomeMs: diff(t.outcomeAtMs, t.workerCreateStartedAtMs),
    /** From the run's start (before the input preparation) to the outcome. */
    endToEndMs: t.outcomeAtMs,
    /** From the cancel request to the outcome (the Client settles a cancel synchronously). */
    cancelSettleMs: diff(t.outcomeAtMs, t.cancelRequestedAtMs),
  }
}

export type BloRunIntervals = ReturnType<typeof bloRunIntervals>

/** The intervals rounded to 0.1 ms for publication (the raw records keep the full values). */
function roundIntervals(intervals: BloRunIntervals): BloRunIntervals {
  const stages = (value: Partial<Record<BuildListOptimizationStage, number>> | null) =>
    value === null ? null : Object.fromEntries(Object.entries(value).map(([stage, ms]) => [stage, round(ms ?? null)])) as Partial<Record<BuildListOptimizationStage, number>>
  return {
    inputPreparationMs: round(intervals.inputPreparationMs)!, workerCreateToRequestPostedMs: round(intervals.workerCreateToRequestPostedMs), requestPostMs: round(intervals.requestPostMs),
    requestToFirstProgressMs: round(intervals.requestToFirstProgressMs), requestToTerminalMs: round(intervals.requestToTerminalMs), terminalDataReadMs: round(intervals.terminalDataReadMs),
    clientHandlingMs: round(intervals.clientHandlingMs), workerStageMs: stages(intervals.workerStageMs), workerStageTotalMs: round(intervals.workerStageTotalMs),
    mainObservedStageMs: stages(intervals.mainObservedStageMs)!, workerCreateToOutcomeMs: round(intervals.workerCreateToOutcomeMs), endToEndMs: round(intervals.endToEndMs),
    cancelSettleMs: round(intervals.cancelSettleMs),
  }
}

function storageChanged(before: BloStorageSnapshot | null, after: BloStorageSnapshot | null): boolean | null {
  if (before === null || after === null) return null
  const keys = Object.keys(before) as (keyof BloStorageSnapshot)[]
  if (keys.some(key => before[key] === null || after[key] === null)) return null
  return keys.some(key => before[key] !== after[key])
}

function epochOf(iso: string): number {
  return Date.parse(iso)
}

/** The slot's driver memory, reduced to max sampled values (never called a continuous peak). */
function driverMemoryView(slot: BloDriverSlot | undefined, record: BloRunRecord | undefined) {
  if (slot === undefined) return { workerHeapUsedMaxSampled: null, workerHeapTotalMaxSampled: null, heapSamples: 0, heapErrors: null, rendererPrivateMaxSampled: null, rendererWorkingSetMaxSampled: null, osSamples: 0, workerGoneAfterCancelMs: null }
  const heap = slot.cdpWorkerHeap
  const os = slot.osRendererMemory
  let workerGoneAfterCancelMs: number | null = null
  if (heap !== null && record !== undefined && record.timeline.cancelRequestedAtMs !== null) {
    const cancelEpoch = epochOf(record.startedAt) + record.timeline.cancelRequestedAtMs
    const detached = heap.workerTargets.map(target => target.detachedAtEpochMs).filter((value): value is number => value !== null && value >= cancelEpoch - 1_000)
    if (detached.length > 0) workerGoneAfterCancelMs = Math.max(0, Math.min(...detached) - cancelEpoch)
  }
  return {
    workerHeapUsedMaxSampled: heap === null || heap.samples.length === 0 ? null : Math.max(...heap.samples.map(sample => sample.usedSize)),
    workerHeapTotalMaxSampled: heap === null || heap.samples.length === 0 ? null : Math.max(...heap.samples.map(sample => sample.totalSize)),
    heapSamples: heap?.samples.length ?? 0,
    heapErrors: heap?.errors ?? null,
    rendererPrivateMaxSampled: os === null || os.samples.length === 0 ? null : Math.max(...os.samples.map(sample => sample.privateBytes)),
    rendererWorkingSetMaxSampled: os === null || os.samples.length === 0 ? null : Math.max(...os.samples.map(sample => sample.workingSetBytes)),
    osSamples: os?.samples.length ?? 0,
    workerGoneAfterCancelMs,
  }
}

function pageMemoryView(record: BloRunRecord) {
  const reading = (label: string) => record.memory.find(entry => entry.label === label) ?? null
  const used = (label: string) => reading(label)?.mainHeap?.usedJSHeapSize ?? null
  const beforeRun = used('before_run'), afterOutcome = used('after_outcome'), afterRelease = used('after_release')
  const workerAfterRelease = reading('after_release')?.userAgentSpecific?.workerBytes ?? null
  return {
    mainHeapUsedBeforeRun: beforeRun,
    mainHeapUsedAfterOutcome: afterOutcome,
    mainHeapUsedAfterRelease: afterRelease,
    /** The result held on the main thread after the outcome (`after_outcome − before_run`), from `performance.memory`. */
    mainHeapRetainedBytes: beforeRun === null || afterOutcome === null ? null : afterOutcome - beforeRun,
    userAgentSpecificBytes: Object.fromEntries(record.memory.filter(entry => entry.userAgentSpecific !== null).map(entry => [entry.label, entry.userAgentSpecific!])),
    /** Worker bytes the user-agent-specific reading still attributed after the release (0 = released; null = not measured). */
    workerBytesAfterRelease: workerAfterRelease,
    readingErrors: record.memory.filter(entry => entry.error !== null).map(entry => entry.label),
  }
}

function slotView(slot: BloPlanSlot, run: BloRecordedRun | undefined, driverSlot: BloDriverSlot | undefined) {
  const record = run?.record
  const base = { slotId: slot.slotId, order: slot.order, purpose: slot.purpose, inputId: slot.inputId, boundsId: slot.boundsId, origin: slot.origin }
  const external = driverSlot?.external ?? null
  if (record === undefined) {
    return { ...base, recorded: false as const, driverOutcome: driverSlot?.outcome ?? null, external, run: null }
  }
  const intervals = bloRunIntervals(record)
  const result = record.result
  return {
    ...base,
    recorded: true as const,
    driverOutcome: driverSlot?.outcome ?? null,
    external,
    run: {
      source: run!.source,
      startedAt: record.startedAt,
      outcome: record.outcome,
      inputPreparation: { status: record.input.preparation.status, refusal: record.input.preparation.refusal?.code ?? null, counts: record.input.preparation.counts },
      result: result === null ? null : {
        status: result.status, planningTargetCount: result.planningTargetCount, completedTargetCount: result.completedTargetCount,
        physicalOperationCount: result.physicalOperationCount, planStepCount: result.planStepCount, nonPhysicalStepCount: result.nonPhysicalStepCount,
        structuralObjective: result.structuralObjective, maxPlanSteps: result.maxPlanSteps, conflictCount: result.conflictCount, rejectedEntryCount: result.rejectedEntryCount,
        warningCount: result.warningCount, generatedEntryCount: result.generatedEntryCount, unchangedTargetCount: result.unchangedTargetCount, inputExclusionCount: result.inputExclusionCount,
        outOfScopeTargetCounts: result.outOfScopeTargetCounts, boundKinds: result.boundKinds, notFoundReason: result.notFoundReason, unsupportedReasonKinds: result.unsupportedReasonKinds,
        structuralSearch: result.diagnostics?.structuralSearch ?? null,
        reachTable: result.diagnostics?.reachTable === null || result.diagnostics === null ? null
          : { predictions: result.diagnostics.reachTable.predictions, supportQueries: result.diagnostics.reachTable.supportQueries },
        plannerVerifications: result.diagnostics?.plannerVerifications ?? null,
        routeGenerationMethods: result.diagnostics?.candidates.map(candidate => candidate.routeGeneration.methods) ?? [],
        candidateVerifications: result.diagnostics?.candidates.map(candidate => candidate.verification === null ? null : {
          outcome: candidate.verification.outcome, fullPlannerRuns: candidate.verification.fullPlannerRuns, rejectionCodes: candidate.verification.rejectionCodes,
        }) ?? [],
        semanticSha256: result.semantic.sha256,
      },
      intervals: roundIntervals(intervals),
      progressStages: record.timeline.progress.map(receipt => receipt.stage),
      cancel: record.timeline.cancelRequestedAtMs === null ? null : { requestedAtMs: round(record.timeline.cancelRequestedAtMs), lastStage: record.outcome.lastStage },
      lateMessages: record.lateMessages.count,
      mainThread: record.mainThread,
      memory: { page: pageMemoryView(record), driver: driverMemoryView(driverSlot, record) },
      interruptions: record.interruptions.map(entry => entry.type),
      storageChanged: storageChanged(record.storage.before, record.storage.after),
      integrityIssues: record.integrityIssues,
      environment: { userAgent: record.environment.userAgent, crossOriginIsolated: record.environment.crossOriginIsolated, hardwareConcurrency: record.environment.hardwareConcurrency },
    },
  }
}

export type BloSlotView = ReturnType<typeof slotView>

/** Every Browser record of the raw files, with its source; the issues of a malformed file. */
function readBrowserRecords(files: readonly BloSourceFile[]): { runs: BloRecordedRun[]; issues: string[] } {
  const runs: BloRecordedRun[] = []
  const issues: string[] = []
  for (const file of files) {
    let parsed: unknown
    try {
      parsed = JSON.parse(file.text)
    } catch {
      issues.push(`${file.file}: not JSON.`)
      continue
    }
    const read = readBloRecordExport(parsed)
    if (read.issues.length > 0) issues.push(...read.issues.map(issue => `${file.file}: ${issue}`))
    for (const record of read.records) runs.push({ record, source: file.file })
  }
  return { runs, issues }
}

function readDriver(file: BloSourceFile | null, head: string, plan: BloSourceFile): { record: BloDriverRecord | null; issues: string[] } {
  if (file === null) return { record: null, issues: [] }
  let value: unknown
  try {
    value = JSON.parse(file.text)
  } catch {
    return { record: null, issues: [`${file.file}: the driver record is not JSON.`] }
  }
  if (!isRecord(value) || value.kind !== BLO_DRIVER_RECORD_KIND || value.revision !== 1 || !Array.isArray(value.slots) || !Array.isArray(value.sessions)) {
    return { record: null, issues: [`${file.file}: not a Build List optimization driver record.`] }
  }
  const issues: string[] = []
  if (value.measurementHead !== head) issues.push(`${file.file}: the driver ran at ${String(value.measurementHead)}, not at the measurement HEAD.`)
  if (!isRecord(value.plan) || value.plan.sha256 !== plan.sha256) issues.push(`${file.file}: the driver followed another plan.`)
  return { record: issues.length === 0 ? (value as unknown as BloDriverRecord) : null, issues }
}

function readNodeReferences(files: readonly BloSourceFile[], head: string, plan: BloSourceFile, parsedPlan: BloMeasurementPlan): { records: BloNodeReferenceRecord[]; issues: string[] } {
  const records: BloNodeReferenceRecord[] = []
  const issues: string[] = []
  for (const file of files) {
    let value: unknown
    try {
      value = JSON.parse(file.text)
    } catch {
      issues.push(`${file.file}: the Node reference is not JSON.`)
      continue
    }
    if (!isRecord(value) || value.kind !== BLO_NODE_REFERENCE_KIND || value.revision !== 1) { issues.push(`${file.file}: not a Node reference record.`); continue }
    if (value.measurementHead !== head) { issues.push(`${file.file}: the Node reference ran at ${String(value.measurementHead)}, not at the measurement HEAD.`); continue }
    if (!isRecord(value.plan) || value.plan.sha256 !== plan.sha256) { issues.push(`${file.file}: the Node reference followed another plan.`); continue }
    const set = parsedPlan.boundsSets.find(entry => entry.boundsId === value.boundsId)
    if (set === undefined || stableStringify(set.bounds) !== stableStringify(value.bounds)) { issues.push(`${file.file}: the Node reference bounds are not the plan's ${String(value.boundsId)}.`); continue }
    const input = parsedPlan.inputs.find(entry => entry.inputId === value.inputId)
    const identity = value.inputIdentity
    if (input === undefined || !isRecord(identity) || (input.kind === 'export' ? identity.sha256 !== input.sha256 : identity.caseId !== input.caseId)) {
      issues.push(`${file.file}: the Node reference input is not the plan's ${String(value.inputId)}.`)
      continue
    }
    records.push(value as unknown as BloNodeReferenceRecord)
  }
  return { records, issues }
}

/** The provenance every Browser record must carry: the benchmark build of the measurement HEAD with no uncommitted benchmark code. */
function buildIssues(runs: readonly BloRecordedRun[], head: string): string[] {
  const issues: string[] = []
  for (const { record, source } of runs) {
    const build = record.build
    if (!isRecord(build) || build.commit !== head || build.uncommittedBenchmarkCode !== false) {
      issues.push(`${source} ${record.recordId}: recorded with ${isRecord(build) ? `build ${String(build.commit)} (uncommitted ${String(build.uncommittedBenchmarkCode)})` : 'no benchmark build'}, not the measurement HEAD.`)
    }
  }
  return issues
}

interface CriterionResult {
  criterionId: string
  axis: BloCriterion['axis']
  metric: string
  status: 'passed' | 'failed' | 'unmeasured' | 'not_yet_registered'
  observed: unknown
}

function compare(value: number | string | boolean, comparator: BloCriterion['comparator'], threshold: BloCriterion['threshold']): boolean {
  switch (comparator) {
    case 'equals': return value === threshold
    case 'at_most': return typeof value === 'number' && typeof threshold === 'number' && value <= threshold
    case 'at_least': return typeof value === 'number' && typeof threshold === 'number' && value >= threshold
    default: return false
  }
}

export interface BloSemanticGroupView {
  groupId: string
  inputId: string
  boundsId: string
  requiredBrowserRuns: number
  completedRuns: number
  missingOrIncompleteSlots: string[]
  distinctFingerprints: number
  fingerprint: string | null
  nodeReference: 'match' | 'mismatch' | 'missing' | 'not_required'
  status: 'identical' | 'mismatch' | 'incomplete'
}

function semanticGroups(plan: BloMeasurementPlan, slots: Map<string, BloSlotView>, nodes: readonly BloNodeReferenceRecord[]): BloSemanticGroupView[] {
  return plan.semanticComparison.groups.map(group => {
    const fingerprints: string[] = []
    const missing: string[] = []
    for (const slotId of group.slotIds) {
      const view = slots.get(slotId)
      const sha = view?.run?.result?.semanticSha256 ?? null
      if (view?.run === null || view?.run === undefined || view.run.outcome.status !== 'completed' || sha === null || view.run.integrityIssues.length > 0) missing.push(slotId)
      else fingerprints.push(sha)
    }
    const distinct = [...new Set(fingerprints)]
    const reference = nodes.find(record => record.inputId === group.inputId && record.boundsId === group.boundsId && record.outcome.status === 'completed' && record.semantic !== null)
    const nodeReference: BloSemanticGroupView['nodeReference'] = !group.nodeReferenceRequired ? 'not_required'
      : reference === undefined ? 'missing'
        : distinct.length > 0 && distinct.every(sha => sha === reference.semantic!.sha256) ? 'match' : distinct.length === 0 ? 'missing' : 'mismatch'
    const mismatch = distinct.length > 1 || nodeReference === 'mismatch'
    return {
      groupId: group.groupId, inputId: group.inputId, boundsId: group.boundsId, requiredBrowserRuns: group.requiredBrowserRuns, completedRuns: fingerprints.length,
      missingOrIncompleteSlots: missing, distinctFingerprints: distinct.length, fingerprint: distinct.length === 1 ? distinct[0]! : null, nodeReference,
      status: mismatch ? 'mismatch' : missing.length > 0 || nodeReference === 'missing' ? 'incomplete' : 'identical',
    }
  })
}

/** The cancel trials: each cancel slot judged on its own (the re-run slot's completion is read from its own view). */
function cancelTrials(plan: BloMeasurementPlan, slots: Map<string, BloSlotView>, groups: BloSemanticGroupView[]) {
  return plan.environments.flatMap(environment => environment.slots).filter(slot => slot.purpose === 'cancel').map(slot => {
    const view = slots.get(slot.slotId)
    const run = view?.run ?? null
    const rerun = slot.rerunSlotId === null ? null : slots.get(slot.rerunSlotId)?.run ?? null
    const group = groups.find(entry => entry.inputId === slot.inputId && entry.boundsId === slot.boundsId)
    const rerunCompleted = rerun === null ? null : rerun.outcome.status === 'completed'
    const rerunIdentical = rerun?.result === null || rerun === null || group?.fingerprint === null || group === undefined ? null : rerun.result.semanticSha256 === group.fingerprint
    let status: 'cancel_passed' | 'cancel_failed' | 'cancel_not_exercised' | 'not_recorded'
    if (run === null) status = 'not_recorded'
    // Only the trial's own cancel passes: a run ended by pagehide or a dispose is an interruption, never a passed trial.
    else if (run.outcome.status === 'cancelled') status = run.outcome.cancelReason === 'cancelled' && run.cancel !== null && run.result === null && run.integrityIssues.length === 0 ? 'cancel_passed' : 'cancel_failed'
    else if (run.outcome.status === 'completed' && run.cancel === null) status = 'cancel_not_exercised'
    else status = 'cancel_failed'
    return {
      slotId: slot.slotId, trigger: slot.cancelTrigger, status, stageAtCancel: run?.cancel?.lastStage ?? null,
      cancelSettleMs: run?.intervals.cancelSettleMs ?? null, workerGoneAfterCancelMs: run?.memory.driver.workerGoneAfterCancelMs ?? null,
      resultAdopted: run === null ? null : run.result !== null, lateMessages: run?.lateMessages ?? null,
      rerunSlotId: slot.rerunSlotId, rerunCompleted, rerunIdenticalToGroup: rerunIdentical,
    }
  })
}

/** The aggregate timings of the timing population: completed timing / rerun / bounds runs without interruption or integrity issue. */
function timingPopulations(slots: Map<string, BloSlotView>) {
  const keys = new Map<string, BloSlotView[]>()
  for (const view of slots.values()) {
    if (!['timing', 'rerun', 'bounds'].includes(view.purpose) || view.run === null || view.run.outcome.status !== 'completed') continue
    if (view.run.interruptions.length > 0 || view.run.integrityIssues.length > 0) continue
    const key = `${view.inputId}|${view.boundsId}`
    keys.set(key, [...(keys.get(key) ?? []), view])
  }
  return [...keys.entries()].map(([key, views]) => {
    const [inputId, boundsId] = key.split('|') as [string, string]
    const metric = (name: keyof BloRunIntervals) => stats(views.map(view => view.run!.intervals[name]).filter((value): value is number => typeof value === 'number'))
    const stages = Object.fromEntries(STAGE_ORDER.map(stage => [stage, stats(views.map(view => (view.run!.intervals.workerStageMs as Record<string, number> | null)?.[stage]).filter((value): value is number => typeof value === 'number'))]))
    return {
      inputId, boundsId, slots: views.map(view => view.slotId),
      inputPreparationMs: metric('inputPreparationMs'), workerCreateToRequestPostedMs: metric('workerCreateToRequestPostedMs'), requestPostMs: metric('requestPostMs'),
      requestToFirstProgressMs: metric('requestToFirstProgressMs'), requestToTerminalMs: metric('requestToTerminalMs'), terminalDataReadMs: metric('terminalDataReadMs'),
      clientHandlingMs: metric('clientHandlingMs'), workerStageTotalMs: metric('workerStageTotalMs'), workerStageMs: stages,
      workerCreateToOutcomeMs: metric('workerCreateToOutcomeMs'), endToEndMs: metric('endToEndMs'),
      mainLongTaskMaxMs: stats(views.map(view => view.run!.mainThread.longTaskMaxMs).filter((value): value is number => typeof value === 'number')),
    }
  })
}

/** The values of one criterion's metric over its scope (an unmeasured value is `null`). */
function metricValues(criterion: BloCriterion, slots: Map<string, BloSlotView>, groups: BloSemanticGroupView[], trials: ReturnType<typeof cancelTrials>): (number | string | boolean | null)[] {
  const scoped = [...slots.values()].filter(view => (criterion.scope.inputId === null || view.inputId === criterion.scope.inputId)
    && (criterion.scope.boundsId === null || view.boundsId === criterion.scope.boundsId) && criterion.scope.purposes.includes(view.purpose))
  const runOf = (view: BloSlotView) => view.run
  switch (criterion.metric) {
    case 'semantic_group_identical':
      return groups.filter(group => (criterion.scope.inputId === null || group.inputId === criterion.scope.inputId) && (criterion.scope.boundsId === null || group.boundsId === criterion.scope.boundsId))
        .map(group => (group.status === 'incomplete' ? null : group.status === 'identical'))
    case 'result_status':
      return scoped.map(view => runOf(view)?.result?.status ?? null)
    case 'all_planning_targets_completed':
      return scoped.map(view => { const result = runOf(view)?.result; return result === null || result === undefined || result.planningTargetCount === null ? null : result.completedTargetCount === result.planningTargetCount })
    case 'request_to_terminal_ms':
    case 'worker_stage_total_ms':
    case 'end_to_end_ms': {
      const key = criterion.metric === 'request_to_terminal_ms' ? 'requestToTerminalMs' : criterion.metric === 'worker_stage_total_ms' ? 'workerStageTotalMs' : 'endToEndMs'
      return scoped.map(view => { const run = runOf(view); if (run === null || run.outcome.status !== 'completed' || run.interruptions.length > 0) return null; const value = run.intervals[key]; return typeof value === 'number' ? value : null })
    }
    case 'main_long_task_max_ms':
      return scoped.map(view => runOf(view)?.mainThread.longTaskMaxMs ?? null)
    case 'worker_heap_used_max_bytes':
      return scoped.map(view => runOf(view)?.memory.driver.workerHeapUsedMaxSampled ?? null)
    case 'renderer_private_max_bytes':
      return scoped.map(view => runOf(view)?.memory.driver.rendererPrivateMaxSampled ?? null)
    case 'main_heap_retained_bytes':
      return scoped.map(view => runOf(view)?.memory.page.mainHeapRetainedBytes ?? null)
    case 'worker_memory_released':
      return scoped.map(view => { const bytes = runOf(view)?.memory.page.workerBytesAfterRelease; return bytes === null || bytes === undefined ? null : bytes === 0 })
    case 'cancel_settle_ms':
      return trials.filter(trial => scoped.some(view => view.slotId === trial.slotId)).map(trial => trial.status === 'cancel_passed' ? trial.cancelSettleMs : null)
    case 'cancel_worker_gone_ms':
      return trials.filter(trial => scoped.some(view => view.slotId === trial.slotId)).map(trial => trial.status === 'cancel_passed' ? trial.workerGoneAfterCancelMs : null)
    case 'cancel_no_result_adopted':
      return trials.filter(trial => scoped.some(view => view.slotId === trial.slotId)).map(trial => trial.status === 'not_recorded' || trial.status === 'cancel_not_exercised' ? null : trial.resultAdopted === false)
    case 'cancel_rerun_completed':
      return trials.filter(trial => scoped.some(view => view.slotId === trial.slotId)).map(trial => trial.rerunCompleted)
    case 'storage_unchanged':
      return scoped.map(view => { const changed = runOf(view)?.storageChanged; return changed === null || changed === undefined ? null : !changed })
    case 'no_interruption':
      return scoped.map(view => { const run = runOf(view); return run === null ? null : run.interruptions.length === 0 })
  }
}

function evaluateCriterion(criterion: BloCriterion, values: (number | string | boolean | null)[], registered: boolean): CriterionResult {
  const base = { criterionId: criterion.criterionId, axis: criterion.axis, metric: criterion.metric }
  const measured = values.filter((value): value is number | string | boolean => value !== null)
  const observed = criterion.aggregate === 'median' ? median(measured.filter((value): value is number => typeof value === 'number'))
    : criterion.aggregate === 'max' ? (measured.length === 0 ? null : Math.max(...measured.filter((value): value is number => typeof value === 'number')))
      : values
  if (!registered) return { ...base, status: 'not_yet_registered', observed }
  if (criterion.comparator === null) return { ...base, status: 'passed', observed }
  if (values.length === 0 || measured.length !== values.length) return { ...base, status: 'unmeasured', observed }
  const passed = criterion.aggregate === 'median' || criterion.aggregate === 'max'
    ? observed !== null && typeof observed === 'number' && compare(observed, criterion.comparator, criterion.threshold)
    : measured.every(value => compare(value, criterion.comparator, criterion.threshold))
  return { ...base, status: passed ? 'passed' : 'failed', observed }
}

function axisVerdict(results: CriterionResult[], axis: BloCriterion['axis'], registered: boolean): BloAxisVerdict {
  const own = results.filter(result => result.axis === axis)
  if (!registered) return 'not_yet_registered'
  if (own.length === 0) return 'not_applicable'
  if (own.some(result => result.status === 'failed')) return 'failed'
  if (own.some(result => result.status === 'unmeasured')) return 'not_comparable'
  return 'passed'
}

function mechanicsChecks(plan: BloMeasurementPlan, slots: Map<string, BloSlotView>) {
  return plan.environments.flatMap(environment => environment.slots).map(slot => {
    const run = slots.get(slot.slotId)?.run ?? null
    const expect = slot.expect!
    const observed = run === null ? null : { outcome: run.outcome.status, resultStatus: run.result?.status ?? null, failureKind: run.outcome.failure?.kind ?? null }
    const met = observed !== null && run!.integrityIssues.length === 0 && observed.outcome === expect.outcome && observed.resultStatus === expect.resultStatus && observed.failureKind === expect.failureKind
    return { slotId: slot.slotId, purpose: slot.purpose, expected: expect, observed, met }
  })
}

export type BloPublicResultDerivation =
  | { ok: true; result: Record<string, unknown> }
  | { ok: false; issues: string[] }

/** Derives the public RESULT (see the module comment). A refusal derives nothing. */
export function deriveBloPublicResult(sources: BloAnalysisSources): BloPublicResultDerivation {
  const extracted = extractBloMeasurementPlan(sources.plan.text)
  if (extracted.issues.length > 0) return { ok: false, issues: extracted.issues }
  const planIssues = bloMeasurementPlanIssues(extracted.plan)
  if (planIssues.length > 0) return { ok: false, issues: planIssues.map(issue => `plan: ${issue}`) }
  const plan = extracted.plan as BloMeasurementPlan
  const browser = readBrowserRecords(sources.browserRaw)
  if (browser.issues.length > 0) return { ok: false, issues: browser.issues }
  const provenance = buildIssues(browser.runs, sources.measurementHead)
  if (provenance.length > 0) return { ok: false, issues: provenance }
  const duplicateIds = browser.runs.map(run => run.record.recordId).filter((id, index, all) => all.indexOf(id) !== index)
  if (duplicateIds.length > 0) return { ok: false, issues: [`The same record appears more than once: ${[...new Set(duplicateIds)].join(', ')}.`] }
  const driver = readDriver(sources.driver, sources.measurementHead, sources.plan)
  if (driver.issues.length > 0) return { ok: false, issues: driver.issues }
  const nodes = readNodeReferences(sources.nodeReferences, sources.measurementHead, sources.plan, plan)
  if (nodes.issues.length > 0) return { ok: false, issues: nodes.issues }

  const binding = bindBloRecordsToPlan(plan, browser.runs)
  const driverSlots = new Map((driver.record?.slots ?? []).map(slot => [slot.slotId, slot]))
  const views = new Map<string, BloSlotView>()
  for (const environment of plan.environments) for (const slot of environment.slots) views.set(slot.slotId, slotView(slot, binding.bound.get(slot.slotId), driverSlots.get(slot.slotId)))
  const groups = semanticGroups(plan, views, nodes.records)
  const trials = cancelTrials(plan, views, groups)
  const registered = plan.planKind === 'measurement' && plan.status === 'registered' && plan.approval.state === 'owner_approved' && plan.criteria.status === 'registered'
  // Criteria are judged per measured bounds set: a criterion scoped to one set applies to it alone, an unscoped one to every set, so
  // the Owner reads which candidate set meets every criterion (never one verdict mixing the sets).
  const criteria = plan.planKind !== 'measurement' ? [] : plan.boundsSets.filter(set => set.role !== 'synthetic').map(set => ({
    boundsId: set.boundsId,
    role: set.role,
    results: plan.criteria.items.filter(item => item.scope.boundsId === null || item.scope.boundsId === set.boundsId)
      .map(item => evaluateCriterion(item, metricValues({ ...item, scope: { ...item.scope, boundsId: set.boundsId } }, views, groups, trials), registered)),
  }))
  const mechanics = plan.planKind === 'mechanics' ? mechanicsChecks(plan, views) : null
  const missingSlots = [...views.values()].filter(view => !view.recorded && plan.environments.find(environment => environment.slots.some(slot => slot.slotId === view.slotId))?.status === 'planned').map(view => view.slotId)
  const unmeasured = [...new Set([...views.values()].flatMap(view => {
    if (view.run === null) return []
    const names: string[] = []
    if (!view.run.mainThread.longTaskObserved) names.push('main_long_tasks')
    if (view.purpose === 'memory' && view.run.memory.driver.heapSamples === 0) names.push('worker_heap_cdp')
    if (view.purpose === 'memory' && view.run.memory.driver.osSamples === 0) names.push('renderer_os_memory')
    if (view.purpose === 'memory' && view.run.memory.page.mainHeapRetainedBytes === null) names.push('main_heap_fixed_points')
    if (view.purpose === 'memory' && view.run.memory.page.workerBytesAfterRelease === null) names.push('user_agent_specific_memory')
    if (view.purpose === 'cancel' && view.run.cancel !== null && view.run.memory.driver.workerGoneAfterCancelMs === null) names.push('cancel_worker_gone_cdp')
    return names
  }))].sort()
  const verdicts = plan.planKind === 'mechanics'
    ? { mechanics: mechanics!.every(check => check.met) ? 'passed' : 'failed', perBoundsSet: {} }
    : {
        mechanics: 'not_applicable',
        perBoundsSet: Object.fromEntries(criteria.map(({ boundsId, results }) => [boundsId, {
          semantic: axisVerdict(results, 'semantic', registered),
          computation: axisVerdict(results, 'computation', registered),
          performance: axisVerdict(results, 'performance', registered),
          memory: axisVerdict(results, 'memory', registered),
          cancelLifecycle: axisVerdict(results, 'cancel_lifecycle', registered),
        }])),
      }
  const result = {
    kind: BLO_PUBLIC_RESULT_KIND,
    revision: 1,
    derivation: {
      measurementHead: sources.measurementHead,
      analyzer: 'scripts/analyze-build-list-optimization-browser.mjs',
      plan: { file: sources.plan.file, bytes: sources.plan.bytes, sha256: sources.plan.sha256 },
      sources: [
        ...sources.browserRaw.map(file => ({ role: 'browser_raw', file: file.file, bytes: file.bytes, sha256: file.sha256 })),
        ...(sources.driver === null ? [] : [{ role: 'driver', file: sources.driver.file, bytes: sources.driver.bytes, sha256: sources.driver.sha256 }]),
        ...sources.nodeReferences.map(file => ({ role: 'node_reference', file: file.file, bytes: file.bytes, sha256: file.sha256 })),
      ],
    },
    plan: { kind: BLO_PLAN_KIND, planKind: plan.planKind, series: plan.series, status: plan.status, approval: plan.approval.state, criteriaStatus: plan.criteria.status, judged: registered },
    machine: driver.record === null ? null : { ...driver.record.machine, browser: driver.record.launcher.version, headless: driver.record.launcher.headless },
    binding: {
      bound: binding.bound.size,
      missingSlots,
      unplanned: binding.unplanned.map(entry => ({ slotId: entry.slotId, purpose: entry.purpose, reason: entry.reason })),
      order: binding.order,
    },
    slots: [...views.values()],
    semanticGroups: groups,
    nodeReferences: nodes.records.map(record => ({ inputId: record.inputId, boundsId: record.boundsId, status: record.outcome.status, resultStatus: record.resultStatus, semanticSha256: record.semantic?.sha256 ?? null, elapsedMs: record.elapsedMs })),
    timings: timingPopulations(views),
    cancelTrials: trials,
    sessions: driver.record?.sessions.map(session => ({ sessionId: session.sessionId, origin: session.origin, storageChanged: storageChanged(session.storageBefore, session.storageAfter), pageLost: session.pageLost })) ?? [],
    criteria,
    mechanics,
    verdicts,
    unmeasured,
  }
  return { ok: true, result: JSON.parse(JSON.stringify(result)) as Record<string, unknown> }
}

/** The fields and values a public RESULT must never hold (identities and RNG values of the measured data, file paths). */
const FORBIDDEN_PUBLIC = /"(?:targetWeaponId|buildListEntryId|ownedWeaponId|baseSeed|skillCounter|gogmaCounter|normalCounter|counter|candidateId|planId)"\s*:|[A-Za-z]:\\\\|\/Users\/|\/home\/|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

/** Why a published RESULT is not the one these sources derive (`[]` = it is, in the canonical serialization). */
export function bloPublicResultIssues(published: unknown, sources: BloAnalysisSources): string[] {
  const derived = deriveBloPublicResult(sources)
  if (!derived.ok) return derived.issues
  const issues: string[] = []
  if (stableStringify(published) !== stableStringify(derived.result)) issues.push('The public RESULT is not the one the sources derive.')
  if (FORBIDDEN_PUBLIC.test(JSON.stringify(derived.result))) issues.push('The derived RESULT holds an identity, an RNG value or a file path.')
  return issues
}
