import { stableStringify } from '../../domain/models/publicTypes'
import type { BuildListOptimizationBounds } from '../../domain/planner/buildListOptimization'
import {
  BLO_BENCHMARK_CONFIG_PROTOCOL,
  BLO_BROWSER_RECORD_PROTOCOL,
  BLO_FAULT_INJECTIONS,
  BLO_RUN_PURPOSES,
  BLO_WORKER_PROTOCOL,
  isBloCancelTrigger,
  isBloMemoryOptions,
  type BloCancelTrigger,
  type BloFaultInjection,
  type BloMemoryOptions,
  type BloRunPurpose,
  type BloRunRecord,
} from './buildListOptimizationBenchmarkProtocol'

/**
 * Issue #260 PR-5A: the committed measurement plan of the Production Build List optimization Browser measurement (benchmark only;
 * read by the driver, the Node reference and the analyzer, never by the page or the Worker).
 *
 * A plan is one JSON block between the markers of a plan document, committed before any measurement it governs. Every reader takes
 * it from the measured commit (`git show <measurement HEAD>:<plan document>`), never from the working tree, so a plan edited after a
 * measurement is never applied to it. It fixes the inputs (by identity), the complete search bounds of every bounds set, the run
 * slots in order with their every option, the semantic comparison groups, the Node reference runs and the acceptance criteria.
 *
 * - `planKind: 'mechanics'`: a harness check on synthetic inputs. Its slots carry the outcome the harness must show (`expect`); it
 *   needs no Owner approval and decides nothing about the Production bounds.
 * - `planKind: 'measurement'`: the real measurement. While `status` is `proposed` (Owner approval pending) its criteria are proposals:
 *   the analysis reports observations only and every judgement is `not_yet_registered`. Only a `registered` plan whose approval is
 *   `owner_approved` is judged against its criteria.
 *
 * Binding a record to a slot never repairs it: the record must say it was planned, name a slot of a planned environment, carry the
 * slot's purpose, input, bounds set (and the bounds themselves, field by field), cancel trigger, fault injection and memory options,
 * have run on the slot's origin and Browser and on the plan's input identity, and the slot must still be free.
 */

export const BLO_PLAN_KIND = 'build-list-optimization-browser-plan' as const
export const BLO_PLAN_REVISION = 1
export const BLO_PLAN_BEGIN = '<!-- blo-browser-plan:begin -->'
export const BLO_PLAN_END = '<!-- blo-browser-plan:end -->'

export type BloPlanKind = 'mechanics' | 'measurement'
export type BloPlanStatus = 'proposed' | 'registered'
export type BloApprovalState = 'owner_approval_pending' | 'owner_approved' | 'not_required'
export type BloSlotOrigin = 'non_isolated' | 'isolated'

export type BloPlanInput =
  | { inputId: string; kind: 'export'; fileName: string; bytes: number; sha256: string; note: string }
  | { inputId: string; kind: 'synthetic'; caseId: string; note: string }

export interface BloPlanBoundsSet {
  boundsId: string
  /** `baseline`: the reference set (never adopted by being the baseline); `comparison`: a candidate or sensitivity set; `synthetic`: harness only. */
  role: 'baseline' | 'comparison' | 'synthetic'
  /** What the set is run to compare or confirm. */
  purpose: string
  /** How every value was obtained (a formula over the window, a Research registration, a test value). */
  derivation: string
  bounds: BuildListOptimizationBounds
}

export interface BloSlotExpectation {
  outcome: 'completed' | 'failed' | 'cancelled' | 'not_run'
  resultStatus: 'optimized' | 'not_found' | 'search_bound_reached' | 'unsupported' | null
  failureKind: string | null
}

export interface BloPlanSlot {
  slotId: string
  order: number
  purpose: BloRunPurpose
  origin: BloSlotOrigin
  inputId: string
  boundsId: string
  cancelTrigger: BloCancelTrigger | null
  faultInjection: BloFaultInjection | null
  memory: BloMemoryOptions | null
  /** A cancel slot's later slot whose completion shows that a new run completes after the cancel. */
  rerunSlotId: string | null
  /** Mechanics plans only: the outcome the harness must show. */
  expect: BloSlotExpectation | null
  note: string
}

export interface BloPlanEnvironment {
  environmentId: string
  /** `planned`: measured; `optional`: measured only when available (never required); `excluded`: not measured in this series. */
  status: 'planned' | 'optional' | 'excluded'
  reason: string | null
  description: string
  userAgentMustInclude: string[]
  slots: BloPlanSlot[]
}

export interface BloSemanticGroup {
  groupId: string
  inputId: string
  boundsId: string
  /** The slots whose completed runs must all carry one semantic fingerprint (cancel / lifecycle / pilot slots never count). */
  slotIds: string[]
  requiredBrowserRuns: number
  nodeReferenceRequired: boolean
}

