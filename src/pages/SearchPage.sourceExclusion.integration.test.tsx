import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Dexie from 'dexie'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { AppDatabase } from '../db/AppDatabase'
import {
  BuildCandidateRepository,
  BuildListEntryRepository,
  NormalArtianCounterRepository,
  OwnedWeaponRepository,
  RngStateRepository,
  TargetWeaponRepository,
} from '../db/repositories'
import { createBuildListEntry } from '../domain/buildList'
import type { MasterDataRoot } from '../domain/master/masterTypes'
import { createReferencedOwnedWeaponsHash, createSearchStateHash } from '../domain/models/hashing'
import {
  CURRENT_CALCULATION_APP_SCHEMA_VERSION,
  type BuildCandidate,
  type BuildRoute,
  type OwnedGogmaArtianWeapon,
  type OwnedWeaponId,
  type TargetWeapon,
} from '../domain/models/publicTypes'
import type { RngEngine } from '../domain/rng/rngEngine'
import { searchCandidates, type CandidateSearchInput, type CandidateSearchResult } from '../domain/search'
import type { SearchInputRepositories } from '../services/search/createCandidateSearchInput'
import { createCandidateSearchStateReader, prepareCandidateSearchInput } from '../services/search/prepareCandidateSearchInput'
import type { SearchWorkerClient } from '../services/search/searchWorkerClient'
import {
  belowPracticalBonuses,
  createCandidateSearchInput as createFixtureInput,
  SEARCH_FIXTURE_TIME,
  searchMasterFixture,
} from '../test/fixtures/candidateSearch'
import {
  buildListEntryId,
  candidateId,
  createRestorationBonusSet,
  createValidBuildCandidate,
  createValidOwnedWeapon,
  createValidTargetWeapon,
  ownedWeaponId,
  targetWeaponId,
} from '../test/fixtures/domainData'
import { createValidMasterDataFixture } from '../test/fixtures/masterData'
import { SearchPage, type SearchPageDependencies } from './SearchPage'

/*
 * Issue #157 PR-4 (`docs/UI_FLOW.md` 9.2 / 19): the Search screen over a real Dexie database, the real
 * `prepareCandidateSearchInput()` and the real Candidate Search. Another Target's preferred weapon and the weapon its
 * Build List Entry starts from reach the Worker input as excluded IDs; the result names them with the reasons read when
 * the search started, and a later change of the persisted state or the Checkbox never renames them.
 */

let databaseSequence = 0

async function withDatabase(test: (database: AppDatabase) => Promise<void>): Promise<void> {
  databaseSequence += 1
  const name = `search-page-source-exclusion-${databaseSequence}`
  const database = new AppDatabase(name)
  await database.open()
  try {
    await test(database)
  } finally {
    database.close()
    await Dexie.delete(name)
  }
}

const T = targetWeaponId('target.t')
const U = targetWeaponId('target.u')
const X = ownedWeaponId('owned.x')
const Y = ownedWeaponId('owned.y')
const Z = ownedWeaponId('owned.z')

/** An unprotected Gogma that already is the fixture Target's Ideal: a zero-operation Candidate for every Target. */
function idealGogma(id: OwnedWeaponId, name: string, createdAt: string): OwnedGogmaArtianWeapon {
  return {
    ...createValidOwnedWeapon(id),
    name,
    createdAt,
    restorationBonuses: createRestorationBonusSet(),
    seriesSkillId: 'series_skill.fixture.a',
    groupSkillId: null,
    status: 'unclassified',
    isProtected: false,
  }
}

/** The Search fixture's Master subset as the Master root the screen passes to the Search. */
const master: MasterDataRoot = {
  ...createValidMasterDataFixture(),
  weaponBonusDefinitions: [],
  weaponTypes: [],
  elements: [],
  bonusTypes: [],
  bonusRanks: searchMasterFixture.bonusRanks,
  artianBonusTypeMappings: searchMasterFixture.artianBonusTypeMappings,
  materialCosts: [],
}

const fixture = createFixtureInput()

/** An Engine whose predictions are never Ideal, so only an owned Ideal Gogma can be a Candidate. */
const engine: RngEngine = {
  version: fixture.calculationContext.rngEngineVersion,
  capabilities: {
    supportsNormalArtianPrediction: true,
    supportsGogmaPrediction: true,
    supportsSkillPrediction: true,
    supportsKeepBonusesPrediction: true,
  },
  getPredictionSupport: () => ({ supported: true }),
  normalizeSeed: (seed) => seed,
  predictNormalArtian: () => belowPracticalBonuses(),
  predictSkills: () => ({ seriesSkillId: 'series_skill.fixture.other', groupSkillId: null }),
  predictGogmaBonus: () => belowPracticalBonuses(),
  advanceGogmaCounter: (current) => current + 1,
  advanceSkillCounter: (current) => current + 1,
  advanceNormalCounter: (current, operation) => current + operation.count,
}

