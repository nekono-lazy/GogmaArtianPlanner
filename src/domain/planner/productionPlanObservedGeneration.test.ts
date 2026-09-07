import { describe, expect, it } from 'vitest'
import { createTargetDefinitionHash } from '../buildList'
import {
  createReferencedOwnedWeaponsHash,
  createSearchStateHash,
} from '../models/hashing'
import {
  createCandidateSearchEngine,
  createCandidateSearchInput,
} from '../../test/fixtures/candidateSearch'
import { createValidBuildListEntry } from '../../test/fixtures/domainData'
import { runtimeUnsupportedFixture } from '../../test/fixtures/plannerRuntimeUnsupported'
import {
  createPlannerFullBeamBudget,
  PlannerOrchestrationLimitError,
} from './constrained/plannerRerunBudget'
import type { PlannerOrchestrationBounds } from './constrained/plannerOrchestrationBounds'
import {
  createProductionPlan,
  createProductionPlanWithObserver,
} from './productionPlanGeneration'
import {
  defaultPlannerOptions,
  type PlannerDependencies,
  type PlannerInput,
} from './plannerTypes'

/** The ordinary single-Beam fixture: one Entry, one full Beam Search. */
function singleBeamFixture(): {
  input: PlannerInput
  dependencies: PlannerDependencies
} {
  const searchInput = createCandidateSearchInput()
  const entry = createValidBuildListEntry()
  entry.calculationContext = structuredClone(searchInput.calculationContext)
  entry.candidateSnapshot.calculationContext =
    structuredClone(searchInput.calculationContext)
  entry.targetDefinitionHash =
    createTargetDefinitionHash(searchInput.targetWeapons[0])
  entry.searchStateHash = createSearchStateHash(
    entry.candidateSnapshot.route,
    searchInput.rngState,
    searchInput.normalCounters,
  )
  entry.candidateSnapshot.searchStateHash = entry.searchStateHash
  entry.referencedOwnedWeaponsHash = createReferencedOwnedWeaponsHash(
    entry.candidateSnapshot.route,
    [],
  )
  entry.candidateSnapshot.referencedOwnedWeaponsHash =
    entry.referencedOwnedWeaponsHash
  let planCount = 0
  let stepCount = 0
  let ownedCount = 0
  return {
    input: {
      rngState: structuredClone(searchInput.rngState),
      normalCounters: structuredClone(searchInput.normalCounters),
      ownedWeapons: [],
      targetWeapons: structuredClone(searchInput.targetWeapons),
      buildListEntries: [entry],
      calculationContext: structuredClone(searchInput.calculationContext),
      options: { ...defaultPlannerOptions },
      master: structuredClone(searchInput.master),
      conflictResolutions: [],
    },
    dependencies: {
      rngEngine: createCandidateSearchEngine(searchInput),
      idFactory: {
        productionPlanId: () => `plan.observed.${++planCount}` as never,
        planStepId: () => `step.observed.${++stepCount}` as never,
        ownedWeaponId: () => `owned.observed.${++ownedCount}` as never,
      },
      clock: { now: () => '2026-09-01T00:00:00.000Z' },
    },
  }
}

function countingObserver() {
  const state = { calls: 0 }
  return {
    state,
    observer: {
      beforeBeamSearch() {
        state.calls += 1
      },
    },
  }
}

function bounds(maxPlannerReruns: number): PlannerOrchestrationBounds {
  return {
    maxCandidateTrialsPerConflict: 4,
    maxGeneratedBuildListEntries: 3,
    maxPlannerReruns,
  }
}

