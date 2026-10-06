import { describe, expect, it, vi } from 'vitest'
import type { RestorationBonus, RestorationBonusSet } from '../models/publicTypes'
import { loadMasterData } from '../master/loadMasterData'
import { ProductionRngEngine } from '../rng/production/productionRngEngine'
import { keepFamilyLayoutKey } from '../rng/gogmaBonusFamily'
import { gameVerifiedGogmaKeepVector } from '../../test/fixtures/gameVerifiedGogmaVectors'
import { createCandidateSearchEngine, createCandidateSearchInput } from '../../test/fixtures/candidateSearch'
import bonusStreamSource from './bonusStream.ts?raw'
import { createTargetBonusStream, type BonusStreamBase, type ReservedGogmaDepthObservation } from './bonusStream'
import { createCounterReservation, EMPTY_COUNTER_RESERVATION } from './counterReservation'
import { createSearchExecutionContext } from './searchExecution'
import { createSearchPredictionSupport } from './searchPredictionSupport'

/*
 * Global Planner Research Phase 2-C2.6-B2-C2B2J (Issue #154): a held-aware
 * Keep-generated state reuses its parent's ordered family layout key instead of
 * recomputing `keepFamilyLayoutKey()` from the Keep result
 * (`reserved_keep_family_layout_key_reuse_v1`). Keep preserves the family of
 * every slot in place and rerolls only the tier (`docs/RNG_SPEC.md` 6.1), so the
 * two keys are equal; a Reset result still has its key computed from its slots.
 * The stream, its frontier and both Searches are unchanged (the frozen records
 * of predictKeepNestedCache.test.ts, reservedBonusStreamSinglePass.test.ts and
 * the Planner Alternative publication tests stay equal).
 */

vi.mock('../rng/gogmaBonusFamily', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../rng/gogmaBonusFamily')>()
  return { ...actual, keepFamilyLayoutKey: vi.fn(actual.keepFamilyLayoutKey) }
})
const keepFamilyLayoutKeySpy = vi.mocked(keepFamilyLayoutKey)

// ---------------------------------------------------------------- A: the contract, on the Production Engine

function master() {
  const result = loadMasterData()
  if (!result.ok) throw new Error(JSON.stringify(result.issues))
  return {
    weaponBonusDefinitions: result.data.weaponBonusDefinitions,
    weaponTypes: result.data.weaponTypes,
    bonusRanks: result.data.bonusRanks,
    elements: result.data.elements,
    bonusTypes: result.data.bonusTypes,
    artianBonusTypeMappings: result.data.artianBonusTypeMappings,
  }
}
const bonus = (bonusTypeId: string, bonusRankId: string) => ({ bonusTypeId, bonusRankId }) as unknown as RestorationBonus
const set = (...slots: RestorationBonus[]) => slots as unknown as RestorationBonusSet

describe('reserved Keep family layout key reuse: the Keep contract (RNG_SPEC 6.1)', () => {
  it('A: every Production Keep result has the ordered family layout key of its current slots (Gogma and normal-scope spelling, chained Keeps)', () => {
    const engine = new ProductionRngEngine()
    const inputMaster = master()
    const keep = gameVerifiedGogmaKeepVector
    const layouts: Array<{ weaponTypeId: string; elementId: string; current: RestorationBonusSet }> = [
      { weaponTypeId: keep.weaponTypeId, elementId: keep.elementId, current: keep.currentBonuses as unknown as RestorationBonusSet },
      { weaponTypeId: 'weapon.long_sword', elementId: 'element.fire', current: set(bonus('bonus_type.attack', 'bonus_rank.base'), bonus('bonus_type.attack', 'bonus_rank.base'),
        bonus('bonus_type.affinity', 'bonus_rank.base'), bonus('bonus_type.element', 'bonus_rank.base'), bonus('bonus_type.normal_sharpness', 'bonus_rank.base')) },
      { weaponTypeId: 'weapon.long_sword', elementId: 'element.fire', current: set(bonus('bonus_type.element', 'bonus_rank.ii'), bonus('bonus_type.attack', 'bonus_rank.ex'),
        bonus('bonus_type.gogma_sharpness_capacity', 'bonus_rank.ex'), bonus('bonus_type.affinity', 'bonus_rank.iii'), bonus('bonus_type.attack', 'bonus_rank.ii')) },
    ]
    let checked = 0
    for (const { weaponTypeId, elementId, current } of layouts) {
      const parentKey = keepFamilyLayoutKey(current, inputMaster)
      for (let gogmaCounter = 0; gogmaCounter < 120; gogmaCounter += 1) {
        let slots = current
        // A Keep of a Keep result keeps the same layout too.
        for (let chain = 0; chain < 2; chain += 1) {
          slots = engine.predictGogmaBonus({ baseSeed: String(keep.baseSeed), gogmaCounter: gogmaCounter + chain, weaponTypeId, elementId,
            operation: { type: 'keep_bonuses', currentBonuses: slots }, master: inputMaster })
          expect(keepFamilyLayoutKey(slots, inputMaster)).toBe(parentKey)
          checked += 1
        }
      }
    }
    expect(checked).toBe(720)
  })
})

