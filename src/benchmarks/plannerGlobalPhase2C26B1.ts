/**
 * Issue #154 Phase 2-C2.6-B1: the default-extent Candidate portfolio of the CURRENT Production, rebuilt from the Conflict
 * orientations WITHOUT depending on kernel completion. Research only. Never import from Production.
 *
 * Phase 2-C2 searched a Target's portfolio only after its orientation's kernel had completed, so a kernel OOM / timeout
 * left the Target's Search context unmeasured. B1 takes the pre-Search context of every orientation directly from the
 * existing Research authority `derivePhase2C25APreSearchContexts()` (the kernel's own preparation, the Planner reservation
 * authority `derivePlannerAlternativeReservation()`, the invalidated Route key as the only exclusion, the Production default
 * extent), and runs `visitPlannerAlternativeCandidates()` alone on each, through the unchanged Phase 2-C2 Search-context
 * helper (`runPhase2C2SearchContext()`, capture bound `PHASE2C2_PORTFOLIO_CAPTURE_BOUND`). No kernel trial, no full Planner
 * run, no reservation re-implementation.
 *
 * Execution identity. The existing `contextDigest` hashes the context body INCLUDING its provenance (`orientationId`,
 * `workIndex`), so it never matches across orientations. B1 dedups Search executions by `searchInputDigest`: the same body
 * hash WITHOUT those two provenance fields (Target, invalidated Entry / Route key, fixed Route set, both reservation forms,
 * excluded Route keys, extent, origin digest, status). Two contexts share one Search only when all of that is equal; every
 * orientation / work alias stays recorded as provenance.
 *
 * The A10 RESULT is the parity authority (baseline, orientations, completed kernel records). Nothing here selects a
 * combination of Candidates, judges a Planner conflict or reads the oracle; no orientation ID, Target ID, Entry ID or
 * Conflict key is fixed in this module.
 */
import { hashStableValue, stableStringify } from '../domain/models/publicTypes'
import type { PlannerDependencies, PlannerInput } from '../domain/planner/plannerTypes'
import type { RngEngine } from '../domain/rng/rngEngine'
import { defaultPlannerAlternativeSearchExtent } from '../domain/search'
import {
  buildPhase2C2Portfolio,
  classifyPhase2C2ChildExit,
  runPhase2C2SearchContext,
  PHASE2C2_PORTFOLIO_CAPTURE_BOUND,
  type Phase2C2BaselineRecord,
  type Phase2C2BaselineSummary,
  type Phase2C2ChildOutcome,
  type Phase2C2Orientation,
  type Phase2C2SearchContextRecord,
  type Phase2C2SearchStatus,
  type Phase2C2TargetPortfolio,
} from './plannerGlobalPhase2C2'
import { derivePhase2C25APreSearchContexts, type Phase2C25APreparedOrientation, type Phase2C25APreSearchContext } from './plannerGlobalPhase2C25A'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
/** Stable equality of untrusted values; a missing (undefined) or unserializable value never equals a present one. */
const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}

// ---------------------------------------------------------------- Research execution conditions (not Production defaults)

/** The Research capture bound per Search context: the existing Phase 2-C2 constant, reused unchanged. */
export const PHASE2C26B1_CAPTURE_BOUND = PHASE2C2_PORTFOLIO_CAPTURE_BOUND
export const PHASE2C26B1_EXTENT_LABEL = 'default' as const
export const PHASE2C26B1_NODE_YIELD = 'setImmediate' as const
export const PHASE2C26B1_MEMORY_SAMPLE_INTERVAL_MS = 250
/** The contexts child (baseline + every orientation's pre-Search contexts). */
export const PHASE2C26B1_CONTEXTS_BUDGET_MS = 30 * 60 * 1000

export type Phase2C26B1ExecutionClass = 'stage1' | 'coverage_fallback'

/** Stage 1: every unique searchable context once, as the Phase 2-C2 portfolio Search boundary. */
export const PHASE2C26B1_STAGE1 = { executionClass: 'stage1', childHeapMb: 8192, concurrency: 3, budgetMs: 10 * 60 * 1000, retry: 'none' } as const
/**
 * Coverage fallback (registered before the formal run): only for a Conflict participant with no completed Stage 1 Search
 * context, one deterministically chosen context per participant, run once (no retry), alone (concurrency 1), 30 minutes.
 * Same Search input, same default extent, same capture bound: its Candidates join the portfolio with this class recorded.
 */
export const PHASE2C26B1_FALLBACK = { executionClass: 'coverage_fallback', childHeapMb: 8192, concurrency: 1, budgetMs: 30 * 60 * 1000, maxContextsPerParticipant: 1, retry: 'none' } as const
/** What a Search child deliberately does not attach. */
export const PHASE2C26B1_NOT_ATTACHED = ['cpu_profiler', 'no_inlining_diagnostic', 'search_section_observer', 'reserved_depth_observer', 'kernel_lifecycle_observer', 'counting_rng_engine', 'kernel_trial', 'full_planner_rerun'] as const

// ---------------------------------------------------------------- the A10 RESULT (parity authority)

/** The A10 result this phase is registered against. */
export const PHASE2C26B1_REGISTERED_A10 = { decisionCase: 'R1_improved_timeouts_remain', orientations: 54 } as const

const CHILD_OUTCOMES: readonly Phase2C2ChildOutcome[] = ['completed', 'out_of_memory', 'timeout', 'process_failure']

export interface Phase2C26B1A10SearchSummary {
  deliveredCandidates: number
  excludedCandidates: number
  exhausted: boolean
  stoppedByExtent: boolean
  stoppedByConsumer: boolean
}

