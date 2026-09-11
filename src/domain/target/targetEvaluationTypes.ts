import type { BonusRankMaster } from '../master/masterTypes'
import type {
  CandidateCategory,
  IdealDifference,
} from '../models/publicTypes'

export interface TargetEvaluationMasterSubset {
  bonusRanks: BonusRankMaster[]
}

export interface TargetEvaluationResult {
  category: CandidateCategory | null
  bonusMatch: 'ideal' | 'practical' | 'alternative' | null
  skillMatch: 'ideal' | 'practical' | null
  idealDifference: IdealDifference
  similarityScore: number
  isSimilarToIdeal: boolean
}

export type TargetEvaluationErrorCode = 'invalid_similarity_threshold'

export class TargetEvaluationError extends Error {
  readonly code: TargetEvaluationErrorCode

  constructor(code: TargetEvaluationErrorCode, message: string) {
    super(message)
    this.name = 'TargetEvaluationError'
    this.code = code
  }
}
