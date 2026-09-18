import type { MasterDataRoot } from '../../domain/master/masterTypes'
import {
  validateOwnedWeaponMasterReferences,
  validateTargetWeaponMasterReferences,
} from '../../domain/artian/entityMasterValidation'
import {
  applyUserChanges,
  unchangedMutableState,
  type PlanBreakingChangeApproval,
  type PlanBreakingChangeInspection,
  type PlanGuardedMutation,
} from '../../domain/execution'
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
import {
  findOwnedWeaponReferencesIn,
  findTargetWeaponReferencesIn,
  type PersistenceReference,
} from '../../db/referenceFinder'
import {
  defaultPlanGuardedPersistence,
  type PlanGuardedPersistence,
} from '../execution/planBreakingChangeGuard'

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

function withRecord<T extends { id: string }>(records: readonly T[], record: T): T[] {
  return records.some(({ id }) => id === record.id)
    ? records.map((stored) => (stored.id === record.id ? record : stored))
    : [...records, record]
}

/**
 * One OwnedWeapon save as a guarded mutation (`docs/PLANNER_SPEC.md` 16.6).
 *
 * The user's intent is what they changed in the draft from `basis`, the weapon
 * the screen showed; it is applied to the weapon as it is in the state the
 * mutation runs on (`applyUserChanges()`). So after a save point restore the
 * restored five slots, Skills and status stay unless the user changed them, and
 * Execution-owned `executionInProgress` and `createdAt` always come from the
 * stored weapon. A change of kind replaces the whole body, since the two kinds
 * hold different fields. An edit of a weapon that no longer exists is refused
 * rather than recreating it.
 */
export function ownedWeaponSaveMutation(
  master: MasterDataRoot,
  draft: OwnedWeaponDraft,
  basis: OwnedWeapon | null,
  newId: OwnedWeaponId,
  now: string,
): PlanGuardedMutation<OwnedWeapon> {
  return (base) => {
    let value: OwnedWeapon
    if (basis === null) {
      value = createOwnedWeapon({ ...draft, id: newId }, now)
    } else {
      const current = base.ownedWeapons.find(({ id }) => id === basis.id)
      if (current === undefined) {
        throw new EntityFormValidationError(['この所持武器はすでに存在しません。一覧を更新してください。'])
      }
      const edited: OwnedWeapon = draft.kind === basis.kind && draft.kind === current.kind
        ? applyUserChanges<OwnedWeapon>(current, basis, draft)
        : ({ ...draft, id: current.id } as OwnedWeapon)
      // `executionInProgress` is Execution-owned: ordinary CRUD never takes it
      // from the draft. An edit keeps the stored value, a new weapon starts null.
      value = { ...edited, id: current.id, executionInProgress: current.executionInProgress, createdAt: current.createdAt, updatedAt: now }
    }
    const issues = [
      ...(value.name.trim() ? [] : ['name: 名前を入力してください。']),
      ...domainMessages(validateOwnedWeapon(value)),
      ...validateOwnedWeaponMasterReferences(value, master),
    ]
    if (issues.length) throw new EntityFormValidationError(issues)
    // Protecting or re-typing a weapon a Target prefers would leave that Target
    // holding a preference the Domain rejects, so the link is released in the
    // same transaction rather than saved and repaired afterwards. The Owned
    // Weapons screen asks the user to confirm before reaching this point
    // (`docs/UI_FLOW.md` 7.1).
    const released = new Map(
      findTargetsInvalidatedByOwnedWeaponChange([...base.targetWeapons], value.id, value)
        .map((target) => [target.id, releasePreferredOwnedWeapon(target, now)] as const),
    )
    return {
      result: value,
      state: {
        ...unchangedMutableState(base),
        ownedWeapons: withRecord(base.ownedWeapons, value),
        targetWeapons: base.targetWeapons.map((target) => released.get(target.id) ?? target),
      },
    }
  }
}

/** One OwnedWeapon delete as a guarded mutation, under the existing reference protection. */
export function ownedWeaponDeleteMutation(id: OwnedWeaponId): PlanGuardedMutation<void> {
  return (base) => {
    const references = findOwnedWeaponReferencesIn(base, id)
    if (references.length) throw new ReferencedEntityDeleteError(references)
    return {
      result: undefined,
      state: { ...unchangedMutableState(base), ownedWeapons: base.ownedWeapons.filter((weapon) => weapon.id !== id) },
    }
  }
}