/** The real Candidate Search behind the Worker Client contract. */
class InProcessSearchClient implements SearchWorkerClient {
  readonly engineVersion = engine.version
  readonly inputs: CandidateSearchInput[] = []
  startSearch(input: CandidateSearchInput): Promise<CandidateSearchResult> {
    this.inputs.push(input)
    return searchCandidates(input, engine, { now: () => SEARCH_FIXTURE_TIME, nowMs: () => 100 })
  }
  cancelSearch() {}
  dispose() {}
}

function searchRepositories(database: AppDatabase): SearchInputRepositories {
  return {
    ensureInitialRngState: () => new RngStateRepository(database).ensureInitialRngState(),
    getAllNormalArtianCounters: () => new NormalArtianCounterRepository(database).getAllNormalArtianCounters(),
    getAllOwnedWeapons: () => new OwnedWeaponRepository(database).getAllOwnedWeapons(),
    getAllTargetWeapons: () => new TargetWeaponRepository(database).getAllTargetWeapons(),
    ensureSettings: async () => (await database.settings.get('settings'))!,
  }
}

function dependenciesOf(database: AppDatabase, client: InProcessSearchClient): SearchPageDependencies {
  const targets = new TargetWeaponRepository(database)
  const weapons = new OwnedWeaponRepository(database)
  const entries = new BuildListEntryRepository(database)
  const candidates = new BuildCandidateRepository(database)
  return {
    master,
    getTargets: () => targets.getAllTargetWeapons(),
    getOwnedWeapons: () => weapons.getAllOwnedWeapons(),
    getBuildListEntries: () => entries.getAllBuildListEntries(),
    getReidentificationReminder: async () => ({ kind: 'none' as const }),
    // Small bounds keep the real search short; the owned Ideals are zero-operation Candidates.
    getCandidateSearchDefaults: async () => ({ maxNormalAdvance: 1, maxGogmaAdvance: 1, maxSkillAdvance: 1 }),
    createWorkerClient: () => client,
    prepareInput: (options) => prepareCandidateSearchInput(options, {
      repositories: searchRepositories(database),
      stateReader: createCandidateSearchStateReader(database),
    }),
    saveCandidates: (targetId, found) => candidates.replaceBuildCandidatesForTarget(targetId, found),
    addCandidate: vi.fn(async () => { throw new Error('not used in this test') }),
    inspectCandidateReplacement: vi.fn(async () => ({ approvalRequired: false as const })),
    replaceCandidate: vi.fn(async () => { throw new Error('not used in this test') }),
    inspectCompleteWithOwnedIdeal: vi.fn(async () => ({ approvalRequired: false as const })),
    completeWithOwnedIdeal: vi.fn(async () => { throw new Error('not used in this test') }),
  }
}

/**
 * T is searched and prefers Y. U prefers X, and U's non-stale Build List Entry starts from Y. Z is used by nobody.
 */
async function seed(database: AppDatabase): Promise<{ u: TargetWeapon }> {
  const ownedWeapons = [
    idealGogma(X, '武器X', '2026-01-01T00:00:00.000Z'),
    idealGogma(Y, '武器Y', '2026-01-02T00:00:00.000Z'),
    idealGogma(Z, '武器Z', '2026-01-03T00:00:00.000Z'),
  ]
  const t: TargetWeapon = { ...createValidTargetWeapon(), id: T, name: '検索する目標', createdAt: '2026-01-01T00:00:00.000Z', preferredOwnedWeaponId: Y }
  const u: TargetWeapon = { ...createValidTargetWeapon(), id: U, name: '別の目標', createdAt: '2026-01-02T00:00:00.000Z', preferredOwnedWeaponId: X }
  const route: BuildRoute = { kind: 'existing_gogma_current', sourceOwnedWeaponId: Y, operations: [] }
  const candidate: BuildCandidate = {
    ...createValidBuildCandidate(),
    id: candidateId('candidate.u'),
    targetWeaponId: U,
    route,
    searchStateHash: createSearchStateHash(route, fixture.rngState, fixture.normalCounters),
    referencedOwnedWeaponsHash: createReferencedOwnedWeaponsHash(route, ownedWeapons),
    // The context the screen searches with, so the Entry is not stale for it.
    calculationContext: {
      gameVersion: master.manifest.gameVersion,
      masterDataVersion: master.manifest.dataVersion,
      rngEngineVersion: engine.version,
      appSchemaVersion: CURRENT_CALCULATION_APP_SCHEMA_VERSION,
    },
  }
  await database.rngState.put(fixture.rngState)
  await database.normalArtianCounters.bulkPut(fixture.normalCounters)
  await database.ownedWeapons.bulkPut(ownedWeapons)
  await database.targetWeapons.bulkPut([t, u])
  await database.buildListEntries.put(createBuildListEntry(candidate, u, { id: buildListEntryId('entry.u'), createdAt: '2026-10-17T00:00:00.000Z' }))
  return { u }
}

