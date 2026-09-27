import { describe, expect, it } from 'vitest'
import type { ConstrainedSearchOrigin } from '../../search'
import {
  constrainedTarget,
  createConstrainedSearchOrigin,
  gogmaWeapon,
  normalWeapon,
} from '../../../test/fixtures/constrainedEnumeration'
import { fixture, target } from '../../../test/fixtures/plannerBeam'
import { targetWeaponId } from '../../../test/fixtures/domainData'
import { PlannerMaterializationError } from './plannerMaterializationErrors'
import {
  createPlannerStartSearchOrigin,
  normalizePlannerSearchOrigin,
  resolvePlannerSearchOriginTarget,
} from './plannerSearchOrigin'

/**
 * The shared Planner-start Search origin primitives (Phase 6-B2a). The
 * normalization is what both the Planner Alternative and the legacy B8 search
 * identity hash, so it is tested here directly; each identity's own
 * composition (route policy token, extent or bounds, CalculationContext) is
 * tested with that identity.
 */

function normalized(origin: ConstrainedSearchOrigin) {
  return normalizePlannerSearchOrigin(origin, origin.targetWeapons[0])
}

function originWithWeapons(): ConstrainedSearchOrigin {
  return createConstrainedSearchOrigin({
    ownedWeapons: [
      gogmaWeapon('owned.constrained.gogma-a'),
      normalWeapon('owned.constrained.normal-a'),
    ],
  })
}

describe('Planner-start Search origin', () => {
  it('is a structured clone of exactly the Planner input Search / RNG fields', () => {
    const { input } = fixture([target('target.origin.a')], [], [])
    const origin = createPlannerStartSearchOrigin(input)
    expect(Object.keys(origin).sort()).toEqual([
      'calculationContext',
      'master',
      'normalCounters',
      'ownedWeapons',
      'rngState',
      'targetWeapons',
    ])
    expect(origin.rngState).toEqual(input.rngState)
    expect(origin.rngState).not.toBe(input.rngState)
    expect(origin.targetWeapons).toEqual(input.targetWeapons)
    expect(origin.targetWeapons).not.toBe(input.targetWeapons)
  })

  it('resolves the origin Target and fails closed for a Target outside it', () => {
    const origin = originWithWeapons()
    expect(resolvePlannerSearchOriginTarget(origin, origin.targetWeapons[0].id))
      .toBe(origin.targetWeapons[0])
    expect(() =>
      resolvePlannerSearchOriginTarget(origin, targetWeaponId('target.fixture.missing')),
    ).toThrowError(PlannerMaterializationError)
    expect(() =>
      resolvePlannerSearchOriginTarget(origin, targetWeaponId('target.fixture.missing')),
    ).toThrowError(
      expect.objectContaining({ code: 'target_mismatch' }) as unknown as Error,
    )
  })
})

describe('Planner-start Search origin normalization: collection order is not semantic', () => {
  it('is deterministic for the same semantic input', () => {
    expect(normalized(originWithWeapons())).toEqual(normalized(originWithWeapons()))
  })

  it('ignores OwnedWeapon array order', () => {
    const base = originWithWeapons()
    const reordered = createConstrainedSearchOrigin({
      ownedWeapons: [...base.ownedWeapons].reverse(),
    })
    expect(normalized(reordered)).toEqual(normalized(base))
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
    expect(normalized(withUnrelated)).toEqual(normalized(base))
  })

  it('ignores other Targets kept in the origin snapshot', () => {
    const base = originWithWeapons()
    const other = { ...constrainedTarget(), id: targetWeaponId('target.fixture.b') }
    const withExtra = createConstrainedSearchOrigin({
      ownedWeapons: base.ownedWeapons,
      extraTargetWeapons: [other],
    })
    expect(normalized(withExtra)).toEqual(normalized(base))
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
    expect(normalized(withForeign)).toEqual(normalized(base))
  })

  it('ignores a protected Owned Normal, which no conversion Route may consume', () => {
    const base = originWithWeapons()
    const withProtectedNormal = createConstrainedSearchOrigin({
      ownedWeapons: [
        ...base.ownedWeapons,
        normalWeapon('owned.constrained.normal-protected', { isProtected: true }),
      ],
    })
    expect(normalized(withProtectedNormal)).toEqual(normalized(base))
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
    expect(normalized(renamed)).toEqual(normalized(base))
  })

  it('ignores the Master subset itself and the CalculationContext', () => {
    const base = originWithWeapons()
    const masterChanged = originWithWeapons()
    masterChanged.master.bonusRanks = [...masterChanged.master.bonusRanks].reverse()
    masterChanged.master.weaponTypes = [
      ...masterChanged.master.weaponTypes,
      { ...masterChanged.master.weaponTypes[0], id: 'weapon.fixture.unused' },
    ]
    masterChanged.calculationContext = {
      ...masterChanged.calculationContext,
      masterDataVersion: masterChanged.calculationContext.masterDataVersion + 1,
    }
    // Master identity is `CalculationContext.masterDataVersion`, which each
    // search identity composes on its own, never the normalized origin.
    expect(normalized(masterChanged)).toEqual(normalized(base))
  })
})

describe('Planner-start Search origin normalization: semantic changes', () => {
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
  ])('changes for %s', (_label, mutate) => {
    const base = originWithWeapons()
    const changed = originWithWeapons()
    mutate(changed)
    expect(normalized(changed)).not.toEqual(normalized(base))
  })

  it('changes when an unprotected Owned Normal conversion source is added', () => {
    const base = originWithWeapons()
    const withNormal = createConstrainedSearchOrigin({
      ownedWeapons: [
        ...base.ownedWeapons,
        normalWeapon('owned.constrained.normal-b'),
      ],
    })
    expect(normalized(withNormal)).not.toEqual(normalized(base))
  })

  it('changes when an Owned Normal conversion source becomes protected', () => {
    const base = originWithWeapons()
    const protectedNormal = createConstrainedSearchOrigin({
      ownedWeapons: base.ownedWeapons.map((weapon) =>
        weapon.kind === 'normal' ? { ...weapon, isProtected: true } : weapon,
      ),
    })
    expect(protectedNormal.ownedWeapons.some(({ kind }) => kind === 'normal')).toBe(true)
    expect(normalized(protectedNormal)).not.toEqual(normalized(base))
  })

  it('changes when a relevant OwnedWeapon is removed', () => {
    const base = originWithWeapons()
    const removed = createConstrainedSearchOrigin({
      ownedWeapons: [base.ownedWeapons[0]],
    })
    expect(normalized(removed)).not.toEqual(normalized(base))
  })
})
