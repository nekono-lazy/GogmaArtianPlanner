import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { AppDatabase } from '../../db/AppDatabase'
import {
  BuildCandidateRepository,
  BuildListEntryRepository,
  NormalArtianCounterRepository,
  OwnedWeaponRepository,
  RngStateRepository,
  TargetWeaponRepository,
} from '../../db/repositories'
import { createBuildListEntry } from '../../domain/buildList'
import type { MasterDataRoot } from '../../domain/master/masterTypes'
import type {
  BuildCandidate,
  BuildListEntry,
  OwnedGogmaArtianWeapon,
  OwnedWeaponId,
  TargetWeapon,
} from '../../domain/models/publicTypes'
import { createReferencedOwnedWeaponsHash } from '../../domain/models/hashing'
import type { RngEngine } from '../../domain/rng/rngEngine'
import { searchCandidates, type CandidateSearchInput, type CandidateSearchResult } from '../../domain/search'
import {
  belowPracticalBonuses,
  createCandidateSearchInput as createFixtureInput,
  SEARCH_FIXTURE_TIME,
  searchMasterFixture,
} from '../../test/fixtures/candidateSearch'
import {
  createRestorationBonusSet,
  createValidOwnedWeapon,
  createValidTargetWeapon,
  ownedWeaponId,
  targetWeaponId,
} from '../../test/fixtures/domainData'
import { createValidMasterDataFixture } from '../../test/fixtures/masterData'
import { inMemoryPlanGuardedPersistence } from '../../test/fixtures/planGuardedPersistence'
import { BuildListService, type AddBuildListCandidateResult } from '../buildList/buildListService'
import {
  runBatchCandidateSearch,
  type BatchCandidateSearchDependencies,
  type BatchCandidateSearchSummary,
} from './batchCandidateSearch'
import type { SearchInputRepositories } from './createCandidateSearchInput'
import { createCandidateSearchStateReader, prepareCandidateSearchInput } from './prepareCandidateSearchInput'
import { SearchCancelledError, type SearchWorkerClient } from './searchWorkerClient'

/*
 * Issue #157 PR-3 (`docs/SEARCH_SPEC.md` 3.3「一括検索・追加」 / 13.7): the batch over a real Dexie database, the real
 * Candidate Search and the real Build List addition. Each Target's exclusion is derived from the persisted state right
 * before its search, so only an Entry that was really added is counted by a later Target.
 */

let databaseSequence = 0

async function withDatabase(test: (database: AppDatabase) => Promise<void>): Promise<void> {
  databaseSequence += 1
  const name = `batch-candidate-search-integration-${databaseSequence}`
  const database = new AppDatabase(name)
  await database.open()
  try {
    await test(database)
  } finally {
    database.close()
    await Dexie.delete(name)
  }
}

const A = targetWeaponId('target.a')
const B = targetWeaponId('target.b')
const C = targetWeaponId('target.c')
const X = ownedWeaponId('owned.x')
const Y = ownedWeaponId('owned.y')

function target(id: string, overrides: Partial<TargetWeapon> = {}): TargetWeapon {
  return { ...createValidTargetWeapon(), id: targetWeaponId(id), name: `目標 ${id}`, ...overrides }
}

/** An unprotected Gogma that already is the fixture Target's Ideal: a zero-operation Candidate for every Target. */
function idealGogma(id: OwnedWeaponId): OwnedGogmaArtianWeapon {
  return {
    ...createValidOwnedWeapon(id),
    restorationBonuses: createRestorationBonusSet(),
    seriesSkillId: 'series_skill.fixture.a',
    groupSkillId: null,
    status: 'unclassified',
    isProtected: false,
  }
}

/** The Search fixture's Master subset as the Master root a Search screen passes. */
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

