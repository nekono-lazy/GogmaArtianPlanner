import { beforeAll, describe, expect, it, vi } from 'vitest'
import { CURRENT_CALCULATION_APP_SCHEMA_VERSION } from '../domain/models/publicTypes'
import type { RouteOperation, TargetWeapon } from '../domain/models/publicTypes'
import { derivePlannerAlternativeReservation } from '../domain/planner'
import {
  PRODUCTION_RNG_ENGINE_VERSION,
  ProductionRngEngine,
} from '../domain/rng/production/productionRngEngine'
import type { RngEngine } from '../domain/rng/rngEngine'
import {
  candidateStableKey,
  visitPlannerAlternativeCandidates,
  type PlannerAlternativeCandidate,
  type PlannerAlternativeSearchInput,
} from '../domain/search'
import { satisfiesIdealTarget } from '../domain/target'
import {
  ISSUE_101_GOGMA_COUNTER,
  ISSUE_101_SKILL_COUNTER,
} from './issue101ConstrainedResearchFixtures'
import { summarizeIssue101Route } from './issue101RouteSummary'
import { createCountingRngEngine, createPlannerAlternativeSearchObserver } from './plannerAlternativeBenchmarkInstrumentation'
import {
  assertPlannerAlternativeBenchmarkExtent,
  assertPlannerAlternativeBenchmarkTrialBounds,
  BENCHMARK_ONLY_CANDIDATE_TRIAL_GRID,
  BENCHMARK_ONLY_EXTENT_GRID,
  BENCHMARK_ONLY_HELD_LENGTH_GRID,
  BENCHMARK_ONLY_ISSUE_101_SANITY_EXTENT,
  BENCHMARK_ONLY_ISSUE_101_SANITY_TRIAL_BOUNDS,
  BENCHMARK_ONLY_LONG_HELD_FIXED_EXTENT,
  BENCHMARK_ONLY_LONG_HELD_GOGMA_IDEAL_POSITION,
  BENCHMARK_ONLY_LONG_HELD_IDEAL_OFFSET,
  BENCHMARK_ONLY_LONG_HELD_SKILL_IDEAL_POSITION,
  BENCHMARK_ONLY_PLANNER_RERUN_GRID,
  createIssue101DragonFixedSearchInput,
  createIssue101DragonReservation,
  createIssue101KernelRequest,
  createIssue101NoIdealSearchInput,
  createIssue101RealFixture,
  createLongHeldFixture,
  createPlannerAlternativeSearchWorkloadInput,
  type Issue101RealFixture,
  type LongHeldMode,
  type LongHeldWorkloadId,
} from './plannerAlternativeBenchmarkFixtures'

/*
 * Planner Alternative Phase 3-A fixture semantics. Only semantic outcomes are
 * asserted - never a duration: performance is Phase 3-B's real Browser Worker
 * measurement, not a Vitest threshold.
 */

const SLOW = 120_000

/** The Phase 2 regression of the Issue #101 Fire alternative (production-rng:c5-e7). */
const PHASE_2_FIRE_ALTERNATIVE = {
  kind: 'normal_artian_to_gogma',
  operationCount: 236,
  normalForgeCount: 1,
  normalCounterBefore: 0,
  conversionSkillCounter: 342,
  resetBonusesCount: 234,
  keepBonusesCount: 0,
  resetSkillsCount: 0,
  firstGogmaCounter: 56,
  lastGogmaCounter: 289,
  estimatedGogmaAdvance: 235,
  estimatedSkillAdvance: 2,
  estimatedNormalAdvance: 1,
}

async function collect(
  input: PlannerAlternativeSearchInput,
  stopAfter: number | null,
  engine: RngEngine = new ProductionRngEngine(),
) {
  const candidates: PlannerAlternativeCandidate[] = []
  const execution = await visitPlannerAlternativeCandidates(input, engine, (candidate) => {
    candidates.push(candidate)
    return stopAfter !== null && candidates.length >= stopAfter ? 'stop' : 'continue'
  })
  return { candidates, execution }
}

