/**
 * Issue #154 Phase 2-C2.6-B2-C2B2E: the population (the B2-C2B2D Targets left unrecovered with an unmeasured task), its probes
 * (B2-C2B2D's selected P1 rank and tight extent, re-derived) and the authority chain. Research only. Never import from Production,
 * and never from the B2-C2B2E Search side (the Search module never imports this one).
 *
 * Every input of a probe is oracle-derived and declared as such, exactly as in B2-C2B2D:
 *   - population: the committed B2-C2B2D RESULT's Targets with `recovery = none` whose task ended in `timeout` / `out_of_memory`
 *     (`oracleGuidedTargetPopulation = true`); the other two B2-C2B2D Targets (recovered) are not re-run;
 *   - context and extent: B2-C2B2D's - re-derived from the B2-C2B1 / B2-C1 / B2-C2B2B / B2-C2B2C authorities by B2-C2B2D's own
 *     `phase2c26b2c2b2dProbes()` and required to equal what the B2-C2B2D RESULT recorded (probe derivation, Target row, task row).
 * The manifest built here carries per Target its ID, B2-C2B2D task ID, P1 rank and tight extent and nothing else: no expected
 * stable key, Candidate index, operation cost, Route body, Search result or B2-C2B2D measurement.
 */
import { stableStringify } from '../domain/models/hashing'
import type { PlannerAlternativeSearchExtent } from '../domain/search'
import type { Phase2C26B2C2AB2C1Authority } from './plannerGlobalPhase2C26B2C2ATargets'
import type { Phase2C26B2C2B2AB2C2B1Authority } from './plannerGlobalPhase2C26B2C2B2ATargets'
import type { Phase2C26B2C2B2CB2C2B2BAuthority } from './plannerGlobalPhase2C26B2C2B2CTargets'
import { PHASE2C26B2C2B2D_STAGE1 } from './plannerGlobalPhase2C26B2C2B2D'
import {
  phase2c26b2c2b2dProbes,
  type Phase2C26B2C2B2DB2C2B2CAuthority,
  type Phase2C26B2C2B2DB2C2B2CTaskRow,
  type Phase2C26B2C2B2DProbeDerivation,
} from './plannerGlobalPhase2C26B2C2B2DTargets'
import {
  PHASE2C26B2C2B2E_CONTEXT_SELECTION,
  PHASE2C26B2C2B2E_EXTENT_RULE,
  PHASE2C26B2C2B2E_PROBE_SOURCE,
  PHASE2C26B2C2B2E_TARGETS,
  type Phase2C26B2C2B2EProbe,
  type Phase2C26B2C2B2EProbeManifest,
} from './plannerGlobalPhase2C26B2C2B2E'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const COMMIT = /^[0-9a-f]{40}$/
const numberOrNull = (value: unknown) => value === null || (typeof value === 'number' && Number.isFinite(value))
const rankOrNull = (value: unknown) => value === null || (Number.isSafeInteger(value) && (value as number) >= 0)

// ---------------------------------------------------------------- the B2-C2B2D RESULT (the paired baseline and the population source)

/** The B2-C2B2D RESULT (E1 ∩ L2 at the first compatible context x tight extent, formal, INCOMPLETE with C4C 2 / 4) this phase extends. */
export const PHASE2C26B2C2B2E_REGISTERED_B2C2B2D = {
  resultSha256: '644962a942622a0da25e02c83b87866319618e9ceddb24ca9c5dbee5a55130e3',
  decisionCase: 'B2C2B2D_INCOMPLETE',
  evidenceGrade: 'formal',
  measuredHead: '3b35ee178174e2cb53958d38497a1a3f8fc26c20',
  targets: 4,
  tasks: 4,
  stage1: { ...PHASE2C26B2C2B2D_STAGE1 },
  /** The B2-C2B2D processes that leave a Target unmeasured and so put it in this phase's population. */
  unmeasuredProcesses: ['timeout', 'out_of_memory'],
  previouslyUnrecovered: 2,
  previouslyRecovered: 2,
} as const