export interface Phase2C26B1A10KernelTarget {
  targetWeaponId: string
  outcome: string
  searched: boolean
  search: Phase2C26B1A10SearchSummary | null
  trials: { candidateKeySha256: string; result: string; reason: string | null; generatedSelected: boolean | null }[]
  foundKeySha256: string | null
}

export interface Phase2C26B1A10Row {
  orientationId: string
  childOutcome: Phase2C2ChildOutcome
  /** Recorded kernel Targets in the kernel's order; empty unless the child and its kernel completed. */
  kernelCompleted: boolean
  targets: Phase2C26B1A10KernelTarget[]
}

export interface Phase2C26B1A10Authority {
  measuredHead: string
  analysisHead: string
  exportSha256: string
  /** The A9 RESULT SHA-256 the A10 RESULT recorded (authority chain only). */
  a9ResultSha256: string
  conditions: { extent: unknown; bounds: unknown; researchMaxPlanSteps: number; calculationContext: unknown }
  baseline: Phase2C2BaselineSummary
  orientations: Phase2C2Orientation[]
  rows: Phase2C26B1A10Row[]
  childStatus: Record<Phase2C2ChildOutcome, number>
}

export interface Phase2C26B1A10AuthorityParse { valid: boolean; issues: string[]; authority: Phase2C26B1A10Authority | null }

function parseSearch(value: unknown): Phase2C26B1A10SearchSummary | null | 'malformed' {
  if (value === null) return null
  if (!isObject(value)) return 'malformed'
  const { deliveredCandidates, excludedCandidates, exhausted, stoppedByExtent, stoppedByConsumer } = value
  if (typeof deliveredCandidates !== 'number' || typeof excludedCandidates !== 'number' || typeof exhausted !== 'boolean' || typeof stoppedByExtent !== 'boolean' || typeof stoppedByConsumer !== 'boolean') return 'malformed'
  return { deliveredCandidates, excludedCandidates, exhausted, stoppedByExtent, stoppedByConsumer }
}

/**
 * Reads the committed A10 RESULT as untrusted JSON and fails closed unless it is the registered formal result: formal,
 * no calculation change after its measured HEAD, valid formal run / comparability, case R1, the registered orientation
 * count, per-orientation rows covering the orientation list exactly once with the recorded child status counts, and a
 * readable kernel Target record (Target, outcome, search summary, trial key SHA-256s) for every completed kernel.
 */
