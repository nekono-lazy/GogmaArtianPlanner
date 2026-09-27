/**
 * Compatibility facade (Phase 6-B2a, removed in Phase 6-B2b): the legacy
 * import path of the materialization error. The error itself now lives in the
 * shared `../replacement/plannerMaterializationErrors`, which keeps its runtime
 * contract - the one `ConstrainedMaterializationError` constructor, its `name`,
 * `code` and messages - so importing it from here or from there yields the
 * very same constructor.
 */
export {
  ConstrainedMaterializationError,
  PlannerMaterializationError,
  type ConstrainedMaterializationErrorCode,
  type PlannerMaterializationErrorCode,
} from '../replacement/plannerMaterializationErrors'