// ---------------------------------------------------------------- B - F: the held-aware stream

const ATTACK = 'bonus_type.fixture.attack'
const ELEMENT = 'bonus_type.fixture.element'
const UTILITY = 'bonus_type.fixture.utility'
const SHARPNESS = 'bonus_type.fixture.sharpness'
const RANKS = ['bonus_rank.fixture.low', 'bonus_rank.fixture.middle', 'bonus_rank.fixture.high'] as const
const LAYOUTS = [
  [ATTACK, ATTACK, ELEMENT, UTILITY, SHARPNESS],
  [ELEMENT, ATTACK, ATTACK, UTILITY, UTILITY],
  [ATTACK, ELEMENT, ATTACK, UTILITY, UTILITY],
] as const
const withTiers = (types: readonly string[], offset: number) =>
  types.map((bonusTypeId, slot) => ({ bonusTypeId, bonusRankId: RANKS[(offset + slot) % RANKS.length]! })) as unknown as RestorationBonusSet
const BLIND: BonusStreamBase = { startGogmaCounter: 10, bonuses: null, restorationBonusScope: 'normal_artian' }
const KNOWN: BonusStreamBase = { startGogmaCounter: 10, bonuses: withTiers(LAYOUTS[1], 0), restorationBonusScope: 'gogma_artian' }

/**
 * A fixture stream whose Engine follows the Keep contract (the layout kept, the tier a function of the Counter) and never calls
 * `keepFamilyLayoutKey()` itself; every Reset / Keep result object is remembered so a key computation can be attributed to it.
 */
function fixtureStream(held: number[] | null) {
  const input = createCandidateSearchInput()
  const engine = createCandidateSearchEngine(input, { keepSupported: true })
  const resetResults = new WeakSet<object>()
  const keepResults = new WeakSet<object>()
  engine.predictGogmaBonus = ({ gogmaCounter, operation }) => {
    const predicted = operation.type === 'reset_bonuses'
      ? withTiers(LAYOUTS[gogmaCounter % LAYOUTS.length]!, gogmaCounter)
      : withTiers(operation.currentBonuses.map(slot => slot.bonusTypeId), gogmaCounter * 2 + 1)
    ;(operation.type === 'reset_bonuses' ? resetResults : keepResults).add(predicted)
    return predicted
  }
  engine.advanceGogmaCounter = (counter) => counter + 1
  const target = input.targetWeapons[0]!
  const depthEvents: ReservedGogmaDepthObservation[] = []
  const stream = createTargetBonusStream(
    target,
    { rngState: input.rngState, master: input.master, maxGogmaAdvance: 5,
      reservation: held === null ? EMPTY_COUNTER_RESERVATION : createCounterReservation(held, []) },
    engine,
    createSearchExecutionContext(),
    createSearchPredictionSupport(engine, target, input.master),
    (event) => { depthEvents.push({ ...event }) },
  )
  return { input, stream, resetResults, keepResults, depthEvents }
}

async function readAll(stream: ReturnType<typeof fixtureStream>['stream'], base: BonusStreamBase) {
  const depths = []
  for (let depth = 1; ; depth += 1) {
    const read = await stream.readReservedDepth(base, depth)
    depths.push(read)
    if (read.exhausted) break
    if (depth > 32) throw new Error('the held-aware stream never became exhausted')
  }
  return depths
}

