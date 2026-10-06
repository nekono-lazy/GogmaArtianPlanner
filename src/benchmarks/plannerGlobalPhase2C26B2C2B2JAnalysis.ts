/**
 * Issue #154 Phase 2-C2.6-B2-C2B2J post-hoc analysis only: the formal before / after check of the registered Production
 * optimization (`reserved_keep_family_layout_key_reuse_v1`). Research only. Never import from Production.
 *
 * Pure functions over B2-C2B2I's formal raw evidence (the before run: B2-C2B2I's after run, its durable B2-C2B2G snapshots and CPU
 * profile, SHA-256 checked against the B2-C2B2I RESULT) and this phase's run (the after run, the same Search input and conditions at
 * the optimized HEAD):
 *
 * - semantic parity first: the held-aware depth records of both runs must be identical on their common prefix (B2-C2B2I's depth
 *   identity, unchanged). One mismatch rejects the optimization whatever the speed;
 * - the primary direct performance metric: over that semantic-identical common prefix (the same work), the `state_generation`
 *   section time of the after run over the before run (`stateGenerationDirectRatio`, B2-C2B2I's comparison unchanged);
 * - the targeted CPU metric: the registered inclusive active CPU share of `keepFamilyLayoutKey` (B2-C2B2H's analysis, unchanged) of
 *   the after profile over the before profile (`keepFamilyLayoutKeyShareRatio`), only when both profiles pass B2-C2B2H's quality
 *   rule and the before re-analysis reproduces the B2-C2B2I RESULT;
 * - the pre-registered decision (fixed before the formal run, never changed after seeing a result).
 *
 * A CPU sample share is never read as a speed-up; GC, heap, RSS and whole-run progress are descriptive only.
 */
import { phase2c26b2c2b2hEvidenceGrade, phase2c26b2c2b2hConditionIssues, type Phase2C26B2C2B2HProfileAnalysis } from './plannerGlobalPhase2C26B2C2B2HAnalysis'
import { phase2c26b2c2b2iDirectComparison, phase2c26b2c2b2iMemory, type Phase2C26B2C2B2IDirectComparison } from './plannerGlobalPhase2C26B2C2B2IAnalysis'
import { stableStringify } from '../domain/models/hashing'
import {
  verifyPhase2C26B2C2B2JStartAttestation,
  type Phase2C26B2C2B2JAttestationExpectation,
} from './plannerGlobalPhase2C26B2C2B2J'
import { PHASE2C26B2C2B2J_TARGET_FUNCTION } from './plannerGlobalPhase2C26B2C2B2JTargets'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}
const ratio = (after: number | null, before: number | null) => (after !== null && before !== null && before > 0 ? after / before : null)

// ---------------------------------------------------------------- registered rule (fixed before the formal run)

/** ADOPTED needs keepFamilyLayoutKeyShareRatio <= this (the target function's active CPU share cut by at least 50 % relative). */
export const PHASE2C26B2C2B2J_ADOPT_MAX_KEY_SHARE_RATIO = 0.5
/** ADOPTED needs stateGenerationDirectRatio <= this (the same work's state_generation time cut by at least 5 %). */
export const PHASE2C26B2C2B2J_ADOPT_MAX_DIRECT_RATIO = 0.95
/** stateGenerationDirectRatio above this is a regression (rejected). */
export const PHASE2C26B2C2B2J_REGRESSION_DIRECT_RATIO = 1.05
/** keepFamilyLayoutKeyShareRatio >= this AND stateGenerationDirectRatio >= PHASE2C26B2C2B2J_NO_EFFECT_DIRECT_RATIO is no effect. */
export const PHASE2C26B2C2B2J_NO_EFFECT_KEY_SHARE_RATIO = 0.9
export const PHASE2C26B2C2B2J_NO_EFFECT_DIRECT_RATIO = 0.98
export const PHASE2C26B2C2B2J_SECTION = 'state_generation'

export const PHASE2C26B2C2B2J_DECISION_CASES = ['B2C2B2J_INVALID', 'B2C2B2J_INSUFFICIENT', 'B2C2B2J_REJECTED_SEMANTIC', 'B2C2B2J_ADOPTED',
  'B2C2B2J_REJECTED_REGRESSION', 'B2C2B2J_REJECTED_NO_EFFECT', 'B2C2B2J_PARTIAL'] as const
export type Phase2C26B2C2B2JDecisionCase = typeof PHASE2C26B2C2B2J_DECISION_CASES[number]

