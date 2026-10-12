import { describe, expect, it } from 'vitest'
import { enumerateReachOptions, reachOptionKey, reachOptionObjective, sourceResourceKey, takeReachOptions } from './reachOptions'
import type { ReachOption, ReachTable, SourceCandidate, TargetReach } from './types'

/*
 * Issue #154 Global Assignment Phase A (design 4.3 / 5.2 / 5.4): lazy, deterministic option
 * enumeration over a hand-built ReachTable row. No Engine is involved here: the table is the input.
 */
const COUNTER = 'w:8'
const table: ReachTable = {
  originSkill: 7, originGogma: 10, originNormal: { [COUNTER]: 4 },
  window: { skill: 4, gogma: 6, normal: 3 },
  scanned: { skill: { from: 7, to: 11 }, gogma: { from: 10, to: 15 }, normal: { [COUNTER]: { from: 4, to: 6 } } },
  targets: [],
  summary: { predictions: { skill: 0, gogmaReset: 0, gogmaKeep: 0, normal: 0 }, memoHits: { skill: 0, gogmaReset: 0, gogmaKeep: 0, normal: 0 }, supportQueries: 0, groups: [], unsupported: [] },
}
const gogma = (id: string, overrides: Partial<Extract<SourceCandidate, { kind: 'owned_gogma' }>> = {}): SourceCandidate =>
  ({ kind: 'owned_gogma', ownedWeaponId: id as SourceCandidate extends { ownedWeaponId: infer T } ? T : never, layout: 'X', scope: 'gogma_artian',
    currentSkillIdeal: false, currentBonusIdeal: false, isProtected: false, keepSupported: true, ...overrides }) as SourceCandidate
const normal = (id: string, layout = 'L'): SourceCandidate => ({ kind: 'owned_normal', ownedWeaponId: id, layout, isProtected: false, keepSupported: true }) as SourceCandidate
const newNormal = (position: number, layout = 'X'): SourceCandidate => ({ kind: 'new_normal', counterId: COUNTER, position, layout, keepSupported: true })

type ReachOverrides = Omit<Partial<TargetReach>, 'bonus' | 'skill'> & { bonus?: Partial<TargetReach['bonus']>; skill?: Partial<TargetReach['skill']> }

function reach(overrides: ReachOverrides = {}): TargetReach {
  return {
    targetWeaponId: 't' as TargetReach['targetWeaponId'], weaponTypeId: 'w' as TargetReach['weaponTypeId'], elementId: 'e' as TargetReach['elementId'],
    normalCounterId: COUNTER, support: { normal: true, skill: true, gogmaReset: true }, sources: [], excludedOwnedWeapons: [],
    ...overrides,
    skill: { idealPositions: [8, 10], resetSkillsLimit: 10, conversionLimit: 11, ...overrides.skill },
    bonus: {
      resetIdealPositions: [12],
      resetLayoutByPosition: new Map([[10, 'X'], [11, 'L'], [12, 'I'], [13, 'X'], [14, 'L']]),
      keepIdealPositionsByLayout: new Map([['I', [11, 13]], ['L', [13, 15]]]),
      keepUnsupportedLayouts: [],
      ...overrides.bonus,
    },
  }
}
const keys = (target: TargetReach) => [...enumerateReachOptions(target, table)].map(option => reachOptionKey(option).replace(/^t\|/, ''))
const bonusOf = (option: ReachOption) => option.bonusRequired

