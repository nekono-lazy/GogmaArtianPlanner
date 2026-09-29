/**
 * Issue #154 Phase 2-C2.6-A: post-hoc analysis of one raw kernel-only run, Research only. Never import from Production.
 *
 * Nothing here runs a Planner or a Search. The runner (scripts/run-planner-global-phase2c26a.mjs) never imports this
 * module and never reads the Phase 2-C2 RESULT: only the analyzer passes the committed Phase 2-C2 RESULT here, after the
 * run, for the before / after comparison. Every expected count (orientations, participants) is derived from the run's
 * own baseline; nothing fixes an ID or a count. The raw run and the old RESULT are read as untrusted JSON.
 */
import { stableStringify } from '../domain/models/publicTypes'
import { PHASE2C26A_CHILD_STATUSES } from './plannerGlobalPhase2C26A'
import type { Phase2C2BaselineSummary, Phase2C2ChildOutcome, Phase2C2Conditions, Phase2C2Orientation } from './plannerGlobalPhase2C2'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

/** The current Domain Target outcome statuses (9.2.19.13), in report order. Anything else is counted as its own category. */
export const PHASE2C26A_KNOWN_TARGET_OUTCOMES = [
  'found', 'stopped_by_candidate_trial_bound', 'stopped_by_search_extent_bound', 'not_found_within_search_extent',
  'stopped_by_planner_rerun_bound', 'blocked_by_selected_checkpoint',
] as const

function countBy<T>(values: readonly T[], key: (value: T) => string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const value of values) out[key(value)] = (out[key(value)] ?? 0) + 1
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

// ---------------------------------------------------------------- the committed Phase 2-C2 RESULT (post-hoc only)

export interface Phase2C26AOldTarget {
  targetWeaponId: string
  outcome: string
  searched: boolean
  foundStableKeySha256: string | null
  trials: { candidateKeySha256: string; result: string; reason: string | null; generatedSelected: boolean | null }[]
}

export interface Phase2C26AOldOrientationRow {
  orientationId: string
  kind: string
  conflictKey: string
  fixedBuildListEntryId: string
  fixedTargetWeaponId: string
  /** The Phase 2-C2 child outcome (`completed` / `out_of_memory` / `timeout` / `process_failure`). */
  outcome: string
  wallMs: number
  /** Only a completed child wrote its memory in Phase 2-C2; `null` otherwise. */
  peakSampledHeapUsedBytes: number | null
  maxRssKiB: number | null
  kernelStatus: string
  plannerRerunsUsed: number | null
  targets: Phase2C26AOldTarget[]
}

export interface Phase2C26AOldC2View {
  exportSha256: string
  measuredHead: string
  childHeapLimitMb: number
  concurrency: number
  orientationBudgetMs: number
  conditions: Pick<Phase2C2Conditions, 'extent' | 'bounds'>
  /** Optional provenance fields: `null` when the old RESULT does not carry them (never filled in by guess). */
  researchMaxPlanSteps: number | null
  nodeYield: string | null
  calculationContext: unknown
  baseline: Phase2C2BaselineSummary
  orientations: Phase2C2Orientation[]
  rows: Map<string, Phase2C26AOldOrientationRow>
  trialRejectionReasons: Record<string, number>
  targetOutcomes: Record<string, number>
}

function need<T>(value: T | undefined | null, message: string): T {
  if (value === undefined || value === null) throw new Error(`Phase 2-C2 RESULT: ${message}`)
  return value
}

/** Reads the committed Phase 2-C2 RESULT, failing closed on any missing field this comparison needs. */
export function parsePhase2C26AOldC2Result(json: unknown): Phase2C26AOldC2View {
  if (!isObject(json)) throw new Error('Phase 2-C2 RESULT: not an object')
  const provenance = need(isObject(json.provenance) ? json.provenance : null, 'provenance missing')
  const environment = need(isObject(provenance.environment) ? provenance.environment : null, 'provenance.environment missing')
  const budgets = need(isObject(provenance.budgets) ? provenance.budgets : null, 'provenance.budgets missing')
  const conditions = need(isObject(json.conditions) ? json.conditions : null, 'conditions missing')
  const baselineSummary = need(isObject(json.baseline) && isObject(json.baseline.summary) ? json.baseline.summary : null, 'baseline.summary missing')
  const kernel = need(isObject(json.kernel) ? json.kernel : null, 'kernel missing')
  const orientations = asArray(json.orientations) as Phase2C2Orientation[]
  if (orientations.length === 0) throw new Error('Phase 2-C2 RESULT: orientations missing')
  const results = asArray(kernel.results)
  if (results.length !== orientations.length) throw new Error('Phase 2-C2 RESULT: kernel.results does not cover every orientation exactly once')
  const rows = new Map<string, Phase2C26AOldOrientationRow>()
  for (const raw of results) {
    if (!isObject(raw) || !isObject(raw.process) || !isObject(raw.kernel)) throw new Error('Phase 2-C2 RESULT: malformed kernel result')
    const id = String(raw.orientationId)
    if (rows.has(id)) throw new Error(`Phase 2-C2 RESULT: duplicate kernel result ${id}`)
    const memory = isObject(raw.memory) ? raw.memory : null
    rows.set(id, {
      orientationId: id, kind: String(raw.kind), conflictKey: String(raw.conflictKey), fixedBuildListEntryId: String(raw.fixedBuildListEntryId),
      fixedTargetWeaponId: String(raw.fixedTargetWeaponId), outcome: String(raw.process.outcome), wallMs: Number(raw.process.wallMs),
      peakSampledHeapUsedBytes: memory ? Number(memory.peakSampledHeapUsedBytes) : null, maxRssKiB: memory ? Number(memory.maxRssKiB) : null,
      kernelStatus: String(raw.kernel.status), plannerRerunsUsed: typeof raw.kernel.plannerRerunsUsed === 'number' ? raw.kernel.plannerRerunsUsed : null,
      targets: asArray(raw.targets).map(target => {
        const t = target as Json
        const found = isObject(t.found) ? t.found : null
        return {
          targetWeaponId: String(t.targetWeaponId), outcome: String(t.outcome), searched: t.reservation !== null && t.reservation !== undefined,
          foundStableKeySha256: found ? String(found.stableKeySha256) : null,
          trials: asArray(t.trials).map(trial => {
            const r = trial as Json
            return { candidateKeySha256: String(r.candidateKeySha256), result: String(r.result), reason: r.reason === null ? null : String(r.reason),
              generatedSelected: typeof r.generatedSelected === 'boolean' ? r.generatedSelected : null }
          }),
        }
      }),
    })
  }
  for (const orientation of orientations) if (!rows.has(orientation.orientationId)) throw new Error(`Phase 2-C2 RESULT: no kernel result for ${orientation.orientationId}`)
  const outcomes = isObject(kernel.outcomes) ? kernel.outcomes : {}
  return {
    exportSha256: String(need(provenance.exportSha256, 'provenance.exportSha256 missing')),
    measuredHead: String(need(provenance.measuredHead, 'provenance.measuredHead missing')),
    childHeapLimitMb: Number(need(environment.childHeapLimitMb, 'childHeapLimitMb missing')),
    concurrency: Number(need(environment.concurrency, 'concurrency missing')),
    orientationBudgetMs: Number(need(budgets.orientationBudgetMs, 'orientationBudgetMs missing')),
    conditions: { extent: need(conditions.extent, 'conditions.extent missing') as Phase2C2Conditions['extent'], bounds: need(conditions.bounds, 'conditions.bounds missing') as Phase2C2Conditions['bounds'] },
    researchMaxPlanSteps: typeof environment.researchMaxPlanSteps === 'number' ? environment.researchMaxPlanSteps : null,
    nodeYield: typeof environment.nodeYield === 'string' ? environment.nodeYield : null,
    calculationContext: isObject(environment.calculationContext) ? environment.calculationContext : null,
    baseline: baselineSummary as unknown as Phase2C2BaselineSummary,
    orientations,
    rows,
    trialRejectionReasons: (isObject(outcomes.trialRejectionReasons) ? outcomes.trialRejectionReasons : {}) as Record<string, number>,
    targetOutcomes: (isObject(outcomes.targetOutcomes) ? outcomes.targetOutcomes : {}) as Record<string, number>,
  }
}

