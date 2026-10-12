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
 * refuses a formal run while any remains or while `formalRun.enabled` is false. Phase B-2A never started a
 * formal run; the Phase B-2B PR enabled it after the registered conditions were reviewed, without changing
 * any registered value, and changes no registered value after the formal run started.
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
  formalRun: Object.freeze({ enabled: true, enabledBy: 'the Phase B-2B PR, after the registered conditions above and the registered Export identity were audited unchanged from Phase B-2A; no registered value was changed when enabling' }),
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

/** The registered conditions and envelope as one plain object, or the names of the items still `null` (never a partial default). */
export function registeredFormalConditions(): { conditions: AssignmentResearchConditions; windowLadder: ReachWindow[]; envelope: FormalEnvelope } | { issues: string[] } {
  const registration = ASSIGNMENT_B2B_PREREGISTRATION
  const issues = assignmentB2bRegistrationIssues()
  if (issues.length > 0) return { issues }
  const ladder = registration.windowLadder.value!.map(rung => ({ ...rung }))
  return {
    conditions: { window: { ...ladder[0]! }, nodeBudget: registration.nodeBudget.value!, mrvLookahead: registration.mrvLookahead.value!, candidateLimit: registration.candidateLimit.value!, snapshotLimit: registration.snapshotLimit.value! },
    windowLadder: ladder,
    envelope: {
      assignmentWallMs: registration.assignmentChild.wallMs.value!, assignmentHeapMb: registration.assignmentChild.heapMb.value!,
      rootBoundBudget: registration.rootLowerBound.budget.value!, rootBoundWallMs: registration.rootLowerBound.childWallMs.value!, rootBoundHeapMb: registration.rootLowerBound.childHeapMb.value!,
      repeat: registration.reproducibilityRuns, replaySnapshots: true,
    },
  }
}

export interface FormalEnvelope {
  assignmentWallMs: number
  assignmentHeapMb: number
  rootBoundBudget: number
  rootBoundWallMs: number
  rootBoundHeapMb: number
  repeat: number
  replaySnapshots: boolean
}

// ---------------------------------------------------------------------------------------------------------------------
// Formal measurement contract (Phase B-2B). The registered Export identity lives in the Research document, which the
// runner reads from the committed HEAD (`git show HEAD:<ASSIGNMENT_B2A_DOC>`); no Export hash is hard-coded in any
// runtime module or script (design 11.3), and the oracle manifest / past RESULTs are never an input.
// ---------------------------------------------------------------------------------------------------------------------

/** The identity of one Export file: name, byte length and SHA-256 (lower-case hex). */
export interface ExportIdentity {
  fileName: string
  bytes: number
  sha256: string
}

const REGISTERED_EXPORT_KEYS = ['registered-export-file', 'registered-export-bytes', 'registered-export-sha256'] as const

/**
 * Reads the registered Export identity from the Research document text: exactly one line each of
 * `registered-export-file: <name>`, `registered-export-bytes: <integer>` and `registered-export-sha256: <64 hex>`.
 * Anything else (a missing, duplicated or malformed line) is an issue, never a guessed identity.
 */
export function parseRegisteredExportIdentity(markdown: string): { identity: ExportIdentity; issues: [] } | { identity: null; issues: string[] } {
  const values = new Map<string, string[]>()
  for (const line of markdown.split(/\r?\n/)) {
    const match = /^(registered-export-(?:file|bytes|sha256)):\s*(\S+)\s*$/.exec(line.trim())
    if (match) values.set(match[1]!, [...(values.get(match[1]!) ?? []), match[2]!])
  }
  const issues: string[] = []
  for (const key of REGISTERED_EXPORT_KEYS) {
    const count = values.get(key)?.length ?? 0
    if (count !== 1) issues.push(`${key}: expected exactly one line, found ${count}.`)
  }
  if (issues.length > 0) return { identity: null, issues }
  const fileName = values.get('registered-export-file')![0]!
  const bytesText = values.get('registered-export-bytes')![0]!
  const sha256 = values.get('registered-export-sha256')![0]!
  if (!/^[1-9][0-9]*$/.test(bytesText)) issues.push(`registered-export-bytes: must be a positive integer (got ${bytesText}).`)
  if (!/^[0-9a-f]{64}$/.test(sha256)) issues.push(`registered-export-sha256: must be 64 lower-case hex characters.`)
  if (issues.length > 0) return { identity: null, issues }
  return { identity: { fileName, bytes: Number(bytesText), sha256 }, issues: [] }
}

