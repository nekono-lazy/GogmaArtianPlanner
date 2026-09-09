import type {
  BonusAmendmentResult,
  OwnedWeaponId,
  RestorationBonusScope,
  RestorationBonusSet,
  RngState,
  RouteOperation,
  TargetWeapon,
} from '../models/publicTypes'
import { stableStringify } from '../models/publicTypes'
import { gogmaKeepFamilyLayoutKey } from '../rng/gogmaBonusFamily'
import type { RngEngine, RngPredictionUnsupportedReason } from '../rng/rngEngine'
import type { SearchExecutionContext } from './searchExecution'
import type { SearchPredictionSupport } from './searchPredictionSupport'
import type { SearchMasterSubset } from './searchTypes'
import { compareStableKeys } from './semanticKeys'

/**
 * The semantic Bonus stream input plus one explicit depth bound.
 *
 * As with `SkillStreamInput`, the stream takes only what it actually needs, so
 * the Planner-driven constrained enumerator (SEARCH_SPEC 5.6.7) can bound it
 * with `ConstrainedEnumerationBounds` instead of `CandidateSearchSettings`.
 *
 * `maxGogmaAdvance` keeps its SEARCH_SPEC 3.1 meaning: the number of Gogma
 * Counter positions covered, not the number of Engine calls.
 */
export interface BonusStreamInput {
  rngState: RngState
  master: SearchMasterSubset
  maxGogmaAdvance: number
}

export interface BonusStreamStep {
  gogmaCounterBefore: number
  gogmaCounterAfter: number
}

/**
 * One Bonus stream solution.
 *
 * `depth` is the Bonus stream operation count itself: depth `d` is the `d`-th
 * amendment, performed at Gogma Counter `gogmaCounterBefore + d - 1`.
 * `depth = 0` is the Route base's own current bonuses and is never part of a
 * solved set, because it is Route-base data rather than stream data.
 *
 * `lastResetDepth` is `0` when the state was reached by Keep alone, and `r > 0`
 * when the depth-`r` Reset is its last Reset. Because Reset ignores the current
 * bonuses and Keep depends only on the slot family layout, `(depth,
 * lastResetDepth)` is enough to rebuild the canonical operation sequence.
 */
export interface BonusStreamSolution {
  depth: number
  lastResetDepth: number
  bonuses: RestorationBonusSet
  restorationBonusScope: RestorationBonusScope
  /**
   * The canonical amendment history of this solution, latest amendment first.
   *
   * Observational only: it records which predicted five slots the canonical
   * operation sequence passes through, and never takes part in retention,
   * ordering, frontier reduction, or any Candidate identity.
   */
  results: BonusAmendmentResultNode
}

/**
 * One node of the shared, immutable amendment history list.
 *
 * The list is persistent: a Keep state links to its own parent state's node and
 * a Reset state links to the previous depth's Reset node, so states share every
 * common prefix and the memory stays linear in the number of reached states.
 * Linking a Reset to the previous Reset is exactly the canonical history
 * `bonusAmendmentOperationType()` describes, because Reset discards the current
 * bonuses and therefore cannot depend on which branch preceded it.
 */
export interface BonusAmendmentResultNode {
  readonly depth: number
  readonly result: BonusAmendmentResult
  readonly previous: BonusAmendmentResultNode | null
}

export interface UnsupportedAmendmentPrediction {
  type: 'reset_bonuses' | 'keep_bonuses'
  reason: RngPredictionUnsupportedReason
}

export interface BonusStreamSolutionSet {
  startGogmaCounter: number
  /** `steps[i]` is the (i + 1)-th amendment operation of this stream. */
  steps: readonly BonusStreamStep[]
  /** Every reached Bonus state, before the family layout frontier reduction. */
  solutions: readonly BonusStreamSolution[]
  unsupportedPredictions: readonly UnsupportedAmendmentPrediction[]
}

export interface BonusStreamBase {
  startGogmaCounter: number
  bonuses: RestorationBonusSet
  restorationBonusScope: RestorationBonusScope
}

/**
 * The Bonus stream of one TargetWeapon.
 *
 * Reset ignores the current bonuses, so it is predicted once per Gogma Counter
 * position. Keep preserves each slot's family and rerolls only the tier, so it
 * is predicted once per `(Gogma Counter, ordered family layout)`. Both memos
 * live on the Target, which keeps the prediction count independent of the
 * number of source weapons and Normal offsets.
 */
