import { describe, expect, it } from 'vitest'
import { routeEntry, resetRoute, target } from '../../test/fixtures/plannerBeam'
import {
  comparePlannerEntryPriority,
  nextPlannerCandidateDistance,
  recommendPlannerEntry,
} from './plannerEntryPriority'

/**
 * The shared ranking `R` (`docs/ISSUE_103_DETERMINISTIC_PLANNER_DESIGN.md`
 * 6.5): `PlanConflict.recommendedBuildListEntryId` and the deterministic
 * scheduler's provisional outcome read this one comparator.
 */
describe('Planner Entry priority', () => {
  const high = target('target.high', 5)
  const low = target('target.low', 1)
  const targetsById = new Map([high, low].map((value) => [value.id, value]))

  it('ranks Target priority first, then the next Candidate distance, the Route length and the ID', () => {
    const lowShort = routeEntry('entry.a-low', low, resetRoute('owned.a'))
    const highLong = routeEntry('entry.z-high', high, {
      ...resetRoute('owned.b'),
      operations: [...resetRoute('owned.b', 10).operations, ...resetRoute('owned.b', 11).operations],
    })
    expect(comparePlannerEntryPriority(highLong, lowShort, targetsById, [])).toBeLessThan(0)

    const shortSame = routeEntry('entry.b', high, resetRoute('owned.c'))
    const longSame = routeEntry('entry.a', high, highLong.candidateSnapshot.route)
    // Equal priority, no later Candidate: the cheaper Route, then the ID.
    expect(comparePlannerEntryPriority(shortSame, longSame, targetsById, [])).toBeLessThan(0)
    const twin = routeEntry('entry.c', high, resetRoute('owned.d'))
    expect(comparePlannerEntryPriority(shortSame, twin, targetsById, [])).toBeLessThan(0)

    // A Target whose next Candidate is further away ranks first.
    expect(nextPlannerCandidateDistance(shortSame, [shortSame, longSame])).toBe(1)
    expect(comparePlannerEntryPriority(shortSame, twin, targetsById, [shortSame, longSame]))
      .toBeLessThan(0)
  })

  it('recommends the best-ranked known participant', () => {
    const a = routeEntry('entry.a', low, resetRoute('owned.a'))
    const b = routeEntry('entry.b', high, resetRoute('owned.b'))
    const entriesById = new Map([a, b].map((entry) => [entry.id, entry]))
    expect(recommendPlannerEntry([a.id, b.id], entriesById, targetsById, [a, b])).toBe(b.id)
    expect(recommendPlannerEntry([], entriesById, targetsById, [a, b])).toBeNull()
  })
})
