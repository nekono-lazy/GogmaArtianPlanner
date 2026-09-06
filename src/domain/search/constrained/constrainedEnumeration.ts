import type {
  RestorationBonusSet,
  RouteOperation,
} from '../../models/publicTypes'
import type { RngEngine } from '../../rng/rngEngine'
import { evaluateSkillCondition, satisfiesIdealBonuses } from '../../target'
import { createTargetBonusStream } from '../bonusStream'
import { crossStreamSolutions } from '../crossComposition'
import { createSearchPredictionSupport } from '../searchPredictionSupport'
import { createSearchExecutionContext } from '../searchExecution'
import { createTargetSkillStream } from '../skillStream'
import {
  evaluateBonusSolutions,
  evaluateSkillSolutions,
  selectBonusAxis,
  selectSkillAxis,
  type EvaluatedBonusSolution,
  type EvaluatedSkillSolution,
  type StreamCategoryPredicate,
} from '../streamSolutions'
import {
  existingGogmaRouteKind,
  routeBonusSolutions,
  routeSkillSolutions,
} from '../routeSearchShared'
import {
  compareConstrainedCandidates,
  constrainedCandidateStableKey,
  createConstrainedCandidate,
} from './constrainedCandidateFactory'
import {
  createConstrainedRouteBases,
  type ConstrainedRouteBase,
} from './constrainedRouteBases'
import {
  ConstrainedSearchError,
  type ConstrainedCandidate,
  type ConstrainedCandidateSearchInput,
  type ConstrainedEnumerationResult,
} from './constrainedTypes'
import { assertConstrainedCandidateSearchInput } from './constrainedValidation'

const streamCategories: readonly StreamCategoryPredicate[] = ['ideal', 'practical']

/**
 * Cancellation and Worker yield only. The constrained enumerator produces no
 * Candidate ID and no timestamp, so it never takes an ID factory or a Clock.
 */
export interface ConstrainedEnumerationExecutionOptions {
  shouldCancel?: () => boolean
  yieldControl?: () => Promise<void>
}

/**
 * The raw, retention-free position solutions of one Route base.
 *
 * B8-B1a composes only the two Cross axes over these arrays. B8-B1b adds lazy
 * off-axis `(B[i], K[j])` evaluation over the same arrays, capped by
 * `maxOffAxisPairEvaluations`, which is why the arrays and the pair evaluation
 * below are kept separate rather than fused into one traversal.
 */
interface ConstrainedBaseSolutions {
  base: ConstrainedRouteBase
  bonusSolutions: EvaluatedBonusSolution[]
  skillSolutions: EvaluatedSkillSolution[]
}

interface StreamBoundStops {
  gogma: boolean
  skill: boolean
}

/**
 * Whether one category's two Cross axes make any off-axis cell (`i > 0` and
 * `j > 0`) available.
 *
 * This is decided in O(1) from the two axis lengths. SEARCH_SPEC 5.6.7 forbids
 * pre-generating the full Cartesian product, so B8-B1a never enumerates or
 * counts the cells: it only records that at least one exists, which is all
 * `exhausted` needs. An axis with a single solution has no off-axis cell at
 * all, so it must not mark the enumeration as incomplete. B8-B1b evaluates the
 * real cells through a lazy frontier and consumes `maxOffAxisPairEvaluations`.
 */
export function hasOffAxisCells(
  bonusAxisLength: number,
  skillAxisLength: number,
): boolean {
  return bonusAxisLength > 1 && skillAxisLength > 1
}

/**
 * Planner-driven constrained candidate enumeration (SEARCH_SPEC 5.6.7,
 * PLANNER_SPEC 9.2.9).
 *
 * This is a separate API from `searchCandidates()` and deliberately does NOT
 * reuse `TargetSearchScheduler`, whose same-result retention, Cross-only
 * horizon, canonical-Ideal termination and bounded output cap are all
 * initial-Search policy. What it does reuse is the retention-free depth output
 * of the existing Skill and Bonus streams, so B1 Skill semantics, B2
 * family-layout frontier dedup, and the Production RNG input-level support
 * contract are unchanged.
 *
 * The enumerator applies none of the following: Practical dominance, the
 * initial Practical horizon, termination at the canonical Ideal,
 * `maxCandidatesPerTarget`, `resultFilter`, or the similar filter. Its only
 * extent authority is `ConstrainedEnumerationBounds`.
 *
 * B8-B1a scope: this returns a fully collected, sorted array. That collector
 * shape is a checkpoint, not the final B8-B1 Production boundary; B8-B1b adds
 * deterministic incremental delivery plus the off-axis lazy frontier. See
 * `ConstrainedEnumerationResult` and `docs/CANDIDATE_SEARCH_REDESIGN.md` 4.3.
 */
