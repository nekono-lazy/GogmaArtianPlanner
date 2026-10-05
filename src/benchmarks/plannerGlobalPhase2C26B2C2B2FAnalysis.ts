/**
 * Issue #154 Phase 2-C2.6-B2-C2B2F post-hoc analysis only. It reads the finished B2-C2B2F raw run, the durable profile snapshots
 * its Search child wrote (heartbeats, window boundaries, the final one when the Search completed) and the runner start attestation,
 * and, as explicit analyzer arguments AFTER the run ended, the probe manifest, the Export (to re-derive the excluded current Route)
 * and the committed B2-C2B2E RESULT (the population source and the identity authority). It runs no Search and feeds nothing back.
 *
 * The outer categories are a partition of the Search wall time (the `search_runtime` inclusive time) along the registered section
 * hierarchy, so nothing is counted twice:
 *
 * ```text
 * BONUS               bonus_depth_work inclusive
 * SKILL               skill_depth_work inclusive
 * COMPOSITION         composition_work inclusive + cross_wake_work inclusive
 * SCHEDULER_OVERHEAD  scheduler_step inclusive - BONUS - SKILL - COMPOSITION
 *                     (scheduler_step / scheduler_settle exclusive, scheduler_checkpoint, scheduler_post_settle)
 * DELIVERY            delivery_flush inclusive
 * REGISTRATION_SETUP  search_setup inclusive + route_registration inclusive
 * UNACCOUNTED         search_runtime exclusive (= inclusive - its registered children)
 * ```
 *
 * Coverage = 1 - UNACCOUNTED / Search wall. The decision is registered before the formal run: INVALID (authority / identity /
 * nesting / provenance), INSUFFICIENT (coverage < 0.90, no usable profile, a Search shorter than the registered minimum),
 * <CATEGORY>_DOMINANT (share >= 0.50), MIXED (valid, none >= 0.50); a category >= 0.20 is reported as secondary. The windows are
 * descriptive only (never a decision input).
 */
import type { SearchRuntimeSection } from '../domain/search/searchRuntime'
import type { Phase2C26A4SectionTotals } from './plannerGlobalPhase2C26A4'
import {
  verifyPhase2C26B2C2B2FStartAttestation,
  PHASE2C26B2C2B2F_BUDGET_MS,
  PHASE2C26B2C2B2F_CHILD_HEAP_MB,
  PHASE2C26B2C2B2F_WINDOWS_MS,
  type Phase2C26B2C2B2FAttestationExpectation,
  type Phase2C26B2C2B2FProfileSnapshot,
  type Phase2C26B2C2B2FStreamDepthFacts,
} from './plannerGlobalPhase2C26B2C2B2F'
import { phase2c26b2c2b2dEvidenceGrade } from './plannerGlobalPhase2C26B2C2B2DAnalysis'
import { stableStringify } from '../domain/models/hashing'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}

// ---------------------------------------------------------------- registered decision rule (fixed before the formal run)

export const PHASE2C26B2C2B2F_COVERAGE_THRESHOLD = 0.9
export const PHASE2C26B2C2B2F_DOMINANT_THRESHOLD = 0.5
export const PHASE2C26B2C2B2F_SECONDARY_THRESHOLD = 0.2
/** A Search shorter than this is not a usable profile of a 30-minute time-bound Search (INSUFFICIENT). */
export const PHASE2C26B2C2B2F_MIN_SEARCH_WALL_MS = 60_000
/** The relative tolerance of the partition check (categories must sum to the Search wall). */
export const PHASE2C26B2C2B2F_PARTITION_TOLERANCE = 1e-6

export const PHASE2C26B2C2B2F_CATEGORIES = ['BONUS', 'SKILL', 'COMPOSITION', 'SCHEDULER_OVERHEAD', 'DELIVERY', 'REGISTRATION_SETUP', 'UNACCOUNTED'] as const
export type Phase2C26B2C2B2FCategory = typeof PHASE2C26B2C2B2F_CATEGORIES[number]
/** The categories a decision can name (UNACCOUNTED never dominates a valid profile: coverage >= 0.90 bounds it below 0.10). */
export const PHASE2C26B2C2B2F_DECISION_CATEGORIES = ['BONUS', 'SKILL', 'COMPOSITION', 'SCHEDULER_OVERHEAD', 'DELIVERY', 'REGISTRATION_SETUP'] as const

