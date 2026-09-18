import { createBuildListCalculationContext } from './createBuildListCalculationContext'
import { createValidMasterDataFixture } from '../../test/fixtures/masterData'
import { describe, expect, it, vi } from 'vitest'
import { createBuildListEntry, defaultIntermediateStateSelection } from '../../domain/buildList'
import { createSearchStateHash } from '../../domain/models/hashing'
import type { BuildListEntry } from '../../domain/models/publicTypes'
import {
  createValidBuildCandidate,
  createValidNormalArtianCounter,
  createValidRngState,
  createValidTargetWeapon,
  domainFixtureContext,
} from '../../test/fixtures/domainData'
import {
  checkpointCandidate,
  checkpointIdealBonuses,
  checkpointPracticalBonuses,
  checkpointPracticalBonusesReordered,
  checkpointTarget,
  intermediateOpportunityAt,
} from '../../test/fixtures/checkpointRoute'
import type { IntermediateStateOpportunityId } from '../../domain/models/publicTypes'
import {
  inspectPlanGuardedMutation,
  preparePlanGuardedMutation,
  type PlanBreakingChangeApproval,
  type PlanGuardPersistedState,
  type PlanGuardedMutation,
} from '../../domain/execution'
import type { PlanGuardedPersistence } from '../execution/planBreakingChangeGuard'
import { BuildListService, type BuildListServiceRepositories } from './buildListService'

function memoryRepositories(initial: BuildListEntry[] = []) {
  const entries = [...initial]
  const target = createValidTargetWeapon()
  const rngState = createValidRngState()
  rngState.skillCounter = { value: 7, isConfirmed: true, source: 'manual' }
  const normalCounters = [createValidNormalArtianCounter()]
  const repositories: BuildListServiceRepositories = {
    getAllEntries: async () => [...entries],
    putEntry: vi.fn(async (entry) => {
      const index = entries.findIndex(({ id }) => id === entry.id)
      if (index >= 0) entries[index] = entry
      else entries.push(entry)
      return entry
    }),
    ensureRngState: async () => rngState,
    getNormalCounters: async () => normalCounters,
    getOwnedWeapons: async () => [],
    getTargets: async () => [target],
    // The guarded Build List operations over the same in-memory Entries.
    persistence: {
      inspect: async (mutation) => inspectPlanGuardedMutation(guardState(), mutation),
      apply: vi.fn(async (mutation: PlanGuardedMutation<unknown>, approval: PlanBreakingChangeApproval | null = null) => {
        const write = preparePlanGuardedMutation({
          state: guardState(),
          mutation,
          approval,
          currentCalculationContext: domainFixtureContext,
          now: '2026-09-18T00:00:00.000Z',
        })
        entries.splice(0, entries.length, ...write.state.buildListEntries)
        return { result: write.result, planTermination: write.planTermination }
      }) as unknown as PlanGuardedPersistence['apply'],
    },
  }
  function guardState(): PlanGuardPersistedState {
    return {
      rngState,
      normalCounters,
      ownedWeapons: [],
      targetWeapons: [target],
      buildListEntries: [...entries],
      buildCandidates: [],
      productionPlans: [],
      executionHistory: [],
      executionSavePoints: [],
    }
  }
  return { entries, target, rngState, normalCounters, repositories }
}