function positions(operations: readonly RouteOperation[], stream: 'skill' | 'gogma'): number[] {
  return operations.flatMap((operation) => {
    if (stream === 'skill' && (operation.type === 'convert_normal_to_gogma' || operation.type === 'reset_skills')) {
      return [operation.skillCounterBefore]
    }
    if (stream === 'gogma' && (operation.type === 'reset_bonuses' || operation.type === 'keep_bonuses')) {
      return [operation.gogmaCounterBefore]
    }
    return []
  })
}

describe('Planner Alternative benchmark-only grids', () => {
  it('keeps the Issue #101 Gogma threshold 235 and states no Production default', () => {
    expect(BENCHMARK_ONLY_EXTENT_GRID.gogma).toContain(235)
    expect(BENCHMARK_ONLY_EXTENT_GRID.normal).toEqual([1, 4, 16, 40, 80])
    expect(BENCHMARK_ONLY_EXTENT_GRID.skill).toEqual([1, 2, 4, 8, 16, 32, 64])
    expect(BENCHMARK_ONLY_CANDIDATE_TRIAL_GRID).toEqual([1, 2, 3, 4, 8])
    expect(BENCHMARK_ONLY_PLANNER_RERUN_GRID).toEqual([1, 2, 3, 4, 8, 16])
    expect(BENCHMARK_ONLY_HELD_LENGTH_GRID).toEqual([1, 8, 32, 128, 512])
  })

  it('fails closed on a missing, partial or invalid extent / bound instead of completing it', () => {
    expect(() => assertPlannerAlternativeBenchmarkExtent({ maxNormalAdvance: 1, maxGogmaAdvance: 0, maxSkillAdvance: 1 })).toThrow(RangeError)
    expect(() => assertPlannerAlternativeBenchmarkExtent({ maxNormalAdvance: 1, maxGogmaAdvance: 30 } as never)).toThrow(RangeError)
    expect(() => assertPlannerAlternativeBenchmarkExtent(undefined as never)).toThrow(RangeError)
    expect(() => assertPlannerAlternativeBenchmarkExtent({ maxNormalAdvance: 1.5, maxGogmaAdvance: 30, maxSkillAdvance: 1 })).toThrow(RangeError)
    expect(() => assertPlannerAlternativeBenchmarkTrialBounds({ maxCandidateTrialsPerTarget: 0, maxPlannerReruns: 3 })).toThrow()
    expect(() => assertPlannerAlternativeBenchmarkTrialBounds({ maxCandidateTrialsPerTarget: 3 } as never)).toThrow()
    expect(() => createIssue101NoIdealSearchInput({ maxNormalAdvance: 1, maxGogmaAdvance: -1, maxSkillAdvance: 1 })).toThrow(RangeError)
  })
})

