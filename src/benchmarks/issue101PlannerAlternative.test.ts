import { beforeAll, describe, expect, it } from 'vitest'
import {
  createProductionPlannerDependencies,
  derivePlannerAlternativeReservation,
  runPlannerAlternativeKernel,
  type PlannerAlternativeFound,
  type PlannerAlternativeKernelTargetResult,
  type PlannerDependencies,
} from '../domain/planner'
import { CURRENT_CALCULATION_APP_SCHEMA_VERSION } from '../domain/models/publicTypes'
import type { RouteOperation } from '../domain/models/publicTypes'
import {
  PRODUCTION_RNG_ENGINE_VERSION,
  ProductionRngEngine,
} from '../domain/rng/production/productionRngEngine'
import { satisfiesIdealTarget } from '../domain/target'
import {
  createIssue101RealFixture,
  createIssue101Targets,
  ISSUE_101_GOGMA_COUNTER,
  ISSUE_101_NORMAL_COUNTER,
  ISSUE_101_SKILL_COUNTER,
  type Issue101RealFixture,
} from './issue101ConstrainedResearchFixtures'
import { summarizeIssue101Route } from './issue101RouteSummary'

/*
 * Issue #101 Phase 2 acceptance (PLANNER_SPEC 9.2.19.4 / 9.2.19.6,
 * SEARCH_SPEC 13.2.6): Dragon fixed, Fire searched by Planner Alternative
 * Search under Dragon's resource reservation, then trialled by the full
 * Production Planner run + Trace Replay over the Fire O -> G replacement set.
 *
 * Every Candidate, Entry and conflict key comes from the unmodified current
 * Production authorities (`createIssue101RealFixture()`). The expected Fire
 * alternative below was measured with the current Production RNG
 * implementation (`production-rng:c5-e7`); it is a regression fixture of that
 * runtime, not a game observation.
 */

const SLOW = 120_000

