/**
 * Issue #154 Phase 2-C2.6-B2-C2B2K: the authorities (the committed B2-C2B2E RESULT - the paired before authority and the population
 * source - and the committed B2-C2B2I / B2-C2B2J RESULTs - the authority of the optimized Production state), the population (the
 * B2-C2B2E Target with process timeout, recovery none and next-branch type time_bound), its probe and expected Search input identity,
 * the adopted optimizations and the Production calculation source audit. Research only. Never import from Production, and never from
 * the B2-C2B2K Search side's child calculation (the runner reads the manifest built here, not a RESULT, for the Search input).
 *
 * Nothing about the population is written down here: the Target, task, rank, extent, group, digests and excluded Route key come from
 * the RESULTs, and every value is cross-checked between the B2-C2B2E RESULT (by B2-C2B2F's own population rule) and the B2-C2B2I /
 * B2-C2B2J RESULTs, which searched the same Target in the same Search input.
 */
import { stableStringify } from '../domain/models/hashing'
import type { PlannerAlternativeSearchExtent } from '../domain/search'
import type { Phase2C26B2C2B2DB2C2B2CTaskRow } from './plannerGlobalPhase2C26B2C2B2DTargets'
import type { Phase2C26B2C2B2EProbe } from './plannerGlobalPhase2C26B2C2B2E'
import { PHASE2C26B2C2B2F_IDENTITY_FIELDS, type Phase2C26B2C2B2FTaskIdentity } from './plannerGlobalPhase2C26B2C2B2F'
import {
  parsePhase2C26B2C2B2FB2C2B2EAuthority,
  phase2c26b2c2b2fPopulation,
  PHASE2C26B2C2B2F_REGISTERED_B2C2B2E,
  type Phase2C26B2C2B2FB2C2B2EAuthority,
} from './plannerGlobalPhase2C26B2C2B2FTargets'
import { PHASE2C26B2C2B2I_OPTIMIZATION } from './plannerGlobalPhase2C26B2C2B2I'
import { phase2c26b2c2b2jProductionChangedFiles, PHASE2C26B2C2B2J_OPTIMIZATION } from './plannerGlobalPhase2C26B2C2B2J'
import {
  parsePhase2C26B2C2B2JB2C2B2IAuthority,
  PHASE2C26B2C2B2J_REGISTERED_B2C2B2I,
  type Phase2C26B2C2B2JB2C2B2IAuthority,
} from './plannerGlobalPhase2C26B2C2B2JTargets'
import {
  PHASE2C26B2C2B2K_CONTEXT_SELECTION,
  PHASE2C26B2C2B2K_EXPECTED_TASKS,
  PHASE2C26B2C2B2K_EXTENT_RULE,
  PHASE2C26B2C2B2K_POPULATION,
  PHASE2C26B2C2B2K_STAGE1,
  type Phase2C26B2C2B2KAdoptedOptimization,
  type Phase2C26B2C2B2KProbeManifest,
  type Phase2C26B2C2B2KProductionAudit,
} from './plannerGlobalPhase2C26B2C2B2K'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}
const SHA256 = /^[0-9a-f]{64}$/
const COMMIT = /^[0-9a-f]{40}$/
const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const allTrue = (value: unknown) => isObject(value) && Object.keys(value).length > 0 && Object.values(value).every(v => v === true)
type Policy = 'C8' | 'C32' | 'C4C'
const POLICIES: readonly Policy[] = ['C8', 'C32', 'C4C']

// ---------------------------------------------------------------- registered authorities

/** The B2-C2B2E RESULT (formal, B2C2B2E_INCOMPLETE, branch C): B2-C2B2F's registered one, the paired before authority of this phase. */
export const PHASE2C26B2C2B2K_REGISTERED_B2C2B2E = PHASE2C26B2C2B2F_REGISTERED_B2C2B2E
/** The B2-C2B2I RESULT (formal, B2C2B2I_ADOPTED): B2-C2B2J's registered before authority. */
export const PHASE2C26B2C2B2K_REGISTERED_B2C2B2I = PHASE2C26B2C2B2J_REGISTERED_B2C2B2I
/** The B2-C2B2J RESULT (formal, B2C2B2J_ADOPTED): the authority of the current optimized Production state. */
export const PHASE2C26B2C2B2K_REGISTERED_B2C2B2J = {
  resultSha256: '4e5c9b0bfb2336e5f9ed0228d5169373bcdd78c6a976f1532e02779bf9708750',
  decisionCase: 'B2C2B2J_ADOPTED',
  evidenceGrade: 'formal',
  measuredHead: '4ed9fb9ff93490f04178c50844b9eb5e2e95fb8e',
  optimizationId: PHASE2C26B2C2B2J_OPTIMIZATION.id,
  b2c2b2iResultSha256: PHASE2C26B2C2B2J_REGISTERED_B2C2B2I.resultSha256,
  b2c2b2eResultSha256: PHASE2C26B2C2B2F_REGISTERED_B2C2B2E.resultSha256,
  targets: 1,
} as const
/** The B2-C2B2E raw evidence the B2-C2B2E RESULT recorded and the parent hashes locally before a formal launch. */
export const PHASE2C26B2C2B2K_B2C2B2E_EVIDENCE = ['run', 'startAttestation', 'probeManifest'] as const
export type Phase2C26B2C2B2KB2C2B2EEvidence = typeof PHASE2C26B2C2B2K_B2C2B2E_EVIDENCE[number]

// ---------------------------------------------------------------- B2-C2B2E (paired before authority, population source)