// ---------------------------------------------------------------- baseline / orientation parity with Phase 2-C2

export interface Phase2C26AParityCheck { field: string; current: unknown; old: unknown; matches: boolean }

export function comparePhase2C26ABaselineWithOldC2(current: Phase2C2BaselineSummary, currentOrientationCount: number, old: Pick<Phase2C26AOldC2View, 'baseline' | 'orientations'>) {
  const pairs: [string, unknown, unknown][] = [
    ['planningTargetCount', current.planningTargetCount, old.baseline.planningTargetCount],
    ['completedTargetCount', current.completedTargetCount, old.baseline.completedTargetCount],
    ['termination', current.termination, old.baseline.termination],
    ['planSteps', current.planSteps, old.baseline.planSteps],
    ['conflicts', current.conflicts, old.baseline.conflicts],
    ['conflictsByKind', current.conflictsByKind, old.baseline.conflictsByKind],
    ['conflictSignatures', [...current.conflictSignatures].sort(), [...old.baseline.conflictSignatures].sort()],
    ['selectedTargets', [...current.selectedTargets].sort(), [...old.baseline.selectedTargets].sort()],
    ['orientationCount', currentOrientationCount, old.orientations.length],
  ]
  const checks: Phase2C26AParityCheck[] = pairs.map(([field, a, b]) => ({ field, current: a, old: b, matches: stableStringify(a) === stableStringify(b) }))
  return { checks, matches: checks.every(check => check.matches) }
}

/** The identity fields that must be equal for one orientation of the same Export (participant Targets as a set). */
export const PHASE2C26A_ORIENTATION_IDENTITY_FIELDS = ['conflictIndex', 'kind', 'fixedTargetWeaponId', 'participantTargetSet'] as const

function orientationIdentity(orientation: Phase2C2Orientation) {
  return { conflictIndex: orientation.conflictIndex, kind: orientation.kind, fixedTargetWeaponId: orientation.fixedTargetWeaponId,
    participantTargetSet: [...orientation.participantTargetWeaponIds].sort() }
}

export function comparePhase2C26AOrientationSets(current: readonly Phase2C2Orientation[], old: readonly Phase2C2Orientation[]) {
  const oldById = new Map(old.map(o => [o.orientationId, o]))
  const currentById = new Map(current.map(o => [o.orientationId, o]))
  const missingInCurrent = old.filter(o => !currentById.has(o.orientationId)).map(o => o.orientationId)
  const extraInCurrent = current.filter(o => !oldById.has(o.orientationId)).map(o => o.orientationId)
  const mismatches: { orientationId: string; field: string; current: unknown; old: unknown }[] = []
  /** Informational only: the Export is the same, so the Entry IDs and Conflict keys are expected to match too. */
  const auxiliaryMismatches: { orientationId: string; field: string; current: unknown; old: unknown }[] = []
  for (const orientation of current) {
    const before = oldById.get(orientation.orientationId)
    if (!before) continue
    const a = orientationIdentity(orientation), b = orientationIdentity(before)
    for (const field of PHASE2C26A_ORIENTATION_IDENTITY_FIELDS) {
      if (stableStringify(a[field]) !== stableStringify(b[field])) mismatches.push({ orientationId: orientation.orientationId, field, current: a[field], old: b[field] })
    }
    for (const field of ['conflictKey', 'fixedBuildListEntryId', 'participantBuildListEntryIds', 'participantTargetWeaponIds'] as const) {
      if (stableStringify(orientation[field]) !== stableStringify(before[field])) auxiliaryMismatches.push({ orientationId: orientation.orientationId, field, current: orientation[field], old: before[field] })
    }
  }
  return {
    currentCount: current.length, oldCount: old.length, missingInCurrent, extraInCurrent, mismatches, auxiliaryMismatches,
    matches: missingInCurrent.length === 0 && extraInCurrent.length === 0 && mismatches.length === 0,
  }
}

// ---------------------------------------------------------------- formal series completeness

export interface Phase2C26AFormalExpectations {
  childHeapLimitMb: number
  concurrency: number
  orientationBudgetMs: number
  /** `phase2c2ProductionDefaultConditions()` of the analysing HEAD (Production spread copies). */
  conditions: Phase2C2Conditions
}

