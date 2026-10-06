/**
 * Issue #154 Phase 2-C2.6-B2-C2B2I post-hoc analysis only: the formal before / after check of the registered Production
 * optimization (`predict_keep_nested_counter_family_cache_v1`). Research only. Never import from Production.
 *
 * Pure functions over B2-C2B2H's formal raw evidence (the before run: its durable B2-C2B2G snapshots and CPU profile, SHA-256
 * checked against the B2-C2B2H RESULT) and this phase's run (the after run, the same Search input and conditions at the optimized
 * HEAD):
 *
 * - semantic parity first: the held-aware depth records of both runs must be identical on their common prefix (stream, start
 *   counter, depth, exhaustion, frontier before, legal positions, generated states, frontier after, window memo entries). One
 *   mismatch rejects the optimization whatever the speed;
 * - the primary direct performance metric: over that semantic-identical common prefix (the same work), the `state_generation`
 *   section time of the after run over the before run (`stateGenerationDirectRatio`), from the depth records' own section ms;
 * - the hotspot check: the keep_prediction active CPU share of the after profile (B2-C2B2H's classification, unchanged) over the
 *   before share (`keepPredictionShareRatio`), only when both profiles pass B2-C2B2H's profile quality rule;
 * - the pre-registered decision (fixed before the formal run, never changed after seeing a result).
 *
 * A CPU sample share is never read as a speed-up, and whole-run progress (depths, generated states, wall) is descriptive only.
 */
import { stableStringify } from '../domain/models/hashing'
import type { Phase2C26A3DepthRecord } from './plannerGlobalPhase2C26A3'
import { phase2c26b2c2b2gCollectDepthRecords } from './plannerGlobalPhase2C26B2C2B2GAnalysis'
import { PHASE2C26B2C2B2G_INNER_SECTIONS, type Phase2C26B2C2B2GProfileSnapshot } from './plannerGlobalPhase2C26B2C2B2G'
import {
  phase2c26b2c2b2hActiveShare,
  phase2c26b2c2b2hConditionIssues,
  phase2c26b2c2b2hEvidenceGrade,
  type Phase2C26B2C2B2HProfileAnalysis,
} from './plannerGlobalPhase2C26B2C2B2HAnalysis'
import {
  verifyPhase2C26B2C2B2IStartAttestation,
  type Phase2C26B2C2B2IAttestationExpectation,
} from './plannerGlobalPhase2C26B2C2B2I'
import { PHASE2C26B2C2B2I_HOTSPOT_CATEGORY } from './plannerGlobalPhase2C26B2C2B2ITargets'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const same = (a: unknown, b: unknown) => {
  try { return stableStringify(a ?? null) === stableStringify(b ?? null) } catch { return false }
}

// ---------------------------------------------------------------- registered rule (fixed before the formal run)

/** Case O (adopted) needs keepPredictionShareRatio <= this (the hotspot share cut by at least 25 % relative). */
export const PHASE2C26B2C2B2I_ADOPT_MAX_KEEP_SHARE_RATIO = 0.75
/** Case O (adopted) needs stateGenerationDirectRatio <= this (the same work's state_generation time cut by at least 10 %). */
export const PHASE2C26B2C2B2I_ADOPT_MAX_DIRECT_RATIO = 0.9
/** stateGenerationDirectRatio above this is a regression (rejected). */
export const PHASE2C26B2C2B2I_REGRESSION_DIRECT_RATIO = 1.05
/** keepPredictionShareRatio >= this AND stateGenerationDirectRatio >= this is no effect (rejected / revert candidate). */
export const PHASE2C26B2C2B2I_NO_EFFECT_RATIO = 0.95
export const PHASE2C26B2C2B2I_SECTION = 'state_generation'

export const PHASE2C26B2C2B2I_DECISION_CASES = ['B2C2B2I_INVALID', 'B2C2B2I_INSUFFICIENT', 'B2C2B2I_REJECTED_SEMANTIC_MISMATCH', 'B2C2B2I_ADOPTED',
  'B2C2B2I_REJECTED_REGRESSION', 'B2C2B2I_REJECTED_NO_EFFECT', 'B2C2B2I_PARTIAL'] as const
export type Phase2C26B2C2B2IDecisionCase = typeof PHASE2C26B2C2B2I_DECISION_CASES[number]