export interface TargetBonusStream {
  readDepth(base: BonusStreamBase, depth: number): Promise<BonusStreamSolutionSet & { exhausted: boolean }>
  /** Standalone full-prefix adapter; scheduling uses readDepth. */
  solve(base: BonusStreamBase, through?: number): Promise<BonusStreamSolutionSet>
}

const EMPTY_SET = (startGogmaCounter: number): BonusStreamSolutionSet => ({
  startGogmaCounter,
  steps: [],
  solutions: [],
  unsupportedPredictions: [],
})

/** The canonical operation type of amendment `depth` for one solution. */
export function bonusAmendmentOperationType(
  solution: Pick<BonusStreamSolution, 'lastResetDepth'>,
  depth: number,
): 'reset_bonuses' | 'keep_bonuses' {
  return depth <= solution.lastResetDepth ? 'reset_bonuses' : 'keep_bonuses'
}

/**
 * Rebuilds the canonical amendment operation sequence of one solution.
 *
 * Depths `1 ... lastResetDepth` are Reset and the remaining depths are Keep.
 * That is exactly the history the frontier keeps as the representative: Reset
 * discards the current bonuses, so the depth-`r` Reset result is independent of
 * everything before it, and the following Keep chain is determined by the slot
 * family layout alone.
 */
export function bonusAmendmentOperations(
  set: BonusStreamSolutionSet,
  solution: BonusStreamSolution,
  sourceOwnedWeaponId: OwnedWeaponId | null,
): RouteOperation[] {
  return set.steps.slice(0, solution.depth).map((step, index) => ({
    type: bonusAmendmentOperationType(solution, index + 1),
    sourceOwnedWeaponId,
    gogmaCounterBefore: step.gogmaCounterBefore,
    gogmaCounterAfter: step.gogmaCounterAfter,
  }))
}

/**
 * The predicted five slots produced by each amendment of one solution, in
 * execution order and aligned index-for-index with
 * `bonusAmendmentOperations()`.
 *
 * The walk is the recorded canonical history, never a re-derivation from the
 * final result and never another solution that happens to sit at the same
 * depth, so entry `i` is the result of operation `i` of that same solution.
 */
export function bonusAmendmentResults(
  solution: BonusStreamSolution,
): BonusAmendmentResult[] {
  const results: BonusAmendmentResult[] = []
  let node: BonusAmendmentResultNode | null = solution.results
  for (let depth = solution.depth; depth >= 1; depth -= 1) {
    if (node === null || node.depth !== depth) {
      throw new Error(
        `Bonus amendment history is inconsistent at depth ${depth}.`,
      )
    }
    results.push(node.result)
    node = node.previous
  }
  if (node !== null) {
    throw new Error('Bonus amendment history is longer than its solution depth.')
  }
  return results.reverse()
}

interface BonusStateBase {
  depth: number
  lastResetDepth: number
  bonuses: RestorationBonusSet
  results: BonusAmendmentResultNode | null
}

/** Every amendment result is Gogma-scope, so its Keep family layout is defined. */
interface GogmaScopeBonusState extends BonusStateBase {
  scope: 'gogma_artian'
  familyLayoutKey: string
}

/**
 * Only a Route base can still hold inherited `normal_artian` scope slots. The
 * normal-tier family mapping is undefined until it is game-verified (B11), so
 * this state has no family layout at all rather than a derived one.
 */
interface NormalScopeBonusState extends BonusStateBase {
  scope: 'normal_artian'
  familyLayoutKey: null
}

type BonusState = GogmaScopeBonusState | NormalScopeBonusState

/**
 * A state produced by an amendment, so its history node always exists. Only a
 * depth-0 Route base has `results = null`.
 */
interface GeneratedBonusState extends GogmaScopeBonusState {
  results: BonusAmendmentResultNode
}

/**
 * Same family layout means the same reachable Keep results at every later
 * position, so the frontier keeps one representative per layout. v1 prefers the
 * most recent Reset; the tie-break is a stable semantic key so the choice never
 * depends on generation, Map insertion, or Promise resolution order.
 */
function compareRepresentative(
  left: GogmaScopeBonusState,
  right: GogmaScopeBonusState,
): number {
  return (
    right.lastResetDepth - left.lastResetDepth ||
    compareStableKeys(stableStringify(left.bonuses), stableStringify(right.bonuses))
  )
}

