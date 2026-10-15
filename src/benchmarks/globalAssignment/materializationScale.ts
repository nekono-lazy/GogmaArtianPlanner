/**
 * Issue #154 Global Assignment Phase D-0A (Research adapter; never imported by the app).
 *
 * Design 9.7: the Search scale of one projected Candidate Search is the Production Domain's
 * (`src/domain/planner/buildListOptimization/projectedSearchScale.ts`, Issue #260 PR-3), and the D-0A Planner Alternative request
 * is predicted with the same function. This adapter keeps the Research names and the Research-only method choice of the rule
 * `d0a-v1` (`isSmallerSearchScale()`), which Production does not carry.
 */
import { PROJECTED_SEARCH_SCALE_KEYS, type PredictedSearchScale } from '../../domain/planner/buildListOptimization'

export {
  exceededSearchScaleGate,
  isValidSearchScaleGate,
  predictProjectedSearchScale as predictSearchScale,
  type SearchScaleInput,
} from '../../domain/planner/buildListOptimization'

/**
 * The design 9.3 "smaller predicted scale" for the method choice: `left` is smaller only when it is no
 * larger in every component and strictly smaller in one (Pareto dominance). The components measure
 * different Search dimensions, so no weighting or component order is invented; a tie and an incomparable
 * pair are both "not smaller", which the design resolves to the projected Candidate Search. A D-0A
 * decision recorded in the design (9.9).
 */
export function isSmallerSearchScale(left: PredictedSearchScale, right: PredictedSearchScale): boolean {
  return PROJECTED_SEARCH_SCALE_KEYS.every(key => left[key] <= right[key]) && PROJECTED_SEARCH_SCALE_KEYS.some(key => left[key] < right[key])
}