/** The differences between an actual Export and a registered identity (`[]` = the same file name, length and hash). */
export function compareExportIdentity(actual: ExportIdentity, registered: ExportIdentity): string[] {
  const issues: string[] = []
  if (actual.sha256.toLowerCase() !== registered.sha256) issues.push(`Export SHA-256 ${actual.sha256} is not the registered ${registered.sha256}.`)
  if (actual.bytes !== registered.bytes) issues.push(`Export length ${actual.bytes} is not the registered ${registered.bytes} bytes.`)
  if (actual.fileName !== registered.fileName) issues.push(`Export file name ${actual.fileName} is not the registered ${registered.fileName}.`)
  return issues
}

export interface FormalGateRegistration {
  formalRunEnabled: boolean
  unresolvedItems: readonly string[]
}

/** The registration gate both the parent and every child apply: the formal run must be enabled and every item registered. */
export function formalRunGateIssues(registration: FormalGateRegistration): string[] {
  const issues: string[] = []
  if (!registration.formalRunEnabled) issues.push('A formal run is not enabled in this protocol version (ASSIGNMENT_B2B_PREREGISTRATION.formalRun.enabled is false).')
  if (registration.unresolvedItems.length > 0) issues.push(`The Phase B-2B pre-registration is incomplete: ${registration.unresolvedItems.join(' ')}`)
  return issues
}

export interface FormalStartInput {
  registration: FormalGateRegistration
  workingTreeClean: boolean
  uncommittedBenchmarkCode: boolean
  allowUncommitted: boolean
  overrideOptions: readonly string[]
  /** `--expected-export-sha256` as given (null = not given). A formal run requires it. */
  cliExpectedSha256: string | null
  /** The identity read from the committed Research document, or the reasons it could not be read. */
  registeredExport: { identity: ExportIdentity | null; issues: readonly string[] }
  actualExport: ExportIdentity
}

/**
 * Why a formal run must not start (`[]` = it may). The Export verification cannot be skipped: the registered identity
 * must be readable, the command line must name the registered hash (a second, independent entry of the same value),
 * and the actual Export must be that file.
 */
export function formalStartIssues(input: FormalStartInput): string[] {
  const issues = formalRunGateIssues(input.registration)
  if (input.allowUncommitted || input.uncommittedBenchmarkCode || !input.workingTreeClean) issues.push('A formal run needs a clean, committed Working Tree (no --allow-uncommitted).')
  if (input.overrideOptions.length > 0) issues.push(`A formal run takes its conditions from the registration only; remove ${input.overrideOptions.join(', ')}.`)
  if (input.registeredExport.identity === null) issues.push(`The registered Export identity could not be read from the committed Research document: ${input.registeredExport.issues.join(' ')}`)
  if (input.cliExpectedSha256 === null) issues.push('A formal run requires --expected-export-sha256 naming the registered Export SHA-256.')
  if (input.registeredExport.identity !== null) {
    if (input.cliExpectedSha256 !== null && input.cliExpectedSha256.toLowerCase() !== input.registeredExport.identity.sha256) {
      issues.push(`--expected-export-sha256 ${input.cliExpectedSha256} is not the registered Export SHA-256 ${input.registeredExport.identity.sha256}.`)
    }
    issues.push(...compareExportIdentity(input.actualExport, input.registeredExport.identity))
  }
  return issues
}