describe('Issue #101 real fixture under Planner Alternative Search', () => {
  let fixture: Issue101RealFixture

  beforeAll(async () => {
    fixture = await createIssue101RealFixture()
  }, SLOW)

  it('derives the Dragon-fixed reservation with the Planner authority', () => {
    expect(createIssue101DragonReservation(fixture)).toEqual({
      normal: [{
        counterId: 'weapon.charge_blade:8',
        held: Array.from({ length: 207 }, (_, index) => index),
        blocked: [206],
      }],
      skill: { held: [ISSUE_101_SKILL_COUNTER], blocked: [ISSUE_101_SKILL_COUNTER] },
      gogma: { held: [ISSUE_101_GOGMA_COUNTER], blocked: [ISSUE_101_GOGMA_COUNTER] },
      exclusiveOwnedWeaponIds: [],
    })
    expect(createIssue101DragonReservation(fixture))
      .toEqual(derivePlannerAlternativeReservation([fixture.dragonEntry], new ProductionRngEngine()))
  })

  it('builds a neutral Search input: Fire Target, Dragon reservation, the Fire current Route excluded, no Conflict DTO', () => {
    const input = createIssue101DragonFixedSearchInput(fixture, BENCHMARK_ONLY_ISSUE_101_SANITY_EXTENT)
    expect(Object.keys(input).sort()).toEqual(['excludedRouteKeys', 'extent', 'origin', 'reservation', 'targetWeaponId'])
    expect(input.targetWeaponId).toBe(fixture.fireEntry.targetWeaponId)
    expect(input.excludedRouteKeys).toEqual([candidateStableKey(fixture.fireEntry.candidateSnapshot)])
    expect(input.extent).toEqual(BENCHMARK_ONLY_ISSUE_101_SANITY_EXTENT)
    expect(JSON.stringify(input)).not.toContain(fixture.initialConflicts[0].id)
    // A fresh clone every time: mutating one input never reaches the cached fixture.
    input.origin.rngState.skillCounter.value = 0
    expect(fixture.plannerInput.rngState.skillCounter.value).toBe(ISSUE_101_SKILL_COUNTER)
  })

  it('delivers the Phase 2 Fire alternative first: Normal 0 once, Skill 342, Gogma 56..289, 236 operations', async () => {
    const input = createIssue101DragonFixedSearchInput(fixture, BENCHMARK_ONLY_ISSUE_101_SANITY_EXTENT)
    const { candidates, execution } = await collect(input, 1)
    const [first] = candidates
    expect(summarizeIssue101Route(first.route, first)).toEqual(PHASE_2_FIRE_ALTERNATIVE)
    expect(first.route.operations.find(({ type }) => type === 'create_normal_artian'))
      .toMatchObject({ normalCounterBefore: 0, normalCounterAfter: 1, count: 1 })
    expect(positions(first.route.operations, 'skill')).toEqual([ISSUE_101_SKILL_COUNTER + 1])
    expect(positions(first.route.operations, 'gogma')).not.toContain(ISSUE_101_GOGMA_COUNTER)
    expect(satisfiesIdealTarget(
      fixture.plannerInput.targetWeapons.find(({ id }) => id === input.targetWeaponId)!,
      first.finalBonuses, first.restorationBonusScope, first.seriesSkillId, first.groupSkillId,
      fixture.plannerInput.master,
    )).toBe(true)
    expect(execution.stoppedByConsumer).toBe(true)
  }, SLOW)

  it('builds the Kernel decision from the real initial Normal conflict ID', () => {
    const request = createIssue101KernelRequest(
      fixture, BENCHMARK_ONLY_ISSUE_101_SANITY_EXTENT, BENCHMARK_ONLY_ISSUE_101_SANITY_TRIAL_BOUNDS,
    )
    const normal = fixture.initialConflicts.find(({ kind }) => kind === 'same_normal_counter')!
    expect(request.decision).toEqual({ conflictKey: normal.id, selectedBuildListEntryId: fixture.dragonEntry.id })
    expect(request.priorFixedBuildListEntryIds).toEqual([])
    expect(request.priorExcludedRoutes).toEqual([])
    expect(request.plannerInput.conflictResolutions).toEqual([])
    expect(request.plannerInput).not.toBe(fixture.plannerInput)
    expect(() => createIssue101KernelRequest(fixture, BENCHMARK_ONLY_ISSUE_101_SANITY_EXTENT, { maxCandidateTrialsPerTarget: 3, maxPlannerReruns: 0 })).toThrow()
  })
})

