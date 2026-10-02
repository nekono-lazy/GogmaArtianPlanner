/**
 * Issue #154 Phase 2-C2.6-B2-C2A: the scheduler-selected reservation contexts, actually searched. Research only. Never
 * import from Production.
 *
 * B2-C1 ordered every Target's semantic reservation contexts with four oracle-free lexicographic policies and, post hoc,
 * chose P1 (`default_simple_first`) as the Research candidate. B2-B2A / B2-B2A2 showed that an oracle-guided compatible
 * context publishes the oracle Route inside the current Planner Alternative Search sequence. B2-C2A removes the oracle
 * from the context choice and asks only:
 *
 * ```text
 * Export
 *   -> derivePhase2C26B2C1Schedule()              (unchanged B2-C1 calculation, P1 ranks)
 *   -> per validation Target: P1 rank 1..16       (mechanically, every rank, no early stop)
 *   -> reconstructPhase2C26B2B2AContext()         (unchanged: origin, reservation, excluded current Route, default extent)
 *   -> visitPlannerAlternativeCandidates()        (unchanged Production Search, Production default extent)
 *   -> capture: up to 4 distinct operation-cost cohorts, drained completely (the 5th cost is the sentinel, not captured),
 *               a natural Search end, or the Research safety cap of 1024 captured Candidates
 * ```
 *
 * Only the post-hoc analyzer compares the captured Candidates with the oracle Route, after every task ended. The Search
 * side receives the validation Target IDs (a population chosen post hoc in B2-C1, declared as such), the P1 rank, the
 * expected Production digests (to fail closed on a drift), the capture rule and the safety cap. It never receives an
 * oracle Route, an oracle Candidate key, an expected rank, an expected Candidate index, an expected operation cost or a
 * first-compatible context, and an oracle match never stops it: every Target is searched at every rank 1..16.
 */
import { hashStableValue, stableStringify } from '../domain/models/hashing'
import type { BuildListEntry } from '../domain/models/publicTypes'
import { createPlannerAlternativeMaterializer } from '../domain/planner/alternative'
import type { PlannerInput } from '../domain/planner/plannerTypes'
import { createPlannerStartSearchOrigin } from '../domain/planner/replacement/plannerSearchOrigin'
import type { RngEngine } from '../domain/rng/rngEngine'
import {
  candidateStableKey,
  compareConstrainedCandidates,
  defaultPlannerAlternativeSearchExtent,
  visitPlannerAlternativeCandidates,
  type PlannerAlternativeCandidate,
  type PlannerAlternativeSearchExtent,
} from '../domain/search'
import { preferredSourceRank } from '../domain/search/semanticKeys'
import { GLOBAL_RESEARCH_TIME } from './plannerGlobalOptimizationResearch'
import {
  phase2c2SearchStatus,
  respectsPhase2C2Reservation,
  summarizePhase2C2Entry,
  type Phase2C2ChildOutcome,
  type Phase2C2SearchStatus,
} from './plannerGlobalPhase2C2'
import { reconstructPhase2C26B2B2AContext, type Phase2C26B2B2AContext } from './plannerGlobalPhase2C26B2B2A'
import type { Phase2C26B2B2A2DeliveredCandidate } from './plannerGlobalPhase2C26B2B2A2'
import { PHASE2C26B2C1_POLICIES, type Phase2C26B2C1ContextRow, type Phase2C26B2C1Schedule } from './plannerGlobalPhase2C26B2C1'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0

// ---------------------------------------------------------------- Research execution conditions (registered, not Production defaults)

/** The P1 context budget per Target: ranks 1..16, every one searched. */
export const PHASE2C26B2C2A_CONTEXT_BUDGET = 16
/** The validation population size (B2-C1 post-hoc subgroup `defaultExtent`). */
export const PHASE2C26B2C2A_VALIDATION_TARGETS = 20
export const PHASE2C26B2C2A_EXPECTED_TASKS = PHASE2C26B2C2A_VALIDATION_TARGETS * PHASE2C26B2C2A_CONTEXT_BUDGET
/** Distinct `estimatedOperationCount` cohorts captured completely per context (the next distinct cost is the sentinel). */
export const PHASE2C26B2C2A_MAX_COST_COHORTS = 4
/**
 * Captured Candidates per context before the consumer stops without having drained four cohorts. A Research accident
 * guard only (never a Production capture bound): reaching it leaves the capture incomplete.
 */
