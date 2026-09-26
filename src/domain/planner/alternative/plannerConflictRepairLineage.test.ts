import { describe, expect, it } from 'vitest'
import type {
  BuildListEntryId,
  PlannerConflictRepairDecision,
  PlannerConflictRepairInvalidatedRoute,
  PlannerConflictRepairLineage,
  TargetWeaponId,
} from '../../models/publicTypes'
import {
  appendPlannerConflictRepairDecision,
  derivePlannerConflictRepairLineageContext,
  plannerConflictRepairOutcomeOf,
} from './plannerConflictRepairLineage'

/*
 * The repair lineage's pure calculation (`docs/PLANNER_SPEC.md` 9.2.19.10 /
 * 9.2.19.11, `docs/DATA_MODEL.md` 11.1.1): Target-level expiry, fixed Entry
 * expiry, the prior exclusions it yields, and the outcome mapping.
 */

const id = (value: string) => value as BuildListEntryId
const target = (value: string) => `target.${value}` as TargetWeaponId

function entry(entryId: string, targetName: string) {
  return { id: id(entryId), targetWeaponId: target(targetName) }
}

function record(
  targetName: string,
  invalidated: string,
  key: string,
  replacement: string | null,
): PlannerConflictRepairInvalidatedRoute {
  return {
    targetWeaponId: target(targetName),
    invalidatedBuildListEntryId: id(invalidated),
    invalidatedRouteKey: key,
    replacementBuildListEntryId: replacement === null ? null : id(replacement),
    outcome: replacement === null ? 'not_found_within_search_extent' : 'replaced',
  }
}

function decision(
  fixed: string,
  fixedTarget: string,
  invalidatedRoutes: PlannerConflictRepairInvalidatedRoute[],
): PlannerConflictRepairDecision {
  return {
    conflictKind: 'same_gogma_counter',
    fixedBuildListEntryId: id(fixed),
    fixedTargetWeaponId: target(fixedTarget),
    invalidatedRoutes,
  }
}

describe('Repair lineage context (PLANNER_SPEC 9.2.19.11)', () => {
  it('starts a chain from no lineage with nothing fixed, excluded or carried', () => {
    expect(derivePlannerConflictRepairLineageContext(null, [entry('a', 'a'), entry('b', 'b')])).toEqual({
      activeDecisions: [],
      priorFixedBuildListEntryIds: [],
      priorExcludedRoutes: [],
    })
  })

  it('keeps a still valid Target record: its fixed Entry is fixed and its invalidated Route excluded', () => {
    const lineage: PlannerConflictRepairLineage = {
      decisions: [decision('a', 'a', [record('b', 'b', 'route.b', 'b2')])],
    }
    const context = derivePlannerConflictRepairLineageContext(lineage, [entry('a', 'a'), entry('b2', 'b')])
    expect(context.activeDecisions).toEqual(lineage.decisions)
    expect(context.priorFixedBuildListEntryIds).toEqual(['a'])
    expect(context.priorExcludedRoutes).toEqual([{ targetWeaponId: target('b'), routeKeys: ['route.b'] }])
  })

  it('keeps a record without replacement while the invalidated Entry is still the Target current Entry', () => {
    const lineage = { decisions: [decision('a', 'a', [record('b', 'b', 'route.b', null)])] }
    const context = derivePlannerConflictRepairLineageContext(lineage, [entry('a', 'a'), entry('b', 'b')])
    expect(context.priorExcludedRoutes).toEqual([{ targetWeaponId: target('b'), routeKeys: ['route.b'] }])
  })

  it('expires a Target whose current Entry changed: no exclusion, and its record is dropped from the next lineage', () => {
    const lineage = {
      decisions: [decision('a', 'a', [record('b', 'b', 'route.b', 'b2'), record('c', 'c', 'route.c', null)])],
    }
    // The user replaced B2 by hand with B3.
    const context = derivePlannerConflictRepairLineageContext(lineage, [entry('a', 'a'), entry('b3', 'b'), entry('c', 'c')])
    expect(context.priorExcludedRoutes).toEqual([{ targetWeaponId: target('c'), routeKeys: ['route.c'] }])
    expect(context.activeDecisions).toEqual([decision('a', 'a', [record('c', 'c', 'route.c', null)])])
    expect(context.priorFixedBuildListEntryIds).toEqual(['a'])
  })

  it('expires a Target with no or several current Entries', () => {
    const lineage = { decisions: [decision('a', 'a', [record('b', 'b', 'route.b', null)])] }
    expect(derivePlannerConflictRepairLineageContext(lineage, [entry('a', 'a')]).priorExcludedRoutes).toEqual([])
    expect(derivePlannerConflictRepairLineageContext(lineage, [entry('a', 'a'), entry('b', 'b'), entry('bx', 'b')])
      .priorExcludedRoutes).toEqual([])
  })

  it('leaves a prior fixed Entry the current Build List no longer holds out of the fixed Entries', () => {
    const lineage = { decisions: [decision('a', 'a', [record('b', 'b', 'route.b', 'b2')])] }
    const context = derivePlannerConflictRepairLineageContext(lineage, [entry('a2', 'a'), entry('b2', 'b')])
    expect(context.priorFixedBuildListEntryIds).toEqual([])
    // B's record is still valid, so the decision stays with it.
    expect(context.activeDecisions).toHaveLength(1)
    expect(context.priorExcludedRoutes).toEqual([{ targetWeaponId: target('b'), routeKeys: ['route.b'] }])
  })

  it('lets a later decision that invalidated an earlier fixed Entry win, and records its Route as the one excluded', () => {
    const lineage = {
      decisions: [
        decision('a', 'a', [record('b', 'b', 'route.b', 'b2')]),
        // Later B2 was preferred over A: A lost and was replaced by A2.
        decision('b2', 'b', [record('a', 'a', 'route.a', 'a2')]),
      ],
    }
    const context = derivePlannerConflictRepairLineageContext(lineage, [entry('a2', 'a'), entry('b2', 'b')])
    expect(context.priorFixedBuildListEntryIds).toEqual(['b2'])
    expect(context.priorExcludedRoutes).toEqual([
      { targetWeaponId: target('a'), routeKeys: ['route.a'] },
      { targetWeaponId: target('b'), routeKeys: ['route.b'] },
    ])
    expect(context.activeDecisions).toEqual(lineage.decisions)
  })

  it('excludes only invalidated Route keys, every one of a Target chain, and nothing else', () => {
    const lineage = {
      decisions: [
        decision('a', 'a', [record('b', 'b', 'route.b', 'b2')]),
        decision('c', 'c', [record('b', 'b2', 'route.b2', 'b3')]),
      ],
    }
    const context = derivePlannerConflictRepairLineageContext(lineage, [entry('a', 'a'), entry('b3', 'b'), entry('c', 'c')])
    // B original -> B2 -> B3: neither earlier Route comes back.
    expect(context.priorExcludedRoutes).toEqual([{ targetWeaponId: target('b'), routeKeys: ['route.b', 'route.b2'] }])
    expect(context.priorFixedBuildListEntryIds).toEqual(['a', 'c'])
  })

  it('drops a decision with no valid record and no valid fixed Entry, and keeps decision and record order', () => {
    const lineage = {
      decisions: [
        decision('x', 'x', [record('y', 'y', 'route.y', null)]),
        decision('a', 'a', [record('c', 'c', 'route.c', null), record('b', 'b', 'route.b', 'b2')]),
        decision('d', 'd', [record('e', 'e', 'route.e', null)]),
      ],
    }
    // X and Y are gone; A, B2, C, D and E are current.
    const context = derivePlannerConflictRepairLineageContext(lineage, [
      entry('a', 'a'), entry('b2', 'b'), entry('c', 'c'), entry('d', 'd'), entry('e', 'e'),
    ])
    expect(context.activeDecisions).toEqual([lineage.decisions[1], lineage.decisions[2]])
    expect(context.activeDecisions[0].invalidatedRoutes.map(({ targetWeaponId }) => targetWeaponId))
      .toEqual([target('c'), target('b')])
  })

  it('keeps a decision whose fixed Entry is still valid even when none of its Target records is', () => {
    const lineage = { decisions: [decision('a', 'a', [record('b', 'b', 'route.b', 'b2')])] }
    const context = derivePlannerConflictRepairLineageContext(lineage, [entry('a', 'a'), entry('b3', 'b')])
    expect(context.activeDecisions).toEqual([decision('a', 'a', [])])
    expect(context.priorFixedBuildListEntryIds).toEqual(['a'])
    expect(context.priorExcludedRoutes).toEqual([])
  })

  it('does not mutate the lineage', () => {
    const lineage = { decisions: [decision('a', 'a', [record('b', 'b', 'route.b', 'b2')])] }
    const before = structuredClone(lineage)
    const context = derivePlannerConflictRepairLineageContext(lineage, [entry('a', 'a'), entry('b3', 'b')])
    context.activeDecisions[0].invalidatedRoutes.push(record('z', 'z', 'route.z', null))
    expect(lineage).toEqual(before)
  })
})

