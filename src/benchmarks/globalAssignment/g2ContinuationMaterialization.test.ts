import { describe, expect, it } from 'vitest'
import type { BuildListEntry, OwnedWeapon, RestorationBonusSet } from '../../domain/models/publicTypes'
import { derivePlannerAlternativeReservation } from '../../domain/planner/alternative/plannerAlternativeReservation'
import { runPlannerDeterministicSchedule } from '../../domain/planner/plannerDeterministicScheduler'
import { replayPlannerSearchTrace } from '../../domain/planner/plannerTraceReplay'
import { createProductionPlanWithObserver } from '../../domain/planner/productionPlanGeneration'
import { emptyPlannerAlternativeReservation } from '../../domain/search/alternative'
import { globalResearchDependencies } from '../plannerGlobalOptimizationResearch'
import { keep, NONE, reset, resetSkills, resetThenKeep } from './coverageTestFixture'
import { buildShapeConstrainedRequest, executeShapeConstrainedRequest, materializeStructuralCandidate } from './materialize'
import { countContinuationOptions, diagnosePlannerStartIdeal, diagnoseSearchPolicyShapes } from './materializationDiagnostics'
import { matchExpectedShape, ownedGogmaContinuationShapeOf, searchPolicyShapeOf } from './materializationShape'
import {
  ELEMENT_A, ELEMENT_B, materializationScenario, ownedSource, REORDERED_GOGMA, SERIES_IDEAL, TARGET, type MaterializationScenario, type MaterializationScenarioSpec,
} from './materializationTestFixture'
import type { MaterializationOutcome, StructuralCandidateMaterialization, StructuralCandidateMaterializationResult } from './materializationTypes'
import { enumerateReachOptions, reachOptionKey } from './reachOptions'
import { routeText, shapeCapturingPort, shapeInputs } from './shapeMaterializationTestFixture'
import type { ShapeConstrainedAttempt, ShapeMethodSelection } from './shapeMaterializationTypes'
import { IDEAL_BONUSES, OTHER_FAMILIES, ownedGogma } from './testFixture'
import { REACH_OPTION_SET_A1, REACH_OPTION_SET_A2, type BonusRequirement, type ReachOption, type ReachOptionSetVersion, type SkillRequirement } from './types'

/*
 * Issue #154 Global Assignment Phase A-2 (design 19.8, D0A2 6.2 / 11): the owned-Gogma current-Ideal lane continuations (G2)
 * end to end - the a2 Phase A lists them, Phase C builds their structural candidate and expected shape (C-1 validation and the
 * required-only replay), the rule `d0a2-v2` materializes them by the shape-constrained method alone through the D-0A-2a seam,
 * `matchExpectedShape()` and the independent Route checks accept them, and the rule `d0a-v1` classifies them as a Search-policy
 * shape. A few are also run through the Production scheduler and Trace Replay on this tiny fixture: that is not the D-1 Planner
 * verification of a structural candidate. Synthetic fixture and table Engine only.
 */

const WINDOW = { skill: 3, gogma: 5, normal: 2 }
const OTHER_SERIES = 'series_skill.fixture.other'

function materialized(result: StructuralCandidateMaterializationResult): StructuralCandidateMaterialization {
  if (result.kind !== 'materialization') throw new Error(`${result.reason}: ${result.detail}`)
  return result
}

function entryOf(outcome: MaterializationOutcome): BuildListEntry {
  if (outcome.kind !== 'materialized') throw new Error(`Not materialized: ${JSON.stringify(outcome)}`)
  return outcome.entry
}

interface G2Case {
  name: string
  owned: OwnedWeapon[]
  spec: Omit<MaterializationScenarioSpec, 'targets' | 'owned' | 'window' | 'optionSet'>
  skill: SkillRequirement
  bonus: BonusRequirement
  /** The continued lane(s) the G2 detector records. */
  continued: { skill: boolean; bonus: boolean }
  route: string
  required: { skill: number[]; gogma: number[] }
}

const skillIdealGogma = (bonuses: RestorationBonusSet = OTHER_FAMILIES) => ownedGogma('owned.g1', { seriesSkillId: SERIES_IDEAL, restorationBonuses: structuredClone(bonuses) })
const bonusIdealGogma = () => ownedGogma('owned.g1', { seriesSkillId: OTHER_SERIES, restorationBonuses: structuredClone(IDEAL_BONUSES) })