describe('no-Ideal worst case', () => {
  it('traverses the extent to its end without a Candidate or a consumer stop', async () => {
    const counting = createCountingRngEngine(new ProductionRngEngine())
    const { candidates, execution } = await collect(
      createIssue101NoIdealSearchInput({ maxNormalAdvance: 1, maxGogmaAdvance: 30, maxSkillAdvance: 2 }),
      null,
      counting.engine,
    )
    expect(candidates).toEqual([])
    expect(execution.stoppedByConsumer).toBe(false)
    expect(execution.summary.stoppedByExtent || execution.summary.exhausted).toBe(true)
    expect(execution.summary.stoppedByExtent).toBe(true)
    // Not a "fast because empty" fixture: the whole Gogma window is predicted.
    expect(counting.counts().resetBonuses).toBe(30)
    expect(counting.counts().keepBonuses).toBeGreaterThan(30)
  })

  it('can run under the Dragon-fixed reservation too', async () => {
    const fixture = await createIssue101RealFixture()
    const input = createPlannerAlternativeSearchWorkloadInput(
      { workload: 'issue101_no_ideal_dragon_fixed', extent: { maxNormalAdvance: 1, maxGogmaAdvance: 5, maxSkillAdvance: 1 } },
      fixture,
    )
    expect(input.reservation).toEqual(createIssue101DragonReservation(fixture))
    const { candidates, execution } = await collect(input, null)
    expect(candidates).toEqual([])
    expect(execution.stoppedByConsumer).toBe(false)
  }, SLOW)
})