export function parsePhase2C26B1A10Authority(json: unknown): Phase2C26B1A10AuthorityParse {
  const issues: string[] = []
  const fail = (message: string): Phase2C26B1A10AuthorityParse => ({ valid: false, issues: [...issues, message], authority: null })
  if (!isObject(json)) return fail('A10 RESULT is not an object')
  const provenance = isObject(json.provenance) ? json.provenance : null
  const conditions = isObject(json.conditions) ? json.conditions : null
  const baseline = isObject(json.baseline) && isObject(json.baseline.summary) ? json.baseline.summary : null
  const kernel = isObject(json.kernel) ? json.kernel : null
  const decision = isObject(json.decision) ? json.decision : null
  const conclusion = isObject(json.conclusion) ? json.conclusion : null
  if (!provenance || !conditions || !baseline || !kernel || !decision || !conclusion) return fail('A10 RESULT lacks provenance / conditions / baseline.summary / kernel / decision / conclusion')
  if (provenance.formal !== true) issues.push('provenance.formal is not true')
  if (!Array.isArray(provenance.calculationCodeChangedSinceMeasuredHead) || provenance.calculationCodeChangedSinceMeasuredHead.length !== 0) issues.push('provenance.calculationCodeChangedSinceMeasuredHead is not empty')
  if (!isObject(json.formalRunValidation) || json.formalRunValidation.valid !== true) issues.push('formalRunValidation.valid is not true')
  if (!isObject(json.comparability) || json.comparability.valid !== true) issues.push('comparability.valid is not true')
  const expected = PHASE2C26B1_REGISTERED_A10
  if (decision.case !== expected.decisionCase) issues.push(`decision.case ${String(decision.case)} is not ${expected.decisionCase}`)
  if (conclusion.case !== expected.decisionCase) issues.push(`conclusion.case ${String(conclusion.case)} is not ${expected.decisionCase}`)
  if (kernel.orientations !== expected.orientations) issues.push(`kernel.orientations ${String(kernel.orientations)} is not ${expected.orientations}`)
  for (const field of ['measuredHead', 'analysisHead'] as const) {
    if (typeof provenance[field] !== 'string' || !/^[0-9a-f]{40}$/.test(provenance[field] as string)) issues.push(`provenance.${field} is not a commit SHA`)
  }
  if (typeof provenance.exportSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(provenance.exportSha256)) issues.push('provenance.exportSha256 is not a SHA-256')
  if (typeof provenance.a9ResultSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(provenance.a9ResultSha256)) issues.push('provenance.a9ResultSha256 is not a SHA-256')
  if (!isObject(conditions.extent) || !isObject(conditions.bounds) || !isObject(conditions.calculationContext)) issues.push('conditions.extent / bounds / calculationContext missing')
  if (typeof conditions.researchMaxPlanSteps !== 'number') issues.push('conditions.researchMaxPlanSteps missing')

  const orientations = asArray(json.orientations) as Phase2C2Orientation[]
  if (orientations.length !== expected.orientations) issues.push(`orientations has ${orientations.length} entries, not ${expected.orientations}`)
  if (new Set(orientations.map(o => o?.orientationId)).size !== orientations.length) issues.push('orientations holds a duplicate orientation ID')
  const byId = new Map<string, Phase2C26B1A10Row>()
  for (const raw of asArray(json.perOrientation)) {
    if (!isObject(raw) || typeof raw.orientationId !== 'string' || !isObject(raw.child) || typeof raw.child.outcome !== 'string') { issues.push('a perOrientation row is malformed'); continue }
    const orientationId = raw.orientationId
    if (byId.has(orientationId)) { issues.push(`perOrientation duplicates ${orientationId}`); continue }
    const orientation = orientations.find(o => o.orientationId === orientationId)
    if (!orientation) { issues.push(`perOrientation ${orientationId} is not an orientation of the RESULT`); continue }
    for (const field of ['conflictIndex', 'conflictKey', 'kind', 'fixedBuildListEntryId', 'fixedTargetWeaponId', 'participantTargetWeaponIds'] as const) {
      if (!same(raw[field], orientation[field])) issues.push(`perOrientation ${orientationId}.${field} differs from orientations`)
    }
    const childOutcome = raw.child.outcome as Phase2C2ChildOutcome
    if (!CHILD_OUTCOMES.includes(childOutcome)) { issues.push(`perOrientation ${orientationId} has an unknown child outcome ${childOutcome}`); continue }
    const kernelRecord = isObject(raw.kernel) ? raw.kernel : null
    const kernelCompleted = childOutcome === 'completed' && kernelRecord?.status === 'completed'
    if (childOutcome === 'completed' && !kernelCompleted) issues.push(`perOrientation ${orientationId}: a completed child without a completed kernel record`)
    const targets: Phase2C26B1A10KernelTarget[] = []
    if (kernelCompleted) {
      for (const rawTarget of asArray(kernelRecord!.targets)) {
        if (!isObject(rawTarget) || typeof rawTarget.targetWeaponId !== 'string' || typeof rawTarget.outcome !== 'string' || typeof rawTarget.searched !== 'boolean') {
          issues.push(`perOrientation ${orientationId}: a kernel Target is malformed`); continue
        }
        const search = parseSearch(rawTarget.search ?? null)
        if (search === 'malformed') { issues.push(`perOrientation ${orientationId}/${rawTarget.targetWeaponId}: the search summary is malformed`); continue }
        const trials: Phase2C26B1A10KernelTarget['trials'] = []
        for (const trial of asArray(rawTarget.trials)) {
          if (!isObject(trial) || typeof trial.candidateKeySha256 !== 'string' || typeof trial.result !== 'string') { issues.push(`perOrientation ${orientationId}/${rawTarget.targetWeaponId}: a trial is malformed`); continue }
          trials.push({ candidateKeySha256: trial.candidateKeySha256, result: trial.result, reason: typeof trial.reason === 'string' ? trial.reason : null,
            generatedSelected: typeof trial.generatedSelected === 'boolean' ? trial.generatedSelected : null })
        }
        const found = isObject(rawTarget.found) ? rawTarget.found : null
        targets.push({ targetWeaponId: rawTarget.targetWeaponId, outcome: rawTarget.outcome, searched: rawTarget.searched, search, trials,
          foundKeySha256: found && typeof found.stableKeySha256 === 'string' ? found.stableKeySha256 : null })
      }
      if (targets.length === 0) issues.push(`perOrientation ${orientationId}: a completed kernel records no Target`)
    }
    byId.set(orientationId, { orientationId, childOutcome, kernelCompleted, targets })
  }
  for (const orientation of orientations) if (!byId.has(orientation.orientationId)) issues.push(`no perOrientation row for ${orientation.orientationId}`)
  const childStatus = Object.fromEntries(CHILD_OUTCOMES.map(outcome => [outcome, 0])) as Record<Phase2C2ChildOutcome, number>
  for (const row of byId.values()) childStatus[row.childOutcome] += 1
  const recorded = isObject(kernel.childStatus) ? kernel.childStatus : {}
  for (const outcome of CHILD_OUTCOMES) if (recorded[outcome] !== childStatus[outcome]) issues.push(`kernel.childStatus.${outcome} ${String(recorded[outcome])} is not the ${childStatus[outcome]} perOrientation rows`)
  if (issues.length > 0) return { valid: false, issues, authority: null }
  return {
    valid: true, issues: [],
    authority: {
      measuredHead: String(provenance.measuredHead), analysisHead: String(provenance.analysisHead), exportSha256: String(provenance.exportSha256),
      a9ResultSha256: String(provenance.a9ResultSha256),
      conditions: { extent: conditions.extent, bounds: conditions.bounds, researchMaxPlanSteps: conditions.researchMaxPlanSteps as number, calculationContext: conditions.calculationContext },
      baseline: baseline as unknown as Phase2C2BaselineSummary,
      orientations,
      rows: orientations.map(o => byId.get(o.orientationId)!),
      childStatus,
    },
  }
}

// ---------------------------------------------------------------- baseline / orientation / condition parity

/** The baseline fields this phase must reproduce exactly (the registered B1 parity list). */
export const PHASE2C26B1_BASELINE_FIELDS = ['planningTargetCount', 'completedTargetCount', 'termination', 'planSteps', 'conflicts', 'conflictsByKind', 'selectedTargets', 'conflictSignatures'] as const
/** Every orientation field, compared in the authority's order. */
export const PHASE2C26B1_ORIENTATION_FIELDS = ['orientationId', 'conflictIndex', 'conflictKey', 'kind', 'participantBuildListEntryIds', 'participantTargetWeaponIds', 'fixedBuildListEntryId', 'fixedTargetWeaponId'] as const