export const PHASE2C26B2C2B2F_DECISION_CASES = ['B2C2B2F_INVALID', 'B2C2B2F_INSUFFICIENT', 'B2C2B2F_BONUS_DOMINANT', 'B2C2B2F_SKILL_DOMINANT', 'B2C2B2F_COMPOSITION_DOMINANT',
  'B2C2B2F_SCHEDULER_DOMINANT', 'B2C2B2F_DELIVERY_DOMINANT', 'B2C2B2F_REGISTRATION_SETUP_DOMINANT', 'B2C2B2F_MIXED'] as const
export type Phase2C26B2C2B2FDecisionCase = typeof PHASE2C26B2C2B2F_DECISION_CASES[number]
const DOMINANT_CASE: Record<typeof PHASE2C26B2C2B2F_DECISION_CATEGORIES[number], Phase2C26B2C2B2FDecisionCase> = {
  BONUS: 'B2C2B2F_BONUS_DOMINANT', SKILL: 'B2C2B2F_SKILL_DOMINANT', COMPOSITION: 'B2C2B2F_COMPOSITION_DOMINANT', SCHEDULER_OVERHEAD: 'B2C2B2F_SCHEDULER_DOMINANT',
  DELIVERY: 'B2C2B2F_DELIVERY_DOMINANT', REGISTRATION_SETUP: 'B2C2B2F_REGISTRATION_SETUP_DOMINANT',
}

export const PHASE2C26B2C2B2F_DECISION_RULE = {
  categories: 'BONUS = bonus_depth_work incl.; SKILL = skill_depth_work incl.; COMPOSITION = composition_work incl. + cross_wake_work incl.; SCHEDULER_OVERHEAD = scheduler_step incl. - BONUS - SKILL - COMPOSITION; DELIVERY = delivery_flush incl.; REGISTRATION_SETUP = search_setup incl. + route_registration incl.; UNACCOUNTED = search_runtime excl. A partition of the search_runtime inclusive time (no double count).',
  denominator: 'the Search wall of this profiling run itself (search_runtime inclusive, open sections up to the last durable snapshot); never a B2-C2B2E wall time',
  coverage: `1 - UNACCOUNTED / Search wall; INSUFFICIENT below ${PHASE2C26B2C2B2F_COVERAGE_THRESHOLD}`,
  invalid: 'B2C2B2F_INVALID: an authority / population / identity / excluded Route / provenance issue, a section nesting contract violation, or a broken partition',
  insufficient: `B2C2B2F_INSUFFICIENT: no usable profile snapshot, a Search wall below ${PHASE2C26B2C2B2F_MIN_SEARCH_WALL_MS} ms, or coverage below ${PHASE2C26B2C2B2F_COVERAGE_THRESHOLD}`,
  dominant: `<CATEGORY>_DOMINANT: one category share >= ${PHASE2C26B2C2B2F_DOMINANT_THRESHOLD} (BONUS / SKILL / COMPOSITION / SCHEDULER(_OVERHEAD) / DELIVERY / REGISTRATION_SETUP)`,
  mixed: `B2C2B2F_MIXED: valid, no category >= ${PHASE2C26B2C2B2F_DOMINANT_THRESHOLD}`,
  secondary: `every other category with share >= ${PHASE2C26B2C2B2F_SECONDARY_THRESHOLD} is reported as secondary`,
  timeout: 'a timeout is a normal profiling outcome (never Candidate 0); a natural completion is profiled whole',
  windows: 'descriptive only, never a decision input',
} as const

