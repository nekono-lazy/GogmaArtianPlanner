import { describe, expect, it } from 'vitest'
import type {
  BuildCandidate,
  BuildListEntry,
  BuildRoute,
  NormalArtianCounter,
  OwnedGogmaArtianWeapon,
  OwnedNormalArtianWeapon,
  OwnedWeapon,
  RngState,
  TargetWeapon,
} from '../models/publicTypes'
import { createReferencedOwnedWeaponsHash, createSearchStateHash } from '../models/hashing'
import {
  buildListEntryId,
  candidateId,
  createValidBuildCandidate,
  createValidNormalArtianCounter,
  createValidOwnedWeapon,
  createValidRngState,
  createValidTargetWeapon,
  domainFixtureContext,
  ownedWeaponId,
  productionPlanId,
  targetWeaponId,
} from '../../test/fixtures/domainData'
import { createBuildListEntry } from './buildListEntry'
import { deriveOtherTargetSourceExclusion, type OtherTargetSourceExclusionInput } from './otherTargetSourceExclusion'

/*
 * Issue #157 PR-3 (`docs/SEARCH_SPEC.md` 3.3「除外集合の導出」 / 13.7): which owned weapons other Targets use, derived
 * from one read of the persisted state.
 */

const T = targetWeaponId('target.t')
const U = targetWeaponId('target.u')
const V = targetWeaponId('target.v')

function target(id: string, overrides: Partial<TargetWeapon> = {}): TargetWeapon {
  return { ...createValidTargetWeapon(), id: targetWeaponId(id), name: id, ...overrides }
}

function gogma(id: string, overrides: Partial<OwnedGogmaArtianWeapon> = {}): OwnedGogmaArtianWeapon {
  return { ...createValidOwnedWeapon(ownedWeaponId(id)), isProtected: false, ...overrides }
}

function normal(id: string): OwnedNormalArtianWeapon {
  return {
    ...createValidOwnedWeapon(ownedWeaponId(id)),
    kind: 'normal',
    rarity: 8,
    restorationBonusScope: 'normal_artian',
    seriesSkillId: null,
    groupSkillId: null,
    status: null,
    isProtected: false,
  }
}

/** The zero-operation Route of an owned Gogma (`existing_gogma_current`). */
function currentRoute(weaponId: string): BuildRoute {
  return { kind: 'existing_gogma_current', sourceOwnedWeaponId: ownedWeaponId(weaponId), operations: [] }
}

/** An owned Normal converted, then reset: the Route source and no operation source. */
function ownedNormalRoute(weaponId: string): BuildRoute {
  return {
    kind: 'owned_normal_artian_to_gogma',
    sourceOwnedWeaponId: ownedWeaponId(weaponId),
    operations: [
      { type: 'convert_normal_to_gogma', weaponTypeId: 'weapon.fixture.a', skillCounterBefore: 7, skillCounterAfter: 8 },
      { type: 'reset_bonuses', sourceOwnedWeaponId: null, gogmaCounterBefore: 10, gogmaCounterAfter: 11 },
    ],
  }
}

/** An existing Gogma's Reset Bonuses then Reset Skills, each naming the weapon. */
function existingAmendmentRoute(weaponId: string): BuildRoute {
  return {
    kind: 'existing_gogma_mixed',
    sourceOwnedWeaponId: ownedWeaponId(weaponId),
    operations: [
      { type: 'reset_bonuses', sourceOwnedWeaponId: ownedWeaponId(weaponId), gogmaCounterBefore: 10, gogmaCounterAfter: 11 },
      { type: 'reset_skills', sourceOwnedWeaponId: ownedWeaponId(weaponId), skillCounterBefore: 7, skillCounterAfter: 8 },
    ],
  }
}

interface State {
  rngState: RngState
  normalCounters: NormalArtianCounter[]
  ownedWeapons: OwnedWeapon[]
  targetWeapons: TargetWeapon[]
  buildListEntries: BuildListEntry[]
}

function baseState(): State {
  const rngState = createValidRngState()
  rngState.skillCounter = { value: 7, isConfirmed: true, source: 'manual' }
  return {
    rngState,
    normalCounters: [createValidNormalArtianCounter()],
    ownedWeapons: [],
    targetWeapons: [],
    buildListEntries: [],
  }
}