export const PHASE2C26B2C2B2I_DECISION_RULE = {
  order: 'INVALID, then INSUFFICIENT (no direct comparison), then semantic mismatch, then O, then regression, then no effect, then P',
  invalid: 'B2C2B2I_INVALID: an authority / before evidence SHA-256 / population / Search input identity / excluded Route / hash chain / provenance / registered condition / Production change registration / optimization source shape issue, or the before CPU profile re-analysis not reproducing the B2-C2B2H RESULT',
  insufficient: 'B2C2B2I_INSUFFICIENT: no direct comparison (a depth record collection of either run is not valid, no common held-aware depth, or a common depth without a state_generation section time)',
  semanticMismatch: 'B2C2B2I_REJECTED_SEMANTIC_MISMATCH (Case N): one common held-aware depth record differs (identity or counts), or the child-attested Search input / excluded Route is not the expected one. The optimization is rejected whatever the speed',
  adopted: `B2C2B2I_ADOPTED (Case O): semantic parity valid, the after CPU profile and the before CPU profile both valid (B2-C2B2H's quality rule), keepPredictionShareRatio <= ${PHASE2C26B2C2B2I_ADOPT_MAX_KEEP_SHARE_RATIO} and stateGenerationDirectRatio <= ${PHASE2C26B2C2B2I_ADOPT_MAX_DIRECT_RATIO}`,
  regression: `B2C2B2I_REJECTED_REGRESSION (Case N): semantic parity valid and stateGenerationDirectRatio > ${PHASE2C26B2C2B2I_REGRESSION_DIRECT_RATIO}`,
  noEffect: `B2C2B2I_REJECTED_NO_EFFECT (Case N): semantic parity valid, keepPredictionShareRatio >= ${PHASE2C26B2C2B2I_NO_EFFECT_RATIO} AND stateGenerationDirectRatio >= ${PHASE2C26B2C2B2I_NO_EFFECT_RATIO} (a revert candidate)`,
  partial: 'B2C2B2I_PARTIAL (Case P): semantic parity valid, none of the above (an improvement short of both Case O conditions, or a CPU share not usable for the formal comparison); never adopted automatically',
  keepPredictionShareRatio: 'after keep_prediction active share / before keep_prediction active share (B2-C2B2H\'s stack-aware classification over the state_generation intervals, unchanged); null when either profile fails B2-C2B2H\'s quality rule',
  stateGenerationDirectRatio: 'Σ after state_generation section ms / Σ before state_generation section ms over the semantic-identical common held-aware depth prefix (the depth records\' own section times, Research yield wait included in both)',
  cpuShare: 'a CPU sample share is hotspot evidence, never a speed-up; whole-run progress (depths, generated states, wall) is descriptive',
} as const

export const PHASE2C26B2C2B2I_NEXT_PHASE: Record<Phase2C26B2C2B2IDecisionCase, string> = {
  B2C2B2I_INVALID: '計測を無効扱いにし、原因を修正して同じ比較をやり直す（条件・thresholdは変えない）',
  B2C2B2I_INSUFFICIENT: 'direct comparisonが成立しない。depth record収集を修正して同じ比較をやり直す（条件・thresholdは変えない）',
  B2C2B2I_REJECTED_SEMANTIC_MISMATCH: 'optimizationをrejectしてrevertする。semantic mismatchの原因を調査する（速度が速くても採用しない）',
  B2C2B2I_ADOPTED: 'optimizationを採用する。次のhotspot（B2-C2B2Hのprogram / owner / state construction / GC等）は別Phaseで1つずつ扱う',
  B2C2B2I_REJECTED_REGRESSION: 'optimizationをrejectしてrevertする',
  B2C2B2I_REJECTED_NO_EFFECT: 'optimizationをreject（revert候補）にする。memo key以外の要因を次Phaseで調べる',
  B2C2B2I_PARTIAL: '自動採用しない。改善の内訳（CPU shareの移動先、direct比のばらつき）を確認して採否を判断する',
}

// ---------------------------------------------------------------- direct before / after over the common depth prefix

