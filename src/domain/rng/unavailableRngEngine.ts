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

/**
 * Worker-local production placeholder. It advertises no prediction capability
 * and never returns guessed game data or counter advancement.
 */
export class UnavailableRngEngine implements RngEngine {
  readonly version = 'production-engine-unavailable'
  readonly capabilities: RngEngineCapabilities = {
    supportsSeedSearch: false,
    supportsNormalArtianPrediction: false,
    supportsGogmaPrediction: false,
    supportsSkillPrediction: false,
    supportsKeepBonusesPrediction: false,
  }

  private unsupported(operation: string): never {
    throw new UnsupportedRngOperationError(operation)
  }

  normalizeSeed(_input: string): NormalizedSeed {
    void _input
    return this.unsupported('normalizeSeed')
  }
  predictGogmaBonus(_input: GogmaBonusPredictionInput): RestorationBonusSet {
    void _input
    return this.unsupported('predictGogmaBonus')
  }
  predictSkills(_input: SkillPredictionInput): SkillPredictionResult {
    void _input
    return this.unsupported('predictSkills')
  }
  predictNormalArtian(_input: NormalArtianPredictionInput): RestorationBonusSet {
    void _input
    return this.unsupported('predictNormalArtian')
  }
  enumerateKeepSelections(_input: KeepSelectionEnumerationInput): KeepBonusSelection[] {
    void _input
    return this.unsupported('enumerateKeepSelections')
  }
  advanceGogmaCounter(_current: number, _operation: GogmaOperation): number {
    void _current
    void _operation
    return this.unsupported('advanceGogmaCounter')
  }
  advanceSkillCounter(_current: number, _operation: SkillOperation): number {
    void _current
    void _operation
    return this.unsupported('advanceSkillCounter')
  }
  advanceNormalCounter(_current: number, _operation: NormalArtianOperation): number {
    void _current
    void _operation
    return this.unsupported('advanceNormalCounter')
  }
}
