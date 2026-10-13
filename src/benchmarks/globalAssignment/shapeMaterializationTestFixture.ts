/**
 * Test-only helpers of the Phase D-0A-2b shape-constrained materialization (Issue #154, rule `d0a2-v2`): open gates and budgets
 * (test values only, never a registered or default value), the rule's inputs over a `MaterializationScenario`, a capturing Search
 * port, a compact Route text, and the synthetic G1 / G3 scenarios built through the Phase A option factory and the Phase C-1
 * builder. No oracle, no real Export, no real Target or weapon ID.
 */
import type { BuildListEntry, RouteOperation } from '../../domain/models/publicTypes'
import type { PlannerAlternativeCandidate, PlannerAlternativeSearchExecutionOptions } from '../../domain/search/alternative'
import type { ShapeConstrainedSearchInput } from '../../domain/search/research'
import type { CandidateSearchInput } from '../../domain/search/searchTypes'
import { conversion, keep, NONE, reset, resetThenKeep } from './coverageTestFixture'
import { productionShapeMaterializationSearchPort, type ShapeMaterializationInputs, type ShapeMaterializationSearchPort } from './materialize'
import {
  ELEMENT_A, ELEMENT_B, materializationScenario, newNormalSource, OPEN_GATE, ownedSource, REORDERED_GOGMA, SERIES_IDEAL, TARGET, type MaterializationScenario, type ScenarioWithCandidate,
} from './materializationTestFixture'
import type { MaterializationObserver } from './materializationTypes'
import type { ShapeMaterializationSettings, ShapeSearchBudget, ShapeSearchScaleGate } from './shapeMaterializationTypes'
import { seededRandom } from './coverageSearchTestFixture'
import type { MaterializationScenarioSpec } from './materializationTestFixture'
import { IDEAL_BONUSES, IDEAL_FAMILIES_REORDERED_NORMAL, keepToLowRanks, OTHER_FAMILIES, ownedGogma, ownedNormal } from './testFixture'
import type { OwnedWeapon, RestorationBonusSet } from '../../domain/models/publicTypes'

/** A shape gate no fixture request reaches (a test value, never a default). */
export const OPEN_SHAPE_GATE: ShapeSearchScaleGate = {
  maxDepthUpperBound: 1_000_000, maxGogmaGeneratedStateUpperBound: 1_000_000_000, maxNormalForgeCount: 1_000_000, maxConversionWalkPositions: 1_000_000,
}
/** A budget no fixture Search reaches (a test value, never a default). */
export const OPEN_SHAPE_BUDGET: ShapeSearchBudget = {
  maxGogmaGeneratedStates: 1_000_000_000, maxSkillStates: 1_000_000_000, maxSettledWork: 1_000_000_000,
  maxPredictions: { normalArtian: 1_000_000_000, skill: 1_000_000_000, gogmaReset: 1_000_000_000, gogmaKeep: 1_000_000_000 },
}
export const OPEN_SHAPE_SETTINGS: ShapeMaterializationSettings = { projectedSearchScaleGate: OPEN_GATE, shapeSearchScaleGate: OPEN_SHAPE_GATE, shapeSearchBudget: OPEN_SHAPE_BUDGET }

export function shapeInputs(scene: MaterializationScenario, overrides: {
  settings?: ShapeMaterializationSettings
  search?: ShapeMaterializationSearchPort
  shouldCancel?: () => boolean
  observer?: MaterializationObserver
} = {}): ShapeMaterializationInputs {
  return {
    rule: 'd0a2-v2', context: scene.context, table: scene.table, engine: scene.engine, settings: overrides.settings ?? OPEN_SHAPE_SETTINGS,
    ...(overrides.search ? { search: overrides.search } : {}),
    ...(overrides.shouldCancel ? { shouldCancel: overrides.shouldCancel } : {}),
    ...(overrides.observer ? { observer: overrides.observer } : {}),
  }
}

export interface ShapeCapturingPort {
  port: ShapeMaterializationSearchPort
  /** Every shape-constrained seam input, in call order (structured clones). */
  seamInputs: ShapeConstrainedSearchInput[]
  /** The execution options each seam call received. */
  seamOptions: (PlannerAlternativeSearchExecutionOptions | undefined)[]
  /** The Candidates each seam call delivered. */
  delivered: PlannerAlternativeCandidate[][]
  searchInputs: CandidateSearchInput[]
}

