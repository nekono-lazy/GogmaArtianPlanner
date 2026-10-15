/**
 * Issue #154 Global Assignment Phase D-0A-2b (Research adapter; never imported by the app).
 *
 * Design D0A2 10.3 / 10.4: the scale of one shape-constrained Search, its gate and its runtime budget are the Production Domain's
 * (`src/domain/planner/buildListOptimization/shapeSearchScale.ts`, Issue #260 PR-3). This adapter keeps the Research names; every
 * gate and budget value stays the caller's explicit contract (the formal values are registered in D-0B-2).
 */
export {
  exceededShapeSearchBudget,
  exceededShapeSearchScaleGate,
  isValidShapeSearchBudget,
  isValidShapeSearchScaleGate,
  predictShapeConstrainedSearchScale as predictShapeSearchScale,
  type ShapeScaleInput,
  type ShapeSearchUsage,
} from '../../domain/planner/buildListOptimization'
