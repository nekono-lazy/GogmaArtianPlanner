/**
 * Issue #154 Phase 2-C2.6-B2-C2B2H: the population (the Target B2-C2B2G profiled with decision STATE_GENERATION dominant), its probe
 * and its expected Search input identity, read mechanically from the committed B2-C2B2G RESULT and cross-checked against the
 * population, probe, identity and excluded Route that B2-C2B2G's own derivation re-derives from the committed B2-C2B2F and B2-C2B2E
 * RESULTs (the B2-C2B2G -> B2-C2B2F -> B2-C2B2E authority chain). Research only. Never import from Production, and never from the
 * B2-C2B2H Search side's child calculation (the runner never reads this module; it reads the manifest built here).
 *
 * Nothing about the population is written down here: the Target, task, rank, extent, group, digests and excluded Route key come from
 * the RESULTs.
 */
import { stableStringify } from '../domain/models/hashing'
import type { Phase2C26B2C2B2EProbe } from './plannerGlobalPhase2C26B2C2B2E'
import { PHASE2C26B2C2B2F_IDENTITY_FIELDS, type Phase2C26B2C2B2FTaskIdentity } from './plannerGlobalPhase2C26B2C2B2F'
import type { Phase2C26B2C2B2FB2C2B2EAuthority } from './plannerGlobalPhase2C26B2C2B2FTargets'
import { PHASE2C26B2C2B2G_SEARCH_INSTRUMENTATION, PHASE2C26B2C2B2G_STAGE1 } from './plannerGlobalPhase2C26B2C2B2G'
import {
  phase2c26b2c2b2gPopulation,
  PHASE2C26B2C2B2G_REGISTERED_B2C2B2F,
  type Phase2C26B2C2B2GB2C2B2FAuthority,
} from './plannerGlobalPhase2C26B2C2B2GTargets'
import {
  PHASE2C26B2C2B2H_CONTEXT_SELECTION,
  PHASE2C26B2C2B2H_EXPECTED_TASKS,
  PHASE2C26B2C2B2H_EXTENT_RULE,
  PHASE2C26B2C2B2H_POPULATION,
  PHASE2C26B2C2B2H_SECTION,
  type Phase2C26B2C2B2HProbeManifest,
} from './plannerGlobalPhase2C26B2C2B2H'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}
const SHA256 = /^[0-9a-f]{64}$/
const allTrue = (value: unknown) => isObject(value) && Object.keys(value).length > 0 && Object.values(value).every(v => v === true)
const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null)

/** The B2-C2B2G RESULT (formal, B2C2B2G_STATE_GENERATION_DOMINANT) this phase attributes CPU from. */
export const PHASE2C26B2C2B2H_REGISTERED_B2C2B2G = {
  resultSha256: 'ff163148a5dc32218868838d24985ba64a2b664618545033cddd9b162cd9a011',
  decisionCase: 'B2C2B2G_STATE_GENERATION_DOMINANT',
  dominant: PHASE2C26B2C2B2H_SECTION,
  nextPhaseSections: [PHASE2C26B2C2B2H_SECTION],
  evidenceGrade: 'formal',
  measuredHead: '03e2f73ca58330f3d55afb49b29a02328c341e4e',
  targets: 1,
  stage1: { ...PHASE2C26B2C2B2G_STAGE1 },
  searchInstrumentation: { ...PHASE2C26B2C2B2G_SEARCH_INSTRUMENTATION },
  /** The B2-C2B2F / B2-C2B2E RESULTs B2-C2B2G was made against (B2-C2B2G's own registered authorities). */
  b2c2b2fResultSha256: PHASE2C26B2C2B2G_REGISTERED_B2C2B2F.resultSha256,
  b2c2b2eResultSha256: PHASE2C26B2C2B2G_REGISTERED_B2C2B2F.b2c2b2eResultSha256,
} as const

