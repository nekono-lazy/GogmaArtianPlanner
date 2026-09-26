import { describe, expect, it } from 'vitest'
import {
  belowPracticalBonuses,
  idealBonuses,
  practicalBonuses,
} from '../../../test/fixtures/constrainedEnumeration'
import {
  ORCHESTRATION_SOURCE_A,
  ORCHESTRATION_SOURCE_B,
  orchestrationEntry,
  orchestrationResetResultAt,
  orchestrationScenario,
  orchestrationSource,
  orchestrationTarget,
  resetRoute,
  resetSkillsRoute,
  skillConstrainedTarget,
  type OrchestrationScenario,
} from '../../../test/fixtures/plannerConstrainedOrchestration'
import type {
  BuildListEntry,
  BuildListEntryId,
  OwnedWeapon,
  PlannerConflictRepairLineage,
  RestorationBonusSet,
  TargetWeapon,
  TargetWeaponId,
} from '../../models/publicTypes'
import { candidateStableKey } from '../../search'
import { preparePlannerInitialContext } from '../plannerInitialContext'
import { runPlannerAlternativeKernel } from './plannerAlternativeKernel'
import {
  createPlannerAlternativeRepair,
  type PlannerAlternativeRepairArtifact,
  type PlannerAlternativeRepairCalculationResult,
  type PlannerAlternativeRepairRequest,
} from './plannerAlternativeRepair'
import { createPlannerAlternativeWhatIfComparison } from './plannerAlternativeWhatIf'
import { derivePlannerConflictRepairLineageContext } from './plannerConflictRepairLineage'

/*
 * The Phase 5-A actual repair end to end over the real kernel, Planner
 * Alternative Search, materializer, replacement preflight and Production Plan
 * generation (deterministic scheduler + Trace Replay). Only the Fake RNG
 * Engine, the ID factory and the Clock are injected. The composition rules are
 * counted in `plannerAlternativeRepair.composition.test.ts`.
 */

const TARGET_A = 'target.repair.a' as TargetWeaponId
const TARGET_B = 'target.repair.b' as TargetWeaponId
const TARGET_C = 'target.repair.c' as TargetWeaponId
const SOURCE_C = 'owned.repair.c'
const ENTRY_A = 'build-list.repair.a' as BuildListEntryId
const ENTRY_B = 'build-list.repair.b' as BuildListEntryId
const ENTRY_C = 'build-list.repair.c' as BuildListEntryId
const SOURCE_A_SKILL = 'series_skill.fixture.z'
const SOURCE_B_SKILL = 'series_skill.fixture.b-source'
const SOURCE_C_SKILL = 'series_skill.fixture.c-source'

function ownSkillTarget(id: string, seriesSkillId: string, priority: TargetWeapon['priority']): TargetWeapon {
  const skill = { seriesSkillId, groupSkillId: null, matchMode: 'all' as const }
  return orchestrationTarget(id, { priority, idealSkillCondition: skill, practicalSkillCondition: skill })
}

interface Parts {
  targets: TargetWeapon[]
  ownedWeapons: OwnedWeapon[]
  entries: BuildListEntry[]
}

/** A and B contend for Gogma 10; with A fixed, B's alternative Resets at 11 and 12. */
function parts(): Parts {
  const a = ownSkillTarget(TARGET_A, SOURCE_A_SKILL, 5)
  const b = skillConstrainedTarget(TARGET_B, { priority: 1 })
  return {
    targets: [a, b],
    ownedWeapons: [
      orchestrationSource(ORCHESTRATION_SOURCE_A, { seriesSkillId: SOURCE_A_SKILL }),
      orchestrationSource(ORCHESTRATION_SOURCE_B, { restorationBonuses: belowPracticalBonuses(), seriesSkillId: SOURCE_B_SKILL }),
    ],
    entries: [
      orchestrationEntry(ENTRY_A, a, resetRoute(ORCHESTRATION_SOURCE_A), { finalBonuses: idealBonuses(), seriesSkillId: SOURCE_A_SKILL }),
      orchestrationEntry(ENTRY_B, b, {
        kind: 'existing_gogma_mixed',
        sourceOwnedWeaponId: resetRoute(ORCHESTRATION_SOURCE_B).sourceOwnedWeaponId,
        operations: [...resetRoute(ORCHESTRATION_SOURCE_B).operations, ...resetSkillsRoute(ORCHESTRATION_SOURCE_B).operations],
      }),
    ],
  }
}

