/**
 * Issue #154 Phase 2-C2.6-B2-C2B2J: the formal before authority (the committed B2-C2B2I RESULT, decision ADOPTED), the population
 * (the one Target B2-C2B2I searched, = B2-C2B2H's), its probe and expected Search input identity, read mechanically from that RESULT
 * and cross-checked against the population, probe, identity and excluded Route that B2-C2B2I's own derivation re-derives from the
 * committed B2-C2B2H / B2-C2B2G / B2-C2B2F / B2-C2B2E RESULTs. Research only. Never import from Production, and never from the
 * B2-C2B2J Search side's child calculation (the runner reads the manifest built here, not a RESULT).
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
import type { Phase2C26B2C2B2HB2C2B2GAuthority } from './plannerGlobalPhase2C26B2C2B2HTargets'
import { PHASE2C26B2C2B2I_OPTIMIZATION } from './plannerGlobalPhase2C26B2C2B2I'
import {
  phase2c26b2c2b2iPopulation,
  PHASE2C26B2C2B2I_REGISTERED_B2C2B2H,
  type Phase2C26B2C2B2IB2C2B2HAuthority,
} from './plannerGlobalPhase2C26B2C2B2ITargets'
import {
  PHASE2C26B2C2B2J_BEFORE_FILES,
  PHASE2C26B2C2B2J_EXPECTED_TASKS,
  PHASE2C26B2C2B2J_POPULATION,
  type Phase2C26B2C2B2JBeforeFile,
  type Phase2C26B2C2B2JProbeManifest,
} from './plannerGlobalPhase2C26B2C2B2J'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}
const SHA256 = /^[0-9a-f]{64}$/
const allTrue = (value: unknown) => isObject(value) && Object.keys(value).length > 0 && Object.values(value).every(v => v === true)
const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null)

/** The registered function whose inclusive active CPU share this phase targets (B2-C2B2H's registry entry). */
export const PHASE2C26B2C2B2J_TARGET_FUNCTION = 'src/domain/rng/gogmaBonusFamily.ts#keepFamilyLayoutKey'

/** The B2-C2B2I RESULT (formal, B2C2B2I_ADOPTED) this phase takes as its before evidence. */
export const PHASE2C26B2C2B2J_REGISTERED_B2C2B2I = {
  resultSha256: 'ad877e1efd53b893ee48f9b9bc3747f51d4a278890a0dd7f96530d4bb4a1e4d4',
  decisionCase: 'B2C2B2I_ADOPTED',
  evidenceGrade: 'formal',
  measuredHead: '8f34b9772937c13c36102106722eab23094a9cb7',
  optimizationId: PHASE2C26B2C2B2I_OPTIMIZATION.id,
  targets: 1,
  /** The B2-C2B2H / G / F / E RESULTs B2-C2B2I was made against (B2-C2B2I's own registered authorities). */
  b2c2b2hResultSha256: PHASE2C26B2C2B2I_REGISTERED_B2C2B2H.resultSha256,
  b2c2b2gResultSha256: PHASE2C26B2C2B2I_REGISTERED_B2C2B2H.b2c2b2gResultSha256,
  b2c2b2fResultSha256: PHASE2C26B2C2B2I_REGISTERED_B2C2B2H.b2c2b2fResultSha256,
  b2c2b2eResultSha256: PHASE2C26B2C2B2I_REGISTERED_B2C2B2H.b2c2b2eResultSha256,
} as const

/** The B2-C2B2I RESULT facts this phase reads (post hoc and by the parent before launch; the Search never reads them). */
export interface Phase2C26B2C2B2JB2C2B2IAuthority {
  resultSha256: string
  measuredHead: string
  decisionCase: string
  exportSha256: string
  b2c2b2hResultSha256: string
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
  /** The B2-C2B2I formal raw files (their SHA-256 as the RESULT recorded them), the before evidence of the direct comparison. */
  beforeFiles: Record<Phase2C26B2C2B2JBeforeFile, { file: string; sha256: string }>
  /** keepFamilyLayoutKey registered inclusive active share of the B2-C2B2I after profile (re-derived from the profile by the analyzer). */
  keepFamilyLayoutKeyShareOfActive: number
  /** B2-C2B2I's direct ratio and keep ratio (background). */
  stateGenerationDirectRatio: number
  keepPredictionShareRatio: number
  conditions: { stage1: unknown; searchInstrumentation: unknown; cpuProfilerConfig: unknown; nodeFlags: unknown }
  background: { childOutcome: string | null; completedDepths: number | null; generatedStates: number | null; peakHeapBytes: number | null; peakRssBytes: number | null;
    activeSamples: number | null; gcSamples: number | null; gcShareOfActive: number | null }
}

