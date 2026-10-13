/**
 * Issue #154 Global Assignment Phase D-0B (Research only; never imported by the app).
 *
 * The Research protocol of the D-0B materialization runner (`docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D0B.md`,
 * `docs/PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md` 9.8 / 9.9 / 10.3 / 10.4 / 14 / 19.7): the conditions one run takes,
 * their validation, the non-formal smoke defaults with the basis of each value, the refusal of a formal run, the
 * classification of one candidate's materialization stage, and the progress journal a child writes so that a run
 * stopped by its envelope still leaves its confirmed progress. Everything is plain data; nothing here reads a file,
 * a clock or the Export.
 *
 * D-0B registers no formal condition (design 19.7, audit 9.1): the delivery cap, the Search scale gate and the
 * envelope depend on the materialization method (案B) and the option set (A-2), so they are pre-registered in
 * D-0B-2 and measured formally in D-0C. Every value here is a provisional non-formal smoke condition. A D-0B run
 * is never a Planner verification: no status here says `verified`, `best_found`, `proven_minimum` or "every
 * Target completed".
 *
 * Phase D-0A-2b adds the rule `d0a2-v2` (`docs/PLANNER_GLOBAL_ASSIGNMENT_D0A2_DESIGN.md` 10.2 / 11 / 12): its conditions are
 * a type of their own with no default gate or budget, its runs write their own protocol version, and its candidate classes
 * (`unconfirmed_shape_search_budget`, `unsupported_shape_prediction`) have their own design 10.3 roles. The `d0a-v1`
 * conditions, smoke defaults, registration items and classes are unchanged, and a formal run is still refused.
 *
 * Phase A-2 adds the option set (`ReachOptionSetVersion`) as the optional condition `reachOptionSet` of either rule. Every
 * D-0B and D-0A-2b record was produced with the a1 option set and carries no such field, so a condition without it means a1
 * (`conditionReachOptionSet()`) and its record stays byte for byte what it was; a run of another option set names it, and its
 * record carries it. The protocol versions are unchanged: the option set is a recorded condition, never inferred.
 *
 * Phase D-0C enables the formal mode of the D-0B-2 registration (`MATERIALIZATION_D0C_PREREGISTRATION.formalRun.enabled`) without
 * changing a registered value; the registration gate (`d0cRegistrationGate()` / `d0cRegistrationGateIssues()`) reads any registration
 * object so that a disabled or incomplete one stays refused. The formal start / child gates and the validity judgement live in
 * `materializationFormal.ts`.
 */
import { compareExportIdentity, parseRegisteredExportIdentity, validateWindowLadder, type ExportIdentity } from './assignmentProtocol'
import { isValidSearchScaleGate } from './materializationScale'
import type { MaterializationStageOutcome, SearchScaleGate } from './materializationTypes'
import { reachWindowW0 } from './reachTable'
import { isValidShapeSearchBudget, isValidShapeSearchScaleGate } from './shapeMaterializationScale'
import type { ShapeSearchBudget, ShapeSearchScaleGate } from './shapeMaterializationTypes'
import { isReachOptionSetVersion, REACH_OPTION_SET_A1, REACH_OPTION_SET_A2, type ReachOptionSetVersion, type ReachWindow } from './types'

/** A-2: the runner's `--option-set` values and the option set each names. */
export const MATERIALIZATION_REACH_OPTION_SETS: Readonly<Record<'a1' | 'a2', ReachOptionSetVersion>> = Object.freeze({ a1: REACH_OPTION_SET_A1, a2: REACH_OPTION_SET_A2 })

export const MATERIALIZATION_D0B_PROTOCOL_VERSION = 'global-assignment-d0b:1'
/**
 * Phase D-0A-2b: the protocol of a run under the rule `d0a2-v2` (design D0A2 11 / 12). A `d0a-v1` run keeps
 * `MATERIALIZATION_D0B_PROTOCOL_VERSION` and its records exactly as D-0B wrote them.
 */
export const MATERIALIZATION_D0A2B_PROTOCOL_VERSION = 'global-assignment-d0a2b:1'
export const MATERIALIZATION_D0B_PHASE = 'Issue #154 Global Assignment Phase D-0B: materialization runner, non-formal smoke and diagnostics (D-0A materialization of Phase C structural candidates; not a Production Plan, not Planner-verified)'
/** The Research record of this Phase (Markdown; its SHA-256 is recorded by the runner). */
export const MATERIALIZATION_D0B_DOC = 'docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D0B.md'
/** The main this Phase started from (PR #245 merged). */
export const MATERIALIZATION_D0B_BASE_MAIN = '531c447314de68c5e93adb7e28b0da1910f98af9'
/** A runner guard of the non-formal smoke (not a registered value): D-0B never materializes many structural candidates. */
export const MATERIALIZATION_SMOKE_MAX_STRUCTURAL_CANDIDATES = 10
/** A runner guard on the determinism repeat of one smoke (two children at most). */
export const MATERIALIZATION_SMOKE_MAX_REPEAT = 2

/**
 * The calculation conditions of one D-0B run (design 10.4: each a different budget). Reaching the node budget
 * is `search_incomplete`, the structural candidate limit a stop after that many candidates, the delivery cap
 * `unconfirmed(delivery_cap_reached)`, the gate `not_executed(search_scale_gate)`; none of them is exhaustion.
 */
export interface MaterializationResearchConditions {
  /** The ReachTable window (Phase A). */
  window: ReachWindow
  /** Expanded node limit of the coverage-gated structural search (Phase C-2). */
  nodeBudget: number
  /** MRV lookahead of that search. */
  mrvLookahead: number
  /** Design 6.3 coverage-driven value ordering: an explicit choice, never defaulted inside the search. */
  coverageDrivenOrdering: boolean
  /** How many structural candidates are collected and materialized, one after another (1 in the smoke). */
  structuralCandidateLimit: number
  /** Design 10.4 delivery cap of one Planner Alternative materialization (passed to D-0A explicitly). */
  deliveryCap: number
  /** Design 9.7 Search scale gate (passed to D-0A explicitly; no implicit unlimited value). */
  searchScaleGate: SearchScaleGate
  /** Design 19.3 G1: Search-policy shapes are classified before any Search. Always true in D-0B. */
  searchPolicyPrecheck: true
  /** A-2: the option set of the ReachTable; absent means a1 (every D-0B record). Under a2 a G2 shape is a Search-policy shape too. */
  reachOptionSet?: ReachOptionSetVersion
}

/**
 * Phase D-0A-2b: the calculation conditions of one run under the rule `d0a2-v2` (design D0A2 10.3 / 10.4 / 11). A type of
 * its own, never a `MaterializationResearchConditions` with extra fields: it carries no delivery cap (no Planner Alternative
 * Search runs) and no Search-policy precheck (a G1 shape is a continuation shape, materialized by the shape-constrained
 * method). Every gate and budget value is the caller's explicit contract; none is a default, and none is registered here
 * (D-0B-2 registers them after a real-Export re-smoke).
 */
export interface ShapeMaterializationResearchConditions {
  rule: 'd0a2-v2'
  window: ReachWindow
  nodeBudget: number
  mrvLookahead: number
  coverageDrivenOrdering: boolean
  structuralCandidateLimit: number
  /** Design 9.2: the gate of the projected Candidate Search a continuous shape tries first (the D-0A gate type and meaning). */
  projectedSearchScaleGate: SearchScaleGate
  /** Design D0A2 10.3: the gate on the shape-constrained Search's predicted scale. */
  shapeSearchScaleGate: ShapeSearchScaleGate
  /** Design D0A2 10.4: the runtime budget of one shape-constrained Search. */
  shapeSearchBudget: ShapeSearchBudget
  /** Design D0A2 13 #7: the independent Route checks run on every shape-constrained materialization. */
  routeVerification: 'every_shape_constrained_materialization'
  /** A-2: the option set of the ReachTable; absent means a1 (every D-0A-2b record). D-0B-2 registers the one it runs. */
  reachOptionSet?: ReachOptionSetVersion
}