/**
 * Target C, higher priority than B and outside every decision, Resets at
 * Gogma 11 and 12, where B's alternative ends: B2 does not conflict with the
 * fixed A but with C, and loses that new conflict's provisional outcome.
 */
function withUnfixedC(base: Parts): Parts {
  const c = ownSkillTarget(TARGET_C, SOURCE_C_SKILL, 4)
  const source = resetRoute(SOURCE_C).sourceOwnedWeaponId
  return {
    targets: [...base.targets, c],
    ownedWeapons: [...base.ownedWeapons, orchestrationSource(SOURCE_C, { seriesSkillId: SOURCE_C_SKILL })],
    entries: [...base.entries, orchestrationEntry(ENTRY_C, c, {
      kind: 'existing_gogma_reset_bonuses',
      sourceOwnedWeaponId: source,
      operations: [...resetRoute(SOURCE_C, 11).operations, ...resetRoute(SOURCE_C, 12).operations],
    }, { seriesSkillId: SOURCE_C_SKILL })],
  }
}

function scenario(p: Parts, resetResultAt?: (gogmaCounter: number) => RestorationBonusSet): OrchestrationScenario {
  return orchestrationScenario({
    targets: p.targets,
    ownedWeapons: p.ownedWeapons,
    entries: p.entries.map((entry) => structuredClone(entry)),
    engine: resetResultAt ? { resetResultAt } : undefined,
  })
}

function gogmaConflictKey(built: OrchestrationScenario): string {
  const prepared = preparePlannerInitialContext(built.input, built.dependencies)
  if (prepared.status !== 'ready') throw new Error('fixture not ready')
  const conflict = prepared.context.initialConflictDetection.conflicts.find(({ kind, buildListEntryIds }) =>
    kind === 'same_gogma_counter' && buildListEntryIds.includes(ENTRY_A) && buildListEntryIds.includes(ENTRY_B))
  if (!conflict) throw new Error('no Gogma conflict between A and B')
  return conflict.id
}

function request(built: OrchestrationScenario, overrides: Partial<PlannerAlternativeRepairRequest> = {}): PlannerAlternativeRepairRequest {
  return {
    plannerInput: built.input,
    decision: { conflictKey: gogmaConflictKey(built), selectedBuildListEntryId: ENTRY_A },
    lineage: null,
    extent: { maxNormalAdvance: 1, maxGogmaAdvance: 5, maxSkillAdvance: 2 },
    bounds: { maxCandidateTrialsPerTarget: 4, maxPlannerReruns: 8 },
    ...overrides,
  }
}

type CompletedRepair = Extract<PlannerAlternativeRepairCalculationResult, { status: 'completed' }>

async function repair(built: OrchestrationScenario, overrides: Partial<PlannerAlternativeRepairRequest> = {}): Promise<CompletedRepair> {
  const result = await createPlannerAlternativeRepair(request(built, overrides), built.dependencies)
  if (result.status !== 'completed') throw new Error(`repair failed: ${JSON.stringify(result)}`)
  return result
}

function artifactOf(result: CompletedRepair): PlannerAlternativeRepairArtifact {
  if (result.persistence.status !== 'persistable') throw new Error(`not persistable: ${result.persistence.reason}`)
  return result.persistence.artifact
}

/** The what-if over the same request, lineage context derived by the same helper. */
async function whatIf(built: OrchestrationScenario, overrides: Partial<PlannerAlternativeRepairRequest> = {}) {
  const req = request(built, overrides)
  const context = derivePlannerConflictRepairLineageContext(req.lineage, req.plannerInput.buildListEntries)
  const result = await createPlannerAlternativeWhatIfComparison({
    plannerInput: req.plannerInput,
    scenarioResolution: req.decision,
    priorFixedBuildListEntryIds: context.priorFixedBuildListEntryIds,
    priorExcludedRoutes: context.priorExcludedRoutes,
    extent: req.extent,
    bounds: req.bounds,
  }, built.dependencies)
  if (result.status !== 'completed') throw new Error(`what-if failed: ${JSON.stringify(result)}`)
  return result.comparison
}