describe('BuildListService', () => {
  it('marks a pre-B5-F1 Ideal snapshot stale without deleting or reclassifying it', async () => {
    const memory = memoryRepositories()
    const current = createBuildListCalculationContext(createValidMasterDataFixture())
    const candidate = createValidBuildCandidate()
    candidate.calculationContext = { ...current, appSchemaVersion: 1 }
    candidate.searchStateHash = createSearchStateHash(candidate.route, memory.rngState, memory.normalCounters)
    const original = createBuildListEntry(candidate, memory.target, { createdAt: '2026-08-29T04:00:00.000Z' })
    const snapshot = structuredClone(original.candidateSnapshot)
    memory.entries.push(original)

    const refreshed = await new BuildListService(memory.repositories).refreshStaleness(current)
    expect(current.appSchemaVersion).toBe(12)
    expect(refreshed.entries[0].isStale).toBe(true)
    expect(refreshed.entries[0].staleReasons).toEqual(['calculation_context_changed'])
    expect(refreshed.entries[0].candidateSnapshot).toEqual(snapshot)
    expect(refreshed.entries[0].candidateSnapshot.restorationBonusScope).toBe('normal_artian')
    expect(memory.repositories.putEntry).toHaveBeenCalledOnce()
    expect(memory.repositories.persistence.apply).not.toHaveBeenCalled()
  })

  it.each([2, 3, 4, 5, 6, 7])(
    'marks schema %i BuildListEntries stale under preferred-owned-weapon semantics version 8',
    async (appSchemaVersion) => {
      const memory = memoryRepositories()
      const current = createBuildListCalculationContext(createValidMasterDataFixture())
      const candidate = createValidBuildCandidate()
      candidate.calculationContext = { ...current, appSchemaVersion }
      candidate.searchStateHash = createSearchStateHash(
        candidate.route,
        memory.rngState,
        memory.normalCounters,
      )
      const original = createBuildListEntry(candidate, memory.target, {
        createdAt: '2026-08-29T04:00:00.000Z',
      })
      memory.entries.push(original)

      const refreshed = await new BuildListService(memory.repositories)
        .refreshStaleness(current)

      expect(refreshed.entries[0].isStale).toBe(true)
      expect(refreshed.entries[0].staleReasons).toEqual(['calculation_context_changed'])
      expect(refreshed.entries[0].candidateSnapshot).toEqual(original.candidateSnapshot)
      expect(memory.repositories.putEntry).toHaveBeenCalledOnce()
    },
  )

  it('adds a Candidate snapshot once and rejects a semantic duplicate from a new search', async () => {
    const memory = memoryRepositories()
    const service = new BuildListService(memory.repositories)
    const candidate = createValidBuildCandidate()
    candidate.searchStateHash = createSearchStateHash(candidate.route, memory.rngState, memory.normalCounters)
    const first = await service.addCandidate(candidate, memory.target)
    const repeated = { ...candidate, id: 'candidate.another-run' as typeof candidate.id, searchRunId: 'another-run' }
    const second = await service.addCandidate(repeated, memory.target)
    expect(first.added).toBe(true)
    expect(second.added).toBe(false)
    expect(memory.entries).toHaveLength(1)
  })

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])('adds a current Candidate beside an unchanged schema %i snapshot', async (appSchemaVersion) => {
    const memory = memoryRepositories()
    const candidate = createValidBuildCandidate()
    candidate.calculationContext = createBuildListCalculationContext(createValidMasterDataFixture())
    const historical = structuredClone(candidate)
    historical.calculationContext.appSchemaVersion = appSchemaVersion
    const oldEntry = createBuildListEntry(historical, memory.target, { createdAt: '2026-08-29T04:00:00.000Z' })
    const before = structuredClone(oldEntry)
    memory.entries.push(oldEntry)
    const result = await new BuildListService(memory.repositories).addCandidate(candidate, memory.target)
    expect(result.added).toBe(true)
    expect(memory.entries).toHaveLength(2)
    expect(memory.entries[0]).toEqual(before)
    expect(result.entry.calculationContext.appSchemaVersion).toBe(12)
    expect(memory.repositories.persistence.apply).not.toHaveBeenCalled()
  })

  it('persists changed stale flags without replacing the snapshot contract', async () => {
    const memory = memoryRepositories()
    const candidate = createValidBuildCandidate()
    candidate.searchStateHash = createSearchStateHash(candidate.route, memory.rngState, memory.normalCounters)
    const original = createBuildListEntry(candidate, memory.target, { createdAt: '2026-08-29T04:00:00.000Z' })
    memory.entries.push(original)
    memory.rngState.skillCounter.value = 99
    const service = new BuildListService(memory.repositories)
    const refreshed = await service.refreshStaleness(domainFixtureContext)
    expect(refreshed.entries[0].staleReasons).toContain('rng_state_changed')
    expect(refreshed.entries[0].candidateSnapshot).toEqual(original.candidateSnapshot)
    expect(refreshed.entries[0].searchStateHash).toBe(original.searchStateHash)
    expect(memory.repositories.putEntry).toHaveBeenCalledOnce()
  })
  it('L: stores the intermediate state selection and preference, and never overwrites them on a re-add', async () => {
    const memory = memoryRepositories()
    const service = new BuildListService(memory.repositories)
    const candidate = checkpointCandidate([
      checkpointPracticalBonuses(),
      checkpointIdealBonuses(),
    ])
    const target = checkpointTarget()
    memory.repositories.getTargets = async () => [target]
    const selected = intermediateOpportunityAt(candidate, 'bonus', 1).opportunity.id
    const selection = {
      ...defaultIntermediateStateSelection(),
      bonusOpportunityId: selected,
      improvementPreference: 'skill_first' as const,
    }

    const first = await service.addCandidate(candidate, target, selection)
    expect(first.entry.intermediateStateSelection).toEqual(selection)
    // A second Search finds the same Candidate again under a new run id.
    const repeated = structuredClone(candidate)
    repeated.id = 'candidate.checkpoint.another' as typeof repeated.id
    repeated.searchRunId = 'search-run.checkpoint.another'
    const second = await service.addCandidate(repeated, target, defaultIntermediateStateSelection())

    expect(first.added).toBe(true)
    expect(second.added).toBe(false)
    expect(memory.entries).toHaveLength(1)
    // The user's selection survives: it is edited in the Build List, never by
    // adding the same Candidate again.
    expect(second.entry.intermediateStateSelection).toEqual(selection)
  })

  it('L: replaces the selection and preference through the Domain validation authority', async () => {
    const memory = memoryRepositories()
    const service = new BuildListService(memory.repositories)
    const candidate = checkpointCandidate([
      checkpointPracticalBonuses(),
      checkpointPracticalBonusesReordered(),
      checkpointIdealBonuses(),
    ])
    const target = checkpointTarget()
    memory.repositories.getTargets = async () => [target]
    const later = intermediateOpportunityAt(candidate, 'bonus', 2).opportunity
    const added = await service.addCandidate(candidate, target)

    const updated = await service.updateIntermediateStateSelection(added.entry.id, {
      ...defaultIntermediateStateSelection(),
      bonusOpportunityId: later.id,
      improvementPreference: 'bonus_first',
    })
    expect(updated.intermediateStateSelection).toEqual({
      skillOpportunityId: null,
      bonusOpportunityId: later.id,
      improvementPreference: 'bonus_first',
    })

    // An id of the other lane and an unknown id are refused, and nothing is persisted.
    await expect(
      service.updateIntermediateStateSelection(added.entry.id, {
        ...defaultIntermediateStateSelection(),
        skillOpportunityId: later.id,
      }),
    ).rejects.toThrow(/own lane/)
    await expect(
      service.updateIntermediateStateSelection(added.entry.id, {
        ...defaultIntermediateStateSelection(),
        bonusOpportunityId: 'intermediate-opportunity:unknown' as IntermediateStateOpportunityId,
      }),
    ).rejects.toThrow(/candidate snapshot/)
    expect(memory.entries[0].intermediateStateSelection?.bonusOpportunityId).toBe(later.id)
    expect(memory.entries[0].intermediateStateSelection?.improvementPreference).toBe('bonus_first')
  })
})