/** The B2-C2B2G RESULT facts this phase reads (post hoc; the Search never reads them). */
export interface Phase2C26B2C2B2HB2C2B2GAuthority {
  resultSha256: string
  measuredHead: string
  decisionCase: string
  dominant: string
  nextPhaseSections: string[]
  exportSha256: string
  b2c2b2fResultSha256: string
  b2c2b2eResultSha256: string
  probeManifestSha256: string
  targetWeaponIds: string[]
  probes: Phase2C26B2C2B2EProbe[]
  expectedTaskIdentities: Phase2C26B2C2B2FTaskIdentity[]
  excludedRouteKeySha256: string
  attestedProbes: Phase2C26B2C2B2EProbe[]
  attestedIdentities: Phase2C26B2C2B2FTaskIdentity[]
  /** The B2-C2B2G profile file (its held-aware depth records are the semantic parity reference of this run). */
  profileFile: { file: string; sha256: string }
  /** B2-C2B2G's measurements, background only (never a Search input, never a decision input here). */
  background: { searchWallMs: number | null; bonusDepthReadMs: number | null; stateGenerationMs: number | null; stateGenerationShareOfBonusDepthRead: number | null;
    stateGenerationYieldCount: number | null; stateGenerationYieldWaitMs: number | null; generatedStates: number | null; completedDepths: number | null; childOutcome: string | null }
}

/**
 * Reads the committed B2-C2B2G RESULT as untrusted JSON and fails closed unless it is the registered formal result: its own SHA-256;
 * formal with verified launch provenance, not partial; the registered measured HEAD, decision case, dominant section and next phase
 * section, no invalid reason; B2-C2B2G's Stage 1 (30 minutes / 12,288 MB), the two boundary observers, no CPU profiler; every
 * condition check, hash chain, population parity, child-attested identity check true; the task rebuilt and the raw identity equal to
 * the expected one; the excluded current Route verified with one key equal across the re-derivation, B2-C2B2F and the child; the
 * B2-C2B2F / B2-C2B2E RESULTs it was made against the registered ones; one Target, one probe, one expected identity, one attested probe.
 */
