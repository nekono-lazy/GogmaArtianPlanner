import { describe, expect, it } from 'vitest'
import {
  findTargetsInvalidatedByOwnedWeaponChange,
  isCompatiblePreferredOwnedWeapon,
  isEligiblePreferredOwnedWeapon,
  validateTargetPreferredOwnedWeapons,
} from './preferredOwnedWeapon'
import { validateTargetWeapon } from '../models/validation'
import {
  createValidOwnedWeapon,
  createValidTargetWeapon,
  ownedWeaponId,
  targetWeaponId,
} from '../../test/fixtures/domainData'
import type {
  OwnedGogmaArtianWeapon,
  OwnedNormalArtianWeapon,
  OwnedWeapon,
  TargetWeapon,
} from '../models/publicTypes'

function compatibleGogma(id = 'owned.preferred.gogma'): OwnedGogmaArtianWeapon {
  return { ...createValidOwnedWeapon(ownedWeaponId(id)), isProtected: false }
}

function compatibleNormal(id = 'owned.preferred.normal'): OwnedNormalArtianWeapon {
  const base = createValidOwnedWeapon(ownedWeaponId(id))
  return {
    id: base.id,
    kind: 'normal',
    rarity: 8,
    name: base.name,
    weaponTypeId: base.weaponTypeId,
    elementId: base.elementId,
    restorationBonuses: base.restorationBonuses,
    restorationBonusScope: 'normal_artian',
    seriesSkillId: null,
    groupSkillId: null,
    status: null,
    isProtected: false,
    memo: null,
    createdAt: base.createdAt,
    updatedAt: base.updatedAt,
  }
}

function targetPreferring(
  id: string,
  preferredOwnedWeaponId: TargetWeapon['preferredOwnedWeaponId'],
): TargetWeapon {
  return {
    ...createValidTargetWeapon(),
    id: targetWeaponId(id),
    preferredOwnedWeaponId,
  }
}

describe('TargetWeapon.preferredOwnedWeaponId structure', () => {
  it('accepts null', () => {
    expect(validateTargetWeapon(createValidTargetWeapon()).isValid).toBe(true)
  })

  it('accepts a well-formed ID and rejects an empty one', () => {
    const target = targetPreferring('target.structure', ownedWeaponId('owned.x'))
    expect(validateTargetWeapon(target).isValid).toBe(true)
    const blank = { ...target, preferredOwnedWeaponId: '' as OwnedWeapon['id'] }
    expect(validateTargetWeapon(blank).issues.map(({ path }) => path)).toContain(
      'preferredOwnedWeaponId',
    )
  })
})

describe('validateTargetPreferredOwnedWeapons', () => {
  it('accepts a Target with no preference', () => {
    expect(
      validateTargetPreferredOwnedWeapons(
        [createValidTargetWeapon()],
        [compatibleGogma()],
      ).isValid,
    ).toBe(true)
  })

  it('accepts a compatible unprotected Gogma weapon', () => {
    const weapon = compatibleGogma()
    expect(
      validateTargetPreferredOwnedWeapons(
        [targetPreferring('target.gogma', weapon.id)],
        [weapon],
      ).isValid,
    ).toBe(true)
  })

  it('accepts a compatible unprotected Normal weapon', () => {
    const weapon = compatibleNormal()
    expect(
      validateTargetPreferredOwnedWeapons(
        [targetPreferring('target.normal', weapon.id)],
        [weapon],
      ).isValid,
    ).toBe(true)
  })

  it.each(['unclassified', 'practical', 'ideal'] as const)(
    'accepts an unprotected %s Gogma: status is not a selection condition',
    (status) => {
      const weapon = { ...compatibleGogma(), status }
      expect(
        validateTargetPreferredOwnedWeapons(
          [targetPreferring('target.status', weapon.id)],
          [weapon],
        ).isValid,
      ).toBe(true)
    },
  )

  it('rejects a missing OwnedWeapon', () => {
    const result = validateTargetPreferredOwnedWeapons(
      [targetPreferring('target.missing', ownedWeaponId('owned.absent'))],
      [],
    )
    expect(result.isValid).toBe(false)
    expect(result.issues[0].code).toBe('invalid_reference')
  })

  it('rejects a weapon type mismatch', () => {
    const weapon = { ...compatibleGogma(), weaponTypeId: 'weapon.fixture.other' }
    const result = validateTargetPreferredOwnedWeapons(
      [targetPreferring('target.type', weapon.id)],
      [weapon],
    )
    expect(result.isValid).toBe(false)
    expect(result.issues.some(({ message }) => message.includes('武器種'))).toBe(true)
  })

  it('rejects an element mismatch', () => {
    const weapon = { ...compatibleGogma(), elementId: 'element.fixture.other' }
    const result = validateTargetPreferredOwnedWeapons(
      [targetPreferring('target.element', weapon.id)],
      [weapon],
    )
    expect(result.isValid).toBe(false)
    expect(result.issues.some(({ message }) => message.includes('属性'))).toBe(true)
  })

  it('rejects a protected weapon', () => {
    const weapon = { ...compatibleGogma(), isProtected: true }
    const result = validateTargetPreferredOwnedWeapons(
      [targetPreferring('target.protected', weapon.id)],
      [weapon],
    )
    expect(result.isValid).toBe(false)
    expect(result.issues.some(({ message }) => message.includes('保護中'))).toBe(true)
  })

  it('rejects the same OwnedWeapon being preferred by two Targets', () => {
    const weapon = compatibleGogma()
    const result = validateTargetPreferredOwnedWeapons(
      [
        targetPreferring('target.first', weapon.id),
        targetPreferring('target.second', weapon.id),
      ],
      [weapon],
    )
    expect(result.isValid).toBe(false)
    expect(
      result.issues.some(({ path }) =>
        path.startsWith('targetWeapons[1].preferredOwnedWeaponId'),
      ),
    ).toBe(true)
  })

  it('accepts two Targets preferring two different weapons', () => {
    const first = compatibleGogma('owned.preferred.first')
    const second = compatibleGogma('owned.preferred.second')
    expect(
      validateTargetPreferredOwnedWeapons(
        [
          targetPreferring('target.first', first.id),
          targetPreferring('target.second', second.id),
        ],
        [first, second],
      ).isValid,
    ).toBe(true)
  })
})

describe('preferred-origin eligibility', () => {
  it('separates compatibility from protection so the UI can show the reason', () => {
    const target = createValidTargetWeapon()
    const protectedWeapon = { ...compatibleGogma(), isProtected: true }
    expect(isCompatiblePreferredOwnedWeapon(target, protectedWeapon)).toBe(true)
    expect(isEligiblePreferredOwnedWeapon(target, protectedWeapon)).toBe(false)
  })

  it('finds the Targets a protection or type change would invalidate', () => {
    const weapon = compatibleGogma()
    const holder = targetPreferring('target.holder', weapon.id)
    const unrelated = targetPreferring('target.unrelated', null)
    const targets = [holder, unrelated]

    expect(
      findTargetsInvalidatedByOwnedWeaponChange(targets, weapon.id, {
        ...weapon,
        isProtected: true,
      }).map(({ id }) => id),
    ).toEqual([holder.id])
    expect(
      findTargetsInvalidatedByOwnedWeaponChange(targets, weapon.id, {
        ...weapon,
        elementId: 'element.fixture.other',
      }).map(({ id }) => id),
    ).toEqual([holder.id])
    // An unrelated change to the same weapon breaks nothing.
    expect(
      findTargetsInvalidatedByOwnedWeaponChange(targets, weapon.id, weapon),
    ).toEqual([])
  })
})
