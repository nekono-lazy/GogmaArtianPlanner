/**
 * Issue #154 Global Assignment Phase B-1 (Research only; never imported by the app).
 *
 * The resource assignment solver (`docs/PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md` 6.3 / 6.4 / 6.5 / 10.1 /
 * 12): a deterministic depth-first backtracking over the ReachTable that assigns one reach option to
 * every planning Target under C1 (source exclusivity) and C2 (required position exclusivity), choosing
 * the Target at each node by MRV (fewest resource-feasible options under the partial assignment, counted
 * up to `mrvLookahead`; ties by Target priority descending, then Target ID ascending) and walking that
 * Target's options in the design 6.3 value order (`assignmentOrdering.ts`).
 *
 * It is the design's `structuralCandidates` generator without the Phase C coverage check: a complete
 * assignment is returned as a `ResourceAssignmentCandidate` (C1 / C2 only; neither a
 * `StructuralCandidate` nor anything Production can execute) and the search state - the frame stack,
 * each frame's position in its value order, the node count - is kept, so the next `next()` resumes at the
 * next value of the same node. Every complete assignment is generated at most once; nothing is replayed,
 * and no candidate's objective is ever an upper bound. Branch-and-bound exists only for a
 * `VerifiedUpperBound` the caller reads from a Production-verified Plan (none in Phase B-1), and then
 * cuts exactly the children with `LB(child) >= UB` (`assignmentLowerBound.ts`); `bestAssignment` is a
 * diagnostic. The dependency is one-way: feasibility -> lower bound -> pruning, and the MRV count reads
 * feasibility only.
 *
 * The stack is explicit, so a pause (`next(maxNodes)`) and a resume are the same state, memory is the
 * frames' partial assignments plus their lattice frontiers, and no recursion depth is involved. Budget,
 * cancel and exhaustion are three different ends: reaching the node budget or a cancel leaves unexplored
 * branches and concludes nothing about the window; only an exhausted tree says this window and these
 * constraints held no (further) assignment.
 */
import { applyReachOption, createEmptyPartialAssignment, findResourceViolation, streamEndObjective } from './assignmentFeasibility'
import { createTargetStreamMenus, partialAssignmentLowerBound, type TargetStreamMenu } from './assignmentLowerBound'
import {
  countFeasibleOptionsUpTo, createOrderedOptionEnumerator, createTargetOptionLattice, type FeasibleOptionCount, type OrderedOptionEnumerator, type TargetOptionLattice,
} from './assignmentOrdering'
import type {
  CreateResourceAssignmentSearchResult, PartialResourceAssignment, PlanningTargetPriority, ResourceAssignmentCandidate, ResourceAssignmentSearch,
  ResourceAssignmentSearchCompleteness, ResourceAssignmentSearchDiagnostics, ResourceAssignmentSearchEvent, ResourceAssignmentSearchRequest,
  ResourceAssignmentSearchResult,
} from './assignmentTypes'
import { enumerateReachOptions } from './reachOptions'
import type { ReachOption, ReachTable, TargetReach } from './types'

type TargetId = TargetReach['targetWeaponId']

