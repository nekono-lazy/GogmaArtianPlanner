import { describe, expect, it } from 'vitest'
import type { OwnedGogmaArtianWeapon, OwnedNormalArtianWeapon, OwnedWeapon, TargetWeapon } from '../models/publicTypes'
import { createRestorationBonusSet, createValidOwnedWeapon, createValidTargetWeapon, DOMAIN_FIXTURE_TIME, ownedWeaponId } from '../../test/fixtures/domainData'
import { targetEvaluationMaster } from '../../test/fixtures/targetEvaluation'
import { findOwnedIdealWeaponsForTarget, isOwnedIdealForTarget } from './ownedIdealTarget'

/**
 * The owned Ideal judgement of `docs/SEARCH_SPEC.md` 5.5.5 / `docs/UI_FLOW.md`
 * 8.2: actual performance through `satisfiesIdealTarget()` only, never status or
 * protection, on a Gogma weapon of the Target's weapon type and element.
 */

function idealGogma(id: string, patch: Partial<OwnedGogmaArtianWeapon> = {}): OwnedGogmaArtianWeapon {
  return {
    ...createValidOwnedWeapon(ownedWeaponId(id)),
    name: id,
    status: 'unclassified',
    isProtected: false,
    // Reordered slots: Ideal equality is a multiset comparison.
    restorationBonuses: [...createRestorationBonusSet()].reverse() as OwnedWeapon['restorationBonuses'],
    ...patch,
  }
}

function target(): TargetWeapon {
  return createValidTargetWeapon()
}

describe('isOwnedIdealForTarget', () => {
  it('accepts a Gogma weapon whose bonuses, scope and Skills meet the Ideal condition', () => {
    expect(isOwnedIdealForTarget(target(), idealGogma('owned.ideal'), targetEvaluationMaster)).toBe(true)
  })

  it('never treats a Normal weapon as an owned Ideal', () => {
    const normal: OwnedNormalArtianWeapon = {
      id: ownedWeaponId('owned.normal'),
      kind: 'normal',
      name: 'normal',
      weaponTypeId: 'weapon.fixture.a',
      elementId: 'element.fixture.a',
      rarity: 8,
      restorationBonuses: createRestorationBonusSet(),
      restorationBonusScope: 'normal_artian',
      seriesSkillId: null,
      groupSkillId: null,
      status: null,
      isProtected: false,
      executionInProgress: null,
      memo: null,
      createdAt: DOMAIN_FIXTURE_TIME,
      updatedAt: DOMAIN_FIXTURE_TIME,
    }
    expect(isOwnedIdealForTarget(target(), normal, targetEvaluationMaster)).toBe(false)
  })

  it('rejects a Gogma still holding normal-scope slots, even with matching labels', () => {
    expect(isOwnedIdealForTarget(target(), idealGogma('owned.normal-scope', { restorationBonusScope: 'normal_artian' }), targetEvaluationMaster)).toBe(false)
  })

  it('rejects a weapon type or element mismatch', () => {
    expect(isOwnedIdealForTarget(target(), idealGogma('owned.type', { weaponTypeId: 'weapon.fixture.b' }), targetEvaluationMaster)).toBe(false)
    expect(isOwnedIdealForTarget(target(), idealGogma('owned.element', { elementId: 'element.fixture.b' }), targetEvaluationMaster)).toBe(false)
  })

  it('rejects a bonus or Skill difference', () => {
    const bonuses = createRestorationBonusSet()
    bonuses[0] = { bonusTypeId: 'bonus_type.fixture.attack', bonusRankId: 'bonus_rank.fixture.middle' }
    expect(isOwnedIdealForTarget(target(), idealGogma('owned.bonus', { restorationBonuses: bonuses }), targetEvaluationMaster)).toBe(false)
    expect(isOwnedIdealForTarget(target(), idealGogma('owned.skill', { seriesSkillId: 'series_skill.fixture.z' }), targetEvaluationMaster)).toBe(false)
  })

  it.each(['unclassified', 'practical', 'ideal'] as const)('judges performance whatever the status (%s)', (status) => {
    expect(isOwnedIdealForTarget(target(), idealGogma('owned.status', { status }), targetEvaluationMaster)).toBe(true)
  })

  it('does not exclude a protected weapon from the judgement', () => {
    expect(isOwnedIdealForTarget(target(), idealGogma('owned.protected', { isProtected: true }), targetEvaluationMaster)).toBe(true)
  })
})

describe('findOwnedIdealWeaponsForTarget', () => {
  it('returns every owned Ideal in name-then-ID order whatever the input order', () => {
    const weapons: OwnedWeapon[] = [
      idealGogma('owned.c', { name: 'B' }),
      idealGogma('owned.b', { name: 'B' }),
      idealGogma('owned.skip', { seriesSkillId: 'series_skill.fixture.z' }),
      idealGogma('owned.a', { name: 'A', isProtected: true, status: 'ideal' }),
    ]
    const ordered = findOwnedIdealWeaponsForTarget(target(), weapons, targetEvaluationMaster).map(({ id }) => id)
    expect(ordered).toEqual(['owned.a', 'owned.b', 'owned.c'])
    expect(findOwnedIdealWeaponsForTarget(target(), [...weapons].reverse(), targetEvaluationMaster).map(({ id }) => id)).toEqual(ordered)
  })

  it('returns nothing when no weapon meets the Ideal condition', () => {
    expect(findOwnedIdealWeaponsForTarget(target(), [idealGogma('owned.skip', { groupSkillId: null, seriesSkillId: null })], targetEvaluationMaster)).toEqual([])
  })
})