const noIdeal = (gogmaCounter: number) => (gogmaCounter === 10 ? idealBonuses() : practicalBonuses())
/** Ideal again at Gogma 14, so B has a second, costlier alternative. */
const twoIdeals = (gogmaCounter: number) =>
  gogmaCounter === 14 ? idealBonuses() : orchestrationResetResultAt(gogmaCounter)

describe('Planner Alternative actual repair over the real kernel (PLANNER_SPEC 9.2.19.8)', () => {
  it('returns the what-if comparison and a savable artifact whose Plan is the scenario Plan', async () => {
    const built = scenario(parts())
    const result = await repair(built)
    const artifact = artifactOf(result)
    const b = result.comparison.alternatives[0]
    if (b.outcome.status !== 'found') throw new Error('expected found')
    expect(b.outcome.adoptedInScenario).toBe(true)
    if (result.comparison.scenario.status !== 'evaluated') throw new Error('expected evaluated')
    expect(artifact.plannerResult.plan.steps).toHaveLength(result.comparison.scenario.scenarioOperationCount)
    const [generated] = artifact.generatedBuildListEntries
    expect(artifact.generatedBuildListEntries).toHaveLength(1)
    expect(generated.targetWeaponId).toBe(TARGET_B)
    expect(artifact.plannerResult.plan.selectedBuildListEntryIds).toEqual(expect.arrayContaining([ENTRY_A, generated.id]))
    expect(artifact.plannerResult.plan.selectedBuildListEntryIds).not.toContain(ENTRY_B)
    expect(artifact.plannerResult.plan.conflicts).toEqual(artifact.plannerResult.conflicts)
    expect(artifact.generatedBuildListEntryReplacements).toEqual([
      { targetWeaponId: TARGET_B, replacedBuildListEntryId: ENTRY_B, generatedBuildListEntryId: generated.id },
    ])
    expect(artifact.conflictRepairLineage).toEqual({
      decisions: [{
        conflictKind: 'same_gogma_counter',
        fixedBuildListEntryId: ENTRY_A,
        fixedTargetWeaponId: TARGET_A,
        invalidatedRoutes: [{
          targetWeaponId: TARGET_B,
          invalidatedBuildListEntryId: ENTRY_B,
          invalidatedRouteKey: candidateStableKey(built.input.buildListEntries.find(({ id }) => id === ENTRY_B)!.candidateSnapshot),
          replacementBuildListEntryId: generated.id,
          outcome: 'replaced',
        }],
      }],
    })
    expect(structuredClone(result)).toEqual(result)
  })

  it('keeps an accepted replacement the final Plan leaves unselected: it is saved and recorded as replaced', async () => {
    const built = scenario(withUnfixedC(parts()))
    const result = await repair(built)
    const b = result.comparison.alternatives[0]
    if (b.outcome.status !== 'found') throw new Error('expected found')
    expect(b.outcome.adoptedInScenario).toBe(true)
    const artifact = artifactOf(result)
    const [generated] = artifact.generatedBuildListEntries
    expect(generated.targetWeaponId).toBe(TARGET_B)
    // B2 lost the new B2 vs C conflict's provisional outcome: C is selected, B2 is not.
    const plan = artifact.plannerResult.plan
    expect(plan.selectedBuildListEntryIds).toEqual(expect.arrayContaining([ENTRY_A, ENTRY_C]))
    expect(plan.selectedBuildListEntryIds).not.toContain(generated.id)
    expect(plan.conflicts.some(({ buildListEntryIds, selectedBuildListEntryId }) =>
      selectedBuildListEntryId === null && buildListEntryIds.includes(generated.id) && buildListEntryIds.includes(ENTRY_C))).toBe(true)
    expect(artifact.generatedBuildListEntryReplacements).toEqual([
      { targetWeaponId: TARGET_B, replacedBuildListEntryId: ENTRY_B, generatedBuildListEntryId: generated.id },
    ])
    expect(artifact.conflictRepairLineage.decisions[0].invalidatedRoutes).toEqual([
      expect.objectContaining({ targetWeaponId: TARGET_B, replacementBuildListEntryId: generated.id, outcome: 'replaced' }),
    ])
    expect(result.comparison.scenario).toMatchObject({
      status: 'evaluated',
      unplannedTargetWeaponIds: [TARGET_B],
      introducedConflicts: [expect.objectContaining({ participantTargetWeaponIds: [TARGET_B, TARGET_C], resolved: false })],
    })
  })

  it('saves a Plan without replacement when no alternative is found, leaving the invalidated Entry in place', async () => {
    const built = scenario(parts(), noIdeal)
    const result = await repair(built, { extent: { maxNormalAdvance: 1, maxGogmaAdvance: 3, maxSkillAdvance: 2 } })
    const artifact = artifactOf(result)
    expect(artifact.generatedBuildListEntries).toEqual([])
    expect(artifact.generatedBuildListEntryReplacements).toEqual([])
    expect(artifact.conflictRepairLineage.decisions[0].invalidatedRoutes).toEqual([
      expect.objectContaining({ targetWeaponId: TARGET_B, invalidatedBuildListEntryId: ENTRY_B, replacementBuildListEntryId: null, outcome: 'stopped_by_search_extent_bound' }),
    ])
    expect(artifact.plannerResult.plan.selectedBuildListEntryIds).toContain(ENTRY_A)
  })

  it('persists nothing and leaves its input untouched', async () => {
    const built = scenario(parts())
    const before = structuredClone(built.input)
    await repair(built)
    expect(built.input).toEqual(before)
  })
})

