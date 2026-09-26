import type { RestorationBonusSet } from '../../models/publicTypes'
import type { RngEngine } from '../../rng/rngEngine'
import { createTargetBonusStream, type ReservedGogmaDepthObserver } from '../bonusStream'
import { createCounterReservation, EMPTY_COUNTER_RESERVATION } from '../counterReservation'
import { candidateStableKey } from '../candidateProcessing'
import { compareConstrainedCandidates } from '../constrained/constrainedCandidateFactory'
import { searchExistingGogmaRoutes } from '../existingGogmaRouteSearch'
import { searchNormalArtianRoutes } from '../normalArtianRouteSearch'
import { searchOwnedNormalArtianRoutes } from '../ownedNormalArtianRouteSearch'
import type { RouteSearchContext } from '../routeSearchShared'
import { createSearchExecutionContext } from '../searchExecution'
import { createSearchPredictionSupport } from '../searchPredictionSupport'
import { createTargetSkillStream, type ReservedSkillDepthObserver } from '../skillStream'
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
 * Read-only observers of one search run (Planner Alternative Search Phase 3
 * Browser Worker benchmark, `docs/PLANNER_ALTERNATIVE_BROWSER_WORKER_BENCHMARK.md`).
 *
 * Execution-only, exactly like cancellation and yield: never part of
 * `PlannerAlternativeSearchInput`, the search identity, a Candidate identity,
 * the ordering or the termination. Every callback is invoked after the work it
 * reports, receives aggregate counts only, and returns nothing the search
 * reads, so the delivered Candidates, the summary and the prediction calls are
 * identical with and without it. Every Production caller leaves it undefined.
 */
export interface PlannerAlternativeSearchInstrumentation {
  /** One `TargetSearchScheduler.step()` settled one pending work item. */
  onWorkSettled?: () => void
  /** One held-aware Skill stream depth was generated and published. */
  onSkillReservedDepth?: ReservedSkillDepthObserver
  /** One held-aware Bonus stream depth was generated, published and reduced. */
  onGogmaReservedDepth?: ReservedGogmaDepthObserver
}

/**
 * Cancellation and Worker yield, plus the optional benchmark instrumentation.
 * Planner Alternative Search produces no Candidate ID and no timestamp, so it
 * never takes an ID factory or a Clock.
 */
