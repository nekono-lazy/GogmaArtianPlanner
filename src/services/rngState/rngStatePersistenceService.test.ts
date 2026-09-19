import { describe, expect, it } from 'vitest'
import {
  inspectPlanGuardedMutation,
  preparePlanGuardedMutation,
  type PlanGuardPersistedState,
} from '../../domain/execution'
import type { NormalArtianCounter, RngState } from '../../domain/models/publicTypes'
import {
  createValidNormalArtianCounter,
  createValidRngState,
  domainFixtureContext,
} from '../../test/fixtures/domainData'
import type { PlanGuardedPersistence } from '../execution/planBreakingChangeGuard'
import { RngStatePersistenceService } from './rngStatePersistenceService'

const NOW = '2026-09-19T00:00:00.000Z'
const IDENTIFIED_AT = '2026-09-18T00:00:00.000Z'

/** The guarded persistence over one in-memory RngState and Counter collection, with no ProductionPlan. */
function memoryPersistence(initial: { rngState: RngState; normalCounters: NormalArtianCounter[] }) {
  const current = structuredClone(initial)
  const state = (): PlanGuardPersistedState => ({
    rngState: structuredClone(current.rngState),
    normalCounters: structuredClone(current.normalCounters),
    ownedWeapons: [],
    targetWeapons: [],
    buildListEntries: [],
    buildCandidates: [],
    productionPlans: [],
    executionHistory: [],
    executionSavePoints: [],
  })
  const persistence: PlanGuardedPersistence = {
    inspect: async (mutation) => inspectPlanGuardedMutation(state(), mutation),
    apply: async (mutation, approval = null) => {
      const prepared = preparePlanGuardedMutation({
        state: state(),
        mutation,
        approval,
        currentCalculationContext: domainFixtureContext,
        now: NOW,
      })
      if (prepared.state.rngState !== null) current.rngState = structuredClone(prepared.state.rngState)
      current.normalCounters = structuredClone([...prepared.state.normalCounters])
      return { result: prepared.result, state: prepared.state, planTermination: prepared.planTermination }
    },
  }
  return {
    service: new RngStatePersistenceService({ persistence, clock: { now: () => NOW } }),
    current: () => structuredClone(current),
  }
}

describe('RngStatePersistenceService: RngState Identification provenance', () => {
  it('keeps lastIdentifiedAt through a notes-only save, a Counter Gate change and a value edit', async () => {
    const identified = { ...createValidRngState(), lastIdentifiedAt: IDENTIFIED_AT }
    const { service, current } = memoryPersistence({ rngState: identified, normalCounters: [] })

    await service.saveRngState({ ...identified, notes: 'note only' }, identified)
    expect(current().rngState).toMatchObject({ notes: 'note only', lastIdentifiedAt: IDENTIFIED_AT, updatedAt: NOW })

    const withGate = current().rngState
    await service.saveRngState({ ...withGate, counterGate: { value: 99, isConfirmed: true, source: 'manual' } }, withGate)
    expect(current().rngState.lastIdentifiedAt).toBe(IDENTIFIED_AT)

    // A value edit is a manual value (the RNG Setup marks it so); the adoption
    // time itself is kept, and the reminder authority reads the `source`.
    const edited = current().rngState
    await service.saveRngState({ ...edited, gogmaCounter: { value: 77, isConfirmed: true, source: 'manual' } }, edited)
    expect(current().rngState).toMatchObject({ gogmaCounter: { value: 77, source: 'manual' }, lastIdentifiedAt: IDENTIFIED_AT })
  })

  it('never records an adoption from the save intent, with or without a basis', async () => {
    const { service, current } = memoryPersistence({ rngState: createValidRngState(), normalCounters: [] })
    const forged = { ...createValidRngState(), lastIdentifiedAt: NOW } as RngState
    await service.saveRngState(forged, createValidRngState())
    expect(current().rngState.lastIdentifiedAt).toBeNull()
    await service.saveRngState(forged, null)
    expect(current().rngState.lastIdentifiedAt).toBeNull()
  })
})