export interface Phase2C26AFormalRunValidation {
  valid: boolean
  failures: string[]
  rawStatus: string | null
  smokeIsNull: boolean
  uncommittedBenchmarkCode: boolean | null
  baselineCompleted: boolean
  expectedOrientations: number
  actualKernelRecords: number
  missingOrientations: string[]
  duplicateOrientations: string[]
  foreignOrientations: string[]
  metadataMismatches: { orientationId: string; field: string }[]
  unknownStatuses: { orientationId: string; status: unknown }[]
  processCounts: { baseline: number; kernel: number; other: number }
}

/**
 * Whether `raw` is a complete formal C2.6-A series: status completed, no smoke, committed code, the formal heap /
 * concurrency / budget, a completed baseline, and exactly one kernel record per orientation the baseline itself derived,
 * with the task metadata (orientation, conditions, child id) of that orientation, a known child status, and a kernel
 * result exactly when the child completed. The expected orientation set comes from the raw baseline, never a constant.
 */
export function validatePhase2C26AFormalRun(raw: unknown, expected: Phase2C26AFormalExpectations): Phase2C26AFormalRunValidation {
  const failures: string[] = []
  const root = isObject(raw) ? raw : {}
  if (!isObject(raw)) failures.push('the raw run is not an object')
  const environment = isObject(root.environment) ? root.environment : null
  if (environment === null) failures.push('environment is missing')
  const rawStatus = typeof root.status === 'string' ? root.status : null
  if (rawStatus !== 'completed') failures.push(`raw status is ${String(rawStatus)}, not completed`)
  const smokeIsNull = environment !== null && environment.smoke === null
  if (!smokeIsNull) failures.push('environment.smoke is not null (a smoke / subset run is never formal)')
  const uncommittedBenchmarkCode = environment !== null && typeof environment.uncommittedBenchmarkCode === 'boolean' ? environment.uncommittedBenchmarkCode : null
  if (uncommittedBenchmarkCode !== false) failures.push('environment.uncommittedBenchmarkCode is not false')
  if (environment !== null) {
    if (environment.childHeapLimitMb !== expected.childHeapLimitMb) failures.push(`childHeapLimitMb ${String(environment.childHeapLimitMb)} is not ${expected.childHeapLimitMb}`)
    if (environment.concurrency !== expected.concurrency) failures.push(`concurrency ${String(environment.concurrency)} is not ${expected.concurrency}`)
    if (environment.orientationBudgetMs !== expected.orientationBudgetMs) failures.push(`orientationBudgetMs ${String(environment.orientationBudgetMs)} is not ${expected.orientationBudgetMs}`)
  }

  const baseline = isObject(root.baseline) ? root.baseline : null
  const baselineProcess = baseline && isObject(baseline.process) ? baseline.process : null
  const baselineRecord = baseline && isObject(baseline.record) ? baseline.record : null
  const baselineCompleted = baselineProcess?.outcome === 'completed' && baselineRecord !== null && Array.isArray(baselineRecord.orientations)
  if (!baselineCompleted) failures.push('the baseline child record is missing or not completed')
  const orientations = (baselineRecord ? asArray(baselineRecord.orientations) : []) as Phase2C2Orientation[]
  const expectedById = new Map<string, Phase2C2Orientation>()
  for (const orientation of orientations) {
    if (!isObject(orientation) || typeof orientation.orientationId !== 'string') { failures.push('the baseline holds a malformed orientation'); continue }
    if (expectedById.has(orientation.orientationId)) failures.push(`the baseline derives ${orientation.orientationId} twice`)
    expectedById.set(orientation.orientationId, orientation)
  }

  const kernels = Array.isArray(root.kernels) ? root.kernels : null
  if (kernels === null) failures.push('kernels is not an array')
  const seen = new Map<string, number>()
  const foreignOrientations: string[] = []
  const metadataMismatches: Phase2C26AFormalRunValidation['metadataMismatches'] = []
  const unknownStatuses: Phase2C26AFormalRunValidation['unknownStatuses'] = []
  const statuses: readonly string[] = PHASE2C26A_CHILD_STATUSES
  for (const [index, kernel] of (kernels ?? []).entries()) {
    const id = isObject(kernel) && typeof kernel.orientationId === 'string' ? kernel.orientationId : `kernels[${index}] (no orientationId)`
    const orientation = expectedById.get(id)
    if (!orientation || !isObject(kernel)) { foreignOrientations.push(id); continue }
    seen.set(id, (seen.get(id) ?? 0) + 1)
    const task = isObject(kernel.task) ? kernel.task : null
    if (task === null || stableStringify(task.orientation) !== stableStringify(orientation)) metadataMismatches.push({ orientationId: id, field: 'task.orientation' })
    if (task === null || stableStringify(task.conditions) !== stableStringify(expected.conditions)) metadataMismatches.push({ orientationId: id, field: 'task.conditions' })
    const process = isObject(kernel.process) ? kernel.process : null
    if (process === null || process.id !== `kernel-${id}` || process.role !== 'kernel') metadataMismatches.push({ orientationId: id, field: 'process.id / role' })
    const status = process?.outcome
    if (typeof status !== 'string' || !statuses.includes(status)) { unknownStatuses.push({ orientationId: id, status }); continue }
    const record = isObject(kernel.record) ? kernel.record : null
    if (status === 'completed') {
      if (record === null || !isObject(record.kernel)) metadataMismatches.push({ orientationId: id, field: 'record (completed child without a kernel record)' })
      else if (stableStringify(record.orientation) !== stableStringify(orientation)) metadataMismatches.push({ orientationId: id, field: 'record.orientation' })
    } else if (kernel.record !== null) {
      metadataMismatches.push({ orientationId: id, field: `record (a ${status} child carries a record)` })
    }
  }
  const missingOrientations = [...expectedById.keys()].filter(id => !seen.has(id))
  const duplicateOrientations = [...seen].filter(([, n]) => n > 1).map(([id]) => id)
  if (missingOrientations.length > 0) failures.push(`missing orientations: ${missingOrientations.join(', ')}`)
  if (duplicateOrientations.length > 0) failures.push(`duplicate orientations: ${duplicateOrientations.join(', ')}`)
  if (foreignOrientations.length > 0) failures.push(`foreign orientations: ${foreignOrientations.join(', ')}`)
  if (metadataMismatches.length > 0) failures.push(`metadata mismatches: ${metadataMismatches.map(m => `${m.orientationId}.${m.field}`).join(', ')}`)
  if (unknownStatuses.length > 0) failures.push(`unknown child statuses: ${unknownStatuses.map(u => `${u.orientationId}=${String(u.status)}`).join(', ')}`)

  const processCounts = { baseline: 0, kernel: 0, other: 0 }
  for (const child of asArray(root.processes)) {
    const role = isObject(child) ? child.role : null
    if (role === 'baseline') processCounts.baseline += 1
    else if (role === 'kernel') processCounts.kernel += 1
    else processCounts.other += 1
  }
  if (processCounts.baseline !== 1 || processCounts.kernel !== expectedById.size || processCounts.other !== 0) {
    failures.push(`child processes ${JSON.stringify(processCounts)}, expected 1 baseline and ${expectedById.size} kernel children`)
  }
  return {
    valid: failures.length === 0, failures, rawStatus, smokeIsNull, uncommittedBenchmarkCode, baselineCompleted,
    expectedOrientations: expectedById.size, actualKernelRecords: kernels?.length ?? 0,
    missingOrientations, duplicateOrientations, foreignOrientations, metadataMismatches, unknownStatuses, processCounts,
  }
}