type Policy = 'C8' | 'C32' | 'C4C'
const POLICIES: readonly Policy[] = ['C8', 'C32', 'C4C']

/** One B2-C2B2D Target row as this phase needs it (post hoc; the Search never reads it). */
export interface Phase2C26B2C2B2EB2C2B2DTarget {
  targetWeaponId: string
  taskId: string
  selectedRank: number
  process: string
  measured: boolean
  recovery: Policy | 'none'
  missClass: string | null
  tightExtent: PlannerAlternativeSearchExtent
  /** B2-C2B2C's process of the same Target and context (the common L2 run, carried for a three-step display only). */
  b2c2b2cSameContextProcess: string | null
  /** The excluded current Route key SHA-256 B2-C2B2D re-derived for this pair (its paired identity). */
  rederivedExcludedRouteKeySha256: string | null
  pairedIdentityMatches: boolean
}

/** One B2-C2B2D task row: B2-C2B2C's task row shape plus the tight extent (the paired comparison of this phase reads it). */
export interface Phase2C26B2C2B2EB2C2B2DTaskRow extends Phase2C26B2C2B2DB2C2B2CTaskRow {
  extent: PlannerAlternativeSearchExtent
}

export interface Phase2C26B2C2B2EB2C2B2DAuthority {
  resultSha256: string
  measuredHead: string
  analysisHead: string
  decisionCase: string
  evidenceGrade: string
  b2c2b1ResultSha256: string
  b2c1ResultSha256: string
  b2b1ResultSha256: string
  b2c2b2bResultSha256: string
  b2c2b2cResultSha256: string
  exportSha256: string
  probeManifestSha256: string
  stage1: unknown
  origins: { skill: number; gogma: number }
  calculationContext: unknown
  researchMaxPlanSteps: number
  targetWeaponIds: string[]
  probes: Phase2C26B2C2B2DProbeDerivation[]
  targets: Phase2C26B2C2B2EB2C2B2DTarget[]
  taskRows: Phase2C26B2C2B2EB2C2B2DTaskRow[]
  exactTargets: Record<Policy, number>
  e1: { commonLadder: Record<Policy, { recovered: number; of: number }>; diagnostic: Record<Policy, { recovered: number; of: number }> }
}

const EXTENT = (value: unknown): value is PlannerAlternativeSearchExtent => isObject(value) && same(Object.keys(value).sort(), ['maxGogmaAdvance', 'maxNormalAdvance', 'maxSkillAdvance'])
  && Object.values(value).every(v => Number.isSafeInteger(v))
const TASK_STRINGS = ['taskId', 'targetWeaponId', 'reservationDigest', 'representativeFixedSetId', 'defaultSearchInputDigest', 'searchInputDigest', 'process'] as const
const TASK_INTEGERS = ['contextRank', 'groupIndex', 'targetEligibleMinCardinality'] as const
const TASK_NUMBERS = ['wallMs', 'searchElapsedMs', 'peakHeapBytes', 'peakRssBytes', 'yields', 'candidateCount', 'deliveredCandidates', 'firstExactIndex', 'firstExactCost'] as const
const TOTAL = (value: unknown) => isObject(value) && POLICIES.every(p => isObject(value[p]) && Number.isSafeInteger((value[p] as Json).recovered) && Number.isSafeInteger((value[p] as Json).of))

/**
 * Reads the committed B2-C2B2D RESULT as untrusted JSON and fails closed unless it is the registered formal baseline: its own
 * SHA-256; formal with verified launch provenance, not partial; the registered measured HEAD and case with no invalid reason;
 * the B2-C2B1 / B2-C1 / B2-B1 / B2-C2B2B / B2-C2B2C RESULTs and the Export of this phase; B2-C2B2D's registered Stage 1
 * (10 minutes, 8192 MB); 4 readable probe derivations, 4 readable Target rows and 4 readable task rows (one per Target, at the
 * Target's tight extent), the exact Target counts agreeing with the rows. Nothing here reaches the Search.
 */
