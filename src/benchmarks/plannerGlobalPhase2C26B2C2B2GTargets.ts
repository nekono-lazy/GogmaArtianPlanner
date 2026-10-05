/**
 * Issue #154 Phase 2-C2.6-B2-C2B2G: the population (the Target B2-C2B2F profiled with decision BONUS dominant), its probe and its
 * expected Search input identity, read mechanically from the committed B2-C2B2F RESULT and cross-checked against the population,
 * probe and identity re-derived from the committed B2-C2B2E RESULT by B2-C2B2F's own derivation. Research only. Never import from
 * Production, and never from the B2-C2B2G Search side's child calculation (the runner never reads this module; it reads the manifest
 * built here).
 *
 * Nothing about the population is written down here: the Target, task, rank, extent, digests and excluded Route key come from the
 * RESULTs, and every value is cross-checked between the B2-C2B2F RESULT's own population, identity, task rebuild, excluded Route and
 * start-attested probe and the B2-C2B2E-derived ones.
 */
import { stableStringify } from '../domain/models/hashing'
import type { Phase2C26B2C2B2EProbe } from './plannerGlobalPhase2C26B2C2B2E'
import {
  PHASE2C26B2C2B2F_IDENTITY_FIELDS,
  PHASE2C26B2C2B2F_STAGE1,
  PHASE2C26B2C2B2F_SEARCH_INSTRUMENTATION,
  type Phase2C26B2C2B2FTaskIdentity,
} from './plannerGlobalPhase2C26B2C2B2F'
import {
  phase2c26b2c2b2fPopulation,
  PHASE2C26B2C2B2F_REGISTERED_B2C2B2E,
  type Phase2C26B2C2B2FB2C2B2EAuthority,
} from './plannerGlobalPhase2C26B2C2B2FTargets'
import {
  PHASE2C26B2C2B2G_CONTEXT_SELECTION,
  PHASE2C26B2C2B2G_EXPECTED_TASKS,
  PHASE2C26B2C2B2G_EXTENT_RULE,
  PHASE2C26B2C2B2G_POPULATION,
  type Phase2C26B2C2B2GProbeManifest,
} from './plannerGlobalPhase2C26B2C2B2G'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}
const SHA256 = /^[0-9a-f]{64}$/
const allTrue = (value: unknown) => isObject(value) && Object.keys(value).length > 0 && Object.values(value).every(v => v === true)

/** The B2-C2B2F RESULT (formal, B2C2B2F_BONUS_DOMINANT) this phase re-localizes from. */
export const PHASE2C26B2C2B2G_REGISTERED_B2C2B2F = {
  resultSha256: 'b7b707bbf34a851131eba1a312f228f2948fb5c15d3a9ffad18443365279333d',
  decisionCase: 'B2C2B2F_BONUS_DOMINANT',
  dominant: 'BONUS',
  evidenceGrade: 'formal',
  measuredHead: 'dd41061d492d91c0ebc9a2ecdc13ebc0a857f280',
  targets: 1,
  stage1: { ...PHASE2C26B2C2B2F_STAGE1 },
  searchInstrumentation: { ...PHASE2C26B2C2B2F_SEARCH_INSTRUMENTATION },
  /** The B2-C2B2E RESULT the B2-C2B2F population was derived from (B2-C2B2F's own registered authority). */
  b2c2b2eResultSha256: PHASE2C26B2C2B2F_REGISTERED_B2C2B2E.resultSha256,
} as const

/** The B2-C2B2F RESULT facts this phase reads (post hoc; the Search never reads them). */
export interface Phase2C26B2C2B2GB2C2B2FAuthority {
  resultSha256: string
  measuredHead: string
  decisionCase: string
  dominant: string
  exportSha256: string
  b2c2b2eResultSha256: string
  probeManifestSha256: string
  stage1: unknown
  searchInstrumentation: unknown
  targetWeaponIds: string[]
  probes: Phase2C26B2C2B2EProbe[]
  expectedTaskIdentities: Phase2C26B2C2B2FTaskIdentity[]
  /** The excluded current Route key as B2-C2B2F re-derived it, as B2-C2B2E did, and as B2-C2B2F's child attested it (all equal). */
  excludedRouteKeySha256: string
  /** The probes the B2-C2B2F runner start-attested (the Search input it actually launched with). */
  attestedProbes: Phase2C26B2C2B2EProbe[]
  attestedIdentities: Phase2C26B2C2B2FTaskIdentity[]
  /** B2-C2B2F's outer profile facts, background only (never a Search input, never a decision input here). */
  background: { searchWallMs: number | null; bonusShare: number | null; bonusDepthReadMs: number | null; childOutcome: string | null; deliveryFlushes: number | null }
}

