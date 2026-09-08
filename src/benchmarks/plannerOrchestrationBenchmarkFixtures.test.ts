import { describe, expect, it } from 'vitest'
import { evaluateBuildListEntryStaleness } from '../domain/buildList'
import { loadMasterData } from '../domain/master/loadMasterData'
import { CURRENT_CALCULATION_APP_SCHEMA_VERSION } from '../domain/models/publicTypes'
import type { PlannerOrchestrationBounds } from '../domain/planner'
import {
  createProductionPlanWithConstrainedSearch,
  createProductionPlannerDependencies,
  validatePlannerInput,
} from '../domain/planner'
import {
  PRODUCTION_RNG_ENGINE_VERSION,
  ProductionRngEngine,
} from '../domain/rng/production/productionRngEngine'
import { defaultConstrainedEnumerationBounds } from '../domain/search'
import { validateTargetIdealImpliesPractical, satisfiesPracticalTarget } from '../domain/target'
import {
  BENCHMARK_ONLY_DEFAULT_SWEEP_BOUNDS,
  BENCHMARK_ONLY_ORCHESTRATION_BOUNDS_SWEEP,
  createPlannerOrchestrationBenchmarkInput,
  plannerOrchestrationBenchmarkWorkload,
  plannerOrchestrationBenchmarkWorkloads,
} from './plannerOrchestrationBenchmarkFixtures'
import { createPlannerOrchestrationOutcome } from './plannerOrchestrationBenchmarkOutcome'

/**
 * B8-E1 fixture correctness only. No performance value is read here: a Node
 * Vitest run is not a Browser Worker measurement, and B8-E2 is the phase that
 * measures. Every bounds tuple below is a **test-only** value, never a proposed
 * Production `PlannerOrchestrationBounds` default.
 */
const TEST_ONLY_GENEROUS_BOUNDS: PlannerOrchestrationBounds = {
  maxCandidateTrialsPerConflict: 16,
  maxGeneratedBuildListEntries: 4,
  maxPlannerReruns: 32,
}

function testOnlyBounds(
  overrides: Partial<PlannerOrchestrationBounds>,
): PlannerOrchestrationBounds {
  return { ...TEST_ONLY_GENEROUS_BOUNDS, ...overrides }
}

function runOrchestration(
  workloadId: string,
  orchestrationBounds: PlannerOrchestrationBounds,
) {
  const fixture = createPlannerOrchestrationBenchmarkInput(workloadId)
  const dependencies = createProductionPlannerDependencies(new ProductionRngEngine())
  return createProductionPlanWithConstrainedSearch(fixture.input, dependencies, {
    enumerationBounds: defaultConstrainedEnumerationBounds,
    orchestrationBounds,
  })
}

const ORCHESTRATION_BOUND_WARNING_KINDS = [
  'max_candidate_trials_per_conflict_reached',
  'max_generated_build_list_entries_reached',
  'max_planner_reruns_reached',
  'constrained_enumeration_bound_reached',
]