export function parsePhase2C26B2C2B2HB2C2B2GAuthority(json: unknown, resultSha256: string): { valid: boolean; issues: string[]; authority: Phase2C26B2C2B2HB2C2B2GAuthority | null } {
  const reg = PHASE2C26B2C2B2H_REGISTERED_B2C2B2G
  const issues: string[] = []
  if (!isObject(json) || !isObject(json.provenance) || !isObject(json.decision) || !isObject(json.conditions) || !isObject(json.population) || !isObject(json.parity)
    || !isObject(json.outcome) || !isObject(json.sources)) {
    return { valid: false, issues: ['B2-C2B2G RESULT lacks provenance / decision / conditions / population / parity / outcome / sources'], authority: null }
  }
  const { provenance, decision, conditions, population, parity, outcome, sources } = json
  if (resultSha256 !== reg.resultSha256) issues.push(`B2-C2B2G RESULT SHA-256 ${resultSha256} is not the registered ${reg.resultSha256}`)
  if (provenance.formal !== true || provenance.evidenceGrade !== reg.evidenceGrade || provenance.launchProvenanceVerified !== true) issues.push('the B2-C2B2G RESULT is not formal with verified launch provenance')
  if (provenance.partialRun !== false) issues.push('the B2-C2B2G RESULT is a partial run')
  if (provenance.measuredHead !== reg.measuredHead) issues.push('provenance.measuredHead is not the registered B2-C2B2G measured HEAD')
  if (!Array.isArray(provenance.calculationCodeChangedSinceMeasuredHead) || provenance.calculationCodeChangedSinceMeasuredHead.length !== 0) issues.push('the B2-C2B2G calculation code changed since its measured HEAD')
  if (provenance.b2c2b2fResultSha256 !== reg.b2c2b2fResultSha256) issues.push('provenance.b2c2b2fResultSha256 is not the registered B2-C2B2F RESULT')
  if (provenance.b2c2b2eResultSha256 !== reg.b2c2b2eResultSha256) issues.push('provenance.b2c2b2eResultSha256 is not the registered B2-C2B2E RESULT')
  if (typeof provenance.exportSha256 !== 'string' || !SHA256.test(provenance.exportSha256)) issues.push('provenance.exportSha256 is not a SHA-256')
  if (typeof provenance.probeManifestSha256 !== 'string' || !SHA256.test(provenance.probeManifestSha256)) issues.push('provenance.probeManifestSha256 is not a SHA-256')
  if (decision.case !== reg.decisionCase) issues.push(`decision.case ${String(decision.case)} is not ${reg.decisionCase}`)
  if (decision.dominant !== reg.dominant) issues.push(`decision.dominant ${String(decision.dominant)} is not ${reg.dominant}`)
  if (!same(decision.nextPhaseSections, reg.nextPhaseSections)) issues.push(`decision.nextPhaseSections is not [${reg.nextPhaseSections.join(', ')}]`)
  if (!Array.isArray(json.invalidReasons) || json.invalidReasons.length !== 0) issues.push('invalidReasons is not empty')
  if (!same(conditions.stage1, reg.stage1)) issues.push('conditions.stage1 is not B2-C2B2G\'s registered Stage 1 (30 minutes, 12,288 MB)')
  if (!same(conditions.searchInstrumentation, reg.searchInstrumentation)) issues.push('conditions.searchInstrumentation is not the two boundary observers')
  if (conditions.cpuProfiler !== false) issues.push('conditions.cpuProfiler is not false')
  if (!allTrue(conditions.conditionChecks)) issues.push('conditions.conditionChecks is not all true')
  if (!allTrue(parity.hashChain)) issues.push('parity.hashChain is not all true')
  if (!allTrue(parity.childIdentity)) issues.push('parity.childIdentity is not all true')
  const populationParity = isObject(parity.population) ? parity.population : {}
  for (const key of ['manifestEqualsDerived', 'runnerTargetsEqualManifest', 'runnerProbesEqualManifest', 'runnerIdentitiesEqualManifest', 'probesEqualB2C2B2FProfiled', 'identitiesEqualB2C2B2FProfiled']) {
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
    || route.b2c2b2fExcludedRouteKeySha256 !== routeSha || route.childAttestedExcludedRouteKeySha256 !== routeSha) issues.push('parity.excludedRoute is not one verified current Route equal across re-derivation, B2-C2B2F and the child')
  const targetWeaponIds = Array.isArray(population.targetWeaponIds) && population.targetWeaponIds.every(v => typeof v === 'string') ? [...population.targetWeaponIds as string[]] : []
  if (targetWeaponIds.length !== reg.targets) issues.push(`population.targetWeaponIds holds ${targetWeaponIds.length} Targets, not ${reg.targets}`)
  const probes = Array.isArray(population.probes) ? structuredClone(population.probes) as Phase2C26B2C2B2EProbe[] : []
  if (probes.length !== reg.targets) issues.push(`population.probes holds ${probes.length} probes, not ${reg.targets}`)
  if (!same(probes.map(p => p?.targetWeaponId), targetWeaponIds)) issues.push('population.probes do not name population.targetWeaponIds')
  const startAttestation = isObject(provenance.startAttestation) && isObject(provenance.startAttestation.body) ? provenance.startAttestation.body : null
  const attestedProbes = startAttestation !== null && Array.isArray(startAttestation.probes) ? structuredClone(startAttestation.probes) as Phase2C26B2C2B2EProbe[] : []
  const attestedIdentities = startAttestation !== null && Array.isArray(startAttestation.expectedTaskIdentities) ? structuredClone(startAttestation.expectedTaskIdentities) as Phase2C26B2C2B2FTaskIdentity[] : []
  if (startAttestation === null || startAttestation.repositoryHead !== reg.measuredHead) issues.push('the B2-C2B2G start attestation is missing or not at the registered measured HEAD')
  if (startAttestation !== null && startAttestation.probeManifestSha256 !== provenance.probeManifestSha256) issues.push('the B2-C2B2G start attestation manifest is not the recorded one')
  if (!same(attestedProbes, probes)) issues.push('the B2-C2B2G start-attested probes are not population.probes')
  if (expected === null || !same(attestedIdentities, [expected])) issues.push('the B2-C2B2G start-attested identities are not parity.identity.expected')
  const profileSource = isObject(sources.profile) ? sources.profile : {}
  const profileFile = typeof profileSource.file === 'string' && typeof profileSource.sha256 === 'string' && SHA256.test(profileSource.sha256)
    ? { file: profileSource.file, sha256: profileSource.sha256 } : null
  if (profileFile === null) issues.push('sources.profile is not a profile file record')
  if (issues.length > 0 || expected === null || routeSha === null || profileFile === null) return { valid: false, issues, authority: null }
  const profile = isObject(json.profile) ? json.profile : {}
  const reconciliation = isObject(profile.reconciliation) ? profile.reconciliation : {}
  const stateRow = Array.isArray(reconciliation.sections) ? (reconciliation.sections as unknown[]).filter(isObject).find(s => s.section === PHASE2C26B2C2B2H_SECTION) : undefined
  const yieldSlot = isObject(profile.yieldsByInnerSection) && isObject(profile.yieldsByInnerSection[PHASE2C26B2C2B2H_SECTION]) ? profile.yieldsByInnerSection[PHASE2C26B2C2B2H_SECTION] as Json : {}
  const counts = isObject(profile.innerCounts) ? profile.innerCounts : {}
  return { valid: true, issues: [], authority: { resultSha256, measuredHead: String(provenance.measuredHead), decisionCase: String(decision.case), dominant: String(decision.dominant),
    nextPhaseSections: [...decision.nextPhaseSections as string[]], exportSha256: String(provenance.exportSha256), b2c2b2fResultSha256: String(provenance.b2c2b2fResultSha256),
    b2c2b2eResultSha256: String(provenance.b2c2b2eResultSha256), probeManifestSha256: String(provenance.probeManifestSha256), targetWeaponIds, probes, expectedTaskIdentities: [expected],
    excludedRouteKeySha256: routeSha, attestedProbes, attestedIdentities, profileFile,
    background: { searchWallMs: num(reconciliation.searchWallMs), bonusDepthReadMs: num(reconciliation.bonusDepthReadMs), stateGenerationMs: num(stateRow?.totalMs),
      stateGenerationShareOfBonusDepthRead: num(stateRow?.shareOfBonusDepthRead), stateGenerationYieldCount: num(yieldSlot.count), stateGenerationYieldWaitMs: num(yieldSlot.totalMs),
      generatedStates: num(counts.generatedStatesSum), completedDepths: num(counts.completedDepths), childOutcome: typeof outcome.process === 'string' ? outcome.process : null } } }
}

