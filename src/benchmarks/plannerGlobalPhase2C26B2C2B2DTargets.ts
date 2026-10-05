/**
 * Issue #154 Phase 2-C2.6-B2-C2B2D: the E1 ∩ L2 population, its probes (selected P1 rank and tight extent per Target) and the
 * authority chain. Research only. Never import from Production, and never from the B2-C2B2D Search side (the Search module never
 * imports this one).
 *
 * Every input of a probe is oracle-derived and declared as such:
 *   - population: B2-C2B1 cohort E1 ∩ first ladder rung L2 (post-hoc oracle required extents), which must equal exactly the 4
 *     Targets the committed B2-C2B2C RESULT searched (`oracleGuidedTargetPopulation = true`);
 *   - context: the P1 rank B2-C1 recorded as first reservation-compatible (post-hoc oracle compatibility), which B2-C2B1 recorded
 *     too and the B2-C2B2C analyzer recomputed (`oracleGuidedContextSelection = true`);
 *   - extent: per stream max(Production default, B2-C2B1 recorded required extent) (`oracleInformedPerTargetExtent = true`,
 *     `targetIndividualOracleExtentAsSearchInput = true`).
 * The manifest built here carries Target ID, P1 rank and tight extent per Target and nothing else: no expected stable key,
 * Candidate index, operation cost, Route body or Search result. The analyzer reuses the parsers below after the run.
 */
import { stableStringify } from '../domain/models/hashing'
import { defaultPlannerAlternativeSearchExtent, type PlannerAlternativeSearchExtent } from '../domain/search'
import { phase2c26b2c2b1Covers } from './plannerGlobalPhase2C26B2C2B1Analysis'
import type { Phase2C26B2C2AB2C1Authority } from './plannerGlobalPhase2C26B2C2ATargets'
import type { Phase2C26B2C2B2AB2C2B1Authority } from './plannerGlobalPhase2C26B2C2B2ATargets'
import { phase2c26b2c2b2bRouteExtents, type Phase2C26B2C2B2BRouteExtent } from './plannerGlobalPhase2C26B2C2B2BTargets'
import { PHASE2C26B2C2B2C_EXTENT } from './plannerGlobalPhase2C26B2C2B2C'
import { phase2c26b2c2b2cPopulation, PHASE2C26B2C2B2C_REGISTERED_B2C2B2B, type Phase2C26B2C2B2CB2C2B2BAuthority } from './plannerGlobalPhase2C26B2C2B2CTargets'
import {
  phase2c26b2c2b2dExtentBoundIssues,
  PHASE2C26B2C2B2D_CONTEXT_SELECTION,
  PHASE2C26B2C2B2D_EXTENT_RULE,
  PHASE2C26B2C2B2D_MAX_CONTEXT_RANK,
  PHASE2C26B2C2B2D_PROBE_SOURCE,
  PHASE2C26B2C2B2D_TARGETS,
  type Phase2C26B2C2B2DProbe,
  type Phase2C26B2C2B2DProbeManifest,
} from './plannerGlobalPhase2C26B2C2B2D'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const COMMIT = /^[0-9a-f]{40}$/
const count = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0
const rankOrNull = (value: unknown) => value === null || (Number.isSafeInteger(value) && (value as number) >= 0)
const numberOrNull = (value: unknown) => value === null || (typeof value === 'number' && Number.isFinite(value))

// ---------------------------------------------------------------- the B2-C2B2C RESULT (the paired baseline: same Targets, common L2)

/** The B2-C2B2C RESULT (E1 ∩ L2 at the common L2 extent, P1 ranks 1..32, formal, INCOMPLETE with C4C 2 / 4) this phase pairs with. */
export const PHASE2C26B2C2B2D_REGISTERED_B2C2B2C = {
  resultSha256: 'b04ecace9ee6b5f36fe83e7680922d2d76c6cf4dfcdd677b408c856678313c9d',
  decisionCase: 'B2C2B2C_INCOMPLETE',
  evidenceGrade: 'formal',
  measuredHead: 'eb42e750041ee6bd2a2da51eaea02d15635757dc',
  targets: 4,
  tasks: 128,
  extent: { ...PHASE2C26B2C2B2C_EXTENT },
  scheduleExtent: { ...defaultPlannerAlternativeSearchExtent },
} as const

