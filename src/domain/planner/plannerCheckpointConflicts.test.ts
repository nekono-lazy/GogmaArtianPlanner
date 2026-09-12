import { describe, expect, it } from 'vitest'
import {
  checkpointCandidate,
  checkpointIdealBonuses,
  checkpointPracticalBonuses,
  checkpointPracticalBonusesReordered,
  checkpointSource,
  checkpointTarget,
} from '../../test/fixtures/checkpointRoute'
import { fixture as plannerFixture } from '../../test/fixtures/plannerBeam'
import { ownedWeaponId } from '../../test/fixtures/domainData'
import { createBuildListEntry } from '../buildList'
import type {
  BuildListEntry,
  CompromiseCheckpointOpportunityId,
  OwnedWeapon,
  PlanConflict,
  TargetWeapon,
} from '../models/publicTypes'
import { preparePlannerInitialContext } from './plannerInitialContext'
import { arePlannerRouteUnitsShareable, createPlannerRouteUnitPlans } from './plannerRouteProgress'
import { plannerEngine } from '../../test/fixtures/plannerBeam'

const SOURCE_A = ownedWeaponId('owned.checkpoint.conflict.a')
const SOURCE_B = ownedWeaponId('owned.checkpoint.conflict.b')

/**
 * Two Targets whose Routes Reset overlapping Gogma Counter positions from
 * their own sources.
 *
 * Their Routes have different lengths, so their Ideal-completing operations
 * land on different positions and never collide on their own. Every shared
 * position is an unobserved prefix unit for at least one of them - until a
 * checkpoint selection makes that exact intermediate state observed.
 */
function twoEntryScenario(
  selectedA: readonly CompromiseCheckpointOpportunityId[],
  selectedB: readonly CompromiseCheckpointOpportunityId[],
) {
  const parts = [
    { source: SOURCE_A, suffix: 'a', selected: selectedA, length: 4 },
    { source: SOURCE_B, suffix: 'b', selected: selectedB, length: 3 },
  ].map(({ source, suffix, selected, length }) => {
    const results = [
      checkpointPracticalBonuses(),
      checkpointPracticalBonusesReordered(),
      checkpointPracticalBonuses(),
      checkpointIdealBonuses(),
    ].slice(4 - length)
    const candidate = checkpointCandidate(
      results,
      {
        sourceOwnedWeaponId: source,
        candidateId: `candidate.checkpoint.conflict.${suffix}`,
        targetWeaponId: `target.checkpoint.conflict.${suffix}`,
      },
    )
    const target: TargetWeapon = {
      ...checkpointTarget(),
      id: candidate.targetWeaponId,
      name: `Checkpoint conflict ${suffix}`,
    }
    const entry = createBuildListEntry(candidate, target, {
      selectedCheckpointOpportunityIds: selected,
      createdAt: `2026-09-1${suffix === 'a' ? 1 : 2}T00:00:00.000Z`,
    })
    return { candidate, target, entry, source: checkpointSource(source) }
  })
  const targets = parts.map(({ target }) => target)
  const entries: BuildListEntry[] = parts.map(({ entry }) => entry)
  const ownedWeapons: OwnedWeapon[] = parts.map(({ source }) => source)
  return { parts, ...plannerFixture(targets, entries, ownedWeapons) }
}

function conflictsOf(
  scenario: ReturnType<typeof twoEntryScenario>,
): PlanConflict[] {
  const prepared = preparePlannerInitialContext(scenario.input, scenario.dependencies)
  if (prepared.status !== 'ready') {
    throw new Error(`Expected a ready Planner initial context: ${prepared.status}`)
  }
  return prepared.context.initialConflictDetection.conflicts
}

/** The opportunity of one part's group, by the Route position it ends on. */
const opportunityAt = (
  part: ReturnType<typeof twoEntryScenario>['parts'][number],
  afterOperationIndex: number,
) => {
  const found = part.candidate.checkpointGroups
    ?.flatMap(({ opportunities }) => opportunities)
    .find((opportunity) => opportunity.afterOperationIndex === afterOperationIndex)
  if (!found) throw new Error('Fixture checkpoint opportunity is missing.')
  return found
}

