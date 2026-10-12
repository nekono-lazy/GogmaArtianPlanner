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
  createGlobalAssignmentFixture, createTableEngine, FIXTURE_GOGMA_ORIGIN, FIXTURE_NORMAL_COUNTER_ID, FIXTURE_NORMAL_ORIGIN, FIXTURE_SKILL_ORIGIN,
  IDEAL_BONUSES, IDEAL_FAMILIES_REORDERED_NORMAL, keepToIdealRanks, keepToLowRanks, layoutKeyOf, OTHER_FAMILIES, ownedGogma, ownedNormal,
} from './testFixture'
import { GlobalAssignmentInvariantError, type BonusRequirement, type ReachOption, type SkillRequirement, type StreamEnd } from './types'

/*
 * Issue #154 Global Assignment Phase A (design 5.3): the required-only replay re-predicts the required
 * units of one option and judges the final state with the Ideal authority. It is an RNG check only.
 * Before predicting it checks the option against the PlannerInput: an eligible source (REQUIREMENTS 21),
 * required positions at or after the origins, and a `streamEnd` re-derived independently of the
 * generator (PR #238 review R1 / R2).
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
const COUNTER = FIXTURE_NORMAL_COUNTER_ID

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
  ownedNormal('owned.n2', { isProtected: true }),
]

async function prepared(table = engine()) {
  const fixture = await createGlobalAssignmentFixture()
  const input: PlannerInput = { ...fixture.input, ownedWeapons: owned }
  const result = createGlobalAssignmentContext(input, globalResearchDependencies(table.engine))
  if (result.kind !== 'context') throw new Error(result.detail)
  const reach = await buildReachTable(result.context, table.engine, WINDOW)
  if (reach.kind !== 'reach_table') throw new Error(JSON.stringify(reach))
  const a = reach.table.targets[0]!
  const options = [...enumerateReachOptions(a, reach.table)]
  const find = (key: string) => options.find(option => reachOptionKey(option) === key) ?? (() => { throw new Error(`missing ${key}`) })()
  return { input, context: result.context, table, reach: reach.table, a, options, find, target: fixture.targets.a }
}

/** The ends the test derives on its own from the requirements (never through the generator's helper). */
function endsOf(skill: SkillRequirement, bonus: BonusRequirement, normal: { position: number } | null): StreamEnd {
  return {
    skill: skill.kind === 'none' ? FIXTURE_SKILL_ORIGIN : skill.finalPosition + 1,
    gogma: bonus.kind === 'none' ? FIXTURE_GOGMA_ORIGIN : bonus.finalPosition + 1,
    normal: { [COUNTER]: normal === null ? FIXTURE_NORMAL_ORIGIN : normal.position + 1 },
  }
}

/** A variant of `option` whose `streamEnd` is consistent with its (changed) requirements, so only the RNG result decides. */
function consistent(option: ReachOption, changes: { skill?: SkillRequirement; bonus?: BonusRequirement }): ReachOption {
  const skill = changes.skill ?? option.skillRequired
  const bonus = changes.bonus ?? option.bonusRequired
  return { ...option, skillRequired: skill, bonusRequired: bonus, streamEnd: endsOf(skill, bonus, option.normalRequired) }
}

function codeOf(run: () => unknown): GlobalAssignmentInvariantError['code'] | 'none' {
  try { run() } catch (error) {
    if (error instanceof GlobalAssignmentInvariantError) return error.code
    throw error
  }
  return 'none'
}

