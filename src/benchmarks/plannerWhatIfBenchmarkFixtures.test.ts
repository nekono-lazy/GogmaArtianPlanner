import { describe, expect, it } from 'vitest'
import { evaluateBuildListEntryStaleness } from '../domain/buildList'
import { createProductionPlannerDependencies, preparePlannerInitialContext, validatePlannerInput } from '../domain/planner'
import { preparePlannerWhatIfScenario } from '../domain/planner/constrained/plannerWhatIfScenario'
import { ProductionRngEngine } from '../domain/rng/production/productionRngEngine'
import { defaultConstrainedEnumerationBounds, enumerateConstrainedCandidates } from '../domain/search'
import { validateTargetIdealImpliesPractical } from '../domain/target'
import { createProductionPlannerWhatIfComparison } from '../workers/planner.worker.production'
import { createPlannerWhatIfBenchmarkFixture, plannerWhatIfBenchmarkWorkloads } from './plannerWhatIfBenchmarkFixtures'
import { createPlannerWhatIfBenchmarkOutcome } from './plannerWhatIfBenchmarkOutcome'

const dependencies = () => createProductionPlannerDependencies(new ProductionRngEngine())
const bounds = (trials: number, reruns: number) => ({ maxCandidateTrialsPerCategoryPerTarget: trials, maxPlannerReruns: reruns })
function request(id: string, trials: number, reruns: number) {
  const fixture = createPlannerWhatIfBenchmarkFixture(id)
  return { plannerInput: fixture.plannerInput, scenarioResolution: fixture.scenarioResolution, bounds: bounds(trials, reruns) }
}
async function calculate(id: string, trials: number, reruns: number) {
  const result = await createProductionPlannerWhatIfComparison(request(id, trials, reruns), dependencies())
  expect(result.status).toBe('completed')
  if (result.status !== 'completed') throw new Error(`Fixture failed: ${result.status}`)
  return result
}

