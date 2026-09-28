/**
 * Issue #154 Phase 2-A.5 (Research only): independent verification of an oracle Route set against the
 * current Production semantics. Never import from Production. Stage A replays each Route with the
 * given RNG Engine only; Stage B takes each Route from the Production Search Domain and materializes a
 * BuildListEntry at the Planner-start origin; Stage C runs the Production Planner and Trace Replay.
 * Nothing here chooses a Route: the manifest (`plannerGlobalOracle1657Manifest.ts`) is the input.
 */
import { areRestorationBonusSetsEqual, isTargetWeaponPlanningEligible } from '../domain/models/domainRules'
import { hashStableValue } from '../domain/models/publicTypes'
import type { BuildCandidate, BuildListEntry, GroupSkillId, OwnedWeapon, RestorationBonusScope, RestorationBonusSet, RouteOperation, SeriesSkillId } from '../domain/models/publicTypes'
import { createProductionPlanWithObserver } from '../domain/planner/productionPlanGeneration'
import { createPlannerRouteUnitPlans } from '../domain/planner/plannerRouteProgress'
import { replayPlannerSearchTrace } from '../domain/planner/plannerTraceReplay'
import { validatePlannerInput } from '../domain/planner/plannerValidation'
import { createPlannerStartSearchOrigin } from '../domain/planner/replacement/plannerSearchOrigin'
import { createDeterministicMaterializer } from '../domain/planner/replacement/plannerDeterministicMaterializer'
import type { PlannerDependencies, PlannerInput, PlannerRunResult } from '../domain/planner/plannerTypes'
import type { NormalizedSeed, RngEngine, RngMasterSubset } from '../domain/rng/rngEngine'
import { visitPlannerAlternativeCandidates } from '../domain/search/alternative'
import type { PlannerAlternativeCandidate, PlannerAlternativeReservation, PlannerAlternativeSearchExtent } from '../domain/search/alternative'
import { searchCandidates } from '../domain/search/candidateSearch'
import type { CandidateSearchInput } from '../domain/search/searchTypes'
import { satisfiesIdealTarget } from '../domain/target/targetEvaluator'
import { GLOBAL_RESEARCH_TIME, materializeGlobalResearchCandidate } from './plannerGlobalOptimizationResearch'
import type { OracleOperationSegment, OracleOperationType, OracleRouteSpec } from './plannerGlobalOracle1657Manifest'

export type OracleStream = 'normal' | 'skill' | 'gogma'

export interface OracleOperation {
  type: OracleOperationType
  stream: OracleStream
  /** The Counter position the operation consumes (a forge of a create segment is one operation). */
  position: number
}

const STREAM: Record<OracleOperationType, OracleStream> = {
  create_normal_artian: 'normal', convert_normal_to_gogma: 'skill', reset_skills: 'skill', reset_bonuses: 'gogma', keep_bonuses: 'gogma',
}

/** Physical operations of a Route, one per consumed Counter position, in Route order. */
export function expandOracleOperations(segments: readonly OracleOperationSegment[]): OracleOperation[] {
  return segments.flatMap(segment => {
    if (!Number.isSafeInteger(segment.from) || !Number.isSafeInteger(segment.to) || segment.to < segment.from) {
      throw new RangeError(`Invalid oracle segment ${JSON.stringify(segment)}`)
    }
    return Array.from({ length: segment.to - segment.from + 1 }, (_, i) => ({ type: segment.type, stream: STREAM[segment.type], position: segment.from + i }))
  })
}

/**
 * Required units by the documented skip rule (PLANNER_SPEC 7.0.2 / Issue #129), derived here
 * independently of the Planner so that Stage B can cross-check it against `createPlannerRouteUnitPlans()`:
 * a unit is skippable when the next unit of its own lane rewrites its whole output without reading it
 * (Reset→Reset, Keep→Reset, Keep→Keep, Reset Skills→Reset Skills) or when it is a Counter-advance forge;
 * the last unit of each lane, conversions, production-target forges and a Reset read by a Keep are required.
 */
export function deriveOracleRequiredPositions(operations: readonly OracleOperation[]): { normal: number | null; skill: number[]; gogma: number[] } {
  const normal = operations.filter(op => op.stream === 'normal')
  const bonus = operations.filter(op => op.type === 'reset_bonuses' || op.type === 'keep_bonuses')
  const skill = operations.filter(op => op.stream === 'skill')
  const required = (lane: OracleOperation[]) => lane.filter((op, index) => {
    const next = lane[index + 1]
    if (!next) return true
    if (op.type === 'convert_normal_to_gogma') return true
    if (op.type === 'reset_skills') return next.type !== 'reset_skills'
    if (op.type === 'reset_bonuses') return next.type !== 'reset_bonuses'
    return !(next.type === 'reset_bonuses' || next.type === 'keep_bonuses')
  }).map(op => op.position)
  return { normal: normal.length ? normal[normal.length - 1]!.position : null, skill: required(skill), gogma: required(bonus) }
}

