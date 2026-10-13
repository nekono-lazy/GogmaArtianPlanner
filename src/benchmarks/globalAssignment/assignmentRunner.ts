/**
 * Issue #154 Global Assignment Phase B-2A (Research only; never imported by the app).
 *
 * The assignment-only runner (`docs/PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md` 14 Phase B-2, 12,
 * `docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_B2A.md`): Phase 0 context -> Phase A ReachTable -> Phase B-1
 * resource assignment search, driven as one pure calculation over a PlannerInput and the given
 * `PlannerDependencies`, returning a plain-data record split into the **semantic** part (deterministic for
 * the same input, Engine and conditions: outcome, diagnostics, candidate snapshots, window decision) and
 * the **observed** part (stage timings, yields, thinned timelines). The process-level parts - Export
 * reading, SHA-256, memory sampling, wall-clock and heap envelopes, child processes - belong to the
 * runner script; this module reads no file, clock or random value (`now` is injected).
 *
 * It never calls the Production Planner, the Planner Alternative Search or Trace Replay, and it never
 * passes a `VerifiedUpperBound` to the solver (`upperBoundSupplied` is the literal `false`), so no
 * branch is pruned. The result is a set of resource assignments (C1 / C2 necessary conditions), not a
 * Production Plan; the record has no `verified` status and counts no "completed" Target.
 */
import { isTargetWeaponPlanningEligible } from '../../domain/models/domainRules'
import { hashStableValue } from '../../domain/models/publicTypes'
import type { PlannerDependencies, PlannerInput } from '../../domain/planner/plannerTypes'
import { createEmptyPartialAssignment } from './assignmentFeasibility'
import { createTargetStreamMenus, partialAssignmentLowerBound } from './assignmentLowerBound'
import { countFeasibleOptionsUpTo } from './assignmentOrdering'
import {
  ASSIGNMENT_B2A_PROTOCOL_VERSION, findNonPlainJsonPaths, snapshotResourceAssignment, validateAssignmentResearchConditions, validateWindowLadder,
  type AssignmentCandidateSnapshot, type AssignmentResearchConditions,
} from './assignmentProtocol'
import { createResourceAssignmentSearch } from './assignmentSolver'
import type { ExpandedNodeInfo, ResourceAssignmentCandidate, ResourceAssignmentSearchDiagnostics } from './assignmentTypes'
import { decideWindowTransition, type AssignmentStageOutcome, type WindowTransitionDecision } from './assignmentWindowPolicy'
import { createGlobalAssignmentContext } from './context'
import { takeReachOptions } from './reachOptions'
import { buildReachTable } from './reachTable'
import { replayReachOptionRequiredOnly } from './requiredOnlyReplay'
import { GlobalAssignmentInvariantError, REACH_OPTION_SET_A1, type GlobalAssignmentContext, type ReachTable, type ReachWindow, type TargetReach } from './types'

/** Per-Target option count saturation for the scan diagnostics (a count, never an enumeration of every option). */
export const ASSIGNMENT_OPTION_COUNT_CAP = 1_000
/** Expanded nodes kept individually in the semantic record; every node still enters `nodeTraceHash`. */
export const ASSIGNMENT_NODE_TRACE_LIMIT = 256
/** Distinct objectives listed with their counts. */
export const ASSIGNMENT_OBJECTIVE_COUNT_LIMIT = 50
const UNSUPPORTED_SAMPLE_LIMIT = 20
const TIMELINE_LIMIT = 200
const REPLAY_VIOLATION_LIMIT = 20

export interface AssignmentRunExecution {
  /** Monotonic milliseconds from the script's clock; the module reads no clock of its own. */
  now: () => number
  /** The existing Research cancel / yield seam (ReachTable positions, solver nodes). */
  shouldCancel?: () => boolean
  yieldControl?: () => Promise<void>
  /** Forwarded from the solver, once per expanded node. */
  onNodeExpanded?: (node: ExpandedNodeInfo) => void
}

export interface AssignmentRunRequest {
  conditions: AssignmentResearchConditions
  /** The registered ladder (design 10.3); `conditions.window` must be `windowLadder[rungIndex]`. */
  windowLadder: readonly ReachWindow[]
  rungIndex: number
  /** Required-only replay (design 5.3) of the snapshotted candidates' options; default true. */
  replaySnapshots?: boolean
}

