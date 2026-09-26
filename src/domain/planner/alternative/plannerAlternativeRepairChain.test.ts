import { describe, expect, it } from 'vitest'
import {
  belowPracticalBonuses,
  IDEAL_SERIES_SKILL_ID,
  idealBonuses,
  practicalBonuses,
} from '../../../test/fixtures/constrainedEnumeration'
import {
  orchestrationEntry,
  orchestrationScenario,
  orchestrationSource,
  orchestrationTarget,
  resetRoute,
  resetSkillsRoute,
  skillConstrainedTarget,
  type OrchestrationScenario,
} from '../../../test/fixtures/plannerConstrainedOrchestration'
import type {
  BuildListEntryId,
  PlannerConflictRepairLineage,
  TargetWeapon,
  TargetWeaponId,
} from '../../models/publicTypes'
import { candidateStableKey } from '../../search'
import { preparePlannerInitialContext } from '../plannerInitialContext'
import type { PlannerConflictResolution } from '../plannerTypes'
import type { PlannerAlternativeComparison } from './plannerAlternativeComparison'
import {
  preparePlannerAlternativeKernel,
  runPlannerAlternativeKernel,
  type PlannerAlternativeKernelRequest,
} from './plannerAlternativeKernel'
import {
  createPlannerAlternativeRepair,
  type PlannerAlternativeRepairArtifact,
  type PlannerAlternativeRepairCalculationResult,
} from './plannerAlternativeRepair'
import { createPlannerAlternativeWhatIfComparison } from './plannerAlternativeWhatIf'
import { derivePlannerConflictRepairLineageContext } from './plannerConflictRepairLineage'

/*
 * A real repair chain (`docs/PLANNER_SPEC.md` 9.2.19.11, the latest decision
 * wins), over the real kernel, Planner Alternative Search, materializer,
 * preflights and Production Plan generation with the Fake RNG Engine:
 *
 * ```text
 * earlier decision 1   Conflict W (Skill 8):  E preferred over F   -> W -> E restored, E prior fixed
 * earlier decision 2   Conflict X (Skill 7):  D preferred over Z   -> X -> D restored, D prior fixed
 * this decision        Conflict Y (Gogma 10): A preferred over D   -> D's current Route loses
 * ```
 *
 * D's alternative D2 (Reset 11, Reset 12, Reset Skills 7) exists only once the
 * restored `X -> D` is superseded: kept, it would still demand D's current Route.
 * `W -> E` is unrelated to this decision and stays a fixed choice.
 */

const target = (id: string) => `target.chain.${id}` as TargetWeaponId
const entry = (id: string) => `build-list.chain.${id}` as BuildListEntryId
const source = (id: string) => `owned.chain.${id}`
const OWN_SKILL = (id: string) => `series_skill.fixture.chain-${id}`
/** E and F's own Ideal Series Skill, drawn at Skill 8, so no weapon of D or Z satisfies them. */
const SKILL_8 = 'series_skill.fixture.chain-s8'

const A = { target: target('a'), entry: entry('a'), source: source('a') }
const D = { target: target('d'), entry: entry('d'), source: source('d') }
const Z = { target: target('z'), entry: entry('z'), source: source('z') }
const E = { target: target('e'), entry: entry('e'), source: source('e') }
const F = { target: target('f'), entry: entry('f'), source: source('f') }

/** Target A: its source's own Skill is Ideal, so one Reset at the contested Gogma 10 completes it. */
function targetA(id: TargetWeaponId, priority: TargetWeapon['priority']): TargetWeapon {
  const skill = { seriesSkillId: OWN_SKILL('a'), groupSkillId: null, matchMode: 'all' as const }
  return orchestrationTarget(id, { priority, idealSkillCondition: skill, practicalSkillCondition: skill })
}

