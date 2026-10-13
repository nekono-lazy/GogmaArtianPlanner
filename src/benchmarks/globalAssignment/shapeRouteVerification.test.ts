import { describe, expect, it } from 'vitest'
import type { BuildListEntry, RouteOperation } from '../../domain/models/publicTypes'
import { validateBuildRoute } from '../../domain/models/publicTypes'
import type { RngEngine } from '../../domain/rng/rngEngine'
import { conversion, keep } from './coverageTestFixture'
import { buildShapeConstrainedRequest, executeShapeConstrainedRequest, materializeStructuralCandidate } from './materialize'
import { ELEMENT_A, materializationScenario, ownedSource, scenarioConversionFallback, scenarioHeldCrossing, SERIES_IDEAL, TARGET } from './materializationTestFixture'
import type { MaterializationOutcome, StructuralCandidateMaterializationResult } from './materializationTypes'
import { routeText, scenarioG1Continuation, scenarioG3Upper, shapeInputs } from './shapeMaterializationTestFixture'
import type { RouteCheckIssueCode, ShapeConstrainedMaterializationRequest } from './shapeMaterializationTypes'
import { verifyShapeConstrainedRoute, type ShapeRouteCheckInput } from './shapeRouteVerification'
import { ownedNormal } from './testFixture'

/*
 * Issue #154 Global Assignment Phase D-0A-2b (`docs/PLANNER_GLOBAL_ASSIGNMENT_D0A2_DESIGN.md` 9.3): the independent Route checks.
 * Each Entry the shape-constrained method materialized passes; each mutation - of a trace, a Counter, a Keep input, the coverage,
 * a blocked position, an exclusive source, the required positions, the hashes, the final weapon, the Normal creation - fails with
 * its own issue code, including mutations `validateBuildRoute()` accepts. No Planner run, no Trace Replay, no real Export.
 */

function entryOf(outcome: MaterializationOutcome): BuildListEntry {
  if (outcome.kind !== 'materialized') throw new Error(`Not materialized: ${JSON.stringify(outcome)}`)
  return outcome.entry
}

function materializedEntries(result: StructuralCandidateMaterializationResult): BuildListEntry[] {
  if (result.kind !== 'materialization' || result.outcome.kind !== 'all_materialized') throw new Error(JSON.stringify(result))
  return result.materializedEntries
}

/** One materialized Entry of the rule d0a2-v2 with the request and the earlier Entries it was checked against. */
interface Checked {
  input: ShapeRouteCheckInput
  scene: Awaited<ReturnType<typeof scenarioHeldCrossing>>['scene']
}

async function heldCrossingC(): Promise<Checked> {
  const { scene, candidate, shape } = await scenarioHeldCrossing()
  const [aEntry] = materializedEntries(await materializeStructuralCandidate(candidate, shapeInputs(scene)))
  const request = await buildShapeConstrainedRequest(shape.c!, [aEntry!], shapeInputs(scene))
  const entry = entryOf((await executeShapeConstrainedRequest(request, [aEntry!], shapeInputs(scene))).outcome)
  return { scene, input: { entry, request, context: scene.context, table: scene.table, materializedEntries: [aEntry!], engine: scene.engine } }
}

/** The first Target of a scenario's materialization order (the empty formal reservation). */
async function singleTarget(build: typeof scenarioG1Continuation): Promise<Checked> {
  const { scene, candidate } = await build()
  const shape = candidate.expectedShapes.find(value => value.targetWeaponId === candidate.materializationOrder[0])!
  const request = await buildShapeConstrainedRequest(shape, [], shapeInputs(scene))
  const entry = entryOf((await executeShapeConstrainedRequest(request, [], shapeInputs(scene))).outcome)
  return { scene, input: { entry, request, context: scene.context, table: scene.table, materializedEntries: [], engine: scene.engine } }
}