/** One side of a paired comparison as the B2-C2B2E RESULT recorded it for its own run of the Target. */
export interface Phase2C26B2C2B2KPairedSide {
  process: string
  budgetMs: number | null
  childHeapMb: number | null
  wallMs: number | null
  searchElapsedMs: number | null
  peakHeapBytes: number | null
  peakRssBytes: number | null
  yields: number | null
  termination: string | null
  deliveredCandidates: number | null
  candidateCount: number | null
  safetyCapHit: boolean | null
  hit: Record<Policy, boolean>
  firstExactIndex: number | null
  firstExactCost: number | null
}

/** The B2-C2B2E facts of this phase beyond B2-C2B2F's parse (post hoc and parent-side; the Search never reads them). */
export interface Phase2C26B2C2B2KB2C2B2EFacts {
  /** The population Target's B2-C2B2E task row (identity, process, record) - the Search input this phase must reproduce. */
  taskRow: Phase2C26B2C2B2DB2C2B2CTaskRow & { extent: PlannerAlternativeSearchExtent; budgetMs: number | null }
  /** The excluded current Route key SHA-256 B2-C2B2E re-derived for that pair (and the one B2-C2B2D re-derived). */
  rederivedExcludedRouteKeySha256: string
  /** B2-C2B2E's own run of the Target: process, budget, heap, wall, peak heap / RSS, yields (all from the RESULT). */
  b2c2b2e: Phase2C26B2C2B2KPairedSide
  type: string
  missClass: string | null
  trajectory: unknown
  oracleOperationCost: number | null
  /** B2-C2B2E's E1 aggregate: the common ladder and the oracle-guided diagnostic totals, its L1 / L2 split. */
  e1: { e1Total: number; commonLadder: Record<Policy, { recovered: number; of: number }>; diagnostic: Record<Policy, { recovered: number; of: number }>;
    l1: Record<Policy, number>; l2: Record<Policy, number>; l1Population: number; l2Population: number; allRecovered: boolean }
  /** The B2-C2B2E raw evidence files as its RESULT recorded them. */
  evidence: Record<Phase2C26B2C2B2KB2C2B2EEvidence, { file: string; sha256: string }>
  rngEngineVersion: string
  calculationContext: unknown
  researchMaxPlanSteps: number
  origins: unknown
}

const TOTAL = (value: unknown): value is Record<Policy, { recovered: number; of: number }> =>
  isObject(value) && POLICIES.every(p => isObject(value[p]) && Number.isSafeInteger((value[p] as Json).recovered) && Number.isSafeInteger((value[p] as Json).of))
const COUNTS = (value: unknown): value is Record<Policy, number> => isObject(value) && POLICIES.every(p => Number.isSafeInteger(value[p]))
const pairedSide = (raw: unknown): Phase2C26B2C2B2KPairedSide | null => {
  if (!isObject(raw) || typeof raw.process !== 'string' || !isObject(raw.hit) || !POLICIES.every(p => typeof (raw.hit as Json)[p] === 'boolean')) return null
  const hit = raw.hit as Json
  return { process: raw.process, budgetMs: num(raw.budgetMs), childHeapMb: num(raw.childHeapMb), wallMs: num(raw.wallMs), searchElapsedMs: num(raw.searchElapsedMs),
    peakHeapBytes: num(raw.peakHeapBytes), peakRssBytes: num(raw.peakRssBytes), yields: num(raw.yields), termination: typeof raw.termination === 'string' ? raw.termination : null,
    deliveredCandidates: num(raw.deliveredCandidates), candidateCount: num(raw.candidateCount), safetyCapHit: typeof raw.safetyCapHit === 'boolean' ? raw.safetyCapHit : null,
    hit: { C8: hit.C8 as boolean, C32: hit.C32 as boolean, C4C: hit.C4C as boolean }, firstExactIndex: num(raw.firstExactIndex), firstExactCost: num(raw.firstExactCost) }
}

/**
 * Reads the committed B2-C2B2E RESULT as the paired before authority: B2-C2B2F's parse (`parsePhase2C26B2C2B2FB2C2B2EAuthority()`: the
 * registered SHA-256, formal with verified launch provenance, not partial, B2C2B2E_INCOMPLETE with no invalid reason, B2-C2B2E's Stage 1
 * of 60 minutes / 12,288 MB, an all-true hash chain, branch C with unambiguous types) and B2-C2B2F's population rule
 * (`phase2c26b2c2b2fPopulation()`: exactly one next-branch row of type time_bound with result timeout, whose Target row is an unmeasured,
 * unrecovered timeout with a verified paired identity and excluded Route, whose task row is a timeout with no record and no Candidate
 * count at B2-C2B2E's budget, the probe derivation and the start-attested probe agreeing). On top it reads, for the population Target,
 * B2-C2B2E's own run of it (process timeout, the B2-C2B2E budget and heap, no Search field, no hit), its task row, its re-derived
 * excluded Route key, its trajectory, the E1 aggregate (common ladder and oracle-guided diagnostic, with this Target counted as
 * unrecovered) and the raw evidence files the RESULT recorded. Nothing here reaches the Search.
 */