/** The Repository facts a formal child observes itself (never the parent's self-reported values) and the HEAD the task names. */
export interface FormalChildRepositoryState {
  /** The measurement HEAD the parent wrote into the task (null when the task carries none). */
  taskHeadSha: string | null
  currentHeadSha: string
  workingTreeClean: boolean
  uncommittedBenchmarkCode: boolean
}

export interface FormalChildGateInput {
  registration: FormalGateRegistration
  taskMode: string
  /** The identity the parent wrote into the task. */
  taskRegisteredExport: ExportIdentity | null
  /** The identity the child itself read from the committed Research document. */
  registeredExportFromHead: { identity: ExportIdentity | null; issues: readonly string[] }
  actualExport: ExportIdentity
  taskConditions: unknown
  taskWindowLadder: unknown
  taskEnvelope: unknown
  repository: FormalChildRepositoryState
}

/**
 * Why a child must refuse a formal task (`[]` = it may run). A child never trusts the task alone: it re-applies the
 * registration gate, re-reads the registered Export identity from HEAD, compares the parent's identity, the Export it
 * reads and the registered conditions, and checks the Repository it runs in (clean, committed, on the task's measurement
 * HEAD) from its own observation, so a hand-written formal task cannot bypass the parent's refusal.
 */
export function formalChildGateIssues(input: FormalChildGateInput): string[] {
  if (input.taskMode !== 'formal') return [`A formal child gate was asked for a ${input.taskMode} task.`]
  const issues = formalRunGateIssues(input.registration)
  const repository = input.repository
  if (repository.taskHeadSha === null || !/^[0-9a-f]{40}$/.test(repository.taskHeadSha)) issues.push('The task names no measurement HEAD.')
  else if (repository.taskHeadSha !== repository.currentHeadSha) issues.push(`The child runs at HEAD ${repository.currentHeadSha}, not the task's measurement HEAD ${repository.taskHeadSha}.`)
  if (!repository.workingTreeClean) issues.push('The child observed a Working Tree that is not clean.')
  if (repository.uncommittedBenchmarkCode) issues.push('The child observed uncommitted benchmark code.')
  const registered = registeredFormalConditions()
  if ('issues' in registered) issues.push(...registered.issues)
  else {
    if (JSON.stringify(input.taskConditions) !== JSON.stringify(registered.conditions)) issues.push('The task conditions are not the registered conditions.')
    if (JSON.stringify(input.taskWindowLadder) !== JSON.stringify(registered.windowLadder)) issues.push('The task window ladder is not the registered ladder.')
    if (JSON.stringify(input.taskEnvelope) !== JSON.stringify(registered.envelope)) issues.push('The task envelope is not the registered envelope.')
  }
  const fromHead = input.registeredExportFromHead
  if (fromHead.identity === null) issues.push(`The child could not read the registered Export identity from HEAD: ${fromHead.issues.join(' ')}`)
  else {
    if (input.taskRegisteredExport === null || JSON.stringify(input.taskRegisteredExport) !== JSON.stringify(fromHead.identity)) issues.push('The task does not carry the registered Export identity read from HEAD.')
    issues.push(...compareExportIdentity(input.actualExport, fromHead.identity))
  }
  return issues
}

export type FormalValidityStatus = 'not_applicable' | 'valid' | 'invalid'

export interface FormalValidityRun {
  id: string
  /** `measured`: the child completed and its record was read. `unmeasured`: timeout / out of memory / process failure / unreadable record. */
  status: 'measured' | 'unmeasured'
  reason: string | null
  semanticSha256: string | null
  integrityIssues: readonly string[]
  /** The record's mode / protocol / Export hash agree with the parent's (null when there is no record). */
  recordConsistent: boolean | null
}

