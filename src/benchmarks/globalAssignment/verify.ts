/**
 * Issue #154 Global Assignment Phase D-1A (Research only; never imported by the app).
 *
 * Phase D' of one process (`docs/PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md` 9.5 / 9.6 / 13.1, `docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D1A.md`):
 * the Research layer that judges the result of the ordinary Production Planner over the Entries one structural candidate
 * materialized. It re-implements no scheduler, Trace Replay, Target satisfaction or Counter advance:
 *
 * 1. the handoff (`MaterializedEntriesHandoff`): an `all_materialized` stage, one Entry per Phase 0 planning Target, no
 *    duplicate Target or Entry ID, each Entry passing `validateBuildListEntry()`
 * 2. the final input: each generated Entry replaces its Target's one original Entry through the Production replacement authority
 *    (`resolveBuildListEntryReplacement()` / `applyBuildListEntryReplacements()` / `validateBuildListEntryReplacements()`, never a
 *    `map()` that could register a generated Entry twice), every other original Entry kept unchanged, `conflictResolutions = []`,
 *    `options.maxPlanSteps` = the Research condition (design 10.4, G12), Targets / OwnedWeapons / RNG state / Counters untouched
 * 3. the planning Target set of the final input (`validatePlannerInput()` -> `derivePlannerPlanningTargets()`) equals Phase 0's,
 *    with no generated Entry excluded; otherwise `planning_target_set_changed` and no Planner run
 * 4. `createProductionPlanWithObserver()` (the Production deterministic scheduler; full runs counted by `beforePlannerRun()`)
 * 5. an independent `replayPlannerSearchTrace()` over the last run's trace, its Step correspondence with the Plan (operation,
 *    Entry, progressed Targets, RNG advance, Counter position) and its final Counters
 * 6. `summarizePlanPhysical()`: Plan steps, physical operations, stream advances and the structural objective
 *
 * The in-process conditions (design 9.5, items 1 - 12 of the D-1A record) are all required; the fresh-process condition (13) is
 * judged by `verificationProtocol.ts` from two of these records. Nothing here is `verified`, persisted, a user-fixed Route, an
 * explicit resolution or a lineage (design 16, G1). Planner non-completion is never read as "no Route" (design 9.6). The Planner
 * and Trace Replay are the Production entry points; a test may inject them through `PlannerVerificationExecution.planner`.
 */
import {
  applyBuildListEntryReplacements, resolveBuildListEntryReplacement, validateBuildListEntryReplacements,
  type BuildListEntryReplacement, type BuildListEntryReplacementFailureReason,
} from '../../domain/buildList/buildListEntryReplacement'
import { hashStableValue, validateBuildListEntry } from '../../domain/models/publicTypes'
import type { BuildListEntry, PlanStep, ProductionPlan } from '../../domain/models/publicTypes'
import { derivePlannerPlanningTargets } from '../../domain/planner/plannerPlanningTargets'
import { replayPlannerSearchTrace, type PlannerPlanStepDraft, type PlannerTraceReplayResult } from '../../domain/planner/plannerTraceReplay'
import type { PlannerDependencies, PlannerInput, PlannerResult, PlannerRunResult, PlannerRunTermination } from '../../domain/planner/plannerTypes'
import { validatePlannerInput } from '../../domain/planner/plannerValidation'
import { createProductionPlanWithObserver } from '../../domain/planner/productionPlanGeneration'
import { streamKeyOfNormal, summarizePlanPhysical } from '../plannerGlobalPhase2BPlan'
import type { MaterializedEntriesHandoff } from './materializationRunner'

export const PLANNER_VERIFICATION_PROTOCOL_VERSION = 'global-assignment-d1a:1'

/** The Research conditions of one Phase D' run (D-1A: non-formal values; D-1B registers the formal ones). */
export interface PlannerVerificationConditions {
  /** Design 10.4 Research `maxPlanSteps` (G12): written into the final input's `PlannerInput.options`, never a Production default. */
  researchMaxPlanSteps: number
}

export type PlannerVerificationStage = 'handoff' | 'final_input' | 'planner' | 'trace_replay' | 'physical'

export interface PlannerVerificationStageEvent {
  stage: PlannerVerificationStage
  status: 'started' | 'finished'
}

/** The Production Planner and Trace Replay (the defaults); a test injects others to reach every classification. */
export interface PlannerVerificationPort {
  createProductionPlanWithObserver: typeof createProductionPlanWithObserver
  replayPlannerSearchTrace: typeof replayPlannerSearchTrace
}

export const productionPlannerVerificationPort: PlannerVerificationPort = Object.freeze({ createProductionPlanWithObserver, replayPlannerSearchTrace })

export interface PlannerVerificationExecution {
  /** Monotonic milliseconds from the script's clock; the module reads no clock of its own. */
  now: () => number
  /** The Production Planner's own cancel / yield seam (`PlannerExecutionOptions`). */
  shouldCancel?: () => boolean
  yieldControl?: () => Promise<void>
  onStage?: (event: PlannerVerificationStageEvent) => void
  /** Tests only. The runner never passes it: Phase D' is the Production Planner and Trace Replay. */
  planner?: PlannerVerificationPort
}