export const PHASE2C26B2C2B2J_DECISION_RULE = {
  order: 'INVALID, then INSUFFICIENT, then REJECTED_SEMANTIC, then ADOPTED, then REJECTED_REGRESSION, then REJECTED_NO_EFFECT, then PARTIAL',
  invalid: 'B2C2B2J_INVALID: an authority / before evidence SHA-256 / population / Search input identity / excluded Route / hash chain / provenance / registered condition / Production change registration / optimization source shape issue, or the before CPU profile re-analysis not reproducing the B2-C2B2I RESULT',
  insufficient: 'B2C2B2J_INSUFFICIENT: no direct comparison (a depth record collection of either run is not valid, no common held-aware depth, or a common depth without a state_generation section time), or no usable CPU profile pair (either profile failing B2-C2B2H\'s quality rule, or no keepFamilyLayoutKey share)',
  semantic: 'B2C2B2J_REJECTED_SEMANTIC: one common held-aware depth record differs (identity or counts), or the child-attested Search input / excluded Route is not the expected one. The optimization is rejected whatever the speed',
  adopted: `B2C2B2J_ADOPTED: semantic parity valid, both CPU profiles valid, keepFamilyLayoutKeyShareRatio <= ${PHASE2C26B2C2B2J_ADOPT_MAX_KEY_SHARE_RATIO} and stateGenerationDirectRatio <= ${PHASE2C26B2C2B2J_ADOPT_MAX_DIRECT_RATIO}`,
  regression: `B2C2B2J_REJECTED_REGRESSION: semantic parity valid and stateGenerationDirectRatio > ${PHASE2C26B2C2B2J_REGRESSION_DIRECT_RATIO}`,
  noEffect: `B2C2B2J_REJECTED_NO_EFFECT: semantic parity valid, keepFamilyLayoutKeyShareRatio >= ${PHASE2C26B2C2B2J_NO_EFFECT_KEY_SHARE_RATIO} AND stateGenerationDirectRatio >= ${PHASE2C26B2C2B2J_NO_EFFECT_DIRECT_RATIO}`,
  partial: 'B2C2B2J_PARTIAL: semantic parity valid, none of the above; never adopted automatically',
  keepFamilyLayoutKeyShareRatio: `after / before registered inclusive active CPU share of ${PHASE2C26B2C2B2J_TARGET_FUNCTION} (B2-C2B2H's registeredInclusive over the state_generation intervals, unchanged); the before share is re-derived from the B2-C2B2I after profile and must reproduce the B2-C2B2I RESULT; the Reset path still computes it, so 0 is not required`,
  stateGenerationDirectRatio: 'Σ after state_generation section ms / Σ before state_generation section ms over the semantic-identical common held-aware depth prefix (the depth records\' own section times, Research yield wait included in both)',
  descriptive: 'GC samples / share, peak heap / RSS, completed depths and generated states are descriptive only and never a decision input; a single run never proves a GC improvement',
} as const

export const PHASE2C26B2C2B2J_NEXT_PHASE: Record<Phase2C26B2C2B2JDecisionCase, string> = {
  B2C2B2J_INVALID: '計測を無効扱いにし、原因を修正して同じ比較をやり直す（条件・thresholdは変えない）',
  B2C2B2J_INSUFFICIENT: 'direct comparisonまたはprofile比較が成立しない。収集を修正して同じ比較をやり直す（条件・thresholdは変えない）',
  B2C2B2J_REJECTED_SEMANTIC: 'optimizationをrejectしてrevertする。semantic mismatchの原因を調査する（速度が速くても採用しない）',
  B2C2B2J_ADOPTED: 'optimizationを採用する。追加micro-optimizationの前にIssue #154本筋へ戻り、B2-C2B2Eで60分timeoutしたTargetを現在mainで60分 / 12 GB再実行してRoute recoveryを確認する',
  B2C2B2J_REJECTED_REGRESSION: 'optimizationをrejectしてrevertする',
  B2C2B2J_REJECTED_NO_EFFECT: 'optimizationをrejectしてrevertする',
  B2C2B2J_PARTIAL: '自動採用しない。報告して採否の判断を仰ぐ（thresholdを変えた再実行はしない）',
}

// ---------------------------------------------------------------- direct before / after over the common depth prefix (B2-C2B2I's, unchanged)

export type Phase2C26B2C2B2JDirectComparison = Phase2C26B2C2B2IDirectComparison
export const phase2c26b2c2b2jDirectComparison = phase2c26b2c2b2iDirectComparison