export const PHASE2C26B2C2B2F_NEXT_PHASE: Record<Phase2C26B2C2B2FDecisionCase, string> = {
  B2C2B2F_INVALID: '計測を無効扱いにし、原因を修正して同じprofilingをやり直す（条件は変えない）',
  B2C2B2F_INSUFFICIENT: 'coverage / profile不足。60分への自動延長はせず、不足理由（未計測区間）を特定してから再計画する',
  B2C2B2F_BONUS_DOMINANT: 'Bonus depth work内部の現行hotspot再局所化。まず既存A7 / A8 instrumentation（onGogmaReservedRuntime等）で足りるか確認する',
  B2C2B2F_SKILL_DOMINANT: 'Skill depth work内部のruntime localization。既存SearchRuntime section（skill_depth_read / ideal_filter / route_materialization / evaluate_sort / channel_publication / depth_advance）で切り、必要ならSkill stream read（readReservedDepth）内部へ進む',
  B2C2B2F_COMPOSITION_DOMINANT: 'Lazy Cross / composition queueのprofile',
  B2C2B2F_SCHEDULER_DOMINANT: 'TargetSearchScheduler queue / stepのprofile',
  B2C2B2F_DELIVERY_DOMINANT: 'delivery flush（sort / dedup / consumer）のprofile',
  B2C2B2F_REGISTRATION_SETUP_DOMINANT: 'Search setup / Route registrationのprofile',
  B2C2B2F_MIXED: '>= 20 %のcategoryを最大2つ選び、次Phaseでそれぞれ絞る',
}

// ---------------------------------------------------------------- categories of one cumulative observation

export interface Phase2C26B2C2B2FCategoryBreakdown {
  searchWallMs: number
  ms: Record<Phase2C26B2C2B2FCategory, number>
  shares: Record<Phase2C26B2C2B2FCategory, number>
  coverage: number
  partition: { sumMs: number; matches: boolean }
  /** The exclusive time of every section, grouped by the category its exclusive time falls in. */
  sectionExclusiveMs: Record<Phase2C26B2C2B2FCategory, Partial<Record<SearchRuntimeSection, number>>>
  /** SCHEDULER_OVERHEAD split into its parts (settleExclusive includes a settle that settled no scheduler-owned work). */
  scheduler: { stepExclusiveMs: number; checkpointMs: number; settleExclusiveMs: number; postSettleMs: number }
}

/** The category each section's EXCLUSIVE time falls in (the partition above, section by section). */
export const PHASE2C26B2C2B2F_SECTION_CATEGORY: Readonly<Record<SearchRuntimeSection, Phase2C26B2C2B2FCategory>> = {
  search_runtime: 'UNACCOUNTED',
  search_setup: 'REGISTRATION_SETUP', route_registration: 'REGISTRATION_SETUP', normal_route_registration: 'REGISTRATION_SETUP',
  owned_normal_route_registration: 'REGISTRATION_SETUP', existing_gogma_route_registration: 'REGISTRATION_SETUP',
  scheduler_step: 'SCHEDULER_OVERHEAD', scheduler_checkpoint: 'SCHEDULER_OVERHEAD', scheduler_settle: 'SCHEDULER_OVERHEAD', scheduler_post_settle: 'SCHEDULER_OVERHEAD',
  bonus_depth_work: 'BONUS', bonus_depth_read: 'BONUS', bonus_notice_scan: 'BONUS', bonus_ideal_filter: 'BONUS', bonus_route_materialization: 'BONUS', bonus_evaluate_sort: 'BONUS',
  bonus_channel_publication: 'BONUS', cross_add_bonus: 'BONUS', bonus_depth_advance: 'BONUS',
  skill_depth_work: 'SKILL', skill_depth_read: 'SKILL', skill_ideal_filter: 'SKILL', skill_route_materialization: 'SKILL', skill_evaluate_sort: 'SKILL',
  skill_channel_publication: 'SKILL', cross_add_skill: 'SKILL', skill_depth_advance: 'SKILL',
  composition_work: 'COMPOSITION', composition_checkpoint: 'COMPOSITION', compose_route: 'COMPOSITION', composition_consumer: 'COMPOSITION', cross_open_next: 'COMPOSITION',
  cross_wake_work: 'COMPOSITION', cross_wake: 'COMPOSITION',
  delivery_flush: 'DELIVERY', delivery_sort: 'DELIVERY', delivery_checkpoint: 'DELIVERY', delivery_key_dedup: 'DELIVERY', delivery_consumer: 'DELIVERY',
}

const zeroCategories = (): Record<Phase2C26B2C2B2FCategory, number> => Object.fromEntries(PHASE2C26B2C2B2F_CATEGORIES.map(c => [c, 0])) as Record<Phase2C26B2C2B2FCategory, number>

