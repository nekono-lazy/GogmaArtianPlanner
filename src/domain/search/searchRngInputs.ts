import type { CandidateSearchInput } from './searchTypes'

export function hasConfirmedSkillInputs(input: CandidateSearchInput): boolean {
  return input.rngState.baseSeed.isConfirmed && input.rngState.baseSeed.value !== null
    && input.rngState.skillCounter.isConfirmed && input.rngState.skillCounter.value !== null
}

export function hasConfirmedGogmaInputs(input: CandidateSearchInput): boolean {
  return input.rngState.baseSeed.isConfirmed && input.rngState.baseSeed.value !== null
    && input.rngState.gogmaCounter.isConfirmed && input.rngState.gogmaCounter.value !== null
}
