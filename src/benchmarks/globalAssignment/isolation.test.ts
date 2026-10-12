import { describe, expect, it } from 'vitest'
import { DATABASE_SCHEMA_VERSION } from '../../db/AppDatabase'
import { CURRENT_CALCULATION_APP_SCHEMA_VERSION, recommendedCandidateSearchDefaults } from '../../domain/models/common'
import { EXPORT_SCHEMA_VERSION } from '../../domain/models/exportModel'
import { defaultPlannerAlternativeTrialBounds } from '../../domain/planner/alternative/plannerAlternativeTrial'
import { defaultPlannerOptions } from '../../domain/planner/plannerTypes'
import { PRODUCTION_RNG_ENGINE_VERSION } from '../../domain/rng/production/productionRngEngine'
import { defaultPlannerAlternativeSearchExtent } from '../../domain/search/alternative'

/*
 * Issue #154 Global Assignment (design 11 / 16): Research only. Nothing Production reaches these modules,
 * the runtime modules read no oracle manifest / result / lower-bound module, no Target or weapon ID, no
 * file, network or persistence, and no clock or random value.
 */
const production = {
  ...import.meta.glob('../../{app,components,db,domain,services,stores,workers,pages,presentation,data}/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../../*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }),
} as Record<string, string>
const research = import.meta.glob('./*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const runtime = Object.entries(research).filter(([path]) => !/\.test\.ts$|[tT]estFixture\.ts$/.test(path))
const scripts = import.meta.glob('../../../scripts/*.mjs', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

describe('Global Assignment Research isolation', () => {
  it('is imported by no Production module and by no script', () => {
    const productionPaths = Object.keys(production).filter(path => !/\.test\.tsx?$/.test(path))
    expect(productionPaths.length).toBeGreaterThan(100)
    const forbidden = /globalAssignment|GlobalAssignment|buildReachTable|enumerateReachOptions|replayReachOptionRequiredOnly|ReachTable|ResourceAssignment|createResourceAssignmentSearch|collectResourceAssignments/
    expect(productionPaths.filter(path => forbidden.test(production[path]!))).toEqual([])
    expect(Object.keys(scripts).filter(path => forbidden.test(scripts[path]!))).toEqual([])
  })

  it('has the expected runtime modules, each reading only the PlannerInput, the Engine and the Production authorities', () => {
    expect(runtime.map(([path]) => path).sort()).toEqual([
      './assignmentFeasibility.ts', './assignmentLowerBound.ts', './assignmentOrdering.ts', './assignmentSolver.ts', './assignmentTypes.ts',
      './context.ts', './reachOptions.ts', './reachTable.ts', './requiredOnlyReplay.ts', './types.ts',
    ])
    for (const [path, source] of runtime) {
      // No oracle manifest / verifier / RESULT, no lower-bound module, no earlier Phase result.
      expect(source, path).not.toMatch(/plannerGlobalOracle|ORACLE_1657|plannerGlobalLowerBound|PLANNER_GLOBAL_[A-Z0-9_]*RESULT|\.json['"]/)
      // No Target / OwnedWeapon ID, Export hash or UUID literal.
      expect(source, path).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
      expect(source, path).not.toMatch(/\b[0-9a-f]{64}\b/i)
      // No file, network or persistence read, no clock, no random value, no enumeration ordinal as identity.
      expect(source, path).not.toMatch(/readFile|fetch\(|indexedDB|Dexie|localStorage|sessionStorage|from ['"][^'"]*(?:\/db\/|repositories|importExportService)/)
      expect(source, path).not.toMatch(/Math\.random|Date\.now|new Date\(|randomUUID|performance\.now/)
      // Only Production Domain authorities and this folder are imported: no Production Search / Planner module is re-implemented.
      for (const match of source.matchAll(/from '([^']+)'/g)) expect(match[1], `${path} imports ${match[1]}`).toMatch(/^\.\/|^\.\.\/\.\.\/domain\//)
    }
    // The Phase A / B-1 runtime never reads the existing Entries' Route contents (design 4.1): only the context does, through the Production validation.
    for (const [path, source] of runtime.filter(([path]) => path !== './context.ts' && path !== './types.ts')) {
      expect(source, path).not.toMatch(/candidateSnapshot|\.route\b|buildListEntries\b(?!\.length)/)
    }
    // The Phase B-1 solver reads the ReachTable and the planning Targets' id / priority only: no PlannerInput, Engine, Master or Entry (design 6 / 11).
    for (const path of ['./assignmentFeasibility.ts', './assignmentLowerBound.ts', './assignmentOrdering.ts', './assignmentSolver.ts']) {
      expect(research[path], path).not.toMatch(/plannerInput|RngEngine|predict[A-Z]|\.master\b|ownedWeapons|normalCounters|rngState/)
      for (const match of research[path]!.matchAll(/from '([^']+)'/g)) expect(match[1], `${path} imports ${match[1]}`).toMatch(/^\.\//)
    }
  })

  it('lets only the designated parity test read the lower-bound module', () => {
    const readers = Object.keys(research).filter(path => /plannerGlobalLowerBound/.test(research[path]!))
    expect(readers).toEqual(['./reachTable.test.ts'])
  })

  it('changes no Production default, schema or version', () => {
    expect(CURRENT_CALCULATION_APP_SCHEMA_VERSION).toBe(17)
    expect(DATABASE_SCHEMA_VERSION).toBe(10)
    expect(EXPORT_SCHEMA_VERSION).toBe(13)
    expect(PRODUCTION_RNG_ENGINE_VERSION).toBe('production-rng:c5-e7')
    expect(defaultPlannerOptions).toEqual({ maxPlanSteps: 1000 })
    expect({ ...recommendedCandidateSearchDefaults }).toEqual({ maxNormalAdvance: 350, maxGogmaAdvance: 500, maxSkillAdvance: 1500 })
    expect(defaultPlannerAlternativeSearchExtent).toEqual({ maxNormalAdvance: 4, maxGogmaAdvance: 235, maxSkillAdvance: 4 })
    expect(defaultPlannerAlternativeTrialBounds).toEqual({ maxCandidateTrialsPerTarget: 2, maxPlannerReruns: 8 })
  })
})