export interface Phase2C26B1BaselineParity {
  valid: boolean
  issues: string[]
  exportSha256Matches: boolean
  baselineChecks: { field: string; matches: boolean }[]
  orderedOrientationIdsMatch: boolean
  orientationCount: { current: number; authority: number }
  orientationMismatches: { orientationId: string; fields: string[] }[]
}

/** This run's own baseline and orientations against the A10 authority, field by field and in order. Never fills a field in. */
export function validatePhase2C26B1BaselineParity(current: { exportSha256: string; summary: Phase2C2BaselineSummary; orientations: readonly Phase2C2Orientation[] },
  authority: Pick<Phase2C26B1A10Authority, 'exportSha256' | 'baseline' | 'orientations'>): Phase2C26B1BaselineParity {
  const exportSha256Matches = current.exportSha256 === authority.exportSha256
  const baselineChecks = PHASE2C26B1_BASELINE_FIELDS.map(field => ({ field, matches: field === 'selectedTargets' || field === 'conflictSignatures'
    ? same([...(current.summary[field] ?? [])].sort(), [...(authority.baseline[field] ?? [])].sort()) : same(current.summary[field], authority.baseline[field]) }))
  const orderedOrientationIdsMatch = same(current.orientations.map(o => o.orientationId), authority.orientations.map(o => o.orientationId))
  const orientationMismatches: Phase2C26B1BaselineParity['orientationMismatches'] = []
  const length = Math.max(current.orientations.length, authority.orientations.length)
  for (let index = 0; index < length; index += 1) {
    const now = current.orientations[index], recorded = authority.orientations[index]
    if (!now || !recorded) { orientationMismatches.push({ orientationId: (now ?? recorded).orientationId, fields: ['missing'] }); continue }
    const fields = PHASE2C26B1_ORIENTATION_FIELDS.filter(field => !same(now[field], recorded[field]))
    if (fields.length > 0) orientationMismatches.push({ orientationId: recorded.orientationId, fields })
  }
  const issues: string[] = []
  if (!exportSha256Matches) issues.push('Export SHA-256 differs from the A10 Export')
  for (const check of baselineChecks) if (!check.matches) issues.push(`baseline.${check.field} differs`)
  if (!orderedOrientationIdsMatch) issues.push('ordered orientation IDs differ')
  if (orientationMismatches.length > 0) issues.push(`orientation fields differ: ${orientationMismatches.map(m => `${m.orientationId}(${m.fields.join('/')})`).join(', ')}`)
  return { valid: issues.length === 0, issues, exportSha256Matches, baselineChecks, orderedOrientationIdsMatch,
    orientationCount: { current: current.orientations.length, authority: authority.orientations.length }, orientationMismatches }
}

export interface Phase2C26B1ConditionParity { valid: boolean; issues: string[]; checks: { field: string; current: unknown; authority: unknown; matches: boolean }[] }

/** The Search conditions must be the A10 ones: the Production default extent, CalculationContext and Research maxPlanSteps. */
export function validatePhase2C26B1ConditionParity(current: { extent: unknown; calculationContext: unknown; researchMaxPlanSteps: number },
  authority: Pick<Phase2C26B1A10Authority, 'conditions'>): Phase2C26B1ConditionParity {
  const checks = [
    { field: 'extent', current: current.extent, authority: authority.conditions.extent },
    { field: 'productionDefaultExtent', current: { ...defaultPlannerAlternativeSearchExtent }, authority: authority.conditions.extent },
    { field: 'calculationContext', current: current.calculationContext, authority: authority.conditions.calculationContext },
    { field: 'researchMaxPlanSteps', current: current.researchMaxPlanSteps, authority: authority.conditions.researchMaxPlanSteps },
  ].map(check => ({ ...check, matches: same(check.current, check.authority) }))
  const issues = checks.filter(check => !check.matches).map(check => `${check.field} differs from A10`)
  return { valid: issues.length === 0, issues, checks }
}

// ---------------------------------------------------------------- pre-Search contexts

export interface Phase2C26B1Context extends Phase2C25APreSearchContext {
  /** The context body without its provenance (`orientationId`, `workIndex`): the Search execution identity. */
  searchInputDigest: string
}

/** The semantic body of a pre-Search context without provenance: exactly what the Search (and its materializer) reads. */
export function phase2c26b1SearchInputBody(context: Phase2C25APreSearchContext) {
  return {
    targetWeaponId: context.targetWeaponId, status: context.status, invalidatedBuildListEntryId: context.invalidatedBuildListEntryId, invalidatedRouteKey: context.invalidatedRouteKey,
    fixedRouteBuildListEntryIds: context.fixedRouteBuildListEntryIds, reservation: context.reservation, searchReservation: context.searchReservation,
    excludedRouteKeys: context.excludedRouteKeys, extent: context.extent, originDigest: context.originDigest,
  }
}

export function phase2c26b1SearchInputDigest(context: Phase2C25APreSearchContext): string {
  return hashStableValue(phase2c26b1SearchInputBody(context))
}

export function withPhase2C26B1SearchInputDigest(context: Phase2C25APreSearchContext): Phase2C26B1Context {
  return { ...context, searchInputDigest: phase2c26b1SearchInputDigest(context) }
}

/**
 * Every orientation's pre-Search contexts through the unchanged `derivePhase2C25APreSearchContexts()`, in the baseline's
 * orientation order and the kernel's work order. Blocked works are kept (status `blocked_by_selected_checkpoint`).
 */
