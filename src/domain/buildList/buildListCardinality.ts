import type {
  BuildCandidate,
  BuildListEntry,
  BuildListEntryId,
  DomainValidationIssue,
  DomainValidationResult,
  TargetWeaponId,
} from '../models/publicTypes'
import { isSameBuildListCandidate } from './buildListEntry'

function compareStableStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * One TargetWeapon holding two or more persisted BuildListEntries - a legacy
 * duplicate of the Build List cardinality contract (`docs/DATA_MODEL.md` 9.4.1).
 * `buildListEntryIds` is in stable ID order.
 */
export interface BuildListTargetDuplicate {
  targetWeaponId: TargetWeaponId
  buildListEntryIds: BuildListEntryId[]
}

/**
 * The one collection-level authority of the Build List cardinality contract
 * (`docs/DATA_MODEL.md` 9.4.1): at most one persisted BuildListEntry per
 * `targetWeaponId`.
 *
 * Every Entry counts, stale ones included, because a stale Entry is replaced
 * rather than kept beside a newer Entry of the same Target. The result is
 * deterministic - Targets in stable ID order, each with its Entry IDs in stable
 * ID order - and says nothing about which Entry to keep: a legacy duplicate is
 * never resolved by choosing one (shortest Route, newest `createdAt`, ID order
 * or staleness). The Build List, the Search addition and the ordinary Planner
 * input all read this one helper.
 */
export function findBuildListTargetDuplicates(
  entries: readonly Pick<BuildListEntry, 'id' | 'targetWeaponId'>[],
): BuildListTargetDuplicate[] {
  const idsByTarget = new Map<TargetWeaponId, BuildListEntryId[]>()
  entries.forEach(({ id, targetWeaponId }) => {
    const ids = idsByTarget.get(targetWeaponId)
    if (ids) ids.push(id)
    else idsByTarget.set(targetWeaponId, [id])
  })
  return [...idsByTarget]
    .filter(([, ids]) => ids.length >= 2)
    .sort(([left], [right]) => compareStableStrings(left, right))
    .map(([targetWeaponId, ids]) => ({
      targetWeaponId,
      buildListEntryIds: [...ids].sort(compareStableStrings),
    }))
}

/** The Build List cardinality contract as a validation result: one issue per duplicated Target. */
export function validateBuildListCardinality(
  entries: readonly Pick<BuildListEntry, 'id' | 'targetWeaponId'>[],
): DomainValidationResult {
  const issues: DomainValidationIssue[] = findBuildListTargetDuplicates(entries).map(
    ({ targetWeaponId, buildListEntryIds }) => ({
      path: 'buildListEntries',
      code: 'invalid_structure',
      message:
        `TargetWeapon '${targetWeaponId}' has ${buildListEntryIds.length} BuildListEntries (${buildListEntryIds.join(', ')}); the Build List holds at most one Entry per Target.`,
    }),
  )
  return { isValid: issues.length === 0, issues }
}

/** The persisted Entries of one Target, in stable ID order. */
export function buildListEntriesForTarget<T extends Pick<BuildListEntry, 'id' | 'targetWeaponId'>>(
  entries: readonly T[],
  targetWeaponId: TargetWeaponId,
): T[] {
  return entries
    .filter((entry) => entry.targetWeaponId === targetWeaponId)
    .sort((left, right) => compareStableStrings(left.id, right.id))
}

/**
 * What adding one Search Candidate to the persisted Build List means
 * (`docs/DATA_MODEL.md` 9.4.1 「Candidate Searchからの追加と置換」):
 *
 * - `target_empty`: the Target has no Entry, so the Candidate is added as before
 * - `duplicate`: an Entry of the same semantic Candidate exists; nothing is
 *   written and its selection and improvement preference are never overwritten
 * - `replacement_required`: the Target holds one Entry of another Candidate;
 *   it may only be replaced after the user confirmed it
 * - `legacy_duplicate`: the Target already holds two or more Entries, so which
 *   one a replacement would replace is unknown and both addition and
 *   replacement are refused until the user tidied the Build List
 */
export type BuildListCandidateAdditionState =
  | { status: 'target_empty' }
  | { status: 'duplicate'; entry: BuildListEntry }
  | { status: 'replacement_required'; existingEntry: BuildListEntry }
  | { status: 'legacy_duplicate'; entries: BuildListEntry[] }

/**
 * Classifies one Candidate addition against the persisted Build List. It is a
 * pure decision: it writes nothing and never picks an Entry of a legacy
 * duplicate. The semantic duplicate rule of `docs/DATA_MODEL.md` 9.4 comes
 * first, so re-adding a Candidate that is already in the Build List stays a
 * write-free duplicate whatever else the Target holds.
 */
export function classifyBuildListCandidateAddition(
  entries: readonly BuildListEntry[],
  candidate: BuildCandidate,
): BuildListCandidateAdditionState {
  const targetEntries = buildListEntriesForTarget(entries, candidate.targetWeaponId)
  const same = targetEntries.find((entry) => isSameBuildListCandidate(entry, candidate))
  if (same) return { status: 'duplicate', entry: same }
  if (targetEntries.length === 0) return { status: 'target_empty' }
  if (targetEntries.length === 1) {
    return { status: 'replacement_required', existingEntry: targetEntries[0] }
  }
  return { status: 'legacy_duplicate', entries: targetEntries }
}
