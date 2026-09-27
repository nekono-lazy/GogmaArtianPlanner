/**
 * Failure modes of the shared deterministic materializer
 * (`createDeterministicMaterializer()`) and of resolving a Target from a
 * Planner-start Search origin (Phase 6-B2a; formerly
 * `PlannerMaterializationError` of the B8-C2 materializer, with the same
 * codes and messages).
 *
 * Every one of them fails closed: no partially built Candidate, no fallback to
 * a random ID, and no overwrite of an existing BuildListEntry. The caller reads
 * `code`, never the message text.
 */
export type PlannerMaterializationErrorCode =
  /** The Target is missing from the origin, or the Candidate names another one. */
  | 'target_mismatch'
  /** The materialized `BuildCandidate` failed `validateBuildCandidate()`. */
  | 'invalid_candidate'
  /**
   * An existing BuildListEntry already holds the deterministic generated ID
   * while carrying different current semantic content. It is kept as history
   * and never overwritten, and no substitute ID is invented.
   */
  | 'generated_entry_id_collision'

export class PlannerMaterializationError extends Error {
  readonly code: PlannerMaterializationErrorCode

  constructor(code: PlannerMaterializationErrorCode, message: string) {
    super(message)
    this.name = 'PlannerMaterializationError'
    this.code = code
  }
}
