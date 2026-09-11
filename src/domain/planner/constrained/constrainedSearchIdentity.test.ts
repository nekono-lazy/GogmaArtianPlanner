import { describe, expect, it } from 'vitest'
import {
  CONSTRAINED_ROUTE_POLICY_VERSION,
  createConstrainedSearchIdentity,
  resolveConstrainedTarget,
} from './constrainedSearchIdentity'
import { ConstrainedMaterializationError } from './constrainedMaterializationErrors'
import type { ConstrainedSearchOrigin } from '../../search'
import {
  constrainedBounds,
  constrainedTarget,
  createConstrainedSearchOrigin,
  gogmaWeapon,
  normalWeapon,
} from '../../../test/fixtures/constrainedEnumeration'
import { targetWeaponId } from '../../../test/fixtures/domainData'

function identity(
  origin: ConstrainedSearchOrigin,
  bounds = constrainedBounds(),
): string {
  return createConstrainedSearchIdentity({
    origin,
    targetWeaponId: origin.targetWeapons[0].id,
    bounds,
  })
}

function originWithWeapons(): ConstrainedSearchOrigin {
  return createConstrainedSearchOrigin({
    ownedWeapons: [
      gogmaWeapon('owned.constrained.gogma-a'),
      normalWeapon('owned.constrained.normal-a'),
    ],
  })
}

describe('constrained search identity composition', () => {
  it('is deterministic for the same semantic input', () => {
    expect(identity(originWithWeapons())).toBe(identity(originWithWeapons()))
  })

  it('carries a versioned route policy token separate from the RNG Engine version', () => {
    expect(CONSTRAINED_ROUTE_POLICY_VERSION).toBe('b8-constrained-route-policy:v1')
  })

  it('takes no run, request, or Clock input at all', () => {
    const origin = originWithWeapons()
    const input = {
      origin,
      targetWeaponId: origin.targetWeapons[0].id,
      bounds: constrainedBounds(),
    }
    expect(Object.keys(input).sort()).toEqual(['bounds', 'origin', 'targetWeaponId'])
    for (const runField of ['searchRunId', 'requestId', 'clock', 'createdAt', 'ordinal']) {
      expect(input).not.toHaveProperty(runField)
      expect(origin).not.toHaveProperty(runField)
    }
    expect(createConstrainedSearchIdentity(input)).toBe(
      createConstrainedSearchIdentity(input),
    )
  })

  it('fails closed when the Target is not part of the origin', () => {
    const origin = originWithWeapons()
    expect(() =>
      createConstrainedSearchIdentity({
        origin,
        targetWeaponId: targetWeaponId('target.fixture.missing'),
        bounds: constrainedBounds(),
      }),
    ).toThrowError(ConstrainedMaterializationError)
    expect(() =>
      resolveConstrainedTarget(origin, targetWeaponId('target.fixture.missing')),
    ).toThrowError(
      expect.objectContaining({ code: 'target_mismatch' }) as unknown as Error,
    )
  })
})

describe('constrained search identity: collection order is not semantic', () => {
  it('ignores OwnedWeapon array order', () => {
    const base = originWithWeapons()
    const reordered = createConstrainedSearchOrigin({
      ownedWeapons: [...base.ownedWeapons].reverse(),
    })
    expect(identity(reordered)).toBe(identity(base))
  })

  it('ignores Normal Counter array order and unrelated Normal Counters', () => {
    const base = originWithWeapons()
    const unrelated = {
      ...base.normalCounters[0],
      id: 'weapon.fixture.other:8',
      weaponTypeId: 'weapon.fixture.other',
      counter: 999,
    }
    const withUnrelated = createConstrainedSearchOrigin({
      ownedWeapons: base.ownedWeapons,
      normalCounters: [unrelated, ...base.normalCounters],
    })
    expect(identity(withUnrelated)).toBe(identity(base))
  })

  it('ignores other Targets kept in the origin snapshot', () => {
    const base = originWithWeapons()
    const other = { ...constrainedTarget(), id: targetWeaponId('target.fixture.b') }
    const withExtra = createConstrainedSearchOrigin({
      ownedWeapons: base.ownedWeapons,
      extraTargetWeapons: [other],
    })
    expect(identity(withExtra)).toBe(identity(base))
  })

  it('ignores an OwnedWeapon that cannot be a Route source for this Target', () => {
    const base = originWithWeapons()
    const withForeign = createConstrainedSearchOrigin({
      ownedWeapons: [
        ...base.ownedWeapons,
        gogmaWeapon('owned.constrained.foreign', {
          weaponTypeId: 'weapon.fixture.other',
        }),
      ],
    })
    expect(identity(withForeign)).toBe(identity(base))
  })

  it('ignores a protected Owned Normal, which no conversion Route may consume', () => {
    const base = originWithWeapons()
    const withProtectedNormal = createConstrainedSearchOrigin({
      ownedWeapons: [
        ...base.ownedWeapons,
        normalWeapon('owned.constrained.normal-protected', { isProtected: true }),
      ],
    })
    expect(identity(withProtectedNormal)).toBe(identity(base))
  })

  it('ignores non-semantic OwnedWeapon and RngState fields', () => {
    const base = originWithWeapons()
    const renamed = createConstrainedSearchOrigin({
      ownedWeapons: base.ownedWeapons.map((weapon) => ({
        ...weapon,
        name: '別名',
        memo: 'changed',
        updatedAt: '2027-01-01T00:00:00.000Z',
      })),
    })
    renamed.rngState.baseSeed.source = 'observation'
    renamed.rngState.notes = 'changed'
    renamed.rngState.counterGate = { value: 54, isConfirmed: true, source: 'manual' }
    expect(identity(renamed)).toBe(identity(base))
  })

  it('ignores the Master subset itself, whose identity is masterDataVersion', () => {
    const base = originWithWeapons()
    const masterChanged = originWithWeapons()
    masterChanged.master.bonusRanks = [...masterChanged.master.bonusRanks].reverse()
    masterChanged.master.weaponTypes = [
      ...masterChanged.master.weaponTypes,
      { ...masterChanged.master.weaponTypes[0], id: 'weapon.fixture.unused' },
    ]
    expect(identity(masterChanged)).toBe(identity(base))

    const versionChanged = originWithWeapons()
    versionChanged.calculationContext = {
      ...versionChanged.calculationContext,
      masterDataVersion: versionChanged.calculationContext.masterDataVersion + 1,
    }
    expect(identity(versionChanged)).not.toBe(identity(base))
  })
})

