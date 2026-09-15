import { describe, expect, it } from 'vitest'
import {
  CHECKPOINT_IDEAL_SKILL,
  CHECKPOINT_MISMATCH_SKILL,
  CHECKPOINT_PRACTICAL_SKILL,
  checkpointAlternativeBonuses,
  checkpointBelowPracticalBonuses,
  checkpointCandidate,
  checkpointConversionCandidate,
  checkpointIdealBonuses,
  checkpointMaster,
  checkpointMixedCandidate,
  checkpointNormalSource,
  checkpointPracticalBonuses,
  checkpointPracticalBonusesReordered,
  checkpointSource,
  checkpointStrongerPracticalBonuses,
  checkpointTarget,
} from '../../test/fixtures/checkpointRoute'
import { createBuildListEntry } from '../buildList'
import type { BuildCandidate, IntermediateStateGroup, IntermediateStateOpportunity } from '../models/publicTypes'
import { validateBuildCandidate, validateBuildListEntry } from '../models/validation'
import { candidateDeduplicationKey, candidateStableKey } from './candidateProcessing'
import { extractIntermediateStateGroups, replayCandidateLanes } from './intermediateStateExtraction'

const skillGroups = (candidate: BuildCandidate) =>
  (candidate.intermediateStateGroups ?? []).filter((group) => group.axis === 'skill')
const bonusGroups = (candidate: BuildCandidate) =>
  (candidate.intermediateStateGroups ?? []).filter((group) => group.axis === 'bonus')
const positions = (group: IntermediateStateGroup) =>
  group.opportunities.map(({ lanePosition }) => lanePosition)