const registeredInclusiveShare = (profile: unknown, registered: string) => {
  if (!isObject(profile) || !Array.isArray(profile.registeredInclusive)) return null
  const entry = (profile.registeredInclusive as unknown[]).filter(isObject).find(r => r.registered === registered)
  return num(entry?.shareOfActive)
}

/**
 * Reads the committed B2-C2B2I RESULT as untrusted JSON and fails closed unless it is the registered formal before authority: its
 * own SHA-256; formal with verified launch provenance, not partial, no calculation code change since its measured HEAD; the
 * registered measured HEAD, optimization and decision ADOPTED; no invalid reason; semantic parity valid; every hash chain, population,
 * child identity, condition check true; the task rebuilt and the identity equal to the expected one; the excluded current Route
 * verified (one key equal across the re-derivation, B2-C2B2H and the child); the Production change the registered one with a valid
 * source check; both profiles valid and the after profile with no quality issue and a keepFamilyLayoutKey inclusive share; the
 * B2-C2B2H / G / F / E RESULTs it was made against the registered ones; one Target, probe, identity; every after raw file recorded.
 */
export function parsePhase2C26B2C2B2JB2C2B2IAuthority(json: unknown, resultSha256: string): { valid: boolean; issues: string[]; authority: Phase2C26B2C2B2JB2C2B2IAuthority | null } {
  const reg = PHASE2C26B2C2B2J_REGISTERED_B2C2B2I
  const issues: string[] = []
  if (!isObject(json) || !isObject(json.provenance) || !isObject(json.decision) || !isObject(json.conditions) || !isObject(json.population) || !isObject(json.parity)
    || !isObject(json.outcome) || !isObject(json.sources) || !isObject(json.semanticParity) || !isObject(json.directComparison) || !isObject(json.cpuHotspot)
    || !isObject(json.profiles) || !isObject(json.productionChange)) {
    return { valid: false, issues: ['B2-C2B2I RESULT lacks provenance / decision / conditions / population / parity / outcome / sources / semanticParity / directComparison / cpuHotspot / profiles / productionChange'], authority: null }
  }
  const { provenance, decision, conditions, population, parity, outcome, sources, semanticParity, directComparison, cpuHotspot, profiles, productionChange } = json
  if (resultSha256 !== reg.resultSha256) issues.push(`B2-C2B2I RESULT SHA-256 ${resultSha256} is not the registered ${reg.resultSha256}`)
  if (provenance.formal !== true || provenance.evidenceGrade !== reg.evidenceGrade || provenance.launchProvenanceVerified !== true) issues.push('the B2-C2B2I RESULT is not formal with verified launch provenance')
  if (provenance.partialRun !== false) issues.push('the B2-C2B2I RESULT is a partial run')
  if (provenance.measuredHead !== reg.measuredHead) issues.push('provenance.measuredHead is not the registered B2-C2B2I measured HEAD')
  if (!Array.isArray(provenance.calculationCodeChangedSinceMeasuredHead) || provenance.calculationCodeChangedSinceMeasuredHead.length !== 0) issues.push('the B2-C2B2I calculation code changed since its measured HEAD')
  if (provenance.productionOptimizationId !== reg.optimizationId) issues.push(`provenance.productionOptimizationId is not ${reg.optimizationId}`)
  if (provenance.b2c2b2hResultSha256 !== reg.b2c2b2hResultSha256) issues.push('provenance.b2c2b2hResultSha256 is not the registered B2-C2B2H RESULT')
  if (provenance.b2c2b2gResultSha256 !== reg.b2c2b2gResultSha256) issues.push('provenance.b2c2b2gResultSha256 is not the registered B2-C2B2G RESULT')
  if (provenance.b2c2b2fResultSha256 !== reg.b2c2b2fResultSha256) issues.push('provenance.b2c2b2fResultSha256 is not the registered B2-C2B2F RESULT')
  if (provenance.b2c2b2eResultSha256 !== reg.b2c2b2eResultSha256) issues.push('provenance.b2c2b2eResultSha256 is not the registered B2-C2B2E RESULT')
  if (typeof provenance.exportSha256 !== 'string' || !SHA256.test(provenance.exportSha256)) issues.push('provenance.exportSha256 is not a SHA-256')
  if (typeof provenance.probeManifestSha256 !== 'string' || !SHA256.test(provenance.probeManifestSha256)) issues.push('provenance.probeManifestSha256 is not a SHA-256')
  if (decision.case !== reg.decisionCase || decision.adoption !== 'adopt') issues.push(`decision is ${String(decision.case)} / ${String(decision.adoption)}, not ${reg.decisionCase} / adopt`)
  if (!Array.isArray(json.invalidReasons) || json.invalidReasons.length !== 0) issues.push('invalidReasons is not empty')
  if (!Array.isArray(json.afterProfileQualityIssues) || json.afterProfileQualityIssues.length !== 0) issues.push('afterProfileQualityIssues is not empty (the after CPU profile is not valid)')
  if (semanticParity.valid !== true) issues.push('semanticParity.valid is not true')
  if (directComparison.valid !== true || directComparison.semanticParity !== true || directComparison.firstMismatch !== null) issues.push('directComparison is not a valid semantic-identical comparison')
  if (cpuHotspot.beforeProfileValid !== true || cpuHotspot.afterProfileValid !== true || cpuHotspot.beforeReproduced !== true) issues.push('cpuHotspot: a profile is not valid or the before share was not reproduced')
  const afterProfile = isObject(profiles.after) ? profiles.after : {}
  if (afterProfile.valid !== true || !Array.isArray(afterProfile.qualityIssues) || afterProfile.qualityIssues.length !== 0) issues.push('profiles.after is not a valid profile')
  if (!Array.isArray(afterProfile.registeredLineMismatches) || afterProfile.registeredLineMismatches.length !== 0) issues.push('profiles.after has a registered frame line mismatch')
  const keyShare = registeredInclusiveShare(afterProfile, PHASE2C26B2C2B2J_TARGET_FUNCTION)
  if (keyShare === null || !(keyShare > 0)) issues.push(`profiles.after.registeredInclusive has no positive ${PHASE2C26B2C2B2J_TARGET_FUNCTION} share`)
  const directRatio = num(decision.stateGenerationDirectRatio), keepRatio = num(decision.keepPredictionShareRatio)
  if (directRatio === null || keepRatio === null) issues.push('decision ratios are not numbers')
  const sourceCheck = isObject(productionChange.sourceCheck) ? productionChange.sourceCheck : {}
  if (productionChange.equalsRegistered !== true || productionChange.equalsRunnerAttested !== true || sourceCheck.valid !== true) issues.push('productionChange is not the registered, attested, valid B2-C2B2I change')
  const h = phase2c26b2c2b2hRegisteredConditions()
  if (!same(conditions.stage1, PHASE2C26B2C2B2H_STAGE1) || !same(conditions.stage1, h.stage1)) issues.push('conditions.stage1 is not the registered Stage 1 (30 minutes, 12,288 MB)')
  if (!same(conditions.searchInstrumentation, PHASE2C26B2C2B2H_SEARCH_INSTRUMENTATION)) issues.push('conditions.searchInstrumentation is not the two boundary observers')
  if (conditions.cpuProfiler !== true || !same(conditions.cpuProfilerConfig, PHASE2C26B2C2B2H_CPU_PROFILER)) issues.push('conditions.cpuProfilerConfig is not the registered CPU profiler window')
  if (!same(conditions.nodeFlags, PHASE2C26B2C2B2H_NODE_FLAGS)) issues.push('conditions.nodeFlags is not the heap flag alone')
  if (!allTrue(conditions.conditionChecks)) issues.push('conditions.conditionChecks is not all true')
  if (!allTrue(parity.hashChain)) issues.push('parity.hashChain is not all true')
  if (!allTrue(parity.childIdentity)) issues.push('parity.childIdentity is not all true')
  const searchInput = isObject(semanticParity.searchInputAndExcludedRoute) ? semanticParity.searchInputAndExcludedRoute : {}
  if (searchInput.valid !== true || !allTrue(searchInput.checks)) issues.push('semanticParity.searchInputAndExcludedRoute is not valid')
  const populationParity = isObject(parity.population) ? parity.population : {}
  for (const key of ['manifestEqualsDerived', 'runnerTargetsEqualManifest', 'runnerProbesEqualManifest', 'runnerIdentitiesEqualManifest', 'probesEqualB2C2B2HProfiled', 'identitiesEqualB2C2B2HProfiled']) {
    if (populationParity[key] !== true) issues.push(`parity.population.${key} is not true`)
  }
  if (populationParity.targets !== reg.targets) issues.push(`parity.population.targets is not ${reg.targets}`)
  if (!allTrue(populationParity.chain)) issues.push('parity.population.chain is not all true')
  const rebuild = isObject(parity.taskRebuild) ? parity.taskRebuild : {}
  if (rebuild.valid !== true || rebuild.tasksEqualRebuilt !== true) issues.push('parity.taskRebuild is not valid / equal')
  const identity = isObject(parity.identity) ? parity.identity : {}
  if (identity.rawEqualsExpected !== true || !same(identity.raw, identity.expected)) issues.push('parity.identity.raw is not the expected identity')
  const expected = isObject(identity.expected) && PHASE2C26B2C2B2F_IDENTITY_FIELDS.every(field => field in (identity.expected as Json)) && Object.keys(identity.expected).length === PHASE2C26B2C2B2F_IDENTITY_FIELDS.length
    ? structuredClone(identity.expected) as unknown as Phase2C26B2C2B2FTaskIdentity : null
  if (expected === null) issues.push('parity.identity.expected is not a task identity')
  const route = isObject(parity.excludedRoute) ? parity.excludedRoute : {}
  const routeSha = typeof route.rederivedExcludedRouteKeySha256 === 'string' && SHA256.test(route.rederivedExcludedRouteKeySha256) ? route.rederivedExcludedRouteKeySha256 : null
  if (route.valid !== true || route.excludedRouteKeyCount !== 1 || route.excludedRouteIsCurrentRoute !== true || routeSha === null
    || route.b2c2b2hExcludedRouteKeySha256 !== routeSha || route.childAttestedExcludedRouteKeySha256 !== routeSha) issues.push('parity.excludedRoute is not one verified current Route equal across re-derivation, B2-C2B2H and the child')
  const targetWeaponIds = Array.isArray(population.targetWeaponIds) && population.targetWeaponIds.every(v => typeof v === 'string') ? [...population.targetWeaponIds as string[]] : []
  if (targetWeaponIds.length !== reg.targets) issues.push(`population.targetWeaponIds holds ${targetWeaponIds.length} Targets, not ${reg.targets}`)
  const probes = Array.isArray(population.probes) ? structuredClone(population.probes) as Phase2C26B2C2B2EProbe[] : []
  if (probes.length !== reg.targets) issues.push(`population.probes holds ${probes.length} probes, not ${reg.targets}`)
  if (!same(probes.map(p => p?.targetWeaponId), targetWeaponIds)) issues.push('population.probes do not name population.targetWeaponIds')
  const startAttestation = isObject(provenance.startAttestation) && isObject(provenance.startAttestation.body) ? provenance.startAttestation.body : null
  const attestedProbes = startAttestation !== null && Array.isArray(startAttestation.probes) ? structuredClone(startAttestation.probes) as Phase2C26B2C2B2EProbe[] : []
  const attestedIdentities = startAttestation !== null && Array.isArray(startAttestation.expectedTaskIdentities) ? structuredClone(startAttestation.expectedTaskIdentities) as Phase2C26B2C2B2FTaskIdentity[] : []
  if (startAttestation === null || startAttestation.repositoryHead !== reg.measuredHead) issues.push('the B2-C2B2I start attestation is missing or not at the registered measured HEAD')
  if (startAttestation !== null && startAttestation.probeManifestSha256 !== provenance.probeManifestSha256) issues.push('the B2-C2B2I start attestation manifest is not the recorded one')
  if (!same(attestedProbes, probes)) issues.push('the B2-C2B2I start-attested probes are not population.probes')
  if (expected === null || !same(attestedIdentities, [expected])) issues.push('the B2-C2B2I start-attested identities are not parity.identity.expected')
  const beforeFiles = {} as Record<Phase2C26B2C2B2JBeforeFile, { file: string; sha256: string }>
  for (const name of PHASE2C26B2C2B2J_BEFORE_FILES) {
    const source = sources[name]
    if (!isObject(source) || typeof source.file !== 'string' || typeof source.sha256 !== 'string' || !SHA256.test(source.sha256)) issues.push(`sources.${name} is not a file record`)
    else beforeFiles[name] = { file: source.file, sha256: source.sha256 }
  }
  if (issues.length > 0 || expected === null || routeSha === null || keyShare === null || directRatio === null || keepRatio === null) return { valid: false, issues, authority: null }
  const gc = Array.isArray(afterProfile.categories) ? (afterProfile.categories as unknown[]).filter(isObject).find(c => c.category === 'gc') : undefined
  const samples = isObject(afterProfile.samples) ? afterProfile.samples : {}
  return { valid: true, issues: [], authority: { resultSha256, measuredHead: String(provenance.measuredHead), decisionCase: String(decision.case),
    exportSha256: String(provenance.exportSha256), b2c2b2hResultSha256: String(provenance.b2c2b2hResultSha256), b2c2b2gResultSha256: String(provenance.b2c2b2gResultSha256),
    b2c2b2fResultSha256: String(provenance.b2c2b2fResultSha256), b2c2b2eResultSha256: String(provenance.b2c2b2eResultSha256), probeManifestSha256: String(provenance.probeManifestSha256),
    targetWeaponIds, probes, expectedTaskIdentities: [expected], excludedRouteKeySha256: routeSha, attestedProbes, attestedIdentities, beforeFiles,
    keepFamilyLayoutKeyShareOfActive: keyShare, stateGenerationDirectRatio: directRatio, keepPredictionShareRatio: keepRatio,
    conditions: { stage1: conditions.stage1, searchInstrumentation: conditions.searchInstrumentation, cpuProfilerConfig: conditions.cpuProfilerConfig, nodeFlags: conditions.nodeFlags },
    background: { childOutcome: typeof outcome.process === 'string' ? outcome.process : null, completedDepths: num(outcome.completedDepths), generatedStates: num(outcome.generatedStates),
      peakHeapBytes: num(outcome.peakHeapBytes), peakRssBytes: num(outcome.peakRssBytes), activeSamples: num(samples.active), gcSamples: num(gc?.samples),
      gcShareOfActive: num(gc?.shareOfActive) } } }
}

