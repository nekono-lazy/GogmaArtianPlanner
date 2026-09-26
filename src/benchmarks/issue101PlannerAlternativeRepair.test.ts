import Dexie from 'dexie'
import { beforeAll, describe, expect, it } from 'vitest'
import { AppDatabase } from '../db/AppDatabase'
import {
  PlannerResultPersistenceService,
  createPlannerResultPersistenceRepositories,
} from '../services/planner/plannerResultPersistenceService'
import {
  createPlannerAlternativeRepair,
  createProductionPlannerDependencies,
  defaultPlannerAlternativeTrialBounds,
  type PlannerAlternativeRepairArtifact,
  type PlannerAlternativeRepairCalculationResult,
  type PlannerAlternativeScenarioOutcome,
} from '../domain/planner'
import type { BuildListEntry } from '../domain/models/publicTypes'
import { ProductionRngEngine } from '../domain/rng/production/productionRngEngine'
import { candidateStableKey, defaultPlannerAlternativeSearchExtent } from '../domain/search'
import {
  createIssue101RealFixture,
  ISSUE_101_DRAGON_TARGET_ID,
  ISSUE_101_FIRE_TARGET_ID,
  type Issue101RealFixture,
} from './issue101ConstrainedResearchFixtures'
import { summarizeIssue101Route } from './issue101RouteSummary'

/*
 * Issue #101 Phase 5-A acceptance (PLANNER_SPEC 9.2.19.8 / 9.2.19.8.1 /
 * 9.2.19.9 / 9.2.19.11): 「この候補を優先」 as the pure actual repair on the
 * Normal 206 conflict, with the Production default extent and trial bounds,
 * over the unmodified current Production authorities
 * (`createIssue101RealFixture()`). The pure calculation persists nothing; the
 * Phase 5-B cases at the end hand its artifact to the real Persistence
 * service over a Dexie database seeded with the fixture state.
 *
 * The expected values were measured with the current Production RNG
 * implementation (`production-rng:c5-e7`); they are a regression fixture of
 * that runtime, not a game observation. They are the Phase 4-B what-if values
 * (`issue101PlannerAlternativeWhatIf.test.ts`), because the actual repair is
 * the same scenario calculation.
 */

const SLOW = 240_000

type CompletedRepair = Extract<PlannerAlternativeRepairCalculationResult, { status: 'completed' }>

function artifactOf(result: CompletedRepair): PlannerAlternativeRepairArtifact {
  if (result.persistence.status !== 'persistable') throw new Error(`not persistable: ${result.persistence.reason}`)
  return result.persistence.artifact
}