export function parsePhase2C26B2C2B2KB2C2B2EAuthority(json: unknown, resultSha256: string): {
  valid: boolean; issues: string[]; authority: Phase2C26B2C2B2FB2C2B2EAuthority | null; population: ReturnType<typeof phase2c26b2c2b2fPopulation> | null; facts: Phase2C26B2C2B2KB2C2B2EFacts | null
} {
  const parsed = parsePhase2C26B2C2B2FB2C2B2EAuthority(json, resultSha256)
  if (!parsed.valid || parsed.authority === null || !isObject(json)) return { valid: false, issues: parsed.issues.map(i => `b2c2b2e: ${i}`), authority: null, population: null, facts: null }
  const issues: string[] = []
  const population = phase2c26b2c2b2fPopulation(parsed.authority)
  issues.push(...population.issues.map(i => `population: ${i}`))
  if (population.targetWeaponIds.length !== PHASE2C26B2C2B2K_EXPECTED_TASKS) issues.push(`the B2-C2B2E population holds ${population.targetWeaponIds.length} Targets, not ${PHASE2C26B2C2B2K_EXPECTED_TASKS}`)
  if (!same(parsed.authority.stage1, PHASE2C26B2C2B2K_STAGE1)) issues.push('the B2-C2B2E Stage 1 is not this phase\'s Stage 1')
  const id = population.targetWeaponIds[0] ?? null
  const targetRaw = (json.targets as unknown[]).filter(isObject).find(t => t.targetWeaponId === id)
  const taskRaw = (json.taskRows as unknown[]).filter(isObject).find(t => t.targetWeaponId === id)
  if (id === null || targetRaw === undefined || taskRaw === undefined) return { valid: false, issues: [...issues, 'no B2-C2B2E Target / task row for the population Target'], authority: parsed.authority, population, facts: null }
  const paired = isObject(targetRaw.paired) ? targetRaw.paired : {}
  const ours = pairedSide(paired.b2c2b2e)
  if (ours === null) issues.push('the B2-C2B2E paired side of the population Target is not readable')
  else {
    if (ours.process !== 'timeout' || ours.budgetMs !== PHASE2C26B2C2B2K_STAGE1.budgetMs || ours.childHeapMb !== PHASE2C26B2C2B2K_STAGE1.childHeapMb) issues.push('the B2-C2B2E run of the population Target is not a timeout at 60 minutes / 12,288 MB')
    if (ours.candidateCount !== null || ours.searchElapsedMs !== null || ours.termination !== null || POLICIES.some(p => ours.hit[p])) issues.push('the B2-C2B2E run of the population Target carries a Search result or a hit')
    if (ours.wallMs === null || ours.peakHeapBytes === null || ours.peakRssBytes === null || ours.yields === null) issues.push('the B2-C2B2E run of the population Target lacks its wall / peak heap / peak RSS / yields')
  }
  if (!POLICIES.every(p => isObject(targetRaw.hit) && (targetRaw.hit as Json)[p] === false)) issues.push('the B2-C2B2E Target row of the population Target holds a hit')
  const identity = isObject(paired.identity) ? paired.identity : {}
  const route = isObject(identity.excludedRouteKeyComparison) ? identity.excludedRouteKeyComparison : {}
  const routeSha = typeof route.rederivedExcludedRouteKeySha256 === 'string' && SHA256.test(route.rederivedExcludedRouteKeySha256) ? route.rederivedExcludedRouteKeySha256 : null
  if (identity.matches !== true || route.verified !== true || routeSha === null || route.b2c2b2dRederivedExcludedRouteKeySha256 !== routeSha) issues.push('the B2-C2B2E excluded current Route of the population Target is not one verified re-derived key')
  const strings = ['taskId', 'targetWeaponId', 'reservationDigest', 'representativeFixedSetId', 'defaultSearchInputDigest', 'searchInputDigest', 'process'] as const
  if (strings.some(k => typeof taskRaw[k] !== 'string') || !['contextRank', 'groupIndex', 'targetEligibleMinCardinality'].every(k => Number.isSafeInteger(taskRaw[k]))
    || !Array.isArray(taskRaw.representativeFixedTargetWeaponIds) || !isObject(taskRaw.extent) || !isObject(taskRaw.hit)) issues.push('the B2-C2B2E task row of the population Target is malformed')
  if (taskRaw.excludedRouteKeySha256 !== null || taskRaw.record !== null || taskRaw.candidateCount !== null) issues.push('the B2-C2B2E task row of the population Target carries a record')
  const e1 = isObject(json.e1Aggregate) ? json.e1Aggregate : {}
  const common = isObject(e1.commonLadder) ? e1.commonLadder.total : null
  const diagnostic = isObject(e1.diagnostic) ? e1.diagnostic : {}
  const l1 = isObject(diagnostic.l1) ? diagnostic.l1 : {}
  const l2 = isObject(diagnostic.l2) ? diagnostic.l2 : {}
  if (!TOTAL(common) || !TOTAL(diagnostic.total) || !COUNTS(l1.exactTargets) || !COUNTS(l2.exactTargets) || !Number.isSafeInteger(e1.e1Total)
    || !Number.isSafeInteger(l1.population) || !Number.isSafeInteger(l2.population) || typeof diagnostic.allRecovered !== 'boolean') issues.push('the B2-C2B2E e1Aggregate is not readable')
  else {
    const total = diagnostic.total as Record<Policy, { recovered: number; of: number }>
    for (const p of POLICIES) {
      if (total[p].of !== e1.e1Total || total[p].recovered !== (l1.exactTargets as Record<Policy, number>)[p] + (l2.exactTargets as Record<Policy, number>)[p]) issues.push(`the B2-C2B2E diagnostic ${p} total is not L1 + L2`)
    }
    if ((l1.population as number) + (l2.population as number) !== e1.e1Total) issues.push('the B2-C2B2E L1 / L2 populations do not sum to E1')
    if (total.C4C.recovered >= (e1.e1Total as number) || diagnostic.allRecovered !== false) issues.push('the B2-C2B2E diagnostic aggregate already recovered every E1 Target')
    if (!Array.isArray(e1.issues) || e1.issues.length !== 0) issues.push('the B2-C2B2E e1Aggregate has issues')
  }
  const sources = isObject(json.sources) ? json.sources : {}
  const evidence = {} as Record<Phase2C26B2C2B2KB2C2B2EEvidence, { file: string; sha256: string }>
  for (const name of PHASE2C26B2C2B2K_B2C2B2E_EVIDENCE) {
    const source = sources[name]
    if (!isObject(source) || typeof source.file !== 'string' || typeof source.sha256 !== 'string' || !SHA256.test(source.sha256)) issues.push(`sources.${name} is not a file record`)
    else evidence[name] = { file: source.file, sha256: source.sha256 }
  }
  const environment = isObject(json.environment) ? json.environment : {}
  if (typeof environment.rngEngineVersion !== 'string') issues.push('environment.rngEngineVersion is not readable')
  if (issues.length > 0 || ours === null || routeSha === null) return { valid: false, issues, authority: parsed.authority, population, facts: null }
  const hit = taskRaw.hit as Json
  const taskRow = { taskId: taskRaw.taskId as string, targetWeaponId: taskRaw.targetWeaponId as string, contextRank: taskRaw.contextRank as number, groupIndex: taskRaw.groupIndex as number,
    reservationDigest: taskRaw.reservationDigest as string, targetEligibleMinCardinality: taskRaw.targetEligibleMinCardinality as number, representativeFixedSetId: taskRaw.representativeFixedSetId as string,
    representativeFixedTargetWeaponIds: (taskRaw.representativeFixedTargetWeaponIds as unknown[]).map(String), defaultSearchInputDigest: taskRaw.defaultSearchInputDigest as string,
    searchInputDigest: taskRaw.searchInputDigest as string, excludedRouteKeySha256: null, process: taskRaw.process as string, record: null, wallMs: num(taskRaw.wallMs),
    searchElapsedMs: num(taskRaw.searchElapsedMs), peakHeapBytes: num(taskRaw.peakHeapBytes), peakRssBytes: num(taskRaw.peakRssBytes), yields: num(taskRaw.yields), termination: null,
    candidateCount: null, deliveredCandidates: null, captureComplete: null, safetyCapHit: null, capturedCosts: [], compatible: taskRaw.compatible === true, coverage: null,
    firstExactIndex: null, firstExactCost: null, hit: { C8: hit.C8 === true, C32: hit.C32 === true, C4C: hit.C4C === true }, extent: structuredClone(taskRaw.extent) as PlannerAlternativeSearchExtent,
    budgetMs: num(taskRaw.budgetMs) }
  const conditions = isObject(json.conditions) ? json.conditions : {}
  return { valid: true, issues: [], authority: parsed.authority, population, facts: { taskRow, rederivedExcludedRouteKeySha256: routeSha, b2c2b2e: ours, type: String(targetRaw.type),
    missClass: typeof targetRaw.missClass === 'string' ? targetRaw.missClass : null, trajectory: structuredClone(targetRaw.trajectory ?? null), oracleOperationCost: num(targetRaw.oracleOperationCost),
    e1: { e1Total: e1.e1Total as number, commonLadder: structuredClone(common) as Record<Policy, { recovered: number; of: number }>,
      diagnostic: structuredClone(diagnostic.total) as Record<Policy, { recovered: number; of: number }>, l1: { ...(l1.exactTargets as Record<Policy, number>) },
      l2: { ...(l2.exactTargets as Record<Policy, number>) }, l1Population: l1.population as number, l2Population: l2.population as number, allRecovered: diagnostic.allRecovered as boolean },
    evidence, rngEngineVersion: String(environment.rngEngineVersion), calculationContext: structuredClone(conditions.calculationContext), researchMaxPlanSteps: conditions.researchMaxPlanSteps as number,
    origins: structuredClone(conditions.origins ?? null) } }
}

