import { describe, expect, it } from 'vitest'
import type { ElementId, RestorationBonusSet, WeaponTypeId } from '../../domain/models/publicTypes'
import {
  gameVerifiedBowElementalNormalVectors,
  gameVerifiedBowNoneNormalVectors,
  gameVerifiedHeavyBowgunFireNormalVectors,
  gameVerifiedLongSwordFireNormalVectors,
  gameVerifiedSwitchAxeFireNormalVectors,
  gameVerifiedSwitchAxeNoneNormalVectors,
} from '../../test/fixtures/gameVerifiedNormalVectors'
import { ProductionRngEngine } from '../../domain/rng/production/productionRngEngine'
import { normalArtianLotteryTableClassForWeaponAndElement } from '../../domain/rng/production/gameNormalBonuses'
import type { NormalArtianCounterObservation } from '../../domain/rng/identification/normalArtianCounterIdentificationTypes'
import {
  compiledObservationProbability,
  compileNormalSeedResearchObservations,
  identifyNormalSeedAndCounterCompiled,
  identifyNormalSeedAndCounterWithCounterKernel,
  type NormalSeedIdentificationResearchInput,
  type NormalSeedIdentificationResearchStatistics,
} from './normalSeedIdentificationResearch'

/*
 * Issue #74 Phase 1 measurement. It is skipped unless
 * `VITE_ISSUE74_MEASURE=1` is set, so `npm test` and CI never run it. Every run
 * is single-threaded and bounded (no full 100M Base Seed domain, no parallel
 * Workers) because a long Global Planner research job shares this PC. It runs
 * in Node / V8, which is not a Browser Worker measurement
 * (`docs/C5_E2C8_BROWSER_WORKER_BENCHMARK.md`); figures for the full domain
 * are extrapolations, recorded as such in
 * `docs/ISSUE_74_NORMAL_SEED_IDENTIFICATION_RESEARCH.md`.
 */

const KNOWN_SEED = 51_231_782
const FULL_SEED_DOMAIN = 100_000_000
const enabled = import.meta.env.VITE_ISSUE74_MEASURE === '1'

function observationsOf(
  vectors: readonly { readonly weaponTypeId: WeaponTypeId; readonly elementId: ElementId; readonly bonuses: RestorationBonusSet }[],
): NormalArtianCounterObservation[] {
  return vectors.map((vector) => ({
    tableClass: normalArtianLotteryTableClassForWeaponAndElement(vector.weaponTypeId, vector.elementId),
    bonuses: vector.bonuses,
  }))
}

const SCENARIOS: readonly { name: string; weaponTypeId: WeaponTypeId; observations: NormalArtianCounterObservation[]; knownCounter: number }[] = [
  { name: 'HBG Fire C4-6 (live consecutive)', weaponTypeId: 'weapon.heavy_bowgun', observations: observationsOf(gameVerifiedHeavyBowgunFireNormalVectors), knownCounter: 4 },
  { name: 'Long Sword Fire C0-2', weaponTypeId: 'weapon.long_sword', observations: observationsOf(gameVerifiedLongSwordFireNormalVectors), knownCounter: 0 },
  { name: 'Switch Axe Fire C0 -> none C1 (live A->B)', weaponTypeId: 'weapon.switch_axe', observations: observationsOf([gameVerifiedSwitchAxeFireNormalVectors[0], gameVerifiedSwitchAxeNoneNormalVectors[1]]), knownCounter: 0 },
  { name: 'Bow Fire C0 / none C1 / Fire C2 (composed A/B)', weaponTypeId: 'weapon.bow', observations: observationsOf([gameVerifiedBowElementalNormalVectors[0], gameVerifiedBowNoneNormalVectors[1], gameVerifiedBowElementalNormalVectors[2]]), knownCounter: 0 },
  { name: 'Bow none C0-2 (Table B only)', weaponTypeId: 'weapon.bow', observations: observationsOf(gameVerifiedBowNoneNormalVectors), knownCounter: 0 },
]