export interface Phase2C26B2C2B2IDirectComparison {
  /** Both depth record collections valid and every common depth has a state_generation section time. */
  valid: boolean
  issues: string[]
  /** No common depth record differs (identity or counts). */
  semanticParity: boolean
  beforeDepths: number
  afterDepths: number
  /** Common depths compared (the identical prefix; equal to min(before, after) when semanticParity). */
  commonDepths: number
  firstMismatch: { index: number; before: unknown; after: unknown } | null
  commonGeneratedStates: number
  beforeStateGenerationMs: number | null
  afterStateGenerationMs: number | null
  stateGenerationDirectRatio: number | null
  beforeNsPerGeneratedState: number | null
  afterNsPerGeneratedState: number | null
  /** The same ratio over three equal parts of the common prefix (descriptive). */
  byThird: { fromIndex: number; toIndex: number; generatedStates: number; beforeMs: number; afterMs: number; ratio: number | null }[]
  /** The other held-aware sections over the same prefix (descriptive; the optimization does not touch them). */
  otherSections: { section: string; beforeMs: number; afterMs: number; ratio: number | null }[]
  /** depth_started -> depth_completed inclusive wall over the same prefix (descriptive). */
  inclusive: { beforeMs: number; afterMs: number; ratio: number | null }
}

/** What one held-aware depth computed (never its time), exactly B2-C2B2H's depth parity identity. */
const depthIdentity = (r: Phase2C26A3DepthRecord) => stableStringify({ streamIndex: r.streamIndex, startGogmaCounter: r.startGogmaCounter, depth: r.depth, exhausted: r.exhausted, counts: r.counts })
const ratio = (after: number | null, before: number | null) => (after !== null && before !== null && before > 0 ? after / before : null)

/**
 * The semantic parity and the direct `state_generation` comparison of the before (B2-C2B2H formal) and after (B2-C2B2I) runs. Each
 * run's depth records are collected by B2-C2B2G's collector (which fails closed on a lost or doubled record or a section sum
 * mismatch). The common prefix is compared record by record; the first mismatch ends the comparison and rejects semantic parity.
 */
export function phase2c26b2c2b2iDirectComparison(beforeSnapshots: readonly Phase2C26B2C2B2GProfileSnapshot[], afterSnapshots: readonly Phase2C26B2C2B2GProfileSnapshot[]):
  Phase2C26B2C2B2IDirectComparison {
  const before = phase2c26b2c2b2gCollectDepthRecords(beforeSnapshots), after = phase2c26b2c2b2gCollectDepthRecords(afterSnapshots)
  const issues = [...before.issues.map(i => `before depth records: ${i}`), ...after.issues.map(i => `after depth records: ${i}`)]
  const common = Math.min(before.records.length, after.records.length)
  let firstMismatch: Phase2C26B2C2B2IDirectComparison['firstMismatch'] = null
  let compared = 0
  for (let index = 0; index < common; index += 1) {
    if (depthIdentity(before.records[index]!) !== depthIdentity(after.records[index]!)) {
      firstMismatch = { index, before: JSON.parse(depthIdentity(before.records[index]!)), after: JSON.parse(depthIdentity(after.records[index]!)) }
      break
    }
    compared += 1
  }
  if (common === 0) issues.push('no common held-aware depth record')
  const prefixBefore = before.records.slice(0, compared), prefixAfter = after.records.slice(0, compared)
  const sectionMs = (r: Phase2C26A3DepthRecord, section: string) => num((r.phaseMs as Record<string, unknown>)[section])
  let missing = 0
  for (let i = 0; i < compared; i += 1) if (sectionMs(prefixBefore[i]!, PHASE2C26B2C2B2I_SECTION) === null || sectionMs(prefixAfter[i]!, PHASE2C26B2C2B2I_SECTION) === null) missing += 1
  if (missing > 0) issues.push(`${missing} common depth(s) without a ${PHASE2C26B2C2B2I_SECTION} section time`)
  const sum = (records: readonly Phase2C26A3DepthRecord[], pick: (r: Phase2C26A3DepthRecord) => number | null) => records.reduce((total, r) => total + (pick(r) ?? 0), 0)
  const generated = sum(prefixBefore, r => r.counts.generatedStates)
  const valid = issues.length === 0 && compared > 0
  const beforeMs = valid ? sum(prefixBefore, r => sectionMs(r, PHASE2C26B2C2B2I_SECTION)) : null
  const afterMs = valid ? sum(prefixAfter, r => sectionMs(r, PHASE2C26B2C2B2I_SECTION)) : null
  const thirds = valid ? [0, 1, 2].map(part => {
    const from = Math.floor((compared * part) / 3), to = Math.floor((compared * (part + 1)) / 3)
    const b = sum(prefixBefore.slice(from, to), r => sectionMs(r, PHASE2C26B2C2B2I_SECTION)), a = sum(prefixAfter.slice(from, to), r => sectionMs(r, PHASE2C26B2C2B2I_SECTION))
    return { fromIndex: from, toIndex: to, generatedStates: sum(prefixBefore.slice(from, to), r => r.counts.generatedStates), beforeMs: b, afterMs: a, ratio: ratio(a, b) }
  }) : []
  const otherSections = valid ? PHASE2C26B2C2B2G_INNER_SECTIONS.filter(s => s !== PHASE2C26B2C2B2I_SECTION).map(section => {
    const b = sum(prefixBefore, r => sectionMs(r, section)), a = sum(prefixAfter, r => sectionMs(r, section))
    return { section, beforeMs: b, afterMs: a, ratio: ratio(a, b) }
  }) : []
  const inclusiveBefore = sum(prefixBefore, r => num(r.inclusiveMs)), inclusiveAfter = sum(prefixAfter, r => num(r.inclusiveMs))
  return { valid, issues, semanticParity: firstMismatch === null && common > 0, beforeDepths: before.records.length, afterDepths: after.records.length, commonDepths: compared, firstMismatch,
    commonGeneratedStates: generated, beforeStateGenerationMs: beforeMs, afterStateGenerationMs: afterMs, stateGenerationDirectRatio: ratio(afterMs, beforeMs),
    beforeNsPerGeneratedState: beforeMs !== null && generated > 0 ? (beforeMs * 1e6) / generated : null,
    afterNsPerGeneratedState: afterMs !== null && generated > 0 ? (afterMs * 1e6) / generated : null, byThird: thirds, otherSections,
    inclusive: { beforeMs: valid ? inclusiveBefore : 0, afterMs: valid ? inclusiveAfter : 0, ratio: valid ? ratio(inclusiveAfter, inclusiveBefore) : null } }
}