export function derivePhase2C26B1Contexts(input: PlannerInput, orientations: readonly Phase2C2Orientation[], dependencies: () => PlannerDependencies): Phase2C26B1Context[] {
  return orientations.flatMap(orientation => derivePhase2C25APreSearchContexts(input, orientation, dependencies()).contexts.map(withPhase2C26B1SearchInputDigest))
}

export interface Phase2C26B1ContextAlias { orientationId: string; workIndex: number; contextDigest: string }

export interface Phase2C26B1SearchTask {
  taskId: string
  searchInputDigest: string
  targetWeaponId: string
  /** The first alias in orientation / work order: the orientation whose preparation the child re-derives. */
  representative: Phase2C26B1ContextAlias
  /** Every orientation / work this one Search stands for (the representative first). */
  aliases: Phase2C26B1ContextAlias[]
}

export interface Phase2C26B1TaskPlan {
  derived: number
  searchable: number
  blocked: { orientationId: string; workIndex: number; targetWeaponId: string }[]
  uniqueSearchInputs: number
  dedupSavedRuns: number
  tasks: Phase2C26B1SearchTask[]
}

/**
 * One Search task per distinct searchable `searchInputDigest`, in first-occurrence order. A group is formed only when
 * every alias's whole semantic body is equal (never a different Target, reservation or exclusion); blocked contexts are
 * recorded and never searched.
 */
export function planPhase2C26B1SearchTasks(contexts: readonly Phase2C26B1Context[]): Phase2C26B1TaskPlan {
  const groups = new Map<string, { body: string; target: string; aliases: Phase2C26B1ContextAlias[] }>()
  const blocked: Phase2C26B1TaskPlan['blocked'] = []
  let searchable = 0
  for (const context of contexts) {
    if (context.searchInputDigest !== phase2c26b1SearchInputDigest(context)) throw new Error(`Context ${context.orientationId}#${context.workIndex}: searchInputDigest is not its body digest.`)
    if (context.status === 'blocked_by_selected_checkpoint') {
      blocked.push({ orientationId: context.orientationId, workIndex: context.workIndex, targetWeaponId: context.targetWeaponId })
      continue
    }
    if (context.searchReservation === null || context.reservation === null) throw new Error(`Searchable context ${context.orientationId}#${context.workIndex} has no reservation.`)
    searchable += 1
    const body = stableStringify(phase2c26b1SearchInputBody(context))
    const alias = { orientationId: context.orientationId, workIndex: context.workIndex, contextDigest: context.contextDigest }
    const group = groups.get(context.searchInputDigest)
    if (group) {
      if (group.body !== body) throw new Error(`Two contexts share searchInputDigest ${context.searchInputDigest} with different bodies.`)
      group.aliases.push(alias)
    } else {
      groups.set(context.searchInputDigest, { body, target: context.targetWeaponId, aliases: [alias] })
    }
  }
  const tasks = [...groups.entries()].map(([searchInputDigest, group], index): Phase2C26B1SearchTask => ({
    taskId: `s${String(index).padStart(3, '0')}`, searchInputDigest, targetWeaponId: group.target, representative: group.aliases[0], aliases: group.aliases,
  }))
  return { derived: contexts.length, searchable, blocked, uniqueSearchInputs: tasks.length, dedupSavedRuns: searchable - tasks.length, tasks }
}

// ---------------------------------------------------------------- context parity with the A10 completed kernels

export interface Phase2C26B1ContextParityRow {
  orientationId: string
  /** Ordered kernel Target IDs equal the ordered context Target IDs. */
  targetOrderMatches: boolean
  targets: { targetWeaponId: string; checks: { searchedMatchesStatus: boolean; extentMatches: boolean } }[]
}

export interface Phase2C26B1ContextParity {
  valid: boolean
  issues: string[]
  comparedOrientations: number
  comparedTargets: number
  /** Context fields the A10 RESULT does not record: never inferred, never compared. */
  notComparableFields: string[]
  rows: Phase2C26B1ContextParityRow[]
}

export const PHASE2C26B1_A10_NOT_COMPARABLE_CONTEXT_FIELDS = ['invalidatedBuildListEntryId', 'invalidatedRouteKey', 'fixedRouteBuildListEntryIds', 'reservation', 'excludedRouteKeys', 'originDigest'] as const

/**
 * For every orientation whose A10 kernel completed: the derived contexts name the same Targets in the same order, a
 * Target is searched exactly when its context is searchable (a kernel Target that is neither searched nor blocked would
 * be a rerun-bound stop, which B1 cannot reproduce and reports as a mismatch), and the context extent is the A10 extent.
 */
