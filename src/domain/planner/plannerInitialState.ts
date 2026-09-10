import type { DomainValidationIssue } from '../models/publicTypes'
import type {
  PlannerInput,
  PlannerSearchState,
  PlannerWarning,
  ValidatedBuildListEntry,
} from './plannerTypes'
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
    practicalFirstProgressTargetIds: [],
    trace: [],
    consumedMaterialWeaponCount: 0,
    weaponSwitchCount: 0,
    lastWeaponOperationSubjectKey: null,
    totalCost: 0,
    evaluationScore: 0,
  } }
}