describe('Phase A reach option enumeration', () => {
  it('yields exactly the zero-operation option for an owned Gogma that is already Ideal on both axes', () => {
    const options = [...enumerateReachOptions(reach({ sources: [gogma('g', { currentSkillIdeal: true, currentBonusIdeal: true, isProtected: true })] }), table)]
    expect(options).toEqual([{
      targetWeaponId: 't', source: expect.objectContaining({ ownedWeaponId: 'g' }), skillRequired: { kind: 'none' }, bonusRequired: { kind: 'none' },
      normalRequired: null, streamEnd: { skill: 7, gogma: 10, normal: { [COUNTER]: 4 } }, verification: 'necessary_only',
    }])
    expect(reachOptionObjective(options[0]!, table)).toBe(0)
    expect(reachOptionKey(options[0]!)).toBe('t|owned:g|none|none')
  })

  it('orders an owned Gogma: Reset Skills by position, then Reset, Keep from source, Reset -> Keep by (final, reset)', () => {
    // Layout X is never Keep-Ideal, so no keep_from_source; the Reset -> Keep pairs come from Reset layouts I (12) and L (11, 14).
    expect(keys(reach({ sources: [gogma('g')] }))).toEqual([
      'owned:g|reset_skills:8|reset:12', 'owned:g|reset_skills:8|reset_then_keep:11:13', 'owned:g|reset_skills:8|reset_then_keep:12:13',
      'owned:g|reset_skills:8|reset_then_keep:11:15', 'owned:g|reset_skills:8|reset_then_keep:14:15',
      'owned:g|reset_skills:10|reset:12', 'owned:g|reset_skills:10|reset_then_keep:11:13', 'owned:g|reset_skills:10|reset_then_keep:12:13',
      'owned:g|reset_skills:10|reset_then_keep:11:15', 'owned:g|reset_skills:10|reset_then_keep:14:15',
    ])
    expect(keys(reach({ sources: [gogma('g', { layout: 'I' })] })).filter(key => key.startsWith('owned:g|reset_skills:8|'))).toEqual([
      'owned:g|reset_skills:8|reset:12', 'owned:g|reset_skills:8|keep_from_source:11', 'owned:g|reset_skills:8|keep_from_source:13',
      'owned:g|reset_skills:8|reset_then_keep:11:13', 'owned:g|reset_skills:8|reset_then_keep:12:13', 'owned:g|reset_skills:8|reset_then_keep:11:15', 'owned:g|reset_skills:8|reset_then_keep:14:15',
    ])
    // Bonus already Ideal (gogma_artian): only `none`; Skills already Ideal: only `none`.
    expect(keys(reach({ sources: [gogma('g', { currentBonusIdeal: true })] }))).toEqual(['owned:g|reset_skills:8|none', 'owned:g|reset_skills:10|none'])
    expect(keys(reach({ sources: [gogma('g', { layout: 'I', currentSkillIdeal: true })] })).map(key => key.split('|')[1])).toEqual(['none', 'none', 'none', 'none', 'none', 'none', 'none'])
  })

  it('never offers a Keep from an unsupported layout, through the source or through a Reset', () => {
    const noKeep = keys(reach({ sources: [gogma('g', { layout: 'I', keepSupported: false })] }))
    expect(noKeep.some(key => key.includes('keep_from_source'))).toBe(false)
    expect(noKeep.filter(key => key.includes('reset_then_keep'))).toHaveLength(8)
    const unsupportedL = keys(reach({ sources: [gogma('g', { layout: 'L' })], bonus: { keepUnsupportedLayouts: ['L'] } }))
    expect(unsupportedL.filter(key => key.includes('reset_then_keep') && key.startsWith('owned:g|reset_skills:8|'))).toEqual(['owned:g|reset_skills:8|reset_then_keep:12:13'])
    // A layout of interest listed as unsupported is honoured even if a stale Keep-Ideal list exists for it.
    expect(unsupportedL.some(key => key.includes('keep_from_source'))).toBe(true)
  })

  it('keeps every Reset -> Keep pair ordered reset < final and never pairs a Keep with a later Reset', () => {
    const options = [...enumerateReachOptions(reach({ sources: [gogma('g')] }), table)]
    const pairs = options.map(bonusOf).filter(bonus => bonus.kind === 'reset_then_keep')
    expect(pairs.length).toBeGreaterThan(0)
    for (const pair of pairs) if (pair.kind === 'reset_then_keep') expect(pair.resetPosition).toBeLessThan(pair.finalPosition)
    // Keep-Ideal 11 of layout I exists, but the only Reset producing I is at 12: no (12, 11).
    expect(pairs.some(pair => pair.kind === 'reset_then_keep' && pair.finalPosition === 11)).toBe(false)
  })

  it('enumerates a Normal source as conversion (c, s*) with s* ascending and c from s* down to the origin, conversion <= final', () => {
    const options = [...enumerateReachOptions(reach({ sources: [normal('n')] }), table)]
    const skills = options.map(option => option.skillRequired).filter((skill, index, all) => all.findIndex(other => JSON.stringify(other) === JSON.stringify(skill)) === index)
    expect(skills).toEqual([
      { kind: 'conversion', conversionPosition: 8, finalPosition: 8 }, { kind: 'conversion', conversionPosition: 7, finalPosition: 8 },
      { kind: 'conversion', conversionPosition: 10, finalPosition: 10 }, { kind: 'conversion', conversionPosition: 9, finalPosition: 10 },
      { kind: 'conversion', conversionPosition: 8, finalPosition: 10 }, { kind: 'conversion', conversionPosition: 7, finalPosition: 10 },
    ])
    for (const option of options) {
      expect(option.skillRequired.kind).toBe('conversion')
      if (option.skillRequired.kind === 'conversion') {
        expect(option.skillRequired.conversionPosition).toBeLessThanOrEqual(option.skillRequired.finalPosition)
        expect(option.streamEnd.skill).toBe(option.skillRequired.finalPosition + 1)
      }
      expect(option.normalRequired).toBeNull()
      expect(option.streamEnd.normal).toEqual({ [COUNTER]: 4 })
    }
    // Layout L: keep_from_source at 13 and 15 besides Reset 12 and the Reset -> Keep pairs.
    expect(options.filter(option => JSON.stringify(option.skillRequired) === JSON.stringify(skills[0])).map(option => reachOptionKey(option).split('|')[3])).toEqual([
      'reset:12', 'keep_from_source:13', 'keep_from_source:15', 'reset_then_keep:11:13', 'reset_then_keep:12:13', 'reset_then_keep:11:15', 'reset_then_keep:14:15'])
  })

  it('applies the Skill limits: Reset Skills up to resetSkillsLimit, a conversion up to conversionLimit', () => {
    const target = reach({ skill: { idealPositions: [8, 10, 11], resetSkillsLimit: 9, conversionLimit: 10 }, sources: [gogma('g', { currentBonusIdeal: true }), normal('n')] })
    const all = [...enumerateReachOptions(target, table)]
    expect(all.filter(option => option.skillRequired.kind === 'reset_skills').map(option => option.skillRequired.kind === 'reset_skills' && option.skillRequired.finalPosition)).toEqual([8])
    expect(new Set(all.filter(option => option.skillRequired.kind === 'conversion').map(option => option.skillRequired.kind === 'conversion' && option.skillRequired.finalPosition))).toEqual(new Set([8, 10]))
  })

  it('computes the stream ends and the objective of a new Normal source from its forge position', () => {
    const options = [...enumerateReachOptions(reach({ sources: [newNormal(6, 'I')] }), table)]
    const first = options[0]!
    expect(first.normalRequired).toEqual({ counterId: COUNTER, position: 6 })
    expect(first.skillRequired).toEqual({ kind: 'conversion', conversionPosition: 8, finalPosition: 8 })
    expect(first.bonusRequired).toEqual({ kind: 'reset', finalPosition: 12 })
    expect(first.streamEnd).toEqual({ skill: 9, gogma: 13, normal: { [COUNTER]: 7 } })
    expect(reachOptionObjective(first, table)).toBe(2 + 3 + 3)
    expect(sourceResourceKey(first.source)).toBe(`normal:${COUNTER}:6`)
    expect(reachOptionKey(first)).toBe(`t|normal:${COUNTER}:6|conversion:8:8|reset:12`)
    // A Target without a Normal Counter has no Normal stream end at all.
    const none = [...enumerateReachOptions(reach({ normalCounterId: null, sources: [gogma('g')] }), table)][0]!
    expect(none.streamEnd.normal).toEqual({})
    expect(reachOptionObjective(none, table)).toBe(2 + 3)
  })

  it('walks sources in their listed order and yields no option for a source without a requirement on one axis', () => {
    const target = reach({ sources: [gogma('a'), newNormal(4), normal('b'), gogma('z', { currentSkillIdeal: true, currentBonusIdeal: true })],
      skill: { idealPositions: [8], resetSkillsLimit: 10, conversionLimit: 11 }, bonus: { resetIdealPositions: [], keepIdealPositionsByLayout: new Map(), resetLayoutByPosition: new Map() } })
    expect(keys(target)).toEqual(['owned:z|none|none'])
    const withReset = reach({ sources: target.sources, skill: target.skill, bonus: { resetIdealPositions: [12], keepIdealPositionsByLayout: new Map(), resetLayoutByPosition: new Map() } })
    expect(keys(withReset).map(key => key.split('|')[0])).toEqual(['owned:a', `normal:${COUNTER}:4`, `normal:${COUNTER}:4`, 'owned:b', 'owned:b', 'owned:z'])
  })

  it('is deterministic and yields pairwise distinct options', () => {
    const target = reach({ sources: [gogma('g'), normal('n'), newNormal(5, 'L'), newNormal(6, 'I')] })
    const first = keys(target), second = keys(target)
    expect(second).toEqual(first)
    expect(new Set(first).size).toBe(first.length)
    expect(first.length).toBeGreaterThan(50)
  })

  it('is lazy: the first options of a huge product come out without enumerating the rest, and takeReachOptions stops early', () => {
    const idealPositions = Array.from({ length: 5000 }, (_, index) => 8 + index)
    const resets = Array.from({ length: 5000 }, (_, index) => 10 + index)
    const target = reach({
      sources: Array.from({ length: 3000 }, (_, index) => newNormal(4 + index)),
      skill: { idealPositions, resetSkillsLimit: 100_000, conversionLimit: 100_000 },
      bonus: { resetIdealPositions: resets, resetLayoutByPosition: new Map(), keepIdealPositionsByLayout: new Map() },
    })
    const iterator = enumerateReachOptions(target, table)
    expect(typeof iterator.next).toBe('function')
    const started = performance.now()
    const taken = takeReachOptions(target, table, 3)
    expect(performance.now() - started).toBeLessThan(1000)
    expect(taken.map(option => reachOptionKey(option))).toEqual([
      `t|normal:${COUNTER}:4|conversion:8:8|reset:10`, `t|normal:${COUNTER}:4|conversion:8:8|reset:11`, `t|normal:${COUNTER}:4|conversion:8:8|reset:12`])
    expect(takeReachOptions(target, table, 0)).toEqual([])
    expect(() => takeReachOptions(target, table, -1)).toThrow(RangeError)
    expect(takeReachOptions(reach({ sources: [gogma('g', { currentSkillIdeal: true, currentBonusIdeal: true })] }), table, 5)).toHaveLength(1)
  })
})