// ---------------------------------------------------------------- CPU target function before / after

/** Exact up to floating point rounding of a re-run of the same pure analysis. */
export const PHASE2C26B2C2B2J_REPRODUCTION_TOLERANCE = 1e-12

type InclusiveAnalysis = Pick<Phase2C26B2C2B2HProfileAnalysis, 'registeredInclusive' | 'categories'>

/** The registered inclusive active share of one registered function; 0 when the profile has no sample of it. */
export function phase2c26b2c2b2jRegisteredInclusiveShare(analysis: Pick<Phase2C26B2C2B2HProfileAnalysis, 'registeredInclusive'> | null, registered = PHASE2C26B2C2B2J_TARGET_FUNCTION): number | null {
  if (analysis === null) return null
  return analysis.registeredInclusive.find(r => r.registered === registered)?.shareOfActive ?? 0
}

export interface Phase2C26B2C2B2JCpuComparison {
  /** The before share as the B2-C2B2I RESULT recorded it (its after profile). */
  beforeRecordedShare: number
  /** The before share re-derived from the B2-C2B2I after profile with B2-C2B2H's analysis (must equal the recorded one). */
  beforeRecomputedShare: number | null
  beforeReproduced: boolean
  beforeProfileValid: boolean
  beforeQualityIssues: string[]
  afterShare: number | null
  afterProfileValid: boolean
  afterQualityIssues: string[]
  /** after / before, formal only when both profiles are valid (else null). */
  keepFamilyLayoutKeyShareRatio: number | null
  /** after / before regardless of the quality rule (descriptive only). */
  descriptiveShareRatio: number | null
  registeredInclusive: { registered: string; beforeShareOfActive: number | null; afterShareOfActive: number | null; beforeSamples: number | null; afterSamples: number | null }[]
  categories: { category: string; beforeShareOfActive: number | null; afterShareOfActive: number | null; beforeSamples: number | null; afterSamples: number | null }[]
}

export function phase2c26b2c2b2jCpuComparison(input: { beforeRecordedShare: number; beforeAnalysis: InclusiveAnalysis | null; beforeQualityIssues: readonly string[];
  afterAnalysis: InclusiveAnalysis | null; afterQualityIssues: readonly string[] }): Phase2C26B2C2B2JCpuComparison {
  const beforeRecomputedShare = phase2c26b2c2b2jRegisteredInclusiveShare(input.beforeAnalysis)
  const beforeReproduced = beforeRecomputedShare !== null && Math.abs(beforeRecomputedShare - input.beforeRecordedShare) <= PHASE2C26B2C2B2J_REPRODUCTION_TOLERANCE
  const beforeProfileValid = input.beforeAnalysis !== null && input.beforeQualityIssues.length === 0 && beforeReproduced
  const afterShare = phase2c26b2c2b2jRegisteredInclusiveShare(input.afterAnalysis)
  const afterProfileValid = input.afterAnalysis !== null && input.afterQualityIssues.length === 0
  const inclusiveOf = (a: InclusiveAnalysis | null, registered: string) => a?.registeredInclusive.find(r => r.registered === registered) ?? null
  const categoryOf = (a: InclusiveAnalysis | null, category: string) => a?.categories.find(c => c.category === category) ?? null
  const registeredNames = [...new Set([...(input.beforeAnalysis?.registeredInclusive ?? []), ...(input.afterAnalysis?.registeredInclusive ?? [])].map(r => r.registered))]
  const categoryNames = [...new Set([...(input.beforeAnalysis?.categories ?? []), ...(input.afterAnalysis?.categories ?? [])].map(c => c.category))]
  return { beforeRecordedShare: input.beforeRecordedShare, beforeRecomputedShare, beforeReproduced, beforeProfileValid, beforeQualityIssues: [...input.beforeQualityIssues],
    afterShare, afterProfileValid, afterQualityIssues: [...input.afterQualityIssues],
    keepFamilyLayoutKeyShareRatio: beforeProfileValid && afterProfileValid ? ratio(afterShare, input.beforeRecordedShare) : null,
    descriptiveShareRatio: ratio(afterShare, input.beforeRecordedShare),
    registeredInclusive: registeredNames.map(registered => ({ registered, beforeShareOfActive: inclusiveOf(input.beforeAnalysis, registered)?.shareOfActive ?? (input.beforeAnalysis === null ? null : 0),
      afterShareOfActive: inclusiveOf(input.afterAnalysis, registered)?.shareOfActive ?? (input.afterAnalysis === null ? null : 0),
      beforeSamples: inclusiveOf(input.beforeAnalysis, registered)?.samples ?? (input.beforeAnalysis === null ? null : 0),
      afterSamples: inclusiveOf(input.afterAnalysis, registered)?.samples ?? (input.afterAnalysis === null ? null : 0) })),
    categories: categoryNames.map(category => ({ category, beforeShareOfActive: categoryOf(input.beforeAnalysis, category)?.shareOfActive ?? null,
      afterShareOfActive: categoryOf(input.afterAnalysis, category)?.shareOfActive ?? null, beforeSamples: categoryOf(input.beforeAnalysis, category)?.samples ?? null,
      afterSamples: categoryOf(input.afterAnalysis, category)?.samples ?? null })) }
}

