import {
  applyBuildListEntryReplacements,
  buildListEntriesForTarget,
  evaluateBuildListEntryStaleness,
  validateBuildListEntryReplacements,
  validateGeneratedBuildListEntryReplacements,
  validateReplacedBuildListCardinality,
  type BuildListEntryReplacement,
} from '../buildList'
import type {
  BuildListEntry,
  BuildListEntryId,
  CalculationContext,
  NormalArtianCounter,
  OwnedWeapon,
  ProductionPlan,
  RngState,
  TargetWeapon,
} from '../models/publicTypes'
import {
  validateBuildListEntry,
  validatePlannerConflictRepairLineage,
  validateProductionPlan,
} from '../models/publicTypes'
import type { DomainValidationResult } from '../models/validation'
import type { PlannerAlternativeRepairArtifact } from './alternative'
import type { PlannerRunTermination } from './plannerTypes'

/**
 * The pure save-time checks a Planner orchestration result must pass before it
 * is persisted (`docs/PLANNER_SPEC.md` 9.2.15), shared by the ordinary Planner
 * result save and the replan adoption (16.8).
 *
 * Each check returns the first issue it finds, or `null`. It never throws, so
 * each caller maps an issue onto its own error boundary: the ordinary save onto
 * `RepositoryError`, the replan adoption onto `ExecutionRuntimeError`.
 */
export type PlannerResultPersistenceIssue =
  /** The result itself violates an invariant it must satisfy to be persisted. */
  | { kind: 'result_invalid'; message: string }
  /** Domain validation rejected the Plan or a generated Entry. */
  | {
      kind: 'entity_invalid'
      entityName: 'ProductionPlan' | 'BuildListEntry'
      validation: DomainValidationResult
    }
  /** Current persisted state moved under the calculation. */
  | { kind: 'state_changed'; message: string }

function resultInvalid(message: string): PlannerResultPersistenceIssue {
  return { kind: 'result_invalid', message }
}

/**
 * The result-shape invariants that do not depend on current persisted state:
 * a completed / exhausted search, a draft Plan, unique generated Entry IDs,
 * exactly one replacement per generated Entry naming its own Target
 * (`docs/PLANNER_SPEC.md` 9.2.18), and Domain-valid Plan and Entries. A
 * malformed Worker result - replacement metadata missing, extra, duplicated or
 * for another Target - is never persisted.
 */
export function checkPersistablePlannerResultShape(
  plan: ProductionPlan,
  generatedEntries: readonly BuildListEntry[],
  termination: PlannerRunTermination,
  replacements: readonly BuildListEntryReplacement[] | undefined,
): PlannerResultPersistenceIssue | null {
  // PLANNER_SPEC 7.2.1: a Plan calculated from a full Planner run that its
  // `maxPlanSteps` bound truncated is a partial run artifact, not a finished
  // production plan, so it never becomes an executable Draft. The typed
  // termination decides this - never a `PlannerWarning` message, and never the
  // presence of `max_steps_reached`, which a completed run can carry too.
  if (termination.status === 'incomplete') {
    return resultInvalid(
      `The Planner run did not complete: it reached ${termination.reachedLimits.join(', ')} with ${termination.completedTargetCount} of ${termination.totalTargetCount} target weapons completed. A truncated Planner run result must not be saved as an executable ProductionPlan.`,
    )
  }
  if (plan.status !== 'draft') {
    return resultInvalid(
      `A Planner orchestration result must be saved as a draft ProductionPlan, but its status is '${plan.status}'.`,
    )
  }
  const duplicated = generatedEntries
    .map(({ id }) => id)
    .filter((id, index, all) => all.indexOf(id) !== index)
  if (duplicated.length > 0) {
    return resultInvalid(
      `Generated BuildListEntry IDs must be unique: '${duplicated[0]}' appears more than once.`,
    )
  }
  const pairing = validateGeneratedBuildListEntryReplacements(generatedEntries, replacements)
  if (!pairing.isValid) {
    return resultInvalid(
      `The generated BuildListEntry replacements are malformed: ${pairing.issues.map(({ message }) => message).join(' ')}`,
    )
  }
  const planValidation = validateProductionPlan(plan)
  if (!planValidation.isValid) {
    return { kind: 'entity_invalid', entityName: 'ProductionPlan', validation: planValidation }
  }
  for (const entry of generatedEntries) {
    const entryValidation = validateBuildListEntry(entry)
    if (!entryValidation.isValid) {
      return { kind: 'entity_invalid', entityName: 'BuildListEntry', validation: entryValidation }
    }
  }
  return null
}