/** An owned Normal (the Ideal families in another order, normal scope) converted at 7 (Ideal Skill) and Kept to the Ideal at 14. */
async function ownedNormalKeep(): Promise<Checked> {
  const scene = await materializationScenario({
    targets: ['a'], owned: [ownedNormal('owned.n1')], skillIdeal: { [ELEMENT_A]: [7] }, keepIdeal: [14], window: { skill: 3, gogma: 5, normal: 2 },
  })
  const candidate = scene.candidate([scene.option(TARGET.a, ownedSource('owned.n1'), conversion(7, 7), keep(14))])
  const request = await buildShapeConstrainedRequest(candidate.expectedShapes[0]!, [], shapeInputs(scene))
  const entry = entryOf((await executeShapeConstrainedRequest(request, [], shapeInputs(scene))).outcome)
  return { scene, input: { entry, request, context: scene.context, table: scene.table, materializedEntries: [], engine: scene.engine } }
}

const codes = (input: ShapeRouteCheckInput) => verifyShapeConstrainedRoute(input).issues.map(issue => issue.code)

function mutateEntry(input: ShapeRouteCheckInput, edit: (entry: BuildListEntry) => void): ShapeRouteCheckInput {
  const entry = structuredClone(input.entry)
  edit(entry)
  return { ...input, entry }
}

function mutateRequest(input: ShapeRouteCheckInput, edit: (request: ShapeConstrainedMaterializationRequest) => void): ShapeRouteCheckInput {
  const request = structuredClone(input.request)
  edit(request)
  return { ...input, request }
}

const operation = <T extends RouteOperation['type']>(entry: BuildListEntry, index: number, type: T) => {
  const value = entry.candidateSnapshot.route.operations[index]!
  if (value.type !== type) throw new Error(`Operation ${index} is ${value.type}, not ${type}.`)
  return value as Extract<RouteOperation, { type: T }>
}

describe('Phase D-0A-2b independent Route checks: materialized Entries pass', () => {
  it('passes every base kind and lane the method materializes, re-predicting every operation once and writing nothing back', async () => {
    const cases: [string, Checked, string][] = [
      ['owned Gogma, Reset then Keep across a held position', await heldCrossingC(), 'R10,R11,K13,K14'],
      ['new Normal, conversion, Reset chain', await singleTarget(scenarioConversionFallback), 'n2@4,c7,R10,R11'],
      ['G1 conversion continued by Reset Skills', await singleTarget(scenarioG1Continuation), 'n1@4,c7,R10,R11,S8,S9'],
      ['owned Gogma Keep chain (G3 upper)', await singleTarget(scenarioG3Upper), 'K10,K11,K12,K13,K14'],
      ['owned Normal converted and Kept', await ownedNormalKeep(), 'c7,K10,K11,K12,K13,K14'],
    ]
    for (const [label, { input }, route] of cases) {
      expect(routeText(input.entry), label).toBe(route)
      const before = structuredClone(input.entry)
      const report = verifyShapeConstrainedRoute(input)
      expect(report, label).toMatchObject({ passed: true, issues: [], checkedOperations: input.entry.candidateSnapshot.route.operations.length })
      expect(input.entry, label).toEqual(before)
      // Every operation was predicted again (a Counter-advance forge by position alone): one prediction per own operation.
      const operations = input.entry.candidateSnapshot.route.operations
      const expected = {
        normalArtian: operations.some(value => value.type === 'create_normal_artian') ? 1 : 0,
        skill: operations.filter(value => value.type === 'convert_normal_to_gogma' || value.type === 'reset_skills').length,
        gogmaReset: operations.filter(value => value.type === 'reset_bonuses').length,
        gogmaKeep: operations.filter(value => value.type === 'keep_bonuses').length,
      }
      expect(report.predictions, label).toMatchObject(expected)
    }
  }, 60_000)
})