describe('reserved Keep family layout key reuse: the held-aware stream', () => {
  it.each([
    ['no held position, blind base', null, BLIND],
    ['held positions, blind base', [11, 12, 13], BLIND],
    ['held positions, known base', [10, 12], KNOWN],
  ] as const)('%s: B / C / D - a Reset result gets one key computation per generated Reset state, a Keep result none', async (_, held, base) => {
    const fixture = fixtureStream(held === null ? null : [...held])
    keepFamilyLayoutKeySpy.mockClear()
    const depths = await readAll(fixture.stream, base)
    const solutions = depths.flatMap(read => read.solutions)
    const resetStates = solutions.filter(solution => solution.lastResetDepth === solution.depth)
    const keepStates = solutions.filter(solution => solution.lastResetDepth !== solution.depth)
    expect(resetStates.length).toBeGreaterThan(0)
    expect(keepStates.length).toBeGreaterThan(resetStates.length)
    for (const solution of resetStates) expect(fixture.resetResults.has(solution.bonuses)).toBe(true)
    for (const solution of keepStates) expect(fixture.keepResults.has(solution.bonuses)).toBe(true)
    const callsOn = (results: WeakSet<object>) => keepFamilyLayoutKeySpy.mock.calls.filter(([bonuses]) => results.has(bonuses)).length
    // B: the Reset path computes the key from the Reset result, once per generated Reset state.
    expect(callsOn(fixture.resetResults)).toBe(resetStates.length)
    // C / D: no key is ever computed from a Keep result (the parent's key is passed in).
    expect(callsOn(fixture.keepResults)).toBe(0)
  })

  it.each([
    ['no held position, blind base', null, BLIND],
    ['held positions, blind base', [11, 12, 13], BLIND],
    ['held positions, known base', [10, 12], KNOWN],
  ] as const)('%s: A / E - every Keep state\'s layout is its parent\'s, and the frontier reduction groups exactly by (position, recomputed layout)', async (_, held, base) => {
    const fixture = fixtureStream(held === null ? null : [...held])
    const depths = await readAll(fixture.stream, base)
    const key = (bonuses: RestorationBonusSet) => keepFamilyLayoutKey(bonuses, fixture.input.master)
    let keepStates = 0
    depths.forEach((read, index) => {
      for (const solution of read.solutions) {
        if (solution.lastResetDepth === solution.depth) continue
        keepStates += 1
        const parent = solution.results.previous?.result.restorationBonuses ?? base.bonuses
        expect(parent).not.toBeNull()
        expect(key(solution.bonuses)).toBe(key(parent!))
      }
      // The observer's frontier / layout counts come from the reused keys; recomputing every key gives the same grouping.
      const observed = fixture.depthEvents[index]!
      const position = (solution: typeof read.solutions[number]) => solution.steps.at(-1)!.gogmaCounterBefore
      expect(observed.familyLayouts).toBe(new Set(read.solutions.map(solution => key(solution.bonuses))).size)
      expect(observed.frontierStates).toBe(new Set(read.solutions.map(solution => `${position(solution)}\u0000${key(solution.bonuses)}`)).size)
    })
    expect(keepStates).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------- C - F: the source shape of the change

describe('reserved Keep family layout key reuse: source shape', () => {
  const lines = bonusStreamSource.split(/\r?\n/)
  const fnStart = lines.findIndex(line => line === '  function reservedGeneratedState(')
  const fnEnd = lines.findIndex((line, index) => index > fnStart && line === '  }')
  const fn = lines.slice(fnStart, fnEnd + 1).join('\n')

  it('C: the Keep call site passes the parent\'s key; B: the Reset call site computes it from the Reset result', () => {
    expect(bonusStreamSource.split('generated.push(reservedGeneratedState(depth, state.lastResetDepth, bonuses, state.familyLayoutKey, state.results, position, gogmaCounterAfter))').length).toBe(2)
    expect(bonusStreamSource.split('generated.push(reservedGeneratedState(depth, depth, bonuses, keepFamilyLayoutKey(bonuses, input.master), parent?.results ?? null, position, gogmaCounterAfter))').length).toBe(2)
    expect(bonusStreamSource.match(/reservedGeneratedState\(/g)).toHaveLength(3)
  })

  it('D: reservedGeneratedState() takes the key as an explicit input and never computes one', () => {
    expect(fnStart).toBeGreaterThan(0)
    expect(fn).toMatch(/\n {4}familyLayoutKey: string,\n/)
    expect(fn).not.toMatch(/keepFamilyLayoutKey\(|keepFamilyLayout\(|keepFamilyOfBonus\(/)
    expect(fn).toMatch(/\n {6}familyLayoutKey,\n/)
  })

  it('E / F: the frontier reduction key, the nested predictKeep memo and the Reset memo are unchanged', () => {
    expect(bonusStreamSource.split('const key = `${state.position}\\u0000${state.familyLayoutKey}`').length).toBe(2)
    expect(bonusStreamSource).toContain('const keepPredictions = new Map<number, Map<string, RestorationBonusSet>>()')
    expect(bonusStreamSource).toContain('const resetPredictions = new Map<number, RestorationBonusSet>()')
    expect(bonusStreamSource).toContain('    const byFamilyLayout = keepPredictions.get(gogmaCounter)\n    const cached = byFamilyLayout?.get(familyLayoutKey)\n')
    expect(bonusStreamSource).toContain('const bonuses = predictKeep(position, state.familyLayoutKey, state.bonuses)')
  })
})