export interface AssignmentInputSummary {
  plannerInputValid: boolean
  validationIssueCount: number
  /** Phase 0 (design 4.1): eligible Targets with a valid BuildListEntry; the denominator of every later statement. */
  planningTargetCount: number
  targetWeaponCount: number
  planningEligibleTargetCount: number
  buildListEntryCount: number
  validEntryCount: number
  excludedEntryCount: number
  excludedEntryReasons: Record<string, number>
  ownedWeaponCount: number
  normalCounterCount: number
  confirmedNormalCounterCount: number
  rngEngineVersion: string
  calculationContext: PlannerInput['calculationContext']
}

export interface AssignmentTargetDiagnostics {
  targetWeaponId: TargetReach['targetWeaponId']
  weaponTypeId: TargetReach['weaponTypeId']
  elementId: TargetReach['elementId']
  priority: number
  normalCounterId: TargetReach['normalCounterId']
  support: TargetReach['support']
  sources: { owned_gogma: number; owned_normal: number; new_normal: number }
  excludedOwnedWeapons: Record<string, number>
  skill: { idealPositionCount: number; firstIdealPosition: number | null; resetSkillsLimit: number; conversionLimit: number }
  bonus: { resetIdealPositionCount: number; firstResetIdealPosition: number | null; keepLayoutCount: number; keepIdealPositionCount: number; keepUnsupportedLayoutCount: number }
  /** Reach options counted up to `ASSIGNMENT_OPTION_COUNT_CAP` (saturated). */
  optionsUpToCap: number
  /** The MRV count at the empty partial assignment (`countUpTo(mrvLookahead)`), measured outside the solver. */
  rootMrvCount: number
}

export interface AssignmentScanDiagnostics {
  origins: { skill: number; gogma: number; normal: Record<string, number> }
  scanned: ReachTable['scanned']
  predictions: ReachTable['summary']['predictions']
  memoHits: ReachTable['summary']['memoHits']
  supportQueries: number
  groups: { weaponTypeId: string; elementId: string; targetCount: number; keepLayoutCount: number }[]
  unsupported: { total: number; byPrediction: Record<string, number>; sample: ReachTable['summary']['unsupported'] }
  sourceCounts: { owned_gogma: number; owned_normal: number; new_normal: number; total: number }
  excludedOwnedWeapons: Record<string, number>
  targetsWithoutOption: TargetReach['targetWeaponId'][]
  optionCountCap: number
  perTarget: AssignmentTargetDiagnostics[]
}

export interface AssignmentSolverDiagnostics {
  nodeBudget: number
  mrvLookahead: number
  candidateLimit: number
  /** The literal false: an assignment-only run reads no `VerifiedUpperBound`, so nothing is pruned. */
  upperBoundSupplied: false
  diagnostics: ResourceAssignmentSearchDiagnostics
  /** `LB(empty)` of design 10.1 inside this window (the solver's own admissible bound; not the design 10.2 root bound). */
  windowLocalRootBound: number | null
  nodeTrace: ExpandedNodeInfo[]
  nodeTraceLimit: number
  nodeTraceLength: number
  /** `hashStableValue` folded over every expanded node in order (deterministic; compares two runs' node sequences). */
  nodeTraceHash: string
}

export interface AssignmentCandidateDiagnostics {
  nature: 'resource_assignment_only'
  generated: number
  /** The objective of every collected candidate in generation order (bounded by `candidateLimit`). */
  objectives: number[]
  firstObjective: number | null
  bestObjective: number | null
  bestOrdinal: number | null
  distinctObjectiveCount: number
  /** Ascending objective, at most `ASSIGNMENT_OBJECTIVE_COUNT_LIMIT` rows. */
  objectiveCounts: { objective: number; count: number }[]
  bestStreamEnd: ResourceAssignmentCandidate['streamEnd'] | null
  snapshotLimit: number
  snapshots: AssignmentCandidateSnapshot[]
}

export interface AssignmentReplayDiagnostics {
  status: 'passed' | 'invariant_violation' | 'skipped'
  candidatesReplayed: number
  optionsReplayed: number
  predictions: { skill: number; gogmaReset: number; gogmaKeep: number; normal: number }
  violations: { ordinal: number; targetWeaponId: string; code: string; message: string }[]
}