// ---------------------------------------------------------------- decision

export function phase2c26b2c2b2jDecision(input: { invalidReasons: readonly string[]; identityParity: boolean; direct: Phase2C26B2C2B2JDirectComparison | null;
  cpu: Phase2C26B2C2B2JCpuComparison | null }) {
  const base = { scope: 'A before / after decision about one Production optimization (held-aware Keep family layout key reuse) on one oracle-guided Search input (B2-C2B2I\'s = B2-C2B2H\'s), from the semantic-identical common depth prefix and the registered inclusive CPU share of keepFamilyLayoutKey. Never a Route exact judgement.' }
  const metrics = { stateGenerationDirectRatio: input.direct?.stateGenerationDirectRatio ?? null, keepFamilyLayoutKeyShareRatio: input.cpu?.keepFamilyLayoutKeyShareRatio ?? null }
  const make = (caseId: Phase2C26B2C2B2JDecisionCase, reasons: string[], adoption: 'adopt' | 'reject' | 'undecided') =>
    ({ ...base, case: caseId, reasons, adoption, ...metrics, nextPhase: PHASE2C26B2C2B2J_NEXT_PHASE[caseId] })
  if (input.invalidReasons.length > 0) return make('B2C2B2J_INVALID', [...input.invalidReasons], 'undecided')
  const d = input.direct
  if (d === null || (!d.valid && d.firstMismatch === null)) return make('B2C2B2J_INSUFFICIENT', d === null ? ['no direct comparison'] : [...d.issues], 'undecided')
  if (!d.semanticParity || !input.identityParity) {
    return make('B2C2B2J_REJECTED_SEMANTIC', [...(d.semanticParity ? [] : [`held-aware depth record ${d.firstMismatch?.index ?? '-'} differs`]),
      ...(input.identityParity ? [] : ['the child-attested Search input / excluded Route is not the expected one'])], 'reject')
  }
  if (!d.valid || d.stateGenerationDirectRatio === null) return make('B2C2B2J_INSUFFICIENT', [...d.issues, 'no stateGenerationDirectRatio'], 'undecided')
  const c = input.cpu
  if (c === null || !c.beforeProfileValid || !c.afterProfileValid || c.keepFamilyLayoutKeyShareRatio === null) {
    return make('B2C2B2J_INSUFFICIENT', ['no usable CPU profile pair (a profile fails the quality rule, the before share is not reproduced, or no keepFamilyLayoutKey share)',
      ...(c?.beforeQualityIssues ?? []).map(x => `before: ${x}`), ...(c?.afterQualityIssues ?? []).map(x => `after: ${x}`)], 'undecided')
  }
  const direct = d.stateGenerationDirectRatio
  const key = c.keepFamilyLayoutKeyShareRatio
  if (key <= PHASE2C26B2C2B2J_ADOPT_MAX_KEY_SHARE_RATIO && direct <= PHASE2C26B2C2B2J_ADOPT_MAX_DIRECT_RATIO) return make('B2C2B2J_ADOPTED', [], 'adopt')
  if (direct > PHASE2C26B2C2B2J_REGRESSION_DIRECT_RATIO) return make('B2C2B2J_REJECTED_REGRESSION', [`stateGenerationDirectRatio ${direct} > ${PHASE2C26B2C2B2J_REGRESSION_DIRECT_RATIO}`], 'reject')
  if (key >= PHASE2C26B2C2B2J_NO_EFFECT_KEY_SHARE_RATIO && direct >= PHASE2C26B2C2B2J_NO_EFFECT_DIRECT_RATIO) {
    return make('B2C2B2J_REJECTED_NO_EFFECT', [`keepFamilyLayoutKeyShareRatio ${key} >= ${PHASE2C26B2C2B2J_NO_EFFECT_KEY_SHARE_RATIO} and stateGenerationDirectRatio ${direct} >= ${PHASE2C26B2C2B2J_NO_EFFECT_DIRECT_RATIO}`], 'reject')
  }
  const reasons: string[] = []
  if (key > PHASE2C26B2C2B2J_ADOPT_MAX_KEY_SHARE_RATIO) reasons.push(`keepFamilyLayoutKeyShareRatio ${key} > ${PHASE2C26B2C2B2J_ADOPT_MAX_KEY_SHARE_RATIO}`)
  if (direct > PHASE2C26B2C2B2J_ADOPT_MAX_DIRECT_RATIO) reasons.push(`stateGenerationDirectRatio ${direct} > ${PHASE2C26B2C2B2J_ADOPT_MAX_DIRECT_RATIO}`)
  return make('B2C2B2J_PARTIAL', reasons, 'undecided')
}

