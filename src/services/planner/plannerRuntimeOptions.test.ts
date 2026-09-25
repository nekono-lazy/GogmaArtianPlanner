import { describe, expect, it } from 'vitest'
import { findBuildListTargetDuplicates } from '../../domain/buildList/buildListCardinality'
import type { BuildListEntry, ProductionPlan } from '../../domain/models/publicTypes'
import { defaultPlannerOptions } from '../../domain/planner'
import {
  buildListEntryId,
  createValidBuildListEntry,
  createValidProductionPlan,
} from '../../test/fixtures/domainData'
import {
  CANDIDATE_RESERVE_PLANNER_ACTION_COUNT,
  CONFLICT_RESOLUTION_MAX_PLAN_STEPS_MARGIN,
  PLANNER_MAX_PLAN_STEPS_INCREMENT,
  conflictResolutionMaxPlanSteps,
  conflictResolutionPlannerOptions,
  recommendedBuildListMaxPlanSteps,
  roundUpPlannerMaxPlanSteps,
} from './plannerRuntimeOptions'

function entryWithOperations(operationCount: number, suffix = String(operationCount)): BuildListEntry {
  const entry = createValidBuildListEntry()
  entry.id = buildListEntryId(`build-list.runtime-options.${suffix}`)
  entry.candidateSnapshot.estimatedOperationCount = operationCount
  return entry
}

function planWithSteps(stepCount: number): ProductionPlan {
  const plan = createValidProductionPlan()
  const [step] = plan.steps
  plan.steps = Array.from({ length: stepCount }, () => step)
  return plan
}

describe('roundUpPlannerMaxPlanSteps', () => {
  it('rounds up to the 500-step increment', () => {
    expect(PLANNER_MAX_PLAN_STEPS_INCREMENT).toBe(500)
    expect(roundUpPlannerMaxPlanSteps(0)).toBe(0)
    expect(roundUpPlannerMaxPlanSteps(1)).toBe(500)
    expect(roundUpPlannerMaxPlanSteps(500)).toBe(500)
    expect(roundUpPlannerMaxPlanSteps(501)).toBe(1000)
    expect(roundUpPlannerMaxPlanSteps(1470)).toBe(1500)
  })

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('refuses %s', (value) => {
    expect(() => roundUpPlannerMaxPlanSteps(value)).toThrow(RangeError)
  })
})

describe('recommendedBuildListMaxPlanSteps', () => {
  it('keeps defaultPlannerOptions (1000) as the floor and never changes it', () => {
    expect(defaultPlannerOptions.maxPlanSteps).toBe(1000)
    expect(recommendedBuildListMaxPlanSteps([])).toBe(1000)
  })

  it('adds the one reserve_candidate action estimatedOperationCount does not count', () => {
    expect(CANDIDATE_RESERVE_PLANNER_ACTION_COUNT).toBe(1)
  })

  it.each([
    [0, 1000],
    [500, 1000],
    [999, 1000],
    [1000, 1500],
    [1001, 1500],
    [1470, 1500],
    [1499, 1500],
    [1500, 2000],
    [1501, 2000],
    [1601, 2000],
    [1999, 2000],
    [2000, 2500],
    [2001, 2500],
  ])('max(1000, ceilTo500(%i + reserve_candidate 1)) = %i', (operationCount, expected) => {
    expect(recommendedBuildListMaxPlanSteps([entryWithOperations(operationCount)])).toBe(expected)
  })

  it('uses the largest estimatedOperationCount of several Entries', () => {
    expect(recommendedBuildListMaxPlanSteps([
      entryWithOperations(450),
      entryWithOperations(870),
    ])).toBe(1000)
    expect(recommendedBuildListMaxPlanSteps([
      entryWithOperations(450),
      entryWithOperations(1601),
      entryWithOperations(870),
    ])).toBe(2000)
  })

  it('counts a stale Entry, since every registered Candidate sizes the bound', () => {
    const stale = entryWithOperations(1470)
    stale.isStale = true
    stale.staleReasons = ['rng_state_changed']
    expect(recommendedBuildListMaxPlanSteps([entryWithOperations(300), stale])).toBe(1500)
  })

  it('reads a legacy duplicate as a plain maximum without touching cardinality', () => {
    const first = entryWithOperations(800, 'first')
    const second = entryWithOperations(1200, 'second')
    second.targetWeaponId = first.targetWeaponId
    const entries = [first, second]
    const before = structuredClone(entries)

    expect(findBuildListTargetDuplicates(entries)).toHaveLength(1)
    expect(recommendedBuildListMaxPlanSteps(entries)).toBe(1500)
    expect(entries).toEqual(before)
  })
})

describe('conflictResolutionMaxPlanSteps', () => {
  it.each([
    [0, 1000],
    [800, 1500],
    [1000, 1500],
    [1470, 2000],
    [1500, 2000],
    [1600, 2500],
  ])('max(1000, ceilTo500(%i Steps) + 500) = %i', (stepCount, expected) => {
    expect(CONFLICT_RESOLUTION_MAX_PLAN_STEPS_MARGIN).toBe(500)
    const plan = planWithSteps(stepCount)
    expect(conflictResolutionMaxPlanSteps(plan)).toBe(expected)
    expect(conflictResolutionPlannerOptions(plan)).toEqual({ maxPlanSteps: expected })
  })
})
