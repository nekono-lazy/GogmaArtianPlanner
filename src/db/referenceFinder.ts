import type {
  OwnedWeaponId,
  ProductionPlan,
  TargetWeaponId,
} from '../domain/models/publicTypes'
import { collectReferencedOwnedWeaponIds } from '../domain/models/hashing'
import { appDatabase, type AppDatabase } from './AppDatabase'

export type PersistenceReferenceKind =
  | 'owned_weapon'
  | 'build_candidate'
  | 'build_list_entry'
  | 'production_plan'
  | 'execution_history'

export interface PersistenceReference {
  kind: PersistenceReferenceKind
  entityId: string
  path: string
}

function sortReferences(
  references: PersistenceReference[],
): PersistenceReference[] {
  return references.sort(
    (left, right) =>
      left.kind.localeCompare(right.kind) ||
      left.entityId.localeCompare(right.entityId) ||
      left.path.localeCompare(right.path),
  )
}

function findOwnedWeaponReferencesInPlan(
  plan: ProductionPlan,
  ownedWeaponId: OwnedWeaponId,
  kind: 'production_plan' | 'execution_history',
  entityId: string,
  prefix = '',
): PersistenceReference[] {
  const references: PersistenceReference[] = []
  plan.steps.forEach((step, index) => {
    const path = `${prefix}steps[${index}]`
    if (step.ownedWeaponId === ownedWeaponId) {
      references.push({ kind, entityId, path: `${path}.ownedWeaponId` })
    }
    const change = step.inventoryChange
    if (change?.addOwnedWeapon?.id === ownedWeaponId) {
      references.push({ kind, entityId, path: `${path}.inventoryChange.addOwnedWeapon` })
    }
    if (change?.removeOwnedWeaponIds.includes(ownedWeaponId)) {
      references.push({ kind, entityId, path: `${path}.inventoryChange.removeOwnedWeaponIds` })
    }
    if (change?.updateOwnedWeapons.some(({ id }) => id === ownedWeaponId)) {
      references.push({ kind, entityId, path: `${path}.inventoryChange.updateOwnedWeapons` })
    }
  })
  return references
}

export class ReferenceFinder {
  private readonly database: AppDatabase

  constructor(database: AppDatabase) {
    this.database = database
  }

  async findOwnedWeaponReferences(
    ownedWeaponId: OwnedWeaponId,
  ): Promise<PersistenceReference[]> {
    const [candidates, entries, plans, history] = await Promise.all([
      this.database.buildCandidates.toArray(),
      this.database.buildListEntries.toArray(),
      this.database.productionPlans.toArray(),
      this.database.executionHistory.toArray(),
    ])
    const references: PersistenceReference[] = []
    candidates.forEach((candidate) => {
      if (collectReferencedOwnedWeaponIds(candidate.route).includes(ownedWeaponId)) {
        references.push({
          kind: 'build_candidate',
          entityId: candidate.id,
          path: 'route',
        })
      }
    })
    entries.forEach((entry) => {
      if (
        collectReferencedOwnedWeaponIds(entry.candidateSnapshot.route).includes(
          ownedWeaponId,
        )
      ) {
        references.push({
          kind: 'build_list_entry',
          entityId: entry.id,
          path: 'candidateSnapshot.route',
        })
      }
    })
    plans.forEach((plan) =>
      references.push(
        ...findOwnedWeaponReferencesInPlan(
          plan,
          ownedWeaponId,
          'production_plan',
          plan.id,
        ),
      ),
    )
    history.forEach((entry) => {
      const snapshot = entry.undoSnapshot
      if (entry.actualResult?.securedOwnedWeaponId === ownedWeaponId) {
        references.push({
          kind: 'execution_history',
          entityId: entry.id,
          path: 'actualResult.securedOwnedWeaponId',
        })
      }
      if (snapshot.affectedOwnedWeaponsBefore.some(({ id }) => id === ownedWeaponId)) {
        references.push({
          kind: 'execution_history',
          entityId: entry.id,
          path: 'undoSnapshot.affectedOwnedWeaponsBefore',
        })
      }
      if (snapshot.addedOwnedWeaponIds.includes(ownedWeaponId)) {
        references.push({
          kind: 'execution_history',
          entityId: entry.id,
          path: 'undoSnapshot.addedOwnedWeaponIds',
        })
      }
      if (snapshot.removedOwnedWeaponsBefore.some(({ id }) => id === ownedWeaponId)) {
        references.push({
          kind: 'execution_history',
          entityId: entry.id,
          path: 'undoSnapshot.removedOwnedWeaponsBefore',
        })
      }
      references.push(
        ...findOwnedWeaponReferencesInPlan(
          snapshot.productionPlanBefore,
          ownedWeaponId,
          'execution_history',
          entry.id,
          'undoSnapshot.productionPlanBefore.',
        ),
      )
    })
    return sortReferences(references)
  }

  async findTargetWeaponReferences(
    targetWeaponId: TargetWeaponId,
  ): Promise<PersistenceReference[]> {
    const [weapons, candidates, entries, plans] = await Promise.all([
      this.database.ownedWeapons.toArray(),
      this.database.buildCandidates.toArray(),
      this.database.buildListEntries.toArray(),
      this.database.productionPlans.toArray(),
    ])
    const references: PersistenceReference[] = []
    weapons.forEach((weapon) => {
      if (weapon.relatedTargetWeaponIds.includes(targetWeaponId)) {
        references.push({
          kind: 'owned_weapon',
          entityId: weapon.id,
          path: 'relatedTargetWeaponIds',
        })
      }
    })
    candidates.forEach((candidate) => {
      if (candidate.targetWeaponId === targetWeaponId) {
        references.push({
          kind: 'build_candidate',
          entityId: candidate.id,
          path: 'targetWeaponId',
        })
      }
    })
    entries.forEach((entry) => {
      if (entry.targetWeaponId === targetWeaponId) {
        references.push({
          kind: 'build_list_entry',
          entityId: entry.id,
          path: 'targetWeaponId',
        })
      }
    })
    plans.forEach((plan) => {
      plan.steps.forEach((step, index) => {
        if (step.targetWeaponId === targetWeaponId) {
          references.push({
            kind: 'production_plan',
            entityId: plan.id,
            path: `steps[${index}].targetWeaponId`,
          })
        }
      })
    })
    return sortReferences(references)
  }
}

export const referenceFinder = new ReferenceFinder(appDatabase)
