import { describe, expect, it, vi } from 'vitest'
import { createBuildListEntry } from '../../domain/buildList'
import { createReferencedOwnedWeaponsHash, createSearchStateHash } from '../../domain/models/hashing'
import type { AppSettings, BuildListEntry, OwnedWeapon, TargetWeapon } from '../../domain/models/publicTypes'
import { createCandidateSearchInput } from '../search/createCandidateSearchInput'
import { BuildListService, type BuildListServiceRepositories } from '../buildList/buildListService'
import { createValidMasterDataFixture } from '../../test/fixtures/masterData'
import { createValidBuildCandidate, createValidNormalArtianCounter, createValidOwnedWeapon, createValidRngState, createValidTargetWeapon, domainFixtureContext, ownedWeaponId } from '../../test/fixtures/domainData'

function buildListMemory(entry: BuildListEntry, target: TargetWeapon, owned: OwnedWeapon[]) {
  const entries = [entry]
  const rngState = createValidRngState(); rngState.skillCounter = { value: 7, isConfirmed: true, source: 'manual' }
  const counters = [createValidNormalArtianCounter()]
  const refs: BuildListServiceRepositories = {
    getAllEntries: async () => entries,
    putEntry: vi.fn(async (next) => { entries[0] = next; return next }),
    deleteEntry: async () => undefined,
    ensureRngState: async () => rngState,
    getNormalCounters: async () => counters,
    getOwnedWeapons: async () => owned,
    getTargets: async () => [target],
  }
  return { service: new BuildListService(refs), entries, rngState, counters }
}

describe('CRUD integration', () => {
  it('passes persisted RNG, counters, OwnedWeapon, and TargetWeapon into Search Input', async () => {
    const master = createValidMasterDataFixture()
    const rngState = createValidRngState(); const counter = createValidNormalArtianCounter(); const owned = createValidOwnedWeapon(); const target = createValidTargetWeapon()
    const settings: AppSettings = { id: 'settings', schemaVersion: 1, debugMode: false, resultPageSize: 50, defaultSearchLimit: 5000, createdAt: 'now', updatedAt: 'now' }
    const input = await createCandidateSearchInput({ searchRunId: 'integration', targetWeaponIds: [target.id], routeFilter: 'all', resultFilter: 'all', settings: { maxNormalAdvance: 1, maxGogmaAdvance: 1, maxSkillAdvance: 1, maxCandidatesPerTarget: 1, similarityThreshold: 0.6 }, master, calculationContext: domainFixtureContext }, { ensureInitialRngState: async () => rngState, getAllNormalArtianCounters: async () => [counter], getAllOwnedWeapons: async () => [owned], getAllTargetWeapons: async () => [target], ensureSettings: async () => settings })
    expect(input).toMatchObject({ rngState, normalCounters: [counter], ownedWeapons: [owned], targetWeapons: [target] })
  })

  it('marks Target meaning changes stale but ignores Target name changes', async () => {
    const target = createValidTargetWeapon(); const candidate = createValidBuildCandidate(); const rng = createValidRngState(); rng.skillCounter = { value: 7, isConfirmed: true, source: 'manual' }; const counters = [createValidNormalArtianCounter()]
    candidate.searchStateHash = createSearchStateHash(candidate.route, rng, counters)
    const entry = createBuildListEntry(candidate, target, { createdAt: 'now' })
    const named = buildListMemory(entry, { ...target, name: '表示名だけ変更' }, [])
    named.rngState.skillCounter = rng.skillCounter
    expect((await named.service.refreshStaleness(domainFixtureContext)).entries[0].isStale).toBe(false)
    const changedTarget = structuredClone(target); changedTarget.idealBonuses[0].bonusRankId = 'rank.changed'
    const changed = buildListMemory(entry, changedTarget, []); changed.rngState.skillCounter = rng.skillCounter
    expect((await changed.service.refreshStaleness(domainFixtureContext)).entries[0].staleReasons).toContain('target_definition_changed')
  })

  it('marks referenced OwnedWeapon bonus changes stale but ignores its name', async () => {
    const target = createValidTargetWeapon(); const source = createValidOwnedWeapon(ownedWeaponId('owned.source')); const candidate = createValidBuildCandidate(); const rng = createValidRngState(); rng.skillCounter = { value: 7, isConfirmed: true, source: 'manual' }; const counters = [createValidNormalArtianCounter()]
    candidate.route = { kind: 'existing_gogma_reset_skills', sourceOwnedWeaponId: source.id, operations: [{ type: 'reset_skills', sourceOwnedWeaponId: source.id, skillCounterBefore: 7, skillCounterAfter: 8 }] }
    candidate.searchStateHash = createSearchStateHash(candidate.route, rng, counters); candidate.referencedOwnedWeaponsHash = createReferencedOwnedWeaponsHash(candidate.route, [source])
    const entry = createBuildListEntry(candidate, target, { createdAt: 'now' })
    const named = buildListMemory(entry, target, [{ ...source, name: '表示名だけ変更' }]); named.rngState.skillCounter = rng.skillCounter
    expect((await named.service.refreshStaleness(domainFixtureContext)).entries[0].isStale).toBe(false)
    const changedSource = structuredClone(source); changedSource.restorationBonuses[0].bonusRankId = 'rank.changed'
    const changed = buildListMemory(entry, target, [changedSource]); changed.rngState.skillCounter = rng.skillCounter
    expect((await changed.service.refreshStaleness(domainFixtureContext)).entries[0].staleReasons).toContain('owned_weapon_changed')
  })

  it('marks route-dependent RNG edits stale', async () => {
    const target = createValidTargetWeapon(); const candidate = createValidBuildCandidate(); const rng = createValidRngState(); rng.skillCounter = { value: 7, isConfirmed: true, source: 'manual' }; const counters = [createValidNormalArtianCounter()]
    candidate.searchStateHash = createSearchStateHash(candidate.route, rng, counters)
    const entry = createBuildListEntry(candidate, target, { createdAt: 'now' })
    const memory = buildListMemory(entry, target, []); memory.rngState.skillCounter = rng.skillCounter; memory.rngState.gogmaCounter.value = 99
    expect((await memory.service.refreshStaleness(domainFixtureContext)).entries[0].staleReasons).toContain('rng_state_changed')
  })
})