describe('RngStatePersistenceService: Normal Counter Identification provenance', () => {
  const identified = (): NormalArtianCounter => ({ ...createValidNormalArtianCounter(), lastIdentifiedAt: IDENTIFIED_AT })

  it('adopts a unique Identification result as the only writer of lastIdentifiedAt', async () => {
    const { service, current } = memoryPersistence({ rngState: createValidRngState(), normalCounters: [] })
    const saved = await service.adoptNormalArtianCounterIdentification({
      weaponTypeId: 'weapon.fixture.a',
      startNormalCounter: 4,
      observationCount: 3,
    })
    // `counter = startNormalCounter`, never `C + observationCount`.
    expect(saved).toEqual({
      id: 'weapon.fixture.a:8',
      weaponTypeId: 'weapon.fixture.a',
      rarity: 8,
      counter: 4,
      isConfirmed: true,
      observationCount: 3,
      candidateCount: 1,
      lastObservedAt: NOW,
      lastIdentifiedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    })
    expect(current().normalCounters).toEqual([saved])

    // Adopting again keeps the record's createdAt and re-records the provenance.
    const again = await service.adoptNormalArtianCounterIdentification({
      weaponTypeId: 'weapon.fixture.a',
      startNormalCounter: 9,
      observationCount: 1,
    })
    expect(again).toMatchObject({ counter: 9, observationCount: 1, createdAt: NOW, lastIdentifiedAt: NOW })
  })

  it('keeps the provenance through an unconfirm / confirm or an observation edit that leaves the value', async () => {
    const stored = identified()
    const { service, current } = memoryPersistence({ rngState: createValidRngState(), normalCounters: [stored] })
    await service.saveNormalArtianCounter({ ...stored, isConfirmed: false }, stored)
    expect(current().normalCounters[0]).toMatchObject({ isConfirmed: false, lastIdentifiedAt: IDENTIFIED_AT })
    const unconfirmed = current().normalCounters[0]
    await service.saveNormalArtianCounter({ ...unconfirmed, isConfirmed: true, observationCount: 7 }, unconfirmed)
    expect(current().normalCounters[0]).toMatchObject({ isConfirmed: true, observationCount: 7, lastIdentifiedAt: IDENTIFIED_AT })
  })

  it('N4: resets the provenance when a manual / Debug save changes the value, and never takes it from the intent', async () => {
    const stored = identified()
    const { service, current } = memoryPersistence({ rngState: createValidRngState(), normalCounters: [stored] })
    await service.saveNormalArtianCounter({ ...stored, counter: 40, lastIdentifiedAt: NOW }, stored)
    expect(current().normalCounters[0]).toMatchObject({ counter: 40, lastIdentifiedAt: null })

    // A new record saved manually has no provenance, whatever the intent claims.
    const created = await service.saveNormalArtianCounter(
      { ...createValidNormalArtianCounter(), id: 'weapon.fixture.b:8', weaponTypeId: 'weapon.fixture.b', lastIdentifiedAt: NOW },
      null,
    )
    expect(created.lastIdentifiedAt).toBeNull()
  })
})

describe('RngStatePersistenceService: Normal Counter Identification adoption inspection', () => {
  it('inspects the very adoption mutation without writing, then adopts it', async () => {
    const counter = createValidNormalArtianCounter()
    const { service, current } = memoryPersistence({ rngState: createValidRngState(), normalCounters: [counter] })
    const adoption = { weaponTypeId: counter.weaponTypeId, startNormalCounter: 7, observationCount: 2 }
    const before = current()

    await expect(service.inspectNormalArtianCounterIdentificationAdoption(adoption)).resolves.toEqual({ approvalRequired: false })
    expect(current()).toEqual(before)

    const adopted = await service.adoptNormalArtianCounterIdentification(adoption)
    expect(adopted).toMatchObject({ counter: 7, isConfirmed: true, observationCount: 2, candidateCount: 1, lastIdentifiedAt: NOW })
    expect(current().normalCounters.find(({ id }) => id === counter.id)).toEqual(adopted)
  })
})
