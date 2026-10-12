import { describe, expect, it } from 'vitest'
import { applyReachOption, createEmptyPartialAssignment, findResourceViolation, requiredPositionsOf, streamEndDelta, streamEndObjective } from './assignmentFeasibility'
import { COUNTER_A, COUNTER_B, gogmaSource, handBuiltReachTable, newNormalSource, normalSource } from './assignmentTestFixture'
import { createReachOption } from './reachOptions'
import { GlobalAssignmentInvariantError, type BonusRequirement, type ReachOption, type SkillRequirement, type SourceCandidate } from './types'

/*
 * Issue #154 Global Assignment Phase B-1 (design 6.1): C1 source exclusivity and C2 required position
 * exclusivity per stream, on hand-built options. No Engine, no oracle.
 */
const { table } = handBuiltReachTable({ originNormal: { [COUNTER_A]: 4, [COUNTER_B]: 20 }, targets: [
  { id: 'target.a', sources: [] },
  { id: 'target.b', weaponTypeId: 'weapon.fixture.b', normalCounterId: COUNTER_B, sources: [] },
] })
const [targetA, targetB] = table.targets
const option = (source: SourceCandidate, skill: SkillRequirement, bonus: BonusRequirement, target = targetA!): ReachOption => createReachOption(target, table, source, skill, bonus)
const conversion = (conversionPosition: number, finalPosition: number): SkillRequirement => ({ kind: 'conversion', conversionPosition, finalPosition })
const resetSkills = (finalPosition: number): SkillRequirement => ({ kind: 'reset_skills', finalPosition })
const reset = (finalPosition: number): BonusRequirement => ({ kind: 'reset', finalPosition })
const keep = (finalPosition: number): BonusRequirement => ({ kind: 'keep_from_source', finalPosition })
const resetThenKeep = (resetPosition: number, finalPosition: number): BonusRequirement => ({ kind: 'reset_then_keep', resetPosition, finalPosition })
const none: SkillRequirement & BonusRequirement = { kind: 'none' }

describe('Phase B-1 required positions', () => {
  it('derives exactly the required positions of design 6.1 C2, one Skill position when the conversion Skill is Ideal', () => {
    expect(requiredPositionsOf(option(gogmaSource('g'), resetSkills(8), reset(12)))).toEqual({ skill: [8], gogma: [12], normal: null })
    expect(requiredPositionsOf(option(normalSource('n'), conversion(7, 10), keep(13)))).toEqual({ skill: [7, 10], gogma: [13], normal: null })
    expect(requiredPositionsOf(option(normalSource('n'), conversion(8, 8), resetThenKeep(11, 13)))).toEqual({ skill: [8], gogma: [11, 13], normal: null })
    expect(requiredPositionsOf(option(newNormalSource(5), conversion(10, 10), reset(12)))).toEqual({ skill: [10], gogma: [12], normal: { counterId: COUNTER_A, position: 5 } })
    expect(requiredPositionsOf(option(gogmaSource('g', { currentSkillIdeal: true, currentBonusIdeal: true }), none, none))).toEqual({ skill: [], gogma: [], normal: null })
  })

  it('fails closed on an option that contradicts itself instead of occupying a guessed position', () => {
    expect(() => requiredPositionsOf(option(normalSource('n'), conversion(11, 10), reset(12)))).toThrow(GlobalAssignmentInvariantError)
    expect(() => requiredPositionsOf(option(gogmaSource('g'), resetSkills(8), resetThenKeep(13, 13)))).toThrow(GlobalAssignmentInvariantError)
    const detached = { ...option(newNormalSource(5), conversion(8, 8), reset(12)), normalRequired: null }
    expect(() => requiredPositionsOf(detached)).toThrow(GlobalAssignmentInvariantError)
    const owned = { ...option(normalSource('n'), conversion(8, 8), reset(12)), normalRequired: { counterId: COUNTER_A, position: 5 } }
    expect(() => requiredPositionsOf(owned)).toThrow(GlobalAssignmentInvariantError)
  })
})

