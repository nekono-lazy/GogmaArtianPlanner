import { describe, expect, it } from 'vitest'
import { createBuildCandidateMeaningFingerprint } from '../../domain/buildList'
import { areRestorationBonusSetsEqual, type BuildListEntry, type BuildRoute } from '../../domain/models/publicTypes'
import type { RouteShapeConstraint } from '../../domain/search/research'
import { candidateStableKey } from '../../domain/search/candidateProcessing'
import { buildPlannerAlternativeRequest, buildShapeConstrainedRequest, executeMaterializationRequest, executeShapeConstrainedRequest } from './materialize'
import { diagnoseBonusFrontierLowerRisk, diagnoseBonusFrontierRisk } from './materializationDiagnostics'
import { matchExpectedShape, searchPolicyShapeOf } from './materializationShape'
import {
  materializationScenario, OPEN_GATE, scenarioAlternativeFirst, scenarioConversionFallback, scenarioHeldCrossing, scenarioSkillDependency, type MaterializationScenario,
} from './materializationTestFixture'
import type { PlannerAlternativeAttempt } from './materializationTypes'
import { randomShapeScenarioSpec, routeText, shapeInputs } from './shapeMaterializationTestFixture'
import { collectStructuralCandidates } from './structuralSearch'
import type { StructuralCandidate } from './coverageTypes'

/*
 * Issue #154 Global Assignment Phase D-0A-2b (`docs/PLANNER_GLOBAL_ASSIGNMENT_D0A2_DESIGN.md` 9.2): the shape-constrained method
 * against Planner Alternative Search (design 9.1) under the same formal reservation and extent, for the shapes Planner Alternative
 * Search delivers. Semantic parity (the Route, the final weapon, the advances, `candidateStableKey`, the traces, the required
 * positions, the Entry's meaning and its ID) is checked apart from the identity, which differs by method (Candidate ID,
 * `searchRunId`, `BuildListEntry.candidateId`).
 *
 * Excluded from parity, each with its own check: G1 continuation shapes (Planner Alternative Search never delivers them), shapes
 * with a G3 static risk (an improvement, not a parity), and one category the design's expectation (9.2 "RouteOperation蛻・荳閾ｴ -
 * 隕玖ｾｼ縺ｿ") did not foresee and this test found: an "operation-kind alternative" - Planner Alternative Search's first match uses a
 * Bonus operation kind the shape's lane forbids (a Keep chain ending at `g*` for a Reset-only shape), reaching the same final
 * multiset at the same required positions; `matchExpectedShape()` accepts both, their Entry IDs differ.
 */

const BONUS_TYPES = new Set(['reset_bonuses', 'keep_bonuses'])

/** Whether every Bonus operation of the Route is one the shape's Bonus lane allows (design 5.3 item 8). */
function withinBonusPolicy(route: BuildRoute, shape: RouteShapeConstraint): boolean {
  const bonus = route.operations.filter(operation => BONUS_TYPES.has(operation.type)) as Extract<BuildRoute['operations'][number], { gogmaCounterBefore: number }>[]
  switch (shape.bonus.kind) {
    case 'zero': return bonus.length === 0
    case 'reset': return bonus.every(operation => operation.type === 'reset_bonuses')
    case 'keep': return bonus.every(operation => operation.type === 'keep_bonuses')
    case 'reset_then_keep': {
      const resetPosition = shape.bonus.resetPosition
      return bonus.every(operation => (operation.type === 'reset_bonuses' ? operation.gogmaCounterBefore <= resetPosition : operation.gogmaCounterBefore > resetPosition))
    }
  }
}

