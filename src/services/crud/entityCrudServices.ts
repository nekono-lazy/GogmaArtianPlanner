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
import { validateTargetIdealImpliesPractical } from '../../domain/target'
import { ownedWeaponRepository, targetWeaponRepository } from '../../db/repositories'
import { referenceFinder, type PersistenceReference } from '../../db/referenceFinder'

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
  put(value: OwnedWeapon): Promise<OwnedWeapon>
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
      put: (value) => ownedWeaponRepository.putOwnedWeapon(value),
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
    return this.dependencies.put(value)
  }

  async delete(id: OwnedWeaponId): Promise<void> {
    const references = await this.dependencies.findReferences(id)
    if (references.length) throw new ReferencedEntityDeleteError(references)
    await this.dependencies.delete(id)
  }
}

export interface TargetWeaponCrudDependencies {
  getAll(): Promise<TargetWeapon[]>
  put(value: TargetWeapon): Promise<TargetWeapon>
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
      put: (value) => targetWeaponRepository.putTargetWeapon(value),
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
    return this.dependencies.put({ ...value, compromiseNeedsReview: false })
  }

  async delete(id: TargetWeaponId): Promise<void> {
    const references = await this.dependencies.findReferences(id)
    if (references.length) throw new ReferencedEntityDeleteError(references)
    await this.dependencies.delete(id)
  }
}