/** Measured with the current Production RNG implementation (production-rng:c5-e7). */
const MEASURED_FIRE_ALTERNATIVE = {
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

describe('Issue #101 Planner Alternative Phase 2 acceptance', () => {
  let fixture: Issue101RealFixture
  let dependencies: PlannerDependencies
  let fire: PlannerAlternativeKernelTargetResult
  let found: PlannerAlternativeFound

  beforeAll(async () => {
    fixture = await createIssue101RealFixture()
    dependencies = createProductionPlannerDependencies(new ProductionRngEngine())
    // The user's decision: prefer Dragon on the Normal 206 conflict the Issue names.
    const normal = fixture.initialConflicts.find(({ kind }) => kind === 'same_normal_counter')
    if (!normal) throw new Error('Issue #101 fixture: no Normal conflict.')
    const result = await runPlannerAlternativeKernel({
      plannerInput: fixture.plannerInput,
      decision: { conflictKey: normal.id, selectedBuildListEntryId: fixture.dragonEntry.id },
      priorFixedBuildListEntryIds: [],
      priorExcludedRoutes: [],
      // Normal target offset 0 only, the conversion window 341..342, and Gogma 55..294.
      extent: { maxNormalAdvance: 1, maxGogmaAdvance: 240, maxSkillAdvance: 1 },
      bounds: { maxCandidateTrialsPerTarget: 3, maxPlannerReruns: 3 },
    }, dependencies)
    if (result.status !== 'completed') throw new Error(`Issue #101 kernel failed: ${JSON.stringify(result)}`)
    expect(result.targets.map(({ targetWeaponId }) => targetWeaponId)).toEqual([fixture.fireEntry.targetWeaponId])
    fire = result.targets[0]
    if (fire.outcome.status !== 'found') throw new Error(`Fire outcome: ${fire.outcome.status}`)
    found = fire.outcome
  }, SLOW)

  it('derives the Dragon reservation: Normal 0..206 held with only 206 blocked, Skill 341 and Gogma 55 held and blocked', () => {
    const reservation = derivePlannerAlternativeReservation([fixture.dragonEntry], dependencies.rngEngine)
    expect(reservation).toEqual({
      normal: [{
        counterId: 'weapon.charge_blade:8',
        held: Array.from({ length: 207 }, (_, index) => index),
        blocked: [206],
      }],
      skill: { held: [ISSUE_101_SKILL_COUNTER], blocked: [ISSUE_101_SKILL_COUNTER] },
      gogma: { held: [ISSUE_101_GOGMA_COUNTER], blocked: [ISSUE_101_GOGMA_COUNTER] },
      exclusiveOwnedWeaponIds: [],
    })
    expect(fire.reservation).toEqual(reservation)
    expect(fire.fixedRouteBuildListEntryIds).toEqual([fixture.dragonEntry.id])
    expect(fire.invalidatedBuildListEntryId).toBe(fixture.fireEntry.id)
  })

  it('generates the resource-aware Fire alternative: Normal 0 once, conversion at Skill 342, Bonus operations from Gogma 56', () => {
    const route = found.candidate.route
    const creation = route.operations.find((operation) => operation.type === 'create_normal_artian')
    expect(creation).toMatchObject({ normalCounterBefore: ISSUE_101_NORMAL_COUNTER, normalCounterAfter: 1, count: 1 })
    expect(positions(route.operations, 'skill')).toEqual([ISSUE_101_SKILL_COUNTER + 1])
    const gogma = positions(route.operations, 'gogma')
    expect(gogma[0]).toBeGreaterThanOrEqual(ISSUE_101_GOGMA_COUNTER + 1)
    expect(gogma).not.toContain(ISSUE_101_GOGMA_COUNTER)
    // Coverage: every Gogma position from 56 to the last own operation is an own operation.
    gogma.forEach((position, index) => expect(position).toBe(gogma[0] + index))
    expect(summarizeIssue101Route(route, found.candidate)).toEqual(MEASURED_FIRE_ALTERNATIVE)
    const { fire: fireTarget } = createIssue101Targets()
    expect(satisfiesIdealTarget(
      fireTarget,
      found.candidate.finalBonuses,
      found.candidate.restorationBonusScope,
      found.candidate.seriesSkillId,
      found.candidate.groupSkillId,
      fixture.plannerInput.master,
    )).toBe(true)
  })

  it('measures reach from the Planner-start origin, apart from the own operation count', () => {
    // One own conversion, reaching Skill 343 from 341; 234 own Resets reaching Gogma 290 from 55.
    expect(positions(found.candidate.route.operations, 'skill')).toHaveLength(1)
    expect(found.candidate.estimatedSkillAdvance).toBe(2)
    expect(positions(found.candidate.route.operations, 'gogma')).toHaveLength(234)
    expect(found.candidate.estimatedGogmaAdvance).toBe(235)
    expect(found.candidate.estimatedOperationCount).toBe(1 + 1 + 234)
  })

  it('passes the full Planner trial with Dragon fixed: both selected, no conflict left, formally found', () => {
    expect(found.generatedSelected).toBe(true)
    const plan = found.trialResult.plan!
    expect([...plan.selectedBuildListEntryIds].sort())
      .toEqual([fixture.dragonEntry.id, found.generated.entry.id].sort())
    expect(plan.selectedBuildListEntryIds).not.toContain(fixture.fireEntry.id)
    expect(found.trialResult.conflicts).toEqual([])
    expect(found.trialResult.termination.status).toBe('completed')
    expect(found.replacement).toEqual({
      targetWeaponId: fixture.fireEntry.targetWeaponId,
      replacedBuildListEntryId: fixture.fireEntry.id,
      generatedBuildListEntryId: found.generated.entry.id,
    })
    // The first delivered Candidate is the found one.
    expect(fire.trials).toHaveLength(1)
    expect(fire.search?.stoppedByConsumer).toBe(true)
    // Measured with the current Production runtime: the whole trial Plan.
    expect(plan.steps).toHaveLength(444)
  })

  it('moves no version authority', () => {
    expect(CURRENT_CALCULATION_APP_SCHEMA_VERSION).toBe(16)
    expect(PRODUCTION_RNG_ENGINE_VERSION).toBe('production-rng:c5-e7')
  })
})