describe('Planner Alternative actual repair and what-if: the same semantics (PLANNER_SPEC 9.2.19.8)', () => {
  it.each([
    ['one found alternative', () => scenario(parts()), {}],
    ['an accepted alternative left unselected', () => scenario(withUnfixedC(parts())), {}],
    ['no alternative', () => scenario(parts(), noIdeal), { extent: { maxNormalAdvance: 1, maxGogmaAdvance: 3, maxSkillAdvance: 2 } }],
    ['a spent rerun budget', () => scenario(parts()), { bounds: { maxCandidateTrialsPerTarget: 4, maxPlannerReruns: 1 } }],
  ] as const)('matches the what-if comparison: %s', async (_name, build, overrides) => {
    const repaired = await repair(build(), overrides)
    expect(repaired.comparison).toEqual(await whatIf(build(), overrides))
  })

  it('matches the what-if comparison under a prior lineage too', async () => {
    const prior = await priorLineageExcludingFirstAlternative()
    const lineage: PlannerConflictRepairLineage = { decisions: prior.decisions }
    const repaired = await repair(scenario(parts(), twoIdeals), { lineage })
    expect(repaired.comparison).toEqual(await whatIf(scenario(parts(), twoIdeals), { lineage }))
  })
})

/**
 * A lineage in which an earlier decision (A fixed) replaced B's former Entry
 * by the current `ENTRY_B`, and in which B's first alternative is recorded as
 * a Route that decision invalidated.
 */
async function priorLineageExcludingFirstAlternative(): Promise<PlannerConflictRepairLineage & { firstRoute: unknown }> {
  const built = scenario(parts(), twoIdeals)
  const kernel = await runPlannerAlternativeKernel({
    plannerInput: built.input,
    decision: request(built).decision,
    priorFixedBuildListEntryIds: [],
    priorExcludedRoutes: [],
    extent: request(built).extent,
    bounds: request(built).bounds,
  }, built.dependencies)
  if (kernel.status !== 'completed' || kernel.targets[0].outcome.status !== 'found') throw new Error('expected a first alternative')
  return {
    firstRoute: kernel.targets[0].outcome.candidate.route,
    decisions: [{
      conflictKind: 'same_gogma_counter',
      fixedBuildListEntryId: ENTRY_A,
      fixedTargetWeaponId: TARGET_A,
      invalidatedRoutes: [{
        targetWeaponId: TARGET_B,
        invalidatedBuildListEntryId: 'build-list.repair.b-former' as BuildListEntryId,
        invalidatedRouteKey: candidateStableKey(kernel.targets[0].outcome.candidate),
        replacementBuildListEntryId: ENTRY_B,
        outcome: 'replaced',
      }],
    }],
  }
}

