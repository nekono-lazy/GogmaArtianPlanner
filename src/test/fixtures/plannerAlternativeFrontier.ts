import { vi } from 'vitest'
import type {
  BonusTypeId,
  OwnedGogmaArtianWeapon,
  RestorationBonusSet,
  RouteOperation,
} from '../../domain/models/publicTypes'
import {
  keepFamilyLayout,
  keepFamilyLayoutKey,
  keepFamilyOfBonus,
  type KeepFamilyMasterSubset,
} from '../../domain/rng/gogmaBonusFamily'
import type { RngEngine, RngPredictionSupportInput } from '../../domain/rng/rngEngine'
import type { ConstrainedSearchOrigin } from '../../domain/search/constrained/constrainedTypes'
import type { CandidateSearchInput } from '../../domain/search/searchTypes'
import {
  visitPlannerAlternativeCandidates,
  type PlannerAlternativeSearchExecutionOptions,
} from '../../domain/search/alternative/plannerAlternativeSearch'
import {
  emptyPlannerAlternativeReservation,
  type PlannerAlternativeCandidate,
  type PlannerAlternativeSearchInput,
} from '../../domain/search/alternative/plannerAlternativeTypes'
import { createCandidateSearchEngine, createCandidateSearchInput, practicalOnlyBonuses } from './candidateSearch'
import { ownedWeaponId } from './domainData'
import { restorationBonus, restorationBonusSet } from './targetEvaluation'

/*
 * The Planner Alternative Search frontier fixture (SEARCH_SPEC 5.6.8 / 13.2.6),
 * shared by the Phase 1-C frontier tests and the Phase 2-C2.5-D1 Ideal
 * publication characterization. Fixture Counters: Normal 4, Skill 7, Gogma 10;
 * every advance is +1 (+count for a Normal creation).
 *
 * The fake Keep obeys the Keep contract of `docs/RNG_SPEC.md` 6.1 like the
 * Production Engine (Issue #154): it keeps the Keep family of each of the five
 * ordered slots in its own position and rerolls only the tier (rank) inside
 * that family, so the family layout of a Keep result always equals the family
 * layout of its current slots, and the result depends on the current slots only
 * through that layout, never on their ranks. Ideal / Practical are expressed by
 * rank alone: a Keep can turn the Ideal-layout Practical
 * `keepCompatiblePracticalBonuses()` into the Ideal, while no Keep can ever
 * turn `practicalOnlyBonuses()` (a second Utility where the Ideal holds
 * Sharpness, another family layout) into the Ideal; only a Reset changes
 * families. `keepContractGuard()` fails a test whose fake Keep breaks either
 * property. Before Issue #154 B2J the fake Keep returned fixed Ideal /
 * Practical-only five slots whatever the current families were.
 */

export const IDEAL_SERIES = 'series_skill.fixture.a'

/**
 * Practical (neither Ideal nor Alternative) five slots with exactly the family
 * layout of the fixture Target's Ideal: Sharpness at its Practical floor rank
 * instead of the Ideal rank. A Keep rerolling the tiers of this layout may
 * reach the Ideal, unlike a Keep of `practicalOnlyBonuses()`.
 */
export function keepCompatiblePracticalBonuses(): RestorationBonusSet {
  return restorationBonusSet(
    restorationBonus('bonus_type.fixture.attack', 'bonus_rank.fixture.high'),
    restorationBonus('bonus_type.fixture.attack', 'bonus_rank.fixture.high'),
    restorationBonus('bonus_type.fixture.element', 'bonus_rank.fixture.middle'),
    restorationBonus('bonus_type.fixture.utility', 'bonus_rank.fixture.low'),
    restorationBonus('bonus_type.fixture.sharpness', 'bonus_rank.fixture.low'),
  )
}

/**
 * The tier a fake Keep rerolls every slot to, inside the slot's own family:
 * `ideal` the fixture Target's Ideal rank of the family, `practical` its
 * Practical floor rank (the ranks of `keepCompatiblePracticalBonuses()`),
 * `low` the fixture's lowest rank. No tier reads the current ranks.
 */
export type FrontierKeepTier = 'ideal' | 'practical' | 'low'

/** The fixture Master's lowest bonus rank, the `low` Keep tier of every family. */
export const FRONTIER_LOW_RANK = 'bonus_rank.fixture.low'

export interface FrontierKeepTierRanks {
  ideal: ReadonlyMap<string, string>
  practical: ReadonlyMap<string, string>
}

/** The family -> rank tables of the `ideal` / `practical` fake Keep tiers. */
export function frontierKeepTierRanks(ideal: RestorationBonusSet, master: KeepFamilyMasterSubset): FrontierKeepTierRanks {
  return { ideal: familyRanks(ideal, master), practical: familyRanks(keepCompatiblePracticalBonuses(), master) }
}

