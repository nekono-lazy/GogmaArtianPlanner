import { describe, expect, it } from 'vitest'
import {
  checkpointAlternativeBonuses,
  checkpointBelowPracticalBonuses,
  checkpointCandidate,
  checkpointIdealBonuses,
  checkpointMaster,
  checkpointPracticalBonuses,
  checkpointPracticalBonusesReordered,
  checkpointSource,
  checkpointStrongerPracticalBonuses,
  checkpointTarget,
  CHECKPOINT_SOURCE_ID,
} from '../../test/fixtures/checkpointRoute'
import { validateBuildCandidate } from '../models/validation'
import type { CompromiseCheckpointGroup } from '../models/publicTypes'
import {
  checkpointGroupDisplayDominates,
  extractCandidateCheckpointGroups,
  replayCandidateRoutePrefixStates,
} from './checkpointExtraction'

const extractionInput = () => ({
  target: checkpointTarget(),
  master: checkpointMaster(),
  ownedWeapons: [checkpointSource()],
})

/** `bonusTypeId:bonusRankId` labels in slot order, so slot order is visible. */
const slotLabels = (group: { restorationBonuses: readonly { bonusTypeId: string; bonusRankId: string }[] }) =>
  group.restorationBonuses.map(({ bonusTypeId, bonusRankId }) => `${bonusTypeId}:${bonusRankId}`)

describe('Compromise checkpoint extraction from a canonical Ideal Route', () => {
  it('offers only strict prefixes, never the Ideal-completing operation', () => {
    const candidate = checkpointCandidate([
      checkpointPracticalBonuses(),
      checkpointIdealBonuses(),
    ])
    const groups = candidate.checkpointGroups ?? []

    expect(groups).toHaveLength(1)
    expect(groups[0].opportunities.map(({ afterOperationIndex }) => afterOperationIndex))
      .toEqual([0])
    // The final operation completes the Ideal, so it is never a checkpoint.
    expect(
      groups.flatMap(({ opportunities }) =>
        opportunities.map(({ afterOperationIndex }) => afterOperationIndex),
      ),
    ).not.toContain(candidate.route.operations.length - 1)
    expect(validateBuildCandidate(candidate, [checkpointSource()]).isValid).toBe(true)
  })

  it('skips a prefix that satisfies no compromise condition', () => {
    const candidate = checkpointCandidate([
      checkpointBelowPracticalBonuses(),
      checkpointPracticalBonuses(),
      checkpointIdealBonuses(),
    ])
    const groups = candidate.checkpointGroups ?? []

    expect(groups).toHaveLength(1)
    expect(groups[0].opportunities.map(({ afterOperationIndex }) => afterOperationIndex))
      .toEqual([1])
  })

  it('records the compromise axes of each group and never the full Ideal', () => {
    const candidate = checkpointCandidate([
      checkpointPracticalBonuses(),
      checkpointAlternativeBonuses(),
      checkpointIdealBonuses(),
    ])
    const matches = (candidate.checkpointGroups ?? []).map(({ conditionMatch }) => conditionMatch)

    expect(matches).toEqual(
      expect.arrayContaining([
        { bonus: 'practical', skill: 'ideal' },
        { bonus: 'alternative', skill: 'ideal' },
      ]),
    )
    // A state that satisfies the whole Ideal condition is the Candidate, not a
    // checkpoint, so it never appears here.
    expect(matches).not.toContainEqual({ bonus: 'ideal', skill: 'ideal' })
  })

  it('adds no RNG prediction call, because it replays recorded traces only', () => {
    const candidate = checkpointCandidate([
      checkpointPracticalBonuses(),
      checkpointIdealBonuses(),
    ])
    const states = replayCandidateRoutePrefixStates(candidate, [checkpointSource()])

    expect(states.map(({ operationCount }) => operationCount)).toEqual([1, 2])
    expect(states[0].bonuses).toEqual({
      known: true,
      restorationBonuses: checkpointPracticalBonuses(),
      restorationBonusScope: 'gogma_artian',
    })
    // The replay takes an OwnedWeapon list and nothing else: there is no
    // parameter through which an RNG Engine could reach it.
    expect(replayCandidateRoutePrefixStates.length).toBe(2)
  })

  it('records exactly the state the Route prefix really reaches', () => {
    const candidate = checkpointCandidate([
      checkpointPracticalBonuses(),
      checkpointAlternativeBonuses(),
      checkpointIdealBonuses(),
    ])
    const states = replayCandidateRoutePrefixStates(candidate, [checkpointSource()])

    for (const group of candidate.checkpointGroups ?? []) {
      for (const opportunity of group.opportunities) {
        const state = states[opportunity.afterOperationIndex]
        expect(state.bonuses.known).toBe(true)
        expect(state.skills.known).toBe(true)
        if (!state.bonuses.known || !state.skills.known) continue
        // Slot-for-slot, not merely the same multiset: the Planner and Trace
        // Replay verify the exact state the user will hold.
        expect(opportunity.restorationBonuses).toEqual(state.bonuses.restorationBonuses)
        expect(opportunity.restorationBonusScope).toBe(state.bonuses.restorationBonusScope)
        expect(opportunity.seriesSkillId).toBe(state.skills.seriesSkillId)
        expect(opportunity.groupSkillId).toBe(state.skills.groupSkillId)
        expect(opportunity.operationCount).toBe(state.operationCount)
        // The Route always continues past a checkpoint to its Ideal result.
        expect(opportunity.remainingOperationCount).toBeGreaterThan(0)
        expect(opportunity.afterOperationIndex).toBeLessThan(
          candidate.route.operations.length - 1,
        )
      }
    }
  })

  it('produces the identical groups on a second extraction of the same Candidate', () => {
    const candidate = checkpointCandidate([
      checkpointPracticalBonuses(),
      checkpointIdealBonuses(),
    ])

    expect(extractCandidateCheckpointGroups(candidate, extractionInput())).toEqual(
      candidate.checkpointGroups,
    )
  })

  it('leaves a Candidate with no compromise prefix without any checkpoint', () => {
    const candidate = checkpointCandidate([
      checkpointBelowPracticalBonuses(),
      checkpointIdealBonuses(),
    ])

    expect(candidate.checkpointGroups).toEqual([])
    expect(validateBuildCandidate(candidate, [checkpointSource()]).isValid).toBe(true)
  })
})