describe('B8-E1 Planner orchestration benchmark fixtures', () => {
  it('exposes the five workload families and rejects an unknown id', () => {
    expect(plannerOrchestrationBenchmarkWorkloads.map(({ group }) => group)).toEqual([
      'baseline',
      'early_adoption',
      'trial_pressure',
      'generated_cap',
      'combined',
    ])
    expect(
      plannerOrchestrationBenchmarkWorkload('orchestration_ordinary_baseline').id,
    ).toBe('orchestration_ordinary_baseline')
    expect(() => plannerOrchestrationBenchmarkWorkload('missing')).toThrow(RangeError)
  })

  it('builds a Domain-valid PlannerInput for every workload', () => {
    const dependencies = createProductionPlannerDependencies(new ProductionRngEngine())
    plannerOrchestrationBenchmarkWorkloads.forEach(({ id }) => {
      const { input } = createPlannerOrchestrationBenchmarkInput(id)
      const validation = validatePlannerInput(input, dependencies)
      expect({ id, issues: validation.issues }).toEqual({ id, issues: [] })
      expect({ id, valid: validation.isValid }).toEqual({ id, valid: true })
      // Every Entry survives Planner validation: none is excluded as stale,
      // capability-incompatible, or protection-blocked.
      expect({ id, excluded: validation.excludedBuildListEntries }).toEqual({
        id,
        excluded: [],
      })
      expect(validation.validBuildListEntries).toHaveLength(
        input.buildListEntries.length,
      )
    })
  })

  it('uses the current Production CalculationContext and RNG Engine version', () => {
    const loaded = loadMasterData()
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    plannerOrchestrationBenchmarkWorkloads.forEach(({ id }) => {
      const { input } = createPlannerOrchestrationBenchmarkInput(id)
      expect(input.calculationContext).toEqual({
        gameVersion: loaded.data.manifest.gameVersion,
        masterDataVersion: loaded.data.manifest.dataVersion,
        appSchemaVersion: CURRENT_CALCULATION_APP_SCHEMA_VERSION,
        rngEngineVersion: PRODUCTION_RNG_ENGINE_VERSION,
      })
      expect(input.calculationContext.appSchemaVersion).toBe(2)
      input.buildListEntries.forEach((entry) => {
        expect(entry.calculationContext).toEqual(input.calculationContext)
        expect(entry.candidateSnapshot.calculationContext).toEqual(
          input.calculationContext,
        )
      })
    })
  })

  it('keeps every BuildListEntry non-stale against the state the Planner receives', () => {
    plannerOrchestrationBenchmarkWorkloads.forEach(({ id }) => {
      const { input } = createPlannerOrchestrationBenchmarkInput(id)
      input.buildListEntries.forEach((entry) => {
        const target =
          input.targetWeapons.find(({ id: targetId }) => targetId === entry.targetWeaponId) ??
          null
        const staleness = evaluateBuildListEntryStaleness(entry, {
          target,
          rngState: input.rngState,
          normalCounters: input.normalCounters,
          ownedWeapons: input.ownedWeapons,
          calculationContext: input.calculationContext,
        })
        expect({ id, entry: entry.id, staleness }).toEqual({
          id,
          entry: entry.id,
          staleness: { isStale: false, staleReasons: [] },
        })
        expect(entry.isStale).toBe(false)
      })
    })
  })

  it('satisfies Ideal implies Practical for every Target', () => {
    const loaded = loadMasterData()
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    const master = loaded.data
    plannerOrchestrationBenchmarkWorkloads.forEach(({ id }) => {
      const { input } = createPlannerOrchestrationBenchmarkInput(id)
      input.targetWeapons.forEach((target) => {
        const containment = validateTargetIdealImpliesPractical(target, master)
        expect({ id, target: target.id, issues: containment.issues }).toEqual({
          id,
          target: target.id,
          issues: [],
        })
      })
    })
  })

  it('keeps every source weapon from already satisfying its own Target', () => {
    const loaded = loadMasterData()
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    const master = loaded.data
    plannerOrchestrationBenchmarkWorkloads.forEach(({ id }) => {
      const { input } = createPlannerOrchestrationBenchmarkInput(id)
      // A source that already satisfied its Target would remove that Target
      // from planning entirely, so no conflict and no re-search would happen.
      input.targetWeapons.forEach((target) => {
        input.ownedWeapons.forEach((weapon) => {
          if (
            weapon.kind !== 'gogma' ||
            weapon.weaponTypeId !== target.weaponTypeId ||
            weapon.elementId !== target.elementId
          ) {
            return
          }
          expect({
            id,
            target: target.id,
            weapon: weapon.id,
            practical: satisfiesPracticalTarget(
              target,
              weapon.restorationBonuses,
              weapon.seriesSkillId,
              weapon.groupSkillId,
              master,
            ),
          }).toEqual({ id, target: target.id, weapon: weapon.id, practical: false })
        })
      })
    })
  })

  it('generates identical semantic fixtures on repeated construction', () => {
    plannerOrchestrationBenchmarkWorkloads.forEach(({ id }) => {
      const first = createPlannerOrchestrationBenchmarkInput(id)
      const second = createPlannerOrchestrationBenchmarkInput(id)
      // No Clock, no random ID, and no run identifier participates, so the
      // whole input is byte-identical - Entry IDs, hashes and all.
      expect(second.input).toEqual(first.input)
      expect(second.initialConflicts).toEqual(first.initialConflicts)
      expect(second.fixedBuildListEntryIds).toEqual(first.fixedBuildListEntryIds)
      expect(second.buildListEntryIdByTargetKey).toEqual(
        first.buildListEntryIdByTargetKey,
      )
    })
  })

  it('takes the fixed side only from explicit conflict resolutions', () => {
    const baseline = createPlannerOrchestrationBenchmarkInput(
      'orchestration_ordinary_baseline',
    )
    expect(baseline.input.conflictResolutions).toEqual([])
    expect(baseline.fixedBuildListEntryIds).toEqual([])

    plannerOrchestrationBenchmarkWorkloads
      .filter(({ conflictResolution }) => conflictResolution === 'fix_lowest_entry_id')
      .forEach(({ id }) => {
        const fixture = createPlannerOrchestrationBenchmarkInput(id)
        expect(fixture.initialConflicts.length).toBeGreaterThan(0)
        expect(fixture.input.conflictResolutions).toHaveLength(
          fixture.initialConflicts.length,
        )
        fixture.input.conflictResolutions.forEach((resolution, index) => {
          const conflict = fixture.initialConflicts[index]
          // The key comes from the real detected conflict, never hand-written.
          expect(resolution.conflictKey).toBe(conflict.id)
          expect(conflict.buildListEntryIds).toContain(
            resolution.selectedBuildListEntryId,
          )
          // And never from recommendedBuildListEntryId.
          expect(resolution.selectedBuildListEntryId).toBe(
            [...conflict.buildListEntryIds].sort()[0],
          )
        })
      })
  })

  it('adds no Production PlannerOrchestrationBounds default', async () => {
    const fixtures = await import('./plannerOrchestrationBenchmarkFixtures')
    const exported = Object.keys(fixtures).sort()
    expect(exported).not.toContain('defaultPlannerOrchestrationBounds')
    expect(
      exported.filter((name) => /^default[A-Z]/.test(name)),
    ).toEqual([])
    // The sweep is a measurement grid, and its name says so.
    expect(BENCHMARK_ONLY_ORCHESTRATION_BOUNDS_SWEEP).toEqual({
      maxCandidateTrialsPerConflict: [1, 2, 4, 8, 16],
      maxGeneratedBuildListEntries: [1, 2, 4],
      maxPlannerReruns: [1, 2, 4, 8, 16, 32],
    })
    expect(BENCHMARK_ONLY_DEFAULT_SWEEP_BOUNDS).toEqual({
      maxCandidateTrialsPerConflict: 8,
      maxGeneratedBuildListEntries: 4,
      maxPlannerReruns: 16,
    })
  })
})