// ---------------------------------------------------------------- B2-C2B2I / B2-C2B2J (the authority of the optimized Production state)

/** The B2-C2B2I facts beyond B2-C2B2J's parse: the Production files of its adopted optimization. */
export interface Phase2C26B2C2B2KB2C2B2IAuthority extends Phase2C26B2C2B2JB2C2B2IAuthority {
  optimizationId: string
  productionChangedFiles: string[]
}

/**
 * The committed B2-C2B2I RESULT through B2-C2B2J's own parse (`parsePhase2C26B2C2B2JB2C2B2IAuthority()`: the registered SHA-256, formal,
 * B2C2B2I_ADOPTED, the registered optimization, valid semantic parity and profiles, the registered B2-C2B2H / G / F / E chain), plus its
 * Production change: exactly the optimization's file, registered, runner-attested, with a valid source check.
 */
export function parsePhase2C26B2C2B2KB2C2B2IAuthority(json: unknown, resultSha256: string): { valid: boolean; issues: string[]; authority: Phase2C26B2C2B2KB2C2B2IAuthority | null } {
  const parsed = parsePhase2C26B2C2B2JB2C2B2IAuthority(json, resultSha256)
  if (!parsed.valid || parsed.authority === null || !isObject(json)) return { valid: false, issues: parsed.issues.map(i => `b2c2b2i: ${i}`), authority: null }
  const issues: string[] = []
  const provenance = isObject(json.provenance) ? json.provenance : {}
  const change = isObject(json.productionChange) ? json.productionChange : {}
  const files = Array.isArray(change.productionChangedFiles) && change.productionChangedFiles.every(f => typeof f === 'string') ? [...change.productionChangedFiles as string[]] : null
  if (provenance.productionOptimizationId !== PHASE2C26B2C2B2I_OPTIMIZATION.id) issues.push(`b2c2b2i: the optimization is not ${PHASE2C26B2C2B2I_OPTIMIZATION.id}`)
  if (files === null || !same(files, [PHASE2C26B2C2B2I_OPTIMIZATION.file]) || !same(change.registered, files)) issues.push('b2c2b2i: productionChangedFiles are not exactly the registered optimization file')
  if (parsed.authority.b2c2b2eResultSha256 !== PHASE2C26B2C2B2K_REGISTERED_B2C2B2E.resultSha256) issues.push('b2c2b2i: the B2-C2B2I RESULT is not made against the registered B2-C2B2E RESULT')
  if (issues.length > 0 || files === null) return { valid: false, issues, authority: null }
  return { valid: true, issues: [], authority: { ...parsed.authority, optimizationId: String(provenance.productionOptimizationId), productionChangedFiles: files } }
}