const PER_STREAM = (value: unknown) => isObject(value) && (['normal', 'gogma', 'skill'] as const).every(s => value[s] === null || (Number.isSafeInteger(value[s]) && (value[s] as number) >= 0))

/** One B2-C2B2C Target row as this phase needs it (post hoc; the Search never reads it). */
export interface Phase2C26B2C2B2DB2C2B2CTarget {
  targetWeaponId: string
  b2c1FirstCompatibleRank: number | null
  recomputedFirstCompatibleRank: number | null
  b2c2b1P1FirstCompatibleRank: number | null
  b2c2b1Required: Phase2C26B2C2B2BRouteExtent['required']
  recovery: 'C8' | 'C32' | 'C4C' | 'none'
  missClass: string | null
  firstExact: Record<'C8' | 'C32' | 'C4C', { contextRank: number | null; candidateIndex: number | null; operationCost: number | null }>
}

/** One B2-C2B2C task row as the paired comparison needs it. */
export interface Phase2C26B2C2B2DB2C2B2CTaskRow {
  taskId: string
  targetWeaponId: string
  contextRank: number
  groupIndex: number
  reservationDigest: string
  targetEligibleMinCardinality: number
  representativeFixedSetId: string
  representativeFixedTargetWeaponIds: string[]
  defaultSearchInputDigest: string
  searchInputDigest: string
  excludedRouteKeySha256: string | null
  process: string
  record: string | null
  wallMs: number | null
  searchElapsedMs: number | null
  peakHeapBytes: number | null
  peakRssBytes: number | null
  yields: number | null
  termination: string | null
  candidateCount: number | null
  deliveredCandidates: number | null
  captureComplete: boolean | null
  safetyCapHit: boolean | null
  capturedCosts: number[]
  compatible: boolean
  coverage: string | null
  firstExactIndex: number | null
  firstExactCost: number | null
  hit: Record<'C8' | 'C32' | 'C4C', boolean>
}

export interface Phase2C26B2C2B2DB2C2B2CAuthority {
  resultSha256: string
  measuredHead: string
  decisionCase: string
  evidenceGrade: string
  b2c2b1ResultSha256: string
  b2c1ResultSha256: string
  b2c2b2bResultSha256: string
  exportSha256: string
  extent: PlannerAlternativeSearchExtent
  scheduleExtent: PlannerAlternativeSearchExtent
  stage1: unknown
  origins: { skill: number; gogma: number }
  calculationContext: unknown
  researchMaxPlanSteps: number
  targetWeaponIds: string[]
  targets: Phase2C26B2C2B2DB2C2B2CTarget[]
  taskRows: Phase2C26B2C2B2DB2C2B2CTaskRow[]
  exactTargets: { C8: number; C32: number; C4C: number }
}

const TASK_STRINGS = ['taskId', 'targetWeaponId', 'reservationDigest', 'representativeFixedSetId', 'defaultSearchInputDigest', 'searchInputDigest', 'process'] as const
const TASK_INTEGERS = ['contextRank', 'groupIndex', 'targetEligibleMinCardinality'] as const

/**
 * Reads the committed B2-C2B2C RESULT as untrusted JSON and fails closed unless it is the registered formal baseline: its own
 * SHA-256; formal with verified launch provenance, not partial; the registered measured HEAD and case with no invalid reason;
 * the B2-C2B1 / B2-C1 / B2-C2B2B RESULTs and the Export of this phase; the common L2 Search extent and the default schedule
 * extent; 4 readable Target rows and 128 readable task rows (32 per Target, ranks 1..32), every task at L2, the exact Target
 * counts agreeing with the rows. Nothing here reaches the Search.
 */
