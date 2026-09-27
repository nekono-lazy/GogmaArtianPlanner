import type { BuildListEntry } from '../domain/models/publicTypes'
import type { PlannerResult } from '../domain/planner/plannerTypes'
import type { CandidateSearchResult } from '../domain/search/searchTypes'
import type { PlannerGlobalEvidence, PlannerGlobalFallbackRecord, PlannerGlobalFallbackSearchEvidence, PlannerGlobalSearchEvidence } from './plannerGlobalBrowserBenchmarkProtocol'
import type { ExtentFallbackMeasurement, GlobalResearchReport } from './plannerGlobalOptimizationResearch'
import type { DiscoveryState, StopReason } from './plannerGlobalOptimizationRetry'

/**
 * Issue #154 Phase 2-A: benchmark-only semantic evidence. Research only; nothing Production imports it.
 *
 * Every hash is `sha256(JSON.stringify(value))` over exactly the values the Node Phase 1-B..1-E runners
 * hashed, so a Browser Worker run and a Node run of the same Research semantics produce byte-identical
 * SHA-256 values. JSON.stringify is deterministic here because every hashed object is built by the same
 * code in the same key order; no timing, memory or environment value is part of any hashed structure
 * (Search `elapsedMs` is removed exactly as the Node runner removed it).
 */
export type Sha256Text = (text: string) => Promise<string>

export const webCryptoSha256: Sha256Text = async text => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export function jsonSha256(sha: Sha256Text, value: unknown): Promise<string> {
  const text = JSON.stringify(value)
  if (text === undefined) throw new Error('Evidence value is not JSON-serializable.')
  return sha(text)
}

function withoutElapsed(result: CandidateSearchResult): Omit<CandidateSearchResult, 'elapsedMs'> {
  const semantic: Partial<CandidateSearchResult> = { ...result }
  delete semantic.elapsedMs
  return semantic as Omit<CandidateSearchResult, 'elapsedMs'>
}

/**
 * Collects Search evidence while the Research runs. The JSON text is taken synchronously inside the
 * callback (the Research hands a structured clone), and only the digest Promise is kept, so no Search
 * result body is retained until the end of the run.
 */
export class PlannerGlobalEvidenceCollector {
  private readonly search: Promise<PlannerGlobalSearchEvidence>[] = []
  private readonly fallback: Promise<PlannerGlobalFallbackSearchEvidence>[] = []
  private readonly sha: Sha256Text
  constructor(sha: Sha256Text) { this.sha = sha }

  onSearchResult = (result: CandidateSearchResult): void => {
    const targetId = result.targetResult.targetWeaponId as string
    const resultSha = jsonSha256(this.sha, withoutElapsed(result)), candidateSha = jsonSha256(this.sha, result.targetResult.candidate)
    this.search.push(Promise.all([resultSha, candidateSha]).then(([resultSha256, candidateSha256]) => ({ targetId, resultSha256, candidateSha256 })))
  }

  onFallbackSearchResult = (result: CandidateSearchResult, fallback: ExtentFallbackMeasurement): void => {
    const base = { targetId: result.targetResult.targetWeaponId as string, axis: fallback.axis, extent: fallback.extent, searchRunId: fallback.searchRunId }
    const resultSha = jsonSha256(this.sha, withoutElapsed(result)), candidateSha = jsonSha256(this.sha, result.targetResult.candidate)
    this.fallback.push(Promise.all([resultSha, candidateSha]).then(([resultSha256, candidateSha256]) => ({ ...base, resultSha256, candidateSha256 })))
  }

  async finish(finalResult: PlannerResult | null, generatedEntries: readonly BuildListEntry[]): Promise<PlannerGlobalEvidence> {
    const generated = await Promise.all(generatedEntries.map(async entry => ({ id: entry.id as string,
      candidateSha256: await jsonSha256(this.sha, entry.candidateSnapshot), entrySha256: await jsonSha256(this.sha, entry) })))
    return { searchEvidence: await Promise.all(this.search), fallbackSearchEvidence: await Promise.all(this.fallback), generatedEntries: generated,
      finalSelectedEntryIds: [...(finalResult?.plan?.selectedBuildListEntryIds ?? [])],
      planSha256: await jsonSha256(this.sha, finalResult?.plan ?? null), finalResultSha256: await jsonSha256(this.sha, finalResult ?? null),
      resultSha256: await jsonSha256(this.sha, { finalResult: finalResult ?? null, generatedEntries }) }
  }
}

/** The report without Search profiles (as the Node runner stored it). */
export function reportWithoutProfiles(report: GlobalResearchReport): GlobalResearchReport {
  return { ...report, searches: report.searches.map(search => {
    const copy = { ...search, ...(search.fallback ? { fallback: { ...search.fallback } } : {}) }
    delete copy.profile
    if (copy.fallback) delete copy.fallback.profile
    return copy
  }) }
}

/** The Node runner's `phase1d.fallbacks` projection. */
export function plannerGlobalFallbackRecords(report: GlobalResearchReport): PlannerGlobalFallbackRecord[] {
  return report.searches.flatMap((search, searchIndex) => {
    if (!search.fallback) return []
    const fallback: Partial<ExtentFallbackMeasurement> = { ...search.fallback }
    delete fallback.profile
    return [{ searchIndex, targetId: search.targetId, baseStatus: search.status, targetOutcome: search.targetOutcome ?? null,
      fallback: fallback as PlannerGlobalFallbackRecord['fallback'] }]
  })
}

/**
 * The Phase 1-E reproduction semantic structure (`scripts/run-planner-global-phase1e.mjs`), field for
 * field and in the same key order. Elapsed times, memory, environment and profiles are not part of it.
 */
export function plannerGlobalSemantic(value: { report: GlobalResearchReport; state: DiscoveryState; fallbacks: readonly PlannerGlobalFallbackRecord[];
  evidence: PlannerGlobalEvidence; stop: StopReason | null }) {
  const { report, state, fallbacks, evidence, stop } = value
  return {
    retainedOriginalEntryIds: [...report.retainedOriginalEntryIds].sort(),
    pendingOrder: report.searches.map(s => s.targetId),
    state,
    statuses: report.searches.map(s => ({ targetId: s.targetId, status: s.status, targetOutcome: s.targetOutcome ?? null })),
    fallbacks: fallbacks.map(f => ({ searchIndex: f.searchIndex, targetId: f.targetId, axis: f.fallback.axis, extent: f.fallback.extent, status: f.fallback.status,
      searchRunId: f.fallback.searchRunId, requestFingerprint: f.fallback.requestFingerprint, generatedEntryId: f.fallback.generatedEntryId })),
    fallbackSearchEvidence: evidence.fallbackSearchEvidence,
    searchEvidence: evidence.searchEvidence,
    generatedEntries: evidence.generatedEntries,
    selected: evidence.finalSelectedEntryIds,
    planSha256: evidence.planSha256,
    finalResultSha256: evidence.finalResultSha256,
    resultSha256: evidence.resultSha256,
    stop,
    final: report.final && { ...report.final, elapsedMs: undefined },
  }
}
