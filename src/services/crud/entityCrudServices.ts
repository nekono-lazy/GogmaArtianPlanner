import type { MasterDataRoot } from '../../domain/master/masterTypes'
import {
  validateOwnedWeaponMasterReferences,
  validateTargetWeaponMasterReferences,
} from '../../domain/master/entityMasterValidation'
import {
  createOwnedWeapon,
  createOwnedWeaponId,
  createTargetWeapon,
  createTargetWeaponId,
  validateOwnedWeapon,
  validateTargetWeapon,
  type OwnedWeapon,
  type OwnedWeaponId,
  type TargetWeapon,
  type TargetWeaponId,
} from '../../domain/models/publicTypes'
import {
  findTargetsInvalidatedByOwnedWeaponChange,
  validateTargetIdealImpliesPractical,
  validateTargetPreferredOwnedWeapons,
} from '../../domain/target'
import { ownedWeaponRepository, targetWeaponRepository } from '../../db/repositories'
import { referenceFinder, type PersistenceReference } from '../../db/referenceFinder'
import { appDatabase } from '../../db/AppDatabase'
import { runInRepositoryTransaction } from '../../db/transaction'

/**
 * Clears a Target's preferred owned weapon, keeping everything else intact.
 *
 * Used on both sides of the optional 1:1 relation: when another Target takes
 * the weapon over, and when the weapon itself becomes protected or
 * incompatible. Both releases are written in the same transaction as the change
 * that caused them, so no intermediate state where two Targets hold one weapon,
 * or where a Target holds a protected one, is ever persisted
 * (`docs/DATA_MODEL.md` 8.5).
 */
function releasePreferredOwnedWeapon(
  target: TargetWeapon,
  now: string,
): TargetWeapon {
  return { ...target, preferredOwnedWeaponId: null, updatedAt: now }
}

export class EntityFormValidationError extends Error {
  readonly issues: string[]
  constructor(issues: string[]) {
    super(issues.join('\n'))
    this.name = 'EntityFormValidationError'
    this.issues = issues
  }
}

export class ReferencedEntityDeleteError extends Error {
  readonly references: PersistenceReference[]
  constructor(references: PersistenceReference[]) {
    super('参照中のEntityは削除できません。')
    this.name = 'ReferencedEntityDeleteError'
    this.references = references
  }
}

type WithoutPersistenceFields<T> = T extends unknown
  ? Omit<T, 'id' | 'createdAt' | 'updatedAt'>
  : never
export type OwnedWeaponDraft = WithoutPersistenceFields<OwnedWeapon>
export type TargetWeaponDraft = Omit<TargetWeapon, 'id' | 'createdAt' | 'updatedAt'>

function domainMessages(result: { issues: Array<{ path: string; message: string }> }): string[] {
  return result.issues.map((issue) => `${issue.path || 'entity'}: ${issue.message}`)
}

export interface OwnedWeaponCrudDependencies {
  getAll(): Promise<OwnedWeapon[]>
  getTargets(): Promise<TargetWeapon[]>
  put(value: OwnedWeapon): Promise<OwnedWeapon>
  /**
   * Saves the weapon and releases every Target whose preference it invalidates,
   * atomically.
   */
  putReleasingTargets(
    value: OwnedWeapon,
    releasedTargets: readonly TargetWeapon[],
  ): Promise<OwnedWeapon>
  delete(id: OwnedWeaponId): Promise<void>
  findReferences(id: OwnedWeaponId): Promise<PersistenceReference[]>
}

export class OwnedWeaponCrudService {
  private readonly master: MasterDataRoot
  private readonly dependencies: OwnedWeaponCrudDependencies
  constructor(
    master: MasterDataRoot,
    dependencies: OwnedWeaponCrudDependencies = {
      getAll: () => ownedWeaponRepository.getAllOwnedWeapons(),
      getTargets: () => targetWeaponRepository.getAllTargetWeapons(),
      put: (value) => ownedWeaponRepository.putOwnedWeapon(value),
      putReleasingTargets: (value, releasedTargets) =>
        runInRepositoryTransaction(
          appDatabase,
          [appDatabase.ownedWeapons, appDatabase.targetWeapons],
          async () => {
            for (const target of releasedTargets) {
              await targetWeaponRepository.putTargetWeapon(target)
            }
            return ownedWeaponRepository.putOwnedWeapon(value)
          },
        ),
      delete: (id) => ownedWeaponRepository.deleteOwnedWeapon(id),
      findReferences: (id) => referenceFinder.findOwnedWeaponReferences(id),
    },
  ) {
    this.master = master
    this.dependencies = dependencies
  }

  getAll(): Promise<OwnedWeapon[]> { return this.dependencies.getAll() }

  async save(draft: OwnedWeaponDraft, existing: OwnedWeapon | null, now = new Date().toISOString()): Promise<OwnedWeapon> {
    const value = existing
      ? { ...draft, id: existing.id, createdAt: existing.createdAt, updatedAt: now }
      : createOwnedWeapon({ ...draft, id: createOwnedWeaponId() }, now)
    const issues = [
      ...(value.name.trim() ? [] : ['name: 名前を入力してください。']),
      ...domainMessages(validateOwnedWeapon(value)),
      ...validateOwnedWeaponMasterReferences(value, this.master),
    ]
    if (issues.length) throw new EntityFormValidationError(issues)
    // Protecting or re-typing a weapon a Target prefers would leave that Target
    // holding a preference the Domain rejects, so the link is released in the
    // same transaction rather than saved and repaired afterwards. The Owned
    // Weapons screen asks the user to confirm before reaching this point
    // (`docs/UI_FLOW.md` 7.1).
    const releasedTargets = findTargetsInvalidatedByOwnedWeaponChange(
      await this.dependencies.getTargets(),
      value.id,
      value,
    ).map((target) => releasePreferredOwnedWeapon(target, now))
    return releasedTargets.length === 0
      ? this.dependencies.put(value)
      : this.dependencies.putReleasingTargets(value, releasedTargets)
  }

