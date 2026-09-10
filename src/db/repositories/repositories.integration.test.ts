import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import type {
  BuildCandidate,
  BuildListEntry,
  ProductionPlan,
  RestorationBonusSet,
  RngState,
  TargetWeapon,
} from '../../domain/models/publicTypes'
import {
  DOMAIN_FIXTURE_TIME,
  buildListEntryId,
  candidateId,
  createValidBuildCandidate,
  createValidBuildListEntry,
  createValidExecutionHistory,
  createValidNormalArtianCounter,
  createValidOwnedWeapon,
  createValidProductionPlan,
  createValidRngState,
  createValidTargetWeapon,
  executionHistoryId,
  ownedWeaponId,
  planStepId,
  productionPlanId,
  targetWeaponId,
} from '../../test/fixtures/domainData'
import { AppDatabase } from '../AppDatabase'
import { ReferenceFinder } from '../referenceFinder'
import { RepositoryError } from '../repositoryError'
import { SettingsRepository } from '../settingsRepository'
import { runInPersistenceTransaction } from '../transaction'
import { BuildCandidateRepository } from './buildCandidateRepository'
import { BuildListEntryRepository } from './buildListEntryRepository'
import { ExecutionHistoryRepository } from './executionHistoryRepository'
import { NormalArtianCounterRepository } from './normalArtianCounterRepository'
import { OwnedWeaponRepository } from './ownedWeaponRepository'
import { ProductionPlanRepository } from './productionPlanRepository'
import { RngStateRepository } from './rngStateRepository'
import { TargetWeaponRepository } from './targetWeaponRepository'

let databaseSequence = 0

async function withDatabase(
  test: (database: AppDatabase) => Promise<void>,
): Promise<void> {
  databaseSequence += 1
  const name = `repository-integration-${databaseSequence}`
  const database = new AppDatabase(name)
  await database.open()
  try {
    await test(database)
  } finally {
    database.close()
    await Dexie.delete(name)
  }
}

function candidateForTarget(
  targetId: string,
  id: string,
): BuildCandidate {
  const candidate = createValidBuildCandidate()
  candidate.id = candidateId(id)
  candidate.targetWeaponId = targetWeaponId(targetId)
  return candidate
}

function entryForCandidate(
  candidate: BuildCandidate,
  id: string,
): BuildListEntry {
  const entry = createValidBuildListEntry()
  entry.id = buildListEntryId(id)
  entry.candidateId = candidate.id
  entry.targetWeaponId = candidate.targetWeaponId
  entry.candidateSnapshot = candidate
  entry.searchStateHash = candidate.searchStateHash
  entry.referencedOwnedWeaponsHash = candidate.referencedOwnedWeaponsHash
  entry.calculationContext = { ...candidate.calculationContext }
  return entry
}

function planWithIdentity(id: string, stepId: string): ProductionPlan {
  const plan = createValidProductionPlan()
  plan.id = productionPlanId(id)
  plan.steps[0].id = planStepId(stepId)
  plan.currentStepId = plan.steps[0].id
  return plan
}

describe('RngStateRepository', () => {
  it('creates initial state and does not overwrite an existing state', () =>
    withDatabase(async (database) => {
      const repository = new RngStateRepository(database)
      const initial = await repository.ensureInitialRngState(DOMAIN_FIXTURE_TIME)
      expect(initial.id).toBe('current')

      const existing = createValidRngState()
      await repository.putRngState(existing)
      expect(
        await repository.ensureInitialRngState('2026-08-30T00:00:00.000Z'),
      ).toEqual(existing)
    }))

  it('rejects an ID other than current', () =>
    withDatabase(async (database) => {
      const repository = new RngStateRepository(database)
      const state = createValidRngState()
      state.id = 'invalid' as RngState['id']
      await expect(repository.putRngState(state)).rejects.toMatchObject({
        code: 'validation_failed',
      })
    }))
})

describe('NormalArtianCounterRepository', () => {
  it('saves and gets a counter by weapon type plus rarity', () =>
    withDatabase(async (database) => {
      const repository = new NormalArtianCounterRepository(database)
      const counter = createValidNormalArtianCounter()
      await repository.putNormalArtianCounter(counter)
      expect(
        await repository.getNormalArtianCounter(
          counter.weaponTypeId,
          counter.rarity,
        ),
      ).toEqual(counter)
    }))

  it('rejects an invalid derived ID', () =>
    withDatabase(async (database) => {
      const repository = new NormalArtianCounterRepository(database)
      const counter = createValidNormalArtianCounter()
      counter.id = 'invalid'
      await expect(
        repository.putNormalArtianCounter(counter),
      ).rejects.toMatchObject({ code: 'validation_failed' })
    }))
})