// ---------------------------------------------------------------- CPU hotspot before / after

export interface Phase2C26B2C2B2ICpuComparison {
  /** The before share as the B2-C2B2H RESULT recorded it. */
  beforeRecordedShare: number
  /** The before share re-derived from the before profile with B2-C2B2H's analysis (must equal the recorded one). */
  beforeRecomputedShare: number | null
  beforeReproduced: boolean
  beforeProfileValid: boolean
  beforeQualityIssues: string[]
  afterShare: number | null
  afterProfileValid: boolean
  afterQualityIssues: string[]
  /** after / before, formal only when both profiles are valid (else null). */
  keepPredictionShareRatio: number | null
  /** after / before regardless of the quality rule (descriptive only). */
  descriptiveShareRatio: number | null
  categories: { category: string; beforeShareOfActive: number | null; afterShareOfActive: number | null }[]
}

/** Exact up to floating point rounding of a re-run of the same pure analysis. */
export const PHASE2C26B2C2B2I_REPRODUCTION_TOLERANCE = 1e-12

export function phase2c26b2c2b2iCpuComparison(input: { beforeRecordedShare: number; beforeAnalysis: Phase2C26B2C2B2HProfileAnalysis | null; beforeQualityIssues: readonly string[];
  afterAnalysis: Phase2C26B2C2B2HProfileAnalysis | null; afterQualityIssues: readonly string[] }): Phase2C26B2C2B2ICpuComparison {
  const share = (a: Phase2C26B2C2B2HProfileAnalysis | null) => (a === null ? null : phase2c26b2c2b2hActiveShare(a, PHASE2C26B2C2B2I_HOTSPOT_CATEGORY))
  const beforeRecomputedShare = share(input.beforeAnalysis)
  const beforeReproduced = beforeRecomputedShare !== null && Math.abs(beforeRecomputedShare - input.beforeRecordedShare) <= PHASE2C26B2C2B2I_REPRODUCTION_TOLERANCE
  const beforeProfileValid = input.beforeAnalysis !== null && input.beforeQualityIssues.length === 0 && beforeReproduced
  const afterShare = share(input.afterAnalysis)
  const afterProfileValid = input.afterAnalysis !== null && input.afterQualityIssues.length === 0
  const categories = (input.afterAnalysis ?? input.beforeAnalysis)?.categories.map(c => c.category) ?? []
  const shareOf = (a: Phase2C26B2C2B2HProfileAnalysis | null, category: string) => a?.categories.find(c => c.category === category)?.shareOfActive ?? null
  return { beforeRecordedShare: input.beforeRecordedShare, beforeRecomputedShare, beforeReproduced, beforeProfileValid, beforeQualityIssues: [...input.beforeQualityIssues],
    afterShare, afterProfileValid, afterQualityIssues: [...input.afterQualityIssues],
    keepPredictionShareRatio: beforeProfileValid && afterProfileValid ? ratio(afterShare, input.beforeRecordedShare) : null,
    descriptiveShareRatio: ratio(afterShare, input.beforeRecordedShare),
    categories: categories.map(category => ({ category, beforeShareOfActive: shareOf(input.beforeAnalysis, category), afterShareOfActive: shareOf(input.afterAnalysis, category) })) }
}