interface ReplayState { bonuses: RestorationBonusSet; scope: RestorationBonusScope; seriesSkillId: SeriesSkillId | null; groupSkillId: GroupSkillId | null }

export interface OracleRngTargetReport {
  targetWeaponId: string
  sourceKind: 'owned' | 'new_normal'
  sourceOwnedWeaponId: string | null
  normalPosition: number | null
  conversionPosition: number | null
  gogma: { first: number | null; last: number | null; operations: number; required: number[] }
  skill: { first: number | null; last: number | null; operations: number; required: number[] }
  normal: { first: number | null; last: number | null; operations: number }
  routeOperationCount: number
  finalBonuses: RestorationBonusSet | null
  finalScope: RestorationBonusScope | null
  finalSeriesSkillId: SeriesSkillId | null
  finalGroupSkillId: GroupSkillId | null
  idealFull: boolean
  idealRequiredOnly: boolean
  errors: string[]
}

export interface OracleStreamUsage { position: number; targetWeaponId: string; type: OracleOperationType; required: boolean }

export interface OracleRngReport {
  targets: OracleRngTargetReport[]
  origin: { skill: number; gogma: number; normal: Record<string, number> }
  streams: {
    skill: { start: number; end: number; advance: number; gaps: number[]; duplicateRequired: number[] }
    gogma: { start: number; end: number; advance: number; gaps: number[]; duplicateRequired: number[] }
    normal: Record<string, { start: number; end: number; advance: number; gaps: number[]; duplicateRequired: number[] }>
  }
  gogmaUsage: OracleStreamUsage[]
  requiredSkillUsage: OracleStreamUsage[]
  requiredNormalUsage: Record<string, OracleStreamUsage[]>
  duplicateOwnedSources: string[]
  duplicateNormalSources: string[]
  physicalOperations: number
  routeOperationSum: number
  errors: string[]
  passed: boolean
}

function applyOperation(state: ReplayState, op: OracleOperation, target: PlannerInput['targetWeapons'][number], seed: NormalizedSeed, engine: RngEngine, master: RngMasterSubset): ReplayState {
  const { weaponTypeId, elementId } = target
  if (op.type === 'convert_normal_to_gogma' || op.type === 'reset_skills') {
    const skills = engine.predictSkills({ baseSeed: seed, skillCounter: op.position, weaponTypeId, elementId, master })
    return { ...state, seriesSkillId: skills.seriesSkillId, groupSkillId: skills.groupSkillId }
  }
  if (op.type === 'reset_bonuses') {
    return { ...state, scope: 'gogma_artian', bonuses: engine.predictGogmaBonus({ baseSeed: seed, gogmaCounter: op.position, weaponTypeId, elementId, operation: { type: 'reset_bonuses' }, master }) }
  }
  if (op.type === 'keep_bonuses') {
    return { ...state, scope: 'gogma_artian', bonuses: engine.predictGogmaBonus({ baseSeed: seed, gogmaCounter: op.position, weaponTypeId, elementId, operation: { type: 'keep_bonuses', currentBonuses: state.bonuses }, master }) }
  }
  return state
}