describe('OwnedWeaponRepository and TargetWeaponRepository', () => {
  it('saves, reads, filters, and deletes OwnedWeapons', () =>
    withDatabase(async (database) => {
      const repository = new OwnedWeaponRepository(database)
      const weapon = createValidOwnedWeapon()
      await repository.putOwnedWeapon(weapon)
      expect(await repository.getOwnedWeapon(weapon.id)).toEqual(weapon)
      expect(await repository.getOwnedWeaponsByStatus('practical')).toEqual([
        weapon,
      ])
      await repository.deleteOwnedWeapon(weapon.id)
      expect(await repository.getOwnedWeapon(weapon.id)).toBeUndefined()
    }))

  it('rejects an invalid OwnedWeapon', () =>
    withDatabase(async (database) => {
      const repository = new OwnedWeaponRepository(database)
      const weapon = createValidOwnedWeapon()
      weapon.restorationBonuses = weapon.restorationBonuses.slice(
        0,
        4,
      ) as RestorationBonusSet
      await expect(repository.putOwnedWeapon(weapon)).rejects.toMatchObject({
        code: 'validation_failed',
      })
    }))

  it('saves Targets and returns only enabled Targets', () =>
    withDatabase(async (database) => {
      const repository = new TargetWeaponRepository(database)
      const enabled = createValidTargetWeapon()
      const disabled: TargetWeapon = {
        ...createValidTargetWeapon(),
        id: targetWeaponId('target.fixture.disabled'),
        isEnabled: false,
      }
      await repository.putTargetWeapon(enabled)
      await repository.putTargetWeapon(disabled)
      expect(await repository.getTargetWeapon(enabled.id)).toEqual(enabled)
      expect(await repository.getEnabledTargetWeapons()).toEqual([enabled])
    }))

  it('rejects an invalid TargetWeapon', () =>
    withDatabase(async (database) => {
      const repository = new TargetWeaponRepository(database)
      const target = createValidTargetWeapon()
      target.priority = 0 as TargetWeapon['priority']
      await expect(repository.putTargetWeapon(target)).rejects.toMatchObject({
        code: 'validation_failed',
      })
    }))
})

describe('BuildCandidateRepository', () => {
  it('gets and atomically replaces Candidates by Target', () =>
    withDatabase(async (database) => {
      const repository = new BuildCandidateRepository(database)
      const oldCandidate = createValidBuildCandidate()
      const replacement = candidateForTarget(
        oldCandidate.targetWeaponId,
        'candidate.fixture.replacement',
      )
      await repository.putBuildCandidate(oldCandidate)
      await repository.replaceBuildCandidatesForTarget(
        oldCandidate.targetWeaponId,
        [replacement],
      )
      expect(
        await repository.getBuildCandidatesByTarget(oldCandidate.targetWeaponId),
      ).toEqual([replacement])
    }))

  it('rolls back deletion when replacement persistence fails', () =>
    withDatabase(async (database) => {
      const repository = new BuildCandidateRepository(database)
      const oldCandidate = createValidBuildCandidate()
      const otherTargetCandidate = candidateForTarget(
        'target.fixture.other',
        'candidate.fixture.conflict',
      )
      const conflictingReplacement = candidateForTarget(
        oldCandidate.targetWeaponId,
        'candidate.fixture.conflict',
      )
      await repository.putBuildCandidate(oldCandidate)
      await repository.putBuildCandidate(otherTargetCandidate)

      await expect(
        repository.replaceBuildCandidatesForTarget(
          oldCandidate.targetWeaponId,
          [conflictingReplacement],
        ),
      ).rejects.toBeInstanceOf(RepositoryError)
      expect(await repository.getBuildCandidate(oldCandidate.id)).toEqual(
        oldCandidate,
      )
    }))

  it('does not delete BuildListEntry snapshots during replacement', () =>
    withDatabase(async (database) => {
      const candidates = new BuildCandidateRepository(database)
      const entries = new BuildListEntryRepository(database)
      const candidate = createValidBuildCandidate()
      const entry = createValidBuildListEntry()
      await candidates.putBuildCandidate(candidate)
      await entries.putBuildListEntry(entry)
      await candidates.replaceBuildCandidatesForTarget(
        candidate.targetWeaponId,
        [],
      )
      expect(await entries.getBuildListEntry(entry.id)).toEqual(entry)
    }))
})

