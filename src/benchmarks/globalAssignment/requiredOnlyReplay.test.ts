import { describe, expect, it } from 'vitest'
import type { OwnedWeapon, RestorationBonusSet } from '../../domain/models/publicTypes'
import type { PlannerInput } from '../../domain/planner/plannerTypes'
import { satisfiesIdealTarget } from '../../domain/target/targetEvaluator'
import { globalResearchDependencies } from '../plannerGlobalOptimizationResearch'
import { createGlobalAssignmentContext } from './context'
import { enumerateReachOptions, reachOptionKey } from './reachOptions'
import { buildReachTable } from './reachTable'
import { replayReachOptionRequiredOnly } from './requiredOnlyReplay'
import {
  createGlobalAssignmentFixture, createTableEngine, IDEAL_BONUSES, IDEAL_FAMILIES_REORDERED_NORMAL, keepToIdealRanks, keepToLowRanks, layoutKeyOf,
  OTHER_FAMILIES, ownedGogma, ownedNormal,
} from './testFixture'
import { GlobalAssignmentInvariantError, type ReachOption } from './types'

/*
 * Issue #154 Global Assignment Phase A (design 5.3): the required-only replay re-predicts the required
 * units of one option and judges the final state with the Ideal authority. It is an RNG check only.
 */
const SERIES_A = 'series_skill.fixture.a'
const L_IDEAL = layoutKeyOf(IDEAL_BONUSES)
const REORDERED_GOGMA: RestorationBonusSet = [
  { bonusTypeId: 'bonus_type.fixture.sharpness', bonusRankId: 'bonus_rank.fixture.low' }, IDEAL_BONUSES[2], IDEAL_BONUSES[3], IDEAL_BONUSES[0],
  { ...IDEAL_BONUSES[1], bonusRankId: 'bonus_rank.fixture.low' },
]
const IDEAL_ORDER_NORMAL: RestorationBonusSet = [IDEAL_BONUSES[0], IDEAL_BONUSES[1], IDEAL_BONUSES[2], IDEAL_BONUSES[3],
  { bonusTypeId: 'bonus_type.fixture.normal_sharpness', bonusRankId: 'bonus_rank.fixture.low' }]
const WINDOW = { skill: 3, gogma: 4, normal: 3 }

function engine(unsupportedKeep = false) {
  return createTableEngine({
    skill: position => ({ seriesSkillId: [8, 10].includes(position) ? SERIES_A : 'series_skill.fixture.other', groupSkillId: null }),
    reset: position => position === 12 ? structuredClone(IDEAL_BONUSES) : position === 11 ? structuredClone(REORDERED_GOGMA) : structuredClone(OTHER_FAMILIES),
    keep: (position, current) => position === 13 || (position === 11 && layoutKeyOf(current) === L_IDEAL) ? keepToIdealRanks(current) : keepToLowRanks(current),
    normal: position => position === 5 ? structuredClone(IDEAL_FAMILIES_REORDERED_NORMAL) : position === 6 ? structuredClone(IDEAL_ORDER_NORMAL) : structuredClone(OTHER_FAMILIES),
    support: unsupportedKeep ? input => input.type === 'gogma_keep' ? { supported: false, reason: 'unsupported_current_bonus' } : null : undefined,
  })
}
const owned: OwnedWeapon[] = [
  ownedGogma('owned.g1'),
  ownedGogma('owned.g2', { restorationBonuses: structuredClone(IDEAL_BONUSES), seriesSkillId: SERIES_A, isProtected: true, status: 'ideal' }),
  ownedGogma('owned.g4', { restorationBonuses: structuredClone(IDEAL_FAMILIES_REORDERED_NORMAL), restorationBonusScope: 'normal_artian' }),
  ownedGogma('owned.g5', { restorationBonuses: structuredClone(IDEAL_BONUSES) }),
  ownedNormal('owned.n1'),
]