/** The B2-C2B2J RESULT facts this phase reads (parent-side and post hoc; the Search never reads them). */
export interface Phase2C26B2C2B2KB2C2B2JAuthority {
  resultSha256: string
  measuredHead: string
  analysisHead: string
  decisionCase: string
  optimizationId: string
  exportSha256: string
  b2c2b2iResultSha256: string
  b2c2b2eResultSha256: string
  baseMain: string
  productionChangedFiles: string[]
  targetWeaponIds: string[]
  probes: Phase2C26B2C2B2EProbe[]
  expectedTaskIdentity: Phase2C26B2C2B2FTaskIdentity
  excludedRouteKeySha256: string
  /** B2-C2B2J's direct comparison (background only: the same-work state_generation before / after). */
  direct: { commonDepths: number | null; commonGeneratedStates: number | null; beforeStateGenerationMs: number | null; afterStateGenerationMs: number | null; stateGenerationDirectRatio: number | null }
}

/**
 * Reads the committed B2-C2B2J RESULT as untrusted JSON and fails closed unless it is the registered formal ADOPTED result: its own
 * SHA-256; formal with verified launch provenance, not partial, no calculation code change since its measured HEAD; the registered
 * measured HEAD and optimization; decision B2C2B2J_ADOPTED / adopt with no invalid reason; made against the registered B2-C2B2I and
 * B2-C2B2E RESULTs; every hash chain and condition check true; the Production change exactly the optimization's file, registered,
 * runner-attested, with a valid source check and no Production change between B2-C2B2I's measured HEAD and its base main; valid
 * semantic parity; one population Target, probe, identity and one verified excluded current Route key.
 */
