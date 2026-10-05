/**
 * Issue #154 Phase 2-C2.6-B2-C2B2F: the population (the B2-C2B2E branch-C Target of type time_bound whose B2-C2B2E task timed out),
 * its probe (B2-C2B2E's Target, task ID, P1 rank and tight extent) and its expected Search input identity (B2-C2B2E's task row), all
 * read mechanically from the committed B2-C2B2E RESULT. Research only. Never import from Production, and never from the B2-C2B2F
 * Search side's child calculation (the runner never reads this module; it reads the manifest built here).
 *
 * Nothing about the population is written down here: the Target, task, rank, extent and digests come from the RESULT, and every
 * value is cross-checked between the RESULT's own next-branch row, Target row, task row, probe derivation and start-attested probe.
 */
import { stableStringify } from '../domain/models/hashing'
import {
  phase2c26b2c2b2eExtentBoundIssues,
  PHASE2C26B2C2B2E_STAGE1,
  type Phase2C26B2C2B2EProbe,
} from './plannerGlobalPhase2C26B2C2B2E'
import {
  PHASE2C26B2C2B2F_CONTEXT_SELECTION,
  PHASE2C26B2C2B2F_EXPECTED_TASKS,
  PHASE2C26B2C2B2F_EXTENT_RULE,
  PHASE2C26B2C2B2F_IDENTITY_FIELDS,
  PHASE2C26B2C2B2F_POPULATION,
  type Phase2C26B2C2B2FProbeManifest,
  type Phase2C26B2C2B2FTaskIdentity,
} from './plannerGlobalPhase2C26B2C2B2F'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}
const COMMIT = /^[0-9a-f]{40}$/
const SHA256 = /^[0-9a-f]{64}$/

/** The B2-C2B2E RESULT (formal, B2C2B2E_INCOMPLETE, next branch C) this phase profiles from. */
export const PHASE2C26B2C2B2F_REGISTERED_B2C2B2E = {
  resultSha256: '5bf6bba389bb3c4f1089ddc9b079426930be203bd5e88f3d3f9b2032a42ecabe',
  decisionCase: 'B2C2B2E_INCOMPLETE',
  evidenceGrade: 'formal',
  measuredHead: 'e69a94ea0fdd1ef39a39286dffab1bfc44fb1f0b',
  nextBranch: 'C',
  targets: 2,
  tasks: 2,
  stage1: { ...PHASE2C26B2C2B2E_STAGE1 },
  /** The population rule: the branch-C next-branch rows of this type whose B2-C2B2E task ended this way. */
  populationType: 'time_bound',
  populationResult: 'timeout',
} as const

/** The B2-C2B2E Target row facts this phase reads (post hoc; the Search never reads them). */
export interface Phase2C26B2C2B2FB2C2B2ETarget {
  targetWeaponId: string
  taskId: string
  selectedRank: number
  type: string
  process: string
  measured: boolean
  recovery: string
  tightExtent: unknown
  pairedIdentityMatches: boolean
  excludedRouteVerified: boolean
  rederivedExcludedRouteKeySha256: string | null
  b2c2b2ePeakHeapBytes: number | null
  b2c2b2eYields: number | null
  b2c2b2eWallMs: number | null
}

export interface Phase2C26B2C2B2FB2C2B2ETaskRow extends Phase2C26B2C2B2FTaskIdentity {
  process: string
  record: unknown
  candidateCount: number | null
  budgetMs: number | null
}

export interface Phase2C26B2C2B2FB2C2B2EAuthority {
  resultSha256: string
  measuredHead: string
  analysisHead: string
  decisionCase: string
  evidenceGrade: string
  exportSha256: string
  b2c2b2dResultSha256: string
  stage1: unknown
  origins: unknown
  calculationContext: unknown
  researchMaxPlanSteps: number
  nextBranch: { branch: string; typesUnambiguous: boolean; perTarget: { targetWeaponId: string; taskId: string; type: string; result: string }[] }
  targets: Phase2C26B2C2B2FB2C2B2ETarget[]
  taskRows: Phase2C26B2C2B2FB2C2B2ETaskRow[]
  /** B2-C2B2E's probe derivations ({ targetWeaponId, b2c2b2dTaskId, tightExtent, ... }). */
  probes: Json[]
  /** The probes the B2-C2B2E runner start-attested (the Search input it actually launched with). */
  attestedProbes: Phase2C26B2C2B2EProbe[]
  hashChainAllTrue: boolean
}

