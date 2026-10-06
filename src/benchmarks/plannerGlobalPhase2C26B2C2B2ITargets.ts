/**
 * Issue #154 Phase 2-C2.6-B2-C2B2I: the formal before authority (the committed B2-C2B2H RESULT), the population (the Target
 * B2-C2B2H profiled, decision MIXED with next phase category keep_prediction), its probe and expected Search input identity, read
 * mechanically from that RESULT and cross-checked against the population, probe, identity and excluded Route that B2-C2B2H's own
 * derivation re-derives from the committed B2-C2B2G / B2-C2B2F / B2-C2B2E RESULTs. Research only. Never import from Production, and
 * never from the B2-C2B2I Search side's child calculation (the runner reads the manifest built here, not a RESULT).
 *
 * Nothing about the population is written down here: the Target, task, rank, extent, group, digests and excluded Route key come from
 * the RESULTs.
 */
import { stableStringify } from '../domain/models/hashing'
import type { Phase2C26B2C2B2EProbe } from './plannerGlobalPhase2C26B2C2B2E'
import { PHASE2C26B2C2B2F_IDENTITY_FIELDS, type Phase2C26B2C2B2FTaskIdentity } from './plannerGlobalPhase2C26B2C2B2F'
import type { Phase2C26B2C2B2FB2C2B2EAuthority } from './plannerGlobalPhase2C26B2C2B2FTargets'
import type { Phase2C26B2C2B2GB2C2B2FAuthority } from './plannerGlobalPhase2C26B2C2B2GTargets'
import {
  phase2c26b2c2b2hRegisteredConditions,
  PHASE2C26B2C2B2H_CPU_PROFILER,
  PHASE2C26B2C2B2H_NODE_FLAGS,
  PHASE2C26B2C2B2H_SEARCH_INSTRUMENTATION,
  PHASE2C26B2C2B2H_STAGE1,
} from './plannerGlobalPhase2C26B2C2B2H'
import {
  phase2c26b2c2b2hPopulation,
  PHASE2C26B2C2B2H_REGISTERED_B2C2B2G,
  type Phase2C26B2C2B2HB2C2B2GAuthority,
} from './plannerGlobalPhase2C26B2C2B2HTargets'
import {
  PHASE2C26B2C2B2I_BEFORE_FILES,
  PHASE2C26B2C2B2I_EXPECTED_TASKS,
  PHASE2C26B2C2B2I_POPULATION,
  type Phase2C26B2C2B2IBeforeFile,
  type Phase2C26B2C2B2IProbeManifest,
} from './plannerGlobalPhase2C26B2C2B2I'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}
const SHA256 = /^[0-9a-f]{64}$/
const allTrue = (value: unknown) => isObject(value) && Object.keys(value).length > 0 && Object.values(value).every(v => v === true)
const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null)

/** The hotspot category this phase optimizes (B2-C2B2H's next phase category). */
export const PHASE2C26B2C2B2I_HOTSPOT_CATEGORY = 'keep_prediction'
/** B2-C2B2H's secondary threshold: the before hotspot must be at least this share of the active samples. */
export const PHASE2C26B2C2B2I_BEFORE_MIN_HOTSPOT_SHARE = 0.2

/** The B2-C2B2H RESULT (formal, B2C2B2H_MIXED, next phase keep_prediction) this phase takes as its before evidence. */
export const PHASE2C26B2C2B2I_REGISTERED_B2C2B2H = {
  resultSha256: 'e03fa2bb7065906e26fb05cd74e755977edbdfb67ada5cacaea380a6ab9aff6b',
  decisionCase: 'B2C2B2H_MIXED',
  nextPhaseCategories: [PHASE2C26B2C2B2I_HOTSPOT_CATEGORY],
  evidenceGrade: 'formal',
  measuredHead: '435fe0b53f56fed74ace9e16cf42281996c68514',
  targets: 1,
  /** The B2-C2B2G / B2-C2B2F / B2-C2B2E RESULTs B2-C2B2H was made against (B2-C2B2H's own registered authorities). */
  b2c2b2gResultSha256: PHASE2C26B2C2B2H_REGISTERED_B2C2B2G.resultSha256,
  b2c2b2fResultSha256: PHASE2C26B2C2B2H_REGISTERED_B2C2B2G.b2c2b2fResultSha256,
  b2c2b2eResultSha256: PHASE2C26B2C2B2H_REGISTERED_B2C2B2G.b2c2b2eResultSha256,
} as const