/** Stage A: Production RNG only. No Search, no Planner. */
export function verifyOracleRng(input: PlannerInput, engine: RngEngine, routes: readonly OracleRouteSpec[]): OracleRngReport {
  const master = input.master as unknown as RngMasterSubset
  const errors: string[] = []
  // The persisted Base Seed is already normalized; the Domain passes it to the Engine as is.
  const seed = input.rngState.baseSeed.value as NormalizedSeed
  const origin = { skill: input.rngState.skillCounter.value!, gogma: input.rngState.gogmaCounter.value!,
    normal: Object.fromEntries(input.normalCounters.map(counter => [counter.id, counter.counter!])) as Record<string, number> }
  const planning = input.targetWeapons.filter(isTargetWeaponPlanningEligible)
  const routeTargets = routes.map(route => route.targetWeaponId)
  if (new Set(routeTargets).size !== routeTargets.length) errors.push('A Target has more than one oracle Route.')
  for (const target of planning) if (!routeTargets.includes(target.id)) errors.push(`Planning Target ${target.id} has no oracle Route.`)
  const reports: OracleRngTargetReport[] = []
  const usage = { skill: [] as OracleStreamUsage[], gogma: [] as OracleStreamUsage[], normal: new Map<string, OracleStreamUsage[]>() }
  for (const route of routes) {
    const routeErrors: string[] = []
    const target = planning.find(value => value.id === route.targetWeaponId)
    const operations = expandOracleOperations(route.operations)
    const derived = deriveOracleRequiredPositions(operations)
    const report: OracleRngTargetReport = {
      targetWeaponId: route.targetWeaponId, sourceKind: route.source.kind,
      sourceOwnedWeaponId: route.source.kind === 'owned' ? route.source.ownedWeaponId : null,
      normalPosition: route.source.kind === 'new_normal' ? route.source.normalPosition : null,
      conversionPosition: operations.find(op => op.type === 'convert_normal_to_gogma')?.position ?? null,
      gogma: streamSummary(operations, 'gogma', derived.gogma), skill: streamSummary(operations, 'skill', derived.skill),
      normal: (({ first, last, operations: count }) => ({ first, last, operations: count }))(streamSummary(operations, 'normal', [])),
      routeOperationCount: operations.length, finalBonuses: null, finalScope: null, finalSeriesSkillId: null, finalGroupSkillId: null,
      idealFull: false, idealRequiredOnly: false, errors: routeErrors,
    }
    reports.push(report)
    if (!target) { routeErrors.push('Target is missing or not planning-eligible.'); continue }
    for (const stream of ['normal', 'skill', 'gogma'] as const) {
      const positions = operations.filter(op => op.stream === stream).map(op => op.position)
      if (positions.some((position, index) => index > 0 && position <= positions[index - 1]!)) routeErrors.push(`${stream} positions are not strictly increasing.`)
    }
    if (JSON.stringify(derived) !== JSON.stringify(route.required)) routeErrors.push(`Required positions ${JSON.stringify(derived)} differ from the manifest ${JSON.stringify(route.required)}.`)
    let initial: ReplayState
    const conversions = operations.filter(op => op.type === 'convert_normal_to_gogma')
    const counterId = `${target.weaponTypeId}:8`
    if (route.source.kind === 'owned') {
      const weapon: OwnedWeapon | undefined = input.ownedWeapons.find(value => value.id === (route.source as { ownedWeaponId: string }).ownedWeaponId)
      if (!weapon) { routeErrors.push('Source OwnedWeapon does not exist.'); continue }
      if (weapon.weaponTypeId !== target.weaponTypeId || weapon.elementId !== target.elementId) routeErrors.push('Source OwnedWeapon is incompatible with the Target.')
      if (weapon.isProtected && operations.length > 0) routeErrors.push('Protected source OwnedWeapon would be changed.')
      if (weapon.kind !== 'gogma') { routeErrors.push('Oracle owned source must be a Gogma (no owned Normal Route in this Export).'); continue }
      if (conversions.length || operations.some(op => op.stream === 'normal')) routeErrors.push('An owned Gogma Route cannot forge or convert.')
      initial = { bonuses: weapon.restorationBonuses, scope: weapon.restorationBonusScope, seriesSkillId: weapon.seriesSkillId, groupSkillId: weapon.groupSkillId }
    } else {
      const counter = input.normalCounters.find(value => value.id === counterId)
      const forges = operations.filter(op => op.stream === 'normal')
      if (!counter?.isConfirmed || counter.counter === null) { routeErrors.push('Normal Counter is not confirmed.'); continue }
      if (forges.length === 0 || forges[forges.length - 1]!.position !== route.source.normalPosition || forges[0]!.position < counter.counter) routeErrors.push('Normal forges do not end at the production target or start before the Counter.')
      if (conversions.length !== 1 || operations.filter(op => op.stream === 'skill')[0]?.type !== 'convert_normal_to_gogma') routeErrors.push('A new Normal Route needs exactly one conversion as its first Skill operation.')
      initial = { bonuses: engine.predictNormalArtian({ baseSeed: seed, weaponTypeId: target.weaponTypeId, elementId: target.elementId, rarity: 8, normalCounter: route.source.normalPosition, master }),
        scope: 'normal_artian', seriesSkillId: null, groupSkillId: null }
      for (const forge of forges) {
        const list = usage.normal.get(counterId) ?? []
        list.push({ position: forge.position, targetWeaponId: route.targetWeaponId, type: forge.type, required: forge.position === derived.normal })
        usage.normal.set(counterId, list)
      }
    }
    for (const op of operations) {
      if (op.stream === 'normal') continue
      usage[op.stream].push({ position: op.position, targetWeaponId: route.targetWeaponId, type: op.type, required: (op.stream === 'gogma' ? derived.gogma : derived.skill).includes(op.position) })
    }
    const lanesInOrder = [...operations.filter(op => op.stream === 'skill'), ...operations.filter(op => op.stream === 'gogma')]
    try {
      const full = lanesInOrder.reduce((state, op) => applyOperation(state, op, target, seed, engine, master), initial)
      const requiredOnly = lanesInOrder.filter(op => (op.stream === 'gogma' ? derived.gogma : derived.skill).includes(op.position))
        .reduce((state, op) => applyOperation(state, op, target, seed, engine, master), initial)
      report.finalBonuses = full.bonuses; report.finalScope = full.scope
      report.finalSeriesSkillId = full.seriesSkillId; report.finalGroupSkillId = full.groupSkillId
      report.idealFull = satisfiesIdealTarget(target, full.bonuses, full.scope, full.seriesSkillId, full.groupSkillId, input.master)
      report.idealRequiredOnly = satisfiesIdealTarget(target, requiredOnly.bonuses, requiredOnly.scope, requiredOnly.seriesSkillId, requiredOnly.groupSkillId, input.master)
      if (!report.idealFull) routeErrors.push('Full Route replay is not Ideal.')
      if (!report.idealRequiredOnly) routeErrors.push('Required-only replay is not Ideal.')
      if (!areRestorationBonusSetsEqual(full.bonuses, requiredOnly.bonuses) || full.scope !== requiredOnly.scope
        || full.seriesSkillId !== requiredOnly.seriesSkillId || full.groupSkillId !== requiredOnly.groupSkillId) routeErrors.push('Skipping skippable units changes the final weapon.')
    } catch (caught) {
      routeErrors.push(`Prediction failed: ${caught instanceof Error ? caught.message : String(caught)}`)
    }
  }
  const owned = routes.flatMap(route => route.source.kind === 'owned' ? [route.source.ownedWeaponId] : [])
  const normalSources = routes.flatMap(route => route.source.kind === 'new_normal'
    ? [`${planning.find(t => t.id === route.targetWeaponId)?.weaponTypeId ?? '?'}:${route.source.normalPosition}`] : [])
  const duplicates = (values: string[]) => [...new Set(values.filter((value, index) => values.indexOf(value) !== index))].sort()
  const streamCheck = (list: OracleStreamUsage[], start: number) => {
    const positions = new Set(list.map(item => item.position))
    const end = list.length ? Math.max(...list.map(item => item.position)) + 1 : start
    const gaps: number[] = []
    for (let position = start; position < end; position++) if (!positions.has(position)) gaps.push(position)
    const required = list.filter(item => item.required).map(item => String(item.position))
    return { start, end, advance: end - start, gaps, duplicateRequired: duplicates(required).map(Number), below: list.filter(item => item.position < start).length }
  }
  const skill = streamCheck(usage.skill, origin.skill), gogma = streamCheck(usage.gogma, origin.gogma)
  const normal = Object.fromEntries([...usage.normal].sort(([a], [b]) => a.localeCompare(b)).map(([id, list]) => [id, streamCheck(list, origin.normal[id]!)]))
  for (const [name, check] of [['skill', skill], ['gogma', gogma], ...Object.entries(normal)] as const) {
    if (check.gaps.length) errors.push(`${name} stream has uncovered positions: ${check.gaps.slice(0, 10).join(', ')}`)
    if (check.duplicateRequired.length) errors.push(`${name} stream has a position required by two Routes: ${check.duplicateRequired.join(', ')}`)
    if (check.below) errors.push(`${name} stream uses a position before the origin.`)
  }
  const duplicateOwnedSources = duplicates(owned), duplicateNormalSources = duplicates(normalSources)
  if (duplicateOwnedSources.length) errors.push(`OwnedWeapon used by two Routes: ${duplicateOwnedSources.join(', ')}`)
  if (duplicateNormalSources.length) errors.push(`Normal production target used by two Routes: ${duplicateNormalSources.join(', ')}`)
  const strip = ({ below, ...rest }: ReturnType<typeof streamCheck>) => { void below; return rest }
  const physicalOperations = skill.advance + gogma.advance + Object.values(normal).reduce((sum, value) => sum + value.advance, 0)
  const passed = errors.length === 0 && reports.every(report => report.errors.length === 0)
  return {
    targets: reports, origin, streams: { skill: strip(skill), gogma: strip(gogma), normal: Object.fromEntries(Object.entries(normal).map(([id, value]) => [id, strip(value)])) },
    gogmaUsage: usage.gogma.sort((a, b) => a.position - b.position || a.targetWeaponId.localeCompare(b.targetWeaponId)),
    requiredSkillUsage: usage.skill.filter(item => item.required).sort((a, b) => a.position - b.position),
    requiredNormalUsage: Object.fromEntries([...usage.normal].sort(([a], [b]) => a.localeCompare(b)).map(([id, list]) => [id, list.filter(item => item.required).sort((a, b) => a.position - b.position)])),
    duplicateOwnedSources, duplicateNormalSources, physicalOperations,
    routeOperationSum: reports.reduce((sum, report) => sum + report.routeOperationCount, 0), errors, passed,
  }
}

