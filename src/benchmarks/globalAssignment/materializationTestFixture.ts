/**
 * Test-only scenarios for the Phase D-0A materialization (Issue #154). A real Phase 0 context and Phase A
 * ReachTable over the synthetic two / three Target fixture, scanned and searched with one deterministic
 * table Engine, and structural candidates assembled from hand-picked options through the Phase A option
 * factory and the Phase C-1 builder. No oracle, no real Export, no real Target or weapon ID.
 */
import type { OwnedWeapon, RestorationBonusSet, TargetWeaponId } from '../../domain/models/publicTypes'
import type { PlannerInput } from '../../domain/planner/plannerTypes'
import { globalResearchDependencies } from '../plannerGlobalOptimizationResearch'
import { createGlobalAssignmentContext } from './context'
import { assignmentOf, conversion, NONE, option as optionOf, reset, resetSkills, resetThenKeep } from './coverageTestFixture'
import type { ExpectedRouteShape, StructuralCandidate } from './coverageTypes'
import type { PlannerAlternativeCandidate, PlannerAlternativeSearchInput } from '../../domain/search/alternative'
import type { CandidateSearchInput, CandidateSearchResult } from '../../domain/search/searchTypes'
import { productionMaterializationSearchPort, type MaterializationInputs, type MaterializationSearchPort } from './materialize'
import type { MaterializationSettings, SearchScaleGate } from './materializationTypes'
import { buildReachTable } from './reachTable'
import { buildStructuralCandidate } from './structuralCandidate'
import { createGlobalAssignmentFixture, createTableEngine, IDEAL_BONUSES, keepToIdealRanks, keepToLowRanks, OTHER_FAMILIES, ownedGogma, type TableEngine, type TableEngineSpec } from './testFixture'
import { REACH_OPTION_SET_A1, type BonusRequirement, type GlobalAssignmentContext, type ReachOption, type ReachOptionSetVersion, type ReachTable, type ReachWindow, type SkillRequirement, type SourceCandidate } from './types'

export const SERIES_IDEAL = 'series_skill.fixture.a'
export const ELEMENT_A = 'element.fixture.a'
export const ELEMENT_B = 'element.fixture.b'
export const TARGET = { a: 'target.fixture.a' as TargetWeaponId, b: 'target.fixture.b' as TargetWeaponId, c: 'target.fixture.c' as TargetWeaponId }
/** A gate no fixture request reaches. */
export const OPEN_GATE: SearchScaleGate = { maxConversionPositions: 1_000_000, maxGogmaLegalWidth: 1_000_000, maxSkillLegalWidth: 1_000_000, maxNormalForgeCount: 1_000_000 }
export const OPEN_SETTINGS: MaterializationSettings = { deliveryCap: 1_000, searchScaleGate: OPEN_GATE }
/** The Ideal families in another slot order with lower tiers (a Gogma-scope Reset result whose Keep can reach the Ideal). */
export const REORDERED_GOGMA: RestorationBonusSet = [
  { bonusTypeId: 'bonus_type.fixture.sharpness', bonusRankId: 'bonus_rank.fixture.low' }, IDEAL_BONUSES[2], IDEAL_BONUSES[3], IDEAL_BONUSES[0],
  { ...IDEAL_BONUSES[1], bonusRankId: 'bonus_rank.fixture.low' },
]

export interface MaterializationScenarioSpec {
  /** The fixture Targets kept as planning Targets (each keeps its own valid Entry). */
  targets: ('a' | 'b' | 'c')[]
  owned: OwnedWeapon[]
  /** Ideal Skill positions per element. */
  skillIdeal?: Record<string, number[]>
  /** Reset results per element and Gogma position (default: a non-Ideal family multiset). */
  reset?: Record<string, Record<number, RestorationBonusSet>>
  /** Gogma positions whose Keep rerolls every tier to the Ideal rank (Ideal iff the layout is an Ideal permutation). */
  keepIdeal?: number[]
  window: ReachWindow
  /** Normal Artian results per element and Normal position (default: a non-Ideal family multiset). D-0A-2b. */
  normal?: Record<string, Record<number, RestorationBonusSet>>
  /** A support answer override (`null` keeps the capability answer); it may read mutable test state. D-0A-2b. */
  support?: TableEngineSpec['support']
  capabilities?: TableEngineSpec['capabilities']
  /** The ReachTable's option set (A-2); a1 by default, the option set every pre-A-2 scenario (and the d0a-v1 golden) used. */
  optionSet?: ReachOptionSetVersion
}