const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null)

/**
 * Reads the committed B2-C2B2F RESULT as untrusted JSON and fails closed unless it is the registered formal result: its own SHA-256;
 * formal with verified launch provenance, not partial; the registered measured HEAD, decision case and dominant category, no invalid
 * reason; B2-C2B2F's Stage 1 (30 minutes / 12,288 MB) and instrumentation (onSearchRuntime only); every condition check, hash chain,
 * population parity, child-attested identity check true; the task rebuilt and the raw identity equal to the expected one; the
 * excluded current Route verified with one key equal across the re-derivation, B2-C2B2E and the child; the B2-C2B2E RESULT it was
 * made against the registered one; one Target, one probe, one expected identity, one attested probe.
 */
export function parsePhase2C26B2C2B2GB2C2B2FAuthority(json: unknown, resultSha256: string): { valid: boolean; issues: string[]; authority: Phase2C26B2C2B2GB2C2B2FAuthority | null } {
  const reg = PHASE2C26B2C2B2G_REGISTERED_B2C2B2F
  const issues: string[] = []
  if (!isObject(json) || !isObject(json.provenance) || !isObject(json.decision) || !isObject(json.conditions) || !isObject(json.population) || !isObject(json.parity)
    || !isObject(json.outcome)) {
    return { valid: false, issues: ['B2-C2B2F RESULT lacks provenance / decision / conditions / population / parity / outcome'], authority: null }
  }
  const { provenance, decision, conditions, population, parity, outcome } = json
  if (resultSha256 !== reg.resultSha256) issues.push(`B2-C2B2F RESULT SHA-256 ${resultSha256} is not the registered ${reg.resultSha256}`)
  if (provenance.formal !== true || provenance.evidenceGrade !== reg.evidenceGrade || provenance.launchProvenanceVerified !== true) issues.push('the B2-C2B2F RESULT is not formal with verified launch provenance')
  if (provenance.partialRun !== false) issues.push('the B2-C2B2F RESULT is a partial run')
  if (provenance.measuredHead !== reg.measuredHead) issues.push('provenance.measuredHead is not the registered B2-C2B2F measured HEAD')
  if (!Array.isArray(provenance.calculationCodeChangedSinceMeasuredHead) || provenance.calculationCodeChangedSinceMeasuredHead.length !== 0) issues.push('the B2-C2B2F calculation code changed since its measured HEAD')
  if (provenance.b2c2b2eResultSha256 !== reg.b2c2b2eResultSha256) issues.push('provenance.b2c2b2eResultSha256 is not the registered B2-C2B2E RESULT')
  if (typeof provenance.exportSha256 !== 'string' || !SHA256.test(provenance.exportSha256)) issues.push('provenance.exportSha256 is not a SHA-256')
  if (typeof provenance.probeManifestSha256 !== 'string' || !SHA256.test(provenance.probeManifestSha256)) issues.push('provenance.probeManifestSha256 is not a SHA-256')
  if (decision.case !== reg.decisionCase) issues.push(`decision.case ${String(decision.case)} is not ${reg.decisionCase}`)
  if (decision.dominant !== reg.dominant) issues.push(`decision.dominant ${String(decision.dominant)} is not ${reg.dominant}`)
  if (!Array.isArray(json.invalidReasons) || json.invalidReasons.length !== 0) issues.push('invalidReasons is not empty')
  if (!same(conditions.stage1, reg.stage1)) issues.push('conditions.stage1 is not B2-C2B2F\'s registered Stage 1 (30 minutes, 12,288 MB)')
  if (!same(conditions.searchInstrumentation, reg.searchInstrumentation)) issues.push('conditions.searchInstrumentation is not onSearchRuntime alone')
  if (!allTrue(conditions.conditionChecks)) issues.push('conditions.conditionChecks is not all true')
  if (!allTrue(parity.hashChain)) issues.push('parity.hashChain is not all true')
  if (!allTrue(parity.childIdentity)) issues.push('parity.childIdentity is not all true')
  const populationParity = isObject(parity.population) ? parity.population : {}
  for (const key of ['manifestEqualsDerived', 'runnerTargetsEqualManifest', 'runnerProbesEqualManifest', 'runnerIdentitiesEqualManifest']) if (populationParity[key] !== true) issues.push(`parity.population.${key} is not true`)
  if (populationParity.targets !== reg.targets) issues.push(`parity.population.targets is not ${reg.targets}`)
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
    || route.b2c2b2eRederivedExcludedRouteKeySha256 !== routeSha || route.childAttestedExcludedRouteKeySha256 !== routeSha) issues.push('parity.excludedRoute is not one verified current Route equal across re-derivation, B2-C2B2E and the child')
  const targetWeaponIds = Array.isArray(population.targetWeaponIds) && population.targetWeaponIds.every(v => typeof v === 'string') ? [...population.targetWeaponIds as string[]] : []
  if (targetWeaponIds.length !== reg.targets) issues.push(`population.targetWeaponIds holds ${targetWeaponIds.length} Targets, not ${reg.targets}`)
  const probes = Array.isArray(population.probes) ? structuredClone(population.probes) as Phase2C26B2C2B2EProbe[] : []
  if (probes.length !== reg.targets) issues.push(`population.probes holds ${probes.length} probes, not ${reg.targets}`)
  if (!same(probes.map(p => p?.targetWeaponId), targetWeaponIds)) issues.push('population.probes do not name population.targetWeaponIds')
  const startAttestation = isObject(provenance.startAttestation) && isObject(provenance.startAttestation.body) ? provenance.startAttestation.body : null
  const attestedProbes = startAttestation !== null && Array.isArray(startAttestation.probes) ? structuredClone(startAttestation.probes) as Phase2C26B2C2B2EProbe[] : []
  const attestedIdentities = startAttestation !== null && Array.isArray(startAttestation.expectedTaskIdentities) ? structuredClone(startAttestation.expectedTaskIdentities) as Phase2C26B2C2B2FTaskIdentity[] : []
  if (startAttestation === null || startAttestation.repositoryHead !== reg.measuredHead) issues.push('the B2-C2B2F start attestation is missing or not at the registered measured HEAD')
  if (startAttestation !== null && startAttestation.probeManifestSha256 !== provenance.probeManifestSha256) issues.push('the B2-C2B2F start attestation manifest is not the recorded one')
  if (!same(attestedProbes, probes)) issues.push('the B2-C2B2F start-attested probes are not population.probes')
  if (expected === null || !same(attestedIdentities, [expected])) issues.push('the B2-C2B2F start-attested identities are not parity.identity.expected')
  const profile = isObject(json.profile) ? json.profile : {}
  const shares = isObject(profile.categoryShares) ? profile.categoryShares : {}
  const exclusive = isObject(profile.sectionExclusiveMs) && isObject(profile.sectionExclusiveMs.BONUS) ? profile.sectionExclusiveMs.BONUS : {}
  const delivered = isObject(outcome.deliveredBeforeKill) ? outcome.deliveredBeforeKill : {}
  if (issues.length > 0 || expected === null || routeSha === null) return { valid: false, issues, authority: null }
  return { valid: true, issues: [], authority: { resultSha256, measuredHead: String(provenance.measuredHead), decisionCase: String(decision.case), dominant: String(decision.dominant),
    exportSha256: String(provenance.exportSha256), b2c2b2eResultSha256: String(provenance.b2c2b2eResultSha256), probeManifestSha256: String(provenance.probeManifestSha256),
    stage1: structuredClone(conditions.stage1), searchInstrumentation: structuredClone(conditions.searchInstrumentation), targetWeaponIds, probes, expectedTaskIdentities: [expected],
    excludedRouteKeySha256: routeSha, attestedProbes, attestedIdentities,
    background: { searchWallMs: num(profile.searchWallMs), bonusShare: num(shares.BONUS), bonusDepthReadMs: num(exclusive.bonus_depth_read), childOutcome: typeof outcome.process === 'string' ? outcome.process : null,
      deliveryFlushes: num(delivered.deliveryFlushes) } } }
}

