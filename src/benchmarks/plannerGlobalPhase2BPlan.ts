/**
 * Issue #154 Phase 2-B: transient Research only. Never import from Production.
 *
 * Post-hoc, read-only summaries of a finished Planner result: the physical operations of the final
 * ProductionPlan (the authority of the physical operation count) and the Route of every Target in the
 * final Planner input (Route operations, which are NOT physical operations: several Routes can share a
 * Counter position or be silently fast-forwarded). Nothing here feeds a Search or a Planner run.
 */
import type { BuildListEntry, ProductionPlan, RouteOperation } from '../domain/models/publicTypes'
import { createPlannerRouteUnitPlans } from '../domain/planner/plannerRouteProgress'
import type { PlannerInput } from '../domain/planner/plannerTypes'
import type { RngEngine } from '../domain/rng/rngEngine'
import type { GlobalResearchReport } from './plannerGlobalOptimizationResearch'

export const PHYSICAL_OPERATION_TYPES = ['create_normal_artian', 'convert_normal_to_gogma', 'reset_skills', 'reset_bonuses', 'keep_bonuses'] as const
export type PhysicalOperationType = typeof PHYSICAL_OPERATION_TYPES[number]
/** `skill`, `gogma`, or `normal:<NormalArtianCounter id>`. */
export type Phase2BStreamKey = string

export interface Phase2BStreamRange { readonly start: number; readonly end: number; readonly advance: number }

export interface Phase2BPlanPhysical {
  readonly planSteps: number
  /** Steps that advance exactly one Counter by one. */
  readonly physicalOperations: number
  /** Steps that advance no Counter (`confirm_owned_ideal`), by operation type. Not physical operations. */
  readonly nonPhysicalSteps: Readonly<Record<string, number>>
  readonly operationCounts: Readonly<Record<PhysicalOperationType, number>>
  readonly streams: Readonly<Record<Phase2BStreamKey, Phase2BStreamRange & { readonly weaponTypeId: string | null }>>
  readonly streamAdvanceSum: number
  /** physical operations === sum of stream advances (every physical operation advances exactly one Counter by one). */
  readonly identityHolds: boolean
  /** Steps whose primary Target is shared with other progressed Targets. */
  readonly sharedPhysicalSteps: number
  /** Compact executed positions, one per physical step in Plan order: [streamIndex, position, operationTypeIndex, targetIndex]. */
  readonly executed: { readonly streams: readonly Phase2BStreamKey[]; readonly targets: readonly string[]; readonly rows: readonly (readonly [number, number, number, number])[] }
  readonly perTarget: Readonly<Record<string, { readonly physical: number; readonly byType: Readonly<Record<string, number>>; readonly byStream: Readonly<Record<Phase2BStreamKey, number>> }>>
}

const operationTypeIndex = (type: string) => PHYSICAL_OPERATION_TYPES.indexOf(type as PhysicalOperationType)

export function streamKeyOfNormal(counterId: string): Phase2BStreamKey { return `normal:${counterId}` }

/**
 * Reads the physical operations of a Plan. Stream positions are replayed from the Planner-start origin in Plan
 * order and cross-checked against each Step's own debug start Counter when present (fail closed on a mismatch).
 */