/** A-2: the option set a run of these conditions builds its ReachTable with (a1 when the condition is absent). */
export function conditionReachOptionSet(conditions: { reachOptionSet?: ReachOptionSetVersion }): ReachOptionSetVersion {
  return conditions.reachOptionSet ?? REACH_OPTION_SET_A1
}

function reachOptionSetIssues(conditions: Record<string, unknown>): string[] {
  return 'reachOptionSet' in conditions && !isReachOptionSetVersion(conditions.reachOptionSet)
    ? [`reachOptionSet must be ${REACH_OPTION_SET_A1} or ${REACH_OPTION_SET_A2}, or absent for ${REACH_OPTION_SET_A1} (got ${String(conditions.reachOptionSet)}).`]
    : []
}

/** The conditions of either rule: `rule: 'd0a2-v2'` names the new rule, a `d0a-v1` condition carries no rule field at all. */
export type MaterializationRunConditions = MaterializationResearchConditions | ShapeMaterializationResearchConditions

export function isShapeMaterializationConditions(conditions: MaterializationRunConditions): conditions is ShapeMaterializationResearchConditions {
  return (conditions as { rule?: unknown }).rule === 'd0a2-v2'
}

/** The protocol version a run of these conditions writes (`d0a-v1`: the D-0B version, unchanged). */
export function materializationProtocolVersion(conditions: MaterializationRunConditions): string {
  return isShapeMaterializationConditions(conditions) ? MATERIALIZATION_D0A2B_PROTOCOL_VERSION : MATERIALIZATION_D0B_PROTOCOL_VERSION
}

/** Issues of a `d0a2-v2` conditions object; `[]` means valid. */
export function validateShapeMaterializationResearchConditions(value: unknown): string[] {
  if (typeof value !== 'object' || value === null) return ['conditions must be an object.']
  const conditions = value as Record<string, unknown>
  const issues: string[] = []
  if (conditions.rule !== 'd0a2-v2') issues.push(`rule must be d0a2-v2 (got ${String(conditions.rule)}).`)
  const window = conditions.window as Record<string, unknown> | undefined
  if (typeof window !== 'object' || window === null) issues.push('window must be an object with normal / gogma / skill.')
  else issues.push(...validateWindowLadder([window]).map(issue => issue.replace('windowLadder[0]', 'window')))
  for (const field of ['nodeBudget', 'mrvLookahead'] as const) {
    if (!isIntegerIn(conditions[field], 1, Number.MAX_SAFE_INTEGER)) issues.push(`${field} must be a positive integer (got ${String(conditions[field])}).`)
  }
  if (typeof conditions.coverageDrivenOrdering !== 'boolean') issues.push(`coverageDrivenOrdering must be an explicit boolean (got ${String(conditions.coverageDrivenOrdering)}).`)
  if (!isIntegerIn(conditions.structuralCandidateLimit, 1, MATERIALIZATION_SMOKE_MAX_STRUCTURAL_CANDIDATES)) {
    issues.push(`structuralCandidateLimit must be an integer in 1..${MATERIALIZATION_SMOKE_MAX_STRUCTURAL_CANDIDATES} (got ${String(conditions.structuralCandidateLimit)}).`)
  }
  if (!isValidSearchScaleGate(conditions.projectedSearchScaleGate as SearchScaleGate)) {
    issues.push(`projectedSearchScaleGate must name maxConversionPositions / maxGogmaLegalWidth / maxSkillLegalWidth / maxNormalForgeCount as non-negative integers (got ${JSON.stringify(conditions.projectedSearchScaleGate)}).`)
  }
  if (!isValidShapeSearchScaleGate(conditions.shapeSearchScaleGate as ShapeSearchScaleGate)) {
    issues.push(`shapeSearchScaleGate must name maxDepthUpperBound / maxGogmaGeneratedStateUpperBound / maxNormalForgeCount / maxConversionWalkPositions as non-negative integers (got ${JSON.stringify(conditions.shapeSearchScaleGate)}).`)
  }
  if (!isValidShapeSearchBudget(conditions.shapeSearchBudget as ShapeSearchBudget)) {
    issues.push(`shapeSearchBudget must name maxGogmaGeneratedStates / maxSkillStates / maxSettledWork / maxPredictions.{normalArtian, skill, gogmaReset, gogmaKeep} as non-negative integers (got ${JSON.stringify(conditions.shapeSearchBudget)}).`)
  }
  if (conditions.routeVerification !== 'every_shape_constrained_materialization') issues.push(`routeVerification must be every_shape_constrained_materialization (got ${String(conditions.routeVerification)}).`)
  for (const field of ['deliveryCap', 'searchScaleGate', 'searchPolicyPrecheck'] as const) {
    if (field in conditions) issues.push(`${field} belongs to the rule d0a-v1 and is not a d0a2-v2 condition.`)
  }
  issues.push(...reachOptionSetIssues(conditions))
  return issues
}

/** Issues of either rule's conditions: `rule: 'd0a2-v2'` selects the new rule, no `rule` field the D-0B rule `d0a-v1`. */
export function validateMaterializationRunConditions(value: unknown): string[] {
  if (typeof value !== 'object' || value === null) return ['conditions must be an object.']
  if (!('rule' in value)) return validateMaterializationResearchConditions(value)
  const rule = (value as { rule: unknown }).rule
  return rule === 'd0a2-v2' ? validateShapeMaterializationResearchConditions(value) : [`rule must be d0a2-v2, or absent for the rule d0a-v1 (got ${String(rule)}).`]
}

/** The process envelope of one child (the parent applies it; reaching it is unmeasured, never a materialization outcome). */
export interface MaterializationEnvelope {
  childWallMs: number
  childHeapMb: number
  /** Children run one after another with the same task (the determinism check of the semantic record). */
  repeat: number
}

function isIntegerIn(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum
}

/** Issues of a conditions object; `[]` means valid. */
export function validateMaterializationResearchConditions(value: unknown): string[] {
  if (typeof value !== 'object' || value === null) return ['conditions must be an object.']
  const conditions = value as Record<string, unknown>
  const issues: string[] = []
  const window = conditions.window as Record<string, unknown> | undefined
  if (typeof window !== 'object' || window === null) issues.push('window must be an object with normal / gogma / skill.')
  else issues.push(...validateWindowLadder([window]).map(issue => issue.replace('windowLadder[0]', 'window')))
  for (const field of ['nodeBudget', 'mrvLookahead', 'deliveryCap'] as const) {
    if (!isIntegerIn(conditions[field], 1, Number.MAX_SAFE_INTEGER)) issues.push(`${field} must be a positive integer (got ${String(conditions[field])}).`)
  }
  if (typeof conditions.coverageDrivenOrdering !== 'boolean') issues.push(`coverageDrivenOrdering must be an explicit boolean (got ${String(conditions.coverageDrivenOrdering)}).`)
  if (!isIntegerIn(conditions.structuralCandidateLimit, 1, MATERIALIZATION_SMOKE_MAX_STRUCTURAL_CANDIDATES)) {
    issues.push(`structuralCandidateLimit must be an integer in 1..${MATERIALIZATION_SMOKE_MAX_STRUCTURAL_CANDIDATES} (got ${String(conditions.structuralCandidateLimit)}).`)
  }
  if (!isValidSearchScaleGate(conditions.searchScaleGate as SearchScaleGate)) {
    issues.push(`searchScaleGate must name maxConversionPositions / maxGogmaLegalWidth / maxSkillLegalWidth / maxNormalForgeCount as non-negative integers (got ${JSON.stringify(conditions.searchScaleGate)}).`)
  }
  if (conditions.searchPolicyPrecheck !== true) issues.push(`searchPolicyPrecheck must be true in Phase D-0B (got ${String(conditions.searchPolicyPrecheck)}).`)
  issues.push(...reachOptionSetIssues(conditions))
  return issues
}