/** Why the planning Target set of the final input is not Phase 0's, or why no final input could be built (design 9.5). */
export type PlanningTargetSetChangeReason =
  | { code: 'duplicate_target_entries'; source: 'handoff' | 'final_input'; targetWeaponIds: string[] }
  | { code: 'duplicate_entry_ids'; buildListEntryIds: string[] }
  | { code: 'entry_outside_planning_targets'; targetWeaponIds: string[] }
  | { code: 'planning_target_without_entry'; targetWeaponIds: string[] }
  | { code: 'generated_entry_invalid'; entries: { buildListEntryId: string; issueCodes: string[] }[] }
  | { code: 'replacement_unresolved'; entries: { targetWeaponId: string; buildListEntryId: string; reason: BuildListEntryReplacementFailureReason }[] }
  | { code: 'replacement_set_invalid'; issues: string[] }
  | { code: 'final_input_invalid'; issues: { path: string; code: string }[] }
  | { code: 'generated_entry_excluded'; entries: { buildListEntryId: string; targetWeaponId: string; reason: string }[] }
  | { code: 'planning_target_added'; targetWeaponIds: string[] }
  | { code: 'planning_target_removed'; targetWeaponIds: string[] }
  | { code: 'source_data_changed'; fields: string[] }

/** Why the Production Planner result does not meet the design 9.5 conditions 1 - 10 (never "no Route", design 9.6). */
export type PlannerRejectionReason =
  | { code: 'plan_generation_error'; errorName: string; message: string }
  | { code: 'plan_null' }
  | { code: 'termination_not_completed'; status: string; reachedLimits: string[] }
  | { code: 'max_plan_steps_reached'; maxPlanSteps: number }
  | { code: 'completed_target_count_mismatch'; completed: number; planning: number }
  | { code: 'total_target_count_mismatch'; total: number; planning: number }
  | { code: 'selected_entries_mismatch'; missing: string[]; unexpected: string[] }
  | { code: 'conflicts'; count: number; kinds: Record<string, number> }
  | { code: 'rejected_entries'; count: number; reasons: Record<string, number>; resourceConflicts: number }
  | { code: 'warnings'; count: number; kinds: Record<string, number> }
  | { code: 'runtime_unsupported_retry'; fullPlannerRuns: number }
  | { code: 'trace_replay_not_run' }
  | { code: 'trace_replay_invalid'; issueCodes: string[] }
  | { code: 'trace_replay_unsupported_input' }
  | { code: 'trace_replay_correspondence_mismatch'; mismatches: number; counterPositionMismatches: number; finalCountersMatch: boolean | null }

/** Why the physical operations break the design 9.5 identities (design 9.6 `objective_mismatch`). */
export type ObjectiveMismatchReason =
  | { code: 'physical_summary_error'; message: string }
  | { code: 'physical_identity_broken'; physicalOperations: number; streamAdvanceSum: number }
  | { code: 'physical_steps_mismatch'; physicalOperations: number; planSteps: number; nonPhysicalSteps: number }
  | { code: 'physical_objective_mismatch'; physicalOperations: number; objective: number }

/** The in-process outcome of Phase D' (the fresh-process condition is judged elsewhere). */
export type PlannerVerificationRunOutcome =
  /** Every in-process condition (design 9.5, D-1A items 1 - 12) holds. Not `verified`: the fresh process is still required. */
  | { kind: 'conditions_met' }
  | { kind: 'materialization_failed' | 'materialization_unconfirmed' | 'materialization_unsupported'; targetWeaponId: string; outcomeKind: string; outcomeReason: string | null }
  | { kind: 'planning_target_set_changed'; reasons: PlanningTargetSetChangeReason[] }
  | { kind: 'planner_rejected'; reasons: PlannerRejectionReason[] }
  | { kind: 'objective_mismatch'; physicalOperations: number | null; objective: number; reasons: ObjectiveMismatchReason[] }
  /** The Planner's own cancel seam stopped the run: never a Planner result (G6). */
  | { kind: 'unmeasured'; reason: 'cancelled' }

/** The D-1A conditions 1 - 12 (`null` = not evaluated because an earlier stage stopped). */
export interface PlannerConditionChecks {
  planPresent: boolean | null
  terminationCompleted: boolean | null
  completedEqualsPlanningTargets: boolean | null
  totalEqualsPlanningTargets: boolean | null
  allPlanningEntriesSelected: boolean | null
  noConflicts: boolean | null
  noRejectedEntries: boolean | null
  noResourceConflicts: boolean | null
  noWarnings: boolean | null
  traceReplayValid: boolean | null
  physicalEqualsPlanSteps: boolean | null
  physicalEqualsObjective: boolean | null
}

export interface FinalInputRecord {
  /** One per generated Entry, in a run-independent order. */
  replacements: BuildListEntryReplacement[]
  originalEntryCount: number
  finalEntryCount: number
  /** Original Entries kept unchanged (not replaced): their IDs, sorted. */
  keptOriginalEntryIds: string[]
  /** `hashStableValue` of every field Phase D' never edits, original vs final. */
  sourceDataUnchanged: Record<'targetWeapons' | 'ownedWeapons' | 'rngState' | 'normalCounters' | 'calculationContext' | 'master', boolean>
  conflictResolutionCount: number
  maxPlanSteps: number
  validation: {
    isValid: boolean
    issues: { path: string; code: string }[]
    warningKinds: Record<string, number>
    excluded: { buildListEntryId: string; targetWeaponId: string; generated: boolean; reason: string }[]
  }
  /** Phase 0 (the handoff) and the final input's planning Target IDs, sorted. */
  phase0PlanningTargetIds: string[]
  finalPlanningTargetIds: string[]
}

export interface PlannerRunRecord {
  /** `beforePlannerRun()` calls: the first run plus every runtime-unsupported retry. */
  fullPlannerRuns: number
  error: { name: string; message: string } | null
  termination: PlannerRunTermination | null
  planPresent: boolean
  planSteps: number | null
  /** `hashStableValue` of the whole Plan (IDs come from the run's own dependencies) and of its Step semantics. */
  planHash: string | null
  stepSemanticsHash: string | null
  selectedBuildListEntryIds: string[]
  expectedSelectedBuildListEntryIds: string[]
  conflicts: { id: string; kind: string; buildListEntryIds: string[]; selectedBuildListEntryId: string | null; reason: string }[]
  rejected: { buildListEntryId: string; reason: string; detail: string }[]
  warnings: { kind: string; message: string }[]
}