describe('B8-E1 workload A: ordinary baseline', () => {
  it('detects no conflict and carries no explicit resolution', () => {
    const fixture = createPlannerOrchestrationBenchmarkInput(
      'orchestration_ordinary_baseline',
    )
    expect(fixture.initialConflicts).toEqual([])
    expect(fixture.input.conflictResolutions).toEqual([])
    expect(fixture.input.buildListEntries).toHaveLength(2)
    expect(
      fixture.input.buildListEntries.map(
        ({ candidateSnapshot }) => candidateSnapshot.route.kind,
      ),
    ).toEqual(['existing_gogma_reset_bonuses', 'normal_artian_to_gogma'])
  })

  it('produces a Plan with no generated Entry and no orchestration bound warning', async () => {
    const result = await runOrchestration(
      'orchestration_ordinary_baseline',
      TEST_ONLY_GENEROUS_BOUNDS,
    )
    expect(result.generatedBuildListEntries).toEqual([])
    expect(
      result.warnings.filter(({ kind }) =>
        ORCHESTRATION_BOUND_WARNING_KINDS.includes(kind),
      ),
    ).toEqual([])
    expect(result.plan).not.toBeNull()
    // Both Targets are secured: the Routes touch disjoint streams.
    expect(result.plan?.selectedBuildListEntryIds).toHaveLength(2)
  }, 120_000)
})