/** The B2-C2B2H RESULT facts this phase reads (post hoc and by the parent before launch; the Search never reads them). */
export interface Phase2C26B2C2B2IB2C2B2HAuthority {
  resultSha256: string
  measuredHead: string
  decisionCase: string
  nextPhaseCategories: string[]
  exportSha256: string
  b2c2b2gResultSha256: string
  b2c2b2fResultSha256: string
  b2c2b2eResultSha256: string
  probeManifestSha256: string
  targetWeaponIds: string[]
  probes: Phase2C26B2C2B2EProbe[]
  expectedTaskIdentities: Phase2C26B2C2B2FTaskIdentity[]
  excludedRouteKeySha256: string
  attestedProbes: Phase2C26B2C2B2EProbe[]
  attestedIdentities: Phase2C26B2C2B2FTaskIdentity[]
  /** The B2-C2B2H formal raw files (their SHA-256 as the RESULT recorded them), the before evidence of the direct comparison. */
  beforeFiles: Record<Phase2C26B2C2B2IBeforeFile, { file: string; sha256: string }>
  /** B2-C2B2H's keep_prediction active share (the before CPU share; re-derived from the before profile by the analyzer). */
  keepPredictionShareOfActive: number
  /** B2-C2B2H's registered Search conditions, recorded (must equal the registered B2-C2B2H conditions). */
  conditions: { stage1: unknown; searchInstrumentation: unknown; cpuProfilerConfig: unknown; nodeFlags: unknown }
  /** B2-C2B2H's predictKeep self line ticks (descriptive before). */
  predictKeepLineTicks: { line: number; text: string; ticks: number }[]
  /** B2-C2B2H's measurements, background only (never a Search input). */
  background: { childOutcome: string | null; depthRecords: number | null; peakHeapBytes: number | null; peakRssBytes: number | null; activeSamples: number | null;
    intervalSamples: number | null; profileDurationMs: number | null }
}

const cat = (analysis: Json, category: string) => (Array.isArray(analysis.categories) ? (analysis.categories as unknown[]).filter(isObject).find(c => c.category === category) : undefined)

/**
 * Reads the committed B2-C2B2H RESULT as untrusted JSON and fails closed unless it is the registered formal before authority: its
 * own SHA-256; formal with verified launch provenance, not partial, no calculation code change since its measured HEAD; the
 * registered measured HEAD, decision MIXED and next phase [keep_prediction]; no invalid and no insufficient reason (a valid CPU
 * profile); the keep_prediction active share >= 0.20 and equal to the decision's secondary share; B2-C2B2H's registered conditions
 * (30 minutes, 12,288 MB, two observers, the CPU profiler window, heap-only Node flags); every condition check, hash chain,
 * population, child identity check true; the task rebuilt, the raw identity equal to the expected one; the excluded current Route
 * verified (one key equal across the re-derivation, B2-C2B2G and the child); semantic parity with B2-C2B2G; the B2-C2B2G /
 * B2-C2B2F / B2-C2B2E RESULTs it was made against the registered ones; one Target, probe, identity; every before raw file recorded.
 */