/** Records every Search input and output while delegating to `base` (the Production entry points by default). */
export function shapeCapturingPort(base: ShapeMaterializationSearchPort = productionShapeMaterializationSearchPort): ShapeCapturingPort {
  const captured: Omit<ShapeCapturingPort, 'port'> = { seamInputs: [], seamOptions: [], delivered: [], searchInputs: [] }
  return {
    ...captured,
    port: {
      visitShapeConstrainedRouteCandidates: async (input, engine, onCandidate, options) => {
        captured.seamInputs.push(structuredClone(input))
        captured.seamOptions.push(options)
        const list: PlannerAlternativeCandidate[] = []
        captured.delivered.push(list)
        return base.visitShapeConstrainedRouteCandidates(input, engine, candidate => {
          list.push(structuredClone(candidate))
          return onCandidate(candidate)
        }, options)
      },
      searchCandidates: async (input, engine, options) => {
        captured.searchInputs.push(structuredClone(input))
        return base.searchCandidates(input, engine, options)
      },
    },
  }
}

function operationText(operation: RouteOperation): string {
  switch (operation.type) {
    case 'create_normal_artian': return `n${operation.count}@${operation.normalCounterBefore}`
    case 'convert_normal_to_gogma': return `c${operation.skillCounterBefore}`
    case 'reset_bonuses': return `R${operation.gogmaCounterBefore}`
    case 'keep_bonuses': return `K${operation.gogmaCounterBefore}`
    case 'reset_skills': return `S${operation.skillCounterBefore}`
  }
}

/** A Route as compact text: `n2@4` (two forges from 4), `c7`, `R10`, `K13`, `S8`, in Route order. */
export const routeText = (entry: Pick<BuildListEntry, 'candidateSnapshot'>) => entry.candidateSnapshot.route.operations.map(operationText).join(',')

const WINDOW = { skill: 3, gogma: 5, normal: 2 }

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => from + index)

/**
 * A seeded random scenario for the minimal Route lemma's property test (design D0A2 5.5 / 15): two or three of the fixture
 * Targets (a / c share a weapon type and element, b has another element), owned Gogma (Ideal Skills or not; slots of another
 * family multiset, the Ideal families reordered at low tiers, the Ideal families at low tiers, or the Ideal itself; rarely
 * protected) and owned Normals, and random Ideal Skill, Reset, Keep-Ideal and predicted Normal positions over a small window.
 * The table Engine answers every position (it guesses no game rule); nothing here is an expected shape: Phase A and Phase C
 * build every option and structural candidate from it.
 */
export function randomShapeScenarioSpec(seed: number): MaterializationScenarioSpec {
  // The seed is mixed and the first values dropped: the LCG's first outputs of small consecutive seeds lie close together.
  const random = seededRandom(Math.imul(seed, 2_654_435_761) >>> 0)
  for (let index = 0; index < 4; index++) random()
  const chance = (probability: number) => random() < probability
  const choose = <T>(values: readonly T[]): T => values[Math.floor(random() * values.length)]!
  const targets = choose<('a' | 'b' | 'c')[]>([['a', 'b'], ['a', 'c'], ['b', 'c'], ['a', 'b', 'c'], ['a', 'b', 'c']])
  const window = { skill: 3 + Math.floor(random() * 2), gogma: 5 + Math.floor(random() * 3), normal: 2 + Math.floor(random() * 2) }
  const owned: OwnedWeapon[] = []
  const ownedCount = Math.floor(random() * 4)
  for (let index = 0; index < ownedCount; index++) {
    const elementId = chance(0.6) ? ELEMENT_A : ELEMENT_B
    if (chance(0.65)) {
      const restorationBonuses = structuredClone(choose<RestorationBonusSet>([OTHER_FAMILIES, REORDERED_GOGMA, keepToLowRanks(IDEAL_BONUSES), IDEAL_BONUSES]))
      owned.push(ownedGogma(`owned.random.g${index}`, { elementId, restorationBonuses, seriesSkillId: chance(0.5) ? SERIES_IDEAL : 'series_skill.fixture.other', isProtected: chance(0.12) }))
    } else {
      owned.push(ownedNormal(`owned.random.n${index}`, { elementId, restorationBonuses: structuredClone(IDEAL_FAMILIES_REORDERED_NORMAL) }))
    }
  }
  const skillIdeal: Record<string, number[]> = {}
  const reset: Record<string, Record<number, RestorationBonusSet>> = {}
  const normal: Record<string, Record<number, RestorationBonusSet>> = {}
  for (const elementId of [ELEMENT_A, ELEMENT_B]) {
    skillIdeal[elementId] = range(7, 7 + window.skill).filter(() => chance(0.35))
    reset[elementId] = {}
    for (const position of range(10, 10 + window.gogma - 1)) {
      const roll = random()
      if (roll < 0.22) reset[elementId]![position] = structuredClone(IDEAL_BONUSES)
      else if (roll < 0.45) reset[elementId]![position] = structuredClone(REORDERED_GOGMA)
    }
    normal[elementId] = {}
    for (const position of range(4, 4 + window.normal - 1)) if (chance(0.5)) normal[elementId]![position] = structuredClone(IDEAL_FAMILIES_REORDERED_NORMAL)
  }
  const keepIdeal = range(10, 10 + window.gogma - 1).filter(() => chance(0.35))
  return { targets, owned, skillIdeal, reset, keepIdeal, normal, window }
}