describe('SearchPage source exclusion over the persisted state (Issue #157 PR-4)', () => {
  it('excludes another Target\'s preferred weapon and Build List source, and keeps the reasons read when the search started', async () => {
    await withDatabase(async (database) => {
      const { u } = await seed(database)
      const user = userEvent.setup()
      const client = new InProcessSearchClient()
      const view = render(<SearchPage dependencies={dependenciesOf(database, client)} />, { wrapper: MemoryRouter })

      await user.click(await screen.findByRole('checkbox', { name: '他の目標武器で使用する所持武器を除外する' }))
      await user.click(screen.getByRole('button', { name: '検索開始' }))
      const result = await screen.findByRole('region', { name: '検索結果' }, { timeout: 10_000 })

      // The Worker input carries the derived IDs; the Search Domain excluded both.
      expect(client.inputs).toHaveLength(1)
      expect(client.inputs[0].targetWeaponId).toBe(T)
      expect(client.inputs[0].excludedSourceOwnedWeaponIds).toEqual([X, Y])
      expect(within(result).getByText('他の目標武器で使用する所持武器: 除外する')).toBeInTheDocument()
      expect(within(result).getByText('他の目標武器で使用する所持武器（2本）を起点から除外して検索しました。')).toBeInTheDocument()

      // The only Route left starts from Z; T's own preference Y was another Target's Build List source.
      const card = within(result).getByRole('region', { name: '理想候補' })
      const notice = within(card).getByText('優先する所持武器を使用しないルートです').closest<HTMLElement>('[role="alert"]')!
      expect(within(notice).getByText('このルートの起点: 所持武器「武器Z」')).toBeInTheDocument()
      expect(within(notice).getByText(
        'この検索では、優先する所持武器を起点から除外しました（目標武器「別の目標」の作成リストの候補が起点に使用しているため）。',
      )).toBeInTheDocument()

      const readRows = async () => {
        const list = within(resultRegion()).getByRole('list', { name: '除外した所持武器' })
        return within(list).getAllByRole('listitem').filter((item) => item.parentElement === list).map((row) => row.textContent)
      }
      await user.click(within(result).getByRole('button', { name: '除外した所持武器（2本）' }))
      const before = await readRows()
      expect(before).toEqual([
        '武器X目標武器「別の目標」の優先する所持武器',
        '武器Y目標武器「別の目標」の作成リストの候補が起点に使用',
      ])

      // The persisted state and the Checkbox change after the search: the shown reasons stay those of that search.
      await database.targetWeapons.put({ ...u, name: '改名した目標', preferredOwnedWeaponId: null })
      await database.buildListEntries.clear()
      await user.click(screen.getByRole('checkbox', { name: '他の目標武器で使用する所持武器を除外する' }))
      expect(await readRows()).toEqual(before)
      expect(within(resultRegion()).getByText('他の目標武器で使用する所持武器: 除外する')).toBeInTheDocument()
      expect(view.container.textContent).not.toMatch(/owned\.|target\.|entry\./)

      // The next search reads the persisted state again: nothing is excluded now.
      await user.click(screen.getByRole('checkbox', { name: '他の目標武器で使用する所持武器を除外する' }))
      await user.click(screen.getByRole('button', { name: '検索開始' }))
      await waitFor(() => expect(client.inputs).toHaveLength(2))
      expect(client.inputs[1].excludedSourceOwnedWeaponIds).toEqual([])
      expect(await within(await screen.findByRole('region', { name: '検索結果' })).findByText(
        '他の目標武器で使用する所持武器: 除外する（除外の対象になる所持武器はありませんでした）',
      )).toBeInTheDocument()
    })
  })
})

function resultRegion() {
  return screen.getByRole('region', { name: '検索結果' })
}
