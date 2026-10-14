import { describe, expect, it } from 'vitest'
import * as production from '../../domain/planner/buildListOptimization'
import type { OwnedWeapon, OwnedWeaponId } from '../../domain/models/publicTypes'
import type { PlannerInput } from '../../domain/planner/plannerTypes'
import { globalResearchDependencies } from '../plannerGlobalOptimizationResearch'
import * as researchFeasibility from './assignmentFeasibility'
import * as researchOrdering from './assignmentOrdering'
import { collectResourceAssignments } from './assignmentSolver'
import { comparePlanningTargetSet, createGlobalAssignmentContext } from './context'
import * as researchCoverage from './coverage'
import { noCandidateReason } from './coverageSearch'
import * as researchOptions from './reachOptions'
import { assertReachWindow, buildReachTable } from './reachTable'
import { replayReachOptionRequiredOnly } from './requiredOnlyReplay'
import { collectStructuralCandidates } from './structuralSearch'
import {
  createGlobalAssignmentFixture, createTableEngine, IDEAL_BONUSES, IDEAL_FAMILIES_REORDERED_NORMAL, keepToIdealRanks, keepToLowRanks, layoutKeyOf, OTHER_FAMILIES, ownedGogma,
  ownedNormal,
} from './testFixture'
import {
  GlobalAssignmentInvariantError, productionReachTableOf, REACH_OPTION_SET_A1, REACH_OPTION_SET_A2, researchReachOptionSet, researchReachTableOf,
  type GlobalAssignmentContext, type ReachOptionSetVersion, type ReachWindow,
} from './types'

/*
 * Issue #260 PR-2: the Phase 0 - C calculation moved to the Production Domain module `src/domain/planner/buildListOptimization/`
 * and this folder keeps thin adapters. The Research synthetic tests keep running through the adapters; this file fixes that the
 * adapters are the Production calculation itself - the same function objects where the API is the same, and, where the Research
 * names its option set, a Research table that is the Production table with the rule its identity names - so the Research
 * results (`a1` / `a2`, the reason names) mean what they meant before the move.
 */
const WINDOW: ReachWindow = { skill: 3, gogma: 4, normal: 3 }
const ELEMENT_A = 'element.fixture.a'
const SERIES_A = 'series_skill.fixture.a'
const L_IDEAL = layoutKeyOf(IDEAL_BONUSES)

function scanEngine() {
  return createTableEngine({
    skill: (position, _type, element) => ({ seriesSkillId: (element === ELEMENT_A ? [8, 10] : [9]).includes(position) ? SERIES_A : 'series_skill.fixture.other', groupSkillId: null }),
    reset: (position, _type, element) => element === ELEMENT_A
      ? position === 12 ? structuredClone(IDEAL_BONUSES) : structuredClone(OTHER_FAMILIES)
      : position === 10 ? structuredClone(IDEAL_BONUSES) : structuredClone(OTHER_FAMILIES),
    keep: (position, current, _type, element) => element === ELEMENT_A
      ? position === 13 || (position === 11 && layoutKeyOf(current) === L_IDEAL) ? keepToIdealRanks(current) : keepToLowRanks(current)
      : position === 12 ? keepToIdealRanks(current) : keepToLowRanks(current),
    normal: (position, _type, element) => element === ELEMENT_A && position === 5 ? structuredClone(IDEAL_FAMILIES_REORDERED_NORMAL) : structuredClone(OTHER_FAMILIES),
  })
}

/** Owned weapons with a current-Ideal Skill lane (continued under a2 only), a current-Ideal Bonus lane and a Normal source. */
function owned(): OwnedWeapon[] {
  return [
    ownedGogma('owned.adapter.g1', { seriesSkillId: SERIES_A }),
    ownedGogma('owned.adapter.g2', { restorationBonuses: structuredClone(IDEAL_BONUSES) }),
    ownedNormal('owned.adapter.n1'),
  ]
}