describe('Issue #101 Planner Alternative actual repair (Phase 5-A)', () => {
  let fixture: Issue101RealFixture
  let preferDragon: CompletedRepair
  let preferFire: CompletedRepair

  async function repair(selected: BuildListEntry): Promise<CompletedRepair> {
    const normal = fixture.initialConflicts.find(({ kind }) => kind === 'same_normal_counter')
    if (!normal) throw new Error('Issue #101 fixture: no Normal conflict.')
    const result = await createPlannerAlternativeRepair({
      plannerInput: fixture.plannerInput,
      decision: { conflictKey: normal.id, selectedBuildListEntryId: selected.id },
      lineage: null,
      extent: { ...defaultPlannerAlternativeSearchExtent },
      bounds: { ...defaultPlannerAlternativeTrialBounds },
    }, createProductionPlannerDependencies(new ProductionRngEngine()))
    if (result.status !== 'completed') throw new Error(`Issue #101 repair failed: ${JSON.stringify(result)}`)
    return result
  }

  beforeAll(async () => {
    fixture = await createIssue101RealFixture()
    preferDragon = await repair(fixture.dragonEntry)
    preferFire = await repair(fixture.fireEntry)
  }, SLOW)

  it('prefers Dragon: the Fire alternative is found and accepted, and the repair is savable', () => {
    const [fire] = preferDragon.comparison.alternatives
    expect(preferDragon.comparison.alternatives).toHaveLength(1)
    if (fire.outcome.status !== 'found') throw new Error(`Fire outcome: ${fire.outcome.status}`)
    expect(fire.outcome.adoptedInScenario).toBe(true)
    expect(summarizeIssue101Route(fire.outcome.alternative.route, fire.outcome.distance)).toMatchObject({
      kind: 'normal_artian_to_gogma',
      operationCount: 236,
      normalForgeCount: 1,
      normalCounterBefore: 0,
      conversionSkillCounter: 342,
      firstGogmaCounter: 56,
      lastGogmaCounter: 289,
    })
    expect(preferDragon.comparison.scenario).toEqual({
      status: 'evaluated',
      scenarioOperationCount: 444,
      unplannedTargetWeaponIds: [],
      introducedConflicts: [],
      remainingConflicts: [],
    } satisfies PlannerAlternativeScenarioOutcome)

    const artifact = artifactOf(preferDragon)
    const plan = artifact.plannerResult.plan
    expect(plan.steps).toHaveLength(444)
    expect(artifact.generatedBuildListEntries).toHaveLength(1)
    const [generated] = artifact.generatedBuildListEntries
    expect(generated.targetWeaponId).toBe(ISSUE_101_FIRE_TARGET_ID)
    expect(plan.selectedBuildListEntryIds).toEqual(expect.arrayContaining([fixture.dragonEntry.id, generated.id]))
    expect(plan.selectedBuildListEntryIds).not.toContain(fixture.fireEntry.id)
    expect(artifact.generatedBuildListEntryReplacements).toEqual([{
      targetWeaponId: ISSUE_101_FIRE_TARGET_ID,
      replacedBuildListEntryId: fixture.fireEntry.id,
      generatedBuildListEntryId: generated.id,
    }])
    expect(artifact.plannerResult.conflicts).toEqual(plan.conflicts)
    expect(artifact.conflictRepairLineage).toEqual({
      decisions: [{
        conflictKind: 'same_normal_counter',
        fixedBuildListEntryId: fixture.dragonEntry.id,
        fixedTargetWeaponId: ISSUE_101_DRAGON_TARGET_ID,
        invalidatedRoutes: [{
          targetWeaponId: ISSUE_101_FIRE_TARGET_ID,
          invalidatedBuildListEntryId: fixture.fireEntry.id,
          invalidatedRouteKey: candidateStableKey(fixture.fireEntry.candidateSnapshot),
          replacementBuildListEntryId: generated.id,
          outcome: 'replaced',
        }],
      }],
    })
  })

  it('prefers Fire: no Dragon alternative, the Plan keeps Dragon unplanned and saves its conflicts with Fire as decided', () => {
    expect(preferFire.comparison.alternatives.map(({ outcome }) => outcome)).toEqual([{ status: 'stopped_by_search_extent_bound' }])
    expect(preferFire.comparison.scenario).toEqual({
      status: 'evaluated',
      scenarioOperationCount: 209,
      unplannedTargetWeaponIds: [ISSUE_101_DRAGON_TARGET_ID],
      introducedConflicts: [],
      remainingConflicts: [],
    } satisfies PlannerAlternativeScenarioOutcome)

    const artifact = artifactOf(preferFire)
    expect(artifact.plannerResult.plan.steps).toHaveLength(209)
    expect(artifact.generatedBuildListEntries).toEqual([])
    expect(artifact.generatedBuildListEntryReplacements).toEqual([])
    // Every Fire vs Dragon conflict - the decided Normal one and Dragon's own
    // Skill / Gogma ones the decision expands to - is saved as decided for Fire.
    const fireDragon = artifact.plannerResult.conflicts.filter(({ buildListEntryIds }) =>
      buildListEntryIds.includes(fixture.fireEntry.id) && buildListEntryIds.includes(fixture.dragonEntry.id))
    expect(fireDragon.length).toBeGreaterThan(1)
    expect(fireDragon.every(({ selectedBuildListEntryId }) => selectedBuildListEntryId === fixture.fireEntry.id)).toBe(true)
    expect(artifact.plannerResult.plan.conflicts).toEqual(artifact.plannerResult.conflicts)
    expect(artifact.conflictRepairLineage.decisions).toEqual([{
      conflictKind: 'same_normal_counter',
      fixedBuildListEntryId: fixture.fireEntry.id,
      fixedTargetWeaponId: ISSUE_101_FIRE_TARGET_ID,
      invalidatedRoutes: [{
        targetWeaponId: ISSUE_101_DRAGON_TARGET_ID,
        invalidatedBuildListEntryId: fixture.dragonEntry.id,
        invalidatedRouteKey: candidateStableKey(fixture.dragonEntry.candidateSnapshot),
        replacementBuildListEntryId: null,
        outcome: 'stopped_by_search_extent_bound',
      }],
    }])
  })

  /** Saves one artifact through the real Persistence service over the fixture state (Phase 5-B). */
  async function saveOverFixtureState(artifact: PlannerAlternativeRepairArtifact) {
    const name = `issue101-repair-persistence-${Math.random().toString(36).slice(2)}`
    const database = new AppDatabase(name)
    await database.open()
    try {
      const seedRepositories = createPlannerResultPersistenceRepositories(database)
      const input = fixture.plannerInput
      await seedRepositories.rngState.putRngState(input.rngState)
      for (const counter of input.normalCounters) await seedRepositories.normalCounters.putNormalArtianCounter(counter)
      for (const weapon of input.ownedWeapons) await seedRepositories.ownedWeapons.putOwnedWeapon(weapon)
      for (const target of input.targetWeapons) await seedRepositories.targetWeapons.putTargetWeapon(target)
      for (const entry of input.buildListEntries) await seedRepositories.buildListEntries.putBuildListEntry(entry)
      const service = new PlannerResultPersistenceService(database)
      const inspection = await service.inspectPlannerAlternativeRepairSave(artifact, input.calculationContext)
      const outcome = await service.savePlannerAlternativeRepair(artifact, input.calculationContext)
      return {
        inspection,
        outcome,
        entryIds: (await database.buildListEntries.toArray()).map(({ id }) => id).sort(),
        plans: await database.productionPlans.toArray(),
      }
    } finally {
      database.close()
      await Dexie.delete(name)
    }
  }

  it('Phase 5-B: the prefer-Dragon artifact saves the Fire replacement and a Draft carrying the lineage', async () => {
    const artifact = artifactOf(preferDragon)
    const saved = await saveOverFixtureState(artifact)
    const [generated] = artifact.generatedBuildListEntries
    // No running Plan depends on the Fire Entry, so no approval is needed.
    expect(saved.inspection).toEqual({ approvalRequired: false })
    expect(saved.outcome).toMatchObject({ kind: 'saved', plan: { id: artifact.plannerResult.plan.id, status: 'draft' } })
    expect(saved.entryIds).toEqual([fixture.dragonEntry.id, generated.id].sort())
    expect(saved.plans).toHaveLength(1)
    expect(saved.plans[0].steps).toHaveLength(444)
    expect(saved.plans[0].conflictRepairLineage).toEqual(artifact.conflictRepairLineage)
  }, SLOW)

  it('Phase 5-B: the prefer-Fire artifact keeps both Entries and saves the Draft with its decided conflicts and lineage', async () => {
    const artifact = artifactOf(preferFire)
    const saved = await saveOverFixtureState(artifact)
    expect(saved.outcome.kind).toBe('saved')
    expect(saved.entryIds).toEqual([fixture.dragonEntry.id, fixture.fireEntry.id].sort())
    expect(saved.plans[0].steps).toHaveLength(209)
    expect(saved.plans[0].conflicts).toEqual(artifact.plannerResult.conflicts)
    expect(saved.plans[0].conflictRepairLineage).toEqual(artifact.conflictRepairLineage)
  }, SLOW)
})