/**
 * The categories of one cumulative observation (inclusive / exclusive per section). The categories come from the inclusive times
 * of the registered category roots; the section exclusive breakdown is reported alongside and must sum to the same categories.
 */
export function phase2c26b2c2b2fCategories(observed: { inclusiveMs: Phase2C26A4SectionTotals; exclusiveMs: Phase2C26A4SectionTotals }): Phase2C26B2C2B2FCategoryBreakdown {
  const inc = observed.inclusiveMs, exc = observed.exclusiveMs
  const searchWallMs = inc.search_runtime
  const ms = zeroCategories()
  ms.BONUS = inc.bonus_depth_work
  ms.SKILL = inc.skill_depth_work
  ms.COMPOSITION = inc.composition_work + inc.cross_wake_work
  ms.SCHEDULER_OVERHEAD = inc.scheduler_step - ms.BONUS - ms.SKILL - ms.COMPOSITION
  ms.DELIVERY = inc.delivery_flush
  ms.REGISTRATION_SETUP = inc.search_setup + inc.route_registration
  ms.UNACCOUNTED = exc.search_runtime
  const sumMs = PHASE2C26B2C2B2F_CATEGORIES.reduce((sum, c) => sum + ms[c], 0)
  const sectionExclusiveMs = Object.fromEntries(PHASE2C26B2C2B2F_CATEGORIES.map(c => [c, {}])) as Phase2C26B2C2B2FCategoryBreakdown['sectionExclusiveMs']
  for (const [section, category] of Object.entries(PHASE2C26B2C2B2F_SECTION_CATEGORY) as [SearchRuntimeSection, Phase2C26B2C2B2FCategory][]) sectionExclusiveMs[category][section] = exc[section]
  const exclusiveSums = Object.fromEntries(PHASE2C26B2C2B2F_CATEGORIES.map(c => [c, Object.values(sectionExclusiveMs[c]).reduce((s, v) => s + (v ?? 0), 0)])) as Record<Phase2C26B2C2B2FCategory, number>
  const tol = Math.max(1e-6, Math.abs(searchWallMs) * PHASE2C26B2C2B2F_PARTITION_TOLERANCE)
  const matches = Math.abs(sumMs - searchWallMs) <= tol && PHASE2C26B2C2B2F_CATEGORIES.every(c => Math.abs(exclusiveSums[c] - ms[c]) <= tol)
    && PHASE2C26B2C2B2F_CATEGORIES.every(c => ms[c] >= -tol)
  const shares = Object.fromEntries(PHASE2C26B2C2B2F_CATEGORIES.map(c => [c, searchWallMs > 0 ? ms[c] / searchWallMs : 0])) as Record<Phase2C26B2C2B2FCategory, number>
  return { searchWallMs, ms, shares, coverage: searchWallMs > 0 ? 1 - ms.UNACCOUNTED / searchWallMs : 0, partition: { sumMs, matches }, sectionExclusiveMs,
    scheduler: { stepExclusiveMs: exc.scheduler_step, checkpointMs: inc.scheduler_checkpoint, settleExclusiveMs: exc.scheduler_settle, postSettleMs: inc.scheduler_post_settle } }
}

const subtract = (a: Phase2C26A4SectionTotals, b: Phase2C26A4SectionTotals) =>
  Object.fromEntries(Object.keys(a).map(k => [k, a[k as SearchRuntimeSection] - (b[k as SearchRuntimeSection] ?? 0)])) as Phase2C26A4SectionTotals
const observedOf = (snapshot: Phase2C26B2C2B2FProfileSnapshot) => snapshot.runtime.observed.find(o => o.targetOrdinal === 0) ?? null

// ---------------------------------------------------------------- the profile snapshots

export interface Phase2C26B2C2B2FSnapshotSelection {
  valid: boolean
  issues: string[]
  /** The final completed-Search snapshot, else the last heartbeat / boundary snapshot before the budget kill. */
  last: Phase2C26B2C2B2FProfileSnapshot | null
  source: 'final' | 'last_durable_snapshot' | 'none'
  snapshots: number
}

