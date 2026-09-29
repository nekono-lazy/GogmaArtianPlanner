import { vi } from 'vitest'
import type {
  OwnedGogmaArtianWeapon,
  RestorationBonusSet,
  RouteOperation,
} from '../../domain/models/publicTypes'
import { keepFamilyLayoutKey } from '../../domain/rng/gogmaBonusFamily'
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

/*
 * The Planner Alternative Search frontier fixture (SEARCH_SPEC 5.6.8 / 13.2.6),
 * shared by the Phase 1-C frontier tests and the Phase 2-C2.5-D1 Ideal
 * publication characterization. Fixture Counters: Normal 4, Skill 7, Gogma 10;
 * every advance is +1 (+count for a Normal creation).
 */

export const IDEAL_SERIES = 'series_skill.fixture.a'

export interface FrontierFixtureOptions {
  extent?: number
  /** Owned Gogma sources (unprotected, `gogma_artian` scope); none when empty. */
  owned?: Array<{ bonuses: 'ideal' | 'practical'; idealSkill: boolean }>
  /** A confirmed Normal Counter (predicted Normal Routes); otherwise the blind variant. */
  normalCounter?: boolean
  /** Reset Bonuses result at a Gogma Counter: the Ideal five slots or Practical-only ones. */
  resetIdealAt?: (gogmaCounter: number) => boolean
  /** Whether Reset Bonuses input is supported at all. */
  resetSupported?: boolean
  /** Keep Bonuses result; the default keeps the current slots Practical-only. */
  keepResult?: (gogmaCounter: number, current: RestorationBonusSet) => 'ideal' | 'practical' | 'current'
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
    restorationBonuses: owned.bonuses === 'ideal' ? structuredClone(ideal) : practicalOnlyBonuses(),
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
    const result = options.keepResult?.(gogmaCounter, operation.currentBonuses) ?? 'practical'
    return result === 'ideal' ? structuredClone(ideal)
      : result === 'current' ? structuredClone(operation.currentBonuses) : practicalOnlyBonuses()
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