// ---------------------------------------------------------------- comparability with Phase 2-C2 (post-hoc, fail closed)

export interface Phase2C26AConditionComparison<T> { current: T | null; old: T | null; matches: boolean }

/** A condition the old RESULT does not record: kept as a current invariant only, never compared against a guessed old value. */
export interface Phase2C26ANotMachineVerifiable { condition: string; current: unknown; reason: string }

/** The orientation metadata that must also be equal, because this phase re-measures the SAME orientations of the SAME Export. */
export const PHASE2C26A_ORIENTATION_METADATA_FIELDS = ['conflictKey', 'fixedBuildListEntryId', 'participantBuildListEntryIds', 'participantTargetWeaponIds'] as const

export interface Phase2C26AOldC2Comparability {
  valid: boolean
  issues: string[]
  exportSha256: Phase2C26AConditionComparison<string>
  baseline: { matches: boolean; failedFields: string[]; checks: Phase2C26AParityCheck[] }
  orientations: {
    matches: boolean
    currentCount: number
    oldCount: number
    countMatches: boolean
    orderedIdsMatch: boolean
    missingInCurrent: string[]
    extraInCurrent: string[]
    identityMismatches: { orientationId: string; field: string; current: unknown; old: unknown }[]
    metadataMismatches: { orientationId: string; field: string; current: unknown; old: unknown }[]
    metadataMismatchCounts: Record<(typeof PHASE2C26A_ORIENTATION_METADATA_FIELDS)[number], number>
  }
  extent: Phase2C26AConditionComparison<Phase2C2Conditions['extent']>
  bounds: Phase2C26AConditionComparison<Phase2C2Conditions['bounds']>
  /** Every kernel task of the current run carries the run's own extent / bounds. */
  currentTaskConditionsUniform: boolean
  childHeapLimitMb: Phase2C26AConditionComparison<number>
  concurrency: Phase2C26AConditionComparison<number>
  orientationBudgetMs: Phase2C26AConditionComparison<number>
  /** Recorded by both RESULTs; compared when the old RESULT has the value, `notMachineVerifiable` otherwise. */
  researchMaxPlanSteps: Phase2C26AConditionComparison<number>
  nodeYield: Phase2C26AConditionComparison<string>
  calculationContext: Phase2C26AConditionComparison<unknown>
  searchConditionsMatch: boolean
  executionConditionsMatch: boolean
  notMachineVerifiable: Phase2C26ANotMachineVerifiable[]
}

function compareCondition<T>(current: T | null | undefined, old: T | null | undefined): Phase2C26AConditionComparison<T> {
  const a = current ?? null, b = old ?? null
  return { current: a, old: b, matches: a !== null && b !== null && stableStringify(a) === stableStringify(b) }
}

/**
 * Whether the before / after comparison with the committed Phase 2-C2 RESULT is a comparison of the same measurement:
 * the same Export SHA-256, the same baseline (every parity check), the same orientations in the same order with the same
 * Conflict key / Entry metadata, the same Production extent / trial bounds, and the same Node execution conditions (heap,
 * concurrency, orientation budget), plus the Research `maxPlanSteps`, Node yield and CalculationContext both RESULTs record.
 * Any difference or any missing value makes it invalid. `raw` is the current raw run (untrusted JSON), `old` the parsed
 * Phase 2-C2 RESULT. The baseline and orientation parities are computed here from exactly these two inputs.
 */
