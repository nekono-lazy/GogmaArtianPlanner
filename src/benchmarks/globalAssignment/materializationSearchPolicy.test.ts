import { describe, expect, it } from 'vitest'
import { conversion, NONE, reset, resetSkills } from './coverageTestFixture'
import { materializeStructuralCandidate } from './materialize'
import { searchPolicyShapeOf } from './materializationShape'
import {
  capturingPort, ELEMENT_A, ELEMENT_B, materializationScenario, newNormalSource, ownedSource, scenarioConversionFallback, scenarioHeldCrossing, TARGET,
} from './materializationTestFixture'
import type { CandidateInspection, StructuralCandidateMaterialization, StructuralCandidateMaterializationResult, TargetMaterializationRecord } from './materializationTypes'
import { IDEAL_BONUSES, ownedGogma } from './testFixture'

/*
 * Issue #154 Global Assignment Phase D-0B (design 19.3 G1 / 10.3): the materialization's opt-in pre-Search classification of
 * a Search-policy shape (`not_executed(search_policy_shape)`) and its execution-only observer. Both leave the D-0A behaviour
 * unchanged when absent. Synthetic fixture and a deterministic table Engine; no real Export, no Planner run.
 */

function materialized(result: StructuralCandidateMaterializationResult): StructuralCandidateMaterialization {
  if (result.kind !== 'materialization') throw new Error(`${result.reason}: ${result.detail}`)
  return result
}

const WINDOW = { skill: 3, gogma: 5, normal: 2 }

/**
 * a = owned Gogma (Ideal Bonuses, non-Ideal Skills) Resetting Skills at 7; b = new Normal at 4 converting at 8 (already Ideal)
 * and Resetting Skills to 9 (also Ideal): a Search-policy shape. b's conversion needs Skill 7 held, so a is materialized first.
 */
async function scenarioPolicyAfterCoverer() {
  const scene = await materializationScenario({
    targets: ['a', 'b'],
    owned: [ownedGogma('owned.g1', { restorationBonuses: structuredClone(IDEAL_BONUSES) })],
    skillIdeal: { [ELEMENT_A]: [7], [ELEMENT_B]: [8, 9] },
    reset: { [ELEMENT_B]: { 11: IDEAL_BONUSES } },
    window: WINDOW,
  })
  const candidate = scene.candidate([
    scene.option(TARGET.a, ownedSource('owned.g1'), resetSkills(7), NONE),
    scene.option(TARGET.b, newNormalSource(4), conversion(8, 9), reset(11)),
  ])
  return { scene, candidate }
}

