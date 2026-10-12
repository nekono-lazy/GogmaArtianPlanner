import { describe, expect, it } from 'vitest'
import { assignmentOf, conversion, keep, NONE, option as optionOf, reset, resetSkills, resetThenKeep } from './coverageTestFixture'
import type { StructuralCandidate } from './coverageTypes'
import { buildPlannerAlternativeRequest, materializeStructuralCandidate } from './materialize'
import {
  bonusFrontierRequestRisk, countContinuationOptions, diagnoseBonusFrontierRisk, diagnosePlannerStartIdeal, diagnoseSearchPolicyShapes, measureBonusFrontierCollapse, summarizeInspections,
} from './materializationDiagnostics'
import { ELEMENT_A, ELEMENT_B, materializationScenario, newNormalSource, ownedSource, REORDERED_GOGMA, TARGET } from './materializationTestFixture'
import type {
  CandidateInspection, PlannerAlternativeAttempt, ShapeMismatchReason, StructuralCandidateMaterialization, StructuralCandidateMaterializationResult,
} from './materializationTypes'
import { createReachOption } from './reachOptions'
import { buildReachTable } from './reachTable'
import { buildStructuralCandidate } from './structuralCandidate'
import { IDEAL_BONUSES, keepToLowRanks, ownedGogma } from './testFixture'
import type { BonusRequirement, GlobalAssignmentContext, ReachOption, SkillRequirement, SourceCandidate } from './types'
import type { OwnedWeapon, TargetWeaponId } from '../../domain/models/publicTypes'

/*
 * Issue #154 Global Assignment Phase D-0B (design 19, audit 3.3 / 3.6 / 9.1): the G1 / G3 / G4 diagnostics. G3 is checked
 * against the real Planner Alternative Search on a synthetic fixture (the audit's code-reading estimate), and every
 * diagnostic is checked to classify nothing as failed. No real Export, no Planner run.
 */

function materialized(result: StructuralCandidateMaterializationResult): StructuralCandidateMaterialization {
  if (result.kind !== 'materialization') throw new Error(`${result.reason}: ${result.detail}`)
  return result
}

const WINDOW = { skill: 3, gogma: 5, normal: 2 }
const SERIES_IDEAL = 'series_skill.fixture.a'
const OTHER_SERIES = 'series_skill.fixture.other'

/**
 * a = owned Gogma (Ideal Skills) whose current slots carry the Ideal families in another order (layout L) at low tiers;
 * Keep at Gogma 14 rerolls them to the Ideal, so `keep_from_source(14)` is an option. `resetAt12` = the Reset result at 12:
 * with layout L it is a same-layout Reset inside the Keep chain 10..13 (the G3 risk condition).
 */
async function keepChainScenario(resetAt12: 'same_layout' | 'other_layout') {
  const scene = await materializationScenario({
    targets: ['a'],
    owned: [ownedGogma('owned.g1', { seriesSkillId: SERIES_IDEAL, restorationBonuses: structuredClone(REORDERED_GOGMA) })],
    reset: resetAt12 === 'same_layout' ? { [ELEMENT_A]: { 12: REORDERED_GOGMA } } : {},
    keepIdeal: [14],
    window: WINDOW,
  })
  const candidate = scene.candidate([scene.option(TARGET.a, ownedSource('owned.g1'), NONE, keep(14))])
  return { scene, candidate }
}

describe('Phase D-0B G1 diagnostics and continuation counts', () => {
  it('lists every Search-policy shape in materialization order and counts it as the only continuation kind the current option set holds', async () => {
    const scene = await materializationScenario({
      targets: ['a', 'b'],
      owned: [ownedGogma('owned.g1', { restorationBonuses: structuredClone(IDEAL_BONUSES) })],
      skillIdeal: { [ELEMENT_A]: [7], [ELEMENT_B]: [8, 9] },
      reset: { [ELEMENT_B]: { 11: IDEAL_BONUSES } },
      window: WINDOW,
    })
    const policy = scene.candidate([
      scene.option(TARGET.a, ownedSource('owned.g1'), resetSkills(7), NONE),
      scene.option(TARGET.b, newNormalSource(4), conversion(8, 9), reset(11)),
    ])
    expect(diagnoseSearchPolicyShapes(policy, scene.table)).toEqual({
      shapes: [{ targetWeaponId: TARGET.b, orderIndex: 1, sourceKind: 'new_normal', policyShape: { policy: 'lane_start_ideal_skill_continuation', stream: 'skill', conversionPosition: 8, finalPosition: 9 } }],
      firstOrderIndex: 1,
    })
    expect(countContinuationOptions(policy, scene.table)).toEqual({ laneStartIdealSkillContinuation: 1, ownedGogmaContinuation: 'not_generated_by_current_phase_a' })
    const plain = scene.candidate([
      scene.option(TARGET.a, ownedSource('owned.g1'), resetSkills(7), NONE),
      scene.option(TARGET.b, newNormalSource(4), conversion(8, 8), reset(11)),
    ])
    expect(diagnoseSearchPolicyShapes(plain, scene.table)).toEqual({ shapes: [], firstOrderIndex: null })
    expect(countContinuationOptions(plain, scene.table).laneStartIdealSkillContinuation).toBe(0)
  }, 30_000)
})