/**
 * A generated Entry that is already persisted was not the `reusedExisting`
 * case - a reused Entry is never returned as generated - so the same ID
 * appearing now is a save-time race, never a silent reuse or overwrite.
 */
export function findPersistedGeneratedBuildListEntryCollision(
  generatedEntries: readonly BuildListEntry[],
  persistedEntries: readonly BuildListEntry[],
): PlannerResultPersistenceIssue | null {
  const persistedIds = new Set(persistedEntries.map(({ id }) => id))
  const collided = generatedEntries.find(({ id }) => persistedIds.has(id))
  return collided
    ? {
        kind: 'state_changed',
        message: `Generated BuildListEntry '${collided.id}' already exists in persistence; current state changed after the Planner ran.`,
      }
    : null
}

/**
 * The save-time half of the replacement contract (`docs/PLANNER_SPEC.md`
 * 9.2.18): for every replacement, the Target's persisted Entries are *still*
 * exactly the `O` the calculation replaced. A Target that meanwhile lost `O`,
 * holds another Entry instead or beside it, or now holds two Entries is a state
 * change: nothing is deleted on a guess, so a `B3` that replaced `B1` after the
 * Planner ran is never removed by an older result.
 */
export function checkBuildListEntryReplacementsCurrent(
  replacements: readonly BuildListEntryReplacement[],
  persistedEntries: readonly BuildListEntry[],
): PlannerResultPersistenceIssue | null {
  for (const { targetWeaponId, replacedBuildListEntryId } of replacements) {
    const current = buildListEntriesForTarget(persistedEntries, targetWeaponId).map(({ id }) => id)
    if (current.length !== 1 || current[0] !== replacedBuildListEntryId) {
      return {
        kind: 'state_changed',
        message: `TargetWeapon '${targetWeaponId}' now holds [${current.join(', ')}] instead of the BuildListEntry '${replacedBuildListEntryId}' the Planner result replaces; current state changed after the Planner ran.`,
      }
    }
  }
  return null
}

export type FinalReplacementBuildListResult =
  | { issue: null; finalEntries: BuildListEntry[] }
  | { issue: PlannerResultPersistenceIssue; finalEntries: null }

/**
 * The **final replacement set** a Planner result is persisted into
 * (`docs/PLANNER_SPEC.md` 9.2.15 / 9.2.18): the current persisted Entries,
 * minus each replaced `O`, plus each generated `G`. Shared by the ordinary
 * Draft save and the replan adoption, it refuses - before any write - a
 * generated ID that is already persisted (never overwritten), a Target whose
 * persisted Entry is no longer exactly the expected `O`, and a final set in
 * which a replaced Target does not hold exactly its `G`
 * (`validateBuildListCardinality()`).
 */