export function summarizePlanPhysical(plan: ProductionPlan, input: PlannerInput): Phase2BPlanPhysical {
  const skillOrigin = input.rngState.skillCounter.value, gogmaOrigin = input.rngState.gogmaCounter.value
  if (skillOrigin === null || gogmaOrigin === null) throw new Error('Planner origin lacks a Skill / Gogma Counter.')
  const position = new Map<Phase2BStreamKey, number>([['skill', skillOrigin], ['gogma', gogmaOrigin]])
  const origin = new Map(position)
  const weaponTypeOf = new Map<Phase2BStreamKey, string | null>([['skill', null], ['gogma', null]])
  for (const counter of input.normalCounters) {
    if (counter.counter === null) continue
    position.set(streamKeyOfNormal(counter.id), counter.counter)
    origin.set(streamKeyOfNormal(counter.id), counter.counter)
    weaponTypeOf.set(streamKeyOfNormal(counter.id), counter.weaponTypeId)
  }
  const operationCounts = Object.fromEntries(PHYSICAL_OPERATION_TYPES.map(type => [type, 0])) as Record<PhysicalOperationType, number>
  const nonPhysicalSteps: Record<string, number> = {}
  const streams: Phase2BStreamKey[] = [], targets: string[] = []
  const rows: [number, number, number, number][] = []
  const perTarget: Record<string, { physical: number; byType: Record<string, number>; byStream: Record<string, number> }> = {}
  let sharedPhysicalSteps = 0
  for (const step of plan.steps) {
    const { skillCounterDelta: skill, gogmaCounterDelta: gogma, normalCounterDelta: normal, affectedNormalCounterId } = step.rngAdvance
    const advanced = [skill, gogma, normal ?? 0]
    if (advanced.every(delta => delta === 0)) {
      if (operationTypeIndex(step.operationType) >= 0) throw new Error(`Physical operation ${step.operationType} advanced no Counter.`)
      nonPhysicalSteps[step.operationType] = (nonPhysicalSteps[step.operationType] ?? 0) + 1
      continue
    }
    if (advanced.filter(delta => delta !== 0).length !== 1 || advanced.some(delta => delta !== 0 && delta !== 1)) {
      throw new Error(`Step ${step.id} does not advance exactly one Counter by one.`)
    }
    const typeIndex = operationTypeIndex(step.operationType)
    if (typeIndex < 0) throw new Error(`Unknown physical operation ${step.operationType}.`)
    const stream: Phase2BStreamKey = skill === 1 ? 'skill' : gogma === 1 ? 'gogma' : streamKeyOfNormal(affectedNormalCounterId ?? '')
    const expected = (step.operationType === 'create_normal_artian' && !stream.startsWith('normal:')) ||
      ((step.operationType === 'reset_bonuses' || step.operationType === 'keep_bonuses') && stream !== 'gogma') ||
      ((step.operationType === 'reset_skills' || step.operationType === 'convert_normal_to_gogma') && stream !== 'skill')
    if (expected) throw new Error(`Operation ${step.operationType} advanced ${stream}.`)
    const at = position.get(stream)
    if (at === undefined) throw new Error(`No Planner-start origin for stream ${stream}.`)
    const debugStart = stream === 'skill' ? step.debug?.startSkillCounter : stream === 'gogma' ? step.debug?.startGogmaCounter : step.debug?.startNormalCounter
    if (debugStart !== undefined && debugStart !== null && debugStart !== at) throw new Error(`Step ${step.id} debug start ${debugStart} differs from replayed ${at} (${stream}).`)
    position.set(stream, at + 1)
    operationCounts[step.operationType as PhysicalOperationType] += 1
    const target = step.targetWeaponId ?? '(none)'
    if (!streams.includes(stream)) streams.push(stream)
    if (!targets.includes(target)) targets.push(target)
    rows.push([streams.indexOf(stream), at, typeIndex, targets.indexOf(target)])
    const entry = perTarget[target] ??= { physical: 0, byType: {}, byStream: {} }
    entry.physical += 1
    entry.byType[step.operationType] = (entry.byType[step.operationType] ?? 0) + 1
    entry.byStream[stream] = (entry.byStream[stream] ?? 0) + 1
    if ((step.progressedTargetWeaponIds?.length ?? 0) > 1) sharedPhysicalSteps += 1
  }
  const ranges: Record<Phase2BStreamKey, Phase2BStreamRange & { weaponTypeId: string | null }> = {}
  for (const [key, end] of position) {
    const start = origin.get(key)!
    if (end !== start || key === 'skill' || key === 'gogma') ranges[key] = { start, end, advance: end - start, weaponTypeId: weaponTypeOf.get(key) ?? null }
  }
  const physicalOperations = rows.length
  const streamAdvanceSum = Object.values(ranges).reduce((sum, range) => sum + range.advance, 0)
  return { planSteps: plan.steps.length, physicalOperations, nonPhysicalSteps, operationCounts, streams: ranges, streamAdvanceSum,
    identityHolds: streamAdvanceSum === physicalOperations, sharedPhysicalSteps, executed: { streams, targets, rows }, perTarget }
}

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
