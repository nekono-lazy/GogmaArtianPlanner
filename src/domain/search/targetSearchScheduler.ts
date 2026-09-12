import type {
  BuildCandidate,
  BuildRoute,
  RouteOperation,
  SkillAmendmentResult,
} from '../models/publicTypes'
import {
  bonusAmendmentOperations, bonusAmendmentResults, bonusStreamBaseKey,
  type BonusStreamBase, type UnsupportedAmendmentPrediction,
} from './bonusStream'
import { countRouteOperations } from './candidateFactory'
import { createDeltaCross } from './deltaCross'
import { createIncrementalBonusRetention, createIncrementalSkillRetention } from './incrementalStreamSolutions'
import { createBaseCandidate, existingGogmaRouteKind, type RouteCompositionBase, type RouteSearchContext } from './routeSearchShared'
import { SearchWorkQueue } from './searchWorkQueue'
import { resetSkillsOperations, skillAmendmentResults } from './skillStream'
import {
  buildBonusSolutionSet, buildSkillSolutionSet, type EvaluatedBonusSolution,
  type EvaluatedSkillSolution, type RouteBonusSolution, type RouteSkillSolution,
} from './streamSolutions'

export type BonusStreamNotice =
  | { type: 'route_kind'; kind: BuildRoute['kind'] }
  | { type: 'unsupported'; prediction: UnsupportedAmendmentPrediction }

export interface ScheduledRouteBase {
  kindResolution: RouteCompositionBase['kindResolution']
  sourceOwnedWeaponId: BuildRoute['sourceOwnedWeaponId']
  baseOperations: readonly RouteOperation[]
  /**
   * The Skills `convert_normal_to_gogma` assigns for this base, or `null` when
   * `baseOperations` contains no conversion (SEARCH_SPEC 5.5.2.2).
   *
   * Required rather than optional: an existing-Gogma base's current Skills come
   * from the source weapon, not from a conversion, and must never be reported
   * as a conversion result.
   */
  conversionSkill: SkillAmendmentResult | null
  /**
   * The Route base's own `gogmaAdvance = 0` Bonus solution.
   *
   * `null` means the base has no current five slots at all, which happens only
   * when a blind Normal creation forged a weapon whose bonuses were never
   * predicted (`docs/SEARCH_SPEC.md` 6.1.1). No fabricated bonus set is
   * substituted, the zero-amendment Candidate does not exist, and the Bonus
   * axis starts at the first Reset Bonuses instead. `bonusBase` is then
   * required, because the base can produce no Candidate without it.
   */
  zeroBonus: RouteBonusSolution | null
  zeroSkill: RouteSkillSolution
  /** Null means capability/support unavailable. Current Ideal is checked here. */
  startSkillCounter: number | null
  bonusBase: BonusStreamBase | null
  onBonusNotice?(notice: BonusStreamNotice): void
  onCandidate(candidate: BuildCandidate): void
}

interface Channel<T> {
  retained: T[]
  subscribers: Array<(value: T) => void>
}
interface BonusChannel extends Channel<EvaluatedBonusSolution> {
  notices: BonusStreamNotice[]
  noticeSubscribers: Array<(notice: BonusStreamNotice) => void>
}

/**
 * Target-wide work ownership. A Route base is registered once. Shared channels
 * evaluate/retain each new complete depth once and deliver only retained deltas
 * to existing subscribers. New bases receive the already retained solutions
 * once as their own initial state, without re-evaluating any stream predicate.
 *
 * Every pending item is a Normal/source base, a next stream depth, or a new
 * Cross pair (never the Cartesian product). Its cost is a lower bound on any
 * Candidate it can introduce. Positive depths use the cheapest subscribing
 * base; base registration is monotone, so a later subscriber cannot lower it.
 */
export class TargetSearchScheduler {
  readonly queue = new SearchWorkQueue()
  private readonly skills = new Map<number, Channel<EvaluatedSkillSolution>>()
  private readonly bonuses = new Map<string, BonusChannel>()
  private idealCost: number | null = null

  private readonly context: RouteSearchContext

  constructor(context: RouteSearchContext) { this.context = context }

