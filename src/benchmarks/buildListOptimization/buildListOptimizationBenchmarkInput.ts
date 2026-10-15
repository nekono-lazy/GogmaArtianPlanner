import type { MasterDataRoot } from '../../domain/master/masterTypes'
import { prepareExportRootForImport, type ExportRoot } from '../../domain/models/exportModel'
import type { PlannerInput } from '../../domain/planner'
import { createBuildListCalculationContext } from '../../services/buildList/createBuildListCalculationContext'
import { validateExportRootForFullReplacement } from '../../services/dataTransfer/importExportValidation'
import { createPlannerInput, type PlannerInputRepositories } from '../../services/planner/createPlannerInput'
import type { BloInputPreparation, BloInputRefusalCode } from './buildListOptimizationBenchmarkProtocol'

/**
 * Issue #260 PR-5A: the measured input of a Browser run, built with the Production meaning (benchmark only).
 *
 * The Production Application reads its input from the persisted state in one read-only transaction
 * (`createBuildListOptimizationStartReader()`): the running Plan, the current Draft and the ordinary `createPlannerInput()` value with
 * `conflictResolutions = []`, failing closed when no RngState is stored. A measurement has an Export instead of a database, so this
 * module turns the Export into the state the Application would read - through the Import authorities themselves
 * (`prepareExportRootForImport()` for the schema migration, `validateExportRootForFullReplacement()` for the full-replacement
 * validation) - and then calls the very `createPlannerInput()` the Application calls, over repositories that read the validated root
 * instead of Dexie, with `createBuildListCalculationContext()`. Nothing is written: no database is opened and the root is never
 * stored. Nothing is repaired either: an Export the Import would refuse, one without an RngState and one holding a running Plan are
 * refused here exactly where the Production path would stop, and no Entry selection, Counter or RNG value is changed.
 *
 * The Research Export reader (`globalResearchInputFromExport()`) is not used: it builds its input by hand with a Research option value.
 */

export type BloPreparedInput =
  | { status: 'ready'; plannerInput: PlannerInput; preparation: BloInputPreparation }
  | { status: 'refused'; preparation: BloInputPreparation; issues: string[] }

/** The repositories `createPlannerInput()` reads, over a validated Export root (read-only; a missing RngState fails closed). */
export function exportRootPlannerInputRepositories(root: ExportRoot): PlannerInputRepositories {
  return {
    ensureInitialRngState: async () => {
      if (root.rngState === null) throw new Error('The Export holds no RngState, so no Build List optimization input can be read.')
      return structuredClone(root.rngState)
    },
    getAllNormalArtianCounters: async () => structuredClone(root.normalArtianCounters),
    getAllOwnedWeapons: async () => structuredClone(root.ownedWeapons),
    getAllTargetWeapons: async () => structuredClone(root.targetWeapons),
    getAllBuildListEntries: async () => structuredClone(root.buildListEntries),
  }
}

/**
 * Prepares the PlannerInput of one run from the Export text. `now` is a monotonic millisecond clock (the preparation time is recorded
 * apart from every calculation interval).
 */
export async function prepareBloBenchmarkInput(text: string, master: MasterDataRoot, now: () => number): Promise<BloPreparedInput> {
  const started = now()
  const refused = (code: BloInputRefusalCode, issues: string[]): BloPreparedInput => ({
    status: 'refused',
    issues,
    preparation: { status: 'refused', refusal: { code, issueCount: issues.length }, preparationMs: now() - started, calculationContext: null, counts: null, draftPresent: null },
  })
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return refused('invalid_json', [error instanceof Error ? error.message : String(error)])
  }
  const prepared = prepareExportRootForImport(parsed)
  if (!prepared.ok) return refused('export_unsupported', prepared.issues.map(issue => `${issue.path}: ${issue.message}`))
  const validation = validateExportRootForFullReplacement(prepared.root, master)
  if (!validation.isValid) return refused('export_invalid', validation.issues.map(issue => `${issue.path}: ${issue.message}`))
  const root = prepared.root
  // The Application's order: a running Plan refuses before any input is read, then the RngState must exist.
  if (root.productionPlans.some(plan => plan.status === 'active' || plan.status === 'stale')) return refused('running_plan_exists', ['An active or stale Plan exists.'])
  if (root.rngState === null) return refused('rng_state_missing', ['The Export holds no RngState.'])
  const calculationContext = createBuildListCalculationContext(master)
  const plannerInput = await createPlannerInput(master, calculationContext, exportRootPlannerInputRepositories(root))
  return {
    status: 'ready',
    plannerInput: { ...plannerInput, conflictResolutions: [] },
    preparation: {
      status: 'ready',
      refusal: null,
      preparationMs: now() - started,
      calculationContext: { ...calculationContext },
      counts: {
        targetWeapons: plannerInput.targetWeapons.length, buildListEntries: plannerInput.buildListEntries.length,
        ownedWeapons: plannerInput.ownedWeapons.length, normalCounters: plannerInput.normalCounters.length,
      },
      draftPresent: root.productionPlans.some(plan => plan.status === 'draft'),
    },
  }
}