export function validateMaterializationEnvelope(value: unknown): string[] {
  if (typeof value !== 'object' || value === null) return ['envelope must be an object.']
  const envelope = value as Record<string, unknown>
  const issues: string[] = []
  if (!isIntegerIn(envelope.childWallMs, 1_000, 24 * 60 * 60_000)) issues.push(`childWallMs must be an integer in 1000..86400000 (got ${String(envelope.childWallMs)}).`)
  if (!isIntegerIn(envelope.childHeapMb, 256, 65_536)) issues.push(`childHeapMb must be an integer in 256..65536 (got ${String(envelope.childHeapMb)}).`)
  if (!isIntegerIn(envelope.repeat, 1, MATERIALIZATION_SMOKE_MAX_REPEAT)) issues.push(`repeat must be an integer in 1..${MATERIALIZATION_SMOKE_MAX_REPEAT} (got ${String(envelope.repeat)}).`)
  return issues
}

/** A non-formal smoke value with the basis it was chosen on (design 11.2: `oracleInformed` per item). Never a registered condition. */
export interface SmokeCondition<T> {
  value: T
  basis: string
  oracleInformed: false
}

const W0 = reachWindowW0()

/**
 * The runner defaults of a D-0B non-formal smoke. Conservative on purpose: one structural candidate, the B-2B registered
 * node budget, and a gate that refuses the Skill held-aware Search scale D2-G-A found dangerous. Every value is
 * provisional (D-0B-2 pre-registers the formal ones) and none is derived from the 1,657 oracle or a past RESULT's Target
 * positions.
 */
export const MATERIALIZATION_D0B_SMOKE_DEFAULTS = Object.freeze({
  window: Object.freeze({
    value: Object.freeze({ ...W0 }) as ReachWindow,
    basis: 'W0 = recommendedCandidateSearchDefaults (Issue #125, REQUIREMENTS 14.1; design 10.3), a Production constant of non-oracle origin and the B-2B registered window.',
    oracleInformed: false,
  }) as SmokeCondition<ReachWindow>,
  nodeBudget: Object.freeze({
    value: 2_000,
    basis: 'The B-2B registered node budget (first complete assignment at node 43; C-2 smoke: 1,000 coverage-feasible assignments in 1,043 nodes). One structural candidate needs far fewer nodes; a stop is search_incomplete, never no candidate.',
    oracleInformed: false,
  }) as SmokeCondition<number>,
  mrvLookahead: Object.freeze({
    value: 8,
    basis: 'The B-2B registered MRV lookahead (a Target selection order bound only; every option stays enumerable).',
    oracleInformed: false,
  }) as SmokeCondition<number>,
  coverageDrivenOrdering: Object.freeze({
    value: true,
    basis: 'Design 6.3 adopts the coverage-driven value ordering for the structural candidate generator; the C-2 smoke found the first 1,000 candidates identical with and without it at W0 (the ordering never fired).',
    oracleInformed: false,
  }) as SmokeCondition<boolean>,
  structuralCandidateLimit: Object.freeze({
    value: 1,
    basis: 'The D-0B smoke materializes the first structural candidate only (design 9.8); more candidates are a later, separately justified step.',
    oracleInformed: false,
  }) as SmokeCondition<number>,
  deliveryCap: Object.freeze({
    value: 500,
    basis: 'Provisional: no real-Export delivery distribution exists yet (the D-0A synthetic cases match within the first five deliveries: 0 - 1 in whole-candidate runs, 4 for one Target searched alone under the empty reservation). Each delivered Candidate is materialized and matched, so 500 bounds the per-Target Candidate work while leaving room for the cheaper Ideal Routes that sort before the expected shape inside its extent. A stop is unconfirmed(delivery_cap_reached).',
    oracleInformed: false,
  }) as SmokeCondition<number>,
  searchScaleGate: Object.freeze({
    value: Object.freeze({ maxConversionPositions: 32, maxGogmaLegalWidth: W0.gogma, maxSkillLegalWidth: W0.skill + 1, maxNormalForgeCount: W0.normal }) as SearchScaleGate,
    basis: 'Conversion positions drive the retained Skill held-aware stream (D2-G-A: 255 positions held 2.8 M Skill states and completed; 306 positions at M = 1500 model 60.8 M states and ran out of memory at a 12 GB heap). 32 keeps that term far below the measured completion while a fresh reservation (one conversion position) always passes. The widths and the forge count are set to the W0 window (never binding inside W0): their cost is bounded by the child wall-clock instead, and the smoke measures it.',
    oracleInformed: false,
  }) as SmokeCondition<SearchScaleGate>,
  childWallMs: Object.freeze({
    value: 30 * 60_000,
    basis: 'B-2A / C-2 smoke: Export parse + W0 ReachTable about 14 s and the first structural candidate about 50 s; the materialization cost of 43 Searches is the unknown this smoke measures. 30 minutes stops a runaway Search; reaching it is unmeasured(timeout) with the confirmed progress kept.',
    oracleInformed: false,
  }) as SmokeCondition<number>,
  childHeapMb: Object.freeze({
    value: 4_096,
    basis: 'The B-2B registered assignment child heap (W0 peak RSS about 1.1 GB). Out of memory is recorded only from the V8 heap-limit signature, never inferred.',
    oracleInformed: false,
  }) as SmokeCondition<number>,
  repeat: Object.freeze({
    value: 1,
    basis: 'One isolated child by default (the real-Export smoke). `--repeat 2` runs the same task twice to compare the semantic records.',
    oracleInformed: false,
  }) as SmokeCondition<number>,
})

/** The default conditions and envelope as plain objects. */
export function smokeDefaults(): { conditions: MaterializationResearchConditions; envelope: MaterializationEnvelope } {
  const value = MATERIALIZATION_D0B_SMOKE_DEFAULTS
  return {
    conditions: {
      window: { ...value.window.value }, nodeBudget: value.nodeBudget.value, mrvLookahead: value.mrvLookahead.value, coverageDrivenOrdering: value.coverageDrivenOrdering.value,
      structuralCandidateLimit: value.structuralCandidateLimit.value, deliveryCap: value.deliveryCap.value, searchScaleGate: { ...value.searchScaleGate.value }, searchPolicyPrecheck: true,
    },
    envelope: { childWallMs: value.childWallMs.value, childHeapMb: value.childHeapMb.value, repeat: value.repeat.value },
  }
}

/** The items D-0B-2 pre-registers (design 19.7); none is registered here. */
export const MATERIALIZATION_D0B2_REGISTRATION_ITEMS = Object.freeze([
  'deliveryCap', 'searchScaleGate', 'childWallMs', 'childHeapMb', 'nodeBudget', 'structuralCandidateLimit', 'optionSetVersion', 'methodSelectionRule', 'searchPolicyShapeRule',
] as const)

/**
 * Phase D-0A-2b: the items a `d0a2-v2` run leaves to D-0B-2 (design D0A2 12): none is registered here, and no default exists
 * for the shape method's gate or budget (a `d0a2-v2` run names every value explicitly).
 */
export const MATERIALIZATION_D0A2B_REGISTRATION_ITEMS = Object.freeze([
  'projectedSearchScaleGate', 'shapeSearchScaleGate', 'shapeSearchBudget', 'routeVerification', 'childWallMs', 'childHeapMb', 'nodeBudget', 'structuralCandidateLimit',
  'optionSetVersion', 'methodSelectionRule', 'continuationShapeRule', 'materializationOrderRule',
] as const)

// ---------------------------------------------------------------------------------------------------------------------
// Phase D-0B-2 (`docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D0B2.md`): the D-0C formal measurement conditions, pre-registered
// from the D-0B-2 non-formal re-smokes of the rule `d0a2-v2` with the a2 option set on the real Export. Every item carries
// its value, unit, basis, the non-formal runs it rests on (their RESULT SHA-256 is recorded in the D-0B-2 document, never in
// code: design 11.3), whether it is oracle-informed, and what the evidence did and did not observe. The registered Export
// identity lives in the document's `registered-export-*` block. Phase D-0B-2 enabled no formal run; Phase D-0C enabled it
// (`formalRun`) after auditing that these values and the measurement code are unchanged, and changed no registered value.
// ---------------------------------------------------------------------------------------------------------------------

