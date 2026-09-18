import {
  inspectPlanGuardedMutation,
  preparePlanGuardedMutation,
  type PlanGuardPersistedState,
} from '../../domain/execution'
import type { PlanGuardedPersistence } from '../../services/execution/planBreakingChangeGuard'
import { domainFixtureContext } from './domainData'

/**
 * An in-memory `PlanGuardedPersistence` for service unit tests: the same pure
 * Domain decision the Dexie guard makes, applied to a plain state object. Only
 * a successful save is counted as a commit.
 */
export function inMemoryPlanGuardedPersistence(
  initial: Partial<PlanGuardPersistedState> = {},
  options: { writeFailure?: Error; now?: string } = {},
) {
  let state: PlanGuardPersistedState = {
    rngState: null,
    normalCounters: [],
    ownedWeapons: [],
    targetWeapons: [],
    buildListEntries: [],
    buildCandidates: [],
    productionPlans: [],
    executionHistory: [],
    executionSavePoints: [],
    ...structuredClone(initial),
  }
  let commits = 0
  const persistence: PlanGuardedPersistence = {
    inspect: async (mutation) => inspectPlanGuardedMutation(state, mutation),
    apply: async (mutation, approval = null) => {
      const write = preparePlanGuardedMutation({
        state,
        mutation,
        approval,
        currentCalculationContext: domainFixtureContext,
        now: options.now ?? '2026-09-18T00:00:00.000Z',
      })
      if (options.writeFailure) throw options.writeFailure
      state = { ...state, ...structuredClone(write.state) }
      commits += 1
      return { result: write.result, planTermination: write.planTermination }
    },
  }
  return {
    persistence,
    state: () => state,
    commits: () => commits,
    /** Replaces part of the stored state, as another writer would. */
    seed: (next: Partial<PlanGuardPersistedState>) => {
      state = { ...state, ...structuredClone(next) }
    },
  }
}