const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null)

/**
 * Reads the committed B2-C2B2E RESULT as untrusted JSON and fails closed unless it is the registered formal result: its own SHA-256;
 * formal with verified launch provenance, not partial; the registered measured HEAD, case, no invalid reason; B2-C2B2E's Stage 1
 * (60 minutes / 12,288 MB); a hash chain of all true; next branch C with unambiguous types; 2 readable Target rows, 2 task rows and
 * 2 attested probes. Nothing here reaches the Search.
 */
export function parsePhase2C26B2C2B2FB2C2B2EAuthority(json: unknown, resultSha256: string): { valid: boolean; issues: string[]; authority: Phase2C26B2C2B2FB2C2B2EAuthority | null } {
  const reg = PHASE2C26B2C2B2F_REGISTERED_B2C2B2E
  const issues: string[] = []
  if (!isObject(json) || !isObject(json.provenance) || !isObject(json.decision) || !isObject(json.conditions) || !isObject(json.nextBranch) || !Array.isArray(json.targets)
    || !Array.isArray(json.taskRows) || !Array.isArray(json.probes) || !isObject(json.parity)) {
    return { valid: false, issues: ['B2-C2B2E RESULT lacks provenance / decision / conditions / nextBranch / targets / taskRows / probes / parity'], authority: null }
  }
  const { provenance, decision, conditions, nextBranch, parity } = json
  if (resultSha256 !== reg.resultSha256) issues.push(`B2-C2B2E RESULT SHA-256 ${resultSha256} is not the registered ${reg.resultSha256}`)
  if (provenance.formal !== true || provenance.evidenceGrade !== reg.evidenceGrade || provenance.launchProvenanceVerified !== true) issues.push('the B2-C2B2E RESULT is not formal with verified launch provenance')
  if (provenance.partialRun !== false) issues.push('the B2-C2B2E RESULT is a partial run')
  if (provenance.measuredHead !== reg.measuredHead) issues.push('provenance.measuredHead is not the registered B2-C2B2E measured HEAD')
  if (typeof provenance.analysisHead !== 'string' || !COMMIT.test(provenance.analysisHead)) issues.push('provenance.analysisHead is not a commit SHA')
  if (decision.case !== reg.decisionCase) issues.push(`decision.case ${String(decision.case)} is not ${reg.decisionCase}`)
  if (!Array.isArray(json.invalidReasons) || json.invalidReasons.length !== 0) issues.push('invalidReasons is not empty')
  if (typeof provenance.exportSha256 !== 'string' || !SHA256.test(provenance.exportSha256)) issues.push('provenance.exportSha256 is not a SHA-256')
  if (typeof provenance.b2c2b2dResultSha256 !== 'string' || !SHA256.test(provenance.b2c2b2dResultSha256)) issues.push('provenance.b2c2b2dResultSha256 is not a SHA-256')
  if (!same(conditions.stage1, reg.stage1)) issues.push('conditions.stage1 is not B2-C2B2E\'s registered Stage 1 (60 minutes, 12,288 MB)')
  const hashChain = isObject(parity.hashChain) ? parity.hashChain : null
  const hashChainAllTrue = hashChain !== null && Object.keys(hashChain).length > 0 && Object.values(hashChain).every(v => v === true)
  if (!hashChainAllTrue) issues.push('parity.hashChain is not all true')
  if (nextBranch.branch !== reg.nextBranch) issues.push(`nextBranch.branch ${String(nextBranch.branch)} is not ${reg.nextBranch}`)
  if (nextBranch.typesUnambiguous !== true) issues.push('nextBranch.typesUnambiguous is not true')
  const perTarget: Phase2C26B2C2B2FB2C2B2EAuthority['nextBranch']['perTarget'] = []
  for (const raw of Array.isArray(nextBranch.perTarget) ? nextBranch.perTarget as unknown[] : []) {
    if (!isObject(raw) || typeof raw.targetWeaponId !== 'string' || typeof raw.taskId !== 'string' || typeof raw.type !== 'string' || typeof raw.result !== 'string') { issues.push('a next-branch row is malformed'); continue }
    perTarget.push({ targetWeaponId: raw.targetWeaponId, taskId: raw.taskId, type: raw.type, result: raw.result })
  }
  if (perTarget.length !== reg.targets) issues.push(`nextBranch.perTarget holds ${perTarget.length} rows, not ${reg.targets}`)

  const targets: Phase2C26B2C2B2FB2C2B2ETarget[] = []
  for (const raw of json.targets as unknown[]) {
    if (!isObject(raw) || typeof raw.targetWeaponId !== 'string' || typeof raw.taskId !== 'string' || !Number.isSafeInteger(raw.selectedRank) || typeof raw.process !== 'string'
      || !isObject(raw.extents) || !isObject(raw.paired) || !isObject(raw.paired.identity)) { issues.push('a B2-C2B2E Target row is malformed'); continue }
    const identity = raw.paired.identity as Json
    const route = isObject(identity.excludedRouteKeyComparison) ? identity.excludedRouteKeyComparison : {}
    const e = isObject(raw.paired.b2c2b2e) ? raw.paired.b2c2b2e : {}
    targets.push({ targetWeaponId: raw.targetWeaponId, taskId: raw.taskId, selectedRank: raw.selectedRank as number, type: String(raw.type), process: raw.process, measured: raw.measured === true,
      recovery: String(raw.recovery), tightExtent: structuredClone((raw.extents as Json).tight), pairedIdentityMatches: identity.matches === true, excludedRouteVerified: route.verified === true,
      rederivedExcludedRouteKeySha256: typeof route.rederivedExcludedRouteKeySha256 === 'string' ? route.rederivedExcludedRouteKeySha256 : null,
      b2c2b2ePeakHeapBytes: num(e.peakHeapBytes), b2c2b2eYields: num(e.yields), b2c2b2eWallMs: num(e.wallMs) })
  }
  if (targets.length !== reg.targets) issues.push(`targets holds ${targets.length} readable rows, not ${reg.targets}`)
  const taskRows: Phase2C26B2C2B2FB2C2B2ETaskRow[] = []
  for (const raw of json.taskRows as unknown[]) {
    if (!isObject(raw) || !PHASE2C26B2C2B2F_IDENTITY_FIELDS.every(field => field in raw) || typeof raw.process !== 'string') { issues.push('a B2-C2B2E task row is malformed'); continue }
    const identity = Object.fromEntries(PHASE2C26B2C2B2F_IDENTITY_FIELDS.map(field => [field, structuredClone(raw[field])])) as unknown as Phase2C26B2C2B2FTaskIdentity
    taskRows.push({ ...identity, process: raw.process, record: raw.record ?? null, candidateCount: num(raw.candidateCount), budgetMs: num(raw.budgetMs) })
  }
  if (taskRows.length !== reg.tasks) issues.push(`taskRows holds ${taskRows.length} readable rows, not ${reg.tasks}`)
  const startAttestation = isObject(provenance.startAttestation) && isObject(provenance.startAttestation.body) ? provenance.startAttestation.body : null
  const attestedProbes = startAttestation !== null && Array.isArray(startAttestation.probes) ? structuredClone(startAttestation.probes) as Phase2C26B2C2B2EProbe[] : []
  if (attestedProbes.length !== reg.targets) issues.push('the B2-C2B2E start attestation does not hold the 2 probes')
  if (startAttestation !== null && startAttestation.repositoryHead !== reg.measuredHead) issues.push('the B2-C2B2E start attestation HEAD is not the registered measured HEAD')
  if (!isObject(conditions.calculationContext)) issues.push('conditions.calculationContext is not readable')
  if (!Number.isSafeInteger(conditions.researchMaxPlanSteps)) issues.push('conditions.researchMaxPlanSteps is not readable')
  if (issues.length > 0) return { valid: false, issues, authority: null }
  return { valid: true, issues: [], authority: { resultSha256, measuredHead: String(provenance.measuredHead), analysisHead: String(provenance.analysisHead), decisionCase: String(decision.case),
    evidenceGrade: String(provenance.evidenceGrade), exportSha256: String(provenance.exportSha256), b2c2b2dResultSha256: String(provenance.b2c2b2dResultSha256),
    stage1: structuredClone(conditions.stage1), origins: structuredClone(conditions.origins ?? null), calculationContext: structuredClone(conditions.calculationContext),
    researchMaxPlanSteps: conditions.researchMaxPlanSteps as number, nextBranch: { branch: String(nextBranch.branch), typesUnambiguous: true, perTarget },
    targets, taskRows, probes: structuredClone(json.probes) as Json[], attestedProbes, hashChainAllTrue } }
}

