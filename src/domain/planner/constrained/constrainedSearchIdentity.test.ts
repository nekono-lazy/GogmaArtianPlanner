import { describe, expect, it } from 'vitest'
import {
  CONSTRAINED_ROUTE_POLICY_VERSION,
  createConstrainedSearchIdentity,
} from './constrainedSearchIdentity'
import { PlannerMaterializationError } from '../replacement/plannerMaterializationErrors'
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
    ).toThrowError(PlannerMaterializationError)
  })
})

/*
 * The origin normalization itself - collection order, irrelevant Targets and
 * weapons, non-semantic fields, the semantic RNG / weapon / Target changes - is
 * the shared primitive of `../replacement/plannerSearchOrigin.test.ts`
 * (Phase 6-B2a). Below, only its reach into this legacy identity and the
 * identity's own composition are checked.
 */

describe('constrained search identity: the shared normalization reaches it', () => {
  it('ignores OwnedWeapon array order', () => {
    const base = originWithWeapons()
    const reordered = createConstrainedSearchOrigin({
      ownedWeapons: [...base.ownedWeapons].reverse(),
    })
    expect(identity(reordered)).toBe(identity(base))
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
      'Gogma Counter',
      (origin: ConstrainedSearchOrigin) => {
        origin.rngState.gogmaCounter.value = 99
      },
    ],
    [
      'a relevant OwnedWeapon protection state',
      (origin: ConstrainedSearchOrigin) => {
        origin.ownedWeapons[0].isProtected = true
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