describe('Axis-separated intermediate state extraction', () => {
  it('A: offers the conversion-assigned Practical Skill as a zero-Reset Skill state', () => {
    const candidate = checkpointConversionCandidate({
      conversionSkill: CHECKPOINT_PRACTICAL_SKILL,
      bonusResults: [checkpointPracticalBonuses(), checkpointIdealBonuses()],
      skillResults: [CHECKPOINT_IDEAL_SKILL],
    })

    const [skill] = skillGroups(candidate)
    expect(skillGroups(candidate)).toHaveLength(1)
    expect(skill).toMatchObject({ axis: 'skill', match: 'practical', ...CHECKPOINT_PRACTICAL_SKILL })
    // Lane position 0 is produced by the conversion itself: no Reset Skills is
    // demanded before the state can be adopted.
    expect(skill.opportunities).toEqual([
      expect.objectContaining({ axis: 'skill', lanePosition: 0, operationIndex: 1 }),
    ])
    // The Bonus lane is evaluated on its own: the Practical five slots after
    // the first Reset are a Bonus state whatever the Skill lane holds.
    const [bonus] = bonusGroups(candidate)
    expect(bonusGroups(candidate)).toHaveLength(1)
    expect(bonus).toMatchObject({ axis: 'bonus', match: 'practical', restorationBonusScope: 'gogma_artian' })
    expect(bonus.opportunities).toEqual([
      expect.objectContaining({ lanePosition: 1, operationIndex: 2, restorationBonuses: checkpointPracticalBonuses() }),
    ])
    // Both together form a selectable pair that continues to the Ideal.
    const entry = createBuildListEntry(candidate, checkpointTarget(), {
      intermediateStateSelection: {
        skillOpportunityId: skill.opportunities[0].id,
        bonusOpportunityId: bonus.opportunities[0].id,
        improvementPreference: 'planner',
      },
    })
    expect(validateBuildListEntry(entry).isValid).toBe(true)
  })

  it('B: offers no Skill state when the conversion already assigns the Ideal Skills', () => {
    const candidate = checkpointConversionCandidate({
      conversionSkill: CHECKPOINT_IDEAL_SKILL,
      bonusResults: [checkpointPracticalBonuses(), checkpointAlternativeBonuses(), checkpointIdealBonuses()],
      skillResults: [],
    })

    // The Skill lane is only its Ideal end, which is the final goal, never an
    // intermediate state; the Bonus lane still offers both compromise products.
    expect(skillGroups(candidate)).toEqual([])
    expect(bonusGroups(candidate).map(({ match }) => match)).toEqual(['practical', 'alternative'])
    expect(candidate.estimatedSkillAdvance).toBe(1)
  })

  it('C: offers the Practical Skill reached after a mismatching conversion', () => {
    const candidate = checkpointConversionCandidate({
      conversionSkill: CHECKPOINT_MISMATCH_SKILL,
      bonusResults: [checkpointIdealBonuses()],
      skillResults: [CHECKPOINT_PRACTICAL_SKILL, CHECKPOINT_IDEAL_SKILL],
    })

    const [skill] = skillGroups(candidate)
    expect(skillGroups(candidate)).toHaveLength(1)
    expect(skill.match).toBe('practical')
    expect(skill.opportunities).toEqual([
      expect.objectContaining({ lanePosition: 1, operationIndex: 3 }),
    ])
  })

  it('H: never offers the Ideal lane end of either lane', () => {
    const { candidate } = checkpointMixedCandidate({
      bonusResults: [checkpointIdealBonuses()],
      skillResults: [CHECKPOINT_IDEAL_SKILL],
    })
    expect(candidate.intermediateStateGroups).toEqual([])
    expect(replayCandidateLanes(candidate, [checkpointSource()]).skill).toHaveLength(2)
  })

  it('I: keeps the two lanes independent, so an unaccepted lane leaves the other lane offered', () => {
    const { candidate } = checkpointMixedCandidate({
      bonusResults: [checkpointBelowPracticalBonuses(), checkpointIdealBonuses()],
      skillResults: [CHECKPOINT_PRACTICAL_SKILL, CHECKPOINT_IDEAL_SKILL],
    })
    // No Bonus state is accepted before the Ideal, while the Skill lane still
    // has its Practical state. Whether a checkpoint exists is the Planner's
    // pin question, not an extraction question.
    expect(bonusGroups(candidate)).toEqual([])
    expect(skillGroups(candidate).map(({ match }) => match)).toEqual(['practical'])
  })

  it('J: never accepts the normal-scope five slots inherited at conversion', () => {
    const normal = checkpointNormalSource()
    normal.restorationBonuses = checkpointIdealBonuses()
    const candidate = checkpointConversionCandidate({
      conversionSkill: CHECKPOINT_IDEAL_SKILL,
      bonusResults: [checkpointIdealBonuses()],
      skillResults: [],
      ownedNormalSource: normal,
    })

    // The inherited slots carry every Ideal label, but in normal scope they
    // are not a Bonus state; only the Reset makes the lane accepted, and that
    // Reset is the lane end.
    const lanes = replayCandidateLanes(candidate, [normal])
    expect(lanes.bonus[0].state).toMatchObject({ known: true, restorationBonusScope: 'normal_artian' })
    expect(bonusGroups(candidate)).toEqual([])
  })

  it('K: offers an existing Gogma\'s current Practical Skills and current accepted slots at lane position 0', () => {
    const { candidate } = checkpointMixedCandidate({
      sourceSkill: CHECKPOINT_PRACTICAL_SKILL,
      sourceBonuses: checkpointPracticalBonuses(),
      bonusResults: [checkpointIdealBonuses()],
      skillResults: [CHECKPOINT_IDEAL_SKILL],
    })

    expect(skillGroups(candidate)).toEqual([
      expect.objectContaining({
        match: 'practical',
        opportunities: [expect.objectContaining({ lanePosition: 0, operationIndex: null })],
      }),
    ])
    expect(bonusGroups(candidate)).toEqual([
      expect.objectContaining({
        match: 'practical',
        opportunities: [expect.objectContaining({ lanePosition: 0, operationIndex: null })],
      }),
    ])
    // Holding both lane starts is the weapon the user already owns: a legal
    // selection whose checkpoint the Planner holds from its start, exactly
    // like one start with the other lane's Ideal end.
    const both = createBuildListEntry(candidate, checkpointTarget(), {
      intermediateStateSelection: {
        skillOpportunityId: skillGroups(candidate)[0].opportunities[0].id,
        bonusOpportunityId: bonusGroups(candidate)[0].opportunities[0].id,
        improvementPreference: 'planner',
      },
    })
    expect(validateBuildListEntry(both).isValid).toBe(true)
    const skillOnly = createBuildListEntry(candidate, checkpointTarget(), {
      intermediateStateSelection: {
        skillOpportunityId: skillGroups(candidate)[0].opportunities[0].id,
        bonusOpportunityId: null,
        improvementPreference: 'planner',
      },
    })
    expect(validateBuildListEntry(skillOnly).isValid).toBe(true)
  })

  it('groups repeated arrivals at the same state and keeps every lane position', () => {
    const { candidate } = checkpointMixedCandidate({
      bonusResults: [
        checkpointPracticalBonuses(),
        checkpointPracticalBonusesReordered(),
        checkpointIdealBonuses(),
      ],
      skillResults: [CHECKPOINT_PRACTICAL_SKILL, CHECKPOINT_MISMATCH_SKILL, CHECKPOINT_PRACTICAL_SKILL, CHECKPOINT_IDEAL_SKILL],
    })

    const [bonus] = bonusGroups(candidate)
    expect(bonusGroups(candidate)).toHaveLength(1)
    expect(positions(bonus)).toEqual([1, 2])
    // Each opportunity keeps its exact slot order; the group keeps the earliest.
    expect(bonus.opportunities[1]).toMatchObject({ restorationBonuses: checkpointPracticalBonusesReordered() })
    expect(bonus.axis === 'bonus' && bonus.restorationBonuses).toEqual(checkpointPracticalBonuses())
    const [skill] = skillGroups(candidate)
    expect(skillGroups(candidate)).toHaveLength(1)
    expect(positions(skill)).toEqual([1, 3])
  })

  it('marks a conservatively worse Bonus state display-secondary without removing it', () => {
    const candidate = checkpointCandidate([
      checkpointStrongerPracticalBonuses(),
      checkpointPracticalBonuses(),
      checkpointIdealBonuses(),
    ])
    const groups = bonusGroups(candidate)
    expect(groups).toHaveLength(2)
    const stronger = groups.find((group) => group.axis === 'bonus' && !group.isDisplaySecondary)
    const weaker = groups.find((group) => group.axis === 'bonus' && group.isDisplaySecondary)
    expect(stronger?.axis === 'bonus' && stronger.restorationBonuses).toEqual(checkpointStrongerPracticalBonuses())
    expect(weaker?.axis === 'bonus' && weaker.dominatingGroupId).toBe(stronger?.id)
    // Differing compositions stay primary: an Alternative product is never
    // ranked against a Practical one.
    const mixed = checkpointCandidate([
      checkpointPracticalBonuses(),
      checkpointAlternativeBonuses(),
      checkpointIdealBonuses(),
    ])
    expect(bonusGroups(mixed).every((group) => group.axis === 'bonus' && !group.isDisplaySecondary)).toBe(true)
  })

  it('R: is deterministic and independent of the search run', () => {
    const first = checkpointMixedCandidate({
      bonusResults: [checkpointPracticalBonuses(), checkpointIdealBonuses()],
      skillResults: [CHECKPOINT_PRACTICAL_SKILL, CHECKPOINT_IDEAL_SKILL],
    })
    const second = checkpointMixedCandidate({
      bonusResults: [checkpointPracticalBonuses(), checkpointIdealBonuses()],
      skillResults: [CHECKPOINT_PRACTICAL_SKILL, CHECKPOINT_IDEAL_SKILL],
    })
    second.candidate.searchRunId = 'search-run.checkpoint.other'
    second.candidate.createdAt = '2027-01-01T00:00:00.000Z'
    const other = extractIntermediateStateGroups(second.candidate, {
      target: checkpointTarget(),
      master: checkpointMaster(),
      ownedWeapons: [second.source],
    })
    expect(other).toEqual(first.candidate.intermediateStateGroups)
    expect(other.map(({ id }) => id)).toEqual(first.candidate.intermediateStateGroups?.map(({ id }) => id))
    // Group and opportunity ids come from the stable key and the lane identity.
    expect(other.every(({ id }) => id.startsWith('intermediate-group:'))).toBe(true)
    expect(other.flatMap((group): IntermediateStateOpportunity[] => [...group.opportunities]).every(({ id }) =>
      id.startsWith('intermediate-opportunity:'),
    )).toBe(true)
  })

  it('never enters any Candidate identity', () => {
    const { candidate } = checkpointMixedCandidate({
      bonusResults: [checkpointPracticalBonuses(), checkpointIdealBonuses()],
      skillResults: [CHECKPOINT_PRACTICAL_SKILL, CHECKPOINT_IDEAL_SKILL],
    })
    const historical = structuredClone(candidate)
    delete historical.intermediateStateGroups
    expect(candidateStableKey(historical)).toBe(candidateStableKey(candidate))
    expect(candidateDeduplicationKey(historical)).toBe(candidateDeduplicationKey(candidate))
    expect(validateBuildCandidate(candidate, [checkpointSource()]).isValid).toBe(true)
  })

  it('fails loudly when a lane end disagrees with the Candidate result', () => {
    const { candidate } = checkpointMixedCandidate({
      bonusResults: [checkpointIdealBonuses()],
      skillResults: [CHECKPOINT_IDEAL_SKILL],
    })
    candidate.seriesSkillId = 'series_skill.fixture.other'
    expect(() =>
      extractIntermediateStateGroups(candidate, {
        target: checkpointTarget(),
        master: checkpointMaster(),
        ownedWeapons: [checkpointSource()],
      }),
    ).toThrow(/Skill lane replay/)
  })
})