// ---------------------------------------------------------------- population, probe and expected identity

export interface Phase2C26B2C2B2JDerivation {
  valid: boolean
  issues: string[]
  targetWeaponIds: string[]
  probes: Phase2C26B2C2B2EProbe[]
  expectedTaskIdentities: Phase2C26B2C2B2FTaskIdentity[]
  excludedRouteKeySha256: string | null
  chain: { b2c2b2hAuthorityIsB2C2B2IAuthority: boolean; b2c2b2gAuthorityIsB2C2B2IAuthority: boolean; b2c2b2fAuthorityIsB2C2B2IAuthority: boolean;
    b2c2b2eAuthorityIsB2C2B2IAuthority: boolean; targetsEqualB2C2B2IDerived: boolean; probesEqualB2C2B2IDerived: boolean; identitiesEqualB2C2B2IDerived: boolean;
    excludedRouteEqualsB2C2B2IDerived: boolean; exportEqualsB2C2B2H: boolean }
}

/**
 * The population, derived mechanically: the Target of the B2-C2B2I RESULT (decision ADOPTED; exactly one, or fail closed); its probe
 * and expected identity are B2-C2B2I's population probe and recorded expected identity, and must equal the Target, probe, identity and
 * excluded Route key B2-C2B2I's own derivation (`phase2c26b2c2b2iPopulation()`) re-derives from the B2-C2B2H / G / F / E RESULTs, over
 * the Export they all recorded. Nothing here reaches the Search.
 */
