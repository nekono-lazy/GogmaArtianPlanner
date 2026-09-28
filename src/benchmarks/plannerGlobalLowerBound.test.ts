import { describe, expect, it } from 'vitest'
import type { PlannerInput } from '../domain/planner/plannerTypes'
import type { RngEngine } from '../domain/rng/rngEngine'
import { globalResearchFixture } from './plannerGlobalOptimizationTestFixture'
import {
  collectLowerBoundProblem, LowerBoundUnsupportedInputError, singleStreamLowerBounds, solveLowerBoundRelaxation,
  type LowerBoundProblem, type LowerBoundTargetOptions,
} from './plannerGlobalLowerBound'

const target = (id: string, weaponTypeId: string, options: LowerBoundTargetOptions['options']): LowerBoundTargetOptions =>
  ({ targetWeaponId: id, weaponTypeId, elementId: 'element.x', firstIdealSkillPosition: null, firstIdealResetPosition: null, options })
const problem = (targets: LowerBoundTargetOptions[], budget = 100): LowerBoundProblem =>
  ({ budget, skillOrigin: 10, gogmaOrigin: 20, normalOrigins: { w: 0, v: 0 }, targets })

/** Wraps the fixed-table Fake Engine: every input outside its table is a non-Ideal result, never an Ideal guess. */
function scanningEngine(engine: RngEngine): RngEngine {
  const fallback = <T>(call: () => T, value: T) => { try { return call() } catch { return value } }
  return Object.assign(Object.create(Object.getPrototypeOf(engine)), engine, {
    predictSkills: (input: Parameters<RngEngine['predictSkills']>[0]) => fallback(() => engine.predictSkills(input), { seriesSkillId: null, groupSkillId: null }),
    predictGogmaBonus: (input: Parameters<RngEngine['predictGogmaBonus']>[0]) => fallback(() => engine.predictGogmaBonus(input),
      [0, 1, 2, 3, 4].map(() => ({ bonusTypeId: 'bonus_type.fixture.other', bonusRankId: 'bonus_rank.fixture.i' })) as never),
    predictNormalArtian: (input: Parameters<RngEngine['predictNormalArtian']>[0]) => fallback(() => engine.predictNormalArtian(input),
      [0, 1, 2, 3, 4].map(() => ({ bonusTypeId: 'bonus_type.fixture.other', bonusRankId: 'bonus_rank.fixture.i' })) as never),
  }) as RngEngine
}

