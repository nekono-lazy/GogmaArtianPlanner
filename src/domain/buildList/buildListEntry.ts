import type {
  BuildCandidate,
  BuildListEntry,
  BuildListEntryId,
  RestorationBonus,
  TargetWeapon,
} from '../models/publicTypes'
import { hashStableValue, stableStringify } from '../models/hashing'

function compareStable(left: unknown, right: unknown): number {
  const leftValue = stableStringify(left)
  const rightValue = stableStringify(right)
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0
}

function normalizeBonuses(bonuses: readonly RestorationBonus[]) {
  return bonuses
    .map(({ bonusTypeId, bonusRankId }) => ({ bonusTypeId, bonusRankId }))
    .sort(compareStable)
}

export function createTargetDefinitionHash(target: TargetWeapon): string {
  return hashStableValue({
    weaponTypeId: target.weaponTypeId,
    elementId: target.elementId,
    priority: target.priority,
    isEnabled: target.isEnabled,
    idealBonuses: normalizeBonuses(target.idealBonuses),
    practicalBonusConditions: target.practicalBonusConditions
      .map((condition) => ({ ...condition }))
      .sort(compareStable),
    practicalAlternativeGroups: target.practicalAlternativeGroups
      .map((group) => ({
        id: group.id,
        requiredCount: group.requiredCount,
        options: group.options.map((option) => ({ ...option })).sort(compareStable),
      }))
      .sort(compareStable),
    idealSkillCondition: { ...target.idealSkillCondition },
    practicalSkillCondition: { ...target.practicalSkillCondition },
  })
}

export function createBuildCandidateMeaningFingerprint(
  candidate: BuildCandidate,
): string {
  return hashStableValue({
    targetWeaponId: candidate.targetWeaponId,
    route: candidate.route,
    finalBonuses: normalizeBonuses(candidate.finalBonuses),
    seriesSkillId: candidate.seriesSkillId,
    groupSkillId: candidate.groupSkillId,
  })
}

export function isSameBuildListCandidate(
  entry: BuildListEntry,
  candidate: BuildCandidate,
): boolean {
  return (
    entry.targetWeaponId === candidate.targetWeaponId &&
    createBuildCandidateMeaningFingerprint(entry.candidateSnapshot) ===
      createBuildCandidateMeaningFingerprint(candidate)
  )
}

export interface CreateBuildListEntryOptions {
  id?: BuildListEntryId
  createdAt?: string
}

function createEntryId(candidate: BuildCandidate, createdAt: string): BuildListEntryId {
  const suffix = hashStableValue({
    candidate: createBuildCandidateMeaningFingerprint(candidate),
    createdAt,
  }).replace(':', '-')
  return `build-list.${suffix}` as BuildListEntryId
}

export function createBuildListEntry(
  candidate: BuildCandidate,
  target: TargetWeapon,
  options: CreateBuildListEntryOptions = {},
): BuildListEntry {
  if (candidate.targetWeaponId !== target.id) {
    throw new Error('Candidate and TargetWeapon IDs must match.')
  }
  const createdAt = options.createdAt ?? new Date().toISOString()
  return {
    id: options.id ?? createEntryId(candidate, createdAt),
    candidateId: candidate.id,
    targetWeaponId: target.id,
    candidateSnapshot: structuredClone(candidate),
    targetDefinitionHash: createTargetDefinitionHash(target),
    searchStateHash: candidate.searchStateHash,
    referencedOwnedWeaponsHash: candidate.referencedOwnedWeaponsHash,
    calculationContext: { ...candidate.calculationContext },
    isStale: false,
    staleReasons: [],
    createdAt,
  }
}