export const MATERIALIZATION_D0B2_PHASE = 'Issue #154 Global Assignment Phase D-0B-2: non-formal real-Export re-smoke of the rule d0a2-v2 with the a2 option set, and the pre-registration of the D-0C formal conditions (no formal run)'
/** The Research record of Phase D-0B-2; it holds the registered Export identity block and the evidence RESULT hashes. */
export const MATERIALIZATION_D0B2_DOC = 'docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D0B2.md'
/** The main Phase D-0B-2 started from (PR #250 merged). */
export const MATERIALIZATION_D0B2_BASE_MAIN = '0c6758ad9e8fe28f61bc367c613dcc7d3b498c93'

/** A D-0C condition registered in D-0B-2 (design 10.4 / 11.2). Never a default of any runner path. */
export interface D0cRegisteredItem<T> {
  value: T
  /** What the value counts, and in which unit. */
  unit: string
  /** Why this value: the observations and the bounds it was chosen from. */
  basis: string
  /** The D-0B-2 runs (and earlier registered phases) the value rests on, by the run ids of MATERIALIZATION_D0B2_DOC. */
  evidence: readonly string[]
  /** Design 11.2: whether the value was derived from the 1,657 oracle or a past RESULT's Target positions. */
  oracleInformed: boolean
  /** What the evidence observed inside this value. */
  observedRange: string
  /** What the evidence did not observe (never read as "safe", "absent" or "infeasible"). */
  unconfirmedRange: string
}

const W0_REGISTERED = reachWindowW0()
/** Design D0A2 10.3 over W0: the longest own-operation lane windows (Skill: an owned Gogma's origin .. resetSkillsLimit or a conversion's c + 1 .. conversionLimit; Gogma: origin .. origin + window − 1). */
const W0_MAX_SKILL_LANE = W0_REGISTERED.skill
const W0_MAX_GOGMA_LANE = W0_REGISTERED.gogma
const W0_MAX_DEPTH = W0_MAX_SKILL_LANE + W0_MAX_GOGMA_LANE
const R1 = 'd0b2-r1'
const REG = 'd0b2-reg'
const CMP_A1 = 'd0b2-cmp-a1'

/**
 * The D-0C formal conditions of the rule `d0a2-v2` (Phase D-0B-2). Phase D-0B-2 registered them with `formalRun.enabled` false;
 * Phase D-0C enabled the formal run after auditing these values and the calculation-related code against the registration HEAD,
 * changing no other field.
 */
