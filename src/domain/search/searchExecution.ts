import type { BuildCandidateId, TargetWeaponId } from '../models/publicTypes'
import { CandidateSearchError } from './searchTypes'
import type { CandidateSearchProgress } from './searchTypes'

export interface CandidateIdInput {
  targetWeaponId: TargetWeaponId
  semanticHash: string
}

export interface CandidateSearchExecutionOptions {
  createCandidateId?: (input: CandidateIdInput) => BuildCandidateId
  now?: () => string
  nowMs?: () => number
  shouldCancel?: () => boolean
  yieldControl?: () => Promise<void>
  onProgress?: (progress: CandidateSearchProgress) => void
}

export interface SearchExecutionContext {
  createCandidateId: (input: CandidateIdInput) => BuildCandidateId
  now: () => string
  nowMs: () => number
  checkpoint: () => Promise<void>
  onProgress: (progress: CandidateSearchProgress) => void
}

export function createSearchExecutionContext(
  options: CandidateSearchExecutionOptions = {},
): SearchExecutionContext {
  let checkpointCount = 0
  const shouldCancel = options.shouldCancel ?? (() => false)
  const yieldControl = options.yieldControl ?? (() => Promise.resolve())
  return {
    createCandidateId:
      options.createCandidateId ??
      (({ semanticHash }) => `candidate.${semanticHash}` as BuildCandidateId),
    now: options.now ?? (() => new Date().toISOString()),
    nowMs: options.nowMs ?? (() => performance.now()),
    onProgress: options.onProgress ?? (() => undefined),
    checkpoint: async () => {
      if (shouldCancel()) {
        throw new CandidateSearchError('cancelled', 'Candidate search was cancelled.')
      }
      checkpointCount += 1
      if (checkpointCount % 50 === 0) {
        await yieldControl()
        if (shouldCancel()) {
          throw new CandidateSearchError(
            'cancelled',
            'Candidate search was cancelled.',
          )
        }
      }
    },
  }
}