// ---------------------------------------------------------------- population, probe and expected identity

export interface Phase2C26B2C2B2HDerivation {
  valid: boolean
  issues: string[]
  targetWeaponIds: string[]
  probes: Phase2C26B2C2B2EProbe[]
  expectedTaskIdentities: Phase2C26B2C2B2FTaskIdentity[]
  excludedRouteKeySha256: string | null
  chain: { b2c2b2fAuthorityIsB2C2B2GAuthority: boolean; b2c2b2eAuthorityIsB2C2B2GAuthority: boolean; targetsEqualB2C2B2GDerived: boolean; probesEqualB2C2B2GDerived: boolean;
    identitiesEqualB2C2B2GDerived: boolean; excludedRouteEqualsB2C2B2GDerived: boolean; exportEqualsB2C2B2F: boolean }
}

/**
 * The population, derived mechanically: the Target(s) of the B2-C2B2G RESULT whose decision is STATE_GENERATION dominant with next
 * phase section state_generation (exactly one, or fail closed); its probe and expected identity are B2-C2B2G's population probe and
 * recorded expected identity, and must equal the Target, probe, identity and excluded Route key B2-C2B2G's own derivation
 * (`phase2c26b2c2b2gPopulation()`) re-derives from the B2-C2B2F and B2-C2B2E RESULTs, over the Export they all recorded. Nothing
 * here reaches the Search.
 */
