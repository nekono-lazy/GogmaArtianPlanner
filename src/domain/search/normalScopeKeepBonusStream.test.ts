import { describe, expect, it } from 'vitest'
import type { RestorationBonusSet, RngState, TargetWeapon } from '../models/publicTypes'
import { loadMasterData } from '../master/loadMasterData'
import { keepFamilyLayout } from '../rng/gogmaBonusFamily'
import { ProductionRngEngine } from '../rng/production/productionRngEngine'
import { createValidRngState, createValidTargetWeapon } from '../../test/fixtures/domainData'
import {
  bonusAmendmentOperationType,
  bonusStreamBaseKey,
  createTargetBonusStream,
  type BonusStreamBase,
  type BonusStreamInput,
} from './bonusStream'
import { createSearchExecutionContext } from './searchExecution'
import { createSearchPredictionSupport } from './searchPredictionSupport'
import type { SearchMasterSubset } from './searchTypes'

/**
 * The decisive question for Keep is whether the five current slots are known,
 * never which scope they carry (`docs/SEARCH_SPEC.md` 5.9, `docs/RNG_SPEC.md`
 * 6.1). This drives the real `ProductionRngEngine` over the real Master, so the
 * mapping-aware family layout and the Production Keep support are both exercised.
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
    artianBonusTypeMappings: result.data.artianBonusTypeMappings,
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

/** Inherited normal-scope slots: sharpness / element / element / attack / attack. */
function inheritedNormalScopeBonuses(): RestorationBonusSet {
  return [
    bonus('bonus_type.normal_sharpness', 'bonus_rank.base'),
    bonus('bonus_type.element', 'bonus_rank.base'),
    bonus('bonus_type.element', 'bonus_rank.base'),
    bonus('bonus_type.attack', 'bonus_rank.base'),
    bonus('bonus_type.attack', 'bonus_rank.base'),
  ] as unknown as RestorationBonusSet
}

/** The same family layout in Gogma-tier spelling and higher tiers. */
function gogmaScopeSameLayout(): RestorationBonusSet {
  return [
    bonus('bonus_type.gogma_sharpness_capacity', 'bonus_rank.ex'),
    bonus('bonus_type.element', 'bonus_rank.ii'),
    bonus('bonus_type.element', 'bonus_rank.ex'),
    bonus('bonus_type.attack', 'bonus_rank.iii'),
    bonus('bonus_type.attack', 'bonus_rank.ii'),
  ] as unknown as RestorationBonusSet
}

/** The same multiset with two slots swapped: a different ordered layout. */
function swappedNormalScopeBonuses(): RestorationBonusSet {
  return [
    bonus('bonus_type.element', 'bonus_rank.base'),
    bonus('bonus_type.normal_sharpness', 'bonus_rank.base'),
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

function normalScopeBase(bonuses: RestorationBonusSet | null): BonusStreamBase {
  return { startGogmaCounter: START_GOGMA_COUNTER, bonuses, restorationBonusScope: 'normal_artian' }
}

function gogmaScopeBase(bonuses: RestorationBonusSet): BonusStreamBase {
  return { startGogmaCounter: START_GOGMA_COUNTER, bonuses, restorationBonusScope: 'gogma_artian' }
}

describe('Bonus stream Keep from known normal-scope current bonuses', () => {
  it('Keeps an inherited normal-scope base directly at depth 1 and yields gogma scope', async () => {
    const set = await solve(normalScopeBase(inheritedNormalScopeBonuses()))
    expect(set.unsupportedPredictions).toEqual([])
    const directKeep = set.solutions.filter((solution) => solution.depth === 1 && solution.lastResetDepth === 0)
    expect(directKeep).toHaveLength(1)
    expect(bonusAmendmentOperationType(directKeep[0]!, 1)).toBe('keep_bonuses')
    expect(directKeep[0]!.restorationBonusScope).toBe('gogma_artian')
    // Keep preserves each slot's family: the Normal-side Sharpness slot becomes
    // the Gogma-side Sharpness / Capacity family in the same position.
    expect(keepFamilyLayout(directKeep[0]!.bonuses, master())).toEqual([
      'bonus_type.gogma_sharpness_capacity',
      'bonus_type.element',
      'bonus_type.element',
      'bonus_type.attack',
      'bonus_type.attack',
    ])
    expect(directKeep[0]!.bonuses[0].bonusTypeId).toBe('bonus_type.gogma_sharpness_capacity')
    // Reset is still offered at the same depth; both are first amendments.
    expect(set.solutions.some((solution) => solution.depth === 1 && solution.lastResetDepth === 1)).toBe(true)
  })

  it('produces the same solutions as the identical family layout in Gogma-tier spelling and tiers', async () => {
    const normal = await solve(normalScopeBase(inheritedNormalScopeBonuses()))
    const gogma = await solve(gogmaScopeBase(gogmaScopeSameLayout()))
    expect(normal.solutions).toEqual(gogma.solutions)
    expect(normal.steps).toEqual(gogma.steps)
  })

  it('never Keeps a blind base before its first Reset and Keeps after it', async () => {
    const set = await solve(normalScopeBase(null))
    const firstDepth = set.solutions.filter((solution) => solution.depth === 1)
    expect(firstDepth.length).toBeGreaterThan(0)
    expect(firstDepth.every((solution) => solution.lastResetDepth === 1)).toBe(true)
    const keepAfterReset = set.solutions.filter(
      (solution) => solution.depth === 2 && solution.lastResetDepth === 1,
    )
    expect(keepAfterReset).toHaveLength(1)
    expect(bonusAmendmentOperationType(keepAfterReset[0]!, 2)).toBe('keep_bonuses')
    // The unknown-input exclusion is not a prediction-support gap.
    expect(set.unsupportedPredictions).toEqual([])
  })

  it('shares one stream identity per ordered family layout, whichever scope or tier spells it', () => {
    const keepMaster = master()
    expect(bonusStreamBaseKey(normalScopeBase(inheritedNormalScopeBonuses()), keepMaster))
      .toBe(bonusStreamBaseKey(gogmaScopeBase(gogmaScopeSameLayout()), keepMaster))
    expect(bonusStreamBaseKey(normalScopeBase(inheritedNormalScopeBonuses()), keepMaster))
      .not.toBe(bonusStreamBaseKey(normalScopeBase(swappedNormalScopeBonuses()), keepMaster))
    expect(bonusStreamBaseKey(normalScopeBase(null), keepMaster))
      .not.toBe(bonusStreamBaseKey(normalScopeBase(inheritedNormalScopeBonuses()), keepMaster))
  })
})