export function phase2c26b2c2b2jPopulation(i: Phase2C26B2C2B2JB2C2B2IAuthority | null, h: Phase2C26B2C2B2IB2C2B2HAuthority | null, g: Phase2C26B2C2B2HB2C2B2GAuthority | null,
  f: Phase2C26B2C2B2GB2C2B2FAuthority | null, e: Phase2C26B2C2B2FB2C2B2EAuthority | null): Phase2C26B2C2B2JDerivation {
  const chain = { b2c2b2hAuthorityIsB2C2B2IAuthority: false, b2c2b2gAuthorityIsB2C2B2IAuthority: false, b2c2b2fAuthorityIsB2C2B2IAuthority: false,
    b2c2b2eAuthorityIsB2C2B2IAuthority: false, targetsEqualB2C2B2IDerived: false, probesEqualB2C2B2IDerived: false, identitiesEqualB2C2B2IDerived: false,
    excludedRouteEqualsB2C2B2IDerived: false, exportEqualsB2C2B2H: false }
  const empty = { targetWeaponIds: [], probes: [], expectedTaskIdentities: [], excludedRouteKeySha256: null, chain }
  if (i === null) return { valid: false, issues: ['no B2-C2B2I authority'], ...empty }
  if (h === null) return { valid: false, issues: ['no B2-C2B2H authority'], ...empty }
  if (g === null) return { valid: false, issues: ['no B2-C2B2G authority'], ...empty }
  if (f === null) return { valid: false, issues: ['no B2-C2B2F authority'], ...empty }
  if (e === null) return { valid: false, issues: ['no B2-C2B2E authority'], ...empty }
  const reg = PHASE2C26B2C2B2J_REGISTERED_B2C2B2I
  const issues: string[] = []
  if (i.decisionCase !== reg.decisionCase) issues.push(`the B2-C2B2I decision is ${i.decisionCase}, not ${reg.decisionCase}`)
  if (i.targetWeaponIds.length !== PHASE2C26B2C2B2J_EXPECTED_TASKS) issues.push(`${i.targetWeaponIds.length} B2-C2B2I Targets, not ${PHASE2C26B2C2B2J_EXPECTED_TASKS}`)
  const derivedI = phase2c26b2c2b2iPopulation(h, g, f, e)
  if (!derivedI.valid) issues.push(...derivedI.issues.map(x => `B2-C2B2I-derived population: ${x}`))
  chain.b2c2b2hAuthorityIsB2C2B2IAuthority = h.resultSha256 === i.b2c2b2hResultSha256
  chain.b2c2b2gAuthorityIsB2C2B2IAuthority = g.resultSha256 === i.b2c2b2gResultSha256
  chain.b2c2b2fAuthorityIsB2C2B2IAuthority = f.resultSha256 === i.b2c2b2fResultSha256
  chain.b2c2b2eAuthorityIsB2C2B2IAuthority = e.resultSha256 === i.b2c2b2eResultSha256
  chain.targetsEqualB2C2B2IDerived = same(derivedI.targetWeaponIds, i.targetWeaponIds)
  chain.probesEqualB2C2B2IDerived = same(derivedI.probes, i.probes)
  chain.identitiesEqualB2C2B2IDerived = same(derivedI.expectedTaskIdentities, i.expectedTaskIdentities)
  chain.excludedRouteEqualsB2C2B2IDerived = derivedI.excludedRouteKeySha256 !== null && derivedI.excludedRouteKeySha256 === i.excludedRouteKeySha256
  chain.exportEqualsB2C2B2H = h.exportSha256 === i.exportSha256
  for (const [name, ok] of Object.entries(chain)) if (!ok) issues.push(`chain: ${name}`)
  if (!same(i.attestedProbes, i.probes) || !same(i.attestedIdentities, i.expectedTaskIdentities)) issues.push('the B2-C2B2I start-attested probe / identity is not the B2-C2B2I population')
  return { valid: issues.length === 0, issues, targetWeaponIds: [...i.targetWeaponIds], probes: structuredClone(i.probes), expectedTaskIdentities: structuredClone(i.expectedTaskIdentities),
    excludedRouteKeySha256: i.excludedRouteKeySha256, chain }
}