export type BloCriterionAxis = 'semantic' | 'computation' | 'performance' | 'memory' | 'cancel_lifecycle'

/**
 * The metrics a criterion can name, each on its own axis (`buildListOptimizationBenchmarkAnalysis.ts` derives them). A value the run
 * did not yield (a cancelled run's result, a reading the Browser does not offer) is unmeasured, never a pass.
 */
export const BLO_CRITERION_METRICS = {
  semantic_group_identical: 'semantic',
  result_status: 'computation',
  all_planning_targets_completed: 'computation',
  request_to_terminal_ms: 'performance',
  worker_stage_total_ms: 'performance',
  end_to_end_ms: 'performance',
  main_long_task_max_ms: 'performance',
  worker_heap_used_max_bytes: 'memory',
  renderer_private_max_bytes: 'memory',
  main_heap_retained_bytes: 'memory',
  worker_memory_released: 'memory',
  cancel_settle_ms: 'cancel_lifecycle',
  cancel_worker_gone_ms: 'cancel_lifecycle',
  cancel_no_result_adopted: 'cancel_lifecycle',
  cancel_rerun_completed: 'cancel_lifecycle',
  storage_unchanged: 'cancel_lifecycle',
  no_interruption: 'cancel_lifecycle',
} as const satisfies Record<string, BloCriterionAxis>
export type BloCriterionMetric = keyof typeof BLO_CRITERION_METRICS

/** One criterion: a metric, how it is aggregated, and a threshold (null: an observation reported without a pass / fail). */
export interface BloCriterion {
  criterionId: string
  axis: BloCriterionAxis
  description: string
  metric: BloCriterionMetric
  scope: { inputId: string | null; boundsId: string | null; purposes: BloRunPurpose[] }
  aggregate: 'all' | 'median' | 'max' | 'each'
  comparator: 'equals' | 'at_most' | 'at_least' | null
  threshold: number | string | boolean | null
  unit: string | null
  rationale: string
}

