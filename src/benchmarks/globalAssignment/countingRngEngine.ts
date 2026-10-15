/**
 * Issue #154 Global Assignment Phase D-0A-2b (Research adapter; never imported by the app).
 *
 * Design D0A2 10.4: the counting wrapper around the Production RNG Engine is the Production Domain's
 * (`src/domain/planner/buildListOptimization/countingRngEngine.ts`, Issue #260 PR-3). This adapter keeps the Research names.
 */
export {
  createCountingRngEngine as createPredictionCountingEngine,
  snapshotPredictionCallCounts as snapshotCounts,
  type CountingRngEngine,
} from '../../domain/planner/buildListOptimization'