export interface TraceReplayRecord {
  /** The independent replay ran over the last full run's trace against the final input. */
  ran: boolean
  isValid: boolean | null
  issueCodes: string[]
  unsupportedInput: boolean
  drafts: { total: number; physical: number; reserve: number }
  correspondence: {
    planPhysicalSteps: number
    replayPhysicalDrafts: number
    /** Physical Steps whose operation, Entry, progressed Targets or RNG advance differ from the replayed draft. */
    mismatches: number
    counterPositionMismatches: number
    firstMismatches: { index: number; fields: string[] }[]
  } | null
  /** The replay's Counters after its last draft, against the Plan's physical stream ends. */
  finalCounters: { skill: number | null; gogma: number | null; normal: Record<string, number | null> } | null
  finalCountersMatchPlan: boolean | null
}

export interface PhysicalRecord {
  error: string | null
  planSteps: number | null
  physicalOperations: number | null
  nonPhysicalSteps: Record<string, number>
  nonPhysicalStepCount: number | null
  operationCounts: Record<string, number> | null
  streamAdvanceSum: number | null
  identityHolds: boolean | null
  sharedPhysicalSteps: number | null
  streams: { stream: string; start: number; end: number; advance: number }[]
  /** The structural candidate's stream advances (end − origin; design 10.1) beside the Plan's (diagnostic: only the total is a condition). */
  streamComparison: { stream: string; structuralAdvance: number; planAdvance: number; equal: boolean }[]
  objective: number
  /** `hashStableValue` of the executed positions (stream, position, operation, Target per physical Step). */
  executedHash: string | null
}

export interface PlannerVerificationSemantic {
  protocolVersion: string
  nature: 'research_phase_d_prime_one_process: the in-process conditions of design 9.5; not verified without the fresh process, not a formal VerifiedPlanRecord'
  conditions: PlannerVerificationConditions
  candidate: {
    candidateIndex: number
    ordinal: number
    objective: number
    planningTargetCount: number
    materializedEntryCount: number
    stage: string
    entryFingerprint: string
  }
  finalInput: FinalInputRecord | null
  planner: PlannerRunRecord | null
  traceReplay: TraceReplayRecord | null
  physical: PhysicalRecord | null
  checks: PlannerConditionChecks
  outcome: PlannerVerificationRunOutcome
}

export interface PlannerVerificationRecord {
  semantic: PlannerVerificationSemantic
  observed: { elapsedMs: Record<PlannerVerificationStage, number | null> & { total: number } }
}

const compare = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0)
const sorted = (values: Iterable<string>) => [...values].sort(compare)
const repeated = (values: readonly string[]) => sorted(new Set(values.filter((value, index) => values.indexOf(value) !== index)))

function countKinds(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const value of sorted(values)) counts[value] = (counts[value] ?? 0) + 1
  return counts
}

/**
 * The identity of a handoff's Entry set in the D-0C record's form: `hashStableValue` of `[{ orderIndex, entryId, entrySemanticHash }]`
 * in materialization order, `entrySemanticHash = hashStableValue(entry)` (the D-0C public RESULT's `materializedEntries.fingerprint`).
 */
export function materializedEntriesFingerprint(entries: readonly { orderIndex: number; entry: BuildListEntry }[]): string {
  return hashStableValue(entries.map(({ orderIndex, entry }) => ({ orderIndex, entryId: entry.id, entrySemanticHash: hashStableValue(entry) })))
}

function emptyChecks(): PlannerConditionChecks {
  return {
    planPresent: null, terminationCompleted: null, completedEqualsPlanningTargets: null, totalEqualsPlanningTargets: null, allPlanningEntriesSelected: null,
    noConflicts: null, noRejectedEntries: null, noResourceConflicts: null, noWarnings: null, traceReplayValid: null, physicalEqualsPlanSteps: null, physicalEqualsObjective: null,
  }
}

/** Design 9.5 handoff: one valid Entry per Phase 0 planning Target, nothing else (a stage other than `all_materialized` is checked first). */
function handoffReasons(handoff: MaterializedEntriesHandoff): PlanningTargetSetChangeReason[] {
  const reasons: PlanningTargetSetChangeReason[] = []
  const planning = new Set<string>(handoff.planningTargetIds)
  const targets = handoff.materializedEntries.map(({ entry }) => entry.targetWeaponId as string)
  const duplicates = repeated(targets)
  if (duplicates.length > 0) reasons.push({ code: 'duplicate_target_entries', source: 'handoff', targetWeaponIds: duplicates })
  const duplicateIds = repeated(handoff.materializedEntries.map(({ entry }) => entry.id as string))
  if (duplicateIds.length > 0) reasons.push({ code: 'duplicate_entry_ids', buildListEntryIds: duplicateIds })
  // The record's Target and the Entry's own Target must agree, and both must be planning Targets.
  const outside = sorted(new Set(handoff.materializedEntries.flatMap(({ targetWeaponId, entry }) => (planning.has(entry.targetWeaponId) && entry.targetWeaponId === targetWeaponId ? [] : [entry.targetWeaponId as string]))))
  if (outside.length > 0) reasons.push({ code: 'entry_outside_planning_targets', targetWeaponIds: outside })
  const covered = new Set(targets)
  const missing = sorted([...planning].filter(id => !covered.has(id)))
  if (missing.length > 0) reasons.push({ code: 'planning_target_without_entry', targetWeaponIds: missing })
  const invalid = handoff.materializedEntries.flatMap(({ entry }) => {
    const result = validateBuildListEntry(entry)
    return result.isValid ? [] : [{ buildListEntryId: entry.id as string, issueCodes: sorted(new Set(result.issues.map(issue => issue.code))) }]
  })
  if (invalid.length > 0) reasons.push({ code: 'generated_entry_invalid', entries: invalid })
  return reasons
}