export interface MaterializationScenario {
  table: ReachTable
  context: GlobalAssignmentContext
  input: PlannerInput
  engine: TableEngine['engine']
  calls: TableEngine['calls']
  inputs(overrides?: { settings?: MaterializationSettings; search?: MaterializationSearchPort; shouldCancel?: () => boolean }): MaterializationInputs
  /** The option of one Target from one of its row sources. */
  option(target: TargetWeaponId, source: (value: SourceCandidate) => boolean, skill: SkillRequirement, bonus: BonusRequirement): ReachOption
  /** The Phase C-1 structural candidate of hand-picked options (throws unless Phase C builds one). */
  candidate(options: ReachOption[]): StructuralCandidate
}

export const ownedSource = (id: string) => (source: SourceCandidate) => source.kind !== 'new_normal' && source.ownedWeaponId === id
export const newNormalSource = (position: number) => (source: SourceCandidate) => source.kind === 'new_normal' && source.position === position

export interface ScenarioWithCandidate {
  scene: MaterializationScenario
  candidate: StructuralCandidate
  shape: Partial<Record<'a' | 'b' | 'c', ExpectedRouteShape>>
}

function withCandidate(scene: MaterializationScenario, options: ReachOption[]): ScenarioWithCandidate {
  const candidate = scene.candidate(options)
  const shape: ScenarioWithCandidate['shape'] = {}
  for (const key of ['a', 'b', 'c'] as const) {
    const found = candidate.expectedShapes.find(value => value.targetWeaponId === TARGET[key])
    if (found) shape[key] = found
  }
  return { scene, candidate, shape }
}

const WINDOW: ReachWindow = { skill: 3, gogma: 5, normal: 2 }

export interface CapturingPort {
  port: MaterializationSearchPort
  /** Every Planner Alternative Search input, in call order (structured clones). */
  alternativeInputs: PlannerAlternativeSearchInput[]
  /** The Candidates each Planner Alternative Search delivered, per call. */
  delivered: PlannerAlternativeCandidate[][]
  searchInputs: CandidateSearchInput[]
  searchResults: CandidateSearchResult[]
}

/** Records every Search input and output while delegating to `base` (the Production APIs by default). */
export function capturingPort(base: MaterializationSearchPort = productionMaterializationSearchPort, before?: (kind: 'alternative' | 'candidate', targetWeaponId: string) => void): CapturingPort {
  const captured: Omit<CapturingPort, 'port'> = { alternativeInputs: [], delivered: [], searchInputs: [], searchResults: [] }
  return {
    ...captured,
    port: {
      visitPlannerAlternativeCandidates: async (input, engine, onCandidate, options) => {
        captured.alternativeInputs.push(structuredClone(input))
        const list: PlannerAlternativeCandidate[] = []
        captured.delivered.push(list)
        before?.('alternative', input.targetWeaponId)
        return base.visitPlannerAlternativeCandidates(input, engine, candidate => {
          list.push(structuredClone(candidate))
          return onCandidate(candidate)
        }, options)
      },
      searchCandidates: async (input, engine, options) => {
        captured.searchInputs.push(structuredClone(input))
        before?.('candidate', input.targetWeaponId)
        const result = await base.searchCandidates(input, engine, options)
        captured.searchResults.push(structuredClone(result))
        return result
      },
    },
  }
}

/**
 * A Planner Alternative "Search" that only delivers the given Candidates and then reports `report`
 * (a consumer stop is reported as the real Search reports it). No prediction runs.
 */
