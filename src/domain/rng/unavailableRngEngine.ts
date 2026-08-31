import type { RestorationBonusSet } from '../models/publicTypes'
import type {
  GogmaBonusPredictionInput,
  GogmaOperation,
  NormalArtianOperation,
  NormalArtianPredictionInput,
  NormalizedSeed,
  RngEngine,
  RngEngineCapabilities,
  RngPredictionSupport,
  RngPredictionSupportInput,
  SkillOperation,
  SkillPredictionInput,
  SkillPredictionResult,
} from './rngEngine'
import { UnsupportedRngOperationError } from './rngEngine'

/** Production RNG is deliberately unavailable until a verified engine exists. */
export class UnavailableRngEngine implements RngEngine {
  readonly version = 'production-engine-unavailable'

  readonly capabilities: RngEngineCapabilities = {
    supportsSeedSearch: false,
    supportsNormalArtianPrediction: false,
    supportsGogmaPrediction: false,
    supportsSkillPrediction: false,
    supportsKeepBonusesPrediction: false,
  }

  private unsupported(name: string): never {
    throw new UnsupportedRngOperationError(name)
  }

  getPredictionSupport(_input: RngPredictionSupportInput): RngPredictionSupport {
    void _input
    return { supported: false, reason: 'engine_capability_unavailable' }
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

  advanceNormalCounter(
    _current: number,
    _operation: NormalArtianOperation,
  ): number {
    void _current
    void _operation
    return this.unsupported('advanceNormalCounter')
  }
}