export function parsePhase2C26B2C2B2IB2C2B2HAuthority(json: unknown, resultSha256: string): { valid: boolean; issues: string[]; authority: Phase2C26B2C2B2IB2C2B2HAuthority | null } {
  const reg = PHASE2C26B2C2B2I_REGISTERED_B2C2B2H
  const issues: string[] = []
  if (!isObject(json) || !isObject(json.provenance) || !isObject(json.decision) || !isObject(json.conditions) || !isObject(json.population) || !isObject(json.parity)
    || !isObject(json.outcome) || !isObject(json.sources) || !isObject(json.cpuAttribution)) {
    return { valid: false, issues: ['B2-C2B2H RESULT lacks provenance / decision / conditions / population / parity / outcome / sources / cpuAttribution'], authority: null }
  }
  const { provenance, decision, conditions, population, parity, outcome, sources, cpuAttribution } = json
  if (resultSha256 !== reg.resultSha256) issues.push(`B2-C2B2H RESULT SHA-256 ${resultSha256} is not the registered ${reg.resultSha256}`)
  if (provenance.formal !== true || provenance.evidenceGrade !== reg.evidenceGrade || provenance.launchProvenanceVerified !== true) issues.push('the B2-C2B2H RESULT is not formal with verified launch provenance')
  if (provenance.partialRun !== false) issues.push('the B2-C2B2H RESULT is a partial run')
  if (provenance.measuredHead !== reg.measuredHead) issues.push('provenance.measuredHead is not the registered B2-C2B2H measured HEAD')
  if (!Array.isArray(provenance.calculationCodeChangedSinceMeasuredHead) || provenance.calculationCodeChangedSinceMeasuredHead.length !== 0) issues.push('the B2-C2B2H calculation code changed since its measured HEAD')
  if (provenance.b2c2b2gResultSha256 !== reg.b2c2b2gResultSha256) issues.push('provenance.b2c2b2gResultSha256 is not the registered B2-C2B2G RESULT')
  if (provenance.b2c2b2fResultSha256 !== reg.b2c2b2fResultSha256) issues.push('provenance.b2c2b2fResultSha256 is not the registered B2-C2B2F RESULT')
  if (provenance.b2c2b2eResultSha256 !== reg.b2c2b2eResultSha256) issues.push('provenance.b2c2b2eResultSha256 is not the registered B2-C2B2E RESULT')
  if (typeof provenance.exportSha256 !== 'string' || !SHA256.test(provenance.exportSha256)) issues.push('provenance.exportSha256 is not a SHA-256')
  if (typeof provenance.probeManifestSha256 !== 'string' || !SHA256.test(provenance.probeManifestSha256)) issues.push('provenance.probeManifestSha256 is not a SHA-256')
  if (decision.case !== reg.decisionCase) issues.push(`decision.case ${String(decision.case)} is not ${reg.decisionCase}`)
  if (!same(decision.nextPhaseCategories, reg.nextPhaseCategories)) issues.push(`decision.nextPhaseCategories is not [${reg.nextPhaseCategories.join(', ')}]`)
  if (!Array.isArray(json.invalidReasons) || json.invalidReasons.length !== 0) issues.push('invalidReasons is not empty')
  if (!Array.isArray(json.insufficientReasons) || json.insufficientReasons.length !== 0) issues.push('insufficientReasons is not empty (the before CPU profile is not valid)')
  const keep = cat(cpuAttribution, PHASE2C26B2C2B2I_HOTSPOT_CATEGORY)
  const keepShare = num(keep?.shareOfActive)
  if (keepShare === null || keepShare < PHASE2C26B2C2B2I_BEFORE_MIN_HOTSPOT_SHARE) issues.push(`the keep_prediction active share ${String(keepShare)} is not >= ${PHASE2C26B2C2B2I_BEFORE_MIN_HOTSPOT_SHARE}`)
  const secondary = Array.isArray(decision.secondary) ? (decision.secondary as unknown[]).filter(isObject).find(s => s.category === PHASE2C26B2C2B2I_HOTSPOT_CATEGORY) : undefined
  if (secondary === undefined || secondary.shareOfActive !== keepShare) issues.push('decision.secondary does not record the keep_prediction share of cpuAttribution')
  if (!Array.isArray(cpuAttribution.registeredLineMismatches) || cpuAttribution.registeredLineMismatches.length !== 0) issues.push('the B2-C2B2H CPU profile has a registered frame line mismatch')
  const h = phase2c26b2c2b2hRegisteredConditions()
  if (!same(conditions.stage1, PHASE2C26B2C2B2H_STAGE1) || !same(conditions.stage1, h.stage1)) issues.push('conditions.stage1 is not B2-C2B2H\'s registered Stage 1 (30 minutes, 12,288 MB)')
  if (!same(conditions.searchInstrumentation, PHASE2C26B2C2B2H_SEARCH_INSTRUMENTATION)) issues.push('conditions.searchInstrumentation is not the two boundary observers')
  if (conditions.cpuProfiler !== true || !same(conditions.cpuProfilerConfig, PHASE2C26B2C2B2H_CPU_PROFILER)) issues.push('conditions.cpuProfilerConfig is not the registered CPU profiler window')
  if (!same(conditions.nodeFlags, PHASE2C26B2C2B2H_NODE_FLAGS)) issues.push('conditions.nodeFlags is not the heap flag alone')
  if (!allTrue(conditions.conditionChecks)) issues.push('conditions.conditionChecks is not all true')
  if (!allTrue(parity.hashChain)) issues.push('parity.hashChain is not all true')
  if (!allTrue(parity.childIdentity)) issues.push('parity.childIdentity is not all true')
  const populationParity = isObject(parity.population) ? parity.population : {}
  for (const key of ['manifestEqualsDerived', 'runnerTargetsEqualManifest', 'runnerProbesEqualManifest', 'runnerIdentitiesEqualManifest', 'probesEqualB2C2B2GProfiled', 'identitiesEqualB2C2B2GProfiled']) {
    if (populationParity[key] !== true) issues.push(`parity.population.${key} is not true`)
  }
  if (populationParity.targets !== reg.targets) issues.push(`parity.population.targets is not ${reg.targets}`)
  if (!allTrue(populationParity.chain)) issues.push('parity.population.chain is not all true')
  const rebuild = isObject(parity.taskRebuild) ? parity.taskRebuild : {}
  if (rebuild.valid !== true || rebuild.tasksEqualRebuilt !== true) issues.push('parity.taskRebuild is not valid / equal')
  const semantic = isObject(parity.semanticParityWithB2C2B2G) ? parity.semanticParityWithB2C2B2G : {}
  if (semantic.valid !== true || semantic.firstMismatch !== null) issues.push('parity.semanticParityWithB2C2B2G is not valid')
  const identity = isObject(parity.identity) ? parity.identity : {}
  if (identity.rawEqualsExpected !== true || !same(identity.raw, identity.expected)) issues.push('parity.identity.raw is not the expected identity')
  const expected = isObject(identity.expected) && PHASE2C26B2C2B2F_IDENTITY_FIELDS.every(field => field in (identity.expected as Json)) && Object.keys(identity.expected).length === PHASE2C26B2C2B2F_IDENTITY_FIELDS.length
    ? structuredClone(identity.expected) as unknown as Phase2C26B2C2B2FTaskIdentity : null
  if (expected === null) issues.push('parity.identity.expected is not a task identity')
  const route = isObject(parity.excludedRoute) ? parity.excludedRoute : {}
  const routeSha = typeof route.rederivedExcludedRouteKeySha256 === 'string' && SHA256.test(route.rederivedExcludedRouteKeySha256) ? route.rederivedExcludedRouteKeySha256 : null
  if (route.valid !== true || route.excludedRouteKeyCount !== 1 || route.excludedRouteIsCurrentRoute !== true || routeSha === null
    || route.b2c2b2gExcludedRouteKeySha256 !== routeSha || route.childAttestedExcludedRouteKeySha256 !== routeSha) issues.push('parity.excludedRoute is not one verified current Route equal across re-derivation, B2-C2B2G and the child')
  const targetWeaponIds = Array.isArray(population.targetWeaponIds) && population.targetWeaponIds.every(v => typeof v === 'string') ? [...population.targetWeaponIds as string[]] : []
  if (targetWeaponIds.length !== reg.targets) issues.push(`population.targetWeaponIds holds ${targetWeaponIds.length} Targets, not ${reg.targets}`)
  const probes = Array.isArray(population.probes) ? structuredClone(population.probes) as Phase2C26B2C2B2EProbe[] : []
  if (probes.length !== reg.targets) issues.push(`population.probes holds ${probes.length} probes, not ${reg.targets}`)
  if (!same(probes.map(p => p?.targetWeaponId), targetWeaponIds)) issues.push('population.probes do not name population.targetWeaponIds')
  const startAttestation = isObject(provenance.startAttestation) && isObject(provenance.startAttestation.body) ? provenance.startAttestation.body : null
  const attestedProbes = startAttestation !== null && Array.isArray(startAttestation.probes) ? structuredClone(startAttestation.probes) as Phase2C26B2C2B2EProbe[] : []
  const attestedIdentities = startAttestation !== null && Array.isArray(startAttestation.expectedTaskIdentities) ? structuredClone(startAttestation.expectedTaskIdentities) as Phase2C26B2C2B2FTaskIdentity[] : []
  if (startAttestation === null || startAttestation.repositoryHead !== reg.measuredHead) issues.push('the B2-C2B2H start attestation is missing or not at the registered measured HEAD')
  if (startAttestation !== null && startAttestation.probeManifestSha256 !== provenance.probeManifestSha256) issues.push('the B2-C2B2H start attestation manifest is not the recorded one')
  if (!same(attestedProbes, probes)) issues.push('the B2-C2B2H start-attested probes are not population.probes')
  if (expected === null || !same(attestedIdentities, [expected])) issues.push('the B2-C2B2H start-attested identities are not parity.identity.expected')
  const beforeFiles = {} as Record<Phase2C26B2C2B2IBeforeFile, { file: string; sha256: string }>
  for (const name of PHASE2C26B2C2B2I_BEFORE_FILES) {
    const source = sources[name]
    if (!isObject(source) || typeof source.file !== 'string' || typeof source.sha256 !== 'string' || !SHA256.test(source.sha256)) issues.push(`sources.${name} is not a file record`)
    else beforeFiles[name] = { file: source.file, sha256: source.sha256 }
  }
  if (issues.length > 0 || expected === null || routeSha === null || keepShare === null) return { valid: false, issues, authority: null }
  const lineTicks = Array.isArray(cpuAttribution.lineTicks) ? (cpuAttribution.lineTicks as unknown[]).filter(isObject).find(l => typeof l.registered === 'string' && l.registered.endsWith('#predictKeep')) : undefined
  const predictKeepLineTicks = (Array.isArray(lineTicks?.inSpan) ? lineTicks.inSpan as unknown[] : []).filter(isObject)
    .map(l => ({ line: num(l.line) ?? -1, text: String(l.text), ticks: num(l.ticks) ?? 0 }))
  const alignment = isObject(json.profilerWindow) && isObject(json.profilerWindow.clockAlignment) ? json.profilerWindow.clockAlignment : {}
  const intervals = isObject(json.intervals) ? json.intervals : {}
  return { valid: true, issues: [], authority: { resultSha256, measuredHead: String(provenance.measuredHead), decisionCase: String(decision.case),
    nextPhaseCategories: [...decision.nextPhaseCategories as string[]], exportSha256: String(provenance.exportSha256), b2c2b2gResultSha256: String(provenance.b2c2b2gResultSha256),
    b2c2b2fResultSha256: String(provenance.b2c2b2fResultSha256), b2c2b2eResultSha256: String(provenance.b2c2b2eResultSha256), probeManifestSha256: String(provenance.probeManifestSha256),
    targetWeaponIds, probes, expectedTaskIdentities: [expected], excludedRouteKeySha256: routeSha, attestedProbes, attestedIdentities, beforeFiles, keepPredictionShareOfActive: keepShare,
    conditions: { stage1: conditions.stage1, searchInstrumentation: conditions.searchInstrumentation, cpuProfilerConfig: conditions.cpuProfilerConfig, nodeFlags: conditions.nodeFlags },
    predictKeepLineTicks,
    background: { childOutcome: typeof outcome.process === 'string' ? outcome.process : null, depthRecords: num(intervals.depthRecordsCollected), peakHeapBytes: num(outcome.peakHeapBytes),
      peakRssBytes: num(outcome.peakRssBytes), activeSamples: num(cpuAttribution.activeSamples), intervalSamples: num(cpuAttribution.intervalSamples),
      profileDurationMs: num(alignment.profileDurationMs) } } }
}