export interface AssignmentSemanticRecord {
  protocolVersion: string
  conditions: AssignmentResearchConditions
  windowLadder: ReachWindow[]
  rungIndex: number
  window: ReachWindow
  input: AssignmentInputSummary
  context: { status: 'context' } | { status: 'unsupported_input'; reason: string; detail: string }
  reachTable: { status: 'reach_table' } | { status: 'unsupported_input'; reason: string; detail: string } | { status: 'cancelled' } | { status: 'not_reached' }
  scan: AssignmentScanDiagnostics | null
  solver: AssignmentSolverDiagnostics | null
  candidates: AssignmentCandidateDiagnostics | null
  replay: AssignmentReplayDiagnostics | null
  outcome: AssignmentStageOutcome
  windowTransition: WindowTransitionDecision
  /** Research-internal inconsistencies found while recording (a replay invariant violation, a non-plain value); `[]` is the normal case. */
  integrityIssues: string[]
  oracleFreeExecution: true
}

export interface AssignmentObservedRecord {
  elapsedMs: {
    context: number
    reachTable: number | null
    solverConstruction: number | null
    /** The saturated per-Target option count (`ASSIGNMENT_OPTION_COUNT_CAP`), a diagnostics walk outside the solver. */
    optionCount: number | null
    /** The root MRV count over every planning Target, measured directly with the solver's own count function. */
    rootMrvCount: number | null
    windowLocalRootBound: number | null
    toFirstCandidate: number | null
    solver: number | null
    replay: number | null
    total: number
  }
  yields: number
  /** Thinned (node count, ms) samples of the solver loop, at most `TIMELINE_LIMIT`. */
  nodeTimeline: { nodes: number; atMs: number }[]
  candidateTimeline: { ordinal: number; atMs: number }[]
}

export interface AssignmentRunResult {
  semantic: AssignmentSemanticRecord
  observed: AssignmentObservedRecord
}

/** Keeps at most `limit` samples, halving the kept density whenever the limit is reached (the series stays thinned, never grows). */
class ThinnedSeries<T> {
  private readonly values: T[] = []
  private keepEvery = 1
  private offered = 0
  private readonly limit: number

  constructor(limit: number) {
    this.limit = limit
  }

  offer(value: T): void {
    this.offered += 1
    if ((this.offered - 1) % this.keepEvery !== 0) return
    this.values.push(value)
    if (this.values.length >= this.limit) {
      this.keepEvery *= 2
      for (let index = this.values.length - 1; index >= 0; index -= 1) if (index % 2 === 1) this.values.splice(index, 1)
    }
  }

  toArray(): T[] {
    return [...this.values]
  }
}

function countBy<T>(values: readonly T[], key: (value: T) => string): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const value of values) counts[key(value)] = (counts[key(value)] ?? 0) + 1
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)))
}

function summarizeInput(input: PlannerInput, context: ReturnType<typeof createGlobalAssignmentContext>, dependencies: PlannerDependencies): AssignmentInputSummary {
  const validation = context.kind === 'context' ? context.context.validation : context.validation
  const eligible = input.targetWeapons.filter(isTargetWeaponPlanningEligible).length
  return {
    plannerInputValid: validation.isValid, validationIssueCount: validation.issues.length,
    planningTargetCount: context.kind === 'context' ? context.context.planningTargets.length : 0,
    targetWeaponCount: input.targetWeapons.length, planningEligibleTargetCount: eligible,
    buildListEntryCount: input.buildListEntries.length, validEntryCount: validation.validBuildListEntries.length,
    excludedEntryCount: validation.excludedBuildListEntries.length, excludedEntryReasons: countBy(validation.excludedBuildListEntries, excluded => excluded.reason),
    ownedWeaponCount: input.ownedWeapons.length, normalCounterCount: input.normalCounters.length,
    confirmedNormalCounterCount: input.normalCounters.filter(counter => counter.isConfirmed && counter.counter !== null).length,
    rngEngineVersion: dependencies.rngEngine.version, calculationContext: { ...input.calculationContext },
  }
}