/** The predictKeep self line ticks of one profile analysis (descriptive). */
export function phase2c26b2c2b2iPredictKeepLineTicks(analysis: Phase2C26B2C2B2HProfileAnalysis | null) {
  const entry = analysis?.lineTicks.find(l => l.registered.endsWith('#predictKeep')) ?? null
  return entry === null ? null : { totalSelfTicks: entry.totalSelfTicks, unmappedTicks: entry.unmappedTicks, inSpan: entry.inSpan.map(l => ({ line: l.line, text: l.text, ticks: l.ticks })),
    outsideSpan: entry.outsideSpan }
}

// ---------------------------------------------------------------- decision

export function phase2c26b2c2b2iDecision(input: { invalidReasons: readonly string[]; identityParity: boolean; direct: Phase2C26B2C2B2IDirectComparison | null;
  cpu: Phase2C26B2C2B2ICpuComparison | null }) {
  const base = { scope: 'A before / after decision about one Production optimization (predictKeep memo representation) on one oracle-guided Search input (B2-C2B2H\'s), from the semantic-identical common depth prefix and the CPU share of the same classification. Never a Route exact judgement.' }
  const metrics = { stateGenerationDirectRatio: input.direct?.stateGenerationDirectRatio ?? null, keepPredictionShareRatio: input.cpu?.keepPredictionShareRatio ?? null }
  const make = (caseId: Phase2C26B2C2B2IDecisionCase, reasons: string[], adoption: 'adopt' | 'reject' | 'undecided') =>
    ({ ...base, case: caseId, reasons, adoption, ...metrics, nextPhase: PHASE2C26B2C2B2I_NEXT_PHASE[caseId] })
  if (input.invalidReasons.length > 0) return make('B2C2B2I_INVALID', [...input.invalidReasons], 'undecided')
  const d = input.direct
  if (d === null || (!d.valid && d.firstMismatch === null)) return make('B2C2B2I_INSUFFICIENT', d === null ? ['no direct comparison'] : [...d.issues], 'undecided')
  if (!d.semanticParity || !input.identityParity) {
    return make('B2C2B2I_REJECTED_SEMANTIC_MISMATCH', [...(d.semanticParity ? [] : [`held-aware depth record ${d.firstMismatch?.index ?? '-'} differs`]),
      ...(input.identityParity ? [] : ['the child-attested Search input / excluded Route is not the expected one'])], 'reject')
  }
  if (!d.valid || d.stateGenerationDirectRatio === null) return make('B2C2B2I_INSUFFICIENT', [...d.issues, 'no stateGenerationDirectRatio'], 'undecided')
  const direct = d.stateGenerationDirectRatio
  const keep = input.cpu?.keepPredictionShareRatio ?? null
  const profilesValid = input.cpu !== null && input.cpu.beforeProfileValid && input.cpu.afterProfileValid
  if (profilesValid && keep !== null && keep <= PHASE2C26B2C2B2I_ADOPT_MAX_KEEP_SHARE_RATIO && direct <= PHASE2C26B2C2B2I_ADOPT_MAX_DIRECT_RATIO) return make('B2C2B2I_ADOPTED', [], 'adopt')
  if (direct > PHASE2C26B2C2B2I_REGRESSION_DIRECT_RATIO) return make('B2C2B2I_REJECTED_REGRESSION', [`stateGenerationDirectRatio ${direct} > ${PHASE2C26B2C2B2I_REGRESSION_DIRECT_RATIO}`], 'reject')
  if (keep !== null && keep >= PHASE2C26B2C2B2I_NO_EFFECT_RATIO && direct >= PHASE2C26B2C2B2I_NO_EFFECT_RATIO) {
    return make('B2C2B2I_REJECTED_NO_EFFECT', [`keepPredictionShareRatio ${keep} >= ${PHASE2C26B2C2B2I_NO_EFFECT_RATIO} and stateGenerationDirectRatio ${direct} >= ${PHASE2C26B2C2B2I_NO_EFFECT_RATIO}`], 'reject')
  }
  const reasons: string[] = []
  if (!profilesValid || keep === null) reasons.push('the CPU share is not usable for the formal comparison (a profile fails the quality rule)')
  else if (keep > PHASE2C26B2C2B2I_ADOPT_MAX_KEEP_SHARE_RATIO) reasons.push(`keepPredictionShareRatio ${keep} > ${PHASE2C26B2C2B2I_ADOPT_MAX_KEEP_SHARE_RATIO}`)
  if (direct > PHASE2C26B2C2B2I_ADOPT_MAX_DIRECT_RATIO) reasons.push(`stateGenerationDirectRatio ${direct} > ${PHASE2C26B2C2B2I_ADOPT_MAX_DIRECT_RATIO}`)
  return make('B2C2B2I_PARTIAL', reasons, 'undecided')
}