// Production calculations below check ONLY semantics. No elapsed time is read,
// no harness record is produced, and these are not Browser Worker measurements.
describe('B9 Production-valid benchmark fixtures', () => {
  it('rejects unknown workload and is deterministic structured-clone data', () => {
    expect(() => createPlannerWhatIfBenchmarkFixture('missing')).toThrow(RangeError)
    for (const workload of plannerWhatIfBenchmarkWorkloads) {
      const fixture = createPlannerWhatIfBenchmarkFixture(workload.id)
      expect(structuredClone(fixture)).toEqual(createPlannerWhatIfBenchmarkFixture(workload.id))
    }
  })

  it.each(plannerWhatIfBenchmarkWorkloads)('$id has valid non-stale entries, containment, real conflicts and fixed authority', (workload) => {
    const fixture = createPlannerWhatIfBenchmarkFixture(workload.id)
    const input = fixture.plannerInput
    expect(new ProductionRngEngine().version).toBe('production-rng:c5-e2')
    expect(input.calculationContext.rngEngineVersion).toBe('production-rng:c5-e2')
    expect(input.calculationContext.appSchemaVersion).toBe(2)
    const validation = validatePlannerInput(input, dependencies())
    expect(validation.isValid).toBe(true)
    expect(validation.issues).toEqual([])
    expect(validation.excludedBuildListEntries).toEqual([])
    expect(validation.validBuildListEntries).toHaveLength(input.buildListEntries.length)
    const initial = preparePlannerInitialContext({ ...input, conflictResolutions: [] }, dependencies())
    expect(initial.status).toBe('ready')
    if (initial.status !== 'ready') throw new Error('Invalid fixture')
    expect(initial.context.initialConflictDetection.conflicts).toEqual(fixture.initialConflicts)
    const conflict = fixture.initialConflicts.find(({ id }) => id === fixture.scenarioResolution.conflictKey)
    expect(conflict?.buildListEntryIds).toHaveLength(workload.participantCount)
    const orderedEntries = [...(conflict?.buildListEntryIds ?? [])].sort()
    expect(fixture.scenarioResolution.selectedBuildListEntryId).toBe(orderedEntries[0])
    const scenario = preparePlannerWhatIfScenario(request(workload.id, 2, 32), dependencies())
    expect(scenario.status).toBe('ready')
    if (scenario.status !== 'ready') throw new Error('Invalid scenario')
    const fixed = input.buildListEntries.find(({ id }) => id === fixture.scenarioResolution.selectedBuildListEntryId)
    expect(scenario.scenario.scenarioConstraint.fixedTargetWeaponId).toBe(fixed?.targetWeaponId)
    expect(scenario.scenario.works).toHaveLength(workload.participantCount - 1)
    expect(new Set(scenario.scenario.works.map(({ targetWeaponId }) => targetWeaponId)).size).toBe(workload.participantCount - 1)
    expect(scenario.scenario.fixedConstraints).toHaveLength(fixture.initialConflicts.length)
    for (const target of input.targetWeapons) {
      expect(validateTargetIdealImpliesPractical(target, input.master).isValid).toBe(true)
    }
    for (const entry of input.buildListEntries) {
      expect(evaluateBuildListEntryStaleness(entry, {
        target: input.targetWeapons.find(({ id }) => id === entry.targetWeaponId) ?? null,
        rngState: input.rngState, normalCounters: input.normalCounters,
        ownedWeapons: input.ownedWeapons, calculationContext: input.calculationContext,
      })).toEqual({ isStale: false, staleReasons: [] })
    }
    // The Ideal condition scan must actually land inside Production extent.
    for (const prediction of fixture.idealPredictionCounters) {
      const start = prediction.stream === 'gogma' ? input.rngState.gogmaCounter.value : input.rngState.skillCounter.value
      const extent = prediction.stream === 'gogma' ? defaultConstrainedEnumerationBounds.maxGogmaAdvance : defaultConstrainedEnumerationBounds.maxSkillResetCount
      expect(prediction.counter - (start ?? NaN)).toBeLessThan(extent)
    }
  })

  it('isolates trial sensitivity: T=1 stops, T=2 finds Practical with R=32 unchanged', async () => {
    const low = await calculate('what_if_two_targets', 1, 32)
    const high = await calculate('what_if_two_targets', 2, 32)
    expect(low.comparison.alternatives[0].practical.status).toBe('stopped_by_candidate_trial_bound')
    expect(high.comparison.alternatives[0].practical).toEqual({ status: 'found', distance: {
      estimatedOperationCount: 2, estimatedGogmaAdvance: 0, estimatedSkillAdvance: 1, estimatedNormalAdvance: 1,
    } })
    for (const result of [low, high]) expect(createPlannerWhatIfBenchmarkOutcome(result).plannerRerunBoundReached).toBe(false)
  }, 30000)

  it('finds exclusive Practical and Ideal at different distances, and proves practical-first scheduling', async () => {
    const low = await calculate('what_if_dual_category', 1, 32)
    const full = await calculate('what_if_dual_category', 2, 32)
    const limited = await calculate('what_if_dual_category', 2, 2)
    expect(low.comparison.alternatives[0].practical.status).toBe('stopped_by_candidate_trial_bound')
    expect(low.comparison.alternatives[0].ideal.status).toBe('found')
    const alternative = full.comparison.alternatives[0]
    expect(alternative.practical).toEqual({ status: 'found', distance: {
      estimatedOperationCount: 2, estimatedGogmaAdvance: 2, estimatedSkillAdvance: 0, estimatedNormalAdvance: null,
    } })
    expect(alternative.ideal).toEqual({ status: 'found', distance: {
      estimatedOperationCount: 1, estimatedGogmaAdvance: 1, estimatedSkillAdvance: 0, estimatedNormalAdvance: null,
    } })
    expect(limited.comparison.alternatives[0].practical).toEqual(alternative.practical)
    expect(limited.comparison.alternatives[0].ideal.status).toBe('stopped_by_planner_rerun_bound')
    const prepared = preparePlannerWhatIfScenario(request('what_if_dual_category', 2, 32), dependencies())
    if (prepared.status !== 'ready') throw new Error('Invalid scenario')
    const enumeration = await enumerateConstrainedCandidates({ origin: prepared.scenario.origin,
      targetWeaponId: alternative.targetWeaponId, bounds: defaultConstrainedEnumerationBounds }, new ProductionRngEngine())
    for (const category of ['practical', 'ideal'] as const) {
      const slot = alternative[category]
      if (slot.status !== 'found') throw new Error('Missing category')
      expect(enumeration.candidates.some((candidate) => candidate.category === category &&
        candidate.estimatedOperationCount === slot.distance.estimatedOperationCount &&
        candidate.estimatedGogmaAdvance === slot.distance.estimatedGogmaAdvance &&
        candidate.estimatedSkillAdvance === slot.distance.estimatedSkillAdvance &&
        candidate.estimatedNormalAdvance === slot.distance.estimatedNormalAdvance)).toBe(true)
    }
  }, 30000)

  it('shares R across three participants and evaluates alternative Targets independently', async () => {
    const low = await calculate('what_if_three_targets', 2, 2)
    const high = await calculate('what_if_three_targets', 2, 32)
    expect(high.comparison.alternatives.map(({ targetWeaponId }) => targetWeaponId)).toEqual([
      'target.b9b2a.bow_thunder', 'target.b9b2a.bow_water',
    ])
    expect(low.comparison.alternatives[0].practical.status).toBe('found')
    expect(low.comparison.alternatives[0].ideal.status).toBe('stopped_by_planner_rerun_bound')
    expect(low.comparison.alternatives[1].practical.status).toBe('stopped_by_planner_rerun_bound')
    expect(low.comparison.alternatives[1].ideal.status).toBe('stopped_by_planner_rerun_bound')
    expect(high.comparison.alternatives.map(({ practical }) => practical.status)).toEqual(['found', 'found'])
    expect(high.comparison.alternatives[0].practical).toEqual(high.comparison.alternatives[1].practical)
    expect(high.comparison.alternatives.map(({ ideal }) => ideal.status)).toEqual(['found', 'found'])
    expect(createPlannerWhatIfBenchmarkOutcome(high).candidateTrialBoundReached).toBe(false)
    const middle = await calculate('what_if_three_targets', 2, 4)
    const sufficient = await calculate('what_if_three_targets', 2, 6)
    expect(middle.comparison.alternatives[0].ideal.status).toBe('found')
    expect(middle.comparison.alternatives[1].practical.status).toBe('stopped_by_planner_rerun_bound')
    expect(createPlannerWhatIfBenchmarkOutcome(sufficient).outcomeKey).toBe(createPlannerWhatIfBenchmarkOutcome(high).outcomeKey)
    expect(createPlannerWhatIfBenchmarkOutcome(high).plannerRerunBoundReached).toBe(false)
  }, 30000)

  it('retains the other explicit resolution in the combined Production calculation', async () => {
    const input = request('what_if_combined', 2, 32)
    const before = structuredClone(input)
    expect(input.plannerInput.conflictResolutions).toHaveLength(2)
    const prepared = preparePlannerWhatIfScenario(input, dependencies())
    if (prepared.status !== 'ready') throw new Error('Invalid scenario')
    expect(prepared.scenario.fixedConstraints).toHaveLength(2)
    const result = await createProductionPlannerWhatIfComparison(input, dependencies())
    expect(result.status).toBe('completed')
    expect(input).toEqual(before)
    const outcome = createPlannerWhatIfBenchmarkOutcome(result)
    expect(outcome.counts.candidateTrialBound).toBe(4)
    expect(outcome.counts.plannerRerunBound).toBe(0)
  }, 30000)
})
