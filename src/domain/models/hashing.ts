import type { NormalArtianCounter, OwnedWeaponId, RngState } from './common'
import { V1_NORMAL_ARTIAN_RARITY } from './common'
import type { BuildRoute, OwnedWeapon } from './entities'
import type { ExpectedPlanState } from './planning'

export class StableSerializationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StableSerializationError'
  }
}

function serializeStable(value: unknown, ancestors: WeakSet<object>): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value)
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new StableSerializationError('Only finite numbers can be hashed.')
    }
    return JSON.stringify(value)
  }
  if (typeof value !== 'object') {
    throw new StableSerializationError(
      `Unsupported stable serialization value: ${typeof value}.`,
    )
  }
  if (ancestors.has(value)) {
    throw new StableSerializationError('Cyclic values cannot be hashed.')
  }

  ancestors.add(value)
  let result: string
  if (Array.isArray(value)) {
    result = `[${value
      .map((entry) => serializeStable(entry, ancestors))
      .join(',')}]`
  } else {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new StableSerializationError(
        'Only plain objects can be hashed.',
      )
    }
    const record = value as Record<string, unknown>
    result = `{${Object.keys(record)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${serializeStable(record[key], ancestors)}`,
      )
      .join(',')}}`
  }
  ancestors.delete(value)
  return result
}

export function stableStringify(value: unknown): string {
  return serializeStable(value, new WeakSet<object>())
}

export function hashStableValue(value: unknown): string {
  const serialized = stableStringify(value)
  let hash = 0x811c9dc5
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`
}

/**
 * The semantic content of one `KnownValue`: the value and whether it is
 * confirmed. Source, notes, and observation timestamps are non-semantic and
 * never participate in a stable value.
 */
export function normalizeKnownValue<T>(known: {
  value: T | null
  isConfirmed: boolean
}) {
  return { value: known.value, isConfirmed: known.isConfirmed }
}

function normalCounterId(
  operation: Extract<
    BuildRoute['operations'][number],
    { type: 'create_normal_artian' }
  >,
): string {
  return `${operation.weaponTypeId}:${V1_NORMAL_ARTIAN_RARITY}`
}

export function createSearchStateHash(
  route: BuildRoute,
  rngState: RngState,
  normalCounters: readonly NormalArtianCounter[],
): string {
  const usesGogmaPrediction = route.operations.some((operation) =>
    ['reset_bonuses', 'keep_bonuses'].includes(
      operation.type,
    ),
  )
  const usesSkillPrediction = route.operations.some(
    ({ type }) => type === 'convert_normal_to_gogma' || type === 'reset_skills',
  )
  const relevantNormalCounterIds = [
    ...new Set(
      route.operations
        .filter(
          (operation): operation is Extract<
            BuildRoute['operations'][number],
            { type: 'create_normal_artian' }
          > => operation.type === 'create_normal_artian',
        )
        .map(normalCounterId),
    ),
  ].sort()

  const normalized: Record<string, unknown> = {
    baseSeed: normalizeKnownValue(rngState.baseSeed),
  }
  if (usesGogmaPrediction) {
    normalized.gogmaCounter = normalizeKnownValue(rngState.gogmaCounter)
  }
  if (usesSkillPrediction) {
    normalized.skillCounter = normalizeKnownValue(rngState.skillCounter)
  }
  if (relevantNormalCounterIds.length > 0) {
    const counterById = new Map(
      normalCounters.map((counter) => [counter.id, counter]),
    )
    normalized.normalCounters = relevantNormalCounterIds.map((id) => {
      const counter = counterById.get(id)
      return {
        id,
        counter: counter?.counter ?? null,
        isConfirmed: counter?.isConfirmed ?? false,
      }
    })
  }
  return hashStableValue(normalized)
}