export function parsePhase2C26B2C2B2DB2C2B2CAuthority(json: unknown, resultSha256: string,
  expected: { b2c2b1ResultSha256: string; b2c1ResultSha256: string; b2c2b2bResultSha256: string; exportSha256: string }):
  { valid: boolean; issues: string[]; authority: Phase2C26B2C2B2DB2C2B2CAuthority | null } {
  const reg = PHASE2C26B2C2B2D_REGISTERED_B2C2B2C
  const issues: string[] = []
  if (!isObject(json) || !isObject(json.provenance) || !isObject(json.decision) || !isObject(json.conditions) || !isObject(json.aggregates) || !Array.isArray(json.targets) || !Array.isArray(json.taskRows)) {
    return { valid: false, issues: ['B2-C2B2C RESULT lacks provenance / decision / conditions / aggregates / targets / taskRows'], authority: null }
  }
  const { provenance, decision, conditions, aggregates } = json
  if (resultSha256 !== reg.resultSha256) issues.push(`B2-C2B2C RESULT SHA-256 ${resultSha256} is not the registered ${reg.resultSha256}`)
  if (provenance.formal !== true || provenance.evidenceGrade !== reg.evidenceGrade || provenance.launchProvenanceVerified !== true) issues.push('the B2-C2B2C RESULT is not formal with verified launch provenance')
  if (provenance.partialRun !== false) issues.push('the B2-C2B2C RESULT is a partial run')
  if (typeof provenance.measuredHead !== 'string' || !COMMIT.test(provenance.measuredHead) || provenance.measuredHead !== reg.measuredHead) issues.push('provenance.measuredHead is not the registered B2-C2B2C measured HEAD')
  if (decision.case !== reg.decisionCase) issues.push(`decision.case ${String(decision.case)} is not ${reg.decisionCase}`)
  if (!Array.isArray(json.invalidReasons) || json.invalidReasons.length !== 0) issues.push('invalidReasons is not empty')
  if (provenance.b2c2b1ResultSha256 !== expected.b2c2b1ResultSha256) issues.push('provenance.b2c2b1ResultSha256 is not the B2-C2B1 RESULT of this phase')
  if (provenance.b2c1ResultSha256 !== expected.b2c1ResultSha256) issues.push('provenance.b2c1ResultSha256 is not the B2-C1 RESULT of this phase')
  if (provenance.b2c2b2bResultSha256 !== expected.b2c2b2bResultSha256) issues.push('provenance.b2c2b2bResultSha256 is not the B2-C2B2B RESULT of this phase')
  if (provenance.exportSha256 !== expected.exportSha256) issues.push('provenance.exportSha256 is not the Export of this phase')
  if (!same(conditions.searchExtent, reg.extent)) issues.push('conditions.searchExtent is not the common L2 extent')
  if (!same(conditions.scheduleExtent, reg.scheduleExtent)) issues.push('conditions.scheduleExtent is not the Production default extent')
  const origins = isObject(conditions.origins) && Number.isSafeInteger(conditions.origins.skill) && Number.isSafeInteger(conditions.origins.gogma)
    ? { skill: conditions.origins.skill as number, gogma: conditions.origins.gogma as number } : null
  if (origins === null) issues.push('conditions.origins is not readable')
  if (!isObject(conditions.calculationContext)) issues.push('conditions.calculationContext is not readable')
  if (!Number.isSafeInteger(conditions.researchMaxPlanSteps)) issues.push('conditions.researchMaxPlanSteps is not readable')
  if (!isObject(conditions.stage1)) issues.push('conditions.stage1 is not readable')

  const targets: Phase2C26B2C2B2DB2C2B2CTarget[] = []
  for (const raw of json.targets as unknown[]) {
    if (!isObject(raw) || typeof raw.targetWeaponId !== 'string' || !rankOrNull(raw.b2c1FirstCompatibleRank) || !rankOrNull(raw.recomputedFirstCompatibleRank) || !isObject(raw.policies)
      || !isObject(raw.b2c2b1) || !rankOrNull(raw.b2c2b1.p1FirstCompatibleRank) || !PER_STREAM(raw.b2c2b1.required) || !['C8', 'C32', 'C4C', 'none'].includes(raw.recovery as string)
      || !(raw.missClass === null || typeof raw.missClass === 'string')) {
      issues.push('a B2-C2B2C Target row is malformed'); continue
    }
    const firstExact = {} as Phase2C26B2C2B2DB2C2B2CTarget['firstExact']
    let ok = true
    for (const policy of ['C8', 'C32', 'C4C'] as const) {
      const p = raw.policies[policy]
      if (!isObject(p) || !rankOrNull(p.firstExactContextRank) || !rankOrNull(p.firstExactCandidateIndex) || !rankOrNull(p.firstExactOperationCost)) { ok = false; break }
      firstExact[policy] = { contextRank: p.firstExactContextRank as number | null, candidateIndex: p.firstExactCandidateIndex as number | null, operationCost: p.firstExactOperationCost as number | null }
    }
    if (!ok) { issues.push(`${raw.targetWeaponId}: the B2-C2B2C first exact rows are not readable`); continue }
    const required = raw.b2c2b1.required as Json
    targets.push({ targetWeaponId: raw.targetWeaponId, b2c1FirstCompatibleRank: raw.b2c1FirstCompatibleRank as number | null, recomputedFirstCompatibleRank: raw.recomputedFirstCompatibleRank as number | null,
      b2c2b1P1FirstCompatibleRank: raw.b2c2b1.p1FirstCompatibleRank as number | null,
      b2c2b1Required: { normal: required.normal as number | null, gogma: required.gogma as number | null, skill: required.skill as number | null },
      recovery: raw.recovery as Phase2C26B2C2B2DB2C2B2CTarget['recovery'], missClass: raw.missClass as string | null, firstExact })
  }
  if (targets.length !== reg.targets || (json.targets as unknown[]).length !== reg.targets) issues.push(`the B2-C2B2C RESULT holds ${targets.length} readable Targets, not ${reg.targets}`)
  if (new Set(targets.map(t => t.targetWeaponId)).size !== targets.length) issues.push('a B2-C2B2C Target repeats')
  if (!same(targets.map(t => t.targetWeaponId), [...targets.map(t => t.targetWeaponId)].sort(compare))) issues.push('the B2-C2B2C Target rows are not in ascending order')

  const taskRows: Phase2C26B2C2B2DB2C2B2CTaskRow[] = []
  for (const raw of json.taskRows as unknown[]) {
    if (!isObject(raw) || TASK_STRINGS.some(k => typeof raw[k] !== 'string') || TASK_INTEGERS.some(k => !Number.isSafeInteger(raw[k])) || !Array.isArray(raw.representativeFixedTargetWeaponIds)
      || !(raw.excludedRouteKeySha256 === null || typeof raw.excludedRouteKeySha256 === 'string') || !(raw.record === null || typeof raw.record === 'string')
      || !['wallMs', 'searchElapsedMs', 'peakHeapBytes', 'peakRssBytes', 'yields', 'candidateCount', 'deliveredCandidates', 'firstExactIndex', 'firstExactCost'].every(k => numberOrNull(raw[k]))
      || !(raw.termination === null || typeof raw.termination === 'string') || !(raw.coverage === null || typeof raw.coverage === 'string') || typeof raw.compatible !== 'boolean'
      || !(raw.captureComplete === null || typeof raw.captureComplete === 'boolean') || !(raw.safetyCapHit === null || typeof raw.safetyCapHit === 'boolean')
      || !Array.isArray(raw.capturedCosts) || !isObject(raw.hit) || !(['C8', 'C32', 'C4C'] as const).every(p => typeof (raw.hit as Json)[p] === 'boolean')
      || !(raw.extent === null || same(raw.extent, reg.extent))) {
      issues.push('a B2-C2B2C task row is malformed or not at the common L2 extent'); continue
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
      hit: { C8: hit.C8 as boolean, C32: hit.C32 as boolean, C4C: hit.C4C as boolean } })
  }
  if (taskRows.length !== reg.tasks || (json.taskRows as unknown[]).length !== reg.tasks) issues.push(`the B2-C2B2C RESULT holds ${taskRows.length} readable task rows, not ${reg.tasks}`)
  if (new Set(taskRows.map(t => t.taskId)).size !== taskRows.length) issues.push('a B2-C2B2C task row repeats')
  for (const target of targets) {
    if (!same(taskRows.filter(t => t.targetWeaponId === target.targetWeaponId).map(t => t.contextRank).sort((a, b) => a - b), Array.from({ length: 32 }, (_, i) => i + 1))) {
      issues.push(`${target.targetWeaponId}: the B2-C2B2C task rows are not ranks 1..32`)
    }
  }
  const exact = isObject(aggregates.exactTargets) ? aggregates.exactTargets : {}
  const exactTargets = { C8: exact.C8 as number, C32: exact.C32 as number, C4C: exact.C4C as number }
  if (![exactTargets.C8, exactTargets.C32, exactTargets.C4C].every(count)) issues.push('aggregates.exactTargets is not readable')
  for (const policy of ['C8', 'C32', 'C4C'] as const) if (targets.filter(t => t.firstExact[policy].contextRank !== null).length !== exactTargets[policy]) issues.push(`aggregates.exactTargets.${policy} disagrees with the Target rows`)
  if (issues.length > 0 || origins === null) return { valid: false, issues, authority: null }
  return { valid: true, issues: [], authority: { resultSha256, measuredHead: String(provenance.measuredHead), decisionCase: String(decision.case), evidenceGrade: String(provenance.evidenceGrade),
    b2c2b1ResultSha256: String(provenance.b2c2b1ResultSha256), b2c1ResultSha256: String(provenance.b2c1ResultSha256), b2c2b2bResultSha256: String(provenance.b2c2b2bResultSha256),
    exportSha256: String(provenance.exportSha256), extent: { ...reg.extent }, scheduleExtent: { ...reg.scheduleExtent }, stage1: conditions.stage1, origins, calculationContext: conditions.calculationContext,
    researchMaxPlanSteps: conditions.researchMaxPlanSteps as number, targetWeaponIds: targets.map(t => t.targetWeaponId), targets, taskRows, exactTargets } }
}