export function prepareFinalReplacementBuildList(
  persistedEntries: readonly BuildListEntry[],
  generatedEntries: readonly BuildListEntry[],
  replacements: readonly BuildListEntryReplacement[],
): FinalReplacementBuildListResult {
  const collision = findPersistedGeneratedBuildListEntryCollision(generatedEntries, persistedEntries)
  if (collision !== null) return { issue: collision, finalEntries: null }
  const current = checkBuildListEntryReplacementsCurrent(replacements, persistedEntries)
  if (current !== null) return { issue: current, finalEntries: null }
  const finalEntries = applyBuildListEntryReplacements(persistedEntries, replacements, generatedEntries)
  const structure = validateBuildListEntryReplacements(finalEntries, replacements, 'replaced')
  const cardinality = validateReplacedBuildListCardinality(finalEntries, replacements)
  const issues = [...structure.issues, ...cardinality.issues]
  if (issues.length > 0) {
    return {
      issue: resultInvalid(
        `The final Build List after the replacements violates the Build List cardinality contract: ${issues.map(({ message }) => message).join(' ')}`,
      ),
      finalEntries: null,
    }
  }
  return { issue: null, finalEntries }
}

export interface GeneratedBuildListEntryStalenessState {
  rngState: RngState
  normalCounters: readonly NormalArtianCounter[]
  ownedWeapons: readonly OwnedWeapon[]
  targetWeapons: readonly TargetWeapon[]
}

/**
 * Every generated Entry is fresh against current state, recomputed from that
 * state and never read off the persisted flags.
 */
export function checkGeneratedBuildListEntriesFresh(
  generatedEntries: readonly BuildListEntry[],
  current: GeneratedBuildListEntryStalenessState,
  currentCalculationContext: CalculationContext,
): PlannerResultPersistenceIssue | null {
  const targetById = new Map(current.targetWeapons.map((target) => [target.id, target]))
  for (const entry of generatedEntries) {
    const staleness = evaluateBuildListEntryStaleness(entry, {
      target: targetById.get(entry.targetWeaponId) ?? null,
      rngState: current.rngState,
      normalCounters: [...current.normalCounters],
      ownedWeapons: [...current.ownedWeapons],
      calculationContext: currentCalculationContext,
    })
    if (staleness.isStale) {
      return {
        kind: 'state_changed',
        message: `Generated BuildListEntry '${entry.id}' is stale against current state (${staleness.staleReasons.join(', ')}).`,
      }
    }
  }
  return null
}

/**
 * Every BuildListEntry the Plan references exists in the final replacement set
 * (`prepareFinalReplacementBuildList()`), each Candidate-derived Step carries
 * its Entry Snapshot's Candidate ID, and every generated Entry is selected by
 * the final Plan (PLANNER_SPEC 9.2.14 / 9.2.18). A replaced Entry `O` is not
 * part of that set, so a Plan still naming it anywhere - a selected Entry, a
 * Step, a conflict participant, recommendation or selection, a rejection - is
 * refused.
 *
 * The "every generated Entry is selected" half is the B8 orchestration
 * contract. The Planner Alternative actual repair does not have it (an
 * accepted replacement may be unselected, 9.2.19.6), so it checks only
 * `checkProductionPlanBuildListEntryReferences()`.
 */
export function checkProductionPlanBuildListReferences(
  plan: ProductionPlan,
  generatedEntries: readonly BuildListEntry[],
  finalEntries: readonly BuildListEntry[],
): PlannerResultPersistenceIssue | null {
  const references = checkProductionPlanBuildListEntryReferences(plan, finalEntries)
  if (references !== null) return references
  const selected = new Set(plan.selectedBuildListEntryIds)
  const unselected = generatedEntries.find(({ id }) => !selected.has(id))
  if (unselected) {
    return resultInvalid(
      `Generated BuildListEntry '${unselected.id}' is not selected by the final ProductionPlan.`,
    )
  }
  return null
}

/**
 * Every BuildListEntry the Plan references - a selected Entry, a Step, a
 * conflict participant, recommendation or selection, a rejection - exists in
 * the final replacement set, and each Candidate-derived Step carries its Entry
 * Snapshot's Candidate ID. A replaced Entry `O` is not part of that set, so a
 * Plan still naming it anywhere is refused.
 */