export function comparePhase2C26B1ContextsWithA10(contexts: readonly Phase2C25APreSearchContext[], authority: Pick<Phase2C26B1A10Authority, 'rows' | 'conditions'>): Phase2C26B1ContextParity {
  const issues: string[] = []
  const rows: Phase2C26B1ContextParityRow[] = []
  let comparedTargets = 0
  for (const row of authority.rows) {
    if (!row.kernelCompleted) continue
    const own = contexts.filter(context => context.orientationId === row.orientationId).sort((a, b) => a.workIndex - b.workIndex)
    const targetOrderMatches = same(own.map(c => c.targetWeaponId), row.targets.map(t => t.targetWeaponId))
    if (!targetOrderMatches) issues.push(`${row.orientationId}: the kernel Targets differ from the derived contexts`)
    const targets = row.targets.map(target => {
      const context = own.find(c => c.targetWeaponId === target.targetWeaponId)
      comparedTargets += 1
      const searchedMatchesStatus = context !== undefined && (target.searched ? context.status === 'searchable' : context.status === 'blocked_by_selected_checkpoint' && target.outcome === 'blocked_by_selected_checkpoint')
      const extentMatches = context !== undefined && same(context.extent, authority.conditions.extent)
      if (!searchedMatchesStatus) issues.push(`${row.orientationId}/${target.targetWeaponId}: the kernel searched=${target.searched} (${target.outcome}) is not the context status ${context?.status ?? 'missing'}`)
      if (!extentMatches) issues.push(`${row.orientationId}/${target.targetWeaponId}: the context extent is not the A10 extent`)
      return { targetWeaponId: target.targetWeaponId, checks: { searchedMatchesStatus, extentMatches } }
    })
    rows.push({ orientationId: row.orientationId, targetOrderMatches, targets })
  }
  return { valid: issues.length === 0, issues, comparedOrientations: rows.length, comparedTargets, notComparableFields: [...PHASE2C26B1_A10_NOT_COMPARABLE_CONTEXT_FIELDS], rows }
}

// ---------------------------------------------------------------- one Search task (child calculation)

export interface Phase2C26B1SearchTaskInput {
  taskId: string
  executionClass: Phase2C26B1ExecutionClass
  orientation: Phase2C2Orientation
  workIndex: number
  targetWeaponId: string
  contextDigest: string
  searchInputDigest: string
  captureBound: number
}

export type Phase2C26B1SearchChildRecord =
  | { status: 'searched'; taskId: string; executionClass: Phase2C26B1ExecutionClass; searchInputDigest: string; context: Phase2C2SearchContextRecord }
  /** The re-derived context is not the one the contexts child derived: a semantic failure, never a Candidate count. */
  | { status: 'context_mismatch'; taskId: string; executionClass: Phase2C26B1ExecutionClass; expected: { contextDigest: string; searchInputDigest: string; targetWeaponId: string };
    actual: { contextDigest: string | null; searchInputDigest: string | null; targetWeaponId: string | null } }

/**
 * The Search of one task: the re-derived representative context (it must be exactly the one planned), searched by the
 * unchanged Phase 2-C2 Search-context helper with the context's own Search reservation (the form the kernel passes),
 * excluded Route keys and extent, consumer stop at `captureBound`. No kernel trial is marked here.
 */
export async function runPhase2C26B1SearchTask(input: PlannerInput, prepared: Phase2C25APreparedOrientation, task: Phase2C26B1SearchTaskInput, engine: RngEngine,
  options: { yieldControl?: () => Promise<void>; now?: () => number } = {}): Promise<Phase2C26B1SearchChildRecord> {
  if (task.captureBound !== PHASE2C26B1_CAPTURE_BOUND) throw new Error(`The B1 capture bound is ${PHASE2C26B1_CAPTURE_BOUND}, not ${task.captureBound}.`)
  const raw = prepared.contexts[task.workIndex]
  const context = raw === undefined ? null : withPhase2C26B1SearchInputDigest(raw)
  if (context === null || context.contextDigest !== task.contextDigest || context.searchInputDigest !== task.searchInputDigest || context.targetWeaponId !== task.targetWeaponId
    || context.orientationId !== task.orientation.orientationId) {
    return { status: 'context_mismatch', taskId: task.taskId, executionClass: task.executionClass,
      expected: { contextDigest: task.contextDigest, searchInputDigest: task.searchInputDigest, targetWeaponId: task.targetWeaponId },
      actual: { contextDigest: context?.contextDigest ?? null, searchInputDigest: context?.searchInputDigest ?? null, targetWeaponId: context?.targetWeaponId ?? null } }
  }
  if (context.status !== 'searchable' || context.searchReservation === null) throw new Error(`Task ${task.taskId} names a context the kernel does not search.`)
  const record = await runPhase2C2SearchContext({
    input, origin: prepared.prepared.scenario.origin, orientation: task.orientation, targetWeaponId: context.targetWeaponId,
    extent: { ...context.extent }, extentLabel: PHASE2C26B1_EXTENT_LABEL, reservation: context.searchReservation, excludedRouteKeys: context.excludedRouteKeys,
    fixedRouteBuildListEntryIds: context.fixedRouteBuildListEntryIds, captureBound: task.captureBound,
  }, engine, options)
  return { status: 'searched', taskId: task.taskId, executionClass: task.executionClass, searchInputDigest: task.searchInputDigest, context: record }
}

export function phase2c26b1TaskInput(task: Phase2C26B1SearchTask, orientations: readonly Phase2C2Orientation[], executionClass: Phase2C26B1ExecutionClass): Phase2C26B1SearchTaskInput {
  const orientation = orientations.find(o => o.orientationId === task.representative.orientationId)
  if (!orientation) throw new Error(`Task ${task.taskId}: no orientation ${task.representative.orientationId}.`)
  return { taskId: task.taskId, executionClass, orientation, workIndex: task.representative.workIndex, targetWeaponId: task.targetWeaponId,
    contextDigest: task.representative.contextDigest, searchInputDigest: task.searchInputDigest, captureBound: PHASE2C26B1_CAPTURE_BOUND }
}

// ---------------------------------------------------------------- task outcomes and participant coverage

export interface Phase2C26B1TaskOutcome {
  taskId: string
  executionClass: Phase2C26B1ExecutionClass
  process: Phase2C2ChildOutcome
  /** `searched` only for a completed child that wrote a Search record; a timeout / OOM / failure is never a Candidate count. */
  record: 'searched' | 'context_mismatch' | null
  searchStatus: Phase2C2SearchStatus | null
  delivered: number | null
}