// ---------------------------------------------------------------- launch provenance, GC and memory (descriptive)

export interface Phase2C26B2C2B2JLaunchProvenance {
  verified: boolean
  source: 'runner_start_attestation' | 'none'
  workingTreeCleanVerified: boolean
  issues: string[]
  integrityIssues: string[]
  reason: string | null
}

/** B2-C2B2I's launch provenance rule with this phase's attestation. */
export function phase2c26b2c2b2jLaunchProvenance(input: { attestationFile: { sha256: string; body: unknown } | null; recordedAttestationSha256: string | null;
  environment: Record<string, unknown>; expected: Phase2C26B2C2B2JAttestationExpectation }): Phase2C26B2C2B2JLaunchProvenance {
  if (input.attestationFile === null) {
    return { verified: false, source: 'none', workingTreeCleanVerified: false, issues: ['no start attestation in the run dir'], integrityIssues: [], reason: 'The runner start attestation is missing.' }
  }
  const integrityIssues: string[] = []
  if (input.recordedAttestationSha256 !== input.attestationFile.sha256) integrityIssues.push('the attestation file is not the one the raw recorded')
  const verification = verifyPhase2C26B2C2B2JStartAttestation(input.attestationFile.body, input.expected)
  integrityIssues.push(...verification.integrityIssues)
  const body = isObject(input.attestationFile.body) ? input.attestationFile.body : {}
  for (const field of ['repositoryHead', 'uncommittedBenchmarkCode', 'benchmarkCodeSha256', 'exportSha256', 'probeManifestSha256', 'stage1', 'probes', 'cpuProfilerConfig',
    'productionChangedFiles', 'b2c2b2iBeforeFiles'] as const) {
    if (!same(body[field], input.environment[field])) integrityIssues.push(`${field} differs from the raw environment`)
  }
  const issues = [...integrityIssues, ...verification.issues.filter(i => !verification.integrityIssues.includes(i))]
  const verified = issues.length === 0
  return { verified, source: 'runner_start_attestation', workingTreeCleanVerified: verified, issues, integrityIssues, reason: verified ? null : `The start attestation does not verify: ${issues.join('; ')}.` }
}

export const phase2c26b2c2b2jEvidenceGrade = phase2c26b2c2b2hEvidenceGrade
export const phase2c26b2c2b2jConditionIssues = phase2c26b2c2b2hConditionIssues
export const phase2c26b2c2b2jMemory = phase2c26b2c2b2iMemory

/** GC samples / share of both profiles (descriptive; a single run never proves a GC improvement). */
export function phase2c26b2c2b2jGc(before: Pick<Phase2C26B2C2B2HProfileAnalysis, 'categories' | 'activeSamples'> | null,
  after: Pick<Phase2C26B2C2B2HProfileAnalysis, 'categories' | 'activeSamples'> | null) {
  const gc = (a: typeof before) => a?.categories.find(c => c.category === 'gc') ?? null
  return { before: { samples: gc(before)?.samples ?? null, shareOfActive: gc(before)?.shareOfActive ?? null, activeSamples: before?.activeSamples ?? null },
    after: { samples: gc(after)?.samples ?? null, shareOfActive: gc(after)?.shareOfActive ?? null, activeSamples: after?.activeSamples ?? null },
    shareRatio: ratio(gc(after)?.shareOfActive ?? null, gc(before)?.shareOfActive ?? null),
    note: 'descriptive only: one run each, never a decision input and never proof of a GC improvement' }
}
