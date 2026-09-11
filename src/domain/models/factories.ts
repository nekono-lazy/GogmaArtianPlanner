import type {
  AppSettings,
  OwnedWeaponId,
  ISODateTimeString,
  RngState,
  TargetWeaponId,
} from './common'
import type {
  OwnedGogmaArtianWeapon,
  OwnedNormalArtianWeapon,
  OwnedWeapon,
  TargetWeapon,
} from './entities'

type CreateOwnedWeaponInputFor<T extends OwnedWeapon> = Omit<
  T,
  'isProtected' | 'createdAt' | 'updatedAt'
> & { isProtected?: boolean }

export type CreateOwnedWeaponInput =
  | CreateOwnedWeaponInputFor<OwnedNormalArtianWeapon>
  | CreateOwnedWeaponInputFor<OwnedGogmaArtianWeapon>

export type CreateTargetWeaponInput = Omit<
  TargetWeapon,
  'priority' | 'createdAt' | 'updatedAt'
> & {
  priority?: TargetWeapon['priority']
}

function currentIsoTime(): ISODateTimeString {
  return new Date().toISOString()
}

function randomId(): string {
  return globalThis.crypto.randomUUID()
}

export function createOwnedWeaponId(createId: () => string = randomId): OwnedWeaponId {
  return createId() as OwnedWeaponId
}

export function createTargetWeaponId(createId: () => string = randomId): TargetWeaponId {
  return createId() as TargetWeaponId
}

export function createInitialRngState(
  now: ISODateTimeString = currentIsoTime(),
): RngState {
  return {
    id: 'current',
    schemaVersion: 1,
    baseSeed: { value: null, isConfirmed: false, source: null },
    gogmaCounter: { value: null, isConfirmed: false, source: null },
    skillCounter: { value: null, isConfirmed: false, source: null },
    counterGate: { value: null, isConfirmed: false, source: null },
    notes: null,
    createdAt: now,
    updatedAt: now,
  }
}

export function createOwnedWeapon(
  input: CreateOwnedWeaponInput,
  now: ISODateTimeString = currentIsoTime(),
): OwnedWeapon {
  if (input.kind === 'normal') {
    return {
      ...input,
      isProtected: input.isProtected ?? false,
      createdAt: now,
      updatedAt: now,
    }
  }
  return {
    ...input,
    isProtected: input.isProtected ?? input.status === 'ideal',
    createdAt: now,
    updatedAt: now,
  }
}

export function createTargetWeapon(
  input: CreateTargetWeaponInput,
  now: ISODateTimeString = currentIsoTime(),
): TargetWeapon {
  return {
    ...input,
    priority: input.priority ?? 3,
    createdAt: now,
    updatedAt: now,
  }
}

export function createDefaultAppSettings(
  now: ISODateTimeString = currentIsoTime(),
): AppSettings {
  return {
    id: 'settings',
    schemaVersion: 1,
    debugMode: false,
    resultPageSize: 50,
    defaultSearchLimit: 5000,
    createdAt: now,
    updatedAt: now,
  }
}