export const PHASE2C26B2C2A_CANDIDATE_SAFETY_CAP = 1024
/** The virtual capture policies the analyzer compares, all cut from the one C4C capture (never three Searches). */
export const PHASE2C26B2C2A_CAPTURE_PREFIXES = { C8: 8, C32: 32 } as const
export const PHASE2C26B2C2A_EXTENT_LABEL = 'default' as const
export const PHASE2C26B2C2A_NODE_YIELD = 'setImmediate' as const
export const PHASE2C26B2C2A_MEMORY_SAMPLE_INTERVAL_MS = 250
/** The tasks child (schedule re-derivation + task construction, no Search). */
export const PHASE2C26B2C2A_TASKS_BUDGET_MS = 10 * 60 * 1000
/** Stage 1: every task once, fresh child, no retry and (in this Phase) no timeout fallback. */
export const PHASE2C26B2C2A_STAGE1 = { executionClass: 'stage1', childHeapMb: 8192, concurrency: 3, budgetMs: 10 * 60 * 1000, retry: 'none', fallback: 'none' } as const
/** What B2-C2A deliberately does not run. */
export const PHASE2C26B2C2A_NOT_RUN = ['production_change', 'search_algorithm_change', 'search_ordering_change', 'search_comparator_change', 'extent_default_change', 'per_target_extent',
  'production_capture_change', 'oracle_guided_context_selection', 'context_level_early_stop', 'timeout_fallback', 'retry', 'candidate_search', 'planner_alternative_kernel', 'candidate_trial',
  'full_planner_rerun', 'global_assignment', 'extent_insufficient_search', 'extent_probe', 'alternative_to_alternative_support', 'policy_change', 'ui_change', 'runtime_optimization'] as const

/**
 * An independent copy of the B2-C1 P1 policy. The schedule's recorded P1 and the module's `PHASE2C26B2C1_POLICIES` P1
 * must both equal it, or no task is built (a policy drift after B2-C1 registration).
 */
export const PHASE2C26B2C2A_REGISTERED_P1 = {
  id: 'P1', name: 'default_simple_first',
  keys: [['targetEligibleMinCardinality', 'asc'], ['exclusiveOwnedWeaponCount', 'asc'], ['blockedCountDefaultTotal', 'asc'], ['shareableHeldCountDefaultTotal', 'desc'], ['reservationDigest', 'asc']],
} as const

/** The B2-C1 RESULT the validation Target manifest must come from (the manifest records it; the Search never reads it). */
export const PHASE2C26B2C2A_TARGET_SOURCE = { resultSha256: '04904fafb93664ecfed5f3bd654b29d9c39029dde34aa88a59d1d11de8fc2bac', population: 'defaultExtent', policy: 'P1' } as const

/** The policy definition check: the schedule's P1, the module's P1 and the registered copy are one definition. */
export function phase2c26b2c2aPolicyDrift(schedule: Pick<Phase2C26B2C1Schedule, 'policies'>): string[] {
  const issues: string[] = []
  const recorded = schedule.policies.find(p => p.id === 'P1')
  const module = PHASE2C26B2C1_POLICIES.find(p => p.id === 'P1')
  if (!same(recorded, PHASE2C26B2C2A_REGISTERED_P1)) issues.push('the schedule P1 is not the registered P1 definition')
  if (!same(module, PHASE2C26B2C2A_REGISTERED_P1)) issues.push('PHASE2C26B2C1_POLICIES P1 is not the registered P1 definition')
  return issues
}

// ---------------------------------------------------------------- the validation Target manifest (a Search input)

/**
 * The validation population. It is produced before the run from the B2-C1 RESULT's post-hoc `defaultExtent` subgroup
 * (oracle-guided population, declared) and holds Target IDs only: no rank, digest, first-compatible context or oracle field.
 */
export interface Phase2C26B2C2ATargetManifest {
  phase: string
  sourceResultSha256: string
  population: 'defaultExtent'
  policy: 'P1'
  contextBudget: number
  /** The Export the B2-C1 RESULT was measured on (from that RESULT's provenance). */
  exportSha256: string
  targetWeaponIds: string[]
}

const MANIFEST_KEYS = ['contextBudget', 'exportSha256', 'phase', 'policy', 'population', 'sourceResultSha256', 'targetWeaponIds']

/**
 * Reads a validation Target manifest as untrusted JSON: exactly the manifest keys (nothing else - no rank, digest or
 * oracle field may ride along), the registered source RESULT, population and policy, the registered budget, and 20
 * distinct Target IDs in ascending order.
 */