// ---------------------------------------------------------------- population, probe and expected identity

export interface Phase2C26B2C2B2GDerivation {
  valid: boolean
  issues: string[]
  /** The population Target IDs (exactly one when valid). */
  targetWeaponIds: string[]
  probes: Phase2C26B2C2B2EProbe[]
  expectedTaskIdentities: Phase2C26B2C2B2FTaskIdentity[]
  /** The excluded current Route key SHA-256 the identity chain agrees on (background, never a Search input). */
  excludedRouteKeySha256: string | null
  /** Each chain comparison, for the record. */
  chain: { b2c2b2eAuthorityIsB2C2B2FAuthority: boolean; probesEqualB2C2B2EDerived: boolean; identitiesEqualB2C2B2EDerived: boolean; targetsEqualB2C2B2EDerived: boolean;
    excludedRouteEqualsB2C2B2E: boolean; exportEqualsB2C2B2E: boolean }
}

/**
 * The population, derived mechanically: the Target(s) of the B2-C2B2F RESULT whose decision is BONUS dominant (exactly one, or fail
 * closed); its probe and expected identity are B2-C2B2F's population probe and recorded expected identity, and must equal the probe,
 * identity, Target and excluded Route key that B2-C2B2F's own derivation re-derives from the B2-C2B2E RESULT (and the Export recorded
 * by both). Nothing here reaches the Search.
 */
