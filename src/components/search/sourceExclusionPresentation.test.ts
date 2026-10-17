import { describe, expect, it } from 'vitest'
import type { OwnedWeapon, TargetWeapon } from '../../domain/models/publicTypes'
import type { CandidateSearchSourceExclusionSnapshot } from '../../services/search/prepareCandidateSearchInput'
import {
  buildListEntryId,
  createValidBuildCandidate,
  createValidOwnedWeapon,
  createValidTargetWeapon,
  ownedWeaponId,
  targetWeaponId,
} from '../../test/fixtures/domainData'
import {
  batchSourceExclusionCountNote,
  createSearchSourceExclusionDisplay,
  describePreferredOwnedWeaponExclusion,
  sourceExclusionConditionLabel,
  sourceExclusionNotFoundNote,
  sourceExclusionReasonLabel,
} from './sourceExclusionPresentation'

/*
 * Issue #157 PR-4 (`docs/UI_FLOW.md` 9.2): the display of what one search excluded, built from the Search result's IDs
 * and the snapshot recorded when that search's input was prepared.
 */

// IDs sort the opposite way from registration order, so a code unit sort would be caught.
const W1 = ownedWeaponId('owned.z-registered-first')
const W2 = ownedWeaponId('owned.a-registered-second')
const W3 = ownedWeaponId('owned.m-not-excluded-by-search')
const T1 = targetWeaponId('target.z-registered-first')
const T2 = targetWeaponId('target.a-registered-second')

function weapon(id: OwnedWeapon['id'], name: string, createdAt: string): OwnedWeapon {
  return { ...createValidOwnedWeapon(id), name, createdAt }
}

function target(id: TargetWeapon['id'], name: string, createdAt: string): TargetWeapon {
  return { ...createValidTargetWeapon(), id, name, createdAt }
}

/** As `prepareCandidateSearchInput()` records it: code unit order everywhere. */
function snapshot(): CandidateSearchSourceExclusionSnapshot {
  return {
    exclusion: {
      targetWeaponId: targetWeaponId('target.searched'),
      excludedOwnedWeaponIds: [W2, W3, W1],
      usages: [
        {
          ownedWeaponId: W2,
          reasons: [
            { kind: 'build_list_entry_source', targetWeaponId: T2, buildListEntryId: buildListEntryId('entry.b') },
            { kind: 'preferred_owned_weapon', targetWeaponId: T1 },
            { kind: 'build_list_entry_source', targetWeaponId: T1, buildListEntryId: buildListEntryId('entry.a1') },
            { kind: 'build_list_entry_source', targetWeaponId: T1, buildListEntryId: buildListEntryId('entry.a2') },
          ],
        },
        { ownedWeaponId: W3, reasons: [{ kind: 'preferred_owned_weapon', targetWeaponId: T2 }] },
        { ownedWeaponId: W1, reasons: [{ kind: 'preferred_owned_weapon', targetWeaponId: T2 }] },
      ],
    },
    ownedWeapons: [
      weapon(W2, '武器・二番目', '2026-02-01T00:00:00.000Z'),
      weapon(W3, '武器・対象外', '2026-03-01T00:00:00.000Z'),
      weapon(W1, '武器・一番目', '2026-01-01T00:00:00.000Z'),
    ],
    targetWeapons: [
      target(T2, '目標・二番目', '2026-02-01T00:00:00.000Z'),
      target(T1, '目標・一番目', '2026-01-01T00:00:00.000Z'),
    ],
  }
}