/** Reads the durable profile snapshots in order (seq strictly increasing, atMs non-decreasing) and picks the last one. */
export function phase2c26b2c2b2fSelectSnapshot(snapshots: readonly Phase2C26B2C2B2FProfileSnapshot[]): Phase2C26B2C2B2FSnapshotSelection {
  const issues: string[] = []
  snapshots.forEach((s, i) => {
    if (s.kind !== 'profile_snapshot') issues.push(`snapshot ${i} is not a profile snapshot`)
    if (i > 0 && !(s.seq > snapshots[i - 1]!.seq)) issues.push(`snapshot ${i} seq is not increasing`)
    if (i > 0 && !(s.atMs >= snapshots[i - 1]!.atMs)) issues.push(`snapshot ${i} time goes back`)
  })
  const last = snapshots.at(-1) ?? null
  if (last === null) return { valid: false, issues: ['no profile snapshot'], last: null, source: 'none', snapshots: 0 }
  if (snapshots.filter(s => s.reason === 'final').length > 1) issues.push('more than one final snapshot')
  if (snapshots.some(s => s.reason === 'final') && last.reason !== 'final') issues.push('a snapshot follows the final one')
  return { valid: issues.length === 0, issues, last, source: last.reason === 'final' ? 'final' : 'last_durable_snapshot', snapshots: snapshots.length }
}

// ---------------------------------------------------------------- descriptive windows (Search elapsed)

export interface Phase2C26B2C2B2FWindow {
  fromMs: number
  toMs: number
  /** The Search elapsed actually covered (the last window can end at the last durable snapshot). */
  observedFromMs: number | null
  observedToMs: number | null
  partial: boolean
  categories: Phase2C26B2C2B2FCategoryBreakdown | null
  depth: { bonusCompletedWorks: number; skillCompletedWorks: number; bonusMaxDepth: number; skillMaxDepth: number } | null
  yieldsCount: number | null
}

/**
 * The registered windows (Search elapsed 0-10 / 10-20 / 20-30 minutes) as differences of cumulative snapshots: the window start is
 * the Search start (zero totals) or the window-boundary snapshot at its start; the window end is the boundary snapshot at its end,
 * or else the last durable snapshot (partial). Descriptive only.
 */
export function phase2c26b2c2b2fWindows(snapshots: readonly Phase2C26B2C2B2FProfileSnapshot[]): Phase2C26B2C2B2FWindow[] {
  const boundary = (ms: number) => snapshots.find(s => s.reason === 'window_boundary' && s.windowBoundaryMs === ms) ?? null
  const last = snapshots.at(-1) ?? null
  return PHASE2C26B2C2B2F_WINDOWS_MS.map(([fromMs, toMs]) => {
    const startSnapshot = fromMs === 0 ? null : boundary(fromMs)
    const endBoundary = boundary(toMs)
    const end = endBoundary ?? (last !== null && (last.searchElapsedMs ?? -1) > fromMs ? last : null)
    const none = { fromMs, toMs, observedFromMs: null, observedToMs: null, partial: true, categories: null, depth: null, yieldsCount: null }
    if (end === null || (fromMs !== 0 && startSnapshot === null)) return none
    const endObserved = observedOf(end)
    if (endObserved === null) return none
    const startObserved = startSnapshot === null ? null : observedOf(startSnapshot)
    const zero = Object.fromEntries(Object.keys(endObserved.inclusiveMs).map(k => [k, 0])) as Phase2C26A4SectionTotals
    const categories = phase2c26b2c2b2fCategories({ inclusiveMs: subtract(endObserved.inclusiveMs, startObserved?.inclusiveMs ?? zero),
      exclusiveMs: subtract(endObserved.exclusiveMs, startObserved?.exclusiveMs ?? zero) })
    const d = (pick: (s: Phase2C26B2C2B2FProfileSnapshot) => number) => pick(end) - (startSnapshot === null ? 0 : pick(startSnapshot))
    return { fromMs, toMs, observedFromMs: startSnapshot?.searchElapsedMs ?? 0, observedToMs: end.searchElapsedMs, partial: endBoundary === null, categories,
      depth: { bonusCompletedWorks: d(s => s.depth.bonus.completedWorks), skillCompletedWorks: d(s => s.depth.skill.completedWorks), bonusMaxDepth: end.depth.bonus.maxDepth,
        skillMaxDepth: end.depth.skill.maxDepth }, yieldsCount: d(s => s.yields.count) }
  })
}

