import { describe, expect, it } from 'vitest'
import { DATABASE_SCHEMA_VERSION } from '../../../db/AppDatabase'
import { CURRENT_CALCULATION_APP_SCHEMA_VERSION } from '../../models/common'
import { EXPORT_SCHEMA_VERSION } from '../../models/exportModel'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../../rng/production/productionRngEngine'
import * as alternativeExports from '../alternative'
import * as searchExports from '../index'
import * as researchExports from '../research'
import * as shapeConstrainedExports from './index'
import { SHAPE_CONSTRAINED_ROUTE_POLICY_VERSION } from './shapeConstrainedTypes'

/*
 * The shape-constrained Route search (`docs/SEARCH_SPEC.md` 5.6.9) became a Production Search API in Issue #260 PR-2
 * (`docs/PLANNER_GLOBAL_ASSIGNMENT_PRODUCTION_INTEGRATION.md` 7.2 / 7.3 / 7.8). Before that it was Research only
 * (Issue #154 Phase D-0A-2a) and this file forbade any Production use; it now fixes the boundary of the move instead:
 *
 * - the search lives in `src/domain/search/shapeConstrained/` and is part of the public Search exports, while the seam
 *   helpers it shares with Planner Alternative Search stay internal
 * - only the Search Domain names the seam fields (the seven seam files and this module), and Candidate Search and
 *   Planner Alternative Search never pass them (their unspecified behavior is the golden's and their own tests')
 * - no Production module imports the Research adapter (`src/domain/search/research/`), which re-exports the very same
 *   functions and keeps its own route policy token, distinct from the Production one
 * - no calculation, persistence or RNG version moved
 */

