import { describe, expect, it } from 'vitest'
import { DATABASE_SCHEMA_VERSION } from '../../../db/AppDatabase'
import { CURRENT_CALCULATION_APP_SCHEMA_VERSION } from '../../models/common'
import { EXPORT_SCHEMA_VERSION } from '../../models/exportModel'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../../rng/production/productionRngEngine'
import * as alternativeExports from '../alternative'
import * as searchExports from '../index'
import { SHAPE_CONSTRAINED_ROUTE_POLICY_VERSION } from './shapeConstrainedTypes'

/*
 * Issue #154 Global Assignment Phase D-0A-2a (`docs/SEARCH_SPEC.md` 5.6.9, `docs/PLANNER_GLOBAL_ASSIGNMENT_D0A2_DESIGN.md`
 * 4.2 / 15 "Production不変"): the shape-constrained Route search is Research only. No Production module imports it or
 * passes its Research-only fields, the public Search exports do not carry it, and no calculation, persistence or RNG
 * version moved.
 */

/** Every source by repository path (Vite names glob keys relative to this file, so they are resolved first). */
const sources = Object.fromEntries(Object.entries({
  ...import.meta.glob('../../../{app,components,db,domain,services,stores,workers,pages,presentation,data}/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../../../*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }),
} as Record<string, string>).map(([key, source]) => [new URL(key, 'file:///repo/src/domain/search/research/test.ts').pathname.slice('/repo/'.length), source]))
const production: Record<string, string> = Object.fromEntries(Object.entries(sources)
  .filter(([path]) => !/\.test\.tsx?$/.test(path) && !path.startsWith('src/domain/search/research/')))
const productionPaths = Object.keys(production)

/** The Production Search Domain files that carry the Research-only seam (design 4.2), and nothing else. */
const SEAM_FILES = [
  'src/domain/search/alternative/plannerAlternativeSearch.ts',
  'src/domain/search/bonusStream.ts',
  'src/domain/search/existingGogmaRouteSearch.ts',
  'src/domain/search/normalArtianRouteSearch.ts',
  'src/domain/search/ownedNormalArtianRouteSearch.ts',
  'src/domain/search/routeSearchShared.ts',
  'src/domain/search/targetSearchScheduler.ts',
]

describe('shape-constrained Route search isolation', () => {
  it('is imported by no Production module', () => {
    expect(productionPaths.length).toBeGreaterThan(100)
    expect(productionPaths.filter((path) => /from '[^']*\/research(?:\/[^']*)?'|visitShapeConstrainedRouteCandidates|ShapeConstrainedSearch/.test(production[path]!)))
      .toEqual([])
  })

  it('confines the Research-only seam fields to the seam files, and only Research passes them', () => {
    const carriers = productionPaths.filter((path) =>
      /\b(?:routeBaseConstraint|routeShapeFilter|shapePolicy|shapeFilter|ScheduledRouteShapeFilter|createPlannerAlternativeFrontier)\b/.test(production[path]!))
    expect(carriers.sort()).toEqual(SEAM_FILES)
    // Planner Alternative Search builds its frontier with neither Research field.
    const search = production['src/domain/search/alternative/plannerAlternativeSearch.ts']!
    const visit = /export async function visitPlannerAlternativeCandidates\([\s\S]*?\n\}\n/.exec(search)?.[0] ?? ''
    expect(visit).toContain('createPlannerAlternativeFrontier({ target, reservation, origin, extent, engine, options })')
    expect(visit).not.toMatch(/routeBaseConstraint|routeShapeFilter|shapeFilter/)
    // The Production schedulers are constructed without a shape filter argument (it travels in the Research context only).
    expect(search).toMatch(/^ {2}\}, runtime\)$/m)
    // No Production module outside the Search Domain names the seam.
    expect(carriers.filter((path) => !path.startsWith('src/domain/search/'))).toEqual([])
  })

  it('is not part of the public Search exports', () => {
    expect(production['src/domain/search/index.ts']).not.toMatch(/research/)
    for (const name of ['visitShapeConstrainedRouteCandidates', 'createPlannerAlternativeFrontier', 'openPlannerAlternativeSearchSections',
      'PLANNER_ALTERNATIVE_ROUTE_REGISTRATIONS', 'SHAPE_CONSTRAINED_ROUTE_POLICY_VERSION']) {
      expect(name in searchExports, name).toBe(false)
      expect(name in alternativeExports, name).toBe(false)
    }
    // The public Planner Alternative Search exports are unchanged.
    expect('visitPlannerAlternativeCandidates' in searchExports).toBe(true)
    expect('visitPlannerAlternativeCandidates' in alternativeExports).toBe(true)
  })

  it('moves no calculation, persistence or RNG version', () => {
    expect(CURRENT_CALCULATION_APP_SCHEMA_VERSION).toBe(17)
    expect(DATABASE_SCHEMA_VERSION).toBe(10)
    expect(EXPORT_SCHEMA_VERSION).toBe(13)
    expect(PRODUCTION_RNG_ENGINE_VERSION).toBe('production-rng:c5-e7')
    expect(SHAPE_CONSTRAINED_ROUTE_POLICY_VERSION).toBe('research-shape-constrained-route-policy:v1')
  })
})