function expectSemanticParity(shapeEntry: BuildListEntry, paEntry: BuildListEntry, label: string, existing: readonly BuildListEntry[]) {
  const left = shapeEntry.candidateSnapshot
  const right = paEntry.candidateSnapshot
  expect(left.route, label).toEqual(right.route)
  expect(left.finalBonuses, label).toEqual(right.finalBonuses)
  expect([left.restorationBonusScope, left.seriesSkillId, left.groupSkillId], label).toEqual([right.restorationBonusScope, right.seriesSkillId, right.groupSkillId])
  expect([left.estimatedOperationCount, left.estimatedGogmaAdvance, left.estimatedSkillAdvance, left.estimatedNormalAdvance], label)
    .toEqual([right.estimatedOperationCount, right.estimatedGogmaAdvance, right.estimatedSkillAdvance, right.estimatedNormalAdvance])
  expect(candidateStableKey(left), label).toBe(candidateStableKey(right))
  expect([left.bonusAmendmentTrace, left.skillAmendmentTrace, left.conversionSkillTrace], label).toEqual([right.bonusAmendmentTrace, right.skillAmendmentTrace, right.conversionSkillTrace])
  expect(createBuildCandidateMeaningFingerprint(left), label).toBe(createBuildCandidateMeaningFingerprint(right))
  expect([shapeEntry.searchStateHash, shapeEntry.referencedOwnedWeaponsHash, shapeEntry.targetDefinitionHash, shapeEntry.calculationContext], label)
    .toEqual([paEntry.searchStateHash, paEntry.referencedOwnedWeaponsHash, paEntry.targetDefinitionHash, paEntry.calculationContext])
  expect(left.intermediateStateGroups, label).toEqual(right.intermediateStateGroups)
  // Semantic parity: one Entry ID.
  expect(shapeEntry.id, label).toBe(paEntry.id)
  if (existing.some(value => value.id === shapeEntry.id)) {
    // The PlannerInput already holds this exact current content: both methods reuse that Entry as it is (design 9.1).
    expect(shapeEntry, label).toEqual(existing.find(value => value.id === shapeEntry.id))
    expect(paEntry, label).toEqual(shapeEntry)
    return
  }
  // Identity parity is not asked: the methods' identities differ.
  expect(shapeEntry.candidateId, label).not.toBe(paEntry.candidateId)
  expect(left.searchRunId.startsWith('research.global-assignment.shape.'), label).toBe(true)
  expect(right.searchRunId.startsWith('research.global-assignment.alternative.'), label).toBe(true)
}

interface Tally { parity: number; operationKindAlternative: number; g1: number; g3: number }