export function parsePhase2C26B2C2B2KB2C2B2JAuthority(json: unknown, resultSha256: string): { valid: boolean; issues: string[]; authority: Phase2C26B2C2B2KB2C2B2JAuthority | null } {
  const reg = PHASE2C26B2C2B2K_REGISTERED_B2C2B2J
  const issues: string[] = []
  if (!isObject(json) || !isObject(json.provenance) || !isObject(json.decision) || !isObject(json.conditions) || !isObject(json.population) || !isObject(json.parity)
    || !isObject(json.productionChange) || !isObject(json.semanticParity) || !isObject(json.directComparison)) {
    return { valid: false, issues: ['B2-C2B2J RESULT lacks provenance / decision / conditions / population / parity / productionChange / semanticParity / directComparison'], authority: null }
  }
  const { provenance, decision, conditions, population, parity, productionChange, semanticParity, directComparison } = json
  if (resultSha256 !== reg.resultSha256) issues.push(`B2-C2B2J RESULT SHA-256 ${resultSha256} is not the registered ${reg.resultSha256}`)
  if (provenance.formal !== true || provenance.evidenceGrade !== reg.evidenceGrade || provenance.launchProvenanceVerified !== true) issues.push('the B2-C2B2J RESULT is not formal with verified launch provenance')
  if (provenance.partialRun !== false) issues.push('the B2-C2B2J RESULT is a partial run')
  if (provenance.measuredHead !== reg.measuredHead) issues.push('provenance.measuredHead is not the registered B2-C2B2J measured HEAD')
  if (typeof provenance.analysisHead !== 'string' || !COMMIT.test(provenance.analysisHead)) issues.push('provenance.analysisHead is not a commit SHA')
  if (!Array.isArray(provenance.calculationCodeChangedSinceMeasuredHead) || provenance.calculationCodeChangedSinceMeasuredHead.length !== 0) issues.push('the B2-C2B2J calculation code changed since its measured HEAD')
  if (provenance.productionOptimizationId !== reg.optimizationId) issues.push(`provenance.productionOptimizationId is not ${reg.optimizationId}`)
  if (provenance.b2c2b2iResultSha256 !== reg.b2c2b2iResultSha256) issues.push('provenance.b2c2b2iResultSha256 is not the registered B2-C2B2I RESULT')
  if (provenance.b2c2b2eResultSha256 !== reg.b2c2b2eResultSha256) issues.push('provenance.b2c2b2eResultSha256 is not the registered B2-C2B2E RESULT')
  if (typeof provenance.exportSha256 !== 'string' || !SHA256.test(provenance.exportSha256)) issues.push('provenance.exportSha256 is not a SHA-256')
  if (decision.case !== reg.decisionCase || decision.adoption !== 'adopt') issues.push(`decision is ${String(decision.case)} / ${String(decision.adoption)}, not ${reg.decisionCase} / adopt`)
  if (!Array.isArray(json.invalidReasons) || json.invalidReasons.length !== 0) issues.push('invalidReasons is not empty')
  if (!allTrue(parity.hashChain)) issues.push('parity.hashChain is not all true')
  if (!allTrue(conditions.conditionChecks)) issues.push('conditions.conditionChecks is not all true')
  if (semanticParity.valid !== true) issues.push('semanticParity.valid is not true')
  const sourceCheck = isObject(productionChange.sourceCheck) ? productionChange.sourceCheck : {}
  const files = Array.isArray(productionChange.productionChangedBaseMainToMeasuredHead) && productionChange.productionChangedBaseMainToMeasuredHead.every(f => typeof f === 'string')
    ? [...productionChange.productionChangedBaseMainToMeasuredHead as string[]] : null
  if (files === null || !same(files, [PHASE2C26B2C2B2J_OPTIMIZATION.file]) || !same(productionChange.registered, files) || !same(productionChange.productionChangedFiles, files)) {
    issues.push('productionChange is not exactly the registered optimization file')
  }
  if (productionChange.equalsRegistered !== true || productionChange.equalsRunnerAttested !== true || sourceCheck.valid !== true) issues.push('productionChange is not the registered, attested, valid B2-C2B2J change')
  if (!same(productionChange.productionChangedB2C2B2IToBaseMain, []) || productionChange.baseMainIsAncestorOfMeasuredHead !== true) issues.push('productionChange: Production changed between the B2-C2B2I measured HEAD and the B2-C2B2J base main')
  const baseMain = typeof productionChange.baseMain === 'string' && COMMIT.test(productionChange.baseMain) ? productionChange.baseMain : null
  if (baseMain === null) issues.push('productionChange.baseMain is not a commit SHA')
  const targetWeaponIds = Array.isArray(population.targetWeaponIds) && population.targetWeaponIds.every(v => typeof v === 'string') ? [...population.targetWeaponIds as string[]] : []
  if (targetWeaponIds.length !== reg.targets) issues.push(`population.targetWeaponIds holds ${targetWeaponIds.length} Targets, not ${reg.targets}`)
  const probes = Array.isArray(population.probes) ? structuredClone(population.probes) as Phase2C26B2C2B2EProbe[] : []
  if (probes.length !== reg.targets || !same(probes.map(p => p?.targetWeaponId), targetWeaponIds)) issues.push('population.probes do not name population.targetWeaponIds')
  const identity = isObject(parity.identity) ? parity.identity : {}
  const expected = isObject(identity.expected) && PHASE2C26B2C2B2F_IDENTITY_FIELDS.every(field => field in (identity.expected as Json))
    && Object.keys(identity.expected).length === PHASE2C26B2C2B2F_IDENTITY_FIELDS.length ? structuredClone(identity.expected) as unknown as Phase2C26B2C2B2FTaskIdentity : null
  if (expected === null || identity.rawEqualsExpected !== true) issues.push('parity.identity is not one expected task identity equal to the raw one')
  const route = isObject(parity.excludedRoute) ? parity.excludedRoute : {}
  const routeSha = typeof route.rederivedExcludedRouteKeySha256 === 'string' && SHA256.test(route.rederivedExcludedRouteKeySha256) ? route.rederivedExcludedRouteKeySha256 : null
  if (route.valid !== true || route.excludedRouteKeyCount !== 1 || route.excludedRouteIsCurrentRoute !== true || routeSha === null || route.childAttestedExcludedRouteKeySha256 !== routeSha) {
    issues.push('parity.excludedRoute is not one verified current Route')
  }
  if (issues.length > 0 || expected === null || routeSha === null || files === null || baseMain === null) return { valid: false, issues, authority: null }
  return { valid: true, issues: [], authority: { resultSha256, measuredHead: String(provenance.measuredHead), analysisHead: String(provenance.analysisHead), decisionCase: String(decision.case),
    optimizationId: String(provenance.productionOptimizationId), exportSha256: String(provenance.exportSha256), b2c2b2iResultSha256: String(provenance.b2c2b2iResultSha256),
    b2c2b2eResultSha256: String(provenance.b2c2b2eResultSha256), baseMain, productionChangedFiles: files, targetWeaponIds, probes, expectedTaskIdentity: expected,
    excludedRouteKeySha256: routeSha, direct: { commonDepths: num(directComparison.commonDepths), commonGeneratedStates: num(directComparison.commonGeneratedStates),
      beforeStateGenerationMs: num(directComparison.beforeStateGenerationMs), afterStateGenerationMs: num(directComparison.afterStateGenerationMs),
      stateGenerationDirectRatio: num(directComparison.stateGenerationDirectRatio) } } }
}

/** The adopted optimizations the current main holds, in phase order, from their formal RESULTs. */
export function phase2c26b2c2b2kAdoptedOptimizations(i: Phase2C26B2C2B2KB2C2B2IAuthority, j: Phase2C26B2C2B2KB2C2B2JAuthority): Phase2C26B2C2B2KAdoptedOptimization[] {
  return [{ phase: 'B2-C2B2I', id: i.optimizationId, files: [...i.productionChangedFiles], resultSha256: i.resultSha256, decisionCase: i.decisionCase, measuredHead: i.measuredHead },
    { phase: 'B2-C2B2J', id: j.optimizationId, files: [...j.productionChangedFiles], resultSha256: j.resultSha256, decisionCase: j.decisionCase, measuredHead: j.measuredHead }]
}