interface Frame {
  depth: number
  partial: PartialResourceAssignment
  selectedTarget: TargetReach
  enumerator: OrderedOptionEnumerator
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function validate(table: ReachTable, planningTargets: readonly PlanningTargetPriority[], request: ResourceAssignmentSearchRequest):
  Extract<CreateResourceAssignmentSearchResult, { kind: 'invalid_input' }> | null {
  const invalid = (reason: Extract<CreateResourceAssignmentSearchResult, { kind: 'invalid_input' }>['reason'], detail: string) => ({ kind: 'invalid_input' as const, reason, detail })
  for (const field of ['nodeBudget', 'mrvLookahead'] as const) {
    const value = request[field]
    if (!Number.isSafeInteger(value) || value < 1) return invalid('invalid_request', `${field} must be a positive integer (got ${String(value)}).`)
  }
  if (table.targets.length === 0) return invalid('invalid_reach_table', 'The ReachTable holds no planning Target.')
  if (!Number.isSafeInteger(table.originSkill) || !Number.isSafeInteger(table.originGogma)) return invalid('invalid_reach_table', 'Skill / Gogma origins must be integers.')
  for (const [counterId, origin] of Object.entries(table.originNormal)) {
    if (!Number.isSafeInteger(origin)) return invalid('invalid_reach_table', `Normal Counter ${counterId} origin must be an integer (got ${String(origin)}).`)
  }
  const seen = new Set<string>()
  for (const target of table.targets) {
    if (seen.has(target.targetWeaponId)) return invalid('invalid_reach_table', `Target ${target.targetWeaponId} appears twice in the ReachTable.`)
    seen.add(target.targetWeaponId)
    if (target.normalCounterId !== null && !(target.normalCounterId in table.originNormal)) {
      return invalid('invalid_reach_table', `Target ${target.targetWeaponId} names Normal Counter ${target.normalCounterId}, which has no origin in the table.`)
    }
    for (const source of target.sources) {
      if (source.kind === 'new_normal' && source.counterId !== target.normalCounterId) {
        return invalid('invalid_reach_table', `Target ${target.targetWeaponId} has a new_normal source on Counter ${source.counterId} instead of ${String(target.normalCounterId)}.`)
      }
    }
  }
  const tableIds = table.targets.map(target => target.targetWeaponId)
  const planningIds = planningTargets.map(target => target.id)
  if (tableIds.length !== planningIds.length || tableIds.some((id, index) => id !== planningIds[index])) {
    return invalid('planning_target_mismatch', `ReachTable targets [${tableIds.join(', ')}] differ from the planning Targets [${planningIds.join(', ')}] in membership or order.`)
  }
  return null
}

class Search implements ResourceAssignmentSearch {
  readonly targetsWithoutOption: readonly TargetId[]
  private readonly priorityById: Map<TargetId, number>
  private readonly lattices: Map<TargetId, TargetOptionLattice>
  private readonly menus: Map<TargetId, TargetStreamMenu>
  private readonly frames: Frame[] = []
  private started = false
  private finished: ResourceAssignmentSearchCompleteness | null = null
  private readonly state: ResourceAssignmentSearchDiagnostics = {
    expandedNodes: 0, maxDepth: 0, candidates: 0,
    rejections: { source: 0, skill_position: 0, gogma_position: 0, normal_position: 0 },
    pruned: 0, deadEnds: 0, deadEndsByTarget: {}, bestAssignment: null, completeness: 'running',
  }

  private readonly table: ReachTable
  private readonly request: ResourceAssignmentSearchRequest

  constructor(table: ReachTable, planningTargets: readonly PlanningTargetPriority[], request: ResourceAssignmentSearchRequest) {
    this.table = table
    this.request = request
    this.priorityById = new Map(planningTargets.map(target => [target.id, target.priority]))
    this.lattices = new Map(table.targets.map(target => [target.targetWeaponId, createTargetOptionLattice(target, table)]))
    this.menus = createTargetStreamMenus(table)
    this.targetsWithoutOption = table.targets.filter(target => enumerateReachOptions(target, table).next().done === true).map(target => target.targetWeaponId)
  }

  get diagnostics(): ResourceAssignmentSearchDiagnostics {
    const state = this.state
    return {
      ...state,
      rejections: { ...state.rejections },
      deadEndsByTarget: { ...state.deadEndsByTarget },
      bestAssignment: state.bestAssignment === null ? null : { ...state.bestAssignment },
    }
  }

  next(maxNodes?: number): ResourceAssignmentSearchEvent {
    if (maxNodes !== undefined && (!Number.isSafeInteger(maxNodes) || maxNodes < 1)) throw new RangeError(`maxNodes must be a positive integer (got ${String(maxNodes)}).`)
    if (this.finished !== null) return { kind: 'finished', completeness: this.finished }
    let nodesThisCall = 0
    if (!this.started) {
      this.started = true
      const event = this.enterNode(createEmptyPartialAssignment(this.table), 0)
      nodesThisCall += 1
      if (event) return event
    }
    while (true) {
      if (this.request.shouldCancel?.()) return this.finish('cancelled')
      const frame = this.frames[this.frames.length - 1]
      if (!frame) return this.finish('exhausted')
      if (maxNodes !== undefined && nodesThisCall >= maxNodes) return { kind: 'paused', nodesThisCall }
      const option = this.nextFeasibleOption(frame)
      if (option === undefined) {
        this.frames.pop()
        continue
      }
      const child = applyReachOption(frame.partial, option)
      const upperBound = this.readUpperBound()
      if (upperBound !== null) {
        const unassigned = this.table.targets.filter(target => !child.chosen.has(target.targetWeaponId)).map(target => this.menus.get(target.targetWeaponId)!)
        if (partialAssignmentLowerBound(child, unassigned, this.table) >= upperBound) {
          this.state.pruned += 1
          continue
        }
      }
      const event = this.enterNode(child, frame.depth + 1)
      nodesThisCall += 1
      if (event) return event
    }
  }