describe('Planner Alternative actual repair: lineage (PLANNER_SPEC 9.2.19.10 / 9.2.19.11)', () => {
  it('never re-adopts a Route the lineage invalidated, and appends this decision after the still valid one', async () => {
    const { firstRoute, ...lineage } = await priorLineageExcludingFirstAlternative()
    const result = await repair(scenario(parts(), twoIdeals), { lineage })
    const b = result.comparison.alternatives[0]
    if (b.outcome.status !== 'found') throw new Error('expected found')
    expect(b.excludedByRepairLineageCount).toBe(1)
    expect(b.outcome.alternative.route).not.toEqual(firstRoute)
    const artifact = artifactOf(result)
    expect(artifact.conflictRepairLineage.decisions).toHaveLength(2)
    expect(artifact.conflictRepairLineage.decisions[0]).toEqual(lineage.decisions[0])
    expect(artifact.conflictRepairLineage.decisions[1]).toMatchObject({
      fixedBuildListEntryId: ENTRY_A,
      invalidatedRoutes: [expect.objectContaining({ invalidatedBuildListEntryId: ENTRY_B, outcome: 'replaced' })],
    })
  })

  it('drops an expired Target record: the Route is searchable again and the record is not carried', async () => {
    const { firstRoute, ...lineage } = await priorLineageExcludingFirstAlternative()
    // The lineage last left B on another Entry; B's current Entry changed by hand.
    lineage.decisions[0].invalidatedRoutes[0].replacementBuildListEntryId = 'build-list.repair.b-other' as BuildListEntryId
    const result = await repair(scenario(parts(), twoIdeals), { lineage })
    const b = result.comparison.alternatives[0]
    if (b.outcome.status !== 'found') throw new Error('expected found')
    expect(b.excludedByRepairLineageCount).toBe(0)
    expect(b.outcome.alternative.route).toEqual(firstRoute)
    const artifact = artifactOf(result)
    // A is still in the Build List and not invalidated since: its decision stays, without B's record.
    expect(artifact.conflictRepairLineage.decisions[0]).toEqual({ ...lineage.decisions[0], invalidatedRoutes: [] })
    expect(artifact.conflictRepairLineage.decisions).toHaveLength(2)
  })

  it('refuses a lineage fixed Entry the current input no longer validates, with no artifact', async () => {
    const built = scenario(withUnfixedC(parts()))
    // C stays in the Build List but is no valid Entry of this input any more.
    const c = built.input.buildListEntries.find(({ id }) => id === ENTRY_C)!
    c.calculationContext = { ...c.calculationContext, rngEngineVersion: 'fake-rng:other' }
    const result = await createPlannerAlternativeRepair(request(built, {
      lineage: {
        decisions: [{ conflictKind: 'same_gogma_counter', fixedBuildListEntryId: ENTRY_C, fixedTargetWeaponId: TARGET_C, invalidatedRoutes: [] }],
      },
    }), built.dependencies)
    expect(result).toMatchObject({ status: 'invalid_prior_fixed_entry', buildListEntryId: ENTRY_C })
    expect(result).not.toHaveProperty('persistence')
  })
})

describe('Planner Alternative actual repair: fail closed', () => {
  it('passes an invalid decision through as the typed preparation failure, with no artifact', async () => {
    const built = scenario(parts())
    const result = await createPlannerAlternativeRepair(
      request(built, { decision: { conflictKey: 'conflict.missing', selectedBuildListEntryId: ENTRY_A } }),
      built.dependencies,
    )
    expect(result.status).toBe('invalid_fixed_resolution')
    expect(result).not.toHaveProperty('persistence')
  })

  it('takes no default for missing extent and bounds', async () => {
    const built = scenario(parts())
    await expect(createPlannerAlternativeRepair(
      { ...request(built), extent: undefined as never },
      built.dependencies,
    )).rejects.toThrow()
    await expect(createPlannerAlternativeRepair(
      { ...request(built), bounds: { maxCandidateTrialsPerTarget: 2 } as never },
      built.dependencies,
    )).rejects.toThrow()
  })
})