export function replayAlternativeSearch(candidates: readonly PlannerAlternativeCandidate[], report: { exhausted: boolean; stoppedByExtent: boolean }): MaterializationSearchPort['visitPlannerAlternativeCandidates'] {
  return async (input, _engine, onCandidate) => {
    let delivered = 0
    for (const candidate of candidates) {
      delivered += 1
      if (await onCandidate(structuredClone(candidate)) === 'stop') {
        return { targetWeaponId: input.targetWeaponId, summary: { deliveredCandidates: delivered, excludedCandidates: 0, exhausted: false, stoppedByExtent: false }, stoppedByConsumer: true, skippedExcludedRouteKeys: [] }
      }
    }
    return { targetWeaponId: input.targetWeaponId, summary: { deliveredCandidates: delivered, excludedCandidates: 0, ...report }, stoppedByConsumer: false, skippedExcludedRouteKeys: [] }
  }
}

/**
 * S1 (Skill origin 7, Gogma origin 10): two owned Gogma with Ideal Skills. a = Reset at 12; c = Reset at 11
 * then Keep at 14. Phase C gives c the chains 10 and 13, so c's own Gogma positions 10, 11, 13, 14 skip a's
 * 12: c is non-continuous and is materialized after a.
 */
export async function scenarioHeldCrossing(): Promise<ScenarioWithCandidate> {
  const scene = await materializationScenario({
    targets: ['a', 'c'],
    owned: [ownedGogma('owned.g1', { seriesSkillId: SERIES_IDEAL }), ownedGogma('owned.g2', { seriesSkillId: SERIES_IDEAL })],
    reset: { [ELEMENT_A]: { 11: REORDERED_GOGMA, 12: IDEAL_BONUSES } },
    keepIdeal: [14],
    window: WINDOW,
  })
  return withCandidate(scene, [
    scene.option(TARGET.a, ownedSource('owned.g1'), NONE, reset(12)),
    scene.option(TARGET.c, ownedSource('owned.g2'), NONE, resetThenKeep(11, 14)),
  ])
}

/**
 * S3: b = new Normal at 5 (Normal origin 4) converting at 7 and Resetting to the Ideal at 11; a = owned Gogma
 * Reset at 12. The projected Search for b returns the cheaper forge at 4 (a different shape), so b falls
 * back to design 9.1, whose second delivered Candidate forges 4..5.
 */
export async function scenarioConversionFallback(): Promise<ScenarioWithCandidate> {
  const scene = await materializationScenario({
    targets: ['a', 'b'],
    owned: [ownedGogma('owned.g1', { seriesSkillId: SERIES_IDEAL })],
    skillIdeal: { [ELEMENT_B]: [7] },
    reset: { [ELEMENT_A]: { 12: IDEAL_BONUSES }, [ELEMENT_B]: { 11: IDEAL_BONUSES } },
    window: WINDOW,
  })
  return withCandidate(scene, [
    scene.option(TARGET.a, ownedSource('owned.g1'), NONE, reset(12)),
    scene.option(TARGET.b, newNormalSource(5), conversion(7, 7), reset(11)),
  ])
}

/**
 * S4: a = owned Gogma (Ideal Bonuses, non-Ideal Skills) Resetting Skills to 8 and covering Skill 7; b = new
 * Normal at 4 converting at 9. b's conversion needs every Skill position below 9 held, so a precedes b.
 */
export async function scenarioSkillDependency(): Promise<ScenarioWithCandidate> {
  const scene = await materializationScenario({
    targets: ['a', 'b'],
    owned: [ownedGogma('owned.g1', { seriesSkillId: 'series_skill.fixture.other', restorationBonuses: structuredClone(IDEAL_BONUSES) })],
    skillIdeal: { [ELEMENT_A]: [8], [ELEMENT_B]: [9] },
    reset: { [ELEMENT_B]: { 11: IDEAL_BONUSES } },
    window: WINDOW,
  })
  return withCandidate(scene, [
    scene.option(TARGET.a, ownedSource('owned.g1'), resetSkills(8), NONE),
    scene.option(TARGET.b, newNormalSource(4), conversion(9, 9), reset(11)),
  ])
}