// ---------------------------------------------------------------- population, probe and expected identity

export interface Phase2C26B2C2B2IDerivation {
  valid: boolean
  issues: string[]
  targetWeaponIds: string[]
  probes: Phase2C26B2C2B2EProbe[]
  expectedTaskIdentities: Phase2C26B2C2B2FTaskIdentity[]
  excludedRouteKeySha256: string | null
  chain: { b2c2b2gAuthorityIsB2C2B2HAuthority: boolean; b2c2b2fAuthorityIsB2C2B2HAuthority: boolean; b2c2b2eAuthorityIsB2C2B2HAuthority: boolean; targetsEqualB2C2B2HDerived: boolean;
    probesEqualB2C2B2HDerived: boolean; identitiesEqualB2C2B2HDerived: boolean; excludedRouteEqualsB2C2B2HDerived: boolean; exportEqualsB2C2B2G: boolean }
}

/**
 * The population, derived mechanically: the Target(s) of the B2-C2B2H RESULT (decision MIXED, next phase keep_prediction; exactly one,
 * or fail closed); its probe and expected identity are B2-C2B2H's population probe and recorded expected identity, and must equal the
 * Target, probe, identity and excluded Route key B2-C2B2H's own derivation (`phase2c26b2c2b2hPopulation()`) re-derives from the
 * B2-C2B2G / B2-C2B2F / B2-C2B2E RESULTs, over the Export they all recorded. Nothing here reaches the Search.
 */
