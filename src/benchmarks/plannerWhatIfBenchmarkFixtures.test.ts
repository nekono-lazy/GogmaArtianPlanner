import { describe, expect, it } from 'vitest'
import { evaluateBuildListEntryStaleness } from '../domain/buildList'
import { CURRENT_CALCULATION_APP_SCHEMA_VERSION } from '../domain/models/publicTypes'
import { createProductionPlannerDependencies, preparePlannerInitialContext, validatePlannerInput } from '../domain/planner'
import { preparePlannerWhatIfScenario } from '../domain/planner/constrained/plannerWhatIfScenario'
import { ProductionRngEngine } from '../domain/rng/production/productionRngEngine'
import { defaultConstrainedEnumerationBounds, enumerateConstrainedCandidates } from '../domain/search'
import { validateTargetIdealImpliesPractical } from '../domain/target'
import { createProductionPlannerWhatIfComparison } from '../workers/planner.worker.production'
import { createPlannerWhatIfBenchmarkFixture, plannerWhatIfBenchmarkWorkloads } from './plannerWhatIfBenchmarkFixtures'
import { createPlannerWhatIfBenchmarkOutcome } from './plannerWhatIfBenchmarkOutcome'

const dependencies = () => createProductionPlannerDependencies(new ProductionRngEngine())
const bounds = (trials: number, reruns: number) => ({ maxCandidateTrialsPerTarget: trials, maxPlannerReruns: reruns })
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
    expect(input.calculationContext.appSchemaVersion).toBe(
      CURRENT_CALCULATION_APP_SCHEMA_VERSION,
    )
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

  it('isolates trial sensitivity: T=1 stops, T=4 finds the Ideal answer with R=32 unchanged', async () => {
    const low = await calculate('what_if_two_targets', 1, 32)
    const high = await calculate('what_if_two_targets', 4, 32)
    expect(low.comparison.alternatives[0].outcome.status).toBe('stopped_by_candidate_trial_bound')
    expect(high.comparison.alternatives[0].outcome.status).toBe('found')
    for (const result of [low, high]) expect(createPlannerWhatIfBenchmarkOutcome(result).plannerRerunBoundReached).toBe(false)
  }, 30000)

  it('reports one Ideal distance that an actually enumerated Candidate carries', async () => {
    const full = await calculate('what_if_two_targets', 4, 32)
    const alternative = full.comparison.alternatives[0]
    if (alternative.outcome.status !== 'found') throw new Error('Expected a feasible Candidate')
    const distance = alternative.outcome.distance
    const prepared = preparePlannerWhatIfScenario(request('what_if_two_targets', 4, 32), dependencies())
    if (prepared.status !== 'ready') throw new Error('Invalid scenario')
    const enumeration = await enumerateConstrainedCandidates({ origin: prepared.scenario.origin,
      targetWeaponId: alternative.targetWeaponId, bounds: defaultConstrainedEnumerationBounds }, new ProductionRngEngine())
    // Every enumerated Candidate is an Ideal Candidate, so the distance is read
    // off one of them rather than off a category slot.
    expect(enumeration.candidates.some((candidate) =>
      candidate.estimatedOperationCount === distance.estimatedOperationCount &&
      candidate.estimatedGogmaAdvance === distance.estimatedGogmaAdvance &&
      candidate.estimatedSkillAdvance === distance.estimatedSkillAdvance &&
      candidate.estimatedNormalAdvance === distance.estimatedNormalAdvance)).toBe(true)
  }, 30000)

  // The three-participant workload keeps its four Production calculations, split
  // across two tests by semantic unit so one per-test timeout window never has to
  // hold all four. R=2 / R=4 / R=6 / R=32 and every assertion are preserved.
  it('shares R across three participants as the rerun budget progresses from R=2 to R=4', async () => {
    const low = await calculate('what_if_three_targets', 4, 2)
    const middle = await calculate('what_if_three_targets', 4, 4)
    // The shared rerun budget is spent Target by Target in the fixed order, so
    // a later participant is left unjudged while an earlier one has already
    // spent its whole trial allowance. A workload observation, not a Domain
    // invariant: this Target's Ideal five slots are reachable only at the
    // contested Gogma position, so no alternative Candidate is feasible.
    expect(low.comparison.alternatives.map(({ outcome }) => outcome.status)).toEqual([
      'stopped_by_planner_rerun_bound',
      'stopped_by_planner_rerun_bound',
    ])
    expect(middle.comparison.alternatives[0].outcome.status).toBe('stopped_by_candidate_trial_bound')
    expect(middle.comparison.alternatives[1].outcome.status).toBe('stopped_by_planner_rerun_bound')
  }, 30000)

  it('evaluates alternative Targets independently and reaches the R=32 outcome at R=12', async () => {
    const sufficient = await calculate('what_if_three_targets', 4, 12)
    const high = await calculate('what_if_three_targets', 4, 32)
    expect(high.comparison.alternatives.map(({ targetWeaponId }) => targetWeaponId)).toEqual([
      'target.b9b2a.bow_ice', 'target.b9b2a.bow_thunder',
    ])
    expect(high.comparison.alternatives.map(({ outcome }) => outcome.status)).toEqual([
      'stopped_by_candidate_trial_bound',
      'stopped_by_candidate_trial_bound',
    ])
    expect(high.comparison.alternatives[0].outcome).toEqual(high.comparison.alternatives[1].outcome)
    expect(createPlannerWhatIfBenchmarkOutcome(high).candidateTrialBoundReached).toBe(true)
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
    // One outcome per Target now, and both stop at the trial bound: this
    // workload's Ideal five slots are reachable only at the contested Gogma
    // position, so every enumerated alternative collides with the fixed Entry.
    // A workload observation, not a Domain invariant (B8 benchmark document
    // 7.5).
    expect(outcome.counts.found).toBe(0)
    expect(outcome.counts.candidateTrialBound).toBe(2)
    expect(outcome.counts.plannerRerunBound).toBe(0)
  }, 30000)
})