/** Per adopted file, the formal measured HEAD of the last adopted optimization (in phase order) that changed it: the optimized file the launch must hold. */
export function phase2c26b2c2b2kOptimizedFileHeads(adopted: readonly Phase2C26B2C2B2KAdoptedOptimization[]): { file: string; measuredHead: string }[] {
  const last = new Map<string, string>()
  for (const optimization of adopted) for (const file of optimization.files) last.set(file, optimization.measuredHead)
  return [...last.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([file, measuredHead]) => ({ file, measuredHead }))
}

// ---------------------------------------------------------------- population, probe and expected identity

export interface Phase2C26B2C2B2KDerivation {
  valid: boolean
  issues: string[]
  targetWeaponIds: string[]
  probes: Phase2C26B2C2B2EProbe[]
  expectedTaskIdentities: Phase2C26B2C2B2FTaskIdentity[]
  excludedRouteKeySha256: string | null
  chain: { b2c2b2iMadeAgainstB2C2B2E: boolean; b2c2b2jMadeAgainstB2C2B2E: boolean; b2c2b2jMadeAgainstB2C2B2I: boolean; exportEqualsB2C2B2I: boolean; exportEqualsB2C2B2J: boolean;
    targetsEqualB2C2B2I: boolean; targetsEqualB2C2B2J: boolean; probesEqualB2C2B2I: boolean; probesEqualB2C2B2J: boolean; identityEqualsB2C2B2ETaskRow: boolean;
    identityEqualsB2C2B2I: boolean; identityEqualsB2C2B2J: boolean; excludedRouteEqualsB2C2B2I: boolean; excludedRouteEqualsB2C2B2J: boolean }
}

/**
 * The population, derived mechanically from the B2-C2B2E RESULT by B2-C2B2F's rule (exactly one Target: process timeout, recovery none,
 * next-branch type time_bound), with its probe and expected identity (B2-C2B2E's task row), and cross-checked against the B2-C2B2I and
 * B2-C2B2J RESULTs, which searched the same Target in the same Search input: the same Target, probe, identity and excluded current
 * Route key, over the same Export. Fails closed on any difference. Nothing here reaches the Search.
 */
export function phase2c26b2c2b2kPopulation(e: ReturnType<typeof parsePhase2C26B2C2B2KB2C2B2EAuthority> | null, i: Phase2C26B2C2B2KB2C2B2IAuthority | null,
  j: Phase2C26B2C2B2KB2C2B2JAuthority | null): Phase2C26B2C2B2KDerivation {
  const chain = { b2c2b2iMadeAgainstB2C2B2E: false, b2c2b2jMadeAgainstB2C2B2E: false, b2c2b2jMadeAgainstB2C2B2I: false, exportEqualsB2C2B2I: false, exportEqualsB2C2B2J: false,
    targetsEqualB2C2B2I: false, targetsEqualB2C2B2J: false, probesEqualB2C2B2I: false, probesEqualB2C2B2J: false, identityEqualsB2C2B2ETaskRow: false, identityEqualsB2C2B2I: false,
    identityEqualsB2C2B2J: false, excludedRouteEqualsB2C2B2I: false, excludedRouteEqualsB2C2B2J: false }
  const empty = { targetWeaponIds: [], probes: [], expectedTaskIdentities: [], excludedRouteKeySha256: null, chain }
  if (e === null || !e.valid || e.authority === null || e.population === null || e.facts === null) return { valid: false, issues: ['no valid B2-C2B2E authority', ...(e?.issues ?? [])], ...empty }
  if (i === null) return { valid: false, issues: ['no B2-C2B2I authority'], ...empty }
  if (j === null) return { valid: false, issues: ['no B2-C2B2J authority'], ...empty }
  const issues: string[] = []
  const derived = e.population
  if (!derived.valid) issues.push(...derived.issues.map(x => `population: ${x}`))
  if (derived.targetWeaponIds.length !== PHASE2C26B2C2B2K_EXPECTED_TASKS) issues.push(`${derived.targetWeaponIds.length} population Targets, not ${PHASE2C26B2C2B2K_EXPECTED_TASKS}`)
  const row = e.facts.taskRow
  const rowIdentity = Object.fromEntries(PHASE2C26B2C2B2F_IDENTITY_FIELDS.map(field => [field, structuredClone(row[field])]))
  chain.b2c2b2iMadeAgainstB2C2B2E = i.b2c2b2eResultSha256 === e.authority.resultSha256
  chain.b2c2b2jMadeAgainstB2C2B2E = j.b2c2b2eResultSha256 === e.authority.resultSha256
  chain.b2c2b2jMadeAgainstB2C2B2I = j.b2c2b2iResultSha256 === i.resultSha256
  chain.exportEqualsB2C2B2I = i.exportSha256 === e.authority.exportSha256
  chain.exportEqualsB2C2B2J = j.exportSha256 === e.authority.exportSha256
  chain.targetsEqualB2C2B2I = same(i.targetWeaponIds, derived.targetWeaponIds)
  chain.targetsEqualB2C2B2J = same(j.targetWeaponIds, derived.targetWeaponIds)
  chain.probesEqualB2C2B2I = same(i.probes, derived.probes)
  chain.probesEqualB2C2B2J = same(j.probes, derived.probes)
  chain.identityEqualsB2C2B2ETaskRow = same(derived.expectedTaskIdentities, [rowIdentity])
  chain.identityEqualsB2C2B2I = same(i.expectedTaskIdentities, derived.expectedTaskIdentities)
  chain.identityEqualsB2C2B2J = same([j.expectedTaskIdentity], derived.expectedTaskIdentities)
  chain.excludedRouteEqualsB2C2B2I = i.excludedRouteKeySha256 === e.facts.rederivedExcludedRouteKeySha256
  chain.excludedRouteEqualsB2C2B2J = j.excludedRouteKeySha256 === e.facts.rederivedExcludedRouteKeySha256
  for (const [name, ok] of Object.entries(chain)) if (!ok) issues.push(`chain: ${name}`)
  return { valid: issues.length === 0, issues, targetWeaponIds: [...derived.targetWeaponIds], probes: structuredClone(derived.probes), expectedTaskIdentities: structuredClone(derived.expectedTaskIdentities),
    excludedRouteKeySha256: e.facts.rederivedExcludedRouteKeySha256, chain }
}

