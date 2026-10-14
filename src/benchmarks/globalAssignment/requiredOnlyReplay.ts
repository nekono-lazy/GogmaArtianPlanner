/**
 * Issue #154 Global Assignment Phase A (Research adapter; never imported by the app).
 *
 * The required-only replay of one reach option (`docs/PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md` 5.3, `rng_replayed`) is the
 * Production Domain's (`src/domain/planner/buildListOptimization/requiredOnlyReplay.ts`, Issue #260 PR-2), re-exported
 * unchanged: the one required-only replay authority of Phase C and D.
 */
export { replayReachOptionRequiredOnly, type ReachOptionReplayResult } from '../../domain/planner/buildListOptimization'