type FinalInputResult =
  | { kind: 'final_input'; input: PlannerInput; record: FinalInputRecord }
  | { kind: 'changed'; record: FinalInputRecord | null; reasons: PlanningTargetSetChangeReason[] }

/** Design 9.5 final input and its planning Target set (the Production replacement and validation authorities only). */
function buildFinalInput(original: PlannerInput, handoff: MaterializedEntriesHandoff, conditions: PlannerVerificationConditions, dependencies: PlannerDependencies): FinalInputResult {
  const generated = handoff.materializedEntries.map(({ entry }) => entry)
  const replacements: BuildListEntryReplacement[] = []
  const unresolved: Extract<PlanningTargetSetChangeReason, { code: 'replacement_unresolved' }>['entries'] = []
  for (const entry of generated) {
    const resolution = resolveBuildListEntryReplacement(original.buildListEntries, entry)
    if (resolution.status === 'ready') replacements.push(resolution.replacement)
    else unresolved.push({ targetWeaponId: entry.targetWeaponId, buildListEntryId: entry.id, reason: resolution.reason })
  }
  if (unresolved.length > 0) return { kind: 'changed', record: null, reasons: [{ code: 'replacement_unresolved', entries: unresolved }] }
  const finalEntries = applyBuildListEntryReplacements(original.buildListEntries, replacements, generated)
  const placement = validateBuildListEntryReplacements(finalEntries, replacements, 'replaced')
  if (!placement.isValid) return { kind: 'changed', record: null, reasons: [{ code: 'replacement_set_invalid', issues: placement.issues.map(issue => issue.message) }] }

  const input: PlannerInput = {
    ...structuredClone(original),
    buildListEntries: structuredClone(finalEntries),
    conflictResolutions: [],
    options: { maxPlanSteps: conditions.researchMaxPlanSteps },
  }
  const replacedIds = new Set(replacements.map(replacement => replacement.replacedBuildListEntryId as string))
  const generatedIds = new Set(generated.map(entry => entry.id as string))
  const unchanged = (key: keyof FinalInputRecord['sourceDataUnchanged']) => hashStableValue(original[key]) === hashStableValue(input[key])
  const sourceDataUnchanged: FinalInputRecord['sourceDataUnchanged'] = {
    targetWeapons: unchanged('targetWeapons'), ownedWeapons: unchanged('ownedWeapons'), rngState: unchanged('rngState'), normalCounters: unchanged('normalCounters'),
    calculationContext: unchanged('calculationContext'), master: unchanged('master'),
  }
  const validation = validatePlannerInput(input, dependencies)
  const finalPlanning = validation.isValid ? derivePlannerPlanningTargets(input.targetWeapons, validation.validBuildListEntries).map(target => target.id as string) : []
  const record: FinalInputRecord = {
    replacements: sortReplacements(replacements),
    originalEntryCount: original.buildListEntries.length,
    finalEntryCount: input.buildListEntries.length,
    keptOriginalEntryIds: sorted(original.buildListEntries.filter(entry => !replacedIds.has(entry.id)).map(entry => entry.id as string)),
    sourceDataUnchanged,
    conflictResolutionCount: input.conflictResolutions.length,
    maxPlanSteps: input.options.maxPlanSteps,
    validation: {
      isValid: validation.isValid,
      issues: validation.issues.map(issue => ({ path: issue.path, code: issue.code })),
      warningKinds: countKinds(validation.warnings.map(warning => warning.kind)),
      excluded: validation.excludedBuildListEntries
        .map(({ entry, reason }) => ({ buildListEntryId: entry.id as string, targetWeaponId: entry.targetWeaponId as string, generated: generatedIds.has(entry.id), reason }))
        .sort((left, right) => compare(left.buildListEntryId, right.buildListEntryId)),
    },
    phase0PlanningTargetIds: sorted(handoff.planningTargetIds),
    finalPlanningTargetIds: sorted(finalPlanning),
  }
  const reasons: PlanningTargetSetChangeReason[] = []
  const changedFields = Object.entries(sourceDataUnchanged).filter(([, same]) => !same).map(([field]) => field)
  if (changedFields.length > 0) reasons.push({ code: 'source_data_changed', fields: changedFields })
  if (!validation.isValid) reasons.push({ code: 'final_input_invalid', issues: record.validation.issues })
  if (validation.warnings.some(warning => warning.kind === 'duplicate_build_list_entries_for_target')) {
    const duplicates = repeated(input.buildListEntries.map(entry => entry.targetWeaponId as string))
    reasons.push({ code: 'duplicate_target_entries', source: 'final_input', targetWeaponIds: duplicates })
  }
  const excludedGenerated = record.validation.excluded.filter(entry => entry.generated)
  if (excludedGenerated.length > 0) reasons.push({ code: 'generated_entry_excluded', entries: excludedGenerated.map(({ buildListEntryId, targetWeaponId, reason }) => ({ buildListEntryId, targetWeaponId, reason })) })
  const phase0 = new Set(record.phase0PlanningTargetIds)
  const final = new Set(record.finalPlanningTargetIds)
  const added = record.finalPlanningTargetIds.filter(id => !phase0.has(id))
  const removed = record.phase0PlanningTargetIds.filter(id => !final.has(id))
  if (added.length > 0) reasons.push({ code: 'planning_target_added', targetWeaponIds: added })
  if (removed.length > 0) reasons.push({ code: 'planning_target_removed', targetWeaponIds: removed })
  return reasons.length > 0 ? { kind: 'changed', record, reasons } : { kind: 'final_input', input, record }
}