export function validatePhase2C26AOldC2Comparability(raw: unknown, old: Phase2C26AOldC2View): Phase2C26AOldC2Comparability {
  const issues: string[] = []
  const root = isObject(raw) ? raw : {}
  const environment = isObject(root.environment) ? root.environment : {}
  const baseline = isObject(root.baseline) ? root.baseline : {}
  const record = isObject(baseline.record) ? baseline.record : null
  const conditions = isObject(root.conditions) ? root.conditions : {}

  const exportSha256 = compareCondition(typeof environment.exportSha256 === 'string' ? environment.exportSha256 : null, old.exportSha256)
  if (!exportSha256.matches) issues.push(`Export SHA-256 differs (current ${String(exportSha256.current)}, Phase 2-C2 ${old.exportSha256})`)

  const summary = record && isObject(record.summary) ? (record.summary as unknown as Phase2C2BaselineSummary) : null
  const currentOrientations = (record && Array.isArray(record.orientations) ? record.orientations : []) as Phase2C2Orientation[]
  if (summary === null) issues.push('the current baseline summary is missing')
  const baselineParity = summary === null ? { checks: [], matches: false } : comparePhase2C26ABaselineWithOldC2(summary, currentOrientations.length, old)
  const failedFields = baselineParity.checks.filter(check => !check.matches).map(check => check.field)
  if (!baselineParity.matches) issues.push(`baseline differs: ${summary === null ? 'missing' : failedFields.join(', ')}`)

  const orientationParity = comparePhase2C26AOrientationSets(currentOrientations, old.orientations)
  const countMatches = currentOrientations.length === old.orientations.length
  const orderedIdsMatch = stableStringify(currentOrientations.map(o => o.orientationId)) === stableStringify(old.orientations.map(o => o.orientationId))
  const metadataMismatchCounts = Object.fromEntries(PHASE2C26A_ORIENTATION_METADATA_FIELDS.map(field =>
    [field, orientationParity.auxiliaryMismatches.filter(m => m.field === field).length])) as Phase2C26AOldC2Comparability['orientations']['metadataMismatchCounts']
  const orientationsMatch = orientationParity.matches && countMatches && orderedIdsMatch && orientationParity.auxiliaryMismatches.length === 0
  if (!countMatches) issues.push(`orientation count differs (current ${currentOrientations.length}, Phase 2-C2 ${old.orientations.length})`)
  if (!orderedIdsMatch) issues.push('the ordered orientation IDs differ')
  if (orientationParity.missingInCurrent.length > 0) issues.push(`orientations missing in the current run: ${orientationParity.missingInCurrent.join(', ')}`)
  if (orientationParity.extraInCurrent.length > 0) issues.push(`orientations not in Phase 2-C2: ${orientationParity.extraInCurrent.join(', ')}`)
  if (orientationParity.mismatches.length > 0) issues.push(`orientation identity mismatches: ${orientationParity.mismatches.map(m => `${m.orientationId}.${m.field}`).join(', ')}`)
  if (orientationParity.auxiliaryMismatches.length > 0) issues.push(`orientation metadata mismatches: ${orientationParity.auxiliaryMismatches.map(m => `${m.orientationId}.${m.field}`).join(', ')}`)

  const extent = compareCondition(isObject(conditions.extent) ? (conditions.extent as unknown as Phase2C2Conditions['extent']) : null, old.conditions.extent)
  const bounds = compareCondition(isObject(conditions.bounds) ? (conditions.bounds as unknown as Phase2C2Conditions['bounds']) : null, old.conditions.bounds)
  if (!extent.matches) issues.push(`Planner Alternative extent differs (current ${stableStringify(extent.current)}, Phase 2-C2 ${stableStringify(extent.old)})`)
  if (!bounds.matches) issues.push(`Planner Alternative trial bounds differ (current ${stableStringify(bounds.current)}, Phase 2-C2 ${stableStringify(bounds.old)})`)
  const currentTaskConditionsUniform = asArray(root.kernels).every(kernel => {
    const task = isObject(kernel) && isObject(kernel.task) && isObject(kernel.task.conditions) ? kernel.task.conditions : null
    return task !== null && stableStringify(task.extent) === stableStringify(conditions.extent) && stableStringify(task.bounds) === stableStringify(conditions.bounds)
  })
  if (!currentTaskConditionsUniform) issues.push('a current kernel task carries an extent / bounds other than the run conditions')

  const numberOf = (value: unknown) => (typeof value === 'number' ? value : null)
  const childHeapLimitMb = compareCondition(numberOf(environment.childHeapLimitMb), old.childHeapLimitMb)
  const concurrency = compareCondition(numberOf(environment.concurrency), old.concurrency)
  const orientationBudgetMs = compareCondition(numberOf(environment.orientationBudgetMs), old.orientationBudgetMs)
  if (!childHeapLimitMb.matches) issues.push(`child heap limit differs (current ${String(childHeapLimitMb.current)} MB, Phase 2-C2 ${old.childHeapLimitMb} MB)`)
  if (!concurrency.matches) issues.push(`concurrency differs (current ${String(concurrency.current)}, Phase 2-C2 ${old.concurrency})`)
  if (!orientationBudgetMs.matches) issues.push(`orientation budget differs (current ${String(orientationBudgetMs.current)} ms, Phase 2-C2 ${old.orientationBudgetMs} ms)`)

  const notMachineVerifiable: Phase2C26ANotMachineVerifiable[] = [{
    condition: 'kernel request lineage (priorFixedBuildListEntryIds = [], priorExcludedRoutes = [])',
    current: { priorFixedBuildListEntryIds: [], priorExcludedRoutes: [] },
    reason: 'not machine-verifiable from the Phase 2-C2 RESULT, which records no request lineage; both runs build the request with the unchanged phase2c2KernelRequest(), whose empty lineage is a tested invariant',
  }]
  const optional = <T>(name: string, current: T | null, before: T | null) => {
    const comparison = compareCondition(current, before)
    if (before === null) notMachineVerifiable.push({ condition: name, current, reason: 'not machine-verifiable from the Phase 2-C2 RESULT' })
    else if (!comparison.matches) issues.push(`${name} differs (current ${stableStringify(current)}, Phase 2-C2 ${stableStringify(before)})`)
    return comparison
  }
  const researchMaxPlanSteps = optional('researchMaxPlanSteps', numberOf(baseline.researchMaxPlanSteps), old.researchMaxPlanSteps)
  const nodeYield = optional('nodeYield', typeof environment.nodeYield === 'string' ? environment.nodeYield : null, old.nodeYield)
  const calculationContext = optional('calculationContext', isObject(baseline.calculationContext) ? baseline.calculationContext : null, old.calculationContext)

  const searchConditionsMatch = extent.matches && bounds.matches && currentTaskConditionsUniform
  const executionConditionsMatch = childHeapLimitMb.matches && concurrency.matches && orientationBudgetMs.matches &&
    (old.researchMaxPlanSteps === null || researchMaxPlanSteps.matches) && (old.nodeYield === null || nodeYield.matches) &&
    (old.calculationContext === null || calculationContext.matches)
  return {
    valid: issues.length === 0, issues, exportSha256,
    baseline: { matches: baselineParity.matches, failedFields, checks: baselineParity.checks },
    orientations: {
      matches: orientationsMatch, currentCount: currentOrientations.length, oldCount: old.orientations.length, countMatches, orderedIdsMatch,
      missingInCurrent: orientationParity.missingInCurrent, extraInCurrent: orientationParity.extraInCurrent,
      identityMismatches: orientationParity.mismatches, metadataMismatches: orientationParity.auxiliaryMismatches, metadataMismatchCounts,
    },
    extent, bounds, currentTaskConditionsUniform, childHeapLimitMb, concurrency, orientationBudgetMs,
    researchMaxPlanSteps, nodeYield, calculationContext, searchConditionsMatch, executionConditionsMatch, notMachineVerifiable,
  }
}

/**
 * The before / after comparison with Phase 2-C2, produced ONLY for a valid comparability: the old -> current child
 * outcome transitions, the semantic parity of the old completed kernels, the trial rejection / Target outcome before /
 * after and the participant coverage with the old explored count. An invalid comparability throws; nothing here is ever
 * computed against a Phase 2-C2 RESULT that is not the same measurement.
 */
