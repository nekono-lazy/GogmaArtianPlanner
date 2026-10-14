/**
 * Issue #154 Global Assignment Phase C-2 (Research adapter; never imported by the app).
 *
 * The structural candidate generator (`docs/PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md` 6.3 / 6.4) - the coverage-gated
 * assignment search whose every coverage-feasible assignment becomes a structural candidate - is the Production Domain's
 * (`src/domain/planner/buildListOptimization/structuralSearch.ts`, Issue #260 PR-2). The Research inputs name a Research
 * table, handed over with the rule its option set names.
 */
import * as production from '../../domain/planner/buildListOptimization'
import type { CoverageSearchRequest, CreateCoverageSearchResult, StructuralSearchDiagnostics, StructuralSearchResult } from './coverageSearchTypes'
import type { StructuralCandidate } from './coverageTypes'
import { productionStructuralCandidateInputs, type StructuralCandidateInputs } from './structuralCandidate'

export function createStructuralCandidateSearch(inputs: StructuralCandidateInputs, request: CoverageSearchRequest): CreateCoverageSearchResult<StructuralCandidate, StructuralSearchDiagnostics> {
  return production.createStructuralCandidateSearch(productionStructuralCandidateInputs(inputs), request)
}

export function collectStructuralCandidates(inputs: StructuralCandidateInputs, request: CoverageSearchRequest, candidateLimit: number): StructuralSearchResult {
  return production.collectStructuralCandidates(productionStructuralCandidateInputs(inputs), request, candidateLimit)
}
