import { describe, expect, it } from 'vitest'
import type { RestorationBonusSet, RngState, TargetWeapon } from '../models/publicTypes'
import { loadMasterData } from '../master/loadMasterData'
import { ProductionRngEngine } from '../rng/production/productionRngEngine'
import { createValidRngState, createValidTargetWeapon } from '../../test/fixtures/domainData'
import {
  bonusAmendmentOperationType,
  createTargetBonusStream,
  type BonusStreamBase,
  type BonusStreamInput,
} from './bonusStream'
import { createSearchExecutionContext } from './searchExecution'
import { createSearchPredictionSupport } from './searchPredictionSupport'
import type { SearchMasterSubset } from './searchTypes'

/**
 * Regression for a real-game report: an owned Gogma Artian weapon holding
 * rank I restoration bonuses excluded every Keep branch as
 * `unsupported_current_bonus`, so the Bonus stream could only reach Keep after
 * an unnecessary Reset.
 *
 * Keep preserves the family of each current slot and rerolls only the tier
 * (`docs/RNG_SPEC.md` 6.1), and Master Data declares Attack / Affinity /
 * Element rank I under `gogma_artian` scope
 * (`docs/RNG_REFERENCE_AUDIT.md` 10.4), so such a slot is a legal current
 * input. This drives the real `ProductionRngEngine` because the defect lived
 * in its prediction support, not in the Search layer.
 */

const BASE_SEED = '8524433'
const START_GOGMA_COUNTER = 45

function master(): SearchMasterSubset {
  const result = loadMasterData()
  if (!result.ok) throw new Error(JSON.stringify(result.issues))
  return {
    weaponBonusDefinitions: result.data.weaponBonusDefinitions,
    weaponTypes: result.data.weaponTypes,
    elements: result.data.elements,
    bonusTypes: result.data.bonusTypes,
    bonusRanks: result.data.bonusRanks,
    lotteries: result.data.lotteries,
    materialCosts: result.data.materialCosts,
  }
}

function target(): TargetWeapon {
  return {
    ...createValidTargetWeapon(),
    weaponTypeId: 'weapon.long_sword',
    elementId: 'element.fire',
  }
}

function rngState(): RngState {
  const state = createValidRngState()
  state.baseSeed = { value: BASE_SEED, isConfirmed: true, source: 'observation' }
  state.gogmaCounter = { value: START_GOGMA_COUNTER, isConfirmed: true, source: 'observation' }
  return state
}

function bonus(bonusTypeId: string, bonusRankId: string) {
  return { bonusTypeId, bonusRankId }
}

/** The reported layout: sharpness / element / element / attack / attack. */
function rankOneBonuses(): RestorationBonusSet {
  return [
    bonus('bonus_type.gogma_sharpness_capacity', 'bonus_rank.base'),
    bonus('bonus_type.element', 'bonus_rank.i'),
    bonus('bonus_type.element', 'bonus_rank.i'),
    bonus('bonus_type.attack', 'bonus_rank.i'),
    bonus('bonus_type.attack', 'bonus_rank.i'),
  ] as unknown as RestorationBonusSet
}

/** The same layout one tier up, which never reproduced the defect. */
function rankTwoBonuses(): RestorationBonusSet {
  return [
    bonus('bonus_type.gogma_sharpness_capacity', 'bonus_rank.base'),
    bonus('bonus_type.element', 'bonus_rank.ii'),
    bonus('bonus_type.element', 'bonus_rank.ii'),
    bonus('bonus_type.attack', 'bonus_rank.ii'),
    bonus('bonus_type.attack', 'bonus_rank.ii'),
  ] as unknown as RestorationBonusSet
}

function inheritedNormalScopeBonuses(): RestorationBonusSet {
  return [
    bonus('bonus_type.normal_sharpness', 'bonus_rank.base'),
    bonus('bonus_type.element', 'bonus_rank.base'),
    bonus('bonus_type.element', 'bonus_rank.base'),
    bonus('bonus_type.attack', 'bonus_rank.base'),
    bonus('bonus_type.attack', 'bonus_rank.base'),
  ] as unknown as RestorationBonusSet
}

async function solve(base: BonusStreamBase, maxGogmaAdvance = 2) {
  const engine = new ProductionRngEngine()
  const searchTarget = target()
  const searchMaster = master()
  const input: BonusStreamInput = {
    rngState: rngState(),
    master: searchMaster,
    maxGogmaAdvance,
  }
  const stream = createTargetBonusStream(
    searchTarget,
    input,
    engine,
    createSearchExecutionContext(),
    createSearchPredictionSupport(engine, searchTarget, searchMaster),
  )
  return stream.solve(base)
}

function gogmaScopeBase(bonuses: RestorationBonusSet): BonusStreamBase {
  return {
    startGogmaCounter: START_GOGMA_COUNTER,
    bonuses,
    restorationBonusScope: 'gogma_artian',
  }
}

describe('Bonus stream Keep branches from a rank I Gogma-scope source', () => {
  it('reports no unsupported Keep input for a rank I current set', async () => {
    const set = await solve(gogmaScopeBase(rankOneBonuses()))
    expect(set.unsupportedPredictions).toEqual([])
  })

  it('reaches Keep directly from the initial state without an intervening Reset', async () => {
    const set = await solve(gogmaScopeBase(rankOneBonuses()))
    const firstDepth = set.solutions.filter((solution) => solution.depth === 1)
    const directKeep = firstDepth.filter((solution) => solution.lastResetDepth === 0)
    expect(directKeep.length).toBeGreaterThan(0)
    expect(bonusAmendmentOperationType(directKeep[0]!, 1)).toBe('keep_bonuses')
    expect(directKeep[0]!.restorationBonusScope).toBe('gogma_artian')
  })

  it('produces the same solutions as the identical layout one tier up', async () => {
    const rankOne = await solve(gogmaScopeBase(rankOneBonuses()))
    const rankTwo = await solve(gogmaScopeBase(rankTwoBonuses()))
    expect(rankOne.solutions).toEqual(rankTwo.solutions)
    expect(rankOne.steps).toEqual(rankTwo.steps)
  })

  it('still emits no first Keep from an inherited normal-scope source', async () => {
    const set = await solve({
      startGogmaCounter: START_GOGMA_COUNTER,
      bonuses: inheritedNormalScopeBonuses(),
      restorationBonusScope: 'normal_artian',
    })
    const firstDepth = set.solutions.filter((solution) => solution.depth === 1)
    expect(firstDepth.length).toBeGreaterThan(0)
    expect(firstDepth.every((solution) => solution.lastResetDepth === 1)).toBe(true)
  })
})