export interface FormalValidityInput {
  mode: 'smoke' | 'formal'
  registration: FormalGateRegistration & { reproducibilityRuns: number }
  tree: { workingTreeClean: boolean; uncommittedBenchmarkCode: boolean; smokeOverrides: readonly string[] }
  exportVerification: { registeredMatched: boolean | null; cliMatched: boolean | null }
  assignmentRuns: readonly FormalValidityRun[]
  determinism: { identical: boolean | null }
  rootLowerBound: {
    status: 'found' | 'none_below_budget' | 'not_applicable' | 'unmeasured' | 'not_requested'
    reason: string | null
    /** The root-bound child's record agrees with the parent (mode / protocol / Export); null when there is no record (unmeasured, not requested). */
    recordConsistent: boolean | null
  }
  comparison: { consistency: 'consistent' | 'inconsistent' | 'not_comparable' }
  /** The aggregated RESULT's `integrityIssues` as finally recorded (record disagreements, replay violations, differing runs, an inconsistent bound). */
  integrityIssues: readonly string[]
}

export interface FormalValidity {
  /** `not_applicable`: a smoke run (no formal claim). `valid`: every formal condition held. `invalid`: a formal run that does not count as a formal measurement. */
  status: FormalValidityStatus
  issues: string[]
  checks: {
    registrationGate: boolean | null
    committedCleanTree: boolean | null
    noOverrides: boolean | null
    exportRegisteredMatched: boolean | null
    reproducibility: {
      requiredRuns: number
      runs: number
      measuredRuns: number
      allMeasured: boolean
      noIntegrityIssues: boolean
      recordsConsistent: boolean
      semanticHashesEqual: boolean | null
      identical: boolean | null
    } | null
    /**
     * The stage ran to a measurement (`found` / `none_below_budget`) versus what it proved, plus whether its record agrees with
     * the parent; never read as a success when `executed` or `recordConsistent` is not true.
     */
    rootLowerBoundStage: { requested: boolean; executed: boolean; status: string; provenBound: 'exact_minimum' | 'at_least_budget' | 'none'; reason: string | null; recordConsistent: boolean | null }
    comparisonConsistent: boolean | null
    /** The aggregated `integrityIssues` count; a valid formal measurement has none. */
    aggregateIntegrityIssueCount: number
    noAggregateIntegrityIssues: boolean | null
  }
}

/**
 * Whether a run counts as a formal measurement (Phase B-2B). A smoke run is `not_applicable`. A formal run is `valid`
 * only when the registration gate, the committed clean tree, the registered Export match, the registered number of
 * assignment children all measured with consistent records, no integrity issue and one semantic hash
 * (`determinism.identical === true`; `null` is unconfirmed, never valid), an executed root lower bound stage
 * (`found` or `none_below_budget`; `not_applicable` / `unmeasured` / `not_requested` are not), and a non-negative gap
 * all hold. Having started in formal mode is never the same as being valid.
 */
