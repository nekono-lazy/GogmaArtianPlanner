import { describe, expect, it } from 'vitest'
import {
  CHECKPOINT_IDEAL_SKILL,
  CHECKPOINT_PRACTICAL_SKILL,
  checkpointIdealBonuses,
  checkpointMixedCandidate,
  checkpointPracticalBonuses,
  checkpointPracticalBonusesReordered,
  checkpointSource,
  checkpointTarget,
  intermediateOpportunityAt,
} from '../../test/fixtures/checkpointRoute'
import { createValidRngState } from '../../test/fixtures/domainData'
import type {
  BuildCandidate,
  BuildListEntry,
  IntermediateStateOpportunityId,
  IntermediateStateSelection,
} from '../models/publicTypes'
import { validateBuildListEntry } from '../models/validation'
import { createPlanningBuildListEntriesHash } from '../planner'
import {
  createBuildListEntry,
  defaultIntermediateStateSelection,
  isSameBuildListCandidate,
  withIntermediateStateSelection,
} from './buildListEntry'
import { evaluateBuildListEntryStaleness } from './staleness'

/** A Candidate with a Practical state on each lane, the Bonus one reached twice. */
function twoLaneCandidate(): BuildCandidate {
  return checkpointMixedCandidate({
    bonusResults: [
      checkpointPracticalBonuses(),
      checkpointPracticalBonusesReordered(),
      checkpointIdealBonuses(),
    ],
    skillResults: [CHECKPOINT_PRACTICAL_SKILL, CHECKPOINT_IDEAL_SKILL],
  }).candidate
}

function entryFor(
  candidate: BuildCandidate,
  selection: Partial<IntermediateStateSelection> = {},
): BuildListEntry {
  return createBuildListEntry(candidate, checkpointTarget(), {
    intermediateStateSelection: { ...defaultIntermediateStateSelection(), ...selection },
  })
}

describe('BuildListEntry intermediate state selection', () => {
  it('starts with nothing selected and the improvement order left to the Planner', () => {
    const entry = createBuildListEntry(twoLaneCandidate(), checkpointTarget())

    expect(entry.intermediateStateSelection).toEqual({
      skillOpportunityId: null,
      bonusOpportunityId: null,
      improvementPreference: 'planner',
    })
    expect(validateBuildListEntry(entry).isValid).toBe(true)
  })

  it('accepts one state per lane and the improvement preference', () => {
    const candidate = twoLaneCandidate()
    const skill = intermediateOpportunityAt(candidate, 'skill', 1).opportunity
    const bonus = intermediateOpportunityAt(candidate, 'bonus', 2).opportunity
    const entry = entryFor(candidate, {
      skillOpportunityId: skill.id,
      bonusOpportunityId: bonus.id,
      improvementPreference: 'skill_first',
    })

    expect(validateBuildListEntry(entry).isValid).toBe(true)
    expect(entry.intermediateStateSelection).toEqual({
      skillOpportunityId: skill.id,
      bonusOpportunityId: bonus.id,
      improvementPreference: 'skill_first',
    })
  })

  it('rejects an opportunity id the Candidate Snapshot does not carry', () => {
    const entry = entryFor(twoLaneCandidate(), {
      bonusOpportunityId: 'intermediate-opportunity:unknown' as IntermediateStateOpportunityId,
    })

    const validation = validateBuildListEntry(entry)
    expect(validation.isValid).toBe(false)
    expect(validation.issues[0]).toMatchObject({
      path: 'intermediateStateSelection.bonusOpportunityId',
      code: 'invalid_reference',
    })
  })

  it('rejects an opportunity of the other lane', () => {
    const candidate = twoLaneCandidate()
    const bonus = intermediateOpportunityAt(candidate, 'bonus', 1).opportunity
    const entry = entryFor(candidate, { skillOpportunityId: bonus.id })

    expect(validateBuildListEntry(entry).issues.map(({ path }) => path))
      .toContain('intermediateStateSelection.skillOpportunityId')
  })

  it('rejects an unknown improvement preference', () => {
    const entry = entryFor(twoLaneCandidate(), {
      improvementPreference: 'fastest' as never,
    })
    expect(validateBuildListEntry(entry).issues.map(({ path }) => path))
      .toContain('intermediateStateSelection.improvementPreference')
  })

  it('does not stale the Entry when the selection changes', () => {
    const candidate = twoLaneCandidate()
    const target = checkpointTarget()
    const entry = createBuildListEntry(candidate, target)
    const edited = withIntermediateStateSelection(entry, {
      skillOpportunityId: intermediateOpportunityAt(candidate, 'skill', 1).opportunity.id,
      bonusOpportunityId: null,
      improvementPreference: 'bonus_first',
    })

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

  it('changes the Plan build-list hash when a selection or the preference changes', () => {
    const candidate = twoLaneCandidate()
    const entry = entryFor(candidate)
    const skill = intermediateOpportunityAt(candidate, 'skill', 1).opportunity
    const selected = withIntermediateStateSelection(entry, {
      ...defaultIntermediateStateSelection(),
      skillOpportunityId: skill.id,
    })
    const preferred = withIntermediateStateSelection(entry, {
      ...defaultIntermediateStateSelection(),
      improvementPreference: 'skill_first',
    })

    const base = createPlanningBuildListEntriesHash([entry])
    expect(createPlanningBuildListEntriesHash([selected])).not.toBe(base)
    expect(createPlanningBuildListEntriesHash([preferred])).not.toBe(base)
    expect(createPlanningBuildListEntriesHash([selected])).not.toBe(
      createPlanningBuildListEntriesHash([preferred]),
    )
    // The same selection hashes the same.
    expect(createPlanningBuildListEntriesHash([selected])).toBe(
      createPlanningBuildListEntriesHash([
        withIntermediateStateSelection(entry, {
          ...defaultIntermediateStateSelection(),
          skillOpportunityId: skill.id,
        }),
      ]),
    )
  })

  it('treats a re-added equivalent Candidate as the same Build List membership', () => {
    const candidate = twoLaneCandidate()
    const skill = intermediateOpportunityAt(candidate, 'skill', 1).opportunity
    const entry = entryFor(candidate, { skillOpportunityId: skill.id })

    // Candidate identity excludes intermediate state metadata, so the same
    // semantic Candidate found again matches the Entry the user already edited.
    expect(isSameBuildListCandidate(entry, twoLaneCandidate())).toBe(true)
    expect(entry.intermediateStateSelection?.skillOpportunityId).toBe(skill.id)
  })
})