describe('synthetic long-held fixtures', () => {
  const workloads = ['long_skill_held', 'long_gogma_held'] as const
  const originOf = (workload: LongHeldWorkloadId) =>
    workload === 'long_skill_held' ? ISSUE_101_SKILL_COUNTER : ISSUE_101_GOGMA_COUNTER
  const measured = (workload: LongHeldWorkloadId) => (workload === 'long_skill_held' ? 'skill' : 'gogma')
  /** A short series so a test can run it to the end of its extent. */
  const shortSeries = (workload: LongHeldWorkloadId, offset: number) => ({
    series: { idealPosition: originOf(workload) + offset },
    extent: {
      maxNormalAdvance: 1,
      maxGogmaAdvance: workload === 'long_gogma_held' ? offset + 1 : 1,
      maxSkillAdvance: workload === 'long_skill_held' ? offset + 1 : 1,
    },
  })

  it('anchors every series Ideal at a fixed benchmark-only position and extent', () => {
    expect(BENCHMARK_ONLY_LONG_HELD_IDEAL_OFFSET).toBe(512)
    expect(BENCHMARK_ONLY_LONG_HELD_SKILL_IDEAL_POSITION).toBe(ISSUE_101_SKILL_COUNTER + 512)
    expect(BENCHMARK_ONLY_LONG_HELD_GOGMA_IDEAL_POSITION).toBe(ISSUE_101_GOGMA_COUNTER + 512)
    expect(BENCHMARK_ONLY_LONG_HELD_FIXED_EXTENT).toEqual({ maxNormalAdvance: 1, maxGogmaAdvance: 513, maxSkillAdvance: 513 })
    for (const heldLength of BENCHMARK_ONLY_HELD_LENGTH_GRID) {
      expect(heldLength).toBeLessThanOrEqual(BENCHMARK_ONLY_LONG_HELD_IDEAL_OFFSET)
    }
  })

  it.each(workloads)('%s keeps Target, Ideal, OwnedWeapon, RNG origin, Counters and context fixed across held lengths', (workload) => {
    const short = createLongHeldFixture(workload, { heldLength: 1, heldMode: 'held' }, BENCHMARK_ONLY_LONG_HELD_FIXED_EXTENT)
    const long = createLongHeldFixture(workload, { heldLength: 512, heldMode: 'held' }, BENCHMARK_ONLY_LONG_HELD_FIXED_EXTENT)
    const [shortTarget] = short.input.origin.targetWeapons
    const [longTarget] = long.input.origin.targetWeapons
    const semanticTarget = (target: TargetWeapon) => ({
      id: target.id,
      weaponTypeId: target.weaponTypeId,
      elementId: target.elementId,
      idealBonuses: target.idealBonuses,
      idealSkillCondition: target.idealSkillCondition,
      practicalBonusConditions: target.practicalBonusConditions,
      alternativeBonusRules: target.alternativeBonusRules,
      practicalSkillCondition: target.practicalSkillCondition,
      preferredOwnedWeaponId: target.preferredOwnedWeaponId,
      priority: target.priority,
      isEnabled: target.isEnabled,
      lifecycleStatus: target.lifecycleStatus,
    })
    expect(semanticTarget(longTarget)).toEqual(semanticTarget(shortTarget))
    expect(long.input.origin.ownedWeapons).toEqual(short.input.origin.ownedWeapons)
    expect(long.input.origin.rngState).toEqual(short.input.origin.rngState)
    expect(long.input.origin.normalCounters).toEqual(short.input.origin.normalCounters)
    expect(long.input.origin.calculationContext).toEqual(short.input.origin.calculationContext)
    expect(long.input.extent).toEqual(short.input.extent)
    expect(long.input.excludedRouteKeys).toEqual(short.input.excludedRouteKeys)
    expect(long.idealPosition).toBe(short.idealPosition)
    // Everything but the measured stream's reservation is identical, display name included.
    const other = workload === 'long_skill_held' ? 'gogma' : 'skill'
    const { reservation: shortReservation, ...shortRest } = short.input
    const { reservation: longReservation, ...longRest } = long.input
    expect(longRest).toEqual(shortRest)
    expect(longReservation.normal).toEqual(shortReservation.normal)
    expect(longReservation[other]).toEqual(shortReservation[other])
    expect(longReservation.exclusiveOwnedWeaponIds).toEqual(shortReservation.exclusiveOwnedWeaponIds)
    const origin = originOf(workload)
    expect(shortReservation[measured(workload)]).toEqual({ held: [origin], blocked: [] })
    expect(longReservation[measured(workload)].held).toEqual(Array.from({ length: 512 }, (_, index) => origin + index))
    // heldMode changes only the blocked set.
    const blocked = createLongHeldFixture(workload, { heldLength: 512, heldMode: 'held_blocked' }, BENCHMARK_ONLY_LONG_HELD_FIXED_EXTENT)
    expect(blocked.input.reservation[measured(workload)]).toEqual({ held: longReservation[measured(workload)].held, blocked: longReservation[measured(workload)].held })
    expect({ ...blocked.input, reservation: null }).toEqual({ ...long.input, reservation: null })
  })

  it('derives the fixed Ideal from the Production prediction at the anchor', () => {
    const engine = new ProductionRngEngine()
    const skill = createLongHeldFixture('long_skill_held', { heldLength: 8, heldMode: 'held' }, BENCHMARK_ONLY_LONG_HELD_FIXED_EXTENT)
    const { origin } = skill.input
    const target = origin.targetWeapons[0]
    const predicted = engine.predictSkills({
      baseSeed: origin.rngState.baseSeed.value as string, skillCounter: BENCHMARK_ONLY_LONG_HELD_SKILL_IDEAL_POSITION,
      weaponTypeId: target.weaponTypeId, elementId: target.elementId, master: origin.master,
    })
    expect(target.idealSkillCondition).toEqual({ ...predicted, matchMode: 'all' })
    const gogma = createLongHeldFixture('long_gogma_held', { heldLength: 8, heldMode: 'held' }, BENCHMARK_ONLY_LONG_HELD_FIXED_EXTENT)
    const gogmaTarget = gogma.input.origin.targetWeapons[0]
    expect(gogmaTarget.idealBonuses).toEqual(engine.predictGogmaBonus({
      baseSeed: gogma.input.origin.rngState.baseSeed.value as string, gogmaCounter: BENCHMARK_ONLY_LONG_HELD_GOGMA_IDEAL_POSITION,
      weaponTypeId: gogmaTarget.weaponTypeId, elementId: gogmaTarget.elementId, operation: { type: 'reset_bonuses' }, master: gogma.input.origin.master,
    }))
  })

  it.each([
    ['long_skill_held', 'held'], ['long_skill_held', 'held_blocked'],
    ['long_gogma_held', 'held'], ['long_gogma_held', 'held_blocked'],
  ] as const)('%s / %s delivers an Ideal Candidate on the fixed series extent', async (workload, heldMode) => {
    const fixture = createLongHeldFixture(workload, { heldLength: 8, heldMode }, BENCHMARK_ONLY_LONG_HELD_FIXED_EXTENT)
    const { candidates } = await collect(fixture.input, 1)
    expect(candidates).toHaveLength(1)
    const [candidate] = candidates
    expect(satisfiesIdealTarget(
      fixture.input.origin.targetWeapons[0], candidate.finalBonuses, candidate.restorationBonusScope,
      candidate.seriesSkillId, candidate.groupSkillId, fixture.input.origin.master,
    )).toBe(true)
    for (const position of positions(candidate.route.operations, measured(workload))) {
      expect(fixture.blockedPositions).not.toContain(position)
    }
  })

  it('predicts nothing at a held position it only skips', async () => {
    for (const workload of workloads) {
      const engine = new ProductionRngEngine()
      const predicted: number[] = []
      const skills = vi.spyOn(engine, 'predictSkills')
      const bonuses = vi.spyOn(engine, 'predictGogmaBonus')
      const fixture = createLongHeldFixture(workload, { heldLength: 128, heldMode: 'held_blocked' }, BENCHMARK_ONLY_LONG_HELD_FIXED_EXTENT)
      await collect(fixture.input, 1, engine)
      skills.mock.calls.forEach(([input]) => predicted.push(input.skillCounter))
      bonuses.mock.calls.forEach(([input]) => predicted.push(input.gogmaCounter))
      expect(predicted.length).toBeGreaterThan(0)
      const firstFree = originOf(workload) + 128
      for (const position of predicted) expect(position).toBeGreaterThanOrEqual(firstFree)
    }
  })

  it('never places an own operation on a blocked position, even when searched to the end', async () => {
    for (const workload of workloads) {
      const { series, extent } = shortSeries(workload, 6)
      const fixture = createLongHeldFixture(workload, { heldLength: 4, heldMode: 'held_blocked' }, extent, series)
      const { candidates, execution } = await collect(fixture.input, null)
      expect(execution.stoppedByConsumer).toBe(false)
      for (const candidate of candidates) {
        for (const position of positions(candidate.route.operations, measured(workload))) {
          expect(fixture.blockedPositions).not.toContain(position)
        }
      }
    }
  })

  it('is deterministic for the same input', async () => {
    for (const heldMode of ['held', 'held_blocked'] as LongHeldMode[]) {
      const build = () => createLongHeldFixture('long_gogma_held', { heldLength: 8, heldMode }, BENCHMARK_ONLY_LONG_HELD_FIXED_EXTENT)
      expect(build().input).toEqual(build().input)
      const keys = async () => (await collect(build().input, 3)).candidates.map(candidateStableKey)
      expect(await keys()).toEqual(await keys())
    }
  })

  it.each(workloads)('%s: on one fixed series only the held length changes, and the instrumentation sees its effect', async (workload) => {
    const { series, extent } = shortSeries(workload, 16)
    const run = async (heldLength: number) => {
      const fixture = createLongHeldFixture(workload, { heldLength, heldMode: 'held' }, extent, series)
      const counting = createCountingRngEngine(new ProductionRngEngine())
      const observer = createPlannerAlternativeSearchObserver()
      const keys: string[] = []
      const execution = await visitPlannerAlternativeCandidates(fixture.input, counting.engine, (candidate) => {
        keys.push(candidateStableKey(candidate))
        return 'continue'
      }, { instrumentation: observer.instrumentation })
      return { fixture, keys, execution, counts: counting.counts(), observer }
    }
    const small = await run(2)
    const large = await run(12)
    // Same series: same Target / Ideal / weapon / origin / extent, different reservation length only.
    const { reservation: smallReservation, ...smallRest } = small.fixture.input
    const { reservation: largeReservation, ...largeRest } = large.fixture.input
    expect(largeRest).toEqual(smallRest)
    expect(smallReservation[measured(workload)].held).toHaveLength(2)
    expect(largeReservation[measured(workload)].held).toHaveLength(12)
    // Both run to the end of the same extent, so their termination is comparable.
    for (const { execution } of [small, large]) {
      expect(execution.stoppedByConsumer).toBe(false)
      expect(execution.summary.exhausted || execution.summary.stoppedByExtent).toBe(true)
    }
    // Every Candidate of both runs satisfies the same fixed Ideal; the sets may differ.
    expect(small.keys.length + large.keys.length).toBeGreaterThan(0)
    // Depth 1 publishes one state per legal position: the held run plus the first free one.
    if (workload === 'long_skill_held') {
      expect(small.observer.skill().depths[0]).toMatchObject({ depth: 1, states: 3 })
      expect(large.observer.skill().depths[0]).toMatchObject({ depth: 1, states: 13 })
      expect(large.observer.skill().totalStates).toBeGreaterThan(small.observer.skill().totalStates)
      expect(large.observer.skill().totalTransitions).toBeGreaterThan(small.observer.skill().totalTransitions)
    } else {
      expect(small.observer.gogma().depths[0]).toMatchObject({ depth: 1, absolutePositions: 3 })
      expect(large.observer.gogma().depths[0]).toMatchObject({ depth: 1, absolutePositions: 13 })
      expect(large.observer.gogma().totalGeneratedStates).toBeGreaterThan(small.observer.gogma().totalGeneratedStates)
    }
    expect(large.observer.settledWorkItems()).toBeGreaterThan(0)
    expect(small.observer.settledWorkItems()).toBeGreaterThan(0)
    // Predictions are memoized per position (Keep per position and layout), so
    // a held run adds states, not necessarily prediction calls; both are recorded.
    expect(large.counts.predictNormalArtian + small.counts.predictNormalArtian).toBe(0)
  })

  it('refuses long-held options on other workloads and requires them on long-held ones', () => {
    const extent = { maxNormalAdvance: 1, maxGogmaAdvance: 1, maxSkillAdvance: 1 }
    expect(() => createPlannerAlternativeSearchWorkloadInput({ workload: 'long_skill_held', extent }, null)).toThrow(RangeError)
    expect(() => createPlannerAlternativeSearchWorkloadInput({ workload: 'issue101_no_ideal', extent, longHeld: { heldLength: 1, heldMode: 'held' } }, null)).toThrow(RangeError)
    expect(() => createPlannerAlternativeSearchWorkloadInput({ workload: 'issue101_fire_dragon_fixed', extent }, null)).toThrow(/Issue #101 real fixture/)
    expect(() => createLongHeldFixture('long_skill_held', { heldLength: 0, heldMode: 'held' }, extent)).toThrow(RangeError)
    expect(() => createLongHeldFixture('long_skill_held', { heldLength: 1, heldMode: 'held' }, extent, { idealPosition: -1 })).toThrow(RangeError)
    // The workload entry point always uses the default series.
    const input = createPlannerAlternativeSearchWorkloadInput(
      { workload: 'long_skill_held', extent: BENCHMARK_ONLY_LONG_HELD_FIXED_EXTENT, longHeld: { heldLength: 32, heldMode: 'held' } }, null)
    expect(input).toEqual(createLongHeldFixture('long_skill_held', { heldLength: 32, heldMode: 'held' }, BENCHMARK_ONLY_LONG_HELD_FIXED_EXTENT).input)
  })

  it('moves no version authority', () => {
    expect(CURRENT_CALCULATION_APP_SCHEMA_VERSION).toBe(15)
    expect(PRODUCTION_RNG_ENGINE_VERSION).toBe('production-rng:c5-e7')
  })
})