describe('Phase D-0A-2b independent Route checks: mutations fail with their own issue', () => {
  it('a trace, a Counter or a Keep input that no longer follows the re-prediction (validateBuildRoute accepts the trace mutation)', async () => {
    const { input } = await heldCrossingC()
    const trace = mutateEntry(input, entry => {
      const step = entry.candidateSnapshot.bonusAmendmentTrace!.find(value => value.operationType === 'keep_bonuses')!
      step.restorationBonuses[0] = { ...step.restorationBonuses[0]!, bonusRankId: 'bonus_rank.fixture.middle' }
    })
    expect(validateBuildRoute(trace.entry.candidateSnapshot.route, trace.context.plannerInput.ownedWeapons).isValid).toBe(true)
    expect(codes(trace)).toEqual(['trace_mismatch'])
    const missing = mutateEntry(input, entry => { entry.candidateSnapshot.bonusAmendmentTrace = entry.candidateSnapshot.bonusAmendmentTrace!.slice(1) })
    expect(codes(missing)).toContain('trace_mismatch')
    const counter = mutateEntry(input, entry => { operation(entry, 1, 'reset_bonuses').gogmaCounterAfter = 13 })
    expect(codes(counter)).toEqual(expect.arrayContaining(['counter_advance_mismatch', 'unit_plan_rejected']))
    // The Reset at g1 = 11 turned into a Keep: the next Keeps read another layout than the Reset at 11's.
    const keepInput = mutateEntry(input, entry => { entry.candidateSnapshot.route.operations[1] = { ...operation(entry, 1, 'reset_bonuses'), type: 'keep_bonuses' } })
    expect(codes(keepInput)).toEqual(expect.arrayContaining(['operation_sequence', 'keep_input_layout_mismatch']))
  }, 30_000)

  it('the coverage condition, a blocked position, an exclusive or protected source and the formal reservation', async () => {
    const { scene, input } = await heldCrossingC()
    // Without the Reset at 10 (neither held nor own), the Gogma stream has a gap.
    const gap = mutateEntry(input, entry => { entry.candidateSnapshot.route.operations.splice(0, 1) })
    expect(codes(gap)).toContain('coverage_gap')
    // c alone (empty reservation) operates at 12, which a's Entry blocks.
    const { candidate, shape } = await scenarioHeldCrossing()
    const alone = await buildShapeConstrainedRequest(shape.c!, [], shapeInputs(scene))
    const covering = entryOf((await executeShapeConstrainedRequest(alone, [], shapeInputs(scene))).outcome)
    expect(routeText(covering)).toBe('R10,R11,K12,K13,K14')
    expect(codes({ ...input, entry: covering })).toEqual(expect.arrayContaining(['blocked_position']))
    // The same Entry checked against Entries that already use its source.
    const twice = await buildShapeConstrainedRequest(shape.c!, [...input.materializedEntries, input.entry], shapeInputs(scene))
    expect(codes({ ...input, request: twice, materializedEntries: [...input.materializedEntries, input.entry] })).toEqual(expect.arrayContaining(['exclusive_source', 'blocked_position']))
    // A request whose reservation is not the formal one of the earlier Entries.
    expect(codes({ ...input, materializedEntries: [] })).toContain('reservation_mismatch')
    // A protected source.
    const protectedInput = { ...input, context: { ...input.context, plannerInput: { ...input.context.plannerInput, ownedWeapons: input.context.plannerInput.ownedWeapons.map(weapon => (weapon.id === 'owned.g2' ? { ...weapon, isProtected: true } : weapon)) } } }
    expect(codes(protectedInput)).toContain('protected_source')
    expect(candidate.materializationOrder).toEqual([TARGET.a, TARGET.c])
  }, 30_000)

  it('the required positions, the hashes, the Entry, the final weapon and the Ideal', async () => {
    const { input } = await heldCrossingC()
    expect(codes(mutateRequest(input, request => { request.shape.match.required.gogma = [10, 14] }))).toEqual(['required_positions_mismatch'])
    expect(codes(mutateEntry(input, entry => { entry.targetDefinitionHash = 'fnv1a32:00000000' }))).toContain('hash_mismatch')
    expect(codes(mutateEntry(input, entry => { entry.candidateSnapshot.searchStateHash = 'fnv1a32:00000000' }))).toContain('hash_mismatch')
    expect(codes(mutateEntry(input, entry => { entry.candidateId = 'candidate.other' as never }))).toContain('entry_invalid')
    expect(codes(mutateEntry(input, entry => { entry.candidateSnapshot.calculationContext = { ...entry.candidateSnapshot.calculationContext, appSchemaVersion: 1 } }))).toContain('calculation_context_mismatch')
    expect(codes(mutateEntry(input, entry => { entry.candidateSnapshot.estimatedOperationCount += 1 }))).toContain('estimate_mismatch')
    const lowered = mutateEntry(input, entry => { entry.candidateSnapshot.finalBonuses[0] = { ...entry.candidateSnapshot.finalBonuses[0]!, bonusRankId: 'bonus_rank.fixture.middle' } })
    expect(codes(lowered)).toContain('final_state_mismatch')
    // The shape's final weapon (its required-only replay) differs from what the re-predicted Route reaches.
    expect(codes(mutateRequest(input, request => { request.shape.match.seriesSkillId = 'series_skill.fixture.other' as never }))).toEqual(['final_state_mismatch'])
    expect(codes(mutateRequest(input, request => { request.routeShape = { ...request.routeShape, bonus: { kind: 'reset_then_keep', resetPosition: 11, finalPosition: 13 } } }))).toContain('operation_sequence')
  }, 30_000)

  it('the Skill stream, the conversion and the Normal creation', async () => {
    const { input } = await singleTarget(scenarioG1Continuation)
    expect(codes(mutateEntry(input, entry => { entry.candidateSnapshot.skillAmendmentTrace![0]!.seriesSkillId = SERIES_IDEAL as never }))).toEqual(['trace_mismatch'])
    expect(codes(mutateEntry(input, entry => { entry.candidateSnapshot.conversionSkillTrace!.seriesSkillId = 'series_skill.fixture.other' as never }))).toEqual(['trace_mismatch'])
    expect(codes(mutateEntry(input, entry => { operation(entry, 4, 'reset_skills').skillCounterAfter = 10 }))).toEqual(expect.arrayContaining(['counter_advance_mismatch']))
    expect(codes(mutateRequest(input, request => { if (request.routeShape.base.kind === 'new_normal') request.routeShape.base.conversionSkillPosition = 8 }))).toContain('conversion_position_mismatch')
    // A creation that is not the canonical held-prefix one (the empty reservation forges from the origin 4).
    const { input: created } = await singleTarget(scenarioConversionFallback)
    const shifted = mutateEntry(created, entry => { Object.assign(operation(entry, 0, 'create_normal_artian'), { normalCounterBefore: 5, normalCounterAfter: 6, count: 1 }) })
    expect(codes(shifted)).toEqual(expect.arrayContaining(['normal_creation_not_canonical', 'coverage_gap']))
    const target = mutateEntry(created, entry => { Object.assign(operation(entry, 0, 'create_normal_artian'), { normalCounterAfter: 7, count: 3 }) })
    expect(codes(target)).toContain('production_target_mismatch')
  }, 30_000)

  it('reports a prediction the Engine refuses as prediction_unavailable instead of throwing', async () => {
    const { input } = await heldCrossingC()
    const engine: RngEngine = { ...input.engine, version: input.engine.version, capabilities: input.engine.capabilities, predictGogmaBonus: () => { throw new Error('refused') } }
    const report = verifyShapeConstrainedRoute({ ...input, engine })
    expect(report.passed).toBe(false)
    expect(report.issues.map(issue => issue.code)).toEqual(['prediction_unavailable'])
    const codesAll: RouteCheckIssueCode[] = report.issues.map(issue => issue.code)
    expect(codesAll).not.toContain('trace_mismatch')
  }, 30_000)
})