export function phase2c26b1TaskOutcome(taskId: string, executionClass: Phase2C26B1ExecutionClass, process: Phase2C2ChildOutcome, record: Phase2C26B1SearchChildRecord | null): Phase2C26B1TaskOutcome {
  if (process !== 'completed' || record === null) return { taskId, executionClass, process: process === 'completed' ? 'process_failure' : process, record: null, searchStatus: null, delivered: null }
  if (record.status === 'context_mismatch') return { taskId, executionClass, process, record: 'context_mismatch', searchStatus: null, delivered: null }
  return { taskId, executionClass, process, record: 'searched', searchStatus: record.context.status, delivered: record.context.summary.deliveredCandidates }
}

/** A Search context ended normally: a consumer stop, an extent stop or exhaustion (Candidate 0 included). */
export function phase2c26b1Completed(outcome: Phase2C26B1TaskOutcome): boolean {
  return outcome.process === 'completed' && outcome.record === 'searched' && outcome.searchStatus !== null
}

export interface Phase2C26B1FallbackSelection {
  targetWeaponId: string
  taskId: string
  /** The selected context (orientation order, then work order, then context digest). */
  orientationId: string
  workIndex: number
  contextDigest: string
}

/**
 * The registered coverage fallback: for each Conflict participant with no completed Stage 1 Search context, the first of
 * its searchable contexts by baseline orientation order, work index and context digest; its task runs once. Participants
 * with a completed Stage 1 context get nothing; a participant without any searchable context is reported, not guessed.
 */
export function selectPhase2C26B1Fallback(participants: readonly string[], orientations: readonly Phase2C2Orientation[], contexts: readonly Phase2C26B1Context[],
  tasks: readonly Phase2C26B1SearchTask[], stage1: readonly Phase2C26B1TaskOutcome[]): { selections: Phase2C26B1FallbackSelection[]; noSearchableContext: string[] } {
  const orientationIndex = new Map(orientations.map((o, index) => [o.orientationId, index]))
  const taskByDigest = new Map(tasks.map(task => [task.searchInputDigest, task]))
  const completedTargets = new Set(stage1.filter(phase2c26b1Completed).map(outcome => tasks.find(task => task.taskId === outcome.taskId)!.targetWeaponId))
  const ordered = [...contexts].filter(c => c.status === 'searchable').sort((a, b) =>
    (orientationIndex.get(a.orientationId)! - orientationIndex.get(b.orientationId)!) || (a.workIndex - b.workIndex) || (a.contextDigest < b.contextDigest ? -1 : a.contextDigest > b.contextDigest ? 1 : 0))
  if (ordered.some(c => !orientationIndex.has(c.orientationId))) throw new Error('A context names an orientation outside the baseline.')
  const selections: Phase2C26B1FallbackSelection[] = []
  const noSearchableContext: string[] = []
  for (const targetWeaponId of [...new Set(participants)].sort()) {
    if (completedTargets.has(targetWeaponId)) continue
    const first = ordered.find(c => c.targetWeaponId === targetWeaponId)
    if (!first) { noSearchableContext.push(targetWeaponId); continue }
    const task = taskByDigest.get(first.searchInputDigest)
    if (!task) throw new Error(`No task for the context ${first.orientationId}#${first.workIndex}.`)
    selections.push({ targetWeaponId, taskId: task.taskId, orientationId: first.orientationId, workIndex: first.workIndex, contextDigest: first.contextDigest })
  }
  if (new Set(selections.map(s => s.taskId)).size !== selections.length) throw new Error('Two fallback participants select one task.')
  selections.sort((a, b) => (orientationIndex.get(a.orientationId)! - orientationIndex.get(b.orientationId)!) || (a.workIndex - b.workIndex))
  return { selections, noSearchableContext }
}

export interface Phase2C26B1ParticipantRow {
  targetWeaponId: string
  contexts: number
  tasks: number
  stage1: Record<string, number>
  fallback: Record<string, number>
  explored: boolean
  exploredBy: Phase2C26B1ExecutionClass | null
  /** Why an unexplored participant stays unexplored (its failed outcomes), never "no Candidate". */
  unexploredBy: string[]
}

export interface Phase2C26B1ParticipantCoverage {
  total: number
  explored: number
  unexplored: string[]
  exploredInStage1: number
  newlyExploredByFallback: string[]
  /** Unexplored participants with at least one out-of-memory or process-failure outcome. */
  unexploredWithOomOrFailure: string[]
  rows: Phase2C26B1ParticipantRow[]
}