export function parsePhase2C26B2C2ATargetManifest(json: unknown): { valid: boolean; issues: string[]; manifest: Phase2C26B2C2ATargetManifest | null } {
  const issues: string[] = []
  if (!isObject(json)) return { valid: false, issues: ['the Target manifest is not an object'], manifest: null }
  if (!same(Object.keys(json).sort(), MANIFEST_KEYS)) issues.push(`the Target manifest keys are not exactly ${MANIFEST_KEYS.join(', ')}`)
  if (json.sourceResultSha256 !== PHASE2C26B2C2A_TARGET_SOURCE.resultSha256) issues.push('sourceResultSha256 is not the registered B2-C1 RESULT')
  if (json.population !== PHASE2C26B2C2A_TARGET_SOURCE.population) issues.push('population is not defaultExtent')
  if (json.policy !== PHASE2C26B2C2A_TARGET_SOURCE.policy) issues.push('policy is not P1')
  if (json.contextBudget !== PHASE2C26B2C2A_CONTEXT_BUDGET) issues.push(`contextBudget is not ${PHASE2C26B2C2A_CONTEXT_BUDGET}`)
  if (typeof json.exportSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(json.exportSha256)) issues.push('exportSha256 is not a SHA-256')
  if (typeof json.phase !== 'string') issues.push('phase is not a string')
  const ids = Array.isArray(json.targetWeaponIds) ? json.targetWeaponIds : null
  if (!ids || !ids.every(id => typeof id === 'string' && id.length > 0)) issues.push('targetWeaponIds is not a list of IDs')
  else {
    if (ids.length !== PHASE2C26B2C2A_VALIDATION_TARGETS) issues.push(`targetWeaponIds holds ${ids.length} Targets, not ${PHASE2C26B2C2A_VALIDATION_TARGETS}`)
    if (new Set(ids).size !== ids.length) issues.push('targetWeaponIds repeats a Target')
    if (!same(ids, [...ids].sort(compare))) issues.push('targetWeaponIds is not in ascending order')
  }
  if (issues.length > 0) return { valid: false, issues, manifest: null }
  return { valid: true, issues: [], manifest: { phase: String(json.phase), sourceResultSha256: String(json.sourceResultSha256), population: 'defaultExtent', policy: 'P1',
    contextBudget: json.contextBudget as number, exportSha256: String(json.exportSha256), targetWeaponIds: (ids as string[]).map(String) } }
}

// ---------------------------------------------------------------- P1 top-16 task construction (oracle-free)

/** What a Search child receives. No oracle field exists here. */
export interface Phase2C26B2C2ATaskInput {
  taskId: string
  executionClass: 'stage1'
  targetWeaponId: string
  /** 1-based P1 rank of this context for this Target. */
  contextRank: number
  policy: 'P1'
  groupIndex: number
  reservationDigest: string
  targetEligibleMinCardinality: number
  /** Provenance only: the first eligible alias of that cardinality by ID (B2-C1). */
  representativeFixedSetId: string
  representativeFixedTargetWeaponIds: string[]
  searchInputDigest: string
  maxCostCohorts: number
  candidateSafetyCap: number
}

export interface Phase2C26B2C2ATaskConstruction {
  valid: boolean
  issues: string[]
  tasks: Phase2C26B2C2ATaskInput[]
}

const taskIdOf = (targetIndex: number, rank: number) => `t${String(targetIndex).padStart(2, '0')}-r${String(rank).padStart(2, '0')}`

/**
 * The schedule's P1 contexts of rank 1..budget of every validation Target, in manifest order then rank order, each rebuilt
 * into its Search context by the unchanged `reconstructPhase2C26B2B2AContext()`. Fails closed on a policy drift, a missing
 * / checkpoint Target, fewer than `budget` contexts, a rank that is not exactly 1..budget, a repeated digest, a context
 * the snapshot cannot rebuild or a task count other than targets x budget. Reads nothing but the schedule and the IDs.
 */
