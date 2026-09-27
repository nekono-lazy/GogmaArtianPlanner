import { stableStringify } from '../domain/models/hashing'
import type { BuildCandidateId } from '../domain/models/publicTypes'
import type { RngEngine, GogmaBonusPredictionInput, NormalArtianPredictionInput, SkillPredictionInput } from '../domain/rng/rngEngine'
import type { CandidateSearchExecutionOptions } from '../domain/search/searchExecution'

type PredictionInput = GogmaBonusPredictionInput | NormalArtianPredictionInput | SkillPredictionInput
export type PredictionAxis = 'normal' | 'gogma' | 'skill'
const axes: PredictionAxis[] = ['normal', 'gogma', 'skill']
const axisRecord = <T>(create: () => T): Record<PredictionAxis, T> => ({ normal: create(), gogma: create(), skill: create() })

/** Exact structural keys, with lossless Master interning (no hash collisions).
 * Master is immutable during a Search. The identity memo is local to that Search;
 * different Searches intern by complete content, never by object identity.
 * Includes even fields Production currently ignores; this is a conservative
 * exact-input reuse measurement, not an RNG semantic-equivalence claim.
 */
export class ExactPredictionKeys {
  private readonly masters = new Map<string, number>()
  forSearch(engineVersion: string) {
    const identities = new WeakMap<object, number>()
    return (axis: PredictionAxis, input: PredictionInput): string => {
      let master = identities.get(input.master)
      if (master === undefined) {
        const content = stableStringify(input.master)
        master = this.masters.get(content)
        if (master === undefined) { master = this.masters.size; this.masters.set(content, master) }
        identities.set(input.master, master)
      }
      return stableStringify({ engineVersion, axis, input: { ...input, master } })
    }
  }
}

export interface PredictionMeasurement {
  calls: number
  elapsedMs: number
  uniqueInputs: number
  withinSearchDuplicateCalls: number
  previousSearchDuplicateCalls: number
}
export interface SearchProfile {
  predictions: Record<PredictionAxis, PredictionMeasurement>
  keyObservationMs: number
  settledWorkItems: number
  settledCountExact: boolean
  progressEvents: number
  cancellationChecks: number
  checkpointCount: number
  yieldCount: number
  yieldElapsedMs: number
  candidateIdentityCalls: number
}

/** Pure observer: forwards every call once, with the same input and returned
 * object (or exception). No value measured here is read by Search decisions.
 * Only existing execution seams are used; Production imports none of this.
 */
export class GlobalSearchProfiler {
  private readonly keys = new ExactPredictionKeys()
  private readonly firstSearch = axisRecord(() => new Map<string, number>())
  private readonly totalCalls = axisRecord(() => 0)
  private searchIndex = 0

  begin(engine: RngEngine, options: CandidateSearchExecutionOptions = {}, nowMs = () => performance.now()) {
    const index = this.searchIndex++
    const keyOf = this.keys.forSearch(engine.version)
    const local = axisRecord(() => new Set<string>())
    const profile: SearchProfile = {
      predictions: axisRecord(() => ({ calls: 0, elapsedMs: 0, uniqueInputs: 0, withinSearchDuplicateCalls: 0, previousSearchDuplicateCalls: 0 })),
      keyObservationMs: 0, settledWorkItems: 0, settledCountExact: false, progressEvents: 0,
      cancellationChecks: 0, checkpointCount: 0, yieldCount: 0, yieldElapsedMs: 0, candidateIdentityCalls: 0,
    }
    const observe = <T>(axis: PredictionAxis, input: PredictionInput, predict: () => T): T => {
      const measured = profile.predictions[axis]
      const keyStart = nowMs()
      const key = keyOf(axis, input)
      measured.calls++
      this.totalCalls[axis]++
      if (local[axis].has(key)) measured.withinSearchDuplicateCalls++
      else { local[axis].add(key); measured.uniqueInputs++ }
      const first = this.firstSearch[axis].get(key)
      if (first !== undefined && first < index) measured.previousSearchDuplicateCalls++
      if (first === undefined) this.firstSearch[axis].set(key, index)
      profile.keyObservationMs += nowMs() - keyStart
      const start = nowMs()
      try { return predict() } finally { measured.elapsedMs += nowMs() - start }
    }
    const observedEngine: RngEngine = {
      version: engine.version, capabilities: engine.capabilities,
      normalizeSeed: v => engine.normalizeSeed(v), getPredictionSupport: v => engine.getPredictionSupport(v),
      advanceNormalCounter: (v, op) => engine.advanceNormalCounter(v, op),
      advanceGogmaCounter: (v, op) => engine.advanceGogmaCounter(v, op),
      advanceSkillCounter: (v, op) => engine.advanceSkillCounter(v, op),
      predictNormalArtian: v => observe('normal', v, () => engine.predictNormalArtian(v)),
      predictGogmaBonus: v => observe('gogma', v, () => engine.predictGogmaBonus(v)),
      predictSkills: v => observe('skill', v, () => engine.predictSkills(v)),
    }
    const execution: CandidateSearchExecutionOptions = { ...options,
      onProgress: progress => {
        profile.progressEvents++
        profile.settledWorkItems = progress.processedWorkItems
        profile.settledCountExact = progress.phase === 'finalizing'
        options.onProgress?.(progress)
      },
      shouldCancel: () => {
        profile.cancellationChecks++
        // searchExecution checks once per checkpoint and once after each yield.
        profile.checkpointCount = profile.cancellationChecks - profile.yieldCount
        return options.shouldCancel?.() ?? false
      },
      yieldControl: async () => {
        profile.yieldCount++
        const start = nowMs()
        try { await (options.yieldControl?.() ?? Promise.resolve()) }
        finally { profile.yieldElapsedMs += nowMs() - start }
      },
      createCandidateId: value => {
        profile.candidateIdentityCalls++
        return options.createCandidateId?.(value) ?? `candidate.${value.semanticHash}` as BuildCandidateId
      },
    }
    return { engine: observedEngine, execution, profile }
  }

  summary() {
    return Object.fromEntries(axes.map(axis => {
      const calls = this.totalCalls[axis], uniqueInputs = this.firstSearch[axis].size
      return [axis, { calls, uniqueInputs, duplicateCalls: calls - uniqueInputs, theoreticalExactCacheHitRatio: calls ? (calls - uniqueInputs) / calls : 0 }]
    })) as Record<PredictionAxis, { calls: number; uniqueInputs: number; duplicateCalls: number; theoreticalExactCacheHitRatio: number }>
  }
}