// ---------------------------------------------------------------- decision

export interface Phase2C26B2C2B2FDecisionInput {
  invalidReasons: readonly string[]
  insufficientReasons: readonly string[]
  categories: Phase2C26B2C2B2FCategoryBreakdown | null
}

export function phase2c26b2c2b2fDecision(input: Phase2C26B2C2B2FDecisionInput) {
  const shares = input.categories?.shares ?? null
  const secondaryOf = (exclude: string | null) => shares === null ? [] : PHASE2C26B2C2B2F_DECISION_CATEGORIES
    .filter(c => c !== exclude && shares[c] >= PHASE2C26B2C2B2F_SECONDARY_THRESHOLD).sort((a, b) => shares[b] - shares[a])
  const base = { scope: 'A profiling decision about which Search runtime section dominates the wall time of this one oracle-guided Search input on the current main. It is never an optimization decision, never a Route exact judgement and never Production evidence.' }
  if (input.invalidReasons.length > 0) return { ...base, case: 'B2C2B2F_INVALID' as Phase2C26B2C2B2FDecisionCase, reasons: [...input.invalidReasons], dominant: null, secondary: [], nextPhase: PHASE2C26B2C2B2F_NEXT_PHASE.B2C2B2F_INVALID }
  const insufficient = [...input.insufficientReasons]
  const c = input.categories
  if (c === null) insufficient.push('no category breakdown')
  else {
    if (c.searchWallMs < PHASE2C26B2C2B2F_MIN_SEARCH_WALL_MS) insufficient.push(`the Search wall ${c.searchWallMs.toFixed(0)} ms is below ${PHASE2C26B2C2B2F_MIN_SEARCH_WALL_MS} ms`)
    if (c.coverage < PHASE2C26B2C2B2F_COVERAGE_THRESHOLD) insufficient.push(`coverage ${c.coverage.toFixed(4)} is below ${PHASE2C26B2C2B2F_COVERAGE_THRESHOLD}`)
  }
  if (insufficient.length > 0 || c === null) return { ...base, case: 'B2C2B2F_INSUFFICIENT' as Phase2C26B2C2B2FDecisionCase, reasons: insufficient, dominant: null, secondary: [], nextPhase: PHASE2C26B2C2B2F_NEXT_PHASE.B2C2B2F_INSUFFICIENT }
  const ranked = [...PHASE2C26B2C2B2F_DECISION_CATEGORIES].sort((a, b) => c.shares[b] - c.shares[a])
  const top = ranked[0]!
  if (c.shares[top] >= PHASE2C26B2C2B2F_DOMINANT_THRESHOLD) {
    const caseId = DOMINANT_CASE[top]
    return { ...base, case: caseId, reasons: [], dominant: top, secondary: secondaryOf(top), nextPhase: PHASE2C26B2C2B2F_NEXT_PHASE[caseId] }
  }
  return { ...base, case: 'B2C2B2F_MIXED' as Phase2C26B2C2B2FDecisionCase, reasons: [], dominant: null, secondary: secondaryOf(null), nextPhase: PHASE2C26B2C2B2F_NEXT_PHASE.B2C2B2F_MIXED,
    nextPhaseCategories: secondaryOf(null).slice(0, 2) }
}

// ---------------------------------------------------------------- depth facts (read from the counts the Search reported)