/** Explored = at least one Search context of that Target ended normally (Candidate 0 included); failures only = unexplored. */
export function phase2c26b1ParticipantCoverage(participants: readonly string[], contexts: readonly Phase2C26B1Context[], tasks: readonly Phase2C26B1SearchTask[],
  stage1: readonly Phase2C26B1TaskOutcome[], fallback: readonly Phase2C26B1TaskOutcome[]): Phase2C26B1ParticipantCoverage {
  const targetOf = new Map(tasks.map(task => [task.taskId, task.targetWeaponId]))
  const label = (outcome: Phase2C26B1TaskOutcome) => phase2c26b1Completed(outcome) ? `completed:${outcome.searchStatus}` : outcome.record === 'context_mismatch' ? 'context_mismatch' : outcome.process
  const countFor = (list: readonly Phase2C26B1TaskOutcome[], target: string) => {
    const out: Record<string, number> = {}
    for (const outcome of list) if (targetOf.get(outcome.taskId) === target) out[label(outcome)] = (out[label(outcome)] ?? 0) + 1
    return out
  }
  const rows = [...new Set(participants)].sort().map((targetWeaponId): Phase2C26B1ParticipantRow => {
    const inStage1 = stage1.some(o => targetOf.get(o.taskId) === targetWeaponId && phase2c26b1Completed(o))
    const inFallback = fallback.some(o => targetOf.get(o.taskId) === targetWeaponId && phase2c26b1Completed(o))
    const failures = [...stage1, ...fallback].filter(o => targetOf.get(o.taskId) === targetWeaponId && !phase2c26b1Completed(o)).map(label)
    const explored = inStage1 || inFallback
    return { targetWeaponId, contexts: contexts.filter(c => c.targetWeaponId === targetWeaponId && c.status === 'searchable').length,
      tasks: tasks.filter(t => t.targetWeaponId === targetWeaponId).length, stage1: countFor(stage1, targetWeaponId), fallback: countFor(fallback, targetWeaponId),
      explored, exploredBy: inStage1 ? 'stage1' : inFallback ? 'coverage_fallback' : null, unexploredBy: explored ? [] : [...new Set(failures)].sort() }
  })
  const unexplored = rows.filter(row => !row.explored).map(row => row.targetWeaponId)
  return {
    total: rows.length, explored: rows.length - unexplored.length, unexplored,
    exploredInStage1: rows.filter(row => row.exploredBy === 'stage1').length,
    newlyExploredByFallback: rows.filter(row => row.exploredBy === 'coverage_fallback').map(row => row.targetWeaponId),
    unexploredWithOomOrFailure: rows.filter(row => !row.explored && row.unexploredBy.some(reason => reason === 'out_of_memory' || reason === 'process_failure')).map(row => row.targetWeaponId),
    rows,
  }
}

// ---------------------------------------------------------------- portfolio

export interface Phase2C26B1SearchedTask { task: Phase2C26B1SearchTask; executionClass: Phase2C26B1ExecutionClass; context: Phase2C2SearchContextRecord }

/**
 * One Search context record per alias of every completed task (the same delivered Candidates, each alias's own orientation
 * as provenance), so the portfolio keeps every orientation / Target that observed a Candidate.
 */
export function expandPhase2C26B1Aliases(searched: readonly Phase2C26B1SearchedTask[], orientations: readonly Phase2C2Orientation[]): { contexts: Phase2C2SearchContextRecord[]; classByContextId: Map<string, { executionClass: Phase2C26B1ExecutionClass; taskId: string }> } {
  const byId = new Map(orientations.map(o => [o.orientationId, o]))
  const contexts: Phase2C2SearchContextRecord[] = []
  const classByContextId = new Map<string, { executionClass: Phase2C26B1ExecutionClass; taskId: string }>()
  for (const { task, executionClass, context } of searched) {
    if (context.targetWeaponId !== task.targetWeaponId) throw new Error(`Task ${task.taskId} recorded another Target.`)
    for (const alias of task.aliases) {
      const orientation = byId.get(alias.orientationId)
      if (!orientation) throw new Error(`Alias ${alias.orientationId} is not a baseline orientation.`)
      const contextId = `${alias.orientationId}:${task.targetWeaponId}:${PHASE2C26B1_EXTENT_LABEL}`
      if (classByContextId.has(contextId)) throw new Error(`Context ${contextId} is observed twice.`)
      classByContextId.set(contextId, { executionClass, taskId: task.taskId })
      contexts.push({ ...context, contextId, orientationId: alias.orientationId, conflictKey: orientation.conflictKey, kind: orientation.kind, fixedTargetWeaponId: orientation.fixedTargetWeaponId })
    }
  }
  return { contexts, classByContextId }
}

type Phase2C2PortfolioCandidateOf = Phase2C2TargetPortfolio['candidates'][number]
export type Phase2C26B1ProvenanceEntry = Phase2C2PortfolioCandidateOf['provenance'][number] & { executionClass: Phase2C26B1ExecutionClass; taskId: string }
export type Phase2C26B1PortfolioCandidate = Omit<Phase2C2PortfolioCandidateOf, 'provenance'> & { provenance: Phase2C26B1ProvenanceEntry[] }
export type Phase2C26B1TargetPortfolio = Omit<Phase2C2TargetPortfolio, 'candidates'> & { candidates: Phase2C26B1PortfolioCandidate[] }

/**
 * The per-Target portfolio: the unchanged Phase 2-C2 builder (original + every delivered alternative, deduplicated by
 * `candidateStableKey()` within the Target, all provenance kept), each provenance entry annotated with its execution class.
 */
export function buildPhase2C26B1Portfolio(baseline: Pick<Phase2C2BaselineRecord, 'originals' | 'orientations'>, searched: readonly Phase2C26B1SearchedTask[]): Phase2C26B1TargetPortfolio[] {
  const { contexts, classByContextId } = expandPhase2C26B1Aliases(searched, baseline.orientations)
  return buildPhase2C2Portfolio(baseline, contexts).map(target => ({
    ...target,
    candidates: target.candidates.map(candidate => ({
      ...candidate,
      provenance: candidate.provenance.map(entry => {
        const cls = classByContextId.get(entry.contextId)
        if (!cls) throw new Error(`Provenance ${entry.contextId} has no execution class.`)
        return { ...entry, ...cls }
      }),
    })),
  }))
}

// ---------------------------------------------------------------- child exit (unchanged Phase 2-C2 rule)

export const classifyPhase2C26B1ChildExit = classifyPhase2C2ChildExit