function summarizeScan(table: ReachTable, context: GlobalAssignmentContext, mrvLookahead: number, now: () => number): { scan: AssignmentScanDiagnostics; optionCountMs: number; rootMrvCountMs: number } {
  const priorityById = new Map(context.planningTargets.map(target => [target.id, target.priority]))
  const empty = createEmptyPartialAssignment(table)
  // The two diagnostic walks are timed apart: the saturated option count (Phase A enumeration) and the root MRV count (the solver's own count function).
  let optionCountMs = 0
  let rootMrvCountMs = 0
  const sourceCounts = { owned_gogma: 0, owned_normal: 0, new_normal: 0, total: 0 }
  const excludedAll: TargetReach['excludedOwnedWeapons'] = []
  const targetsWithoutOption: TargetReach['targetWeaponId'][] = []
  const perTarget: AssignmentTargetDiagnostics[] = table.targets.map(target => {
    const sources = { owned_gogma: 0, owned_normal: 0, new_normal: 0 }
    for (const source of target.sources) sources[source.kind] += 1
    sourceCounts.owned_gogma += sources.owned_gogma
    sourceCounts.owned_normal += sources.owned_normal
    sourceCounts.new_normal += sources.new_normal
    sourceCounts.total += target.sources.length
    excludedAll.push(...target.excludedOwnedWeapons)
    const optionCountStarted = now()
    const optionsUpToCap = takeReachOptions(target, table, ASSIGNMENT_OPTION_COUNT_CAP).length
    optionCountMs += now() - optionCountStarted
    if (optionsUpToCap === 0) targetsWithoutOption.push(target.targetWeaponId)
    const mrvStarted = now()
    const rootMrvCount = countFeasibleOptionsUpTo(target, table, empty, mrvLookahead).count
    rootMrvCountMs += now() - mrvStarted
    let keepIdealPositionCount = 0
    for (const positions of target.bonus.keepIdealPositionsByLayout.values()) keepIdealPositionCount += positions.length
    return {
      targetWeaponId: target.targetWeaponId, weaponTypeId: target.weaponTypeId, elementId: target.elementId, priority: priorityById.get(target.targetWeaponId) ?? 0,
      normalCounterId: target.normalCounterId, support: { ...target.support }, sources, excludedOwnedWeapons: countBy(target.excludedOwnedWeapons, excluded => excluded.reason),
      skill: { idealPositionCount: target.skill.idealPositions.length, firstIdealPosition: target.skill.idealPositions[0] ?? null, resetSkillsLimit: target.skill.resetSkillsLimit, conversionLimit: target.skill.conversionLimit },
      bonus: { resetIdealPositionCount: target.bonus.resetIdealPositions.length, firstResetIdealPosition: target.bonus.resetIdealPositions[0] ?? null,
        keepLayoutCount: target.bonus.keepIdealPositionsByLayout.size, keepIdealPositionCount, keepUnsupportedLayoutCount: target.bonus.keepUnsupportedLayouts.length },
      optionsUpToCap, rootMrvCount,
    }
  })
  const scan: AssignmentScanDiagnostics = {
    origins: { skill: table.originSkill, gogma: table.originGogma, normal: { ...table.originNormal } },
    scanned: structuredClone(table.scanned),
    predictions: { ...table.summary.predictions }, memoHits: { ...table.summary.memoHits }, supportQueries: table.summary.supportQueries,
    groups: table.summary.groups.map(group => ({ weaponTypeId: group.weaponTypeId, elementId: group.elementId, targetCount: group.targetWeaponIds.length, keepLayoutCount: group.keepLayoutsOfInterest.length })),
    unsupported: { total: table.summary.unsupported.length, byPrediction: countBy(table.summary.unsupported, entry => entry.prediction), sample: structuredClone(table.summary.unsupported.slice(0, UNSUPPORTED_SAMPLE_LIMIT)) },
    sourceCounts, excludedOwnedWeapons: countBy(excludedAll, excluded => excluded.reason), targetsWithoutOption, optionCountCap: ASSIGNMENT_OPTION_COUNT_CAP, perTarget,
  }
  return { scan, optionCountMs, rootMrvCountMs }
}