function research(
  weaponTypeId: WeaponTypeId,
  observations: readonly NormalArtianCounterObservation[],
  seedStart: number,
  seedCount: number,
  counterEnd: number,
  counterStart = 0,
): NormalSeedIdentificationResearchInput {
  return {
    weaponTypeId,
    rarity: 8,
    observations,
    seedRange: { startInclusive: seedStart, endInclusive: seedStart + seedCount - 1 },
    normalCounterRange: { startInclusive: counterStart, endInclusive: counterEnd },
  }
}

async function timed<T>(run: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const started = performance.now()
  const value = await run()
  return { value, ms: performance.now() - started }
}

/** Node heap usage; the vitest runner is Node even under the jsdom environment. */
function heapUsed(): number {
  const runtime = globalThis as { process?: { memoryUsage(): { heapUsed: number } } }
  return runtime.process?.memoryUsage().heapUsed ?? Number.NaN
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)]!
}

describe.skipIf(!enabled)('Issue #74 Phase 1 measurement (bounded, single thread)', () => {
  const engine = new ProductionRngEngine()
  const hbg = SCENARIOS[0]!

  it('Method A (Counter kernel per Seed) vs Method B (compiled)', async () => {
    const rows = []
    for (const counterEnd of [0, 100, 500]) {
      const seedsA = counterEnd === 0 ? 2_000 : 300
      const seedsB = counterEnd === 0 ? 200_000 : 20_000
      const a = await timed(() => identifyNormalSeedAndCounterWithCounterKernel(research(hbg.weaponTypeId, hbg.observations, KNOWN_SEED - seedsA / 2, seedsA, counterEnd), engine))
      const bRuns = []
      for (let repeat = 0; repeat < 3; repeat += 1) {
        bRuns.push((await timed(() => identifyNormalSeedAndCounterCompiled(research(hbg.weaponTypeId, hbg.observations, KNOWN_SEED - seedsB / 2, seedsB, counterEnd), engine))).ms)
      }
      const aMicrosPerSeed = (a.ms * 1000) / seedsA
      const bMicrosPerSeed = (median(bRuns) * 1000) / seedsB
      rows.push({
        counterRange: `0..${counterEnd}`,
        methodA_seeds: seedsA,
        methodA_ms: Number(a.ms.toFixed(1)),
        methodA_us_per_seed: Number(aMicrosPerSeed.toFixed(2)),
        methodB_seeds: seedsB,
        methodB_ms_runs: bRuns.map((ms) => Number(ms.toFixed(1))),
        methodB_us_per_seed: Number(bMicrosPerSeed.toFixed(3)),
        speedup: Number((aMicrosPerSeed / bMicrosPerSeed).toFixed(1)),
        extrapolated_full_domain_single_thread_s_A: Math.round((aMicrosPerSeed * FULL_SEED_DOMAIN) / 1e6),
        extrapolated_full_domain_single_thread_s_B: Math.round((bMicrosPerSeed * FULL_SEED_DOMAIN) / 1e6),
      })
    }
    console.log('[issue74] method comparison', JSON.stringify(rows, null, 2))
    expect(rows).toHaveLength(3)
  }, 600_000)

  it('Method B cost by Counter range, observation count, Counter start and early rejection', async () => {
    const rows = []
    for (const [counterStart, counterEnd] of [[0, 0], [0, 10], [0, 100], [0, 500], [400, 500], [0, 1000]] as const) {
      for (const observationCount of [1, 3]) {
        const seeds = counterEnd - counterStart <= 10 ? 200_000 : 20_000
        const statistics: NormalSeedIdentificationResearchStatistics = { seedsEvaluated: 0, countersEvaluated: 0, firstObservationPasses: 0 }
        const runs = []
        let matches = 0
        for (let repeat = 0; repeat < 3; repeat += 1) {
          const run = await timed(() => identifyNormalSeedAndCounterCompiled(
            research(hbg.weaponTypeId, hbg.observations.slice(0, observationCount), KNOWN_SEED - seeds / 2, seeds, counterEnd, counterStart),
            engine,
            repeat === 0 ? { statistics } : {},
          ))
          runs.push(run.ms)
          matches = run.value.matches.length
        }
        const microsPerSeed = (median(runs) * 1000) / seeds
        rows.push({
          counterRange: `${counterStart}..${counterEnd}`,
          observations: observationCount,
          seeds,
          ms_runs: runs.map((ms) => Number(ms.toFixed(1))),
          us_per_seed: Number(microsPerSeed.toFixed(3)),
          ns_per_seed_counter: Number(((microsPerSeed * 1000) / (counterEnd - counterStart + 1)).toFixed(2)),
          fullCheckRatio: Number((statistics.firstObservationPasses / statistics.countersEvaluated).toFixed(4)),
          matchesInWindow: matches,
          extrapolated_full_domain_single_thread_s: Math.round((microsPerSeed * FULL_SEED_DOMAIN) / 1e6),
        })
      }
    }
    const earlyRows = []
    for (const earlyRejection of [true, false]) {
      const runs = []
      for (let repeat = 0; repeat < 3; repeat += 1) {
        runs.push((await timed(() => identifyNormalSeedAndCounterCompiled(
          research(hbg.weaponTypeId, hbg.observations, KNOWN_SEED - 10_000, 20_000, 500),
          engine,
          { earlyRejection: earlyRejection },
        ))).ms)
      }
      earlyRows.push({ earlyRejection: earlyRejection, ms_runs: runs.map((ms) => Number(ms.toFixed(1))), us_per_seed: Number(((median(runs) * 1000) / 20_000).toFixed(3)) })
    }
    const heapBefore = heapUsed()
    await identifyNormalSeedAndCounterCompiled(research(hbg.weaponTypeId, hbg.observations.slice(0, 1), KNOWN_SEED - 10_000, 20_000, 500), engine)
    const heapAfter = heapUsed()
    console.log('[issue74] cost by range', JSON.stringify(rows, null, 2))
    console.log('[issue74] early rejection', JSON.stringify(earlyRows, null, 2))
    console.log('[issue74] heap delta (MiB, 1 observation, 20,000 seeds x 0..500)', ((heapAfter - heapBefore) / 1024 / 1024).toFixed(2))
    expect(rows.length).toBeGreaterThan(0)
  }, 600_000)

  it('candidate counts in a 100,001-Seed window and the analytic full-domain expectation', async () => {
    const seeds = 100_001
    const rows = []
    for (const scenario of SCENARIOS) {
      const probabilities = compileNormalSeedResearchObservations(scenario.weaponTypeId, scenario.observations).map(compiledObservationProbability)
      for (let count = 1; count <= scenario.observations.length; count += 1) {
        const probability = probabilities.slice(0, count).reduce((product, value) => product * value, 1)
        for (const counterEnd of [0, 10, 100, 500]) {
          if (scenario.knownCounter > counterEnd) continue
          const result = await identifyNormalSeedAndCounterCompiled(
            research(scenario.weaponTypeId, scenario.observations.slice(0, count), KNOWN_SEED - 50_000, seeds, counterEnd),
            engine,
          )
          const containsKnown = result.matches.some((match) => match.baseSeed === KNOWN_SEED && match.startNormalCounter === scenario.knownCounter)
          rows.push({
            scenario: scenario.name,
            observations: count,
            counterRange: `0..${counterEnd}`,
            windowMatches: result.matches.length,
            containsKnown,
            windowExpectedFalse: Number((seeds * (counterEnd + 1) * probability).toFixed(3)),
            fullDomainExpectedFalse: Number((FULL_SEED_DOMAIN * (counterEnd + 1) * probability).toPrecision(3)),
          })
          expect(containsKnown).toBe(true)
        }
      }
    }
    console.log('[issue74] candidate counts', JSON.stringify(rows, null, 2))
  }, 600_000)
})