export function phase2c26b2c2b2iPopulation(h: Phase2C26B2C2B2IB2C2B2HAuthority | null, g: Phase2C26B2C2B2HB2C2B2GAuthority | null, f: Phase2C26B2C2B2GB2C2B2FAuthority | null,
  e: Phase2C26B2C2B2FB2C2B2EAuthority | null): Phase2C26B2C2B2IDerivation {
  const chain = { b2c2b2gAuthorityIsB2C2B2HAuthority: false, b2c2b2fAuthorityIsB2C2B2HAuthority: false, b2c2b2eAuthorityIsB2C2B2HAuthority: false, targetsEqualB2C2B2HDerived: false,
    probesEqualB2C2B2HDerived: false, identitiesEqualB2C2B2HDerived: false, excludedRouteEqualsB2C2B2HDerived: false, exportEqualsB2C2B2G: false }
  const empty = { targetWeaponIds: [], probes: [], expectedTaskIdentities: [], excludedRouteKeySha256: null, chain }
  if (h === null) return { valid: false, issues: ['no B2-C2B2H authority'], ...empty }
  if (g === null) return { valid: false, issues: ['no B2-C2B2G authority'], ...empty }
  if (f === null) return { valid: false, issues: ['no B2-C2B2F authority'], ...empty }
  if (e === null) return { valid: false, issues: ['no B2-C2B2E authority'], ...empty }
  const reg = PHASE2C26B2C2B2I_REGISTERED_B2C2B2H
  const issues: string[] = []
  if (h.decisionCase !== reg.decisionCase || !same(h.nextPhaseCategories, reg.nextPhaseCategories)) {
    issues.push(`the B2-C2B2H decision is ${h.decisionCase} / [${h.nextPhaseCategories.join(', ')}], not ${reg.decisionCase} / [${reg.nextPhaseCategories.join(', ')}]`)
  }
  if (h.targetWeaponIds.length !== PHASE2C26B2C2B2I_EXPECTED_TASKS) issues.push(`${h.targetWeaponIds.length} B2-C2B2H profiled Targets, not ${PHASE2C26B2C2B2I_EXPECTED_TASKS}`)
  const derivedH = phase2c26b2c2b2hPopulation(g, f, e)
  if (!derivedH.valid) issues.push(...derivedH.issues.map(i => `B2-C2B2H-derived population: ${i}`))
  chain.b2c2b2gAuthorityIsB2C2B2HAuthority = g.resultSha256 === h.b2c2b2gResultSha256
  chain.b2c2b2fAuthorityIsB2C2B2HAuthority = f.resultSha256 === h.b2c2b2fResultSha256
  chain.b2c2b2eAuthorityIsB2C2B2HAuthority = e.resultSha256 === h.b2c2b2eResultSha256
  chain.targetsEqualB2C2B2HDerived = same(derivedH.targetWeaponIds, h.targetWeaponIds)
  chain.probesEqualB2C2B2HDerived = same(derivedH.probes, h.probes)
  chain.identitiesEqualB2C2B2HDerived = same(derivedH.expectedTaskIdentities, h.expectedTaskIdentities)
  chain.excludedRouteEqualsB2C2B2HDerived = derivedH.excludedRouteKeySha256 !== null && derivedH.excludedRouteKeySha256 === h.excludedRouteKeySha256
  chain.exportEqualsB2C2B2G = g.exportSha256 === h.exportSha256
  for (const [name, ok] of Object.entries(chain)) if (!ok) issues.push(`chain: ${name}`)
  if (!same(h.attestedProbes, h.probes) || !same(h.attestedIdentities, h.expectedTaskIdentities)) issues.push('the B2-C2B2H start-attested probe / identity is not the B2-C2B2H population')
  return { valid: issues.length === 0, issues, targetWeaponIds: [...h.targetWeaponIds], probes: structuredClone(h.probes), expectedTaskIdentities: structuredClone(h.expectedTaskIdentities),
    excludedRouteKeySha256: h.excludedRouteKeySha256, chain }
}

