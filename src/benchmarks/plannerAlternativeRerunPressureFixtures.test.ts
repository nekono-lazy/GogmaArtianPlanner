import { beforeAll, describe, expect, it } from 'vitest'
import {
  createProductionPlannerDependencies,
  runPlannerAlternativeKernel,
  type PlannerAlternativeKernelResult,
  type PlannerAlternativeTrialBounds,
} from '../domain/planner'
import { CURRENT_CALCULATION_APP_SCHEMA_VERSION } from '../domain/models/publicTypes'
import type { RouteOperation } from '../domain/models/publicTypes'
import {
  PRODUCTION_RNG_ENGINE_VERSION,
  ProductionRngEngine,
} from '../domain/rng/production/productionRngEngine'
import { satisfiesIdealTarget } from '../domain/target'
import {
  BENCHMARK_ONLY_RERUN_PRESSURE_CANDIDATE_TRIALS,
  BENCHMARK_ONLY_RERUN_PRESSURE_SANITY_EXTENT,
  createPlannerAlternativeRerunPressureFixture,
  createPlannerAlternativeRerunPressureKernelRequest,
  type PlannerAlternativeRerunPressureFixture,
} from './plannerAlternativeRerunPressureFixtures'

/*
 * The synthetic rerun-pressure workload under the unmodified Production Kernel
 * (Production Search, materializer, preflight, full Planner run, Trace
 * Replay). Only semantic outcomes are asserted, never a duration.
 */

const SLOW = 120_000

function positions(operations: readonly RouteOperation[]) {
  return operations.map((operation) => {
    switch (operation.type) {
      case 'convert_normal_to_gogma':
      case 'reset_skills':
        return `${operation.type}@${operation.skillCounterBefore}`
      case 'reset_bonuses':
      case 'keep_bonuses':
        return `${operation.type}@${operation.gogmaCounterBefore}`
      default:
        return operation.type
    }
  })
}

function completed(result: PlannerAlternativeKernelResult) {
  if (result.status !== 'completed') throw new Error(`kernel failed: ${JSON.stringify(result)}`)
  return result
}