export function buildPhase2C26B2C2ATasks(schedule: Phase2C26B2C1Schedule, targetWeaponIds: readonly string[], budget: number = PHASE2C26B2C2A_CONTEXT_BUDGET): Phase2C26B2C2ATaskConstruction {
  const issues: string[] = [...phase2c26b2c2aPolicyDrift(schedule)]
  if (!Number.isSafeInteger(budget) || budget < 1) issues.push(`invalid context budget ${budget}`)
  if (!same(schedule.extent, { ...defaultPlannerAlternativeSearchExtent })) issues.push('the schedule extent is not the Production default extent')
  if (new Set(targetWeaponIds).size !== targetWeaponIds.length) issues.push('a validation Target repeats')
  const tasks: Phase2C26B2C2ATaskInput[] = []
  targetWeaponIds.forEach((targetWeaponId, targetIndex) => {
    const target = schedule.targets.find(t => t.targetWeaponId === targetWeaponId)
    if (!target) { issues.push(`${targetWeaponId}: not a schedule Target`); return }
    if (target.checkpointHardConstraint) { issues.push(`${targetWeaponId}: a checkpoint hard-constraint Target has no context`); return }
    const rows = schedule.contexts.filter(c => c.targetWeaponId === targetWeaponId).sort((a, b) => a.ranks.P1 - b.ranks.P1)
    if (rows.length < budget) { issues.push(`${targetWeaponId}: ${rows.length} contexts, fewer than the budget ${budget}`); return }
    const top = rows.slice(0, budget)
    if (!same(top.map(r => r.ranks.P1), Array.from({ length: budget }, (_, i) => i + 1))) { issues.push(`${targetWeaponId}: the P1 ranks 1..${budget} are missing or repeated`); return }
    if (new Set(top.map(r => r.reservationDigest)).size !== top.length) { issues.push(`${targetWeaponId}: a reservation digest repeats in the top ${budget}`); return }
    for (const row of top) {
      const rebuilt = reconstructPhase2C26B2B2AContext(schedule.snapshot, selectorOf(row))
      if (!rebuilt.valid) { issues.push(`${targetWeaponId} @ P1 rank ${row.ranks.P1}: ${rebuilt.issues.join('/')}`); continue }
      if (rebuilt.context.groupIndex !== row.groupIndex) { issues.push(`${targetWeaponId} @ P1 rank ${row.ranks.P1}: group drift`); continue }
      tasks.push({ taskId: taskIdOf(targetIndex, row.ranks.P1), executionClass: 'stage1', targetWeaponId, contextRank: row.ranks.P1, policy: 'P1', groupIndex: row.groupIndex,
        reservationDigest: row.reservationDigest, targetEligibleMinCardinality: row.targetEligibleMinCardinality, representativeFixedSetId: row.representativeFixedSetId,
        representativeFixedTargetWeaponIds: [...row.representativeFixedTargetWeaponIds], searchInputDigest: rebuilt.context.searchInputDigest,
        maxCostCohorts: PHASE2C26B2C2A_MAX_COST_COHORTS, candidateSafetyCap: PHASE2C26B2C2A_CANDIDATE_SAFETY_CAP })
    }
  })
  if (issues.length === 0 && tasks.length !== targetWeaponIds.length * budget) issues.push(`${tasks.length} tasks, not ${targetWeaponIds.length} x ${budget}`)
  if (new Set(tasks.map(t => t.taskId)).size !== tasks.length) issues.push('a task ID repeats')
  return { valid: issues.length === 0, issues, tasks: issues.length === 0 ? tasks : [] }
}

const selectorOf = (row: Pick<Phase2C26B2C1ContextRow, 'targetWeaponId' | 'representativeFixedSetId' | 'targetEligibleMinCardinality' | 'reservationDigest'>) =>
  ({ targetWeaponId: row.targetWeaponId, fixedSetId: row.representativeFixedSetId, cardinality: row.targetEligibleMinCardinality, reservationDigest: row.reservationDigest })

// ---------------------------------------------------------------- the cost-cohort capture (pure)

/** How the capture of one context ended. */
export type Phase2C26B2C2ATermination = 'four_cost_cohorts_drained' | 'candidate_safety_cap' | 'exhausted' | 'stopped_by_extent'

/**
 * The registered capture rule as a pure state machine. `offer(cost)` answers `capture` while the cost is one of the first
 * `maxCostCohorts` distinct costs delivered, and `sentinel` for the first Candidate of the next distinct cost (the cohorts
 * before it are complete because the Search never delivers a cheaper Candidate after a dearer one; a decrease is recorded
 * as a non-monotonic index for the analyzer to fail closed on). `full` is true once `safetyCap` Candidates were captured.
 */