function summarizeCandidates(objectives: readonly number[], best: { ordinal: number; objective: number; streamEnd: ResourceAssignmentCandidate['streamEnd'] } | null,
  snapshots: readonly ResourceAssignmentCandidate[], snapshotLimit: number): AssignmentCandidateDiagnostics {
  const counts = new Map<number, number>()
  for (const objective of objectives) counts.set(objective, (counts.get(objective) ?? 0) + 1)
  const objectiveCounts = [...counts].sort(([left], [right]) => left - right).slice(0, ASSIGNMENT_OBJECTIVE_COUNT_LIMIT).map(([objective, count]) => ({ objective, count }))
  return {
    nature: 'resource_assignment_only', generated: objectives.length, objectives: [...objectives], firstObjective: objectives[0] ?? null,
    bestObjective: best?.objective ?? null, bestOrdinal: best?.ordinal ?? null, distinctObjectiveCount: counts.size, objectiveCounts,
    bestStreamEnd: best === null ? null : { skill: best.streamEnd.skill, gogma: best.streamEnd.gogma, normal: { ...best.streamEnd.normal } },
    snapshotLimit, snapshots: snapshots.map(snapshotResourceAssignment),
  }
}

/** Required-only replay (design 5.3) of every chosen option of the snapshotted candidates; stops at the first invariant violation (fail closed). */
function replaySnapshots(snapshots: readonly ResourceAssignmentCandidate[], context: GlobalAssignmentContext, dependencies: PlannerDependencies): AssignmentReplayDiagnostics {
  const predictions = { skill: 0, gogmaReset: 0, gogmaKeep: 0, normal: 0 }
  const violations: AssignmentReplayDiagnostics['violations'] = []
  let candidatesReplayed = 0
  let optionsReplayed = 0
  for (const candidate of snapshots) {
    for (const option of candidate.chosen.values()) {
      try {
        const replayed = replayReachOptionRequiredOnly(option, context, dependencies.rngEngine)
        optionsReplayed += 1
        for (const kind of ['skill', 'gogmaReset', 'gogmaKeep', 'normal'] as const) predictions[kind] += replayed.predictions[kind]
      } catch (error) {
        if (!(error instanceof GlobalAssignmentInvariantError)) throw error
        if (violations.length < REPLAY_VIOLATION_LIMIT) violations.push({ ordinal: candidate.ordinal, targetWeaponId: option.targetWeaponId, code: error.code, message: error.message })
        return { status: 'invariant_violation', candidatesReplayed, optionsReplayed, predictions, violations }
      }
    }
    candidatesReplayed += 1
  }
  return { status: 'passed', candidatesReplayed, optionsReplayed, predictions, violations }
}

function assertRequest(request: AssignmentRunRequest): void {
  const issues = [...validateAssignmentResearchConditions(request.conditions), ...validateWindowLadder(request.windowLadder)]
  if (issues.length > 0) throw new RangeError(`Invalid assignment run request: ${issues.join(' ')}`)
  if (!Number.isSafeInteger(request.rungIndex) || request.rungIndex < 0 || request.rungIndex >= request.windowLadder.length) {
    throw new RangeError(`rungIndex ${String(request.rungIndex)} is outside the ladder (0..${request.windowLadder.length - 1}).`)
  }
  const rung = request.windowLadder[request.rungIndex]!
  const window = request.conditions.window
  if (rung.normal !== window.normal || rung.gogma !== window.gogma || rung.skill !== window.skill) {
    throw new RangeError(`conditions.window ${JSON.stringify(window)} is not windowLadder[${request.rungIndex}] ${JSON.stringify(rung)}.`)
  }
}

/**
 * Runs Phase 0 -> Phase A -> Phase B-1 over `plannerInput` with `dependencies.rngEngine` under the
 * request's conditions. Async only for the Research yield / cancel seam; the semantic record is
 * deterministic for the same input, Engine and conditions.
 */