describe('BuildListEntryRepository', () => {
  it('stores entries by Target and distinguishes stale entries', () =>
    withDatabase(async (database) => {
      const repository = new BuildListEntryRepository(database)
      const currentCandidate = createValidBuildCandidate()
      const current = entryForCandidate(
        currentCandidate,
        'build-list.fixture.current',
      )
      const staleCandidate = candidateForTarget(
        currentCandidate.targetWeaponId,
        'candidate.fixture.stale',
      )
      const stale = entryForCandidate(staleCandidate, 'build-list.fixture.stale')
      stale.isStale = true
      stale.staleReasons = ['rng_state_changed']
      await repository.putBuildListEntry(current)
      await repository.putBuildListEntry(stale)

      expect(
        await repository.getBuildListEntriesByTarget(
          currentCandidate.targetWeaponId,
        ),
      ).toHaveLength(2)
      expect(await repository.getNonStaleBuildListEntries()).toEqual([current])
    }))

  it('keeps a valid Snapshot when the originating Candidate is absent', () =>
    withDatabase(async (database) => {
      const repository = new BuildListEntryRepository(database)
      const entry = createValidBuildListEntry()
      await repository.putBuildListEntry(entry)
      expect(await database.buildCandidates.count()).toBe(0)
      expect(await repository.getBuildListEntry(entry.id)).toEqual(entry)
    }))
})

describe('ProductionPlanRepository', () => {
  it('saves Plans and enforces a single active Plan', () =>
    withDatabase(async (database) => {
      const repository = new ProductionPlanRepository(database)
      const first = planWithIdentity('plan.fixture.first', 'step.fixture.first')
      first.status = 'active'
      const second = planWithIdentity('plan.fixture.second', 'step.fixture.second')
      second.status = 'active'
      await repository.putProductionPlan(first)
      expect(await repository.getActiveProductionPlan()).toEqual(first)
      await expect(repository.putProductionPlan(second)).rejects.toMatchObject({
        code: 'active_plan_conflict',
      })
      expect(await database.productionPlans.where('status').equals('active').count()).toBe(1)
    }))

  it('switches active Plans atomically using an explicit previous snapshot', () =>
    withDatabase(async (database) => {
      const repository = new ProductionPlanRepository(database)
      const first = planWithIdentity('plan.fixture.first', 'step.fixture.first')
      first.status = 'active'
      const second = planWithIdentity('plan.fixture.second', 'step.fixture.second')
      await repository.putProductionPlan(first)
      await repository.putProductionPlan(second)
      const previousReplacement: ProductionPlan = {
        ...first,
        status: 'abandoned',
      }

      const activated = await repository.activateProductionPlan(
        second.id,
        previousReplacement,
        DOMAIN_FIXTURE_TIME,
      )
      expect(activated.status).toBe('active')
      expect((await repository.getProductionPlan(first.id))?.status).toBe(
        'abandoned',
      )
      expect(await repository.getActiveProductionPlan()).toEqual(activated)
    }))

  it('keeps the current active Plan when a switch fails', () =>
    withDatabase(async (database) => {
      const repository = new ProductionPlanRepository(database)
      const current = planWithIdentity('plan.fixture.current', 'step.fixture.current')
      current.status = 'active'
      await repository.putProductionPlan(current)
      await expect(
        repository.activateProductionPlan(
          productionPlanId('plan.fixture.missing'),
          { ...current, status: 'abandoned' },
        ),
      ).rejects.toMatchObject({ code: 'not_found' })
      expect(await repository.getActiveProductionPlan()).toEqual(current)
    }))
})

