/**
 * Issue #154 Phase 2-C2.5-B: the Phase 2-C2.5-A evidence view, the Browser workload and the pre-search context parity.
 * Research only. Never import from Production.
 *
 * The committed Phase 2-C2.5-A evidence (`docs/PLANNER_GLOBAL_PHASE2C25A_RESULT.json`) is read here, and only here
 * (the page receives it through an explicit file input), for exactly four things: which orientations were selected
 * (representatives and completed controls), which of their contexts were searchable, the expected context digests
 * for parity, and the post-hoc Node comparison. It is never a Search input: the Worker never receives it, and every
 * Search context is re-derived from the original Export by the current Domain code. No Target ID, Entry ID or Counter
 * position is named in code.
 */
import type { ConflictKind } from '../domain/models/publicTypes'
import { stableStringify } from '../domain/models/publicTypes'
import type { PlannerAlternativeReservation, PlannerAlternativeSearchExtent } from '../domain/search'
import type { Phase2C25APreSearchContext } from './plannerGlobalPhase2C25A'
import type { Phase2C25BContextsResult } from './plannerGlobalPhase2C25BProtocol'

function fail(message: string): never {
  throw new Error(`Phase 2-C2.5-A evidence: ${message}`)
}
function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(`${path} is not an object.`)
  return value as Record<string, unknown>
}
function list(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(`${path} is not an array.`)
  return value
}
function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) fail(`${path} is not a non-empty string.`)
  return value
}
function integer(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) fail(`${path} is not a non-negative integer.`)
  return value
}
function numberOrNull(value: unknown, path: string): number | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${path} is not a number.`)
  return value
}
function textOrNull(value: unknown, path: string): string | null {
  return value === null || value === undefined ? null : text(value, path)
}

export type Phase2C25BRole = 'oom_representative' | 'completed_control'
const ROLES: readonly Phase2C25BRole[] = ['oom_representative', 'completed_control']
const NODE_STATUSES = ['first_candidate', 'stopped_by_extent_before_candidate', 'exhausted_before_candidate', 'out_of_memory', 'timeout', 'process_failure'] as const
export type Phase2C25BNodeRunStatus = typeof NODE_STATUSES[number]

export interface Phase2C25BRangeReservation {
  normal: { counterId: string; held: [number, number][]; blocked: [number, number][] }[]
  skill: { held: [number, number][]; blocked: [number, number][] }
  gogma: { held: [number, number][]; blocked: [number, number][] }
  exclusiveOwnedWeaponIds: string[]
}

/** One selected pre-search context as Phase 2-C2.5-A recorded it (SHA-256 Route keys, reservation ranges). */
export interface Phase2C25BExpectedContext {
  orientationId: string
  kind: ConflictKind
  role: Phase2C25BRole
  workIndex: number
  targetWeaponId: string
  status: string
  invalidatedBuildListEntryId: string
  invalidatedRouteKeySha256: string
  fixedRouteBuildListEntryIds: string[]
  reservation: Phase2C25BRangeReservation | null
  excludedRouteKeySha256s: string[]
  extent: PlannerAlternativeSearchExtent
  originDigest: string
  contextDigest: string
}

export interface Phase2C25BNodeMode {
  status: Phase2C25BNodeRunStatus
  wallMs: number | null
  timeToFirstMs: number | null
  searchSummary: Record<string, unknown> | null
  firstCandidateKeySha256: string | null
  lastGc: { beforeMb: number; afterMb: number } | null
}

/** The Node Search-only result of one context (post-hoc comparison only). */
export interface Phase2C25BNodeContext {
  orientationId: string
  workIndex: number
  targetWeaponId: string
  classification: string
  minimal: Phase2C25BNodeMode
  instrumented: Phase2C25BNodeMode
  /** The last instrumented snapshot the Node parent received (for an OOM: the last one before the process died). */
  lastSnapshot: null | { elapsedMs: number; heapUsed: number; rss: number; gogmaMaxDepth: number; skillMaxDepth: number; cumulativeGogmaGenerated: number;
    cumulativeGogmaFrontier: number; settledWorkItems: number }
}

export interface Phase2C25BEvidenceView {
  measuredHead: string
  exportSha256: string
  searchExtent: PlannerAlternativeSearchExtent
  candidateStopBound: number
  researchMaxPlanSteps: number
  childHeapLimitMb: number | null
  calculationContext: Record<string, unknown>
  selection: { orientationId: string; kind: ConflictKind; role: Phase2C25BRole }[]
  baselineSummary: Record<string, unknown>
  expectedContexts: Phase2C25BExpectedContext[]
  nodeContexts: Phase2C25BNodeContext[]
}

function extentOf(value: unknown, path: string): PlannerAlternativeSearchExtent {
  const extent = record(value, path)
  return { maxNormalAdvance: integer(extent.maxNormalAdvance, `${path}.maxNormalAdvance`), maxGogmaAdvance: integer(extent.maxGogmaAdvance, `${path}.maxGogmaAdvance`),
    maxSkillAdvance: integer(extent.maxSkillAdvance, `${path}.maxSkillAdvance`) }
}
function rangesOf(value: unknown, path: string): [number, number][] {
  return list(value, path).map((raw, i) => {
    const pair = list(raw, `${path}[${i}]`)
    if (pair.length !== 2) fail(`${path}[${i}] is not a range.`)
    return [integer(pair[0], `${path}[${i}][0]`), integer(pair[1], `${path}[${i}][1]`)]
  })
}
function reservationOf(value: unknown, path: string): Phase2C25BRangeReservation | null {
  if (value === null) return null
  const r = record(value, path)
  const skill = record(r.skill, `${path}.skill`), gogma = record(r.gogma, `${path}.gogma`)
  return {
    normal: list(r.normal, `${path}.normal`).map((raw, i) => {
      const n = record(raw, `${path}.normal[${i}]`)
      return { counterId: text(n.counterId, 'counterId'), held: rangesOf(n.held, 'held'), blocked: rangesOf(n.blocked, 'blocked') }
    }),
    skill: { held: rangesOf(skill.held, 'skill.held'), blocked: rangesOf(skill.blocked, 'skill.blocked') },
    gogma: { held: rangesOf(gogma.held, 'gogma.held'), blocked: rangesOf(gogma.blocked, 'gogma.blocked') },
    exclusiveOwnedWeaponIds: list(r.exclusiveOwnedWeaponIds, `${path}.exclusiveOwnedWeaponIds`).map(id => text(id, 'exclusive id')),
  }
}
function nodeModeOf(value: unknown, path: string): Phase2C25BNodeMode {
  const mode = record(value, path)
  const status = text(mode.status, `${path}.status`) as Phase2C25BNodeRunStatus
  if (!NODE_STATUSES.includes(status)) fail(`${path}.status ${status} is unknown.`)
  const gc = mode.v8FatalGc === null || mode.v8FatalGc === undefined ? null : record(record(mode.v8FatalGc, `${path}.v8FatalGc`).lastGc, `${path}.v8FatalGc.lastGc`)
  return {
    status, wallMs: numberOrNull(mode.wallMs, `${path}.wallMs`), timeToFirstMs: numberOrNull(mode.timeToFirstMs, `${path}.timeToFirstMs`),
    searchSummary: mode.searchSummary === null || mode.searchSummary === undefined ? null : record(mode.searchSummary, `${path}.searchSummary`),
    firstCandidateKeySha256: textOrNull(mode.firstCandidateKeySha256, `${path}.firstCandidateKeySha256`),
    lastGc: gc === null ? null : { beforeMb: numberOrNull(gc.beforeMb, 'beforeMb') ?? 0, afterMb: numberOrNull(gc.afterMb, 'afterMb') ?? 0 },
  }
}

/**
 * The typed view of the committed Phase 2-C2.5-A evidence JSON. Unknown or malformed fields fail closed; nothing is
 * defaulted. Every selected orientation must have its recorded pre-search contexts and Node results.
 */
export function parsePhase2C25BEvidence(value: unknown): Phase2C25BEvidenceView {
  const root = record(value, 'root')
  const provenance = record(root.provenance, 'provenance')
  if (provenance.formal !== true) fail('provenance.formal is not true.')
  const conditions = record(root.conditions, 'conditions')
  const selectionRoot = record(root.selection, 'selection')
  const selection = list(selectionRoot.selected, 'selection.selected').map((raw, i) => {
    const item = record(raw, `selection.selected[${i}]`)
    const role = text(item.role, `selection.selected[${i}].role`) as Phase2C25BRole
    if (!ROLES.includes(role)) fail(`selection.selected[${i}].role ${role} is unknown.`)
    return { orientationId: text(item.orientationId, `selection.selected[${i}].orientationId`), kind: text(item.kind, `selection.selected[${i}].kind`) as ConflictKind, role }
  })
  if (selection.length === 0) fail('selection.selected is empty.')
  if (new Set(selection.map(s => s.orientationId)).size !== selection.length) fail('selection.selected names an orientation twice.')
  const byOrientation = new Map(list(root.preSearchContexts, 'preSearchContexts').map((raw, i) => {
    const item = record(raw, `preSearchContexts[${i}]`)
    return [text(item.orientationId, `preSearchContexts[${i}].orientationId`), list(item.contexts, `preSearchContexts[${i}].contexts`)] as const
  }))
  const expectedContexts = selection.flatMap(selected => {
    const contexts = byOrientation.get(selected.orientationId) ?? fail(`selected orientation ${selected.orientationId} has no recorded pre-search contexts.`)
    if (contexts.length === 0) fail(`selected orientation ${selected.orientationId} records no pre-search context.`)
    return contexts.map((raw, i): Phase2C25BExpectedContext => {
      const path = `preSearchContexts.${selected.orientationId}[${i}]`
      const c = record(raw, path)
      return {
        orientationId: selected.orientationId, kind: selected.kind, role: selected.role, workIndex: integer(c.workIndex, `${path}.workIndex`),
        targetWeaponId: text(c.targetWeaponId, `${path}.targetWeaponId`), status: text(c.status, `${path}.status`),
        invalidatedBuildListEntryId: text(c.invalidatedBuildListEntryId, `${path}.invalidatedBuildListEntryId`),
        invalidatedRouteKeySha256: text(c.invalidatedRouteKeySha256, `${path}.invalidatedRouteKeySha256`),
        fixedRouteBuildListEntryIds: list(c.fixedRouteBuildListEntryIds, `${path}.fixedRouteBuildListEntryIds`).map(id => text(id, 'fixed id')),
        reservation: reservationOf(c.reservation, `${path}.reservation`),
        excludedRouteKeySha256s: list(c.excludedRouteKeySha256s, `${path}.excludedRouteKeySha256s`).map(key => text(key, 'excluded key')),
        extent: extentOf(c.extent, `${path}.extent`), originDigest: text(c.originDigest, `${path}.originDigest`), contextDigest: text(c.contextDigest, `${path}.contextDigest`),
      }
    })
  })
  const nodeContexts = list(root.contexts, 'contexts').map((raw, i): Phase2C25BNodeContext => {
    const path = `contexts[${i}]`
    const c = record(raw, path)
    const growth = c.growth === null || c.growth === undefined ? null : record(record(c.growth, `${path}.growth`).lastSnapshot, `${path}.growth.lastSnapshot`)
    return {
      orientationId: text(c.orientationId, `${path}.orientationId`), workIndex: integer(c.workIndex, `${path}.workIndex`), targetWeaponId: text(c.targetWeaponId, `${path}.targetWeaponId`),
      classification: text(c.classification, `${path}.classification`), minimal: nodeModeOf(c.minimal, `${path}.minimal`), instrumented: nodeModeOf(c.instrumented, `${path}.instrumented`),
      lastSnapshot: growth === null ? null : {
        elapsedMs: numberOrNull(growth.elapsedMs, 'elapsedMs') ?? fail(`${path} lastSnapshot has no elapsedMs.`),
        heapUsed: numberOrNull(record(growth.memory, 'memory').heapUsed, 'heapUsed') ?? fail(`${path} lastSnapshot has no heapUsed.`),
        rss: numberOrNull(record(growth.memory, 'memory').rss, 'rss') ?? fail(`${path} lastSnapshot has no rss.`),
        gogmaMaxDepth: integer(record(growth.maxDepth, 'maxDepth').gogma, 'maxDepth.gogma'), skillMaxDepth: integer(record(growth.maxDepth, 'maxDepth').skill, 'maxDepth.skill'),
        cumulativeGogmaGenerated: integer(record(growth.cumulative, 'cumulative').totalGogmaGeneratedStates, 'totalGogmaGeneratedStates'),
        cumulativeGogmaFrontier: integer(record(growth.cumulative, 'cumulative').totalGogmaFrontierStates, 'totalGogmaFrontierStates'),
        settledWorkItems: integer(growth.settledWorkItems, 'settledWorkItems'),
      },
    }
  })
  for (const expected of expectedContexts.filter(c => c.status === 'searchable')) {
    if (!nodeContexts.some(n => n.orientationId === expected.orientationId && n.workIndex === expected.workIndex)) {
      fail(`searchable context ${expected.orientationId}#${expected.workIndex} has no Node result.`)
    }
  }
  return {
    measuredHead: text(provenance.measuredHead, 'provenance.measuredHead'), exportSha256: text(provenance.exportSha256, 'provenance.exportSha256'),
    searchExtent: extentOf(conditions.searchExtent, 'conditions.searchExtent'), candidateStopBound: integer(conditions.candidateStopBound, 'conditions.candidateStopBound'),
    researchMaxPlanSteps: integer(conditions.researchMaxPlanSteps, 'conditions.researchMaxPlanSteps'),
    childHeapLimitMb: numberOrNull(conditions.childHeapLimitMb, 'conditions.childHeapLimitMb'),
    calculationContext: record(conditions.calculationContext, 'conditions.calculationContext'),
    selection, baselineSummary: record(record(root.baseline, 'baseline').summary, 'baseline.summary'), expectedContexts, nodeContexts,
  }
}

