import { describe, expect, it } from 'vitest'
import {
  checkpointCandidate,
  checkpointIdealBonuses,
  checkpointPracticalBonuses,
  checkpointPracticalBonusesReordered,
  checkpointSource,
  checkpointStrongerPracticalBonuses,
  checkpointTarget,
} from '../../test/fixtures/checkpointRoute'
import { createValidRngState } from '../../test/fixtures/domainData'
import type {
  BuildCandidate,
  BuildListEntry,
  CompromiseCheckpointOpportunityId,
} from '../models/publicTypes'
import { validateBuildListEntry } from '../models/validation'
import { createPlanningBuildListEntriesHash } from '../planner'
import {
  createBuildListEntry,
  isSameBuildListCandidate,
  withSelectedCheckpointOpportunities,
} from './buildListEntry'
import { evaluateBuildListEntryStaleness } from './staleness'

/** A Candidate with two independent checkpoint groups on one Route. */
function twoGroupCandidate(): BuildCandidate {
  return checkpointCandidate([
    checkpointStrongerPracticalBonuses(),
    checkpointPracticalBonuses(),
    checkpointPracticalBonusesReordered(),
    checkpointIdealBonuses(),
  ])
}

function entryFor(
  candidate: BuildCandidate,
  selected: readonly CompromiseCheckpointOpportunityId[] = [],
): BuildListEntry {
  return createBuildListEntry(candidate, checkpointTarget(), {
    selectedCheckpointOpportunityIds: selected,
  })
}

const opportunityIds = (candidate: BuildCandidate) =>
  (candidate.checkpointGroups ?? []).map(({ opportunities }) =>
    opportunities.map(({ id }) => id),
  )

describe('BuildListEntry checkpoint selection', () => {
  it('starts with no checkpoint selected', () => {
    const candidate = twoGroupCandidate()
    const entry = createBuildListEntry(candidate, checkpointTarget())

    expect(candidate.checkpointGroups?.length).toBeGreaterThan(1)
    expect(entry.selectedCheckpointOpportunityIds).toEqual([])
    expect(validateBuildListEntry(entry).isValid).toBe(true)
  })

  it('accepts one opportunity from each of several groups', () => {
    const candidate = twoGroupCandidate()
    const [first, second] = opportunityIds(candidate)
    const entry = entryFor(candidate, [first[0], second[0]])

    expect(validateBuildListEntry(entry).isValid).toBe(true)
    expect(entry.selectedCheckpointOpportunityIds).toEqual([first[0], second[0]])
  })

  it('rejects two opportunities of the same group', () => {
    const candidate = twoGroupCandidate()
    const group = (candidate.checkpointGroups ?? []).find(
      ({ opportunities }) => opportunities.length > 1,
    )
    expect(group?.opportunities.length).toBeGreaterThan(1)
    const entry = entryFor(candidate, [
      group!.opportunities[0].id,
      group!.opportunities[1].id,
    ])

    const validation = validateBuildListEntry(entry)
    expect(validation.isValid).toBe(false)
    expect(validation.issues.map(({ path }) => path)).toContain(
      'selectedCheckpointOpportunityIds[1]',
    )
  })

  it('rejects an opportunity id the Candidate Snapshot does not carry', () => {
    const candidate = twoGroupCandidate()
    const entry = entryFor(candidate, [
      'checkpoint-opportunity:unknown' as CompromiseCheckpointOpportunityId,
    ])

    const validation = validateBuildListEntry(entry)
    expect(validation.isValid).toBe(false)
    expect(validation.issues[0].code).toBe('invalid_reference')
  })

  it('does not stale the Entry when the selection changes', () => {
    const candidate = twoGroupCandidate()
    const target = checkpointTarget()
    const entry = createBuildListEntry(candidate, target)
    const [first] = opportunityIds(candidate)
    const edited = withSelectedCheckpointOpportunities(entry, [first[0]])

    expect(edited.candidateSnapshot).toEqual(entry.candidateSnapshot)
    expect(edited.searchStateHash).toBe(entry.searchStateHash)
    expect(edited.referencedOwnedWeaponsHash).toBe(entry.referencedOwnedWeaponsHash)
    expect(edited.targetDefinitionHash).toBe(entry.targetDefinitionHash)
    expect(edited.calculationContext).toEqual(entry.calculationContext)
    // The selection is Build List membership data, not calculation input, so
    // the Entry's staleness is bit-for-bit what it was before the edit.
    const context = {
      target,
      rngState: createValidRngState(),
      normalCounters: [],
      ownedWeapons: [checkpointSource()],
      calculationContext: edited.calculationContext,
    }
    expect(evaluateBuildListEntryStaleness(edited, context)).toEqual(
      evaluateBuildListEntryStaleness(entry, context),
    )
  })

  it('changes the Plan build-list hash when the selection changes', () => {
    const candidate = twoGroupCandidate()
    const entry = entryFor(candidate)
    const [first] = opportunityIds(candidate)
    const selected = withSelectedCheckpointOpportunities(entry, [first[0]])
    const other = withSelectedCheckpointOpportunities(entry, [first[1] ?? first[0]])

    const base = createPlanningBuildListEntriesHash([entry])
    expect(createPlanningBuildListEntriesHash([selected])).not.toBe(base)
    // The hash is order-independent but selection-sensitive.
    expect(createPlanningBuildListEntriesHash([selected])).toBe(
      createPlanningBuildListEntriesHash([
        withSelectedCheckpointOpportunities(entry, [first[0]]),
      ]),
    )
    if (first[1] !== undefined) {
      expect(createPlanningBuildListEntriesHash([other])).not.toBe(
        createPlanningBuildListEntriesHash([selected]),
      )
    }
  })

  it('treats a re-added equivalent Candidate as the same Build List membership', () => {
    const candidate = twoGroupCandidate()
    const [first] = opportunityIds(candidate)
    const entry = entryFor(candidate, [first[0]])

    // Candidate identity excludes checkpoint metadata, so the same semantic
    // Candidate found again matches the Entry the user already edited.
    expect(isSameBuildListCandidate(entry, twoGroupCandidate())).toBe(true)
    expect(entry.selectedCheckpointOpportunityIds).toEqual([first[0]])
  })
})