export function phase2c26b2c2b2fDepthSummary(snapshot: Phase2C26B2C2B2FProfileSnapshot) {
  const target = snapshot.runtime.byTarget.find(t => t.targetOrdinal === 0) ?? null
  const stream = (facts: Phase2C26B2C2B2FStreamDepthFacts, aggregate: NonNullable<typeof target>['bonusDepth'] | null) => ({ ...facts,
    rawSolutions: aggregate?.rawSolutions ?? null, unsupportedPredictions: aggregate?.unsupportedPredictions ?? null, idealSolutions: aggregate?.idealSolutions ?? null,
    evaluatedSolutions: aggregate?.evaluatedSolutions ?? null, subscriberPublications: aggregate?.subscriberPublications ?? null, maxRawSolutions: aggregate?.maxRawSolutions ?? null,
    maxSubscriberCount: aggregate?.maxSubscriberCount ?? null, maxRetainedCountAfter: aggregate?.maxRetainedCountAfter ?? null, openAtSnapshot: facts.startedWorks - facts.completedWorks })
  return { bonus: stream(snapshot.depth.bonus, target?.bonusDepth ?? null), skill: stream(snapshot.depth.skill, target?.skillDepth ?? null),
    settleWithoutWork: target?.settleWithoutWork ?? null, sectionCounts: target?.sectionCounts ?? null }
}

// ---------------------------------------------------------------- launch provenance and raw conditions

export interface Phase2C26B2C2B2FLaunchProvenance {
  verified: boolean
  source: 'runner_start_attestation' | 'none'
  workingTreeCleanVerified: boolean
  issues: string[]
  integrityIssues: string[]
  reason: string | null
}

/** B2-C2B2E's launch provenance rule with this phase's attestation. */
export function phase2c26b2c2b2fLaunchProvenance(input: { attestationFile: { sha256: string; body: unknown } | null; recordedAttestationSha256: string | null;
  environment: Record<string, unknown>; expected: Phase2C26B2C2B2FAttestationExpectation }): Phase2C26B2C2B2FLaunchProvenance {
  if (input.attestationFile === null) {
    return { verified: false, source: 'none', workingTreeCleanVerified: false, issues: ['no start attestation in the run dir'], integrityIssues: [],
      reason: 'The runner start attestation is missing.' }
  }
  const integrityIssues: string[] = []
  if (input.recordedAttestationSha256 !== input.attestationFile.sha256) integrityIssues.push('the attestation file is not the one the raw recorded')
  const verification = verifyPhase2C26B2C2B2FStartAttestation(input.attestationFile.body, input.expected)
  integrityIssues.push(...verification.integrityIssues)
  const body = isObject(input.attestationFile.body) ? input.attestationFile.body : {}
  for (const field of ['repositoryHead', 'uncommittedBenchmarkCode', 'benchmarkCodeSha256', 'exportSha256', 'probeManifestSha256', 'stage1', 'probes'] as const) {
    if (!same(body[field], input.environment[field])) integrityIssues.push(`${field} differs from the raw environment`)
  }
  const issues = [...integrityIssues, ...verification.issues.filter(i => !verification.integrityIssues.includes(i))]
  const verified = issues.length === 0
  return { verified, source: 'runner_start_attestation', workingTreeCleanVerified: verified, issues, integrityIssues,
    reason: verified ? null : `The start attestation does not verify: ${issues.join('; ')}.` }
}

export const phase2c26b2c2b2fEvidenceGrade = phase2c26b2c2b2dEvidenceGrade

/** The execution conditions of the Search child as the parent recorded them: the profiling budget and heap, once (no retry). */
export function phase2c26b2c2b2fConditionIssues(input: { smoke: boolean; runs: readonly { taskId: string; process: { budgetMs: number; nodeFlags?: string[] } }[] }): string[] {
  const issues: string[] = []
  if (input.runs.length !== 1) issues.push(`${input.runs.length} Search runs, not exactly one (no retry)`)
  for (const run of input.runs) {
    if (!input.smoke && run.process.budgetMs !== PHASE2C26B2C2B2F_BUDGET_MS) issues.push(`${run.taskId}: the child budget is ${run.process.budgetMs} ms, not ${PHASE2C26B2C2B2F_BUDGET_MS}`)
    if (run.process.nodeFlags !== undefined && !run.process.nodeFlags.includes(`--max-old-space-size=${PHASE2C26B2C2B2F_CHILD_HEAP_MB}`)) issues.push(`${run.taskId}: the child heap flag is not ${PHASE2C26B2C2B2F_CHILD_HEAP_MB} MB`)
    if (run.process.nodeFlags !== undefined && run.process.nodeFlags.some(f => /--cpu-prof|--prof\b|--inspect/.test(f))) issues.push(`${run.taskId}: a CPU profiler / inspector flag`)
  }
  return issues
}