// ---------------------------------------------------------------- the E1 ∩ L2 population (= the B2-C2B2C Targets)

/**
 * The E1 ∩ L2 population: B2-C2B2C's population function, unchanged (E1 = L1 7 (the B2-C2B2B Targets) + L2 4, overlap 0,
 * union 11; the L2 Routes' required extents fit L2 and not L1), and then exactly the 4 Targets the B2-C2B2C RESULT searched.
 */
export function phase2c26b2c2b2dPopulation(b2c2b1: Phase2C26B2C2B2AB2C2B1Authority, b2c1: Phase2C26B2C2AB2C1Authority, b2c2b1Json: unknown,
  b2c2b2b: Phase2C26B2C2B2CB2C2B2BAuthority | null, b2c2b2c: Phase2C26B2C2B2DB2C2B2CAuthority | null):
  { valid: boolean; issues: string[]; targetWeaponIds: string[]; split: { e1: string[]; l1: string[]; l2: string[]; overlap: number; union: number } } {
  const base = phase2c26b2c2b2cPopulation(b2c2b1, b2c1, b2c2b1Json, b2c2b2b)
  const issues = base.issues.map(i => `e1_l2_population: ${i}`)
  if (b2c2b1.resultSha256 !== PHASE2C26B2C2B2D_PROBE_SOURCE.resultSha256) issues.push('the B2-C2B1 RESULT is not the registered one')
  if (base.split.e1.length !== 11 || base.split.l1.length !== 7 || base.split.l2.length !== PHASE2C26B2C2B2D_TARGETS || base.split.overlap !== 0 || base.split.union !== 11) {
    issues.push(`the E1 split is not E1 11 = L1 7 + L2 ${PHASE2C26B2C2B2D_TARGETS} (overlap 0, union 11)`)
  }
  if (b2c2b2b !== null && b2c2b2b.resultSha256 !== PHASE2C26B2C2B2C_REGISTERED_B2C2B2B.resultSha256) issues.push('the B2-C2B2B RESULT is not the registered one')
  if (b2c2b2c === null) issues.push('no B2-C2B2C authority')
  else {
    if (!same(b2c2b2c.targetWeaponIds, base.split.l2)) issues.push('the B2-C2B2C RESULT Targets are not E1 ∩ L2')
    if (b2c2b2c.b2c2b1ResultSha256 !== b2c2b1.resultSha256) issues.push('the B2-C2B2C RESULT is not over this B2-C2B1 RESULT')
    if (b2c2b2c.exportSha256 !== b2c2b1.exportSha256) issues.push('the B2-C2B2C RESULT is not over this Export')
  }
  const valid = issues.length === 0
  return { valid, issues, targetWeaponIds: valid ? [...base.split.l2] : [], split: base.split }
}