describe('Phase A required-only replay', () => {
  it('replays every option of the scan to an Ideal final state and marks it rng_replayed, with the stream ends it re-derives', async () => {
    const { context, table, options, target, input } = await prepared()
    expect(options.length).toBeGreaterThan(80)
    const kinds = new Set<string>()
    for (const option of options) {
      const result = replayReachOptionRequiredOnly(option, context, table.engine)
      expect(result.option).toEqual({ ...option, verification: 'rng_replayed' })
      expect(result.option.streamEnd).toEqual(endsOf(option.skillRequired, option.bonusRequired, option.normalRequired))
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
    // The protected Normal is no source of any option; the protected Ideal Gogma has exactly its zero-operation option.
    expect(options.some(option => option.source.kind !== 'new_normal' && option.source.ownedWeaponId === 'owned.n2')).toBe(false)
    expect(options.filter(option => option.source.kind !== 'new_normal' && option.source.ownedWeaponId === 'owned.g2').map(option => reachOptionKey(option)))
      .toEqual(['target.fixture.a|owned:owned.g2|none|none'])
  })

  it('counts its predictions per required unit: the conversion Skill, a later final Skill, Reset and Keep', async () => {
    const { context, table, find } = await prepared()
    const zero = replayReachOptionRequiredOnly(find('target.fixture.a|owned:owned.g2|none|none'), context, table.engine)
    expect(zero.predictions).toEqual({ skill: 0, gogmaReset: 0, gogmaKeep: 0, normal: 0 })
    expect(zero.finalState).toEqual({ finalBonuses: IDEAL_BONUSES, restorationBonusScope: 'gogma_artian', seriesSkillId: SERIES_A, groupSkillId: null })
    const direct = replayReachOptionRequiredOnly(find(`target.fixture.a|normal:${COUNTER}:6|conversion:8:8|keep_from_source:11`), context, table.engine)
    expect(direct.predictions).toEqual({ skill: 1, gogmaReset: 0, gogmaKeep: 1, normal: 1 })
    const later = replayReachOptionRequiredOnly(find('target.fixture.a|owned:owned.n1|conversion:7:10|reset_then_keep:11:13'), context, table.engine)
    expect(later.predictions).toEqual({ skill: 2, gogmaReset: 1, gogmaKeep: 1, normal: 0 })
    expect(later.finalState.seriesSkillId).toBe(SERIES_A)
    const resetOnly = replayReachOptionRequiredOnly(find('target.fixture.a|owned:owned.g1|reset_skills:8|reset:12'), context, table.engine)
    expect(resetOnly.predictions).toEqual({ skill: 1, gogmaReset: 1, gogmaKeep: 0, normal: 0 })
  })

  it('fails closed as an invariant error on an option the scan did not derive', async () => {
    const { context, table, find } = await prepared()
    const base = find('target.fixture.a|owned:owned.g1|reset_skills:8|reset:12')
    const expectCode = (option: ReachOption, code: GlobalAssignmentInvariantError['code']) =>
      expect(codeOf(() => replayReachOptionRequiredOnly(option, context, table.engine))).toBe(code)
    // Required positions whose RNG result is not the Ideal (stream ends kept consistent, so only the result decides).
    expectCode(consistent(base, { bonus: { kind: 'reset', finalPosition: 10 } }), 'ideal_mismatch')
    expectCode(consistent(base, { skill: { kind: 'reset_skills', finalPosition: 9 } }), 'ideal_mismatch')
    expectCode(consistent(base, { bonus: { kind: 'keep_from_source', finalPosition: 13 } }), 'ideal_mismatch') // layout OTHER never Keeps into the Ideal
    // `none` on a non-Ideal gogma_artian Gogma reaches the Ideal judgement and fails there; on a normal-scope Gogma it is structurally impossible.
    expectCode(consistent(base, { bonus: { kind: 'none' } }), 'ideal_mismatch')
    const normalScope = find('target.fixture.a|owned:owned.g4|reset_skills:8|keep_from_source:13')
    expectCode(consistent(normalScope, { bonus: { kind: 'none' } }), 'requirement_inconsistent')
    // Structural inconsistencies.
    expectCode(consistent(base, { bonus: { kind: 'reset_then_keep', resetPosition: 13, finalPosition: 11 } }), 'requirement_inconsistent')
    expectCode(consistent(base, { skill: { kind: 'conversion', conversionPosition: 8, finalPosition: 8 } }), 'source_kind_mismatch')
    expectCode({ ...base, normalRequired: { counterId: COUNTER, position: 4 } }, 'requirement_inconsistent')
    expectCode({ ...base, source: { ...base.source, ownedWeaponId: 'owned.missing' } as ReachOption['source'] }, 'source_missing')
    expectCode({ ...base, targetWeaponId: 'target.fixture.unknown' as ReachOption['targetWeaponId'] }, 'target_not_planning')
    const conversion = find('target.fixture.a|owned:owned.n1|conversion:8:10|reset:12')
    expectCode(consistent(conversion, { skill: { kind: 'conversion', conversionPosition: 10, finalPosition: 8 } }), 'requirement_inconsistent')
    expectCode(consistent(conversion, { skill: { kind: 'reset_skills', finalPosition: 8 } }), 'source_kind_mismatch')
    expectCode(consistent(conversion, { skill: { kind: 'none' } }), 'source_kind_mismatch')
    const forged = find(`target.fixture.a|normal:${COUNTER}:5|conversion:8:8|keep_from_source:13`)
    expectCode({ ...forged, normalRequired: null }, 'requirement_inconsistent')
    expectCode({ ...forged, normalRequired: { counterId: COUNTER, position: 6 } }, 'requirement_inconsistent')
  })

  it('R1: re-derives streamEnd from the required positions and the origins and refuses every disagreement before predicting', async () => {
    const { context, table, find } = await prepared()
    const expectCode = (option: ReachOption, code: GlobalAssignmentInvariantError['code']) => {
      const before = { ...table.calls }
      expect(codeOf(() => replayReachOptionRequiredOnly(option, context, table.engine))).toBe(code)
      // Refused before any RNG prediction.
      expect({ ...table.calls, support: before.support }).toEqual(before)
    }
    const gogma = find('target.fixture.a|owned:owned.g1|reset_skills:8|reset:12')
    const forged = find(`target.fixture.a|normal:${COUNTER}:6|conversion:8:8|reset:12`)
    // (1) The generator's ends agree with the independent derivation and replay succeeds.
    expect(gogma.streamEnd).toEqual({ skill: 9, gogma: 13, normal: { [COUNTER]: FIXTURE_NORMAL_ORIGIN } })
    expect(forged.streamEnd).toEqual({ skill: 9, gogma: 13, normal: { [COUNTER]: 7 } })
    expect(replayReachOptionRequiredOnly(gogma, context, table.engine).option.verification).toBe('rng_replayed')
    expect(replayReachOptionRequiredOnly(forged, context, table.engine).option.verification).toBe('rng_replayed')
    // (2) Reset 12 is right, the Gogma end is too small; also too large.
    expectCode({ ...gogma, streamEnd: { ...gogma.streamEnd, gogma: FIXTURE_GOGMA_ORIGIN } }, 'requirement_inconsistent')
    expectCode({ ...gogma, streamEnd: { ...gogma.streamEnd, gogma: 14 } }, 'requirement_inconsistent')
    // (3) Skill final 8 is right, the Skill end differs.
    expectCode({ ...gogma, streamEnd: { ...gogma.streamEnd, skill: 8 } }, 'requirement_inconsistent')
    expectCode({ ...gogma, streamEnd: { ...gogma.streamEnd, skill: FIXTURE_SKILL_ORIGIN } }, 'requirement_inconsistent')
    // (4) new_normal position 6 is right, the Normal end differs.
    expectCode({ ...forged, streamEnd: { ...forged.streamEnd, normal: { [COUNTER]: 6 } } }, 'requirement_inconsistent')
    expectCode({ ...forged, streamEnd: { ...forged.streamEnd, normal: {} } }, 'requirement_inconsistent')
    // (5) An owned source ends at the Counter origin, nowhere else.
    expectCode({ ...gogma, streamEnd: { ...gogma.streamEnd, normal: { [COUNTER]: FIXTURE_NORMAL_ORIGIN + 1 } } }, 'requirement_inconsistent')
    expectCode({ ...gogma, streamEnd: { ...gogma.streamEnd, normal: {} } }, 'requirement_inconsistent')
    // (6) An extra or a foreign Counter ID in the Normal end.
    expectCode({ ...gogma, streamEnd: { ...gogma.streamEnd, normal: { [COUNTER]: FIXTURE_NORMAL_ORIGIN, 'weapon.fixture.b:8': 0 } } }, 'requirement_inconsistent')
    expectCode({ ...forged, streamEnd: { ...forged.streamEnd, normal: { 'weapon.fixture.b:8': 7 } } }, 'requirement_inconsistent')
    // (7) A required position before its stream origin, even with a matching end.
    expectCode(consistent(gogma, { bonus: { kind: 'reset', finalPosition: FIXTURE_GOGMA_ORIGIN - 1 } }), 'requirement_inconsistent')
    expectCode(consistent(gogma, { skill: { kind: 'reset_skills', finalPosition: FIXTURE_SKILL_ORIGIN - 1 } }), 'requirement_inconsistent')
    expectCode(consistent(forged, { skill: { kind: 'conversion', conversionPosition: FIXTURE_SKILL_ORIGIN - 1, finalPosition: 8 } }), 'requirement_inconsistent')
    expectCode(consistent(gogma, { bonus: { kind: 'reset_then_keep', resetPosition: FIXTURE_GOGMA_ORIGIN - 1, finalPosition: 13 } }), 'requirement_inconsistent')
    const below = { ...forged, source: { ...forged.source, position: FIXTURE_NORMAL_ORIGIN - 1 } as ReachOption['source'], normalRequired: { counterId: COUNTER, position: FIXTURE_NORMAL_ORIGIN - 1 },
      streamEnd: { ...forged.streamEnd, normal: { [COUNTER]: FIXTURE_NORMAL_ORIGIN } } }
    expectCode(below, 'requirement_inconsistent')
    // A Counter ID that is not the Target's confirmed rarity-8 Counter, and a non-integer position.
    const foreign = 'weapon.fixture.b:8'
    expectCode({ ...forged, source: { ...forged.source, counterId: foreign } as ReachOption['source'], normalRequired: { counterId: foreign, position: 6 }, streamEnd: { ...forged.streamEnd, normal: { [foreign]: 7 } } }, 'requirement_inconsistent')
    expectCode(consistent(gogma, { bonus: { kind: 'reset', finalPosition: 12.5 } }), 'requirement_inconsistent')
    expectCode({ ...gogma, streamEnd: { ...gogma.streamEnd, gogma: Number.NaN } }, 'requirement_inconsistent')
  })

  it('R2: a protected Gogma accepts only the zero-operation option; every requested operation is refused before predicting', async () => {
    const { context, table, find } = await prepared()
    const expectRefused = (option: ReachOption) => {
      const before = { ...table.calls }
      expect(codeOf(() => replayReachOptionRequiredOnly(option, context, table.engine))).toBe('source_kind_mismatch')
      expect({ ...table.calls, support: before.support }).toEqual(before)
    }
    // (1) The protected Ideal Gogma's own option replays.
    const zero = find('target.fixture.a|owned:owned.g2|none|none')
    expect(replayReachOptionRequiredOnly(zero, context, table.engine).option.verification).toBe('rng_replayed')
    // (2) - (5) The same weapon asked to Reset Skills / Reset / Keep / Reset -> Keep, each at a position whose result would be Ideal.
    expectRefused(consistent(zero, { skill: { kind: 'reset_skills', finalPosition: 8 } }))
    expectRefused(consistent(zero, { bonus: { kind: 'reset', finalPosition: 12 } }))
    expectRefused(consistent(zero, { bonus: { kind: 'keep_from_source', finalPosition: 13 } }))
    expectRefused(consistent(zero, { bonus: { kind: 'reset_then_keep', resetPosition: 12, finalPosition: 13 } }))
    expectRefused(consistent(zero, { skill: { kind: 'reset_skills', finalPosition: 8 }, bonus: { kind: 'reset', finalPosition: 12 } }))
    // (6) A protected Normal as a conversion source.
    const normal = find('target.fixture.a|owned:owned.n1|conversion:8:8|reset:12')
    expectRefused({ ...normal, source: { ...normal.source, ownedWeaponId: 'owned.n2' } as ReachOption['source'] })
    // (7) The unprotected Gogma's operations still replay.
    expect(replayReachOptionRequiredOnly(find('target.fixture.a|owned:owned.g1|reset_skills:8|reset:12'), context, table.engine).option.verification).toBe('rng_replayed')
    expect(replayReachOptionRequiredOnly(find('target.fixture.a|owned:owned.g5|reset_skills:8|none'), context, table.engine).option.verification).toBe('rng_replayed')
  })

  it('reports a prediction the Engine no longer supports as prediction_unsupported, not as a reached or unreached Ideal', async () => {
    const supported = await prepared()
    const keep = supported.find('target.fixture.a|owned:owned.n1|conversion:8:8|keep_from_source:13')
    const unsupported = engine(true)
    expect(codeOf(() => replayReachOptionRequiredOnly(keep, supported.context, unsupported.engine))).toBe('prediction_unsupported')
    expect(unsupported.calls.keep).toBe(0)
  })
})