export interface BloMeasurementPlan {
  kind: typeof BLO_PLAN_KIND
  revision: typeof BLO_PLAN_REVISION
  planKind: BloPlanKind
  series: string
  status: BloPlanStatus
  approval: { state: BloApprovalState; approvedBy: string | null; approvedOn: string | null; note: string }
  baseCommit: string
  protocols: { worker: typeof BLO_WORKER_PROTOCOL; benchmarkConfig: typeof BLO_BENCHMARK_CONFIG_PROTOCOL; record: typeof BLO_BROWSER_RECORD_PROTOCOL }
  versions: { calculationAppSchemaVersion: number; databaseSchemaVersion: number; exportSchemaVersion: number; productionRngEngineVersion: string; masterDataVersion: number }
  calculationContext: { gameVersion: string; masterDataVersion: number; rngEngineVersion: string; appSchemaVersion: number }
  inputs: BloPlanInput[]
  boundsSets: BloPlanBoundsSet[]
  environments: BloPlanEnvironment[]
  nodeReference: { runner: string; runs: { inputId: string; boundsId: string }[] } | null
  semanticComparison: { components: string[]; groups: BloSemanticGroup[] }
  criteria: { status: BloPlanStatus; items: BloCriterion[] }
  anomalyRules: string[]
  publicExclusions: string[]
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isPositiveInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0
const isNonNegativeInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value !== ''
const SHA256_HEX = /^[0-9a-f]{64}$/
const COMMIT = /^[0-9a-f]{40}$/
const ID = /^[A-Za-z0-9._:-]{1,64}$/
const ORIGINS: readonly BloSlotOrigin[] = ['non_isolated', 'isolated']
const COMPARISON_PURPOSES: readonly BloRunPurpose[] = ['timing', 'rerun', 'bounds', 'memory']
/** A cancel slot's re-run: a later comparison slot (or, in a mechanics plan, a later mechanics slot). */
const RERUN_PURPOSES: readonly BloRunPurpose[] = [...COMPARISON_PURPOSES, 'mechanics']

/** The plan JSON of a plan document (`[]` issues = exactly one fenced json block between the markers, holding valid JSON). */
export function extractBloMeasurementPlan(markdown: string): { plan: unknown; issues: string[] } {
  const begins = markdown.split(BLO_PLAN_BEGIN).length - 1
  const ends = markdown.split(BLO_PLAN_END).length - 1
  if (begins !== 1 || ends !== 1) return { plan: null, issues: [`The plan document must hold exactly one plan block (begin markers ${begins}, end markers ${ends}).`] }
  const start = markdown.indexOf(BLO_PLAN_BEGIN) + BLO_PLAN_BEGIN.length
  const end = markdown.indexOf(BLO_PLAN_END)
  if (end < start) return { plan: null, issues: ['The plan block ends before it begins.'] }
  const blocks = [...markdown.slice(start, end).matchAll(/```json\r?\n([\s\S]*?)\r?\n```/g)]
  if (blocks.length !== 1) return { plan: null, issues: [`The plan block must hold exactly one fenced json block (found ${blocks.length}).`] }
  try {
    return { plan: JSON.parse(blocks[0]![1]!), issues: [] }
  } catch (error) {
    return { plan: null, issues: [`The plan JSON does not parse: ${error instanceof Error ? error.message : String(error)}`] }
  }
}

function boundsShapeIssues(value: unknown, at: string): string[] {
  // Every bound explicit and a non-negative safe integer (the Domain refuses non-positive window / budgets itself; a plan names values only).
  const leaves: string[] = []
  const walk = (node: unknown, path: string) => {
    if (isRecord(node)) {
      for (const [key, child] of Object.entries(node)) walk(child, `${path}.${key}`)
      return
    }
    if (!isNonNegativeInteger(node)) leaves.push(`${path} must be a non-negative safe integer.`)
  }
  if (!isRecord(value)) return [`${at} must be an object.`]
  const keys = Object.keys(value).sort().join(',')
  if (keys !== 'maxPlannerVerifications,maxStructuralCandidates,mrvLookahead,nodeBudget,routeGeneration,window') {
    return [`${at} must name window, nodeBudget, mrvLookahead, maxStructuralCandidates, maxPlannerVerifications and routeGeneration.`]
  }
  const window = value.window
  if (!isRecord(window) || Object.keys(window).sort().join(',') !== 'gogma,normal,skill') leaves.push(`${at}.window must be { normal, gogma, skill }.`)
  const route = value.routeGeneration
  if (!isRecord(route) || Object.keys(route).sort().join(',') !== 'projectedSearchScaleGate,shapeSearchBudget,shapeSearchScaleGate') {
    leaves.push(`${at}.routeGeneration must be { projectedSearchScaleGate, shapeSearchScaleGate, shapeSearchBudget }.`)
  } else {
    const projected = route.projectedSearchScaleGate, shapeGate = route.shapeSearchScaleGate, budget = route.shapeSearchBudget
    if (!isRecord(projected) || Object.keys(projected).sort().join(',') !== 'maxConversionPositions,maxGogmaLegalWidth,maxNormalForgeCount,maxSkillLegalWidth') leaves.push(`${at}.routeGeneration.projectedSearchScaleGate names every gate value.`)
    if (!isRecord(shapeGate) || Object.keys(shapeGate).sort().join(',') !== 'maxConversionWalkPositions,maxDepthUpperBound,maxGogmaGeneratedStateUpperBound,maxNormalForgeCount') leaves.push(`${at}.routeGeneration.shapeSearchScaleGate names every gate value.`)
    if (!isRecord(budget) || Object.keys(budget).sort().join(',') !== 'maxGogmaGeneratedStates,maxPredictions,maxSettledWork,maxSkillStates'
      || !isRecord(budget.maxPredictions) || Object.keys(budget.maxPredictions).sort().join(',') !== 'gogmaKeep,gogmaReset,normalArtian,skill') leaves.push(`${at}.routeGeneration.shapeSearchBudget names every budget value.`)
  }
  walk(value, at)
  return leaves
}

function slotIssues(slot: unknown, at: string, plan: Record<string, unknown>, inputs: Map<string, Record<string, unknown>>, bounds: Map<string, Record<string, unknown>>): string[] {
  if (!isRecord(slot)) return [`${at} must be an object.`]
  const issues: string[] = []
  const keys = ['boundsId', 'cancelTrigger', 'expect', 'faultInjection', 'inputId', 'memory', 'note', 'order', 'origin', 'purpose', 'rerunSlotId', 'slotId']
  if (Object.keys(slot).sort().join(',') !== keys.join(',')) issues.push(`${at} must have exactly ${keys.join(', ')} (null where off).`)
  if (typeof slot.slotId !== 'string' || !ID.test(slot.slotId)) issues.push(`${at}.slotId must be 1..64 characters of [A-Za-z0-9._:-].`)
  if (!isPositiveInteger(slot.order)) issues.push(`${at}.order must be a positive integer.`)
  if (!BLO_RUN_PURPOSES.includes(slot.purpose as BloRunPurpose)) issues.push(`${at}.purpose must be one of ${BLO_RUN_PURPOSES.join(', ')}.`)
  if (!ORIGINS.includes(slot.origin as BloSlotOrigin)) issues.push(`${at}.origin must be non_isolated or isolated.`)
  const input = typeof slot.inputId === 'string' ? inputs.get(slot.inputId) : undefined
  if (input === undefined) issues.push(`${at}.inputId must name a plan input.`)
  const boundsSet = typeof slot.boundsId === 'string' ? bounds.get(slot.boundsId) : undefined
  if (boundsSet === undefined) issues.push(`${at}.boundsId must name a plan bounds set.`)
  if (!(slot.cancelTrigger === null || isBloCancelTrigger(slot.cancelTrigger))) issues.push(`${at}.cancelTrigger must be { stage, delayMs } or null.`)
  if (!(slot.faultInjection === null || BLO_FAULT_INJECTIONS.includes(slot.faultInjection as BloFaultInjection))) issues.push(`${at}.faultInjection must be worker_error, corrupt_result or null.`)
  if (!(slot.memory === null || isBloMemoryOptions(slot.memory))) issues.push(`${at}.memory must be { fixedPoints, gcWaitMs, cdpWorkerHeap, osProcessMemory } or null.`)
  if (typeof slot.note !== 'string') issues.push(`${at}.note must be a string.`)
  const purpose = slot.purpose as BloRunPurpose
  if ((purpose === 'cancel') !== (slot.cancelTrigger !== null)) issues.push(`${at}: a cancel trigger belongs to a cancel slot, and a cancel slot needs one.`)
  if ((purpose === 'memory') !== (slot.memory !== null)) issues.push(`${at}: memory options belong to a memory slot, and a memory slot needs them.`)
  if (purpose === 'memory' && slot.origin !== 'isolated') issues.push(`${at}: a memory slot runs on the cross-origin isolated origin.`)
  if (slot.faultInjection !== null && purpose !== 'lifecycle') issues.push(`${at}: a fault injection belongs to a lifecycle slot.`)
  if (purpose !== 'cancel' && slot.rerunSlotId !== null) issues.push(`${at}: only a cancel slot names a re-run slot.`)
  const mechanics = plan.planKind === 'mechanics'
  if (mechanics && !['mechanics', 'lifecycle', 'cancel', 'memory'].includes(purpose)) issues.push(`${at}: a mechanics plan runs mechanics, lifecycle, cancel and memory slots only.`)
  if (!mechanics && (purpose === 'mechanics' || purpose === 'lifecycle')) issues.push(`${at}: a measurement plan runs no mechanics or lifecycle slot (they are the mechanics plan's).`)
  if (mechanics !== (slot.expect !== null)) issues.push(`${at}: an expectation belongs to every mechanics slot and to no measurement slot.`)
  if (slot.expect !== null) {
    const expect = slot.expect
    if (!isRecord(expect) || !['completed', 'failed', 'cancelled', 'not_run'].includes(expect.outcome as string)
      || !(expect.resultStatus === null || ['optimized', 'not_found', 'search_bound_reached', 'unsupported'].includes(expect.resultStatus as string))
      || !(expect.failureKind === null || isNonEmptyString(expect.failureKind)) || (expect.outcome === 'completed') !== (expect.resultStatus !== null)
      || (expect.outcome === 'failed') !== (expect.failureKind !== null)) {
      issues.push(`${at}.expect must be { outcome, resultStatus (completed only), failureKind (failed only) }.`)
    }
  }
  if (!mechanics && input !== undefined && input.kind !== 'export') issues.push(`${at}: a measurement slot runs on an Export input.`)
  if (!mechanics && boundsSet !== undefined && boundsSet.role === 'synthetic') issues.push(`${at}: a measurement slot runs on a baseline or comparison bounds set.`)
  if (mechanics && input !== undefined && input.kind !== 'synthetic') issues.push(`${at}: a mechanics slot runs on a synthetic input.`)
  return issues
}

/**
 * Why a plan must not be used (`[]` = valid). Beyond the shape: unique IDs; every slot names a plan input and bounds set; the slot
 * orders of each environment are 1..n; purpose-specific options (a cancel trigger only and always in a cancel slot, memory options
 * only and always in a memory slot on the isolated origin, a fault only in a lifecycle slot); a measurement plan runs real Exports on
 * baseline / comparison bounds and no mechanics slot, a mechanics plan synthetic inputs with an expectation per slot; the semantic
 * groups name existing comparison slots of their input and bounds set and require exactly as many runs as they list; a registered
 * measurement plan is Owner-approved with registered criteria; a proposed one is still pending.
 */
export function bloMeasurementPlanIssues(value: unknown): string[] {
  if (!isRecord(value)) return ['The plan is not an object.']
  const issues: string[] = []
  if (value.kind !== BLO_PLAN_KIND) issues.push(`kind must be ${BLO_PLAN_KIND}.`)
  if (value.revision !== BLO_PLAN_REVISION) issues.push(`revision must be ${BLO_PLAN_REVISION}.`)
  if (value.planKind !== 'mechanics' && value.planKind !== 'measurement') issues.push('planKind must be mechanics or measurement.')
  if (typeof value.series !== 'string' || !/^[a-z0-9.-]{1,32}$/.test(value.series)) issues.push('series must be 1..32 characters of [a-z0-9.-].')
  if (value.status !== 'proposed' && value.status !== 'registered') issues.push('status must be proposed or registered.')
  const approval = value.approval
  if (!isRecord(approval) || !['owner_approval_pending', 'owner_approved', 'not_required'].includes(approval.state as string) || typeof approval.note !== 'string') {
    issues.push('approval must be { state, approvedBy, approvedOn, note }.')
  } else {
    if (value.planKind === 'mechanics' && (approval.state !== 'not_required' || value.status !== 'registered')) issues.push('A mechanics plan is registered and needs no Owner approval.')
    if (value.planKind === 'measurement') {
      if (approval.state === 'not_required') issues.push('A measurement plan needs the Owner approval.')
      if (value.status === 'proposed' && approval.state !== 'owner_approval_pending') issues.push('A proposed measurement plan is still pending the Owner approval.')
      if (value.status === 'registered' && approval.state !== 'owner_approved') issues.push('A registered measurement plan is Owner-approved.')
    }
    const approved = approval.state === 'owner_approved'
    if (approved !== (isNonEmptyString(approval.approvedBy) && typeof approval.approvedOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(approval.approvedOn))) {
      issues.push('approval names who approved it and on which date exactly when it is owner_approved.')
    }
    if (!approved && (approval.approvedBy !== null || approval.approvedOn !== null)) issues.push('An approval that is not given names no approver or date.')
  }
  if (typeof value.baseCommit !== 'string' || !COMMIT.test(value.baseCommit)) issues.push('baseCommit must be a 40-hex commit.')
  const protocols = value.protocols
  if (!isRecord(protocols) || protocols.worker !== BLO_WORKER_PROTOCOL || protocols.benchmarkConfig !== BLO_BENCHMARK_CONFIG_PROTOCOL || protocols.record !== BLO_BROWSER_RECORD_PROTOCOL) {
    issues.push(`protocols must be { worker: ${BLO_WORKER_PROTOCOL}, benchmarkConfig: ${BLO_BENCHMARK_CONFIG_PROTOCOL}, record: ${BLO_BROWSER_RECORD_PROTOCOL} }.`)
  }
  const versions = value.versions
  if (!isRecord(versions) || !isPositiveInteger(versions.calculationAppSchemaVersion) || !isPositiveInteger(versions.databaseSchemaVersion) || !isPositiveInteger(versions.exportSchemaVersion)
    || !isNonEmptyString(versions.productionRngEngineVersion) || !isPositiveInteger(versions.masterDataVersion)) {
    issues.push('versions must name the calculation, database and Export schema versions, the Production RNG Engine version and the Master data version.')
  }
  const context = value.calculationContext
  if (!isRecord(context) || !isNonEmptyString(context.gameVersion) || !isPositiveInteger(context.masterDataVersion) || !isNonEmptyString(context.rngEngineVersion) || !isPositiveInteger(context.appSchemaVersion)) {
    issues.push('calculationContext must be { gameVersion, masterDataVersion, rngEngineVersion, appSchemaVersion }.')
  }
  const inputs = new Map<string, Record<string, unknown>>()
  if (!Array.isArray(value.inputs) || value.inputs.length === 0) {
    issues.push('inputs must be a non-empty array.')
  } else {
    value.inputs.forEach((input, index) => {
      const at = `inputs[${index}]`
      if (!isRecord(input) || typeof input.inputId !== 'string' || !ID.test(input.inputId)) { issues.push(`${at}.inputId must be an ID.`); return }
      if (inputs.has(input.inputId)) issues.push(`${at}.inputId ${input.inputId} is not unique.`)
      inputs.set(input.inputId, input)
      if (typeof input.note !== 'string') issues.push(`${at}.note must be a string.`)
      if (input.kind === 'export') {
        if (!isNonEmptyString(input.fileName) || /[\\/]/.test(input.fileName) || !isNonNegativeInteger(input.bytes) || typeof input.sha256 !== 'string' || !SHA256_HEX.test(input.sha256)) {
          issues.push(`${at} must be { inputId, kind: export, fileName (base name), bytes, sha256, note }.`)
        }
      } else if (input.kind === 'synthetic') {
        if (!isNonEmptyString(input.caseId)) issues.push(`${at}.caseId must name a synthetic case.`)
      } else {
        issues.push(`${at}.kind must be export or synthetic.`)
      }
    })
  }
  const bounds = new Map<string, Record<string, unknown>>()
  if (!Array.isArray(value.boundsSets) || value.boundsSets.length === 0) {
    issues.push('boundsSets must be a non-empty array.')
  } else {
    value.boundsSets.forEach((set, index) => {
      const at = `boundsSets[${index}]`
      if (!isRecord(set) || typeof set.boundsId !== 'string' || !ID.test(set.boundsId)) { issues.push(`${at}.boundsId must be an ID.`); return }
      if (bounds.has(set.boundsId)) issues.push(`${at}.boundsId ${set.boundsId} is not unique.`)
      bounds.set(set.boundsId, set)
      if (!['baseline', 'comparison', 'synthetic'].includes(set.role as string)) issues.push(`${at}.role must be baseline, comparison or synthetic.`)
      if (!isNonEmptyString(set.purpose) || !isNonEmptyString(set.derivation)) issues.push(`${at} must say its purpose and derivation.`)
      issues.push(...boundsShapeIssues(set.bounds, `${at}.bounds`))
    })
    if (value.planKind === 'measurement' && [...bounds.values()].filter(set => set.role === 'baseline').length !== 1) issues.push('A measurement plan has exactly one baseline bounds set.')
  }
  const slotsById = new Map<string, { environment: Record<string, unknown>; slot: Record<string, unknown> }>()
  if (!Array.isArray(value.environments) || value.environments.length === 0) {
    issues.push('environments must be a non-empty array.')
  } else {
    const environmentIds = new Set<string>()
    value.environments.forEach((environment, index) => {
      const at = `environments[${index}]`
      if (!isRecord(environment)) { issues.push(`${at} must be an object.`); return }
      if (typeof environment.environmentId !== 'string' || !/^[a-z0-9-]{1,48}$/.test(environment.environmentId) || environmentIds.has(environment.environmentId)) issues.push(`${at}.environmentId must be a unique [a-z0-9-] ID.`)
      else environmentIds.add(environment.environmentId)
      if (!['planned', 'optional', 'excluded'].includes(environment.status as string)) issues.push(`${at}.status must be planned, optional or excluded.`)
      if (!isNonEmptyString(environment.description)) issues.push(`${at}.description must be a non-empty string.`)
      if (!Array.isArray(environment.userAgentMustInclude) || !environment.userAgentMustInclude.every(isNonEmptyString)) issues.push(`${at}.userAgentMustInclude must be an array of non-empty strings.`)
      if (!Array.isArray(environment.slots)) { issues.push(`${at}.slots must be an array.`); return }
      if (environment.status === 'excluded') {
        if (!isNonEmptyString(environment.reason) || environment.slots.length !== 0) issues.push(`${at}: an excluded environment has a reason and no slot.`)
        return
      }
      if (environment.status === 'planned' && (environment.reason !== null || environment.slots.length === 0 || (environment.userAgentMustInclude as unknown[]).length === 0)) {
        issues.push(`${at}: a planned environment has no reason, names its user agent and has slots.`)
      }
      if (environment.status === 'optional' && !isNonEmptyString(environment.reason)) issues.push(`${at}: an optional environment says why it is optional.`)
      const orders: number[] = []
      environment.slots.forEach((slot, slotIndex) => {
        const slotAt = `${at}.slots[${slotIndex}]`
        issues.push(...slotIssues(slot, slotAt, value, inputs, bounds))
        if (!isRecord(slot)) return
        if (typeof slot.slotId === 'string') {
          if (slotsById.has(slot.slotId)) issues.push(`${slotAt}.slotId ${slot.slotId} is not unique in the plan.`)
          slotsById.set(slot.slotId, { environment, slot })
        }
        if (isPositiveInteger(slot.order)) orders.push(slot.order)
      })
      const sorted = [...orders].sort((left, right) => left - right)
      if (sorted.length !== environment.slots.length || sorted.some((order, position) => order !== position + 1)) issues.push(`${at}: the slot orders must be exactly 1..${environment.slots.length}.`)
      for (const slot of environment.slots) {
        if (!isRecord(slot) || slot.purpose !== 'cancel' || typeof slot.rerunSlotId !== 'string') continue
        const rerun = slotsById.get(slot.rerunSlotId)
        if (rerun === undefined || rerun.environment !== environment || !RERUN_PURPOSES.includes(rerun.slot.purpose as BloRunPurpose)
          || !((rerun.slot.order as number) > (slot.order as number)) || rerun.slot.inputId !== slot.inputId || rerun.slot.boundsId !== slot.boundsId) {
          issues.push(`${at}: the re-run slot ${slot.rerunSlotId} of ${String(slot.slotId)} must be a later comparison (or mechanics) slot of the same environment, input and bounds set.`)
        }
      }
    })
  }
  const node = value.nodeReference
  if (!(node === null || (isRecord(node) && typeof node.runner === 'string' && /^scripts\/[A-Za-z0-9_.-]+\.mjs$/.test(node.runner) && Array.isArray(node.runs)
    && node.runs.every(run => isRecord(run) && inputs.has(run.inputId as string) && bounds.has(run.boundsId as string))))) {
    issues.push('nodeReference must be null or { runner: scripts/<file>.mjs, runs: [{ inputId, boundsId }] } naming plan inputs and bounds sets.')
  }
  const comparison = value.semanticComparison
  if (!isRecord(comparison) || !Array.isArray(comparison.components) || !comparison.components.every(isNonEmptyString) || !Array.isArray(comparison.groups)) {
    issues.push('semanticComparison must be { components, groups }.')
  } else {
    const groupIds = new Set<string>()
    comparison.groups.forEach((group, index) => {
      const at = `semanticComparison.groups[${index}]`
      if (!isRecord(group) || typeof group.groupId !== 'string' || !ID.test(group.groupId) || groupIds.has(group.groupId)) { issues.push(`${at}.groupId must be a unique ID.`); return }
      groupIds.add(group.groupId)
      if (!Array.isArray(group.slotIds) || !isPositiveInteger(group.requiredBrowserRuns) || group.requiredBrowserRuns !== group.slotIds.length || typeof group.nodeReferenceRequired !== 'boolean') {
        issues.push(`${at} must list its slots and require exactly that many runs.`)
        return
      }
      for (const slotId of group.slotIds) {
        const entry = typeof slotId === 'string' ? slotsById.get(slotId) : undefined
        if (entry === undefined || !RERUN_PURPOSES.includes(entry.slot.purpose as BloRunPurpose) || entry.slot.inputId !== group.inputId || entry.slot.boundsId !== group.boundsId) {
          issues.push(`${at}: ${String(slotId)} must be a comparison slot of the group's input and bounds set.`)
        }
      }
      if (group.nodeReferenceRequired === true && !(isRecord(node) && Array.isArray(node.runs) && node.runs.some(run => isRecord(run) && run.inputId === group.inputId && run.boundsId === group.boundsId))) {
        issues.push(`${at}: a required Node reference must be a planned Node reference run.`)
      }
    })
  }
  const criteria = value.criteria
  if (!isRecord(criteria) || (criteria.status !== 'proposed' && criteria.status !== 'registered') || !Array.isArray(criteria.items)) {
    issues.push('criteria must be { status, items }.')
  } else {
    if (criteria.status !== value.status) issues.push('criteria.status must equal the plan status (criteria are registered with the plan, never after it).')
    const criterionIds = new Set<string>()
    criteria.items.forEach((item, index) => {
      const at = `criteria.items[${index}]`
      if (!isRecord(item) || typeof item.criterionId !== 'string' || !ID.test(item.criterionId) || criterionIds.has(item.criterionId)) { issues.push(`${at}.criterionId must be a unique ID.`); return }
      criterionIds.add(item.criterionId)
      if (!['semantic', 'computation', 'performance', 'memory', 'cancel_lifecycle'].includes(item.axis as string)) issues.push(`${at}.axis must be a criterion axis.`)
      if (!isNonEmptyString(item.description) || !isNonEmptyString(item.rationale)) issues.push(`${at} must say its description and rationale.`)
      if (!(typeof item.metric === 'string' && item.metric in BLO_CRITERION_METRICS)) issues.push(`${at}.metric must be one of ${Object.keys(BLO_CRITERION_METRICS).join(', ')}.`)
      else if (BLO_CRITERION_METRICS[item.metric as BloCriterionMetric] !== item.axis) issues.push(`${at}.metric ${item.metric} belongs to the ${BLO_CRITERION_METRICS[item.metric as BloCriterionMetric]} axis.`)
      if (!['all', 'median', 'max', 'each'].includes(item.aggregate as string)) issues.push(`${at}.aggregate must be all, median, max or each.`)
      if ((item.comparator === null) !== (item.threshold === null)) issues.push(`${at}: a comparator and a threshold go together (both null for an observation).`)
      if (!(item.comparator === null || ['equals', 'at_most', 'at_least'].includes(item.comparator as string))) issues.push(`${at}.comparator must be equals, at_most, at_least or null.`)
      const scope = item.scope
      if (!isRecord(scope) || !(scope.inputId === null || inputs.has(scope.inputId as string)) || !(scope.boundsId === null || bounds.has(scope.boundsId as string))
        || !Array.isArray(scope.purposes) || !scope.purposes.every(purpose => BLO_RUN_PURPOSES.includes(purpose as BloRunPurpose))) {
        issues.push(`${at}.scope must name plan inputs / bounds sets (or null) and run purposes.`)
      }
    })
  }
  if (!Array.isArray(value.anomalyRules) || !value.anomalyRules.every(isNonEmptyString)) issues.push('anomalyRules must be a string array.')
  if (!Array.isArray(value.publicExclusions) || !value.publicExclusions.every(isNonEmptyString)) issues.push('publicExclusions must be a string array.')
  return issues
}

export type BloUnplannedReason =
  | 'not_planned' | 'unknown_slot' | 'environment_not_measured' | 'purpose_mismatch' | 'input_mismatch' | 'bounds_mismatch' | 'options_mismatch'
  | 'origin_mismatch' | 'environment_mismatch' | 'duplicate_slot'

export interface BloRecordedRun {
  record: BloRunRecord
  /** The raw file the record came from (its base name). */
  source: string
}

export interface BloSlotBinding {
  bound: Map<string, BloRecordedRun>
  unplanned: { slotId: string; purpose: string; reason: BloUnplannedReason; source: string; startedAt: string }[]
  /** Per measured environment: whether the bound slots ran in plan order (by record start), and the slots that did not. */
  order: Record<string, { followed: boolean; outOfOrderSlots: string[] }>
}

function inputMatches(input: BloPlanInput, record: BloRunRecord): boolean {
  const identity = record.input.identity
  if (identity === null) return false
  if (input.kind === 'export') return identity.kind === 'export' && identity.fileName === input.fileName && identity.bytes === input.bytes && identity.sha256 === input.sha256
  return identity.kind === 'synthetic' && identity.caseId === input.caseId
}

/** Binds recorded runs to the plan's slots (see the module comment). Records are taken in start order; nothing is repaired. */
export function bindBloRecordsToPlan(plan: BloMeasurementPlan, runs: readonly BloRecordedRun[]): BloSlotBinding {
  const slots = new Map<string, { environment: BloPlanEnvironment; slot: BloPlanSlot }>()
  for (const environment of plan.environments) for (const slot of environment.slots) slots.set(slot.slotId, { environment, slot })
  const inputs = new Map(plan.inputs.map(input => [input.inputId, input]))
  const bounds = new Map(plan.boundsSets.map(set => [set.boundsId, set]))
  const ordered = [...runs].sort((left, right) => (left.record.startedAt < right.record.startedAt ? -1 : left.record.startedAt > right.record.startedAt ? 1 : left.record.sequence - right.record.sequence))
  const binding: BloSlotBinding = { bound: new Map(), unplanned: [], order: {} }
  for (const run of ordered) {
    const { record } = run
    const unplanned = (reason: BloUnplannedReason) => { binding.unplanned.push({ slotId: record.slot.slotId, purpose: record.slot.purpose, reason, source: run.source, startedAt: record.startedAt }) }
    if (record.slot.planned !== true) { unplanned('not_planned'); continue }
    const entry = slots.get(record.slot.slotId)
    if (entry === undefined) { unplanned('unknown_slot'); continue }
    if (entry.environment.status === 'excluded') { unplanned('environment_not_measured'); continue }
    const { slot, environment } = entry
    if (record.slot.purpose !== slot.purpose) { unplanned('purpose_mismatch'); continue }
    if (record.slot.inputId !== slot.inputId || !inputMatches(inputs.get(slot.inputId)!, record)) { unplanned('input_mismatch'); continue }
    if (record.slot.boundsId !== slot.boundsId || stableStringify(record.bounds) !== stableStringify(bounds.get(slot.boundsId)!.bounds)) { unplanned('bounds_mismatch'); continue }
    if (stableStringify({ c: record.slot.cancelTrigger, f: record.slot.faultInjection, m: record.slot.memory }) !== stableStringify({ c: slot.cancelTrigger, f: slot.faultInjection, m: slot.memory })) { unplanned('options_mismatch'); continue }
    if (record.environment.crossOriginIsolated !== (slot.origin === 'isolated')) { unplanned('origin_mismatch'); continue }
    const userAgent = record.environment.userAgent
    if (userAgent === null || !environment.userAgentMustInclude.every(part => userAgent.includes(part))) { unplanned('environment_mismatch'); continue }
    if (binding.bound.has(slot.slotId)) { unplanned('duplicate_slot'); continue }
    binding.bound.set(slot.slotId, run)
  }
  for (const environment of plan.environments) {
    if (environment.status === 'excluded') continue
    const boundInRunOrder = ordered.filter(run => environment.slots.some(slot => binding.bound.get(slot.slotId) === run))
    const outOfOrderSlots: string[] = []
    let highest = 0
    for (const run of boundInRunOrder) {
      const order = environment.slots.find(slot => slot.slotId === run.record.slot.slotId)!.order
      if (order < highest) outOfOrderSlots.push(run.record.slot.slotId)
      highest = Math.max(highest, order)
    }
    binding.order[environment.environmentId] = { followed: outOfOrderSlots.length === 0, outOfOrderSlots }
  }
  return binding
}

/** The slot spec a driver passes to the page for one plan slot (the bounds copied from the plan's bounds set). */
export function bloSlotSpecOfPlan(plan: BloMeasurementPlan, slotId: string) {
  const slot = plan.environments.flatMap(environment => environment.slots).find(entry => entry.slotId === slotId)
  if (slot === undefined) throw new Error(`The plan has no slot ${slotId}.`)
  const set = plan.boundsSets.find(entry => entry.boundsId === slot.boundsId)!
  return {
    slotId: slot.slotId, purpose: slot.purpose, planned: true, inputId: slot.inputId, boundsId: slot.boundsId, bounds: structuredClone(set.bounds),
    cancelTrigger: slot.cancelTrigger === null ? null : { ...slot.cancelTrigger }, faultInjection: slot.faultInjection, memory: slot.memory === null ? null : { ...slot.memory },
  }
}