describe('B8-E1 workload B: one conflict, early adoption', () => {
  it('has exactly one two-participant same_gogma_counter conflict', () => {
    const fixture = createPlannerOrchestrationBenchmarkInput(
      'orchestration_single_conflict_early_adoption',
    )
    expect(fixture.initialConflicts).toHaveLength(1)
    expect(fixture.initialConflicts[0].kind).toBe('same_gogma_counter')
    expect(fixture.initialConflicts[0].buildListEntryIds).toHaveLength(2)
    expect(fixture.fixedBuildListEntryIds).toHaveLength(1)
  })

  it('adopts one generated Entry and keeps the fixed Entry selected', async () => {
    const result = await runOrchestration(
      'orchestration_single_conflict_early_adoption',
      TEST_ONLY_GENEROUS_BOUNDS,
    )
    const fixture = createPlannerOrchestrationBenchmarkInput(
      'orchestration_single_conflict_early_adoption',
    )
    const fixedId = fixture.fixedBuildListEntryIds[0]
    expect(result.generatedBuildListEntries).toHaveLength(1)
    const generated = result.generatedBuildListEntries[0]
    // The yielding Target escapes onto the free Normal / Skill positions.
    expect(generated.candidateSnapshot.route.kind).toBe('normal_artian_to_gogma')
    expect(generated.targetWeaponId).not.toBe(
      fixture.input.buildListEntries.find(({ id }) => id === fixedId)?.targetWeaponId,
    )
    const selected = result.plan?.selectedBuildListEntryIds ?? []
    expect(selected).toContain(fixedId)
    expect(selected).toContain(generated.id)
  }, 120_000)

  it('reports the trial bound as a stop at maxCandidateTrialsPerConflict = 1', async () => {
    const result = await runOrchestration(
      'orchestration_single_conflict_early_adoption',
      testOnlyBounds({ maxCandidateTrialsPerConflict: 1 }),
    )
    expect(result.warnings.map(({ kind }) => kind)).toContain(
      'max_candidate_trials_per_conflict_reached',
    )
    expect(result.generatedBuildListEntries).toEqual([])
  }, 120_000)

  it('reports the rerun bound as a stop at maxPlannerReruns = 1', async () => {
    const result = await runOrchestration(
      'orchestration_single_conflict_early_adoption',
      testOnlyBounds({ maxPlannerReruns: 1 }),
    )
    expect(result.warnings.map(({ kind }) => kind)).toContain(
      'max_planner_reruns_reached',
    )
    expect(result.generatedBuildListEntries).toEqual([])
  }, 120_000)
})