const CASES: G2Case[] = [
  {
    name: 'S2: current Ideal Skills reset again to a later Ideal (Bonus lane: an ordinary Reset)',
    owned: [skillIdealGogma()], spec: { skillIdeal: { [ELEMENT_A]: [9] }, reset: { [ELEMENT_A]: { 12: IDEAL_BONUSES } } },
    skill: resetSkills(9), bonus: reset(12), continued: { skill: true, bonus: false }, route: 'R10,R11,R12,S7,S8,S9', required: { skill: [9], gogma: [12] },
  },
  {
    name: 'B1: current Ideal Bonuses Reset again to a later Ideal (Skill lane: an ordinary Reset Skills)',
    owned: [bonusIdealGogma()], spec: { skillIdeal: { [ELEMENT_A]: [8] }, reset: { [ELEMENT_A]: { 12: IDEAL_BONUSES } } },
    skill: resetSkills(8), bonus: reset(12), continued: { skill: false, bonus: true }, route: 'R10,R11,R12,S7,S8', required: { skill: [8], gogma: [12] },
  },
  {
    name: 'B2: current Ideal Bonuses Kept again to a later Ideal',
    owned: [bonusIdealGogma()], spec: { skillIdeal: { [ELEMENT_A]: [8] }, keepIdeal: [13] },
    skill: resetSkills(8), bonus: keep(13), continued: { skill: false, bonus: true }, route: 'K10,K11,K12,K13,S7,S8', required: { skill: [8], gogma: [13] },
  },
  {
    name: 'B2: current Ideal Bonuses Reset then Kept to a later Ideal',
    owned: [bonusIdealGogma()], spec: { skillIdeal: { [ELEMENT_A]: [8] }, reset: { [ELEMENT_A]: { 11: REORDERED_GOGMA } }, keepIdeal: [14] },
    skill: resetSkills(8), bonus: resetThenKeep(11, 14), continued: { skill: false, bonus: true }, route: 'R10,R11,K12,K13,K14,S7,S8', required: { skill: [8], gogma: [11, 14] },
  },
  {
    name: 'composite: current Ideal Skills continued, non-Ideal Bonuses Kept to the Ideal',
    owned: [skillIdealGogma(REORDERED_GOGMA)], spec: { skillIdeal: { [ELEMENT_A]: [9] }, keepIdeal: [13] },
    skill: resetSkills(9), bonus: keep(13), continued: { skill: true, bonus: false }, route: 'K10,K11,K12,K13,S7,S8,S9', required: { skill: [9], gogma: [13] },
  },
  {
    name: 'composite: non-Ideal Skills reset to the Ideal, current Ideal Bonuses continued by Reset -> Keep',
    owned: [bonusIdealGogma()], spec: { skillIdeal: { [ELEMENT_A]: [9] }, reset: { [ELEMENT_A]: { 10: REORDERED_GOGMA } }, keepIdeal: [12] },
    skill: resetSkills(9), bonus: resetThenKeep(10, 12), continued: { skill: false, bonus: true }, route: 'R10,K11,K12,S7,S8,S9', required: { skill: [9], gogma: [10, 12] },
  },
]

async function g2Scene(value: G2Case, optionSet: ReachOptionSetVersion = REACH_OPTION_SET_A2): Promise<MaterializationScenario> {
  return materializationScenario({ targets: ['a'], owned: structuredClone(value.owned), window: WINDOW, optionSet, ...value.spec })
}

