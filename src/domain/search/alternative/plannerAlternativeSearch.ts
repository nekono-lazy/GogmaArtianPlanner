import type { RestorationBonusSet } from '../../models/publicTypes'
import type { RngEngine } from '../../rng/rngEngine'
import { createTargetBonusStream } from '../bonusStream'
import { candidateStableKey } from '../candidateProcessing'
import { compareConstrainedCandidates } from '../constrained/constrainedCandidateFactory'
import { searchExistingGogmaRoutes } from '../existingGogmaRouteSearch'
import { searchNormalArtianRoutes } from '../normalArtianRouteSearch'
import { searchOwnedNormalArtianRoutes } from '../ownedNormalArtianRouteSearch'
import type { RouteSearchContext } from '../routeSearchShared'
import { createSearchExecutionContext } from '../searchExecution'
import { createSearchPredictionSupport } from '../searchPredictionSupport'
import { createTargetSkillStream } from '../skillStream'
import { TargetSearchScheduler } from '../targetSearchScheduler'
import { createPlannerAlternativeCandidate } from './plannerAlternativeCandidateFactory'
import {
  PlannerAlternativeSearchError,
  type PlannerAlternativeCandidate,
  type PlannerAlternativeCandidateVisitor,
  type PlannerAlternativeSearchExecution,
  type PlannerAlternativeSearchInput,
} from './plannerAlternativeTypes'
import { assertPlannerAlternativeSearchInput } from './plannerAlternativeValidation'

/**
 * Cancellation and Worker yield only. Planner Alternative Search produces no
 * Candidate ID and no timestamp, so it never takes an ID factory or a Clock.
 */
export interface PlannerAlternativeSearchExecutionOptions {
  shouldCancel?: () => boolean
  yieldControl?: () => Promise<void>
}

/**
 * Planner Alternative Search (`docs/SEARCH_SPEC.md` 5.6.8), delivering Ideal
 * Candidates one at a time for as long as the consumer asks for the next one.
 *
 * It is a separate consumer of the modern Candidate Search base, never a call
 * of `searchCandidates()`: the same Route search primitives register the Route
 * bases on the same `TargetSearchScheduler`, the same Skill / Bonus streams
 * predict, and the Phase 1-A composition seam hands each composed Route here
 * instead of to the ordinary materialization. So the initial Search policy of
 * stopping once the canonical Ideal cost is drained does not apply: the queue
 * is driven with `step()` until the consumer stops or the frontier runs out.
 *
 * Delivery order. Compositions settle in non-decreasing operation cost. The
 * compositions of one cost are buffered until no pending work can add another
 * of that cost, then delivered in the 5.6.3 six-key order
 * (`compareConstrainedCandidates()` with the Target's preferred source), so
 * with an empty reservation and the same extent the first delivered Candidate
 * is the ordinary canonical Ideal.
 *
 * Phase 1-B limits (not the complete 5.6.8 search): the frontier is the current
 * modern one, so the initial Search's same-result retention, Cross-only
 * composition and #104 Normal Route base reduction still shape what it can
 * reach; only an empty reservation is accepted. Phase 1-C / Phase 2 complete it
 * behind this same API.
 */
export async function visitPlannerAlternativeCandidates(
  input: PlannerAlternativeSearchInput,
  engine: RngEngine,
  onCandidate: PlannerAlternativeCandidateVisitor,
  options: PlannerAlternativeSearchExecutionOptions = {},
): Promise<PlannerAlternativeSearchExecution> {
  const target = assertPlannerAlternativeSearchInput(input)
  const { origin, extent } = input
  if (engine.version !== origin.calculationContext.rngEngineVersion) {
    throw new PlannerAlternativeSearchError(
      'calculation_context_incompatible',
      'The RNG Engine version does not match the origin CalculationContext.',
    )
  }

  const execution = createSearchExecutionContext({
    shouldCancel: options.shouldCancel,
    yieldControl: options.yieldControl,
  })
  const predictionSupport = createSearchPredictionSupport(engine, target, origin.master)
  const context: RouteSearchContext = {
    target,
    input: {
      rngState: origin.rngState,
      normalCounters: origin.normalCounters,
      ownedWeapons: origin.ownedWeapons,
      master: origin.master,
      maxNormalAdvance: extent.maxNormalAdvance,
    },
    engine,
    execution,
    predictionSupport,
    normalPredictions: new Map<number, RestorationBonusSet>(),
    skillStream: createTargetSkillStream(
      target,
      { rngState: origin.rngState, master: origin.master, maxSkillAdvance: extent.maxSkillAdvance },
      engine,
      execution,
      () => predictionSupport.skill().supported,
    ),
    bonusStream: createTargetBonusStream(
      target,
      { rngState: origin.rngState, master: origin.master, maxGogmaAdvance: extent.maxGogmaAdvance },
      engine,
      execution,
      predictionSupport,
    ),
  }

  let buffered: PlannerAlternativeCandidate[] = []
  let bufferedCost: number | null = null
  const scheduler = new TargetSearchScheduler(context, (composition) => {
    if (bufferedCost !== null && composition.cost !== bufferedCost) {
      throw new Error(
        'Planner Alternative Search received a composition of another cost before the buffered cost was delivered.',
      )
    }
    const candidate = createPlannerAlternativeCandidate(target, origin, composition)
    if (candidate === null) return
    buffered.push(candidate)
    bufferedCost = composition.cost
  })
  // The same registration order as the ordinary Search, with no route filter:
  // the scope is every currently legal Search Route. The searchers' own
  // searched / skipped reports and notices are ordinary Search presentation
  // and are not part of this API.
  for (const search of [searchNormalArtianRoutes, searchOwnedNormalArtianRoutes, searchExistingGogmaRoutes]) {
    await search(context, scheduler)
  }

  const excluded = new Set(input.excludedRouteKeys)
  const seen = new Set<string>()
  let deliveredCandidates = 0
  let excludedCandidates = 0
  let stoppedByConsumer = false

  delivery: for (;;) {
    const next = scheduler.queue.nextLowerBound
    if (bufferedCost !== null && (next === null || next > bufferedCost)) {
      const ready = buffered.sort((left, right) =>
        compareConstrainedCandidates(left, right, target.preferredOwnedWeaponId))
      buffered = []
      bufferedCost = null
      for (const candidate of ready) {
        const key = candidateStableKey(candidate)
        // Only exact semantic duplicates collapse; this is not retention.
        if (seen.has(key)) continue
        seen.add(key)
        if (excluded.has(key)) {
          excludedCandidates += 1
          continue
        }
        deliveredCandidates += 1
        if ((await onCandidate(candidate)) === 'stop') {
          stoppedByConsumer = true
          break delivery
        }
      }
      continue
    }
    if (!(await scheduler.step())) break
  }

  return {
    targetWeaponId: target.id,
    summary: { deliveredCandidates, excludedCandidates },
    stoppedByConsumer,
  }
}