function sortReplacements(replacements: readonly BuildListEntryReplacement[]): BuildListEntryReplacement[] {
  return replacements.map(replacement => ({ ...replacement })).sort((left, right) => compare(left.targetWeaponId, right.targetWeaponId))
}

function stepSemantics(step: PlanStep) {
  return {
    order: step.order, operationType: step.operationType, buildListEntryId: step.buildListEntryId, targetWeaponId: step.targetWeaponId,
    progressedTargetWeaponIds: step.progressedTargetWeaponIds ?? null, rngAdvance: step.rngAdvance,
    debug: step.debug === null ? null : {
      startGogmaCounter: step.debug.startGogmaCounter, endGogmaCounter: step.debug.endGogmaCounter, startSkillCounter: step.debug.startSkillCounter,
      endSkillCounter: step.debug.endSkillCounter, startNormalCounter: step.debug.startNormalCounter, endNormalCounter: step.debug.endNormalCounter,
    },
  }
}

function plannerRecord(result: PlannerResult | null, error: unknown, fullPlannerRuns: number, expectedSelected: readonly string[]): PlannerRunRecord {
  const plan = result?.plan ?? null
  return {
    fullPlannerRuns,
    error: error === null ? null : { name: error instanceof Error ? error.name : typeof error, message: error instanceof Error ? error.message : String(error) },
    termination: result === null ? null : structuredClone(result.termination),
    planPresent: plan !== null,
    planSteps: plan === null ? null : plan.steps.length,
    planHash: plan === null ? null : hashStableValue(plan),
    stepSemanticsHash: plan === null ? null : hashStableValue(plan.steps.map(stepSemantics)),
    selectedBuildListEntryIds: plan === null ? [] : sorted(plan.selectedBuildListEntryIds),
    expectedSelectedBuildListEntryIds: sorted(expectedSelected),
    conflicts: (result?.conflicts ?? []).map(conflict => ({
      id: conflict.id, kind: conflict.kind, buildListEntryIds: sorted(conflict.buildListEntryIds), selectedBuildListEntryId: conflict.selectedBuildListEntryId, reason: conflict.reason,
    })),
    rejected: (plan?.rejectedBuildListEntries ?? []).map(entry => ({ buildListEntryId: entry.buildListEntryId, reason: entry.reason, detail: entry.detail })),
    warnings: (result?.warnings ?? []).map(warning => ({ kind: warning.kind, message: warning.message })),
  }
}

/** The stream and Counter position one physical draft consumed (`null` when it advanced no single Counter). */
function draftPosition(draft: PlannerPlanStepDraft): { stream: string; position: number | null } | null {
  const { skillCounterDelta, gogmaCounterDelta, normalCounterDelta, affectedNormalCounterId } = draft.rngAdvance
  if (skillCounterDelta === 1) return { stream: 'skill', position: draft.rngStateBefore.skillCounter.value }
  if (gogmaCounterDelta === 1) return { stream: 'gogma', position: draft.rngStateBefore.gogmaCounter.value }
  if (normalCounterDelta === 1 && affectedNormalCounterId !== null) {
    return { stream: streamKeyOfNormal(affectedNormalCounterId), position: draft.normalCountersBefore.find(counter => counter.id === affectedNormalCounterId)?.counter ?? null }
  }
  return null
}

function stepPosition(step: PlanStep): number | null {
  const { skillCounterDelta, gogmaCounterDelta, normalCounterDelta } = step.rngAdvance
  if (step.debug === null) return null
  if (skillCounterDelta === 1) return step.debug.startSkillCounter
  if (gogmaCounterDelta === 1) return step.debug.startGogmaCounter
  if (normalCounterDelta === 1) return step.debug.startNormalCounter
  return null
}

const FIRST_MISMATCH_LIMIT = 5