describe('Phase D-0B G3 diagnostics (Bonus family-layout frontier)', () => {
  it('finds the same-layout Reset positions of a Keep chain statically, without a Search or a reservation', async () => {
    const risky = await keepChainScenario('same_layout')
    expect(diagnoseBonusFrontierRisk(risky.candidate, risky.scene.table)).toMatchObject({
      applicableOptions: 1, withStaticRisk: 1,
      targets: [{ targetWeaponId: TARGET.a, orderIndex: 0, option: 'keep_from_source', requiredGogma: [14], scanRange: { from: 10, to: 13 }, sameLayoutResetPositions: [12], otherTargetRequired: [] }],
    })
    const safe = await keepChainScenario('other_layout')
    expect(diagnoseBonusFrontierRisk(safe.candidate, safe.scene.table)).toMatchObject({ applicableOptions: 1, withStaticRisk: 0, targets: [{ sameLayoutResetPositions: [] }] })
    // reset_then_keep (12, 14): its chain is 13 only, so the Reset at 12 (its own required position) is not a risk position.
    const rtk = risky.scene.candidate([risky.scene.option(TARGET.a, ownedSource('owned.g1'), NONE, resetThenKeep(12, 14))])
    expect(diagnoseBonusFrontierRisk(rtk, risky.scene.table).targets[0]).toMatchObject({ option: 'reset_then_keep', requiredGogma: [12, 14], scanRange: { from: 13, to: 13 }, sameLayoutResetPositions: [] })
  }, 30_000)

  it('confirms the code-reading estimate on the real Planner Alternative Search: the Keep chain collapses into the latest same-layout Reset', async () => {
    // Expected shape: Keep from the source over 10..14, required {14}. With a same-layout Reset at 12 the held-aware Bonus
    // stream merges the Keep state and the Reset state of position 12 (same depth, position and layout) and keeps the Reset
    // one, so the Search returns the same final weapon with the required Gogma positions {12, 14} instead.
    const { scene, candidate } = await keepChainScenario('same_layout')
    const inspections: CandidateInspection[] = []
    const run = materialized(await materializeStructuralCandidate(candidate, { ...scene.inputs(), observer: { onCandidateInspected: value => inspections.push(value) } }))
    const record = run.targets[0]!
    // Both methods ran and saw the same final weapon at {12, 14}: the projected canonical Ideal mismatched, and the Planner Alternative
    // Search delivered that Route only and then stopped by its extent, so the Target is unconfirmed(stopped_by_extent), not a mismatch.
    expect(record.attempts.map(attempt => attempt.method)).toEqual(['candidate_search_projected', 'planner_alternative_reservation'])
    expect(record.outcome).toMatchObject({ kind: 'unconfirmed', reason: 'stopped_by_extent', closestMismatch: { reasons: ['gogma_required'], plannerRequired: { gogma: [12, 14] } } })
    expect(inspections.length).toBeGreaterThan(0)
    expect(inspections.every(inspection => !inspection.match.matches)).toBe(true)
    const summary = summarizeInspections(inspections, 3)
    expect(summary.gogmaRequiredOnly).toBeGreaterThan(0)
    expect(summary.gogmaRequiredOnlySamples[0]!.plannerRequiredGogma).toEqual([12, 14])
    // The request reading: position 12 was free in every request, so the collapse condition held.
    const risk = diagnoseBonusFrontierRisk(candidate, scene.table).targets[0]!
    expect(measureBonusFrontierCollapse(risk, inspections, 3)).toEqual({ sameFinalPositionMismatches: inspections.length, collapseSignatures: inspections.length, collapseSamples: inspections.slice(0, 3).map(() => [12, 14]) })
    for (const attempt of record.attempts) expect(bonusFrontierRequestRisk(risk, attempt, scene.table)).toMatchObject({ positions: [{ position: 12, reservation: 'free' }], collapseConditionHolds: true })
    // The control (no same-layout Reset): the Keep chain is delivered and materializes with required {14}.
    const control = await keepChainScenario('other_layout')
    const controlRun = materialized(await materializeStructuralCandidate(control.candidate, control.scene.inputs()))
    expect(controlRun.outcome).toEqual({ kind: 'all_materialized' })
    expect(controlRun.targets[0]!.outcome).toMatchObject({ kind: 'materialized', plannerRequired: { skill: [], gogma: [14], normal: null } })
  }, 30_000)

  it('reads a risk position held or blocked by an earlier materialized Entry as no collapse condition (a risk is not an occurrence)', async () => {
    // a keeps from a low-tier Ideal layout to 14; c resets to the Ideal at 12, the same layout. c is materialized first, so 12 is
    // blocked in a's formal reservation and a's Route can no longer operate there.
    const scene = await materializationScenario({
      targets: ['a', 'c'],
      owned: [
        ownedGogma('owned.g1', { seriesSkillId: SERIES_IDEAL, restorationBonuses: keepToLowRanks(IDEAL_BONUSES) }),
        ownedGogma('owned.g2', { seriesSkillId: SERIES_IDEAL }),
      ],
      reset: { [ELEMENT_A]: { 12: IDEAL_BONUSES } },
      keepIdeal: [14],
      window: WINDOW,
    })
    const candidate = scene.candidate([
      scene.option(TARGET.a, ownedSource('owned.g1'), NONE, keep(14)),
      scene.option(TARGET.c, ownedSource('owned.g2'), NONE, reset(12)),
    ])
    expect(candidate.materializationOrder).toEqual([TARGET.c, TARGET.a])
    const risk = diagnoseBonusFrontierRisk(candidate, scene.table).targets.find(row => row.targetWeaponId === TARGET.a)!
    expect(risk).toMatchObject({ sameLayoutResetPositions: [12], otherTargetRequired: [{ position: 12, targetWeaponId: TARGET.c }] })
    const run = materialized(await materializeStructuralCandidate(candidate, scene.inputs()))
    expect(run.outcome).toEqual({ kind: 'all_materialized' })
    const cEntry = run.materializedEntries[0]!
    const request = await buildPlannerAlternativeRequest(candidate.expectedShapes.find(shape => shape.targetWeaponId === TARGET.a)!, [cEntry], scene.inputs())
    const attempt = { method: 'planner_alternative_reservation', request, outcome: { kind: 'unmeasured', reason: 'cancelled' }, observed: null } as PlannerAlternativeAttempt
    expect(bonusFrontierRequestRisk(risk, attempt, scene.table)).toEqual({ method: 'planner_alternative_reservation', gogmaStart: 10, positions: [{ position: 12, reservation: 'blocked' }], collapseConditionHolds: false })
  }, 30_000)

  it('tells the collapse signature apart from another Ideal Route of the same source that ends elsewhere', () => {
    const risk = {
      targetWeaponId: TARGET.a, orderIndex: 0, option: 'reset_then_keep' as const, requiredGogma: [208, 502], chainLayout: 'L', scanRange: { from: 209, to: 501 },
      sameLayoutResetPositions: [216], otherTargetRequired: [],
    }
    const at = (gogma: number[], reasons: ShapeMismatchReason[] = ['gogma_required']): CandidateInspection => ({ targetWeaponId: TARGET.a, method: 'planner_alternative_reservation', deliveredIndex: 1, match: { matches: false, reasons, plannerRequired: { skill: [422], gogma, normal: null } } })
    expect(measureBonusFrontierCollapse(risk, [
      at([194, 202]), // a cheaper Ideal Route ending earlier: neither
      at([300, 502]), // the same final position through another Reset (not a risk position)
      at([216, 502]), // the collapse signature
      at([216, 502], ['gogma_required', 'source']), // another source: not counted
    ], 2)).toEqual({ sameFinalPositionMismatches: 2, collapseSignatures: 1, collapseSamples: [[216, 502]] })
  })

  it('counts required-position-only and gogma-only mismatches apart from other reasons', () => {
    const at = (deliveredIndex: number, match: CandidateInspection['match']): CandidateInspection => ({ targetWeaponId: TARGET.a, method: 'planner_alternative_reservation', deliveredIndex, match })
    const required = { skill: [], gogma: [12, 14], normal: null }
    const summary = summarizeInspections([
      at(1, { matches: false, reasons: ['gogma_required'], plannerRequired: required }),
      at(2, { matches: false, reasons: ['gogma_required', 'skill_required'], plannerRequired: required }),
      at(3, { matches: false, reasons: ['gogma_required', 'final_bonuses'], plannerRequired: required }),
      at(4, { matches: true, plannerRequired: required }),
      at(5, { matches: false, reasons: ['gogma_required'], plannerRequired: null }),
    ], 1)
    expect(summary).toEqual({
      inspected: 5, matched: 1, requiredPositionsOnly: 3, gogmaRequiredOnly: 2,
      reasonCounts: { final_bonuses: 1, gogma_required: 4, skill_required: 1 },
      gogmaRequiredOnlySamples: [{ method: 'planner_alternative_reservation', deliveredIndex: 1, plannerRequiredGogma: [12, 14] }],
    })
  })
})