export function checkProductionPlanBuildListEntryReferences(
  plan: ProductionPlan,
  finalEntries: readonly BuildListEntry[],
): PlannerResultPersistenceIssue | null {
  const entryById = new Map(finalEntries.map((entry) => [entry.id, entry]))
  const missing = (id: BuildListEntryId, path: string) =>
    entryById.has(id)
      ? null
      : resultInvalid(
          `${path} references BuildListEntry '${id}', which is not part of the final replacement Build List.`,
        )

  for (const [index, id] of plan.selectedBuildListEntryIds.entries()) {
    const issue = missing(id, `selectedBuildListEntryIds[${index}]`)
    if (issue) return issue
  }
  for (const [index, conflict] of plan.conflicts.entries()) {
    for (const [participant, id] of conflict.buildListEntryIds.entries()) {
      const issue = missing(id, `conflicts[${index}].buildListEntryIds[${participant}]`)
      if (issue) return issue
    }
    if (conflict.recommendedBuildListEntryId !== null) {
      const issue = missing(
        conflict.recommendedBuildListEntryId,
        `conflicts[${index}].recommendedBuildListEntryId`,
      )
      if (issue) return issue
    }
    if (conflict.selectedBuildListEntryId !== null) {
      const issue = missing(
        conflict.selectedBuildListEntryId,
        `conflicts[${index}].selectedBuildListEntryId`,
      )
      if (issue) return issue
    }
  }
  for (const [index, rejected] of plan.rejectedBuildListEntries.entries()) {
    const issue = missing(
      rejected.buildListEntryId,
      `rejectedBuildListEntries[${index}].buildListEntryId`,
    )
    if (issue) return issue
  }
  for (const [index, step] of plan.steps.entries()) {
    if (step.buildListEntryId === null) continue
    const issue = missing(step.buildListEntryId, `steps[${index}].buildListEntryId`)
    if (issue) return issue
    const entry = entryById.get(step.buildListEntryId) as BuildListEntry
    // A Candidate-derived Step carries that Entry Snapshot's Candidate ID.
    if (step.candidateId !== entry.candidateSnapshot.id) {
      return resultInvalid(
        `steps[${index}].candidateId '${step.candidateId}' does not match the candidate Snapshot '${entry.candidateSnapshot.id}' of BuildListEntry '${entry.id}'.`,
      )
    }
  }
  return null
}

/**
 * Exact structural equality of two untrusted values: primitives by identity,
 * arrays element by element in order, plain objects field by field whatever
 * their key order (a field holding `undefined` equals an absent one). Nothing
 * is sorted or canonicalized.
 */
function sameStructure(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) return false
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
      left.every((value, index) => sameStructure(value, right[index]))
  }
  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const keys = new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)])
  return [...keys].every((key) => sameStructure(leftRecord[key], rightRecord[key]))
}

/** One Planner Alternative actual repair, its shape checked and its Draft carrying the lineage. */
export interface PersistablePlannerAlternativeRepair {
  /** The final scenario Plan with `conflictRepairLineage` set exactly to the artifact's lineage. */
  plan: ProductionPlan
  generatedEntries: readonly BuildListEntry[]
  replacements: readonly BuildListEntryReplacement[]
}

export type PlannerAlternativeRepairShapeResult =
  | { issue: null; repair: PersistablePlannerAlternativeRepair }
  | { issue: PlannerResultPersistenceIssue; repair: null }

function replacementIdentity(targetWeaponId: string, replaced: string, generated: string | null): string {
  return JSON.stringify([targetWeaponId, replaced, generated])
}

