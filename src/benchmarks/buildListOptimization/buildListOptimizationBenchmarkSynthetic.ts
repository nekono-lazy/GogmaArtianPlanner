import { createDefaultAppSettings } from '../../domain/models/factories'
import { EXPORT_APP_NAME, EXPORT_SCHEMA_VERSION, type ExportRoot } from '../../domain/models/exportModel'
import type { BuildListEntry, BuildListEntryId } from '../../domain/models/publicTypes'
import type { BuildListOptimizationBounds } from '../../domain/planner/buildListOptimization'
import type { PlannerInput } from '../../domain/planner'
import { BUILD_LIST_OPTIMIZATION_TEST_BOUNDS } from '../../test/fixtures/buildListOptimizationWorkerFixtures'
import { createPlannerSchedulerWorkloadInput } from '../../test/fixtures/plannerSchedulerWorkloads'

/**
 * Issue #260 PR-5A: synthetic inputs and synthetic search bounds for the harness's own mechanics checks (benchmark only).
 *
 * A synthetic case is an Export built from a Repository test fixture (the Production-valid `sanity-3` scheduler workload: the real
 * Master and `ProductionRngEngine`, no real user data), so a synthetic run takes exactly the measured input path of a real Export
 * (`prepareBloBenchmarkInput()`). The synthetic bounds are test values: none of them is a Production bound, a Research registered
 * value or a candidate for the Production constants (`docs/PLANNER_SPEC.md` 17.13 / 17.19 U2). They exist to make the harness show
 * each result class, a cancel inside a long stage, and its failure handling.
 */

/** Fixed so that a synthetic Export is byte-identical in every environment (its SHA-256 identifies the case). */
const SYNTHETIC_EXPORTED_AT = '2026-10-15T00:00:00.000Z'

export interface BloSyntheticCase {
  caseId: string
  /** What the case shows in a mechanics run. */
  note: string
  plannerInput(): PlannerInput
}

function sanity3(): PlannerInput {
  return createPlannerSchedulerWorkloadInput('sanity-3').input
}

export const BLO_SYNTHETIC_CASES: readonly BloSyntheticCase[] = Object.freeze([
  {
    caseId: 'synthetic.sanity-3',
    note: 'Three Targets on owned Gogma sources (the sanity-3 scheduler workload): optimized under the open synthetic bounds.',
    plannerInput: sanity3,
  },
  {
    caseId: 'synthetic.sanity-3.duplicate-entry',
    note: 'The same input with a legacy duplicate Entry of one Target: the whole input fails closed (unsupported, invalid_planner_input).',
    plannerInput: () => {
      const input = sanity3()
      const duplicate: BuildListEntry = { ...structuredClone(input.buildListEntries[0]!), id: 'build-list.synthetic.duplicate' as BuildListEntryId }
      return { ...input, buildListEntries: [...input.buildListEntries, duplicate] }
    },
  },
])

export function bloSyntheticCase(caseId: string): BloSyntheticCase {
  const found = BLO_SYNTHETIC_CASES.find(entry => entry.caseId === caseId)
  if (found === undefined) throw new Error(`Unknown synthetic case ${caseId}.`)
  return found
}

/** The Export of a synthetic case: the PlannerInput's persisted state in an ExportRoot of the current schema (no Plan, no history). */
export function bloSyntheticExportRoot(caseId: string): ExportRoot {
  const input = bloSyntheticCase(caseId).plannerInput()
  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    appName: EXPORT_APP_NAME,
    exportedAt: SYNTHETIC_EXPORTED_AT,
    rngState: structuredClone(input.rngState),
    normalArtianCounters: structuredClone(input.normalCounters),
    ownedWeapons: structuredClone(input.ownedWeapons),
    targetWeapons: structuredClone(input.targetWeapons),
    buildCandidates: [],
    buildListEntries: structuredClone(input.buildListEntries),
    productionPlans: [],
    executionHistory: [],
    executionSavePoints: [],
    settings: createDefaultAppSettings(SYNTHETIC_EXPORTED_AT),
  }
}

/** The Export text of a synthetic case (deterministic). */
export function bloSyntheticExportText(caseId: string): string {
  return JSON.stringify(bloSyntheticExportRoot(caseId))
}

export interface BloSyntheticBounds {
  boundsId: string
  note: string
  bounds: BuildListOptimizationBounds
}

function testBounds(overrides: Partial<BuildListOptimizationBounds>): BuildListOptimizationBounds {
  return { ...structuredClone(BUILD_LIST_OPTIMIZATION_TEST_BOUNDS), ...structuredClone(overrides) }
}

export const BLO_SYNTHETIC_BOUNDS: readonly BloSyntheticBounds[] = Object.freeze([
  {
    boundsId: 'synthetic.open',
    note: 'The Worker / Client test bounds (BUILD_LIST_OPTIMIZATION_TEST_BOUNDS): a small window with open gates and budgets.',
    bounds: testBounds({}),
  },
  {
    boundsId: 'synthetic.node-budget-1',
    note: 'The test bounds with a structural search node budget of 1: the search stops before its first candidate (search_bound_reached).',
    bounds: testBounds({ nodeBudget: 1 }),
  },
  {
    boundsId: 'synthetic.wide-window',
    note: 'The test bounds with the window Normal 300 / Gogma 400 / Skill 1200: a reach_table stage long enough (about a second) to land a cancel in.',
    bounds: testBounds({ window: { normal: 300, gogma: 400, skill: 1200 } }),
  },
])

export function bloSyntheticBounds(boundsId: string): BloSyntheticBounds {
  const found = BLO_SYNTHETIC_BOUNDS.find(entry => entry.boundsId === boundsId)
  if (found === undefined) throw new Error(`Unknown synthetic bounds ${boundsId}.`)
  return found
}