function traceReplayRecord(replay: PlannerTraceReplayResult | null, plan: ProductionPlan | null, input: PlannerInput, physicalEnds: Map<string, number> | null): TraceReplayRecord {
  if (replay === null) {
    return { ran: false, isValid: null, issueCodes: [], unsupportedInput: false, drafts: { total: 0, physical: 0, reserve: 0 }, correspondence: null, finalCounters: null, finalCountersMatchPlan: null }
  }
  const physicalDrafts = replay.drafts.filter(draft => draft.actionKind === 'route_operation')
  let correspondence: TraceReplayRecord['correspondence'] = null
  if (plan !== null) {
    const targetOf = new Map(input.buildListEntries.map(entry => [entry.id as string, entry.targetWeaponId as string]))
    const physicalSteps = plan.steps.filter(step => step.operationType !== 'confirm_owned_ideal')
    let mismatches = 0
    let counterPositionMismatches = 0
    const firstMismatches: { index: number; fields: string[] }[] = []
    const length = Math.max(physicalSteps.length, physicalDrafts.length)
    for (let index = 0; index < length; index += 1) {
      const step = physicalSteps[index]
      const draft = physicalDrafts[index]
      const fields: string[] = []
      if (step === undefined || draft === undefined) fields.push('missing')
      else {
        if (step.operationType !== draft.operationType) fields.push('operationType')
        if (step.buildListEntryId !== draft.primaryBuildListEntryId) fields.push('buildListEntryId')
        if (hashStableValue(step.rngAdvance) !== hashStableValue(draft.rngAdvance)) fields.push('rngAdvance')
        const progressed = sorted(draft.progressedBuildListEntryIds.map(id => targetOf.get(id) ?? `?${id}`))
        if (step.progressedTargetWeaponIds !== undefined && hashStableValue(sorted(step.progressedTargetWeaponIds)) !== hashStableValue(progressed)) fields.push('progressedTargetWeaponIds')
        const replayed = draftPosition(draft)
        const recorded = stepPosition(step)
        if (replayed === null || replayed.position === null || (recorded !== null && recorded !== replayed.position)) {
          fields.push('counterPosition')
          counterPositionMismatches += 1
        }
      }
      if (fields.length === 0) continue
      mismatches += 1
      if (firstMismatches.length < FIRST_MISMATCH_LIMIT) firstMismatches.push({ index, fields })
    }
    correspondence = { planPhysicalSteps: physicalSteps.length, replayPhysicalDrafts: physicalDrafts.length, mismatches, counterPositionMismatches, firstMismatches }
  }
  const last = replay.drafts.at(-1) ?? null
  const finalCounters = last === null ? null : {
    skill: last.rngStateAfter.skillCounter.value, gogma: last.rngStateAfter.gogmaCounter.value,
    normal: Object.fromEntries(sorted(last.normalCountersAfter.map(counter => counter.id)).map(id => [id, last.normalCountersAfter.find(counter => counter.id === id)!.counter])),
  }
  let finalCountersMatchPlan: boolean | null = null
  if (finalCounters !== null && physicalEnds !== null) {
    finalCountersMatchPlan = [...physicalEnds].every(([stream, end]) => {
      if (stream === 'skill') return finalCounters.skill === end
      if (stream === 'gogma') return finalCounters.gogma === end
      const counterId = stream.slice('normal:'.length)
      return finalCounters.normal[counterId] === end
    })
  }
  return {
    ran: true, isValid: replay.isValid, issueCodes: replay.issues.map(issue => issue.code), unsupportedInput: replay.unsupportedInput !== null,
    drafts: { total: replay.drafts.length, physical: physicalDrafts.length, reserve: replay.drafts.length - physicalDrafts.length },
    correspondence, finalCounters, finalCountersMatchPlan,
  }
}

function physicalRecord(plan: ProductionPlan | null, input: PlannerInput, handoff: MaterializedEntriesHandoff): { record: PhysicalRecord; ends: Map<string, number> | null } {
  const empty: PhysicalRecord = {
    error: null, planSteps: null, physicalOperations: null, nonPhysicalSteps: {}, nonPhysicalStepCount: null, operationCounts: null, streamAdvanceSum: null,
    identityHolds: null, sharedPhysicalSteps: null, streams: [], streamComparison: [], objective: handoff.objective, executedHash: null,
  }
  if (plan === null) return { record: empty, ends: null }
  let summary: ReturnType<typeof summarizePlanPhysical>
  try {
    summary = summarizePlanPhysical(plan, input)
  } catch (error) {
    return { record: { ...empty, planSteps: plan.steps.length, error: error instanceof Error ? error.message : String(error) }, ends: null }
  }
  const streams = sorted(Object.keys(summary.streams)).map(stream => ({ stream, start: summary.streams[stream]!.start, end: summary.streams[stream]!.end, advance: summary.streams[stream]!.advance }))
  const structural = new Map<string, number>([['skill', handoff.streamEnd.skill - handoff.origins.skill], ['gogma', handoff.streamEnd.gogma - handoff.origins.gogma]])
  for (const [counterId, end] of Object.entries(handoff.streamEnd.normal)) structural.set(streamKeyOfNormal(counterId), end - (handoff.origins.normal[counterId] ?? end))
  const planAdvance = new Map(streams.map(stream => [stream.stream, stream.advance]))
  const streamComparison = sorted(new Set([...structural.keys(), ...planAdvance.keys()])).map(stream => {
    const structuralAdvance = structural.get(stream) ?? 0
    const advance = planAdvance.get(stream) ?? 0
    return { stream, structuralAdvance, planAdvance: advance, equal: structuralAdvance === advance }
  })
  const nonPhysicalStepCount = Object.values(summary.nonPhysicalSteps).reduce((sum, count) => sum + count, 0)
  return {
    record: {
      error: null, planSteps: summary.planSteps, physicalOperations: summary.physicalOperations, nonPhysicalSteps: { ...summary.nonPhysicalSteps }, nonPhysicalStepCount,
      operationCounts: { ...summary.operationCounts }, streamAdvanceSum: summary.streamAdvanceSum, identityHolds: summary.identityHolds,
      sharedPhysicalSteps: summary.sharedPhysicalSteps, streams, streamComparison, objective: handoff.objective, executedHash: hashStableValue(summary.executed),
    },
    ends: new Map(streams.map(stream => [stream.stream, stream.end])),
  }
}