// ---------------------------------------------------------------- workload

export interface Phase2C25BWorkloadContext {
  orientationId: string
  kind: ConflictKind
  role: Phase2C25BRole
  workIndex: number
  targetWeaponId: string
  contextDigest: string
}

/** Every searchable context of every selected orientation, in the evidence's selection order and work order. */
export function phase2c25bWorkload(view: Pick<Phase2C25BEvidenceView, 'expectedContexts'>): Phase2C25BWorkloadContext[] {
  return view.expectedContexts.filter(context => context.status === 'searchable')
    .map(context => ({ orientationId: context.orientationId, kind: context.kind, role: context.role, workIndex: context.workIndex,
      targetWeaponId: context.targetWeaponId, contextDigest: context.contextDigest }))
}

// ---------------------------------------------------------------- parity

function ranges(values: readonly number[]): [number, number][] {
  const out: [number, number][] = []
  for (const value of [...new Set(values)].sort((a, b) => a - b)) {
    const last = out.at(-1)
    if (last && value === last[1] + 1) last[1] = value
    else out.push([value, value])
  }
  return out
}

/** The Phase 2-C2.5-A analyzer's committed reservation form of a normalized reservation (same order, same ranges). */
export function phase2c25bRangeReservation(reservation: PlannerAlternativeReservation | null): Phase2C25BRangeReservation | null {
  if (reservation === null) return null
  return {
    normal: reservation.normal.map(n => ({ counterId: n.counterId as string, held: ranges(n.held), blocked: ranges(n.blocked) })),
    skill: { held: ranges(reservation.skill.held), blocked: ranges(reservation.skill.blocked) },
    gogma: { held: ranges(reservation.gogma.held), blocked: ranges(reservation.gogma.blocked) },
    exclusiveOwnedWeaponIds: [...reservation.exclusiveOwnedWeaponIds].map(id => id as string),
  }
}

