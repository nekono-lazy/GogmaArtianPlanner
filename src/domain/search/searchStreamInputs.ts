import type { BonusStreamInput } from './bonusStream'
import type { SkillStreamInput } from './skillStream'
import type { CandidateSearchInput } from './searchTypes'

/**
 * Adapters from the ordinary UI Search request to the narrowed stream inputs.
 *
 * The streams take only their semantic RNG inputs, the Master subset, and one
 * explicit depth bound, so the same stream code serves ordinary Candidate
 * Search and the constrained enumerator of SEARCH_SPEC 5.6.7. These adapters
 * keep `CandidateSearchSettings` as the ordinary Search's bound authority
 * without letting it become the constrained enumerator's.
 */
export function skillStreamInputForSearch(
  input: CandidateSearchInput,
): SkillStreamInput {
  return {
    rngState: input.rngState,
    master: input.master,
    maxSkillAdvance: input.settings.maxSkillAdvance,
  }
}

export function bonusStreamInputForSearch(
  input: CandidateSearchInput,
): BonusStreamInput {
  return {
    rngState: input.rngState,
    master: input.master,
    maxGogmaAdvance: input.settings.maxGogmaAdvance,
  }
}