export function comparePhase2C26AWithOldC2(comparability: Phase2C26AOldC2Comparability, old: Phase2C26AOldC2View, kernels: readonly Phase2C26ARawKernel[],
  orientations: readonly Phase2C2Orientation[], sha256: (value: string) => string) {
  if (!comparability.valid) throw new Error(`The Phase 2-C2 RESULT is not comparable with this run: ${comparability.issues.join('; ')}`)
  const summary = summarizePhase2C26AKernels(kernels)
  return {
    transitions: phase2c26aTransitions(old, kernels),
    oldCompletedSemantics: comparePhase2C26AOldCompletedSemantics(old, kernels, sha256),
    trialRejectionBeforeAfter: { oldC2: old.trialRejectionReasons, current: summary.trials.rejectionReasons,
      explicitDecisionNotSelected: { oldC2: old.trialRejectionReasons.explicit_decision_not_selected ?? 0, current: summary.trials.rejectionReasons.explicit_decision_not_selected ?? 0 } },
    targetOutcomeBeforeAfter: { oldC2: old.targetOutcomes, current: summary.targetOutcomes, currentOther: summary.otherTargetOutcomes },
    participants: phase2c26aParticipantCoverage(orientations, kernels, old),
  }
}

// ---------------------------------------------------------------- kernel aggregation

export interface Phase2C26AKernelTarget {
  targetWeaponId: string
  outcome: string
  reservation: unknown
  search: unknown
  trials: { candidateKey: string; result: string; reason: string | null; generatedSelected: boolean | null }[]
  found: null | { stableKey: string; generatedSelected: boolean; trialPlan: unknown; summary: unknown }
  skippedExcludedRouteKeys: number
}

export interface Phase2C26ARawKernel {
  orientationId: string
  task: { orientation: Phase2C2Orientation; conditions: Phase2C2Conditions }
  process: { outcome: Phase2C2ChildOutcome; wallMs: number; exitCode: number | null; signal: string | null; timedOut: boolean; stderrTail: string | null;
    lastIpcMemory: null | { samples: number; maxHeapUsedBytes: number; maxRssBytes: number; lastElapsedMs: number }; lastIpcYields: number }
  childWallMs: number | null
  memory: null | { samples: number; sampledMaxHeapUsedBytes: number; sampledMaxRssBytes: number; maxRssKiB: number; heapSizeLimitBytes: number }
  record: null | {
    kernel: { status: 'completed'; plannerRerunsUsed: number; explicitDecisionBuildListEntryIds: string[]; targets: Phase2C26AKernelTarget[] }
      | { status: 'preparation_failed'; failure: string; detail: string }
    timing: { kernelMs: number }
  }
}

/** Sampled maxima of one child, whatever its outcome: the written record when completed, the last IPC maxima otherwise. */
export function phase2c26aChildMemory(kernel: Pick<Phase2C26ARawKernel, 'memory' | 'process'>) {
  if (kernel.memory) return { source: 'record' as const, sampledMaxHeapUsedBytes: kernel.memory.sampledMaxHeapUsedBytes, sampledMaxRssBytes: kernel.memory.sampledMaxRssBytes, maxRssKiB: kernel.memory.maxRssKiB }
  const ipc = kernel.process.lastIpcMemory
  return ipc === null ? { source: 'none' as const, sampledMaxHeapUsedBytes: null, sampledMaxRssBytes: null, maxRssKiB: null }
    : { source: 'last_ipc_sample' as const, sampledMaxHeapUsedBytes: ipc.maxHeapUsedBytes, sampledMaxRssBytes: ipc.maxRssBytes, maxRssKiB: null }
}

function completedKernel(kernel: Phase2C26ARawKernel) {
  return kernel.process.outcome === 'completed' && kernel.record?.kernel.status === 'completed' ? kernel.record.kernel : null
}

export function summarizePhase2C26AKernels(kernels: readonly Phase2C26ARawKernel[]) {
  const childStatus = Object.fromEntries(PHASE2C26A_CHILD_STATUSES.map(status => [status, kernels.filter(k => k.process.outcome === status).length])) as Record<Phase2C2ChildOutcome, number>
  const byKind: Record<string, Record<string, number>> = {}
  for (const kernel of kernels) {
    const kind = kernel.task.orientation.kind
    byKind[kind] ??= Object.fromEntries(PHASE2C26A_CHILD_STATUSES.map(status => [status, 0]))
    byKind[kind][kernel.process.outcome] += 1
  }
  const preparationFailed = kernels.filter(k => k.record?.kernel.status === 'preparation_failed').map(k => k.orientationId)
  const completed = kernels.flatMap(k => { const c = completedKernel(k); return c ? [{ kernel: k, result: c }] : [] })
  const targets = completed.flatMap(({ kernel, result }) => result.targets.map(target => ({ kind: kernel.task.orientation.kind, target })))
  const known: readonly string[] = PHASE2C26A_KNOWN_TARGET_OUTCOMES
  const targetOutcomes = Object.fromEntries(PHASE2C26A_KNOWN_TARGET_OUTCOMES.map(status => [status, targets.filter(t => t.target.outcome === status).length]))
  const otherTargetOutcomes = countBy(targets.filter(t => !known.includes(t.target.outcome)), t => t.target.outcome)
  const targetOutcomesByKind: Record<string, Record<string, number>> = {}
  for (const { kind, target } of targets) {
    targetOutcomesByKind[kind] ??= {}
    targetOutcomesByKind[kind][target.outcome] = (targetOutcomesByKind[kind][target.outcome] ?? 0) + 1
  }
  const trials = targets.flatMap(t => t.target.trials)
  const walls = kernels.map(k => k.process.wallMs)
  const completedWalls = completed.map(({ kernel }) => kernel.process.wallMs)
  const memories = kernels.map(phase2c26aChildMemory)
  const heaps = memories.map(m => m.sampledMaxHeapUsedBytes).filter((v): v is number => v !== null)
  const rss = memories.map(m => m.sampledMaxRssBytes).filter((v): v is number => v !== null)
  const reruns = completed.map(({ result }) => result.plannerRerunsUsed)
  return {
    orientations: kernels.length,
    childStatus,
    childStatusByKind: Object.fromEntries(Object.entries(byKind).sort(([a], [b]) => (a < b ? -1 : 1))),
    kernelCompleted: completed.length,
    preparationFailed,
    targetResults: targets.length,
    targetOutcomes,
    otherTargetOutcomes,
    targetOutcomesByKind,
    trials: {
      total: trials.length,
      byResult: countBy(trials, t => t.result),
      rejectionReasons: countBy(trials.filter(t => t.result === 'rejected'), t => t.reason ?? 'null'),
      generatedSelected: countBy(trials.filter(t => t.result === 'found'), t => String(t.generatedSelected)),
      perTargetDistribution: countBy(targets, t => String(t.target.trials.length)),
      searchedTargets: targets.filter(t => t.target.reservation !== null).length,
      unsearchedTargets: targets.filter(t => t.target.reservation === null).length,
    },
    plannerRerunsUsed: { values: reruns, distribution: countBy(reruns, String), max: reruns.length ? Math.max(...reruns) : null },
    wallMs: { max: walls.length ? Math.max(...walls) : null, median: median(walls), completedMax: completedWalls.length ? Math.max(...completedWalls) : null, completedMedian: median(completedWalls) },
    memory: {
      note: 'sampled maxima of process.memoryUsage() (250 ms), never a true peak; a failed child reports its last IPC sample before death',
      maxSampledHeapUsedBytes: heaps.length ? Math.max(...heaps) : null, maxSampledRssBytes: rss.length ? Math.max(...rss) : null,
      completedMaxRssKiB: Math.max(0, ...memories.map(m => m.maxRssKiB ?? 0)),
      sources: countBy(memories, m => m.source),
    },
  }
}