  /** The Targets that would lose their preference if this draft were saved. */
  async findTargetsReleasedBySave(
    draft: OwnedWeaponDraft,
    existing: OwnedWeapon,
  ): Promise<TargetWeapon[]> {
    return findTargetsInvalidatedByOwnedWeaponChange(
      await this.dependencies.getTargets(),
      existing.id,
      draft,
    )
  }

  async delete(id: OwnedWeaponId): Promise<void> {
    const references = await this.dependencies.findReferences(id)
    if (references.length) throw new ReferencedEntityDeleteError(references)
    await this.dependencies.delete(id)
  }
}

export interface TargetWeaponCrudDependencies {
  getAll(): Promise<TargetWeapon[]>
  getOwnedWeapons(): Promise<OwnedWeapon[]>
  put(value: TargetWeapon): Promise<TargetWeapon>
  /**
   * Saves the Target and releases the Target that previously preferred the same
   * owned weapon, atomically.
   */
  putReleasingTargets(
    value: TargetWeapon,
    releasedTargets: readonly TargetWeapon[],
  ): Promise<TargetWeapon>
  delete(id: TargetWeaponId): Promise<void>
  findReferences(id: TargetWeaponId): Promise<PersistenceReference[]>
}

export class TargetWeaponCrudService {
  private readonly master: MasterDataRoot
  private readonly dependencies: TargetWeaponCrudDependencies
  constructor(
    master: MasterDataRoot,
    dependencies: TargetWeaponCrudDependencies = {
      getAll: () => targetWeaponRepository.getAllTargetWeapons(),
      getOwnedWeapons: () => ownedWeaponRepository.getAllOwnedWeapons(),
      put: (value) => targetWeaponRepository.putTargetWeapon(value),
      putReleasingTargets: (value, releasedTargets) =>
        runInRepositoryTransaction(
          appDatabase,
          [appDatabase.targetWeapons],
          async () => {
            for (const target of releasedTargets) {
              await targetWeaponRepository.putTargetWeapon(target)
            }
            return targetWeaponRepository.putTargetWeapon(value)
          },
        ),
      delete: (id) => targetWeaponRepository.deleteTargetWeapon(id),
      findReferences: (id) => referenceFinder.findTargetWeaponReferences(id),
    },
  ) {
    this.master = master
    this.dependencies = dependencies
  }

  getAll(): Promise<TargetWeapon[]> { return this.dependencies.getAll() }

  async save(draft: TargetWeaponDraft, existing: TargetWeapon | null, now = new Date().toISOString()): Promise<TargetWeapon> {
    const value = existing
      ? { ...draft, id: existing.id, createdAt: existing.createdAt, updatedAt: now }
      : createTargetWeapon({ ...draft, id: createTargetWeaponId() }, now)
    const issues = [
      ...(value.name.trim() ? [] : ['name: 名前を入力してください。']),
      ...domainMessages(validateTargetWeapon(value)),
      ...validateTargetWeaponMasterReferences(value, this.master),
      ...domainMessages(validateTargetIdealImpliesPractical(value, this.master)),
    ]
    if (issues.length) throw new EntityFormValidationError(issues)
    const saved = { ...value, compromiseNeedsReview: false }
    // Taking the weapon over from another Target and releasing that Target is
    // one change, so both writes share one transaction: a partial failure must
    // never leave two Targets preferring one weapon, nor both preferring none
    // (`docs/UI_FLOW.md` 8.1). The Target Weapons screen confirms the takeover
    // with the user before reaching this point.
    const otherTargets = (await this.dependencies.getAll()).filter(
      ({ id }) => id !== saved.id,
    )
    const releasedTargets =
      saved.preferredOwnedWeaponId === null
        ? []
        : otherTargets
            .filter(
              (target) =>
                target.preferredOwnedWeaponId === saved.preferredOwnedWeaponId,
            )
            .map((target) => releasePreferredOwnedWeapon(target, now))
    const releasedIds = new Set(releasedTargets.map(({ id }) => id))
    const preferred = validateTargetPreferredOwnedWeapons(
      [
        ...otherTargets.filter(({ id }) => !releasedIds.has(id)),
        ...releasedTargets,
        saved,
      ],
      await this.dependencies.getOwnedWeapons(),
    )
    if (!preferred.isValid) {
      throw new EntityFormValidationError(domainMessages(preferred))
    }
    return releasedTargets.length === 0
      ? this.dependencies.put(saved)
      : this.dependencies.putReleasingTargets(saved, releasedTargets)
  }

  /** The Target that currently prefers this owned weapon, if any. */
  async findTargetPreferring(
    preferredId: OwnedWeaponId,
    excludeTargetId: TargetWeaponId | null = null,
  ): Promise<TargetWeapon | null> {
    return (
      (await this.dependencies.getAll()).find(
        (target) =>
          target.preferredOwnedWeaponId === preferredId &&
          target.id !== excludeTargetId,
      ) ?? null
    )
  }

  async delete(id: TargetWeaponId): Promise<void> {
    const references = await this.dependencies.findReferences(id)
    if (references.length) throw new ReferencedEntityDeleteError(references)
    await this.dependencies.delete(id)
  }
}
