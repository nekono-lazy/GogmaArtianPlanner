/**
 * Issue #154 Phase 2-B: transient Research only. Never import from Production.
 *
 * Post-hoc, read-only summaries of a finished Planner result: the physical operations of the final
 * ProductionPlan (the authority of the physical operation count) and the Route of every Target in the
 * final Planner input (Route operations, which are NOT physical operations: several Routes can share a
 * Counter position or be silently fast-forwarded). Nothing here feeds a Search or a Planner run.
 */
import type { BuildListEntry, ProductionPlan, RouteOperation } from '../domain/models/publicTypes'
import { summarizePlanPhysicalOperations as summarizePlanPhysical, type PlanPhysicalSummary as Phase2BPlanPhysical } from '../domain/planner/buildListOptimization'
import { createPlannerRouteUnitPlans } from '../domain/planner/plannerRouteProgress'
import type { PlannerInput } from '../domain/planner/plannerTypes'
import type { RngEngine } from '../domain/rng/rngEngine'
import type { GlobalResearchReport } from './plannerGlobalOptimizationResearch'

/*
 * The physical summary of a finished Plan is the Production Domain's (`summarizePlanPhysicalOperations()`, the Build List global
 * optimization's Stage D' identity, Issue #260 PR-3); this module keeps the Research names.
 */
export {
  physicalStreamKeyOfNormal as streamKeyOfNormal,
  PLAN_PHYSICAL_OPERATION_TYPES as PHYSICAL_OPERATION_TYPES,
  summarizePlanPhysicalOperations as summarizePlanPhysical,
  type PlanPhysicalOperationType as PhysicalOperationType,
  type PlanPhysicalStreamKey as Phase2BStreamKey,
  type PlanPhysicalStreamRange as Phase2BStreamRange,
  type PlanPhysicalSummary as Phase2BPlanPhysical,
} from '../domain/planner/buildListOptimization'

export interface Phase2BStreamUse {
  readonly first: number
  readonly last: number
  /** Route operation units on this stream (a `create_normal_artian(count = N)` is N units). */
  readonly operations: number
  /** Positions of the units the Planner can never fast-forward (`canSkipWhenCounterPassed === false`). */
  readonly required: readonly number[]
  /** Whether the unit positions are consecutive (no held position crossed inside this Route). */
  readonly contiguous: boolean
}

export interface Phase2BRouteSummary {
  readonly targetWeaponId: string
  readonly weaponTypeId: string
  readonly elementId: string
  readonly buildListEntryId: string
  /**
   * Which Research step supplied the final Entry. `pending_original_kept`: a pending Target whose Search found no
   * Candidate keeps its original Entry in the final input (Phase 2-C1 records it; a completed Phase 2-B run has none).
   */
  readonly entryOrigin: 'retained_original' | 'generated_base_search' | 'generated_extent_fallback' | 'pending_original_kept'
  readonly routeKind: string
  readonly sourceKind: 'owned' | 'new_normal'
  readonly sourceOwnedWeaponId: string | null
  /** The Normal forged as the production target of a new-Normal Route (its Counter position), else null. */
  readonly normalPosition: number | null
  readonly normalCounterId: string | null
  readonly conversionPosition: number | null
  readonly estimatedOperationCount: number
  readonly estimatedAdvances: { readonly normal: number | null; readonly gogma: number; readonly skill: number }
  readonly routeOperationCount: number
  readonly operationTypes: Readonly<Record<string, number>>
  readonly normal: Phase2BStreamUse | null
  readonly gogma: Phase2BStreamUse | null
  readonly skill: Phase2BStreamUse | null
}

function streamUse(units: readonly { counterBefore: number | null; canSkipWhenCounterPassed: boolean }[]): Phase2BStreamUse | null {
  const positions = units.map(unit => unit.counterBefore).filter((value): value is number => value !== null)
  if (positions.length === 0) return null
  const contiguous = positions.every((value, index) => index === 0 || value === positions[index - 1] + 1)
  return { first: positions[0], last: positions.at(-1)!, operations: positions.length, contiguous,
    required: units.filter(unit => !unit.canSkipWhenCounterPassed && unit.counterBefore !== null).map(unit => unit.counterBefore!) }
}

function unitCount(operation: RouteOperation): number { return operation.type === 'create_normal_artian' ? operation.count : 1 }