// ---------------------------------------------------------------- before / after

export function phase2c26aTransitions(old: Pick<Phase2C26AOldC2View, 'rows'>, kernels: readonly Pick<Phase2C26ARawKernel, 'orientationId' | 'process'>[]) {
  const matrix: Record<string, Record<string, number>> = {}
  const rows: { orientationId: string; old: string; current: string }[] = []
  for (const kernel of kernels) {
    const before = old.rows.get(kernel.orientationId)
    const from = before?.outcome ?? 'not_in_old_c2'
    matrix[from] ??= Object.fromEntries(PHASE2C26A_CHILD_STATUSES.map(status => [status, 0]))
    matrix[from][kernel.process.outcome] = (matrix[from][kernel.process.outcome] ?? 0) + 1
    rows.push({ orientationId: kernel.orientationId, old: from, current: kernel.process.outcome })
  }
  const orientationsBy = (from: string, to: string) => rows.filter(r => r.old === from && r.current === to).map(r => r.orientationId)
  return {
    matrix,
    oldOutOfMemory: { total: rows.filter(r => r.old === 'out_of_memory').length,
      ...Object.fromEntries(PHASE2C26A_CHILD_STATUSES.map(status => [`to_${status}`, orientationsBy('out_of_memory', status)])) },
    oldCompleted: { total: rows.filter(r => r.old === 'completed').length,
      ...Object.fromEntries(PHASE2C26A_CHILD_STATUSES.map(status => [`to_${status}`, orientationsBy('completed', status)])) },
    rows,
  }
}

/**
 * For every orientation completed both in Phase 2-C2 and now: whether the kernel judged it the same way (Target outcome,
 * trial result / reason / generatedSelected and trialled Candidate key SHA-256, found key SHA-256, reruns). Observational.
 */
export function comparePhase2C26AOldCompletedSemantics(old: Pick<Phase2C26AOldC2View, 'rows'>, kernels: readonly Phase2C26ARawKernel[], sha256: (value: string) => string) {
  const rows = kernels.flatMap(kernel => {
    const current = completedKernel(kernel)
    const before = old.rows.get(kernel.orientationId)
    if (!current || !before || before.kernelStatus !== 'completed') return []
    const now = { plannerRerunsUsed: current.plannerRerunsUsed, targets: current.targets.map(t => ({ targetWeaponId: t.targetWeaponId, outcome: t.outcome, searched: t.reservation !== null,
      foundStableKeySha256: t.found ? sha256(t.found.stableKey) : null,
      trials: t.trials.map(trial => ({ candidateKeySha256: sha256(trial.candidateKey), result: trial.result, reason: trial.reason, generatedSelected: trial.generatedSelected })) })) }
    const then = { plannerRerunsUsed: before.plannerRerunsUsed, targets: before.targets }
    return [{ orientationId: kernel.orientationId, identical: stableStringify(now) === stableStringify(then) }]
  })
  return { compared: rows.length, identical: rows.filter(r => r.identical).length, differing: rows.filter(r => !r.identical).map(r => r.orientationId) }
}

// ---------------------------------------------------------------- participant coverage

export function phase2c26aParticipantCoverage(orientations: readonly Phase2C2Orientation[], kernels: readonly Phase2C26ARawKernel[], old: Pick<Phase2C26AOldC2View, 'rows'> | null) {
  const participants = [...new Set(orientations.flatMap(o => o.participantTargetWeaponIds))].sort()
  const evaluated = new Set<string>(), searched = new Set<string>()
  for (const kernel of kernels) {
    for (const target of completedKernel(kernel)?.targets ?? []) {
      evaluated.add(target.targetWeaponId)
      if (target.reservation !== null) searched.add(target.targetWeaponId)
    }
  }
  const oldSearched = new Set<string>()
  for (const row of old?.rows.values() ?? []) for (const target of row.targets) if (target.searched) oldSearched.add(target.targetWeaponId)
  return {
    participantsTotal: participants.length,
    /** A non-fixed Target of at least one completed kernel (its outcome is known). */
    participantsEvaluated: participants.filter(id => evaluated.has(id)).length,
    /** ... and its Planner Alternative Search was actually run (the Phase 2-C2 "explored" definition). */
    participantsSearched: participants.filter(id => searched.has(id)).length,
    participantsNotEvaluated: participants.filter(id => !evaluated.has(id)),
    participantsNotSearched: participants.filter(id => !searched.has(id)),
    oldC2ParticipantsSearched: old === null ? null : participants.filter(id => oldSearched.has(id)).length,
    allParticipantsSearched: participants.every(id => searched.has(id)),
  }
}

// ---------------------------------------------------------------- per-orientation compact record

