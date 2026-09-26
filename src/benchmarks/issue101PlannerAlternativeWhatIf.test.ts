import { beforeAll, describe, expect, it } from 'vitest'
import {
  createPlannerAlternativeWhatIfComparison,
  createProductionPlannerDependencies,
  defaultPlannerAlternativeTrialBounds,
  type PlannerAlternativeComparison,
  type PlannerAlternativeScenarioOutcome,
} from '../domain/planner'
import type { BuildListEntry } from '../domain/models/publicTypes'
import { ProductionRngEngine } from '../domain/rng/production/productionRngEngine'
import { defaultPlannerAlternativeSearchExtent } from '../domain/search'
import { satisfiesIdealTarget } from '../domain/target'
import {
  createIssue101RealFixture,
  createIssue101Targets,
  ISSUE_101_DRAGON_TARGET_ID,
  ISSUE_101_FIRE_TARGET_ID,
  type Issue101RealFixture,
} from './issue101ConstrainedResearchFixtures'
import { summarizeIssue101Route } from './issue101RouteSummary'

/*
 * Issue #101 Phase 4-B acceptance (PLANNER_SPEC 9.2.19.7 / 9.2.19.8.1 /
 * 9.2.19.13): 「比較する」 on the Normal 206 conflict for each participant, with
 * the Production default extent and trial bounds - the values the Production
 * Worker adapter passes - over the unmodified current Production authorities
 * (`createIssue101RealFixture()`).
 *
 * The expected values below were measured with the current Production RNG
 * implementation (`production-rng:c5-e7`); they are a regression fixture of
 * that runtime, not a game observation. The Fire alternative is the one the
 * Phase 2 acceptance (`issue101PlannerAlternative.test.ts`) already measured.
 */

const SLOW = 240_000

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

describe('Issue #101 Planner Alternative what-if (Phase 4-B)', () => {
  let fixture: Issue101RealFixture
  let preferDragon: PlannerAlternativeComparison
  let preferFire: PlannerAlternativeComparison

  async function compare(selected: BuildListEntry): Promise<PlannerAlternativeComparison> {
    const normal = fixture.initialConflicts.find(({ kind }) => kind === 'same_normal_counter')
    if (!normal) throw new Error('Issue #101 fixture: no Normal conflict.')
    const result = await createPlannerAlternativeWhatIfComparison({
      plannerInput: fixture.plannerInput,
      scenarioResolution: { conflictKey: normal.id, selectedBuildListEntryId: selected.id },
      priorFixedBuildListEntryIds: [],
      priorExcludedRoutes: [],
      extent: { ...defaultPlannerAlternativeSearchExtent },
      bounds: { ...defaultPlannerAlternativeTrialBounds },
    }, createProductionPlannerDependencies(new ProductionRngEngine()))
    if (result.status !== 'completed') throw new Error(`Issue #101 what-if failed: ${JSON.stringify(result)}`)
    return result.comparison
  }

  beforeAll(async () => {
    fixture = await createIssue101RealFixture()
    preferDragon = await compare(fixture.dragonEntry)
    preferFire = await compare(fixture.fireEntry)
  }, SLOW)

  it('prefers Dragon: the Fire alternative is found, adopted, and the scenario is the reused trial Plan', () => {
    expect(preferDragon).toMatchObject({
      fixedBuildListEntryId: fixture.dragonEntry.id,
      fixedTargetWeaponId: ISSUE_101_DRAGON_TARGET_ID,
    })
    expect(preferDragon.alternatives).toHaveLength(1)
    const [fire] = preferDragon.alternatives
    expect(fire).toMatchObject({
      fixedBuildListEntryId: fixture.dragonEntry.id,
      alternativeTargetWeaponId: ISSUE_101_FIRE_TARGET_ID,
      excludedByRepairLineageCount: 0,
    })
    if (fire.outcome.status !== 'found') throw new Error(`Fire outcome: ${fire.outcome.status}`)
    expect(fire.outcome.adoptedInScenario).toBe(true)
    expect(summarizeIssue101Route(fire.outcome.alternative.route, fire.outcome.distance)).toEqual(MEASURED_FIRE_ALTERNATIVE)
    expect(fire.outcome.distance).toEqual({
      estimatedOperationCount: 236,
      estimatedGogmaAdvance: 235,
      estimatedSkillAdvance: 2,
      estimatedNormalAdvance: 1,
    })
    // The Route summary carries the finished result, observational traces included.
    const summary = fire.outcome.alternative
    expect(summary.conversionSkillTrace).not.toBeNull()
    expect(summary.bonusAmendmentTrace).toHaveLength(234)
    expect(satisfiesIdealTarget(
      createIssue101Targets().fire,
      summary.finalBonuses,
      summary.restorationBonusScope,
      summary.seriesSkillId,
      summary.groupSkillId,
      fixture.plannerInput.master,
    )).toBe(true)
    // Measured with the current Production runtime: the whole scenario Plan
    // (the Phase 2 trial Plan, reused), not 236 + Dragon's own estimate.
    expect(preferDragon.scenario).toEqual({
      status: 'evaluated',
      scenarioOperationCount: 444,
      unplannedTargetWeaponIds: [],
      introducedConflicts: [],
      remainingConflicts: [],
    } satisfies PlannerAlternativeScenarioOutcome)
  })

  it('prefers Fire: no Dragon alternative inside the extent, and the scenario keeps Dragon unplanned with its conflicts decided', () => {
    expect(preferFire).toMatchObject({
      fixedBuildListEntryId: fixture.fireEntry.id,
      fixedTargetWeaponId: ISSUE_101_FIRE_TARGET_ID,
    })
    expect(preferFire.alternatives).toEqual([{
      fixedBuildListEntryId: fixture.fireEntry.id,
      fixedTargetWeaponId: ISSUE_101_FIRE_TARGET_ID,
      alternativeTargetWeaponId: ISSUE_101_DRAGON_TARGET_ID,
      outcome: { status: 'stopped_by_search_extent_bound' },
      excludedByRepairLineageCount: 0,
    }])
    // Found = 0: the one scenario run without replacement. Dragon's remaining
    // Skill 341 / Gogma 55 conflicts with Fire are the decision's own
    // (9.2.19.9), so none is left as an unresolved remaining conflict.
    expect(preferFire.scenario).toEqual({
      status: 'evaluated',
      scenarioOperationCount: 209,
      unplannedTargetWeaponIds: [ISSUE_101_DRAGON_TARGET_ID],
      introducedConflicts: [],
      remainingConflicts: [],
    } satisfies PlannerAlternativeScenarioOutcome)
  })

  it('lets the two scenarios be compared by their provisional whole-Plan step counts', () => {
    if (preferDragon.scenario.status !== 'evaluated' || preferFire.scenario.status !== 'evaluated') {
      throw new Error('expected both scenarios evaluated')
    }
    // Read together with the unplanned Targets: preferring Fire completes Dragon nowhere.
    expect([preferDragon.scenario.scenarioOperationCount, preferFire.scenario.scenarioOperationCount]).toEqual([444, 209])
    expect(preferFire.scenario.unplannedTargetWeaponIds).toEqual([ISSUE_101_DRAGON_TARGET_ID])
  })
})