describe('Phase 2-A.5 lower-bound relaxation', () => {
  it('sums the stream advances at the cheapest feasible thresholds', () => {
    const result = solveLowerBoundRelaxation(problem([
      target('a', 'w', [{ resource: 'owned:1', skillThreshold: 12, gogmaThreshold: 25, normalThreshold: null }]),
      target('b', 'v', [{ resource: 'normal:v:3', skillThreshold: 11, gogmaThreshold: 21, normalThreshold: 4 }]),
    ]))
    expect(result.status).toBe('found')
    expect(result.minimum).toEqual({ total: 2 + 5 + 4, thresholds: { skill: 12, gogma: 25, normal: { w: 0, v: 4 } }, advances: { skill: 2, gogma: 5, normal: { w: 0, v: 4 } } })
    expect(result.provenAtLeast).toBe(11)
  })

  it('never lets two Targets share one source, trading a later Counter for a new Normal', () => {
    const shared = { resource: 'owned:1', skillThreshold: 10, gogmaThreshold: 20, normalThreshold: null }
    const result = solveLowerBoundRelaxation(problem([
      target('a', 'w', [shared]),
      target('b', 'w', [shared, { resource: 'normal:w:5', skillThreshold: 10, gogmaThreshold: 20, normalThreshold: 6 }, { resource: 'owned:2', skillThreshold: 10, gogmaThreshold: 30, normalThreshold: null }]),
    ]))
    // owned:2 (Gogma +10) beats a sixth forge (+6)? No: forging to 6 costs 6 < 10.
    expect(result.minimum?.total).toBe(6)
    expect(result.minimum?.thresholds.normal.w).toBe(6)
  })

  it('does not add single-stream bounds: the joint minimum can exceed their sum and differ from each', () => {
    const p = problem([
      // Either Gogma 30 with no forge, or no Gogma with 8 forges.
      target('a', 'w', [{ resource: 'owned:1', skillThreshold: 10, gogmaThreshold: 30, normalThreshold: null }, { resource: 'normal:w:7', skillThreshold: 10, gogmaThreshold: 20, normalThreshold: 8 }]),
      target('b', 'w', [{ resource: 'owned:2', skillThreshold: 15, gogmaThreshold: 20, normalThreshold: null }]),
    ])
    expect(singleStreamLowerBounds(p)).toMatchObject({ skill: { advance: 5, witnessTargetId: 'b' }, gogma: { advance: 0 }, normal: { w: 0 } })
    expect(solveLowerBoundRelaxation(p).minimum?.total).toBe(5 + 8)
  })

  it('proves nothing below the budget when a Target has no option inside the box', () => {
    const result = solveLowerBoundRelaxation(problem([target('a', 'w', [])], 50))
    expect(result).toMatchObject({ status: 'none_below_budget', provenAtLeast: 50, minimum: null, targetsWithoutOption: ['a'] })
  })

  it('reports none below the budget instead of a minimum at or above it, and records near-minimum rows on request', () => {
    const p = problem([target('a', 'w', [{ resource: 'owned:1', skillThreshold: 30, gogmaThreshold: 40, normalThreshold: null },
      { resource: 'owned:2', skillThreshold: 31, gogmaThreshold: 20, normalThreshold: null }])], 22)
    // owned:1 costs (30 - 10) + (40 - 20) = 40, owned:2 costs 21 + 0 = 21.
    expect(solveLowerBoundRelaxation(p)).toMatchObject({ status: 'found', provenAtLeast: 21, minimum: { total: 21 } })
    const tight = { ...p, budget: 21 }
    expect(solveLowerBoundRelaxation(tight)).toMatchObject({ status: 'none_below_budget', provenAtLeast: 21, minimum: null })
    expect(solveLowerBoundRelaxation(tight, { recordAbove: 30 }).nearMinimum.map(row => row.total)).toEqual([21, 40, 41])
    expect(solveLowerBoundRelaxation(tight, { recordAbove: 30 })).toMatchObject({ status: 'none_below_budget', provenAtLeast: 21 })
  })
})

describe('Phase 2-A.5 lower-bound option collection', () => {
  it('collects per-Target options from the given Engine only and gives a bound below the synthetic oracle', async () => {
    const { input, engine } = await globalResearchFixture()
    const p = collectLowerBoundProblem(input as PlannerInput, scanningEngine(engine), 7)
    expect(p.skillOrigin).toBe(7)
    expect(p.gogmaOrigin).toBe(10)
    expect(p.targets.map(t => [t.firstIdealSkillPosition, t.firstIdealResetPosition])).toEqual([[7, 10], [7, 10]])
    // A Reset reads no current slot, so every scanned Normal position (4..10) is an option.
    const positions = [4, 5, 6, 7, 8, 9, 10].map(n => `normal:weapon.fixture.a:${n}`)
    expect(p.targets.map(t => t.options.map(o => o.resource))).toEqual([positions, positions])
    expect(p.targets[0]!.options[0]).toEqual({ resource: 'normal:weapon.fixture.a:4', skillThreshold: 8, gogmaThreshold: 11, normalThreshold: 5 })
    // The relaxation drops Counter position exclusivity: both Targets may convert at 7 and Reset at 10,
    // so it proves 4, strictly below the 6 physical operations of the synthetic oracle. That is not
    // a proof of optimality for the oracle.
    const result = solveLowerBoundRelaxation(p)
    expect(result.minimum).toMatchObject({ total: 4, advances: { skill: 1, gogma: 1, normal: { 'weapon.fixture.a': 2 } } })
  })

  it('fails closed without a confirmed Normal Counter instead of guessing a blind forge bound', async () => {
    const { input, engine } = await globalResearchFixture()
    const unconfirmed = { ...input, normalCounters: input.normalCounters.map(counter => ({ ...counter, isConfirmed: false })) } as PlannerInput
    expect(() => collectLowerBoundProblem(unconfirmed, scanningEngine(engine), 7)).toThrow(LowerBoundUnsupportedInputError)
  })
})
