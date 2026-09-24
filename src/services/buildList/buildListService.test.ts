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
import {
  BuildListCardinalityError,
  BuildListService,
  type BuildListCandidateReplacementRequest,
  type BuildListServiceRepositories,
} from './buildListService'

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
    // One decision over the stored Entries, then the addition it asked for.
    decideAndAddEntry: vi.fn(async (decide) => {
      const decision = decide([...entries])
      if (decision.entry !== null) {
        if (entries.some(({ id }) => id === decision.entry?.id)) throw new Error('duplicate key')
        entries.push(decision.entry)
      }
      return decision.result
    }) as BuildListServiceRepositories['decideAndAddEntry'],
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
        return { result: write.result, state: write.state, planTermination: write.planTermination }
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
    expect(current.appSchemaVersion).toBe(14)
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

  it.each([12, 13])('keeps a schema %i BuildListEntry usable under schema 14 when nothing else changed', async (appSchemaVersion) => {
    const memory = memoryRepositories()
    const current = createBuildListCalculationContext(createValidMasterDataFixture())
    expect(current.appSchemaVersion).toBe(14)
    const candidate = createValidBuildCandidate()
    candidate.calculationContext = { ...current, appSchemaVersion }
    candidate.searchStateHash = createSearchStateHash(candidate.route, memory.rngState, memory.normalCounters)
    const original = createBuildListEntry(candidate, memory.target, { createdAt: '2026-08-29T04:00:00.000Z' })
    memory.entries.push(original)

    const refreshed = await new BuildListService(memory.repositories).refreshStaleness(current)

    // The schema 13 change is ProductionPlan execution only (PLANNER_SPEC 16.11)
    // and the schema 14 change is the Production Planner strategy only (Issue
    // #103 Phase C), so a version 12 / 13 Entry is not stale for its
    // calculation context.
    expect(refreshed.entries[0]).toMatchObject({ isStale: false, staleReasons: [] })
    expect(refreshed.entries[0].candidateSnapshot).toEqual(original.candidateSnapshot)
    expect(refreshed.entries[0].calculationContext.appSchemaVersion).toBe(appSchemaVersion)
  })

  it('still marks a schema 13 BuildListEntry stale when another CalculationContext field differs', async () => {
    const memory = memoryRepositories()
    const current = createBuildListCalculationContext(createValidMasterDataFixture())
    const candidate = createValidBuildCandidate()
    candidate.calculationContext = { ...current, appSchemaVersion: 13, rngEngineVersion: 'production-rng:other' }
    candidate.searchStateHash = createSearchStateHash(candidate.route, memory.rngState, memory.normalCounters)
    memory.entries.push(createBuildListEntry(candidate, memory.target, { createdAt: '2026-08-29T04:00:00.000Z' }))

    const refreshed = await new BuildListService(memory.repositories).refreshStaleness(current)

    expect(refreshed.entries[0]).toMatchObject({ isStale: true, staleReasons: ['calculation_context_changed'] })
  })

  it('still stales a schema 12 BuildListEntry for its real reasons, not for the schema', async () => {
    const memory = memoryRepositories()
    const current = createBuildListCalculationContext(createValidMasterDataFixture())
    const candidate = createValidBuildCandidate()
    candidate.calculationContext = { ...current, appSchemaVersion: 12 }
    candidate.searchStateHash = createSearchStateHash(candidate.route, memory.rngState, memory.normalCounters)
    memory.entries.push(createBuildListEntry(candidate, memory.target, { createdAt: '2026-08-29T04:00:00.000Z' }))
    // The RNG state the Route depends on moved.
    memory.rngState.skillCounter = { value: 8, isConfirmed: true, source: 'manual' }

    const refreshed = await new BuildListService(memory.repositories).refreshStaleness(current)

    expect(refreshed.entries[0]).toMatchObject({ isStale: true, staleReasons: ['rng_state_changed'] })
  })

  it.each([
    ['gameVersion', { gameVersion: 'game.other' }],
    ['masterDataVersion', { masterDataVersion: 999 }],
    ['rngEngineVersion', { rngEngineVersion: 'production-rng:other' }],
  ])('stales a schema 12 BuildListEntry whose %s differs', async (_, difference) => {
    const memory = memoryRepositories()
    const current = createBuildListCalculationContext(createValidMasterDataFixture())
    const candidate = createValidBuildCandidate()
    candidate.calculationContext = { ...current, appSchemaVersion: 12, ...difference }
    candidate.searchStateHash = createSearchStateHash(candidate.route, memory.rngState, memory.normalCounters)
    memory.entries.push(createBuildListEntry(candidate, memory.target, { createdAt: '2026-08-29T04:00:00.000Z' }))

    const refreshed = await new BuildListService(memory.repositories).refreshStaleness(current)

    expect(refreshed.entries[0]).toMatchObject({ isStale: true, staleReasons: ['calculation_context_changed'] })
  })

  it('treats a current Candidate identical to a schema 12 Entry as already added', async () => {
    const memory = memoryRepositories()
    const candidate = createValidBuildCandidate()
    candidate.calculationContext = createBuildListCalculationContext(createValidMasterDataFixture())
    candidate.searchStateHash = createSearchStateHash(candidate.route, memory.rngState, memory.normalCounters)
    const historical = structuredClone(candidate)
    historical.calculationContext.appSchemaVersion = 12
    memory.entries.push(createBuildListEntry(historical, memory.target, { createdAt: '2026-08-29T04:00:00.000Z' }))

    const result = await new BuildListService(memory.repositories).addCandidate(candidate, memory.target)

    expect(result.status).toBe('duplicate')
    expect(memory.entries).toHaveLength(1)
  })

  it('adds a Candidate snapshot once and rejects a semantic duplicate from a new search', async () => {
    const memory = memoryRepositories()
    const service = new BuildListService(memory.repositories)
    const candidate = createValidBuildCandidate()
    candidate.searchStateHash = createSearchStateHash(candidate.route, memory.rngState, memory.normalCounters)
    const first = await service.addCandidate(candidate, memory.target)
    const repeated = { ...candidate, id: 'candidate.another-run' as typeof candidate.id, searchRunId: 'another-run' }
    const second = await service.addCandidate(repeated, memory.target)
    expect(first.status).toBe('added')
    expect(second).toEqual({ status: 'duplicate', entry: memory.entries[0] })
    expect(memory.entries).toHaveLength(1)
  })

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])('never adds a current Candidate beside an unchanged schema %i snapshot of its Target', async (appSchemaVersion) => {
    // The historical Entry is stale, yet it is still the Target's one Entry
    // (`docs/DATA_MODEL.md` 9.4.1): the current Candidate needs a confirmed
    // replacement, and nothing is written until then.
    const memory = memoryRepositories()
    const candidate = createValidBuildCandidate()
    candidate.calculationContext = createBuildListCalculationContext(createValidMasterDataFixture())
    const historical = structuredClone(candidate)
    historical.calculationContext.appSchemaVersion = appSchemaVersion
    const oldEntry = createBuildListEntry(historical, memory.target, { createdAt: '2026-08-29T04:00:00.000Z' })
    const before = structuredClone(oldEntry)
    memory.entries.push(oldEntry)
    const result = await new BuildListService(memory.repositories).addCandidate(candidate, memory.target)
    expect(result).toEqual({ status: 'replacement_required', existingEntry: before })
    expect(memory.entries).toEqual([before])
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
    if (first.status !== 'added') throw new Error('Expected an addition.')
    expect(first.entry.intermediateStateSelection).toEqual(selection)
    // A second Search finds the same Candidate again under a new run id.
    const repeated = structuredClone(candidate)
    repeated.id = 'candidate.checkpoint.another' as typeof repeated.id
    repeated.searchRunId = 'search-run.checkpoint.another'
    const second = await service.addCandidate(repeated, target, defaultIntermediateStateSelection())

    expect(second.status).toBe('duplicate')
    if (second.status !== 'duplicate') return
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
    if (added.status !== 'added') throw new Error('Expected an addition.')

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

/** Two different Candidates (Routes) of the one fixture Target. */
function twoCandidates() {
  const first = checkpointCandidate([checkpointPracticalBonuses(), checkpointIdealBonuses()])
  const second = checkpointCandidate([
    checkpointPracticalBonuses(),
    checkpointPracticalBonusesReordered(),
    checkpointIdealBonuses(),
  ])
  second.id = 'candidate.checkpoint.second' as typeof second.id
  second.searchRunId = 'search-run.checkpoint.second'
  return { first, second, target: checkpointTarget() }
}

const REPLACED_AT = '2026-09-24T00:00:00.000Z'

describe('Build List cardinality (docs/DATA_MODEL.md 9.4.1)', () => {
  it('adds a Candidate to a Target with no Entry', async () => {
    const memory = memoryRepositories()
    const { first, target } = twoCandidates()

    const result = await new BuildListService(memory.repositories).addCandidate(first, target)

    expect(result.status).toBe('added')
    expect(memory.entries).toHaveLength(1)
    expect(memory.repositories.decideAndAddEntry).toHaveBeenCalledOnce()
    expect(memory.repositories.persistence.apply).not.toHaveBeenCalled()
  })

  it('reports replacement_required for another Candidate of the Target and writes nothing', async () => {
    const memory = memoryRepositories()
    const service = new BuildListService(memory.repositories)
    const { first, second, target } = twoCandidates()
    await service.addCandidate(first, target)
    const before = structuredClone(memory.entries)

    const result = await service.addCandidate(second, target)

    expect(result).toEqual({ status: 'replacement_required', existingEntry: before[0] })
    expect(memory.entries).toEqual(before)
    expect(memory.repositories.persistence.apply).not.toHaveBeenCalled()
  })

  it('refuses an addition to a Target holding a legacy duplicate, stale Entries included, and writes nothing', async () => {
    const memory = memoryRepositories()
    const { first, second, target } = twoCandidates()
    const third = checkpointCandidate([checkpointIdealBonuses()])
    const a1 = createBuildListEntry(first, target, { createdAt: '2026-08-29T04:00:00.000Z' })
    const a2 = { ...createBuildListEntry(second, target, { createdAt: '2026-08-29T05:00:00.000Z' }), isStale: true, staleReasons: ['rng_state_changed' as const] }
    memory.entries.push(a1, a2)
    const before = structuredClone(memory.entries)

    const result = await new BuildListService(memory.repositories).addCandidate(third, target)

    expect(result.status).toBe('legacy_duplicate')
    if (result.status !== 'legacy_duplicate') return
    expect(result.entries.map(({ id }) => id)).toEqual([a1.id, a2.id].sort())
    expect(memory.entries).toEqual(before)
    // Re-adding a Candidate equal to one of them is refused the same way: the
    // cardinality violation comes before the semantic duplicate rule.
    const reAdded = await new BuildListService(memory.repositories).addCandidate(first, target)
    expect(reAdded.status).toBe('legacy_duplicate')
    expect(memory.entries).toEqual(before)
  })

  describe('replaceCandidate', () => {
    async function withFirstAdded(selection = defaultIntermediateStateSelection()) {
      const memory = memoryRepositories()
      memory.repositories.clock = { now: () => REPLACED_AT }
      const service = new BuildListService(memory.repositories)
      const candidates = twoCandidates()
      const added = await service.addCandidate(candidates.first, candidates.target, selection)
      if (added.status !== 'added') throw new Error('Expected an addition.')
      return { memory, service, ...candidates, a1: added.entry }
    }

    function request(
      candidate: BuildListCandidateReplacementRequest['candidate'],
      target: BuildListCandidateReplacementRequest['target'],
      expectedExistingEntryId: BuildListCandidateReplacementRequest['expectedExistingEntryId'],
      intermediateStateSelection = defaultIntermediateStateSelection(),
    ): BuildListCandidateReplacementRequest {
      return { candidate, target, intermediateStateSelection, expectedExistingEntryId }
    }

    it('replaces A1 with A2 so that only A2 remains', async () => {
      const { memory, service, second, target, a1 } = await withFirstAdded()

      const inspection = await service.inspectCandidateReplacement(request(second, target, a1.id))
      expect(inspection).toEqual({ approvalRequired: false })
      const a2 = await service.replaceCandidate(request(second, target, a1.id))

      expect(memory.entries).toEqual([a2])
      expect(a2.id).not.toBe(a1.id)
      expect(a2.candidateId).toBe(second.id)
      expect(a2.targetWeaponId).toBe(target.id)
      expect(a2.createdAt).toBe(REPLACED_AT)
      expect(memory.repositories.persistence.apply).toHaveBeenCalledOnce()
    })

    it('never carries the replaced Entry\'s checkpoint selection or improvement preference over', async () => {
      const candidates = twoCandidates()
      const selected = {
        skillOpportunityId: null,
        bonusOpportunityId: intermediateOpportunityAt(candidates.first, 'bonus', 1).opportunity.id,
        improvementPreference: 'skill_first' as const,
      }
      const { memory, service, second, target, a1 } = await withFirstAdded(selected)
      expect(a1.intermediateStateSelection).toEqual(selected)

      const a2 = await service.replaceCandidate(request(second, target, a1.id))

      expect(a2.intermediateStateSelection).toEqual(defaultIntermediateStateSelection())
      expect(memory.entries).toEqual([a2])

      // Only the selection the Search screen sends for the new Candidate is used.
      const own = {
        skillOpportunityId: null,
        bonusOpportunityId: intermediateOpportunityAt(candidates.first, 'bonus', 1).opportunity.id,
        improvementPreference: 'bonus_first' as const,
      }
      const again = await withFirstAdded(selected)
      const withOwn = await again.service.replaceCandidate(
        request(again.second, again.target, again.a1.id, {
          ...own,
          bonusOpportunityId: intermediateOpportunityAt(again.second, 'bonus', 2).opportunity.id,
        }),
      )
      expect(withOwn.intermediateStateSelection).toEqual({
        ...own,
        bonusOpportunityId: intermediateOpportunityAt(again.second, 'bonus', 2).opportunity.id,
      })
    })

    it('keeps A1 when the new Entry fails validation', async () => {
      const { memory, service, second, target, a1 } = await withFirstAdded()
      const before = structuredClone(memory.entries)

      await expect(service.replaceCandidate(request(second, target, a1.id, {
        ...defaultIntermediateStateSelection(),
        bonusOpportunityId: 'intermediate-opportunity:unknown' as IntermediateStateOpportunityId,
      }))).rejects.toThrow(/candidate snapshot/)

      expect(memory.entries).toEqual(before)
    })

    it('changes nothing when the expected Entry is no longer the Target\'s only Entry', async () => {
      const { memory, service, second, target, a1 } = await withFirstAdded()
      const before = structuredClone(memory.entries)

      const stale = await service
        .replaceCandidate(request(second, target, 'build-list.somewhere-else' as typeof a1.id))
        .catch((caught: unknown) => caught)
      expect(stale).toBeInstanceOf(BuildListCardinalityError)
      expect((stale as BuildListCardinalityError).code).toBe('replacement_target_changed')
      expect(memory.entries).toEqual(before)

      // Deleted in another tab: nothing is left to replace.
      memory.entries.splice(0)
      await expect(service.replaceCandidate(request(second, target, a1.id)))
        .rejects.toMatchObject({ code: 'replacement_target_changed' })
      expect(memory.entries).toEqual([])
    })

    it('refuses a legacy duplicate, the Candidate already added and a missing Target', async () => {
      const { memory, service, first, second, target, a1 } = await withFirstAdded()
      await expect(service.replaceCandidate(request(first, target, a1.id)))
        .rejects.toMatchObject({ code: 'candidate_already_added' })

      const third = checkpointCandidate([checkpointIdealBonuses()])
      const legacy = createBuildListEntry(third, target, { createdAt: '2026-08-29T05:00:00.000Z' })
      memory.entries.push(legacy)
      const before = structuredClone(memory.entries)
      await expect(service.replaceCandidate(request(second, target, a1.id)))
        .rejects.toMatchObject({ code: 'legacy_duplicate_entries' })
      expect(memory.entries).toEqual(before)

      const missing = { ...target, id: 'target.missing' as typeof target.id }
      await expect(service.replaceCandidate(request({ ...second, targetWeaponId: missing.id }, missing, a1.id)))
        .rejects.toMatchObject({ code: 'target_not_found' })
      expect(memory.entries).toEqual(before)
    })

    it('lets the user delete one Entry of a legacy duplicate as before', async () => {
      const memory = memoryRepositories()
      const { first, second, target } = twoCandidates()
      const a1 = createBuildListEntry(first, target, { createdAt: '2026-08-29T04:00:00.000Z' })
      const a2 = createBuildListEntry(second, target, { createdAt: '2026-08-29T05:00:00.000Z' })
      memory.entries.push(a1, a2)

      await new BuildListService(memory.repositories).deleteEntry(a1.id)

      expect(memory.entries).toEqual([a2])
    })
  })
})
