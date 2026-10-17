import { expect } from 'vitest'
import {
  rejectedBuildListEntryResourceConflictCauses,
  type BuildListEntry,
  type RejectedBuildListEntry,
} from '../../domain/models/publicTypes'

/**
 * A copy of `value` in which every `rejectedBuildListEntries` record, at any
 * depth, lacks the two fields Issue #121 added (`targetWeaponId`,
 * `resourceConflictCause`; `docs/PLANNER_SPEC.md` 9.6.9.1). A golden digest
 * recorded before those fields existed keeps hashing exactly the content it
 * recorded; the fields themselves are checked on their own
 * (`expectRejectedRecordsCopyTheInput()`), never by rewriting a recorded value.
 */
export function withoutIssue121RejectedRecordFields<T>(value: T): T {
  return project(value) as T
}

function project(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(project)
  // Only plain objects are rebuilt; anything else is hashed exactly as it was.
  if (typeof value !== 'object' || value === null || Object.getPrototypeOf(value) !== Object.prototype) return value
  return Object.fromEntries(Object.entries(value).map(([key, field]) => [
    key,
    key === 'rejectedBuildListEntries' && Array.isArray(field)
      ? field.map((record: unknown) => {
          if (typeof record !== 'object' || record === null) return record
          const recorded: Partial<RejectedBuildListEntry> = { ...record }
          delete recorded.targetWeaponId
          delete recorded.resourceConflictCause
          return project(recorded)
        })
      : project(field),
  ]))
}

/**
 * Every record names the Target of its Entry in `entries` (the run's input),
 * and exactly the `resource_conflict` records carry a known cause.
 */
export function expectRejectedRecordsCopyTheInput(
  records: readonly RejectedBuildListEntry[],
  entries: readonly BuildListEntry[],
) {
  const targetByEntryId = new Map(entries.map(({ id, targetWeaponId }) => [id, targetWeaponId]))
  records.forEach((record) => {
    expect(targetByEntryId.has(record.buildListEntryId)).toBe(true)
    expect(record.targetWeaponId).toBe(targetByEntryId.get(record.buildListEntryId))
    if (record.reason === 'resource_conflict') {
      expect(rejectedBuildListEntryResourceConflictCauses).toContain(record.resourceConflictCause)
    } else {
      expect('resourceConflictCause' in record).toBe(false)
    }
  })
}
