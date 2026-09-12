import type {
  CandidateSearchInput,
  CandidateSearchSettings,
} from './searchTypes'
import { CandidateSearchError } from './searchTypes'
import { validateTargetPreferredOwnedWeapons } from '../target'

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
  return [
    positiveIntegerIssue(settings.maxNormalAdvance, 'maxNormalAdvance'),
    positiveIntegerIssue(settings.maxGogmaAdvance, 'maxGogmaAdvance'),
    positiveIntegerIssue(settings.maxSkillAdvance, 'maxSkillAdvance'),
  ].filter((issue): issue is CandidateSearchValidationIssue => issue !== null)
}

export function assertCandidateSearchInput(input: CandidateSearchInput): void {
  const issues = validateCandidateSearchSettings(input.settings)
  if (input.searchRunId.trim().length === 0) {
    issues.push({ path: 'searchRunId', message: 'searchRunId cannot be empty.' })
  }
  if (input.targetWeaponId.trim().length === 0) {
    issues.push({ path: 'targetWeaponId', message: 'targetWeaponId cannot be empty.' })
  }
  // The same collection-level authority the save Service and the Planner use.
  // A preference pointing at a missing, incompatible, protected, or
  // double-claimed weapon fails closed here rather than quietly ordering
  // Candidates by a reference that means nothing (`docs/DATA_MODEL.md` 8.5).
  const preferred = validateTargetPreferredOwnedWeapons(
    input.targetWeapons,
    input.ownedWeapons,
  )
  issues.push(
    ...preferred.issues.map(({ path, message }) => ({ path, message })),
  )
  if (issues.length > 0) {
    throw new CandidateSearchError(
      'invalid_input',
      issues.map(({ path, message }) => `${path}: ${message}`).join('\n'),
    )
  }
}
