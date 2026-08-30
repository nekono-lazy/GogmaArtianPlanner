import type { RestorationBonusSet } from '../models/publicTypes'
import type {
  GogmaBonusPredictionInput,
  GogmaOperation,
  NormalArtianOperation,
  NormalArtianPredictionInput,
  NormalizedSeed,
  RngEngine,
  RngEngineCapabilities,
  SkillOperation,
  SkillPredictionInput,
  SkillPredictionResult,
} from './rngEngine'
import { UnsupportedRngOperationError } from './rngEngine'

interface FixtureCase<TInput, TResult> { input: TInput; result: TResult }
interface CounterFixture<TOperation> { current: number; operation: TOperation; result: number }

export interface FakeRngFixtures {
  version: string
  capabilities: RngEngineCapabilities
  normalizedSeeds: Array<{ input: string; result: NormalizedSeed }>
  resetBonusPredictions: Array<FixtureCase<GogmaBonusPredictionInput, RestorationBonusSet>>
  keepBonusPredictions: Array<FixtureCase<GogmaBonusPredictionInput, RestorationBonusSet>>
  skillPredictions: Array<FixtureCase<SkillPredictionInput, SkillPredictionResult>>
  normalArtianPredictions: Array<FixtureCase<NormalArtianPredictionInput, RestorationBonusSet>>
  gogmaCounterAdvances: Array<CounterFixture<GogmaOperation>>
  skillCounterAdvances: Array<CounterFixture<SkillOperation>>
  normalCounterAdvances: Array<CounterFixture<NormalArtianOperation>>
}

function key(value: unknown): string { return JSON.stringify(value) }
function copyBonuses(value: RestorationBonusSet): RestorationBonusSet { return structuredClone(value) }
function fixture<TInput, TResult>(name: string, cases: Array<FixtureCase<TInput, TResult>>, input: TInput): TResult {
  const found = cases.find((item) => key(item.input) === key(input))
  if (!found) throw new UnsupportedRngOperationError(name)
  return found.result
}
function advance<TOperation>(name: string, cases: Array<CounterFixture<TOperation>>, current: number, operation: TOperation): number {
  const found = cases.find((item) => item.current === current && key(item.operation) === key(operation))
  if (!found) throw new UnsupportedRngOperationError(name)
  return found.result
}

/** Fixture-only engine; it never supplies guessed Production RNG behavior. */
export class FakeRngEngine implements RngEngine {
  readonly version: string
  readonly capabilities: RngEngineCapabilities
  private readonly fixtures: FakeRngFixtures

  constructor(fixtures: FakeRngFixtures) {
    this.fixtures = fixtures
    this.version = `fake-fixture:${fixtures.version}`
    this.capabilities = { ...fixtures.capabilities }
  }

  normalizeSeed(input: string): NormalizedSeed {
    const found = this.fixtures.normalizedSeeds.find((item) => item.input === input)
    if (!found) throw new UnsupportedRngOperationError('normalizeSeed')
    return found.result
  }

  predictGogmaBonus(input: GogmaBonusPredictionInput): RestorationBonusSet {
    const fixtures = input.operation.type === 'reset_bonuses'
      ? this.fixtures.resetBonusPredictions
      : this.fixtures.keepBonusPredictions
    return copyBonuses(fixture('predictGogmaBonus', fixtures, input))
  }

  predictSkills(input: SkillPredictionInput): SkillPredictionResult {
    return { ...fixture('predictSkills', this.fixtures.skillPredictions, input) }
  }

  predictNormalArtian(input: NormalArtianPredictionInput): RestorationBonusSet {
    return copyBonuses(fixture('predictNormalArtian', this.fixtures.normalArtianPredictions, input))
  }

  advanceGogmaCounter(current: number, operation: GogmaOperation): number {
    return advance('advanceGogmaCounter', this.fixtures.gogmaCounterAdvances, current, operation)
  }

  advanceSkillCounter(current: number, operation: SkillOperation): number {
    return advance('advanceSkillCounter', this.fixtures.skillCounterAdvances, current, operation)
  }

  advanceNormalCounter(current: number, operation: NormalArtianOperation): number {
    return advance('advanceNormalCounter', this.fixtures.normalCounterAdvances, current, operation)
  }
}