function streamSummary(operations: readonly OracleOperation[], stream: OracleStream, required: number[]) {
  const positions = operations.filter(op => op.stream === stream).map(op => op.position)
  return { first: positions.length ? positions[0]! : null, last: positions.length ? positions[positions.length - 1]! : null, operations: positions.length, required }
}

/** A Route's physical operations as absolute positions, from a persisted RouteOperation list. */
export function routeOperationsAsOracle(operations: readonly RouteOperation[]): OracleOperation[] {
  return operations.flatMap((op): OracleOperation[] => {
    switch (op.type) {
      case 'create_normal_artian':
        if (op.normalCounterBefore === null || op.normalCounterAfter === null) throw new Error('Blind creation is not part of the oracle.')
        return Array.from({ length: op.normalCounterAfter - op.normalCounterBefore }, (_, i) => ({ type: op.type, stream: 'normal' as const, position: op.normalCounterBefore! + i }))
      case 'convert_normal_to_gogma':
      case 'reset_skills':
        return [{ type: op.type, stream: 'skill', position: op.skillCounterBefore }]
      case 'reset_bonuses':
      case 'keep_bonuses':
        return [{ type: op.type, stream: 'gogma', position: op.gogmaCounterBefore }]
    }
  })
}

export interface OracleMaterializationTargetReport {
  targetWeaponId: string
  method: OracleRouteSpec['materialization']
  candidateId: string | null
  buildListEntryId: string | null
  routeKind: string | null
  sourceOwnedWeaponId: string | null
  estimated: { operations: number; normal: number | null; gogma: number | null; skill: number | null } | null
  plannerRequired: { normal: number | null; skill: number[]; gogma: number[] } | null
  /** Planner Alternative Search only: Candidates delivered before the oracle Route matched. */
  deliveredCandidates: number | null
  elapsedMs: number
  matches: { operations: boolean; estimated: boolean; finalWeapon: boolean; requiredUnits: boolean; routeKind: boolean; source: boolean }
  error: string | null
}