describe('Compromise checkpoint conflicts', () => {
  it('reports two incompatible selected checkpoints on one Counter as a conflict', () => {
    const probe = twoEntryScenario([], [])
    const first = opportunityAt(probe.parts[0], 0)
    const second = opportunityAt(probe.parts[1], 0)

    const withoutSelection = conflictsOf(probe)
    const withSelection = twoEntryScenario([first.id], [second.id])
    const conflicts = conflictsOf(withSelection)

    // Both Entries now have to really execute the same Gogma position on their
    // own weapon, which the ordinary Counter conflict detection reports.
    const sharedCounter = conflicts.filter(({ kind }) => kind === 'same_gogma_counter')
    expect(sharedCounter.length).toBeGreaterThan(withoutSelection.length)
    expect(sharedCounter[0].buildListEntryIds).toEqual(
      [...withSelection.input.buildListEntries.map(({ id }) => id)].sort(),
    )
  })

  it('names the selected checkpoints that take part in the conflict', () => {
    const probe = twoEntryScenario([], [])
    const first = opportunityAt(probe.parts[0], 0)
    const second = opportunityAt(probe.parts[1], 0)
    const scenario = twoEntryScenario([first.id], [second.id])

    const conflict = conflictsOf(scenario).find(({ kind }) => kind === 'same_gogma_counter')

    // Typed metadata, so the UI can say the resolution is a Build List
    // checkpoint change rather than picking a winning Entry.
    expect(conflict?.checkpointParticipants).toHaveLength(2)
    expect(conflict?.checkpointParticipants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          buildListEntryId: scenario.input.buildListEntries[0].id,
          checkpointOpportunityId: first.id,
        }),
        expect.objectContaining({
          buildListEntryId: scenario.input.buildListEntries[1].id,
          checkpointOpportunityId: second.id,
        }),
      ]),
    )
  })

  it('reaches both Entries with one shared physical checkpoint action', () => {
    // Two Entries whose Routes are the same physical operation on the same
    // weapon at the same Counter: one action, judged once.
    const shared = [
      checkpointPracticalBonuses(),
      checkpointPracticalBonusesReordered(),
      checkpointIdealBonuses(),
    ]
    const units = ['a', 'b'].map((suffix) => {
      const candidate = checkpointCandidate(shared, {
        sourceOwnedWeaponId: SOURCE_A,
        candidateId: `candidate.checkpoint.shared.${suffix}`,
        targetWeaponId: `target.checkpoint.shared.${suffix}`,
      })
      const target: TargetWeapon = { ...checkpointTarget(), id: candidate.targetWeaponId }
      const entry = createBuildListEntry(candidate, target, {
        selectedCheckpointOpportunityIds: [
          candidate.checkpointGroups![0].opportunities[0].id,
        ],
      })
      const { unitPlans } = createPlannerRouteUnitPlans([entry], plannerEngine())
      return (unitPlans.get(entry.id) ?? [])[0]
    })

    expect(units[0].canSkipWhenCounterPassed).toBe(false)
    expect(units[1].canSkipWhenCounterPassed).toBe(false)
    // The same physical action key means the Planner performs it once and
    // progresses both Entries, rather than scheduling it twice.
    expect(units[0].physicalActionKey).toBe(units[1].physicalActionKey)
    expect(arePlannerRouteUnitsShareable(units[0], units[1])).toBe(true)
  })

  it('resolves the conflict when one Entry moves to another opportunity', () => {
    const probe = twoEntryScenario([], [])
    const first = opportunityAt(probe.parts[0], 0)
    const second = opportunityAt(probe.parts[1], 0)
    const later = opportunityAt(probe.parts[1], 1)

    const collided = conflictsOf(twoEntryScenario([first.id], [second.id]))
    const moved = conflictsOf(twoEntryScenario([first.id], [later.id]))

    expect(collided.some(({ kind }) => kind === 'same_gogma_counter')).toBe(true)
    // The two selections now end on different Gogma positions, so the shared
    // prefix is unobserved again for one of them.
    expect(moved.filter(({ kind }) => kind === 'same_gogma_counter')).toEqual([])
  })

  it('leaves an unselected shared prefix position without a conflict', () => {
    const conflicts = conflictsOf(twoEntryScenario([], []))

    expect(conflicts.filter(({ kind }) => kind === 'same_gogma_counter')).toEqual([])
    expect(conflicts.every(({ checkpointParticipants }) =>
      (checkpointParticipants ?? []).length === 0,
    )).toBe(true)
  })
})
