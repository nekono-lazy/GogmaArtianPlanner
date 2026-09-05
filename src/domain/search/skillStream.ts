import type {
  GroupSkillId,
  OwnedWeaponId,
  RouteOperation,
  SeriesSkillId,
  TargetWeapon,
} from '../models/publicTypes'
import type { RngEngine, SkillPredictionResult } from '../rng/rngEngine'
import { hasConfirmedSkillInputs } from './searchRngInputs'
import type { SearchExecutionContext } from './searchExecution'
import type { CandidateSearchInput } from './searchTypes'

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
  /** Solves the stream from `startSkillCounter`, reusing memoized predictions. */
  solve(startSkillCounter: number): Promise<SkillStreamSolutionSet>
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
  input: CandidateSearchInput,
  engine: RngEngine,
  execution: SearchExecutionContext,
  isSkillPredictionSupported: () => boolean,
): TargetSkillStream {
  const predictions = new Map<number, SkillPredictionResult>()
  const sets = new Map<number, Promise<SkillStreamSolutionSet>>()

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

  async function build(startSkillCounter: number): Promise<SkillStreamSolutionSet> {
    const steps: SkillStreamStep[] = []
    const solutions: SkillStreamSolution[] = []
    let skillCounter = startSkillCounter
    for (let index = 0; index < input.settings.maxSkillAdvance; index += 1) {
      await execution.checkpoint()
      const skills = predictAt(skillCounter)
      const skillCounterAfter = engine.advanceSkillCounter(skillCounter, {
        type: 'reset_skills',
      })
      steps.push({ skillCounterBefore: skillCounter, skillCounterAfter })
      solutions.push({
        resetCount: index + 1,
        seriesSkillId: skills.seriesSkillId,
        groupSkillId: skills.groupSkillId,
      })
      skillCounter = skillCounterAfter
    }
    return { startSkillCounter, steps, solutions }
  }

  return {
    isAvailable: () =>
      hasConfirmedSkillInputs(input) &&
      engine.capabilities.supportsSkillPrediction &&
      isSkillPredictionSupported(),
    predictAt,
    solve: (startSkillCounter) => {
      const cached = sets.get(startSkillCounter)
      if (cached) return cached
      const pending = build(startSkillCounter)
      sets.set(startSkillCounter, pending)
      return pending
    },
  }
}
