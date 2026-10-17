import type { CandidateSearchInput } from '../../domain/search'
import type {
  CandidateSearchSourceExclusionSnapshot,
  PreparedCandidateSearchInput,
} from '../../services/search/prepareCandidateSearchInput'

/**
 * A prepared Candidate Search input shaped as `prepareCandidateSearchInput()` returns it (Issue #157,
 * `docs/SEARCH_SPEC.md` 3.3): with the exclusion off the input carries no `excludedSourceOwnedWeaponIds` and there is
 * no snapshot; with it on the input excludes exactly the snapshot's IDs (by default nothing).
 */
export function preparedFixtureInput(
  input: CandidateSearchInput,
  excludeOtherTargetSources: boolean,
  sourceExclusion?: CandidateSearchSourceExclusionSnapshot,
): PreparedCandidateSearchInput {
  if (!excludeOtherTargetSources) {
    const withoutExclusion: CandidateSearchInput = { ...input }
    delete withoutExclusion.excludedSourceOwnedWeaponIds
    return { input: withoutExclusion, sourceExclusion: null }
  }
  const snapshot: CandidateSearchSourceExclusionSnapshot = sourceExclusion ?? {
    exclusion: { targetWeaponId: input.targetWeaponId, excludedOwnedWeaponIds: [], usages: [] },
    ownedWeapons: [],
    targetWeapons: [],
  }
  return {
    input: { ...input, excludedSourceOwnedWeaponIds: [...snapshot.exclusion.excludedOwnedWeaponIds] },
    sourceExclusion: snapshot,
  }
}
