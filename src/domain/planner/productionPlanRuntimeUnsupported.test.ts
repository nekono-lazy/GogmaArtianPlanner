import { describe, expect, it, vi } from 'vitest'
import { createTargetDefinitionHash } from '../buildList'
import {
  createReferencedOwnedWeaponsHash,
  createSearchStateHash,
} from '../models/hashing'
import type { RngEngine } from '../rng/rngEngine'
import {
  buildListEntryId,
  candidateId,
  createRestorationBonusSet,
  createValidBuildListEntry,
  createValidOwnedWeapon,
  createValidTargetWeapon,
  ownedWeaponId,
  targetWeaponId,
} from '../../test/fixtures/domainData'
import {
  createCandidateSearchEngine,
  createCandidateSearchInput,
} from '../../test/fixtures/candidateSearch'
import type {
  BuildListEntry,
  OwnedGogmaArtianWeapon,
  TargetWeapon,
} from '../models/publicTypes'
import { createProductionPlan } from './productionPlanGeneration'
import type {
  PlannerBeamSearchResult,
  PlannerDependencies,
  PlannerInput,
} from './plannerTypes'

const beamCapture = vi.hoisted(() => ({
  calls: [] as Array<{
    buildListEntryIds: string[]
    result: unknown
  }>,
}))

vi.mock('./plannerBeamSearch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./plannerBeamSearch')>()
  return {
    ...actual,
    runPlannerBeamSearch: async (
      ...args: Parameters<typeof actual.runPlannerBeamSearch>
    ) => {
      const result = await actual.runPlannerBeamSearch(...args)
      beamCapture.calls.push({
        buildListEntryIds: args[0].buildListEntries.map(({ id }) => id),
        result,
      })
      return result
    },
  }
})

function synchronizeEntry(
  input: PlannerInput,
  entry: BuildListEntry,
  target: TargetWeapon,
) {
  entry.calculationContext = structuredClone(input.calculationContext)
  entry.candidateSnapshot.calculationContext =
    structuredClone(input.calculationContext)
  entry.targetDefinitionHash = createTargetDefinitionHash(target)
  entry.searchStateHash = createSearchStateHash(
    entry.candidateSnapshot.route,
    input.rngState,
    input.normalCounters,
  )
  entry.candidateSnapshot.searchStateHash = entry.searchStateHash
  entry.referencedOwnedWeaponsHash = createReferencedOwnedWeaponsHash(
    entry.candidateSnapshot.route,
    input.ownedWeapons,
  )
  entry.candidateSnapshot.referencedOwnedWeaponsHash =
    entry.referencedOwnedWeaponsHash
}

function createSource(
  suffix: string,
  target: TargetWeapon,
): OwnedGogmaArtianWeapon {
  return {
    ...createValidOwnedWeapon(ownedWeaponId(`owned.runtime.${suffix}`)),
    weaponTypeId: target.weaponTypeId,
    elementId: target.elementId,
    restorationBonuses: createRestorationBonusSet(),
    restorationBonusScope: 'gogma_artian',
    seriesSkillId: null,
    groupSkillId: null,
    status: 'material',
    isProtected: true,
    relatedTargetWeaponIds: [],
  }
}

function createEntry(
  suffix: string,
  target: TargetWeapon,
  source: OwnedGogmaArtianWeapon,
): BuildListEntry {
  const entry = createValidBuildListEntry()
  entry.id = buildListEntryId(`entry.runtime.${suffix}`)
  entry.candidateId = candidateId(`candidate.runtime.${suffix}`)
  entry.targetWeaponId = target.id
  entry.candidateSnapshot.id = entry.candidateId
  entry.candidateSnapshot.targetWeaponId = target.id
  entry.candidateSnapshot.category = 'ideal'
  entry.candidateSnapshot.isSimilarToIdeal = false
  entry.candidateSnapshot.finalBonuses =
    structuredClone(source.restorationBonuses)
  entry.candidateSnapshot.restorationBonusScope = 'gogma_artian'
  entry.candidateSnapshot.seriesSkillId = 'series_skill.fixture.a'
  entry.candidateSnapshot.groupSkillId = null
  entry.candidateSnapshot.route = {
    kind: 'existing_gogma_reset_skills',
    sourceOwnedWeaponId: source.id,
    operations: [{
      type: 'reset_skills',
      sourceOwnedWeaponId: source.id,
      skillCounterBefore: 7,
      skillCounterAfter: 8,
    }],
  }
  entry.candidateSnapshot.estimatedOperationCount = 1
  entry.candidateSnapshot.estimatedGogmaAdvance = 0
  entry.candidateSnapshot.estimatedSkillAdvance = 1
  entry.candidateSnapshot.estimatedNormalAdvance = null
  return entry
}

