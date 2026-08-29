import type {
  CandidateSearchInput,
  CandidateSearchSettings,
} from './searchTypes'
import { CandidateSearchError } from './searchTypes'

export interface CandidateSearchValidationIssue {
  path: string
  message: string
}

function positiveIntegerIssue(value: number, path: string) {
  return Number.isInteger(value) && value >= 1
    ? null
    : { path, message: `${path} must be an integer greater than or equal to 1.` }
}

export function validateCandidateSearchSettings(
  settings: CandidateSearchSettings,
): CandidateSearchValidationIssue[] {
  const issues = [
    positiveIntegerIssue(settings.maxNormalAdvance, 'maxNormalAdvance'),
    positiveIntegerIssue(settings.maxGogmaAdvance, 'maxGogmaAdvance'),
    positiveIntegerIssue(settings.maxSkillAdvance, 'maxSkillAdvance'),
    positiveIntegerIssue(
      settings.maxCandidatesPerTarget,
      'maxCandidatesPerTarget',
    ),
  ].filter((issue): issue is CandidateSearchValidationIssue => issue !== null)

  if (
    !Number.isFinite(settings.similarityThreshold) ||
    settings.similarityThreshold < 0 ||
    settings.similarityThreshold > 1
  ) {
    issues.push({
      path: 'similarityThreshold',
      message: 'similarityThreshold must be a finite number from 0 through 1.',
    })
  }
  return issues
}

export function assertCandidateSearchInput(input: CandidateSearchInput): void {
  const issues = validateCandidateSearchSettings(input.settings)
  if (input.searchRunId.trim().length === 0) {
    issues.push({ path: 'searchRunId', message: 'searchRunId cannot be empty.' })
  }
  if (issues.length > 0) {
    throw new CandidateSearchError(
      'invalid_input',
      issues.map(({ path, message }) => `${path}: ${message}`).join('\n'),
    )
  }
}