export interface OracleMaterializationReport {
  targets: OracleMaterializationTargetReport[]
  entries: BuildListEntry[]
  passed: boolean
}

function streamEnd(routes: readonly OracleRouteSpec[], type: (t: OracleOperationType) => boolean, origin: number) {
  const positions = routes.flatMap(route => expandOracleOperations(route.operations).filter(op => type(op.type)).map(op => op.position))
  return positions.length ? Math.max(...positions) + 1 : origin
}
const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i)

/**
 * The Search input that makes the Production Search Domain produce one oracle Route. The oracle is
 * used only to choose the source, the projected Counters and the extents (task rule 10); the Route
 * itself always comes out of the Search.
 */
export function oracleCandidateSearchInput(input: PlannerInput, route: OracleRouteSpec): CandidateSearchInput {
  const target = input.targetWeapons.find(value => value.id === route.targetWeaponId)!
  const operations = expandOracleOperations(route.operations)
  const gogma = operations.filter(op => op.stream === 'gogma'), skill = operations.filter(op => op.stream === 'skill'), normal = operations.filter(op => op.stream === 'normal')
  const rngState = structuredClone(input.rngState)
  const gStart = gogma[0]?.position ?? input.rngState.gogmaCounter.value!, sStart = skill[0]?.position ?? input.rngState.skillCounter.value!
  rngState.gogmaCounter.value = gStart
  rngState.skillCounter.value = sStart
  const normalCounters = structuredClone(input.normalCounters)
  if (normal.length) normalCounters.find(counter => counter.id === `${target.weaponTypeId}:8`)!.counter = normal[0]!.position
  const owned = route.source.kind === 'owned'
  const settings = {
    maxNormalAdvance: owned ? 1 : normal.length,
    maxGogmaAdvance: gogma.length ? gogma[gogma.length - 1]!.position - gStart + 1 : 1,
    maxSkillAdvance: Math.max(1, (skill.length ? skill[skill.length - 1]!.position : sStart) - sStart + (owned ? 1 : 0)),
  }
  return {
    searchRunId: `research.oracle1657.search.${hashStableValue({ target: target.id, gStart, sStart, normal: normal[0]?.position ?? null, settings })}`,
    targetWeaponId: target.id, routeFilter: owned ? 'existing_gogma' : 'normal_artian', rngState, normalCounters,
    ownedWeapons: owned ? input.ownedWeapons.filter(weapon => weapon.id === (route.source as { ownedWeaponId: string }).ownedWeaponId) : [],
    // Only this Target: the others' preferences would name weapons outside the restricted inventory.
    targetWeapons: [{ ...target, preferredOwnedWeaponId: owned ? (route.source as { ownedWeaponId: string }).ownedWeaponId as OwnedWeapon['id'] : null }],
    settings, master: input.master, calculationContext: input.calculationContext,
  }
}