export interface OwnedWeaponCrudDependencies {
  getAll(): Promise<OwnedWeapon[]>
  getTargets(): Promise<TargetWeapon[]>
  /**
   * The guarded persistence boundary: the save and its Target releases are one
   * transaction, and a change that breaks the `active` Plan needs approval
   * (`docs/PLANNER_SPEC.md` 16.6).
   */
  persistence: PlanGuardedPersistence
}

export class OwnedWeaponCrudService {
  private readonly master: MasterDataRoot
  private readonly dependencies: OwnedWeaponCrudDependencies
  constructor(
    master: MasterDataRoot,
    dependencies: OwnedWeaponCrudDependencies = {
      getAll: () => ownedWeaponRepository.getAllOwnedWeapons(),
      getTargets: () => targetWeaponRepository.getAllTargetWeapons(),
      persistence: defaultPlanGuardedPersistence,
    },
  ) {
    this.master = master
    this.dependencies = dependencies
  }

  getAll(): Promise<OwnedWeapon[]> { return this.dependencies.getAll() }

  /**
   * Saves the weapon. `existing` is the weapon as the screen showed it; only
   * what the draft changed from it is applied to the stored weapon. A save that
   * breaks the `active` Plan is refused unless `approval` names that Plan and
   * the save point decision; with it the Plan is abandoned
   * (`breaking_change_approved`) in the same transaction.
   */
  async save(
    draft: OwnedWeaponDraft,
    existing: OwnedWeapon | null,
    now = new Date().toISOString(),
    approval: PlanBreakingChangeApproval | null = null,
  ): Promise<OwnedWeapon> {
    const mutation = ownedWeaponSaveMutation(this.master, draft, existing, createOwnedWeaponId(), now)
    return (await this.dependencies.persistence.apply(mutation, approval)).result
  }