export function parsePhase2C26B2C2B2EB2C2B2DAuthority(json: unknown, resultSha256: string,
  expected: { b2c2b1ResultSha256: string; b2c1ResultSha256: string; b2b1ResultSha256: string; b2c2b2bResultSha256: string; b2c2b2cResultSha256: string; exportSha256: string }):
  { valid: boolean; issues: string[]; authority: Phase2C26B2C2B2EB2C2B2DAuthority | null } {
  const reg = PHASE2C26B2C2B2E_REGISTERED_B2C2B2D
  const issues: string[] = []
  if (!isObject(json) || !isObject(json.provenance) || !isObject(json.decision) || !isObject(json.conditions) || !isObject(json.aggregates) || !Array.isArray(json.targets)
    || !Array.isArray(json.taskRows) || !Array.isArray(json.probes) || !isObject(json.e1Aggregate)) {
    return { valid: false, issues: ['B2-C2B2D RESULT lacks provenance / decision / conditions / aggregates / targets / taskRows / probes / e1Aggregate'], authority: null }
  }
  const { provenance, decision, conditions, aggregates } = json
  if (resultSha256 !== reg.resultSha256) issues.push(`B2-C2B2D RESULT SHA-256 ${resultSha256} is not the registered ${reg.resultSha256}`)
  if (provenance.formal !== true || provenance.evidenceGrade !== reg.evidenceGrade || provenance.launchProvenanceVerified !== true) issues.push('the B2-C2B2D RESULT is not formal with verified launch provenance')
  if (provenance.partialRun !== false) issues.push('the B2-C2B2D RESULT is a partial run')
  if (typeof provenance.measuredHead !== 'string' || !COMMIT.test(provenance.measuredHead) || provenance.measuredHead !== reg.measuredHead) issues.push('provenance.measuredHead is not the registered B2-C2B2D measured HEAD')
  if (typeof provenance.analysisHead !== 'string' || !COMMIT.test(provenance.analysisHead)) issues.push('provenance.analysisHead is not a commit SHA')
  if (decision.case !== reg.decisionCase) issues.push(`decision.case ${String(decision.case)} is not ${reg.decisionCase}`)
  if (!Array.isArray(json.invalidReasons) || json.invalidReasons.length !== 0) issues.push('invalidReasons is not empty')
  for (const [field, value] of [['b2c2b1ResultSha256', expected.b2c2b1ResultSha256], ['b2c1ResultSha256', expected.b2c1ResultSha256], ['b2b1ResultSha256', expected.b2b1ResultSha256],
    ['b2c2b2bResultSha256', expected.b2c2b2bResultSha256], ['b2c2b2cResultSha256', expected.b2c2b2cResultSha256], ['exportSha256', expected.exportSha256]] as const) {
    if (provenance[field] !== value) issues.push(`provenance.${field} is not the one of this phase`)
  }
  if (typeof provenance.probeManifestSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(provenance.probeManifestSha256)) issues.push('provenance.probeManifestSha256 is not a SHA-256')
  if (!same(conditions.stage1, reg.stage1)) issues.push('conditions.stage1 is not B2-C2B2D\'s registered Stage 1 (10 minutes, 8192 MB)')
  const origins = isObject(conditions.origins) && Number.isSafeInteger(conditions.origins.skill) && Number.isSafeInteger(conditions.origins.gogma)
    ? { skill: conditions.origins.skill as number, gogma: conditions.origins.gogma as number } : null
  if (origins === null) issues.push('conditions.origins is not readable')
  if (!isObject(conditions.calculationContext)) issues.push('conditions.calculationContext is not readable')
  if (!Number.isSafeInteger(conditions.researchMaxPlanSteps)) issues.push('conditions.researchMaxPlanSteps is not readable')

  const probes: Phase2C26B2C2B2DProbeDerivation[] = []
  for (const raw of json.probes as unknown[]) {
    if (!isObject(raw) || typeof raw.targetWeaponId !== 'string' || !rankOrNull(raw.b2c1FirstCompatibleRank) || !EXTENT(raw.tightExtent) || !EXTENT(raw.commonL2Extent)
      || !isObject(raw.required)) { issues.push('a B2-C2B2D probe derivation is malformed'); continue }
    probes.push(structuredClone(raw) as unknown as Phase2C26B2C2B2DProbeDerivation)
  }
  if (probes.length !== reg.targets) issues.push(`the B2-C2B2D RESULT holds ${probes.length} readable probe derivations, not ${reg.targets}`)

  const targets: Phase2C26B2C2B2EB2C2B2DTarget[] = []
  for (const raw of json.targets as unknown[]) {
    if (!isObject(raw) || typeof raw.targetWeaponId !== 'string' || typeof raw.taskId !== 'string' || !Number.isSafeInteger(raw.selectedRank) || typeof raw.process !== 'string'
      || typeof raw.measured !== 'boolean' || !['C8', 'C32', 'C4C', 'none'].includes(raw.recovery as string) || !(raw.missClass === null || typeof raw.missClass === 'string')
      || !isObject(raw.extents) || !EXTENT(raw.extents.tight) || !isObject(raw.b2c2b2c) || !(raw.b2c2b2c.sameContextProcess === null || typeof raw.b2c2b2c.sameContextProcess === 'string')
      || !isObject(raw.paired) || !isObject(raw.paired.identity) || typeof raw.paired.identity.matches !== 'boolean' || !isObject(raw.paired.identity.excludedRouteKeyComparison)) {
      issues.push('a B2-C2B2D Target row is malformed'); continue
    }
    const route = raw.paired.identity.excludedRouteKeyComparison as Json
    if (!(route.rederivedExcludedRouteKeySha256 === null || typeof route.rederivedExcludedRouteKeySha256 === 'string')) { issues.push(`${raw.targetWeaponId}: the B2-C2B2D excluded Route comparison is malformed`); continue }
    targets.push({ targetWeaponId: raw.targetWeaponId, taskId: raw.taskId, selectedRank: raw.selectedRank as number, process: raw.process, measured: raw.measured,
      recovery: raw.recovery as Phase2C26B2C2B2EB2C2B2DTarget['recovery'], missClass: raw.missClass as string | null, tightExtent: { ...(raw.extents.tight as PlannerAlternativeSearchExtent) },
      b2c2b2cSameContextProcess: raw.b2c2b2c.sameContextProcess as string | null, rederivedExcludedRouteKeySha256: route.rederivedExcludedRouteKeySha256 as string | null,
      pairedIdentityMatches: raw.paired.identity.matches as boolean })
  }
  if (targets.length !== reg.targets || (json.targets as unknown[]).length !== reg.targets) issues.push(`the B2-C2B2D RESULT holds ${targets.length} readable Targets, not ${reg.targets}`)
  if (new Set(targets.map(t => t.targetWeaponId)).size !== targets.length) issues.push('a B2-C2B2D Target repeats')
  if (!same(targets.map(t => t.targetWeaponId), [...targets.map(t => t.targetWeaponId)].sort(compare))) issues.push('the B2-C2B2D Target rows are not in ascending order')
  if (targets.some(t => !t.pairedIdentityMatches)) issues.push('a B2-C2B2D paired identity did not hold')

  const taskRows: Phase2C26B2C2B2EB2C2B2DTaskRow[] = []
  for (const raw of json.taskRows as unknown[]) {
    if (!isObject(raw) || TASK_STRINGS.some(k => typeof raw[k] !== 'string') || TASK_INTEGERS.some(k => !Number.isSafeInteger(raw[k])) || !Array.isArray(raw.representativeFixedTargetWeaponIds)
      || !(raw.excludedRouteKeySha256 === null || typeof raw.excludedRouteKeySha256 === 'string') || !(raw.record === null || typeof raw.record === 'string')
      || !TASK_NUMBERS.every(k => numberOrNull(raw[k])) || !(raw.termination === null || typeof raw.termination === 'string') || !(raw.coverage === null || typeof raw.coverage === 'string')
      || typeof raw.compatible !== 'boolean' || !(raw.captureComplete === null || typeof raw.captureComplete === 'boolean') || !(raw.safetyCapHit === null || typeof raw.safetyCapHit === 'boolean')
      || !Array.isArray(raw.capturedCosts) || !isObject(raw.hit) || !POLICIES.every(p => typeof (raw.hit as Json)[p] === 'boolean') || !EXTENT(raw.extent)) {
      issues.push('a B2-C2B2D task row is malformed'); continue
    }
    const hit = raw.hit as Json
    taskRows.push({ taskId: raw.taskId as string, targetWeaponId: raw.targetWeaponId as string, contextRank: raw.contextRank as number, groupIndex: raw.groupIndex as number,
      reservationDigest: raw.reservationDigest as string, targetEligibleMinCardinality: raw.targetEligibleMinCardinality as number, representativeFixedSetId: raw.representativeFixedSetId as string,
      representativeFixedTargetWeaponIds: (raw.representativeFixedTargetWeaponIds as unknown[]).map(String), defaultSearchInputDigest: raw.defaultSearchInputDigest as string,
      searchInputDigest: raw.searchInputDigest as string, excludedRouteKeySha256: raw.excludedRouteKeySha256 as string | null, process: raw.process as string, record: raw.record as string | null,
      wallMs: raw.wallMs as number | null, searchElapsedMs: raw.searchElapsedMs as number | null, peakHeapBytes: raw.peakHeapBytes as number | null, peakRssBytes: raw.peakRssBytes as number | null,
      yields: raw.yields as number | null, termination: raw.termination as string | null, candidateCount: raw.candidateCount as number | null, deliveredCandidates: raw.deliveredCandidates as number | null,
      captureComplete: raw.captureComplete as boolean | null, safetyCapHit: raw.safetyCapHit as boolean | null, capturedCosts: (raw.capturedCosts as unknown[]).map(Number),
      compatible: raw.compatible as boolean, coverage: raw.coverage as string | null, firstExactIndex: raw.firstExactIndex as number | null, firstExactCost: raw.firstExactCost as number | null,
      hit: { C8: hit.C8 as boolean, C32: hit.C32 as boolean, C4C: hit.C4C as boolean }, extent: { ...(raw.extent as PlannerAlternativeSearchExtent) } })
  }
  if (taskRows.length !== reg.tasks || (json.taskRows as unknown[]).length !== reg.tasks) issues.push(`the B2-C2B2D RESULT holds ${taskRows.length} readable task rows, not ${reg.tasks}`)
  if (new Set(taskRows.map(t => t.taskId)).size !== taskRows.length) issues.push('a B2-C2B2D task row repeats')
  for (const target of targets) {
    const rows = taskRows.filter(t => t.targetWeaponId === target.targetWeaponId)
    if (rows.length !== 1) { issues.push(`${target.targetWeaponId}: ${rows.length} B2-C2B2D task rows, not 1`); continue }
    const row = rows[0]!
    if (row.taskId !== target.taskId || row.contextRank !== target.selectedRank || row.process !== target.process || !same(row.extent, target.tightExtent)) {
      issues.push(`${target.targetWeaponId}: the B2-C2B2D task row disagrees with its Target row`)
    }
    const probe = probes.find(p => p.targetWeaponId === target.targetWeaponId)
    if (!probe || probe.b2c1FirstCompatibleRank !== target.selectedRank || !same(probe.tightExtent, target.tightExtent)) issues.push(`${target.targetWeaponId}: the B2-C2B2D probe derivation disagrees with its Target row`)
    if (POLICIES.some(p => row.hit[p] !== (target.recovery !== 'none' && POLICIES.indexOf(p) >= POLICIES.indexOf(target.recovery as Policy)))) issues.push(`${target.targetWeaponId}: the B2-C2B2D hits disagree with its recovery`)
  }
  const exact = isObject(aggregates.exactTargets) ? aggregates.exactTargets : {}
  const exactTargets = { C8: exact.C8 as number, C32: exact.C32 as number, C4C: exact.C4C as number }
  if (!POLICIES.every(p => Number.isSafeInteger(exactTargets[p]))) issues.push('aggregates.exactTargets is not readable')
  for (const policy of POLICIES) if (taskRows.filter(t => t.hit[policy]).length !== exactTargets[policy]) issues.push(`aggregates.exactTargets.${policy} disagrees with the task rows`)
  const e1 = json.e1Aggregate as Json
  const common = isObject(e1.commonLadder) ? e1.commonLadder.total : null
  const diagnostic = isObject(e1.diagnostic) ? e1.diagnostic.total : null
  if (!TOTAL(common) || !TOTAL(diagnostic)) issues.push('e1Aggregate totals are not readable')
  if (issues.length > 0 || origins === null) return { valid: false, issues, authority: null }
  return { valid: true, issues: [], authority: { resultSha256, measuredHead: String(provenance.measuredHead), analysisHead: String(provenance.analysisHead), decisionCase: String(decision.case),
    evidenceGrade: String(provenance.evidenceGrade), b2c2b1ResultSha256: String(provenance.b2c2b1ResultSha256), b2c1ResultSha256: String(provenance.b2c1ResultSha256),
    b2b1ResultSha256: String(provenance.b2b1ResultSha256), b2c2b2bResultSha256: String(provenance.b2c2b2bResultSha256), b2c2b2cResultSha256: String(provenance.b2c2b2cResultSha256),
    exportSha256: String(provenance.exportSha256), probeManifestSha256: String(provenance.probeManifestSha256), stage1: conditions.stage1, origins, calculationContext: conditions.calculationContext,
    researchMaxPlanSteps: conditions.researchMaxPlanSteps as number, targetWeaponIds: targets.map(t => t.targetWeaponId), probes, targets, taskRows, exactTargets,
    e1: { commonLadder: structuredClone(common) as Phase2C26B2C2B2EB2C2B2DAuthority['e1']['commonLadder'], diagnostic: structuredClone(diagnostic) as Phase2C26B2C2B2EB2C2B2DAuthority['e1']['diagnostic'] } } }
}