export async function runAssignmentOnly(plannerInput: PlannerInput, dependencies: PlannerDependencies, request: AssignmentRunRequest,
  execution: AssignmentRunExecution): Promise<AssignmentRunResult> {
  assertRequest(request)
  const { conditions } = request
  const now = execution.now
  const started = now()
  let yields = 0
  const yieldControl = async () => { if (execution.yieldControl) { yields += 1; await execution.yieldControl() } }
  const windowLadder = request.windowLadder.map(rung => ({ ...rung }))
  const base = {
    protocolVersion: ASSIGNMENT_B2A_PROTOCOL_VERSION, conditions: structuredClone(conditions), windowLadder, rungIndex: request.rungIndex, window: { ...conditions.window },
    oracleFreeExecution: true as const,
  }
  const elapsed: AssignmentObservedRecord['elapsedMs'] = {
    context: 0, reachTable: null, solverConstruction: null, optionCount: null, rootMrvCount: null, windowLocalRootBound: null, toFirstCandidate: null, solver: null, replay: null, total: 0,
  }
  const nodeTimeline = new ThinnedSeries<{ nodes: number; atMs: number }>(TIMELINE_LIMIT)
  const candidateTimeline = new ThinnedSeries<{ ordinal: number; atMs: number }>(TIMELINE_LIMIT)
  const finish = (semantic: Omit<AssignmentSemanticRecord, 'windowTransition' | 'integrityIssues' | keyof typeof base>): AssignmentRunResult => {
    const windowTransition = decideWindowTransition(semantic.outcome, request.rungIndex, request.windowLadder)
    const record: AssignmentSemanticRecord = { ...base, ...semantic, windowTransition, integrityIssues: [] }
    record.integrityIssues = [...(semantic.replay?.status === 'invariant_violation' ? ['required-only replay found an invariant violation (see replay.violations)'] : []),
      ...findNonPlainJsonPaths(record, 'semantic').map(path => `non-plain value at ${path}`)]
    elapsed.total = now() - started
    return { semantic: record, observed: { elapsedMs: elapsed, yields, nodeTimeline: nodeTimeline.toArray(), candidateTimeline: candidateTimeline.toArray() } }
  }

  // Phase 0: the planning Target set (design 4.1).
  const contextResult = createGlobalAssignmentContext(plannerInput, dependencies)
  elapsed.context = now() - started
  const input = summarizeInput(plannerInput, contextResult, dependencies)
  if (contextResult.kind !== 'context') {
    return finish({
      input, context: { status: 'unsupported_input', reason: contextResult.reason, detail: contextResult.detail }, reachTable: { status: 'not_reached' },
      scan: null, solver: null, candidates: null, replay: null, outcome: { kind: 'unsupported_input', reason: contextResult.reason },
    })
  }
  const context = contextResult.context

  // Phase A: the ReachTable inside the rung's window, with the a1 option set the B-2A protocol (and its formal RESULT) was registered with (A-2).
  const scanStarted = now()
  const tableResult = await buildReachTable(context, dependencies.rngEngine, conditions.window, REACH_OPTION_SET_A1, { shouldCancel: execution.shouldCancel, yieldControl: execution.yieldControl })
  elapsed.reachTable = now() - scanStarted
  if (tableResult.kind === 'unsupported_input') {
    return finish({
      input, context: { status: 'context' }, reachTable: { status: 'unsupported_input', reason: tableResult.reason, detail: tableResult.detail },
      scan: null, solver: null, candidates: null, replay: null, outcome: { kind: 'unsupported_input', reason: tableResult.reason },
    })
  }
  if (tableResult.kind === 'cancelled') {
    return finish({ input, context: { status: 'context' }, reachTable: { status: 'cancelled' }, scan: null, solver: null, candidates: null, replay: null, outcome: { kind: 'scan_cancelled' } })
  }
  const table = tableResult.table

  // Phase B-1: the resource assignment search (no VerifiedUpperBound: nothing is pruned).
  const constructionStarted = now()
  let nodeTraceHash = hashStableValue({ protocol: ASSIGNMENT_B2A_PROTOCOL_VERSION, trace: 'start' })
  let nodeTraceLength = 0
  const nodeTrace: ExpandedNodeInfo[] = []
  const created = createResourceAssignmentSearch(table, context.planningTargets, {
    nodeBudget: conditions.nodeBudget, mrvLookahead: conditions.mrvLookahead, shouldCancel: execution.shouldCancel,
    onNodeExpanded: node => {
      nodeTraceLength += 1
      nodeTraceHash = hashStableValue({ previous: nodeTraceHash, node: [node.nodes, node.depth, node.selectedTarget, node.feasibleOptionsUpToLookahead] })
      if (nodeTrace.length < ASSIGNMENT_NODE_TRACE_LIMIT) nodeTrace.push({ ...node })
      nodeTimeline.offer({ nodes: node.nodes, atMs: now() - started })
      execution.onNodeExpanded?.(node)
    },
  })
  elapsed.solverConstruction = now() - constructionStarted
  const { scan, optionCountMs, rootMrvCountMs } = summarizeScan(table, context, conditions.mrvLookahead, now)
  elapsed.optionCount = optionCountMs
  elapsed.rootMrvCount = rootMrvCountMs
  const boundStarted = now()
  // LB(empty) of design 10.1 inside this window; a Target without any option in the window makes it +Infinity, recorded as null (no finite bound).
  const rawWindowLocalRootBound = partialAssignmentLowerBound(createEmptyPartialAssignment(table), [...createTargetStreamMenus(table).values()], table)
  const windowLocalRootBound = Number.isFinite(rawWindowLocalRootBound) ? rawWindowLocalRootBound : null
  elapsed.windowLocalRootBound = now() - boundStarted
  const solverBase = { nodeBudget: conditions.nodeBudget, mrvLookahead: conditions.mrvLookahead, candidateLimit: conditions.candidateLimit, upperBoundSupplied: false as const, windowLocalRootBound, nodeTraceLimit: ASSIGNMENT_NODE_TRACE_LIMIT }
  if (created.kind === 'invalid_input') {
    return finish({
      input, context: { status: 'context' }, reachTable: { status: 'reach_table' }, scan,
      solver: { ...solverBase, diagnostics: { expandedNodes: 0, maxDepth: 0, candidates: 0, rejections: { source: 0, skill_position: 0, gogma_position: 0, normal_position: 0 }, pruned: 0, deadEnds: 0, deadEndsByTarget: {}, bestAssignment: null, completeness: 'running' },
        nodeTrace: [], nodeTraceLength: 0, nodeTraceHash },
      candidates: null, replay: null, outcome: { kind: 'invalid_input', reason: `${created.reason}: ${created.detail}` },
    })
  }
  const { search } = created
  const solverStarted = now()
  const objectives: number[] = []
  const snapshots: ResourceAssignmentCandidate[] = []
  let best: { ordinal: number; objective: number; streamEnd: ResourceAssignmentCandidate['streamEnd'] } | null = null
  let outcome: AssignmentStageOutcome | null = null
  while (outcome === null) {
    const event = search.next(1)
    if (event.kind === 'candidate') {
      const { candidate } = event
      objectives.push(candidate.objective)
      if (best === null || candidate.objective < best.objective) best = { ordinal: candidate.ordinal, objective: candidate.objective, streamEnd: candidate.streamEnd }
      if (snapshots.length < conditions.snapshotLimit) snapshots.push(candidate)
      if (elapsed.toFirstCandidate === null) elapsed.toFirstCandidate = now() - solverStarted
      candidateTimeline.offer({ ordinal: candidate.ordinal, atMs: now() - started })
      if (objectives.length >= conditions.candidateLimit) outcome = { kind: 'assignments_found', completeness: 'candidate_limit_reached' }
      else await yieldControl()
      continue
    }
    if (event.kind === 'paused') { await yieldControl(); continue }
    // Finished: the same classification as collectResourceAssignments() (Phase B-1).
    const diagnostics = search.diagnostics
    if (event.completeness !== 'exhausted') outcome = { kind: 'search_incomplete', completeness: event.completeness }
    else if (objectives.length > 0) outcome = { kind: 'assignments_found', completeness: 'exhausted' }
    else outcome = { kind: 'no_resource_assignment', reason: search.targetsWithoutOption.length > 0 ? 'target_without_option' : diagnostics.pruned > 0 ? 'upper_bound_pruning' : 'resource_exclusivity' }
  }
  elapsed.solver = now() - solverStarted
  const solver: AssignmentSolverDiagnostics = { ...solverBase, diagnostics: search.diagnostics, nodeTrace, nodeTraceLength, nodeTraceHash }
  const candidates = summarizeCandidates(objectives, best, snapshots, conditions.snapshotLimit)

  // Design 5.3: the chosen options of the snapshotted candidates are replayed required-only (fail closed on an invariant violation).
  let replay: AssignmentReplayDiagnostics
  if (request.replaySnapshots === false || snapshots.length === 0) {
    replay = { status: 'skipped', candidatesReplayed: 0, optionsReplayed: 0, predictions: { skill: 0, gogmaReset: 0, gogmaKeep: 0, normal: 0 }, violations: [] }
  } else {
    const replayStarted = now()
    replay = replaySnapshots(snapshots, context, dependencies)
    elapsed.replay = now() - replayStarted
  }
  return finish({ input, context: { status: 'context' }, reachTable: { status: 'reach_table' }, scan, solver, candidates, replay, outcome })
}