describe('ExecutionHistoryRepository', () => {
  it('stores, orders, gets latest, and deletes Plan history', () =>
    withDatabase(async (database) => {
      const repository = new ExecutionHistoryRepository(database)
      const first = createValidExecutionHistory()
      first.id = executionHistoryId('history.fixture.a')
      const second = createValidExecutionHistory()
      second.id = executionHistoryId('history.fixture.b')
      await repository.putExecutionHistory(second)
      await repository.putExecutionHistory(first)
      expect(await repository.getExecutionHistoryByPlan(first.planId)).toEqual([
        first,
        second,
      ])
      expect(await repository.getLatestExecutionHistory(first.planId)).toEqual(
        second,
      )
      await repository.deleteExecutionHistory(second.id)
      expect(await repository.getExecutionHistory(second.id)).toBeUndefined()
    }))
})

describe('SettingsRepository and shared transaction boundary', () => {
  it('persists formal Settings and does not overwrite them on ensure', () =>
    withDatabase(async (database) => {
      const repository = new SettingsRepository({
        get: (id) => database.settings.get(id),
        add: (settings) => database.settings.add(settings),
        put: (settings) => database.settings.put(settings),
      })
      const initial = await repository.ensureSettings(DOMAIN_FIXTURE_TIME)
      const changed = { ...initial, debugMode: true }
      await repository.putSettings(changed)
      expect(
        await repository.ensureSettings('2026-08-30T00:00:00.000Z'),
      ).toEqual(changed)
    }))

  it('lets multiple Repositories join one atomic transaction', () =>
    withDatabase(async (database) => {
      const rng = new RngStateRepository(database)
      const weapons = new OwnedWeaponRepository(database)
      await expect(
        runInPersistenceTransaction(database, async () => {
          await rng.putRngState(createValidRngState())
          await weapons.putOwnedWeapon(createValidOwnedWeapon())
          throw new Error('fixture rollback')
        }),
      ).rejects.toMatchObject({ code: 'transaction_failed' })
      expect(await rng.getCurrentRngState()).toBeUndefined()
      expect(await weapons.getAllOwnedWeapons()).toEqual([])
    }))
})

describe('ReferenceFinder', () => {
  it('finds OwnedWeapon and Target references from BuildListEntry snapshots', () =>
    withDatabase(async (database) => {
      const sourceId = ownedWeaponId('owned.fixture.a')
      const candidate = createValidBuildCandidate()
      candidate.route = {
        kind: 'existing_gogma_reset_skills',
        sourceOwnedWeaponId: sourceId,
        operations: [
          {
            type: 'reset_skills',
            sourceOwnedWeaponId: sourceId,
            skillCounterBefore: 1,
            skillCounterAfter: 2,
          },
        ],
      }
      candidate.referencedOwnedWeaponsHash = 'hash.fixture.owned'
      const entry = entryForCandidate(candidate, 'build-list.fixture.reference')
      await new BuildListEntryRepository(database).putBuildListEntry(entry)

      const finder = new ReferenceFinder(database)
      expect(await finder.findOwnedWeaponReferences(sourceId)).toContainEqual(
        expect.objectContaining({ kind: 'build_list_entry', entityId: entry.id }),
      )
      expect(
        await finder.findTargetWeaponReferences(candidate.targetWeaponId),
      ).toContainEqual(
        expect.objectContaining({ kind: 'build_list_entry', entityId: entry.id }),
      )
    }))

  it('finds a shared non-primary Target progressed by a ProductionPlan step', () =>
    withDatabase(async (database) => {
      const sharedTargetId = targetWeaponId('target.fixture.shared')
      const plan = planWithIdentity('plan.fixture.shared', 'step.fixture.shared')
      plan.steps[0].progressedTargetWeaponIds = [
        plan.steps[0].targetWeaponId as typeof sharedTargetId,
        sharedTargetId,
      ]
      await new ProductionPlanRepository(database).putProductionPlan(plan)

      const finder = new ReferenceFinder(database)
      expect(await finder.findTargetWeaponReferences(sharedTargetId)).toEqual([
        {
          kind: 'production_plan',
          entityId: plan.id,
          path: 'steps[0].progressedTargetWeaponIds',
        },
      ])
      expect(
        await finder.findTargetWeaponReferences(
          plan.steps[0].targetWeaponId as typeof sharedTargetId,
        ),
      ).toEqual([
        {
          kind: 'production_plan',
          entityId: plan.id,
          path: 'steps[0].progressedTargetWeaponIds',
        },
        {
          kind: 'production_plan',
          entityId: plan.id,
          path: 'steps[0].targetWeaponId',
        },
      ])
    }))
})