  /** Expands one node: a candidate (leaf), a dead end, or a new frame. Returns the event to deliver, if any. */
  private enterNode(partial: PartialResourceAssignment, depth: number): ResourceAssignmentSearchEvent | null {
    if (this.state.expandedNodes >= this.request.nodeBudget) return this.finish('node_budget_reached')
    this.state.expandedNodes += 1
    this.state.maxDepth = Math.max(this.state.maxDepth, depth)
    if (partial.chosen.size === this.table.targets.length) {
      const candidate = this.buildCandidate(partial)
      this.state.candidates += 1
      const best = this.state.bestAssignment
      if (best === null || candidate.objective < best.objective) this.state.bestAssignment = { ordinal: candidate.ordinal, objective: candidate.objective }
      this.request.onNodeExpanded?.({ nodes: this.state.expandedNodes, depth, selectedTarget: null, feasibleOptionsUpToLookahead: null })
      return { kind: 'candidate', candidate }
    }
    const selection = this.selectTarget(partial)
    this.request.onNodeExpanded?.({ nodes: this.state.expandedNodes, depth, selectedTarget: selection.target.targetWeaponId, feasibleOptionsUpToLookahead: selection.count })
    if (selection.count === 0) {
      // A count of 0 walked every option of the Target, so its rejections are the exact reasons of this dead end.
      this.state.deadEnds += 1
      this.state.deadEndsByTarget[selection.target.targetWeaponId] = (this.state.deadEndsByTarget[selection.target.targetWeaponId] ?? 0) + 1
      for (const kind of ['source', 'skill_position', 'gogma_position', 'normal_position'] as const) this.state.rejections[kind] += selection.rejections[kind]
      return null
    }
    const enumerator = createOrderedOptionEnumerator(this.lattices.get(selection.target.targetWeaponId)!, this.table, partial)
    this.state.rejections.source += enumerator.excludedUsedSources
    this.frames.push({ depth, partial, selectedTarget: selection.target, enumerator })
    return null
  }

  /** MRV (design 6.3 / 6.4): fewest resource-feasible options up to the lookahead, then priority descending, then Target ID ascending. */
  private selectTarget(partial: PartialResourceAssignment): { target: TargetReach } & FeasibleOptionCount {
    let best: ({ target: TargetReach; priority: number } & FeasibleOptionCount) | null = null
    for (const target of this.table.targets) {
      if (partial.chosen.has(target.targetWeaponId)) continue
      const counted = countFeasibleOptionsUpTo(target, this.table, partial, this.request.mrvLookahead)
      const priority = this.priorityById.get(target.targetWeaponId) ?? 0
      if (best === null || counted.count < best.count || (counted.count === best.count && (priority > best.priority
        || (priority === best.priority && compareIds(target.targetWeaponId, best.target.targetWeaponId) < 0)))) {
        best = { target, priority, ...counted }
      }
    }
    if (best === null) throw new Error('selectTarget called with every Target assigned.')
    return { target: best.target, count: best.count, rejections: best.rejections }
  }

  /** The next option of the frame's Target in value order that is resource-feasible, counting the C2 rejections. */
  private nextFeasibleOption(frame: Frame): ReachOption | undefined {
    while (true) {
      const option = frame.enumerator.next()
      if (option === undefined) return undefined
      const violation = findResourceViolation(option, frame.partial)
      if (violation === null) return option
      this.state.rejections[violation] += 1
    }
  }