describe('constrained search identity: semantic changes', () => {
  it('changes for a different TargetWeapon ID', () => {
    const origin = originWithWeapons()
    const other = { ...constrainedTarget(), id: targetWeaponId('target.fixture.b') }
    origin.targetWeapons.push(other)
    expect(
      createConstrainedSearchIdentity({
        origin,
        targetWeaponId: other.id,
        bounds: constrainedBounds(),
      }),
    ).not.toBe(identity(origin))
  })

  it.each([
    [
      'Base Seed value',
      (origin: ConstrainedSearchOrigin) => {
        origin.rngState.baseSeed.value = 'fixture-seed-other'
      },
    ],
    [
      'Base Seed confirmation',
      (origin: ConstrainedSearchOrigin) => {
        origin.rngState.baseSeed.isConfirmed = false
      },
    ],
    [
      'Gogma Counter',
      (origin: ConstrainedSearchOrigin) => {
        origin.rngState.gogmaCounter.value = 99
      },
    ],
    [
      'Skill Counter',
      (origin: ConstrainedSearchOrigin) => {
        origin.rngState.skillCounter.value = 99
      },
    ],
    [
      'the relevant Normal Counter',
      (origin: ConstrainedSearchOrigin) => {
        origin.normalCounters[0].counter = 99
      },
    ],
    [
      'the relevant Normal Counter confirmation',
      (origin: ConstrainedSearchOrigin) => {
        origin.normalCounters[0].isConfirmed = false
      },
    ],
    [
      'a relevant OwnedWeapon bonus slot',
      (origin: ConstrainedSearchOrigin) => {
        origin.ownedWeapons[0].restorationBonuses[0] = {
          bonusTypeId: 'bonus_type.fixture.utility',
          bonusRankId: 'bonus_rank.fixture.low',
        }
      },
    ],
    [
      'a relevant OwnedWeapon protection state',
      (origin: ConstrainedSearchOrigin) => {
        origin.ownedWeapons[0].isProtected = true
      },
    ],
    [
      'the Target definition',
      (origin: ConstrainedSearchOrigin) => {
        origin.targetWeapons[0].practicalBonusConditions[0].requiredExCount = 1
      },
    ],
    [
      'the CalculationContext',
      (origin: ConstrainedSearchOrigin) => {
        origin.calculationContext = {
          ...origin.calculationContext,
          appSchemaVersion: origin.calculationContext.appSchemaVersion + 1,
        }
      },
    ],
  ])('changes for %s', (_label, mutate) => {
    const base = originWithWeapons()
    const changed = originWithWeapons()
    mutate(changed)
    expect(identity(changed)).not.toBe(identity(base))
  })

  it('changes when an unprotected Owned Normal conversion source is added', () => {
    const base = originWithWeapons()
    const withNormal = createConstrainedSearchOrigin({
      ownedWeapons: [
        ...base.ownedWeapons,
        normalWeapon('owned.constrained.normal-b'),
      ],
    })
    expect(identity(withNormal)).not.toBe(identity(base))
  })

  it('changes when an Owned Normal conversion source becomes protected', () => {
    const base = originWithWeapons()
    const protectedNormal = createConstrainedSearchOrigin({
      ownedWeapons: base.ownedWeapons.map((weapon) =>
        weapon.kind === 'normal' ? { ...weapon, isProtected: true } : weapon,
      ),
    })
    expect(protectedNormal.ownedWeapons.some(({ kind }) => kind === 'normal')).toBe(true)
    expect(identity(protectedNormal)).not.toBe(identity(base))
  })

  it('changes when a relevant OwnedWeapon is removed', () => {
    const base = originWithWeapons()
    const removed = createConstrainedSearchOrigin({
      ownedWeapons: [base.ownedWeapons[0]],
    })
    expect(identity(removed)).not.toBe(identity(base))
  })

  it.each([
    ['maxNormalForgeCount', { maxNormalForgeCount: 40 }],
    ['maxGogmaAdvance', { maxGogmaAdvance: 30 }],
    ['maxSkillResetCount', { maxSkillResetCount: 100 }],
    ['maxOffAxisPairEvaluations', { maxOffAxisPairEvaluations: 500 }],
  ])('changes for enumeration bound %s', (_label, override) => {
    const origin = originWithWeapons()
    expect(identity(origin, constrainedBounds(override))).not.toBe(identity(origin))
  })
})