// ---------------------------------------------------------------- population, probe and expected identity

export interface Phase2C26B2C2B2FDerivation {
  valid: boolean
  issues: string[]
  /** The population Target IDs (exactly one when valid). */
  targetWeaponIds: string[]
  /** The other next-branch rows (heap_growth etc.), by their recorded type / result, for the record. */
  others: { targetWeaponId: string; type: string; result: string }[]
  probes: Phase2C26B2C2B2EProbe[]
  expectedTaskIdentities: Phase2C26B2C2B2FTaskIdentity[]
  /** The B2-C2B2E facts of the population Target (background only, never a Search input). */
  b2c2b2e: { targetWeaponId: string; taskId: string; process: string; peakHeapBytes: number | null; yields: number | null; wallMs: number | null; rederivedExcludedRouteKeySha256: string | null }[]
}

/**
 * The population and its probe, derived mechanically: the next-branch rows of the registered type whose result is the registered
 * one (exactly one, or fail closed); then that Target's B2-C2B2E Target row (same task, same type, the same unmeasured timeout,
 * recovery none, paired identity and excluded Route verified), task row (same task, Target and rank, timeout, no record, no
 * Candidate count, the B2-C2B2E budget), recorded probe derivation (same task ID and tight extent) and start-attested probe (the
 * same probe) must all agree. The probe is B2-C2B2E's probe shape; the expected identity is the task row's Search input identity.
 */
