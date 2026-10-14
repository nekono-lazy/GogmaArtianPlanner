import { afterEach, describe, expect, it } from 'vitest'
import * as production from '../../domain/planner/buildListOptimization'
import type { OwnedWeapon } from '../../domain/models/publicTypes'
import type { PlannerInput } from '../../domain/planner/plannerTypes'
import { globalResearchDependencies } from '../plannerGlobalOptimizationResearch'
import {
  createGlobalAssignmentFixture, createTableEngine, IDEAL_BONUSES, IDEAL_FAMILIES_REORDERED_NORMAL, keepToIdealRanks, keepToLowRanks, layoutKeyOf, OTHER_FAMILIES, ownedGogma,
  ownedNormal,
} from './testFixture'

/*
 * Issue #260 PR-2 determinism audit (`docs/PLANNER_SPEC.md` 17.6, design P-3 7.6): the Build List global optimization's Stage 0 - C
 * must return the same planning Targets, ReachTable, assignments and structural candidates whatever the default collation locale of
 * the engine is. The moved module orders by code units and numbers only (the isolation test forbids `localeCompare` there); this
 * test runs the whole Stage 0 - C pipeline with `String.prototype.localeCompare` forced to collations that do differ from the
 * root order on the IDs this app holds - Danish (`aa` after `z`, which reorders UUIDs), Czech (`ch` after `h`, which reorders
 * weapon type IDs) and Hawaiian (vowels first) - so any locale-dependent order the pipeline reaches through a shared Domain helper
 * (Planner validation, capabilities, Master selectors) would show. Node fixes its default locale from the OS on Windows, so the
 * locale is forced in-process rather than through `LANG`.
 */
const WINDOW = { skill: 3, gogma: 4, normal: 3 }
const ELEMENT_A = 'element.fixture.a'
const SERIES_A = 'series_skill.fixture.a'
const L_IDEAL = layoutKeyOf(IDEAL_BONUSES)
const originalLocaleCompare = String.prototype.localeCompare

function forceCollation(locale: string) {
  String.prototype.localeCompare = function localeCompare(this: string, that: string, locales?: Intl.LocalesArgument, options?: Intl.CollatorOptions) {
    return originalLocaleCompare.call(this, that, locales ?? locale, options)
  }
}

afterEach(() => {
  String.prototype.localeCompare = originalLocaleCompare
})

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

/** Owned weapon IDs that the forced collations order differently from the code-unit order: `aa` / `ab` (Danish), `ch` / `h` (Czech), vowels (Hawaiian). */
function owned(): OwnedWeapon[] {
  return [
    ownedGogma('owned.3aa0', { seriesSkillId: SERIES_A }),
    ownedGogma('owned.3ab0', { restorationBonuses: structuredClone(IDEAL_BONUSES) }),
    ownedGogma('owned.ch10'),
    ownedGogma('owned.h10', { seriesSkillId: SERIES_A }),
    ownedNormal('owned.e7'),
    ownedNormal('owned.k7'),
  ]
}

/** Stage 0 - C over one input: the result is plain data, compared whole. */
async function pipeline() {
  const fixture = await createGlobalAssignmentFixture()
  const input: PlannerInput = { ...fixture.input, ownedWeapons: [...fixture.input.ownedWeapons, ...owned()] }
  const engine = scanEngine()
  const created = production.createBuildListOptimizationContext(input, globalResearchDependencies(engine.engine))
  if (created.kind !== 'context') throw new Error(created.detail)
  const { context } = created
  const built = await production.buildReachTable(context, engine.engine, WINDOW, production.BUILD_LIST_OPTIMIZATION_REACH_OPTION_SET)
  if (built.kind !== 'reach_table') throw new Error(JSON.stringify(built))
  const request = { nodeBudget: 2000, mrvLookahead: 8 }
  return {
    planningTargets: context.planningTargets.map(target => target.id),
    excluded: context.validation.excludedBuildListEntries.map(({ entry, reason }) => [entry.id, reason]),
    table: built.table,
    assignments: production.collectResourceAssignments(built.table, context.planningTargets, request, 50),
    structural: production.collectStructuralCandidates({ table: built.table, context, engine: scanEngine().engine }, { ...request, coverageDrivenOrdering: true }, 20),
    predictions: { ...engine.calls },
  }
}

describe('Build List global optimization Stage 0 - C under other collation locales', () => {
  it('forces the collation it claims to (the IDs above do sort differently there)', () => {
    forceCollation('da')
    expect(['owned.3ab0', 'owned.3aa0'].sort((left, right) => left.localeCompare(right))).toEqual(['owned.3ab0', 'owned.3aa0'])
    forceCollation('cs')
    expect(['weapon.hammer', 'weapon.charge_blade'].sort((left, right) => left.localeCompare(right))).toEqual(['weapon.hammer', 'weapon.charge_blade'])
    forceCollation('haw')
    expect(['owned.k7', 'owned.e7'].sort((left, right) => left.localeCompare(right))).toEqual(['owned.e7', 'owned.k7'])
    expect(['b', 'e'].sort((left, right) => left.localeCompare(right))).toEqual(['e', 'b'])
  })

  it.each(['da', 'cs', 'haw'])('returns the same planning Targets, table, assignments and structural candidates with %s collation', async (locale) => {
    const reference = await pipeline()
    expect(reference.structural.status).toBe('candidates_found')
    forceCollation(locale)
    expect(await pipeline()).toEqual(reference)
  })
})
