/**
 * Issue #154 Global Assignment Phase B-2A (Research only; never imported by the app).
 *
 * The Research protocol of the assignment-only runner (`docs/PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md` 10.3 /
 * 10.4 / 11.2 / 12 / 14 Phase B-2, `docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_B2A.md`): the Research
 * conditions one run takes (window, node budget, MRV lookahead, candidate limit, candidate snapshot
 * limit), their validation, the bounded plain-data snapshot of a resource assignment, and the Phase B-2B
 * pre-registration record. Everything is plain data; nothing here reads a file, a clock or the Export.
 *
 * A B-2A run produces resource assignments (design 4.3, C1 / C2 only). None of them is a Production
 * Plan, none is `verified`, and no status of this protocol says `proven_minimum` or "every Target
 * completed"; the design's `verified` / `proven_minimum` vocabulary belongs to Phase D' and is absent here
 * on purpose.
 */
import type { ReachOption, ReachWindow, StreamEnd } from './types'
import type { ResourceAssignmentCandidate } from './assignmentTypes'

export const ASSIGNMENT_B2A_PROTOCOL_VERSION = 'global-assignment-b2a:1'
export const ASSIGNMENT_B2A_PHASE = 'Issue #154 Global Assignment Phase B-2A: assignment-only runner (resource assignments under C1 / C2; not a Production Plan, not verified)'
/** The Research plan and pre-registration document of this Phase (Markdown; its SHA-256 is recorded by the runner). */
export const ASSIGNMENT_B2A_DOC = 'docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_B2A.md'
/** The main this Phase started from (PR #239 merged). */
export const ASSIGNMENT_B2A_BASE_MAIN = 'cfa0488ca776542cb2595227df460ffd35b3f068'

/**
 * The Research conditions of one assignment-only run (design 10.4: window and node budget are different
 * budgets; the candidate limit bounds how many complete assignments one run collects and the snapshot
 * limit how many of them are kept in full in the RESULT). Reaching the node budget is
 * `search_incomplete`, reaching the candidate limit is `candidate_limit_reached`; neither is exhaustion.
 */