// ---------------------------------------------------------------- the tight extent rule (oracle-informed, per Target)

const STREAM_KEY = { normal: 'maxNormalAdvance', gogma: 'maxGogmaAdvance', skill: 'maxSkillAdvance' } as const

/**
 * The registered tight extent of one Route: per stream max(Production default, recorded required extent); a stream the Route
 * does not operate on (required = null) keeps the Production default. Never narrower than Production; by construction it
 * covers the required extent under the B2-A / B2-C2B1 judgement (required <= extent).
 */
export function phase2c26b2c2b2dTightExtent(required: Phase2C26B2C2B2BRouteExtent['required']): PlannerAlternativeSearchExtent {
  const pick = (stream: keyof typeof STREAM_KEY) => {
    const floor = defaultPlannerAlternativeSearchExtent[STREAM_KEY[stream]]
    const value = required[stream]
    return value === null ? floor : Math.max(floor, value)
  }
  return { maxNormalAdvance: pick('normal'), maxGogmaAdvance: pick('gogma'), maxSkillAdvance: pick('skill') }
}

/** One probe with its authority detail (post hoc; only the probe itself goes into the manifest). */
export interface Phase2C26B2C2B2DProbeDerivation {
  targetWeaponId: string
  b2c1FirstCompatibleRank: number | null
  b2c2b1P1FirstCompatibleRank: number | null
  b2c2b2cRecomputedFirstCompatibleRank: number | null
  required: Phase2C26B2C2B2BRouteExtent['required']
  tightExtent: PlannerAlternativeSearchExtent
  commonL2Extent: PlannerAlternativeSearchExtent
  /** Per stream `tight - commonL2` (<= 0) and the ratio tight / commonL2. */
  extentDeltaFromCommonL2: { maxNormalAdvance: number; maxGogmaAdvance: number; maxSkillAdvance: number }
  extentRatioToCommonL2: { maxNormalAdvance: number; maxGogmaAdvance: number; maxSkillAdvance: number }
  strictlySmallerStreams: ('maxNormalAdvance' | 'maxGogmaAdvance' | 'maxSkillAdvance')[]
}