export const MATERIALIZATION_D0C_PREREGISTRATION = Object.freeze({
  registeredIn: 'Phase D-0B-2',
  window: Object.freeze({
    value: Object.freeze({ ...W0_REGISTERED }) as ReachWindow,
    unit: 'Counter positions per stream (Normal forges / Gogma positions / Skill positions)',
    basis: 'W0 = recommendedCandidateSearchDefaults (Issue #125, REQUIREMENTS 14.1), a Production constant of non-oracle origin, the B-2B registered window and the D-0B window. At W0 the first structural candidate materialized every planning Target (all_materialized), so design 10.3 asks for no window expansion.',
    evidence: Object.freeze([R1, REG, CMP_A1, 'B-2B registration']),
    oracleInformed: false,
    observedRange: 'W0 only.',
    unconfirmedRange: 'No other rung was run (W1+ stay unregistered as in B-2B); a materialization outcome at another window is unmeasured.',
  }) as D0cRegisteredItem<ReachWindow>,
  nodeBudget: Object.freeze({
    value: 2_000,
    unit: 'expanded nodes of the coverage-gated structural search (Phase C-2)',
    basis: 'The B-2B registered node budget. The first structural candidate came at node 44 (depth 43) under both option sets a1 and a2; one candidate needs far fewer nodes than 2,000. A stop is search_incomplete, never no candidate.',
    evidence: Object.freeze([R1, REG, CMP_A1, 'B-2B registration']),
    oracleInformed: false,
    observedRange: '44 nodes to the first structural candidate (a1 and a2).',
    unconfirmedRange: 'Nodes beyond the first candidate (the structural candidate limit is 1).',
  }) as D0cRegisteredItem<number>,
  mrvLookahead: Object.freeze({
    value: 8,
    unit: 'design 6.4 lookahead k (options counted per Target for the MRV order; every option stays enumerable)',
    basis: 'The B-2B registered MRV lookahead; the D-0B-2 smokes used it under both option sets and reached the same first candidate.',
    evidence: Object.freeze([R1, REG, CMP_A1, 'B-2B registration']),
    oracleInformed: false,
    observedRange: 'k = 8 only.',
    unconfirmedRange: 'Whether another k reaches another first candidate.',
  }) as D0cRegisteredItem<number>,
  coverageDrivenOrdering: Object.freeze({
    value: true,
    unit: 'boolean (design 6.3 coverage-driven value ordering)',
    basis: 'Design 6.3 adopts it; the C-2 smoke found the first 1,000 candidates identical with and without it at W0, and the D-0B-2 smokes rejected no complete assignment for coverage (the ordering never fired).',
    evidence: Object.freeze([R1, REG, CMP_A1]),
    oracleInformed: false,
    observedRange: '0 coverage rejections before the first candidate.',
    unconfirmedRange: 'Inputs where the ordering fires.',
  }) as D0cRegisteredItem<boolean>,
  structuralCandidateLimit: Object.freeze({
    value: 1,
    unit: 'structural candidates collected and materialized per run',
    basis: 'Design 9.8: D-0 measures the materialization of the first structural candidate. That candidate was all_materialized; more candidates are a separately justified step (the D-1 verification budget).',
    evidence: Object.freeze([R1, REG, CMP_A1]),
    oracleInformed: false,
    observedRange: 'Structural candidate ordinal 0.',
    unconfirmedRange: 'Later structural candidates are not materialized; their materialization outcome is unmeasured.',
  }) as D0cRegisteredItem<number>,
  optionSetVersion: Object.freeze({
    value: REACH_OPTION_SET_A2,
    unit: 'Phase A option set version (ReachOptionSetVersion)',
    basis: 'Phase A-2 (design 19.8): a2 adds the owned-Gogma current-Ideal lane continuations (G2) and leaves the a1 options unchanged. Under a2 the first structural candidate of the real Export equals the a1 one (objective, stream ends, materialization order and every option equal; only 6 more Gogma-position rejections while counting).',
    evidence: Object.freeze([R1, REG, CMP_A1]),
    oracleInformed: false,
    observedRange: 'The first candidate chooses no G1 / G2 continuation option.',
    unconfirmedRange: 'The materialization of a G1 / G2 continuation shape on the real Export (synthetic only, design D0A2 19.6 / 20.2).',
  }) as D0cRegisteredItem<typeof REACH_OPTION_SET_A2>,
  methodSelectionRule: Object.freeze({
    value: 'd0a2-v2' as const,
    unit: 'materialization rule (design D0A2 11)',
    basis: 'Continuation shapes (G1, G2) by shape_constrained only, continuous shapes by the projected Candidate Search first and shape_constrained once when it does not match, non-continuous shapes by shape_constrained only; no Planner Alternative Search.',
    evidence: Object.freeze([R1, REG, CMP_A1]),
    oracleInformed: false,
    observedRange: '21 continuous shapes materialized by the projected Candidate Search, 22 non-continuous shapes by shape_constrained.',
    unconfirmedRange: 'The continuous → shape_constrained fallback and the continuation path on the real Export (neither occurred).',
  }) as D0cRegisteredItem<'d0a2-v2'>,
  continuationShapeRule: Object.freeze({
    value: Object.freeze(['lane_start_ideal_skill_continuation', 'lane_start_ideal_owned_gogma_continuation'] as const),
    unit: 'continuation shape policies of CONTINUATION_SHAPE_DETECTORS (G1, G2)',
    basis: 'Design D0A2 6.1 / 6.2 / 20.1: the G1 conversion continuation and the A-2 G2 owned-Gogma continuation are continuation shapes, materialized by shape_constrained only; their d0a-v1 classification not_executed(search_policy_shape) never occurs under d0a2-v2.',
    evidence: Object.freeze([R1, REG]),
    oracleInformed: false,
    observedRange: '0 continuation shapes in the first candidate.',
    unconfirmedRange: 'A continuation shape on the real Export.',
  }) as D0cRegisteredItem<readonly ('lane_start_ideal_skill_continuation' | 'lane_start_ideal_owned_gogma_continuation')[]>,
  projectedSearchScaleGate: Object.freeze({
    value: Object.freeze({ maxConversionPositions: 32, maxGogmaLegalWidth: W0_REGISTERED.gogma, maxSkillLegalWidth: W0_REGISTERED.skill + 1, maxNormalForgeCount: W0_REGISTERED.normal }) as SearchScaleGate,
    unit: 'design 9.7 predicted scale of the projected Candidate Search (conversion positions / Gogma legal width / Skill legal width / Normal forges)',
    basis: 'The D-0B gate: conversion positions bounded by the D2-G-A Skill held-aware measurement (a projected start has one conversion position), widths and forges at W0 (never binding inside W0). The 21 projected Searches predicted at most 1 / 66 / 531 / 206 and none was refused.',
    evidence: Object.freeze([R1, REG, 'D-0B smoke defaults']),
    oracleInformed: false,
    observedRange: 'Predicted at most 1 conversion position, Gogma width 66, Skill width 531, 206 forges.',
    unconfirmedRange: 'A projected Search near the W0 widths.',
  }) as D0cRegisteredItem<SearchScaleGate>,
  shapeSearchScaleGate: Object.freeze({
    value: Object.freeze({
      maxDepthUpperBound: W0_MAX_DEPTH,
      maxGogmaGeneratedStateUpperBound: W0_MAX_DEPTH * W0_MAX_GOGMA_LANE * (W0_MAX_GOGMA_LANE + 2),
      maxNormalForgeCount: W0_REGISTERED.normal,
      maxConversionWalkPositions: W0_REGISTERED.skill + 1,
    }) as ShapeSearchScaleGate,
    unit: 'design D0A2 10.3 predicted upper bounds (own-operation depth / Gogma generated states / Normal forges / conversion walk positions)',
    basis: 'Each component at its W0 maximum (depth ≤ Skill lane 1,500 + Gogma lane 500; generated states ≤ depth × 500 non-blocked positions × (held run 500 + 2); forges ≤ 350; walk ≤ 1,501 Skill positions), so the gate refuses no W0 Search. The predicted upper bound is no cost estimate: over the 22 executed shape-constrained Searches it exceeded the generated states by 4.5x to 470x (largest bound 21,462,381 for 45,690 states, 0.44 s), so no value below the W0 maximum has a measured cost basis. The runtime cost is bounded by shapeSearchBudget instead.',
    evidence: Object.freeze([R1, REG]),
    oracleInformed: false,
    observedRange: 'Predicted at most depth 321, 21,462,381 generated states, 1 forge, 70 walk positions; 0 refusals.',
    unconfirmedRange: 'A Search with an upper bound near the W0 maximum (its actual cost is bounded by the budget, not by the gate).',
  }) as D0cRegisteredItem<ShapeSearchScaleGate>,
  shapeSearchBudget: Object.freeze({
    value: Object.freeze({
      maxGogmaGeneratedStates: 50_000_000,
      maxSkillStates: W0_MAX_SKILL_LANE * W0_MAX_SKILL_LANE,
      maxSettledWork: 100_000,
      maxPredictions: Object.freeze({ normalArtian: W0_REGISTERED.normal, skill: W0_REGISTERED.skill + 1, gogmaReset: W0_REGISTERED.gogma, gogmaKeep: W0_REGISTERED.gogma }),
    }) as ShapeSearchBudget,
    unit: 'design D0A2 10.4 runtime usage of one shape-constrained Search (Gogma generated states / Skill states / settled work items / Production prediction calls per kind)',
    basis: 'Gogma generated states 50,000,000: the observed maximum was 121,959 (about 1.9 µs per state); the largest held-aware Gogma Search D-0B completed generated 73.08 M states in 133 s at heapUsed 2.53 GB under a 4 GB heap, so 50 M stays inside that observed-completed region. Skill states 2,250,000 = the W0 bound (depth ≤ 1,500 × one state per position of a ≤ 1,500-position window; D2-G-A completed 2.8 M Skill states). Settled work 100,000: work tracked depth (work / depth ≤ 2.3), so about 4,600 at the W0 depth bound; 100,000 stops only a runaway scheduler. Predictions: the memo keys (Skill: Skill Counter, shared with the conversion Skill; Reset: Gogma Counter; Keep: Gogma Counter × family layout, one layout under the shape policy; Normal: the production target alone) bound them by the W0 positions 350 / 1,501 / 500 / 500.',
    evidence: Object.freeze([R1, REG, 'D-0B smoke (73.08 M states)', 'D2-G-A']),
    oracleInformed: false,
    observedRange: 'At most 121,959 Gogma generated states, 27,539 Skill states, 397 settled work items, 1 / 532 / 171 / 293 Normal / Skill / Reset / Keep predictions; 0 budget stops.',
    unconfirmedRange: 'A shape-constrained Search above 121,959 Gogma generated states (time and memory between that and 50 M are extrapolated, not measured for this method).',
  }) as D0cRegisteredItem<ShapeSearchBudget>,
  routeVerification: Object.freeze({
    value: 'every_shape_constrained_materialization' as const,
    unit: 'when the design D0A2 9.3 independent Route checks run',
    basis: 'Design D0A2 13 #7: every shape-constrained Entry is re-predicted operation by operation before it is accepted; a failure fails closed (route_verification_failed).',
    evidence: Object.freeze([R1, REG]),
    oracleInformed: false,
    observedRange: 'Every shape-constrained materialization passed its Route checks.',
    unconfirmedRange: 'Production Planner and Trace Replay verification (D-1): passed Route checks are not "verified".',
  }) as D0cRegisteredItem<'every_shape_constrained_materialization'>,
  materializationOrderRule: Object.freeze({
    value: 'phase-c-design-8.2' as const,
    unit: 'rule identifier of deriveMaterializationOrder() (Phase C-1)',
    basis: 'Design D0A2 8: the Phase C order is kept (conversion Targets by conversion position, each after the coverers of its Skill positions below it; then the others by largest stream advance, Target ID tie-break). Under it every planning Target materialized.',
    evidence: Object.freeze([R1, REG]),
    oracleInformed: false,
    observedRange: 'The order of the first structural candidate (5 Skill dependencies).',
    unconfirmedRange: 'Another order (the order v2 of design D0A2 8.3 is not planned).',
  }) as D0cRegisteredItem<'phase-c-design-8.2'>,
  childWallMs: Object.freeze({
    value: 30 * 60_000,
    unit: 'milliseconds of one child process (wall-clock)',
    basis: 'The child took 34.3 s (ReachTable 11.6 s, structural search 18.3 s, materialization 1.8 s); 30 minutes is about 50x that and also covers the D-0B d0a-v1 child (235 s). Reaching it is unmeasured(timeout) with the confirmed progress kept.',
    evidence: Object.freeze([R1, REG]),
    oracleInformed: false,
    observedRange: 'About 34 s per child.',
    unconfirmedRange: 'A child near the budget-bounded worst case (each Search up to the registered budget).',
  }) as D0cRegisteredItem<number>,
  childHeapMb: Object.freeze({
    value: 4_096,
    unit: 'MB passed as --max-old-space-size to one child',
    basis: 'heapUsed peaked at 0.96 GB (RSS 1.19 GB) in the exploratory run under an 8 GB limit, dominated by the ReachTable and structural search; 4,096 MB is the B-2B / D-0B child heap and about 4x that. Out of memory is recorded only from the V8 heap-limit signature.',
    evidence: Object.freeze([R1, REG, 'B-2B registration']),
    oracleInformed: false,
    observedRange: 'heapUsed at most about 1 GB.',
    unconfirmedRange: 'Memory of a shape-constrained Search near the registered budget.',
  }) as D0cRegisteredItem<number>,
  repeat: Object.freeze({
    value: 2,
    unit: 'children per run, one after another; their semantic records must hash equal',
    basis: 'Design 12 determinism: two isolated children with the same task; the run is valid only when both semantic SHA-256 are identical (times and memory excluded).',
    evidence: Object.freeze([REG]),
    oracleInformed: false,
    observedRange: 'Two children with one semantic SHA-256.',
    unconfirmedRange: 'Determinism on another machine or Node version.',
  }) as D0cRegisteredItem<number>,
  exportIdentity: Object.freeze({
    value: 'registered-export-block' as const,
    unit: `the registered-export-file / -bytes / -sha256 block of ${MATERIALIZATION_D0B2_DOC} (the B-2B registered Export)`,
    basis: 'The Export of B-2B and D-0B, verified by name, byte length and SHA-256 before every D-0B-2 run. The hash lives in the document only (design 11.3).',
    evidence: Object.freeze([R1, REG, CMP_A1]),
    oracleInformed: false,
    observedRange: 'That one Export.',
    unconfirmedRange: 'Any other Export.',
  }) as D0cRegisteredItem<'registered-export-block'>,
  calculationContext: Object.freeze({
    value: Object.freeze({ gameVersion: 'unknown-initial', masterDataVersion: 4, rngEngineVersion: 'production-rng:c5-e7', appSchemaVersion: 17 }),
    unit: 'CalculationContext of the restored PlannerInput, with the Production RNG Engine version',
    basis: 'The CalculationContext and Engine version every D-0B-2 child recorded. D-0C refuses a run whose child records another value (a version change asks for a new registration).',
    evidence: Object.freeze([R1, REG, CMP_A1]),
    oracleInformed: false,
    observedRange: 'This CalculationContext only.',
    unconfirmedRange: 'Any other Master data, Engine or calculation version.',
  }) as D0cRegisteredItem<{ gameVersion: string; masterDataVersion: number; rngEngineVersion: string; appSchemaVersion: number }>,
  researchProtocolVersion: Object.freeze({
    value: MATERIALIZATION_D0A2B_PROTOCOL_VERSION,
    unit: 'runner protocol version of a d0a2-v2 run',
    basis: 'The protocol every d0a2-v2 record of D-0B-2 carries; the registration adds no record field to the protocol.',
    evidence: Object.freeze([R1, REG, CMP_A1]),
    oracleInformed: false,
    observedRange: 'This protocol only.',
    unconfirmedRange: '—',
  }) as D0cRegisteredItem<typeof MATERIALIZATION_D0A2B_PROTOCOL_VERSION>,
  repositoryRule: Object.freeze({
    value: 'clean_head_no_uncommitted_code_calculation_diff_audited' as const,
    unit: 'start rule of a formal run',
    basis: 'A formal child starts only from a clean working tree without uncommitted benchmark code, records HEAD and the benchmark code SHA-256 (git ls-files contents of src / scripts / build config), and D-0C reports the calculation-related code diff between the registration HEAD and its own HEAD: any change there asks for these values to be re-checked against the measurement code before a formal run.',
    evidence: Object.freeze([REG]),
    oracleInformed: false,
    observedRange: 'Every D-0B-2 evidence run started clean at its recorded HEAD.',
    unconfirmedRange: '—',
  }) as D0cRegisteredItem<'clean_head_no_uncommitted_code_calculation_diff_audited'>,
  concurrency: 1,
  retry: 'none',
  formalRun: Object.freeze({
    enabled: true,
    enabledBy: 'Phase D-0C: the formal mode of the D-0B-2 registration, enabled without changing a registered value (docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D0C.md)',
    startsIn: 'D-0C',
  }),
})