describe('createSearchSourceExclusionDisplay', () => {
  it('shows nothing for a search that ran with the exclusion off', () => {
    expect(createSearchSourceExclusionDisplay(false, [W1], snapshot())).toEqual({
      excludeOtherTargetSources: false,
      excludedWeapons: [],
    })
  })

  it('lists only the weapons the Search excluded, in Owned Weapons and Target Weapons registration order', () => {
    const display = createSearchSourceExclusionDisplay(true, [W2, W1], snapshot())
    expect(display.excludeOtherTargetSources).toBe(true)
    // W3 was derived but the Search did not exclude it (another weapon type, a filtered RouteKind).
    expect(display.excludedWeapons.map(({ weaponName }) => weaponName)).toEqual(['武器・一番目', '武器・二番目'])
    const second = display.excludedWeapons[1]
    // Target registration order; within one Target the preference before the Entry; one Target's
    // several Entries (a legacy duplicate) read once.
    expect(second.reasons.map(sourceExclusionReasonLabel)).toEqual([
      '目標武器「目標・一番目」の優先する所持武器',
      '目標武器「目標・一番目」の作成リストの候補が起点に使用',
      '目標武器「目標・二番目」の作成リストの候補が起点に使用',
    ])
    expect(second.reasons[1].buildListEntryIds).toEqual(['entry.a1', 'entry.a2'])
  })

  it('reports an empty list when the search excluded nothing', () => {
    expect(createSearchSourceExclusionDisplay(true, [], snapshot()).excludedWeapons).toEqual([])
  })

  it('names a weapon or Target missing from the snapshot without guessing from elsewhere', () => {
    const unknown = ownedWeaponId('owned.unknown')
    const display = createSearchSourceExclusionDisplay(true, [unknown], {
      ...snapshot(),
      exclusion: {
        targetWeaponId: targetWeaponId('target.searched'),
        excludedOwnedWeaponIds: [unknown],
        usages: [{ ownedWeaponId: unknown, reasons: [{ kind: 'preferred_owned_weapon', targetWeaponId: targetWeaponId('target.unknown') }] }],
      },
    })
    expect(display.excludedWeapons).toEqual([{
      ownedWeaponId: unknown,
      weaponName: '（見つからない所持武器）',
      reasons: [{ kind: 'preferred_owned_weapon', targetWeaponId: 'target.unknown', targetName: '（見つからない目標武器）', buildListEntryIds: [] }],
    }])
  })
})

describe('describePreferredOwnedWeaponExclusion', () => {
  const preferring = { ...createValidTargetWeapon(), preferredOwnedWeaponId: W2 }
  const newNormalCandidate = createValidBuildCandidate()

  it('names the Build List reasons, and a recorded preference reason as well', () => {
    const display = createSearchSourceExclusionDisplay(true, [W2], snapshot())
    expect(describePreferredOwnedWeaponExclusion(newNormalCandidate, preferring, display)).toBe(
      'この検索では、優先する所持武器を起点から除外しました（目標武器「目標・一番目」、「目標・二番目」の作成リストの候補が起点に使用しているため、また目標武器「目標・一番目」の優先する所持武器であるため）。',
    )
  })

  it('says nothing when the search did not exclude the preferred weapon or had no Build List reason for it', () => {
    expect(describePreferredOwnedWeaponExclusion(newNormalCandidate, preferring, createSearchSourceExclusionDisplay(true, [W1], snapshot()))).toBeNull()
    const preferringW1 = { ...preferring, preferredOwnedWeaponId: W1 }
    expect(describePreferredOwnedWeaponExclusion(newNormalCandidate, preferringW1, createSearchSourceExclusionDisplay(true, [W1], snapshot()))).toBeNull()
    expect(describePreferredOwnedWeaponExclusion(newNormalCandidate, preferring, createSearchSourceExclusionDisplay(false, [W2], snapshot()))).toBeNull()
    expect(describePreferredOwnedWeaponExclusion(newNormalCandidate, preferring, null)).toBeNull()
    expect(describePreferredOwnedWeaponExclusion(newNormalCandidate, { ...preferring, preferredOwnedWeaponId: null }, createSearchSourceExclusionDisplay(true, [W2], snapshot()))).toBeNull()
  })

  it('says nothing for a Candidate that starts from the preferred weapon', () => {
    const fromPreferred = createValidBuildCandidate()
    fromPreferred.route = { ...fromPreferred.route, sourceOwnedWeaponId: W2 }
    expect(describePreferredOwnedWeaponExclusion(fromPreferred, preferring, createSearchSourceExclusionDisplay(true, [W2], snapshot()))).toBeNull()
  })
})

describe('source exclusion texts', () => {
  it('states the condition in words', () => {
    expect(sourceExclusionConditionLabel(true)).toBe('他の目標武器で使用する所持武器: 除外する')
    expect(sourceExclusionConditionLabel(false)).toBe('他の目標武器で使用する所持武器: 除外しない')
  })

  it('never says an Ideal does not exist or names an internal ID', () => {
    const note = sourceExclusionNotFoundNote(2)
    expect(note).toContain('他の目標武器で使用する所持武器（2本）を起点から除外したため')
    expect(note).toContain('除外をOFFにして検索すると')
    expect(note).not.toMatch(/存在しません|解がありません|owned\.|target\./)
    expect(batchSourceExclusionCountNote(3)).toBe('（除外した所持武器 3本）')
  })
})