export interface PlannerAlternativeSearchExecutionOptions {
  shouldCancel?: () => boolean
  yieldControl?: () => Promise<void>
  instrumentation?: PlannerAlternativeSearchInstrumentation
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
 * Frontier. The context carries the `planner_alternative` frontier policy, so
 * none of the initial Search's other policies bounds what is reachable either:
 * every stream position is published (no same-result retention), every Ideal
 * Bonus x Ideal Skill pair of a Route base is composed lazily, one row at a
 * time (no Cross-only), and every predicted Normal offset of the extent is a
 * full Route base (no #104 reduction). The streams, their prediction memos and
 * the B2 family-layout frontier reduction are the ordinary ones, so no
 * prediction depends on how many solutions another stream has.
 *
 * Delivery order. Every work item's lower bound is a lower bound on the
 * operation cost of every Candidate it can lead to, and compositions settle at
 * their exact cost. The compositions of one cost are buffered until no pending
 * work can add another of that cost, then delivered in the 5.6.3 six-key order
 * (`compareConstrainedCandidates()` with the Target's preferred source). So the
 * whole delivered sequence is in that order, and with an empty reservation and
 * the same extent the first delivered Candidate is the ordinary canonical Ideal.
 *
 * Termination. An empty queue ends the search: `stoppedByExtent` when an extent
 * value left reachable work unread, `exhausted` otherwise. A consumer stop sets
 * neither, and cancellation rejects.
 *
 * Reservation (`docs/SEARCH_SPEC.md` 5.6.8, Phase 2). Every Route satisfies the
 * coverage condition on each Counter stream: from the origin to its last own
 * operation, every position is an own operation or held, a blocked position
 * holds no own operation (a blocked Normal position no production target), and
 * a held position without an own operation leaves the weapon unchanged. The
 * streams read held-aware (`readReservedDepth()`), the conversion may cross
 * held Skill positions (`conversionSkillPositions()`), the predicted Normal
 * creation is the canonical held-prefix one (`heldPrefixNormalCreation()`),
 * and an exclusive OwnedWeapon is never a source. A held skip predicts
 * nothing, changes nothing and costs no operation, so the lower bounds and
 * `estimatedOperationCount` stay own operation counts, while the advances are
 * the reach from the origin. The stream-to-stream time order and cyclic waits
 * are the Planner's full rerun to judge, never this search's. An empty
 * reservation searches exactly the Phase 1 frontier.
 */
export async function visitPlannerAlternativeCandidates(
  input: PlannerAlternativeSearchInput,
  engine: RngEngine,
  onCandidate: PlannerAlternativeCandidateVisitor,
  options: PlannerAlternativeSearchExecutionOptions = {},
): Promise<PlannerAlternativeSearchExecution> {
  const { target, reservation } = assertPlannerAlternativeSearchInput(input)
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
  const instrumentation = options.instrumentation
  const predictionSupport = createSearchPredictionSupport(engine, target, origin.master)
  const skillReservation = createCounterReservation(reservation.skill.held, reservation.skill.blocked)
  const gogmaReservation = createCounterReservation(reservation.gogma.held, reservation.gogma.blocked)
  const normalReservations = new Map(reservation.normal.map((entry) =>
    [entry.counterId, createCounterReservation(entry.held, entry.blocked)] as const))
  const originSkillCounter = origin.rngState.skillCounter.value
  const context: RouteSearchContext = {
    frontierPolicy: 'planner_alternative',
    reservation: {
      normal: (counterId) => normalReservations.get(counterId) ?? EMPTY_COUNTER_RESERVATION,
      skill: skillReservation,
      gogma: gogmaReservation,
      exclusiveOwnedWeaponIds: new Set(reservation.exclusiveOwnedWeaponIds),
      // Read only once a confirmed Skill Counter allowed a conversion Route.
      conversionSkillPositionLimit: (originSkillCounter ?? 0) + extent.maxSkillAdvance + 1,
    },
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
      {
        rngState: origin.rngState,
        master: origin.master,
        maxSkillAdvance: extent.maxSkillAdvance,
        reservation: skillReservation,
      },
      engine,
      execution,
      () => predictionSupport.skill().supported,
      instrumentation?.onSkillReservedDepth,
    ),
    bonusStream: createTargetBonusStream(
      target,
      {
        rngState: origin.rngState,
        master: origin.master,
        maxGogmaAdvance: extent.maxGogmaAdvance,
        reservation: gogmaReservation,
      },
      engine,
      execution,
      predictionSupport,
      instrumentation?.onGogmaReservedDepth,
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
  const skippedExcludedRouteKeys: string[] = []
  let stoppedByConsumer = false

  delivery: for (;;) {
    const next = scheduler.queue.nextLowerBound
    if (bufferedCost !== null && (next === null || next > bufferedCost)) {
      const ready = buffered.sort((left, right) =>
        compareConstrainedCandidates(left, right, target.preferredOwnedWeaponId))
      buffered = []
      bufferedCost = null
      for (const candidate of ready) {
        // A long equal-cost flush stays cancellable and yields like any work.
        await execution.checkpoint()
        const key = candidateStableKey(candidate)
        // Only exact semantic duplicates collapse; this is not retention.
        if (seen.has(key)) continue
        seen.add(key)
        if (excluded.has(key)) {
          excludedCandidates += 1
          skippedExcludedRouteKeys.push(key)
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
    instrumentation?.onWorkSettled?.()
  }

  // The frontier ran out unless the consumer stopped first. Whether it ran out
  // naturally or an extent value cut reachable work is the scheduler's record.
  const stoppedByExtent = !stoppedByConsumer && scheduler.stoppedByExtent
  return {
    targetWeaponId: target.id,
    summary: {
      deliveredCandidates,
      excludedCandidates,
      exhausted: !stoppedByConsumer && !stoppedByExtent,
      stoppedByExtent,
    },
    stoppedByConsumer,
    skippedExcludedRouteKeys,
  }
}