/** The Route of every Target in the final Planner input, with Planner route units from the Production authority. */
export function summarizeFinalRoutes(finalInput: PlannerInput, report: GlobalResearchReport, engine: RngEngine): Phase2BRouteSummary[] {
  const retained = new Set(report.retainedOriginalEntryIds)
  const base = new Set(report.searches.map(search => search.generatedEntryId).filter((id): id is string => id !== null))
  const fallback = new Set(report.searches.map(search => search.fallback?.generatedEntryId).filter((id): id is string => typeof id === 'string'))
  const keptPending = new Set(report.searches.filter(search => (search.fallback?.generatedEntryId ?? search.generatedEntryId) === null).map(search => search.originalEntryId))
  const targets = new Map(finalInput.targetWeapons.map(target => [target.id, target]))
  return [...finalInput.buildListEntries].sort((a, b) => a.targetWeaponId < b.targetWeaponId ? -1 : a.targetWeaponId > b.targetWeaponId ? 1 : 0).map((entry: BuildListEntry) => {
    const target = targets.get(entry.targetWeaponId)
    if (!target) throw new Error(`Entry ${entry.id} has no Target in the final input.`)
    const route = entry.candidateSnapshot.route
    const units = createPlannerRouteUnitPlans([entry], engine).unitPlans.get(entry.id)
    if (!units) throw new Error(`No Planner route units for ${entry.id}.`)
    const create = route.operations.find(op => op.type === 'create_normal_artian')
    const convert = route.operations.find(op => op.type === 'convert_normal_to_gogma')
    const operationTypes: Record<string, number> = {}
    for (const op of route.operations) operationTypes[op.type] = (operationTypes[op.type] ?? 0) + unitCount(op)
    const normalUnits = units.filter(unit => unit.counterStream === 'normal')
    const candidate = entry.candidateSnapshot
    return {
      targetWeaponId: entry.targetWeaponId, weaponTypeId: target.weaponTypeId, elementId: target.elementId, buildListEntryId: entry.id,
      entryOrigin: retained.has(entry.id) ? 'retained_original' : fallback.has(entry.id) ? 'generated_extent_fallback' : base.has(entry.id) ? 'generated_base_search'
        : keptPending.has(entry.id) ? 'pending_original_kept' : (() => { throw new Error(`Final Entry ${entry.id} is neither retained, generated nor a kept pending original.`) })(),
      routeKind: route.kind, sourceKind: create ? 'new_normal' : 'owned', sourceOwnedWeaponId: route.sourceOwnedWeaponId,
      normalPosition: create && create.normalCounterAfter !== null ? create.normalCounterAfter - 1 : null,
      normalCounterId: normalUnits[0]?.counterId ?? null,
      conversionPosition: convert ? convert.skillCounterBefore : null,
      estimatedOperationCount: candidate.estimatedOperationCount,
      estimatedAdvances: { normal: candidate.estimatedNormalAdvance, gogma: candidate.estimatedGogmaAdvance, skill: candidate.estimatedSkillAdvance },
      routeOperationCount: route.operations.reduce((sum, op) => sum + unitCount(op), 0), operationTypes,
      normal: streamUse(normalUnits), gogma: streamUse(units.filter(unit => unit.counterStream === 'gogma')), skill: streamUse(units.filter(unit => unit.counterStream === 'skill')),
    }
  })
}

/** The final Planner input of a Research run: every original Entry replaced by its generated Entry, as the Research built it. */
export function researchFinalInput(original: PlannerInput, report: GlobalResearchReport, generatedEntries: readonly BuildListEntry[]): PlannerInput {
  const generated = new Map<string, BuildListEntry>(generatedEntries.map(entry => [entry.id, entry]))
  const replacement = new Map<string, BuildListEntry>()
  for (const search of report.searches) {
    const id = search.fallback?.generatedEntryId ?? search.generatedEntryId
    if (id) {
      const entry = generated.get(id)
      if (!entry) throw new Error(`Generated Entry ${id} is missing.`)
      replacement.set(search.originalEntryId, entry)
    }
  }
  return { ...original, buildListEntries: original.buildListEntries.map(entry => replacement.get(entry.id) ?? entry) }
}

export interface Phase2BAutonomousPlanEvidence {
  readonly origin: { readonly skill: number; readonly gogma: number; readonly normal: Readonly<Record<string, { readonly counterId: string; readonly counter: number }>> }
  readonly physical: Phase2BPlanPhysical
  readonly routes: readonly Phase2BRouteSummary[]
  readonly routeOperationSum: number
  readonly selectedBuildListEntryIds: readonly string[]
  /** The Research discovery order (one Candidate Search per pending Target, after the retained prefix). */
  readonly discoveryOrder: readonly { readonly targetWeaponId: string; readonly status: string; readonly targetOutcome: string | null; readonly generatedEntryId: string | null }[]
}

export function phase2bAutonomousPlanEvidence(original: PlannerInput, report: GlobalResearchReport, generatedEntries: readonly BuildListEntry[],
  plan: ProductionPlan, engine: RngEngine): Phase2BAutonomousPlanEvidence {
  const finalInput = researchFinalInput(original, report, generatedEntries)
  const routes = summarizeFinalRoutes(finalInput, report, engine)
  return {
    origin: { skill: original.rngState.skillCounter.value!, gogma: original.rngState.gogmaCounter.value!,
      normal: Object.fromEntries(original.normalCounters.filter(c => c.counter !== null).map(c => [c.weaponTypeId, { counterId: c.id, counter: c.counter! }])) },
    physical: summarizePlanPhysical(plan, finalInput), routes, routeOperationSum: routes.reduce((sum, route) => sum + route.routeOperationCount, 0),
    selectedBuildListEntryIds: [...plan.selectedBuildListEntryIds],
    discoveryOrder: report.searches.map(search => ({ targetWeaponId: search.targetId, status: search.status, targetOutcome: search.targetOutcome ?? null,
      generatedEntryId: search.fallback?.generatedEntryId ?? search.generatedEntryId })),
  }
}