describe('Planner Alternative rerun-pressure fixture', () => {
  let fixture: PlannerAlternativeRerunPressureFixture
  const run = (bounds: PlannerAlternativeTrialBounds) => runPlannerAlternativeKernel(
    createPlannerAlternativeRerunPressureKernelRequest(fixture, BENCHMARK_ONLY_RERUN_PRESSURE_SANITY_EXTENT, bounds),
    createProductionPlannerDependencies(new ProductionRngEngine()),
  )
  const outcomes = (result: PlannerAlternativeKernelResult) =>
    Object.fromEntries(completed(result).targets.map(({ targetWeaponId, outcome }) => [targetWeaponId, outcome.status]))

  beforeAll(async () => {
    fixture = await createPlannerAlternativeRerunPressureFixture()
  }, SLOW)

  it('builds A / B / C from the unmodified Candidate Search, sharing one Skill 341 conflict', () => {
    const [a, b, c] = fixture.candidates
    expect(a.route.kind).toBe('existing_gogma_mixed')
    expect(positions(a.route.operations).sort()).toEqual(['reset_bonuses@55', 'reset_skills@341'])
    for (const candidate of [b, c]) {
      expect(candidate.route.kind).toBe('owned_normal_artian_to_gogma')
      expect(positions(candidate.route.operations)).toEqual(['convert_normal_to_gogma@341', 'reset_bonuses@55', 'reset_bonuses@56'])
    }
    fixture.candidates.forEach((candidate, index) => {
      expect(satisfiesIdealTarget(
        fixture.plannerInput.targetWeapons[index], candidate.finalBonuses, candidate.restorationBonusScope,
        candidate.seriesSkillId, candidate.groupSkillId, fixture.plannerInput.master,
      )).toBe(true)
    })
    const skill = fixture.initialConflicts.filter(({ kind }) => kind === 'same_skill_counter')
    expect(skill).toHaveLength(1)
    expect([...skill[0].buildListEntryIds].sort())
      .toEqual([fixture.fixedEntry.id, ...fixture.nonFixedEntries.map(({ id }) => id)].sort())
    // A's Dragon Gogma is no source for the Fire Targets.
    expect(fixture.initialConflicts.some(({ kind, buildListEntryIds }) =>
      kind === 'same_owned_weapon_consumed' && buildListEntryIds.includes(fixture.fixedEntry.id))).toBe(false)
  })

  it('builds the decision from the real Skill conflict and A\'s real Entry, with caller extent and bounds', () => {
    const bounds = { maxCandidateTrialsPerTarget: BENCHMARK_ONLY_RERUN_PRESSURE_CANDIDATE_TRIALS, maxPlannerReruns: 2 }
    const request = createPlannerAlternativeRerunPressureKernelRequest(fixture, BENCHMARK_ONLY_RERUN_PRESSURE_SANITY_EXTENT, bounds)
    const conflict = fixture.initialConflicts.find(({ kind }) => kind === 'same_skill_counter')!
    expect(request.decision).toEqual({ conflictKey: conflict.id, selectedBuildListEntryId: fixture.fixedEntry.id })
    expect(request.extent).toEqual(BENCHMARK_ONLY_RERUN_PRESSURE_SANITY_EXTENT)
    expect(request.bounds).toEqual(bounds)
    expect(request.priorFixedBuildListEntryIds).toEqual([])
    expect(request.priorExcludedRoutes).toEqual([])
    expect(request.plannerInput).not.toBe(fixture.plannerInput)
    expect(() => createPlannerAlternativeRerunPressureKernelRequest(fixture, BENCHMARK_ONLY_RERUN_PRESSURE_SANITY_EXTENT, { ...bounds, maxPlannerReruns: 0 })).toThrow()
    expect(() => createPlannerAlternativeRerunPressureKernelRequest(fixture, { ...BENCHMARK_ONLY_RERUN_PRESSURE_SANITY_EXTENT, maxGogmaAdvance: 0 }, bounds)).toThrow(RangeError)
  })

  it('R = 1: B is found, C stops on the shared planner rerun bound', async () => {
    const result = completed(await run({ maxCandidateTrialsPerTarget: BENCHMARK_ONLY_RERUN_PRESSURE_CANDIDATE_TRIALS, maxPlannerReruns: 1 }))
    const [b, c] = fixture.nonFixedEntries.map(({ targetWeaponId }) => targetWeaponId)
    expect(outcomes(result)).toEqual({ [b]: 'found', [c]: 'stopped_by_planner_rerun_bound' })
    expect(result.plannerRerunsUsed).toBe(1)
    const stopped = result.targets.find(({ targetWeaponId }) => targetWeaponId === c)!
    expect(stopped.search).toBeNull()
    expect(stopped.trials).toEqual([])
    // The Kernel's own stable work order evaluated B first.
    expect(result.targets.map(({ targetWeaponId }) => targetWeaponId)).toEqual([b, c])
  }, SLOW)

  it.each([2, 16])('R = %i: B and C are both found with two full Planner runs', async (maxPlannerReruns) => {
    const result = completed(await run({ maxCandidateTrialsPerTarget: BENCHMARK_ONLY_RERUN_PRESSURE_CANDIDATE_TRIALS, maxPlannerReruns }))
    const [b, c] = fixture.nonFixedEntries.map(({ targetWeaponId }) => targetWeaponId)
    expect(outcomes(result)).toEqual({ [b]: 'found', [c]: 'found' })
    expect(result.plannerRerunsUsed).toBe(2)
    for (const target of result.targets) {
      expect(target.trials).toHaveLength(1)
      expect(target.reservation).not.toBeNull()
      if (target.outcome.status !== 'found') throw new Error('expected found')
      expect(positions(target.outcome.candidate.route.operations)).toEqual(['convert_normal_to_gogma@342', 'reset_bonuses@56'])
      expect(target.outcome.generatedSelected).toBe(true)
    }
  }, SLOW)

  it('moves no version authority', () => {
    expect(CURRENT_CALCULATION_APP_SCHEMA_VERSION).toBe(16)
    expect(PRODUCTION_RNG_ENGINE_VERSION).toBe('production-rng:c5-e7')
  })
})
