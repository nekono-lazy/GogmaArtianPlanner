import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import type { OwnedWeapon, TargetWeapon } from '../../domain/models/publicTypes'
import {
  createOwnedWeaponDraft,
  createTargetWeaponDraft,
} from '../../domain/forms/entityDrafts'
import { DOMAIN_FIXTURE_TIME } from '../../test/fixtures/domainData'
import { createValidMasterDataFixture } from '../../test/fixtures/masterData'
import { AppDatabase } from '../../db/AppDatabase'
import { ReferenceFinder } from '../../db/referenceFinder'
import { OwnedWeaponRepository } from '../../db/repositories/ownedWeaponRepository'
import { TargetWeaponRepository } from '../../db/repositories/targetWeaponRepository'
import { runInRepositoryTransaction } from '../../db/transaction'
import {
  EntityFormValidationError,
  OwnedWeaponCrudService,
  ReferencedEntityDeleteError,
  TargetWeaponCrudService,
  type OwnedWeaponDraft,
  type TargetWeaponDraft,
} from './entityCrudServices'

const master = createValidMasterDataFixture()

let databaseSequence = 0

/** The real repository-backed services over one real Dexie database. */
function services(database: AppDatabase) {
  const targets = new TargetWeaponRepository(database)
  const weapons = new OwnedWeaponRepository(database)
  const finder = new ReferenceFinder(database)
  const targetDependencies = {
    getAll: () => targets.getAllTargetWeapons(),
    getOwnedWeapons: () => weapons.getAllOwnedWeapons(),
    put: (value: TargetWeapon) => targets.putTargetWeapon(value),
    putReleasingTargets: (
      value: TargetWeapon,
      released: readonly TargetWeapon[],
    ) =>
      runInRepositoryTransaction(database, [database.targetWeapons], async () => {
        for (const target of released) await targets.putTargetWeapon(target)
        return targets.putTargetWeapon(value)
      }),
    delete: (id: TargetWeapon['id']) => targets.deleteTargetWeapon(id),
    findReferences: (id: TargetWeapon['id']) =>
      finder.findTargetWeaponReferences(id),
  }
  return {
    targets,
    weapons,
    finder,
    targetDependencies,
    targetService: new TargetWeaponCrudService(master, targetDependencies),
    ownedService: new OwnedWeaponCrudService(master, {
      getAll: () => weapons.getAllOwnedWeapons(),
      getTargets: () => targets.getAllTargetWeapons(),
      put: (value) => weapons.putOwnedWeapon(value),
      putReleasingTargets: (value, released) =>
        runInRepositoryTransaction(
          database,
          [database.ownedWeapons, database.targetWeapons],
          async () => {
            for (const target of released) await targets.putTargetWeapon(target)
            return weapons.putOwnedWeapon(value)
          },
        ),
      delete: (id) => weapons.deleteOwnedWeapon(id),
      findReferences: (id) => finder.findOwnedWeaponReferences(id),
    }),
  }
}

type Scenario = Awaited<ReturnType<typeof setUp>>

/**
 * Two master-valid Targets and two master-valid owned weapons, saved through
 * the real services so every record satisfies Domain and Master validation.
 */
async function setUp(database: AppDatabase) {
  const api = services(database)
  const ownedDraft = (name: string): OwnedWeaponDraft => ({
    ...createOwnedWeaponDraft(master),
    name,
    isProtected: false,
  })
  const targetDraft = (name: string): TargetWeaponDraft => ({
    ...createTargetWeaponDraft(master),
    name,
  })
  const firstWeapon = await api.ownedService.save(
    ownedDraft('weapon-one'),
    null,
    DOMAIN_FIXTURE_TIME,
  )
  const secondWeapon = await api.ownedService.save(
    ownedDraft('weapon-two'),
    null,
    DOMAIN_FIXTURE_TIME,
  )
  const firstTarget = await api.targetService.save(
    targetDraft('target-one'),
    null,
    DOMAIN_FIXTURE_TIME,
  )
  const secondTarget = await api.targetService.save(
    targetDraft('target-two'),
    null,
    DOMAIN_FIXTURE_TIME,
  )
  return { ...api, firstWeapon, secondWeapon, firstTarget, secondTarget }
}

function draftOf<T extends { id: unknown; createdAt: unknown; updatedAt: unknown }>(
  value: T,
) {
  const { id: _id, createdAt: _created, updatedAt: _updated, ...draft } = value
  void _id
  void _created
  void _updated
  return draft
}

async function withScenario(
  test: (scenario: Scenario, database: AppDatabase) => Promise<void>,
): Promise<void> {
  databaseSequence += 1
  const name = `preferred-persistence-${databaseSequence}`
  const database = new AppDatabase(name)
  await database.open()
  try {
    await test(await setUp(database), database)
  } finally {
    database.close()
    await Dexie.delete(name)
  }
}

/** Gives the Target the weapon as its preferred origin, through the Service. */
function prefer(
  scenario: Scenario,
  target: TargetWeapon,
  weapon: OwnedWeapon | null,
) {
  return scenario.targetService.save(
    {
      ...draftOf(target),
      preferredOwnedWeaponId: weapon?.id ?? null,
    } as TargetWeaponDraft,
    target,
    DOMAIN_FIXTURE_TIME,
  )
}