function chainScenario(): OrchestrationScenario {
  const a = targetA(A.target, 5)
  const d = skillConstrainedTarget(D.target, { priority: 3 })
  const skill8 = { seriesSkillId: SKILL_8, groupSkillId: null, matchMode: 'all' as const }
  const e = skillConstrainedTarget(E.target, { priority: 2, idealSkillCondition: skill8, practicalSkillCondition: skill8 })
  const f = skillConstrainedTarget(F.target, { priority: 1, idealSkillCondition: skill8, practicalSkillCondition: skill8 })
  const z = skillConstrainedTarget(Z.target, { priority: 1 })
  const skillOnly = (id: string, skillCounter: number) =>
    resetSkillsRoute(id, skillCounter)
  return orchestrationScenario({
    targets: [a, d, e, f, z],
    ownedWeapons: [
      orchestrationSource(A.source, { seriesSkillId: OWN_SKILL('a') }),
      orchestrationSource(D.source, { restorationBonuses: belowPracticalBonuses(), seriesSkillId: OWN_SKILL('d') }),
      orchestrationSource(Z.source, { restorationBonuses: idealBonuses(), seriesSkillId: OWN_SKILL('z') }),
      orchestrationSource(E.source, { restorationBonuses: idealBonuses(), seriesSkillId: OWN_SKILL('e') }),
      orchestrationSource(F.source, { restorationBonuses: idealBonuses(), seriesSkillId: OWN_SKILL('f') }),
    ],
    entries: [
      orchestrationEntry(A.entry, a, resetRoute(A.source), { finalBonuses: idealBonuses(), seriesSkillId: OWN_SKILL('a') }),
      // Y: A and D Reset at Gogma 10. X: D and Z Reset Skills at 7.
      orchestrationEntry(D.entry, d, {
        kind: 'existing_gogma_mixed',
        sourceOwnedWeaponId: resetRoute(D.source).sourceOwnedWeaponId,
        operations: [...resetRoute(D.source).operations, ...resetSkillsRoute(D.source).operations],
      }),
      orchestrationEntry(Z.entry, z, skillOnly(Z.source, 7)),
      // W: E and F Reset Skills at 8.
      orchestrationEntry(E.entry, e, skillOnly(E.source, 8), { seriesSkillId: SKILL_8 }),
      orchestrationEntry(F.entry, f, skillOnly(F.source, 8), { seriesSkillId: SKILL_8 }),
    ],
    engine: {
      resetResultAt: (gogma) => (gogma === 10 || gogma === 12 ? idealBonuses() : gogma === 11 ? practicalBonuses() : belowPracticalBonuses()),
      skillResultAt: (skill) => ({
        seriesSkillId: skill === 7 ? IDEAL_SERIES_SKILL_ID : skill === 8 ? SKILL_8 : `series_skill.fixture.s${skill}`,
        groupSkillId: null,
      }),
    },
  })
}

function conflictKeyOf(built: OrchestrationScenario, kind: string, participants: readonly BuildListEntryId[]): string {
  const prepared = preparePlannerInitialContext(built.input, built.dependencies)
  if (prepared.status !== 'ready') throw new Error('fixture not ready')
  const found = prepared.context.initialConflictDetection.conflicts.find((conflict) =>
    conflict.kind === kind && participants.every((id) => conflict.buildListEntryIds.includes(id)))
  if (!found) throw new Error(`no ${kind} conflict of ${participants.join(', ')}`)
  return found.id
}

interface Chain {
  built: OrchestrationScenario
  x: PlannerConflictResolution
  w: PlannerConflictResolution
  decision: PlannerConflictResolution
  lineage: PlannerConflictRepairLineage
}

function routeKeyOf(built: OrchestrationScenario, id: BuildListEntryId): string {
  return candidateStableKey(built.input.buildListEntries.find((candidate) => candidate.id === id)!.candidateSnapshot)
}

