import { stableStringify } from '../../domain/models/publicTypes'
import type { BuildListEntry, OwnedWeaponId, PlanStep, PlanStepExecutionEffects, ProductionPlan } from '../../domain/models/publicTypes'
import type {
  BuildListOptimizationDiagnostics,
  BuildListOptimizationResult,
} from '../../domain/planner/buildListOptimization'
import type { BloDiagnosticsView, BloResultView, BloSemanticFingerprint } from './buildListOptimizationBenchmarkProtocol'

/**
 * Issue #260 PR-5A: the semantics of one Build List optimization result and their fingerprints (benchmark only).
 *
 * `docs/PLANNER_SPEC.md` 17.6: the same input gives the same ReachTable, structural candidates, route generation order, Candidate
 * meaning, generated Entry IDs and Plan semantics (Step sequence, physical operation count); the Plan ID, Step IDs, reserved
 * OwnedWeapon IDs and every time come from the Production ID factory and Clock and differ between runs. The projection below keeps
 * the former and drops or normalizes the latter (a reserved weapon ID becomes a symbol of its registration order, so the relations
 * between Steps survive), so two runs are compared by meaning, never by a UUID or a time. Each component is fingerprinted
 * on its own (a mismatch names the component) and the whole projection once; the projection itself never leaves the page.
 */

/** A copy without the Clock-derived `createdAt` / `updatedAt` of an Entry or Candidate (every other field is semantic). */
function withoutClockFields<T>(value: T): T {
  if (Array.isArray(value)) return value.map(withoutClockFields) as T
  if (typeof value !== 'object' || value === null) return value
  const copy: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(value)) {
    if (key === 'createdAt' || key === 'updatedAt') continue
    copy[key] = withoutClockFields(field)
  }
  return copy as T
}

/** A generated Entry by meaning: its ID, Candidate, hashes, selection and Route (no creation time). */
function entrySemantics(entry: BuildListEntry) {
  return withoutClockFields(entry)
}

/** A weapon reference of one Plan: an input weapon's ID, or the symbol of a weapon the Plan registers (see `weaponReferencesOf()`). */
type WeaponReference = (id: OwnedWeaponId | null) => string | null

/**
 * The OwnedWeapon reference normalization of one Plan.
 *
 * Two kinds of OwnedWeapon ID appear in a Plan. An existing weapon's ID comes from the input (the Export) and is the same in every
 * run, so it is kept as it is: which input weapon a Step works on is semantics. A weapon the Plan registers (the production-target
 * Normal, `executionEffects.registersTrackedWeapon`) gets a reserved ID from the Production ID factory (a UUID that differs per run),
 * and every later Step names that same ID (conversion and amendments keep it, `docs/PLANNER_SPEC.md` 16.3). Such an ID is replaced
 * by `registered-weapon#<n>`, `n` counting the registrations in Step order: the symbol depends on the Plan's order alone, never on
 * the ID's value, and the relation "these Steps name the same registered weapon" survives. A reserved ID that some Step names
 * without any registration is left as it is, so it would differ between runs and fail the comparison rather than pass it.
 */
function weaponReferencesOf(plan: ProductionPlan): WeaponReference {
  const registered = new Map<string, string>()
  for (const step of plan.steps) {
    const effects = step.executionEffects
    if (effects?.registersTrackedWeapon === true && effects.trackedOwnedWeaponId !== null && !registered.has(effects.trackedOwnedWeaponId)) {
      registered.set(effects.trackedOwnedWeaponId, `registered-weapon#${registered.size + 1}`)
    }
  }
  return id => (id === null ? null : registered.get(id) ?? id)
}

/**
 * A Step's Execution effects by meaning (`docs/DATA_MODEL.md` 11.3): every field as it is - the Normal creation role, the
 * registration, the observation binding, the Target links, the compromise labels and the Target completions with their Entries and
 * Targets, in order - except the OwnedWeapon IDs, which go through the weapon reference normalization. An absent `executionEffects`
 * (a legacy Step) is `{ present: false }`, never the same as present effects that are empty.
 */
function effectsSemantics(effects: PlanStepExecutionEffects | undefined, weapon: WeaponReference) {
  if (effects === undefined) return { present: false }
  return {
    present: true,
    ...structuredClone(effects),
    trackedOwnedWeaponId: weapon(effects.trackedOwnedWeaponId),
    compromiseLabels: effects.compromiseLabels.map(label => ({ ...label, ownedWeaponId: weapon(label.ownedWeaponId) })),
    targetCompletions: effects.targetCompletions.map(completion => ({ ...completion, ownedWeaponId: weapon(completion.ownedWeaponId) })),
  }
}

