/**
 * Issue #154 Global Assignment Phase D-0A-2b (Research only; never imported by the app).
 *
 * Design D0A2 10.4: a counting wrapper around the Production RNG Engine. It forwards every call unchanged - the version, the
 * capabilities, every argument, every return value and every exception - and only counts the prediction calls per kind and
 * the support queries. It predicts nothing of its own and changes nothing the Engine sees or returns, so a Search or a check
 * run through it gives exactly what the Engine gives. One wrapper per purpose keeps the Search's counts (its budget) apart from
 * the independent Route checks' re-predictions.
 */
import type { RngEngine } from '../../domain/rng/rngEngine'
import type { PredictionCallCounts } from './shapeMaterializationTypes'

export interface CountingRngEngine {
  engine: RngEngine
  /** Live counts (read them after the calls; they only grow). A call is counted before it is forwarded, so a throwing call counts too. */
  counts: Readonly<PredictionCallCounts>
}

export function createPredictionCountingEngine(engine: RngEngine): CountingRngEngine {
  const counts: PredictionCallCounts = { normalArtian: 0, skill: 0, gogmaReset: 0, gogmaKeep: 0, supportQueries: 0 }
  const counting: RngEngine = {
    get version() { return engine.version },
    get capabilities() { return engine.capabilities },
    getPredictionSupport(input) {
      counts.supportQueries += 1
      return engine.getPredictionSupport(input)
    },
    normalizeSeed: input => engine.normalizeSeed(input),
    predictGogmaBonus(input) {
      if (input.operation.type === 'reset_bonuses') counts.gogmaReset += 1
      else counts.gogmaKeep += 1
      return engine.predictGogmaBonus(input)
    },
    predictSkills(input) {
      counts.skill += 1
      return engine.predictSkills(input)
    },
    predictNormalArtian(input) {
      counts.normalArtian += 1
      return engine.predictNormalArtian(input)
    },
    advanceGogmaCounter: (current, operation) => engine.advanceGogmaCounter(current, operation),
    advanceSkillCounter: (current, operation) => engine.advanceSkillCounter(current, operation),
    advanceNormalCounter: (current, operation) => engine.advanceNormalCounter(current, operation),
  }
  return { engine: counting, counts }
}

/** A snapshot of the counts (plain data). */
export function snapshotCounts(counts: Readonly<PredictionCallCounts>): PredictionCallCounts {
  return { normalArtian: counts.normalArtian, skill: counts.skill, gogmaReset: counts.gogmaReset, gogmaKeep: counts.gogmaKeep, supportQueries: counts.supportQueries }
}