function familyRanks(bonuses: RestorationBonusSet, master: KeepFamilyMasterSubset): Map<string, string> {
  const ranks = new Map<string, string>()
  for (const bonus of bonuses) {
    const family = keepFamilyOfBonus(bonus, master)
    const known = ranks.get(family)
    if (known !== undefined && known !== bonus.bonusRankId) {
      throw new Error(`Fixture tier table holds two ranks of family ${family}.`)
    }
    ranks.set(family, bonus.bonusRankId)
  }
  return ranks
}

/**
 * The RNG_SPEC 6.1 Keep of the fixture: every slot keeps its Keep family
 * (a Normal-side spelling normalized through the Master mapping) in its own
 * position and takes that family's rank of `tier`.
 */
export function frontierKeepResult(
  current: RestorationBonusSet,
  tier: FrontierKeepTier,
  ranks: FrontierKeepTierRanks,
  master: KeepFamilyMasterSubset,
): RestorationBonusSet {
  return current.map((bonus) => {
    const family = keepFamilyOfBonus(bonus, master)
    const rank = tier === 'low' ? FRONTIER_LOW_RANK : (tier === 'ideal' ? ranks.ideal : ranks.practical).get(family)
    if (rank === undefined) throw new Error(`Fixture Keep has no ${tier} tier for family ${family}.`)
    return restorationBonus(family, rank)
  }) as RestorationBonusSet
}

/**
 * The RNG_SPEC 6.1 Keep contract asserted on every fake Keep result a test
 * hands the stream: the result keeps the ordered family layout of the current
 * slots, and one (Gogma Counter, family layout) always yields the same five
 * slots, because a Keep reads the current slots only through their families.
 * Test fixtures only; nothing here is a Production validation.
 */
export function keepContractGuard(master: KeepFamilyMasterSubset) {
  const seen = new Map<string, string>()
  return (gogmaCounter: number, current: RestorationBonusSet, result: RestorationBonusSet): RestorationBonusSet => {
    const layout = keepFamilyLayoutKey(current, master)
    if (keepFamilyLayoutKey(result, master) !== layout) {
      throw new Error(`Fixture Keep at Gogma ${gogmaCounter} changed the family layout (RNG_SPEC 6.1): `
        + `${JSON.stringify(current)} -> ${JSON.stringify(result)}.`)
    }
    const key = `${gogmaCounter}|${layout}`
    const text = JSON.stringify(result)
    const earlier = seen.get(key)
    if (earlier !== undefined && earlier !== text) {
      throw new Error(`Fixture Keep at Gogma ${gogmaCounter} read the current ranks (RNG_SPEC 6.1): `
        + `one family layout gave ${earlier} and ${text}.`)
    }
    seen.set(key, text)
    return result
  }
}

export interface FrontierFixtureOptions {
  extent?: number
  /**
   * Owned Gogma sources (unprotected, `gogma_artian` scope); none when empty.
   * `practical` is `practicalOnlyBonuses()`, whose family layout differs from
   * the Ideal's; `keep_compatible_practical` is
   * `keepCompatiblePracticalBonuses()`, whose layout is the Ideal's, so a Keep
   * of it may reach the Ideal.
   */
  owned?: Array<{ bonuses: 'ideal' | 'practical' | 'keep_compatible_practical'; idealSkill: boolean }>
  /** A confirmed Normal Counter (predicted Normal Routes); otherwise the blind variant. */
  normalCounter?: boolean
  /** Reset Bonuses result at a Gogma Counter: the Ideal five slots or Practical-only ones. */
  resetIdealAt?: (gogmaCounter: number) => boolean
  /** Whether Reset Bonuses input is supported at all. */
  resetSupported?: boolean
  /**
   * The tier a Keep at a Gogma Counter rerolls to; the family layout is always
   * kept (RNG_SPEC 6.1). The default is `practical`. The callback is handed the
   * ordered family layout of the current slots, never their ranks.
   */
  keepResult?: (gogmaCounter: number, familyLayout: readonly BonusTypeId[]) => FrontierKeepTier
  /** Keep support per current five slots; supported everywhere by default. */
  keepSupportedFor?: (current: RestorationBonusSet) => boolean
  skillIdealAt?: (skillCounter: number) => boolean
}