/** The probe manifest: the one probe and its expected Search input identity, and nothing else (no expected key / index / cost / outcome / section / hotspot / measurement). */
export function phase2c26b2c2b2jProbeManifest(i: Phase2C26B2C2B2JB2C2B2IAuthority, h: Phase2C26B2C2B2IB2C2B2HAuthority, g: Phase2C26B2C2B2HB2C2B2GAuthority,
  f: Phase2C26B2C2B2GB2C2B2FAuthority, e: Phase2C26B2C2B2FB2C2B2EAuthority): Phase2C26B2C2B2JProbeManifest {
  const derived = phase2c26b2c2b2jPopulation(i, h, g, f, e)
  if (!derived.valid) throw new Error(`The B2-C2B2J population is not valid: ${derived.issues.join('; ')}`)
  const conditions = phase2c26b2c2b2hRegisteredConditions()
  return { phase: 'Issue #154 Phase 2-C2.6-B2-C2B2J probe manifest (B2-C2B2I adopted profiled Target, B2-C2B2I Search input)', b2c2b2iResultSha256: i.resultSha256,
    b2c2b2hResultSha256: h.resultSha256, b2c2b2gResultSha256: g.resultSha256, b2c2b2fResultSha256: f.resultSha256, b2c2b2eResultSha256: e.resultSha256,
    population: PHASE2C26B2C2B2J_POPULATION, policy: 'P1', contextSelection: conditions.contextSelection, extentRule: conditions.extentRule, exportSha256: i.exportSha256,
    probes: derived.probes, expectedTaskIdentities: derived.expectedTaskIdentities }
}
