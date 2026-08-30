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
