import { vi } from 'vitest'
import type {
  BonusTypeId,
  OwnedGogmaArtianWeapon,
  OwnedNormalArtianWeapon,
  RestorationBonusSet,
} from '../../domain/models/publicTypes'
import { keepFamilyLayout, keepFamilyLayoutKey } from '../../domain/rng/gogmaBonusFamily'
import type { RngEngineCapabilities, RngPredictionSupportInput } from '../../domain/rng/rngEngine'
import { createCandidateSearchEngine, createCandidateSearchInput, practicalOnlyBonuses } from './candidateSearch'
import { DOMAIN_FIXTURE_TIME, ownedWeaponId } from './domainData'
import {
  frontierKeepResult,
  frontierKeepTierRanks,
  IDEAL_SERIES,
  keepCompatiblePracticalBonuses,
  keepContractGuard,
  type FrontierKeepTier,
} from './plannerAlternativeFrontier'

/*
 * Issue #154 Global Assignment Phase D-0A-2a: the synthetic Search fixture shared by the
 * Production golden of the seams the shape-constrained Route search (Research-only until Issue #260 PR-2) touches and by
 * that seam's own tests (`docs/PLANNER_GLOBAL_ASSIGNMENT_D0A2_DESIGN.md` 15).
 *
 * It is the Planner Alternative frontier fixture (`plannerAlternativeFrontier.ts`: Counters Normal 4,
 * Skill 7, Gogma 10, every advance +1, the RNG_SPEC 6.1 contract-valid fake Keep) plus what those
 * tests need beyond it: owned Normal Artian sources, protected sources, per-axis extents, a
 * predicted Normal per Counter position, support answers per prediction kind, an Engine capability
 * override and a log of every prediction support query. It is built directly rather than on top of
 * `frontierFixture()`, so no Engine method is spied twice. Nothing here is Production behavior: the
 * fake Engine never stands for a game rule.
 */

export type SeamBonuses = 'ideal' | 'practical' | 'keep_compatible_practical'

export interface SeamFixtureOptions {
  /** One value for every axis, or one per axis. Default 5. */
  extent?: number | { normal: number; gogma: number; skill: number }
  /** Owned Gogma sources `owned.fixture.<i>` (`gogma_artian` scope). */
  owned?: Array<{ bonuses: SeamBonuses; idealSkill: boolean; protected?: boolean }>
  /** Owned rarity-8 Normal sources `owned.normal.<i>` (`normal_artian` scope). */
  ownedNormals?: Array<{ bonuses?: Exclude<SeamBonuses, 'ideal'>; protected?: boolean }>
  /** A confirmed Normal Counter (`weapon.fixture.a:8` at 4); otherwise none at all. */
  normalCounter?: boolean
  /** The predicted Normal five slots at a Normal Counter position (default the Practical-only slots). */
  normalAt?: (normalCounter: number) => Exclude<SeamBonuses, 'ideal'>
  /** Reset Bonuses result at a Gogma Counter: the Ideal five slots, or the Practical-only ones. */
  resetIdealAt?: (gogmaCounter: number) => boolean
  /** A Reset result other than the Ideal / Practical-only pair (wins over `resetIdealAt`). */
  resetAt?: (gogmaCounter: number) => RestorationBonusSet | null
  /** The tier a Keep rerolls to; the family layout is always kept (RNG_SPEC 6.1). Default `practical`. */
  keepResult?: (gogmaCounter: number, familyLayout: readonly BonusTypeId[]) => FrontierKeepTier
  skillIdealAt?: (skillCounter: number) => boolean
  /** Prediction support answers; supported by default. */
  normalSupported?: boolean
  skillSupported?: boolean
  resetSupported?: boolean
  keepSupportedFor?: (current: RestorationBonusSet) => boolean
  /** Engine capability overrides (the fixture Engine supports every prediction by default). */
  capabilities?: Partial<RngEngineCapabilities>
}

const axis = (extent: SeamFixtureOptions['extent']) =>
  typeof extent === 'object' ? extent : { normal: extent ?? 5, gogma: extent ?? 5, skill: extent ?? 5 }

/** A compact, stable spelling of five slots for the call / query logs. */
export function slotsText(bonuses: RestorationBonusSet | null): string {
  if (bonuses === null) return 'null'
  return bonuses.map((bonus) => `${bonus.bonusTypeId.split('.').pop()}:${bonus.bonusRankId.split('.').pop()}`).join(',')
}

