import { describe, expect, it } from 'vitest'
import type { RestorationBonusSet } from '../../models/publicTypes'
import { loadMasterData } from '../../master/loadMasterData'
import { UnavailableRngEngine } from '../unavailableRngEngine'
import { UnsupportedRngInputError } from '../rngEngine'
import { gameVerifiedBowElementalNormalVectors } from '../../../test/fixtures/gameVerifiedNormalVectors'
import { gameVerifiedGogmaKeepVector, gameVerifiedGogmaResetVectors } from '../../../test/fixtures/gameVerifiedGogmaVectors'
import { gameVerifiedSkillIdentificationVector } from '../../../test/fixtures/gameVerifiedSkillVectors'
import { referenceRngVectors } from '../../../test/fixtures/referenceRngVectors'
import { predictGameAdjustedGogmaReset, predictReferenceGogmaKeep } from './gogmaPrediction'
import { predictGameVerifiedNormalArtian } from './normalPrediction'
import { ProductionRngEngine, PRODUCTION_RNG_ENGINE_VERSION } from './productionRngEngine'
import { predictReferenceSkills } from './skillPrediction'

function master() {
  const result = loadMasterData()
  if (!result.ok) throw new Error(JSON.stringify(result.issues))
  return {
    weaponBonusDefinitions: result.data.weaponBonusDefinitions,
    weaponTypes: result.data.weaponTypes,
    bonusRanks: result.data.bonusRanks,
    elements: result.data.elements,
    bonusTypes: result.data.bonusTypes,
    artianBonusTypeMappings: result.data.artianBonusTypeMappings,
  }
}