describe('Phase D-0B G4 diagnostics (Planner-start Ideal)', () => {
  async function idealScene() {
    return materializationScenario({
      targets: ['a', 'c'],
      owned: [
        // Ideal on both axes for a and c (same Ideal), protected or not: it makes both Targets hasIdeal at Planner start.
        ownedGogma('owned.ideal', { seriesSkillId: SERIES_IDEAL, restorationBonuses: structuredClone(IDEAL_BONUSES), isProtected: true }),
        ownedGogma('owned.g2', { seriesSkillId: SERIES_IDEAL }),
        ownedGogma('owned.g3', { seriesSkillId: SERIES_IDEAL }),
      ],
      reset: { [ELEMENT_A]: { 12: IDEAL_BONUSES, 13: IDEAL_BONUSES } },
      window: WINDOW,
    })
  }

  /**
   * a and c on one weapon type and element, but c registers another Ideal Skill: a weapon Ideal for a (Ideal Skill and Ideal
   * Bonuses) is then only Bonus-Ideal for c, so the current Phase A lets c Reset its Skills - an option that operates a's Ideal
   * weapon. Phase A - C read no existing Entry, so the context's Target is swapped before the ReachTable and the structural
   * candidate are built through the ordinary Phase A / C-1 path.
   */
  async function otherIdealScene(owned: OwnedWeapon[]) {
    const scene = await materializationScenario({ targets: ['a', 'c'], owned, reset: { [ELEMENT_A]: { 12: IDEAL_BONUSES } }, window: WINDOW })
    const targetWeapons = scene.input.targetWeapons.map(target => (target.id === TARGET.c ? { ...target, idealSkillCondition: { ...target.idealSkillCondition, seriesSkillId: OTHER_SERIES } } : target))
    const context: GlobalAssignmentContext = {
      ...scene.context, plannerInput: { ...scene.input, targetWeapons }, planningTargets: scene.context.planningTargets.map(target => targetWeapons.find(value => value.id === target.id)!),
    }
    const reach = await buildReachTable(context, scene.engine, WINDOW)
    if (reach.kind !== 'reach_table') throw new Error(reach.kind)
    const table = reach.table
    const pick = (target: TargetWeaponId, source: (value: SourceCandidate) => boolean, skill: SkillRequirement, bonus: BonusRequirement) =>
      optionOf(table, target, table.targets.find(row => row.targetWeaponId === target)!.sources.find(source)!, skill, bonus)
    const candidate = (options: ReachOption[]) => {
      const built = buildStructuralCandidate(assignmentOf(table, options), { table, context, engine: scene.engine })
      if (built.kind !== 'structural_candidate') throw new Error(JSON.stringify(built))
      return built.candidate
    }
    return { context, table, pick, candidate }
  }

  it('reads an Ideal weapon that another Target only references as a zero-operation source as not operated (G4-i, never G4-ii)', async () => {
    const scene = await idealScene()
    // Case 1: a references W with a zero-operation option; c holds W as its Ideal weapon and has another Route.
    const zeroAndOther = scene.candidate([
      scene.option(TARGET.a, ownedSource('owned.ideal'), NONE, NONE),
      scene.option(TARGET.c, ownedSource('owned.g2'), NONE, reset(12)),
    ])
    const first = diagnosePlannerStartIdeal(zeroAndOther, scene.context)
    expect(first.plannerStartIdealTargets).toBe(2)
    expect(first.counts).toEqual({ zero_operation_ideal: 1, g4_i: 1, g4_ii: 0, g4_iii: 0 })
    expect(first.g4iiiObservability).toBe('not_generated_by_current_phase_a')
    expect(first.targets.find(row => row.targetWeaponId === TARGET.a)).toMatchObject({ category: 'zero_operation_ideal', idealOwnedWeaponIds: ['owned.ideal'], ownOption: { sourceOwnedWeaponId: 'owned.ideal', operatesSource: false } })
    // W is referenced by a, but nothing operates it: it never goes in flight, so c keeps an Ideal weapon (G4-i, not G4-ii).
    expect(first.targets.find(row => row.targetWeaponId === TARGET.c)).toEqual({
      targetWeaponId: TARGET.c, orderIndex: zeroAndOther.materializationOrder.indexOf(TARGET.c), category: 'g4_i', idealOwnedWeaponIds: ['owned.ideal'],
      operatedIdealWeaponIds: [], unoperatedIdealWeaponIds: ['owned.ideal'],
      ownOption: { sourceKind: 'owned_gogma', sourceOwnedWeaponId: 'owned.g2', operatesSource: true },
      weapons: [{ ownedWeaponId: 'owned.ideal', sourceOf: [{ targetWeaponId: TARGET.a, operates: false }] }],
    })
    // Case 3: W is no option's source at all: G4-i for both Targets.
    const neither = scene.candidate([
      scene.option(TARGET.a, ownedSource('owned.g2'), NONE, reset(12)),
      scene.option(TARGET.c, ownedSource('owned.g3'), NONE, reset(13)),
    ])
    const second = diagnosePlannerStartIdeal(neither, scene.context)
    expect(second.counts).toEqual({ zero_operation_ideal: 0, g4_i: 2, g4_ii: 0, g4_iii: 0 })
    expect(second.targets.map(row => [row.weapons[0]!.sourceOf, row.unoperatedIdealWeaponIds])).toEqual([[[], ['owned.ideal']], [[], ['owned.ideal']]])
    // Diagnostics classify nothing: both candidates still materialize as usual.
    expect(materialized(await materializeStructuralCandidate(zeroAndOther, scene.inputs())).outcome).toEqual({ kind: 'all_materialized' })
    expect(materialized(await materializeStructuralCandidate(neither, scene.inputs())).outcome).toEqual({ kind: 'all_materialized' })
  }, 30_000)

  it('reads G4-ii only when another Target\'s option actually operates every Ideal weapon of the Target', async () => {
    // Case 2: c Resets the Skills of a's only Ideal weapon W (an operation that marks W in flight); a has another Route.
    const single = await otherIdealScene([
      ownedGogma('owned.ideal', { seriesSkillId: SERIES_IDEAL, restorationBonuses: structuredClone(IDEAL_BONUSES) }),
      ownedGogma('owned.g2', { seriesSkillId: SERIES_IDEAL }),
    ])
    // The current Phase A generates c's operating option on W itself (W is only Bonus-Ideal for c).
    const cRow = single.table.targets.find(row => row.targetWeaponId === TARGET.c)!
    expect(cRow.sources.find(ownedSource('owned.ideal'))).toMatchObject({ currentSkillIdeal: false, currentBonusIdeal: true })
    const operated = single.candidate([
      single.pick(TARGET.a, ownedSource('owned.g2'), NONE, reset(12)),
      single.pick(TARGET.c, ownedSource('owned.ideal'), resetSkills(8), NONE),
    ])
    const diagnostics = diagnosePlannerStartIdeal(operated, single.context)
    // Only a holds an Ideal weapon at Planner start (W is not Skill-Ideal for c).
    expect(diagnostics.counts).toEqual({ zero_operation_ideal: 0, g4_i: 0, g4_ii: 1, g4_iii: 0 })
    expect(diagnostics.targets).toEqual([expect.objectContaining({
      targetWeaponId: TARGET.a, category: 'g4_ii', idealOwnedWeaponIds: ['owned.ideal'], operatedIdealWeaponIds: ['owned.ideal'], unoperatedIdealWeaponIds: [],
      weapons: [{ ownedWeaponId: 'owned.ideal', sourceOf: [{ targetWeaponId: TARGET.c, operates: true }] }],
    })])
    // Case 5: a holds two Ideal weapons and c operates only W1. W2 is never operated, so a keeps hasIdeal through W2 (G4-i): the
    // operation on W1 is recorded, but it is not read as a loss of a's satisfaction.
    const double = await otherIdealScene([
      ownedGogma('owned.ideal1', { seriesSkillId: SERIES_IDEAL, restorationBonuses: structuredClone(IDEAL_BONUSES) }),
      ownedGogma('owned.ideal2', { seriesSkillId: SERIES_IDEAL, restorationBonuses: structuredClone(IDEAL_BONUSES) }),
      ownedGogma('owned.g2', { seriesSkillId: SERIES_IDEAL }),
    ])
    const partly = double.candidate([
      double.pick(TARGET.a, ownedSource('owned.g2'), NONE, reset(12)),
      double.pick(TARGET.c, ownedSource('owned.ideal1'), resetSkills(8), NONE),
    ])
    expect(diagnosePlannerStartIdeal(partly, double.context).targets).toEqual([expect.objectContaining({
      targetWeaponId: TARGET.a, category: 'g4_i', idealOwnedWeaponIds: ['owned.ideal1', 'owned.ideal2'],
      operatedIdealWeaponIds: ['owned.ideal1'], unoperatedIdealWeaponIds: ['owned.ideal2'],
      weapons: [
        { ownedWeaponId: 'owned.ideal1', sourceOf: [{ targetWeaponId: TARGET.c, operates: true }] },
        { ownedWeaponId: 'owned.ideal2', sourceOf: [] },
      ],
    })])
    // G4-ii would need every Ideal weapon of a operated by some other Target's option; one weapon left unoperated keeps it G4-i.
  }, 30_000)

  it('marks an option operating the Target\'s own both-axis Ideal source as G4-iii, which the current Phase A / C never accepts', async () => {
    const scene = await idealScene()
    const row = scene.table.targets.find(value => value.targetWeaponId === TARGET.a)!
    const idealSource = row.sources.find(ownedSource('owned.ideal'))!
    // The current Phase A gives a both-axis Ideal source `none / none` only, and Phase C refuses anything else (design 19.3 G2).
    const continuation = createReachOption(row, scene.table, idealSource, NONE, reset(12))
    const other = scene.option(TARGET.c, ownedSource('owned.g2'), NONE, reset(13))
    expect(buildStructuralCandidate(assignmentOf(scene.table, [continuation, other]), { table: scene.table, context: scene.context, engine: scene.engine })).toMatchObject({ kind: 'invalid_input', reason: 'invalid_option' })
    // The classifier itself reads such an option as G4-iii (a hand-built value; no generator produces it).
    const handBuilt = { assignment: assignmentOf(scene.table, [continuation, other]), materializationOrder: [TARGET.a, TARGET.c] } as unknown as StructuralCandidate
    expect(diagnosePlannerStartIdeal(handBuilt, scene.context).targets.find(value => value.targetWeaponId === TARGET.a)!.category).toBe('g4_iii')
  }, 30_000)

  it('reports no Planner-start Ideal Target when no owned weapon is Ideal', async () => {
    const scene = await materializationScenario({ targets: ['b'], owned: [], skillIdeal: { [ELEMENT_B]: [7] }, reset: { [ELEMENT_B]: { 10: IDEAL_BONUSES } }, window: WINDOW })
    const candidate = scene.candidate([scene.option(TARGET.b, newNormalSource(4), conversion(7, 7), reset(10))])
    expect(diagnosePlannerStartIdeal(candidate, scene.context)).toEqual({
      plannerStartIdealTargets: 0, counts: { zero_operation_ideal: 0, g4_i: 0, g4_ii: 0, g4_iii: 0 }, g4iiiObservability: 'not_generated_by_current_phase_a', targets: [],
    })
  }, 30_000)
})
