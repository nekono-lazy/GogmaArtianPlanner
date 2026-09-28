/**
 * Issue #154 Phase 2-B: transient Research only. Never import from Production.
 *
 * Post-hoc reconciliation of a FINISHED autonomous Plan against the Phase 2-A.5 proven-minimum evidence.
 * Both sides arrive as evidence data passed in by the caller (explicit files); this module imports neither
 * the oracle manifest nor the oracle verifier, and nothing here feeds a Search, a Planner or a Route choice.
 *
 * Authority of the physical difference: the Plans' physical operations and Counter advances. Route
 * operation counts are reported beside them and are never summed into the physical difference (Routes
 * share Counter positions and are silently fast-forwarded).
 */
import { PHYSICAL_OPERATION_TYPES, type Phase2BAutonomousPlanEvidence, type Phase2BRouteSummary, type Phase2BStreamUse } from './plannerGlobalPhase2BPlan'

/** The subset of the Phase 2-A.5 result JSON this analysis reads (validated by `parseOptimumEvidence()`). */
export interface Phase2BOptimumRoute {
  readonly targetWeaponId: string
  readonly weaponTypeId: string
  readonly elementId: string
  readonly sourceKind: 'owned' | 'new_normal'
  readonly sourceOwnedWeaponId: string | null
  readonly normalPosition: number | null
  readonly conversionPosition: number | null
  readonly normal: { readonly first: number; readonly last: number; readonly operations: number } | null
  readonly gogma: { readonly first: number; readonly last: number; readonly operations: number; readonly required: readonly number[] } | null
  readonly skill: { readonly first: number; readonly last: number; readonly operations: number; readonly required: readonly number[] } | null
  readonly routeOperationCount: number
  readonly materialization: { readonly method: string; readonly routeKind: string | null; readonly estimated: { readonly operations: number } | null }
}
export interface Phase2BOptimumEvidence {
  readonly verdict: string
  readonly physicalOperations: number
  readonly routeOperationSum: number
  readonly stepOperationCounts: Readonly<Record<string, number>>
  readonly skill: { readonly start: number; readonly end: number }
  readonly gogma: { readonly start: number; readonly end: number }
  /** By weapon type: Planner-start origin and end of every Normal Counter (end = origin when unused). */
  readonly normal: Readonly<Record<string, { readonly start: number; readonly end: number }>>
  readonly routes: readonly Phase2BOptimumRoute[]
  readonly exportSha256: string
  /**
   * Per Target, from the Phase 2-A.5 lower-bound audit: the smallest Counter thresholds at which the Target has ANY
   * valid option from the Planner-start origin (each alone; not a joint assignment).
   */
  readonly targetMinimums: Readonly<Record<string, { readonly minSkillThreshold: number | null; readonly minGogmaThreshold: number | null;
    readonly minNormalThreshold: number | null; readonly firstIdealSkillPosition: number | null }>>
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
function need<T>(value: T | undefined | null, message: string): T { if (value === undefined || value === null) throw new Error(`Optimum evidence: ${message}`); return value }

/** Reads the committed Phase 2-A.5 result JSON (unknown) into the fields this analysis uses. Fails closed. */
export function parseOptimumEvidence(json: unknown): Phase2BOptimumEvidence {
  if (!isRecord(json) || !isRecord(json.summary) || !isRecord(json.environment) || !Array.isArray(json.routes) || !isRecord(json.lowerBound)) throw new Error('Optimum evidence: unexpected shape.')
  interface Range { start: number; end: number }
  const summary = json.summary as { physicalOperations?: number; routeOperationSum?: number; stageC?: { stepOperationCounts?: Record<string, number> }
    skill: Range; gogma: Range; normal: Record<string, Range> }
  const lowerBound = json.lowerBound as { origins?: { normal: Record<string, number> }; targets?: { targetWeaponId: string; minSkillThreshold: number | null;
    minGogmaThreshold: number | null; minNormalThreshold: number | null; firstIdealSkillPosition: number | null }[] }
  const origins = need(lowerBound.origins, 'lowerBound.origins')
  const normal: Record<string, Range> = {}
  for (const [weaponTypeId, start] of Object.entries(origins.normal)) normal[weaponTypeId] = { start, end: start }
  for (const [key, range] of Object.entries(summary.normal)) {
    const weaponTypeId = key.split(':')[0]
    if (!normal[weaponTypeId] || normal[weaponTypeId].start !== range.start) throw new Error(`Optimum evidence: Normal origin mismatch for ${key}.`)
    normal[weaponTypeId] = { start: range.start, end: range.end }
  }
  return {
    verdict: String(json.verdict), physicalOperations: need(summary.physicalOperations, 'physicalOperations'), routeOperationSum: need(summary.routeOperationSum, 'routeOperationSum'),
    stepOperationCounts: need(summary.stageC?.stepOperationCounts, 'stageC.stepOperationCounts'),
    skill: { start: summary.skill.start, end: summary.skill.end }, gogma: { start: summary.gogma.start, end: summary.gogma.end }, normal,
    routes: (json.routes as Phase2BOptimumRoute[]).map(route => ({ targetWeaponId: route.targetWeaponId, weaponTypeId: route.weaponTypeId, elementId: route.elementId,
      sourceKind: route.sourceKind, sourceOwnedWeaponId: route.sourceOwnedWeaponId, normalPosition: route.normalPosition, conversionPosition: route.conversionPosition,
      normal: route.normal, gogma: route.gogma, skill: route.skill, routeOperationCount: route.routeOperationCount,
      materialization: { method: route.materialization.method, routeKind: route.materialization.routeKind, estimated: route.materialization.estimated } })),
    exportSha256: String(json.environment.exportSha256),
    targetMinimums: Object.fromEntries(need(lowerBound.targets, 'lowerBound.targets').map(target => [target.targetWeaponId, {
      minSkillThreshold: target.minSkillThreshold, minGogmaThreshold: target.minGogmaThreshold, minNormalThreshold: target.minNormalThreshold,
      firstIdealSkillPosition: target.firstIdealSkillPosition }])),
  }
}

export interface Phase2BStreamComparison {
  readonly stream: string
  readonly weaponTypeId: string | null
  readonly start: number
  readonly autonomousEnd: number
  readonly optimumEnd: number
  readonly autonomousAdvance: number
  readonly optimumAdvance: number
  /** autonomousAdvance - optimumAdvance (= autonomousEnd - optimumEnd: both start at the same origin). */
  readonly delta: number
}

export interface Phase2BExcessAttribution {
  readonly stream: string
  /** Positions [optimumEnd, autonomousEnd): exactly `delta` physical operations when delta > 0. */
  readonly region: { readonly from: number; readonly toExclusive: number }
  /** Who physically executed the positions of the region (the Step's primary Target), and with what operation. */
  readonly executorByTarget: Readonly<Record<string, number>>
  readonly executorByOperation: Readonly<Record<string, number>>
  /** Targets whose autonomous Route has a required (never fast-forwarded) unit inside the region, farthest first. */
  readonly forcingTargets: readonly { readonly targetWeaponId: string; readonly lastRequired: number; readonly requiredInRegion: number }[]
  /**
   * Static counterfactual on the Route set (NOT a Planner run): replace the forcing Targets' Routes by their
   * optimum Routes one at a time, farthest first; `endAfter` = max Route last position + 1 over the resulting
   * set. It shows how concentrated the excess is; coverage / scheduling feasibility is not verified.
   */
  readonly peel: readonly { readonly targetWeaponId: string; readonly endAfter: number; readonly remainingExcess: number; readonly optimumSourceTakenByAutonomousRouteOf: string | null }[]
}

export type Phase2BSourceRelation = 'same_owned_weapon' | 'different_owned_weapon' | 'owned_to_new_normal' | 'new_normal_to_owned' |
  'new_normal_same_position' | 'new_normal_different_position'

export interface Phase2BTargetComparison {
  readonly targetWeaponId: string
  readonly weaponTypeId: string
  readonly elementId: string
  readonly autonomous: {
    readonly entryOrigin: Phase2BRouteSummary['entryOrigin']
    readonly routeKind: string
    readonly sourceKind: 'owned' | 'new_normal'
    readonly sourceOwnedWeaponId: string | null
    readonly normalPosition: number | null
    readonly conversionPosition: number | null
    readonly estimatedOperationCount: number
    readonly routeOperationCount: number
    readonly advances: { readonly normal: number | null; readonly gogma: number; readonly skill: number }
    readonly normal: Phase2BStreamUse | null
    readonly gogma: Phase2BStreamUse | null
    readonly skill: Phase2BStreamUse | null
    /** Physical Plan steps whose primary Target is this one. */
    readonly physicalPrimarySteps: number
  }
  readonly optimum: {
    readonly materialization: string
    readonly routeKind: string | null
    readonly sourceKind: 'owned' | 'new_normal'
    readonly sourceOwnedWeaponId: string | null
    readonly normalPosition: number | null
    readonly conversionPosition: number | null
    readonly routeOperationCount: number
    readonly normal: Phase2BOptimumRoute['normal']
    readonly gogma: Phase2BOptimumRoute['gogma']
    readonly skill: Phase2BOptimumRoute['skill']
    /** A Gogma / Skill Route whose unit positions are not consecutive (it holds the weapon across other Targets' positions). */
    readonly crossesHeldPositions: boolean
  }
  readonly sourceRelation: Phase2BSourceRelation
  readonly routeKindChanged: boolean
  /** Route operations (not physical operations): autonomous - optimum. Never summed into the physical difference. */
  readonly routeOperationDelta: number
  /** The optimum Route is longer than the autonomous one for this Target alone (a locally longer, globally better Route). */
  readonly optimumRouteLocallyLonger: boolean
  /** Streams whose optimum end this Target's autonomous Route passes with a required unit. */
  readonly extendsBeyondOptimumEnd: readonly string[]
  /** Position in the Research discovery order (null for a retained original Entry). */
  readonly discoveryIndex: number | null
  /** The Phase 2-A.5 per-Target single-option minimums (thresholds = one past the last position), when recorded. */
  readonly singleTargetMinimum: Phase2BOptimumEvidence['targetMinimums'][string] | null
}

/** One generated Route against the stream frontier its discovery Search started from (Research sequential projection). */
export interface Phase2BStackingRow {
  readonly discoveryIndex: number
  readonly targetWeaponId: string
  readonly stream: 'gogma' | 'skill'
  /** One past the farthest unit of every Route before it (retained prefix + earlier generated Routes); the origin when none. */
  readonly frontierBefore: number
  readonly first: number
  readonly last: number
  readonly operations: number
  /** first >= frontierBefore: the Route lies entirely after every earlier Route on this stream. */
  readonly startsAtOrAfterFrontier: boolean
}

export interface Phase2BGapAnalysis {
  readonly totals: { readonly autonomous: number; readonly optimum: number; readonly delta: number; readonly historicalValidatedOracle: number;
    readonly historicalMinusOptimum: number; readonly autonomousMinusHistorical: number }
  readonly operationTypes: readonly { readonly operationType: string; readonly autonomous: number; readonly optimum: number; readonly delta: number }[]
  readonly operationTypeDeltaSum: number
  readonly nonPhysicalSteps: { readonly autonomous: Readonly<Record<string, number>>; readonly optimum: number }
  readonly streams: readonly Phase2BStreamComparison[]
  readonly streamDeltaSum: number
  readonly streamSummary: { readonly skill: number; readonly gogma: number; readonly normal: number; readonly normalByWeaponType: Readonly<Record<string, { readonly autonomous: number; readonly optimum: number; readonly delta: number }>> }
  /** Every stream end equals (max Route last position + 1) of its own Route set: the static model the peel uses. */
  readonly staticEndModel: { readonly autonomousHolds: boolean; readonly optimumHolds: boolean; readonly mismatches: readonly string[] }
  readonly routeVersusPhysical: {
    readonly autonomous: { readonly routeOperationSum: number; readonly physicalOperations: number; readonly sharedOrFastForwarded: number }
    readonly optimum: { readonly routeOperationSum: number; readonly physicalOperations: number; readonly sharedOrFastForwarded: number }
  }
  readonly excess: readonly Phase2BExcessAttribution[]
  /** Physical operations of the autonomous Plan by which Research step supplied the executing Step's Entry. */
  readonly physicalByEntryOrigin: { readonly all: Readonly<Record<string, number>>; readonly byStream: Readonly<Record<string, Readonly<Record<string, number>>>> }
  readonly stacking: { readonly rows: readonly Phase2BStackingRow[]; readonly startsAtOrAfterFrontier: number; readonly total: number }
  readonly targets: readonly Phase2BTargetComparison[]
  readonly categories: Readonly<Record<string, { readonly targets: number; readonly targetWeaponIds: readonly string[] }>>
}

const PHYSICAL = PHYSICAL_OPERATION_TYPES as readonly string[]

function optimumStreamUse(route: Phase2BOptimumRoute, stream: 'normal' | 'gogma' | 'skill'): { last: number } | null {
  const use = route[stream]
  return use && use.operations > 0 ? { last: use.last } : null
}

function crossesHeld(route: Phase2BOptimumRoute): boolean {
  const spread = (use: { first: number; last: number; operations: number } | null) => use !== null && use.last - use.first + 1 > use.operations
  return spread(route.gogma) || spread(route.skill)
}

function sourceRelation(auto: Phase2BRouteSummary, optimum: Phase2BOptimumRoute): Phase2BSourceRelation {
  if (auto.sourceKind === 'owned' && optimum.sourceKind === 'owned') return auto.sourceOwnedWeaponId === optimum.sourceOwnedWeaponId ? 'same_owned_weapon' : 'different_owned_weapon'
  if (auto.sourceKind === 'owned') return 'owned_to_new_normal'
  if (optimum.sourceKind === 'owned') return 'new_normal_to_owned'
  return auto.normalPosition === optimum.normalPosition ? 'new_normal_same_position' : 'new_normal_different_position'
}

/** The analysis itself. `historicalValidatedOracle` is an aggregate number only (no Route evidence exists for it). */
export function analyzePhase2BGap(autonomous: Phase2BAutonomousPlanEvidence, optimum: Phase2BOptimumEvidence, historicalValidatedOracle: number): Phase2BGapAnalysis {
  const physical = autonomous.physical
  if (!physical.identityHolds) throw new Error('Autonomous Plan: physical operations differ from the sum of Counter advances.')
  const optimumStepSum = Object.values(optimum.stepOperationCounts).reduce((sum, n) => sum + n, 0)
  if (optimumStepSum !== optimum.physicalOperations) throw new Error('Optimum evidence: Step operation counts differ from the physical operation count.')
  if (Object.keys(optimum.stepOperationCounts).some(type => !PHYSICAL.includes(type))) throw new Error('Optimum evidence: non-physical operation among its physical Steps.')
  const delta = physical.physicalOperations - optimum.physicalOperations

  const operationTypes = PHYSICAL.map(operationType => {
    const a = physical.operationCounts[operationType as keyof typeof physical.operationCounts] ?? 0, o = optimum.stepOperationCounts[operationType] ?? 0
    return { operationType, autonomous: a, optimum: o, delta: a - o }
  })
  const operationTypeDeltaSum = operationTypes.reduce((sum, row) => sum + row.delta, 0)
  if (operationTypeDeltaSum !== delta) throw new Error(`Operation type deltas sum to ${operationTypeDeltaSum}, not ${delta}.`)

  // Streams: Skill, Gogma and every Normal Counter either side advanced, matched by weapon type.
  if (autonomous.origin.skill !== optimum.skill.start || autonomous.origin.gogma !== optimum.gogma.start) throw new Error('Skill / Gogma origins differ between the two Plans.')
  const autoStream = (key: string) => physical.streams[key]
  const streams: Phase2BStreamComparison[] = [
    { stream: 'skill', weaponTypeId: null, start: optimum.skill.start, autonomousEnd: autoStream('skill').end, optimumEnd: optimum.skill.end },
    { stream: 'gogma', weaponTypeId: null, start: optimum.gogma.start, autonomousEnd: autoStream('gogma').end, optimumEnd: optimum.gogma.end },
  ].map(row => ({ ...row, autonomousAdvance: row.autonomousEnd - row.start, optimumAdvance: row.optimumEnd - row.start, delta: row.autonomousEnd - row.optimumEnd }))
  const weaponTypes = new Set<string>([...Object.values(physical.streams).map(s => s.weaponTypeId).filter((id): id is string => id !== null),
    ...Object.entries(optimum.normal).filter(([, range]) => range.end !== range.start).map(([id]) => id)])
  for (const weaponTypeId of [...weaponTypes].sort()) {
    const origin = autonomous.origin.normal[weaponTypeId]
    const opt = optimum.normal[weaponTypeId]
    if (!origin || !opt || origin.counter !== opt.start) throw new Error(`Normal origin of ${weaponTypeId} differs or is missing.`)
    const auto = autoStream(`normal:${origin.counterId}`)
    const autonomousEnd = auto ? auto.end : origin.counter
    streams.push({ stream: `normal:${origin.counterId}`, weaponTypeId, start: origin.counter, autonomousEnd, optimumEnd: opt.end,
      autonomousAdvance: autonomousEnd - origin.counter, optimumAdvance: opt.end - origin.counter, delta: autonomousEnd - opt.end })
  }
  const streamDeltaSum = streams.reduce((sum, row) => sum + row.delta, 0)
  if (streamDeltaSum !== delta) throw new Error(`Stream deltas sum to ${streamDeltaSum}, not ${delta}.`)
  if (streams.reduce((s, r) => s + r.autonomousAdvance, 0) !== physical.physicalOperations || streams.reduce((s, r) => s + r.optimumAdvance, 0) !== optimum.physicalOperations) {
    throw new Error('Stream advances do not add up to the physical operation counts.')
  }
  const normalRows = streams.filter(row => row.weaponTypeId !== null)
  const streamSummary = { skill: streams[0].delta, gogma: streams[1].delta, normal: normalRows.reduce((s, r) => s + r.delta, 0),
    normalByWeaponType: Object.fromEntries(normalRows.map(row => [row.weaponTypeId!, { autonomous: row.autonomousAdvance, optimum: row.optimumAdvance, delta: row.delta }])) }

  // Targets.
  const optimumById = new Map(optimum.routes.map(route => [route.targetWeaponId, route]))
  const autoById = new Map(autonomous.routes.map(route => [route.targetWeaponId, route]))
  if (optimumById.size !== autoById.size || [...autoById.keys()].some(id => !optimumById.has(id))) throw new Error('The two Plans cover different Targets.')
  const streamOfRoute = (stream: string): 'normal' | 'gogma' | 'skill' => stream === 'skill' ? 'skill' : stream === 'gogma' ? 'gogma' : 'normal'
  const autoLast = (route: Phase2BRouteSummary, stream: string, weaponTypeId: string | null) =>
    weaponTypeId !== null && route.weaponTypeId !== weaponTypeId ? null : route[streamOfRoute(stream)]?.last ?? null
  const optLast = (route: Phase2BOptimumRoute, stream: string, weaponTypeId: string | null) =>
    weaponTypeId !== null && route.weaponTypeId !== weaponTypeId ? null : optimumStreamUse(route, streamOfRoute(stream))?.last ?? null

  // The static end model: a stream ends one past the farthest Route unit (a Route's last unit on a stream is required).
  const mismatches: string[] = []
  const staticEnd = (lasts: readonly (number | null)[], start: number) => lasts.reduce<number>((max, last) => last === null ? max : Math.max(max, last + 1), start)
  let autonomousHolds = true, optimumHolds = true
  for (const row of streams) {
    const a = staticEnd(autonomous.routes.map(r => autoLast(r, row.stream, row.weaponTypeId)), row.start)
    const o = staticEnd(optimum.routes.map(r => optLast(r, row.stream, row.weaponTypeId)), row.start)
    if (a !== row.autonomousEnd) { autonomousHolds = false; mismatches.push(`autonomous ${row.stream}: static ${a} vs Plan ${row.autonomousEnd}`) }
    if (o !== row.optimumEnd) { optimumHolds = false; mismatches.push(`optimum ${row.stream}: static ${o} vs evidence ${row.optimumEnd}`) }
  }

  const executedStreams = physical.executed.streams, executedTargets = physical.executed.targets
  const excess: Phase2BExcessAttribution[] = streams.filter(row => row.delta > 0).map(row => {
    const from = row.optimumEnd, to = row.autonomousEnd
    const executorByTarget: Record<string, number> = {}, executorByOperation: Record<string, number> = {}
    for (const [streamIndex, position, typeIndex, targetIndex] of physical.executed.rows) {
      if (executedStreams[streamIndex] !== row.stream || position < from) continue
      const target = executedTargets[targetIndex]
      executorByTarget[target] = (executorByTarget[target] ?? 0) + 1
      executorByOperation[PHYSICAL[typeIndex]] = (executorByOperation[PHYSICAL[typeIndex]] ?? 0) + 1
    }
    const executed = Object.values(executorByTarget).reduce((s, n) => s + n, 0)
    if (executed !== to - from) throw new Error(`Excess region of ${row.stream} holds ${executed} physical operations, not ${to - from}.`)
    const forcingTargets = autonomous.routes.flatMap(route => {
      const use = row.weaponTypeId !== null && route.weaponTypeId !== row.weaponTypeId ? null : route[streamOfRoute(row.stream)]
      const inRegion = use?.required.filter(position => position >= from) ?? []
      return inRegion.length ? [{ targetWeaponId: route.targetWeaponId, lastRequired: Math.max(...inRegion), requiredInRegion: inRegion.length }] : []
    }).sort((a, b) => b.lastRequired - a.lastRequired || (a.targetWeaponId < b.targetWeaponId ? -1 : 1))
    const replaced = new Set<string>()
    const peel = forcingTargets.map(({ targetWeaponId }) => {
      replaced.add(targetWeaponId)
      const lasts = autonomous.routes.map(route => replaced.has(route.targetWeaponId)
        ? optLast(optimumById.get(route.targetWeaponId)!, row.stream, row.weaponTypeId)
        : autoLast(route, row.stream, row.weaponTypeId))
      const endAfter = staticEnd(lasts, row.start)
      const opt = optimumById.get(targetWeaponId)!
      const taker = autonomous.routes.find(route => !replaced.has(route.targetWeaponId) && (opt.sourceKind === 'owned'
        ? route.sourceOwnedWeaponId !== null && route.sourceOwnedWeaponId === opt.sourceOwnedWeaponId
        : route.sourceKind === 'new_normal' && route.weaponTypeId === opt.weaponTypeId && route.normalPosition === opt.normalPosition))
      return { targetWeaponId, endAfter, remainingExcess: Math.max(0, endAfter - from), optimumSourceTakenByAutonomousRouteOf: taker?.targetWeaponId ?? null }
    })
    return { stream: row.stream, region: { from, toExclusive: to }, executorByTarget, executorByOperation, forcingTargets, peel }
  })

  // Physical operations by the Research step that supplied the executing Entry.
  const originOf = new Map(autonomous.routes.map(route => [route.targetWeaponId, route.entryOrigin as string]))
  const allByOrigin: Record<string, number> = {}, byStreamOrigin: Record<string, Record<string, number>> = {}
  for (const [streamIndex, , , targetIndex] of physical.executed.rows) {
    const origin = originOf.get(executedTargets[targetIndex]) ?? 'unknown', stream = executedStreams[streamIndex]
    allByOrigin[origin] = (allByOrigin[origin] ?? 0) + 1
    const perStream = byStreamOrigin[stream] ??= {}
    perStream[origin] = (perStream[origin] ?? 0) + 1
  }
  // Sequential stacking: each generated Route against the frontier of every Route that precedes it in the Research order.
  const discoveryIndexOf = new Map(autonomous.discoveryOrder.map((row, index) => [row.targetWeaponId, index]))
  const stackingRows: Phase2BStackingRow[] = []
  const retainedRoutes = autonomous.routes.filter(route => route.entryOrigin === 'retained_original')
  const generatedInOrder = autonomous.discoveryOrder.map(row => autoById.get(row.targetWeaponId))
    .filter((route): route is Phase2BRouteSummary => route !== undefined && route.entryOrigin !== 'retained_original')
  for (const stream of ['gogma', 'skill'] as const) {
    const start = stream === 'gogma' ? optimum.gogma.start : optimum.skill.start
    let frontier = staticEnd(retainedRoutes.map(route => route[stream]?.last ?? null), start)
    for (const route of generatedInOrder) {
      const use = route[stream]
      if (use) stackingRows.push({ discoveryIndex: discoveryIndexOf.get(route.targetWeaponId)!, targetWeaponId: route.targetWeaponId, stream, frontierBefore: frontier,
        first: use.first, last: use.last, operations: use.operations, startsAtOrAfterFrontier: use.first >= frontier })
      if (use) frontier = Math.max(frontier, use.last + 1)
    }
  }

  const optimumEndOf = new Map(streams.map(row => [row.stream, row]))
  const targets: Phase2BTargetComparison[] = [...autoById.values()].map(auto => {
    const opt = optimumById.get(auto.targetWeaponId)!
    const extendsBeyondOptimumEnd = [...optimumEndOf.values()].filter(row => {
      const use = row.weaponTypeId !== null && auto.weaponTypeId !== row.weaponTypeId ? null : auto[streamOfRoute(row.stream)]
      return (use?.required ?? []).some(position => position >= row.optimumEnd)
    }).map(row => row.stream)
    return {
      targetWeaponId: auto.targetWeaponId, weaponTypeId: auto.weaponTypeId, elementId: auto.elementId,
      autonomous: { entryOrigin: auto.entryOrigin, routeKind: auto.routeKind, sourceKind: auto.sourceKind, sourceOwnedWeaponId: auto.sourceOwnedWeaponId,
        normalPosition: auto.normalPosition, conversionPosition: auto.conversionPosition, estimatedOperationCount: auto.estimatedOperationCount,
        routeOperationCount: auto.routeOperationCount, advances: auto.estimatedAdvances, normal: auto.normal, gogma: auto.gogma, skill: auto.skill,
        physicalPrimarySteps: physical.perTarget[auto.targetWeaponId]?.physical ?? 0 },
      optimum: { materialization: opt.materialization.method, routeKind: opt.materialization.routeKind, sourceKind: opt.sourceKind, sourceOwnedWeaponId: opt.sourceOwnedWeaponId,
        normalPosition: opt.normalPosition, conversionPosition: opt.conversionPosition, routeOperationCount: opt.routeOperationCount,
        normal: opt.normal, gogma: opt.gogma, skill: opt.skill, crossesHeldPositions: crossesHeld(opt) },
      sourceRelation: sourceRelation(auto, opt), routeKindChanged: auto.routeKind !== opt.materialization.routeKind,
      routeOperationDelta: auto.routeOperationCount - opt.routeOperationCount, optimumRouteLocallyLonger: opt.routeOperationCount > auto.routeOperationCount,
      extendsBeyondOptimumEnd,
      discoveryIndex: auto.entryOrigin === 'retained_original' ? null : discoveryIndexOf.get(auto.targetWeaponId) ?? null,
      singleTargetMinimum: optimum.targetMinimums[auto.targetWeaponId] ?? null,
    }
  })

  const categories: Record<string, string[]> = {}
  const add = (name: string, id: string) => { (categories[name] ??= []).push(id) }
  for (const row of targets) {
    add(`source:${row.sourceRelation}`, row.targetWeaponId)
    if (row.routeKindChanged) add('route_kind_changed', row.targetWeaponId)
    if (row.optimum.crossesHeldPositions) add('optimum_crosses_held_positions', row.targetWeaponId)
    if (row.optimum.materialization === 'planner_alternative_search') add('optimum_materialized_by_planner_alternative_search', row.targetWeaponId)
    if (row.optimumRouteLocallyLonger) add('optimum_route_locally_longer', row.targetWeaponId)
    if (row.autonomous.entryOrigin !== 'retained_original') add(`autonomous_entry:${row.autonomous.entryOrigin}`, row.targetWeaponId)
    else add('autonomous_entry:retained_original', row.targetWeaponId)
    for (const stream of row.extendsBeyondOptimumEnd) add(`extends_beyond_optimum_end:${stream}`, row.targetWeaponId)
    if (row.extendsBeyondOptimumEnd.length === 0) add('within_every_optimum_stream_end', row.targetWeaponId)
  }

  return {
    totals: { autonomous: physical.physicalOperations, optimum: optimum.physicalOperations, delta, historicalValidatedOracle,
      historicalMinusOptimum: historicalValidatedOracle - optimum.physicalOperations, autonomousMinusHistorical: physical.physicalOperations - historicalValidatedOracle },
    operationTypes, operationTypeDeltaSum, nonPhysicalSteps: { autonomous: physical.nonPhysicalSteps, optimum: 0 },
    streams, streamDeltaSum, streamSummary,
    staticEndModel: { autonomousHolds, optimumHolds, mismatches },
    routeVersusPhysical: {
      autonomous: { routeOperationSum: autonomous.routeOperationSum, physicalOperations: physical.physicalOperations, sharedOrFastForwarded: autonomous.routeOperationSum - physical.physicalOperations },
      optimum: { routeOperationSum: optimum.routeOperationSum, physicalOperations: optimum.physicalOperations, sharedOrFastForwarded: optimum.routeOperationSum - optimum.physicalOperations },
    },
    excess, physicalByEntryOrigin: { all: allByOrigin, byStream: byStreamOrigin },
    stacking: { rows: stackingRows, startsAtOrAfterFrontier: stackingRows.filter(row => row.startsAtOrAfterFrontier).length, total: stackingRows.length },
    targets,
    categories: Object.fromEntries(Object.entries(categories).sort(([a], [b]) => a < b ? -1 : 1).map(([name, ids]) => [name, { targets: ids.length, targetWeaponIds: ids.sort() }])),
  }
}