// ---------------------------------------------------------------- the population (the B2-C2B2D Targets unmeasured and unrecovered)

/**
 * The population, mechanically from the B2-C2B2D RESULT: its Targets with `recovery = none` whose task process is `timeout` or
 * `out_of_memory`. Fails closed unless exactly 2 such Targets exist, exactly 2 B2-C2B2D Targets recovered (C8 / C32 / C4C), and no
 * B2-C2B2D Target is unrecovered for any other reason (completed without an exact, context mismatch, process failure, not run).
 */
export function phase2c26b2c2b2ePopulation(b2c2b2d: Phase2C26B2C2B2EB2C2B2DAuthority | null):
  { valid: boolean; issues: string[]; targetWeaponIds: string[]; previouslyUnrecovered: string[]; previouslyRecovered: string[]; otherwiseUnrecovered: string[] } {
  const reg = PHASE2C26B2C2B2E_REGISTERED_B2C2B2D
  if (b2c2b2d === null) return { valid: false, issues: ['no B2-C2B2D authority'], targetWeaponIds: [], previouslyUnrecovered: [], previouslyRecovered: [], otherwiseUnrecovered: [] }
  const issues: string[] = []
  if (b2c2b2d.resultSha256 !== reg.resultSha256) issues.push('the B2-C2B2D RESULT is not the registered one')
  const unmeasured = (process: string) => (reg.unmeasuredProcesses as readonly string[]).includes(process)
  const previouslyUnrecovered = b2c2b2d.targets.filter(t => t.recovery === 'none' && unmeasured(t.process) && !t.measured).map(t => t.targetWeaponId)
  const previouslyRecovered = b2c2b2d.targets.filter(t => t.recovery !== 'none').map(t => t.targetWeaponId)
  const otherwiseUnrecovered = b2c2b2d.targets.filter(t => t.recovery === 'none' && !previouslyUnrecovered.includes(t.targetWeaponId)).map(t => t.targetWeaponId)
  if (previouslyUnrecovered.length !== reg.previouslyUnrecovered || previouslyUnrecovered.length !== PHASE2C26B2C2B2E_TARGETS) issues.push(`${previouslyUnrecovered.length} B2-C2B2D Targets are unrecovered with a timeout / out-of-memory task, not ${reg.previouslyUnrecovered}`)
  if (previouslyRecovered.length !== reg.previouslyRecovered) issues.push(`${previouslyRecovered.length} B2-C2B2D Targets recovered, not ${reg.previouslyRecovered}`)
  if (otherwiseUnrecovered.length !== 0) issues.push(`${otherwiseUnrecovered.length} B2-C2B2D Targets are unrecovered for another reason`)
  if (previouslyUnrecovered.length + previouslyRecovered.length !== b2c2b2d.targets.length) issues.push('the unrecovered and recovered Targets do not partition the B2-C2B2D Targets')
  for (const t of b2c2b2d.targets) {
    const row = b2c2b2d.taskRows.find(r => r.targetWeaponId === t.targetWeaponId)
    if (previouslyUnrecovered.includes(t.targetWeaponId) && (row === undefined || row.record !== null || row.candidateCount !== null)) issues.push(`${t.targetWeaponId}: an unmeasured B2-C2B2D task carries a record or a Candidate count`)
  }
  const valid = issues.length === 0
  return { valid, issues, targetWeaponIds: valid ? [...previouslyUnrecovered].sort(compare) : [], previouslyUnrecovered, previouslyRecovered, otherwiseUnrecovered }
}

