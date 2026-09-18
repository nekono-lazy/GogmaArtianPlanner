import {
  applyUserChanges,
  unchangedMutableState,
  type PlanBreakingChangeApproval,
  type PlanBreakingChangeInspection,
  type PlanGuardedMutation,
} from '../../domain/execution'
import type { ISODateTimeString, NormalArtianCounter, RngState } from '../../domain/models/publicTypes'
import { validateNormalArtianCounter, validateRngState } from '../../domain/models/validation'
import { assertRepositoryValidation } from '../../db/repositoryError'
import {
  defaultPlanGuardedPersistence,
  type PlanGuardedPersistence,
} from '../execution/planBreakingChangeGuard'

/**
 * The RngState fields a direct RNG Setup save sets: the user's intent. The
 * record identity and `createdAt` always come from the stored RngState.
 */
export type RngStateSaveIntent = Pick<RngState, 'baseSeed' | 'gogmaCounter' | 'skillCounter' | 'counterGate' | 'notes'>

/**
 * One RngState save as a guarded mutation (`docs/PLANNER_SPEC.md` 16.6). The
 * intent is applied over the RngState of the state the mutation runs on. With
 * a `basis` - the RngState the screen edited - only the fields the user changed
 * from it are applied (`applyUserChanges()`), so after a save point restore a
 * Counter the user did not touch keeps its restored value. Without one every
 * intent field is applied.
 */
export function rngStateSaveMutation(
  intent: RngStateSaveIntent,
  basis: RngState | null,
  now: ISODateTimeString,
  fallback: RngState,
): PlanGuardedMutation<RngState> {
  return (base) => {
    const current = base.rngState ?? fallback
    const edited = basis === null
      ? { ...current, ...intent }
      : applyUserChanges<RngState>(current, basis, intent)
    const next: RngState = { ...edited, updatedAt: now }
    assertRepositoryValidation('RngState', validateRngState(next))
    return { result: next, state: { ...unchangedMutableState(base), rngState: next } }
  }
}

/**
 * One NormalArtianCounter save as a guarded mutation. The Counter body the
 * screen built is the user's intent for that one weapon type. With a `basis` -
 * the record the screen edited - only the fields the user changed from it are
 * applied to the stored record (`applyUserChanges()`); `createdAt` comes from
 * the stored record when it exists.
 */
export function normalArtianCounterSaveMutation(
  counter: NormalArtianCounter,
  basis: NormalArtianCounter | null,
  now: ISODateTimeString,
): PlanGuardedMutation<NormalArtianCounter> {
  return (base) => {
    const current = base.normalCounters.find(({ id }) => id === counter.id)
    const edited = current !== undefined && basis !== null && basis.id === counter.id
      ? applyUserChanges<NormalArtianCounter>(current, basis, counter)
      : counter
    const next: NormalArtianCounter = { ...edited, createdAt: current?.createdAt ?? counter.createdAt, updatedAt: now }
    assertRepositoryValidation('NormalArtianCounter', validateNormalArtianCounter(next))
    return {
      result: next,
      state: {
        ...unchangedMutableState(base),
        normalCounters: current === undefined
          ? [...base.normalCounters, next]
          : base.normalCounters.map((stored) => (stored.id === next.id ? next : stored)),
      },
    }
  }
}

export interface RngStatePersistenceDependencies {
  persistence: PlanGuardedPersistence
  clock: { now(): ISODateTimeString }
}

function intentOf(state: RngState): RngStateSaveIntent {
  return {
    baseSeed: state.baseSeed,
    gogmaCounter: state.gogmaCounter,
    skillCounter: state.skillCounter,
    counterGate: state.counterGate,
    notes: state.notes,
  }
}

/**
 * RNG Setup's direct RngState save and the Normal Counter Setup save
 * (confirm, unconfirm, Debug edit, Identification result), both behind the
 * breaking-change guard: on an `active` Plan a semantic change is refused
 * without approval, and with it the Plan is abandoned in the same transaction.
 */
export class RngStatePersistenceService {
  private readonly dependencies: RngStatePersistenceDependencies

  constructor(
    dependencies: RngStatePersistenceDependencies = {
      persistence: defaultPlanGuardedPersistence,
      clock: { now: () => new Date().toISOString() },
    },
  ) {
    this.dependencies = dependencies
  }

  /**
   * Saves the RNG Setup edit. `basis` is the RngState the screen edited, so
   * only the fields changed from it are applied.
   */
  async saveRngState(
    state: RngState,
    basis: RngState | null = null,
    approval: PlanBreakingChangeApproval | null = null,
  ): Promise<RngState> {
    const mutation = rngStateSaveMutation(intentOf(state), basis, this.dependencies.clock.now(), state)
    return (await this.dependencies.persistence.apply(mutation, approval)).result
  }

  /** Whether the RNG Setup save needs the breaking-change approval (`docs/UI_FLOW.md` 16.3). Writes nothing. */
  inspectRngStateSave(state: RngState, basis: RngState | null = null): Promise<PlanBreakingChangeInspection> {
    return this.dependencies.persistence.inspect(
      rngStateSaveMutation(intentOf(state), basis, this.dependencies.clock.now(), state),
    )
  }

  /**
   * Saves one Normal Counter record (confirm, unconfirm, Debug edit or an
   * Identification result). `basis` is the record the screen edited, if any.
   */
  async saveNormalArtianCounter(
    counter: NormalArtianCounter,
    basis: NormalArtianCounter | null = null,
    approval: PlanBreakingChangeApproval | null = null,
  ): Promise<NormalArtianCounter> {
    const mutation = normalArtianCounterSaveMutation(counter, basis, this.dependencies.clock.now())
    return (await this.dependencies.persistence.apply(mutation, approval)).result
  }

  /** Whether the Normal Counter save needs the breaking-change approval. Writes nothing. */
  inspectNormalArtianCounterSave(
    counter: NormalArtianCounter,
    basis: NormalArtianCounter | null = null,
  ): Promise<PlanBreakingChangeInspection> {
    return this.dependencies.persistence.inspect(
      normalArtianCounterSaveMutation(counter, basis, this.dependencies.clock.now()),
    )
  }
}

export const rngStatePersistenceService = new RngStatePersistenceService()