/** The Draft after decisions 1 and 2: both resolutions restored, both decisions in the lineage. */
function chain(): Chain {
  const built = chainScenario()
  const w = { conflictKey: conflictKeyOf(built, 'same_skill_counter', [E.entry, F.entry]), selectedBuildListEntryId: E.entry }
  const x = { conflictKey: conflictKeyOf(built, 'same_skill_counter', [D.entry, Z.entry]), selectedBuildListEntryId: D.entry }
  const decision = { conflictKey: conflictKeyOf(built, 'same_gogma_counter', [A.entry, D.entry]), selectedBuildListEntryId: A.entry }
  built.input.conflictResolutions = [w, x]
  return {
    built,
    w,
    x,
    decision,
    lineage: {
      decisions: [
        {
          conflictKind: 'same_skill_counter',
          fixedBuildListEntryId: E.entry,
          fixedTargetWeaponId: E.target,
          invalidatedRoutes: [{ targetWeaponId: F.target, invalidatedBuildListEntryId: F.entry, invalidatedRouteKey: routeKeyOf(built, F.entry), replacementBuildListEntryId: null, outcome: 'not_found_within_search_extent' }],
        },
        {
          conflictKind: 'same_skill_counter',
          fixedBuildListEntryId: D.entry,
          fixedTargetWeaponId: D.target,
          invalidatedRoutes: [{ targetWeaponId: Z.target, invalidatedBuildListEntryId: Z.entry, invalidatedRouteKey: routeKeyOf(built, Z.entry), replacementBuildListEntryId: null, outcome: 'not_found_within_search_extent' }],
        },
      ],
    },
  }
}

const extent = { maxNormalAdvance: 1, maxGogmaAdvance: 5, maxSkillAdvance: 3 }
const bounds = { maxCandidateTrialsPerTarget: 4, maxPlannerReruns: 8 }

function kernelRequest(c: Chain, lineage = c.lineage): PlannerAlternativeKernelRequest {
  const context = derivePlannerConflictRepairLineageContext(lineage, c.built.input.buildListEntries)
  return {
    plannerInput: c.built.input,
    decision: c.decision,
    priorFixedBuildListEntryIds: context.priorFixedBuildListEntryIds,
    priorExcludedRoutes: context.priorExcludedRoutes,
    extent,
    bounds,
  }
}

type CompletedRepair = Extract<PlannerAlternativeRepairCalculationResult, { status: 'completed' }>

async function repair(c: Chain, lineage = c.lineage): Promise<CompletedRepair> {
  const result = await createPlannerAlternativeRepair(
    { plannerInput: c.built.input, decision: c.decision, lineage, extent, bounds },
    c.built.dependencies,
  )
  if (result.status !== 'completed') throw new Error(`repair failed: ${JSON.stringify(result)}`)
  return result
}

async function whatIf(c: Chain, lineage = c.lineage): Promise<PlannerAlternativeComparison> {
  const request = kernelRequest(c, lineage)
  const result = await createPlannerAlternativeWhatIfComparison({
    plannerInput: request.plannerInput,
    scenarioResolution: request.decision,
    priorFixedBuildListEntryIds: request.priorFixedBuildListEntryIds,
    priorExcludedRoutes: request.priorExcludedRoutes,
    extent,
    bounds,
  }, c.built.dependencies)
  if (result.status !== 'completed') throw new Error(`what-if failed: ${JSON.stringify(result)}`)
  return result.comparison
}

function artifactOf(result: CompletedRepair): PlannerAlternativeRepairArtifact {
  if (result.persistence.status !== 'persistable') throw new Error(`not persistable: ${result.persistence.reason}`)
  return result.persistence.artifact
}