function rejectionReasons(planner: PlannerRunRecord, replay: TraceReplayRecord, planningTargetCount: number): PlannerRejectionReason[] {
  const reasons: PlannerRejectionReason[] = []
  if (planner.error !== null) reasons.push({ code: 'plan_generation_error', errorName: planner.error.name, message: planner.error.message })
  if (!planner.planPresent) reasons.push({ code: 'plan_null' })
  const termination = planner.termination
  if (termination !== null) {
    if (termination.status !== 'completed') reasons.push({ code: 'termination_not_completed', status: termination.status, reachedLimits: [...termination.reachedLimits] })
    if (termination.reachedLimits.includes('max_plan_steps')) reasons.push({ code: 'max_plan_steps_reached', maxPlanSteps: termination.limits.maxPlanSteps })
    if (termination.completedTargetCount !== planningTargetCount) reasons.push({ code: 'completed_target_count_mismatch', completed: termination.completedTargetCount, planning: planningTargetCount })
    if (termination.totalTargetCount !== planningTargetCount) reasons.push({ code: 'total_target_count_mismatch', total: termination.totalTargetCount, planning: planningTargetCount })
  }
  if (planner.planPresent) {
    const selected = new Set(planner.selectedBuildListEntryIds)
    const expected = new Set(planner.expectedSelectedBuildListEntryIds)
    const missing = planner.expectedSelectedBuildListEntryIds.filter(id => !selected.has(id))
    const unexpected = planner.selectedBuildListEntryIds.filter(id => !expected.has(id))
    if (missing.length > 0 || unexpected.length > 0) reasons.push({ code: 'selected_entries_mismatch', missing, unexpected })
  }
  if (planner.conflicts.length > 0) reasons.push({ code: 'conflicts', count: planner.conflicts.length, kinds: countKinds(planner.conflicts.map(conflict => conflict.kind)) })
  if (planner.rejected.length > 0) {
    reasons.push({ code: 'rejected_entries', count: planner.rejected.length, reasons: countKinds(planner.rejected.map(entry => entry.reason)), resourceConflicts: planner.rejected.filter(entry => entry.reason === 'resource_conflict').length })
  }
  if (planner.warnings.length > 0) reasons.push({ code: 'warnings', count: planner.warnings.length, kinds: countKinds(planner.warnings.map(warning => warning.kind)) })
  if (planner.fullPlannerRuns > 1) reasons.push({ code: 'runtime_unsupported_retry', fullPlannerRuns: planner.fullPlannerRuns })
  if (!replay.ran) reasons.push({ code: 'trace_replay_not_run' })
  else {
    if (replay.isValid !== true) reasons.push({ code: 'trace_replay_invalid', issueCodes: [...replay.issueCodes] })
    if (replay.unsupportedInput) reasons.push({ code: 'trace_replay_unsupported_input' })
    const correspondence = replay.correspondence
    if (planner.planPresent && (correspondence === null || correspondence.mismatches > 0 || replay.finalCountersMatchPlan === false)) {
      reasons.push({
        code: 'trace_replay_correspondence_mismatch', mismatches: correspondence?.mismatches ?? 0, counterPositionMismatches: correspondence?.counterPositionMismatches ?? 0,
        finalCountersMatch: replay.finalCountersMatchPlan,
      })
    }
  }
  return reasons
}

function objectiveReasons(physical: PhysicalRecord): ObjectiveMismatchReason[] {
  if (physical.error !== null) return [{ code: 'physical_summary_error', message: physical.error }]
  const reasons: ObjectiveMismatchReason[] = []
  const operations = physical.physicalOperations!
  if (!physical.identityHolds) reasons.push({ code: 'physical_identity_broken', physicalOperations: operations, streamAdvanceSum: physical.streamAdvanceSum! })
  if (operations !== physical.planSteps) reasons.push({ code: 'physical_steps_mismatch', physicalOperations: operations, planSteps: physical.planSteps!, nonPhysicalSteps: physical.nonPhysicalStepCount! })
  if (operations !== physical.objective) reasons.push({ code: 'physical_objective_mismatch', physicalOperations: operations, objective: physical.objective })
  return reasons
}

/**
 * Phase D' over one candidate's handoff, in this process: the final input, the Production Planner, the independent Trace Replay
 * and the physical operations, with every design 9.5 in-process condition evaluated and the outcome typed (design 9.6). The
 * original input is never edited; the Planner's own dependencies (`dependencies`) should be fresh for this run so the Plan's IDs
 * do not depend on what ran before in the process.
 */