/** The Planner Alternative Search reservation of one Route: every other Route's required unit is blocked. */
export function oraclePlannerAlternativeInput(input: PlannerInput, route: OracleRouteSpec, routes: readonly OracleRouteSpec[]) {
  const target = input.targetWeapons.find(value => value.id === route.targetWeaponId)!
  const operations = expandOracleOperations(route.operations)
  const others = routes.filter(other => other.targetWeaponId !== route.targetWeaponId)
  const skillOrigin = input.rngState.skillCounter.value!, gogmaOrigin = input.rngState.gogmaCounter.value!
  const counter = input.normalCounters.find(value => value.id === `${target.weaponTypeId}:8`)!
  const normalTarget = route.source.kind === 'new_normal' ? route.source.normalPosition : null
  const sameType = (other: OracleRouteSpec) => input.targetWeapons.find(value => value.id === other.targetWeaponId)?.weaponTypeId === target.weaponTypeId
  const normalHeld = range(counter.counter!, (normalTarget ?? counter.counter!) + 1)
  const reservation: PlannerAlternativeReservation = {
    normal: [{ counterId: counter.id, held: normalHeld, blocked: others.filter(sameType).flatMap(other => other.required.normal === null ? [] : [other.required.normal]).filter(p => normalHeld.includes(p)) }],
    gogma: { held: range(gogmaOrigin, streamEnd(routes, t => STREAM[t] === 'gogma', gogmaOrigin)), blocked: others.flatMap(other => other.required.gogma) },
    skill: { held: range(skillOrigin, streamEnd(routes, t => STREAM[t] === 'skill', skillOrigin)), blocked: others.flatMap(other => other.required.skill) },
    exclusiveOwnedWeaponIds: input.ownedWeapons.filter(weapon => route.source.kind !== 'owned' || weapon.id !== route.source.ownedWeaponId).map(weapon => weapon.id),
  }
  const lastGogma = operations.filter(op => op.stream === 'gogma').at(-1)?.position ?? gogmaOrigin
  const lastSkill = operations.filter(op => op.stream === 'skill').at(-1)?.position ?? skillOrigin
  const extent: PlannerAlternativeSearchExtent = {
    maxNormalAdvance: normalTarget === null ? 1 : normalTarget - counter.counter! + 1,
    maxGogmaAdvance: lastGogma - gogmaOrigin + 1,
    maxSkillAdvance: Math.max(1, lastSkill - skillOrigin + (route.source.kind === 'owned' ? 1 : 0)),
  }
  return { reservation, extent }
}

function requiredUnits(entry: BuildListEntry, engine: RngEngine) {
  const units = createPlannerRouteUnitPlans([entry], engine).unitPlans.get(entry.id) ?? []
  const pick = (stream: string) => units.filter(unit => unit.counterStream === stream && !unit.canSkipWhenCounterPassed).map(unit => unit.counterBefore!)
  return { normal: pick('normal')[0] ?? null, skill: pick('skill'), gogma: pick('gogma') }
}

