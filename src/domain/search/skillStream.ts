import type {
  GroupSkillId,
  OwnedWeaponId,
  RngState,
  RouteOperation,
  SeriesSkillId,
  TargetWeapon,
} from '../models/publicTypes'
import type { RngEngine, SkillPredictionResult } from '../rng/rngEngine'
import { hasConfirmedSkillInputs } from './searchRngInputs'
import type { SearchExecutionContext } from './searchExecution'
import type { SearchMasterSubset } from './searchTypes'

/**
 * The semantic Skill stream input plus one explicit depth bound.
 *
 * The stream needs the Skill RNG inputs, the Master subset, and how many Reset
 * Skills positions it may cover. It deliberately does not take a
 * `CandidateSearchInput`: `searchRunId`, the route/result filters, and the rest
 * of `CandidateSearchSettings` are not stream inputs, and the Planner-driven
 * constrained enumerator (SEARCH_SPEC 5.6.7) supplies its own bound from
 * `ConstrainedEnumerationBounds` rather than from `CandidateSearchSettings`.
 *
 * `maxSkillAdvance` keeps its SEARCH_SPEC 3.1 meaning: the maximum Reset Skills
 * count, not the number of covered Skill Counter positions.
 */
export interface SkillStreamInput {
  rngState: RngState
  master: SearchMasterSubset
  maxSkillAdvance: number
}

export interface SkillStreamStep {
  skillCounterBefore: number
  skillCounterAfter: number
}

/**
 * One Skill stream solution. `resetCount` is the Skill stream operation count
 * itself; `resetCount = 0` is the Route base's own current Skills and is never
 * part of a solved set because it is Route-base dependent, not stream data.
 */
export interface SkillStreamSolution {
  resetCount: number
  seriesSkillId: SeriesSkillId | null
  groupSkillId: GroupSkillId | null
}

export interface SkillStreamSolutionSet {
  startSkillCounter: number
  /** `steps[i]` is the (i + 1)-th Reset Skills operation of this stream. */
  steps: readonly SkillStreamStep[]
  /** Reset Skills solutions with `resetCount` 1 ... `maxSkillAdvance`. */
  solutions: readonly SkillStreamSolution[]
}

/**
 * The Skill stream of one TargetWeapon. The stream depends only on
 * `(TargetWeaponId, baseSeed, skillCounter)`, never on the Gogma state, the
 * source OwnedWeapon, or the Normal offset, so it is solved once per starting
 * Skill Counter and shared by every Route base.
 */
export interface TargetSkillStream {
  /** Confirmed Skill inputs plus Engine and input-level Skill prediction support. */
  isAvailable(): boolean
  /**
   * The memoized Skill prediction at one absolute Skill Counter position. Used
   * for the initial Skill assignment of `convert_normal_to_gogma`, which shares
   * the same positions as the Reset Skills solutions.
   */
  predictAt(skillCounter: number): SkillPredictionResult
  readDepth(startSkillCounter: number, depth: number): Promise<SkillStreamSolutionSet & { exhausted: boolean }>
  /** Standalone full-prefix adapter; scheduling uses readDepth. */
  solve(startSkillCounter: number, through?: number): Promise<SkillStreamSolutionSet>
}

export function resetSkillsOperations(
  set: SkillStreamSolutionSet,
  resetCount: number,
  sourceOwnedWeaponId: OwnedWeaponId | null,
): RouteOperation[] {
  return set.steps.slice(0, resetCount).map((step) => ({
    type: 'reset_skills',
    sourceOwnedWeaponId,
    skillCounterBefore: step.skillCounterBefore,
    skillCounterAfter: step.skillCounterAfter,
  }))
}

export function createTargetSkillStream(
  target: TargetWeapon,
  input: SkillStreamInput,
  engine: RngEngine,
  execution: SearchExecutionContext,
  isSkillPredictionSupported: () => boolean,
): TargetSkillStream {
  const predictions = new Map<number, SkillPredictionResult>()
  const sets = new Map<number, { steps: SkillStreamStep[]; solutions: SkillStreamSolution[]; counter: number }>()

  function predictAt(skillCounter: number): SkillPredictionResult {
    const cached = predictions.get(skillCounter)
    if (cached) return cached
    const predicted = engine.predictSkills({
      baseSeed: input.rngState.baseSeed.value as string,
      skillCounter,
      weaponTypeId: target.weaponTypeId,
      elementId: target.elementId,
      master: input.master,
    })
    predictions.set(skillCounter, predicted)
    return predicted
  }

  async function ensure(startSkillCounter: number, through: number) {
    const limit = Math.min(input.maxSkillAdvance, Math.max(0, through))
    let set = sets.get(startSkillCounter)
    if (!set) {
      set = { steps: [], solutions: [], counter: startSkillCounter }
      sets.set(startSkillCounter, set)
    }
    while (set.steps.length < limit) {
      await execution.checkpoint()
      const skillCounter = set.counter
      const skills = predictAt(skillCounter)
      const skillCounterAfter = engine.advanceSkillCounter(skillCounter, {
        type: 'reset_skills',
      })
      set.steps.push({ skillCounterBefore: skillCounter, skillCounterAfter })
      set.solutions.push({
        resetCount: set.steps.length,
        seriesSkillId: skills.seriesSkillId,
        groupSkillId: skills.groupSkillId,
      })
      set.counter = skillCounterAfter
    }
    return set
  }

  return {
    isAvailable: () =>
      hasConfirmedSkillInputs(input) &&
      engine.capabilities.supportsSkillPrediction &&
      isSkillPredictionSupported(),
    predictAt,
    readDepth: async (startSkillCounter, depth) => {
      const set = await ensure(startSkillCounter, depth)
      return { startSkillCounter, steps: set.steps,
        solutions: set.solutions[depth - 1] ? [set.solutions[depth - 1]] : [],
        exhausted: depth >= input.maxSkillAdvance }
    },
    solve: async (startSkillCounter, through = input.maxSkillAdvance) => {
      const set = await ensure(startSkillCounter, through)
      const limit = Math.min(input.maxSkillAdvance, Math.max(0, through))
      return { startSkillCounter, steps: set.steps.slice(0, limit), solutions: set.solutions.slice(0, limit) }
    },
  }
}