export function compactPhase2C26AKernel(kernel: Phase2C26ARawKernel, old: Phase2C26AOldOrientationRow | null, sha256: (value: string) => string, v8FatalGc: unknown) {
  const o = kernel.task.orientation
  const memory = phase2c26aChildMemory(kernel)
  const result = kernel.record?.kernel ?? null
  return {
    orientationId: kernel.orientationId, conflictIndex: o.conflictIndex, conflictKey: o.conflictKey, kind: o.kind,
    fixedBuildListEntryId: o.fixedBuildListEntryId, fixedTargetWeaponId: o.fixedTargetWeaponId, participantTargetWeaponIds: o.participantTargetWeaponIds,
    child: { outcome: kernel.process.outcome, exitCode: kernel.process.exitCode, signal: kernel.process.signal, timedOut: kernel.process.timedOut, wallMs: kernel.process.wallMs,
      childWallMs: kernel.childWallMs, lastIpcYields: kernel.process.lastIpcYields,
      stderrTail: kernel.process.outcome === 'completed' ? null : (kernel.process.stderrTail ?? '').slice(-1500) },
    memory: { ...memory, heapSizeLimitBytes: kernel.memory?.heapSizeLimitBytes ?? null },
    v8FatalGc,
    kernel: result === null ? { status: `process_${kernel.process.outcome}` }
      : result.status === 'preparation_failed' ? { status: 'preparation_failed', failure: result.failure }
        : { status: 'completed', plannerRerunsUsed: result.plannerRerunsUsed, kernelMs: kernel.record?.timing.kernelMs ?? null,
          targets: result.targets.map(target => ({
            targetWeaponId: target.targetWeaponId, outcome: target.outcome, searched: target.reservation !== null, search: target.search,
            trials: target.trials.map(trial => ({ candidateKeySha256: sha256(trial.candidateKey), result: trial.result, reason: trial.reason, generatedSelected: trial.generatedSelected })),
            found: target.found === null ? null : { stableKeySha256: sha256(target.found.stableKey), generatedSelected: target.found.generatedSelected, trialPlan: target.found.trialPlan, summary: target.found.summary },
            skippedExcludedRouteKeys: target.skippedExcludedRouteKeys,
          })) },
    old: old === null ? null : { outcome: old.outcome, wallMs: old.wallMs, peakSampledHeapUsedBytes: old.peakSampledHeapUsedBytes, maxRssKiB: old.maxRssKiB,
      kernelStatus: old.kernelStatus, targetOutcomes: old.targets.map(t => t.outcome) },
    transition: `${old?.outcome ?? 'not_in_old_c2'} -> ${kernel.process.outcome}`,
  }
}

// ---------------------------------------------------------------- formal conclusion rule

export type Phase2C26AConclusionCase = 'all_completed' | 'residual_out_of_memory' | 'timeout_without_out_of_memory' | 'process_failure_only'

/**
 * The pre-registered conclusion rule. OOM takes precedence (a residual OOM is localized before anything else), then a
 * timeout (runtime, never "no Candidate"), then another process failure; only a series with none of them is `all_completed`.
 */
/**
 * `oldOutOfMemory` is the Phase 2-C2 OOM count, passed only when the comparability with Phase 2-C2 is valid; `null`
 * (a non-formal diagnostic without a comparable Phase 2-C2) keeps every statement free of any old-run claim.
 */
export function phase2c26aConclusion(childStatus: Record<Phase2C2ChildOutcome, number>, orientations: number, oldOutOfMemory: number | null) {
  const oldOom = oldOutOfMemory === null ? '' : `旧Phase 2-C2で${oldOutOfMemory}件発生したkernel child OOMは`
  const { completed, out_of_memory: oom, timeout, process_failure: failure } = childStatus
  const kase: Phase2C26AConclusionCase = oom > 0 ? 'residual_out_of_memory' : timeout > 0 ? 'timeout_without_out_of_memory'
    : failure > 0 ? 'process_failure_only' : 'all_completed'
  if (completed + oom + timeout + failure !== orientations) throw new Error('Child status counts do not cover every orientation.')
  const cannotSay = [
    'Global Planner memory問題が完全に解決したこと',
    'foundがそのorientationのfixed Route setとのkernel trialで選ばれた以上の意味（全planning Target完成・全Conflict解消・Global assignment成立・1,657 oracle coverage）を持つこと',
    'C3 readiness（portfolioを再測定していないため判定しない）',
    'Browser Workerや他のdevice / heap条件での挙動',
  ]
  switch (kase) {
    case 'all_completed':
      return { case: kase, statement: `今回の元Export・${orientations} orientation・Node 8GB条件では、${oldOom || 'kernel child OOMは'}H1後のcurrent Productionでは再現せず、全orientationを測定可能になった。`,
        cannotSay, nextPhase: 'Phase 2-C2.6-B：current ProductionでCandidate portfolioを再構築する（default extent portfolio、capture bound、explored participant、portfolio diversity、held / late-start alternatives、必要ならextent probe、1,657 oracle coverage、C3 readinessの再評価）。' }
    case 'residual_out_of_memory':
      return { case: kase, statement: `今回の元Export・${orientations} orientation・Node 8GB条件で、current Productionのkernel childにOOMが${oom}件残った（completed ${completed}、timeout ${timeout}、process failure ${failure}）。`,
        cannotSay, nextPhase: '残ったOOM orientationに対するpost-H1 residual localization。portfolio再測定（C2.6-B）へは進まない。' }
    case 'timeout_without_out_of_memory':
      return { case: kase, statement: `今回の元Export・${orientations} orientation・Node 8GB条件で、${oldOom ? `${oldOom}current Productionでは再現しなかった（OOM 0件）` : 'OOMは0件になった'}が、30分budgetのtimeoutが${timeout}件残った（completed ${completed}、process failure ${failure}）。memory bottleneckがruntime bottleneckへ移った可能性がある。timeoutはCandidateなしを意味しない。`,
        cannotSay, nextPhase: 'timeout orientationのtargeted runtime analysisを優先する。測定可能範囲（completed orientation）だけでportfolio再測定へ進むかは、その結果で判断する。' }
    case 'process_failure_only':
      return { case: kase, statement: `OOM・timeoutは0件だが、その他のprocess failureが${failure}件ある（completed ${completed}）。`,
        cannotSay, nextPhase: 'process failureの原因を特定し、同条件で再測定する。' }
  }
}