/** Items D-0B-2 registers beyond MATERIALIZATION_D0A2B_REGISTRATION_ITEMS (the user's D-0B-2 list). */
export const MATERIALIZATION_D0C_EXTRA_REGISTRATION_ITEMS = Object.freeze([
  'window', 'mrvLookahead', 'coverageDrivenOrdering', 'repeat', 'exportIdentity', 'calculationContext', 'researchProtocolVersion', 'repositoryRule',
] as const)

type D0cItemKey = Exclude<keyof typeof MATERIALIZATION_D0C_PREREGISTRATION, 'registeredIn' | 'concurrency' | 'retry' | 'formalRun'>
/** A registration object of the D-0C shape (the real one by default; D-0C tests pass disabled or incomplete ones). */
export type D0cRegistration = typeof MATERIALIZATION_D0C_PREREGISTRATION

/** Missing or invalid registered items, by name; `[]` means the D-0C registration is complete. Never a filled-in default. */
export function materializationD0cRegistrationIssues(registration: D0cRegistration = MATERIALIZATION_D0C_PREREGISTRATION): string[] {
  const items = registration as unknown as Record<string, Partial<D0cRegisteredItem<unknown>> | undefined>
  const issues: string[] = []
  for (const key of [...MATERIALIZATION_D0A2B_REGISTRATION_ITEMS, ...MATERIALIZATION_D0C_EXTRA_REGISTRATION_ITEMS]) {
    const item = items[key]
    if (item === undefined || item === null || item.value === undefined || item.value === null) { issues.push(`${key} is not registered.`); continue }
    for (const field of ['unit', 'basis'] as const) if (typeof item[field] !== 'string' || item[field]!.length < 3) issues.push(`${key}.${field} is missing.`)
    if (!Array.isArray(item.evidence) || item.evidence.length === 0) issues.push(`${key}.evidence is missing.`)
    if (typeof item.oracleInformed !== 'boolean') issues.push(`${key}.oracleInformed is missing.`)
    for (const field of ['observedRange', 'unconfirmedRange'] as const) if (typeof item[field] !== 'string' || item[field]!.length === 0) issues.push(`${key}.${field} is missing.`)
  }
  // The conditions are assembled only from a registration whose items are all present (never with a filled-in value).
  if (issues.length > 0) return issues
  const { conditions, envelope } = registeredD0cConditions(registration)
  issues.push(...validateShapeMaterializationResearchConditions(conditions).map(issue => `registered conditions: ${issue}`))
  issues.push(...validateMaterializationEnvelope(envelope).map(issue => `registered envelope: ${issue}`))
  return issues
}

/** The registered D-0C conditions and envelope as plain objects (the runner's d0a2-v2 condition shape). */
export function registeredD0cConditions(registration: D0cRegistration = MATERIALIZATION_D0C_PREREGISTRATION): { conditions: ShapeMaterializationResearchConditions; envelope: MaterializationEnvelope } {
  return {
    conditions: {
      rule: registration.methodSelectionRule.value,
      window: { ...registration.window.value },
      nodeBudget: registration.nodeBudget.value,
      mrvLookahead: registration.mrvLookahead.value,
      coverageDrivenOrdering: registration.coverageDrivenOrdering.value,
      structuralCandidateLimit: registration.structuralCandidateLimit.value,
      projectedSearchScaleGate: { ...registration.projectedSearchScaleGate.value },
      shapeSearchScaleGate: { ...registration.shapeSearchScaleGate.value },
      shapeSearchBudget: { ...registration.shapeSearchBudget.value, maxPredictions: { ...registration.shapeSearchBudget.value.maxPredictions } },
      routeVerification: registration.routeVerification.value,
      reachOptionSet: registration.optionSetVersion.value,
    },
    envelope: { childWallMs: registration.childWallMs.value, childHeapMb: registration.childHeapMb.value, repeat: registration.repeat.value },
  }
}

const D0C_COMPARED_CONDITIONS: readonly (keyof ShapeMaterializationResearchConditions)[] = [
  'rule', 'window', 'nodeBudget', 'mrvLookahead', 'coverageDrivenOrdering', 'structuralCandidateLimit', 'projectedSearchScaleGate', 'shapeSearchScaleGate',
  'shapeSearchBudget', 'routeVerification', 'reachOptionSet',
]