export const PHASE2C25B_PARITY_CHECKS = ['orientation', 'kind', 'workIndex', 'targetWeaponId', 'status', 'invalidatedBuildListEntryId', 'invalidatedRouteKey',
  'fixedRouteBuildListEntryIds', 'reservation', 'excludedRouteKeys', 'extent', 'originDigest', 'contextDigest'] as const
export type Phase2C25BParityCheck = typeof PHASE2C25B_PARITY_CHECKS[number]

export interface Phase2C25BContextParityRow {
  orientationId: string
  workIndex: number
  checks: Record<Phase2C25BParityCheck, boolean>
  matches: boolean
}

export interface Phase2C25BParity {
  matches: boolean
  baselineSummary: boolean
  contextCounts: { orientationId: string; expected: number; derived: number; matches: boolean }[]
  rows: Phase2C25BContextParityRow[]
  mismatches: string[]
}

/**
 * The Browser-derived contexts of this page session against the contexts Phase 2-C2.5-A recorded: the baseline
 * summary, the context count of each selected orientation, and per context every recorded field (Route keys compared
 * as SHA-256, the reservation in the committed range form, the digests exactly). Any mismatch forbids a formal run.
 */
export async function comparePhase2C25BContextParity(view: Pick<Phase2C25BEvidenceView, 'baselineSummary' | 'expectedContexts' | 'selection'>,
  derived: Phase2C25BContextsResult, sha256: (text: string) => Promise<string>): Promise<Phase2C25BParity> {
  const mismatches: string[] = []
  const baselineSummary = stableStringify(derived.baseline.summary) === stableStringify(view.baselineSummary)
  if (!baselineSummary) mismatches.push('baseline summary')
  const contextCounts = view.selection.map(selected => {
    const expected = view.expectedContexts.filter(c => c.orientationId === selected.orientationId).length
    const derivedCount = derived.contexts[selected.orientationId]?.length ?? 0
    if (expected !== derivedCount) mismatches.push(`${selected.orientationId} context count ${derivedCount} != ${expected}`)
    return { orientationId: selected.orientationId, expected, derived: derivedCount, matches: expected === derivedCount }
  })
  const rows: Phase2C25BContextParityRow[] = []
  for (const expected of view.expectedContexts) {
    const orientation = derived.baseline.orientations.find(o => o.orientationId === expected.orientationId)
    const context: Phase2C25APreSearchContext | undefined = derived.contexts[expected.orientationId]?.find(c => c.workIndex === expected.workIndex)
    const checks = Object.fromEntries(PHASE2C25B_PARITY_CHECKS.map(check => [check, false])) as Record<Phase2C25BParityCheck, boolean>
    if (orientation && context) {
      checks.orientation = context.orientationId === expected.orientationId
      checks.kind = orientation.kind === expected.kind
      checks.workIndex = context.workIndex === expected.workIndex
      checks.targetWeaponId = context.targetWeaponId === expected.targetWeaponId
      checks.status = context.status === expected.status
      checks.invalidatedBuildListEntryId = context.invalidatedBuildListEntryId === expected.invalidatedBuildListEntryId
      checks.invalidatedRouteKey = await sha256(context.invalidatedRouteKey) === expected.invalidatedRouteKeySha256
      checks.fixedRouteBuildListEntryIds = stableStringify(context.fixedRouteBuildListEntryIds) === stableStringify(expected.fixedRouteBuildListEntryIds)
      checks.reservation = stableStringify(phase2c25bRangeReservation(context.reservation)) === stableStringify(expected.reservation)
      checks.excludedRouteKeys = stableStringify(await Promise.all(context.excludedRouteKeys.map(sha256))) === stableStringify(expected.excludedRouteKeySha256s)
      checks.extent = stableStringify(context.extent) === stableStringify(expected.extent)
      checks.originDigest = context.originDigest === expected.originDigest
      checks.contextDigest = context.contextDigest === expected.contextDigest
    }
    const matches = Object.values(checks).every(Boolean)
    if (!matches) mismatches.push(`${expected.orientationId}#${expected.workIndex}: ${Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name).join(', ')}`)
    rows.push({ orientationId: expected.orientationId, workIndex: expected.workIndex, checks, matches })
  }
  return { matches: mismatches.length === 0, baselineSummary, contextCounts, rows, mismatches }
}