/** Stage B: every Route from the Production Search Domain, materialized at the Planner-start origin. */
export async function materializeOracleRoutes(input: PlannerInput, engine: RngEngine, routes: readonly OracleRouteSpec[], rng: OracleRngReport,
  options: { nowMs?: () => number; maxDeliveredCandidates?: number } = {}): Promise<OracleMaterializationReport> {
  const nowMs = options.nowMs ?? (() => performance.now())
  const origin = createPlannerStartSearchOrigin(input)
  const reports: OracleMaterializationTargetReport[] = []
  const entries: BuildListEntry[] = []
  for (const route of routes) {
    const started = nowMs()
    const expected = expandOracleOperations(route.operations)
    const rngTarget = rng.targets.find(value => value.targetWeaponId === route.targetWeaponId)
    const report: OracleMaterializationTargetReport = { targetWeaponId: route.targetWeaponId, method: route.materialization, candidateId: null, buildListEntryId: null,
      routeKind: null, sourceOwnedWeaponId: null, estimated: null, plannerRequired: null, deliveredCandidates: null, elapsedMs: 0,
      matches: { operations: false, estimated: false, finalWeapon: false, requiredUnits: false, routeKind: false, source: false }, error: null }
    reports.push(report)
    const sameOperations = (candidateOps: readonly RouteOperation[]) => JSON.stringify(routeOperationsAsOracle(candidateOps)) === JSON.stringify(expected)
    try {
      let entry: BuildListEntry | null = null
      if (route.materialization === 'candidate_search') {
        const projected = oracleCandidateSearchInput(input, route)
        const result = await searchCandidates(projected, engine)
        const candidate = result.targetResult.candidate
        if (!candidate) throw new Error(`Candidate Search found no Candidate (${JSON.stringify(result.targetResult.skippedRoutes)}).`)
        entry = materializeGlobalResearchCandidate(input, projected, candidate)
      } else {
        const { reservation, extent } = oraclePlannerAlternativeInput(input, route, routes)
        const target = origin.targetWeapons.find(value => value.id === route.targetWeaponId)!
        const searchIdentity = `research.oracle1657.alternative.${hashStableValue({ target: target.id, extent, reservation, calculationContext: origin.calculationContext })}`
        const materializer = createDeterministicMaterializer<PlannerAlternativeCandidate>({ origin, target, searchIdentity,
          candidateIdPrefix: 'candidate.research.oracle1657.', clock: { now: () => GLOBAL_RESEARCH_TIME } })
        let delivered = 0
        const limit = options.maxDeliveredCandidates ?? 1000
        await visitPlannerAlternativeCandidates({ origin, targetWeaponId: target.id, extent, reservation, excludedRouteKeys: [] }, engine, candidate => {
          delivered += 1
          if (sameOperations(candidate.route.operations)) {
            entry = materializer.materializeBuildListEntry(candidate, input.buildListEntries).entry
            return 'stop'
          }
          return delivered >= limit ? 'stop' : 'continue'
        })
        report.deliveredCandidates = delivered
        if (!entry) throw new Error(`Planner Alternative Search delivered ${delivered} Candidates without the oracle Route.`)
      }
      const found: BuildListEntry = entry
      const candidate: BuildCandidate = found.candidateSnapshot
      entries.push(found)
      report.candidateId = candidate.id
      report.buildListEntryId = found.id
      report.routeKind = candidate.route.kind
      report.sourceOwnedWeaponId = candidate.route.sourceOwnedWeaponId
      report.estimated = { operations: candidate.estimatedOperationCount, normal: candidate.estimatedNormalAdvance, gogma: candidate.estimatedGogmaAdvance, skill: candidate.estimatedSkillAdvance }
      report.plannerRequired = requiredUnits(found, engine)
      report.matches = {
        operations: sameOperations(candidate.route.operations),
        estimated: JSON.stringify(report.estimated) === JSON.stringify(route.estimated),
        finalWeapon: rngTarget?.finalBonuses != null && areRestorationBonusSetsEqual(candidate.finalBonuses, rngTarget.finalBonuses)
          && candidate.restorationBonusScope === rngTarget.finalScope && candidate.seriesSkillId === rngTarget.finalSeriesSkillId && candidate.groupSkillId === rngTarget.finalGroupSkillId,
        requiredUnits: JSON.stringify(report.plannerRequired) === JSON.stringify(route.required),
        routeKind: candidate.route.kind === route.routeKind,
        source: candidate.route.sourceOwnedWeaponId === (route.source.kind === 'owned' ? route.source.ownedWeaponId : null),
      }
    } catch (caught) {
      report.error = caught instanceof Error ? caught.message : String(caught)
    }
    report.elapsedMs = nowMs() - started
  }
  const passed = reports.every(report => report.error === null && Object.values(report.matches).every(Boolean))
  return { targets: reports, entries, passed }
}

export interface OraclePlannerReport {
  excludedBuildListEntries: number
  termination: PlannerRunResult['termination'] | null
  steps: number
  stepOperationCounts: Record<string, number>
  physicalSteps: number
  selectedBuildListEntries: number
  conflicts: number
  rejectedBuildListEntries: number
  resourceConflictRejections: number
  warnings: string[]
  fullPlannerRuns: number
  traceReplay: { isValid: boolean; issues: number; drafts: number } | null
  elapsedMs: number
  plan: unknown
  error: string | null
}