  /** Whether saving the draft needs the breaking-change approval (`docs/UI_FLOW.md` 16.3). Writes nothing. */
  inspectSave(
    draft: OwnedWeaponDraft,
    existing: OwnedWeapon | null,
    now = new Date().toISOString(),
  ): Promise<PlanBreakingChangeInspection> {
    return this.dependencies.persistence.inspect(
      ownedWeaponSaveMutation(this.master, draft, existing, createOwnedWeaponId(), now),
    )
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

  async delete(id: OwnedWeaponId, approval: PlanBreakingChangeApproval | null = null): Promise<void> {
    await this.dependencies.persistence.apply(ownedWeaponDeleteMutation(id), approval)
  }

  inspectDelete(id: OwnedWeaponId): Promise<PlanBreakingChangeInspection> {
    return this.dependencies.persistence.inspect(ownedWeaponDeleteMutation(id))
  }
}

/**
 * One TargetWeapon save as a guarded mutation (`docs/PLANNER_SPEC.md` 16.6).
 * The user's intent is what they changed in the draft from `basis`, the Target
 * the screen showed, applied to the Target as it is in the state the mutation
 * runs on (`applyUserChanges()`): a preferred owned weapon the user left alone
 * follows the stored Target - after a save point restore, the restored one -
 * and the lifecycle always comes from the stored Target.
 */
export function targetWeaponSaveMutation(
  master: MasterDataRoot,
  draft: TargetWeaponDraft,
  basis: TargetWeapon | null,
  newId: TargetWeaponId,
  now: string,
): PlanGuardedMutation<TargetWeapon> {
  return (base) => {
    let value: TargetWeapon
    if (basis === null) {
      value = createTargetWeapon({ ...draft, id: newId }, now)
    } else {
      const current = base.targetWeapons.find(({ id }) => id === basis.id)
      if (current === undefined) {
        throw new EntityFormValidationError(['この目標武器はすでに存在しません。一覧を更新してください。'])
      }
      // The lifecycle is changed only by Execution and the explicit complete /
      // reopen actions, never by an ordinary edit: an edit keeps the stored
      // values, and a new Target is always active.
      value = {
        ...applyUserChanges<TargetWeapon>(current, basis, draft),
        id: current.id,
        lifecycleStatus: current.lifecycleStatus,
        completedAt: current.completedAt,
        completedByProductionPlanId: current.completedByProductionPlanId,
        createdAt: current.createdAt,
        updatedAt: now,
      }
    }
    const issues = [
      ...(value.name.trim() ? [] : ['name: 名前を入力してください。']),
      ...domainMessages(validateTargetWeapon(value)),
      ...validateTargetWeaponMasterReferences(value, master),
      ...domainMessages(validateTargetIdealImpliesPractical(value, master)),
    ]
    if (issues.length) throw new EntityFormValidationError(issues)
    const saved = { ...value, compromiseNeedsReview: false }
    // Taking the weapon over from another Target and releasing that Target is
    // one change, so both writes share one transaction: a partial failure must
    // never leave two Targets preferring one weapon, nor both preferring none
    // (`docs/UI_FLOW.md` 8.1). The Target Weapons screen confirms the takeover
    // with the user before reaching this point.
    const released = new Map(
      saved.preferredOwnedWeaponId === null
        ? []
        : base.targetWeapons
            .filter((target) => target.id !== saved.id && target.preferredOwnedWeaponId === saved.preferredOwnedWeaponId)
            .map((target) => [target.id, releasePreferredOwnedWeapon(target, now)] as const),
    )
    const targetWeapons = withRecord(base.targetWeapons.map((target) => released.get(target.id) ?? target), saved)
    const preferred = validateTargetPreferredOwnedWeapons(targetWeapons, [...base.ownedWeapons])
    if (!preferred.isValid) {
      throw new EntityFormValidationError(domainMessages(preferred))
    }
    return { result: saved, state: { ...unchangedMutableState(base), targetWeapons } }
  }
}

/** One TargetWeapon delete as a guarded mutation, under the existing reference protection. */
export function targetWeaponDeleteMutation(id: TargetWeaponId): PlanGuardedMutation<void> {
  return (base) => {
    const references = findTargetWeaponReferencesIn(base, id)
    if (references.length) throw new ReferencedEntityDeleteError(references)
    return {
      result: undefined,
      state: { ...unchangedMutableState(base), targetWeapons: base.targetWeapons.filter((target) => target.id !== id) },
    }
  }
}

export interface TargetWeaponCrudDependencies {
  getAll(): Promise<TargetWeapon[]>
  getOwnedWeapons(): Promise<OwnedWeapon[]>
  /**
   * The guarded persistence boundary: the save and the release of the Target
   * that previously preferred the same weapon are one transaction, and a change
   * that breaks the `active` Plan needs approval (`docs/PLANNER_SPEC.md` 16.6).
   */
  persistence: PlanGuardedPersistence
}

export class TargetWeaponCrudService {
  private readonly master: MasterDataRoot
  private readonly dependencies: TargetWeaponCrudDependencies
  constructor(
    master: MasterDataRoot,
    dependencies: TargetWeaponCrudDependencies = {
      getAll: () => targetWeaponRepository.getAllTargetWeapons(),
      getOwnedWeapons: () => ownedWeaponRepository.getAllOwnedWeapons(),
      persistence: defaultPlanGuardedPersistence,
    },
  ) {
    this.master = master
    this.dependencies = dependencies
  }

  getAll(): Promise<TargetWeapon[]> { return this.dependencies.getAll() }

  /**
   * Saves the Target. `existing` is the Target as the screen showed it; only
   * what the draft changed from it is applied to the stored Target. A save
   * that - its preference takeover included - breaks
   * the `active` Plan is refused unless `approval` names that Plan and the save
   * point decision; with it the Plan is abandoned (`breaking_change_approved`)
   * in the same transaction.
   */
  async save(
    draft: TargetWeaponDraft,
    existing: TargetWeapon | null,
    now = new Date().toISOString(),
    approval: PlanBreakingChangeApproval | null = null,
  ): Promise<TargetWeapon> {
    const mutation = targetWeaponSaveMutation(this.master, draft, existing, createTargetWeaponId(), now)
    return (await this.dependencies.persistence.apply(mutation, approval)).result
  }

  /** Whether saving the draft needs the breaking-change approval (`docs/UI_FLOW.md` 16.3). Writes nothing. */
  inspectSave(
    draft: TargetWeaponDraft,
    existing: TargetWeapon | null,
    now = new Date().toISOString(),
  ): Promise<PlanBreakingChangeInspection> {
    return this.dependencies.persistence.inspect(
      targetWeaponSaveMutation(this.master, draft, existing, createTargetWeaponId(), now),
    )
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

  async delete(id: TargetWeaponId, approval: PlanBreakingChangeApproval | null = null): Promise<void> {
    await this.dependencies.persistence.apply(targetWeaponDeleteMutation(id), approval)
  }

  inspectDelete(id: TargetWeaponId): Promise<PlanBreakingChangeInspection> {
    return this.dependencies.persistence.inspect(targetWeaponDeleteMutation(id))
  }
}