// ---------------------------------------------------------------- launch provenance and run conditions

export interface Phase2C26B2C2B2ILaunchProvenance {
  verified: boolean
  source: 'runner_start_attestation' | 'none'
  workingTreeCleanVerified: boolean
  issues: string[]
  integrityIssues: string[]
  reason: string | null
}

/** B2-C2B2H's launch provenance rule with this phase's attestation. */
export function phase2c26b2c2b2iLaunchProvenance(input: { attestationFile: { sha256: string; body: unknown } | null; recordedAttestationSha256: string | null;
  environment: Record<string, unknown>; expected: Phase2C26B2C2B2IAttestationExpectation }): Phase2C26B2C2B2ILaunchProvenance {
  if (input.attestationFile === null) {
    return { verified: false, source: 'none', workingTreeCleanVerified: false, issues: ['no start attestation in the run dir'], integrityIssues: [], reason: 'The runner start attestation is missing.' }
  }
  const integrityIssues: string[] = []
  if (input.recordedAttestationSha256 !== input.attestationFile.sha256) integrityIssues.push('the attestation file is not the one the raw recorded')
  const verification = verifyPhase2C26B2C2B2IStartAttestation(input.attestationFile.body, input.expected)
  integrityIssues.push(...verification.integrityIssues)
  const body = isObject(input.attestationFile.body) ? input.attestationFile.body : {}
  for (const field of ['repositoryHead', 'uncommittedBenchmarkCode', 'benchmarkCodeSha256', 'exportSha256', 'probeManifestSha256', 'stage1', 'probes', 'cpuProfilerConfig',
    'productionChangedFiles', 'b2c2b2hBeforeFiles'] as const) {
    if (!same(body[field], input.environment[field])) integrityIssues.push(`${field} differs from the raw environment`)
  }
  const issues = [...integrityIssues, ...verification.issues.filter(i => !verification.integrityIssues.includes(i))]
  const verified = issues.length === 0
  return { verified, source: 'runner_start_attestation', workingTreeCleanVerified: verified, issues, integrityIssues, reason: verified ? null : `The start attestation does not verify: ${issues.join('; ')}.` }
}

export const phase2c26b2c2b2iEvidenceGrade = phase2c26b2c2b2hEvidenceGrade

/** B2-C2B2H's run conditions (one run, 30 minutes, 12,288 MB, heap-only Node flags, the registered CPU profiler window), unchanged. */
export const phase2c26b2c2b2iConditionIssues = phase2c26b2c2b2hConditionIssues

/** Peak heap / RSS of both runs (descriptive; a single run's peak difference never rejects on its own). */
export function phase2c26b2c2b2iMemory(before: { peakHeapBytes: number | null; peakRssBytes: number | null }, after: { peakHeapBytes: number | null; peakRssBytes: number | null }) {
  return { before, after, heapRatio: ratio(after.peakHeapBytes, before.peakHeapBytes), rssRatio: ratio(after.peakRssBytes, before.peakRssBytes),
    note: 'single-run peaks (sampled every 250 ms and at the child exit); descriptive only, never a rejection on their own' }
}
