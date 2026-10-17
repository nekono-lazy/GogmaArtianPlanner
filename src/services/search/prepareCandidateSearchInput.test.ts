import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase } from '../../db/AppDatabase'
import { RngStateRepository } from '../../db/repositories'
import { createBuildListEntry, deriveOtherTargetSourceExclusion } from '../../domain/buildList'
import type {
  BuildCandidate,
  BuildRoute,
  OwnedGogmaArtianWeapon,
  TargetWeapon,
} from '../../domain/models/publicTypes'
import { createReferencedOwnedWeaponsHash, createSearchStateHash } from '../../domain/models/hashing'
import { createCandidateSearchInput as createFixtureInput } from '../../test/fixtures/candidateSearch'
import {
  buildListEntryId,
  candidateId,
  createValidBuildCandidate,
  createValidOwnedWeapon,
  createValidTargetWeapon,
  ownedWeaponId,
  targetWeaponId,
} from '../../test/fixtures/domainData'
import { createValidMasterDataFixture } from '../../test/fixtures/masterData'
import {
  createCandidateSearchInput,
  type CreateCandidateSearchInputOptions,
  type SearchInputRepositories,
} from './createCandidateSearchInput'
import {
  createCandidateSearchStateReader,
  prepareCandidateSearchInput,
  preparedCandidateSearchInputIssue,
  type CandidateSearchInputPreparationDependencies,
  type CandidateSearchPersistedState,
} from './prepareCandidateSearchInput'

/*
 * Issue #157 PR-3 (`docs/SEARCH_SPEC.md` 3.3 / 13.7): building one Candidate Search input with
 * 「他の目標武器で使用する所持武器を除外する」 on or off.
 */

let databaseSequence = 0