export function createTargetBonusStream(
  target: TargetWeapon,
  input: BonusStreamInput,
  engine: RngEngine,
  execution: SearchExecutionContext,
  predictionSupport: SearchPredictionSupport,
): TargetBonusStream {
  const resetPredictions = new Map<number, RestorationBonusSet>()
  const keepPredictions = new Map<string, RestorationBonusSet>()
  const sets = new Map<string, {
    iterator: AsyncGenerator<BonusStreamSolutionSet, BonusStreamSolutionSet>
    value: BonusStreamSolutionSet
    done: boolean
    depths: BonusStreamSolution[][]
  }>()

  function predictReset(gogmaCounter: number): RestorationBonusSet {
    const cached = resetPredictions.get(gogmaCounter)
    if (cached) return cached
    const predicted = engine.predictGogmaBonus({
      baseSeed: input.rngState.baseSeed.value as string,
      gogmaCounter,
      weaponTypeId: target.weaponTypeId,
      elementId: target.elementId,
      operation: { type: 'reset_bonuses' },
      master: input.master,
    })
    resetPredictions.set(gogmaCounter, predicted)
    return predicted
  }

  /**
   * Keep depends on the current slots only through their families, so states
   * that share a layout share this prediction. The representative's five slots
   * are the explicit Engine input; a tier difference never adds a call.
   */
  function predictKeep(
    gogmaCounter: number,
    familyLayoutKey: string,
    currentBonuses: RestorationBonusSet,
  ): RestorationBonusSet {
    const key = `${gogmaCounter}\u0000${familyLayoutKey}`
    const cached = keepPredictions.get(key)
    if (cached) return cached
    const predicted = engine.predictGogmaBonus({
      baseSeed: input.rngState.baseSeed.value as string,
      gogmaCounter,
      weaponTypeId: target.weaponTypeId,
      elementId: target.elementId,
      operation: { type: 'keep_bonuses', currentBonuses },
      master: input.master,
    })
    keepPredictions.set(key, predicted)
    return predicted
  }

  function toState(
    depth: number,
    lastResetDepth: number,
    bonuses: RestorationBonusSet,
    previous: BonusAmendmentResultNode | null,
  ): GeneratedBonusState {
    return {
      depth,
      lastResetDepth,
      bonuses,
      scope: 'gogma_artian',
      familyLayoutKey: gogmaKeepFamilyLayoutKey(bonuses),
      results: {
        depth,
        result: { restorationBonuses: bonuses, restorationBonusScope: 'gogma_artian' },
        previous,
      },
    }
  }

  async function* build(base: BonusStreamBase): AsyncGenerator<BonusStreamSolutionSet, BonusStreamSolutionSet> {
    if (
      input.rngState.baseSeed.value === null ||
      !engine.capabilities.supportsGogmaPrediction
    ) {
      return EMPTY_SET(base.startGogmaCounter)
    }
    const steps: BonusStreamStep[] = []
    const solutions: BonusStreamSolution[] = []
    const unsupported = new Map<string, UnsupportedAmendmentPrediction>()
    const recordUnsupported = (
      type: UnsupportedAmendmentPrediction['type'],
      reason: RngPredictionUnsupportedReason,
    ) => unsupported.set(`${type}\u0000${reason}`, { type, reason })

    // The Keep family layout is a Gogma-scope concept only. An inherited
    // `normal_artian` scope base gets no layout, so no normal-tier family
    // mapping is ever applied here.
    let frontier: BonusState[] = [
      base.restorationBonusScope === 'gogma_artian'
        ? {
            depth: 0,
            lastResetDepth: 0,
            bonuses: base.bonuses,
            scope: 'gogma_artian',
            familyLayoutKey: gogmaKeepFamilyLayoutKey(base.bonuses),
            results: null,
          }
        : {
            depth: 0,
            lastResetDepth: 0,
            bonuses: base.bonuses,
            scope: 'normal_artian',
            familyLayoutKey: null,
            results: null,
          },
    ]
    let gogmaCounterBefore = base.startGogmaCounter
    // The canonical Reset prefix: the depth-`d` Reset extends the depth-(d-1)
    // Reset, because Reset never reads the bonuses it replaces.
    let lastResetNode: BonusAmendmentResultNode | null = null

    for (let depth = 1; depth <= input.maxGogmaAdvance; depth += 1) {
      if (frontier.length === 0) break
      const generated: GeneratedBonusState[] = []
      let gogmaCounterAfter: number | null = null

      const resetSupport = predictionSupport.gogmaReset()
      if (resetSupport.supported) {
        await execution.checkpoint()
        const reset = toState(depth, depth, predictReset(gogmaCounterBefore), lastResetNode)
        generated.push(reset)
        lastResetNode = reset.results
        gogmaCounterAfter = engine.advanceGogmaCounter(gogmaCounterBefore, {
          type: 'reset_bonuses',
        })
      } else {
        recordUnsupported('reset_bonuses', resetSupport.reason)
      }

      if (engine.capabilities.supportsKeepBonusesPrediction) {
        for (const state of frontier) {
          // A `normal_artian` scope state has no predictable Keep result yet,
          // so v1 never emits one. The exclusion is missing Production Keep
          // prediction support, never a game rule. The discriminant also
          // narrows `familyLayoutKey` to the Gogma-scope `string`.
          if (state.scope !== 'gogma_artian') continue
          const keepSupport = predictionSupport.gogmaKeep(state.bonuses)
          if (!keepSupport.supported) {
            recordUnsupported('keep_bonuses', keepSupport.reason)
            continue
          }
          await execution.checkpoint()
          generated.push(toState(
            depth,
            state.lastResetDepth,
            predictKeep(gogmaCounterBefore, state.familyLayoutKey, state.bonuses),
            state.results,
          ))
          gogmaCounterAfter ??= engine.advanceGogmaCounter(gogmaCounterBefore, {
            type: 'keep_bonuses',
          })
        }
      }

      if (generated.length === 0 || gogmaCounterAfter === null) break
      // The generated outcomes are published before the frontier reduction, so
      // folding a layout never drops a Candidate reached at this depth.
      steps.push({ gogmaCounterBefore, gogmaCounterAfter })
      solutions.push(...generated.map(({ depth: solutionDepth, lastResetDepth, bonuses, scope, results }) => ({
        depth: solutionDepth,
        lastResetDepth,
        bonuses,
        restorationBonusScope: scope,
        results,
      })))

      const byLayout = new Map<string, GogmaScopeBonusState>()
      for (const state of generated) {
        const current = byLayout.get(state.familyLayoutKey)
        if (!current || compareRepresentative(state, current) < 0) {
          byLayout.set(state.familyLayoutKey, state)
        }
      }
      frontier = [...byLayout.values()].sort((left, right) =>
        compareStableKeys(left.familyLayoutKey, right.familyLayoutKey),
      )
      gogmaCounterBefore = gogmaCounterAfter
      // Suspend with the frontier intact after one complete depth.
      yield {
        startGogmaCounter: base.startGogmaCounter,
        steps, solutions, unsupportedPredictions: [...unsupported.values()],
      }
    }

    return {
      startGogmaCounter: base.startGogmaCounter,
      steps,
      solutions,
      unsupportedPredictions: [...unsupported.values()],
    }
  }

  async function ensure(base: BonusStreamBase, through: number) {
    const key = bonusStreamBaseKey(base)
    let cached = sets.get(key)
    if (!cached) {
      cached = { iterator: build(base), value: EMPTY_SET(base.startGogmaCounter), done: false, depths: [] }
      sets.set(key, cached)
    }
    const limit = Math.min(input.maxGogmaAdvance, Math.max(0, through))
    while (!cached.done && cached.depths.length < limit) {
      const previousCount = cached.value.solutions.length
      const next = await cached.iterator.next()
      cached.value = next.value
      cached.done = next.done === true
      // Slice only the newly generated suffix, never scan the previous prefix.
      if (!cached.done) cached.depths.push(next.value.solutions.slice(previousCount))
    }
    return cached
  }

  return {
    readDepth: async (base, depth) => {
      const cached = await ensure(base, depth)
      return {
        ...cached.value,
        solutions: cached.depths[depth - 1] ?? [],
        exhausted: cached.done || depth >= input.maxGogmaAdvance,
      }
    },
    solve: async (base, through = input.maxGogmaAdvance) => {
      const cached = await ensure(base, through)
      const limit = Math.min(input.maxGogmaAdvance, Math.max(0, through))
      return {
        ...cached.value,
        steps: cached.value.steps.slice(0, limit),
        solutions: cached.depths.slice(0, limit).flat(),
      }
    },
  }
}

/** Normal-scope first Reset makes every offset/source share one positive stream. */
export function bonusStreamBaseKey(base: BonusStreamBase): string {
  return stableStringify(base.restorationBonusScope === 'normal_artian'
    ? [base.restorationBonusScope, base.startGogmaCounter]
    : [base.restorationBonusScope, base.startGogmaCounter, base.bonuses])
}
