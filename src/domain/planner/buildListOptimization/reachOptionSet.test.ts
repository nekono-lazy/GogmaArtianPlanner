import { describe, expect, it } from 'vitest'
import type { OwnedWeaponId, TargetWeaponId } from '../../models/publicTypes'
import { createResourceAssignmentSearch } from './assignmentSolver'
import { BUILD_LIST_OPTIMIZATION_REACH_OPTION_SET, type ReachTable, type SourceCandidate, type TargetReach } from './buildListOptimizationTypes'
import { enumerateReachOptions, sourceLaneAdmission } from './reachOptions'
import { assertReachOptionSet } from './reachTable'

/*
 * The option set of the Build List global optimization (`docs/PLANNER_SPEC.md` 17.6): the option rule the Research accepted
 * as `a2` (an owned Gogma's current-Ideal lanes continue), stored on every table and read from it by every Stage. A table
 * that names no rule is never read as either one.
 */

const gogma = (overrides: Partial<Extract<SourceCandidate, { kind: 'owned_gogma' }>> = {}): SourceCandidate => ({
  kind: 'owned_gogma', ownedWeaponId: 'owned.option-set.g' as OwnedWeaponId, layout: 'L', scope: 'gogma_artian',
  currentSkillIdeal: false, currentBonusIdeal: false, isProtected: false, keepSupported: true, ...overrides,
})

function table(continuesCurrentIdealLanes: boolean, sources: SourceCandidate[]): ReachTable {
  const row: TargetReach = {
    targetWeaponId: 'target.option-set' as TargetWeaponId, weaponTypeId: 'weapon.fixture.a', elementId: 'element.fixture.a', normalCounterId: null,
    support: { normal: true, skill: true, gogmaReset: true },
    skill: { idealPositions: [8], resetSkillsLimit: 10, conversionLimit: 11 },
    bonus: { resetIdealPositions: [12], resetLayoutByPosition: new Map([[12, 'L']]), keepIdealPositionsByLayout: new Map([['L', [13]]]), keepUnsupportedLayouts: [] },
    sources, excludedOwnedWeapons: [],
  }
  return {
    optionSet: BUILD_LIST_OPTIMIZATION_REACH_OPTION_SET.id, continuesCurrentIdealLanes,
    originSkill: 7, originGogma: 10, originNormal: {}, window: { skill: 4, gogma: 6, normal: 3 },
    scanned: { skill: { from: 7, to: 11 }, gogma: { from: 10, to: 15 }, normal: {} },
    targets: [row],
    summary: { predictions: { skill: 0, gogmaReset: 0, gogmaKeep: 0, normal: 0 }, memoHits: { skill: 0, gogmaReset: 0, gogmaKeep: 0, normal: 0 }, supportQueries: 0, groups: [], unsupported: [] },
  }
}

const keys = (reach: ReachTable) => [...enumerateReachOptions(reach.targets[0]!, reach)].map(option =>
  `${option.skillRequired.kind === 'none' ? 'none' : `${option.skillRequired.kind}:${option.skillRequired.finalPosition}`}|${option.bonusRequired.kind === 'none' ? 'none' : `${option.bonusRequired.kind}:${option.bonusRequired.finalPosition}`}`)

describe('Build List global optimization option set', () => {
  it('is one frozen option set that continues current-Ideal lanes', () => {
    expect(BUILD_LIST_OPTIMIZATION_REACH_OPTION_SET).toEqual({ id: 'build-list-optimization-reach-options:v1', continuesCurrentIdealLanes: true })
    expect(Object.isFrozen(BUILD_LIST_OPTIMIZATION_REACH_OPTION_SET)).toBe(true)
    expect(() => assertReachOptionSet(BUILD_LIST_OPTIMIZATION_REACH_OPTION_SET)).not.toThrow()
  })

  it.each([
    ['no id', { continuesCurrentIdealLanes: true }],
    ['an empty id', { id: '', continuesCurrentIdealLanes: true }],
    ['no rule', { id: 'build-list-optimization-reach-options:v1' }],
    ['a non-boolean rule', { id: 'build-list-optimization-reach-options:v1', continuesCurrentIdealLanes: 'yes' }],
    ['null', null],
  ])('refuses %s before any scan', (_label, value) => {
    expect(() => assertReachOptionSet(value as never)).toThrow(RangeError)
  })

  it('continues a single current-Ideal lane, and never on a protected or a both-Ideal source', () => {
    expect(sourceLaneAdmission(gogma({ currentSkillIdeal: true }), true)).toEqual({ skill: 'none_then_operations', bonus: 'operations_only' })
    expect(sourceLaneAdmission(gogma({ currentBonusIdeal: true }), true)).toEqual({ skill: 'operations_only', bonus: 'none_then_operations' })
    expect(sourceLaneAdmission(gogma({ currentSkillIdeal: true, currentBonusIdeal: true }), true)).toEqual({ skill: 'none_only', bonus: 'none_only' })
    expect(sourceLaneAdmission(gogma({ currentSkillIdeal: true, currentBonusIdeal: true, isProtected: true }), true)).toEqual({ skill: 'none_only', bonus: 'none_only' })
    // Without continuation (the rule the Research keeps for its earlier option set) a current-Ideal lane is `none` only.
    expect(sourceLaneAdmission(gogma({ currentSkillIdeal: true }), false)).toEqual({ skill: 'none_only', bonus: 'operations_only' })
    const normal: SourceCandidate = { kind: 'owned_normal', ownedWeaponId: 'owned.option-set.n' as OwnedWeaponId, layout: 'L', isProtected: false, keepSupported: true }
    expect(sourceLaneAdmission(normal, true)).toEqual({ skill: 'operations_only', bonus: 'operations_only' })
  })

  it('reads the rule from the table: the same row enumerates the continuations only under the continuing rule', () => {
    const source = gogma({ currentSkillIdeal: true })
    const bonus = ['reset:12', 'keep_from_source:13', 'reset_then_keep:13']
    expect(keys(table(false, [source]))).toEqual(bonus.map(value => `none|${value}`))
    expect(keys(table(true, [source]))).toEqual([...bonus.map(value => `none|${value}`), ...bonus.map(value => `reset_skills:8|${value}`)])
  })

  it('refuses a table that names no rule instead of reading it as either one', () => {
    const reach = table(true, [gogma()])
    const planningTargets = [{ id: reach.targets[0]!.targetWeaponId, priority: 3 as const }]
    expect(createResourceAssignmentSearch(reach, planningTargets, { nodeBudget: 10, mrvLookahead: 2 }).kind).toBe('search')
    const withoutRule = { ...reach } as Partial<ReachTable>
    delete withoutRule.continuesCurrentIdealLanes
    expect(createResourceAssignmentSearch(withoutRule as ReachTable, planningTargets, { nodeBudget: 10, mrvLookahead: 2 })).toEqual({
      kind: 'invalid_input', reason: 'invalid_reach_table', detail: 'The ReachTable names no option rule (continuesCurrentIdealLanes).',
    })
  })
})