/** The probe manifest: the one probe and its expected Search input identity, and nothing else (no expected key / index / cost / outcome / section / hotspot / measurement). */
export function phase2c26b2c2b2iProbeManifest(h: Phase2C26B2C2B2IB2C2B2HAuthority, g: Phase2C26B2C2B2HB2C2B2GAuthority, f: Phase2C26B2C2B2GB2C2B2FAuthority,
  e: Phase2C26B2C2B2FB2C2B2EAuthority): Phase2C26B2C2B2IProbeManifest {
  const derived = phase2c26b2c2b2iPopulation(h, g, f, e)
  if (!derived.valid) throw new Error(`The B2-C2B2I population is not valid: ${derived.issues.join('; ')}`)
  const conditions = phase2c26b2c2b2hRegisteredConditions()
  return { phase: 'Issue #154 Phase 2-C2.6-B2-C2B2I probe manifest (B2-C2B2H keep_prediction profiled Target, B2-C2B2H Search input)', b2c2b2hResultSha256: h.resultSha256,
    b2c2b2gResultSha256: g.resultSha256, b2c2b2fResultSha256: f.resultSha256, b2c2b2eResultSha256: e.resultSha256, population: PHASE2C26B2C2B2I_POPULATION, policy: 'P1',
    contextSelection: conditions.contextSelection, extentRule: conditions.extentRule, exportSha256: h.exportSha256, probes: derived.probes,
    expectedTaskIdentities: derived.expectedTaskIdentities }
}