export function phase2c26b2c2b2gPopulation(f: Phase2C26B2C2B2GB2C2B2FAuthority | null, e: Phase2C26B2C2B2FB2C2B2EAuthority | null): Phase2C26B2C2B2GDerivation {
  const chain = { b2c2b2eAuthorityIsB2C2B2FAuthority: false, probesEqualB2C2B2EDerived: false, identitiesEqualB2C2B2EDerived: false, targetsEqualB2C2B2EDerived: false,
    excludedRouteEqualsB2C2B2E: false, exportEqualsB2C2B2E: false }
  const empty = { targetWeaponIds: [], probes: [], expectedTaskIdentities: [], excludedRouteKeySha256: null, chain }
  if (f === null) return { valid: false, issues: ['no B2-C2B2F authority'], ...empty }
  if (e === null) return { valid: false, issues: ['no B2-C2B2E authority'], ...empty }
  const reg = PHASE2C26B2C2B2G_REGISTERED_B2C2B2F
  const issues: string[] = []
  if (f.decisionCase !== reg.decisionCase || f.dominant !== reg.dominant) issues.push(`the B2-C2B2F decision is ${f.decisionCase} / ${f.dominant}, not ${reg.decisionCase} / ${reg.dominant}`)
  if (f.targetWeaponIds.length !== PHASE2C26B2C2B2G_EXPECTED_TASKS) issues.push(`${f.targetWeaponIds.length} B2-C2B2F profiled Targets, not ${PHASE2C26B2C2B2G_EXPECTED_TASKS}`)
  const derivedE = phase2c26b2c2b2fPopulation(e)
  if (!derivedE.valid) issues.push(...derivedE.issues.map(i => `B2-C2B2E-derived population: ${i}`))
  chain.b2c2b2eAuthorityIsB2C2B2FAuthority = e.resultSha256 === f.b2c2b2eResultSha256
  chain.targetsEqualB2C2B2EDerived = same(derivedE.targetWeaponIds, f.targetWeaponIds)
  chain.probesEqualB2C2B2EDerived = same(derivedE.probes, f.probes)
  chain.identitiesEqualB2C2B2EDerived = same(derivedE.expectedTaskIdentities, f.expectedTaskIdentities)
  chain.excludedRouteEqualsB2C2B2E = derivedE.b2c2b2e.length === 1 && derivedE.b2c2b2e[0]!.rederivedExcludedRouteKeySha256 === f.excludedRouteKeySha256
  chain.exportEqualsB2C2B2E = e.exportSha256 === f.exportSha256
  for (const [name, ok] of Object.entries(chain)) if (!ok) issues.push(`chain: ${name}`)
  if (!same(f.attestedProbes, f.probes) || !same(f.attestedIdentities, f.expectedTaskIdentities)) issues.push('the B2-C2B2F start-attested probe / identity is not the B2-C2B2F population')
  const valid = issues.length === 0
  return { valid, issues, targetWeaponIds: [...f.targetWeaponIds], probes: structuredClone(f.probes), expectedTaskIdentities: structuredClone(f.expectedTaskIdentities),
    excludedRouteKeySha256: f.excludedRouteKeySha256, chain }
}

/** The probe manifest: the one probe and its expected Search input identity, and nothing else (no expected key / index / cost / outcome / section / measurement). */
export function phase2c26b2c2b2gProbeManifest(f: Phase2C26B2C2B2GB2C2B2FAuthority, e: Phase2C26B2C2B2FB2C2B2EAuthority): Phase2C26B2C2B2GProbeManifest {
  const derived = phase2c26b2c2b2gPopulation(f, e)
  if (!derived.valid) throw new Error(`The B2-C2B2G population is not valid: ${derived.issues.join('; ')}`)
  return { phase: 'Issue #154 Phase 2-C2.6-B2-C2B2G probe manifest (B2-C2B2F BONUS-dominant Target, B2-C2B2F Search input)', b2c2b2fResultSha256: f.resultSha256,
    b2c2b2eResultSha256: e.resultSha256, population: PHASE2C26B2C2B2G_POPULATION, policy: 'P1', contextSelection: PHASE2C26B2C2B2G_CONTEXT_SELECTION.id,
    extentRule: PHASE2C26B2C2B2G_EXTENT_RULE.id, exportSha256: f.exportSha256, probes: derived.probes, expectedTaskIdentities: derived.expectedTaskIdentities }
}