describe('Compromise checkpoint grouping', () => {
  it('groups two slot orders of one Bonus multiset together', () => {
    const candidate = checkpointCandidate([
      checkpointPracticalBonuses(),
      checkpointPracticalBonusesReordered(),
      checkpointIdealBonuses(),
    ])
    const groups = candidate.checkpointGroups ?? []

    expect(groups).toHaveLength(1)
    expect(groups[0].opportunities).toHaveLength(2)
  })

  it('keeps the exact slot order of each opportunity', () => {
    const candidate = checkpointCandidate([
      checkpointPracticalBonuses(),
      checkpointPracticalBonusesReordered(),
      checkpointIdealBonuses(),
    ])
    const [group] = candidate.checkpointGroups ?? []

    expect(slotLabels(group.opportunities[0])).toEqual(slotLabels({
      restorationBonuses: checkpointPracticalBonuses(),
    }))
    expect(slotLabels(group.opportunities[1])).toEqual(slotLabels({
      restorationBonuses: checkpointPracticalBonusesReordered(),
    }))
    expect(slotLabels(group.opportunities[0])).not.toEqual(
      slotLabels(group.opportunities[1]),
    )
  })

  it('retains every arrival at the same compromise product, second and fourth', () => {
    const candidate = checkpointCandidate([
      checkpointPracticalBonuses(),
      checkpointBelowPracticalBonuses(),
      checkpointPracticalBonuses(),
      checkpointBelowPracticalBonuses(),
      checkpointIdealBonuses(),
    ])
    const [group] = candidate.checkpointGroups ?? []

    expect(group.opportunities.map(({ afterOperationIndex }) => afterOperationIndex))
      .toEqual([0, 2])
    expect(group.opportunities.map(({ operationCount }) => operationCount)).toEqual([1, 3])
    expect(group.opportunities.map(({ remainingOperationCount }) => remainingOperationCount))
      .toEqual([4, 2])
  })

  it('presents the earliest opportunity as the group representative', () => {
    const candidate = checkpointCandidate([
      checkpointPracticalBonuses(),
      checkpointPracticalBonusesReordered(),
      checkpointIdealBonuses(),
    ])
    const [group] = candidate.checkpointGroups ?? []

    expect(group.opportunities[0].operationCount).toBe(1)
    expect(slotLabels(group)).toEqual(slotLabels(group.opportunities[0]))
    // The later arrival is kept, not replaced by the representative.
    expect(group.opportunities).toHaveLength(2)
  })

  it('marks a dominated group display-secondary without removing anything', () => {
    const candidate = checkpointCandidate([
      checkpointStrongerPracticalBonuses(),
      checkpointPracticalBonuses(),
      checkpointIdealBonuses(),
    ])
    const groups = candidate.checkpointGroups ?? []
    const stronger = groups.find(({ restorationBonuses }) =>
      restorationBonuses.some(({ bonusRankId }) => bonusRankId === 'bonus_rank.fixture.middle'),
    )
    const weaker = groups.find(({ id }) => id !== stronger?.id)

    expect(groups).toHaveLength(2)
    expect(stronger?.isDisplaySecondary).toBe(false)
    expect(stronger?.dominatingGroupId).toBeNull()
    expect(weaker?.isDisplaySecondary).toBe(true)
    expect(weaker?.dominatingGroupId).toBe(stronger?.id)
    // Display dominance never removes a Domain opportunity: the dominated
    // group keeps its own selectable arrival.
    expect(weaker?.opportunities).toHaveLength(1)
  })

  it('never ranks a different Bonus Type composition or a different Skill as dominated', () => {
    const candidate = checkpointCandidate([
      checkpointStrongerPracticalBonuses(),
      checkpointAlternativeBonuses(),
      checkpointIdealBonuses(),
    ])
    const groups = candidate.checkpointGroups ?? []

    // The Alternative state replaces Sharpness with a second Utility, so the
    // two compositions are incomparable and both stay primary.
    expect(groups).toHaveLength(2)
    expect(groups.map(({ isDisplaySecondary }) => isDisplaySecondary)).toEqual([false, false])

    const [first, second] = groups
    const master = checkpointMaster()
    expect(checkpointGroupDisplayDominates(first, second, master, 'weapon.fixture.a')).toBe(false)
    expect(checkpointGroupDisplayDominates(second, first, master, 'weapon.fixture.a')).toBe(false)

    const differentSkill: CompromiseCheckpointGroup = {
      ...second,
      restorationBonuses: first.restorationBonuses,
      restorationBonusScope: first.restorationBonusScope,
      seriesSkillId: 'series_skill.fixture.other',
    }
    expect(
      checkpointGroupDisplayDominates(first, differentSkill, master, 'weapon.fixture.a'),
    ).toBe(false)
  })

  it('never lets a later arrival dominate an earlier weaker one', () => {
    const candidate = checkpointCandidate([
      checkpointPracticalBonuses(),
      checkpointStrongerPracticalBonuses(),
      checkpointIdealBonuses(),
    ])
    const groups = candidate.checkpointGroups ?? []

    // The stronger state only exists one operation later, so the user who
    // stops early still has a real choice: neither group is hidden.
    expect(groups.map(({ isDisplaySecondary }) => isDisplaySecondary)).toEqual([false, false])
  })

  it('gives deterministic ids that do not depend on the search run', () => {
    const first = checkpointCandidate([
      checkpointPracticalBonuses(),
      checkpointIdealBonuses(),
    ])
    const second = checkpointCandidate([
      checkpointPracticalBonuses(),
      checkpointIdealBonuses(),
    ])
    second.searchRunId = 'search-run.checkpoint.another'
    second.id = 'candidate.checkpoint.another' as typeof second.id
    second.createdAt = '2027-01-01T00:00:00.000Z'

    expect(extractCandidateCheckpointGroups(second, extractionInput())).toEqual(
      first.checkpointGroups,
    )
  })

  it('never treats the Route base state itself as a checkpoint', () => {
    const source = checkpointSource()
    // The starting weapon already satisfies the compromise condition.
    source.restorationBonuses = checkpointPracticalBonuses()
    const candidate = checkpointCandidate([checkpointIdealBonuses()])

    const groups = extractCandidateCheckpointGroups(candidate, {
      target: checkpointTarget(),
      master: checkpointMaster(),
      ownedWeapons: [source],
    })

    expect(groups).toEqual([])
    expect(candidate.route.sourceOwnedWeaponId).toBe(CHECKPOINT_SOURCE_ID)
  })
})