  addBase(base: ScheduledRouteBase): void {
    const { target, input } = this.context
    const baseCost = countRouteOperations({
      kind: base.kindResolution.type === 'fixed' ? base.kindResolution.kind : 'existing_gogma_mixed',
      sourceOwnedWeaponId: base.sourceOwnedWeaponId, operations: [...base.baseOperations],
    })
    const cross = createDeltaCross((bonus, skill) => {
      const kind = base.kindResolution.type === 'fixed'
        ? base.kindResolution.kind : existingGogmaRouteKind(bonus.solution, skill.solution)
      const cost = baseCost + bonus.solution.gogmaAdvance + skill.solution.resetCount
      this.queue.enqueue({ lowerBound: cost, settle: async () => {
        await this.context.execution.checkpoint()
        const bindSource = (operation: RouteOperation): RouteOperation =>
          operation.type === 'reset_bonuses' || operation.type === 'keep_bonuses' || operation.type === 'reset_skills'
            ? { ...operation, sourceOwnedWeaponId: base.kindResolution.type === 'fixed' ? null : base.sourceOwnedWeaponId }
            : operation
        const candidate = createBaseCandidate(
          this.context, bonus.solution.finalBonuses, bonus.solution.restorationBonusScope,
          skill.solution.seriesSkillId, skill.solution.groupSkillId,
          { kind, sourceOwnedWeaponId: base.sourceOwnedWeaponId, operations: [
            ...base.baseOperations,
            ...bonus.solution.operations.map(bindSource),
            ...skill.solution.operations.map(bindSource),
          ] },
          bonus.solution.amendmentResults,
          skill.solution.amendmentResults,
          base.conversionSkill,
        )
        if (!candidate) return
        base.onCandidate(candidate)
        // Every composed Candidate is an Ideal Candidate, so any Candidate at
        // all settles the cost the canonical-Ideal drain is measured against.
        this.idealCost = Math.min(this.idealCost ?? cost, cost)
      } })
    })

    const bonus = base.zeroBonus === null
      ? null
      : buildBonusSolutionSet(target, input, [base.zeroBonus])[0]
    const skill = buildSkillSolutionSet(target, [base.zeroSkill])[0]
    if (bonus) cross.addBonus(bonus)
    cross.addSkill(skill)
    if (!skill.idealMatch && base.startSkillCounter !== null) {
      const channel = this.skillChannel(base.startSkillCounter, baseCost)
      for (const value of channel.retained) cross.addSkill(value)
      channel.subscribers.push(cross.addSkill)
    }
    if (bonus === null && base.bonusBase === null) {
      throw new Error(
        'A Route base without a zero-amendment Bonus solution requires a Bonus stream base.',
      )
    }
    if (!bonus?.idealMatch && base.bonusBase !== null) {
      const channel = this.bonusChannel(base.bonusBase, baseCost)
      for (const value of channel.retained) cross.addBonus(value)
      channel.subscribers.push(cross.addBonus)
      if (base.onBonusNotice) {
        for (const notice of channel.notices) base.onBonusNotice(notice)
        channel.noticeSubscribers.push(base.onBonusNotice)
      }
    }
  }

  private skillChannel(start: number, baseCost: number): Channel<EvaluatedSkillSolution> {
    const existing = this.skills.get(start)
    if (existing) return existing
    const channel: Channel<EvaluatedSkillSolution> = { retained: [], subscribers: [] }
    this.skills.set(start, channel)
    const retention = createIncrementalSkillRetention(this.context.target)
    const next = (depth: number) => this.queue.enqueue({
      lowerBound: baseCost + depth,
      settle: async () => {
        const delta = await this.context.skillStream.readDepth(start, depth)
        const additions = retention.appendDepth(delta.solutions.map((solution) => ({
          ...solution, estimatedSkillAdvance: solution.resetCount,
          operations: resetSkillsOperations(delta, solution.resetCount, null),
          amendmentResults: skillAmendmentResults(delta, solution.resetCount),
        })))
        for (const value of additions) {
          channel.retained.push(value)
          for (const receive of channel.subscribers) receive(value)
        }
        if (!delta.exhausted) next(depth + 1)
      },
    })
    next(1)
    return channel
  }

  private bonusChannel(base: BonusStreamBase, baseCost: number): BonusChannel {
    const key = bonusStreamBaseKey(base)
    const existing = this.bonuses.get(key)
    if (existing) return existing
    const channel: BonusChannel = { retained: [], subscribers: [], notices: [], noticeSubscribers: [] }
    this.bonuses.set(key, channel)
    const retention = createIncrementalBonusRetention(this.context.target, this.context.input)
    const noticeKeys = new Set<string>()
    const publishNotice = (notice: BonusStreamNotice) => {
      const id = JSON.stringify(notice)
      if (noticeKeys.has(id)) return
      noticeKeys.add(id)
      channel.notices.push(notice)
      for (const receive of channel.noticeSubscribers) receive(notice)
    }
    const next = (depth: number) => this.queue.enqueue({
      lowerBound: baseCost + depth,
      settle: async () => {
        const delta = await this.context.bonusStream.readDepth(base, depth)
        for (const solution of delta.solutions) {
          publishNotice({ type: 'route_kind', kind: solution.lastResetDepth === solution.depth
            ? 'existing_gogma_reset_bonuses'
            : solution.lastResetDepth === 0 ? 'existing_gogma_keep_bonuses' : 'existing_gogma_mixed' })
        }
        for (const prediction of delta.unsupportedPredictions) publishNotice({ type: 'unsupported', prediction })
        const additions = retention.appendDepth(delta.solutions.map((solution) => ({
          gogmaAdvance: solution.depth, lastResetDepth: solution.lastResetDepth,
          finalBonuses: solution.bonuses, restorationBonusScope: solution.restorationBonusScope,
          operations: bonusAmendmentOperations(delta, solution, null),
          amendmentResults: bonusAmendmentResults(solution),
        })))
        for (const value of additions) {
          channel.retained.push(value)
          for (const receive of channel.subscribers) receive(value)
        }
        if (!delta.exhausted) next(depth + 1)
      },
    })
    next(1)
    return channel
  }

  /**
   * Empty queue is formal exhaustion, including no-Candidate/no-future-work.
   * On an Ideal at D, drain ALL pending work with lowerBound <= D (including
   * work discovered during that drain). Only then are the canonical Ideal
   * ties settled. No empty layers or configured-maximum loop.
   * The exhaustive option is an internal oracle for bounded Search tests.
   */
  async run(stopAtIdeal = true): Promise<void> {
    while (this.queue.nextLowerBound !== null) {
      if (stopAtIdeal && this.idealCost !== null && this.queue.nextLowerBound > this.idealCost) break
      await this.context.execution.checkpoint()
      await this.queue.settleNext()
      // Activity signal only. It counts settled work; it never gates, orders,
      // or terminates the queue.
      this.context.execution.onWorkSettled()
    }
  }
}