/**
 * The result-shape invariants of a Planner Alternative actual repair artifact
 * that do not depend on current persisted state (`docs/PLANNER_SPEC.md`
 * 9.2.19.8 / 9.2.19.11): a final scenario Plan exists, its run is not
 * `incomplete` and honoured every explicit resolution (no
 * `invalid_conflict_resolution`), `conflicts` and `plan.conflicts` are the one
 * expanded list - every PlanConflict equal field by field in the same order,
 * never only by ID - the generated Entries and their `O -> G` replacements pair up
 * (`checkPersistablePlannerResultShape()`: draft Plan, unique IDs, Domain-valid
 * Plan and Entries), and the lineage is structurally valid and its last
 * decision records exactly these replacements as `replaced`.
 *
 * It returns the Plan to persist: the artifact's Plan with
 * `conflictRepairLineage` set exactly to the artifact's lineage - never a
 * lineage rebuilt from persisted state or the Plan's Conflicts. It does not
 * require a generated Entry to be selected by the Plan: the accepted
 * replacement set is the authority (9.2.19.6), unlike the B8 contract of
 * `checkProductionPlanBuildListReferences()`.
 */
export function checkPersistablePlannerAlternativeRepairShape(
  artifact: PlannerAlternativeRepairArtifact,
): PlannerAlternativeRepairShapeResult {
  const fail = (issue: PlannerResultPersistenceIssue): PlannerAlternativeRepairShapeResult =>
    ({ issue, repair: null })
  const { plannerResult, conflictRepairLineage } = artifact
  const generatedEntries = artifact.generatedBuildListEntries
  const replacements = artifact.generatedBuildListEntryReplacements
  const artifactPlan = plannerResult.plan as ProductionPlan | null
  if (artifactPlan === null || artifactPlan === undefined) {
    return fail(resultInvalid('A Planner Alternative repair artifact must carry the final scenario Plan.'))
  }
  if (plannerResult.warnings.some(({ kind }) => kind === 'invalid_conflict_resolution')) {
    return fail(resultInvalid(
      'The final scenario Plan could not honour an explicit conflict resolution (invalid_conflict_resolution) and must not be saved.',
    ))
  }
  // The Domain returns one canonical expanded list for both (9.2.19.9); a
  // Worker artifact whose two lists differ in any field - a selection, a
  // participant, a kind - is malformed, not re-sorted or partially compared.
  if (!sameStructure(artifactPlan.conflicts, plannerResult.conflicts)) {
    return fail(resultInvalid('The repair artifact reports different Conflicts for its result and its Plan.'))
  }
  if (conflictRepairLineage === null || conflictRepairLineage === undefined) {
    return fail(resultInvalid('A Planner Alternative repair artifact must carry the repair lineage of the Draft it saves.'))
  }
  const lineageValidation = validatePlannerConflictRepairLineage(conflictRepairLineage)
  if (!lineageValidation.isValid) {
    return fail({ kind: 'entity_invalid', entityName: 'ProductionPlan', validation: lineageValidation })
  }
  const decision = conflictRepairLineage.decisions.at(-1)
  if (decision === undefined) {
    return fail(resultInvalid('The repair lineage must record this decision as its last decision.'))
  }
  const plan: ProductionPlan = { ...artifactPlan, conflictRepairLineage: structuredClone(conflictRepairLineage) }
  const shape = checkPersistablePlannerResultShape(plan, generatedEntries, plannerResult.termination, replacements)
  if (shape !== null) return fail(shape)
  const recorded = decision.invalidatedRoutes
    .filter(({ outcome }) => outcome === 'replaced')
    .map((record) => replacementIdentity(record.targetWeaponId, record.invalidatedBuildListEntryId, record.replacementBuildListEntryId))
    .sort()
  const replaced = replacements
    .map((replacement) => replacementIdentity(
      replacement.targetWeaponId,
      replacement.replacedBuildListEntryId,
      replacement.generatedBuildListEntryId,
    ))
    .sort()
  if (recorded.join('\n') !== replaced.join('\n')) {
    return fail(resultInvalid(
      'The last repair decision of the lineage does not record exactly the replacements this repair saves.',
    ))
  }
  return { issue: null, repair: { plan, generatedEntries, replacements } }
}
