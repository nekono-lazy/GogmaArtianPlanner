import { describe, expect, it } from 'vitest'
import type {
  BuildCandidate,
  OwnedWeapon,
  OwnedWeaponId,
  TargetWeapon,
} from '../../domain/models/publicTypes'
import {
  createValidBuildCandidate,
  createValidOwnedWeapon,
  createValidTargetWeapon,
  ownedWeaponId,
} from '../../test/fixtures/domainData'
import {
  candidateRouteOriginLabel,
  describePreferredOwnedWeaponNotice,
} from './preferredOwnedWeaponNotice'

const weaponA = ownedWeaponId('owned.fixture.preferred')
const weaponB = ownedWeaponId('owned.fixture.other')

function owned(id: OwnedWeaponId, name: string): OwnedWeapon {
  return { ...createValidOwnedWeapon(id), name, isProtected: false }
}

const ownedWeapons = [owned(weaponA, '武器A'), owned(weaponB, '武器B')]

function targetPreferring(preferredOwnedWeaponId: OwnedWeaponId | null): TargetWeapon {
  return { ...createValidTargetWeapon(), preferredOwnedWeaponId }
}

/** The fixture new-Normal Route, or an existing-Gogma Reset Skills Route from `source`. */
function candidateFrom(source: OwnedWeaponId | null): BuildCandidate {
  const candidate = createValidBuildCandidate()
  if (source === null) return candidate
  candidate.route = {
    kind: 'existing_gogma_reset_skills',
    sourceOwnedWeaponId: source,
    operations: [
      { type: 'reset_skills', sourceOwnedWeaponId: source, skillCounterBefore: 8, skillCounterAfter: 9 },
    ],
  }
  return candidate
}

describe('describePreferredOwnedWeaponNotice', () => {
  it('says nothing when the Target has no preferred owned weapon', () => {
    expect(describePreferredOwnedWeaponNotice(candidateFrom(null), targetPreferring(null), ownedWeapons)).toBeNull()
    expect(describePreferredOwnedWeaponNotice(candidateFrom(weaponB), targetPreferring(null), ownedWeapons)).toBeNull()
    expect(describePreferredOwnedWeaponNotice(candidateFrom(null), null, ownedWeapons)).toBeNull()
  })

  it('says nothing when the Route starts from the preferred weapon', () => {
    expect(describePreferredOwnedWeaponNotice(candidateFrom(weaponA), targetPreferring(weaponA), ownedWeapons)).toBeNull()
  })

  it('names both weapons when the Route starts from another owned weapon', () => {
    const notice = describePreferredOwnedWeaponNotice(candidateFrom(weaponB), targetPreferring(weaponA), ownedWeapons)
    expect(notice).toEqual({
      preferredWeaponName: '武器A',
      routeOrigin: { kind: 'owned_weapon', weaponName: '武器B' },
    })
    expect(candidateRouteOriginLabel(notice!.routeOrigin)).toBe('所持武器「武器B」')
  })

  it('names the new Normal Artian when the Route forges one', () => {
    const notice = describePreferredOwnedWeaponNotice(candidateFrom(null), targetPreferring(weaponA), ownedWeapons)
    expect(notice).toEqual({ preferredWeaponName: '武器A', routeOrigin: { kind: 'new_normal_artian' } })
    expect(candidateRouteOriginLabel(notice!.routeOrigin)).toBe('新しく作成する通常アーティア')
  })

  it('judges each Candidate on its own Route', () => {
    const target = targetPreferring(weaponA)
    const candidates = [candidateFrom(weaponA), candidateFrom(weaponB), candidateFrom(null)]
    expect(
      candidates.map((candidate) => describePreferredOwnedWeaponNotice(candidate, target, ownedWeapons)?.routeOrigin.kind ?? null),
    ).toEqual([null, 'owned_weapon', 'new_normal_artian'])
  })

  it('never guesses a name for a weapon that is not loaded', () => {
    expect(describePreferredOwnedWeaponNotice(candidateFrom(weaponB), targetPreferring(weaponA), [])).toEqual({
      preferredWeaponName: '（見つからない所持武器）',
      routeOrigin: { kind: 'owned_weapon', weaponName: '（見つからない所持武器）' },
    })
  })

  it('leaves the Candidate and the Target untouched', () => {
    const candidate = candidateFrom(weaponB)
    const target = targetPreferring(weaponA)
    const before = structuredClone({ candidate, target })
    describePreferredOwnedWeaponNotice(candidate, target, ownedWeapons)
    expect({ candidate, target }).toEqual(before)
  })
})