export function phase2c26b2c2b2hPopulation(g: Phase2C26B2C2B2HB2C2B2GAuthority | null, f: Phase2C26B2C2B2GB2C2B2FAuthority | null, e: Phase2C26B2C2B2FB2C2B2EAuthority | null): Phase2C26B2C2B2HDerivation {
  const chain = { b2c2b2fAuthorityIsB2C2B2GAuthority: false, b2c2b2eAuthorityIsB2C2B2GAuthority: false, targetsEqualB2C2B2GDerived: false, probesEqualB2C2B2GDerived: false,
    identitiesEqualB2C2B2GDerived: false, excludedRouteEqualsB2C2B2GDerived: false, exportEqualsB2C2B2F: false }
  const empty = { targetWeaponIds: [], probes: [], expectedTaskIdentities: [], excludedRouteKeySha256: null, chain }
  if (g === null) return { valid: false, issues: ['no B2-C2B2G authority'], ...empty }
  if (f === null) return { valid: false, issues: ['no B2-C2B2F authority'], ...empty }
  if (e === null) return { valid: false, issues: ['no B2-C2B2E authority'], ...empty }
  const reg = PHASE2C26B2C2B2H_REGISTERED_B2C2B2G
  const issues: string[] = []
  if (g.decisionCase !== reg.decisionCase || g.dominant !== reg.dominant || !same(g.nextPhaseSections, reg.nextPhaseSections)) {
    issues.push(`the B2-C2B2G decision is ${g.decisionCase} / ${g.dominant} / [${g.nextPhaseSections.join(', ')}], not ${reg.decisionCase} / ${reg.dominant} / [${reg.nextPhaseSections.join(', ')}]`)
  }
  if (g.targetWeaponIds.length !== PHASE2C26B2C2B2H_EXPECTED_TASKS) issues.push(`${g.targetWeaponIds.length} B2-C2B2G profiled Targets, not ${PHASE2C26B2C2B2H_EXPECTED_TASKS}`)
  const derivedG = phase2c26b2c2b2gPopulation(f, e)
  if (!derivedG.valid) issues.push(...derivedG.issues.map(i => `B2-C2B2G-derived population: ${i}`))
  chain.b2c2b2fAuthorityIsB2C2B2GAuthority = f.resultSha256 === g.b2c2b2fResultSha256
  chain.b2c2b2eAuthorityIsB2C2B2GAuthority = e.resultSha256 === g.b2c2b2eResultSha256
  chain.targetsEqualB2C2B2GDerived = same(derivedG.targetWeaponIds, g.targetWeaponIds)
  chain.probesEqualB2C2B2GDerived = same(derivedG.probes, g.probes)
  chain.identitiesEqualB2C2B2GDerived = same(derivedG.expectedTaskIdentities, g.expectedTaskIdentities)
  chain.excludedRouteEqualsB2C2B2GDerived = derivedG.excludedRouteKeySha256 !== null && derivedG.excludedRouteKeySha256 === g.excludedRouteKeySha256
  chain.exportEqualsB2C2B2F = f.exportSha256 === g.exportSha256
  for (const [name, ok] of Object.entries(chain)) if (!ok) issues.push(`chain: ${name}`)
  if (!same(g.attestedProbes, g.probes) || !same(g.attestedIdentities, g.expectedTaskIdentities)) issues.push('the B2-C2B2G start-attested probe / identity is not the B2-C2B2G population')
  return { valid: issues.length === 0, issues, targetWeaponIds: [...g.targetWeaponIds], probes: structuredClone(g.probes), expectedTaskIdentities: structuredClone(g.expectedTaskIdentities),
    excludedRouteKeySha256: g.excludedRouteKeySha256, chain }
}

/** The probe manifest: the one probe and its expected Search input identity, and nothing else (no expected key / index / cost / outcome / section / hotspot / measurement). */
export function phase2c26b2c2b2hProbeManifest(g: Phase2C26B2C2B2HB2C2B2GAuthority, f: Phase2C26B2C2B2GB2C2B2FAuthority, e: Phase2C26B2C2B2FB2C2B2EAuthority): Phase2C26B2C2B2HProbeManifest {
  const derived = phase2c26b2c2b2hPopulation(g, f, e)
  if (!derived.valid) throw new Error(`The B2-C2B2H population is not valid: ${derived.issues.join('; ')}`)
  return { phase: 'Issue #154 Phase 2-C2.6-B2-C2B2H probe manifest (B2-C2B2G STATE_GENERATION-dominant Target, B2-C2B2G Search input)', b2c2b2gResultSha256: g.resultSha256,
    b2c2b2fResultSha256: f.resultSha256, b2c2b2eResultSha256: e.resultSha256, population: PHASE2C26B2C2B2H_POPULATION, policy: 'P1', contextSelection: PHASE2C26B2C2B2H_CONTEXT_SELECTION.id,
    extentRule: PHASE2C26B2C2B2H_EXTENT_RULE.id, exportSha256: g.exportSha256, probes: derived.probes, expectedTaskIdentities: derived.expectedTaskIdentities }
}