/** A non-stale Entry of `owner` for `route` over `state` (every hash is the current one). */
function entry(id: string, owner: TargetWeapon, route: BuildRoute, state: State): BuildListEntry {
  const candidate: BuildCandidate = {
    ...createValidBuildCandidate(),
    id: candidateId(`candidate.${id}`),
    targetWeaponId: owner.id,
    route,
    searchStateHash: createSearchStateHash(route, state.rngState, state.normalCounters),
    referencedOwnedWeaponsHash: createReferencedOwnedWeaponsHash(route, state.ownedWeapons),
    calculationContext: { ...domainFixtureContext },
  }
  return createBuildListEntry(candidate, owner, { id: buildListEntryId(id), createdAt: '2026-10-17T00:00:00.000Z' })
}

function derive(state: State, targetWeaponId = T) {
  const input: OtherTargetSourceExclusionInput = {
    targetWeaponId,
    ...state,
    calculationContext: { ...domainFixtureContext },
  }
  return deriveOtherTargetSourceExclusion(input)
}

describe('deriveOtherTargetSourceExclusion', () => {
  it("excludes another Target's preferred owned weapon, Normal and Gogma alike, but not the searched Target's own", () => {
    const state = baseState()
    state.ownedWeapons = [gogma('owned.g'), normal('owned.n'), gogma('owned.own')]
    state.targetWeapons = [
      target(T, { preferredOwnedWeaponId: ownedWeaponId('owned.own') }),
      target(U, { preferredOwnedWeaponId: ownedWeaponId('owned.g') }),
      target(V, { preferredOwnedWeaponId: ownedWeaponId('owned.n') }),
    ]
    expect(derive(state)).toEqual({
      targetWeaponId: T,
      excludedOwnedWeaponIds: ['owned.g', 'owned.n'],
      usages: [
        { ownedWeaponId: 'owned.g', reasons: [{ kind: 'preferred_owned_weapon', targetWeaponId: U }] },
        { ownedWeaponId: 'owned.n', reasons: [{ kind: 'preferred_owned_weapon', targetWeaponId: V }] },
      ],
    })
  })

  it("excludes every weapon a non-stale Entry of another Target references, and nothing for a new Normal's Route", () => {
    const state = baseState()
    state.ownedWeapons = [normal('owned.normal'), gogma('owned.amended'), gogma('owned.current', { isProtected: true })]
    const u = target(U)
    const v = target(V)
    const w = target('target.w')
    const x = target('target.x')
    state.targetWeapons = [target(T), u, v, w, x]
    state.buildListEntries = [
      entry('entry.u', u, ownedNormalRoute('owned.normal'), state),
      entry('entry.v', v, existingAmendmentRoute('owned.amended'), state),
      // A protected Gogma used by a zero-operation Candidate is excluded too.
      entry('entry.w', w, currentRoute('owned.current'), state),
      // A new Normal Artian's Route references no owned weapon.
      entry('entry.x', x, createValidBuildCandidate().route, state),
    ]
    expect(derive(state).usages).toEqual([
      { ownedWeaponId: 'owned.amended', reasons: [{ kind: 'build_list_entry_source', targetWeaponId: V, buildListEntryId: 'entry.v' }] },
      { ownedWeaponId: 'owned.current', reasons: [{ kind: 'build_list_entry_source', targetWeaponId: 'target.w', buildListEntryId: 'entry.w' }] },
      { ownedWeaponId: 'owned.normal', reasons: [{ kind: 'build_list_entry_source', targetWeaponId: U, buildListEntryId: 'entry.u' }] },
    ])
  })

  it("never counts the searched Target's own Entries, a legacy duplicate included", () => {
    const state = baseState()
    state.ownedWeapons = [gogma('owned.a'), gogma('owned.b')]
    const t = target(T)
    state.targetWeapons = [t]
    state.buildListEntries = [
      entry('entry.t.1', t, currentRoute('owned.a'), state),
      entry('entry.t.2', t, existingAmendmentRoute('owned.b'), state),
    ]
    expect(derive(state)).toEqual({ targetWeaponId: T, excludedOwnedWeaponIds: [], usages: [] })
  })

  it("excludes the searched Target's preferred weapon when another Target's non-stale Entry uses it", () => {
    const state = baseState()
    state.ownedWeapons = [gogma('owned.t-preferred')]
    const u = target(U)
    state.targetWeapons = [target(T, { preferredOwnedWeaponId: ownedWeaponId('owned.t-preferred') }), u]
    state.buildListEntries = [entry('entry.u', u, currentRoute('owned.t-preferred'), state)]
    expect(derive(state).usages).toEqual([
      {
        ownedWeaponId: 'owned.t-preferred',
        reasons: [{ kind: 'build_list_entry_source', targetWeaponId: U, buildListEntryId: 'entry.u' }],
      },
    ])
  })

  it('works when no Target prefers anything, the searched one included', () => {
    const state = baseState()
    state.ownedWeapons = [gogma('owned.a')]
    const u = target(U)
    state.targetWeapons = [target(T), u]
    state.buildListEntries = [entry('entry.u', u, currentRoute('owned.a'), state)]
    expect(derive(state).excludedOwnedWeaponIds).toEqual(['owned.a'])
  })

  it('recomputes staleness from the state and never trusts the persisted flags', () => {
    const state = baseState()
    state.ownedWeapons = [gogma('owned.flagged-stale'), gogma('owned.flagged-fresh')]
    const u = target(U)
    const v = target(V)
    state.targetWeapons = [target(T), u, v]
    state.buildListEntries = [
      // Persisted as stale, but every hash still matches: it counts.
      { ...entry('entry.u', u, currentRoute('owned.flagged-stale'), state), isStale: true, staleReasons: ['rng_state_changed'] },
      // Persisted as fresh, but its search state no longer matches the current RNG: it does not count.
      { ...entry('entry.v', v, existingAmendmentRoute('owned.flagged-fresh'), state), searchStateHash: 'hash.old' },
    ]
    expect(derive(state).excludedOwnedWeaponIds).toEqual(['owned.flagged-stale'])
  })

  it('counts no stale Entry, whatever made it stale', () => {
    const state = baseState()
    state.ownedWeapons = [gogma('owned.a')]
    const u = target(U)
    state.targetWeapons = [target(T), u]
    const fresh = entry('entry.u', u, existingAmendmentRoute('owned.a'), state)
    const staleVariants: BuildListEntry[] = [
      { ...fresh, targetDefinitionHash: 'hash.old' },
      { ...fresh, searchStateHash: 'hash.old' },
      { ...fresh, referencedOwnedWeaponsHash: 'hash.old' },
      { ...fresh, calculationContext: { ...fresh.calculationContext, masterDataVersion: 999 } },
    ]
    staleVariants.forEach((stale) => {
      expect(derive({ ...state, buildListEntries: [stale] }).usages).toEqual([])
    })
    // A protection change of the source makes the Entry stale (referencedOwnedWeaponsHash), so it stops counting.
    expect(derive({ ...state, ownedWeapons: [gogma('owned.a', { isProtected: true })], buildListEntries: [fresh] }).usages).toEqual([])
    expect(derive({ ...state, buildListEntries: [fresh] }).excludedOwnedWeaponIds).toEqual(['owned.a'])
  })

  it('counts nothing of a disabled or completed Target, nor an Entry of a Target that no longer exists', () => {
    const state = baseState()
    state.ownedWeapons = [gogma('owned.disabled'), gogma('owned.completed'), gogma('owned.orphan')]
    const disabled = target('target.disabled', { isEnabled: false, preferredOwnedWeaponId: ownedWeaponId('owned.disabled') })
    const completed = target('target.completed', {
      lifecycleStatus: 'completed',
      completedAt: '2026-10-17T00:00:00.000Z',
      completedByProductionPlanId: productionPlanId('plan.done'),
      preferredOwnedWeaponId: ownedWeaponId('owned.completed'),
    })
    const gone = target('target.gone')
    state.targetWeapons = [target(T), disabled, completed]
    state.buildListEntries = [
      entry('entry.disabled', disabled, currentRoute('owned.disabled'), state),
      entry('entry.completed', completed, currentRoute('owned.completed'), state),
      entry('entry.orphan', gone, currentRoute('owned.orphan'), state),
    ]
    expect(derive(state).usages).toEqual([])
    // Enabling the Target again counts it again.
    state.targetWeapons[1] = { ...disabled, isEnabled: true }
    expect(derive(state).excludedOwnedWeaponIds).toEqual(['owned.disabled'])
  })

  it('counts every non-stale Entry of a legacy duplicate, never picking one', () => {
    const state = baseState()
    state.ownedWeapons = [gogma('owned.a'), gogma('owned.b'), gogma('owned.c')]
    const u = target(U)
    state.targetWeapons = [target(T), u]
    state.buildListEntries = [
      entry('entry.u.1', u, currentRoute('owned.a'), state),
      entry('entry.u.2', u, existingAmendmentRoute('owned.b'), state),
      { ...entry('entry.u.3', u, currentRoute('owned.c'), state), searchStateHash: 'hash.old' },
    ]
    expect(derive(state).excludedOwnedWeaponIds).toEqual(['owned.a', 'owned.b'])
  })

  it('keeps one ID per weapon with every reason, and unions a preference with a disagreeing Entry', () => {
    const state = baseState()
    state.ownedWeapons = [gogma('owned.x'), gogma('owned.y')]
    const u = target(U, { preferredOwnedWeaponId: ownedWeaponId('owned.x') })
    const v = target(V)
    state.targetWeapons = [target(T), v, u]
    state.buildListEntries = [
      // U prefers X but its Candidate uses Y; V's Candidate uses X.
      entry('entry.u', u, currentRoute('owned.y'), state),
      entry('entry.v.2', v, currentRoute('owned.x'), state),
      entry('entry.v.1', v, existingAmendmentRoute('owned.x'), state),
    ]
    expect(derive(state)).toEqual({
      targetWeaponId: T,
      excludedOwnedWeaponIds: ['owned.x', 'owned.y'],
      usages: [
        {
          ownedWeaponId: 'owned.x',
          reasons: [
            { kind: 'preferred_owned_weapon', targetWeaponId: U },
            { kind: 'build_list_entry_source', targetWeaponId: V, buildListEntryId: 'entry.v.1' },
            { kind: 'build_list_entry_source', targetWeaponId: V, buildListEntryId: 'entry.v.2' },
          ],
        },
        { ownedWeaponId: 'owned.y', reasons: [{ kind: 'build_list_entry_source', targetWeaponId: U, buildListEntryId: 'entry.u' }] },
      ],
    })
  })

  it('never reads executionInProgress', () => {
    const state = baseState()
    const inProgress = gogma('owned.in-progress', {
      executionInProgress: { productionPlanId: productionPlanId('plan.running'), startedAt: '2026-10-17T00:00:00.000Z' },
    })
    state.ownedWeapons = [inProgress, gogma('owned.idle')]
    state.targetWeapons = [target(T), target(U)]
    expect(derive(state).usages).toEqual([])
    state.targetWeapons[1] = target(U, { preferredOwnedWeaponId: ownedWeaponId('owned.idle') })
    expect(derive(state).excludedOwnedWeaponIds).toEqual(['owned.idle'])
  })

  it('returns only weapons of the read, and keeps a weapon incompatible with the searched Target', () => {
    const state = baseState()
    state.ownedWeapons = [gogma('owned.other-type', { weaponTypeId: 'weapon.fixture.b' })]
    state.targetWeapons = [
      target(T),
      target(U, { preferredOwnedWeaponId: ownedWeaponId('owned.missing') }),
      target(V, { weaponTypeId: 'weapon.fixture.b', preferredOwnedWeaponId: ownedWeaponId('owned.other-type') }),
    ]
    expect(derive(state).excludedOwnedWeaponIds).toEqual(['owned.other-type'])
  })

  it('returns the same IDs and reasons, in code unit order, whatever the input order', () => {
    const state = baseState()
    // Code unit order differs from locale order here: 'B' < 'a' < 'b'.
    state.ownedWeapons = [gogma('owned.b'), gogma('owned.B'), gogma('owned.a')]
    const targets = [
      target('target.b', { preferredOwnedWeaponId: ownedWeaponId('owned.b') }),
      target('target.B', { preferredOwnedWeaponId: ownedWeaponId('owned.B') }),
      target('target.a', { preferredOwnedWeaponId: ownedWeaponId('owned.a') }),
      target(T),
    ]
    state.targetWeapons = targets
    state.buildListEntries = [
      entry('entry.b', targets[0], currentRoute('owned.a'), state),
      entry('entry.B', targets[1], currentRoute('owned.a'), state),
    ]
    const result = derive(state)
    expect(result.excludedOwnedWeaponIds).toEqual(['owned.B', 'owned.a', 'owned.b'])
    expect(result.usages.find(({ ownedWeaponId }) => ownedWeaponId === 'owned.a')?.reasons).toEqual([
      { kind: 'build_list_entry_source', targetWeaponId: 'target.B', buildListEntryId: 'entry.B' },
      { kind: 'preferred_owned_weapon', targetWeaponId: 'target.a' },
      { kind: 'build_list_entry_source', targetWeaponId: 'target.b', buildListEntryId: 'entry.b' },
    ])
    const reversed = derive({
      ...state,
      ownedWeapons: [...state.ownedWeapons].reverse(),
      targetWeapons: [...state.targetWeapons].reverse(),
      buildListEntries: [...state.buildListEntries].reverse(),
    })
    expect(reversed).toEqual(result)
  })
})