describe('Repair lineage outcome and append (DATA_MODEL 11.1.1)', () => {
  it('maps each individual outcome and scenario verdict', () => {
    expect(plannerConflictRepairOutcomeOf('found', true)).toBe('replaced')
    expect(plannerConflictRepairOutcomeOf('found', false)).toBe('rejected_by_scenario_composition')
    for (const status of [
      'not_found_within_search_extent',
      'stopped_by_search_extent_bound',
      'stopped_by_candidate_trial_bound',
      'stopped_by_planner_rerun_bound',
      'blocked_by_selected_checkpoint',
    ] as const) {
      expect(plannerConflictRepairOutcomeOf(status, undefined)).toBe(status)
    }
  })

  it('refuses an unevaluated found replacement instead of guessing its outcome', () => {
    expect(() => plannerConflictRepairOutcomeOf('found', null)).toThrow(/invariant/)
    expect(() => plannerConflictRepairOutcomeOf('found', undefined)).toThrow(/invariant/)
  })

  it('appends the decision after the still valid decisions', () => {
    const prior = decision('a', 'a', [record('b', 'b', 'route.b', 'b2')])
    const next = decision('c', 'c', [record('b', 'b2', 'route.b2', null)])
    expect(appendPlannerConflictRepairDecision({ activeDecisions: [prior] }, next)).toEqual({ decisions: [prior, next] })
    expect(appendPlannerConflictRepairDecision({ activeDecisions: [] }, next)).toEqual({ decisions: [next] })
  })

  it('refuses a record whose replacement does not match its outcome', () => {
    const replacedWithoutEntry = { ...record('b', 'b', 'route.b', null), outcome: 'replaced' as const }
    const rejectedWithEntry = { ...record('b', 'b', 'route.b', 'b2'), outcome: 'rejected_by_scenario_composition' as const }
    expect(() => appendPlannerConflictRepairDecision({ activeDecisions: [] }, decision('a', 'a', [replacedWithoutEntry]))).toThrow(/invariant/)
    expect(() => appendPlannerConflictRepairDecision({ activeDecisions: [] }, decision('a', 'a', [rejectedWithEntry]))).toThrow(/invariant/)
  })
})
