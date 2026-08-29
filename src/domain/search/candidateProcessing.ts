import { hashStableValue } from '../models/hashing'
import type { BuildCandidate, RestorationBonusSet } from '../models/publicTypes'
import type { CandidateResultFilter } from './searchTypes'

function canonicalBonusMultiset(bonuses: RestorationBonusSet): string[] {
  return bonuses
    .map((bonus) => `${bonus.bonusTypeId}\u0000${bonus.bonusRankId}`)
    .sort((left, right) => left.localeCompare(right))
}

export function candidateDeduplicationKey(candidate: BuildCandidate): string {
  return hashStableValue({
    finalBonuses: canonicalBonusMultiset(candidate.finalBonuses),
    seriesSkillId: candidate.seriesSkillId,
    groupSkillId: candidate.groupSkillId,
    routeKind: candidate.route.kind,
    sourceOwnedWeaponId: candidate.route.sourceOwnedWeaponId,
    operationHash: hashStableValue(candidate.route.operations),
  })
}

function materialQuantity(candidate: BuildCandidate): number {
  return candidate.requiredMaterials.reduce(
    (total, requirement) => total + requirement.quantity,
    0,
  )
}

function totalCounterAdvance(candidate: BuildCandidate): number {
  return (
    candidate.estimatedGogmaAdvance +
    candidate.estimatedSkillAdvance +
    (candidate.estimatedNormalAdvance ?? 0)
  )
}

export function compareDuplicateCandidates(
  left: BuildCandidate,
  right: BuildCandidate,
): number {
  return (
    left.estimatedOperationCount - right.estimatedOperationCount ||
    materialQuantity(left) - materialQuantity(right) ||
    totalCounterAdvance(left) - totalCounterAdvance(right) ||
    left.id.localeCompare(right.id)
  )
}

export function deduplicateCandidates(
  candidates: readonly BuildCandidate[],
): BuildCandidate[] {
  const selected = new Map<string, BuildCandidate>()
  candidates.forEach((candidate) => {
    const key = candidateDeduplicationKey(candidate)
    const current = selected.get(key)
    if (!current || compareDuplicateCandidates(candidate, current) < 0) {
      selected.set(key, candidate)
    }
  })
  return [...selected.values()]
}

function nullableAscending(left: number | null, right: number | null): number {
  if (left === null) return right === null ? 0 : 1
  if (right === null) return -1
  return left - right
}

export function compareCandidates(
  left: BuildCandidate,
  right: BuildCandidate,
): number {
  const categoryOrder = { ideal: 0, practical: 1 }
  return (
    categoryOrder[left.category] - categoryOrder[right.category] ||
    left.estimatedOperationCount - right.estimatedOperationCount ||
    left.estimatedGogmaAdvance - right.estimatedGogmaAdvance ||
    left.estimatedSkillAdvance - right.estimatedSkillAdvance ||
    nullableAscending(
      left.estimatedNormalAdvance,
      right.estimatedNormalAdvance,
    ) ||
    (right.similarityScore ?? -1) - (left.similarityScore ?? -1) ||
    right.idealDifference.matchedBonusCount -
      left.idealDifference.matchedBonusCount ||
    left.id.localeCompare(right.id)
  )
}

export function sortCandidates(
  candidates: readonly BuildCandidate[],
): BuildCandidate[] {
  return [...candidates].sort(compareCandidates)
}

export function filterCandidates(
  candidates: readonly BuildCandidate[],
  filter: CandidateResultFilter,
): BuildCandidate[] {
  if (filter === 'all') return [...candidates]
  if (filter === 'ideal') {
    return candidates.filter(({ category }) => category === 'ideal')
  }
  if (filter === 'practical') {
    return candidates.filter(({ category }) => category === 'practical')
  }
  return candidates.filter(
    (candidate) =>
      candidate.category === 'practical' && candidate.isSimilarToIdeal,
  )
}