/**
 * A Plan Step by meaning. Kept: the order, operation, the Target / Entry / Candidate it serves, the Targets it progresses, its
 * checkpoint milestones, the expected result, the Counter advance, the debug Counter positions, the weapon it works on and its
 * Execution effects (both through the weapon reference normalization). Dropped: the Step ID (ID factory), the expected state hashes
 * (they hash reserved weapon IDs), the inventory change (whole OwnedWeapon bodies with reserved IDs, the Plan's in-progress mark and
 * times; the effects above carry what a Step does to which weapon), the title / instruction texts (presentation) and the completion
 * fields of a draft.
 */
function stepSemantics(step: PlanStep, weapon: WeaponReference) {
  return {
    order: step.order,
    operationType: step.operationType,
    targetWeaponId: step.targetWeaponId,
    buildListEntryId: step.buildListEntryId,
    progressedTargetWeaponIds: step.progressedTargetWeaponIds ?? null,
    checkpointMilestones: step.checkpointMilestones ?? null,
    candidateId: step.candidateId,
    ownedWeaponId: weapon(step.ownedWeaponId),
    expectedResult: step.expectedResult,
    rngAdvance: step.rngAdvance,
    executionEffects: effectsSemantics(step.executionEffects, weapon),
    requiresUserConfirmation: step.requiresUserConfirmation,
    debug: step.debug === null ? null : {
      startGogmaCounter: step.debug.startGogmaCounter, endGogmaCounter: step.debug.endGogmaCounter,
      startSkillCounter: step.debug.startSkillCounter, endSkillCounter: step.debug.endSkillCounter,
      startNormalCounter: step.debug.startNormalCounter, endNormalCounter: step.debug.endNormalCounter,
    },
  }
}

/** Every Step of a Plan by meaning, under one weapon reference normalization of that Plan. */
function stepsSemantics(plan: ProductionPlan) {
  const weapon = weaponReferencesOf(plan)
  return plan.steps.map(step => stepSemantics(step, weapon))
}

/** The Plan by meaning: everything but its ID, current Step ID and times. */
function planSemantics(plan: ProductionPlan) {
  return {
    status: plan.status,
    selectedBuildListEntryIds: plan.selectedBuildListEntryIds,
    calculationContext: plan.calculationContext,
    baseSnapshot: withoutClockFields(plan.baseSnapshot),
    conflicts: plan.conflicts.length,
    rejectedBuildListEntries: plan.rejectedBuildListEntries.length,
    requiredMaterials: plan.requiredMaterials,
    recalculationReasons: plan.recalculationReasons,
    conflictRepairLineage: plan.conflictRepairLineage,
    steps: plan.steps.length,
  }
}

/** Diagnostics without the Worker's stage times (timing is not semantics). */
function diagnosticsSemantics(diagnostics: BuildListOptimizationDiagnostics) {
  return { reachTable: diagnostics.reachTable, structuralSearch: diagnostics.structuralSearch, candidates: diagnostics.candidates, plannerVerifications: diagnostics.plannerVerifications }
}

/** The semantic components of one result, each a plain value (stable-stringified for its fingerprint). */
export function bloSemanticComponents(result: BuildListOptimizationResult): Record<string, unknown> {
  switch (result.status) {
    case 'optimized': {
      const artifact = result.artifact
      const plan = artifact.plannerResult.plan
      return {
        status: result.status,
        generatedEntries: artifact.generatedBuildListEntries.map(entrySemantics),
        replacements: artifact.replacements,
        unchangedTargets: artifact.unchangedTargetWeaponIds,
        planningTargets: artifact.planningTargetWeaponIds,
        inputExclusions: artifact.inputExclusions,
        inputToken: artifact.inputToken,
        summary: artifact.summary,
        termination: artifact.plannerResult.termination,
        conflicts: artifact.plannerResult.conflicts,
        warnings: artifact.plannerResult.warnings,
        plan: plan === null ? null : planSemantics(plan),
        steps: plan === null ? null : stepsSemantics(plan),
        diagnostics: diagnosticsSemantics(artifact.diagnostics),
      }
    }
    case 'not_found':
      return { status: result.status, reason: result.reason, diagnostics: diagnosticsSemantics(result.diagnostics) }
    case 'search_bound_reached':
      return { status: result.status, bounds: result.bounds, diagnostics: diagnosticsSemantics(result.diagnostics) }
    case 'unsupported':
      return { status: result.status, reasons: result.reasons }
  }
}