export interface AssignmentResearchConditions {
  window: ReachWindow
  nodeBudget: number
  mrvLookahead: number
  candidateLimit: number
  /** Complete assignments kept in full (bounded; the rest keep their objective only). `0 <= snapshotLimit <= candidateLimit`. */
  snapshotLimit: number
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/** Issues of a conditions object; `[]` means valid. A window is three positive integers (`assertReachWindow()` applies the same rule). */
export function validateAssignmentResearchConditions(value: unknown): string[] {
  const issues: string[] = []
  if (typeof value !== 'object' || value === null) return ['conditions must be an object.']
  const conditions = value as Record<string, unknown>
  const window = conditions.window as Record<string, unknown> | undefined
  if (typeof window !== 'object' || window === null) issues.push('window must be an object with normal / gogma / skill.')
  else for (const stream of ['normal', 'gogma', 'skill'] as const) {
    if (!isPositiveInteger(window[stream])) issues.push(`window.${stream} must be a positive integer (got ${String(window[stream])}).`)
  }
  for (const field of ['nodeBudget', 'mrvLookahead', 'candidateLimit'] as const) {
    if (!isPositiveInteger(conditions[field])) issues.push(`${field} must be a positive integer (got ${String(conditions[field])}).`)
  }
  if (!isNonNegativeInteger(conditions.snapshotLimit)) issues.push(`snapshotLimit must be a non-negative integer (got ${String(conditions.snapshotLimit)}).`)
  else if (isPositiveInteger(conditions.candidateLimit) && conditions.snapshotLimit > conditions.candidateLimit) {
    issues.push(`snapshotLimit (${conditions.snapshotLimit}) must not exceed candidateLimit (${conditions.candidateLimit}).`)
  }
  return issues
}

/**
 * A window ladder (design 10.3): rung 0 is the first window scanned, every later rung widens or keeps
 * each stream (a rung never narrows a stream), and the ladder is shared by every Target.
 */
export function validateWindowLadder(ladder: unknown): string[] {
  if (!Array.isArray(ladder) || ladder.length === 0) return ['windowLadder must be a non-empty array of windows.']
  const issues: string[] = []
  for (const [index, rung] of ladder.entries()) {
    const value = rung as Record<string, unknown> | null
    if (typeof value !== 'object' || value === null) { issues.push(`windowLadder[${index}] must be a window.`); continue }
    for (const stream of ['normal', 'gogma', 'skill'] as const) {
      if (!isPositiveInteger(value[stream])) issues.push(`windowLadder[${index}].${stream} must be a positive integer (got ${String(value[stream])}).`)
      else if (index > 0) {
        const previous = (ladder[index - 1] as Record<string, unknown>)[stream]
        if (isPositiveInteger(previous) && value[stream] < previous) issues.push(`windowLadder[${index}].${stream} (${value[stream]}) narrows rung ${index - 1} (${previous}); a rung never narrows a stream.`)
      }
    }
  }
  return issues
}

/** One chosen option of a snapshot (plain data: the option's own fields, which are plain already). */
export interface AssignmentSnapshotOption {
  targetWeaponId: ReachOption['targetWeaponId']
  source: ReachOption['source']
  skillRequired: ReachOption['skillRequired']
  bonusRequired: ReachOption['bonusRequired']
  normalRequired: ReachOption['normalRequired']
  streamEnd: StreamEnd
  verification: ReachOption['verification']
}

/**
 * A `ResourceAssignmentCandidate` as plain JSON data (its `chosen` Map becomes an array in planning
 * Target order), bounded by the caller through `snapshotLimit`. Phase C may read such snapshots again;
 * nothing here is an identity (the ordinal is the generation index of one search, design 4.3).
 */
export interface AssignmentCandidateSnapshot {
  kind: 'resource_assignment'
  ordinal: number
  objective: number
  streamEnd: StreamEnd
  assignmentOrder: ResourceAssignmentCandidate['assignmentOrder']
  usedSources: string[]
  requiredPositions: ResourceAssignmentCandidate['requiredPositions']
  chosen: AssignmentSnapshotOption[]
  /** Source kinds over the chosen options. */
  sourceKinds: { owned_gogma: number; owned_normal: number; new_normal: number }
  /** Requirement kinds over the chosen options. */
  skillRequirements: { none: number; reset_skills: number; conversion: number }
  bonusRequirements: { none: number; reset: number; keep_from_source: number; reset_then_keep: number }
}

export function snapshotResourceAssignment(candidate: ResourceAssignmentCandidate): AssignmentCandidateSnapshot {
  const sourceKinds = { owned_gogma: 0, owned_normal: 0, new_normal: 0 }
  const skillRequirements = { none: 0, reset_skills: 0, conversion: 0 }
  const bonusRequirements = { none: 0, reset: 0, keep_from_source: 0, reset_then_keep: 0 }
  const chosen: AssignmentSnapshotOption[] = []
  for (const option of candidate.chosen.values()) {
    sourceKinds[option.source.kind] += 1
    skillRequirements[option.skillRequired.kind] += 1
    bonusRequirements[option.bonusRequired.kind] += 1
    chosen.push({
      targetWeaponId: option.targetWeaponId, source: structuredClone(option.source), skillRequired: structuredClone(option.skillRequired),
      bonusRequired: structuredClone(option.bonusRequired), normalRequired: option.normalRequired === null ? null : { ...option.normalRequired },
      streamEnd: { skill: option.streamEnd.skill, gogma: option.streamEnd.gogma, normal: { ...option.streamEnd.normal } }, verification: option.verification,
    })
  }
  return {
    kind: 'resource_assignment', ordinal: candidate.ordinal, objective: candidate.objective,
    streamEnd: { skill: candidate.streamEnd.skill, gogma: candidate.streamEnd.gogma, normal: { ...candidate.streamEnd.normal } },
    assignmentOrder: [...candidate.assignmentOrder], usedSources: [...candidate.usedSources],
    requiredPositions: { skill: [...candidate.requiredPositions.skill], gogma: [...candidate.requiredPositions.gogma],
      normal: Object.fromEntries(Object.entries(candidate.requiredPositions.normal).map(([counterId, positions]) => [counterId, [...positions]])) },
    chosen, sourceKinds, skillRequirements, bonusRequirements,
  }
}

/**
 * Paths inside `value` that JSON would silently distort or drop: a Map or Set (`{}`), a function, a
 * `bigint`, a non-finite number (`null`), or an `undefined` object property (dropped). `[]` means the
 * value round-trips through JSON unchanged. The runner checks its own record with this before it is
 * written, so a Map never becomes `{}` unnoticed (the Phase B-2 instruction).
 */
export function findNonPlainJsonPaths(value: unknown, path = '$'): string[] {
  const issues: string[] = []
  const visit = (node: unknown, at: string) => {
    if (node === null) return
    if (typeof node === 'number') { if (!Number.isFinite(node)) issues.push(`${at}: non-finite number`); return }
    if (typeof node === 'bigint') { issues.push(`${at}: bigint`); return }
    if (typeof node === 'function') { issues.push(`${at}: function`); return }
    if (typeof node === 'symbol') { issues.push(`${at}: symbol`); return }
    if (typeof node !== 'object') return
    if (node instanceof Map) { issues.push(`${at}: Map`); return }
    if (node instanceof Set) { issues.push(`${at}: Set`); return }
    if (Array.isArray(node)) {
      node.forEach((item, index) => { if (item === undefined) issues.push(`${at}[${index}]: undefined`); else visit(item, `${at}[${index}]`) })
      return
    }
    for (const [key, item] of Object.entries(node)) {
      if (item === undefined) issues.push(`${at}.${key}: undefined`)
      else visit(item, `${at}.${key}`)
    }
  }
  visit(value, path)
  return issues
}

/** A pre-registered value with the basis it was chosen on (design 11.2: `oracleInformed` per item). `null` = not registered yet. */
export interface RegisteredCondition<T> {
  value: T | null
  basis: string
  oracleInformed: boolean
}

/**
 * The Phase B-2B formal measurement conditions, pre-registered from the Phase B-2A non-formal smoke
 * (design 14 Phase B-2, `docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_B2A.md` 6). A `null` value is an
 * unresolved registration item; `assignmentB2bRegistrationIssues()` names every one, and the runner
 * refuses a formal run while any remains or while `formalRun.enabled` is false. Phase B-2A never starts a
 * formal run: the Phase B-2B PR enables it after the registered conditions were reviewed, and changes no
 * registered value after the formal run started.
 */
const SMOKE_W0 ='Phase B-2A non-formal W0 smoke on the real Export (docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_B2A.md 4.2, two identical runs)'

export const ASSIGNMENT_B2B_PREREGISTRATION = Object.freeze({
  windowLadder: Object.freeze({
    value: Object.freeze([Object.freeze({ normal: 350, gogma: 500, skill: 1500 })]) as readonly ReachWindow[],
    basis: 'W0 only: recommendedCandidateSearchDefaults (Issue #125, REQUIREMENTS 14.1), a Production constant of non-oracle origin. No objective basis for a W1 value exists before the W0 formal run, so the registered ladder is the single rung W0 and the effect of a window expansion stays unmeasured; the design 10.3 rule is still applied (an exhausted no-assignment result at W0 reports the ladder exhausted, never infeasibility).',
    oracleInformed: false,
  }) as RegisteredCondition<readonly ReachWindow[]>,
  nodeBudget: Object.freeze({
    value: 2_000,
    basis: `${SMOKE_W0}: the first complete assignment at node 43 (depth 43, 0 dead ends) and 1,000 candidates in 1,043 nodes; the descent cost about 1.17 s per node (MRV count over up to 43 unassigned Targets), the leaves milliseconds. 2,000 nodes is about 2x the observed need and, at the observed worst per-node cost, stays inside the registered child wall-clock (2,000 x 1.2 s = 40 min < 60 min) even if every node were a shallow one.`,
    oracleInformed: false,
  }) as RegisteredCondition<number>,
  mrvLookahead: Object.freeze({
    value: 8,
    basis: `${SMOKE_W0}: the design 6.4 lookahead k bounds only the MRV count for the Target selection order (every option stays enumerable); the smoke used 8, every Target saturated it at the root, and no observation justifies another value.`,
    oracleInformed: false,
  }) as RegisteredCondition<number>,
  candidateLimit: Object.freeze({
    value: 1_000,
    basis: `${SMOKE_W0}: after the first complete assignment the generator yielded 1,000 sibling leaves in about 0.1 s, all with the same objective (1,766); 1,000 bounds the collection and the RESULT (one number per candidate) while recording whether a different objective appears among the first thousand.`,
    oracleInformed: false,
  }) as RegisteredCondition<number>,
  snapshotLimit: Object.freeze({
    value: 5,
    basis: `${SMOKE_W0}: five full snapshots (43 options each, about 20 KB each) kept the RESULT small and were replayed required-only in about 20 ms; the other collected candidates keep their objective only.`,
    oracleInformed: false,
  }) as RegisteredCondition<number>,
  rootLowerBound: Object.freeze({
    budget: Object.freeze({
      value: 2_000,
      basis: 'Phase B-2A non-formal root-bound smoke on the real Export (docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_B2A.md 4.3): the relaxation scans thresholds whose total stays below the budget, so the budget must exceed the structural objective it is compared with; the W0 smoke first candidate was 1,766 and budget 2,000 contains it with margin, while budget 300 was none_below_budget (7 Targets without an option in the box). The stage cost about 5.9 s at 300 and 148 s at 2,000. No oracle value (1,657) enters this choice (design 10.2).',
      oracleInformed: false,
    }) as RegisteredCondition<number>,
    childWallMs: Object.freeze({
      value: 20 * 60_000,
      basis: 'Phase B-2A root-bound smoke: 150 s of child wall-clock at budget 2,000 (LB stage 148 s); 20 minutes is an 8x margin. Reaching it is unmeasured, never a bound.',
      oracleInformed: false,
    }) as RegisteredCondition<number>,
    childHeapMb: Object.freeze({
      value: 4_096,
      basis: 'Phase B-2A root-bound smoke: peak RSS 584 MB, heapUsed 302 MB at budget 2,000; 4,096 MB (the same limit as the assignment child) is about 7x the observed RSS.',
      oracleInformed: false,
    }) as RegisteredCondition<number>,
  }),
  assignmentChild: Object.freeze({
    wallMs: Object.freeze({
      value: 60 * 60_000,
      basis: `${SMOKE_W0}: the whole assignment child (Export parse, ReachTable scan 12 s, 1,043 nodes, replay) took 92.5 s / 96.1 s of wall-clock; 60 minutes covers the registered node budget at the observed worst per-node cost (see nodeBudget). Reaching it is unmeasured, never no_resource_assignment.`,
      oracleInformed: false,
    }) as RegisteredCondition<number>,
    heapMb: Object.freeze({
      value: 4_096,
      basis: `${SMOKE_W0}: peak RSS 1.06 GB / 1.11 GB, heapUsed 845 MB under --max-old-space-size=4096; 4,096 MB is about 4x the observed heap. Reaching it is unmeasured.`,
      oracleInformed: false,
    }) as RegisteredCondition<number>,
  }),
  concurrency: 1,
  retry: 'none',
  /** Two assignment children per formal run; their semantic records must hash equal (design 12 determinism). */
  reproducibilityRuns: 2,
  formalRun: Object.freeze({ enabled: false, enabledBy: 'the Phase B-2B PR, after the registered conditions above were reviewed' }),
})

/** Registration items still `null`, each named by its path. A formal run is refused while this is non-empty (or while `formalRun.enabled` is false). */
export function assignmentB2bRegistrationIssues(): string[] {
  const registration = ASSIGNMENT_B2B_PREREGISTRATION
  const issues: string[] = []
  const check = (path: string, condition: RegisteredCondition<unknown>) => { if (condition.value === null) issues.push(`${path} is not registered.`) }
  check('windowLadder', registration.windowLadder)
  check('nodeBudget', registration.nodeBudget)
  check('mrvLookahead', registration.mrvLookahead)
  check('candidateLimit', registration.candidateLimit)
  check('snapshotLimit', registration.snapshotLimit)
  check('rootLowerBound.budget', registration.rootLowerBound.budget)
  check('rootLowerBound.childWallMs', registration.rootLowerBound.childWallMs)
  check('rootLowerBound.childHeapMb', registration.rootLowerBound.childHeapMb)
  check('assignmentChild.wallMs', registration.assignmentChild.wallMs)
  check('assignmentChild.heapMb', registration.assignmentChild.heapMb)
  if (registration.windowLadder.value !== null) issues.push(...validateWindowLadder(registration.windowLadder.value).map(issue => `windowLadder: ${issue}`))
  return issues
}