/**
 * How a run's conditions and envelope differ from the D-0C registration, one line per differing field (`[]`: the run used exactly the
 * registered values). A smoke records it; it never changes a run, and an absent option set is a1, never the registered a2.
 */
export function differencesFromD0cRegistration(conditions: MaterializationRunConditions, envelope: MaterializationEnvelope): string[] {
  const registered = registeredD0cConditions()
  const actual: Record<string, unknown> = {
    ...(conditions as unknown as Record<string, unknown>), rule: isShapeMaterializationConditions(conditions) ? conditions.rule : 'd0a-v1', reachOptionSet: conditionReachOptionSet(conditions),
  }
  const differences: string[] = []
  for (const key of D0C_COMPARED_CONDITIONS) {
    const want = (registered.conditions as unknown as Record<string, unknown>)[key]
    if (JSON.stringify(actual[key]) !== JSON.stringify(want)) differences.push(`${key}: ${JSON.stringify(actual[key] ?? null)} (registered ${JSON.stringify(want)})`)
  }
  for (const key of ['childWallMs', 'childHeapMb', 'repeat'] as const) {
    if (envelope[key] !== registered.envelope[key]) differences.push(`${key}: ${envelope[key]} (registered ${registered.envelope[key]})`)
  }
  return differences
}

/**
 * The registered D-0C Export identity, read from the text of MATERIALIZATION_D0B2_DOC with the B-2B parser (exactly one
 * `registered-export-file` / `-bytes` / `-sha256` line each; anything else is an issue, never a guessed identity).
 */
export function readD0cRegisteredExportIdentity(markdown: string): { identity: ExportIdentity; issues: [] } | { identity: null; issues: string[] } {
  return parseRegisteredExportIdentity(markdown)
}

/** Field-by-field differences between an Export and the registered identity (`[]`: the same Export). */
export function d0cExportIdentityDifferences(actual: ExportIdentity, registered: ExportIdentity): string[] {
  return compareExportIdentity(actual, registered)
}

/** The D-0C item keys with a value (for the RESULT and the tests). */
export function d0cRegisteredItemKeys(): D0cItemKey[] {
  return Object.keys(MATERIALIZATION_D0C_PREREGISTRATION).filter((key): key is D0cItemKey => !['registeredIn', 'concurrency', 'retry', 'formalRun'].includes(key))
}

/** The registration gate a formal parent and every formal child apply (Phase D-0C): the formal run enabled, every item registered. */
export interface D0cRegistrationGate {
  formalRunEnabled: boolean
  /** `materializationD0cRegistrationIssues()` of the registration (`[]` = complete). */
  registrationIssues: readonly string[]
}

export function d0cRegistrationGate(registration: D0cRegistration = MATERIALIZATION_D0C_PREREGISTRATION): D0cRegistrationGate {
  return { formalRunEnabled: (registration.formalRun as { enabled?: unknown } | undefined)?.enabled === true, registrationIssues: materializationD0cRegistrationIssues(registration) }
}

export function d0cRegistrationGateIssues(gate: D0cRegistrationGate): string[] {
  const issues: string[] = []
  if (!gate.formalRunEnabled) {
    issues.push('A formal run is not enabled (MATERIALIZATION_D0C_PREREGISTRATION.formalRun.enabled is false). The formal mode exists for the D-0B-2 registration of the rule d0a2-v2 only; use --mode smoke.')
  }
  if (gate.registrationIssues.length > 0) issues.push(`The D-0C pre-registration is incomplete: ${gate.registrationIssues.join(' ')}`)
  return issues
}

/**
 * Why a formal run must not start by its registration alone (`[]` = the registration lets it start; the formal start gate of
 * `materializationFormal.ts` decides the rest). D-0B registered no formal condition (design 19.7), D-0B-2 registered the D-0C
 * conditions with the formal mode disabled, and D-0C enabled it. A disabled or incomplete registration is refused.
 */
export function materializationFormalRunIssues(registration: D0cRegistration = MATERIALIZATION_D0C_PREREGISTRATION): string[] {
  return d0cRegistrationGateIssues(d0cRegistrationGate(registration))
}

/** How one structural candidate's materialization stage ended (design 4.6 / 9.6), with the D-0B Search-policy distinction. */
export type CandidateMaterializationClass =
  /** Every planning Target has a matching Entry. The Planner has not run (Phase D'): not verified. */
  | 'all_materialized'
  /** Design 9.1 Search exhausted (`summary.exhausted`) without the shape: the one executed mismatch. */
  | 'executed_shape_mismatch'
  | 'unconfirmed_stopped_by_extent'
  | 'unconfirmed_delivery_cap'
  /** Design 19.3 G1: a Search-policy shape, classified before any Search. */
  | 'not_executed_search_policy'
  | 'not_executed_search_scale_gate'
  | 'unmeasured_cancelled'
  /** A fail-closed stop of the run (`GlobalAssignmentMaterializationError` / `GlobalAssignmentInvariantError`): an error of the run, never an outcome. */
  | 'fail_closed'
  /** D-0A-2b (design D0A2 10.2): the shape-constrained Search stopped at its Research budget. */
  | 'unconfirmed_shape_search_budget'
  /** D-0A-2b (design D0A2 10.2): a needed prediction or capability the Engine does not offer (Phase A did not judge it supported). */
  | 'unsupported_shape_prediction'

export function classifyMaterializationStage(stage: MaterializationStageOutcome): CandidateMaterializationClass {
  if (stage.kind === 'all_materialized') return 'all_materialized'
  if (stage.kind === 'materialization_failed') return 'executed_shape_mismatch'
  if (stage.kind === 'materialization_unsupported') return 'unsupported_shape_prediction'
  const outcome = stage.outcome
  switch (outcome.kind) {
    case 'unconfirmed':
      if (outcome.reason === 'shape_search_budget_reached') return 'unconfirmed_shape_search_budget'
      return outcome.reason === 'stopped_by_extent' ? 'unconfirmed_stopped_by_extent' : 'unconfirmed_delivery_cap'
    case 'not_executed':
      return outcome.reason === 'search_policy_shape' ? 'not_executed_search_policy' : 'not_executed_search_scale_gate'
    case 'unmeasured':
      if (outcome.reason !== 'cancelled') throw new RangeError(`An in-process materialization never assigns unmeasured(${outcome.reason}); only the parent process does.`)
      return 'unmeasured_cancelled'
  }
}

/**
 * The design 10.3 role of a class (D-0B fixes the Search-policy row): what the class may and may not be read as when a
 * window, a setting or the method is reviewed. No role says a Route or a feasible Plan does not exist.
 */
export interface MaterializationFollowUp {
  /** `planner_verification_pending`: only Phase D' decides. `executed_mismatch`: counts with `materialization_failed`. `settings_review`: an unconfirmed / not executed / unmeasured cause (extent, cap, gate, budget, envelope). `method_extension`: the Search policy, so the method (design 19.5 案B) and not a window, cap, gate or envelope. `support_review` (D-0A-2b): the Engine's support / capability, never a setting or a window. `run_error`: fail closed. */
  followUp: 'planner_verification_pending' | 'executed_mismatch' | 'settings_review' | 'method_extension' | 'support_review' | 'run_error'
  /** Whether design 10.3 may count it toward a window expansion (only an executed mismatch, and only when every candidate of an exhausted window ends so). */
  windowExpansionBasis: boolean
  /** Whether it asks for the cap / gate / envelope / extent review of design 10.3 before any expansion. */
  settingsReviewBasis: boolean
}