/** The real Candidate Search behind the Worker Client contract; a held Target waits until it is cancelled. */
class InProcessSearchClient implements SearchWorkerClient {
  readonly engineVersion = engine.version
  readonly inputs: CandidateSearchInput[] = []
  private readonly held = new Map<string, (error: Error) => void>()
  private readonly holdTargetIds: ReadonlySet<string>
  constructor(holdTargetIds: ReadonlySet<string> = new Set()) {
    this.holdTargetIds = holdTargetIds
  }
  startSearch(input: CandidateSearchInput): Promise<CandidateSearchResult> {
    this.inputs.push(input)
    if (this.holdTargetIds.has(input.targetWeaponId)) {
      return new Promise((_, reject) => this.held.set(input.searchRunId, reject))
    }
    return searchCandidates(input, engine, { now: () => SEARCH_FIXTURE_TIME, nowMs: () => 100 })
  }
  cancelSearch(requestId: string) {
    this.held.get(requestId)?.(new SearchCancelledError())
    this.held.delete(requestId)
  }
  dispose() {}
  isHolding(targetId: string) {
    return this.inputs.some((input) => input.targetWeaponId === targetId) && this.held.size > 0
  }
}

async function seed(database: AppDatabase, targets: TargetWeapon[], weapons: OwnedWeaponId[] = [X, Y]) {
  await database.rngState.put(fixture.rngState)
  await database.normalArtianCounters.bulkPut(fixture.normalCounters)
  await database.ownedWeapons.bulkPut(weapons.map(idealGogma))
  await database.targetWeapons.bulkPut(targets)
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

function buildListServiceOf(database: AppDatabase): BuildListService {
  const entries = new BuildListEntryRepository(database)
  return new BuildListService({
    getAllEntries: () => entries.getAllBuildListEntries(),
    putEntry: (entry) => entries.putBuildListEntry(entry),
    decideAndAddEntry: (decide) => entries.decideAndAddBuildListEntry(decide),
    ensureRngState: () => new RngStateRepository(database).ensureInitialRngState(),
    getNormalCounters: () => new NormalArtianCounterRepository(database).getAllNormalArtianCounters(),
    getOwnedWeapons: () => new OwnedWeaponRepository(database).getAllOwnedWeapons(),
    getTargets: () => new TargetWeaponRepository(database).getAllTargetWeapons(),
    persistence: inMemoryPlanGuardedPersistence().persistence,
  })
}

interface BatchOptions {
  excludeOtherTargetSources: boolean
  client?: InProcessSearchClient
  saveCandidates?: BatchCandidateSearchDependencies['saveCandidates']
  addCandidate?: BatchCandidateSearchDependencies['addCandidate']
}

function startBatch(database: AppDatabase, targets: TargetWeapon[], batch: BatchOptions) {
  const client = batch.client ?? new InProcessSearchClient()
  const candidates = new BuildCandidateRepository(database)
  const service = buildListServiceOf(database)
  let runId = 0
  const run = runBatchCandidateSearch(
    {
      targets,
      routeFilter: 'existing_gogma',
      settings: { maxNormalAdvance: 1, maxGogmaAdvance: 1, maxSkillAdvance: 1 },
      master,
      calculationContext: fixture.calculationContext,
      excludeOtherTargetSources: batch.excludeOtherTargetSources,
    },
    {
      client,
      createSearchRunId: () => `batch-integration-${++runId}`,
      prepareInput: (options) => prepareCandidateSearchInput(options, {
        repositories: searchRepositories(database),
        stateReader: createCandidateSearchStateReader(database),
      }),
      saveCandidates: batch.saveCandidates ?? ((targetId, found) => candidates.replaceBuildCandidatesForTarget(targetId, found)),
      addCandidate: batch.addCandidate ?? ((candidate, t, selection) => service.addCandidate(candidate, t, selection)),
    },
  )
  return { client, run }
}

function sourceOf(entry: BuildListEntry): OwnedWeaponId | null {
  return entry.candidateSnapshot.route.sourceOwnedWeaponId
}

function summaryRows(summary: BatchCandidateSearchSummary) {
  return summary.outcomes.map((outcome) => outcome.status === 'added'
    ? [outcome.target.id, 'added', sourceOf(outcome.entry)]
    : outcome.status === 'no_candidate'
      ? [outcome.target.id, 'no_candidate', outcome.excludedSourceOwnedWeaponIds]
      : [outcome.target.id, outcome.status])
}

describe('runBatchCandidateSearch over the persisted state (Issue #157 PR-3)', () => {
  it('with the exclusion on, a later Target never starts from the weapon an earlier added Entry uses', async () => {
    await withDatabase(async (database) => {
      const targets = [target(A), target(B), target(C)]
      await seed(database, targets)
      const { client, run } = startBatch(database, targets, { excludeOtherTargetSources: true })
      const summary = await run.promise
      expect(summary.termination).toEqual({ status: 'completed' })
      expect(summaryRows(summary)).toEqual([
        [A, 'added', X],
        // A's Entry was persisted, so B's exclusion derived from the persisted state removes X.
        [B, 'added', Y],
        // Both owned Ideals are used by earlier Entries; nothing is guessed back.
        [C, 'no_candidate', [X, Y]],
      ])
      expect(client.inputs.map(({ targetWeaponId, excludedSourceOwnedWeaponIds }) => [targetWeaponId, excludedSourceOwnedWeaponIds]))
        .toEqual([[A, []], [B, [X]], [C, [X, Y]]])
      const persisted = await database.buildListEntries.toArray()
      expect(persisted.map((entry) => [entry.targetWeaponId, sourceOf(entry)]).sort()).toEqual([[A, X], [B, Y]])
    })
  })

  it('with the exclusion off, every Target searches as before and no input carries an exclusion', async () => {
    await withDatabase(async (database) => {
      const targets = [target(A), target(B), target(C)]
      await seed(database, targets)
      const { client, run } = startBatch(database, targets, { excludeOtherTargetSources: false })
      const summary = await run.promise
      expect(summaryRows(summary)).toEqual([[A, 'added', X], [B, 'added', X], [C, 'added', X]])
      expect(client.inputs.every((input) => !('excludedSourceOwnedWeaponIds' in input))).toBe(true)
      expect(summary.excludeOtherTargetSources).toBe(false)
    })
  })

  it('reserves nothing for a Target without a Candidate, or whose search, save or addition failed', async () => {
    const failures: Array<{ name: string; options: (database: AppDatabase) => Partial<BatchOptions> }> = [
      { name: 'search failure', options: () => ({ client: new FailingClient(A) }) },
      {
        name: 'save failure',
        options: (database) => ({
          saveCandidates: async (targetId, found) => {
            if (targetId === A) throw new Error('save failure')
            return new BuildCandidateRepository(database).replaceBuildCandidatesForTarget(targetId, found)
          },
        }),
      },
      {
        name: 'addition failure',
        options: (database) => ({
          addCandidate: async (candidate, t, selection) => {
            if (t.id === A) throw new Error('add failure')
            return buildListServiceOf(database).addCandidate(candidate, t, selection)
          },
        }),
      },
    ]
    for (const failure of failures) {
      await withDatabase(async (database) => {
        const targets = [target(A), target(B)]
        await seed(database, targets)
        const { client, run } = startBatch(database, targets, { excludeOtherTargetSources: true, ...failure.options(database) })
        const summary = await run.promise
        expect(summaryRows(summary), failure.name).toEqual([[A, 'failed'], [B, 'added', X]])
        expect(client.inputs.find(({ targetWeaponId }) => targetWeaponId === B)?.excludedSourceOwnedWeaponIds, failure.name).toEqual([])
      })
    }
    // A Target whose search found nothing (its definition matches no owned weapon) reserves nothing either.
    await withDatabase(async (database) => {
      const other = target(A, { weaponTypeId: 'weapon.fixture.other' })
      const targets = [other, target(B)]
      await seed(database, targets)
      const { client, run } = startBatch(database, targets, { excludeOtherTargetSources: true })
      const summary = await run.promise
      expect(summaryRows(summary)).toEqual([[A, 'no_candidate', []], [B, 'added', X]])
      expect(client.inputs.map(({ excludedSourceOwnedWeaponIds }) => excludedSourceOwnedWeaponIds)).toEqual([[], []])
    })
  })

  it('reserves nothing for a Candidate that was not added, while the Entry that made it not added counts on its own', async () => {
    await withDatabase(async (database) => {
      const targets = [target(A), target(B)]
      await seed(database, targets)
      const service = buildListServiceOf(database)
      const { client, run } = startBatch(database, targets, {
        excludeOtherTargetSources: true,
        // Another tab registers a Candidate of A from Y just before the batch adds A's Candidate from X.
        addCandidate: async (candidate, t, selection): Promise<AddBuildListCandidateResult> => {
          if (t.id === A) {
            const route = { ...candidate.route, sourceOwnedWeaponId: Y }
            const fromY: BuildCandidate = {
              ...candidate,
              id: `${candidate.id}.y` as BuildCandidate['id'],
              route,
              referencedOwnedWeaponsHash: createReferencedOwnedWeaponsHash(route, await database.ownedWeapons.toArray()),
            }
            await database.buildListEntries.add(createBuildListEntry(fromY, t, { createdAt: SEARCH_FIXTURE_TIME }))
          }
          return service.addCandidate(candidate, t, selection)
        },
      })
      const summary = await run.promise
      expect(summary.outcomes[0]).toMatchObject({ status: 'not_added', reason: 'replacement_required' })
      // X found for A is not reserved; the persisted Entry of A from Y is.
      expect(client.inputs.find(({ targetWeaponId }) => targetWeaponId === B)?.excludedSourceOwnedWeaponIds).toEqual([Y])
      expect(summaryRows(summary)[1]).toEqual([B, 'added', X])
    })
  })

  it('keeps an Entry added before a cancel, and a later search counts it', async () => {
    await withDatabase(async (database) => {
      const targets = [target(A), target(B), target(C)]
      await seed(database, targets)
      const client = new InProcessSearchClient(new Set([B]))
      const { run } = startBatch(database, targets, { excludeOtherTargetSources: true, client })
      for (let attempt = 0; attempt < 100 && !client.isHolding(B); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
      expect(client.isHolding(B)).toBe(true)
      run.cancel()
      const summary = await run.promise
      expect(summary.termination).toEqual({ status: 'cancelled' })
      expect(summaryRows(summary)).toEqual([[A, 'added', X]])
      expect(summary.notStarted.map(({ id }) => id)).toEqual([B, C])
      const persisted = await database.buildListEntries.toArray()
      expect(persisted.map((entry) => [entry.targetWeaponId, sourceOf(entry)])).toEqual([[A, X]])
      const later = await prepareCandidateSearchInput(
        {
          searchRunId: 'search.later',
          targetWeaponId: C,
          routeFilter: 'existing_gogma',
          settings: { maxNormalAdvance: 1, maxGogmaAdvance: 1, maxSkillAdvance: 1 },
          master,
          calculationContext: fixture.calculationContext,
          excludeOtherTargetSources: true,
        },
        { repositories: searchRepositories(database), stateReader: createCandidateSearchStateReader(database) },
      )
      expect(later.input.excludedSourceOwnedWeaponIds).toEqual([X])
    })
  })

  it('follows the persisted state as it is when each Target starts, a change made during the batch included', async () => {
    await withDatabase(async (database) => {
      const targets = [target(A), target(B)]
      const preferring = target(C, { isEnabled: false })
      await seed(database, [...targets, preferring])
      const service = buildListServiceOf(database)
      const { client, run } = startBatch(database, targets, {
        excludeOtherTargetSources: true,
        addCandidate: async (candidate, t, selection) => {
          const added = await service.addCandidate(candidate, t, selection)
          // After A, the user enables C, which prefers Y.
          if (t.id === A) await database.targetWeapons.update(C, { isEnabled: true, preferredOwnedWeaponId: Y })
          return added
        },
      })
      const summary = await run.promise
      expect(client.inputs.map(({ excludedSourceOwnedWeaponIds }) => excludedSourceOwnedWeaponIds)).toEqual([[], [X, Y]])
      expect(summaryRows(summary)).toEqual([[A, 'added', X], [B, 'no_candidate', [X, Y]]])
    })
  })
})

/** A Client whose search of one Target fails like a failed Worker request, and searches the rest for real. */
class FailingClient extends InProcessSearchClient {
  private readonly failingTargetId: string
  constructor(failingTargetId: string) {
    super()
    this.failingTargetId = failingTargetId
  }
  override startSearch(input: CandidateSearchInput): Promise<CandidateSearchResult> {
    if (input.targetWeaponId === this.failingTargetId) {
      this.inputs.push(input)
      return Promise.reject(new Error('search failure'))
    }
    return super.startSearch(input)
  }
}