async function prepared(table = engine()) {
  const fixture = await createGlobalAssignmentFixture()
  const input: PlannerInput = { ...fixture.input, ownedWeapons: owned }
  const result = createGlobalAssignmentContext(input, globalResearchDependencies(table.engine))
  if (result.kind !== 'context') throw new Error(result.detail)
  const reach = await buildReachTable(result.context, table.engine, WINDOW)
  if (reach.kind !== 'reach_table') throw new Error(JSON.stringify(reach))
  const a = reach.table.targets[0]!
  return { input, context: result.context, table, reach: reach.table, a, options: [...enumerateReachOptions(a, reach.table)], target: fixture.targets.a }
}

describe('Phase A required-only replay', () => {
  it('replays every option of the scan to an Ideal final state and marks it rng_replayed', async () => {
    const { context, table, options, target, input } = await prepared()
    expect(options.length).toBeGreaterThan(80)
    const kinds = new Set<string>()
    for (const option of options) {
      const result = replayReachOptionRequiredOnly(option, context, table.engine)
      expect(result.option).toEqual({ ...option, verification: 'rng_replayed' })
      expect(result.finalState.restorationBonusScope).toBe('gogma_artian')
      expect(satisfiesIdealTarget(target, result.finalState.finalBonuses, result.finalState.restorationBonusScope, result.finalState.seriesSkillId, result.finalState.groupSkillId, input.master)).toBe(true)
      kinds.add(`${option.source.kind}/${option.skillRequired.kind}/${option.bonusRequired.kind}`)
      // The replay is an RNG check of required units: it carries no Entry, Plan or Planner verdict.
      expect(Object.keys(result).sort()).toEqual(['finalState', 'option', 'predictions'])
    }
    expect([...kinds].sort()).toEqual([
      'new_normal/conversion/keep_from_source', 'new_normal/conversion/reset', 'new_normal/conversion/reset_then_keep',
      'owned_gogma/none/none', 'owned_gogma/reset_skills/keep_from_source', 'owned_gogma/reset_skills/none', 'owned_gogma/reset_skills/reset', 'owned_gogma/reset_skills/reset_then_keep',
      'owned_normal/conversion/keep_from_source', 'owned_normal/conversion/reset', 'owned_normal/conversion/reset_then_keep',
    ])
  })

  it('counts its predictions per required unit: the conversion Skill, a later final Skill, Reset and Keep', async () => {
    const { context, table, options } = await prepared()
    const find = (key: string) => options.find(option => reachOptionKey(option) === key) ?? (() => { throw new Error(`missing ${key}`) })()
    const zero = replayReachOptionRequiredOnly(find('target.fixture.a|owned:owned.g2|none|none'), context, table.engine)
    expect(zero.predictions).toEqual({ skill: 0, gogmaReset: 0, gogmaKeep: 0, normal: 0 })
    expect(zero.finalState).toEqual({ finalBonuses: IDEAL_BONUSES, restorationBonusScope: 'gogma_artian', seriesSkillId: SERIES_A, groupSkillId: null })
    const direct = replayReachOptionRequiredOnly(find('target.fixture.a|normal:weapon.fixture.a:8:6|conversion:8:8|keep_from_source:11'), context, table.engine)
    expect(direct.predictions).toEqual({ skill: 1, gogmaReset: 0, gogmaKeep: 1, normal: 1 })
    const later = replayReachOptionRequiredOnly(find('target.fixture.a|owned:owned.n1|conversion:7:10|reset_then_keep:11:13'), context, table.engine)
    expect(later.predictions).toEqual({ skill: 2, gogmaReset: 1, gogmaKeep: 1, normal: 0 })
    expect(later.finalState.seriesSkillId).toBe(SERIES_A)
    const resetOnly = replayReachOptionRequiredOnly(find('target.fixture.a|owned:owned.g1|reset_skills:8|reset:12'), context, table.engine)
    expect(resetOnly.predictions).toEqual({ skill: 1, gogmaReset: 1, gogmaKeep: 0, normal: 0 })
  })

  it('fails closed as an invariant error on an option the scan did not derive', async () => {
    const { context, table, options } = await prepared()
    const base = options.find(option => reachOptionKey(option) === 'target.fixture.a|owned:owned.g1|reset_skills:8|reset:12')!
    const expectCode = (option: ReachOption, code: GlobalAssignmentInvariantError['code']) => {
      let caught: unknown = null
      try { replayReachOptionRequiredOnly(option, context, table.engine) } catch (error) { caught = error }
      expect(caught).toBeInstanceOf(GlobalAssignmentInvariantError)
      expect((caught as GlobalAssignmentInvariantError).code).toBe(code)
    }
    // A Reset at a non-Ideal position, a Reset Skills at a non-Ideal position: the RNG result disagrees with the Ideal.
    expectCode({ ...base, bonusRequired: { kind: 'reset', finalPosition: 10 } }, 'ideal_mismatch')
    expectCode({ ...base, skillRequired: { kind: 'reset_skills', finalPosition: 9 } }, 'ideal_mismatch')
    expectCode({ ...base, bonusRequired: { kind: 'keep_from_source', finalPosition: 13 } }, 'ideal_mismatch') // layout OTHER never Keeps into the Ideal
    // Structural inconsistencies.
    expectCode({ ...base, bonusRequired: { kind: 'reset_then_keep', resetPosition: 13, finalPosition: 11 } }, 'requirement_inconsistent')
    expectCode({ ...base, skillRequired: { kind: 'conversion', conversionPosition: 8, finalPosition: 8 } }, 'source_kind_mismatch')
    // `none` on a non-Ideal gogma_artian Gogma reaches the Ideal judgement and fails there; on a normal-scope Gogma it is structurally impossible.
    expectCode({ ...base, bonusRequired: { kind: 'none' } }, 'ideal_mismatch')
    const normalScope = options.find(option => reachOptionKey(option) === 'target.fixture.a|owned:owned.g4|reset_skills:8|keep_from_source:13')!
    expectCode({ ...normalScope, bonusRequired: { kind: 'none' } }, 'requirement_inconsistent')
    expectCode({ ...base, normalRequired: { counterId: 'weapon.fixture.a:8', position: 4 } }, 'requirement_inconsistent')
    expectCode({ ...base, source: { ...base.source, ownedWeaponId: 'owned.missing' } as ReachOption['source'] }, 'source_missing')
    expectCode({ ...base, targetWeaponId: 'target.fixture.unknown' as ReachOption['targetWeaponId'] }, 'target_not_planning')
    const conversion = options.find(option => reachOptionKey(option) === 'target.fixture.a|owned:owned.n1|conversion:8:10|reset:12')!
    expectCode({ ...conversion, skillRequired: { kind: 'conversion', conversionPosition: 10, finalPosition: 8 } }, 'requirement_inconsistent')
    expectCode({ ...conversion, skillRequired: { kind: 'reset_skills', finalPosition: 8 } }, 'source_kind_mismatch')
    expectCode({ ...conversion, skillRequired: { kind: 'none' } }, 'source_kind_mismatch')
    const forged = options.find(option => reachOptionKey(option) === 'target.fixture.a|normal:weapon.fixture.a:8:5|conversion:8:8|keep_from_source:13')!
    expectCode({ ...forged, normalRequired: null }, 'requirement_inconsistent')
    expectCode({ ...forged, normalRequired: { counterId: 'weapon.fixture.a:8', position: 6 } }, 'requirement_inconsistent')
  })

  it('reports a prediction the Engine no longer supports as prediction_unsupported, not as a reached or unreached Ideal', async () => {
    const supported = await prepared()
    const keep = supported.options.find(option => reachOptionKey(option) === 'target.fixture.a|owned:owned.n1|conversion:8:8|keep_from_source:13')!
    const unsupported = engine(true)
    let caught: unknown = null
    try { replayReachOptionRequiredOnly(keep, supported.context, unsupported.engine) } catch (error) { caught = error }
    expect(caught).toBeInstanceOf(GlobalAssignmentInvariantError)
    expect((caught as GlobalAssignmentInvariantError).code).toBe('prediction_unsupported')
    expect(unsupported.calls.keep).toBe(0)
  })
})
