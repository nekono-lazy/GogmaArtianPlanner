import { describe, expect, it } from 'vitest'
import type { BuildListEntry } from '../models/publicTypes'
import {
  checkpointCandidate,
  checkpointIdealBonuses,
  checkpointPracticalBonuses,
  checkpointPracticalBonusesReordered,
  checkpointTarget,
} from '../../test/fixtures/checkpointRoute'
import { createValidTargetWeapon, targetWeaponId } from '../../test/fixtures/domainData'
import {
  buildListEntriesForTarget,
  classifyBuildListCandidateAddition,
  findBuildListTargetDuplicates,
  validateBuildListCardinality,
} from './buildListCardinality'
import { createBuildListEntry } from './buildListEntry'

function entryOf(id: string, targetId: string): Pick<BuildListEntry, 'id' | 'targetWeaponId'> {
  return { id: id as BuildListEntry['id'], targetWeaponId: targetWeaponId(targetId) }
}

describe('Build List cardinality collection invariant', () => {
  it('accepts no Entry, one Entry, and one Entry per Target', () => {
    expect(findBuildListTargetDuplicates([])).toEqual([])
    expect(validateBuildListCardinality([])).toEqual({ isValid: true, issues: [] })
    expect(validateBuildListCardinality([entryOf('entry.a1', 'target.a')]).isValid).toBe(true)
    expect(validateBuildListCardinality([
      entryOf('entry.a1', 'target.a'),
      entryOf('entry.b1', 'target.b'),
      entryOf('entry.c1', 'target.c'),
    ]).isValid).toBe(true)
  })

  it('reports every duplicated Target with its Entries in stable order, whatever the input order', () => {
    const entries = [
      entryOf('entry.b2', 'target.b'),
      entryOf('entry.a1', 'target.a'),
      entryOf('entry.b1', 'target.b'),
      entryOf('entry.c1', 'target.c'),
      entryOf('entry.a3', 'target.a'),
      entryOf('entry.a2', 'target.a'),
    ]
    const expected = [
      { targetWeaponId: 'target.a', buildListEntryIds: ['entry.a1', 'entry.a2', 'entry.a3'] },
      { targetWeaponId: 'target.b', buildListEntryIds: ['entry.b1', 'entry.b2'] },
    ]

    expect(findBuildListTargetDuplicates(entries)).toEqual(expected)
    expect(findBuildListTargetDuplicates([...entries].reverse())).toEqual(expected)
    const validation = validateBuildListCardinality(entries)
    expect(validation.isValid).toBe(false)
    expect(validation.issues).toHaveLength(2)
    expect(validation.issues[0]).toMatchObject({
      path: 'buildListEntries',
      code: 'invalid_structure',
      message: expect.stringContaining('entry.a1, entry.a2, entry.a3') as string,
    })
  })

  it('counts a stale Entry beside a non-stale one as a duplicate', () => {
    const target = checkpointTarget()
    const fresh = createBuildListEntry(
      checkpointCandidate([checkpointPracticalBonuses(), checkpointIdealBonuses()]),
      target,
      { createdAt: '2026-09-01T00:00:00.000Z' },
    )
    const stale: BuildListEntry = {
      ...createBuildListEntry(checkpointCandidate([checkpointIdealBonuses()]), target, {
        createdAt: '2026-08-01T00:00:00.000Z',
      }),
      isStale: true,
      staleReasons: ['rng_state_changed'],
    }

    expect(findBuildListTargetDuplicates([fresh, stale])).toEqual([
      { targetWeaponId: target.id, buildListEntryIds: [fresh.id, stale.id].sort() },
    ])
  })

  it('lists one Target\'s Entries in stable ID order', () => {
    expect(buildListEntriesForTarget([
      entryOf('entry.a2', 'target.a'),
      entryOf('entry.b1', 'target.b'),
      entryOf('entry.a1', 'target.a'),
    ], targetWeaponId('target.a')).map(({ id }) => id)).toEqual(['entry.a1', 'entry.a2'])
  })
})

describe('classifyBuildListCandidateAddition', () => {
  const target = checkpointTarget()
  const first = checkpointCandidate([checkpointPracticalBonuses(), checkpointIdealBonuses()])
  const second = checkpointCandidate([
    checkpointPracticalBonuses(),
    checkpointPracticalBonusesReordered(),
    checkpointIdealBonuses(),
  ])
  const third = checkpointCandidate([checkpointIdealBonuses()])
  const a1 = createBuildListEntry(first, target, { createdAt: '2026-09-01T00:00:00.000Z' })
  const a2 = createBuildListEntry(second, target, { createdAt: '2026-09-02T00:00:00.000Z' })

  it('adds to a Target with no Entry, even beside other Targets\' Entries', () => {
    const other = { ...createValidTargetWeapon(), id: targetWeaponId('target.other') }
    const otherEntry = createBuildListEntry({ ...third, targetWeaponId: other.id }, other)
    expect(classifyBuildListCandidateAddition([], first)).toEqual({ status: 'target_empty' })
    expect(classifyBuildListCandidateAddition([otherEntry], first)).toEqual({ status: 'target_empty' })
  })

  it('reports the same semantic Candidate as a duplicate', () => {
    const repeated = { ...structuredClone(first), id: 'candidate.repeated' as typeof first.id, searchRunId: 'run.repeated' }
    expect(classifyBuildListCandidateAddition([a1], repeated)).toEqual({ status: 'duplicate', entry: a1 })
  })

  it('asks for a replacement when the Target holds another Candidate\'s Entry', () => {
    expect(classifyBuildListCandidateAddition([a1], second)).toEqual({
      status: 'replacement_required',
      existingEntry: a1,
    })
  })

  it('refuses a Target holding a legacy duplicate without choosing an Entry', () => {
    const legacy = {
      status: 'legacy_duplicate',
      entries: [a1, a2].sort((left, right) => (left.id < right.id ? -1 : 1)),
    }
    expect(classifyBuildListCandidateAddition([a2, a1], third)).toEqual(legacy)
    // The cardinality violation comes before the semantic duplicate rule: a
    // Candidate equal to one of the Entries is no duplicate of "the" Entry.
    expect(classifyBuildListCandidateAddition([a2, a1], first)).toEqual(legacy)
    expect(classifyBuildListCandidateAddition([a2, a1], second)).toEqual(legacy)
  })
})