export function createPhase2C26B2C2ACapture(maxCostCohorts: number, safetyCap: number) {
  if (!Number.isSafeInteger(maxCostCohorts) || maxCostCohorts < 1 || !Number.isSafeInteger(safetyCap) || safetyCap < 1) throw new RangeError('Invalid capture bounds.')
  const costs: number[] = []
  const nonmonotonicIndexes: number[] = []
  let captured = 0
  let last: number | null = null
  return {
    offer(cost: number, deliveryIndex: number): 'capture' | 'sentinel' {
      if (last !== null && cost < last) nonmonotonicIndexes.push(deliveryIndex)
      const fresh = !costs.includes(cost)
      if (fresh && costs.length === maxCostCohorts) return 'sentinel'
      if (fresh) costs.push(cost)
      last = cost
      captured += 1
      return 'capture'
    },
    get full(): boolean { return captured >= safetyCap },
    get capturedCosts(): number[] { return [...costs] },
    get nonmonotonicIndexes(): number[] { return [...nonmonotonicIndexes] },
  }
}

// ---------------------------------------------------------------- one Search task (child calculation)

export interface Phase2C26B2C2ASearchRecord {
  targetWeaponId: string
  contextRank: number
  groupIndex: number
  reservationDigest: string
  targetEligibleMinCardinality: number
  representativeFixedSetId: string
  representativeFixedTargetWeaponIds: string[]
  searchInputDigest: string
  extent: PlannerAlternativeSearchExtent
  excludedRouteKeys: string[]
  preferredOwnedWeaponId: string | null
  maxCostCohorts: number
  candidateSafetyCap: number
  status: Phase2C2SearchStatus
  summary: { deliveredCandidates: number; excludedCandidates: number; exhausted: boolean; stoppedByExtent: boolean; stoppedByConsumer: boolean }
  /** Every captured delivery, in delivery order (the sentinel is never one). */
  candidates: Phase2C26B2B2A2DeliveredCandidate[]
  /** The first delivery of the fifth distinct cost, or null. */
  nextCostSentinel: Phase2C26B2B2A2DeliveredCandidate | null
  termination: Phase2C26B2C2ATermination
  /** True for a sentinel or a natural Search end; a safety-cap stop never completes the capture. */
  captureComplete: boolean
  safetyCapHit: boolean
  /** The distinct captured costs, in delivery order. */
  capturedCosts: number[]
  distinctCostCohorts: number
  nonmonotonicIndexes: number[]
  /** `candidate.estimatedOperationCount` differs from the summary's (should never happen). */
  costReadIssues: number[]
  elapsedMs: number
}

/**
 * The capture of one context: `visitPlannerAlternativeCandidates()` with exactly the Planner-start origin, the context
 * reservation, the excluded current Route key and the Production default extent. The consumer stops at the sentinel or at
 * the safety cap; nothing else stops it (no oracle is known here). Each delivery is materialized by the Planner
 * Alternative materializer of this very context only to read its Route units (the Phase 2-C2 summary and reservation
 * check); its six ordering keys and the Search comparator against the previous delivery are recorded as read.
 */
