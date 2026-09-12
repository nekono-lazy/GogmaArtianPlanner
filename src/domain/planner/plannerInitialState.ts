import type { DomainValidationIssue } from '../models/publicTypes'
import type {
  PlannerInput,
  PlannerSearchState,
  PlannerWarning,
  ValidatedBuildListEntry,
} from './plannerTypes'
import { derivePlannerCheckpointRequirements } from './plannerCheckpoints'
import { createSimulatedInventory } from './simulatedInventory'
import {
  areAllEnabledTargetsAlreadySatisfied,
  deriveTargetSatisfaction,
} from './targetSatisfaction'

export interface InitialPlannerSearchStateResult {
  isValid: boolean
  state: PlannerSearchState | null
  issues: DomainValidationIssue[]
  warnings: PlannerWarning[]
}

/** Creates a Beam Search start state without applying any route or RNG operation. */
export function createInitialPlannerSearchState(input: PlannerInput, validEntries: readonly ValidatedBuildListEntry[]): InitialPlannerSearchStateResult {
  const inventory = createSimulatedInventory(input.ownedWeapons)
  if (!inventory.isValid || inventory.inventory === null) {
    return { isValid: false, state: null, issues: inventory.issues, warnings: [] }
  }
  const routeProgressByEntryId: Record<string, number> = {}
  const routeRuntimeByEntryId: PlannerSearchState['routeRuntimeByEntryId'] = {}
  const routeSourceVersionByEntryId: PlannerSearchState['routeSourceVersionByEntryId'] = {}
  validEntries.forEach(({ entry }) => {
    routeProgressByEntryId[entry.id] = 0
    routeRuntimeByEntryId[entry.id] = { hasUnregisteredGogmaOutput: false, transientRestorationBonusScope: null }
    if (
      entry.candidateSnapshot.route.kind.startsWith('existing_gogma') &&
      entry.candidateSnapshot.route.sourceOwnedWeaponId !== null
    ) {
      routeSourceVersionByEntryId[entry.id] = 0
    }
  })
  const targetSatisfaction = deriveTargetSatisfaction(
    input.targetWeapons,
    input.ownedWeapons,
    input.master,
  )
  const targetSatisfactionById = Object.fromEntries(
    targetSatisfaction.map(({ targetWeaponId, hasPractical, hasIdeal }) => [
      targetWeaponId,
      { hasPractical, hasIdeal },
    ]),
  ) as PlannerSearchState['targetSatisfaction']
  // A selected checkpoint is a hard constraint even when the Target already
  // holds an Ideal weapon. The Planner would otherwise finish that Target
  // without ever running its required Entry, silently discarding the
  // selection, so the input fails closed instead (`docs/PLANNER_SPEC.md` 7.5.8).
  const alreadyIdealIssues: DomainValidationIssue[] = []
  const alreadyIdealWarnings: PlannerWarning[] = []
  derivePlannerCheckpointRequirements(validEntries.map(({ entry }) => entry))
    .requirements.requiredEntryIdByTargetId.forEach((entryId, targetId) => {
      if (targetSatisfactionById[targetId]?.hasIdeal !== true) return
      const message =
        `TargetWeapon '${targetId}' already holds an Ideal weapon, but BuildListEntry '${entryId}' carries a selected compromise checkpoint. Clear that checkpoint selection in the Build List before planning.`
      alreadyIdealIssues.push({ path: 'buildListEntries', code: 'invalid_state', message })
      alreadyIdealWarnings.push({ kind: 'selected_checkpoint_target_already_ideal', message })
    })
  if (alreadyIdealIssues.length > 0) {
    return { isValid: false, state: null, issues: alreadyIdealIssues, warnings: alreadyIdealWarnings }
  }
  const warnings: PlannerWarning[] = areAllEnabledTargetsAlreadySatisfied(targetSatisfaction)
    ? [{
        kind: 'all_targets_already_satisfied',
        message: 'Every enabled TargetWeapon already has an Ideal Gogma weapon.',
      }]
    : []
  return { isValid: true, issues: [], warnings, state: {
    currentRngState: structuredClone(input.rngState),
    currentNormalCounters: structuredClone(input.normalCounters),
    simulatedInventory: inventory.inventory,
    targetSatisfaction: targetSatisfactionById,
    selectedBuildListEntryIds: [],
    routeProgressByEntryId,
    routeRuntimeByEntryId,
    sourceMutationVersionByOwnedWeaponId: {},
    candidateReadySourceVersionByEntryId: {},
    routeSourceVersionByEntryId,
    inFlightExistingSourceByOwnedWeaponId: {},
    securedOwnedWeaponIdByEntryId: {},
    reachedCheckpointOpportunityIdsByEntryId: {},
    trace: [],
    weaponSwitchCount: 0,
    preferredSourceProgressCount: 0,
    lastWeaponOperationSubjectKey: null,
    totalCost: 0,
    evaluationScore: 0,
  } }
}