export function judgeFormalValidity(input: FormalValidityInput): FormalValidity {
  const rootStatus = input.rootLowerBound.status
  const rootStage: FormalValidity['checks']['rootLowerBoundStage'] = {
    requested: rootStatus !== 'not_requested', executed: rootStatus === 'found' || rootStatus === 'none_below_budget', status: rootStatus,
    provenBound: rootStatus === 'found' ? 'exact_minimum' : rootStatus === 'none_below_budget' ? 'at_least_budget' : 'none', reason: input.rootLowerBound.reason,
    recordConsistent: input.rootLowerBound.recordConsistent,
  }
  const aggregateIntegrityIssueCount = input.integrityIssues.length
  if (input.mode !== 'formal') {
    return {
      status: 'not_applicable', issues: [],
      checks: { registrationGate: null, committedCleanTree: null, noOverrides: null, exportRegisteredMatched: null, reproducibility: null, rootLowerBoundStage: rootStage, comparisonConsistent: null,
        aggregateIntegrityIssueCount, noAggregateIntegrityIssues: null },
    }
  }
  const issues: string[] = []
  const gate = formalRunGateIssues(input.registration)
  issues.push(...gate)
  const committedCleanTree = input.tree.workingTreeClean && !input.tree.uncommittedBenchmarkCode
  if (!committedCleanTree) issues.push('The Working Tree was not clean and committed.')
  const noOverrides = input.tree.smokeOverrides.length === 0
  if (!noOverrides) issues.push(`Command-line overrides were applied: ${input.tree.smokeOverrides.join(', ')}.`)
  const exportRegisteredMatched = input.exportVerification.registeredMatched === true && input.exportVerification.cliMatched === true
  if (!exportRegisteredMatched) issues.push('The Export was not verified against the registered identity and the command-line hash.')

  const runs = input.assignmentRuns
  const requiredRuns = input.registration.reproducibilityRuns
  const measured = runs.filter(run => run.status === 'measured')
  const allMeasured = runs.length === requiredRuns && measured.length === requiredRuns
  if (runs.length !== requiredRuns) issues.push(`${runs.length} assignment run(s) were started; the registration requires ${requiredRuns}.`)
  for (const run of runs.filter(run => run.status === 'unmeasured')) issues.push(`Assignment run ${run.id} is unmeasured (${run.reason ?? 'unknown'}).`)
  const noIntegrityIssues = runs.every(run => run.integrityIssues.length === 0)
  for (const run of runs.filter(run => run.integrityIssues.length > 0)) issues.push(`Assignment run ${run.id} has integrity issues: ${run.integrityIssues.join('; ')}`)
  const recordsConsistent = measured.every(run => run.recordConsistent === true)
  for (const run of measured.filter(run => run.recordConsistent !== true)) issues.push(`Assignment run ${run.id} record disagrees with the parent (mode / protocol / Export).`)
  const hashes = measured.map(run => run.semanticSha256)
  const semanticHashesEqual = measured.length >= 2 && hashes.every(hash => hash !== null) ? new Set(hashes).size === 1 : null
  if (semanticHashesEqual === false) issues.push('The semantic records of the assignment runs differ.')
  if (semanticHashesEqual === null) issues.push('Reproducibility is unconfirmed: fewer than two measured assignment runs with a semantic hash.')
  if (input.determinism.identical !== true) issues.push(`determinism.identical is ${String(input.determinism.identical)}; a formal measurement requires true.`)

  if (!rootStage.executed) issues.push(`The root lower bound stage did not execute to a measurement (${rootStatus}${input.rootLowerBound.reason ? `: ${input.rootLowerBound.reason}` : ''}).`)
  // A measured bound counts only when its record is the parent's run (mode / protocol / Export): a `found` from a disagreeing record is no bound of this measurement.
  else if (rootStage.recordConsistent !== true) issues.push(`The root-bound child record disagrees with the parent (mode / protocol / Export); its ${rootStatus} is not a bound of this measurement.`)
  const comparisonConsistent = input.comparison.consistency !== 'inconsistent'
  if (!comparisonConsistent) issues.push('The best structural objective is below the root lower bound (inconsistent).')
  // The invariant `valid => integrityIssues = []`: whatever the aggregation flagged (a disagreeing record, a replay violation, differing runs, an inconsistent bound) keeps the run invalid.
  const noAggregateIntegrityIssues = aggregateIntegrityIssueCount === 0
  if (!noAggregateIntegrityIssues) issues.push(`The aggregated RESULT carries ${aggregateIntegrityIssueCount} integrity issue(s): ${input.integrityIssues.join(' | ')}`)

  return {
    status: issues.length === 0 ? 'valid' : 'invalid', issues,
    checks: {
      registrationGate: gate.length === 0, committedCleanTree, noOverrides, exportRegisteredMatched,
      reproducibility: { requiredRuns, runs: runs.length, measuredRuns: measured.length, allMeasured, noIntegrityIssues, recordsConsistent, semanticHashesEqual, identical: input.determinism.identical },
      rootLowerBoundStage: rootStage, comparisonConsistent, aggregateIntegrityIssueCount, noAggregateIntegrityIssues,
    },
  }
}