/** The probe manifest: the one probe and its expected Search input identity plus the authority SHA-256s, and nothing else (no expected key / index / cost / Route kind / outcome / measurement). */
export function phase2c26b2c2b2kProbeManifest(e: ReturnType<typeof parsePhase2C26B2C2B2KB2C2B2EAuthority>, i: Phase2C26B2C2B2KB2C2B2IAuthority,
  j: Phase2C26B2C2B2KB2C2B2JAuthority): Phase2C26B2C2B2KProbeManifest {
  const derived = phase2c26b2c2b2kPopulation(e, i, j)
  if (!derived.valid || e.authority === null) throw new Error(`The B2-C2B2K population is not valid: ${derived.issues.join('; ')}`)
  return { phase: 'Issue #154 Phase 2-C2.6-B2-C2B2K probe manifest (B2-C2B2E time-bound timeout Target, B2-C2B2E Search input, oracle-guided diagnostic input)',
    b2c2b2eResultSha256: e.authority.resultSha256, b2c2b2iResultSha256: i.resultSha256, b2c2b2jResultSha256: j.resultSha256, population: PHASE2C26B2C2B2K_POPULATION, policy: 'P1',
    contextSelection: PHASE2C26B2C2B2K_CONTEXT_SELECTION.id, extentRule: PHASE2C26B2C2B2K_EXTENT_RULE.id, exportSha256: e.authority.exportSha256, probes: derived.probes,
    expectedTaskIdentities: derived.expectedTaskIdentities }
}

// ---------------------------------------------------------------- Production calculation source audit

/** Production calculation sources among changed paths (B2-C2B2I / B2-C2B2J's rule: everything but benchmarks, tests, scripts, docs, CI). */
export const phase2c26b2c2b2kProductionChangedFiles = phase2c26b2c2b2jProductionChangedFiles

/**
 * Whether the Production audit the runner took shows exactly the optimized current Production state and no change of this phase:
 * the base main an ancestor of the launch HEAD; no Production calculation source changed since the base main; the Production change
 * since B2-C2B2E's measured HEAD exactly the union of the adopted optimizations' files; every main commit after B2-C2B2E's merge that
 * touched Production one whose Production files belong to an adopted optimization; and every optimized file byte-identical to the
 * file at the formal measured HEAD of the last adopted optimization that changed it (whose RESULT checked the change from the earlier one).
 */
export function phase2c26b2c2b2kProductionAuditIssues(audit: Phase2C26B2C2B2KProductionAudit, adopted: readonly Phase2C26B2C2B2KAdoptedOptimization[], b2c2b2eMeasuredHead: string): string[] {
  const issues: string[] = []
  const adoptedFiles = [...new Set(adopted.flatMap(o => o.files))].sort()
  if (audit.b2c2b2eMeasuredHead !== b2c2b2eMeasuredHead) issues.push('the audit is not from the B2-C2B2E measured HEAD')
  if (!same(audit.adoptedOptimizationFiles, adoptedFiles)) issues.push('the audit adopted files are not the adopted optimizations\' files')
  if (!audit.baseMainIsAncestor) issues.push('the base main is not an ancestor of the launch HEAD')
  if (audit.productionChangedSinceBaseMain.length !== 0) issues.push(`Production changed since the base main: ${audit.productionChangedSinceBaseMain.join(', ')}`)
  if (!same(audit.productionChangedSinceB2C2B2E, adoptedFiles)) issues.push(`the Production change since the B2-C2B2E measured HEAD is ${audit.productionChangedSinceB2C2B2E.join(', ') || 'nothing'}, not ${adoptedFiles.join(', ')}`)
  for (const commit of audit.mainCommits) {
    if (commit.productionChangedFiles.some(f => !adoptedFiles.includes(f))) issues.push(`${commit.sha.slice(0, 7)} changed a Production file outside the adopted optimizations`)
  }
  const heads = phase2c26b2c2b2kOptimizedFileHeads(adopted)
  if (!same(audit.optimizedFilesEqualMeasured.map(({ file, measuredHead }) => ({ file, measuredHead })), heads) || audit.optimizedFilesEqualMeasured.some(e => !e.equal)) {
    issues.push('an adopted optimization file is not the file at the formal measured HEAD of the last optimization that changed it')
  }
  return issues
}