describe('A-2 G2 end to end: Phase A -> Phase C -> d0a2-v2 shape-constrained materialization', () => {
  for (const value of CASES) {
    it(value.name, async () => {
      const scene = await g2Scene(value)
      const option = scene.option(TARGET.a, ownedSource('owned.g1'), value.skill, value.bonus)
      // Phase A: the a2 option set lists it, the a1 set does not.
      expect([...enumerateReachOptions(scene.table.targets[0]!, scene.table)].map(reachOptionKey)).toContain(reachOptionKey(option))
      const a1 = await g2Scene(value, REACH_OPTION_SET_A1)
      expect([...enumerateReachOptions(a1.table.targets[0]!, a1.table)].map(reachOptionKey)).not.toContain(reachOptionKey(option))
      // Phase C: C-1 validation and the required-only replay build the expected shape (a1 refuses the same option).
      const candidate = scene.candidate([option])
      expect(() => a1.candidate([a1.option(TARGET.a, ownedSource('owned.g1'), value.skill, value.bonus)])).toThrow(/invalid_option/)
      const shape = candidate.expectedShapes[0]!
      expect(shape.option.verification).toBe('rng_replayed')
      expect(shape.match.required).toEqual({ ...value.required, normal: null })
      expect(shape.match).toMatchObject({ finalBonuses: expect.any(Array), restorationBonusScope: 'gogma_artian', seriesSkillId: SERIES_IDEAL })
      // The G2 detector records the continued lane(s) on their own.
      const continuation = ownedGogmaContinuationShapeOf(shape.option, scene.table)
      expect(continuation).toMatchObject({ policy: 'lane_start_ideal_owned_gogma_continuation', ownedWeaponId: 'owned.g1' })
      expect(continuation!.skill !== null).toBe(value.continued.skill)
      expect(continuation!.bonus !== null).toBe(value.continued.bonus)
      if (value.bonus.kind !== 'none' && value.continued.bonus) {
        expect(continuation!.bonus).toEqual({ requirement: value.bonus.kind, resetPosition: value.bonus.kind === 'reset_then_keep' ? value.bonus.resetPosition : null, finalPosition: value.bonus.finalPosition })
      }
      // d0a2-v2: the continuation shape is the shape-constrained method's alone.
      const spy = shapeCapturingPort()
      const run = materialized(await materializeStructuralCandidate(candidate, shapeInputs(scene, { search: spy.port })))
      expect(run.outcome).toEqual({ kind: 'all_materialized' })
      const record = run.targets[0]!
      const selection = record.selection as ShapeMethodSelection
      expect(selection).toMatchObject({ materializationRule: 'd0a2-v2', rule: 'continuation_shape_constrained_only', order: ['shape_constrained'] })
      expect(selection.continuation).toEqual(continuation)
      expect(selection.policyShape).toEqual(continuation)
      expect(record.attempts.map(attempt => attempt.method)).toEqual(['shape_constrained'])
      const entry = entryOf(record.outcome)
      expect(routeText(entry)).toBe(value.route)
      expect(record.outcome).toMatchObject({ kind: 'materialized', method: 'shape_constrained', deliveredBeforeMatch: 0, plannerRequired: { ...value.required, normal: null } })
      // The independent checks re-predict every operation (chain units included) and pass; the match is the shape's.
      const attempt = record.attempts[0] as ShapeConstrainedAttempt
      expect(attempt.routeChecks).toMatchObject({ passed: true, issues: [] })
      expect(matchExpectedShape(entry, shape, scene.engine)).toMatchObject({ matches: true, plannerRequired: { ...value.required, normal: null } })
      expect(entry.candidateSnapshot.route.sourceOwnedWeaponId).toBe('owned.g1')
      // The formal reservation reaches the seam unchanged (empty: nothing was materialized before).
      expect(spy.seamInputs).toHaveLength(1)
      expect(spy.seamInputs[0]!.reservation).toEqual(emptyPlannerAlternativeReservation)
      expect(attempt.request.reservation).toEqual(emptyPlannerAlternativeReservation)
      // Deterministic.
      const again = materialized(await materializeStructuralCandidate(structuredClone(candidate), shapeInputs(scene)))
      expect(JSON.stringify(again.targets.map(target => target.outcome))).toBe(JSON.stringify(run.targets.map(target => target.outcome)))
      // d0a-v1: a Search-policy shape, classified before any Search (never a mismatch, an extent stop or a cap).
      const v1 = materialized(await materializeStructuralCandidate(candidate, { ...scene.inputs(), searchPolicyPrecheck: true }))
      expect(v1.outcome).toEqual({ kind: 'materialization_unconfirmed', targetWeaponId: TARGET.a, outcome: { kind: 'not_executed', reason: 'search_policy_shape', policyShape: continuation } })
      // The D-0B diagnostics count it (a2 table): one owned-Gogma continuation, no G1.
      expect(countContinuationOptions(candidate, scene.table)).toEqual({
        laneStartIdealSkillContinuation: 0, ownedGogmaContinuation: { options: 1, skill: value.continued.skill ? 1 : 0, bonus: value.continued.bonus ? 1 : 0 },
      })
      expect(diagnoseSearchPolicyShapes(candidate, scene.table).shapes.map(row => row.policyShape)).toEqual([continuation])
      // A source Ideal on one axis is not the Target's Ideal weapon: no G4 case arises from it.
      expect(diagnosePlannerStartIdeal(candidate, scene.context).plannerStartIdealTargets).toBe(0)
    }, 30_000)
  }

  it('a continuation Route crossing another Target\'s held positions, materialized after it under the formal reservation', async () => {
    // a: an owned Gogma with Ideal Skills Resets to the Ideal at 12; b (another element: no cross satisfaction with a, but the same
    // Skill and Gogma Counters) is an owned Gogma with Ideal Bonuses continued by Reset -> Keep (11, 14), its non-Ideal Skills reset
    // to 8. b is materialized after a and steps over a's required Reset at 12.
    const scene = await materializationScenario({
      targets: ['a', 'b'], optionSet: REACH_OPTION_SET_A2, window: WINDOW,
      owned: [
        ownedGogma('owned.g1', { seriesSkillId: SERIES_IDEAL }),
        ownedGogma('owned.g2', { elementId: ELEMENT_B, seriesSkillId: OTHER_SERIES, restorationBonuses: structuredClone(IDEAL_BONUSES) }),
      ],
      skillIdeal: { [ELEMENT_B]: [8] }, reset: { [ELEMENT_A]: { 12: IDEAL_BONUSES }, [ELEMENT_B]: { 11: REORDERED_GOGMA } }, keepIdeal: [14],
    })
    const candidate = scene.candidate([
      scene.option(TARGET.a, ownedSource('owned.g1'), NONE, reset(12)),
      scene.option(TARGET.b, ownedSource('owned.g2'), resetSkills(8), resetThenKeep(11, 14)),
    ])
    expect(candidate.materializationOrder).toEqual([TARGET.a, TARGET.b])
    const spy = shapeCapturingPort()
    const run = materialized(await materializeStructuralCandidate(candidate, shapeInputs(scene, { search: spy.port })))
    expect(run.outcome).toEqual({ kind: 'all_materialized' })
    const [aRecord, bRecord] = run.targets
    expect((bRecord!.selection as ShapeMethodSelection).rule).toBe('continuation_shape_constrained_only')
    expect((bRecord!.selection as ShapeMethodSelection).continuous).toBe(false)
    const aEntry = entryOf(aRecord!.outcome)
    const bEntry = entryOf(bRecord!.outcome)
    const reservation = derivePlannerAlternativeReservation([aEntry], scene.engine)
    expect(reservation.gogma.blocked).toContain(12)
    // The seam ran for b under the formal reservation of a's Entry alone; b never operates a's required position 12.
    const bSeam = spy.seamInputs.find(input => input.targetWeaponId === TARGET.b)!
    expect(bSeam.reservation).toEqual(reservation)
    const gogmaOperations = bEntry.candidateSnapshot.route.operations.flatMap(operation => (operation.type === 'reset_bonuses' || operation.type === 'keep_bonuses' ? [operation.gogmaCounterBefore] : []))
    expect(gogmaOperations).not.toContain(12)
    expect(gogmaOperations).toEqual(expect.arrayContaining([11, 13, 14]))
    expect(bRecord!.outcome).toMatchObject({ kind: 'materialized', method: 'shape_constrained', plannerRequired: { skill: [8], gogma: [11, 14], normal: null } })
    expect((bRecord!.attempts.at(-1) as ShapeConstrainedAttempt).routeChecks).toMatchObject({ passed: true, issues: [] })
    // A small Production scheduler run over the two Entries (not the D-1 verification): completed, Trace Replay valid.
    await expectPlannerCompletes(scene, run.materializedEntries)
  }, 60_000)

  it('S2 and B1 Entries also complete a small Production scheduler run with a valid Trace Replay (no early completion mid-Route)', async () => {
    for (const value of [CASES[0]!, CASES[1]!]) {
      const scene = await g2Scene(value)
      const candidate = scene.candidate([scene.option(TARGET.a, ownedSource('owned.g1'), value.skill, value.bonus)])
      const run = materialized(await materializeStructuralCandidate(candidate, shapeInputs(scene)))
      const steps = await expectPlannerCompletes(scene, run.materializedEntries)
      // Every operation of the continuation Route runs as a Step: the Target is not completed when a lane passes an Ideal state.
      expect(steps, value.name).toBe(run.materializedEntries[0]!.candidateSnapshot.route.operations.length)
    }
  }, 60_000)
})