// ---------------------------------------------------------------- the probes (B2-C2B2D's, re-derived)

/** One probe with its authority detail (post hoc; only the probe itself goes into the manifest). */
export interface Phase2C26B2C2B2EProbeDerivation extends Phase2C26B2C2B2DProbeDerivation {
  b2c2b2dTaskId: string
  b2c2b2dProcess: string
  b2c2b2cSameContextProcess: string | null
}

/**
 * The probes of the population: B2-C2B2D's `phase2c26b2c2b2dProbes()` re-run over the B2-C2B1 / B2-C1 / B2-C2B2B / B2-C2B2C
 * authorities (its own checks included: the B2-C1 = B2-C2B1 = B2-C2B2C first compatible rank in 1..32, the tight extent
 * max(Production default, required) covering the required extent inside the bounds), required to equal the B2-C2B2D RESULT's
 * recorded probe derivations as a whole, and then per population Target the re-derived rank and tight extent must equal the
 * B2-C2B2D Target row and task row; the B2-C2B2D task ID is that task row's.
 */
export function phase2c26b2c2b2eProbes(b2c2b1: Phase2C26B2C2B2AB2C2B1Authority, b2c1: Phase2C26B2C2AB2C1Authority, b2c2b1Json: unknown,
  b2c2b2b: Phase2C26B2C2B2CB2C2B2BAuthority | null, b2c2b2c: Phase2C26B2C2B2DB2C2B2CAuthority | null, b2c2b2d: Phase2C26B2C2B2EB2C2B2DAuthority | null):
  { valid: boolean; issues: string[]; probes: Phase2C26B2C2B2EProbe[]; derivations: Phase2C26B2C2B2EProbeDerivation[]; population: ReturnType<typeof phase2c26b2c2b2ePopulation> } {
  const population = phase2c26b2c2b2ePopulation(b2c2b2d)
  const issues = population.issues.map(i => `population: ${i}`)
  const b2d = phase2c26b2c2b2dProbes(b2c2b1, b2c1, b2c2b1Json, b2c2b2b, b2c2b2c)
  issues.push(...b2d.issues.map(i => `b2c2b2d_probes: ${i}`))
  if (b2c2b2d !== null) {
    if (!same(b2d.derivations, b2c2b2d.probes)) issues.push('the re-derived B2-C2B2D probe derivations are not the ones the B2-C2B2D RESULT recorded')
    if (b2c2b2d.b2c2b1ResultSha256 !== b2c2b1.resultSha256) issues.push('the B2-C2B2D RESULT is not over this B2-C2B1 RESULT')
    if (b2c2b2d.exportSha256 !== b2c2b1.exportSha256) issues.push('the B2-C2B2D RESULT is not over this Export')
    if (b2c2b2c !== null && !same(b2c2b2d.targetWeaponIds, b2c2b2c.targetWeaponIds)) issues.push('the B2-C2B2D Targets are not the B2-C2B2C Targets')
  }
  const derivations: Phase2C26B2C2B2EProbeDerivation[] = []
  for (const id of population.targetWeaponIds) {
    const d = b2d.derivations.find(x => x.targetWeaponId === id)
    const target = b2c2b2d?.targets.find(t => t.targetWeaponId === id)
    const row = b2c2b2d?.taskRows.find(t => t.targetWeaponId === id)
    if (!d || !target || !row) { issues.push(`${id}: no re-derived probe / B2-C2B2D Target row / task row`); continue }
    if (d.b2c1FirstCompatibleRank !== target.selectedRank || d.b2c1FirstCompatibleRank !== row.contextRank) issues.push(`${id}: the re-derived rank ${String(d.b2c1FirstCompatibleRank)} is not B2-C2B2D's ${target.selectedRank} / ${row.contextRank}`)
    if (!same(d.tightExtent, target.tightExtent) || !same(d.tightExtent, row.extent)) issues.push(`${id}: the re-derived tight extent is not B2-C2B2D's`)
    if (row.taskId !== target.taskId) issues.push(`${id}: the B2-C2B2D task IDs disagree`)
    derivations.push({ ...structuredClone(d), b2c2b2dTaskId: row.taskId, b2c2b2dProcess: row.process, b2c2b2cSameContextProcess: target.b2c2b2cSameContextProcess })
  }
  if (derivations.length !== PHASE2C26B2C2B2E_TARGETS) issues.push(`${derivations.length} probes, not ${PHASE2C26B2C2B2E_TARGETS}`)
  const valid = issues.length === 0
  return { valid, issues, probes: valid ? derivations.map(d => ({ targetWeaponId: d.targetWeaponId, b2c2b2dTaskId: d.b2c2b2dTaskId, contextRank: d.b2c1FirstCompatibleRank!, extent: { ...d.tightExtent } })) : [],
    derivations, population }
}

