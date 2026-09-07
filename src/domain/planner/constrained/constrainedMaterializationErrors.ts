/**
 * Failure modes of the B8-C2 deterministic constrained materializer.
 *
 * Every one of them fails closed: no partially built Candidate, no fallback to
 * a random ID, and no overwrite of an existing BuildListEntry. The caller reads
 * `code`, never the message text.
 */
export type ConstrainedMaterializationErrorCode =
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

export class ConstrainedMaterializationError extends Error {
  readonly code: ConstrainedMaterializationErrorCode

  constructor(code: ConstrainedMaterializationErrorCode, message: string) {
    super(message)
    this.name = 'ConstrainedMaterializationError'
    this.code = code
  }
}