export function materializationFollowUp(kind: CandidateMaterializationClass): MaterializationFollowUp {
  switch (kind) {
    case 'all_materialized':
      return { followUp: 'planner_verification_pending', windowExpansionBasis: false, settingsReviewBasis: false }
    case 'executed_shape_mismatch':
      return { followUp: 'executed_mismatch', windowExpansionBasis: true, settingsReviewBasis: false }
    case 'unconfirmed_stopped_by_extent':
    case 'unconfirmed_delivery_cap':
    case 'not_executed_search_scale_gate':
    case 'unmeasured_cancelled':
      return { followUp: 'settings_review', windowExpansionBasis: false, settingsReviewBasis: true }
    case 'not_executed_search_policy':
      return { followUp: 'method_extension', windowExpansionBasis: false, settingsReviewBasis: false }
    case 'fail_closed':
      return { followUp: 'run_error', windowExpansionBasis: false, settingsReviewBasis: false }
    case 'unconfirmed_shape_search_budget':
      return { followUp: 'settings_review', windowExpansionBasis: false, settingsReviewBasis: true }
    case 'unsupported_shape_prediction':
      return { followUp: 'support_review', windowExpansionBasis: false, settingsReviewBasis: false }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Progress journal. A child appends one JSON object per line as it goes, synchronously, so a run its envelope stops
// still leaves what it confirmed. The parent reads it only when the child produced no record; a Target that started and
// did not settle stays "in progress" with no outcome (never inferred).
// ---------------------------------------------------------------------------------------------------------------------

/** A short, plain outcome of a settled Target (journal and RESULT). */
export interface TargetOutcomeBrief {
  kind: 'materialized' | 'shape_mismatch' | 'unconfirmed' | 'not_executed' | 'unmeasured' | 'unsupported'
  reason: string | null
  method: string | null
  delivered: number | null
  deliveredBeforeMatch: number | null
}

export type MaterializationProgressEvent =
  | { kind: 'context'; status: 'context' | 'unsupported_input'; planningTargetCount: number; reason: string | null }
  | { kind: 'reach_table'; status: 'reach_table' | 'unsupported_input' | 'cancelled'; predictions: { skill: number; gogmaReset: number; gogmaKeep: number; normal: number } | null }
  | { kind: 'structural_candidate'; candidateIndex: number; ordinal: number; objective: number; expandedNodes: number }
  | { kind: 'structural_search'; status: string; completeness: string | null; expandedNodes: number; structuralCandidates: number; coverageRejections: number }
  | { kind: 'candidate_started'; candidateIndex: number; ordinal: number; objective: number; targetCount: number }
  | { kind: 'target_started'; candidateIndex: number; orderIndex: number; targetWeaponId: string }
  | { kind: 'target_settled'; candidateIndex: number; orderIndex: number; targetWeaponId: string; outcome: TargetOutcomeBrief }
  | { kind: 'candidate_settled'; candidateIndex: number; classification: CandidateMaterializationClass; materializedTargetCount: number; notAttemptedTargetCount: number }

export type ProgressJournalLine =
  | { kind: 'started'; atMs: number; pid: number }
  | { kind: 'progress'; atMs: number; event: MaterializationProgressEvent }
  | { kind: 'memory'; atMs: number; heapUsed: number; heapTotal: number; rss: number; external: number }
  | { kind: 'finished'; atMs: number }

/** What a journal confirms. Only settled facts; the Target in progress (if any) carries no outcome. */
export interface ConfirmedProgress {
  lines: number
  /** Unparsable lines (a line cut by a kill is expected only at the end). */
  malformedLines: number
  started: boolean
  finished: boolean
  lastAtMs: number | null
  context: Extract<MaterializationProgressEvent, { kind: 'context' }> | null
  reachTable: { event: Extract<MaterializationProgressEvent, { kind: 'reach_table' }>; atMs: number } | null
  structuralCandidates: { candidateIndex: number; ordinal: number; objective: number; expandedNodes: number; atMs: number }[]
  structuralSearch: { event: Extract<MaterializationProgressEvent, { kind: 'structural_search' }>; atMs: number } | null
  candidates: {
    candidateIndex: number
    ordinal: number
    objective: number
    targetCount: number
    settledTargets: { orderIndex: number; targetWeaponId: string; outcome: TargetOutcomeBrief; startedAtMs: number | null; settledAtMs: number }[]
    /** A Target that started and did not settle before the journal ended: its result is unknown, never inferred. */
    targetInProgress: { orderIndex: number; targetWeaponId: string; startedAtMs: number } | null
    settled: { classification: CandidateMaterializationClass; materializedTargetCount: number; notAttemptedTargetCount: number; atMs: number } | null
  }[]
  memory: { samples: number; last: { atMs: number; heapUsed: number; heapTotal: number; rss: number } | null; maxHeapUsed: number; maxRss: number }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Reads a progress journal (the text of the file). Never throws on a malformed line; counts it instead. */
export function parseProgressJournal(text: string): ConfirmedProgress {
  const progress: ConfirmedProgress = {
    lines: 0, malformedLines: 0, started: false, finished: false, lastAtMs: null, context: null, reachTable: null, structuralCandidates: [], structuralSearch: null,
    candidates: [], memory: { samples: 0, last: null, maxHeapUsed: 0, maxRss: 0 },
  }
  for (const raw of text.split(/\r?\n/)) {
    if (raw.trim() === '') continue
    progress.lines += 1
    let line: unknown
    try {
      line = JSON.parse(raw)
    } catch {
      progress.malformedLines += 1
      continue
    }
    if (!isRecord(line) || typeof line.kind !== 'string' || typeof line.atMs !== 'number') { progress.malformedLines += 1; continue }
    progress.lastAtMs = line.atMs
    const parsed = line as ProgressJournalLine
    if (parsed.kind === 'started') { progress.started = true; continue }
    if (parsed.kind === 'finished') { progress.finished = true; continue }
    if (parsed.kind === 'memory') {
      progress.memory.samples += 1
      progress.memory.last = { atMs: parsed.atMs, heapUsed: parsed.heapUsed, heapTotal: parsed.heapTotal, rss: parsed.rss }
      progress.memory.maxHeapUsed = Math.max(progress.memory.maxHeapUsed, parsed.heapUsed)
      progress.memory.maxRss = Math.max(progress.memory.maxRss, parsed.rss)
      continue
    }
    if (parsed.kind !== 'progress' || !isRecord(parsed.event)) { progress.malformedLines += 1; continue }
    const event = parsed.event
    const candidate = (index: number) => progress.candidates.find(value => value.candidateIndex === index) ?? null
    switch (event.kind) {
      case 'context': progress.context = event; break
      case 'reach_table': progress.reachTable = { event, atMs: parsed.atMs }; break
      case 'structural_candidate': progress.structuralCandidates.push({ candidateIndex: event.candidateIndex, ordinal: event.ordinal, objective: event.objective, expandedNodes: event.expandedNodes, atMs: parsed.atMs }); break
      case 'structural_search': progress.structuralSearch = { event, atMs: parsed.atMs }; break
      case 'candidate_started':
        progress.candidates.push({ candidateIndex: event.candidateIndex, ordinal: event.ordinal, objective: event.objective, targetCount: event.targetCount, settledTargets: [], targetInProgress: null, settled: null })
        break
      case 'target_started': {
        const owner = candidate(event.candidateIndex)
        if (owner) owner.targetInProgress = { orderIndex: event.orderIndex, targetWeaponId: event.targetWeaponId, startedAtMs: parsed.atMs }
        else progress.malformedLines += 1
        break
      }
      case 'target_settled': {
        const owner = candidate(event.candidateIndex)
        if (!owner) { progress.malformedLines += 1; break }
        const startedAtMs = owner.targetInProgress?.orderIndex === event.orderIndex ? owner.targetInProgress.startedAtMs : null
        owner.settledTargets.push({ orderIndex: event.orderIndex, targetWeaponId: event.targetWeaponId, outcome: event.outcome, startedAtMs, settledAtMs: parsed.atMs })
        owner.targetInProgress = null
        break
      }
      case 'candidate_settled': {
        const owner = candidate(event.candidateIndex)
        if (owner) owner.settled = { classification: event.classification, materializedTargetCount: event.materializedTargetCount, notAttemptedTargetCount: event.notAttemptedTargetCount, atMs: parsed.atMs }
        else progress.malformedLines += 1
        break
      }
      default: progress.malformedLines += 1
    }
  }
  return progress
}