describe('ProductionRngEngine facade', () => {
  it('advertises production operations without activating UnavailableRngEngine', () => {
    const engine = new ProductionRngEngine()
    expect(PRODUCTION_RNG_ENGINE_VERSION).toBe('production-rng:c5-e2')
    expect(engine.version).toBe(PRODUCTION_RNG_ENGINE_VERSION)
    expect(engine.capabilities).toEqual({ supportsSeedSearch: false, supportsNormalArtianPrediction: true, supportsGogmaPrediction: true, supportsSkillPrediction: true, supportsKeepBonusesPrediction: true })
    expect(Object.values(new UnavailableRngEngine().capabilities)).toEqual([false, false, false, false, false])
  })

  it('dispatches Normal, Skill, Reset, and Keep to their production predictors', () => {
    const engine = new ProductionRngEngine(); const inputMaster = master()
    const normal = gameVerifiedBowElementalNormalVectors[0]!
    expect(engine.predictNormalArtian({ ...normal, baseSeed: String(normal.baseSeed), master: inputMaster })).toEqual(predictGameVerifiedNormalArtian(normal))
    const skill = referenceRngVectors.skillPredictions[0]!
    const { counterGate: _skillGate, ...skillDomainInput } = skill
    expect(engine.predictSkills({ ...skillDomainInput, baseSeed: String(skill.baseSeed), master: inputMaster })).toEqual({ seriesSkillId: predictReferenceSkills(skill).seriesSkillId, groupSkillId: predictReferenceSkills(skill).groupSkillId })
    const reset = gameVerifiedGogmaResetVectors[0]!
    const { counterGate: _resetGate, ...resetDomainInput } = reset
    expect(engine.predictGogmaBonus({ ...resetDomainInput, baseSeed: String(reset.baseSeed), operation: { type: 'reset_bonuses' }, master: inputMaster })).toEqual(predictGameAdjustedGogmaReset(reset, inputMaster).bonuses)
    const keep = gameVerifiedGogmaKeepVector
    const { counterGate: _keepGate, ...keepDomainInput } = keep
    expect(engine.predictGogmaBonus({ ...keepDomainInput, baseSeed: String(keep.baseSeed), operation: { type: 'keep_bonuses', currentBonuses: keep.currentBonuses }, master: inputMaster })).toEqual(predictReferenceGogmaKeep(keep).bonuses)
    void _skillGate; void _resetGate; void _keepGate
  })

  it('uses active-branch representatives for Skill, Reset, and Keep without caller Gate input', () => {
    const engine = new ProductionRngEngine(); const inputMaster = master()
    for (const vector of referenceRngVectors.skillPredictions.filter(({ counterGate }) => counterGate >= 54).slice(0, 4)) {
      const { counterGate: _gate, ...domainInput } = vector
      const reference = predictReferenceSkills({ ...vector, counterGate: 54 })
      expect(engine.predictSkills({ ...domainInput, baseSeed: String(vector.baseSeed), master: inputMaster }))
        .toEqual({
          seriesSkillId: reference.seriesSkillId,
          groupSkillId: reference.groupSkillId,
        })
      void _gate
    }
    const reset = gameVerifiedGogmaResetVectors[0]!
    const { counterGate: _resetGate, ...resetInput } = reset
    expect(engine.predictGogmaBonus({ ...resetInput, baseSeed: String(reset.baseSeed), operation: { type: 'reset_bonuses' }, master: inputMaster }))
      .toEqual(predictGameAdjustedGogmaReset({ ...reset, counterGate: 35 }, inputMaster).bonuses)
    const keep = gameVerifiedGogmaKeepVector
    const { counterGate: _keepGate, ...keepInput } = keep
    expect(engine.predictGogmaBonus({ ...keepInput, baseSeed: String(keep.baseSeed), operation: { type: 'keep_bonuses', currentBonuses: keep.currentBonuses }, master: inputMaster }))
      .toEqual(predictReferenceGogmaKeep({ ...keep, counterGate: 35 }).bonuses)
    void _resetGate; void _keepGate
  })

  it('uses only caller supplied Reset availability and reports unsupported inputs', () => {
    const engine = new ProductionRngEngine(); const inputMaster = master(); const reset = gameVerifiedGogmaResetVectors[0]!
    const unavailable = { ...inputMaster, weaponBonusDefinitions: [] }
    expect(engine.getPredictionSupport({ type: 'gogma_reset', weaponTypeId: reset.weaponTypeId, elementId: reset.elementId, master: unavailable })).toEqual({ supported: false, reason: 'no_available_reset_candidates' })
    expect(() => engine.predictGogmaBonus({ ...reset, baseSeed: String(reset.baseSeed), operation: { type: 'reset_bonuses' }, master: unavailable })).toThrow(UnsupportedRngInputError)
    expect(engine.getPredictionSupport({ type: 'normal_artian', weaponTypeId: 'weapon.great_sword', elementId: 'element.fire', rarity: 8 })).toEqual({ supported: false, reason: 'normal_pool_unverified' })
    expect(engine.getPredictionSupport({ type: 'gogma_keep', weaponTypeId: gameVerifiedGogmaKeepVector.weaponTypeId, elementId: gameVerifiedGogmaKeepVector.elementId, currentBonuses: [{ bonusTypeId: 'bonus_type.unknown', bonusRankId: 'bonus_rank.base' }, ...gameVerifiedGogmaKeepVector.currentBonuses.slice(1)] as never, master: inputMaster })).toEqual({ supported: false, reason: 'unsupported_current_bonus' })
  })

  it('rethrows unexpected support errors and verifies Gogma adapter coverage before prediction', () => {
    const engine = new ProductionRngEngine(); const inputMaster = master(); const reset = gameVerifiedGogmaResetVectors[0]!; const keep = gameVerifiedGogmaKeepVector
    expect(engine.getPredictionSupport({ type: 'gogma_reset', weaponTypeId: reset.weaponTypeId, elementId: reset.elementId, master: inputMaster })).toEqual({ supported: true })
    expect(engine.getPredictionSupport({ type: 'gogma_keep', weaponTypeId: keep.weaponTypeId, elementId: keep.elementId, currentBonuses: keep.currentBonuses, master: inputMaster })).toEqual({ supported: true })
    expect(() => engine.getPredictionSupport({ type: 'gogma_reset', weaponTypeId: reset.weaponTypeId, elementId: reset.elementId, master: { ...inputMaster, bonusTypes: {} as never } })).toThrow(TypeError)
  })

  /**
   * Keep reads only the slot family, resolved from the bonus type alone with a
   * Normal-side type normalized through the Master mapping, so known five slots
   * of either scope are supported and the tier is never consulted
   * (`docs/RNG_SPEC.md` 6.1, `docs/SEARCH_SPEC.md` 5.9).
   */
  describe('Keep current input coverage from either scope', () => {
    const keepSupport = (
      currentBonuses: unknown,
      inputMaster: ReturnType<typeof master> | Record<string, unknown> = master(),
      weaponTypeId = 'weapon.long_sword',
      elementId = 'element.fire',
    ) => new ProductionRngEngine().getPredictionSupport({
      type: 'gogma_keep',
      weaponTypeId,
      elementId,
      currentBonuses: currentBonuses as never,
      master: inputMaster as never,
    })
    const bonus = (bonusTypeId: string, bonusRankId: string) => ({ bonusTypeId, bonusRankId })
    const repeated = (bonusTypeId: string, bonusRankId: string) =>
      Array.from({ length: 5 }, () => bonus(bonusTypeId, bonusRankId))
    const inheritedLongSword = () => [
      bonus('bonus_type.attack', 'bonus_rank.base'),
      bonus('bonus_type.attack', 'bonus_rank.base'),
      bonus('bonus_type.affinity', 'bonus_rank.base'),
      bonus('bonus_type.element', 'bonus_rank.base'),
      bonus('bonus_type.normal_sharpness', 'bonus_rank.base'),
    ]

    it('supports an inherited normal-scope current set through the Master mapping', () => {
      expect(keepSupport(inheritedLongSword())).toEqual({ supported: true })
      expect(keepSupport([
        bonus('bonus_type.attack', 'bonus_rank.base'),
        bonus('bonus_type.affinity', 'bonus_rank.base'),
        bonus('bonus_type.normal_capacity', 'bonus_rank.base'),
        bonus('bonus_type.normal_capacity', 'bonus_rank.base'),
        bonus('bonus_type.attack', 'bonus_rank.base'),
      ], master(), 'weapon.light_bowgun', 'element.fire')).toEqual({ supported: true })
    })

    it('supports a Gogma-scope current set exactly as before', () => {
      expect(keepSupport(gameVerifiedGogmaKeepVector.currentBonuses, master(), gameVerifiedGogmaKeepVector.weaponTypeId, gameVerifiedGogmaKeepVector.elementId))
        .toEqual({ supported: true })
    })

    it('never consults the tier: any rank of a known family is readable', () => {
      expect(keepSupport(repeated('bonus_type.element', 'bonus_rank.iii'))).toEqual({ supported: true })
      expect(keepSupport(repeated('bonus_type.attack', 'bonus_rank.fixture.unknown'))).toEqual({ supported: true })
      // Whether such a rank is a legal persisted value is Master / Domain
      // validation, not Keep RNG.
    })

    it('rejects a bonus type outside every Keep family, a wrong slot count, and a Master without the mapping', () => {
      expect(keepSupport(repeated('bonus_type.unknown', 'bonus_rank.ex')))
        .toEqual({ supported: false, reason: 'unsupported_current_bonus' })
      expect(keepSupport(repeated('bonus_type.attack', 'bonus_rank.ii').slice(0, 4)))
        .toEqual({ supported: false, reason: 'unsupported_current_bonus' })
      const { artianBonusTypeMappings: _mappings, ...withoutMapping } = master()
      void _mappings
      expect(keepSupport(inheritedLongSword(), withoutMapping))
        .toEqual({ supported: false, reason: 'master_data_unavailable' })
    })

    it('predicts the game-verified Keep result from the same layout spelled as inherited normal-scope slots', () => {
      const engine = new ProductionRngEngine()
      const keep = gameVerifiedGogmaKeepVector
      // attack / affinity / affinity / element / element in normal-scope spelling.
      const inherited = [
        bonus('bonus_type.attack', 'bonus_rank.base'),
        bonus('bonus_type.affinity', 'bonus_rank.base'),
        bonus('bonus_type.affinity', 'bonus_rank.base'),
        bonus('bonus_type.element', 'bonus_rank.base'),
        bonus('bonus_type.element', 'bonus_rank.base'),
      ] as never as RestorationBonusSet
      const predicted = engine.predictGogmaBonus({
        baseSeed: String(keep.baseSeed),
        weaponTypeId: keep.weaponTypeId,
        elementId: keep.elementId,
        gogmaCounter: keep.gogmaCounter,
        operation: { type: 'keep_bonuses', currentBonuses: inherited },
        master: master(),
      })
      expect(predicted).toEqual(keep.bonuses)
    })

    it('maps a Normal-side Sharpness slot onto the Gogma Sharpness / Capacity family in place', () => {
      const engine = new ProductionRngEngine()
      const currentBonuses = inheritedLongSword() as never as RestorationBonusSet
      const predicted = engine.predictGogmaBonus({
        baseSeed: String(gameVerifiedGogmaKeepVector.baseSeed),
        weaponTypeId: 'weapon.long_sword',
        elementId: 'element.fire',
        gogmaCounter: gameVerifiedGogmaKeepVector.gogmaCounter,
        operation: { type: 'keep_bonuses', currentBonuses },
        master: master(),
      })
      expect(predicted.map(({ bonusTypeId }) => bonusTypeId)).toEqual([
        'bonus_type.attack',
        'bonus_type.attack',
        'bonus_type.affinity',
        'bonus_type.element',
        'bonus_type.gogma_sharpness_capacity',
      ])
      // The same families in Gogma-tier spelling give the identical result.
      const gogmaSpelling = [
        bonus('bonus_type.attack', 'bonus_rank.ii'),
        bonus('bonus_type.attack', 'bonus_rank.ex'),
        bonus('bonus_type.affinity', 'bonus_rank.iii'),
        bonus('bonus_type.element', 'bonus_rank.ii'),
        bonus('bonus_type.gogma_sharpness_capacity', 'bonus_rank.ex'),
      ] as never as RestorationBonusSet
      expect(engine.predictGogmaBonus({
        baseSeed: String(gameVerifiedGogmaKeepVector.baseSeed),
        weaponTypeId: 'weapon.long_sword',
        elementId: 'element.fire',
        gogmaCounter: gameVerifiedGogmaKeepVector.gogmaCounter,
        operation: { type: 'keep_bonuses', currentBonuses: gogmaSpelling },
        master: master(),
      })).toEqual(predicted)
    })

    it('still fails closed on an unreadable current input instead of guessing', () => {
      expect(() => new ProductionRngEngine().predictGogmaBonus({
        baseSeed: String(gameVerifiedGogmaKeepVector.baseSeed),
        weaponTypeId: gameVerifiedGogmaKeepVector.weaponTypeId,
        elementId: gameVerifiedGogmaKeepVector.elementId,
        gogmaCounter: gameVerifiedGogmaKeepVector.gogmaCounter,
        operation: {
          type: 'keep_bonuses',
          currentBonuses: repeated('bonus_type.unknown', 'bonus_rank.base') as never as RestorationBonusSet,
        },
        master: master(),
      })).toThrow(UnsupportedRngInputError)
    })
  })

  it('advances only the contracted counters and rejects invalid or overflowing counters', () => {
    const engine = new ProductionRngEngine()
    expect(engine.advanceGogmaCounter(7, { type: 'reset_bonuses' })).toBe(8)
    expect(engine.advanceGogmaCounter(7, { type: 'keep_bonuses' })).toBe(8)
    expect(engine.advanceSkillCounter(7, { type: 'convert_normal_to_gogma' })).toBe(8)
    expect(engine.advanceSkillCounter(7, { type: 'reset_skills' })).toBe(8)
    expect(engine.advanceNormalCounter(7, { type: 'create_normal_artian', count: 1 })).toBe(8)
    expect(engine.advanceNormalCounter(7, { type: 'create_normal_artian', count: 2 })).toBe(9)
    for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER]) {
      expect(() => engine.advanceGogmaCounter(value, { type: 'reset_bonuses' })).toThrow(RangeError)
      expect(() => engine.advanceSkillCounter(value, { type: 'reset_skills' })).toThrow(RangeError)
    }
    expect(() => engine.advanceNormalCounter(-1, { type: 'create_normal_artian', count: 1 })).toThrow(RangeError)
    expect(() => engine.advanceNormalCounter(1.5, { type: 'create_normal_artian', count: 1 })).toThrow(RangeError)
    expect(() => engine.advanceNormalCounter(Number.MAX_SAFE_INTEGER, { type: 'create_normal_artian', count: 1 })).toThrow(RangeError)
  })

  it('reproduces every live-game observed Skill result without caller Gate input', () => {
    const engine = new ProductionRngEngine(); const inputMaster = master()
    const live = gameVerifiedSkillIdentificationVector
    let expectedCounter: number = live.startSkillCounter
    for (const observation of live.observations) {
      expect(observation.skillCounter).toBe(expectedCounter)
      expect(engine.predictSkills({
        baseSeed: String(live.baseSeed),
        weaponTypeId: live.weaponTypeId,
        elementId: live.elementId,
        skillCounter: observation.skillCounter,
        master: inputMaster,
      })).toEqual({
        seriesSkillId: observation.seriesSkillId,
        groupSkillId: observation.groupSkillId,
      })
      expectedCounter = engine.advanceSkillCounter(
        expectedCounter,
        observation.operation === 'convert_normal_to_gogma'
          ? { type: 'convert_normal_to_gogma' }
          : { type: 'reset_skills' },
      )
    }
  })

  it('normalizes decimal, hex, boundaries, and values above Number.MAX_SAFE_INTEGER without precision loss', () => {
    const engine = new ProductionRngEngine()
    expect(engine.normalizeSeed('0')).toBe('0')
    expect(engine.normalizeSeed('0x5f5e0ff')).toBe('99999999')
    expect(engine.normalizeSeed('100000000')).toBe('0')
    expect(engine.normalizeSeed('9007199254740993')).toBe('54740993')
    expect(engine.normalizeSeed('0xffffffffffffffff')).toBe('9551615')
  })
})