describe('B8-E1 workload C: shared trial budget and repeated reruns', () => {
  it('has one three-participant conflict, so two works share one trial budget', () => {
    const fixture = createPlannerOrchestrationBenchmarkInput(
      'orchestration_trial_and_rerun_pressure',
    )
    expect(fixture.initialConflicts).toHaveLength(1)
    expect(fixture.initialConflicts[0].buildListEntryIds).toHaveLength(3)
    expect(fixture.fixedBuildListEntryIds).toHaveLength(1)
  })

  it('goes further with a larger trial bound than with a small one', async () => {
    const small = await runOrchestration(
      'orchestration_trial_and_rerun_pressure',
      testOnlyBounds({ maxCandidateTrialsPerConflict: 1 }),
    )
    const larger = await runOrchestration(
      'orchestration_trial_and_rerun_pressure',
      TEST_ONLY_GENEROUS_BOUNDS,
    )
    expect(small.warnings.map(({ kind }) => kind)).toContain(
      'max_candidate_trials_per_conflict_reached',
    )
    expect(small.generatedBuildListEntries).toEqual([])
    // The larger bound reaches a usable Candidate the small one never saw, and
    // every trial it spends is a real full Beam Search rerun, not a preflight
    // rejection - the adopted Entry is only adoptable because a Plan selected it.
    expect(larger.generatedBuildListEntries).toHaveLength(1)
    expect(larger.plan?.selectedBuildListEntryIds).toContain(
      larger.generatedBuildListEntries[0].id,
    )
  }, 180_000)

  it('reports the rerun bound as a stop at maxPlannerReruns = 1', async () => {
    const result = await runOrchestration(
      'orchestration_trial_and_rerun_pressure',
      testOnlyBounds({ maxPlannerReruns: 1 }),
    )
    expect(result.warnings.map(({ kind }) => kind)).toContain(
      'max_planner_reruns_reached',
    )
  }, 120_000)
})

describe('B8-E1 workload D: generated-entry cap', () => {
  it('leaves more conflict works than one adopted Entry can settle', () => {
    const fixture = createPlannerOrchestrationBenchmarkInput(
      'orchestration_generated_entry_cap',
    )
    expect(fixture.initialConflicts).toHaveLength(1)
    expect(fixture.initialConflicts[0].buildListEntryIds).toHaveLength(4)
    expect(fixture.input.targetWeapons).toHaveLength(4)
  })

  it('reports the generated-entry cap as a stop at maxGeneratedBuildListEntries = 1', async () => {
    const capped = await runOrchestration(
      'orchestration_generated_entry_cap',
      testOnlyBounds({ maxGeneratedBuildListEntries: 1 }),
    )
    expect(capped.warnings.map(({ kind }) => kind)).toContain(
      'max_generated_build_list_entries_reached',
    )
    expect(capped.generatedBuildListEntries).toHaveLength(1)
  }, 180_000)

  it('adopts one Entry and still reports a stop with a generous cap', async () => {
    const generous = await runOrchestration(
      'orchestration_generated_entry_cap',
      TEST_ONLY_GENEROUS_BOUNDS,
    )
    // This fixture adopts one generated Entry and then reports a stop for its
    // remaining works. That is an observation of *this* workload, not a Domain
    // invariant: the B8-E1 investigation did not observe a Production-valid
    // two-entry adoption; this is not a Domain maximum and does not block
    // B8-E2 (benchmark document 7.5). Nothing here should be read as "at most
    // one generated Entry is possible".
    expect(generous.generatedBuildListEntries).toHaveLength(1)
    expect(generous.warnings.map(({ kind }) => kind)).toContain(
      'max_candidate_trials_per_conflict_reached',
    )
  }, 180_000)
})

describe('B8-E1 workload E: combined multi-Target', () => {
  it('carries five Targets, two conflict resource shapes, and two resolutions', () => {
    const fixture = createPlannerOrchestrationBenchmarkInput(
      'orchestration_combined_multi_target',
    )
    expect(fixture.input.targetWeapons).toHaveLength(5)
    expect(fixture.input.buildListEntries).toHaveLength(5)
    expect(
      [...new Set(fixture.input.targetWeapons.map(({ weaponTypeId }) => weaponTypeId))]
        .sort(),
    ).toEqual(['weapon.bow', 'weapon.long_sword'])
    expect(fixture.input.normalCounters).toHaveLength(2)
    expect([...fixture.initialConflicts.map(({ kind }) => kind)].sort()).toEqual([
      'same_gogma_counter',
      'same_skill_counter',
    ])
    expect(fixture.input.conflictResolutions).toHaveLength(2)
    expect(new Set(fixture.fixedBuildListEntryIds).size).toBe(2)
  })

  it('runs constrained re-search for both conflicts and reports every stop', async () => {
    const result = await runOrchestration(
      'orchestration_combined_multi_target',
      TEST_ONLY_GENEROUS_BOUNDS,
    )
    // Both fixed Entries keep their contested positions, so both yielding
    // Targets exhaust their trial budget instead of adopting.
    const selected = result.plan?.selectedBuildListEntryIds ?? []
    const fixture = createPlannerOrchestrationBenchmarkInput(
      'orchestration_combined_multi_target',
    )
    fixture.fixedBuildListEntryIds.forEach((fixedId) => {
      expect(selected).toContain(fixedId)
    })
    expect(
      result.warnings.filter(
        ({ kind }) => kind === 'max_candidate_trials_per_conflict_reached',
      ).length,
    ).toBeGreaterThanOrEqual(1)
  }, 300_000)
})

