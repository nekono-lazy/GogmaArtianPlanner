/*
 * The Build List global optimization (`docs/PLANNER_SPEC.md` 17, Issue #260): the Production Domain module of
 * Stage 0 (planning Target context), Stage A (ReachTable and reach options) and Stage B / C (resource assignment,
 * coverage-gated structural candidates, materialization order and expected Route shapes), moved from the Global
 * Assignment Research (Issue #154), which reuses it through its own adapters. Stage D / D' (materialization and the
 * final Planner verification) are not part of it yet.
 *
 * Not re-exported by `src/domain/planner/index.ts`: callers import this module path.
 */
export * from './assignmentFeasibility'
export * from './assignmentLowerBound'
export * from './assignmentOrdering'
export * from './assignmentSolver'
export * from './assignmentTypes'
export * from './buildListOptimizationTypes'
export * from './coverage'
export * from './coverageSearch'
export * from './coverageSearchTypes'
export * from './coverageTypes'
export * from './planningContext'
export * from './reachOptions'
export * from './reachTable'
export * from './requiredOnlyReplay'
export * from './structuralCandidate'
export * from './structuralSearch'