/** Stage C: the Production Planner over the materialized Entries, plus an independent Trace Replay. */
export async function runOraclePlanner(input: PlannerInput, dependencies: PlannerDependencies, entries: readonly BuildListEntry[], maxPlanSteps: number,
  options: { nowMs?: () => number } = {}): Promise<OraclePlannerReport> {
  const nowMs = options.nowMs ?? (() => performance.now())
  const plannerInput: PlannerInput = { ...input, buildListEntries: [...entries], conflictResolutions: [], options: { maxPlanSteps } }
  const report: OraclePlannerReport = { excludedBuildListEntries: validatePlannerInput(plannerInput, dependencies).excludedBuildListEntries.length,
    termination: null, steps: 0, stepOperationCounts: {}, physicalSteps: 0, selectedBuildListEntries: 0, conflicts: 0, rejectedBuildListEntries: 0,
    resourceConflictRejections: 0, warnings: [], fullPlannerRuns: 0, traceReplay: null, elapsedMs: 0, plan: null, error: null }
  const started = nowMs()
  let observed: PlannerRunResult | null = null
  try {
    const result = await createProductionPlanWithObserver(plannerInput, dependencies, undefined, {
      beforePlannerRun: () => { report.fullPlannerRuns += 1 }, afterPlannerRun: value => { observed = value },
    })
    report.elapsedMs = nowMs() - started
    report.termination = result.termination
    report.conflicts = result.conflicts.length
    report.warnings = result.warnings.map(warning => warning.kind)
    const plan = result.plan
    if (plan) {
      report.steps = plan.steps.length
      for (const step of plan.steps) report.stepOperationCounts[step.operationType] = (report.stepOperationCounts[step.operationType] ?? 0) + 1
      report.physicalSteps = plan.steps.filter(step => step.operationType !== 'confirm_owned_ideal').length
      report.selectedBuildListEntries = plan.selectedBuildListEntryIds.length
      report.rejectedBuildListEntries = plan.rejectedBuildListEntries.length
      report.resourceConflictRejections = plan.rejectedBuildListEntries.filter(value => value.reason === 'resource_conflict').length
      report.plan = plan
    }
    const run = observed as PlannerRunResult | null
    if (run?.bestState) {
      const replay = replayPlannerSearchTrace(plannerInput, run.bestState, dependencies.rngEngine)
      report.traceReplay = { isValid: replay.isValid, issues: replay.issues.length, drafts: replay.drafts.length }
    }
  } catch (caught) {
    report.elapsedMs = nowMs() - started
    report.error = caught instanceof Error ? caught.message : String(caught)
  }
  return report
}

export function oracleStreamTotals(rng: OracleRngReport) {
  return {
    skill: rng.streams.skill.advance, gogma: rng.streams.gogma.advance,
    normal: Object.values(rng.streams.normal).reduce((sum, value) => sum + value.advance, 0),
    normalByCounter: Object.fromEntries(Object.entries(rng.streams.normal).map(([id, value]) => [id, value.advance])),
  }
}

export type OracleVerdict = 'proven_minimum' | 'validated_oracle' | 'oracle_not_validated'

export interface OracleVerdictInput {
  rngPassed: boolean
  materializationPassed: boolean
  planner: Pick<OraclePlannerReport, 'error' | 'termination' | 'selectedBuildListEntries' | 'conflicts' | 'rejectedBuildListEntries' | 'warnings' | 'traceReplay' | 'physicalSteps'>
  routeCount: number
  /** Physical operations counted from the oracle streams (Stage A). */
  oraclePhysicalOperations: number
  /** The relaxation minimum, or null when the scanned box proved nothing below its budget. */
  lowerBoundTotal: number | null
}

/**
 * `proven_minimum` only when the Production Planner really produced the oracle (Stages A-C) AND a lower
 * bound equal to its physical operation count was proven; otherwise never call it minimal or optimal.
 */
export function classifyOracleVerdict(value: OracleVerdictInput): OracleVerdict {
  const { planner } = value
  const validated = value.rngPassed && value.materializationPassed && planner.error === null && planner.termination?.status === 'completed'
    && planner.termination.completedTargetCount === value.routeCount && planner.selectedBuildListEntries === value.routeCount
    && planner.conflicts === 0 && planner.rejectedBuildListEntries === 0 && planner.warnings.length === 0 && planner.traceReplay?.isValid === true
  if (!validated) return 'oracle_not_validated'
  return value.lowerBoundTotal !== null && value.lowerBoundTotal === planner.physicalSteps && planner.physicalSteps === value.oraclePhysicalOperations
    ? 'proven_minimum' : 'validated_oracle'
}