function runtimeUnsupportedFixture(): {
  input: PlannerInput
  dependencies: PlannerDependencies
  entries: BuildListEntry[]
} {
  const searchInput = createCandidateSearchInput()
  const targets = ([
    ['a', 4, 'weapon.fixture.a'],
    ['b', 5, 'weapon.fixture.b'],
    ['c', 3, 'weapon.fixture.a'],
  ] as const).map(([suffix, priority, weaponTypeId]) => ({
    ...createValidTargetWeapon(),
    id: targetWeaponId(`target.runtime.${suffix}`),
    name: `Runtime ${suffix}`,
    priority,
    weaponTypeId,
  }))
  const sources = targets.map((target, index) =>
    createSource(String.fromCharCode(97 + index), target))
  const entries = targets.map((target, index) =>
    createEntry(String.fromCharCode(97 + index), target, sources[index]))
  const baseEngine = createCandidateSearchEngine(searchInput)
  const skillSupportCalls = new Map<string, number>()
  const engine: RngEngine = {
    version: baseEngine.version,
    capabilities: { ...baseEngine.capabilities },
    getPredictionSupport: (supportInput) => {
      if (
        supportInput.type === 'skill' &&
        supportInput.weaponTypeId === targets[1].weaponTypeId
      ) {
        const count = (skillSupportCalls.get(supportInput.weaponTypeId) ?? 0) + 1
        skillSupportCalls.set(supportInput.weaponTypeId, count)
        return count === 1
          ? { supported: true }
          : { supported: false, reason: 'reference_adapter_unsupported' }
      }
      return baseEngine.getPredictionSupport(supportInput)
    },
    normalizeSeed: baseEngine.normalizeSeed.bind(baseEngine),
    predictGogmaBonus: baseEngine.predictGogmaBonus.bind(baseEngine),
    predictSkills: () => ({
      seriesSkillId: 'series_skill.fixture.a',
      groupSkillId: null,
    }),
    predictNormalArtian: baseEngine.predictNormalArtian.bind(baseEngine),
    advanceGogmaCounter: baseEngine.advanceGogmaCounter.bind(baseEngine),
    advanceSkillCounter: baseEngine.advanceSkillCounter.bind(baseEngine),
    advanceNormalCounter: baseEngine.advanceNormalCounter.bind(baseEngine),
  }
  const input: PlannerInput = {
    rngState: structuredClone(searchInput.rngState),
    normalCounters: structuredClone(searchInput.normalCounters),
    ownedWeapons: sources,
    targetWeapons: targets,
    buildListEntries: entries,
    calculationContext: {
      ...structuredClone(searchInput.calculationContext),
      rngEngineVersion: engine.version,
    },
    options: {
      maxPlanSteps: 300,
      beamWidth: 50,
      maxExpandedStates: 10_000,
    },
    master: structuredClone(searchInput.master),
    conflictResolutions: [],
  }
  entries.forEach((entry, index) =>
    synchronizeEntry(input, entry, targets[index]))
  let planId = 0
  let stepId = 0
  let ownedId = 0
  return {
    input,
    entries,
    dependencies: {
      rngEngine: engine,
      idFactory: {
        productionPlanId: () => `plan.runtime.${++planId}` as never,
        planStepId: () => `step.runtime.${++stepId}` as never,
        ownedWeaponId: () => `owned.runtime.created.${++ownedId}` as never,
      },
      clock: { now: () => '2026-09-01T00:00:00.000Z' },
    },
  }
}

describe('Production plan replay-time unsupported fallback', () => {
  it('excludes only the runtime-unsupported Entry and reruns Beam once', async () => {
    beamCapture.calls.length = 0
    const { input, dependencies, entries } = runtimeUnsupportedFixture()

    const result = await createProductionPlan(input, dependencies)

    expect(result.plan).not.toBeNull()
    expect(beamCapture.calls).toHaveLength(2)
    expect(beamCapture.calls[0].buildListEntryIds).toEqual(
      entries.map(({ id }) => id),
    )
    expect(beamCapture.calls[0].result).toMatchObject({
      bestState: {
        selectedBuildListEntryIds: expect.arrayContaining([entries[1].id]),
      },
    })
    expect(beamCapture.calls[1].buildListEntryIds).toEqual([
      entries[0].id,
      entries[2].id,
    ])
    expect(result.plan?.selectedBuildListEntryIds).not.toContain(entries[1].id)
    expect(result.plan?.selectedBuildListEntryIds.some((id) =>
      id === entries[0].id || id === entries[2].id,
    )).toBe(true)
    expect(result.warnings).toContainEqual({
      kind: 'rng_prediction_unsupported',
      message: expect.stringContaining(String(entries[1].id)),
    })
    const finalBeamResult =
      beamCapture.calls[1].result as PlannerBeamSearchResult
    expect(finalBeamResult.excludedBuildListEntries).toContainEqual({
      entry: entries[1],
      reason: expect.stringContaining('reference_adapter_unsupported'),
    })
  })
})
