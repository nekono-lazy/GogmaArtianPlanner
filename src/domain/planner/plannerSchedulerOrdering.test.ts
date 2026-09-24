import { describe, expect, it } from 'vitest'
import type { BuildListEntryId } from '../models/publicTypes'
import {
  comparePlannerScheduleActions,
  plannerScheduleStreamRank,
  type PlannerScheduleAction,
  type PlannerScheduleActionOrderKey,
} from './plannerSchedulerOrdering'

/**
 * The canonical action order (`docs/ISSUE_103_DETERMINISTIC_PLANNER_DESIGN.md`
 * 7.7): Target priority, improvement preference, weapon switch, executor
 * distance, remaining units, then the stable stream / position / Entry order.
 */

const baseKey: PlannerScheduleActionOrderKey = {
  maxTargetPriority: 3,
  addsImprovementPreferenceViolation: false,
  addsWeaponSwitch: false,
  executorHoldingDistance: 0,
  minRemainingPendingUnits: 5,
  streamRank: 2,
  streamKey: 'gogma',
  counterBefore: 10,
  primaryBuildListEntryId: 'entry.a' as BuildListEntryId,
  unitKey: 'entry.a\u00000\u00000',
}

function action(overrides: Partial<PlannerScheduleActionOrderKey>): PlannerScheduleAction {
  return {
    kind: 'executor',
    streamKey: 'gogma',
    primary: {} as PlannerScheduleAction['primary'],
    progressedUnits: [],
    orderKey: { ...baseKey, ...overrides },
  }
}

describe('Planner scheduler canonical order', () => {
  it('applies the keys lexicographically, each one only on a tie of the earlier ones', () => {
    const cases: Array<[Partial<PlannerScheduleActionOrderKey>, Partial<PlannerScheduleActionOrderKey>]> = [
      // Key 1 beats every later key.
      [{ maxTargetPriority: 5, addsImprovementPreferenceViolation: true, addsWeaponSwitch: true }, { maxTargetPriority: 4 }],
      // Key 2 beats key 3.
      [{ addsWeaponSwitch: true }, { addsImprovementPreferenceViolation: true }],
      // Key 3 beats key 4.
      [{ executorHoldingDistance: 50 }, { addsWeaponSwitch: true, executorHoldingDistance: 1 }],
      // Key 4 beats key 5.
      [{ executorHoldingDistance: 1, minRemainingPendingUnits: 50 }, { executorHoldingDistance: 2, minRemainingPendingUnits: 1 }],
      // Key 5 beats the stable order.
      [{ minRemainingPendingUnits: 1, streamRank: 2 }, { minRemainingPendingUnits: 2, streamRank: 0 }],
      // Stable: stream, position, Entry.
      [{ streamRank: 1, streamKey: 'skill' }, { streamRank: 2 }],
      [{ counterBefore: 9 }, { counterBefore: 10 }],
      [{ primaryBuildListEntryId: 'entry.a' as BuildListEntryId }, { primaryBuildListEntryId: 'entry.b' as BuildListEntryId }],
    ]
    cases.forEach(([first, second]) => {
      expect(comparePlannerScheduleActions(action(first), action(second))).toBeLessThan(0)
      expect(comparePlannerScheduleActions(action(second), action(first))).toBeGreaterThan(0)
    })
    expect(comparePlannerScheduleActions(action({}), action({}))).toBe(0)
  })

  it('orders Normal streams and blind forges before Skill before Gogma', () => {
    expect(plannerScheduleStreamRank(null)).toBe(0)
    expect(plannerScheduleStreamRank('normal:weapon.fixture.a:8')).toBe(0)
    expect(plannerScheduleStreamRank('skill')).toBe(1)
    expect(plannerScheduleStreamRank('gogma')).toBe(2)
  })

  it('treats an executor with no further holding unit as the farthest', () => {
    const near = action({ executorHoldingDistance: 3 })
    const none = action({ executorHoldingDistance: Number.POSITIVE_INFINITY })
    expect(comparePlannerScheduleActions(near, none)).toBeLessThan(0)
    expect(comparePlannerScheduleActions(none, action({ executorHoldingDistance: Number.POSITIVE_INFINITY })))
      .toBe(0)
  })
})