  private readUpperBound(): number | null {
    const bound = this.request.readVerifiedUpperBound?.() ?? null
    if (bound === null) return null
    if (bound.provenance !== 'production_verified_plan' || !Number.isSafeInteger(bound.physicalOperations) || bound.physicalOperations < 0) {
      throw new RangeError(`A VerifiedUpperBound must carry provenance 'production_verified_plan' and a non-negative integer physicalOperations (got ${JSON.stringify(bound)}).`)
    }
    return bound.physicalOperations
  }

  private buildCandidate(partial: PartialResourceAssignment): ResourceAssignmentCandidate {
    const ascending = (values: Iterable<number>) => [...values].sort((left, right) => left - right)
    const normal = Object.fromEntries([...partial.usedNormalPositions].sort(([left], [right]) => compareIds(left, right)).map(([counterId, positions]) => [counterId, ascending(positions)]))
    return {
      kind: 'resource_assignment',
      ordinal: this.state.candidates,
      chosen: new Map(this.table.targets.map(target => [target.targetWeaponId, partial.chosen.get(target.targetWeaponId)!])),
      assignmentOrder: [...partial.chosen.keys()],
      usedSources: [...partial.usedSources].sort(compareIds),
      requiredPositions: { skill: ascending(partial.usedSkillPositions), gogma: ascending(partial.usedGogmaPositions), normal },
      streamEnd: { skill: partial.streamEnd.skill, gogma: partial.streamEnd.gogma, normal: { ...partial.streamEnd.normal } },
      objective: streamEndObjective(partial.streamEnd, this.table),
    }
  }

  private finish(completeness: ResourceAssignmentSearchCompleteness): ResourceAssignmentSearchEvent {
    this.finished = completeness
    this.state.completeness = completeness
    this.frames.length = 0
    return { kind: 'finished', completeness }
  }
}

/**
 * Creates the resumable search over `table` for the given planning Targets (the context's
 * `planningTargets`; only `id` and `priority` are read). Nothing is searched until `next()` is called.
 */
export function createResourceAssignmentSearch(table: ReachTable, planningTargets: readonly PlanningTargetPriority[], request: ResourceAssignmentSearchRequest): CreateResourceAssignmentSearchResult {
  const invalid = validate(table, planningTargets, request)
  if (invalid) return invalid
  return { kind: 'search', search: new Search(table, planningTargets, request) }
}

/**
 * Runs a search until `candidateLimit` complete assignments were generated or the search ended, and
 * classifies the outcome (Phase B-1's slice of design 4.6). A limit stop is `candidate_limit_reached`:
 * the tree was not exhausted and nothing is said about the rest of it.
 */
export function collectResourceAssignments(table: ReachTable, planningTargets: readonly PlanningTargetPriority[], request: ResourceAssignmentSearchRequest,
  candidateLimit: number): ResourceAssignmentSearchResult {
  if (!Number.isSafeInteger(candidateLimit) || candidateLimit < 1) {
    return { status: 'invalid_input', reason: 'invalid_candidate_limit', detail: `candidateLimit must be a positive integer (got ${String(candidateLimit)}).` }
  }
  const created = createResourceAssignmentSearch(table, planningTargets, request)
  if (created.kind === 'invalid_input') return { status: 'invalid_input', reason: created.reason, detail: created.detail }
  const { search } = created
  const candidates: ResourceAssignmentCandidate[] = []
  const common = { window: { ...table.window }, scanned: table.scanned }
  while (true) {
    const event = search.next()
    if (event.kind === 'candidate') {
      candidates.push(event.candidate)
      if (candidates.length >= candidateLimit) return { status: 'assignments_found', completeness: 'candidate_limit_reached', candidates, diagnostics: search.diagnostics, ...common }
      continue
    }
    if (event.kind === 'paused') continue
    const diagnostics = search.diagnostics
    if (event.completeness !== 'exhausted') return { status: 'search_incomplete', completeness: event.completeness, candidates, diagnostics, ...common }
    if (candidates.length > 0) return { status: 'assignments_found', completeness: 'exhausted', candidates, diagnostics, ...common }
    const targetsWithoutOption = [...search.targetsWithoutOption]
    return {
      status: 'no_resource_assignment', completeness: 'exhausted',
      reason: targetsWithoutOption.length > 0 ? 'target_without_option' : diagnostics.pruned > 0 ? 'upper_bound_pruning' : 'resource_exclusivity',
      targetsWithoutOption, diagnostics, ...common,
    }
  }
}