export function collectReferencedOwnedWeaponIds(
  route: BuildRoute,
): OwnedWeaponId[] {
  const ids = new Set<OwnedWeaponId>()
  if (route.sourceOwnedWeaponId !== null) {
    ids.add(route.sourceOwnedWeaponId)
  }
  route.operations.forEach((operation) => {
    if (
      operation.type === 'reset_bonuses' ||
      operation.type === 'keep_bonuses'
    ) {
      if (operation.sourceOwnedWeaponId !== null) ids.add(operation.sourceOwnedWeaponId)
    }
    if (
      operation.type === 'reset_skills' &&
      operation.sourceOwnedWeaponId !== null
    ) {
      if (operation.sourceOwnedWeaponId !== null) ids.add(operation.sourceOwnedWeaponId)
    }
    if (operation.type === 'use_weapon_as_material') {
      ids.add(operation.ownedWeaponId)
    }
  })
  return [...ids].sort()
}

/**
 * The semantic content of one OwnedWeapon as `referencedOwnedWeaponsHash`
 * defines it: identity, kind, weapon type, element, restoration bonus scope and
 * the stored five slots in order, protection, plus Series / Group Skill and
 * status for a Gogma weapon. Name, memo, and timestamps are excluded.
 *
 * Exported so a caller that needs the same per-weapon semantics for a different
 * stable value - the B8 deterministic constrained search identity - reuses this
 * authority instead of writing a second normalization.
 */
export function normalizeReferencedOwnedWeapon(weapon: OwnedWeapon) {
  const common = {
    id: weapon.id,
    kind: weapon.kind,
    weaponTypeId: weapon.weaponTypeId,
    elementId: weapon.elementId,
    restorationBonusScope: weapon.restorationBonusScope,
    restorationBonuses: weapon.restorationBonuses.map((bonus) => ({
      bonusTypeId: bonus.bonusTypeId,
      bonusRankId: bonus.bonusRankId,
    })),
    isProtected: weapon.isProtected,
  }
  return weapon.kind === 'normal'
    ? common
    : {
        ...common,
        seriesSkillId: weapon.seriesSkillId,
        groupSkillId: weapon.groupSkillId,
        status: weapon.status,
      }
}

function normalizeExpectedOwnedWeapon(weapon: OwnedWeapon) {
  const referenced = normalizeReferencedOwnedWeapon(weapon)
  return weapon.kind === 'normal'
    ? { ...referenced, rarity: weapon.rarity }
    : referenced
}

export function createReferencedOwnedWeaponsHash(
  route: BuildRoute,
  ownedWeapons: readonly OwnedWeapon[],
): string | null {
  const referencedIds = collectReferencedOwnedWeaponIds(route)
  if (referencedIds.length === 0) return null

  const weaponById = new Map(ownedWeapons.map((weapon) => [weapon.id, weapon]))
  const normalized = referencedIds.map((id) => {
    const weapon = weaponById.get(id)
    return weapon ? normalizeReferencedOwnedWeapon(weapon) : { id, missing: true }
  })
  return hashStableValue(normalized)
}

export function createExpectedPlanState(
  rngState: RngState,
  normalCounters: readonly NormalArtianCounter[],
  ownedWeapons: readonly OwnedWeapon[],
): ExpectedPlanState {
  const normalizedRngState = {
    baseSeed: normalizeKnownValue(rngState.baseSeed),
    gogmaCounter: normalizeKnownValue(rngState.gogmaCounter),
    skillCounter: normalizeKnownValue(rngState.skillCounter),
  }
  const normalizedCounters = [...normalCounters]
    .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    .map(({ id, counter, isConfirmed }) => ({ id, counter, isConfirmed }))
  const normalizedWeapons = [...ownedWeapons]
    .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    .map((weapon) => ({
      ...normalizeExpectedOwnedWeapon(weapon),
      relatedTargetWeaponIds: [...new Set(weapon.relatedTargetWeaponIds)]
        .sort((left, right) => left < right ? -1 : left > right ? 1 : 0),
    }))

  return {
    rngStateHash: hashStableValue(normalizedRngState),
    normalCountersHash: hashStableValue(normalizedCounters),
    ownedWeaponsHash: hashStableValue(normalizedWeapons),
  }
}
