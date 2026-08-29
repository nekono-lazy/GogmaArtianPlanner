import type {
  OwnedWeapon,
  OwnedWeaponId,
  OwnedWeaponStatus,
} from '../../domain/models/publicTypes'
import { validateOwnedWeapon } from '../../domain/models/validation'
import { appDatabase, type AppDatabase } from '../AppDatabase'
import { assertRepositoryValidation } from '../repositoryError'

export class OwnedWeaponRepository {
  private readonly database: AppDatabase

  constructor(database: AppDatabase) {
    this.database = database
  }

  getOwnedWeapon(id: OwnedWeaponId): Promise<OwnedWeapon | undefined> {
    return this.database.ownedWeapons.get(id)
  }

  getAllOwnedWeapons(): Promise<OwnedWeapon[]> {
    return this.database.ownedWeapons.toArray()
  }

  getOwnedWeaponsByStatus(status: OwnedWeaponStatus): Promise<OwnedWeapon[]> {
    return this.database.ownedWeapons.where('status').equals(status).toArray()
  }

  async putOwnedWeapon(weapon: OwnedWeapon): Promise<OwnedWeapon> {
    assertRepositoryValidation('OwnedWeapon', validateOwnedWeapon(weapon))
    await this.database.ownedWeapons.put(weapon)
    return weapon
  }

  deleteOwnedWeapon(id: OwnedWeaponId): Promise<void> {
    return this.database.ownedWeapons.delete(id)
  }
}

export const ownedWeaponRepository = new OwnedWeaponRepository(appDatabase)