describe('Repair chain: a later decision supersedes a prior fixed resolution (PLANNER_SPEC 9.2.19.11)', () => {
  it('drops the restored X -> D from the effective input, and nothing else', () => {
    const c = chain()
    const request = kernelRequest(c)
    // The active lineage fixes both E and D.
    expect(request.priorFixedBuildListEntryIds).toEqual([D.entry, E.entry].sort())
    const prepared = preparePlannerAlternativeKernel(request, c.built.dependencies)
    if (prepared.status !== 'ready') throw new Error(`not ready: ${JSON.stringify(prepared)}`)
    const { scenario } = prepared.prepared
    expect(prepared.prepared.invalidatedBuildListEntryIds).toEqual([D.entry])
    expect(prepared.prepared.supersededPriorFixedBuildListEntryIds).toEqual([D.entry])
    expect(prepared.prepared.supersededConflictResolutions).toEqual([c.x])
    // W -> E stays in place; the decision itself is merged as usual.
    expect(scenario.mergedInput.conflictResolutions).toEqual([c.w, c.decision])
    expect(scenario.fixedConstraints.map(({ fixedBuildListEntryId }) => fixedBuildListEntryId).sort()).toEqual([A.entry, E.entry].sort())
    expect(prepared.prepared.explicitDecisionBuildListEntryIds).toEqual([A.entry, E.entry].sort())
    // The request input is not mutated.
    expect(c.built.input.conflictResolutions).toEqual([c.w, c.x])
  })

  it('reserves neither D nor its old resolution: D2 is searched, found and accepted', async () => {
    const c = chain()
    const kernel = await runPlannerAlternativeKernel(kernelRequest(c), c.built.dependencies)
    if (kernel.status !== 'completed') throw new Error('kernel failed')
    expect(kernel.explicitDecisionBuildListEntryIds).toEqual([A.entry, E.entry].sort())
    const [d] = kernel.targets
    expect(d.targetWeaponId).toBe(D.target)
    // D is in no fixed Route set; the unrelated prior fixed E still is.
    expect(d.fixedRouteBuildListEntryIds).toEqual([A.entry, E.entry].sort())
    expect(d.outcome.status).toBe('found')

    const result = await repair(c)
    const outcome = result.comparison.alternatives[0].outcome
    if (outcome.status !== 'found') throw new Error(`D outcome: ${outcome.status}`)
    expect(outcome.adoptedInScenario).toBe(true)
    const artifact = artifactOf(result)
    const [d2] = artifact.generatedBuildListEntries
    expect(d2.targetWeaponId).toBe(D.target)
    expect(artifact.generatedBuildListEntryReplacements).toEqual([
      { targetWeaponId: D.target, replacedBuildListEntryId: D.entry, generatedBuildListEntryId: d2.id },
    ])
    // E keeps its explicit decision in the saved Plan.
    const plan = artifact.plannerResult.plan
    expect(plan.selectedBuildListEntryIds).toEqual(expect.arrayContaining([A.entry, E.entry]))
    expect(plan.conflicts.some(({ id, selectedBuildListEntryId }) => id === c.w.conflictKey && selectedBuildListEntryId === E.entry)).toBe(true)
  })

  it('gives the what-if and the actual repair the same scenario', async () => {
    const repaired = await repair(chain())
    const compared = await whatIf(chain())
    expect(repaired.comparison).toEqual(compared)
    expect(compared.scenario.status).toBe('evaluated')
  })

  it('records the lost D Route in this decision and no longer treats the earlier D decision as fixed', async () => {
    const c = chain()
    const artifact = artifactOf(await repair(c))
    const d2 = artifact.generatedBuildListEntries[0]
    expect(artifact.conflictRepairLineage.decisions).toEqual([
      c.lineage.decisions[0],
      // Decision 2 stays for Z's still valid record.
      c.lineage.decisions[1],
      {
        conflictKind: 'same_gogma_counter',
        fixedBuildListEntryId: A.entry,
        fixedTargetWeaponId: A.target,
        invalidatedRoutes: [{
          targetWeaponId: D.target,
          invalidatedBuildListEntryId: D.entry,
          invalidatedRouteKey: routeKeyOf(c.built, D.entry),
          replacementBuildListEntryId: d2.id,
          outcome: 'replaced',
        }],
      },
    ])
    // Read against the Build List after the repair, D is fixed by nothing.
    const afterRepair = [
      ...c.built.input.buildListEntries.filter(({ id }) => id !== D.entry),
      d2,
    ]
    const next = derivePlannerConflictRepairLineageContext(artifact.conflictRepairLineage, afterRepair)
    expect(next.priorFixedBuildListEntryIds).toEqual([A.entry, E.entry].sort())
    expect(next.priorExcludedRoutes).toEqual(expect.arrayContaining([
      { targetWeaponId: D.target, routeKeys: [routeKeyOf(c.built, D.entry)] },
      { targetWeaponId: Z.target, routeKeys: [routeKeyOf(c.built, Z.entry)] },
    ]))
  })

  it('keeps the decision own conflict key under the ordinary merge and supersedes only the prior X -> D', () => {
    const c = chain()
    // The Draft also restored an earlier choice of D on the decided conflict itself.
    const restoredY = { conflictKey: c.decision.conflictKey, selectedBuildListEntryId: D.entry }
    c.built.input.conflictResolutions = [c.w, restoredY, c.x]
    const prepared = preparePlannerAlternativeKernel(kernelRequest(c), c.built.dependencies)
    if (prepared.status !== 'ready') throw new Error('not ready')
    expect(prepared.prepared.supersededConflictResolutions).toEqual([c.x])
    // Y is replaced in place by the decision: it is never superseded away.
    expect(prepared.prepared.scenario.mergedInput.conflictResolutions).toEqual([c.w, c.decision])
  })
})