describe('preferred owned weapon persistence', () => {
  it('reassigns a weapon between Targets atomically', () =>
    withScenario(async (scenario) => {
      await prefer(scenario, scenario.firstTarget, scenario.firstWeapon)
      await prefer(scenario, scenario.secondTarget, scenario.firstWeapon)

      // Exactly one Target holds the weapon afterwards: never both, never
      // neither (`docs/DATA_MODEL.md` 8.5).
      expect(
        (await scenario.targets.getTargetWeapon(scenario.firstTarget.id))
          ?.preferredOwnedWeaponId,
      ).toBeNull()
      expect(
        (await scenario.targets.getTargetWeapon(scenario.secondTarget.id))
          ?.preferredOwnedWeaponId,
      ).toBe(scenario.firstWeapon.id)
    }))

  it('leaves both Targets unchanged when the reassignment transaction fails', () =>
    withScenario(async (scenario, database) => {
      await prefer(scenario, scenario.firstTarget, scenario.firstWeapon)
      const failing = new TargetWeaponCrudService(master, {
        ...scenario.targetDependencies,
        putReleasingTargets: (_value, released) =>
          runInRepositoryTransaction(
            database,
            [database.targetWeapons],
            async () => {
              for (const target of released) {
                await scenario.targets.putTargetWeapon(target)
              }
              // The release already succeeded inside this transaction; the
              // failure must roll it back together with the rest.
              throw new Error('persistence failure')
            },
          ),
      })

      await expect(
        failing.save(
          {
            ...draftOf(scenario.secondTarget),
            preferredOwnedWeaponId: scenario.firstWeapon.id,
          } as TargetWeaponDraft,
          scenario.secondTarget,
          DOMAIN_FIXTURE_TIME,
        ),
      ).rejects.toThrow()

      expect(
        (await scenario.targets.getTargetWeapon(scenario.firstTarget.id))
          ?.preferredOwnedWeaponId,
      ).toBe(scenario.firstWeapon.id)
      expect(
        (await scenario.targets.getTargetWeapon(scenario.secondTarget.id))
          ?.preferredOwnedWeaponId,
      ).toBeNull()
    }))

  it('protects a weapon and releases its Target atomically', () =>
    withScenario(async (scenario) => {
      await prefer(scenario, scenario.firstTarget, scenario.firstWeapon)

      await scenario.ownedService.save(
        { ...draftOf(scenario.firstWeapon), isProtected: true } as OwnedWeaponDraft,
        scenario.firstWeapon,
        DOMAIN_FIXTURE_TIME,
      )

      expect(
        (await scenario.weapons.getOwnedWeapon(scenario.firstWeapon.id))
          ?.isProtected,
      ).toBe(true)
      // A Target must never be left holding a protected weapon.
      expect(
        (await scenario.targets.getTargetWeapon(scenario.firstTarget.id))
          ?.preferredOwnedWeaponId,
      ).toBeNull()
    }))

  it('leaves an unrelated weapon save alone', () =>
    withScenario(async (scenario) => {
      await prefer(scenario, scenario.firstTarget, scenario.firstWeapon)

      await scenario.ownedService.save(
        { ...draftOf(scenario.firstWeapon), memo: 'edited' } as OwnedWeaponDraft,
        scenario.firstWeapon,
        DOMAIN_FIXTURE_TIME,
      )

      expect(
        (await scenario.targets.getTargetWeapon(scenario.firstTarget.id))
          ?.preferredOwnedWeaponId,
      ).toBe(scenario.firstWeapon.id)
    }))

  it('rejects a save whose preference is invalid for the whole collection', () =>
    withScenario(async (scenario) => {
      const locked = await scenario.ownedService.save(
        { ...draftOf(scenario.secondWeapon), isProtected: true } as OwnedWeaponDraft,
        scenario.secondWeapon,
        DOMAIN_FIXTURE_TIME,
      )

      await expect(
        prefer(scenario, scenario.firstTarget, locked),
      ).rejects.toBeInstanceOf(EntityFormValidationError)
      expect(
        (await scenario.targets.getTargetWeapon(scenario.firstTarget.id))
          ?.preferredOwnedWeaponId,
      ).toBeNull()
    }))

  it('blocks deleting an OwnedWeapon a Target prefers', () =>
    withScenario(async (scenario) => {
      await prefer(scenario, scenario.firstTarget, scenario.firstWeapon)

      expect(
        await scenario.finder.findOwnedWeaponReferences(scenario.firstWeapon.id),
      ).toContainEqual({
        kind: 'target_weapon',
        entityId: scenario.firstTarget.id,
        path: 'preferredOwnedWeaponId',
      })
      await expect(
        scenario.ownedService.delete(scenario.firstWeapon.id),
      ).rejects.toBeInstanceOf(ReferencedEntityDeleteError)
      expect(
        await scenario.weapons.getOwnedWeapon(scenario.firstWeapon.id),
      ).toBeDefined()
    }))

  it('no longer blocks deleting a Target on inventory alone', () =>
    withScenario(async (scenario) => {
      await prefer(scenario, scenario.firstTarget, scenario.firstWeapon)

      // The relation now lives on the Target, so deleting the Target removes
      // the reference instead of being blocked by it.
      expect(
        await scenario.finder.findTargetWeaponReferences(scenario.firstTarget.id),
      ).toEqual([])
      await scenario.targetService.delete(scenario.firstTarget.id)
      expect(
        await scenario.weapons.getOwnedWeapon(scenario.firstWeapon.id),
      ).toBeDefined()
    }))
})
