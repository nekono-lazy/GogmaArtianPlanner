/**
 * The legacy B8 constrained re-search and B9 what-if (Phase 6-B2b removes
 * them). The shared primitives they stand on are exported by
 * `../replacement`, never from here (Phase 6-B2a). The materialization error is
 * the one exception: its legacy path stays a compatibility facade re-exporting
 * the very same constructor.
 */
export * from './constrainedMaterializationErrors'
export * from './constrainedMaterializer'
export * from './constrainedSearchIdentity'
export * from './plannerConstrainedOrchestration'
export * from './plannerOrchestrationBounds'
export * from './plannerRerunBudget'
export * from './plannerWhatIfBounds'
/**
 * The B9-B1b what-if Domain calculation exposes exactly its entry point and its
 * cancellation signal. The shared full-run budget, the feasibility predicate and
 * the enumeration-outcome mapping stay internal to the B9 implementation, so
 * `plannerWhatIfRerunBudget` is deliberately not re-exported here.
 */
export {
  createPlannerWhatIfComparison,
  PlannerWhatIfCancelledError,
} from './plannerWhatIfCalculation'
export * from './plannerWhatIfTypes'
