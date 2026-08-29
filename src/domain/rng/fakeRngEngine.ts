import type { KeepBonusSelection, RestorationBonusSet } from '../models/publicTypes'
import type {
  GogmaBonusPredictionInput,
  GogmaOperation,
  KeepSelectionEnumerationInput,
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

interface FixtureCase<TInput, TResult> {
  input: TInput
  result: TResult
}

interface CounterFixture<TOperation> {
  current: number
  operation: TOperation
  result: number
}

export interface FakeRngFixtures {
  version: string
  capabilities: RngEngineCapabilities
  normalizedSeeds: Array<{ input: string; result: NormalizedSeed }>
  gogmaPredictions: Array<FixtureCase<GogmaBonusPredictionInput, RestorationBonusSet>>
  skillPredictions: Array<FixtureCase<SkillPredictionInput, SkillPredictionResult>>
  normalArtianPredictions: Array<FixtureCase<NormalArtianPredictionInput, RestorationBonusSet>>
  keepSelections: Array<FixtureCase<KeepSelectionEnumerationInput, KeepBonusSelection[]>>
  gogmaCounterAdvances: Array<CounterFixture<GogmaOperation>>
  skillCounterAdvances: Array<CounterFixture<SkillOperation>>
  normalCounterAdvances: Array<CounterFixture<NormalArtianOperation>>
}

function fixtureKey(value: unknown): string {
  return JSON.stringify(value)
}

function copyBonusSet(value: RestorationBonusSet): RestorationBonusSet {
  return [
    { ...value[0] },
    { ...value[1] },
    { ...value[2] },
    { ...value[3] },
    { ...value[4] },
  ]
}

function copyKeepSelection(selection: KeepBonusSelection): KeepBonusSelection {
  if (selection.mode === 'slot_indices') {
    return {
      ...selection,
      keptSlotIndices: [...selection.keptSlotIndices],
      engineParameters: { ...selection.engineParameters },
    }
  }
  if (selection.mode === 'bonus_types') {
    return {
      ...selection,
      keptBonusTypeIds: [...selection.keptBonusTypeIds],
      engineParameters: { ...selection.engineParameters },
    }
  }
  return { ...selection, engineParameters: { ...selection.engineParameters } }
}

function findFixture<TInput, TResult>(
  operation: string,
  fixtures: Array<FixtureCase<TInput, TResult>>,
  input: TInput,
): TResult {
  const match = fixtures.find((fixture) => fixtureKey(fixture.input) === fixtureKey(input))
  if (!match) throw new UnsupportedRngOperationError(operation)
  return match.result
}

function findCounterFixture<TOperation>(
  operationName: string,
  fixtures: Array<CounterFixture<TOperation>>,
  current: number,
  operation: TOperation,
): number {
  const match = fixtures.find(
    (fixture) =>
      fixture.current === current &&
      fixtureKey(fixture.operation) === fixtureKey(operation),
  )
  if (!match) throw new UnsupportedRngOperationError(operationName)
  return match.result
}

/**
 * Fixture-only engine for UI and domain contract tests.
 * It never derives lottery weights, counter deltas, or Keep behavior.
 */
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
    const match = this.fixtures.normalizedSeeds.find((fixture) => fixture.input === input)
    if (!match) throw new UnsupportedRngOperationError('normalizeSeed')
    return match.result
  }

  predictGogmaBonus(input: GogmaBonusPredictionInput): RestorationBonusSet {
    return copyBonusSet(findFixture('predictGogmaBonus', this.fixtures.gogmaPredictions, input))
  }

  predictSkills(input: SkillPredictionInput): SkillPredictionResult {
    return { ...findFixture('predictSkills', this.fixtures.skillPredictions, input) }
  }

  predictNormalArtian(input: NormalArtianPredictionInput): RestorationBonusSet {
    return copyBonusSet(
      findFixture('predictNormalArtian', this.fixtures.normalArtianPredictions, input),
    )
  }

  enumerateKeepSelections(input: KeepSelectionEnumerationInput): KeepBonusSelection[] {
    const result = findFixture('enumerateKeepSelections', this.fixtures.keepSelections, input)
    return result.map(copyKeepSelection)
  }

  advanceGogmaCounter(current: number, operation: GogmaOperation): number {
    return findCounterFixture(
      'advanceGogmaCounter',
      this.fixtures.gogmaCounterAdvances,
      current,
      operation,
    )
  }

  advanceSkillCounter(current: number, operation: SkillOperation): number {
    return findCounterFixture(
      'advanceSkillCounter',
      this.fixtures.skillCounterAdvances,
      current,
      operation,
    )
  }

  advanceNormalCounter(current: number, operation: NormalArtianOperation): number {
    return findCounterFixture(
      'advanceNormalCounter',
      this.fixtures.normalCounterAdvances,
      current,
      operation,
    )
  }
}