/** Runs the Production scheduler and Plan generation over exactly these Entries and returns the Plan's Step count. */
async function expectPlannerCompletes(scene: MaterializationScenario, entries: BuildListEntry[]): Promise<number> {
  const input = { ...scene.input, buildListEntries: structuredClone(entries) }
  const dependencies = globalResearchDependencies(scene.engine)
  const scheduled = await runPlannerDeterministicSchedule(input, dependencies)
  expect(scheduled.termination.status).toBe('completed')
  expect([...scheduled.bestState!.selectedBuildListEntryIds].sort()).toEqual(entries.map(entry => entry.id).sort())
  const replay = replayPlannerSearchTrace(input, scheduled.bestState!, scene.engine)
  expect(replay.issues).toEqual([])
  expect(replay.isValid).toBe(true)
  const planned = await createProductionPlanWithObserver(input, dependencies, undefined)
  expect(planned.termination.status).toBe('completed')
  expect(planned.conflicts).toEqual([])
  return planned.plan!.steps.length
}

describe('A-2 G2: protected and both-axis Ideal sources, and unsupported predictions', () => {
  const both = (isProtected: boolean) => ownedGogma('owned.g1', { seriesSkillId: SERIES_IDEAL, restorationBonuses: structuredClone(IDEAL_BONUSES), isProtected })

  for (const isProtected of [true, false]) {
    it(`a source Ideal on both axes (${isProtected ? 'protected' : 'unprotected'}): none / none only, a continuation is refused, the zero shape materializes`, async () => {
      const scene = await materializationScenario({
        targets: ['a'], owned: [both(isProtected)], window: WINDOW, optionSet: REACH_OPTION_SET_A2, skillIdeal: { [ELEMENT_A]: [9] }, reset: { [ELEMENT_A]: { 12: IDEAL_BONUSES } },
      })
      const keys = [...enumerateReachOptions(scene.table.targets[0]!, scene.table)].filter(option => option.source.kind === 'owned_gogma').map(reachOptionKey)
      expect(keys).toEqual([`${TARGET.a}|owned:owned.g1|none|none`])
      for (const [skill, bonus] of [[resetSkills(9), NONE], [NONE, reset(12)], [resetSkills(9), reset(12)]] as const) {
        expect(() => scene.candidate([scene.option(TARGET.a, ownedSource('owned.g1'), skill, bonus)]), `${skill.kind} / ${bonus.kind}`)
          .toThrow(isProtected ? /protected Gogma owned\.g1 accepts no Skill or Bonus operation/ : /needs (Skill|Bonus) requirement none under global-assignment-reach-options:a2/)
      }
      const candidate = scene.candidate([scene.option(TARGET.a, ownedSource('owned.g1'), NONE, NONE)])
      const run = materialized(await materializeStructuralCandidate(candidate, shapeInputs(scene)))
      expect(run.outcome).toEqual({ kind: 'all_materialized' })
      expect(entryOf(run.targets[0]!.outcome).candidateSnapshot.route.operations).toEqual([])
      expect(searchPolicyShapeOf(candidate.expectedShapes[0]!.option, scene.table)).toBeNull()
      // The same weapon under an operating shape is a broken premise (protected) or a shape no option set builds: fail closed.
      const operating = structuredClone(candidate.expectedShapes[0]!)
      operating.option = { ...operating.option, skillRequired: resetSkills(9) } as ReachOption
      const request = await buildShapeConstrainedRequest(operating, [], shapeInputs(scene))
      if (isProtected) expect(request.premiseViolations).toEqual([{ kind: 'source_protected', ownedWeaponId: 'owned.g1' }])
      else expect(request.premiseViolations).toEqual([])
    }, 30_000)
  }

  it('lists no Keep continuation from a layout without Keep support, and reports a needed capability the Engine lost as unsupported', async () => {
    const value = CASES[2]! // B2 Keep continuation
    const keepRefused = await materializationScenario({
      targets: ['a'], owned: structuredClone(value.owned), window: WINDOW, optionSet: REACH_OPTION_SET_A2, ...value.spec,
      support: input => (input.type === 'gogma_keep' ? { supported: false, reason: 'unsupported_current_bonus' } : null),
    })
    const keys = [...enumerateReachOptions(keepRefused.table.targets[0]!, keepRefused.table)].map(reachOptionKey)
    expect(keys.some(key => key.includes('keep_from_source'))).toBe(false)
    expect(keys.some(key => key.endsWith('|none'))).toBe(true)
    // With support, a Skill capability lost after Phase A: unsupported(capability_unavailable), never fail closed or a mismatch.
    const scene = await g2Scene(CASES[0]!)
    const candidate = scene.candidate([scene.option(TARGET.a, ownedSource('owned.g1'), CASES[0]!.skill, CASES[0]!.bonus)])
    const request = await buildShapeConstrainedRequest(candidate.expectedShapes[0]!, [], shapeInputs(scene))
    ;(scene.engine.capabilities as { supportsSkillPrediction: boolean }).supportsSkillPrediction = false
    const attempt = await executeShapeConstrainedRequest(request, [], shapeInputs(scene))
    expect(attempt.outcome).toMatchObject({ kind: 'unsupported', reason: 'capability_unavailable', detail: { unavailable: { kind: 'capability_unavailable', capability: 'skill' } } })
  }, 30_000)
})