describe('B8-E1 benchmark outcome normalization', () => {
  it('ignores run-dependent IDs, timestamps and ExpectedPlanState hashes', async () => {
    const workloadId = 'orchestration_single_conflict_early_adoption'
    const first = await runOrchestration(workloadId, TEST_ONLY_GENEROUS_BOUNDS)
    const second = await runOrchestration(workloadId, TEST_ONLY_GENEROUS_BOUNDS)
    const ownedIds = createPlannerOrchestrationBenchmarkInput(
      workloadId,
    ).input.ownedWeapons.map(({ id }) => id as string)

    // Production dependencies mint a new ProductionPlan ID, PlanStep IDs,
    // reserved OwnedWeapon IDs and timestamps on every run.
    expect(second.plan?.id).not.toBe(first.plan?.id)
    const firstOutcome = createPlannerOrchestrationOutcome(first, ownedIds)
    const secondOutcome = createPlannerOrchestrationOutcome(second, ownedIds)
    expect(secondOutcome.outcomeKey).toBe(firstOutcome.outcomeKey)
    expect(secondOutcome).toEqual(firstOutcome)
    expect(JSON.stringify(firstOutcome)).not.toContain(first.plan?.id ?? 'plan')
  }, 180_000)

  it('detects a semantic difference', async () => {
    const generous = await runOrchestration(
      'orchestration_single_conflict_early_adoption',
      TEST_ONLY_GENEROUS_BOUNDS,
    )
    const truncated = await runOrchestration(
      'orchestration_single_conflict_early_adoption',
      testOnlyBounds({ maxCandidateTrialsPerConflict: 1 }),
    )
    const ownedIds = createPlannerOrchestrationBenchmarkInput(
      'orchestration_single_conflict_early_adoption',
    ).input.ownedWeapons.map(({ id }) => id as string)
    const generousOutcome = createPlannerOrchestrationOutcome(generous, ownedIds)
    const truncatedOutcome = createPlannerOrchestrationOutcome(truncated, ownedIds)
    expect(truncatedOutcome.outcomeKey).not.toBe(generousOutcome.outcomeKey)
    expect(truncatedOutcome.generatedBuildListEntryIds).toEqual([])
    expect(truncatedOutcome.warningKinds).toContain(
      'max_candidate_trials_per_conflict_reached',
    )
  }, 180_000)

  it('replaces runtime-created OwnedWeapon IDs but keeps input-owned ones', async () => {
    const workloadId = 'orchestration_single_conflict_early_adoption'
    const result = await runOrchestration(workloadId, TEST_ONLY_GENEROUS_BOUNDS)
    const input = createPlannerOrchestrationBenchmarkInput(workloadId).input
    const ownedIds = input.ownedWeapons.map(({ id }) => id as string)
    const outcome = createPlannerOrchestrationOutcome(result, ownedIds)
    const normalized = outcome.steps
      .map(({ ownedWeaponId }) => ownedWeaponId)
      .filter((id): id is string => id !== null)
    expect(normalized.length).toBeGreaterThan(0)
    normalized.forEach((id) => {
      expect(ownedIds.includes(id) || id === '<runtime-owned-weapon>').toBe(true)
    })
    // The conversion Route reserves a brand new Gogma weapon.
    expect(normalized).toContain('<runtime-owned-weapon>')
  }, 180_000)
})