describe('Repair chain: only the active lineage supersedes (PLANNER_SPEC 9.2.19.11)', () => {
  it('keeps every restored resolution without repair lineage (the ordinary what-if)', () => {
    const c = chain()
    const prepared = preparePlannerAlternativeKernel({ ...kernelRequest(c, { decisions: [] }), priorFixedBuildListEntryIds: [] }, c.built.dependencies)
    if (prepared.status !== 'ready') throw new Error('not ready')
    expect(prepared.prepared.supersededConflictResolutions).toEqual([])
    expect(prepared.prepared.scenario.mergedInput.conflictResolutions).toEqual([c.w, c.x, c.decision])
    expect(prepared.prepared.explicitDecisionBuildListEntryIds).toEqual([A.entry, D.entry, E.entry].sort())
  })

  it('never supersedes on an expired lineage decision: X -> D stays and D2 is not adopted', async () => {
    const c = chain()
    // A still later decision already invalidated D (no replacement): decision 2's
    // fixed D has expired, though D is still in the Build List and X -> D restored.
    const expired: PlannerConflictRepairLineage = {
      decisions: [
        ...c.lineage.decisions,
        {
          conflictKind: 'same_gogma_counter',
          fixedBuildListEntryId: A.entry,
          fixedTargetWeaponId: A.target,
          invalidatedRoutes: [{ targetWeaponId: D.target, invalidatedBuildListEntryId: D.entry, invalidatedRouteKey: routeKeyOf(c.built, D.entry), replacementBuildListEntryId: null, outcome: 'stopped_by_search_extent_bound' }],
        },
      ],
    }
    const request = kernelRequest(c, expired)
    expect(request.priorFixedBuildListEntryIds).toEqual([A.entry, E.entry].sort())
    const prepared = preparePlannerAlternativeKernel(request, c.built.dependencies)
    if (prepared.status !== 'ready') throw new Error('not ready')
    expect(prepared.prepared.supersededConflictResolutions).toEqual([])
    expect(prepared.prepared.explicitDecisionBuildListEntryIds).toContain(D.entry)

    const repaired = await repair(c, expired)
    expect(repaired.comparison.alternatives[0].outcome.status).not.toBe('found')
    expect(repaired.comparison).toEqual(await whatIf(chain(), expired))
  })
})