/**
 * G1 (design D0A2 6.1): b is a new Normal at 4 converting at 7, whose conversion Skill is already Ideal, continued by Reset
 * Skills to 9 (also Ideal); Reset at 11. `d0a-v1` classifies it `not_executed(search_policy_shape)` (or, without the
 * precheck, never sees the shape delivered).
 */
export async function scenarioG1Continuation(): Promise<ScenarioWithCandidate> {
  const scene = await materializationScenario({
    targets: ['b'], owned: [], skillIdeal: { [ELEMENT_B]: [7, 9] }, reset: { [ELEMENT_B]: { 11: IDEAL_BONUSES } }, window: WINDOW,
  })
  const candidate = scene.candidate([scene.option(TARGET.b, newNormalSource(4), conversion(7, 9), reset(11))])
  return { scene, candidate, shape: { b: candidate.expectedShapes[0]! } }
}

/**
 * G3 upper (design D0A2 3.7): a = an owned Gogma whose current slots carry the Ideal families in another order (layout L) at
 * low tiers, Keep to the Ideal at 14; the Reset at 12 has layout L too, so the Keep state at 12 collapses into the Reset one.
 */
export async function scenarioG3Upper(): Promise<ScenarioWithCandidate> {
  const scene = await materializationScenario({
    targets: ['a'],
    owned: [ownedGogma('owned.g1', { seriesSkillId: SERIES_IDEAL, restorationBonuses: structuredClone(REORDERED_GOGMA) })],
    reset: { [ELEMENT_A]: { 12: REORDERED_GOGMA } },
    keepIdeal: [14],
    window: WINDOW,
  })
  const candidate = scene.candidate([scene.option(TARGET.a, ownedSource('owned.g1'), NONE, keep(14))])
  return { scene, candidate, shape: { a: candidate.expectedShapes[0]! } }
}

/**
 * G3 lower (design D0A2 3.7 / 18.4): a Resets to the Ideal at 12 and is materialized first, so 10 and 11 are held (12 also
 * blocked); c Resets at g1 = 11 and Keeps to the Ideal at 14. The Reset at q = 10 has the layout of the Reset at 11, `10 .. 11`
 * is held and the next non-held position 13 lies before g* = 14: Planner Alternative Search keeps the q history at the
 * minimal cost, the shape-constrained method delivers the minimal Route through 11.
 */
export async function scenarioG3Lower(): Promise<ScenarioWithCandidate> {
  const scene = await materializationScenario({
    targets: ['a', 'c'],
    owned: [ownedGogma('owned.g1', { seriesSkillId: SERIES_IDEAL }), ownedGogma('owned.g2', { seriesSkillId: SERIES_IDEAL })],
    reset: { [ELEMENT_A]: { 10: REORDERED_GOGMA, 11: REORDERED_GOGMA, 12: IDEAL_BONUSES } },
    keepIdeal: [14],
    window: WINDOW,
  })
  const candidate = scene.candidate([
    scene.option(TARGET.a, ownedSource('owned.g1'), NONE, reset(12)),
    scene.option(TARGET.c, ownedSource('owned.g2'), NONE, resetThenKeep(11, 14)),
  ])
  const shape: ScenarioWithCandidate['shape'] = {}
  for (const key of ['a', 'c'] as const) shape[key] = candidate.expectedShapes.find(value => value.targetWeaponId === TARGET[key])!
  return { scene, candidate, shape }
}