/**
 * The probes of the population, derived mechanically and cross-checked: the selected rank is B2-C1's recorded P1 first
 * compatible rank, which must equal B2-C2B1's recorded rank and the B2-C2B2C analyzer's recomputed rank and lie in 1..32; the
 * required extent is B2-C2B1's recorded one (B2-C2B2C recorded the same); the tight extent is the registered rule, which must
 * cover the required extent (phase2c26b2c2b1Covers), stay inside the bounds (Production default <= tight <= common L2, strictly
 * smaller than common L2 somewhere) and differ from the Production default (an E1 Route is extent-insufficient).
 */
export function phase2c26b2c2b2dProbes(b2c2b1: Phase2C26B2C2B2AB2C2B1Authority, b2c1: Phase2C26B2C2AB2C1Authority, b2c2b1Json: unknown,
  b2c2b2b: Phase2C26B2C2B2CB2C2B2BAuthority | null, b2c2b2c: Phase2C26B2C2B2DB2C2B2CAuthority | null):
  { valid: boolean; issues: string[]; probes: Phase2C26B2C2B2DProbe[]; derivations: Phase2C26B2C2B2DProbeDerivation[]; population: ReturnType<typeof phase2c26b2c2b2dPopulation> } {
  const population = phase2c26b2c2b2dPopulation(b2c2b1, b2c1, b2c2b1Json, b2c2b2b, b2c2b2c)
  const issues = [...population.issues]
  const ids = population.split.l2
  const extents = phase2c26b2c2b2bRouteExtents(b2c2b1Json, ids)
  issues.push(...extents.issues)
  const derivations: Phase2C26B2C2B2DProbeDerivation[] = []
  const l2 = PHASE2C26B2C2B2C_EXTENT
  for (const id of ids) {
    const b2c1Rank = b2c1.routes.find(r => r.targetWeaponId === id)?.p1FirstCompatible.rank ?? null
    const b2c2b1Rank = b2c2b1.routes.find(r => r.targetWeaponId === id)?.p1FirstCompatibleRank ?? null
    const c = b2c2b2c?.targets.find(t => t.targetWeaponId === id)
    const route = extents.routes.find(r => r.targetWeaponId === id)
    if (!route) { issues.push(`${id}: no B2-C2B1 required extent`); continue }
    if (b2c1Rank === null || !Number.isSafeInteger(b2c1Rank) || b2c1Rank < 1 || b2c1Rank > PHASE2C26B2C2B2D_MAX_CONTEXT_RANK) issues.push(`${id}: the B2-C1 P1 first compatible rank ${String(b2c1Rank)} is not in 1..${PHASE2C26B2C2B2D_MAX_CONTEXT_RANK}`)
    if (b2c2b1Rank !== b2c1Rank) issues.push(`${id}: the B2-C2B1 recorded P1 first compatible rank ${String(b2c2b1Rank)} is not B2-C1's ${String(b2c1Rank)}`)
    if (!c) issues.push(`${id}: no B2-C2B2C Target row`)
    else {
      if (c.b2c1FirstCompatibleRank !== b2c1Rank || c.recomputedFirstCompatibleRank !== b2c1Rank || c.b2c2b1P1FirstCompatibleRank !== b2c1Rank) issues.push(`${id}: the B2-C2B2C first compatible ranks disagree with B2-C1's ${String(b2c1Rank)}`)
      if (!same(c.b2c2b1Required, route.required)) issues.push(`${id}: the B2-C2B2C copy of the B2-C2B1 required extent differs`)
    }
    const tight = phase2c26b2c2b2dTightExtent(route.required)
    if (!phase2c26b2c2b1Covers(route.required, tight)) issues.push(`${id}: the tight extent does not cover the required extent`)
    issues.push(...phase2c26b2c2b2dExtentBoundIssues(tight).map(i => `${id}: ${i}`))
    if (same(tight, { ...defaultPlannerAlternativeSearchExtent })) issues.push(`${id}: the tight extent is the Production default (not an extent-insufficient Route)`)
    if (phase2c26b2c2b1Covers(route.required, { ...defaultPlannerAlternativeSearchExtent })) issues.push(`${id}: the required extent fits the Production default`)
    const keys = ['maxNormalAdvance', 'maxGogmaAdvance', 'maxSkillAdvance'] as const
    derivations.push({ targetWeaponId: id, b2c1FirstCompatibleRank: b2c1Rank, b2c2b1P1FirstCompatibleRank: b2c2b1Rank, b2c2b2cRecomputedFirstCompatibleRank: c?.recomputedFirstCompatibleRank ?? null,
      required: { ...route.required }, tightExtent: tight, commonL2Extent: { ...l2 },
      extentDeltaFromCommonL2: Object.fromEntries(keys.map(k => [k, tight[k] - l2[k]])) as Phase2C26B2C2B2DProbeDerivation['extentDeltaFromCommonL2'],
      extentRatioToCommonL2: Object.fromEntries(keys.map(k => [k, tight[k] / l2[k]])) as Phase2C26B2C2B2DProbeDerivation['extentRatioToCommonL2'],
      strictlySmallerStreams: keys.filter(k => tight[k] < l2[k]) })
  }
  if (derivations.length !== PHASE2C26B2C2B2D_TARGETS) issues.push(`${derivations.length} probes, not ${PHASE2C26B2C2B2D_TARGETS}`)
  const valid = issues.length === 0
  return { valid, issues, probes: valid ? derivations.map(d => ({ targetWeaponId: d.targetWeaponId, contextRank: d.b2c1FirstCompatibleRank!, extent: { ...d.tightExtent } })) : [],
    derivations, population }
}