describe('Phase B-1 resource feasibility (C1 / C2)', () => {
  const empty = createEmptyPartialAssignment(table)

  it('starts with nothing used, every Counter present and every stream at its origin', () => {
    expect(empty.chosen.size).toBe(0)
    expect([...empty.usedNormalPositions.keys()]).toEqual([COUNTER_A, COUNTER_B])
    expect(empty.streamEnd).toEqual({ skill: 7, gogma: 10, normal: { [COUNTER_A]: 4, [COUNTER_B]: 20 } })
    expect(findResourceViolation(option(gogmaSource('g'), resetSkills(8), reset(12)), empty)).toBeNull()
  })

  it('refuses the same OwnedWeapon or the same Normal production target twice, whatever the other positions', () => {
    const owned = applyReachOption(empty, option(gogmaSource('g'), resetSkills(8), reset(12)))
    expect(findResourceViolation(option(gogmaSource('g'), resetSkills(10), keep(13), targetB), owned)).toBe('source')
    expect(findResourceViolation(option(gogmaSource('h'), resetSkills(10), keep(13), targetB), owned)).toBeNull()
    const forged = applyReachOption(empty, option(newNormalSource(5), conversion(8, 8), reset(12)))
    expect(findResourceViolation(option(newNormalSource(5), conversion(10, 10), keep(13)), forged)).toBe('source')
    expect(findResourceViolation(option(newNormalSource(6), conversion(10, 10), keep(13)), forged)).toBeNull()
  })

  it('refuses an overlapping required Skill or Gogma position and accepts disjoint ones', () => {
    const partial = applyReachOption(empty, option(normalSource('n'), conversion(7, 10), resetThenKeep(11, 13)))
    expect(findResourceViolation(option(gogmaSource('g'), resetSkills(10), reset(12), targetB), partial)).toBe('skill_position')
    expect(findResourceViolation(option(newNormalSource(21, 'X', COUNTER_B), conversion(7, 8), reset(12), targetB), partial)).toBe('skill_position')
    expect(findResourceViolation(option(gogmaSource('g'), resetSkills(8), keep(11), targetB), partial)).toBe('gogma_position')
    expect(findResourceViolation(option(gogmaSource('g'), resetSkills(8), resetThenKeep(12, 13), targetB), partial)).toBe('gogma_position')
    expect(findResourceViolation(option(gogmaSource('g'), resetSkills(8), reset(12), targetB), partial)).toBeNull()
  })

  it('treats the skippable chain positions between required positions as free', () => {
    // Reset 11 -> Keep 13 occupies 11 and 13 only; another Target's required Reset at 12 coexists.
    const partial = applyReachOption(empty, option(gogmaSource('g'), resetSkills(8), resetThenKeep(11, 13)))
    expect(findResourceViolation(option(gogmaSource('h'), resetSkills(10), reset(12), targetB), partial)).toBeNull()
    expect([...partial.usedGogmaPositions].sort()).toEqual([11, 13])
  })

  it('keeps the Normal Counters of two weapon types independent at the same numeric position', () => {
    const { table: shared } = handBuiltReachTable({ originNormal: { [COUNTER_A]: 4, [COUNTER_B]: 4 }, targets: [
      { id: 'target.a', sources: [] }, { id: 'target.b', weaponTypeId: 'weapon.fixture.b', normalCounterId: COUNTER_B, sources: [] },
    ] })
    const [a, b] = shared.targets
    const partial = applyReachOption(createEmptyPartialAssignment(shared), createReachOption(a!, shared, newNormalSource(5), conversion(8, 8), reset(12)))
    const other = createReachOption(b!, shared, newNormalSource(5, 'X', COUNTER_B), conversion(10, 10), keep(13))
    expect(findResourceViolation(other, partial)).toBeNull()
    expect(findResourceViolation(createReachOption(b!, shared, newNormalSource(5, 'X', COUNTER_B), conversion(8, 8), keep(13)), partial)).toBe('skill_position')
  })

  it('applies an option without mutating the previous partial and takes the maximum stream end per stream', () => {
    const first = option(newNormalSource(5), conversion(8, 8), keep(13))
    const partial = applyReachOption(empty, first)
    expect(empty.chosen.size).toBe(0)
    expect(empty.usedSources.size).toBe(0)
    expect(partial.chosen.get(targetA!.targetWeaponId)).toBe(first)
    expect(partial.streamEnd).toEqual({ skill: 9, gogma: 14, normal: { [COUNTER_A]: 6, [COUNTER_B]: 20 } })
    const second = option(gogmaSource('g'), resetSkills(10), reset(12), targetB)
    const both = applyReachOption(partial, second)
    expect(both.streamEnd).toEqual({ skill: 11, gogma: 14, normal: { [COUNTER_A]: 6, [COUNTER_B]: 20 } })
    expect([...both.chosen.keys()]).toEqual(['target.a', 'target.b'])
    expect(partial.chosen.size).toBe(1)
    expect(() => applyReachOption(both, option(gogmaSource('z'), resetSkills(8), reset(12)))).toThrow(GlobalAssignmentInvariantError)
    expect(() => applyReachOption(partial, option(newNormalSource(5), conversion(10, 10), reset(12), targetB))).toThrow(GlobalAssignmentInvariantError)
  })

  it('measures the stream-end increment against the current ends and clips a stream already past the option', () => {
    const partial = applyReachOption(empty, option(newNormalSource(6), conversion(10, 10), keep(15)))
    expect(partial.streamEnd).toEqual({ skill: 11, gogma: 16, normal: { [COUNTER_A]: 7, [COUNTER_B]: 20 } })
    // Skill 9 and Gogma 12 lie inside the current ends: only the new Normal forge at 21 (Counter B) counts.
    expect(streamEndDelta(option(newNormalSource(21, 'X', COUNTER_B), conversion(8, 8), reset(11), targetB), partial)).toBe(2)
    expect(streamEndDelta(option(gogmaSource('g'), resetSkills(8), reset(12), targetB), partial)).toBe(0)
    expect(streamEndDelta(option(gogmaSource('g'), resetSkills(8), reset(12)), empty)).toBe(2 + 3)
  })

  it('sums the objective over the Skill stream, the Gogma stream and every Normal Counter of the table', () => {
    expect(streamEndObjective({ skill: 11, gogma: 16, normal: { [COUNTER_A]: 7, [COUNTER_B]: 22 } }, table)).toBe(4 + 6 + 3 + 2)
    expect(streamEndObjective(empty.streamEnd, table)).toBe(0)
  })
})
