import type {
  BuildListEntry,
  BuildListEntryId,
  PlannerConflictRepairDecision,
  PlannerConflictRepairInvalidatedRoute,
  PlannerConflictRepairLineage,
  PlannerConflictRepairOutcomeStatus,
  TargetWeaponId,
} from '../../models/publicTypes'
import type {
  PlannerAlternativeKernelOutcome,
  PlannerAlternativeRouteExclusion,
} from './plannerAlternativeKernel'

/**
 * The repair lineage's pure Domain calculation (`docs/PLANNER_SPEC.md`
 * 9.2.19.10 / 9.2.19.11, `docs/DATA_MODEL.md` 11.1.1). It reads a lineage and
 * the fresh current Build List and never touches persistence; the what-if and
 * the actual repair derive their prior fixed Entries and prior Route
 * exclusions from the same function.
 */

/** What a still valid lineage contributes to one Planner Alternative request. */
export interface PlannerConflictRepairLineageContext {
  /**
   * The lineage's decisions with every expired record dropped, in their
   * original order: exactly what the next repair save carries forward. A
   * decision is dropped whole when no Target record of it is still valid and
   * its fixed Entry is no longer valid either.
   */
  activeDecisions: PlannerConflictRepairDecision[]
  /**
   * Fixed Entries of earlier decisions that are still in the current Build
   * List and no later decision invalidated, in stable ID order. The kernel
   * additionally leaves out an Entry the current decision invalidates.
   */
  priorFixedBuildListEntryIds: BuildListEntryId[]
  /** The invalidated Route keys of still valid Target records, per Target, in stable order. */
  priorExcludedRoutes: PlannerAlternativeRouteExclusion[]
}

function compareStableStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/** The Entry a record leaves its Target on: the replacement, or the invalidated Entry itself. */
function lastRecordedEntryOf(record: PlannerConflictRepairInvalidatedRoute): BuildListEntryId {
  return record.replacementBuildListEntryId ?? record.invalidatedBuildListEntryId
}

/**
 * Derives the still valid part of a lineage against the current Build List
 * (9.2.19.11).
 *
 * - A Target's records are valid only while the Target's one current Build
 *   List Entry is the Entry the lineage last recorded for it (the latest
 *   record's replacement, or its invalidated Entry when it has none). A
 *   Target with no or several current Entries has no such Entry.
 * - A decision's fixed Entry is valid only while an Entry with that ID is in
 *   the current Build List and no later decision of the lineage invalidated it.
 *
 * `null` means no repair chain: nothing is fixed or excluded.
 */
export function derivePlannerConflictRepairLineageContext(
  lineage: PlannerConflictRepairLineage | null,
  currentBuildListEntries: readonly Pick<BuildListEntry, 'id' | 'targetWeaponId'>[],
): PlannerConflictRepairLineageContext {
  if (lineage === null) return { activeDecisions: [], priorFixedBuildListEntryIds: [], priorExcludedRoutes: [] }
  const currentIds = new Set(currentBuildListEntries.map(({ id }) => id))
  const currentEntriesByTarget = new Map<TargetWeaponId, BuildListEntryId[]>()
  for (const entry of currentBuildListEntries) {
    currentEntriesByTarget.set(entry.targetWeaponId, [...(currentEntriesByTarget.get(entry.targetWeaponId) ?? []), entry.id])
  }

  const lastRecorded = new Map<TargetWeaponId, BuildListEntryId>()
  for (const decision of lineage.decisions) {
    for (const record of decision.invalidatedRoutes) lastRecorded.set(record.targetWeaponId, lastRecordedEntryOf(record))
  }
  const isTargetValid = (targetWeaponId: TargetWeaponId): boolean => {
    const current = currentEntriesByTarget.get(targetWeaponId) ?? []
    return current.length === 1 && current[0] === lastRecorded.get(targetWeaponId)
  }
  const isFixedValid = (index: number): boolean => {
    const fixed = lineage.decisions[index].fixedBuildListEntryId
    return currentIds.has(fixed) && !lineage.decisions.slice(index + 1).some((later) =>
      later.invalidatedRoutes.some(({ invalidatedBuildListEntryId }) => invalidatedBuildListEntryId === fixed))
  }

  const activeDecisions: PlannerConflictRepairDecision[] = []
  const priorFixed = new Set<BuildListEntryId>()
  const excludedByTarget = new Map<TargetWeaponId, string[]>()
  lineage.decisions.forEach((decision, index) => {
    const records = decision.invalidatedRoutes.filter(({ targetWeaponId }) => isTargetValid(targetWeaponId))
    const fixedValid = isFixedValid(index)
    if (fixedValid) priorFixed.add(decision.fixedBuildListEntryId)
    for (const record of records) {
      excludedByTarget.set(record.targetWeaponId, [...(excludedByTarget.get(record.targetWeaponId) ?? []), record.invalidatedRouteKey])
    }
    if (records.length > 0 || fixedValid) {
      activeDecisions.push({ ...structuredClone(decision), invalidatedRoutes: structuredClone(records) })
    }
  })
  return {
    activeDecisions,
    priorFixedBuildListEntryIds: [...priorFixed].sort(compareStableStrings),
    priorExcludedRoutes: [...excludedByTarget]
      .sort(([left], [right]) => compareStableStrings(left, right))
      .map(([targetWeaponId, routeKeys]) => ({
        targetWeaponId,
        routeKeys: [...new Set(routeKeys)].sort(compareStableStrings),
      })),
  }
}

/**
 * The lineage outcome of one direct participant Target (`docs/DATA_MODEL.md`
 * 11.1.1): its individual trial outcome and, for a found replacement, its
 * scenario composition verdict. An unevaluated (`null`) verdict is no lineage
 * outcome: the scenario has no final result then, and nothing is saved.
 */
export function plannerConflictRepairOutcomeOf(
  outcome: PlannerAlternativeKernelOutcome['status'],
  adoptedInScenario: boolean | null | undefined,
): PlannerConflictRepairOutcomeStatus {
  if (outcome !== 'found') return outcome
  if (adoptedInScenario === true) return 'replaced'
  if (adoptedInScenario === false) return 'rejected_by_scenario_composition'
  throw new Error(
    'Planner Alternative invariant violated: a found replacement without a scenario verdict has no lineage outcome.',
  )
}

/** Appends this decision to the still valid lineage: the lineage the repaired Draft carries. */
export function appendPlannerConflictRepairDecision(
  context: Pick<PlannerConflictRepairLineageContext, 'activeDecisions'>,
  decision: PlannerConflictRepairDecision,
): PlannerConflictRepairLineage {
  for (const record of decision.invalidatedRoutes) {
    if ((record.outcome === 'replaced') !== (record.replacementBuildListEntryId !== null)) {
      throw new Error(
        `Planner Alternative invariant violated: the lineage record of TargetWeapon '${record.targetWeaponId}' has outcome '${record.outcome}' with replacement ${JSON.stringify(record.replacementBuildListEntryId)}.`,
      )
    }
  }
  return { decisions: [...structuredClone(context.activeDecisions), structuredClone(decision)] }
}
