import { describe, expect, it } from 'vitest'
import { loadMasterData } from '../../master/loadMasterData'
import { referenceRngVectors } from '../../../test/fixtures/referenceRngVectors'
import { gameVerifiedSkillIdentificationVector } from '../../../test/fixtures/gameVerifiedSkillVectors'
import {
  REFERENCE_GROUP_SKILL_POOL,
  REFERENCE_SERIES_SKILL_POOL,
  REFERENCE_SKILL_COMBINATION_COUNT,
  REFERENCE_SKILL_COUNTER_GATE_THRESHOLD,
  predictReferenceSkills,
  referenceSkillCombinationIndexFromIds,
  referenceSkillCombinationFromIndex,
} from '.'

function verifiedMaster() {
  const result = loadMasterData()
  if (!result.ok) throw new Error(JSON.stringify(result.issues))
  return result.data
}

describe('reference-verified Production Skill prediction', () => {
  it('keeps the fixed 21 Series by 14 Group reference pool, not Master display order', () => {
    expect(REFERENCE_SERIES_SKILL_POOL).toHaveLength(21)
    expect(REFERENCE_GROUP_SKILL_POOL).toHaveLength(14)
    expect(REFERENCE_SKILL_COMBINATION_COUNT).toBe(294)
  })

  it('maps every reference pool entry to one unique semantic ID in Master data', () => {
    const master = verifiedMaster()
    expect(new Set(REFERENCE_SERIES_SKILL_POOL).size).toBe(21)
    expect(new Set(REFERENCE_GROUP_SKILL_POOL).size).toBe(14)
    expect(REFERENCE_SERIES_SKILL_POOL.every((id) => master.seriesSkills.some((skill) => skill.id === id))).toBe(true)
    expect(REFERENCE_GROUP_SKILL_POOL.every((id) => master.groupSkills.some((skill) => skill.id === id))).toBe(true)
  })

  it('excludes the two currently enabled but unverified Group Skill IDs', () => {
    expect(REFERENCE_GROUP_SKILL_POOL).not.toContain('group_skill.verified_14')
    expect(REFERENCE_GROUP_SKILL_POOL).not.toContain('group_skill.verified_15')
  })

  it('converts every reference combination boundary to its semantic Series and Group IDs', () => {
    for (let seriesIndex = 0; seriesIndex < REFERENCE_SERIES_SKILL_POOL.length; seriesIndex += 1) {
      const first = referenceSkillCombinationFromIndex(seriesIndex * 14)
      const last = referenceSkillCombinationFromIndex(seriesIndex * 14 + 13)
      expect(first.seriesSkillId).toBe(REFERENCE_SERIES_SKILL_POOL[seriesIndex])
      expect(first.groupSkillId).toBe(REFERENCE_GROUP_SKILL_POOL[0])
      expect(last.seriesSkillId).toBe(REFERENCE_SERIES_SKILL_POOL[seriesIndex])
      expect(last.groupSkillId).toBe(REFERENCE_GROUP_SKILL_POOL[13])
    }
  })

  it('round-trips all 294 complete semantic Skill pairs through the reference table', () => {
    for (let index = 0; index < REFERENCE_SKILL_COMBINATION_COUNT; index += 1) {
      const combination = referenceSkillCombinationFromIndex(index)
      expect(referenceSkillCombinationIndexFromIds(
        combination.seriesSkillId,
        combination.groupSkillId,
      )).toBe(index)
    }
  })

  it('rejects invalid reference pool indices instead of silently falling back', () => {
    expect(() => referenceSkillCombinationFromIndex(-1)).toThrow(RangeError)
    expect(() => referenceSkillCombinationFromIndex(294)).toThrow(RangeError)
    expect(() => referenceSkillCombinationFromIndex(1.5)).toThrow(RangeError)
  })

  it('matches independent golden vectors from the pinned reference app.js', () => {
    for (const vector of referenceRngVectors.skillPredictions) {
      const result = predictReferenceSkills(vector)
      expect(result).toEqual({
        seriesSkillId: vector.seriesSkillId,
        groupSkillId: vector.groupSkillId,
        effectiveBlock: vector.counterGate < 54 ? 0 : vector.skillCounter,
        combinationIndex: vector.combinationIndex,
      })
    }
  })

  it.each([0, 53])('uses block zero below the Skill gate at Gate %i', (counterGate) => {
    const base = referenceRngVectors.skillPredictions[6]
    const expected = predictReferenceSkills({ ...base, counterGate: 0, skillCounter: 0 })
    expect(predictReferenceSkills({ ...base, counterGate, skillCounter: 999 })).toEqual(expected)
  })

  it.each([54, 55])('uses the Skill Counter block at and above Gate %i', (counterGate) => {
    const vector = referenceRngVectors.skillPredictions.find(
      (entry) => entry.counterGate === counterGate && entry.skillCounter === 1,
    )
    expect(vector).toBeDefined()
    expect(predictReferenceSkills(vector!)).toMatchObject({ effectiveBlock: 1 })
  })

  it('distinguishes Gate 53 counter 999 from Gate 54 counter 999', () => {
    const gate53 = referenceRngVectors.skillPredictions[5]
    const gate54 = referenceRngVectors.skillPredictions[6]
    expect(predictReferenceSkills(gate53)).toMatchObject({ effectiveBlock: 0 })
    expect(predictReferenceSkills(gate54)).toMatchObject({ effectiveBlock: 999 })
    expect(predictReferenceSkills(gate53)).not.toEqual(predictReferenceSkills(gate54))
  })

  it('uses the same pure stream prediction for conversion and Reset Skills contexts', () => {
    const input = referenceRngVectors.skillPredictions[0]
    const conversionResult = predictReferenceSkills(input)
    const resetSkillsResult = predictReferenceSkills({ ...input })
    expect(resetSkillsResult).toEqual(conversionResult)
  })

  it('is deterministic and handles a large counter without retaining prior blocks', () => {
    const input = {
      baseSeed: 8524433,
      weaponTypeId: 'weapon.insect_glaive',
      elementId: 'element.thunder',
      counterGate: REFERENCE_SKILL_COUNTER_GATE_THRESHOLD,
      skillCounter: 5000,
    }
    expect(predictReferenceSkills(input)).toEqual(predictReferenceSkills(input))
    expect(predictReferenceSkills(input).effectiveBlock).toBe(5000)
  })

  it('resolves every live-game observed Skill display name to its fixture semantic ID', () => {
    const master = verifiedMaster()
    for (const observation of gameVerifiedSkillIdentificationVector.observations) {
      expect(master.seriesSkills.find(({ id }) => id === observation.seriesSkillId)?.displayNameJa)
        .toBe(observation.observedSeriesDisplayNameJa)
      expect(master.groupSkills.find(({ id }) => id === observation.groupSkillId)?.displayNameJa)
        .toBe(observation.observedGroupDisplayNameJa)
    }
  })

  it('predicts each live-game observation from its own Skill Counter block', () => {
    const live = gameVerifiedSkillIdentificationVector
    for (const observation of live.observations) {
      expect(predictReferenceSkills({
        baseSeed: live.baseSeed,
        weaponTypeId: live.weaponTypeId,
        elementId: live.elementId,
        skillCounter: observation.skillCounter,
        counterGate: REFERENCE_SKILL_COUNTER_GATE_THRESHOLD,
      })).toMatchObject({
        seriesSkillId: observation.seriesSkillId,
        groupSkillId: observation.groupSkillId,
        effectiveBlock: observation.skillCounter,
      })
    }
  })

  it('rejects invalid counter inputs and unknown semantic stream inputs', () => {
    const input = referenceRngVectors.skillPredictions[0]
    expect(() => predictReferenceSkills({ ...input, skillCounter: -1 })).toThrow(RangeError)
    expect(() => predictReferenceSkills({ ...input, skillCounter: 1.5 })).toThrow(RangeError)
    expect(() => predictReferenceSkills({ ...input, skillCounter: Number.MAX_SAFE_INTEGER + 1 })).toThrow(RangeError)
    expect(() => predictReferenceSkills({ ...input, counterGate: -1 })).toThrow(RangeError)
    expect(() => predictReferenceSkills({ ...input, weaponTypeId: 'weapon.unknown' })).toThrow(RangeError)
    expect(() => predictReferenceSkills({ ...input, elementId: 'element.unknown' })).toThrow(RangeError)
  })
})
