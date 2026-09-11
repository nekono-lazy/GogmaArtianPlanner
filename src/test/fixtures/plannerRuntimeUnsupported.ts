import { createTargetDefinitionHash } from '../../domain/buildList'
import {
  createReferencedOwnedWeaponsHash,
  createSearchStateHash,
} from '../../domain/models/hashing'
import type { RngEngine } from '../../domain/rng/rngEngine'
import type {
  BuildListEntry,
  OwnedGogmaArtianWeapon,
  TargetWeapon,
} from '../../domain/models/publicTypes'
import type {
  PlannerDependencies,
  PlannerInput,
} from '../../domain/planner/plannerTypes'
import {
  buildListEntryId,
  candidateId,
  createRestorationBonusSet,
  createValidBuildListEntry,
  createValidOwnedWeapon,
  createValidTargetWeapon,
  ownedWeaponId,
  targetWeaponId,
} from './domainData'
import {
  createCandidateSearchEngine,
  createCandidateSearchInput,
} from './candidateSearch'

/**
 * The two-Beam Production Plan fixture.
 *
 * The first full Beam Search selects an Entry whose Skill prediction support
 * flips to unsupported at Trace Replay, so `createProductionPlan()` excludes
 * that Entry and starts a second full Beam Search. Shared so the
 * runtime-unsupported fallback test and the B8-C4a observed-boundary and
 * `maxPlannerReruns` budget tests exercise exactly the same retry behaviour.
 *
 * Deliberately free of `vi` helpers: `vi.mock` / `vi.hoisted` are hoisted per
 * test file and must stay declared there.
 */

export function synchronizeEntry(
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

export function createSource(
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
    groupSkillId: 'group_skill.fixture.a',
    status: 'material',
    isProtected: false,
    relatedTargetWeaponIds: [],
  }
}

export function createEntry(
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

export function runtimeUnsupportedFixture(): {
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