/** SHA-256 hex of a UTF-8 text (Web Crypto in the page, `node:crypto` in Node). */
export type BloSha256Text = (text: string) => Promise<string>

/** The fingerprints of one result: one per component and one over all of them. */
export async function bloSemanticFingerprint(result: BuildListOptimizationResult, sha256Text: BloSha256Text): Promise<BloSemanticFingerprint> {
  const components = bloSemanticComponents(result)
  const fingerprints: Record<string, string> = {}
  for (const [name, value] of Object.entries(components)) fingerprints[name] = await sha256Text(stableStringify(value))
  return { sha256: await sha256Text(stableStringify(components)), components: fingerprints }
}

function diagnosticsView(diagnostics: BuildListOptimizationDiagnostics): BloDiagnosticsView {
  return {
    reachTable: diagnostics.reachTable === null ? null : structuredClone(diagnostics.reachTable),
    structuralSearch: diagnostics.structuralSearch === null ? null : { ...diagnostics.structuralSearch },
    candidates: diagnostics.candidates.map(candidate => ({
      ordinal: candidate.ordinal,
      objective: candidate.objective,
      routeGeneration: { outcome: candidate.routeGeneration.outcome, generatedTargetCount: candidate.routeGeneration.generatedTargetCount, methods: { ...candidate.routeGeneration.methods } },
      verification: candidate.verification === null ? null : {
        outcome: candidate.verification.outcome, maxPlanSteps: candidate.verification.maxPlanSteps, fullPlannerRuns: candidate.verification.fullPlannerRuns,
        rejectionCodes: candidate.verification.rejections.map(rejection => rejection.code),
      },
    })),
    plannerVerifications: diagnostics.plannerVerifications,
    workerStageMs: diagnostics.elapsedMs === null ? null : { ...diagnostics.elapsedMs },
  }
}

/** The minimized view of one result the raw record keeps: counts and classifications, no identity, plus the fingerprints. */
export async function bloResultView(result: BuildListOptimizationResult, sha256Text: BloSha256Text): Promise<BloResultView> {
  const semantic = await bloSemanticFingerprint(result, sha256Text)
  const empty: Omit<BloResultView, 'status' | 'semantic'> = {
    planningTargetCount: null, completedTargetCount: null, physicalOperationCount: null, planStepCount: null, nonPhysicalStepCount: null,
    structuralObjective: null, maxPlanSteps: null, conflictCount: null, rejectedEntryCount: null, warningCount: null, generatedEntryCount: null,
    unchangedTargetCount: null, inputExclusionCount: null, outOfScopeTargetCounts: null, boundKinds: [], notFoundReason: null, unsupportedReasonKinds: [], diagnostics: null,
  }
  switch (result.status) {
    case 'optimized': {
      const { artifact } = result
      const { summary } = artifact
      return {
        ...empty, status: result.status, semantic,
        planningTargetCount: artifact.planningTargetWeaponIds.length, completedTargetCount: summary.completedTargetCount,
        physicalOperationCount: summary.physicalOperationCount, planStepCount: summary.planStepCount, nonPhysicalStepCount: summary.nonPhysicalStepCount,
        structuralObjective: summary.structuralObjective, maxPlanSteps: summary.maxPlanSteps,
        conflictCount: artifact.plannerResult.conflicts.length, rejectedEntryCount: artifact.plannerResult.plan?.rejectedBuildListEntries.length ?? null,
        warningCount: artifact.plannerResult.warnings.length, generatedEntryCount: artifact.generatedBuildListEntries.length,
        unchangedTargetCount: artifact.unchangedTargetWeaponIds.length, inputExclusionCount: artifact.inputExclusions.length,
        outOfScopeTargetCounts: { ...summary.outOfScopeTargetCounts }, diagnostics: diagnosticsView(artifact.diagnostics),
      }
    }
    case 'not_found':
      return { ...empty, status: result.status, semantic, notFoundReason: result.reason, diagnostics: diagnosticsView(result.diagnostics) }
    case 'search_bound_reached':
      return { ...empty, status: result.status, semantic, boundKinds: result.bounds.map(bound => bound.kind), diagnostics: diagnosticsView(result.diagnostics) }
    case 'unsupported':
      return { ...empty, status: result.status, semantic, unsupportedReasonKinds: result.reasons.map(reason => reason.kind) }
  }
}