export async function runPhase2C26B2C2ASearch(input: PlannerInput, context: Phase2C26B2B2AContext, engine: RngEngine, capture: { maxCostCohorts: number; candidateSafetyCap: number },
  provenance: { contextRank: number; targetEligibleMinCardinality: number; representativeFixedSetId: string; representativeFixedTargetWeaponIds: string[] },
  options: { yieldControl?: () => Promise<void>; now?: () => number } = {}): Promise<Phase2C26B2C2ASearchRecord> {
  if (capture.maxCostCohorts !== PHASE2C26B2C2A_MAX_COST_COHORTS) throw new Error(`The B2-C2A capture drains ${PHASE2C26B2C2A_MAX_COST_COHORTS} cost cohorts, not ${capture.maxCostCohorts}.`)
  if (capture.candidateSafetyCap !== PHASE2C26B2C2A_CANDIDATE_SAFETY_CAP) throw new Error(`The B2-C2A safety cap is ${PHASE2C26B2C2A_CANDIDATE_SAFETY_CAP}, not ${capture.candidateSafetyCap}.`)
  if (!same(context.extent, { ...defaultPlannerAlternativeSearchExtent })) throw new Error('B2-C2A searches the Production default extent only.')
  const now = options.now ?? (() => performance.now())
  const started = now()
  const origin = createPlannerStartSearchOrigin(input)
  if (hashStableValue(origin) !== context.originDigest) throw new Error('The Planner-start origin does not hash to the context origin digest.')
  const target = origin.targetWeapons.find(t => t.id === context.targetWeaponId)
  if (!target) throw new Error('The Planner-start origin does not hold the Target.')
  const preferredOwnedWeaponId = target.preferredOwnedWeaponId ?? null
  const searchInput = { origin, targetWeaponId: context.targetWeaponId as never, extent: { ...context.extent }, reservation: context.reservation, excludedRouteKeys: context.excludedRouteKeys }
  const materializer = createPlannerAlternativeMaterializer({ ...searchInput, clock: { now: () => GLOBAL_RESEARCH_TIME } })
  const machine = createPhase2C26B2C2ACapture(capture.maxCostCohorts, capture.candidateSafetyCap)
  const candidates: Phase2C26B2B2A2DeliveredCandidate[] = []
  const costReadIssues: number[] = []
  let nextCostSentinel: Phase2C26B2B2A2DeliveredCandidate | null = null
  let previous: PlannerAlternativeCandidate | null = null
  let safetyCapHit = false
  const execution = await visitPlannerAlternativeCandidates(searchInput, engine, (candidate: PlannerAlternativeCandidate) => {
    const deliveryIndex = candidates.length
    const entry: BuildListEntry = materializer.materializeBuildListEntry(candidate, []).entry
    const summary = summarizePhase2C2Entry(entry, input, engine)
    if (summary.estimatedOperationCount !== candidate.estimatedOperationCount) costReadIssues.push(deliveryIndex)
    const delivered: Phase2C26B2B2A2DeliveredCandidate = {
      deliveryIndex, stableKey: candidateStableKey(candidate),
      orderingKeys: { estimatedOperationCount: candidate.estimatedOperationCount, estimatedGogmaAdvance: candidate.estimatedGogmaAdvance, estimatedSkillAdvance: candidate.estimatedSkillAdvance,
        estimatedNormalAdvance: candidate.estimatedNormalAdvance, preferredSourceRank: preferredSourceRank(candidate.route.sourceOwnedWeaponId, preferredOwnedWeaponId) },
      comparatorWithPrevious: previous === null ? null : Math.sign(compareConstrainedCandidates(previous, candidate, preferredOwnedWeaponId)),
      summary, reservationCheck: respectsPhase2C2Reservation(summary, candidate.route, context.reservation),
    }
    previous = candidate
    if (machine.offer(candidate.estimatedOperationCount, deliveryIndex) === 'sentinel') {
      nextCostSentinel = delivered
      return 'stop'
    }
    candidates.push(delivered)
    if (machine.full) safetyCapHit = true
    return safetyCapHit ? 'stop' : 'continue'
  }, { yieldControl: options.yieldControl })
  const status = phase2c2SearchStatus(execution.summary, execution.stoppedByConsumer)
  const sentinel = nextCostSentinel as Phase2C26B2B2A2DeliveredCandidate | null
  const termination: Phase2C26B2C2ATermination = sentinel !== null ? 'four_cost_cohorts_drained' : safetyCapHit ? 'candidate_safety_cap' : status === 'stopped_by_extent' ? 'stopped_by_extent' : 'exhausted'
  if (status === 'consumer_stop' && termination !== 'four_cost_cohorts_drained' && termination !== 'candidate_safety_cap') throw new Error('A consumer stop without a sentinel or the safety cap.')
  return {
    targetWeaponId: context.targetWeaponId, contextRank: provenance.contextRank, groupIndex: context.groupIndex, reservationDigest: context.reservationDigest,
    targetEligibleMinCardinality: provenance.targetEligibleMinCardinality, representativeFixedSetId: provenance.representativeFixedSetId,
    representativeFixedTargetWeaponIds: [...provenance.representativeFixedTargetWeaponIds], searchInputDigest: context.searchInputDigest, extent: { ...context.extent },
    excludedRouteKeys: [...context.excludedRouteKeys], preferredOwnedWeaponId, maxCostCohorts: capture.maxCostCohorts, candidateSafetyCap: capture.candidateSafetyCap, status,
    summary: { deliveredCandidates: execution.summary.deliveredCandidates, excludedCandidates: execution.summary.excludedCandidates, exhausted: execution.summary.exhausted,
      stoppedByExtent: execution.summary.stoppedByExtent, stoppedByConsumer: execution.stoppedByConsumer },
    candidates, nextCostSentinel: sentinel, termination, captureComplete: termination !== 'candidate_safety_cap', safetyCapHit, capturedCosts: machine.capturedCosts,
    distinctCostCohorts: machine.capturedCosts.length, nonmonotonicIndexes: machine.nonmonotonicIndexes, costReadIssues, elapsedMs: now() - started,
  }
}

