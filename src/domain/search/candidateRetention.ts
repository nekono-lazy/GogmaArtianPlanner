import type { BuildCandidate, BuildRoute, MaterialRequirement, WeaponTypeId } from '../models/publicTypes'
import type { SearchMasterSubset } from './searchTypes'
import { compareCandidateSelection, compareCanonicalIdeals, deduplicateCandidates } from './candidateProcessing'

/**
 * DATA_MODEL 7 / 9.2 and validateProtectedRouteUse / validateBuildRoute:
 * Bonus amendments and material consumption are destructive operations.
 * Conversion consumes an owned Normal source; a newly forged source is not
 * existing inventory. Reset Skills mutates performance but not this function's
 * narrower bonus/material destruction axis. Protection eligibility is validated
 * separately for every performance mutation. This classification is local to
 * initial Search retention, not Planner scoring.
 */
export function isDestructiveCandidateRoute(route: BuildRoute): boolean {
  return route.operations.some((operation) =>
    operation.type === 'reset_bonuses' ||
    operation.type === 'keep_bonuses' ||
    operation.type === 'use_weapon_as_material' ||
    (operation.type === 'convert_normal_to_gogma' && route.kind === 'owned_normal_artian_to_gogma'),
  )
}

function rankVectors(candidate: BuildCandidate, master: SearchMasterSubset, weaponTypeId: WeaponTypeId): Map<string, number[]> | null {
  const grouped = new Map<string, number[]>()
  for (const bonus of candidate.finalBonuses) {
    const ranks = master.bonusRanks.filter(({ id }) => id === bonus.bonusRankId)
    const rank = ranks[0]
    if (ranks.length !== 1 || !rank.isEnabled || !Number.isFinite(rank.order) ||
      !master.bonusTypes.some(({ id, isEnabled }) => id === bonus.bonusTypeId && isEnabled) ||
      !master.weaponBonusDefinitions.some((definition) =>
        definition.isEnabled && definition.weaponTypeId === weaponTypeId &&
        definition.scope === candidate.restorationBonusScope &&
        definition.bonusTypeId === bonus.bonusTypeId && definition.bonusRankId === bonus.bonusRankId,
      )) return null
    const vector = grouped.get(bonus.bonusTypeId) ?? []
    vector.push(rank.order)
    grouped.set(bonus.bonusTypeId, vector)
  }
  for (const vector of grouped.values()) vector.sort((a, b) => b - a)
  return grouped
}

function materials(requirements: readonly MaterialRequirement[]): Map<string, number> {
  const quantities = new Map<string, number>()
  for (const { materialId, quantity } of requirements) {
    quantities.set(materialId, (quantities.get(materialId) ?? 0) + quantity)
  }
  return quantities
}

/** SEARCH_SPEC 5.5.6: true only when all ten conservative conditions hold. */
export function practicalDominates(better: BuildCandidate, worse: BuildCandidate, master: SearchMasterSubset, weaponTypeId: WeaponTypeId): boolean {
  if (better.category !== 'practical' || worse.category !== 'practical' ||
    better.targetWeaponId !== worse.targetWeaponId ||
    better.restorationBonusScope !== worse.restorationBonusScope ||
    better.seriesSkillId !== worse.seriesSkillId || better.groupSkillId !== worse.groupSkillId ||
    better.route.sourceOwnedWeaponId !== worse.route.sourceOwnedWeaponId ||
    isDestructiveCandidateRoute(better.route) !== isDestructiveCandidateRoute(worse.route) ||
    (better.estimatedNormalAdvance === null) !== (worse.estimatedNormalAdvance === null)) return false

  let strict = false
  const costs = [
    [better.estimatedOperationCount, worse.estimatedOperationCount],
    [better.estimatedGogmaAdvance, worse.estimatedGogmaAdvance],
    [better.estimatedSkillAdvance, worse.estimatedSkillAdvance],
    [better.estimatedNormalAdvance ?? 0, worse.estimatedNormalAdvance ?? 0],
  ]
  for (const [b, a] of costs) {
    if (b > a) return false
    strict ||= b < a
  }

  const bRanks = rankVectors(better, master, weaponTypeId)
  const aRanks = rankVectors(worse, master, weaponTypeId)
  if (!bRanks || !aRanks || bRanks.size !== aRanks.size) return false
  for (const [type, a] of aRanks) {
    const b = bRanks.get(type)
    if (!b || b.length !== a.length) return false
    for (let i = 0; i < a.length; i += 1) {
      if (b[i] < a[i]) return false
      strict ||= b[i] > a[i]
    }
  }

  const bMaterials = materials(better.requiredMaterials)
  const aMaterials = materials(worse.requiredMaterials)
  for (const id of new Set([...bMaterials.keys(), ...aMaterials.keys()])) {
    const b = bMaterials.get(id) ?? 0
    const a = aMaterials.get(id) ?? 0
    if (b > a) return false
    strict ||= b < a
  }
  return strict
}

/** No filter or output cap may influence the horizon or dominance. */
export function retainInitialCandidates(candidates: readonly BuildCandidate[], master: SearchMasterSubset, weaponTypeId: WeaponTypeId, cap: number) {
  const unique = deduplicateCandidates(candidates)
  const canonicalIdeal = unique.filter(({ category }) => category === 'ideal').sort(compareCanonicalIdeals)[0] ?? null
  const horizon = unique.filter((candidate) => candidate.category === 'practical' &&
    (canonicalIdeal === null || candidate.estimatedOperationCount <= canonicalIdeal.estimatedOperationCount))
  const practical = horizon.filter((candidate) =>
    !horizon.some((other) => other !== candidate && practicalDominates(other, candidate, master, weaponTypeId)),
  ).sort(compareCandidateSelection)
  const retained = canonicalIdeal ? [canonicalIdeal, ...practical] : practical
  return { canonicalIdeal, horizon, retained, bounded: retained.slice(0, cap) }
}