/** Every source by repository path (Vite names glob keys relative to this file, so they are resolved first). */
const sources = Object.fromEntries(Object.entries({
  ...import.meta.glob('../../../{app,components,db,domain,services,stores,workers,pages,presentation,data}/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../../../*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }),
} as Record<string, string>).map(([key, source]) => [new URL(key, 'file:///repo/src/domain/search/shapeConstrained/test.ts').pathname.slice('/repo/'.length), source]))
const production: Record<string, string> = Object.fromEntries(Object.entries(sources)
  .filter(([path]) => !/\.test\.tsx?$/.test(path) && !path.startsWith('src/domain/search/research/')))
const productionPaths = Object.keys(production)

/** The Production Search Domain files that carry the seam (design 4.2), unchanged by the move. */
const SEAM_FILES = [
  'src/domain/search/alternative/plannerAlternativeSearch.ts',
  'src/domain/search/bonusStream.ts',
  'src/domain/search/existingGogmaRouteSearch.ts',
  'src/domain/search/normalArtianRouteSearch.ts',
  'src/domain/search/ownedNormalArtianRouteSearch.ts',
  'src/domain/search/routeSearchShared.ts',
  'src/domain/search/targetSearchScheduler.ts',
]
const SHAPE_CONSTRAINED_MODULE = 'src/domain/search/shapeConstrained/'

describe('shape-constrained Route search: Production API boundary', () => {
  it('is reached by no Production module through the Research adapter', () => {
    expect(productionPaths.length).toBeGreaterThan(100)
    expect(productionPaths.filter((path) => /from '[^']*\/research(?:\/[^']*)?'/.test(production[path]!))).toEqual([])
    // The Research route policy token is the Research adapter's alone.
    expect(productionPaths.filter((path) => /research-shape-constrained-route-policy/.test(production[path]!))).toEqual([])
  })

  it('is named, outside its own module, by the public Search barrel only (its one Production caller comes with Stage D)', () => {
    const callers = productionPaths.filter((path) => /visitShapeConstrainedRouteCandidates|ShapeConstrainedSearch|RouteShapeConstraint/.test(production[path]!))
    expect(callers.filter((path) => !path.startsWith(SHAPE_CONSTRAINED_MODULE))).toEqual([])
    expect(production['src/domain/search/index.ts']).toMatch(/^export \* from '\.\/shapeConstrained'$/m)
  })

  it('confines the seam fields to the seam files and the shape-constrained module, and Planner Alternative Search passes none', () => {
    const carriers = productionPaths.filter((path) =>
      /\b(?:routeBaseConstraint|routeShapeFilter|shapePolicy|shapeFilter|ScheduledRouteShapeFilter|createPlannerAlternativeFrontier)\b/.test(production[path]!))
    expect(carriers.filter((path) => !path.startsWith(SHAPE_CONSTRAINED_MODULE)).sort()).toEqual(SEAM_FILES)
    expect(carriers.filter((path) => path.startsWith(SHAPE_CONSTRAINED_MODULE)).sort()).toEqual([
      'src/domain/search/shapeConstrained/index.ts',
      'src/domain/search/shapeConstrained/shapeConstrainedSearch.ts',
      'src/domain/search/shapeConstrained/shapeConstrainedValidation.ts',
    ])
    // Planner Alternative Search builds its frontier with neither seam field.
    const search = production['src/domain/search/alternative/plannerAlternativeSearch.ts']!
    const visit = /export async function visitPlannerAlternativeCandidates\([\s\S]*?\n\}\n/.exec(search)?.[0] ?? ''
    expect(visit).toContain('createPlannerAlternativeFrontier({ target, reservation, origin, extent, engine, options })')
    expect(visit).not.toMatch(/routeBaseConstraint|routeShapeFilter|shapeFilter/)
    // The schedulers are constructed without a shape filter argument (it travels in the shape-constrained context only).
    expect(search).toMatch(/^ {2}\}, runtime\)$/m)
    // Candidate Search (the ordinary entry point) names none of them either.
    expect(production['src/domain/search/candidateSearch.ts']).not.toMatch(/routeBaseConstraint|routeShapeFilter|shapePolicy|shapeFilter|visitShapeConstrainedRouteCandidates/)
  })

  it('exports the search and keeps the shared seam helpers internal', () => {
    for (const name of ['visitShapeConstrainedRouteCandidates', 'diagnoseShapeConstrainedBase', 'assertShapeConstrainedSearchInput', 'collectShapeConstraintIssues',
      'shapeConstrainedLaneNeeds', 'shapeConstrainedRouteBaseConstraint', 'shapeConstrainedBonusPolicy', 'ShapeConstrainedSearchError', 'SHAPE_CONSTRAINED_ROUTE_POLICY_VERSION']) {
      expect(name in searchExports, name).toBe(true)
    }
    for (const name of ['createPlannerAlternativeFrontier', 'openPlannerAlternativeSearchSections', 'PLANNER_ALTERNATIVE_ROUTE_REGISTRATIONS']) {
      expect(name in searchExports, name).toBe(false)
      expect(name in alternativeExports, name).toBe(false)
      expect(name in shapeConstrainedExports, name).toBe(false)
    }
    // The public Planner Alternative Search exports are unchanged.
    expect('visitPlannerAlternativeCandidates' in searchExports).toBe(true)
    expect('visitPlannerAlternativeCandidates' in alternativeExports).toBe(true)
    expect(production['src/domain/search/index.ts']).not.toMatch(/research/)
  })

  it('lets the Research adapter re-export the same functions and keep its own route policy token', () => {
    for (const name of ['visitShapeConstrainedRouteCandidates', 'diagnoseShapeConstrainedBase', 'assertShapeConstrainedSearchInput', 'collectShapeConstraintIssues',
      'shapeConstrainedLaneNeeds', 'shapeConstrainedRouteBaseConstraint', 'shapeConstrainedBonusPolicy', 'ShapeConstrainedSearchError'] as const) {
      expect(researchExports[name], name).toBe(shapeConstrainedExports[name])
    }
    expect(SHAPE_CONSTRAINED_ROUTE_POLICY_VERSION).toBe('shape-constrained-route-policy:v1')
    expect(searchExports.SHAPE_CONSTRAINED_ROUTE_POLICY_VERSION).toBe('shape-constrained-route-policy:v1')
    expect(researchExports.SHAPE_CONSTRAINED_ROUTE_POLICY_VERSION).toBe('research-shape-constrained-route-policy:v1')
    // The adapter holds no calculation: the Research folder is its barrel alone.
    const research = Object.keys(sources).filter((path) => path.startsWith('src/domain/search/research/'))
    expect(research).toEqual(['src/domain/search/research/index.ts'])
  })

  it('moves no calculation, persistence or RNG version', () => {
    expect(CURRENT_CALCULATION_APP_SCHEMA_VERSION).toBe(17)
    expect(DATABASE_SCHEMA_VERSION).toBe(10)
    expect(EXPORT_SCHEMA_VERSION).toBe(13)
    expect(PRODUCTION_RNG_ENGINE_VERSION).toBe('production-rng:c5-e7')
  })
})