export function frontierFixture(options: FrontierFixtureOptions = {}) {
  const extent = options.extent ?? 5
  const input = createCandidateSearchInput()
  input.settings = { maxNormalAdvance: extent, maxGogmaAdvance: extent, maxSkillAdvance: extent }
  const ideal = structuredClone(input.targetWeapons[0].idealBonuses)
  const template = input.ownedWeapons[0] as OwnedGogmaArtianWeapon
  input.ownedWeapons = (options.owned ?? []).map((owned, index): OwnedGogmaArtianWeapon => ({
    ...structuredClone(template),
    id: ownedWeaponId(`owned.fixture.${index}`),
    restorationBonuses: owned.bonuses === 'ideal' ? structuredClone(ideal)
      : owned.bonuses === 'keep_compatible_practical' ? keepCompatiblePracticalBonuses() : practicalOnlyBonuses(),
    restorationBonusScope: 'gogma_artian',
    seriesSkillId: owned.idealSkill ? IDEAL_SERIES : 'series.other',
    groupSkillId: null,
    isProtected: false,
  }))
  if (!options.normalCounter) input.normalCounters = []
  const engine = createCandidateSearchEngine(input, { keepSupported: true })
  const calls: string[] = []
  const skillIdealAt = options.skillIdealAt ?? (() => false)
  const resetIdealAt = options.resetIdealAt ?? (() => false)
  const keepRanks = frontierKeepTierRanks(ideal, input.master)
  const guardKeep = keepContractGuard(input.master)
  vi.spyOn(engine, 'predictNormalArtian').mockImplementation(({ normalCounter }) => {
    calls.push('normal:' + normalCounter)
    return practicalOnlyBonuses()
  })
  vi.spyOn(engine, 'predictSkills').mockImplementation(({ skillCounter }) => {
    calls.push('skill:' + skillCounter)
    return { seriesSkillId: skillIdealAt(skillCounter) ? IDEAL_SERIES : 'series.other.' + skillCounter, groupSkillId: null }
  })
  vi.spyOn(engine, 'predictGogmaBonus').mockImplementation(({ gogmaCounter, operation }) => {
    if (operation.type === 'reset_bonuses') {
      calls.push('reset:' + gogmaCounter)
      return resetIdealAt(gogmaCounter) ? structuredClone(ideal) : practicalOnlyBonuses()
    }
    calls.push('keep:' + gogmaCounter + ':' + keepFamilyLayoutKey(operation.currentBonuses, input.master))
    const tier = options.keepResult?.(gogmaCounter, keepFamilyLayout(operation.currentBonuses, input.master)) ?? 'practical'
    return guardKeep(gogmaCounter, operation.currentBonuses,
      frontierKeepResult(operation.currentBonuses, tier, keepRanks, input.master))
  })
  const support = engine.getPredictionSupport.bind(engine)
  vi.spyOn(engine, 'getPredictionSupport').mockImplementation((request: RngPredictionSupportInput) => {
    if (request.type === 'gogma_reset' && options.resetSupported === false) {
      return { supported: false, reason: 'engine_capability_unavailable' }
    }
    if (request.type === 'gogma_keep' && options.keepSupportedFor && !options.keepSupportedFor(request.currentBonuses)) {
      return { supported: false, reason: 'engine_capability_unavailable' }
    }
    return support(request)
  })
  vi.spyOn(engine, 'advanceNormalCounter').mockImplementation((counter, operation) => counter + operation.count)
  vi.spyOn(engine, 'advanceSkillCounter').mockImplementation((counter) => counter + 1)
  vi.spyOn(engine, 'advanceGogmaCounter').mockImplementation((counter) => counter + 1)
  return { input, engine, calls, ideal }
}

export function originOf(input: CandidateSearchInput): ConstrainedSearchOrigin {
  return {
    rngState: input.rngState,
    normalCounters: input.normalCounters,
    ownedWeapons: input.ownedWeapons,
    targetWeapons: input.targetWeapons,
    master: input.master,
    calculationContext: input.calculationContext,
  }
}

export function alternativeInput(input: CandidateSearchInput): PlannerAlternativeSearchInput {
  return {
    origin: originOf(input),
    targetWeaponId: input.targetWeaponId,
    extent: { ...input.settings },
    reservation: emptyPlannerAlternativeReservation,
    excludedRouteKeys: [],
  }
}

export async function collect(
  input: CandidateSearchInput,
  engine: RngEngine,
  limit = Infinity,
  options: PlannerAlternativeSearchExecutionOptions = {},
) {
  const candidates: PlannerAlternativeCandidate[] = []
  const execution = await visitPlannerAlternativeCandidates(alternativeInput(input), engine, (candidate) => {
    candidates.push(candidate)
    return candidates.length >= limit ? 'stop' : 'continue'
  }, options)
  return { candidates, execution }
}

export function counters(operations: readonly RouteOperation[], type: RouteOperation['type']): Array<number | null> {
  return operations.filter((operation) => operation.type === type).map((operation) =>
    'gogmaCounterBefore' in operation ? operation.gogmaCounterBefore
      : 'skillCounterBefore' in operation ? operation.skillCounterBefore
        : operation.type === 'create_normal_artian' ? operation.count : null)
}