/**
 * S6: b = new Normal at 4 converting at 7, Reset at 13; a = owned Gogma Reset at 12 covering 10..11. After b,
 * Skill 7 is blocked, so a's design 9.1 scale is Pareto-smaller and design 9.1 runs first for a.
 */
export async function scenarioAlternativeFirst(): Promise<ScenarioWithCandidate> {
  const scene = await materializationScenario({
    targets: ['a', 'b'],
    owned: [ownedGogma('owned.g1', { seriesSkillId: SERIES_IDEAL })],
    skillIdeal: { [ELEMENT_B]: [7] },
    reset: { [ELEMENT_A]: { 12: IDEAL_BONUSES }, [ELEMENT_B]: { 13: IDEAL_BONUSES } },
    window: WINDOW,
  })
  return withCandidate(scene, [
    scene.option(TARGET.a, ownedSource('owned.g1'), NONE, reset(12)),
    scene.option(TARGET.b, newNormalSource(4), conversion(7, 7), reset(13)),
  ])
}

export async function materializationScenario(spec: MaterializationScenarioSpec): Promise<MaterializationScenario> {
  const table = createTableEngine({
    skill: (position, _weaponTypeId, elementId) => ({ seriesSkillId: (spec.skillIdeal?.[elementId] ?? []).includes(position) ? SERIES_IDEAL : 'series_skill.fixture.other', groupSkillId: null }),
    reset: (position, _weaponTypeId, elementId) => structuredClone(spec.reset?.[elementId]?.[position] ?? OTHER_FAMILIES),
    keep: (position, current) => ((spec.keepIdeal ?? []).includes(position) ? keepToIdealRanks(current) : keepToLowRanks(current)),
    ...(spec.normal ? { normal: (position: number, _weaponTypeId: string, elementId: string) => structuredClone(spec.normal?.[elementId]?.[position] ?? OTHER_FAMILIES) } : {}),
    ...(spec.support ? { support: spec.support } : {}),
    ...(spec.capabilities ? { capabilities: spec.capabilities } : {}),
  })
  const fixture = await createGlobalAssignmentFixture({ sameElementTarget: true })
  const kept = new Set(spec.targets.map(key => TARGET[key] as string))
  const input: PlannerInput = {
    ...fixture.input,
    ownedWeapons: structuredClone(spec.owned),
    targetWeapons: fixture.input.targetWeapons.filter(target => kept.has(target.id)),
    buildListEntries: fixture.input.buildListEntries.filter(entry => kept.has(entry.targetWeaponId)),
  }
  const created = createGlobalAssignmentContext(input, globalResearchDependencies(table.engine))
  if (created.kind !== 'context') throw new Error(created.detail)
  const reach = await buildReachTable(created.context, table.engine, spec.window, spec.optionSet ?? REACH_OPTION_SET_A1)
  if (reach.kind !== 'reach_table') throw new Error(JSON.stringify(reach))
  const context = created.context
  const reachTable = reach.table
  return {
    table: reachTable,
    context,
    input,
    engine: table.engine,
    calls: table.calls,
    inputs: overrides => ({
      context, table: reachTable, engine: table.engine,
      settings: overrides?.settings ?? OPEN_SETTINGS,
      ...(overrides?.search ? { search: overrides.search } : {}),
      ...(overrides?.shouldCancel ? { shouldCancel: overrides.shouldCancel } : {}),
    }),
    option: (target, source, skill, bonus) => {
      const row = reachTable.targets.find(value => value.targetWeaponId === target)
      const found = row?.sources.find(source)
      if (!found) throw new Error(`Target ${target} has no such source in the ReachTable.`)
      return optionOf(reachTable, target, found, skill, bonus)
    },
    candidate: options => {
      const built = buildStructuralCandidate(assignmentOf(reachTable, options), { table: reachTable, context, engine: table.engine })
      if (built.kind !== 'structural_candidate') throw new Error(JSON.stringify(built))
      return built.candidate
    },
  }
}