/** Every Target of the candidate in its order: the shape method's Entry against Planner Alternative Search's first match, same reservation. */
async function compareCandidate(scene: MaterializationScenario, candidate: StructuralCandidate, tally: Tally, label: string): Promise<void> {
  const entries: BuildListEntry[] = []
  const upper = diagnoseBonusFrontierRisk(candidate, scene.table)
  const lower = diagnoseBonusFrontierLowerRisk(candidate, scene.table)
  const inputs = scene.inputs({ settings: { deliveryCap: 5_000, searchScaleGate: OPEN_GATE } })
  for (const targetWeaponId of candidate.materializationOrder) {
    const shape = candidate.expectedShapes.find(value => value.targetWeaponId === targetWeaponId)!
    const request = await buildShapeConstrainedRequest(shape, entries, shapeInputs(scene))
    const attempt = await executeShapeConstrainedRequest(request, entries, shapeInputs(scene))
    if (attempt.outcome.kind !== 'materialized') throw new Error(`${label}: ${attempt.outcome.kind}`)
    const entry = attempt.outcome.entry
    const alternativeRequest = await buildPlannerAlternativeRequest(shape, entries, inputs)
    // Same formal reservation and extent for both methods.
    expect(alternativeRequest.reservation, label).toEqual(request.reservation)
    expect(alternativeRequest.extent, label).toEqual(request.extent)
    const alternative = await executeMaterializationRequest(alternativeRequest, entries, inputs) as PlannerAlternativeAttempt
    const at = `${label} ${targetWeaponId}`
    if (searchPolicyShapeOf(shape.option, scene.table) !== null) {
      // G1: Planner Alternative Search never delivers the continuation.
      expect(alternative.outcome.kind, at).not.toBe('materialized')
      tally.g1 += 1
    } else if ((upper.targets.find(row => row.targetWeaponId === targetWeaponId)?.sameLayoutResetPositions.length ?? 0) > 0
      || (lower.targets.find(row => row.targetWeaponId === targetWeaponId)?.sameLayoutResetPositions.length ?? 0) > 0) {
      // G3 risk: an improvement, checked apart; the shape method never costs more own operations than a Planner Alternative match.
      if (alternative.outcome.kind === 'materialized') expect(entry.candidateSnapshot.estimatedOperationCount, at).toBeLessThanOrEqual(alternative.outcome.entry.candidateSnapshot.estimatedOperationCount)
      tally.g3 += 1
    } else {
      // Every other shape is one Planner Alternative Search delivers.
      expect(alternative.outcome.kind, at).toBe('materialized')
      if (alternative.outcome.kind !== 'materialized') continue
      const paEntry = alternative.outcome.entry
      if (withinBonusPolicy(paEntry.candidateSnapshot.route, request.routeShape)) {
        expectSemanticParity(entry, paEntry, at, scene.input.buildListEntries)
        tally.parity += 1
      } else {
        // The operation-kind alternative: the same source, required positions and final weapon, another Bonus operation kind.
        const left = entry.candidateSnapshot
        const right = paEntry.candidateSnapshot
        expect(request.routeShape.bonus.kind, at).toBe('reset')
        expect(right.route.operations.filter(operation => BONUS_TYPES.has(operation.type)).every(operation => operation.type === 'keep_bonuses'), at).toBe(true)
        expect(right.route.sourceOwnedWeaponId, at).toBe(left.route.sourceOwnedWeaponId)
        expect(matchExpectedShape(paEntry, shape, scene.engine), at).toEqual(matchExpectedShape(entry, shape, scene.engine))
        expect(areRestorationBonusSetsEqual(left.finalBonuses, right.finalBonuses), at).toBe(true)
        expect([left.restorationBonusScope, left.seriesSkillId, left.groupSkillId], at).toEqual([right.restorationBonusScope, right.seriesSkillId, right.groupSkillId])
        expect(left.estimatedOperationCount, at).toBe(right.estimatedOperationCount)
        expect(routeText(entry).replace(/R/g, 'K'), at).toBe(routeText(paEntry))
        expect(entry.id, at).not.toBe(paEntry.id)
        tally.operationKindAlternative += 1
      }
    }
    entries.push(entry)
  }
}

describe('Phase D-0A-2b parity with Planner Alternative Search (design 9.2)', () => {
  it('matches Planner Alternative Search semantically on the D-0A scenarios (Entry IDs equal, identities different)', async () => {
    const tally: Tally = { parity: 0, operationKindAlternative: 0, g1: 0, g3: 0 }
    for (const build of [scenarioHeldCrossing, scenarioConversionFallback, scenarioSkillDependency, scenarioAlternativeFirst]) {
      const { scene, candidate } = await build()
      await compareCandidate(scene, candidate, tally, build.name)
    }
    expect(tally).toEqual({ parity: 8, operationKindAlternative: 0, g1: 0, g3: 0 })
  }, 60_000)

  it('matches it on seeded random Phase A / C candidates, and isolates every non-parity case into G1, G3 or the operation-kind alternative', async () => {
    const tally: Tally = { parity: 0, operationKindAlternative: 0, g1: 0, g3: 0 }
    for (let seed = 1; seed <= 300; seed++) {
      const scene = await materializationScenario(randomShapeScenarioSpec(seed))
      const collected = collectStructuralCandidates({ table: scene.table, context: scene.context, engine: scene.engine }, { nodeBudget: 2_000, mrvLookahead: 4, coverageDrivenOrdering: true }, 3)
      if (collected.status !== 'candidates_found' && collected.status !== 'search_incomplete') continue
      for (const [index, candidate] of collected.candidates.entries()) await compareCandidate(scene, candidate, tally, `seed ${seed} candidate ${index}`)
    }
    expect(tally.parity).toBeGreaterThanOrEqual(500)
    expect(tally.g1).toBeGreaterThan(0)
    expect(tally.g3).toBeGreaterThan(0)
    // Observed in this fixture (recorded in the design record): a minority, and only for Reset-only shapes.
    expect(tally.operationKindAlternative).toBeGreaterThan(0)
    expect(tally.operationKindAlternative).toBeLessThan(tally.parity)
  }, 300_000)
})