describe('Phase D-0B Search-policy shape (design 19.3 G1)', () => {
  it('detects a conversion (c < s*) whose conversion Skill is already Ideal, from the ReachTable alone', async () => {
    const scene = await materializationScenario({ targets: ['b'], owned: [], skillIdeal: { [ELEMENT_B]: [7, 8, 9] }, reset: { [ELEMENT_B]: { 10: IDEAL_BONUSES } }, window: WINDOW })
    const shapeOf = (c: number, s: number) => searchPolicyShapeOf(scene.option(TARGET.b, newNormalSource(4), conversion(c, s), reset(10)), scene.table)
    expect(shapeOf(7, 9)).toEqual({ policy: 'lane_start_ideal_skill_continuation', stream: 'skill', conversionPosition: 7, finalPosition: 9 })
    expect(shapeOf(8, 9)).toEqual({ policy: 'lane_start_ideal_skill_continuation', stream: 'skill', conversionPosition: 8, finalPosition: 9 })
    // c = s*: the conversion Skill itself is the final Skill (the ordinary shape).
    expect(shapeOf(9, 9)).toBeNull()
    expect(shapeOf(7, 7)).toBeNull()
    const other = await materializationScenario({ targets: ['b'], owned: [], skillIdeal: { [ELEMENT_B]: [9] }, reset: { [ELEMENT_B]: { 10: IDEAL_BONUSES } }, window: WINDOW })
    // c < s* with a non-Ideal conversion Skill: Reset Skills is searched as usual, so this is not a policy shape.
    expect(searchPolicyShapeOf(other.option(TARGET.b, newNormalSource(4), conversion(7, 9), reset(10)), other.table)).toBeNull()
    // An owned Gogma's Reset Skills is never one (the current Phase A gives an Ideal current Skill `none` only).
    const owned = await materializationScenario({ targets: ['a'], owned: [ownedGogma('owned.g1', { restorationBonuses: structuredClone(IDEAL_BONUSES) })], skillIdeal: { [ELEMENT_A]: [7, 8] }, window: WINDOW })
    expect(searchPolicyShapeOf(owned.option(TARGET.a, ownedSource('owned.g1'), resetSkills(8), NONE), owned.table)).toBeNull()
  }, 30_000)

  it('classifies the shape before any Search, keeps the Targets materialized before it, and leaves the later Targets unattempted', async () => {
    const { scene, candidate } = await scenarioPolicyAfterCoverer()
    expect(candidate.materializationOrder).toEqual([TARGET.a, TARGET.b])
    const spy = capturingPort()
    const run = materialized(await materializeStructuralCandidate(candidate, { ...scene.inputs({ search: spy.port }), searchPolicyPrecheck: true }))
    expect(run.targets[0]!.outcome.kind).toBe('materialized')
    expect(run.materializedEntries.map(entry => entry.targetWeaponId)).toEqual([TARGET.a])
    const policy = { kind: 'not_executed', reason: 'search_policy_shape', policyShape: { policy: 'lane_start_ideal_skill_continuation', stream: 'skill', conversionPosition: 8, finalPosition: 9 } }
    expect(run.targets[1]).toEqual({ targetWeaponId: TARGET.b, orderIndex: 1, selection: null, attempts: [], outcome: policy })
    expect(run.outcome).toEqual({ kind: 'materialization_unconfirmed', targetWeaponId: TARGET.b, outcome: policy })
    // No Search API ran for b: only a's Searches reached the port.
    expect([...spy.alternativeInputs, ...spy.searchInputs].map(input => input.targetWeaponId).every(id => id === TARGET.a)).toBe(true)
    expect(spy.alternativeInputs.length + spy.searchInputs.length).toBeGreaterThan(0)
  }, 30_000)

  it('keeps the D-0A behaviour without the opt-in: the shape is searched and never reported as a policy shape', async () => {
    const { scene, candidate } = await scenarioPolicyAfterCoverer()
    const absent = materialized(await materializeStructuralCandidate(candidate, scene.inputs()))
    const disabled = materialized(await materializeStructuralCandidate(candidate, { ...scene.inputs(), searchPolicyPrecheck: false }))
    expect(disabled).toEqual(absent)
    const b = absent.targets.find(record => record.targetWeaponId === TARGET.b)!
    expect(b.attempts.length).toBeGreaterThan(0)
    expect(b.outcome.kind === 'not_executed' && b.outcome.reason === 'search_policy_shape').toBe(false)
    // A candidate without a policy shape is unchanged by the opt-in.
    const ordinary = await scenarioConversionFallback()
    expect(materialized(await materializeStructuralCandidate(ordinary.candidate, { ...ordinary.scene.inputs(), searchPolicyPrecheck: true })))
      .toEqual(materialized(await materializeStructuralCandidate(ordinary.candidate, ordinary.scene.inputs())))
  }, 60_000)
})

describe('Phase D-0B materialization observer', () => {
  it('changes no result and reports every Target start, inspected Candidate and settled record in order', async () => {
    const { scene, candidate } = await scenarioHeldCrossing()
    const plain = materialized(await materializeStructuralCandidate(candidate, scene.inputs()))
    const started: { targetWeaponId: string; orderIndex: number }[] = []
    const inspections: CandidateInspection[] = []
    const settled: TargetMaterializationRecord[] = []
    const observed = materialized(await materializeStructuralCandidate(candidate, {
      ...scene.inputs(),
      observer: {
        onTargetStarted: event => started.push(event),
        onCandidateInspected: inspection => inspections.push(inspection),
        onTargetSettled: record => settled.push(record),
      },
    }))
    expect(observed).toEqual(plain)
    expect(started).toEqual([{ targetWeaponId: TARGET.a, orderIndex: 0 }, { targetWeaponId: TARGET.c, orderIndex: 1 }])
    expect(settled).toEqual(plain.targets)
    // One inspection per projected canonical Ideal and per delivered Planner Alternative Candidate.
    let expected = 0
    for (const record of plain.targets) for (const attempt of record.attempts) {
      if (attempt.method === 'candidate_search_projected') expected += attempt.observed?.candidateFound ? 1 : 0
      else expected += attempt.observed?.deliveredCandidates ?? 0
    }
    expect(inspections).toHaveLength(expected)
    expect(inspections.filter(inspection => inspection.match.matches).map(inspection => inspection.targetWeaponId)).toEqual([TARGET.a, TARGET.c])
    // The observer receives copies: editing one changes nothing the run returns.
    settled[0]!.outcome = { kind: 'unmeasured', reason: 'cancelled' }
    expect(observed.targets[0]!.outcome.kind).toBe('materialized')
  }, 30_000)
})