/**
 * The probe manifest from the parsed authorities: per population Target (ascending) its Target ID, B2-C2B2D task ID, selected
 * P1 rank and tight extent, and nothing else (no expected key, Candidate index, operation cost, Route body, Search result,
 * required extent or B2-C2B2D measurement).
 */
export function phase2c26b2c2b2eProbeManifest(b2c2b1: Phase2C26B2C2B2AB2C2B1Authority, b2c1: Phase2C26B2C2AB2C1Authority, b2c2b1Json: unknown,
  b2c2b2b: Phase2C26B2C2B2CB2C2B2BAuthority | null, b2c2b2c: Phase2C26B2C2B2DB2C2B2CAuthority | null, b2c2b2d: Phase2C26B2C2B2EB2C2B2DAuthority | null): Phase2C26B2C2B2EProbeManifest {
  const derived = phase2c26b2c2b2eProbes(b2c2b1, b2c1, b2c2b1Json, b2c2b2b, b2c2b2c, b2c2b2d)
  if (!derived.valid || b2c2b2d === null) throw new Error(`The B2-C2B2E probes are not valid: ${derived.issues.join('; ')}`)
  return { phase: 'Issue #154 Phase 2-C2.6-B2-C2B2E probe manifest (the B2-C2B2D unmeasured unrecovered Targets; B2-C2B2D\'s P1 first compatible rank and tight extent per Target; oracle-guided diagnostic input)',
    sourceResultSha256: b2c2b1.resultSha256, b2c2b2dResultSha256: b2c2b2d.resultSha256, population: PHASE2C26B2C2B2E_PROBE_SOURCE.population, policy: 'P1',
    contextSelection: PHASE2C26B2C2B2E_CONTEXT_SELECTION.id, extentRule: PHASE2C26B2C2B2E_EXTENT_RULE.id, exportSha256: b2c2b1.exportSha256, probes: derived.probes }
}