describe('Observed Production plan generation boundary', () => {
  it('observes exactly one full Beam Search for an ordinary single-run Plan', async () => {
    const { input, dependencies } = singleBeamFixture()
    const { state, observer } = countingObserver()

    const result = await createProductionPlanWithObserver(
      input,
      dependencies,
      undefined,
      observer,
    )

    expect(state.calls).toBe(1)
    expect(result.plan).not.toBeNull()
  })

  it('observes every runtime-unsupported retry Beam Search', async () => {
    const { input, dependencies } = runtimeUnsupportedFixture()
    const { state, observer } = countingObserver()

    const result = await createProductionPlanWithObserver(
      input,
      dependencies,
      undefined,
      observer,
    )

    expect(state.calls).toBe(2)
    expect(result.plan).not.toBeNull()
  })

  it('keeps ordinary createProductionPlan semantics identical to the observed run', async () => {
    const observed = singleBeamFixture()
    const ordinary = singleBeamFixture()
    const { state, observer } = countingObserver()

    const observedResult = await createProductionPlanWithObserver(
      observed.input,
      observed.dependencies,
      undefined,
      observer,
    )
    const ordinaryResult = await createProductionPlan(
      ordinary.input,
      ordinary.dependencies,
    )

    expect(state.calls).toBe(1)
    expect(observedResult).toEqual(ordinaryResult)
  })

  it('leaves the Planner input unchanged while observing', async () => {
    const { input, dependencies } = singleBeamFixture()
    const before = structuredClone(input)
    const { observer } = countingObserver()

    await createProductionPlanWithObserver(input, dependencies, undefined, observer)

    expect(input).toEqual(before)
  })

  it('propagates a throw from the first observation without returning a PlannerResult', async () => {
    const { input, dependencies } = singleBeamFixture()
    const failure = new Error('observer refused the first Beam Search')

    await expect(
      createProductionPlanWithObserver(input, dependencies, undefined, {
        beforeBeamSearch() {
          throw failure
        },
      }),
    ).rejects.toBe(failure)
  })

  it('propagates a throw from the retry observation without returning a partial PlannerResult', async () => {
    const { input, dependencies } = runtimeUnsupportedFixture()
    const failure = new Error('observer refused the retry Beam Search')
    let calls = 0

    await expect(
      createProductionPlanWithObserver(input, dependencies, undefined, {
        beforeBeamSearch() {
          calls += 1
          if (calls > 1) throw failure
        },
      }),
    ).rejects.toBe(failure)
    expect(calls).toBe(2)
  })
})

describe('maxPlannerReruns full Beam budget', () => {
  it('allows the initial ordinary Beam Search under a limit of 1', async () => {
    const { input, dependencies } = singleBeamFixture()
    const budget = createPlannerFullBeamBudget(bounds(1))

    const result = await createProductionPlanWithObserver(
      input,
      dependencies,
      undefined,
      budget,
    )

    expect(result.plan).not.toBeNull()
    expect(budget.used).toBe(1)
    expect(budget.limit).toBe(1)
  })

  it('rejects the retry Beam Search with a typed signal when the limit is 1', async () => {
    const { input, dependencies } = runtimeUnsupportedFixture()
    const budget = createPlannerFullBeamBudget(bounds(1))

    const rejection = await createProductionPlanWithObserver(
      input,
      dependencies,
      undefined,
      budget,
    ).then(
      () => null,
      (error: unknown) => error,
    )

    expect(rejection).toBeInstanceOf(PlannerOrchestrationLimitError)
    expect((rejection as PlannerOrchestrationLimitError).code).toBe(
      'max_planner_reruns',
    )
    expect((rejection as PlannerOrchestrationLimitError).limit).toBe(1)
    // The rejected execution never started, so it consumed no budget.
    expect((rejection as PlannerOrchestrationLimitError).used).toBe(1)
    expect(budget.used).toBe(1)
  })

  it('allows the same two-run fixture when the limit is 2', async () => {
    const { input, dependencies } = runtimeUnsupportedFixture()
    const budget = createPlannerFullBeamBudget(bounds(2))

    const result = await createProductionPlanWithObserver(
      input,
      dependencies,
      undefined,
      budget,
    )

    expect(result.plan).not.toBeNull()
    expect(budget.used).toBe(2)
  })

  it('counts the initial ordinary Beam Search, so a later run is rejected in isolation', () => {
    const budget = createPlannerFullBeamBudget(bounds(2))

    expect(budget.used).toBe(0)
    budget.beforeBeamSearch()
    expect(budget.used).toBe(1)
    budget.beforeBeamSearch()
    expect(budget.used).toBe(2)
    expect(() => budget.beforeBeamSearch()).toThrow(PlannerOrchestrationLimitError)
    expect(budget.used).toBe(2)
  })

  it('fails closed on invalid bounds instead of assuming a Production default', () => {
    expect(() => createPlannerFullBeamBudget(bounds(0))).toThrow()
    expect(() => createPlannerFullBeamBudget(bounds(1.5))).toThrow()
    expect(() => createPlannerFullBeamBudget(bounds(Number.NaN))).toThrow()
  })
})
