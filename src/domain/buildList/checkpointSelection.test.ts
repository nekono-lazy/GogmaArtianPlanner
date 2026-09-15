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
  IntermediateBonusOpportunity,
  IntermediateBonusStateGroup,
  IntermediateSkillOpportunity,
  IntermediateSkillStateGroup,
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

  it('hashes the execution meaning of a selected state, not only its id (Codex review of PR #38)', () => {
    const candidate = twoLaneCandidate()
    const bonus = intermediateOpportunityAt(candidate, 'bonus', 1).opportunity
    const skill = intermediateOpportunityAt(candidate, 'skill', 1).opportunity
    const entry = entryFor(candidate, { skillOpportunityId: skill.id, bonusOpportunityId: bonus.id })
    const base = createPlanningBuildListEntriesHash([entry])

    const withSelectedBonus = (
      mutate: (opportunity: IntermediateBonusOpportunity, group: IntermediateBonusStateGroup) => void,
    ): BuildListEntry => {
      const copy = structuredClone(entry)
      for (const group of copy.candidateSnapshot.intermediateStateGroups ?? []) {
        if (group.axis !== 'bonus') continue
        const found = group.opportunities.find(({ id }) => id === bonus.id)
        if (found) mutate(found, group)
      }
      return copy
    }
    const withSelectedSkill = (
      mutate: (opportunity: IntermediateSkillOpportunity, group: IntermediateSkillStateGroup) => void,
    ): BuildListEntry => {
      const copy = structuredClone(entry)
      for (const group of copy.candidateSnapshot.intermediateStateGroups ?? []) {
        if (group.axis !== 'skill') continue
        const found = group.opportunities.find(({ id }) => id === skill.id)
        if (found) mutate(found, group)
      }
      return copy
    }

    // C: the same id, the same unordered five slots, another slot order - the
    // checkpoint verification is ordered, so the hard constraint changed.
    const reordered = withSelectedBonus((opportunity) => {
      const slots = [...opportunity.restorationBonuses]
      const other = slots.findIndex((slot) => slot.bonusTypeId !== slots[0].bonusTypeId)
      expect(other).toBeGreaterThan(0)
      ;[slots[0], slots[other]] = [slots[other], slots[0]]
      opportunity.restorationBonuses = slots as typeof opportunity.restorationBonuses
    })
    expect(reordered.intermediateStateSelection).toEqual(entry.intermediateStateSelection)
    expect(createPlanningBuildListEntriesHash([reordered])).not.toBe(base)
    // Unrelated intermediate state metadata leaves the hash alone.
    const untouched = structuredClone(entry)
    for (const group of untouched.candidateSnapshot.intermediateStateGroups ?? []) {
      if (group.axis === 'bonus') group.isDisplaySecondary = !group.isDisplaySecondary
    }
    expect(createPlanningBuildListEntriesHash([untouched])).toBe(base)

    // D: lane semantics and the selected Skills move the hash too.
    expect(createPlanningBuildListEntriesHash([
      withSelectedBonus((opportunity) => { opportunity.lanePosition += 1 }),
    ])).not.toBe(base)
    expect(createPlanningBuildListEntriesHash([
      withSelectedBonus((opportunity) => { opportunity.operationIndex = (opportunity.operationIndex ?? 0) + 1 }),
    ])).not.toBe(base)
    expect(createPlanningBuildListEntriesHash([
      withSelectedSkill((_, group) => { group.seriesSkillId = 'series_skill.fixture.z' }),
    ])).not.toBe(base)
    expect(createPlanningBuildListEntriesHash([
      withSelectedSkill((_, group) => { group.groupSkillId = null }),
    ])).not.toBe(base)

    // An id that resolves on no lane is a validation failure, not a crash and
    // not an empty selection.
    const unresolved = structuredClone(entry)
    unresolved.candidateSnapshot.intermediateStateGroups = []
    expect(validateBuildListEntry(unresolved).isValid).toBe(false)
    expect(() => createPlanningBuildListEntriesHash([unresolved])).not.toThrow()
    expect(createPlanningBuildListEntriesHash([unresolved])).not.toBe(base)
    expect(createPlanningBuildListEntriesHash([unresolved])).not.toBe(
      createPlanningBuildListEntriesHash([entryFor(candidate)]),
    )
  })

  it('hashes the whole checkpoint pin pair: the Ideal lane end of an unselected lane in stored slot order', () => {
    const candidate = twoLaneCandidate()
    const skill = intermediateOpportunityAt(candidate, 'skill', 1).opportunity
    const bonus = intermediateOpportunityAt(candidate, 'bonus', 1).opportunity
    /** The same unordered Ideal multiset with two differing slots swapped. */
    const withReorderedIdealBonuses = (source: BuildListEntry): BuildListEntry => {
      const copy = structuredClone(source)
      const slots = [...copy.candidateSnapshot.finalBonuses]
      const other = slots.findIndex((slot) => slot.bonusTypeId !== slots[0].bonusTypeId)
      expect(other).toBeGreaterThan(0)
      ;[slots[0], slots[other]] = [slots[other], slots[0]]
      copy.candidateSnapshot.finalBonuses = slots as typeof copy.candidateSnapshot.finalBonuses
      // Keep the artifact structurally consistent: the last Bonus amendment
      // observed the same ordered result.
      const trace = copy.candidateSnapshot.bonusAmendmentTrace ?? []
      const last = trace[trace.length - 1]
      if (last) last.restorationBonuses = structuredClone(copy.candidateSnapshot.finalBonuses)
      expect(validateBuildListEntry(copy).isValid).toBe(true)
      return copy
    }

    // A: Skill-only selection - the checkpoint is the selected Skill plus the
    // exact Ideal Bonus, so reordering the Ideal slots changes the constraint.
    const skillOnly = entryFor(candidate, { skillOpportunityId: skill.id })
    expect(createPlanningBuildListEntriesHash([withReorderedIdealBonuses(skillOnly)])).not.toBe(
      createPlanningBuildListEntriesHash([skillOnly]),
    )

    // B: Bonus-only selection - the Skill side of the pin is the Candidate's
    // Ideal Skills.
    const bonusOnly = entryFor(candidate, { bonusOpportunityId: bonus.id })
    const otherIdealSkill = structuredClone(bonusOnly)
    otherIdealSkill.candidateSnapshot.seriesSkillId = 'series_skill.fixture.z'
    expect(createPlanningBuildListEntriesHash([otherIdealSkill])).not.toBe(
      createPlanningBuildListEntriesHash([bonusOnly]),
    )

    // C: both lanes selected - the pair is the two selected states, and the
    // Candidate's Ideal slot order is no longer part of the checkpoint.
    const both = entryFor(candidate, { skillOpportunityId: skill.id, bonusOpportunityId: bonus.id })
    expect(createPlanningBuildListEntriesHash([both])).not.toBe(createPlanningBuildListEntriesHash([skillOnly]))
    expect(createPlanningBuildListEntriesHash([both])).not.toBe(createPlanningBuildListEntriesHash([bonusOnly]))

    // D: no selection - no checkpoint, so the Candidate Snapshot's unordered
    // multiset semantics still apply and a slot reorder alone hashes the same.
    const none = entryFor(candidate)
    expect(createPlanningBuildListEntriesHash([withReorderedIdealBonuses(none)])).toBe(
      createPlanningBuildListEntriesHash([none]),
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