/**
 * The probe manifest from the parsed authorities: per E1 ∩ L2 Target (ascending) its Target ID, selected P1 rank and tight
 * extent, and nothing else (no expected key, Candidate index, operation cost, Route body, Search result or required extent).
 */
export function phase2c26b2c2b2dProbeManifest(b2c2b1: Phase2C26B2C2B2AB2C2B1Authority, b2c1: Phase2C26B2C2AB2C1Authority, b2c2b1Json: unknown,
  b2c2b2b: Phase2C26B2C2B2CB2C2B2BAuthority | null, b2c2b2c: Phase2C26B2C2B2DB2C2B2CAuthority | null): Phase2C26B2C2B2DProbeManifest {
  const derived = phase2c26b2c2b2dProbes(b2c2b1, b2c1, b2c2b1Json, b2c2b2b, b2c2b2c)
  if (!derived.valid) throw new Error(`The B2-C2B2D probes are not valid: ${derived.issues.join('; ')}`)
  return { phase: 'Issue #154 Phase 2-C2.6-B2-C2B2D probe manifest (E1 ∩ L2; per Target the B2-C1 P1 first compatible rank and the tight extent; oracle-guided diagnostic input)',
    sourceResultSha256: b2c2b1.resultSha256, population: 'E1_L2', policy: 'P1', contextSelection: PHASE2C26B2C2B2D_CONTEXT_SELECTION.id, extentRule: PHASE2C26B2C2B2D_EXTENT_RULE.id,
    exportSha256: b2c2b1.exportSha256, probes: derived.probes }
}
