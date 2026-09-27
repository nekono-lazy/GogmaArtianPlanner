/**
 * The shared Planner Domain primitives of Route replacement for a fixed
 * conflict choice (Phase 6-B2a, `docs/PLANNER_SPEC.md` 9.2.19.16): conflict
 * contexts and fixed Entry constraints, the augmented / replacement preflight,
 * conflict works, scenario preparation, the Planner-start Search origin and the
 * deterministic materializer core. The Planner Alternative and the legacy
 * B8 / B9 path both depend on this module; it depends on neither.
 */
export * from './plannerAugmentedPreflight'
export * from './plannerConflictContext'
export * from './plannerConflictScenario'
export * from './plannerConflictWork'
export * from './plannerDeterministicMaterializer'
export * from './plannerMaterializationErrors'
export * from './plannerSearchOrigin'
