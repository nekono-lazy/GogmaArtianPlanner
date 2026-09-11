import { createBuildListCalculationContext } from './createBuildListCalculationContext'
import { createValidMasterDataFixture } from '../../test/fixtures/masterData'
import { describe, expect, it, vi } from 'vitest'
import { createBuildListEntry } from '../../domain/buildList'
import { createSearchStateHash } from '../../domain/models/hashing'
import type { BuildListEntry } from '../../domain/models/publicTypes'
import {
  createValidBuildCandidate,
  createValidNormalArtianCounter,
  createValidRngState,
  createValidTargetWeapon,
  domainFixtureContext,
} from '../../test/fixtures/domainData'
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
    deleteEntry: vi.fn(async (id) => {
      const index = entries.findIndex((entry) => entry.id === id)
      if (index >= 0) entries.splice(index, 1)
    }),
    ensureRngState: async () => rngState,
    getNormalCounters: async () => normalCounters,
    getOwnedWeapons: async () => [],
    getTargets: async () => [target],
  }
  return { entries, target, rngState, normalCounters, repositories }
}

describe('BuildListService', () => {
  it('marks a pre-B5-F1 Ideal snapshot stale without deleting or reclassifying it', async () => {
    const memory = memoryRepositories()
    const current = createBuildListCalculationContext(createValidMasterDataFixture())
    const candidate = createValidBuildCandidate()
    candidate.category = 'ideal'
    candidate.isSimilarToIdeal = false
    candidate.calculationContext = { ...current, appSchemaVersion: 1 }
    candidate.searchStateHash = createSearchStateHash(candidate.route, memory.rngState, memory.normalCounters)
    const original = createBuildListEntry(candidate, memory.target, { createdAt: '2026-08-29T04:00:00.000Z' })
    const snapshot = structuredClone(original.candidateSnapshot)
    memory.entries.push(original)

    const refreshed = await new BuildListService(memory.repositories).refreshStaleness(current)
    expect(current.appSchemaVersion).toBe(9)
    expect(refreshed.entries[0].isStale).toBe(true)
    expect(refreshed.entries[0].staleReasons).toEqual(['calculation_context_changed'])
    expect(refreshed.entries[0].candidateSnapshot).toEqual(snapshot)
    expect(refreshed.entries[0].candidateSnapshot.category).toBe('ideal')
    expect(refreshed.entries[0].candidateSnapshot.restorationBonusScope).toBe('normal_artian')
    expect(memory.repositories.putEntry).toHaveBeenCalledOnce()
    expect(memory.repositories.deleteEntry).not.toHaveBeenCalled()
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

  it.each([1, 2, 3, 4, 5, 6, 7, 8])('adds a current Candidate beside an unchanged schema %i snapshot', async (appSchemaVersion) => {
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
    expect(result.entry.calculationContext.appSchemaVersion).toBe(9)
    expect(memory.repositories.deleteEntry).not.toHaveBeenCalled()
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
})