export function phase2c26b2c2b2fPopulation(authority: Phase2C26B2C2B2FB2C2B2EAuthority | null): Phase2C26B2C2B2FDerivation {
  const empty = { targetWeaponIds: [], others: [], probes: [], expectedTaskIdentities: [], b2c2b2e: [] }
  if (authority === null) return { valid: false, issues: ['no B2-C2B2E authority'], ...empty }
  const reg = PHASE2C26B2C2B2F_REGISTERED_B2C2B2E
  const issues: string[] = []
  if (authority.nextBranch.branch !== reg.nextBranch) issues.push(`the B2-C2B2E next branch is ${authority.nextBranch.branch}, not ${reg.nextBranch}`)
  const selected = authority.nextBranch.perTarget.filter(row => row.type === reg.populationType && row.result === reg.populationResult)
  const others = authority.nextBranch.perTarget.filter(row => !selected.includes(row)).map(({ targetWeaponId, type, result }) => ({ targetWeaponId, type, result }))
  if (selected.length !== PHASE2C26B2C2B2F_EXPECTED_TASKS) issues.push(`${selected.length} next-branch rows are ${reg.populationType} with ${reg.populationResult}, not ${PHASE2C26B2C2B2F_EXPECTED_TASKS}`)
  if (others.some(o => o.type === reg.populationType)) issues.push(`another ${reg.populationType} next-branch row has a result other than ${reg.populationResult}`)
  const probes: Phase2C26B2C2B2EProbe[] = []
  const identities: Phase2C26B2C2B2FTaskIdentity[] = []
  const facts: Phase2C26B2C2B2FDerivation['b2c2b2e'] = []
  for (const row of selected) {
    const at = `${row.targetWeaponId} (${row.taskId})`
    const targets = authority.targets.filter(t => t.targetWeaponId === row.targetWeaponId)
    const tasks = authority.taskRows.filter(t => t.targetWeaponId === row.targetWeaponId)
    if (targets.length !== 1 || tasks.length !== 1) { issues.push(`${at}: ${targets.length} Target rows / ${tasks.length} task rows`); continue }
    const target = targets[0]!, task = tasks[0]!
    if (target.taskId !== row.taskId || task.taskId !== row.taskId) issues.push(`${at}: the Target / task row task ID is not the next-branch row's`)
    if (target.type !== reg.populationType) issues.push(`${at}: the Target row type is not ${reg.populationType}`)
    if (target.process !== reg.populationResult || target.measured !== false || target.recovery !== 'none') issues.push(`${at}: the Target row is not an unmeasured, unrecovered ${reg.populationResult}`)
    if (!target.pairedIdentityMatches || !target.excludedRouteVerified) issues.push(`${at}: the B2-C2B2E paired identity / excluded Route is not verified`)
    if (task.process !== reg.populationResult || task.record !== null || task.candidateCount !== null) issues.push(`${at}: the task row is not a ${reg.populationResult} without a record or a Candidate count`)
    if (task.budgetMs !== (reg.stage1 as { budgetMs: number }).budgetMs) issues.push(`${at}: the task row budget is not B2-C2B2E's`)
    if (task.contextRank !== target.selectedRank) issues.push(`${at}: the task row rank is not the Target row selected rank`)
    if (!same(task.extent, target.tightExtent)) issues.push(`${at}: the task row extent is not the Target row tight extent`)
    if (phase2c26b2c2b2eExtentBoundIssues(task.extent).length > 0) issues.push(`${at}: the extent is outside B2-C2B2D's bounds`)
    const derivations = authority.probes.filter(p => p.targetWeaponId === row.targetWeaponId)
    if (derivations.length !== 1 || derivations[0]!.b2c2b2dTaskId !== row.taskId || !same(derivations[0]!.tightExtent, task.extent)) issues.push(`${at}: the B2-C2B2E probe derivation disagrees`)
    const probe: Phase2C26B2C2B2EProbe = { targetWeaponId: row.targetWeaponId, b2c2b2dTaskId: task.taskId, contextRank: task.contextRank, extent: structuredClone(task.extent) }
    const attested = authority.attestedProbes.filter(p => p.targetWeaponId === row.targetWeaponId)
    if (attested.length !== 1 || !same(attested[0], probe)) issues.push(`${at}: the B2-C2B2E start-attested probe is not this probe`)
    probes.push(probe)
    identities.push(Object.fromEntries(PHASE2C26B2C2B2F_IDENTITY_FIELDS.map(field => [field, structuredClone(task[field])])) as unknown as Phase2C26B2C2B2FTaskIdentity)
    facts.push({ targetWeaponId: row.targetWeaponId, taskId: row.taskId, process: task.process, peakHeapBytes: target.b2c2b2ePeakHeapBytes, yields: target.b2c2b2eYields,
      wallMs: target.b2c2b2eWallMs, rederivedExcludedRouteKeySha256: target.rederivedExcludedRouteKeySha256 })
  }
  return { valid: issues.length === 0, issues, targetWeaponIds: selected.map(s => s.targetWeaponId), others, probes, expectedTaskIdentities: identities, b2c2b2e: facts }
}

/** The probe manifest: the one probe and its expected Search input identity, and nothing else (no expected key / index / cost / outcome / measurement). */
export function phase2c26b2c2b2fProbeManifest(authority: Phase2C26B2C2B2FB2C2B2EAuthority): Phase2C26B2C2B2FProbeManifest {
  const derived = phase2c26b2c2b2fPopulation(authority)
  if (!derived.valid) throw new Error(`The B2-C2B2F population is not valid: ${derived.issues.join('; ')}`)
  return { phase: 'Issue #154 Phase 2-C2.6-B2-C2B2F probe manifest (B2-C2B2E time-bound timeout Target, B2-C2B2E Search input)', b2c2b2eResultSha256: authority.resultSha256,
    population: PHASE2C26B2C2B2F_POPULATION, policy: 'P1', contextSelection: PHASE2C26B2C2B2F_CONTEXT_SELECTION.id, extentRule: PHASE2C26B2C2B2F_EXTENT_RULE.id,
    exportSha256: authority.exportSha256, probes: derived.probes, expectedTaskIdentities: derived.expectedTaskIdentities }
}