export function seamFixture(options: SeamFixtureOptions = {}) {
  const extent = axis(options.extent)
  const input = createCandidateSearchInput()
  input.settings = { maxNormalAdvance: extent.normal, maxGogmaAdvance: extent.gogma, maxSkillAdvance: extent.skill }
  const ideal = structuredClone(input.targetWeapons[0].idealBonuses)
  const template = input.ownedWeapons[0] as OwnedGogmaArtianWeapon
  const slots = (kind: SeamBonuses): RestorationBonusSet => kind === 'ideal' ? structuredClone(ideal)
    : kind === 'keep_compatible_practical' ? keepCompatiblePracticalBonuses() : practicalOnlyBonuses()
  const gogma = (options.owned ?? []).map((owned, index): OwnedGogmaArtianWeapon => ({
    ...structuredClone(template),
    id: ownedWeaponId(`owned.fixture.${index}`),
    restorationBonuses: slots(owned.bonuses),
    restorationBonusScope: 'gogma_artian',
    seriesSkillId: owned.idealSkill ? IDEAL_SERIES : 'series.other',
    groupSkillId: null,
    isProtected: owned.protected ?? false,
  }))
  const normals = (options.ownedNormals ?? []).map((owned, index): OwnedNormalArtianWeapon => ({
    id: ownedWeaponId(`owned.normal.${index}`),
    kind: 'normal',
    name: `Seam fixture Normal ${index}`,
    weaponTypeId: template.weaponTypeId,
    elementId: template.elementId,
    rarity: 8,
    restorationBonuses: slots(owned.bonuses ?? 'practical'),
    restorationBonusScope: 'normal_artian',
    seriesSkillId: null,
    groupSkillId: null,
    status: null,
    isProtected: owned.protected ?? false,
    executionInProgress: null,
    memo: null,
    createdAt: DOMAIN_FIXTURE_TIME,
    updatedAt: DOMAIN_FIXTURE_TIME,
  }))
  input.ownedWeapons = [...gogma, ...normals]
  if (!options.normalCounter) input.normalCounters = []
  const engine = createCandidateSearchEngine(input, { keepSupported: true })
  if (options.capabilities) {
    (engine as { capabilities: RngEngineCapabilities }).capabilities = { ...engine.capabilities, ...options.capabilities }
  }
  const calls: string[] = []
  const supportQueries: string[] = []
  const skillIdealAt = options.skillIdealAt ?? (() => false)
  const resetIdealAt = options.resetIdealAt ?? (() => false)
  const keepRanks = frontierKeepTierRanks(ideal, input.master)
  const guardKeep = keepContractGuard(input.master)
  vi.spyOn(engine, 'predictNormalArtian').mockImplementation(({ normalCounter }) => {
    calls.push('normal:' + normalCounter)
    return slots(options.normalAt?.(normalCounter) ?? 'practical')
  })
  vi.spyOn(engine, 'predictSkills').mockImplementation(({ skillCounter }) => {
    calls.push('skill:' + skillCounter)
    return { seriesSkillId: skillIdealAt(skillCounter) ? IDEAL_SERIES : 'series.other.' + skillCounter, groupSkillId: null }
  })
  vi.spyOn(engine, 'predictGogmaBonus').mockImplementation(({ gogmaCounter, operation }) => {
    if (operation.type === 'reset_bonuses') {
      calls.push('reset:' + gogmaCounter)
      const custom = options.resetAt?.(gogmaCounter) ?? null
      if (custom !== null) return structuredClone(custom)
      return resetIdealAt(gogmaCounter) ? structuredClone(ideal) : practicalOnlyBonuses()
    }
    calls.push('keep:' + gogmaCounter + ':' + keepFamilyLayoutKey(operation.currentBonuses, input.master))
    const tier = options.keepResult?.(gogmaCounter, keepFamilyLayout(operation.currentBonuses, input.master)) ?? 'practical'
    return guardKeep(gogmaCounter, operation.currentBonuses,
      frontierKeepResult(operation.currentBonuses, tier, keepRanks, input.master))
  })
  const support = engine.getPredictionSupport.bind(engine)
  vi.spyOn(engine, 'getPredictionSupport').mockImplementation((request: RngPredictionSupportInput) => {
    supportQueries.push(request.type === 'gogma_keep' ? `gogma_keep:${slotsText(request.currentBonuses)}` : request.type)
    const refused = (request.type === 'normal_artian' && options.normalSupported === false)
      || (request.type === 'skill' && options.skillSupported === false)
      || (request.type === 'gogma_reset' && options.resetSupported === false)
      || (request.type === 'gogma_keep' && options.keepSupportedFor !== undefined && !options.keepSupportedFor(request.currentBonuses))
    return refused ? { supported: false, reason: 'engine_capability_unavailable' } : support(request)
  })
  vi.spyOn(engine, 'advanceNormalCounter').mockImplementation((counter, operation) => counter + operation.count)
  vi.spyOn(engine, 'advanceSkillCounter').mockImplementation((counter) => counter + 1)
  vi.spyOn(engine, 'advanceGogmaCounter').mockImplementation((counter) => counter + 1)
  return { input, engine, calls, supportQueries, ideal }
}

export type SeamFixture = ReturnType<typeof seamFixture>