async function withDatabase(test: (database: AppDatabase) => Promise<void>): Promise<void> {
  databaseSequence += 1
  const name = `prepare-candidate-search-input-${databaseSequence}`
  const database = new AppDatabase(name)
  await database.open()
  try {
    await test(database)
  } finally {
    database.close()
    await Dexie.delete(name)
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

const T = targetWeaponId('target.t')
const U = targetWeaponId('target.u')

function target(id: string, overrides: Partial<TargetWeapon> = {}): TargetWeapon {
  return { ...createValidTargetWeapon(), id: targetWeaponId(id), name: `目標 ${id}`, ...overrides }
}

function gogma(id: string, overrides: Partial<OwnedGogmaArtianWeapon> = {}): OwnedGogmaArtianWeapon {
  return { ...createValidOwnedWeapon(ownedWeaponId(id)), name: `所持 ${id}`, isProtected: false, ...overrides }
}

function currentRoute(weaponId: string): BuildRoute {
  return { kind: 'existing_gogma_current', sourceOwnedWeaponId: ownedWeaponId(weaponId), operations: [] }
}

const fixture = createFixtureInput()
const calculationContext = fixture.calculationContext

function options(targetWeaponId = T): CreateCandidateSearchInputOptions {
  return {
    searchRunId: 'search-run.prepare',
    targetWeaponId,
    routeFilter: 'all',
    settings: { maxNormalAdvance: 2, maxGogmaAdvance: 3, maxSkillAdvance: 4 },
    master: createValidMasterDataFixture(),
    calculationContext,
  }
}

/** A non-stale Entry over the seeded state (the hashes are those of `state`). */
function entryFor(id: string, owner: TargetWeapon, route: BuildRoute, state: Pick<CandidateSearchPersistedState, 'rngState' | 'normalCounters' | 'ownedWeapons'>) {
  const candidate: BuildCandidate = {
    ...createValidBuildCandidate(),
    id: candidateId(`candidate.${id}`),
    targetWeaponId: owner.id,
    route,
    searchStateHash: createSearchStateHash(route, state.rngState, state.normalCounters),
    referencedOwnedWeaponsHash: createReferencedOwnedWeaponsHash(route, state.ownedWeapons),
    calculationContext: { ...calculationContext },
  }
  return createBuildListEntry(candidate, owner, { id: buildListEntryId(id), createdAt: '2026-10-17T00:00:00.000Z' })
}

/**
 * T is searched. U prefers X; U's non-stale Entry uses Y; T prefers Z (not excluded), and W is used by nobody.
 */
async function seed(database: AppDatabase) {
  const ownedWeapons = [gogma('owned.x'), gogma('owned.y'), gogma('owned.z'), gogma('owned.w')]
  const u = target(U, { preferredOwnedWeaponId: ownedWeaponId('owned.x') })
  const targets = [target(T, { preferredOwnedWeaponId: ownedWeaponId('owned.z') }), u]
  const state = { rngState: fixture.rngState, normalCounters: fixture.normalCounters, ownedWeapons }
  await database.rngState.put(fixture.rngState)
  await database.normalArtianCounters.bulkPut(fixture.normalCounters)
  await database.ownedWeapons.bulkPut(ownedWeapons)
  await database.targetWeapons.bulkPut(targets)
  await database.buildListEntries.put(entryFor('entry.u', u, currentRoute('owned.y'), state))
}

/** The `createCandidateSearchInput()` repositories over one test database. */
function repositoriesOf(database: AppDatabase): SearchInputRepositories {
  return {
    ensureInitialRngState: () => new RngStateRepository(database).ensureInitialRngState(),
    getAllNormalArtianCounters: () => database.normalArtianCounters.toArray(),
    getAllOwnedWeapons: () => database.ownedWeapons.toArray(),
    getAllTargetWeapons: () => database.targetWeapons.toArray(),
    ensureSettings: async () => (await database.settings.get('settings'))!,
  }
}

function dependenciesOf(database: AppDatabase): CandidateSearchInputPreparationDependencies {
  return { repositories: repositoriesOf(database), stateReader: createCandidateSearchStateReader(database) }
}

describe('prepareCandidateSearchInput', () => {
  it('with the exclusion off builds exactly the createCandidateSearchInput() input, with no exclusion and no state read', async () => {
    await withDatabase(async (database) => {
      await seed(database)
      const dependencies = dependenciesOf(database)
      const read = vi.spyOn(dependencies.stateReader, 'read')
      const prepared = await prepareCandidateSearchInput({ ...options(), excludeOtherTargetSources: false }, dependencies)
      expect(prepared.sourceExclusion).toBeNull()
      expect(prepared.input).not.toHaveProperty('excludedSourceOwnedWeaponIds')
      expect(prepared.input).toEqual(await createCandidateSearchInput(options(), repositoriesOf(database)))
      expect(read).not.toHaveBeenCalled()
      expect(preparedCandidateSearchInputIssue(prepared, false)).toBeNull()
    })
  })

  it('with the exclusion on carries the derived set and the records it names, from the same read as the input', async () => {
    await withDatabase(async (database) => {
      await seed(database)
      const prepared = await prepareCandidateSearchInput({ ...options(), excludeOtherTargetSources: true }, dependenciesOf(database))
      // The input itself is the ordinary one over the same persisted state, plus the excluded IDs.
      const { excludedSourceOwnedWeaponIds, ...rest } = prepared.input
      expect(rest).toEqual(await createCandidateSearchInput(options(), repositoriesOf(database)))
      expect(excludedSourceOwnedWeaponIds).toEqual(['owned.x', 'owned.y'])
      expect(prepared.sourceExclusion).toEqual({
        exclusion: {
          targetWeaponId: T,
          excludedOwnedWeaponIds: ['owned.x', 'owned.y'],
          usages: [
            { ownedWeaponId: 'owned.x', reasons: [{ kind: 'preferred_owned_weapon', targetWeaponId: U }] },
            { ownedWeaponId: 'owned.y', reasons: [{ kind: 'build_list_entry_source', targetWeaponId: U, buildListEntryId: 'entry.u' }] },
          ],
        },
        ownedWeapons: [
          expect.objectContaining({ id: 'owned.x', name: '所持 owned.x' }),
          expect.objectContaining({ id: 'owned.y', name: '所持 owned.y' }),
        ],
        targetWeapons: [expect.objectContaining({ id: U, name: '目標 target.u' })],
      })
      expect(preparedCandidateSearchInputIssue(prepared, true)).toBeNull()
    })
  })

  it('reads the input state and the exclusion in one read-only transaction over the five tables', async () => {
    await withDatabase(async (database) => {
      await seed(database)
      const transaction = vi.spyOn(database, 'transaction')
      await prepareCandidateSearchInput({ ...options(), excludeOtherTargetSources: true }, dependenciesOf(database))
      const readOnly = transaction.mock.calls.filter(([mode]) => mode === 'r')
      expect(readOnly).toHaveLength(1)
      const tables = (readOnly[0][1] as unknown as { name: string }[]).map(({ name }) => name).sort()
      expect(tables).toEqual(['buildListEntries', 'normalArtianCounters', 'ownedWeapons', 'rngState', 'targetWeapons'])
    })
  })

  it('derives from exactly the state the input carries, whatever a concurrent write does', async () => {
    await withDatabase(async (database) => {
      await seed(database)
      const preparing = prepareCandidateSearchInput({ ...options(), excludeOtherTargetSources: true }, dependenciesOf(database))
      // U stops preferring X while the input is being prepared.
      const writing = database.targetWeapons.update(U, { preferredOwnedWeaponId: null })
      const [prepared] = await Promise.all([preparing, writing])
      const readU = prepared.input.targetWeapons.find(({ id }) => id === U)!
      const excludesX = prepared.input.excludedSourceOwnedWeaponIds!.includes(ownedWeaponId('owned.x'))
      expect(excludesX).toBe(readU.preferredOwnedWeaponId === 'owned.x')
      expect(prepared.sourceExclusion!.exclusion).toEqual(deriveOtherTargetSourceExclusion({
        targetWeaponId: T,
        targetWeapons: prepared.input.targetWeapons,
        ownedWeapons: prepared.input.ownedWeapons,
        buildListEntries: await database.buildListEntries.toArray(),
        rngState: prepared.input.rngState,
        normalCounters: prepared.input.normalCounters,
        calculationContext,
      }))
    })
  })

  it('takes the input arrays and the derivation from the one state the reader returned', async () => {
    const state: CandidateSearchPersistedState = {
      rngState: fixture.rngState,
      normalCounters: fixture.normalCounters,
      ownedWeapons: [gogma('owned.x')],
      targetWeapons: [target(T), target(U, { preferredOwnedWeaponId: ownedWeaponId('owned.x') })],
      buildListEntries: [],
    }
    const repositories = { ensureInitialRngState: vi.fn(), getAllNormalArtianCounters: vi.fn(), getAllOwnedWeapons: vi.fn(), getAllTargetWeapons: vi.fn(), ensureSettings: vi.fn() }
    const prepared = await prepareCandidateSearchInput(
      { ...options(), excludeOtherTargetSources: true },
      { repositories, stateReader: { read: async () => state } },
    )
    expect(prepared.input.rngState).toBe(state.rngState)
    expect(prepared.input.normalCounters).toBe(state.normalCounters)
    expect(prepared.input.ownedWeapons).toBe(state.ownedWeapons)
    expect(prepared.input.targetWeapons).toBe(state.targetWeapons)
    expect(prepared.input.excludedSourceOwnedWeaponIds).toEqual(['owned.x'])
    Object.values(repositories).forEach((repository) => expect(repository).not.toHaveBeenCalled())
  })

  it('carries an empty excluded set, not an absent one, when the exclusion is on and nothing is used elsewhere', async () => {
    await withDatabase(async (database) => {
      await database.targetWeapons.put(target(T))
      const prepared = await prepareCandidateSearchInput({ ...options(), excludeOtherTargetSources: true }, dependenciesOf(database))
      expect(prepared.input.excludedSourceOwnedWeaponIds).toEqual([])
      expect(prepared.sourceExclusion).toEqual({
        exclusion: { targetWeaponId: T, excludedOwnedWeaponIds: [], usages: [] },
        ownedWeapons: [],
        targetWeapons: [],
      })
    })
  })

  it('keeps the RngState and AppSettings initial creation of the ordinary input', async () => {
    await withDatabase(async (database) => {
      await database.targetWeapons.put(target(T))
      const prepared = await prepareCandidateSearchInput({ ...options(), excludeOtherTargetSources: true }, dependenciesOf(database))
      const stored = await database.rngState.get('current')
      expect(stored).toBeDefined()
      expect(prepared.input.rngState).toEqual(stored)
      expect(await database.settings.get('settings')).toBeDefined()
    })
  })

  it('fails closed instead of building an input from a partial read', async () => {
    await withDatabase(async (database) => {
      await seed(database)
      vi.spyOn(database.buildListEntries, 'toArray').mockRejectedValue(new Error('read failure'))
      await expect(prepareCandidateSearchInput({ ...options(), excludeOtherTargetSources: true }, dependenciesOf(database)))
        .rejects.toMatchObject({ name: 'RepositoryError', code: 'transaction_failed' })
    })
    await withDatabase(async (database) => {
      await seed(database)
      // The RngState disappears between its initial creation and the read: it is not created inside the read.
      vi.spyOn(RngStateRepository.prototype, 'getCurrentRngState').mockResolvedValue(undefined)
      await expect(prepareCandidateSearchInput({ ...options(), excludeOtherTargetSources: true }, dependenciesOf(database)))
        .rejects.toMatchObject({ name: 'RepositoryError', code: 'not_found' })
    })
    const failing: CandidateSearchInputPreparationDependencies = {
      repositories: { ensureInitialRngState: vi.fn(), getAllNormalArtianCounters: vi.fn(), getAllOwnedWeapons: vi.fn(), getAllTargetWeapons: vi.fn(), ensureSettings: vi.fn() },
      stateReader: { read: async () => { throw new Error('reader failure') } },
    }
    await expect(prepareCandidateSearchInput({ ...options(), excludeOtherTargetSources: true }, failing)).rejects.toThrow('reader failure')
  })
})

describe('preparedCandidateSearchInputIssue', () => {
  const offInput = fixture
  const exclusion = { targetWeaponId: fixture.targetWeaponId, excludedOwnedWeaponIds: [ownedWeaponId('owned.x')], usages: [] }
  const sourceExclusion = { exclusion, ownedWeapons: [], targetWeapons: [] }

  it('accepts the shapes prepareCandidateSearchInput() returns', () => {
    expect(preparedCandidateSearchInputIssue({ input: offInput, sourceExclusion: null }, false)).toBeNull()
    expect(preparedCandidateSearchInputIssue({
      input: { ...offInput, excludedSourceOwnedWeaponIds: [ownedWeaponId('owned.x')] },
      sourceExclusion,
    }, true)).toBeNull()
  })

  it('refuses an input that does not carry the requested condition', () => {
    expect(preparedCandidateSearchInputIssue({ input: offInput, sourceExclusion: null }, true)).not.toBeNull()
    expect(preparedCandidateSearchInputIssue({ input: { ...offInput, excludedSourceOwnedWeaponIds: [] }, sourceExclusion: null }, false)).not.toBeNull()
    expect(preparedCandidateSearchInputIssue({ input: offInput, sourceExclusion }, false)).not.toBeNull()
    expect(preparedCandidateSearchInputIssue({ input: { ...offInput, excludedSourceOwnedWeaponIds: [] }, sourceExclusion }, true)).not.toBeNull()
    expect(preparedCandidateSearchInputIssue({
      input: { ...offInput, excludedSourceOwnedWeaponIds: [ownedWeaponId('owned.x')] },
      sourceExclusion: { ...sourceExclusion, exclusion: { ...exclusion, targetWeaponId: targetWeaponId('target.other') } },
    }, true)).not.toBeNull()
  })
})