export async function verifyPlannerCandidate(original: PlannerInput, handoff: MaterializedEntriesHandoff, dependencies: PlannerDependencies,
  conditions: PlannerVerificationConditions, execution: PlannerVerificationExecution): Promise<PlannerVerificationRecord> {
  if (!Number.isSafeInteger(conditions.researchMaxPlanSteps) || conditions.researchMaxPlanSteps < 1) {
    throw new RangeError(`researchMaxPlanSteps must be a positive safe integer (got ${String(conditions.researchMaxPlanSteps)}).`)
  }
  const port = execution.planner ?? productionPlannerVerificationPort
  const now = execution.now
  const started = now()
  const elapsed: PlannerVerificationRecord['observed']['elapsedMs'] = { handoff: null, final_input: null, planner: null, trace_replay: null, physical: null, total: 0 }
  const stage = async <T>(name: PlannerVerificationStage, body: () => T | Promise<T>): Promise<T> => {
    execution.onStage?.({ stage: name, status: 'started' })
    const at = now()
    const value = await body()
    elapsed[name] = now() - at
    execution.onStage?.({ stage: name, status: 'finished' })
    return value
  }
  const checks = emptyChecks()
  const base = {
    protocolVersion: PLANNER_VERIFICATION_PROTOCOL_VERSION,
    nature: 'research_phase_d_prime_one_process: the in-process conditions of design 9.5; not verified without the fresh process, not a formal VerifiedPlanRecord' as const,
    conditions: { researchMaxPlanSteps: conditions.researchMaxPlanSteps },
    candidate: {
      candidateIndex: handoff.candidateIndex, ordinal: handoff.ordinal, objective: handoff.objective, planningTargetCount: handoff.planningTargetIds.length,
      materializedEntryCount: handoff.materializedEntries.length, stage: handoff.stage.kind, entryFingerprint: materializedEntriesFingerprint(handoff.materializedEntries),
    },
  }
  const finish = (semantic: Pick<PlannerVerificationSemantic, 'finalInput' | 'planner' | 'traceReplay' | 'physical' | 'outcome'>): PlannerVerificationRecord => {
    elapsed.total = now() - started
    return { semantic: { ...base, ...semantic, checks }, observed: { elapsedMs: elapsed } }
  }

  // 1. The handoff: Phase D' verifies an all_materialized candidate only (design 9.6: anything else is a materialization outcome).
  const handoffResult = await stage('handoff', (): { stop: Extract<PlannerVerificationRunOutcome, { targetWeaponId: string }> | null; reasons: PlanningTargetSetChangeReason[] } => {
    if (handoff.stage.kind === 'all_materialized') return { stop: null, reasons: handoffReasons(handoff) }
    const failed = handoff.stage
    const outcome = failed.outcome
    return { stop: { kind: failed.kind, targetWeaponId: failed.targetWeaponId as string, outcomeKind: outcome.kind, outcomeReason: 'reason' in outcome ? String(outcome.reason) : null }, reasons: [] }
  })
  if (handoffResult.stop !== null) return finish({ finalInput: null, planner: null, traceReplay: null, physical: null, outcome: handoffResult.stop })
  if (handoffResult.reasons.length > 0) return finish({ finalInput: null, planner: null, traceReplay: null, physical: null, outcome: { kind: 'planning_target_set_changed', reasons: handoffResult.reasons } })

  // 2 - 3. The final input and its planning Target set.
  const built = await stage('final_input', () => buildFinalInput(original, handoff, conditions, dependencies))
  if (built.kind === 'changed') return finish({ finalInput: built.record, planner: null, traceReplay: null, physical: null, outcome: { kind: 'planning_target_set_changed', reasons: built.reasons } })
  const finalInput = built.input

  // 4. The Production Planner (the deterministic scheduler; every full run counted, retries included).
  const observed: { fullPlannerRuns: number; lastRun: PlannerRunResult | null } = { fullPlannerRuns: 0, lastRun: null }
  const run = await stage('planner', async (): Promise<{ result: PlannerResult | null; error: unknown }> => {
    try {
      const value = await port.createProductionPlanWithObserver(finalInput, dependencies, {
        ...(execution.shouldCancel ? { shouldCancel: execution.shouldCancel } : {}), ...(execution.yieldControl ? { yieldControl: execution.yieldControl } : {}),
      }, { beforePlannerRun: () => { observed.fullPlannerRuns += 1 }, afterPlannerRun: value => { observed.lastRun = value } })
      return { result: value, error: null }
    } catch (caught) {
      return { result: null, error: caught }
    }
  })
  const { result } = run
  const expectedSelected = handoff.materializedEntries.map(({ entry }) => entry.id as string)
  const planner = plannerRecord(result, run.error, observed.fullPlannerRuns, expectedSelected)
  const plan: ProductionPlan | null = result?.plan ?? null
  if (planner.termination?.status === 'cancelled') return finish({ finalInput: built.record, planner, traceReplay: null, physical: null, outcome: { kind: 'unmeasured', reason: 'cancelled' } })

  // 6 first (5 reads the Plan's stream ends), then 5: the independent Trace Replay of the last full run's trace.
  const physical = await stage('physical', () => physicalRecord(plan, finalInput, handoff))
  const bestState = observed.lastRun?.bestState ?? null
  const traceReplay = await stage('trace_replay', () => traceReplayRecord(
    bestState === null ? null : port.replayPlannerSearchTrace(finalInput, bestState, dependencies.rngEngine), plan, finalInput, physical.ends,
  ))

  const planningTargetCount = handoff.planningTargetIds.length
  const termination = planner.termination
  checks.planPresent = planner.planPresent
  checks.terminationCompleted = termination === null ? false : termination.status === 'completed'
  checks.completedEqualsPlanningTargets = termination === null ? false : termination.completedTargetCount === planningTargetCount
  checks.totalEqualsPlanningTargets = termination === null ? false : termination.totalTargetCount === planningTargetCount
  checks.allPlanningEntriesSelected = planner.planPresent && hashStableValue(planner.selectedBuildListEntryIds) === hashStableValue(planner.expectedSelectedBuildListEntryIds)
  checks.noConflicts = result !== null && planner.conflicts.length === 0
  checks.noRejectedEntries = planner.planPresent && planner.rejected.length === 0
  checks.noResourceConflicts = planner.planPresent && planner.rejected.every(entry => entry.reason !== 'resource_conflict')
  checks.noWarnings = result !== null && planner.warnings.length === 0
  checks.traceReplayValid = traceReplay.ran && traceReplay.isValid === true && !traceReplay.unsupportedInput && traceReplay.correspondence !== null
    && traceReplay.correspondence.mismatches === 0 && traceReplay.finalCountersMatchPlan !== false
  const objectiveIssues = plan === null ? null : objectiveReasons(physical.record)
  checks.physicalEqualsPlanSteps = objectiveIssues === null ? null : physical.record.error === null && physical.record.identityHolds === true && physical.record.physicalOperations === physical.record.planSteps
  checks.physicalEqualsObjective = objectiveIssues === null ? null : physical.record.error === null && physical.record.physicalOperations === handoff.objective

  const rejected = rejectionReasons(planner, traceReplay, planningTargetCount)
  const semantic = { finalInput: built.record, planner, traceReplay, physical: physical.record }
  if (rejected.length > 0) return finish({ ...semantic, outcome: { kind: 'planner_rejected', reasons: rejected } })
  if (objectiveIssues !== null && objectiveIssues.length > 0) {
    return finish({ ...semantic, outcome: { kind: 'objective_mismatch', physicalOperations: physical.record.physicalOperations, objective: handoff.objective, reasons: objectiveIssues } })
  }
  return finish({ ...semantic, outcome: { kind: 'conditions_met' } })
}