export async function enumerateConstrainedCandidates(
  input: ConstrainedCandidateSearchInput,
  engine: RngEngine,
  options: ConstrainedEnumerationExecutionOptions = {},
): Promise<ConstrainedEnumerationResult> {
  const target = assertConstrainedCandidateSearchInput(input)
  const { origin, bounds } = input

  if (engine.version !== origin.calculationContext.rngEngineVersion) {
    throw new ConstrainedSearchError(
      'calculation_context_incompatible',
      'The RNG Engine version does not match the origin CalculationContext.',
    )
  }

  const execution = createSearchExecutionContext({
    shouldCancel: options.shouldCancel,
    yieldControl: options.yieldControl,
  })
  const predictionSupport = createSearchPredictionSupport(
    engine,
    target,
    origin.master,
  )
  const skillStream = createTargetSkillStream(
    target,
    {
      rngState: origin.rngState,
      master: origin.master,
      maxSkillAdvance: bounds.maxSkillResetCount,
    },
    engine,
    execution,
    () => predictionSupport.skill().supported,
  )
  const bonusStream = createTargetBonusStream(
    target,
    {
      rngState: origin.rngState,
      master: origin.master,
      maxGogmaAdvance: bounds.maxGogmaAdvance,
    },
    engine,
    execution,
    predictionSupport,
  )

  const { bases, normalBoundReached } = await createConstrainedRouteBases({
    target,
    origin,
    bounds,
    engine,
    execution,
    predictionSupport,
    skillStream,
    normalPredictions: new Map<number, RestorationBonusSet>(),
    // SEARCH_SPEC 5.6.1 continuation rules, evaluated with the shared Target
    // Domain authority. A stream whose current state already satisfies the
    // Ideal condition contributes only its zero-operation solution, which
    // occupies no Counter position and therefore cannot conflict.
    bonusesSatisfyIdeal: (bonuses, scope) =>
      satisfiesIdealBonuses(target, bonuses, scope, origin.master),
    skillsSatisfyIdeal: (seriesSkillId, groupSkillId) =>
      evaluateSkillCondition(
        target.idealSkillCondition,
        seriesSkillId,
        groupSkillId,
      ),
  })

  const streamBounds: StreamBoundStops = { gogma: false, skill: false }
  const solved: ConstrainedBaseSolutions[] = []
  for (const base of bases) {
    await execution.checkpoint()
    solved.push(await solveBase(base))
  }

  const candidates = new Map<string, ConstrainedCandidate>()
  let examinedCandidates = 0
  let hasUnevaluatedOffAxisPairs = false
  for (const entry of solved) {
    // The Ideal and Practical Cross series can select the same pair, so the
    // pair is composed once per Route base.
    const composed = new Set<string>()
    for (const category of streamCategories) {
      const bonusAxis = selectBonusAxis(entry.bonusSolutions, category)
      const skillAxis = selectSkillAxis(entry.skillSolutions, category)
      hasUnevaluatedOffAxisPairs ||= hasOffAxisCells(
        bonusAxis.length,
        skillAxis.length,
      )
      const pairs = crossStreamSolutions(bonusAxis, skillAxis)
      for (const pair of pairs) {
        const pairKey = `${pair.bonus.index},${pair.skill.index}`
        if (composed.has(pairKey)) continue
        composed.add(pairKey)
        await execution.checkpoint()
        const candidate = evaluatePair(entry.base, pair.bonus, pair.skill)
        if (candidate === null) continue
        examinedCandidates += 1
        if (candidate === 'rejected') continue
        // Two solutions reaching the same result at different Counter positions
        // carry different concrete operations, so only exact semantic
        // duplicates collapse here. This is not a retention rule.
        const key = constrainedCandidateStableKey(candidate)
        if (!candidates.has(key)) candidates.set(key, candidate)
      }
    }
  }

  const stoppedByBound =
    normalBoundReached || streamBounds.gogma || streamBounds.skill
  return {
    targetWeaponId: target.id,
    candidates: [...candidates.values()].sort(compareConstrainedCandidates),
    summary: {
      examinedCandidates,
      // B8-B1a composes the two Cross axes only. Off-axis pairs, capped by
      // `maxOffAxisPairEvaluations`, arrive with B8-B1b.
      evaluatedOffAxisPairs: 0,
      // The two flags are not complements. `stoppedByBound` says a bound
      // truncated the search; `exhausted` says nothing was left uncovered.
      // While off-axis pairs remain unevaluated, neither is true, so B8-B1a
      // never claims exhaustion over an enumeration scope it has not covered.
      exhausted: !stoppedByBound && !hasUnevaluatedOffAxisPairs,
      stoppedByBound,
    },
  }

  /**
   * Reads one Route base's raw Bonus and Skill position solutions.
   *
   * `solve()` returns the full depth prefix each stream published before its
   * initial-Search retention, so the same completed outcome reached at a later
   * Counter position survives as a separate solution here.
   */
  async function solveBase(
    base: ConstrainedRouteBase,
  ): Promise<ConstrainedBaseSolutions> {
    const bonusSet =
      base.bonusBase === null
        ? null
        : await bonusStream.solve(base.bonusBase, bounds.maxGogmaAdvance)
    if (bonusSet !== null && bonusSet.steps.length >= bounds.maxGogmaAdvance) {
      streamBounds.gogma = true
    }
    const skillSet =
      base.startSkillCounter === null
        ? null
        : await skillStream.solve(base.startSkillCounter, bounds.maxSkillResetCount)
    if (skillSet !== null && skillSet.steps.length >= bounds.maxSkillResetCount) {
      streamBounds.skill = true
    }

    return {
      base,
      bonusSolutions: evaluateBonusSolutions(
        target,
        { master: origin.master },
        routeBonusSolutions(
          bonusSet,
          base.zeroBonus,
          base.amendmentSourceOwnedWeaponId,
        ),
      ),
      skillSolutions: evaluateSkillSolutions(
        target,
        routeSkillSolutions(
          skillSet,
          base.zeroSkill,
          base.amendmentSourceOwnedWeaponId,
          base.skillAdvanceOffset,
        ),
      ),
    }
  }

  /**
   * Composes one `(Bonus, Skill)` pair into a Candidate.
   *
   * Returns `null` when the pair is not a Candidate at all (an existing-Gogma
   * base at `d = 0` and `k = 0`, whose operation list would be empty), and
   * `'rejected'` when a complete combination was evaluated against the Target
   * conditions but satisfied neither. Both axis and, later, off-axis pairs go
   * through this one function.
   */
  function evaluatePair(
    base: ConstrainedRouteBase,
    bonus: EvaluatedBonusSolution,
    skill: EvaluatedSkillSolution,
  ): ConstrainedCandidate | 'rejected' | null {
    const kind =
      base.kindResolution.type === 'fixed'
        ? base.kindResolution.kind
        : existingGogmaRouteKind(bonus.solution, skill.solution)
    if (kind === null) return null
    const operations: RouteOperation[] = [
      ...base.baseOperations,
      ...bonus.solution.operations,
      ...skill.solution.operations,
    ]
    if (operations.length === 0) return null
    return (
      createConstrainedCandidate(target, origin, {
        finalBonuses: bonus.solution.finalBonuses,
        restorationBonusScope: bonus.solution.restorationBonusScope,
        seriesSkillId: skill.solution.seriesSkillId,
        groupSkillId: skill.solution.groupSkillId,
        route: {
          kind,
          sourceOwnedWeaponId: base.sourceOwnedWeaponId,
          operations,
        },
      }) ?? 'rejected'
    )
  }
}