async function scene(extra: OwnedWeapon[] = owned()) {
  const fixture = await createGlobalAssignmentFixture()
  const input: PlannerInput = { ...fixture.input, ownedWeapons: [...fixture.input.ownedWeapons, ...extra] }
  const engine = scanEngine()
  const result = createGlobalAssignmentContext(input, globalResearchDependencies(engine.engine))
  if (result.kind !== 'context') throw new Error(`Expected a context, got ${result.kind}: ${result.detail}`)
  return { ...fixture, input, context: result.context, engine }
}

async function researchTable(context: GlobalAssignmentContext, optionSet: ReachOptionSetVersion) {
  const result = await buildReachTable(context, scanEngine().engine, WINDOW, optionSet)
  if (result.kind !== 'reach_table') throw new Error(`Expected a table, got ${JSON.stringify(result)}`)
  return result.table
}

async function productionTable(context: GlobalAssignmentContext, optionSet: production.ReachOptionSet) {
  const result = await production.buildReachTable(context, scanEngine().engine, WINDOW, optionSet)
  if (result.kind !== 'reach_table') throw new Error(`Expected a table, got ${JSON.stringify(result)}`)
  return result.table
}

describe('Global Assignment Research adapters of the Production module (Issue #260 PR-2)', () => {
  it('re-exports the very Production functions wherever the Research API is the same', () => {
    expect(createGlobalAssignmentContext).toBe(production.createBuildListOptimizationContext)
    expect(comparePlanningTargetSet).toBe(production.comparePlanningTargetSet)
    expect(replayReachOptionRequiredOnly).toBe(production.replayReachOptionRequiredOnly)
    expect(GlobalAssignmentInvariantError).toBe(production.BuildListOptimizationInvariantError)
    expect(assertReachWindow).toBe(production.assertReachWindow)
    expect(noCandidateReason).toBe(production.noCandidateReason)
    for (const name of ['requiredPositionsOf', 'findResourceViolation', 'applyReachOption', 'streamEndDelta'] as const) expect(researchFeasibility[name], name).toBe(production[name])
    for (const name of ['sourceResourceKey', 'reachOptionKey', 'createResetThenKeepIndex', 'enumerateResetThenKeepRequirements', 'resetThenKeepPlan', 'keepFromSourcePositions', 'laneAdmitsNone', 'laneAdmitsOperations'] as const) {
      expect(researchOptions[name], name).toBe(production[name])
    }
    for (const name of ['compareValueOrder', 'valueOrderKey', 'createPriorityOrderingCounters'] as const) expect(researchOrdering[name], name).toBe(production[name])
    for (const name of ['coverageStreamLabel', 'selectCoverer'] as const) expect(researchCoverage[name], name).toBe(production[name])
  })

  it('names the option rule by the Research identity exactly as before: a1 without, a2 with continuation', () => {
    expect(researchReachOptionSet(REACH_OPTION_SET_A1)).toEqual({ id: REACH_OPTION_SET_A1, continuesCurrentIdealLanes: false })
    expect(researchReachOptionSet(REACH_OPTION_SET_A2)).toEqual({ id: REACH_OPTION_SET_A2, continuesCurrentIdealLanes: true })
    expect(productionReachTableOf({ optionSet: REACH_OPTION_SET_A1 }).continuesCurrentIdealLanes).toBe(false)
    expect(productionReachTableOf({ optionSet: REACH_OPTION_SET_A2 }).continuesCurrentIdealLanes).toBe(true)
    const gogma: production.SourceCandidate = { kind: 'owned_gogma', ownedWeaponId: 'owned.adapter' as OwnedWeaponId, layout: 'L', scope: 'gogma_artian', currentSkillIdeal: true, currentBonusIdeal: false, isProtected: false, keepSupported: true }
    expect(researchOptions.sourceLaneAdmission(gogma, REACH_OPTION_SET_A1)).toEqual(production.sourceLaneAdmission(gogma, false))
    expect(researchOptions.sourceLaneAdmission(gogma, REACH_OPTION_SET_A2)).toEqual(production.sourceLaneAdmission(gogma, true))
    // The Production option set is the a2 rule under its own identity, never a Research one.
    expect(production.BUILD_LIST_OPTIMIZATION_REACH_OPTION_SET.continuesCurrentIdealLanes).toBe(true)
    expect([REACH_OPTION_SET_A1, REACH_OPTION_SET_A2]).not.toContain(production.BUILD_LIST_OPTIMIZATION_REACH_OPTION_SET.id)
  })

  it('returns the Production table in its Research view: equal but for the option set identity, and refused when the rule contradicts it', async () => {
    const { context } = await scene()
    for (const optionSet of [REACH_OPTION_SET_A1, REACH_OPTION_SET_A2] as const) {
      const research = await researchTable(context, optionSet)
      const built = await productionTable(context, researchReachOptionSet(optionSet))
      const { continuesCurrentIdealLanes, ...rest } = built
      expect(continuesCurrentIdealLanes).toBe(optionSet === REACH_OPTION_SET_A2)
      expect(research).toEqual(rest)
      expect(Object.keys(research)).toEqual(Object.keys(rest))
    }
    // The Production option set scans the same table as a2 (the scan reads no option set).
    const a2 = await researchTable(context, REACH_OPTION_SET_A2)
    const { continuesCurrentIdealLanes, optionSet, ...scan } = await productionTable(context, production.BUILD_LIST_OPTIMIZATION_REACH_OPTION_SET)
    expect([continuesCurrentIdealLanes, optionSet]).toEqual([true, 'build-list-optimization-reach-options:v1'])
    expect({ ...scan, optionSet: REACH_OPTION_SET_A2 }).toEqual(a2)
    const contradicting = await productionTable(context, { id: REACH_OPTION_SET_A2, continuesCurrentIdealLanes: false })
    expect(() => researchReachTableOf(contradicting, REACH_OPTION_SET_A2)).toThrow(RangeError)
    expect(() => researchReachTableOf(contradicting, REACH_OPTION_SET_A1)).toThrow(RangeError)
  })

  it('finds the same assignments and structural candidates through the adapter as the Production module does on its own table', async () => {
    const { context } = await scene()
    for (const optionSet of [REACH_OPTION_SET_A1, REACH_OPTION_SET_A2] as const) {
      const research = await researchTable(context, optionSet)
      const built = await productionTable(context, researchReachOptionSet(optionSet))
      const request = { nodeBudget: 2000, mrvLookahead: 8 }
      expect(collectResourceAssignments(research, context.planningTargets, request, 50))
        .toEqual(production.collectResourceAssignments(built, context.planningTargets, request, 50))
      const researchStructural = collectStructuralCandidates({ table: research, context, engine: scanEngine().engine }, { ...request, coverageDrivenOrdering: true }, 20)
      const productionStructural = production.collectStructuralCandidates({ table: built, context, engine: scanEngine().engine }, { ...request, coverageDrivenOrdering: true }, 20)
      expect(researchStructural).toEqual(productionStructural)
      expect(researchStructural.status).toBe('candidates_found')
    }
  })

  it('keeps the Research reason name of a Target without a source (the Production concept name is target_without_source)', async () => {
    const fixture = await createGlobalAssignmentFixture({ normalCounterConfirmed: false })
    const engine = scanEngine()
    const result = createGlobalAssignmentContext(fixture.input, globalResearchDependencies(engine.engine))
    if (result.kind !== 'context') throw new Error(result.detail)
    const research = await buildReachTable(result.context, engine.engine, WINDOW, REACH_OPTION_SET_A2)
    const built = await production.buildReachTable(result.context, engine.engine, WINDOW, production.BUILD_LIST_OPTIMIZATION_REACH_OPTION_SET)
    expect(research).toMatchObject({ kind: 'unsupported_input', reason: 'unconfirmed_counter' })
    expect(built).toMatchObject({ kind: 'unsupported_input', reason: 'target_without_source' })
    expect(research.kind === 'unsupported_input' && built.kind === 'unsupported_input' && research.detail === built.detail).toBe(true)
    // An invalid Research option set is refused by the adapter, with the Research message, before any scan.
    await expect(buildReachTable(result.context, engine.engine, WINDOW, 'global-assignment-reach-options:a3' as ReachOptionSetVersion)).rejects.toThrow(/optionSet must be global-assignment-reach-options:a1 or/)
  })
})