export type Phase2C26B2C2AChildRecord =
  | { status: 'searched'; taskId: string; search: Phase2C26B2C2ASearchRecord }
  /** The re-derived context is not the planned one: a semantic failure, never a Candidate count. */
  | { status: 'context_mismatch'; taskId: string; issues: string[] }

/**
 * The child calculation: the policy check, then the one schedule row of this Target at this P1 rank (from the child's own
 * re-derived schedule), compared with every task field; then the unchanged context reconstruction and the capture. Any
 * drift is a context mismatch and no Search runs.
 */
export async function runPhase2C26B2C2ATask(input: PlannerInput, schedule: Phase2C26B2C1Schedule, task: Phase2C26B2C2ATaskInput, engine: RngEngine,
  options: { yieldControl?: () => Promise<void>; now?: () => number } = {}): Promise<Phase2C26B2C2AChildRecord> {
  const issues: string[] = [...phase2c26b2c2aPolicyDrift(schedule)]
  if (task.policy !== 'P1') issues.push('policy')
  const rows = schedule.contexts.filter(c => c.targetWeaponId === task.targetWeaponId && c.ranks.P1 === task.contextRank)
  if (rows.length !== 1) issues.push(`P1 rank ${task.contextRank} holds ${rows.length} contexts`)
  const row = rows[0]
  if (row) {
    if (row.groupIndex !== task.groupIndex) issues.push('groupIndex')
    if (row.reservationDigest !== task.reservationDigest) issues.push('reservationDigest')
    if (row.targetEligibleMinCardinality !== task.targetEligibleMinCardinality) issues.push('targetEligibleMinCardinality')
    if (row.representativeFixedSetId !== task.representativeFixedSetId) issues.push('representativeFixedSetId')
    if (!same(row.representativeFixedTargetWeaponIds, task.representativeFixedTargetWeaponIds)) issues.push('representativeFixedTargetWeaponIds')
  }
  if (issues.length > 0 || !row) return { status: 'context_mismatch', taskId: task.taskId, issues }
  const rebuilt = reconstructPhase2C26B2B2AContext(schedule.snapshot, selectorOf(row))
  if (!rebuilt.valid) return { status: 'context_mismatch', taskId: task.taskId, issues: rebuilt.issues }
  if (rebuilt.context.searchInputDigest !== task.searchInputDigest) return { status: 'context_mismatch', taskId: task.taskId, issues: ['searchInputDigest'] }
  const search = await runPhase2C26B2C2ASearch(input, rebuilt.context, engine, { maxCostCohorts: task.maxCostCohorts, candidateSafetyCap: task.candidateSafetyCap },
    { contextRank: task.contextRank, targetEligibleMinCardinality: task.targetEligibleMinCardinality, representativeFixedSetId: task.representativeFixedSetId,
      representativeFixedTargetWeaponIds: task.representativeFixedTargetWeaponIds }, options)
  return { status: 'searched', taskId: task.taskId, search }
}

// ---------------------------------------------------------------- task outcomes

export interface Phase2C26B2C2ATaskOutcome {
  taskId: string
  process: Phase2C2ChildOutcome
  record: 'searched' | 'context_mismatch' | null
  searchStatus: Phase2C2SearchStatus | null
  termination: Phase2C26B2C2ATermination | null
  candidateCount: number | null
}

/** A timeout / out-of-memory / failure is that failure, never "no Candidate"; a completed child without a record is a failure. */
export function phase2c26b2c2aTaskOutcome(taskId: string, process: Phase2C2ChildOutcome, record: Phase2C26B2C2AChildRecord | null): Phase2C26B2C2ATaskOutcome {
  const none = { searchStatus: null, termination: null, candidateCount: null }
  if (process !== 'completed' || record === null) return { taskId, process: process === 'completed' ? 'process_failure' : process, record: null, ...none }
  if (record.status === 'context_mismatch') return { taskId, process, record: 'context_mismatch', ...none }
  return { taskId, process, record: 'searched', searchStatus: record.search.status, termination: record.search.termination, candidateCount: record.search.candidates.length }
}
